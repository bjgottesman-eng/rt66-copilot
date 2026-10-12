import { describe, expect, it } from 'vitest';
import { HealthConnectIngestBatchSchema, HealthConnectRecordSchema, ManualBloodPressureInputSchema } from '../src/index.js';

describe('HealthConnectRecordSchema', () => {
  const base = {
    hcId: 'hc-1',
    dataOrigin: 'com.ouraring.oura',
    lastModifiedTime: '2026-10-11T07:00:00Z',
    recordingMethod: 'AUTOMATICALLY_RECORDED',
  };

  it('accepts a valid steps interval record', () => {
    const r = HealthConnectRecordSchema.parse({
      ...base,
      recordType: 'Steps',
      startTime: '2026-10-11T06:00:00Z',
      startZoneOffset: '-04:00',
      endTime: '2026-10-11T07:00:00Z',
      endZoneOffset: '-04:00',
      payload: { count: 1200 },
    });
    expect(r.payload.count).toBe(1200);
  });

  it('rejects a record with neither instant nor interval', () => {
    const res = HealthConnectRecordSchema.safeParse({ ...base, recordType: 'Weight', payload: { kg: 80 } });
    expect(res.success).toBe(false);
  });

  it('rejects an invalid payload for the record type', () => {
    const res = HealthConnectRecordSchema.safeParse({
      ...base,
      recordType: 'BloodPressure',
      time: '2026-10-11T07:00:00Z',
      payload: { systolicMmHg: 120 },
    });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain('invalid BloodPressure payload');
  });

  it('rejects endTime before startTime', () => {
    const res = HealthConnectRecordSchema.safeParse({
      ...base,
      recordType: 'Steps',
      startTime: '2026-10-11T07:00:00Z',
      endTime: '2026-10-11T06:00:00Z',
      payload: { count: 1 },
    });
    expect(res.success).toBe(false);
  });
});

describe('HealthConnectIngestBatchSchema', () => {
  it('defaults deletions and validates nested records', () => {
    const b = HealthConnectIngestBatchSchema.parse({
      source: 'health_connect',
      deviceInstanceId: 'device-12345678',
      appVersion: '0.1.0',
      timeZone: 'America/New_York',
      clientTime: '2026-10-11T07:00:00Z',
      mode: 'CHANGES',
      records: [],
    });
    expect(b.deletions).toEqual([]);
  });
});

describe('ManualBloodPressureInputSchema', () => {
  it('rejects diastolic >= systolic', () => {
    const res = ManualBloodPressureInputSchema.safeParse({
      systolic: 110,
      diastolic: 115,
      measuredAt: '2026-10-11T07:00:00Z',
      clientEntryId: 'entry-12345678',
    });
    expect(res.success).toBe(false);
  });
  it('applies defaults', () => {
    const v = ManualBloodPressureInputSchema.parse({ systolic: 118, diastolic: 76, measuredAt: '2026-10-11T07:00:00Z', clientEntryId: 'entry-12345678' });
    expect(v.arm).toBe('UNKNOWN');
    expect(v.posture).toBe('SEATED');
  });
});
