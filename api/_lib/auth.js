import { bearer, send } from "./http.js";
import { getUser, ensureMember, db } from "./supabase.js";
/* Returns { user, member } or sends 401 and returns null. */
export async function requireMember(req, res) {
  const user = await getUser(bearer(req));
  if (!user) { send(res, 401, { error: "sign_in_required" }); return null; }
  const member = await ensureMember(user, db);
  return { user, member };
}
