// ============================================================
// /api/guides-v2 — Guides Overhaul backend (v2 — schema-correct)
// ============================================================
// FIXED: column names now match actual DB schema:
//   guide_articles: id, title, content (jsonb), content_text, created_at, updated_at
//                   (+ added by migration: category_id, sort_order, is_pinned)
//   lessons:        id, title, description, source_type, source_data,
//                   thumbnail_url, is_done, done_at, created_at, updated_at
//                   (+ added by migration: category_id, sort_order, is_pinned)
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

// Pull a short preview snippet from the article's plain-text body
function previewFromContentText(content_text) {
  if (!content_text) return null;
  const t = String(content_text).trim().replace(/\s+/g, ' ');
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
}

async function fetchItemsForCategory(categoryId) {
  // Build queries with REAL columns
  const articlesQuery = supabase
    .from('guide_articles')
    .select('id, title, content_text, sort_order, is_pinned, created_at, updated_at, category_id');

  const lessonsQuery = supabase
    .from('lessons')
    .select('id, title, description, source_type, source_data, thumbnail_url, is_done, sort_order, is_pinned, created_at, updated_at, category_id');

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

  // Normalize to a shared shape for the UI
  const tagged = [
    ...(articles || []).map((a) => ({
      id: a.id,
      title: a.title,
      summary: previewFromContentText(a.content_text),
      thumbnail_url: null,           // articles don't have thumbnails (yet)
      duration_seconds: null,
      is_pinned: !!a.is_pinned,
      sort_order: a.sort_order ?? 0,
      category_id: a.category_id,
      created_at: a.created_at,
      updated_at: a.updated_at,
      item_type: 'article',
    })),
    ...(lessons || []).map((l) => ({
      id: l.id,
      title: l.title,
      summary: l.description || null,
      thumbnail_url: l.thumbnail_url || null,
      duration_seconds: null,        // not in schema, leave null
      source_type: l.source_type,
      source_data: l.source_data,
      is_done: !!l.is_done,
      is_pinned: !!l.is_pinned,
      sort_order: l.sort_order ?? 0,
      category_id: l.category_id,
      created_at: l.created_at,
      updated_at: l.updated_at,
      item_type: 'video',
    })),
  ];

  // Sort: pinned first → sort_order → updated_at desc
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
    // Alphabetical, case-insensitive, Italian locale (handles accents).
    // The legacy sort_order column is preserved on the row (and the
    // /categories/reorder endpoint still writes to it) but it no longer
    // affects this listing. Sort done client-side because Postgres'
    // default ORDER BY is byte-wise ASCII — 'Zoom' would sort before
    // 'alfa' since 'Z' (0x5A) < 'a' (0x61).
    const { data, error } = await supabase
      .from('guide_categories')
      .select('*');
    if (error) throw error;

    const cats = (data || []).slice().sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'it', { sensitivity: 'base' })
    );
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
// ITEMS
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

// ============================================================
// IMPORTANT — route declaration order matters in Express.
// Literal-path routes (e.g. /items/reorder) MUST be declared BEFORE
// parameterized routes (e.g. /items/:type), otherwise the parameterized
// pattern wins and `:type` ends up matching the literal segment.
//
// This is why the earlier version of this file returned
// "type must be article or video" when the frontend POSTed to /items/reorder
// — the request was hitting /items/:type with type='reorder'.
// ============================================================

// Bulk-reorder items within a category — MUST be before /items/:type below
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

// ============================================================
// CREATE A NEW ARTICLE / VIDEO STUB (in optional category)
// Solves the "/guides/new" UUID problem — backend creates the row
// first, returns its real id, frontend then navigates to /guides/:id
// ============================================================
router.post('/items/:type', async (req, res) => {
  try {
    const type = req.params.type;
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be article or video` });
    }
    const { category_id } = req.body || {};

    if (type === 'article') {
      const { data, error } = await supabase
        .from('guide_articles')
        .insert({
          title: 'Untitled',
          content: null,
          content_text: '',
          category_id: category_id || null,
        })
        .select()
        .single();
      if (error) throw error;
      return res.json({ ...data, item_type: 'article' });
    } else {
      // Lessons need a non-null source_type+source_data because of the check
      // constraint. We seed an empty youtube placeholder that the detail page
      // overwrites as soon as the user enters a URL.
      const { data, error } = await supabase
        .from('lessons')
        .insert({
          title: 'Untitled',
          description: null,
          source_type: 'youtube',
          source_data: 'https://www.youtube.com/watch?v=',  // placeholder, user fixes
          category_id: category_id || null,
        })
        .select()
        .single();
      if (error) throw error;
      return res.json({ ...data, item_type: 'video' });
    }
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Move an item to a different category
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

module.exports = router;
