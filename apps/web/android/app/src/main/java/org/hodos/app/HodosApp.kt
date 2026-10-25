package org.hodos.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.content.pm.PackageManager
import android.location.Location
import android.text.format.DateFormat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
import kotlin.math.roundToInt

private val Ink = Color(0xFF162522)
private val Forest = Color(0xFF125B48)
private val Paper = Color(0xFFF7FAF8)
private val Muted = Color(0xFF687C74)
private val Mist = Color(0xFFEAF3ED)
private val Orange = Color(0xFFC47B29)
private val Danger = Color(0xFFCB4E43)

private enum class Screen(val label: String) { MAP("Map"), MAPPING("Mapping"), YOU("You") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HodosApp(
    armed: Boolean,
    refreshSignal: Int,
    onToggle: (Boolean) -> Unit,
    onRefresh: () -> Unit,
    onStartJourney: () -> Unit,
    onFinishJourney: () -> Unit
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
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions.values.any { it }) {
            locationIssue = null
            locating = true
            locateRequest++
        } else {
            locating = false
            locationIssue = LocationIssue.Permission
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
    // After foreground location permission is granted, automatically locate
    // once so the Wi-Fi-only neighborhood pack can be downloaded.
    LaunchedEffect(Unit) {
        val fine = ContextCompat.checkSelfPermission(context,
            Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context,
            Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (fine || coarse) {
            locating = true
            locateRequest++
        }
    }
    val prefs = remember { context.getSharedPreferences("hodos", android.content.Context.MODE_PRIVATE) }
    var tripActive by remember { mutableStateOf(prefs.getBoolean("tripActive", false)) }
    var waitingUploads by remember { mutableIntStateOf(0) }
    var rejectedUploads by remember { mutableIntStateOf(0) }
    var syncMetricsReady by remember { mutableStateOf(false) }
    LaunchedEffect(screen, refreshSignal) {
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
            delay(1000L)
        }
    }

    LaunchedEffect(internetConnected, lastKnownLocation) {
        if (internetConnected && lastKnownLocation != null) {
            offlineMaps.onLocation(lastKnownLocation!!)
        }
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

    val colors = lightColorScheme(
        primary = Forest, onPrimary = Color.White,
        secondary = Ink, background = Paper, onBackground = Ink,
        surface = Color.White, onSurface = Ink,
        surfaceVariant = Mist, onSurfaceVariant = Muted
    )
    MaterialTheme(
        colorScheme = colors,
        shapes = Shapes(
            small = RoundedCornerShape(12.dp),
            medium = RoundedCornerShape(18.dp),
            large = RoundedCornerShape(26.dp)
        )
    ) {
        Scaffold(
            containerColor = Paper,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                NavigationBar(containerColor = Color.White, tonalElevation = 0.dp) {
                    Screen.entries.forEach { tab ->
                        NavigationBarItem(
                            selected = screen == tab,
                            onClick = {
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                screen = tab
                            },
                            icon = {
                                if (tab == Screen.MAP || tab == Screen.MAPPING) {
                                    Image(
                                        painter = painterResource(R.drawable.hodos_brand_icon),
                                        contentDescription = null,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier.size(28.dp).clip(RoundedCornerShape(8.dp))
                                    )
                                } else Icon(Icons.Outlined.PersonOutline, contentDescription = null)
                            },
                            label = { Text(tab.label, fontWeight = if (screen == tab) FontWeight.SemiBold else FontWeight.Normal) },
                            alwaysShowLabel = true,
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Forest, selectedTextColor = Forest,
                                indicatorColor = Mist, unselectedIconColor = Muted, unselectedTextColor = Muted
                            )
                        )
                    }
                }
            }
        ) { insets ->
            Box(Modifier.fillMaxSize().padding(insets)) {
                when (screen) {
                    Screen.MAP -> BottomSheetScaffold(
                        scaffoldState = sheetState,
                        sheetPeekHeight = 126.dp,
                        sheetShape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
                        sheetContainerColor = Color.White,
                        sheetShadowElevation = 11.dp,
                        sheetDragHandle = {
                            BottomSheetDefaults.DragHandle(color = Color(0xFFCBD7CF))
                        },
                        sheetContent = {
                            Column(
                                Modifier.fillMaxWidth()
                                    .heightIn(min = 118.dp, max = 480.dp)
                                    .padding(horizontal = 20.dp)
                                    .padding(bottom = 16.dp)
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text("Nearby hazards", fontSize = 21.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp)
                                        Text(
                                            if (visibleHazards.isEmpty()) "No matching road hazards"
                                            else "${visibleHazards.size} on the shared map",
                                            color = Muted, fontSize = 12.sp
                                        )
                                    }
                                    IconButton(onClick = onRefresh, enabled = !loading) {
                                        if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                                        else Icon(Icons.Outlined.Refresh, contentDescription = "Refresh hazards")
                                    }
                                }
                                Spacer(Modifier.height(14.dp))
                                if (visibleHazards.isEmpty()) {
                                    Text(
                                        if (hazards.isEmpty()) "As independent journeys confirm road defects, you'll see them here."
                                        else "Try another search or severity filter.",
                                        color = Muted, fontSize = 13.sp
                                    )
                                } else {
                                    LazyColumn(Modifier.heightIn(max = 320.dp)) {
                                        items(visibleHazards, key = { it.id }) { hazard ->
                                            HazardRow(hazard, lastKnownLocation?.let { distanceTo(hazard, it) }) { selected = hazard }
                                        }
                                    }
                                }
                            }
                        },
                        containerColor = Color.Transparent
                    ) { sheetInsets ->
                        Box(Modifier.fillMaxSize().padding(sheetInsets)) {
                            RoadMap(
                                hazards = visibleHazards,
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
                                    Text("SAFER ROADS", fontSize = 10.sp, color = Forest,
                                        fontWeight = FontWeight.Bold, letterSpacing = 1.7.sp)
                                }
                                Spacer(Modifier.height(9.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    OutlinedTextField(
                                        value = query,
                                        onValueChange = { query = it },
                                        singleLine = true,
                                        placeholder = { Text("Search road hazards", fontSize = 14.sp) },
                                        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(19.dp),
                                        colors = OutlinedTextFieldDefaults.colors(
                                            focusedContainerColor = Color.White,
                                            unfocusedContainerColor = Color.White,
                                            focusedBorderColor = Forest,
                                            unfocusedBorderColor = Color(0xFFDAE7DD)
                                        )
                                    )
                                    FilledIconButton(
                                        onClick = { filterVisible = !filterVisible },
                                        modifier = Modifier.size(54.dp),
                                        colors = IconButtonDefaults.filledIconButtonColors(
                                            containerColor = if (filterVisible) Forest else Color.White,
                                            contentColor = if (filterVisible) Color.White else Ink
                                        )
                                    ) {
                                        Icon(Icons.Outlined.FilterList, contentDescription = "Filter hazards")
                                    }
                                }
                                if (filterVisible) {
                                    Spacer(Modifier.height(8.dp))
                                    Surface(shape = RoundedCornerShape(20.dp), color = Color.White, shadowElevation = 4.dp) {
                                        Row(
                                            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(8.dp),
                                            horizontalArrangement = Arrangement.spacedBy(7.dp)
                                        ) {
                                            listOf("All", "High", "Medium", "Low", "Repaired").forEach { option ->
                                                FilterChip(
                                                    selected = severity == option,
                                                    onClick = { severity = option },
                                                    label = { Text(option) }
                                                )
                                            }
                                        }
                                    }
                                }
                                if (!internetConnected || syncError) {
                                    Spacer(Modifier.height(8.dp))
                                    Surface(shape = RoundedCornerShape(12.dp), color = Color(0xFFFFF1DE)) {
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
                                        locationPermissionLauncher.launch(
                                            arrayOf(
                                                Manifest.permission.ACCESS_COARSE_LOCATION,
                                                Manifest.permission.ACCESS_FINE_LOCATION
                                            )
                                        )
                                    }
                                },
                                colors = IconButtonDefaults.filledIconButtonColors(
                                    containerColor = Color.White, contentColor = Forest
                                ),
                                modifier = Modifier.align(Alignment.BottomEnd)
                                    .padding(end = 18.dp, bottom = 146.dp).size(52.dp)
                            ) {
                                if (locating) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(22.dp),
                                        color = Forest, strokeWidth = 2.5.dp
                                    )
                                } else Icon(Icons.Outlined.MyLocation, contentDescription = "Go to my location")
                            }
                        }
                    }
                    Screen.MAPPING -> MappingScreen(
                        armed, trips,
                        offlineMaps = offlineMaps,
                        onToggle = onToggle,
                        onRefresh = onRefresh,
                        tripActive = tripActive,
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
                        onStartJourney = onStartJourney,
                        onFinishJourney = onFinishJourney
                    )
                    Screen.YOU -> YouScreen(trips, hazards.size)
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
            ModalBottomSheet(onDismissRequest = { selected = null }) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 34.dp)) {
                    Text(hazard.title, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        (if (hazard.fixed) "Reported repaired" else hazard.severityText + " severity") +
                            " · ${(hazard.confidence * 100).roundToInt()}/100 evidence score",
                        color = if (hazard.fixed) Forest else Orange
                    )
                    Spacer(Modifier.height(19.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        DetailStat("${hazard.passes}", "Passes", Modifier.weight(1f))
                        DetailStat("${hazard.devices}", "Devices", Modifier.weight(1f))
                        DetailStat("${hazard.clearPasses}", "Clear passes", Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(17.dp))
                    Text("This location is based on independently recorded road observations. Your feedback helps check whether the hazard is still there.", color = Muted, fontSize = 13.sp)
                    Spacer(Modifier.height(20.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    val result = repo.sendObservation(hazard, repaired = false)
                                    snackbar.showSnackbar(if (result.isSuccess) "Thanks! Confirmation recorded." else "Could not send. Check your connection.")
                                    if (result.isSuccess) { selected = null; onRefresh() }
                                }
                            }, modifier = Modifier.weight(1f)
                        ) { Text("Still there") }
                        Button(
                            enabled = !hazard.fixed,
                            onClick = {
                                scope.launch {
                                    val result = repo.sendObservation(hazard, repaired = true)
                                    snackbar.showSnackbar(if (result.isSuccess) "Repair report received." else "Could not send. Check your connection.")
                                    if (result.isSuccess) { selected = null; onRefresh() }
                                }
                            }, modifier = Modifier.weight(1f)
                        ) { Text("Mark fixed") }
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailStat(value: String, title: String, modifier: Modifier = Modifier) {
    Column(modifier.clip(RoundedCornerShape(15.dp)).background(Mist).padding(14.dp)) {
        Text(value, fontWeight = FontWeight.Bold, fontSize = 24.sp)
        Text(title, color = Muted, fontSize = 11.sp)
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
        Box(
            Modifier.size(11.dp).clip(CircleShape)
                .background(if (hazard.fixed) Forest else if (hazard.severity >= 3) Danger else Orange)
        )
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(hazard.title, fontWeight = FontWeight.Medium)
            Text(
                if (distanceMeters != null) "${String.format(Locale.US, "%.1f km", distanceMeters / 1000f)} away · ${hazard.devices} installation IDs"
                else "${hazard.passes} passes · ${hazard.devices} devices",
                color = Muted, fontSize = 12.sp
            )
        }
        Text(if (hazard.fixed) "Repaired" else hazard.severityText, color = Muted, fontSize = 12.sp)
    }
    HorizontalDivider(color = Mist)
}

@Composable
private fun MappingScreen(
    armed: Boolean,
    trips: List<RoadTrip>,
    offlineMaps: OfflineMaps,
    onToggle: (Boolean) -> Unit,
    onRefresh: () -> Unit,
    tripActive: Boolean,
    waitingUploads: Int,
    rejectedUploads: Int,
    syncMetricsReady: Boolean,
    onDeleteRejected: () -> Unit,
    onStartJourney: () -> Unit,
    onFinishJourney: () -> Unit
) {
    var confirmDiscard by remember { mutableStateOf(false) }
    LazyColumn(
        Modifier.fillMaxSize().background(Paper),
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.spacedBy(17.dp)
    ) {
        item {
            HodosBrand()
            Spacer(Modifier.height(17.dp))
            Text("Automatic mapping", fontSize = 29.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.8).sp)
            Spacer(Modifier.height(7.dp))
            Text("Go about your day. Hodos quietly learns from the roads you travel.", color = Muted, fontSize = 15.sp)
        }
        item {
            Surface(shape = RoundedCornerShape(25.dp), color = Mist) {
                Column(Modifier.padding(22.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.DirectionsCar, null, tint = Forest, modifier = Modifier.size(30.dp))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(if (armed) "Detection is on" else "Automatic mapping is off", color = Ink, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                            Text(if (armed) "Detecting when a journey starts" else "Enable it to detect road hazards", color = Muted, fontSize = 12.sp)
                        }
                        Switch(
                            checked = armed, onCheckedChange = onToggle,
                            colors = SwitchDefaults.colors(checkedTrackColor = Forest)
                        )
                    }
                    Spacer(Modifier.height(18.dp))
                    HorizontalDivider(color = Color(0xFFD0E2D7))
                    Spacer(Modifier.height(14.dp))
                    Text("Your motion data stays on this phone. A persistent foreground notification shows when mapping is active. Android may stop tracking when you force-stop Hodos or restrict its battery use.", color = Muted, fontSize = 13.sp)
                    Spacer(Modifier.height(13.dp))
                    Text("For more reliable screen-off mapping:", color = Ink, fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold)
                    val context = LocalContext.current
                    TextButton(onClick = {
                        context.startActivity(Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + context.packageName)
                        ))
                    }) { Text("Location · Allow all the time") }
                    TextButton(onClick = {
                        try {
                            context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                        } catch (_: Exception) {
                            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:" + context.packageName)))
                        }
                    }) { Text("Review battery optimization") }
                    Text("These settings are optional, and availability varies by Android device.", color = Muted, fontSize = 12.sp)
                }
            }
        }
        item {
            val saved = offlineMaps.state
            Surface(shape = RoundedCornerShape(22.dp), color = Color.White) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Map, contentDescription = null, tint = Forest)
                        Spacer(Modifier.width(10.dp))
                        Text("Offline nearby maps", fontSize = 19.sp,
                            fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Switch(
                            checked = saved.autoEnabled,
                            onCheckedChange = { offlineMaps.setAuto(it) },
                            colors = SwitchDefaults.colors(checkedTrackColor = Forest)
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text("Automatically save roads within 20 km on Wi-Fi after you allow location. No mobile-data map downloads.",
                        fontSize = 13.sp, color = Muted)
                    Spacer(Modifier.height(12.dp))
                    Text(saved.status, fontSize = 13.sp, color = Ink,
                        fontWeight = FontWeight.SemiBold)
                    if (saved.downloading && saved.required > 0) {
                        Spacer(Modifier.height(8.dp))
                        LinearProgressIndicator(
                            progress = { (saved.completed.toFloat() / saved.required).coerceIn(0f, 1f) },
                            modifier = Modifier.fillMaxWidth(),
                            color = Forest
                        )
                    }
                    Text("${saved.savedRegions} saved areas · ${saved.downloadedBytes / (1024 * 1024)} MB current area · zoom 8–13",
                        fontSize = 12.sp, color = Muted)
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = { offlineMaps.saveNearbyNow() },
                            modifier = Modifier.weight(1f)
                        ) { Text("Save nearby", fontSize = 12.sp) }
                        TextButton(onClick = { offlineMaps.clear() }) {
                            Text("Remove maps", fontSize = 12.sp)
                        }
                    }
                }
            }
        }
        item {
            Surface(shape = RoundedCornerShape(20.dp), color = Color.White) {
                Column(Modifier.fillMaxWidth().padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Shield, contentDescription = null, tint = Forest)
                        Spacer(Modifier.width(10.dp))
                        Text("Observation sync", fontSize = 18.sp,
                            fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        when {
                            !syncMetricsReady -> "Sync status unavailable on this device"
                            waitingUploads > 0 -> "$waitingUploads reports safely saved here · waiting for upload"
                            else -> "No road observations waiting to upload"
                        },
                        color = if (!syncMetricsReady) Danger else Muted,
                        fontSize = 13.sp
                    )
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
            Surface(shape = RoundedCornerShape(20.dp), color = Color.White) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.DirectionsCar, contentDescription = null, tint = Forest)
                        Spacer(Modifier.width(10.dp))
                        Text(if (tripActive) "Journey in progress" else "Record a journey",
                            fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(9.dp))
                    Text(
                        if (tripActive) "Hodos is collecting real motion and location readings. Finish when your trip ends."
                        else "Mapping detects journeys automatically. You can also start recording a real journey yourself.",
                        fontSize = 13.sp, color = Muted
                    )
                    Spacer(Modifier.height(14.dp))
                    Button(
                        enabled = armed,
                        onClick = if (tripActive) onFinishJourney else onStartJourney,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(if (tripActive) "Finish journey" else "Start journey")
                    }
                    if (!armed) {
                        Spacer(Modifier.height(8.dp))
                        Text("Switch on automatic mapping to record a journey.", color = Muted, fontSize = 12.sp)
                    }
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Your journeys", fontSize = 21.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                TextButton(onClick = onRefresh) { Icon(Icons.Outlined.Refresh, null); Text("Update") }
            }
        }
        if (trips.isEmpty()) {
            item {
                Surface(color = Color.White, shape = RoundedCornerShape(20.dp)) {
                    Column(Modifier.fillMaxWidth().padding(24.dp)) {
                        Icon(Icons.Outlined.History, null, tint = Forest, modifier = Modifier.size(28.dp))
                        Spacer(Modifier.height(12.dp))
                        Text("Your first journey starts here", fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
                        Spacer(Modifier.height(5.dp))
                        Text("Enable automatic mapping and drive or cycle normally. Trips will appear once the service records them.", color = Muted, fontSize = 13.sp)
                    }
                }
            }
        } else {
            items(trips, key = { it.at }) { trip ->
                Surface(color = Color.White, shape = RoundedCornerShape(17.dp)) {
                    Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.DirectionsCar, null, tint = Forest)
                        Spacer(Modifier.width(15.dp))
                        Column(Modifier.weight(1f)) {
                            Text(DateFormat.format("d MMM · h:mm a", Date(trip.at)).toString(), fontWeight = FontWeight.SemiBold)
                            Text("${trip.impacts} impacts · ${trip.locations} locations", color = Muted, fontSize = 12.sp)
                        }
                        Text("${trip.confirmed} mapped", color = Forest, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        item {
            Surface(shape = RoundedCornerShape(17.dp), color = Mist) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.Top) {
                    Icon(Icons.Outlined.Shield, null, tint = Forest)
                    Spacer(Modifier.width(12.dp))
                    Text("Your phone processes movement locally. Only small road observations are submitted, not full sensor recordings.", fontSize = 13.sp, color = Ink)
                }
            }
        }
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
}

@Composable
private fun YouScreen(trips: List<RoadTrip>, hazards: Int) {
    val total = trips.sumOf { it.impacts }
    LazyColumn(
        Modifier.fillMaxSize().background(Paper),
        contentPadding = PaddingValues(22.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        item {
            Spacer(Modifier.height(12.dp))
            HodosBrand()
            Spacer(Modifier.height(16.dp))
            Text("Your Hodos", fontSize = 29.sp, fontWeight = FontWeight.Bold)
            Text("Every journey makes the roads a little better understood.", color = Muted)
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                DetailStat("${trips.size}", "Journeys", Modifier.weight(1f))
                DetailStat("$total", "Impacts", Modifier.weight(1f))
                DetailStat("$hazards", "Public hazards", Modifier.weight(1f))
            }
        }
        item {
            Text("Built for the road", fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
            Text("Hodos turns ordinary phones into a collaborative map of potholes, rough roads and speed bumps. No manual recording needed after you enable mapping.", color = Muted, fontSize = 14.sp)
        }
        item {
            Surface(color = Color.White, shape = RoundedCornerShape(21.dp)) {
                Column(Modifier.padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Shield, null, tint = Forest)
                        Spacer(Modifier.width(10.dp))
                        Text("Privacy comes first", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                    }
                    Spacer(Modifier.height(10.dp))
                    Text("The detector runs locally. The app submits identified road observations so that independent devices can corroborate hazards. Location permission is needed for hands-free mapping.", color = Muted, fontSize = 13.sp)
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Info, null, tint = Forest)
                Spacer(Modifier.width(10.dp))
                Text("Hodos · by Devilabs", color = Muted, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun HodosBrand() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(
            painter = painterResource(R.drawable.hodos_brand_icon),
            contentDescription = "Hodos forest road icon",
            contentScale = ContentScale.Fit,
            modifier = Modifier.size(46.dp).clip(RoundedCornerShape(12.dp))
        )
        Spacer(Modifier.width(10.dp))
        Text("hodos", fontSize = 29.sp, fontWeight = FontWeight.Bold,
            letterSpacing = (-1.2).sp, color = Ink)
    }
}
