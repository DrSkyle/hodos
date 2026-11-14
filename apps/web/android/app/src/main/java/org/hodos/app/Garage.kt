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
 * directly: the Channel3 key lives on the server, and the offer URLs that come
 * back are already affiliate-tracked. There is no bundled sample shelf — an
 * unreachable catalogue renders nothing rather than invented products.
 */
object Garage {
    const val INSTAGRAM_URL = "https://www.instagram.com/minerva__corporation/"

    val slots = listOf(
        GarageSlot("inflator", "Tire inflator"),
        GarageSlot("mount", "Phone mount"),
        GarageSlot("dashcam", "Dash cam"),
        GarageSlot("pressure", "Pressure gauge"),
        GarageSlot("care", "Wash kit"),
        GarageSlot("wipers", "Wipers"),
        GarageSlot("tires", "Tires"),
        GarageSlot("light", "Lights")
    )

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
            val json = execute(JSONObject().put("action", "offers").put("slot", slot))
            if (!json.optBoolean("ok")) error(json.optString("error", "catalogue unavailable"))
            val rows = json.optJSONArray("products") ?: return@runCatching emptyList()
            buildList {
                for (i in 0 until rows.length()) {
                    val row = rows.optJSONObject(i) ?: continue
                    val url = row.optString("url")
                    val title = row.optString("title")
                    if (url.isBlank() || title.isBlank()) continue
                    add(
                        GarageOffer(
                            id = row.optString("id", "offer-$i"),
                            title = title,
                            brand = row.optString("brand").ifBlank { null },
                            image = row.optString("image").ifBlank { null },
                            price = if (row.isNull("price")) null else row.optDouble("price"),
                            compareAt = if (row.isNull("compareAt")) null else row.optDouble("compareAt"),
                            currency = row.optString("currency", "USD").ifBlank { "USD" },
                            merchant = row.optString("merchant").ifBlank { null },
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
