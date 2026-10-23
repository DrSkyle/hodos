package org.hodos.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.google.android.gms.location.ActivityTransition;
import com.google.android.gms.location.ActivityTransitionEvent;
import com.google.android.gms.location.ActivityTransitionResult;

/** Turns an activity transition into a signal to the mapping service. */
public class HodosActivityReceiver extends BroadcastReceiver {

  @Override
  public void onReceive(Context context, Intent intent) {
    if (!ActivityTransitionResult.hasResult(intent)) {
      return;
    }
    ActivityTransitionResult result = ActivityTransitionResult.extractResult(intent);
    if (result == null) {
      return;
    }
    for (ActivityTransitionEvent event : result.getTransitionEvents()) {
      if (event.getTransitionType() == ActivityTransition.ACTIVITY_TRANSITION_ENTER) {
        HodosService.onActivity(context, event.getActivityType());
      }
    }
  }
}
