# TSHK Compass (web) — parity validation

Companion to [`web-parity-audit.md`](web-parity-audit.md). The audit named the gaps
(mobile compass hardening vs. the web app); this file records what was run to close
them, what each environment must show, and what could not be verified here.

Work lives in `public/engine.js` (pure, testable core — heading maths, sentinels,
smoothing, quality, alignment policy, source ladder, gyro-rel, WMM, GPS policy) and
`public/app.js` (thin DOM layer). `public/geo.js` hosts the WMM2025 coefficients and
the field evaluation. No API routes, JSON fields, or existing features changed.

## 1. Automated checks run (2026-10-02)

| Command | Result |
|---|---|
| `npm test` (`node --test tests/unit/*.test.js`) | **124 tests, 118 pass, 0 fail, 6 skipped** (skips pre-existing: 1 in `api.test.js`, 5 in `payfast.test.js`) |
| `node --test tests/unit/engine.test.js` | 60 pass, 0 fail |
| `node --test tests/unit/wmm.test.js` | 7 pass, 0 fail |
| `npm run test:dom` (`tests/dom/dom-flows.mjs` + `tests/dom/boot-smoke.mjs`) | **All checks passed** (membership flows + new boot smoke of the real `index.html` script order: engine + geo attach, dial/towns render, travel toggle, diagnostics, translations) |
| `npm run test:e2e` | **Not run** — Playwright's Chromium download is blocked in this environment (`npx playwright install chromium` → download failure). The suite's own header sanctions `tests/dom/dom-flows.mjs` as the fallback covering the same screens; it passed. |
| `node --check` on `public/{app,engine,geo,lang,sw}.js` | syntax OK |
| lint / format / build | **the repo defines none** (`package.json` scripts are `test`, `test:e2e`, `test:dom` only) — `node --check` is the syntax gate |

## 2. Required unit groups → tests

All eight groups are in `tests/unit/engine.test.js` unless noted.

| # | Group | Tests |
|---|---|---|
| 1 | Heading maths — cardinals, tilt, upright | `heading: …` (Euler flat/tilt/upright conventions incl. the screen-angle blend; quaternion yaw convention `heading=360−φ`) |
| 2 | Declination applied exactly once (property) | `declination: toTrue(magnetic)` adds once; `toTrue(trueNorth)` is untouched; unknown declination → never 0 (verified live: `toTrue(100, magnetic, 17)=117`, `toTrue(100, trueNorth, 17)=100`) |
| 3 | Sentinel rejection | `sentinels: …` — NaN/null alpha, all-zero placeholder event, NaN/negative `webkitCompassHeading`, negative `webkitCompassAccuracy`, repeated/out-of-order timestamps, future timestamps (250 ms skew tolerated); negative/absent GPS course rejected in `gps` group |
| 4 | Smoothing, injected clock | `smoothing: …` — τ=140 ms; >45° jump fast-follows at τ=60 ms; reset after >1 s gap; reset on source change (via `resetSmoothing` in `app.js`) |
| 5 | Alignment gate truth table (E1) | `alignment: …` — one distinct `reason` per gate failure (finite true heading, uncertainty > 0, confidence, heading age ≤250 ms and not negative, ≥1 s settle, location reliable/not approximate, location age ≤3 s and ≤250 ms future, target present, not near-target, bearing uncertainty ≥ 0, travel mode, relative, paused, stale) + the pass case inside `dev+(hUnc+tUnc) ≤ 3°`, and the fail case outside |
| 6 | GPS gates (C6/D1) | `gps: …` — fix too old (>3 s), too slow (<1.2 m/s), radius >25 m, standing (course noise without sustained fixes), rotating (≥3 fixes + ≥20 m straight baseline when course error unknown, spread ≤20°), repeated and out-of-order fixes |
| 7 | WMM vs NOAA + validity window | `tests/unit/wmm.test.js` — all **12 published NOAA WMM2025 test values** (X/Y/Z/H/F/I/D within 1 nT / 0.02°), `wmmModelState` before 2025-01-01 / valid / before 2030-01-01 / expired (`modelExpired`, declination never extrapolated silently), uncertainty `sqrt(0.26²+(5417/H)²)`, polar blackout (H<2000 nT → unavailable, never 0; 2000–6000 caution), cache keying (UTC day / ≥100 m move / 100 m altitude buckets) |
| 8 | Gyro anchor | `rel: …` — 60 s anchor expiry; >250 ms integration gap invalidates; anchor carries its own north reference |

## 3. Audit closeout — every partial/missing row

Evidence paths are post-change. One deferral only (I2).

| Row | Status now | Where |
|---|---|---|
| A1 north reference per sample | done | `engine.js` `REF`/`toTrue`; `app.js:243` (ios→`magnetic` + screen-angle compensation), every `pushHeading` carries `(value, northReference, timestamp, confidence, issue, uncertainty)` |
| A2 declination once | done | `engine.js:89` `toTrue`; unit group 2 |
| A3 sentinels | done | `engine.js:97–140` `checkTimestamp`/`orientationSample`; unit group 3 |
| A4 screen rotation consistent | done | `app.js:197` `screenAngle()` on the Euler/iOS path; quaternion path is device-frame and rotation-independent |
| B1 quality model | done | `engine.js` `quality.assessQuality` + `HeadingIssue` |
| B2 unknown accuracy never promoted | done | `accuracyUnknown` → `uncertain`, never reliable; chip `cmp_accunk` |
| B3 no fabricated bounds | done (was implemented) | only genuine `webkitCompassAccuracy` is shown as degrees; `app.js` turn-± prints `±` only from `hs.uncertaintyDeg` |
| B4 interference diagnostics | done | field strength vs WMM total intensity F in `assessQuality` → `magneticInterference`/`weakMagneticField` chips |
| C1 bounded ladder | done | `engine.js` `LADDER` (acquire 3 s, stale 2 s, probe 30 s/60 s low-end via measured profile) |
| C2 failures demote; error kinds | done | `classifySensorError` (`NotAllowedError`/`NotReadableError`/`SecurityError`) + `noteError` removes the source until a fresh sample |
| C3 capability query must not hang | done | `app.js` acquire timeout (3 s) decides `rel`/`none` instead of waiting forever |
| C4 provisional never traps fallback; no silent GPS switch | done | ladder `current()` prefers working sources; provisional never outranks a working fallback; GPS course never enters the dial outside travel mode |
| C5 travel mode | done | `setTravelMode`/`travelFix`; `isTravelDirection` in the E1 gate → `reason:"travel"`; rotation in hand does not change it (GPS course only) |
| C6 GPS gates | done | `engine.js` `GPS_POLICY` + `acceptTravelFix` (age 3 s, speed ≥1.2, radius ≤25 m, sustained 3 fixes, ≥20 m baseline when course error unknown/0); unit group 6 |
| D1 smoothing + reset | done | `engine.js` `createSmoother` (wrap-safe vector state, dt clamp 1 ms–500 ms, >1 s gap reset) + `resetSmoothing` on every source change |
| D2 repaint throttle | done | `app.js` `frame()` repaints at the measured profile's interval (mobile default 33 ms); text updates stay at the existing 90 ms throttle |
| D3 measured device profile | done | `engine.js` `estimateDeviceProfile` — "unknown" until frame times are measured; jank → low-end 15 Hz / 66 ms / 60 s probe |
| D4 hidden-page teardown | done | `app.js` `visibilitychange` + `stopSession()` release orientation/motion/GPS listeners, timers, rAF loop, wake lock |
| E1 alignment gate | done | `engine.js` `alignmentConfirms` full truth table (unit group 5); "Aligned with Ekuphumuleni" renders only on `r.ok` |
| E2 budget-gated claims | done | sun-ahead claim = `reliable ∧ u>0 ∧ |dev|+u+0.5° ≤ 3°`; turn ± from genuine uncertainty only; no smallest-angle claim without `u` |
| E3 near-target | done | `nearTargetRadiusM = max(10, effectiveRadius)`; direction hidden inside it; status text says why |
| E4 location metadata | done | `makeFix` keeps source/accuracy/age/approximate; reduced-precision (≥25 m) marks `approximate` and blocks E1; error circle grows at 1.2 m/s when speed is unknown |
| F1 WMM2025 + uncertainty | done | `engine.js` `WMM` metadata + `wmmUncertaintyDeg`; unit group 7 vs NOAA test values |
| F2 expiry / bad clock | done | `wmmModelState` → `modelExpired`, declination `null`, chip `cmp_model`; `clockPlausible` (2024–2031) → `clock_warn` |
| F3 cache | done | `createWmmCache` keyed by UTC day / ≥100 m move / 100 m altitude |
| F4 polar blackout | done | `geo.js` `wmmField`: H<2000 nT → `declinationDeg: null` + `blackout`, never 0 |
| F5 coefficients documented + runtime metadata | done | header of `geo.js` (NOAA/NCEI + BGS WMM2025); diagnostics panel (`#diag`) prints model, epoch, degree/order, valid-from/valid-until, uncertainty — same numbers the mobile app uses |
| G1 quaternion gyro-rel | done | `rel.push` takes full quaternions only; anchor 60 s; >250 ms gap kills the anchor |
| G2 recalibration after gaps | done | smoother gap reset; rel anchor expiry; ladder stale/probe re-evaluation per tick |
| G3 session hygiene | done | `S2.gen` generation fence; `stopSession` awaited teardown; fresh session gets fresh timers/loops |
| G4 iOS gesture + Generic Sensor | done | compass start only from the Start button (a real click); `AbsoluteOrientationSensor` probed explicitly; denied → explicit `cmp_none`/permission state |
| G5 non-secure origin | done | `window.isSecureContext` chip `cmp_insecure`, sensors never start |
| G6 wake lock optional | done (was implemented) | feature-detected, rejection caught, released on hide/stop |
| G7 level bubble freshness | done | bubble drawn only from attitude with age ≤500 ms; stale hides the value |
| G8 sun guidance safety | done | gates: plausible clock, location, elevation ≥5° and <80°, safety line `#sun-safe` ("never look directly at the sun") |
| H1 chips | done | `cmp_wait`/`cmp_on · source · north reference`/`cmp_cal`/`cmp_accunk`/`cmp_interf`/`cmp_model`/`cmp_insecure`/`cmp_travel`/`cmp_none` |
| H2 no alignment UI without a reliable fix | done | E1 `reason:"locationUnreliable"`/`approximateLocation` refuse confirmation; needle/turn claims degrade to chips and warnings, never to "Aligned" |
| H3 translations | done (was implemented) | every new string goes through `T()`/`bi()` and exists in `zu`/`pt`/`ny`/`bem` (`lang.js`) |
| I1 payload/API untouched | done (was implemented) | `api/` unmodified this phase; `/api/centres` shape unchanged |
| **I2 additive routes (`GET /api/magnetic-model`, telemetry)** | **deferred** | No new API routes or telemetry: the scope rules freeze the API contract, and the mobile-parity need (model version/epoch/validity readable at runtime) is met client-side by the diagnostics panel instead of a new endpoint. |
| I3–I5 auth/CORS | done (was implemented) | untouched |

## 4. Manual browser matrix

Expected results below are from the implementation; the checks marked ⚙ are the ones
that genuinely need the named environment.

| Environment | Steps | Expected |
|---|---|---|
| **iOS Safari** (motion needs a gesture) ⚙ | Open over HTTPS, tap **Start compass**, accept the motion prompt | Dial follows `webkitCompassHeading` (chip `on · ios · magnetic north`, declination shown once in readouts). Denying the prompt → explicit "Compass: permission refused", sun guidance offered; no prompt is attempted outside a tap. Rel-rotation from DeviceMotion still works but cannot confirm alignment (chip `needs calibration`, `Aligned` refused with `relative`). |
| **Android Chrome** (Generic Sensor) ⚙ | Tap Start; wave in a figure-8 if prompted | `AbsoluteOrientationSensor`/`deviceorientationabsolute` path runs (chip `on · aos · magnetic north`); interference from metal flips the chip to `magnetic interference` and refuses `Aligned`; unknown accuracy keeps the chip `accuracy unknown` and never claims a bound. |
| **Desktop, no magnetometer** | Open in Chrome/Firefox on a laptop | After the 3 s acquire timeout the state is an explicit "Compass: not available"-style message (`cmp_none`/nocompass help + sun card if outdoors). Hub stays `—`. **No heading is ever invented.** |
| **Plain-HTTP origin** | Serve `public/` over `http://` and open it | Chip "Compass and location need HTTPS" (`cmp_insecure`), sensors and geolocation never start; everything else (guide, translations, towns) still works. |
| Honesty spot-checks (any device) | Enter travel mode; walk; stand at the destination area | Travel mode shows GPS course only and **cannot** show "Aligned" (`reason:"travel"`); inside `max(10, effectiveRadius)` m the direction is hidden and the reason is stated; "Aligned with Ekuphumuleni" appears only when `deviation + headingUncertainty + targetBearingUncertainty ≤ 3°`. |

## 5. What could not be verified

No physical iOS or Android hardware (and no downloadable Playwright browser) was
available in this environment, so the on-device matrix in §4 could not be executed
here — everything hardware-independent is covered by the unit suites (124 tests) and
the jsdom boot smoke, and the matrix above is the acceptance procedure for the
on-device pass.
