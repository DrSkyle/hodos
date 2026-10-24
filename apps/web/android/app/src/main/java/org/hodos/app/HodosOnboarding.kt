package org.hodos.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.layout.ContentScale
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Forest = Color(0xFF125B48)
private val Ink = Color(0xFF172923)
private val Muted = Color(0xFF63786D)
private val Paper = Color(0xFFF7FAF7)

private data class IntroPage(val eyebrow: String, val title: String, val description: String)

private val pages = listOf(
    IntroPage(
        "01 / THE MAP",
        "See the road ahead.",
        "Find reported potholes and rough stretches on a simple map. Check what's nearby before you head out."
    ),
    IntroPage(
        "02 / MAPPING",
        "Every journey can help.",
        "Opt in to automatic mapping or start a journey yourself. Hodos looks for unusual road impacts using your phone's sensors."
    ),
    IntroPage(
        "03 / YOUR CHOICE",
        "Location, on your terms.",
        "Location helps center the map. Precise location and motion access are needed only when you choose to record roads."
    )
)

@Composable
fun HodosOnboarding(
    locationGranted: Boolean,
    onRequestLocation: () -> Unit,
    onFinish: () -> Unit
) {
    var step by remember { mutableIntStateOf(0) }
    val page = pages[step]

    MaterialTheme(colorScheme = lightColorScheme(
        primary = Forest, onPrimary = Color.White, surface = Paper, onSurface = Ink
    )) {
        Surface(Modifier.fillMaxSize(), color = Paper) {
            Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                Column(
                    Modifier.fillMaxSize().padding(bottom = 97.dp)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 26.dp, vertical = 20.dp)
                ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(15.dp), color = Forest) {
                        Image(
                            painter = painterResource(R.drawable.hodos_wordmark),
                            contentDescription = "Hodos · Safer roads, brighter paths",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.width(178.dp).height(56.dp).padding(horizontal = 10.dp, vertical = 9.dp)
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    if (step < pages.lastIndex) {
                        TextButton(onClick = onFinish) { Text("Skip", color = Muted) }
                    }
                }

                Spacer(Modifier.height(30.dp))
                OnboardingArtwork(step)
                Spacer(Modifier.height(30.dp))

                Text(page.eyebrow, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                    letterSpacing = 1.5.sp, color = Forest)
                Spacer(Modifier.height(12.dp))
                Text(page.title, fontSize = 38.sp, lineHeight = 42.sp,
                    fontWeight = FontWeight.Bold, letterSpacing = (-1.4).sp, color = Ink)
                Spacer(Modifier.height(14.dp))
                Text(page.description, fontSize = 16.sp, lineHeight = 25.sp, color = Muted)
                Spacer(Modifier.height(34.dp))

                if (step == pages.lastIndex) {
                    Surface(color = Color(0xFFE8F2EB), shape = RoundedCornerShape(17.dp)) {
                        Row(
                            Modifier.fillMaxWidth().padding(15.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Outlined.Shield, contentDescription = null,
                                tint = Forest, modifier = Modifier.size(25.dp))
                            Spacer(Modifier.width(12.dp))
                            Text("No account needed. Motion analysis happens on your phone.",
                                fontSize = 13.sp, color = Ink, lineHeight = 19.sp)
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    OutlinedButton(
                        onClick = onRequestLocation,
                        enabled = !locationGranted,
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Icon(if (locationGranted) Icons.Outlined.CheckCircle else Icons.Outlined.MyLocation,
                            contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (locationGranted) "Location access allowed" else "Allow map location")
                    }
                    Spacer(Modifier.height(11.dp))
                }

                }
                Column(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                        .background(Paper)
                        .padding(horizontal = 26.dp, vertical = 11.dp)
                ) {
                    Button(
                        onClick = { if (step == pages.lastIndex) onFinish() else step++ },
                        modifier = Modifier.fillMaxWidth().height(55.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Forest)
                    ) {
                        Text(if (step == pages.lastIndex) "Open Hodos" else "Continue",
                            fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(13.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        pages.indices.forEach { i ->
                            Box(
                                Modifier.padding(horizontal = 4.dp)
                                    .size(width = if (i == step) 28.dp else 8.dp, height = 8.dp)
                                    .background(if (i == step) Forest else Color(0xFFCFDCD3), CircleShape)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OnboardingArtwork(step: Int) {
    // Brand artwork supplied by the creator, not a placeholder Material icon.
    Surface(
        shape = RoundedCornerShape(32.dp),
        color = Color(0xFFE5EFE8),
        modifier = Modifier.fillMaxWidth().height(255.dp)
    ) {
        Box {
            Image(
                painter = painterResource(
                    if (step == 1) R.drawable.hodos_icon_round
                    else R.drawable.hodos_icon_square
                ),
                contentDescription = "Forest, mountains and the winding Hodos road",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
            Surface(
                modifier = Modifier.align(Alignment.BottomCenter).padding(13.dp),
                color = Color(0xEC133D31),
                shape = RoundedCornerShape(15.dp)
            ) {
                Text(
                    when(step) {
                        0 -> "Discover roads around you"
                        1 -> "Make every journey count"
                        else -> "Your location. Your choice."
                    },
                    color = Color.White,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 11.dp)
                )
            }
        }
    }
}
