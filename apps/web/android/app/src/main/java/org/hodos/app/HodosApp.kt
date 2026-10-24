package org.hodos.app

import android.text.format.DateFormat
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

private val Ink = Color(0xFF192923)
private val Forest = Color(0xFF17664F)
private val Paper = Color(0xFFF8F9F6)
private val Muted = Color(0xFF65766B)
private val Mist = Color(0xFFEAF0EA)
private val Orange = Color(0xFFC47B29)
private val Danger = Color(0xFFB84C3C)

private enum class Screen(val label: String) { MAP("Map"), MAPPING("Mapping"), YOU("You") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HodosApp(
    armed: Boolean,
    refreshSignal: Int,
    onToggle: (Boolean) -> Unit,
    onRefresh: () -> Unit
) {
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val repo = remember { HazardRepository(context) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var screen by remember { mutableStateOf(Screen.MAP) }
    var hazards by remember { mutableStateOf(repo.savedHazards()) }
    var trips by remember { mutableStateOf(repo.savedTrips()) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<RoadHazard?>(null) }
    var listOpen by remember { mutableStateOf(false) }
    var locateRequest by remember { mutableIntStateOf(0) }

    LaunchedEffect(refreshSignal) {
        trips = repo.savedTrips()
        loading = true
        val result = repo.refreshHazards()
        result.onSuccess { hazards = it; offline = false }
        result.onFailure { offline = true; hazards = repo.savedHazards() }
        loading = false
    }

    val colors = lightColorScheme(
        primary = Forest, onPrimary = Color.White,
        secondary = Ink, background = Paper, onBackground = Ink,
        surface = Color.White, onSurface = Ink,
        surfaceVariant = Mist, onSurfaceVariant = Muted
    )
    MaterialTheme(colorScheme = colors, shapes = Shapes(
        small = RoundedCornerShape(12.dp),
        medium = RoundedCornerShape(18.dp),
        large = RoundedCornerShape(26.dp)
    )) {
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
                                Icon(
                                    when (tab) {
                                        Screen.MAP -> Icons.Outlined.Map
                                        Screen.MAPPING -> Icons.Outlined.DirectionsCar
                                        Screen.YOU -> Icons.Outlined.PersonOutline
                                    }, contentDescription = null
                                )
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
                    Screen.MAP -> {
                        RoadMap(hazards, locateRequest, onSelect = { selected = it })
                        Column(
                            Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 18.dp, vertical = 10.dp)
                        ) {
                            Surface(shape = RoundedCornerShape(22.dp), shadowElevation = 5.dp) {
                                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(Forest), contentAlignment = Alignment.Center) {
                                        Icon(Icons.Outlined.Map, contentDescription = null, tint = Color.White)
                                    }
                                    Spacer(Modifier.width(12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text("Hodos", fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp)
                                        Text("The road maps itself", fontSize = 12.sp, color = Muted)
                                    }
                                    if (loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                                    else IconButton(onClick = onRefresh) { Icon(Icons.Outlined.Refresh, contentDescription = "Refresh map") }
                                }
                            }
                            if (offline) {
                                Spacer(Modifier.height(8.dp))
                                Surface(shape = RoundedCornerShape(12.dp), color = Color(0xFFFFF0DC)) {
                                    Text("Offline · showing your last saved map", Modifier.padding(10.dp), fontSize = 12.sp, color = Ink)
                                }
                            }
                        }
                        Column(
                            Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp)
                        ) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                FilledIconButton(
                                    onClick = { locateRequest++ },
                                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color.White, contentColor = Ink),
                                    modifier = Modifier.size(52.dp)
                                ) { Icon(Icons.Outlined.MyLocation, "Find my location") }
                            }
                            Spacer(Modifier.height(10.dp))
                            Surface(
                                onClick = { listOpen = true },
                                shape = RoundedCornerShape(23.dp),
                                color = Color.White,
                                shadowElevation = 7.dp
                            ) {
                                Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text("ROADS AROUND YOU", fontSize = 10.sp, color = Forest, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                                        Spacer(Modifier.height(5.dp))
                                        Text(
                                            if (hazards.isEmpty()) "No confirmed hazards yet"
                                            else "${hazards.count { !it.fixed }} open road hazards",
                                            fontSize = 20.sp, fontWeight = FontWeight.SemiBold,
                                            letterSpacing = (-0.5).sp
                                        )
                                        Text("Tap to explore the map records", fontSize = 12.sp, color = Muted)
                                    }
                                    Icon(Icons.Outlined.WarningAmber, null, tint = Orange, modifier = Modifier.size(29.dp))
                                }
                            }
                        }
                    }
                    Screen.MAPPING -> MappingScreen(
                        armed, trips,
                        onToggle = onToggle,
                        onRefresh = onRefresh
                    )
                    Screen.YOU -> YouScreen(trips, hazards.size)
                }
            }
        }
        if (listOpen) {
            ModalBottomSheet(onDismissRequest = { listOpen = false }) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 32.dp)) {
                    Text("Road conditions", fontSize = 25.sp, fontWeight = FontWeight.Bold)
                    Text("${hazards.size} independently mapped hazards", color = Muted)
                    Spacer(Modifier.height(14.dp))
                    if (hazards.isEmpty()) {
                        Text("As people travel, independently confirmed road hazards will appear here.", color = Muted)
                    } else {
                        LazyColumn(Modifier.heightIn(max = 410.dp)) {
                            items(hazards, key = { it.id }) { h ->
                                HazardRow(h) {
                                    listOpen = false
                                    selected = h
                                }
                            }
                        }
                    }
                }
            }
        }
        selected?.let { hazard ->
            ModalBottomSheet(onDismissRequest = { selected = null }) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 34.dp)) {
                    Text(hazard.title, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(5.dp))
                    Text(
                        (if (hazard.fixed) "Reported repaired" else hazard.severityText + " severity")
                            + " · ${(hazard.confidence * 100).roundToInt()}% confidence",
                        color = if (hazard.fixed) Forest else Orange
                    )
                    Spacer(Modifier.height(20.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        DetailStat("${hazard.passes}", "Passes", Modifier.weight(1f))
                        DetailStat("${hazard.devices}", "Devices", Modifier.weight(1f))
                        DetailStat("${hazard.clearPasses}", "Clear passes", Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(14.dp))
                    Text("Reports help confirm whether this road defect remains or was repaired. Only aggregated evidence updates the shared map.", color = Muted, fontSize = 13.sp)
                    Spacer(Modifier.height(20.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    val result = repo.sendObservation(hazard, repaired = false)
                                    snackbar.showSnackbar(if (result.isSuccess) "Thanks! Report recorded." else "Couldn't send. Try again online.")
                                    if (result.isSuccess) { selected = null; onRefresh() }
                                }
                            }, modifier = Modifier.weight(1f)
                        ) { Text("Still there") }
                        Button(
                            enabled = !hazard.fixed,
                            onClick = {
                                scope.launch {
                                    val result = repo.sendObservation(hazard, repaired = true)
                                    snackbar.showSnackbar(if (result.isSuccess) "Repair report received." else "Couldn't send. Try again online.")
                                    if (result.isSuccess) { selected = null; onRefresh() }
                                }
                            }, modifier = Modifier.weight(1f)
                        ) { Text("Fixed now") }
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

@Composable
private fun HazardRow(hazard: RoadHazard, onClick: () -> Unit) {
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
            Text("${hazard.passes} passes · ${hazard.devices} devices", color = Muted, fontSize = 12.sp)
        }
        Text(if (hazard.fixed) "Repaired" else hazard.severityText, color = Muted, fontSize = 12.sp)
    }
    HorizontalDivider(color = Mist)
}

@Composable
private fun MappingScreen(armed: Boolean, trips: List<RoadTrip>, onToggle: (Boolean) -> Unit, onRefresh: () -> Unit) {
    LazyColumn(
        Modifier.fillMaxSize().background(Paper),
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.spacedBy(17.dp)
    ) {
        item {
            Text("Automatic mapping", fontSize = 29.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.8).sp)
            Spacer(Modifier.height(7.dp))
            Text("Go about your day. Hodos quietly learns from the roads you travel.", color = Muted, fontSize = 15.sp)
        }
        item {
            Surface(shape = RoundedCornerShape(25.dp), color = Ink) {
                Column(Modifier.padding(22.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.DirectionsCar, null, tint = Color.White, modifier = Modifier.size(30.dp))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(if (armed) "Mapping is on" else "Ready when you are", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                            Text(if (armed) "Watching for your next journey" else "Enable once to map automatically", color = Color(0xFFB5CAC0), fontSize = 12.sp)
                        }
                        Switch(
                            checked = armed, onCheckedChange = onToggle,
                            colors = SwitchDefaults.colors(checkedTrackColor = Color(0xFF72CCAA))
                        )
                    }
                    Spacer(Modifier.height(18.dp))
                    HorizontalDivider(color = Color(0xFF40544C))
                    Spacer(Modifier.height(14.dp))
                    Text("Runs in the background with your permission. Your raw sensor readings stay on this phone.", color = Color(0xFFB5CAC0), fontSize = 13.sp)
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
