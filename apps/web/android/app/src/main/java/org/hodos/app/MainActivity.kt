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
    private var onboardingComplete by mutableStateOf(false)
    private var mapLocationGranted by mutableStateOf(false)

    private val mapLocationPermission = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        mapLocationGranted = has(Manifest.permission.ACCESS_COARSE_LOCATION) ||
            has(Manifest.permission.ACCESS_FINE_LOCATION)
        if (!mapLocationGranted) {
            Toast.makeText(this, "You can still explore the map without location access", Toast.LENGTH_SHORT).show()
        }
    }

    private val permissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        if (hasForegroundPermissions()) continueEnabling()
        else Toast.makeText(this, "Automatic mapping needs precise location and motion permission. The map works with approximate location.", Toast.LENGTH_LONG).show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("hodos", MODE_PRIVATE)
        armed = prefs.getBoolean("armed", false)
        onboardingComplete = prefs.getBoolean("onboardingComplete", false)
        mapLocationGranted = has(Manifest.permission.ACCESS_COARSE_LOCATION) ||
            has(Manifest.permission.ACCESS_FINE_LOCATION)
        setContent {
            if (!onboardingComplete) {
                HodosOnboarding(
                    locationGranted = mapLocationGranted,
                    onRequestLocation = {
                        mapLocationPermission.launch(
                            arrayOf(
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                                Manifest.permission.ACCESS_FINE_LOCATION
                            )
                        )
                    },
                    onFinish = {
                        prefs.edit().putBoolean("onboardingComplete", true).apply()
                        onboardingComplete = true
                        refreshSignal++
                    }
                )
            } else HodosApp(
                armed = armed,
                refreshSignal = refreshSignal,
                onToggle = { if (it) continueEnabling() else stopMapping() },
                onRefresh = { refreshSignal++ },
                onStartJourney = { journeyAction(HodosService.ACTION_START_TRIP) },
                onFinishJourney = { journeyAction(HodosService.ACTION_END_TRIP) }
            )
        }
    }

    override fun onResume() {
        super.onResume()
        mapLocationGranted = has(Manifest.permission.ACCESS_COARSE_LOCATION) ||
            has(Manifest.permission.ACCESS_FINE_LOCATION)
        val enabled = getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)
        if (enabled && !hasForegroundPermissions()) {
            stopMapping()
            Toast.makeText(this, "Mapping paused because location or motion permission was revoked", Toast.LENGTH_LONG).show()
        } else {
            armed = enabled
            if (enabled) {
                // Returning to Hodos should repair a foreground service that
                // Android reclaimed, without requiring another toggle.
                try {
                    ContextCompat.startForegroundService(
                        this, Intent(this, HodosService::class.java).apply {
                            action = HodosService.ACTION_ENABLE
                        })
                } catch (error: Exception) {
                    armed = false
                    getSharedPreferences("hodos", MODE_PRIVATE).edit()
                        .putBoolean("armed", false).apply()
                    Toast.makeText(this,
                        "Could not resume mapping: ${error.message}",
                        Toast.LENGTH_LONG).show()
                }
            }
        }
        // Retry any evidence from earlier journeys even if mapping is off.
        HodosSyncWorker.schedule(this)
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

    private fun journeyAction(action: String) {
        if (!armed || !hasForegroundPermissions()) {
            Toast.makeText(this, "Enable automatic mapping first", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            startService(Intent(this, HodosService::class.java).apply { this.action = action })
            refreshSignal++
        } catch (error: Exception) {
            Toast.makeText(this, "Couldn't control journey: ${error.message}", Toast.LENGTH_LONG).show()
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
        HodosSyncWorker.schedule(this)
    }
}
