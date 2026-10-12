package com.benhealthos.app.presentation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.benhealthos.app.presentation.screens.LockScreen
import com.benhealthos.app.presentation.screens.ManualBpScreen
import com.benhealthos.app.presentation.screens.MoreScreen
import com.benhealthos.app.presentation.screens.NotImplementedScreen
import com.benhealthos.app.presentation.screens.OnboardingScreen
import com.benhealthos.app.presentation.screens.LabsScreen
import com.benhealthos.app.presentation.screens.MedicationsScreen
import com.benhealthos.app.presentation.screens.NutritionScreen
import com.benhealthos.app.presentation.screens.PreventiveScreen
import com.benhealthos.app.presentation.screens.SettingsScreen
import com.benhealthos.app.presentation.screens.SourcesScreen
import com.benhealthos.app.presentation.screens.TodayScreen
import com.benhealthos.app.presentation.screens.TrendsScreen

private data class Tab(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val TABS = listOf(
    Tab("today", "Today", Icons.Filled.Home),
    Tab("trends", "Trends", Icons.Filled.Timeline),
    Tab("bp", "BP", Icons.Filled.Favorite),
    Tab("sources", "Sources", Icons.Filled.Sync),
    Tab("more", "More", Icons.Filled.MoreHoriz),
)

@Composable
fun AppRoot(activity: FragmentActivity, vm: AppViewModel = viewModel()) {
    val state by vm.state.collectAsState()
    when {
        state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        !state.signedIn || !state.onboardingDone -> OnboardingScreen(onDone = { vm.completeOnboarding() })
        state.locked -> LockScreen(activity = activity, onUnlocked = { vm.unlock() })
        else -> MainScaffold(onSignOut = { vm.signOut() })
    }
}

@Composable
private fun MainScaffold(onSignOut: () -> Unit) {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route
    Scaffold(
        bottomBar = {
            NavigationBar {
                TABS.forEach { tab ->
                    NavigationBarItem(
                        selected = current == tab.route || (tab.route == "more" && current?.startsWith("placeholder") == true) || (tab.route == "more" && current == "settings"),
                        onClick = { nav.navigate(tab.route) { launchSingleTop = true; popUpTo("today") { saveState = true }; restoreState = true } },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = "today", modifier = Modifier.padding(padding)) {
            composable("today") { TodayScreen(onOpenMetric = { nav.navigate("trends?metric=$it") }) }
            composable("trends") { TrendsScreen() }
            composable("trends?metric={metric}") { entry -> TrendsScreen(initialMetric = entry.arguments?.getString("metric")) }
            composable("bp") { ManualBpScreen() }
            composable("sources") { SourcesScreen() }
            composable("more") { MoreScreen(onNavigate = { nav.navigate(it) }) }
            composable("settings") { SettingsScreen(onSignOut = onSignOut) }
            composable("nutrition") { NutritionScreen() }
            composable("labs") { LabsScreen() }
            composable("medications") { MedicationsScreen() }
            composable("preventive") { PreventiveScreen() }
            composable("placeholder/{name}/{phase}") { entry ->
                NotImplementedScreen(entry.arguments?.getString("name") ?: "", entry.arguments?.getString("phase")?.toIntOrNull() ?: 0)
            }
        }
    }
    // Settings icon is reachable from More; keep the import used.
    @Suppress("UNUSED_VARIABLE") val settingsIcon = Icons.Filled.Settings
}
