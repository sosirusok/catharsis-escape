package kr.co.catharsis.owner.push

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import kr.co.catharsis.owner.BuildConfig

object FirebaseBootstrap {
    val isConfigured: Boolean
        get() =
            BuildConfig.FIREBASE_APP_ID.isNotBlank() &&
                BuildConfig.FIREBASE_PROJECT_ID.isNotBlank() &&
                BuildConfig.FIREBASE_SENDER_ID.isNotBlank() &&
                BuildConfig.FIREBASE_API_KEY.isNotBlank()

    fun initialize(context: Context): Boolean {
        if (!isConfigured) return false
        if (FirebaseApp.getApps(context).any { it.name == FirebaseApp.DEFAULT_APP_NAME }) return true
        val options =
            FirebaseOptions
                .Builder()
                .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .build()
        return FirebaseApp.initializeApp(context, options) != null
    }
}
