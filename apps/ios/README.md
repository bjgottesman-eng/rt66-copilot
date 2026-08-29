# Ben Health OS — iOS app (`apps/ios`)

SwiftUI iPhone/iPad app for Ben Health OS Phase 1: first-class blood pressure,
source-aware freshness, Apple Health ingestion, manual entry, and a demo mode
that runs with zero backend.

> This package **cannot be built on Linux** (no Xcode/Swift-for-iOS toolchain).
> CI on Linux treats it as source-only; build and test on macOS.

## Requirements

- macOS with **current stable Xcode** (26.x as of Aug 2026 — see ADR-0003; anything shipping the iOS 17+ SDK works; deployment target iOS 17.0)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`

## Build

```sh
cd apps/ios
xcodegen generate          # writes BenHealthOS.xcodeproj (gitignored)
open BenHealthOS.xcodeproj
```

- **Run the app**: select the `BenHealthOS` scheme, Cmd-R.
- **Run the tests**: Cmd-U (runs `BenHealthOSTests` — freshness table tests,
  DTO decoding tests, session/display-math tests).

The Xcode project, `BenHealthOS-Info.plist`, and `BenHealthOS.entitlements`
are all generated from `project.yml`. Change `project.yml`, not the outputs.

## Simulator vs device

| Capability | Simulator | Physical device |
| --- | --- | --- |
| Demo mode (bundled synthetic fixtures, zero backend) | Yes — default | Yes |
| Live mode against `services/platform` (`http://localhost:8787`) | Yes | Yes (reachable base URL needed) |
| Face ID / device-auth gate | Simulated (Features ▸ Face ID; if no passcode is enrolled the app explains and, in demo mode only, offers to continue) | Yes |
| Apple Health: read BP correlations + heart rate | Partially — HealthKit works in the Simulator, but you must add BP samples by hand in the Health app | Yes |
| Apple Health background delivery / observer wake-ups | **No** (Simulator limitation — foreground "Sync now" still works) | Yes |
| Optional write-back of manual readings to Apple Health | Yes (after granting write permission) | Yes |
| Withings connect (`ASWebAuthenticationSession`) | Live mode only; in demo mode the button explains that fixtures are in use | Live mode only |

### Demo mode

Demo mode is controlled by the `BH_DEMO_MODE` build setting in `project.yml`
(surfaced to the app through Info.plist → `App/AppConfig.swift`). It defaults
to `YES`, so a fresh clone runs in the Simulator with **no backend, no
credentials, and no HealthKit data**: the app serves a small, hand-derived
synthetic slice of the demo persona (`Sources/Demo/DemoData.swift` — same
shapes as `fixtures/demo-persona/`, all fictional). Fixture timestamps are
shifted by whole days at launch so freshness pills are meaningful; the shift
preserves morning/evening semantics and is documented in code — nothing is
ever labeled "LIVE".

To run against the real platform: set `BH_DEMO_MODE: "NO"` and point
`BH_PLATFORM_BASE_URL` at your platform instance, regenerate, and sign in with
the platform credentials (demo bootstrap: `demo@benhealth.local` /
`demo-password`). The JWT is stored in the Keychain, never in UserDefaults.

## Signing

`project.yml` leaves signing on **Automatic** with no team pinned. On first
open, pick your team under *Signing & Capabilities*. Running on a physical
device requires a team whose provisioning supports the **HealthKit** and
**HealthKit background delivery** entitlements (any paid developer account;
free personal teams can run HealthKit but not background delivery). The
Simulator needs no signing setup.

## Layout

```
Sources/
  App/        @main app, config, services container, auth gate, root navigation
  Core/       DTO mirrors of docs/contracts/phase1-contracts.md §5, freshness §3,
              API client, Keychain wrapper, offline cache
  HealthKit/  anchored-query ingestion + background delivery; optional write-back
  Features/   BloodPressure (screen, manual entry, display math), Sources, Today, Settings
  UI/         freshness pill, formatting helpers (measured vs ingested time)
  Demo/       bundled synthetic fixtures + in-memory demo provider
Tests/        FreshnessTests, ModelsDecodingTests, SessionMathTests
```

`docs/contracts/phase1-contracts.md` is normative for every enum raw value,
DTO field name, endpoint path, and the freshness algorithm mirrored here.

## Known limitations (honest list)

- Written on Linux without an Xcode toolchain: the Swift has **never been
  compiled**. Expect a first `xcodegen generate` + build on macOS to surface
  mechanical fixes before Cmd-U passes.
- Strict concurrency is `complete` under language mode 5; migrating to
  `SWIFT_VERSION: "6.0"` is a follow-up once it builds.
- HealthKit deletion events are detected and counted but not yet propagated to
  the platform (no delete endpoint in the Phase 1 contract).
- BGProcessingTask scheduling (`com.benhealth.os.sync`) is declared but not yet
  registered; HealthKit observer + background delivery covers Phase 1 sync.
