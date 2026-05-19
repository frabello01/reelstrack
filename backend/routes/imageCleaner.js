const express = require('express');
const router = express.Router();
const sharp = require('sharp');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_BASE = 'https://api.replicate.com/v1';

// Max dimension (longest side) we send to Replicate. SD 1.5 is trained at
// 512×512 and memory usage scales quadratically — sending a 4000px image
// causes CUDA OOM. 1024px is a sane middle ground that still produces a
// high-quality cleaned image suitable for IG/web use.
const REPLICATE_MAX_DIM = 1024;

// Pre-vetted img2img models on Replicate. Each entry maps a friendly id
// (what the frontend sends) to a Replicate model + the latest known version hash.
// If Replicate updates a model, just bump the version hash here.
//
// We pull the version dynamically below to avoid stale hashes, but having a
// fallback locked in means the feature keeps working even if Replicate's
// public API is briefly flaky.
//
// IMPORTANT: Dreamshaper V8 is the model that noai-watermark uses by default
// (Lykon/dreamshaper-8). It's a fine-tuned SD 1.5 checkpoint that produces
// noticeably better results than vanilla SD 1.5 for img2img watermark cleaning.
const MODELS = {
  'dreamshaper-v8': {
    owner: 'asiryan',
    name: 'dreamshaper-v8',
    label: 'Dreamshaper V8 (recommended — matches noai-watermark)',
    // Tuning that mirrors noai-watermark defaults
    defaultStrength: 0.04,
    defaultSteps: 50,
    prompt: 'high quality, detailed, photorealistic',
  },
  'realistic-vision': {
    owner: 'asiryan',
    name: 'realistic-vision-v6.0-b1',
    label: 'Realistic Vision (alternative for photos)',
    defaultStrength: 0.04,
    defaultSteps: 50,
    prompt: 'high quality, detailed, photorealistic',
  },
};

// Cap input image size to keep cost + speed sane and prevent abuse
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8 MB

// Helper: download bytes from a URL into a Buffer
async function downloadToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) from ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// Resize an image so its longest side is at most `maxDim`. Returns the
// resized buffer + a flag indicating whether resize was needed.
// SD models also need dimensions divisible by 8, so we snap to multiples of 8.
async function resizeForReplicate(inputBuf, maxDim = REPLICATE_MAX_DIM) {
  const meta = await sharp(inputBuf, { failOn: 'none' }).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) {
    throw new Error('Could not read image dimensions');
  }

  // If already small enough, just snap to multiple of 8 if needed
  if (w <= maxDim && h <= maxDim && w % 8 === 0 && h % 8 === 0) {
    return { buffer: inputBuf, resized: false, originalDims: { w, h }, newDims: { w, h } };
  }

  // Scale down proportionally so longest side = maxDim, then snap to multiple of 8
  const scale = Math.min(maxDim / w, maxDim / h, 1);
  const newW = Math.max(8, Math.floor((w * scale) / 8) * 8);
  const newH = Math.max(8, Math.floor((h * scale) / 8) * 8);

  const resized = await sharp(inputBuf, { failOn: 'none' })
    .resize(newW, newH, { fit: 'fill' })
    .png({ compressionLevel: 6 })
    .toBuffer();

  return {
    buffer: resized,
    resized: true,
    originalDims: { w, h },
    newDims: { w: newW, h: newH },
  };
}

// Helper: poll a Replicate prediction until it's succeeded/failed/canceled.
// Replicate predictions have an `urls.get` field — fetch it every 2s.
async function pollPrediction(predictionUrl, { timeoutMs = 180000, intervalMs = 2000 } = {}) {
  const start = Date.now();
  let lastStatus = null;
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(predictionUrl, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Replicate poll failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    lastStatus = data.status;
    if (data.status === 'succeeded') return data;
    if (data.status === 'failed' || data.status === 'canceled') {
      // Surface the actual Replicate error so we can show something useful
      const replicateError = data.error || `Replicate prediction ${data.status}`;
      const err = new Error(replicateError);
      err.replicateLogs = data.logs;
      throw err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Replicate prediction timed out (3 min). Last status: ${lastStatus || 'unknown'}`);
}

// Translate raw Replicate errors into actionable advice for the user
function humanizeReplicateError(rawError) {
  if (!rawError) return 'Unknown error';
  const e = String(rawError).toLowerCase();
  if (e.includes('out of memory') || e.includes('cuda') || e.includes('oom')) {
    return 'The Replicate GPU ran out of memory for that image. Try again — the backend now auto-resizes large images, so a retry should work.';
  }
  if (e.includes('timed out') || e.includes('timeout')) {
    return 'Replicate took too long to respond. The model may be cold-starting (first request after idle) — try again in 30 seconds.';
  }
  if (e.includes('insufficient') || e.includes('billing') || e.includes('credit')) {
    return 'Out of Replicate credits. Top up at replicate.com → Account → Billing.';
  }
  if (e.includes('unauthorized') || e.includes('401') || e.includes('invalid token')) {
    return 'Replicate token is invalid. Check REPLICATE_API_TOKEN on Render.';
  }
  return rawError.length > 200 ? rawError.slice(0, 200) + '…' : rawError;
}

// Get the latest version hash for a model so we don't have to hardcode them
async function getLatestModelVersion(owner, name) {
  const res = await fetch(`${REPLICATE_BASE}/models/${owner}/${name}`, {
    headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Could not look up model ${owner}/${name}: ${res.status}`);
  const data = await res.json();
  if (!data.latest_version?.id) {
    throw new Error(`Model ${owner}/${name} has no latest version`);
  }
  return data.latest_version.id;
}

// ============================================================
// METADATA STRIPPING
// ============================================================
// Uses sharp's `.withMetadata(false)` (default) to drop EXIF/IPTC/XMP, and
// .toFormat() forces a re-encode which discards PNG text chunks (which is
// where Stable Diffusion WebUI / ComfyUI / C2PA store their AI provenance).
//
// We default to outputting PNG so we don't introduce JPEG compression on
// images that were originally PNGs.
async function stripAllMetadata(inputBuffer, format = 'png') {
  const pipeline = sharp(inputBuffer, { failOn: 'none' }).rotate(); // auto-orient first, then drop EXIF

  // No `.withMetadata(...)` call = all metadata dropped (this is sharp's default behavior)
  if (format === 'jpeg' || format === 'jpg') {
    return await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  }
  if (format === 'webp') {
    return await pipeline.webp({ quality: 95 }).toBuffer();
  }
  // Default: PNG, compression level 9 (smallest), no metadata
  return await pipeline.png({ compressionLevel: 9 }).toBuffer();
}

// ============================================================
// ROUTES
// ============================================================

// GET available models (frontend uses this to populate the dropdown)
router.get('/models', (req, res) => {
  const list = Object.entries(MODELS).map(([id, m]) => ({
    id,
    label: m.label,
    defaultStrength: m.defaultStrength,
    defaultSteps: m.defaultSteps,
  }));
  res.json({ models: list, configured: !!REPLICATE_API_TOKEN });
});

// POST /api/image-cleaner/clean
// Body:
//   image_data_url: 'data:image/png;base64,...'
//   model_id?: 'sd-1.5' (default) | 'realistic-vision'
//   strength?: 0.04 (default)
//   steps?: 50 (default)
//   only_metadata?: boolean — if true, skip the diffusion pass and just strip metadata (fast, free)
//
// Response:
//   { cleaned_data_url: 'data:image/png;base64,...', mode: 'diffusion'|'metadata-only' }
router.post('/clean', async (req, res) => {
  const { image_data_url, model_id = 'sd-1.5', strength, steps, only_metadata = false } = req.body || {};

  if (!image_data_url) return res.status(400).json({ error: 'image_data_url is required' });
  const match = String(image_data_url).match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Invalid image format. Expected a data URL.' });
  const [, mimeType, base64Data] = match;
  const inputBuf = Buffer.from(base64Data, 'base64');
  if (inputBuf.length === 0) return res.status(400).json({ error: 'Image is empty' });
  if (inputBuf.length > MAX_INPUT_BYTES) {
    return res.status(400).json({ error: `Image too large: ${(inputBuf.length / 1024 / 1024).toFixed(1)} MB (max ${MAX_INPUT_BYTES / 1024 / 1024} MB)` });
  }

  const outputFormat = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpeg'
                     : mimeType.includes('webp') ? 'webp'
                     : 'png';

  // ---------- METADATA-ONLY MODE (free, fast, no Replicate) ----------
  if (only_metadata) {
    try {
      const stripped = await stripAllMetadata(inputBuf, outputFormat);
      const dataUrl = `data:${mimeType};base64,${stripped.toString('base64')}`;
      return res.json({ cleaned_data_url: dataUrl, mode: 'metadata-only' });
    } catch (err) {
      console.error('[image-cleaner] metadata-only failed:', err.message);
      return res.status(500).json({ error: `Metadata strip failed: ${err.message}` });
    }
  }

  // ---------- DIFFUSION MODE (uses Replicate) ----------
  if (!REPLICATE_API_TOKEN) {
    return res.status(503).json({ error: 'AI cleaning is not configured (missing REPLICATE_API_TOKEN). You can still use "Metadata only" mode.' });
  }

  const modelCfg = MODELS[model_id];
  if (!modelCfg) {
    return res.status(400).json({ error: `Unknown model_id: ${model_id}. Available: ${Object.keys(MODELS).join(', ')}` });
  }
  const useStrength = typeof strength === 'number' ? Math.max(0, Math.min(1, strength)) : modelCfg.defaultStrength;
  const useSteps = Number.isInteger(steps) ? Math.max(1, Math.min(150, steps)) : modelCfg.defaultSteps;

  let cleanedBuf;
  let resizeInfo = null;
  try {
    // 0. RESIZE: scale down to <= 1024px on longest side so the GPU doesn't OOM.
    // SD 1.5 is trained at 512×512 and memory usage is O(n²) in resolution.
    // A 2000+px image triggers CUDA OOM. 1024px is the sweet spot.
    resizeInfo = await resizeForReplicate(inputBuf, REPLICATE_MAX_DIM);
    const replicateInputBuf = resizeInfo.buffer;
    const replicateInputDataUrl = `data:image/png;base64,${replicateInputBuf.toString('base64')}`;

    if (resizeInfo.resized) {
      console.log(`[image-cleaner] resized ${resizeInfo.originalDims.w}×${resizeInfo.originalDims.h} → ${resizeInfo.newDims.w}×${resizeInfo.newDims.h}`);
    }

    // 1. Resolve the latest model version on Replicate
    const versionId = await getLatestModelVersion(modelCfg.owner, modelCfg.name);

    // 2. Submit an img2img prediction. Replicate accepts base64 data URLs as
    //    input.image, so we never expose a public URL of the user's image.
    //
    // Asiryan's SD model family (dreamshaper-v8, realistic-vision-v6.0-b1)
    // expects these input field names: `image`, `prompt`, `strength` (NOT
    // prompt_strength), `num_inference_steps`, `guidance_scale`. The model
    // auto-detects img2img mode when an image is provided.
    const submitRes = await fetch(`${REPLICATE_BASE}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: versionId,
        input: {
          image: replicateInputDataUrl,
          prompt: modelCfg.prompt,
          strength: useStrength,
          num_inference_steps: useSteps,
          guidance_scale: 7.5,
        },
      }),
    });
    if (!submitRes.ok) {
      const body = await submitRes.text().catch(() => '');
      console.error('[image-cleaner] Replicate submit failed:', submitRes.status, body.slice(0, 500));
      let msg = 'Replicate rejected the request.';
      try { msg = JSON.parse(body).detail || msg; } catch {}
      return res.status(submitRes.status).json({ error: humanizeReplicateError(msg) });
    }
    const prediction = await submitRes.json();

    // 3. Poll until done
    const final = await pollPrediction(prediction.urls.get);

    // Replicate's output for img2img is usually an array of URLs (one per image)
    const outputUrls = Array.isArray(final.output) ? final.output : (final.output ? [final.output] : []);
    if (outputUrls.length === 0) {
      return res.status(500).json({ error: 'Replicate returned no output' });
    }

    // 4. Download the cleaned image bytes
    cleanedBuf = await downloadToBuffer(outputUrls[0]);
  } catch (err) {
    console.error('[image-cleaner] diffusion failed:', err.message);
    return res.status(500).json({ error: humanizeReplicateError(err.message) });
  }

  // 5. Strip metadata from the cleaned image (some models add their own)
  let final;
  try {
    final = await stripAllMetadata(cleanedBuf, outputFormat);
  } catch (err) {
    // If sharp fails (e.g. weird format from Replicate), fall back to raw bytes
    console.warn('[image-cleaner] metadata strip on output failed, returning raw bytes:', err.message);
    final = cleanedBuf;
  }

  const cleanedDataUrl = `data:${mimeType};base64,${final.toString('base64')}`;
  res.json({
    cleaned_data_url: cleanedDataUrl,
    mode: 'diffusion',
    strength: useStrength,
    steps: useSteps,
    resized: resizeInfo?.resized || false,
    original_dims: resizeInfo?.originalDims || null,
    new_dims: resizeInfo?.newDims || null,
  });
});

module.exports = router;
