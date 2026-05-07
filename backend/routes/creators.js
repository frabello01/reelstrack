const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// GET all creators
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('creators')
    .select('*')
    .order('username');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST add creator (by username)
router.post('/', async (req, res) => {
  const { username, display_name } = req.body;
  if (!username) return res.status(400).json({ error: 'username is required' });

  const clean = username.replace('@', '').toLowerCase().trim();

  // Upsert creator
  const { data, error } = await supabase
    .from('creators')
    .upsert({ username: clean, display_name: display_name || clean }, { onConflict: 'username' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE creator
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('creators').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
