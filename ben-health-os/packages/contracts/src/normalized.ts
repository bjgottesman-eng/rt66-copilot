/**
 * Connector-neutral normalized shapes. Every connector (Health Connect, Oura, Withings, imports)
 * maps its native payload into this structure; the API persists it with one pipeline so provenance,
 * deduplication and daily recomputation behave identically regardless of source.
 */
import type { RecordingMethod } from './enums.js';

export interface NormalizedObservation {
  metricId: string;
  value: number;
  unit: string;
  measuredAt: string;
  startAt: string | null;
  endAt: string | null;
  localDate: string;
  zoneOffset: string | null;
  externalId: string;
  qualityFlags: string[];
}

export interface NormalizedBp {
  externalId: string;
  measuredAt: string;
  localDate: string;
  zoneOffset: string | null;
  systolic: number;
  diastolic: number;
  pulse?: number | null;
  bodyPosition: number | null;
  measurementLocation: number | null;
  qualityFlags: string[];
}

export interface NormalizedSleep {
  externalId: string;
  startAt: string;
  endAt: string;
  startZoneOffset: string | null;
  endZoneOffset: string | null;
  localDate: string;
  durationMin: number;
  timeInBedMin: number;
  efficiency: number | null;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
  awakeMin: number | null;
  title: string | null;
  notes: string | null;
  stages: Array<{ startAt: string; endAt: string; stage: string }>;
  qualityFlags: string[];
}

export interface NormalizedWorkout {
  externalId: string;
  startAt: string;
  endAt: string;
  localDate: string;
  durationMin: number;
  exerciseType: number | null;
  exerciseTypeName: string | null;
  category: 'CARDIO' | 'RESISTANCE' | 'MOBILITY' | 'SPORT' | 'OTHER';
  title: string | null;
  notes: string | null;
  segments: unknown | null;
  caloriesKcal?: number | null;
  distanceM?: number | null;
  avgHeartRate?: number | null;
  qualityFlags: string[];
}

export interface NormalizedMeal {
  externalId: string;
  eatenAt: string;
  endAt: string | null;
  localDate: string;
  mealType: string | null;
  name: string | null;
  energyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  saturatedFatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  potassiumMg: number | null;
  sugarG: number | null;
  nutrients: Record<string, number>;
  foodItems?: unknown[];
  qualityFlags?: string[];
}

export interface NormalizedGlucose {
  externalId: string;
  measuredAt: string;
  localDate: string;
  mgDl: number;
  specimenSource: string | null;
  mealRelation: string | null;
  qualityFlags: string[];
}

export interface NormalizedRecord {
  observations: NormalizedObservation[];
  bp?: NormalizedBp;
  sleep?: NormalizedSleep;
  workout?: NormalizedWorkout;
  meal?: NormalizedMeal;
  glucose?: NormalizedGlucose;
  notes: string[];
}

export interface ExternalDeviceInput {
  externalId: string;
  label: string;
  manufacturer?: string | null;
  model?: string | null;
  type?: string | null;
}

/** One source record ready for persistence: raw payload + normalized rows + provenance. */
export interface ExternalRecordInput {
  externalId: string;
  recordType: string;
  dataOrigin: string | null;
  sourceUserId?: string | null;
  device?: ExternalDeviceInput | null;
  recordingMethod: RecordingMethod;
  sourceModifiedAt: string | null;
  originalTime: string;
  originalEndTime?: string | null;
  originalZoneOffset?: string | null;
  rawPayload: unknown;
  normalized: NormalizedRecord;
}
