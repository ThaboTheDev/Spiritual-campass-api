// GET /api/me  → the signed-in member's access (starts the 7-day trial on first call)
import { allow, send } from "./_lib/http.js";
import { cfg } from "./_lib/env.js";
import { requireMember } from "./_lib/auth.js";
import { entitlement } from "./_lib/entitlement.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET"])) return;
  try {
    const ctx = await requireMember(req, res); if (!ctx) return;
    const c = cfg();
    send(res, 200, {
      email: ctx.user.email, status: ctx.member.status,
      ...entitlement(ctx.member, { graceDays: c.graceDays }),
      can_cancel: ctx.member.status === "active" && !!ctx.member.payfast_token,
      price: c.amount, currency: "ZAR", trial_days: c.trialDays,
    });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
