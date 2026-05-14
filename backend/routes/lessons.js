const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

const LESSON_IMAGES_BUCKET = 'custom-images';
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// ============================================================
// SAFE IFRAME HANDLING
// ============================================================
// We accept iframe embed HTML from the user, but only render iframes pointing
// to known-safe video hosts. Everything else is rejected.
// We strip all attributes except src, width, height, allow, allowfullscreen,
// and frameborder. Any other tags inside the input are stripped entirely.

const ALLOWED_IFRAME_HOSTS = [
  'youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
  'vimeo.com', 'player.vimeo.com',
  'mega.nz', 'mega.io',
  'loom.com', 'www.loom.com',
  'wistia.net', 'fast.wistia.net', 'fast.wistia.com',
  'dailymotion.com', 'www.dailymotion.com', 'geo.dailymotion.com',
];

function isAllowedHost(urlString) {
  try {
    const u = new URL(urlString);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_IFRAME_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// Extract the iframe src from arbitrary HTML the user pastes, validate the host,
// and return a clean rebuilt iframe string. Returns null if invalid.
function sanitizeEmbedHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return null;
  // Find the FIRST iframe tag — ignore everything else around it
  const iframeMatch = rawHtml.match(/<iframe\b[^>]*>/i);
  if (!iframeMatch) return null;
  const tag = iframeMatch[0];
  // Pull src attribute
  const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  if (!srcMatch) return null;
  const src = srcMatch[1].trim();
  if (!isAllowedHost(src)) return null;

  // Pull width/height if present, otherwise use sensible defaults
  const widthMatch = tag.match(/\bwidth\s*=\s*["']?(\d+)["']?/i);
  const heightMatch = tag.match(/\bheight\s*=\s*["']?(\d+)["']?/i);
  const width = widthMatch ? widthMatch[1] : '640';
  const height = heightMatch ? heightMatch[1] : '360';

  // Rebuild as a clean iframe — drop any other attributes (event handlers, etc.)
  // We always set our own sandbox-friendly attributes.
  return `<iframe src="${src}" width="${width}" height="${height}" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
}

// Convert a YouTube watch/shorts URL to its embed-friendly form.
// Accepts:
//   https://www.youtube.com/watch?v=VIDEO_ID
//   https://youtu.be/VIDEO_ID
//   https://www.youtube.com/shorts/VIDEO_ID
//   https://www.youtube.com/embed/VIDEO_ID  (already correct)
// Returns the canonical embed URL, or null if it doesn't look like YouTube.
function youtubeUrlToEmbed(url) {
  if (!url || typeof url !== 'string') return null;
  let videoId = null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      videoId = u.pathname.split('/').filter(Boolean)[0];
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        videoId = u.searchParams.get('v');
      } else if (u.pathname.startsWith('/embed/')) {
        videoId = u.pathname.split('/')[2];
      } else if (u.pathname.startsWith('/shorts/')) {
        videoId = u.pathname.split('/')[2];
      }
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (!videoId || !/^[a-zA-Z0-9_-]{8,}$/.test(videoId)) return null;
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

// Extract the YouTube video ID from various URL forms, used to fetch a thumbnail.
function youtubeIdFromUrl(url) {
  const embed = youtubeUrlToEmbed(url);
  if (!embed) return null;
  const m = embed.match(/\/embed\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// ============================================================
// ROUTES
// ============================================================

// GET all lessons (newest first by default)
router.get('/', async (req, res) => {
  const search = (req.query.search || '').trim();
  let query = supabase
    .from('lessons')
    .select('*')
    .order('created_at', { ascending: false });
  if (search) {
    const escaped = search.replace(/%/g, '');
    query = query.or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET single lesson
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('lessons')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Lesson not found' });
  res.json(data);
});

// POST create. Accepts either a YouTube URL or pasted iframe embed HTML.
// Body: { title, description?, source: { type: 'youtube'|'embed', value: string }, thumbnail_url? }
router.post('/', async (req, res) => {
  const { title, description = '', source, thumbnail_url = null } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (!source || !source.type || !source.value) {
    return res.status(400).json({ error: 'source { type, value } is required' });
  }

  let source_type, source_data, auto_thumb = null;

  if (source.type === 'youtube') {
    const embedUrl = youtubeUrlToEmbed(source.value);
    if (!embedUrl) {
      return res.status(400).json({ error: 'That does not look like a valid YouTube URL. Try the full https://www.youtube.com/watch?v=… link.' });
    }
    source_type = 'youtube';
    source_data = embedUrl;
    // Get a default thumbnail from YouTube's CDN for free (no API call needed)
    const videoId = youtubeIdFromUrl(source.value);
    if (videoId) auto_thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  } else if (source.type === 'embed') {
    const sanitized = sanitizeEmbedHtml(source.value);
    if (!sanitized) {
      return res.status(400).json({
        error: `Embed not allowed. Paste a complete <iframe> tag whose src points to one of: ${ALLOWED_IFRAME_HOSTS.slice(0, 6).join(', ')}…`,
      });
    }
    source_type = 'embed_html';
    source_data = sanitized;
  } else {
    return res.status(400).json({ error: `Unknown source.type: ${source.type}` });
  }

  const { data, error } = await supabase
    .from('lessons')
    .insert({
      title: title.trim(),
      description: description || null,
      source_type,
      source_data,
      thumbnail_url: thumbnail_url || auto_thumb,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH update — title, description, thumbnail_url, is_done, or replace the source
router.patch('/:id', async (req, res) => {
  const { title, description, thumbnail_url, is_done, source } = req.body || {};
  const updates = { updated_at: new Date().toISOString() };

  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (thumbnail_url !== undefined) updates.thumbnail_url = thumbnail_url;
  if (is_done !== undefined) {
    updates.is_done = !!is_done;
    updates.done_at = is_done ? new Date().toISOString() : null;
  }
  if (source) {
    if (source.type === 'youtube') {
      const embedUrl = youtubeUrlToEmbed(source.value);
      if (!embedUrl) return res.status(400).json({ error: 'Invalid YouTube URL' });
      updates.source_type = 'youtube';
      updates.source_data = embedUrl;
    } else if (source.type === 'embed') {
      const sanitized = sanitizeEmbedHtml(source.value);
      if (!sanitized) return res.status(400).json({ error: 'Embed not allowed (host not in allowlist)' });
      updates.source_type = 'embed_html';
      updates.source_data = sanitized;
    }
  }

  if (Object.keys(updates).length <= 1) {
    // Only updated_at — nothing to update
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await supabase
    .from('lessons')
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
    .from('lessons')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST upload a thumbnail image (base64 data URL).
// Path: lessons/{lessonId}/{uuid}.{ext}
router.post('/:id/thumbnail', async (req, res) => {
  const { image_data_url } = req.body || {};
  if (!image_data_url) return res.status(400).json({ error: 'image_data_url is required' });

  const match = String(image_data_url).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Invalid image format' });
  const [, mimeType, base64Data] = match;
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType.toLowerCase())) {
    return res.status(400).json({ error: `Unsupported image type: ${mimeType}` });
  }
  const buf = Buffer.from(base64Data, 'base64');
  if (buf.length === 0) return res.status(400).json({ error: 'Image is empty' });
  if (buf.length > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: `Image too large: ${(buf.length / 1024 / 1024).toFixed(1)} MB (max 5 MB)` });
  }

  const ext = mimeType.split('/')[1].toLowerCase().replace('jpeg', 'jpg');
  const { randomUUID } = require('crypto');
  const filename = `${randomUUID()}.${ext}`;
  const fullPath = `lessons/${req.params.id}/${filename}`;

  const { error: upErr } = await supabase.storage
    .from(LESSON_IMAGES_BUCKET)
    .upload(fullPath, buf, {
      contentType: mimeType,
      cacheControl: '604800',
      upsert: false,
    });
  if (upErr) return res.status(500).json({ error: `Upload failed: ${upErr.message}` });

  const { data: pub } = supabase.storage.from(LESSON_IMAGES_BUCKET).getPublicUrl(fullPath);
  if (!pub?.publicUrl) return res.status(500).json({ error: 'Could not generate public URL' });

  // Also save the URL onto the lesson
  await supabase
    .from('lessons')
    .update({ thumbnail_url: pub.publicUrl, updated_at: new Date().toISOString() })
    .eq('id', req.params.id);

  res.json({ url: pub.publicUrl, path: fullPath });
});

module.exports = router;
