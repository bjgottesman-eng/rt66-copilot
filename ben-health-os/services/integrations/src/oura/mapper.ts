import type { ExternalRecordInput, NormalizedObservation, NormalizedRecord } from '@bho/contracts';
import { addDays, categorizeExercise, localDateOf, parseOffset, plausibilityFlags } from '@bho/analytics';

export interface OuraMapContext {
  timeZone: string;
  sourceUserId: string | null;
  nowIso: string;
}

const RING = { externalId: 'oura-ring', label: 'Oura Ring', manufacturer: 'Oura', model: null, type: 'RING' };

function offsetOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /([+-]\d{2}:\d{2}|Z)$/.exec(iso);
  return m ? (m[1] === 'Z' ? 'Z' : m[1]!) : null;
}

function toUtcIso(iso: string): string {
  return new Date(iso).toISOString();
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function obs(metricId: string, value: number, unit: string, measuredAt: string, localDate: string, zoneOffset: string | null, externalId: string, extra: Partial<NormalizedObservation> = {}): NormalizedObservation {
  return { metricId, value, unit, measuredAt, startAt: null, endAt: null, localDate, zoneOffset, externalId, qualityFlags: plausibilityFlags(metricId, value), ...extra };
}

/** Sleep phase string: one char per 5 minutes from bedtime_start; 1 deep, 2 light, 3 REM, 4 awake. */
export function stagesFromPhase5Min(phases: string | null | undefined, bedtimeStartIso: string): Array<{ startAt: string; endAt: string; stage: string }> {
  if (!phases) return [];
  const start = new Date(bedtimeStartIso).getTime();
  const map: Record<string, string> = { '1': 'DEEP', '2': 'LIGHT', '3': 'REM', '4': 'AWAKE' };
  const out: Array<{ startAt: string; endAt: string; stage: string }> = [];
  let i = 0;
  while (i < phases.length) {
    const ch = phases[i]!;
    let j = i;
    while (j < phases.length && phases[j] === ch) j++;
    out.push({ startAt: new Date(start + i * 300_000).toISOString(), endAt: new Date(start + j * 300_000).toISOString(), stage: map[ch] ?? 'UNKNOWN' });
    i = j;
  }
  return out;
}

function dayAnchor(doc: Record<string, unknown>, ctx: OuraMapContext): { measuredAt: string; localDate: string; zoneOffset: string | null } {
  const day = String(doc.day ?? '');
  const ts = typeof doc.timestamp === 'string' ? doc.timestamp : null;
  if (ts) return { measuredAt: toUtcIso(ts), localDate: day || localDateOf(ts, offsetOf(ts), ctx.timeZone), zoneOffset: offsetOf(ts) };
  // Daily documents without a timestamp: anchor at local noon of `day`.
  const noonLocal = `${day}T12:00:00`;
  const guess = new Date(`${noonLocal}Z`).getTime();
  return { measuredAt: new Date(guess).toISOString(), localDate: day, zoneOffset: null };
}

/** Maps one Oura document to zero or more external records (usually one). */
export function mapOuraDocument(dataType: string, doc: Record<string, unknown>, ctx: OuraMapContext): ExternalRecordInput[] {
  const id = String(doc.id ?? '');
  if (!id && dataType !== 'heartrate') return [];
  const base = { dataOrigin: null, sourceUserId: ctx.sourceUserId, device: RING, recordingMethod: 'AUTOMATICALLY_RECORDED' as const, sourceModifiedAt: null, rawPayload: { dataType, document: doc } };

  switch (dataType) {
    case 'sleep': {
      const start = String(doc.bedtime_start);
      const end = String(doc.bedtime_end);
      const type = String(doc.type ?? 'sleep');
      const day = String(doc.day ?? localDateOf(end, offsetOf(end), ctx.timeZone));
      const sec = (k: string) => num(doc[k]);
      const minutes = (k: string) => (sec(k) !== null ? sec(k)! / 60 : null);
      const durationMin = minutes('total_sleep_duration') ?? (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
      const timeInBed = minutes('time_in_bed') ?? (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
      const efficiency = num(doc.efficiency);
      const isNight = type === 'long_sleep';
      const flags = isNight ? [] : ['NAP'];
      const n: NormalizedRecord = {
        observations: [],
        sleep: {
          externalId: `sleep:${id}`,
          startAt: toUtcIso(start),
          endAt: toUtcIso(end),
          startZoneOffset: offsetOf(start),
          endZoneOffset: offsetOf(end),
          localDate: day,
          durationMin,
          timeInBedMin: timeInBed,
          efficiency,
          deepMin: minutes('deep_sleep_duration'),
          lightMin: minutes('light_sleep_duration'),
          remMin: minutes('rem_sleep_duration'),
          awakeMin: minutes('awake_time'),
          title: type,
          notes: null,
          stages: stagesFromPhase5Min(typeof doc.sleep_phase_5_min === 'string' ? doc.sleep_phase_5_min : null, start),
          qualityFlags: [...flags, ...plausibilityFlags('sleep_duration', durationMin)],
        },
        notes: [],
      };
      if (isNight) {
        const at = toUtcIso(end);
        const zo = offsetOf(end);
        n.observations.push(obs('sleep_duration', durationMin, 'min', at, day, zo, `sleep:${id}`, { startAt: toUtcIso(start), endAt: at }));
        if (efficiency !== null) n.observations.push(obs('sleep_efficiency', efficiency, '%', at, day, zo, `sleep:${id}`, { startAt: toUtcIso(start), endAt: at }));
        const hrv = num(doc.average_hrv);
        if (hrv !== null) n.observations.push(obs('hrv_rmssd', hrv, 'ms', at, day, zo, `sleep:${id}`));
        const lowest = num(doc.lowest_heart_rate);
        if (lowest !== null) n.observations.push(obs('resting_heart_rate', lowest, 'bpm', at, day, zo, `sleep:${id}`));
        const breath = num(doc.average_breath);
        if (breath !== null) n.observations.push(obs('respiratory_rate', breath, 'breaths/min', at, day, zo, `sleep:${id}`));
      } else {
        n.notes.push(`nap (${type}) stored as a session without nightly metrics`);
      }
      return [{ ...base, externalId: `sleep:${id}`, recordType: 'sleep', originalTime: toUtcIso(start), originalEndTime: toUtcIso(end), originalZoneOffset: offsetOf(start), normalized: n }];
    }
    case 'daily_sleep':
    case 'daily_readiness':
    case 'daily_activity':
    case 'daily_spo2':
    case 'daily_stress':
    case 'vO2_max': {
      const a = dayAnchor(doc, ctx);
      const ext = `${dataType}:${id}`;
      const observations: NormalizedObservation[] = [];
      const score = num(doc.score);
      if (dataType === 'daily_sleep' && score !== null) observations.push(obs('sleep_score', score, 'score', a.measuredAt, a.localDate, a.zoneOffset, ext));
      if (dataType === 'daily_readiness') {
        if (score !== null) observations.push(obs('readiness_score', score, 'score', a.measuredAt, a.localDate, a.zoneOffset, ext));
        const temp = num(doc.temperature_deviation);
        if (temp !== null) observations.push(obs('skin_temperature_deviation', temp, '°C', a.measuredAt, a.localDate, a.zoneOffset, ext));
      }
      if (dataType === 'daily_activity') {
        if (score !== null) observations.push(obs('activity_score', score, 'score', a.measuredAt, a.localDate, a.zoneOffset, ext));
        const dayStart = a.measuredAt;
        const dayEnd = new Date(new Date(a.measuredAt).getTime() + 86_400_000).toISOString();
        const steps = num(doc.steps);
        if (steps !== null) observations.push(obs('steps', steps, 'steps', dayStart, a.localDate, a.zoneOffset, ext, { startAt: dayStart, endAt: dayEnd }));
        const active = num(doc.active_calories);
        if (active !== null) observations.push(obs('active_calories', active, 'kcal', dayStart, a.localDate, a.zoneOffset, ext, { startAt: dayStart, endAt: dayEnd }));
        const total = num(doc.total_calories);
        if (total !== null) observations.push(obs('total_calories', total, 'kcal', dayStart, a.localDate, a.zoneOffset, ext, { startAt: dayStart, endAt: dayEnd }));
      }
      if (dataType === 'daily_spo2') {
        const avg = num((doc.spo2_percentage as Record<string, unknown> | undefined)?.average);
        if (avg !== null) observations.push(obs('spo2', avg, '%', a.measuredAt, a.localDate, a.zoneOffset, ext));
      }
      if (dataType === 'daily_stress') {
        const high = num(doc.stress_high);
        if (high !== null) observations.push(obs('stress_high_minutes', high / 60, 'min', a.measuredAt, a.localDate, a.zoneOffset, ext));
      }
      if (dataType === 'vO2_max') {
        const v = num(doc.vo2_max);
        if (v !== null) observations.push(obs('vo2_max', v, 'mL/kg/min', a.measuredAt, a.localDate, a.zoneOffset, ext));
      }
      if (observations.length === 0) return [];
      return [{ ...base, externalId: ext, recordType: dataType, originalTime: a.measuredAt, originalZoneOffset: a.zoneOffset, normalized: { observations, notes: [] } }];
    }
    case 'workout': {
      const start = String(doc.start_datetime);
      const end = String(doc.end_datetime);
      const activity = String(doc.activity ?? 'other');
      const day = String(doc.day ?? localDateOf(start, offsetOf(start), ctx.timeZone));
      const durationMin = (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
      const category = categorizeExercise(activity);
      const ext = `workout:${id}`;
      const observations: NormalizedObservation[] = [obs('exercise_minutes', durationMin, 'min', toUtcIso(start), day, offsetOf(start), ext, { startAt: toUtcIso(start), endAt: toUtcIso(end) })];
      if (category === 'RESISTANCE') observations.push(obs('resistance_sessions', 1, 'sessions', toUtcIso(start), day, offsetOf(start), ext));
      return [{
        ...base,
        externalId: ext,
        recordType: 'workout',
        originalTime: toUtcIso(start),
        originalEndTime: toUtcIso(end),
        originalZoneOffset: offsetOf(start),
        recordingMethod: doc.source === 'manual' ? 'MANUAL_ENTRY' : 'AUTOMATICALLY_RECORDED',
        normalized: {
          observations,
          workout: { externalId: ext, startAt: toUtcIso(start), endAt: toUtcIso(end), localDate: day, durationMin, exerciseType: null, exerciseTypeName: activity.toUpperCase(), category, title: typeof doc.label === 'string' ? doc.label : null, notes: typeof doc.intensity === 'string' ? `intensity: ${doc.intensity}` : null, segments: null, caloriesKcal: num(doc.calories), distanceM: num(doc.distance), qualityFlags: plausibilityFlags('exercise_minutes', durationMin) },
          notes: [],
        },
      }];
    }
    case 'heartrate': {
      // {bpm, source, timestamp}; no document id → derive a stable id from the timestamp.
      const ts = String(doc.timestamp ?? '');
      const bpm = num(doc.bpm);
      if (!ts || bpm === null) return [];
      const at = toUtcIso(ts);
      const ext = `heartrate:${at}`;
      const ld = localDateOf(at, offsetOf(ts), ctx.timeZone);
      return [{ ...base, externalId: ext, recordType: 'heartrate', originalTime: at, originalZoneOffset: offsetOf(ts), normalized: { observations: [obs('heart_rate', bpm, 'bpm', at, ld, offsetOf(ts), ext)], notes: [typeof doc.source === 'string' ? `source: ${doc.source}` : ''].filter(Boolean) } }];
    }
    default:
      return [];
  }
}

/** Date windows (YYYY-MM-DD) covering the last `days` days ending today, chunked for the API. */
export function dateWindows(endDate: string, days: number, chunkDays = 30): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  let end = endDate;
  let remaining = days;
  while (remaining > 0) {
    const span = Math.min(chunkDays, remaining);
    const start = addDays(end, -(span - 1));
    out.push({ start, end });
    end = addDays(start, -1);
    remaining -= span;
  }
  return out;
}

export { parseOffset };
