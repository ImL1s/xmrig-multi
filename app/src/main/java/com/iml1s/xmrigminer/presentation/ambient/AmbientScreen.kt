package com.iml1s.xmrigminer.presentation.ambient

import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.iml1s.xmrigminer.data.ambient.AmbientClockPolicy
import com.iml1s.xmrigminer.data.ambient.AmbientMode
import com.iml1s.xmrigminer.presentation.theme.KilnDarkGround
import com.iml1s.xmrigminer.presentation.theme.KilnDarkInk
import com.iml1s.xmrigminer.presentation.theme.KilnDarkInkDim
import kotlinx.coroutines.delay
import java.util.Calendar

/**
 * Full-screen ambient clock (#74). Pure clock does not start mining.
 */
@Composable
fun AmbientScreen(
    onNavigateBack: () -> Unit,
    mode: AmbientMode = AmbientMode.CLOCK_ONLY,
    statusLine: String? = null
) {
    val resolution = remember(mode) { AmbientClockPolicy.resolve(mode) }
    val sideEffects = remember(resolution) { AmbientClockPolicy.sideEffects(resolution) }
    require(!sideEffects.startMiner && !sideEffects.loadRandomX)

    val context = LocalContext.current
    var clockText by remember { mutableStateOf("--:--") }
    var dim by remember { mutableStateOf(1f) }

    DisposableEffect(Unit) {
        val window = (context as? ComponentActivity)?.window
        val previous = window?.attributes?.screenBrightness ?: WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            window?.let { w ->
                w.attributes = w.attributes?.apply {
                    screenBrightness = previous
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        while (true) {
            val cal = Calendar.getInstance()
            val minuteOfDay = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
            dim = AmbientClockPolicy.nightDimFactor(minuteOfDay)
            clockText = AmbientClockPolicy.formatWallClock(
                hours = cal.get(Calendar.HOUR_OF_DAY),
                minutes = cal.get(Calendar.MINUTE),
                showSeconds = false
            )
            val window = (context as? ComponentActivity)?.window
            window?.let { w ->
                w.attributes = w.attributes?.apply {
                    screenBrightness = (0.08f + 0.35f * dim).coerceIn(0.08f, 1f)
                }
            }
            val delayMs = AmbientClockPolicy.nextTickMs(System.currentTimeMillis(), showSeconds = false)
            delay(delayMs.coerceAtLeast(250L))
        }
    }

    val bg = Color(
        red = KilnDarkGround.red * dim,
        green = KilnDarkGround.green * dim,
        blue = KilnDarkGround.blue * dim,
        alpha = 1f
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(bg)
            .padding(24.dp)
    ) {
        TextButton(
            onClick = onNavigateBack,
            modifier = Modifier.align(Alignment.TopStart)
        ) {
            Text("Back", color = KilnDarkInkDim)
        }

        Column(
            modifier = Modifier.align(Alignment.Center),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = clockText,
                color = KilnDarkInk.copy(alpha = (0.55f + 0.45f * dim).coerceIn(0.4f, 1f)),
                fontSize = 72.sp,
                fontWeight = FontWeight.Light
            )
            if (resolution.showMinerCard && !statusLine.isNullOrBlank()) {
                Text(text = statusLine, color = KilnDarkInkDim, fontSize = 16.sp)
            } else {
                Text(
                    text = "Clock only — mining not started",
                    color = KilnDarkInkDim,
                    fontSize = 14.sp
                )
            }
        }
    }
}
