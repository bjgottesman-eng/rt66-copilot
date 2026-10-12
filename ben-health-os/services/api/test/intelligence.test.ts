import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AlertsResponseSchema, HealthMemorySchema, NotificationPrefsSchema, RecommendationsResponseSchema, ReportListResponseSchema, ReportSchema, AnalysisPacketSchema } from '@bho/contracts';
import { forbiddenReason } from '@bho/ai';
import { buildApp } from '../src/app.js';
import { login, testApp, uniqueEmail, TEST_DATABASE_URL } from './helpers.js';

let app: FastifyInstance;
let mockAiApp: FastifyInstance;
beforeAll(async () => {
  app = await testApp();
  mockAiApp = await buildApp({ NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_MODE: 'local', LOG_LEVEL: 'silent', ALLOW_DEMO_SEED: 'true', LOCAL_JWT_SECRET: 'test-secret-test-secret-test-secret', AI_PROVIDER: 'mock', AI_MOCK_INCLUDE_INVALID: 'true', JOB_SECRET: 'reports-secret' });
});
afterAll(async () => {
  await app.close();
  await mockAiApp.close();
});

describe('Phase 6: analysis packets, recommendations, reports, alerts, memory', () => {
  it('seeds a weekly Health CEO report with exactly three priorities, cited recommendations, no AI without consent, and an alert', async () => {
    const { auth } = await login(app, uniqueEmail('ceo'));
    const seeded = await app.inject({ method: 'POST', url: '/v1/demo/seed', headers: auth, payload: { days: 45, seed: 7 } });
    expect(seeded.statusCode).toBe(200);
    expect(seeded.json().weeklyReport).toMatchObject({ priorities: 3, ai: 'DISABLED' });

    const list = ReportListResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/reports', headers: auth })).json());
    expect(list.reports.filter((r) => r.kind === 'weekly')).toHaveLength(1);
    const report = ReportSchema.parse((await app.inject({ method: 'GET', url: `/v1/reports/weekly/${list.reports[0]!.id}`, headers: auth })).json());
    expect(report.content.algorithm).toBe('weekly_health_ceo');
    expect(report.content.priorities).toHaveLength(3);
    expect(report.content.aiNarrative.status).toBe('DISABLED');
    expect(report.content.aiNarrative.findings).toEqual([]);
    const keys = report.content.sections.map((s) => s.key);
    for (const k of ['kpi_scorecard', 'improved', 'deteriorated', 'recovery', 'activity', 'body', 'glucose_nutrition', 'blood_pressure', 'clinical_preventive', 'data_quality', 'signals_vs_noise']) expect(keys).toContain(k);
    // No composite score anywhere, and every section is labelled by claim type or marked insufficient
    expect(JSON.stringify(report.content)).not.toMatch(/health score|overall score/i);
    expect(report.content.sections.every((s) => s.claimType !== null || s.insufficient)).toBe(true);
    // Idempotent: the same period returns the stored report unless forced
    const again = ReportSchema.parse((await app.inject({ method: 'POST', url: '/v1/reports/weekly', headers: auth, payload: {} })).json());
    expect(again.id).toBe(report.id);

    const recs = RecommendationsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/recommendations', headers: auth })).json());
    expect(recs.recommendations.length).toBeGreaterThan(0);
    expect(recs.recommendations.filter((r) => r.priority !== null)).toHaveLength(Math.min(3, recs.recommendations.length));
    for (const r of recs.recommendations) {
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(r.packetItemIds.length).toBeGreaterThan(0);
      expect(forbiddenReason(`${r.title}. ${r.proposedAction} ${r.reason} ${r.observation}`)).toBeNull();
      expect(['MEASURED_FACT', 'DERIVED_TREND', 'HYPOTHESIS', 'RECOMMENDATION']).toContain(r.claimType);
    }
    // Priorities in the report point at persisted recommendations
    for (const p of report.content.priorities.filter((p) => !p.insufficient)) expect(recs.recommendations.some((r) => r.id === p.recommendationId)).toBe(true);
    // Today's "do today" list carries the priorities
    const today = (await app.inject({ method: 'GET', url: '/v1/dashboard/today', headers: auth })).json() as { doToday: string[] };
    expect(today.doToday.some((d) => d.startsWith('Priority 1:'))).toBe(true);

    const alerts = AlertsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/alerts', headers: auth })).json());
    const ready = alerts.alerts.find((a) => a.kind === 'REPORT_READY');
    expect(ready).toBeTruthy();
    expect(ready!.title).not.toMatch(/\d{2,}/); // lock-screen safe: no values in titles
    expect(alerts.alerts.some((a) => a.kind === 'LABS_IMPORTED')).toBe(true);
    const marked = await app.inject({ method: 'PATCH', url: `/v1/alerts/${ready!.id}`, headers: auth, payload: { action: 'read' } });
    expect(marked.statusCode).toBe(204);
    const after = AlertsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/alerts?unread=1', headers: auth })).json());
    expect(after.unread).toBe(alerts.unread - 1);
    expect(after.alerts.find((a) => a.id === ready!.id)).toBeUndefined();
  }, 120_000);

  it('does not re-raise a dismissed recommendation without newer evidence, snoozes, and evaluates outcomes descriptively', async () => {
    const { auth } = await login(app, uniqueEmail('inbox'));
    expect((await app.inject({ method: 'POST', url: '/v1/demo/seed', headers: auth, payload: { days: 45, seed: 11 } })).statusCode).toBe(200);
    const recs = RecommendationsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/recommendations', headers: auth })).json());
    const target = recs.recommendations.find((r) => r.ruleKey && r.status === 'NEW')!;
    expect(target).toBeTruthy();
    const dismissed = await app.inject({ method: 'PATCH', url: `/v1/recommendations/${target.id}`, headers: auth, payload: { status: 'DISMISSED', dismissReason: 'Not now' } });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json().status).toBe('DISMISSED');
    // Regenerate the same week: the dismissed rule is not raised again
    const regen = ReportSchema.parse((await app.inject({ method: 'POST', url: '/v1/reports/weekly', headers: auth, payload: { force: true } })).json());
    expect(regen.status).toBe('READY');
    const after = RecommendationsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/recommendations', headers: auth })).json());
    expect(after.recommendations.filter((r) => r.ruleKey === target.ruleKey)).toHaveLength(1);
    expect(after.recommendations.find((r) => r.id === target.id)!.status).toBe('DISMISSED');
    // Snooze requires a date; accepted sets acceptedAt
    expect((await app.inject({ method: 'PATCH', url: `/v1/recommendations/${target.id}`, headers: auth, payload: { status: 'SNOOZED' } })).statusCode).toBe(400);
    const other = after.recommendations.find((r) => r.status === 'NEW' && r.id !== target.id);
    if (other) {
      const accepted = await app.inject({ method: 'PATCH', url: `/v1/recommendations/${other.id}`, headers: auth, payload: { status: 'ACCEPTED' } });
      expect(accepted.json().acceptedAt).toBeTruthy();
      expect(accepted.json().outcome).toBeNull();
    }
    // Monthly report on the same data
    const monthly = ReportSchema.parse((await app.inject({ method: 'POST', url: '/v1/reports/monthly', headers: auth, payload: {} })).json());
    expect(monthly.content.algorithm).toBe('monthly_health_board');
    expect(monthly.content.sections.map((s) => s.key)).toEqual(expect.arrayContaining(['scorecard', 'trends', 'risk_register', 'source_quality', 'experiments_completed', 'maintain', 'discontinue']));
    expect(monthly.content.priorities).toHaveLength(3);
  }, 120_000);

  it('sends the packet to the mock provider only with consent and sharing controls, validates findings, and the scheduled job runs', async () => {
    const { auth } = await login(mockAiApp, uniqueEmail('ai'));
    expect((await mockAiApp.inject({ method: 'POST', url: '/v1/demo/seed', headers: auth, payload: { days: 45, seed: 5 } })).statusCode).toBe(200);
    // Sharing is off by default: provider configured but not consulted
    const list = ReportListResponseSchema.parse((await mockAiApp.inject({ method: 'GET', url: '/v1/reports', headers: auth })).json());
    const off = ReportSchema.parse((await mockAiApp.inject({ method: 'GET', url: `/v1/reports/weekly/${list.reports.find((r) => r.kind === 'weekly')!.id}`, headers: auth })).json());
    expect(off.content.aiNarrative.status).toBe('DISABLED');
    // The packet preview applies the sharing controls (Oura excluded by default) without sending anything
    await mockAiApp.inject({ method: 'PATCH', url: '/v1/me', headers: auth, payload: { aiSharing: { enabled: true, excludedConnectors: ['health_connect'] } } });
    const packet = AnalysisPacketSchema.parse((await mockAiApp.inject({ method: 'GET', url: '/v1/analysis-packet?kind=weekly', headers: auth })).json());
    expect(packet.sharing).toMatchObject({ enabled: true, excludedConnectors: ['health_connect'] });
    expect(packet.sharing.droppedItems).toBeGreaterThan(0);
    expect(packet.items.every((i) => !i.sources.includes('health_connect'))).toBe(true);
    expect(packet.instructions.length).toBeGreaterThan(3);
    expect(packet.items.every((i) => i.claimType === 'MEASURED_FACT' || i.claimType === 'DERIVED_TREND')).toBe(true);

    await mockAiApp.inject({ method: 'PATCH', url: '/v1/me', headers: auth, payload: { aiSharing: { enabled: true, excludedConnectors: [] } } });
    const on = ReportSchema.parse((await mockAiApp.inject({ method: 'POST', url: '/v1/reports/weekly', headers: auth, payload: { force: true } })).json());
    expect(on.content.aiNarrative.status).toBe('MOCK');
    expect(on.content.aiNarrative.provider).toBe('mock');
    expect(on.content.aiNarrative.summary).toContain('Mock provider');
    // The validator rejected the uncited and the unsafe finding; accepted findings cite real packet items
    expect(on.content.aiNarrative.rejected.map((r) => r.title).sort()).toEqual(['Uncited claim', 'Unsafe claim']);
    expect(on.content.aiNarrative.findings.every((f) => f.citations.every((c) => packet.items.some((i) => i.id === c) || c.startsWith('trend:') || c.startsWith('lab:')))).toBe(true);
    expect(JSON.stringify(on.content.aiNarrative.findings)).not.toMatch(/stop taking/i);
    // AI hypotheses land in the memory as UNVERIFIED, never as facts
    const memories = (await mockAiApp.inject({ method: 'GET', url: '/v1/memories', headers: auth })).json() as { memories: Array<{ origin: string; verificationStatus: string }> };
    for (const m of memories.memories.filter((x) => x.origin === 'AI_HYPOTHESIS')) expect(m.verificationStatus).toBe('UNVERIFIED');
    // The scheduled job is guarded by the secret and reports what it did
    expect((await mockAiApp.inject({ method: 'POST', url: '/internal/jobs/reports' })).statusCode).toBe(401);
    const job = await mockAiApp.inject({ method: 'POST', url: '/internal/jobs/reports', headers: { 'x-job-secret': 'reports-secret' } });
    expect(job.statusCode).toBe(200);
    expect(job.json().failed).toBe(0);
    expect(job.json().users).toBeGreaterThan(0);
  }, 120_000);

  it('health memory CRUD, notification preferences and row-level isolation', async () => {
    const a = await login(app, uniqueEmail('mem-a'));
    const b = await login(app, uniqueEmail('mem-b'));
    const created = HealthMemorySchema.parse((await app.inject({ method: 'POST', url: '/v1/memories', headers: a.auth, payload: { category: 'PREFERENCE', statement: 'Prefers morning training sessions', origin: 'USER_REPORTED', confidence: 'HIGH' } })).json());
    expect(created.verificationStatus).toBe('USER_CONFIRMED');
    const hyp = HealthMemorySchema.parse((await app.inject({ method: 'POST', url: '/v1/memories', headers: a.auth, payload: { category: 'BASELINE', statement: 'Sleep may be sensitive to late meals', origin: 'AI_HYPOTHESIS', confidence: 'LOW' } })).json());
    expect(hyp.verificationStatus).toBe('UNVERIFIED');
    expect((await app.inject({ method: 'GET', url: '/v1/memories', headers: b.auth })).json().memories).toEqual([]);
    expect((await app.inject({ method: 'PATCH', url: `/v1/memories/${created.id}`, headers: b.auth, payload: { statement: 'tampered' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/v1/memories/${created.id}`, headers: b.auth })).statusCode).toBe(404);
    const archived = HealthMemorySchema.parse((await app.inject({ method: 'PATCH', url: `/v1/memories/${hyp.id}`, headers: a.auth, payload: { verificationStatus: 'ARCHIVED' } })).json());
    expect(archived.archivedAt).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: '/v1/memories', headers: a.auth })).json().memories).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/v1/memories/${created.id}`, headers: a.auth })).statusCode).toBe(204);

    const prefs = NotificationPrefsSchema.parse((await app.inject({ method: 'GET', url: '/v1/notifications/prefs', headers: a.auth })).json());
    expect(prefs.pushEnabled).toBe(true);
    const updated = NotificationPrefsSchema.parse((await app.inject({ method: 'PATCH', url: '/v1/notifications/prefs', headers: a.auth, payload: { pushEnabled: false, quietHoursStart: '21:00', quietHoursEnd: '08:00', enabledKinds: ['REPORT_READY'] } })).json());
    expect(updated.enabledKinds).toEqual(['REPORT_READY']);
    expect((await app.inject({ method: 'GET', url: '/v1/notifications/prefs', headers: a.auth })).json().pushEnabled).toBe(false);
    expect((await app.inject({ method: 'PATCH', url: '/v1/notifications/prefs', headers: a.auth, payload: { quietHoursStart: 'late' } })).statusCode).toBe(400);
    // Recommendations and alerts of A are invisible to B
    expect((await app.inject({ method: 'GET', url: '/v1/recommendations', headers: b.auth })).json().recommendations).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/v1/alerts', headers: b.auth })).json().alerts).toEqual([]);
  });
});
