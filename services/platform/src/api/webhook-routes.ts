/**
 * Withings notification endpoint (contracts §5/§6).
 *
 * - HEAD /webhooks/withings → 200 (Withings validates the callback URL with a
 *   HEAD request expecting 2xx).
 * - POST /webhooks/withings: application/x-www-form-urlencoded fields
 *   userid, appli, startdate, enddate. Deliveries are UNAUTHENTICATED and may
 *   be duplicated; the body is never trusted. Respond 200 immediately, journal
 *   the delivery (sha256 of the raw body; unique(provider, delivery_hash)
 *   short-circuits duplicates), then asynchronously run the lastupdate sync
 *   for the connection matching external_user_id = userid.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

const WEBHOOK_RATE_LIMIT = { max: 120, timeWindow: '1 minute' };

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.head('/webhooks/withings', { config: { rateLimit: WEBHOOK_RATE_LIMIT } }, async (_req, reply) => {
    return reply.code(200).send();
  });

  app.post('/webhooks/withings', { config: { rateLimit: WEBHOOK_RATE_LIMIT } }, async (req, reply) => {
    const raw = req.rawBody ?? '';
    const deliveryHash = createHash('sha256').update(raw).digest('hex');
    const isNew = await ctx.db.recordWebhookDelivery('withings', deliveryHash);

    // Always 200, fast — before any processing (Withings retries on non-2xx).
    await reply.code(200).send({ ok: true });

    if (!isNew) return reply; // duplicate delivery: journaled once, processed once

    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries((req.body ?? {}) as Record<string, unknown>)) {
      if (typeof v === 'string') fields[k] = v;
    }
    ctx.background.track(
      ctx.withings.processNotification(fields).catch(async (err) => {
        ctx.logger.error({ err }, 'withings webhook processing failed');
        await ctx.db.setWebhookDeliveryStatus('withings', deliveryHash, 'failed');
      }),
    );
    return reply;
  });
}
