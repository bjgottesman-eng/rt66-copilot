package com.benhealthos.app.security

import android.content.Context
import android.content.SharedPreferences

/** Session material encrypted with the Keystore before it touches disk. */
class SecureStore(context: Context, private val cipher: KeystoreCipher = KeystoreCipher()) {
    private val prefs: SharedPreferences = context.getSharedPreferences("bho_secure", Context.MODE_PRIVATE)

    val token: String?
        get() = read(KEY_TOKEN)
    val userId: String?
        get() = read(KEY_USER_ID)
    val email: String?
        get() = read(KEY_EMAIL)
    val hasSession: Boolean
        get() = token != null

    fun setSession(token: String, userId: String, email: String?) {
        prefs.edit()
            .putString(KEY_TOKEN, cipher.encrypt(token))
            .putString(KEY_USER_ID, cipher.encrypt(userId))
            .putString(KEY_EMAIL, email?.let { cipher.encrypt(it) })
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private fun read(key: String): String? {
        val blob = prefs.getString(key, null) ?: return null
        return runCatching { cipher.decrypt(blob) }.getOrElse {
            // Keystore key rotated or device restored: the session is unusable, force sign-in again.
            prefs.edit().remove(key).apply()
            null
        }
    }

    private companion object {
        const val KEY_TOKEN = "token"
        const val KEY_USER_ID = "user_id"
        const val KEY_EMAIL = "email"
    }
}
