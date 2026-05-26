const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { runSuggestionScan } = require('../services/suggestionsService');

// In-process guard so a list isn't scanned twice concurrently in the same
// container. (Cross-instance safety relies on the DB job row + the auto-fail
// zombie sweep below.)
const activeScans = new Set();

// ============================================================
// GET /api/suggestions/lists/:listId
// Returns suggestions for the list, ordered by recommendation_count desc.
// Filters out usernames already in the source list (in case the list grew
// between scans). Hidden ones are returned with a `hidden:true` flag so the
// frontend can render them under the "Show hidden" toggle.
// ============================================================
router.get('/lists/:listId', async (req, res) => {
  const { listId } = req.params;

  const [{ data: list }, { data: listCreators }, { data: rows, error }] = await Promise.all([
    supabase.from('lists').select('id, name, color').eq('id', listId).maybeSingle(),
    supabase
      .from('list_creators')
      .select('creators(username)')
      .eq('list_id', listId),
    supabase
      .from('creator_suggestions')
      .select('*')
      .eq('list_id', listId)
      .order('recommendation_count', { ascending: false })
      .order('last_suggested_at', { ascending: false })
      .limit(2000),
  ]);

  if (error) return res.status(500).json({ error: error.message });
  if (!list) return res.status(404).json({ error: 'List not found' });

  const inListUsernames = new Set(
    (listCreators || []).map((lc) => lc?.creators?.username?.toLowerCase()).filter(Boolean)
  );
  const filtered = (rows || []).filter((r) => !inListUsernames.has(r.username.toLowerCase()));

  res.json({ list, suggestions: filtered });
});

// ============================================================
// POST /api/suggestions/lists/:listId/scan
// Kicks off a scan asynchronously. Returns immediately with a job id.
// ============================================================
router.post('/lists/:listId/scan', async (req, res) => {
  const { listId } = req.params;

  if (activeScans.has(listId)) {
    return res.status(409).json({ error: 'A scan is already running for this list' });
  }

  // Sanity check: the list exists & has creators
  const { data: list } = await supabase
    .from('lists')
    .select('id, name')
    .eq('id', listId)
    .maybeSingle();
  if (!list) return res.status(404).json({ error: 'List not found' });

  const { data: lc } = await supabase
    .from('list_creators')
    .select('creator_id')
    .eq('list_id', listId)
    .limit(1);
  if (!lc || lc.length === 0) {
    return res.status(400).json({ error: 'List has no creators' });
  }

  activeScans.add(listId);
  res.json({ message: 'Scan started', list: list.name });

  runSuggestionScan(listId)
    .catch(async (err) => {
      console.error(`[suggestionsRoute] Scan failed for list ${listId}:`, err.message);
      // Best-effort: mark the latest running job for this list as failed.
      await supabase
        .from('creator_suggestion_jobs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), error: err.message })
        .eq('list_id', listId)
        .eq('status', 'running');
    })
    .finally(() => {
      activeScans.delete(listId);
    });
});

// ============================================================
// GET /api/suggestions/lists/:listId/active
// Returns the currently-running scan job for this list, or null.
// Mirrors the /api/fetch/active pattern so the frontend can poll progress.
// ============================================================
router.get('/lists/:listId/active', async (req, res) => {
  const { listId } = req.params;

  // Auto-fail zombie jobs (stuck running for >15 min)
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await supabase
    .from('creator_suggestion_jobs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: 'Auto-failed: stuck in running state',
    })
    .eq('status', 'running')
    .eq('list_id', listId)
    .lt('started_at', cutoff);

  const { data, error } = await supabase
    .from('creator_suggestion_jobs')
    .select('id, status, total_creators, creators_processed, started_at, suggestions_new, suggestions_updated')
    .eq('list_id', listId)
    .eq('status', 'running')
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || null);
});

// ============================================================
// GET /api/suggestions/lists/:listId/jobs
// Recent scan history (for "last scanned X ago" / debug)
// ============================================================
router.get('/lists/:listId/jobs', async (req, res) => {
  const { listId } = req.params;
  const { data, error } = await supabase
    .from('creator_suggestion_jobs')
    .select('*')
    .eq('list_id', listId)
    .order('started_at', { ascending: false })
    .limit(10);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ============================================================
// PATCH /api/suggestions/:id  → { hidden: boolean }
// ============================================================
router.patch('/:id', async (req, res) => {
  const { hidden } = req.body;
  if (typeof hidden !== 'boolean') {
    return res.status(400).json({ error: 'hidden (boolean) required' });
  }
  const { data, error } = await supabase
    .from('creator_suggestions')
    .update({ hidden })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ============================================================
// POST /api/suggestions/:id/add-to-list  → { list_id?: string }
// Adds the suggested profile as a real creator (upsert by username) and
// links it to the given list (defaults to the suggestion's source list).
// Once added, deletes the suggestion row from creator_suggestions so it
// doesn't show up again.
// ============================================================
router.post('/:id/add-to-list', async (req, res) => {
  const { id } = req.params;
  const targetListId = req.body?.list_id || null;

  const { data: suggestion, error: sErr } = await supabase
    .from('creator_suggestions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (sErr) return res.status(500).json({ error: sErr.message });
  if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });

  const listIdToUse = targetListId || suggestion.list_id;

  // Verify the target list exists
  const { data: list } = await supabase
    .from('lists')
    .select('id, name')
    .eq('id', listIdToUse)
    .maybeSingle();
  if (!list) return res.status(404).json({ error: 'Target list not found' });

  // Upsert creator by username
  const { data: creator, error: cErr } = await supabase
    .from('creators')
    .upsert(
      {
        username: suggestion.username,
        display_name: suggestion.full_name || suggestion.username,
        profile_pic_url: suggestion.profile_pic_url || null,
        follower_count: suggestion.follower_count ?? null,
        instagram_pk: suggestion.instagram_pk || null,
      },
      { onConflict: 'username' }
    )
    .select()
    .single();
  if (cErr) return res.status(500).json({ error: cErr.message });

  // Link to the list (ignore if already linked)
  const { error: linkErr } = await supabase
    .from('list_creators')
    .upsert(
      { list_id: listIdToUse, creator_id: creator.id },
      { onConflict: 'list_id,creator_id', ignoreDuplicates: true }
    );
  if (linkErr) return res.status(500).json({ error: linkErr.message });

  // Remove this suggestion row — they've acted on it. Also remove any other
  // suggestion rows for the same username in the same list (defensive).
  await supabase.from('creator_suggestions').delete().eq('id', id);

  res.json({
    success: true,
    creator,
    list: { id: list.id, name: list.name },
  });
});

// ============================================================
// DELETE /api/suggestions/:id
// (used if the user wants to permanently drop a suggestion rather than hide)
// ============================================================
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('creator_suggestions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
