package org.hodos.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class PartnerPoi(
    val id: String,
    val name: String,
    val category: String,
    val lat: Double,
    val lng: Double,
    val offer: String,
    val sponsorLabel: String,
    val sample: Boolean
)

/**
 * Sponsored Pit-Stop placements ship as a static JSON file on the website, so
 * sponsor changes deploy like web content and never cost database reads.
 */
object PartnerOffers {
    private const val FEED_URL = "https://hodos.devilabs.dev/data/partners.json"

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    suspend fun load(): List<PartnerPoi> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url(FEED_URL)
                .header("User-Agent", "Hodos-Android")
                .build()
            client.newCall(request).execute().use { res ->
                if (!res.isSuccessful) return@runCatching emptyList()
                val json = JSONObject(res.body?.string() ?: return@runCatching emptyList())
                val array = json.optJSONArray("partners") ?: return@runCatching emptyList()
                buildList {
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
                                sample = entry.optBoolean("sample", false)
                            )
                        )
                    }
                }
            }
        }.getOrDefault(emptyList())
    }
}
