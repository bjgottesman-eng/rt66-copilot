# Source priority and deduplication rules

Source of truth: `packages/shared-config/src/sourcePriority.ts` and `dedup.ts` (generated JSON for
Android). Lower index = higher priority; `health_connect:<package>` targets a specific writer and
`health_connect:*` any Health Connect origin.

| Metric class | Priority (first wins) | Match window / tolerance |
|---|---|---|
| blood_pressure, pulse, weight, body_fat_pct | Withings API → Withings via HC → any HC → manual | 180 s / exact (pulse ±1), weight 600 s / 0.1 kg |
| sleep | Oura API → Oura via HC → Samsung Health via HC → any HC → manual | interval overlap ≥ 80 % |
| resting_heart_rate, hrv_rmssd, respiratory_rate, spo2 | Oura API → Oura via HC → any HC | 6 h / ±1 |
| heart_rate | Oura via HC → Oura API → Samsung via HC → any HC | no cross-source matching (series) |
| steps, distance_m | Samsung Health via HC → Oura via HC → Oura API → any HC → manual | per local day: highest-priority origin with data; **never summed** |
| workout | Samsung Health via HC → Oura via HC → Oura API → any HC → manual | overlap ≥ 70 % |
| blood_glucose | Stelo via HC → Stelo → any HC → file import → manual | 90 s / ±1 mg/dL |
| nutrition | Cronometer → Cronometer via HC → any HC → manual | exact ids only |
| vo2_max | Oura API → any HC → manual | — |
| lab_result | clinical FHIR → Function Health → file import → manual | exact ids; unit-aware |

Rules:
1. Raw records are retained from every source; priority decides only which row is canonical.
2. Manual entry always ranks below device-captured data for the same measurement.
3. Overlapping step counts from the phone and the ring are alternates, recorded with the chosen
   origin in `daily_activity.contributing_origins`.
4. When the Withings cuff writes pulse as a separate heart-rate record, it is attached to the
   reading within 90 s from the same origin.
5. Priorities are reviewed when a source changes behaviour (e.g. Withings confirms BP in Health
   Connect, or a new wearable is added).
