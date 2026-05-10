import { useState } from 'react';
import { Link2, Loader2, AlertCircle, FileVideo, Music, Eye, Play, X } from 'lucide-react';
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

  const [mp4Bytes, setMp4Bytes] = useState(null);
  const [downloadingMp4, setDownloadingMp4] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [convertingMp3, setConvertingMp3] = useState(false);
  const [mp3Error, setMp3Error] = useState('');

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

  const handleConvertMp3 = async () => {
    setConvertingMp3(true);
    setMp3Error('');
    try {
      // Server does the conversion via ConvertHub (~5-15 sec).
      const { mp3_url, filename } = await api.convertReelToMp3(linkInput.trim());
      // Browser fetches the MP3 from ConvertHub's CDN and triggers a download.
      const res = await fetch(mp3_url);
      if (!res.ok) throw new Error(`Could not download MP3 (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `${reel.suggested_filename}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setMp3Error(err.message || 'MP3 conversion failed');
    } finally {
      setConvertingMp3(false);
    }
  };

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

  return (
    <div className="converter-page">
      <div className="converter-header">
        <h1>Reel Converter</h1>
        <p className="subtitle">Paste any Instagram reel link → preview and download as MP4.</p>
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
              title="Extract audio as MP3 (takes ~5-15 sec)"
            >
              {convertingMp3 ? <Loader2 size={14} className="spin" /> : <Music size={14} />}
              {convertingMp3 ? 'Converting...' : 'Download MP3'}
            </button>
          </div>

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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
