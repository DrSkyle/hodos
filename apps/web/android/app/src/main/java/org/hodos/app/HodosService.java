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
  private volatile long lastMovementAt = 0;
  private volatile String activeTripId;
  private volatile String activeDeviceId;
  private volatile long lastSyncScheduledAt = 0;
  private long tripStartedAt = 0;

  @Override
  public void onCreate() {
    super.onCreate();
    sensors = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
    locationClient = LocationServices.getFusedLocationProviderClient(this);
    createChannel();
    outbox = new EventOutbox(this);
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? null : intent.getAction();
    if (ACTION_DISABLE.equals(action)) {
      // Finish and persist an active journey before tearing down the service.
      // Previously, switching mapping off silently discarded collected impacts.
      endTrip();
      // Deliberate user opt-out, unlike Android reclaiming this service.
      getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("armed", false).commit();
      stopEverything();
      stopForeground(true);
      stopSelf();
      return START_NOT_STICKY;
    }

    if (ACTION_START_TRIP.equals(action) || ACTION_END_TRIP.equals(action)) {
      if (!getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)) {
        stopSelf();
        return START_NOT_STICKY;
      }
      startForegroundCompat();
      HodosSyncWorker.schedule(this);
      if (ACTION_START_TRIP.equals(action)) {
        if (!sampling) {
          lastMovementAt = System.currentTimeMillis();
          startTrip();
        }
      } else {
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
    getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("tripActive", true).apply();
    tripStartedAt = System.currentTimeMillis();
    synchronized (samples) { samples.clear(); }
    synchronized (motionCoverageTimes) { motionCoverageTimes.clear(); }
    synchronized (fixes) { fixes.clear(); }
    synchronized (impacts) { impacts.clear(); }
    updateNotification("Mapping your route");

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
            if (last != null) {
              // Transitions arrive only when motion class changes; GPS speed
              // keeps long journeys active between transitions.
              if (last.hasSpeed() && last.getSpeed() >= 2.5f) {
                lastMovementAt = System.currentTimeMillis();
              }
              synchronized (fixes) {
                fixes.add(new MotionDetector.Fix(
                    last.getTime(), last.getLatitude(), last.getLongitude(),
                    last.getAccuracy(), last.getSpeed(), last.hasSpeed()));
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
    if (device == null || trip == null) return;
    long cutoff = System.currentTimeMillis() - 30_000;
    List<MotionDetector.Sample> window = new ArrayList<>();
    synchronized (samples) {
      for (MotionDetector.Sample sample : samples) {
        if (sample.t >= cutoff) window.add(sample);
      }
    }
    // A stationary journey must end even when no more accelerometer samples
    // arrive (for example after screen-off sensor throttling).
    if (System.currentTimeMillis() - lastMovementAt > STOP_AFTER_STILL_MS) {
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
      persisted |= postEvent(device, trip, impact);
    }
    long now = System.currentTimeMillis();
    if (persisted && (lastSyncScheduledAt == 0 ||
        now - lastSyncScheduledAt >= 60_000L)) {
      lastSyncScheduledAt = now;
      // WorkManager retains the work across process death and network loss.
      HodosSyncWorker.schedule(this);
    }
    if (System.currentTimeMillis() - lastMovementAt > STOP_AFTER_STILL_MS) {
      endTrip();
    }
  }

  private synchronized void endTrip() {
    if (!sampling) {
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
    // foreground service. Previously, the just-finished trip only reached
    // SQLite on a detached thread, so Android could kill the process first.
    final String device = activeDeviceId;
    final String trip = activeTripId;
    if (device == null || trip == null) {
      updateNotification("Waiting for a journey");
      return;
    }
    for (MotionDetector.Impact impact : finished) {
      // Idempotent retry if the periodic detector could not persist earlier.
      postEvent(device, trip, impact);
    }
    updateNotification("Waiting for a journey");
    // WorkManager owns upload retries even if mapping is disabled, the device
    // loses connectivity, or Android reclaims this foreground service.
    HodosSyncWorker.schedule(this);
    // Local summaries and optional pass evidence remain on a worker thread.
    new Thread(() -> upload(finished, route, device, trip, coverage),
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
                      String device, String trip, List<Long> coverage) {
    // Observed impacts are ALREADY in the durable outbox. This worker must
    // never enqueue them twice. Its only responsibilities are local summary,
    // optional clear-road evidence and best-effort network synchronization.
    List<MotionDetector.Observed> observed = new ArrayList<>();
    for (MotionDetector.Impact impact : finished) {
      MotionDetector.Observed item = new MotionDetector.Observed();
      item.impact = impact;
      item.deviceId = device;
      observed.add(item);
    }
    List<MotionDetector.Hazard> hazards = MotionDetector.cluster(observed, System.currentTimeMillis());
    int confirmed = 0;
    for (MotionDetector.Hazard hazard : hazards) {
      if (hazard.published) {
        confirmed++;
      }
    }
    recordTrip(finished.size(), hazards.size(), confirmed, distanceMetres(route));
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
        postPass(device, trip, hazard);
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

  private boolean postPass(String device, String trip, MotionDetector.Hazard hazard) {
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
      return outbox.enqueue(UUID.randomUUID().toString(), data.toString());
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

  private void recordTrip(int impacts, int locations, int confirmed, double distanceM) {
    SharedPreferences prefs = getSharedPreferences("hodos", MODE_PRIVATE);
    try {
      JSONArray trips = new JSONArray(prefs.getString("autoTrips", "[]"));
      JSONObject trip = new JSONObject();
      trip.put("at", System.currentTimeMillis());
      trip.put("impacts", impacts);
      trip.put("locations", locations);
      trip.put("confirmed", confirmed);
      trip.put("distanceM", distanceM);
      trips.put(trip);
      JSONArray trimmed = new JSONArray();
      for (int i = Math.max(0, trips.length() - 50); i < trips.length(); i++) {
        trimmed.put(trips.get(i));
      }
      prefs.edit().putString("autoTrips", trimmed.toString()).apply();
    } catch (Exception ignored) {
      /* a failed log must not break the service */
    }
  }

  private boolean postEvent(String device, String trip, MotionDetector.Impact impact) {
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
      return outbox.enqueue(ObservationIds.impactRowId(trip, impact.t), data.toString());
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
