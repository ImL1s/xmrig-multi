package com.iml1s.xmrigminer.service

import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import com.iml1s.xmrigminer.R
import com.iml1s.xmrigminer.data.repository.ConfigRepository
import com.iml1s.xmrigminer.data.repository.StatsRepository
import com.iml1s.xmrigminer.native.XmrigBinaryResolver
import com.iml1s.xmrigminer.native.XmrigLaunchCommand
import com.iml1s.xmrigminer.native.XmrigNativeCapabilities
import com.iml1s.xmrigminer.native.XmrigProcessController
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File
import android.os.Process as AndroidProcess

@HiltWorker
class MiningWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val configRepository: ConfigRepository,
    private val statsRepository: StatsRepository
) : CoroutineWorker(context, params) {

    private var process: Process? = null
    private var outputJob: Job? = null
    private var cpuMonitorJob: Job? = null

    companion object {
        const val WORK_NAME = "mining_work"
        const val NOTIFICATION_ID = 1001
        const val CHANNEL_ID = "xmrig_mining"
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Timber.i("MiningWorker doWork() started")
        try {
            setForeground(createForegroundInfo())
            startMining()
            Result.success()
        } catch (e: CancellationException) {
            // WorkManager cancel / coroutine cancel — still tear down XMRig below.
            throw e
        } catch (e: Exception) {
            Timber.e(e, "Mining failed")
            if (isStopped) Result.success() else Result.retry()
        } finally {
            withContext(NonCancellable) {
                stopMining()
            }
        }
    }

    private suspend fun startMining() = coroutineScope {
        val config = configRepository.getConfig().first()

        if (config.useTls && !XmrigNativeCapabilities.TLS_ENABLED) {
            throw IllegalStateException(XmrigNativeCapabilities.TLS_UNSUPPORTED_MESSAGE)
        }
        if (!config.isValid()) {
            val errorMsg = when {
                config.walletAddress.isBlank() -> "錢包地址未設置"
                config.poolUrl.isBlank() -> "礦池地址未設置"
                config.threads <= 0 -> "線程數無效"
                config.maxCpuUsage !in 10..100 -> "CPU使用率設置無效"
                else -> "配置無效"
            }
            throw IllegalStateException(errorMsg)
        }

        val logFile = File(applicationContext.filesDir, "xmrig.log")
        val configFile = prepareConfigFile(config.toJson(logFile.absolutePath))
        val binaryPath = resolveBinary()

        val args = XmrigLaunchCommand.build(
            binaryPath = binaryPath,
            configFile = configFile,
            threads = config.threads
        )

        Timber.i("Starting XMRig: ${args.joinToString(" ")}")

        process = ProcessBuilder(args).apply {
            directory(applicationContext.filesDir)
            redirectErrorStream(true)
            environment()["LD_LIBRARY_PATH"] = File(binaryPath).parent ?: ""
        }.start()

        outputJob = launch(Dispatchers.IO) {
            process?.inputStream?.bufferedReader()?.use { reader ->
                reader.lineSequence()
                    .asFlow()
                    .catch { e -> Timber.e(e, "Output read error") }
                    .collect { line -> parseOutputLine(line) }
            }
        }

        cpuMonitorJob = launch(Dispatchers.IO) {
            monitorCpuUsage()
        }

        val running = process ?: return@coroutineScope
        statsRepository.markSessionStarted()
        while (!isStopped && XmrigProcessController.isAlive(running)) {
            statsRepository.tickUptime()
            delay(500)
        }
        if (isStopped) {
            stopMining()
        }
    }

    private fun resolveBinary(): String {
        val resolver = XmrigBinaryResolver(
            nativeLibraryDir = File(applicationContext.applicationInfo.nativeLibraryDir),
            filesDir = applicationContext.filesDir,
            openAsset = { name ->
                try {
                    applicationContext.assets.open(name)
                } catch (_: Exception) {
                    null
                }
            }
        )
        return resolver.resolve().absolutePath
    }

    private fun prepareConfigFile(jsonConfig: String): File {
        return File(applicationContext.filesDir, "config.json").apply {
            writeText(jsonConfig)
            Timber.i("Config file written to $absolutePath")
        }
    }

    private suspend fun parseOutputLine(line: String) {
        Timber.v("XMRig: $line")

        when {
            line.contains("accepted", ignoreCase = true) -> {
                statsRepository.incrementAccepted()
                extractDifficulty(line)?.let { statsRepository.updateDifficulty(it) }
            }
            line.contains("rejected", ignoreCase = true) -> {
                statsRepository.incrementRejected()
            }
            line.contains("speed", ignoreCase = true) -> {
                extractHashrate(line)?.let { (h10s, h60s, h15m) ->
                    statsRepository.updateHashrate(h10s, h60s, h15m)
                }
            }
            line.contains("diff", ignoreCase = true) && line.contains("job", ignoreCase = true) -> {
                extractDifficulty(line)?.let { statsRepository.updateDifficulty(it) }
            }
        }
    }

    private fun extractHashrate(line: String): Triple<Double, Double, Double>? {
        val regex = """speed\s+10s/60s/15m\s+([\d.]+|n/a)\s+([\d.]+|n/a)\s+([\d.]+|n/a)\s+H/s""".toRegex()
        return regex.find(line)?.let { match ->
            Triple(
                match.groupValues[1].toDoubleOrNull() ?: 0.0,
                match.groupValues[2].toDoubleOrNull() ?: 0.0,
                match.groupValues[3].toDoubleOrNull() ?: 0.0
            )
        }
    }

    private fun extractDifficulty(line: String): Long? {
        return """diff\s+(\d+)""".toRegex().find(line)?.groupValues?.get(1)?.toLongOrNull()
    }

    private suspend fun monitorCpuUsage() {
        val pid = AndroidProcess.myPid()
        var lastCpuTime = 0L
        var lastWallTime = 0L

        while (currentCoroutineContext().isActive && XmrigProcessController.isAlive(process)) {
            try {
                val statFile = File("/proc/$pid/stat")
                if (statFile.exists() && statFile.canRead()) {
                    val stat = statFile.readText().split(" ")
                    val currentCpuTime = stat[13].toLong() + stat[14].toLong()
                    val currentWallTime = System.currentTimeMillis()

                    if (lastCpuTime > 0 && lastWallTime > 0) {
                        val cpuTimeDelta = currentCpuTime - lastCpuTime
                        val wallTimeDelta = currentWallTime - lastWallTime
                        if (wallTimeDelta > 0) {
                            val cpuUsage = (cpuTimeDelta * 10.0 / wallTimeDelta * 100).toFloat()
                            val cpuCores = Runtime.getRuntime().availableProcessors()
                            statsRepository.updateCpuUsage(cpuUsage.coerceIn(0f, cpuCores * 100f))
                        }
                    }
                    lastCpuTime = currentCpuTime
                    lastWallTime = currentWallTime
                } else {
                    return
                }
                delay(5000)
            } catch (e: Exception) {
                Timber.e(e, "Error monitoring CPU usage")
                delay(5000)
            }
        }
    }

    private fun createForegroundInfo(): ForegroundInfo {
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setContentTitle("XMRig Mining")
            .setContentText("Mining in progress...")
            .setSmallIcon(R.drawable.ic_mining)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(
                NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    @Synchronized
    private fun stopMining() {
        cpuMonitorJob?.cancel()
        outputJob?.cancel()
        XmrigProcessController.stop(process)
        process = null
        Timber.i("Mining stopped")
    }
}
