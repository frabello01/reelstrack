const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// ============================================================
// CONFIG — xAI's Grok Imagine Video on Replicate
//
// Schema (https://replicate.com/xai/grok-imagine-video/api/schema):
//   prompt        string  (required)
//   image         uri     (optional — image-to-video; jpg/png/webp)
//   duration      int     1..15   default 5  (ignored in video-edit mode)
//   resolution    "720p" | "480p"  default 720p
//   aspect_ratio  auto | 16:9 | 4:3 | 1:1 | 9:16 | 3:4 | 3:2 | 2:3
//                                  default auto
// ============================================================
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_BASE = 'https://api.replicate.com/v1';
const VIDEO_MODEL = 'xai/grok-imagine-video';
const OUTPUT_BUCKET = 'generated-videos';

const VALID_ASPECT_RATIOS = ['auto', '16:9', '4:3', '1:1', '9:16', '3:4', '3:2', '2:3'];
const VALID_RESOLUTIONS = ['720p', '480p'];
const MAX_PROMPT_CHARS = 2000;

// Poll budget — video generation is slow. Most jobs finish in 60-120s, but
// queue waits during peak hours can push it to 4-5 minutes.
const POLL_MAX_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

// ============================================================
// REPLICATE HELPERS
// ============================================================
function replicateHeaders() {
  if (!REPLICATE_TOKEN) throw new Error('REPLICATE_API_TOKEN is not set on the server');
  return {
    Authorization: `Bearer ${REPLICATE_TOKEN}`,
    'Content-Type': 'application/json',
    // Wait up to 60s synchronously; if it isn't done we poll the prediction URL.
    Prefer: 'wait=60',
  };
}

async function runReplicate(modelPath, input) {
  const url = `${REPLICATE_BASE}/models/${modelPath}/predictions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: replicateHeaders(),
    body: JSON.stringify({ input }),
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }

  if (!res.ok) throw new Error(extractErr(body, res.status));

  if (body.status === 'starting' || body.status === 'processing') {
    return pollPrediction(body.urls?.get || `${REPLICATE_BASE}/predictions/${body.id}`);
  }
  return body;
}

async function pollPrediction(getUrl) {
  const started = Date.now();
  while (Date.now() - started < POLL_MAX_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(getUrl, { headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` } });
    const body = await res.json();
    if (['succeeded', 'failed', 'canceled'].includes(body.status)) return body;
  }
  throw new Error(`Replicate prediction timed out after ${POLL_MAX_MS / 1000}s`);
}

function extractErr(body, status) {
  if (typeof body?.detail === 'string') return body.detail;
  if (typeof body?.error === 'string') return body.error;
  if (typeof body?.title === 'string') return `${body.title}: ${body.detail || ''}`;
  if (body) return JSON.stringify(body).slice(0, 500);
  return `HTTP ${status}`;
}

// ============================================================
// MIRROR — pull the video file from Replicate's CDN and re-host it
// on our Supabase bucket so the URL never expires. Replicate's
// delivery URLs disappear after ~24h.
// ============================================================
async function mirrorVideoToStorage(remoteUrl, generationId) {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Could not download Replicate video (HTTP ${res.status})`);
  const contentType = res.headers.get('content-type') || 'video/mp4';
  const ext = contentType.includes('webm') ? 'webm'
            : contentType.includes('quicktime') ? 'mov'
            : 'mp4';
  const buf = Buffer.from(await res.arrayBuffer());
  const path = `gen/${generationId}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(OUTPUT_BUCKET)
    .upload(path, buf, { contentType, cacheControl: '604800', upsert: true });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(OUTPUT_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Could not get public URL');
  return pub.publicUrl;
}

// ============================================================
// STATUS
// ============================================================
router.get('/status', (req, res) => {
  res.json({
    configured: !!REPLICATE_TOKEN,
    model: VIDEO_MODEL,
    aspect_ratios: VALID_ASPECT_RATIOS,
    resolutions: VALID_RESOLUTIONS,
    duration_range: [1, 15],
  });
});

// ============================================================
// GENERATE
// Body: { prompt, image_url?, duration?, resolution?, aspect_ratio? }
// ============================================================
router.post('/generate', async (req, res) => {
  if (!REPLICATE_TOKEN) {
    return res.status(503).json({ error: 'REPLICATE_API_TOKEN is not set on the server' });
  }

  const {
    prompt,
    image_url,
    duration = 5,
    resolution = '720p',
    aspect_ratio = 'auto',
  } = req.body || {};

  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: `prompt must be ≤ ${MAX_PROMPT_CHARS} chars` });
  }
  if (!VALID_RESOLUTIONS.includes(resolution)) {
    return res.status(400).json({ error: `resolution must be one of ${VALID_RESOLUTIONS.join(', ')}` });
  }
  if (!VALID_ASPECT_RATIOS.includes(aspect_ratio)) {
    return res.status(400).json({ error: `aspect_ratio must be one of ${VALID_ASPECT_RATIOS.join(', ')}` });
  }
  const safeDuration = Math.max(1, Math.min(15, parseInt(duration, 10) || 5));
  if (image_url && (typeof image_url !== 'string' || !image_url.startsWith('http'))) {
    return res.status(400).json({ error: 'image_url must be a valid http(s) URL' });
  }

  // Pre-create the row so we have an ID for storage paths even if Replicate fails.
  const { data: gen, error: insertErr } = await supabase
    .from('video_studio_generations')
    .insert({
      prompt: prompt.trim(),
      image_url: image_url || null,
      aspect_ratio,
      resolution,
      duration: safeDuration,
      status: 'pending',
      thumbnail_url: image_url || null, // good fallback poster
    })
    .select()
    .single();
  if (insertErr) return res.status(500).json({ error: `DB error: ${insertErr.message}` });

  const startedAt = Date.now();
  const input = {
    prompt: prompt.trim(),
    duration: safeDuration,
    resolution,
    aspect_ratio,
  };
  if (image_url) input.image = image_url;

  console.log(`[video-studio] generate id=${gen.id} model=${VIDEO_MODEL} aspect=${aspect_ratio} res=${resolution} dur=${safeDuration} image=${!!image_url}`);

  let prediction;
  try {
    prediction = await runReplicate(VIDEO_MODEL, input);
  } catch (err) {
    console.error('[video-studio] replicate call failed:', err.message);
    const isNsfw = /nsfw|safety|content[_ ]?policy|moderation/i.test(err.message);
    await supabase.from('video_studio_generations')
      .update({
        status: isNsfw ? 'nsfw' : 'failed',
        error_message: err.message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', gen.id);
    return res.status(500).json({ error: err.message, generation_id: gen.id });
  }

  // Extract output URL — Replicate may return string OR string[]
  let outputUrl = null;
  if (Array.isArray(prediction?.output)) {
    outputUrl = prediction.output.find((u) => typeof u === 'string' && u.startsWith('http'));
  } else if (typeof prediction?.output === 'string') {
    outputUrl = prediction.output;
  }

  if (prediction?.status !== 'succeeded' || !outputUrl) {
    const errMsg = prediction?.error
      || (prediction?.status === 'failed' ? 'Replicate prediction failed' : 'No video URL returned');
    const isNsfw = /nsfw|safety|content[_ ]?policy|moderation/i.test(String(errMsg));
    await supabase.from('video_studio_generations')
      .update({
        status: isNsfw ? 'nsfw' : 'failed',
        error_message: String(errMsg).slice(0, 1000),
        replicate_prediction_id: prediction?.id || null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', gen.id);
    return res.status(500).json({ error: errMsg, generation_id: gen.id, raw: prediction });
  }

  // Mirror to our bucket (so the URL never expires).
  let mirroredUrl;
  try {
    mirroredUrl = await mirrorVideoToStorage(outputUrl, gen.id);
  } catch (err) {
    console.warn('[video-studio] mirror failed, using replicate URL:', err.message);
    mirroredUrl = outputUrl;
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  const { data: updated } = await supabase
    .from('video_studio_generations')
    .update({
      status: 'completed',
      video_url: mirroredUrl,
      original_replicate_url: outputUrl,
      replicate_prediction_id: prediction.id,
      elapsed_seconds: elapsed,
      completed_at: new Date().toISOString(),
    })
    .eq('id', gen.id)
    .select()
    .single();

  console.log(`[video-studio] done id=${gen.id} in ${elapsed.toFixed(1)}s`);
  res.json(updated || { ...gen, video_url: mirroredUrl, status: 'completed', elapsed_seconds: elapsed });
});

// ============================================================
// GALLERY
// ============================================================
router.get('/generations', async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 30);
  const { data, error } = await supabase
    .from('video_studio_generations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.delete('/generations/:id', async (req, res) => {
  const { data: gen } = await supabase
    .from('video_studio_generations')
    .select('video_url')
    .eq('id', req.params.id)
    .maybeSingle();

  if (gen?.video_url) {
    const m = String(gen.video_url).match(/\/generated-videos\/(.+)$/);
    if (m) {
      await supabase.storage.from(OUTPUT_BUCKET).remove([m[1]]).catch(() => {});
    }
  }
  const { error } = await supabase
    .from('video_studio_generations')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
