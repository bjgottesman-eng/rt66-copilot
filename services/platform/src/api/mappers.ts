/**
 * DB row → contract DTO mappers, plus the freshness wiring
 * (@benhealth/shared computeFreshness fed from source_connection rows).
 */

import {
  computeFreshness,
  type Arm,
  type BodyPosition,
  type BpReadingDto,
  type BpSource,
  type ConnectionStatus,
  type FreshnessDto,
} from '@benhealth/shared';

export interface BpReadingRow {
  id: string;
  measured_at: Date;
  measured_tz: string | null;
  systolic_mmhg: string;
  diastolic_mmhg: string;
  pulse_bpm: string | null;
  source: BpSource;
  source_app: string | null;
  source_device: string | null;
  session_id: string | null;
  arm: Arm | null;
  body_position: BodyPosition | null;
  note: string | null;
  canonical: boolean;
  duplicate_of: string | null;
  created_at: Date;
}

export const BP_READING_COLUMNS = `
  id, measured_at, measured_tz, systolic_mmhg, diastolic_mmhg, pulse_bpm, source,
  source_app, source_device, session_id, arm, body_position, note, canonical,
  duplicate_of, created_at`;

export function toReadingDto(row: BpReadingRow): BpReadingDto {
  return {
    id: row.id,
    measuredAt: row.measured_at.toISOString(),
    measuredTz: row.measured_tz,
    systolic: Number(row.systolic_mmhg),
    diastolic: Number(row.diastolic_mmhg),
    pulse: row.pulse_bpm === null ? null : Number(row.pulse_bpm),
    source: row.source,
    sourceApp: row.source_app,
    sourceDevice: row.source_device,
    sessionId: row.session_id,
    arm: row.arm ?? 'unknown',
    bodyPosition: row.body_position ?? 'unknown',
    note: row.note,
    canonical: row.canonical,
    duplicateOf: row.duplicate_of,
    ingestedAt: row.created_at.toISOString(),
  };
}

export interface ConnectionFreshnessRow {
  status: ConnectionStatus;
  last_success_at: Date | null;
  expected_latency_seconds: number;
}

/** Default expected source latency (source_connection default; Withings: 300 s). */
export const DEFAULT_EXPECTED_LATENCY_SECONDS = 300;

/** Wire a connection row + newest observation into the shared freshness model. */
export function freshnessFor(
  conn: ConnectionFreshnessRow | null,
  latestMeasuredAt: Date | null,
  now: Date,
): FreshnessDto {
  return computeFreshness({
    connectionStatus: conn?.status ?? 'not_connected',
    lastSuccessAt: conn?.last_success_at ?? null,
    latestMeasuredAt,
    expectedLatencySeconds: conn?.expected_latency_seconds ?? DEFAULT_EXPECTED_LATENCY_SECONDS,
    now,
  });
}
