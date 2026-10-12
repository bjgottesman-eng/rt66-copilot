/**
 * Glucose analytics (Phase 4). Samples are canonical glucose observations for one local day.
 * Nothing here diagnoses; the range is user/clinician configurable and labelled as such.
 */
import { coefficientOfVariationPct, mean, sd } from './stats.js';

export interface GlucoseSample {
  t: string; // ISO instant
  mgDl: number;
}

export interface GlucoseRange {
  lowMgDl: number;
  highMgDl: number;
}

export interface GlucoseDayStats {
  n: number;
  mean: number | null;
  sd: number | null;
  cvPct: number | null;
  min: number | null;
  max: number | null;
  timeInRangePct: number | null;
  timeBelowPct: number | null;
  timeAbovePct: number | null;
  overnightMean: number | null;
  /** Hours between first and last sample. */
  coverageHours: number;
  /** Median sampling interval in minutes (15 for Stelo). */
  intervalMinutes: number | null;
}

export function glucoseDayStats(samples: GlucoseSample[], range: GlucoseRange, overnight: { startHour: number; endHour: number; hourOf: (t: string) => number } = { startHour: 0, endHour: 6, hourOf: (t) => new Date(t).getUTCHours() }): GlucoseDayStats {
  const sorted = [...samples].sort((a, b) => a.t.localeCompare(b.t));
  const values = sorted.map((s) => s.mgDl);
  if (values.length === 0) return { n: 0, mean: null, sd: null, cvPct: null, min: null, max: null, timeInRangePct: null, timeBelowPct: null, timeAbovePct: null, overnightMean: null, coverageHours: 0, intervalMinutes: null };
  const inRange = values.filter((v) => v >= range.lowMgDl && v <= range.highMgDl).length;
  const below = values.filter((v) => v < range.lowMgDl).length;
  const above = values.filter((v) => v > range.highMgDl).length;
  const overnightVals = sorted.filter((s) => {
    const h = overnight.hourOf(s.t);
    return h >= overnight.startHour && h < overnight.endHour;
  }).map((s) => s.mgDl);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push((new Date(sorted[i]!.t).getTime() - new Date(sorted[i - 1]!.t).getTime()) / 60_000);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: mean(values),
    sd: sd(values),
    cvPct: coefficientOfVariationPct(values),
    min: Math.min(...values),
    max: Math.max(...values),
    timeInRangePct: (inRange / values.length) * 100,
    timeBelowPct: (below / values.length) * 100,
    timeAbovePct: (above / values.length) * 100,
    overnightMean: overnightVals.length ? mean(overnightVals) : null,
    coverageHours: sorted.length > 1 ? (new Date(sorted[sorted.length - 1]!.t).getTime() - new Date(sorted[0]!.t).getTime()) / 3_600_000 : 0,
    intervalMinutes: sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)]! : null,
  };
}

export interface MealExcursion {
  mealAt: string;
  label: string;
  baselineMgDl: number | null;
  peakMgDl: number | null;
  peakDeltaMgDl: number | null;
  minutesToPeak: number | null;
  /** Incremental area above baseline over 2 h, mg/dL·min (trapezoid). */
  iAuc2h: number | null;
  samplesIn2h: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

/** Post-meal excursion: baseline = mean of samples in the 30 min before the meal (or the nearest prior sample). */
export function mealExcursion(samples: GlucoseSample[], meal: { at: string; label: string }): MealExcursion {
  const t0 = new Date(meal.at).getTime();
  const sorted = [...samples].sort((a, b) => a.t.localeCompare(b.t));
  const before = sorted.filter((s) => {
    const t = new Date(s.t).getTime();
    return t <= t0 && t >= t0 - 30 * 60_000;
  });
  let baseline = before.length ? mean(before.map((s) => s.mgDl)) : null;
  if (baseline === null) {
    const prior = sorted.filter((s) => new Date(s.t).getTime() <= t0);
    baseline = prior.length ? prior[prior.length - 1]!.mgDl : null;
  }
  const window = sorted.filter((s) => {
    const t = new Date(s.t).getTime();
    return t >= t0 && t <= t0 + 120 * 60_000;
  });
  if (baseline === null || window.length < 2) return { mealAt: meal.at, label: meal.label, baselineMgDl: baseline, peakMgDl: null, peakDeltaMgDl: null, minutesToPeak: null, iAuc2h: null, samplesIn2h: window.length, confidence: 'LOW' };
  let peak = window[0]!;
  for (const s of window) if (s.mgDl > peak.mgDl) peak = s;
  let auc = 0;
  for (let i = 1; i < window.length; i++) {
    const dt = (new Date(window[i]!.t).getTime() - new Date(window[i - 1]!.t).getTime()) / 60_000;
    const a = Math.max(0, window[i - 1]!.mgDl - baseline);
    const b = Math.max(0, window[i]!.mgDl - baseline);
    auc += ((a + b) / 2) * dt;
  }
  const confidence = window.length >= 7 ? 'HIGH' : window.length >= 4 ? 'MEDIUM' : 'LOW';
  return { mealAt: meal.at, label: meal.label, baselineMgDl: baseline, peakMgDl: peak.mgDl, peakDeltaMgDl: peak.mgDl - baseline, minutesToPeak: (new Date(peak.t).getTime() - t0) / 60_000, iAuc2h: Math.round(auc), samplesIn2h: window.length, confidence };
}

/** Groups excursions by normalised meal label for repeated-meal comparison. */
export function repeatedMeals(excursions: Array<MealExcursion & { day: string }>): Array<{ label: string; occurrences: number; meanPeakDelta: number | null; meanIAuc: number | null; days: string[] }> {
  const groups = new Map<string, Array<MealExcursion & { day: string }>>();
  for (const e of excursions) {
    if (e.peakDeltaMgDl === null) continue;
    const key = e.label.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([label, list]) => ({ label, occurrences: list.length, meanPeakDelta: mean(list.map((e) => e.peakDeltaMgDl!)), meanIAuc: mean(list.map((e) => e.iAuc2h ?? 0)), days: [...new Set(list.map((e) => e.day))] }))
    .sort((a, b) => b.occurrences - a.occurrences);
}
