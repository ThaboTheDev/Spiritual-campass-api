// POST /api/admin/users/delete {user_id} → cancel any live PayFast subscription, then delete the auth user.
// members and checkouts cascade; payments keep their rows with user_id set to null (financial records).
import { allow, readJson, send, isUuid } from "../../_lib/http.js";
import { cfg } from "../../_lib/env.js";
import { requireAdmin } from "../../_lib/auth.js";
import { db, authAdminApi } from "../../_lib/supabase.js";
import { subscriptionAction } from "../../_lib/payfast.js";
import { limitAdmin } from "../../_lib/ratelimit.js";

/* PayFast answers a cancel for an already-cancelled subscription with a 4xx and a message; treat that
   as success (there is nothing left to charge), but a genuine failure (network, 5xx, signature) aborts. */
export function alreadyCancelled(r) {
  if (r.status === 404) return true;
  const d = r.data || {};
  /* Only the human-readable message, never the envelope (a generic "status":"failed" says nothing). */
  const msg = String((d.data && d.data.message) || d.message || "").toLowerCase();
  /* A failure that merely mentions cancelling ("could not be cancelled") must NOT be read as success. */
  if (/cannot|could not|can't|unable|fail|invalid|error|declin|refus|unavailable/.test(msg)) return false;
  return /already\s*(been\s*)?cancel|not\s*active|no\s*active|not\s*found|does\s*not\s*exist|has\s*been\s*cancel/.test(msg);
}

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  try {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    if (!limitAdmin(req, res, ctx, "user_delete", { limit: 5, windowMs: 15 * 60 * 1000 })) return;

    const body = await readJson(req);
    const userId = String(body.user_id || "").trim();
    if (!isUuid(userId)) return send(res, 404, { error: "user_not_found" });
    if (userId === ctx.user.id) return send(res, 409, { error: "cannot_delete_self" });

    const user = await authAdminApi.getUser(userId);
    if (!user) return send(res, 404, { error: "user_not_found" });
    const member = await db.getMember(userId);

    /* Stop the money first: if PayFast refuses, nothing is deleted and the admin can retry. */
    let subscriptionCancelled = false;
    if (member && member.payfast_token && member.status === "active") {
      const r = await subscriptionAction(cfg(), member.payfast_token, "cancel");
      if (!r.ok && !alreadyCancelled(r)) {
        console.error("[payfast] cancel before delete failed", r.status);
        return send(res, 502, { error: "payfast_cancel_failed" });   // nothing deleted
      }
      subscriptionCancelled = true;
    }

    await authAdminApi.deleteUser(userId);   // 404 is treated as already deleted

    /* Best-effort audit: the user is already deleted, so a logging hiccup must not fail the request. */
    try {
      await db.insertAudit({
        admin_user_id: ctx.user.id, action: "user.delete", target_user_id: userId,
        detail: { email: user.email || null, subscription_cancelled: subscriptionCancelled },
      });
    } catch (e) { console.error("[admin] audit write failed", e.status || ""); }

    send(res, 200, { ok: true, subscription_cancelled: subscriptionCancelled });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
