// Admin routes: user search, add centre, auto-generate password, delete user.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { setEnv, memoryDb, installFetch, fakeReq, fakeRes, seedCentres } from "./helpers.js";
import { LOWER, UPPER, DIGITS, SYMBOLS } from "../../api/_lib/passwords.js";
import { phpUrlencode } from "../../api/_lib/payfast.js";

setEnv();
const adminUsers = (await import("../../api/admin/users.js")).default;
const adminCentres = (await import("../../api/admin/centres.js")).default;
const adminReset = (await import("../../api/admin/users/reset-password.js")).default;
const adminDelete = (await import("../../api/admin/users/delete.js")).default;
const notify = (await import("../../api/payfast/notify.js")).default;

const here = path.dirname(fileURLToPath(import.meta.url));
let HAS_PHP = true; try { execFileSync("php", ["-v"], { stdio: "ignore" }); } catch { HAS_PHP = false; }
const jsSign = (data, pass) => crypto.createHash("md5").update(Object.entries(data).map(([k, v]) => `${k}=${phpUrlencode(v)}`).join("&") + `&passphrase=${phpUrlencode(pass)}`, "utf8").digest("hex");
const sign = (data, pass = "jt7NOE43FZPn") => (HAS_PHP
  ? execFileSync("php", [path.join(here, "php-reference.php")], { input: JSON.stringify({ fn: "itn", data, pass }) }).toString()
  : jsSign(data, pass));

const future = () => new Date(Date.now() + 6 * 86400000).toISOString();
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = uuid(3), PAYING = uuid(6), FRESH = uuid(7), FAILING_ADMIN = uuid(8);
/* every delete test gets its own admin, so the per-admin rate limit cannot leak between tests */

function spyConsole() {
  const logs = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  return { logs, text: () => logs.join("\n"), restore: () => Object.assign(console, orig) };
}

/* One admin + a paying member + an auth-only account (signed up but never opened the app). */
async function fixture(adminId = ADMIN, fetchOpts = {}) {
  const db = memoryDb();
  await seedCentres(db);
  const row = (user_id, email, extra = {}) => ({
    user_id, email, status: "trialing", trial_ends_at: future(),
    is_admin: false, must_change_password: false, created_at: new Date().toISOString(), ...extra,
  });
  db.t.members.push(
    row(adminId, "admin@example.org", { is_admin: true }),
    row(PAYING, "paying@example.org", { status: "active", paid_through: future(), payfast_token: "tok-6" }),
  );
  db.t.checkouts.push({ m_payment_id: "chk-6", user_id: PAYING, amount: "100.00", status: "complete" });
  db.t.payments.push({ id: 1, user_id: PAYING, pf_payment_id: "p1", payment_status: "COMPLETE", amount_gross: "100.00" });
  const users = { "admin-token": { id: adminId, email: "admin@example.org" } };
  db.t.authUsers.push(
    { id: adminId, email: "admin@example.org", created_at: new Date().toISOString() },
    { id: PAYING, email: "paying@example.org", created_at: new Date().toISOString() },
    { id: FRESH, email: "fresh-signup@example.org", created_at: new Date().toISOString() },
  );
  const f = installFetch(db, { users, ...fetchOpts });
  return { db, f };
}
const hdr = (t = "admin-token") => ({ authorization: `Bearer ${t}` });
async function call(handler, req) { const res = fakeRes(); await handler(req, res); return res; }
const jsonReq = (body, url = "/api/admin/x", token = "admin-token") => fakeReq({ method: "POST", headers: { ...hdr(token), "content-type": "application/json" }, body: JSON.stringify(body), url });
const get = (url, token = "admin-token") => fakeReq({ headers: hdr(token), url });

test("GET /api/admin/users searches by email, returns at most 20, and includes accounts with no member row", async () => {
  const { db, f } = await fixture();
  try {
    const res = await call(adminUsers, get("/api/admin/users?q=paying"));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.json().users[0]).sort(), ["created_at", "email", "state", "status", "user_id"]);
    assert.equal(res.json().users[0].user_id, PAYING);
    assert.equal(res.json().users[0].status, "active");

    const fresh = await call(adminUsers, get("/api/admin/users?q=fresh-signup"));
    assert.equal(fresh.json().users.length, 1);
    assert.deepEqual([fresh.json().users[0].status, fresh.json().users[0].state], ["none", "none"]);

    assert.deepEqual((await call(adminUsers, get("/api/admin/users?q=nobody"))).json(), { users: [] });
    assert.deepEqual((await call(adminUsers, get("/api/admin/users"))).json(), { users: [] }, "empty q returns nothing");

    for (let i = 0; i < 30; i++) db.t.members.push({ user_id: `x${i}`, email: `many${i}@example.org`, status: "trialing", trial_ends_at: future(), created_at: new Date().toISOString() });
    const many = await call(adminUsers, get("/api/admin/users?q=many"));
    assert.equal(many.json().users.length, 20, "capped at 20");
  } finally { f.restore(); }
});

test("the admin search still filters correctly when Auth ignores the filter parameter", async () => {
  const { f } = await fixture(ADMIN, { adminUserListFilter: false });
  try {
    const res = await call(adminUsers, get("/api/admin/users?q=paying"));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().users.map((u) => u.user_id), [PAYING]);
  } finally { f.restore(); }
});

test("POST /api/admin/centres validates, refuses duplicates, and writes an audit row", async () => {
  const { db, f } = await fixture();
  try {
    const good = { region: "Gauteng", name: "Randburg", address: "1 Main Road, Randburg", phone: "+27 11 555 0100", lat: -26.09, lng: 28.0 };
    const created = await call(adminCentres, jsonReq(good));
    assert.equal(created.statusCode, 201);
    assert.deepEqual(Object.keys(created.json().centre).sort(), ["a", "id", "la", "lo", "n", "p", "r"]);
    assert.equal(created.json().centre.r, "Gauteng");
    assert.equal(created.json().centre.n, "Randburg");
    assert.match(db.t.admin_audit.at(-1).action, /^centre\.create$/);
    assert.equal(db.t.admin_audit.at(-1).admin_user_id, ADMIN);
    assert.equal(db.t.centres.filter((c) => c.name === "Randburg").length, 1);

    const dup = await call(adminCentres, jsonReq(good));
    assert.equal(dup.statusCode, 409); assert.deepEqual(dup.json(), { error: "duplicate_centre" });

    const bad = [
      [{ ...good, name: "Randburg", region: "Atlantis" }, ["region"]],
      [{ ...good, name: "R", region: "Gauteng" }, ["name"]],
      [{ ...good, name: "x".repeat(81), region: "Gauteng" }, ["name"]],
      [{ ...good, name: "Box", phone: "011 555 0100" }, ["phone"]],
      [{ ...good, name: "Box", phone: "+27 11 555 0100 ext 3" }, ["phone"]],
      [{ ...good, name: "Box", lat: -91 }, ["lat"]],
      [{ ...good, name: "Box", lng: 181 }, ["lng"]],
      [{ ...good, name: "Box", lat: "" }, ["lat"]],
    ];
    for (const [body, fields] of bad) {
      const res = await call(adminCentres, jsonReq(body));
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.json().error, "invalid_centre");
      assert.deepEqual(res.json().fields, fields, JSON.stringify(body));
    }
    assert.equal(db.t.centres.length, 88 + 1, "only the valid centre was added");
  } finally { f.restore(); }
});

test("reset password: flag set BEFORE the password, returned once, never stored, logged or audited", async () => {
  const { db, f } = await fixture();
  const spy = spyConsole();
  try {
    const res = await call(adminReset, jsonReq({ user_id: PAYING }));
    assert.equal(res.statusCode, 200);
    const { email, temporary_password: temp } = res.json();
    assert.equal(email, "paying@example.org");
    assert.equal(temp.length, 14);
    assert.ok(/[a-z]/.test(temp) && /[A-Z]/.test(temp) && /[0-9]/.test(temp) && /[!@#$%^&*?]/.test(temp), "one of each class");
    for (const ch of temp) assert.ok((LOWER + UPPER + DIGITS + SYMBOLS).includes(ch), `unexpected character ${ch}`);
    assert.ok(!/[0O1lI]/.test(temp), "no easily confused characters");

    const order = db.t.events.find((e) => e.type === "password_set");
    assert.equal(order.must_change_password, true, "must_change_password is set before the new password is applied");
    assert.equal(db.t.members.find((m) => m.user_id === PAYING).must_change_password, true);
    assert.equal(db.t.sessions.some((s) => s.user_id === PAYING), false, "that user's sessions are gone (Supabase revokes them)");

    assert.equal(JSON.stringify(db.t.admin_audit).includes(temp), false, "the password is not in admin_audit");
    assert.equal(spy.text().includes(temp), false, "the password is not logged");

    const again = await call(adminReset, jsonReq({ user_id: PAYING }));
    assert.notEqual(again.json().temporary_password, temp, "a new password every time");
  } finally { spy.restore(); f.restore(); }
});

test("reset password: unknown user and a Supabase failure", async () => {
  const { db, f } = await fixture();
  const spy = spyConsole();
  try {
    assert.equal((await call(adminReset, jsonReq({ user_id: "not-a-uuid" }))).statusCode, 404);
    assert.equal((await call(adminReset, jsonReq({ user_id: uuid(999) }))).statusCode, 404);
    f.restore();
    const failing = await fixture(FAILING_ADMIN);
    const f2 = installFetch(failing.db, { users: { "admin-token": { id: FAILING_ADMIN, email: "admin2@example.org" } }, adminPasswordStatus: 422 });
    try {
      const res = await call(adminReset, jsonReq({ user_id: PAYING }));
      assert.equal(res.statusCode, 502);
      assert.equal(failing.db.t.members.find((m) => m.user_id === PAYING).must_change_password, true, "the flag stays set");
      assert.equal(failing.db.t.admin_audit.length, 0, "no audit row claims a reset that did not happen");
      const body = res.body;
      assert.ok(!/password/i.test(JSON.stringify(failing.db.t.admin_audit)) || !JSON.stringify(failing.db.t.admin_audit).includes("temp"));
      assert.equal(failing.db.t.authUsers.find((u) => u.id === PAYING).password === undefined, true, "no password was stored by the fake");
      assert.equal(body.includes("password"), true);
    } finally { f2.restore(); }
    /* nothing the route logged may contain a password */
    assert.equal(/[a-z]{2}[A-Z]{2}[0-9]{2}/.test(spy.text()), false);
    assert.equal(spy.text().includes("temporary_password"), false);
  } finally { spy.restore(); f.restore(); }
});

test("delete user refuses to delete yourself", async () => {
  const { db, f } = await fixture();
  try {
    const res = await call(adminDelete, jsonReq({ user_id: ADMIN }));
    assert.equal(res.statusCode, 409); assert.deepEqual(res.json(), { error: "cannot_delete_self" });
    assert.equal(db.t.authUsers.filter((u) => u.id === ADMIN).length, 1);
    assert.equal(db.t.members.filter((m) => m.user_id === ADMIN).length, 1);
  } finally { f.restore(); }
});

test("delete user cancels PayFast first, then removes the auth user; payments keep their row", async () => {
  const { db, f } = await fixture(uuid(9));
  try {
    const res = await call(adminDelete, jsonReq({ user_id: PAYING }));
    assert.equal(res.statusCode, 200); assert.deepEqual(res.json(), { ok: true, subscription_cancelled: true });
    assert.deepEqual(db.t.events.map((e) => e.type), ["payfast_cancel", "auth_delete"], "cancel before delete");
    assert.equal(db.t.events[0].token, "tok-6");
    assert.equal(db.t.members.some((m) => m.user_id === PAYING), false);
    assert.equal(db.t.checkouts.some((c) => c.user_id === PAYING), false, "checkouts cascade");
    assert.equal(db.t.payments.length, 1);
    assert.equal(db.t.payments[0].user_id, null, "financial records are kept");
    const audit = db.t.admin_audit.at(-1);
    assert.equal(audit.action, "user.delete");
    assert.equal(audit.target_user_id, PAYING);
    assert.equal(audit.detail.subscription_cancelled, true);
  } finally { f.restore(); }
});

test("a late PayFast ITN for a deleted member answers 200 and changes nothing", async () => {
  const { db, f } = await fixture(uuid(10));
  try {
    await call(adminDelete, jsonReq({ user_id: PAYING }));
    const data = {
      m_payment_id: "chk-6", pf_payment_id: "555001", payment_status: "COMPLETE", item_name: "TSHK Compass monthly membership",
      item_description: "", amount_gross: "100.00", amount_fee: "-3.45", amount_net: "96.55", merchant_id: "10000100",
      token: "tok-6", billing_date: "2026-10-01",
    };
    const body = new URLSearchParams({ ...data, signature: sign(data) }).toString();
    const res = await call(notify, fakeReq({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "144.126.193.139" }, body }));
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /unknown payment, ignored/);
    assert.equal(db.t.payments.length, 1, "no new payment row");
  } finally { f.restore(); }
});

test("if PayFast refuses the cancellation nothing is deleted", async () => {
  const { db, f } = await fixture(ADMIN, { cancelStatus: 500 });
  try {
    const res = await call(adminDelete, jsonReq({ user_id: PAYING }));
    assert.equal(res.statusCode, 502); assert.deepEqual(res.json(), { error: "payfast_cancel_failed" });
    assert.equal(db.t.authUsers.some((u) => u.id === PAYING), true, "the user is still there");
    assert.equal(db.t.members.some((m) => m.user_id === PAYING), true);
    assert.equal(db.t.events.some((e) => e.type === "auth_delete"), false);
  } finally { f.restore(); }
});

test("a cancel failure that merely mentions cancelling aborts the delete", async () => {
  /* PayFast wording matters: "could not be cancelled" is a failure, not an already-cancelled subscription. */
  const { db, f } = await fixture(uuid(13), { cancelStatus: 400, cancelBody: { code: 400, status: "failed", data: { message: "The subscription could not be cancelled" } } });
  try {
    const res = await call(adminDelete, jsonReq({ user_id: PAYING }));
    assert.equal(res.statusCode, 502); assert.deepEqual(res.json(), { error: "payfast_cancel_failed" });
    assert.equal(db.t.authUsers.some((u) => u.id === PAYING), true, "the user is still there");
    assert.equal(db.t.events.some((e) => e.type === "auth_delete"), false);
  } finally { f.restore(); }
});

test("an already-cancelled PayFast subscription does not block the delete", async () => {
  const { db, f } = await fixture(uuid(11), { cancelStatus: 400, cancelBody: { code: 400, status: "failed", data: { message: "Subscription has already been cancelled" } } });
  try {
    const res = await call(adminDelete, jsonReq({ user_id: PAYING }));
    assert.equal(res.statusCode, 200); assert.equal(res.json().subscription_cancelled, true);
    assert.equal(db.t.authUsers.some((u) => u.id === PAYING), false);
  } finally { f.restore(); }
});

test("deleting an account that never used the app works; an unknown user is 404", async () => {
  const { db, f } = await fixture(uuid(12));
  try {
    const res = await call(adminDelete, jsonReq({ user_id: FRESH }));
    assert.equal(res.statusCode, 200); assert.deepEqual(res.json(), { ok: true, subscription_cancelled: false });
    assert.equal((await call(adminDelete, jsonReq({ user_id: uuid(999) }))).statusCode, 404);
    assert.deepEqual((await call(adminDelete, jsonReq({ user_id: uuid(1) }))).json(), { error: "user_not_found" });
  } finally { f.restore(); }
});

test("sensitive admin actions are rate limited per admin", async () => {
  const { db, f } = await fixture(uuid(50));
  try {
    for (let i = 0; i < 6; i++) {
      db.t.authUsers.push({ id: uuid(60 + i), email: `victim${i}@example.org`, created_at: new Date().toISOString() });
    }
    for (let i = 0; i < 5; i++) {
      const res = await call(adminDelete, jsonReq({ user_id: uuid(60 + i) }));
      assert.equal(res.statusCode, 200, `delete ${i} should pass`);
    }
    const blocked = await call(adminDelete, jsonReq({ user_id: uuid(65) }));
    assert.equal(blocked.statusCode, 429);
    assert.deepEqual(blocked.json(), { error: "rate_limited" });
    assert.ok(Number(blocked.headers["retry-after"]) > 0);
  } finally { f.restore(); }
});
