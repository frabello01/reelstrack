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
const IMAGE_MODEL = 'openai/gpt-image-2';      // Step 1 — starting-image generator
const LLM_MODEL   = 'openai/gpt-5-mini';        // shared prompt rewriter
const OUTPUT_BUCKET = 'generated-videos';
const IMAGE_BUCKET  = 'generated-images';       // reused from AI Selfie Studio

const VALID_ASPECT_RATIOS = ['auto', '16:9', '4:3', '1:1', '9:16', '3:4', '3:2', '2:3'];
const VALID_RESOLUTIONS = ['720p', '480p'];
// gpt-image-2 only supports 1:1, 3:2, 2:3
const VALID_STEP1_ASPECTS = ['1:1', '3:2', '2:3'];
const VALID_STEP1_QUALITIES = ['low', 'medium', 'high', 'auto'];
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
// MIRROR — pull an IMAGE from Replicate's CDN and re-host in our
// Supabase bucket. Same pattern as mirrorVideoToStorage but for
// the Step 1 generator (gpt-image-2 outputs jpg/png/webp).
// ============================================================
async function mirrorImageToStorage(remoteUrl, startingImageId) {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Could not download Replicate image (HTTP ${res.status})`);
  const contentType = res.headers.get('content-type') || 'image/webp';
  const ext = contentType.includes('png') ? 'png'
            : contentType.includes('webp') ? 'webp'
            : contentType.includes('jpeg') ? 'jpg' : 'jpg';
  const buf = Buffer.from(await res.arrayBuffer());
  const path = `video-studio-step1/${startingImageId}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, buf, { contentType, cacheControl: '604800', upsert: true });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);
  const { data: pub } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Could not get public URL');
  return pub.publicUrl;
}

// ============================================================
// PROMPT REWRITERS — run user's script through gpt-5-mini with a
// system prompt tailored to the downstream model.
//
// Two flavors:
//   - rewriteForImageGen        → optimized for gpt-image-2 (Step 1)
//                                 produces a photographic-style prompt
//                                 describing scene, framing, lighting,
//                                 subject pose, wardrobe.
//   - rewriteForImageToVideo    → optimized for xAI Grok Imagine (Step 2)
//                                 the input image is the FROM frame, so
//                                 the prompt should describe MOTION:
//                                 camera move, subject action, mood
//                                 progression, lighting change.
//
// Both fail-soft: on any error they return the original script so the
// pipeline never breaks on a rewriter outage.
// ============================================================
async function llmRewrite({ systemPrompt, userScript, label }) {
  const trimmed = (userScript || '').trim();
  if (!trimmed) return trimmed;
  try {
    const result = await runReplicate(LLM_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: trimmed },
      ],
    });
    const out = result?.output;
    const merged = (Array.isArray(out) ? out.join('') : String(out || '')).trim();
    if (!merged) throw new Error('Empty LLM output');
    return merged.length > MAX_PROMPT_CHARS ? merged.slice(0, MAX_PROMPT_CHARS) : merged;
  } catch (err) {
    console.warn(`[video-studio] ${label} rewrite failed, using raw script:`, err.message);
    return trimmed.slice(0, MAX_PROMPT_CHARS);
  }
}

const SYS_IMAGE_GEN =
  `You rewrite user scripts into prompts for OpenAI's gpt-image-2 model. ` +
  `The user supplies a short scene/script. Reference photos of the SAME ` +
  `subject (the creator) will be passed alongside — your prompt MUST preserve ` +
  `that subject's identity (face, body, hair). Your job: produce ONE photographic ` +
  `prompt describing this specific scene. Critical rules:\n` +
  `- Output ONLY the final prompt text. No preamble, no explanation.\n` +
  `- Write in present tense, descriptive, as if directing a photographer.\n` +
  `- Cover: setting, lighting, subject pose & expression, wardrobe (if mentioned), camera angle, mood.\n` +
  `- DO NOT redescribe the subject's face/identity — the reference images carry that.\n` +
  `- Photorealistic and natural; avoid AI-art tropes ("masterpiece", "8k", "trending on ArtStation").\n` +
  `- Keep it under 600 characters.`;

const SYS_IMAGE_TO_VIDEO =
  `You rewrite user scripts into prompts for xAI Grok Imagine Video (image-to-video). ` +
  `The user has selected a STARTING IMAGE — it's the first frame. Your job is to ` +
  `ADD cinematographic direction to the user's script, NOT to paraphrase or abstract ` +
  `it away. Critical rules:\n` +
  `\n` +
  `- Output ONLY the final prompt text. No preamble, no explanation.\n` +
  `\n` +
  `- PRESERVE THE USER'S FACTUAL CONTENT VERBATIM. This is the most important rule. ` +
  `Any direct quote / dialogue MUST appear in the output WITH THE EXACT WORDS AND ` +
  `THE ORIGINAL LANGUAGE the user wrote (do NOT translate Italian quotes into ` +
  `English, do NOT replace the line with "the Italian line" or any other ` +
  `paraphrase). Also keep verbatim: named actions ("prays", "kneels"), named ` +
  `locations ("in chiesa"), specific props, specific wardrobe, specific gestures. ` +
  `Your role is to ADD cinematic framing around the user's facts, not to replace ` +
  `them.\n` +
  `\n` +
  `- Grok Imagine produces SILENT video. Render dialogue as LIP MOVEMENT — phrase ` +
  `it as: \`her lips mouth the words "<exact original line in original language>"\`. ` +
  `Keep the quote untouched (same words, same language, same punctuation).\n` +
  `\n` +
  `- DO NOT redescribe the static scene already visible in the starting image ` +
  `(setting, wardrobe, lighting, framing). Mention the setting only if the user ` +
  `named it — and reuse the user's word for it.\n` +
  `\n` +
  `- HARD CONSTRAINT #1 — CAMERA: the camera is LOCKED OFF / completely static. ` +
  `No zoom, no pan, no tilt, no dolly, no push-in, no pull-out, no handheld sway, ` +
  `no orbit, no reframe, no crop change. Framing is identical to the starting image ` +
  `for the entire shot.\n` +
  `\n` +
  `- HARD CONSTRAINT #2 — NO ADDED VFX: do not introduce any element that is not ` +
  `already in the starting image. NO floating particles, NO sparks, NO dust motes, ` +
  `NO embers, NO bokeh balls, NO snow, NO rain, NO confetti, NO lens flares, ` +
  `NO light streaks, NO glitches, NO chromatic aberration, NO smoke or mist unless ` +
  `already visible in the starting frame. Color palette and lighting stay ` +
  `consistent with the starting image.\n` +
  `\n` +
  `- Cinematographic direction you ARE allowed to add: timing/beats of the user's ` +
  `actions (slowly, then, after a beat), subject's micro-motion accompanying the ` +
  `action (slight breath, soft blink, eyelashes flutter), mood color (warm/cool/calm/tense).\n` +
  `\n` +
  `- Keep the output under 600 characters. If you have to cut, cut your cinematic ` +
  `additions FIRST, never the user's verbatim content.`;

// Hard-product constraints that must reach xAI Grok regardless of whether the
// LLM rewriter ran (or even succeeded). We always want:
//   (1) camera fully static — no zoom/pan/tilt/dolly/reframe
//   (2) no added VFX — no particles/sparks/dust/lens-flares/smoke/snow/etc.
// Applied at the route layer after the rewrite-or-skip decision so it covers
// BOTH the LLM-rewritten path AND the skip_rewrite escape hatch.
const HARD_CONSTRAINTS_SUFFIX =
  ' Camera fully static (locked tripod): no zoom, no pan, no tilt, no dolly, no handheld movement, framing identical to the starting image. ' +
  'No added VFX: no floating particles, no sparks, no dust motes, no bokeh balls, no lens flares, no light streaks, no smoke, no mist, no snow, no rain, no glitches — keep visuals consistent with the starting image.';
const HARD_CONSTRAINTS_DETECT = /\b(no added VFX|no floating particles|no particles|no sparks|no lens flares|no glitches|no bokeh)\b/i;

function enforceHardConstraints(prompt) {
  if (!prompt) return prompt;
  if (HARD_CONSTRAINTS_DETECT.test(prompt)) return prompt;
  const out = (prompt.trimEnd() + HARD_CONSTRAINTS_SUFFIX).trim();
  return out.length > MAX_PROMPT_CHARS ? out.slice(0, MAX_PROMPT_CHARS) : out;
}

const rewriteForImageGen     = (script) => llmRewrite({ systemPrompt: SYS_IMAGE_GEN,      userScript: script, label: 'i2i' });
const rewriteForImageToVideo = (script) => llmRewrite({ systemPrompt: SYS_IMAGE_TO_VIDEO, userScript: script, label: 'i2v' });

// ============================================================
// STATUS
// ============================================================
router.get('/status', (req, res) => {
  res.json({
    configured: !!REPLICATE_TOKEN,
    model: VIDEO_MODEL,
    image_model: IMAGE_MODEL,
    llm_model: LLM_MODEL,
    aspect_ratios: VALID_ASPECT_RATIOS,
    resolutions: VALID_RESOLUTIONS,
    duration_range: [1, 15],
    step1_aspect_ratios: VALID_STEP1_ASPECTS,
    step1_qualities: VALID_STEP1_QUALITIES,
  });
});

// ============================================================
// STEP 1 — CREATORS CRUD
// (independent from studio_characters used by AI Selfie Studio)
// ============================================================
router.get('/creators', async (req, res) => {
  const { data, error } = await supabase
    .from('video_studio_creators')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ creators: data || [] });
});

router.post('/creators', async (req, res) => {
  const {
    name,
    reference_image_urls = [],
    default_aspect_ratio = '2:3',
    default_quality = 'high',
    notes,
  } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!Array.isArray(reference_image_urls) || reference_image_urls.length < 1) {
    return res.status(400).json({ error: 'At least 1 reference image is required' });
  }
  if (reference_image_urls.length > 16) {
    return res.status(400).json({ error: 'Maximum 16 reference images' });
  }
  for (const u of reference_image_urls) {
    if (typeof u !== 'string' || !u.startsWith('http')) {
      return res.status(400).json({ error: 'All reference_image_urls must be valid http(s) URLs' });
    }
  }
  if (!VALID_STEP1_ASPECTS.includes(default_aspect_ratio)) {
    return res.status(400).json({ error: `default_aspect_ratio must be one of ${VALID_STEP1_ASPECTS.join(', ')}` });
  }
  if (!VALID_STEP1_QUALITIES.includes(default_quality)) {
    return res.status(400).json({ error: `default_quality must be one of ${VALID_STEP1_QUALITIES.join(', ')}` });
  }
  const { data, error } = await supabase
    .from('video_studio_creators')
    .insert({
      name: name.trim().slice(0, 100),
      reference_image_urls,
      default_aspect_ratio,
      default_quality,
      notes: notes?.trim() || null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/creators/:id', async (req, res) => {
  const patch = {};
  const b = req.body || {};
  if (typeof b.name === 'string') patch.name = b.name.trim().slice(0, 100);
  if (Array.isArray(b.reference_image_urls)) {
    if (b.reference_image_urls.length < 1 || b.reference_image_urls.length > 16) {
      return res.status(400).json({ error: 'reference_image_urls must have 1..16 entries' });
    }
    for (const u of b.reference_image_urls) {
      if (typeof u !== 'string' || !u.startsWith('http')) {
        return res.status(400).json({ error: 'All reference_image_urls must be valid http(s) URLs' });
      }
    }
    patch.reference_image_urls = b.reference_image_urls;
  }
  if (typeof b.default_aspect_ratio === 'string') {
    if (!VALID_STEP1_ASPECTS.includes(b.default_aspect_ratio)) {
      return res.status(400).json({ error: `default_aspect_ratio must be one of ${VALID_STEP1_ASPECTS.join(', ')}` });
    }
    patch.default_aspect_ratio = b.default_aspect_ratio;
  }
  if (typeof b.default_quality === 'string') {
    if (!VALID_STEP1_QUALITIES.includes(b.default_quality)) {
      return res.status(400).json({ error: `default_quality must be one of ${VALID_STEP1_QUALITIES.join(', ')}` });
    }
    patch.default_quality = b.default_quality;
  }
  if (typeof b.notes === 'string' || b.notes === null) patch.notes = b.notes?.trim() || null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  const { data, error } = await supabase
    .from('video_studio_creators')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Creator not found' });
  res.json(data);
});

router.delete('/creators/:id', async (req, res) => {
  const { error } = await supabase
    .from('video_studio_creators')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ============================================================
// STEP 1 — GENERATE STARTING IMAGE (gpt-image-2)
// Body: { creator_id, script, aspect_ratio?, quality?, skip_rewrite? }
// ============================================================
router.post('/generate-starting-image', async (req, res) => {
  if (!REPLICATE_TOKEN) {
    return res.status(503).json({ error: 'REPLICATE_API_TOKEN is not set on the server' });
  }
  const { creator_id, script, aspect_ratio, quality, skip_rewrite } = req.body || {};
  if (!creator_id) return res.status(400).json({ error: 'creator_id is required' });
  if (!script?.trim()) return res.status(400).json({ error: 'script is required' });

  const { data: creator, error: cErr } = await supabase
    .from('video_studio_creators')
    .select('*')
    .eq('id', creator_id)
    .maybeSingle();
  if (cErr) return res.status(500).json({ error: cErr.message });
  if (!creator) return res.status(404).json({ error: 'Creator not found' });

  const refs = creator.reference_image_urls || [];
  if (refs.length < 1) return res.status(400).json({ error: 'Creator has no reference images' });

  const finalAspect = aspect_ratio || creator.default_aspect_ratio || '2:3';
  const finalQuality = quality || creator.default_quality || 'high';
  if (!VALID_STEP1_ASPECTS.includes(finalAspect)) {
    return res.status(400).json({ error: `aspect_ratio must be one of ${VALID_STEP1_ASPECTS.join(', ')}` });
  }
  if (!VALID_STEP1_QUALITIES.includes(finalQuality)) {
    return res.status(400).json({ error: `quality must be one of ${VALID_STEP1_QUALITIES.join(', ')}` });
  }

  const userScript = script.trim();
  const finalPrompt = skip_rewrite ? userScript : await rewriteForImageGen(userScript);

  // Pre-create the row so we have an ID for storage paths and can record
  // the failure if Replicate errors out.
  const { data: row, error: insErr } = await supabase
    .from('video_studio_starting_images')
    .insert({
      creator_id: creator.id,
      creator_name: creator.name,
      script: userScript,
      final_prompt: finalPrompt,
      aspect_ratio: finalAspect,
      quality: finalQuality,
      reference_image_urls: refs,
      status: 'pending',
    })
    .select()
    .single();
  if (insErr) return res.status(500).json({ error: `DB error: ${insErr.message}` });

  const startedAt = Date.now();
  console.log(`[video-studio] step1 id=${row.id} creator=${creator.name} refs=${refs.length} aspect=${finalAspect} quality=${finalQuality} rewrite=${!skip_rewrite}`);

  let prediction;
  try {
    prediction = await runReplicate(IMAGE_MODEL, {
      prompt: finalPrompt,
      input_images: refs,
      aspect_ratio: finalAspect,
      quality: finalQuality,
      number_of_images: 1,
      output_format: 'webp',
    });
  } catch (err) {
    console.error('[video-studio] gpt-image-2 call failed:', err.message);
    const isNsfw = /nsfw|safety|content[_ ]?policy|moderation/i.test(err.message);
    await supabase.from('video_studio_starting_images')
      .update({ status: isNsfw ? 'nsfw' : 'failed', error_message: err.message, completed_at: new Date().toISOString() })
      .eq('id', row.id);
    return res.status(500).json({ error: err.message, id: row.id });
  }

  let outputUrl = null;
  if (Array.isArray(prediction?.output)) {
    outputUrl = prediction.output.find((u) => typeof u === 'string' && u.startsWith('http'));
  } else if (typeof prediction?.output === 'string') {
    outputUrl = prediction.output;
  }
  if (prediction?.status !== 'succeeded' || !outputUrl) {
    const errMsg = prediction?.error || 'gpt-image-2 returned no image';
    const isNsfw = /nsfw|safety|content[_ ]?policy|moderation/i.test(String(errMsg));
    await supabase.from('video_studio_starting_images')
      .update({
        status: isNsfw ? 'nsfw' : 'failed',
        error_message: String(errMsg).slice(0, 1000),
        replicate_prediction_id: prediction?.id || null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    return res.status(500).json({ error: errMsg, id: row.id });
  }

  let mirroredUrl;
  try {
    mirroredUrl = await mirrorImageToStorage(outputUrl, row.id);
  } catch (err) {
    console.warn('[video-studio] step1 mirror failed, using replicate URL:', err.message);
    mirroredUrl = outputUrl;
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  const { data: updated } = await supabase
    .from('video_studio_starting_images')
    .update({
      status: 'completed',
      image_url: mirroredUrl,
      replicate_prediction_id: prediction.id,
      completed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .select()
    .single();

  console.log(`[video-studio] step1 done id=${row.id} in ${elapsed.toFixed(1)}s`);
  res.json(updated || { ...row, image_url: mirroredUrl, status: 'completed' });
});

// History list for Step 1
router.get('/starting-images', async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
  const creator_id = req.query.creator_id || null;
  let q = supabase
    .from('video_studio_starting_images')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (creator_id) q = q.eq('creator_id', creator_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.delete('/starting-images/:id', async (req, res) => {
  const { data: row } = await supabase
    .from('video_studio_starting_images')
    .select('image_url')
    .eq('id', req.params.id)
    .maybeSingle();
  if (row?.image_url) {
    const m = String(row.image_url).match(/\/generated-images\/(.+)$/);
    if (m) await supabase.storage.from(IMAGE_BUCKET).remove([m[1]]).catch(() => {});
  }
  const { error } = await supabase
    .from('video_studio_starting_images')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
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
    skip_rewrite,                  // power-user escape hatch
  } = req.body || {};

  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: `prompt must be ≤ ${MAX_PROMPT_CHARS} chars` });
  }

  // Run the user's script through gpt-5-mini with an image-to-video
  // system prompt so it focuses on subject motion/mood progression
  // instead of redescribing the static scene already in the start frame.
  // Fail-soft: if the rewriter errors we use the raw script.
  //
  // After the rewrite (or skip), we enforce TWO hard product constraints:
  //   (1) camera fully static — no zoom/pan/tilt/dolly/reframe
  //   (2) no added VFX — no particles/sparks/lens-flares/smoke/snow/etc.
  // Both guarantees hold even when skip_rewrite is on, and even when
  // the LLM forgets.
  const userScript = prompt.trim();
  const rewritten = skip_rewrite ? userScript : await rewriteForImageToVideo(userScript);
  const finalPrompt = enforceHardConstraints(rewritten);
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
  // We store BOTH the user's original script (prompt) and the rewritten
  // version (final_prompt) so the gallery shows what the user wrote, but
  // we can also debug what was actually sent to the model.
  const { data: gen, error: insertErr } = await supabase
    .from('video_studio_generations')
    .insert({
      prompt: userScript,
      final_prompt: finalPrompt,
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
    prompt: finalPrompt,
    duration: safeDuration,
    resolution,
    aspect_ratio,
  };
  if (image_url) input.image = image_url;

  console.log(`[video-studio] generate id=${gen.id} model=${VIDEO_MODEL} aspect=${aspect_ratio} res=${resolution} dur=${safeDuration} image=${!!image_url} rewrite=${!skip_rewrite}`);

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
