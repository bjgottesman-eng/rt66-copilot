/**
 * Deduplication (contracts §4) — runs at normalization time; never deletes raw
 * rows, never silently merges. Evidence hierarchy:
 *
 * 1. same connector + same external_id (exact)           — raw level: enforced
 *    by raw_ingest_event's unique(connector, external_id, payload_hash) plus
 *    the normalizer's skipped_duplicate handling (src/ingest/normalize.ts).
 * 2. same connector + same external_group_id             — raw/normalized
 *    level: the normalizer upserts by (connection, grpid), which is also how
 *    corrections apply.
 * 3. same payload_hash                                   — raw level: same
 *    unique index (external_id NULL cases collapse on payload_hash alone).
 * 4. same metric + measured_at (exact) + values + source device → duplicate.
 * 5. cross-source: |Δ measured_at| ≤ 180 s AND systolic equal AND diastolic
 *    equal (integers after rounding) AND (pulse both null or |Δ| ≤ 5).
 * 6. user-confirmed (Phase 2 UI) — not implemented here.
 *
 * Rules 4–5 (this module) run against normalized readings. Canonical priority:
 * withings_api > apple_health > manual. The loser gets canonical=false,
 * duplicate_of=<winner>, dedup_reason=<rule>. If the higher-priority record
 * arrives AFTER the duplicate, canonicality is TRANSFERRED: the new row
 * becomes canonical and the older row is demoted (and its own duplicates are
 * re-pointed at the new canonical).
 */

import type { BpSource } from '@benhealth/shared';
import type { TxClient } from '../db.js';

export const SOURCE_PRIORITY: Record<BpSource, number> = {
  withings_api: 3,
  apple_health: 2,
  manual: 1,
};

export const DEDUP_RULE_SAME_TIME_VALUES_DEVICE = 'same_metric_time_values_device';
export const DEDUP_RULE_CROSS_SOURCE = 'cross_source_within_tolerance';

const CROSS_SOURCE_WINDOW_SECONDS = 180;
const PULSE_TOLERANCE = 5;

export interface CandidateReading {
  measuredAt: Date;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  source: BpSource;
  sourceDevice: string | null;
}

interface ExistingReading {
  id: string;
  measuredAt: Date;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  source: BpSource;
  sourceDevice: string | null;
  canonical: boolean;
  duplicateOf: string | null;
}

export interface DedupDecision {
  canonical: boolean;
  duplicateOf: string | null;
  dedupReason: string | null;
  /** Existing readings to demote because the candidate outranks them. */
  demote: Array<{ id: string; reason: string }>;
}

function matchRule(candidate: CandidateReading, existing: ExistingReading): string | null {
  const dtSeconds = Math.abs(candidate.measuredAt.getTime() - existing.measuredAt.getTime()) / 1000;

  // Rule 4: same metric + exact timestamp + values + source device.
  if (
    dtSeconds === 0 &&
    candidate.systolic === existing.systolic &&
    candidate.diastolic === existing.diastolic &&
    (candidate.pulse === null) === (existing.pulse === null) &&
    (candidate.pulse === null || candidate.pulse === existing.pulse) &&
    (candidate.sourceDevice ?? null) === (existing.sourceDevice ?? null)
  ) {
    return DEDUP_RULE_SAME_TIME_VALUES_DEVICE;
  }

  // Rule 5: cross-source within tolerance.
  if (
    candidate.source !== existing.source &&
    dtSeconds <= CROSS_SOURCE_WINDOW_SECONDS &&
    Math.round(candidate.systolic) === Math.round(existing.systolic) &&
    Math.round(candidate.diastolic) === Math.round(existing.diastolic) &&
    ((candidate.pulse === null && existing.pulse === null) ||
      (candidate.pulse !== null &&
        existing.pulse !== null &&
        Math.abs(candidate.pulse - existing.pulse) <= PULSE_TOLERANCE))
  ) {
    return DEDUP_RULE_CROSS_SOURCE;
  }

  return null;
}

function toNumber(v: string | number | null): number | null {
  return v === null ? null : Number(v);
}

/**
 * Decide the candidate's canonical status against existing readings, and which
 * existing readings must be demoted. Runs inside the caller's user-scoped
 * transaction (RLS already limits rows to the current user).
 */
export async function resolveDedup(
  client: TxClient,
  candidate: CandidateReading,
): Promise<DedupDecision> {
  const res = await client.query<{
    id: string;
    measured_at: Date;
    systolic_mmhg: string;
    diastolic_mmhg: string;
    pulse_bpm: string | null;
    source: BpSource;
    source_device: string | null;
    canonical: boolean;
    duplicate_of: string | null;
  }>(
    `select id, measured_at, systolic_mmhg, diastolic_mmhg, pulse_bpm, source,
            source_device, canonical, duplicate_of
       from blood_pressure_reading
      where deleted_at is null
        and measured_at between $1::timestamptz - interval '180 seconds'
                            and $1::timestamptz + interval '180 seconds'`,
    [candidate.measuredAt.toISOString()],
  );

  const matches: Array<{ reading: ExistingReading; reason: string }> = [];
  for (const row of res.rows) {
    const existing: ExistingReading = {
      id: row.id,
      measuredAt: row.measured_at,
      systolic: Number(row.systolic_mmhg),
      diastolic: Number(row.diastolic_mmhg),
      pulse: toNumber(row.pulse_bpm),
      source: row.source,
      sourceDevice: row.source_device,
      canonical: row.canonical,
      duplicateOf: row.duplicate_of,
    };
    const reason = matchRule(candidate, existing);
    if (reason !== null) matches.push({ reading: existing, reason });
  }

  if (matches.length === 0) {
    return { canonical: true, duplicateOf: null, dedupReason: null, demote: [] };
  }

  const candidatePriority = SOURCE_PRIORITY[candidate.source];
  const canonicalMatches = matches.filter((m) => m.reading.canonical);

  if (canonicalMatches.length === 0) {
    // Every match is already someone's duplicate; join the same cluster by
    // pointing at the first match's canonical root (or the match itself as a
    // fallback), never at another duplicate.
    const first = matches[0]!;
    return {
      canonical: false,
      duplicateOf: first.reading.duplicateOf ?? first.reading.id,
      dedupReason: first.reason,
      demote: [],
    };
  }

  const bestExisting = canonicalMatches.reduce((best, m) =>
    SOURCE_PRIORITY[m.reading.source] >= SOURCE_PRIORITY[best.reading.source] ? m : best,
  );

  if (SOURCE_PRIORITY[bestExisting.reading.source] >= candidatePriority) {
    // Existing canonical record wins (ties: first-arrived stays canonical).
    return {
      canonical: false,
      duplicateOf: bestExisting.reading.id,
      dedupReason: bestExisting.reason,
      demote: [],
    };
  }

  // Canonicality TRANSFER: the candidate outranks every canonical match.
  return {
    canonical: true,
    duplicateOf: null,
    dedupReason: null,
    demote: canonicalMatches.map((m) => ({ id: m.reading.id, reason: m.reason })),
  };
}

/**
 * Apply a transfer decision: demote the listed readings under the new
 * canonical reading and re-point any of their duplicates at it. Audit entries
 * carry ids and rules only — never BP values (audit details are pre-redacted
 * by construction).
 */
export async function applyDemotions(
  client: TxClient,
  userId: string,
  newCanonicalId: string,
  demote: Array<{ id: string; reason: string }>,
): Promise<void> {
  for (const d of demote) {
    await client.query(
      `update blood_pressure_reading
          set canonical = false, duplicate_of = $2, dedup_reason = $3
        where id = $1`,
      [d.id, newCanonicalId, d.reason],
    );
    // Duplicates of the demoted reading follow it to the new canonical root.
    await client.query(
      'update blood_pressure_reading set duplicate_of = $2 where duplicate_of = $1',
      [d.id, newCanonicalId],
    );
    await client.query(
      `insert into audit_log (user_id, actor, action, entity, entity_id, details)
       values ($1, 'platform.dedup', 'bp.dedup.canonical_transferred', 'blood_pressure_reading', $2,
               jsonb_build_object('demoted', $2::text, 'promoted', $3::text, 'rule', $4::text))`,
      [userId, d.id, newCanonicalId, d.reason],
    );
  }
}

/** Audit a "candidate recorded as duplicate" decision. */
export async function auditDuplicate(
  client: TxClient,
  userId: string,
  readingId: string,
  duplicateOf: string,
  rule: string,
): Promise<void> {
  await client.query(
    `insert into audit_log (user_id, actor, action, entity, entity_id, details)
     values ($1, 'platform.dedup', 'bp.dedup.duplicate', 'blood_pressure_reading', $2,
             jsonb_build_object('duplicateOf', $3::text, 'rule', $4::text))`,
    [userId, readingId, duplicateOf, rule],
  );
}
