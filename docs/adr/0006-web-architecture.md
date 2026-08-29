# ADR-0006: Web dashboard — Next.js 16 App Router + Recharts, thin proxy to the platform API

Date: 2026-08-29 · Status: Accepted

## Context

The brief requires a responsive Mac/web dashboard (Safari-first, PWA-friendly)
on Next.js + TypeScript with a well-supported charting library. Verified
2026-08-29: Next.js stable major is 16.3.x — App Router, Turbopack default,
`proxy.ts` (middleware renamed), async-only request APIs, React 19.2.
HealthKit is unusable on macOS, so the web surface reads the platform API
exclusively.

## Decision

- **Next.js 16 (App Router, TypeScript strict)** in `apps/web`.
- The browser talks only to Next.js route handlers (`/api/*`), which attach
  the JWT from the httpOnly cookie and forward to the platform service —
  no tokens in client JS, CORS kept trivial.
- **Recharts** for charts (mature, accessible SVG, fits React 19). Charts show
  measurement time; freshness is a first-class UI element (calm status pill,
  measured-vs-ingested timestamps).
- Responsive, light/dark via CSS variables + `prefers-color-scheme`; no
  advertising/analytics SDKs of any kind.

## Consequences

- Web stays a pure read/interaction surface; all health logic lives in the
  platform service and shared package (one freshness implementation reused).
- PWA packaging (manifest/service worker) is deferred to Phase 8 to avoid any
  confusion with the co-resident Route 66 PWA's root-level service worker
  (scope isolation documented then).
