package com.iml1s.xmrigminer.data.repository

import com.iml1s.xmrigminer.data.model.MiningStats
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class StatsRepositoryTest {

    private lateinit var repository: StatsRepository

    @Before
    fun setup() {
        repository = StatsRepository()
    }

    @Test
    fun `initial stats are zero`() = runTest {
        val stats = repository.stats.first()
        assertEquals(0.0, stats.hashrate, 0.01)
        assertEquals(0, stats.acceptedShares)
        assertEquals(0, stats.rejectedShares)
    }

    @Test
    fun `updateHashrate updates all hashrate values`() = runTest {
        repository.updateHashrate(100.0, 150.0, 200.0)
        
        val stats = repository.stats.first()
        assertEquals(100.0, stats.hashrate10s, 0.01)
        assertEquals(150.0, stats.hashrate60s, 0.01)
        assertEquals(200.0, stats.hashrate15m, 0.01)
    }

    @Test
    fun `incrementAccepted increases accepted shares`() = runTest {
        repeat(5) { repository.incrementAccepted() }
        
        val stats = repository.stats.first()
        assertEquals(5, stats.acceptedShares)
    }

    @Test
    fun `incrementRejected increases rejected shares`() = runTest {
        repeat(3) { repository.incrementRejected() }
        
        val stats = repository.stats.first()
        assertEquals(3, stats.rejectedShares)
    }

    @Test
    fun `updateCpuUsage updates cpu usage`() = runTest {
        repository.updateCpuUsage(75.5f)
        
        val stats = repository.stats.first()
        assertEquals(75.5f, stats.cpuUsage, 0.01f)
    }

    @Test
    fun `updateCpuUsage ignores zero values`() = runTest {
        repository.updateCpuUsage(50.0f)
        repository.updateCpuUsage(0f)
        
        val stats = repository.stats.first()
        assertEquals(50.0f, stats.cpuUsage, 0.01f)
    }

    @Test
    fun `updateDifficulty updates difficulty`() = runTest {
        repository.updateDifficulty(75000L)
        
        val stats = repository.stats.first()
        assertEquals(75000L, stats.difficulty)
    }

    @Test
    fun `reset clears all stats`() = runTest {
        repository.updateHashrate(100.0)
        repository.incrementAccepted()
        repository.incrementRejected()
        repository.updateCpuUsage(50f)
        
        repository.reset()
        
        val stats = repository.stats.first()
        assertEquals(0.0, stats.hashrate, 0.01)
        assertEquals(0, stats.acceptedShares)
        assertEquals(0, stats.rejectedShares)
        assertEquals(0f, stats.cpuUsage, 0.01f)
        assertEquals(0L, stats.uptime)
    }

    @Test
    fun `uptime tracks elapsed session time`() = runTest {
        repository.markSessionStarted(1_000L)
        repository.tickUptime(6_000L)
        assertEquals(5L, repository.stats.first().uptime)

        repository.reset()
        repository.tickUptime(12_000L)
        assertEquals(0L, repository.stats.first().uptime)
    }

    @Test
    fun `updateBatteryLevel updates battery`() = runTest {
        repository.updateBatteryLevel(85)
        
        val stats = repository.stats.first()
        assertEquals(85, stats.batteryLevel)
    }

    @Test
    fun `updateChargingState updates charging status`() = runTest {
        repository.updateChargingState(true)
        
        val stats = repository.stats.first()
        assertTrue(stats.isCharging)
    }
}
