const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { fetchAccount, runMyAccountsFetch } = require('../services/myAccountsService');
const { italyDateOf, italyDateNDaysAgo, italyLastNDates, italyPeriodStartIso, nextDayIso } = require('../lib/dateUtils');

// ----- Helpers ---------------------------------------------------

function periodStart(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Compute analytics for an account over a given period.
// We compute "X published in last N days" from the account_reels table
// and "follower_count delta" from account_snapshots.
async function computePeriodMetrics(accountId, days) {
  const sinceISO = periodStart(days);
  const sincePrevISO = periodStart(days * 2);

  // ----- Reels in this period -----
  const { data: thisPeriodReels } = await supabase
    .from('account_reels')
    .select('views')
    .eq('account_id', accountId)
    .gte('posted_at', sinceISO);

  const { data: prevPeriodReels } = await supabase
    .from('account_reels')
    .select('views')
    .eq('account_id', accountId)
    .gte('posted_at', sincePrevISO)
    .lt('posted_at', sinceISO);

  const reels = thisPeriodReels || [];
  const reelsPrev = prevPeriodReels || [];

  const sumViews = (rs) => rs.reduce((s, r) => s + (r.views || 0), 0);
  const countAbove = (rs, threshold) => rs.filter((r) => (r.views || 0) >= threshold).length;

  const cumulativeViews = sumViews(reels);
  const cumulativeViewsPrev = sumViews(reelsPrev);

  // ----- Follower delta from snapshots -----
  const sinceDate = sinceISO.slice(0, 10);
  const sincePrevDate = sincePrevISO.slice(0, 10);

  const { data: oldestThisPeriod } = await supabase
    .from('account_snapshots')
    .select('follower_count, snapshot_date')
    .eq('account_id', accountId)
    .gte('snapshot_date', sinceDate)
    .order('snapshot_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: latestSnapshot } = await supabase
    .from('account_snapshots')
    .select('follower_count, snapshot_date')
    .eq('account_id', accountId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: oldestPrevPeriod } = await supabase
    .from('account_snapshots')
    .select('follower_count, snapshot_date')
    .eq('account_id', accountId)
    .gte('snapshot_date', sincePrevDate)
    .lt('snapshot_date', sinceDate)
    .order('snapshot_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  const followerDelta = (oldestThisPeriod && latestSnapshot)
    ? (latestSnapshot.follower_count || 0) - (oldestThisPeriod.follower_count || 0)
    : null;

  const followerDeltaPrev = (oldestPrevPeriod && oldestThisPeriod)
    ? (oldestThisPeriod.follower_count || 0) - (oldestPrevPeriod.follower_count || 0)
    : null;

  return {
    reels_published: reels.length,
    reels_published_prev: reelsPrev.length,
    cumulative_views: cumulativeViews,
    cumulative_views_prev: cumulativeViewsPrev,
    above_10k: countAbove(reels, 10_000),
    above_50k: countAbove(reels, 50_000),
    above_100k: countAbove(reels, 100_000),
    above_10k_prev: countAbove(reelsPrev, 10_000),
    above_50k_prev: countAbove(reelsPrev, 50_000),
    above_100k_prev: countAbove(reelsPrev, 100_000),
    follower_delta: followerDelta,
    follower_delta_prev: followerDeltaPrev,
  };
}

// ----- Routes ---------------------------------------------------

// GET all my accounts (with quick metrics for the cards)
router.get('/', async (req, res) => {
  const { data: accounts, error } = await supabase
    .from('my_accounts')
    .select('*')
    .order('username');
  if (error) return res.status(500).json({ error: error.message });

  // Compute 7-day metrics for each (for the card sparkline + headline number)
  const enriched = await Promise.all(
    (accounts || []).map(async (a) => {
      const metrics7d = await computePeriodMetrics(a.id, 7);
      // Sparkline data: views per day for last 7 days
      const sparkline = await getViewsPerDay(a.id, 7);
      return { ...a, metrics_7d: metrics7d, sparkline };
    })
  );
  res.json(enriched);
});

// GET single account with FULL detail (all 3 periods + chart data)
router.get('/:id', async (req, res) => {
  const { data: account, error } = await supabase
    .from('my_accounts')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const [m7, m14, m30] = await Promise.all([
    computePeriodMetrics(account.id, 7),
    computePeriodMetrics(account.id, 14),
    computePeriodMetrics(account.id, 30),
  ]);

  // Chart data — daily series for the last 30 days
  const [viewsSeries, followersSeries, reelsSeries, clicksSeries, subsSeries, linkedLandings] = await Promise.all([
    getViewsPerDay(account.id, 30),
    getFollowersPerDay(account.id, 30),
    getReelsPerDay(account.id, 30),
    getLandingClicksPerDay(account.id, 30),
    getLandingSubsPerDay(account.id, 30),
    getLinkedLandings(account.id),
  ]);

  // Activity table data: row per day with views, new followers, clicks,
  // new subs (from Infloww), and the REAL convert rate (subs / clicks).
  // Deltas are computed as "next snapshot - this snapshot" so the day
  // they're assigned to is the day the activity actually occurred,
  // aligning them with click counts that are bucketed by calendar day.
  const activity = buildDailyActivity(viewsSeries, followersSeries, clicksSeries, subsSeries);

  // Top 10 reels by views (within last 30 days)
  const { data: topReels } = await supabase
    .from('account_reels')
    .select('id, shortcode, url, thumbnail_url, caption, views, likes, comments, posted_at')
    .eq('account_id', account.id)
    .gte('posted_at', periodStart(30))
    .order('views', { ascending: false })
    .limit(10);

  res.json({
    ...account,
    metrics: { '7d': m7, '14d': m14, '30d': m30 },
    charts: {
      views_per_day: viewsSeries,
      followers_per_day: followersSeries,
      reels_per_day: reelsSeries,
      clicks_per_day: clicksSeries,
      subs_per_day: subsSeries,
    },
    activity,
    linked_landings: linkedLandings,
    top_reels: topReels || [],
  });
});

// POST add account
router.post('/', async (req, res) => {
  const { username, display_name } = req.body;
  if (!username) return res.status(400).json({ error: 'username is required' });
  const clean = username.replace('@', '').toLowerCase().trim();

  const { data, error } = await supabase
    .from('my_accounts')
    .insert({ username: clean, display_name: display_name || clean })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Account already exists' });
    return res.status(500).json({ error: error.message });
  }

  // Trigger an immediate fetch in the background so the card has data right away
  fetchAccount(data).catch((err) => console.error('[POST my-accounts] initial fetch failed:', err.message));

  res.json(data);
});

// DELETE account
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('my_accounts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST trigger manual fetch (all or specific account)
router.post('/fetch/run', async (req, res) => {
  const { account_id } = req.body;
  res.json({ message: 'Fetch started' });
  try {
    await runMyAccountsFetch(account_id ? [account_id] : null);
  } catch (err) {
    console.error('[my-accounts/fetch] failed:', err.message);
  }
});

// ----- Series helpers -------------------------------------------

// TRUE views received per day for last N days, computed from per-reel
// daily snapshots. For each reel:
//   day D's contribution = snapshot[D+1].views - snapshot[D].views
// Then we sum across all reels of the account.
//
// This represents the actual audience reached on day D — what people
// watched that day — regardless of when each reel was posted. Reels
// published months ago still contribute if they kept accumulating views.
//
// For days where consecutive snapshots don't exist (anywhere before the
// snapshot system started, or for newly-added reels with one snapshot)
// the bucket stays 0 — we don't fabricate a delta we can't verify.
async function getViewsPerDay(accountId, days) {
  const buckets = {};
  italyLastNDates(days).forEach((d) => { buckets[d] = 0; });
  const out = () => Object.entries(buckets)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Need one extra day of history so we can compute the oldest delta.
  // Over-fetch a tiny bit in the SQL filter; precise filtering happens
  // via Italy-date strings below.
  const { data: snaps } = await supabase
    .from('account_reel_snapshots')
    .select('reel_id, snapshot_date, views')
    .eq('account_id', accountId)
    .gte('snapshot_date', italyDateNDaysAgo(days + 1))
    .order('snapshot_date', { ascending: true });

  if (!snaps || snaps.length === 0) return out();

  // Group: reelId -> Map(date -> views)
  const byReelDay = new Map();
  for (const s of snaps) {
    if (!byReelDay.has(s.reel_id)) byReelDay.set(s.reel_id, new Map());
    byReelDay.get(s.reel_id).set(s.snapshot_date, Number(s.views || 0));
  }

  for (const day of Object.keys(buckets)) {
    const nextDay = nextDayIso(day);
    let sum = 0;
    for (const dateMap of byReelDay.values()) {
      const today = dateMap.get(day);
      const tomorrow = dateMap.get(nextDay);
      if (today != null && tomorrow != null) {
        sum += Math.max(0, tomorrow - today);
      }
    }
    buckets[day] = sum;
  }

  return out();
}

async function getFollowersPerDay(accountId, days) {
  const { data } = await supabase
    .from('account_snapshots')
    .select('snapshot_date, follower_count')
    .eq('account_id', accountId)
    .gte('snapshot_date', italyDateNDaysAgo(days))
    .order('snapshot_date', { ascending: true });
  return (data || []).map((s) => ({ date: s.snapshot_date, value: s.follower_count }));
}

async function getReelsPerDay(accountId, days) {
  const { data } = await supabase
    .from('account_reels')
    .select('posted_at')
    .eq('account_id', accountId)
    .gte('posted_at', italyPeriodStartIso(days));

  const buckets = {};
  italyLastNDates(days).forEach((d) => { buckets[d] = 0; });
  (data || []).forEach((r) => {
    const day = italyDateOf(r.posted_at);
    if (buckets[day] !== undefined) buckets[day] += 1;
  });
  return Object.entries(buckets)
    .map(([date, count]) => ({ date, value: count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Clicks per day, aggregated across all landings linked to this my_account.
async function getLandingClicksPerDay(accountId, days) {
  // First find all landings linked to this account
  const { data: landings } = await supabase
    .from('landings')
    .select('id')
    .eq('my_account_id', accountId);

  if (!landings || landings.length === 0) {
    return zeroSeries(days);
  }
  const landingIds = landings.map((l) => l.id);

  const { data: clicks } = await supabase
    .from('landing_link_clicks')
    .select('clicked_at')
    .in('landing_id', landingIds)
    .gte('clicked_at', italyPeriodStartIso(days));

  const buckets = {};
  italyLastNDates(days).forEach((d) => { buckets[d] = 0; });
  (clicks || []).forEach((c) => {
    const day = italyDateOf(c.clicked_at);
    if (buckets[day] !== undefined) buckets[day] += 1;
  });
  return Object.entries(buckets)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Lists landings linked to this account, including lifetime click count.
async function getLinkedLandings(accountId) {
  const { data: landings } = await supabase
    .from('landings')
    .select('id, slug, host, title, published, landing_links(click_count)')
    .eq('my_account_id', accountId)
    .order('created_at', { ascending: true });
  return (landings || []).map((l) => ({
    id: l.id,
    slug: l.slug,
    host: l.host,
    title: l.title,
    published: l.published,
    total_clicks: (l.landing_links || []).reduce((s, x) => s + (x.click_count || 0), 0),
  }));
}

// Builds the per-day activity table.
//
// Day-labelling: each row represents activity DURING that calendar day.
// So a delta like "new followers on May 27" is computed as:
//   (snapshot taken at 00:05 UTC May 28) - (snapshot taken at 00:05 UTC May 27)
// i.e. next-day-snapshot minus this-day-snapshot. This aligns with click and
// subs counts that are bucketed by clicked_at / snapshot calendar day, so
// every column on a row refers to the same 24h window.
//
// Today's row therefore has null deltas (because tomorrow's snapshot doesn't
// exist yet) — that's accurate, not a bug.
function buildDailyActivity(viewsSeries, followersSeries, clicksSeries, subsSeries) {
  const viewsByDay = Object.fromEntries((viewsSeries || []).map((r) => [r.date, r.value]));
  const clicksByDay = Object.fromEntries((clicksSeries || []).map((r) => [r.date, r.value]));
  const subsByDay = Object.fromEntries((subsSeries || []).map((r) => [r.date, r.value]));

  // Sorted, deduped union of all reporting days.
  const days = [...new Set([
    ...Object.keys(viewsByDay),
    ...Object.keys(clicksByDay),
    ...Object.keys(subsByDay),
    ...(followersSeries || []).map((s) => s.date),
  ])].sort();

  // Forward-fill follower-count map so any day without a snapshot inherits
  // the previous day's value. This is the cumulative snapshot, not a delta.
  const followersSorted = [...(followersSeries || [])].sort((a, b) => a.date.localeCompare(b.date));
  let lastFollowerCount = null;
  const followerOnDay = {};
  let snapIdx = 0;
  for (const day of days) {
    while (snapIdx < followersSorted.length && followersSorted[snapIdx].date <= day) {
      lastFollowerCount = followersSorted[snapIdx].value;
      snapIdx++;
    }
    followerOnDay[day] = lastFollowerCount;
  }

  const rows = [];
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const nextDay = days[i + 1] || null;

    const views = viewsByDay[day] || 0;
    const clicks = clicksByDay[day] || 0;

    // Followers DURING this day = (next-day snapshot) - (this-day snapshot)
    const currentFollower = followerOnDay[day];
    const nextFollower = nextDay ? followerOnDay[nextDay] : null;
    const newFollowers = (currentFollower != null && nextFollower != null)
      ? nextFollower - currentFollower
      : null;

    // Subs DURING this day: subsByDay already represents the per-day delta,
    // computed elsewhere from Infloww snapshots using the same shift logic.
    const newSubs = subsByDay[day];

    // Real convert rate: subs / clicks. Falls back to null if either is unknown.
    const convertRate = (newSubs != null && clicks > 0) ? (newSubs / clicks) * 100 : null;

    rows.push({
      date: day,
      views,
      clicks,
      new_followers: newFollowers,
      new_subs: newSubs ?? null,
      convert_rate: convertRate,
    });
  }
  // Newest first for the UI
  return rows.reverse();
}

// Daily NEW subs (delta of cumulative sub_count between consecutive snapshots)
// across every Infloww tracking-link that's bound to a landing_link that
// belongs to one of this my_account's landings.
//
// We do the delta arithmetic here so the activity-table builder can just
// treat it as another per-day series like clicks/views.
async function getLandingSubsPerDay(myAccountId, days) {
  // 1) Find landings for this IG profile
  const { data: landings } = await supabase
    .from('landings')
    .select('id')
    .eq('my_account_id', myAccountId);

  // Zero-filled buckets fallback (Italy days) — keeps the chart rendering
  // even with no data.
  const zeroBuckets = {};
  italyLastNDates(days).forEach((d) => { zeroBuckets[d] = 0; });
  const zeroOut = () => Object.entries(zeroBuckets)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!landings || landings.length === 0) return zeroOut();
  const landingIds = landings.map((l) => l.id);

  // 2) Find landing_link ids for these landings
  const { data: lLinks } = await supabase
    .from('landing_links')
    .select('id')
    .in('landing_id', landingIds);
  if (!lLinks || lLinks.length === 0) return zeroOut();
  const landingLinkIds = lLinks.map((x) => x.id);

  // 3) Find Infloww links bound to those landing_links
  const { data: inflowwLinks } = await supabase
    .from('infloww_tracking_links')
    .select('infloww_link_id')
    .in('landing_link_id', landingLinkIds);
  if (!inflowwLinks || inflowwLinks.length === 0) return zeroOut();
  const inflowwIds = inflowwLinks.map((x) => x.infloww_link_id);

  // 4) Pull snapshots for those links, oldest first (one extra day of
  // history so we can compute delta on the oldest reporting day).
  const { data: snaps } = await supabase
    .from('infloww_tracking_link_snapshots')
    .select('infloww_link_id, snapshot_date, sub_count')
    .in('infloww_link_id', inflowwIds)
    .gte('snapshot_date', italyDateNDaysAgo(days + 1))
    .order('snapshot_date', { ascending: true });

  if (!snaps || snaps.length === 0) return zeroOut();

  // Group snapshots by (link_id, date) — one row per link per day.
  const byLinkDay = new Map();
  for (const s of snaps) {
    if (!byLinkDay.has(s.infloww_link_id)) byLinkDay.set(s.infloww_link_id, new Map());
    byLinkDay.get(s.infloww_link_id).set(s.snapshot_date, Number(s.sub_count || 0));
  }

  // For each reporting day, delta = (next-day snapshot) - (this-day snapshot)
  // summed across links. Day D's value = activity DURING day D.
  const result = { ...zeroBuckets };
  for (const day of Object.keys(zeroBuckets).sort()) {
    const nextDay = nextDayIso(day);
    let delta = 0;
    let haveAny = false;
    for (const dateMap of byLinkDay.values()) {
      const today = dateMap.get(day);
      const tomorrow = dateMap.get(nextDay);
      if (today != null && tomorrow != null) {
        delta += (tomorrow - today);
        haveAny = true;
      }
    }
    result[day] = haveAny ? delta : 0;
  }

  return Object.entries(result)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function zeroSeries(days) {
  return italyLastNDates(days).map((date) => ({ date, value: 0 }));
}

// PATCH update account_info (free-text notes about the IG account — no passwords)
router.patch('/:id', async (req, res) => {
  const { account_info } = req.body;
  if (account_info === undefined) {
    return res.status(400).json({ error: 'account_info is required' });
  }

  const { data, error } = await supabase
    .from('my_accounts')
    .update({ account_info: account_info || null })
    .eq('id', req.params.id)
    .select('id, account_info')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
