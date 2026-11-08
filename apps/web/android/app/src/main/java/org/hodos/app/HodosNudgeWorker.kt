package org.hodos.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * One quiet daily nudge, only when it is actually useful: a streak about to
 * break, a perk within reach, or a week with no mapped road. No marketing spam.
 */
class HodosNudgeWorker(context: Context, params: WorkerParameters) :
    Worker(context, params) {

    override fun doWork(): Result {
        val context = applicationContext
        val prefs = context.getSharedPreferences("hodos", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("armed", false)) return Result.success()
        if (!canNotify(context)) return Result.success()

        val trips = readTrips(prefs)
        if (trips.isEmpty()) return Result.success()

        val now = System.currentTimeMillis()
        val streak = RideInsights.dayStreak(trips, now)
        val summary = summarizeRoadDiary(trips, now)
        val perks = Perks.summarize(
            trips,
            now,
            TimeZone.getDefault(),
            prefs.getString("deviceId", "").orEmpty()
        )
        val mappedToday = trips.any { sameDay(it.at, now) }

        val message = when {
            streak >= 2 && !mappedToday ->
                "Your $streak-day streak is about to break" to
                    "One short ride today keeps it alive and adds to your perks."
            perks.next != null && perks.next.atKm - perks.monthlyKm <= 5 ->
                "You're close to a free perk" to String.format(
                    Locale.US, "%.1f km to %s at a labeled partner shop.",
                    (perks.next.atKm - perks.monthlyKm).coerceAtLeast(0.0),
                    perks.next.label
                )
            summary.journeysThisWeek == 0 ->
                "No rides mapped this week" to
                    "A normal commute is enough. Your road score and perks are waiting."
            else -> return Result.success()
        }

        createChannel(context)
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: return Result.success()
        val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val content = PendingIntent.getActivity(context, 0, open, pendingFlags)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.hodos_notification)
            .setContentTitle(message.first)
            .setContentText(message.second)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message.second))
            .setContentIntent(content)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            return Result.success()
        }
        return Result.success()
    }

    private fun canNotify(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    private fun sameDay(a: Long, b: Long): Boolean {
        val calendar = Calendar.getInstance()
        calendar.timeInMillis = a
        val ay = calendar.get(Calendar.YEAR)
        val ad = calendar.get(Calendar.DAY_OF_YEAR)
        calendar.timeInMillis = b
        return ay == calendar.get(Calendar.YEAR) && ad == calendar.get(Calendar.DAY_OF_YEAR)
    }

    private fun readTrips(prefs: android.content.SharedPreferences): List<RoadTrip> = try {
        val rows = JSONArray(prefs.getString("autoTrips", "[]") ?: "[]")
        buildList {
            for (i in 0 until rows.length()) {
                val row = rows.optJSONObject(i) ?: continue
                add(
                    RoadTrip(
                        row.optLong("at"),
                        row.optInt("impacts"),
                        row.optInt("locations"),
                        row.optInt("confirmed"),
                        row.optDouble("distanceM"),
                        if (row.has("gpsFixes")) row.optInt("gpsFixes") else null,
                        if (row.has("durationS")) row.optLong("durationS") else null,
                        if (row.has("tripId")) row.optString("tripId") else null
                    )
                )
            }
        }
    } catch (_: Exception) {
        emptyList()
    }

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Roadkeeper nudges",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Streaks, perks and weekly road summaries. No ads."
            }
        )
    }

    companion object {
        private const val CHANNEL_ID = "hodos.nudges"
        private const val NOTIFICATION_ID = 9001
        private const val UNIQUE_NAME = "hodos-daily-nudge"

        @JvmStatic
        fun schedule(context: Context) {
            val request = PeriodicWorkRequest.Builder(
                HodosNudgeWorker::class.java, 1, TimeUnit.DAYS
            )
                .setInitialDelay(8, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder().setRequiresBatteryNotLow(true).build()
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }
    }
}
