const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

const KEY_ID = process.env.HIGGSFIELD_KEY_ID;
const KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
const BASE_URL = process.env.HIGGSFIELD_BASE_URL || 'https://platform.higgsfield.ai';
const GENERATED_BUCKET = 'generated-images';

// UUID validation — Higgsfield Soul IDs are standard UUIDs
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// HTTP CLIENT
// ============================================================
function authHeaders() {
  if (!KEY_ID || !KEY_SECRET) {
    throw new Error('Higgsfield is not configured — set HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET on Render');
  }
  return {
    Authorization: `Key ${KEY_ID}:${KEY_SECRET}`,
    'User-Agent': 'higgsfield-server-js/2.0',
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

// Poll a request until terminal status (or timeout)
async function pollRequest(requestId, { maxMs = 5 * 60 * 1000, intervalMs = 2000 } = {}) {
  const started = Date.now();
  const statusPaths = [
    `/v1/requests/${requestId}/status`,
    `/requests/${requestId}/status`,
  ];

  while (Date.now() - started < maxMs) {
    let lastError = null;
    for (const path of statusPaths) {
      const { ok, status, body } = await hfFetch(path);
      if (ok && body) {
        const s = String(body.status || '').toLowerCase();
        if (['completed', 'failed', 'nsfw', 'cancelled', 'canceled'].includes(s)) {
          return body;
        }
        break;
      } else {
        lastError = `${path}: ${status}`;
      }
    }
    if (lastError && Date.now() - started > 10_000) {
      throw new Error(`Status polling failed: ${lastError}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Generation timed out after ${maxMs / 1000}s`);
}

// ============================================================
// STATUS — simple check, no probing
// ============================================================
router.get('/status', (req, res) => {
  res.json({
    configured: !!(KEY_ID && KEY_SECRET),
    base_url: BASE_URL,
    generation_endpoint: 'POST /v1/text2image/soul',
    note: 'Characters are managed manually in our DB. Use the + Add character button to register a Soul ID.',
  });
});

// ============================================================
// CHARACTERS — CRUD on our local registry
// ============================================================

// GET /api/higgsfield/characters — list registered characters
router.get('/characters', async (req, res) => {
  const includeArchived = req.query.archived === 'true';
  let query = supabase.from('characters').select('*').order('created_at', { ascending: false });
  if (!includeArchived) query = query.eq('is_archived', false);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  // Normalize for the frontend (id = soul_id, internal_id = row id)
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

// POST /api/higgsfield/characters — register a new character
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
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This Soul ID is already registered' });
    }
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

// PATCH /api/higgsfield/characters/:internal_id — update a character
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

// DELETE /api/higgsfield/characters/:internal_id
router.delete('/characters/:internal_id', async (req, res) => {
  const { error } = await supabase
    .from('characters')
    .delete()
    .eq('id', req.params.internal_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// GET /api/higgsfield/styles — stub, returns empty list (manual mode skips style auto-discovery)
router.get('/styles', (req, res) => {
  res.json({ styles: [] });
});

// ============================================================
// GENERATE — confirmed endpoint
// ============================================================
router.post('/generate', async (req, res) => {
  const {
    soul_id,
    soul_name,
    prompt,
    style_id,
    style_name,
    quality = 'high',
    size = '1536x2048',
    batch_size = 1,
    strength = 1.0,
    seed,
  } = req.body || {};

  if (!soul_id) return res.status(400).json({ error: 'soul_id is required' });
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
  if (!KEY_ID || !KEY_SECRET) return res.status(503).json({ error: 'Higgsfield env vars not set' });

  const safeBatch = Math.max(1, Math.min(4, parseInt(batch_size, 10) || 1));
  const safeStrength = Math.max(0, Math.min(1, parseFloat(strength) || 1.0));

  const { data: gen, error: insertErr } = await supabase
    .from('higgsfield_generations')
    .insert({
      soul_id,
      soul_name: soul_name || null,
      style_id: style_id || null,
      style_name: style_name || null,
      prompt: prompt.trim(),
      quality,
      size,
      batch_size: safeBatch,
      custom_reference_strength: safeStrength,
      seed: seed ? parseInt(seed, 10) : null,
      status: 'pending',
    })
    .select()
    .single();
  if (insertErr) return res.status(500).json({ error: `DB error: ${insertErr.message}` });

  const reqBody = {
    prompt: prompt.trim(),
    custom_reference_id: soul_id,
    custom_reference_strength: safeStrength,
    width_and_height: size,
    quality,
    batch_size: safeBatch,
  };
  if (style_id) reqBody.style_id = style_id;
  if (gen.seed !== null && gen.seed !== undefined) reqBody.seed = gen.seed;

  const startedAt = Date.now();

  let submission;
  try {
    console.log(`[higgsfield] submit: soul=${soul_id}, quality=${quality}, size=${size}, batch=${safeBatch}`);
    const { ok, status, body } = await hfFetch('/v1/text2image/soul', { method: 'POST', body: reqBody });
    if (!ok) {
      const msg = body?.error || body?.message || body?.detail || `HTTP ${status}`;
      await supabase.from('higgsfield_generations')
        .update({ status: 'failed', error_message: typeof msg === 'string' ? msg : JSON.stringify(msg), completed_at: new Date().toISOString() })
        .eq('id', gen.id);
      return res.status(status || 502).json({ error: msg, generation_id: gen.id, details: body });
    }
    submission = body;
  } catch (err) {
    await supabase.from('higgsfield_generations')
      .update({ status: 'failed', error_message: err.message, completed_at: new Date().toISOString() })
      .eq('id', gen.id);
    return res.status(500).json({ error: err.message, generation_id: gen.id });
  }

  let final = submission;
  const requestId = submission?.request_id || submission?.id;
  const submissionStatus = String(submission?.status || '').toLowerCase();

  if (submissionStatus !== 'completed' && requestId) {
    try {
      final = await pollRequest(requestId);
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

  // Extract image URLs
  const originalUrls = [];
  if (Array.isArray(final?.images)) {
    for (const img of final.images) if (img?.url) originalUrls.push(img.url);
  }
  if (Array.isArray(final?.results)) {
    for (const r of final.results) {
      const u = r?.raw?.url || r?.url;
      if (u) originalUrls.push(u);
    }
  }
  if (Array.isArray(final?.jobs)) {
    for (const j of final.jobs) {
      const u = j?.results?.raw?.url || j?.result?.url;
      if (u) originalUrls.push(u);
    }
  }
  if (originalUrls.length === 0 && final?.url) originalUrls.push(final.url);

  if (originalUrls.length === 0) {
    await supabase.from('higgsfield_generations')
      .update({ status: 'failed', error_message: 'No output URLs returned', higgsfield_request_id: requestId, completed_at: new Date().toISOString() })
      .eq('id', gen.id);
    return res.status(500).json({ error: 'Higgsfield returned no images', generation_id: gen.id, raw: final });
  }

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
// GENERATIONS GALLERY
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
