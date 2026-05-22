const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// ============================================================
// CONFIG
// ============================================================
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_BASE = 'https://api.replicate.com/v1';
const LLM_MODEL = 'openai/gpt-5-mini';
const IMAGE_MODEL = 'bytedance/seedream-4.5';
const MAX_PROMPT_CHARS = 1999;     // Replicate silently truncates at 2000 — stay just under
const GENERATED_BUCKET = 'generated-images';

const VALID_ASPECT_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9', 'match_input_image'];
const VALID_SIZES = ['1K', '2K', '4K', 'custom'];

// ============================================================
// REPLICATE HELPERS
// ============================================================
function replicateHeaders() {
  if (!REPLICATE_TOKEN) throw new Error('REPLICATE_API_TOKEN is not set on the server');
  return {
    Authorization: `Bearer ${REPLICATE_TOKEN}`,
    'Content-Type': 'application/json',
    Prefer: 'wait=60',  // wait synchronously up to 60s, otherwise we poll
  };
}

// POST /v1/models/{owner}/{name}/predictions
// We use the "model" endpoint (not version) so we always get the latest.
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

  if (!res.ok) {
    throw new Error(extractErr(body, res.status));
  }

  // If Replicate returns "starting" or "processing", poll the prediction URL
  if (body.status === 'starting' || body.status === 'processing') {
    return pollPrediction(body.urls?.get || `${REPLICATE_BASE}/predictions/${body.id}`);
  }
  return body;
}

async function pollPrediction(getUrl, maxMs = 5 * 60 * 1000, intervalMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await fetch(getUrl, { headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` } });
    const body = await res.json();
    if (['succeeded', 'failed', 'canceled'].includes(body.status)) return body;
  }
  throw new Error(`Replicate prediction timed out after ${maxMs / 1000}s`);
}

function extractErr(body, status) {
  if (typeof body?.detail === 'string') return body.detail;
  if (typeof body?.error === 'string') return body.error;
  if (typeof body?.title === 'string') return `${body.title}: ${body.detail || ''}`;
  return `HTTP ${status}`;
}

// ============================================================
// LLM PROMPT MERGER
// Takes the character's full base prompt + user variation hint
// and produces a single coherent Seedream prompt ≤ MAX_PROMPT_CHARS.
// ============================================================
async function mergePrompt({ basePrompt, hint }) {
  const userHintTrim = (hint || '').trim();

  // If no hint, just use base prompt (still capped to be safe)
  if (!userHintTrim) {
    return basePrompt.slice(0, MAX_PROMPT_CHARS);
  }

  // Skip LLM if base prompt + tiny hint will fit raw — saves a call
  // (Actually we always want LLM-merge for coherence. Comment kept for future.)

  const systemPrompt =
    `You rewrite image-generation prompts for ByteDance Seedream 4.5. ` +
    `You will receive a BASE PROMPT (the user's detailed character/style directive) and a VARIATION HINT ` +
    `(a short scene/outfit/mood change the user wants for this specific generation). ` +
    `Your job: produce ONE merged prompt that preserves every important rule from the BASE PROMPT ` +
    `and weaves in the VARIATION HINT naturally. Critical rules:\n` +
    `- Output ONLY the final prompt text, no preamble or explanation.\n` +
    `- The output MUST be ≤ ${MAX_PROMPT_CHARS} characters total.\n` +
    `- Preserve every "must / must not / IMPORTANT / CRITICAL" rule from the base prompt.\n` +
    `- Replace the relevant sections of the base prompt to match the variation hint.\n` +
    `- Do NOT add new restrictions the user didn't ask for.\n` +
    `- Keep the same descriptive tone and language as the base prompt.`;

  const userMsg =
    `BASE PROMPT:\n${basePrompt}\n\n` +
    `VARIATION HINT:\n${userHintTrim}\n\n` +
    `Output the merged prompt now (≤ ${MAX_PROMPT_CHARS} characters):`;

  let merged;
  try {
    const result = await runReplicate(LLM_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
    });
    // gpt-5-mini on Replicate returns output as string OR string[]
    const out = result?.output;
    merged = Array.isArray(out) ? out.join('') : String(out || '');
    merged = merged.trim();
    if (!merged) throw new Error('Empty LLM output');
  } catch (err) {
    console.warn('[studio] LLM merge failed, falling back to manual append:', err.message);
    // Fallback: simple append. Truncate base if needed to leave room.
    const room = MAX_PROMPT_CHARS - userHintTrim.length - 50;
    const safeBase = basePrompt.slice(0, Math.max(0, room));
    merged = `${safeBase}\n\nVariation for this generation: ${userHintTrim}`.slice(0, MAX_PROMPT_CHARS);
  }

  // Hard cap regardless of what LLM returned
  if (merged.length > MAX_PROMPT_CHARS) merged = merged.slice(0, MAX_PROMPT_CHARS);
  return merged;
}

// ============================================================
// IMAGE STORAGE — mirror Replicate output to our Supabase bucket
// ============================================================
async function mirrorImageToStorage(remoteUrl, generationId, index) {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Could not download Replicate output (HTTP ${res.status})`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const buf = Buffer.from(await res.arrayBuffer());
  const path = `studio-generations/${generationId}/${index}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(GENERATED_BUCKET)
    .upload(path, buf, { contentType, cacheControl: '604800', upsert: true });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(GENERATED_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Could not get public URL');
  return pub.publicUrl;
}

// ============================================================
// STATUS
// ============================================================
router.get('/status', (req, res) => {
  res.json({
    configured: !!REPLICATE_TOKEN,
    image_model: IMAGE_MODEL,
    llm_model: LLM_MODEL,
    max_prompt_chars: MAX_PROMPT_CHARS,
  });
});

// ============================================================
// CHARACTERS
// ============================================================
router.get('/characters', async (req, res) => {
  const includeArchived = req.query.archived === 'true';
  let q = supabase.from('studio_characters').select('*').order('created_at', { ascending: false });
  if (!includeArchived) q = q.eq('is_archived', false);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ characters: data || [] });
});

router.get('/characters/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('studio_characters').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

router.post('/characters', async (req, res) => {
  const {
    name,
    base_prompt,
    reference_image_urls = [],
    cover_image_url,
    notes,
    default_aspect_ratio = '9:16',
    default_size = '2K',
  } = req.body || {};

  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!base_prompt?.trim()) return res.status(400).json({ error: 'base_prompt is required' });
  if (!Array.isArray(reference_image_urls) || reference_image_urls.length < 3) {
    return res.status(400).json({ error: 'Need at least 3 reference images' });
  }
  if (reference_image_urls.length > 14) {
    return res.status(400).json({ error: 'Maximum 14 reference images' });
  }
  for (const url of reference_image_urls) {
    if (typeof url !== 'string' || !url.startsWith('http')) {
      return res.status(400).json({ error: 'All reference_image_urls must be valid http(s) URLs' });
    }
  }
  if (!VALID_ASPECT_RATIOS.includes(default_aspect_ratio)) {
    return res.status(400).json({ error: `default_aspect_ratio must be one of ${VALID_ASPECT_RATIOS.join(', ')}` });
  }
  if (!VALID_SIZES.includes(default_size)) {
    return res.status(400).json({ error: `default_size must be one of ${VALID_SIZES.join(', ')}` });
  }

  const { data, error } = await supabase
    .from('studio_characters')
    .insert({
      name: name.trim().slice(0, 100),
      base_prompt: base_prompt.trim(),
      reference_image_urls,
      cover_image_url: cover_image_url || reference_image_urls[0] || null,
      notes: notes?.trim() || null,
      default_aspect_ratio,
      default_size,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/characters/:id', async (req, res) => {
  const allowed = ['name', 'base_prompt', 'reference_image_urls', 'cover_image_url', 'notes',
                   'default_aspect_ratio', 'default_size', 'is_archived'];
  const update = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in req.body) update[key] = req.body[key];
  }

  if (update.reference_image_urls) {
    if (!Array.isArray(update.reference_image_urls) ||
        update.reference_image_urls.length < 3 ||
        update.reference_image_urls.length > 14) {
      return res.status(400).json({ error: 'reference_image_urls must be array of 3-14 URLs' });
    }
  }

  const { data, error } = await supabase
    .from('studio_characters').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Character not found' });
  res.json(data);
});

router.delete('/characters/:id', async (req, res) => {
  const { error } = await supabase.from('studio_characters').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ============================================================
// PROMPT PREVIEW — lets the UI show the merged prompt before
// committing to a generation
// ============================================================
router.post('/preview-prompt', async (req, res) => {
  const { character_id, variation_hint } = req.body || {};
  if (!character_id) return res.status(400).json({ error: 'character_id is required' });
  const { data: char, error: charErr } = await supabase
    .from('studio_characters').select('base_prompt,name').eq('id', character_id).single();
  if (charErr || !char) return res.status(404).json({ error: 'Character not found' });
  try {
    const merged = await mergePrompt({ basePrompt: char.base_prompt, hint: variation_hint });
    res.json({
      character_name: char.name,
      variation_hint: variation_hint || '',
      final_prompt: merged,
      length: merged.length,
      will_be_truncated: merged.length > MAX_PROMPT_CHARS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GENERATE — the main event
// 1. Load character (gets base_prompt + reference URLs)
// 2. Merge prompt via LLM
// 3. Call Seedream with merged prompt + references
// 4. Mirror output(s) to Supabase
// 5. Save generation row + return it
// ============================================================
router.post('/generate', async (req, res) => {
  const {
    character_id,
    variation_hint,
    aspect_ratio,
    size,
    batch_size = 1,
    seed,
  } = req.body || {};

  if (!character_id) return res.status(400).json({ error: 'character_id is required' });
  if (!REPLICATE_TOKEN) return res.status(503).json({ error: 'REPLICATE_API_TOKEN not set on server' });

  const safeBatch = Math.max(1, Math.min(4, parseInt(batch_size, 10) || 1));

  // Load character
  const { data: char, error: charErr } = await supabase
    .from('studio_characters').select('*').eq('id', character_id).single();
  if (charErr || !char) return res.status(404).json({ error: 'Character not found' });

  const refs = char.reference_image_urls || [];
  if (refs.length < 3) {
    return res.status(400).json({ error: 'Character has fewer than 3 reference images' });
  }

  const finalAspectRatio = aspect_ratio || char.default_aspect_ratio || '9:16';
  const finalSize = size || char.default_size || '2K';
  if (!VALID_ASPECT_RATIOS.includes(finalAspectRatio)) {
    return res.status(400).json({ error: `Invalid aspect_ratio: ${finalAspectRatio}` });
  }
  if (!VALID_SIZES.includes(finalSize)) {
    return res.status(400).json({ error: `Invalid size: ${finalSize}` });
  }

  // Merge prompt
  let finalPrompt;
  try {
    finalPrompt = await mergePrompt({ basePrompt: char.base_prompt, hint: variation_hint });
  } catch (err) {
    return res.status(500).json({ error: `Prompt merge failed: ${err.message}` });
  }

  // Pre-create the generation row so we have an ID for storage paths
  const { data: gen, error: insertErr } = await supabase
    .from('studio_generations')
    .insert({
      character_id: char.id,
      character_name: char.name,
      variation_hint: variation_hint || null,
      final_prompt: finalPrompt,
      aspect_ratio: finalAspectRatio,
      size: finalSize,
      batch_size: safeBatch,
      seed: seed ? parseInt(seed, 10) : null,
      status: 'pending',
    })
    .select()
    .single();
  if (insertErr) return res.status(500).json({ error: `DB error: ${insertErr.message}` });

  const startedAt = Date.now();
  console.log(`[studio] generating: char=${char.name}, refs=${refs.length}, batch=${safeBatch}, aspect=${finalAspectRatio}, size=${finalSize}`);

  // Build Seedream input — matches the working example
  const seedreamInput = {
    prompt: finalPrompt,
    image_input: refs,
    aspect_ratio: finalAspectRatio,
    size: finalSize,
    max_images: safeBatch,
    sequential_image_generation: 'disabled',
  };
  if (gen.seed !== null && gen.seed !== undefined) seedreamInput.seed = gen.seed;

  // Call Seedream
  let prediction;
  try {
    prediction = await runReplicate(IMAGE_MODEL, seedreamInput);
  } catch (err) {
    console.error('[studio] seedream call failed:', err.message);
    const isNsfw = /nsfw|safety|content/i.test(err.message);
    await supabase.from('studio_generations')
      .update({
        status: isNsfw ? 'nsfw' : 'failed',
        error_message: err.message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', gen.id);
    return res.status(500).json({ error: err.message, generation_id: gen.id });
  }

  // Extract output URLs
  let outputUrls = [];
  if (Array.isArray(prediction?.output)) {
    outputUrls = prediction.output.filter((u) => typeof u === 'string' && u.startsWith('http'));
  } else if (typeof prediction?.output === 'string') {
    outputUrls = [prediction.output];
  }

  if (prediction?.status !== 'succeeded' || outputUrls.length === 0) {
    const errMsg = prediction?.error ||
                   (prediction?.status === 'failed' ? 'Seedream prediction failed' :
                   'Seedream returned no images');
    const isNsfw = /nsfw|safety|content/i.test(String(errMsg));
    await supabase.from('studio_generations')
      .update({
        status: isNsfw ? 'nsfw' : 'failed',
        error_message: errMsg,
        replicate_prediction_id: prediction?.id || null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', gen.id);
    return res.status(500).json({ error: errMsg, generation_id: gen.id, raw: prediction });
  }

  // Mirror outputs to Supabase Storage
  let mirroredUrls;
  try {
    mirroredUrls = await Promise.all(outputUrls.map((u, i) => mirrorImageToStorage(u, gen.id, i)));
  } catch (err) {
    console.warn('[studio] mirror failed, using original Replicate URLs:', err.message);
    mirroredUrls = outputUrls;
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  const { data: updated } = await supabase
    .from('studio_generations')
    .update({
      status: 'completed',
      image_urls: mirroredUrls,
      original_replicate_urls: outputUrls,
      replicate_prediction_id: prediction.id,
      elapsed_seconds: elapsed,
      completed_at: new Date().toISOString(),
    })
    .eq('id', gen.id)
    .select()
    .single();

  res.json(updated || { ...gen, image_urls: mirroredUrls, status: 'completed' });
});

// ============================================================
// GALLERY
// ============================================================
router.get('/generations', async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 30);
  const character_id = req.query.character_id;
  let q = supabase.from('studio_generations').select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (character_id) q = q.eq('character_id', character_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.delete('/generations/:id', async (req, res) => {
  const { data: gen } = await supabase
    .from('studio_generations')
    .select('image_urls,cleaned_image_urls')
    .eq('id', req.params.id)
    .maybeSingle();
  if (gen) {
    const all = [...(gen.image_urls || []), ...(gen.cleaned_image_urls || [])];
    const paths = all
      .map((url) => {
        const m = String(url).match(/\/generated-images\/(.+)$/);
        return m ? m[1] : null;
      })
      .filter(Boolean);
    if (paths.length) await supabase.storage.from(GENERATED_BUCKET).remove(paths).catch(() => {});
  }
  const { error } = await supabase.from('studio_generations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ============================================================
// CLEAN — reuses the Modal noai-watermark pipeline (same as Characters)
// ============================================================
router.post('/generations/:id/clean', async (req, res) => {
  const { strength = 0.04, steps = 50 } = req.body || {};
  const MODAL_ENDPOINT_URL = process.env.MODAL_ENDPOINT_URL;
  if (!MODAL_ENDPOINT_URL) {
    return res.status(503).json({ error: 'Image cleaning not configured (MODAL_ENDPOINT_URL missing)' });
  }

  const { data: gen, error: loadErr } = await supabase
    .from('studio_generations').select('*').eq('id', req.params.id).single();
  if (loadErr || !gen) return res.status(404).json({ error: 'Generation not found' });

  const urls = gen.image_urls || [];
  if (urls.length === 0) return res.status(400).json({ error: 'No images on this generation' });

  console.log(`[studio] cleaning ${urls.length} image(s) for gen=${gen.id}`);
  const startedAt = Date.now();

  const cleanedUrls = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const imgRes = await fetch(url);
      if (!imgRes.ok) throw new Error(`Could not fetch original (${imgRes.status})`);
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const b64In = buf.toString('base64');

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5 * 60 * 1000);
      let modalRes;
      try {
        modalRes = await fetch(MODAL_ENDPOINT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_b64: b64In,
            strength: Math.max(0, Math.min(1, Number(strength) || 0.04)),
            steps: Math.max(10, Math.min(100, parseInt(steps, 10) || 50)),
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(t);
      }
      if (!modalRes.ok) {
        const body = await modalRes.text().catch(() => '');
        throw new Error(`Modal returned ${modalRes.status}: ${body.slice(0, 200)}`);
      }
      const modalBody = await modalRes.json();
      const cleanedB64 = modalBody?.cleaned_b64;
      if (!cleanedB64) throw new Error('Modal returned no cleaned image');

      const cleanedBuf = Buffer.from(cleanedB64, 'base64');
      const ext = contentType.includes('png') ? 'png' : 'jpg';
      const path = `studio-generations/${gen.id}/cleaned-${i}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(GENERATED_BUCKET)
        .upload(path, cleanedBuf, { contentType, cacheControl: '604800', upsert: true });
      if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

      const { data: pub } = supabase.storage.from(GENERATED_BUCKET).getPublicUrl(path);
      if (!pub?.publicUrl) throw new Error('Could not get public URL');
      cleanedUrls.push(pub.publicUrl);
    } catch (err) {
      return res.status(500).json({
        error: `Cleaning failed on image ${i + 1}: ${err.message}`,
        partial_cleaned_urls: cleanedUrls,
      });
    }
  }

  const { data: updated, error: updateErr } = await supabase
    .from('studio_generations')
    .update({ cleaned_image_urls: cleanedUrls })
    .eq('id', gen.id)
    .select()
    .single();
  if (updateErr) {
    return res.status(500).json({ error: `DB update failed: ${updateErr.message}`, cleaned_image_urls: cleanedUrls });
  }
  console.log(`[studio] cleaned ${urls.length} image(s) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  res.json(updated);
});

module.exports = router;
