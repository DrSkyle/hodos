package org.hodos.app

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Clean, crisp Apple/Material vector icons replacing the legacy uneven hand-drawn doodle SVGs.
 */
internal enum class DoodleSymbol(val vector: ImageVector) {
    MAP(Icons.Outlined.Explore),
    CAR(Icons.Outlined.DirectionsCar),
    PERSON(Icons.Outlined.PersonOutline),
    BOOKMARK(Icons.Outlined.BookmarkBorder),
    CHECK(Icons.Outlined.CheckCircle),
    WARNING(Icons.Outlined.WarningAmber),
    SHIELD(Icons.Outlined.VerifiedUser),
    DIARY(Icons.Outlined.Route),
    SUN(Icons.Outlined.WbSunny),
    TREE(Icons.Outlined.Explore)
}

@Composable
internal fun DoodleIcon(
    symbol: DoodleSymbol,
    modifier: Modifier = Modifier,
    tint: Color = Color(0xFF145B46)
) {
    Icon(
        imageVector = symbol.vector,
        contentDescription = null,
        modifier = modifier,
        tint = tint
    )
}
