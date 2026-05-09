/**
 * Generate a JPEG thumbnail from a video File by seeking to a frame and
 * drawing it onto a canvas. Returns a Blob.
 *
 * @param {File} file - the video file
 * @param {object} [opts]
 * @param {number} [opts.timeSeconds=1] - which timestamp to capture (default ~1s in to skip black openings)
 * @param {number} [opts.maxWidth=720] - max output width (height scales proportionally)
 * @param {number} [opts.quality=0.85] - JPEG quality 0..1
 * @returns {Promise<Blob>} JPEG blob
 */
export async function generateVideoThumbnail(file, opts = {}) {
  const { timeSeconds = 1, maxWidth = 720, quality = 0.85 } = opts;

  // Create an off-DOM video element (it doesn't need to be in the document
  // to load and seek, but we set muted + playsInline for autoplay safety).
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';

  const objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;

  try {
    // Wait for metadata so we know the dimensions and duration
    await new Promise((resolve, reject) => {
      const onLoaded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('Could not load video metadata')); };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    });

    // Seek to the desired time (clamp to duration so very-short videos still work)
    const target = Math.min(timeSeconds, Math.max(0, (video.duration || 0) - 0.05));
    await new Promise((resolve, reject) => {
      const onSeeked = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('Could not seek video')); };
      const cleanup = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.currentTime = target;
    });

    // Draw to canvas, scaled down if necessary
    const sourceW = video.videoWidth || 720;
    const sourceH = video.videoHeight || 1280;
    const scale = sourceW > maxWidth ? maxWidth / sourceW : 1;
    const w = Math.round(sourceW * scale);
    const h = Math.round(sourceH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    // Export as JPEG blob
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error('Canvas export failed')),
        'image/jpeg',
        quality
      );
    });
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.src = '';
  }
}
