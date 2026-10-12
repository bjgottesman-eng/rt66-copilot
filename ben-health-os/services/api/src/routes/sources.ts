import type { FastifyInstance } from 'fastify';
import { CONNECTOR_IDS } from '@bho/shared-config';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { withUser } from '../db/pool.js';
import { deleteConnectorData } from '../services/account.js';
import { listSources } from '../services/sources.js';
import { ConnectorError, disconnect, reconcile, type OAuthConnector } from '../services/connectors.js';
import { audit } from '../services/audit.js';

export async function sourcesRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/sources', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return listSources(ctx.pool, user.userId, new Date(), ctx.connectors.configured);
  });

  app.post('/v1/sources/:connector/disconnect', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { connector } = request.params as { connector: string };
    if (!(CONNECTOR_IDS as readonly string[]).includes(connector)) return reply.code(404).send({ error: 'not_found', message: 'unknown connector' });
    if (connector === 'oura' || connector === 'withings' || connector === 'clinical_fhir') await disconnect(ctx.pool, ctx.connectors, user.userId, connector).catch(() => undefined);
    await withUser(ctx.pool, user.userId, (tx) => tx.query(`update public.source_connections set status = 'DISCONNECTED', access_token_ciphertext = null, refresh_token_ciphertext = null, token_expires_at = null where user_id = $1 and connector = $2`, [user.userId, connector]));
    await audit(ctx.pool, { userId: user.userId, actor: 'user', action: 'SOURCE_DISCONNECT', entity: 'source_connection', entityId: connector });
    return reply.code(204).send();
  });

  app.post('/v1/sources/:connector/refresh', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { connector } = request.params as { connector: string };
    if (connector !== 'oura' && connector !== 'withings' && connector !== 'clinical_fhir') return reply.code(400).send({ error: 'bad_request', message: 'refresh is only available for API connectors; Health Connect syncs from the Android app' });
    await ensureProfile(ctx.pool, ctx.config, user);
    try {
      return await reconcile(ctx.pool, ctx.connectors, user.userId, connector as OAuthConnector);
    } catch (e) {
      if (e instanceof ConnectorError) return reply.code(e.statusCode).send({ error: 'connector_error', message: e.message });
      throw e;
    }
  });

  app.delete('/v1/sources/:connector/data', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { connector } = request.params as { connector: string };
    if (!(CONNECTOR_IDS as readonly string[]).includes(connector)) return reply.code(404).send({ error: 'not_found', message: 'unknown connector' });
    const counts = await deleteConnectorData(ctx.pool, user.userId, connector);
    return { connector, deleted: counts };
  });
}
