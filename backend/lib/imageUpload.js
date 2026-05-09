const supabase = require('../lib/supabase');

const CUSTOM_IMAGES_BUCKET = 'custom-images';

// Allow common image types only
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB after decoding

/**
 * Accepts a data URL (e.g. "data:image/png;base64,...."), decodes it,
 * uploads to Supabase Storage at the given path, and returns the public URL.
 *
 * @param {string} dataUrl — full data URL from the frontend FileReader
 * @param {string} path    — storage path inside the bucket (e.g. "talents/abc123.png")
 * @returns {Promise<string>} the public URL
 */
async function uploadImageDataUrl(dataUrl, path) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('No image data provided');
  }
  // Parse data URL: "data:<mime>;base64,<base64>"
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid image format — must be a base64 data URL');
  }
  const [, mimeType, base64Data] = match;

  if (!ALLOWED_TYPES.includes(mimeType.toLowerCase())) {
    throw new Error(`Unsupported image type: ${mimeType}. Use JPG, PNG, WebP, or GIF.`);
  }

  const buf = Buffer.from(base64Data, 'base64');
  if (buf.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image too large: ${(buf.length / 1024 / 1024).toFixed(1)} MB (max 5 MB)`);
  }
  if (buf.length === 0) {
    throw new Error('Image is empty');
  }

  // Pick file extension from mime
  const ext = mimeType.split('/')[1].toLowerCase().replace('jpeg', 'jpg');
  const fullPath = path.endsWith(`.${ext}`) ? path : `${path}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(CUSTOM_IMAGES_BUCKET)
    .upload(fullPath, buf, {
      contentType: mimeType,
      upsert: true,
      cacheControl: '604800', // 1 week
    });
  if (upErr) {
    throw new Error(`Storage upload failed: ${upErr.message}`);
  }

  const { data: pub } = supabase.storage.from(CUSTOM_IMAGES_BUCKET).getPublicUrl(fullPath);
  if (!pub?.publicUrl) {
    throw new Error('Could not generate public URL after upload');
  }
  return pub.publicUrl;
}

module.exports = { uploadImageDataUrl, CUSTOM_IMAGES_BUCKET };
