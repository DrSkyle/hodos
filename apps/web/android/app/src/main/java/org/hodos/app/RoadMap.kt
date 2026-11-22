package org.hodos.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.MapLibreMap
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleOpacity
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeOpacity
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.layers.PropertyFactory.iconAllowOverlap
import org.maplibre.android.style.layers.PropertyFactory.iconIgnorePlacement
import org.maplibre.android.style.layers.PropertyFactory.iconImage
import org.maplibre.android.style.layers.PropertyFactory.iconPadding
import org.maplibre.android.style.layers.PropertyFactory.iconSize
import org.maplibre.android.style.layers.PropertyFactory.visibility
import org.maplibre.android.style.layers.PropertyValue
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.sources.GeoJsonOptions
import org.maplibre.android.style.sources.GeoJsonSource
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point
import kotlinx.coroutines.delay
import kotlin.math.abs

/**
 * A real native vector map, with MapLibre's Android lifecycle forwarded from
 * the Compose host. Displayed dots are public corroborated hazards only.
 */
enum class LocationIssue {
    Permission, Disabled, Timeout
}

// OpenFreeMap's paired day and night vector styles. Both are licence-clean and
// keyless, and the night one is built for this purpose rather than being a
// filter over the day map.
private const val LIGHT_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty"
private const val DARK_MAP_STYLE = "https://tiles.openfreemap.org/styles/dark"

/**
 * Remembers the last camera position across app restarts so reopening the map
 * returns to where the rider left off instead of snapping to the same overview.
 */
private object MapCameraStore {
    private const val FILE = "hodos_map_camera"
    private const val KEY = "camera"

    fun load(context: Context): CameraPosition? = runCatching {
        val raw = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null)
            ?: return null
        val parts = raw.split(",")
        if (parts.size != 3) return null
        val lat = parts[0].toDoubleOrNull() ?: return null
        val lng = parts[1].toDoubleOrNull() ?: return null
        val zoom = parts[2].toDoubleOrNull() ?: return null
        if (!lat.isFinite() || !lng.isFinite() || !zoom.isFinite()) return null
        if (abs(lat) > 90.0 || abs(lng) > 180.0 || zoom < 1.0 || zoom > 20.0) return null
        CameraPosition.Builder().target(LatLng(lat, lng)).zoom(zoom).build()
    }.getOrNull()

    fun save(context: Context, position: CameraPosition) {
        runCatching {
            val target = position.target ?: return
            val value = "${target.latitude},${target.longitude},${position.zoom}"
            context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY, value)
                .apply()
        }
    }
}

@Composable
fun RoadMap(
    hazards: List<RoadHazard>,
    partners: List<PartnerPoi> = emptyList(),
    shopsMode: ShopsFilterMode = ShopsFilterMode.ESSENTIALS,
    locateRequest: Int,
    onSelect: (RoadHazard) -> Unit,
    onLocated: (Location) -> Unit,
    onLocationError: (LocationIssue) -> Unit
) {
    val context = LocalContext.current
    val lifecycle = (context as ComponentActivity).lifecycle
    val latestHazards by rememberUpdatedState(hazards)
    val latestPartners by rememberUpdatedState(partners)
    val latestShopsMode by rememberUpdatedState(shopsMode)
    val latestOnSelect by rememberUpdatedState(onSelect)
    val latestOnLocated by rememberUpdatedState(onLocated)
    val latestOnLocationError by rememberUpdatedState(onLocationError)
    // Native map initialization varies across GPU drivers and older Android devices.
    // A map renderer problem must not crash the whole application.
    val mapView = remember(context) {
        runCatching {
            MapLibre.getInstance(context)
            MapView(context).apply { onCreate(null) }
        }.onFailure { Log.e("HodosRoadMap", "Map initialization failed", it) }.getOrNull()
    }
    var rendererFailed by remember { mutableStateOf(false) }
    if (mapView == null) {
        LaunchedEffect(locateRequest) {
            if (locateRequest > 0) latestOnLocationError(LocationIssue.Timeout)
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Map renderer unavailable on this device. You can still browse the nearby hazards list.",
                modifier = Modifier.padding(30.dp))
        }
        return
    }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var ready by remember { mutableStateOf(false) }
    var userFix by remember { mutableStateOf<Location?>(null) }
    var partnerSelected by remember { mutableStateOf<PartnerPoi?>(null) }
    var cameraIdleTick by remember { mutableStateOf(0) }
    val savedCamera = remember(context) { MapCameraStore.load(context) }

    // OpenFreeMap ships a purpose-built night style. Follow the app theme with
    // it instead of leaving a fully lit map around a dark UI.
    val darkMap = isDarkTheme
    fun mapStyleUrl(dark: Boolean): String =
        if (dark) DARK_MAP_STYLE else LIGHT_MAP_STYLE

    // Registers the Hodos sources and layers on a freshly loaded style. Shared
    // by the first load and by theme changes, so hazard rendering is defined
    // exactly once.
    fun applyHodosLayers(style: Style) {
        style.addSource(GeoJsonSource(
            "hodos-hazards", FeatureCollection.fromFeatures(emptyArray<Feature>())
        ))
        // Road-quality cells share the hazard grid so the heat band
        // matches the website's layer exactly.
        style.addSource(GeoJsonSource(
            "hodos-quality", FeatureCollection.fromFeatures(emptyArray<Feature>())
        ))
        style.addSource(GeoJsonSource(
            "hodos-user-location", FeatureCollection.fromFeatures(emptyArray<Feature>())
        ))
        style.addLayer(
            CircleLayer("hodos-user-halo", "hodos-user-location").withProperties(
                circleColor("#2878DB"),
                circleRadius(19f),
                circleOpacity(0.18f),
                circleStrokeWidth(0f)
            )
        )
        style.addLayer(
            CircleLayer("hodos-user-dot", "hodos-user-location").withProperties(
                circleColor("#2878DB"),
                circleRadius(6.5f),
                circleOpacity(1f),
                circleStrokeColor(android.graphics.Color.WHITE),
                circleStrokeWidth(2.5f)
            )
        )
        // Local shop stops render BELOW road hazards, stay hidden on zoomed-out
        // city/highway views (minZoom 11.5), and cluster automatically so dense
        // streets never turn the road map into ad clutter.
        addPartnerBadgeImages(style)
        style.addSource(
            GeoJsonSource(
                "hodos-partners",
                FeatureCollection.fromFeatures(emptyArray<Feature>()),
                GeoJsonOptions()
                    .withCluster(true)
                    .withClusterMaxZoom(13)
                    .withClusterRadius(48)
            )
        )
        style.addLayer(
            SymbolLayer("hodos-partner-clusters", "hodos-partners").apply {
                minZoom = 10f
                setFilter(Expression.has("point_count"))
                withProperties(
                    iconImage("shop-cluster"),
                    iconSize(0.76f),
                    iconAllowOverlap(false),
                    iconPadding(4f)
                )
            }
        )
        style.addLayer(
            SymbolLayer("hodos-partner-icons", "hodos-partners").apply {
                minZoom = 10f
                setFilter(Expression.not(Expression.has("point_count")))
                withProperties(
                    iconImage(Expression.coalesce(Expression.get("icon"), Expression.literal("shop-local"))),
                    iconSize(0.74f),
                    iconAllowOverlap(false),
                    iconPadding(4f)
                )
            }
        )
        // The hazard rendering is defined once in the website's
        // public/map/hodos-layers.json, bundled into assets at build
        // time, so both platforms draw hazards from a single spec.
        val spec = runCatching {
            context.assets.open("map/hodos-layers.json")
                .bufferedReader().use { it.readText() }
        }.getOrNull()
        if (spec != null) {
            addHazardLayersFromSpec(style, spec)
        }
        // Momentary Live Road Radar alerts (police, jam, roadblock, flood)
        // render as distinct symbol badges above surface hazard dots so
        // drivers never confuse a temporary check/blockage with a pothole.
        addLiveRadarBadgeImages(style)
        style.addSource(GeoJsonSource(
            "hodos-alerts", FeatureCollection.fromFeatures(emptyArray<Feature>())
        ))
        style.addLayer(
            SymbolLayer("hodos-alert-symbols", "hodos-alerts").withProperties(
                iconImage(Expression.get("icon")),
                iconSize(0.62f),
                iconAllowOverlap(true),
                iconIgnorePlacement(true)
            )
        )
    }

    DisposableEffect(mapView, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> runCatching { mapView.onStart() }.onFailure { rendererFailed = true }
                Lifecycle.Event.ON_RESUME -> runCatching { mapView.onResume() }.onFailure { rendererFailed = true }
                Lifecycle.Event.ON_PAUSE -> runCatching { mapView.onPause() }
                Lifecycle.Event.ON_STOP -> runCatching { mapView.onStop() }
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
            runCatching { mapView.onStart() }.onFailure { rendererFailed = true }
        }
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            runCatching { mapView.onResume() }.onFailure { rendererFailed = true }
        }
        onDispose {
            lifecycle.removeObserver(observer)
            runCatching { mapView.onPause() }
            runCatching { mapView.onStop() }
            runCatching { mapView.onDestroy() }
        }
    }

    LaunchedEffect(mapView) {
        try {
          mapView.getMapAsync { result ->
            try {
            map = result
            // Restore the rider's last camera first; the world-view default is
            // only for people who have never moved the map before.
            result.cameraPosition = savedCamera
                ?: CameraPosition.Builder().target(LatLng(20.0, 0.0)).zoom(2.0).build()
            result.addOnCameraIdleListener {
                MapCameraStore.save(context, result.cameraPosition)
            }
            result.uiSettings.isRotateGesturesEnabled = false
            result.uiSettings.setAttributionMargins(12, 0, 12, 170)
            result.setStyle(
                Style.Builder().fromUri(mapStyleUrl(darkMap))
            ) { style ->
                try {
                applyHodosLayers(style)
                ready = true
                result.addOnMapClickListener { point ->
                    val screen = result.projection.toScreenLocation(point)
                    val hits = result.queryRenderedFeatures(screen, "hodos-alert-symbols", "hodos-hazard-point")
                    val id = hits.firstOrNull()?.getStringProperty("id")
                    val hazard = latestHazards.firstOrNull { it.id == id }
                    if (hazard != null) {
                        latestOnSelect(hazard)
                        true
                    } else {
                        val partnerHits = runCatching {
                            result.queryRenderedFeatures(screen, "hodos-partner-icons")
                        }.getOrDefault(emptyList())
                        val partnerId = partnerHits.firstOrNull()?.getStringProperty("id")
                        val partner = latestPartners.firstOrNull { it.id == partnerId }
                        if (partner != null) {
                            partnerSelected = partner
                            true
                        } else {
                            val clusterHits = runCatching {
                                result.queryRenderedFeatures(screen, "hodos-partner-clusters")
                            }.getOrDefault(emptyList())
                            val clusterGeom = clusterHits.firstOrNull()?.geometry() as? Point
                            if (clusterGeom != null) {
                                result.animateCamera(
                                    CameraUpdateFactory.newLatLngZoom(
                                        LatLng(clusterGeom.latitude(), clusterGeom.longitude()),
                                        (result.cameraPosition.zoom + 2.0).coerceAtMost(16.0)
                                    )
                                )
                                true
                            } else false
                        }
                    }
                }
                result.addOnCameraIdleListener {
                    cameraIdleTick++
                }
                } catch (error: Throwable) {
                    rendererFailed = true
                    Log.e("HodosRoadMap", "Map style initialization failed", error)
                }
            }
            } catch (error: Throwable) {
                rendererFailed = true
                Log.e("HodosRoadMap", "Map callback failed", error)
            }
          }
        } catch (error: Throwable) {
            rendererFailed = true
            Log.e("HodosRoadMap", "Could not create map", error)
        }
    }

    var initialFitDone by remember { mutableStateOf(false) }

    // Follow the app theme: swap the day map for the night one when the user
    // changes appearance, keeping the camera and re-arming the layers. `ready`
    // flips false for the swap so the hazard effects repopulate the new style.
    var styleIsDark by remember { mutableStateOf(darkMap) }
    LaunchedEffect(darkMap) {
        if (darkMap == styleIsDark) return@LaunchedEffect
        styleIsDark = darkMap
        val current = map ?: return@LaunchedEffect
        ready = false
        current.setStyle(Style.Builder().fromUri(mapStyleUrl(darkMap))) { style ->
            try {
                applyHodosLayers(style)
                ready = true
            } catch (error: Throwable) {
                rendererFailed = true
                Log.e("HodosRoadMap", "Map style swap failed", error)
            }
        }
    }

    LaunchedEffect(hazards, ready) {
        if (ready) {
            val surfaceFeatures = hazards
                .filter { !it.isLiveAlert }
                .map { hazard ->
                    Feature.fromGeometry(Point.fromLngLat(hazard.lng, hazard.lat)).apply {
                        addStringProperty("id", hazard.id)
                        addStringProperty("kind", hazard.kind)
                        addBooleanProperty("fixed", hazard.fixed)
                        addNumberProperty("severity", hazard.severity)
                        addNumberProperty("passes", hazard.passes)
                        addStringProperty(
                            "color",
                            if (hazard.fixed) "#10B981"
                            else when (hazard.kind) {
                                "pothole" -> "#E11D48"
                                "speed_bump" -> "#7C3AED"
                                else -> "#D97706"
                            }
                        )
                    }
                }
            map?.style?.getSourceAs<GeoJsonSource>("hodos-hazards")
                ?.setGeoJson(FeatureCollection.fromFeatures(surfaceFeatures))

            val alertFeatures = hazards
                .filter { it.isLiveAlert && !it.fixed }
                .map { alert ->
                    Feature.fromGeometry(Point.fromLngLat(alert.lng, alert.lat)).apply {
                        addStringProperty("id", alert.id)
                        addStringProperty("kind", alert.kind)
                        addStringProperty("icon", "radar-${alert.kind}")
                    }
                }
            map?.style?.getSourceAs<GeoJsonSource>("hodos-alerts")
                ?.setGeoJson(FeatureCollection.fromFeatures(alertFeatures))

            // Quality cells from the same hazard set, bucketed on the grid in
            // the shared layer spec.
            val qualityFeatures = buildList {
                val buckets = HashMap<String, Triple<Double, Double, DoubleArray>>()
                for (hazard in hazards) {
                    if (hazard.fixed || hazard.isLiveAlert) continue
                    val latBucket = kotlin.math.floor(hazard.lat / 0.0015).toInt()
                    val scale = kotlin.math.cos(Math.toRadians(hazard.lat)).coerceAtLeast(0.2)
                    val lngBucket = kotlin.math.floor(hazard.lng / (0.0015 / scale)).toInt()
                    val key = "$latBucket:$lngBucket"
                    val existing = buckets[key]
                    val stress = when (hazard.severity) {
                        3 -> 5.0
                        2 -> 2.5
                        else -> 1.0
                    }
                    if (existing == null) {
                        buckets[key] = Triple(
                            (latBucket + 0.5) * 0.0015,
                            (lngBucket + 0.5) * (0.0015 / scale),
                            doubleArrayOf(1.0, stress)
                        )
                    } else {
                        existing.third[0] += 1.0
                        existing.third[1] += stress
                    }
                }
                for ((_, cell) in buckets) {
                    val quality = (100.0 - cell.third[1] * 8.0).coerceIn(0.0, 100.0)
                    add(
                        Feature.fromGeometry(Point.fromLngLat(cell.second, cell.first)).apply {
                            addNumberProperty("quality", quality)
                            addNumberProperty("hazards", cell.third[0])
                        }
                    )
                }
            }
            map?.style?.getSourceAs<GeoJsonSource>("hodos-quality")
                ?.setGeoJson(FeatureCollection.fromFeatures(qualityFeatures))

            if (!initialFitDone && savedCamera == null && userFix == null && hazards.isNotEmpty()) {
                initialFitDone = true
                val avgLat = hazards.map { it.lat }.average()
                val avgLng = hazards.map { it.lng }.average()
                if (avgLat.isFinite() && avgLng.isFinite()) {
                    map?.animateCamera(
                        CameraUpdateFactory.newLatLngZoom(LatLng(avgLat, avgLng), 11.5)
                    )
                }
            }
        }
    }

    LaunchedEffect(partners, shopsMode, ready, cameraIdleTick) {
        if (ready) {
            val activeMap = map
            val style = activeMap?.style
            val cam = activeMap?.cameraPosition
            val bounds = runCatching { activeMap?.projection?.visibleRegion?.latLngBounds }.getOrNull()
            val selectedPartners = PartnerVisuals.selectForViewport(
                items = partners,
                mode = shopsMode,
                zoom = cam?.zoom ?: 12.0,
                centerLat = cam?.target?.latitude,
                centerLng = cam?.target?.longitude,
                south = bounds?.latitudeSouth,
                north = bounds?.latitudeNorth,
                west = bounds?.longitudeWest,
                east = bounds?.longitudeEast
            )
            val features = selectedPartners.map { partner ->
                val vis = PartnerVisuals.classify(partner.category)
                Feature.fromGeometry(Point.fromLngLat(partner.lng, partner.lat)).apply {
                    addStringProperty("id", partner.id)
                    addStringProperty("icon", vis.iconId)
                    addStringProperty("categoryLabel", vis.label)
                }
            }
            style?.getSourceAs<GeoJsonSource>("hodos-partners")
                ?.setGeoJson(FeatureCollection.fromFeatures(features))
            val visValue = if (shopsMode == ShopsFilterMode.OFF) Property.NONE else Property.VISIBLE
            style?.getLayer("hodos-partner-clusters")?.setProperties(visibility(visValue))
            style?.getLayer("hodos-partner-icons")?.setProperties(visibility(visValue))
        }
    }

    // The hazard halos breathe on a slow sine so the map feels alive even
    // when nobody is touching it.
    LaunchedEffect(ready) {
        if (!ready) return@LaunchedEffect
        while (true) {
            delay(250)
            val currentStyle = map?.style ?: continue
            val glow = currentStyle.getLayer("hodos-hazard-glow") as? CircleLayer ?: continue
            val phase = (System.currentTimeMillis() % 3800L) / 3800.0
            val wave = 0.5 - 0.5 * kotlin.math.cos(phase * 2.0 * Math.PI)
            glow.withProperties(circleOpacity((0.11 + wave * 0.09).toFloat()))
        }
    }

    LaunchedEffect(userFix, ready) {
        val fix = userFix
        if (fix != null && ready) {
            map?.style?.getSourceAs<GeoJsonSource>("hodos-user-location")
                ?.setGeoJson(FeatureCollection.fromFeatures(arrayOf(
                    Feature.fromGeometry(Point.fromLngLat(fix.longitude, fix.latitude))
                )))
            // If GPS resolved while the style was still loading, center the
            // camera now instead of silently keeping it over the world view.
            val fine = ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            map?.animateCamera(CameraUpdateFactory.newLatLngZoom(
                LatLng(fix.latitude, fix.longitude), if (fine) 15.0 else 12.0
            ))
        }
    }

    // Location must not be blocked by a slow/offline map style load.
    // The platform and fused providers can locate independently of MapLibre.
    DisposableEffect(locateRequest) {
        val fine = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val cancellation = CancellationTokenSource()
        val locationManager = context.getSystemService(LocationManager::class.java)
        val handler = Handler(Looper.getMainLooper())
        var finished = false
        var listener: LocationListener? = null
        var fallback: Location? = null

        fun finishWithLocation(location: Location) {
            if (finished || cancellation.token.isCancellationRequested) return
            if (!LocationFixPolicy.validCoordinates(location.latitude, location.longitude)) return
            finished = true
            userFix = location
            val position = LatLng(location.latitude, location.longitude)
            map?.style?.getSourceAs<GeoJsonSource>("hodos-user-location")
                ?.setGeoJson(FeatureCollection.fromFeatures(
                    arrayOf(Feature.fromGeometry(Point.fromLngLat(
                        position.longitude, position.latitude
                    )))
                ))
            map?.animateCamera(CameraUpdateFactory.newLatLngZoom(
                position, if (fine) 15.0 else 12.0
            ))
            latestOnLocated(location)
        }

        fun error(issue: LocationIssue) {
            if (!finished && !cancellation.token.isCancellationRequested) {
                finished = true
                latestOnLocationError(issue)
            }
        }

        val timeout = Runnable {
            val cached = fallback
            if (cached != null) finishWithLocation(cached)
            else error(LocationIssue.Timeout)
        }

        if (locateRequest > 0) {
            if (!fine && !coarse) {
                error(LocationIssue.Permission)
            } else {
                val enabled = try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        locationManager.isLocationEnabled
                    } else {
                        locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                            locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
                    }
                } catch (_: Exception) {
                    false
                }
                if (!enabled) {
                    error(LocationIssue.Disabled)
                } else {
                    handler.postDelayed(timeout, 16_000L)
                    try {
                        val providers = listOf(
                            LocationManager.NETWORK_PROVIDER,
                            LocationManager.GPS_PROVIDER
                        ).filter { locationManager.isProviderEnabled(it) }
                        // A cached fix is better than a map stuck on the default
                        // view. Use a very recent fix immediately; older
                        // (<15-minute) fixes are a timeout-only fallback.
                        providers.forEach { provider ->
                            val cached = try { locationManager.getLastKnownLocation(provider) }
                                catch (_: Exception) { null }
                            if (cached != null) {
                                val now = System.currentTimeMillis()
                                if (LocationFixPolicy.isFallbackCandidate(cached.time, now) &&
                                    (fallback == null || cached.time > fallback!!.time)) {
                                    fallback = cached
                                }
                                if (LocationFixPolicy.isFresh(cached.time, now)) finishWithLocation(cached)
                            }
                        }
                        if (providers.isNotEmpty() && !finished) {
                            val platformListener = object : LocationListener {
                                override fun onLocationChanged(location: Location) {
                                    finishWithLocation(location)
                                }
                            }
                            listener = platformListener
                            providers.forEach { provider ->
                                // Older versions support this API; callback is delivered
                                // on the main looper without requesting background access.
                                locationManager.requestSingleUpdate(
                                    provider, platformListener, Looper.getMainLooper()
                                )
                            }
                        }
                    } catch (_: SecurityException) {
                        error(LocationIssue.Permission)
                    } catch (_: Exception) {
                        // Continue with the fused location request below.
                    }
                    try {
                        val client = LocationServices.getFusedLocationProviderClient(context)
                        val request = CurrentLocationRequest.Builder()
                            .setPriority(
                                if (fine) Priority.PRIORITY_HIGH_ACCURACY
                                else Priority.PRIORITY_BALANCED_POWER_ACCURACY
                            )
                            .setMaxUpdateAgeMillis(30_000L)
                            .setDurationMillis(14_000L)
                            .build()
                        client.getCurrentLocation(request, cancellation.token)
                            .addOnSuccessListener { fix ->
                                if (fix != null) finishWithLocation(fix)
                            }
                            .addOnFailureListener {
                                // Android providers may still succeed without GMS.
                            }
                        // A last known fix is useful only if still recent.
                        client.lastLocation.addOnSuccessListener { fix ->
                            if (fix != null) {
                                val now = System.currentTimeMillis()
                                if (LocationFixPolicy.isFallbackCandidate(fix.time, now) &&
                                    (fallback == null || fix.time > fallback!!.time)) {
                                    fallback = fix
                                }
                                if (LocationFixPolicy.isFresh(fix.time, now)) finishWithLocation(fix)
                            }
                        }
                    } catch (_: SecurityException) {
                        error(LocationIssue.Permission)
                    } catch (_: Exception) {
                        // Keep waiting for the Android location provider.
                    }
                }
            }
        }
        onDispose {
            finished = true
            cancellation.cancel()
            handler.removeCallbacks(timeout)
            listener?.let {
                try { locationManager.removeUpdates(it) } catch (_: Exception) { }
            }
        }
    }

    val activePartner = partnerSelected
    if (activePartner != null) {
        val vis = PartnerVisuals.classify(activePartner.category)
        val localPasses = PartnerPassStore.monthCount(context, activePartner.id)
        val nearby = PartnerStats.nearby(hazards, activePartner.lat, activePartner.lng)
        AlertDialog(
            onDismissRequest = { partnerSelected = null },
            title = { Text(activePartner.name, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    buildString {
                        append(vis.label)
                        append("\n\n")
                        append(activePartner.offer)
                        val stats = activePartner.passesThisMonth
                            ?.let { "$it drivers passed this stop this month" }
                            ?: if (localPasses > 0) {
                                "You passed this stop $localPasses× this month"
                            } else if (nearby.hasSignal) {
                                "${nearby.maxDevices} devices report road conditions within 400 m"
                            } else null
                        if (stats != null) {
                            append("\n\n")
                            append(stats)
                            append("\nAggregated anonymously. Drivers are never identified.")
                        }
                    }
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val lat = activePartner.lat
                    val lng = activePartner.lng
                    val label = Uri.encode(activePartner.name)
                    partnerSelected = null
                    runCatching {
                        context.startActivity(
                            Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse("geo:$lat,$lng?q=$lat,$lng($label)")
                            )
                        )
                    }.onFailure {
                        runCatching {
                            context.startActivity(
                                Intent(
                                    Intent.ACTION_VIEW,
                                    Uri.parse("https://www.google.com/maps/search/?api=1&query=$lat,$lng")
                                )
                            )
                        }
                    }
                }) { Text("Directions") }
            },
            dismissButton = {
                TextButton(onClick = { partnerSelected = null }) { Text("Close") }
            }
        )
    }

    Box(Modifier.fillMaxSize()) {
        if (!rendererFailed) {
            AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize())
        } else {
            Text(
                "Map renderer failed to start. The rest of Hodos remains available.",
                modifier = Modifier.align(Alignment.Center).padding(28.dp)
            )
        }
    }
}

/**
 * Builds the hazard layers from the shared spec bundled from the website
 * (public/map/hodos-layers.json). Paint values are MapLibre expressions
 * passed through raw; scalars become literals. A malformed spec must never
 * break the map, so every layer is applied defensively.
 */
private fun addHazardLayersFromSpec(style: Style, specJson: String) {
    runCatching {
        val root = JSONObject(specJson)
        val layers = root.optJSONArray("layers") ?: return
        for (i in 0 until layers.length()) {
            val layer = layers.optJSONObject(i) ?: continue
            val id = layer.optString("id")
            val source = layer.optString("source")
            if (id.isEmpty() || source.isEmpty()) continue
            val paint = layer.optJSONObject("paint") ?: JSONObject()
            val properties = mutableListOf<PropertyValue<*>>()
            val keys = paint.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = paint.get(key)
                val expression = when (value) {
                    is JSONArray -> runCatching { Expression.raw(value.toString()) }.getOrNull() ?: continue
                    is Boolean -> Expression.literal(value)
                    is Number -> Expression.literal(value)
                    is String -> Expression.literal(value)
                    else -> continue
                }
                when (key) {
                    "circle-radius" -> properties.add(circleRadius(expression))
                    "circle-color" -> properties.add(circleColor(expression))
                    "circle-opacity" -> properties.add(circleOpacity(expression))
                    "circle-stroke-color" -> properties.add(circleStrokeColor(expression))
                    "circle-stroke-width" -> properties.add(circleStrokeWidth(expression))
                    "circle-stroke-opacity" -> properties.add(circleStrokeOpacity(expression))
                }
            }
            if (properties.isNotEmpty()) {
                style.addLayer(CircleLayer(id, source).withProperties(*properties.toTypedArray()))
            }
        }
    }
}

private fun addLiveRadarBadgeImages(style: Style) {
    runCatching {
        style.addImage("radar-police", drawRadarBadge(0xFF2563EB.toInt(), "P", shape = "shield"))
        style.addImage("radar-jam", drawRadarBadge(0xFFEA580C.toInt(), "!", shape = "diamond"))
        style.addImage("radar-roadblock", drawRadarBadge(0xFFDC2626.toInt(), "✕", shape = "octagon"))
        style.addImage("radar-flood", drawRadarBadge(0xFF0891B2.toInt(), "≈", shape = "circle"))
    }
}

private fun drawRadarBadge(fillColor: Int, glyph: String, shape: String): Bitmap {
    val size = 76
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val cx = size / 2f
    val cy = size / 2f
    val r = size * 0.40f

    val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = fillColor
        style = Paint.Style.FILL
    }
    val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 5f
        strokeJoin = Paint.Join.ROUND
    }

    val path = Path()
    when (shape) {
        "shield" -> {
            path.moveTo(cx, cy - r)
            path.lineTo(cx + r * 0.88f, cy - r * 0.55f)
            path.lineTo(cx + r * 0.80f, cy + r * 0.18f)
            path.quadTo(cx + r * 0.52f, cy + r * 0.78f, cx, cy + r)
            path.quadTo(cx - r * 0.52f, cy + r * 0.78f, cx - r * 0.80f, cy + r * 0.18f)
            path.lineTo(cx - r * 0.88f, cy - r * 0.55f)
            path.close()
        }
        "diamond" -> {
            path.moveTo(cx, cy - r)
            path.lineTo(cx + r, cy)
            path.lineTo(cx, cy + r)
            path.lineTo(cx - r, cy)
            path.close()
        }
        "octagon" -> {
            val d = r * 0.44f
            path.moveTo(cx - d, cy - r)
            path.lineTo(cx + d, cy - r)
            path.lineTo(cx + r, cy - d)
            path.lineTo(cx + r, cy + d)
            path.lineTo(cx + d, cy + r)
            path.lineTo(cx - d, cy + r)
            path.lineTo(cx - r, cy + d)
            path.lineTo(cx - r, cy - d)
            path.close()
        }
        else -> {
            path.addCircle(cx, cy, r, Path.Direction.CW)
        }
    }

    canvas.drawPath(path, fillPaint)
    canvas.drawPath(path, strokePaint)

    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        textSize = 31f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        textAlign = Paint.Align.CENTER
    }
    val fm = textPaint.fontMetrics
    val baseline = cy - (fm.ascent + fm.descent) / 2f
    canvas.drawText(glyph, cx, baseline, textPaint)
    return bmp
}

private fun addPartnerBadgeImages(style: Style) {
    runCatching {
        style.addImage("shop-auto", drawPartnerBadge(0xFF27272A.toInt(), "auto"))
        style.addImage("shop-ev", drawPartnerBadge(0xFF0F766E.toInt(), "ev"))
        style.addImage("shop-food", drawPartnerBadge(0xFF6B4423.toInt(), "food"))
        style.addImage("shop-health", drawPartnerBadge(0xFF9D174D.toInt(), "health"))
        style.addImage("shop-local", drawPartnerBadge(0xFF3F3F46.toInt(), "local"))
        style.addImage("shop-cluster", drawPartnerBadge(0xFF18181B.toInt(), "cluster"))
    }
}

private fun drawPartnerBadge(bgColor: Int, kind: String): Bitmap {
    val size = 68
    val s = size.toFloat()
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)

    val rect = RectF(7f, 7f, s - 7f, s - 7f)
    val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = bgColor
        style = Paint.Style.FILL
    }
    val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 3.8f
    }
    canvas.drawRoundRect(rect, 15f, 15f, fillPaint)
    canvas.drawRoundRect(rect, 15f, 15f, strokePaint)

    val iconStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 3.6f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    val iconFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        style = Paint.Style.FILL
    }

    when (kind) {
        "auto" -> {
            canvas.drawCircle(s * 0.5f, s * 0.5f, s * 0.16f, iconStroke)
            canvas.drawCircle(s * 0.5f, s * 0.5f, s * 0.055f, iconFill)
            for (i in 0 until 6) {
                val a = i * Math.PI / 3.0
                canvas.drawLine(
                    (s * 0.5 + kotlin.math.cos(a) * s * 0.16).toFloat(),
                    (s * 0.5 + kotlin.math.sin(a) * s * 0.16).toFloat(),
                    (s * 0.5 + kotlin.math.cos(a) * s * 0.24).toFloat(),
                    (s * 0.5 + kotlin.math.sin(a) * s * 0.24).toFloat(),
                    iconStroke
                )
            }
        }
        "ev" -> {
            val bolt = Path().apply {
                moveTo(s * 0.54f, s * 0.24f)
                lineTo(s * 0.34f, s * 0.53f)
                lineTo(s * 0.49f, s * 0.53f)
                lineTo(s * 0.45f, s * 0.76f)
                lineTo(s * 0.66f, s * 0.47f)
                lineTo(s * 0.51f, s * 0.47f)
                close()
            }
            canvas.drawPath(bolt, iconFill)
        }
        "food" -> {
            canvas.drawRoundRect(RectF(s * 0.30f, s * 0.38f, s * 0.62f, s * 0.66f), 6f, 6f, iconStroke)
            canvas.drawArc(RectF(s * 0.56f, s * 0.42f, s * 0.72f, s * 0.58f), -90f, 180f, false, iconStroke)
            canvas.drawLine(s * 0.28f, s * 0.72f, s * 0.66f, s * 0.72f, iconStroke)
        }
        "health" -> {
            canvas.drawRoundRect(RectF(s * 0.44f, s * 0.28f, s * 0.56f, s * 0.72f), 4f, 4f, iconFill)
            canvas.drawRoundRect(RectF(s * 0.28f, s * 0.44f, s * 0.72f, s * 0.56f), 4f, 4f, iconFill)
        }
        "cluster" -> {
            canvas.drawRoundRect(RectF(s * 0.26f, s * 0.34f, s * 0.56f, s * 0.64f), 5f, 5f, iconStroke)
            val topBox = RectF(s * 0.44f, s * 0.24f, s * 0.74f, s * 0.54f)
            canvas.drawRoundRect(topBox, 5f, 5f, fillPaint)
            canvas.drawRoundRect(topBox, 5f, 5f, iconStroke)
            canvas.drawCircle(s * 0.59f, s * 0.39f, 4f, iconFill)
        }
        else -> {
            val awning = Path().apply {
                moveTo(s * 0.28f, s * 0.42f)
                lineTo(s * 0.34f, s * 0.30f)
                lineTo(s * 0.66f, s * 0.30f)
                lineTo(s * 0.72f, s * 0.42f)
                close()
            }
            canvas.drawPath(awning, iconStroke)
            canvas.drawRoundRect(RectF(s * 0.32f, s * 0.44f, s * 0.68f, s * 0.70f), 4f, 4f, iconStroke)
        }
    }
    return bmp
}

