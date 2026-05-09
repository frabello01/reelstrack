import { useState, useRef } from 'react';
import { Upload, ImageIcon, X, Loader2 } from 'lucide-react';
import './ImageUploader.css';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Generic image uploader.
 *
 * Props:
 *  - currentUrl   — URL of currently saved image (or null)
 *  - onUpload     — async (dataUrl: string) => void   — called with base64 data URL
 *  - onRemove     — async () => void                  — called when "remove" is clicked
 *  - shape        — "circle" | "banner" (default: "banner")
 *  - placeholder  — text shown when empty
 */
export default function ImageUploader({ currentUrl, onUpload, onRemove, shape = 'banner', placeholder = 'Upload image' }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = async (file) => {
    setError('');
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Please choose a JPG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`);
      return;
    }

    // Read as base64 data URL
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });

    setUploading(true);
    try {
      await onUpload(dataUrl);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemove = async (e) => {
    e.stopPropagation();
    if (!confirm('Remove this image?')) return;
    setUploading(true);
    setError('');
    try {
      await onRemove();
    } catch (err) {
      setError(err.message || 'Failed to remove image');
    } finally {
      setUploading(false);
    }
  };

  const wrapperClass = `image-uploader image-uploader-${shape} ${dragOver ? 'drag-over' : ''} ${uploading ? 'uploading' : ''}`;

  return (
    <div className="image-uploader-wrap">
      <div
        className={wrapperClass}
        onClick={handleClick}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
      >
        {currentUrl ? (
          <>
            <img src={currentUrl} alt="" />
            <div className="image-uploader-overlay">
              <Upload size={shape === 'banner' ? 20 : 16} />
              <span>Replace</span>
            </div>
            {!uploading && (
              <button className="image-uploader-remove" onClick={handleRemove} aria-label="Remove image">
                <X size={14} />
              </button>
            )}
          </>
        ) : (
          <div className="image-uploader-empty">
            {uploading ? (
              <>
                <Loader2 size={shape === 'banner' ? 22 : 18} className="spin" />
                <span>Uploading…</span>
              </>
            ) : (
              <>
                <ImageIcon size={shape === 'banner' ? 22 : 18} />
                <span>{placeholder}</span>
                {shape === 'banner' && <span className="image-uploader-hint">click or drag-drop</span>}
              </>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {error && <div className="image-uploader-error">{error}</div>}
    </div>
  );
}
