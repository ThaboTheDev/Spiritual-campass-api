import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { handleItn } from "../../api/_lib/itn.js";
import { phpUrlencode } from "../../api/_lib/payfast.js";
import { memoryDb } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let HAS_PHP = true; try { execFileSync("php", ["-v"], { stdio: "ignore" }); } catch { HAS_PHP = false; }
const C = { merchantId: "10000100", passphrase: "jt7NOE43FZPn", sandbox: true, amount: "100.00", enforceIp: false };
// Signs with PHP's own urlencode/md5 when PHP is installed (the independent reference); otherwise with the same rules in JS.
const phpSign = (data, pass) => execFileSync("php", [path.join(here, "php-reference.php")], { input: JSON.stringify({ fn: "itn", data, pass }) }).toString();
const jsSign = (data, pass) => crypto.createHash("md5").update(Object.entries(data).map(([k, v]) => `${k}=${phpUrlencode(v)}`).join("&") + `&passphrase=${phpUrlencode(pass)}`, "utf8").digest("hex");
const sign = (data, pass = C.passphrase) => (HAS_PHP ? phpSign(data, pass) : jsSign(data, pass));
function itn(fields) {
  const data = { m_payment_id: "chk-1", pf_payment_id: "1001", payment_status: "COMPLETE", item_name: "TSHK Compass monthly membership", amount_gross: "100.00", amount_fee: "-3.45", amount_net: "96.55", merchant_id: C.merchantId, token: "tok-abc", billing_date: "2026-10-01", ...fields };
  return new URLSearchParams({ ...data, signature: sign(data) }).toString();
}
const quiet = { warn() {}, log() {} };
const opts = (db, extra = {}) => ({ db, c: C, confirm: async () => true, checkIp: async () => true, now: () => new Date("2026-10-01T10:00:00Z"), log: quiet, ...extra });
const skip = false;

function seeded() {
  const db = memoryDb();
  db.t.members.push({ user_id: "u1", status: "trialing", trial_ends_at: "2026-10-05T00:00:00Z" });
  db.t.checkouts.push({ m_payment_id: "chk-1", user_id: "u1", amount: "100.00", status: "pending" });
  return db;
}

test("first payment activates membership for one month", { skip }, async () => {
  const db = seeded();
  const r = await handleItn(itn({}), "1.2.3.4", opts(db));
  assert.equal(r.status, 200);
  assert.deepEqual([db.t.members[0].status, db.t.members[0].payfast_token, db.t.members[0].paid_through], ["active", "tok-abc", "2026-11-05T00:00:00.000Z"]);
  assert.equal(db.t.checkouts[0].status, "complete");
  assert.equal(db.t.payments.length, 1);
});
test("the same notification twice is applied once", { skip }, async () => {
  const db = seeded(); const body = itn({});
  await handleItn(body, "", opts(db)); const r2 = await handleItn(body, "", opts(db));
  assert.equal(r2.reason, "duplicate notification"); assert.equal(db.t.members[0].paid_through, "2026-11-05T00:00:00.000Z");
});
test("monthly renewal (matched by token) extends from the paid-through date", { skip }, async () => {
  const db = seeded();
  await handleItn(itn({}), "", opts(db));
  const r = await handleItn(itn({ m_payment_id: "", pf_payment_id: "1002" }), "", opts(db, { now: () => new Date("2026-10-31T10:00:00Z") }));
  assert.equal(r.status, 200); assert.equal(db.t.members[0].paid_through, "2026-12-05T00:00:00.000Z");
});
test("wrong amount is refused", { skip }, async () => {
  const db = seeded(); const r = await handleItn(itn({ amount_gross: "10.00" }), "", opts(db));
  assert.equal(r.status, 400); assert.equal(db.t.members[0].status, "trialing");
});
test("forged signature is refused", { skip }, async () => {
  const db = seeded(); const r = await handleItn(itn({}).replace("amount_net=96.55", "amount_net=99.00"), "", opts(db));
  assert.deepEqual([r.status, r.reason], [400, "invalid signature"]);
});
test("notification PayFast does not confirm is refused", { skip }, async () => {
  const db = seeded(); const r = await handleItn(itn({}), "", opts(db, { confirm: async () => false }));
  assert.equal(r.status, 400); assert.equal(db.t.members[0].status, "trialing");
});
test("other merchant id is refused", { skip }, async () => {
  const db = seeded(); const r = await handleItn(itn({ merchant_id: "999" }), "", opts(db));
  assert.equal(r.reason, "merchant id mismatch");
});
test("unknown source address: logged by default, refused when enforcement is on", { skip }, async () => {
  const db = seeded();
  assert.equal((await handleItn(itn({}), "9.9.9.9", opts(db, { checkIp: async () => false }))).status, 200);
  const db2 = seeded();
  assert.equal((await handleItn(itn({}), "9.9.9.9", opts(db2, { checkIp: async () => false, c: { ...C, enforceIp: true } }))).status, 403);
});
test("cancellation notification marks membership cancelled", { skip }, async () => {
  const db = seeded(); await handleItn(itn({}), "", opts(db));
  const r = await handleItn(itn({ payment_status: "CANCELLED", pf_payment_id: "" }), "", opts(db));
  assert.equal(r.status, 200); assert.equal(db.t.members[0].status, "cancelled");
});

/* ---- fixes: retry-safe activation, price changes, trial days ---- */
test("a payment recorded but not applied is completed when PayFast retries", async () => {
  const db = seeded(); const body = itn({});
  const realUpdate = db.updateMember; let failOnce = true;
  db.updateMember = async (...a) => { if (failOnce) { failOnce = false; throw new Error("Supabase hiccup"); } return realUpdate(...a); };
  await assert.rejects(handleItn(body, "", opts(db)), /hiccup/);          // PayFast sees a 500 and will retry
  assert.equal(db.t.members[0].status, "trialing"); assert.equal(db.t.payments.length, 1);
  const r = await handleItn(body, "", opts(db));                           // the retry
  assert.equal(r.status, 200); assert.match(r.reason, /completed on retry/);
  assert.deepEqual([db.t.members[0].status, db.t.members[0].paid_through], ["active", "2026-11-05T00:00:00.000Z"]);
  assert.equal(db.t.payments.length, 1);
  const r3 = await handleItn(body, "", opts(db));                          // a third delivery changes nothing
  assert.equal(r3.reason, "duplicate notification"); assert.equal(db.t.members[0].paid_through, "2026-11-05T00:00:00.000Z");
});
test("raising the price does not break existing subscribers' renewals", async () => {
  const db = seeded();
  await handleItn(itn({}), "", opts(db));                                   // signed up at R100
  assert.equal(db.t.members[0].subscription_amount, "100.00");
  const later = opts(db, { c: { ...C, amount: "120.00" }, now: () => new Date("2026-10-31T10:00:00Z") });
  const renewal = await handleItn(itn({ m_payment_id: "", pf_payment_id: "1002" }), "", later);
  assert.equal(renewal.status, 200); assert.equal(db.t.members[0].status, "active");
  const wrong = await handleItn(itn({ m_payment_id: "", pf_payment_id: "1003", amount_gross: "120.00" }), "", later);
  assert.equal(wrong.status, 400);                                          // still refuses an amount they never agreed to
});
test("a checkout started at the old price still completes after a price change", async () => {
  const db = seeded(); const r = await handleItn(itn({}), "", opts(db, { c: { ...C, amount: "120.00" } }));
  assert.equal(r.status, 200); assert.equal(db.t.members[0].subscription_amount, "100.00");
});
test("days left on the free trial are kept when someone subscribes early", async () => {
  const db = seeded();                                                      // trial ends 2026-10-05, paying on 2026-10-01
  await handleItn(itn({}), "", opts(db));
  assert.equal(db.t.members[0].paid_through, "2026-11-05T00:00:00.000Z");
});
test("after the trial has ended the month runs from the payment date", async () => {
  const db = seeded(); db.t.members[0].trial_ends_at = "2026-09-01T00:00:00Z";
  await handleItn(itn({}), "", opts(db));
  assert.equal(db.t.members[0].paid_through, "2026-11-01T10:00:00.000Z");
});
