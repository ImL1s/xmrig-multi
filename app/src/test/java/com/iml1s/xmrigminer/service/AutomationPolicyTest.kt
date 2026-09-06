package com.iml1s.xmrigminer.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AutomationPolicyTest {

    @Test
    fun `hobby allows negative estimate`() {
        val v = AutomationPolicy.evaluate(
            intent = AutomationPolicy.armAutomation(AutomationPolicy.Intent()),
            config = AutomationPolicy.Defaults(
                economicGoal = AutomationPolicy.EconomicGoal.HOBBY,
                dailySpendCapFiat = 10.0
            ),
            economy = AutomationPolicy.Economy(netFiat = -1.0, netQuality = "estimated"),
            budget = AutomationPolicy.Budget(spentFiatToday = 0.0)
        )
        assertEquals(AutomationPolicy.Kind.ALLOWED, v.kind)
    }

    @Test
    fun `profit only pauses on negative`() {
        val v = AutomationPolicy.evaluate(
            intent = AutomationPolicy.armAutomation(AutomationPolicy.Intent()),
            config = AutomationPolicy.Defaults(economicGoal = AutomationPolicy.EconomicGoal.PROFIT_ONLY),
            economy = AutomationPolicy.Economy(netFiat = -1.0, netQuality = "estimated")
        )
        assertEquals(AutomationPolicy.Kind.PAUSED, v.kind)
    }

    @Test
    fun `stop remains latched`() {
        val intent = AutomationPolicy.latchUserStop(
            AutomationPolicy.armAutomation(AutomationPolicy.Intent())
        )
        val v = AutomationPolicy.evaluate(intent = intent)
        assertEquals(AutomationPolicy.Kind.USER_STOPPED, v.kind)
    }

    @Test
    fun `evaluate never starts miner`() {
        val v = AutomationPolicy.evaluate(
            intent = AutomationPolicy.armAutomation(AutomationPolicy.Intent())
        )
        assertTrue(!v.startsMiner)
    }
}
