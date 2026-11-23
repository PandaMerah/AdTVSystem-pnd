package com.adtv.kiosk

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

object ApkUpdater {
    private const val TAG = "AdTVUpdater"
    private val isRunning = AtomicBoolean(false)

    fun isDeviceOwner(context: Context): Boolean {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isDeviceOwnerApp(context.packageName)
    }

    fun checkAndInstallAsync(context: Context) {
        if (!isRunning.compareAndSet(false, true)) {
            Log.d(TAG, "Update check already in progress")
            return
        }
        val appCtx = context.applicationContext
        Thread {
            try {
                checkAndInstall(appCtx)
            } catch (e: Exception) {
                Log.e(TAG, "OTA update check failed", e)
            } finally {
                isRunning.set(false)
            }
        }.start()
    }

    private fun checkAndInstall(context: Context) {
        val serverUrl = KioskPrefs.getServerUrl(context)
        val latestUrl = "$serverUrl/api/apk/latest"
        val conn = (URL(latestUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 15_000
            requestMethod = "GET"
        }

        if (conn.responseCode != 200) {
            Log.d(TAG, "No APK update available (HTTP ${conn.responseCode})")
            conn.disconnect()
            return
        }

        val body = conn.inputStream.bufferedReader().use { it.readText() }
        conn.disconnect()

        val json = JSONObject(body)
        val remoteCode = json.getInt("versionCode")
        val remoteName = json.optString("versionName", "")
        val expectedSha256 = json.optString("sha256", "").lowercase()
        val downloadUrl = json.getString("downloadUrl")

        if (remoteCode <= BuildConfig.VERSION_CODE) {
            Log.d(TAG, "Already up to date (local=${BuildConfig.VERSION_CODE}, remote=$remoteCode)")
            return
        }

        Log.i(TAG, "New APK found: v$remoteName ($remoteCode). Downloading from $downloadUrl")
        val apkFile = File(context.cacheDir, "adtv-update-$remoteCode.apk")
        val actualSha256 = downloadAndHash(downloadUrl, apkFile)

        if (expectedSha256.isNotEmpty() && actualSha256 != expectedSha256) {
            Log.e(TAG, "SHA-256 mismatch! expected=$expectedSha256 actual=$actualSha256")
            apkFile.delete()
            return
        }

        if (!isDeviceOwner(context)) {
            Log.w(TAG, "App is not Device Owner; PackageInstaller may prompt user confirmation.")
        }

        installSilently(context, apkFile)
    }

    private fun downloadAndHash(downloadUrl: String, outFile: File): String {
        val conn = (URL(downloadUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
        }
        val digest = MessageDigest.getInstance("SHA-256")
        conn.inputStream.use { input ->
            FileOutputStream(outFile).use { output ->
                val buf = ByteArray(16 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    digest.update(buf, 0, n)
                    output.write(buf, 0, n)
                }
                output.flush()
            }
        }
        conn.disconnect()
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun installSilently(context: Context, apkFile: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }

        val sessionId = installer.createSession(params)
        val session = installer.openSession(sessionId)

        FileInputStream(apkFile).use { input ->
            session.openWrite("adtv_kiosk_ota", 0, apkFile.length()).use { output ->
                input.copyTo(output)
                session.fsync(output)
            }
        }

        val intent = Intent(context, InstallResultReceiver::class.java)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getBroadcast(context, sessionId, intent, flags)
        session.commit(pendingIntent.intentSender)
        session.close()
        Log.i(TAG, "Committed PackageInstaller session $sessionId")
    }
}
