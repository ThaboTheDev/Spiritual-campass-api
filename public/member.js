/* ---------- Membership ----------
   Sign-in with an emailed code (Supabase Auth), 7-day free trial, then R100 per month through PayFast.
   The server (/api/*) decides access; this file shows the right screen and loads the centres for members.
   Loaded before app.js; starts on DOMContentLoaded, after app.js has run. */
var REGIONS = [], CENTRES = [];            // filled from /api/centres once access is confirmed

const MEMBER = (function () {
  const CFG = window.TSHK_CONFIG || {};
  const SKEY = "tshk-session", EKEY = "tshk-ent", CKEY = "tshk-centres";
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const el = (id) => document.getElementById(id);
  const t = (key, vars) => (typeof T === "function" ? T(key, vars) : "");
  const two = (en, key, vars) => (typeof bi === "function" ? bi(en, t(key, vars)) : en);
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

  let session = store.get(SKEY), ent = null, email = "", view = null, granted = false, cancelArmed = false;

  /* ---- Supabase Auth over HTTPS (no library needed) ---- */
  async function authPost(path, body) {
    const r = await fetch(`${CFG.SUPABASE_URL}/auth/v1/${path}`, {
      method: "POST", headers: { apikey: CFG.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.msg || j.error_description || j.message || ("HTTP " + r.status)), { status: r.status });
    return j;
  }
  function saveSession(j) {
    session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || email };
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
  function signOutLocal() { session = null; ent = null; granted = false; store.del(SKEY); store.del(EKEY); store.del(CKEY); }

  /* ---- screens ---- */
  function show(v, msg) {
    view = v; cancelArmed = false;
    const box = el("member"); box.hidden = false; document.body.classList.add("locked");
    for (const id of ["m-auth-email", "m-auth-code", "m-pay", "m-account", "m-retry", "m-cancel"]) el(id).hidden = true;
    el("m-price").textContent = CFG.PRICE_LABEL || "R100";
    el("m-close").hidden = true; el("m-signout").hidden = !session;
    el("m-msg").textContent = msg || "";
    const title = el("m-title"), sub = el("m-sub");
    const store_ = !!CFG.STORE_BUILD;
    if (v === "email") { title.textContent = two("Sign in to continue", "auth_title"); sub.textContent = two(`Free for ${CFG.TRIAL_DAYS || 7} days, then ${CFG.PRICE_LABEL || "R100"} per month.`, "trial_offer", { n: CFG.TRIAL_DAYS || 7, p: CFG.PRICE_LABEL || "R100" }); el("m-auth-email").hidden = false; }
    else if (v === "code") { title.textContent = two("Check your email", "auth_check"); sub.textContent = two(`Enter the code sent to ${email}`, "auth_code", { e: email }); el("m-auth-code").hidden = false; setTimeout(() => el("m-code").focus(), 50); }
    else if (v === "loading") { title.textContent = two("Checking your membership…", "pay_checking"); sub.textContent = ""; }
    else if (v === "confirming") { title.textContent = two("Confirming your payment…", "pay_confirming"); sub.textContent = two("This usually takes a few seconds.", "pay_wait"); }
    else if (v === "offline") { title.textContent = two("Connect to the internet to check your membership", "pay_offline"); sub.textContent = ""; el("m-retry").hidden = false; }
    else if (v === "paywall") {
      const s = ent && ent.state;
      title.textContent = s === "past_due" ? two("We have not received this month's payment", "pay_pastdue")
        : s === "expired" ? two("Your membership has ended", "pay_expired")
        : two("Your free trial has ended", "trial_ended");
      sub.textContent = store_ ? two("A membership is needed. Please sign in with a member account.", "pay_store")
        : two(`Continue with a monthly membership of ${CFG.PRICE_LABEL || "R100"}. Cancel any time.`, "pay_offer", { p: CFG.PRICE_LABEL || "R100" });
      el("m-pay").hidden = store_;
    }
    else if (v === "account") {
      title.textContent = two("Account", "account"); sub.textContent = (session && session.email) || "";
      el("m-account").hidden = false; el("m-close").hidden = false;
      el("m-state").textContent = stateLine();
      el("m-pay").hidden = store_ || !(ent && (ent.state === "trial" || !ent.access));
      el("m-cancel").hidden = !(ent && ent.can_cancel);
      el("m-cancel").textContent = two("Cancel subscription", "pay_cancel");
    }
    el("m-subscribe").textContent = two(`Subscribe · ${CFG.PRICE_LABEL || "R100"} per month`, "pay_btn", { p: CFG.PRICE_LABEL || "R100" });
    el("m-send").textContent = two("Send code", "auth_send");
    el("m-verify").textContent = two("Sign in", "auth_verify");
    el("m-change").textContent = two("Use a different email", "auth_change");
    el("m-email-l").textContent = two("Your email address", "auth_email");
    el("m-code-l").textContent = two("6-digit code", "auth_code_l");
    el("m-signout").textContent = two("Sign out", "pay_signout");
    el("m-close").textContent = two("Close", "close");
    el("m-retry").textContent = two("Try again", "retry");
    el("m-lang").value = typeof LANG !== "undefined" ? LANG : "zu";
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
    if (r.status === 401) { signOutLocal(); updateChip(); return show("email"); }
    if (!r.ok) return offline();
    ent = await r.json(); store.set(EKEY, { ...ent, checked: Date.now() }); updateChip();
    if (pay === "success" && ent.state !== "active") return confirming(0);
    if (ent.access) return grant();
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
  function grant() { hide(); if (granted) return; granted = true; loadCentres(); }
  async function loadCentres() {
    try {
      const r = await api("/api/centres");
      if (r.ok) { const d = await r.json(); store.set(CKEY, d); return setCentres(d); }
    } catch (e) {}
    const d = store.get(CKEY); if (d) setCentres(d);
  }

  /* ---- actions ---- */
  async function sendCode(ev) {
    ev.preventDefault();
    email = el("m-email").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { el("m-msg").textContent = two("Please enter a valid email address.", "auth_bad_email"); return; }
    el("m-send").disabled = true;
    try { await authPost("otp", { email, create_user: true }); show("code"); }
    catch (e) { el("m-msg").textContent = two("Could not send the code. Please try again.", "auth_send_fail") + " (" + e.message + ")"; }
    finally { el("m-send").disabled = false; }
  }
  async function verify(ev) {
    ev.preventDefault();
    const code = el("m-code").value.replace(/\D/g, "");
    if (code.length < 6) { el("m-msg").textContent = two("Enter the code from the email.", "auth_bad_code"); return; }
    el("m-verify").disabled = true;
    try { saveSession(await authPost("verify", { type: "email", email, token: code })); await check(); }
    catch (e) { el("m-msg").textContent = two("That code did not work. Check it or request a new one.", "auth_wrong_code"); }
    finally { el("m-verify").disabled = false; }
  }
  async function subscribe() {
    el("m-subscribe").disabled = true; el("m-msg").textContent = "";
    try {
      const r = await api("/api/payfast/checkout", { method: "POST" });
      if (r.status === 409) { await check(); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const { action, fields } = await r.json();
      const f = document.createElement("form"); f.method = "POST"; f.action = action; f.style.display = "none";
      for (const [k, v] of Object.entries(fields)) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i); }
      document.body.appendChild(f); f.submit();
    } catch (e) {
      el("m-msg").textContent = two("Could not open PayFast. Please try again.", "pay_open_fail");
      el("m-subscribe").disabled = false;
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
    } catch (e) { el("m-msg").textContent = two("Could not cancel right now. Please try again later.", "pay_cancel_fail"); }
    finally { el("m-cancel").disabled = false; }
  }
  function signOut() { signOutLocal(); updateChip(); show("email"); }

  function wire() {
    el("m-auth-email").addEventListener("submit", sendCode);
    el("m-auth-code").addEventListener("submit", verify);
    el("m-change").addEventListener("click", () => show("email"));
    el("m-subscribe").addEventListener("click", subscribe);
    el("m-cancel").addEventListener("click", cancelSub);
    el("m-signout").addEventListener("click", signOut);
    el("m-close").addEventListener("click", () => (ent && ent.access ? hide() : show("paywall")));
    el("m-retry").addEventListener("click", () => check());
    el("acct").addEventListener("click", () => { if (session) show("account"); });
    el("m-lang").addEventListener("change", () => { const s = el("lang"); s.value = el("m-lang").value; s.dispatchEvent(new Event("change")); });
  }
  function start() {
    wire();
    const params = new URLSearchParams(location.search);
    const pay = params.get("payment");
    if (pay) history.replaceState(null, "", location.pathname);
    if (!session) { updateChip(); return show("email"); }
    check(pay);
    setInterval(() => { if (session && !document.hidden && !view) check(); }, 6 * 60 * 60 * 1000);   // re-check every 6 hours
  }
  document.addEventListener("DOMContentLoaded", start);
  return { relang() { if (view && view !== "account") show(view, el("m-msg").textContent); else if (view === "account") show("account"); updateChip(); }, check, get ent() { return ent; } };
})();
