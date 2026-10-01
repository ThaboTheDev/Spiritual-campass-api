// Password-change enforcement, admin gating, and the promise that the flags come from the database.
import test from "node:test";
import assert from "node:assert/strict";
import { setEnv, memoryDb, installFetch, fakeReq, fakeRes, seedCentres } from "./helpers.js";

setEnv();
const me = (await import("../../api/me.js")).default;
const centres = (await import("../../api/centres.js")).default;
const checkout = (await import("../../api/payfast/checkout.js")).default;
const cancel = (await import("../../api/payfast/cancel.js")).default;
const setPassword = (await import("../../api/account/password.js")).default;
const adminUsers = (await import("../../api/admin/users.js")).default;
const adminCentres = (await import("../../api/admin/centres.js")).default;
const adminReset = (await import("../../api/admin/users/reset-password.js")).default;
const adminDelete = (await import("../../api/admin/users/delete.js")).default;

const future = () => new Date(Date.now() + 6 * 86400000).toISOString();
const TOKENS = {
  "member-token": { id: "u1", email: "member@example.org" },
  "must-change-token": { id: "u2", email: "mustchange@example.org" },
  "admin-token": { id: "u3", email: "admin@example.org" },
  "admin-change-token": { id: "u4", email: "adminchange@example.org" },
  "claims-token": { id: "u5", email: "claims@example.org", user_metadata: { is_admin: true } },
};

async function fixture() {
  const db = memoryDb();
  await seedCentres(db);
  const row = (user_id, email, extra = {}) => ({
    user_id, email, status: "trialing", trial_ends_at: future(),
    is_admin: false, must_change_password: false, created_at: new Date().toISOString(), ...extra,
  });
  db.t.members.push(
    row("u1", "member@example.org"),
    row("u2", "mustchange@example.org", { must_change_password: true }),
    row("u3", "admin@example.org", { is_admin: true }),
    row("u4", "adminchange@example.org", { is_admin: true, must_change_password: true }),
    row("u5", "claims@example.org"),
  );
  const f = installFetch(db, { users: TOKENS });
  return { db, f };
}
const hdr = (t) => ({ authorization: `Bearer ${t}` });
async function call(handler, req) { const res = fakeRes(); await handler(req, res); return res; }
const jsonReq = (token, body, method = "POST", url = "/api/x") => fakeReq({ method, headers: { ...hdr(token), "content-type": "application/json" }, body: JSON.stringify(body), url });

test("GET /api/me still works while the password must be changed, and reports both flags", async () => {
  const { db, f } = await fixture();
  try {
    const res = await call(me, fakeReq({ headers: hdr("must-change-token") }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().must_change_password, true);
    assert.equal(res.json().is_admin, false);
    const admin = await call(me, fakeReq({ headers: hdr("admin-token") }));
    assert.equal(admin.json().is_admin, true);
    assert.equal(admin.json().must_change_password, false);
    assert.equal(db.t.members.length, 5, "no extra member rows");
  } finally { f.restore(); }
});

test("while must_change_password is true every other API route answers 403 password_change_required", async () => {
  const { f } = await fixture();
  try {
    const routes = [
      [centres, fakeReq({ headers: hdr("must-change-token"), url: "/api/centres" })],
      [checkout, jsonReq("must-change-token", {}, "POST", "/api/payfast/checkout")],
      [cancel, jsonReq("must-change-token", {}, "POST", "/api/payfast/cancel")],
      [adminUsers, fakeReq({ headers: hdr("admin-change-token"), url: "/api/admin/users?q=a" })],
      [adminCentres, jsonReq("admin-change-token", { region: "Gauteng" })],
      [adminReset, jsonReq("admin-change-token", { user_id: "u1" })],
      [adminDelete, jsonReq("admin-change-token", { user_id: "u1" })],
    ];
    for (const [handler, req] of routes) {
      const res = await call(handler, req);
      assert.equal(res.statusCode, 403, `${req.url} must be blocked`);
      assert.deepEqual(res.json(), { error: "password_change_required" });
    }
  } finally { f.restore(); }
});

test("POST /api/account/password sets the password, clears the flag, and the member can use the app", async () => {
  const { db, f } = await fixture();
  try {
    const weak = await call(setPassword, jsonReq("must-change-token", { new_password: "short" }, "POST", "/api/account/password"));
    assert.equal(weak.statusCode, 400); assert.deepEqual(weak.json(), { error: "weak_password" });
    assert.equal(db.t.members.find((m) => m.user_id === "u2").must_change_password, true, "a weak password changes nothing");

    const res = await call(setPassword, jsonReq("must-change-token", { new_password: "blue-heron-42" }, "POST", "/api/account/password"));
    assert.equal(res.statusCode, 200); assert.deepEqual(res.json(), { ok: true });
    assert.equal(db.t.members.find((m) => m.user_id === "u2").must_change_password, false);
    assert.equal(db.t.authUsers.find((u) => u.id === "u2").password, "blue-heron-42", "set through the Supabase Admin API");
    assert.equal((await call(centres, fakeReq({ headers: hdr("must-change-token"), url: "/api/centres" }))).statusCode, 200);
  } finally { f.restore(); }
});

test("a member cannot smuggle flags into their own password change", async () => {
  const { db, f } = await fixture();
  try {
    const res = await call(setPassword, jsonReq("member-token", { new_password: "another-pass-1", is_admin: true, must_change_password: true }, "POST", "/api/account/password"));
    assert.equal(res.statusCode, 200);
    const m = db.t.members.find((x) => x.user_id === "u1");
    assert.equal(m.is_admin, false);
    assert.equal(m.must_change_password, false);
  } finally { f.restore(); }
});

test("admin routes answer 403 admin_required for a member who is not flagged admin — including one with is_admin in user_metadata", async () => {
  const { f } = await fixture();
  try {
    for (const [handler, req] of [
      [adminUsers, fakeReq({ headers: hdr("member-token"), url: "/api/admin/users?q=a" })],
      [adminUsers, fakeReq({ headers: hdr("claims-token"), url: "/api/admin/users?q=a" })],
      [adminCentres, jsonReq("claims-token", { region: "Gauteng" })],
      [adminReset, jsonReq("claims-token", { user_id: "u1" })],
      [adminDelete, jsonReq("claims-token", { user_id: "u1" })],
    ]) {
      const res = await call(handler, req);
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.json(), { error: "admin_required" }, "is_admin is read from the database, never from the token");
    }
  } finally { f.restore(); }
});

test("signed out and bad tokens still get 401 on the new routes", async () => {
  const { f } = await fixture();
  try {
    assert.equal((await call(adminUsers, fakeReq({ url: "/api/admin/users?q=a" }))).statusCode, 401);
    assert.equal((await call(setPassword, jsonReq("nope", { new_password: "12345678" }, "POST", "/api/account/password"))).statusCode, 401);
  } finally { f.restore(); }
});
