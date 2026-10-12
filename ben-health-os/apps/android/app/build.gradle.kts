import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.room)
}

// Shared configuration (freshness thresholds, source priority, metric catalog) is owned by
// packages/shared-config at the monorepo root. It is copied into generated assets at build time so
// the Android app never carries a drifting hand-maintained copy.
val sharedConfigDir = rootProject.layout.projectDirectory.dir("../../packages/shared-config/config")
val generatedSharedConfigAssets = layout.buildDirectory.dir("generated/sharedConfigAssets")
val demoFixtureDir = rootProject.layout.projectDirectory.dir("../../fixtures/demo")
val copySharedConfig by tasks.registering(Copy::class) {
    from(sharedConfigDir) {
        include("*.json")
        into("shared-config")
    }
    from(demoFixtureDir) {
        include("health-connect-demo.json")
        into("demo")
    }
    into(generatedSharedConfigAssets)
}

android {
    namespace = "com.benhealthos.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.benhealthos.app"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        val apiBaseUrl = (project.findProperty("bho.apiBaseUrl") as String?) ?: "http://10.0.2.2:8787"
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    // Release signing comes from ~/.gradle/gradle.properties (never from the repository):
    // BHO_KEYSTORE=/path/to/keystore.jks, BHO_KEYSTORE_PASSWORD, BHO_KEY_ALIAS, BHO_KEY_PASSWORD.
    // Without them the release build is unsigned (fine for local verification, not for Play).
    val keystorePath = project.findProperty("BHO_KEYSTORE") as String?
    if (keystorePath != null) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = project.findProperty("BHO_KEYSTORE_PASSWORD") as String?
                keyAlias = project.findProperty("BHO_KEY_ALIAS") as String?
                keyPassword = project.findProperty("BHO_KEY_PASSWORD") as String?
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "META-INF/versions/9/OSGI-INF/MANIFEST.MF")
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(generatedSharedConfigAssets)
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        freeCompilerArgs.add("-opt-in=kotlin.RequiresOptIn")
    }
}

room {
    schemaDirectory("$projectDir/schemas")
}

tasks.named("preBuild") { dependsOn(copySharedConfig) }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.health.connect.client)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
