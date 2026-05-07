const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// GET all to-do lists with first reel thumbnail + counts
router.get('/', async (req, res) => {
  const { data: lists, error } = await supabase
    .from('todo_lists')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  if (!lists || lists.length === 0) return res.json([]);

  // For each list, fetch first reel's thumbnail + counts
  const enriched = await Promise.all(
    lists.map(async (l) => {
      const { data: items } = await supabase
        .from('todo_list_reels')
        .select('is_done, reels(thumbnail_url)')
        .eq('todo_list_id', l.id)
        .order('added_at', { ascending: false });

      const total = (items || []).length;
      const done = (items || []).filter((i) => i.is_done).length;
      const firstThumb = (items || []).find((i) => i.reels?.thumbnail_url)?.reels?.thumbnail_url || null;

      return { ...l, total_reels: total, done_count: done, preview_thumbnail: firstThumb };
    })
  );

  res.json(enriched);
});

// GET single list with all its reels
router.get('/:id', async (req, res) => {
  const { data: list, error } = await supabase
    .from('todo_lists')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(500).json({ error: error.message });

  const { data: items } = await supabase
    .from('todo_list_reels')
    .select(`
      id, is_done, added_at, done_at,
      reels (
        id, instagram_id, url, thumbnail_url, caption,
        views, likes, comments, posted_at,
        creators ( id, username, display_name )
      )
    `)
    .eq('todo_list_id', req.params.id)
    .order('added_at', { ascending: false });

  res.json({ ...list, items: items || [] });
});

// POST create list
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabase
    .from('todo_lists')
    .insert({ name })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH rename
router.patch('/:id', async (req, res) => {
  const { name } = req.body;
  const { data, error } = await supabase
    .from('todo_lists')
    .update({ name })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE list
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('todo_lists').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST add reel to list
router.post('/:id/reels', async (req, res) => {
  const { reel_id } = req.body;
  if (!reel_id) return res.status(400).json({ error: 'reel_id is required' });
  const { data, error } = await supabase
    .from('todo_list_reels')
    .upsert({ todo_list_id: req.params.id, reel_id }, { onConflict: 'todo_list_id,reel_id' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE reel from list
router.delete('/:id/reels/:reelId', async (req, res) => {
  const { error } = await supabase
    .from('todo_list_reels')
    .delete()
    .eq('todo_list_id', req.params.id)
    .eq('reel_id', req.params.reelId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// PATCH toggle done
router.patch('/:id/reels/:reelId', async (req, res) => {
  const { is_done } = req.body;
  const { data, error } = await supabase
    .from('todo_list_reels')
    .update({ is_done, done_at: is_done ? new Date().toISOString() : null })
    .eq('todo_list_id', req.params.id)
    .eq('reel_id', req.params.reelId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
