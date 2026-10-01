/* Public settings for the browser. Safe to publish: the anon key only allows what Row Level Security permits. */
window.TSHK_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-SUPABASE-ANON-KEY",
  PRICE_LABEL: "R100",
  TRIAL_DAYS: 7,
  /* true for Google Play / App Store builds: hides the PayFast subscribe button inside the app
     (store rules require their own billing for digital subscriptions sold in the app). */
  STORE_BUILD: false
};
