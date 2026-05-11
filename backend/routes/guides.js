const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

const GUIDE_IMAGES_BUCKET = 'guide-images';
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// GET all articles (title + updated_at only, no full content — keeps the list endpoint fast)
router.get('/', async (req, res) => {
  const search = (req.query.search || '').trim();
  let query = supabase
    .from('guide_articles')
    .select('id, title, updated_at, created_at')
    .order('updated_at', { ascending: false });

  if (search) {
    // Use full-text-ish search: title ILIKE OR content_text ILIKE
    // (Simpler than tsvector for short queries, and works fine for <100 articles)
    query = query.or(`title.ilike.%${search.replace(/%/g, '')}%,content_text.ilike.%${search.replace(/%/g, '')}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET single article (full content)
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('guide_articles')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Article not found' });
  res.json(data);
});

// POST create
router.post('/', async (req, res) => {
  const { title = 'Untitled', content = null, content_text = '' } = req.body;
  const { data, error } = await supabase
    .from('guide_articles')
    .insert({ title, content, content_text })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH update
router.patch('/:id', async (req, res) => {
  const { title, content, content_text } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (content_text !== undefined) updates.content_text = content_text;

  const { data, error } = await supabase
    .from('guide_articles')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('guide_articles')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST upload an image (used inline in TipTap editor).
// Accepts a base64 data URL like the other image uploads in this app.
router.post('/:id/image', async (req, res) => {
  const { image_data_url } = req.body;
  if (!image_data_url) return res.status(400).json({ error: 'image_data_url is required' });

  const match = String(image_data_url).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Invalid image format' });
  const [, mimeType, base64Data] = match;
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType.toLowerCase())) {
    return res.status(400).json({ error: `Unsupported image type: ${mimeType}` });
  }
  const buf = Buffer.from(base64Data, 'base64');
  if (buf.length > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: `Image too large: ${(buf.length / 1024 / 1024).toFixed(1)} MB (max 5 MB)` });
  }
  if (buf.length === 0) return res.status(400).json({ error: 'Image is empty' });

  // Path: articles/{articleId}/{random}.{ext}
  const ext = mimeType.split('/')[1].toLowerCase().replace('jpeg', 'jpg');
  const { randomUUID } = require('crypto');
  const filename = `${randomUUID()}.${ext}`;
  const fullPath = `articles/${req.params.id}/${filename}`;

  const { error: upErr } = await supabase.storage
    .from(GUIDE_IMAGES_BUCKET)
    .upload(fullPath, buf, {
      contentType: mimeType,
      cacheControl: '604800',
      upsert: false,
    });
  if (upErr) {
    return res.status(500).json({ error: `Upload failed: ${upErr.message}` });
  }

  const { data: pub } = supabase.storage.from(GUIDE_IMAGES_BUCKET).getPublicUrl(fullPath);
  if (!pub?.publicUrl) return res.status(500).json({ error: 'Could not generate public URL' });

  res.json({ url: pub.publicUrl, path: fullPath });
});

module.exports = router;
