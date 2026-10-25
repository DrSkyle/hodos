package org.hodos.app

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.TimeUnit

data class RoadHazard(
    val id: String,
    val lat: Double,
    val lng: Double,
    val kind: String,
    val severity: Int,
    val passes: Int,
    val devices: Int,
    val confidence: Double,
    val clearPasses: Int,
    val fixed: Boolean,
    val lastSeen: String
) {
    val title: String get() = when (kind) {
        "speed_bump" -> "Speed bump"
        "rough_pavement" -> "Rough road"
        else -> "Pothole"
    }
    val severityText: String get() = when (severity) {
        3 -> "High"
        2 -> "Medium"
        else -> "Low"
    }
}

data class RoadTrip(
    val at: Long,
    val impacts: Int,
    val locations: Int,
    val confirmed: Int,
    val distanceM: Double,
    val gpsFixes: Int? = null
)

/**
 * Public hazard data comes from the server-side aggregation only. Device reports
 * are appended to events; clients NEVER modify a hazard row.
 *
 * The last successful response is cached so the map remains usable offline.
 */
class HazardRepository(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("hodos", Context.MODE_PRIVATE)
    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(18, TimeUnit.SECONDS)
        .build()

    private val base = "https://sgp.cloud.appwrite.io/v1"
    private val project = "6ad7939a002ff135e419"

    private fun request(url: String): Request.Builder = Request.Builder()
        .url(url)
        .header("X-Appwrite-Project", project)
        .header("Content-Type", "application/json")

    fun savedHazards(): List<RoadHazard> =
        decode(prefs.getString("hazards-cache-v1", null).orEmpty())

    suspend fun refreshHazards(): Result<List<RoadHazard>> = withContext(Dispatchers.IO) {
        runCatching {
            val query = JSONObject().put("method", "limit").put("values", JSONArray().put(500))
            val url = okhttp3.HttpUrl.Builder()
                .scheme("https").host("sgp.cloud.appwrite.io")
                .addPathSegments("v1/tablesdb/hodos/tables/hazards/rows")
                .addQueryParameter("queries[]", query.toString())
                .build().toString()
            client.newCall(request(url).get().build()).execute().use { response ->
                if (!response.isSuccessful) error("Map unavailable (HTTP ${response.code})")
                val raw = response.body?.string() ?: error("Empty map response")
                val hazards = decode(raw)
                prefs.edit().putString("hazards-cache-v1", raw).apply()
                hazards
            }
        }
    }

    private fun decode(raw: String): List<RoadHazard> = try {
        val rows = JSONObject(raw).optJSONArray("rows") ?: JSONArray()
        buildList {
            for (i in 0 until rows.length()) {
                val row = rows.optJSONObject(i) ?: continue
                if (!row.optBoolean("published")) continue
                add(RoadHazard(
                    id = row.optString(36.toChar().toString() + "id"),
                    lat = row.optDouble("lat"),
                    lng = row.optDouble("lng"),
                    kind = row.optString("kind", "pothole"),
                    severity = row.optInt("severity", 1),
                    passes = row.optInt("passCount"),
                    devices = row.optInt("deviceCount"),
                    confidence = row.optDouble("confidence"),
                    clearPasses = row.optInt("clearPasses"),
                    fixed = row.optInt("fixedVotes") >= 2 || row.optInt("clearPasses") >= 3,
                    lastSeen = row.optString("lastSeen")
                ))
            }
        }
    } catch (_: Exception) { emptyList() }

    fun savedTrips(): List<RoadTrip> = try {
        val rows = JSONArray(prefs.getString("autoTrips", "[]") ?: "[]")
        buildList {
            for (i in rows.length() - 1 downTo 0) {
                val row = rows.optJSONObject(i) ?: continue
                add(RoadTrip(
                    row.optLong("at"),
                    row.optInt("impacts"),
                    row.optInt("locations"),
                    row.optInt("confirmed"),
                    row.optDouble("distanceM"),
                    if (row.has("gpsFixes")) row.optInt("gpsFixes") else null
                ))
            }
        }
    } catch (_: Exception) { emptyList() }

    private fun installationId(): String {
        prefs.getString("deviceId", null)?.takeIf { it.isNotEmpty() }?.let { return it }
        val id = UUID.randomUUID().toString()
        check(prefs.edit().putString("deviceId", id).commit()) {
            "Could not persist installation ID"
        }
        return id
    }

    /**
     * Manual feedback is user testimony, NOT a phone-measured pothole impact.
     * Keep its evidence weight conservative until the schema can distinguish
     * explicit reports from sensor observations.
     */
    internal fun manualPayload(
        hazard: RoadHazard, repaired: Boolean, deviceId: String,
        timestamp: Date = Date()
    ): JSONObject {
        val date = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(timestamp)
        return JSONObject()
            .put("deviceId", deviceId)
            .put("tripId", UUID.randomUUID().toString())
            .put("recordedAt", date)
            .put("lat", hazard.lat)
            .put("lng", hazard.lng)
            // No GPS measurement was taken for this manual map selection.
            .put("accuracy", 100)
            .put("speedKph", 0)
            .put("magnitude", 0)
            .put("severity", hazard.severity)
            .put("kind", hazard.kind)
            .put("confidence", 0.35)
            // The legacy schema accepts only vehicle/pedestrian; not a sensor mode claim.
            .put("mode", "vehicle")
            .put("observation", if (repaired) "fix" else "impact")
            .put("hazardRef", hazard.id)
    }

    /** Persist first; network retries are owned by the OS and survive service shutdown. */
    internal fun persistManualObservation(hazard: RoadHazard, repaired: Boolean): String {
        val payload = manualPayload(hazard, repaired, installationId())
        val id = UUID.randomUUID().toString()
        EventOutbox(appContext).use { outbox ->
            check(outbox.enqueue(id, payload.toString())) {
                "Could not save report on this device"
            }
        }
        return id
    }

    suspend fun sendObservation(hazard: RoadHazard, repaired: Boolean): Result<Unit> =
        withContext(Dispatchers.IO) {
            runCatching {
                persistManualObservation(hazard, repaired)
                HodosSyncWorker.schedule(appContext)
                Unit
            }
        }

    suspend fun requestAggregation() = withContext(Dispatchers.IO) {
        runCatching {
            val url = "$base/functions/hodos-aggregate/executions"
            client.newCall(request(url).post(
                """{"async":true}""".toRequestBody("application/json".toMediaType())
            ).build()).execute().close()
        }
    }
}
