const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

const KEY_ID = process.env.HIGGSFIELD_KEY_ID;
const KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
const BASE_URL = process.env.HIGGSFIELD_BASE_URL || 'https://platform.higgsfield.ai';
const GENERATED_BUCKET = 'generated-images';

// ============================================================
// HTTP CLIENT
// ============================================================
// The SDK README shows the auth header is "Authorization: Key KEY_ID:KEY_SECRET"
// We use that, plus the obfuscated User-Agent the SDK uses to look like server traffic.

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
  const headers = { ...authHeaders(), ...(options.headers || {}) };
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
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
// DEFENSIVE ENDPOINT DISCOVERY
// ============================================================
// The exact REST paths aren't fully documented publicly. We probe a list of
// plausible candidates and cache whichever returns 2xx. If a probe returns
// auth/credit errors (401/402/403), we treat that as "endpoint exists but
// other issue" and ALSO accept it as the correct path.
//
// The probe runs lazily on first use and is cached.

const CANDIDATES = {
  listSoulIds: [
    '/v1/soul-ids',
    '/v1/soul_ids',
    '/v1/text2image/soul/soul-ids',
    '/v1/text2image/soul/custom-references',
    '/v1/custom-references',
  ],
  soulStyles: [
    '/v1/text2image/soul/styles',
    '/v1/soul/styles',
    '/v1/styles',
    '/v1/soul-styles',
  ],
  generateSoul: [
    '/v1/text2image/soul',          // documented in SDK README
  ],
  requestStatus: [
    '/v1/requests',                 // /v1/requests/{id}/status — newer pattern
    '/requests',                    // /requests/{id}/status — v2 client pattern
  ],
};

let _cache = {
  listSoulIds: null,
  soulStyles: null,
  generateSoul: null,
  requestStatus: null,
  discoveredAt: null,
  probeResults: {},
};

async function probeOne(path) {
  try {
    const { ok, status } = await hfFetch(path, { method: 'GET' });
    return { path, status, ok, exists: ok || status === 401 || status === 402 || status === 403 };
  } catch (err) {
    return { path, error: err.message, exists: false };
  }
}

async function discoverEndpoints() {
  if (_cache.discoveredAt && Date.now() - _cache.discoveredAt < 1000 * 60 * 60) {
    return _cache;
  }
  console.log('[higgsfield] discovering endpoints…');
  _cache.probeResults = {};
  for (const key of ['listSoulIds', 'soulStyles']) {
    for (const path of CANDIDATES[key]) {
      const result = await probeOne(path);
      _cache.probeResults[path] = result;
      if (result.exists && !_cache[key]) {
        _cache[key] = path;
        console.log(`[higgsfield]   ${key} -> ${path} (status ${result.status})`);
        break;
      }
    }
  }
  // generateSoul is only one candidate — assume it's right
  _cache.generateSoul = CANDIDATES.generateSoul[0];
  _cache.discoveredAt = Date.now();
  return _cache;
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

// Poll a request until it's done (or hit max time)
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
        // queued / in_progress — keep polling
        break;
      } else {
        lastError = `${path}: ${status}`;
      }
    }
    if (lastError && Date.now() - started > 10_000) {
      // After 10s without ever getting a 2xx, give up
      throw new Error(`Status polling failed: ${lastError}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Generation timed out after ${maxMs / 1000}s`);
}

// ============================================================
// ROUTES
// ============================================================

// GET /api/higgsfield/status — full diagnostic
router.get('/status', async (req, res) => {
  const out = {
    configured: !!(KEY_ID && KEY_SECRET),
    key_id_present: !!KEY_ID,
    key_secret_present: !!KEY_SECRET,
    base_url: BASE_URL,
  };
  if (!out.configured) return res.json(out);

  // Try discovering endpoints
  try {
    await discoverEndpoints();
    out.endpoints = {
      listSoulIds: _cache.listSoulIds,
      soulStyles: _cache.soulStyles,
      generateSoul: _cache.generateSoul,
    };
    out.probe_results = _cache.probeResults;
  } catch (err) {
    out.discovery_error = err.message;
  }
  res.json(out);
});

// GET /api/higgsfield/characters — list trained Soul IDs
router.get('/characters', async (req, res) => {
  try {
    const cache = await discoverEndpoints();
    if (!cache.listSoulIds) {
      return res.status(501).json({
        error: 'Could not auto-discover the listSoulIds endpoint. Check /api/higgsfield/status for probe results.',
        characters: [],
      });
    }
    // Try with pagination params; if that fails, retry without
    let { ok, status, body } = await hfFetch(`${cache.listSoulIds}?page=1&page_size=100`);
    if (!ok) {
      ({ ok, status, body } = await hfFetch(cache.listSoulIds));
    }
    if (!ok) {
      return res.status(status || 502).json({
        error: `Higgsfield returned ${status}`,
        details: body,
      });
    }
    // Normalize the response — different APIs use different keys
    const items = body?.items || body?.data || body?.soul_ids || body?.results || (Array.isArray(body) ? body : []);
    const characters = items.map((s) => ({
      id: s.id || s.soul_id || s.reference_id,
      name: s.name || s.title || 'Untitled',
      status: s.status,
      thumbnail_url: s.thumbnail_url || s.preview_image_url || s.image_url || null,
      created_at: s.created_at || s.createdAt,
    })).filter((c) => c.id);
    res.json({ characters, raw_count: items.length });
  } catch (err) {
    console.error('[higgsfield] characters failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/higgsfield/styles — list Soul style presets
router.get('/styles', async (req, res) => {
  try {
    const cache = await discoverEndpoints();
    if (!cache.soulStyles) {
      // Styles are optional — just return empty
      return res.json({ styles: [], note: 'Could not auto-discover the styles endpoint' });
    }
    const { ok, status, body } = await hfFetch(cache.soulStyles);
    if (!ok) return res.json({ styles: [], status });
    const items = body?.items || body?.data || body?.styles || (Array.isArray(body) ? body : []);
    const styles = items.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail_url: s.thumbnail_url || s.preview_url || null,
    })).filter((s) => s.id);
    res.json({ styles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/higgsfield/generate — kick off, poll, mirror, save
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

  if (!soul_id) return res.status(400).json({ error: 'soul_id is required (the character to use)' });
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
  if (!KEY_ID || !KEY_SECRET) return res.status(503).json({ error: 'Higgsfield env vars not set' });

  // Pre-create DB row
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

  // Build the request body
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

  // Submit
  let submission;
  try {
    console.log(`[higgsfield] submitting: soul=${soul_id}, quality=${quality}, size=${size}, batch=${safeBatch}`);
    const { ok, status, body } = await hfFetch('/v1/text2image/soul', { method: 'POST', body: reqBody });
    if (!ok) {
      const msg = body?.error || body?.message || body?.detail || `HTTP ${status}`;
      await supabase.from('higgsfield_generations')
        .update({ status: 'failed', error_message: msg, completed_at: new Date().toISOString() })
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

  // The submission can be ALREADY completed OR have a request_id we need to poll
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

  // Check final state
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

  // Extract image URLs from response — try multiple shapes
  const originalUrls = [];
  // Shape 1: { images: [{ url: ... }, ...] }
  if (Array.isArray(final?.images)) {
    for (const img of final.images) if (img?.url) originalUrls.push(img.url);
  }
  // Shape 2: { results: [...] } where results have raw.url
  if (Array.isArray(final?.results)) {
    for (const r of final.results) {
      const u = r?.raw?.url || r?.url;
      if (u) originalUrls.push(u);
    }
  }
  // Shape 3: { jobs: [...] } where jobs[].results.raw.url
  if (Array.isArray(final?.jobs)) {
    for (const j of final.jobs) {
      const u = j?.results?.raw?.url || j?.result?.url;
      if (u) originalUrls.push(u);
    }
  }
  // Shape 4: single { url: ... }
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

// GET /api/higgsfield/generations
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

// DELETE /api/higgsfield/generations/:id
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
