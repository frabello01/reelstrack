const express = require('express');
const router = express.Router();
const { runDailyFetch } = require('../services/fetchService');
const supabase = require('../lib/supabase');

// POST /api/fetch/run - trigger a manual fetch (all creators or specific list)
// Body: { list_id?: string, force?: boolean }
//   force=true bypasses the 24-hour-per-creator cap (use sparingly)
router.post('/run', async (req, res) => {
  const { list_id, force = false } = req.body;

  let creatorIds = null;
  if (list_id) {
    const { data: lc } = await supabase
      .from('list_creators')
      .select('creator_id')
      .eq('list_id', list_id);
    creatorIds = (lc || []).map((r) => r.creator_id);
    if (creatorIds.length === 0) {
      return res.status(400).json({ error: 'No creators in this list' });
    }
  }

  // Run async — don't block the response
  res.json({ message: 'Fetch job started', list_id: list_id || 'all', force });

  try {
    await runDailyFetch(creatorIds, { force });
    console.log('[FetchRoute] Manual fetch complete.');
  } catch (err) {
    console.error('[FetchRoute] Manual fetch failed:', err.message);
  }
});

// GET /api/fetch/jobs - get recent fetch job history
router.get('/jobs', async (req, res) => {
  const { data, error } = await supabase
    .from('fetch_jobs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/fetch/active - get the currently-running job (if any)
// Returns null when nothing is running. Frontend polls this every ~1s.
router.get('/active', async (req, res) => {
  const { data, error } = await supabase
    .from('fetch_jobs')
    .select('id, status, total_creators, creators_processed, started_at')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || null);
});

module.exports = router;
