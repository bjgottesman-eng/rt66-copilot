package com.benhealthos.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.benhealthos.app.presentation.theme.BenHealthOsTheme

/** Shown by Health Connect when the user asks why the app wants access (same policy as the store listing). */
class PermissionsRationaleActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            BenHealthOsTheme {
                Scaffold { padding ->
                    Column(Modifier.fillMaxSize().padding(padding).padding(24.dp).verticalScroll(rememberScrollState())) {
                        Text(stringResource(R.string.privacy_policy_title), style = MaterialTheme.typography.headlineSmall)
                        Spacer(Modifier.height(16.dp))
                        Text(stringResource(R.string.privacy_policy_body), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}
