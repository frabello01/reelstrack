const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { fetchAccount, runMyAccountsFetch } = require('../services/myAccountsService');
const { uploadImageDataUrl } = require('../lib/imageUpload');

// ----- Helpers ---------------------------------------------------

function periodStart(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const sumViews = (rs) => rs.reduce((s, r) => s + (r.views || 0), 0);
const countAbove = (rs, threshold) => rs.filter((r) => (r.views || 0) >= threshold).length;

/**
 * Compute the aggregate period metrics across ALL profiles owned by a talent.
 * Returns sums plus a per-profile breakdown so the UI can show "@profile1 contributed X".
 */
async function computeTalentMetrics(talentId, days) {
  const sinceISO = periodStart(days);
  const sincePrevISO = periodStart(days * 2);

  // Get this talent's profiles
  const { data: profiles } = await supabase
    .from('my_accounts')
    .select('id, username, display_name, status, follower_count')
    .eq('talent_id', talentId);

  if (!profiles || profiles.length === 0) {
    return null;
  }

  const profileIds = profiles.map((p) => p.id);

  // Reels in this period across all profiles
  const { data: thisReels } = await supabase
    .from('account_reels')
    .select('account_id, views')
    .in('account_id', profileIds)
    .gte('posted_at', sinceISO);

  // Reels in the previous period (for comparison)
  const { data: prevReels } = await supabase
    .from('account_reels')
    .select('account_id, views')
    .in('account_id', profileIds)
    .gte('posted_at', sincePrevISO)
    .lt('posted_at', sinceISO);

  const reels = thisReels || [];
  const reelsPrev = prevReels || [];

  // Per-profile breakdown of THIS period
  const breakdown = profiles.map((p) => {
    const myReels = reels.filter((r) => r.account_id === p.id);
    return {
      profile_id: p.id,
      username: p.username,
      display_name: p.display_name,
      status: p.status,
      follower_count: p.follower_count,
      reels_published: myReels.length,
      cumulative_views: sumViews(myReels),
      above_10k: countAbove(myReels, 10_000),
      above_50k: countAbove(myReels, 50_000),
      above_100k: countAbove(myReels, 100_000),
    };
  });

  // Aggregates
  const cumulativeViews = sumViews(reels);
  const cumulativeViewsPrev = sumViews(reelsPrev);

  // Followers: sum only active profiles
  const activeProfiles = profiles.filter((p) => p.status === 'active');
  const totalFollowersActive = activeProfiles.reduce((s, p) => s + (p.follower_count || 0), 0);

  // "Lost to bans" — followers on profiles that are now inactive/banned/private/error
  const lostToBans = profiles
    .filter((p) => p.status && p.status !== 'active' && p.status !== 'unknown')
    .reduce((s, p) => s + (p.follower_count || 0), 0);

  // Follower DELTA across active profiles, derived from snapshots.
  // We sum follower_count from the earliest snapshot inside the window AND the latest.
  const sinceDate = sinceISO.slice(0, 10);
  const sincePrevDate = sincePrevISO.slice(0, 10);

  const { data: allSnapshots } = await supabase
    .from('account_snapshots')
    .select('account_id, snapshot_date, follower_count')
    .in('account_id', activeProfiles.map((p) => p.id))
    .gte('snapshot_date', sincePrevDate)
    .order('snapshot_date', { ascending: true });

  // Build per-account first/last/middle markers in O(n)
  const earliestThisByAccount = new Map();
  const latestByAccount = new Map();
  const earliestPrevByAccount = new Map();
  for (const s of allSnapshots || []) {
    if (!latestByAccount.has(s.account_id) || s.snapshot_date > latestByAccount.get(s.account_id).snapshot_date) {
      latestByAccount.set(s.account_id, s);
    }
    if (s.snapshot_date >= sinceDate) {
      if (!earliestThisByAccount.has(s.account_id)) {
        earliestThisByAccount.set(s.account_id, s);
      }
    } else {
      if (!earliestPrevByAccount.has(s.account_id)) {
        earliestPrevByAccount.set(s.account_id, s);
      }
    }
  }

  let followerDelta = null;
  let followerDeltaPrev = null;
  if (activeProfiles.length > 0) {
    let deltaSum = 0; let prevDeltaSum = 0; let havePairs = 0; let havePrevPairs = 0;
    for (const p of activeProfiles) {
      const earliest = earliestThisByAccount.get(p.id);
      const latest = latestByAccount.get(p.id);
      if (earliest && latest) {
        deltaSum += (latest.follower_count || 0) - (earliest.follower_count || 0);
        havePairs++;
      }
      const earliestPrev = earliestPrevByAccount.get(p.id);
      if (earliestPrev && earliest) {
        prevDeltaSum += (earliest.follower_count || 0) - (earliestPrev.follower_count || 0);
        havePrevPairs++;
      }
    }
    if (havePairs > 0) followerDelta = deltaSum;
    if (havePrevPairs > 0) followerDeltaPrev = prevDeltaSum;
  }

  return {
    profiles_count: profiles.length,
    active_profiles_count: activeProfiles.length,
    cumulative_views: cumulativeViews,
    cumulative_views_prev: cumulativeViewsPrev,
    reels_published: reels.length,
    reels_published_prev: reelsPrev.length,
    above_10k: countAbove(reels, 10_000),
    above_50k: countAbove(reels, 50_000),
    above_100k: countAbove(reels, 100_000),
    above_10k_prev: countAbove(reelsPrev, 10_000),
    above_50k_prev: countAbove(reelsPrev, 50_000),
    above_100k_prev: countAbove(reelsPrev, 100_000),
    total_followers_active: totalFollowersActive,
    lost_to_bans: lostToBans,
    follower_delta: followerDelta,
    follower_delta_prev: followerDeltaPrev,
    breakdown,
  };
}

// Sparkline: combined views per day across all profiles for last N days
async function getCombinedViewsPerDay(profileIds, days) {
  if (!profileIds || profileIds.length === 0) return [];
  const since = periodStart(days);
  const { data } = await supabase
    .from('account_reels')
    .select('views, posted_at')
    .in('account_id', profileIds)
    .gte('posted_at', since);

  const buckets = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  (data || []).forEach((r) => {
    const day = r.posted_at.slice(0, 10);
    if (buckets[day] !== undefined) buckets[day] += r.views || 0;
  });
  return Object.entries(buckets)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getCombinedReelsPerDay(profileIds, days) {
  if (!profileIds || profileIds.length === 0) return [];
  const since = periodStart(days);
  const { data } = await supabase
    .from('account_reels')
    .select('posted_at')
    .in('account_id', profileIds)
    .gte('posted_at', since);

  const buckets = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  (data || []).forEach((r) => {
    const day = r.posted_at.slice(0, 10);
    if (buckets[day] !== undefined) buckets[day] += 1;
  });
  return Object.entries(buckets)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Sum followers across active profiles per day
async function getCombinedFollowersPerDay(profileIds, days) {
  if (!profileIds || profileIds.length === 0) return [];
  const sinceDate = periodStart(days).slice(0, 10);
  const { data } = await supabase
    .from('account_snapshots')
    .select('snapshot_date, follower_count, account_id')
    .in('account_id', profileIds)
    .gte('snapshot_date', sinceDate)
    .order('snapshot_date', { ascending: true });

  // Sum per date
  const byDate = {};
  (data || []).forEach((s) => {
    if (!byDate[s.snapshot_date]) byDate[s.snapshot_date] = 0;
    byDate[s.snapshot_date] += s.follower_count || 0;
  });
  return Object.entries(byDate).map(([date, value]) => ({ date, value }));
}

// ----- Routes ---------------------------------------------------

// GET all talents with their profiles + 7d quick metrics
router.get('/', async (req, res) => {
  const { data: talents, error } = await supabase
    .from('talents')
    .select('*')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });

  const enriched = await Promise.all(
    (talents || []).map(async (t) => {
      const { data: profiles } = await supabase
        .from('my_accounts')
        .select('id, username, status, profile_pic_url, follower_count')
        .eq('talent_id', t.id);

      const metrics_7d = await computeTalentMetrics(t.id, 7);
      const sparkline = await getCombinedViewsPerDay(
        (profiles || []).map((p) => p.id),
        7
      );
      return { ...t, profiles: profiles || [], metrics_7d, sparkline };
    })
  );

  res.json(enriched);
});

// GET single talent with full detail
router.get('/:id', async (req, res) => {
  const { data: talent, error } = await supabase
    .from('talents')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!talent) return res.status(404).json({ error: 'Talent not found' });

  const { data: profiles } = await supabase
    .from('my_accounts')
    .select('*')
    .eq('talent_id', talent.id)
    .order('status', { ascending: true }) // active first
    .order('username');

  const profileIds = (profiles || []).map((p) => p.id);

  const [m7, m14, m30] = await Promise.all([
    computeTalentMetrics(talent.id, 7),
    computeTalentMetrics(talent.id, 14),
    computeTalentMetrics(talent.id, 30),
  ]);

  const [viewsSeries, followersSeries, reelsSeries] = await Promise.all([
    getCombinedViewsPerDay(profileIds, 30),
    getCombinedFollowersPerDay(profileIds.filter((pid) => {
      const p = profiles.find((x) => x.id === pid);
      return p?.status === 'active';
    }), 30),
    getCombinedReelsPerDay(profileIds, 30),
  ]);

  // Top reels of last 30 days across all profiles
  const { data: topReels } = profileIds.length > 0
    ? await supabase
        .from('account_reels')
        .select(`
          id, shortcode, url, thumbnail_url, caption, views, likes, comments, posted_at,
          account_id
        `)
        .in('account_id', profileIds)
        .gte('posted_at', periodStart(30))
        .order('views', { ascending: false })
        .limit(10)
    : { data: [] };

  // Annotate top reels with which profile they came from
  const topReelsAnnotated = (topReels || []).map((r) => {
    const p = profiles.find((x) => x.id === r.account_id);
    return { ...r, profile_username: p?.username || null };
  });

  res.json({
    ...talent,
    profiles: profiles || [],
    metrics: { '7d': m7, '14d': m14, '30d': m30 },
    charts: {
      views_per_day: viewsSeries,
      followers_per_day: followersSeries,
      reels_per_day: reelsSeries,
    },
    top_reels: topReelsAnnotated,
  });
});

// POST create a talent
router.post('/', async (req, res) => {
  const { name, display_name, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabase
    .from('talents')
    .insert({ name: name.trim(), display_name: display_name?.trim() || null, notes: notes || null })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH update a talent
router.patch('/:id', async (req, res) => {
  const { name, display_name, notes } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (display_name !== undefined) updates.display_name = display_name;
  if (notes !== undefined) updates.notes = notes;
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const { data, error } = await supabase
    .from('talents')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE a talent (cascades to my_accounts → snapshots → reels)
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('talents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST add a profile to a talent
router.post('/:id/profiles', async (req, res) => {
  const { username } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: 'username is required' });
  const clean = username.replace('@', '').toLowerCase().trim();

  const { data: talent } = await supabase
    .from('talents')
    .select('id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!talent) return res.status(404).json({ error: 'Talent not found' });

  const { data, error } = await supabase
    .from('my_accounts')
    .insert({ username: clean, display_name: clean, talent_id: talent.id })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Account already exists' });
    return res.status(500).json({ error: error.message });
  }

  // Trigger immediate fetch in background
  fetchAccount(data).catch((err) => console.error('[POST profiles] initial fetch failed:', err.message));

  res.json(data);
});

// DELETE a profile (without deleting the talent)
router.delete('/:talentId/profiles/:profileId', async (req, res) => {
  const { error } = await supabase
    .from('my_accounts')
    .delete()
    .eq('id', req.params.profileId)
    .eq('talent_id', req.params.talentId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST trigger manual fetch for all profiles of a talent
router.post('/:id/fetch', async (req, res) => {
  const { data: profiles } = await supabase
    .from('my_accounts')
    .select('id')
    .eq('talent_id', req.params.id);
  if (!profiles || profiles.length === 0) return res.status(400).json({ error: 'No profiles for this talent' });

  res.json({ message: 'Fetch started', profile_count: profiles.length });
  try {
    await runMyAccountsFetch(profiles.map((p) => p.id));
  } catch (err) {
    console.error('[talents/fetch] failed:', err.message);
  }
});

// POST upload a profile picture for a talent (accepts a base64 data URL)
router.post('/:id/profile-pic', async (req, res) => {
  const { image_data_url } = req.body;
  if (!image_data_url) return res.status(400).json({ error: 'image_data_url is required' });

  const { data: existing } = await supabase
    .from('talents')
    .select('id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Talent not found' });

  try {
    const url = await uploadImageDataUrl(image_data_url, `talents/${req.params.id}`);
    const { data, error } = await supabase
      .from('talents')
      .update({ profile_pic_url: url })
      .eq('id', req.params.id)
      .select('id, profile_pic_url')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE the profile picture (clear it; file stays in storage)
router.delete('/:id/profile-pic', async (req, res) => {
  const { error } = await supabase
    .from('talents')
    .update({ profile_pic_url: null })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
