package com.iml1s.xmrigminer.service

import com.iml1s.xmrigminer.data.model.MiningConfig
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Saved power settings must gate Start (#126).
 */
class PowerSettingsGateTest {

    @Test
    fun `require external power blocks unplugged start`() {
        val config = MiningConfig(requireExternalPower = true, walletAddress = "x")
        val controller = gateOnly()
        val obs = PowerPolicy.Observation(
            externalPowerPresent = false,
            chargingStatus = PowerPolicy.ChargingStatus.DISCHARGING,
            socPercent = 80,
            quality = PowerPolicy.Quality.OK,
            timestampMs = 1_000L
        )
        assertNotNull(controller.evaluatePowerGate(config, obs, nowMs = 1_000L))
    }

    @Test
    fun `charge to percent waits while plugged below target`() {
        val config = MiningConfig(
            requireExternalPower = true,
            chargeToPercentBeforeMine = 80,
            walletAddress = "x"
        )
        val controller = gateOnly()
        val obs = PowerPolicy.Observation(
            externalPowerPresent = true,
            powerSource = PowerPolicy.PowerSource.AC,
            chargingStatus = PowerPolicy.ChargingStatus.CHARGING,
            socPercent = 40,
            quality = PowerPolicy.Quality.OK,
            timestampMs = 1_000L
        )
        assertNotNull(controller.evaluatePowerGate(config, obs, nowMs = 1_000L))
    }

    @Test
    fun `defaults allow battery mining when user left limits off`() {
        val config = MiningConfig(
            requireExternalPower = false,
            pauseOnUnplug = false,
            chargeToPercentBeforeMine = null,
            walletAddress = "x"
        )
        val controller = gateOnly()
        val obs = PowerPolicy.Observation(
            externalPowerPresent = false,
            chargingStatus = PowerPolicy.ChargingStatus.DISCHARGING,
            socPercent = 50,
            quality = PowerPolicy.Quality.OK,
            timestampMs = 1_000L
        )
        assertNull(controller.evaluatePowerGate(config, obs, nowMs = 1_000L))
    }

    /** Uses evaluatePowerGate without WorkManager by constructing a minimal stub via reflection-free helper. */
    private fun gateOnly(): PowerGateFacade = PowerGateFacade()

    class PowerGateFacade {
        fun evaluatePowerGate(
            config: MiningConfig,
            observation: PowerPolicy.Observation,
            nowMs: Long
        ): MiningStartResult.InvalidConfig? {
            val verdict = PowerPolicy.evaluate(
                observation = observation,
                intent = PowerPolicy.armSession(PowerPolicy.Intent(), automationArmed = true),
                config = PowerPolicy.Defaults(
                    requireExternalPower = config.requireExternalPower,
                    pauseOnUnplug = config.pauseOnUnplug,
                    chargeToPercentBeforeMine = config.chargeToPercentBeforeMine,
                    minBatteryPercent = config.minBatteryPercent,
                    resumeBatteryPercent = config.resumeBatteryPercent,
                    pauseOnNetDischargeWhilePlugged = config.pauseOnNetDischargeWhilePlugged
                ),
                nowMs = nowMs
            )
            return when (verdict.kind) {
                PowerPolicy.Kind.ALLOWED -> null
                else -> MiningStartResult.InvalidConfig(
                    verdict.reasons.firstOrNull() ?: "blocked"
                )
            }
        }
    }
}
