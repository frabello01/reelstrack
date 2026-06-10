import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ExternalLink, Eye, Heart, StickyNote, CheckCircle2, Play, Flame,
  Upload, Trash2, FilmIcon, Loader2, AlertCircle, X, CheckCircle, Video,
} from 'lucide-react';
import { api } from '../lib/api';
import './PublicTodoPage.css';

const MAX_FILE_BYTES = 500 * 1024 * 1024;
function humanSize(b) {
  if (!b) return '';
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// PUT a file to a Drive resumable session URL with progress reporting.
// Returns the parsed Drive response on success.
function putWithProgress(sessionUrl, file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUrl, true);
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { resolve({}); }
      } else {
        reject(new Error(`Drive upload failed (HTTP ${xhr.status}): ${xhr.responseText?.slice(0, 200) || ''}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    if (signal) {
      signal.addEventListener('abort', () => xhr.abort());
    }
    xhr.send(file);
  });
}

function formatViews(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

export default function PublicTodoPage() {
  const { token } = useParams();
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playingVideoUrl, setPlayingVideoUrl] = useState(null);
  const [agency, setAgency] = useState(null);

  // Load agency branding once on mount (independent from list)
  useEffect(() => {
    api.getPublicAgency().then(setAgency).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setList(await api.getPublicTodo(token));
    } catch (err) {
      setError(err.message || 'Could not load this list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const toggleDone = async (item) => {
    // Optimistic update
    setList((l) => ({
      ...l,
      items: l.items.map((it) => it.id === item.id ? { ...it, is_done: !it.is_done } : it),
    }));
    try {
      await api.togglePublicReelDone(token, item.reels.id, !item.is_done);
    } catch (err) {
      // Revert on error
      load();
    }
  };

  if (loading) return <div className="public-loading"><div className="spinner" /></div>;
  if (error || !list) {
    return (
      <div className="public-page">
        <div className="public-error">
          <h1>List not found</h1>
          <p>{error || 'This share link is invalid or the list has been deleted.'}</p>
        </div>
      </div>
    );
  }

  const doneCount = list.items.filter((i) => i.is_done).length;
  const total = list.items.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="public-page">
      <div className="public-container">
        <header className="public-header">
          <img
            src={agency?.agency_logo_url || '/logo.png'}
            alt={agency?.display_name || 'Creator Advisor'}
            className="public-logo"
          />
          <h1>{list.name}</h1>
          <div className="public-progress">
            <div className="public-progress-bar">
              <div className="public-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="public-progress-text">{doneCount} of {total} done</div>
          </div>
        </header>

        {list.public_note && (
          <div className="public-list-note">
            <StickyNote size={14} />
            <p>{list.public_note}</p>
          </div>
        )}

        {list.items.length === 0 ? (
          <div className="public-empty">
            <p>No reels in this list yet.</p>
          </div>
        ) : (
          <div className="public-items">
            {(() => {
              // Stable rank: based on order reels were added (newest = #1).
              // Visible order may shuffle by priority but rank stays tied to insertion.
              const byAddedDesc = [...list.items].sort((a, b) =>
                new Date(b.added_at) - new Date(a.added_at)
              );
              const rankByReelId = new Map();
              byAddedDesc.forEach((it, i) => {
                if (it.reels?.id) rankByReelId.set(it.reels.id, i + 1);
              });
              return list.items.map((item) => {
              const reel = item.reels;
              const hasBackup = reel?.backup_status === 'done' && reel?.backup_video_url;
              const thumbSrc = reel?.backup_thumbnail_url || reel?.thumbnail_url;
              return (
                <div key={item.id} className={`public-item ${item.is_done ? 'done' : ''}`}>
                  <button
                    className="public-checkbox"
                    onClick={() => toggleDone(item)}
                    aria-label={item.is_done ? 'Mark as not done' : 'Mark as done'}
                  >
                    {item.is_done ? <CheckCircle2 size={22} /> : <div className="public-checkbox-empty" />}
                  </button>
                  <div className="public-item-rank-col">
                    <div className="public-item-rank">#{rankByReelId.get(reel?.id) ?? '?'}</div>
                    {item.priority === 3 && (
                      <div className="public-priority-badge public-priority-high" title="High priority">
                        <Flame size={10} /> HIGH
                      </div>
                    )}
                    {item.priority === 1 && (
                      <div className="public-priority-badge public-priority-low" title="Low priority">
                        LOW
                      </div>
                    )}
                  </div>
                  <div className="public-item-thumb">
                    {thumbSrc && <img src={thumbSrc} alt="" />}
                  </div>
                  <div className="public-item-info">
                    <div className="public-item-creator">
                      {reel?.creators?.username ? `@${reel.creators.username}` : 'Reel'}
                    </div>
                    {reel?.caption && (
                      <div className="public-item-caption">
                        {reel.caption.substring(0, 100)}
                      </div>
                    )}
                    <div className="public-item-stats">
                      <span><Eye size={12} /> {formatViews(reel?.views)}</span>
                      <span><Heart size={12} /> {formatViews(reel?.likes)}</span>
                    </div>
                    {item.public_note && (
                      <div className="public-note">
                        <StickyNote size={12} />
                        <span>{item.public_note}</span>
                      </div>
                    )}
                  </div>
                  <div className="public-item-actions">
                    <a
                      href={reel?.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="public-item-link"
                      aria-label="Open reel on Instagram"
                      title="Open on Instagram"
                    >
                      <ExternalLink size={16} />
                    </a>
                    {hasBackup && (
                      <button
                        className="public-item-link public-play-btn"
                        onClick={() => setPlayingVideoUrl(reel.backup_video_url)}
                        aria-label="Play backup video"
                        title="Play backup video (works even if reel is removed from IG)"
                      >
                        <Play size={16} />
                      </button>
                    )}
                  </div>
                  {list.creator_uploads_enabled && (
                    <ClipUploadStrip
                      token={token}
                      item={item}
                      onChange={(patch) => {
                        // Update just this item without a full reload (smooth UX)
                        setList((l) => ({
                          ...l,
                          items: l.items.map((it) =>
                            it.id === item.id ? { ...it, ...patch } : it
                          ),
                        }));
                      }}
                    />
                  )}
                </div>
              );
              });
            })()}
          </div>
        )}

        {playingVideoUrl && (
          <div className="video-modal" onClick={() => setPlayingVideoUrl(null)}>
            <div className="video-modal-content" onClick={(e) => e.stopPropagation()}>
              <button className="video-modal-close" onClick={() => setPlayingVideoUrl(null)}>×</button>
              <video src={playingVideoUrl} controls autoPlay playsInline />
            </div>
          </div>
        )}

        <footer className="public-footer">
          <p>Tap the circle to mark a reel as done.</p>
        </footer>
      </div>
    </div>
  );
}

// ============================================================
// ClipUploadStrip â€” per-reel upload zone for the public page.
// Lazily loads existing clips; drag/drop or click to upload more.
// ============================================================
function ClipUploadStrip({ token, item, onChange }) {
  const [clips, setClips] = useState(null);   // null = not loaded yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // queue of in-flight uploads: [{ tempId, file, progress, error }]
  const [pending, setPending] = useState([]);
  const inputRef = useRef(null);

  const reload = async () => {
    setLoading(true);
    try {
      const list = await api.listCreatorUploads(token, item.id);
      setClips(list || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Load on first mount only if there is something to load
    if ((item.uploads_count || 0) > 0 && clips === null) {
      reload();
    } else if (clips === null) {
      setClips([]);
    }
  }, []);

  const handleFiles = async (files) => {
    if (!files || !files.length) return;
    setError('');
    for (const file of files) {
      if (!/^video\//i.test(file.type)) {
        setError(`"${file.name}" non Ã¨ un file video.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(`"${file.name}" supera i 500 MB.`);
        continue;
      }
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPending((p) => [...p, { tempId, file, progress: 0, error: null }]);

      try {
        // 1) Ask backend for a Drive resumable session URL
        const { session_url, filename, version } = await api.initCreatorUpload(token, item.id, {
          filename: file.name,
          mime_type: file.type || 'video/mp4',
          size_bytes: file.size,
        });

        // 2) PUT the file directly to Drive
        const driveResp = await putWithProgress(
          session_url,
          file,
          (pct) => setPending((p) => p.map((x) => x.tempId === tempId ? { ...x, progress: pct } : x))
        );

        // 3) Tell backend the upload completed
        const completeResp = await api.completeCreatorUpload(token, item.id, {
          drive_file_id: driveResp.id,
          drive_file_name: driveResp.name || filename,
          size_bytes: driveResp.size ? Number(driveResp.size) : file.size,
          mime_type: driveResp.mimeType || file.type,
          version,
        });

        // 4) Local-state mutate: add to clips, bump count, mark done if first
        setClips((c) => [...(c || []), completeResp.upload]);
        onChange?.({
          uploads_count: (item.uploads_count || 0) + 1,
          is_done: completeResp.became_done ? true : item.is_done,
        });
        setPending((p) => p.filter((x) => x.tempId !== tempId));
      } catch (err) {
        setPending((p) => p.map((x) =>
          x.tempId === tempId ? { ...x, error: err.message } : x
        ));
      }
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('public-clip-drop-active');
    handleFiles(Array.from(e.dataTransfer?.files || []));
  };

  const handleDelete = async (clip) => {
    if (!confirm(`Eliminare "${clip.drive_file_name}" da Drive?`)) return;
    try {
      await api.deleteCreatorUpload(token, item.id, clip.id);
      setClips((c) => (c || []).filter((x) => x.id !== clip.id));
      onChange?.({ uploads_count: Math.max(0, (item.uploads_count || 1) - 1) });
    } catch (err) {
      alert(`Errore: ${err.message}`);
    }
  };

  const dismissPending = (tempId) =>
    setPending((p) => p.filter((x) => x.tempId !== tempId));

  return (
    <div className="public-clip-strip">
      <div className="public-clip-strip-header">
        <FilmIcon size={12} />
        <span>
          {clips && clips.length > 0
            ? `${clips.length} clip caricat${clips.length === 1 ? 'a' : 'e'}`
            : 'Carica le tue clip per questo reel'}
        </span>
      </div>

      <div
        className="public-clip-drop"
        onDragOver={(e) => {
          e.preventDefault(); e.stopPropagation();
          e.currentTarget.classList.add('public-clip-drop-active');
        }}
        onDragLeave={(e) => {
          e.preventDefault(); e.stopPropagation();
          e.currentTarget.classList.remove('public-clip-drop-active');
        }}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={14} />
        <span>Trascina un video o clicca per scegliere</span>
        <small>video fino a 500 MB Â· si puÃ² caricarne piÃ¹ di uno</small>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        onChange={(e) => handleFiles(Array.from(e.target.files || []))}
        style={{ display: 'none' }}
      />

      {(loading || (clips === null && (item.uploads_count || 0) > 0)) && (
        <div className="public-clip-loading"><Loader2 size={12} className="spin" /> carico le clip esistentiâ€¦</div>
      )}

      {(clips || []).length > 0 && (
        <ul className="public-clip-list">
          {clips.map((c) => (
            <li key={c.id} className="public-clip-item">
              <Video size={12} />
              <span className="public-clip-name" title={c.drive_file_name}>
                v{c.version_number}
                {c.drive_view_url ? (
                  <a href={c.drive_view_url} target="_blank" rel="noopener noreferrer">
                    {c.drive_file_name.slice(0, 60)}{c.drive_file_name.length > 60 ? 'â€¦' : ''}
                  </a>
                ) : (
                  <span>{c.drive_file_name.slice(0, 60)}{c.drive_file_name.length > 60 ? 'â€¦' : ''}</span>
                )}
              </span>
              <span className="public-clip-size">{humanSize(c.size_bytes)}</span>
              <button
                className="public-clip-delete"
                onClick={() => handleDelete(c)}
                title="Elimina clip"
              >
                <Trash2 size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <ul className="public-clip-list public-clip-pending-list">
          {pending.map((p) => (
            <li key={p.tempId} className={`public-clip-item pending ${p.error ? 'failed' : ''}`}>
              {p.error ? <AlertCircle size={12} /> : <Loader2 size={12} className="spin" />}
              <span className="public-clip-name">
                {p.file.name}
              </span>
              {p.error ? (
                <>
                  <span className="public-clip-error" title={p.error}>{p.error.slice(0, 60)}</span>
                  <button
                    className="public-clip-delete"
                    onClick={() => dismissPending(p.tempId)}
                    title="Rimuovi dalla coda"
                  >
                    <X size={11} />
                  </button>
                </>
              ) : (
                <span className="public-clip-progress">
                  <span className="public-clip-progress-bar">
                    <span style={{ width: `${p.progress}%` }} />
                  </span>
                  <span className="public-clip-progress-text">{p.progress}%</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <div className="public-clip-strip-error"><AlertCircle size={12} /> {error}</div>}
    </div>
  );
}

