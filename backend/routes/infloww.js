const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { syncCreator, syncAllTalents } = require('../services/inflowwService');

// GET /api/infloww/links?talent_id=X
// Returns every Infloww tracking link bound to a talent, with the latest
// metrics and whether each is bound to one of our landing_links.
router.get('/links', async (req, res) => {
  const { talent_id } = req.query;
  let q = supabase
    .from('infloww_tracking_links')
    .select('*, landing_links(id, label, landing_id)')
    .order('updated_at_infloww', { ascending: false });
  if (talent_id) q = q.eq('talent_id', talent_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/infloww/links/:id/snapshots?days=30
router.get('/links/:id/snapshots', async (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days || '30', 10)));
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('infloww_tracking_link_snapshots')
    .select('*')
    .eq('infloww_link_id', req.params.id)
    .gte('snapshot_date', sinceDate)
    .order('snapshot_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/infloww/sync   body: { talent_id?: string }
// Runs in the background. Returns immediately.
router.post('/sync', async (req, res) => {
  const { talent_id } = req.body || {};
  res.json({ message: 'Sync started', talent_id: talent_id || 'all' });
  try {
    if (talent_id) {
      const { data: t } = await supabase
        .from('talents')
        .select('id, name, infloww_creator_id')
        .eq('id', talent_id)
        .maybeSingle();
      if (!t || !t.infloww_creator_id) {
        console.warn('[infloww/sync] talent has no infloww_creator_id');
        return;
      }
      await syncCreator(t.id, t.infloww_creator_id);
    } else {
      await syncAllTalents();
    }
  } catch (err) {
    console.error('[infloww/sync] failed:', err.message);
  }
});

// POST /api/infloww/bind   body: { landing_link_id, infloww_link_id | null }
// Pass infloww_link_id=null to unbind.
router.post('/bind', async (req, res) => {
  const { landing_link_id, infloww_link_id } = req.body || {};
  if (!landing_link_id) return res.status(400).json({ error: 'landing_link_id required' });

  // First, clear any existing binding on this landing_link
  await supabase
    .from('infloww_tracking_links')
    .update({ landing_link_id: null })
    .eq('landing_link_id', landing_link_id);

  if (infloww_link_id) {
    const { error } = await supabase
      .from('infloww_tracking_links')
      .update({ landing_link_id })
      .eq('infloww_link_id', infloww_link_id);
    if (error) return res.status(500).json({ error: error.message });
  }
  res.json({ success: true });
});

module.exports = router;
