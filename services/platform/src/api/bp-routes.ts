/**
 * Blood pressure API (contracts §5): latest / readings / sessions / summary /
 * manual. Analytics and lists include only `canonical and deleted_at is null`
 * unless includeDuplicates=true.
 */

import type {
  AveragingMethod,
  BpSessionDto,
  FreshnessDto,
  ManualBpEntry,
} from '@benhealth/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import type { TxClient } from '../db.js';
import { badRequest } from '../errors.js';
import { ingestManualEntry, validateManualEntry } from '../ingest/normalize.js';
import { recomputeSessions } from '../sessions.js';
import { computeBpSummary, type SummaryReading } from '../summary.js';
import {
  BP_READING_COLUMNS,
  DEFAULT_EXPECTED_LATENCY_SECONDS,
  freshnessFor,
  toReadingDto,
  type BpReadingRow,
  type ConnectionFreshnessRow,
} from './mappers.js';

function parseDateParam(value: unknown, name: string): Date | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw badRequest(`${name} must be an ISO-8601 timestamp`);
  }
  return new Date(value);
}

async function connectionForProvider(
  client: TxClient,
  provider: string,
): Promise<ConnectionFreshnessRow | null> {
  const res = await client.query<ConnectionFreshnessRow>(
    `select status, last_success_at, expected_latency_seconds
       from source_connection where provider = $1::provider`,
    [provider],
  );
  return res.rows[0] ?? null;
}

/**
 * Freshness for the BP metric: judged against the latest canonical reading's
 * originating connection. Manual entries have no connector to fail, so they
 * count as a healthy "connection" as of their ingestion.
 */
async function bpFreshness(
  client: TxClient,
  latest: BpReadingRow | null,
  now: Date,
): Promise<FreshnessDto> {
  if (latest === null) {
    const conn = await connectionForProvider(client, 'withings');
    return freshnessFor(conn, null, now);
  }
  if (latest.source === 'manual') {
    return freshnessFor(
      {
        status: 'connected',
        last_success_at: latest.created_at,
        expected_latency_seconds: DEFAULT_EXPECTED_LATENCY_SECONDS,
      },
      latest.measured_at,
      now,
    );
  }
  const provider = latest.source === 'withings_api' ? 'withings' : 'apple_health';
  const conn = await connectionForProvider(client, provider);
  return freshnessFor(conn, latest.measured_at, now);
}

export function registerBpRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/bp/latest', async (req) => {
    return ctx.db.withUserTx(req.userId!, async (client) => {
      const res = await client.query<BpReadingRow>(
        `select ${BP_READING_COLUMNS} from blood_pressure_reading
          where canonical and deleted_at is null
          order by measured_at desc, id desc limit 1`,
      );
      const row = res.rows[0] ?? null;
      const freshness = await bpFreshness(client, row, new Date());
      return { reading: row === null ? null : toReadingDto(row), freshness };
    });
  });

  app.get('/bp/readings', async (req) => {
    const q = req.query as Record<string, unknown>;
    const from = parseDateParam(q.from, 'from');
    const to = parseDateParam(q.to, 'to');
    const includeDuplicates = q.includeDuplicates === 'true';
    return ctx.db.withUserTx(req.userId!, async (client) => {
      const res = await client.query<BpReadingRow>(
        `select ${BP_READING_COLUMNS} from blood_pressure_reading
          where deleted_at is null
            and ($1::timestamptz is null or measured_at >= $1)
            and ($2::timestamptz is null or measured_at <= $2)
            and ($3 or canonical)
          order by measured_at asc, id asc`,
        [from, to, includeDuplicates],
      );
      return { readings: res.rows.map(toReadingDto) };
    });
  });

  app.get('/bp/sessions', async (req) => {
    const q = req.query as Record<string, unknown>;
    const from = parseDateParam(q.from, 'from');
    const to = parseDateParam(q.to, 'to');
    return ctx.db.withUserTx(req.userId!, async (client) => {
      const sessions = await client.query<{
        id: string;
        started_at: Date;
        ended_at: Date | null;
        reading_count: number;
        avg_systolic: string | null;
        avg_diastolic: string | null;
        avg_pulse: string | null;
        averaging_method: AveragingMethod;
        first_reading_excluded: boolean;
      }>(
        `select id, started_at, ended_at, reading_count, avg_systolic, avg_diastolic,
                avg_pulse, averaging_method, first_reading_excluded
           from bp_session
          where ($1::timestamptz is null or started_at >= $1)
            and ($2::timestamptz is null or started_at <= $2)
          order by started_at asc`,
        [from, to],
      );
      const ids = sessions.rows.map((s) => s.id);
      const readingsBySession = new Map<string, BpReadingRow[]>();
      if (ids.length > 0) {
        const readings = await client.query<BpReadingRow>(
          `select ${BP_READING_COLUMNS} from blood_pressure_reading
            where session_id = any($1::uuid[]) and canonical and deleted_at is null
            order by measured_at asc, id asc`,
          [ids],
        );
        for (const row of readings.rows) {
          const list = readingsBySession.get(row.session_id!);
          if (list === undefined) readingsBySession.set(row.session_id!, [row]);
          else list.push(row);
        }
      }
      const dto: BpSessionDto[] = sessions.rows.map((s) => ({
        id: s.id,
        startedAt: s.started_at.toISOString(),
        endedAt: s.ended_at === null ? null : s.ended_at.toISOString(),
        readingCount: s.reading_count,
        avgSystolic: s.avg_systolic === null ? null : Number(s.avg_systolic),
        avgDiastolic: s.avg_diastolic === null ? null : Number(s.avg_diastolic),
        avgPulse: s.avg_pulse === null ? null : Number(s.avg_pulse),
        averagingMethod: s.averaging_method,
        firstReadingExcluded: s.first_reading_excluded,
        readings: (readingsBySession.get(s.id) ?? []).map(toReadingDto),
      }));
      return { sessions: dto };
    });
  });

  app.get('/bp/summary', async (req) => {
    const q = req.query as Record<string, unknown>;
    const window = q.window ?? '7d';
    if (window !== '7d' && window !== '30d') throw badRequest("window must be '7d' or '30d'");
    const now = new Date();
    const rows = await ctx.db.withUserTx(req.userId!, async (client) => {
      const res = await client.query<{
        measured_at: Date;
        measured_tz: string | null;
        systolic_mmhg: string;
        diastolic_mmhg: string;
        pulse_bpm: string | null;
        session_id: string | null;
      }>(
        `select measured_at, measured_tz, systolic_mmhg, diastolic_mmhg, pulse_bpm, session_id
           from blood_pressure_reading
          where canonical and deleted_at is null
            and measured_at > $1 and measured_at <= $2
          order by measured_at asc`,
        [new Date(now.getTime() - (window === '7d' ? 7 : 30) * 86400 * 1000), now],
      );
      return res.rows;
    });
    const readings: SummaryReading[] = rows.map((r) => ({
      measuredAt: r.measured_at,
      measuredTz: r.measured_tz,
      systolic: Number(r.systolic_mmhg),
      diastolic: Number(r.diastolic_mmhg),
      pulse: r.pulse_bpm === null ? null : Number(r.pulse_bpm),
      sessionId: r.session_id,
    }));
    return computeBpSummary(readings, window, now);
  });

  app.post('/bp/manual', async (req, reply) => {
    const entry = req.body as ManualBpEntry;
    if (entry === null || typeof entry !== 'object') throw badRequest('body must be a JSON object');
    const problem = validateManualEntry(entry);
    if (problem !== null) throw badRequest(problem);
    const userId = req.userId!;
    const readingId = await ctx.db.withUserTx(userId, async (client) => {
      const result = await ingestManualEntry(client, { userId, connectionId: null }, entry);
      await recomputeSessions(client, userId);
      return result.readingId;
    });
    const row = await ctx.db.withUserTx(userId, async (client) => {
      const res = await client.query<BpReadingRow>(
        `select ${BP_READING_COLUMNS} from blood_pressure_reading where id = $1`,
        [readingId],
      );
      return res.rows[0]!;
    });
    reply.code(201);
    return { reading: toReadingDto(row) };
  });
}
