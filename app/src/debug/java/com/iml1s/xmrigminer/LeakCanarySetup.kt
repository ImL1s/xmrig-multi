package com.iml1s.xmrigminer

import leakcanary.AppWatcher
import leakcanary.LeakCanary
import shark.AndroidReferenceMatchers

/**
 * Debug-only LeakCanary tuning.
 *
 * Issue #3 reported ResourcesImpl.mAppContext → SystemJobService on Nothing / SDK 36.
 * That path is the same OEM/framework static-context library leak LeakCanary already
 * excludes for Xiaomi, Samsung, Motorola, etc.; Nothing was not in the built-in list.
 */
object LeakCanarySetup {
    @JvmStatic
    fun install() {
        if (!AppWatcher.isInstalled) return

        LeakCanary.config = LeakCanary.config.copy(
            referenceMatchers = AndroidReferenceMatchers.appDefaults +
                AndroidReferenceMatchers.staticFieldLeak(
                    className = "android.content.res.ResourcesImpl",
                    fieldName = "mAppContext",
                    description = "ResourcesImpl keeps a static Context on some OEM builds " +
                        "(Nothing / Android 16). Same library-leak pattern as LeakCanary's " +
                        "built-in ResourcesImpl.mAppContext exclusions; ~1KB retained " +
                        "(github.com/ImL1s/xmrig-android/issues/3)."
                ) {
                    manufacturer.equals("Nothing", ignoreCase = true)
                }
        )
    }
}
