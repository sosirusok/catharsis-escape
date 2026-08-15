package kr.co.catharsis.owner.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val LightColors =
    lightColorScheme(
        primary = Color(0xFF8D2E40),
        onPrimary = Color.White,
        primaryContainer = Color(0xFFF7DADF),
        onPrimaryContainer = Color(0xFF3B0713),
        secondary = Color(0xFF75562E),
        secondaryContainer = Color(0xFFF5E1BF),
        background = Color(0xFFFAF6F1),
        onBackground = Color(0xFF21191B),
        surface = Color(0xFFFFFBFE),
        onSurface = Color(0xFF21191B),
        surfaceVariant = Color(0xFFF1E8E7),
        onSurfaceVariant = Color(0xFF514346),
        outline = Color(0xFF877376),
        error = Color(0xFFB3261E),
    )

private val DarkColors =
    darkColorScheme(
        primary = Color(0xFFFFB1BD),
        onPrimary = Color(0xFF54101F),
        primaryContainer = Color(0xFF721D2D),
        onPrimaryContainer = Color(0xFFFFD9DE),
        secondary = Color(0xFFE4C18E),
        secondaryContainer = Color(0xFF57401D),
        background = Color(0xFF130E10),
        onBackground = Color(0xFFEDE0E2),
        surface = Color(0xFF1B1517),
        onSurface = Color(0xFFEDE0E2),
        surfaceVariant = Color(0xFF504346),
        onSurfaceVariant = Color(0xFFD5C2C5),
        outline = Color(0xFFA08C8F),
        error = Color(0xFFFFB4AB),
    )

private val AppTypography =
    Typography(
        displaySmall =
            TextStyle(
                fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.SemiBold,
                fontSize = 36.sp,
                lineHeight = 42.sp,
                letterSpacing = (-0.5).sp,
            ),
        headlineMedium =
            TextStyle(
                fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.SemiBold,
                fontSize = 27.sp,
                lineHeight = 34.sp,
            ),
        titleLarge =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                lineHeight = 26.sp,
            ),
        titleMedium =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                lineHeight = 22.sp,
            ),
        bodyLarge =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Normal,
                fontSize = 16.sp,
                lineHeight = 24.sp,
            ),
        bodyMedium =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Normal,
                fontSize = 14.sp,
                lineHeight = 20.sp,
            ),
        labelLarge =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                lineHeight = 20.sp,
            ),
    )

@Composable
fun CatharsisOwnerTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = AppTypography,
        content = content,
    )
}
