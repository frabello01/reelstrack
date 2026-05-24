// ============================================================
// /api/guide-completions — per-user completion tracking
// ============================================================
//
// Endpoints:
//   GET    /api/guide-completions?item_type=article|video&item_id=:id
//          Returns who has completed this item: [{user_id, user_name, completed_at}, ...]
//
//   GET    /api/guide-completions/mine
//          Returns IDs of items the CURRENT user has completed:
//          { articles: [id, id, ...], videos: [id, id, ...] }
//
//   POST   /api/guide-completions
//          Body: { item_type, item_id }
//          Marks item complete for current user (idempotent)
//
//   DELETE /api/guide-completions?item_type=...&item_id=...
//          Unmarks complete for current user
// ============================================================

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { log } = require('../lib/activityLogger');

const VALID_TYPES = ['article', 'video'];

// Resolve a human-readable item name for log entries (best effort)
async function lookupItemName(item_type, item_id) {
  try {
    if (item_type === 'article') {
      const { data } = await supabase
        .from('guide_articles').select('title').eq('id', item_id).maybeSingle();
      return data?.title || null;
    }
    const { data } = await supabase
      .from('lessons').select('title').eq('id', item_id).maybeSingle();
    return data?.title || null;
  } catch {
    return null;
  }
}

// ============================================================
// Who has completed a specific item
// ============================================================
router.get('/', async (req, res) => {
  const { item_type, item_id } = req.query;
  if (!VALID_TYPES.includes(item_type)) {
    return res.status(400).json({ error: 'item_type must be article or video' });
  }
  if (!item_id) return res.status(400).json({ error: 'item_id required' });

  const { data, error } = await supabase
    .from('guide_completions')
    .select('user_id, user_name, completed_at')
    .eq('item_type', item_type)
    .eq('item_id', item_id)
    .order('completed_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ completions: data || [] });
});

// ============================================================
// Current user's completed items (used by UI to render checkmarks)
// ============================================================
router.get('/mine', async (req, res) => {
  const { data, error } = await supabase
    .from('guide_completions')
    .select('item_type, item_id')
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });

  const articles = [];
  const videos = [];
  for (const row of data || []) {
    if (row.item_type === 'article') articles.push(row.item_id);
    else if (row.item_type === 'video') videos.push(row.item_id);
  }
  res.json({ articles, videos });
});

// ============================================================
// Mark complete (current user, idempotent)
// ============================================================
router.post('/', async (req, res) => {
  const { item_type, item_id } = req.body || {};
  if (!VALID_TYPES.includes(item_type)) {
    return res.status(400).json({ error: 'item_type must be article or video' });
  }
  if (!item_id) return res.status(400).json({ error: 'item_id required' });

  // Upsert — if already completed, just update completed_at (touches the row)
  const { data, error } = await supabase
    .from('guide_completions')
    .upsert({
      item_type,
      item_id,
      user_id: req.user.id,
      user_name: req.user.display_name || req.user.email,
      completed_at: new Date().toISOString(),
    }, {
      onConflict: 'item_type,item_id,user_id',
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Log it — pretty entry
  const target_name = await lookupItemName(item_type, item_id);
  log(req, {
    section: 'guides',
    action: 'mark-complete',
    target_type: item_type,
    target_id: item_id,
    target_name: target_name || `${item_type}:${item_id.slice(0, 8)}`,
  });

  res.json(data);
});

// ============================================================
// Unmark complete
// ============================================================
router.delete('/', async (req, res) => {
  const item_type = req.query.item_type;
  const item_id = req.query.item_id;
  if (!VALID_TYPES.includes(item_type)) {
    return res.status(400).json({ error: 'item_type must be article or video' });
  }
  if (!item_id) return res.status(400).json({ error: 'item_id required' });

  const { error } = await supabase
    .from('guide_completions')
    .delete()
    .eq('item_type', item_type)
    .eq('item_id', item_id)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });

  const target_name = await lookupItemName(item_type, item_id);
  log(req, {
    section: 'guides',
    action: 'unmark-complete',
    target_type: item_type,
    target_id: item_id,
    target_name: target_name || `${item_type}:${item_id.slice(0, 8)}`,
  });

  res.json({ success: true });
});

module.exports = router;
