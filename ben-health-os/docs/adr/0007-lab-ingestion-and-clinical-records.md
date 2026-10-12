# ADR 0007 — Laboratory ingestion, PDF handling and clinical records

**Status:** accepted (2026-10-12)

## Context
Function Health provides results as PDF downloads (official FAQ); a CSV export is unverified. Clinical
records for Weill Cornell and NYU Langone are reachable only through Epic patient-access FHIR after an
app registration Ben has not made yet. The spec requires a general lab ingestion engine with full
provenance, unit normalisation that never silently mixes methods or units, and a review-and-confirm
interface for PDFs.

## Decisions
1. **Text layer only, no OCR.** PDFs are read with pdf.js (`pdfjs-dist` legacy build) and lines are
   reconstructed from text items. Scanned PDFs yield no rows and the user is told to transcribe;
   nothing is guessed from images. Every extracted row carries an extraction confidence and is staged
   (`verification_status = REVIEW`) until the user confirms or rejects it, with corrections recorded as
   `CORRECTED_AT_REVIEW`.
2. **Explicit unit factors per analyte.** Conversions live in `services/analytics/src/labs.ts` with
   their constants (cholesterol 38.67, triglycerides 88.57, glucose 18.0182, HbA1c IFCC→NGSP master
   equation, creatinine 88.42, 25-OH vitamin D 2.496, B12 0.7378, free T4 12.87, insulin 6.945,
   haemoglobin g/L ÷10). Anything else (e.g. Lp(a) mg/dL ↔ nmol/L, which depends on isoform) is kept as
   reported, flagged `UNIT_NOT_CONVERTIBLE`, and excluded from direction comparisons.
3. **Lab-reported ranges and flags are never re-derived**, except the quality flag
   `OUTSIDE_REPORTED_RANGE` when a laboratory reported a range but no flag. No interpretation is shown.
4. **Clinical FHIR laboratory Observations are confirmed on import** (they are the laboratory's own
   record delivered through the clinician's system); file and PDF imports are staged. Duplicates across
   sources are linked by the source priority `clinical_fhir > function_health > file_import > manual`.
5. **Epic endpoints are mirrored, not queried at runtime**, as Epic asks; the two organizations are
   pinned in `services/integrations/src/fhir/endpoints.ts` and refreshed by hand. SMART standalone
   launch uses discovery (`/.well-known/smart-configuration`), PKCE S256 and the `aud` parameter.
6. **Drug-interaction checking is NOT IMPLEMENTED.** No verified clinical interaction source is
   integrated, so the Medications page states this instead of simulating checks.
7. **Documents stay on disk** under `DOCUMENT_STORAGE_DIR` (sha256-named, per user); the database keeps
   metadata only. Generated physician briefs are documents too and are part of export/delete-all.

## Consequences
- Lab history is comparable only when canonical units exist; the explorer says "not comparable"
  rather than drawing a misleading trend.
- Real Function Health PDFs have not been seen by this codebase: extraction is TESTED WITH MOCK DATA
  on a synthetic text-layer PDF, and the first real import should be reviewed line by line.
