package org.hodos.app

import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

data class PerkTier(
    val id: String,
    val label: String,
    val atKm: Int
)

data class PerkSummary(
    val monthlyKm: Double,
    val monthlyJourneys: Int,
    val unlocked: List<PerkTier>,
    val next: PerkTier?,
    val progress: Float,
    val code: String?,
    /** Live partner shops a rider can actually redeem at, from the backend. */
    val shops: List<String>
)

/**
 * Rider perks are earned by distance mapped in the current calendar month,
 * whatever the vehicle. A daily commuter on the same road earns the same as a
 * rider.
 *
 * The shop list is not invented: it is the live set of paid partner pins the
 * backend is currently serving. If no shop is listed in the user's area the app
 * says so rather than promising a redemption nobody has agreed to honour.
 */
object Perks {

    private val TIERS = listOf(
        PerkTier("tire_check", "Free tire pressure check", 20),
        PerkTier("chain_lube", "Free chain lube", 50),
        PerkTier("alignment", "Free alignment check", 100)
    )

    fun summarize(
        trips: List<RoadTrip>,
        nowMillis: Long,
        timeZone: TimeZone = TimeZone.getDefault(),
        seed: String = "",
        shops: List<String> = emptyList()
    ): PerkSummary {
        val calendar = Calendar.getInstance(timeZone)
        calendar.timeInMillis = nowMillis
        val year = calendar.get(Calendar.YEAR)
        val month = calendar.get(Calendar.MONTH)

        var meters = 0.0
        var journeys = 0
        for (trip in trips) {
            if (trip.at <= 0L || trip.at > nowMillis) continue
            calendar.timeInMillis = trip.at
            if (calendar.get(Calendar.YEAR) != year ||
                calendar.get(Calendar.MONTH) != month
            ) continue
            journeys++
            if (trip.distanceM.isFinite() && trip.distanceM > 0) {
                meters += trip.distanceM
            }
        }
        val km = meters / 1000.0

        val unlocked = TIERS.filter { km >= it.atKm }
        val next = TIERS.firstOrNull { km < it.atKm }
        val previousTarget = unlocked.lastOrNull()?.atKm ?: 0
        val target = next?.atKm ?: TIERS.last().atKm
        val progress = if (next == null) 1f else {
            ((km - previousTarget) / (target - previousTarget).toDouble())
                .coerceIn(0.0, 1.0).toFloat()
        }

        val code = if (unlocked.isEmpty()) null else {
            val monthKey = String.format(Locale.US, "%d-%02d", year, month + 1)
            val hash = (seed + monthKey).hashCode().toUInt().toString(16).uppercase(Locale.US)
            "HODOS-" + hash.takeLast(4) + "-" + km.toInt()
        }

        return PerkSummary(
            monthlyKm = km,
            monthlyJourneys = journeys,
            unlocked = unlocked,
            next = next,
            progress = progress,
            code = code,
            shops = shops.distinct().take(3)
        )
    }
}
