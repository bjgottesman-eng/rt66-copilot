/**
 * Data-source status (contracts §5 GET /sources — one SourceStatusDto per
 * external provider, NOT_CONNECTED placeholders included) and the Withings
 * connect / refresh / backfill / OAuth-callback flow.
 */

import type { BpSource, ConnectionStatus, Provider, SourceStatusDto } from '@benhealth/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { badRequest, forbidden } from '../errors.js';
import { freshnessFor, type ConnectionFreshnessRow } from './mappers.js';

/** External providers surfaced on the sources screen (manual/benhealth are internal). */
const EXTERNAL_PROVIDERS: Provider[] = [
  'withings',
  'apple_health',
  'oura',
  'stelo',
  'cronometer',
  'function',
  'clinical_records',
];

const DISPLAY_NAMES: Record<string, string> = {
  withings: 'Withings',
  apple_health: 'Apple Health',
  oura: 'Oura',
  stelo: 'Stelo',
  cronometer: 'Cronometer',
  function: 'Function',
  clinical_records: 'Clinical records',
};

const COVERAGE_NOTES: Record<string, string | null> = {
  withings: 'Blood pressure and pulse (Phase 1)',
  apple_health: 'Blood pressure correlations pushed by the iOS app',
  oura: 'Planned for a later phase',
  stelo: 'Planned for a later phase',
  cronometer: 'Planned for a later phase',
  function: 'Planned for a later phase',
  clinical_records: 'Planned for a later phase',
};

/** Which bp_source rows count as "data from this provider". */
const PROVIDER_BP_SOURCE: Partial<Record<Provider, BpSource>> = {
  withings: 'withings_api',
  apple_health: 'apple_health',
};

export function registerSourceRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/sources', async (req) => {
    const now = new Date();
    return ctx.db.withUserTx(req.userId!, async (client) => {
      const conns = await client.query<
        ConnectionFreshnessRow & {
          provider: Provider;
          last_error: string | null;
        }
      >(
        `select provider, status, last_success_at, expected_latency_seconds, last_error
           from source_connection`,
      );
      const connByProvider = new Map(conns.rows.map((c) => [c.provider, c]));
      const latest = await client.query<{ source: BpSource; latest: Date }>(
        `select source, max(measured_at) as latest
           from blood_pressure_reading where deleted_at is null group by source`,
      );
      const latestBySource = new Map(latest.rows.map((r) => [r.source, r.latest]));

      const sources: SourceStatusDto[] = EXTERNAL_PROVIDERS.map((provider) => {
        const conn = connByProvider.get(provider) ?? null;
        const bpSource = PROVIDER_BP_SOURCE[provider];
        const latestMeasuredAt =
          bpSource === undefined ? null : (latestBySource.get(bpSource) ?? null);
        const freshness = freshnessFor(conn, latestMeasuredAt, now);
        const status: ConnectionStatus = conn?.status ?? 'not_connected';
        return {
          provider,
          displayName: DISPLAY_NAMES[provider] ?? provider,
          connectionStatus: status,
          freshness,
          latestMeasuredAt: latestMeasuredAt === null ? null : latestMeasuredAt.toISOString(),
          lastSyncAt: conn?.last_success_at === null || conn === null
            ? null
            : conn.last_success_at.toISOString(),
          coverageNote: COVERAGE_NOTES[provider] ?? null,
          problems: conn?.last_error === null || conn === null ? [] : [conn.last_error],
        };
      });
      return { sources };
    });
  });

  app.post('/sources/withings/connect', async (req) => {
    return ctx.withings.startConnect(req.userId!);
  });

  app.post('/sources/withings/refresh', async (req) => {
    const result = await ctx.withings.syncViaCursor(req.userId!);
    return { imported: result.imported };
  });

  app.post('/sources/withings/backfill', async (req) => {
    const body = (req.body ?? {}) as { sinceDays?: unknown };
    let sinceDays = 90;
    if (body.sinceDays !== undefined) {
      if (
        typeof body.sinceDays !== 'number' ||
        !Number.isFinite(body.sinceDays) ||
        body.sinceDays <= 0 ||
        body.sinceDays > 3650
      ) {
        throw badRequest('sinceDays must be a number of days between 1 and 3650');
      }
      sinceDays = body.sinceDays;
    }
    const result = await ctx.withings.backfill(req.userId!, sinceDays);
    return { imported: result.imported };
  });
}

/** OAuth redirect target — unauthenticated (browser redirect carries no JWT). */
export function registerWithingsCallbackRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get('/integrations/withings/callback', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const code = typeof q.code === 'string' ? q.code : '';
    const state = typeof q.state === 'string' ? q.state : '';
    if (code === '' || state === '') throw forbidden('INVALID_STATE', 'missing code or state');
    await ctx.withings.handleCallback(code, state);
    const appOrigin = ctx.config.corsOrigins[0] ?? 'http://localhost:3000';
    return reply.redirect(`${appOrigin}/sources?connected=withings`, 302);
  });
}
