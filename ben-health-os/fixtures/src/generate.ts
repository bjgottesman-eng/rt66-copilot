import type { HealthConnectIngestBatch, HealthConnectRecord, ManualBloodPressureInput } from '@bho/contracts';
import { addDays, dayStartMs, formatOffset, offsetMinutes, parseOffset } from '@bho/analytics';
import { Prng } from './prng.js';

export const ORIGINS = {
  oura: 'com.ouraring.oura',
  samsung: 'com.sec.android.app.shealth',
  withings: 'com.withings.wiscale2',
  stelo: 'com.dexcom.stelo',
  cronometer: 'com.cronometer.android.gold',
} as const;

export interface DemoOptions {
  seed?: number;
  /** Number of days ending on endDate (inclusive). */
  days?: number;
  /** Local calendar date of the last day (YYYY-MM-DD). */
  endDate?: string;
  timeZone?: string;
  deviceInstanceId?: string;
  /** Days (from the end) with hourly step intervals and heart-rate samples; older days get one daily record. */
  detailedDays?: number;
  /** Days (from the end) with 15-minute glucose samples. */
  glucoseDays?: number;
}

export interface DemoDataset {
  options: Required<DemoOptions>;
  batches: HealthConnectIngestBatch[];
  manualBloodPressure: ManualBloodPressureInput[];
  summary: Record<string, number>;
  /** Scenario notes describing deliberate patterns (for the demo UI and tests). */
  scenario: string[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const nn = (v: number) => Math.max(0, Math.round(v));

export function generateDemoDataset(opts: DemoOptions = {}): DemoDataset {
  const options: Required<DemoOptions> = {
    seed: opts.seed ?? 20261012,
    days: opts.days ?? 120,
    endDate: opts.endDate ?? '2026-10-11',
    timeZone: opts.timeZone ?? 'America/New_York',
    deviceInstanceId: opts.deviceInstanceId ?? 'demo-device-0001',
    detailedDays: opts.detailedDays ?? 45,
    glucoseDays: opts.glucoseDays ?? 14,
  };
  const rng = new Prng(options.seed);
  const tz = options.timeZone;
  const records: HealthConnectRecord[] = [];
  const manualBloodPressure: ManualBloodPressureInput[] = [];
  const summary: Record<string, number> = {};
  const bump = (k: string, n = 1) => (summary[k] = (summary[k] ?? 0) + n);
  const startDate = addDays(options.endDate, -(options.days - 1));

  // Scenario anchors (day indices from start)
  const illnessStart = Math.floor(options.days * 0.33);
  const illnessEnd = illnessStart + 3;
  const ringOffStart = Math.floor(options.days * 0.5);
  const ringOffEnd = ringOffStart + 3;
  const trainingBlockStart = options.days - 21; // more Zone 2 in the last three weeks
  const scenario = [
    `Illness-like episode on days ${illnessStart}-${illnessEnd}: resting HR +7 bpm, HRV -30%, respiratory rate +1.5, sleep efficiency down.`,
    `Oura ring not worn on days ${ringOffStart}-${ringOffEnd}: no sleep/RHR/HRV records (missing, not zero).`,
    `Zone 2 training block in the final 21 days: cardio minutes up, resting HR drifts down ~2 bpm.`,
    'Samsung Health and Oura both report steps and some sleep sessions (cross-source overlap to deduplicate).',
    'Withings cuff takes two readings 60-120 s apart most mornings (session averaging).',
    'Stelo glucose covers only the final 14 days with a 2-day sensor gap.',
    'One implausible manual weight entry (typo) and one future-dated glucose sample exercise quality flags.',
  ];

  const hcMeta = (origin: string, idx: string, method: HealthConnectRecord['recordingMethod'], device: HealthConnectRecord['device'], modifiedMs: number) => ({
    hcId: `demo-${origin.split('.').pop()}-${idx}`,
    dataOrigin: origin,
    lastModifiedTime: iso(modifiedMs),
    recordingMethod: method,
    device,
    clientRecordId: null,
    clientRecordVersion: null,
  });
  const ouraDevice = { type: 'RING', manufacturer: 'Oura', model: 'Oura Ring Gen3' };
  const phoneDevice = { type: 'PHONE', manufacturer: 'Samsung', model: 'SM-S951U' };
  const cuffDevice = { type: 'UNKNOWN', manufacturer: 'Withings', model: 'BPM Connect' };
  const scaleDevice = { type: 'SCALE', manufacturer: 'Withings', model: 'Body+' };
  const cgmDevice = { type: 'UNKNOWN', manufacturer: 'Dexcom', model: 'Stelo' };

  const instant = (ms: number) => ({ time: iso(ms), zoneOffset: formatOffset(offsetMinutes(ms, tz)) });
  const interval = (startMs: number, endMs: number) => ({
    startTime: iso(startMs),
    startZoneOffset: formatOffset(offsetMinutes(startMs, tz)),
    endTime: iso(endMs),
    endZoneOffset: formatOffset(offsetMinutes(endMs, tz)),
  });

  let weight = 83.4;
  for (let d = 0; d < options.days; d++) {
    const date = addDays(startDate, d);
    const day0 = dayStartMs(date, tz);
    const dow = new Date(day0 + 12 * 3_600_000).getUTCDay(); // 0 Sunday
    const weekend = dow === 0 || dow === 6;
    const ill = d >= illnessStart && d <= illnessEnd;
    const ringOff = d >= ringOffStart && d <= ringOffEnd;
    const detailed = d >= options.days - options.detailedDays;
    const trainingBlock = d >= trainingBlockStart;
    const syncMs = day0 + 23 * 3_600_000; // records "modified" at end of day

    // ---- Sleep (previous night, ends this morning) — Oura canonical, Samsung overlap ~30% of nights
    if (!ringOff) {
      const bedtimeMin = 23 * 60 + 15 + rng.gauss(0, 40) + (weekend ? 35 : 0);
      const durationMin = Math.max(300, 430 + rng.gauss(0, 45) - (ill ? 40 : 0));
      const start = day0 - 24 * 3_600_000 + bedtimeMin * 60_000;
      const end = start + durationMin * 60_000 + (ill ? 30 : 15) * 60_000; // time in bed slightly longer
      const stages: Array<{ startTime: string; endTime: string; stage: number }> = [];
      let cursor = start;
      // 24 segments (~20 min each): light/deep/REM cycles with 1–4 awake segments so efficiency varies night to night.
      const pattern = [1, 4, 5, 5, 4, 6, 4, 5, 4, 6, 4, 4, 5, 4, 6, 6, 4, 4, 6, 4, 4, 6, 4, 1];
      const awakeExtra = rng.int(0, 3) + (ill ? 2 : 0);
      for (let k = 0; k < awakeExtra; k++) pattern[rng.int(2, pattern.length - 3)] = 1;
      const seg = (end - start) / pattern.length;
      for (const st of pattern) {
        stages.push({ startTime: iso(cursor), endTime: iso(cursor + seg), stage: st });
        cursor += seg;
      }
      records.push({
        recordType: 'SleepSession',
        ...hcMeta(ORIGINS.oura, `sleep-${date}`, 'AUTOMATICALLY_RECORDED', ouraDevice, end + 3_600_000),
        ...interval(start, end),
        payload: { title: null, notes: null, stages },
      } as HealthConnectRecord);
      bump('sleep_oura');
      if (rng.chance(0.3)) {
        const s2 = start + rng.int(-10, 10) * 60_000;
        const e2 = end + rng.int(-10, 10) * 60_000;
        records.push({
          recordType: 'SleepSession',
          ...hcMeta(ORIGINS.samsung, `sleep-${date}`, 'AUTOMATICALLY_RECORDED', phoneDevice, e2 + 3_600_000),
          ...interval(s2, e2),
          payload: { title: 'Sleep', notes: null, stages: [] },
        } as HealthConnectRecord);
        bump('sleep_samsung_overlap');
      }
      // Recovery metrics (Oura): RHR, HRV, respiratory rate, SpO2 — timestamped at wake
      const rhr = Math.round(54 + rng.gauss(0, 2.2) + (ill ? 7 : 0) - (trainingBlock ? ((d - trainingBlockStart) / 21) * 2 : 0));
      const hrv = Math.max(12, Math.round(42 + rng.gauss(0, 8) - (ill ? 13 : 0) + (trainingBlock ? 3 : 0)));
      records.push({ recordType: 'RestingHeartRate', ...hcMeta(ORIGINS.oura, `rhr-${date}`, 'AUTOMATICALLY_RECORDED', ouraDevice, end + 3_600_000), ...instant(end), payload: { bpm: rhr } } as HealthConnectRecord);
      records.push({ recordType: 'HeartRateVariabilityRmssd', ...hcMeta(ORIGINS.oura, `hrv-${date}`, 'AUTOMATICALLY_RECORDED', ouraDevice, end + 3_600_000), ...instant(end), payload: { rmssdMs: hrv } } as HealthConnectRecord);
      records.push({ recordType: 'RespiratoryRate', ...hcMeta(ORIGINS.oura, `rr-${date}`, 'AUTOMATICALLY_RECORDED', ouraDevice, end + 3_600_000), ...instant(end), payload: { rate: Number((14.4 + rng.gauss(0, 0.5) + (ill ? 1.5 : 0)).toFixed(1)) } } as HealthConnectRecord);
      records.push({ recordType: 'OxygenSaturation', ...hcMeta(ORIGINS.oura, `spo2-${date}`, 'AUTOMATICALLY_RECORDED', ouraDevice, end + 3_600_000), ...instant(end), payload: { percentage: Number((96.6 + rng.gauss(0, 0.7) - (ill ? 1 : 0)).toFixed(1)) } } as HealthConnectRecord);
      bump('recovery_oura', 4);
    }

    // ---- Steps: Samsung (phone) and Oura (ring) both report; never to be summed
    const dailyTarget = Math.max(1500, 8500 + rng.gauss(0, 2400) + (weekend ? 1500 : 0) - (ill ? 4500 : 0));
    const weights = Array.from({ length: 16 }, (_, h) => (h >= 1 && h <= 3 ? 1.6 : h >= 10 && h <= 12 ? 1.4 : 0.8) * (0.6 + rng.next()));
    const wsum = weights.reduce((a, b) => a + b, 0);
    if (detailed) {
      for (let h = 0; h < 16; h++) {
        const s = day0 + (7 + h) * 3_600_000;
        const e = s + 3_600_000;
        const samsungSteps = Math.round((dailyTarget * weights[h]!) / wsum);
        if (samsungSteps > 0) {
          records.push({ recordType: 'Steps', ...hcMeta(ORIGINS.samsung, `steps-${date}-${h}`, 'AUTOMATICALLY_RECORDED', phoneDevice, syncMs), ...interval(s, e), payload: { count: samsungSteps } } as HealthConnectRecord);
          bump('steps_samsung');
        }
        if (!ringOff) {
          const ouraSteps = Math.round(samsungSteps * (0.9 + rng.next() * 0.08));
          if (ouraSteps > 0) {
            records.push({ recordType: 'Steps', ...hcMeta(ORIGINS.oura, `steps-${date}-${h}`, 'AUTOMATICALLY_RECORDED', ouraDevice, syncMs), ...interval(s, e), payload: { count: ouraSteps } } as HealthConnectRecord);
            bump('steps_oura');
          }
        }
        // heart-rate samples (Oura) — a few per hour in the detailed window
        if (!ringOff && d >= options.days - 14) {
          const samples = Array.from({ length: 4 }, (_, i) => ({ time: iso(s + i * 15 * 60_000), bpm: Math.round(62 + rng.gauss(0, 9) + (h >= 1 && h <= 2 ? 25 : 0)) }));
          records.push({ recordType: 'HeartRate', ...hcMeta(ORIGINS.oura, `hr-${date}-${h}`, 'AUTOMATICALLY_RECORDED', ouraDevice, syncMs), ...interval(s, e), payload: { samples } } as HealthConnectRecord);
          bump('heart_rate_oura');
        }
      }
    } else {
      const s = day0 + 7 * 3_600_000;
      const e = day0 + 23 * 3_600_000;
      records.push({ recordType: 'Steps', ...hcMeta(ORIGINS.samsung, `steps-${date}`, 'AUTOMATICALLY_RECORDED', phoneDevice, syncMs), ...interval(s, e), payload: { count: Math.round(dailyTarget) } } as HealthConnectRecord);
      bump('steps_samsung');
      if (!ringOff) {
        records.push({ recordType: 'Steps', ...hcMeta(ORIGINS.oura, `steps-${date}`, 'AUTOMATICALLY_RECORDED', ouraDevice, syncMs), ...interval(s, e), payload: { count: Math.round(dailyTarget * 0.94) } } as HealthConnectRecord);
        bump('steps_oura');
      }
    }
    records.push({ recordType: 'Distance', ...hcMeta(ORIGINS.samsung, `dist-${date}`, 'AUTOMATICALLY_RECORDED', phoneDevice, syncMs), ...interval(day0 + 7 * 3_600_000, day0 + 23 * 3_600_000), payload: { meters: Math.round(dailyTarget * 0.74) } } as HealthConnectRecord);
    bump('distance_samsung');

    // ---- Workouts (Samsung Health): resistance Mon/Wed/Fri, Zone 2 Tue/Thu (+Sat in training block)
    if (!ill) {
      if ([1, 3, 5].includes(dow)) {
        const s = day0 + 17.5 * 3_600_000 + rng.int(-20, 20) * 60_000;
        const e = s + (45 + rng.int(-5, 10)) * 60_000;
        records.push({ recordType: 'ExerciseSession', ...hcMeta(ORIGINS.samsung, `workout-${date}`, 'ACTIVELY_RECORDED', phoneDevice, e + 600_000), ...interval(s, e), payload: { exerciseType: 70, exerciseTypeName: 'STRENGTH_TRAINING', title: 'Strength', notes: null } } as HealthConnectRecord);
        bump('workouts_resistance');
      }
      if ([2, 4].includes(dow) || (trainingBlock && dow === 6)) {
        const s = day0 + 7.25 * 3_600_000 + rng.int(-10, 10) * 60_000;
        const e = s + (trainingBlock ? 50 : 38) * 60_000 + rng.int(-5, 5) * 60_000;
        records.push({ recordType: 'ExerciseSession', ...hcMeta(ORIGINS.samsung, `cardio-${date}`, 'ACTIVELY_RECORDED', phoneDevice, e + 600_000), ...interval(s, e), payload: { exerciseType: 56, exerciseTypeName: 'RUNNING', title: 'Zone 2 run', notes: null } } as HealthConnectRecord);
        bump('workouts_cardio');
        if (!ringOff && rng.chance(0.5)) {
          // Oura auto-detected the same run (overlap)
          records.push({ recordType: 'ExerciseSession', ...hcMeta(ORIGINS.oura, `cardio-${date}`, 'AUTOMATICALLY_RECORDED', ouraDevice, e + 3_600_000), ...interval(s + 120_000, e - 60_000), payload: { exerciseType: 56, exerciseTypeName: 'RUNNING', title: null, notes: null } } as HealthConnectRecord);
          bump('workouts_oura_overlap');
        }
      }
      records.push({ recordType: 'ActiveCaloriesBurned', ...hcMeta(ORIGINS.samsung, `active-${date}`, 'AUTOMATICALLY_RECORDED', phoneDevice, syncMs), ...interval(day0, day0 + 24 * 3_600_000 - 1), payload: { kcal: Math.round(350 + dailyTarget * 0.03 + rng.gauss(0, 60)) } } as HealthConnectRecord);
      bump('active_calories');
    }

    // ---- Blood pressure (Withings cuff via Health Connect): most mornings, two readings 60-120 s apart
    if (rng.chance(0.82)) {
      const t1 = day0 + 7 * 3_600_000 + rng.int(0, 40) * 60_000;
      const base = { sys: 121 + rng.gauss(0, 6) + (ill ? 4 : 0) - (trainingBlock ? 2 : 0), dia: 78 + rng.gauss(0, 4), pulse: 60 + rng.gauss(0, 4) + (ill ? 6 : 0) };
      for (let i = 0; i < 2; i++) {
        const t = t1 + i * rng.int(60, 120) * 1000;
        records.push({ recordType: 'BloodPressure', ...hcMeta(ORIGINS.withings, `bp-${date}-${i}`, 'AUTOMATICALLY_RECORDED', cuffDevice, t + 300_000), ...instant(t), payload: { systolicMmHg: Math.round(base.sys + rng.gauss(0, 2) - i * 2), diastolicMmHg: Math.round(base.dia + rng.gauss(0, 1.5) - i), bodyPosition: 2, measurementLocation: 1 } } as HealthConnectRecord);
        records.push({ recordType: 'HeartRate', ...hcMeta(ORIGINS.withings, `bp-pulse-${date}-${i}`, 'AUTOMATICALLY_RECORDED', cuffDevice, t + 300_000), ...interval(t, t + 1000), payload: { samples: [{ time: iso(t), bpm: Math.round(base.pulse) }] } } as HealthConnectRecord);
        bump('bp_withings');
      }
    }
    // Weekend evening manual BP entry (optional workflow)
    if (weekend && rng.chance(0.5)) {
      const t = day0 + 20.5 * 3_600_000;
      manualBloodPressure.push({ systolic: Math.round(124 + rng.gauss(0, 5)), diastolic: Math.round(80 + rng.gauss(0, 3)), pulse: Math.round(64 + rng.gauss(0, 4)), measuredAt: iso(t), arm: 'LEFT', posture: 'SEATED', seatedRestMinutes: 5, notes: 'evening check', sessionId: null, clientEntryId: `demo-manual-bp-${date}` });
      bump('bp_manual');
    }

    // ---- Weight / body fat (Withings scale) most mornings; slow downward drift
    weight += -0.025 + rng.gauss(0, 0.05);
    if (rng.chance(0.85)) {
      const t = day0 + 6.75 * 3_600_000 + rng.int(0, 30) * 60_000;
      records.push({ recordType: 'Weight', ...hcMeta(ORIGINS.withings, `weight-${date}`, 'AUTOMATICALLY_RECORDED', scaleDevice, t + 300_000), ...instant(t), payload: { kg: Number((weight + rng.gauss(0, 0.35)).toFixed(2)) } } as HealthConnectRecord);
      records.push({ recordType: 'BodyFat', ...hcMeta(ORIGINS.withings, `bodyfat-${date}`, 'AUTOMATICALLY_RECORDED', scaleDevice, t + 300_000), ...instant(t), payload: { percentage: Number((21.5 - (weight < 82 ? 0.4 : 0) + rng.gauss(0, 0.6)).toFixed(1)) } } as HealthConnectRecord);
      bump('weight_withings', 2);
    }

    // ---- Nutrition (Cronometer): 3-4 meals per day
    const meals: Array<[number, string, number]> = [[7.75, 'Breakfast', 0.25], [12.75, 'Lunch', 0.33], [19.25, 'Dinner', 0.35]];
    if (rng.chance(0.5)) meals.push([16, 'Snack', 0.07]);
    const dayKcal = Math.max(900, 2300 + rng.gauss(0, 280) - (ill ? 350 : 0));
    const dayProtein = Math.max(40, 150 + rng.gauss(0, 22));
    const dayFiber = Math.max(8, 30 + rng.gauss(0, 8));
    for (const [hour, name, share] of meals) {
      const s = day0 + hour * 3_600_000;
      const kcal = dayKcal * share;
      records.push({
        recordType: 'Nutrition',
        ...hcMeta(ORIGINS.cronometer, `meal-${date}-${name}`, 'MANUAL_ENTRY', null, s + 1_800_000),
        ...interval(s, s + 1_200_000),
        payload: {
          name,
          mealType: name === 'Breakfast' ? 1 : name === 'Lunch' ? 2 : name === 'Dinner' ? 3 : 4,
          energyKcal: nn(kcal),
          proteinG: nn(dayProtein * share),
          carbsG: nn((kcal * 0.42) / 4),
          totalFatG: nn((kcal * 0.32) / 9),
          saturatedFatG: nn((kcal * 0.09) / 9),
          fiberG: nn(dayFiber * share),
          sodiumMg: nn(2600 * share + rng.gauss(0, 150)),
          potassiumMg: nn(3300 * share + rng.gauss(0, 150)),
          sugarG: nn((kcal * 0.1) / 4),
        },
      } as HealthConnectRecord);
      bump('meals_cronometer');
    }

    // ---- Glucose (Stelo via Health Connect): last N days, 15-minute samples, 3-hour source delay, 2-day gap
    const glucoseDay = d >= options.days - options.glucoseDays;
    const gap = d === options.days - 6 || d === options.days - 5;
    if (glucoseDay && !gap) {
      for (let q = 0; q < 96; q++) {
        const t = day0 + q * 15 * 60_000;
        const hour = q / 4;
        let g = 94 + rng.gauss(0, 3.5);
        for (const [mealHour, , share] of meals) {
          const dt = hour - mealHour;
          if (dt > 0 && dt < 3) g += (35 + share * 60) * Math.exp(-((dt - 0.75) ** 2) / 0.35);
        }
        if (hour >= 1 && hour < 6) g -= 4; // overnight trough
        records.push({ recordType: 'BloodGlucose', ...hcMeta(ORIGINS.stelo, `glucose-${date}-${q}`, 'AUTOMATICALLY_RECORDED', cgmDevice, t + 3 * 3_600_000), ...instant(t), payload: { mgPerDl: Math.round(g), specimenSource: 2, relationToMeal: 0 } } as HealthConnectRecord);
        bump('glucose_stelo');
      }
    }
  }

  // ---- Deliberate quality problems
  const typoMs = dayStartMs(addDays(options.endDate, -10), tz) + 7 * 3_600_000;
  records.push({ recordType: 'Weight', ...hcMeta('com.benhealthos.app', 'manual-weight-typo', 'MANUAL_ENTRY', null, typoMs), ...instant(typoMs), payload: { kg: 8.2 } } as HealthConnectRecord);
  bump('implausible_values');
  const futureMs = dayStartMs(options.endDate, tz) + 36 * 3_600_000;
  records.push({ recordType: 'BloodGlucose', ...hcMeta(ORIGINS.stelo, 'glucose-future', 'AUTOMATICALLY_RECORDED', cgmDevice, futureMs), ...instant(futureMs), payload: { mgPerDl: 101, specimenSource: 2, relationToMeal: 0 } } as HealthConnectRecord);
  bump('future_timestamp');

  // ---- Split into ingest batches (contract allows <= 2000 records per batch)
  const batches: HealthConnectIngestBatch[] = [];
  const clientTime = iso(dayStartMs(options.endDate, tz) + 22 * 3_600_000);
  for (let i = 0; i < records.length; i += 1500) {
    batches.push({
      source: 'health_connect',
      deviceInstanceId: options.deviceInstanceId,
      deviceLabel: 'Demo Galaxy S26 Ultra',
      appVersion: '0.1.0-demo',
      timeZone: tz,
      clientTime,
      mode: 'DEMO',
      records: records.slice(i, i + 1500),
      deletions: [],
      permissions: [],
    });
  }
  summary.total_records = records.length;
  summary.batches = batches.length;
  return { options, batches, manualBloodPressure, summary, scenario };
}

const CSV_FOODS: Record<string, Array<[string, string]>> = {
  Breakfast: [['Oats', '80 g'], ['Greek yogurt', '170 g'], ['Blueberries', '100 g']],
  Lunch: [['Chicken breast', '180 g'], ['Rice', '150 g'], ['Mixed salad', '1 bowl']],
  Dinner: [['Salmon', '200 g'], ['Potatoes', '250 g'], ['Broccoli', '150 g']],
  Snack: [['Almonds', '30 g'], ['Apple', '1 medium']],
};

/**
 * A Cronometer-style servings export describing the same synthetic diary as the Health Connect
 * Nutrition records (origin com.cronometer.android.gold), so the CSV import exercises same-day dedup.
 * Totals per meal are split across foods and rounded, as a real export would be.
 */
export function generateCronometerCsv(ds: DemoDataset): string {
  const header = ['Day', 'Time', 'Group', 'Food Name', 'Amount', 'Energy (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Saturated (g)', 'Fiber (g)', 'Sodium (mg)', 'Potassium (mg)', 'Sugars (g)', 'Vitamin C (mg)'];
  const lines = [header.join(',')];
  const r1 = (v: number | null | undefined) => (v == null ? '' : (Math.round(v * 10) / 10).toString());
  for (const batch of ds.batches) {
    for (const r of batch.records) {
      if (r.recordType !== 'Nutrition' || r.dataOrigin !== ORIGINS.cronometer || !r.startTime) continue;
      const p = r.payload as { name?: string | null; energyKcal?: number | null; proteinG?: number | null; carbsG?: number | null; totalFatG?: number | null; saturatedFatG?: number | null; fiberG?: number | null; sodiumMg?: number | null; potassiumMg?: number | null; sugarG?: number | null };
      const localMs = Date.parse(r.startTime) + (parseOffset(r.startZoneOffset ?? 'Z') ?? 0) * 60_000;
      const local = new Date(localMs).toISOString();
      const day = local.slice(0, 10);
      const time = local.slice(11, 16);
      const group = p.name ?? 'Meal';
      const items = CSV_FOODS[group] ?? [['Meal', '1 serving']];
      const shares = items.length === 3 ? [0.5, 0.3, 0.2] : items.length === 2 ? [0.7, 0.3] : [1];
      items.forEach(([food, amount], i) => {
        const sh = shares[i]!;
        const vitC = group === 'Breakfast' && i === 2 ? 10 : group === 'Dinner' && i === 2 ? 60 : 0;
        lines.push([day, time, group, food, amount, r1((p.energyKcal ?? 0) * sh), r1((p.proteinG ?? 0) * sh), r1((p.carbsG ?? 0) * sh), r1((p.totalFatG ?? 0) * sh), r1((p.saturatedFatG ?? 0) * sh), r1((p.fiberG ?? 0) * sh), r1((p.sodiumMg ?? 0) * sh), r1((p.potassiumMg ?? 0) * sh), r1((p.sugarG ?? 0) * sh), String(vitC)].join(','));
      });
    }
  }
  return lines.join('\n') + '\n';
}
