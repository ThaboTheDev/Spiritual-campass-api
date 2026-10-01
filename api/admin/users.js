// GET /api/admin/users?q=<text> → email search for the admin screen, at most 20 users.
import { allow, queryParam, send } from "../_lib/http.js";
import { cfg } from "../_lib/env.js";
import { requireAdmin } from "../_lib/auth.js";
import { db, authAdminApi } from "../_lib/supabase.js";
import { entitlement } from "../_lib/entitlement.js";
import { limitAdmin } from "../_lib/ratelimit.js";

export const MAX_USERS = 20;
export const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

/* Accounts that signed up but never opened the app have no members row, so the auth user list is
   searched as well. Current GoTrue supports ?filter= (substring on email); we re-check every row
   locally. If an older Auth version ignores ?filter= we try the next pages, up to 3, and stop as
   soon as the server clearly applied the filter (fewer than a full page of users). */
async function searchAuthUsers(needle, want) {
  const found = [];
  for (let page = 1; page <= 3; page++) {
    const list = await authAdminApi.listUsers({ page, perPage: want, filter: needle });
    const matches = list.filter((u) => u && u.email && String(u.email).toLowerCase().includes(needle.toLowerCase()));
    found.push(...matches);
    if (matches.length >= want || list.length < want) break;
  }
  return found.slice(0, want);
}

export default async function handler(req, res) {
  if (!allow(req, res, ["GET"])) return;
  try {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    if (!limitAdmin(req, res, ctx, "users_search", { limit: 60, windowMs: 15 * 60 * 1000 })) return;

    const q = String(queryParam(req, "q") || "").trim().slice(0, 100);
    if (!q) return send(res, 200, { users: [] });

    const graceDays = cfg().graceDays;
    const byId = new Map();
    for (const m of await db.searchMembers(`*${escapeLike(q)}*`, MAX_USERS)) {
      byId.set(m.user_id, {
        user_id: m.user_id, email: m.email || "", status: m.status || "none",
        state: entitlement(m, { graceDays }).state, created_at: m.created_at || null,
      });
    }
    try {
      for (const u of await searchAuthUsers(q, MAX_USERS)) {
        if (byId.has(u.id)) continue;
        byId.set(u.id, { user_id: u.id, email: u.email, status: "none", state: "none", created_at: u.created_at || null });
      }
    } catch (e) {
      console.error("[admin] auth user search failed", e.status || "");   // members results are still returned
    }

    const users = [...byId.values()]
      .filter((u) => u.email && u.email.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || a.email.localeCompare(b.email))
      .slice(0, MAX_USERS);
    send(res, 200, { users });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
