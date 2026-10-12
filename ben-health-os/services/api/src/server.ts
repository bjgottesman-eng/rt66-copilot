import { buildApp } from './app.js';

const app = await buildApp();
try {
  await app.listen({ port: app.ctx.config.PORT, host: app.ctx.config.HOST });
  app.log.info({ authMode: app.ctx.config.AUTH_MODE, demoSeed: app.ctx.config.ALLOW_DEMO_SEED }, `Ben Health OS API listening on ${app.ctx.config.HOST}:${app.ctx.config.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
