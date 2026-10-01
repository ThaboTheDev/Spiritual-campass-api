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

async function rest(path, { method = "GET", body, prefer } = {}) {
  const c = cfg();
  const headers = { apikey: c.supabaseService, Authorization: `Bearer ${c.supabaseService}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) { const e = new Error(`Supabase ${method} ${path} failed: ${r.status} ${text}`); e.status = 502; throw e; }
  return text ? JSON.parse(text) : null;
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
  async insertCheckout(row) { return rest("checkouts", { method: "POST", body: row, prefer: "return=minimal" }); },
  async getCheckout(id) { return (await rest(`checkouts?m_payment_id=eq.${q(id)}&select=*`))[0] || null; },
  async updateCheckout(id, patch) { return rest(`checkouts?m_payment_id=eq.${q(id)}`, { method: "PATCH", body: patch, prefer: "return=minimal" }); },
  /* returns [] when this pf_payment_id was already recorded (PayFast can send the same ITN more than once) */
  async getPaymentByPfId(id) { return (await rest(`payments?pf_payment_id=eq.${q(id)}&select=*`))[0] || null; },
  async insertPayment(row) { return rest("payments?on_conflict=pf_payment_id", { method: "POST", body: row, prefer: "resolution=ignore-duplicates,return=representation" }); },
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
