// POST /api/admin/users/reset-password {user_id} → a temporary password, returned ONCE to the admin.
// It is never stored, never logged, never written to admin_audit and never included in an error message.
import { allow, readJson, send, isUuid } from "../../_lib/http.js";
import { requireAdmin } from "../../_lib/auth.js";
import { db, authAdminApi, ensureMember } from "../../_lib/supabase.js";
import { generatePassword } from "../../_lib/passwords.js";
import { limitAdmin } from "../../_lib/ratelimit.js";

const PASSWORD_LENGTH = 14;

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  try {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    if (!limitAdmin(req, res, ctx, "password_reset", { limit: 10, windowMs: 15 * 60 * 1000 })) return;

    const body = await readJson(req);
    const userId = String(body.user_id || "").trim();
    if (!isUuid(userId)) return send(res, 404, { error: "user_not_found" });

    const user = await authAdminApi.getUser(userId);
    if (!user) return send(res, 404, { error: "user_not_found" });

    /* ORDER MATTERS: flag first, then the password. If the password call fails the flag stays set,
       which is harmless (the member is asked to change a password they cannot use yet). */
    if (!(await db.getMember(userId))) await ensureMember({ id: userId, email: user.email }, db);
    await db.updateMember(userId, { must_change_password: true });

    const temporaryPassword = generatePassword(PASSWORD_LENGTH);
    try {
      await authAdminApi.updateUserPassword(userId, temporaryPassword);
    } catch (e) {
      /* e.message is built by supabase.js with the password redacted; never log the request body. */
      console.error("[admin] password reset failed", e.status || "", e.message);
      return send(res, 502, { error: "password_reset_failed" });
    }

    /* Best-effort audit; no password, ever. If this write fails we still return the password,
       because this is the only time the admin will ever see it. */
    try {
      await db.insertAudit({ admin_user_id: ctx.user.id, action: "user.password_reset", target_user_id: userId, detail: { email: user.email } });
    } catch (e) { console.error("[admin] audit write failed", e.status || ""); }

    /* Supabase Auth revokes all of that user's refresh tokens when an admin sets a password
       (GoTrue UpdatePassword(tx, nil) → Logout(user)), so their other sessions cannot continue.
       Access tokens already issued stay valid until they expire; must_change_password keeps those
       from doing anything, because every route except /api/me and /api/account/password refuses them. */
    send(res, 200, { email: user.email, temporary_password: temporaryPassword });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
