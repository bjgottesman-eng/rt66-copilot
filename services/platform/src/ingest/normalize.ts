/**
 * Normalization: raw ingest events (Layer 1, immutable) → blood pressure
 * readings (Layer 2), with dedup applied at normalization time.
 *
 * Invariants (CLAUDE.md rules 2–3):
 * - every observation is backed by a raw_ingest_event row; raw rows are never
 *   mutated except processing_state / processed_at / error;
 * - duplicates are marked and linked, never merged or deleted;
 * - missing values (absent pulse) stay NULL — NEVER coerced to zero.
 *
 * Withings corrections: the same grpid re-delivered with a newer `modified`
 * produces a NEW raw event row and an UPDATE of the existing normalized
 * reading's values, with an audit_log entry 'bp.corrected'.
 */

import { createHash } from 'node:crypto';
import type { HealthKitBpBatch, HealthKitBpSample, ManualBpEntry } from '@benhealth/shared';
import { ARMS, BODY_POSITIONS } from '@benhealth/shared';
import type { WithingsMeasureGroup } from '../connectors/withings/api.js';
import { applyDemotions, auditDuplicate, resolveDedup, type CandidateReading } from '../dedup/index.js';
import type { TxClient } from '../db.js';

export const PARSER_VERSION = 1;

/** Prefix marking HealthKit samples that are our own write-backs (skip re-import). */
export const BENHEALTH_SYNC_IDENTIFIER_PREFIX = 'benhealthos.';

// Withings measure type codes (verified 2026-08-29): 10=systolic, 9=diastolic, 11=pulse.
const TYPE_SYSTOLIC = 10;
const TYPE_DIASTOLIC = 9;
const TYPE_PULSE = 11;

/** Stable JSON with recursively sorted object keys, for payload hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Decode a Withings measure: real value = value * 10^unit
 * (e.g. value=1215, unit=-1 → 121.5). Rounded to 1 decimal to match the
 * numeric(5,1) storage.
 */
export function decodeWithingsValue(value: number, unit: number): number {
  return Math.round(value * Math.pow(10, unit) * 10) / 10;
}

export interface IngestContext {
  userId: string;
  connectionId: string | null;
}

interface RawInsert {
  connectionId: string | null;
  connector: 'withings' | 'apple_health' | 'manual';
  externalId: string | null;
  sourceDeviceId: string | null;
  eventType: string;
  payload: unknown;
  sourceModifiedAt: Date | null;
}

/**
 * Insert a raw event; returns its id, or null when the exact
 * (connector, external_id, payload_hash) row already exists (idempotent
 * re-delivery — dedup rules 1/3 at the raw level).
 */
async function insertRawEvent(
  client: TxClient,
  userId: string,
  raw: RawInsert,
): Promise<{ id: string; payloadHash: string } | { id: null; payloadHash: string }> {
  const payloadJson = canonicalJson(raw.payload);
  const payloadHash = sha256Hex(payloadJson);
  const res = await client.query<{ id: string }>(
    `insert into raw_ingest_event
       (user_id, connection_id, connector, external_id, source_device_id, event_type,
        payload, payload_hash, source_modified_at, parser_version)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
     on conflict (connector, coalesce(external_id, ''), payload_hash) do nothing
     returning id`,
    [
      userId,
      raw.connectionId,
      raw.connector,
      raw.externalId === '' ? null : raw.externalId,
      raw.sourceDeviceId,
      raw.eventType,
      payloadJson,
      payloadHash,
      raw.sourceModifiedAt,
      PARSER_VERSION,
    ],
  );
  const row = res.rows[0];
  return row === undefined ? { id: null, payloadHash } : { id: row.id, payloadHash };
}

async function setRawState(
  client: TxClient,
  rawEventId: string,
  state: 'processed' | 'failed' | 'skipped_duplicate',
  error: string | null = null,
): Promise<void> {
  await client.query(
    `update raw_ingest_event
        set processing_state = $2, processed_at = now(), error = $3
      where id = $1`,
    [rawEventId, state, error],
  );
}

interface ReadingInsert extends CandidateReading {
  rawEventId: string | null;
  measuredTz: string | null;
  sourceApp: string | null;
  externalGroupId: string | null;
  arm: string;
  bodyPosition: string;
  seatedRestMinutes: number | null;
  readingNumberInSession: number | null;
  note: string | null;
}

/**
 * Run dedup rules 4–5, insert the reading with its canonical verdict, apply
 * canonicality transfers, and write the dedup audit trail.
 */
async function insertReadingWithDedup(
  client: TxClient,
  userId: string,
  reading: ReadingInsert,
): Promise<{ id: string; canonical: boolean }> {
  const decision = await resolveDedup(client, reading);
  const res = await client.query<{ id: string }>(
    `insert into blood_pressure_reading
       (user_id, raw_event_id, measured_at, measured_tz, systolic_mmhg, diastolic_mmhg,
        pulse_bpm, source, source_app, source_device, external_group_id, arm, body_position,
        seated_rest_minutes, reading_number_in_session, note, canonical, duplicate_of,
        dedup_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::arm, $13::body_position,
             $14, $15, $16, $17, $18, $19)
     returning id`,
    [
      userId,
      reading.rawEventId,
      reading.measuredAt,
      reading.measuredTz,
      reading.systolic,
      reading.diastolic,
      reading.pulse,
      reading.source,
      reading.sourceApp,
      reading.sourceDevice,
      reading.externalGroupId,
      reading.arm,
      reading.bodyPosition,
      reading.seatedRestMinutes,
      reading.readingNumberInSession,
      reading.note,
      decision.canonical,
      decision.duplicateOf,
      decision.dedupReason,
    ],
  );
  const id = res.rows[0]!.id;
  if (decision.canonical) {
    await applyDemotions(client, userId, id, decision.demote);
  } else if (decision.duplicateOf !== null) {
    await auditDuplicate(client, userId, id, decision.duplicateOf, decision.dedupReason ?? '');
  }
  return { id, canonical: decision.canonical };
}

export interface WithingsIngestCounts {
  inserted: number;
  corrected: number;
  /** Exact raw-level duplicates (same grpid + payload) — idempotent skips. */
  rawDuplicates: number;
  /** Same grpid re-delivered without a newer modified, or unusable groups. */
  skipped: number;
}

/** Extract systolic/diastolic/pulse from a Withings measure group. */
export function decodeWithingsGroup(group: WithingsMeasureGroup): {
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
} {
  let systolic: number | null = null;
  let diastolic: number | null = null;
  let pulse: number | null = null;
  for (const m of group.measures) {
    const value = decodeWithingsValue(m.value, m.unit);
    if (m.type === TYPE_SYSTOLIC) systolic = value;
    else if (m.type === TYPE_DIASTOLIC) diastolic = value;
    else if (m.type === TYPE_PULSE) pulse = value;
  }
  // Absent pulse stays null — NEVER defaulted to zero.
  return { systolic, diastolic, pulse };
}

/**
 * Ingest Withings measure groups (event_type 'withings.getmeas.group',
 * external_id = String(grpid)). Corrections (same grpid, newer modified)
 * update the existing normalized reading and audit 'bp.corrected'.
 */
export async function ingestWithingsGroups(
  client: TxClient,
  ctx: IngestContext,
  groups: WithingsMeasureGroup[],
  timezone: string | null,
): Promise<WithingsIngestCounts> {
  const counts: WithingsIngestCounts = { inserted: 0, corrected: 0, rawDuplicates: 0, skipped: 0 };

  for (const group of groups) {
    const raw = await insertRawEvent(client, ctx.userId, {
      connectionId: ctx.connectionId,
      connector: 'withings',
      externalId: String(group.grpid),
      sourceDeviceId: group.deviceid,
      eventType: 'withings.getmeas.group',
      payload: group,
      sourceModifiedAt: new Date(group.modified * 1000),
    });
    if (raw.id === null) {
      counts.rawDuplicates += 1;
      continue;
    }

    const { systolic, diastolic, pulse } = decodeWithingsGroup(group);
    if (systolic === null || diastolic === null) {
      await setRawState(client, raw.id, 'failed', 'group missing systolic or diastolic measure');
      counts.skipped += 1;
      continue;
    }

    const existing = await client.query<{ id: string; source_modified_at: Date | null }>(
      `select r.id, e.source_modified_at
         from blood_pressure_reading r
         left join raw_ingest_event e on e.id = r.raw_event_id
        where r.source = 'withings_api' and r.external_group_id = $1`,
      [String(group.grpid)],
    );
    const existingRow = existing.rows[0];

    if (existingRow !== undefined) {
      const prevModified = existingRow.source_modified_at?.getTime() ?? 0;
      if (group.modified * 1000 > prevModified) {
        // Correction: same grpid, newer modified → update the normalized
        // reading in place (raw history keeps both versions).
        await client.query(
          `update blood_pressure_reading
              set raw_event_id = $2, measured_at = $3, measured_tz = $4, systolic_mmhg = $5,
                  diastolic_mmhg = $6, pulse_bpm = $7, source_device = $8
            where id = $1`,
          [
            existingRow.id,
            raw.id,
            new Date(group.date * 1000),
            timezone,
            systolic,
            diastolic,
            pulse,
            group.deviceid,
          ],
        );
        await client.query(
          `insert into audit_log (user_id, actor, action, entity, entity_id, details)
           values ($1, 'platform.ingest', 'bp.corrected', 'blood_pressure_reading', $2,
                   jsonb_build_object('grpid', $3::text, 'rawEventId', $4::text))`,
          [ctx.userId, existingRow.id, String(group.grpid), raw.id],
        );
        await setRawState(client, raw.id, 'processed');
        counts.corrected += 1;
      } else {
        // Rule 1/2: same grpid re-delivered without newer content.
        await setRawState(client, raw.id, 'skipped_duplicate');
        counts.skipped += 1;
      }
      continue;
    }

    await insertReadingWithDedup(client, ctx.userId, {
      rawEventId: raw.id,
      measuredAt: new Date(group.date * 1000),
      measuredTz: timezone,
      systolic,
      diastolic,
      pulse,
      source: 'withings_api',
      sourceApp: null,
      sourceDevice: group.deviceid,
      externalGroupId: String(group.grpid),
      arm: 'unknown',
      bodyPosition: 'unknown',
      seatedRestMinutes: null,
      readingNumberInSession: null,
      note: null,
    });
    await setRawState(client, raw.id, 'processed');
    counts.inserted += 1;
  }

  return counts;
}

export interface HealthKitIngestCounts {
  accepted: number;
  duplicates: number;
  deleted: number;
}

/**
 * Ingest a HealthKit BP batch (event_type 'healthkit.bp_correlation',
 * external_id = hkUuid, source 'apple_health'). Samples whose syncIdentifier
 * starts with 'benhealthos.' are our own write-backs and are skipped.
 * `deletedHkUuids` soft-delete previously ingested samples.
 */
export async function ingestHealthKitBatch(
  client: TxClient,
  ctx: IngestContext,
  batch: HealthKitBpBatch,
): Promise<HealthKitIngestCounts> {
  const counts: HealthKitIngestCounts = { accepted: 0, duplicates: 0, deleted: 0 };

  for (const sample of batch.samples) {
    if (isOwnWriteBack(sample)) {
      counts.duplicates += 1; // our own data, already present upstream
      continue;
    }
    const raw = await insertRawEvent(client, ctx.userId, {
      connectionId: ctx.connectionId,
      connector: 'apple_health',
      externalId: sample.hkUuid,
      sourceDeviceId: sample.sourceDevice,
      eventType: 'healthkit.bp_correlation',
      payload: sample,
      sourceModifiedAt: null,
    });
    if (raw.id === null) {
      counts.duplicates += 1;
      continue;
    }

    const existing = await client.query<{ id: string }>(
      `select id from blood_pressure_reading
        where source = 'apple_health' and external_group_id = $1`,
      [sample.hkUuid],
    );
    if (existing.rows.length > 0) {
      // HealthKit samples are immutable; a changed payload for the same UUID
      // is a re-delivery, not a correction.
      await setRawState(client, raw.id, 'skipped_duplicate');
      counts.duplicates += 1;
      continue;
    }

    const result = await insertReadingWithDedup(client, ctx.userId, {
      rawEventId: raw.id,
      measuredAt: new Date(sample.measuredAt),
      measuredTz: sample.measuredTz ?? null,
      systolic: sample.systolic,
      diastolic: sample.diastolic,
      pulse: sample.pulse ?? null,
      source: 'apple_health',
      sourceApp: sample.sourceApp,
      sourceDevice: sample.sourceDevice,
      externalGroupId: sample.hkUuid,
      arm: 'unknown',
      bodyPosition: 'unknown',
      seatedRestMinutes: null,
      readingNumberInSession: null,
      note: null,
    });
    await setRawState(client, raw.id, 'processed');
    counts.accepted += 1;
    if (!result.canonical) counts.duplicates += 1;
  }

  for (const hkUuid of batch.deletedHkUuids ?? []) {
    const raw = await insertRawEvent(client, ctx.userId, {
      connectionId: ctx.connectionId,
      connector: 'apple_health',
      externalId: hkUuid,
      sourceDeviceId: null,
      eventType: 'healthkit.bp_deleted',
      payload: { hkUuid, deleted: true },
      sourceModifiedAt: null,
    });
    const res = await client.query<{ id: string }>(
      `update blood_pressure_reading
          set deleted_at = now()
        where source = 'apple_health' and external_group_id = $1 and deleted_at is null
        returning id`,
      [hkUuid],
    );
    const deletedRow = res.rows[0];
    if (deletedRow !== undefined) {
      await client.query(
        `insert into audit_log (user_id, actor, action, entity, entity_id, details)
         values ($1, 'platform.ingest', 'bp.deleted', 'blood_pressure_reading', $2,
                 jsonb_build_object('hkUuid', $3::text, 'kind', 'soft_delete'))`,
        [ctx.userId, deletedRow.id, hkUuid],
      );
      counts.deleted += 1;
    }
    if (raw.id !== null) await setRawState(client, raw.id, 'processed');
  }

  return counts;
}

function isOwnWriteBack(sample: HealthKitBpSample): boolean {
  return sample.syncIdentifier?.startsWith(BENHEALTH_SYNC_IDENTIFIER_PREFIX) === true;
}

export interface ManualIngestResult {
  readingId: string;
  created: boolean;
}

/** Validation error message (no values echoed — they are health data). */
export function validateManualEntry(entry: ManualBpEntry): string | null {
  if (typeof entry.systolic !== 'number' || entry.systolic < 40 || entry.systolic > 300)
    return 'systolic must be a number between 40 and 300';
  if (typeof entry.diastolic !== 'number' || entry.diastolic < 20 || entry.diastolic > 200)
    return 'diastolic must be a number between 20 and 200';
  if (
    entry.pulse !== undefined &&
    entry.pulse !== null &&
    (typeof entry.pulse !== 'number' || entry.pulse < 20 || entry.pulse > 250)
  )
    return 'pulse must be null or a number between 20 and 250';
  if (typeof entry.measuredAt !== 'string' || Number.isNaN(Date.parse(entry.measuredAt)))
    return 'measuredAt must be an ISO-8601 timestamp';
  if (entry.arm !== undefined && !ARMS.includes(entry.arm)) return 'arm is invalid';
  if (entry.bodyPosition !== undefined && !BODY_POSITIONS.includes(entry.bodyPosition))
    return 'bodyPosition is invalid';
  return null;
}

/**
 * Ingest a manual entry (event_type 'manual.bp', no external id — the payload
 * hash alone deduplicates exact re-submissions).
 */
export async function ingestManualEntry(
  client: TxClient,
  ctx: IngestContext,
  entry: ManualBpEntry,
): Promise<ManualIngestResult> {
  const raw = await insertRawEvent(client, ctx.userId, {
    connectionId: null,
    connector: 'manual',
    externalId: null,
    sourceDeviceId: null,
    eventType: 'manual.bp',
    payload: entry,
    sourceModifiedAt: null,
  });

  if (raw.id === null) {
    // Exact same entry already ingested: return its reading (idempotent).
    const existing = await client.query<{ id: string }>(
      `select r.id
         from blood_pressure_reading r
         join raw_ingest_event e on e.id = r.raw_event_id
        where e.connector = 'manual' and e.payload_hash = $1`,
      [raw.payloadHash],
    );
    const row = existing.rows[0];
    if (row !== undefined) return { readingId: row.id, created: false };
    throw new Error('duplicate manual raw event has no normalized reading');
  }

  const result = await insertReadingWithDedup(client, ctx.userId, {
    rawEventId: raw.id,
    measuredAt: new Date(entry.measuredAt),
    measuredTz: entry.measuredTz ?? null,
    systolic: Math.round(entry.systolic * 10) / 10,
    diastolic: Math.round(entry.diastolic * 10) / 10,
    pulse: entry.pulse ?? null,
    source: 'manual',
    sourceApp: null,
    sourceDevice: null,
    externalGroupId: null,
    arm: entry.arm ?? 'unknown',
    bodyPosition: entry.bodyPosition ?? 'unknown',
    seatedRestMinutes: entry.seatedRestMinutes ?? null,
    readingNumberInSession: entry.readingNumberInSession ?? null,
    note: entry.note ?? null,
  });
  await setRawState(client, raw.id, 'processed');
  return { readingId: result.id, created: true };
}
