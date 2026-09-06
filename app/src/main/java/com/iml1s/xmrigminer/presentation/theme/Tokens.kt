package com.iml1s.xmrigminer.presentation.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Semantic telemetry colours that Material's role names cannot express.
 *
 * A miner has to distinguish "this number was measured" from "this number is a guess" from
 * "we cannot measure this at all" (#54). Those are not primary/secondary/error, so they live
 * here and are resolved once per theme.
 */
@Immutable
data class MinerColors(
    /** Live, directly measured telemetry. */
    val signal: Color,
    val signalContainer: Color,
    /** Derived or approximated values, and non-blocking warnings. */
    val caution: Color,
    val cautionContainer: Color,
    /** Faults, rejected shares, blocked actions. */
    val halt: Color,
    /** Fault colour tuned for small text rather than fills. */
    val haltInk: Color,
    val haltContainer: Color,
    /** Unmeasurable or unsupported: deliberately colourless so it never reads as a value. */
    val inert: Color,
    val inertContainer: Color,
    /** Hairline rules used instead of nested cards. */
    val hairline: Color,
    /** Recessed wells for logs and readouts. */
    val inset: Color,
    val inkDim: Color,
    val inkFaint: Color
)

val LocalMinerColors = staticCompositionLocalOf {
    // Overwritten by XMRigMinerTheme; these defaults only matter for stray previews.
    MinerColors(
        signal = KilnDarkSignal,
        signalContainer = KilnDarkSignalContainer,
        caution = KilnDarkCaution,
        cautionContainer = KilnDarkCautionContainer,
        halt = KilnDarkHalt,
        haltInk = KilnDarkHaltInk,
        haltContainer = KilnDarkHaltContainer,
        inert = KilnDarkInert,
        inertContainer = KilnDarkInertContainer,
        hairline = KilnDarkHairline,
        inset = KilnDarkSurfaceInset,
        inkDim = KilnDarkInkDim,
        inkFaint = KilnDarkInkFaint
    )
}

internal val DarkMinerColors = MinerColors(
    signal = KilnDarkSignal,
    signalContainer = KilnDarkSignalContainer,
    caution = KilnDarkCaution,
    cautionContainer = KilnDarkCautionContainer,
    halt = KilnDarkHalt,
    haltInk = KilnDarkHaltInk,
    haltContainer = KilnDarkHaltContainer,
    inert = KilnDarkInert,
    inertContainer = KilnDarkInertContainer,
    hairline = KilnDarkHairline,
    inset = KilnDarkSurfaceInset,
    inkDim = KilnDarkInkDim,
    inkFaint = KilnDarkInkFaint
)

internal val LightMinerColors = MinerColors(
    signal = KilnLightSignal,
    signalContainer = KilnLightSignalContainer,
    caution = KilnLightCaution,
    cautionContainer = KilnLightCautionContainer,
    halt = KilnLightHalt,
    haltInk = KilnLightHaltInk,
    haltContainer = KilnLightHaltContainer,
    inert = KilnLightInert,
    inertContainer = KilnLightInertContainer,
    hairline = KilnLightHairline,
    inset = KilnLightSurfaceInset,
    inkDim = KilnLightInkDim,
    inkFaint = KilnLightInkFaint
)

/** Four-step spacing rhythm. Screens compose from these instead of ad-hoc dp literals. */
object Space {
    val xs: Dp = 4.dp
    val sm: Dp = 8.dp
    val md: Dp = 12.dp
    val lg: Dp = 16.dp
    val xl: Dp = 24.dp
    val xxl: Dp = 32.dp
}

object Sizes {
    /** Material's minimum touch target; primary controls stay at or above it. */
    val minTouchTarget: Dp = 48.dp
    val primaryActionHeight: Dp = 56.dp
    val statusDot: Dp = 10.dp
    val rowIcon: Dp = 18.dp
    /** Below this width the home screen stacks; at or above it splits into two columns (#58). */
    val twoColumnBreakpoint: Dp = 600.dp
    /** Keeps prose from running to unreadable line lengths on tablets and desktops. */
    val maxContentWidth: Dp = 720.dp
}
