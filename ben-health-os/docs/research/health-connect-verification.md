# Health Connect (androidx.health.connect:connect-client) — verified 2026-10-12

Research notes gathered from official Android documentation on 2026-10-12. Items marked UNVERIFIED could not be confirmed against an official source and must not be treated as facts.

## 1. Getting started / dependency
- Guide: https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started — header says "compatible with Health Connect version 1.1.0-alpha12", but its Gradle snippet is `implementation "androidx.health.connect:connect-client:1.2.0-alpha06"`.
- Release notes (https://developer.android.com/jetpack/androidx/releases/health-connect): latest stable **1.1.0** (Oct 8, 2025, "no changes since" rc03); latest alpha **1.2.0-alpha06** (Aug 26, 2026). Confirmed by Google Maven metadata. 1.2.0-alpha05 set library minSdk to API 24.
- SDK supports Android 8 (API 26)+, but the HC app needs Android 9+; Android 14+ ships HC as a framework module, Android 13 and lower needs the Play Store app.

**Decision:** Ben Health OS uses the stable **1.1.0** client.

## 2. Record types (https://developer.android.com/health-and-fitness/guides/health-connect/plan/data-types)
StepsRecord, ExerciseSessionRecord, DistanceRecord, HeartRateRecord (series), RestingHeartRateRecord, HeartRateVariabilityRmssdRecord (`heartRateVariabilityMillis`), SleepSessionRecord, BloodPressureRecord, WeightRecord, BodyFatRecord, BloodGlucoseRecord, NutritionRecord (+HydrationRecord), RespiratoryRateRecord, OxygenSaturationRecord, BodyTemperatureRecord (+BasalBodyTemperatureRecord), SkinTemperatureRecord (gated by FEATURE_SKIN_TEMPERATURE), Vo2MaxRecord, ActiveCaloriesBurnedRecord, TotalCaloriesBurnedRecord.

Sleep stages: **no SleepStageRecord in 1.1.0**. Release notes: 1.1.0-alpha01 "Added various sleep stages into SleepSessionRecord and removed SleepStageRecord"; 1.1.0-alpha07 "Remove SleepStageRecord." Stages live in `SleepSessionRecord.stages: List<SleepSessionRecord.Stage>` with STAGE_TYPE_UNKNOWN/AWAKE/SLEEPING/OUT_OF_BED/LIGHT/DEEP/REM/AWAKE_IN_BED.

## 3. Permissions & manifest (get-started page)
- Format `android.permission.health.READ_<TYPE>` / `WRITE_<TYPE>`, e.g. `android.permission.health.READ_STEPS`; build via `HealthPermission.getReadPermission(StepsRecord::class)`; request with `PermissionController.createRequestPermissionResultContract()`; check `getGrantedPermissions` before every use.
- `<uses-permission android:name="android.permission.health.READ_STEPS"/>` (one per type).
- "through Android 13": `<activity android:name=".PermissionsRationaleActivity" android:exported="true">` with intent-filter action `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE`.
- "starting Android 14": `<activity-alias android:name="ViewPermissionUsageActivity" android:exported="true" android:targetActivity=".PermissionsRationaleActivity" android:permission="android.permission.START_VIEW_PERMISSION_USAGE">` with action `android.intent.action.VIEW_PERMISSION_USAGE` + category `android.intent.category.HEALTH_PERMISSIONS`.
- `<queries><package android:name="com.google.android.apps.healthdata" /></queries>` — the page says declare it "to get a client instance"; it does not restrict it to Android 13-and-below (that framing is UNVERIFIED).
- The rationale screen must show the same privacy policy as the Play Console listing.

## 4. Background reads
- `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND` (= `HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND`). Platform constant "Added in API level 35, Also in U Extensions 13". Jetpack: added 1.1.0-alpha09 "guarded by feature availability"; 1.1.0-alpha11 "Updated background and history read permissions to support Android 13 and below."
- Gate on `client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) == FEATURE_STATUS_AVAILABLE`; declare in manifest; request via the same contract. "An attempt to read data in background without this permission may result in an error."
- The read-data guide shows an hourly WorkManager `CoroutineWorker` example gated on the feature; the app must degrade gracefully if not granted.

## 5. History reads
- `android.permission.health.READ_HEALTH_DATA_HISTORY` (platform: API 35 / U Extensions 13; Jetpack 1.1.0-alpha10, Android ≤13 in alpha11); flag `FEATURE_READ_HEALTH_DATA_HISTORY`.
- Default: "all applications can read data ... for up to 30 days prior to when any permission was first granted." Android 14+: no limit on the app's own data, 30-day limit on others' data; Android ≤13: 30-day limit on any data. Reinstall resets the window.
- Without it, `readRecord` of a single older point "will result in an error"; other reads "will not return data points older than 30 days from before the first HealthConnect permission was granted"; applies to readRecord, readRecords, aggregate*, getChanges.

## 6. Changes API (sync-data guide; HealthConnectClient reference)
- `getChangesToken(ChangesTokenRequest(recordTypes = setOf(...)))`; recommended one token per type "to avoid having an Exception in case one of the permissions is revoked."
- "Changes-tokens are only valid for 30 days"; expired → `ChangesResponse.changesTokenExpired` → new token + re-sync. Loop `getChanges(token)` while `hasMore`, persist `nextChangesToken`.
- `UpsertionChange` (skip `metadata.dataOrigin.packageName == context.packageName` if you also write); `DeletionChange` "only contains the id of the deleted record, and not the record type, due to privacy" — store HC `id`s (or call getChanges per type).
- Expiry strategies, preferred first: re-read since last-read timestamp and dedupe (use clientRecordId); read since last timestamp; delete+re-read last 30 days; re-read without dedupe.
- 1.2.0-alpha03 adds `getChanges(token, pageSize)`.

## 7. Rate limits / foreground
- Rate limiting page: "fixed request rate quotas" — periodic + daily call limits for reads/changelogs, plus memory limits for inserts; "Background rate limiting is stricter than foreground"; **no numeric values published**. The read-data paging sample catches `IllegalStateException` as the quota error ("Backoff"); default pageSize 1000; prefer changelogs over raw reads.
- Reads: foreground normally (consider a foreground service), background only with §4 permission; WorkManager explicitly documented.

## 8. SDK status / Play link
`HealthConnectClient.getSdkStatus(context, providerPackageName)` → SDK_UNAVAILABLE=1 (hide integration), SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED=2 ("provider is either not installed or needs to be updated"), SDK_AVAILABLE=3. Reference sample: `"market://details?id=$providerPackageName&url=healthconnect%3A%2F%2Fonboarding"` in `Intent(ACTION_VIEW)` with `setPackage("com.android.vending")`, `putExtra("overlay", true)`, `putExtra("callerId", context.packageName)`; provider = `com.google.android.apps.healthdata`.

## 9. Metadata
Fields: id, dataOrigin (`.packageName`), lastModifiedTime, clientRecordId, clientRecordVersion, device, recordingMethod. 1.1.0-alpha12: "Make Metadata constructor internal", "Introduce Metadata factory methods", "Make recording method mandatory", "Make device type mandatory when creating Device objects". Factories: `manualEntry(device?)`, `manualEntry(clientRecordId, clientRecordVersion, device?)`, `manualEntryWithId(id, device?)`, `autoRecorded(device)`, `autoRecorded(device, clientRecordId, clientRecordVersion)`, `autoRecordedWithId(id, device)`, same trio for `activelyRecorded` and `unknownRecordingMethod`. RECORDING_METHOD_UNKNOWN=0, ACTIVELY_RECORDED=1, AUTOMATICALLY_RECORDED=2, MANUAL_ENTRY=3. `Device(type, manufacturer, model)`: TYPE_UNKNOWN/WATCH/PHONE/SCALE/RING/HEAD_MOUNTED/FITNESS_BAND/CHEST_STRAP/SMART_DISPLAY; extra types need FEATURE_EXTENDED_DEVICE_TYPES (1.2.0-alpha06) else become TYPE_UNKNOWN.

## 10. Play / privacy
- Request-access page: Data Safety + "Health apps declaration form" (App content) with per-data-type justification; "If your app does not require access to specific data types, you must not request access to them"; Play-listing policy "must be the same privacy policy that is displayed ... in Health Connect"; allow-listed per package name; undeclared apps get a "can't access Health Connect" dialog.
- Policy: https://support.google.com/googleplay/android-developer/answer/9888170 and https://support.google.com/googleplay/android-developer/answer/12991134 (approved uses include fitness/wellness/coaching and medical care; prohibited: ads, selling data, credit/insurance/employment decisions, headless apps). A "read-only requirement": UNVERIFIED — not present on either page.

## 11. Third-party writers to Health Connect
- **Oura — yes** (official): https://support.ouraring.com/hc/en-us/articles/10786105824531 — exports active calories, distance, exercise, steps, height, weight, sleep, heart rate, HRV (SpO2 not listed); two-way.
- **Withings — yes, writes** (official): https://support.withings.com/hc/en-us/articles/27322856325905-Partner-Apps-Health-Connect-Exporting-Withings-data-into-Health-Connect. Blood pressure specifically: UNVERIFIED (article doesn't enumerate types).
- **Dexcom Stelo — partial**: https://www.stelo.com/en-us/faqs/using-stelo/how-do-i-share-my-glucose-data-with-health-apps ("Settings > Connections"; "Stelo sends your glucose data to health apps with a 3-hour delay"; names "Apple Health or Google Health Connect"). Explicit Stelo→Health Connect glucose statement: UNVERIFIED; Dexcom's HC FAQ covers only G6.
- **Cronometer — yes** (official): https://support.cronometer.com/hc/en-us/articles/22731903751316-Health-Connect — exports Nutrition (Food, Water) + glucose, BP, body fat, HR, HRV, SpO2, weight, etc.
- **Samsung Health — yes** (official Samsung Developer): https://developer.samsung.com/health/blog/en/accessing-samsung-health-data-through-health-connect and https://developer.samsung.com/health/health-connect-faq.html — since v6.22.5 (Oct 2022), two-way; steps, exercise, HR, sleep/stages, glucose, SpO2, BP, nutrition, weight/body fat.

## 12. Medical records (FHIR)
- https://developer.android.com/health-and-fitness/guides/medical-records: in Jetpack from 1.1.0-beta02 (thus in 1.1.0) but marked `ExperimentalPersonalHealthRecordApi` ("still under development and subject to change"); requires compiling against the Android 16 SDK; "Play Policy for Medical Records access is still being developed"; no changelog API yet.
- Platform `MedicalResource`, `READ_MEDICAL_DATA_*`, `WRITE_MEDICAL_DATA`: "Added in API level 36 / U Extensions 16". Gate on `FEATURE_PERSONAL_HEALTH_RECORD`. 12 read permissions `android.permission.health.READ_MEDICAL_DATA_{ALLERGIES_INTOLERANCES, CONDITIONS, LABORATORY_RESULTS, MEDICATIONS, PERSONAL_DETAILS, PRACTITIONER_DETAILS, PREGNANCY, PROCEDURES, SOCIAL_HISTORY, VACCINES, VISITS, VITAL_SIGNS}` + `android.permission.health.WRITE_MEDICAL_DATA`. APIs: `readMedicalResources`, `getMedicalDataSources`, `upsertMedicalResources`, `deleteMedicalResources`.
