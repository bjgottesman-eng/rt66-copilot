/**
 * Withings connector interface (contracts §6).
 *
 * Two implementations:
 * - {@link ../http.js WithingsHttp} — real API (endpoints per docs/integrations.md).
 * - {@link ../fake.js WithingsFake} — in-memory fixture server (demo mode + tests).
 *
 * Measure type codes (Withings measure/getmeas, verified 2026-08-29):
 *   9 = diastolic mmHg, 10 = systolic mmHg, 11 = pulse bpm.
 * Real value = value * 10^unit.
 *
 * `getMeasures` returns one PAGE of the underlying response (measuregrps plus
 * updatetime / timezone / more / offset) rather than the contract shorthand
 * `WithingsMeasureGroup[]`, because the §6 sync algorithm needs the
 * server-reported `updatetime` for the durable lastupdate cursor and the
 * response `timezone` for measured_tz; callers loop while `more` is true,
 * passing `offset` back — exactly the wire protocol.
 */

export interface WithingsTokens {
  /** Withings account id (`body.userid`); persisted on source_connection.external_user_id. */
  userid: string;
  accessToken: string;
  refreshToken: string;
  scope: string;
  /** Seconds until the access token expires (Withings: 10800 = 3 h). */
  expiresIn: number;
  tokenType: string;
}

export interface WithingsMeasure {
  value: number;
  type: number;
  unit: number;
}

export interface WithingsMeasureGroup {
  /** int64 stable id of the measurement group. */
  grpid: number;
  attrib: number;
  /** Measurement time (epoch seconds). */
  date: number;
  created: number;
  /** Last modification time; corrections re-deliver the same grpid with newer modified. */
  modified: number;
  category: number;
  deviceid: string | null;
  measures: WithingsMeasure[];
}

export interface WithingsGetMeasuresOpts {
  /** Incremental sync: return groups created/modified strictly after this epoch. */
  lastupdate?: number;
  /** Historical backfill window (epoch seconds), instead of lastupdate. */
  startdate?: number;
  enddate?: number;
  /** Paging: pass the previous page's `offset` while `more` was true. */
  offset?: number;
}

export interface WithingsGetMeasuresPage {
  /** Server-reported time; stored as the lastupdate cursor after a full drain. */
  updatetime: number;
  /** IANA timezone of the account (e.g. 'America/New_York'). */
  timezone: string | null;
  measuregrps: WithingsMeasureGroup[];
  /** True when another page must be fetched with `offset`. */
  more: boolean;
  offset: number;
}

export interface WithingsApi {
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<WithingsTokens>;
  /**
   * REFRESH TOKENS ROTATE ON EVERY CALL: the caller must persist the new
   * access+refresh pair atomically BEFORE using the new access token (the old
   * refresh token dies 8 h after rotation or on first use of the new access
   * token).
   */
  refresh(refreshToken: string): Promise<WithingsTokens>;
  getMeasures(accessToken: string, opts: WithingsGetMeasuresOpts): Promise<WithingsGetMeasuresPage>;
  subscribe(accessToken: string, callbackUrl: string, appli: number): Promise<void>;
}

/** Withings notification category for blood pressure & heart rate. */
export const WITHINGS_APPLI_BP = 4;

/** Withings envelope statuses this codebase branches on. */
export const WITHINGS_STATUS_OK = 0;
/** Invalid/expired access token -> refresh and retry once. */
export const WITHINGS_STATUS_INVALID_TOKEN = 343;
/** Too many requests. */
export const WITHINGS_STATUS_RATE_LIMITED = 601;

export class WithingsApiError extends Error {
  constructor(
    /** Withings envelope `status` (NOT the HTTP status; the envelope rides HTTP 200). */
    readonly withingsStatus: number,
    message: string,
    /** Machine code, e.g. 'invalid_token' | 'invalid_grant' | 'rate_limited'. */
    readonly code: string = 'withings_error',
  ) {
    super(message);
    this.name = 'WithingsApiError';
  }
}

export function isInvalidTokenError(err: unknown): boolean {
  return (
    err instanceof WithingsApiError &&
    (err.withingsStatus === WITHINGS_STATUS_INVALID_TOKEN || err.code === 'invalid_token')
  );
}

export function isInvalidGrantError(err: unknown): boolean {
  return err instanceof WithingsApiError && err.code === 'invalid_grant';
}
