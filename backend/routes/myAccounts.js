const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { fetchAccount, runMyAccountsFetch } = require('../services/myAccountsService');

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
  const [viewsSeries, followersSeries, reelsSeries] = await Promise.all([
    getViewsPerDay(account.id, 30),
    getFollowersPerDay(account.id, 30),
    getReelsPerDay(account.id, 30),
  ]);

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
    },
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

// Views per day for last N days based on `posted_at` of reels.
// (i.e., how much "view-power" was published each day across all the account's reels in that window)
async function getViewsPerDay(accountId, days) {
  const since = periodStart(days);
  const { data } = await supabase
    .from('account_reels')
    .select('views, posted_at')
    .eq('account_id', accountId)
    .gte('posted_at', since);

  const buckets = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  (data || []).forEach((r) => {
    const day = r.posted_at.slice(0, 10);
    if (buckets[day] !== undefined) buckets[day] += r.views || 0;
  });

  return Object.entries(buckets)
    .map(([date, views]) => ({ date, value: views }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getFollowersPerDay(accountId, days) {
  const sinceDate = periodStart(days).slice(0, 10);
  const { data } = await supabase
    .from('account_snapshots')
    .select('snapshot_date, follower_count')
    .eq('account_id', accountId)
    .gte('snapshot_date', sinceDate)
    .order('snapshot_date', { ascending: true });
  return (data || []).map((s) => ({ date: s.snapshot_date, value: s.follower_count }));
}

async function getReelsPerDay(accountId, days) {
  const since = periodStart(days);
  const { data } = await supabase
    .from('account_reels')
    .select('posted_at')
    .eq('account_id', accountId)
    .gte('posted_at', since);

  const buckets = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  (data || []).forEach((r) => {
    const day = r.posted_at.slice(0, 10);
    if (buckets[day] !== undefined) buckets[day] += 1;
  });
  return Object.entries(buckets)
    .map(([date, count]) => ({ date, value: count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = router;
