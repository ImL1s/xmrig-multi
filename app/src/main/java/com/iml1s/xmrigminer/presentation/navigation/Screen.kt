package com.iml1s.xmrigminer.presentation.navigation

sealed class Screen(val route: String) {
    data object Mining : Screen("mining")
    data object Config : Screen("config")
    data object Stats : Screen("stats")
    data object Settings : Screen("settings")
    data object Ambient : Screen("ambient")
}
