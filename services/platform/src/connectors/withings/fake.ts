/**
 * WithingsFake — in-memory fixture server implementing {@link WithingsApi}.
 *
 * Used in demo mode and tests. Serves the synthetic demo persona
 * (fixtures/demo-persona) with real Withings semantics:
 * - `lastupdate` returns groups whose `modified` is strictly newer;
 * - `startdate`/`enddate` filter on the measurement `date`;
 * - pages of {@link PAGE_SIZE} groups with `more`/`offset`;
 * - `updatetime` is the max `modified` of the currently visible data set
 *   (deterministic stand-in for the real server clock — the §6 cursor rule
 *   `max(updatetime, group modified times)` works identically either way);
 * - refresh tokens ROTATE: a rotated-away or unknown refresh token throws
 *   `invalid_grant`, mirroring the real API's hard failure;
 * - an expired/foreign access token fails with envelope status 343 so the
 *   service's refresh-and-retry path is exercised for real.
 *
 * Corrections: base groups are served as-is until {@link applyCorrections} is
 * called, after which the corrected group (same grpid, newer `modified`,
 * changed values) replaces its base version — used by the correction tests and
 * the demo seed flow.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WITHINGS_STATUS_INVALID_TOKEN,
  WithingsApiError,
  type WithingsApi,
  type WithingsGetMeasuresOpts,
  type WithingsGetMeasuresPage,
  type WithingsMeasureGroup,
  type WithingsTokens,
} from './api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Resolves for both src/ (tsx) and dist/ (compiled) execution — same depth. */
export const DEFAULT_FIXTURES_DIR = path.resolve(HERE, '../../../../..', 'fixtures/demo-persona');

const PAGE_SIZE = 100;

interface FixtureFile {
  user: string;
  timezone: string;
  groups: WithingsMeasureGroup[];
}

export interface FakeSubscription {
  callbackUrl: string;
  appli: number;
}

export class WithingsFake implements WithingsApi {
  readonly externalUserId = 'demo-withings-user';
  readonly timezone: string;

  /** Diagnostics for tests. */
  rotationCount = 0;
  getMeasuresCalls = 0;
  readonly subscriptions: FakeSubscription[] = [];
  readonly deadRefreshTokens = new Set<string>();

  private readonly baseGroups: WithingsMeasureGroup[];
  private readonly correctionGroups: WithingsMeasureGroup[];
  private extraGroups: WithingsMeasureGroup[] = [];
  private correctionsApplied = false;

  private tokenSeq = 0;
  private currentAccessToken: string | null = null;
  private currentRefreshToken: string | null = null;
  private accessExpired = false;
  private refreshRevoked = false;

  constructor(fixturesDir: string = DEFAULT_FIXTURES_DIR) {
    const base = JSON.parse(
      readFileSync(path.join(fixturesDir, 'bp-withings.json'), 'utf8'),
    ) as FixtureFile;
    const corrections = JSON.parse(
      readFileSync(path.join(fixturesDir, 'bp-withings-corrections.json'), 'utf8'),
    ) as FixtureFile;
    this.baseGroups = base.groups;
    this.correctionGroups = corrections.groups;
    this.timezone = base.timezone;
  }

  /** Restore pristine fixture state (demo re-seed). */
  reset(): void {
    this.extraGroups = [];
    this.correctionsApplied = false;
    this.tokenSeq = 0;
    this.currentAccessToken = null;
    this.currentRefreshToken = null;
    this.accessExpired = false;
    this.refreshRevoked = false;
    this.rotationCount = 0;
    this.getMeasuresCalls = 0;
    this.subscriptions.length = 0;
    this.deadRefreshTokens.clear();
  }

  /** Serve the corrected group(s) (same grpid, newer modified) from now on. */
  applyCorrections(): void {
    this.correctionsApplied = true;
  }

  /** Test hook: new measurement arriving after the initial import. */
  injectGroup(group: WithingsMeasureGroup): void {
    this.extraGroups.push(group);
  }

  /** Test hook: force the 343 invalid-token path on the next data call. */
  expireAccessToken(): void {
    this.accessExpired = true;
  }

  /** Test hook: make every refresh fail with invalid_grant (revoked access). */
  revokeRefreshTokens(): void {
    this.refreshRevoked = true;
  }

  maxVisibleModified(): number {
    return this.visibleGroups().reduce((m, g) => Math.max(m, g.modified), 0);
  }

  private visibleGroups(): WithingsMeasureGroup[] {
    const byId = new Map<number, WithingsMeasureGroup>();
    for (const g of this.baseGroups) byId.set(g.grpid, g);
    if (this.correctionsApplied) {
      for (const g of this.correctionGroups) byId.set(g.grpid, g);
    }
    for (const g of this.extraGroups) byId.set(g.grpid, g);
    return [...byId.values()];
  }

  private issueTokens(): WithingsTokens {
    if (this.currentRefreshToken !== null) this.deadRefreshTokens.add(this.currentRefreshToken);
    this.tokenSeq += 1;
    this.currentAccessToken = `fake-access-${this.tokenSeq}`;
    this.currentRefreshToken = `fake-refresh-${this.tokenSeq}`;
    this.accessExpired = false;
    return {
      userid: this.externalUserId,
      accessToken: this.currentAccessToken,
      refreshToken: this.currentRefreshToken,
      scope: 'user.metrics',
      expiresIn: 10800,
      tokenType: 'Bearer',
    };
  }

  authorizeUrl(state: string): string {
    const url = new URL('https://account.withings.com/oauth2_user/authorize2');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'demo-withings-client-id');
    url.searchParams.set('scope', 'user.metrics');
    url.searchParams.set('redirect_uri', 'fake://callback');
    url.searchParams.set('state', state);
    url.searchParams.set('mode', 'demo');
    return url.toString();
  }

  async exchangeCode(_code: string): Promise<WithingsTokens> {
    return this.issueTokens();
  }

  async refresh(refreshToken: string): Promise<WithingsTokens> {
    if (this.refreshRevoked || refreshToken !== this.currentRefreshToken) {
      throw new WithingsApiError(503, 'Withings refresh failed (invalid_grant)', 'invalid_grant');
    }
    this.rotationCount += 1;
    return this.issueTokens();
  }

  private assertAccess(accessToken: string): void {
    if (this.accessExpired || accessToken !== this.currentAccessToken) {
      throw new WithingsApiError(
        WITHINGS_STATUS_INVALID_TOKEN,
        'Withings call failed (status 343)',
        'invalid_token',
      );
    }
  }

  async getMeasures(
    accessToken: string,
    opts: WithingsGetMeasuresOpts,
  ): Promise<WithingsGetMeasuresPage> {
    this.assertAccess(accessToken);
    this.getMeasuresCalls += 1;

    let groups = this.visibleGroups();
    if (opts.lastupdate !== undefined) {
      const lastupdate = opts.lastupdate;
      groups = groups.filter((g) => g.modified > lastupdate);
    }
    if (opts.startdate !== undefined) {
      const startdate = opts.startdate;
      groups = groups.filter((g) => g.date >= startdate);
    }
    if (opts.enddate !== undefined) {
      const enddate = opts.enddate;
      groups = groups.filter((g) => g.date <= enddate);
    }
    groups.sort((a, b) => a.date - b.date || a.grpid - b.grpid);

    const offset = opts.offset ?? 0;
    const page = groups.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + page.length;
    return {
      updatetime: this.maxVisibleModified(),
      timezone: this.timezone,
      measuregrps: page,
      more: nextOffset < groups.length,
      offset: nextOffset,
    };
  }

  async subscribe(accessToken: string, callbackUrl: string, appli: number): Promise<void> {
    this.assertAccess(accessToken);
    if (!this.subscriptions.some((s) => s.callbackUrl === callbackUrl && s.appli === appli)) {
      this.subscriptions.push({ callbackUrl, appli });
    }
  }
}
