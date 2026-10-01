// Signatures must match PayFast's PHP reference exactly. Run: npm test (needs PHP on the PATH for the reference checks).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { phpUrlencode, checkoutSignature, buildSubscriptionCheckout, itnParamString, itnSignatureValid, apiHeaders, CHECKOUT_FIELD_ORDER } from "../../api/_lib/payfast.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let HAS_PHP = true; try { execFileSync("php", ["-v"], { stdio: "ignore" }); } catch { HAS_PHP = false; }
const php = (input) => execFileSync("php", [path.join(here, "php-reference.php")], { input: JSON.stringify(input) }).toString();
const C = { merchantId: "10000100", merchantKey: "46f0cd694581a", passphrase: "jt7NOE43FZPn", siteUrl: "https://compass.example.org", sandbox: true, amount: "100.00", itemName: "TSHK Compass monthly membership" };

test("phpUrlencode equals PHP urlencode()", { skip: !HAS_PHP && "PHP not installed" }, () => {
  const values = ["hello world", "a+b=c&d", "https://x.co.za/?payment=success", "Zoë Ñandú ~!*'()", "tsh.gama@msri.online", "2026-09-30T10:00:00+00:00", " spaced "];
  assert.deepEqual(values.map(phpUrlencode), JSON.parse(php({ fn: "urlencode", values })));
});

test("checkout signature equals PayFast PHP generateSignature()", { skip: !HAS_PHP && "PHP not installed" }, () => {
  const { fields } = buildSubscriptionCheckout({ c: C, email: "member+test@example.org", mPaymentId: "8f1c2c1e-3b1a-4c7e-9a55-2f0c9d6b1a11", today: "2026-10-01" });
  const { signature, ...data } = fields;
  assert.equal(signature, php({ fn: "sig", data, pass: C.passphrase }));
  assert.deepEqual(Object.keys(data), CHECKOUT_FIELD_ORDER.filter((k) => k in data), "fields are in PayFast's documented order");
  assert.equal(data.subscription_type, "1"); assert.equal(data.frequency, "3"); assert.equal(data.cycles, "0");
  assert.equal(data.amount, "100.00"); assert.equal(data.recurring_amount, "100.00");
  assert.equal(data.notify_url, "https://compass.example.org/api/payfast/notify");
});

test("empty fields are left out of the signature", () => {
  const a = checkoutSignature({ merchant_id: "1", merchant_key: "k", amount: "5.00", item_name: "x" }, "p");
  const b = checkoutSignature({ merchant_id: "1", merchant_key: "k", name_first: "", amount: "5.00", item_name: "x" }, "p");
  assert.equal(a, b);
});

function itnBody(extra = {}, pass = C.passphrase) {
  const data = { m_payment_id: "8f1c2c1e", pf_payment_id: "1089250", payment_status: "COMPLETE", item_name: "TSHK Compass monthly membership", item_description: "",
    amount_gross: "100.00", amount_fee: "-3.45", amount_net: "96.55", custom_str1: "", name_first: "Thandi", name_last: "Zulu", email_address: "member@example.org",
    merchant_id: C.merchantId, token: "dc0521d3-55fe-269b-fa00-b647310d760f", billing_date: "2026-10-01", ...extra };
  const signature = HAS_PHP ? php({ fn: "itn", data, pass }) : null;
  return { data, signature, raw: new URLSearchParams({ ...data, signature }).toString() };
}

test("genuine ITN signature (made by PHP reference) is accepted", { skip: !HAS_PHP && "PHP not installed" }, () => {
  const { raw } = itnBody();
  assert.equal(itnSignatureValid([...new URLSearchParams(raw)], C.passphrase), true);
});
test("tampered ITN or wrong passphrase is rejected", { skip: !HAS_PHP && "PHP not installed" }, () => {
  const { raw } = itnBody();
  const tampered = raw.replace("amount_gross=100.00", "amount_gross=1.00");
  assert.equal(itnSignatureValid([...new URLSearchParams(tampered)], C.passphrase), false);
  assert.equal(itnSignatureValid([...new URLSearchParams(raw)], "wrong-pass"), false);
  assert.equal(itnSignatureValid([...new URLSearchParams(raw.replace(/&signature=[^&]+/, ""))], C.passphrase), false);
});
test("ITN param string keeps PayFast's order and stops at signature", () => {
  const pairs = [["b", "2"], ["a", "x y"], ["signature", "zz"], ["later", "ignored"]];
  assert.equal(itnParamString(pairs), "b=2&a=x+y");
});

test("subscription API signature equals PayFast PHP generateApiSignature()", { skip: !HAS_PHP && "PHP not installed" }, () => {
  const now = new Date("2026-10-01T08:30:00Z");
  const h = apiHeaders(C, {}, now);
  assert.equal(h.timestamp, "2026-10-01T08:30:00+00:00");
  const data = { "merchant-id": h["merchant-id"], version: h.version, timestamp: h.timestamp };
  assert.equal(h.signature, php({ fn: "api", data, pass: C.passphrase }));
});
