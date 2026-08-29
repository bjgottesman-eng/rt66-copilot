/**
 * Freshness model — docs/contracts/phase1-contracts.md §3 (NORMATIVE).
 *
 * ```
 * if connectionStatus == 'not_connected'            -> NOT_CONNECTED
 * if connectionStatus == 'revoked'                  -> NOT_CONNECTED  (user disconnected; UI offers Connect)
 * if connectionStatus == 'error'                    -> SYNC_ERROR
 * if latestMeasuredAt == null                       -> INSUFFICIENT_DATA
 * age = now - latestMeasuredAt
 * if age <= max(2 * expectedLatency, 15 min)        -> CURRENT
 * if age <= 24 h                                    -> RECENT
 * if age <= 72 h and (now - lastSuccessAt) <= 6 h   -> DELAYED_BY_SOURCE
 * else                                              -> STALE
 * ```
 *
 * Pure function; `now` is an explicit input so the algorithm is fully
 * deterministic and table-testable. The word "LIVE" is forbidden in UI copy.
 */

import type { FreshnessDto } from './dto.js';
import type { ConnectionStatus, FreshnessStatus } from './enums.js';

export interface FreshnessInput {
  connectionStatus: ConnectionStatus;
  /** Last time the connector successfully synced, if ever. */
  lastSuccessAt: Date | null;
  /** Measurement time of the newest observation, if any. */
  latestMeasuredAt: Date | null;
  /** Expected source latency in seconds (source_connection.expected_latency_seconds). */
  expectedLatencySeconds: number;
  /** Evaluation instant. */
  now: Date;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function computeStatus(input: FreshnessInput): FreshnessStatus {
  const { connectionStatus, lastSuccessAt, latestMeasuredAt, expectedLatencySeconds, now } = input;

  if (connectionStatus === 'not_connected' || connectionStatus === 'revoked') {
    // revoked = the user disconnected the source; the UI offers Connect again
    return 'NOT_CONNECTED';
  }
  if (connectionStatus === 'error') return 'SYNC_ERROR';
  if (latestMeasuredAt === null) return 'INSUFFICIENT_DATA';

  // Comparisons are done at millisecond precision so boundary values
  // (age exactly equal to a threshold) resolve per the contract's `<=`.
  const ageMs = now.getTime() - latestMeasuredAt.getTime();
  const currentThresholdMs = Math.max(2 * expectedLatencySeconds * 1000, FIFTEEN_MINUTES_MS);

  if (ageMs <= currentThresholdMs) return 'CURRENT';
  if (ageMs <= TWENTY_FOUR_HOURS_MS) return 'RECENT';
  if (
    ageMs <= SEVENTY_TWO_HOURS_MS &&
    lastSuccessAt !== null &&
    now.getTime() - lastSuccessAt.getTime() <= SIX_HOURS_MS
  ) {
    // Connector is fine, the source itself is quiet.
    return 'DELAYED_BY_SOURCE';
  }
  return 'STALE';
}

/**
 * Compute the freshness status + DTO for a source/metric.
 *
 * `ageSeconds` is reported (floored to whole seconds) whenever
 * `latestMeasuredAt` is known, regardless of status, so UI can always show
 * "measured N ago" alongside NOT_CONNECTED / SYNC_ERROR states.
 */
export function computeFreshness(input: FreshnessInput): FreshnessDto {
  const { lastSuccessAt, latestMeasuredAt, expectedLatencySeconds, now } = input;

  const ageSeconds =
    latestMeasuredAt === null
      ? null
      : Math.floor((now.getTime() - latestMeasuredAt.getTime()) / 1000);

  return {
    status: computeStatus(input),
    latestMeasuredAt: latestMeasuredAt === null ? null : latestMeasuredAt.toISOString(),
    lastSuccessAt: lastSuccessAt === null ? null : lastSuccessAt.toISOString(),
    expectedLatencySeconds,
    ageSeconds,
  };
}
