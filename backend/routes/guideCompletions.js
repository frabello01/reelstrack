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

// ============================================================
// /matrix — admin-only progress matrix for a category
// ============================================================
// Returns the data needed to render a "team progress" matrix on the
// Guides page: list of active members, list of items in the category,
// and the sparse set of completions linking them.
//
// Query: ?category_id=<uuid|uncategorized|null-omitted-for-all>
//
// Response shape:
//   {
//     members: [{ id, user_id, display_name, role }],
//     items: [{ item_type, item_id, title }],
//     completions: [{ user_id, item_type, item_id, completed_at }]
//   }
//
// Frontend builds the per-cell ✓/✗ by intersecting these three arrays.
// ============================================================
router.get('/matrix', async (req, res) => {
  // Admin check (defensive — the auth middleware doesn't gate per-route here)
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const categoryId = req.query.category_id || null;

  // 1) Active team members
  const { data: members, error: mErr } = await supabase
    .from('team_members')
    .select('id, user_id, display_name, role, email')
    .eq('is_active', true)
    .order('role', { ascending: true })          // admins first
    .order('display_name', { ascending: true });
  if (mErr) return res.status(500).json({ error: `Members query: ${mErr.message}` });

  // 2) Items in this category (articles + videos)
  let articlesQ = supabase
    .from('guide_articles')
    .select('id, title, sort_order, is_pinned, updated_at, category_id');
  let lessonsQ = supabase
    .from('lessons')
    .select('id, title, sort_order, is_pinned, updated_at, category_id');

  if (categoryId === 'uncategorized') {
    articlesQ = articlesQ.is('category_id', null);
    lessonsQ = lessonsQ.is('category_id', null);
  } else if (categoryId && categoryId !== 'all') {
    articlesQ = articlesQ.eq('category_id', categoryId);
    lessonsQ = lessonsQ.eq('category_id', categoryId);
  }

  const [aRes, lRes] = await Promise.all([articlesQ, lessonsQ]);
  if (aRes.error) return res.status(500).json({ error: `Articles query: ${aRes.error.message}` });
  if (lRes.error) return res.status(500).json({ error: `Lessons query: ${lRes.error.message}` });

  const items = [
    ...(aRes.data || []).map((a) => ({
      item_type: 'article',
      item_id: a.id,
      title: a.title || 'Untitled',
      sort_order: a.sort_order ?? 0,
      is_pinned: !!a.is_pinned,
      updated_at: a.updated_at,
    })),
    ...(lRes.data || []).map((l) => ({
      item_type: 'video',
      item_id: l.id,
      title: l.title || 'Untitled',
      sort_order: l.sort_order ?? 0,
      is_pinned: !!l.is_pinned,
      updated_at: l.updated_at,
    })),
  ];

  // Same sort as the items list: pinned → sort_order → updated_at desc
  items.sort((a, b) => {
    if ((b.is_pinned ? 1 : 0) !== (a.is_pinned ? 1 : 0)) {
      return (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0);
    }
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  // 3) Completions for those items (only — no point fetching for items we
  //    aren't displaying). Use the .in() filter on both type and id.
  let completions = [];
  if (items.length > 0) {
    // Supabase doesn't support compound .in() on two columns, so we fetch
    // by item_id list + filter by item_type matches in JS afterward.
    const itemIds = items.map((i) => i.item_id);
    const { data, error } = await supabase
      .from('guide_completions')
      .select('user_id, item_type, item_id, completed_at')
      .in('item_id', itemIds);
    if (error) return res.status(500).json({ error: `Completions query: ${error.message}` });

    // Filter down to (item_type, item_id) pairs we actually want
    const wantKeys = new Set(items.map((i) => `${i.item_type}:${i.item_id}`));
    completions = (data || []).filter((c) => wantKeys.has(`${c.item_type}:${c.item_id}`));
  }

  res.json({
    members: members || [],
    items,
    completions,
  });
});

module.exports = router;
