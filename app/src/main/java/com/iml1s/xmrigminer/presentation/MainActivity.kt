package com.iml1s.xmrigminer.presentation

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import androidx.navigation.compose.rememberNavController
import com.iml1s.xmrigminer.presentation.navigation.AppNavigation
import com.iml1s.xmrigminer.presentation.theme.XMRigMinerTheme
import com.iml1s.xmrigminer.service.MiningController
import com.iml1s.xmrigminer.service.MiningSessionLatch
import com.iml1s.xmrigminer.service.MiningStartResult
import com.iml1s.xmrigminer.service.quick.QuickCommandHandler
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var miningController: MiningController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)

        setContent {
            XMRigMinerTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val navController = rememberNavController()
                    AppNavigation(navController = navController)
                }
            }
        }
        handleQuickAction(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleQuickAction(intent)
    }

    /** Quick controls (#79): complete authorized start in-app; never bypass Stop latch. */
    private fun handleQuickAction(intent: Intent?) {
        when (intent?.getStringExtra("quick_action")) {
            "start" -> {
                if (MiningSessionLatch.isUserStopped()) {
                    Toast.makeText(this, "Stop latched — clear Stop in app first", Toast.LENGTH_LONG).show()
                    return
                }
                if (!QuickCommandHandler.automationArmed) {
                    Toast.makeText(this, "Automation disabled", Toast.LENGTH_LONG).show()
                    return
                }
                lifecycleScope.launch {
                    when (val result = miningController.start()) {
                        is MiningStartResult.Started ->
                            Toast.makeText(this@MainActivity, "Mining started", Toast.LENGTH_SHORT).show()
                        is MiningStartResult.InvalidConfig ->
                            Toast.makeText(this@MainActivity, result.message, Toast.LENGTH_LONG).show()
                    }
                }
            }
            "clock" -> {
                Toast.makeText(this, "Opened XMRig Multi", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
