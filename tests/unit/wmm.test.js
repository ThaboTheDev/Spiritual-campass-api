// WMM2025 tests against NOAA's published test values (WMM2025_TEST_VALUES.txt, NCEI, Dec 2024)
// plus validity-window, uncertainty, polar blackout and cache behaviour.
import test from "node:test";
import assert from "node:assert/strict";
import "../../public/geo.js";               // self-attaches globalThis.TSHKGeo
import "../../public/engine.js";            // self-attaches globalThis.TSHKEngine

const G = globalThis.TSHKGeo;
const E = globalThis.TSHKEngine;

/* NOAA WMM2025_TEST_VALUES.txt — field order:
   date, height(km), lat, lon, X, Y, Z, H, F, I(deg), D(deg)  [nT]
   https://www.ncei.noaa.gov/sites/default/files/2025-02/WMM2025_TEST_VALUES.txt */
const NOAA = [
  [2025.0, 0.0, 80.0, 0.0, 6521.6, 145.9, 54791.5, 6523.2, 55178.5, 83.21, 1.28],
  [2025.0, 0.0, 0.0, 120.0, 39677.8, -109.6, -10580.2, 39677.9, 41064.3, -14.93, -0.16],
  [2025.0, 0.0, -80.0, 240.0, 6117.5, 15751.9, -52022.5, 16898.1, 54698.2, -72.00, 68.78],
  [2025.0, 100.0, 80.0, 0.0, 6216.0, 92.4, 52598.8, 6216.7, 52964.9, 83.26, 0.85],
  [2025.0, 100.0, 0.0, 120.0, 37688.6, -96.2, -10152.1, 37688.7, 39032.1, -15.08, -0.15],
  [2025.0, 100.0, -80.0, 240.0, 5907.6, 14780.3, -49540.7, 15917.1, 52035.0, -72.19, 68.21],
  [2027.5, 0.0, 80.0, 0.0, 6500.8, 294.5, 54869.4, 6507.5, 55253.9, 83.24, 2.59],
  [2027.5, 0.0, 0.0, 120.0, 39701.6, -167.4, -10381.8, 39702.0, 41036.9, -14.65, -0.24],
  [2027.5, 0.0, -80.0, 240.0, 6200.7, 15730.3, -51783.7, 16908.3, 54474.2, -71.92, 68.49],
  [2027.5, 100.0, 80.0, 0.0, 6196.7, 233.8, 52670.5, 6201.1, 53034.3, 83.29, 2.16],
  [2027.5, 100.0, 0.0, 120.0, 37711.5, -148.7, -9969.8, 37711.8, 39007.4, -14.81, -0.23],
  [2027.5, 100.0, -80.0, 240.0, 5984.0, 14760.1, -49317.7, 15927.0, 51825.7, -72.10, 67.93]
];

test("WMM2025: full field matches NOAA's published test values (12 points, 2025.0 and 2027.5)", () => {
  for (const [date, km, lat, lon, X, Y, Z, H, F, I, D] of NOAA) {
    const r = G.wmmField(lat, lon, km, date);
    assert.ok(Math.abs(r.x - X) < 1, `X ${r.x} ≉ ${X} @${date} ${lat},${lon}`);
    assert.ok(Math.abs(r.y - Y) < 1, `Y ${r.y} ≉ ${Y}`);
    assert.ok(Math.abs(r.z - Z) < 1, `Z ${r.z} ≉ ${Z}`);
    assert.ok(Math.abs(r.h - H) < 1, `H ${r.h} ≉ ${H}`);
    assert.ok(Math.abs(r.f - F) < 1, `F ${r.f} ≉ ${F}`);
    assert.ok(Math.abs(r.inclinationDeg - I) < 0.02, `I ${r.inclinationDeg} ≉ ${I}`);
    assert.ok(Math.abs(r.declinationDeg - D) < 0.02, `D ${r.declinationDeg} ≉ ${D} @${date} ${lat},${lon}`);
  }
});

test("WMM2025: metadata is runtime-readable (F5) — model, epoch, validity window", () => {
  assert.equal(E.wmm.WMM.model, "WMM2025");
  assert.equal(E.wmm.WMM.epoch, 2025.0);
  assert.equal(E.wmm.WMM.degree, 12);
  assert.equal(E.wmm.WMM.order, 12);
  assert.equal(new Date(E.wmm.WMM.validFromMs).toISOString().slice(0, 10), "2025-01-01");
  assert.equal(new Date(E.wmm.WMM.validUntilMs).toISOString().slice(0, 10), "2030-01-01");
});

test("WMM validity: both sides of 2025-01-01 and 2030-01-01 UTC (F2)", () => {
  assert.equal(E.wmm.wmmModelState(Date.UTC(2024, 11, 31, 23, 59, 59)), "beforeEpoch");
  assert.equal(E.wmm.wmmModelState(Date.UTC(2025, 0, 1, 0, 0, 0)), "ok");
  assert.equal(E.wmm.wmmModelState(Date.UTC(2027, 5, 15)), "ok");
  assert.equal(E.wmm.wmmModelState(Date.UTC(2029, 11, 31, 23, 59, 59)), "ok");
  assert.equal(E.wmm.wmmModelState(Date.UTC(2030, 0, 1, 0, 0, 0)), "expired");
});

test("WMM declination: outside the validity window the value is unavailable and modelExpired is raised", () => {
  const stub = () => ({ available: true, declinationDeg: -25, blackout: "ok", h: 22000, f: 55000 });
  const before = E.wmm.declinationAt(-29, 27, 0, Date.UTC(2024, 11, 31), stub);
  assert.equal(before.declinationDeg, null);
  assert.equal(before.issue, "modelExpired");
  const after = E.wmm.declinationAt(-29, 27, 0, Date.UTC(2030, 0, 2), stub);
  assert.equal(after.declinationDeg, null);
  assert.equal(after.issue, "modelExpired");
  const ok = E.wmm.declinationAt(-29, 27, 0, Date.UTC(2026, 5, 15), stub);
  assert.equal(ok.declinationDeg, -25);
  assert.equal(ok.issue, "none");
});

test("WMM uncertainty: sqrt(0.26² + (5417/H)²) degrees (F1)", () => {
  const u = E.wmm.wmmUncertaintyDeg(5417);
  assert.ok(Math.abs(u - Math.sqrt(0.26 ** 2 + 1)) < 1e-9);
  assert.equal(E.wmm.wmmUncertaintyDeg(0), null);
  assert.equal(E.wmm.wmmUncertaintyDeg(-5), null);
});

test("WMM polar blackout: declination unavailable below 2000 nT horizontal field, never zero (F4)", () => {
  const blackout = () => ({ available: false, declinationDeg: null, blackout: "unreliable", h: 1200, f: 52000 });
  const r = E.wmm.declinationAt(89, 0, 0, Date.UTC(2026, 0, 1), blackout);
  assert.equal(r.declinationDeg, null);
  assert.notEqual(r.declinationDeg, 0);
  assert.equal(r.available, false);
  // caution zone (2000–6000 nT): available but flagged
  const caution = () => ({ available: true, declinationDeg: 2.16, blackout: "caution", h: 6201, f: 53034 });
  const c = E.wmm.declinationAt(80, 0, 100000, Date.UTC(2027, 6, 1), caution);
  assert.equal(c.declinationDeg, 2.16);
  assert.equal(c.issue, "weakMagneticField");
});

test("WMM cache: keyed by UTC day / ≥100 m move / ≥100 m altitude (F3)", () => {
  let calls = 0;
  const ev = () => { calls++; return { available: true, declinationDeg: -25, blackout: "ok", h: 22000, f: 55000 }; };
  const cache = E.wmm.createWmmCache(ev);
  const day1 = Date.UTC(2026, 5, 15, 10, 0, 0);
  cache.get(-29.07, 27.62, 0, day1);
  cache.get(-29.07, 27.62, 0, day1);
  assert.equal(calls, 1); // same key
  cache.get(-29.07, 27.62, 0, day1 + 86400000); // next UTC day
  assert.equal(calls, 2);
  cache.get(-29.071, 27.62, 0, day1 + 86400000); // >100 m north
  assert.equal(calls, 3);
  cache.get(-29.071, 27.62, 150, day1 + 86400000); // +150 m altitude
  assert.equal(calls, 4);
  cache.get(-29.071, 27.62, 50, day1 + 86400000);  // +50 m: new key (bucket), then cached
  cache.get(-29.071, 27.62, 50, day1 + 86400000);
  assert.equal(calls, 5);
});
