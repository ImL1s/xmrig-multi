package com.iml1s.xmrigminer

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.iml1s.xmrigminer.native.XmrigBinaryResolver
import com.iml1s.xmrigminer.native.XmrigNativeCapabilities
import com.iml1s.xmrigminer.service.MiningSessionLatch
import com.iml1s.xmrigminer.service.MiningWorker
import com.iml1s.xmrigminer.service.PrefsSessionIntentStore
import com.iml1s.xmrigminer.wear.WearStatsSyncer
import dagger.hilt.android.HiltAndroidApp
import timber.log.Timber
import java.io.File
import javax.inject.Inject

@HiltAndroidApp
class XMRigApplication : Application(), Configuration.Provider {
    
    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    @Inject
    lateinit var wearStatsSyncer: WearStatsSyncer
    
    override fun onCreate() {
        super.onCreate()
        
        // Initialize Timber
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
            // Debug source set only (app/src/release is gitignored as "release/").
            runCatching {
                Class.forName("com.iml1s.xmrigminer.LeakCanarySetup")
                    .getMethod("install")
                    .invoke(null)
            }
        }

        // Restore UserStopped / automation across process death (#123/#124).
        MiningSessionLatch.attach(PrefsSessionIntentStore(this))

        loadNativeCapabilities()

        createNotificationChannel()
        wearStatsSyncer.start()
        Timber.i("XMRig Multi Application started")
    }

    private fun loadNativeCapabilities() {
        runCatching {
            val resolver = XmrigBinaryResolver(
                nativeLibraryDir = File(applicationInfo.nativeLibraryDir),
                filesDir = filesDir,
                openAsset = { name ->
                    try {
                        assets.open(name)
                    } catch (_: Exception) {
                        null
                    }
                }
            )
            val binary = resolver.resolve()
            XmrigNativeCapabilities.load(
                openAsset = { name ->
                    try {
                        assets.open(name)
                    } catch (_: Exception) {
                        null
                    }
                },
                binaryFile = binary
            )
        }.onFailure { e ->
            Timber.w(e, "Native capabilities load failed — feature gates stay locked (#134)")
            XmrigNativeCapabilities.resetForTests()
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                MiningWorker.CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_channel_desc)
                setShowBadge(false)
                enableLights(false)
                enableVibration(false)
            }
            
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager?.createNotificationChannel(channel)
            
            Timber.d("Notification channel created: ${MiningWorker.CHANNEL_ID}")
        }
    }
    
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(android.util.Log.DEBUG)
            .build()
}
