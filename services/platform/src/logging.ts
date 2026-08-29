/**
 * Pino logger with defense-in-depth redaction (CLAUDE.md rule 1: no secrets,
 * tokens, or health values in logs).
 *
 * Layers:
 * 1. `redact` paths for the places secrets structurally appear (auth headers,
 *    token/password/secret-shaped fields at common depths).
 * 2. Minimal req/res serializers: method + path only. Query strings are
 *    stripped ENTIRELY (the Withings OAuth callback carries ?code=&state=).
 * 3. Request bodies are never logged anywhere — Fastify does not log bodies by
 *    default and no route handler may pass one to the logger; use
 *    {@link sanitizeForLog} for any object that must be logged.
 *
 * The log-redaction integration test drives login/webhook/ingest traffic
 * through a captured stream and asserts none of this leaks.
 */

import type { Writable } from 'node:stream';
import { pino, stdSerializers, type Logger, type LoggerOptions } from 'pino';

const SENSITIVE_KEY_RE = /token|secret|password|authorization|cookie|jwt|code/i;

/** Deep-copies `value`, replacing any field whose key looks sensitive. */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeForLog(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? '[redacted]' : sanitizeForLog(v, depth + 1);
  }
  return out;
}

/** `url` without its query string (OAuth codes/states live in query strings). */
function pathOnly(url: string | undefined): string {
  if (url === undefined) return '';
  const q = url.indexOf('?');
  return q === -1 ? url : `${url.slice(0, q)}?[redacted]`;
}

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.access_token',
  '*.refresh_token',
  '*.secret',
  '*.authorization',
  '*.code',
];

export function createLogger(stream?: Writable): Logger {
  const options: LoggerOptions = {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      req(req: { method?: string; url?: string; id?: unknown }) {
        return { method: req.method, url: pathOnly(req.url), id: req.id };
      },
      res(res: { statusCode?: number }) {
        return { statusCode: res.statusCode };
      },
      err: stdSerializers.err,
    },
  };
  return stream === undefined ? pino(options) : pino(options, stream);
}
