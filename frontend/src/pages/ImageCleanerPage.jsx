import { useEffect, useRef, useState } from 'react';
import {
  Sparkles, Upload, Image as ImageIcon, Download, Loader2, AlertCircle,
  CheckCircle2, X, ShieldCheck, Wand2, ChevronDown, ChevronUp
} from 'lucide-react';
import { api } from '../lib/api';
import './ImageCleanerPage.css';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

// Read a File as a base64 data URL
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

// Trigger a browser download of a data URL
function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function ImageCleanerPage() {
  const fileInputRef = useRef(null);
  const [models, setModels] = useState([]);
  const [configured, setConfigured] = useState(false);
  const [modelId, setModelId] = useState('dreamshaper-v8');
  const [strength, setStrength] = useState(0.04);
  const [steps, setSteps] = useState(50);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [inputFile, setInputFile] = useState(null);
  const [inputDataUrl, setInputDataUrl] = useState(null);
  const [outputDataUrl, setOutputDataUrl] = useState(null);
  const [outputMode, setOutputMode] = useState(null); // 'metadata-only' | 'diffusion'
  const [resizeNotice, setResizeNotice] = useState(null); // { from, to } when image was resized
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getImageCleanerModels()
      .then((data) => {
        setModels(data.models || []);
        setConfigured(data.configured);
      })
      .catch((err) => console.error('[image-cleaner] could not load models:', err.message));
  }, []);

  const reset = () => {
    setInputFile(null);
    setInputDataUrl(null);
    setOutputDataUrl(null);
    setOutputMode(null);
    setResizeNotice(null);
    setError('');
  };

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setOutputDataUrl(null);
    setOutputMode(null);
    setResizeNotice(null);

    if (!file.type.startsWith('image/')) {
      return setError('Please choose an image file (PNG, JPG, or WebP).');
    }
    if (file.size > MAX_INPUT_BYTES) {
      return setError(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_INPUT_BYTES / 1024 / 1024} MB.`);
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setInputFile(file);
      setInputDataUrl(dataUrl);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  const handleClean = async (onlyMetadata = false) => {
    if (!inputDataUrl) return;
    setProcessing(true);
    setError('');
    setOutputDataUrl(null);
    setOutputMode(null);
    setResizeNotice(null);
    try {
      const body = onlyMetadata
        ? { image_data_url: inputDataUrl, only_metadata: true }
        : { image_data_url: inputDataUrl, model_id: modelId, strength, steps };
      const response = await api.cleanImage(body);
      setOutputDataUrl(response.cleaned_data_url);
      setOutputMode(response.mode);
      if (response.resized && response.original_dims && response.new_dims) {
        setResizeNotice({
          from: `${response.original_dims.w}×${response.original_dims.h}`,
          to: `${response.new_dims.w}×${response.new_dims.h}`,
        });
      }
    } catch (err) {
      setError(err.message || 'Cleaning failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!outputDataUrl || !inputFile) return;
    const dot = inputFile.name.lastIndexOf('.');
    const stem = dot > 0 ? inputFile.name.slice(0, dot) : inputFile.name;
    const ext = dot > 0 ? inputFile.name.slice(dot) : '.png';
    downloadDataUrl(outputDataUrl, `${stem}-clean${ext}`);
  };

  return (
    <div className="image-cleaner">
      <div className="image-cleaner-header">
        <h1><Wand2 size={22} /> AI Image Cleaner</h1>
        <p className="subtitle">
          Strip AI provenance metadata (EXIF, C2PA, PNG text chunks) and optionally
          re-generate via diffusion to remove invisible watermarks like SynthID.
        </p>
      </div>

      {!configured && (
        <div className="image-cleaner-notice">
          <AlertCircle size={14} />
          <span>
            Replicate isn't configured yet. Add <code>REPLICATE_API_TOKEN</code> on Render
            to enable diffusion cleaning. "Metadata only" mode works without it.
          </span>
        </div>
      )}

      {/* Drop zone */}
      {!inputDataUrl ? (
        <div
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={32} />
          <h3>Drag &amp; drop an image</h3>
          <p>or click to choose · PNG, JPG, WebP · max 8 MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="cleaner-workspace">
          {/* Two-pane preview */}
          <div className="cleaner-previews">
            <div className="cleaner-pane">
              <div className="cleaner-pane-label">
                <ImageIcon size={13} /> Original
                <button className="reset-btn" onClick={reset} title="Choose a different image">
                  <X size={13} />
                </button>
              </div>
              <div className="cleaner-pane-imgwrap">
                <img src={inputDataUrl} alt="Input" />
              </div>
              <div className="cleaner-pane-meta">
                {inputFile && (
                  <>{inputFile.name} · {(inputFile.size / 1024).toFixed(0)} KB</>
                )}
              </div>
            </div>

            <div className="cleaner-pane">
              <div className="cleaner-pane-label">
                <Sparkles size={13} /> Cleaned
                {outputMode && (
                  <span className={`cleaner-mode-badge ${outputMode}`}>
                    {outputMode === 'diffusion' ? 'Diffusion + metadata' : 'Metadata only'}
                  </span>
                )}
              </div>
              <div className="cleaner-pane-imgwrap">
                {processing ? (
                  <div className="cleaner-loading">
                    <Loader2 size={28} className="spin" />
                    <p>Processing…</p>
                    <p className="cleaner-loading-detail">
                      This can take 10-30 seconds.
                    </p>
                  </div>
                ) : outputDataUrl ? (
                  <img src={outputDataUrl} alt="Cleaned" />
                ) : (
                  <div className="cleaner-placeholder">
                    <ShieldCheck size={28} />
                    <p>Click "Clean" below</p>
                  </div>
                )}
              </div>
              {outputDataUrl && !processing && (
                <button className="btn btn-primary cleaner-download-btn" onClick={handleDownload}>
                  <Download size={13} /> Download cleaned image
                </button>
              )}
            </div>
          </div>

          {/* Settings & actions */}
          <div className="cleaner-settings">
            <div className="cleaner-setting-row">
              <label>Model:</label>
              <select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={processing}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="cleaner-advanced-toggle"
              onClick={() => setShowAdvanced((s) => !s)}
            >
              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Advanced settings
            </button>

            {showAdvanced && (
              <div className="cleaner-advanced">
                <div className="cleaner-setting-row">
                  <label>
                    Strength: <strong>{strength.toFixed(2)}</strong>
                  </label>
                  <input
                    type="range"
                    min="0.01"
                    max="0.5"
                    step="0.01"
                    value={strength}
                    onChange={(e) => setStrength(parseFloat(e.target.value))}
                    disabled={processing}
                  />
                </div>
                <p className="cleaner-hint">
                  Lower = image stays closer to original. 0.04 is the noai-watermark default and works for most SynthID cases.
                </p>

                <div className="cleaner-setting-row">
                  <label>
                    Steps: <strong>{steps}</strong>
                  </label>
                  <input
                    type="range"
                    min="20"
                    max="80"
                    step="5"
                    value={steps}
                    onChange={(e) => setSteps(parseInt(e.target.value, 10))}
                    disabled={processing}
                  />
                </div>
              </div>
            )}

            <div className="cleaner-actions">
              <button
                className="btn btn-primary"
                onClick={() => handleClean(false)}
                disabled={processing || !configured}
                title={!configured ? 'Replicate not configured' : 'Run diffusion + metadata strip'}
              >
                {processing ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
                {processing ? 'Cleaning…' : 'Clean image (diffusion)'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handleClean(true)}
                disabled={processing}
                title="Strip metadata only — fast, free, no Replicate"
              >
                <ShieldCheck size={13} /> Metadata only (free)
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="image-cleaner-error">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {outputDataUrl && !processing && (
        <div className="cleaner-success">
          <CheckCircle2 size={14} />
          <span>
            Cleaned successfully{' '}
            {outputMode === 'diffusion' ? (
              <>via diffusion (cost ~$0.003) plus metadata strip.</>
            ) : (
              <>via metadata strip (free).</>
            )}
            {resizeNotice && (
              <>
                {' '}Image was resized from <strong>{resizeNotice.from}</strong> to{' '}
                <strong>{resizeNotice.to}</strong> before diffusion (SD models work
                best at ≤1024px).
              </>
            )}
          </span>
        </div>
      )}

      <div className="cleaner-info">
        <h3>What this removes</h3>
        <ul>
          <li><strong>EXIF tags</strong> — camera info, GPS coordinates, software used</li>
          <li><strong>PNG text chunks</strong> — prompts, seeds, models, ComfyUI workflows</li>
          <li><strong>C2PA manifests</strong> — Google Imagen, OpenAI, Adobe Firefly, Microsoft Designer provenance</li>
          <li><strong>XMP metadata</strong> — additional AI provenance fields</li>
        </ul>
        <h3>What diffusion adds</h3>
        <ul>
          <li><strong>SynthID disruption</strong> — invisible pixel watermarks from Google AI</li>
          <li><strong>StableSignature / TreeRing</strong> — similar invisible watermarks</li>
          <li>The image re-generates through Stable Diffusion at low strength so it looks the same but the watermark signal is broken</li>
        </ul>
      </div>
    </div>
  );
}
