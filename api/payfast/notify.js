// POST /api/payfast/notify → PayFast ITN (called by PayFast for the first payment, every monthly payment, and cancellations)
import { readRaw, clientIp } from "../_lib/http.js";
import { cfg } from "../_lib/env.js";
import { db } from "../_lib/supabase.js";
import { handleItn } from "../_lib/itn.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
  try {
    const raw = await readRaw(req);                  // must be read before anything touches req.body
    const result = await handleItn(raw, clientIp(req), { db, c: cfg() });
    console.log(`[payfast] ITN → ${result.status} ${result.reason}`);
    res.statusCode = result.status; res.end(result.reason);
  } catch (e) {
    console.error("[payfast] ITN error", e);
    res.statusCode = 500; res.end("error");          // non-200 makes PayFast retry later
  }
}
