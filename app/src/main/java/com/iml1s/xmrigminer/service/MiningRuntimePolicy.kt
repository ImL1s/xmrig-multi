package com.iml1s.xmrigminer.service

/**
 * Android mining runtime policy (#61).
 * Encodes channel + OS restriction outcomes without bypassing quota/FGS rules.
 */
object MiningRuntimePolicy {

    enum class DistributionChannel {
        /** Sideload / GitHub APK — on-device mining allowed with honest FGS. */
        GITHUB_APK,
        /** Play distribution must not claim on-device miner capability. */
        GOOGLE_PLAY
    }

    enum class StartPath {
        /** User tapped Start while app visible / from mining notification action. */
        USER_VISIBLE,
        /** Plug / schedule / reboot with prior intent — may be denied by OS. */
        AUTOMATED
    }

    enum class FailureKind {
        QUOTA_EXHAUSTED,
        FGS_START_NOT_ALLOWED,
        NOTIFICATION_DENIED,
        OS_STOPPED,
        FORCE_STOPPED,
        USER_STOPPED
    }

    data class UserMessage(
        val code: String,
        val title: String,
        val message: String,
        val actions: List<String>,
        /** UI must not keep showing Mining when true. */
        val clearMiningUi: Boolean
    )

    fun allowsOnDeviceMining(channel: DistributionChannel): Boolean =
        channel == DistributionChannel.GITHUB_APK

    /**
     * Automated cold starts must not retry-storm when the OS forbids FGS start.
     */
    fun shouldRetryAutomatedStart(failure: FailureKind): Boolean = when (failure) {
        FailureKind.FGS_START_NOT_ALLOWED,
        FailureKind.QUOTA_EXHAUSTED,
        FailureKind.NOTIFICATION_DENIED,
        FailureKind.FORCE_STOPPED,
        FailureKind.USER_STOPPED -> false
        FailureKind.OS_STOPPED -> false
    }

    fun messageFor(failure: FailureKind, path: StartPath): UserMessage = when (failure) {
        FailureKind.QUOTA_EXHAUSTED -> UserMessage(
            code = "system_quota",
            title = "System limit reached",
            message = "Android job / foreground quota is exhausted. Mining stopped — this is an OS limit, not a pool failure.",
            actions = listOf("Open app and tap Start later", "Keep the app visible while mining if overnight fails"),
            clearMiningUi = true
        )
        FailureKind.FGS_START_NOT_ALLOWED -> UserMessage(
            code = "fgs_start_not_allowed",
            title = "Background start blocked",
            message = if (path == StartPath.AUTOMATED) {
                "The system blocked a background mining start. Open the app and start mining yourself."
            } else {
                "Foreground service start was denied. Check notification permission and try Start again from the app."
            },
            actions = listOf("Open app", "Tap Start", "Enable notifications if prompted"),
            clearMiningUi = true
        )
        FailureKind.NOTIFICATION_DENIED -> UserMessage(
            code = "notification_denied",
            title = "Notifications required",
            message = "Mining needs a visible ongoing notification on modern Android. Permission was denied.",
            actions = listOf("Enable notifications for this app", "Tap Start again"),
            clearMiningUi = true
        )
        FailureKind.OS_STOPPED -> UserMessage(
            code = "os_stopped",
            title = "Stopped by system",
            message = "Android stopped the mining worker. It will not auto-restart without you.",
            actions = listOf("Open app and tap Start"),
            clearMiningUi = true
        )
        FailureKind.FORCE_STOPPED -> UserMessage(
            code = "force_stopped",
            title = "App force-stopped",
            message = "Force-stop clears mining. Android will not restart it until you open the app.",
            actions = listOf("Open app and tap Start"),
            clearMiningUi = true
        )
        FailureKind.USER_STOPPED -> UserMessage(
            code = "user_stopped",
            title = "Stopped",
            message = "Mining stopped by you. Plug-in or schedule must not override Stop.",
            actions = emptyList(),
            clearMiningUi = true
        )
    }

    /**
     * dataSync is transitional — not a promise of overnight mining on target 15+/16.
     */
    fun dataSyncOvernightGuaranteed(targetSdk: Int, androidSdk: Int): Boolean {
        // Never claim overnight reliability from dataSync alone.
        return false
    }

    fun classifyThrowable(t: Throwable): FailureKind? {
        val raw = ((t.message ?: "") + t.javaClass.name).lowercase()
        return when {
            raw.contains("foregroundservicestartnotallowed") -> FailureKind.FGS_START_NOT_ALLOWED
            raw.contains("securityexception") && raw.contains("foreground") -> FailureKind.FGS_START_NOT_ALLOWED
            raw.contains("quota") -> FailureKind.QUOTA_EXHAUSTED
            raw.contains("notification") && (raw.contains("denied") || raw.contains("permission")) ->
                FailureKind.NOTIFICATION_DENIED
            else -> null
        }
    }
}
