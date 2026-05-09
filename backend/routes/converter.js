const express = require('express');
const router = express.Router();

const HIKERAPI_BASE = 'https://api.hikerapi.com';
const HIKERAPI_TOKEN = process.env.HIKERAPI_TOKEN;

function extractInstagramShortcode(input) {
  if (!input) return null;
  const trimmed = input.trim();
  // If they pasted a bare shortcode (no slash, no http)
  if (!/[\/:]/.test(trimmed)) return trimmed;
  const m = trimmed.match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
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

// POST /api/converter/fetch-reel
// Body: { url: "https://instagram.com/reel/ABC123/" or just "ABC123" }
// Returns: { shortcode, video_url, thumbnail_url, caption, username, suggested_filename }
router.post('/fetch-reel', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) {
    return res.status(400).json({ error: 'Could not parse Instagram URL. Expected something like instagram.com/reel/ABC123/' });
  }

  let media;
  try {
    media = await hikerGet('/v1/media/by/code', { code: shortcode });
  } catch (err) {
    return res.status(err.status || 500).json({ error: `Could not fetch reel: ${err.message}` });
  }

  const username = media.user?.username || null;
  const videoUrl = media.video_url;
  if (!videoUrl) {
    return res.status(404).json({ error: 'No video URL returned — the reel may have been removed from Instagram.' });
  }

  // Build a sensible default filename like "bianca_jorio-DXyzAbc"
  const safeUsername = (username || 'reel').replace(/[^a-zA-Z0-9._-]/g, '_');
  const suggestedFilename = `${safeUsername}-${shortcode}`;

  res.json({
    shortcode,
    video_url: videoUrl,
    thumbnail_url: media.thumbnail_url || null,
    caption: media.caption_text || null,
    username,
    full_name: media.user?.full_name || null,
    play_count: media.play_count || null,
    duration_seconds: media.video_duration ? Math.round(media.video_duration) : null,
    suggested_filename: suggestedFilename,
  });
});

module.exports = router;
