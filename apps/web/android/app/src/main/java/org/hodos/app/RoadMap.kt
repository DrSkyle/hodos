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
import kotlin.math.abs

/**
 * A real native vector map, with MapLibre's Android lifecycle forwarded from
 * the Compose host. Displayed dots are public corroborated hazards only.
 */
enum class LocationIssue {
    Permission, Disabled, Timeout
}

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
    locateRequest: Int,
    onSelect: (RoadHazard) -> Unit,
    onLocated: (Location) -> Unit,
    onLocationError: (LocationIssue) -> Unit
) {
    val context = LocalContext.current
    val lifecycle = (context as ComponentActivity).lifecycle
    val latestHazards by rememberUpdatedState(hazards)
    val latestPartners by rememberUpdatedState(partners)
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
    val savedCamera = remember(context) { MapCameraStore.load(context) }

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
                Style.Builder().fromUri("https://tiles.openfreemap.org/styles/liberty")
            ) { style ->
                try {
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
                // Sponsored pins sit under the hazard layer so safety data always wins.
                style.addSource(GeoJsonSource(
                    "hodos-partners", FeatureCollection.fromFeatures(emptyArray<Feature>())
                ))
                style.addLayer(
                    CircleLayer("hodos-partner-halo", "hodos-partners").withProperties(
                        circleColor(0x24D97706),
                        circleRadius(16f),
                        circleOpacity(0.14f)
                    )
                )
                style.addLayer(
                    CircleLayer("hodos-partner-dots", "hodos-partners").withProperties(
                        // Inverted against hazard dots (white fill + amber ring vs
                        // colored fill + white ring) so sponsorship reads at a glance.
                        circleColor(0xFFFFFDF7.toInt()),
                        circleRadius(9f),
                        circleStrokeColor(0xFFD97706.toInt()),
                        circleStrokeWidth(4f)
                    )
                )
                style.addLayer(
                    CircleLayer("hodos-hazard-dots", "hodos-hazards").withProperties(
                        circleColor(Expression.get("color")),
                        // Severity scales the dot so the worst roads read first,
                        // mirroring the website's live map. The radius ships with
                        // each feature, so no style expressions are needed here.
                        circleRadius(Expression.get("radius")),
                        circleStrokeWidth(2.5f),
                        circleStrokeColor(android.graphics.Color.WHITE),
                        circleOpacity(0.97f)
                    )
                )
                ready = true
                result.addOnMapClickListener { point ->
                    val screen = result.projection.toScreenLocation(point)
                    val hits = result.queryRenderedFeatures(screen, "hodos-hazard-dots")
                    val id = hits.firstOrNull()?.getStringProperty("id")
                    val hazard = latestHazards.firstOrNull { it.id == id }
                    if (hazard != null) {
                        latestOnSelect(hazard)
                        true
                    } else {
                        val partnerHits = runCatching {
                            result.queryRenderedFeatures(screen, "hodos-partner-dots")
                        }.getOrDefault(emptyList())
                        val partnerId = partnerHits.firstOrNull()?.getStringProperty("id")
                        val partner = latestPartners.firstOrNull { it.id == partnerId }
                        if (partner != null) {
                            partnerSelected = partner
                            true
                        } else false
                    }
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

    LaunchedEffect(hazards, ready) {
        if (ready) {
            val features = hazards.map { hazard ->
                Feature.fromGeometry(Point.fromLngLat(hazard.lng, hazard.lat)).apply {
                    addStringProperty("id", hazard.id)
                    addNumberProperty(
                        "radius",
                        if (hazard.fixed) 5.5f
                        else when (hazard.severity) {
                            1 -> 5.0f
                            2 -> 6.5f
                            else -> 8.0f
                        }
                    )
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
                ?.setGeoJson(FeatureCollection.fromFeatures(features))

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

    LaunchedEffect(partners, ready) {
        if (ready) {
            val features = partners.map { partner ->
                Feature.fromGeometry(Point.fromLngLat(partner.lng, partner.lat)).apply {
                    addStringProperty("id", partner.id)
                }
            }
            map?.style?.getSourceAs<GeoJsonSource>("hodos-partners")
                ?.setGeoJson(FeatureCollection.fromFeatures(features))
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
        val localPasses = PartnerPassStore.monthCount(context, activePartner.id)
        val nearby = PartnerStats.nearby(hazards, activePartner.lat, activePartner.lng)
        AlertDialog(
            onDismissRequest = { partnerSelected = null },
            title = { Text(activePartner.name, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    buildString {
                        append(activePartner.sponsorLabel)
                        append(" placement · ")
                        append(activePartner.category.replaceFirstChar { it.uppercase() })
                        append("\n\n")
                        append(activePartner.offer)
                        val stats = activePartner.passesThisMonth
                            ?.let { "$it drivers passed this shop this month" }
                            ?: if (localPasses > 0) {
                                "You passed this shop $localPasses times this month"
                            } else if (nearby.hasSignal) {
                                "${nearby.maxDevices} devices report road conditions within 400 m"
                            } else null
                        if (stats != null) {
                            append("\n\n")
                            append(stats)
                            append("\nAggregated anonymously from trip data. Drivers are never identified.")
                        }
                        if (activePartner.sample) {
                            append("\n\nSample placement — become a partner to claim this spot.")
                        }
                    }
                )
            },
            confirmButton = {
                TextButton(onClick = { partnerSelected = null }) { Text("Close") }
            },
            dismissButton = {
                TextButton(onClick = {
                    partnerSelected = null
                    runCatching {
                        context.startActivity(
                            Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse("mailto:hodos@devilabs.dev?subject=Hodos%20Partner%20Placement")
                            )
                        )
                    }
                }) { Text("Sponsor") }
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
