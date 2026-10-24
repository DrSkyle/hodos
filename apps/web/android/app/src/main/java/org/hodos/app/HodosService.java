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
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
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

  private ScheduledExecutorService scheduler;
  private volatile boolean sampling = false;
  private volatile long lastMovementAt = 0;
  private long tripStartedAt = 0;

  @Override
  public void onCreate() {
    super.onCreate();
    sensors = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
    locationClient = LocationServices.getFusedLocationProviderClient(this);
    createChannel();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? null : intent.getAction();
    if (ACTION_DISABLE.equals(action)) {
      // Finish and persist an active journey before tearing down the service.
      // Previously, switching mapping off silently discarded collected impacts.
      endTrip();
      stopEverything();
      stopForeground(true);
      stopSelf();
      return START_NOT_STICKY;
    }

    if ("org.hodos.app.ACTIVITY".equals(action)) {
      startForegroundCompat();
      int activityType = intent.getIntExtra("activity", -1);
      if (activityType >= 0) {
        handleActivity(activityType);
      }
      return START_STICKY;
    }

    startForegroundCompat();
    registerActivityTransitions();
    lastMovementAt = System.currentTimeMillis();
    return START_STICKY;
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
        .setSmallIcon(android.R.drawable.ic_menu_mylocation)
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

  private void startTrip() {
    if (!hasLocationPermission()) {
      updateNotification("Location permission needed");
      return;
    }
    sampling = true;
    tripStartedAt = System.currentTimeMillis();
    synchronized (samples) { samples.clear(); }
    synchronized (fixes) { fixes.clear(); }
    synchronized (impacts) { impacts.clear(); }
    updateNotification("Mapping your route");

    Sensor accelerometer = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
    if (accelerometer != null) {
      sensors.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME);
    }

    LocationRequest request =
        new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2000).build();
    locationCallback =
        new LocationCallback() {
          @Override
          public void onLocationResult(LocationResult result) {
            Location last = result.getLastLocation();
            if (last != null) {
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
    synchronized (impacts) {
      for (MotionDetector.Impact impact : found) {
        boolean duplicate = false;
        for (MotionDetector.Impact seen : impacts) {
          if (Math.abs(seen.t - impact.t) < 500) {
            duplicate = true;
            break;
          }
        }
        if (!duplicate) impacts.add(impact);
      }
    }
    if (System.currentTimeMillis() - lastMovementAt > STOP_AFTER_STILL_MS) {
      endTrip();
    }
  }

  private void endTrip() {
    if (!sampling) {
      return;
    }
    sampling = false;
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
    synchronized (impacts) { finished = new ArrayList<>(impacts); }
    synchronized (fixes) { route = new ArrayList<>(fixes); }
    updateNotification("Waiting for a journey");
    new Thread(() -> upload(finished, route)).start();
  }

  private void stopEverything() {
    sampling = false;
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
    getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("armed", false).apply();
  }

  @Override
  public void onSensorChanged(SensorEvent event) {
    if (!sampling) {
      return;
    }
    synchronized (samples) {
      samples.add(new MotionDetector.Sample(
          System.currentTimeMillis(), event.values[0], event.values[1], event.values[2]));
      if (samples.size() > 6000) samples.subList(0, 3000).clear();
    }
  }

  @Override
  public void onAccuracyChanged(Sensor sensor, int accuracy) {
    /* not used */
  }

  private String deviceId() {
    SharedPreferences prefs = getSharedPreferences("hodos", MODE_PRIVATE);
    long now = System.currentTimeMillis();
    long issued = prefs.getLong("deviceIssuedAt", 0);
    String id = prefs.getString("deviceId", null);
    if (id == null || now - issued > 86_400_000L) {
      id = UUID.randomUUID().toString();
      prefs.edit().putString("deviceId", id).putLong("deviceIssuedAt", now).apply();
    }
    return id;
  }

  private void upload(List<MotionDetector.Impact> finished, List<MotionDetector.Fix> route) {
    // Even a smooth trip can supply valuable negative evidence for a hazard.
    // Do not skip pass observations just because the motion detector found
    // no new impacts on this particular journey.
    String device = deviceId();
    String trip = UUID.randomUUID().toString();
    int logged = 0;
    for (MotionDetector.Impact impact : finished) {
      if (postEvent(device, trip, impact)) {
        logged++;
      }
    }
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
    recordTrip(finished.size(), hazards.size(), confirmed);
    updateNotification("Waiting for a journey");

    List<MotionDetector.Hazard> known = fetchPublishedHazards();
    List<MotionDetector.Hazard> cleared = MotionDetector.passedHazards(route, known, finished);
    for (MotionDetector.Hazard hazard : cleared) {
      postPass(device, trip, hazard);
    }
    if (logged > 0 || !cleared.isEmpty()) {
      triggerAggregation();
    }
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
      JSONObject body = new JSONObject();
      body.put("rowId", "unique()");
      body.put("data", data);
      return send("POST", "tables/events/rows", body) < 400;
    } catch (Exception error) {
      return false;
    }
  }

  private void recordTrip(int impacts, int locations, int confirmed) {
    SharedPreferences prefs = getSharedPreferences("hodos", MODE_PRIVATE);
    try {
      JSONArray trips = new JSONArray(prefs.getString("autoTrips", "[]"));
      JSONObject trip = new JSONObject();
      trip.put("at", System.currentTimeMillis());
      trip.put("impacts", impacts);
      trip.put("locations", locations);
      trip.put("confirmed", confirmed);
      trip.put("distanceM", 0);
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
      JSONObject body = new JSONObject();
      body.put("rowId", "unique()");
      body.put("data", data);
      return send("POST", "tables/events/rows", body) < 400;
    } catch (Exception error) {
      return false;
    }
  }

  /** Ask the server-side writer to recompute the map after a background trip. */
  private void triggerAggregation() {
    HttpURLConnection connection = null;
    try {
      connection = (HttpURLConnection)
          new URL(ENDPOINT + "/functions/hodos-aggregate/executions").openConnection();
      connection.setRequestMethod("POST");
      connection.setRequestProperty("X-Appwrite-Project", PROJECT_ID);
      connection.setRequestProperty("Content-Type", "application/json");
      connection.setConnectTimeout(10_000);
      connection.setReadTimeout(15_000);
      connection.setDoOutput(true);
      try (OutputStream out = connection.getOutputStream()) {
        out.write("{\"async\":true}".getBytes(StandardCharsets.UTF_8));
      }
      connection.getResponseCode();
    } catch (Exception ignored) {
      /* The scheduled aggregation will catch up if this request fails. */
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  private void mergeHazard(MotionDetector.Hazard hazard) {
    try {
      String rowId = rowIdFor(hazard.lat, hazard.lng);
      JSONObject data = new JSONObject();
      data.put("hazardId", hazard.id);
      data.put("lat", hazard.lat);
      data.put("lng", hazard.lng);
      data.put("kind", hazard.kind);
      data.put("severity", hazard.severity);
      data.put("passCount", hazard.passCount);
      data.put("deviceCount", hazard.deviceCount);
      data.put("dayCount", hazard.dayCount);
      data.put("confidence", hazard.confidence);
      data.put("firstSeen", isoTime(hazard.firstSeen));
      data.put("lastSeen", isoTime(hazard.lastSeen));
      data.put("published", hazard.published);
      data.put("fixedVotes", 0);

      HttpURLConnection head = open("GET", "tables/hazards/rows/" + rowId);
      if (head != null && head.getResponseCode() == 200) {
        head.disconnect();
        JSONObject body = new JSONObject();
        body.put("data", data);
        send("PATCH", "tables/hazards/rows/" + rowId, body);
        return;
      }
      if (head != null) {
        head.disconnect();
      }
      JSONObject body = new JSONObject();
      body.put("rowId", rowId);
      body.put("data", data);
      send("POST", "tables/hazards/rows", body);
    } catch (Exception ignored) {
      /* merge is best effort */
    }
  }

  private String rowIdFor(double lat, double lng) {
    return String.format(
        java.util.Locale.US,
        "%s%.4f%s%.4f",
        lat < 0 ? "s" : "n",
        Math.abs(lat),
        lng < 0 ? "w" : "e",
        Math.abs(lng));
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

  private int send(String method, String path, JSONObject body) {
    HttpURLConnection connection = open(method, path);
    if (connection == null) {
      return 500;
    }
    try {
      connection.setDoOutput(true);
      byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
      try (OutputStream out = connection.getOutputStream()) {
        out.write(payload);
      }
      int code = connection.getResponseCode();
      InputStream stream =
          code < 400 ? connection.getInputStream() : connection.getErrorStream();
      if (stream != null) {
        try (BufferedReader reader =
            new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
          while (reader.readLine() != null) {
            /* drain */
          }
        }
      }
      return code;
    } catch (Exception error) {
      return 500;
    } finally {
      connection.disconnect();
    }
  }
}
