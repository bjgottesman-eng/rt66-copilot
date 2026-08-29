/**
 * POST /ingest/healthkit — HealthKitBpBatch from the iOS app.
 * Response: { accepted, duplicates } per contracts §5, plus additive
 * `deleted` (count of soft-deleted readings from deletedHkUuids).
 */

import type { HealthKitBpBatch, HealthKitBpSample } from '@benhealth/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { badRequest } from '../errors.js';
import { ingestAppleHealth } from '../ingest/apple.js';

/** Validation messages never echo values — they are health data. */
function validateSample(sample: HealthKitBpSample, index: number): string | null {
  const at = `samples[${index}]`;
  if (typeof sample.hkUuid !== 'string' || sample.hkUuid === '')
    return `${at}.hkUuid must be a non-empty string`;
  if (typeof sample.measuredAt !== 'string' || Number.isNaN(Date.parse(sample.measuredAt)))
    return `${at}.measuredAt must be an ISO-8601 timestamp`;
  if (typeof sample.systolic !== 'number' || sample.systolic < 40 || sample.systolic > 300)
    return `${at}.systolic must be a number between 40 and 300`;
  if (typeof sample.diastolic !== 'number' || sample.diastolic < 20 || sample.diastolic > 200)
    return `${at}.diastolic must be a number between 20 and 200`;
  if (
    sample.pulse !== undefined &&
    sample.pulse !== null &&
    (typeof sample.pulse !== 'number' || sample.pulse < 20 || sample.pulse > 250)
  )
    return `${at}.pulse must be null or a number between 20 and 250`;
  if (typeof sample.sourceApp !== 'string') return `${at}.sourceApp must be a string`;
  if (typeof sample.sourceDevice !== 'string') return `${at}.sourceDevice must be a string`;
  if (typeof sample.sourceBundleId !== 'string') return `${at}.sourceBundleId must be a string`;
  return null;
}

export function registerIngestRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/ingest/healthkit', async (req) => {
    const batch = req.body as HealthKitBpBatch | null;
    if (batch === null || typeof batch !== 'object' || !Array.isArray(batch.samples)) {
      throw badRequest('body must be a HealthKitBpBatch with a samples array');
    }
    for (const [i, sample] of batch.samples.entries()) {
      const problem = validateSample(sample, i);
      if (problem !== null) throw badRequest(problem);
    }
    if (batch.deletedHkUuids !== undefined) {
      if (
        !Array.isArray(batch.deletedHkUuids) ||
        batch.deletedHkUuids.some((u) => typeof u !== 'string' || u === '')
      ) {
        throw badRequest('deletedHkUuids must be an array of non-empty strings');
      }
    }
    const counts = await ingestAppleHealth(ctx.db, req.userId!, batch);
    return { accepted: counts.accepted, duplicates: counts.duplicates, deleted: counts.deleted };
  });
}
