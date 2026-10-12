import type { HealthConnectRecord, NormalizedObservation, NormalizedRecord, NormalizedWorkout } from '@bho/contracts';
import { categorizeExercise, localDateOf, plausibilityFlags, timestampFlags } from '@bho/analytics';

export type { NormalizedObservation, NormalizedBp, NormalizedSleep, NormalizedWorkout, NormalizedMeal, NormalizedGlucose, NormalizedRecord } from '@bho/contracts';

const SLEEP_STAGE_NAMES: Record<number, string> = { 0: 'UNKNOWN', 1: 'AWAKE', 2: 'SLEEPING', 3: 'OUT_OF_BED', 4: 'LIGHT', 5: 'DEEP', 6: 'REM', 7: 'AWAKE_IN_BED' };
const ASLEEP = new Set(['SLEEPING', 'LIGHT', 'DEEP', 'REM']);
const AWAKE = new Set(['AWAKE', 'AWAKE_IN_BED']);

/** Numeric fallback for Health Connect ExerciseSessionRecord types; the app sends names, which win. */
const EXERCISE_TYPE_NUMERIC: Record<number, string> = { 0: 'OTHER_WORKOUT', 8: 'BIKING', 13: 'CALISTHENICS', 37: 'HIKING', 56: 'RUNNING', 70: 'STRENGTH_TRAINING', 79: 'WALKING', 81: 'WEIGHTLIFTING' };

const MEAL_TYPES: Record<number, string> = { 0: 'UNKNOWN', 1: 'BREAKFAST', 2: 'LUNCH', 3: 'DINNER', 4: 'SNACK' };
const GLUCOSE_SPECIMEN: Record<number, string> = { 0: 'UNKNOWN', 1: 'INTERSTITIAL_FLUID', 2: 'CAPILLARY_BLOOD', 3: 'PLASMA', 4: 'SERUM', 5: 'TEARS', 6: 'WHOLE_BLOOD' };
const GLUCOSE_RELATION: Record<number, string> = { 0: 'UNKNOWN', 1: 'GENERAL', 2: 'FASTING', 3: 'BEFORE_MEAL', 4: 'AFTER_MEAL' };

function minutes(aIso: string, bIso: string): number {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / 60_000;
}

export function normalizeHealthConnectRecord(r: HealthConnectRecord, timeZone: string, nowIso: string): NormalizedRecord {
  const out: NormalizedRecord = { observations: [], notes: [] };
  const p = r.payload as Record<string, any>;
  const isInterval = r.startTime !== undefined && r.endTime !== undefined;
  const measuredAt = isInterval ? r.startTime! : r.time!;
  const zone = isInterval ? (r.startZoneOffset ?? null) : (r.zoneOffset ?? null);
  const localDate = localDateOf(measuredAt, zone, timeZone);
  const baseFlags = timestampFlags(measuredAt, nowIso, r.lastModifiedTime);
  const obs = (metricId: string, value: number, unit: string, extra: Partial<NormalizedObservation> = {}) => {
    out.observations.push({
      metricId,
      value,
      unit,
      measuredAt,
      startAt: isInterval ? r.startTime! : null,
      endAt: isInterval ? r.endTime! : null,
      localDate,
      zoneOffset: zone,
      externalId: r.hcId,
      qualityFlags: [...baseFlags, ...plausibilityFlags(metricId, value)],
      ...extra,
    });
  };

  switch (r.recordType) {
    case 'Steps':
      obs('steps', p.count, 'steps');
      break;
    case 'Distance':
      obs('distance_m', p.meters, 'm');
      break;
    case 'HeartRate': {
      (p.samples as Array<{ time: string; bpm: number }>).forEach((s, i) => {
        const ld = localDateOf(s.time, zone, timeZone);
        out.observations.push({ metricId: 'heart_rate', value: s.bpm, unit: 'bpm', measuredAt: s.time, startAt: null, endAt: null, localDate: ld, zoneOffset: zone, externalId: `${r.hcId}#${i}`, qualityFlags: [...timestampFlags(s.time, nowIso), ...plausibilityFlags('heart_rate', s.bpm)] });
      });
      break;
    }
    case 'RestingHeartRate':
      obs('resting_heart_rate', p.bpm, 'bpm');
      break;
    case 'HeartRateVariabilityRmssd':
      obs('hrv_rmssd', p.rmssdMs, 'ms');
      break;
    case 'RespiratoryRate':
      obs('respiratory_rate', p.rate, 'breaths/min');
      break;
    case 'OxygenSaturation':
      obs('spo2', p.percentage, '%');
      break;
    case 'Vo2Max':
      obs('vo2_max', p.mlPerKgPerMin, 'mL/kg/min');
      break;
    case 'Weight':
      obs('weight', p.kg, 'kg');
      break;
    case 'BodyFat':
      obs('body_fat_pct', p.percentage, '%');
      break;
    case 'LeanBodyMass':
      obs('lean_mass_kg', p.kg, 'kg');
      break;
    case 'Height':
      obs('height_m', p.meters, 'm');
      break;
    case 'ActiveCaloriesBurned':
      obs('active_calories', p.kcal, 'kcal');
      break;
    case 'TotalCaloriesBurned':
      obs('total_calories', p.kcal, 'kcal');
      break;
    case 'Hydration':
      obs('hydration_l', p.liters, 'L');
      break;
    case 'BodyTemperature':
      obs('body_temperature', p.celsius, '°C');
      break;
    case 'SkinTemperature':
      if (typeof p.deltaCelsius === 'number') obs('skin_temperature_deviation', p.deltaCelsius, '°C');
      else out.notes.push('SkinTemperature without deltaCelsius; raw retained only');
      break;
    case 'BloodPressure': {
      const flags = [...baseFlags, ...plausibilityFlags('blood_pressure_systolic', p.systolicMmHg), ...plausibilityFlags('blood_pressure_diastolic', p.diastolicMmHg)];
      if (p.diastolicMmHg >= p.systolicMmHg) flags.push('DIASTOLIC_NOT_BELOW_SYSTOLIC');
      out.bp = { externalId: r.hcId, measuredAt, localDate, zoneOffset: zone, systolic: p.systolicMmHg, diastolic: p.diastolicMmHg, bodyPosition: p.bodyPosition ?? null, measurementLocation: p.measurementLocation ?? null, qualityFlags: [...new Set(flags)] };
      obs('blood_pressure_systolic', p.systolicMmHg, 'mmHg');
      obs('blood_pressure_diastolic', p.diastolicMmHg, 'mmHg');
      break;
    }
    case 'BloodGlucose': {
      out.glucose = { externalId: r.hcId, measuredAt, localDate, mgDl: p.mgPerDl, specimenSource: p.specimenSource != null ? (GLUCOSE_SPECIMEN[p.specimenSource] ?? String(p.specimenSource)) : null, mealRelation: p.relationToMeal != null ? (GLUCOSE_RELATION[p.relationToMeal] ?? String(p.relationToMeal)) : null, qualityFlags: [...baseFlags, ...plausibilityFlags('blood_glucose', p.mgPerDl)] };
      obs('blood_glucose', p.mgPerDl, 'mg/dL');
      break;
    }
    case 'SleepSession': {
      const start = r.startTime!;
      const end = r.endTime!;
      const timeInBed = minutes(start, end);
      const stages = ((p.stages ?? []) as Array<{ startTime: string; endTime: string; stage: number }>).map((s) => ({ startAt: s.startTime, endAt: s.endTime, stage: SLEEP_STAGE_NAMES[s.stage] ?? 'UNKNOWN' }));
      const sum = (pred: (s: string) => boolean) => stages.filter((s) => pred(s.stage)).reduce((acc, s) => acc + minutes(s.startAt, s.endAt), 0);
      const flags = [...baseFlags];
      let durationMin: number;
      let efficiency: number | null = null;
      let deep: number | null = null;
      let light: number | null = null;
      let rem: number | null = null;
      let awake: number | null = null;
      if (stages.length > 0) {
        durationMin = sum((s) => ASLEEP.has(s));
        deep = sum((s) => s === 'DEEP');
        light = sum((s) => s === 'LIGHT');
        rem = sum((s) => s === 'REM');
        awake = sum((s) => AWAKE.has(s));
        efficiency = timeInBed > 0 ? (durationMin / timeInBed) * 100 : null;
        if (durationMin === 0) {
          durationMin = timeInBed;
          flags.push('STAGES_WITHOUT_SLEEP_TIME');
        }
      } else {
        durationMin = timeInBed;
        flags.push('NO_STAGES_DURATION_IS_TIME_IN_BED');
      }
      const nightOf = localDateOf(end, r.endZoneOffset ?? null, timeZone);
      out.sleep = { externalId: r.hcId, startAt: start, endAt: end, startZoneOffset: r.startZoneOffset ?? null, endZoneOffset: r.endZoneOffset ?? null, localDate: nightOf, durationMin, timeInBedMin: timeInBed, efficiency, deepMin: deep, lightMin: light, remMin: rem, awakeMin: awake, title: p.title ?? null, notes: p.notes ?? null, stages, qualityFlags: [...flags, ...plausibilityFlags('sleep_duration', durationMin)] };
      out.observations.push({ metricId: 'sleep_duration', value: durationMin, unit: 'min', measuredAt: end, startAt: start, endAt: end, localDate: nightOf, zoneOffset: r.endZoneOffset ?? null, externalId: r.hcId, qualityFlags: [...flags, ...plausibilityFlags('sleep_duration', durationMin)] });
      if (efficiency !== null) out.observations.push({ metricId: 'sleep_efficiency', value: efficiency, unit: '%', measuredAt: end, startAt: start, endAt: end, localDate: nightOf, zoneOffset: r.endZoneOffset ?? null, externalId: r.hcId, qualityFlags: [...flags] });
      break;
    }
    case 'ExerciseSession': {
      const start = r.startTime!;
      const end = r.endTime!;
      const durationMin = minutes(start, end);
      const flags = [...baseFlags];
      let name: string | null = p.exerciseTypeName ?? null;
      if (!name && typeof p.exerciseType === 'number') {
        name = EXERCISE_TYPE_NUMERIC[p.exerciseType] ?? null;
        if (name) flags.push('EXERCISE_TYPE_NUMERIC_FALLBACK');
      }
      const category = categorizeExercise(name);
      out.workout = { externalId: r.hcId, startAt: start, endAt: end, localDate, durationMin, exerciseType: p.exerciseType ?? null, exerciseTypeName: name, category, title: p.title ?? null, notes: p.notes ?? null, segments: p.segments ?? null, qualityFlags: [...flags, ...plausibilityFlags('exercise_minutes', durationMin)] };
      obs('exercise_minutes', durationMin, 'min');
      if (category === 'RESISTANCE') obs('resistance_sessions', 1, 'sessions');
      break;
    }
    case 'Nutrition': {
      const nutrients: Record<string, number> = {};
      for (const [k, v] of Object.entries(p.extraNutrients ?? {})) if (typeof v === 'number') nutrients[k] = v;
      out.meal = {
        externalId: r.hcId,
        eatenAt: measuredAt,
        endAt: isInterval ? r.endTime! : null,
        localDate,
        mealType: p.mealType != null ? (MEAL_TYPES[p.mealType] ?? String(p.mealType)) : null,
        name: p.name ?? null,
        energyKcal: p.energyKcal ?? null,
        proteinG: p.proteinG ?? null,
        carbsG: p.carbsG ?? null,
        fatG: p.totalFatG ?? null,
        saturatedFatG: p.saturatedFatG ?? null,
        fiberG: p.fiberG ?? null,
        sodiumMg: p.sodiumMg ?? null,
        potassiumMg: p.potassiumMg ?? null,
        sugarG: p.sugarG ?? null,
        nutrients,
      };
      const pairs: Array<[string, number | null | undefined, string]> = [
        ['calories', p.energyKcal, 'kcal'],
        ['protein_g', p.proteinG, 'g'],
        ['carbs_g', p.carbsG, 'g'],
        ['fat_g', p.totalFatG, 'g'],
        ['saturated_fat_g', p.saturatedFatG, 'g'],
        ['fiber_g', p.fiberG, 'g'],
        ['sodium_mg', p.sodiumMg, 'mg'],
        ['potassium_mg', p.potassiumMg, 'mg'],
      ];
      for (const [metricId, value, unit] of pairs) if (typeof value === 'number') obs(metricId, value, unit);
      break;
    }
    default:
      out.notes.push(`unsupported record type ${(r as HealthConnectRecord).recordType}`);
  }
  return out;
}
