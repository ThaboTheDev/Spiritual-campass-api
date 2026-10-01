# TSHK Compass: subscription edition (PayFast, R100 per month, 7-day free trial)

This is the full TSHK Compass app plus membership:

- Members sign in with their email address (a 6-digit code is emailed; no passwords to forget).
- The first sign-in starts a **7-day free trial** with the whole app.
- After the trial, the whole app needs a **R100 per month** subscription, billed by **PayFast** (card, Instant EFT and the
  other methods PayFast offers). R100 is charged on subscribing and then every month until cancelled.
- Members can cancel from the Account screen (or from PayFast's own emails). Access continues until the paid month ends.
- If a monthly charge is late, access continues for a 3-day grace period, then the paywall returns until PayFast confirms payment.
- Offline, a member whose membership was last confirmed as valid can keep using the compass until that date.

The compass engine, languages, centres map and dashboard are identical to the main source package (see its README for how the
compass works). This README covers the membership system.

## How it fits together

```
Phone (public/)                          Vercel functions (api/)                   Services
───────────────                          ───────────────────────                   ────────
member.js ── email code ─────────────────────────────────────────────────────────► Supabase Auth
member.js ── GET /api/me ──────────────► me.js: create member + trial, return access ──► Supabase DB
app.js    ── GET /api/centres ─────────► centres.js: only if access (402 otherwise)
member.js ── POST /api/payfast/checkout► checkout.js: signed PayFast form
browser   ── form POST ──────────────────────────────────────────────────────────► PayFast (pay R100)
PayFast   ── ITN POST ─────────────────► notify.js: verify signature, confirm with PayFast,
                                          check amount, activate / extend / cancel ──► Supabase DB
member.js ── POST /api/payfast/cancel ─► cancel.js: PayFast Subscriptions API cancel
```

Access decisions are made on the server (`api/_lib/entitlement.js`). The centre list (names, addresses, phone numbers) is only
served to members with access. The compass maths runs on the phone like any web app; the overlay stops normal use, but a
determined technical person could bypass a client-side screen. If stronger protection is needed later, more features can be
moved behind the API in the same way as the centres.

## Folder map

```
public/                  Everything served to phones (Vercel "outputDirectory")
  index.html             App + membership overlay and account chip
  config.js              Public settings: Supabase URL + anon key, price label, STORE_BUILD flag
  member.js              Sign-in, trial, paywall, PayFast hand-off, account/cancel, offline grace
  app.js, geo.js, lang.js, dashboard.html, sw.js, manifest.webmanifest, icons
api/
  me.js                  GET  → member access (starts the trial on first call)
  centres.js             GET  → centre list (members with access only)
  payfast/checkout.js    POST → signed PayFast subscription form
  payfast/notify.js      POST ← PayFast ITN (payment notifications)
  payfast/cancel.js      POST → cancel via PayFast API
  _lib/                  env, http, supabase, entitlement, payfast signing/verification, ITN logic, centres data (not routes)
supabase/schema.sql      Tables, security policies, admin view
tests/unit/              29 tests: signatures vs PayFast PHP reference, ITN rules, entitlement, full API cycle
tests/e2e/               Browser test of every membership screen (backend mocked)
.env.example             Every environment variable, explained
```

No npm packages are needed at runtime: the functions use Node 18+ built-ins (`fetch`, `crypto`, `dns`).

## Set up, step by step

### 1. Supabase (accounts and database)
1. Create a project at https://supabase.com (choose a region close to South Africa, for example `eu-west` or `af-south` if offered).
   For production use a paid plan; free projects may be paused when inactive.
2. **SQL Editor** → paste and run `supabase/schema.sql`.
3. **Authentication → Providers → Email**: enabled. Turn on "Confirm email". OTP length 6.
4. **Authentication → Email Templates → Magic Link**: make the email show the code, for example:
   `<h2>Your TSHK Compass code</h2><p>Enter this code in the app: <b>{{ .Token }}</b></p>`
5. **Authentication → URL Configuration**: Site URL = your app address.
6. **Project Settings → Auth → SMTP**: connect a real email sender (Resend, SendGrid, Amazon SES, or the church's mail server).
   Supabase's built-in sender is heavily rate-limited and meant for testing only.
7. **Project Settings → API**: copy the Project URL, the `anon` public key and the `service_role` secret key.
   Put the URL and anon key in `public/config.js`. The service role key goes only into Vercel environment variables.

### 2. PayFast (payments)
1. Merchant account at https://www.payfast.co.za (business verification required to receive funds).
2. **Settings → Integration**: note Merchant ID and Merchant Key, and **set a passphrase** (required for subscriptions).
3. Make sure **Recurring Billing / Subscriptions** is enabled on the account (ask PayFast support if the option is missing).
4. For testing use https://sandbox.payfast.co.za: it gives its own sandbox Merchant ID/Key; set a passphrase there too.
   Use a buyer email that is different from the merchant login email, or the sandbox refuses the payment.

### 3. Vercel (hosting)
1. Import this folder as a new project (Framework preset: **Other**; no build command). `vercel.json` already sets `public/` as output.
2. Add every variable from `.env.example` under **Settings → Environment Variables** (Production and Preview).
3. Deploy. The ITN address PayFast will call is `https://YOUR-DOMAIN/api/payfast/notify` (it must be public HTTPS).

### 4. Test end to end (sandbox)
1. `PAYFAST_SANDBOX=true`, deploy, open the app, sign in with a real inbox, confirm the trial shows "7 days left".
2. In Supabase, set your `trial_ends_at` to yesterday (Table editor → members) and reload: the paywall appears.
3. Subscribe → PayFast sandbox → complete the payment. You return to "Confirming your payment…" and then the app opens.
4. Check Vercel logs for `[payfast] ITN → 200 membership active`, and the `payments` table for the record.
5. Account → Cancel subscription → confirm the PayFast sandbox dashboard shows the subscription cancelled.

### 5. Go live checklist
- `PAYFAST_SANDBOX=false` with the live Merchant ID/Key/passphrase; redeploy.
- Do one real R100 payment with a staff card, check the ITN in the logs, then cancel it.
- Optional: `PAYFAST_ENFORCE_IP=true` after confirming in the logs that no "unrecognised address" warnings appear for real ITNs.
- Publish a privacy policy (POPIA): what is kept (email, membership dates, PayFast payment references; no card details ever touch
  this system), why, for how long, and who the Information Officer is. Deleting a user in Supabase Auth removes their member row.
- Tell members how to cancel (Account screen, or the link in PayFast's emails).

## PayFast security in this code
Every notification (`api/_lib/itn.js`) must pass all of these before anything changes:
1. **Signature** recomputed from the fields exactly as received, with the secret passphrase (PHP-urlencode rules, MD5).
2. **Merchant ID** matches ours.
3. **Source address** belongs to PayFast (logged; enforced when `PAYFAST_ENFORCE_IP=true`).
4. **Server confirmation**: the same data is posted back to PayFast's `/eng/query/validate`, which must answer `VALID`.
5. **Amount** equals R100.00.
6. **Idempotency**: each `pf_payment_id` is applied once (PayFast may resend notifications).
The passphrase and service role key never reach the browser. Tests prove the checkout, ITN and API signatures are byte-for-byte
the same as PayFast's PHP reference code (`tests/unit/php-reference.php`).

## App stores and payments (important)
Selling a digital subscription **inside** a store app normally requires the store's own billing:
- **Google Play**: Play Billing is required for in-app digital subscriptions. South Africa is in Google's *user choice billing*
  programme, which allows an alternative payment option **alongside** Play Billing (not instead of it), with a reduced Google fee.
- **Apple App Store**: In-App Purchase is required for digital subscriptions sold in the app (outside a few regions with special rules).

So this code has `STORE_BUILD` in `public/config.js`:
- `false` (website, installable web app): full PayFast subscribe flow.
- `true` (for the store apps): the app only lets people **sign in**; it hides the price and the PayFast button. Members subscribe on
  the website, and the same account works in the app. Do not add links or instructions inside the store app that send people to pay
  elsewhere unless the store's current rules allow it.
If the church later wants to sell inside the store apps, add Google Play Billing / Apple In-App Purchase (for example with
RevenueCat) and have their server notifications update the same `members` table (`status`, `paid_through`).
Store rules change often; check the current Google Play Payments policy and Apple App Review Guideline 3.1 before submitting.

## Useful admin queries (Supabase SQL Editor)
```sql
select * from member_overview;                                         -- everyone, newest first
select count(*) filter (where status='active') as paying,
       count(*) filter (where status='trialing' and trial_ends_at > now()) as in_trial from members;
update members set trial_ends_at = now() + interval '7 days' where email = 'someone@example.org';   -- extend a trial
```

## Tests
```bash
npm install
npm test                      # unit + API tests (PHP on the PATH enables the PayFast reference comparisons)
npx playwright install chromium
npm run test:e2e              # membership screens in a real browser, backend mocked
```

## Changing the price or trial
Set `SUBSCRIPTION_AMOUNT` and `TRIAL_DAYS` in Vercel, and update `PRICE_LABEL` / `TRIAL_DAYS` in `public/config.js` (display only).
Existing PayFast subscriptions keep their original amount; changing them needs the PayFast Subscriptions API `update` call.
The amount each member signed up at is stored (`members.subscription_amount`) and their renewals are checked against it, so a price change
never locks out existing subscribers; only new sign-ups pay the new price.

## Behaviour notes
- **Retry-safe activation:** each payment records the paid-through date it grants (`payments.applies_until`). If the database write that
  activates a member fails, PayFast's retry completes it instead of being ignored as a duplicate.
- **Free-trial days are kept:** subscribing on day 2 of a 7-day trial gives one month *after* the trial ends, not a month from today.
  To go back to "a month from the payment date", remove `trialEnd` from the `Math.max(...)` in `api/_lib/itn.js`.
- **Upgrading an existing database:** run the two `alter table ... add column if not exists` lines at the bottom of `supabase/schema.sql`.
