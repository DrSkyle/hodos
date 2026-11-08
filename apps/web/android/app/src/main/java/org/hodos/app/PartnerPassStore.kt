package org.hodos.app

import android.content.Context
import org.json.JSONObject
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Counts how often this phone travels past a labeled partner shop, per month.
 *
 * Nothing is uploaded: the count is computed from fixes already on the device
 * and stored locally, so a garage can be shown real footfall without anyone
 * being identified. Aggregate "N drivers" figures come from operator-published
 * partner stats, never from personal location.
 */
object PartnerPassStore {
    private const val PREFS_KEY = "partnerPasses"
    private const val PASS_RADIUS_M = 150.0
    private const val MIN_TRIP_M = 300.0
    private const val ENDPOINT = "https://sgp.cloud.appwrite.io/v1"
    private const val PROJECT_ID = "6ad7939a002ff135e419"
    private const val UPLOAD_BACKOFF_KEY = "partnerStatsUnavailableUntil"
    private const val UPLOAD_BACKOFF_MS = 7L * 24 * 60 * 60 * 1000

    fun recordTripPasses(
        context: Context,
        distanceM: Double,
        fixes: List<MotionDetector.Fix>,
        partners: List<PartnerPoi>
    ) {
        if (fixes.size < 2 || partners.isEmpty() || distanceM < MIN_TRIP_M) return
        val prefs = context.getSharedPreferences("hodos", Context.MODE_PRIVATE)
        val root = runCatching {
            JSONObject(prefs.getString(PREFS_KEY, "{}") ?: "{}")
        }.getOrElse { JSONObject() }
        val month = monthKey(System.currentTimeMillis())
        var changed = false
        for (partner in partners) {
            if (!travelledPast(partner.lat, partner.lng, fixes)) continue
            val entry = root.optJSONObject(partner.id) ?: JSONObject()
            val count = if (entry.optString("month") == month) entry.optInt("count", 0) else 0
            entry.put("month", month)
            entry.put("count", count + 1)
            entry.put("last", System.currentTimeMillis())
            root.put(partner.id, entry)
            changed = true
        }
        if (changed) {
            prefs.edit().putString(PREFS_KEY, root.toString()).apply()
        }
    }

    fun monthCount(context: Context, partnerId: String): Int {
        val prefs = context.getSharedPreferences("hodos", Context.MODE_PRIVATE)
        val root = runCatching {
            JSONObject(prefs.getString(PREFS_KEY, "{}") ?: "{}")
        }.getOrElse { JSONObject() }
        val entry = root.optJSONObject(partnerId) ?: return 0
        if (entry.optString("month") != monthKey(System.currentTimeMillis())) return 0
        return entry.optInt("count", 0).coerceAtLeast(0)
    }

    fun totalThisMonth(context: Context): Int {
        val prefs = context.getSharedPreferences("hodos", Context.MODE_PRIVATE)
        val root = runCatching {
            JSONObject(prefs.getString(PREFS_KEY, "{}") ?: "{}")
        }.getOrElse { JSONObject() }
        val month = monthKey(System.currentTimeMillis())
        var total = 0
        for (id in root.keys()) {
            val entry = root.optJSONObject(id) ?: continue
            if (entry.optString("month") == month) {
                total += entry.optInt("count", 0)
            }
        }
        return total
    }

    /**
     * Upload one blinded token per passed shop for the current month. The token
     * is salted by shop and month, and every submission carries a small
     * proof-of-work bound to both. Writes are validated by the ingest function;
     * the client has no direct write permission on the table.
     */
    fun uploadMonthlyPasses(
        context: Context,
        distanceM: Double,
        fixes: List<MotionDetector.Fix>,
        partners: List<PartnerPoi>
    ) {
        if (fixes.size < 2 || partners.isEmpty() || distanceM < MIN_TRIP_M) return
        val prefs = context.getSharedPreferences("hodos", Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (now < prefs.getLong(UPLOAD_BACKOFF_KEY, 0L)) return
        val deviceId = prefs.getString("deviceId", "").orEmpty()
        if (deviceId.isEmpty()) return
        val month = monthKey(now)
        for (partner in partners) {
            if (!travelledPast(partner.lat, partner.lng, fixes)) continue
            val token = sha256("$deviceId|${partner.id}|$month").take(16)
            val nonce = findProof(partner.id, token) ?: continue
            // Appwrite's execution API carries the function payload in `body`.
            val payload = JSONObject()
                .put("partnerId", partner.id)
                .put("passToken", token)
                .put("nonce", nonce)
                .toString()
            val body = JSONObject()
                .put("body", payload)
                .put("method", "POST")
                .put("path", "/")
                .put("headers", JSONObject().put("content-type", "application/json"))
                .toString()
            val status = postExecution(body)
            if (status == 401 || status == 403 || status == 404) {
                // Ingest function not deployed or not permitted yet; retry later.
                prefs.edit().putLong(UPLOAD_BACKOFF_KEY, now + UPLOAD_BACKOFF_MS).apply()
                return
            }
        }
    }

    /** SHA-256 proof with four leading zero hex digits, bound to shop + token. */
    private fun findProof(partnerId: String, token: String): String? {
        for (nonce in 0L until 2_000_000L) {
            if (sha256("$partnerId|$token|$nonce").startsWith("0000")) {
                return nonce.toString()
            }
        }
        return null
    }

    private fun postExecution(body: String): Int {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("$ENDPOINT/functions/hodos-partner-pass/executions")
                .openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("X-Appwrite-Project", PROJECT_ID)
                setRequestProperty("Content-Type", "application/json")
                connectTimeout = 8_000
                readTimeout = 15_000
                doOutput = true
            }
            connection.outputStream.use {
                it.write(body.toByteArray(StandardCharsets.UTF_8))
            }
            connection.responseCode
        } catch (_: Exception) {
            -1
        } finally {
            connection?.disconnect()
        }
    }

    private fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(StandardCharsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun travelledPast(lat: Double, lng: Double, fixes: List<MotionDetector.Fix>): Boolean {
        for (fix in fixes) {
            if (haversine(fix.lat, fix.lng, lat, lng) <= PASS_RADIUS_M) {
                return true
            }
        }
        return false
    }

    private fun monthKey(now: Long): String =
        SimpleDateFormat("yyyy-MM", Locale.US).format(Date(now))

    private fun haversine(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2)
        return 2 * 6_371_008.8 * Math.asin(minOf(1.0, Math.sqrt(s)))
    }
}

/** End-of-journey hook: fetch the current partner feed and count passes. */
object PartnerPassRecorder {
    @JvmStatic
    fun record(context: Context, distanceM: Double, fixes: List<MotionDetector.Fix>) {
        runCatching {
            val partners = PartnerOffers.loadSync()
            if (partners.isNotEmpty()) {
                PartnerPassStore.recordTripPasses(context, distanceM, fixes, partners)
                PartnerPassStore.uploadMonthlyPasses(context, distanceM, fixes, partners)
            }
        }
    }
}
