import { describe, expect, it } from 'vitest';
import type { WithingsMeasureGroup } from '../src/connectors/withings/api.js';
import {
  canonicalJson,
  decodeWithingsGroup,
  decodeWithingsValue,
  sha256Hex,
} from '../src/ingest/normalize.js';

function group(measures: Array<{ value: number; type: number; unit: number }>): WithingsMeasureGroup {
  return {
    grpid: 1,
    attrib: 0,
    date: 1786496857,
    created: 1786496888,
    modified: 1786496888,
    category: 1,
    deviceid: 'dev',
    measures,
  };
}

describe('decodeWithingsValue (real value = value * 10^unit)', () => {
  it('unit 0 is the value itself', () => {
    expect(decodeWithingsValue(119, 0)).toBe(119);
  });
  it('unit -1 shifts one decimal', () => {
    expect(decodeWithingsValue(1215, -1)).toBe(121.5);
  });
  it('unit -2 rounds to storage precision (numeric(5,1))', () => {
    expect(decodeWithingsValue(12154, -2)).toBe(121.5);
  });
  it('positive units scale up', () => {
    expect(decodeWithingsValue(12, 1)).toBe(120);
  });
});

describe('decodeWithingsGroup', () => {
  it('maps type 10/9/11 to systolic/diastolic/pulse', () => {
    const decoded = decodeWithingsGroup(
      group([
        { value: 1192, type: 10, unit: -1 },
        { value: 77, type: 9, unit: 0 },
        { value: 60, type: 11, unit: 0 },
      ]),
    );
    expect(decoded).toEqual({ systolic: 119.2, diastolic: 77, pulse: 60 });
  });

  it('missing pulse stays null — never zero', () => {
    const decoded = decodeWithingsGroup(
      group([
        { value: 119, type: 10, unit: 0 },
        { value: 77, type: 9, unit: 0 },
      ]),
    );
    expect(decoded.pulse).toBeNull();
    expect(decoded.pulse).not.toBe(0);
  });

  it('missing systolic/diastolic reported as null (caller marks raw failed)', () => {
    const decoded = decodeWithingsGroup(group([{ value: 60, type: 11, unit: 0 }]));
    expect(decoded.systolic).toBeNull();
    expect(decoded.diastolic).toBeNull();
  });
});

describe('canonicalJson / sha256Hex payload hashing', () => {
  it('is key-order independent', () => {
    const a = canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } });
    const b = canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 });
    expect(a).toBe(b);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });
  it('distinguishes different payloads', () => {
    expect(sha256Hex(canonicalJson({ a: 1 }))).not.toBe(sha256Hex(canonicalJson({ a: 2 })));
  });
  it('drops undefined members and preserves array order', () => {
    expect(canonicalJson({ a: undefined, b: [2, 1] })).toBe('{"b":[2,1]}');
  });
});
