// End-to-end tests of the HTTP handlers with Supabase and PayFast replaced by in-memory fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setEnv, memoryDb, installFetch, fakeReq, fakeRes, seedCentres } from "./helpers.js";

setEnv();
const me = (await import("../../api/me.js")).default;
const centres = (await import("../../api/centres.js")).default;
const checkout = (await import("../../api/payfast/checkout.js")).default;
const notify = (await import("../../api/payfast/notify.js")).default;
const cancel = (await import("../../api/payfast/cancel.js")).default;
const { checkoutSignature } = await import("../../api/_lib/payfast.js");

const here = path.dirname(fileURLToPath(import.meta.url));
let HAS_PHP = true; try { execFileSync("php", ["-v"], { stdio: "ignore" }); } catch { HAS_PHP = false; }
const auth = { authorization: "Bearer good-token" };
async function call(handler, req) { const res = fakeRes(); await handler(req, res); return res; }

test("signed out → 401", async () => {
  const db = memoryDb(); const f = installFetch(db);
  try { const res = await call(me, fakeReq({ headers: {} })); assert.equal(res.statusCode, 401); } finally { f.restore(); }
});

test("first sign-in starts a 7-day trial; centres are served during the trial", async () => {
  const db = memoryDb(); const f = installFetch(db);
  try {
    const res = await call(me, fakeReq({ headers: auth })); const j = res.json();
    assert.equal(res.statusCode, 200); assert.equal(j.state, "trial"); assert.equal(j.days_left, 7); assert.equal(j.price, "100.00");
    assert.equal(j.is_admin, false); assert.equal(j.must_change_password, false);
    assert.equal(db.t.members.length, 1);
    await seedCentres(db);
    const c = await call(centres, fakeReq({ headers: auth })); assert.equal(c.statusCode, 200);
    assert.equal(c.json().centres.length, 88); assert.equal(c.json().regions.length, 15);
  } finally { f.restore(); }
});

test("after the trial: centres locked (402) until payment", async () => {
  const db = memoryDb(); await seedCentres(db); db.t.members.push({ user_id: "u1", status: "trialing", trial_ends_at: "2020-01-01T00:00:00Z" }); const f = installFetch(db);
  try {
    assert.equal((await call(me, fakeReq({ headers: auth }))).json().state, "trial_ended");
    assert.equal((await call(centres, fakeReq({ headers: auth }))).statusCode, 402);
  } finally { f.restore(); }
});

test("checkout returns a correctly signed R100 monthly PayFast form", async () => {
  const db = memoryDb(); const f = installFetch(db);
  try {
    const res = await call(checkout, fakeReq({ method: "POST", headers: auth })); const j = res.json();
    assert.equal(res.statusCode, 200); assert.equal(j.action, "https://sandbox.payfast.co.za/eng/process");
    const { signature, ...fields } = j.fields;
    assert.equal(signature, checkoutSignature(fields, "jt7NOE43FZPn"));
    assert.equal(fields.recurring_amount, "100.00"); assert.equal(fields.frequency, "3"); assert.equal(fields.email_address, "member@example.org");
    assert.equal(db.t.checkouts.length, 1); assert.equal(db.t.checkouts[0].m_payment_id, fields.m_payment_id);
    assert.ok(!JSON.stringify(j).includes("jt7NOE43FZPn"), "passphrase never leaves the server");
  } finally { f.restore(); }
});

test("full cycle: checkout → PayFast ITN → access → cancel", { skip: !HAS_PHP && "PHP not installed" }, async () => {
  const db = memoryDb(); db.t.members.push({ user_id: "u1", status: "trialing", trial_ends_at: "2020-01-01T00:00:00Z" }); const f = installFetch(db);
  try {
    await seedCentres(db);
    const co = (await call(checkout, fakeReq({ method: "POST", headers: auth }))).json();
    const data = { m_payment_id: co.fields.m_payment_id, pf_payment_id: "555001", payment_status: "COMPLETE", item_name: co.fields.item_name, item_description: "",
      amount_gross: "100.00", amount_fee: "-3.45", amount_net: "96.55", name_first: "", name_last: "", email_address: "member@example.org", merchant_id: "10000100", token: "tok-live-1", billing_date: co.fields.billing_date };
    const sig = execFileSync("php", [path.join(here, "php-reference.php")], { input: JSON.stringify({ fn: "itn", data, pass: "jt7NOE43FZPn" }) }).toString();
    const n = await call(notify, fakeReq({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "144.126.193.139" }, body: new URLSearchParams({ ...data, signature: sig }).toString() }));
    assert.equal(n.statusCode, 200, n.body);
    assert.ok(f.calls.some((c) => c.url.includes("sandbox.payfast.co.za/eng/query/validate")), "asked PayFast to confirm");
    const m = (await call(me, fakeReq({ headers: auth }))).json();
    assert.deepEqual([m.access, m.state, m.can_cancel], [true, "active", true]);
    assert.equal((await call(centres, fakeReq({ headers: auth }))).statusCode, 200);
    const x = await call(cancel, fakeReq({ method: "POST", headers: auth }));
    assert.equal(x.statusCode, 200); assert.equal(x.json().state, "cancelled"); assert.equal(x.json().access, true);
    const api = f.calls.find((c) => c.url.includes("api.payfast.co.za/subscriptions/tok-live-1/cancel"));
    assert.ok(api && api.method === "PUT" && api.url.endsWith("?testing=true") && api.headers.signature && api.headers["merchant-id"] === "10000100");
  } finally { f.restore(); }
});

test("wrong methods are refused", async () => {
  const db = memoryDb(); const f = installFetch(db);
  try {
    assert.equal((await call(checkout, fakeReq({ method: "GET", headers: auth }))).statusCode, 405);
    assert.equal((await call(notify, fakeReq({ method: "GET" }))).statusCode, 405);
  } finally { f.restore(); }
});
