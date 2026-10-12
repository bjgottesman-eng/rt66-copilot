import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateCronometerCsv, generateDemoDataset, generateLabCsv } from '@bho/fixtures';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { withUser } from '../db/pool.js';
import { deleteAllData } from '../services/account.js';
import { createManualBloodPressure } from '../services/bp.js';
import { ingestHealthConnectBatch } from '../services/ingest.js';
import { deriveForUser } from '../services/derived.js';
import { importCronometerCsv } from '../services/nutrition.js';
import { decideReviews, importLabFile, reviewQueue } from '../services/labs.js';
import { createAllergy, createMedication, createSupplement } from '../services/medications.js';
import { createCondition } from '../services/clinicalRecords.js';
import { createPreventive } from '../services/preventive.js';
import { localDateOf, addDays } from '@bho/analytics';

const SeedBody = z.object({
  days: z.number().int().min(7).max(120).default(120),
  seed: z.number().int().optional(),
  /** Replace existing demo data. Real (non-demo) data is never overwritten; clear it explicitly first. */
  replace: z.boolean().default(false),
});

export async function demoRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  if (!ctx.config.ALLOW_DEMO_SEED) return;

  app.post('/v1/demo/seed', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = SeedBody.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid body', details: body.error.issues });
    const profile = await ensureProfile(ctx.pool, ctx.config, user);
    const state = await withUser(ctx.pool, user.userId, async (tx) => {
      const n = await tx.query<{ n: number }>('select count(*)::int as n from public.observations where user_id = $1', [user.userId]);
      return { observations: Number(n.rows[0]!.n), demoMode: profile.demo_mode };
    });
    if (state.observations > 0 && !state.demoMode) return reply.code(409).send({ error: 'conflict', message: 'This account holds real (non-demo) data. Demo data is never mixed with real sources; delete your data first if you really want a demo.' });
    if (state.observations > 0 && state.demoMode && !body.data.replace) return reply.code(409).send({ error: 'conflict', message: 'Demo data already loaded; pass replace=true to regenerate.' });
    if (state.observations > 0) await deleteAllData(ctx.pool, user.userId);

    const endDate = addDays(localDateOf(new Date().toISOString(), null, profile.time_zone), -1);
    const ds = generateDemoDataset({ days: body.data.days, seed: body.data.seed, endDate, timeZone: profile.time_zone, detailedDays: Math.min(45, body.data.days), glucoseDays: Math.min(14, body.data.days) });
    const totals = { received: 0, inserted: 0, updated: 0, unchangedDuplicates: 0, crossSourceDuplicates: 0, rejected: 0 };
    for (const batch of ds.batches) {
      const r = await ingestHealthConnectBatch(ctx.pool, user.userId, batch);
      totals.received += r.received;
      totals.inserted += r.inserted;
      totals.updated += r.updated;
      totals.unchangedDuplicates += r.unchangedDuplicates;
      totals.crossSourceDuplicates += r.crossSourceDuplicates;
      totals.rejected += r.rejected.length;
    }
    for (const m of ds.manualBloodPressure) await createManualBloodPressure(ctx.pool, user.userId, m);
    // The same synthetic diary as a Cronometer CSV export: exercises the importer and same-day dedup against Health Connect.
    const csv = await importCronometerCsv(ctx.pool, user.userId, { csv: generateCronometerCsv(ds), fileName: 'cronometer-demo.csv', dryRun: false });
    // Phase 5: a synthetic Function-style lab export (three panels); the two older panels are confirmed, the latest stays in the review queue
    const labs = await importLabFile(ctx.pool, user.userId, ctx.config.DOCUMENT_STORAGE_DIR, { csv: generateLabCsv(ds), fileName: 'function-health-demo.csv', source: 'function_health', dryRun: false });
    const pendingLabs = await reviewQueue(ctx.pool, user.userId);
    const latestPanel = pendingLabs.pending.map((p) => p.collectedAt ?? '').sort().at(-1) ?? '';
    const older = pendingLabs.pending.filter((p) => (p.collectedAt ?? '') !== latestPanel).map((p) => ({ id: p.id, action: 'CONFIRM' as const }));
    const confirmedLabs = older.length ? await decideReviews(ctx.pool, user.userId, { decisions: older }) : null;
    await createMedication(ctx.pool, user.userId, { name: 'Atorvastatin (synthetic demo)', dosage: '20 mg', frequency: 'nightly', route: 'oral', status: 'CURRENT', prescribingClinician: 'Dr. Synthetic', indication: 'LDL above target', startDate: addDays(endDate, -300) });
    await createMedication(ctx.pool, user.userId, { name: 'Ibuprofen (synthetic demo)', dosage: '400 mg', frequency: 'as needed', status: 'AS_NEEDED' });
    await createSupplement(ctx.pool, user.userId, { name: 'Vitamin D3 (synthetic demo)', dose: '2000 IU', frequency: 'daily', purpose: 'low 25-OH vitamin D on the first panel', status: 'CURRENT', ingredients: [{ name: 'cholecalciferol', amount: '2000 IU' }], monthlyCostCents: 800 });
    await createAllergy(ctx.pool, user.userId, { substance: 'Penicillin (synthetic demo)', reaction: 'hives', severity: 'MODERATE' });
    await createCondition(ctx.pool, user.userId, { name: 'Hyperlipidemia (synthetic demo)', status: 'ACTIVE', onsetDate: addDays(endDate, -400) });
    await createPreventive(ctx.pool, user.userId, { title: 'Annual physical / wellness visit', category: 'PHYSICAL', guidelineSource: 'Primary care clinician (synthetic demo)', guidelineReviewedAt: addDays(endDate, -420), intervalMonths: 12, lastCompletedAt: addDays(endDate, -420), status: 'COMPLETED' });
    await createPreventive(ctx.pool, user.userId, { title: 'Influenza vaccination', category: 'VACCINATION', guidelineSource: 'CDC/ACIP adult schedule (verify at cdc.gov/vaccines)', guidelineReviewedAt: addDays(endDate, -60), intervalMonths: 12, lastCompletedAt: addDays(endDate, -60), status: 'COMPLETED' });
    await createPreventive(ctx.pool, user.userId, { title: 'Colorectal cancer screening', category: 'CANCER_SCREENING', guidelineSource: 'USPSTF — verify eligibility with your clinician', status: 'DISCUSS_WITH_CLINICIAN' });
    await withUser(ctx.pool, user.userId, (tx) => tx.query('update public.profiles set demo_mode = true, birth_date = coalesce(birth_date, $2::date) where id = $1', [user.userId, '1986-06-15']));
    const derived = await deriveForUser(ctx.pool, user.userId);
    return { seeded: true, endDate, scenario: ds.scenario, summary: ds.summary, ingest: totals, manualBloodPressure: ds.manualBloodPressure.length, cronometerCsv: { meals: csv.meals, days: csv.days, inserted: csv.ingest?.inserted ?? 0, healthConnectDuplicatesLinked: csv.healthConnectDuplicatesLinked }, labs: { staged: labs.staged, confirmed: confirmedLabs?.confirmed ?? 0, pendingReview: labs.staged - (confirmedLabs?.confirmed ?? 0) }, derived };
  });

  app.delete('/v1/demo', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const profile = await ensureProfile(ctx.pool, ctx.config, user);
    if (!profile.demo_mode) return reply.code(409).send({ error: 'conflict', message: 'Demo mode is not active; use DELETE /v1/me/data to remove real data.' });
    const counts = await deleteAllData(ctx.pool, user.userId);
    return { cleared: true, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
}
