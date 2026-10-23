package org.hodos.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

/**
 * Bridges the web app to the always-on mapping service: arming and disarming it,
 * and reading back the journeys it recorded on its own.
 */
@CapacitorPlugin(
    name = "Hodos",
    permissions = {
      @Permission(
          strings = {Manifest.permission.ACTIVITY_RECOGNITION},
          alias = "activity"),
      @Permission(
          strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_BACKGROUND_LOCATION},
          alias = "location"),
      @Permission(
          strings = {Manifest.permission.POST_NOTIFICATIONS},
          alias = "notifications")
    })
public class HodosPlugin extends Plugin {

  private SharedPreferences prefs() {
    return getContext().getSharedPreferences("hodos", Context.MODE_PRIVATE);
  }

  @PluginMethod
  public void isEnabled(PluginCall call) {
    JSObject result = new JSObject();
    result.put("enabled", prefs().getBoolean("armed", false));
    call.resolve(result);
  }

  @PluginMethod
  public void enable(PluginCall call) {
    requestPermissionForAliases(
        new String[] {"activity", "location", "notifications"}, call, "armedCallback");
  }

  @PermissionCallback
  private void armedCallback(PluginCall call) {
    boolean locationGranted =
        getPermissionState("location") == PermissionState.GRANTED;
    if (!locationGranted) {
      call.reject("Location permission is required for automatic mapping.");
      return;
    }
    startService(HodosService.ACTION_ENABLE);
    JSObject result = new JSObject();
    result.put("enabled", true);
    call.resolve(result);
  }

  @PluginMethod
  public void disable(PluginCall call) {
    startService(HodosService.ACTION_DISABLE);
    prefs().edit().putBoolean("armed", false).apply();
    JSObject result = new JSObject();
    result.put("enabled", false);
    call.resolve(result);
  }

  /** Journeys the service recorded without the app being open. */
  @PluginMethod
  public void autoTrips(PluginCall call) {
    JSObject result = new JSObject();
    try {
      JSArray trips = new JSArray(prefs().getString("autoTrips", "[]"));
      result.put("trips", trips);
    } catch (Exception error) {
      result.put("trips", new JSArray());
    }
    call.resolve(result);
  }

  @PluginMethod
  public void clearAutoTrips(PluginCall call) {
    prefs().edit().putString("autoTrips", new JSONArray().toString()).apply();
    call.resolve();
  }

  private void startService(String action) {
    Context context = getContext();
    Intent intent = new Intent(context, HodosService.class);
    intent.setAction(action);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent);
    } else {
      context.startService(intent);
    }
  }
}
