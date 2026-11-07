package org.hodos.app

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** Outcome of an update check — a network failure is distinct from "no update". */
sealed interface UpdateCheck {
    data class Available(val release: AppReleaseInfo) : UpdateCheck
    data class UpToDate(val tagName: String) : UpdateCheck
    data object Failed : UpdateCheck
}

data class AppReleaseInfo(
    val tagName: String,
    val versionName: String,
    val apkDownloadUrl: String,
    val releaseHtmlUrl: String,
    val isNewer: Boolean
)

object AppUpdateAndShare {
    private const val RELEASES_API = "https://api.github.com/repos/DrSkyle/hodos/releases/latest"
    private const val RELEASES_PAGE = "https://github.com/DrSkyle/hodos/releases"
    private const val USER_AGENT = "Hodos-Android-OTA"
    private const val CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000L
    private const val OTA_PREFS = "hodos_ota"

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    fun currentVersionName(context: Context): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
                ?: BuildConfig.VERSION_NAME
        } catch (_: Exception) {
            BuildConfig.VERSION_NAME
        }
    }

    // Only the leading digits of each segment count: "3-rc1" must stay 3,
    // never become 31.
    internal fun parseSemver(v: String): List<Int> {
        return v.removePrefix("v").removePrefix("V")
            .split(".")
            .map { seg -> seg.takeWhile { c -> c.isDigit() }.toIntOrNull() ?: 0 }
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

    private fun otaPrefs(context: Context) =
        context.getSharedPreferences(OTA_PREFS, Context.MODE_PRIVATE)

    private fun parseRelease(context: Context, body: String): AppReleaseInfo? = runCatching {
        val json = JSONObject(body)
        val tag = json.optString("tag_name").ifBlank { return null }
        val htmlUrl = json.optString("html_url", RELEASES_PAGE)
        val cleanRemote = tag.removePrefix("v").removePrefix("V")
        var apkUrl = "https://github.com/DrSkyle/hodos/releases/latest/download/Hodos-$cleanRemote.apk"
        val assets = json.optJSONArray("assets")
        if (assets != null) {
            for (i in 0 until assets.length()) {
                val asset = assets.optJSONObject(i) ?: continue
                val name = asset.optString("name")
                val url = asset.optString("browser_download_url")
                if (name.endsWith(".apk", ignoreCase = true) && url.isNotBlank()) {
                    apkUrl = url
                    break
                }
            }
        }
        AppReleaseInfo(
            tagName = tag,
            versionName = cleanRemote,
            apkDownloadUrl = apkUrl,
            releaseHtmlUrl = htmlUrl,
            isNewer = isRemoteNewer(currentVersionName(context), cleanRemote)
        )
    }.getOrNull()

    private fun decide(release: AppReleaseInfo): UpdateCheck =
        if (release.isNewer) UpdateCheck.Available(release) else UpdateCheck.UpToDate(release.tagName)

    /**
     * Checks GitHub for the latest release. Automatic callers pass force=false,
     * which serves results from a local 6-hour cache and uses ETag/304
     * revalidation so we stay well inside GitHub's 60-requests-per-hour limit.
     * The last known result is served even when the network fails, so a flaky
     * connection never hides an available update. Genuinely unreachable for the
     * first time returns [UpdateCheck.Failed] instead of pretending "no update".
     */
    suspend fun checkLatestRelease(context: Context, force: Boolean = false): UpdateCheck =
        withContext(Dispatchers.IO) {
            val store = otaPrefs(context)
            val cachedBody = store.getString("body", null)
            val cachedAt = store.getLong("checked_at", 0L)
            val now = System.currentTimeMillis()

            fun cachedResult(): UpdateCheck =
                cachedBody?.let { parseRelease(context, it)?.let { r -> decide(r) } }
                    ?: UpdateCheck.Failed

            if (!force && cachedBody != null && now - cachedAt < CACHE_MAX_AGE_MS) {
                return@withContext cachedResult()
            }

            runCatching {
                val builder = Request.Builder()
                    .url(RELEASES_API)
                    .header("Accept", "application/vnd.github+json")
                    .header("User-Agent", USER_AGENT)
                store.getString("etag", null)?.let { builder.header("If-None-Match", it) }
                client.newCall(builder.build()).execute().use { res ->
                    when {
                        res.code == 304 && cachedBody != null -> {
                            store.edit().putLong("checked_at", now).apply()
                            cachedResult()
                        }
                        res.isSuccessful -> {
                            val body = res.body?.string() ?: return@use UpdateCheck.Failed
                            val release = parseRelease(context, body)
                                ?: return@use UpdateCheck.Failed
                            store.edit()
                                .putString("body", body)
                                .putString("etag", res.header("ETag"))
                                .putLong("checked_at", now)
                                .apply()
                            decide(release)
                        }
                        // Rate-limited or server hiccup: serve the last known truth.
                        else -> cachedResult()
                    }
                }
            }.getOrElse { cachedResult() }
        }

    /**
     * Streams the release APK into cacheDir/updates, verifying the signature
     * against the installed app before handing it back for installation.
     * Emits download progress as 0..100 (0 at start). Returns null on any
     * failure, including a payload whose signature does not match ours.
     */
    suspend fun downloadUpdate(
        context: Context,
        release: AppReleaseInfo,
        onProgress: (Int) -> Unit
    ): File? = withContext(Dispatchers.IO) {
        runCatching {
            val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
            val target = File(updatesDir, "Hodos-${release.versionName}.apk")
            updatesDir.listFiles()?.forEach { file ->
                if (file.isFile && file.name != target.name) file.delete()
            }

            if (!target.exists() || target.length() == 0L || !signaturesMatch(context, target)) {
                target.delete()
                onProgress(0)
                val request = Request.Builder()
                    .url(release.apkDownloadUrl)
                    .header("User-Agent", USER_AGENT)
                    .build()
                client.newCall(request).execute().use { res ->
                    if (!res.isSuccessful) return@runCatching null
                    val body = res.body ?: return@runCatching null
                    val total = body.contentLength()
                    var done = 0L
                    var lastPercent = -1
                    body.byteStream().use { input ->
                        target.outputStream().use { output ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val read = input.read(buffer)
                                if (read == -1) break
                                output.write(buffer, 0, read)
                                done += read
                                if (total > 0) {
                                    val percent = ((done * 100) / total).toInt().coerceIn(1, 100)
                                    if (percent != lastPercent) {
                                        lastPercent = percent
                                        onProgress(percent)
                                    }
                                }
                            }
                        }
                    }
                }
                if (!target.exists() || target.length() == 0L) return@runCatching null
            }

            // Never install bytes we cannot prove were signed with our key.
            if (!signaturesMatch(context, target)) {
                target.delete()
                return@runCatching null
            }
            target
        }.getOrNull()
    }

    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /** True when the APK on disk carries the same signing certificates as this app. */
    internal fun signaturesMatch(context: Context, apk: File): Boolean = runCatching {
        val pm = context.packageManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val flags = PackageManager.GET_SIGNING_CERTIFICATES
            val hostCerts = pm.getPackageInfo(context.packageName, flags)
                .signingInfo?.apkContentsSigners ?: return false
            val archiveCerts = pm.getPackageArchiveInfo(apk.path, flags)
                ?.signingInfo?.apkContentsSigners ?: return false
            hostCerts.isNotEmpty() &&
                hostCerts.map { sha256Hex(it.toByteArray()) }.toSet() ==
                archiveCerts.map { sha256Hex(it.toByteArray()) }.toSet()
        } else {
            @Suppress("DEPRECATION")
            val hostSigs = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures
            @Suppress("DEPRECATION")
            val archiveSigs = pm.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNATURES)?.signatures
            !hostSigs.isNullOrEmpty() && !archiveSigs.isNullOrEmpty() &&
                hostSigs.map { sha256Hex(it.toByteArray()) }.toSet() ==
                archiveSigs.map { sha256Hex(it.toByteArray()) }.toSet()
        }
    }.getOrDefault(false)

    fun canInstallPackages(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            context.packageManager.canRequestPackageInstalls()

    /** Routes the rider to the per-app unknown-sources toggle (Android 8+). */
    fun openInstallPermissionSettings(context: Context) {
        runCatching {
            context.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}")
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    /**
     * Hands the verified APK to the system installer. On Android 8+ without the
     * install-unknown-apps grant, opens the settings toggle first so the next
     * tap completes the install.
     */
    fun installApk(context: Context, apk: File): Boolean {
        return runCatching {
            if (!canInstallPackages(context)) {
                openInstallPermissionSettings(context)
                Toast.makeText(
                    context,
                    "Allow Hodos to install apps, then tap Update again",
                    Toast.LENGTH_LONG
                ).show()
                return false
            }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
            context.startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            })
            true
        }.getOrElse {
            Toast.makeText(context, "Could not start the installer", Toast.LENGTH_SHORT).show()
            false
        }
    }

    /** Last-resort fallback: open the GitHub releases page in a browser. */
    fun openReleasesPage(context: Context) {
        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES_PAGE)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        }.onFailure {
            Toast.makeText(context, "Could not open the releases page", Toast.LENGTH_SHORT).show()
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
                // Keep only the copy matching the installed build.
                exportDir.listFiles()?.forEach { file ->
                    if (file.isFile && file.name != targetApk.name) file.delete()
                }
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
