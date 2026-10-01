/* Regenerate supabase/seed-centres.sql from api/_lib/centres-data.js (the original 88-centre list).
   Run from the repository root:  node supabase/generate-seed-centres.mjs
   No dependencies; the SQL it writes is idempotent and safe to run again. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, CENTRES } from "../api/_lib/centres-data.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const q = (v) => (v === null || v === undefined || v === "" ? "null" : `'${String(v).replace(/'/g, "''")}'`);

const inserts = CENTRES.map((c, i) => {
  const order = CENTRES.filter((x) => x.r === c.r).indexOf(c) + 1;
  return `  (${q(c.r)}, ${q(c.n)}, ${q(c.a)}, ${q(c.p)}, ${Number(c.la)}, ${Number(c.lo)}, ${order})`;
}).join(",\n");

const sql = `-- TSHK Compass: the 88 centres, grouped into ${REGIONS.length} regions.
-- Generated from api/_lib/centres-data.js by supabase/generate-seed-centres.mjs — edit that file and re-run the script,
-- or edit the admin "Add centre" screen in the app afterwards. Idempotent: re-running it does not duplicate rows and
-- keeps each centre's id stable (clients cache ids).
begin;

insert into public.regions (name, sort_order) values
${REGIONS.map((r, i) => `  (${q(r)}, ${i + 1})`).join(",\n")}
on conflict (name) do update set sort_order = excluded.sort_order;

insert into public.centres (region, name, address, phone, lat, lng, sort_order) values
${inserts}
on conflict (region, name) do update
  set address = excluded.address, phone = excluded.phone, lat = excluded.lat, lng = excluded.lng,
      sort_order = excluded.sort_order;

commit;
`;

fs.writeFileSync(path.join(here, "seed-centres.sql"), sql);
console.log(`wrote supabase/seed-centres.sql (${REGIONS.length} regions, ${CENTRES.length} centres)`);
