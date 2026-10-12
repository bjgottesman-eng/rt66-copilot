import { describe, expect, it } from 'vitest';
import { UnitError, convertUnit, toCanonical } from '../src/units.js';

describe('unit conversion', () => {
  it('converts glucose mmol/L to mg/dL', () => {
    expect(convertUnit(5.5, 'mmol/L', 'mg/dL')).toBeCloseTo(99.1, 1);
    expect(toCanonical('blood_glucose', 5.5, 'mmol/l').value).toBeCloseTo(99.1, 1);
  });
  it('converts lb to kg and keeps canonical kg', () => {
    expect(toCanonical('weight', 176.37, 'lb').value).toBeCloseTo(80, 1);
    expect(toCanonical('weight', 80, 'kg')).toEqual({ value: 80, unit: 'kg' });
  });
  it('refuses incompatible units instead of silently combining', () => {
    expect(() => toCanonical('weight', 80, 'mmHg')).toThrow(UnitError);
    expect(() => convertUnit(1, 'kg', 'mg/dL')).toThrow(/no conversion/);
  });
  it('temperature', () => {
    expect(convertUnit(98.6, '°F', '°C')).toBeCloseTo(37, 1);
  });
});
