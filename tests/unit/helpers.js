// Test helpers: in-memory Supabase (Auth + PostgREST + Auth Admin API), fake PayFast, fake req/res.
import { Readable } from "node:stream";

export function setEnv(extra = {}) {
  Object.assign(process.env, {
    SITE_URL: "https://compass.example.org", SUPABASE_URL: "https://sb.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
    PAYFAST_MERCHANT_ID: "10000100", PAYFAST_MERCHANT_KEY: "46f0cd694581a", PAYFAST_PASSPHRASE: "jt7NOE43FZPn", PAYFAST_SANDBOX: "true",
    PAYFAST_ENFORCE_IP: "false", SUBSCRIPTION_AMOUNT: "100", TRIAL_DAYS: "7", GRACE_DAYS: "3", ...extra,
  });
}

function likeMatch(pattern, value) {
  const p = String(pattern).replace(/^\*/, "").replace(/\*$/, "").replace(/\\([\\%_])/g, "$1");
  return String(value || "").toLowerCase().includes(p.toLowerCase());
}

export function memoryDb() {
  const t = {
    members: [], checkouts: [], payments: [], regions: [], centres: [], admin_audit: [],
    authUsers: [], sessions: [], events: [],          // events: ordered record used to assert "cancel before delete" etc.
  };
  return {
    t,
    async getMember(id) { return t.members.find((r) => r.user_id === id) || null; },
    async getMemberByToken(tok) { return t.members.find((r) => r.payfast_token === tok) || null; },
    async insertMember(row) { if (!t.members.find((r) => r.user_id === row.user_id)) t.members.push({ ...row }); return [row]; },
    async updateMember(id, patch) { const r = t.members.find((m) => m.user_id === id); if (r) Object.assign(r, patch); return r || null; },
    async searchMembers(pattern, limit = 20) {
      return t.members.filter((m) => likeMatch(pattern, m.email)).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, limit);
    },
    async insertCheckout(row) { t.checkouts.push({ ...row }); },
    async getCheckout(id) { return t.checkouts.find((r) => r.m_payment_id === id) || null; },
    async updateCheckout(id, patch) { const r = t.checkouts.find((c) => c.m_payment_id === id); if (r) Object.assign(r, patch); },
    async getPaymentByPfId(id) { return t.payments.find((p) => p.pf_payment_id === id) || null; },
    async insertPayment(row) { if (row.pf_payment_id && t.payments.find((p) => p.pf_payment_id === row.pf_payment_id)) return []; t.payments.push({ ...row }); return [row]; },

    async listRegions() { return [...t.regions].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)); },
    async listCentres() { return [...t.centres]; },
    async regionExists(name) { return t.regions.some((r) => r.name === name); },
    async findCentre(region, name) { return t.centres.find((c) => c.region === region && c.name === name) || null; },
    async nextCentreOrder(region) {
      const rows = t.centres.filter((c) => c.region === region);
      return rows.length ? Math.max(...rows.map((c) => Number(c.sort_order || 0))) + 1 : 1;
    },
    async insertCentre(row) {
      if (t.centres.some((c) => c.region === row.region && c.name === row.name)) { const e = new Error("duplicate_centre"); e.status = 409; throw e; }
      const inserted = { id: `centre-${t.centres.length + 1}`, created_at: new Date().toISOString(), ...row };
      t.centres.push(inserted); return inserted;
    },
    async insertAudit(row) { t.admin_audit.push({ created_at: new Date().toISOString(), ...row }); return null; },
  };
}

/* Seeds the tables the centres tests expect: 15 regions, 88 centres (same shape as supabase/seed-centres.sql). */
export async function seedCentres(db) {
  const { REGIONS, CENTRES } = await import("../../api/_lib/centres-data.js");
  db.t.regions = REGIONS.map((name, i) => ({ name, sort_order: i + 1 }));
  db.t.centres = CENTRES.map((c, i) => ({
    id: `c${i + 1}`, region: c.r, name: c.n, address: c.a || null, phone: c.p || null, lat: c.la, lng: c.lo,
    sort_order: CENTRES.filter((x) => x.r === c.r).indexOf(c) + 1,
  }));
  return db;
}

/* global fetch stand-in routing Supabase REST/Auth to a memoryDb and PayFast to canned answers */
export function installFetch(mdb, { users = { "good-token": { id: "u1", email: "member@example.org" } }, validate = "VALID", cancelStatus = 200, cancelBody = null, adminUserListFilter = true, adminPasswordStatus = 200 } = {}) {
  const calls = [];
  const orig = globalThis.fetch;
  const json = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const filtersOf = (u) => [...u.searchParams].filter(([k, v]) => v.startsWith("eq.") || v.startsWith("ilike.")).map(([k, v]) => [k, v]);
  const match = (r, filters) => filters.every(([k, v]) => (v.startsWith("eq.") ? String(r[k]) === decodeURIComponent(v.slice(3)) : likeMatch(decodeURIComponent(v.slice(6)), r[k])));
  const applyOrder = (rows, order) => {
    if (!order) return rows;
    const [col, dir = "asc"] = String(order).split(".");
    return [...rows].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (dir === "desc" ? -1 : 1));
  };
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url); const method = (opts.method || "GET").toUpperCase(); calls.push({ url: u.toString(), method, headers: opts.headers || {}, body: opts.body });
    let body; try { body = opts.body ? JSON.parse(opts.body) : undefined; } catch { body = undefined; }   // PayFast posts form-encoded, not JSON

    if (u.host === "sb.test" && u.pathname === "/auth/v1/user") {
      const tok = String((opts.headers || {}).Authorization || "").replace("Bearer ", "");
      const user = users[tok];
      if (!user) return json(401, { msg: "invalid" });
      if (!mdb.t.authUsers.find((x) => x.id === user.id)) mdb.t.authUsers.push({ created_at: new Date().toISOString(), ...user });   // like a real signup row
      return json(200, user);
    }
    /* ---- Supabase Auth Admin API (service role) ---- */
    if (u.host === "sb.test" && u.pathname.startsWith("/auth/v1/admin/users")) {
      const rest = u.pathname.slice("/auth/v1/admin/users".length).replace(/^\//, "");
      if (!rest && method === "GET") {
        const page = Number(u.searchParams.get("page") || 1), perPage = Number(u.searchParams.get("per_page") || 50);
        const filter = u.searchParams.get("filter");
        let list = [...mdb.t.authUsers].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
        if (filter && adminUserListFilter) list = list.filter((x) => String(x.email || "").toLowerCase().includes(String(filter).toLowerCase()));
        return json(200, { users: list.slice((page - 1) * perPage, page * perPage), aud: "authenticated" });
      }
      const id = decodeURIComponent(rest);
      const i = mdb.t.authUsers.findIndex((x) => x.id === id);
      if (method === "GET") return i < 0 ? json(404, { msg: "not found" }) : json(200, mdb.t.authUsers[i]);
      if (method === "PUT") {
        if (i < 0) return json(404, { msg: "not found" });
        if (adminPasswordStatus !== 200) return json(adminPasswordStatus, { code: 422, msg: "Password is too weak or something else failed" });
        /* Record WHEN the password was set, so tests can prove must_change_password was set first. */
        const member = mdb.t.members.find((m) => m.user_id === id);
        mdb.t.events.push({ type: "password_set", must_change_password: !!(member && member.must_change_password), password: body && body.password });
        mdb.t.authUsers[i].password = body && body.password;
        mdb.t.sessions = mdb.t.sessions.filter((s) => s.user_id !== id);          // GoTrue revokes all sessions
        return json(200, { id, email: mdb.t.authUsers[i].email });
      }
      if (method === "DELETE") {
        if (i < 0) return json(404, { msg: "not found" });
        mdb.t.events.push({ type: "auth_delete", user_id: id });
        mdb.t.authUsers.splice(i, 1);
        mdb.t.members = mdb.t.members.filter((m) => m.user_id !== id);             // on delete cascade
        mdb.t.checkouts = mdb.t.checkouts.filter((c) => c.user_id !== id);         // on delete cascade
        mdb.t.payments.forEach((p) => { if (p.user_id === id) p.user_id = null; }); // on delete set null
        return json(200, {});
      }
      return json(405, { msg: "method not allowed" });
    }
    if (u.host === "sb.test" && u.pathname.startsWith("/rest/v1/")) {
      const table = u.pathname.split("/").pop(); const rows = mdb.t[table] || [];
      const filters = filtersOf(u);
      const limit = Number(u.searchParams.get("limit") || 0);
      if (method === "GET") {
        let out = applyOrder(rows.filter((r) => match(r, filters)), u.searchParams.get("order"));
        if (limit) out = out.slice(0, limit);
        return json(200, out);
      }
      if (method === "POST") {
        const conflict = u.searchParams.get("on_conflict");
        if (conflict && body[conflict] && rows.find((r) => r[conflict] === body[conflict])) return json(201, []);
        if (table === "centres" && rows.find((r) => r.region === body.region && r.name === body.name)) return json(409, { message: "duplicate key value violates unique constraint" });
        const row = { created_at: new Date().toISOString(), ...body };
        if (table === "centres" && !row.id) row.id = `centre-${rows.length + 1}`;
        rows.push(row);
        return String((opts.headers || {}).Prefer || "").includes("return=minimal") ? json(201, "") : json(201, [row]);
      }
      if (method === "PATCH") { const hit = rows.filter((r) => match(r, filters)); hit.forEach((r) => Object.assign(r, body)); return json(200, hit); }
    }
    if (u.host === "sandbox.payfast.co.za" && u.pathname === "/eng/query/validate") return new Response(validate, { status: 200 });
    if (u.host === "api.payfast.co.za" && u.pathname.endsWith("/cancel")) {
      mdb.t.events.push({ type: "payfast_cancel", token: u.pathname.split("/")[2] });   // /subscriptions/<token>/cancel
      return json(cancelStatus, cancelBody || { code: cancelStatus, status: cancelStatus === 200 ? "success" : "failed" });
    }
    throw new Error("unexpected fetch " + u);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

export function fakeReq({ method = "GET", headers = {}, body = "", url = "/" } = {}) {
  const r = Readable.from(body ? [Buffer.from(body)] : []);
  r.method = method; r.headers = headers; r.socket = { remoteAddress: "127.0.0.1" }; r.url = url;
  return r;
}
export function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ""; this.done = true; } };
  res.json = () => JSON.parse(res.body || "null");
  return res;
}
