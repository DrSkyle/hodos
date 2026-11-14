package org.hodos.app

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * The Garage: real catalogue kit, linked straight to the shop.
 *
 * Every row comes from the Garage backend at open time. There is no shipped
 * fixture, so an unreachable catalogue shows an honest message instead of
 * made-up products.
 */
@Composable
internal fun GarageScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var slot by remember { mutableStateOf(Garage.slots.first()) }
    var offers by remember { mutableStateOf<List<GarageOffer>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }

    var email by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var listMessage by remember { mutableStateOf<String?>(null) }
    var listOk by remember { mutableStateOf(false) }

    LaunchedEffect(slot) {
        loading = true
        failed = false
        val result = Garage.load(slot.id)
        offers = result.getOrDefault(emptyList())
        failed = result.isFailure
        loading = false
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().background(Paper),
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 26.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        item {
            Column(
                Modifier.graphicsLayer {
                    translationY = if (listState.firstVisibleItemIndex == 0)
                        listState.firstVisibleItemScrollOffset * 0.35f else 0f
                }
            ) {
                HodosSubHeader("The Garage", "Kit worth keeping in the car", onBack)
            }
        }
        item {
            Column {
                Text(
                    "The things that actually save a drive — a working inflator, a mount that " +
                        "holds, wipers that clear. Priced by the shop that sells them.",
                    color = Muted,
                    fontSize = 14.sp,
                    lineHeight = 20.sp
                )
                Spacer(Modifier.height(16.dp))
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Garage.slots.forEach { option ->
                        GarageChip(
                            label = option.label,
                            selected = option.id == slot.id,
                            onClick = { slot = option }
                        )
                    }
                }
            }
        }
        item {
            Text(
                when {
                    loading -> "CHECKING THE SHELF"
                    failed -> "SHELF UNREACHABLE"
                    offers.isEmpty() -> "NOTHING ON THIS SHELF"
                    else -> "${offers.size} PICKS · PRICES FROM THE SHOPS"
                },
                fontSize = 9.5.sp,
                color = if (failed) AmberDeep else Muted,
                fontFamily = OverpassMono,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 1.1.sp
            )
        }
        if (loading) {
            item {
                Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Amber, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                }
            }
        } else if (offers.isEmpty()) {
            item {
                EmptyPanel(
                    if (failed) "Couldn't reach the Garage" else "Nothing here right now",
                    if (failed) "The catalogue is unreachable — check your connection and open the Garage again."
                    else "This shelf is empty at the moment. Try another category."
                )
            }
        } else {
            items(offers, key = { it.id }) { offer ->
                GarageOfferRow(offer) {
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(offer.url)))
                    }
                }
            }
        }
        item {
            Text(
                "Prices and stock come from the shops and can change. Nothing here ever changes the map.",
                fontSize = 11.sp,
                lineHeight = 16.sp,
                color = Muted
            )
        }
        item {
            HorizontalDivider(color = Line)
            Spacer(Modifier.height(18.dp))
            Text("We post the map as it grows.", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
            Spacer(Modifier.height(8.dp))
            Text(
                "New roads mapped, before-and-after repairs, and the odd find from the garage. " +
                    "Follow @minerva__corporation to keep up.",
                fontSize = 13.sp, lineHeight = 19.sp, color = Muted
            )
            Spacer(Modifier.height(12.dp))
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = Sand,
                onClick = {
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Garage.INSTAGRAM_URL)))
                    }
                }
            ) {
                Text(
                    "Follow @minerva__corporation ↗",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                )
            }
        }
        item {
            Surface(shape = RoundedCornerShape(22.dp), color = PaperRaised) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Text("Road notes, occasionally.", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "New coverage areas, gear worth replacing, the odd deal. No account needed.",
                        fontSize = 13.sp, lineHeight = 19.sp, color = Muted
                    )
                    Spacer(Modifier.height(14.dp))
                    OutlinedTextField(
                        value = email,
                        onValueChange = {
                            email = it
                            listMessage = null
                        },
                        placeholder = { Text("you@example.com", fontSize = 14.sp) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Sand,
                            unfocusedContainerColor = Sand,
                            focusedIndicatorColor = Amber,
                            unfocusedIndicatorColor = Line,
                            focusedTextColor = Ink,
                            unfocusedTextColor = Ink
                        )
                    )
                    Spacer(Modifier.height(10.dp))
                    Button(
                        onClick = {
                            if (saving) return@Button
                            if (!emailLooksValid(email)) {
                                listOk = false
                                listMessage = "That address doesn't look complete."
                                return@Button
                            }
                            saving = true
                            scope.launch {
                                val result = Garage.subscribe(email)
                                saving = false
                                listOk = result.isSuccess
                                listMessage = if (result.isSuccess) {
                                    email = ""
                                    "You're on the list. No spam, just road notes."
                                } else {
                                    "Couldn't save that just now — try again."
                                }
                            }
                        },
                        enabled = !saving,
                        colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(if (saving) "Saving…" else "Keep me posted", fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        listMessage ?: "Only road notes. Your address is never sold or shared.",
                        fontSize = 11.sp,
                        lineHeight = 16.sp,
                        color = when {
                            listMessage == null -> Muted
                            listOk -> Healed
                            else -> Danger
                        }
                    )
                }
            }
        }
        item {
            Text(
                "Hodos · Devilabs · hodos@devilabs.dev",
                color = Muted,
                fontSize = 10.5.sp,
                fontFamily = OverpassMono,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.5.sp,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

private fun emailLooksValid(value: String): Boolean {
    val clean = value.trim()
    return clean.length in 5..254 && Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$").matches(clean)
}

@Composable
private fun GarageChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val alpha by animateFloatAsState(if (selected) 1f else 0.9f, label = "garage chip")
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = if (selected) Ink else Sand,
        onClick = onClick
    ) {
        Text(
            label,
            color = if (selected) Paper else Ink,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 15.dp, vertical = 9.dp).graphicsLayer { this.alpha = alpha }
        )
    }
}

@Composable
private fun GarageOfferRow(offer: GarageOffer, onOpen: () -> Unit) {
    Column {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            GarageThumbnail(offer.image)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    offer.title,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                    lineHeight = 19.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                val meta = listOfNotNull(offer.brand, offer.merchant).joinToString(" · ")
                if (meta.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        meta.uppercase(),
                        fontSize = 9.5.sp,
                        color = Muted,
                        fontFamily = OverpassMono,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 0.5.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Spacer(Modifier.height(5.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        garagePrice(offer.price, offer.currency),
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = Ink
                    )
                    val before = offer.compareAt
                    if (before != null && offer.price != null && before > offer.price) {
                        Spacer(Modifier.width(7.dp))
                        Text(
                            garagePrice(before, offer.currency),
                            fontSize = 12.sp,
                            color = Muted
                        )
                    }
                }
            }
            Spacer(Modifier.width(10.dp))
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = Sand,
                onClick = onOpen
            ) {
                Text(
                    "View ↗",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Ink,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp)
                )
            }
        }
        HorizontalDivider(color = Line)
    }
}

@Composable
private fun GarageThumbnail(url: String?) {
    val bitmap = rememberGarageBitmap(url)
    Box(
        Modifier.size(64.dp).clip(RoundedCornerShape(12.dp)).background(Sand),
        contentAlignment = Alignment.Center
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().padding(5.dp)
            )
        }
    }
}

/** Small, bounded image cache: the Garage shows at most a handful of rows. */
private val garageBitmaps = object : LinkedHashMap<String, Bitmap>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>?): Boolean =
        size > 24
}

@Composable
private fun rememberGarageBitmap(url: String?): Bitmap? {
    var bitmap by remember(url) { mutableStateOf(url?.let { garageBitmaps[it] }) }
    LaunchedEffect(url) {
        if (url == null || bitmap != null) return@LaunchedEffect
        val loaded = Garage.loadImage(url)
        if (loaded != null) {
            garageBitmaps[url] = loaded
            bitmap = loaded
        }
    }
    return bitmap
}

private fun garagePrice(value: Double?, currency: String): String {
    if (value == null) return ""
    return runCatching {
        NumberFormat.getCurrencyInstance(Locale.getDefault()).apply {
            this.currency = Currency.getInstance(currency)
            maximumFractionDigits = 2
        }.format(value)
    }.getOrDefault(String.format(Locale.US, "%.2f %s", value, currency))
}
