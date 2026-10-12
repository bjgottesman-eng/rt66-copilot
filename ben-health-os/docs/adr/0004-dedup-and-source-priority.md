# ADR 0004 — Deduplication order and source priority

Status: accepted (2026-10-12)

## Decision
1. **Exact identity**: `(user, connector, external_id)` — a Health Connect record id, Withings
   `grpid`, Oura document id, file row key. Same id + same payload hash → idempotent no-op; same id +
   different hash → update, previous raw event marked SUPERSEDED (never deleted).
2. **Payload hash**: identical content under a new id from the same connector is a duplicate.
3. **Cross-source matching** (conservative): same metric class, different source key, within the
   class window and value tolerance (`packages/shared-config/dedup.ts`), or interval overlap ≥ 80 %
   (sleep) / 70 % (workouts). The higher-priority source (`source-priority.ts`) stays canonical; the
   other row is linked (`canonical=false`, `duplicate_of`, reason). Whole groups (systolic +
   diastolic + pulse) move together.
4. **Steps and similar accumulations** are never summed across origins; per local day the
   highest-priority origin with data is used and the others are recorded as alternates.

## Consequences
- Dashboards and baselines read canonical rows only; the Trends raw view shows duplicates hollow.
- Deleting a connector's data re-promotes rows that pointed at deleted canonicals.
