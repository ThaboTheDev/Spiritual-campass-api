/* Light in-memory rate limit for sensitive admin actions.
   Limits are per admin user id, per action. Vercel runs several function instances and recycles them,
   so this is a speed bump, not a hard quota: a determined admin can exceed it by hitting another
   instance. It is enough to stop a script (or a stuck client) hammering password resets or deletes. */
import { send } from "./http.js";

const buckets = new Map();

export function rateLimited(key, { limit, windowMs }, now = Date.now()) {
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) { b = { start: now, count: 0 }; buckets.set(key, b); }
  b.count += 1;
  const retryAfter = Math.max(1, Math.ceil((b.start + windowMs - now) / 1000));
  if (buckets.size > 500) for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
  return b.count > limit ? { ok: false, retryAfter } : { ok: true, retryAfter };
}

/* Returns true when the caller may continue; otherwise answers 429 with Retry-After. */
export function limitAdmin(req, res, ctx, action, { limit, windowMs }) {
  const r = rateLimited(`admin:${ctx.user.id}:${action}`, { limit, windowMs });
  if (r.ok) return true;
  send(res, 429, { error: "rate_limited" }, { "Retry-After": String(r.retryAfter) });
  return false;
}
