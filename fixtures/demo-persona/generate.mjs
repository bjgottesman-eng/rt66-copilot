#!/usr/bin/env node
// Ben Health OS — synthetic demo persona generator.
// ALL DATA PRODUCED HERE ARE FICTIONAL. No real health data.
//
// Deterministic: seeded mulberry32 PRNG (seed 42), hardcoded end date.
// No npm dependencies. Node 22+. Run: node generate.mjs
//
// Regenerates, in this directory:
//   bp-withings.json
//   bp-withings-corrections.json
//   bp-apple-health.json
//   bp-manual.json
//   webhook-notifications.json

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- PRNG

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);

// Box-Muller gaussian driven by the seeded PRNG (deterministic).
function gauss(mean, sd) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * sd;
}

function randInt(min, max) {
  // inclusive bounds
  return min + Math.floor(rand() * (max - min + 1));
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

// ---------------------------------------------------------- timezone

// America/New_York UTC offset in hours for a given local date in 2026.
// US DST 2026: begins Sun Mar 8, ends Sun Nov 1. The generated window
// (2026-05-31 .. 2026-08-28) is entirely EDT (-04:00), but compute anyway.
function nyOffsetHours(y, m, d) {
  // m is 1-based month. EDT between Mar 8 and Nov 1 (2026-specific, adequate
  // for this fixture's fixed window).
  if (y !== 2026) throw new Error("generator only calibrated for 2026 dates");
  const afterStart = m > 3 || (m === 3 && d >= 8);
  const beforeEnd = m < 11 || (m === 11 && d < 1);
  return afterStart && beforeEnd ? -4 : -5;
}

// Epoch seconds for a local America/New_York wall-clock time.
function localToEpoch(y, m, d, hh, mm, ss) {
  const off = nyOffsetHours(y, m, d);
  return Math.floor(Date.UTC(y, m - 1, d, hh - off, mm, ss) / 1000);
}

// ISO-8601 string with the explicit -04:00/-05:00 offset for an epoch.
function epochToLocalIso(epoch) {
  // Determine offset from the UTC date (window is all EDT; safe here).
  const utc = new Date(epoch * 1000);
  const off = nyOffsetHours(
    utc.getUTCFullYear(),
    utc.getUTCMonth() + 1,
    utc.getUTCDate()
  );
  const local = new Date((epoch + off * 3600) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const sign = off < 0 ? "-" : "+";
  const offAbs = Math.abs(off);
  return (
    `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
    `T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}` +
    `${sign}${p(offAbs)}:00`
  );
}

function epochToUtcIso(epoch) {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Deterministic uuid-like string from the seeded PRNG.
function fakeUuid() {
  const hex = () => Math.floor(rand() * 16).toString(16);
  const s = (n) => Array.from({ length: n }, hex).join("");
  const variant = "89ab"[Math.floor(rand() * 4)];
  return `${s(8)}-${s(4)}-4${s(3)}-${variant}${s(3)}-${s(12)}`;
}

// ---------------------------------------------------------- calendar

// 90 days ENDING 2026-08-28 (hardcoded).
const END = { y: 2026, m: 8, d: 28 };
const DAYS = 90;

function dayList() {
  const endUtcMidnight = Date.UTC(END.y, END.m - 1, END.d);
  const out = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const dt = new Date(endUtcMidnight - i * 86400000);
    out.push({
      y: dt.getUTCFullYear(),
      m: dt.getUTCMonth() + 1,
      d: dt.getUTCDate(),
      index: DAYS - 1 - i, // 0 .. 89, 89 = 2026-08-28
    });
  }
  return out;
}

// ------------------------------------------------- Withings generation

const SYS_BASE = 124;
const DIA_BASE = 79;
const PULSE_BASE = 62;

let nextGrpid = 500001;
const groups = []; // withings measure groups, one per reading
const sessions = []; // { startEpoch, endEpoch, readings: [groupRef] }

for (const day of dayList()) {
  // Gentle upward drift: +4 systolic linearly over the last 30 days.
  const drift =
    day.index >= DAYS - 30 ? (4 * (day.index - (DAYS - 30))) / 29 : 0;

  // ~12% of days randomly missing one session.
  const missing = rand() < 0.12 ? (rand() < 0.5 ? "morning" : "evening") : null;

  for (const slot of ["morning", "evening"]) {
    if (slot === missing) continue;
    const baseH = slot === "morning" ? 7 : 21;
    const baseM = slot === "morning" ? 30 : 15;
    const jitter = slot === "morning" ? randInt(-20, 20) : randInt(-25, 25);
    const startEpoch =
      localToEpoch(day.y, day.m, day.d, baseH, baseM, randInt(0, 59)) +
      jitter * 60;

    const nReadings = randInt(2, 3);
    const session = { startEpoch, endEpoch: startEpoch, readings: [] };
    let t = startEpoch;
    for (let r = 0; r < nReadings; r++) {
      if (r > 0) t += randInt(60, 120);
      let sys = gauss(SYS_BASE + drift, 6);
      let dia = gauss(DIA_BASE, 4);
      let pulse = gauss(PULSE_BASE, 3);
      if (r === 0) {
        sys += 6;
        dia += 3;
      }
      if (slot === "evening") sys += 3;
      sys = clamp(Math.round(sys), 90, 185);
      dia = clamp(Math.round(dia), 50, 115);
      pulse = clamp(Math.round(pulse), 42, 110);

      const created = t + randInt(5, 40);
      const group = {
        grpid: nextGrpid++,
        attrib: 0,
        date: t,
        created,
        modified: created,
        deviceid: "wbp-demo-device-001",
        category: 1,
        measures: [
          { value: sys, type: 10, unit: 0 },
          { value: dia, type: 9, unit: 0 },
          { value: pulse, type: 11, unit: 0 },
        ],
      };
      groups.push(group);
      session.readings.push(group);
      session.endEpoch = t;
    }
    sessions.push(session);
  }
}

const withingsDoc = {
  user: "demo",
  timezone: "America/New_York",
  groups,
};

// ---------------------------------------------- correction (1 group)

// One corrected measurement: reuse an existing grpid, modified bumped,
// systolic changed by -8.
const correctionTarget = groups[Math.floor(groups.length * 0.8)];
const correctedGroup = {
  ...correctionTarget,
  modified: correctionTarget.modified + 7200,
  measures: correctionTarget.measures.map((m) =>
    m.type === 10 ? { ...m, value: m.value - 8 } : { ...m }
  ),
};
const correctionsDoc = {
  user: "demo",
  timezone: "America/New_York",
  groups: [correctedGroup],
};

// ------------------------------------------- Apple Health generation

function measureVal(group, type) {
  return group.measures.find((m) => m.type === type).value;
}

const appleSamples = [];

// 30% of Withings groups mirrored EXACTLY (cross-source duplicates).
const mirrorCount = Math.round(groups.length * 0.3);
const mirrorStep = groups.length / mirrorCount;
const mirroredGrpids = new Set();
for (let i = 0; i < mirrorCount; i++) {
  const g = groups[Math.floor(i * mirrorStep)];
  mirroredGrpids.add(g.grpid);
  appleSamples.push({
    hkUuid: fakeUuid(),
    measuredAt: epochToLocalIso(g.date),
    systolic: measureVal(g, 10),
    diastolic: measureVal(g, 9),
    pulse: measureVal(g, 11),
    sourceApp: "Health Mate",
    sourceDevice: "BPM Connect",
    sourceBundleId: "com.withings.wiScaleNG",
  });
}

// 6 non-duplicate Qardio readings on separate days (mid-afternoon, far from
// any Withings session), plus 3 samples with pulse null (never-zero rule).
const qardioDays = [5, 18, 31, 44, 57, 70]; // day indices
const nullPulseDays = [12, 39, 66];
const days = dayList();

function appleExtra(dayIndex, pulseNull) {
  const day = days[dayIndex];
  const epoch = localToEpoch(
    day.y,
    day.m,
    day.d,
    14,
    randInt(0, 45),
    randInt(0, 59)
  );
  const sys = clamp(Math.round(gauss(SYS_BASE + 2, 6)), 90, 185);
  const dia = clamp(Math.round(gauss(DIA_BASE + 1, 4)), 50, 115);
  const pulse = pulseNull ? null : clamp(Math.round(gauss(PULSE_BASE + 4, 3)), 42, 110);
  return {
    hkUuid: fakeUuid(),
    measuredAt: epochToLocalIso(epoch),
    systolic: sys,
    diastolic: dia,
    pulse,
    sourceApp: "Qardio",
    sourceDevice: "QardioArm",
    sourceBundleId: "com.getqardio.QardioArm",
  };
}

for (const di of qardioDays) appleSamples.push(appleExtra(di, false));
for (const di of nullPulseDays) appleSamples.push(appleExtra(di, true));

const appleDoc = { samples: appleSamples };

// -------------------------------------------------- manual entries

// 4 ManualBpEntry-shaped entries (contracts §5). Entry 0 exactly matches a
// Withings reading's time and values (manual-vs-device dedup case).
const manualDupTarget = groups[Math.floor(groups.length * 0.55)];
const manualEntries = [
  {
    systolic: measureVal(manualDupTarget, 10),
    diastolic: measureVal(manualDupTarget, 9),
    pulse: measureVal(manualDupTarget, 11),
    measuredAt: epochToUtcIso(manualDupTarget.date),
    measuredTz: "America/New_York",
    arm: "left",
    bodyPosition: "seated",
    seatedRestMinutes: 5,
    readingNumberInSession: 1,
    note: "Typed in from the cuff display before sync (dup of Withings reading)",
    saveToAppleHealth: false,
  },
];

const manualDays = [22, 48, 75];
for (const di of manualDays) {
  const day = days[di];
  const epoch = localToEpoch(day.y, day.m, day.d, 12, randInt(10, 50), randInt(0, 59));
  manualEntries.push({
    systolic: clamp(Math.round(gauss(SYS_BASE + 1, 6)), 90, 185),
    diastolic: clamp(Math.round(gauss(DIA_BASE, 4)), 50, 115),
    pulse: clamp(Math.round(gauss(PULSE_BASE + 2, 3)), 42, 110),
    measuredAt: epochToUtcIso(epoch),
    measuredTz: "America/New_York",
    arm: di % 2 === 0 ? "left" : "right",
    bodyPosition: "seated",
    seatedRestMinutes: di % 2 === 0 ? 5 : 3,
    readingNumberInSession: 1,
    note: "Pharmacy machine reading, entered by hand",
    saveToAppleHealth: true,
  });
}

const manualDoc = { entries: manualEntries };

// ---------------------------------------------- webhook notifications

// 5 notifications aligned to the LAST 5 Withings sessions, plus one exact
// duplicate of the last one (idempotency test case).
sessions.sort((a, b) => a.startEpoch - b.startEpoch);
const last5 = sessions.slice(-5);
const notifications = last5.map((s) => ({
  userid: "demo-withings-user",
  appli: 4,
  startdate: s.startEpoch,
  enddate: s.endEpoch + 60,
}));
notifications.push({ ...notifications[notifications.length - 1] });

const webhookDoc = { notifications };

// -------------------------------------------------------- verification

function verify() {
  const fail = (msg) => {
    throw new Error(`INVARIANT VIOLATION: ${msg}`);
  };

  // Withings groups
  const grpids = new Set(groups.map((g) => g.grpid));
  if (grpids.size !== groups.length) fail("duplicate grpid in bp-withings.json");
  const expectedMin = 2 * DAYS * 0.7; // generous lower bound
  if (groups.length < expectedMin || groups.length > 3 * 2 * DAYS)
    fail(`implausible group count ${groups.length}`);
  for (const g of groups) {
    if (g.measures.length !== 3) fail(`group ${g.grpid} lacks 3 measures`);
    const sys = measureVal(g, 10);
    const dia = measureVal(g, 9);
    const pulse = measureVal(g, 11);
    if (sys < 90 || sys > 185) fail(`systolic out of range: ${sys}`);
    if (dia < 50 || dia > 115) fail(`diastolic out of range: ${dia}`);
    if (pulse < 42 || pulse > 110) fail(`pulse out of range: ${pulse}`);
    if (sys <= dia) fail(`systolic <= diastolic in grpid ${g.grpid}`);
    if (!Number.isInteger(sys) || !Number.isInteger(dia) || !Number.isInteger(pulse))
      fail("non-integer measure value");
    if (g.modified < g.created || g.created < g.date)
      fail(`timestamps out of order in grpid ${g.grpid}`);
  }
  // End of window: last measurement must fall on 2026-08-28 local.
  const lastGroup = groups[groups.length - 1];
  if (!epochToLocalIso(lastGroup.date).startsWith("2026-08-28"))
    fail("last group not on 2026-08-28");
  if (!epochToLocalIso(groups[0].date).startsWith("2026-05-31"))
    fail("first group not on 2026-05-31");

  // Correction
  if (correctionsDoc.groups.length !== 1) fail("corrections must contain exactly 1 group");
  const corr = correctionsDoc.groups[0];
  if (!grpids.has(corr.grpid)) fail("correction grpid not present in bp-withings.json");
  if (corr.modified <= correctionTarget.modified)
    fail("correction modified must exceed original modified");
  if (measureVal(corr, 10) !== measureVal(correctionTarget, 10) - 8)
    fail("correction systolic must be original - 8");
  if (measureVal(corr, 9) !== measureVal(correctionTarget, 9))
    fail("correction must not change diastolic");

  // Apple Health
  const byEpochIso = new Map(groups.map((g) => [epochToLocalIso(g.date), g]));
  let mirrors = 0;
  let nullPulse = 0;
  let qardio = 0;
  const uuids = new Set();
  for (const s of appleSamples) {
    if (uuids.has(s.hkUuid)) fail("duplicate hkUuid");
    uuids.add(s.hkUuid);
    if (s.pulse === 0) fail("pulse must never be coerced to zero");
    if (s.sourceApp === "Health Mate") {
      const g = byEpochIso.get(s.measuredAt);
      if (!g) fail(`mirror sample at ${s.measuredAt} matches no Withings group`);
      if (
        s.systolic !== measureVal(g, 10) ||
        s.diastolic !== measureVal(g, 9) ||
        s.pulse !== measureVal(g, 11)
      )
        fail(`mirror sample at ${s.measuredAt} values differ from Withings group`);
      mirrors++;
    } else if (s.sourceApp === "Qardio") {
      if (s.pulse === null) nullPulse++;
      else qardio++;
      // Non-duplicate rule: no Withings reading within 180 s.
      const e = Date.parse(s.measuredAt) / 1000;
      for (const g of groups)
        if (Math.abs(g.date - e) <= 180)
          fail("Qardio sample collides with a Withings reading (unintended duplicate)");
    } else fail(`unexpected sourceApp ${s.sourceApp}`);
  }
  if (mirrors !== Math.round(groups.length * 0.3))
    fail(`mirror count ${mirrors} != 30% of ${groups.length}`);
  if (qardio !== 6) fail(`expected 6 Qardio pulse-bearing samples, got ${qardio}`);
  if (nullPulse !== 3) fail(`expected 3 null-pulse samples, got ${nullPulse}`);

  // Manual
  if (manualEntries.length !== 4) fail("must be exactly 4 manual entries");
  const m0 = manualEntries[0];
  if (
    Date.parse(m0.measuredAt) / 1000 !== manualDupTarget.date ||
    m0.systolic !== measureVal(manualDupTarget, 10) ||
    m0.diastolic !== measureVal(manualDupTarget, 9) ||
    m0.pulse !== measureVal(manualDupTarget, 11)
  )
    fail("manual entry 0 must exactly match its Withings reading");
  for (const m of manualEntries)
    if (m.pulse === 0) fail("manual pulse must never be zero");

  // Webhooks
  if (notifications.length !== 6) fail("must be exactly 6 webhook notifications");
  const a = notifications[4];
  const b = notifications[5];
  if (JSON.stringify(a) !== JSON.stringify(b))
    fail("last webhook notification must be an exact duplicate");
  for (const n of notifications) {
    if (n.userid !== "demo-withings-user" || n.appli !== 4)
      fail("webhook notification fields wrong");
    if (!(n.startdate < n.enddate)) fail("webhook startdate must precede enddate");
  }
  // Alignment: each of the first 5 maps to one of the last 5 sessions.
  for (let i = 0; i < 5; i++)
    if (notifications[i].startdate !== last5[i].startEpoch)
      fail("webhook notifications not aligned to last 5 sessions");
}

verify();

// ------------------------------------------------------------- write

function write(name, doc) {
  writeFileSync(join(OUT_DIR, name), JSON.stringify(doc, null, 2) + "\n");
}

write("bp-withings.json", withingsDoc);
write("bp-withings-corrections.json", correctionsDoc);
write("bp-apple-health.json", appleDoc);
write("bp-manual.json", manualDoc);
write("webhook-notifications.json", webhookDoc);

console.log("demo persona generated (ALL SYNTHETIC):");
console.log(`  days:                      ${DAYS} (ending 2026-08-28, America/New_York)`);
console.log(`  withings sessions:         ${sessions.length} (of ${2 * DAYS} possible; ${2 * DAYS - sessions.length} missing)`);
console.log(`  withings groups/readings:  ${groups.length}`);
console.log(`  corrections:               ${correctionsDoc.groups.length} (grpid ${correctedGroup.grpid}, systolic -8)`);
console.log(`  apple health samples:      ${appleSamples.length} (${mirroredGrpids.size} Withings mirrors, 6 Qardio, 3 null-pulse)`);
console.log(`  manual entries:            ${manualEntries.length} (1 exact Withings duplicate)`);
console.log(`  webhook notifications:     ${notifications.length} (5 aligned + 1 exact duplicate)`);
console.log("all invariants verified.");
