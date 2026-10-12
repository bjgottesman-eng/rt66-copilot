/**
 * Laboratory results (Phase 5): file import (CSV / PDF text layer) staged for review, FHIR-sourced rows,
 * manual entry, review decisions, cross-source dedup and the explorer. Every row keeps analyte, code,
 * value, unit, reference range, lab-reported flag, dates, laboratory, provider, document, extraction
 * confidence and verification status (spec §11).
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { LAB_ANALYTES } from '@bho/shared-config';
import { LAB_ANALYTE_IDS, analyteKey, extractLabsFromText, findLabDuplicate, labDirection, mapAnalyte, normalizeAbnormalFlag, normalizeLabUnit, parseLabCsv, payloadHash, toCanonicalLab, type LabRowInput } from '@bho/analytics';
import type { LabImportRequest, LabImportResult, LabResult, LabReviewQueueResponse, LabReviewRequest, LabsOverviewResponse, ManualLabResultInput } from '@bho/contracts';
import { withUser, type Tx } from '../db/pool.js';
import { audit } from './audit.js';
import { extractPdfTextLines, storeDocument } from './documents.js';

const LAB_COLS = `id, panel_id, analyte, analyte_raw_name, loinc, value::float8 as value, value_text, unit, canonical_value::float8 as canonical_value, canonical_unit, reference_low::float8 as reference_low, reference_high::float8 as reference_high, reference_text, abnormal_flag,
  collected_at, resulted_at, laboratory, provider, method, document_id, source_connector, external_id, extraction_confidence::float8 as extraction_confidence, verification_status, canonical, duplicate_of, duplicate_reason, quality_flags, panel_name, review_note, created_at`;

interface LabRow {
  id: string;
  panel_id: string | null;
  analyte: string;
  analyte_raw_name: string;
  loinc: string | null;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  canonical_value: number | null;
  canonical_unit: string | null;
  reference_low: number | null;
  reference_high: number | null;
  reference_text: string | null;
  abnormal_flag: string | null;
  collected_at: Date | null;
  resulted_at: Date | null;
  laboratory: string | null;
  provider: string | null;
  method: string | null;
  document_id: string | null;
  source_connector: string;
  external_id: string | null;
  extraction_confidence: number | null;
  verification_status: string;
  canonical: boolean;
  duplicate_of: string | null;
  duplicate_reason: string | null;
  quality_flags: string[];
  panel_name: string | null;
  review_note: string | null;
  created_at: Date;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export function rowToLabResult(r: LabRow): LabResult {
  return {
    id: r.id,
    panelId: r.panel_id,
    analyteKey: r.analyte,
    analyteId: LAB_ANALYTE_IDS.has(r.analyte) ? r.analyte : null,
    analyteRawName: r.analyte_raw_name,
    loinc: r.loinc,
    value: r.value,
    valueText: r.value_text,
    unit: r.unit,
    canonicalValue: r.canonical_value,
    canonicalUnit: r.canonical_unit,
    referenceLow: r.reference_low,
    referenceHigh: r.reference_high,
    referenceText: r.reference_text,
    abnormalFlag: r.abnormal_flag,
    collectedAt: iso(r.collected_at),
    resultedAt: iso(r.resulted_at),
    laboratory: r.laboratory,
    provider: r.provider,
    method: r.method,
    documentId: r.document_id,
    source: r.source_connector as LabResult['source'],
    externalId: r.external_id,
    extractionConfidence: r.extraction_confidence,
    verificationStatus: r.verification_status as LabResult['verificationStatus'],
    canonical: r.canonical,
    duplicateOf: r.duplicate_of,
    duplicateReason: r.duplicate_reason,
    qualityFlags: r.quality_flags ?? [],
    panelName: r.panel_name,
    reviewNote: r.review_note,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export interface StageMeta {
  source: 'clinical_fhir' | 'function_health' | 'file_import' | 'manual';
  documentId: string | null;
  panelId: string | null;
  panelName: string | null;
  /** Initial verification status: file/PDF rows are staged for review; clinician records are confirmed. */
  verificationStatus: 'REVIEW' | 'CONFIRMED';
  externalIdPrefix: string;
  recordType: string;
}

/** Writes one lab row: immutable raw event + lab_results upsert. Decided rows (CONFIRMED/REJECTED) are never overwritten by a re-import. */
export async function stageLabRow(tx: Tx, userId: string, row: LabRowInput & { externalId?: string; raw?: unknown }, meta: StageMeta, nowIso: string): Promise<'staged' | 'updated' | 'unchanged'> {
  const externalId = row.externalId ?? `${meta.externalIdPrefix}:${row.collectedAt ?? `nodate:${meta.documentId ?? 'x'}`}:${row.analyteKey}:${row.unit ?? ''}${row.index ? `#${row.index}` : ''}`;
  const payload = row.raw ?? { kind: 'lab_row', ...row, index: undefined };
  const hash = payloadHash(payload);
  const prev = await tx.query<{ id: string; payload_hash: string }>('select id, payload_hash from public.raw_ingest_events where user_id = $1 and connector = $2 and external_id = $3 and processing_status <> $4 order by ingested_at desc limit 1', [userId, meta.source, externalId, 'SUPERSEDED']);
  const existing = await tx.query<{ id: string; verification_status: string }>('select id, verification_status from public.lab_results where user_id = $1 and source_connector = $2 and external_id = $3', [userId, meta.source, externalId]);
  if (prev.rows[0]?.payload_hash === hash && existing.rows[0]) return 'unchanged';
  if (existing.rows[0] && existing.rows[0].verification_status !== 'REVIEW' && existing.rows[0].verification_status !== 'UNVERIFIED') return 'unchanged';
  const raw = await tx.query<{ id: string }>(
    `insert into public.raw_ingest_events (user_id, connector, external_id, record_type, original_time, payload, payload_hash, parser_version, processing_status)
     values ($1, $2, $3, $4, $5, $6, $7, 1, 'NORMALIZED') on conflict (user_id, connector, external_id, payload_hash) do update set processing_status = 'NORMALIZED' returning id`,
    [userId, meta.source, externalId, meta.recordType, row.collectedAt ? `${row.collectedAt}T12:00:00Z` : nowIso, JSON.stringify(payload), hash],
  );
  if (prev.rows[0] && prev.rows[0].id !== raw.rows[0]!.id) await tx.query(`update public.raw_ingest_events set processing_status = 'SUPERSEDED', superseded_by = $2 where id = $1`, [prev.rows[0].id, raw.rows[0]!.id]);
  const r = await tx.query<{ inserted: boolean }>(
    `insert into public.lab_results (user_id, panel_id, analyte, analyte_raw_name, loinc, value, value_text, unit, canonical_value, canonical_unit, reference_low, reference_high, reference_text, abnormal_flag, collected_at, resulted_at, laboratory, provider, method, document_id, source_connector, external_id, extraction_confidence, verification_status, quality_flags, panel_name, raw_event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
     on conflict (user_id, source_connector, external_id) do update set panel_id = coalesce(excluded.panel_id, public.lab_results.panel_id), analyte = excluded.analyte, analyte_raw_name = excluded.analyte_raw_name, loinc = excluded.loinc, value = excluded.value, value_text = excluded.value_text, unit = excluded.unit,
       canonical_value = excluded.canonical_value, canonical_unit = excluded.canonical_unit, reference_low = excluded.reference_low, reference_high = excluded.reference_high, reference_text = excluded.reference_text, abnormal_flag = excluded.abnormal_flag, collected_at = excluded.collected_at, resulted_at = excluded.resulted_at,
       laboratory = excluded.laboratory, provider = excluded.provider, method = excluded.method, document_id = coalesce(excluded.document_id, public.lab_results.document_id), extraction_confidence = excluded.extraction_confidence, quality_flags = excluded.quality_flags, panel_name = coalesce(excluded.panel_name, public.lab_results.panel_name), raw_event_id = excluded.raw_event_id
     returning (xmax = 0) as inserted`,
    [userId, meta.panelId, row.analyteKey, row.analyteRawName, row.loinc, row.value, row.valueText, row.unit, row.canonicalValue, row.canonicalUnit, row.referenceLow, row.referenceHigh, row.referenceText, row.abnormalFlag, row.collectedAt ? `${row.collectedAt}T12:00:00Z` : null, row.resultedAt ? `${row.resultedAt}T12:00:00Z` : null, row.laboratory, row.provider, row.method, meta.documentId, meta.source, externalId, row.extractionConfidence, meta.verificationStatus, row.flags, row.panel ?? meta.panelName, raw.rows[0]!.id],
  );
  return r.rows[0]!.inserted ? 'staged' : 'updated';
}

async function createPanel(tx: Tx, userId: string, name: string, collectedAt: string | null, laboratory: string | null, source: string, documentId: string | null, externalId: string): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `insert into public.lab_panels (user_id, name, collected_at, laboratory, source_connector, document_id, external_id) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [userId, name, collectedAt ? `${collectedAt}T12:00:00Z` : null, laboratory, source, documentId, externalId],
  );
  return r.rows[0]!.id;
}

function preview(rows: LabRowInput[]): LabImportResult['preview'] {
  return rows.slice(0, 60).map((r) => ({ analyteRawName: r.analyteRawName, analyteId: r.analyteId, analyteKey: r.analyteKey, loinc: r.loinc, value: r.value, valueText: r.valueText, unit: r.unit, canonicalValue: r.canonicalValue, canonicalUnit: r.canonicalUnit, referenceLow: r.referenceLow, referenceHigh: r.referenceHigh, referenceText: r.referenceText, abnormalFlag: r.abnormalFlag, collectedAt: r.collectedAt, resultedAt: r.resultedAt, laboratory: r.laboratory, provider: r.provider, panel: r.panel, extractionConfidence: r.extractionConfidence, flags: r.flags }));
}

export async function importLabFile(pool: pg.Pool, userId: string, storageDir: string, req: LabImportRequest, now: Date = new Date()): Promise<LabImportResult> {
  const nowIso = now.toISOString();
  const isPdf = Boolean(req.pdfBase64);
  const bytes = isPdf ? Buffer.from(req.pdfBase64!, 'base64') : Buffer.from(req.csv!, 'utf8');
  const fileHash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  let rows: LabRowInput[] = [];
  let warnings: string[] = [];
  let mapping: Record<string, unknown> | null = null;
  let collectedAt: string | null = req.collectedAt ?? null;
  let laboratory: string | null = req.laboratory ?? null;
  let pageCount: number | null = null;
  if (isPdf) {
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return { dryRun: req.dryRun, fileHash, format: 'PDF_TEXT', source: req.source, documentId: null, mapping: null, rows: 0, staged: 0, unchanged: 0, collectedAt, laboratory, pageCount: null, warnings: ['Not a PDF file'], preview: [] };
    let lines: string[] = [];
    try {
      const ex = await extractPdfTextLines(bytes);
      lines = ex.lines;
      pageCount = ex.pageCount;
    } catch (e) {
      warnings.push(`PDF could not be read: ${(e as Error).message.slice(0, 200)}`);
    }
    const ex = extractLabsFromText(lines, { collectedAt, laboratory });
    rows = ex.rows;
    warnings = [...warnings, ...ex.warnings];
    collectedAt = ex.collectedAt;
    laboratory = ex.laboratory;
  } else {
    const parsed = parseLabCsv(req.csv!, { collectedAt, laboratory });
    rows = parsed.rows;
    warnings = parsed.warnings;
    mapping = { ...parsed.mapping };
    collectedAt = rows.find((r) => r.collectedAt)?.collectedAt ?? collectedAt;
    laboratory = rows.find((r) => r.laboratory)?.laboratory ?? laboratory;
  }
  const base: LabImportResult = { dryRun: req.dryRun, fileHash, format: isPdf ? 'PDF_TEXT' : 'CSV', source: req.source, documentId: null, mapping, rows: rows.length, staged: 0, unchanged: 0, collectedAt, laboratory, pageCount, warnings, preview: preview(rows) };
  if (req.dryRun || rows.length === 0) return base;

  return withUser(pool, userId, async (tx) => {
    const title = req.fileName ?? `${isPdf ? 'Lab PDF' : 'Lab CSV'} ${collectedAt ?? nowIso.slice(0, 10)}`;
    const doc = await storeDocument(tx, userId, storageDir, { kind: isPdf ? 'LAB_PDF' : 'LAB_CSV', title, mimeType: isPdf ? 'application/pdf' : 'text/csv', bytes, provider: laboratory, documentDate: collectedAt, metadata: { source: req.source, fileHash } });
    const panelId = await createPanel(tx, userId, title, collectedAt, laboratory, req.source, doc.id, `${req.source}:${fileHash}`);
    let staged = 0;
    let unchanged = 0;
    const seen = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.collectedAt ?? 'nodate'}:${row.analyteKey}:${row.unit ?? ''}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      const outcome = await stageLabRow(tx, userId, { ...row, index: n > 1 ? n : 0 }, { source: req.source, documentId: doc.id, panelId, panelName: row.panel ?? title, verificationStatus: 'REVIEW', externalIdPrefix: 'lab', recordType: isPdf ? 'LabPdfTextRow' : 'LabCsvRow' }, nowIso);
      if (outcome === 'unchanged') unchanged++;
      else staged++;
    }
    await tx.query(`update public.documents set extraction_status = $2, page_count = $3, extraction_summary = $4 where id = $1`, [doc.id, staged > 0 ? 'REVIEW' : 'EXTRACTED', pageCount, JSON.stringify({ rows: rows.length, staged, unchanged, warnings: warnings.slice(0, 10), format: base.format })]);
    await tx.query(
      `insert into public.source_connections (user_id, connector, status, last_sync_attempt_at, last_successful_sync_at, last_sync_status) values ($1, $2, 'CONNECTED', $3, $3, 'SUCCESS')
       on conflict (user_id, connector) do update set status = 'CONNECTED', last_sync_attempt_at = excluded.last_sync_attempt_at, last_successful_sync_at = excluded.last_successful_sync_at, last_sync_status = 'SUCCESS', last_error = null`,
      [userId, req.source, nowIso],
    );
    return { ...base, documentId: doc.id, staged, unchanged };
  });
}

/** Cross-source dedup for a set of confirmed results: same analyte + day + comparable value → lower-priority source linked. */
export async function linkLabDuplicates(tx: Tx, userId: string, ids: string[]): Promise<number> {
  let linked = 0;
  for (const id of ids) {
    const me = await tx.query<LabRow>(`select ${LAB_COLS} from public.lab_results where user_id = $1 and id = $2`, [userId, id]);
    const row = me.rows[0];
    if (!row || !row.collected_at || row.verification_status !== 'CONFIRMED') continue;
    const cands = await tx.query<LabRow>(
      `select ${LAB_COLS} from public.lab_results where user_id = $1 and id <> $2 and analyte = $3 and verification_status = 'CONFIRMED' and canonical and collected_at between $4::timestamptz - interval '1 day' and $4::timestamptz + interval '1 day'`,
      [userId, id, row.analyte, row.collected_at],
    );
    const toCand = (r: LabRow) => ({ id: r.id, analyteKey: r.analyte, collectedAt: iso(r.collected_at)!.slice(0, 10), canonicalValue: r.canonical_value, value: r.value, unit: r.unit, source: r.source_connector });
    const d = findLabDuplicate(toCand(row), cands.rows.map(toCand));
    if (!d) continue;
    await tx.query(`update public.lab_results set canonical = false, duplicate_of = $2, duplicate_reason = $3 where id = $1`, [d.duplicate.id, d.canonical.id, d.reason]);
    await tx.query(`update public.lab_results set canonical = true, duplicate_of = null, duplicate_reason = null where id = $1`, [d.canonical.id]);
    linked++;
  }
  return linked;
}

export async function reviewQueue(pool: pg.Pool, userId: string): Promise<LabReviewQueueResponse> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<LabRow>(`select ${LAB_COLS} from public.lab_results where user_id = $1 and verification_status in ('REVIEW','UNVERIFIED') order by collected_at desc nulls last, analyte_raw_name limit 500`, [userId]);
    return { pending: r.rows.map(rowToLabResult), total: r.rows.length };
  });
}

export async function decideReviews(pool: pg.Pool, userId: string, req: LabReviewRequest, now: Date = new Date()): Promise<{ confirmed: number; rejected: number; duplicatesLinked: number; remaining: number }> {
  const res = await withUser(pool, userId, async (tx) => {
    let confirmed = 0;
    let rejected = 0;
    const confirmedIds: string[] = [];
    for (const d of req.decisions) {
      const cur = await tx.query<LabRow>(`select ${LAB_COLS} from public.lab_results where user_id = $1 and id = $2`, [userId, d.id]);
      const row = cur.rows[0];
      if (!row) continue;
      if (d.action === 'REJECT') {
        await tx.query(`update public.lab_results set verification_status = 'REJECTED', canonical = false, reviewed_at = $3, review_note = $4 where user_id = $1 and id = $2`, [userId, d.id, now.toISOString(), d.corrections?.note ?? null]);
        rejected++;
        continue;
      }
      const c = d.corrections ?? {};
      let analyte = row.analyte;
      if (c.analyteId !== undefined) analyte = c.analyteId ? analyteKey(row.analyte_raw_name, LAB_ANALYTE_IDS.has(c.analyteId) ? c.analyteId : mapAnalyte(c.analyteId)) : analyteKey(row.analyte_raw_name, null);
      const value = c.value !== undefined ? c.value : row.value;
      const unit = c.unit !== undefined ? normalizeLabUnit(c.unit) : row.unit;
      const canon = toCanonicalLab(LAB_ANALYTE_IDS.has(analyte) ? analyte : null, value, unit);
      const flags = (row.quality_flags ?? []).filter((f) => !f.startsWith('UNIT_') && f !== 'COLLECTION_DATE_MISSING');
      flags.push(...canon.flags);
      const collectedAt = c.collectedAt ? `${c.collectedAt}T12:00:00Z` : iso(row.collected_at);
      if (!collectedAt) flags.push('COLLECTION_DATE_MISSING');
      if (Object.keys(c).filter((k) => k !== 'note').length > 0) flags.push('CORRECTED_AT_REVIEW');
      await tx.query(
        `update public.lab_results set analyte = $3, value = $4, unit = $5, canonical_value = $6, canonical_unit = $7, collected_at = $8, reference_low = $9, reference_high = $10, abnormal_flag = $11, verification_status = 'CONFIRMED', canonical = true, reviewed_at = $12, review_note = $13, quality_flags = $14 where user_id = $1 and id = $2`,
        [userId, d.id, analyte, value, unit, canon.canonicalValue, canon.canonicalUnit, collectedAt, c.referenceLow !== undefined ? c.referenceLow : row.reference_low, c.referenceHigh !== undefined ? c.referenceHigh : row.reference_high, c.abnormalFlag !== undefined ? normalizeAbnormalFlag(c.abnormalFlag) : row.abnormal_flag, now.toISOString(), c.note ?? null, [...new Set(flags)]],
      );
      confirmed++;
      confirmedIds.push(d.id);
    }
    const duplicatesLinked = await linkLabDuplicates(tx, userId, confirmedIds);
    const docs = await tx.query<{ document_id: string }>(`select distinct document_id from public.lab_results where user_id = $1 and id = any($2::uuid[]) and document_id is not null`, [userId, req.decisions.map((d) => d.id)]);
    for (const doc of docs.rows) {
      const left = await tx.query<{ n: number }>(`select count(*)::int as n from public.lab_results where user_id = $1 and document_id = $2 and verification_status in ('REVIEW','UNVERIFIED')`, [userId, doc.document_id]);
      if (Number(left.rows[0]!.n) === 0) await tx.query(`update public.documents set extraction_status = 'CONFIRMED' where id = $1 and user_id = $2`, [doc.document_id, userId]);
    }
    const remaining = await tx.query<{ n: number }>(`select count(*)::int as n from public.lab_results where user_id = $1 and verification_status in ('REVIEW','UNVERIFIED')`, [userId]);
    return { confirmed, rejected, duplicatesLinked, remaining: Number(remaining.rows[0]!.n) };
  });
  await audit(pool, { userId, actor: 'user', action: 'LAB_REVIEW', entity: 'lab_results', details: { confirmed: res.confirmed, rejected: res.rejected } });
  return res;
}

export async function createManualLabResult(pool: pg.Pool, userId: string, input: ManualLabResultInput, now: Date = new Date()): Promise<{ result: LabResult; created: boolean }> {
  const nowIso = now.toISOString();
  return withUser(pool, userId, async (tx) => {
    const externalId = `manual:${input.clientEntryId}`;
    const existing = await tx.query<LabRow>(`select ${LAB_COLS} from public.lab_results where user_id = $1 and source_connector = 'manual' and external_id = $2`, [userId, externalId]);
    if (existing.rows[0]) return { result: rowToLabResult(existing.rows[0]), created: false };
    const analyteId = mapAnalyte(input.analyteRawName, input.loinc ?? null);
    const unit = normalizeLabUnit(input.unit ?? null);
    const canon = toCanonicalLab(analyteId, input.value ?? null, unit);
    const row: LabRowInput = { index: 0, analyteRawName: input.analyteRawName, analyteId, analyteKey: analyteKey(input.analyteRawName, analyteId), loinc: input.loinc ?? null, value: input.value ?? null, valueText: input.valueText ?? null, unit, canonicalValue: canon.canonicalValue, canonicalUnit: canon.canonicalUnit, referenceLow: input.referenceLow ?? null, referenceHigh: input.referenceHigh ?? null, referenceText: input.referenceLow != null || input.referenceHigh != null ? `${input.referenceLow ?? ''}-${input.referenceHigh ?? ''}` : null, abnormalFlag: normalizeAbnormalFlag(input.abnormalFlag ?? null), collectedAt: input.collectedAt, resultedAt: null, laboratory: input.laboratory ?? null, provider: input.provider ?? null, panel: null, method: null, extractionConfidence: 1, flags: ['MANUAL_ENTRY', ...canon.flags] };
    await stageLabRow(tx, userId, { ...row, externalId }, { source: 'manual', documentId: null, panelId: null, panelName: null, verificationStatus: 'CONFIRMED', externalIdPrefix: 'manual', recordType: 'ManualLabResult' }, nowIso);
    const created = await tx.query<LabRow>(`select ${LAB_COLS} from public.lab_results where user_id = $1 and source_connector = 'manual' and external_id = $2`, [userId, externalId]);
    await tx.query(`update public.lab_results set reviewed_at = $3 where user_id = $1 and id = $2`, [userId, created.rows[0]!.id, nowIso]);
    await linkLabDuplicates(tx, userId, [created.rows[0]!.id]);
    await tx.query(
      `insert into public.source_connections (user_id, connector, status, last_sync_attempt_at, last_successful_sync_at, last_sync_status) values ($1, 'manual', 'CONNECTED', $2, $2, 'SUCCESS')
       on conflict (user_id, connector) do update set status = 'CONNECTED', last_sync_attempt_at = excluded.last_sync_attempt_at, last_successful_sync_at = excluded.last_successful_sync_at, last_sync_status = 'SUCCESS'`,
      [userId, nowIso],
    );
    const fresh = await tx.query<LabRow>(`select ${LAB_COLS} from public.lab_results where user_id = $1 and id = $2`, [userId, created.rows[0]!.id]);
    return { result: rowToLabResult(fresh.rows[0]!), created: true };
  });
}

function point(r: LabRow) {
  return { id: r.id, collectedAt: iso(r.collected_at), value: r.value, valueText: r.value_text, unit: r.unit, canonicalValue: r.canonical_value, canonicalUnit: r.canonical_unit, abnormalFlag: r.abnormal_flag, referenceText: r.reference_text, referenceLow: r.reference_low, referenceHigh: r.reference_high, source: r.source_connector as LabResult['source'], laboratory: r.laboratory, canonical: r.canonical, verificationStatus: r.verification_status as LabResult['verificationStatus'], qualityFlags: r.quality_flags ?? [] };
}

export function isFlagged(r: { abnormal_flag: string | null; quality_flags: string[] }): boolean {
  return Boolean(r.abnormal_flag && r.abnormal_flag !== 'N') || (r.quality_flags ?? []).includes('OUTSIDE_REPORTED_RANGE');
}

export async function labsOverviewTx(tx: Tx, userId: string, now: Date): Promise<LabsOverviewResponse> {
  const rows = await tx.query<LabRow>(`select ${LAB_COLS} from public.lab_results where user_id = $1 and verification_status = 'CONFIRMED' order by collected_at desc nulls last, created_at desc`, [userId]);
  const byKey = new Map<string, LabRow[]>();
  for (const r of rows.rows) byKey.set(r.analyte, [...(byKey.get(r.analyte) ?? []), r]);
  const summaries: LabsOverviewResponse['analytes'] = [];
  const build = (key: string, list: LabRow[]) => {
    const def = LAB_ANALYTES.find((a) => a.id === key);
    const canonicalRows = list.filter((r) => r.canonical);
    const latest = canonicalRows[0] ?? null;
    const previous = canonicalRows[1] ?? null;
    const dir = labDirection(latest ? { collectedAt: iso(latest.collected_at) ?? '', canonicalValue: latest.canonical_value, value: latest.value, unit: latest.unit } : null, previous ? { collectedAt: iso(previous.collected_at) ?? '', canonicalValue: previous.canonical_value, value: previous.value, unit: previous.unit } : null);
    summaries.push({ analyteKey: key, analyteId: def?.id ?? null, label: def?.label ?? list[0]!.analyte_raw_name, loinc: def?.loinc ?? list[0]!.loinc ?? null, canonicalUnit: def?.unit ?? null, mapped: Boolean(def), latest: latest ? point(latest) : null, previous: previous ? point(previous) : null, direction: dir.direction, delta: dir.delta, deltaPct: dir.deltaPct, count: canonicalRows.length, flaggedLatest: latest ? isFlagged(latest) : false, history: list.slice(0, 40).map(point) });
  };
  for (const a of LAB_ANALYTES) if (byKey.has(a.id)) build(a.id, byKey.get(a.id)!);
  for (const [key, list] of byKey) if (!LAB_ANALYTE_IDS.has(key)) build(key, list);
  const pending = await tx.query<{ n: number }>(`select count(*)::int as n from public.lab_results where user_id = $1 and verification_status in ('REVIEW','UNVERIFIED')`, [userId]);
  const docs = await tx.query<{ id: string; kind: string; title: string; provider: string | null; document_date: Date | null; uploaded_at: Date; extraction_status: string; page_count: number | null; size_bytes: number | null; staged: number; confirmed: number }>(
    `select d.id, d.kind, d.title, d.provider, d.document_date, d.uploaded_at, d.extraction_status, d.page_count, d.size_bytes,
            (select count(*)::int from public.lab_results l where l.document_id = d.id and l.verification_status in ('REVIEW','UNVERIFIED')) as staged,
            (select count(*)::int from public.lab_results l where l.document_id = d.id and l.verification_status = 'CONFIRMED') as confirmed
     from public.documents d where d.user_id = $1 and d.kind in ('LAB_PDF','LAB_CSV') order by d.uploaded_at desc limit 50`,
    [userId],
  );
  const latestCollected = rows.rows.find((r) => r.collected_at)?.collected_at ?? null;
  return {
    generatedAt: now.toISOString(),
    analytes: summaries,
    pendingReview: Number(pending.rows[0]!.n),
    latestCollectedAt: iso(latestCollected),
    sources: [...new Set(rows.rows.map((r) => r.source_connector))],
    documents: docs.rows.map((d) => ({ id: d.id, kind: d.kind, title: d.title, provider: d.provider, documentDate: d.document_date ? new Date(d.document_date).toISOString().slice(0, 10) : null, uploadedAt: new Date(d.uploaded_at).toISOString(), extractionStatus: d.extraction_status, pageCount: d.page_count, sizeBytes: d.size_bytes == null ? null : Number(d.size_bytes), resultsStaged: Number(d.staged), resultsConfirmed: Number(d.confirmed) })),
    notes: [
      'Reference ranges and abnormal flags are shown exactly as the laboratory reported them; they are not interpreted or re-derived except the OUTSIDE_REPORTED_RANGE flag when a lab reported a range but no flag.',
      'Values are converted to a canonical unit only when an explicit factor exists; otherwise the reported unit stands and the result is excluded from direction comparisons.',
      'Imported results are staged for review before they count. The same result from two sources (e.g. a Function export and a clinical record) is linked, never counted twice.',
    ],
  };
}

export async function labsOverview(pool: pg.Pool, userId: string, now: Date = new Date()): Promise<LabsOverviewResponse> {
  return withUser(pool, userId, (tx) => labsOverviewTx(tx, userId, now));
}

/** Evidence for the Clinical & preventive domain card on Today (no diagnosis; counts and dates only). */
export async function clinicalDomainEvidence(tx: Tx, userId: string, today: string): Promise<{ confirmedResults: number; latestCollectedAt: string | null; flaggedLatestPanel: number; pendingReview: number; preventiveDue: number; preventiveDueSoon: number; evidence: string[] }> {
  const latest = await tx.query<{ n: number; latest: Date | null }>(`select count(*)::int as n, max(collected_at) as latest from public.lab_results where user_id = $1 and verification_status = 'CONFIRMED' and canonical`, [userId]);
  const n = Number(latest.rows[0]!.n);
  const latestAt = iso(latest.rows[0]!.latest);
  let flagged = 0;
  if (latestAt) {
    const panel = await tx.query<{ abnormal_flag: string | null; quality_flags: string[] }>(`select abnormal_flag, quality_flags from public.lab_results where user_id = $1 and verification_status = 'CONFIRMED' and canonical and collected_at >= $2::timestamptz - interval '2 days'`, [userId, latestAt]);
    flagged = panel.rows.filter(isFlagged).length;
  }
  const pending = await tx.query<{ n: number }>(`select count(*)::int as n from public.lab_results where user_id = $1 and verification_status in ('REVIEW','UNVERIFIED')`, [userId]);
  const prev = await tx.query<{ status: string; last_completed_at: Date | null; interval_months: number | null; due_at: Date | null }>(`select status, last_completed_at, interval_months, due_at from public.preventive_care_items where user_id = $1`, [userId]);
  const { preventiveStatus } = await import('@bho/analytics');
  let due = 0;
  let dueSoon = 0;
  for (const p of prev.rows) {
    const s = preventiveStatus({ status: p.status, lastCompletedAt: p.last_completed_at ? new Date(p.last_completed_at).toISOString().slice(0, 10) : null, intervalMonths: p.interval_months, dueAt: p.due_at ? new Date(p.due_at).toISOString().slice(0, 10) : null }, today).status;
    if (s === 'DUE') due++;
    else if (s === 'DUE_SOON') dueSoon++;
  }
  const evidence: string[] = [];
  if (n > 0) evidence.push(`${n} confirmed lab result${n === 1 ? '' : 's'}; latest panel collected ${latestAt!.slice(0, 10)}${flagged ? ` with ${flagged} lab-flagged value${flagged === 1 ? '' : 's'}` : ', none flagged by the lab'}.`);
  else evidence.push('No confirmed lab results yet: import a Function Health export, connect clinical records, or enter results manually.');
  if (Number(pending.rows[0]!.n) > 0) evidence.push(`${pending.rows[0]!.n} imported result(s) waiting for your review.`);
  if (due > 0) evidence.push(`${due} preventive-care item${due === 1 ? '' : 's'} due.`);
  if (dueSoon > 0) evidence.push(`${dueSoon} preventive-care item${dueSoon === 1 ? '' : 's'} due within 60 days.`);
  return { confirmedResults: n, latestCollectedAt: latestAt, flaggedLatestPanel: flagged, pendingReview: Number(pending.rows[0]!.n), preventiveDue: due, preventiveDueSoon: dueSoon, evidence };
}
