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

data class PartnerPoi(
    val id: String,
    val name: String,
    val category: String,
    val lat: Double,
    val lng: Double,
    val offer: String,
    val sponsorLabel: String,
    val sample: Boolean,
    /** Aggregated unique drivers this month; null until the backend publishes it. */
    val passesThisMonth: Int? = null
)

/**
 * Partner shop placements ship as a static JSON file on the website, so
 * sponsor changes deploy like web content and never cost database reads.
 * Monthly pass counts are merged from the anonymous partnerStats table when the
 * backend is deployed; if it is not there yet the static feed still works.
 */
object PartnerOffers {
    private const val FEED_URL = "https://hodos.devilabs.dev/data/partners.json"
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
        val request = Request.Builder()
            .url(FEED_URL)
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
        val array = json.optJSONArray("partners") ?: return emptyList()
        return buildList {
            for (i in 0 until array.length()) {
                val entry = array.optJSONObject(i) ?: continue
                val lat = entry.optDouble("lat", Double.NaN)
                val lng = entry.optDouble("lng", Double.NaN)
                val name = entry.optString("name")
                if (!lat.isFinite() || !lng.isFinite() || name.isBlank()) continue
                add(
                    PartnerPoi(
                        id = entry.optString("id", "partner-$i"),
                        name = name,
                        category = entry.optString("category", "pit-stop"),
                        lat = lat,
                        lng = lng,
                        offer = entry.optString("offer"),
                        sponsorLabel = entry.optString("sponsorLabel", "Sponsored"),
                        sample = entry.optBoolean("sample", false),
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
