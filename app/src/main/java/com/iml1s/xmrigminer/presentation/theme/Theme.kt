package com.iml1s.xmrigminer.presentation.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = KilnDarkEmber,
    onPrimary = KilnDarkEmberInk,
    primaryContainer = KilnDarkEmberContainer,
    onPrimaryContainer = KilnDarkInk,
    secondary = KilnDarkSignal,
    onSecondary = KilnDarkSurfaceInset,
    secondaryContainer = KilnDarkSignalContainer,
    onSecondaryContainer = KilnDarkInk,
    tertiary = KilnDarkCaution,
    onTertiary = KilnDarkSurfaceInset,
    tertiaryContainer = KilnDarkCautionContainer,
    onTertiaryContainer = KilnDarkInk,
    error = KilnDarkHalt,
    onError = KilnDarkSurfaceInset,
    errorContainer = KilnDarkHaltContainer,
    onErrorContainer = KilnDarkHaltInk,
    background = KilnDarkGround,
    onBackground = KilnDarkInk,
    surface = KilnDarkSurface,
    onSurface = KilnDarkInk,
    surfaceVariant = KilnDarkSurfaceRaised,
    onSurfaceVariant = KilnDarkInkDim,
    surfaceContainerHighest = KilnDarkSurfaceRaised,
    outline = KilnDarkInkFaint,
    outlineVariant = KilnDarkHairline,
    scrim = Color.Black
)

private val LightColorScheme = lightColorScheme(
    primary = KilnLightEmber,
    onPrimary = KilnLightEmberInk,
    primaryContainer = KilnLightEmberContainer,
    onPrimaryContainer = KilnLightInk,
    secondary = KilnLightSignal,
    onSecondary = Color.White,
    secondaryContainer = KilnLightSignalContainer,
    onSecondaryContainer = KilnLightInk,
    tertiary = KilnLightCaution,
    onTertiary = Color.White,
    tertiaryContainer = KilnLightCautionContainer,
    onTertiaryContainer = KilnLightInk,
    error = KilnLightHalt,
    onError = Color.White,
    errorContainer = KilnLightHaltContainer,
    onErrorContainer = KilnLightHalt,
    background = KilnLightGround,
    onBackground = KilnLightInk,
    surface = KilnLightSurface,
    onSurface = KilnLightInk,
    surfaceVariant = KilnLightSurfaceInset,
    onSurfaceVariant = KilnLightInkDim,
    surfaceContainerHighest = KilnLightSurfaceRaised,
    outline = KilnLightInkFaint,
    outlineVariant = KilnLightHairline,
    scrim = Color.Black
)

/** Squared-off corners; a control panel is machined, not moulded. */
private val KilnShapes = Shapes(
    extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(3.dp),
    small = androidx.compose.foundation.shape.RoundedCornerShape(5.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(7.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
    extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(14.dp)
)

/**
 * @param dynamicColor opt-in only. Wallpaper-derived palettes reassign the meaning of the
 * signal/caution/halt hues that this app uses to state whether a number is trustworthy, so
 * the brand palette is the default even on Android 12+.
 */
@Composable
fun XMRigMinerTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }
    val minerColors = if (darkTheme) DarkMinerColors else LightMinerColors

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            // Edge-to-edge: let the app background run under the bars instead of painting a
            // primary-coloured band that fights the console surface.
            WindowCompat.setDecorFitsSystemWindows(window, false)
            @Suppress("DEPRECATION")
            window.statusBarColor = Color.Transparent.toArgb()
            @Suppress("DEPRECATION")
            window.navigationBarColor = Color.Transparent.toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !darkTheme
                isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    CompositionLocalProvider(LocalMinerColors provides minerColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = Typography,
            shapes = KilnShapes,
            content = content
        )
    }
}