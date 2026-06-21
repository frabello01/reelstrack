import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard, Wand2, Upload, X, Image as ImageIcon, Loader2, AlertCircle,
  Trash2, Download, Film, Info, RefreshCw, User, Settings, Plus, ArrowRight,
  Sparkles, Camera,
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
const CREATOR_REF_PREFIX = 'video-studio-creator-refs';

// gpt-image-2 (Step 1) supports only 1:1, 3:2, 2:3
const STEP1_ASPECT_OPTIONS = [
  { value: '2:3', label: '2:3 — Portrait (recommended for reels)' },
  { value: '3:2', label: '3:2 — Landscape' },
  { value: '1:1', label: '1:1 — Square' },
];
const STEP1_QUALITY_OPTIONS = [
  { value: 'high',   label: 'High — best (slower)' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low — fast draft' },
  { value: 'auto',   label: 'Auto' },
];

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
  const [aspectRatio, setAspectRatio] = useState('3:4');
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

  // ---- Step 1 (optional starting-image generator) ----
  const [creators, setCreators] = useState([]);
  const [step1CreatorId, setStep1CreatorId] = useState('');
  const [step1Script, setStep1Script] = useState('');
  const [step1Aspect, setStep1Aspect] = useState('2:3');
  const [step1Quality, setStep1Quality] = useState('high');
  const [step1Generating, setStep1Generating] = useState(false);
  const [step1History, setStep1History] = useState([]);     // persisted gallery, newest first
  const [step1Error, setStep1Error] = useState('');
  const [transferredFromStep1, setTransferredFromStep1] = useState(false);
  const [showCreatorsModal, setShowCreatorsModal] = useState(false);

  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  const selectedCreator = useMemo(
    () => creators.find((c) => c.id === step1CreatorId) || null,
    [creators, step1CreatorId],
  );

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
  useEffect(() => { if (configured) loadCreators(); }, [configured]);
  useEffect(() => { if (configured) loadStep1History(); }, [configured]);

  const loadCreators = async () => {
    try {
      const data = await api.getVideoStudioCreators();
      setCreators(data?.creators || []);
    } catch (err) {
      console.warn('[video-studio] creators load failed:', err.message);
    }
  };

  const loadStep1History = async () => {
    try {
      const data = await api.getStartingImages({ limit: 50 });
      setStep1History(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('[video-studio] step1 history load failed:', err.message);
    }
  };

  // When a creator is selected, snap the Step 1 defaults to that creator's.
  useEffect(() => {
    if (!selectedCreator) return;
    if (selectedCreator.default_aspect_ratio) setStep1Aspect(selectedCreator.default_aspect_ratio);
    if (selectedCreator.default_quality)      setStep1Quality(selectedCreator.default_quality);
  }, [selectedCreator]);

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
    if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setImageUrl('');               // force re-upload on next generate
    setTransferredFromStep1(false); // manual upload supersedes the transfer
  };

  const handleClearImage = () => {
    if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview('');
    setImageUrl('');
    setTransferredFromStep1(false);
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
    // If we already have a public URL (e.g. transferred from Step 1, or
    // re-using a previously uploaded file in the same session), use it
    // directly — no need for a roundtrip.
    if (imageUrl) return imageUrl;
    if (!imageFile) return null;
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
  // STEP 1 — GENERATE STARTING IMAGE
  // ============================================================
  const handleGenerateStartingImage = async () => {
    setStep1Error('');
    if (!step1CreatorId) return setStep1Error('Select a creator first');
    if (!step1Script.trim()) return setStep1Error('Script is required');
    setStep1Generating(true);
    try {
      const row = await api.generateStartingImage({
        creator_id: step1CreatorId,
        script: step1Script.trim(),
        aspect_ratio: step1Aspect,
        quality: step1Quality,
      });
      // Prepend to the gallery so the user sees the new image immediately
      if (row?.id) setStep1History((h) => [row, ...h.filter((x) => x.id !== row.id)]);
    } catch (err) {
      setStep1Error(err.message || 'Generation failed');
    } finally {
      setStep1Generating(false);
    }
  };

  // Transfer a Step 1 image to Step 2 — bypasses upload because the
  // image is already at a public URL in our generated-images bucket.
  const handleTransferToStep2 = (row) => {
    if (!row?.image_url) return;
    if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(row.image_url);
    setImageUrl(row.image_url);
    setTransferredFromStep1(true);
    setError('');
    setTimeout(() => {
      document.getElementById('vs-step2-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const handleDeleteStep1 = async (row) => {
    if (!confirm('Eliminare questa immagine? Non potrai recuperarla.')) return;
    try {
      await api.deleteStartingImage(row.id);
      setStep1History((h) => h.filter((x) => x.id !== row.id));
      // If this image was active in Step 2, clear it
      if (imageUrl === row.image_url) {
        handleClearImage();
      }
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
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

      {/* ============================================================
          STEP 1 — generate a starting image with gpt-image-2 from a
          creator's fixed reference photos + a per-shoot script.
          Optional: you can skip and upload an image directly to Step 2.
          ============================================================ */}
      <div className="vs-step1-card">
        <div className="vs-step-header">
          <div className="vs-step-badge">Step 1 · Optional</div>
          <h2 className="vs-step-title">
            <Camera size={16} /> Generate starting image
            <span className="vs-step-model">openai/gpt-image-2</span>
          </h2>
        </div>

        <div className="vs-step1-row">
          <div className="vs-step1-col">
            <label className="vs-label-row">
              <span><User size={12} /> Creator</span>
              <button
                type="button"
                className="vs-manage-btn"
                onClick={() => setShowCreatorsModal(true)}
                title="Manage creators (reference photos)"
              >
                <Settings size={12} /> Manage
              </button>
            </label>
            <select
              className="vs-select-block"
              value={step1CreatorId}
              onChange={(e) => setStep1CreatorId(e.target.value)}
              disabled={step1Generating}
            >
              <option value="">— pick a creator —</option>
              {creators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({(c.reference_image_urls || []).length} foto)
                </option>
              ))}
            </select>

            {selectedCreator && (
              <div className="vs-ref-grid">
                {(selectedCreator.reference_image_urls || []).map((u, i) => (
                  <div key={i} className="vs-ref-thumb">
                    <img src={u} alt={`ref ${i + 1}`} />
                  </div>
                ))}
              </div>
            )}
            {!selectedCreator && creators.length === 0 && (
              <div className="vs-step1-hint">
                Nessun creator ancora. Clicca <strong>Manage</strong> per crearne uno con almeno 1 foto reference.
              </div>
            )}
          </div>

          <div className="vs-step1-col">
            <label className="vs-label-row">
              <span><Sparkles size={12} /> Script</span>
              <span className={`vs-counter ${step1Script.length > 600 ? 'warn' : ''}`}>
                {step1Script.length}/800
              </span>
            </label>
            <textarea
              className="vs-textarea"
              placeholder='es. "in spiaggia al tramonto, costume rosso, sguardo in camera, light golden hour"'
              value={step1Script}
              onChange={(e) => setStep1Script(e.target.value.slice(0, 800))}
              disabled={step1Generating}
              rows={4}
            />
            <div className="vs-step1-hint">
              <Sparkles size={11} /> Lo script viene riscritto da gpt-5-mini in un prompt fotografico ottimizzato.
            </div>

            <div className="vs-row vs-row-tight">
              <div className="vs-cell">
                <label>Aspect ratio</label>
                <select value={step1Aspect} onChange={(e) => setStep1Aspect(e.target.value)} disabled={step1Generating}>
                  {STEP1_ASPECT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="vs-cell">
                <label>Quality</label>
                <select value={step1Quality} onChange={(e) => setStep1Quality(e.target.value)} disabled={step1Generating}>
                  {STEP1_QUALITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {step1Error && <div className="vs-error"><AlertCircle size={14} /> {step1Error}</div>}

            <button
              className="btn btn-primary vs-step1-btn"
              onClick={handleGenerateStartingImage}
              disabled={step1Generating || !step1CreatorId || !step1Script.trim()}
            >
              {step1Generating
                ? <><Loader2 size={14} className="spin" /> Generazione… (~30s)</>
                : <><Wand2 size={14} /> Generate image</>}
            </button>
          </div>
        </div>

        {step1History.length > 0 && (
          <div className="vs-step1-gallery-wrap">
            <div className="vs-step1-gallery-header">
              <span className="vs-step1-gallery-label">
                Generate ({step1History.length})
              </span>
              <button className="vs-refresh-btn" onClick={loadStep1History} title="Aggiorna">
                <RefreshCw size={12} />
              </button>
            </div>
            <div className="vs-step1-gallery">
              {step1History.map((row) => {
                const isActive = transferredFromStep1 && imageUrl === row.image_url;
                const isFailed = row.status === 'failed' || row.status === 'nsfw';
                return (
                  <div key={row.id} className={`vs-step1-tile ${isActive ? 'vs-step1-tile-active' : ''} ${isFailed ? 'vs-step1-tile-failed' : ''}`}>
                    <div className="vs-step1-tile-media">
                      {row.image_url ? (
                        <img src={row.image_url} alt={row.script || 'starting image'} />
                      ) : isFailed ? (
                        <div className="vs-step1-tile-failed-box">
                          <AlertCircle size={22} />
                          <span>{row.status}</span>
                        </div>
                      ) : (
                        <div className="vs-step1-tile-failed-box">
                          <Loader2 size={22} className="spin" />
                        </div>
                      )}
                      {isActive && (
                        <div className="vs-step1-tile-active-badge">
                          <Camera size={11} /> in Step 2
                        </div>
                      )}
                    </div>
                    <div className="vs-step1-tile-body">
                      <div className="vs-step1-tile-meta">
                        <strong>{row.creator_name || '—'}</strong>
                        <span>· {fmtDate(row.created_at)}</span>
                      </div>
                      <p className="vs-step1-tile-script" title={row.script}>
                        {(row.script || '').slice(0, 140)}
                        {(row.script || '').length > 140 ? '…' : ''}
                      </p>
                      {isFailed && row.error_message && (
                        <p className="vs-step1-tile-error" title={row.error_message}>
                          {row.error_message.slice(0, 100)}
                        </p>
                      )}
                      <div className="vs-step1-tile-actions">
                        {row.image_url && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleTransferToStep2(row)}
                            disabled={isActive}
                            title="Usa come immagine di partenza per Step 2"
                          >
                            {isActive ? <><Camera size={12} /> Attiva</> : <>Use in Step 2 <ArrowRight size={12} /></>}
                          </button>
                        )}
                        {row.image_url && (
                          <a
                            className="vs-card-btn"
                            href={row.image_url}
                            download={`starting-${row.id.slice(0, 8)}.webp`}
                            rel="noopener noreferrer"
                            target="_blank"
                            title="Download"
                          >
                            <Download size={12} />
                          </a>
                        )}
                        <button
                          className="vs-card-btn vs-card-btn-danger"
                          onClick={() => handleDeleteStep1(row)}
                          title="Elimina"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================
          STEP 2 — animate the starting image with xAI Grok Imagine.
          ============================================================ */}
      <div className="vs-form-card" id="vs-step2-card">
        <div className="vs-step-header vs-step-header-inline">
          <div className="vs-step-badge vs-step-badge-active">Step 2</div>
          <h2 className="vs-step-title">
            <Film size={16} /> Generate video
            <span className="vs-step-model">xai/grok-imagine-video</span>
          </h2>
        </div>

        {/* === Reference image === */}
        <div className="vs-section">
          <div className="vs-section-label">
            <ImageIcon size={14} />
            Reference image <span className="vs-optional">(optional — image-to-video)</span>
            {transferredFromStep1 && (
              <span className="vs-transferred-badge">
                <Sparkles size={11} /> from Step 1
              </span>
            )}
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
                {imageFile
                  ? <>{imageFile.name} · {(imageFile.size / 1024 / 1024).toFixed(1)} MB</>
                  : transferredFromStep1
                    ? <>Transferred from Step 1</>
                    : <>External image</>}
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
          <div className="vs-step1-hint">
            <Sparkles size={11} /> Riscritto da gpt-5-mini per image-to-video + vincolo hardcoded <strong>camera fissa</strong> (no zoom/pan/dolly).
          </div>
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

      {showCreatorsModal && (
        <CreatorsManagerModal
          creators={creators}
          onClose={() => setShowCreatorsModal(false)}
          onChange={loadCreators}
        />
      )}
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

// ============================================================
// CREATORS MANAGER MODAL — list, create, edit, delete the per-creator
// reference photo sets used by Step 1 of the Video Studio.
// ============================================================
function CreatorsManagerModal({ creators, onClose, onChange }) {
  const [editing, setEditing] = useState(null);  // creator being edited (null = list view)
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async (c) => {
    if (!confirm(`Eliminare il creator "${c.name}" e tutte le sue foto reference? (i video già generati restano)`)) return;
    try {
      await api.deleteVideoStudioCreator(c.id);
      onChange();
    } catch (err) { alert(err.message); }
  };

  return (
    <div className="vs-modal-backdrop" onClick={onClose}>
      <div className="vs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vs-modal-header">
          <h2>
            <User size={18} />
            {editing || creating ? (editing ? `Modifica: ${editing.name}` : 'Nuovo creator') : 'Video Studio creators'}
          </h2>
          <button className="vs-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {!editing && !creating ? (
          <div className="vs-modal-body">
            {creators.length === 0 ? (
              <div className="vs-modal-empty">
                Nessun creator ancora. Crea il primo per usare lo Step 1 con set di foto reference fissi.
              </div>
            ) : (
              <div className="vs-creators-list">
                {creators.map((c) => (
                  <div key={c.id} className="vs-creator-row">
                    <div className="vs-creator-thumbs">
                      {(c.reference_image_urls || []).slice(0, 4).map((u, i) => (
                        <img key={i} src={u} alt="" />
                      ))}
                      {(c.reference_image_urls || []).length > 4 && (
                        <div className="vs-creator-thumb-more">+{c.reference_image_urls.length - 4}</div>
                      )}
                    </div>
                    <div className="vs-creator-info">
                      <strong>{c.name}</strong>
                      <span className="vs-creator-meta">
                        {(c.reference_image_urls || []).length} foto · default {c.default_aspect_ratio} · {c.default_quality}
                      </span>
                      {c.notes && <span className="vs-creator-notes">{c.notes}</span>}
                    </div>
                    <div className="vs-creator-actions">
                      <button className="vs-card-btn" onClick={() => setEditing(c)} title="Modifica">
                        <Settings size={12} /> Edit
                      </button>
                      <button className="vs-card-btn vs-card-btn-danger" onClick={() => handleDelete(c)} title="Elimina">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button className="btn btn-primary vs-creators-new-btn" onClick={() => setCreating(true)}>
              <Plus size={14} /> Nuovo creator
            </button>
          </div>
        ) : (
          <CreatorEditor
            initial={editing}
            onSaved={() => { setEditing(null); setCreating(false); onChange(); }}
            onCancel={() => { setEditing(null); setCreating(false); setError(''); }}
            onError={setError}
          />
        )}

        {error && <div className="vs-error" style={{ margin: '0 20px 16px' }}>{error}</div>}
      </div>
    </div>
  );
}

// Inline editor for a single creator (used for both "new" and "edit").
function CreatorEditor({ initial, onSaved, onCancel, onError }) {
  const [name, setName] = useState(initial?.name || '');
  const [refs, setRefs] = useState(initial?.reference_image_urls || []);
  const [aspect, setAspect] = useState(initial?.default_aspect_ratio || '2:3');
  const [quality, setQuality] = useState(initial?.default_quality || 'high');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const uploadFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const uploaded = [];
    for (const file of files) {
      if (!/image\/(jpe?g|png|webp)/i.test(file.type)) continue;
      if (file.size > MAX_IMAGE_MB * 1024 * 1024) continue;
      try {
        const ext = file.type.includes('png') ? 'png' : file.type.includes('webp') ? 'webp' : 'jpg';
        const path = `${CREATOR_REF_PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(REF_BUCKET)
          .upload(path, file, { contentType: file.type, cacheControl: '604800', upsert: false });
        if (upErr) { onError?.(upErr.message); continue; }
        const { data: pub } = supabase.storage.from(REF_BUCKET).getPublicUrl(path);
        if (pub?.publicUrl) uploaded.push(pub.publicUrl);
      } catch (err) { onError?.(err.message); }
    }
    setRefs((r) => [...r, ...uploaded].slice(0, 16));
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeRef = (i) => setRefs((r) => r.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!name.trim()) return onError?.('Nome richiesto');
    if (refs.length < 1) return onError?.('Almeno 1 foto reference');
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        reference_image_urls: refs,
        default_aspect_ratio: aspect,
        default_quality: quality,
        notes: notes.trim() || null,
      };
      if (initial?.id) {
        await api.updateVideoStudioCreator(initial.id, payload);
      } else {
        await api.createVideoStudioCreator(payload);
      }
      onSaved();
    } catch (err) {
      onError?.(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="vs-modal-body">
      <label className="vs-label-row"><span>Nome</span></label>
      <input
        className="vs-modal-input"
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 100))}
        placeholder="es. Giulia, Sofia, etc."
      />

      <label className="vs-label-row vs-mt">
        <span>Foto reference ({refs.length}/16)</span>
        <span className="vs-creator-meta">jpg/png/webp · max {MAX_IMAGE_MB} MB ciascuna</span>
      </label>
      <div className="vs-ref-grid vs-ref-grid-editable">
        {refs.map((u, i) => (
          <div key={i} className="vs-ref-thumb">
            <img src={u} alt={`ref ${i + 1}`} />
            <button className="vs-ref-thumb-remove" onClick={() => removeRef(i)} title="Rimuovi">
              <X size={11} />
            </button>
          </div>
        ))}
        <button
          className="vs-ref-add"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || refs.length >= 16}
        >
          {uploading ? <Loader2 size={18} className="spin" /> : <Plus size={18} />}
          <span>{uploading ? 'Upload…' : 'Aggiungi'}</span>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(e) => uploadFiles(Array.from(e.target.files || []))}
        style={{ display: 'none' }}
      />

      <div className="vs-row vs-row-tight vs-mt">
        <div className="vs-cell">
          <label>Aspect default</label>
          <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
            {STEP1_ASPECT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="vs-cell">
          <label>Quality default</label>
          <select value={quality} onChange={(e) => setQuality(e.target.value)}>
            {STEP1_QUALITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <label className="vs-label-row vs-mt"><span>Note (opzionali)</span></label>
      <textarea
        className="vs-textarea"
        value={notes}
        onChange={(e) => setNotes(e.target.value.slice(0, 500))}
        placeholder="Note interne — es. 'questi sono i set di Giulia da OF'"
        rows={2}
      />

      <div className="vs-modal-footer">
        <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>Annulla</button>
        <button className="btn btn-primary" onClick={save} disabled={saving || !name.trim() || refs.length < 1}>
          {saving ? <><Loader2 size={14} className="spin" /> Salvataggio…</> : 'Salva'}
        </button>
      </div>
    </div>
  );
}
