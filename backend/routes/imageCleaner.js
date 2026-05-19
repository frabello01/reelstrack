const express = require('express');
const router = express.Router();
const sharp = require('sharp');

const MODAL_ENDPOINT_URL = process.env.MODAL_ENDPOINT_URL;

// Cap input image size to keep cost + speed sane and prevent abuse
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8 MB

// Modal can handle larger images than vanilla Replicate SD models, but
// huge images still cost more GPU time and don't meaningfully change
// SynthID removal effectiveness. 2048 is a safe cap.
const MODAL_MAX_DIM = 2048;

// Resize an image so its longest side is at most `maxDim`. Preserves aspect
// ratio. SD models also like dimensions divisible by 8, so we snap to that.
async function resizeIfNeeded(inputBuf, maxDim) {
  const meta = await sharp(inputBuf, { failOn: 'none' }).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) throw new Error('Could not read image dimensions');

  if (w <= maxDim && h <= maxDim && w % 8 === 0 && h % 8 === 0) {
    return { buffer: inputBuf, resized: false, originalDims: { w, h }, newDims: { w, h } };
  }

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

// Strip all metadata from an image. Sharp's default behavior drops EXIF/IPTC/XMP,
// and re-encoding discards PNG text chunks (which is where Stable Diffusion WebUI,
// ComfyUI, and C2PA store AI provenance).
async function stripAllMetadata(inputBuffer, format = 'png') {
  const pipeline = sharp(inputBuffer, { failOn: 'none' }).rotate();
  if (format === 'jpeg' || format === 'jpg') {
    return await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  }
  if (format === 'webp') {
    return await pipeline.webp({ quality: 95 }).toBuffer();
  }
  return await pipeline.png({ compressionLevel: 9 }).toBuffer();
}

// ============================================================
// ROUTES
// ============================================================

router.get('/models', (req, res) => {
  res.json({
    configured: !!MODAL_ENDPOINT_URL,
    models: [
      {
        id: 'noai-watermark',
        label: 'noai-watermark (Dreamshaper-8 on Modal GPU)',
        defaultStrength: 0.04,
        defaultSteps: 50,
      },
    ],
  });
});

// POST /api/image-cleaner/clean
// Body:
//   image_data_url: 'data:image/png;base64,...'
//   strength?: 0.04
//   steps?: 50
//   only_metadata?: boolean — if true, skip diffusion, just strip metadata (free + instant)
router.post('/clean', async (req, res) => {
  const { image_data_url, strength = 0.04, steps = 50, only_metadata = false } = req.body || {};

  if (!image_data_url) return res.status(400).json({ error: 'image_data_url is required' });
  const match = String(image_data_url).match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Invalid image format. Expected a data URL.' });
  const [, mimeType, base64Data] = match;
  const inputBuf = Buffer.from(base64Data, 'base64');
  if (inputBuf.length === 0) return res.status(400).json({ error: 'Image is empty' });
  if (inputBuf.length > MAX_INPUT_BYTES) {
    return res.status(400).json({
      error: `Image too large: ${(inputBuf.length / 1024 / 1024).toFixed(1)} MB (max ${MAX_INPUT_BYTES / 1024 / 1024} MB)`,
    });
  }

  const outputFormat = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpeg'
                     : mimeType.includes('webp') ? 'webp'
                     : 'png';

  // ---------- METADATA-ONLY MODE (free, fast, no Modal call) ----------
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

  // ---------- DIFFUSION MODE (calls Modal) ----------
  if (!MODAL_ENDPOINT_URL) {
    return res.status(503).json({
      error: 'AI cleaning is not configured (missing MODAL_ENDPOINT_URL). Deploy modal_app.py first, then add the URL to Render env vars.',
    });
  }

  // Resize before sending to keep Modal cost down
  let resizeInfo;
  try {
    resizeInfo = await resizeIfNeeded(inputBuf, MODAL_MAX_DIM);
  } catch (err) {
    return res.status(400).json({ error: `Resize failed: ${err.message}` });
  }

  const modalInputB64 = resizeInfo.buffer.toString('base64');
  if (resizeInfo.resized) {
    console.log(`[image-cleaner] resized ${resizeInfo.originalDims.w}×${resizeInfo.originalDims.h} → ${resizeInfo.newDims.w}×${resizeInfo.newDims.h}`);
  }

  // Call Modal endpoint with a generous timeout. Cold start may take 30-60s,
  // hot processing is ~10-20s, so 5 min is more than safe.
  const useStrength = Math.max(0, Math.min(1, Number(strength) || 0.04));
  const useSteps = Math.max(10, Math.min(100, parseInt(steps, 10) || 50));

  console.log(`[image-cleaner] calling Modal: strength=${useStrength}, steps=${useSteps}`);
  const startedAt = Date.now();

  let modalRes;
  try {
    // AbortController gives us a real timeout (5 min)
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    modalRes = await fetch(MODAL_ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_b64: modalInputB64,
        strength: useStrength,
        steps: useSteps,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutHandle);
  } catch (err) {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    console.error(`[image-cleaner] Modal call failed after ${elapsed}s:`, err.message);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: `Modal took longer than 5 min (likely a deep cold start). Try again in 30 seconds.` });
    }
    return res.status(502).json({ error: `Could not reach Modal endpoint: ${err.message}` });
  }

  if (!modalRes.ok) {
    const body = await modalRes.text().catch(() => '');
    console.error(`[image-cleaner] Modal returned ${modalRes.status}:`, body.slice(0, 500));
    let msg = `Modal error (HTTP ${modalRes.status})`;
    try {
      const parsed = JSON.parse(body);
      msg = parsed.detail || parsed.error || msg;
    } catch {}
    return res.status(modalRes.status).json({ error: msg });
  }

  let payload;
  try {
    payload = await modalRes.json();
  } catch (err) {
    return res.status(502).json({ error: `Modal returned non-JSON response: ${err.message}` });
  }

  const cleanedB64 = payload.cleaned_b64;
  if (!cleanedB64) {
    return res.status(502).json({ error: 'Modal response missing cleaned_b64' });
  }

  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  console.log(`[image-cleaner] Modal done in ${elapsed}s (worker: ${payload.elapsed_seconds}s)`);

  // Strip any residual metadata from Modal's output, just to be safe.
  // noai-watermark already strips AI metadata, but this guards against
  // anything else slipping through.
  const modalOutputBuf = Buffer.from(cleanedB64, 'base64');
  let finalBuf;
  try {
    finalBuf = await stripAllMetadata(modalOutputBuf, outputFormat);
  } catch (err) {
    console.warn('[image-cleaner] final metadata strip failed, returning Modal output as-is:', err.message);
    finalBuf = modalOutputBuf;
  }

  const cleanedDataUrl = `data:${mimeType};base64,${finalBuf.toString('base64')}`;
  res.json({
    cleaned_data_url: cleanedDataUrl,
    mode: 'diffusion',
    strength: useStrength,
    steps: useSteps,
    elapsed_seconds: elapsed,
    worker_seconds: payload.elapsed_seconds,
    resized: resizeInfo.resized,
    original_dims: resizeInfo.originalDims,
    new_dims: resizeInfo.newDims,
  });
});

module.exports = router;
