package com.iml1s.xmrigminer.service.quick

import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * One-shot start token authorization (#123).
 * Caller-supplied strings and replayed tokens must not authorize Start.
 */
class QuickStartAuthorizationTest {

    @Before
    fun setUp() {
        QuickStartAuthorization.resetForTests()
    }

    @After
    fun tearDown() {
        QuickStartAuthorization.resetForTests()
    }

    @Test
    fun `issued token authorizes once then fails`() {
        val token = QuickStartAuthorization.issue(nowMs = 1_000L, ttlMs = 60_000L)
        assertTrue(QuickStartAuthorization.consume(token, nowMs = 1_500L))
        assertFalse(QuickStartAuthorization.consume(token, nowMs = 1_600L))
    }

    @Test
    fun `caller fabricated token never authorizes`() {
        assertFalse(QuickStartAuthorization.consume("authorized=true", nowMs = 1L))
        assertFalse(QuickStartAuthorization.consume("forged-uuid", nowMs = 1L))
        assertFalse(QuickStartAuthorization.consume(null, nowMs = 1L))
        assertFalse(QuickStartAuthorization.consume("", nowMs = 1L))
    }

    @Test
    fun `expired token rejected`() {
        val token = QuickStartAuthorization.issue(nowMs = 1_000L, ttlMs = 100L)
        assertFalse(QuickStartAuthorization.consume(token, nowMs = 2_000L))
    }

    @Test
    fun `profile mismatch rejected`() {
        val token = QuickStartAuthorization.issue(nowMs = 1L, ttlMs = 60_000L, profileId = "a")
        assertFalse(QuickStartAuthorization.consume(token, nowMs = 2L, expectedProfileId = "b"))
    }

    @Test
    fun `matching profile accepted`() {
        val token = QuickStartAuthorization.issue(nowMs = 1L, ttlMs = 60_000L, profileId = "a")
        assertTrue(QuickStartAuthorization.consume(token, nowMs = 2L, expectedProfileId = "a"))
    }
}
