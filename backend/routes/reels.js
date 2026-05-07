const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

router.get('/', async (req, res) => {
  const { list_id, days = 30, sort = 'outlier_score', limit = 50, offset = 0 } = req.query;

  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - parseInt(days));

  let creatorIds = null;
  if (list_id) {
    const { data: lc } = await supabase
      .from('list_creators')
      .select('creator_id')
      .eq('list_id', list_id);
    if (!lc || lc.length === 0) return res.json({ data: [], count: 0 });
    creatorIds = lc.map((r) => r.creator_id);
  }

  let reelsQuery = supabase
    .from('reels')
    .select(`
      id, instagram_id, url, thumbnail_url, caption,
      views, likes, comments, posted_at, creator_id,
      creators ( id, username, display_name, profile_pic_url, avg_views_30d )
    `)
    .gte('posted_at', daysAgo.toISOString());

  if (creatorIds) reelsQuery = reelsQuery.in('creator_id', creatorIds);

  const { data: reels, error: reelsErr } = await reelsQuery;
  if (reelsErr) return res.status(500).json({ error: reelsErr.message });
  if (!reels || reels.length === 0) return res.json({ data: [], count: 0 });

  const reelIds = reels.map((r) => r.id);
  const { data: scores } = await supabase
    .from('reel_scores')
    .select('reel_id, outlier_score, creator_avg_views')
    .in('reel_id', reelIds);

  const scoreMap = {};
  (scores || []).forEach((s) => { scoreMap[s.reel_id] = s; });

  const merged = reels.map((r) => ({
    ...r,
    outlier_score: scoreMap[r.id]?.outlier_score || 0,
    creator_avg_views: scoreMap[r.id]?.creator_avg_views || r.creators?.avg_views_30d || 0,
    creator: r.creators,
  }));

  const sortKey = sort === 'views' ? 'views' : sort === 'posted_at' ? 'posted_at' : 'outlier_score';
  merged.sort((a, b) => {
    if (sortKey === 'posted_at') return new Date(b.posted_at) - new Date(a.posted_at);
    return (b[sortKey] || 0) - (a[sortKey] || 0);
  });

  const paged = merged.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  res.json({ data: paged, count: merged.length });
});

router.get('/stats', async (req, res) => {
  const { list_id, days = 30 } = req.query;
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - parseInt(days));

  let creatorFilter = null;
  if (list_id) {
    const { data: lc } = await supabase
      .from('list_creators')
      .select('creator_id')
      .eq('list_id', list_id);
    creatorFilter = (lc || []).map((r) => r.creator_id);
    if (creatorFilter.length === 0) {
      return res.json({ top_outlier_score: 0, total_reels: 0, last_fetch: null });
    }
  }

  let reelsQ = supabase.from('reels').select('id').gte('posted_at', daysAgo.toISOString());
  if (creatorFilter) reelsQ = reelsQ.in('creator_id', creatorFilter);
  const { data: reelsData } = await reelsQ;
  const reelIds = (reelsData || []).map((r) => r.id);

  let topOutlier = 0;
  if (reelIds.length > 0) {
    const { data: topScore } = await supabase
      .from('reel_scores')
      .select('outlier_score')
      .in('reel_id', reelIds)
      .order('outlier_score', { ascending: false })
      .limit(1);
    topOutlier = topScore?.[0]?.outlier_score || 0;
  }

  const { data: lastJob } = await supabase
    .from('fetch_jobs')
    .select('finished_at')
    .eq('status', 'done')
    .order('finished_at', { ascending: false })
    .limit(1);

  res.json({
    top_outlier_score: topOutlier,
    total_reels: reelIds.length,
    last_fetch: lastJob?.[0]?.finished_at || null,
  });
});

module.exports = router;
