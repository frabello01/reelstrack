const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// GET all lists with creator count
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('lists')
    .select('*, list_creators(count)')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET single list with creators
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('lists')
    .select('*, list_creators(creator_id, creators(*))')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST create list
router.post('/', async (req, res) => {
  const { name, description, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabase
    .from('lists')
    .insert({ name, description, color })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH update list
router.patch('/:id', async (req, res) => {
  const { name, description, color } = req.body;
  const { data, error } = await supabase
    .from('lists')
    .update({ name, description, color })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE list
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('lists').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST add creator to list
router.post('/:id/creators', async (req, res) => {
  const { creator_id } = req.body;
  const { error } = await supabase
    .from('list_creators')
    .insert({ list_id: req.params.id, creator_id });
  if (error) {
    // Postgres unique-violation = the creator is already in this list.
    // Translate the cryptic "list_creators_pkey" message into something
    // the UI can show as-is.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This creator is already in the list' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json({ success: true });
});

// DELETE remove creator from list
router.delete('/:id/creators/:creator_id', async (req, res) => {
  const { error } = await supabase
    .from('list_creators')
    .delete()
    .eq('list_id', req.params.id)
    .eq('creator_id', req.params.creator_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
