const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { backupReelInBackground } = require('../services/backupService');
const { uploadImageDataUrl } = require('../lib/imageUpload');

const HIKERAPI_BASE = 'https://api.hikerapi.com';
const HIKERAPI_TOKEN = process.env.HIKERAPI_TOKEN;

// ----- Helpers ------------------------------------------------

function extractInstagramShortcode(input) {
  // Accepts a full IG URL or a bare shortcode
  if (!input) return null;
  const trimmed = input.trim();
  // Bare shortcode (no slash, no http)
  if (!/[\/:]/.test(trimmed)) return trimmed;
  // Full URL: pull out /reel/CODE/ or /p/CODE/ or /tv/CODE/
  const match = trimmed.match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

async function hikerGet(path, params = {}) {
  if (!HIKERAPI_TOKEN) throw new Error('HIKERAPI_TOKEN not configured on server');
  const url = new URL(`${HIKERAPI_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'x-access-key': HIKERAPI_TOKEN, accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HikerAPI ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ----- OWNER ENDPOINTS (existing app, requires being signed in via frontend) -----

// GET all to-do lists with first reel thumbnail + counts
router.get('/', async (req, res) => {
  const { data: lists, error } = await supabase
    .from('todo_lists')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  if (!lists || lists.length === 0) return res.json([]);

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
      id, is_done, added_at, done_at, public_note, private_note,
      reels (
        id, instagram_id, url, thumbnail_url, caption, is_manual,
        views, likes, comments, posted_at,
        backup_status, backup_video_url, backup_thumbnail_url, backup_error,
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

// PATCH rename + update list-level notes
router.patch('/:id', async (req, res) => {
  const { name, public_note, private_note } = req.body;
  // Only update fields that were actually provided (so callers can patch one at a time)
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (public_note !== undefined) updates.public_note = public_note;
  if (private_note !== undefined) updates.private_note = private_note;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await supabase
    .from('todo_lists')
    .update(updates)
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

// POST add reel to list (existing: from already-tracked reels)
router.post('/:id/reels', async (req, res) => {
  const { reel_id } = req.body;
  if (!reel_id) return res.status(400).json({ error: 'reel_id is required' });

  // Check duplicate explicitly so we can return a friendly message.
  const { data: existing } = await supabase
    .from('todo_list_reels')
    .select('id')
    .eq('todo_list_id', req.params.id)
    .eq('reel_id', reel_id)
    .maybeSingle();
  if (existing) {
    return res.status(409).json({ error: 'This reel is already in this list' });
  }

  const { data, error } = await supabase
    .from('todo_list_reels')
    .insert({ todo_list_id: req.params.id, reel_id })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Trigger backup in the background — return immediately, don't make the user wait
  backupReelInBackground(reel_id);

  res.json(data);
});

// POST add reel BY INSTAGRAM LINK (new feature 4)
router.post('/:id/reels/by-link', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) {
    return res.status(400).json({ error: 'Could not parse Instagram URL. Expected something like instagram.com/reel/ABC123/' });
  }

  try {
    // Step 1: see if we already have this reel locally
    const { data: existingReel } = await supabase
      .from('reels')
      .select('id')
      .eq('instagram_id', shortcode) // we use shortcode as instagram_id when manually added
      .maybeSingle();

    let reelId = existingReel?.id;

    // Step 2: if not, fetch metadata from HikerAPI and store it
    if (!reelId) {
      // HikerAPI has /v1/media/by/code which returns the full media object by shortcode
      let media;
      try {
        media = await hikerGet('/v1/media/by/code', { code: shortcode });
      } catch (err) {
        return res.status(404).json({ error: `Could not fetch reel metadata: ${err.message}` });
      }

      const postedAt = media.taken_at_ts
        ? new Date(media.taken_at_ts * 1000).toISOString()
        : (media.taken_at ? new Date(media.taken_at).toISOString() : new Date().toISOString());

      const newReel = {
        creator_id: null, // manual add — not tied to a tracked creator
        instagram_id: shortcode,
        url: `https://www.instagram.com/reel/${shortcode}/`,
        thumbnail_url: media.thumbnail_url || null,
        caption: (media.caption_text || '').substring(0, 500) || null,
        views: media.play_count || 0,
        likes: media.like_count || 0,
        comments: media.comment_count || 0,
        duration_seconds: media.video_duration ? Math.round(media.video_duration) : null,
        posted_at: postedAt,
        is_manual: true,
      };

      const { data: inserted, error: insertErr } = await supabase
        .from('reels')
        .insert(newReel)
        .select()
        .single();
      if (insertErr) return res.status(500).json({ error: `Failed to save reel: ${insertErr.message}` });
      reelId = inserted.id;
    }

    // Step 3: link to the to-do list (check duplicate first)
    const { data: existingPair } = await supabase
      .from('todo_list_reels')
      .select('id')
      .eq('todo_list_id', req.params.id)
      .eq('reel_id', reelId)
      .maybeSingle();
    if (existingPair) {
      return res.status(409).json({ error: 'This reel is already in this list' });
    }

    const { data: linked, error: linkErr } = await supabase
      .from('todo_list_reels')
      .insert({ todo_list_id: req.params.id, reel_id: reelId })
      .select()
      .single();
    if (linkErr) return res.status(500).json({ error: linkErr.message });

    // Trigger backup in the background
    backupReelInBackground(reelId);

    res.json({ success: true, reel_id: reelId, link: linked });
  } catch (err) {
    console.error('[POST /by-link] Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
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

// PATCH update notes on a reel within a list (public + private)
router.patch('/:id/reels/:reelId/note', async (req, res) => {
  const { public_note, private_note } = req.body;
  const updates = {};
  if (public_note !== undefined) updates.public_note = public_note;
  if (private_note !== undefined) updates.private_note = private_note;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await supabase
    .from('todo_list_reels')
    .update(updates)
    .eq('todo_list_id', req.params.id)
    .eq('reel_id', req.params.reelId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST manually retry a backup that failed (or trigger one for a reel that doesn't have one)
router.post('/:id/reels/:reelId/backup', async (req, res) => {
  // Verify the reel is in the list (defensive)
  const { data: link } = await supabase
    .from('todo_list_reels')
    .select('id')
    .eq('todo_list_id', req.params.id)
    .eq('reel_id', req.params.reelId)
    .maybeSingle();
  if (!link) return res.status(404).json({ error: 'Reel not in this list' });

  backupReelInBackground(req.params.reelId);
  res.json({ success: true, message: 'Backup started' });
});

// POST upload a cover image for a list (accepts a base64 data URL)
router.post('/:id/cover-image', async (req, res) => {
  const { image_data_url } = req.body;
  if (!image_data_url) return res.status(400).json({ error: 'image_data_url is required' });

  // Verify the list exists
  const { data: list } = await supabase
    .from('todo_lists')
    .select('id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!list) return res.status(404).json({ error: 'List not found' });

  try {
    const url = await uploadImageDataUrl(image_data_url, `todo-lists/${req.params.id}`);
    const { data, error } = await supabase
      .from('todo_lists')
      .update({ cover_image_url: url })
      .eq('id', req.params.id)
      .select('id, cover_image_url')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE the cover image (clear it from the list, file stays in storage)
router.delete('/:id/cover-image', async (req, res) => {
  const { error } = await supabase
    .from('todo_lists')
    .update({ cover_image_url: null })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ----- PUBLIC ENDPOINTS (no auth — accessed by token) ----------

// GET public list by token
router.get('/public/:token', async (req, res) => {
  const { data: list, error } = await supabase
    .from('todo_lists')
    .select('id, name, public_token, public_note, cover_image_url, created_at')
    .eq('public_token', req.params.token)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!list) return res.status(404).json({ error: 'List not found' });

  // IMPORTANT: select only public_note, never private_note
  const { data: items } = await supabase
    .from('todo_list_reels')
    .select(`
      id, is_done, added_at, done_at, public_note,
      reels (
        id, url, thumbnail_url, caption, is_manual,
        views, likes, comments, posted_at,
        backup_status, backup_video_url, backup_thumbnail_url,
        creators ( username, display_name )
      )
    `)
    .eq('todo_list_id', list.id)
    .order('added_at', { ascending: false });

  res.json({
    id: list.id,
    name: list.name,
    public_token: list.public_token,
    public_note: list.public_note,
    cover_image_url: list.cover_image_url,
    items: items || [],
  });
});

// PATCH (public): toggle done by token — anyone with the link can mark reels done
router.patch('/public/:token/reels/:reelId', async (req, res) => {
  const { is_done } = req.body;

  // First verify the token maps to a list
  const { data: list } = await supabase
    .from('todo_lists')
    .select('id')
    .eq('public_token', req.params.token)
    .maybeSingle();
  if (!list) return res.status(404).json({ error: 'List not found' });

  const { data, error } = await supabase
    .from('todo_list_reels')
    .update({ is_done, done_at: is_done ? new Date().toISOString() : null })
    .eq('todo_list_id', list.id)
    .eq('reel_id', req.params.reelId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
