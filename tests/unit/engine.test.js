// Compass engine unit tests (pure, injected clocks and sensor events; no hardware).
// Covers the parity spec: heading maths, declination-once, sentinels, smoothing,
// alignment truth table, GPS acceptance gates, gyro anchor expiry.
import test from "node:test";
import assert from "node:assert/strict";
import "../../public/geo.js";               // self-attaches globalThis.TSHKGeo
import "../../public/engine.js";            // self-attaches globalThis.TSHKEngine

const E = globalThis.TSHKEngine;
const nearly = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

/* ---------- 1. headingFromEuler / headingFromQuat ---------- */
test("headingFromQuat: identity points the top edge north (0°)", () => {
  nearly(E.heading.headingFromQuat([0, 0, 0, 1]), 0);
});
test("headingFromQuat: cardinals from device→earth yaw quaternions", () => {
  const q = (phi) => [0, 0, Math.sin(phi / 2 * E.D2R), Math.cos(phi / 2 * E.D2R)]; // yaw phi about up
  nearly(E.heading.headingFromQuat(q(0)), 0);      // top edge north
  nearly(E.heading.headingFromQuat(q(-90)), 90);   // east
  nearly(E.heading.headingFromQuat(q(180)), 180);  // south
  nearly(E.heading.headingFromQuat(q(90)), 270);   // west
});
test("headingFromQuat: intermediate tilt (30° rise about east) keeps azimuth when facing north", () => {
  const q = [Math.sin(15 * E.D2R), 0, 0, Math.cos(15 * E.D2R)]; // 30° rotation about earth-east
  nearly(E.heading.headingFromQuat(q), 0);
});
test("headingFromQuat: upright phone → pointing is the BACK of the phone (A5 blend)", () => {
  // device y (top edge) = up, device z (screen normal) = north → the back points south:
  // R columns x=(-1,0,0) y=(0,0,1) z=(0,1,0) → quaternion [0, √2/2, √2/2, 0]
  const c = Math.SQRT1_2;
  nearly(E.heading.headingFromQuat([0, c, c, 0]), 180);
});
test("headingFromEuler: flat cardinals follow 360-alpha; screen angle rotates the frame", () => {
  nearly(E.heading.headingFromEuler(0, 10, 0, 0), 0);            // small tilt avoids the placeholder triple
  nearly(E.heading.headingFromEuler(90, 10, 0, 0), 270);
  nearly(E.heading.headingFromEuler(180, 10, 0, 0), 180);
  nearly(E.heading.headingFromEuler(270, 10, 0, 0), 90);
  nearly(E.heading.headingFromEuler(0, 10, 0, Math.PI / 2), 90); // landscape: +90°
});
test("headingFromEuler: upright (beta=90) → back of the phone points", () => {
  nearly(E.heading.headingFromEuler(0, 90, 0, 0), 0);     // screen normal south → back north
  nearly(E.heading.headingFromEuler(180, 90, 0, 0), 180);
});
test("headingFromEuler vs headingFromQuat agree on a shared pose", () => {
  const h1 = E.heading.headingFromEuler(57, 0, 0, 0);
  const h2 = E.heading.headingFromQuat([0, 0, Math.sin(28.5 * E.D2R), Math.cos(28.5 * E.D2R)]);
  nearly(h1, 303);
  nearly(h2, 303);
});

/* ---------- 2. declination exactly once ---------- */
test("declination-once: magnetic corrected once equals the same reading delivered as true north", () => {
  const dec = -27.4; // southern Africa ballpark
  const magnetic = 100;
  const asTrue = E.toTrue(magnetic, E.ref.MAGNETIC, dec);
  nearly(asTrue, E.toTrue(asTrue, E.ref.TRUE, dec));
});
test("declination-once: a true-north sample is never corrected again", () => {
  const v = 123.4;
  nearly(E.toTrue(v, E.ref.TRUE, -27.4), v);
  nearly(E.toTrue(E.toTrue(v, E.ref.TRUE, -27.4), E.ref.TRUE, -27.4), v);
});
test("declination-once: magnetic sample with unavailable declination is refused, never zeroed", () => {
  assert.equal(E.toTrue(100, E.ref.MAGNETIC, null), null);
  assert.equal(E.toTrue(100, E.ref.MAGNETIC, NaN), null);
});

/* ---------- 3. sentinel rejection ---------- */
const ev = (over) => Object.assign({ alpha: 10, beta: 12, gamma: -4, timeStamp: 1000 }, over);
test("sentinels: NaN/null alpha is rejected", () => {
  assert.equal(E.samples.orientationSample(ev({ alpha: NaN }), null, 1000).reason, "nanAlpha");
  assert.equal(E.samples.orientationSample(ev({ alpha: null }), null, 1000).reason, "nanAlpha");
});
test("sentinels: the all-zero placeholder event is rejected", () => {
  assert.equal(E.samples.orientationSample(ev({ alpha: 0, beta: 0, gamma: 0 }), null, 1000).reason, "allZeroPlaceholder");
});
test("sentinels: NaN and negative webkitCompassHeading are rejected", () => {
  assert.equal(E.samples.orientationSample(ev({ webkitCompassHeading: NaN }), null, 1000).reason, "nanHeading");
  assert.equal(E.samples.orientationSample(ev({ webkitCompassHeading: -1 }), null, 1000).reason, "negativeHeading");
});
test("sentinels: negative webkitCompassAccuracy rejects the sample (invalid accuracy)", () => {
  const r = E.samples.orientationSample(ev({ webkitCompassHeading: 90, webkitCompassAccuracy: -1 }), null, 1000);
  assert.equal(r.reason, "negativeAccuracy");
});
test("sentinels: a valid webkitCompassHeading sample carries the genuine accuracy (null when unknown)", () => {
  const r = E.samples.orientationSample(ev({ webkitCompassHeading: 90, webkitCompassAccuracy: 12 }), null, 1000);
  assert.equal(r.ok, true); assert.equal(r.value, 90); assert.equal(r.osAccuracyDeg, 12);
  const r2 = E.samples.orientationSample(ev({ webkitCompassHeading: 90, timeStamp: 2000 }), null, 2000);
  assert.equal(r2.osAccuracyDeg, null); // unknown accuracy is not invented
});
test("sentinels: repeated and out-of-order timestamps are rejected", () => {
  const prev = { timestamp: 2000 };
  assert.equal(E.samples.orientationSample(ev({ timeStamp: 2000 }), prev, 2000).reason, "repeatedTimestamp");
  assert.equal(E.samples.orientationSample(ev({ timeStamp: 1900 }), prev, 2000).reason, "outOfOrderTimestamp");
});
test("sentinels: future timestamps are rejected (250 ms skew tolerated)", () => {
  assert.equal(E.samples.orientationSample(ev({ timeStamp: 5000 }), null, 4000).reason, "futureTimestamp");
  assert.equal(E.samples.orientationSample(ev({ timeStamp: 4200 }), null, 4000).ok, true);
});

/* ---------- 4. smoothing with injected clock ---------- */
test("smoothing: first sample passes through; fast-follow above a 45° gap", () => {
  const s = E.smoothing.createSmoother();
  s.feed(0, 1000);
  let v = 0;
  for (let t = 1100; t <= 1600; t += 100) v = s.feed(90, t); // jumps 90° at 1100 (tau 60 ms), then eases
  assert.ok(Math.abs(E.angle.signedDiff(v, 90)) < 3, `fast-follow reached ${v}`);
});
test("smoothing: small jitter is damped below the 45° gap", () => {
  const s = E.smoothing.createSmoother();
  s.feed(0, 1000);
  const v = s.feed(10, 1033); // 10° jitter, tau 140 ms, dt 33 ms
  assert.ok(v < 2.5, `damped jump is ${v}`);
  assert.ok(v > 0.5, `still moves toward the sample: ${v}`);
});
test("smoothing: dt is clamped to 0.5 s (a longer step inside the gap behaves the same)", () => {
  const a = E.smoothing.createSmoother(); a.feed(0, 1000); const va = a.feed(30, 1900); // 0.9 s → clamped 0.5
  const b = E.smoothing.createSmoother(); b.feed(0, 1000); const vb = b.feed(30, 1500); // 0.5 s
  nearly(va, vb, 1e-9);
});
test("smoothing: a sample gap over 1 s resets the filter (no catch-up arc)", () => {
  const s = E.smoothing.createSmoother();
  s.feed(0, 1000);
  nearly(s.feed(170, 3000), 170); // 2 s gap → resetAfter: jumps straight to the new heading
});
test("smoothing: an explicit reset (source / north-reference / quality change) clears state", () => {
  const s = E.smoothing.createSmoother();
  s.feed(0, 1000); s.reset();
  nearly(s.feed(200, 1100), 200);
});

/* ---------- 5. alignment truth table ---------- */
const goodState = () => ({
  headingTrueDeg: 100, headingUncertaintyDeg: 1, confidence: "reliable",
  headingAgeMs: 100, settledMs: 1500,
  location: { reliable: true, approximate: false, ageMs: 1000, futureMs: 0 },
  targets: [{ present: true, nearTarget: false, deviationDeg: 0.5, bearingUncertaintyDeg: 0.2 }],
  isTravelDirection: false, isRelativeTracking: false, paused: false, stale: false
});
const fails = (mutate, reason) => {
  const st = goodState(); mutate(st);
  const r = E.alignment.alignmentConfirms(st);
  assert.equal(r.ok, false); assert.equal(r.reason, reason);
};
test("alignment: passes inside the budget", () => {
  assert.equal(E.alignment.alignmentConfirms(goodState()).ok, true);
});
test("alignment: budget is dev + (hUnc + tUnc) ≤ 3° exactly", () => {
  const edge = goodState(); // 2 + (0.5 + 0.5) = 3.0 exactly
  edge.headingUncertaintyDeg = 0.5;
  edge.targets[0].deviationDeg = 2; edge.targets[0].bearingUncertaintyDeg = 0.5;
  assert.equal(E.alignment.alignmentConfirms(edge).ok, true);
  edge.targets[0].deviationDeg = 2.01;
  assert.equal(E.alignment.alignmentConfirms(edge).reason, "budget");
});
test("alignment: rejects non-finite heading", () => fails((s) => { s.headingTrueDeg = NaN; }, "headingNotFinite"));
test("alignment: rejects unknown / zero heading uncertainty (never fabricated)", () => {
  fails((s) => { s.headingUncertaintyDeg = null; }, "headingUncertaintyUnknown");
  fails((s) => { s.headingUncertaintyDeg = 0; }, "headingUncertaintyUnknown");
});
test("alignment: rejects confidence below reliable", () => fails((s) => { s.confidence = "uncertain"; }, "confidenceNotReliable"));
test("alignment: rejects old or negative heading age", () => {
  fails((s) => { s.headingAgeMs = 251; }, "headingAge");
  fails((s) => { s.headingAgeMs = -1; }, "headingAge");
});
test("alignment: rejects insufficient settling", () => fails((s) => { s.settledMs = 999; }, "settling"));
test("alignment: rejects unreliable and approximate locations", () => {
  fails((s) => { s.location.reliable = false; }, "locationUnreliable");
  fails((s) => { s.location.approximate = true; }, "locationApproximate");
});
test("alignment: rejects stale and future locations", () => {
  fails((s) => { s.location.ageMs = 3001; }, "locationAge");
  fails((s) => { s.location.ageMs = -251; }, "locationAge");
});
test("alignment: rejects missing targets and near-target", () => {
  fails((s) => { s.targets = []; }, "noTarget");
  fails((s) => { s.targets[0].nearTarget = true; }, "nearTarget");
});
test("alignment: rejects unknown target bearing uncertainty", () => fails((s) => { s.targets[0].bearingUncertaintyDeg = null; }, "targetUncertaintyUnknown"));
test("alignment: travel direction and relative tracking can never confirm", () => {
  fails((s) => { s.isTravelDirection = true; }, "travelDirection");
  fails((s) => { s.isRelativeTracking = true; }, "relativeTracking");
});
test("alignment: rejects paused and stale sessions", () => {
  fails((s) => { s.paused = true; }, "paused");
  fails((s) => { s.stale = true; }, "stale");
});
test("alignment: every target (frozen saved mark AND live bearing) must pass the budget", () => {
  const st = goodState();
  st.targets.push({ present: true, nearTarget: false, deviationDeg: 2.9, bearingUncertaintyDeg: 0.2 });
  assert.equal(E.alignment.alignmentConfirms(st).reason, "budget");
});
test("alignment: near-target radius is max(10, fix radius); bearing uncertainty grows as distance shrinks", () => {
  assert.equal(E.alignment.nearTargetRadiusM(4), 10);
  assert.equal(E.alignment.nearTargetRadiusM(42), 42);
  const far = E.alignment.bearingUncertaintyDeg(10, 1000), near = E.alignment.bearingUncertaintyDeg(10, 20);
  assert.ok(near > far, `${near} > ${far}`);
  assert.equal(E.alignment.bearingUncertaintyDeg(10, 5), null); // inside the circle: undefined
});

/* ---------- 6. GPS acceptance gates (travel mode) ---------- */
const fix = (over) => Object.assign({
  latitude: -29.07, longitude: 27.62, timestamp: 10_000,
  speed: 1.5, radiusM: 10, course: 45, courseErrorDeg: 4
}, over);
test("gps: a fresh, fast, tight fix with genuine course error becomes reliable after the sustained sequence", () => {
  const hist = [];
  let r = E.travel.acceptTravelFix(fix({}), hist, 10_500); hist.push(r.accepted);
  assert.equal(r.ok, true); assert.equal(r.usable, false); assert.equal(r.reason, "awaitingSustainedFixes");
  r = E.travel.acceptTravelFix(fix({ timestamp: 12_000, longitude: 27.621 }), hist, 12_500); hist.push(r.accepted);
  assert.equal(r.usable, false);
  r = E.travel.acceptTravelFix(fix({ timestamp: 14_000, longitude: 27.622 }), hist, 14_500);
  assert.equal(r.usable, true); assert.equal(r.confidence, "reliable"); assert.equal(r.uncertaintyDeg, 4);
});
test("gps: rejects too old, too slow, radius too large and standing still", () => {
  assert.equal(E.travel.acceptTravelFix(fix({ timestamp: 5000 }), [], 10_000).reason, "fixTooOld");
  assert.equal(E.travel.acceptTravelFix(fix({ speed: 1.19 }), [], 10_500).reason, "tooSlow");
  assert.equal(E.travel.acceptTravelFix(fix({ speed: 0 }), [], 10_500).reason, "tooSlow");          // standing still
  assert.equal(E.travel.acceptTravelFix(fix({ radiusM: 26 }), [], 10_500).reason, "radiusTooLarge");
  assert.equal(E.travel.acceptTravelFix(fix({ speed: null }), [], 10_500).reason, "speedUnknown");
});
test("gps: rotating the phone without moving never produces a travel course (speed gate)", () => {
  // a phone spinning in place: position unchanged, speed ~0 → the 1.2 m/s gate rejects
  assert.equal(E.travel.acceptTravelFix(fix({ speed: 0.2 }), [], 10_500).reason, "tooSlow");
});
test("gps: rejects repeated and out-of-order fixes", () => {
  const hist = [fix({ timestamp: 9000 })];
  assert.equal(E.travel.acceptTravelFix(fix({ timestamp: 9000 }), hist, 10_000).reason, "repeatedTimestamp");
  assert.equal(E.travel.acceptTravelFix(fix({ timestamp: 8000 }), hist, 10_000).reason, "outOfOrderTimestamp");
});
test("gps: negative / absent course is rejected", () => {
  assert.equal(E.travel.acceptTravelFix(fix({ course: -5 }), [], 10_500).reason, "courseAbsent");
  assert.equal(E.travel.acceptTravelFix(fix({ course: null }), [], 10_500).reason, "courseAbsent");
});
test("gps: unknown course error requires a sustained, long, straight baseline and stays uncertain", () => {
  const hist = [];
  const mk = (t, dLon) => fix({ timestamp: t, courseErrorDeg: null, longitude: 27.62 + dLon });
  let r = E.travel.acceptTravelFix(mk(10_000, 0), hist, 10_500); hist.push(r.accepted);
  assert.equal(r.usable, false); assert.equal(r.reason, "awaitingSustainedFixes");
  r = E.travel.acceptTravelFix(mk(12_000, 0.00015), hist, 12_500); hist.push(r.accepted); // ~15 m east
  assert.equal(r.usable, false); assert.equal(r.reason, "awaitingSustainedFixes");
  r = E.travel.acceptTravelFix(mk(14_000, 0.0003), hist, 14_500);                        // ~30 m total
  assert.equal(r.usable, true); assert.equal(r.confidence, "uncertain"); assert.equal(r.uncertaintyDeg, null);
});
test("gps: a short or dog-legged baseline is refused when course error is unknown", () => {
  const mk = (t, lat, lon) => fix({ timestamp: t, courseErrorDeg: null, latitude: lat, longitude: lon });
  const hist = [];
  let r = E.travel.acceptTravelFix(mk(10_000, -29.07, 27.62), hist, 10_500); hist.push(r.accepted);
  r = E.travel.acceptTravelFix(mk(12_000, -29.07, 27.620001), hist, 12_500); hist.push(r.accepted); // ~10 cm
  r = E.travel.acceptTravelFix(mk(14_000, -29.07, 27.620002), hist, 14_500);
  assert.equal(r.reason, "baselineTooShort");
  const h2 = [];
  r = E.travel.acceptTravelFix(mk(20_000, -29.07, 27.62), h2, 20_500); h2.push(r.accepted);
  r = E.travel.acceptTravelFix(mk(22_000, -29.071, 27.62), h2, 22_500); h2.push(r.accepted); // 111 m south
  r = E.travel.acceptTravelFix(mk(24_000, -29.068, 27.63), h2, 24_500);                      // north-east
  assert.equal(r.reason, "baselineNotStraight");
});

/* ---------- 8. gyro relative tracking: anchor expiry + gap invalidation ---------- */
test("rel tracker: anchored heading follows full 3D quaternion rotation", () => {
  const t = E.rel.createRelTracker();
  const q0 = [0, 0, 0, 1];
  t.push(q0, 1000);
  assert.equal(t.setAnchor(90, "trueNorth", 1000).ok, true);
  let s = t.sample(1500);
  assert.equal(s.ok, true); nearly(s.value, 90);
  const q1 = [0, 0, -Math.sin(15 * E.D2R), Math.cos(15 * E.D2R)]; // device yawed 30° clockwise
  t.push(q1, 1200);                                              // 200 ms gap: anchor survives
  s = t.sample(1200);
  nearly(s.value, 120);
  assert.equal(s.northReference, "trueNorth");
});
test("rel tracker: anchor expires at 60 s and must be re-set by the user", () => {
  const t = E.rel.createRelTracker();
  t.push([0, 0, 0, 1], 1000); t.setAnchor(0, "magnetic", 1000);
  assert.equal(t.sample(61_000 - 1).ok, true);           // 59 999 ms after the anchor: still valid
  const r = t.sample(61_001);
  assert.equal(r.ok, false); assert.equal(r.reason, "anchorExpired");
  assert.equal(t.hasAnchor(), false);
  assert.equal(t.sample(62_000).reason, "noAnchor");     // gone until the user re-sets it
});
test("rel tracker: an integration gap over 250 ms invalidates the anchor", () => {
  const t = E.rel.createRelTracker();
  t.push([0, 0, 0, 1], 1000); t.setAnchor(0, "magnetic", 1000);
  const r = t.push([0, 0, 0, 1], 1251);                  // 251 ms later
  assert.equal(r.anchorLost, true); assert.equal(r.reason, "integrationGap");
  assert.equal(t.hasAnchor(), false);
  // a gap of exactly 250 ms is tolerated
  const t2 = E.rel.createRelTracker();
  t2.push([0, 0, 0, 1], 1000); t2.setAnchor(0, "magnetic", 1000);
  const r2 = t2.push([0, 0, 0, 1], 1250);
  assert.equal(t2.hasAnchor(), true); assert.equal(r2.anchorLost, undefined);
});
test("rel tracker: anchors are session-bound and never survive a session reset", () => {
  const t = E.rel.createRelTracker();
  t.push([0, 0, 0, 1], 1000); t.setAnchor(0, "magnetic", 1000);
  t.resetSession();
  assert.equal(t.hasAnchor(), false);
  assert.equal(t.sample(1500).reason, "noAnchor");
});
test("rel tracker: a hand-compass anchor keeps the magnetic reference", () => {
  const t = E.rel.createRelTracker();
  t.push([0, 0, 0, 1], 1000); t.setAnchor(0, "magnetic", 1000);
  const s = t.sample(1500);
  assert.equal(s.northReference, "magnetic"); // declination is applied once, elsewhere
});

/* ---------- quality model (B1/B2/B3) ---------- */
test("quality: unknown OS accuracy stays uncertain — never promoted to reliable", () => {
  const r = E.quality.assessQuality({ sample: { value: 100, timestamp: 1000 }, osAccuracyDeg: null, nowMs: 1200 });
  assert.equal(r.issue, "accuracyUnknown");
  assert.equal(r.confidence, "uncertain");
  assert.equal(r.uncertaintyDeg, null); // no fabricated ± bound
  assert.notEqual(r.confidence, "reliable");
});
test("quality: a genuine OS accuracy can produce reliable confidence and is the only degree bound", () => {
  const r = E.quality.assessQuality({ sample: { value: 100, timestamp: 1000 }, osAccuracyDeg: 8, nowMs: 1200 });
  assert.equal(r.confidence, "reliable");
  assert.equal(r.uncertaintyDeg, 8);
  const bad = E.quality.assessQuality({ sample: { value: 100, timestamp: 1000 }, osAccuracyDeg: 40, nowMs: 1200 });
  assert.equal(bad.issue, "calibrationRequired");
  assert.notEqual(bad.confidence, "reliable");
});
test("quality: field strength far from the WMM model marks magnetic interference; 0° OS error is not credible", () => {
  const r = E.quality.assessQuality({ sample: { value: 100, timestamp: 1000 }, osAccuracyDeg: 5, measuredFieldF: 20000, modelFieldF: 50000, nowMs: 1200 });
  assert.equal(r.issue, "magneticInterference");
  assert.equal(r.confidence, "unreliable");
  const z = E.quality.assessQuality({ sample: { value: 100, timestamp: 1000 }, osAccuracyDeg: 0, nowMs: 1200 });
  assert.equal(z.uncertaintyDeg, null);
  assert.notEqual(z.confidence, "reliable");
});
test("quality: stale samples are flagged; WMM expiry surfaces modelExpired", () => {
  const s = E.quality.assessQuality({ sample: { value: 100, timestamp: 1000 }, osAccuracyDeg: 5, nowMs: 5000 });
  assert.equal(s.issue, "stale");
  const m = E.quality.assessQuality({ sample: { value: 100, timestamp: 1000 }, osAccuracyDeg: 5, modelState: "expired", nowMs: 1200 });
  assert.equal(m.issue, "modelExpired");
});

/* ---------- source ladder (C1/C2/C4) ---------- */
test("ladder: demotes on error with a distinct kind and recovers after the hold", () => {
  const L = E.ladder.createLadder(["aos", "abs", "rel"]);
  L.noteSample("aos", 1000);
  assert.equal(L.current(1100), "aos");
  L.noteError("aos", E.ladder.FAILURE.NOT_READABLE, 1100);
  assert.equal(L.current(1200), null);           // suspended during the recovery hold
  L.noteSample("abs", 2300);
  assert.equal(L.current(2300), "abs");          // fallback takes over — never silently disabled
  L.noteSample("aos", 5000);
  assert.equal(L.current(5000), "aos");          // recovery/probe can bring it back
});
test("ladder: a provisional source never traps the fallback", () => {
  const L = E.ladder.createLadder(["aos", "rel"]);
  L.noteSample("rel", 1000, { provisional: true });
  assert.equal(L.current(1100), "rel");          // usable while nothing better is live
  L.noteSample("aos", 1200);
  assert.equal(L.current(1300), "aos");          // better source wins immediately
});
test("ladder: error classification distinguishes permission / hardware / absence", () => {
  assert.equal(E.ladder.classifySensorError({ name: "NotAllowedError" }), "notAllowed");
  assert.equal(E.ladder.classifySensorError({ name: "NotReadableError" }), "notReadable");
  assert.equal(E.ladder.classifySensorError({ name: "NotSupportedError" }), "absent");
  assert.equal(E.ladder.classifySensorError({ name: "WeirdError" }), "unknown");
});

/* ---------- device profile (D3) ---------- */
test("profile: never claims a class without a frame-time measurement", () => {
  assert.equal(E.profile.estimateDeviceProfile({ deviceMemory: 8, hardwareConcurrency: 8 }).class, "unknown");
  assert.equal(E.profile.estimateDeviceProfile({ deviceMemory: 2, hardwareConcurrency: 2 }).class, "unknown");
});
test("profile: measured jank → low-end profile with reduced sampling and rendering", () => {
  const p = E.profile.estimateDeviceProfile({ frameTimeSamples: [50, 55, 60, 52, 58] });
  assert.equal(p.class, "low"); assert.equal(p.sampleHz, 15); assert.equal(p.repaintMs, 66); assert.equal(p.probeMs, 60000);
});

/* ---------- location state (E4) ---------- */
test("location: approximate origins are marked and never reliable; unknown motion grows the error circle", () => {
  const town = E.location.makeFix({ lat: -29.07, lon: 27.62, source: "town", approximate: true, timestampMs: 1000, accuracyM: null });
  assert.equal(town.approximate, true); assert.equal(town.reliable, false);
  const gps = E.location.makeFix({ lat: -29.07, lon: 27.62, source: "gps", timestampMs: 1000, accuracyM: 10, speedMps: null });
  assert.equal(gps.reliable, true);
  const grown = E.location.errorRadiusNow(gps, 4000); // 3 s later, speed unknown → walking speed
  assert.equal(grown, 10 + 1.2 * 3);
  const still = E.location.errorRadiusNow(E.location.makeFix({ lat: 0, lon: 0, source: "gps", timestampMs: 1000, accuracyM: 10, speedMps: 0 }), 2000);
  assert.equal(still, 10); // reported stationary does not grow
});
test("location: freshness follows the 3 s / 250 ms windows", () => {
  const f = E.location.makeFix({ lat: 0, lon: 0, source: "gps", timestampMs: 1000, accuracyM: 5 });
  assert.equal(E.location.fixFresh(f, 3500), true);
  assert.equal(E.location.fixFresh(f, 4001), false);
  assert.equal(E.location.fixFresh(f, 700), false); // future beyond 250 ms
});
