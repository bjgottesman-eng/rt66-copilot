/**
 * Cronometer CSV mapping (Phase 4). Cronometer does not publish a schema for its exports, so headers
 * are matched by pattern and the detected mapping is returned for the user to review before anything
 * is written. Two layouts are recognised: a daily nutrition summary (one row per day) and a
 * servings/diary export (one row per food with a day, an optional time and an optional diary group).
 */
import { parseCsv } from './csv.js';

export type CronometerFormat = 'DAILY_SUMMARY' | 'SERVINGS' | 'UNKNOWN';
export const CRONOMETER_CSV_PREFIX = 'cronometer-csv';

export interface CronometerMapping {
  format: CronometerFormat;
  dayColumn: string | null;
  timeColumn: string | null;
  groupColumn: string | null;
  foodColumn: string | null;
  amountColumn: string | null;
  completedColumn: string | null;
  /** metric id → header */
  metricColumns: Record<string, string>;
  /** numeric columns with a unit suffix that are not catalog metrics; kept as extra nutrients by header name */
  extraNutrientColumns: string[];
  ignoredColumns: string[];
}

export interface CronometerRow {
  index: number;
  day: string;
  time: string | null;
  group: string | null;
  food: string | null;
  amount: string | null;
  completed: boolean | null;
  metrics: Record<string, number>;
  nutrients: Record<string, number>;
}

const METRIC_PATTERNS: Array<[string, RegExp]> = [
  ['calories', /^(energy|calories)\b/i],
  ['protein_g', /^protein\b/i],
  ['carbs_g', /^(carbs|carbohydrates?|net carbs|total carbohydrates?)\b/i],
  ['fat_g', /^(fat|total fat)\s*\(g\)|^fat$/i],
  ['saturated_fat_g', /^saturated\b/i],
  ['fiber_g', /^(fiber|fibre)\b/i],
  ['sodium_mg', /^sodium\b/i],
  ['potassium_mg', /^potassium\b/i],
  ['sugar_g', /^(sugars?|total sugars?)\b/i],
  ['hydration_l', /^water\b.*\((g|ml|l)\)/i],
];

const DAY_PATTERN = /^(day|date)$/i;
const TIME_PATTERN = /^(time)$/i;
const GROUP_PATTERN = /^(group|meal|category|diary group)$/i;
const FOOD_PATTERN = /^(food name|food|item|description)$/i;
const AMOUNT_PATTERN = /^(amount|quantity|serving)$/i;
const COMPLETED_PATTERN = /^(completed|complete)$/i;

function cleanHeader(h: string): string {
  return h.trim().replace(/\s+/g, ' ');
}

export function detectCronometerMapping(headers: string[]): CronometerMapping {
  const clean = headers.map(cleanHeader);
  const m: CronometerMapping = { format: 'UNKNOWN', dayColumn: null, timeColumn: null, groupColumn: null, foodColumn: null, amountColumn: null, completedColumn: null, metricColumns: {}, extraNutrientColumns: [], ignoredColumns: [] };
  for (const h of clean) {
    if (!m.dayColumn && DAY_PATTERN.test(h)) m.dayColumn = h;
    else if (!m.timeColumn && TIME_PATTERN.test(h)) m.timeColumn = h;
    else if (!m.groupColumn && GROUP_PATTERN.test(h)) m.groupColumn = h;
    else if (!m.foodColumn && FOOD_PATTERN.test(h)) m.foodColumn = h;
    else if (!m.amountColumn && AMOUNT_PATTERN.test(h)) m.amountColumn = h;
    else if (!m.completedColumn && COMPLETED_PATTERN.test(h)) m.completedColumn = h;
    else {
      const metric = METRIC_PATTERNS.find(([id, re]) => re.test(h) && !m.metricColumns[id]);
      if (metric) m.metricColumns[metric[0]] = h;
      else if (/\((g|mg|µg|mcg|ug|iu|kcal|ml|%)\)\s*$/i.test(h)) m.extraNutrientColumns.push(h);
      else m.ignoredColumns.push(h);
    }
  }
  if (m.dayColumn && m.foodColumn) m.format = 'SERVINGS';
  else if (m.dayColumn && Object.keys(m.metricColumns).length >= 2) m.format = 'DAILY_SUMMARY';
  return m;
}

function toNumber(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim().replace(/,/g, '');
  if (t === '' || t === '-' || t.toLowerCase() === 'n/a') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Normalises common day formats: YYYY-MM-DD, MM/DD/YYYY (US, as Cronometer exports), "Oct 11, 2026". */
export function normalizeDay(raw: string): string | null {
  const t = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  if (/[a-z]/i.test(t)) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

/** "08:10", "8:10:00", "7:45 PM" → hour/minute; null when unparseable. */
export function parseClockTime(raw: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(raw.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ap = m[3]?.toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function toBool(v: string | undefined): boolean | null {
  if (v === undefined) return null;
  const t = v.trim().toLowerCase();
  if (['true', 'yes', '1', 'y'].includes(t)) return true;
  if (['false', 'no', '0', 'n'].includes(t)) return false;
  return null;
}

export function parseCronometerCsv(text: string): { mapping: CronometerMapping; rows: CronometerRow[]; warnings: string[] } {
  const table = parseCsv(text);
  if (table.length < 2) return { mapping: detectCronometerMapping(table[0] ?? []), rows: [], warnings: ['CSV has no data rows'] };
  const headers = table[0]!.map(cleanHeader);
  const mapping = detectCronometerMapping(headers);
  const warnings: string[] = [];
  const rows: CronometerRow[] = [];
  if (!mapping.dayColumn) {
    warnings.push('No Day/Date column found; nothing can be imported');
    return { mapping, rows, warnings };
  }
  const idx = (h: string | null) => (h ? headers.indexOf(h) : -1);
  const cell = (cells: string[], h: string | null) => (h ? (cells[idx(h)] ?? '').trim() || null : null);
  const dayIdx = idx(mapping.dayColumn);
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const day = normalizeDay(cells[dayIdx] ?? '');
    if (!day) {
      warnings.push(`row ${r + 1}: unrecognised day "${cells[dayIdx] ?? ''}" skipped`);
      continue;
    }
    const metrics: Record<string, number> = {};
    for (const [metricId, header] of Object.entries(mapping.metricColumns)) {
      let v = toNumber(cells[headers.indexOf(header)]);
      if (v !== null && metricId === 'hydration_l' && /\((g|ml)\)/i.test(header)) v = v / 1000;
      if (v !== null) metrics[metricId] = v;
    }
    const nutrients: Record<string, number> = {};
    for (const header of mapping.extraNutrientColumns) {
      const v = toNumber(cells[headers.indexOf(header)]);
      if (v !== null) nutrients[header] = v;
    }
    const food = cell(cells, mapping.foodColumn);
    if (mapping.format === 'SERVINGS' && food && /^(totals?|daily total)$/i.test(food)) continue; // appended total rows would double count
    rows.push({ index: r, day, time: cell(cells, mapping.timeColumn), group: cell(cells, mapping.groupColumn), food, amount: cell(cells, mapping.amountColumn), completed: toBool(cell(cells, mapping.completedColumn) ?? undefined), metrics, nutrients });
  }
  return { mapping, rows, warnings };
}

export interface MealInput {
  /** Stable across re-exports: day (+ diary group), never the file. */
  externalId: string;
  day: string;
  time: string | null;
  name: string;
  mealType: string | null;
  completed: boolean | null;
  metrics: Record<string, number>;
  nutrients: Record<string, number>;
  foodItems: Array<{ name: string; amount: string | null; metrics: Record<string, number> }>;
  rowIndexes: number[];
}

/** Groups servings rows into meals (day + diary group) or keeps daily summaries as one meal per day. */
export function rowsToMeals(rows: CronometerRow[], mapping: CronometerMapping): MealInput[] {
  if (mapping.format === 'DAILY_SUMMARY') {
    return rows.map((r) => ({ externalId: `${CRONOMETER_CSV_PREFIX}:day:${r.day}`, day: r.day, time: null, name: 'Daily total (Cronometer)', mealType: 'DAILY_SUMMARY', completed: r.completed, metrics: r.metrics, nutrients: r.nutrients, foodItems: [], rowIndexes: [r.index] }));
  }
  const byMeal = new Map<string, MealInput>();
  for (const r of rows) {
    const group = r.group ?? 'Uncategorized';
    const key = `${r.day}|${group.toLowerCase()}`;
    const meal = byMeal.get(key) ?? { externalId: `${CRONOMETER_CSV_PREFIX}:${r.day}:${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, day: r.day, time: r.time, name: group, mealType: mealTypeFor(group), completed: null, metrics: {}, nutrients: {}, foodItems: [], rowIndexes: [] };
    if (!meal.time && r.time) meal.time = r.time;
    for (const [k, v] of Object.entries(r.metrics)) meal.metrics[k] = (meal.metrics[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.nutrients)) meal.nutrients[k] = (meal.nutrients[k] ?? 0) + v;
    meal.foodItems.push({ name: r.food ?? 'item', amount: r.amount, metrics: r.metrics });
    meal.rowIndexes.push(r.index);
    byMeal.set(key, meal);
  }
  return [...byMeal.values()];
}

export function mealTypeFor(group: string): string | null {
  const g = group.toLowerCase();
  if (/breakfast/.test(g)) return 'BREAKFAST';
  if (/lunch/.test(g)) return 'LUNCH';
  if (/dinner|supper/.test(g)) return 'DINNER';
  if (/snack/.test(g)) return 'SNACK';
  return null;
}

/** Default local meal hours used when an export carries no time column (flagged MEAL_TIME_ASSUMED). */
export function defaultMealHour(mealType: string | null): number {
  switch (mealType) {
    case 'BREAKFAST':
      return 8;
    case 'LUNCH':
      return 13;
    case 'DINNER':
      return 19;
    case 'SNACK':
      return 16;
    default:
      return 12;
  }
}
