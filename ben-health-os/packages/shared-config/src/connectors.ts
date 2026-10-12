/**
 * Connector registry. Integration classes follow the master specification § 5 and are set from
 * verified official documentation (see docs/integrations.md). A connector is never shown as
 * connected until authentication AND data retrieval have actually succeeded.
 */
export const INTEGRATION_CLASSES = [
  'VERIFIED_DIRECT_API',
  'HEALTH_CONNECT',
  'CLINICAL_FHIR',
  'FILE_IMPORT',
  'MANUAL',
  'UNSUPPORTED',
] as const;
export type IntegrationClass = (typeof INTEGRATION_CLASSES)[number];

export const CONNECTOR_IDS = [
  'health_connect',
  'oura',
  'withings',
  'stelo',
  'cronometer',
  'function_health',
  'clinical_fhir',
  'file_import',
  'manual',
  'demo',
] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export interface ConnectorDefinition {
  id: ConnectorId;
  displayName: string;
  integrationClass: IntegrationClass;
  /** Typical interval between successful syncs when healthy; used for SOURCE_DELAYED vs STALE. */
  expectedSyncIntervalHours: number;
  /** Metric ids this connector can provide (metric catalog ids). */
  metrics: string[];
  /** Phase in which the connector becomes functional. */
  phase: number;
  /** Honest implementation status (spec §36); updated as verification progresses. */
  implementationStatus: ImplementationStatus;
  notes: string;
}

export const IMPLEMENTATION_STATUSES = [
  'IMPLEMENTED',
  'TESTED_WITH_MOCK_DATA',
  'TESTED_ON_PHYSICAL_DEVICE',
  'TESTED_AGAINST_LIVE_API',
  'BLOCKED_BY_CREDENTIALS',
  'NOT_IMPLEMENTED',
] as const;
export type ImplementationStatus = (typeof IMPLEMENTATION_STATUSES)[number];

export const CONNECTORS: ConnectorDefinition[] = [
  {
    id: 'health_connect',
    displayName: 'Google Health Connect',
    integrationClass: 'HEALTH_CONNECT',
    expectedSyncIntervalHours: 6,
    metrics: [
      'steps', 'distance_m', 'heart_rate', 'resting_heart_rate', 'hrv_rmssd', 'sleep_duration',
      'blood_pressure_systolic', 'blood_pressure_diastolic', 'pulse', 'weight', 'body_fat_pct',
      'blood_glucose', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg', 'potassium_mg',
      'exercise_minutes', 'resistance_sessions', 'zone2_minutes', 'respiratory_rate', 'spo2', 'vo2_max', 'active_calories', 'total_calories',
      'body_temperature', 'sleep_efficiency', 'glucose_variability', 'saturated_fat_g', 'hydration_l', 'height_m', 'lean_mass_kg',
    ],
    phase: 1,
    implementationStatus: 'TESTED_WITH_MOCK_DATA',
    notes: 'On-device read via the Android app; background reads are subject to Android restrictions.',
  },
  {
    id: 'oura',
    displayName: 'Oura',
    integrationClass: 'VERIFIED_DIRECT_API',
    expectedSyncIntervalHours: 8,
    metrics: [
      'sleep_duration', 'sleep_efficiency', 'sleep_score', 'readiness_score', 'activity_score', 'resting_heart_rate', 'hrv_rmssd',
      'respiratory_rate', 'spo2', 'skin_temperature_deviation', 'steps', 'active_calories', 'exercise_minutes',
      'stress_high_minutes', 'vo2_max', 'heart_rate', 'zone2_minutes',
    ],
    phase: 2,
    implementationStatus: 'TESTED_WITH_MOCK_DATA',
    notes: 'Oura API v2 (OAuth2 + webhooks). Original Oura scores are preserved and never recomputed.',
  },
  {
    id: 'withings',
    displayName: 'Withings',
    integrationClass: 'VERIFIED_DIRECT_API',
    expectedSyncIntervalHours: 24,
    metrics: ['blood_pressure_systolic', 'blood_pressure_diastolic', 'pulse', 'weight', 'body_fat_pct'],
    phase: 2,
    implementationStatus: 'TESTED_WITH_MOCK_DATA',
    notes: 'Withings Public API (OAuth2 + notify webhooks). Primary blood-pressure source.',
  },
  {
    id: 'stelo',
    displayName: 'Dexcom Stelo',
    integrationClass: 'HEALTH_CONNECT',
    expectedSyncIntervalHours: 3,
    metrics: ['blood_glucose', 'glucose_variability'],
    phase: 4,
    implementationStatus: 'NOT_IMPLEMENTED',
    notes: 'Glucose is read through Health Connect when the Stelo app shares it; otherwise structured import. Verified status lives in docs/integrations.md.',
  },
  {
    id: 'cronometer',
    displayName: 'Cronometer Gold',
    integrationClass: 'FILE_IMPORT',
    expectedSyncIntervalHours: 48,
    metrics: ['calories', 'protein_g', 'carbs_g', 'fat_g', 'saturated_fat_g', 'fiber_g', 'sodium_mg', 'potassium_mg'],
    phase: 4,
    implementationStatus: 'TESTED_WITH_MOCK_DATA',
    notes: 'CSV export import (daily summary or servings layout, header-mapped with review). When the Cronometer app also shares meals through Health Connect, the CSV is canonical for that day and the Health Connect meals are linked, never summed.',
  },
  {
    id: 'function_health',
    displayName: 'Function Health',
    integrationClass: 'FILE_IMPORT',
    expectedSyncIntervalHours: 2160,
    metrics: ['lab_result'],
    phase: 5,
    implementationStatus: 'TESTED_WITH_MOCK_DATA',
    notes: 'PDF (text layer, no OCR) and CSV imports on the Labs page: header/line mapping, canonical units with explicit factors, every row staged for review before it counts. Real Function PDFs are still UNVERIFIED until the first import is reviewed.',
  },
  {
    id: 'clinical_fhir',
    displayName: 'Clinical records (FHIR)',
    integrationClass: 'CLINICAL_FHIR',
    expectedSyncIntervalHours: 720,
    metrics: ['lab_result'],
    phase: 5,
    implementationStatus: 'TESTED_WITH_MOCK_DATA',
    notes: 'Epic patient access (Weill Cornell, NYU Langone) via SMART on FHIR standalone launch: laboratory results, conditions, medications, allergies, immunizations, visits. Needs an app registered at fhir.epic.com (EPIC_CLIENT_ID); tested against a mock FHIR server only.',
  },
  {
    id: 'file_import',
    displayName: 'File import',
    integrationClass: 'FILE_IMPORT',
    expectedSyncIntervalHours: 8760,
    metrics: [],
    phase: 5,
    implementationStatus: 'TESTED_WITH_MOCK_DATA',
    notes: 'Generic lab CSV/PDF imports (any laboratory) with review staging. Apple Health export and Google Fit takeout importers are NOT IMPLEMENTED.',
  },
  {
    id: 'manual',
    displayName: 'Manual entry',
    integrationClass: 'MANUAL',
    expectedSyncIntervalHours: 8760,
    metrics: ['blood_pressure_systolic', 'blood_pressure_diastolic', 'pulse', 'weight', 'body_fat_pct', 'waist_cm', 'lean_mass_kg'],
    phase: 1,
    implementationStatus: 'TESTED_WITH_MOCK_DATA',
    notes: 'Optional. The normal blood-pressure workflow is the Withings cuff, not manual entry.',
  },
  {
    id: 'demo',
    displayName: 'Synthetic demo data',
    integrationClass: 'MANUAL',
    expectedSyncIntervalHours: 24,
    metrics: [],
    phase: 1,
    implementationStatus: 'TESTED_WITH_MOCK_DATA',
    notes: 'Deterministic synthetic data for demo mode and tests. Never mixed with real sources.',
  },
];

export function connectorById(id: string): ConnectorDefinition | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

/**
 * Known Health Connect data origins (Android package names) mapped to friendly labels. Package names
 * marked verified:false were not confirmed against an official source and are treated as hints only.
 */
export const HEALTH_CONNECT_ORIGINS: Record<string, { label: string; connectorHint: ConnectorId | null; verified: boolean }> = {
  'com.ouraring.oura': { label: 'Oura', connectorHint: 'oura', verified: true },
  'com.withings.wiscale2': { label: 'Withings', connectorHint: 'withings', verified: true },
  'com.sec.android.app.shealth': { label: 'Samsung Health', connectorHint: null, verified: true },
  'com.google.android.apps.fitness': { label: 'Google Fit', connectorHint: null, verified: true },
  'com.google.android.apps.healthdata': { label: 'Health Connect', connectorHint: null, verified: true },
  'com.dexcom.stelo': { label: 'Dexcom Stelo', connectorHint: 'stelo', verified: false },
  'com.cronometer.android.gold': { label: 'Cronometer Gold', connectorHint: 'cronometer', verified: false },
  'com.benhealthos.app': { label: 'Ben Health OS', connectorHint: 'manual', verified: true },
  'com.benhealthos.app.debug': { label: 'Ben Health OS (debug)', connectorHint: 'manual', verified: true },
};
