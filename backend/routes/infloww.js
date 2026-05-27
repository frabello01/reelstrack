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
// Returns the last N days zero-filled, each row containing the cumulative
// sub_count + the per-day delta (new_subs). The delta on day D is computed
// as snapshot[D+1] - snapshot[D] so it represents activity during day D
// itself, matching the convention used in the IG-profile activity table.
// Today's row has new_subs=null because tomorrow's snapshot doesn't exist
// yet.
router.get('/links/:id/snapshots', async (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days || '30', 10)));
  // We need ONE EXTRA day of history before the window so we can compute
  // the delta for the first reporting day too.
  const since = new Date(); since.setDate(since.getDate() - (days + 1));
  const sinceDate = since.toISOString().slice(0, 10);

  const { data: raw, error } = await supabase
    .from('infloww_tracking_link_snapshots')
    .select('snapshot_date, sub_count, click_count, paying_fans_count, earnings_net')
    .eq('infloww_link_id', req.params.id)
    .gte('snapshot_date', sinceDate)
    .order('snapshot_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const snapsByDay = Object.fromEntries((raw || []).map((s) => [s.snapshot_date, s]));

  // Build the reporting day window (oldest → newest)
  const reportingDays = [];
  for (let i = days; i >= 1; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    reportingDays.push(d.toISOString().slice(0, 10));
  }

  const rows = reportingDays.map((day) => {
    const dn = new Date(day); dn.setDate(dn.getDate() + 1);
    const nextDay = dn.toISOString().slice(0, 10);
    const today = snapsByDay[day];
    const tomorrow = snapsByDay[nextDay];
    return {
      date: day,
      sub_count: today ? Number(today.sub_count || 0) : null,
      new_subs: (today && tomorrow)
        ? Number(tomorrow.sub_count || 0) - Number(today.sub_count || 0)
        : null,
      new_clicks: (today && tomorrow)
        ? Number(tomorrow.click_count || 0) - Number(today.click_count || 0)
        : null,
      new_earnings_net: (today && tomorrow)
        ? Number(tomorrow.earnings_net || 0) - Number(today.earnings_net || 0)
        : null,
    };
  });

  res.json(rows);
});

// PATCH /api/infloww/links/:infloww_link_id   body: { hidden: boolean }
router.patch('/links/:infloww_link_id', async (req, res) => {
  const { hidden } = req.body || {};
  if (typeof hidden !== 'boolean') {
    return res.status(400).json({ error: 'hidden (boolean) required' });
  }
  const { data, error } = await supabase
    .from('infloww_tracking_links')
    .update({ hidden })
    .eq('infloww_link_id', req.params.infloww_link_id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
