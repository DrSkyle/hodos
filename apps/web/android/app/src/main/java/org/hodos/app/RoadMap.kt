package org.hodos.app

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
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
@Composable
fun RoadMap(
    hazards: List<RoadHazard>,
    locateRequest: Int,
    onSelect: (RoadHazard) -> Unit,
    onLocated: (Location) -> Unit,
    onLocationError: (String) -> Unit
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

    // A cached fix may be absent or several hours old. Ask Google Play
    // services for a fresh location, then fall back only to a recent cache.
    DisposableEffect(locateRequest, ready) {
        val fine = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val cancelSource = CancellationTokenSource()
        if (ready && (fine || coarse)) {
            val client = LocationServices.getFusedLocationProviderClient(context)
            val showPosition: (Location) -> Unit = { location ->
                if (!cancelSource.token.isCancellationRequested) {
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
            }
            val fallback: () -> Unit = {
                try {
                    client.lastLocation
                        .addOnSuccessListener { cached ->
                            if (!cancelSource.token.isCancellationRequested) {
                                if (cached != null && System.currentTimeMillis() - cached.time < 120_000L) {
                                    showPosition(cached)
                                } else {
                                    latestOnLocationError(
                                        "Can't determine your location. Check Location Services and try outdoors."
                                    )
                                }
                            }
                        }
                        .addOnFailureListener {
                            if (!cancelSource.token.isCancellationRequested) {
                                latestOnLocationError("Location unavailable. Check device location settings.")
                            }
                        }
                } catch (_: SecurityException) {
                    latestOnLocationError("Location permission was revoked. Tap locate to allow it again.")
                }
            }
            try {
                val request = CurrentLocationRequest.Builder()
                    .setPriority(if (fine) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY)
                    .setMaxUpdateAgeMillis(20_000L)
                    .setDurationMillis(12_000L)
                    .build()
                client.getCurrentLocation(request, cancelSource.token)
                    .addOnSuccessListener { location ->
                        if (location != null) showPosition(location) else fallback()
                    }
                    .addOnFailureListener { fallback() }
            } catch (_: SecurityException) {
                latestOnLocationError("Location permission was revoked. Tap locate to allow it again.")
            }
        }
        onDispose { cancelSource.cancel() }
    }

    AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize())
}
