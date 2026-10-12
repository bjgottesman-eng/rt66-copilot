import type { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import type { AppContext } from '../app.js';
import { handleOuraWebhook, handleWithingsNotification } from '../services/connectors.js';

/**
 * Provider webhooks. Encapsulated so the raw-body JSON parser (needed for HMAC verification) and
 * the form-body parser (Withings posts application/x-www-form-urlencoded) apply only here.
 */
export async function webhookRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(async (instance) => {
    instance.removeContentTypeParser('application/json');
    instance.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    await instance.register(formbody);

    // Oura subscription verification handshake: respond with the challenge when the token matches.
    instance.get('/v1/webhooks/oura', async (request, reply) => {
      const q = request.query as { verification_token?: string; challenge?: string };
      if (!q.verification_token || q.verification_token !== ctx.connectors.ouraVerificationToken) return reply.code(401).send({ error: 'invalid verification token' });
      return { challenge: q.challenge ?? '' };
    });

    instance.post('/v1/webhooks/oura', async (request, reply) => {
      const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});
      const result = await handleOuraWebhook(ctx.pool, ctx.connectors, { 'x-oura-signature': request.headers['x-oura-signature'] as string | undefined, 'x-oura-timestamp': request.headers['x-oura-timestamp'] as string | undefined }, raw);
      return reply.code(result.status).send(result.body);
    });

    // Withings validates the callback with a HEAD request before registering it.
    instance.head('/v1/webhooks/withings', async (_request, reply) => reply.code(200).send());
    instance.get('/v1/webhooks/withings', async (_request, reply) => reply.code(200).send({ ok: true }));
    instance.post('/v1/webhooks/withings', async (request, reply) => {
      const form = (request.body ?? {}) as Record<string, string | undefined>;
      const result = await handleWithingsNotification(ctx.pool, ctx.connectors, form);
      return reply.code(result.status).send(result.body);
    });
  });
}
