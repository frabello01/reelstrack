const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

const KEY_ID = process.env.HIGGSFIELD_KEY_ID;
const KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;

// Bucket for storing generated images (mirrors Higgsfield's outputs so they don't expire)
const GENERATED_BUCKET = 'generated-images';

// ============================================================
// SDK CLIENT (cached, instantiated once on first use)
// ============================================================
let _client = null;
function getClient() {
  if (!KEY_ID || !KEY_SECRET) {
    throw new Error('Higgsfield is not configured — set HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET on Render');
  }
  if (_client) return _client;
  // The v1 client is what supports listSoulIds() and the Soul model with custom_reference_id
  const { HiggsfieldClient } = require('@higgsfield/client');
  _client = new HiggsfieldClient({
    apiKey: KEY_ID,
    apiSecret: KEY_SECRET,
  });
  return _client;
}

// ============================================================
// HELPERS
// ============================================================

// Download an image from a remote URL and upload to our Supabase bucket.
// Returns the public URL of the stored image.
async function mirrorImageToStorage(remoteUrl, generationId, index) {
  // Pull the image bytes
  const res = await fetch(remoteUrl);
  if (!res.ok) {
    throw new Error(`Could not download from Higgsfield (${res.status})`);
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const buf = Buffer.from(await res.arrayBuffer());

  const path = `generations/${generationId}/${index}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(GENERATED_BUCKET)
    .upload(path, buf, {
      contentType,
      cacheControl: '604800',
      upsert: true,
    });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(GENERATED_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('Could not generate public URL');
  return pub.publicUrl;
}

// ============================================================
// ROUTES
// ============================================================

// GET /api/higgsfield/status — is the integration configured?
router.get('/status', (req, res) => {
  res.json({
    configured: !!(KEY_ID && KEY_SECRET),
  });
});

// GET /api/higgsfield/characters — list all Soul IDs trained on the account
router.get('/characters', async (req, res) => {
  try {
    const client = getClient();
    // listSoulIds returns { items: [...], pagination: {...} }
    // We fetch the first 100 — agencies typically have <50 characters
    const response = await client.listSoulIds(1, 100);
    const items = (response?.items || response?.data || []).map((s) => ({
      id: s.id,
      name: s.name || 'Untitled',
      status: s.status,
      thumbnail_url: s.thumbnail_url || s.preview_image_url || null,
      created_at: s.created_at,
    }));
    res.json({ characters: items });
  } catch (err) {
    console.error('[higgsfield] listSoulIds failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/higgsfield/styles — list available Soul style presets
router.get('/styles', async (req, res) => {
  try {
    const client = getClient();
    const styles = await client.getSoulStyles();
    const items = (styles || []).map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail_url: s.thumbnail_url || s.preview_url || null,
    }));
    res.json({ styles: items });
  } catch (err) {
    console.error('[higgsfield] getSoulStyles failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/higgsfield/generate — kick off a generation, mirror outputs, save row
// Body: { soul_id, soul_name?, prompt, style_id?, style_name?, quality?, size?, batch_size?, strength?, seed? }
router.post('/generate', async (req, res) => {
  const {
    soul_id,
    soul_name,
    prompt,
    style_id,
    style_name,
    quality = 'high',
    size = '1536x2048',         // portrait, IG-friendly
    batch_size = 1,
    strength = 1.0,
    seed,
  } = req.body || {};

  if (!soul_id) return res.status(400).json({ error: 'soul_id is required (the character to use)' });
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });

  let client;
  try {
    client = getClient();
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  // Pre-create the DB row so we can write the final URLs into it
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
      batch_size: Math.max(1, Math.min(4, parseInt(batch_size, 10) || 1)),
      custom_reference_strength: Math.max(0, Math.min(1, parseFloat(strength) || 1.0)),
      seed: seed ? parseInt(seed, 10) : null,
      status: 'pending',
    })
    .select()
    .single();
  if (insertErr) {
    console.error('[higgsfield] could not create row:', insertErr.message);
    return res.status(500).json({ error: `DB error: ${insertErr.message}` });
  }

  // Build the SDK input
  // Note: Higgsfield expects width_and_height as a single string like "1536x2048"
  const sdkInput = {
    prompt: prompt.trim(),
    custom_reference_id: soul_id,
    custom_reference_strength: gen.custom_reference_strength,
    width_and_height: size,
    quality,
    batch_size: gen.batch_size,
  };
  if (style_id) sdkInput.style_id = style_id;
  if (gen.seed !== null && gen.seed !== undefined) sdkInput.seed = gen.seed;

  const startedAt = Date.now();
  let jobSet;
  try {
    console.log(`[higgsfield] generating with soul=${soul_id}, quality=${quality}, size=${size}, batch=${gen.batch_size}`);
    jobSet = await client.generate('/v1/text2image/soul', sdkInput, {
      withPolling: true,
    });
  } catch (err) {
    console.error('[higgsfield] generate failed:', err.message);
    await supabase
      .from('higgsfield_generations')
      .update({ status: 'failed', error_message: err.message, completed_at: new Date().toISOString() })
      .eq('id', gen.id);
    return res.status(500).json({ error: err.message, generation_id: gen.id });
  }

  // Inspect the jobSet
  if (!jobSet?.isCompleted) {
    const failure = jobSet?.isNsfw ? 'nsfw' : 'failed';
    const errMsg = jobSet?.isNsfw
      ? 'Content was rejected by Higgsfield as NSFW'
      : `Generation did not complete (status: ${jobSet?.status || 'unknown'})`;
    await supabase
      .from('higgsfield_generations')
      .update({ status: failure, error_message: errMsg, completed_at: new Date().toISOString() })
      .eq('id', gen.id);
    return res.status(500).json({ error: errMsg, generation_id: gen.id });
  }

  // Pull the image URLs out of the job set
  const originalUrls = [];
  for (const job of jobSet.jobs) {
    const url = job?.results?.raw?.url;
    if (url) originalUrls.push(url);
  }
  if (originalUrls.length === 0) {
    await supabase
      .from('higgsfield_generations')
      .update({ status: 'failed', error_message: 'No output URLs returned', completed_at: new Date().toISOString() })
      .eq('id', gen.id);
    return res.status(500).json({ error: 'Higgsfield returned no images', generation_id: gen.id });
  }

  // Mirror to Supabase Storage (parallel)
  console.log(`[higgsfield] mirroring ${originalUrls.length} images to Storage…`);
  let storedUrls;
  try {
    storedUrls = await Promise.all(
      originalUrls.map((url, i) => mirrorImageToStorage(url, gen.id, i))
    );
  } catch (err) {
    console.error('[higgsfield] mirror failed:', err.message);
    // Fall back to the original URLs (still works, just might expire later)
    storedUrls = originalUrls;
  }

  const elapsed = (Date.now() - startedAt) / 1000;

  // Update DB row with final state
  const { data: updated, error: updateErr } = await supabase
    .from('higgsfield_generations')
    .update({
      status: 'completed',
      image_urls: storedUrls,
      original_higgsfield_urls: originalUrls,
      higgsfield_request_id: jobSet.id,
      elapsed_seconds: elapsed,
      completed_at: new Date().toISOString(),
    })
    .eq('id', gen.id)
    .select()
    .single();
  if (updateErr) {
    console.error('[higgsfield] could not update row:', updateErr.message);
  }

  res.json(updated || { ...gen, image_urls: storedUrls, status: 'completed', elapsed_seconds: elapsed });
});

// GET /api/higgsfield/generations — paginated gallery of past generations
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
  // Try to delete the images from Storage first
  const { data: gen } = await supabase
    .from('higgsfield_generations')
    .select('image_urls')
    .eq('id', req.params.id)
    .maybeSingle();
  if (gen?.image_urls?.length) {
    // Parse out the storage paths from the public URLs
    const paths = gen.image_urls
      .map((url) => {
        const match = String(url).match(/\/generated-images\/(.+)$/);
        return match ? match[1] : null;
      })
      .filter(Boolean);
    if (paths.length) {
      await supabase.storage.from(GENERATED_BUCKET).remove(paths).catch(() => {});
    }
  }
  const { error } = await supabase
    .from('higgsfield_generations')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
