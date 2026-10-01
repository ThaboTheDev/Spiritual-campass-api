// PayFast: recurring-billing checkout, ITN (payment notification) verification, subscription API.
// Signatures follow PayFast's PHP reference: PHP urlencode() (spaces as "+", uppercase hex), MD5, passphrase appended.
import crypto from "node:crypto";
import dns from "node:dns/promises";

export const PROCESS_URL = { live: "https://www.payfast.co.za/eng/process", sandbox: "https://sandbox.payfast.co.za/eng/process" };
export const VALIDATE_URL = { live: "https://www.payfast.co.za/eng/query/validate", sandbox: "https://sandbox.payfast.co.za/eng/query/validate" };
export const API_BASE = "https://api.payfast.co.za";
export const PAYFAST_HOSTS = ["www.payfast.co.za", "sandbox.payfast.co.za", "w1w.payfast.co.za", "w2w.payfast.co.za"];

/* PHP urlencode(): everything except A-Z a-z 0-9 - _ . is %XX (uppercase); space becomes "+". */
export function phpUrlencode(value) {
  const bytes = Buffer.from(String(value), "utf8");
  let out = "";
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if (/[A-Za-z0-9\-_.]/.test(ch)) out += ch;
    else if (b === 0x20) out += "+";
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}
const md5 = (s) => crypto.createHash("md5").update(s, "utf8").digest("hex");
function safeEqual(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* Field order as documented by PayFast (the signature string must follow it). */
export const CHECKOUT_FIELD_ORDER = [
  "merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url",
  "name_first", "name_last", "email_address", "cell_number",
  "m_payment_id", "amount", "item_name", "item_description",
  "email_confirmation", "confirmation_address", "payment_method",
  "subscription_type", "billing_date", "recurring_amount", "frequency", "cycles",
  "subscription_notify_email", "subscription_notify_webhook", "subscription_notify_buyer",
];

export function checkoutSignature(fields, passphrase) {
  let s = CHECKOUT_FIELD_ORDER
    .filter((k) => fields[k] !== undefined && fields[k] !== null && String(fields[k]) !== "")
    .map((k) => `${k}=${phpUrlencode(String(fields[k]).trim())}`).join("&");
  if (passphrase) s += `&passphrase=${phpUrlencode(String(passphrase).trim())}`;
  return md5(s);
}

/* Build the signed form that the browser posts to PayFast. R100 now, then R100 every month until cancelled. */
export function buildSubscriptionCheckout({ c, email, mPaymentId, today }) {
  const raw = {
    merchant_id: c.merchantId,
    merchant_key: c.merchantKey,
    return_url: `${c.siteUrl}/?payment=success`,
    cancel_url: `${c.siteUrl}/?payment=cancelled`,
    notify_url: `${c.siteUrl}/api/payfast/notify`,
    email_address: email || "",
    m_payment_id: mPaymentId,
    amount: c.amount,
    item_name: c.itemName,
    subscription_type: "1",          // 1 = subscription (recurring billing)
    billing_date: today,             // YYYY-MM-DD, first billing date
    recurring_amount: c.amount,
    frequency: "3",                  // 3 = monthly
    cycles: "0",                     // 0 = until cancelled
    subscription_notify_email: "true",
    subscription_notify_buyer: "true",
  };
  const fields = {};
  for (const k of CHECKOUT_FIELD_ORDER) if (raw[k] !== undefined && raw[k] !== "") fields[k] = String(raw[k]);
  fields.signature = checkoutSignature(fields, c.passphrase);
  return { action: c.sandbox ? PROCESS_URL.sandbox : PROCESS_URL.live, fields };
}

/* ITN: parameter string = received fields in received order, stopping at "signature", PHP-urlencoded. */
export function itnParamString(pairs) {
  const parts = [];
  for (const [k, v] of pairs) { if (k === "signature") break; parts.push(`${k}=${phpUrlencode(v)}`); }
  return parts.join("&");
}
export function itnSignatureValid(pairs, passphrase) {
  const sig = (pairs.find(([k]) => k === "signature") || [])[1];
  if (!sig) return false;
  let s = itnParamString(pairs);
  if (passphrase) s += `&passphrase=${phpUrlencode(String(passphrase).trim())}`;
  return safeEqual(md5(s), sig);
}

/* Ask PayFast to confirm the notification is genuine (response body "VALID"). */
export async function confirmWithPayfast(paramString, sandbox, fetchImpl = fetch) {
  const r = await fetchImpl(sandbox ? VALIDATE_URL.sandbox : VALIDATE_URL.live, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: paramString,
  });
  const text = (await r.text()).trim();
  return r.ok && text === "VALID";
}

/* Source check: resolve PayFast's hostnames, or reverse-lookup the caller. Advisory unless PAYFAST_ENFORCE_IP=true. */
export async function isPayfastIp(ip, resolver = dns) {
  if (!ip) return false;
  const clean = ip.replace(/^::ffff:/, "");
  try {
    for (const h of PAYFAST_HOSTS) {
      const addrs = await resolver.resolve4(h).catch(() => []);
      if (addrs.includes(clean)) return true;
    }
    const names = await resolver.reverse(clean).catch(() => []);
    return names.some((n) => n.endsWith(".payfast.co.za") || n === "payfast.co.za");
  } catch { return false; }
}

/* Subscription API (cancel, fetch, pause...). Signature = MD5 of all header + body values sorted by key, with passphrase. */
export function apiHeaders(c, body = {}, now = new Date()) {
  const timestamp = now.toISOString().slice(0, 19) + "+00:00";
  const headers = { "merchant-id": c.merchantId, version: "v1", timestamp };
  const all = { ...headers, ...body, passphrase: c.passphrase };
  const s = Object.keys(all).sort().map((k) => `${k}=${phpUrlencode(String(all[k]).trim())}`).join("&");
  return { ...headers, signature: md5(s) };
}
export async function subscriptionAction(c, token, action, { method = "PUT", fetchImpl = fetch } = {}) {
  const url = `${API_BASE}/subscriptions/${encodeURIComponent(token)}/${action}${c.sandbox ? "?testing=true" : ""}`;
  const r = await fetchImpl(url, { method, headers: { ...apiHeaders(c), "Content-Type": "application/json" } });
  let data = null; try { data = await r.json(); } catch { /* empty body */ }
  return { ok: r.ok, status: r.status, data };
}
