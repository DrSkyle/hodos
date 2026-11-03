package org.hodos.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.ActivityRecognition;
import com.google.android.gms.location.ActivityTransition;
import com.google.android.gms.location.ActivityTransitionRequest;
import com.google.android.gms.location.DetectedActivity;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Always-on mapping. The service watches for vehicle and bicycle activity; when
 * one starts it samples the accelerometer and location in the background, runs
 * the detector on the device, and stops itself when the journey ends.
 */
public class HodosService extends Service implements SensorEventListener {

  public static final String ACTION_ENABLE = "org.hodos.app.ENABLE";
  public static final String ACTION_DISABLE = "org.hodos.app.DISABLE";
  public static final String ACTION_START_TRIP = "org.hodos.app.START_TRIP";
  public static final String ACTION_END_TRIP = "org.hodos.app.END_TRIP";

  private static final String CHANNEL_ID = "hodos.mapping";
  private static final int NOTIFICATION_ID = 4711;
  private static final long ACTIVITY_INTERVAL_MS = 20_000;
  private static final long ANALYSIS_INTERVAL_MS = 2_000;
  private static final long STOP_AFTER_STILL_MS = 3 * 60_000;

  private static final String ENDPOINT = "https://sgp.cloud.appwrite.io/v1";
  private static final String PROJECT_ID = "6ad7939a002ff135e419";
  private static final String DATABASE_ID = "hodos";

  private SensorManager sensors;
  private FusedLocationProviderClient locationClient;
  private LocationCallback locationCallback;

  private final List<MotionDetector.Sample> samples = new ArrayList<>();
  private final List<MotionDetector.Fix> fixes = new ArrayList<>();
  private final List<MotionDetector.Impact> impacts = new ArrayList<>();
  // Coarse timestamps (not raw readings) preserve coverage evidence for long
  // journeys even though the high-rate detector sample buffer is trimmed.
  private final List<Long> motionCoverageTimes = new ArrayList<>();

  private ScheduledExecutorService scheduler;
  private EventOutbox outbox;
  private volatile boolean sampling = false;
  private volatile boolean isManualTrip = false;
  private volatile double cumulativeDistanceM = 0;
  private volatile int totalGpsFixes = 0;
  private volatile Location previousFix = null;
  private volatile long lastMovementAt = 0;
  private volatile String activeTripId;
  private volatile String activeDeviceId;
  private volatile long lastSyncScheduledAt = 0;
  private volatile long lastCheckpointAt = 0;
  private volatile long lastHistoryFlushAt = 0;
  private volatile long lastNotificationUpdateAt = 0;
  private long tripStartedAt = 0;
  private LocationCallback idleLocationCallback = null;

  @Override
  public void onCreate() {
    super.onCreate();
    sensors = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
    locationClient = LocationServices.getFusedLocationProviderClient(this);
    createChannel();
    outbox = new EventOutbox(this);

    SharedPreferences prefs = getSharedPreferences("hodos", MODE_PRIVATE);
    if (prefs.getBoolean("tripActive", false)) {
      long startedAt = prefs.getLong("tripStartedAt", 0);
      long lastCheck = prefs.getLong("tripLastCheckpoint", 0);
      long now = System.currentTimeMillis();
      // If service died recently (within 15 minutes) during an active trip, restore state
      if (startedAt > 0 && (now - lastCheck < 15 * 60_000L)) {
        activeTripId = prefs.getString("activeTripId", null);
        tripStartedAt = startedAt;
        cumulativeDistanceM = prefs.getFloat("tripDistanceM", 0f);
        totalGpsFixes = prefs.getInt("tripFixes", 0);
        isManualTrip = prefs.getBoolean("isManualTrip", false);
      } else {
        sealStaleTrip(prefs);
        prefs.edit().putBoolean("tripActive", false).apply();
      }
    }
  }

  private void sealStaleTrip(SharedPreferences prefs) {
    String trip = prefs.getString("activeTripId", null);
    long startedAt = prefs.getLong("tripStartedAt", 0);
    int impactCount = prefs.getInt("tripImpacts", 0);
    int fixCount = prefs.getInt("tripFixes", 0);
    double dist = prefs.getFloat("tripDistanceM", 0f);
    long elapsedS = prefs.getLong("tripElapsedS", 0);
    if (startedAt > 0 && trip != null) {
      TripHistory.recordOrUpdate(prefs, trip, startedAt, impactCount, fixCount, dist, elapsedS);
    }
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? null : intent.getAction();
    if (ACTION_DISABLE.equals(action)) {
      // Finish and persist an active journey before tearing down the service.
      endTrip();
      // Deliberate user opt-out, unlike Android reclaiming this service.
      getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("armed", false).commit();
      stopEverything();
      stopForeground(true);
      stopSelf();
      return START_NOT_STICKY;
    }

    if (ACTION_START_TRIP.equals(action) || ACTION_END_TRIP.equals(action)) {
      if (ACTION_START_TRIP.equals(action)) {
        // Auto-arm if user directly initiates a journey
        getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("armed", true).commit();
      } else if (!getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)) {
        stopSelf();
        return START_NOT_STICKY;
      }
      startForegroundCompat();
      HodosSyncWorker.schedule(this);
      if (ACTION_START_TRIP.equals(action)) {
        isManualTrip = true;
        if (!sampling) {
          lastMovementAt = System.currentTimeMillis();
          startTrip();
        }
      } else {
        isManualTrip = false;
        endTrip();
      }
      return START_STICKY;
    }

    if ("org.hodos.app.ACTIVITY".equals(action)) {
      if (!getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)) {
        stopSelf();
        return START_NOT_STICKY;
      }
      startForegroundCompat();
      HodosSyncWorker.schedule(this);
      int activityType = intent.getIntExtra("activity", -1);
      if (activityType >= 0) {
        handleActivity(activityType);
      }
      return START_STICKY;
    }

    // START_STICKY may restart the service with a null intent. Re-arm only if
    // this installation had opted in; never resurrect mapping after opt-out.
    if (!ACTION_ENABLE.equals(action) &&
        !getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)) {
      stopSelf(startId);
      return START_NOT_STICKY;
    }
    startForegroundCompat();
    registerActivityTransitions();
    if (!sampling) {
      startIdleMotionWatcher();
    }
    HodosSyncWorker.schedule(this);
    lastMovementAt = System.currentTimeMillis();
    return START_STICKY;
  }

  @Override
  public void onDestroy() {
    endTrip();
    stopEverything();
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return;
    }
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
      return;
    }
    NotificationChannel channel =
        new NotificationChannel(CHANNEL_ID, "Road mapping", NotificationManager.IMPORTANCE_LOW);
    channel.setDescription("Keeps Hodos mapping the road while you travel.");
    manager.createNotificationChannel(channel);
  }

  private static String formatDuration(long seconds) {
    if (seconds < 0) seconds = 0;
    long hours = seconds / 3600;
    long minutes = (seconds % 3600) / 60;
    long secs = seconds % 60;
    if (hours > 0) {
      return String.format(Locale.US, "%d:%02d:%02d", hours, minutes, secs);
    }
    return String.format(Locale.US, "%02d:%02d", minutes, secs);
  }

  private static String formatDistance(double meters) {
    if (meters >= 1000.0) {
      return String.format(Locale.US, "%.1f km", meters / 1000.0);
    }
    return String.format(Locale.US, "%d m", Math.round(meters));
  }

  private Notification buildNotification(String text) {
    Intent open = new Intent(this, MainActivity.class);
    int pendingFlags =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            : PendingIntent.FLAG_UPDATE_CURRENT;
    PendingIntent content = PendingIntent.getActivity(this, 0, open, pendingFlags);
    return new NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("Hodos")
        .setContentText(text)
        .setSmallIcon(R.drawable.hodos_notification)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(content)
        .build();
  }

  private void startForegroundCompat() {
    Notification notification = buildNotification("Waiting for a journey");
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, 0x8 /* FOREGROUND_SERVICE_TYPE_LOCATION */);
    } else {
      startForeground(NOTIFICATION_ID, notification);
    }
  }

  private void updateNotification(String text) {
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager != null) {
      manager.notify(NOTIFICATION_ID, buildNotification(text));
    }
  }

  private void registerActivityTransitions() {
    List<ActivityTransition> transitions = new ArrayList<>();
    int[] activities = {
      DetectedActivity.IN_VEHICLE, DetectedActivity.ON_BICYCLE, DetectedActivity.WALKING,
      DetectedActivity.STILL, DetectedActivity.ON_FOOT, DetectedActivity.RUNNING
    };
    for (int activity : activities) {
      transitions.add(
          new ActivityTransition.Builder()
              .setActivityType(activity)
              .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
              .build());
    }
    ActivityTransitionRequest request = new ActivityTransitionRequest(transitions);
    Intent intent = new Intent(this, HodosActivityReceiver.class);
    int flags =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            : PendingIntent.FLAG_UPDATE_CURRENT;
    PendingIntent pending = PendingIntent.getBroadcast(this, 1, intent, flags);
    try {
      ActivityRecognition.getClient(this).requestActivityTransitionUpdates(request, pending);
    } catch (SecurityException ignored) {
      /* activity permission revoked */
    }
    getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("armed", true).apply();
  }

  public static void onActivity(Context context, int activityType) {
    // Pending transitions may arrive after the user turned mapping off.
    if (!context.getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)) {
      return;
    }
    Intent intent = new Intent(context, HodosService.class);
    intent.setAction("org.hodos.app.ACTIVITY");
    intent.putExtra("activity", activityType);
    try {
      // The mapping service is already running in the foreground, so a plain
      // startService is permitted from a background receiver. startForegroundService
      // from a receiver is refused on Android 12+, which is what used to make this
      // silently do nothing.
      context.startService(intent);
    } catch (RuntimeException ignored) {
      /* only the foreground can restart a service that has been stopped */
    }
  }

  void handleActivity(int activityType) {
    boolean moving =
        activityType == DetectedActivity.IN_VEHICLE || activityType == DetectedActivity.ON_BICYCLE;
    if (moving) {
      lastMovementAt = System.currentTimeMillis();
      if (!sampling) {
        startTrip();
      }
    } else {
      lastMovementAt = System.currentTimeMillis();
    }
  }

  private boolean hasLocationPermission() {
    return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
        == PackageManager.PERMISSION_GRANTED;
  }

  private synchronized void startTrip() {
    if (!hasLocationPermission()) {
      updateNotification("Location permission needed");
      return;
    }
    removeIdleLocationWatcher();
    try {
      // A single stable identity must cover all observations from this journey.
      activeDeviceId = deviceId();
      activeTripId = UUID.randomUUID().toString();
    } catch (RuntimeException error) {
      updateNotification("Storage unavailable · trip not recorded");
      return;
    }
    lastSyncScheduledAt = 0;
    sampling = true;
    lastMovementAt = System.currentTimeMillis();
    tripStartedAt = System.currentTimeMillis();
    cumulativeDistanceM = 0;
    totalGpsFixes = 0;
    previousFix = null;
    lastCheckpointAt = System.currentTimeMillis();
    lastHistoryFlushAt = System.currentTimeMillis();
    lastNotificationUpdateAt = System.currentTimeMillis();

    getSharedPreferences("hodos", MODE_PRIVATE).edit()
        .putBoolean("tripActive", true)
        .putString("activeTripId", activeTripId)
        .putLong("tripStartedAt", tripStartedAt)
        .putBoolean("isManualTrip", isManualTrip)
        .putLong("tripLastCheckpoint", tripStartedAt)
        .putFloat("tripDistanceM", 0f)
        .putInt("tripImpacts", 0)
        .putInt("tripFixes", 0)
        .putLong("tripElapsedS", 0)
        .commit();

    synchronized (samples) { samples.clear(); }
    synchronized (motionCoverageTimes) { motionCoverageTimes.clear(); }
    synchronized (fixes) { fixes.clear(); }
    synchronized (impacts) { impacts.clear(); }
    updateNotification("Mapping: 00:00 · 0 m (0 hazards)");

    Sensor accelerometer =
        sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
    if (accelerometer == null ||
        !sensors.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME)) {
      // Never claim a clear road if the device cannot measure road impacts.
      sampling = false;
      getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("tripActive", false).apply();
      updateNotification("Accelerometer unavailable · trip not recorded");
      return;
    }

    LocationRequest request =
        new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2000).build();
    locationCallback =
        new LocationCallback() {
          @Override
          public void onLocationResult(LocationResult result) {
            Location last = result.getLastLocation();
            if (last != null && LocationFixPolicy.validRoadFix(
                last.getTime(), System.currentTimeMillis(), last.getLatitude(),
                last.getLongitude(), last.getAccuracy(), last.getSpeed(), last.hasSpeed(),
                last.isFromMockProvider())) {
              totalGpsFixes++;
              if (previousFix != null && last.getTime() > previousFix.getTime()) {
                float[] res = new float[1];
                Location.distanceBetween(previousFix.getLatitude(), previousFix.getLongitude(),
                    last.getLatitude(), last.getLongitude(), res);
                double elapsed = (last.getTime() - previousFix.getTime()) / 1000.0;
                if (res[0] >= 0 && res[0] <= elapsed * 45 + 30) {
                  cumulativeDistanceM += res[0];
                  if (res[0] >= 15) {
                    lastMovementAt = System.currentTimeMillis();
                  }
                }
              }
              previousFix = last;
              if (last.hasSpeed() && last.getSpeed() >= 2.0f) {
                lastMovementAt = System.currentTimeMillis();
              }
              synchronized (fixes) {
                fixes.add(new MotionDetector.Fix(
                    last.getTime(), last.getLatitude(), last.getLongitude(),
                    last.getAccuracy(), last.getSpeed(), last.hasSpeed()));
                if (fixes.size() > 2400) {
                  fixes.subList(0, 800).clear();
                }
              }
            }
          }
        };
    try {
      locationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
    } catch (SecurityException ignored) {
      /* permission revoked mid-trip */
    }

    scheduler = Executors.newSingleThreadScheduledExecutor();
    scheduler.scheduleWithFixedDelay(
        this::analyse, ANALYSIS_INTERVAL_MS, ANALYSIS_INTERVAL_MS, TimeUnit.MILLISECONDS);
  }

  private void analyse() {
    if (!sampling) {
      return;
    }
    // Capture identity before analysis so a subsequent journey cannot re-label
    // an observation finishing on this scheduler thread.
    final String device = activeDeviceId;
    final String trip = activeTripId;
    final long startedAt = tripStartedAt;
    if (device == null || trip == null) return;
    long cutoff = System.currentTimeMillis() - 30_000;
    List<MotionDetector.Sample> window = new ArrayList<>();
    synchronized (samples) {
      for (MotionDetector.Sample sample : samples) {
        if (sample.t >= cutoff) window.add(sample);
      }
    }
    long now = System.currentTimeMillis();
    long elapsedMs = startedAt > 0 ? now - startedAt : 0;
    long elapsedS = elapsedMs / 1000;

    int currentImpacts;
    synchronized (impacts) { currentImpacts = impacts.size(); }

    // Periodic durable checkpoint to SharedPreferences for UI display
    if (now - lastCheckpointAt >= 4000L) {
      lastCheckpointAt = now;
      getSharedPreferences("hodos", MODE_PRIVATE).edit()
          .putBoolean("tripActive", true)
          .putString("activeTripId", trip)
          .putLong("tripStartedAt", startedAt)
          .putLong("tripLastCheckpoint", now)
          .putLong("tripElapsedS", elapsedS)
          .putFloat("tripDistanceM", (float) cumulativeDistanceM)
          .putInt("tripImpacts", currentImpacts)
          .putInt("tripFixes", totalGpsFixes)
          .apply();
    }

    // Periodic durable commit to TripHistory every 20 seconds so multi-hour journeys are never lost
    if (now - lastHistoryFlushAt >= 20_000L) {
      lastHistoryFlushAt = now;
      TripHistory.recordOrUpdate(
          getSharedPreferences("hodos", MODE_PRIVATE),
          trip, startedAt, currentImpacts, totalGpsFixes,
          cumulativeDistanceM, elapsedS);
    }

    // Periodic notification update with live timer and metrics
    if (now - lastNotificationUpdateAt >= 5000L) {
      lastNotificationUpdateAt = now;
      String timeStr = formatDuration(elapsedS);
      String distStr = formatDistance(cumulativeDistanceM);
      updateNotification("Mapping: " + timeStr + " · " + distStr + " (" + currentImpacts + " hazards)");
    }

    // Allow longer stillness on manual journeys (25 mins) or bus stops (8 mins)
    long stillDuration = now - lastMovementAt;
    long maxStillAllowed = isManualTrip ? (25 * 60_000L) : (8 * 60_000L);
    if (stillDuration > maxStillAllowed) {
      endTrip();
      return;
    }
    if (window.size() < 25) {
      return;
    }
    List<MotionDetector.Fix> locationSnapshot;
    synchronized (fixes) { locationSnapshot = new ArrayList<>(fixes); }
    List<MotionDetector.Impact> found = MotionDetector.detect(window, locationSnapshot);
    List<MotionDetector.Impact> newImpacts = new ArrayList<>();
    synchronized (impacts) {
      for (MotionDetector.Impact impact : found) {
        boolean duplicate = false;
        for (MotionDetector.Impact seen : impacts) {
          if (Math.abs(seen.t - impact.t) < 500) {
            duplicate = true;
            break;
          }
        }
        if (!duplicate) {
          impacts.add(impact);
          newImpacts.add(impact);
        }
      }
    }
    // Persist on this analysis executor, NOT the UI thread, while the journey
    // is still active. A killed service may never reach endTrip().
    boolean persisted = false;
    for (MotionDetector.Impact impact : newImpacts) {
      persisted |= postEvent(device, trip, impact, startedAt);
    }
    if (persisted && (lastSyncScheduledAt == 0 ||
        now - lastSyncScheduledAt >= 60_000L)) {
      lastSyncScheduledAt = now;
      // WorkManager retains the work across process death and network loss.
      HodosSyncWorker.schedule(this);
    }
  }

  private synchronized void endTrip() {
    if (!sampling) {
      // A sticky-restarted service may have no in-memory trip while the
      // persisted UI flag still says active.
      getSharedPreferences("hodos", MODE_PRIVATE)
          .edit().putBoolean("tripActive", false).apply();
      return;
    }
    sampling = false;
    getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("tripActive", false).apply();
    if (scheduler != null) {
      scheduler.shutdownNow();
      scheduler = null;
    }
    sensors.unregisterListener(this);
    if (locationCallback != null) {
      locationClient.removeLocationUpdates(locationCallback);
      locationCallback = null;
    }

    List<MotionDetector.Impact> finished;
    List<MotionDetector.Fix> route;
    List<Long> coverage;
    synchronized (impacts) { finished = new ArrayList<>(impacts); }
    synchronized (fixes) { route = new ArrayList<>(fixes); }
    synchronized (motionCoverageTimes) {
      coverage = new ArrayList<>(motionCoverageTimes);
    }
    // Persist the evidence BEFORE returning to Android or stopping the
    // foreground service.
    final String device = activeDeviceId;
    final String trip = activeTripId;
    final long startedAt = tripStartedAt;
    if (device == null || trip == null) {
      updateNotification("Waiting for a journey");
      if (getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)) {
        startIdleMotionWatcher();
      }
      return;
    }
    for (MotionDetector.Impact impact : finished) {
      // Idempotent retry if the periodic detector could not persist earlier.
      postEvent(device, trip, impact, startedAt);
    }
    // Save an actual journey summary before the service stops; a detached
    // upload worker must not be responsible for the local history existing.
    double totalDistance = Math.max(cumulativeDistanceM, distanceMetres(route));
    int fixCount = Math.max(totalGpsFixes, route.size());
    long elapsedS = startedAt > 0 ? (System.currentTimeMillis() - startedAt) / 1000 : 0;

    TripHistory.recordOrUpdate(getSharedPreferences("hodos", MODE_PRIVATE),
        trip, startedAt > 0 ? startedAt : System.currentTimeMillis(),
        finished.size(), fixCount, totalDistance, elapsedS);

    getSharedPreferences("hodos", MODE_PRIVATE).edit()
        .putBoolean("tripActive", false)
        .putLong("tripElapsedS", 0)
        .remove("activeTripId")
        .apply();

    updateNotification("Waiting for a journey");
    if (getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)) {
      startIdleMotionWatcher();
    }
    // WorkManager owns upload retries even if mapping is disabled, the device
    // loses connectivity, or Android reclaims this foreground service.
    HodosSyncWorker.schedule(this);
    // Local summaries and optional pass evidence remain on a worker thread.
    new Thread(() -> upload(finished, route, device, trip, coverage, startedAt),
        "hodos-trip-upload").start();
  }

  private void stopEverything() {
    sampling = false;
    getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("tripActive", false).apply();
    if (scheduler != null) {
      scheduler.shutdownNow();
      scheduler = null;
    }
    sensors.unregisterListener(this);
    if (locationCallback != null) {
      locationClient.removeLocationUpdates(locationCallback);
      locationCallback = null;
    }
    removeIdleLocationWatcher();
    Intent intent = new Intent(this, HodosActivityReceiver.class);
    int flags =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            : PendingIntent.FLAG_UPDATE_CURRENT;
    try {
      ActivityRecognition.getClient(this)
          .removeActivityTransitionUpdates(PendingIntent.getBroadcast(this, 1, intent, flags));
    } catch (SecurityException ignored) {
      /* nothing registered */
    }
    // Preserve the opt-in across ordinary service teardown; a sticky restart
    // needs to know whether Android stopped us or the user turned us off.
  }

  private synchronized void startIdleMotionWatcher() {
    if (sampling || idleLocationCallback != null || !hasLocationPermission()) {
      return;
    }
    LocationRequest idleReq = new LocationRequest.Builder(
        Priority.PRIORITY_BALANCED_POWER_ACCURACY, 25_000L)
        .setMinUpdateIntervalMillis(15_000L)
        .build();
    idleLocationCallback = new LocationCallback() {
      @Override
      public void onLocationResult(LocationResult result) {
        if (sampling) return;
        Location loc = result.getLastLocation();
        if (loc != null && LocationFixPolicy.validCoordinates(loc.getLatitude(), loc.getLongitude())) {
          // If vehicle speed >= 3.5 m/s (~13 km/h), auto-start mapping!
          if (loc.hasSpeed() && loc.getSpeed() >= 3.5f) {
            isManualTrip = false;
            startTrip();
          }
        }
      }
    };
    try {
      locationClient.requestLocationUpdates(idleReq, idleLocationCallback, Looper.getMainLooper());
    } catch (SecurityException ignored) {
    }
  }

  private synchronized void removeIdleLocationWatcher() {
    if (idleLocationCallback != null) {
      try {
        locationClient.removeLocationUpdates(idleLocationCallback);
      } catch (Exception ignored) {}
      idleLocationCallback = null;
    }
  }

  @Override
  public void onSensorChanged(SensorEvent event) {
    if (!sampling) {
      return;
    }
    long t = System.currentTimeMillis();
    synchronized (samples) {
      samples.add(new MotionDetector.Sample(
          t, event.values[0], event.values[1], event.values[2]));
      if (samples.size() > 6000) samples.subList(0, 3000).clear();
    }
    synchronized (motionCoverageTimes) {
      int last = motionCoverageTimes.size() - 1;
      // A wall-clock change invalidates assumptions about ordering.
      if (last >= 0 && t < motionCoverageTimes.get(last)) {
        motionCoverageTimes.clear();
        last = -1;
      }
      if (last < 0 || t - motionCoverageTimes.get(last) >= 500) {
        motionCoverageTimes.add(t);
        if (motionCoverageTimes.size() > 25000) {
          motionCoverageTimes.subList(0, 10000).clear();
        }
      }
    }
  }

  @Override
  public void onAccuracyChanged(Sensor sensor, int accuracy) {
    /* not used */
  }

  /** Persistent random installation pseudonym used for corroboration. */
  private String deviceId() {
    SharedPreferences prefs = getSharedPreferences("hodos", MODE_PRIVATE);
    String id = prefs.getString("deviceId", null);
    if (id == null || id.isEmpty()) {
      id = UUID.randomUUID().toString();
      if (!prefs.edit().putString("deviceId", id).commit()) {
        throw new IllegalStateException("Installation ID could not be persisted");
      }
    }
    return id;
  }

  private void upload(List<MotionDetector.Impact> finished, List<MotionDetector.Fix> route,
                      String device, String trip, List<Long> coverage, long startedAt) {
    // Observed impacts and the local trip summary are already durable.
    // This worker only computes optional clear-road evidence.
    if (getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)) {
      updateNotification("Waiting for a journey");
    }

    // No negative road evidence without measured motion at BOTH positions
    // of the crossing. Keeping this within the worker avoids network on main.
    if (coverage.size() >= 4 && route.size() >= 2) {
      List<MotionDetector.Hazard> known = fetchPublishedHazards();
      List<MotionDetector.Hazard> cleared =
          MotionDetector.passedHazards(route, known, finished, coverage);
      for (MotionDetector.Hazard hazard : cleared) {
        postPass(device, trip, hazard, startedAt);
      }
    }
    // A pass may have been enqueued after the earlier sync worker started.
    HodosSyncWorker.schedule(this);
  }

  private List<MotionDetector.Hazard> fetchPublishedHazards() {
    List<MotionDetector.Hazard> hazards = new ArrayList<>();
    try {
      HttpURLConnection connection =
          open("GET", "tables/hazards/rows?queries[]="
              + java.net.URLEncoder.encode(
                  "{\"method\":\"limit\",\"values\":[500]}", StandardCharsets.UTF_8.name()));
      if (connection == null) {
        return hazards;
      }
      if (connection.getResponseCode() != 200) {
        connection.disconnect();
        return hazards;
      }
      StringBuilder body = new StringBuilder();
      try (BufferedReader reader =
          new BufferedReader(
              new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
        String line;
        while ((line = reader.readLine()) != null) {
          body.append(line);
        }
      }
      connection.disconnect();
      JSONArray rows = new JSONObject(body.toString()).optJSONArray("rows");
      if (rows == null) {
        return hazards;
      }
      for (int i = 0; i < rows.length(); i++) {
        JSONObject row = rows.getJSONObject(i);
        if (!row.optBoolean("published", false)) {
          continue;
        }
        MotionDetector.Hazard hazard = new MotionDetector.Hazard();
        hazard.id = row.optString("$id");
        hazard.lat = row.optDouble("lat");
        hazard.lng = row.optDouble("lng");
        hazard.kind = row.optString("kind");
        hazards.add(hazard);
      }
    } catch (Exception ignored) {
      /* the pass calculation is best effort */
    }
    return hazards;
  }

  private boolean postPass(
      String device, String trip, MotionDetector.Hazard hazard, long startedAt) {
    try {
      JSONObject data = new JSONObject();
      data.put("deviceId", device);
      data.put("tripId", trip);
      data.put("recordedAt", isoTime(System.currentTimeMillis()));
      data.put("lat", hazard.lat);
      data.put("lng", hazard.lng);
      data.put("accuracy", 6);
      data.put("speedKph", 0);
      data.put("magnitude", 0);
      data.put("severity", 1);
      data.put("kind", hazard.kind);
      data.put("confidence", 0.8);
      data.put("mode", "vehicle");
      data.put("observation", "pass");
      data.put("hazardRef", hazard.id);
      return HodosSyncWorker.enqueueTripObservation(this, outbox,
          UUID.randomUUID().toString(), data.toString(), startedAt);
    } catch (Exception error) {
      return false;
    }
  }

  private static double distanceMetres(List<MotionDetector.Fix> route) {
    double total = 0;
    MotionDetector.Fix previous = null;
    float[] result = new float[1];
    for (MotionDetector.Fix fix : route) {
      if (!Double.isFinite(fix.lat) || !Double.isFinite(fix.lng) ||
          Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180 ||
          fix.accuracy < 0 || fix.accuracy > 50) continue;
      if (previous != null && fix.t > previous.t) {
        Location.distanceBetween(previous.lat, previous.lng, fix.lat, fix.lng, result);
        double elapsed = (fix.t - previous.t) / 1000.0;
        // Ignore impossible GPS leaps while allowing location sampling jitter.
        if (result[0] >= 0 && result[0] <= elapsed * 45 + 30) {
          total += result[0];
        }
      }
      previous = fix;
    }
    return Math.round(total);
  }

  private boolean postEvent(
      String device, String trip, MotionDetector.Impact impact, long startedAt) {
    try {
      JSONObject data = new JSONObject();
      data.put("deviceId", device);
      data.put("tripId", trip);
      data.put("recordedAt", isoTime(impact.t));
      data.put("lat", impact.lat);
      data.put("lng", impact.lng);
      data.put("accuracy", impact.accuracy);
      data.put("speedKph", impact.speedKph);
      data.put("magnitude", impact.magnitude);
      data.put("severity", impact.severity);
      data.put("kind", impact.kind);
      data.put("confidence", impact.confidence);
      data.put("mode", impact.mode);
      return HodosSyncWorker.enqueueTripObservation(this, outbox,
          ObservationIds.impactRowId(trip, impact.t), data.toString(), startedAt);
    } catch (Exception error) {
      return false;
    }
  }

  private String isoTime(long t) {
    java.text.SimpleDateFormat utc =
        new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
    utc.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
    return utc.format(new java.util.Date(t));
  }

  private HttpURLConnection open(String method, String path) {
    try {
      URL url = new URL(ENDPOINT + "/tablesdb/" + DATABASE_ID + "/" + path);
      HttpURLConnection connection = (HttpURLConnection) url.openConnection();
      connection.setRequestMethod(method);
      connection.setRequestProperty("X-Appwrite-Project", PROJECT_ID);
      connection.setRequestProperty("Content-Type", "application/json");
      connection.setConnectTimeout(10_000);
      connection.setReadTimeout(15_000);
      return connection;
    } catch (Exception error) {
      return null;
    }
  }

}
