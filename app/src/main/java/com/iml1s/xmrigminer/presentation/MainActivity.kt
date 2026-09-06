package com.iml1s.xmrigminer.presentation

import android.app.AlertDialog
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
import com.iml1s.xmrigminer.service.quick.QuickActionGate
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

    /**
     * Quick controls (#79/#123):
     * - Internal Tile/Widget paths carry a one-shot [QuickStartAuthorization] token.
     * - Bare `quick_action=start` from an exported launcher (other apps) never auto-starts;
     *   user must confirm in a dialog.
     * - Intent extras are consumed immediately so rotation / onCreate cannot replay.
     */
    private fun handleQuickAction(intent: Intent?) {
        if (intent == null) return
        val action = intent.getStringExtra(EXTRA_QUICK_ACTION) ?: return
        val token = intent.getStringExtra(EXTRA_QUICK_AUTH_TOKEN)
        // Consume before any async work — prevents rotation / recreate replay (#123).
        intent.removeExtra(EXTRA_QUICK_ACTION)
        intent.removeExtra(EXTRA_QUICK_AUTH_TOKEN)

        when (action) {
            "start" -> {
                when (
                    QuickActionGate.decideStart(
                        action = action,
                        authToken = token,
                        userStopped = MiningSessionLatch.isUserStopped(),
                        automationArmed = MiningSessionLatch.isAutomationArmed()
                    )
                ) {
                    QuickActionGate.StartDisposition.AUTHORIZED_AUTO_START -> runAuthorizedStart()
                    QuickActionGate.StartDisposition.BLOCKED_USER_STOP ->
                        Toast.makeText(this, "Stop latched — clear Stop in app first", Toast.LENGTH_LONG).show()
                    QuickActionGate.StartDisposition.BLOCKED_AUTOMATION_OFF ->
                        Toast.makeText(this, "Automation disabled — enable via in-app Start", Toast.LENGTH_LONG).show()
                    QuickActionGate.StartDisposition.REQUIRE_USER_CONFIRM -> confirmExternalStart()
                    QuickActionGate.StartDisposition.IGNORE -> Unit
                }
            }
            "clock" -> {
                Toast.makeText(this, "Opened XMRig Multi", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun confirmExternalStart() {
        AlertDialog.Builder(this)
            .setTitle("Start mining?")
            .setMessage(
                "Another app or shortcut requested mining start. " +
                    "Confirm only if you intended this."
            )
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                // User confirmation authorizes this Start; automation arms only on success.
                runAuthorizedStart()
            }
            .show()
    }

    private fun runAuthorizedStart() {
        lifecycleScope.launch {
            when (val result = miningController.start()) {
                is MiningStartResult.Started -> {
                    MiningSessionLatch.setAutomationArmed(true)
                    Toast.makeText(this@MainActivity, "Mining started", Toast.LENGTH_SHORT).show()
                }
                is MiningStartResult.InvalidConfig ->
                    Toast.makeText(this@MainActivity, result.message, Toast.LENGTH_LONG).show()
            }
        }
    }

    companion object {
        const val EXTRA_QUICK_ACTION = "quick_action"
        const val EXTRA_QUICK_AUTH_TOKEN = "quick_auth_token"
    }
}
