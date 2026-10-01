/* Browser test of every membership screen, with Supabase, PayFast and /api/* mocked.
   Run: npx playwright install chromium && npm run test:e2e
   (Where the browser download is blocked, tests/dom/dom-flows.mjs covers the same screens with jsdom.) */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..", "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
let FAILS = 0; const ok = (c, m) => { if (!c) FAILS++; console.log((c ? "PASS " : "FAIL ") + m); };
const serve = () => new Promise((res) => {
  const s = http.createServer((q, r) => {
    let p = q.url.split("?")[0];
    if (p === "/") p = "/index.html";
    if (!path.extname(p)) p += ".html";                       // Vercel cleanUrls: /reset → /reset.html
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(r);
  });
  s.listen(0, () => res({ url: `http://localhost:${s.address().port}`, close: () => s.close() }));
});
const { REGIONS, CENTRES } = (() => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "api", "_lib", "centres-data.js"), "utf8").replace(/export const /g, "const ");
  return new Function(src + ";return {REGIONS,CENTRES};")();
})();

const SESSION = { access_token: "good-token", refresh_token: "rt", expires_in: 3600, user: { email: "member@example.org" } };

(async () => {
  const srv = await serve(); const browser = await chromium.launch(); const errs = [];
  const state = {
    me: null, meFail: false, meQueue: [], checkoutPosted: null, cancelled: false,
    passwordBody: null, adminCalls: [], tempPassword: "Kx7@mQr2#pLt9",
    resetBody: null, resetRouted: null, lastLogin: null, centreBody: null,
  };
  async function newPage(init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, permissions: [] });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push(e.message));
    if (init) await page.addInitScript(init);
    await page.route(/cdnjs|googleapis|gstatic|openstreetmap/, (r) => r.abort());
    /* Supabase Auth */
    await page.route(/supabase\.co\/auth\/v1\/token/, (r) => {
      const b = JSON.parse(r.request().postData() || "{}");
      state.lastLogin = b;
      if (state.passwordBody && b.password === state.passwordBody.new_password) return r.fulfill({ json: SESSION });
      if (b.password === "good-password-1") return r.fulfill({ json: SESSION });
      return r.fulfill({ status: 400, json: { msg: "Invalid login credentials" } });
    });
    await page.route(/supabase\.co\/auth\/v1\/signup/, (r) => r.fulfill({ json: {} }));           // email confirmation ON → no session
    await page.route(/supabase\.co\/auth\/v1\/recover/, (r) => { state.recoverUrl = r.request().url(); return r.fulfill({ json: {} }); });
    await page.route(/supabase\.co\/auth\/v1\/resend/, (r) => r.fulfill({ json: {} }));
    await page.route(/supabase\.co\/auth\/v1\/user$/, (r) => { state.resetBody = JSON.parse(r.request().postData() || "{}"); return r.fulfill({ json: { id: "u1", email: "member@example.org" } }); });
    /* our API */
    await page.route("**/api/me", (r) => { if (state.meFail) return r.abort(); const m = state.meQueue.length ? state.meQueue.shift() : state.me; return r.fulfill({ json: m }); });
    await page.route("**/api/centres", (r) => r.fulfill({ json: { regions: REGIONS, centres: CENTRES }, headers: { etag: '"c1"' } }));
    await page.route("**/api/payfast/checkout", (r) => r.fulfill({ json: { action: srv.url + "/__payfast", fields: { merchant_id: "10000100", merchant_key: "k", amount: "100.00", item_name: "TSHK Compass monthly membership", subscription_type: "1", frequency: "3", recurring_amount: "100.00", signature: "abc" } } }));
    await page.route("**/__payfast", (r) => { state.checkoutPosted = r.request().postData(); return r.fulfill({ contentType: "text/html", body: "<h1>PayFast sandbox</h1>" }); });
    await page.route("**/api/payfast/cancel", (r) => { state.cancelled = true; return r.fulfill({ json: { ok: true } }); });
    await page.route("**/api/account/password", (r) => { state.passwordBody = JSON.parse(r.request().postData() || "{}"); return r.fulfill({ json: { ok: true } }); });
    await page.route("**/api/admin/users?*", (r) => {
      const q = new URL(r.request().url()).searchParams.get("q") || "";
      const users = [
        { user_id: "11111111-1111-4111-8111-111111111111", email: "alpha@example.org", status: "active", state: "active", created_at: "2026-01-01T00:00:00Z" },
        { user_id: "22222222-2222-4222-8222-222222222222", email: "beta@example.org", status: "trialing", state: "trial", created_at: "2026-02-01T00:00:00Z" },
      ].filter((u) => u.email.includes(q));
      return r.fulfill({ json: { users } });
    });
    await page.route("**/api/admin/users/reset-password", (r) => { state.adminCalls.push("reset"); return r.fulfill({ json: { email: "alpha@example.org", temporary_password: state.tempPassword } }); });
    await page.route("**/api/admin/users/delete", (r) => { state.adminCalls.push("delete"); return r.fulfill({ json: { ok: true, subscription_cancelled: true } }); });
    await page.route("**/api/admin/centres", (r) => { state.centreBody = JSON.parse(r.request().postData() || "{}"); return r.fulfill({ status: 201, json: { centre: { id: "new-1", r: state.centreBody.region, n: state.centreBody.name, a: state.centreBody.address, p: state.centreBody.phone, la: Number(state.centreBody.lat), lo: Number(state.centreBody.lng) } } }); });
    return page;
  }
  const vis = (page, id) => page.evaluate((i) => { let e = document.getElementById(i); if (!e) return false; for (; e; e = e.parentElement) { if (e.hidden || getComputedStyle(e).display === "none") return false; } return true; }, id);
  const txt = (page, id) => page.evaluate((i) => document.getElementById(i).textContent, id);
  const trial = { email: "member@example.org", status: "trialing", access: true, state: "trial", days_left: 7, access_until: new Date(Date.now() + 7 * 864e5).toISOString(), can_cancel: false, price: "100.00", is_admin: false, must_change_password: false, created_at: new Date().toISOString() };
  const ended = { ...trial, access: false, state: "trial_ended" };
  const active = { email: "member@example.org", status: "active", access: true, state: "active", access_until: new Date(Date.now() + 33 * 864e5).toISOString(), renews: true, can_cancel: true, price: "100.00", is_admin: false, must_change_password: false, created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
  const mustChange = { ...trial, must_change_password: true };
  const admin = { ...active, is_admin: true };
  const login = async (p) => { await p.fill("#m-login-email", "Member@Example.org"); await p.fill("#m-login-pass", "good-password-1"); await p.click("#m-login-btn"); await p.waitForTimeout(500); };

  /* 1. signed out: login / create account, and the app stays locked */
  state.me = trial;
  let p = await newPage(); await p.goto(srv.url + "/"); await p.waitForTimeout(400);
  ok(await vis(p, "member") && await vis(p, "m-login"), "signed-out visitor sees the login screen");
  ok(!(await vis(p, "m-signup")) && !(await vis(p, "m-forgot")), "only the login form shows at first");
  ok(await p.evaluate(() => window.TSHK_LOCKED === true), "the app is locked while signed out");
  ok(await p.evaluate(() => document.getElementById("acct").hidden), "no account chip before login");
  await p.evaluate(() => document.getElementById("tab-centres").click()); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelectorAll("#c-list .c-item").length) === 0, "no centres are loaded before login");
  await p.fill("#m-login-email", "not-an-email"); await p.click("#m-login-btn"); await p.waitForTimeout(150);
  ok((await txt(p, "m-msg")).includes("valid email"), "invalid email is caught");
  await p.fill("#m-login-email", "member@example.org"); await p.fill("#m-login-pass", "wrong"); await p.click("#m-login-btn"); await p.waitForTimeout(400);
  ok((await txt(p, "m-msg")).includes("did not match"), "wrong password is refused");
  await p.fill("#m-login-pass", "good-password-1"); await p.click("#m-login-pass"); // keep focus tidy

  /* 2. create account → confirm your email, resend */
  await p.click("#m-to-signup"); await p.waitForTimeout(150);
  ok(await vis(p, "m-signup"), "Create an account opens the sign-up form");
  await p.fill("#m-signup-email", "new@example.org"); await p.fill("#m-signup-pass", "short"); await p.click("#m-signup-btn"); await p.waitForTimeout(150);
  ok((await txt(p, "m-msg")).includes("8 characters"), "a short password is refused before sign-up");
  await p.fill("#m-signup-pass", "long-enough-1"); await p.click("#m-signup-btn"); await p.waitForTimeout(400);
  ok(await vis(p, "m-checkmail") && (await txt(p, "m-checkmail-note")).includes("new@example.org"), "after sign-up: check your email to confirm");
  await p.click("#m-resend"); await p.waitForTimeout(200);
  ok((await txt(p, "m-msg")).includes("Email sent again"), "the confirmation email can be resent");
  await p.click("#m-checkmail-back"); await p.waitForTimeout(150);

  /* 3. forgot password sends the recovery email to /reset */
  await p.click("#m-forgot-link"); await p.waitForTimeout(150);
  ok(await vis(p, "m-forgot"), "Forgot password opens the reset form");
  await p.fill("#m-forgot-email", "member@example.org"); await p.click("#m-forgot-btn"); await p.waitForTimeout(400);
  ok((await txt(p, "m-msg")).includes("on its way"), "the reset email is sent");
  ok(decodeURIComponent(state.recoverUrl || "").includes("/reset"), "recover asks Supabase to send people to /reset: " + state.recoverUrl);
  await p.click("#m-forgot-back"); await p.waitForTimeout(150);
  await p.click("#m-login-show"); await p.waitForTimeout(100);
  ok(await p.evaluate(() => document.getElementById("m-login-pass").type === "text"), "show/hide reveals the password");
  await p.click("#m-login-show"); await p.waitForTimeout(100);

  /* 4. log in → trial page (once) → the app opens and centres load */
  await p.fill("#m-login-email", "Member@Example.org"); await p.fill("#m-login-pass", "good-password-1"); await p.click("#m-login-btn"); await p.waitForTimeout(700);
  ok(await vis(p, "m-trial"), "first login shows the trial page");
  ok((await txt(p, "m-trial")).includes("Compass to Ekuphumuleni") && (await txt(p, "m-trial")).includes("Msamo positioning") && (await txt(p, "m-trial")).includes("Sun and shadow guidance") && (await txt(p, "m-trial")).includes("Centres directory") && (await txt(p, "m-trial")).includes("iciBemba"), "the trial page lists all five features");
  ok((await txt(p, "m-trial-line")).includes("7 day") && (await txt(p, "m-trial-line")).includes("R100"), "trial page shows the days left and the price");
  ok(await vis(p, "m-trial-start") && await vis(p, "m-trial-pay"), "trial page has Start and Pay now");
  await p.click("#m-trial-start"); await p.waitForTimeout(600);
  ok(!(await vis(p, "member")), "Start using the app closes the overlay");
  ok(await p.evaluate(() => window.TSHK_LOCKED === false), "the app unlocks only after login + access");
  ok((await txt(p, "acct-t")).startsWith("Trial · 7d"), "account chip shows trial days: " + await txt(p, "acct-t"));
  await p.evaluate(() => document.getElementById("tab-centres").click()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelectorAll("#c-list .c-item").length) === 88, "centres load after access is confirmed (88)");
  await p.evaluate(() => document.getElementById("acct").click()); await p.waitForTimeout(200);
  ok(await vis(p, "m-account") && (await txt(p, "m-state")).includes("7 days left"), "account screen shows the trial line");
  ok(!(await vis(p, "m-admin")), "no admin button for a normal member");
  await p.click("#m-features"); await p.waitForTimeout(200);
  ok(await vis(p, "m-trial"), "What's included is reachable again from Account");
  await p.selectOption("#m-lang", "pt"); await p.waitForTimeout(200);
  ok((await txt(p, "m-title")).includes("Bem-vindo") && (await txt(p, "m-trial-start")).includes("Começar"), "the trial screen follows the language selector (pt)");
  await p.click("#m-close"); await p.waitForTimeout(150);
  const saved = await p.evaluate(() => localStorage.getItem("tshk-session"));
  const seen = await p.evaluate(() => localStorage.getItem("tshk-trial-seen"));
  ok(!!seen, "the trial page is remembered for this account");
  await p.context().close();

  /* 5. a member who must change their password is stopped by the server, not just the UI */
  state.me = mustChange;
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)});`); await p.goto(srv.url + "/"); await p.waitForTimeout(600);
  ok(await vis(p, "m-mustchange"), "must_change_password shows the forced password screen");
  ok(!(await vis(p, "m-close")) && await vis(p, "m-signout"), "the forced screen cannot be closed, only signed out of");
  await p.fill("#m-newpass", "abc"); await p.click("#m-newpass-btn"); await p.waitForTimeout(200);
  ok((await txt(p, "m-msg")).includes("8 characters"), "a short new password is refused");
  state.me = { ...trial, created_at: active.created_at };
  await p.fill("#m-newpass", "chosen-by-me-9"); await p.click("#m-newpass-btn"); await p.waitForTimeout(800);
  ok(state.passwordBody && state.passwordBody.new_password === "chosen-by-me-9", "the new password is posted to /api/account/password");
  ok(state.lastLogin && state.lastLogin.password === "chosen-by-me-9", "the client signs in again with the new password");
  ok(!(await vis(p, "member")), "after the change the app opens");
  await p.context().close();

  /* 6. trial over → paywall → PayFast form posted */
  state.me = ended; state.checkoutPosted = null;
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)});localStorage.setItem("tshk-trial-seen", ${JSON.stringify(JSON.stringify("member@example.org"))});`);
  await p.goto(srv.url + "/"); await p.waitForTimeout(600);
  ok(await vis(p, "member") && await vis(p, "m-pay") && (await txt(p, "m-title")).includes("trial has ended"), "after the trial: paywall with subscribe button");
  ok(!(await vis(p, "m-close")), "paywall cannot be closed without access");
  await p.click("#m-subscribe"); await p.waitForTimeout(800);
  const posted = new URLSearchParams(state.checkoutPosted || "");
  ok(posted.get("recurring_amount") === "100.00" && posted.get("frequency") === "3" && posted.get("signature") === "abc", "browser posts the signed form to PayFast");
  await p.context().close();

  /* 7. back from PayFast: confirming until the ITN lands, then cancel */
  state.meQueue = [ended, ended]; state.me = active; state.cancelled = false;
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)});`); await p.goto(srv.url + "/?payment=success"); await p.waitForTimeout(900);
  ok((await txt(p, "m-title")).includes("Confirming"), "return from PayFast shows 'Confirming your payment…'");
  await p.waitForTimeout(6000);
  ok(!(await vis(p, "member")), "access granted once PayFast's notification is processed");
  ok(await p.evaluate(() => location.search === ""), "payment flag removed from the address bar");
  await p.evaluate(() => document.getElementById("acct").click()); await p.waitForTimeout(200);
  ok((await txt(p, "m-state")).includes("active") && await vis(p, "m-cancel") && !(await vis(p, "m-subscribe")), "account: active, cancel available, no double subscribe");
  state.me = { ...active, status: "cancelled", state: "cancelled", renews: false, can_cancel: false };
  await p.click("#m-cancel"); await p.waitForTimeout(150);
  ok((await txt(p, "m-cancel")).includes("Tap again") && !state.cancelled, "cancel needs a second tap");
  await p.click("#m-cancel"); await p.waitForTimeout(600);
  ok(state.cancelled && (await txt(p, "m-state")).includes("Access until"), "cancelled: access continues until the paid month ends");
  await p.context().close();

  /* 8. offline: cached access honoured; no cache → offline screen */
  state.meFail = true;
  const cached = JSON.stringify({ ...active, checked: Date.now() });
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)});localStorage.setItem("tshk-ent", ${JSON.stringify(cached)});`);
  await p.goto(srv.url + "/"); await p.waitForTimeout(600);
  ok(!(await vis(p, "member")), "offline member with a valid cached membership can still use the compass");
  await p.context().close();
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)});`); await p.goto(srv.url + "/"); await p.waitForTimeout(600);
  ok(await vis(p, "m-retry") && (await txt(p, "m-title")).includes("internet"), "offline with no cached membership → asks to connect");
  state.meFail = false; await p.click("#m-retry"); await p.waitForTimeout(500);
  ok(!(await vis(p, "member")), "Try again recovers when back online");
  await p.context().close();

  /* 9. store build hides PayFast inside the app */
  state.me = ended;
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)}); Object.defineProperty(window,"TSHK_CONFIG",{set(v){this._c={...v,STORE_BUILD:true}},get(){return this._c}});`);
  await p.goto(srv.url + "/"); await p.waitForTimeout(600);
  ok(await vis(p, "member") && !(await vis(p, "m-pay")) && (await txt(p, "m-sub")).includes("member account"), "store build: no PayFast button in the app");
  await p.context().close();

  /* 10. admin tools: add centre, auto-generate password, delete user */
  state.me = admin; state.adminCalls = [];
  p = await newPage(`localStorage.setItem("tshk-session", ${JSON.stringify(saved)});localStorage.setItem("tshk-ent", ${JSON.stringify(JSON.stringify({ ...admin, checked: Date.now() }))});`);
  await p.goto(srv.url + "/"); await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById("acct").click()); await p.waitForTimeout(200);
  ok(await vis(p, "m-admin"), "an admin sees the Admin tools button");
  await p.click("#m-admin"); await p.waitForTimeout(200);
  ok(await vis(p, "admin") && await vis(p, "a-centre"), "the admin panel opens on Add centre");
  await p.fill("#a-region", "Gauteng"); await p.fill("#a-name", "Randburg"); await p.fill("#a-address", "1 Main Road"); await p.fill("#a-phone", "+27 11 555 0100");
  await p.fill("#a-lat", "-26.09"); await p.fill("#a-lng", "28.00"); await p.click("#a-centre-btn"); await p.waitForTimeout(400);
  ok(state.centreBody && state.centreBody.name === "Randburg" && state.centreBody.phone === "+27 11 555 0100", "add centre posts the form");
  ok((await txt(p, "a-msg")).includes("Centre added"), "add centre reports success");
  await p.click("#a-tab-reset"); await p.waitForTimeout(150);
  await p.fill("#a-reset-q", "alpha"); await p.click("#a-reset-search"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelectorAll("#a-reset-list .a-row").length) === 1, "search shows the user");
  await p.evaluate(() => document.querySelector("#a-reset-list .a-row button").click()); await p.waitForTimeout(150);
  ok((await txt(p, "a-reset-warn")).includes("alpha@example.org"), "reset asks for confirmation first");
  await p.click("#a-reset-go"); await p.waitForTimeout(400);
  ok(state.adminCalls.includes("reset"), "the reset is sent to the server");
  ok(await vis(p, "a-temp") && (await txt(p, "a-temp-pw")) === state.tempPassword, "the temporary password is shown once");
  ok((await txt(p, "a-temp-note")).includes("Shown once"), "with the warning to pass it on securely");
  await p.click("#a-temp-close"); await p.waitForTimeout(150);
  ok(!(await vis(p, "a-temp")) && (await txt(p, "a-temp-pw")) === "", "closing clears the password from the DOM");
  await p.click("#a-tab-delete"); await p.waitForTimeout(150);
  await p.fill("#a-delete-q", "beta"); await p.click("#a-delete-search"); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector("#a-delete-list .a-row button").click()); await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.getElementById("a-delete-go").disabled), "delete needs the email typed first");
  await p.fill("#a-delete-type", "wrong@example.org"); await p.waitForTimeout(100);
  ok(await p.evaluate(() => document.getElementById("a-delete-go").disabled), "a wrong email does not enable the button");
  await p.fill("#a-delete-type", "beta@example.org"); await p.waitForTimeout(100);
  await p.click("#a-delete-go"); await p.waitForTimeout(400);
  ok(state.adminCalls.includes("delete") && (await txt(p, "a-msg")).includes("deleted"), "delete runs after the email is typed");
  await p.click("#a-close"); await p.waitForTimeout(150);
  ok(!(await vis(p, "admin")), "the admin panel closes");
  await p.context().close();

  /* 11. /reset sets a new password through PUT /auth/v1/user */
  p = await newPage(); await p.goto(srv.url + "/reset#access_token=recovery-token&refresh_token=rt2&type=recovery"); await p.waitForTimeout(400);
  ok(await vis(p, "form"), "/reset accepts the recovery link and shows the form");
  await p.fill("#pw", "short"); await p.click("#save"); await p.waitForTimeout(150);
  ok((await txt(p, "msg")).includes("8 characters"), "a short password is refused");
  await p.fill("#pw", "new-password-77"); await p.fill("#pw2", "different-88"); await p.click("#save"); await p.waitForTimeout(150);
  ok((await txt(p, "msg")).includes("not the same"), "the two passwords must match");
  await p.fill("#pw2", "new-password-77"); await p.click("#save"); await p.waitForTimeout(600);
  ok(state.resetBody && state.resetBody.password === "new-password-77", "the new password is sent to Supabase with the recovery token");
  ok((await txt(p, "msg")).includes("Password updated"), "the member is told the password is updated");
  await p.waitForTimeout(1400);
  ok(await p.evaluate(() => location.pathname === "/") && (await txt(p, "m-msg")).includes("Password updated"), "they land on the login screen with a note");
  await p.context().close();

  ok(errs.length === 0, "no page errors " + JSON.stringify(errs));
  await browser.close(); srv.close();
  if (FAILS) { console.log(FAILS + " check(s) failed"); process.exit(1); } else console.log("All checks passed");
})();
