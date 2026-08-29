# ADR-0004: iOS local persistence — protected JSON cache now, SwiftData deferred

Date: 2026-08-29 · Status: Accepted

## Context

Phase 1 needs the app to "remain useful with intermittent connectivity and
cache the most important recent data locally" — latest BP readings, sessions,
summary, source statuses. It does not yet need offline mutation queues or
complex local querying. Candidates: SwiftData, Core Data, GRDB/SQLite, or a
file cache.

## Decision

Phase 1 uses a **small on-disk JSON cache** (`LocalCache`) in Application
Support with `.completeFileProtection`, storing the last-known API responses
(readings window, sessions, summary, sources) plus HealthKit query anchors and
pending-upload batches. HealthKit itself is the durable device-side store for
health samples — we do not duplicate it.

SwiftData (or GRDB) is deferred to the phase that needs local querying at
scale (Phase 2's multi-metric dashboard) and will get its own ADR with a
migration note.

## Consequences

- Minimal code, easy encryption posture (iOS file protection + Face ID gate),
  trivially testable.
- No local query language — acceptable while the platform API and HealthKit
  answer all queries.
- Keychain holds only the JWT and small secrets, never health data.
