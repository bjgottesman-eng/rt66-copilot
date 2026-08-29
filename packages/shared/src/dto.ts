/**
 * API DTOs for the Ben Health OS platform (`/api/v1`).
 *
 * Field names are NORMATIVE — they mirror docs/contracts/phase1-contracts.md §5
 * exactly. All timestamps are ISO-8601 UTC strings unless noted otherwise.
 */

import type {
  Arm,
  AveragingMethod,
  BodyPosition,
  BpSource,
  ConnectionStatus,
  FreshnessStatus,
  Provider,
} from './enums.js';

/** Standard API error envelope: `{ error: { code, message } }`. */
export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
  };
}

export interface BpReadingDto {
  id: string;
  /** ISO-8601 UTC measurement time. */
  measuredAt: string;
  /** IANA timezone the measurement was captured in, if known. */
  measuredTz: string | null;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  source: BpSource;
  sourceApp: string | null;
  sourceDevice: string | null;
  sessionId: string | null;
  arm: Arm;
  bodyPosition: BodyPosition;
  note: string | null;
  canonical: boolean;
  /** Id of the canonical reading this row duplicates, when canonical=false. */
  duplicateOf: string | null;
  /** ISO-8601 UTC ingestion time (raw event received_at / row created_at). */
  ingestedAt: string;
}

export interface BpSessionDto {
  id: string;
  startedAt: string;
  endedAt: string | null;
  readingCount: number;
  avgSystolic: number | null;
  avgDiastolic: number | null;
  avgPulse: number | null;
  averagingMethod: AveragingMethod;
  firstReadingExcluded: boolean;
  readings: BpReadingDto[];
}

/** Mean values shared by the summary's overall/morning/evening blocks. */
export interface BpMeansDto {
  meanSystolic: number | null;
  meanDiastolic: number | null;
  meanPulse: number | null;
}

export interface BpDailySummaryDto {
  /** Calendar date, `YYYY-MM-DD` (local to measured_tz, UTC fallback). */
  date: string;
  meanSystolic: number | null;
  meanDiastolic: number | null;
  sessionCount: number;
}

export interface BpSummaryDto {
  window: '7d' | '30d';
  from: string;
  to: string;
  readingCount: number;
  sessionCount: number;
  meanSystolic: number | null;
  meanDiastolic: number | null;
  meanPulse: number | null;
  /** Morning = 04:00–11:59 local (measured_tz or UTC fallback). */
  morning: BpMeansDto;
  /** Evening = 17:00–23:59 local (measured_tz or UTC fallback). */
  evening: BpMeansDto;
  daily: BpDailySummaryDto[];
}

export interface FreshnessDto {
  status: FreshnessStatus;
  latestMeasuredAt: string | null;
  lastSuccessAt: string | null;
  expectedLatencySeconds: number;
  /** now - latestMeasuredAt in whole seconds; null when there is no data. */
  ageSeconds: number | null;
}

export interface SourceStatusDto {
  provider: Provider;
  displayName: string;
  connectionStatus: ConnectionStatus;
  freshness: FreshnessDto;
  latestMeasuredAt: string | null;
  lastSyncAt: string | null;
  coverageNote: string | null;
  problems: string[];
}

export interface ManualBpEntry {
  systolic: number;
  diastolic: number;
  pulse?: number | null;
  measuredAt: string;
  measuredTz?: string | null;
  arm?: Arm;
  bodyPosition?: BodyPosition;
  seatedRestMinutes?: number | null;
  readingNumberInSession?: number | null;
  note?: string | null;
  /** Echoed back for iOS to act on; the server just stores the reading. */
  saveToAppleHealth?: boolean;
}

export interface HealthKitBpSample {
  /** HealthKit correlation UUID. */
  hkUuid: string;
  measuredAt: string;
  measuredTz?: string | null;
  systolic: number;
  diastolic: number;
  pulse?: number | null;
  sourceApp: string;
  sourceDevice: string;
  sourceBundleId: string;
}

export interface HealthKitBpBatch {
  deviceAnchor?: string;
  samples: HealthKitBpSample[];
}
