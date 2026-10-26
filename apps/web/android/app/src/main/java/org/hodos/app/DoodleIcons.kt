package org.hodos.app

import androidx.annotation.DrawableRes
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource

/**
 * Native Android VectorDrawables adapted from Oreo Doodle Icons (MIT).
 * No WebView, SVG renderer, network request, or bitmap interpolation.
 */
internal enum class DoodleSymbol(@DrawableRes val resId: Int) {
    MAP(R.drawable.doodle_map),
    CAR(R.drawable.doodle_car),
    PERSON(R.drawable.doodle_user),
    BOOKMARK(R.drawable.doodle_bookmark),
    CHECK(R.drawable.doodle_check),
    WARNING(R.drawable.doodle_warning),
    SHIELD(R.drawable.doodle_shield_check),
    DIARY(R.drawable.doodle_book),
    SUN(R.drawable.doodle_sun),
    TREE(R.drawable.doodle_tree_pine)
}

@Composable
internal fun DoodleIcon(
    symbol: DoodleSymbol,
    modifier: Modifier = Modifier,
    tint: Color = Color(0xFF205746)
) {
    Icon(
        painter = painterResource(symbol.resId),
        contentDescription = null,
        modifier = modifier,
        tint = tint
    )
}
