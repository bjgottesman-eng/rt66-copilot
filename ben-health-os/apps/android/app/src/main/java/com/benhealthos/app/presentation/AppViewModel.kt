package com.benhealthos.app.presentation

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.viewModelScope
import com.benhealthos.app.di.appContainer
import com.benhealthos.app.security.BiometricGate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.Instant

data class AppState(
    val loading: Boolean = true,
    val signedIn: Boolean = false,
    val onboardingDone: Boolean = false,
    val biometricEnabled: Boolean = true,
    val biometricAvailable: Boolean = false,
    val locked: Boolean = false,
)

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val container = app.appContainer
    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state
    private var backgroundedAt: Instant? = null

    init {
        viewModelScope.launch { refresh() }
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_STOP -> backgroundedAt = Instant.now()
                    Lifecycle.Event.ON_START -> {
                        val away = backgroundedAt
                        if (away != null && Instant.now().isAfter(away.plusSeconds(60))) lock()
                    }
                    else -> Unit
                }
            },
        )
    }

    suspend fun refresh() {
        val signedIn = container.secureStore.hasSession
        val onboardingDone = container.settings.onboardingDone.first()
        val biometricEnabled = container.settings.biometricLock.first()
        val available = BiometricGate.canAuthenticate(getApplication())
        _state.value = AppState(
            loading = false,
            signedIn = signedIn,
            onboardingDone = onboardingDone,
            biometricEnabled = biometricEnabled,
            biometricAvailable = available,
            locked = signedIn && onboardingDone && biometricEnabled && available,
        )
    }

    fun lock() {
        val s = _state.value
        if (s.signedIn && s.onboardingDone && s.biometricEnabled && s.biometricAvailable) _state.value = s.copy(locked = true)
    }

    fun unlock() {
        _state.value = _state.value.copy(locked = false)
    }

    fun signOut() {
        viewModelScope.launch {
            container.secureStore.clear()
            container.settings.setOnboardingDone(false)
            container.syncer.resetLocalState()
            refresh()
        }
    }

    fun completeOnboarding() {
        viewModelScope.launch {
            container.settings.setOnboardingDone(true)
            refresh()
            _state.value = _state.value.copy(locked = false)
        }
    }
}
