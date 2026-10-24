package org.hodos.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext

internal fun hasValidatedInternet(context: Context): Boolean {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
    val network = manager.activeNetwork ?: return false
    val caps = manager.getNetworkCapabilities(network) ?: return false
    return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}

@Composable
internal fun rememberInternetConnectivity(): State<Boolean> {
    val context = LocalContext.current.applicationContext
    val online = remember(context) { mutableStateOf(hasValidatedInternet(context)) }
    DisposableEffect(context) {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val handler = Handler(Looper.getMainLooper())
        fun update() { handler.post { online.value = hasValidatedInternet(context) } }
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = update()
            override fun onLost(network: Network) = update()
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = update()
        }
        val registered = try {
            if (Build.VERSION.SDK_INT >= 24) manager?.registerDefaultNetworkCallback(callback)
            else manager?.registerNetworkCallback(
                NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(),
                callback
            )
            manager != null
        } catch (_: RuntimeException) { false }
        update()
        onDispose {
            if (registered) runCatching { manager?.unregisterNetworkCallback(callback) }
            handler.removeCallbacksAndMessages(null)
        }
    }
    return online
}
