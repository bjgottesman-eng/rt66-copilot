/**
 * Preventive care (spec §26). Items carry their guideline source and review date; statuses DUE / DUE_SOON /
 * COMPLETED are derived from the last completion and interval (algorithm preventive_status v1), while
 * DISCUSS_WITH_CLINICIAN and NOT_APPLICABLE are user decisions. Templates only name official sources to
 * check; they never assert that a screening applies to this user.
 */
import type pg from 'pg';
import { preventiveStatus } from '@bho/analytics';
import type { PreventiveItem, PreventiveItemInput, PreventiveResponse } from '@bho/contracts';
import { withUser, type Tx } from '../db/pool.js';

const COLS = 'id, title, category, guideline_source, guideline_reviewed_at, interval_months, last_completed_at, due_at, status, notes, completion_history, created_at, updated_at';
interface Row { id: string; title: string; category: string; guideline_source: string | null; guideline_reviewed_at: Date | null; interval_months: number | null; last_completed_at: Date | null; due_at: Date | null; status: string; notes: string | null; completion_history: Array<{ completedAt: string; note: string | null }>; created_at: Date; updated_at: Date }
const date = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export const PREVENTIVE_TEMPLATES: PreventiveResponse['templates'] = [
  { title: 'Annual physical / wellness visit', category: 'PHYSICAL', guidelineSource: 'Your primary care clinician’s recommendation', intervalMonths: 12, note: 'Interval is set with your clinician; the app does not infer it.' },
  { title: 'Blood pressure check', category: 'CARDIOVASCULAR', guidelineSource: 'USPSTF — Screening for Hypertension in Adults (verify current recommendation at uspreventiveservicestaskforce.org)', intervalMonths: 12, note: 'Home cuff readings already flow in; this item tracks clinician review.' },
  { title: 'Lipid panel retest', category: 'LAB_RETEST', guidelineSource: 'Clinician-set retest interval', intervalMonths: null, note: 'Set the interval your clinician recommends.' },
  { title: 'Influenza vaccination', category: 'VACCINATION', guidelineSource: 'CDC/ACIP adult immunization schedule (verify at cdc.gov/vaccines)', intervalMonths: 12, note: 'Seasonal; confirm timing with your clinician or pharmacist.' },
  { title: 'Dental examination and cleaning', category: 'DENTAL', guidelineSource: 'Your dentist’s recommended recall interval', intervalMonths: 6, note: 'Recall intervals are individual.' },
  { title: 'Eye examination', category: 'EYE', guidelineSource: 'Your eye-care professional’s recommendation', intervalMonths: 24, note: 'Interval depends on risk factors.' },
  { title: 'Skin examination (dermatology)', category: 'DERMATOLOGY', guidelineSource: 'Clinician recommendation based on personal risk', intervalMonths: null, note: 'Not every adult needs routine skin checks; discuss with your clinician.' },
  { title: 'Colorectal cancer screening', category: 'CANCER_SCREENING', guidelineSource: 'USPSTF — Colorectal Cancer: Screening (verify eligibility and modality at uspreventiveservicestaskforce.org)', intervalMonths: null, note: 'Eligibility, modality and interval depend on age and risk; discuss with your clinician before adding.' },
  { title: 'Medication review', category: 'MEDICATION_REVIEW', guidelineSource: 'Your clinician / pharmacist', intervalMonths: 12, note: 'Reconcile the medication list with your clinician.' },
];

function toDto(r: Row, today: string): PreventiveItem {
  const computed = preventiveStatus({ status: r.status, lastCompletedAt: date(r.last_completed_at), intervalMonths: r.interval_months, dueAt: date(r.due_at) }, today);
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    guidelineSource: r.guideline_source ?? '',
    guidelineReviewedAt: date(r.guideline_reviewed_at),
    intervalMonths: r.interval_months,
    lastCompletedAt: date(r.last_completed_at),
    dueAt: date(r.due_at),
    status: r.status as PreventiveItem['status'],
    notes: r.notes,
    computedStatus: computed.status as PreventiveItem['computedStatus'],
    computedDueAt: computed.dueAt,
    daysUntilDue: computed.daysUntilDue,
    completionHistory: r.completion_history ?? [],
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function listPreventiveTx(tx: Tx, userId: string, today: string): Promise<PreventiveResponse> {
  const r = await tx.query<Row>(`select ${COLS} from public.preventive_care_items where user_id = $1 order by created_at`, [userId]);
  const items = r.rows.map((row) => toDto(row, today)).sort((a, b) => (a.daysUntilDue ?? 1e9) - (b.daysUntilDue ?? 1e9));
  const counts = { due: 0, dueSoon: 0, completed: 0, discuss: 0, notApplicable: 0 };
  for (const i of items) {
    if (i.computedStatus === 'DUE') counts.due++;
    else if (i.computedStatus === 'DUE_SOON') counts.dueSoon++;
    else if (i.computedStatus === 'COMPLETED') counts.completed++;
    else if (i.computedStatus === 'DISCUSS_WITH_CLINICIAN') counts.discuss++;
    else counts.notApplicable++;
  }
  return { today, items, counts, templates: PREVENTIVE_TEMPLATES, notes: ['Every item keeps its guideline source and the date you reviewed that guidance. Templates point to official sources; the app does not infer that a screening applies to you.', 'DUE and DUE SOON are computed from your last completion and interval (60-day window); DISCUSS WITH CLINICIAN and NOT APPLICABLE are your decisions.'] };
}

export async function listPreventive(pool: pg.Pool, userId: string, today: string): Promise<PreventiveResponse> {
  return withUser(pool, userId, (tx) => listPreventiveTx(tx, userId, today));
}

export async function createPreventive(pool: pg.Pool, userId: string, input: PreventiveItemInput): Promise<string> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `insert into public.preventive_care_items (user_id, title, category, guideline_source, guideline_reviewed_at, interval_months, last_completed_at, due_at, status, notes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [userId, input.title, input.category, input.guidelineSource, input.guidelineReviewedAt ?? null, input.intervalMonths ?? null, input.lastCompletedAt ?? null, input.dueAt ?? null, input.status, input.notes ?? null],
    );
    return r.rows[0]!.id;
  });
}

export async function updatePreventive(pool: pg.Pool, userId: string, id: string, input: Partial<PreventiveItemInput>): Promise<boolean> {
  const map: Record<string, string> = { title: 'title', category: 'category', guidelineSource: 'guideline_source', guidelineReviewedAt: 'guideline_reviewed_at', intervalMonths: 'interval_months', lastCompletedAt: 'last_completed_at', dueAt: 'due_at', status: 'status', notes: 'notes' };
  const sets: string[] = [];
  const vals: unknown[] = [userId, id];
  for (const [k, col] of Object.entries(map)) {
    const v = (input as Record<string, unknown>)[k];
    if (v === undefined) continue;
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  }
  if (sets.length === 0) return true;
  return withUser(pool, userId, async (tx) => (await tx.query(`update public.preventive_care_items set ${sets.join(', ')}, updated_at = now() where user_id = $1 and id = $2`, vals)).rowCount! > 0);
}

export async function completePreventive(pool: pg.Pool, userId: string, id: string, completedAt: string, note: string | null): Promise<boolean> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query(
      `update public.preventive_care_items set last_completed_at = $3, due_at = null, status = case when status in ('DISCUSS_WITH_CLINICIAN','NOT_APPLICABLE') then 'COMPLETED' else status end,
         completion_history = completion_history || $4::jsonb, updated_at = now() where user_id = $1 and id = $2`,
      [userId, id, completedAt, JSON.stringify([{ completedAt, note }])],
    );
    return (r.rowCount ?? 0) > 0;
  });
}

export async function deletePreventive(pool: pg.Pool, userId: string, id: string): Promise<boolean> {
  return withUser(pool, userId, async (tx) => (await tx.query('delete from public.preventive_care_items where user_id = $1 and id = $2', [userId, id])).rowCount! > 0);
}

/** iCalendar export of due dates (no health values, titles only) for the user's own calendar. */
export function preventiveCalendar(items: PreventiveItem[]): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ben Health OS//Preventive care//EN', 'CALSCALE:GREGORIAN'];
  for (const i of items) {
    const due = i.computedDueAt ?? i.dueAt;
    if (!due || i.computedStatus === 'NOT_APPLICABLE') continue;
    lines.push('BEGIN:VEVENT', `UID:preventive-${i.id}@ben-health-os`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${due.replace(/-/g, '')}`, `SUMMARY:${esc(i.title)}`, `DESCRIPTION:${esc(`${i.category} · ${i.guidelineSource}`)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
