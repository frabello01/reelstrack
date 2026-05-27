/*
 * Date helpers — all daily aggregations now report in Italy time
 * (Europe/Rome). This way the "day" boundary in the UI matches Italy's
 * calendar day (00:00–23:59 Italy local), and the crons fire right
 * after Italy midnight regardless of DST.
 *
 * We rely on the standard Intl API (Node 13+) — no extra dependencies.
 */

const TZ = 'Europe/Rome';

// Format a Date (or "now" if omitted) as YYYY-MM-DD in Italy local time.
// 'en-CA' formatting happens to produce the ISO date layout.
function italyDate(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

// Italy date string of "today minus N days". N=0 → today Italy. N=1 → yesterday
// Italy. Works correctly across DST shifts because we step in UTC instants
// and let the formatter compute the Italy date.
function italyDateNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return italyDate(d);
}

// Build a list of the last N Italy date strings, oldest → newest.
// Example: italyLastNDates(3) on Italy May 28 → ['2026-05-26','2026-05-27','2026-05-28']
function italyLastNDates(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(italyDateNDaysAgo(i));
  return out;
}

// Italy date string of any timestamp / ISO date / Date instance.
function italyDateOf(ts) {
  if (!ts) return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  return italyDate(d);
}

// ISO timestamp for "start of N-days-ago Italy day", conservative (returns
// the start of N+1-days-ago UTC day so SQL .gte() over-fetches by up to ~25h,
// which we filter precisely in the bucketing step).
function italyPeriodStartIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days - 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// Next-day helper: given 'YYYY-MM-DD', return the next Italy day string.
function nextDayIso(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  // dt is now midnight UTC of the day after. Since we're operating on date
  // strings (no time component) the calendar-day arithmetic is identical
  // whether we use UTC or local — both go +1 day.
  return dt.toISOString().slice(0, 10);
}

module.exports = {
  TZ,
  italyDate,
  italyDateNDaysAgo,
  italyLastNDates,
  italyDateOf,
  italyPeriodStartIso,
  nextDayIso,
};
