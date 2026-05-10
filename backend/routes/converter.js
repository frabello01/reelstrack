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

// ----- MP3 conversion via ConvertHub --------------------------------

const CONVERTHUB_BASE = 'https://api.converthub.com/v2';
const CONVERTHUB_API_KEY = process.env.CONVERTHUB_API_KEY;

// Helper: poll a ConvertHub job until completed/failed (or timeout)
async function pollConvertHubJob(jobId, { timeoutMs = 90_000, intervalMs = 2000 } = {}) {
  if (!CONVERTHUB_API_KEY) throw new Error('CONVERTHUB_API_KEY not configured on server');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${CONVERTHUB_BASE}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${CONVERTHUB_API_KEY}`, accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ConvertHub status check failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (data.status === 'completed') return data;
    if (data.status === 'failed') {
      throw new Error(data.error?.message || 'ConvertHub conversion failed');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('ConvertHub conversion timed out (90s)');
}

// POST /api/converter/convert-to-mp3
// Body: { url: "https://..." or "ABC123" }
// Steps:
//   1. Use HikerAPI to fetch the reel's CDN video URL (same as fetch-reel)
//   2. Submit to ConvertHub /convert-url with target=mp3
//   3. Poll until done
//   4. Return the MP3 download URL + a suggested filename
router.post('/convert-to-mp3', async (req, res) => {
  if (!CONVERTHUB_API_KEY) {
    return res.status(503).json({ error: 'MP3 conversion is not configured (missing CONVERTHUB_API_KEY)' });
  }

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) {
    return res.status(400).json({ error: 'Could not parse Instagram URL.' });
  }

  // Step 1: get the reel's video URL from HikerAPI
  let media;
  try {
    media = await hikerGet('/v1/media/by/code', { code: shortcode });
  } catch (err) {
    return res.status(err.status || 500).json({ error: `Could not fetch reel: ${err.message}` });
  }
  const videoUrl = media.video_url;
  if (!videoUrl) {
    return res.status(404).json({ error: 'No video URL — the reel may have been removed from Instagram.' });
  }
  const username = media.user?.username || 'reel';
  const safeUsername = username.replace(/[^a-zA-Z0-9._-]/g, '_');
  const suggestedFilename = `${safeUsername}-${shortcode}.mp3`;

  // Step 2: submit to ConvertHub
  // The IG CDN URL doesn't always end in `.mp4`, but ConvertHub expects an extension
  // it can recognize. Adding `?format=mp4` doesn't help since they use the URL path.
  // Workaround: tell ConvertHub explicitly via the `output_filename` field that the
  // source is mp4 by referencing it in metadata, but the real fix is that ConvertHub
  // will detect the MIME type from the response Content-Type when downloading. IG
  // serves video/mp4 content-type, so this should just work.
  let job;
  try {
    const submitRes = await fetch(`${CONVERTHUB_BASE}/convert-url`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONVERTHUB_API_KEY}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        file_url: videoUrl,
        target_format: 'mp3',
        output_filename: suggestedFilename,
      }),
    });
    if (!submitRes.ok) {
      const body = await submitRes.text().catch(() => '');
      // Common errors: 402 INSUFFICIENT_CREDITS, 400 DOWNLOAD_FAILED, 422 VALIDATION_ERROR
      console.error('[convert-to-mp3] ConvertHub submit failed:', submitRes.status, body.slice(0, 500));
      let message = 'ConvertHub rejected the conversion request.';
      try {
        const parsed = JSON.parse(body);
        message = parsed.error?.message || message;
      } catch {}
      return res.status(submitRes.status).json({ error: message });
    }
    job = await submitRes.json();
  } catch (err) {
    return res.status(500).json({ error: `Could not submit conversion: ${err.message}` });
  }

  if (!job.job_id) {
    return res.status(500).json({ error: 'ConvertHub did not return a job ID' });
  }

  // ConvertHub may return a cached completed result immediately
  if (job.status === 'completed' && job.result?.download_url) {
    return res.json({
      mp3_url: job.result.download_url,
      filename: suggestedFilename,
      cached: true,
    });
  }

  // Step 3: poll until done
  let final;
  try {
    final = await pollConvertHubJob(job.job_id);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const downloadUrl = final.result?.download_url;
  if (!downloadUrl) {
    return res.status(500).json({ error: 'Conversion completed but no download URL was returned.' });
  }

  res.json({
    mp3_url: downloadUrl,
    filename: suggestedFilename,
    cached: false,
  });
});

module.exports = router;
