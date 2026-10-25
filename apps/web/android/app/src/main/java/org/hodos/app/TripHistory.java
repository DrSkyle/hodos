package org.hodos.app;

import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Bounded, app-private journey summaries. No route traces, GPS coordinates,
 * accelerometer samples, or device identifiers are stored in this history.
 */
final class TripHistory {
  private static final int MAX_TRIPS = 50;
  private TripHistory() {}

  static synchronized boolean record(
      SharedPreferences prefs, long timestamp, int impacts, int gpsFixes, double distanceM) {
    if (prefs == null || timestamp <= 0 || impacts < 0 || gpsFixes < 0 ||
        !Double.isFinite(distanceM) || distanceM < 0) {
      return false;
    }
    try {
      String prior = prefs.getString("autoTrips", "[]");
      JSONArray trips = new JSONArray(prior == null ? "[]" : prior);
      JSONObject item = new JSONObject();
      item.put("at", timestamp);
      item.put("impacts", impacts);
      item.put("gpsFixes", gpsFixes);
      // Retain legacy fields for older app installations reading this data.
      item.put("locations", 0);
      item.put("confirmed", 0);
      item.put("distanceM", Math.round(distanceM));
      trips.put(item);
      JSONArray limited = new JSONArray();
      for (int i = Math.max(0, trips.length() - MAX_TRIPS); i < trips.length(); i++) {
        limited.put(trips.get(i));
      }
      // Durable before Android is allowed to reclaim the foreground service.
      return prefs.edit().putString("autoTrips", limited.toString()).commit();
    } catch (Exception error) {
      // A corrupt previous history must never be silently overwritten.
      return false;
    }
  }
}
