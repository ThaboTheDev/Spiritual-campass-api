// GET /api/centres → centre list, only for members with access (trial or paid).
// Centres live in the database (public.regions / public.centres; seeded by supabase/seed-centres.sql).
import crypto from "node:crypto";
import { allow, send } from "./_lib/http.js";
import { cfg } from "./_lib/env.js";
import { requireMember } from "./_lib/auth.js";
import { entitlement } from "./_lib/entitlement.js";
import { db } from "./_lib/supabase.js";
import { centreOut } from "./_lib/centre-validation.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET"])) return;
  try {
    const ctx = await requireMember(req, res); if (!ctx) return;
    if (!entitlement(ctx.member, { graceDays: cfg().graceDays }).access) return send(res, 402, { error: "subscription_required" });

    const [regions, rows] = await Promise.all([db.listRegions(), db.listCentres()]);
    const order = new Map(regions.map((r, i) => [r.name, i]));
    const centres = rows
      .slice()
      .sort((a, b) => ((order.get(a.region) ?? 999) - (order.get(b.region) ?? 999)) || ((a.sort_order || 0) - (b.sort_order || 0)) || String(a.name).localeCompare(String(b.name)))
      .map(centreOut);
    const body = { regions: regions.map((r) => r.name), centres };

    /* ETag so clients can revalidate cheaply instead of re-downloading the list. */
    const etag = `"${crypto.createHash("sha1").update(JSON.stringify(body)).digest("hex")}"`;
    if (req.headers["if-none-match"] === etag) return send(res, 304, {}, { ETag: etag, "Cache-Control": "private, no-cache" });
    send(res, 200, body, { ETag: etag, "Cache-Control": "private, no-cache" });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
