# ADR-0001: Build Ben Health OS additively inside the existing rt66-copilot repository

Date: 2026-08-29 · Status: Accepted

## Context

The build brief assumed an empty repository, but `bjgottesman-eng/rt66-copilot`
already contains an unrelated, actively developed static PWA ("Route 66
Copilot": `index.html`, `sw.js`, `manifest.webmanifest`, icons at the repo
root). Its file layout suggests possible GitHub Pages deployment from the
repository root, and recent commits reference an in-progress trip — breaking it
could have real-world impact right now.

## Decision

Build Ben Health OS **additively**: all new code under `apps/`, `services/`,
`packages/`, `fixtures/`, `docs/`, plus root workspace files (`CLAUDE.md`,
`package.json`, `pnpm-workspace.yaml`, `.env.example`, `.gitignore` append).
The PWA's root files are never modified, moved, or deleted. Work happens on
branch `ben-health-os`, keeping `main` untouched until the owner merges.

## Consequences

- Zero risk to the live PWA; `main` still serves it unchanged.
- The repo root is slightly unconventional (an `index.html` that belongs to a
  different product). Documented in CLAUDE.md so tooling/agents never touch it.
- If the owner prefers a dedicated repository, the entire Ben Health OS tree
  can be moved wholesale (no root-file entanglement by design). That is the
  owner's call; flagged in the phase report.
