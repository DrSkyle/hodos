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

  /** Remove only local summary history; pending upload evidence is untouched. */
  static synchronized boolean clear(SharedPreferences prefs) {
    return prefs != null && prefs.edit().remove("autoTrips").commit();
  }

  static synchronized boolean record(
      SharedPreferences prefs, long timestamp, int impacts, int gpsFixes, double distanceM) {
    return record(prefs, timestamp, impacts, gpsFixes, distanceM, 0L, null);
  }

  static synchronized boolean record(
      SharedPreferences prefs, long timestamp, int impacts, int gpsFixes, double distanceM,
      long durationS, String tripId) {
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
      if (durationS > 0) {
        item.put("durationS", durationS);
      }
      if (tripId != null && !tripId.isEmpty()) {
        item.put("tripId", tripId);
      }
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

  /**
   * Update the active in-progress trip summary or append if not present.
   * Ensures that real-time journey progress is durably saved to disk periodically,
   * so an abrupt process termination or power loss cannot wipe hours of mapped road data.
   */
  static synchronized boolean recordOrUpdate(
      SharedPreferences prefs, String tripId, long timestamp, int impacts, int gpsFixes,
      double distanceM, long durationS) {
    if (prefs == null || timestamp <= 0 || impacts < 0 || gpsFixes < 0 ||
        !Double.isFinite(distanceM) || distanceM < 0) {
      return false;
    }
    try {
      String prior = prefs.getString("autoTrips", "[]");
      JSONArray trips = new JSONArray(prior == null ? "[]" : prior);
      boolean updated = false;
      if (tripId != null && !tripId.isEmpty() && trips.length() > 0) {
        JSONObject last = trips.getJSONObject(trips.length() - 1);
        if (tripId.equals(last.optString("tripId", null)) ||
            (last.optLong("at", 0) == timestamp)) {
          last.put("impacts", impacts);
          last.put("gpsFixes", gpsFixes);
          last.put("distanceM", Math.round(distanceM));
          if (durationS > 0) {
            last.put("durationS", durationS);
          }
          if (!last.has("tripId")) {
            last.put("tripId", tripId);
          }
          updated = true;
        }
      }
      if (!updated) {
        return record(prefs, timestamp, impacts, gpsFixes, distanceM, durationS, tripId);
      }
      return prefs.edit().putString("autoTrips", trips.toString()).commit();
    } catch (Exception error) {
      return false;
    }
  }
}
