// Single source of truth for "may this member use the app right now?"
export function addMonths(date, n) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
/* paid_through = end of the month already paid for. Access continues for graceDays after it,
   because PayFast's monthly charge and its notification can arrive a little after the date. */
export function entitlement(m, { now = new Date(), graceDays = 3 } = {}) {
  if (!m) return { access: false, state: "none" };
  const t = now.getTime();
  const paid = m.paid_through ? Date.parse(m.paid_through) : 0;
  const paidAccess = paid ? paid + graceDays * 86400000 : 0;
  const trial = m.trial_ends_at ? Date.parse(m.trial_ends_at) : 0;
  if ((m.status === "active" || m.status === "cancelled") && paidAccess > t) {
    return { access: true, state: m.status === "active" ? "active" : "cancelled", access_until: new Date(m.status === "active" ? paidAccess : paid).toISOString(), paid_through: new Date(paid).toISOString(), renews: m.status === "active" };
  }
  if (trial > t) return { access: true, state: "trial", access_until: new Date(trial).toISOString(), days_left: Math.max(1, Math.ceil((trial - t) / 86400000)) };
  if (m.status === "active") return { access: false, state: "past_due" };
  if (m.status === "trialing") return { access: false, state: "trial_ended" };
  return { access: false, state: "expired" };
}
