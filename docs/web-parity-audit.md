# TSHK Compass — web edition parity audit (Phase 1)

Audit date: 2026-10-02. Every row is backed by a quoted line from this repository as it exists
on branch `arena/01a0fe47-spiritual-campass-api` (the Arena session branch — see Step 0 note).
Nothing was edited in Phase 1 except this document.

## Step 0 — Orientation

### Repo / branch

- Repository: `https://github.com/ThaboTheDev/Spiritual-campass-api` (local checkout
  `/home/user/Spiritual-campass-api`), verified via `git remote -v`.
- The prompt asks for a new working branch `compass/web-parity`. This Arena session is pinned to
  `arena/01a0fe47-spiritual-campass-api`, branched from `main` at `6a891be`; all work stays there.
- The mobile repo (`ThaboTheDev/Spiritual-campass`) is **not** in this workspace. `compass-engine-reference.txt`
  is **not** in this workspace either. The line references in the prompt were re-verified against the
  real `public/app.js` and are accurate for the quoted spots.

### Actual layout

| Concern | Where it is |
| --- | --- |
| Compass engine | `public/app.js` (409 lines): state, heading maths (`facing`, `headingFromEuler`, `headingFromQuat`), smoothing (`SM`/`feedHeading`), source handling (`onOrientation`, `startAbsoluteSensor`, `startSensors`), rendering, sun card, centres map |
| Magnetic model + geo maths | `public/geo.js` (43 lines): `WMM2025` coefficient table, `wmmDeclination`, `decimalYear`, `initialBearing`, `haversineKm`, `norm`, `signedDiff`, `TOWNS` |
| HTML entry point | `public/index.html` (app + membership dialogs); `public/reset.html` (password reset); `public/dashboard.html` (standalone 3K/4K map page, no compass) |
| Membership/auth client | `public/member.js` (551 lines) |
| Public config | `public/config.js` (`window.TSHK_CONFIG`, `window.TSHK_LOCKED`) |
| Translations | `public/lang.js` — one file, `LANGS` object: `zu` (isiZulu), `pt` (Português), `ny` (Chichewa), `bem` (iciBemba), `en:{name:"English only"}` |
| API handlers | `api/me.js`, `api/centres.js`, `api/account/password.js`, `api/admin/{centres,users,users/delete,users/reset-password}.js`, `api/payfast/{checkout,notify,cancel}.js`, shared code in `api/_lib/*` |
| Static assets | `public/logo.png`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`, `public/manifest.webmanifest`, `public/sw.js` (service worker) |
| Tests | `tests/unit/*.test.js` (node:test, API), `tests/dom/dom-flows.mjs` (jsdom), `tests/e2e/paywall.test.cjs` (Playwright) |

Script load order in `public/index.html:555-559`:
`config.js → lang.js → geo.js → member.js → app.js`.

### Existing tooling (`package.json` scripts, verbatim)

```json
"scripts": {
  "test": "node --test tests/unit/*.test.js",
  "test:e2e": "node tests/e2e/paywall.test.cjs",
  "test:dom": "node tests/dom/dom-flows.mjs"
}
```

- Package manager: npm (`package-lock.json`, `.npmrc` sets `playwright_skip_browser_download=1`).
- Test runner: **`node --test`** (built-in). `jsdom` and `playwright` are devDependencies only
  (README: "No npm packages are needed at runtime").
- Linter / formatter: **none** (no eslint/prettier/biome/editorconfig anywhere in the tree).
- Build / deploy: **no build step**. README §3: "Framework preset: **Other**; no build command.
  `vercel.json` already sets `public/` as output." `vercel.json` also sets cache headers and a
  `Permissions-Policy: geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)` header.
- Baseline on this checkout (after `npm ci`): `npm test` → 57 tests, 51 pass, 0 fail, 6 skipped
  (PayFast PHP-reference cases, skipped when `php` is absent). `npm run test:dom` → "All checks passed".
  `npm run test:e2e` needs a Playwright Chromium download (not available offline; deferred to Phase 3 attempt).

### Script model

- `public/*.js` are **classic, unminified, unbundled global scripts**. They share top-level
  `const`/`function` bindings through the page global scope (e.g. `app.js` calls `wmmDeclination`
  from `geo.js`, `T()` from `lang.js`; `member.js` uses `bi`/`T` guarded by `typeof` checks).
- `api/*.js` and `tests/unit/*.js` are **ES modules** (`"type": "module"` in package.json).
- Nothing is minified or bundled at deploy time; Vercel serves `public/` as-is.
- Consequence for Phase 2 tests: pure engine functions must be extracted into files that Node can
  `import()` (ESM) while the browser still loads them before `app.js` (e.g. `public/engine*.js` as
  `type="module"` globals attached to `window`, or dual-load). `node:test` already matches repo style.

---

## A2 note — what each browser heading path actually returns

This is the "do not guess" table. (a) = documented platform behaviour, (b) = strong platform-API
inference, (c) = cannot be resolved without physical hardware (flagged for `docs/web-compass-validation.md`).

| Path (code) | Platform | Returns | North reference | Evidence class |
| --- | --- | --- | --- | --- |
| `webkitCompassHeading` (`app.js:206`, `useHeading(...,"ios",false)`) | iOS Safari `deviceorientation` | Compass heading in degrees | **magnetic** (Apple: `CMDeviceMotion.magneticHeading`, "relative to magnetic north") | (a) |
| `+screenAngle()` added to the above (`app.js:206`) | iOS Safari | Compensates for interface rotation, because `magneticHeading` is device-top-referenced, not interface-top-referenced | n/a | (b) — **may double-rotate on iOS versions that already compensate**; must be verified on hardware (c) |
| `deviceorientationabsolute` / `deviceorientation` with `absolute===true` (`app.js:209`, `"abs",false`) | Android Chrome | `alpha` = azimuth vs the geomagnetic field | **magnetic** (Chrome docs for `deviceorientationabsolute`) | (a) |
| `AbsoluteOrientationSensor` (`app.js:219`, `"aos",true`) | Android Chrome (Generic Sensor; no magnetometer → error on desktop) | Quaternion, `referenceFrame:"screen"` | On Android this is backed by `TYPE_ROTATION_VECTOR`, which fuses the magnetometer and is **magnetic-north** referenced (`getOrientation` azimuth is vs magnetic north) → **current `isTrue=true` tag is wrong** | (b) — a platform that implemented the W3C "Earth frame" as true north would differ; no shipping implementation known; verify on device (c) |
| relative `deviceorientation` + anchor (`app.js:210-212`, `"rel",true`) | all | Yaw since page start (drifts) | Reference is **whatever the anchor was**: sun anchor = true north; hand-compass anchor = **magnetic**. Code tags both `isTrue=true` | (a) semantics of the two anchor buttons (`app.js:264-265`) |
| `GeolocationPosition.coords.heading` (`app.js:84`, `"gps",true)`) | all | **Course over ground** (movement) | Geodetic (true), but it is travel direction, not device facing | (a) |

Bottom line for A2: the declination add itself happens exactly once, in `useHeading` (`app.js:173`),
and is skipped for samples tagged `isTrue` — but two source tags are wrong (`aos` and hand-anchored
`rel`), so the once-only property is applied to the *wrong* set of samples.

---

## Audit table

Legend: **implemented** = the behaviour exists as specified; **partial** = some of the behaviour
exists; **missing** = no evidence of the behaviour; **keep** in Gap = web is already fine or better
than the mobile target — Phase 2 must not regress it.

### A. North reference and phone axes

| ID | Requirement | Status | Evidence (file:line + quoted code) | Gap | Risk |
| --- | --- | --- | --- | --- | --- |
| A1 | Explicit north reference on every heading sample (`magnetic`/`trueNorth`/`relative`) | **partial** | `app.js:172` `function useHeading(value,source,isTrue){` — an `isTrue` boolean, not a reference enum; references are hard-coded per callback, e.g. `app.js:209` `if(e.absolute===true\|\|e.type==="deviceorientationabsolute"){useHeading(h,"abs",false);return;}` | No explicit `northReference` field on the sample; reference is inferred from which callback fired; `isTrue` cannot express `relative` (A2 note shows `rel` is tagged `true`) | Medium — wrong-tagged samples silently inherit the wrong declination handling |
| A2 | WMM declination added exactly once, only to magnetic samples | **partial** | Only add site: `app.js:173` `const h=isTrue?value:norm(value+S.declination);`. Correct tags: `app.js:206` `useHeading(norm(e.webkitCompassHeading+screenAngle()),"ios",false)` (magnetic); `app.js:209` `..."abs",false` (magnetic); `app.js:84` `useHeading(w.coords.heading,"gps",true)` (geodetic course). Wrong tags: `app.js:219` `useHeading(headingFromQuat(sensor.quaternion),"aos",true)` (Android rotation vector is magnetic — see A2 note) and `app.js:212` `if(S.relOffset!=null)useHeading(norm(h+S.relOffset),"rel",true);` (hand-compass anchor is magnetic, `app.js:265`) | Never applied twice (property holds) — but `aos` and hand-anchored `rel` need declination and never get it; sun-anchored `rel` is correctly true | **High** — declination in southern Africa is ≈ −25°…−30° (WMM2025); the aos path can be tens of degrees off while showing "Compass: on" |
| A3 | Sentinel rejection per sample (NaN/null/undefined, all-zero placeholder, negative/NaN `webkitCompassHeading`, negative `webkitCompassAccuracy`, negative/absent GPS course, non-monotonic/future/repeated timestamps) | **partial** | Implemented: `app.js:200` `if(e.alpha===0&&e.beta===0&&e.gamma===0)return;` (placeholder); `app.js:203` `if(typeof e.webkitCompassHeading==="number"&&!isNaN(e.webkitCompassHeading)&&e.webkitCompassHeading>=0){`; `app.js:207` `if(typeof e.alpha!=="number"\|\|isNaN(e.alpha))return;`. Not rejected: `app.js:204` `const acc=e.webkitCompassAccuracy,low=typeof acc==="number"&&(acc<0\|\|acc>25);` — a negative accuracy only toggles a hint, the sample is still used; `app.js:84` `...typeof w.coords.heading==="number"&&!isNaN(w.coords.heading)&&w.coords.speed>0.8` — negative course not rejected | No `timeStamp` handling at all (grep: `timeStamp`/`timestamp` appear nowhere in `app.js`); repeated/future/out-of-order events and fixes pass through | Medium — stale/duplicated sensor events look like live data; invalid accuracy samples drive the dial |
| A4 | Screen-rotation handling consistent on every path | **partial** | Euler path passes the angle: `app.js:153` `ca*sg+sa*sb*cg, sa*sg-ca*sb*cg, cb*cg, screenAngle()*D2R);`; quat path hardcodes zero: `app.js:155-159` `function headingFromQuat(q){ // device(screen) -> Earth...` … `2*(x*z+w*y), 2*(y*z-w*x), 1-2*(x*x+y*y), 0);` | The `0` is *correct* for `referenceFrame:"screen"` (`app.js:218`), which already includes interface rotation — but this is undocumented and unguarded; the iOS `+screenAngle()` (`app.js:206`) may double-rotate (see A2 note) | Medium — landscape use of the aos/iOS paths; a silent ±90/180° error if the constructor option ever changes |
| A5 | Documented pointing convention (top edge flat → back when upright; ENU; dial is not a viewfinder) | **implemented** | `app.js:134-135` `Heading = the direction the user faces: the top edge of the screen when the phone is flat, / blending smoothly into the back of the phone as it is raised upright, in portrait or landscape.`; implemented in `app.js:144-146` `const tE=st*xE+ct*yE,...  // top edge of the screen` / `const w=tU*tU;  // 0 when flat, 1 when upright` / `return norm(Math.atan2(tE-w*zE,tN-w*zN)*R2D);  // add the back of the phone as it rises`; ENU at `app.js:155` `// device(screen) -> Earth, Earth x east, y north, z up` | keep — the continuous `w=tU*tU` blend is a smooth version of the mobile rule; do not regress | Low |

### B. Confidence, calibration and interference

| ID | Requirement | Status | Evidence | Gap | Risk |
| --- | --- | --- | --- | --- | --- |
| B1 | Real quality model (`SensorReliability`, `HeadingConfidence`, `HeadingIssue`) | **missing** | `app.js:139` `S.relRaw=null;S.relOffset=null;S.aos=null;S.aosOn=false;S.sawRel=false;S.started=false;S.lowAcc=false;...` — quality is one boolean; `app.js:204-205` `const acc=e.webkitCompassAccuracy,low=typeof acc==="number"&&(acc<0\|\|acc>25); if(low!==S.lowAcc){S.lowAcc=low;$("calib").hidden=!low;}` | No reliability/confidence/issue enums anywhere | **High** — every UI claim rests on one boolean derived from one source's one field |
| B2 | Unknown accuracy stays uncertain; never promote `accuracyUnknown` | **missing** | `app.js:204` `...low=typeof acc==="number"&&(acc<0\|\|acc>25);` — when `webkitCompassAccuracy` is **absent** (`typeof acc!=="number"`), `low` is `false`: the hint is hidden and `app.js:175` `...setChipCmp("on","Compass: on · "+SRC[source],"cmp_on");` still claims on | Unknown accuracy is visually identical to good accuracy; "Compass: on" is shown regardless | **High** — the classic "unknown treated as good" failure |
| B3 | No fabricated angular bounds; only genuine OS error fields as degrees; calibration never converted to degrees | **implemented** | grep over `public/*.js`: no invented ±degree figures for headings; the only accuracy threshold is `app.js:204` `(acc<0\|\|acc>25)` used as a **boolean hint** (`$("calib").hidden=!low`), never rendered as an error; location chip uses the genuine field: `app.js:64` `GPS${S.loc.acc?\` ±${Math.round(S.loc.acc)} m\`:""}` | keep — Phase 2 must preserve this while adding B1: only `webkitCompassAccuracy` (and a real `GeolocationPosition.coords.accuracy`, course error) may become degrees | Low (today); High if Phase 2 invents bounds while porting B1 |
| B4 | Interference diagnostics (field strength vs WMM total intensity, model deviation, motion, timestamp gaps/order, tilt validity) + comment that constant bias can evade checks | **missing** | No `Magnetometer` use anywhere (grep `Magnetometer` in `public/*.js` → none; only `AbsoluteOrientationSensor` at `app.js:218` and `deviceorientation*`). `wmmDeclination` returns only `Math.atan2(Y,Xg)/d2r` (`geo.js:21`) — no X/Y/Z/H/F magnitudes exposed | Nothing compares measured field to model; no deviation/motion/gap diagnostics; no honesty comment | Medium — the app cannot detect the most common real-world error source (cars, rebar, phone cases) |

### C. Source ladder and failover

| ID | Requirement | Status | Evidence | Gap | Risk |
| --- | --- | --- | --- | --- | --- |
| C1 | Bounded, capability-based ladder (acquire 3 s, stale 2 s, quality 2 s, recovery hold 1 s, 30 s / 60 s probe) | **missing** | Ad-hoc priority: `app.js:202` `if(S.aosOn)return;  // Android orientation sensor already drives the dial`; `app.js:211` `if(S.src==="abs"\|\|S.src==="ios")return;`; only timing: `app.js:239-244` `setTimeout(()=>{ if(S.sensor==="on")return; if(S.sawRel){S.sensor="rel";...}else{S.sensor="none";...} },4000);` and `app.js:253-255` `setInterval(()=>{ if(S.sensor==="on"&&!document.hidden&&Date.now()-S.lastEvt>3000){S.sensor="paused";...} },1000);` | No 3 s/2 s/2 s/1 s/30 s constants; no demotion order; a live `aos` forever shadows everything (`app.js:202`) | **High** — a half-working source blocks better ones; timing behaviour diverges from mobile |
| C2 | Failures demote the source; distinguish `NotAllowedError` / `NotReadableError` / insecure context; surface each | **partial** | Permission denial is surfaced: `app.js:247` `...then(r=>{if(r==="granted")listen();else{S.sensor="denied";...setChipCmp("bad","Compass: permission refused","cmp_denied");...}})`. Everything else is swallowed: `app.js:220` `sensor.addEventListener("error",()=>{S.aosOn=false;});` and `app.js:224` `}catch(e){S.aos=null;S.aosOn=false;}`; the `requestPermission().catch` at `app.js:248` labels any rejection "permission refused" | `NotAllowedError` vs `NotReadableError` vs missing hardware vs non-secure origin all collapse into silence or the wrong message | Medium — users see "not available"/"permission refused" for the wrong cause and cannot act |
| C3 | Capability query must not hang the ladder | **partial** | `app.js:246-247` `if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){ DeviceOrientationEvent.requestPermission().then(r=>{...` — no timeout; if the promise never settles, `listen()` (line 245) never runs and the ladder is stuck on "waiting for sensor…" | Bound `requestPermission` (and any future capability probe) with a timeout that continues the ladder | Medium — rare hang = permanent "waiting" state |
| C4 | Provisional gyro may stay for calibration but must not trap the fallback; never silently switch to GPS | **missing** | Trap: `app.js:202` `if(S.aosOn)return;` blocks all lower sources while a (possibly uncalibrated) aos is on. Silent GPS switch: `app.js:84` `if((S.sensor==="none"\|\|S.sensor==="rel"&&S.relOffset==null)&&typeof w.coords.heading==="number"&&!isNaN(w.coords.heading)&&w.coords.speed>0.8)useHeading(w.coords.heading,"gps",true);` | Uncalibrated sources need a provisional flag + expiry; GPS course must not feed the dial at all (see C5) | **High** — heading source changes under the user without telling them |
| C5 | Travel direction is a separate, explicitly user-selected mode; rotation must not turn it; never confirms prayer/msamo/sun alignment | **missing** | Same line, `app.js:84`: GPS course is fed to the compass automatically when the sensor is absent/uncal. The alignment UI then treats it as a heading: `app.js:286` `if(S.loc&&live){` → `app.js:293-294` `setState("Facing Ekuphumuleni",T("facing")); ... $("turn-say").textContent="Aligned with Ekuphumuleni"` | No travel-direction mode; no exclusion of travel course from alignment | **High** — a phone rotated in the hand can produce a false "Aligned with Ekuphumuleni" from walking direction |
| C6 | GPS acceptance gates: fix ≤ 3 s old, speed ≥ 1.2 m/s, radius ≤ 25 m, sustained moving fixes; real course error; long straight baseline when course error unknown; reject repeated/out-of-order fixes | **partial** | Current gates: `app.js:83` `if(w.coords.accuracy<80&&S.loc&&S.loc.source==="gps"){...` (80 m, not 25 m); `app.js:84` `...w.coords.speed>0.8` (0.8, not 1.2); `app.js:85` `},{enableHighAccuracy:true,maximumAge:5000});` (5 s, not 3 s) and `app.js:89` `...maximumAge:60000}` (60 s for the initial fix) | Wrong thresholds; no sustained-sequence requirement; `w.coords.course`/`heading` error (`coords.headingAccuracy` where exposed) unused; no timestamp ordering checks | Medium — standing still with drifting course, or a stale fix, can move the dial/origin |

### D. Smoothing, rendering, device profiles

| ID | Requirement | Status | Evidence | Gap | Risk |
| --- | --- | --- | --- | --- | --- |
| D1 | `dt` exponential smoothing, wrap-safe vector state; **reset** on source/north-ref/quality change and after a gap > 1 s | **partial** | Core verified: `app.js:162` `const SM={x:0,y:1,init:false,t:0};`; `app.js:166` `const dt=Math.min(.5,Math.max(.001,(now-SM.t)/1000));`; `app.js:168` `const tau=gap>45?.06:.14;  // follow big turns quickly, calm small jitter`; `app.js:169` `const k=1-Math.exp(-dt/tau);SM.x+=k*(cx-SM.x);SM.y+=k*(cy-SM.y);`. Resets today: `app.js:258` `SM.init=false;  // start fresh, no spinning catch-up` (visibility) and `app.js:264-265` (calibration taps) | No reset on source change (`app.js:175` switches `S.src` silently), north-reference change, quality transition, or sample gap > 1 s (`resetAfter`) | Medium — a resumed stream animates a long catch-up arc; cross-source handover blends two references |
| D2 | Rendering capped (profile-driven repaint, mobile default 33 ms) and decoupled; stop the loop when idle | **partial** | Text throttle only: `app.js:185` `if(rd!==S.lastRound&&now-S.lastText>90){S.lastRound=rd;S.lastText=now;render();}`. Everything else is uncapped: `app.js:187-188` `drawBubble(); requestAnimationFrame(frame);` — `frame` re-queues itself unconditionally and `drawNeedle`/`drawBubble` run every animation frame (lines 181-187) | No repaint cap; the rAF loop never stops once started (`loopOn` at `app.js:178-179` is set once, never cleared) | Low-Medium — battery/CPU on low-end phones; contradicts the mobile profile behaviour |
| D3 | Sampling rate follows a measured device profile (low-end profile; never claim an unmeasured class) | **missing** | `app.js:218` `const sensor=new AbsoluteOrientationSensor({frequency:30,referenceFrame:"screen"});` — 30 Hz hard-coded; grep `deviceMemory\|hardwareConcurrency` → none anywhere | No device-class estimate, no measured frame-time check, no low-end profile | Medium — low-end devices (much of the target audience) are driven at the same rate as flagships |
| D4 | No sensors, timers or location watches running while the page is hidden | **missing** | `app.js:256-257` `document.addEventListener("visibilitychange",()=>{ if(document.hidden)return;` — on hide **nothing** is stopped; device-orientation listeners (`app.js:235-236`), `S.aos` (started `app.js:223`), the GPS watch (`app.js:82` `if(!S.gpsWatch)S.gpsWatch=navigator.geolocation.watchPosition(...)` never cleared), `setInterval(renderSun,30000)` (`app.js:128`) and the 1 s poll (`app.js:253`) all keep running; wake lock is not released on hide | Add hidden-page teardown (sensors, watch, intervals, rAF, wake lock) and resume-restore | **High** — battery drain and the hard rule "never leave a sensor running in a hidden page" |

### E. Alignment claims — the false ±3° problem

| ID | Requirement | Status | Evidence | Gap | Risk |
| --- | --- | --- | --- | --- | --- |
| E1 | `AlignmentPolicy.confirms` full gate (uncertainty budget `dev + (hUnc + tUnc) ≤ 3°`, confidence reliable, ages, settling ≥ 1 s, location reliability, near-target, not travel/relative/paused/stale) | **missing** | `app.js:287-288` `const delta=signedDiff(S.bearing,S.heading);const abs=Math.abs(delta); const aligned=S.aligned?abs<=5:abs<=3;  // hysteresis: no flicker at the edge` — a bare angle compare; nothing else of the gate exists (no uncertainties, no `stableSince`, no ages) | Entire policy missing | **High** — "Aligned with Ekuphumuleni" (`app.js:294`) is a prayer-direction claim made with unbounded error |
| E2 | Every hardcoded small-angle claim gated on the uncertainty budget | **missing** | Sun card: `app.js:123` `$("sun-turn").textContent=abs<=3?bi("Face the sun: Ekuphumuleni is straight ahead.",T("sun_ahead")):...`; alignment: `app.js:288` `abs<=5:abs<=3`; help text: `index.html:344` `Aligned means within 3° of the true bearing to Ekuphumuleni...` with translations `lang.js:11/40/69/98` `note_aligned:"...3°..."` | All three constants must move behind the E1 budget gate; strings that promise "3°" need rewording or gating | **High** — copy actively promises precision the device cannot demonstrate |
| E3 | Near destination: direction undefined within `max(10, effectiveRadius)` m; hide direction and alignment prompts | **missing** | No near-target branch anywhere in `render()` (`app.js:281-310`); the pointer is drawn whenever `S.loc` exists: `app.js:193` `if(S.loc){const d2=signedDiff(norm(S.bearing-S.heading),S.dispPtr);...}`; distance is always shown (`app.js:67` `$("ro-dist").innerHTML=...`) | Add the near-target radius gate (fix radius or 10 m, whichever larger) for pointer/prompt/claims | Medium — bearing noise inside ~10 m swings wildly while the UI still commands "Turn X°" |
| E4 | Location metadata retained and used; approximate origins marked; error circle grows between fixes; unknown motion ≠ stationary | **partial** | Retained: `app.js:52-53` `function setLocation(lat,lon,name,source,acc){ S.loc={lat,lon,name,source,acc};`; chip distinguishes origin kinds: `app.js:64` `const src=S.loc.source==="gps"?...:S.loc.source==="town"?bi("town",T("loc_town")):"typed";`. But town/typed/centre-derived origins feed the same bearing/alignment path as GPS (`app.js:54-55`, `app.js:286`); no fix timestamp/speed/course-error is kept; watch accepts coarse fixes (`app.js:83` `accuracy<80`) and `maximumAge:5000`/`60000` (`app.js:85,89`); no error-circle growth model | Mark approximate origins in state and gate E1 on them; keep timestamp/accuracy/speed/course error; grow uncertainty with time/motion | Medium — a typed town centroid silently produces "Aligned" claims as if surveyed |

### F. Magnetic model (WMM)

| ID | Requirement | Status | Evidence | Gap | Risk |
| --- | --- | --- | --- | --- | --- |
| F1 | WMM2025, degree/order 12, epoch 2025.0, valid 2025-01-01 → before 2030-01-01 UTC; uncertainty `sqrt(0.26² + (5417/H)²)` | **partial** | `geo.js:1` `/* ---------- World Magnetic Model 2025 (NOAA/NCEI & BGS), epoch 2025.0 ---------- */`; `geo.js:2` `const WMM2025=[[1,0,-29351.8,0.0,12.0,0.0],[1,1,-1410.8,4545.4,9.7,-21.5],...` (full 12×12 + SV); `geo.js:4` `const d2r=Math.PI/180,N=12,...`; `geo.js:8` `const dt=decYear-2025.0;` — coefficients + secular variation applied | No validity-window constant or check; no uncertainty formula (grep `5417\|0.26` → none); `wmmDeclination` returns only the angle (`geo.js:21` `return Math.atan2(Y,Xg)/d2r;`) — X/Y/Z/H/F not exposed | Medium — the model silently extrapolates past 2030 and has no error figure for the E1 budget |
| F2 | Model expiry or wrong device clock warns, never extrapolates silently; `modelExpired` distinct issue | **missing** | `app.js:56` `S.declination=wmmDeclination(lat,lon,0,decimalYear(new Date()));` — `decimalYear` (`geo.js:23`) extrapolates from any clock with no bounds; no expiry/clock sanity code exists (grep `expir\|valid` → none in engine files) | Add validity window + clock plausibility checks and a `modelExpired` issue surfaced in the chip/diagnostics | Medium — a phone clock set to 2032 silently produces extrapolated declination |
| F3 | Cache the harmonic evaluation by UTC day / ≥100 m move / ≥100 m altitude change | **partial** | Called only from `setLocation` (`app.js:56`), so it is already out of the per-frame path — but no cache: each location change re-evaluates; altitude is hard-coded `0` (`wmmDeclination(lat,lon,0,...)`); the value is frozen at set time and never refreshed for the UTC day | Add a keyed cache (day/position/altitude) and re-evaluate on day rollover | Low-Medium |
| F4 | Polar blackout zone → declination unavailable, never zero | **missing** | `geo.js:20-21` `Y=st>1e-9?Y/st:Y;const psi=phis-phi;... return Math.atan2(Y,Xg)/d2r;` — at the pole the code still returns a number instead of "unavailable"; no blackout-zone concept | Return a distinct `unavailable` result inside the polar blackout; never fall back to 0 | Low (audience geography) but the honesty rule is absolute |
| F5 | Where coefficients live, documented; version/epoch/valid-until readable at runtime and shown in diagnostics | **partial** | Location decision: **bundled JS** — `geo.js:2` `const WMM2025=[[1,0,-29351.8,...` loaded by `index.html:557` `<script src="geo.js"></script>` (offline-friendly via `sw.js` CORE list). But the epoch is only a comment (`geo.js:1`), not runtime-readable; no diagnostics UI exists at all | Export `{model:"WMM2025", epoch:2025.0, validFrom, validUntil}` and show it in a diagnostics block; keep coefficients bundled (documented decision) | Low-Medium — web/mobile agreement cannot be checked at runtime |

### G. Calibration and lifecycle

| ID | Requirement | Status | Evidence | Gap | Risk |
| --- | --- | --- | --- | --- | --- |
| G1 | Full 3D quaternion gyro-relative integration; anchor expiry 60 s; >250 ms integration gap invalidates; anchor per-session, never persisted; anchor reference = true (sun) / magnetic (hand) | **missing** | Current relative path is flat Euler yaw: `app.js:210` `S.sawRel=true;S.relRaw=h;  // relative only: usable once calibrated` with a constant offset `app.js:212` `if(S.relOffset!=null)useHeading(norm(h+S.relOffset),"rel",true);`. No expiry/gap logic anywhere (grep `validFor\|maxStep` → none). Not persisted (keep: `app.js:57` saves only `{lat,lon,name,source}`). Anchor reference always tagged true: `app.js:265` `S.relOffset=norm(-S.relRaw);SM.init=false;useHeading(0,"rel",true);` (hand-compass anchor → should be magnetic) | Quaternion integration, 60 s expiry, 250 ms gap invalidation, anchor-type reference | **High** — drift accumulates invisibly; hand-compass calibration is off by declination (links to A2) |
| G2 | Recalibration after gaps, restarts and anchor age — not just page load | **missing** | `app.js:256-258` `document.addEventListener("visibilitychange",()=>{ if(document.hidden)return; SM.init=false;  // start fresh, no spinning catch-up` — resets the smoother only; `S.relOffset` survives every gap/restart untouched (it is only written at `app.js:264-265`) | Invalidate `relOffset`/anchor on resume, gap, restart; re-request user calibration | **High** — the same class of bug the prompt calls out explicitly |
| G3 | Session hygiene: generation counters; teardown awaited and bounded; fresh session on resume | **missing** | No generation counter anywhere; listeners are never removed (`app.js:235-236` `window.addEventListener("deviceorientationabsolute",onOrientation,true); window.addEventListener("deviceorientation",onOrientation,true);`); `app.js:233` `if(S.started)return;S.started=true;` makes start one-shot with no fresh session on resume; intervals (`app.js:128`, `app.js:253`) are never cleared; `S.aos.stop()` is never called | Add session generations + bounded teardown + resume restart | Medium — stale callbacks can write into new state after resume/re-lock |
| G4 | iOS permission from a real user gesture; denied → explicit state; Generic Sensor feature-detect + `error` handling; secure context | **partial** | Gesture: `app.js:266-268` `$("btn-start").addEventListener("click",()=>{ ... startSensors();` → `app.js:246-247` `DeviceOrientationEvent.requestPermission().then(...)`. Denied → `app.js:247` `...setChipCmp("bad","Compass: permission refused","cmp_denied");`. Feature-detect: `app.js:215` `if(!("AbsoluteOrientationSensor" in window))return;`. But the sensor `error` event is swallowed (`app.js:220` `sensor.addEventListener("error",()=>{S.aosOn=false;});`), the generic `catch` is silent (`app.js:224`), and there is no `isSecureContext` check (grep → none) | Handle `error` with cause; distinguish secure-context failure (G5); don't conflate rejection causes in the `catch` | Medium |
| G5 | Non-secure origin explained in the UI (motion + geolocation will not work) | **missing** | grep `isSecureContext\|location.protocol` → nothing; on plain HTTP the start flow ends at `app.js:242` `else{S.sensor="none";setChipCmp("bad","Compass: not available","cmp_none");...}` with no mention of HTTP | Detect `!window.isSecureContext` and say so in the chip/nocompass panel | Medium — support burden, and "not available" is untrue (the device may have the sensor) |
| G6 | Wake lock and orientation lock optional; feature-detect, catch rejection, degrade gracefully; compass never depends on either | **implemented** | `app.js:262-263` `let wakeLock=null; async function keepAwake(){try{if("wakeLock" in navigator&&!document.hidden&&(!wakeLock\|\|wakeLock.released))wakeLock=await navigator.wakeLock.request("screen");}catch(e){}}` — feature-detected, rejection caught, and no code path fails without it. `screen.orientation.lock` is never called (so nothing can depend on it) | keep (one Phase 2 improvement belongs to D4: release the lock when the page hides) | Low |
| G7 | Level bubble only from **fresh** acceleration; missing/stale hides it (no invented level phone) | **missing** | Initial state fakes flatness: `app.js:5` `const S={loc:null,heading:null,...,beta:0,gamma:0,lastEvt:0,...}`; `app.js:195-197` `function drawBubble(){ const gx=Math.max(-1,Math.min(1,S.gamma/30)),gy=...; $("bubble").style.transform=...}` draws from those values even with no event ever; `app.js:308-309` `const flat=live&&Math.abs(S.beta)<8&&Math.abs(S.gamma)<8;... $("level-t").textContent=!live?"Level":flat?...` — with no live data the text literally says "Level"; beta/gamma come from orientation events (`app.js:201`) with no freshness tracking (no `DeviceMotionEvent`) | Track acceleration (or tilt) freshness; hide bubble + neutral text when stale/missing | Medium — users trust a fake "Level" while aligning the msamo |
| G8 | Solar guidance safety: clock + location, elevation 5°–<80°, flat and still; point top edge **opposite** the shadow; never look at the sun; below horizon → stop | **partial** | Night stop exists: `app.js:121` `if(sp.alt<-1){$("sun-turn").textContent=bi("The sun is below the horizon now...`; `...$("btn-suncal").hidden=true;return;}`. But the calibration button ignores elevation and posture: `app.js:126` `$("btn-suncal").hidden=!(S.sensor==="rel");`; the shadow copy invites looking at the sun indirectly and does not state the top-edge rule: `app.js:125` `A stick's shadow points to ${...}° ... Stand facing along the shadow, then turn ${...}°...`; no "never look directly at the sun" string exists (grep `look directly` → none); no clock check | Add 5°–80° gate + flat/still gate for sun calibration; reword to "point the top edge opposite the shadow"; add the never-look warning; validate clock | **High** (safety copy) — eye-safety text missing, and calibration is offered at sun elevations where the method is invalid |

### H. UI honesty and translations

| ID | Requirement | Status | Evidence | Gap | Risk |
| --- | --- | --- | --- | --- | --- |
| H1 | Compass chip distinguishes waiting / on (+ source **and** north reference) / calibration / paused / permission refused / not available / interference / model expired / accuracy unknown; "on" forbidden when accuracy unknown | **partial** | Existing states: `app.js:27` `bi("Compass: off",T("cmp_off"))`; `app.js:238` `setChipCmp("warn","Compass: waiting for sensor…","cmp_wait")`; `app.js:175` `setChipCmp("on","Compass: on · "+SRC[source],"cmp_on")` (source label only — `app.js:138` `const SRC={ios:"iPhone compass",aos:"Android compass",abs:"compass",rel:"turn sensor + calibration",gps:"GPS (walking)"};` — no north reference); `app.js:241-242` calibrate/not-available; `app.js:247` permission refused; `app.js:254` `setChipCmp("warn","Compass: paused · move the phone","cmp_paused")`. Missing states: accuracy unknown, magnetic interference, model expired; and "on" prints even when accuracy is unknown (`app.js:175` unconditional) | Add the missing states + north reference + the B2 rule | Medium — the chip is the app's honesty surface |
| H2 | No target needle, saved mark or alignment prompt without a reliable fix | **missing** | `app.js:193` `if(S.loc){const d2=signedDiff(norm(S.bearing-S.heading),S.dispPtr);...}` — any `S.loc` (including `"town"`/`"typed"` set at `app.js:318-319`) draws the pointer; `app.js:286` `if(S.loc&&live){` gates prompts on existence only | Gate needle/msamo prompts/alignment on fix reliability (links to E1/E4) | **High** — false confirmation from approximate origins |
| H3 | Every new/changed string via `T()`/`bi()`, added to every language file; list any language on English fallback | **implemented** | Mechanism: `app.js:9-10` `function T(key,vars){let t=(LANGS[LANG]||{})[key]||"";...} function bi(en,second){return second?en+" · "+second:en;}` — English always shows, translation beside it. Coverage verified by script: `lang.js` `zu` (line 3), `pt` (32), `ny` (61), `bem` (90) each carry an **identical 181-key set** (0 missing/extra); `lang.js:119` `en:{name:"English only"}` is deliberate (English lives inline in `bi()` first args). No language is on hidden English fallback | keep — Phase 2 must add every new key to all 4 dictionaries and use `bi()` English-first; `en` intentionally has no key table | Low |

### I. API backend (`/api/*`)

| ID | Requirement | Status | Evidence | Gap | Risk |
| --- | --- | --- | --- | --- | --- |
| I1 | Nothing renamed; `/api/centres` payload carries what accuracy work needs (lat, lon, precision/altitude); additive only | **partial** | Names/shape are stable: `api/_lib/centre-validation.js:33-37` `export function centreOut(row) { return { id: row.id, r: row.region, n: row.name, a: row.address \|\| "", p: row.phone \|\| "", la: Number(row.lat), lo: Number(row.lng) }; }`; served at `api/centres.js:23` `const body = { regions: regions.map((r) => r.name), centres };`. Schema has no altitude/precision: `supabase/schema.sql:58-59` `lat double precision not null check (lat between -90 and 90), lng double precision not null check (lng between -180 and 180)` | Optional additive fields only if Phase 2 needs them (e.g. `alt`, `radius`); **never** rename `id/r/n/a/p/la/lo` | Medium if touched carelessly — the mobile app is built against these keys |
| I2 | New routes strictly additive (`GET /api/magnetic-model`, telemetry) — **ask first** | **not applicable (pending decision)** | Route inventory (README §folder map + `api/` tree): `me, centres, account/password, admin/*, payfast/*` only — no `magnetic-model`, no telemetry route exists | F5 can be satisfied client-side (bundled coefficients + runtime-readable metadata) without any new route. **Asked before adding anything** | Low |
| I3 | Server-side authorisation unchanged; `is_admin` re-checked every admin call; never trusts a client flag | **implemented** | `api/_lib/auth.js:22-27` `/* Admin routes: requireMember first ..., then the is_admin flag from the database... */ export async function requireAdmin(...) { ... if (!ctx.member \|\| ctx.member.is_admin !== true) { send(res, 403, { error: "admin_required" }); return null; } }`; `api/me.js:48` `/* flags are read from the members row, never from the token or user_metadata */` | keep | Low |
| I4 | 403 `password_change_required` never signs out (only 401); network failure changes nothing; never log tokens | **implemented** | Client: `member.js:184` `if (r.status === 401) { signOutLocal(); updateChip(); return show("login"); }` and `member.js:185` `if (!r.ok) return offline();` — a 403 falls through to the entitlement/mustchange flow (`member.js:187` `if (ent.must_change_password) {... return show("mustchange"); }`); `member.js:317` `if (r.status === 403) { await check(); return; }`; network failure: `member.js:183` `try { r = await api("/api/me"); } catch (e) { return offline(); }` with cached access honoured (`member.js:192-195`). Server: `api/_lib/auth.js:14-15` `if (member.must_change_password === true && !allowPasswordChange) { send(res, 403, { error: "password_change_required" }); return null; }`. Token logging: grep `console.*token` in `api/` → none; logs print status codes only (e.g. `api/payfast/notify.js:12` `console.log(\`[payfast] ITN → ${result.status} ${result.reason}\`)`) | keep | Low |
| I5 | CORS / same-origin assumptions still hold | **implemented** | API calls are same-origin relative fetches (`member.js:48` `const go = () => fetch(path, {...})`); no handler sets CORS headers (`api/_lib/http.js:86-92` `send()` sets only Content-Type/Cache-Control); Supabase Auth is called cross-origin by design with `apikey` (`member.js:31`, `api/_lib/supabase.js:7`); `vercel.json` serves `public/` and `/api/*` from one origin with `Cache-Control: no-store` on `/api/(.*)` | keep — Phase 2 adds no cross-origin surface | Low |

---

## Smoothing-constant decision (recorded deliberately)

The prompt flags two "mobile target" numbers versus the web excerpt. Verified against this repo:

- **`tau`**: mobile "140 ms, or 60 ms when the jump exceeds 45°" and web `app.js:168`
  `const tau=gap>45?.06:.14;` are **numerically identical** (0.14 s = 140 ms, 0.06 s = 60 ms,
  same 45° switch). **Decision: keep the web values** — they already match mobile; no drift.
- **dt clamp**: keep the web `Math.min(.5,Math.max(.001,...))` (`app.js:166`). Mobile's
  `maxStepSeconds = 0.25` belongs to the gyro integrator (G1), a different subsystem; the mobile
  smoother's `resetAfter` is the1 s gap reset, which web lacks.
- **Gap reset**: **adopt the mobile rule** — reset the filter after a sample gap > 1 s
  (this is D1's missing `resetAfter`).
- **Repaint throttle**: **adopt the mobile profile-driven 33 ms default** for needle/bubble
  repaints (D2/D3), while keeping the existing 90 ms text throttle (`app.js:185`) for DOM text
  writes (text is the expensive part; two different cadences is intentional).

## Summary counts

| Status | Count | Rows |
| --- | --- | --- |
| implemented (keep as-is) | 7 | A5, B3, G6, H3, I3, I4, I5 |
| partial | 17 | A1, A2, A3, A4, C2, C3, C6, D1, D2, E4, F1, F3, F5, G4, G8, H1, I1 |
| missing | 19 | B1, B2, B4, C1, C4, C5, D3, D4, E1, E2, E3, F2, F4, G1, G2, G3, G5, G7, H2 |
| unknown | 0 | — |
| not applicable (pending maintainer decision) | 1 | I2 |
| **total** | **44** | |

Where the web edition is already **equal or better** than the mobile target (do not regress):
B3 (no fabricated angular bounds at all today), A5 (smooth continuous top-edge→back blend),
G6 (wake lock is optional and silently degrades), H3 (translation coverage is complete and
uniform — 181 keys × 4 languages, English-first `bi()` by design), I3/I4/I5 (auth, error
semantics and same-origin behaviour match the hardening rules), plus web-only niceties not in
scope: in-app-browser detection (`app.js:272-277`), ETag caching on `/api/centres`, offline
entitlement grant (`member.js:192-195`).

## The three riskiest gaps (in my words)

1. **The app can say "Aligned with Ekuphumuleni" while pointing tens of degrees off (A2 + C5 + E1).**
   The Generic-Sensor path is tagged true-north although the underlying Android rotation vector is
   magnetic-referenced (so declination — roughly −25° to −30° in southern Africa — is never
   applied on that path), GPS walking course silently masquerades as a compass heading, and the
   alignment claim is a bare `abs<=3` compare with no uncertainty budget, no settling and no fix
   quality. This is a direct honesty failure on the app's core promise.
2. **Unknown quality is treated as good (B1 + B2 + H1).** Quality is one boolean derived from one
   optional field; when the field is absent the app behaves as if everything is fine and prints
   "Compass: on". Every downstream claim (sun "straight ahead", msamo "aligned", the chip) inherits
   false confidence, and there is no interference detection at all to catch real-world magnetic
   error.
3. **Sensors, timers and watches never stop (D4 + G3).** Hiding the page stops nothing — the
   orientation listeners, the Generic-Sensor instance, the GPS watch, two intervals, the rAF loop
   and the wake lock all keep running, with no session generations to fence stale callbacks. This
   violates the hard lifecycle rule outright and drains batteries on the low-end devices this app
   targets (which also have no device profile — D3).

## Open questions for the maintainer (asked before Phase 2, per the brief)

1. Which rows to implement (all / a chosen subset).
2. I2: add `GET /api/magnetic-model` (and/or a telemetry route), or keep F5 fully client-side
   (bundled coefficients + runtime-readable metadata in a diagnostics panel) with **no** new route?
