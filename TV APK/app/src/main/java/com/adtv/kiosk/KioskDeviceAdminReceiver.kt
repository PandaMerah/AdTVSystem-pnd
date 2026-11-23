package com.adtv.kiosk

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log

class KioskDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i("AdTVKiosk", "Device Admin enabled")
    }

    companion object {
        fun getComponentName(context: Context): ComponentName {
            return ComponentName(context.applicationContext, KioskDeviceAdminReceiver::class.java)
        }
    }
}
