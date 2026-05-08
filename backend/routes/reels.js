const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

router.get('/', async (req, res) => {
  const { list_id, days = 30, sort = 'outlier_score', limit = 50, offset = 0, seen_filter = 'unseen' } = req.query;
  // seen_filter values: 'unseen' (default) | 'seen' | 'all'

  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - parseInt(days));

  // If list_id, get creator IDs once
  let creatorIds = null;
  if (list_id) {
    const { data: lc } = await supabase
      .from('list_creators')
      .select('creator_id')
      .eq('list_id', list_id);
    if (!lc || lc.length === 0) return res.json({ data: [], count: 0 });
    creatorIds = lc.map((r) => r.creator_id);
  }

  // Map sort key to actual column
  const sortColumn = sort === 'views' ? 'views'
    : sort === 'posted_at' ? 'posted_at'
    : 'outlier_score';

  // Single query — DB does the sorting with indexes, returns just the page we need
  let query = supabase
    .from('reels')
    .select(
      `id, instagram_id, url, thumbnail_url, caption,
       views, likes, comments, posted_at, creator_id, seen_at,
       outlier_score, creator_avg_views,
       creators ( id, username, display_name, profile_pic_url )`,
      { count: 'exact' }
    )
    .gte('posted_at', daysAgo.toISOString())
    .order(sortColumn, { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (creatorIds) query = query.in('creator_id', creatorIds);

  // Apply seen filter
  if (seen_filter === 'unseen') query = query.is('seen_at', null);
  else if (seen_filter === 'seen') query = query.not('seen_at', 'is', null);
  // 'all' = no filter

  const { data: reels, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const data = (reels || []).map((r) => ({ ...r, creator: r.creators }));
  res.json({ data, count: count || 0 });
});

// PATCH /api/reels/:id/seen — toggle seen state on a single reel
// Body: { seen: true|false }
router.patch('/:id/seen', async (req, res) => {
  const { seen } = req.body;
  const { data, error } = await supabase
    .from('reels')
    .update({ seen_at: seen ? new Date().toISOString() : null })
    .eq('id', req.params.id)
    .select('id, seen_at')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/reels/mark-seen — bulk mark a set of reels as seen
// Body: { reel_ids: [uuid, uuid, ...] }
router.post('/mark-seen', async (req, res) => {
  const { reel_ids } = req.body;
  if (!Array.isArray(reel_ids) || reel_ids.length === 0) {
    return res.status(400).json({ error: 'reel_ids must be a non-empty array' });
  }
  const { error } = await supabase
    .from('reels')
    .update({ seen_at: new Date().toISOString() })
    .in('id', reel_ids);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, marked: reel_ids.length });
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

  // Single query: get top outlier + count via head request
  let topQ = supabase
    .from('reels')
    .select('outlier_score', { count: 'exact' })
    .gte('posted_at', daysAgo.toISOString())
    .order('outlier_score', { ascending: false })
    .limit(1);
  if (creatorFilter) topQ = topQ.in('creator_id', creatorFilter);

  const { data: top, count } = await topQ;

  const { data: lastJob } = await supabase
    .from('fetch_jobs')
    .select('finished_at')
    .eq('status', 'done')
    .order('finished_at', { ascending: false })
    .limit(1);

  res.json({
    top_outlier_score: top?.[0]?.outlier_score || 0,
    total_reels: count || 0,
    last_fetch: lastJob?.[0]?.finished_at || null,
  });
});

module.exports = router;
