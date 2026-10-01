// POST /api/admin/centres {region,name,address,phone,lat,lng} → add one centre to the database.
import { allow, readJson, send } from "../_lib/http.js";
import { requireAdmin } from "../_lib/auth.js";
import { db } from "../_lib/supabase.js";
import { validateCentre, centreOut } from "../_lib/centre-validation.js";
import { limitAdmin } from "../_lib/ratelimit.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  try {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    if (!limitAdmin(req, res, ctx, "centre_add", { limit: 30, windowMs: 15 * 60 * 1000 })) return;

    const body = await readJson(req);
    const regions = (await db.listRegions()).map((r) => r.name);
    const { fields, centre } = validateCentre(body, regions);
    if (fields.length) return send(res, 400, { error: "invalid_centre", fields });

    if (await db.findCentre(centre.region, centre.name)) return send(res, 409, { error: "duplicate_centre" });

    let created;
    try {
      created = await db.insertCentre({
        region: centre.region, name: centre.name, address: centre.address, phone: centre.phone,
        lat: centre.lat, lng: centre.lng, sort_order: await db.nextCentreOrder(centre.region), created_by: ctx.user.id,
      });
    } catch (e) {
      if (e.status === 409) return send(res, 409, { error: "duplicate_centre" });   // lost a race with another admin
      throw e;
    }

    /* Audit is best-effort: the centre exists, so a logging hiccup must not fail the request. */
    try {
      await db.insertAudit({ admin_user_id: ctx.user.id, action: "centre.create", target_user_id: null, detail: { id: created.id, region: created.region, name: created.name } });
    } catch (e) { console.error("[admin] audit write failed", e.status || ""); }

    send(res, 201, { centre: centreOut(created) });
  } catch (e) { console.error(e); send(res, e.status || 500, { error: "server_error" }); }
}
