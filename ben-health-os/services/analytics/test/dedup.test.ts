import { describe, expect, it } from 'vitest';
import { canonicalJson, findIntervalDuplicate, findPointDuplicate, payloadHash, resolveDailySteps } from '../src/dedup.js';
import { priorityRank } from '../src/priority.js';

describe('payload hashing', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: [3, { d: 1, c: 2 }] })).toBe('{"a":[3,{"c":2,"d":1}],"b":1}');
    expect(payloadHash({ b: 1, a: 2 })).toBe(payloadHash({ a: 2, b: 1 }));
    expect(payloadHash({ a: 2 })).not.toBe(payloadHash({ a: 3 }));
  });
});

describe('cross-source blood pressure dedup', () => {
  const withings = { id: 'w1', connector: 'withings', measuredAt: '2026-10-12T07:00:00Z', value: 122, companions: { diastolic: 78 } };
  it('marks the Health Connect copy of a Withings reading as the duplicate', () => {
    const hcCopy = { id: 'h1', connector: 'health_connect', dataOrigin: 'com.withings.wiscale2', measuredAt: '2026-10-12T07:01:30Z', value: 122, companions: { diastolic: 78 } };
    const d = findPointDuplicate(hcCopy, [withings], 'blood_pressure');
    expect(d).not.toBeNull();
    expect(d!.canonical.id).toBe('w1');
    expect(d!.duplicate.id).toBe('h1');
    // and symmetric: if Withings arrives second it still becomes canonical
    const d2 = findPointDuplicate(withings, [hcCopy], 'blood_pressure');
    expect(d2!.canonical.id).toBe('w1');
  });
  it('does not match when values or times differ beyond the window', () => {
    expect(findPointDuplicate({ id: 'h2', connector: 'health_connect', dataOrigin: 'com.withings.wiscale2', measuredAt: '2026-10-12T07:10:00Z', value: 122, companions: { diastolic: 78 } }, [withings], 'blood_pressure')).toBeNull();
    expect(findPointDuplicate({ id: 'h3', connector: 'health_connect', dataOrigin: 'com.withings.wiscale2', measuredAt: '2026-10-12T07:00:30Z', value: 122, companions: { diastolic: 80 } }, [withings], 'blood_pressure')).toBeNull();
  });
  it('never treats two readings from the same source as cross-source duplicates', () => {
    const second = { id: 'w2', connector: 'withings', measuredAt: '2026-10-12T07:00:30Z', value: 122, companions: { diastolic: 78 } };
    expect(findPointDuplicate(second, [withings], 'blood_pressure')).toBeNull();
  });
});

describe('interval dedup (sleep)', () => {
  const oura = { id: 'o1', connector: 'oura', startAt: '2026-10-11T03:00:00Z', endAt: '2026-10-11T11:00:00Z' };
  it('matches an overlapping Health Connect sleep session from the Oura app', () => {
    const hc = { id: 'h1', connector: 'health_connect', dataOrigin: 'com.ouraring.oura', startAt: '2026-10-11T03:05:00Z', endAt: '2026-10-11T10:55:00Z' };
    const d = findIntervalDuplicate(hc, [oura], 'sleep');
    expect(d!.canonical.id).toBe('o1');
    expect(d!.reason).toMatch(/overlap/);
  });
  it('keeps a separate nap', () => {
    const nap = { id: 'h2', connector: 'health_connect', dataOrigin: 'com.sec.android.app.shealth', startAt: '2026-10-11T18:00:00Z', endAt: '2026-10-11T18:40:00Z' };
    expect(findIntervalDuplicate(nap, [oura], 'sleep')).toBeNull();
  });
});

describe('steps are never summed across origins', () => {
  it('chooses the highest-priority origin and lists others as alternates', () => {
    const r = resolveDailySteps([
      { connector: 'health_connect', dataOrigin: 'com.ouraring.oura', steps: 9800 },
      { connector: 'health_connect', dataOrigin: 'com.sec.android.app.shealth', steps: 10400 },
    ]);
    expect(r!.steps).toBe(10400);
    expect(r!.source).toBe('health_connect:com.sec.android.app.shealth');
    expect(r!.alternates).toEqual([{ source: 'health_connect:com.ouraring.oura', steps: 9800 }]);
  });
  it('priority order sanity', () => {
    expect(priorityRank('steps', 'health_connect', 'com.sec.android.app.shealth')).toBeLessThan(priorityRank('steps', 'health_connect', 'com.ouraring.oura'));
    expect(priorityRank('sleep', 'oura')).toBeLessThan(priorityRank('sleep', 'health_connect', 'com.ouraring.oura'));
  });
});
