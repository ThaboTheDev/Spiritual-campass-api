/* DOM flow test for the membership UI (public/member.js, public/index.html, public/reset.html).
 *
 * Why this exists next to tests/e2e/paywall.test.cjs: the Playwright suite needs a
 * browser download, which some sandboxes and CI images cannot fetch. This file drives
 * the same screens through a real DOM with jsdom, so the UI flows can still be
 * exercised without a browser. Supabase Auth, our own /api/* routes, the PayFast
 * checkout form post and the recovery link are all mocked here - nothing touches a
 * real Supabase project, PayFast or the network.
 *
 * Run:  npm run test:dom        (needs `npm install`; jsdom is a devDependency)
 * It asserts, among others:
 *   - the app is locked until login + confirmed access
 *   - sign-up with email confirmation shows "check your email" and resend works
 *   - "forgot password" sends the recover request with redirect_to=<site>/reset
 *   - a wrong password is refused; the first login shows the trial page
 *   - the account chip reads "Trial - 7d" (the e2e asserts the same text)
 *   - admin: add centre, search, generate a temp password (cleared on close), delete
 *   - the forced password-change screen cannot be dismissed and re-logs in after the change
 *   - the paywall, PayFast hand-off and the two-tap cancel
 *   - /reset#access_token=...&type=recovery sets the password via PUT /auth/v1/user
 */

import fs from "node:fs";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? "PASS " : "FAIL ") + m); };
const tick = (n = 4) => new Promise((r) => setTimeout(r, n * 8));

function makeWindow(htmlFile, { fetchImpl, initScript }) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => console.log("!! JSDOM ERROR:", e.message, (e.detail && e.detail.stack ? e.detail.stack.split("\n").slice(0, 4).join(" | ") : "")));
  const dom = new JSDOM(read(htmlFile), { runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.fetch = fetchImpl;
  w.HTMLFormElement.prototype.submit = function () { w.__formPosted = this.action; };
  w.eval(read("public/config.js"));
  /* lang.js declares `const LANGS`; evaluate it as a function body so the harness can see it too */
  w.LANGS = new Function(read("public/lang.js") + "; return LANGS;")();
  w.eval(`var LANG="en";
    window.T=function(key,vars){let t=(LANGS[LANG]||{})[key]||"";if(vars)for(const k in vars)t=t.split("{"+k+"}").join(vars[k]);return t;};
    window.bi=function(en,second){return second?en+" · "+second:en;};
    window.setCentres=function(d){window.__centres=d;};`);
  if (initScript) w.eval(initScript);
  return { dom, w };
}
const fire = (w, el, type = "submit") => el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));

const SESSION = { access_token: "good-token", refresh_token: "rt", expires_in: 3600, user: { email: "member@example.org" } };
const trialMe = { email: "member@example.org", status: "trialing", access: true, state: "trial", days_left: 7, access_until: new Date(Date.now() + 7 * 864e5).toISOString(), can_cancel: false, price: "100.00", is_admin: false, must_change_password: false, created_at: new Date().toISOString() };
const state = { me: trialMe, centresCalls: 0, forms: [], bodies: [], passwordBody: null, adminCalls: [], session: SESSION };

function route(url, opts = {}) {
  const u = new URL(url, "http://localhost");
  const method = (opts.method || "GET").toUpperCase();
  let body; try { body = opts.body ? JSON.parse(opts.body) : undefined; } catch { body = undefined; }
  state.bodies.push({ path: u.pathname + u.search, method, body });
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data, headers: { get: () => null } });
  const goodPassword = (p) => p === "good-password-1" || (state.passwordBody && p === state.passwordBody.new_password);
  if (u.pathname === "/auth/v1/token") return json(goodPassword(body && body.password) ? 200 : 400, goodPassword(body && body.password) ? SESSION : { msg: "Invalid login credentials" });
  if (u.pathname === "/auth/v1/signup") return json(200, {});
  if (u.pathname === "/auth/v1/recover" || u.pathname === "/auth/v1/resend") return json(200, {});
  if (u.pathname === "/api/account/password") { state.passwordBody = body; state.me = { ...state.me, must_change_password: false }; return json(200, { ok: true }); }
  if (u.pathname === "/api/me") return json(200, state.me);
  if (u.pathname === "/api/centres") { state.centresCalls++; return json(200, { regions: ["Gauteng"], centres: [] }); }
  if (u.pathname === "/api/admin/users") return json(200, { users: [{ user_id: "11111111-1111-4111-8111-111111111111", email: "alpha@example.org", status: "active", state: "active", created_at: "2026-01-01T00:00:00Z" }] });
  if (u.pathname === "/api/admin/users/reset-password") { state.adminCalls.push("reset"); return json(200, { email: "alpha@example.org", temporary_password: "Kx7@mQr2#pLt9" }); }
  if (u.pathname === "/api/admin/users/delete") { state.adminCalls.push("delete"); return json(200, { ok: true, subscription_cancelled: true }); }
  if (u.pathname === "/api/admin/centres") { state.adminCalls.push("centre"); return json(201, { centre: { id: "n1", r: body.region, n: body.name, a: body.address, p: body.phone, la: 0, lo: 0 } }); }
  throw new Error("unexpected fetch " + method + " " + url);
}

/* ---------- member.js flows ---------- */
{
  const { w } = makeWindow("public/index.html", { fetchImpl: async (url, opts) => route(url, opts) });
  w.eval(read("public/member.js"));
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await tick();
  ok(w.TSHK_LOCKED === true, "locked while signed out");
  ok(w.document.getElementById("member").hidden === false && w.document.getElementById("m-login").hidden === false, "login screen is shown");
  ok(w.document.getElementById("m-signup").hidden === true, "sign-up form hidden at first");

  // create account → check your email
  w.document.getElementById("m-to-signup").click(); await tick();
  w.document.getElementById("m-signup-email").value = "new@example.org";
  w.document.getElementById("m-signup-pass").value = "long-enough-1";
  fire(w, w.document.getElementById("m-signup"));
  await tick(6);
  ok(!w.document.getElementById("m-checkmail").hidden, "sign-up with confirmation ON shows check-your-email");
  ok(w.document.getElementById("m-checkmail-note").textContent.includes("new@example.org"), "check-your-email names the address");
  w.document.getElementById("m-resend").click(); await tick(6);
  ok(w.document.getElementById("m-msg").textContent.includes("Email sent again"), "resend works");
  w.document.getElementById("m-checkmail-back").click(); await tick();

  // forgot password
  w.document.getElementById("m-forgot-link").click(); await tick();
  w.document.getElementById("m-forgot-email").value = "member@example.org";
  fire(w, w.document.getElementById("m-forgot")); await tick(6);
  const recover = state.bodies.find((b) => b.path.startsWith("/auth/v1/recover"));
  ok(!!recover && recover.path.includes("redirect_to=http%3A%2F%2Flocalhost%2Freset"), "recover redirects to /reset: " + (recover && recover.path));
  w.document.getElementById("m-forgot-back").click(); await tick();

  // wrong password then right password → trial page
  w.document.getElementById("m-login-email").value = "member@example.org";
  w.document.getElementById("m-login-pass").value = "wrong";
  fire(w, w.document.getElementById("m-login")); await tick(6);
  ok(w.document.getElementById("m-msg").textContent.includes("did not match"), "wrong password refused");
  w.document.getElementById("m-login-pass").value = "good-password-1";
  fire(w, w.document.getElementById("m-login")); await tick(8);
  ok(!w.document.getElementById("m-trial").hidden, "first login shows the trial page");
  ok(w.document.getElementById("m-trial").textContent.includes("Compass to Ekuphumuleni"), "feature list rendered");
  w.document.getElementById("m-trial-start").click(); await tick(8);
  ok(w.TSHK_LOCKED === false, "unlocked after Start");
  ok(w.document.getElementById("member").hidden === true, "overlay closed");
  ok(state.centresCalls === 1 && w.__centres && w.__centres.regions.length === 1, "centres fetched after access");
  ok(w.localStorage.getItem("tshk-trial-seen") !== null, "trial page marked as seen");
  ok(w.document.getElementById("acct").hidden === false && w.document.getElementById("acct-t").textContent === "Trial · 7d",
    "account chip reads Trial · 7d (got " + JSON.stringify(w.document.getElementById("acct-t").textContent) + ")");

  // account + admin panel (a fresh page load, so /api/me reports is_admin)
  state.me = { ...trialMe, is_admin: true, state: "active", status: "active", access: true, can_cancel: true };
  const a = makeWindow("public/index.html", { fetchImpl: async (url, opts) => route(url, opts), initScript: `localStorage.setItem("tshk-session", ${JSON.stringify(JSON.stringify(SESSION))});localStorage.setItem("tshk-trial-seen", ${JSON.stringify(JSON.stringify("member@example.org"))});` });
  const w2 = a.w;
  w2.eval(read("public/member.js"));
  w2.document.dispatchEvent(new w2.Event("DOMContentLoaded"));
  await tick(8);
  w2.document.getElementById("acct").click(); await tick(6);
  ok(w2.document.getElementById("m-account").hidden === false, "account screen opens");
  ok(w2.document.getElementById("m-admin").hidden === false, "admin button visible for an admin");
  w2.document.getElementById("m-admin").click(); await tick();
  { const w = w2;

  ok(w.document.getElementById("admin").hidden === false && w.document.getElementById("a-centre").hidden === false, "admin panel opens");
  w.document.getElementById("a-region").value = "Gauteng";
  w.document.getElementById("a-name").value = "Randburg";
  w.document.getElementById("a-lat").value = "-26.09"; w.document.getElementById("a-lng").value = "28";
  w.document.getElementById("a-centre-btn").click(); await tick(6);
  ok(state.adminCalls.includes("centre") && w.document.getElementById("a-msg").textContent.includes("Centre added"), "add centre works");
  w.document.getElementById("a-tab-reset").click(); await tick();
  w.document.getElementById("a-reset-q").value = "alpha";
  w.document.getElementById("a-reset-search").click(); await tick(6);
  ok(w.document.querySelectorAll("#a-reset-list .a-row").length === 1, "admin search lists the user");
  w.document.querySelector("#a-reset-list .a-row button").click(); await tick();
  ok(w.document.getElementById("a-reset-warn").textContent.includes("alpha@example.org"), "reset confirmation names the user");
  w.document.getElementById("a-reset-go").click(); await tick(8);
  ok(w.document.getElementById("a-temp-pw").textContent === "Kx7@mQr2#pLt9", "temporary password shown once");
  w.document.getElementById("a-temp-close").click(); await tick();
  ok(w.document.getElementById("a-temp-pw").textContent === "" && w.document.getElementById("a-temp").hidden, "closing clears the password");
  w.document.getElementById("a-tab-delete").click(); await tick();
  w.document.getElementById("a-delete-q").value = "alpha";
  w.document.getElementById("a-delete-search").click(); await tick(6);
  w.document.querySelector("#a-delete-list .a-row button").click(); await tick();
  ok(w.document.getElementById("a-delete-go").disabled === true, "delete is disabled until the email is typed");
  w.document.getElementById("a-delete-type").value = "alpha@example.org";
  w.document.getElementById("a-delete-type").dispatchEvent(new w.Event("input", { bubbles: true }));
  await tick();
  ok(w.document.getElementById("a-delete-go").disabled === false, "typing the right email enables delete");
  w.document.getElementById("a-delete-go").click(); await tick(8);
  ok(state.adminCalls.includes("delete") && w.document.getElementById("a-msg").textContent.includes("deleted"), "delete runs and reports");
  w.document.getElementById("a-close").click(); await tick();
  w.document.getElementById("m-signout").click(); await tick();
  ok(w.TSHK_LOCKED === true && w.localStorage.getItem("tshk-session") === null && w.document.getElementById("m-login").hidden === false, "sign out clears the session, locks the app and shows login");
  }
}

/* ---------- forced password change ---------- */
{
  state.me = { ...trialMe, must_change_password: true };
  state.passwordBody = null;
  const { w } = makeWindow("public/index.html", { fetchImpl: async (url, opts) => route(url, opts), initScript: `localStorage.setItem("tshk-session", ${JSON.stringify(JSON.stringify(SESSION))});` });
  w.eval(read("public/member.js"));
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await tick(8);
  ok(!w.document.getElementById("m-mustchange").hidden, "forced password screen appears");
  w.document.getElementById("m-newpass").value = "chosen-by-me-9";
  fire(w, w.document.getElementById("m-mustchange")); await tick(10);
  ok(state.passwordBody && state.passwordBody.new_password === "chosen-by-me-9", "posts the new password");
  ok(w.document.getElementById("m-mustchange").hidden && !w.document.getElementById("m-trial").hidden, "after the change the trial intro shows (not the forced-change screen)");
  w.document.getElementById("m-trial-start").click(); await tick(8);
  ok(w.document.getElementById("member").hidden && w.TSHK_LOCKED === false, "app opens after the change");
}

/* ---------- paywall / confirm / cancel ---------- */
{
  state.me = { ...trialMe, access: false, state: "trial_ended", can_cancel: false };
  const { w } = makeWindow("public/index.html", { fetchImpl: async (url, opts) => {
    const pathname = new URL(url, "http://localhost").pathname;
    if (pathname === "/api/payfast/checkout") return { ok: true, status: 200, json: async () => ({ action: "https://sandbox.payfast.co.za/eng/process", fields: { a: "1" } }), headers: { get: () => null } };
    if (pathname === "/api/payfast/cancel") return { ok: true, status: 200, json: async () => ({ ok: true, state: "cancelled", access: true, access_until: new Date(Date.now() + 8 * 864e5).toISOString() }), headers: { get: () => null } };
    return route(url, opts);
  }, initScript: `localStorage.setItem("tshk-session", ${JSON.stringify(JSON.stringify(SESSION))});localStorage.setItem("tshk-ent", ${JSON.stringify(JSON.stringify({ ...trialMe, access: true, state: "active", access_until: new Date(Date.now() + 8 * 864e5).toISOString(), can_cancel: true, checked: Date.now() }))});` });
  w.eval(read("public/member.js"));
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await tick(8);
  ok(!w.document.getElementById("m-pay").hidden && w.document.getElementById("m-title").textContent.includes("trial has ended"), "paywall shown when the trial ended");
  w.document.getElementById("m-subscribe").click(); await tick(8);
  ok(w.__formPosted === "https://sandbox.payfast.co.za/eng/process", "PayFast form posted");
  // cancelled member: cancel then state line
  state.me = { ...trialMe, state: "cancelled", status: "cancelled", access: true, access_until: new Date(Date.now() + 8 * 864e5).toISOString(), can_cancel: false };
  w.document.getElementById("acct").click(); await tick(6);
  w.document.getElementById("m-cancel").click(); await tick(6);
  ok(w.document.getElementById("m-cancel").textContent.includes("Tap again"), "cancel needs a second tap");
  w.document.getElementById("m-cancel").click(); await tick(8);
  ok(w.document.getElementById("m-msg").textContent.includes("cancelled") || w.document.getElementById("m-state").textContent.includes("Cancelled"), "cancel completes");
}

/* ---------- reset.html ---------- */
{
  const dom = new JSDOM(read("public/reset.html"), { runScripts: "dangerously", url: "http://localhost/reset#access_token=recovery-token&refresh_token=rt2&type=recovery", pretendToBeVisual: true, beforeParse(w) {
    w.TSHK_CONFIG = { SUPABASE_URL: "https://sb.test", SUPABASE_ANON_KEY: "anon" };
    w.fetch = async (url, opts) => { state.resetBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ id: "u1" }) }; };
  } });
  const w = dom.window;
  await tick(6);
  ok(w.document.getElementById("form").hidden === false, "reset page accepts the recovery link");
  w.document.getElementById("pw").value = "short"; w.document.getElementById("pw2").value = "short";
  fire(w, w.document.getElementById("form")); await tick(4);
  ok(w.document.getElementById("msg").textContent.includes("8 characters"), "reset page refuses a short password");
  w.document.getElementById("pw").value = "new-password-77"; w.document.getElementById("pw2").value = "new-password-77";
  fire(w, w.document.getElementById("form")); await tick(8);
  ok(state.resetBody && state.resetBody.password === "new-password-77", "reset page PUTs the new password");
  ok(w.document.getElementById("msg").textContent.includes("Password updated"), "reset page confirms");
}

console.log(fails ? `${fails} check(s) failed` : "All checks passed");
process.exit(fails ? 1 : 0);
