/* Validation for POST /api/admin/centres. Returns { fields, centre }: `fields` lists the request
   fields that failed (empty = valid), `centre` is the cleaned row to insert. */

const num = (v) => (v === null || v === undefined || String(v).trim() === "" ? NaN : Number(v));
const str = (v) => (typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim());

export const PHONE_RE = /^\+[0-9][0-9 ]{0,24}$/;    // "+<digits and spaces>"

export function validateCentre(body, regionNames = []) {
  const b = body && typeof body === "object" ? body : {};
  const fields = [];
  const centre = {
    region: str(b.region),
    name: str(b.name),
    address: str(b.address) || null,
    phone: str(b.phone) || null,
    lat: num(b.lat),
    lng: num(b.lng),
  };

  if (!centre.region || !regionNames.includes(centre.region)) fields.push("region");
  if (centre.name.length < 2 || centre.name.length > 80) fields.push("name");
  if (centre.address !== null && centre.address.length > 240) fields.push("address");
  if (centre.phone !== null && !PHONE_RE.test(centre.phone)) fields.push("phone");
  if (!Number.isFinite(centre.lat) || centre.lat < -90 || centre.lat > 90) fields.push("lat");
  if (!Number.isFinite(centre.lng) || centre.lng < -180 || centre.lng > 180) fields.push("lng");

  return { fields, centre };
}

/* Shape used by GET /api/centres and POST /api/admin/centres (same short keys as the old
   centres-data.js, plus the database id). */
export function centreOut(row) {
  return {
    id: row.id, r: row.region, n: row.name, a: row.address || "", p: row.phone || "",
    la: Number(row.lat), lo: Number(row.lng),
  };
}
