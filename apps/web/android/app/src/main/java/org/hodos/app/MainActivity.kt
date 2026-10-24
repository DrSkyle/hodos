package org.hodos.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat

/**
 * Android owns the interface and background recording. No WebView is needed.
 * The existing Java motion pipeline keeps running in HodosService.
 */
class MainActivity : ComponentActivity() {
    private var armed by mutableStateOf(false)
    private var refreshSignal by mutableIntStateOf(0)

    private val permissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        if (hasForegroundPermissions()) continueEnabling()
        else Toast.makeText(this, "Automatic mapping needs precise location and motion permission. The map works with approximate location.", Toast.LENGTH_LONG).show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        armed = getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)
        setContent {
            HodosApp(
                armed = armed,
                refreshSignal = refreshSignal,
                onToggle = { if (it) continueEnabling() else stopMapping() },
                onRefresh = { refreshSignal++ }
            )
        }
    }

    override fun onResume() {
        super.onResume()
        val enabled = getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)
        if (enabled && !hasForegroundPermissions()) {
            stopMapping()
            Toast.makeText(this, "Mapping paused because location or motion permission was revoked", Toast.LENGTH_LONG).show()
        } else {
            armed = enabled
        }
        refreshSignal++
    }

    private fun has(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun hasForegroundPermissions(): Boolean =
        has(Manifest.permission.ACCESS_FINE_LOCATION) &&
            (Build.VERSION.SDK_INT < 29 || has(Manifest.permission.ACTIVITY_RECOGNITION))

    private fun continueEnabling() {
        if (!hasForegroundPermissions()) {
            val needed = mutableListOf(
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION
            )
            if (Build.VERSION.SDK_INT >= 29) needed.add(Manifest.permission.ACTIVITY_RECOGNITION)
            if (Build.VERSION.SDK_INT >= 33) needed.add(Manifest.permission.POST_NOTIFICATIONS)
            permissions.launch(needed.toTypedArray())
            return
        }
        startMapping()
    }

    private fun startMapping() {
        try {
            val intent = Intent(this, HodosService::class.java).apply {
                action = HodosService.ACTION_ENABLE
            }
            ContextCompat.startForegroundService(this, intent)
            armed = true
            getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("armed", true).apply()
        } catch (error: Exception) {
            armed = false
            Toast.makeText(this, "Couldn't start mapping: " + error.message, Toast.LENGTH_LONG).show()
        }
    }

    private fun stopMapping() {
        try {
            startService(Intent(this, HodosService::class.java).apply {
                action = HodosService.ACTION_DISABLE
            })
        } catch (_: Exception) {
            stopService(Intent(this, HodosService::class.java))
        }
        armed = false
        getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("armed", false).apply()
    }
}
