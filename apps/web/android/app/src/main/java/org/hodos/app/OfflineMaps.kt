package org.hodos.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Network
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.module.http.HttpRequestUtil
import org.maplibre.android.offline.OfflineManager
import org.maplibre.android.offline.OfflineRegion
import org.maplibre.android.offline.OfflineRegionError
import org.maplibre.android.offline.OfflineRegionStatus
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition
import java.util.concurrent.TimeUnit
import kotlin.math.cos

data class OfflineMapState(
    val autoEnabled: Boolean = true,
    val status: String = "Waiting for location",
    val downloading: Boolean = false,
    val completed: Int = 0,
    val required: Int = 0,
    val savedRegions: Int = 0,
    val downloadedBytes: Long = 0L,
    val lastLocation: Location? = null,
    val hasPack: Boolean = false
)

/**
 * On-device MapLibre offline packs. All downloads remain on Wi-Fi by default.
 * Each pack covers a 20 km-radius neighborhood at road-relevant zoom 8–13.
 *
 * Provider: OpenFreeMap (explicit offline permission: <=3000 tiles, <=50MB,
 * <=4 concurrent network requests and a distinct User-Agent).
 * This is a conservative subset of the provider limits and is intentionally
 * NOT a generic unrestricted tile downloader.
 */
internal object OfflineMaps {
    const val STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"
    private const val RADIUS_KM = 20.0
    private const val KEEP_REGIONS = 2
    private const val LIMIT_TILES = OfflineDownloadPolicy.MAX_TILES
    private const val LIMIT_BYTES = OfflineDownloadPolicy.MAX_BYTES
    private const val PREFS = "hodos_offline_maps"
    private const val TAG = "HodosOfflineMaps"

    var state by mutableStateOf(OfflineMapState())
        private set

    private lateinit var app: Context
    private lateinit var manager: OfflineManager
    private var initialized = false
    private var listing = false
    private var creating = false
    private val pendingLoads = mutableListOf<() -> Unit>()
    private var current: OfflineRegion? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val regions = mutableListOf<OfflineRegion>()

    @Synchronized
    fun initialize(context: Context) {
        if (initialized) return
        app = context.applicationContext
        state = state.copy(autoEnabled = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean("auto_wifi", true))
        try {
            // MapLibre's HTTP implementation reads the MapLibre singleton from
            // its static initializer. Initialize MapLibre BEFORE touching
            // HttpRequestUtil, or Android crashes with ExceptionInInitializerError.
            MapLibre.getInstance(app)
            // One network client for all MapLibre requests, including offline packs.
            // Provider's parallel-request policy is enforced by OkHttp's dispatcher.
            val dispatcher = Dispatcher().apply {
                maxRequests = 4
                maxRequestsPerHost = 4
            }
            val client = OkHttpClient.Builder()
                .dispatcher(dispatcher)
                .connectTimeout(15L, TimeUnit.SECONDS)
                .readTimeout(30L, TimeUnit.SECONDS)
                .addInterceptor { chain ->
                    chain.proceed(chain.request().newBuilder()
                        .header("User-Agent", "Hodos-Android/1.1 (https://github.com/DrSkyle/hodos)")
                        .build())
                }.build()
            HttpRequestUtil.setOkHttpClient(client)
            manager = OfflineManager.getInstance(app)
            // A hard SDK limit for the two retained packs.
            manager.setOfflineMapboxTileCountLimit(LIMIT_TILES * KEEP_REGIONS)
            initialized = true
            watchConnectivity()
            load()
        } catch (e: Throwable) {
            if (e is VirtualMachineError) throw e
            Log.e(TAG, "Could not initialize offline maps", e)
            state = state.copy(status = "Offline map storage unavailable")
        }
    }

    private fun watchConnectivity() {
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return
        val listener = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = check()
            override fun onLost(network: Network) = check()
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = check()
            private fun check() {
                mainHandler.post {
                    if (!initialized) return@post
                    if (!wifiReady()) {
                        current?.setDownloadState(OfflineRegion.STATE_INACTIVE)
                        if (state.downloading) {
                            state = state.copy(downloading = false,
                                status = "Paused · waiting for Wi-Fi")
                        }
                    } else if (state.autoEnabled && !state.downloading) {
                        state.lastLocation?.let { saveNearby(it) }
                    }
                }
            }
        }
        try {
            if (Build.VERSION.SDK_INT >= 24) cm.registerDefaultNetworkCallback(listener)
            else cm.registerNetworkCallback(
                NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), listener)
        } catch (error: RuntimeException) { Log.w(TAG, "Network events unavailable", error) }
    }

    private fun wifiReady(): Boolean {
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun metadata(region: OfflineRegion): JSONObject? =
        runCatching { JSONObject(String(region.metadata, Charsets.UTF_8)) }
            .getOrNull()?.takeIf { it.optBoolean("hodos") }

    private fun load(onLoaded: (() -> Unit)? = null) {
        if (!initialized) return
        if (onLoaded != null) pendingLoads.add(onLoaded)
        if (listing) return
        listing = true
        manager.listOfflineRegions(object : OfflineManager.ListOfflineRegionsCallback {
            override fun onList(offlineRegions: Array<OfflineRegion>?) {
                listing = false
                regions.clear()
                regions.addAll(offlineRegions.orEmpty().filter { metadata(it) != null })
                state = state.copy(savedRegions = regions.size, hasPack = regions.isNotEmpty())
                if (current == null && regions.isNotEmpty()) {
                    val mostRecent = regions.maxByOrNull { metadata(it)?.optLong("at") ?: 0L }!!
                    mostRecent.getStatus(object : OfflineRegion.OfflineRegionStatusCallback {
                        override fun onStatus(status: OfflineRegionStatus?) {
                            if (status != null) updateCounts(status)
                        }
                        override fun onError(error: String?) { Log.w(TAG, error ?: "Region status error") }
                    })
                }
                val callbacks = pendingLoads.toList()
                pendingLoads.clear()
                callbacks.forEach { it() }
            }
            override fun onError(error: String) {
                pendingLoads.clear()
                listing = false
                state = state.copy(downloading = false, status = "Could not read saved maps")
                Log.w(TAG, error)
            }
        })
    }

    fun setAuto(enabled: Boolean) {
        if (!initialized) return
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("auto_wifi", enabled).apply()
        state = state.copy(autoEnabled = enabled)
        if (!enabled) {
            current?.setDownloadState(OfflineRegion.STATE_INACTIVE)
            state = state.copy(downloading = false, status = "Automatic downloads off")
        } else {
            state.lastLocation?.let { saveNearby(it) }
        }
    }

    /** Called after GPS / fused location returns a user-authorized position. */
    fun onLocation(location: Location) {
        if (!initialized || location.latitude !in -85.0..85.0 ||
            location.longitude !in -180.0..180.0) return
        if (ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_COARSE_LOCATION)
            != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) return
        state = state.copy(lastLocation = location)
        if (state.autoEnabled) saveNearby(location)
    }

    fun saveNearbyNow() {
        state.lastLocation?.let { saveNearby(it, manual = true) }
            ?: run { state = state.copy(status = "Tap the map location button first") }
    }

    private fun withinPack(region: OfflineRegion, location: Location): Boolean {
        val meta = metadata(region) ?: return false
        val result = FloatArray(1)
        Location.distanceBetween(meta.optDouble("lat"), meta.optDouble("lng"),
            location.latitude, location.longitude, result)
        // Avoid re-downloading essentially the same neighborhood.
        return result[0] <= 12_000
    }

    private fun saveNearby(location: Location, manual: Boolean = false) {
        if (!initialized || creating || state.downloading) return
        if (!manual && !state.autoEnabled) return
        // Every automatic entry point (new GPS fix, Wi-Fi reconnection,
        // toggling Auto on) must enforce the same location-quality gate.
        // A manually requested pack is allowed with approximate location.
        if (!manual && !LocationFixPolicy.isFresh(
                location.time, System.currentTimeMillis())) {
            state = state.copy(status =
                "Location is outdated · tap the map location button to refresh")
            return
        }
        if (!manual && !OfflineDownloadPolicy.safeForAutomaticDownload(
                location.hasAccuracy(), location.accuracy)) {
            state = state.copy(status =
                "Location is approximate · tap Save nearby to choose this area")
            return
        }
        if (!wifiReady()) {
            current?.setDownloadState(OfflineRegion.STATE_INACTIVE)
            state = state.copy(downloading = false,
                status = "Waiting for Wi-Fi · saved maps remain available")
            return
        }
        load {
            val nearest = regions.firstOrNull { withinPack(it, location) }
            if (nearest != null) {
                current = nearest
                nearest.getStatus(object : OfflineRegion.OfflineRegionStatusCallback {
                    override fun onStatus(status: OfflineRegionStatus?) {
                        if (status != null && status.isComplete && status.requiredResourceCount > 0 && status.isRequiredResourceCountPrecise) {
                            updateCounts(status)
                            state = state.copy(status = "Nearby map ready offline", downloading = false)
                        } else start(nearest)
                    }
                    override fun onError(error: String?) { start(nearest) }
                })
                return@load
            }
            if (regions.size >= KEEP_REGIONS) {
                val oldest = regions.minByOrNull { metadata(it)?.optLong("at") ?: 0L }
                    ?: return@load
                oldest.setDownloadState(OfflineRegion.STATE_INACTIVE)
                oldest.delete(object : OfflineRegion.OfflineRegionDeleteCallback {
                    override fun onDelete() {
                        regions.remove(oldest)
                        create(location)
                    }
                    override fun onError(error: String) {
                        state = state.copy(status = "Could not free offline map storage")
                    }
                })
            } else create(location)
        }
    }

    private fun create(location: Location) {
        if (!initialized || creating || !wifiReady()) return
        creating = true
        // Approximate 20km-radius bounds, clamped near the poles/dateline.
        val latDelta = RADIUS_KM / 111.32
        val lngDelta = RADIUS_KM / (111.32 * cos(Math.toRadians(location.latitude))
            .coerceAtLeast(0.20))
        val south = (location.latitude - latDelta).coerceAtLeast(-85.0)
        val north = (location.latitude + latDelta).coerceAtMost(85.0)
        val west = (location.longitude - lngDelta).coerceAtLeast(-180.0)
        val east = (location.longitude + lngDelta).coerceAtMost(180.0)
        val definition = OfflineTilePyramidRegionDefinition(
            STYLE_URL, LatLngBounds.from(north, east, south, west),
            8.0, 13.0, 1.0f, false
        )
        val meta = JSONObject().put("hodos", true)
            .put("lat", location.latitude).put("lng", location.longitude)
            .put("at", System.currentTimeMillis())
        state = state.copy(status = "Preparing nearby map…")
        manager.createOfflineRegion(definition, meta.toString().toByteArray(Charsets.UTF_8),
            object : OfflineManager.CreateOfflineRegionCallback {
                override fun onCreate(offlineRegion: OfflineRegion) {
                    creating = false
                    regions.add(offlineRegion)
                    current = offlineRegion
                    state = state.copy(savedRegions = regions.size, hasPack = true)
                    start(offlineRegion)
                }
                override fun onError(error: String) {
                    creating = false
                    state = state.copy(downloading = false, status = "Offline map couldn't start")
                    Log.e(TAG, error)
                }
            })
    }

    private fun updateCounts(status: OfflineRegionStatus) {
        state = state.copy(
            completed = status.completedResourceCount.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
            required = status.requiredResourceCount.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
            downloadedBytes = status.completedResourceSize
        )
    }

    private fun start(region: OfflineRegion) {
        if (!wifiReady()) {
            state = state.copy(status = "Waiting for Wi-Fi", downloading = false)
            return
        }
        current?.takeIf { it.id != region.id }?.setDownloadState(OfflineRegion.STATE_INACTIVE)
        current = region
        region.setObserver(object : OfflineRegion.OfflineRegionObserver {
            override fun onStatusChanged(status: OfflineRegionStatus) {
                updateCounts(status)
                when (OfflineDownloadPolicy.evaluate(
                    wifi = wifiReady(),
                    complete = status.isComplete,
                    preciseCount = status.isRequiredResourceCountPrecise,
                    requiredResources = status.requiredResourceCount,
                    completedTiles = status.completedTileCount,
                    completedBytes = status.completedResourceSize
                )) {
                    OfflineDownloadPolicy.Decision.CONTINUE -> Unit
                    OfflineDownloadPolicy.Decision.WAIT_FOR_WIFI -> {
                        region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                        state = state.copy(downloading = false,
                            status = "Paused · waiting for Wi-Fi")
                    }
                    OfflineDownloadPolicy.Decision.COMPLETE -> {
                        region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                        state = state.copy(downloading = false,
                            status = "Nearby map ready offline")
                    }
                    OfflineDownloadPolicy.Decision.PROVIDER_LIMIT -> {
                        region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                        state = state.copy(downloading = false,
                            status = "Not fully downloaded · provider safety limit reached")
                    }
                }
            }
            override fun onError(error: OfflineRegionError) {
                Log.w(TAG, "Offline tile problem: ${error.message}")
                region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                state = state.copy(downloading = false,
                    status = "Offline download interrupted · tap Save nearby to retry")
            }
            override fun mapboxTileCountLimitExceeded(limit: Long) {
                region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                state = state.copy(downloading = false, status = "Offline tile storage limit reached")
            }
        })
        state = state.copy(status = "Saving nearby roads…", downloading = true)
        region.setDownloadState(OfflineRegion.STATE_ACTIVE)
    }

    fun clear() {
        if (!initialized) return
        current?.setDownloadState(OfflineRegion.STATE_INACTIVE)
        current = null
        state = state.copy(downloading = false, status = "Removing offline maps…")
        load {
            val pending = regions.toList()
            if (pending.isEmpty()) {
                state = state.copy(savedRegions = 0, hasPack = false,
                    status = "No downloaded regions")
                return@load
            }
            var remaining = pending.size
            pending.forEach { region ->
                region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                region.delete(object : OfflineRegion.OfflineRegionDeleteCallback {
                    override fun onDelete() {
                        regions.remove(region)
                        remaining--
                        if (remaining == 0) state = state.copy(savedRegions = 0,
                            hasPack = false, completed = 0, required = 0,
                            downloadedBytes = 0, status = "Offline maps removed")
                    }
                    override fun onError(error: String) {
                        remaining--
                        state = state.copy(status = "Some maps couldn't be removed")
                    }
                })
            }
        }
    }
}
