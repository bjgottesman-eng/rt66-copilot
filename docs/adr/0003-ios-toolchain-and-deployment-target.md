# ADR-0003: iOS deployment target 17.0, Xcode 26.x/Swift 6.x, XcodeGen project

Date: 2026-08-29 · Status: Accepted

## Context

The brief says to detect the installed Xcode and SDK before selecting the
deployment target. This build environment is a Linux container: **no Xcode or
Swift toolchain is installed**, so detection is impossible here and iOS code
cannot be compiled in this environment. Verified landscape (2026-08-29):
Apple unified OS versioning at "26" in Sept 2025; current stable Xcode is
26.x with Swift 6.3; iOS 27 is in beta. Every API we need clears iOS 17:
`HKAnchoredObjectQueryDescriptor` (15.4+), background-delivery entitlement
(15+), Observation framework (17+), Swift Charts (16+), clinical records
(12+).

## Decision

- **Minimum deployment target: iOS 17.0** — enables Observation
  (`@Observable`) and modern SwiftUI while supporting any device Ben plausibly
  carries. Build with **current stable Xcode 26.x / Swift 6 language
  tooling**; no beta-only APIs (the iOS 27-beta limited-authorization API is
  explicitly not used).
- **Project definition via XcodeGen** (`apps/ios/project.yml`) so the project
  is reviewable text, generated on macOS with `xcodegen generate`. No
  committed `.xcodeproj`.
- CI does not build iOS (Linux runners); the roadmap marks iOS acceptance
  items as macOS-verification steps.

## Consequences

- First compile happens on the owner's Mac; expect a small breakage budget
  (typos, availability annotations) on first build — an honest, documented
  limitation rather than a false "it compiles" claim.
- When an Xcode environment becomes available (e.g. a macOS runner), pin the
  exact Xcode version and revisit raising the target.
