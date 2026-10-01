/* ---------- Membership ----------
   Email + password sign-in (Supabase Auth), 7-day free trial, then R100 per month through PayFast.
   The server (/api/*) decides access; this file shows the right screen and loads the centres for members.
   Loaded before app.js; starts on DOMContentLoaded, after app.js has run.
   The compass runs client-side: this file stops it from starting until access is confirmed, but a modified
   client can bypass the screen — the centres and every API route stay behind the server. */
var REGIONS = [], CENTRES = [];            // filled from /api/centres once access is confirmed

const MEMBER = (function () {
  const CFG = window.TSHK_CONFIG || {};
  const SKEY = "tshk-session", EKEY = "tshk-ent", CKEY = "tshk-centres", TKEY = "tshk-trial-seen";
  const TRIAL_INTRO_WINDOW_MS = 10 * 60 * 1000;   // "first login": the member row was created just now
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const el = (id) => document.getElementById(id);
  const t = (key, vars) => (typeof T === "function" ? T(key, vars) : "");
  const two = (en, key, vars) => (typeof bi === "function" ? bi(en, t(key, vars)) : en);
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  const resetUrl = () => CFG.RESET_URL || `${location.origin}/reset`;

  let session = store.get(SKEY), ent = null, view = null, granted = false, cancelArmed = false;
  let pendingEmail = "", mustChangeEmail = "";
  let adminPicked = null, tempPassword = "";

  /* ---- Supabase Auth over HTTPS (no library needed) ---- */
  async function authPost(path, body) {
    const r = await fetch(`${CFG.SUPABASE_URL}/auth/v1/${path}`, {
      method: "POST", headers: { apikey: CFG.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.msg || j.error_description || j.message || ("HTTP " + r.status)), { status: r.status, detail: j });
    return j;
  }
  function saveSession(j) {
    session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || session && session.email || "" };
    store.set(SKEY, session);
  }
  async function refresh() {
    if (!session || !session.refresh_token) return false;
    try { saveSession(await authPost("token?grant_type=refresh_token", { refresh_token: session.refresh_token })); return true; }
    catch (e) { if (e.status >= 400 && e.status < 500) signOutLocal(); return false; }
  }
  async function api(path, opts = {}) {
    if (session && Date.now() > session.expires_at - 60000) await refresh();
    const go = () => fetch(path, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + (session ? session.access_token : "") } });
    let r = await go();
    if (r.status === 401 && (await refresh())) r = await go();
    return r;
  }
  function signOutLocal() {
    session = null; ent = null; granted = false; adminPicked = null; tempPassword = "";
    store.del(SKEY); store.del(EKEY); store.del(CKEY);
    window.TSHK_LOCKED = true;
  }

  /* ---- screens ---- */
  const SECTIONS = ["m-login", "m-signup", "m-forgot", "m-checkmail", "m-mustchange", "m-trial", "m-pay", "m-account"];
  function show(v, msg) {
    view = v; cancelArmed = false;
    const box = el("member"); box.hidden = false; document.body.classList.add("locked");
    for (const id of SECTIONS) el(id).hidden = true;
    for (const id of ["m-cancel", "m-retry"]) el(id).hidden = true;
    el("m-price").textContent = CFG.PRICE_LABEL || "R100";
    el("m-close").hidden = true;
    el("m-signout").hidden = !session;
    el("m-msg").textContent = msg || "";
    const storeBuild = !!CFG.STORE_BUILD;
    const title = el("m-title"), sub = el("m-sub");
    const trialDays = CFG.TRIAL_DAYS || 7, price = CFG.PRICE_LABEL || "R100";

    if (v === "login") {
      title.textContent = two("Log in to continue", "login_title");
      sub.textContent = two(`Free for ${trialDays} days, then ${price} per month.`, "trial_offer", { n: trialDays, p: price });
      el("m-login").hidden = false; setTimeout(() => el("m-login-email").focus(), 50);
    } else if (v === "signup") {
      title.textContent = two("Create your account", "signup_title");
      sub.textContent = two(`Free for ${trialDays} days, then ${price} per month.`, "trial_offer", { n: trialDays, p: price });
      el("m-signup").hidden = false;
    } else if (v === "forgot") {
      title.textContent = two("Reset your password", "forgot_title");
      sub.textContent = two("We will email you a link to set a new password.", "forgot_note");
      el("m-forgot").hidden = false; el("m-forgot-email").value = el("m-login-email").value || "";
    } else if (v === "checkmail") {
      title.textContent = two("Check your email", "checkmail_title");
      sub.textContent = "";
      el("m-checkmail").hidden = false;
      el("m-checkmail-note").textContent = two(`We sent a confirmation link to ${pendingEmail}. Tap it to finish creating your account, then log in.`, "checkmail_note", { e: pendingEmail });
    } else if (v === "mustchange") {
      title.textContent = two("Choose your own password", "mustchange_title");
      sub.textContent = two("An administrator set a temporary password. Choose a new one to continue.", "mustchange_note");
      el("m-mustchange").hidden = false; el("m-newpass").value = "";
      setTimeout(() => el("m-newpass").focus(), 50);
    } else if (v === "trial") {
      title.textContent = two("Welcome — your free trial has started", "trial_title");
      sub.textContent = "";
      el("m-trial").hidden = false;
      el("m-trial-line").textContent = ent && ent.state === "trial"
        ? two(`You have ${ent.days_left} day${ent.days_left === 1 ? "" : "s"} of everything, free. After that it is ${price} per month.`, "trial_started", { n: ent.days_left, p: price })
        : two(`Everything below is included in your ${price} per month membership.`, "trial_included", { p: price });
      el("m-trial-pay").hidden = storeBuild;
      el("m-close").hidden = !(ent && ent.access);
    } else if (v === "loading") {
      title.textContent = two("Checking your membership…", "pay_checking"); sub.textContent = "";
    } else if (v === "confirming") {
      title.textContent = two("Confirming your payment…", "pay_confirming"); sub.textContent = two("This usually takes a few seconds.", "pay_wait");
    } else if (v === "offline") {
      title.textContent = two("Connect to the internet to check your membership", "pay_offline"); sub.textContent = "";
      el("m-retry").hidden = false;
    } else if (v === "paywall") {
      const s = ent && ent.state;
      title.textContent = s === "past_due" ? two("We have not received this month's payment", "pay_pastdue")
        : s === "expired" ? two("Your membership has ended", "pay_expired")
        : two("Your free trial has ended", "trial_ended");
      sub.textContent = storeBuild ? two("A membership is needed. Please sign in with a member account.", "pay_store")
        : two(`Continue with a monthly membership of ${price}. Cancel any time.`, "pay_offer", { p: price });
      el("m-pay").hidden = storeBuild;
      el("m-signout").hidden = !session;
    } else if (v === "account") {
      title.textContent = two("Account", "account"); sub.textContent = (session && session.email) || "";
      el("m-account").hidden = false; el("m-close").hidden = false;
      el("m-state").textContent = stateLine();
      el("m-admin").hidden = !(ent && ent.is_admin);
      el("m-pay").hidden = storeBuild || !(ent && (ent.state === "trial" || !ent.access));
      el("m-cancel").hidden = !(ent && ent.can_cancel);
      el("m-cancel").textContent = two("Cancel subscription", "pay_cancel");
      el("m-features").textContent = two("What's included & pricing", "account_features");
      el("m-admin").textContent = two("Admin tools", "account_admin");
    }
    /* labels */
    el("m-subscribe").textContent = two(`Subscribe · ${price} per month`, "pay_btn", { p: price });
    el("m-login-btn").textContent = two("Log in", "login_btn");
    el("m-signup-btn").textContent = two("Create account", "signup_btn");
    el("m-forgot-btn").textContent = two("Send the link", "forgot_btn");
    el("m-to-signup").textContent = two("Create an account", "login_create");
    el("m-to-login").textContent = two("Back to log in", "signup_back");
    el("m-forgot-link").textContent = two("Forgot password?", "login_forgot");
    el("m-forgot-back").textContent = two("Back to log in", "signup_back");
    el("m-checkmail-back").textContent = two("Back to log in", "signup_back");
    el("m-resend").textContent = two("Resend the email", "checkmail_resend");
    el("m-newpass-btn").textContent = two("Save and continue", "mustchange_btn");
    el("m-trial-start").textContent = two("Start using the app", "trial_start_btn");
    el("m-trial-pay").textContent = two("Pay now", "trial_pay_btn");
    el("m-signout").textContent = two("Sign out", "pay_signout");
    el("m-close").textContent = two("Close", "close");
    el("m-retry").textContent = two("Try again", "retry");
    el("m-login-email-l").textContent = two("Email address", "email_l");
    el("m-signup-email-l").textContent = two("Email address", "email_l");
    el("m-forgot-email-l").textContent = two("Email address", "email_l");
    el("m-login-pass-l").textContent = two("Password", "password_l");
    el("m-signup-pass-l").textContent = two("Choose a password (at least 8 characters)", "signup_pass_l");
    el("m-newpass-l").textContent = two("New password", "password_l");
    showLabel(el("m-login-show"), "m-login-pass");
    showLabel(el("m-signup-show"), "m-signup-pass");
    showLabel(el("m-newpass-show"), "m-newpass");
    el("m-lang").value = typeof LANG !== "undefined" ? LANG : "zu";
  }
  function showLabel(btn, inputId) {
    const shown = el(inputId).type === "text";
    btn.textContent = shown ? two("Hide", "pw_hide") : two("Show", "pw_show");
    btn.setAttribute("aria-pressed", shown ? "true" : "false");
  }
  function hide() { el("member").hidden = true; document.body.classList.remove("locked"); view = null; }
  function stateLine() {
    if (!ent) return "";
    if (ent.state === "trial") return two(`Free trial: ${ent.days_left} day${ent.days_left === 1 ? "" : "s"} left`, "trial_left", { n: ent.days_left });
    if (ent.state === "active") return two("Membership active, renews monthly", "pay_active");
    if (ent.state === "cancelled") return two(`Cancelled. Access until ${fmtDate(ent.access_until)}`, "pay_cancelled_until", { d: fmtDate(ent.access_until) });
    return two("No active membership", "pay_none");
  }
  function updateChip() {
    const b = el("acct"); if (!b) return;
    b.hidden = !session;
    el("acct-t").textContent = ent && ent.state === "trial" ? two(`Trial · ${ent.days_left}d`, "trial_chip", { n: ent.days_left }) : two("Account", "account");
  }

  /* ---- access ---- */
  async function check(pay) {
    show("loading");
    let r;
    try { r = await api("/api/me"); } catch (e) { return offline(); }
    if (r.status === 401) { signOutLocal(); updateChip(); return show("login"); }
    if (!r.ok) return offline();
    ent = await r.json(); store.set(EKEY, { ...ent, checked: Date.now() }); updateChip();
    if (ent.must_change_password) { mustChangeEmail = (session && session.email) || ent.email || ""; return show("mustchange"); }
    if (pay === "success" && ent.state !== "active") return confirming(0);
    if (ent.access) { if (trialIntroDue()) return show("trial"); return grant(); }
    show("paywall", pay === "cancelled" ? two("Payment was cancelled. You can try again.", "pay_cancelled_note") : "");
  }
  function offline() {
    const c = store.get(EKEY);
    if (c && c.access && Date.parse(c.access_until) > Date.now()) { ent = c; updateChip(); return grant(); }
    show("offline");
  }
  async function confirming(n) {
    show("confirming");
    await new Promise((res) => setTimeout(res, n === 0 ? 1500 : 3000));
    try {
      const r = await api("/api/me");
      if (r.ok) { ent = await r.json(); store.set(EKEY, { ...ent, checked: Date.now() }); updateChip(); if (ent.state === "active") return grant(); }
    } catch (e) {}
    if (n < 20) return confirming(n + 1);
    if (ent && ent.access) return grant();
    show("paywall", two("Your payment is still being confirmed. If PayFast showed success, wait a minute and tap Try again.", "pay_slow"));
    el("m-retry").hidden = false;
  }
  function trialIntroDue() {
    if (!ent || ent.state !== "trial") return false;
    if (store.get(TKEY) === (ent.email || "")) return false;
    const created = Date.parse(ent.created_at || "");
    return !!created && Date.now() - created < TRIAL_INTRO_WINDOW_MS;
  }
  function markTrialSeen() { store.set(TKEY, (ent && ent.email) || ""); }
  function grant() {
    hide();
    window.TSHK_LOCKED = false;
    if (granted) return;
    granted = true; loadCentres();
  }
  async function loadCentres() {
    const cached = store.get(CKEY) || {};
    try {
      const r = await api("/api/centres", { headers: cached.etag ? { "If-None-Match": cached.etag } : {} });
      if (r.status === 401) { signOutLocal(); updateChip(); return show("login"); }
      if (r.status === 402) { store.del(CKEY); return; }                 // no access: drop the offline copy
      if (r.status === 200) {
        const d = await r.json();
        store.set(CKEY, { etag: r.headers.get("etag") || null, data: d });
        return setCentres(d);
      }
    } catch (e) { /* offline */ }
    if (cached.data) setCentres(cached.data);
  }

  /* ---- actions ---- */
  const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function say(text) { el("m-msg").textContent = text; }
  function sayAdmin(text) { el("a-msg").textContent = text; }

  async function logIn(ev) {
    ev.preventDefault();
    const email = el("m-login-email").value.trim().toLowerCase();
    const password = el("m-login-pass").value;
    if (!validEmail(email)) return say(two("Please enter a valid email address.", "auth_bad_email"));
    if (!password) return say(two("Enter your password.", "login_need_pass"));
    el("m-login-btn").disabled = true;
    try {
      saveSession(await authPost("token?grant_type=password", { email, password }));
      el("m-login-pass").value = "";
      await check();
    } catch (e) {
      say(two("That email and password did not match.", "auth_fail"));
    } finally { el("m-login-btn").disabled = false; }
  }
  async function signUp(ev) {
    ev.preventDefault();
    const email = el("m-signup-email").value.trim().toLowerCase();
    const password = el("m-signup-pass").value;
    if (!validEmail(email)) return say(two("Please enter a valid email address.", "auth_bad_email"));
    if (password.length < 8) return say(two("Use at least 8 characters.", "weak_password"));
    el("m-signup-btn").disabled = true;
    try {
      const j = await authPost("signup", { email, password });
      pendingEmail = email;
      el("m-signup-pass").value = "";
      if (j.access_token) { saveSession(j); return check(); }        // email confirmation is off on this project
      show("checkmail");
    } catch (e) {
      say(two("Could not create the account. If you already have one, log in instead.", "signup_fail"));
    } finally { el("m-signup-btn").disabled = false; }
  }
  async function resend() {
    el("m-resend").disabled = true;
    try {
      await authPost("resend", { type: "signup", email: pendingEmail });
      say(two("Email sent again.", "checkmail_resent"));
    } catch (e) { say(two("Could not send the email. Please try again.", "forgot_fail")); }
    finally { el("m-resend").disabled = false; }
  }
  async function sendRecover(ev) {
    ev.preventDefault();
    const email = el("m-forgot-email").value.trim().toLowerCase();
    if (!validEmail(email)) return say(two("Please enter a valid email address.", "auth_bad_email"));
    el("m-forgot-btn").disabled = true;
    try {
      await authPost(`recover?redirect_to=${encodeURIComponent(resetUrl())}`, { email });
      say(two("If that address has an account, the email is on its way.", "forgot_sent"));
    } catch (e) { say(two("Could not send the email. Please try again.", "forgot_fail")); }
    finally { el("m-forgot-btn").disabled = false; }
  }
  async function changePassword(ev) {
    ev.preventDefault();
    const pw = el("m-newpass").value;
    if (pw.length < 8) return say(two("Use at least 8 characters.", "weak_password"));
    el("m-newpass-btn").disabled = true;
    try {
      const r = await api("/api/account/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_password: pw }) });
      if (r.status === 400) { say(two("Use at least 8 characters.", "weak_password")); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      /* Supabase revoked the old sessions, so sign in again with the password we just set. */
      const email = mustChangeEmail || (session && session.email) || "";
      el("m-newpass").value = "";
      store.del(SKEY); session = null;
      saveSession(await authPost("token?grant_type=password", { email, password: pw }));
      await check();
    } catch (e) {
      say(two("Could not set the password. Please try again.", "mustchange_fail"));
    } finally { el("m-newpass-btn").disabled = false; }
  }
  async function subscribe() {
    el("m-subscribe").disabled = true; el("m-trial-pay").disabled = true; el("m-msg").textContent = "";
    try {
      const r = await api("/api/payfast/checkout", { method: "POST" });
      if (r.status === 403) { await check(); return; }
      if (r.status === 409) { await check(); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const { action, fields } = await r.json();
      const f = document.createElement("form"); f.method = "POST"; f.action = action; f.style.display = "none";
      for (const [k, v] of Object.entries(fields)) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i); }
      document.body.appendChild(f); f.submit();
    } catch (e) {
      say(two("Could not open PayFast. Please try again.", "pay_open_fail"));
      el("m-subscribe").disabled = false; el("m-trial-pay").disabled = false;
    }
  }
  async function cancelSub() {
    if (!cancelArmed) { cancelArmed = true; el("m-cancel").textContent = two("Tap again to confirm cancelling", "pay_cancel_confirm"); return; }
    el("m-cancel").disabled = true;
    try {
      const r = await api("/api/payfast/cancel", { method: "POST" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const me = await api("/api/me"); if (me.ok) { ent = await me.json(); store.set(EKEY, { ...ent, checked: Date.now() }); }
      updateChip(); show("account", two("Your subscription is cancelled. No further payments will be taken.", "pay_cancel_done"));
    } catch (e) { say(two("Could not cancel right now. Please try again later.", "pay_cancel_fail")); }
    finally { el("m-cancel").disabled = false; }
  }
  function signOut() { signOutLocal(); updateChip(); show("login"); }
  function togglePassword(inputId, btn) {
    const input = el(inputId);
    input.type = input.type === "password" ? "text" : "password";
    showLabel(btn, inputId);
  }

  /* ---- admin tools (the server already refuses non-admins; this is only the screen) ---- */
  const searchSeq = { reset: 0, delete: 0 };
  function openAdmin() {
    el("admin").hidden = false;
    el("a-sub").textContent = (session && session.email) || "";
    el("a-close").textContent = two("Close", "close");
    el("a-title").textContent = two("Admin tools", "admin_title");
    el("a-tab-centre").textContent = two("Add centre", "admin_add");
    el("a-tab-reset").textContent = two("Auto-generate password", "admin_reset");
    el("a-tab-delete").textContent = two("Delete user", "admin_delete");
    el("a-region-l").textContent = two("Region", "admin_region");
    el("a-name-l").textContent = two("Centre name", "admin_name");
    el("a-address-l").textContent = two("Address (optional)", "admin_address");
    el("a-phone-l").textContent = two("Phone (optional)", "admin_phone");
    el("a-lat-l").textContent = two("Latitude", "admin_lat");
    el("a-lng-l").textContent = two("Longitude", "admin_lng");
    el("a-centre-btn").textContent = two("Add centre", "admin_add_btn");
    el("a-reset-q-l").textContent = two("Search by email", "admin_search_l");
    el("a-reset-search").textContent = two("Search", "admin_search_btn");
    el("a-delete-q-l").textContent = two("Search by email", "admin_search_l");
    el("a-delete-search").textContent = two("Search", "admin_search_btn");
    el("a-delete-type-l").textContent = two("Type the email to confirm", "admin_delete_type");
    el("a-delete-go").textContent = two("Delete account", "admin_delete_btn");
    el("a-reset-go").textContent = two("Generate password", "admin_reset_btn");
    el("a-copy").textContent = two("Copy", "admin_copy");
    el("a-temp-note").textContent = two("Shown once — pass it on securely. They must choose their own password at the next login.", "admin_temp_warn");
    const dl = el("a-regions"); dl.innerHTML = "";
    for (const r of REGIONS) { const o = document.createElement("option"); o.value = r; dl.appendChild(o); }
    adminTab("centre");
  }
  function closeAdmin() { el("admin").hidden = true; clearTemp(); }
  const ADMIN_TABS = [["centre", "a-centre", "a-tab-centre"], ["reset", "a-reset", "a-tab-reset"], ["delete", "a-delete", "a-tab-delete"]];
  function adminTab(which) {
    for (const [name, panel, tab] of ADMIN_TABS) { el(panel).hidden = name !== which; el(tab).classList.toggle("on", name === which); }
    el("a-msg").textContent = "";
  }
  const adminFail = (r) => r.status === 429 ? sayAdmin(two("Too many attempts. Please wait a few minutes.", "admin_rate"))
    : sayAdmin(two("Something went wrong. Please try again.", "admin_fail"));
  async function adminSearch(q, list, onPick, actionKey) {
    list.innerHTML = "";
    if (!q.trim()) return;
    const seq = ++searchSeq[actionKey];
    list.innerHTML = `<div class="a-row"><span class="who">…</span></div>`;
    const r = await api(`/api/admin/users?q=${encodeURIComponent(q.trim())}`);
    if (seq !== searchSeq[actionKey]) return;                      // a newer search has replaced this one
    list.innerHTML = "";
    if (!r.ok) return adminFail(r);
    const users = (await r.json()).users || [];
    if (!users.length) { list.innerHTML = `<div class="a-row"><span class="who">${two("No matching users.", "admin_no_results")}</span></div>`; return; }
    for (const u of users) {
      const row = document.createElement("div"); row.className = "a-row";
      const info = document.createElement("div");
      info.innerHTML = `<div class="who">${esc(u.email)}</div><div class="st">${esc(u.status || "")} · ${esc(u.state || "")}</div>`;
      const btn = document.createElement("button"); btn.type = "button";
      btn.textContent = two(actionKey === "reset" ? "Generate password" : "Delete account", actionKey === "reset" ? "admin_reset_btn" : "admin_delete_btn");
      btn.addEventListener("click", () => onPick(u));
      row.appendChild(info); row.appendChild(btn); list.appendChild(row);
    }
  }
  async function addCentre() {
    const btn = el("a-centre-btn"); btn.disabled = true;
    try {
      const body = {
        region: el("a-region").value.trim(), name: el("a-name").value.trim(),
        address: el("a-address").value.trim(), phone: el("a-phone").value.trim(),
        lat: el("a-lat").value, lng: el("a-lng").value,
      };
      const r = await api("/api/admin/centres", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 409) return sayAdmin(two("That centre already exists in this region.", "admin_dup"));
      if (r.status === 400) { const j = await r.json().catch(() => ({})); return sayAdmin(`${two("Please check:", "admin_invalid")} ${(j.fields || []).join(", ")}`); }
      if (r.status === 429 || !r.ok) return adminFail(r);
      const j = await r.json();
      REGIONS.includes(j.centre.r) ? null : REGIONS.push(j.centre.r);
      CENTRES.push(j.centre); if (typeof setCentres === "function") setCentres({ regions: REGIONS, centres: CENTRES });
      for (const id of ["a-name", "a-address", "a-phone", "a-lat", "a-lng"]) el(id).value = "";
      sayAdmin(two("Centre added.", "admin_added"));
    } finally { btn.disabled = false; }
  }
  async function searchUsers(list, onPick, actionKey) {
    const q = el(actionKey === "reset" ? "a-reset-q" : "a-delete-q").value;
    await adminSearch(q, list, onPick, actionKey);
  }
  function pickForReset(u) {
    adminPicked = u; clearTemp();
    el("a-reset-confirm").hidden = false;
    el("a-reset-warn").textContent = two(`Generate a temporary password for ${u.email}?`, "admin_reset_confirm", { e: u.email });
  }
  async function doReset() {
    if (!adminPicked) return;
    el("a-reset-go").disabled = true;
    try {
      const r = await api("/api/admin/users/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: adminPicked.user_id }) });
      if (!r.ok) return adminFail(r);
      const j = await r.json();
      tempPassword = j.temporary_password;
      el("a-temp").hidden = false;
      el("a-temp-for").textContent = two(`Temporary password for ${esc(j.email)}`, "admin_temp_for", { e: j.email });
      el("a-temp-pw").textContent = tempPassword;          // the only place it is ever shown
      el("a-copy").textContent = two("Copy", "admin_copy");
      sayAdmin("");
    } finally { el("a-reset-go").disabled = false; }
  }
  function clearTemp() {
    tempPassword = "";                                     // cleared from memory as well as the DOM
    el("a-temp").hidden = true;
    el("a-temp-pw").textContent = "";                     // cleared from the DOM when the dialog closes
    el("a-temp-for").textContent = "";
  }
  async function copyTemp() {
    if (!tempPassword) return;
    try { await navigator.clipboard.writeText(tempPassword); el("a-copy").textContent = two("Copied.", "admin_copied"); }
    catch (e) { /* clipboard blocked: the password is selected for a manual copy */ window.getSelection && window.getSelection().selectAllChildren(el("a-temp-pw")); }
  }
  function pickForDelete(u) {
    adminPicked = u; el("a-delete-type").value = "";
    el("a-delete-confirm").hidden = false;
    el("a-delete-warn").textContent = two(`This deletes the account (and cancels its subscription). Type ${u.email} to confirm.`, "admin_delete_warn", { e: u.email });
    el("a-delete-go").disabled = true;
  }
  async function doDelete() {
    if (!adminPicked) return;
    if (el("a-delete-type").value.trim().toLowerCase() !== String(adminPicked.email).toLowerCase()) return;
    el("a-delete-go").disabled = true;
    try {
      const r = await api("/api/admin/users/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: adminPicked.user_id }) });
      if (r.status === 409) return sayAdmin(two("You cannot delete your own account.", "admin_self"));
      if (r.status === 502) return sayAdmin(two("PayFast could not cancel the subscription, so nothing was deleted. Try again.", "admin_cancel_fail"));
      if (r.status === 429 || !r.ok) return adminFail(r);
      const j = await r.json();
      el("a-delete-confirm").hidden = true;
      el("a-delete-list").innerHTML = "";
      sayAdmin(two(`Account deleted. Subscription cancelled: ${j.subscription_cancelled ? "yes" : "no"}.`, "admin_deleted", { s: j.subscription_cancelled ? two("yes", "yes") : two("no", "no") }));
    } finally { el("a-delete-go").disabled = false; }
  }
  /* ---- wiring ---- */
  function wire() {
    el("m-login").addEventListener("submit", logIn);
    el("m-signup").addEventListener("submit", signUp);
    el("m-forgot").addEventListener("submit", sendRecover);
    el("m-mustchange").addEventListener("submit", changePassword);
    el("m-to-signup").addEventListener("click", () => { el("m-login-pass").value = ""; show("signup"); });
    el("m-to-login").addEventListener("click", () => show("login"));
    el("m-forgot-link").addEventListener("click", () => show("forgot"));
    el("m-forgot-back").addEventListener("click", () => show("login"));
    el("m-checkmail-back").addEventListener("click", () => show("login"));
    el("m-resend").addEventListener("click", resend);
    el("m-login-show").addEventListener("click", () => togglePassword("m-login-pass", el("m-login-show")));
    el("m-signup-show").addEventListener("click", () => togglePassword("m-signup-pass", el("m-signup-show")));
    el("m-newpass-show").addEventListener("click", () => togglePassword("m-newpass", el("m-newpass-show")));
    el("m-trial-start").addEventListener("click", () => { markTrialSeen(); hide(); window.TSHK_LOCKED = false; if (ent && ent.access) grant(); else check(); });
    el("m-trial-pay").addEventListener("click", subscribe);
    el("m-subscribe").addEventListener("click", subscribe);
    el("m-cancel").addEventListener("click", cancelSub);
    el("m-signout").addEventListener("click", signOut);
    el("m-close").addEventListener("click", () => (ent && ent.access ? hide() : show("paywall")));
    el("m-retry").addEventListener("click", () => check());
    el("m-features").addEventListener("click", () => show("trial"));
    el("m-admin").addEventListener("click", openAdmin);
    el("acct").addEventListener("click", () => { if (session) show("account"); });
    el("m-lang").addEventListener("change", () => { const s = el("lang"); s.value = el("m-lang").value; s.dispatchEvent(new Event("change")); });
    /* admin */
    el("a-close").addEventListener("click", closeAdmin);
    el("a-tab-centre").addEventListener("click", () => adminTab("centre"));
    el("a-tab-reset").addEventListener("click", () => adminTab("reset"));
    el("a-tab-delete").addEventListener("click", () => adminTab("delete"));
    el("a-centre-btn").addEventListener("click", addCentre);
    el("a-reset-search").addEventListener("click", () => searchUsers(el("a-reset-list"), pickForReset, "reset"));
    el("a-reset-q").addEventListener("keydown", (e) => { if (e.key === "Enter") searchUsers(el("a-reset-list"), pickForReset, "reset"); });
    el("a-reset-go").addEventListener("click", doReset);
    el("a-reset-cancel").addEventListener("click", () => { el("a-reset-confirm").hidden = true; clearTemp(); });
    el("a-copy").addEventListener("click", copyTemp);
    el("a-temp-close").addEventListener("click", clearTemp);
    el("a-delete-search").addEventListener("click", () => searchUsers(el("a-delete-list"), pickForDelete, "delete"));
    el("a-delete-q").addEventListener("keydown", (e) => { if (e.key === "Enter") searchUsers(el("a-delete-list"), pickForDelete, "delete"); });
    el("a-delete-type").addEventListener("input", () => {
      el("a-delete-go").disabled = !adminPicked || el("a-delete-type").value.trim().toLowerCase() !== String(adminPicked.email).toLowerCase();
    });
    el("a-delete-go").addEventListener("click", doDelete);
    el("a-delete-cancel").addEventListener("click", () => { el("a-delete-confirm").hidden = true; });
  }
  let started = false;
  function start() {
    if (started) return;
    started = true;
    wire();
    window.TSHK_LOCKED = true;
    const params = new URLSearchParams(location.search);
    const pay = params.get("payment");
    if (pay) history.replaceState(null, "", location.pathname);
    if (params.get("reset") === "done") setTimeout(() => say(two("Password updated. Log in with your new password.", "reset_done")), 100);
    if (!session) { updateChip(); return show("login"); }
    check(pay);
    setInterval(() => { if (session && !document.hidden && !view) check(); }, 6 * 60 * 60 * 1000);   // re-check every 6 hours
  }
  document.addEventListener("DOMContentLoaded", start);
  return {
    relang() {
      if (view && view !== "account" && view !== "trial") show(view, el("m-msg").textContent);
      else if (view === "account") show("account");
      updateChip();
    },
    check,
    get ent() { return ent; }
  };
})();
