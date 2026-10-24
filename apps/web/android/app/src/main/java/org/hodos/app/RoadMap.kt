package org.hodos.app

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleOpacity
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point

/**
 * A real native vector map, with MapLibre's Android lifecycle forwarded from
 * the Compose host. Displayed dots are public corroborated hazards only.
 */
enum class LocationIssue {
    Permission, Disabled, Timeout
}

@Composable
fun RoadMap(
    hazards: List<RoadHazard>,
    locateRequest: Int,
    onSelect: (RoadHazard) -> Unit,
    onLocated: (Location, Boolean) -> Unit,
    onLocationError: (LocationIssue) -> Unit
) {
    val context = LocalContext.current
    val lifecycle = (context as ComponentActivity).lifecycle
    val latestHazards by rememberUpdatedState(hazards)
    val latestOnSelect by rememberUpdatedState(onSelect)
    val latestOnLocated by rememberUpdatedState(onLocated)
    val latestOnLocationError by rememberUpdatedState(onLocationError)
    val mapView = remember {
        MapLibre.getInstance(context)
        MapView(context).apply { onCreate(null) }
    }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var ready by remember { mutableStateOf(false) }
    var mappedLocation by remember { mutableStateOf<Location?>(null) }

    DisposableEffect(mapView, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) mapView.onStart()
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) mapView.onResume()
        onDispose {
            lifecycle.removeObserver(observer)
            mapView.onPause()
            mapView.onStop()
            mapView.onDestroy()
        }
    }

    LaunchedEffect(mapView) {
        mapView.getMapAsync { result ->
            map = result
            result.cameraPosition = CameraPosition.Builder()
                .target(LatLng(28.2, 84.0)).zoom(6.0).build()
            result.uiSettings.isRotateGesturesEnabled = false
            result.uiSettings.setAttributionMargins(12, 0, 12, 170)
            result.setStyle(
                Style.Builder().fromUri("https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json")
            ) { style ->
                style.addSource(GeoJsonSource(
                    "hodos-hazards", FeatureCollection.fromFeatures(emptyArray<Feature>())
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
                style.addLayer(
                    CircleLayer("hodos-hazard-dots", "hodos-hazards").withProperties(
                        circleColor(Expression.get("color")),
                        circleRadius(8f),
                        circleStrokeWidth(2.5f),
                        circleStrokeColor(android.graphics.Color.WHITE),
                        circleOpacity(0.97f)
                    )
                )
                ready = true
                result.addOnMapClickListener { point ->
                    val hits = result.queryRenderedFeatures(
                        result.projection.toScreenLocation(point), "hodos-hazard-dots"
                    )
                    val id = hits.firstOrNull()?.getStringProperty("id")
                    val hazard = latestHazards.firstOrNull { it.id == id }
                    if (hazard != null) {
                        latestOnSelect(hazard)
                        true
                    } else false
                }
            }
        }
    }

    LaunchedEffect(ready, mappedLocation) {
        val fix = mappedLocation ?: return@LaunchedEffect
        if (!ready) return@LaunchedEffect
        val position = LatLng(fix.latitude, fix.longitude)
        map?.style?.getSourceAs<GeoJsonSource>("hodos-user-location")
            ?.setGeoJson(FeatureCollection.fromFeatures(arrayOf(
                Feature.fromGeometry(Point.fromLngLat(position.longitude, position.latitude))
            )))
        val coarse = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) != PackageManager.PERMISSION_GRANTED
        map?.animateCamera(CameraUpdateFactory.newLatLngZoom(
            position, if (coarse || fix.accuracy > 800) 11.0 else 15.0
        ))
    }

    LaunchedEffect(hazards, ready) {
        if (ready) {
            val features = hazards.map { hazard ->
                Feature.fromGeometry(Point.fromLngLat(hazard.lng, hazard.lat)).apply {
                    addStringProperty("id", hazard.id)
                    addStringProperty(
                        "color",
                        if (hazard.fixed) "#398C6B"
                        else when (hazard.severity) {
                            3 -> "#B84C3C"
                            2 -> "#C47B29"
                            else -> "#2F8B79"
                        }
                    )
                }
            }
            map?.style?.getSourceAs<GeoJsonSource>("hodos-hazards")
                ?.setGeoJson(FeatureCollection.fromFeatures(features))
        }
    }

    // Location lookup is intentionally independent of the map style/network
    // tiles. A position can be found while the map is still loading.
    DisposableEffect(locateRequest) {
        val fine = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val cancellation = CancellationTokenSource()
        val manager = context.getSystemService(LocationManager::class.java)
        val handler = Handler(Looper.getMainLooper())
        var finished = false
        var listener: LocationListener? = null
        var candidate: Location? = null

        fun ageMs(fix: Location): Long {
            // Prefer monotonic elapsed real time when available. Wall-clock
            // changes and NTP corrections should not make old fixes look new.
            val elapsed = if (fix.elapsedRealtimeNanos > 0L) {
                (SystemClock.elapsedRealtimeNanos() - fix.elapsedRealtimeNanos) / 1_000_000
            } else Long.MAX_VALUE
            return if (elapsed in 0L..604_800_000L) elapsed
            else (System.currentTimeMillis() - fix.time).coerceAtLeast(0L)
        }

        fun offerCached(fix: Location?) {
            if (fix == null) return
            if (!fix.latitude.isFinite() || !fix.longitude.isFinite() ||
                fix.latitude !in -90.0..90.0 || fix.longitude !in -180.0..180.0) return
            val age = ageMs(fix)
            if (age > 86_400_000L) return // never silently jump to older than a day
            if (candidate == null ||
                age < ageMs(candidate!!) ||
                (age < 120_000L && fix.hasAccuracy() &&
                    (!candidate!!.hasAccuracy() || fix.accuracy < candidate!!.accuracy))) {
                candidate = fix
            }
        }

        fun finish(fix: Location, cached: Boolean) {
            if (finished || cancellation.token.isCancellationRequested) return
            finished = true
            mappedLocation = fix
            latestOnLocated(fix, cached)
        }

        val timeout = Runnable {
            if (!finished && !cancellation.token.isCancellationRequested) {
                val cached = candidate
                if (cached != null) finish(cached, true)
                else {
                    finished = true
                    latestOnLocationError(LocationIssue.Timeout)
                }
            }
        }

        if (locateRequest > 0) {
            if (!fine && !coarse) {
                finished = true
                latestOnLocationError(LocationIssue.Permission)
            } else {
                val enabled = try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
                        manager.isLocationEnabled
                    else manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                        manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
                } catch (_: Exception) { false }

                if (!enabled) {
                    finished = true
                    latestOnLocationError(LocationIssue.Disabled)
                } else {
                    // GPS can be unavailable indoors. Query network, GPS and
                    // passive caches before asking for fresh provider updates.
                    for (provider in listOf(
                        LocationManager.NETWORK_PROVIDER,
                        LocationManager.GPS_PROVIDER,
                        LocationManager.PASSIVE_PROVIDER
                    )) {
                        try {
                            if (manager.isProviderEnabled(provider)) {
                                offerCached(manager.getLastKnownLocation(provider))
                            }
                        } catch (_: Exception) { }
                    }
                    candidate?.let { if (ageMs(it) <= 20_000L) finish(it, false) }
                    if (!finished) {
                        handler.postDelayed(timeout, 17_000L)
                        val callback = object : LocationListener {
                            override fun onLocationChanged(fix: Location) {
                                if (!finished) finish(fix, false)
                            }
                        }
                        listener = callback
                        try {
                            // Android may restrict GPS provider access to precise
                            // location while still allowing network location.
                            // A SecurityException from GPS must not cancel the
                            // network or fused requests for approximate access.
                            val providers = if (fine)
                                listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
                            else listOf(LocationManager.NETWORK_PROVIDER)
                            for (provider in providers) {
                                try {
                                    if (manager.isProviderEnabled(provider)) {
                                        manager.requestSingleUpdate(
                                            provider, callback, Looper.getMainLooper()
                                        )
                                    }
                                } catch (_: SecurityException) { /* try other providers */ }
                            }
                        } catch (_: Exception) { /* Fused provider is attempted below */ }

                        if (!finished) {
                            try {
                                val client = LocationServices.getFusedLocationProviderClient(context)
                                val request = CurrentLocationRequest.Builder()
                                    .setPriority(if (fine) Priority.PRIORITY_HIGH_ACCURACY
                                        else Priority.PRIORITY_BALANCED_POWER_ACCURACY)
                                    .setMaxUpdateAgeMillis(30_000L)
                                    .setDurationMillis(15_000L)
                                    .build()
                                client.getCurrentLocation(request, cancellation.token)
                                    .addOnSuccessListener { fix ->
                                        if (fix != null && !finished) finish(fix, false)
                                    }
                                    .addOnFailureListener { /* Android providers can still respond */ }
                                client.lastLocation.addOnSuccessListener { fix ->
                                    if (!finished) {
                                        offerCached(fix)
                                        val fresh = candidate
                                        if (fresh != null && ageMs(fresh) <= 20_000L) {
                                            finish(fresh, false)
                                        }
                                    }
                                }
                            } catch (_: SecurityException) {
                                finished = true
                                latestOnLocationError(LocationIssue.Permission)
                            } catch (_: Exception) { /* wait for the native providers */ }
                        }
                    }
                }
            }
        }
        onDispose {
            finished = true
            cancellation.cancel()
            handler.removeCallbacks(timeout)
            listener?.let { runCatching { manager.removeUpdates(it) } }
        }
    }

    AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize())
}
