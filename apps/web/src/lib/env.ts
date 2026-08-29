/** Server-side environment access (no secrets; URLs and flags only). */

/** Base URL of the platform service (server-side only; never sent to the client). */
export function platformUrl(): string {
  return process.env.PLATFORM_URL ?? 'http://localhost:8787';
}

/**
 * Demo banner flag. The platform /sources response does not expose the fake
 * connector (SourceStatusDto carries no metadata), so the banner is driven by
 * NEXT_PUBLIC_DEMO=true — set alongside PLATFORM_MODE=demo so synthetic data
 * never masquerades as real.
 */
export function isDemo(): boolean {
  return process.env.NEXT_PUBLIC_DEMO === 'true';
}
