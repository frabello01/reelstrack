import { useState, useRef } from 'react';
import { Link2, Download, Music, FileVideo, Loader2, AlertCircle, CheckCircle2, Eye, Heart, Play, X } from 'lucide-react';
import { api } from '../lib/api';
import './ConverterPage.css';

function formatNum(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

export default function ConverterPage() {
  const [linkInput, setLinkInput] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [reel, setReel] = useState(null);

  // Buffered MP4 once we download it (so we can convert without re-downloading)
  const [mp4Bytes, setMp4Bytes] = useState(null);
  const [downloadingMp4, setDownloadingMp4] = useState(false);

  const [convertingMp3, setConvertingMp3] = useState(false);
  const [mp3Progress, setMp3Progress] = useState(0); // 0..1
  const [mp3Error, setMp3Error] = useState('');

  const [previewUrl, setPreviewUrl] = useState(null);
  const ffmpegRef = useRef(null);

  // ----- Fetch reel metadata --------------------------------------

  const handleFetch = async (e) => {
    e?.preventDefault();
    if (!linkInput.trim()) return;
    setFetching(true);
    setFetchError('');
    setReel(null);
    setMp4Bytes(null);
    setPreviewUrl(null);
    setMp3Error('');
    try {
      const data = await api.fetchReelForConverter(linkInput.trim());
      setReel(data);
    } catch (err) {
      setFetchError(err.message || 'Could not fetch the reel');
    } finally {
      setFetching(false);
    }
  };

  // ----- Download MP4 ---------------------------------------------

  // Download the bytes once and cache them; subsequent calls reuse.
  const ensureMp4Bytes = async () => {
    if (mp4Bytes) return mp4Bytes;
    if (!reel?.video_url) throw new Error('No video URL available');
    const res = await fetch(reel.video_url);
    if (!res.ok) throw new Error(`Could not download the video (${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    setMp4Bytes(buf);
    return buf;
  };

  const handleDownloadMp4 = async () => {
    setDownloadingMp4(true);
    try {
      const bytes = await ensureMp4Bytes();
      triggerDownload(bytes, `${reel.suggested_filename}.mp4`, 'video/mp4');
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloadingMp4(false);
    }
  };

  // ----- Preview --------------------------------------------------

  const handlePreview = async () => {
    if (previewUrl) {
      setPreviewUrl(null);
      return;
    }
    try {
      const bytes = await ensureMp4Bytes();
      const blob = new Blob([bytes], { type: 'video/mp4' });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      alert(`Preview failed: ${err.message}`);
    }
  };

  // ----- Convert to MP3 -------------------------------------------

  // Lazy-load ffmpeg.wasm (~25 MB on first use) only when needed.
  const loadFfmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    // Dynamic import so the rest of the app stays fast.
    const { createFFmpeg, fetchFile } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = createFFmpeg({
      log: false,
      // Pin to a stable CDN-served core (avoids needing COEP/COOP headers on Vercel)
      corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
      progress: (p) => {
        if (typeof p?.ratio === 'number') {
          // p.ratio is 0..1
          setMp3Progress(Math.max(0, Math.min(1, p.ratio)));
        }
      },
    });
    await ffmpeg.load();
    ffmpegRef.current = { ffmpeg, fetchFile };
    return ffmpegRef.current;
  };

  const handleConvertMp3 = async () => {
    setConvertingMp3(true);
    setMp3Progress(0);
    setMp3Error('');
    try {
      const bytes = await ensureMp4Bytes();
      const { ffmpeg, fetchFile } = await loadFfmpeg();

      const inName = 'input.mp4';
      const outName = 'output.mp3';

      ffmpeg.FS('writeFile', inName, await fetchFile(new Blob([bytes], { type: 'video/mp4' })));
      // -vn: no video, -acodec libmp3lame: MP3, -q:a 2: ~190 kbps quality
      await ffmpeg.run('-i', inName, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outName);
      const out = ffmpeg.FS('readFile', outName);
      // Cleanup virtual FS
      try { ffmpeg.FS('unlink', inName); } catch {}
      try { ffmpeg.FS('unlink', outName); } catch {}

      triggerDownload(out, `${reel.suggested_filename}.mp3`, 'audio/mpeg');
      setMp3Progress(1);
    } catch (err) {
      console.error(err);
      setMp3Error(err.message || 'Conversion failed');
    } finally {
      setConvertingMp3(false);
    }
  };

  return (
    <div className="converter-page">
      <div className="converter-header">
        <h1>Reel Converter</h1>
        <p className="subtitle">Paste any Instagram reel link → download as MP4 or convert to MP3 right in your browser.</p>
      </div>

      <form className="converter-input" onSubmit={handleFetch}>
        <Link2 size={16} className="converter-input-icon" />
        <input
          type="text"
          placeholder="Paste an Instagram reel link (e.g. https://www.instagram.com/reel/ABC123/)"
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          disabled={fetching}
        />
        <button type="submit" className="btn btn-primary" disabled={fetching || !linkInput.trim()}>
          {fetching ? 'Fetching...' : 'Get reel'}
        </button>
      </form>

      {fetchError && (
        <div className="converter-error">
          <AlertCircle size={14} /> {fetchError}
        </div>
      )}

      {reel && (
        <div className="converter-result">
          <div className="reel-preview">
            {reel.thumbnail_url && (
              <div className="reel-preview-thumb">
                <img src={reel.thumbnail_url} alt="" />
              </div>
            )}
            <div className="reel-preview-info">
              <div className="reel-preview-creator">@{reel.username || 'unknown'}</div>
              {reel.full_name && <div className="reel-preview-name">{reel.full_name}</div>}
              {reel.caption && (
                <div className="reel-preview-caption">{reel.caption.substring(0, 200)}{reel.caption.length > 200 ? '…' : ''}</div>
              )}
              <div className="reel-preview-stats">
                {reel.play_count != null && <span><Eye size={12} /> {formatNum(reel.play_count)}</span>}
                {reel.duration_seconds != null && <span>{reel.duration_seconds}s</span>}
              </div>
            </div>
          </div>

          <div className="converter-actions">
            <button className="btn btn-secondary" onClick={handlePreview}>
              {previewUrl ? <X size={14} /> : <Play size={14} />}
              {previewUrl ? 'Close preview' : 'Preview'}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleDownloadMp4}
              disabled={downloadingMp4 || convertingMp3}
            >
              {downloadingMp4 ? <Loader2 size={14} className="spin" /> : <FileVideo size={14} />}
              {downloadingMp4 ? 'Preparing...' : 'Download MP4'}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleConvertMp3}
              disabled={convertingMp3 || downloadingMp4}
            >
              {convertingMp3 ? <Loader2 size={14} className="spin" /> : <Music size={14} />}
              {convertingMp3 ? 'Converting...' : 'Convert to MP3'}
            </button>
          </div>

          {convertingMp3 && (
            <div className="conversion-progress">
              <div className="conversion-progress-bar">
                <div
                  className="conversion-progress-fill"
                  style={{ width: `${Math.round(mp3Progress * 100)}%` }}
                />
              </div>
              <div className="conversion-progress-text">
                {mp3Progress === 0 ? 'Loading converter (first time only ~25 MB)…' : `${Math.round(mp3Progress * 100)}%`}
              </div>
            </div>
          )}
          {mp3Error && (
            <div className="converter-error">
              <AlertCircle size={14} /> {mp3Error}
            </div>
          )}

          {previewUrl && (
            <div className="converter-preview-player">
              <video src={previewUrl} controls autoPlay playsInline />
            </div>
          )}

          <div className="converter-tip">
            <CheckCircle2 size={12} />
            MP3 conversion happens entirely in your browser — nothing is sent to our servers.
            First conversion may take a moment to load the converter (~25 MB, cached afterwards).
          </div>
        </div>
      )}
    </div>
  );
}

function triggerDownload(uint8Array, filename, mimeType) {
  const blob = new Blob([uint8Array], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free memory after a tick (browser still needs the URL to start the download)
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
