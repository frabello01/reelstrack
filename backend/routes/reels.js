const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

/**
 * GET /api/reels
 * Query params:
 *   list_id   - filter by creator list
 *   days      - 1 | 14 | 30 (default 30)
 *   sort      - outlier_score | views | posted_at (default outlier_score)
 *   limit     - number of results (default 50)
 *   offset    - pagination offset (default 0)
 */
router.get('/', async (req, res) => {
  const { list_id, days = 30, sort = 'outlier_score', limit = 50, offset = 0 } = req.query;

  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - parseInt(days));

  // Build base query: reels + scores + creator info
  let query = supabase
    .from('reel_scores')
    .select(`
      outlier_score,
      views_at_score,
      creator_avg_views,
      computed_at,
      reels (
        id,
        instagram_id,
        url,
        thumbnail_url,
        caption,
        views,
        likes,
        comments,
        posted_at,
        creator_id,
        creators (
          id,
          username,
          display_name,
          profile_pic_url,
          avg_views_30d
        )
      )
    `)
    .gte('reels.posted_at', daysAgo.toISOString())
    .not('reels', 'is', null);

  // Filter by list: get creator IDs for this list
  if (list_id) {
    const { data: listCreators } = await supabase
      .from('list_creators')
      .select('creator_id')
      .eq('list_id', list_id);

    if (!listCreators || listCreators.length === 0) {
      return res.json({ data: [], count: 0 });
    }

    const creatorIds = listCreators.map((lc) => lc.creator_id);
    query = query.in('creator_id', creatorIds);
  }

  // Sort
  const sortColumn = sort === 'outlier_score' ? 'outlier_score'
    : sort === 'views' ? 'views_at_score'
    : 'computed_at';

  query = query
    .order(sortColumn, { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Flatten response
  const reels = (data || [])
    .filter((row) => row.reels)
    .map((row) => ({
      ...row.reels,
      outlier_score: row.outlier_score,
      creator_avg_views: row.creator_avg_views,
      creator: row.reels.creators,
    }));

  res.json({ data: reels, count });
});

// GET stats summary
router.get('/stats', async (req, res) => {
  const { list_id } = req.query;

  let creatorFilter = [];
  if (list_id) {
    const { data: lc } = await supabase
      .from('list_creators')
      .select('creator_id')
      .eq('list_id', list_id);
    creatorFilter = (lc || []).map((r) => r.creator_id);
  }

  // Top outlier
  let scoreQuery = supabase
    .from('reel_scores')
    .select('outlier_score, creator_id')
    .order('outlier_score', { ascending: false })
    .limit(1);
  if (creatorFilter.length) scoreQuery = scoreQuery.in('creator_id', creatorFilter);
  const { data: topScore } = await scoreQuery;

  // Total reels tracked
  let reelCountQuery = supabase.from('reels').select('id', { count: 'exact', head: true });
  if (creatorFilter.length) reelCountQuery = reelCountQuery.in('creator_id', creatorFilter);
  const { count: totalReels } = await reelCountQuery;

  // Last fetch
  const { data: lastJob } = await supabase
    .from('fetch_jobs')
    .select('finished_at, status')
    .eq('status', 'done')
    .order('finished_at', { ascending: false })
    .limit(1);

  res.json({
    top_outlier_score: topScore?.[0]?.outlier_score || 0,
    total_reels: totalReels || 0,
    last_fetch: lastJob?.[0]?.finished_at || null,
  });
});

module.exports = router;
