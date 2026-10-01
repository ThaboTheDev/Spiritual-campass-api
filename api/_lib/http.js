// Small helpers for Vercel Node.js functions (no dependencies).
export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}
export function allow(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader("Allow", methods.join(", "));
  send(res, 405, { error: "method_not_allowed" });
  return false;
}
/* Raw request body. Read the stream first (keeps PayFast's field order exactly as sent);
   fall back to an already-parsed body if the platform consumed the stream. */
export async function readRaw(req) {
  if (typeof req.rawBody === "string") return req.rawBody;
  const chunks = [];
  try { for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c); } catch (e) { /* stream already consumed */ }
  if (chunks.length) return Buffer.concat(chunks).toString("utf8");
  const b = req.body;
  if (b == null) return "";
  if (typeof b === "string") return b;
  if (Buffer.isBuffer(b)) return b.toString("utf8");
  if (typeof b === "object") return new URLSearchParams(b).toString();
  return "";
}
export async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { const e = new Error("invalid_json"); e.status = 400; throw e; }
}
/* Query string parameter, without depending on a framework parsing req.url. */
export function queryParam(req, name) {
  const raw = String(req.url || "");
  const i = raw.indexOf("?");
  if (i < 0) return null;
  try { return new URLSearchParams(raw.slice(i + 1)).get(name); } catch { return null; }
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID_RE.test(String(v || "").trim());
export function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers["authorization"] || "");
  return m ? m[1].trim() : null;
}
export function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "";
}
