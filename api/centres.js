// GET /api/centres → centre list, only for members with access (trial or paid)
import { allow, send } from "./_lib/http.js";
import { cfg } from "./_lib/env.js";
import { requireMember } from "./_lib/auth.js";
import { entitlement } from "./_lib/entitlement.js";
import { REGIONS, CENTRES } from "./_lib/centres-data.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET"])) return;
  try {
    const ctx = await requireMember(req, res); if (!ctx) return;
    if (!entitlement(ctx.member, { graceDays: cfg().graceDays }).access) return send(res, 402, { error: "subscription_required" });
    send(res, 200, { regions: REGIONS, centres: CENTRES });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
