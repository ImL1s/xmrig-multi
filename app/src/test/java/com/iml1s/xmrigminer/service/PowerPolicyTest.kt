package com.iml1s.xmrigminer.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PowerPolicyTest {

    private val t0 = 1_000_000L

    private fun pluggedObs(
        soc: Int = 80,
        status: PowerPolicy.ChargingStatus = PowerPolicy.ChargingStatus.CHARGING,
        plugged: Boolean = true,
        flowMa: Int? = 500
    ) = PowerPolicy.Observation(
        platformHasBattery = true,
        batteryApiAvailable = true,
        externalPowerPresent = plugged,
        powerSource = PowerPolicy.PowerSource.AC,
        chargingStatus = status,
        socPercent = soc,
        netBatteryFlowMa = flowMa,
        quality = PowerPolicy.Quality.OK,
        timestampMs = t0
    )

    @Test
    fun `desktop without battery is allowed`() {
        val v = PowerPolicy.evaluate(
            observation = PowerPolicy.Observation(
                platformHasBattery = false,
                batteryApiAvailable = false,
                quality = PowerPolicy.Quality.UNAVAILABLE,
                note = "No battery"
            ),
            intent = PowerPolicy.armSession(PowerPolicy.Intent()),
            nowMs = t0
        )
        assertEquals(PowerPolicy.Kind.ALLOWED, v.kind)
    }

    @Test
    fun `OEM not_charging at 80 percent still plugged`() {
        val obs = pluggedObs(soc = 80, status = PowerPolicy.ChargingStatus.NOT_CHARGING, flowMa = 0)
        assertTrue(PowerPolicy.isEffectivelyPlugged(obs))
        val v = PowerPolicy.evaluate(
            observation = obs,
            intent = PowerPolicy.armSession(PowerPolicy.Intent()),
            nowMs = t0
        )
        assertEquals(PowerPolicy.Kind.ALLOWED, v.kind)
    }

    @Test
    fun `FULL unplugged is not on charger`() {
        val obs = pluggedObs(soc = 100, status = PowerPolicy.ChargingStatus.FULL, plugged = false)
        assertFalse(PowerPolicy.isEffectivelyPlugged(obs))
        val v = PowerPolicy.evaluate(
            observation = obs,
            intent = PowerPolicy.armSession(PowerPolicy.Intent()),
            nowMs = t0
        )
        assertEquals(PowerPolicy.Kind.PAUSED, v.kind)
    }

    @Test
    fun `charge first then allow`() {
        var v = PowerPolicy.evaluate(
            observation = pluggedObs(soc = 30),
            intent = PowerPolicy.armSession(PowerPolicy.Intent()),
            nowMs = t0
        )
        assertEquals(PowerPolicy.Kind.WAITING, v.kind)

        v = PowerPolicy.evaluate(
            observation = pluggedObs(soc = 55),
            intent = PowerPolicy.armSession(PowerPolicy.Intent()),
            nowMs = t0 + 60_000
        )
        assertEquals(PowerPolicy.Kind.ALLOWED, v.kind)
    }

    @Test
    fun `manual stop survives plug`() {
        var intent = PowerPolicy.latchUserStop(PowerPolicy.armSession(PowerPolicy.Intent()))
        var v = PowerPolicy.evaluate(pluggedObs(plugged = true), intent = intent, nowMs = t0)
        assertEquals(PowerPolicy.Kind.USER_STOPPED, v.kind)

        intent = PowerPolicy.armSession(intent)
        v = PowerPolicy.evaluate(pluggedObs(soc = 90), intent = intent, nowMs = t0 + 1)
        assertEquals(PowerPolicy.Kind.ALLOWED, v.kind)
    }

    @Test
    fun `cross midnight schedule`() {
        assertTrue(PowerPolicy.inWindow(23 * 60, 22 * 60, 6 * 60))
        assertTrue(PowerPolicy.inWindow(3 * 60, 22 * 60, 6 * 60))
        assertFalse(PowerPolicy.inWindow(12 * 60, 22 * 60, 6 * 60))
    }

    @Test
    fun `net discharge while plugged pauses`() {
        val v = PowerPolicy.evaluate(
            observation = pluggedObs(soc = 70, status = PowerPolicy.ChargingStatus.NOT_CHARGING, flowMa = -200),
            config = PowerPolicy.Defaults(chargeToPercentBeforeMine = null),
            intent = PowerPolicy.armSession(PowerPolicy.Intent()),
            nowMs = t0
        )
        assertEquals(PowerPolicy.Kind.PAUSED, v.kind)
    }
}
