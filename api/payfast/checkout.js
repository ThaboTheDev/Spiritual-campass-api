// POST /api/payfast/checkout → signed PayFast form for R100/month (browser auto-submits it)
import crypto from "node:crypto";
import { allow, send } from "../_lib/http.js";
import { cfg } from "../_lib/env.js";
import { requireMember } from "../_lib/auth.js";
import { db } from "../_lib/supabase.js";
import { entitlement } from "../_lib/entitlement.js";
import { buildSubscriptionCheckout } from "../_lib/payfast.js";

const todaySAST = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  try {
    const ctx = await requireMember(req, res); if (!ctx) return;
    const c = cfg();
    const ent = entitlement(ctx.member, { graceDays: c.graceDays });
    if (ent.state === "active") return send(res, 409, { error: "already_subscribed" });
    const mPaymentId = crypto.randomUUID();
    await db.insertCheckout({ m_payment_id: mPaymentId, user_id: ctx.user.id, amount: c.amount, status: "pending" });
    send(res, 200, buildSubscriptionCheckout({ c, email: ctx.user.email, mPaymentId, today: todaySAST() }));
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
