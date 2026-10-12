/**
 * Physician brief (spec §27): a concise, provenance-carrying summary assembled from confirmed records and
 * measured data. Algorithm physician_brief v1. No AI content, no recommendations; the questions are the
 * user's own.
 */
import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import PDFDocument from 'pdfkit';
import { addDays, localDateOf } from '@bho/analytics';
import type { PhysicianBrief, PhysicianBriefRequest } from '@bho/contracts';
import { withUser } from '../db/pool.js';
import { bloodPressureSummary } from './bp.js';
import { buildMetricCard, loadConnections } from './dashboard.js';
import { latestSignals } from './derived.js';
import { labsOverviewTx } from './labs.js';
import { medicationsOverviewTx } from './medications.js';
import { listPreventiveTx } from './preventive.js';

const TREND_METRICS = ['steps', 'exercise_minutes', 'zone2_minutes', 'sleep_duration', 'hrv_rmssd', 'resting_heart_rate', 'weight'];

export async function generatePhysicianBrief(pool: pg.Pool, userId: string, storageDir: string, req: PhysicianBriefRequest, now: Date = new Date()): Promise<PhysicianBrief> {
  const nowIso = now.toISOString();
  const bp = await bloodPressureSummary(pool, userId, now, 30);
  const signals = await latestSignals(pool, userId);
  const content = await withUser(pool, userId, async (tx) => {
    const prof = await tx.query<{ time_zone: string; display_name: string; birth_date: Date | null }>('select time_zone, display_name, birth_date from public.profiles where id = $1', [userId]);
    const timeZone = prof.rows[0]?.time_zone ?? 'UTC';
    const today = localDateOf(nowIso, null, timeZone);
    const asOf = addDays(today, -1);
    const connections = await loadConnections(tx, userId);
    const trends: Array<{ metricId: string; label: string; unit: string; latest: unknown; comparison: unknown; freshness: string }> = [];
    for (const metricId of TREND_METRICS) {
      const card = await buildMetricCard(tx, userId, metricId, asOf, nowIso, connections);
      if (!card.latest && !card.comparison) continue;
      trends.push({ metricId, label: card.label, unit: card.unit, latest: card.latest, comparison: card.comparison, freshness: `${card.freshness.status}: ${card.freshness.reason}` });
    }
    const labs = await labsOverviewTx(tx, userId, now);
    const meds = await medicationsOverviewTx(tx, userId);
    const prevent = await listPreventiveTx(tx, userId, today);
    const conds = await tx.query<{ name: string; status: string; onset_date: Date | null; source: string; verification_status: string; code: string | null }>(`select name, status, onset_date, source, verification_status, code from public.conditions where user_id = $1 and status in ('ACTIVE','UNCERTAIN') order by name`, [userId]);
    const sources = await tx.query<{ connector: string; status: string; last_successful_sync_at: Date | null }>('select connector, status, last_successful_sync_at from public.source_connections where user_id = $1 order by connector', [userId]);
    return {
      algorithm: 'physician_brief',
      algorithmVersion: 1,
      generatedAt: nowIso,
      timeZone,
      patientDisplayName: prof.rows[0]?.display_name ?? null,
      reasonForVisit: req.reasonForVisit,
      concerns: req.concerns,
      questions: req.questions,
      clinicianName: req.clinicianName ?? null,
      medications: meds.medications.filter((m) => m.status === 'CURRENT' || m.status === 'AS_NEEDED').map((m) => ({ name: m.name, dosage: m.dosage, frequency: m.frequency, route: m.route, status: m.status, prescribingClinician: m.prescribingClinician, startDate: m.startDate, source: m.source, sourceRecords: m.sourceRecords.length })),
      uncertainMedications: meds.medications.filter((m) => m.status === 'UNCERTAIN').map((m) => m.name),
      supplements: meds.supplements.filter((s) => s.status === 'CURRENT' || s.status === 'AS_NEEDED').map((s) => ({ name: s.name, dose: s.dose, frequency: s.frequency, purpose: s.purpose })),
      allergies: meds.allergies.map((a) => ({ substance: a.substance, reaction: a.reaction, severity: a.severity, source: a.source })),
      conditions: conds.rows.map((c) => ({ name: c.name, status: c.status, onsetDate: c.onset_date ? new Date(c.onset_date).toISOString().slice(0, 10) : null, source: c.source, verificationStatus: c.verification_status, code: c.code })),
      bloodPressure: { latest: bp.latest, avg7d: bp.avg7d, avg30d: bp.avg30d, morning: bp.morning, evening: bp.evening, sessions30d: bp.sessions.length, target: bp.targets, lastSyncAt: bp.lastSyncAt },
      trends,
      labs: labs.analytes.filter((a) => a.latest).map((a) => ({ analyte: a.label, latest: a.latest, previous: a.previous, direction: a.direction, deltaPct: a.deltaPct, flaggedLatest: a.flaggedLatest, count: a.count })),
      labsPendingReview: labs.pendingReview,
      recentChanges: signals.filter((s) => s.kind === 'MEANINGFUL_CHANGE' || s.kind === 'DIRECTIONAL_CHANGE').slice(0, 8).map((s) => ({ metricId: s.metricId, kind: s.kind, direction: s.direction, explanation: s.explanation, asOfDate: s.asOfDate })),
      preventive: prevent.items.filter((i) => i.computedStatus === 'DUE' || i.computedStatus === 'DUE_SOON' || i.computedStatus === 'DISCUSS_WITH_CLINICIAN').map((i) => ({ title: i.title, status: i.computedStatus, dueAt: i.computedDueAt, guidelineSource: i.guidelineSource })),
      provenance: { dataThrough: asOf, sources: sources.rows.map((s) => ({ connector: s.connector, status: s.status, lastSuccessfulSyncAt: s.last_successful_sync_at ? new Date(s.last_successful_sync_at).toISOString() : null })) },
      disclaimer: 'Prepared by Ben Health OS from the patient’s own records and devices. Every value carries its source and date. Not a clinical document; contains no AI-generated recommendations.',
    };
  });
  const id = await withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ id: string }>('insert into public.physician_briefs (user_id, reason_for_visit, content) values ($1, $2, $3) returning id', [userId, req.reasonForVisit, JSON.stringify(content)]);
    return r.rows[0]!.id;
  });
  const pdfPath = await writeBriefPdf(storageDir, userId, id, content, req.includeAppendix);
  await withUser(pool, userId, async (tx) => {
    const doc = await tx.query<{ id: string }>(`insert into public.documents (user_id, kind, title, storage_path, mime_type, provider, document_date, extraction_status, metadata) values ($1, 'PHYSICIAN_BRIEF', $2, $3, 'application/pdf', 'Ben Health OS', $4, 'CONFIRMED', $5) returning id`, [userId, `Physician brief ${nowIso.slice(0, 10)}`, pdfPath, nowIso.slice(0, 10), JSON.stringify({ briefId: id })]);
    await tx.query('update public.physician_briefs set pdf_document_id = $3 where user_id = $1 and id = $2', [userId, id, doc.rows[0]!.id]);
  });
  return { id, generatedAt: nowIso, reasonForVisit: req.reasonForVisit, content, pdfPath };
}

export async function getPhysicianBrief(pool: pg.Pool, userId: string, id: string): Promise<(PhysicianBrief & { pdfDocumentId: string | null }) | null> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ id: string; generated_at: Date; reason_for_visit: string | null; content: Record<string, unknown>; pdf_document_id: string | null; storage_path: string | null }>(
      'select b.id, b.generated_at, b.reason_for_visit, b.content, b.pdf_document_id, d.storage_path from public.physician_briefs b left join public.documents d on d.id = b.pdf_document_id where b.user_id = $1 and b.id = $2',
      [userId, id],
    );
    const row = r.rows[0];
    if (!row) return null;
    return { id: row.id, generatedAt: new Date(row.generated_at).toISOString(), reasonForVisit: row.reason_for_visit, content: row.content, pdfPath: row.storage_path ?? '', pdfDocumentId: row.pdf_document_id };
  });
}

export async function listPhysicianBriefs(pool: pg.Pool, userId: string): Promise<Array<{ id: string; generatedAt: string; reasonForVisit: string | null }>> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ id: string; generated_at: Date; reason_for_visit: string | null }>('select id, generated_at, reason_for_visit from public.physician_briefs where user_id = $1 order by generated_at desc limit 50', [userId]);
    return r.rows.map((b) => ({ id: b.id, generatedAt: new Date(b.generated_at).toISOString(), reasonForVisit: b.reason_for_visit }));
  });
}

type Content = Record<string, unknown>;
const fmt = (v: unknown, digits = 0) => (typeof v === 'number' ? v.toFixed(digits) : '—');

async function writeBriefPdf(storageDir: string, userId: string, id: string, c: Content, includeAppendix: boolean): Promise<string> {
  const dir = join(storageDir, userId, 'briefs');
  await mkdir(dir, { recursive: true });
  const rel = `${userId}/briefs/${id}.pdf`;
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 54, right: 54 }, info: { Title: 'Physician brief', Author: 'Ben Health OS' } });
  const stream = createWriteStream(join(storageDir, rel));
  const done = new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
  doc.pipe(stream);
  const h = (t: string) => doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).text(t).moveDown(0.2).font('Helvetica').fontSize(9.5);
  const line = (t: string) => doc.text(t, { lineGap: 1.5 });
  doc.font('Helvetica-Bold').fontSize(16).text('Physician brief');
  doc.font('Helvetica').fontSize(9.5).fillColor('#444').text(`Generated ${String(c.generatedAt).slice(0, 16).replace('T', ' ')} UTC · data through ${c.provenance && (c.provenance as { dataThrough: string }).dataThrough} · time zone ${c.timeZone}`).fillColor('#000');
  if (c.clinicianName) line(`For: ${c.clinicianName}`);
  h('Reason for visit');
  line(String(c.reasonForVisit));
  const concerns = c.concerns as string[];
  if (concerns.length) {
    h('Current concerns');
    concerns.forEach((x) => line(`• ${x}`));
  }
  h('Confirmed medications');
  const meds = c.medications as Array<Record<string, unknown>>;
  if (meds.length === 0) line('None recorded as current.');
  meds.forEach((m) => line(`• ${m.name}${m.dosage ? ` — ${m.dosage}` : ''}${m.frequency ? `, ${m.frequency}` : ''}${m.route ? `, ${m.route}` : ''} (${String(m.status).toLowerCase().replace('_', ' ')}${m.prescribingClinician ? `; ${m.prescribingClinician}` : ''}; source ${m.source})`));
  const uncertain = c.uncertainMedications as string[];
  if (uncertain.length) line(`Uncertain / to confirm: ${uncertain.join(', ')}`);
  const supps = c.supplements as Array<Record<string, unknown>>;
  if (supps.length) {
    h('Supplements (self-reported)');
    supps.forEach((s) => line(`• ${s.name}${s.dose ? ` — ${s.dose}` : ''}${s.frequency ? `, ${s.frequency}` : ''}${s.purpose ? ` (${s.purpose})` : ''}`));
  }
  h('Allergies');
  const allergies = c.allergies as Array<Record<string, unknown>>;
  if (allergies.length === 0) line('None recorded.');
  allergies.forEach((a) => line(`• ${a.substance}${a.reaction ? ` — ${a.reaction}` : ''} (${String(a.severity).toLowerCase()}; source ${a.source})`));
  h('Active conditions');
  const conds = c.conditions as Array<Record<string, unknown>>;
  if (conds.length === 0) line('None recorded.');
  conds.forEach((x) => line(`• ${x.name}${x.code ? ` [${x.code}]` : ''} — ${String(x.status).toLowerCase()}${x.onsetDate ? `, since ${x.onsetDate}` : ''} (${x.source}, ${String(x.verificationStatus).toLowerCase()})`));
  h('Blood pressure (home cuff, last 30 days)');
  const bp = c.bloodPressure as Record<string, { systolic?: number; diastolic?: number; pulse?: number | null; n?: number; measuredAt?: string } | null | number | string>;
  const latest = bp.latest as { systolic: number; diastolic: number; measuredAt: string } | null;
  const avg7 = bp.avg7d as { systolic: number; diastolic: number; n: number } | null;
  const avg30 = bp.avg30d as { systolic: number; diastolic: number; n: number } | null;
  line(latest ? `Latest ${fmt(latest.systolic)}/${fmt(latest.diastolic)} mmHg on ${latest.measuredAt.slice(0, 10)} · 7-day mean ${avg7 ? `${fmt(avg7.systolic)}/${fmt(avg7.diastolic)} (${avg7.n} readings)` : '—'} · 30-day mean ${avg30 ? `${fmt(avg30.systolic)}/${fmt(avg30.diastolic)} (${avg30.n} readings)` : '—'} · ${bp.sessions30d} sessions` : 'No cuff readings in the last 30 days.');
  h('Weight, exercise and recovery (7-day vs preceding 28-day)');
  const trends = c.trends as Array<{ label: string; unit: string; latest: { value: number; measuredAt: string; sourceLabel: string } | null; comparison: { current7d: { mean: number | null }; baseline28d: { mean: number | null }; changeClass: string; explanation: string } | null; freshness: string }>;
  if (trends.length === 0) line('No device data available.');
  trends.forEach((t) => line(`• ${t.label}: ${t.latest ? `${fmt(t.latest.value, 1)} ${t.unit} (${t.latest.measuredAt.slice(0, 10)}, ${t.latest.sourceLabel})` : 'no recent value'}${t.comparison && t.comparison.current7d.mean != null ? ` · 7d mean ${fmt(t.comparison.current7d.mean, 1)} vs 28d ${fmt(t.comparison.baseline28d.mean, 1)} — ${t.comparison.changeClass.toLowerCase().replace('_', ' ')}` : ''}`));
  h('Laboratory results (confirmed; lab-reported ranges and flags)');
  const labs = c.labs as Array<{ analyte: string; latest: { value: number | null; valueText: string | null; unit: string | null; collectedAt: string | null; abnormalFlag: string | null; referenceText: string | null; laboratory: string | null }; previous: { value: number | null; unit: string | null; collectedAt: string | null } | null; direction: string | null; deltaPct: number | null; flaggedLatest: boolean }>;
  if (labs.length === 0) line('No confirmed results.');
  labs.forEach((l) => line(`• ${l.analyte}: ${l.latest.valueText ?? fmt(l.latest.value, 2)} ${l.latest.unit ?? ''} (${l.latest.collectedAt?.slice(0, 10) ?? 'date unknown'}${l.latest.laboratory ? `, ${l.latest.laboratory}` : ''})${l.latest.referenceText ? ` ref ${l.latest.referenceText}` : ''}${l.latest.abnormalFlag ? ` flag ${l.latest.abnormalFlag}` : ''}${l.previous && l.previous.value != null ? ` · prior ${fmt(l.previous.value, 2)} ${l.previous.unit ?? ''} (${l.previous.collectedAt?.slice(0, 10)})${l.deltaPct != null ? `, ${l.deltaPct > 0 ? '+' : ''}${l.deltaPct}%` : ''}` : ''}`));
  if ((c.labsPendingReview as number) > 0) line(`${c.labsPendingReview} imported result(s) are not included because they have not been reviewed.`);
  const changes = c.recentChanges as Array<{ explanation: string; asOfDate: string }>;
  if (changes.length) {
    h('Recent changes (deterministic signals vs 28-day baseline)');
    changes.forEach((s) => line(`• ${s.explanation} (as of ${s.asOfDate})`));
  }
  const prevent = c.preventive as Array<{ title: string; status: string; dueAt: string | null; guidelineSource: string }>;
  if (prevent.length) {
    h('Preventive care');
    prevent.forEach((p) => line(`• ${p.title} — ${p.status.toLowerCase().replace(/_/g, ' ')}${p.dueAt ? ` (due ${p.dueAt})` : ''}; source: ${p.guidelineSource}`));
  }
  const questions = c.questions as string[];
  if (questions.length) {
    h('Questions for the clinician');
    questions.forEach((q, i) => line(`${i + 1}. ${q}`));
  }
  h('Provenance');
  const prov = c.provenance as { sources: Array<{ connector: string; status: string; lastSuccessfulSyncAt: string | null }> };
  prov.sources.forEach((s) => line(`• ${s.connector}: ${s.status.toLowerCase()}${s.lastSuccessfulSyncAt ? `, last sync ${s.lastSuccessfulSyncAt.slice(0, 16).replace('T', ' ')} UTC` : ''}`));
  doc.moveDown(0.6).fontSize(8).fillColor('#555').text(String(c.disclaimer));
  if (includeAppendix) {
    doc.addPage().font('Helvetica-Bold').fontSize(12).text('Appendix: full laboratory history').font('Helvetica').fontSize(8.5);
    const all = c.labs as Array<{ analyte: string; latest: unknown }>;
    all.forEach((l) => doc.text(`${l.analyte}: ${JSON.stringify(l.latest)}`));
  }
  doc.end();
  await done;
  return rel;
}
