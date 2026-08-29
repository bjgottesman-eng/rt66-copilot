/** Shared application context handed to every route module. */

import type { Logger } from 'pino';
import type { AuthService } from './auth.js';
import type { PlatformConfig } from './config.js';
import type { WithingsFake } from './connectors/withings/fake.js';
import type { WithingsService } from './connectors/withings/service.js';
import type { Db } from './db.js';
import type { UserDirectory } from './directory.js';

/**
 * Tracks fire-and-forget work (webhook-triggered syncs) so the HTTP response
 * can go out immediately while tests/shutdown can still await completion.
 */
export class BackgroundTasks {
  private tasks: Promise<unknown>[] = [];

  track(task: Promise<unknown>): void {
    this.tasks.push(task.catch(() => undefined));
  }

  async drain(): Promise<void> {
    while (this.tasks.length > 0) {
      const batch = this.tasks.splice(0);
      await Promise.allSettled(batch);
    }
  }
}

export interface AppContext {
  config: PlatformConfig;
  db: Db;
  logger: Logger;
  auth: AuthService;
  directory: UserDirectory;
  withings: WithingsService;
  /** Present in demo mode only (drives /demo/seed and test hooks). */
  withingsFake: WithingsFake | null;
  background: BackgroundTasks;
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    userEmail?: string;
    /** Raw request body for webhook delivery hashing (urlencoded parser). */
    rawBody?: string;
  }
}
