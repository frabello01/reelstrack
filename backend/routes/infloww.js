const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { syncCreator, syncAllTalents } = require('../services/inflowwService');
const { italyDate, italyLastNDates, italyDateNDaysAgo, nextDayIso } = require('../lib/dateUtils');

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

  const { data: raw, error } = await supabase
    .from('infloww_tracking_link_snapshots')
    .select('snapshot_date, sub_count, click_count, paying_fans_count, earnings_net')
    .eq('infloww_link_id', req.params.id)
    .gte('snapshot_date', italyDateNDaysAgo(days + 1))
    .order('snapshot_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const snapsByDay = Object.fromEntries((raw || []).map((s) => [s.snapshot_date, s]));

  // Reporting window: last N Italy days, oldest → newest.
  // Exclude "today Italy" because we never have tomorrow's snapshot yet,
  // so today's delta would always be null. We report the days where a
  // delta IS computable: italyLastNDates(days) skipping the very last entry,
  // i.e. days-1 entries… no actually, we want N rows where the most recent
  // is yesterday Italy. So shift the window by 1:
  const reportingDays = italyLastNDates(days + 1).slice(0, days);

  const rows = reportingDays.map((day) => {
    const nextDay = nextDayIso(day);
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

// PATCH /api/infloww/links/:infloww_link_id
// Accepts { hidden?: boolean, local_name?: string|null }
router.patch('/links/:infloww_link_id', async (req, res) => {
  const updates = {};
  if (typeof req.body?.hidden === 'boolean') updates.hidden = req.body.hidden;
  if ('local_name' in (req.body || {})) {
    const v = req.body.local_name;
    updates.local_name = (v == null || v === '') ? null : String(v).trim();
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No supported fields to update' });
  }
  const { data, error } = await supabase
    .from('infloww_tracking_links')
    .update(updates)
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

// GET /api/infloww/sources?talent_id=X&period=day|week|month
// Returns per-source new-subs totals for the chosen window.
//   day   = yesterday Italy (the most recent fully-computable delta)
//   week  = last 7 fully-computable Italy days
//   month = month-to-date Italy (1st of month → yesterday)
router.get('/sources', async (req, res) => {
  const { talent_id } = req.query;
  const period = String(req.query.period || 'week').toLowerCase();
  if (!talent_id) return res.status(400).json({ error: 'talent_id required' });

  // Resolve [startDate, endDate] inclusive in Italy date strings (YYYY-MM-DD)
  const today = italyDate();              // today Italy
  const yesterday = italyDateNDaysAgo(1); // most recent completed Italy day
  let startDate, endDate, label;
  if (period === 'day') {
    startDate = yesterday;
    endDate = yesterday;
    label = 'Ieri';
  } else if (period === 'month') {
    // First day of current Italy month
    const [y, m] = today.split('-').map(Number);
    startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    endDate = yesterday;
    label = 'Mese in corso';
  } else {
    // week (default)
    startDate = italyDateNDaysAgo(7);
    endDate = yesterday;
    label = 'Ultimi 7 giorni';
  }

  // Lookup all infloww links for this talent (with their source)
  const { data: links, error: linksErr } = await supabase
    .from('infloww_tracking_links')
    .select('infloww_link_id, source, name, local_name')
    .eq('talent_id', talent_id);
  if (linksErr) return res.status(500).json({ error: linksErr.message });
  if (!links || links.length === 0) {
    return res.json({ period, start_date: startDate, end_date: endDate, label, by_source: [], total: 0 });
  }
  const inflowwIds = links.map((l) => l.infloww_link_id);
  const sourceByLink = new Map(links.map((l) => [l.infloww_link_id, l.source || 'Unknown']));

  // Pull snapshots inside the window plus the snapshot right after endDate
  // (= the one that captures the END of endDate's activity). Easiest: just
  // pull from startDate to today, then look up the two anchors per link.
  const { data: snaps, error: snapErr } = await supabase
    .from('infloww_tracking_link_snapshots')
    .select('infloww_link_id, snapshot_date, sub_count')
    .in('infloww_link_id', inflowwIds)
    .gte('snapshot_date', startDate)
    .order('snapshot_date', { ascending: true });
  if (snapErr) return res.status(500).json({ error: snapErr.message });

  // For each link, sum daily deltas inside the window: (next - this) for
  // every consecutive pair where both dates fall in [startDate, endDate].
  const subsByLink = new Map();
  if (snaps && snaps.length > 0) {
    const byLink = new Map();
    for (const s of snaps) {
      if (!byLink.has(s.infloww_link_id)) byLink.set(s.infloww_link_id, []);
      byLink.get(s.infloww_link_id).push(s);
    }
    for (const [linkId, rows] of byLink.entries()) {
      rows.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
      let total = 0;
      for (let i = 0; i < rows.length - 1; i++) {
        const dayA = rows[i].snapshot_date;
        // dayA is the "from" snapshot. The activity attributed to dayA is
        // (rows[i+1] - rows[i]). We count this delta only if dayA is in
        // [startDate, endDate].
        if (dayA >= startDate && dayA <= endDate) {
          total += Math.max(0, Number(rows[i + 1].sub_count || 0) - Number(rows[i].sub_count || 0));
        }
      }
      subsByLink.set(linkId, total);
    }
  }

  // Group by source
  const totals = new Map();
  for (const [linkId, subs] of subsByLink.entries()) {
    const src = sourceByLink.get(linkId) || 'Unknown';
    totals.set(src, (totals.get(src) || 0) + subs);
  }

  // Include every known source for this talent even if 0, so the pie chart
  // doesn't surprise the user by hiding a recognized source.
  for (const src of new Set(links.map((l) => l.source || 'Unknown'))) {
    if (!totals.has(src)) totals.set(src, 0);
  }

  const by_source = [...totals.entries()]
    .map(([source, new_subs]) => ({ source, new_subs }))
    .sort((a, b) => b.new_subs - a.new_subs);
  const total = by_source.reduce((s, x) => s + x.new_subs, 0);

  res.json({ period, start_date: startDate, end_date: endDate, label, by_source, total });
});

module.exports = router;
