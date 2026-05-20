const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

const KEY_ID = process.env.HIGGSFIELD_KEY_ID;
const KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
const BASE_URL = process.env.HIGGSFIELD_BASE_URL || 'https://platform.higgsfield.ai';
const MODEL_ID = process.env.HIGGSFIELD_MODEL_ID || 'higgsfield-ai/soul/v2/standard';
const GENERATED_BUCKET = 'generated-images';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// HTTP CLIENT — uses hf-api-key + hf-secret headers (NOT Authorization)
// ============================================================
function authHeaders() {
  if (!KEY_ID || !KEY_SECRET) {
    throw new Error('Higgsfield is not configured — set HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET on Render');
  }
  return {
    'hf-api-key': KEY_ID,
    'hf-secret': KEY_SECRET,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function hfFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: { ...authHeaders(), ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

function extractErrorMessage(body, status) {
  if (typeof body?.error === 'string') return body.error;
  if (typeof body?.message === 'string') return body.message;
  if (typeof body?.detail === 'string') return body.detail;
  if (Array.isArray(body?.detail)) {
    return body.detail.map((d) => {
      const loc = Array.isArray(d.loc) ? d.loc.join('.') : '';
      return `${loc}: ${d.msg || JSON.stringify(d)}`;
    }).join('; ');
  }
  if (body) return JSON.stringify(body).slice(0, 500);
  return `HTTP ${status}`;
}

// ============================================================
// HELPERS
// ============================================================
async function mirrorImageToStorage(remoteUrl, generationId, index) {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Could not download from Higgsfield (${res.status})`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const buf = Buffer.from(await res.arrayBuffer());

  const path = `generations/${generationId}/${index}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(GENERATED_BUCKET)
    .upload(path, buf, { contentType, cacheControl: '604800', upsert: true });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(GENERATED_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Could not generate public URL');
  return pub.publicUrl;
}

// Poll the documented status endpoint: GET /requests/{request_id}/status
async function pollRequest(requestId, statusUrl, { maxMs = 5 * 60 * 1000, intervalMs = 2000 } = {}) {
  const started = Date.now();
  // Prefer the status_url Higgsfield gave us, fall back to constructed path
  const path = statusUrl
    ? statusUrl.replace(BASE_URL, '')
    : `/requests/${requestId}/status`;

  while (Date.now() - started < maxMs) {
    const { ok, status, body } = await hfFetch(path);
    if (ok && body) {
      const s = String(body.status || '').toLowerCase();
      if (['completed', 'failed', 'nsfw', 'cancelled', 'canceled'].includes(s)) {
        return body;
      }
    } else if (Date.now() - started > 10_000) {
      throw new Error(`Status polling failed: HTTP ${status}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Generation timed out after ${maxMs / 1000}s`);
}

// ============================================================
// STATUS
// ============================================================
router.get('/status', (req, res) => {
  res.json({
    configured: !!(KEY_ID && KEY_SECRET),
    base_url: BASE_URL,
    model_id: MODEL_ID,
    endpoint: `POST ${BASE_URL}/${MODEL_ID}`,
    note: 'Characters are managed manually in our DB. Use the + Add character button to register a Soul ID.',
  });
});

// ============================================================
// CHARACTERS — local DB registry
// ============================================================
router.get('/characters', async (req, res) => {
  const includeArchived = req.query.archived === 'true';
  let query = supabase.from('characters').select('*').order('created_at', { ascending: false });
  if (!includeArchived) query = query.eq('is_archived', false);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const characters = (data || []).map((c) => ({
    id: c.soul_id,
    internal_id: c.id,
    name: c.name,
    thumbnail_url: c.thumbnail_url,
    notes: c.notes,
    is_archived: c.is_archived,
    created_at: c.created_at,
  }));
  res.json({ characters });
});

router.post('/characters', async (req, res) => {
  const { soul_id, name, thumbnail_url, notes } = req.body || {};
  if (!soul_id?.trim()) return res.status(400).json({ error: 'soul_id is required' });
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  const cleanSoulId = soul_id.trim().toLowerCase();
  if (!UUID_REGEX.test(cleanSoulId)) {
    return res.status(400).json({
      error: 'soul_id must be a UUID (looks like "abc12345-67de-..."). Find it in your Higgsfield character URL.',
    });
  }

  const { data, error } = await supabase
    .from('characters')
    .insert({
      soul_id: cleanSoulId,
      name: name.trim(),
      thumbnail_url: thumbnail_url?.trim() || null,
      notes: notes?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'This Soul ID is already registered' });
    return res.status(500).json({ error: error.message });
  }

  res.json({
    id: data.soul_id,
    internal_id: data.id,
    name: data.name,
    thumbnail_url: data.thumbnail_url,
    notes: data.notes,
    is_archived: data.is_archived,
  });
});

router.patch('/characters/:internal_id', async (req, res) => {
  const { name, thumbnail_url, notes, is_archived } = req.body || {};
  const update = { updated_at: new Date().toISOString() };
  if (name !== undefined) update.name = name?.trim() || null;
  if (thumbnail_url !== undefined) update.thumbnail_url = thumbnail_url?.trim() || null;
  if (notes !== undefined) update.notes = notes?.trim() || null;
  if (is_archived !== undefined) update.is_archived = !!is_archived;

  const { data, error } = await supabase
    .from('characters')
    .update(update)
    .eq('id', req.params.internal_id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Character not found' });
  res.json({
    id: data.soul_id,
    internal_id: data.id,
    name: data.name,
    thumbnail_url: data.thumbnail_url,
    notes: data.notes,
    is_archived: data.is_archived,
  });
});

router.delete('/characters/:internal_id', async (req, res) => {
  const { error } = await supabase.from('characters').delete().eq('id', req.params.internal_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ============================================================
// HIGGSFIELD-NATIVE CHARACTERS (Soul IDs)
// These talk directly to Higgsfield's /v1/custom-references endpoints
// ============================================================

// GET /api/higgsfield/api-characters — list Soul IDs trained via Higgsfield API
router.get('/api-characters', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = Math.min(100, parseInt(req.query.page_size, 10) || 50);
    const { ok, status, body } = await hfFetch(`/v1/custom-references/list?page=${page}&page_size=${pageSize}`);
    if (!ok) {
      return res.status(status || 502).json({
        error: extractErrorMessage(body, status),
        details: body,
      });
    }
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/higgsfield/api-characters/:id — get a single Soul ID status
router.get('/api-characters/:id', async (req, res) => {
  try {
    const { ok, status, body } = await hfFetch(`/v1/custom-references/${req.params.id}`);
    if (!ok) {
      return res.status(status || 502).json({
        error: extractErrorMessage(body, status),
        details: body,
      });
    }
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/higgsfield/api-characters — train a new Soul ID via Higgsfield API
// Body: { name, image_urls: ["https://...", ...] }
router.post('/api-characters', async (req, res) => {
  const { name, image_urls } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!Array.isArray(image_urls) || image_urls.length === 0) {
    return res.status(400).json({ error: 'image_urls must be a non-empty array of URLs' });
  }
  if (image_urls.length > 100) {
    return res.status(400).json({ error: 'Higgsfield accepts max 100 input images' });
  }

  const input_images = image_urls.map((url) => ({ type: 'image_url', image_url: String(url) }));

  try {
    const { ok, status, body } = await hfFetch('/v1/custom-references', {
      method: 'POST',
      body: {
        name: name.trim().slice(0, 100),
        input_images,
        model_version: 'v2',
      },
    });
    if (!ok) {
      return res.status(status || 502).json({
        error: extractErrorMessage(body, status),
        details: body,
      });
    }
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/higgsfield/train-character
// Body: { name: string, image_urls: string[] }
// (The browser uploads photos directly to Supabase Storage first,
//  then sends only the URLs here.)
router.post('/train-character', async (req, res) => {
  const { name, image_urls } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!Array.isArray(image_urls) || image_urls.length === 0) {
    return res.status(400).json({ error: 'image_urls array is required' });
  }
  if (image_urls.length < 10) {
    return res.status(400).json({ error: `Need at least 10 photos for good training (you sent ${image_urls.length})` });
  }
  if (image_urls.length > 100) {
    return res.status(400).json({ error: 'Max 100 photos' });
  }
  if (!KEY_ID || !KEY_SECRET) {
    return res.status(503).json({ error: 'Higgsfield env vars not set' });
  }

  // Validate URLs
  for (let i = 0; i < image_urls.length; i++) {
    const url = image_urls[i];
    if (typeof url !== 'string' || !url.startsWith('http')) {
      return res.status(400).json({ error: `image_urls[${i}] must be a valid http(s) URL` });
    }
  }

  console.log(`[higgsfield] train-character: name="${name}", ${image_urls.length} pre-uploaded URLs`);

  // Submit to Higgsfield
  const input_images = image_urls.map((url) => ({ type: 'image_url', image_url: url }));
  const { ok, status, body } = await hfFetch('/v1/custom-references', {
    method: 'POST',
    body: {
      name: name.trim().slice(0, 100),
      input_images,
      model_version: 'v2',
    },
  });
  if (!ok) {
    return res.status(status || 502).json({
      error: extractErrorMessage(body, status),
      details: body,
    });
  }

  console.log(`[higgsfield] training submitted: id=${body.id}, status=${body.status}`);

  // Save to local registry so it appears in the grid immediately
  const { data: charRow, error: charErr } = await supabase
    .from('characters')
    .insert({
      soul_id: body.id,
      name: body.name || name.trim(),
      thumbnail_url: body.thumbnail_url || null,
      notes: `Training started ${new Date().toISOString().slice(0, 10)} — ${image_urls.length} photos`,
    })
    .select()
    .single();
  if (charErr) {
    console.warn('[higgsfield] could not save to local registry:', charErr.message);
  }

  res.json({
    soul_id: body.id,
    name: body.name,
    status: body.status,
    thumbnail_url: body.thumbnail_url,
    created_at: body.created_at,
    in_progress_at: body.in_progress_at,
    photos_uploaded: image_urls.length,
    local_character: charRow ? {
      internal_id: charRow.id,
      id: charRow.soul_id,
      name: charRow.name,
      thumbnail_url: charRow.thumbnail_url,
    } : null,
  });
});

router.get('/styles', (req, res) => {
  // Styles endpoint not used in v2/standard; UI does free-form prompting instead.
  res.json({ styles: [] });
});

// ============================================================
// GENERATE — Soul 2.0 with custom_reference_id
// ============================================================
//
// Endpoint:  POST https://platform.higgsfield.ai/higgsfield-ai/soul/v2/standard
// Body shape (flat, no params wrapper):
//   {
//     prompt: string,
//     batch_size: 1..4,
//     resolution: "720p" | "1080p",
//     aspect_ratio: "9:16" | "3:4" | "1:1" | "4:3" | "16:9" | etc.,
//     enhance_prompt: boolean,
//     custom_reference_id: UUID (the trained Soul ID)
//   }
//
// Response: { status: "queued", request_id, status_url, cancel_url }
// Then poll status_url until { status: "completed", images: [{url}] }
//
router.post('/generate', async (req, res) => {
  const {
    soul_id,
    soul_name,
    prompt,
    aspect_ratio = '9:16',
    resolution = '1080p',
    batch_size = 1,
    enhance_prompt = true,                  // UI default is true
    custom_reference_strength = 1.0,        // UI default is high
    style_id,                                // optional style preset
    seed,
  } = req.body || {};

  if (!soul_id) return res.status(400).json({ error: 'soul_id is required' });
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
  if (!KEY_ID || !KEY_SECRET) return res.status(503).json({ error: 'Higgsfield env vars not set' });

  const safeBatch = Math.max(1, Math.min(4, parseInt(batch_size, 10) || 1));
  const safeStrength = Math.max(0, Math.min(1, parseFloat(custom_reference_strength) || 1.0));

  const { data: gen, error: insertErr } = await supabase
    .from('higgsfield_generations')
    .insert({
      soul_id,
      soul_name: soul_name || null,
      style_id: style_id || null,
      prompt: prompt.trim(),
      quality: resolution,
      size: aspect_ratio,
      batch_size: safeBatch,
      custom_reference_strength: safeStrength,
      seed: seed ? parseInt(seed, 10) : null,
      status: 'pending',
    })
    .select()
    .single();
  if (insertErr) return res.status(500).json({ error: `DB error: ${insertErr.message}` });

  // Body sent to Higgsfield — now includes strength, style, enhance
  const reqBody = {
    prompt: prompt.trim(),
    batch_size: safeBatch,
    resolution,
    aspect_ratio,
    enhance_prompt: !!enhance_prompt,
    custom_reference_id: soul_id,
    custom_reference_strength: safeStrength,
  };
  if (style_id) reqBody.style_id = style_id;
  if (gen.seed !== null && gen.seed !== undefined) reqBody.seed = gen.seed;

  const startedAt = Date.now();

  // Submit to the correct endpoint: POST /{model_id}
  let submission;
  try {
    console.log(`[higgsfield] submit ${MODEL_ID}: soul=${soul_id}, aspect=${aspect_ratio}, res=${resolution}, batch=${safeBatch}`);
    const { ok, status, body } = await hfFetch(`/${MODEL_ID}`, { method: 'POST', body: reqBody });
    if (!ok) {
      const msg = extractErrorMessage(body, status);
      console.error(`[higgsfield] submit failed (${status}):`, msg);
      await supabase.from('higgsfield_generations')
        .update({ status: 'failed', error_message: msg, completed_at: new Date().toISOString() })
        .eq('id', gen.id);
      return res.status(status || 502).json({ error: msg, generation_id: gen.id, details: body });
    }
    submission = body;
    console.log('[higgsfield] queued:', submission?.request_id);
  } catch (err) {
    await supabase.from('higgsfield_generations')
      .update({ status: 'failed', error_message: err.message, completed_at: new Date().toISOString() })
      .eq('id', gen.id);
    return res.status(500).json({ error: err.message, generation_id: gen.id });
  }

  // Poll until done — use status_url Higgsfield gave us
  const requestId = submission?.request_id || submission?.id;
  const statusUrl = submission?.status_url;
  const submissionStatus = String(submission?.status || '').toLowerCase();

  let final = submission;
  if (submissionStatus !== 'completed' && requestId) {
    try {
      final = await pollRequest(requestId, statusUrl);
    } catch (err) {
      await supabase.from('higgsfield_generations')
        .update({ status: 'failed', error_message: err.message, higgsfield_request_id: requestId, completed_at: new Date().toISOString() })
        .eq('id', gen.id);
      return res.status(500).json({ error: err.message, generation_id: gen.id });
    }
  }

  const finalStatus = String(final?.status || '').toLowerCase();
  if (finalStatus !== 'completed') {
    const failure = finalStatus === 'nsfw' ? 'nsfw' : 'failed';
    const errMsg = finalStatus === 'nsfw'
      ? 'Content was rejected by Higgsfield as NSFW'
      : `Generation did not complete (status: ${finalStatus || 'unknown'})`;
    await supabase.from('higgsfield_generations')
      .update({ status: failure, error_message: errMsg, higgsfield_request_id: requestId, completed_at: new Date().toISOString() })
      .eq('id', gen.id);
    return res.status(500).json({ error: errMsg, generation_id: gen.id, raw: final });
  }

  // Extract images: docs show { images: [{ url: "..." }] }
  const originalUrls = [];
  if (Array.isArray(final?.images)) {
    for (const img of final.images) if (img?.url) originalUrls.push(img.url);
  }
  if (originalUrls.length === 0 && final?.url) originalUrls.push(final.url);

  if (originalUrls.length === 0) {
    await supabase.from('higgsfield_generations')
      .update({ status: 'failed', error_message: 'No output URLs returned', higgsfield_request_id: requestId, completed_at: new Date().toISOString() })
      .eq('id', gen.id);
    return res.status(500).json({ error: 'Higgsfield returned no images', generation_id: gen.id, raw: final });
  }

  // Mirror to Supabase Storage
  let storedUrls;
  try {
    storedUrls = await Promise.all(originalUrls.map((url, i) => mirrorImageToStorage(url, gen.id, i)));
  } catch (err) {
    console.error('[higgsfield] mirror failed:', err.message);
    storedUrls = originalUrls;
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  const { data: updated } = await supabase
    .from('higgsfield_generations')
    .update({
      status: 'completed',
      image_urls: storedUrls,
      original_higgsfield_urls: originalUrls,
      higgsfield_request_id: requestId,
      elapsed_seconds: elapsed,
      completed_at: new Date().toISOString(),
    })
    .eq('id', gen.id)
    .select()
    .single();

  res.json(updated || { ...gen, image_urls: storedUrls, status: 'completed', elapsed_seconds: elapsed });
});

// ============================================================
// GALLERY
// ============================================================
router.get('/generations', async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 30);
  const soul_id = req.query.soul_id;
  let query = supabase
    .from('higgsfield_generations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (soul_id) query = query.eq('soul_id', soul_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.delete('/generations/:id', async (req, res) => {
  const { data: gen } = await supabase
    .from('higgsfield_generations')
    .select('image_urls')
    .eq('id', req.params.id)
    .maybeSingle();
  if (gen?.image_urls?.length) {
    const paths = gen.image_urls
      .map((url) => {
        const m = String(url).match(/\/generated-images\/(.+)$/);
        return m ? m[1] : null;
      })
      .filter(Boolean);
    if (paths.length) await supabase.storage.from(GENERATED_BUCKET).remove(paths).catch(() => {});
  }
  const { error } = await supabase
    .from('higgsfield_generations')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
