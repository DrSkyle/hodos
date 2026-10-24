package org.hodos.app

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
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
    onLocated: (Location) -> Unit,
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

    // Only resolve a position after an explicit location-button press.
    // AOSP phones can still locate using Android's providers when Play
    // services are unavailable or return null.
    DisposableEffect(locateRequest, ready) {
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

        fun finishWithLocation(location: Location) {
            if (finished || cancellation.token.isCancellationRequested) return
            if (location.latitude !in -90.0..90.0 || location.longitude !in -180.0..180.0) return
            finished = true
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

        val timeout = Runnable { error(LocationIssue.Timeout) }

        if (ready && locateRequest > 0) {
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
                        if (providers.isNotEmpty()) {
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
                            if (fix != null &&
                                System.currentTimeMillis() - fix.time in 0..120_000L) {
                                finishWithLocation(fix)
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

    AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize())
}
