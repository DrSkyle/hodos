package org.hodos.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
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
    private var backgroundLocationGrantedState by mutableStateOf(false)
    private var batteryUnrestrictedState by mutableStateOf(false)
    private var pendingStartJourney by mutableStateOf(false)

    private val mapLocationPermission = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        updatePermissionStates()
        if (!mapLocationGranted) {
            Toast.makeText(this, "You can still explore the map without location access", Toast.LENGTH_SHORT).show()
        }
    }

    private val backgroundLocationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        updatePermissionStates()
    }

    private val permissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        updatePermissionStates()
        if (hasForegroundPermissions()) {
            if (pendingStartJourney) {
                pendingStartJourney = false
                startManualJourney()
            } else {
                continueEnabling()
            }
        } else {
            pendingStartJourney = false
            Toast.makeText(this, "Mapping needs precise location and motion permission.", Toast.LENGTH_LONG).show()
        }
    }

    private fun updatePermissionStates() {
        mapLocationGranted = has(Manifest.permission.ACCESS_COARSE_LOCATION) ||
            has(Manifest.permission.ACCESS_FINE_LOCATION)
        backgroundLocationGrantedState = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            has(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        val pm = getSystemService(POWER_SERVICE) as? PowerManager
        batteryUnrestrictedState = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            pm?.isIgnoringBatteryOptimizations(packageName) == true
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("hodos", MODE_PRIVATE)
        armed = prefs.getBoolean("armed", false)
        onboardingComplete = prefs.getBoolean("onboardingComplete", false)
        updatePermissionStates()
        HodosNudgeWorker.schedule(this)
        setContent {
            if (!onboardingComplete) {
                HodosOnboarding(
                    locationGranted = mapLocationGranted,
                    backgroundLocationGranted = backgroundLocationGrantedState,
                    batteryUnrestricted = batteryUnrestrictedState,
                    onRequestLocation = {
                        val needed = mutableListOf(
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                            Manifest.permission.ACCESS_FINE_LOCATION
                        )
                        if (Build.VERSION.SDK_INT >= 29) needed.add(Manifest.permission.ACTIVITY_RECOGNITION)
                        if (Build.VERSION.SDK_INT >= 33) needed.add(Manifest.permission.POST_NOTIFICATIONS)
                        mapLocationPermission.launch(needed.toTypedArray())
                    },
                    onRequestBackgroundLocation = { requestBackgroundLocation() },
                    onRequestBatteryOptimization = { requestBatteryOptimization() },
                    onFinishAndEnableAutoMapping = {
                        prefs.edit().putBoolean("onboardingComplete", true).apply()
                        onboardingComplete = true
                        if (hasForegroundPermissions()) {
                            startMapping()
                        } else {
                            continueEnabling()
                        }
                        refreshSignal++
                    }
                )
            } else HodosApp(
                armed = armed,
                refreshSignal = refreshSignal,
                onToggle = { if (it) continueEnabling() else stopMapping() },
                onRefresh = { refreshSignal++ },
                onStartJourney = { startManualJourney() },
                onFinishJourney = { finishJourneyAction() },
                onRequestBackgroundLocation = { requestBackgroundLocation() },
                onRequestBatteryOptimization = { requestBatteryOptimization() }
            )
        }
    }

    override fun onResume() {
        super.onResume()
        updatePermissionStates()
        val enabled = getSharedPreferences("hodos", MODE_PRIVATE).getBoolean("armed", false)
        if (enabled && !hasForegroundPermissions()) {
            stopMapping()
            Toast.makeText(this, "Mapping paused because location or motion permission was revoked", Toast.LENGTH_LONG).show()
        } else {
            armed = enabled
            if (enabled) {
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

    private fun startManualJourney() {
        if (!hasForegroundPermissions()) {
            pendingStartJourney = true
            continueEnabling()
            return
        }
        try {
            armed = true
            getSharedPreferences("hodos", MODE_PRIVATE).edit().putBoolean("armed", true).apply()
            val intent = Intent(this, HodosService::class.java).apply {
                action = HodosService.ACTION_START_TRIP
            }
            ContextCompat.startForegroundService(this, intent)
            refreshSignal++
        } catch (error: Exception) {
            Toast.makeText(this, "Couldn't start journey: ${error.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun finishJourneyAction() {
        try {
            val intent = Intent(this, HodosService::class.java).apply {
                action = HodosService.ACTION_END_TRIP
            }
            startService(intent)
            refreshSignal++
        } catch (error: Exception) {
            Toast.makeText(this, "Couldn't finish journey: ${error.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun requestBackgroundLocation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (!has(Manifest.permission.ACCESS_FINE_LOCATION) && !has(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                Toast.makeText(this, "Allow step 1 (Location & Motion) first, then tap Allow all the time.", Toast.LENGTH_SHORT).show()
                val needed = mutableListOf(
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.ACCESS_FINE_LOCATION
                )
                if (Build.VERSION.SDK_INT >= 29) needed.add(Manifest.permission.ACTIVITY_RECOGNITION)
                mapLocationPermission.launch(needed.toTypedArray())
                return
            }
            try {
                backgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            } catch (_: Exception) {
                try {
                    startActivity(Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:$packageName")
                    ))
                } catch (e: Exception) {
                    Toast.makeText(this, "Could not open settings: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun requestBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(POWER_SERVICE) as? PowerManager
            if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
                try {
                    startActivity(Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:$packageName")
                    ))
                } catch (_: Exception) {
                    try {
                        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    } catch (_: Exception) {
                        startActivity(Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:$packageName")
                        ))
                    }
                }
            } else {
                updatePermissionStates()
                Toast.makeText(this, "Battery optimization is already unrestricted!", Toast.LENGTH_SHORT).show()
            }
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
