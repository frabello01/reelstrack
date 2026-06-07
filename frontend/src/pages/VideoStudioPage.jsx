import { useEffect, useRef, useState } from 'react';
import {
  Clapperboard, Wand2, Upload, X, Image as ImageIcon, Loader2, AlertCircle,
  Trash2, Download, Film, Info, RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import './VideoStudioPage.css';

// ============================================================
// CONSTANTS
// ============================================================
const ASPECT_RATIO_OPTIONS = [
  { value: 'auto', label: 'Auto (matches image, or 16:9 for text-to-video)' },
  { value: '9:16', label: '9:16 — Reel / Story (vertical)' },
  { value: '3:4', label: '3:4 — Portrait' },
  { value: '1:1', label: '1:1 — Square' },
  { value: '4:3', label: '4:3 — Classic landscape' },
  { value: '16:9', label: '16:9 — Cinematic landscape' },
  { value: '2:3', label: '2:3 — Portrait classic' },
  { value: '3:2', label: '3:2 — Landscape classic' },
];

const RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p — Recommended (sharper)' },
  { value: '480p', label: '480p — Faster / cheaper draft' },
];

const MAX_PROMPT_CHARS = 2000;
const MIN_DURATION = 1;
const MAX_DURATION = 15;
const MAX_IMAGE_MB = 10;
const REF_BUCKET = 'studio-reference-photos';   // re-used (already public)
const REF_PREFIX = 'video-refs';

// ============================================================
// HELPERS
// ============================================================
function downloadFromUrl(url, filename) {
  fetch(url)
    .then((r) => r.blob())
    .then((blob) => {
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    })
    .catch(() => window.open(url, '_blank'));
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtSeconds(s) {
  if (!s) return '';
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

// ============================================================
// PAGE
// ============================================================
export default function VideoStudioPage() {
  const [configured, setConfigured] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('auto');
  const [resolution, setResolution] = useState('720p');
  const [duration, setDuration] = useState(5);

  const [imageFile, setImageFile] = useState(null);     // staged File
  const [imagePreview, setImagePreview] = useState(''); // local blob URL
  const [imageUrl, setImageUrl] = useState('');         // uploaded URL after generate-time upload
  const [uploading, setUploading] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [generations, setGenerations] = useState([]);
  const [loadingGens, setLoadingGens] = useState(true);

  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  // ============================================================
  // LIFECYCLE
  // ============================================================
  useEffect(() => {
    (async () => {
      try {
        const s = await api.getVideoStudioStatus();
        setConfigured(!!s.configured);
      } catch {
        setConfigured(false);
      }
    })();
  }, []);

  useEffect(() => { if (configured) loadGens(); }, [configured]);

  // Clean up object URLs when the staged file changes / unmounts
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const loadGens = async () => {
    setLoadingGens(true);
    try {
      const data = await api.getVideoStudioGenerations(30);
      setGenerations(data || []);
    } catch (err) {
      console.warn('[video-studio] gallery load failed:', err.message);
    } finally {
      setLoadingGens(false);
    }
  };

  // ============================================================
  // IMAGE STAGING (browser-direct upload to Supabase)
  // ============================================================
  const handleImagePick = (file) => {
    if (!file) return;
    if (!/image\/(jpe?g|png|webp)/i.test(file.type)) {
      return setError('Image must be jpg, png, or webp');
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      return setError(`Image must be ≤ ${MAX_IMAGE_MB} MB (yours is ${(file.size / 1024 / 1024).toFixed(1)} MB)`);
    }
    setError('');
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setImageUrl(''); // force re-upload on next generate
  };

  const handleClearImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview('');
    setImageUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.classList.add('vs-drop-active');
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.classList.remove('vs-drop-active');
  };
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.classList.remove('vs-drop-active');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleImagePick(f);
  };

  const uploadImageIfNeeded = async () => {
    if (!imageFile) return null;
    if (imageUrl) return imageUrl;
    setUploading(true);
    try {
      const ext = imageFile.type.includes('png') ? 'png'
                : imageFile.type.includes('webp') ? 'webp' : 'jpg';
      const path = `${REF_PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(REF_BUCKET)
        .upload(path, imageFile, {
          contentType: imageFile.type || 'image/jpeg',
          cacheControl: '604800',
          upsert: false,
        });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      const { data: pub } = supabase.storage.from(REF_BUCKET).getPublicUrl(path);
      if (!pub?.publicUrl) throw new Error('No public URL after upload');
      setImageUrl(pub.publicUrl);
      return pub.publicUrl;
    } finally {
      setUploading(false);
    }
  };

  // ============================================================
  // GENERATE
  // ============================================================
  const handleGenerate = async () => {
    setError('');
    if (!prompt.trim()) return setError('Prompt is required');

    setGenerating(true);
    try {
      const refUrl = await uploadImageIfNeeded();
      const body = {
        prompt: prompt.trim(),
        aspect_ratio: aspectRatio,
        resolution,
        duration,
      };
      if (refUrl) body.image_url = refUrl;

      const gen = await api.generateVideoStudio(body);
      setGenerations((g) => [gen, ...g]);
    } catch (err) {
      setError(err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  // ============================================================
  // GALLERY ACTIONS
  // ============================================================
  const handleDelete = async (gen) => {
    if (!confirm('Delete this video?')) return;
    try {
      await api.deleteVideoStudioGeneration(gen.id);
      setGenerations((g) => g.filter((x) => x.id !== gen.id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleDownload = (gen) => {
    if (!gen.video_url) return;
    const safe = (gen.prompt || 'video').slice(0, 40).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    downloadFromUrl(gen.video_url, `${safe}-${gen.id.slice(0, 8)}.mp4`);
  };

  // ============================================================
  // RENDER
  // ============================================================
  if (!configured) {
    return (
      <div className="vs-page">
        <div className="vs-header">
          <h1><Clapperboard size={22} /> Video Studio</h1>
        </div>
        <div className="vs-not-configured">
          <AlertCircle size={32} />
          <h3>Video Studio isn't configured yet</h3>
          <p>
            Set <code>REPLICATE_API_TOKEN</code> in your Render environment variables.
            Get one at <a href="https://replicate.com/account/api-tokens" target="_blank" rel="noopener noreferrer">replicate.com/account/api-tokens</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="vs-page">
      <div className="vs-header">
        <div>
          <h1><Clapperboard size={22} /> Video Studio</h1>
          <p className="vs-subtitle">
            Generate short AI videos with <strong>xAI Grok Imagine</strong>. Drop an image to animate it, or just write a prompt for text-to-video.
            Duration 1–15 sec, 720p or 480p.
          </p>
        </div>
      </div>

      <div className="vs-form-card">
        {/* === Reference image === */}
        <div className="vs-section">
          <div className="vs-section-label">
            <ImageIcon size={14} />
            Reference image <span className="vs-optional">(optional — image-to-video)</span>
          </div>

          {imagePreview ? (
            <div className="vs-image-preview">
              <img src={imagePreview} alt="reference" />
              <button
                type="button"
                className="vs-image-clear"
                onClick={handleClearImage}
                disabled={generating || uploading}
                title="Remove image"
              >
                <X size={14} />
              </button>
              <div className="vs-image-meta">
                {imageFile?.name} · {(imageFile?.size / 1024 / 1024).toFixed(1)} MB
                {uploading && <span className="vs-uploading"><Loader2 size={11} className="spin" /> Uploading…</span>}
              </div>
            </div>
          ) : (
            <div
              ref={dropZoneRef}
              className="vs-drop-zone"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={20} />
              <div>
                <strong>Drop an image here</strong> or click to pick one
              </div>
              <div className="vs-drop-hint">jpg, png, webp · max {MAX_IMAGE_MB} MB</div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => handleImagePick(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
        </div>

        {/* === Prompt === */}
        <div className="vs-section">
          <div className="vs-section-label-row">
            <span className="vs-section-label-text">Prompt</span>
            <span className={`vs-counter ${prompt.length > MAX_PROMPT_CHARS - 100 ? 'warn' : ''}`}>
              {prompt.length}/{MAX_PROMPT_CHARS}
            </span>
          </div>
          <textarea
            className="vs-textarea"
            placeholder={imagePreview
              ? 'Describe what should happen — camera move, motion, mood... e.g. "she slowly turns toward camera and smiles, golden hour lighting"'
              : 'Describe the scene... e.g. "a slow cinematic dolly shot through a rainy Tokyo alley at night, neon reflections on wet pavement"'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_CHARS))}
            disabled={generating}
            rows={4}
          />
        </div>

        {/* === Settings === */}
        <div className="vs-row">
          <div className="vs-cell">
            <label>Aspect ratio</label>
            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} disabled={generating}>
              {ASPECT_RATIO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="vs-cell">
            <label>Resolution</label>
            <select value={resolution} onChange={(e) => setResolution(e.target.value)} disabled={generating}>
              {RESOLUTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="vs-cell">
            <label>Duration · {duration}s</label>
            <input
              type="range"
              min={MIN_DURATION}
              max={MAX_DURATION}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value, 10))}
              disabled={generating}
              className="vs-slider"
            />
            <div className="vs-slider-ticks">
              <span>1s</span>
              <span>5s</span>
              <span>10s</span>
              <span>15s</span>
            </div>
          </div>
        </div>

        <div className="vs-hint">
          <Info size={12} />
          Generation usually takes <strong>1–3 minutes</strong>. Don't close the page — the video appears in the gallery below when ready.
        </div>

        {error && <div className="vs-error"><AlertCircle size={14} /> {error}</div>}

        <button
          className="btn btn-primary vs-generate-btn"
          onClick={handleGenerate}
          disabled={generating || uploading || !prompt.trim()}
        >
          {generating ? (
            <><Loader2 size={14} className="spin" /> Generating… (this can take a few minutes)</>
          ) : uploading ? (
            <><Loader2 size={14} className="spin" /> Uploading image…</>
          ) : (
            <><Wand2 size={14} /> Generate {duration}s video</>
          )}
        </button>
      </div>

      {/* === Gallery === */}
      <div className="vs-gallery-section">
        <div className="vs-gallery-header">
          <h2><Film size={18} /> Recent videos</h2>
          <button className="vs-refresh-btn" onClick={loadGens} disabled={loadingGens}>
            <RefreshCw size={12} className={loadingGens ? 'spin' : ''} />
            Refresh
          </button>
        </div>

        {loadingGens ? (
          <div className="vs-gallery-empty"><Loader2 size={22} className="spin" /></div>
        ) : generations.length === 0 ? (
          <div className="vs-gallery-empty">
            <Clapperboard size={32} />
            <p>No videos yet. Write a prompt above and click <strong>Generate</strong>.</p>
          </div>
        ) : (
          <div className="vs-gallery">
            {generations.map((gen) => (
              <VideoCard
                key={gen.id}
                gen={gen}
                onDelete={() => handleDelete(gen)}
                onDownload={() => handleDownload(gen)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// VIDEO CARD
// ============================================================
function VideoCard({ gen, onDelete, onDownload }) {
  const isDone = gen.status === 'completed' && gen.video_url;
  const isFailed = gen.status === 'failed' || gen.status === 'nsfw';

  return (
    <div className={`vs-card ${isFailed ? 'vs-card-failed' : ''}`}>
      <div className="vs-card-media">
        {isDone ? (
          <video
            src={gen.video_url}
            controls
            playsInline
            preload="metadata"
            poster={gen.thumbnail_url || undefined}
            className="vs-video"
          />
        ) : isFailed ? (
          <div className="vs-card-failed-overlay">
            <AlertCircle size={28} />
            <div>
              <strong>{gen.status === 'nsfw' ? 'Rejected (NSFW)' : 'Generation failed'}</strong>
              <div className="vs-card-err">{gen.error_message || 'Unknown error'}</div>
            </div>
          </div>
        ) : (
          <div className="vs-card-pending">
            <Loader2 size={24} className="spin" />
            <span>Generating…</span>
          </div>
        )}
      </div>
      <div className="vs-card-body">
        <p className="vs-card-prompt" title={gen.prompt}>{gen.prompt}</p>
        <div className="vs-card-meta">
          <span>{gen.duration}s</span>
          <span>·</span>
          <span>{gen.resolution}</span>
          <span>·</span>
          <span>{gen.aspect_ratio === 'auto' ? 'auto' : gen.aspect_ratio}</span>
          {gen.image_url && <><span>·</span><span title="Image-to-video"><ImageIcon size={11} /> ref</span></>}
        </div>
        <div className="vs-card-meta vs-card-meta-sub">
          <span>{fmtDate(gen.created_at)}</span>
          {gen.elapsed_seconds && <><span>·</span><span>{fmtSeconds(gen.elapsed_seconds)}</span></>}
        </div>
        <div className="vs-card-actions">
          {isDone && (
            <button className="vs-card-btn" onClick={onDownload} title="Download">
              <Download size={12} /> Download
            </button>
          )}
          <button className="vs-card-btn vs-card-btn-danger" onClick={onDelete} title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
