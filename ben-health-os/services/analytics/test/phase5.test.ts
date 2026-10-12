import { describe, expect, it } from 'vitest';
import { addMonths, detectLabCsvMapping, extractLabsFromText, findLabDuplicate, labDirection, mapAnalyte, normalizeAbnormalFlag, parseLabCsv, parseReferenceRange, preventiveStatus, toCanonicalLab } from '../src/labs.js';

describe('lab analyte mapping and units', () => {
  it('maps names and LOINC codes to catalog analytes and leaves unknowns unmapped', () => {
    expect(mapAnalyte('Apolipoprotein B')).toBe('apob');
    expect(mapAnalyte('LDL Cholesterol Calc (NIH)')).toBe('ldl_c');
    expect(mapAnalyte('Cholesterol, LDL')).toBe('ldl_c');
    expect(mapAnalyte('Hemoglobin A1c')).toBe('hba1c');
    expect(mapAnalyte('Glucose')).toBeNull(); // a plain glucose is never assumed to be fasting
    expect(mapAnalyte('Something Else', '4548-4')).toBe('hba1c');
    expect(mapAnalyte('Vitamin D, 25-Hydroxy')).toBe('vitamin_d_25oh');
    expect(mapAnalyte('eGFR (CKD-EPI 2021)')).toBe('egfr');
    expect(mapAnalyte('Creatinine (serum)')).toBe('creatinine');
    expect(detectLabCsvMapping(['Test', 'Value', 'Unit']).usable).toBe(true);
  });
  it('converts units only with explicit factors and refuses the rest', () => {
    expect(toCanonicalLab('ldl_c', 2.6, 'mmol/L')).toMatchObject({ canonicalValue: 100.542, canonicalUnit: 'mg/dL' });
    expect(toCanonicalLab('hba1c', 42, 'mmol/mol').canonicalValue).toBeCloseTo(5.99, 2);
    expect(toCanonicalLab('vitamin_d_25oh', 75, 'nmol/L').canonicalValue).toBeCloseTo(30.05, 1);
    expect(toCanonicalLab('lp_a', 30, 'mg/dL')).toMatchObject({ canonicalValue: null, flags: ['UNIT_NOT_CONVERTIBLE:mg/dL→nmol/L'] });
    expect(toCanonicalLab('apob', 95, 'MG/DL')).toMatchObject({ canonicalValue: 95, canonicalUnit: 'mg/dL', flags: [] });
    expect(toCanonicalLab(null, 5, 'x').canonicalValue).toBeNull();
    expect(toCanonicalLab('ferritin', 80, null).flags).toEqual(['UNIT_MISSING']);
    expect(toCanonicalLab('egfr', 92, 'mL/min/1.73 m2')).toMatchObject({ canonicalValue: 92, canonicalUnit: 'mL/min/1.73m²' });
  });
  it('parses reference ranges, flags and comparator values', () => {
    expect(parseReferenceRange('0.0-2.9')).toMatchObject({ low: 0, high: 2.9 });
    expect(parseReferenceRange('< 90')).toMatchObject({ low: null, high: 90 });
    expect(parseReferenceRange('>=60')).toMatchObject({ low: 60, high: null });
    expect(parseReferenceRange('Not established')).toMatchObject({ low: null, high: null, text: 'Not established' });
    expect(normalizeAbnormalFlag('High')).toBe('H');
    expect(normalizeAbnormalFlag('critical low')).toBe('LL');
    expect(normalizeAbnormalFlag(null)).toBeNull();
  });
});

describe('lab CSV import', () => {
  const csv = `Biomarker,Result,Units,Reference Range,Flag,Date Collected,Lab,Category
Apolipoprotein B,78,mg/dL,< 90,,2026-09-20,Quest Diagnostics,Heart
LDL Cholesterol,2.8,mmol/L,< 2.6,H,2026-09-20,Quest Diagnostics,Heart
Hemoglobin A1c,5.4,%,4.0-5.6,,2026-09-20,Quest Diagnostics,Metabolic
Lp(a),45,mg/dL,< 30,H,2026-09-20,Quest Diagnostics,Heart
Glucose,91,mg/dL,65-99,,2026-09-20,Quest Diagnostics,Metabolic
hs-CRP,< 0.3,mg/L,0.0-3.0,,09/20/2026,Quest Diagnostics,Inflammation
Random,,mg/dL,,,2026-09-20,,`;
  it('maps headers, normalises values, converts units, flags out-of-range and unconvertible units', () => {
    const { mapping, rows, warnings } = parseLabCsv(csv);
    expect(mapping.usable).toBe(true);
    expect(mapping).toMatchObject({ analyteColumn: 'Biomarker', valueColumn: 'Result', unitColumn: 'Units', referenceColumn: 'Reference Range', flagColumn: 'Flag', collectedColumn: 'Date Collected', laboratoryColumn: 'Lab', panelColumn: 'Category' });
    expect(rows).toHaveLength(6);
    expect(warnings[0]).toContain('no value');
    const ldl = rows[1]!;
    expect(ldl).toMatchObject({ analyteId: 'ldl_c', canonicalValue: 108.276, canonicalUnit: 'mg/dL', abnormalFlag: 'H', referenceHigh: 2.6, collectedAt: '2026-09-20', laboratory: 'Quest Diagnostics', panel: 'Heart' });
    expect(ldl.flags).toContain('UNIT_CONVERTED:mmol/L→mg/dL');
    expect(rows[3]!.flags).toContain('UNIT_NOT_CONVERTIBLE:mg/dL→nmol/L');
    expect(rows[4]).toMatchObject({ analyteId: null, analyteKey: 'raw:glucose', canonicalValue: null });
    expect(rows[5]).toMatchObject({ value: 0.3, valueText: '< 0.3', collectedAt: '2026-09-20' });
    expect(rows[5]!.flags).toContain('VALUE_COMPARATOR:<');
    expect(rows[0]!.flags).not.toContain('OUTSIDE_REPORTED_RANGE');
  });
  it('derives OUTSIDE_REPORTED_RANGE only when the lab reported no flag', () => {
    const { rows } = parseLabCsv('Test,Value,Unit,Ref Low,Ref High,Collected\nFerritin,420,ng/mL,30,400,2026-01-05');
    expect(rows[0]).toMatchObject({ analyteId: 'ferritin', referenceLow: 30, referenceHigh: 400, abnormalFlag: null });
    expect(rows[0]!.flags).toContain('OUTSIDE_REPORTED_RANGE');
  });
  it('refuses layouts without a name and a value column', () => {
    const { mapping, rows, warnings } = parseLabCsv('a,b\n1,2');
    expect(mapping.usable).toBe(false);
    expect(rows).toEqual([]);
    expect(warnings[0]).toMatch(/analyte/);
  });
});

describe('lab PDF text extraction', () => {
  it('extracts result lines with confidence, dates and laboratory; everything is staged', () => {
    const lines = ['Quest Diagnostics', 'Patient: SYNTHETIC PERSON', 'Collected: 09/20/2026', 'Reported: 09/22/2026', 'Lipid Panel', 'Apolipoprotein B 78 mg/dL <90', 'LDL Cholesterol Calc (NIH) 112 mg/dL <100 H', 'Triglycerides 95 mg/dL <150', 'Vitamin D, 25-Hydroxy 31 ng/mL 30-100', 'Page 1 of 2'];
    const ex = extractLabsFromText(lines);
    expect(ex.collectedAt).toBe('2026-09-20');
    expect(ex.resultedAt).toBe('2026-09-22');
    expect(ex.laboratory).toBe('Quest Diagnostics');
    expect(ex.rows.map((r) => r.analyteId)).toEqual(['apob', 'ldl_c', 'triglycerides', 'vitamin_d_25oh']);
    expect(ex.rows[1]).toMatchObject({ value: 112, unit: 'mg/dL', referenceHigh: 100, abnormalFlag: 'H', panel: 'Lipid Panel', collectedAt: '2026-09-20' });
    expect(ex.rows[0]!.extractionConfidence).toBeGreaterThanOrEqual(0.9);
    expect(ex.rows.every((r) => r.flags.includes('EXTRACTED_FROM_PDF_TEXT'))).toBe(true);
    const none = extractLabsFromText(['just prose', 'nothing here 2026']);
    expect(none.rows).toEqual([]);
    expect(none.warnings[0]).toMatch(/No result lines/);
  });
});

describe('lab dedup, direction and preventive status', () => {
  it('links the same result from a lower-priority source and leaves different values alone', () => {
    const fhir = { id: 'a', analyteKey: 'apob', collectedAt: '2026-09-20', canonicalValue: 78, value: 78, unit: 'mg/dL', source: 'clinical_fhir' };
    const csv = { id: 'b', analyteKey: 'apob', collectedAt: '2026-09-21', canonicalValue: 78.5, value: 78.5, unit: 'mg/dL', source: 'function_health' };
    expect(findLabDuplicate(csv, [fhir])).toMatchObject({ canonical: { id: 'a' }, duplicate: { id: 'b' }, reason: 'SAME_RESULT_OTHER_SOURCE:clinical_fhir' });
    expect(findLabDuplicate({ ...csv, canonicalValue: 90, value: 90 }, [fhir])).toBeNull();
    expect(findLabDuplicate({ ...csv, collectedAt: '2026-10-01' }, [fhir])).toBeNull();
    const manual = { ...csv, id: 'c', source: 'manual' };
    expect(findLabDuplicate(fhir, [manual])!.duplicate.id).toBe('c');
  });
  it('computes direction from comparable values only', () => {
    expect(labDirection({ collectedAt: '2026-09-20', canonicalValue: 78, value: 78, unit: 'mg/dL' }, { collectedAt: '2026-03-01', canonicalValue: 95, value: 95, unit: 'mg/dL' })).toMatchObject({ direction: 'DOWN', delta: -17, deltaPct: -17.9 });
    expect(labDirection({ collectedAt: 'x', canonicalValue: null, value: 1.2, unit: 'g/L' }, { collectedAt: 'y', canonicalValue: null, value: 100, unit: 'mg/dL' }).direction).toBeNull();
    expect(labDirection({ collectedAt: 'x', canonicalValue: 100, value: 100, unit: 'u' }, { collectedAt: 'y', canonicalValue: 98, value: 98, unit: 'u' }).direction).toBe('FLAT');
  });
  it('derives DUE / DUE_SOON / COMPLETED and preserves clinician-discussion statuses', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(preventiveStatus({ status: 'COMPLETED', lastCompletedAt: '2025-01-15', intervalMonths: 12, dueAt: null }, '2026-10-12')).toMatchObject({ status: 'DUE', dueAt: '2026-01-15' });
    expect(preventiveStatus({ status: 'COMPLETED', lastCompletedAt: '2025-11-01', intervalMonths: 12, dueAt: null }, '2026-10-12')).toMatchObject({ status: 'DUE_SOON', dueAt: '2026-11-01', daysUntilDue: 20 });
    expect(preventiveStatus({ status: 'COMPLETED', lastCompletedAt: '2026-06-01', intervalMonths: 12, dueAt: null }, '2026-10-12').status).toBe('COMPLETED');
    expect(preventiveStatus({ status: 'DISCUSS_WITH_CLINICIAN', lastCompletedAt: null, intervalMonths: 12, dueAt: null }, '2026-10-12').status).toBe('DISCUSS_WITH_CLINICIAN');
    expect(preventiveStatus({ status: 'DUE', lastCompletedAt: null, intervalMonths: null, dueAt: '2026-12-01' }, '2026-10-12').status).toBe('DUE_SOON');
  });
});
