plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

fun configuredValue(name: String): String =
    providers.environmentVariable(name).orElse(providers.gradleProperty(name)).orNull?.trim().orEmpty()

fun quoted(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val ownerApiBase =
    configuredValue("OWNER_API_BASE")
        .trimEnd('/')
        .ifBlank { "https://catharsis-escape.sosirusok.chatgpt.site" }

require(ownerApiBase.startsWith("https://")) {
    "OWNER_API_BASE must use HTTPS."
}

android {
    namespace = "kr.co.catharsis.owner"
    compileSdk = 35

    val ciVersionCode = System.getenv("OWNER_VERSION_CODE")?.toIntOrNull() ?: 1

    defaultConfig {
        applicationId = "kr.co.catharsis.owner"
        minSdk = 26
        targetSdk = 35
        versionCode = ciVersionCode
        versionName = "1.0.$ciVersionCode"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE", quoted(ownerApiBase))
        buildConfigField("String", "FIREBASE_APP_ID", quoted(configuredValue("OWNER_FIREBASE_APP_ID")))
        buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(configuredValue("OWNER_FIREBASE_PROJECT_ID")))
        buildConfigField("String", "FIREBASE_SENDER_ID", quoted(configuredValue("OWNER_FIREBASE_SENDER_ID")))
        buildConfigField("String", "FIREBASE_API_KEY", quoted(configuredValue("OWNER_FIREBASE_API_KEY")))
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    val firebaseBom = platform("com.google.firebase:firebase-bom:34.17.0")

    implementation(composeBom)
    implementation(firebaseBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("com.google.firebase:firebase-installations")
    implementation("com.google.firebase:firebase-messaging")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
