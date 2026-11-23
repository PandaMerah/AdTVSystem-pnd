package com.adtv.kiosk

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val handler = Handler(Looper.getMainLooper())
    private var tapCount = 0
    private var lastTapMs = 0L

    private val otaRunnable = object : Runnable {
        override fun run() {
            ApkUpdater.checkAndInstallAsync(this@MainActivity)
            handler.postDelayed(this, 15 * 60 * 1000L) // Every 15 minutes
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false

            addJavascriptInterface(KioskJsBridge(), "AndroidKiosk")

            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError
                ) {
                    if (request.isForMainFrame) {
                        handler.postDelayed({ loadPlayerUrl() }, 5000L)
                    }
                }
            }
        }

        setContentView(webView)
        applyImmersiveMode()
        enableKioskLockTaskIfDeviceOwner()
        loadPlayerUrl()

        handler.postDelayed(otaRunnable, 15_000L)
    }

    override fun onResume() {
        super.onResume()
        applyImmersiveMode()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        webView.destroy()
        super.onDestroy()
    }

    override fun onBackPressed() {
        // Block back button exit in Kiosk mode
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_INFO) {
            showSettingsDialog()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.action == MotionEvent.ACTION_DOWN && ev.x < 180f && ev.y < 180f) {
            val now = System.currentTimeMillis()
            tapCount = if (now - lastTapMs < 800L) tapCount + 1 else 1
            lastTapMs = now
            if (tapCount >= 5) {
                tapCount = 0
                showSettingsDialog()
                return true
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    private fun loadPlayerUrl() {
        val serverUrl = KioskPrefs.getServerUrl(this)
        val deviceId = KioskPrefs.getDeviceId(this)
        webView.loadUrl("$serverUrl/player/$deviceId")
    }

    private fun applyImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                )
        }
    }

    private fun enableKioskLockTaskIfDeviceOwner() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (dpm.isDeviceOwnerApp(packageName)) {
            val admin = KioskDeviceAdminReceiver.getComponentName(this)
            dpm.setLockTaskPackages(admin, arrayOf(packageName))
            startLockTask()
        }
    }

    private fun showSettingsDialog() {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 12)
        }
        val urlInput = EditText(this).apply {
            hint = "Server URL (e.g. http://192.168.1.100:3001)"
            setText(KioskPrefs.getServerUrl(this@MainActivity))
        }
        val idInput = EditText(this).apply {
            hint = "Device ID (e.g. tv-lobby-01)"
            setText(KioskPrefs.getDeviceId(this@MainActivity))
        }
        container.addView(urlInput)
        container.addView(idInput)

        val ownerStatus = if (ApkUpdater.isDeviceOwner(this)) "Device Owner: ACTIVE" else "Device Owner: NOT SET"

        AlertDialog.Builder(this)
            .setTitle("AdTV Kiosk Settings (v${BuildConfig.VERSION_NAME} / ${BuildConfig.VERSION_CODE})")
            .setMessage(ownerStatus)
            .setView(container)
            .setPositiveButton("Save & Reload") { _, _ ->
                KioskPrefs.setServerUrl(this, urlInput.text.toString())
                KioskPrefs.setDeviceId(this, idInput.text.toString())
                loadPlayerUrl()
            }
            .setNeutralButton("Check APK Update") { _, _ ->
                ApkUpdater.checkAndInstallAsync(this)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    inner class KioskJsBridge {
        @JavascriptInterface
        fun getVersionCode(): Int = BuildConfig.VERSION_CODE

        @JavascriptInterface
        fun getVersionName(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun getDeviceId(): String = KioskPrefs.getDeviceId(this@MainActivity)

        @JavascriptInterface
        fun isDeviceOwner(): Boolean = ApkUpdater.isDeviceOwner(this@MainActivity)

        @JavascriptInterface
        fun checkForUpdate() {
            ApkUpdater.checkAndInstallAsync(this@MainActivity)
        }

        @JavascriptInterface
        fun reloadPage() {
            handler.post { webView.reload() }
        }

        @JavascriptInterface
        fun openSettings() {
            handler.post { showSettingsDialog() }
        }
    }
}
