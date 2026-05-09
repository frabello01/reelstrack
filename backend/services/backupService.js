const supabase = require('../lib/supabase');

const HIKERAPI_BASE = 'https://api.hikerapi.com';
const HIKERAPI_TOKEN = process.env.HIKERAPI_TOKEN;
const BACKUPS_BUCKET = 'reel-backups';

// Max size we'll accept (safety guard: shouldn't normally exceed 30 MB for IG reels)
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

async function hikerGet(path, params = {}) {
  if (!HIKERAPI_TOKEN) throw new Error('HIKERAPI_TOKEN not configured');
  const url = new URL(`${HIKERAPI_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'x-access-key': HIKERAPI_TOKEN, accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HikerAPI ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Get a fresh video URL for a reel by re-querying HikerAPI.
 * Important: IG CDN video URLs expire quickly (~1-2 hours) so we must fetch
 * a fresh one right before downloading.
 */
async function getFreshVideoUrl(shortcode) {
  // /v1/media/by/code returns the full media object including video_url and thumbnail_url
  const media = await hikerGet('/v1/media/by/code', { code: shortcode });
  return {
    videoUrl: media.video_url || null,
    thumbnailUrl: media.thumbnail_url || null,
    media,
  };
}

/**
 * Download a binary asset and upload it to Supabase Storage.
 * Returns { url, sizeBytes } on success, throws on failure.
 */
async function downloadAndStore(sourceUrl, storagePath, contentType) {
  // Download
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Source download failed (${res.status})`);
  }

  // Read into buffer (with size guard)
  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_VIDEO_SIZE_BYTES) {
    throw new Error(`Video too large: ${contentLength} bytes`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_VIDEO_SIZE_BYTES) {
    throw new Error(`Video too large after download: ${buf.length} bytes`);
  }

  // Upload to Supabase Storage
  const { error: upErr } = await supabase.storage
    .from(BACKUPS_BUCKET)
    .upload(storagePath, buf, {
      contentType,
      upsert: true,
      cacheControl: '31536000', // 1 year — these are immutable backups
    });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(BACKUPS_BUCKET).getPublicUrl(storagePath);
  return { url: pub?.publicUrl, sizeBytes: buf.length };
}

/**
 * Main entry point: backup a single reel.
 * Idempotent — safe to call multiple times. Skips if already backed up.
 *
 * @param {string} reelId — the UUID of the reel in the `reels` table
 * @returns {Promise<void>}
 */
async function backupReel(reelId) {
  // Step 1: load the reel
  const { data: reel, error: loadErr } = await supabase
    .from('reels')
    .select('id, instagram_id, url, backup_status, backup_video_url')
    .eq('id', reelId)
    .single();
  if (loadErr || !reel) {
    console.error(`[backup] Reel not found: ${reelId}`);
    return;
  }

  // Skip if already done
  if (reel.backup_status === 'done' && reel.backup_video_url) {
    console.log(`[backup] @${reelId} already backed up, skipping`);
    return;
  }

  // Mark as downloading so the UI shows progress
  await supabase
    .from('reels')
    .update({
      backup_status: 'downloading',
      backup_attempted_at: new Date().toISOString(),
      backup_error: null,
    })
    .eq('id', reelId);

  try {
    // Step 2: extract shortcode from the IG URL we have stored (e.g. https://instagram.com/reel/ABC123/)
    // We use instagram_id since for normally-fetched reels it's the IG numeric id, but for
    // manually-added reels (by-link) it's the shortcode. Either way the URL works.
    const shortcodeMatch = (reel.url || '').match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    const shortcode = shortcodeMatch ? shortcodeMatch[1] : reel.instagram_id;
    if (!shortcode) {
      throw new Error('Could not determine shortcode for this reel');
    }

    // Step 3: get fresh video URL (the stored one may have expired)
    const { videoUrl, thumbnailUrl } = await getFreshVideoUrl(shortcode);
    if (!videoUrl) {
      throw new Error('No video_url returned from HikerAPI (reel may be deleted)');
    }

    // Step 4: download + upload video
    console.log(`[backup] Downloading video for ${reelId}...`);
    const videoStoragePath = `videos/${reel.id}.mp4`;
    const { url: backupVideoUrl, sizeBytes } = await downloadAndStore(
      videoUrl,
      videoStoragePath,
      'video/mp4'
    );

    // Step 5: download + upload thumbnail (best-effort — don't fail backup if this fails)
    let backupThumbnailUrl = null;
    if (thumbnailUrl) {
      try {
        const thumbStoragePath = `thumbnails/${reel.id}.jpg`;
        const result = await downloadAndStore(thumbnailUrl, thumbStoragePath, 'image/jpeg');
        backupThumbnailUrl = result.url;
      } catch (thumbErr) {
        console.warn(`[backup] thumbnail backup failed for ${reelId}:`, thumbErr.message);
      }
    }

    // Step 6: mark as done
    await supabase
      .from('reels')
      .update({
        backup_status: 'done',
        backup_video_url: backupVideoUrl,
        backup_thumbnail_url: backupThumbnailUrl,
        backup_size_bytes: sizeBytes,
        backup_completed_at: new Date().toISOString(),
        backup_error: null,
      })
      .eq('id', reelId);

    console.log(`[backup] ✅ Done: ${reelId} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.error(`[backup] ❌ Failed for ${reelId}:`, err.message);
    await supabase
      .from('reels')
      .update({
        backup_status: 'failed',
        backup_error: err.message.substring(0, 500),
        backup_attempted_at: new Date().toISOString(),
      })
      .eq('id', reelId);
  }
}

/**
 * Background-trigger version: kicks off a backup but doesn't wait for it.
 * Use this from API routes that need to return immediately.
 */
function backupReelInBackground(reelId) {
  // Set status to pending immediately so UI knows
  supabase
    .from('reels')
    .update({ backup_status: 'pending' })
    .eq('id', reelId)
    .then(() => backupReel(reelId))
    .catch((err) => console.error(`[backup-bg] failed for ${reelId}:`, err.message));
}

module.exports = { backupReel, backupReelInBackground };
