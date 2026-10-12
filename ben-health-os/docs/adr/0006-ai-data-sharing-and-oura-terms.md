# ADR 0006 — AI data-sharing controls and the Oura API Agreement

Status: accepted (2026-10-12)

## Context
The Oura API Agreement effective 2026-06-08 (§4(d)) states that API data may not be used to
"prompt, or otherwise provide input" to AI models other than through Oura's MCP server, and §4(a)
prohibits training/embeddings. Phase 6 plans AI analysis packets built from the user's data.

## Decision
- Profiles carry explicit AI sharing controls: `ai_sharing.enabled` (default false) and
  `excludedConnectors` (default `["oura"]`).
- The Phase 6 packet builder must drop every observation whose `connector = 'oura'` unless the user
  has deliberately removed the exclusion after reviewing the agreement. Oura data that the user
  exported into Health Connect (`connector = 'health_connect'`, origin `com.ouraring.oura`) is user
  data under Health Connect's terms and is not affected by this default, but the UI labels it.
- This is a product/legal risk flag, not legal advice; it is surfaced in Settings and docs.
