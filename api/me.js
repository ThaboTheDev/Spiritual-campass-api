// GET /api/me  → the signed-in member's access (starts the 7-day trial on first call)
// Works while must_change_password is true (the client needs it to know it must show the change screen).
import { allow, send } from "./_lib/http.js";
import { cfg } from "./_lib/env.js";
import { requireMember } from "./_lib/auth.js";
import { entitlement } from "./_lib/entitlement.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET"])) return;
  try {
    const ctx = await requireMember(req, res, { allowPasswordChange: true }); if (!ctx) return;
    const c = cfg();
    send(res, 200, {
      email: ctx.user.email, status: ctx.member.status,
      ...entitlement(ctx.member, { graceDays: c.graceDays }),
      can_cancel: ctx.member.status === "active" && !!ctx.member.payfast_token,
      price: c.amount, currency: "ZAR", trial_days: c.trialDays,
      /* flags are read from the members row, never from the token or user_metadata */
      is_admin: ctx.member.is_admin === true,
      must_change_password: ctx.member.must_change_password === true,
      /* additive: lets the web app show the trial page once, right after the account is created */
      created_at: ctx.member.created_at || null,
    });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
