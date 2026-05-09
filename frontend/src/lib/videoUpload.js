import { api } from './api';
import { generateVideoThumbnail } from './videoThumbnail';

const MAX_VIDEO_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['video/mp4'];

/**
 * Reads a Blob into a base64 data URL via FileReader.
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read thumbnail blob'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Uploads a video directly to Supabase Storage using a signed URL,
 * generates a thumbnail in the browser, and tells the server to create the
 * reel + link it to the to-do list.
 *
 * @param {string} todoId
 * @param {File} file
 * @param {(progress: number) => void} [onProgress] — 0..1
 * @returns {Promise<{reel_id: string, video_url: string, thumbnail_url: string|null}>}
 */
export async function uploadVideoToTodo(todoId, file, onProgress) {
  if (!file) throw new Error('No file selected');
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Please upload an MP4 video. Other formats can be exported from your phone or video editor.');
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(`Video is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`);
  }
  if (file.size === 0) throw new Error('File is empty');

  // 0. Try to generate a thumbnail in the browser. If anything goes wrong here,
  // we silently skip — the upload should still succeed without one.
  let thumbnailDataUrl = null;
  try {
    const thumbBlob = await generateVideoThumbnail(file, { timeSeconds: 1, maxWidth: 720, quality: 0.85 });
    thumbnailDataUrl = await blobToDataUrl(thumbBlob);
  } catch (err) {
    console.warn('[upload] thumbnail generation failed, proceeding without:', err?.message);
  }

  // 1. Ask the server for a signed upload URL
  const init = await api.initVideoUpload(todoId, file.name, file.size);
  if (!init?.signed_url || !init?.storage_path || !init?.reel_id) {
    throw new Error('Could not initialize upload');
  }

  // 2. Upload the video directly to Supabase Storage (XHR for progress events)
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', init.signed_url);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.max(0, Math.min(1, e.loaded / e.total)));
        }
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status}): ${xhr.responseText?.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload aborted'));
    xhr.send(file);
  });

  // 3. Finalize: create the reel record + link to the to-do list (with thumbnail if we have one)
  const result = await api.finalizeVideoUpload(todoId, {
    reel_id: init.reel_id,
    storage_path: init.storage_path,
    filename: file.name,
    thumbnail_data_url: thumbnailDataUrl,
  });

  return result;
}
