package org.hodos.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.text.format.DateFormat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.roundToInt

private enum class Screen(val label: String) {
    MAP("Map"),
    MAPPING("Drive"),
    ROADS("Roads"),
    INSIGHTS("Insights"),
    YOU("You"),
    GARAGE("Garage")
}

/** The route bar's stops. The Garage sits in the middle and is the one stop
 *  that draws in amber: it is the product's earning surface and the shelf
 *  people actually open, so it must never be buried behind a menu. */
private val ROUTE_TABS = listOf(
    Screen.MAP, Screen.MAPPING, Screen.GARAGE, Screen.ROADS, Screen.INSIGHTS, Screen.YOU
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HodosApp(
    armed: Boolean,
    refreshSignal: Int,
    onToggle: (Boolean) -> Unit,
    onRefresh: () -> Unit,
    onStartJourney: () -> Unit,
    onFinishJourney: () -> Unit,
    onRequestBackgroundLocation: () -> Unit = {},
    onRequestBatteryOptimization: () -> Unit = {},
    onRequestLocationPermission: () -> Unit = {}
) {
    val context = LocalContext.current
    val internetConnected by rememberInternetConnectivity()
    val haptic = LocalHapticFeedback.current
    val repo = remember { HazardRepository(context) }
    val offlineMaps = remember(context) {
        OfflineMaps.initialize(context)
        OfflineMaps
    }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val sheetState = rememberBottomSheetScaffoldState()
    var locateRequest by remember { mutableIntStateOf(0) }
    var locationIssue by remember { mutableStateOf<LocationIssue?>(null) }
    var locating by remember { mutableStateOf(false) }
    val locationSettingsLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        locationIssue = null
        locating = true
        locateRequest++
    }
    // A missing map style or stalled provider must never leave the locate
    // control spinning forever.
    LaunchedEffect(locateRequest) {
        if (locateRequest > 0) {
            delay(19_000L)
            if (locating) {
                locating = false
                locationIssue = LocationIssue.Timeout
            }
        }
    }
    var screen by remember { mutableStateOf(Screen.MAP) }
    var hazards by remember { mutableStateOf(repo.savedHazards()) }
    var trips by remember { mutableStateOf(repo.savedTrips()) }
    var loading by remember { mutableStateOf(false) }
    var syncError by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<RoadHazard?>(null) }
    var query by remember { mutableStateOf("") }
    var filterVisible by remember { mutableStateOf(false) }
    var severity by remember { mutableStateOf("All") }
    var lastKnownLocation by remember { mutableStateOf<Location?>(null) }
    var latestRelease by remember { mutableStateOf<AppReleaseInfo?>(null) }
    // Non-null while an update APK streams in: 0 at start, 100 when verified.
    var updateDownload by remember { mutableStateOf<Int?>(null) }

    fun startInAppUpdate(release: AppReleaseInfo) {
        if (updateDownload != null) return
        scope.launch {
            updateDownload = 0
            val apk = AppUpdateAndShare.downloadUpdate(context, release) { percent ->
                updateDownload = percent
            }
            updateDownload = null
            if (apk != null) {
                AppUpdateAndShare.installApk(context, apk)
            } else {
                val result = snackbar.showSnackbar(
                    "Update download failed",
                    actionLabel = "Open releases"
                )
                if (result == SnackbarResult.ActionPerformed) {
                    AppUpdateAndShare.openReleasesPage(context)
                }
            }
        }
    }

    LaunchedEffect(internetConnected, refreshSignal) {
        if (internetConnected) {
            when (val check = AppUpdateAndShare.checkLatestRelease(context)) {
                is UpdateCheck.Available -> latestRelease = check.release
                is UpdateCheck.UpToDate -> latestRelease = null
                UpdateCheck.Failed -> Unit
            }
        }
    }
    var partners by remember { mutableStateOf<List<PartnerPoi>>(emptyList()) }
    LaunchedEffect(internetConnected) {
        if (internetConnected) {
            val loaded = PartnerOffers.load()
            if (loaded.isNotEmpty()) partners = loaded
        }
    }
    // After foreground location permission is granted, automatically locate
    // once so the Wi-Fi-only neighborhood pack can be downloaded. When it is
    // not granted the map must say so, not sit silently on the world view.
    var locationPermissionMissing by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val fine = ContextCompat.checkSelfPermission(context,
            Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context,
            Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (fine || coarse) {
            locating = true
            locateRequest++
        } else {
            locationPermissionMissing = true
        }
    }
    // Re-check after the user returns from the permission dialog.
    LaunchedEffect(refreshSignal) {
        locationPermissionMissing = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_COARSE_LOCATION
            ) != PackageManager.PERMISSION_GRANTED
    }
    val prefs = remember { context.getSharedPreferences("hodos", android.content.Context.MODE_PRIVATE) }
    var savedRoadIds by remember { mutableStateOf(SavedRoadsStore.load(prefs)) }
    fun updateSavedRoad(id: String, save: Boolean) {
        val result = SavedRoadsStore.setSaved(prefs, id, save)
        savedRoadIds = result
    }
    var tripActive by remember { mutableStateOf(prefs.getBoolean("tripActive", false)) }
    var tripElapsedS by remember { mutableLongStateOf(0L) }
    var tripDistanceM by remember { mutableFloatStateOf(0f) }
    var tripImpacts by remember { mutableIntStateOf(0) }
    var backgroundLocationGranted by remember { mutableStateOf(false) }
    var batteryOptimizationIgnored by remember { mutableStateOf(false) }

    fun checkDevicePermissions() {
        backgroundLocationGranted = if (Build.VERSION.SDK_INT >= 29) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        } else true

        val powerManager = context.getSystemService(android.content.Context.POWER_SERVICE) as? android.os.PowerManager
        batteryOptimizationIgnored = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && powerManager != null) {
            powerManager.isIgnoringBatteryOptimizations(context.packageName)
        } else true
    }

    var waitingUploads by remember { mutableIntStateOf(0) }
    var rejectedUploads by remember { mutableIntStateOf(0) }
    var syncMetricsReady by remember { mutableStateOf(false) }
    LaunchedEffect(screen, refreshSignal) {
        checkDevicePermissions()
        while (screen == Screen.MAPPING) {
            val counts = try {
                withContext(Dispatchers.IO) {
                    EventOutbox(context).use { outbox ->
                        Pair(outbox.pendingCount(), outbox.rejectedCount())
                    }
                }
            } catch (_: Exception) { null }
            if (counts == null) {
                syncMetricsReady = false
            } else {
                waitingUploads = counts.first
                rejectedUploads = counts.second
                syncMetricsReady = true
            }
            delay(10_000L)
        }
    }
    LaunchedEffect(screen, refreshSignal) {
        while (screen == Screen.MAPPING) {
            tripActive = prefs.getBoolean("tripActive", false)
            if (tripActive) {
                val startedAt = prefs.getLong("tripStartedAt", 0L)
                tripElapsedS = if (startedAt > 0) (System.currentTimeMillis() - startedAt) / 1000 else 0L
                tripDistanceM = prefs.getFloat("tripDistanceM", 0f)
                tripImpacts = prefs.getInt("tripImpacts", 0)
            } else {
                tripElapsedS = 0L
                tripDistanceM = 0f
                tripImpacts = 0
            }
            delay(1000L)
        }
    }

    LaunchedEffect(internetConnected, lastKnownLocation) {
        if (internetConnected && lastKnownLocation != null) {
            offlineMaps.onLocation(lastKnownLocation!!)
        }
    }

    // Journey trails for the Roads / Insights analyses. Loaded off the main
    // thread and capped so analysis stays instant on long histories.
    var trails by remember { mutableStateOf<List<TripTrail>>(emptyList()) }
    LaunchedEffect(trips) {
        if (trips.isEmpty()) {
            trails = emptyList()
            return@LaunchedEffect
        }
        trails = withContext(Dispatchers.IO) {
            trips.take(60).mapNotNull { trip ->
                TripDetailStore.getTrail(context, trip.tripId ?: trip.at.toString())
            }
        }
    }
    var travelProfile by remember {
        mutableStateOf(prefs.getString("travelProfile", "mixed") ?: "mixed")
    }

    val visibleHazards = remember(hazards, query, severity, lastKnownLocation) {
        hazards.filter { hazard ->
            val matchSeverity = when (severity) {
                "High" -> hazard.severity >= 3 && !hazard.fixed
                "Medium" -> hazard.severity == 2 && !hazard.fixed
                "Low" -> hazard.severity <= 1 && !hazard.fixed
                "Repaired" -> hazard.fixed
                else -> true
            }
            matchSeverity && (
                query.isBlank() ||
                    hazard.title.contains(query.trim(), ignoreCase = true) ||
                    hazard.severityText.contains(query.trim(), ignoreCase = true) ||
                    hazard.id.contains(query.trim(), ignoreCase = true)
                )
        }.sortedWith(
            if (lastKnownLocation != null) compareBy<RoadHazard> { distanceTo(it, lastKnownLocation!!) }
            else compareByDescending<RoadHazard> { !it.fixed }.thenByDescending { it.severity }
        )
    }

    // Re-check the backend after internet connectivity returns or the
    // activity resumes. An API failure is NOT proof the phone is offline.
    LaunchedEffect(refreshSignal, internetConnected) {
        trips = repo.savedTrips()
        if (!internetConnected) {
            hazards = repo.savedHazards()
            syncError = false
            loading = false
        } else {
            loading = true
            try {
                val result = repo.refreshHazards()
                result.onSuccess {
                    hazards = it
                    syncError = false
                }
                result.onFailure {
                    hazards = repo.savedHazards()
                    syncError = true
                }
            } finally {
                loading = false
            }
        }
    }

    HodosTheme {
        Scaffold(
            containerColor = Paper,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                HodosRouteBar(
                    current = screen,
                    onSelect = {
                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        screen = it
                        if (it == Screen.ROADS || it == Screen.INSIGHTS) {
                            travelProfile = prefs.getString("travelProfile", "mixed") ?: "mixed"
                        }
                    },
                    tripActive = tripActive
                )
            }
        ) { insets ->
            Box(Modifier.fillMaxSize().padding(insets)) {
                AnimatedContent(
                    targetState = screen,
                    transitionSpec = {
                        (fadeIn(tween(230, easing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f))) +
                            slideInVertically(
                                tween(300, easing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f))
                            ) { it / 16 })
                            .togetherWith(fadeOut(tween(110)))
                    },
                    label = "hodos screen"
                ) { current ->
                    when (current) {
                    Screen.MAP -> BottomSheetScaffold(
                        scaffoldState = sheetState,
                        sheetPeekHeight = 126.dp,
                        sheetShape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
                        sheetContainerColor = PaperRaised,
                        sheetShadowElevation = 8.dp,
                        sheetDragHandle = {
                            BottomSheetDefaults.DragHandle(color = Line)
                        },
                        sheetContent = {
                            Column(
                                Modifier.fillMaxWidth()
                                    .heightIn(min = 118.dp, max = 480.dp)
                                    .padding(horizontal = 20.dp)
                                    .padding(bottom = 16.dp)
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    DoodleIcon(DoodleSymbol.MAP, Modifier.size(24.dp), Ink)
                                    Spacer(Modifier.width(10.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text("Nearby hazards", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.3).sp)
                                        Text(
                                            (if (visibleHazards.isEmpty()) "No matching road hazards"
                                            else "${visibleHazards.size} on the shared map").uppercase(),
                                            color = Muted, fontSize = 10.sp,
                                            fontFamily = OverpassMono,
                                            fontWeight = FontWeight.SemiBold,
                                            letterSpacing = 0.8.sp
                                        )
                                    }
                                    IconButton(onClick = onRefresh, enabled = !loading) {
                                        if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = AmberDeep)
                                        else Icon(Icons.Outlined.Refresh, contentDescription = "Refresh hazards", tint = Ink)
                                    }
                                }
                                if (trips.isEmpty()) {
                                    Spacer(Modifier.height(12.dp))
                                    Surface(color = Sand, shape = RoundedCornerShape(14.dp)) {
                                        Column(
                                            Modifier.fillMaxWidth().padding(14.dp),
                                            verticalArrangement = Arrangement.spacedBy(6.dp)
                                        ) {
                                            Text(
                                                "No setup needed",
                                                fontWeight = FontWeight.Bold,
                                                fontSize = 14.sp,
                                                color = Ink
                                            )
                                            Text(
                                                "The map works right away. Start a journey and Hodos records the road in the background.",
                                                color = Muted,
                                                fontSize = 12.sp,
                                                lineHeight = 17.sp
                                            )
                                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                Button(
                                                    onClick = onStartJourney,
                                                    shape = RoundedCornerShape(10.dp),
                                                    colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper)
                                                ) {
                                                    Text("Start journey", fontSize = 12.sp)
                                                }
                                                if (!armed) {
                                                    OutlinedButton(
                                                        onClick = { onToggle(true) },
                                                        shape = RoundedCornerShape(10.dp),
                                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink)
                                                    ) {
                                                        Text("Auto-record", fontSize = 12.sp)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Spacer(Modifier.height(14.dp))
                                if (visibleHazards.isEmpty()) {
                                    Row(verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier.fillMaxWidth().padding(vertical = 9.dp)) {
                                        Surface(
                                            color = Sand,
                                            shape = RoundedCornerShape(14.dp)
                                        ) {
                                            DoodleIcon(
                                                if (hazards.isEmpty()) DoodleSymbol.SUN else DoodleSymbol.MAP,
                                                modifier = Modifier.padding(12.dp).size(32.dp),
                                                tint = Ink
                                            )
                                        }
                                        Spacer(Modifier.width(13.dp))
                                        Column {
                                            Text(
                                                if (hazards.isEmpty()) "A blank map is a beginning."
                                                else "Nothing matched just yet.",
                                                fontWeight = FontWeight.Bold, color = Ink,
                                                fontSize = 15.sp
                                            )
                                            Text(
                                                if (hazards.isEmpty()) "As independent journeys confirm bumps, you'll see them here."
                                                else "Try clearing your search or changing the severity filter.",
                                                color = Muted, fontSize = 12.sp, lineHeight = 18.sp
                                            )
                                        }
                                    }
                                } else {
                                    LazyColumn(Modifier.heightIn(max = 260.dp)) {
                                        items(visibleHazards, key = { it.id }) { hazard ->
                                            Box(Modifier.animateItem()) {
                                                HazardRow(hazard, lastKnownLocation?.let { distanceTo(hazard, it) }) { selected = hazard }
                                            }
                                        }
                                    }
                                }
                                Spacer(Modifier.height(10.dp))
                                PartnerOfferBanner(context, partners, visibleHazards)
                            }
                        },
                        containerColor = Color.Transparent
                    ) { sheetInsets ->
                        Box(Modifier.fillMaxSize().padding(sheetInsets)) {
                            RoadMap(
                                hazards = visibleHazards,
                                partners = partners,
                                locateRequest = locateRequest,
                                onSelect = { selected = it },
                                onLocated = {
                                    lastKnownLocation = it
                                    offlineMaps.onLocation(it)
                                    locating = false
                                    locationIssue = null
                                },
                                onLocationError = { issue ->
                                    locating = false
                                    locationIssue = issue
                                }
                            )
                            Column(
                                Modifier.align(Alignment.TopCenter)
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 12.dp)
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    HodosBrand()
                                    Spacer(Modifier.weight(1f))
                                    if (latestRelease?.isNewer == true) {
                                        Surface(
                                            color = Amber,
                                            shape = RoundedCornerShape(10.dp),
                                            border = BorderStroke(1.dp, Ink),
                                            modifier = Modifier.clickable {
                                                startInAppUpdate(latestRelease!!)
                                            }
                                        ) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp)
                                            ) {
                                                val progress = updateDownload
                                                if (progress != null) {
                                                    CircularProgressIndicator(
                                                        progress = { progress / 100f },
                                                        modifier = Modifier.size(13.dp),
                                                        strokeWidth = 2.dp,
                                                        color = Color.White
                                                    )
                                                    Spacer(Modifier.width(6.dp))
                                                    Text(
                                                        if (progress in 1..99) "Downloading $progress%"
                                                        else "Preparing update…",
                                                        color = Color.White,
                                                        fontSize = 10.sp,
                                                        fontWeight = FontWeight.SemiBold,
                                                        fontFamily = OverpassMono
                                                    )
                                                } else {
                                                    Icon(
                                                        Icons.Outlined.Download,
                                                        contentDescription = null,
                                                        tint = Color.White,
                                                        modifier = Modifier.size(13.dp)
                                                    )
                                                    Spacer(Modifier.width(4.dp))
                                                    Text(
                                                        "Update ${latestRelease!!.tagName}",
                                                        color = Color.White,
                                                        fontSize = 10.sp,
                                                        fontWeight = FontWeight.SemiBold,
                                                        fontFamily = OverpassMono
                                                    )
                                                }
                                            }
                                        }
                                        Spacer(Modifier.width(6.dp))
                                    }
                                    Surface(
                                        color = PaperRaised,
                                        shape = RoundedCornerShape(10.dp),
                                        border = BorderStroke(1.dp, Ink)
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier.padding(horizontal = 11.dp, vertical = 8.dp)
                                        ) {
                                            Box(
                                                Modifier.size(6.dp).background(Healed, CircleShape)
                                            )
                                            Spacer(Modifier.width(7.dp))
                                            Text(
                                                (if (loading) "Updating map…"
                                                else if (!internetConnected || syncError) "Saved map"
                                                else "${hazards.count { !it.fixed }} live reports"),
                                                color = Ink, fontSize = 10.sp,
                                                fontWeight = FontWeight.SemiBold,
                                                fontFamily = OverpassMono,
                                                letterSpacing = 0.8.sp
                                            )
                                        }
                                    }
                                }
                                Spacer(Modifier.height(9.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Surface(
                                        modifier = Modifier.weight(1f).height(50.dp),
                                        shape = RoundedCornerShape(14.dp),
                                        color = PaperRaised,
                                        border = BorderStroke(1.dp, Line)
                                    ) {
                                        TextField(
                                            value = query,
                                            onValueChange = { query = it },
                                            singleLine = true,
                                            placeholder = { Text("Search road hazards", fontSize = 14.sp, color = Muted) },
                                            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, tint = Ink) },
                                            modifier = Modifier.fillMaxSize(),
                                            colors = TextFieldDefaults.colors(
                                                focusedTextColor = Ink,
                                                unfocusedTextColor = Ink,
                                                cursorColor = AmberDeep,
                                                focusedContainerColor = Color.Transparent,
                                                unfocusedContainerColor = Color.Transparent,
                                                focusedIndicatorColor = Color.Transparent,
                                                unfocusedIndicatorColor = Color.Transparent,
                                                disabledIndicatorColor = Color.Transparent
                                            )
                                        )
                                    }
                                    Surface(
                                        shape = RoundedCornerShape(14.dp),
                                        color = if (filterVisible) Ink else PaperRaised,
                                        border = BorderStroke(1.dp, if (filterVisible) Ink else Line),
                                        modifier = Modifier.size(50.dp)
                                    ) {
                                        IconButton(
                                            onClick = { filterVisible = !filterVisible },
                                            modifier = Modifier.fillMaxSize()
                                        ) {
                                            Icon(
                                                Icons.Outlined.FilterList,
                                                contentDescription = "Filter hazards",
                                                tint = if (filterVisible) Paper else Ink
                                            )
                                        }
                                    }
                                }
                                if (filterVisible) {
                                    Spacer(Modifier.height(8.dp))
                                    Surface(
                                        shape = RoundedCornerShape(14.dp),
                                        color = PaperRaised,
                                        border = BorderStroke(1.dp, Line)
                                    ) {
                                        Row(
                                            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(8.dp),
                                            horizontalArrangement = Arrangement.spacedBy(7.dp)
                                        ) {
                                            listOf("All", "High", "Medium", "Low", "Repaired").forEach { option ->
                                                FilterChip(
                                                    selected = severity == option,
                                                    onClick = { severity = option },
                                                    label = { Text(option) },
                                                    shape = RoundedCornerShape(10.dp),
                                                    colors = FilterChipDefaults.filterChipColors(
                                                        containerColor = PaperRaised,
                                                        labelColor = Ink,
                                                        selectedContainerColor = Ink,
                                                        selectedLabelColor = Paper
                                                    ),
                                                    border = FilterChipDefaults.filterChipBorder(
                                                        enabled = true,
                                                        selected = severity == option,
                                                        borderColor = if (severity == option) Ink else Line
                                                    )
                                                )
                                            }
                                        }
                                    }
                                }
                                if (locationPermissionMissing) {
                                    Spacer(Modifier.height(8.dp))
                                    Surface(shape = RoundedCornerShape(12.dp), color = Sand) {
                                        Row(
                                            Modifier.fillMaxWidth().padding(horizontal = 11.dp, vertical = 8.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Text(
                                                "Location is off — the map cannot find you or record roads.",
                                                modifier = Modifier.weight(1f),
                                                color = Ink, fontSize = 12.sp, lineHeight = 17.sp
                                            )
                                            TextButton(onClick = onRequestLocationPermission) {
                                                Text("Allow", color = Ink, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                            }
                                        }
                                    }
                                }
                                if (!internetConnected || syncError) {
                                    Surface(shape = RoundedCornerShape(12.dp), color = Mist) {
                                        Row(
                                            Modifier.fillMaxWidth().padding(horizontal = 11.dp, vertical = 6.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Text(
                                                if (!internetConnected) "Offline · saved hazards available; map tiles may need internet"
                                                else "Can't sync hazards · displaying last saved reports",
                                                modifier = Modifier.weight(1f),
                                                color = Ink, fontSize = 12.sp, lineHeight = 17.sp
                                            )
                                            if (internetConnected && syncError) {
                                                TextButton(onClick = onRefresh) { Text("Retry") }
                                            }
                                        }
                                    }
                                }
                            }
                            FilledIconButton(
                                onClick = {
                                    val fine = ContextCompat.checkSelfPermission(
                                        context, Manifest.permission.ACCESS_FINE_LOCATION
                                    ) == PackageManager.PERMISSION_GRANTED
                                    val coarse = ContextCompat.checkSelfPermission(
                                        context, Manifest.permission.ACCESS_COARSE_LOCATION
                                    ) == PackageManager.PERMISSION_GRANTED
                                    if (fine || coarse) {
                                        locating = true
                                        locationIssue = null
                                        locateRequest++
                                    } else {
                                        // Ask the activity for the grants so the
                                        // result flows back through the refresh
                                        // signal and clears the warning banner.
                                        onRequestLocationPermission()
                                    }
                                },
                                colors = IconButtonDefaults.filledIconButtonColors(
                                    containerColor = PaperRaised, contentColor = Ink
                                ),
                                modifier = Modifier.align(Alignment.BottomEnd)
                                    .padding(end = 18.dp, bottom = 18.dp).size(52.dp)
                                    .border(1.dp, Ink, CircleShape)
                            ) {
                                if (locating) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(22.dp),
                                        color = AmberDeep, strokeWidth = 2.5.dp
                                    )
                                } else Icon(Icons.Outlined.MyLocation, contentDescription = "Go to my location")
                            }
                            if (tripActive) {
                                Surface(
                                    onClick = onFinishJourney,
                                    shape = RoundedCornerShape(14.dp),
                                    color = Ink,
                                    modifier = Modifier.align(Alignment.BottomStart)
                                        .padding(start = 18.dp, bottom = 18.dp)
                                ) {
                                    Row(
                                        Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        val pulse = rememberInfiniteTransition(label = "recording pulse")
                                        val dotAlpha by pulse.animateFloat(
                                            initialValue = 1f,
                                            targetValue = 0.25f,
                                            animationSpec = infiniteRepeatable(
                                                animation = tween(650),
                                                repeatMode = androidx.compose.animation.core.RepeatMode.Reverse
                                            ),
                                            label = "recording dot"
                                        )
                                        Box(
                                            Modifier.size(9.dp).graphicsLayer { alpha = dotAlpha }
                                                .background(Amber, CircleShape)
                                        )
                                        Spacer(Modifier.width(9.dp))
                                        Text(
                                            "Recording · Stop",
                                            color = Paper,
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    }
                                }
                            }
                        }
                    }
                    Screen.MAPPING -> MappingScreen(
                        armed = armed,
                        trips = trips,
                        partners = partners,
                        offlineMaps = offlineMaps,
                        onToggle = onToggle,
                        onRefresh = onRefresh,
                        tripActive = tripActive,
                        tripElapsedS = tripElapsedS,
                        tripDistanceM = tripDistanceM,
                        tripImpacts = tripImpacts,
                        backgroundLocationGranted = backgroundLocationGranted,
                        batteryOptimizationIgnored = batteryOptimizationIgnored,
                        onRequestBackgroundLocation = onRequestBackgroundLocation,
                        onRequestBatteryOptimization = onRequestBatteryOptimization,
                        waitingUploads = waitingUploads,
                        rejectedUploads = rejectedUploads,
                        syncMetricsReady = syncMetricsReady,
                        onDeleteRejected = {
                            scope.launch {
                                try {
                                    withContext(Dispatchers.IO) {
                                        EventOutbox(context).use { it.clearRejected() }
                                    }
                                    rejectedUploads = 0
                                    snackbar.showSnackbar("Rejected reports deleted from this device")
                                } catch (_: Exception) {
                                    snackbar.showSnackbar("Could not clear rejected reports")
                                }
                            }
                        },
                        onDeleteQueued = {
                            scope.launch {
                                try {
                                    val removed = withContext(Dispatchers.IO) {
                                        HodosSyncWorker.discardPending(context)
                                    }
                                    waitingUploads = withContext(Dispatchers.IO) {
                                        EventOutbox(context).use { it.pendingCount() }
                                    }
                                    snackbar.showSnackbar(
                                        "$removed unsent reports deleted from this device"
                                    )
                                } catch (_: Exception) {
                                    snackbar.showSnackbar(
                                        "Could not delete unsent reports. Turn mapping off first."
                                    )
                                }
                            }
                        },
                        onStartJourney = onStartJourney,
                        onFinishJourney = onFinishJourney
                    )
                    Screen.ROADS -> RoadsScreen(
                        trails = trails,
                        travelProfile = travelProfile,
                        onBack = { screen = Screen.MAP }
                    )
                    Screen.INSIGHTS -> InsightsScreen(
                        trails = trails,
                        hazards = hazards,
                        onBack = { screen = Screen.MAP }
                    )
                    Screen.GARAGE -> GarageScreen(
                        onBack = { screen = Screen.YOU }
                    )
                    Screen.YOU -> YouScreen(
                        trips = trips,
                        hazards = hazards,
                        savedRoadIds = savedRoadIds,
                        partners = partners,
                        latestRelease = latestRelease,
                        onCheckUpdates = {
                            scope.launch {
                                when (val check = AppUpdateAndShare.checkLatestRelease(context, force = true)) {
                                    is UpdateCheck.Available -> {
                                        latestRelease = check.release
                                        startInAppUpdate(check.release)
                                    }
                                    is UpdateCheck.UpToDate ->
                                        snackbar.showSnackbar("You are on the latest Hodos release (${check.tagName})")
                                    UpdateCheck.Failed -> {
                                        val result = snackbar.showSnackbar(
                                            "Couldn't reach GitHub for updates",
                                            actionLabel = "Open releases"
                                        )
                                        if (result == SnackbarResult.ActionPerformed) {
                                            AppUpdateAndShare.openReleasesPage(context)
                                        }
                                    }
                                }
                            }
                        },
                        onSelectSavedRoad = { selected = it },
                        onRemoveSavedRoad = { id -> updateSavedRoad(id, false) },
                        onOpenMapping = { screen = Screen.MAPPING },
                        onOpenGarage = { screen = Screen.GARAGE },
                        onShare = {
                            scope.launch {
                                AppUpdateAndShare.shareInstalledApk(context)
                            }
                        },
                        onClearHistory = {
                        scope.launch {
                            val cleared = withContext(Dispatchers.IO) {
                                TripHistory.clear(prefs)
                            }
                            if (cleared) onRefresh()
                            snackbar.showSnackbar(
                                if (cleared) "Local journey history deleted"
                                else "Could not delete local history"
                            )
                        }
                    })
                }
               }
           }
        }

        locationIssue?.let { issue ->
            val title = when (issue) {
                LocationIssue.Permission -> "Allow location access"
                LocationIssue.Disabled -> "Turn on device location"
                LocationIssue.Timeout -> "Location not available yet"
            }
            val description = when (issue) {
                LocationIssue.Permission ->
                    "Hodos needs location permission to center the map. Approximate location is enough for browsing."
                LocationIssue.Disabled ->
                    "Your phone's Location switch is off. Turn it on in Android settings, then return to Hodos."
                LocationIssue.Timeout ->
                    "Your phone couldn't provide a fresh position. Check Wi-Fi or mobile network location, or try again near a window."
            }
            AlertDialog(
                onDismissRequest = { locationIssue = null },
                title = { Text(title, fontWeight = FontWeight.SemiBold) },
                text = { Text(description, color = Muted) },
                confirmButton = {
                    Button(onClick = {
                        locationIssue = null
                        when (issue) {
                            LocationIssue.Permission -> {
                                locationSettingsLauncher.launch(
                                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                        Uri.parse("package:${context.packageName}"))
                                )
                            }
                            LocationIssue.Disabled -> {
                                locationSettingsLauncher.launch(
                                    Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
                                )
                            }
                            LocationIssue.Timeout -> {
                                locating = true
                                locateRequest++
                            }
                        }
                    }) {
                        Text(if (issue == LocationIssue.Timeout) "Try again" else "Open settings")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { locationIssue = null }) { Text("Not now") }
                }
            )
        }

        selected?.let { hazard ->
            ModalBottomSheet(
                onDismissRequest = { selected = null },
                containerColor = PaperRaised
            ) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 34.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(hazard.title, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.4).sp, modifier = Modifier.weight(1f))
                        Surface(
                            color = if (hazard.fixed) Healed else Amber,
                            shape = RoundedCornerShape(6.dp)
                        ) {
                            Text(
                                (if (hazard.fixed) "Repaired" else "Level ${hazard.severity}").uppercase(),
                                color = Color.White,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.SemiBold,
                                fontFamily = OverpassMono,
                                letterSpacing = 0.8.sp,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                    }
                    Spacer(Modifier.height(5.dp))
                    Text(
                        ((if (hazard.fixed) "Reported repaired" else hazard.severityText + " severity") +
                            " · ${(hazard.confidence * 100).roundToInt()}/100 evidence score").uppercase(),
                        color = Muted,
                        fontSize = 10.sp,
                        fontFamily = OverpassMono,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 0.7.sp
                    )
                    Spacer(Modifier.height(18.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        DetailStat("${hazard.passes}", "Passes", Modifier.weight(1f))
                        DetailStat("${hazard.devices}", "Devices", Modifier.weight(1f))
                        DetailStat("${hazard.clearPasses}", "Clear passes", Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(15.dp))
                    OutlinedButton(
                        onClick = {
                            val wasSaved = selected!!.id in savedRoadIds
                            updateSavedRoad(selected!!.id, !wasSaved)
                            scope.launch {
                                snackbar.showSnackbar(
                                    if (wasSaved) "Removed from your saved roads"
                                    else "Saved on this phone. Check back for road updates."
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink)
                    ) {
                        Icon(
                            if (selected!!.id in savedRoadIds)
                                Icons.Outlined.CheckCircle else Icons.Outlined.Map,
                            contentDescription = null
                        )
                        Spacer(Modifier.width(9.dp))
                        Text(
                            if (selected!!.id in savedRoadIds) "Saved to My Roads · Remove"
                            else "Save this road"
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(
                        onClick = {
                            val receipt = buildString {
                                append("Hodos road report: ").append(hazard.title)
                                append(" · ").append(hazard.passes).append(" passes")
                                append(", ").append(hazard.devices).append(" devices")
                                append(", ").append(hazard.clearPasses).append(" clear passes")
                                append(" · ").append((hazard.confidence * 100).roundToInt())
                                append("/100 evidence score")
                                append("\nhttps://hodos.devilabs.dev/map")
                            }
                            val send = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, receipt)
                            }
                            context.startActivity(Intent.createChooser(send, "Share road report"))
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink)
                    ) {
                        Icon(Icons.Outlined.Share, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (hazard.fixed) "Share repair receipt" else "Share road report")
                    }
                    Spacer(Modifier.height(16.dp))
                    Text("Your feedback is a manual report, not a measured sensor reading. Hodos keeps it on this phone until it can upload.", color = Muted, fontSize = 13.sp)
                    Spacer(Modifier.height(18.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    val result = repo.sendObservation(hazard, repaired = false)
                                    snackbar.showSnackbar(if (result.isSuccess) "Saved on this phone · will sync online" else "Could not save report on this phone")
                                    if (result.isSuccess) { selected = null; onRefresh() }
                                }
                            }, modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink)
                        ) { Text("Still there") }
                        Button(
                            enabled = !hazard.fixed,
                            onClick = {
                                scope.launch {
                                    val result = repo.sendObservation(hazard, repaired = true)
                                    snackbar.showSnackbar(if (result.isSuccess) "Repair report saved · will sync online" else "Could not save report on this phone")
                                    if (result.isSuccess) { selected = null; onRefresh() }
                                }
                            }, modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper)
                        ) { Text("Mark fixed") }
                    }
                }
            }
        }
    }
}

@Composable
private fun HodosRouteBar(current: Screen, onSelect: (Screen) -> Unit, tripActive: Boolean = false) {
    // Simple bottom navigation: three circular stops with labels. The active
    // stop fills ink and gets an amber tick; Record pulses while recording.
    Surface(color = PaperRaised) {
        Column(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars)) {
            HorizontalDivider(color = Line, thickness = 1.dp)
            Row(Modifier.fillMaxWidth().height(84.dp)) {
                ROUTE_TABS.forEach { tab ->
                    val active = current == tab
                    val highlight = tab == Screen.GARAGE
                    val nodeScale by animateFloatAsState(
                        targetValue = if (active) 1.07f else 0.94f,
                        animationSpec = spring(dampingRatio = 0.55f, stiffness = 420f),
                        label = "route node"
                    )
                    Column(
                        Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .clickable { onSelect(tab) }
                            .padding(top = 14.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Box {
                            Box(
                                Modifier.size(44.dp)
                                    .graphicsLayer {
                                        scaleX = nodeScale
                                        scaleY = nodeScale
                                    }
                                    .background(
                                        when {
                                            active -> Ink
                                            highlight -> Amber
                                            else -> PaperRaised
                                        },
                                        CircleShape
                                    )
                                    .border(
                                        1.5.dp,
                                        when {
                                            active -> Ink
                                            highlight -> AmberDeep
                                            else -> Line
                                        },
                                        CircleShape
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                DoodleIcon(
                                    symbol = when (tab) {
                                        Screen.MAP -> DoodleSymbol.MAP
                                        Screen.MAPPING -> DoodleSymbol.CAR
                                        Screen.ROADS -> DoodleSymbol.ROAD
                                        Screen.INSIGHTS -> DoodleSymbol.INSIGHT
                                        Screen.GARAGE -> DoodleSymbol.CAR
                                        else -> DoodleSymbol.PERSON
                                    },
                                    tint = if (active) Paper else if (highlight) Paper else Muted,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                            if (tab == Screen.MAPPING && tripActive) {
                                val pulse = rememberInfiniteTransition(label = "record badge")
                                val badgeAlpha by pulse.animateFloat(
                                    initialValue = 1f,
                                    targetValue = 0.3f,
                                    animationSpec = infiniteRepeatable(
                                        animation = tween(650),
                                        repeatMode = androidx.compose.animation.core.RepeatMode.Reverse
                                    ),
                                    label = "record badge alpha"
                                )
                                Box(
                                    Modifier.align(Alignment.TopEnd)
                                        .graphicsLayer { alpha = badgeAlpha }
                                        .size(11.dp)
                                        .background(Amber, CircleShape)
                                        .border(1.5.dp, PaperRaised, CircleShape)
                                )
                            }
                        }
                        Spacer(Modifier.height(5.dp))
                        if (active) {
                            Box(
                                Modifier.size(width = 18.dp, height = 3.dp)
                                    .background(Amber, RoundedCornerShape(1.5.dp))
                            )
                            Spacer(Modifier.height(3.dp))
                        }
                        Text(
                            tab.label.uppercase(),
                            fontSize = 9.5.sp,
                            fontWeight = if (highlight) FontWeight.Bold else FontWeight.SemiBold,
                            fontFamily = OverpassMono,
                            letterSpacing = 1.1.sp,
                            color = if (active || highlight) Ink else Muted
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailStat(value: String, title: String, modifier: Modifier = Modifier) {
    Column(
        modifier.clip(RoundedCornerShape(16.dp))
            .background(Sand)
            .padding(horizontal = 14.dp, vertical = 12.dp)
    ) {
        Text(value, fontWeight = FontWeight.ExtraBold, fontSize = 23.sp, color = Ink)
        Text(
            title.uppercase(),
            color = Muted,
            fontSize = 9.5.sp,
            fontFamily = OverpassMono,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.9.sp
        )
    }
}

private fun distanceTo(hazard: RoadHazard, location: Location): Float {
    val result = FloatArray(1)
    Location.distanceBetween(location.latitude, location.longitude, hazard.lat, hazard.lng, result)
    return result[0]
}

@Composable
private fun HazardRow(hazard: RoadHazard, distanceMeters: Float?, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(
            shape = RoundedCornerShape(10.dp),
            color = when {
                hazard.fixed -> Color(0xFFE7F6EF)
                hazard.severity >= 3 -> Color(0xFFFBE9EC)
                else -> Color(0xFFF9EEDD)
            }
        ) {
            DoodleIcon(
                if (hazard.fixed) DoodleSymbol.CHECK else DoodleSymbol.WARNING,
                tint = when {
                    hazard.fixed -> Healed
                    hazard.severity >= 3 -> Pothole
                    else -> Rough
                },
                modifier = Modifier.padding(8.dp).size(24.dp)
            )
        }
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f)) {
            Text(hazard.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Ink)
            Text(
                when {
                    hazard.fixed ->
                        "REPAIRED · ${hazard.clearPasses} CLEAR · ${hazard.devices} DEVICES"
                    distanceMeters != null ->
                        String.format(Locale.US, "%.1f KM", distanceMeters / 1000f) +
                            " AWAY · ${hazard.devices} DEVICE${if (hazard.devices == 1) "" else "S"}"
                    else -> "${hazard.passes} PASSES · ${hazard.devices} DEVICES"
                },
                color = Muted, fontSize = 10.sp,
                fontFamily = OverpassMono,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.6.sp
            )
        }
        Text(
            (if (hazard.fixed) "Repaired" else hazard.severityText).uppercase(),
            color = when {
                hazard.fixed -> Healed
                hazard.severity >= 3 -> Pothole
                else -> AmberDeep
            },
            fontSize = 10.sp,
            fontFamily = OverpassMono,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.6.sp
        )
    }
    HorizontalDivider(color = Line)
}

private fun impactLabel(kind: String): String = when (kind) {
    "speed_bump" -> "speed bump"
    "rough_pavement" -> "rough patch"
    "harsh_brake" -> "hard braking zone"
    "sharp_turn" -> "sharp corner"
    else -> "pothole"
}

private fun formatDuration(seconds: Long): String {
    if (seconds <= 0) return "00:00"
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    val secs = seconds % 60
    return if (hours > 0) {
        String.format(Locale.US, "%d:%02d:%02d", hours, minutes, secs)
    } else {
        String.format(Locale.US, "%02d:%02d", minutes, secs)
    }
}

private fun formatDurationFriendly(seconds: Long): String {
    if (seconds <= 0) return ""
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    return if (hours > 0) {
        "${hours}h ${minutes}m"
    } else {
        "${minutes}m"
    }
}

@Composable
private fun MappingScreen(
    armed: Boolean,
    trips: List<RoadTrip>,
    partners: List<PartnerPoi>,
    offlineMaps: OfflineMaps,
    onToggle: (Boolean) -> Unit,
    onRefresh: () -> Unit,
    tripActive: Boolean,
    tripElapsedS: Long,
    tripDistanceM: Float,
    tripImpacts: Int,
    backgroundLocationGranted: Boolean,
    batteryOptimizationIgnored: Boolean,
    onRequestBackgroundLocation: () -> Unit,
    onRequestBatteryOptimization: () -> Unit,
    waitingUploads: Int,
    rejectedUploads: Int,
    syncMetricsReady: Boolean,
    onDeleteRejected: () -> Unit,
    onDeleteQueued: () -> Unit,
    onStartJourney: () -> Unit,
    onFinishJourney: () -> Unit
) {
    var confirmDiscard by remember { mutableStateOf(false) }
    var confirmDeleteQueued by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("hodos", android.content.Context.MODE_PRIVATE) }
    var selectedTrip by remember { mutableStateOf<RoadTrip?>(null) }
    val listState = rememberLazyListState()
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().background(Paper),
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.spacedBy(17.dp)
    ) {
        item {
            // The header drifts at a fraction of scroll speed, giving the
            // screen a soft depth as the road data slides over it.
            Column(
                Modifier.graphicsLayer {
                    translationY = if (listState.firstVisibleItemIndex == 0)
                        listState.firstVisibleItemScrollOffset * 0.42f else 0f
                }
            ) {
                HodosBrand()
                Spacer(Modifier.height(17.dp))
                Text("Automatic mapping", fontSize = 29.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.6).sp)
                Spacer(Modifier.height(7.dp))
                Text("Go about your day. Hodos quietly learns from the roads you travel.", color = Muted, fontSize = 15.sp)
            }
        }
        item {
            Surface(
                shape = RoundedCornerShape(22.dp),
                color = PaperRaised
            ) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Automatic mapping", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(4.dp))
                            Text(
                                if (armed) "Active · Automatically records when you ride or drive"
                                else "Turn on once · Maps roads hands-free when you move",
                                color = Muted,
                                fontSize = 13.sp
                            )
                        }
                        Switch(
                            checked = armed,
                            onCheckedChange = onToggle,
                            colors = SwitchDefaults.colors(
                                checkedTrackColor = Ink,
                                checkedThumbColor = Paper,
                                uncheckedTrackColor = Sand,
                                uncheckedThumbColor = PaperRaised,
                                uncheckedBorderColor = Line
                            )
                        )
                    }
                    if (tripActive) {
                        Spacer(Modifier.height(12.dp))
                        Surface(color = Ink, shape = RoundedCornerShape(12.dp)) {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                val pulse = rememberInfiniteTransition(label = "trip pulse")
                                val dotAlpha by pulse.animateFloat(
                                    initialValue = 1f,
                                    targetValue = 0.25f,
                                    animationSpec = infiniteRepeatable(
                                        animation = tween(650),
                                        repeatMode = androidx.compose.animation.core.RepeatMode.Reverse
                                    ),
                                    label = "trip dot"
                                )
                                Box(
                                    Modifier.size(9.dp).graphicsLayer { alpha = dotAlpha }
                                        .background(Amber, CircleShape)
                                )
                                Spacer(Modifier.width(10.dp))
                                Text(
                                    "Recording · ${formatDuration(tripElapsedS)} · " +
                                        (if (tripDistanceM >= 1000f) String.format(Locale.US, "%.1f km", tripDistanceM / 1000f) else "${tripDistanceM.roundToInt()} m") +
                                        " · $tripImpacts hazards",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Paper,
                                    modifier = Modifier.weight(1f)
                                )
                                TextButton(onClick = onFinishJourney) {
                                    Text("Stop", fontSize = 12.sp, color = Amber, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    } else {
                        Spacer(Modifier.height(12.dp))
                        Button(
                            onClick = onStartJourney,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper)
                        ) {
                            DoodleIcon(DoodleSymbol.CAR, modifier = Modifier.size(18.dp), tint = Paper)
                            Spacer(Modifier.width(8.dp))
                            Text("Start a journey", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "Starts recording immediately. Automatic detection also begins a journey once you are moving.",
                            color = Muted,
                            fontSize = 12.sp
                        )
                    }
                }
            }
        }
        item {
            RoadkeeperCard(trips)
        }
        item {
            PerksCard(trips, partners)
        }
        item {
            Surface(
                shape = RoundedCornerShape(22.dp),
                color = PaperRaised
            ) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Text(
                        "Nearby service",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = Ink
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Local garages, tire shops and fuel stops with a pin on the map. From $0.19 a day in much of the world, in your own currency.",
                        fontSize = 13.sp,
                        color = Muted,
                        lineHeight = 18.sp
                    )
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse(Garage.SITE_URL + "/partners"))
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(999.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper)
                    ) {
                        Text("Put your shop on the map", fontSize = 12.sp)
                    }
                }
            }
        }
        if (trips.isNotEmpty() && (!backgroundLocationGranted || !batteryOptimizationIgnored)) {
            item {
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = Sand,
                    shadowElevation = 0.dp
                ) {
                    Column(Modifier.padding(20.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Shield, contentDescription = null, tint = Forest)
                            Spacer(Modifier.width(10.dp))
                            Text("Background reliability", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Spacer(Modifier.height(6.dp))
                        Text("Allow both settings below so Android never stops Hodos while you use maps, music, or any other app:", color = Muted, fontSize = 13.sp)
                        if (!backgroundLocationGranted) {
                            Spacer(Modifier.height(10.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("Location: Allow all the time", fontWeight = FontWeight.Medium, fontSize = 13.sp)
                                    Text("Required for hands-free background detection", color = Muted, fontSize = 11.5.sp)
                                }
                                Button(
                                    onClick = onRequestBackgroundLocation,
                                    colors = ButtonDefaults.buttonColors(containerColor = Forest)
                                ) {
                                    Text("Allow", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                }
                            }
                        }
                        if (!batteryOptimizationIgnored) {
                            Spacer(Modifier.height(8.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("Battery: Unrestricted", fontWeight = FontWeight.Medium, fontSize = 13.sp)
                                    Text("Prevents battery saver from stopping trips", color = Muted, fontSize = 11.5.sp)
                                }
                                Button(
                                    onClick = onRequestBatteryOptimization,
                                    colors = ButtonDefaults.buttonColors(containerColor = Forest)
                                ) {
                                    Text("Allow", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }
        }

        // Offline nearby maps
        item {
            val saved = offlineMaps.state
            Surface(
                shape = RoundedCornerShape(22.dp),
                color = PaperRaised
            ) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        DoodleIcon(DoodleSymbol.MAP, modifier = Modifier.size(24.dp), tint = Ink)
                        Spacer(Modifier.width(10.dp))
                        Text("Offline nearby maps", fontSize = 17.sp,
                            fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Switch(
                            checked = saved.autoEnabled,
                            onCheckedChange = { offlineMaps.setAuto(it) },
                            colors = SwitchDefaults.colors(
                                checkedTrackColor = Ink,
                                checkedThumbColor = Paper,
                                uncheckedTrackColor = Sand,
                                uncheckedThumbColor = PaperRaised,
                                uncheckedBorderColor = Line
                            )
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text("Automatically save roads within 20 km on Wi-Fi after you allow location.",
                        fontSize = 13.sp, color = Muted)
                    Spacer(Modifier.height(10.dp))
                    Text(saved.status, fontSize = 13.sp, color = Ink,
                        fontWeight = FontWeight.SemiBold)
                    if (saved.downloading && saved.required > 0) {
                        Spacer(Modifier.height(8.dp))
                        LinearProgressIndicator(
                            progress = { (saved.completed.toFloat() / saved.required).coerceIn(0f, 1f) },
                            modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                            color = Amber,
                            trackColor = Sand,
                            strokeCap = androidx.compose.ui.graphics.StrokeCap.Round
                        )
                    }
                    Text(
                        "${saved.savedRegions} saved areas · ${saved.downloadedBytes / (1024 * 1024)} MB current area · zoom 8–13",
                        fontSize = 11.sp, color = Muted,
                        fontFamily = OverpassMono, fontWeight = FontWeight.SemiBold, letterSpacing = 0.4.sp
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = { offlineMaps.saveNearbyNow() },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink)
                        ) { Text("Save nearby", fontSize = 12.sp) }
                        TextButton(onClick = { offlineMaps.clear() }) {
                            Text("Remove maps", fontSize = 12.sp, color = Muted)
                        }
                    }
                }
            }
        }

        // Observation Sync
        item {
            Surface(
                shape = RoundedCornerShape(22.dp),
                color = PaperRaised
            ) {
                Column(Modifier.fillMaxWidth().padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Shield, contentDescription = null, tint = Ink)
                        Spacer(Modifier.width(10.dp))
                        Text("Observation sync", fontSize = 17.sp,
                            fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        when {
                            !syncMetricsReady -> "Sync status unavailable on this device"
                            waitingUploads > 0 -> "$waitingUploads reports safely saved here · will retry online"
                            else -> "No road observations waiting to upload"
                        },
                        color = if (!syncMetricsReady) Danger else Muted,
                        fontSize = 13.sp
                    )
                    if (syncMetricsReady && waitingUploads > 0 && !armed && !tripActive) {
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "You can discard unsent reports while mapping is off. " +
                                "Reports already accepted by the server cannot be recalled.",
                            color = Muted, fontSize = 13.sp
                        )
                        TextButton(onClick = { confirmDeleteQueued = true }) {
                            Text("Delete unsent reports", color = Danger)
                        }
                    }
                    if (syncMetricsReady && rejectedUploads > 0) {
                        Spacer(Modifier.height(10.dp))
                        Text("$rejectedUploads reports were rejected by the server. " +
                            "They are preserved on this device for review and do not block newer reports.",
                            color = Danger, fontSize = 13.sp)
                        TextButton(onClick = { confirmDiscard = true }) {
                            Text("Delete rejected reports")
                        }
                    }
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Your journeys", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
                TextButton(onClick = onRefresh) {
                    Icon(Icons.Outlined.Refresh, null, modifier = Modifier.size(15.dp), tint = Ink)
                    Spacer(Modifier.width(5.dp))
                    Text("Update", color = Ink, fontSize = 12.sp)
                }
            }
        }
        if (trips.isEmpty()) {
            item {
                Surface(
                    color = PaperRaised,
                    shape = RoundedCornerShape(20.dp),
                ) {
                    Column(Modifier.fillMaxWidth().padding(24.dp)) {
                        Icon(Icons.Outlined.History, null, tint = Muted, modifier = Modifier.size(26.dp))
                        Spacer(Modifier.height(12.dp))
                        Text("Your first journey starts here", fontWeight = FontWeight.Bold, fontSize = 17.sp)
                        Spacer(Modifier.height(5.dp))
                        Text("Keep Automatic Mapping enabled and ride or drive normally. Completed trips appear here automatically.", color = Muted, fontSize = 13.sp)
                    }
                }
            }
        } else {
            items(trips, key = { it.at }) { trip ->
                val durationText = trip.durationS?.let { formatDurationFriendly(it) }
                Surface(
                    color = PaperRaised,
                    shape = RoundedCornerShape(18.dp),
                    modifier = Modifier
                        .animateItem()
                        .clickable { selectedTrip = trip }
                ) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        DoodleIcon(DoodleSymbol.DIARY, modifier = Modifier.size(22.dp), tint = Ink)
                        Spacer(Modifier.width(13.dp))
                        Column(Modifier.weight(1f)) {
                            Text(DateFormat.format("d MMM · h:mm a", Date(trip.at)).toString(), fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp)
                            Text(
                                "${trip.impacts} hazards · " +
                                    (if (!durationText.isNullOrEmpty()) "$durationText · " else "") +
                                    (trip.gpsFixes?.let { "$it GPS fixes" } ?: "${trip.locations} spots"),
                                color = Muted, fontSize = 10.sp,
                                fontFamily = OverpassMono, fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp
                            )
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(
                                if (trip.distanceM >= 1000.0)
                                    String.format(Locale.US, "%.1f km", trip.distanceM / 1000.0)
                                else "${trip.distanceM.roundToInt()} m",
                                color = Ink, fontSize = 13.sp,
                                fontWeight = FontWeight.ExtraBold
                            )
                            Spacer(Modifier.height(2.dp))
                            Text("Details & Export", color = AmberDeep, fontSize = 10.sp,
                                fontFamily = OverpassMono, fontWeight = FontWeight.SemiBold, letterSpacing = 0.4.sp)
                        }
                    }
                }
            }
        }
        item {
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = Sand
            ) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.Top) {
                    Icon(Icons.Outlined.Shield, null, tint = Ink)
                    Spacer(Modifier.width(12.dp))
                    Text("Your phone processes movement locally. Only small road observations are submitted, not full sensor recordings.", fontSize = 13.sp, color = Ink)
                }
            }
        }
    }
    if (confirmDeleteQueued) {
        AlertDialog(
            onDismissRequest = { confirmDeleteQueued = false },
            title = { Text("Delete unsent road reports?") },
            text = {
                Text("This permanently removes reports still in this phone's upload queue. " +
                    "An upload that finished before deletion cannot be undone. " +
                    "Already-uploaded reports, rejected reports and local journey history are unaffected.")
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmDeleteQueued = false
                    onDeleteQueued()
                }) { Text("Delete unsent", color = Danger) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDeleteQueued = false }) {
                    Text("Keep reports")
                }
            }
        )
    }
    if (confirmDiscard) {
        AlertDialog(
            onDismissRequest = { confirmDiscard = false },
            title = { Text("Delete rejected reports?") },
            text = {
                Text("This deletes only reports that the server refused. " +
                    "They will no longer be available for diagnosis. " +
                    "Reports still waiting to upload will not be touched.")
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmDiscard = false
                    onDeleteRejected()
                }) { Text("Delete reports", color = Danger) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDiscard = false }) { Text("Keep reports") }
            }
        )
    }
    selectedTrip?.let { trip ->
        val trail = remember(trip) {
            TripDetailStore.getTrail(context, trip.tripId ?: trip.at.toString())
                ?: TripTrail(trip.tripId ?: trip.at.toString(), trip.at, trip.durationS ?: 0L, trip.distanceM, emptyList(), emptyList())
        }
        val score = remember(trail) { RideInsights.roadScore(trail.impacts, trail.distanceM) }
        val events = remember(trail) {
            RideInsights.harshBraking(trail.fixes) + RideInsights.sharpTurns(trail.fixes)
        }
        val worst = remember(trail) {
            trail.impacts.maxByOrNull { it.severity }?.let { impact ->
                impact to RideInsights.distanceAlongMeters(trail.fixes, impact.lat, impact.lng)
            }
        }
        AlertDialog(
            onDismissRequest = { selectedTrip = null },
            title = {
                Text(
                    DateFormat.format("EEEE, d MMMM · h:mm a", Date(trip.at)).toString(),
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Distance: " + (if (trip.distanceM >= 1000f) String.format(Locale.US, "%.1f km", trip.distanceM / 1000f) else "${trip.distanceM.roundToInt()} m") +
                        (trip.durationS?.let { " · Duration: " + formatDurationFriendly(it) } ?: ""),
                        color = Ink, fontSize = 14.sp, fontWeight = FontWeight.Medium
                    )
                    Text(
                        "Road defects: ${trip.impacts} hazards recorded" +
                        (trip.gpsFixes?.let { " · $it GPS fixes" } ?: ""),
                        color = Muted, fontSize = 13.sp
                    )
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        DetailStat("${score.score}", "Road score", Modifier.weight(1f))
                        DetailStat(
                            "${events.count { it.kind == "harsh_brake" }}",
                            "Hard brakes",
                            Modifier.weight(1f)
                        )
                        DetailStat(
                            "${events.count { it.kind == "sharp_turn" }}",
                            "Sharp turns",
                            Modifier.weight(1f)
                        )
                    }
                    Text(
                        "Grade: ${score.grade} · " +
                            String.format(Locale.US, "%.1f defects/km", score.defectsPerKm),
                        color = Muted, fontSize = 12.sp
                    )
                    worst?.let { (impact, distance) ->
                        Text(
                            "Roughest spot: ${impactLabel(impact.kind)} " +
                                String.format(Locale.US, "%.1f km", distance / 1000f) + " in",
                            color = Muted, fontSize = 12.sp
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    Text("Export this journey to standard GIS / GPS formats for Google Earth, QGIS, or Strava:", color = Muted, fontSize = 12.sp)
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = {
                                val gpx = TripDetailStore.exportGPX(context, trail)
                                TripDetailStore.shareFile(context, gpx, "application/gpx+xml", "Export Hodos GPX Journey")
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Forest),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Outlined.Share, null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Export GPX", fontSize = 12.sp)
                        }
                        OutlinedButton(
                            onClick = {
                                val geojson = TripDetailStore.exportGeoJSON(context, trail)
                                TripDetailStore.shareFile(context, geojson, "application/geo+json", "Export Hodos GeoJSON Journey")
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("GeoJSON", fontSize = 12.sp)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { selectedTrip = null }) {
                    Text("Close", color = Forest, fontWeight = FontWeight.Bold)
                }
            }
        )
    }
}

@Composable
private fun YouScreen(
    trips: List<RoadTrip>,
    hazards: List<RoadHazard>,
    savedRoadIds: Set<String>,
    partners: List<PartnerPoi>,
    latestRelease: AppReleaseInfo?,
    onCheckUpdates: () -> Unit,
    onSelectSavedRoad: (RoadHazard) -> Unit,
    onRemoveSavedRoad: (String) -> Unit,
    onOpenMapping: () -> Unit,
    onOpenGarage: () -> Unit,
    onShare: () -> Unit,
    onClearHistory: () -> Unit
) {
    val total = trips.sumOf { it.impacts }
    val context = LocalContext.current
    val currentVer = remember(context) { AppUpdateAndShare.currentVersionName(context) }
    var confirmClearHistory by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().background(Paper),
        contentPadding = PaddingValues(22.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        item {
            // Slow header parallax: the identity block lags behind the scroll.
            Column(
                Modifier.graphicsLayer {
                    translationY = if (listState.firstVisibleItemIndex == 0)
                        listState.firstVisibleItemScrollOffset * 0.42f else 0f
                }
            ) {
                Spacer(Modifier.height(12.dp))
                HodosBrand()
                Spacer(Modifier.height(16.dp))
                Text("Your Hodos", fontSize = 29.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.6).sp)
                Text("Every journey makes the roads better understood.", color = Muted)
            }
        }
        item {
            // App Updates & Direct APK Sharing (Quick Share / Bluetooth)
            Surface(
                color = if (latestRelease?.isNewer == true) Sand else PaperRaised,
                shape = RoundedCornerShape(20.dp),
            ) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Share, contentDescription = null, tint = Ink)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                if (latestRelease?.isNewer == true)
                                    "Update available · ${latestRelease.tagName}"
                                else "Share APK & In-App Updates",
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp,
                                color = Ink
                            )
                            Text(
                                "Installed v$currentVer" +
                                    (latestRelease?.let { " · Latest GitHub release ${it.tagName}" } ?: ""),
                                fontSize = 11.sp,
                                color = Muted,
                                fontFamily = OverpassMono, fontWeight = FontWeight.SemiBold, letterSpacing = 0.4.sp
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Send the Hodos APK directly to anyone nearby over Quick Share, Bluetooth, or WhatsApp—or pull the newest build straight from GitHub.",
                        fontSize = 13.sp,
                        color = Muted,
                        lineHeight = 18.sp
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = onShare,
                            colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper),
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Icon(Icons.Outlined.Share, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Quick Share APK", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                        OutlinedButton(
                            onClick = onCheckUpdates,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink)
                        ) {
                            Text(
                                if (latestRelease?.isNewer == true) "Install ${latestRelease.tagName}"
                                else "Check Update",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                }
            }
        }
        item {
            RoadDiaryCard(trips, onOpenMapping = onOpenMapping, onShare = onShare)
        }
        item {
            Surface(
                color = PaperRaised,
                shape = RoundedCornerShape(22.dp)
            ) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        DoodleIcon(DoodleSymbol.CAR, modifier = Modifier.size(22.dp), tint = Ink)
                        Spacer(Modifier.width(10.dp))
                        Text("The Garage", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Kit worth keeping in the car — inflators, mounts, dash cams, wipers and tires, " +
                            "linked straight to the shop. Buying through the Garage is how Hodos earns.",
                        fontSize = 13.sp,
                        color = Muted,
                        lineHeight = 18.sp
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = onOpenGarage,
                            colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper),
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Text("Browse the Garage", fontSize = 12.sp)
                        }
                        OutlinedButton(
                            onClick = {
                                context.startActivity(
                                    Intent(Intent.ACTION_VIEW, Uri.parse(Garage.INSTAGRAM_URL))
                                )
                            },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink)
                        ) {
                            Text("Follow us", fontSize = 12.sp)
                        }
                    }
                }
            }
        }
        item {
            SavedRoadsSection(
                savedIds = savedRoadIds,
                hazards = hazards,
                onSelect = onSelectSavedRoad,
                onRemove = onRemoveSavedRoad
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                DetailStat("${trips.size}", "Journeys", Modifier.weight(1f))
                DetailStat("$total", "Defects", Modifier.weight(1f))
                DetailStat("${hazards.count { it.fixed }}", "Healed", Modifier.weight(1f))
            }
        }
        item {
            TravelProfileCard()
        }
        item {
            Surface(
                color = PaperRaised,
                shape = RoundedCornerShape(22.dp)
            ) {
                Column(Modifier.padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        DoodleIcon(DoodleSymbol.CAR, modifier = Modifier.size(22.dp), tint = Ink)
                        Spacer(Modifier.width(10.dp))
                        Text("Free to use. Funded by partners.", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "The map is free. Partner shops can add a labeled offer, and fleets or cities can license aggregated road-quality feeds. Neither ever changes the map itself.",
                        color = Muted, fontSize = 13.sp, lineHeight = 18.sp
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = {
                                context.startActivity(
                                    Intent(
                                        Intent.ACTION_VIEW,
                                        Uri.parse("mailto:hodos@devilabs.dev?subject=Hodos%20Partner%20Placement")
                                    )
                                )
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper),
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Text("Become a partner", fontSize = 12.sp)
                        }
                        OutlinedButton(
                            onClick = {
                                context.startActivity(
                                    Intent(
                                        Intent.ACTION_VIEW,
                                        Uri.parse("mailto:hodos@devilabs.dev?subject=Hodos%20Commercial%20Data%20API")
                                    )
                                )
                            },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink)
                        ) {
                            Text("License data", fontSize = 12.sp)
                        }
                    }
                }
            }
        }
        if (partners.isNotEmpty()) {
            item {
                Surface(
                    color = PaperRaised,
                    shape = RoundedCornerShape(20.dp),
                ) {
                    Column(
                        Modifier.padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            DoodleIcon(DoodleSymbol.CAR, modifier = Modifier.size(20.dp), tint = Ink)
                            Spacer(Modifier.width(10.dp))
                            Text("Partner offers", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        }
                        partners.take(2).forEach { partner ->
                            Surface(
                                color = Sand,
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                                    Text(
                                        partner.offer,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Ink,
                                        lineHeight = 18.sp
                                    )
                                    Spacer(Modifier.height(2.dp))
                                    Text(
                                        "${partner.name} · ${partner.sponsorLabel}",
                                        fontSize = 10.sp,
                                        color = Muted,
                                        fontFamily = OverpassMono, fontWeight = FontWeight.SemiBold, letterSpacing = 0.4.sp
                                    )
                                }
                            }
                        }
                        Text(
                            "Perks are sponsored placements — they never change map data.",
                            fontSize = 11.sp,
                            color = Muted
                        )
                    }
                }
            }
        }
        item {
            Surface(
                color = PaperRaised,
                shape = RoundedCornerShape(22.dp)
            ) {
                Column(Modifier.padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        DoodleIcon(DoodleSymbol.SHIELD, modifier = Modifier.size(22.dp), tint = Ink)
                        Spacer(Modifier.width(10.dp))
                        Text("Privacy comes first", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                    Spacer(Modifier.height(10.dp))
                    Text("The detector runs locally. The app submits road observations so multiple installations can corroborate hazards. Location permission is needed for hands-free mapping.", color = Muted, fontSize = 13.sp)
                    Spacer(Modifier.height(12.dp))
                    Text("Saved journeys contain counts and distance—not your full route. Deleting local history does not retract observations already submitted.", color = Muted, fontSize = 13.sp)
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Your road score, streak and perk progress live only on this phone. " +
                            "Uninstalling Hodos or clearing app data erases them permanently. " +
                            "Export a journey first if you want a copy.",
                        color = Danger,
                        fontSize = 12.sp,
                        lineHeight = 17.sp
                    )
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse("https://hodos.devilabs.dev/privacy.html"))
                        )
                    }) { Text("Read the full privacy notice") }
                    if (trips.isNotEmpty()) {
                        TextButton(onClick = { confirmClearHistory = true }) {
                            Text("Delete local journey history", color = Danger)
                        }
                    }
                }
            }
        }
        item {
            Text(
                "Hodos v$currentVer · hodos@devilabs.dev",
                color = Muted,
                fontSize = 10.5.sp,
                fontFamily = OverpassMono,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.5.sp,
                modifier = Modifier.fillMaxWidth(),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
        }
    }
    if (confirmClearHistory) {
        AlertDialog(
            onDismissRequest = { confirmClearHistory = false },
            title = { Text("Delete local journey history?") },
            text = {
                Text("This clears saved journey dates, distances and impact counts on this phone. " +
                    "It also resets your road score, streak and monthly perk progress. " +
                    "Uninstalling Hodos or clearing app data does the same thing permanently. " +
                    "It cannot delete reports already uploaded to the public map, " +
                    "and it does not delete observations still queued for upload.")
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmClearHistory = false
                    onClearHistory()
                }) { Text("Delete history", color = Danger) }
            },
            dismissButton = {
                TextButton(onClick = { confirmClearHistory = false }) {
                    Text("Keep history")
                }
            }
        )
    }
}

@Composable
private fun PartnerOfferBanner(
    context: android.content.Context,
    partners: List<PartnerPoi>,
    hazards: List<RoadHazard>
) {
    val partner = partners.firstOrNull()
    val localPasses = remember(partner?.id) {
        partner?.let { PartnerPassStore.monthCount(context, it.id) } ?: 0
    }
    val nearby = remember(partner?.id, hazards) {
        partner?.let { PartnerStats.nearby(hazards, it.lat, it.lng) }
    }
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = Sand,
        modifier = Modifier.fillMaxWidth().clickable {
            context.startActivity(
                Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("mailto:hodos@devilabs.dev?subject=Hodos%20Partner%20Placement")
                )
            )
        }
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(color = Amber, shape = RoundedCornerShape(5.dp)) {
                Text(
                    "PARTNER",
                    color = Color.White,
                    fontSize = 8.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = OverpassMono,
                    letterSpacing = 1.sp,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp)
                )
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    partner?.offer ?: "Nearby service offers from partner shops",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    if (partner != null) {
                        val stat = partner.passesThisMonth?.let { "$it drivers passed this month" }
                            ?: localPasses.takeIf { it > 0 }?.let { "You passed this shop $it× this month" }
                            ?: nearby?.takeIf { it.hasSignal }?.let {
                                "${it.maxDevices} devices reporting within 400 m"
                            }
                            ?: "Sponsored"
                        "${partner.name} · $stat"
                    } else {
                        "Labeled placements keep the map free — tap to become a partner."
                    },
                    fontSize = 11.sp,
                    color = Muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun RoadkeeperCard(trips: List<RoadTrip>) {
    val summary = remember(trips) { summarizeRoadDiary(trips, System.currentTimeMillis()) }
    val score = remember(summary) {
        RideInsights.roadScore(summary.impactsThisWeek, summary.distanceMetersThisWeek)
    }
    val streak = remember(trips) { RideInsights.dayStreak(trips, System.currentTimeMillis()) }
    val animatedScore by animateIntAsState(
        targetValue = score.score,
        animationSpec = tween(900),
        label = "roadScore"
    )
    Surface(shape = RoundedCornerShape(18.dp), color = Ink) {
        Column(Modifier.fillMaxWidth().padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Roadkeeper",
                    color = Paper,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f)
                )
                if (trips.isNotEmpty()) {
                    Surface(
                        color = Color.Transparent,
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, Paper.copy(alpha = 0.35f))
                    ) {
                        Text(
                            "FOUNDING",
                            color = Paper,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = OverpassMono,
                            letterSpacing = 1.sp,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                        )
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    "$animatedScore",
                    color = Paper,
                    fontSize = 46.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = (-1.2).sp
                )
                Text(
                    "/100",
                    color = Paper.copy(alpha = 0.6f),
                    fontSize = 14.sp,
                    fontFamily = OverpassMono,
                    modifier = Modifier.padding(start = 2.dp, bottom = 10.dp)
                )
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        score.grade,
                        color = Amber,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp
                    )
                    Text(
                        "Road score",
                        color = Paper.copy(alpha = 0.6f),
                        fontSize = 10.sp,
                        fontFamily = OverpassMono,
                        letterSpacing = 0.8.sp
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            HorizontalDivider(color = Paper.copy(alpha = 0.14f), thickness = 1.dp)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                StatOnDark("${summary.journeysThisWeek}", "journeys")
                StatOnDark(
                    String.format(Locale.US, "%.1f km", summary.distanceMetersThisWeek / 1000.0),
                    "this week"
                )
                StatOnDark("$streak", "day streak")
            }
            Spacer(Modifier.height(10.dp))
            Text(
                when {
                    trips.isEmpty() -> "No rides yet. Your first journey sets your road score."
                    summary.impactsThisWeek == 0 -> "Clean week: no road defects recorded."
                    else -> "${summary.impactsThisWeek} road defects recorded this week."
                },
                color = Paper.copy(alpha = 0.66f),
                fontSize = 12.sp
            )
        }
    }
}

@Composable
private fun PerksCard(trips: List<RoadTrip>, partners: List<PartnerPoi>) {
    val context = LocalContext.current
    val prefs = remember {
        context.getSharedPreferences("hodos", android.content.Context.MODE_PRIVATE)
    }
    val seed = remember { prefs.getString("deviceId", "").orEmpty() }
    val shops = remember(partners) { partners.map { it.name } }
    val summary = remember(trips, shops) {
        Perks.summarize(trips, System.currentTimeMillis(), TimeZone.getDefault(), seed, shops)
    }
    val progress by animateFloatAsState(
        targetValue = summary.progress,
        animationSpec = tween(800),
        label = "perkProgress"
    )
    Surface(
        shape = RoundedCornerShape(22.dp),
        color = PaperRaised
    ) {
        Column(Modifier.fillMaxWidth().padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Your perks",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    String.format(Locale.US, "%.1f km this month", summary.monthlyKm),
                    color = Muted,
                    fontSize = 12.sp
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                if (summary.shops.isEmpty())
                    "Every ride or drive counts. Partner shops appear here as they join."
                else
                    "Every ride or drive counts. Redeem at a listed partner shop.",
                color = Muted,
                fontSize = 13.sp
            )
            Spacer(Modifier.height(14.dp))
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                color = Amber,
                trackColor = Sand,
                strokeCap = androidx.compose.ui.graphics.StrokeCap.Round
            )
            Spacer(Modifier.height(10.dp))
            Text(
                summary.next?.let {
                    val remaining = (it.atKm - summary.monthlyKm).coerceAtLeast(0.0)
                    String.format(Locale.US, "%.1f km to: %s", remaining, it.label)
                } ?: "All monthly perks unlocked",
                color = Ink,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold
            )
            if (summary.unlocked.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Surface(
                    color = Sand,
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, Line)
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            "Unlocked now",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = AmberDeep,
                            fontFamily = OverpassMono,
                            letterSpacing = 1.sp
                        )
                        summary.unlocked.forEach { perk ->
                            Text(
                                "• ${perk.label}",
                                fontSize = 12.sp,
                                color = Ink
                            )
                        }
                        if (summary.shops.isNotEmpty()) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "Redeem at: " + summary.shops.joinToString(", "),
                                fontSize = 11.5.sp,
                                color = Muted
                            )
                        } else {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "No partner shop listed near you yet.",
                                fontSize = 11.5.sp,
                                color = Muted
                            )
                        }
                        summary.code?.let { code ->
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "Show code at the shop: $code",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = AmberDeep
                            )
                        }
                    }
                }
            }
            if (trips.isEmpty()) {
                Spacer(Modifier.height(10.dp))
                Text(
                    "Your first commute starts the count — no extra effort needed.",
                    color = Muted,
                    fontSize = 12.sp
                )
            }
        }
    }
}

@Composable
private fun TravelProfileCard() {
    val context = LocalContext.current
    val prefs = remember {
        context.getSharedPreferences("hodos", android.content.Context.MODE_PRIVATE)
    }
    var profile by remember {
        mutableStateOf(prefs.getString("travelProfile", "mixed") ?: "mixed")
    }
    val options = listOf(
        "car" to "Car",
        "scooter" to "Scooter",
        "bike" to "Bike",
        "mixed" to "Mixed"
    )
    Surface(
        color = PaperRaised,
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(18.dp)) {
            Text("How do you travel?", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Spacer(Modifier.height(4.dp))
            Text(
                "Used to tune perks and detection. Anyone commuting the same road qualifies.",
                color = Muted,
                fontSize = 12.sp
            )
            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                options.forEach { (value, label) ->
                    FilterChip(
                        selected = profile == value,
                        onClick = {
                            profile = value
                            prefs.edit().putString("travelProfile", value).apply()
                        },
                        label = { Text(label) },
                        shape = RoundedCornerShape(10.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            containerColor = PaperRaised,
                            labelColor = Ink,
                            selectedContainerColor = Ink,
                            selectedLabelColor = Paper
                        ),
                        border = FilterChipDefaults.filterChipBorder(
                            enabled = true,
                            selected = profile == value,
                            borderColor = if (profile == value) Ink else Line
                        )
                    )
                }
            }
        }
    }
}

@Composable
private fun StatOnDark(value: String, label: String) {
    Column {
        Text(value, color = Paper, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Text(
            label.uppercase(),
            color = Paper.copy(alpha = 0.55f),
            fontSize = 9.sp,
            fontFamily = OverpassMono,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.9.sp
        )
    }
}

@Composable
private fun HodosBrand() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(
            painter = painterResource(R.drawable.hodos_brand_icon),
            contentDescription = "Hodos road mark",
            contentScale = ContentScale.Fit,
            modifier = Modifier.size(46.dp).clip(RoundedCornerShape(12.dp))
        )
        Spacer(Modifier.width(10.dp))
        Text(
            buildAnnotatedString {
                append("hodos")
                withStyle(SpanStyle(color = Amber)) { append(".") }
            },
            fontSize = 29.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = (-0.8).sp,
            color = Ink
        )
    }
}
