// Business logic for PayFast notifications, separated from HTTP so it can be tested.
import { itnParamString, itnSignatureValid, confirmWithPayfast, isPayfastIp } from "./payfast.js";
import { addMonths } from "./entitlement.js";

export async function handleItn(raw, ip, { db, c, confirm = confirmWithPayfast, checkIp = isPayfastIp, now = () => new Date(), log = console }) {
  const pairs = [...new URLSearchParams(raw)];
  const data = Object.fromEntries(pairs);
  if (!data.signature) return { status: 400, reason: "missing signature" };
  if (!itnSignatureValid(pairs, c.passphrase)) return { status: 400, reason: "invalid signature" };
  if (data.merchant_id !== c.merchantId) return { status: 400, reason: "merchant id mismatch" };
  if (!(await checkIp(ip))) {
    log.warn(`[payfast] ITN from unrecognised address ${ip}`);
    if (c.enforceIp) return { status: 403, reason: "unrecognised source address" };
  }
  if (!(await confirm(itnParamString(pairs), c.sandbox))) return { status: 400, reason: "PayFast did not confirm this notification" };

  // Who is this for? First payment: our m_payment_id. Monthly renewals: also matched by subscription token.
  const checkout = data.m_payment_id ? await db.getCheckout(data.m_payment_id) : null;
  let member = null;
  let userId = checkout && checkout.user_id;
  if (!userId && data.token) { member = await db.getMemberByToken(data.token); userId = member && member.user_id; }
  if (!userId) { log.warn(`[payfast] ITN for unknown payment ${data.m_payment_id || ""} ${data.token || ""}`); return { status: 200, reason: "unknown payment, ignored" }; }

  const status = String(data.payment_status || "").toUpperCase();
  if (status === "COMPLETE") {
    member = member || (await db.getMember(userId));
    // Amount check: the price this member signed up at (checkout, else stored on the member), else today's price.
    // A later price change therefore never breaks existing subscribers' renewals.
    const expected = checkout && checkout.amount != null ? Number(checkout.amount)
      : member && member.subscription_amount != null ? Number(member.subscription_amount) : Number(c.amount);
    if (Math.abs(parseFloat(data.amount_gross) - expected) > 0.01) return { status: 400, reason: `amount mismatch (${data.amount_gross})` };

    // Paid-through date this payment grants. Days left on a running free trial are kept, not thrown away.
    const prev = member && member.paid_through ? Date.parse(member.paid_through) : 0;
    const trialEnd = member && member.status === "trialing" && member.trial_ends_at ? Date.parse(member.trial_ends_at) : 0;
    const base = new Date(Math.max(now().getTime(), prev, trialEnd));
    let appliesUntil = addMonths(base, 1).toISOString();

    const inserted = await db.insertPayment({
      user_id: userId, pf_payment_id: data.pf_payment_id || null, m_payment_id: data.m_payment_id || null, token: data.token || null,
      payment_status: status, amount_gross: data.amount_gross || null, amount_fee: data.amount_fee || null, amount_net: data.amount_net || null, raw: data,
      applies_until: appliesUntil,
    });
    let duplicate = false;
    if (Array.isArray(inserted) && inserted.length === 0) {
      // PayFast sent this payment before. If the first attempt died before the member was updated, finish the job now.
      duplicate = true;
      const existing = data.pf_payment_id ? await db.getPaymentByPfId(data.pf_payment_id) : null;
      if (!existing || !existing.applies_until) return { status: 200, reason: "duplicate notification" };
      appliesUntil = new Date(existing.applies_until).toISOString();
      if (prev >= Date.parse(appliesUntil)) return { status: 200, reason: "duplicate notification" };
    }
    await db.updateMember(userId, {
      status: "active", payfast_token: data.token || (member && member.payfast_token) || null,
      paid_through: new Date(Math.max(prev, Date.parse(appliesUntil))).toISOString(), cancel_requested_at: null,
      subscription_amount: expected.toFixed(2),
    });
    if (checkout) await db.updateCheckout(data.m_payment_id, { status: "complete" });
    return { status: 200, reason: duplicate ? "membership active (completed on retry)" : "membership active" };
  }
  if (status === "CANCELLED") {
    await db.updateMember(userId, { status: "cancelled" });
    if (checkout) await db.updateCheckout(data.m_payment_id, { status: "cancelled" });
    return { status: 200, reason: "membership cancelled (access until paid period ends)" };
  }
  log.warn(`[payfast] ITN status ${status} for ${userId}`);
  return { status: 200, reason: `status ${status} recorded` };
}
