package org.hodos.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class GarageOffer(
    val id: String,
    val title: String,
    val brand: String?,
    val image: String?,
    val price: Double?,
    val compareAt: Double?,
    val currency: String,
    val merchant: String?,
    val url: String
)

/**
 * The Garage reads the catalogue through the `hodos-affiliate` function, never
 * directly: the catalogue key lives on the server. There is no bundled sample
 * shelf — an unreachable catalogue renders nothing rather than invented items.
 */
object Garage {
    const val INSTAGRAM_URL = "https://www.instagram.com/minerva__corporation/"
    const val SITE_URL = "https://hodos.devilabs.dev"

    val slots = listOf(
        GarageSlot("mounts", "Phone mounts"),
        GarageSlot("inflators", "Tire inflators"),
        GarageSlot("dashcams", "Dash cams"),
        GarageSlot("care", "Car care"),
        GarageSlot("lights", "Lights"),
        GarageSlot("chargers", "Chargers"),
        GarageSlot("gauges", "Gauges")
    )

    fun isNepal(): Boolean {
        val country = java.util.Locale.getDefault().country.uppercase()
        if (country == "NP") return true
        val tz = java.util.TimeZone.getDefault()
        if (tz.id.equals("Asia/Kathmandu", ignoreCase = true) ||
            tz.id.equals("Asia/Katmandu", ignoreCase = true) ||
            tz.rawOffset == 345 * 60 * 1000
        ) {
            return true
        }
        return false
    }

    private const val ENDPOINT = "https://sgp.cloud.appwrite.io/v1"
    private const val PROJECT_ID = "6ad7939a002ff135e419"
    private const val FUNCTION_ID = "hodos-affiliate"

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    /** Runs the function and returns the JSON body it responded with. */
    private fun execute(payload: JSONObject): JSONObject {
        val body = JSONObject()
            .put("body", payload.toString())
            .put("method", "POST")
            .put("path", "/")
            .put("headers", JSONObject().put("content-type", "application/json"))
            .toString()
        val request = Request.Builder()
            .url("$ENDPOINT/functions/$FUNCTION_ID/executions")
            .header("X-Appwrite-Project", PROJECT_ID)
            .header("User-Agent", "Hodos-Android")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        return client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("HTTP ${response.code}")
            val raw = response.body?.string() ?: error("empty response")
            val inner = JSONObject(raw).optString("responseBody")
            if (inner.isBlank()) error("empty result")
            JSONObject(inner)
        }
    }

    suspend fun load(slot: String): Result<List<GarageOffer>> = withContext(Dispatchers.IO) {
        runCatching {
            if (isNepal()) {
                return@runCatching loadNepalShops()
            }
            val request = Request.Builder()
                .url("$SITE_URL/data/products.json")
                .header("User-Agent", "Hodos-Android")
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) error("HTTP ${response.code}")
                val raw = response.body?.string() ?: error("empty response")
                val root = JSONObject(raw)
                val cats = root.optJSONArray("categories") ?: return@use emptyList()
                buildList {
                    for (c in 0 until cats.length()) {
                        val cat = cats.optJSONObject(c) ?: continue
                        val key = cat.optString("key")
                        if (slot.isNotBlank() && key != slot) continue
                        val shelfName = cat.optString("shelf", key)
                        val rows = cat.optJSONArray("products") ?: continue
                        for (i in 0 until rows.length()) {
                            val row = rows.optJSONObject(i) ?: continue
                            val url = row.optString("url")
                            val title = row.optString("title")
                            if (url.isBlank() || title.isBlank()) continue
                            val sold = row.optInt("sold", 0)
                            val soldLabel = when {
                                sold >= 10000 -> "10k+ bought"
                                sold >= 1000 -> "${sold / 1000}k bought"
                                sold > 0 -> "$sold bought"
                                else -> null
                            }
                            add(
                                GarageOffer(
                                    id = row.optString("id", "offer-$c-$i"),
                                    title = title,
                                    brand = shelfName.ifBlank { null },
                                    image = row.optString("image").ifBlank { null },
                                    price = if (row.isNull("price")) null else row.optDouble("price"),
                                    compareAt = null,
                                    currency = row.optString("currency", "USD").ifBlank { "USD" },
                                    merchant = soldLabel,
                                    url = url
                                )
                            )
                        }
                    }
                }
            }
        }
    }

    private fun loadNepalShops(): List<GarageOffer> {
        val query = java.net.URLEncoder.encode("""{"method":"limit","values":[500]}""", "UTF-8")
        val request = Request.Builder()
            .url("$ENDPOINT/tablesdb/hodos/tables/partners/rows?queries[]=$query")
            .header("X-Appwrite-Project", PROJECT_ID)
            .header("User-Agent", "Hodos-Android")
            .build()
        return client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("HTTP ${response.code}")
            val raw = response.body?.string() ?: error("empty response")
            val rows = JSONObject(raw).optJSONArray("rows") ?: return@use emptyList()
            val now = System.currentTimeMillis()
            buildList {
                for (i in 0 until rows.length()) {
                    val row = rows.optJSONObject(i) ?: continue
                    val name = row.optString("name").trim()
                    if (name.isBlank()) continue
                    val until = row.optString("activeUntil")
                    val expired = runCatching {
                        java.time.Instant.parse(until).toEpochMilli() < now
                    }.getOrDefault(false)
                    if (expired) continue
                    val link = row.optString("link").trim()
                    val phone = row.optString("phone").trim()
                    val email = row.optString("email").trim()
                    val url = when {
                        link.isNotEmpty() -> link
                        phone.isNotEmpty() -> "tel:$phone"
                        email.isNotEmpty() -> "mailto:$email"
                        else -> "$SITE_URL/map"
                    }
                    add(
                        GarageOffer(
                            id = row.optString("\$id", "shop-$i"),
                            title = name,
                            brand = PartnerVisuals.normalizeCategory(row.optString("category")),
                            image = null,
                            price = null,
                            compareAt = null,
                            currency = "NPR",
                            merchant = PartnerVisuals.formatOffer(row.optString("offer"))
                                .ifBlank { row.optString("address").ifBlank { null } },
                            url = url
                        )
                    )
                }
            }
        }
    }

    suspend fun subscribe(email: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val json = execute(
                JSONObject()
                    .put("action", "subscribe")
                    .put("email", email.trim())
                    .put("source", "android-garage")
            )
            if (!json.optBoolean("ok")) error(json.optString("error", "could not save"))
        }
    }

    /** Product thumbnails are fetched on demand; the URL is never stored. */
    suspend fun loadImage(url: String): android.graphics.Bitmap? = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "Hodos-Android")
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use null
                response.body?.byteStream()?.let(android.graphics.BitmapFactory::decodeStream)
            }
        }.getOrNull()
    }
}

data class GarageSlot(val id: String, val label: String)
