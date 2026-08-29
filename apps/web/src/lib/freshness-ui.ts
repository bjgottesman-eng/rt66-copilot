/**
 * Freshness pill presentation mapping. The pill LABEL is always the exact
 * FreshnessStatus enum string (contracts §3 — status vocabulary is exact);
 * only the tone (color treatment) and the explanation sentence vary.
 * The word "live" is forbidden in all UI copy.
 */

import type { FreshnessDto, FreshnessStatus } from '@benhealth/shared';
import { relativeAgeFromSeconds } from './format';

export type PillTone = 'good' | 'neutral' | 'warn' | 'error' | 'muted';

/** CURRENT=quiet green, RECENT=neutral, delayed/stale=muted amber, sync error=muted red, rest=gray. */
export function freshnessTone(status: FreshnessStatus): PillTone {
  switch (status) {
    case 'CURRENT':
      return 'good';
    case 'RECENT':
      return 'neutral';
    case 'DELAYED_BY_SOURCE':
    case 'STALE':
      return 'warn';
    case 'SYNC_ERROR':
      return 'error';
    case 'NOT_CONNECTED':
    case 'INSUFFICIENT_DATA':
      return 'muted';
  }
}

/**
 * One-sentence explanation of a freshness status ("every status must be
 * explainable" — CLAUDE.md). Never invents data; uses only DTO fields.
 */
export function freshnessExplanation(f: FreshnessDto): string {
  const age = f.ageSeconds === null ? null : relativeAgeFromSeconds(f.ageSeconds);
  switch (f.status) {
    case 'CURRENT':
      return age === null ? 'Data is up to date.' : `Newest measurement ${age} — within the expected sync window.`;
    case 'RECENT':
      return age === null ? 'Newest measurement is under a day old.' : `Newest measurement ${age} — less than 24 hours old.`;
    case 'DELAYED_BY_SOURCE':
      return 'The connection is syncing fine, but the source has not produced new measurements recently.';
    case 'STALE':
      return age === null
        ? 'No recent measurements.'
        : `Newest measurement ${age} — older than expected.`;
    case 'SYNC_ERROR':
      return 'The last sync attempt failed; data may be missing until it recovers.';
    case 'NOT_CONNECTED':
      return 'This source is not connected.';
    case 'INSUFFICIENT_DATA':
      return 'Connected, but no measurements have been ingested yet.';
  }
}
