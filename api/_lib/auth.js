import { bearer, send } from "./http.js";
import { getUser, ensureMember, db } from "./supabase.js";

/* Returns { user, member } or sends 401/403 and returns null.
   - 401 when there is no valid access token.
   - 403 password_change_required while the member row has must_change_password, unless the route
     opts in with { allowPasswordChange: true } (only /api/me and /api/account/password do).
   Both flags are read from the database row every call: never from JWT claims or user_metadata,
   which a signed-in user can edit themselves. */
export async function requireMember(req, res, { allowPasswordChange = false } = {}) {
  const user = await getUser(bearer(req));
  if (!user) { send(res, 401, { error: "sign_in_required" }); return null; }
  const member = await ensureMember(user, db);
  if (member && member.must_change_password === true && !allowPasswordChange) {
    send(res, 403, { error: "password_change_required" });
    return null;
  }
  return { user, member };
}

/* Admin routes: requireMember first (so a forced password change still wins), then the is_admin flag
   from the database. Someone who is not flagged admin gets 403 admin_required — the /api/me UI check
   is only a convenience. */
export async function requireAdmin(req, res, opts = {}) {
  const ctx = await requireMember(req, res, opts);
  if (!ctx) return null;
  if (!ctx.member || ctx.member.is_admin !== true) { send(res, 403, { error: "admin_required" }); return null; }
  return ctx;
}
