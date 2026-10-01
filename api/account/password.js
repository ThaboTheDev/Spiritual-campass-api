// POST /api/account/password {new_password} → the member sets their own password.
// Used by the forced change screen (must_change_password) and nowhere else; the client signs in again
// afterwards, because changing a password revokes that user's existing sessions in Supabase Auth.
import { allow, readJson, send } from "../_lib/http.js";
import { requireMember } from "../_lib/auth.js";
import { db, authAdminApi } from "../_lib/supabase.js";

export const MIN_PASSWORD = 8;

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  try {
    const ctx = await requireMember(req, res, { allowPasswordChange: true }); if (!ctx) return;
    const body = await readJson(req);
    const password = typeof body.new_password === "string" ? body.new_password : "";
    if (password.length < MIN_PASSWORD) return send(res, 400, { error: "weak_password" });

    /* Admin API instead of PUT /auth/v1/user: the member's own endpoint refuses to change a password
       on a session that has not reauthenticated recently ("Secure password change"). */
    await authAdminApi.updateUserPassword(ctx.user.id, password);
    await db.updateMember(ctx.user.id, { must_change_password: false });
    send(res, 200, { ok: true });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
