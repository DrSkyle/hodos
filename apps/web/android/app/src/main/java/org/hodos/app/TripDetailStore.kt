package org.hodos.app

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class SavedFix(
    val t: Long,
    val lat: Double,
    val lng: Double,
    val speed: Double,
    // Sustained vibration energy captured at fix time, used for surface and
    // roughness inference. Older trails default to -1 (unknown).
    val roughness: Double = -1.0
)

data class SavedImpact(
    val t: Long,
    val lat: Double,
    val lng: Double,
    val kind: String,
    val severity: Int
)

data class TripTrail(
    val tripId: String,
    val startedAt: Long,
    val durationS: Long,
    val distanceM: Double,
    val fixes: List<SavedFix>,
    val impacts: List<SavedImpact>
)

object TripDetailStore {

    private fun getTripDir(context: Context): File {
        val dir = File(context.filesDir, "trips")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun getExportDir(context: Context): File {
        val dir = File(context.cacheDir, "exports")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    @JvmStatic
    fun saveTrail(
        context: Context,
        tripId: String,
        startedAt: Long,
        durationS: Long,
        distanceM: Double,
        fixes: List<MotionDetector.Fix>,
        impacts: List<MotionDetector.Impact>
    ) {
        if (tripId.isEmpty()) return
        try {
            val root = JSONObject()
            root.put("tripId", tripId)
            root.put("startedAt", startedAt)
            root.put("durationS", durationS)
            root.put("distanceM", distanceM)

            val fixesJson = JSONArray()
            synchronized(fixes) {
                for (f in fixes) {
                    val obj = JSONObject()
                    obj.put("t", f.t)
                    obj.put("lat", f.lat)
                    obj.put("lng", f.lng)
                    obj.put("speed", f.speed)
                    obj.put("rough", f.roughness.toDouble())
                    fixesJson.put(obj)
                }
            }
            root.put("fixes", fixesJson)

            val impactsJson = JSONArray()
            synchronized(impacts) {
                for (imp in impacts) {
                    val obj = JSONObject()
                    obj.put("t", imp.t)
                    obj.put("lat", imp.lat)
                    obj.put("lng", imp.lng)
                    obj.put("kind", imp.kind ?: "pothole")
                    obj.put("severity", imp.severity)
                    impactsJson.put(obj)
                }
            }
            root.put("impacts", impactsJson)

            val dir = getTripDir(context)
            val file = File(dir, "$tripId.json")
            val tmpFile = File(dir, "$tripId.json.tmp")
            tmpFile.writeText(root.toString())
            if (!tmpFile.renameTo(file)) {
                file.writeText(root.toString())
                tmpFile.delete()
            }
        } catch (_: Exception) {}
    }

    @JvmStatic
    fun getTrail(context: Context, tripId: String): TripTrail? {
        val file = File(getTripDir(context), "$tripId.json")
        if (!file.exists()) return null
        return try {
            val text = file.readText()
            val root = JSONObject(text)
            val startedAt = root.optLong("startedAt", 0L)
            val durationS = root.optLong("durationS", 0L)
            val distanceM = root.optDouble("distanceM", 0.0)

            val fixesList = mutableListOf<SavedFix>()
            val fixesArr = root.optJSONArray("fixes")
            if (fixesArr != null) {
                for (i in 0 until fixesArr.length()) {
                    val o = fixesArr.getJSONObject(i)
                    fixesList.add(
                        SavedFix(
                            o.optLong("t"),
                            o.optDouble("lat"),
                            o.optDouble("lng"),
                            o.optDouble("speed", 0.0),
                            o.optDouble("rough", -1.0)
                        )
                    )
                }
            }

            val impactsList = mutableListOf<SavedImpact>()
            val impactsArr = root.optJSONArray("impacts")
            if (impactsArr != null) {
                for (i in 0 until impactsArr.length()) {
                    val o = impactsArr.getJSONObject(i)
                    impactsList.add(
                        SavedImpact(
                            o.optLong("t"),
                            o.optDouble("lat"),
                            o.optDouble("lng"),
                            o.optString("kind", "pothole"),
                            o.optInt("severity", 1)
                        )
                    )
                }
            }

            TripTrail(tripId, startedAt, durationS, distanceM, fixesList, impactsList)
        } catch (_: Exception) {
            null
        }
    }

    @JvmStatic
    fun exportGPX(context: Context, trail: TripTrail): File {
        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val exportFile = File(getExportDir(context), "hodos-journey-${trail.tripId}.gpx")

        val sb = StringBuilder()
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        sb.append("<gpx version=\"1.1\" creator=\"Hodos Road Mapping\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n")
        sb.append("  <metadata>\n")
        sb.append("    <name>Hodos Road Mapping Journey</name>\n")
        sb.append("    <time>").append(isoFormat.format(Date(trail.startedAt))).append("</time>\n")
        sb.append("  </metadata>\n")

        for (imp in trail.impacts) {
            val label = when (imp.kind) {
                "speed_bump" -> "Speed Bump"
                "rough_pavement" -> "Rough Pavement"
                else -> "Pothole"
            }
            sb.append("  <wpt lat=\"").append(imp.lat).append("\" lon=\"").append(imp.lng).append("\">\n")
            sb.append("    <name>").append(label).append(" (Severity ").append(imp.severity).append(")</name>\n")
            sb.append("    <time>").append(isoFormat.format(Date(imp.t))).append("</time>\n")
            sb.append("  </wpt>\n")
        }

        if (trail.fixes.isNotEmpty()) {
            sb.append("  <trk>\n")
            sb.append("    <name>Journey Trail</name>\n")
            sb.append("    <trkseg>\n")
            for (fix in trail.fixes) {
                sb.append("      <trkpt lat=\"").append(fix.lat).append("\" lon=\"").append(fix.lng).append("\">\n")
                sb.append("        <time>").append(isoFormat.format(Date(fix.t))).append("</time>\n")
                sb.append("        <speed>").append(fix.speed).append("</speed>\n")
                sb.append("      </trkpt>\n")
            }
            sb.append("    </trkseg>\n")
            sb.append("  </trk>\n")
        }

        sb.append("</gpx>\n")
        exportFile.writeText(sb.toString())
        return exportFile
    }

    @JvmStatic
    fun exportGeoJSON(context: Context, trail: TripTrail): File {
        val exportFile = File(getExportDir(context), "hodos-journey-${trail.tripId}.geojson")
        val root = JSONObject()
        root.put("type", "FeatureCollection")

        val features = JSONArray()

        // Route line feature
        if (trail.fixes.size >= 2) {
            val routeFeature = JSONObject()
            routeFeature.put("type", "Feature")
            val geom = JSONObject()
            geom.put("type", "LineString")
            val coords = JSONArray()
            for (f in trail.fixes) {
                val pt = JSONArray()
                pt.put(f.lng)
                pt.put(f.lat)
                coords.put(pt)
            }
            geom.put("coordinates", coords)
            routeFeature.put("geometry", geom)

            val props = JSONObject()
            props.put("name", "Hodos Journey Trail")
            props.put("distanceM", trail.distanceM)
            props.put("durationS", trail.durationS)
            routeFeature.put("properties", props)
            features.put(routeFeature)
        }

        // Hazard points
        for (imp in trail.impacts) {
            val ptFeature = JSONObject()
            ptFeature.put("type", "Feature")
            val geom = JSONObject()
            geom.put("type", "Point")
            val pt = JSONArray()
            pt.put(imp.lng)
            pt.put(imp.lat)
            geom.put("coordinates", pt)
            ptFeature.put("geometry", geom)

            val props = JSONObject()
            props.put("kind", imp.kind)
            props.put("severity", imp.severity)
            props.put("timestamp", imp.t)
            ptFeature.put("properties", props)
            features.put(ptFeature)
        }

        root.put("features", features)
        exportFile.writeText(root.toString())
        return exportFile
    }

    @JvmStatic
    fun shareFile(context: Context, file: File, mimeType: String, title: String) {
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file
        )
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(intent, title).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(chooser)
    }
}
