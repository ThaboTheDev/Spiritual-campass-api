// Configuration from environment variables (set them in Vercel → Project → Settings → Environment Variables).
export function env(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing environment variable ${name}`);
  }
  return v;
}
export function cfg() {
  return {
    siteUrl: env("SITE_URL").replace(/\/$/, ""),
    supabaseUrl: env("SUPABASE_URL").replace(/\/$/, ""),
    supabaseAnon: env("SUPABASE_ANON_KEY"),
    supabaseService: env("SUPABASE_SERVICE_ROLE_KEY"),
    merchantId: env("PAYFAST_MERCHANT_ID"),
    merchantKey: env("PAYFAST_MERCHANT_KEY"),
    passphrase: env("PAYFAST_PASSPHRASE"),
    sandbox: env("PAYFAST_SANDBOX", "true") === "true",
    enforceIp: env("PAYFAST_ENFORCE_IP", "false") === "true",
    amount: Number(env("SUBSCRIPTION_AMOUNT", "100")).toFixed(2),
    itemName: env("SUBSCRIPTION_ITEM_NAME", "TSHK Compass monthly membership"),
    trialDays: Number(env("TRIAL_DAYS", "7")),
    graceDays: Number(env("GRACE_DAYS", "3")),
  };
}
