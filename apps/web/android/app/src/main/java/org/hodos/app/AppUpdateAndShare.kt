package org.hodos.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

data class AppReleaseInfo(
    val tagName: String,
    val versionName: String,
    val apkDownloadUrl: String,
    val releaseHtmlUrl: String,
    val isNewer: Boolean
)

object AppUpdateAndShare {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    fun currentVersionName(context: Context): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "2.0.2"
        } catch (_: Exception) {
            "2.0.2"
        }
    }

    private fun parseSemver(v: String): List<Int> {
        return v.removePrefix("v").removePrefix("V")
            .split(".")
            .map { it.filter { c -> c.isDigit() }.toIntOrNull() ?: 0 }
    }

    internal fun isRemoteNewer(current: String, remote: String): Boolean {
        val c = parseSemver(current)
        val r = parseSemver(remote)
        val len = maxOf(c.size, r.size)
        for (i in 0 until len) {
            val cv = c.getOrElse(i) { 0 }
            val rv = r.getOrElse(i) { 0 }
            if (rv > cv) return true
            if (rv < cv) return false
        }
        return false
    }

    suspend fun checkLatestRelease(context: Context): AppReleaseInfo? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder()
                .url("https://api.github.com/repos/DrSkyle/hodos/releases/latest")
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "Hodos-Android")
                .build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return@runCatching null
                val body = res.body?.string() ?: return@runCatching null
                val json = JSONObject(body)
                val tag = json.optString("tag_name").ifBlank { return@runCatching null }
                val htmlUrl = json.optString("html_url", "https://github.com/DrSkyle/hodos/releases/latest")
                val assets = json.optJSONArray("assets")
                var apkUrl = "https://github.com/DrSkyle/hodos/releases/latest/download/Hodos-${tag.removePrefix("v")}.apk"
                if (assets != null) {
                    for (i in 0 until assets.length()) {
                        val a = assets.optJSONObject(i) ?: continue
                        val name = a.optString("name")
                        val dl = a.optString("browser_download_url")
                        if (name.endsWith(".apk", ignoreCase = true) && dl.isNotBlank()) {
                            apkUrl = dl
                            break
                        }
                    }
                }
                val current = currentVersionName(context)
                val cleanRemote = tag.removePrefix("v").removePrefix("V")
                AppReleaseInfo(
                    tagName = tag,
                    versionName = cleanRemote,
                    apkDownloadUrl = apkUrl,
                    releaseHtmlUrl = htmlUrl,
                    isNewer = isRemoteNewer(current, cleanRemote)
                )
            }
        }.getOrNull()
    }

    fun openApkUpdate(context: Context, release: AppReleaseInfo?) {
        val url = release?.apkDownloadUrl
            ?: "https://github.com/DrSkyle/hodos/releases/latest"
        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        }.onFailure {
            Toast.makeText(context, "Could not open update link", Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Shares the installed Hodos APK file directly via Android Quick Share, Bluetooth,
     * WhatsApp, Telegram, or Nearby Share so another rider can install it immediately
     * without needing a website or mobile data.
     */
    suspend fun shareInstalledApk(context: Context) {
        val sharedFile = withContext(Dispatchers.IO) {
            runCatching {
                val sourceApk = File(context.applicationInfo.sourceDir)
                val exportDir = File(context.cacheDir, "exports").apply { mkdirs() }
                val version = currentVersionName(context)
                val targetApk = File(exportDir, "Hodos-$version.apk")
                sourceApk.copyTo(targetApk, overwrite = true)
                targetApk
            }.getOrNull()
        }

        if (sharedFile != null && sharedFile.exists()) {
            runCatching {
                val uri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    sharedFile
                )
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "application/vnd.android.package-archive"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    putExtra(Intent.EXTRA_SUBJECT, "Hodos Road Mapping App (APK)")
                    putExtra(
                        Intent.EXTRA_TEXT,
                        "Install the Hodos APK to see live potholes & speed bumps and earn driver rewards."
                    )
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val chooser = Intent.createChooser(intent, "Share Hodos APK (Quick Share / Bluetooth)").apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(chooser)
            }.onFailure {
                Toast.makeText(context, "Could not share APK file", Toast.LENGTH_SHORT).show()
            }
        } else {
            Toast.makeText(context, "Could not prepare APK for sharing", Toast.LENGTH_SHORT).show()
        }
    }
}
