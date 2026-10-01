import test from "node:test";
import assert from "node:assert/strict";
import { entitlement, addMonths } from "../../api/_lib/entitlement.js";

const now = new Date("2026-10-10T12:00:00Z");
const day = 86400000;
const iso = (ms) => new Date(ms).toISOString();

test("new member on day 3 of a 7-day trial has access with days left", () => {
  const e = entitlement({ status: "trialing", trial_ends_at: iso(now.getTime() + 4.2 * day) }, { now });
  assert.equal(e.access, true); assert.equal(e.state, "trial"); assert.equal(e.days_left, 5);
});
test("trial ended without paying → locked", () => {
  const e = entitlement({ status: "trialing", trial_ends_at: iso(now.getTime() - 1000) }, { now });
  assert.deepEqual([e.access, e.state], [false, "trial_ended"]);
});
test("paid member has access; grace period covers a late monthly charge", () => {
  const m = { status: "active", trial_ends_at: iso(now.getTime() - 30 * day), paid_through: iso(now.getTime() - 2 * day) };
  assert.equal(entitlement(m, { now, graceDays: 3 }).access, true);
  assert.equal(entitlement(m, { now, graceDays: 1 }).state, "past_due");
});
test("cancelled member keeps access until the paid month ends, then expires", () => {
  const m = { status: "cancelled", trial_ends_at: iso(0), paid_through: iso(now.getTime() + 10 * day) };
  const e = entitlement(m, { now });
  assert.deepEqual([e.access, e.state, e.renews], [true, "cancelled", false]);
  assert.equal(entitlement({ ...m, paid_through: iso(now.getTime() - 5 * day) }, { now }).state, "expired");
});
test("paying during the trial shows active (not trial)", () => {
  const m = { status: "active", trial_ends_at: iso(now.getTime() + 3 * day), paid_through: iso(now.getTime() + 30 * day) };
  assert.equal(entitlement(m, { now }).state, "active");
});
test("addMonths clamps month ends", () => {
  assert.equal(addMonths(new Date("2026-01-31T09:00:00Z"), 1).toISOString(), "2026-02-28T09:00:00.000Z");
  assert.equal(addMonths(new Date("2026-12-15T09:00:00Z"), 1).toISOString(), "2027-01-15T09:00:00.000Z");
});
test("no member row → no access", () => assert.equal(entitlement(null).access, false));
