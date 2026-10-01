# TSHK Compass: subscription edition (PayFast, R100 per month, 7-day free trial)

This is the full TSHK Compass app plus membership:

- Members sign in with **email address and password** (created in the app; no emailed code to wait for).
- The first sign-in starts a **7-day free trial**, and a short **"what's included"** page introduces the app once per account
  (also reachable from Account).
- After the trial, the whole app needs a **R100 per month** subscription, billed by **PayFast** (card, Instant EFT and the
  other methods PayFast offers). R100 is charged on subscribing and then every month until cancelled.
- Members can cancel from the Account screen (or from PayFast's own emails). Access continues until the paid month ends.
- If a monthly charge is late, access continues for a 3-day grace period, then the paywall returns until PayFast confirms payment.
- Offline, a member whose membership was last confirmed as valid can keep using the compass until that date.
- An **admin area** (visible only to accounts flagged `is_admin` in the database) can add centres, generate a one-time temporary
  password for a locked-out member, and delete a user.

The compass engine, languages, centres map and dashboard are identical to the main source package (see its README for how the
compass works). This README covers the membership system.

## How it fits together

```
Phone (public/)                            Vercel functions (api/)                 Services
──────────────                             ───────────────────────                 ────────
member.js  ── signup / token / recover ──────────────────────────────────────────► Supabase Auth
member.js  ── PUT /auth/v1/user (new password from the reset link) ───────────────► Supabase Auth
member.js  ── GET /api/me ────────────────► me.js: create member + trial,           ──► Supabase DB
                                            return access + is_admin + must_change_password
app.js     ── GET /api/centres ───────────► centres.js: only if access (402 otherwise)
member.js  ── POST /api/account/password ─► password.js: set own password (min 8)
member.js  ── admin calls ────────────────► admin/*: centres, reset-password, delete ──► Supabase Auth + DB + PayFast
member.js  ── POST /api/payfast/checkout ─► checkout.js: signed PayFast form
browser    ── form POST ───────────────────────────────────────────────────────────► PayFast (pay R100)
PayFast    ── ITN POST ───────────────────► notify.js: verify signature, confirm with PayFast,
                                            check amount, activate / extend / cancel ──► Supabase DB
member.js  ── POST /api/payfast/cancel ───► cancel.js: PayFast Subscriptions API cancel
```

Access decisions are made on the server (`api/_lib/entitlement.js`), and the `is_admin` / `must_change_password` flags are read
from the `members` row on **every** request (`api/_lib/auth.js`) - never from the JWT or from client-supplied data. The centre
list (names, addresses, phone numbers) is served only to members with access, from the database. The compass maths runs on the
phone like any web app; the overlay stops normal use, but a determined technical person could bypass a client-side screen. If
stronger protection is needed later, more features can be moved behind the API in the same way as the centres.

## Folder map

```
public/                    Everything served to phones (Vercel "outputDirectory")
  index.html               App + sign-in dialogs, forced password change, trial page, account, admin tools
  config.js                Public settings: Supabase URL + anon key, price label, reset URL, STORE_BUILD flag
  member.js                Sign-in/up, forced change, trial, paywall, PayFast hand-off, account/cancel, admin tools, offline
  reset.html               Route /reset - reads the recovery link and sets a new password
  app.js, geo.js, lang.js, dashboard.html, sw.js, manifest.webmanifest, icons
api/
  me.js                    GET   → member access (starts the trial on first call), is_admin, must_change_password
  centres.js               GET   → centre list from the database (members with access only, supports ETag)
  account/password.js      POST  → set your own password (8+ characters), clears must_change_password
  admin/users.js           GET   → find members by email (admin only, max 20)
  admin/centres.js         POST  → add a centre (admin only, validates + refuses duplicates)
  admin/users/reset-password.js  POST → one-time temporary password for a member (admin only)
  admin/users/delete.js    POST  → cancel PayFast first, then delete the account (admin only)
  payfast/checkout.js      POST  → signed PayFast subscription form
  payfast/notify.js        POST  ← PayFast ITN (payment notifications)
  payfast/cancel.js        POST  → cancel via PayFast API
  _lib/                    env, http, auth, supabase, entitlement, payfast signing/verification, ITN logic,
                           passwords, centre validation, rate limiting, centres data (seed source, not a route)
supabase/
  schema.sql               Tables, security policies, admin view, upgrade section
  seed-centres.sql         88 centres / 15 regions, idempotent (safe to re-run)
  generate-seed-centres.mjs  Regenerates the seed file from api/_lib/centres-data.js
tests/
  unit/                    signatures vs PayFast PHP reference, ITN rules, entitlement, API, auth, admin, centres seed
  dom/                     the membership screens driven through a real DOM (jsdom), backend mocked
  e2e/                     the same screens in a real browser (Playwright), backend mocked
.env.example               Every environment variable, explained
```

No npm packages are needed at runtime: the functions use Node 18+ built-ins (`fetch`, `crypto`, `dns`). `jsdom` and `playwright`
are development-only.

## Set up, step by step

### 1. Supabase (accounts and database)
1. Create a project at https://supabase.com (choose a region close to South Africa, for example `eu-west` or `af-south` if offered).
   For production use a paid plan; free projects may be paused when inactive.
2. **SQL Editor** → paste and run `supabase/schema.sql`, then `supabase/seed-centres.sql` (88 centres, 15 regions; safe to
   re-run, and it keeps the region order used by the app).
3. **Authentication → Providers → Email**: enabled. Turn on **"Confirm email"**. Minimum password length: **8**.
4. **Authentication → Email Templates**:
   - *Confirm signup* and *Reset password* should both mention TSHK Compass; keep `{{ .ConfirmationURL }}` in the reset template.
   - The old "magic link / 6-digit code" template is **not used any more** - the app never requests it, so it can stay as it is.
5. **Authentication → URL Configuration**: Site URL = your app address, and add **`{SITE_URL}/reset`** under *Redirect URLs*
   (this is exactly what the app sends as `redirect_to`; add `http://localhost:3000/reset` too while testing).
6. **Project Settings → Auth → SMTP**: connect a real email sender (Resend, SendGrid, Amazon SES, or the church's mail server).
   Supabase's built-in sender is heavily rate-limited and meant for testing only.
7. **Project Settings → API**: copy the Project URL, the `anon` public key and the `service_role` secret key.
   Put the URL and anon key in `public/config.js`. The service role key goes only into Vercel environment variables.
8. **Make yourself an admin** (one-time, after you have signed up in the app once so your `members` row exists):
   ```sql
   update public.members set is_admin = true where email = 'owner@example.org';
   ```
   Reload the app; **Admin tools** appears in the Account screen. Admin rights are checked against this row on every request,
   and there is no way to grant them from the browser (members may only read their own row, and no client can write to `members`).

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
1. `PAYFAST_SANDBOX=true`, deploy, open the app and **create an account**. With "Confirm email" on, the confirmation email arrives
   first: tap the link, then log in. The trial page should say "7 days".
2. In Supabase, set your `trial_ends_at` to yesterday (Table editor → members) and reload: the paywall appears.
3. Subscribe → PayFast sandbox → complete the payment. You return to "Confirming your payment…" and then the app opens.
4. Check Vercel logs for `[payfast] ITN → 200 membership active`, and the `payments` table for the record.
5. Account → Cancel subscription → confirm the PayFast sandbox dashboard shows the subscription cancelled.
6. Forgot password: log out, use "Forgot password", open the emailed link (`/reset#access_token=…&type=recovery`), set a new
   password, log in with it.
7. Admin: sign in as the account you flagged `is_admin`, open Account → Admin tools. Add a centre (it appears immediately for
   members), generate a temporary password for another member (shown once - copy it, then close; it is never stored or logged),
   and have that member log in with it: the app forces them to choose their own password before anything else opens.

### 5. Go live checklist
- `PAYFAST_SANDBOX=false` with the live Merchant ID/Key/passphrase; redeploy.
- Do one real R100 payment with a staff card, check the ITN in the logs, then cancel it.
- Optional: `PAYFAST_ENFORCE_IP=true` after confirming in the logs that no "unrecognised address" warnings appear for real ITNs.
- Publish a privacy policy (POPIA): what is kept (email, membership dates, PayFast payment references; no card details ever touch
  this system), why, for how long, and who the Information Officer is. Deleting a user in the admin area removes their account.
- Tell members how to cancel (Account screen, or the link in PayFast's emails).
- The isiZulu, Portuguese, Chichewa and iciBemba translations of the new sign-in, trial and admin screens were written for this
  change and have **not yet been checked by a native speaker** - please review them before the translations are relied on.

## Membership rules in the code

- **Who can see what:** the app locks (compass, sensors, map, centres) until the server confirms both the login and access.
  `/api/centres` answers `402 subscription_required` without access, `401` without a valid token, and every other `/api/*` route
  is protected the same way.
- **Trial:** starts on the first successful `/api/me` call, i.e. the first sign-in after confirming the email.
- **Forced password change:** while `members.must_change_password` is true, the server answers `403 password_change_required` to
  every `/api/*` route except `GET /api/me` and `POST /api/account/password` (PayFast's `/api/payfast/notify` is never gated).
  The UI shows only the change screen, but the rule is enforced server-side.
- **Temporary passwords:** generated with `crypto.randomInt`, 14 characters, no look-alike characters (`0O1lI`), at least one of
  each kind. Shown to the admin once, never stored, never logged and never written to the audit table.
- **Deleting a user:** PayFast is cancelled first; if that fails nothing is deleted (`502 payfast_cancel_failed`). You cannot
  delete your own account (`409 cannot_delete_self`).
- **Rate limits** (per admin, in memory, per instance): user search 60 per 15 min, add centre 30, generate password 10,
  delete 5. They are a brake on accidents and abuse, not a security boundary - the server enforces who may call what.

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
update members set must_change_password = true where email = 'someone@example.org';                 -- force a change
select * from admin_audit order by created_at desc limit 50;           -- admin actions (never contains passwords)
```

## Tests
```bash
npm install
npm test                      # unit + API tests (PHP on the PATH enables the PayFast reference comparisons)
npm run test:dom              # membership screens through a real DOM (jsdom), backend mocked
npx playwright install chromium
npm run test:e2e              # the same screens in a real browser, backend mocked
```
`npm test` covers the PayFast signatures and ITN rules, entitlement, the API cycle, the forced password change, the admin
routes (rejection of non-admins, reset ordering, deletion ordering, self-deletion), centre validation and the seed data. The
Playwright suite cannot run where the browser download is blocked; `npm run test:dom` covers the same screens without a browser.

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
- **Upgrading an existing database:** run the `alter table ... add column if not exists` lines in the upgrade section at the bottom of
  `supabase/schema.sql` (they add `is_admin` and `must_change_password`), then run `supabase/seed-centres.sql`.
- **Deleted members and late payments:** if PayFast sends an ITN for an account the admin deleted, it is acknowledged (`200
  unknown payment, ignored`) and nothing crashes.
- **Sessions after a reset:** setting a password through the Supabase Admin API revokes that user's refresh tokens, so old devices
  drop out; an already-issued short-lived access token stays valid until it expires, which is why the forced-change flag is checked
  on the server for every request in the meantime.
