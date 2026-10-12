package com.benhealthos.app

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import com.benhealthos.app.presentation.AppRoot
import com.benhealthos.app.presentation.theme.BenHealthOsTheme

/** FragmentActivity (not plain ComponentActivity) because BiometricPrompt requires it. */
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BenHealthOsTheme { AppRoot(activity = this) }
        }
    }
}
