package org.hodos.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import androidx.work.WorkManager;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * OS-managed upload of immutable observations. The worker has no location,
 * accelerometer, or foreground-service dependency; turning mapping off stops
 * NEW collection, not already-consented evidence in the private outbox.
 */
public final class HodosSyncWorker extends Worker {
  private static final String TAG = "HodosSync";
  private static final String WORK_NAME = "hodos-observation-sync";
  private static final String RECOVERY_WORK_NAME = "hodos-observation-recovery";
  // WorkManager may run both the immediate and periodic jobs in this process.
  // Serialize draining so the queue and aggregation marker have one writer.
  private static final Object DRAIN_LOCK = new Object();
  private static final String ENDPOINT = "https://sgp.cloud.appwrite.io/v1";
  private static final String PROJECT_ID = "6ad7939a002ff135e419";
  private static final String AGGREGATION_PENDING = "aggregationPending";
  private static final String DISCARD_BEFORE = "pendingDiscardedBefore";
  private static final int BATCH_SIZE = 40;

  public HodosSyncWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
    super(context, parameters);
  }

  /**
   * At most one immediate job may be pending, plus one 15-minute recovery job.
   * KEEP avoids building unbounded dependent work chains on repeated GPS
   * events, activity resumes and offline reconnects. The periodic job closes
   * the final race when a new row arrives as a running immediate job finishes.
   */
  public static void schedule(Context context) {
    try {
      Constraints network = new Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build();
      OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(HodosSyncWorker.class)
          .setConstraints(network)
          .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
          .build();
      WorkManager manager = WorkManager.getInstance(context.getApplicationContext());
      PeriodicWorkRequest recovery =
          new PeriodicWorkRequest.Builder(HodosSyncWorker.class, 15, TimeUnit.MINUTES)
              .setConstraints(network)
              .build();
      manager.enqueueUniquePeriodicWork(
          RECOVERY_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, recovery);
      manager.enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request);
    } catch (RuntimeException error) {
      // SQLite outbox remains durable; the next app launch can re-enqueue.
      Log.w(TAG, "Could not schedule observation sync", error);
    }
  }

  /**
   * Opt-out for reports not yet submitted. Serialize against the network drain
   * before clearing SQLite, and cancel both recovery and immediate jobs. A
   * request already accepted before this acquires the lock cannot be recalled.
   * Call from an IO coroutine, never Android's UI thread.
   */
  static int discardPending(Context context) {
    Context app = context.getApplicationContext();
    SharedPreferences prefs = app.getSharedPreferences("hodos", Context.MODE_PRIVATE);
    if (prefs.getBoolean("armed", false) || prefs.getBoolean("tripActive", false)) {
      throw new IllegalStateException("Turn mapping off and finish the journey first");
    }
    // Cancel first so an in-flight drain notices WorkManager's stop request
    // before we wait for the shared lock. Otherwise a slow network could keep
    // the user waiting for an entire 40-observation batch.
    WorkManager manager = WorkManager.getInstance(app);
    manager.cancelUniqueWork(WORK_NAME);
    manager.cancelUniqueWork(RECOVERY_WORK_NAME);
    synchronized (DRAIN_LOCK) {
      // Recheck after acquiring the lock in case mapping was enabled meanwhile.
      if (prefs.getBoolean("armed", false) || prefs.getBoolean("tripActive", false)) {
        throw new IllegalStateException("Mapping resumed while deleting reports");
      }
      // The cutoff invalidates delayed inserts from journeys that began
      // before deletion (for instance, an end-of-journey pass fetch).
      long now = System.currentTimeMillis();
      if (!prefs.edit().putLong(DISCARD_BEFORE, now).commit()) {
        throw new IllegalStateException("Could not save the deletion boundary");
      }
      try (EventOutbox outbox = new EventOutbox(app)) {
        return outbox.clearPending();
      }
    }
  }

  static boolean mayPersistTrip(long startedAt, long discardBefore) {
    return startedAt > 0 && startedAt > discardBefore;
  }

  /** Same lock as queue deletion: no delayed trip report can cross its cutoff. */
  static boolean enqueueTripObservation(
      Context context, EventOutbox queue, String id, String payload, long startedAt) {
    synchronized (DRAIN_LOCK) {
      long discarded = context.getApplicationContext()
          .getSharedPreferences("hodos", Context.MODE_PRIVATE)
          .getLong(DISCARD_BEFORE, 0L);
      return mayPersistTrip(startedAt, discarded) && queue.enqueue(id, payload);
    }
  }

  @NonNull
  @Override
  public Result doWork() {
    synchronized (DRAIN_LOCK) {
      return drain();
    }
  }

  private Result drain() {
    SharedPreferences prefs =
        getApplicationContext().getSharedPreferences("hodos", Context.MODE_PRIVATE);
    try (EventOutbox queue = new EventOutbox(getApplicationContext())) {
      List<EventOutbox.Entry> pending = queue.pending(BATCH_SIZE);
      for (EventOutbox.Entry event : pending) {
        if (isStopped()) return Result.retry();
        JSONObject body;
        try {
          body = new JSONObject().put("rowId", event.id)
              .put("data", new JSONObject(event.payload));
        } catch (Exception invalid) {
          if (!queue.quarantine(event.id, 422)) return Result.retry();
          continue;
        }
        int status = post("tablesdb/hodos/tables/events/rows", body.toString());
        if (UploadResponsePolicy.accepted(status)) {
          // Persist this marker before acknowledging the accepted event.
          // If the process dies, the next run will still request aggregation.
          if (!prefs.edit().putBoolean(AGGREGATION_PENDING, true).commit()) {
            return Result.retry();
          }
          queue.acknowledge(event.id);
        } else if (UploadResponsePolicy.isPermanentlyRejected(status)) {
          if (!queue.quarantine(event.id, status)) return Result.retry();
        } else {
          return Result.retry();
        }
      }

      if (isStopped()) return Result.retry();
      if (prefs.getBoolean(AGGREGATION_PENDING, false)) {
        int status = post("functions/hodos-aggregate/executions", "{\"async\":true}");
        if (status < 200 || status >= 300) return Result.retry();
        if (!prefs.edit().putBoolean(AGGREGATION_PENDING, false).commit()) {
          return Result.retry();
        }
      }
      // Bound each run so WorkManager can stop us safely on battery restrictions.
      return queue.pendingCount() > 0 ? Result.retry() : Result.success();
    } catch (Exception error) {
      // Never log an observation payload or raw precise location.
      Log.w(TAG, "Observation sync interrupted; retry scheduled", error);
      return Result.retry();
    }
  }

  private int post(String path, String json) {
    HttpURLConnection connection = null;
    try {
      connection = (HttpURLConnection) new URL(ENDPOINT + "/" + path).openConnection();
      connection.setRequestMethod("POST");
      connection.setRequestProperty("X-Appwrite-Project", PROJECT_ID);
      connection.setRequestProperty("Content-Type", "application/json");
      connection.setConnectTimeout(10_000);
      connection.setReadTimeout(15_000);
      connection.setDoOutput(true);
      try (OutputStream stream = connection.getOutputStream()) {
        stream.write(json.getBytes(StandardCharsets.UTF_8));
      }
      return connection.getResponseCode();
    } catch (Exception error) {
      return -1;
    } finally {
      if (connection != null) connection.disconnect();
    }
  }
}
