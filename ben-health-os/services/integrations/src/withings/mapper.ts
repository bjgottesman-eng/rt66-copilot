import type { ExternalRecordInput, NormalizedObservation, NormalizedRecord } from '@bho/contracts';
import { formatOffset, isValidTimeZone, localDateOf, offsetMinutes, plausibilityFlags } from '@bho/analytics';
import { WITHINGS_MEASTYPES, type WithingsMeasureGroup } from './client.js';

export interface WithingsMapContext {
  /** Body-level timezone from the getmeas response (e.g. America/New_York). */
  timezone: string;
  userTimeZone: string;
  sourceUserId: string | null;
}

export function realValue(m: { value: number; unit: number }): number {
  return m.value * 10 ** m.unit;
}

/** attrib: 0/5/7/8 device-captured; 1 device but ambiguous user; 2/4 manual; 15 guided. */
export function recordingMethodFor(attrib: number): { method: 'AUTOMATICALLY_RECORDED' | 'MANUAL_ENTRY' | 'UNKNOWN'; flags: string[] } {
  switch (attrib) {
    case 0:
    case 5:
    case 7:
    case 8:
    case 15:
      return { method: 'AUTOMATICALLY_RECORDED', flags: [] };
    case 1:
      return { method: 'AUTOMATICALLY_RECORDED', flags: ['AMBIGUOUS_USER'] };
    case 2:
    case 4:
      return { method: 'MANUAL_ENTRY', flags: attrib === 4 ? ['ENTERED_AT_USER_CREATION'] : [] };
    default:
      return { method: 'UNKNOWN', flags: [`WITHINGS_ATTRIB_${attrib}`] };
  }
}

const METRIC_FOR_TYPE: Record<number, { metricId: string; unit: string }> = {
  [WITHINGS_MEASTYPES.weight]: { metricId: 'weight', unit: 'kg' },
  [WITHINGS_MEASTYPES.height]: { metricId: 'height_m', unit: 'm' },
  [WITHINGS_MEASTYPES.fatFreeMass]: { metricId: 'lean_mass_kg', unit: 'kg' },
  [WITHINGS_MEASTYPES.fatRatio]: { metricId: 'body_fat_pct', unit: '%' },
  [WITHINGS_MEASTYPES.spo2]: { metricId: 'spo2', unit: '%' },
  [WITHINGS_MEASTYPES.bodyTemperature]: { metricId: 'body_temperature', unit: '°C' },
  [WITHINGS_MEASTYPES.vo2max]: { metricId: 'vo2_max', unit: 'mL/kg/min' },
};

/** Maps one measure group (one scale/cuff session) to one external record. */
export function mapWithingsGroup(g: WithingsMeasureGroup, ctx: WithingsMapContext): ExternalRecordInput | null {
  if (g.category !== 1) return null; // 2 = user objectives, never measurements
  const tz = isValidTimeZone(ctx.timezone) ? ctx.timezone : ctx.userTimeZone;
  const measuredMs = g.date * 1000;
  const measuredAt = new Date(measuredMs).toISOString();
  const zoneOffset = formatOffset(offsetMinutes(measuredMs, tz));
  const localDate = localDateOf(measuredAt, zoneOffset, tz);
  const { method, flags } = recordingMethodFor(g.attrib);
  const byType = new Map<number, number>();
  for (const m of g.measures ?? []) byType.set(m.type, realValue(m));
  const ext = `grp:${g.grpid}`;
  const observations: NormalizedObservation[] = [];
  const n: NormalizedRecord = { observations, notes: [] };

  const sys = byType.get(WITHINGS_MEASTYPES.systolic);
  const dia = byType.get(WITHINGS_MEASTYPES.diastolic);
  const pulse = byType.get(WITHINGS_MEASTYPES.pulse) ?? null;
  if (sys !== undefined && dia !== undefined) {
    const bpFlags = [...flags, ...plausibilityFlags('blood_pressure_systolic', sys), ...plausibilityFlags('blood_pressure_diastolic', dia)];
    if (dia >= sys) bpFlags.push('DIASTOLIC_NOT_BELOW_SYSTOLIC');
    n.bp = { externalId: ext, measuredAt, localDate, zoneOffset, systolic: sys, diastolic: dia, pulse, bodyPosition: null, measurementLocation: null, qualityFlags: [...new Set(bpFlags)] };
    observations.push({ metricId: 'blood_pressure_systolic', value: sys, unit: 'mmHg', measuredAt, startAt: null, endAt: null, localDate, zoneOffset, externalId: ext, qualityFlags: [...flags, ...plausibilityFlags('blood_pressure_systolic', sys)] });
    observations.push({ metricId: 'blood_pressure_diastolic', value: dia, unit: 'mmHg', measuredAt, startAt: null, endAt: null, localDate, zoneOffset, externalId: ext, qualityFlags: [...flags, ...plausibilityFlags('blood_pressure_diastolic', dia)] });
    if (pulse !== null) observations.push({ metricId: 'pulse', value: pulse, unit: 'bpm', measuredAt, startAt: null, endAt: null, localDate, zoneOffset, externalId: ext, qualityFlags: [...flags, ...plausibilityFlags('pulse', pulse)] });
  } else if (pulse !== null) {
    observations.push({ metricId: 'heart_rate', value: pulse, unit: 'bpm', measuredAt, startAt: null, endAt: null, localDate, zoneOffset, externalId: ext, qualityFlags: [...flags, ...plausibilityFlags('heart_rate', pulse)] });
  }
  for (const [type, value] of byType) {
    const def = METRIC_FOR_TYPE[type];
    if (!def) {
      if (![WITHINGS_MEASTYPES.systolic, WITHINGS_MEASTYPES.diastolic, WITHINGS_MEASTYPES.pulse].includes(type as 9 | 10 | 11)) n.notes.push(`unmapped meastype ${type}`);
      continue;
    }
    observations.push({ metricId: def.metricId, value, unit: def.unit, measuredAt, startAt: null, endAt: null, localDate, zoneOffset, externalId: ext, qualityFlags: [...flags, ...plausibilityFlags(def.metricId, value)] });
  }
  if (observations.length === 0) return null;
  const deviceKey = g.hash_deviceid ?? g.deviceid ?? 'unknown';
  return {
    externalId: ext,
    recordType: n.bp ? 'blood_pressure' : 'measuregrp',
    dataOrigin: null,
    sourceUserId: ctx.sourceUserId,
    device: { externalId: deviceKey, label: g.model ? `Withings ${g.model}` : 'Withings device', manufacturer: 'Withings', model: g.model ?? null, type: n.bp ? 'BLOOD_PRESSURE_MONITOR' : 'SCALE' },
    recordingMethod: method,
    sourceModifiedAt: g.modified ? new Date(g.modified * 1000).toISOString() : null,
    originalTime: measuredAt,
    originalZoneOffset: zoneOffset,
    rawPayload: { ...g, timezone: ctx.timezone },
    normalized: n,
  };
}
