# ADR 0003 — Android toolchain: AGP 8.13 / compileSdk 36 now, AGP 9 / compileSdk 37 later

Status: accepted (2026-10-12)

## Context
The target device runs Android 17 (platform `android-37.x`). On 2026-10-12 the newest AndroidX
releases (Compose 1.12, core 1.19, lifecycle 2.11, navigation 2.10) require AGP ≥ 9.1 and
compileSdk 37, while the locally available Gradle is 8.14.3. AGP 9 changes Kotlin integration
(built-in Kotlin) and was not verifiable in this environment within the Phase 1 budget.

## Decision
Pin Gradle 8.14.3, AGP 8.13.2, Kotlin 2.3.21, KSP 2.3.12, compileSdk/targetSdk 36, minSdk 28,
Compose BOM 2025.12.01, core-ktx 1.17.0, lifecycle 2.9.4, navigation 2.9.8, Room 2.8.5,
WorkManager 2.12.0, Health Connect 1.1.0 (latest stable), OkHttp 4.12.0. The app runs unchanged on
Android 17 devices.

## Consequences
- Phase 8 (production hardening) upgrades to AGP 9.x, Gradle 9.x and compileSdk 37 after verifying
  the built-in Kotlin migration on a device build.
- The version catalog (`gradle/libs.versions.toml`) is the single place to bump.
