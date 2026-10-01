// Browser test of the membership screens with the backend mocked.
// Run: npm install && npx playwright install chromium && npm run test:e2e
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..", "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
let FAILS = 0; const ok = (c, m) => { if (!c) FAILS++; console.log((c ? "PASS " : "FAIL ") + m); };
const serve = () => new Promise((res) => { const s = http.createServer((q, r) => { let p = q.url.split("?")[0]; if (p === "/") p = "/index.html"; const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });
  s.listen(0, () => res({ url: `http://localhost:${s.address().port}`, close: () => s.close() })); });
const { REGIONS, CENTRES } = (() => { const src = fs.readFileSync(path.join(__dirname, "..", "..", "api", "_lib", "centres-data.js"), "utf8").replace(/export const /g, "const "); return new Function(src + ";return {REGIONS,CENTRES};")(); })();

(async () => {
  const srv = await serve(); const browser = await chromium.launch(); const errs = [];
  const state = { me: null, meQueue: [], checkoutPosted: null, cancelled: false, meFail: false };
  async function newPage(init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push(e.message));
    if (init) await page.addInitScript(init);
    await page.route(/cdnjs|googleapis|gstatic|openstreetmap/, (r) => r.abort());
    await page.route(/supabase\.co\/auth\/v1\/otp/, (r) => r.fulfill({ json: {} }));
    await page.route(/supabase\.co\/auth\/v1\/verify/, (r) => { const b = JSON.parse(r.request().postData()); return b.token === "123456" ? r.fulfill({ json: { access_token: "good-token", refresh_token: "rt", expires_in: 3600, user: { email: b.email } } }) : r.fulfill({ status: 403, json: { msg: "Token has expired or is invalid" } }); });
    await page.route("**/api/me", (r) => { if (state.meFail) return r.abort(); const m = state.meQueue.length ? state.meQueue.shift() : state.me; return r.fulfill({ json: m }); });
    await page.route("**/api/centres", (r) => r.fulfill({ json: { regions: REGIONS, centres: CENTRES } }));
    await page.route("**/api/payfast/checkout", (r) => r.fulfill({ json: { action: srv.url + "/__payfast", fields: { merchant_id: "10000100", merchant_key: "k", amount: "100.00", item_name: "TSHK Compass monthly membership", subscription_type: "1", frequency: "3", recurring_amount: "100.00", signature: "abc" } } }));
    await page.route("**/__payfast", (r) => { state.checkoutPosted = r.request().postData(); return r.fulfill({ contentType: "text/html", body: "<h1>PayFast sandbox</h1>" }); });
    await page.route("**/api/payfast/cancel", (r) => { state.cancelled = true; return r.fulfill({ json: { ok: true } }); });
    return page;
  }
  const vis = (page, id) => page.evaluate((i) => { let e = document.getElementById(i); if (!e) return false; for (; e; e = e.parentElement) { if (e.hidden || getComputedStyle(e).display === "none") return false; } return true; }, id);
  const txt = (page, id) => page.evaluate((i) => document.getElementById(i).textContent, id);
  const trial = { email: "member@example.org", status: "trialing", access: true, state: "trial", days_left: 7, access_until: new Date(Date.now() + 7 * 864e5).toISOString(), can_cancel: false, price: "100.00" };
  const ended = { email: "member@example.org", status: "trialing", access: false, state: "trial_ended", can_cancel: false, price: "100.00" };
  const active = { email: "member@example.org", status: "active", access: true, state: "active", access_until: new Date(Date.now() + 33 * 864e5).toISOString(), renews: true, can_cancel: true, price: "100.00" };

  // 1. new visitor signs in and gets the trial
  state.me = trial;
  let p = await newPage(); await p.goto(srv.url + "/"); await p.waitForTimeout(400);
  ok(await vis(p, "member") && await vis(p, "m-auth-email"), "new visitor sees the sign-in screen (app is covered)");
  ok((await txt(p, "m-sub")).includes("7 days") && (await txt(p, "m-sub")).includes("R100"), "sign-in screen explains 7 days free then R100/month: " + await txt(p, "m-sub"));
  await p.fill("#m-email", "not-an-email"); await p.click("#m-send"); await p.waitForTimeout(100);
  ok((await txt(p, "m-msg")).includes("valid email"), "invalid email is caught");
  await p.fill("#m-email", "Member@Example.org"); await p.click("#m-send"); await p.waitForTimeout(300);
  ok(await vis(p, "m-auth-code") && (await txt(p, "m-sub")).includes("member@example.org"), "code screen shows the address");
  await p.fill("#m-code", "999999"); await p.click("#m-verify"); await p.waitForTimeout(300);
  ok((await txt(p, "m-msg")).includes("did not work"), "wrong code is refused");
  await p.fill("#m-code", "123456"); await p.click("#m-verify"); await p.waitForTimeout(800);
  ok(!(await vis(p, "member")), "correct code → trial access, overlay closes");
  ok((await txt(p, "acct-t")).startsWith("Trial · 7d"), "account chip shows trial days: " + await txt(p, "acct-t"));
  await p.evaluate(() => document.getElementById("tab-centres").click()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelectorAll("#c-list .c-item").length) === 88, "centres list loaded from the members API (88)");
  await p.evaluate(() => document.getElementById("acct").click()); await p.waitForTimeout(200);
  ok(await vis(p, "m-account") && (await txt(p, "m-state")).includes("7 days left") && await vis(p, "m-subscribe"), "account screen: trial line + subscribe button");
  await p.selectOption("#m-lang", "pt"); await p.waitForTimeout(200);
  ok((await txt(p, "m-title")).includes("Conta") && (await txt(p, "m-subscribe")).includes("Assinar"), "account screen follows the language selector (pt)");
  await p.click("#m-close"); await p.waitForTimeout(100); ok(!(await vis(p, "member")), "account screen closes");
  const saved = await p.evaluate(() => localStorage.getItem("tshk-session"));
  await p.context().close();

  // 2. trial over → paywall → PayFast form posted
  state.me = ended;
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)});`); await p.goto(srv.url + "/"); await p.waitForTimeout(600);
  ok(await vis(p, "member") && await vis(p, "m-pay") && (await txt(p, "m-title")).includes("trial has ended"), "after the trial: paywall with subscribe button");
  ok(!(await vis(p, "m-close")), "paywall cannot be closed without access");
  await p.click("#m-subscribe"); await p.waitForTimeout(800);
  const posted = new URLSearchParams(state.checkoutPosted || "");
  ok(posted.get("recurring_amount") === "100.00" && posted.get("frequency") === "3" && posted.get("signature") === "abc", "browser posts the signed form to PayFast");
  await p.context().close();

  // 3. back from PayFast: confirming until the ITN lands
  state.meQueue = [ended, ended]; state.me = active;
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)});`); await p.goto(srv.url + "/?payment=success"); await p.waitForTimeout(900);
  ok((await txt(p, "m-title")).includes("Confirming"), "return from PayFast shows 'Confirming your payment…'");
  await p.waitForTimeout(4000);
  ok(!(await vis(p, "member")), "access granted once PayFast's notification is processed");
  ok(await p.evaluate(() => location.search === ""), "payment flag removed from the address bar");
  await p.evaluate(() => document.getElementById("acct").click()); await p.waitForTimeout(200);
  ok((await txt(p, "m-state")).includes("active") && await vis(p, "m-cancel") && !(await vis(p, "m-subscribe")), "account: active, cancel available, no double subscribe");
  state.me = { ...active, status: "cancelled", state: "cancelled", renews: false, can_cancel: false };
  await p.click("#m-cancel"); await p.waitForTimeout(100);
  ok((await txt(p, "m-cancel")).includes("Tap again") && !state.cancelled, "cancel needs a second tap");
  await p.click("#m-cancel"); await p.waitForTimeout(500);
  ok(state.cancelled && (await txt(p, "m-state")).includes("Access until"), "cancelled: access continues until the paid month ends");
  await p.context().close();

  // 4. offline: cached access honoured; no cache → offline screen
  state.meFail = true;
  const cached = JSON.stringify({ ...active, checked: Date.now() });
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)});localStorage.setItem("tshk-ent", ${JSON.stringify(cached)});`); await p.goto(srv.url + "/"); await p.waitForTimeout(600);
  ok(!(await vis(p, "member")), "offline member with a valid cached membership can still pray (compass works)");
  await p.context().close();
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)});`); await p.goto(srv.url + "/"); await p.waitForTimeout(600);
  ok(await vis(p, "m-retry") && (await txt(p, "m-title")).includes("internet"), "offline with no cached membership → asks to connect");
  state.meFail = false; await p.click("#m-retry"); await p.waitForTimeout(500);
  ok(!(await vis(p, "member")), "Try again recovers when back online");
  await p.context().close();

  // 5. store build hides PayFast inside the app
  state.me = ended;
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)}); Object.defineProperty(window,"TSHK_CONFIG",{set(v){this._c={...v,STORE_BUILD:true}},get(){return this._c}});`);
  await p.goto(srv.url + "/"); await p.waitForTimeout(600);
  ok(await vis(p, "member") && !(await vis(p, "m-pay")) && (await txt(p, "m-sub")).includes("member account"), "store build: no PayFast button in the app");
  await p.context().close();

  ok(errs.length === 0, "no page errors " + JSON.stringify(errs));
  await browser.close(); srv.close();
  if (FAILS) { console.log(FAILS + " check(s) failed"); process.exit(1); } else console.log("All checks passed");
})();
