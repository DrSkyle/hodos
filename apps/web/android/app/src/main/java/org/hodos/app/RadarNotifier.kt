package org.hodos.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.util.Collections
import kotlin.math.roundToInt

/**
 * Fires timely local proximity notifications when an active momentary Live Road
 * Radar alert (police check, traffic jam, roadblock/landslide, or flooded road)
 * is within 2.5 km of the driver's current position.
 *
 * Each alert ID is notified at most once per app process so drivers are alerted
 * ahead of time without ever being spammed.
 */
object RadarNotifier {
    private const val CHANNEL_ID = "hodos_live_radar"
    private const val NOTIFY_RADIUS_M = 2_500f
    private val notifiedIds: MutableSet<String> = Collections.synchronizedSet(HashSet())

    fun notifyNearby(context: Context, alerts: List<RoadHazard>, userLocation: Location?) {
        if (userLocation == null || alerts.isEmpty()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        ensureChannel(manager)

        val nearby = alerts
            .asSequence()
            .filter { it.isLiveAlert && !it.fixed }
            .map { alert ->
                val dist = FloatArray(1)
                Location.distanceBetween(
                    userLocation.latitude, userLocation.longitude,
                    alert.lat, alert.lng, dist
                )
                alert to dist[0]
            }
            .filter { (alert, meters) -> meters <= NOTIFY_RADIUS_M && notifiedIds.add(alert.id) }
            .sortedBy { it.second }
            .firstOrNull() ?: return

        val (alert, meters) = nearby
        val distLabel = if (meters < 1000f) "${meters.roundToInt()} m away"
        else String.format("%.1f km away", meters / 1000f)

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            context,
            alert.id.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("${alert.title} nearby")
            .setContentText("$distLabel · Reported live by drivers")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        runCatching {
            manager.notify(4200 + (alert.id.hashCode() and 0x7FFF), notification)
        }
    }

    private fun ensureChannel(manager: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Live road radar",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Alerts for nearby police checks, jams, roadblocks and flooded roads"
        }
        manager.createNotificationChannel(channel)
    }
}
