plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.iml1s.xmrigminer.wear"
    compileSdk = 34

    defaultConfig {
        // Must match the phone applicationId for Wearable Data Layer routing.
        applicationId = "com.iml1s.xmrigminer"
        minSdk = 30
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            applicationIdSuffix = ".debug"
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
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.6"
    }
}

dependencies {
    implementation("androidx.wear.compose:compose-material:1.3.0")
    implementation("androidx.wear.compose:compose-foundation:1.3.0")
    implementation("androidx.wear:wear:1.3.0")

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.androidx.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)

    implementation(libs.play.services.wearable)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.7.3")
    implementation("com.google.guava:guava:32.1.3-android")
    implementation("androidx.wear.protolayout:protolayout:1.2.0")
    implementation("androidx.wear.protolayout:protolayout-material:1.2.0")

    implementation("androidx.wear.tiles:tiles:1.3.0")
    implementation("androidx.wear.tiles:tiles-material:1.3.0")

    implementation(libs.androidx.core.ktx)

    debugImplementation(libs.compose.ui.tooling)
}
