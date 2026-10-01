// Test helpers: in-memory Supabase (Auth + the PostgREST calls we use), fake PayFast, fake req/res.
import { Readable } from "node:stream";

export function setEnv(extra = {}) {
  Object.assign(process.env, {
    SITE_URL: "https://compass.example.org", SUPABASE_URL: "https://sb.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
    PAYFAST_MERCHANT_ID: "10000100", PAYFAST_MERCHANT_KEY: "46f0cd694581a", PAYFAST_PASSPHRASE: "jt7NOE43FZPn", PAYFAST_SANDBOX: "true",
    PAYFAST_ENFORCE_IP: "false", SUBSCRIPTION_AMOUNT: "100", TRIAL_DAYS: "7", GRACE_DAYS: "3", ...extra,
  });
}

export function memoryDb() {
  const t = { members: [], checkouts: [], payments: [] };
  return {
    t,
    async getMember(id) { return t.members.find((r) => r.user_id === id) || null; },
    async getMemberByToken(tok) { return t.members.find((r) => r.payfast_token === tok) || null; },
    async insertMember(row) { if (!t.members.find((r) => r.user_id === row.user_id)) t.members.push({ ...row }); return [row]; },
    async updateMember(id, patch) { const r = t.members.find((m) => m.user_id === id); if (r) Object.assign(r, patch); return r || null; },
    async insertCheckout(row) { t.checkouts.push({ ...row }); },
    async getCheckout(id) { return t.checkouts.find((r) => r.m_payment_id === id) || null; },
    async updateCheckout(id, patch) { const r = t.checkouts.find((c) => c.m_payment_id === id); if (r) Object.assign(r, patch); },
    async getPaymentByPfId(id) { return t.payments.find((p) => p.pf_payment_id === id) || null; },
    async insertPayment(row) { if (row.pf_payment_id && t.payments.find((p) => p.pf_payment_id === row.pf_payment_id)) return []; t.payments.push({ ...row }); return [row]; },
  };
}

/* global fetch stand-in routing Supabase REST/Auth to a memoryDb and PayFast to canned answers */
export function installFetch(mdb, { users = { "good-token": { id: "u1", email: "member@example.org" } }, validate = "VALID", cancelStatus = 200 } = {}) {
  const calls = [];
  const orig = globalThis.fetch;
  const json = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url); const method = (opts.method || "GET").toUpperCase(); calls.push({ url: u.toString(), method, headers: opts.headers || {}, body: opts.body });
    if (u.host === "sb.test" && u.pathname === "/auth/v1/user") {
      const tok = String((opts.headers || {}).Authorization || "").replace("Bearer ", "");
      return users[tok] ? json(200, users[tok]) : json(401, { msg: "invalid" });
    }
    if (u.host === "sb.test" && u.pathname.startsWith("/rest/v1/")) {
      const table = u.pathname.split("/").pop(); const rows = mdb.t[table];
      const filters = [...u.searchParams].filter(([k, v]) => v.startsWith("eq.")).map(([k, v]) => [k, decodeURIComponent(v.slice(3))]);
      const match = (r) => filters.every(([k, v]) => String(r[k]) === v);
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      if (method === "GET") return json(200, rows.filter(match));
      if (method === "POST") {
        const conflict = u.searchParams.get("on_conflict");
        if (conflict && body[conflict] && rows.find((r) => r[conflict] === body[conflict])) return json(201, []);
        rows.push({ ...body }); return json(201, [body]);
      }
      if (method === "PATCH") { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, body)); return json(200, hit); }
    }
    if (u.host === "sandbox.payfast.co.za" && u.pathname === "/eng/query/validate") return new Response(validate, { status: 200 });
    if (u.host === "api.payfast.co.za" && u.pathname.endsWith("/cancel")) return json(cancelStatus, { code: cancelStatus, status: cancelStatus === 200 ? "success" : "failed" });
    throw new Error("unexpected fetch " + u);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

export function fakeReq({ method = "GET", headers = {}, body = "" } = {}) {
  const r = Readable.from(body ? [Buffer.from(body)] : []);
  r.method = method; r.headers = headers; r.socket = { remoteAddress: "127.0.0.1" };
  return r;
}
export function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ""; this.done = true; } };
  res.json = () => JSON.parse(res.body || "null");
  return res;
}
