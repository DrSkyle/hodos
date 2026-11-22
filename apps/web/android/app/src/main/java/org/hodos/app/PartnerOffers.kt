package org.hodos.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

enum class ShopsFilterMode { ESSENTIALS, ALL, OFF }

enum class PartnerTier { ESSENTIAL, PITSTOP }

data class PartnerVisual(
    val iconId: String,
    val label: String,
    val colorInt: Int,
    val tier: PartnerTier
)

object PartnerVisuals {
    private val AUTO_RE = Regex("tyre|tire|garage|mechanic|auto|car|moto|bike|wash|tow|workshop|repair|service|parts", RegexOption.IGNORE_CASE)
    private val EV_RE = Regex("ev|charg|fuel|petrol|gas|battery", RegexOption.IGNORE_CASE)
    private val HEALTH_RE = Regex("pharm|med|clinic|hospital|health|first", RegexOption.IGNORE_CASE)
    private val FOOD_RE = Regex("cafe|coffee|tea|food|restaurant|biryani|bakery|snack|dhaba|eat|dining", RegexOption.IGNORE_CASE)
    private val PERK_RE = Regex("free|check|lube|air|pressure|alignment|perk|discount|complimentary", RegexOption.IGNORE_CASE)

    fun classify(category: String): PartnerVisual = when {
        AUTO_RE.containsMatchIn(category) -> PartnerVisual("shop-auto", "Auto & Tyre", 0xFF27272A.toInt(), PartnerTier.ESSENTIAL)
        EV_RE.containsMatchIn(category) -> PartnerVisual("shop-ev", "EV & Fuel", 0xFF0F766E.toInt(), PartnerTier.ESSENTIAL)
        HEALTH_RE.containsMatchIn(category) -> PartnerVisual("shop-health", "Pharmacy", 0xFF9D174D.toInt(), PartnerTier.ESSENTIAL)
        FOOD_RE.containsMatchIn(category) -> PartnerVisual("shop-food", "Food & Café", 0xFF6B4423.toInt(), PartnerTier.PITSTOP)
        else -> PartnerVisual("shop-local", "Local stop", 0xFF3F3F46.toInt(), PartnerTier.PITSTOP)
    }

    fun hasRiderPerk(offer: String): Boolean = PERK_RE.containsMatchIn(offer)

    fun selectForViewport(
        items: List<PartnerPoi>,
        mode: ShopsFilterMode,
        zoom: Double,
        centerLat: Double?,
        centerLng: Double?,
        south: Double? = null,
        north: Double? = null,
        west: Double? = null,
        east: Double? = null,
        maxInView: Int = 12
    ): List<PartnerPoi> {
        if (mode == ShopsFilterMode.OFF || items.isEmpty()) return emptyList()
        val eligible = items.filter { p ->
            when (mode) {
                ShopsFilterMode.ESSENTIALS -> classify(p.category).tier == PartnerTier.ESSENTIAL
                ShopsFilterMode.ALL -> true
                ShopsFilterMode.OFF -> false
            }
        }
        if (eligible.size <= maxInView) return eligible

        val cLat = centerLat ?: eligible.first().lat
        val cLng = centerLng ?: eligible.first().lng
        val hasBounds = south != null && north != null && west != null && east != null
        val inView = mutableListOf<PartnerPoi>()
        val outside = mutableListOf<PartnerPoi>()
        for (p in eligible) {
            if (!hasBounds || (p.lat in south!!..north!! && p.lng in west!!..east!!)) {
                inView.add(p)
            } else {
                outside.add(p)
            }
        }
        if (inView.size <= maxInView) return inView + outside.take(80)
        val ranked = inView.sortedByDescending { p ->
            val vis = classify(p.category)
            val tierScore = if (vis.tier == PartnerTier.ESSENTIAL) 200.0 else 0.0
            val perkScore = if (hasRiderPerk(p.offer)) 80.0 else 0.0
            val dist = kotlin.math.hypot(p.lat - cLat, p.lng - cLng)
            tierScore + perkScore - dist * 120.0
        }
        return ranked.take(maxInView) + outside.take(60)
    }
}

data class PartnerPoi(
    val id: String,
    val name: String,
    val category: String,
    val lat: Double,
    val lng: Double,
    val offer: String,
    val sponsorLabel: String,
    /** Aggregated unique drivers this month; null until the backend publishes it. */
    val passesThisMonth: Int? = null
)

/**
 * Partner placements are read from the backend `partners` table only. There is
 * no shipped sample feed: an empty table means no pins, never invented ones.
 * Monthly pass counts are merged from the anonymous partnerStats table.
 */
object PartnerOffers {
    private const val ENDPOINT = "https://sgp.cloud.appwrite.io/v1"
    private const val PROJECT_ID = "6ad7939a002ff135e419"
    private const val DATABASE_ID = "hodos"

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    suspend fun load(): List<PartnerPoi> = withContext(Dispatchers.IO) {
        loadSync()
    }

    /** Blocking variant for the end-of-journey pass counter worker thread. */
    fun loadSync(): List<PartnerPoi> {
        val base = runCatching { fetchFeed() }.getOrDefault(emptyList())
        if (base.isEmpty()) return base
        return runCatching { mergePublishedStats(base) }.getOrDefault(base)
    }

    private fun fetchFeed(): List<PartnerPoi> {
        val limit = URLEncoder.encode("""{"method":"limit","values":[100]}""", "UTF-8")
        val request = Request.Builder()
            .url("$ENDPOINT/tablesdb/$DATABASE_ID/tables/partners/rows?queries[]=$limit")
            .header("X-Appwrite-Project", PROJECT_ID)
            .header("User-Agent", "Hodos-Android")
            .build()
        val body = client.newCall(request).execute().use { res ->
            if (!res.isSuccessful) return emptyList()
            res.body?.string() ?: return emptyList()
        }
        return parseFeed(body)
    }

    private fun parseFeed(body: String): List<PartnerPoi> {
        val json = JSONObject(body)
        val array = json.optJSONArray("rows") ?: return emptyList()
        return buildList {
            for (i in 0 until array.length()) {
                val entry = array.optJSONObject(i) ?: continue
                val lat = entry.optDouble("lat", Double.NaN)
                val lng = entry.optDouble("lng", Double.NaN)
                val name = entry.optString("name")
                if (!lat.isFinite() || !lng.isFinite() || name.isBlank()) continue
                val resolvedId = entry.optString("\$id").ifBlank {
                    entry.optString("id", "partner-$i")
                }
                add(
                    PartnerPoi(
                        id = resolvedId,
                        name = name,
                        category = entry.optString("category", "pit-stop"),
                        lat = lat,
                        lng = lng,
                        offer = entry.optString("offer"),
                        sponsorLabel = entry.optString("sponsorLabel", "Local shop"),
                        passesThisMonth = if (entry.has("passesThisMonth")) {
                            entry.optInt("passesThisMonth").coerceAtLeast(0)
                        } else null
                    )
                )
            }
        }
    }

    private fun mergePublishedStats(partners: List<PartnerPoi>): List<PartnerPoi> {
        val month = SimpleDateFormat("yyyy-MM", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())
        val query = URLEncoder.encode(
            """{"method":"equal","attribute":"month","values":["$month"]}""",
            "UTF-8"
        )
        val limit = URLEncoder.encode("""{"method":"limit","values":[500]}""", "UTF-8")
        val url = "$ENDPOINT/tablesdb/$DATABASE_ID/tables/partnerStats/rows" +
            "?queries[]=$query&queries[]=$limit"
        val request = Request.Builder()
            .url(url)
            .header("X-Appwrite-Project", PROJECT_ID)
            .header("User-Agent", "Hodos-Android")
            .build()
        val body = client.newCall(request).execute().use { res ->
            if (!res.isSuccessful) return partners
            res.body?.string() ?: return partners
        }
        val rows = JSONObject(body).optJSONArray("rows") ?: return partners
        val counts = HashMap<String, Int>()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            val id = row.optString("partnerId")
            if (id.isBlank()) continue
            counts[id] = row.optInt("uniqueDevices", 0).coerceAtLeast(0)
        }
        if (counts.isEmpty()) return partners
        return partners.map { partner ->
            val published = counts[partner.id]
            if (published != null) partner.copy(passesThisMonth = published) else partner
        }
    }
}
