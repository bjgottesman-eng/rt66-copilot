/**
 * Unit normalization. Every observation is stored in the catalog's canonical unit. Conversions are
 * explicit; anything not listed is an error so values with incompatible units are never silently
 * combined (spec §11, §31).
 */
import { metricById } from '@bho/shared-config';

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnitError';
  }
}

type Converter = (v: number) => number;
const MGDL_PER_MMOL_GLUCOSE = 18.0182;

const conversions: Record<string, Record<string, Converter>> = {
  'mg/dL': { 'mmol/L': (v) => v / MGDL_PER_MMOL_GLUCOSE },
  'mmol/L': { 'mg/dL': (v) => v * MGDL_PER_MMOL_GLUCOSE },
  kg: { lb: (v) => v * 2.20462262 },
  lb: { kg: (v) => v / 2.20462262 },
  cm: { in: (v) => v / 2.54, m: (v) => v / 100 },
  in: { cm: (v) => v * 2.54 },
  m: { cm: (v) => v * 100, km: (v) => v / 1000, mi: (v) => v / 1609.344 },
  km: { m: (v) => v * 1000 },
  mi: { m: (v) => v * 1609.344 },
  '°C': { '°F': (v) => (v * 9) / 5 + 32 },
  '°F': { '°C': (v) => ((v - 32) * 5) / 9 },
  min: { h: (v) => v / 60, s: (v) => v * 60 },
  h: { min: (v) => v * 60 },
  s: { min: (v) => v / 60 },
  kcal: { kJ: (v) => v * 4.184 },
  kJ: { kcal: (v) => v / 4.184 },
  g: { mg: (v) => v * 1000 },
  mg: { g: (v) => v / 1000 },
  L: { mL: (v) => v * 1000 },
  mL: { L: (v) => v / 1000 },
};

const aliases: Record<string, string> = {
  'mg/dl': 'mg/dL',
  'mmol/l': 'mmol/L',
  kgs: 'kg',
  lbs: 'lb',
  pounds: 'lb',
  kilograms: 'kg',
  celsius: '°C',
  c: '°C',
  fahrenheit: '°F',
  f: '°F',
  minutes: 'min',
  hours: 'h',
  seconds: 's',
  calories: 'kcal',
  kilocalories: 'kcal',
  liters: 'L',
  l: 'L',
  ml: 'mL',
  meters: 'm',
  metres: 'm',
  percent: '%',
  pct: '%',
};

export function normalizeUnitName(unit: string): string {
  const trimmed = unit.trim();
  return aliases[trimmed.toLowerCase()] ?? trimmed;
}

export function convertUnit(value: number, from: string, to: string): number {
  const f = normalizeUnitName(from);
  const t = normalizeUnitName(to);
  if (f === t) return value;
  const fn = conversions[f]?.[t];
  if (!fn) throw new UnitError(`no conversion from ${from} to ${to}`);
  return fn(value);
}

/** Converts a value to the metric's canonical unit; throws UnitError when units are incompatible. */
export function toCanonical(metricId: string, value: number, unit: string): { value: number; unit: string } {
  const def = metricById(metricId);
  if (!def) throw new UnitError(`unknown metric ${metricId}`);
  if (def.unit === 'varies') return { value, unit: normalizeUnitName(unit) };
  return { value: convertUnit(value, unit, def.unit), unit: def.unit };
}

export function roundTo(value: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(value * f) / f;
}
