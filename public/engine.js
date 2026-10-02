/* ---------- TSHK Compass engine (pure, no DOM) ----------
   Small testable functions mirroring the mobile split:
     angle / heading maths · sample sentinels · smoothing · quality assessment ·
     alignment policy · source ladder · travel mode · relative (gyro) tracking ·
     WMM policy · location state · device profile.
   Every heading state transition is described by
     { value, northReference, timestamp, confidence, issue, uncertaintyDeg }
   where northReference is exactly one of 'magnetic' | 'trueNorth' | 'relative'.
   Hard rules enforced here:
     - a heading is never invented; rejected samples stay rejected;
     - declination is added exactly once and only to magnetic samples;
     - uncertainty is only ever a genuine OS-reported error in degrees; raw-sensor and
       human-anchored paths carry uncertaintyDeg=null (never an invented ± bound);
     - unknown is never treated as good;
     - travel direction (GPS course) is a separate mode and never confirms alignment.

   Loaded as a classic script before app.js; also importable by node:test (no import/export
   syntax, so one file serves both). Attaches globalThis.TSHKEngine. */
const TSHKEngine = (function () {
"use strict";
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/* ---------- angles ---------- */
const angle = {
  norm(a) { return ((a % 360) + 360) % 360; },
  signedDiff(target, current) { return ((target - current + 540) % 360) - 180; },
  finite(v) { return typeof v === "number" && isFinite(v); }
};

/* ---------- heading maths ---------- */
/* Pointing convention: with the screen facing up, the TOP EDGE of the phone points;
   as the phone is raised upright the pointing direction blends into the BACK of the
   phone. Earth coordinates are ENU (east, north, up). The dial is not a camera
   viewfinder. The blend weight w is the squared up-component of the top edge. */
function facing(xE, xN, xU, yE, yN, yU, zE, zN, zU, th) {
  const st = Math.sin(th), ct = Math.cos(th);
  const tE = st * xE + ct * yE, tN = st * xN + ct * yN, tU = st * xU + ct * yU; // top edge of the screen
  const w = tU * tU;                                                           // 0 when flat, 1 when upright
  return angle.norm(Math.atan2(tE - w * zE, tN - w * zN) * R2D);               // add the back of the phone as it rises
}
/* alpha/beta/gamma (deg) in the screen frame; screenAngleRad compensates for interface
   rotation because deviceorientation angles are relative to the device, not the UI. */
function headingFromEuler(alpha, beta, gamma, screenAngleRad) {
  const a = alpha * D2R, b = (beta || 0) * D2R, g = (gamma || 0) * D2R;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  return facing(ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg,
    -sa * cb, ca * cb, sb,
    ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, cb * cg, screenAngleRad || 0);
}
/* Quaternion [x,y,z,w] from an AbsoluteOrientationSensor constructed with
   referenceFrame:"screen": the screen frame already includes interface rotation, so no
   extra screen angle is applied here (th=0 inside facing()). If the sensor were ever
   constructed with referenceFrame:"device", the caller must fold screenAngle in itself. */
function headingFromQuat(q) {
  const [x, y, z, w] = q;
  return facing(1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y),
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x),
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0);
}
/* quaternion helpers (full 3D, used by the relative tracker) */
const quat = {
  conj(q) { return [-q[0], -q[1], -q[2], q[3]]; },
  mul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  },
  normalize(q) {
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    return n > 0 ? [q[0] / n, q[1] / n, q[2] / n, q[3] / n] : [0, 0, 0, 1];
  },
  rotate(q, v) { // rotate vector v by quaternion q
    const p = quat.mul(quat.mul(q, [v[0], v[1], v[2], 0]), quat.conj(q));
    return [p[0], p[1], p[2]];
  },
  fromRates(rx, ry, rz, dt) { // integrate angular rate (rad/s) over dt seconds
    const hx = rx * dt / 2, hy = ry * dt / 2, hz = rz * dt / 2;
    return quat.normalize([hx, hy, hz, 1]);
  }
};

/* ---------- north reference + one-time declination ---------- */
const REF = { MAGNETIC: "magnetic", TRUE: "trueNorth", RELATIVE: "relative" };
/* Converts one sample to true north exactly once. A magnetic sample gets declination
   added once; a trueNorth sample is returned untouched; a relative sample is returned
   untouched (its anchor already carries the reference; see reltracker). */
function toTrue(value, northReference, declinationDeg) {
  if (northReference === REF.MAGNETIC) {
    if (!angle.finite(declinationDeg)) return null; // declination unavailable: refuse, never zero
    return angle.norm(value + declinationDeg);
  }
  return angle.norm(value);
}

/* ---------- sample sentinels (A3) ---------- */
const FUTURE_SKEW_MS = 250; // a timestamp up to 250 ms ahead is tolerable; beyond that it is "future"

/* Timestamp bookkeeping: repeated and out-of-order timestamps are rejections, because a
   repeated value is not proof of a live sensor. */
function checkTimestamp(t, prevT, nowMs) {
  if (!angle.finite(t) || t <= 0) return { ok: false, reason: "badTimestamp" };
  if (angle.finite(nowMs) && t > nowMs + FUTURE_SKEW_MS) return { ok: false, reason: "futureTimestamp" };
  if (angle.finite(prevT)) {
    if (t === prevT) return { ok: false, reason: "repeatedTimestamp" };
    if (t < prevT) return { ok: false, reason: "outOfOrderTimestamp" };
  }
  return { ok: true };
}

/* Validates one raw deviceorientation event (or an already-normalised object with the
   same fields) into a magnetic or relative heading sample. Returns
   { ok:true, kind:'absolute'|'relative', value, timestamp, osAccuracyDeg } or
   { ok:false, reason }. The event's own timeStamp is used when present. */
function orientationSample(e, prevState, nowMs) {
  const t = angle.finite(e.timeStamp) ? e.timeStamp : nowMs;
  const ts = checkTimestamp(t, prevState && prevState.timestamp, nowMs);
  if (!ts.ok) return ts;
  if (e.alpha === 0 && e.beta === 0 && e.gamma === 0) return { ok: false, reason: "allZeroPlaceholder" };
  if (typeof e.webkitCompassHeading === "number") {
    if (!isFinite(e.webkitCompassHeading)) return { ok: false, reason: "nanHeading" };
    if (e.webkitCompassHeading < 0) return { ok: false, reason: "negativeHeading" };
    const acc = e.webkitCompassAccuracy;
    if (typeof acc === "number" && acc < 0) return { ok: false, reason: "negativeAccuracy" };
    return {
      ok: true, kind: "absolute", value: angle.norm(e.webkitCompassHeading), timestamp: t,
      osAccuracyDeg: typeof acc === "number" && isFinite(acc) && acc > 0 ? acc : null
    };
  }
  if (typeof e.alpha !== "number" || !isFinite(e.alpha)) return { ok: false, reason: "nanAlpha" };
  const value = headingFromEuler(e.alpha, e.beta, e.gamma, e.screenAngleRad || 0);
  const absolute = e.absolute === true || e.type === "deviceorientationabsolute";
  return {
    ok: true, kind: absolute ? "absolute" : "relative", value, timestamp: t,
    osAccuracyDeg: null // raw deviceorientation carries no genuine error field
  };
}

/* ---------- GPS acceptance (C6) and travel mode (C5) ---------- */
const GPS_POLICY = {
  maxFixAgeMs: 3000,          // fix no older than 3 s
  maxFutureMs: FUTURE_SKEW_MS,// and not more than 250 ms in the future
  minSpeedMps: 1.2,           // walkingSpeedMps: below this the course is noise
  maxRadiusM: 25,             // horizontal radius must be ≤ 25 m
  sustainedFixes: 3,          // "a sustained sequence of moving fixes" (web policy value)
  minBaselineM: 20,           // straight-displacement baseline when course error is unknown (web policy value)
  maxLegSpreadDeg: 20,        // legs must not fan out more than this to count as straight (web policy value)
  zeroErrorDeg: 0             // a 0° course-error estimate is not credible: treat as unknown
};
/* Evaluates one GPS fix for the travel-direction mode. `history` is an array of
   previously ACCEPTED fixes (oldest first). Never used for compass headings. */
function acceptTravelFix(fix, history, nowMs, policy) {
  const P = policy || GPS_POLICY;
  if (!fix || !angle.finite(fix.latitude) || !angle.finite(fix.longitude)) return { ok: false, reason: "badFix" };
  const ts = checkTimestamp(fix.timestamp, history.length ? history[history.length - 1].timestamp : null, nowMs);
  if (!ts.ok) return { ok: false, reason: ts.reason };
  const age = nowMs - fix.timestamp;
  if (age > P.maxFixAgeMs) return { ok: false, reason: "fixTooOld" };
  if (age < -P.maxFutureMs) return { ok: false, reason: "futureFix" };
  if (!angle.finite(fix.speed)) return { ok: false, reason: "speedUnknown" };
  if (fix.speed < P.minSpeedMps) return { ok: false, reason: "tooSlow" }; // rotating the phone without moving fails here
  if (!angle.finite(fix.radiusM)) return { ok: false, reason: "radiusUnknown" };
  if (fix.radiusM > P.maxRadiusM) return { ok: false, reason: "radiusTooLarge" };
  if (!angle.finite(fix.course) || fix.course < 0) return { ok: false, reason: "courseAbsent" };
  /* genuine course error only; absent or 0 is unknown */
  const err = angle.finite(fix.courseErrorDeg) && fix.courseErrorDeg > P.zeroErrorDeg ? fix.courseErrorDeg : null;
  const accepted = { latitude: fix.latitude, longitude: fix.longitude, timestamp: fix.timestamp, radiusM: fix.radiusM, course: angle.norm(fix.course), speed: fix.speed, courseErrorDeg: err };
  const seq = history.concat([accepted]);
  if (seq.length < P.sustainedFixes) return { ok: true, accepted, usable: false, reason: "awaitingSustainedFixes" };
  let confidence = "uncertain", uncertaintyDeg = err, note = err != null ? "courseErrorKnown" : "courseErrorUnknown";
  if (err == null) {
    /* unknown course error: demand a long, straight displacement baseline and still label
       the result uncertain (never reliable). */
    const first = seq[seq.length - P.sustainedFixes], last = accepted;
    const base = haversineM(first.latitude, first.longitude, last.latitude, last.longitude);
    if (base < P.minBaselineM) return { ok: true, accepted, usable: false, reason: "baselineTooShort" };
    const legsStraight = straightLegs(seq.slice(-P.sustainedFixes), P.maxLegSpreadDeg);
    if (!legsStraight) return { ok: true, accepted, usable: false, reason: "baselineNotStraight" };
    note = "baselineLongStraight";
    uncertaintyDeg = null; // honest: a straight baseline does not publish a degree error
  } else confidence = "reliable";
  return { ok: true, accepted, usable: true, confidence, uncertaintyDeg, note };
}
function straightLegs(legFixes, maxSpreadDeg) {
  const a = legFixes[0], b = legFixes[legFixes.length - 1];
  const overall = bearingDeg(a.latitude, a.longitude, b.latitude, b.longitude);
  for (let i = 1; i < legFixes.length; i++) {
    const leg = bearingDeg(legFixes[i - 1].latitude, legFixes[i - 1].longitude, legFixes[i].latitude, legFixes[i].longitude);
    if (Math.abs(angle.signedDiff(leg, overall)) > maxSpreadDeg) return false;
  }
  return true;
}
function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return angle.norm(Math.atan2(y, x) * R2D);
}
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, p1 = lat1 * D2R, p2 = lat2 * D2R, dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ---------- smoothing (D1) ---------- */
const SMOOTH = {
  dtMin: 0.001, dtMax: 0.5,      // keep: web dt clamp (recorded in the audit)
  tau: 0.14, tauFast: 0.06,      // 140 ms / 60 ms — numerically identical to the mobile constants
  fastGapDeg: 45,
  gapResetMs: 1000               // mobile resetAfter: a gap over 1 s resets the filter
};
/* Wrap-around-safe exponential smoother on the unit circle. Pure: inject nowMs. */
function createSmoother(opts) {
  const cfg = Object.assign({}, SMOOTH, opts || {});
  let x = 0, y = 1, init = false, t = 0;
  return {
    feed(h, nowMs) {
      const r = h * D2R, cx = Math.sin(r), cy = Math.cos(r);
      if (!init || nowMs - t > cfg.gapResetMs) { x = cx; y = cy; init = true; t = nowMs; return angle.norm(Math.atan2(x, y) * R2D); }
      const dt = Math.min(cfg.dtMax, Math.max(cfg.dtMin, (nowMs - t) / 1000));
      const gap = Math.abs(angle.signedDiff(h, Math.atan2(x, y) * R2D));
      const tau = gap > cfg.fastGapDeg ? cfg.tauFast : cfg.tau;
      const k = 1 - Math.exp(-dt / tau);
      x += k * (cx - x); y += k * (cy - y); t = nowMs;
      return angle.norm(Math.atan2(x, y) * R2D);
    },
    reset() { init = false; t = 0; },
    initialized() { return init; }
  };
}

/* ---------- quality model (B1/B2/B3/B4) ---------- */
const SensorReliability = { UNKNOWN: "unknown", UNRELIABLE: "unreliable", LOW: "low", MEDIUM: "medium", HIGH: "high" };
const HeadingConfidence = { UNRELIABLE: "unreliable", UNCERTAIN: "uncertain", RELIABLE: "reliable" };
const HeadingIssue = {
  NONE: "none", ACCURACY_UNKNOWN: "accuracyUnknown", CALIBRATION_REQUIRED: "calibrationRequired",
  MAGNETIC_INTERFERENCE: "magneticInterference", EXCESSIVE_MOTION: "excessiveMotion", HOLD_LEVEL: "holdLevel",
  STALE: "stale", GYRO_DRIFT: "gyroDrift", WEAK_MAGNETIC_FIELD: "weakMagneticField",
  MODEL_EXPIRED: "modelExpired", WAITING_FOR_MOVEMENT: "waitingForMovement"
};
/* Policy thresholds (web-chosen, documented; only osAccuracyDeg/courseErrorDeg/fix accuracy
   are ever genuine error bounds — these numbers below only pick states, they never become
   displayed degree errors):
     - webkitCompassAccuracy ≤ 10° → reliability high; ≤ 25° → medium; > 25° → low.
       (25° keeps the previous hint threshold; ≤ 10 is the new "high" cut.)
     - measured field strength vs WMM F: ratio > 25% off → magneticInterference;
       measured F below 50% of model F → weakMagneticField.
     - motionRate above 240 deg/s → excessiveMotion; tilt above 60° → holdLevel. */
const QUALITY_POLICY = { highAccuracyDeg: 10, mediumAccuracyDeg: 25, fieldRatioTolerance: 0.25, weakFieldRatio: 0.5, motionRateDegS: 240, tiltDeg: 60, staleAfterMs: 2000 };
/* Assesses one heading sample. `input`:
   { sample:{value, northReference, timestamp}, osAccuracyDeg|null, modelFieldF|null,
     measuredFieldF|null, motionRateDegS|null, tiltDeg|null, modelState, nowMs, prevIssue }
   Returns { reliability, confidence, issue, uncertaintyDeg }.
   uncertaintyDeg is only ever a genuine OS-reported error (never invented).
   NOTE (B4 honesty): the field-strength comparison catches hard-iron distortions that
   change the total intensity, but a CONSTANT magnetic bias that keeps |B| close to the
   model value can still evade these checks — they are diagnostics, not proof. */
function assessQuality(input) {
  const Q = QUALITY_POLICY;
  const s = input.sample || {};
  let uncertaintyDeg = null, reliability = SensorReliability.UNKNOWN, issue = HeadingIssue.NONE;
  const osAcc = input.osAccuracyDeg;
  if (angle.finite(osAcc) && osAcc > 0) {
    uncertaintyDeg = osAcc; // genuine OS error in degrees (webkitCompassAccuracy / course error)
    reliability = osAcc <= Q.highAccuracyDeg ? SensorReliability.HIGH : osAcc <= Q.mediumAccuracyDeg ? SensorReliability.MEDIUM : SensorReliability.LOW;
    if (osAcc > Q.mediumAccuracyDeg) issue = HeadingIssue.CALIBRATION_REQUIRED;
  } else {
    reliability = SensorReliability.UNKNOWN;
    issue = HeadingIssue.ACCURACY_UNKNOWN; // never promoted: unknown accuracy cannot be reliable
  }
  /* interference diagnostics from what the web can see */
  if (angle.finite(input.measuredFieldF) && angle.finite(input.modelFieldF) && input.modelFieldF > 0) {
    const ratio = Math.abs(input.measuredFieldF - input.modelFieldF) / input.modelFieldF;
    if (ratio > Q.fieldRatioTolerance) issue = HeadingIssue.MAGNETIC_INTERFERENCE;
    else if (input.measuredFieldF < Q.weakFieldRatio * input.modelFieldF) issue = HeadingIssue.WEAK_MAGNETIC_FIELD;
    if (reliability === SensorReliability.UNKNOWN) reliability = ratio > Q.fieldRatioTolerance ? SensorReliability.UNRELIABLE : SensorReliability.LOW;
    else if (ratio > Q.fieldRatioTolerance) reliability = SensorReliability.UNRELIABLE;
  }
  if (input.motionRateDegS != null && input.motionRateDegS > Q.motionRateDegS && issue === HeadingIssue.NONE) issue = HeadingIssue.EXCESSIVE_MOTION;
  if (input.tiltDeg != null && input.tiltDeg > Q.tiltDeg && issue === HeadingIssue.NONE) issue = HeadingIssue.HOLD_LEVEL;
  if (input.modelState === "expired" || input.modelState === "beforeEpoch") {
    if (issue === HeadingIssue.NONE) issue = HeadingIssue.MODEL_EXPIRED;
  }
  if (s.timestamp != null && input.nowMs != null && input.nowMs - s.timestamp > Q.staleAfterMs && issue === HeadingIssue.NONE) issue = HeadingIssue.STALE;
  /* confidence: reliable requires a known positive uncertainty AND good reliability AND no issue */
  let confidence = HeadingConfidence.UNCERTAIN;
  if (reliability === SensorReliability.UNRELIABLE || issue === HeadingIssue.MAGNETIC_INTERFERENCE) confidence = HeadingConfidence.UNRELIABLE;
  else if (uncertaintyDeg != null && uncertaintyDeg > 0 && issue === HeadingIssue.NONE &&
    (reliability === SensorReliability.HIGH || reliability === SensorReliability.MEDIUM)) confidence = HeadingConfidence.RELIABLE;
  return { reliability, confidence, issue, uncertaintyDeg };
}

/* ---------- alignment policy (E1/E2/E3) ---------- */
const ALIGN = {
  toleranceDeg: 3,            // the mobile alignment tolerance
  settleMs: 1000,             // ≥ 1 s of settling before any confirmation
  maxHeadingAgeMs: 250,       // heading ≤ 250 ms old and not negative
  maxLocationAgeMs: 3000,     // location ≤ 3 s old
  maxLocationFutureMs: 250,   // and not more than 250 ms in the future
  nearTargetFloorM: 10        // near-target radius = max(10 m, effective fix radius)
};
/* Near the destination the direction is undefined: within the fix radius (or 10 m,
   whichever is larger) the UI must hide direction and alignment prompts (E3). */
function nearTargetRadiusM(effectiveRadiusM) {
  return Math.max(ALIGN.nearTargetFloorM, angle.finite(effectiveRadiusM) && effectiveRadiusM > 0 ? effectiveRadiusM : 0);
}
/* Worst-case bearing error (deg) from a position error circle of radius r at distance d.
   Geometry, not an invented accuracy: grows as distance shrinks; null when the direction is
   undefined (inside the error circle — that is the near-target case). */
function bearingUncertaintyDeg(radiusM, distanceM) {
  if (!angle.finite(radiusM) || !angle.finite(distanceM) || distanceM <= radiusM) return null;
  return Math.asin(Math.min(1, radiusM / distanceM)) * R2D;
}
/* The full mobile gate. `state`:
   { headingTrueDeg, headingUncertaintyDeg, confidence, headingAgeMs, settledMs,
     location: { reliable, approximate, ageMs, futureMs },
     targets: [ { present, nearTarget, deviationDeg, bearingUncertaintyDeg } ],
     isTravelDirection, isRelativeTracking, paused, stale }
   Every condition must hold for EVERY target (frozen saved mark and live destination).
   Returns { ok:true } or { ok:false, reason } with one reason per rejection (truth table). */
function alignmentConfirms(state) {
  const A = ALIGN;
  const h = state.headingTrueDeg;
  if (!angle.finite(h)) return { ok: false, reason: "headingNotFinite" };
  const hu = state.headingUncertaintyDeg;
  if (!angle.finite(hu) || hu <= 0) return { ok: false, reason: "headingUncertaintyUnknown" };
  if (state.confidence !== HeadingConfidence.RELIABLE) return { ok: false, reason: "confidenceNotReliable" };
  const ha = state.headingAgeMs;
  if (!angle.finite(ha) || ha < 0 || ha > A.maxHeadingAgeMs) return { ok: false, reason: "headingAge" };
  if (!angle.finite(state.settledMs) || state.settledMs < A.settleMs) return { ok: false, reason: "settling" };
  const L = state.location || {};
  if (L.reliable !== true) return { ok: false, reason: "locationUnreliable" };
  if (L.approximate === true) return { ok: false, reason: "locationApproximate" };
  const la = L.ageMs;
  if (!angle.finite(la) || la < -A.maxLocationFutureMs || la > A.maxLocationAgeMs) return { ok: false, reason: "locationAge" };
  const targets = (state.targets || []).filter((t) => t && t.present);
  if (!targets.length) return { ok: false, reason: "noTarget" };
  for (const t of targets) {
    if (t.nearTarget) return { ok: false, reason: "nearTarget" };
    const tu = t.bearingUncertaintyDeg;
    if (!angle.finite(tu) || tu < 0) return { ok: false, reason: "targetUncertaintyUnknown" };
  }
  if (state.isTravelDirection === true) return { ok: false, reason: "travelDirection" };   // travel can never confirm
  if (state.isRelativeTracking === true) return { ok: false, reason: "relativeTracking" }; // relative tracking never confirms
  if (state.paused === true) return { ok: false, reason: "paused" };
  if (state.stale === true) return { ok: false, reason: "stale" };
  for (const t of targets) {
    const dev = Math.abs(t.deviationDeg);
    if (!angle.finite(dev)) return { ok: false, reason: "deviationNotFinite" };
    if (dev + (hu + t.bearingUncertaintyDeg) > A.toleranceDeg) return { ok: false, reason: "budget" };
  }
  return { ok: true };
}

/* ---------- source ladder (C1/C2/C3/C4) ---------- */
const LADDER = {
  acquireMs: 3000,        // how long a source may stay silent while acquiring
  staleMs: 2000,          // silence after live → stale
  qualityMs: 2000,        // how long a bad-quality source is tolerated before demotion
  recoveryHoldMs: 1000,   // hold time before a failed source is retried
  probeMs: 30000,         // background probe of the preferred source
  probeMsLow: 60000       // …on low-end devices
};
/* Capability-based ladder: sources are tried in order; a failure DEMOTES a source (it is
   never silently disabled) with a distinct failure kind; a provisional (uncalibrated)
   source stays available for calibration but never blocks the fallback; travel direction
   is not part of this ladder at all. Pure state machine — inject nowMs. */
function createLadder(order, opts) {
  const cfg = Object.assign({}, LADDER, opts || {});
  const state = new Map(order.map((id) => [id, { id, failures: 0, kind: null, provisional: false, lastSampleAt: 0, lastGoodAt: 0, lastProbeAt: 0, suspendedUntil: 0, error: null }]));
  const entries = [...state.values()];
  function active(nowMs) {
    return entries.filter((s) => nowMs >= s.suspendedUntil);
  }
  return {
    entries: () => entries.map((s) => Object.assign({}, s)),
    noteSample(id, nowMs, { goodQuality = true, provisional = false } = {}) {
      const s = state.get(id); if (!s) return;
      s.lastSampleAt = nowMs; s.provisional = provisional;
      if (goodQuality) { s.lastGoodAt = nowMs; s.error = null; s.failedAt = null; }
    },
    noteError(id, kind, nowMs) {
      const s = state.get(id); if (!s) return;
      s.failures += 1; s.kind = kind; s.error = kind; s.failedAt = nowMs;
      s.suspendedUntil = nowMs + cfg.recoveryHoldMs * s.failures; // demote, never silently disable
    },
    /* Current source: first non-provisional with a recent good sample; a failed source is
       out until it produces a fresh sample (probe/recovery), never silently revived. A
       provisional (uncalibrated) source is used only while nothing better is live (so it
       can be calibrated) and never traps the fallback. */
    current(nowMs) {
      for (const s of active(nowMs)) {
        if (s.error) continue;
        if (!s.provisional && s.lastGoodAt && nowMs - s.lastSampleAt <= cfg.staleMs) return s.id;
      }
      for (const s of active(nowMs)) {
        if (s.error) continue;
        if (s.provisional && s.lastSampleAt && nowMs - s.lastSampleAt <= cfg.staleMs) return s.id;
      }
      return null;
    },
    /* Which source should be probed next (acquire/quality timeouts + background probe). */
    nextProbe(nowMs, lowEnd) {
      const probeMs = lowEnd ? cfg.probeMsLow : cfg.probeMs;
      for (const s of active(nowMs)) {
        const silent = !s.lastSampleAt || nowMs - s.lastSampleAt > cfg.acquireMs;
        const stale = s.lastSampleAt && nowMs - s.lastSampleAt > cfg.staleMs;
        const probed = s.lastGoodAt && nowMs - s.lastProbeAt > probeMs;
        if ((silent && (!s.lastProbeAt || nowMs - s.lastProbeAt > cfg.acquireMs)) ||
          (stale && (!s.lastProbeAt || nowMs - s.lastProbeAt > cfg.staleMs)) ||
          probed) { s.lastProbeAt = nowMs; return s.id; }
      }
      return null;
    },
    timings() { return cfg; }
  };
}
/* Sensor failure kinds for the UI (C2): each surfaces differently. */
const FAILURE = { NOT_ALLOWED: "notAllowed", NOT_READABLE: "notReadable", INSECURE: "insecure", ABSENT: "absent", UNKNOWN: "unknown" };
function classifySensorError(err) {
  const n = err && err.name ? err.name : "";
  if (n === "NotAllowedError" || n === "SecurityError") return FAILURE.NOT_ALLOWED;
  if (n === "NotReadableError") return FAILURE.NOT_READABLE;
  if (n === "NotSupportedError" || n === "TypeError") return FAILURE.ABSENT;
  return FAILURE.UNKNOWN;
}

/* ---------- relative (gyro) tracking (G1/G2/G3) ---------- */
const REL = {
  anchorValidMs: 60000, // validFor: an anchor expires 60 s after it is set
  maxStepSeconds: 0.25  // an integration gap over 250 ms invalidates the anchor
};
/* Full 3D quaternion relative tracker. Anchors belong to one continuous session and are
   never persisted; expired or lost anchors must be re-set by the user. The anchor's
   northReference is whatever the user anchored to: 'trueNorth' for a sun anchor,
   'magnetic' for a hand-compass anchor. */
function createRelTracker() {
  let q = null, qAnchor = null, anchor = null, lastT = null, generation = 0;
  return {
    generation: () => generation,
    resetSession() { q = null; qAnchor = null; anchor = null; lastT = null; generation += 1; },
    push(qRaw, tMs) { // quaternion sample (relative orientation sensor or gyro integration)
      if (!qRaw || !angle.finite(tMs)) return { ok: false, reason: "badSample" };
      if (lastT != null && tMs - lastT > REL.maxStepSeconds * 1000) {
        const had = !!anchor;
        anchor = null; qAnchor = null; // integration gap: the anchor is lost, never reused
        lastT = tMs; q = quat.normalize(qRaw);
        return { ok: true, anchorLost: had, reason: "integrationGap" };
      }
      lastT = tMs; q = quat.normalize(qRaw);
      return { ok: true };
    },
    setAnchor(headingDeg, northReference, tMs) {
      if (!q || !angle.finite(headingDeg) || !angle.finite(tMs)) return { ok: false, reason: "notReady" };
      if (lastT != null && tMs - lastT > REL.maxStepSeconds * 1000) { anchor = null; qAnchor = null; return { ok: false, reason: "integrationGap" }; }
      qAnchor = q.slice();
      anchor = { headingDeg: angle.norm(headingDeg), northReference, at: tMs, generation };
      return { ok: true };
    },
    /* Sample toward the current pose: rotate the anchored top-edge direction by the 3D
       rotation since the anchor and read its azimuth. */
    sample(tMs) {
      if (!anchor || !q || !qAnchor) return { ok: false, reason: "noAnchor" };
      if (anchor.generation !== generation) return { ok: false, reason: "sessionEnded", anchorLost: true, };
      if (tMs - anchor.at > REL.anchorValidMs) { anchor = null; qAnchor = null; return { ok: false, reason: "anchorExpired", anchorLost: true }; }
      const d = quat.mul(q, quat.conj(qAnchor)); // device rotation since the anchor
      const h0 = anchor.headingDeg * D2R;
      const v = quat.rotate(d, [Math.sin(h0), Math.cos(h0), 0]); // anchored top-edge direction, rotated in 3D
      const horiz = Math.hypot(v[0], v[1]);
      if (horiz < 1e-6) return { ok: false, reason: "noHorizontalComponent", issue: HeadingIssue.HOLD_LEVEL };
      return {
        ok: true, value: angle.norm(Math.atan2(v[0], v[1]) * R2D),
        northReference: anchor.northReference, timestamp: tMs,
        relative: true, anchorAgeMs: tMs - anchor.at
      };
    },
    hasAnchor: () => !!anchor
  };
}

/* ---------- WMM policy (F1/F2/F3/F4/F5) ---------- */
const WMM = {
  model: "WMM2025",
  degree: 12, order: 12,
  epoch: 2025.0,
  validFromMs: Date.UTC(2025, 0, 1),       // 2025-01-01 UTC
  validUntilMs: Date.UTC(2030, 0, 1),      // valid BEFORE 2030-01-01 UTC
  uncertaintyConstant: 0.26,               // degrees
  uncertaintyFieldConst: 5417              // nT: sqrt(0.26² + (5417/H)²)
};
function wmmUncertaintyDeg(H_nt) {
  if (!angle.finite(H_nt) || H_nt <= 0) return null;
  return Math.sqrt(WMM.uncertaintyConstant ** 2 + (WMM.uncertaintyFieldConst / H_nt) ** 2);
}
/* Model state for a device clock. 'clockImplausible' is reserved for callers that have a
   separate plausibility check; the validity window itself drives expired/beforeEpoch. */
function wmmModelState(nowMs) {
  if (!angle.finite(nowMs)) return "clockImplausible";
  if (nowMs < WMM.validFromMs) return "beforeEpoch";
  if (nowMs >= WMM.validUntilMs) return "expired";
  return "ok";
}
/* F3 cache: spherical-harmonic evaluation keyed by UTC day / ≥100 m move / ≥100 m alt. */
function createWmmCache(evaluate) {
  let key = null, value = null;
  return {
    get(lat, lon, altM, nowMs) {
      const day = Math.floor(nowMs / 86400000);
      const posLat = Math.round(lat * 111000 / 100) * 100, posLon = Math.round(lon * 111000 / 100) * 100;
      const posAlt = Math.round((altM || 0) / 100) * 100;
      const k = day + "|" + posLat + "|" + posLon + "|" + posAlt;
      if (k === key) return value;
      key = k;
      value = evaluate(lat, lon, (altM || 0) / 1000, nowMs);
      return value;
    },
    invalidate() { key = null; value = null; }
  };
}
/* Wraps the raw wmmField evaluation (injected: globalThis.TSHKGeo.wmmField on the page,
   or a stub in tests) with validity, blackout and uncertainty policy. */
function declinationAt(lat, lon, altM, nowMs, evaluate) {
  const ev = evaluate || (typeof globalThis !== "undefined" && globalThis.TSHKGeo ? globalThis.TSHKGeo.wmmField : null);
  const modelState = wmmModelState(nowMs);
  if (!ev) return { declinationDeg: null, uncertaintyDeg: null, modelState, blackout: "unknown", available: false, issue: HeadingIssue.MODEL_EXPIRED };
  const decYear = 2025 + (nowMs - WMM.validFromMs) / (365.2425 * 86400000);
  const f = ev(lat, lon, (altM || 0) / 1000, decYear);
  const unavailable = modelState !== "ok" || !f.available;
  return {
    declinationDeg: unavailable ? null : f.declinationDeg,
    uncertaintyDeg: f.available && f.h > 0 && modelState === "ok" ? wmmUncertaintyDeg(f.h) : null,
    modelState, blackout: f.blackout, h: f.h, f: f.f,
    available: !unavailable,
    issue: modelState !== "ok" ? HeadingIssue.MODEL_EXPIRED : f.blackout === "caution" ? HeadingIssue.WEAK_MAGNETIC_FIELD : HeadingIssue.NONE
  };
}

/* ---------- location state (E4) ---------- */
const LOCATION_POLICY = {
  maxFixAgeMs: 3000, maxFutureMs: 250,
  movingWhenUnknownMps: 1.2 // unknown motion is NOT stationary: grow the circle at walking speed
};
/* A location fix keeps its metadata. Reduced-precision, mocked, town-selected, manually
   entered and centre-derived origins are marked approximate and are never treated as
   fresh GPS. */
function makeFix(input) {
  const approximate = input.approximate === true;
  return {
    lat: input.lat, lon: input.lon,
    accuracyM: angle.finite(input.accuracyM) ? input.accuracyM : null,
    timestampMs: angle.finite(input.timestampMs) ? input.timestampMs : null,
    speedMps: angle.finite(input.speedMps) ? input.speedMps : null,
    courseDeg: angle.finite(input.courseDeg) && input.courseDeg >= 0 ? input.courseDeg : null,
    courseErrorDeg: angle.finite(input.courseErrorDeg) && input.courseErrorDeg > 0 ? input.courseErrorDeg : null,
    source: input.source || "typed",
    approximate,
    /* reliable: a fresh, real GPS fix (or an explicit override). Approximate origins —
       reduced-precision, mocked, town-selected, manually entered, centre-derived — are
       never reliable. */
    reliable: input.reliable === undefined
      ? (input.source === "gps" && !approximate)
      : (input.reliable === true && !approximate)
  };
}
/* Reported motion grows the origin error circle between fixes. */
function errorRadiusNow(fix, nowMs) {
  const base = angle.finite(fix.accuracyM) ? fix.accuracyM : null;
  if (base == null) return null;
  const ageS = Math.max(0, (nowMs - (fix.timestampMs || nowMs)) / 1000);
  const speed = fix.speedMps != null ? fix.speedMps : LOCATION_POLICY.movingWhenUnknownMps;
  return base + speed * ageS;
}
function fixFresh(fix, nowMs) {
  if (!fix || !angle.finite(fix.timestampMs)) return false;
  const age = nowMs - fix.timestampMs;
  return age <= LOCATION_POLICY.maxFixAgeMs && age >= -LOCATION_POLICY.maxFutureMs;
}

/* ---------- device profile (D3) ---------- */
/* The class is never claimed without a measurement: hints (deviceMemory,
   hardwareConcurrency) only refine a class once frame times have been observed.
   'unknown' until then — with standard defaults, because they are the documented mobile
   baseline, not a device claim. */
function estimateDeviceProfile(hints) {
  const h = hints || {};
  const frames = Array.isArray(h.frameTimeSamples) ? h.frameTimeSamples.filter((v) => angle.finite(v) && v > 0).sort((a, b) => a - b) : [];
  const base = { class: "unknown", repaintMs: 33, sampleHz: 30, probeMs: 30000, measured: false };
  if (!frames.length) return base;
  const median = frames[Math.floor(frames.length / 2)];
  base.measured = true;
  if (median > 33) return { class: "low", repaintMs: 66, sampleHz: 15, probeMs: 60000, measured: true, medianFrameMs: median };
  if (median <= 20 && (h.hardwareConcurrency || 0) >= 8 && (h.deviceMemory || 0) >= 4)
    return { class: "high", repaintMs: 33, sampleHz: 30, probeMs: 30000, measured: true, medianFrameMs: median };
  return { class: "standard", repaintMs: 33, sampleHz: 30, probeMs: 30000, measured: true, medianFrameMs: median };
}

return {
  D2R, R2D,
  angle, heading: { facing, headingFromEuler, headingFromQuat, quat },
  ref: REF, toTrue,
  samples: { checkTimestamp, orientationSample },
  gps: GPS_POLICY, travel: { acceptTravelFix, straightLegs, bearingDeg, haversineM },
  smoothing: { createSmoother, SMOOTH },
  quality: { SensorReliability, HeadingConfidence, HeadingIssue, QUALITY_POLICY, assessQuality },
  alignment: { ALIGN, alignmentConfirms, nearTargetRadiusM, bearingUncertaintyDeg },
  ladder: { createLadder, LADDER, FAILURE, classifySensorError },
  rel: { createRelTracker, REL },
  wmm: { WMM, wmmUncertaintyDeg, wmmModelState, createWmmCache, declinationAt },
  location: { LOCATION_POLICY, makeFix, errorRadiusNow, fixFresh },
  profile: { estimateDeviceProfile }
};
})();
if (typeof globalThis !== "undefined") globalThis.TSHKEngine = TSHKEngine;
