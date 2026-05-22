// ============================================================
// /api/guides-v2 — Guides Overhaul backend
// ============================================================
// Provides the new category-based API on top of the existing
// guide_articles + lessons tables. Does NOT modify or replace
// the original /api/guides or /api/lessons routes.
//
// Endpoints:
//   GET    /api/guides-v2/categories                       list all categories
//   POST   /api/guides-v2/categories                       create category
//   PATCH  /api/guides-v2/categories/:id                   update
//   DELETE /api/guides-v2/categories/:id                   delete (items become uncategorized)
//   POST   /api/guides-v2/categories/reorder               bulk-update sort_order
//
//   GET    /api/guides-v2/items?category_id=...            unified list (articles + lessons)
//   POST   /api/guides-v2/items/:type/:id/move             move to another category
//   POST   /api/guides-v2/items/:type/:id/pin              toggle is_pinned
//   POST   /api/guides-v2/items/reorder                    bulk-update sort_order in a category
// ============================================================

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

const VALID_TYPES = ['article', 'video'];
const TABLE_FOR_TYPE = { article: 'guide_articles', video: 'lessons' };

// ============================================================
// HELPERS
// ============================================================
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `cat-${Date.now()}`;
}

async function fetchItemsForCategory(categoryId) {
  // Articles
  const articlesQuery = supabase
    .from('guide_articles')
    .select('id, title, slug, summary, body, image_url, sort_order, is_pinned, created_at, updated_at')
    .order('is_pinned', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: false });

  const lessonsQuery = supabase
    .from('lessons')
    .select('id, title, slug, summary, video_url, thumbnail_url, duration_seconds, sort_order, is_pinned, created_at, updated_at')
    .order('is_pinned', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: false });

  if (categoryId === 'uncategorized') {
    articlesQuery.is('category_id', null);
    lessonsQuery.is('category_id', null);
  } else if (categoryId && categoryId !== 'all') {
    articlesQuery.eq('category_id', categoryId);
    lessonsQuery.eq('category_id', categoryId);
  }

  const [{ data: articles, error: aErr }, { data: lessons, error: lErr }] = await Promise.all([
    articlesQuery,
    lessonsQuery,
  ]);

  if (aErr) throw new Error(`Articles query failed: ${aErr.message}`);
  if (lErr) throw new Error(`Lessons query failed: ${lErr.message}`);

  const tagged = [
    ...(articles || []).map((a) => ({
      ...a,
      item_type: 'article',
      // article doesn't have these fields, normalize to null
      video_url: null,
      thumbnail_url: a.image_url || null,
      duration_seconds: null,
    })),
    ...(lessons || []).map((l) => ({
      ...l,
      item_type: 'video',
      body: null,
      image_url: null,
    })),
  ];

  // Final merge sort: pinned first, then sort_order, then updated_at
  tagged.sort((a, b) => {
    if ((b.is_pinned ? 1 : 0) !== (a.is_pinned ? 1 : 0)) {
      return (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0);
    }
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  return tagged;
}

function tableFor(type) {
  if (!VALID_TYPES.includes(type)) {
    throw Object.assign(new Error(`Invalid item type: ${type}`), { statusCode: 400 });
  }
  return TABLE_FOR_TYPE[type];
}

// ============================================================
// CATEGORIES
// ============================================================
router.get('/categories', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('guide_categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    // Tack on per-category counts (articles + lessons) so the UI can show
    // "12 items" badges on each pill without a second round-trip.
    const cats = data || [];
    const counts = await Promise.all(
      cats.map(async (c) => {
        const [{ count: aCount }, { count: lCount }] = await Promise.all([
          supabase.from('guide_articles').select('id', { count: 'exact', head: true })
            .eq('category_id', c.id),
          supabase.from('lessons').select('id', { count: 'exact', head: true })
            .eq('category_id', c.id),
        ]);
        return { id: c.id, total: (aCount || 0) + (lCount || 0) };
      })
    );
    const countMap = Object.fromEntries(counts.map((c) => [c.id, c.total]));
    const enriched = cats.map((c) => ({ ...c, item_count: countMap[c.id] || 0 }));

    // Also count uncategorized as a virtual entry
    const [{ count: uncatArticles }, { count: uncatLessons }] = await Promise.all([
      supabase.from('guide_articles').select('id', { count: 'exact', head: true }).is('category_id', null),
      supabase.from('lessons').select('id', { count: 'exact', head: true }).is('category_id', null),
    ]);
    const uncategorized_count = (uncatArticles || 0) + (uncatLessons || 0);

    res.json({ categories: enriched, uncategorized_count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const { name, slug, description, icon, color } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    // Determine next sort_order
    const { data: maxRow } = await supabase
      .from('guide_categories')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = (maxRow?.sort_order ?? -1) + 1;

    const { data, error } = await supabase
      .from('guide_categories')
      .insert({
        name: name.trim().slice(0, 100),
        slug: (slug || slugify(name)).slice(0, 80),
        description: description?.trim() || null,
        icon: icon?.trim() || '📚',
        color: color?.trim() || '#a78bfa',
        sort_order: nextSort,
      })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A category with this slug already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.patch('/categories/:id', async (req, res) => {
  try {
    const allowed = ['name', 'slug', 'description', 'icon', 'color', 'sort_order'];
    const update = { updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];

    const { data, error } = await supabase
      .from('guide_categories')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Category not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    // Items in this category get category_id=null automatically via ON DELETE SET NULL.
    const { error } = await supabase
      .from('guide_categories')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk-reorder categories
// body: { ordered_ids: [uuid, uuid, ...] }
router.post('/categories/reorder', async (req, res) => {
  try {
    const ids = req.body?.ordered_ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ordered_ids must be a non-empty array' });
    }
    const updates = await Promise.all(
      ids.map((id, idx) =>
        supabase
          .from('guide_categories')
          .update({ sort_order: idx, updated_at: new Date().toISOString() })
          .eq('id', id)
      )
    );
    const errs = updates.map((r) => r.error).filter(Boolean);
    if (errs.length) return res.status(500).json({ error: errs.map((e) => e.message).join('; ') });
    res.json({ success: true, count: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ITEMS (articles + videos, unified)
// ============================================================
router.get('/items', async (req, res) => {
  try {
    const categoryId = req.query.category_id || 'all';
    const items = await fetchItemsForCategory(categoryId);
    res.json({ items, count: items.length });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Move an item to a different category
// POST /api/guides-v2/items/:type/:id/move
// body: { category_id: uuid | null }
router.post('/items/:type/:id/move', async (req, res) => {
  try {
    const table = tableFor(req.params.type);
    const { category_id } = req.body || {};
    if (category_id !== null && typeof category_id !== 'string') {
      return res.status(400).json({ error: 'category_id must be uuid or null' });
    }
    const { data, error } = await supabase
      .from(table)
      .update({ category_id, sort_order: 0, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Item not found' });
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Toggle pin
router.post('/items/:type/:id/pin', async (req, res) => {
  try {
    const table = tableFor(req.params.type);
    const { is_pinned } = req.body || {};
    const newVal = typeof is_pinned === 'boolean' ? is_pinned : null;

    let nextPinned = newVal;
    if (nextPinned === null) {
      // Toggle: look up current value first
      const { data: row, error: getErr } = await supabase
        .from(table).select('is_pinned').eq('id', req.params.id).single();
      if (getErr) throw getErr;
      if (!row) return res.status(404).json({ error: 'Item not found' });
      nextPinned = !row.is_pinned;
    }

    const { data, error } = await supabase
      .from(table)
      .update({ is_pinned: nextPinned, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Bulk-reorder items within a category
// body: { ordered: [{ type: 'article'|'video', id: uuid }, ...] }
router.post('/items/reorder', async (req, res) => {
  try {
    const ordered = req.body?.ordered;
    if (!Array.isArray(ordered) || ordered.length === 0) {
      return res.status(400).json({ error: 'ordered must be a non-empty array' });
    }
    for (const o of ordered) {
      if (!o || !VALID_TYPES.includes(o.type) || typeof o.id !== 'string') {
        return res.status(400).json({ error: 'Each entry needs {type:"article"|"video", id:uuid}' });
      }
    }

    const updates = await Promise.all(
      ordered.map((o, idx) =>
        supabase
          .from(TABLE_FOR_TYPE[o.type])
          .update({ sort_order: idx, updated_at: new Date().toISOString() })
          .eq('id', o.id)
      )
    );
    const errs = updates.map((r) => r.error).filter(Boolean);
    if (errs.length) return res.status(500).json({ error: errs.map((e) => e.message).join('; ') });
    res.json({ success: true, count: ordered.length });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;
