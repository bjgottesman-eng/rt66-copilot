# ADR 0005 — Freshness status model

Status: accepted (2026-10-12)

Every metric carries measured-at, source-updated-at, ingested-at, expected latency and a status
computed by `services/analytics/freshness.ts` from `packages/shared-config/freshness.ts`:

| Status | Rule |
|---|---|
| NOT_CONNECTED | no active connection can provide the metric |
| SYNC_ERROR | every providing connection is failing/expired and none succeeded within its expected interval |
| INSUFFICIENT_DATA | connected but no observations |
| CURRENT | age ≤ currentWithinHours |
| RECENT | age ≤ recentWithinHours |
| SOURCE_DELAYED | age ≤ staleAfterHours and our last sync is within the expected interval (upstream has nothing newer) |
| STALE | otherwise (our sync is overdue, or no measurement beyond staleAfterHours) |

Each status comes with a human-readable reason explaining *why* and what to do. "Live" is never
claimed; the dashboard shows relative measurement time and source for every value.
