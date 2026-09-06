package com.iml1s.xmrigminer.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MiningRuntimePolicyTest {

    @Test
    fun `play channel does not allow on-device mining claim`() {
        assertTrue(MiningRuntimePolicy.allowsOnDeviceMining(MiningRuntimePolicy.DistributionChannel.GITHUB_APK))
        assertFalse(MiningRuntimePolicy.allowsOnDeviceMining(MiningRuntimePolicy.DistributionChannel.GOOGLE_PLAY))
    }

    @Test
    fun `automated fgs denial and quota do not retry`() {
        assertFalse(
            MiningRuntimePolicy.shouldRetryAutomatedStart(MiningRuntimePolicy.FailureKind.FGS_START_NOT_ALLOWED)
        )
        assertFalse(
            MiningRuntimePolicy.shouldRetryAutomatedStart(MiningRuntimePolicy.FailureKind.QUOTA_EXHAUSTED)
        )
        assertFalse(
            MiningRuntimePolicy.shouldRetryAutomatedStart(MiningRuntimePolicy.FailureKind.FORCE_STOPPED)
        )
    }

    @Test
    fun `system limit messages clear mining ui`() {
        val msg = MiningRuntimePolicy.messageFor(
            MiningRuntimePolicy.FailureKind.QUOTA_EXHAUSTED,
            MiningRuntimePolicy.StartPath.USER_VISIBLE
        )
        assertTrue(msg.clearMiningUi)
        assertEquals("system_quota", msg.code)
        assertTrue(msg.message.contains("OS limit", ignoreCase = true))
    }

    @Test
    fun `dataSync never guarantees overnight`() {
        assertFalse(MiningRuntimePolicy.dataSyncOvernightGuaranteed(targetSdk = 35, androidSdk = 36))
        assertFalse(MiningRuntimePolicy.dataSyncOvernightGuaranteed(targetSdk = 34, androidSdk = 34))
    }

    @Test
    fun `classifyThrowable maps fgs start denial`() {
        val ex = SecurityException("ForegroundServiceStartNotAllowedException: start not allowed")
        assertEquals(
            MiningRuntimePolicy.FailureKind.FGS_START_NOT_ALLOWED,
            MiningRuntimePolicy.classifyThrowable(ex)
        )
    }

    @Test
    fun `lifecycle matrix events never auto-retry after user or system stop`() {
        val noRetry = listOf(
            MiningRuntimePolicy.FailureKind.QUOTA_EXHAUSTED,
            MiningRuntimePolicy.FailureKind.FGS_START_NOT_ALLOWED,
            MiningRuntimePolicy.FailureKind.NOTIFICATION_DENIED,
            MiningRuntimePolicy.FailureKind.OS_STOPPED,
            MiningRuntimePolicy.FailureKind.FORCE_STOPPED,
            MiningRuntimePolicy.FailureKind.USER_STOPPED
        )
        noRetry.forEach {
            assertFalse(MiningRuntimePolicy.shouldRetryAutomatedStart(it))
            assertTrue(MiningRuntimePolicy.messageFor(it, MiningRuntimePolicy.StartPath.AUTOMATED).clearMiningUi)
        }
    }
}
