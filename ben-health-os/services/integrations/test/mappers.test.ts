import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { OuraClient, dateWindows, mapOuraDocument, stagesFromPhase5Min } from '../src/index.js';
import { mapWithingsGroup, realValue, recordingMethodFor } from '../src/withings/mapper.js';
import { generatePkce } from '../src/oauth.js';
import { createHash } from 'node:crypto';

const ctx = { timeZone: 'America/New_York', sourceUserId: 'oura-user', nowIso: '2026-10-12T12:00:00Z' };

describe('Oura mapper', () => {
  it('maps a long sleep document into a session with stages and nightly metrics', () => {
    const doc = {
      id: 'sl1', day: '2026-10-11', type: 'long_sleep', bedtime_start: '2026-10-10T23:10:00-04:00', bedtime_end: '2026-10-11T06:50:00-04:00',
      total_sleep_duration: 25200, time_in_bed: 27600, efficiency: 91, deep_sleep_duration: 5400, light_sleep_duration: 14400, rem_sleep_duration: 5400, awake_time: 2400,
      average_hrv: 44, lowest_heart_rate: 51, average_heart_rate: 56, average_breath: 14.2, sleep_phase_5_min: '4422221133',
      readiness: { score: 82, temperature_deviation: -0.1 },
    };
    const [rec] = mapOuraDocument('sleep', doc, ctx);
    expect(rec!.externalId).toBe('sleep:sl1');
    expect(rec!.normalized.sleep?.localDate).toBe('2026-10-11');
    expect(rec!.normalized.sleep?.durationMin).toBe(420);
    expect(rec!.normalized.sleep?.stages.map((s) => s.stage)).toEqual(['AWAKE', 'LIGHT', 'DEEP', 'REM']);
    expect(rec!.normalized.sleep?.startZoneOffset).toBe('-04:00');
    const metrics = rec!.normalized.observations.map((o) => o.metricId).sort();
    expect(metrics).toEqual(['hrv_rmssd', 'respiratory_rate', 'resting_heart_rate', 'sleep_duration', 'sleep_efficiency']);
    expect(rec!.normalized.observations.find((o) => o.metricId === 'resting_heart_rate')!.value).toBe(51);
  });

  it('keeps naps as sessions without nightly metrics', () => {
    const [rec] = mapOuraDocument('sleep', { id: 'nap1', day: '2026-10-11', type: 'late_nap', bedtime_start: '2026-10-11T15:00:00-04:00', bedtime_end: '2026-10-11T15:40:00-04:00', total_sleep_duration: 2100 }, ctx);
    expect(rec!.normalized.observations).toHaveLength(0);
    expect(rec!.normalized.sleep?.qualityFlags).toContain('NAP');
  });

  it('maps daily documents and never merges temperature twice', () => {
    const r = mapOuraDocument('daily_readiness', { id: 'r1', day: '2026-10-11', timestamp: '2026-10-11T00:00:00-04:00', score: 80, temperature_deviation: 0.3 }, ctx)[0]!;
    expect(r.normalized.observations.map((o) => [o.metricId, o.value])).toEqual([['readiness_score', 80], ['skin_temperature_deviation', 0.3]]);
    expect(r.normalized.observations[0]!.localDate).toBe('2026-10-11');
    const a = mapOuraDocument('daily_activity', { id: 'a1', day: '2026-10-11', timestamp: '2026-10-11T00:00:00-04:00', score: 75, steps: 9123, active_calories: 450, total_calories: 2600 }, ctx)[0]!;
    expect(a.normalized.observations.find((o) => o.metricId === 'steps')!.endAt).toBe('2026-10-12T04:00:00.000Z');
    const s = mapOuraDocument('daily_spo2', { id: 's1', day: '2026-10-11', spo2_percentage: { average: 96.4 } }, ctx)[0]!;
    expect(s.normalized.observations[0]!.value).toBe(96.4);
    expect(mapOuraDocument('daily_stress', { id: 'x', day: '2026-10-11' }, ctx)).toHaveLength(0);
  });

  it('maps workouts and heart-rate samples', () => {
    const w = mapOuraDocument('workout', { id: 'w1', day: '2026-10-11', activity: 'running', start_datetime: '2026-10-11T07:00:00-04:00', end_datetime: '2026-10-11T07:45:00-04:00', calories: 410, distance: 7200, source: 'autodetected' }, ctx)[0]!;
    expect(w.normalized.workout?.category).toBe('CARDIO');
    expect(w.normalized.workout?.durationMin).toBe(45);
    expect(w.normalized.observations[0]!.metricId).toBe('exercise_minutes');
    const h = mapOuraDocument('heartrate', { bpm: 61, source: 'awake', timestamp: '2026-10-11T12:00:00+00:00' }, ctx)[0]!;
    expect(h.externalId).toBe('heartrate:2026-10-11T12:00:00.000Z');
  });

  it('phase string edge cases and date windows', () => {
    expect(stagesFromPhase5Min('', '2026-10-11T03:00:00Z')).toEqual([]);
    expect(dateWindows('2026-10-11', 45, 30)).toEqual([{ start: '2026-09-12', end: '2026-10-11' }, { start: '2026-08-28', end: '2026-09-11' }]);
  });
});

describe('Oura webhook signature and PKCE', () => {
  it('verifies HMAC-SHA256 uppercase hex over timestamp + body', () => {
    const body = JSON.stringify({ event_type: 'create', data_type: 'sleep', object_id: 'x', event_time: 't', user_id: 'u' });
    const ts = '1700000000';
    const sig = createHmac('sha256', 'secret').update(ts + body).digest('hex').toUpperCase();
    expect(OuraClient.verifySignature('secret', ts, body, sig)).toBe(true);
    expect(OuraClient.verifySignature('secret', ts, body, sig.toLowerCase())).toBe(true);
    expect(OuraClient.verifySignature('other', ts, body, sig)).toBe(false);
    expect(OuraClient.verifySignature('secret', ts + '1', body, sig)).toBe(false);
    expect(OuraClient.verifySignature('secret', ts, body, undefined)).toBe(false);
  });
  it('generates S256 PKCE pairs', () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')).toBe(challenge);
  });
});

describe('Withings mapper', () => {
  it('decodes values, groups BP with pulse and classifies attrib', () => {
    expect(realValue({ value: 7850, unit: -2 })).toBeCloseTo(78.5);
    expect(recordingMethodFor(0).method).toBe('AUTOMATICALLY_RECORDED');
    expect(recordingMethodFor(2).method).toBe('MANUAL_ENTRY');
    expect(recordingMethodFor(1).flags).toContain('AMBIGUOUS_USER');
    const rec = mapWithingsGroup(
      { grpid: 123, attrib: 5, date: 1791795600, created: 1791795700, modified: 1791795800, category: 1, deviceid: 'dev', hash_deviceid: 'hash', model: 'BPM Connect', measures: [{ value: 121, type: 10, unit: 0 }, { value: 78, type: 9, unit: 0 }, { value: 61, type: 11, unit: 0 }] },
      { timezone: 'America/New_York', userTimeZone: 'UTC', sourceUserId: '777' },
    )!;
    expect(rec.externalId).toBe('grp:123');
    expect(rec.recordType).toBe('blood_pressure');
    expect(rec.normalized.bp).toMatchObject({ systolic: 121, diastolic: 78, pulse: 61, zoneOffset: '-04:00', localDate: '2026-10-12' });
    expect(rec.normalized.observations.map((o) => o.metricId)).toEqual(['blood_pressure_systolic', 'blood_pressure_diastolic', 'pulse']);
    expect(rec.device?.label).toBe('Withings BPM Connect');
    expect(rec.sourceModifiedAt).toBe('2026-10-12T09:03:20.000Z');
  });
  it('maps scale groups and skips objectives and unknown types', () => {
    const scale = mapWithingsGroup({ grpid: 9, attrib: 0, date: 1791795600, created: 0, modified: 0, category: 1, deviceid: null, hash_deviceid: null, model: 'Body+', measures: [{ value: 8150, type: 1, unit: -2 }, { value: 215, type: 6, unit: -1 }, { value: 999, type: 91, unit: 0 }] }, { timezone: 'Europe/Paris', userTimeZone: 'UTC', sourceUserId: null })!;
    expect(scale.normalized.observations.map((o) => [o.metricId, o.value])).toEqual([['weight', 81.5], ['body_fat_pct', 21.5]]);
    expect(scale.normalized.notes).toContain('unmapped meastype 91');
    expect(mapWithingsGroup({ grpid: 1, attrib: 0, date: 1, created: 0, modified: 0, category: 2, deviceid: null, hash_deviceid: null, measures: [{ value: 80, type: 1, unit: 0 }] }, { timezone: 'UTC', userTimeZone: 'UTC', sourceUserId: null })).toBeNull();
  });
});
