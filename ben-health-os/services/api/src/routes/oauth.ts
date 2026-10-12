import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { ConnectorError, completeOAuth, startOAuth, type OAuthConnector } from '../services/connectors.js';

function isOAuthConnector(c: string): c is OAuthConnector {
  return c === 'oura' || c === 'withings';
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f7f7f5;color:#16181d;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{max-width:420px;padding:32px;background:#fff;border:1px solid #e4e4df;border-radius:16px}h1{font-size:20px;margin:0 0 8px}p{color:#6b7280;font-size:14px;line-height:1.5}</style></head>
<body><main><p style="letter-spacing:.2em;font-size:11px;text-transform:uppercase">Ben Health OS</p><h1>${title}</h1>${body}</main></body></html>`;
}

export async function oauthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/oauth/:connector/start', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { connector } = request.params as { connector: string };
    if (!isOAuthConnector(connector)) return reply.code(404).send({ error: 'not_found', message: 'unknown OAuth connector' });
    const q = request.query as { client?: string; returnTo?: string };
    await ensureProfile(ctx.pool, ctx.config, user);
    try {
      const { url } = await startOAuth(ctx.pool, ctx.connectors, user.userId, connector, q.client === 'android' ? 'android' : 'web', q.returnTo ?? null);
      return { url };
    } catch (e) {
      if (e instanceof ConnectorError) return reply.code(e.statusCode).send({ error: 'connector_error', message: e.message });
      throw e;
    }
  });

  app.get('/v1/oauth/:connector/callback', async (request, reply) => {
    const { connector } = request.params as { connector: string };
    const q = request.query as { code?: string; state?: string; error?: string; error_description?: string };
    if (!isOAuthConnector(connector)) return reply.code(404).send({ error: 'not_found', message: 'unknown OAuth connector' });
    const fail = (message: string, client: 'web' | 'android' = 'web') => {
      if (client === 'web') return reply.redirect(`${ctx.connectors.webBaseUrl}/sources?error=${encodeURIComponent(message)}&connector=${connector}`);
      return reply.type('text/html').code(400).send(htmlPage('Connection failed', `<p>${message}</p><p>Return to the app and try again.</p>`));
    };
    if (q.error) return fail(q.error_description ?? q.error);
    if (!q.code || !q.state) return fail('missing code or state');
    try {
      const done = await completeOAuth(ctx.pool, ctx.connectors, connector, q.code, q.state);
      request.log.info({ userId: done.userId, connector, inserted: done.importResult?.inserted ?? null, webhook: done.webhook }, 'oauth connection completed');
      if (done.client === 'android') {
        return reply.type('text/html').send(htmlPage(`${connector === 'oura' ? 'Oura' : 'Withings'} connected`, `<p>${done.importResult ? `${done.importResult.inserted} records imported.` : `Connected, but the first import failed: ${done.importError}. Use Refresh in Data Sources.`}</p><p>${done.webhook}</p><p>You can return to the app.</p>`));
      }
      const target = done.returnTo && done.returnTo.startsWith('/') ? done.returnTo : '/sources';
      return reply.redirect(`${ctx.connectors.webBaseUrl}${target}?connected=${connector}${done.importError ? `&warning=${encodeURIComponent(done.importError)}` : ''}`);
    } catch (e) {
      request.log.warn({ connector, err: { message: (e as Error).message } }, 'oauth callback failed');
      return fail(e instanceof ConnectorError ? e.message : 'authorization could not be completed');
    }
  });
}
