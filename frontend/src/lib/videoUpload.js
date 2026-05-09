import { api } from './api';

const MAX_VIDEO_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['video/mp4'];

/**
 * Uploads a video directly to Supabase Storage using a signed URL,
 * then tells the server to create the reel + link it to the to-do list.
 *
 * Throws on validation failure or upload failure.
 *
 * @param {string} todoId
 * @param {File} file
 * @param {(progress: number) => void} [onProgress] — 0..1
 * @returns {Promise<{reel_id: string, video_url: string}>}
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

  // 1. Ask the server for a signed upload URL
  const init = await api.initVideoUpload(todoId, file.name, file.size);
  if (!init?.signed_url || !init?.storage_path || !init?.reel_id) {
    throw new Error('Could not initialize upload');
  }

  // 2. Upload directly to Supabase Storage with progress tracking
  // Using XMLHttpRequest because fetch() doesn't expose upload progress.
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

  // 3. Tell the server to finalize: create the reel record + link to the to-do list
  const result = await api.finalizeVideoUpload(todoId, {
    reel_id: init.reel_id,
    storage_path: init.storage_path,
    filename: file.name,
  });

  return result;
}
