// Supabase access over plain HTTPS (Auth + PostgREST). Server-side only: uses the service role key.
import { cfg } from "./env.js";

export async function getUser(accessToken) {
  if (!accessToken) return null;
  const c = cfg();
  const r = await fetch(`${c.supabaseUrl}/auth/v1/user`, { headers: { apikey: c.supabaseAnon, Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

async function restRaw(path, { method = "GET", body, prefer } = {}) {
  const c = cfg();
  const headers = { apikey: c.supabaseService, Authorization: `Bearer ${c.supabaseService}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* not JSON (e.g. an error page) */ }
  return { ok: r.ok, status: r.status, data, text };
}
async function rest(path, opts) {
  const r = await restRaw(path, opts);
  if (!r.ok) { const e = new Error(`Supabase ${opts?.method || "GET"} ${path} failed: ${r.status} ${r.text}`); e.status = 502; throw e; }
  return r.data;
}
const q = (v) => encodeURIComponent(v);

export const db = {
  async getMember(userId) { return (await rest(`members?user_id=eq.${q(userId)}&select=*`))[0] || null; },
  async getMemberByToken(token) { return (await rest(`members?payfast_token=eq.${q(token)}&select=*`))[0] || null; },
  async insertMember(row) { return rest("members?on_conflict=user_id", { method: "POST", body: row, prefer: "resolution=ignore-duplicates,return=representation" }); },
  async updateMember(userId, patch) {
    const rows = await rest(`members?user_id=eq.${q(userId)}`, { method: "PATCH", body: { ...patch, updated_at: new Date().toISOString() }, prefer: "return=representation" });
    return rows[0] || null;
  },
  /* Admin search: case-insensitive email match, newest first. `pattern` is already LIKE-escaped. */
  async searchMembers(pattern, limit = 20) {
    return rest(`members?select=*&email=ilike.${q(pattern)}&order=created_at.desc&limit=${Number(limit)}`);
  },
  async insertCheckout(row) { return rest("checkouts", { method: "POST", body: row, prefer: "return=minimal" }); },
  async getCheckout(id) { return (await rest(`checkouts?m_payment_id=eq.${q(id)}&select=*`))[0] || null; },
  async updateCheckout(id, patch) { return rest(`checkouts?m_payment_id=eq.${q(id)}`, { method: "PATCH", body: patch, prefer: "return=minimal" }); },
  /* returns [] when this pf_payment_id was already recorded (PayFast can send the same ITN more than once) */
  async getPaymentByPfId(id) { return (await rest(`payments?pf_payment_id=eq.${q(id)}&select=*`))[0] || null; },
  async insertPayment(row) { return rest("payments?on_conflict=pf_payment_id", { method: "POST", body: row, prefer: "resolution=ignore-duplicates,return=representation" }); },

  /* Centres live in the database now (seeded from supabase/seed-centres.sql). */
  async listRegions() { return rest("regions?select=name,sort_order&order=sort_order.asc"); },
  async listCentres() { return rest("centres?select=id,region,name,address,phone,lat,lng,sort_order&order=sort_order.asc"); },
  async regionExists(name) { return (await rest(`regions?name=eq.${q(name)}&select=name`)).length > 0; },
  async findCentre(region, name) { return (await rest(`centres?region=eq.${q(region)}&name=eq.${q(name)}&select=id,name`))[0] || null; },
  async nextCentreOrder(region) {
    const rows = await rest(`centres?region=eq.${q(region)}&select=sort_order&order=sort_order.desc&limit=1`);
    return rows.length ? Number(rows[0].sort_order || 0) + 1 : 1;
  },
  async insertCentre(row) {
    const r = await restRaw("centres?select=id,region,name,address,phone,lat,lng,created_at", { method: "POST", body: row, prefer: "return=representation" });
    if (r.status === 409) { const e = new Error("duplicate_centre"); e.status = 409; throw e; }
    if (!r.ok) { const e = new Error(`Supabase POST centres failed: ${r.status}`); e.status = 502; throw e; }
    return r.data[0];
  },
  async insertAudit(row) { return rest("admin_audit", { method: "POST", body: row, prefer: "return=minimal" }); },
};

/* ---- Supabase Auth Admin API (service role). Never log bodies: one of them carries a password. ---- */
async function authAdmin(path, { method = "GET", body } = {}) {
  const c = cfg();
  const r = await fetch(`${c.supabaseUrl}/auth/v1${path}`, {
    method,
    headers: { apikey: c.supabaseService, Authorization: `Bearer ${c.supabaseService}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  return { ok: r.ok, status: r.status, data, text };
}

export const authAdminApi = {
  /* Sets any user's password. GoTrue revokes all of that user's refresh tokens on a password change
     (UpdatePassword(tx, nil) → Logout(user)), so old sessions stop working; access tokens stay valid
     until they expire, which is why must_change_password is enforced on every API call as well. */
  async updateUserPassword(userId, password) {
    const r = await authAdmin(`/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body: { password } });
    if (!r.ok) {
      const safe = String(r.text || "").split(String(password)).join("[redacted]");
      const e = new Error(`Supabase admin password update failed: ${r.status} ${safe}`);
      e.status = 502;
      throw e;
    }
    return r.data;
  },
  async deleteUser(userId) {
    const r = await authAdmin(`/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    if (r.status === 404) return null;                 // already gone: deleting is idempotent
    if (!r.ok) { const e = new Error(`Supabase admin user delete failed: ${r.status} ${r.text}`); e.status = 502; throw e; }
    return r.data;
  },
  async getUser(userId) {
    const r = await authAdmin(`/admin/users/${encodeURIComponent(userId)}`);
    if (r.status === 404) return null;
    if (!r.ok) { const e = new Error(`Supabase admin user lookup failed: ${r.status}`); e.status = 502; throw e; }
    return r.data;
  },
  /* GET /admin/users supports page, per_page and (current GoTrue) filter= a case-insensitive
     substring of the email. We filter locally as well, so an older Auth version that ignores
     `filter` can never make the admin search return someone who does not match. */
  async listUsers({ page = 1, perPage = 20, filter } = {}) {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (filter) params.set("filter", filter);
    const r = await authAdmin(`/admin/users?${params}`);
    if (!r.ok) { const e = new Error(`Supabase admin user list failed: ${r.status}`); e.status = 502; throw e; }
    return Array.isArray(r.data?.users) ? r.data.users : [];
  },
};

/* First visit after sign-up creates the member row and starts the free trial. */
export async function ensureMember(user, database = db, now = new Date()) {
  let m = await database.getMember(user.id);
  if (m) return m;
  const c = cfg();
  await database.insertMember({
    user_id: user.id, email: user.email || null, status: "trialing",
    trial_ends_at: new Date(now.getTime() + c.trialDays * 86400000).toISOString(),
  });
  return database.getMember(user.id);
}
