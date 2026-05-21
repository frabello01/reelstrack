import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers, Upload, Download, Loader2, AlertCircle, CheckCircle2, X,
  Play, Pause, RotateCcw, Trash2, Image as ImageIcon, FileArchive,
  Settings, Info, ChevronDown, ChevronUp
} from 'lucide-react';
import JSZip from 'jszip';
import { api } from '../lib/api';
import './BatchCleanerPage.css';

// ============================================================
// CONFIGURATION
// ============================================================
const MAX_FILES = 100;
const MAX_FILE_MB = 20;
const CONCURRENCY = 3;        // Match Modal's max_containers
const CLIENT_MAX_DIM = 1536;  // Resize before upload to keep payloads sane

// Per-item statuses
const STATUS = {
  QUEUED: 'queued',
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed',
};

const STATUS_COLOR = {
  queued: '#9ca3af',
  uploading: '#60a5fa',
  processing: '#a78bfa',
  done: '#4ade80',
  failed: '#f87171',
};

const STATUS_LABEL = {
  queued: 'Queued',
  uploading: 'Uploading',
  processing: 'Cleaning',
  done: 'Done',
  failed: 'Failed',
};

// ============================================================
// HELPERS
// ============================================================
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}

// Client-side resize via canvas to keep request payloads reasonable.
// Big phone photos can be 8MP+ — we don't need that much resolution and
// it keeps Render's payload limit happy.
async function resizeImageDataUrl(dataUrl, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (Math.max(width, height) <= maxDim) {
        // No resize needed
        resolve({ dataUrl, width, height, resized: false });
        return;
      }
      const scale = maxDim / Math.max(width, height);
      const newW = Math.round(width * scale);
      const newH = Math.round(height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, newW, newH);

      // Pick output format from the input data URL
      const mimeMatch = dataUrl.match(/^data:([^;]+);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const outMime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
      const quality = outMime === 'image/jpeg' ? 0.92 : undefined;

      const out = canvas.toDataURL(outMime, quality);
      resolve({ dataUrl: out, width: newW, height: newH, resized: true });
    };
    img.onerror = () => reject(new Error('Could not load image for resize'));
    img.src = dataUrl;
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
  const bytes = atob(b64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

function safeFileName(name, fallback = 'image') {
  const base = (name || fallback).replace(/\.[^.]+$/, ''); // strip extension
  return base.replace(/[^a-z0-9_\-. ]/gi, '_').slice(0, 80) || fallback;
}

function bytesToHuman(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ============================================================
// PAGE
// ============================================================
export default function BatchCleanerPage() {
  // Each item: { id, file, name, sizeBytes, previewUrl, status, cleanedDataUrl, error, attempts }
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState('diffusion'); // 'diffusion' | 'metadata-only'
  const [strength, setStrength] = useState(0.04);
  const [steps, setSteps] = useState(50);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [globalError, setGlobalError] = useState('');

  // Use a ref for the queue so the runner sees latest state without re-renders.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const runningRef = useRef(running);
  runningRef.current = running;

  // ============================================================
  // FILE INPUT
  // ============================================================
  const handleFiles = async (fileList) => {
    setGlobalError('');
    const incoming = [...fileList];
    if (items.length + incoming.length > MAX_FILES) {
      setGlobalError(`Max ${MAX_FILES} images total. You'd have ${items.length + incoming.length}.`);
      return;
    }
    const accepted = [];
    for (const file of incoming) {
      if (!file.type.startsWith('image/')) {
        setGlobalError(`Skipping "${file.name}" — not an image.`);
        continue;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        setGlobalError(`"${file.name}" is over ${MAX_FILE_MB} MB — resize first.`);
        continue;
      }
      try {
        const previewUrl = URL.createObjectURL(file);
        accepted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${accepted.length}`,
          file,
          name: file.name,
          sizeBytes: file.size,
          previewUrl,
          status: STATUS.QUEUED,
          cleanedDataUrl: null,
          error: null,
          attempts: 0,
        });
      } catch (e) {
        console.warn('Could not prep file', file.name, e);
      }
    }
    setItems((prev) => [...prev, ...accepted]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleFiles(e.dataTransfer.files);
  };

  const removeItem = (id) => {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target?.previewUrl) {
        try { URL.revokeObjectURL(target.previewUrl); } catch {}
      }
      return prev.filter((i) => i.id !== id);
    });
  };

  const clearAll = () => {
    if (running) return;
    for (const it of items) {
      if (it.previewUrl) {
        try { URL.revokeObjectURL(it.previewUrl); } catch {}
      }
    }
    setItems([]);
  };

  const retryFailed = () => {
    if (running) return;
    setItems((prev) =>
      prev.map((it) =>
        it.status === STATUS.FAILED
          ? { ...it, status: STATUS.QUEUED, error: null }
          : it
      )
    );
  };

  // ============================================================
  // PROCESSING — concurrency pool
  // ============================================================
  // Updates a single item's fields by id.
  const patchItem = (id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  // Process one item end-to-end: read → resize → call API → store result.
  const processItem = async (item) => {
    try {
      patchItem(item.id, { status: STATUS.UPLOADING, error: null });

      // Read file
      const rawDataUrl = await fileToDataUrl(item.file);

      // Resize (skip if metadata-only mode — strip is fast on full res)
      let dataUrl = rawDataUrl;
      if (mode === 'diffusion') {
        const resized = await resizeImageDataUrl(rawDataUrl, CLIENT_MAX_DIM);
        dataUrl = resized.dataUrl;
      }

      patchItem(item.id, { status: STATUS.PROCESSING });

      // Call the existing single-image cleaner endpoint.
      // The endpoint already handles backend resizing too, so the client
      // resize is just to keep the request body sane.
      const body =
        mode === 'metadata-only'
          ? { image_data_url: dataUrl, only_metadata: true }
          : { image_data_url: dataUrl, strength, steps, only_metadata: false };

      const result = await api.cleanImage(body);

      const cleanedDataUrl = result?.cleaned_data_url;
      if (!cleanedDataUrl) throw new Error('No cleaned image returned');

      patchItem(item.id, {
        status: STATUS.DONE,
        cleanedDataUrl,
        attempts: item.attempts + 1,
      });
    } catch (err) {
      patchItem(item.id, {
        status: STATUS.FAILED,
        error: err.message || 'Failed',
        attempts: item.attempts + 1,
      });
    }
  };

  // The runner loop — picks queued items up to CONCURRENCY at a time.
  const runQueue = async () => {
    if (runningRef.current) return; // already running
    setRunning(true);
    setPaused(false);

    // We track in-flight items by id outside of React state for accuracy
    const inFlight = new Set();

    const pickNext = () => {
      // Get the latest items from the ref
      const list = itemsRef.current;
      return list.find(
        (it) => it.status === STATUS.QUEUED && !inFlight.has(it.id)
      );
    };

    const runOne = async (item) => {
      inFlight.add(item.id);
      await processItem(item);
      inFlight.delete(item.id);
    };

    // Loop: while there's queued work and we aren't paused, fill slots
    while (true) {
      if (pausedRef.current) {
        // Wait for unpause
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Fill up to CONCURRENCY
      const workers = [];
      while (inFlight.size < CONCURRENCY) {
        const next = pickNext();
        if (!next) break;
        workers.push(runOne(next));
      }

      if (workers.length === 0) {
        // Nothing in flight, nothing queued — done
        if (inFlight.size === 0) break;
        // Wait for in-flight ones to finish
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Wait for ANY worker to finish, then loop and refill
      await Promise.race(workers.concat(new Promise((r) => setTimeout(r, 50000))));

      // Briefly yield so React state updates flush
      await new Promise((r) => setTimeout(r, 50));
    }

    setRunning(false);
  };

  const handleStart = () => {
    if (!items.some((i) => i.status === STATUS.QUEUED)) {
      setGlobalError('Nothing to process — all items are done, failed, or in progress.');
      return;
    }
    runQueue();
  };

  const handlePauseToggle = () => {
    setPaused((p) => !p);
  };

  // ============================================================
  // ZIP EXPORT
  // ============================================================
  const doneItems = items.filter((i) => i.status === STATUS.DONE && i.cleanedDataUrl);

  const handleDownloadZip = async () => {
    if (doneItems.length === 0) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      // Pad numbering so files sort correctly in any viewer
      const pad = Math.max(2, String(doneItems.length).length);
      doneItems.forEach((item, idx) => {
        const blob = dataUrlToBlob(item.cleanedDataUrl);
        const ext = blob.type === 'image/png' ? 'png'
                  : blob.type === 'image/webp' ? 'webp'
                  : 'jpg';
        const num = String(idx + 1).padStart(pad, '0');
        const base = safeFileName(item.name);
        zip.file(`${num}-${base}-cleaned.${ext}`, blob);
      });
      const out = await zip.generateAsync({ type: 'blob' }, (meta) => {
        // could surface % here if desired
      });
      const url = URL.createObjectURL(out);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
      a.download = `cleaned-images-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      setGlobalError(`ZIP failed: ${err.message}`);
    } finally {
      setZipping(false);
    }
  };

  const handleDownloadOne = (item) => {
    if (!item.cleanedDataUrl) return;
    const blob = dataUrlToBlob(item.cleanedDataUrl);
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(item.name)}-cleaned.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  // ============================================================
  // STATS
  // ============================================================
  const stats = useMemo(() => {
    const counts = {
      total: items.length,
      queued: 0,
      uploading: 0,
      processing: 0,
      done: 0,
      failed: 0,
      bytes: 0,
    };
    for (const it of items) {
      counts[it.status] = (counts[it.status] || 0) + 1;
      counts.bytes += it.sizeBytes || 0;
    }
    counts.percent = items.length
      ? Math.round(((counts.done + counts.failed) / items.length) * 100)
      : 0;
    return counts;
  }, [items]);

  // ============================================================
  // CLEANUP — revoke object URLs on unmount
  // ============================================================
  useEffect(() => {
    return () => {
      for (const it of itemsRef.current) {
        if (it.previewUrl) {
          try { URL.revokeObjectURL(it.previewUrl); } catch {}
        }
      }
    };
  }, []);

  // ============================================================
  // RENDER
  // ============================================================
  const hasItems = items.length > 0;
  const allDoneOrFailed = hasItems && items.every(
    (i) => i.status === STATUS.DONE || i.status === STATUS.FAILED
  );
  const someFailed = items.some((i) => i.status === STATUS.FAILED);

  return (
    <div className="batch-cleaner-page">
      <div className="bc-header">
        <div>
          <h1><Layers size={22} /> Batch Cleaner</h1>
          <p className="subtitle">
            Drop multiple images, clean them all in batches, export as a ZIP.
          </p>
        </div>
      </div>

      {/* Settings card */}
      <div className="bc-card">
        <div className="bc-settings-row">
          <div className="bc-mode-group">
            <label className="bc-mode-label">Mode</label>
            <div className="bc-mode-toggle">
              <button
                type="button"
                className={mode === 'diffusion' ? 'active' : ''}
                onClick={() => setMode('diffusion')}
                disabled={running}
              >
                Diffusion (AI cleaning)
              </button>
              <button
                type="button"
                className={mode === 'metadata-only' ? 'active' : ''}
                onClick={() => setMode('metadata-only')}
                disabled={running}
              >
                Metadata only (fast & free)
              </button>
            </div>
          </div>

          <button
            type="button"
            className="bc-advanced-toggle"
            onClick={() => setShowAdvanced((s) => !s)}
          >
            <Settings size={12} />
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>

        {showAdvanced && mode === 'diffusion' && (
          <div className="bc-advanced">
            <div className="bc-advanced-row">
              <div className="bc-advanced-cell">
                <label>Strength: <strong>{strength.toFixed(3)}</strong></label>
                <input
                  type="range"
                  min="0.01"
                  max="0.20"
                  step="0.005"
                  value={strength}
                  onChange={(e) => setStrength(parseFloat(e.target.value))}
                  disabled={running}
                />
              </div>
              <div className="bc-advanced-cell">
                <label>Diffusion steps: <strong>{steps}</strong></label>
                <input
                  type="range"
                  min="20"
                  max="80"
                  step="5"
                  value={steps}
                  onChange={(e) => setSteps(parseInt(e.target.value, 10))}
                  disabled={running}
                />
              </div>
            </div>
            <p className="bc-hint">
              <strong>Strength</strong> 0.04 is the sweet spot — higher values change the image more visibly.
              <strong> Steps</strong> 50 is the default; higher = better quality but slower.
            </p>
          </div>
        )}

        <div className="bc-hint" style={{ marginTop: 4 }}>
          <Info size={11} />{' '}
          {mode === 'diffusion'
            ? `Diffusion mode runs images through Modal's GPU pipeline (~10-30 sec each, ${CONCURRENCY} at a time). Strips metadata + breaks invisible watermarks.`
            : 'Metadata-only mode strips EXIF/AI generation tags only. Free, instant, but does NOT defeat invisible watermarks like SynthID.'}
        </div>
      </div>

      {/* Drop zone */}
      <div
        className={`bc-dropzone ${hasItems ? 'compact' : ''}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={handleDrop}
        onClick={() => document.getElementById('bc-file-input').click()}
      >
        <Upload size={hasItems ? 18 : 28} />
        <strong>
          {hasItems
            ? `Drop more images or click to browse (${items.length}/${MAX_FILES})`
            : `Drop images here or click to browse`}
        </strong>
        {!hasItems && (
          <p>Up to {MAX_FILES} images. JPG/PNG/WebP. Max {MAX_FILE_MB} MB each. Big phone photos get resized to {CLIENT_MAX_DIM}px max-dim before upload.</p>
        )}
        <input
          id="bc-file-input"
          type="file"
          multiple
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {globalError && (
        <div className="bc-error">
          <AlertCircle size={14} /> {globalError}
        </div>
      )}

      {/* Progress + actions */}
      {hasItems && (
        <div className="bc-progress-card">
          <div className="bc-stats">
            <Stat color={STATUS_COLOR.queued} label="Queued" value={stats.queued} />
            <Stat color={STATUS_COLOR.uploading} label="Uploading" value={stats.uploading} animate={stats.uploading > 0} />
            <Stat color={STATUS_COLOR.processing} label="Cleaning" value={stats.processing} animate={stats.processing > 0} />
            <Stat color={STATUS_COLOR.done} label="Done" value={stats.done} />
            <Stat color={STATUS_COLOR.failed} label="Failed" value={stats.failed} />
            <Stat label="Total" value={`${stats.total} · ${bytesToHuman(stats.bytes)}`} muted />
          </div>

          <div className="bc-progress-bar">
            <div
              className="bc-progress-bar-fill"
              style={{ width: `${stats.percent}%` }}
            />
            <span className="bc-progress-pct">{stats.percent}%</span>
          </div>

          <div className="bc-actions-row">
            {!running ? (
              <button
                className="btn btn-primary"
                onClick={handleStart}
                disabled={stats.queued === 0}
              >
                <Play size={14} /> {stats.queued > 0 ? `Start cleaning (${stats.queued} queued)` : 'Nothing queued'}
              </button>
            ) : (
              <button
                className="btn btn-secondary"
                onClick={handlePauseToggle}
              >
                {paused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}
              </button>
            )}

            {someFailed && !running && (
              <button className="btn btn-secondary" onClick={retryFailed}>
                <RotateCcw size={14} /> Retry failed ({stats.failed})
              </button>
            )}

            {stats.done > 0 && (
              <button
                className="btn btn-primary"
                onClick={handleDownloadZip}
                disabled={zipping}
              >
                {zipping ? (
                  <><Loader2 size={14} className="spin" /> Zipping…</>
                ) : (
                  <><FileArchive size={14} /> Download ZIP ({stats.done})</>
                )}
              </button>
            )}

            <button
              className="btn btn-secondary bc-clear-btn"
              onClick={clearAll}
              disabled={running}
              title="Remove all"
            >
              <Trash2 size={14} /> Clear all
            </button>
          </div>
        </div>
      )}

      {/* Item grid */}
      {hasItems && (
        <div className="bc-grid">
          {items.map((item) => (
            <BatchItemCard
              key={item.id}
              item={item}
              onRemove={() => removeItem(item.id)}
              onDownload={() => handleDownloadOne(item)}
              canRemove={!running || item.status === STATUS.DONE || item.status === STATUS.FAILED}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// STAT CHIP
// ============================================================
function Stat({ color, label, value, muted, animate }) {
  return (
    <div className={`bc-stat ${muted ? 'muted' : ''} ${animate ? 'animate' : ''}`}>
      {color && <span className="bc-stat-dot" style={{ background: color }} />}
      <span className="bc-stat-val">{value}</span>
      <span className="bc-stat-lbl">{label}</span>
    </div>
  );
}

// ============================================================
// ITEM CARD
// ============================================================
function BatchItemCard({ item, onRemove, onDownload, canRemove }) {
  const isDone = item.status === STATUS.DONE;
  const isFailed = item.status === STATUS.FAILED;
  const isWorking = item.status === STATUS.UPLOADING || item.status === STATUS.PROCESSING;
  const color = STATUS_COLOR[item.status];

  // Show the cleaned image if done, otherwise the original preview
  const displayUrl = isDone && item.cleanedDataUrl ? item.cleanedDataUrl : item.previewUrl;

  return (
    <div className={`bc-item ${isDone ? 'done' : ''} ${isFailed ? 'failed' : ''} ${isWorking ? 'working' : ''}`}>
      <div className="bc-item-thumb">
        <img src={displayUrl} alt={item.name} />
        {isWorking && (
          <div className="bc-item-overlay">
            <Loader2 size={20} className="spin" />
          </div>
        )}
        {isDone && (
          <div className="bc-item-done-badge">
            <CheckCircle2 size={11} /> Cleaned
          </div>
        )}
        {isFailed && (
          <div className="bc-item-failed-overlay">
            <AlertCircle size={18} />
          </div>
        )}
      </div>
      <div className="bc-item-body">
        <div className="bc-item-name" title={item.name}>{item.name}</div>
        <div className="bc-item-status">
          <span className="bc-item-status-dot" style={{ background: color }} />
          {STATUS_LABEL[item.status]}
          {item.status === STATUS.QUEUED && (
            <span className="bc-item-size"> · {bytesToHuman(item.sizeBytes)}</span>
          )}
        </div>
        {isFailed && item.error && (
          <div className="bc-item-error" title={item.error}>{item.error}</div>
        )}
        <div className="bc-item-actions">
          {isDone && (
            <button className="bc-item-btn" onClick={onDownload} title="Download this one">
              <Download size={11} />
            </button>
          )}
          {canRemove && (
            <button className="bc-item-btn" onClick={onRemove} title="Remove">
              <X size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
