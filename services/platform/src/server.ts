/**
 * Platform service entry point: `pnpm --filter @benhealth/platform dev`
 * (defaults: demo mode, http://localhost:8787).
 */

import process from 'node:process';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const { app } = await buildApp({ config });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info({ mode: config.mode, port: config.port }, 'platform service listening');

  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  // Config errors list variable NAMES only; safe to print.
  console.error('[platform] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
