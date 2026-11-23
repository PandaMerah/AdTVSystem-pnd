package com.adtv.kiosk

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Automatically relaunches MainActivity immediately after a silent PackageInstaller self-update.
 */
class PackageReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            Log.i("AdTVKiosk", "Package replaced via OTA — relaunching kiosk")
            val launch = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            context.startActivity(launch)
        }
    }
}
