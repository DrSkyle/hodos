package org.hodos.app

import android.content.Context
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A Gradle unit test cannot detect crashes during Android view inflation,
 * drawable decoding, or native MapLibre startup. Test both real entry paths
 * on an emulator before GitHub publishes an APK.
 */
@RunWith(AndroidJUnit4::class)
class HodosLaunchSmokeTest {
    private fun setOnboardingComplete(value: Boolean) {
        val app = ApplicationProvider.getApplicationContext<Context>()
        assertTrue(app.getSharedPreferences("hodos", Context.MODE_PRIVATE).edit()
            .putBoolean("onboardingComplete", value).commit())
    }

    @Test
    fun freshInstallOpensOnboardingWithoutCrashing() {
        setOnboardingComplete(false)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            SystemClock.sleep(2500L)
            scenario.onActivity { activity ->
                assertFalse("Hodos finished during onboarding", activity.isFinishing)
                assertTrue(activity.window.decorView.isAttachedToWindow)
            }
        }
    }

    @Test
    fun returningUserOpensMapWithoutCrashing() {
        setOnboardingComplete(true)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            SystemClock.sleep(5500L)
            scenario.onActivity { activity ->
                assertFalse("Hodos finished during map initialization", activity.isFinishing)
                assertTrue(activity.window.decorView.isAttachedToWindow)
            }
        }
    }
}
