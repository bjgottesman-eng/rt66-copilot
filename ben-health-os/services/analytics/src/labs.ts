/**
 * Laboratory ingestion engine (Phase 5): analyte mapping, unit normalization with explicit factors,
 * reference-range and flag parsing, CSV header mapping, PDF text-line extraction with confidence, and
 * conservative cross-source dedup. Nothing here interprets results clinically.
 */
import { LAB_ANALYTES, priorityRank } from '@bho/shared-config';
import { parseCsv } from './csv.js';
import { normalizeDay } from './nutrition.js';

export const LAB_ANALYTE_IDS = new Set(LAB_ANALYTES.map((a) => a.id));

const ALIASES: Record<string, string[]> = {
  apob: ['apob', 'apo b', 'apolipoprotein b', 'apolipoprotein b-100', 'apo-b'],
  ldl_c: ['ldl', 'ldl-c', 'ldl c', 'ldl cholesterol', 'ldl-cholesterol', 'ldl chol calc', 'ldl cholesterol calc', 'ldl cholesterol (calculated)', 'ldl cholesterol calc (nih)', 'direct ldl', 'ldl, direct'],
  non_hdl_c: ['non-hdl cholesterol', 'non hdl cholesterol', 'non-hdl-c', 'non-hdl', 'non hdl'],
  hdl_c: ['hdl', 'hdl-c', 'hdl c', 'hdl cholesterol', 'hdl-cholesterol'],
  triglycerides: ['triglycerides', 'triglyceride', 'tg', 'trig', 'triglycerides, serum'],
  lp_a: ['lp(a)', 'lipoprotein (a)', 'lipoprotein(a)', 'lipoprotein a', 'lp (a)'],
  hba1c: ['hba1c', 'a1c', 'hemoglobin a1c', 'hemoglobin a1c (hba1c)', 'glycated hemoglobin', 'glycohemoglobin', 'hgb a1c'],
  fasting_glucose: ['fasting glucose', 'glucose, fasting', 'glucose fasting', 'glucose (fasting)', 'fasting plasma glucose', 'fpg'],
  fasting_insulin: ['fasting insulin', 'insulin, fasting', 'insulin fasting', 'insulin (fasting)'],
  hs_crp: ['hs-crp', 'hscrp', 'hs crp', 'c-reactive protein, high sensitivity', 'high sensitivity crp', 'high-sensitivity c-reactive protein', 'crp, high sensitivity', 'c-reactive protein (hs)', 'crp (hs)', 'hs-c-reactive protein'],
  creatinine: ['creatinine', 'creatinine, serum', 'serum creatinine', 'creatinine (serum)'],
  egfr: ['egfr', 'estimated gfr', 'gfr, estimated', 'egfr (ckd-epi 2021)', 'egfr ckd-epi', 'estimated glomerular filtration rate', 'gfr estimate'],
  cystatin_c: ['cystatin c', 'cystatin-c', 'cystatin c, serum'],
  alt: ['alt', 'alt (sgpt)', 'alanine aminotransferase', 'sgpt', 'alt, serum'],
  ast: ['ast', 'ast (sgot)', 'aspartate aminotransferase', 'sgot', 'ast, serum'],
  ggt: ['ggt', 'gamma-glutamyl transferase', 'gamma glutamyl transferase', 'gamma gt', 'ggtp'],
  vitamin_d_25oh: ['vitamin d', 'vitamin d, 25-hydroxy', 'vitamin d 25-hydroxy', '25-hydroxyvitamin d', '25-oh vitamin d', 'vitamin d 25-oh', 'vitamin d (25-oh)', 'vitamin d, 25-oh, total', '25-hydroxy vitamin d', 'vitamin d, 25-oh'],
  ferritin: ['ferritin', 'ferritin, serum'],
  vitamin_b12: ['vitamin b12', 'vitamin b-12', 'b12', 'cobalamin', 'vitamin b 12'],
  tsh: ['tsh', 'thyroid stimulating hormone', 'thyrotropin', 'tsh, 3rd generation', 'tsh (thyroid stimulating hormone)'],
  free_t4: ['free t4', 't4, free', 't4 free', 'ft4', 'free thyroxine', 'thyroxine (t4), free', 'thyroxine, free'],
  hemoglobin: ['hemoglobin', 'hgb', 'hb', 'haemoglobin'],
};
const ALIAS_INDEX = new Map<string, string>();
for (const [id, names] of Object.entries(ALIASES)) for (const n of names) ALIAS_INDEX.set(n, id);
const LOINC_INDEX = new Map(LAB_ANALYTES.filter((a) => a.loinc).map((a) => [a.loinc!, a.id]));
/** Additional LOINC codes that map to the same catalog analyte (different methods / specimen descriptions). */
const EXTRA_LOINC: Record<string, string> = {
  '18262-6': 'ldl_c', '2089-1': 'ldl_c', '39469-2': 'ldl_c', '2093-3': 'total_cholesterol', '17855-8': 'hba1c', '17856-6': 'hba1c', '2345-7': 'fasting_glucose_nonfasting',
  '1986-9': 'vitamin_d_25oh', '62292-8': 'vitamin_d_25oh', '48642-3': 'egfr', '48643-1': 'egfr', '62238-1': 'egfr', '33914-3': 'egfr', '1751-7': 'alt', '30239-8': 'ast', '2324-2': 'ggt', '11580-8': 'tsh', '14920-3': 'free_t4', '20509-6': 'hemoglobin', '30313-1': 'hemoglobin',
};

export function normalizeAnalyteName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[:*]+$/g, '')
    .trim();
}

/** Catalog analyte id for a LOINC code or a reported name; null when unmapped (kept under its raw name). */
export function mapAnalyte(rawName: string, loinc?: string | null): string | null {
  if (loinc) {
    const code = loinc.trim();
    const viaCatalog = LOINC_INDEX.get(code);
    if (viaCatalog) return viaCatalog;
    const extra = EXTRA_LOINC[code];
    if (extra && LAB_ANALYTE_IDS.has(extra)) return extra;
  }
  const n = normalizeAnalyteName(rawName);
  const direct = ALIAS_INDEX.get(n);
  if (direct) return direct;
  // "Cholesterol, LDL" style and parenthetical suffixes such as "(serum)"
  const stripped = n.replace(/\((serum|plasma|blood|whole blood)\)/g, '').replace(/,\s*(serum|plasma|blood)$/g, '').trim();
  if (ALIAS_INDEX.has(stripped)) return ALIAS_INDEX.get(stripped)!;
  const swapped = stripped.includes(',') ? stripped.split(',').map((s) => s.trim()).reverse().join(' ') : null;
  if (swapped && ALIAS_INDEX.has(swapped)) return ALIAS_INDEX.get(swapped)!;
  return null;
}

/** Slug used as the analyte key for unmapped results so their history still groups together. */
export function analyteKey(rawName: string, mapped: string | null): string {
  return mapped ?? `raw:${normalizeAnalyteName(rawName).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

const LAB_UNIT_ALIASES: Record<string, string> = {
  'mg/dl': 'mg/dL', 'mmol/l': 'mmol/L', 'g/l': 'g/L', 'g/dl': 'g/dL', 'mg/l': 'mg/L', 'ng/ml': 'ng/mL', 'pg/ml': 'pg/mL', 'ug/l': 'µg/L', 'µg/l': 'µg/L', 'mcg/l': 'µg/L',
  'umol/l': 'µmol/L', 'µmol/l': 'µmol/L', 'pmol/l': 'pmol/L', 'nmol/l': 'nmol/L', 'uiu/ml': 'µIU/mL', 'µiu/ml': 'µIU/mL', 'miu/l': 'mIU/L', 'mu/l': 'mIU/L', 'u/l': 'U/L', 'iu/l': 'U/L', 'ukat/l': 'µkat/L', 'µkat/l': 'µkat/L',
  'mmol/mol': 'mmol/mol', '%': '%', 'percent': '%', 'ml/min/1.73m2': 'mL/min/1.73m²', 'ml/min/1.73m²': 'mL/min/1.73m²', 'ml/min/1.73 m2': 'mL/min/1.73m²', 'ml/min/1.73 m²': 'mL/min/1.73m²', 'ml/min/1.73': 'mL/min/1.73m²', 'ml/min/{1.73_m2}': 'mL/min/1.73m²',
  'nmol/l (lp(a))': 'nmol/L',
};
export function normalizeLabUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const t = unit.trim();
  if (!t) return null;
  return LAB_UNIT_ALIASES[t.toLowerCase()] ?? t;
}

/** Explicit conversions to each analyte's canonical unit. Anything missing is refused and flagged. */
const CHOL_MGDL_PER_MMOL = 38.67; // cholesterol molar mass 386.65 g/mol
const TG_MGDL_PER_MMOL = 88.57; // triglyceride (triolein) 885.4 g/mol
const GLUCOSE_MGDL_PER_MMOL = 18.0182;
const LAB_CONVERSIONS: Record<string, Record<string, (v: number) => number>> = {
  apob: { 'g/L': (v) => v * 100 },
  ldl_c: { 'mmol/L': (v) => v * CHOL_MGDL_PER_MMOL },
  hdl_c: { 'mmol/L': (v) => v * CHOL_MGDL_PER_MMOL },
  non_hdl_c: { 'mmol/L': (v) => v * CHOL_MGDL_PER_MMOL },
  triglycerides: { 'mmol/L': (v) => v * TG_MGDL_PER_MMOL },
  hba1c: { 'mmol/mol': (v) => 0.09148 * v + 2.152 }, // IFCC → NGSP master equation
  fasting_glucose: { 'mmol/L': (v) => v * GLUCOSE_MGDL_PER_MMOL },
  fasting_insulin: { 'pmol/L': (v) => v / 6.945, 'mIU/L': (v) => v },
  hs_crp: { 'mg/dL': (v) => v * 10 },
  creatinine: { 'µmol/L': (v) => v / 88.42 },
  cystatin_c: { 'ng/mL': (v) => v / 1000 },
  alt: { 'µkat/L': (v) => v * 60 },
  ast: { 'µkat/L': (v) => v * 60 },
  ggt: { 'µkat/L': (v) => v * 60 },
  vitamin_d_25oh: { 'nmol/L': (v) => v / 2.496 },
  ferritin: { 'µg/L': (v) => v },
  vitamin_b12: { 'pmol/L': (v) => v / 0.7378 },
  tsh: { 'µIU/mL': (v) => v },
  free_t4: { 'pmol/L': (v) => v / 12.87 },
  hemoglobin: { 'g/L': (v) => v / 10, 'mmol/L': (v) => v * 1.611 },
};

export function canonicalLabUnit(analyteId: string | null): string | null {
  return analyteId ? (LAB_ANALYTES.find((a) => a.id === analyteId)?.unit ?? null) : null;
}

export interface CanonicalLab {
  canonicalValue: number | null;
  canonicalUnit: string | null;
  flags: string[];
}

/** Converts a reported value to the analyte's canonical unit when an explicit factor exists; never guesses. */
export function toCanonicalLab(analyteId: string | null, value: number | null, unit: string | null): CanonicalLab {
  const target = canonicalLabUnit(analyteId);
  if (!analyteId || !target || value === null) return { canonicalValue: null, canonicalUnit: null, flags: [] };
  const u = normalizeLabUnit(unit);
  if (!u) return { canonicalValue: null, canonicalUnit: null, flags: ['UNIT_MISSING'] };
  if (u === target) return { canonicalValue: value, canonicalUnit: target, flags: [] };
  const fn = LAB_CONVERSIONS[analyteId]?.[u];
  if (!fn) return { canonicalValue: null, canonicalUnit: null, flags: [`UNIT_NOT_CONVERTIBLE:${u}→${target}`] };
  return { canonicalValue: Math.round(fn(value) * 1000) / 1000, canonicalUnit: target, flags: [`UNIT_CONVERTED:${u}→${target}`] };
}

export interface ReferenceRange {
  low: number | null;
  high: number | null;
  text: string | null;
}

/** "0.0-2.9", "< 90", ">40", "≥ 60", "3.4 - 5.6 mg/dL", "Not established" → bounds as reported. */
export function parseReferenceRange(raw: string | null | undefined): ReferenceRange {
  if (!raw) return { low: null, high: null, text: null };
  const text = raw.trim();
  if (!text) return { low: null, high: null, text: null };
  const s = text.replace(/[‐-―]/g, '-').replace(/,/g, '');
  let m = /^(?:<|<=|≤|less than|under)\s*(\d+(?:\.\d+)?)/i.exec(s);
  if (m) return { low: null, high: Number(m[1]), text };
  m = /^(?:>|>=|≥|greater than|over|above)\s*(\d+(?:\.\d+)?)/i.exec(s);
  if (m) return { low: Number(m[1]), high: null, text };
  m = /^(-?\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(-?\d+(?:\.\d+)?)/i.exec(s);
  if (m) return { low: Number(m[1]), high: Number(m[2]), text };
  return { low: null, high: null, text };
}

const FLAG_MAP: Record<string, string> = { h: 'H', high: 'H', hi: 'H', l: 'L', low: 'L', lo: 'L', hh: 'HH', ll: 'LL', 'critical high': 'HH', 'critical low': 'LL', a: 'A', abn: 'A', abnormal: 'A', n: 'N', normal: 'N', 'in range': 'N', 'out of range': 'A' };
/** Lab-reported abnormal flag normalised to H/L/HH/LL/A/N; unknown text is kept verbatim. */
export function normalizeAbnormalFlag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  return FLAG_MAP[t] ?? raw.trim();
}

export function parseLabValue(raw: string | null | undefined): { value: number | null; valueText: string | null; comparator: '<' | '>' | null } {
  if (raw === null || raw === undefined) return { value: null, valueText: null, comparator: null };
  const t = raw.trim().replace(/,/g, '');
  if (!t) return { value: null, valueText: null, comparator: null };
  const m = /^([<>]=?)?\s*(-?\d+(?:\.\d+)?)$/.exec(t);
  if (m) return { value: Number(m[2]), valueText: m[1] ? t : null, comparator: m[1] ? (m[1].startsWith('<') ? '<' : '>') : null };
  return { value: null, valueText: t, comparator: null };
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------
export interface LabCsvMapping {
  analyteColumn: string | null;
  loincColumn: string | null;
  valueColumn: string | null;
  unitColumn: string | null;
  referenceColumn: string | null;
  referenceLowColumn: string | null;
  referenceHighColumn: string | null;
  flagColumn: string | null;
  collectedColumn: string | null;
  resultedColumn: string | null;
  laboratoryColumn: string | null;
  providerColumn: string | null;
  panelColumn: string | null;
  methodColumn: string | null;
  ignoredColumns: string[];
  usable: boolean;
}

const P = {
  analyte: /^(test|tests|analyte|biomarker|marker|name|test name|result name|lab test|measure|measurement|parameter|biomarker name)$/i,
  loinc: /loinc/i,
  value: /^(value|result|results|result value|measured value|numeric result)$/i,
  unit: /^(unit|units|uom)$/i,
  reference: /^(reference|reference range|ref range|ref\.? range|range|normal range|reference interval|optimal range|standard range)$/i,
  refLow: /^(ref(erence)?[ _-]?(low|min|lower)|low|min|lower limit|range low)$/i,
  refHigh: /^(ref(erence)?[ _-]?(high|max|upper)|high|max|upper limit|range high)$/i,
  flag: /^(flag|flags|abnormal|abnormal flag|status|result flag|in range|out of range)$/i,
  collected: /^(date|collected|collection date|collected date|date collected|draw date|drawn|specimen date|date of service|service date|test date|sample date)$/i,
  resulted: /^(resulted|result date|reported|reported date|report date|date reported|date resulted)$/i,
  laboratory: /^(lab|laboratory|performing lab|performing laboratory)$/i,
  provider: /^(provider|ordering provider|ordered by|physician|doctor|clinician)$/i,
  panel: /^(panel|category|group|test group|section|biomarker category)$/i,
  method: /^(method|methodology|specimen)$/i,
};

export function detectLabCsvMapping(headers: string[]): LabCsvMapping {
  const clean = headers.map((h) => h.trim().replace(/\s+/g, ' '));
  const m: LabCsvMapping = { analyteColumn: null, loincColumn: null, valueColumn: null, unitColumn: null, referenceColumn: null, referenceLowColumn: null, referenceHighColumn: null, flagColumn: null, collectedColumn: null, resultedColumn: null, laboratoryColumn: null, providerColumn: null, panelColumn: null, methodColumn: null, ignoredColumns: [], usable: false };
  const assign = (key: keyof LabCsvMapping, h: string): boolean => {
    if (m[key] !== null) return false;
    (m as unknown as Record<string, string | null>)[key] = h;
    return true;
  };
  for (const h of clean) {
    if (P.loinc.test(h) && assign('loincColumn', h)) continue;
    if (P.analyte.test(h) && assign('analyteColumn', h)) continue;
    if (P.value.test(h) && assign('valueColumn', h)) continue;
    if (P.unit.test(h) && assign('unitColumn', h)) continue;
    if (P.refLow.test(h) && assign('referenceLowColumn', h)) continue;
    if (P.refHigh.test(h) && assign('referenceHighColumn', h)) continue;
    if (P.reference.test(h) && assign('referenceColumn', h)) continue;
    if (P.flag.test(h) && assign('flagColumn', h)) continue;
    if (P.resulted.test(h) && assign('resultedColumn', h)) continue;
    if (P.collected.test(h) && assign('collectedColumn', h)) continue;
    if (P.laboratory.test(h) && assign('laboratoryColumn', h)) continue;
    if (P.provider.test(h) && assign('providerColumn', h)) continue;
    if (P.panel.test(h) && assign('panelColumn', h)) continue;
    if (P.method.test(h) && assign('methodColumn', h)) continue;
    m.ignoredColumns.push(h);
  }
  m.usable = Boolean(m.analyteColumn && m.valueColumn);
  return m;
}

export interface LabRowInput {
  index: number;
  analyteRawName: string;
  analyteId: string | null;
  analyteKey: string;
  loinc: string | null;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  canonicalValue: number | null;
  canonicalUnit: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  referenceText: string | null;
  abnormalFlag: string | null;
  collectedAt: string | null; // YYYY-MM-DD
  resultedAt: string | null;
  laboratory: string | null;
  provider: string | null;
  panel: string | null;
  method: string | null;
  extractionConfidence: number;
  flags: string[];
}

export function finishLabRow(partial: Omit<LabRowInput, 'analyteId' | 'analyteKey' | 'canonicalValue' | 'canonicalUnit' | 'flags'> & { flags?: string[] }): LabRowInput {
  const analyteId = mapAnalyte(partial.analyteRawName, partial.loinc);
  const canon = toCanonicalLab(analyteId, partial.value, partial.unit);
  const flags = [...(partial.flags ?? []), ...canon.flags];
  if (partial.value !== null && (partial.referenceLow !== null || partial.referenceHigh !== null)) {
    const below = partial.referenceLow !== null && partial.value < partial.referenceLow;
    const above = partial.referenceHigh !== null && partial.value > partial.referenceHigh;
    if ((below || above) && !partial.abnormalFlag) flags.push('OUTSIDE_REPORTED_RANGE');
  }
  if (!partial.collectedAt) flags.push('COLLECTION_DATE_MISSING');
  return { ...partial, analyteId, analyteKey: analyteKey(partial.analyteRawName, analyteId), canonicalValue: canon.canonicalValue, canonicalUnit: canon.canonicalUnit, flags };
}

export function parseLabCsv(text: string, defaults: { collectedAt?: string | null; laboratory?: string | null } = {}): { mapping: LabCsvMapping; rows: LabRowInput[]; warnings: string[] } {
  const table = parseCsv(text);
  const warnings: string[] = [];
  if (table.length < 2) return { mapping: detectLabCsvMapping(table[0] ?? []), rows: [], warnings: ['CSV has no data rows'] };
  const headers = table[0]!.map((h) => h.trim().replace(/\s+/g, ' '));
  const mapping = detectLabCsvMapping(headers);
  const rows: LabRowInput[] = [];
  if (!mapping.usable) {
    warnings.push('Need at least an analyte/test name column and a value/result column');
    return { mapping, rows, warnings };
  }
  const col = (cells: string[], h: string | null) => (h ? (cells[headers.indexOf(h)] ?? '').trim() || null : null);
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const name = col(cells, mapping.analyteColumn);
    if (!name) continue;
    const v = parseLabValue(col(cells, mapping.valueColumn));
    if (v.value === null && v.valueText === null) {
      warnings.push(`row ${r + 1}: no value for "${name}" skipped`);
      continue;
    }
    const refText = col(cells, mapping.referenceColumn);
    const ref = parseReferenceRange(refText);
    const lowCol = col(cells, mapping.referenceLowColumn);
    const highCol = col(cells, mapping.referenceHighColumn);
    const collectedRaw = col(cells, mapping.collectedColumn);
    const collectedAt = collectedRaw ? normalizeDay(collectedRaw) : (defaults.collectedAt ?? null);
    if (collectedRaw && !collectedAt) warnings.push(`row ${r + 1}: unrecognised collection date "${collectedRaw}"`);
    const resultedRaw = col(cells, mapping.resultedColumn);
    rows.push(
      finishLabRow({
        index: r,
        analyteRawName: name,
        loinc: col(cells, mapping.loincColumn),
        value: v.value,
        valueText: v.valueText,
        unit: normalizeLabUnit(col(cells, mapping.unitColumn)),
        referenceLow: lowCol ? parseLabValue(lowCol).value : ref.low,
        referenceHigh: highCol ? parseLabValue(highCol).value : ref.high,
        referenceText: refText ?? (lowCol || highCol ? `${lowCol ?? ''}-${highCol ?? ''}` : null),
        abnormalFlag: normalizeAbnormalFlag(col(cells, mapping.flagColumn)),
        collectedAt,
        resultedAt: resultedRaw ? normalizeDay(resultedRaw) : null,
        laboratory: col(cells, mapping.laboratoryColumn) ?? defaults.laboratory ?? null,
        provider: col(cells, mapping.providerColumn),
        panel: col(cells, mapping.panelColumn),
        method: col(cells, mapping.methodColumn),
        extractionConfidence: 1,
        flags: v.comparator ? [`VALUE_COMPARATOR:${v.comparator}`] : [],
      }),
    );
  }
  return { mapping, rows, warnings };
}

// ---------------------------------------------------------------------------------------------
// PDF text layer
// ---------------------------------------------------------------------------------------------
const UNIT_RE = String.raw`(?:%|mg/dL|mg/dl|mmol/L|mmol/l|mmol/mol|g/dL|g/dl|g/L|mg/L|ng/mL|ng/ml|pg/mL|pg/ml|µg/L|ug/L|µmol/L|umol/L|pmol/L|nmol/L|µIU/mL|uIU/mL|mIU/L|U/L|IU/L|mL/min/1\.73m²|mL/min/1\.73m2|mL/min/1\.73|x10E3/uL|K/uL|10\*3/uL|M/uL|fL|pg|cells/uL|ratio)`;
const RANGE_RE = String.raw`(?:[<>≤≥]\s*=?\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?)`;
const LINE_RE = new RegExp(String.raw`^(?<name>[A-Za-z][A-Za-z0-9 ,()\-\/.%+]{1,60}?)\s+(?<value>[<>]?\s*\d+(?:\.\d+)?|Negative|Positive|Detected|Not Detected|Normal)\s*(?<unit>${UNIT_RE})?\s*(?<range>${RANGE_RE})?\s*(?<unit2>${UNIT_RE})?\s*(?<flag>HH|LL|H|L|A|High|Low|Abnormal|Critical High|Critical Low)?\s*$`, 'i');
const DATE_LINE_RE = /(collect(?:ed|ion)(?: date)?|date of service|service date|specimen collected|drawn|draw date|reported|resulted|report date|result date)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2,8} \d{1,2}, \d{4})/i;
const LAB_NAME_RE = /(quest diagnostics|labcorp|laboratory corporation of america|bioreference|function health|mayo clinic laboratories|arup)/i;

export interface LabTextExtraction {
  rows: LabRowInput[];
  collectedAt: string | null;
  resultedAt: string | null;
  laboratory: string | null;
  linesScanned: number;
  warnings: string[];
}

/** Line-based extraction from a PDF text layer. Every row is low-to-medium confidence and must be reviewed. */
export function extractLabsFromText(lines: string[], defaults: { collectedAt?: string | null; laboratory?: string | null } = {}): LabTextExtraction {
  let collectedAt: string | null = defaults.collectedAt ?? null;
  let resultedAt: string | null = null;
  let laboratory: string | null = defaults.laboratory ?? null;
  const rows: LabRowInput[] = [];
  const warnings: string[] = [];
  let panel: string | null = null;
  lines.forEach((rawLine, i) => {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) return;
    const d = DATE_LINE_RE.exec(line);
    if (d) {
      const day = normalizeDay(d[2]!);
      if (day) {
        if (/report|result/i.test(d[1]!)) resultedAt = resultedAt ?? day;
        else collectedAt = collectedAt ?? day;
      }
      return;
    }
    const lab = LAB_NAME_RE.exec(line);
    if (lab && !laboratory) laboratory = lab[1]!;
    if (/^(lipid panel|comprehensive metabolic panel|cbc|complete blood count|thyroid panel|iron panel|metabolic|hormones?|vitamins?|inflammation|kidney|liver|heart|cardiovascular|diabetes|nutrients?)\b/i.test(line) && !/\d/.test(line)) {
      panel = line;
      return;
    }
    const m = LINE_RE.exec(line);
    if (!m || !m.groups) return;
    const name = m.groups.name!.trim();
    if (/^(page|date|patient|dob|name|phone|fax|address|specimen|ordered|account|total|reference)\b/i.test(name)) return;
    const v = parseLabValue(m.groups.value!);
    const unit = normalizeLabUnit(m.groups.unit ?? m.groups.unit2 ?? null);
    const ref = parseReferenceRange(m.groups.range ?? null);
    const mapped = mapAnalyte(name, null);
    if (!mapped && !unit && ref.low === null && ref.high === null) return; // a bare "label number" line is not a result
    let confidence = 0.2;
    if (mapped) confidence += 0.35;
    if (unit) confidence += 0.2;
    if (ref.low !== null || ref.high !== null) confidence += 0.15;
    if (v.value !== null) confidence += 0.1;
    rows.push(
      finishLabRow({
        index: i + 1,
        analyteRawName: name,
        loinc: null,
        value: v.value,
        valueText: v.valueText,
        unit,
        referenceLow: ref.low,
        referenceHigh: ref.high,
        referenceText: ref.text,
        abnormalFlag: normalizeAbnormalFlag(m.groups.flag ?? null),
        collectedAt: null,
        resultedAt: null,
        laboratory: null,
        provider: null,
        panel,
        method: null,
        extractionConfidence: Math.round(confidence * 100) / 100,
        flags: ['EXTRACTED_FROM_PDF_TEXT'],
      }),
    );
  });
  for (const r of rows) {
    r.collectedAt = collectedAt;
    r.resultedAt = resultedAt;
    r.laboratory = laboratory;
    r.flags = r.flags.filter((f) => f !== 'COLLECTION_DATE_MISSING');
    if (!collectedAt) r.flags.push('COLLECTION_DATE_MISSING');
  }
  if (rows.length === 0) warnings.push('No result lines recognised in the text layer (scanned PDFs have no text layer; enter results manually).');
  if (!collectedAt) warnings.push('No collection date found; set it during review.');
  return { rows, collectedAt, resultedAt, laboratory, linesScanned: lines.length, warnings };
}

// ---------------------------------------------------------------------------------------------
// Dedup and history
// ---------------------------------------------------------------------------------------------
/** Source priority for lab results comes from shared config (`SOURCE_PRIORITY.lab_result`). */
export function labSourceRank(source: string): number {
  return priorityRank('lab_result', source);
}

export interface LabDedupCandidate {
  id: string;
  analyteKey: string;
  collectedAt: string | null;
  canonicalValue: number | null;
  value: number | null;
  unit: string | null;
  source: string;
}

/** Same analyte, collection within 1 day, comparable value within 1 % → the lower-priority source is the duplicate. */
export function findLabDuplicate(candidate: LabDedupCandidate, existing: LabDedupCandidate[]): { canonical: LabDedupCandidate; duplicate: LabDedupCandidate; reason: string } | null {
  if (!candidate.collectedAt) return null;
  const t0 = Date.parse(candidate.collectedAt);
  for (const e of existing) {
    if (e.id === candidate.id || e.analyteKey !== candidate.analyteKey || !e.collectedAt) continue;
    if (Math.abs(Date.parse(e.collectedAt) - t0) > 86_400_000) continue;
    const a = candidate.canonicalValue ?? (candidate.unit && candidate.unit === e.unit ? candidate.value : null);
    const b = e.canonicalValue ?? (e.unit && e.unit === candidate.unit ? e.value : null);
    if (a === null || b === null) continue;
    const tol = Math.max(0.01 * Math.max(Math.abs(a), Math.abs(b)), 0.005);
    if (Math.abs(a - b) > tol) continue;
    const candidateWins = labSourceRank(candidate.source) < labSourceRank(e.source);
    const canonical = candidateWins ? candidate : e;
    const duplicate = candidateWins ? e : candidate;
    return { canonical, duplicate, reason: `SAME_RESULT_OTHER_SOURCE:${canonical.source}` };
  }
  return null;
}

export interface LabHistoryPoint {
  collectedAt: string;
  canonicalValue: number | null;
  value: number | null;
  unit: string | null;
}

/** Direction of the latest confirmed result versus the previous one, on comparable values only. */
export function labDirection(latest: LabHistoryPoint | null, previous: LabHistoryPoint | null): { direction: 'UP' | 'DOWN' | 'FLAT' | null; delta: number | null; deltaPct: number | null } {
  if (!latest || !previous) return { direction: null, delta: null, deltaPct: null };
  const a = latest.canonicalValue ?? (latest.unit === previous.unit ? latest.value : null);
  const b = previous.canonicalValue ?? (latest.unit === previous.unit ? previous.value : null);
  if (a === null || b === null) return { direction: null, delta: null, deltaPct: null };
  const delta = a - b;
  const deltaPct = b !== 0 ? (delta / Math.abs(b)) * 100 : null;
  const direction = deltaPct !== null && Math.abs(deltaPct) < 5 ? 'FLAT' : delta > 0 ? 'UP' : delta < 0 ? 'DOWN' : 'FLAT';
  return { direction, delta: Math.round(delta * 1000) / 1000, deltaPct: deltaPct === null ? null : Math.round(deltaPct * 10) / 10 };
}

/** Preventive-care status from last completion and interval (algorithm preventive_status v1). */
export function preventiveStatus(item: { status: string; lastCompletedAt: string | null; intervalMonths: number | null; dueAt: string | null }, today: string): { status: string; dueAt: string | null; daysUntilDue: number | null } {
  if (item.status === 'NOT_APPLICABLE' || item.status === 'DISCUSS_WITH_CLINICIAN') return { status: item.status, dueAt: item.dueAt, daysUntilDue: item.dueAt ? daysBetweenDates(today, item.dueAt) : null };
  let dueAt = item.dueAt;
  if (!dueAt && item.lastCompletedAt && item.intervalMonths) dueAt = addMonths(item.lastCompletedAt, item.intervalMonths);
  if (!dueAt) return { status: item.lastCompletedAt ? 'COMPLETED' : item.status, dueAt: null, daysUntilDue: null };
  const days = daysBetweenDates(today, dueAt);
  if (days < 0) return { status: 'DUE', dueAt, daysUntilDue: days };
  if (days <= 60) return { status: 'DUE_SOON', dueAt, daysUntilDue: days };
  return { status: 'COMPLETED', dueAt, daysUntilDue: days };
}

function daysBetweenDates(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}
