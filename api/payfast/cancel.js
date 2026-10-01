// POST /api/payfast/cancel → stop future monthly charges; access continues until the paid month ends
import { allow, send } from "../_lib/http.js";
import { cfg } from "../_lib/env.js";
import { requireMember } from "../_lib/auth.js";
import { db } from "../_lib/supabase.js";
import { entitlement } from "../_lib/entitlement.js";
import { subscriptionAction } from "../_lib/payfast.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  try {
    const ctx = await requireMember(req, res); if (!ctx) return;
    const c = cfg();
    if (!ctx.member.payfast_token || ctx.member.status !== "active") return send(res, 400, { error: "no_active_subscription" });
    const r = await subscriptionAction(c, ctx.member.payfast_token, "cancel");
    if (!r.ok) { console.error("[payfast] cancel failed", r.status, r.data); return send(res, 502, { error: "payfast_cancel_failed", detail: r.data }); }
    const m = await db.updateMember(ctx.user.id, { status: "cancelled", cancel_requested_at: new Date().toISOString() });
    send(res, 200, { ok: true, ...entitlement(m, { graceDays: c.graceDays }) });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
