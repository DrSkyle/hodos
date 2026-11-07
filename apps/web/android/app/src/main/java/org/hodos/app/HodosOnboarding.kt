package org.hodos.app

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Forest = Color(0xFF125B48)
private val Ink = Color(0xFF172923)
private val Muted = Color(0xFF5D7268)
private val Paper = Color(0xFFFBFBFD)

private data class IntroStep(
    val eyebrow: String,
    val title: String,
    val description: String,
    val highlightTitle: String,
    val highlightSub: String,
    val icon: ImageVector
)

private val steps = listOf(
    IntroStep(
        eyebrow = "01 / LIVE ROAD INTELLIGENCE",
        title = "Every pothole & speed bump. Mapped.",
        description = "See real-time potholes (red), rough stretches (amber), and speed bumps (violet) shared across the mobile app and web map.",
        highlightTitle = "Built for Pathao, inDrive & daily commuters",
        highlightSub = "Save your suspension, tires, and brakes on every shift.",
        icon = Icons.Outlined.Explore
    ),
    IntroStep(
        eyebrow = "02 / HANDS-FREE & DRIVER REWARDS",
        title = "Turn on Automatic Mapping. Earn perks.",
        description = "Keep Hodos running in the background while you ride. Active contributors unlock Sponsored Pit-Stop discounts and driver mapping payouts as ad & fleet revenue grows.",
        highlightTitle = "Zero manual tapping while driving",
        highlightSub = "Hodos automatically detects motion and pauses when you stop.",
        icon = Icons.Outlined.DirectionsCar
    ),
    IntroStep(
        eyebrow = "03 / ONE-TIME BACKGROUND SETUP",
        title = "Enable All-Time Location & Battery.",
        description = "So Android never kills Hodos while you use Pathao, inDrive, or Google Maps, grant location, background access, and unrestricted battery below.",
        highlightTitle = "On-device sensor processing",
        highlightSub = "Only compact hazard observations are synced to the public map.",
        icon = Icons.Outlined.VerifiedUser
    )
)

@Composable
fun HodosOnboarding(
    locationGranted: Boolean,
    backgroundLocationGranted: Boolean,
    batteryUnrestricted: Boolean,
    onRequestLocation: () -> Unit,
    onRequestBackgroundLocation: () -> Unit,
    onRequestBatteryOptimization: () -> Unit,
    onFinishAndEnableAutoMapping: () -> Unit
) {
    var step by remember { mutableIntStateOf(0) }
    val page = steps[step]

    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Forest,
            onPrimary = Color.White,
            surface = Paper,
            onSurface = Ink
        )
    ) {
        Surface(Modifier.fillMaxSize(), color = Paper) {
            Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                Column(
                    Modifier.fillMaxSize()
                        .padding(bottom = 104.dp)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 24.dp, vertical = 20.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(
                            painter = painterResource(R.drawable.hodos_brand_icon),
                            contentDescription = "Hodos",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.size(44.dp).clip(RoundedCornerShape(12.dp))
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "hodos",
                            fontSize = 26.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = (-1.0).sp,
                            color = Ink
                        )
                        Spacer(Modifier.weight(1f))
                        if (step < steps.lastIndex) {
                            TextButton(onClick = { step = steps.lastIndex }) {
                                Text("Setup", color = Muted, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }

                    Spacer(Modifier.height(28.dp))

                    Text(
                        page.eyebrow,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.4.sp,
                        color = Forest
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        page.title,
                        fontSize = 34.sp,
                        lineHeight = 38.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-1.1).sp,
                        color = Ink
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        page.description,
                        fontSize = 15.5.sp,
                        lineHeight = 23.sp,
                        color = Muted
                    )

                    Spacer(Modifier.height(24.dp))

                    // Clean Apple-style feature card instead of schematic doodle
                    Surface(
                        shape = RoundedCornerShape(22.dp),
                        color = Color.White,
                        shadowElevation = 2.dp,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            Modifier.fillMaxWidth().padding(20.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Surface(
                                color = Color(0xFFEAF3ED),
                                shape = RoundedCornerShape(14.dp)
                            ) {
                                Icon(
                                    imageVector = page.icon,
                                    contentDescription = null,
                                    tint = Forest,
                                    modifier = Modifier.padding(12.dp).size(26.dp)
                                )
                            }
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    page.highlightTitle,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Ink
                                )
                                Spacer(Modifier.height(3.dp))
                                Text(
                                    page.highlightSub,
                                    fontSize = 13.sp,
                                    color = Muted,
                                    lineHeight = 18.sp
                                )
                            }
                        }
                    }

                    if (step == steps.lastIndex) {
                        Spacer(Modifier.height(18.dp))
                        Surface(
                            shape = RoundedCornerShape(22.dp),
                            color = Color.White,
                            shadowElevation = 2.dp,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(
                                Modifier.fillMaxWidth().padding(18.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Text(
                                    "Recommended Permissions",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Ink
                                )

                                // Step 1: Foreground Location + Motion
                                OutlinedButton(
                                    onClick = onRequestLocation,
                                    enabled = !locationGranted,
                                    modifier = Modifier.fillMaxWidth().height(50.dp),
                                    shape = RoundedCornerShape(14.dp)
                                ) {
                                    Icon(
                                        if (locationGranted) Icons.Outlined.CheckCircle else Icons.Outlined.MyLocation,
                                        contentDescription = null,
                                        tint = Forest
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        if (locationGranted) "1. Location & Motion Allowed ✓"
                                        else "1. Allow Location & Motion",
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }

                                // Step 2: Allow All the Time Background Location
                                OutlinedButton(
                                    onClick = onRequestBackgroundLocation,
                                    enabled = !backgroundLocationGranted,
                                    modifier = Modifier.fillMaxWidth().height(50.dp),
                                    shape = RoundedCornerShape(14.dp)
                                ) {
                                    Icon(
                                        if (backgroundLocationGranted) Icons.Outlined.CheckCircle else Icons.Outlined.Explore,
                                        contentDescription = null,
                                        tint = Forest
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        if (backgroundLocationGranted) "2. Allow All the Time Enabled ✓"
                                        else "2. Enable 'Allow all the time'",
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }

                                // Step 3: Unrestricted Battery
                                OutlinedButton(
                                    onClick = onRequestBatteryOptimization,
                                    enabled = !batteryUnrestricted,
                                    modifier = Modifier.fillMaxWidth().height(50.dp),
                                    shape = RoundedCornerShape(14.dp)
                                ) {
                                    Icon(
                                        if (batteryUnrestricted) Icons.Outlined.CheckCircle else Icons.Outlined.BatteryChargingFull,
                                        contentDescription = null,
                                        tint = Forest
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        if (batteryUnrestricted) "3. Battery Unrestricted ✓"
                                        else "3. Allow Unrestricted Battery",
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }
                        }
                    }
                }

                Column(
                    Modifier.align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(Paper)
                        .padding(horizontal = 24.dp, vertical = 12.dp)
                ) {
                    Button(
                        onClick = {
                            if (step == steps.lastIndex) onFinishAndEnableAutoMapping()
                            else step++
                        },
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Forest)
                    ) {
                        Text(
                            if (step == steps.lastIndex) "Enable Automatic Mapping & Open Map"
                            else "Continue",
                            fontSize = 15.5.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        steps.indices.forEach { i ->
                            Box(
                                Modifier.padding(horizontal = 4.dp)
                                    .size(width = if (i == step) 26.dp else 8.dp, height = 8.dp)
                                    .background(
                                        if (i == step) Forest else Color(0xFFD5E0D9),
                                        CircleShape
                                    )
                            )
                        }
                    }
                }
            }
        }
    }
}
