import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ExternalLink, Trash2, Eye, EyeOff, Heart, Share2, Link2,
  StickyNote, Lock, Check, X, Plus, Save, AlertCircle, Loader2,
  RefreshCw, Play, Download, MoreVertical, Move, Copy, Flame, Upload, Video
} from 'lucide-react';
import { api } from '../lib/api';
import { uploadVideoToTodo } from '../lib/videoUpload';
import ImageUploader from '../components/ImageUploader';
import './TodoDetailPage.css';

function formatViews(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

export default function TodoDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shareCopied, setShareCopied] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkAdding, setLinkAdding] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [playingVideoUrl, setPlayingVideoUrl] = useState(null);

  // Active vs Edited (hidden) tab. Defaults to 'active' on every page load.
  const [tab, setTab] = useState('active'); // 'active' | 'edited'

  // Editor state for the per-reel note. We track which reel and which kind ('public' | 'private').
  const [editingNote, setEditingNote] = useState(null); // { reelId, kind } or null
  const [noteDraft, setNoteDraft] = useState('');

  // List-level notes — drafted in local state, saved on blur or explicit save
  const [listPublicDraft, setListPublicDraft] = useState('');
  const [listPrivateDraft, setListPrivateDraft] = useState('');

  // All other to-do lists (for the Move/Copy menu)
  const [allLists, setAllLists] = useState([]);

  // Tracks which reel's "more actions" menu is open (reelId or null)
  const [openMenuFor, setOpenMenuFor] = useState(null);

  // Video upload state
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getTodo(id);
      setList(data);
      setListPublicDraft(data.public_note || '');
      setListPrivateDraft(data.private_note || '');
    } finally {
      setLoading(false);
    }
  };

  const silentReload = async () => {
    try {
      const data = await api.getTodo(id);
      setList(data);
    } catch {}
  };

  useEffect(() => { load(); }, [id]);

  // Load all to-do lists (for the move/copy menu)
  useEffect(() => {
    api.getTodos().then((lists) => setAllLists(lists || [])).catch(() => {});
  }, []);

  // Close action menu when clicking outside
  useEffect(() => {
    if (!openMenuFor) return;
    const handler = () => setOpenMenuFor(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuFor]);

  // Auto-poll while any backup is in progress
  useEffect(() => {
    if (!list?.items) return;
    const inProgress = list.items.some(
      (i) => i.reels?.backup_status === 'pending' || i.reels?.backup_status === 'downloading'
    );
    if (!inProgress) return;
    const interval = setInterval(silentReload, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list?.items?.map((i) => i.reels?.backup_status).join(',')]);

  // -------- Handlers --------

  const toggleDone = async (item) => {
    await api.toggleReelDone(id, item.reels.id, !item.is_done);
    load();
  };

  const removeReel = async (reelId) => {
    if (!confirm('Remove from this list?')) return;
    await api.removeReelFromTodo(id, reelId);
    load();
  };

  const handleShare = () => {
    if (!list?.public_token) return;
    const shareUrl = `${window.location.origin}/share/${list.public_token}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
  };

  const handleAddByLink = async (e) => {
    e?.preventDefault();
    if (!linkInput.trim()) return;
    setLinkAdding(true);
    setLinkError('');
    try {
      await api.addReelToTodoByLink(id, linkInput.trim());
      setLinkInput('');
      load();
    } catch (err) {
      setLinkError(err.message || 'Failed to add reel');
    } finally {
      setLinkAdding(false);
    }
  };

  const startEditingNote = (item, kind) => {
    setEditingNote({ reelId: item.reels.id, kind });
    setNoteDraft(item[kind === 'public' ? 'public_note' : 'private_note'] || '');
  };

  const saveNote = async () => {
    if (!editingNote) return;
    const payload = editingNote.kind === 'public'
      ? { public_note: noteDraft }
      : { private_note: noteDraft };
    await api.updateReelNotes(id, editingNote.reelId, payload);
    setEditingNote(null);
    setNoteDraft('');
    silentReload();
  };

  const cancelEditingNote = () => {
    setEditingNote(null);
    setNoteDraft('');
  };

  const saveListNotes = async (which) => {
    const payload = which === 'public'
      ? { public_note: listPublicDraft }
      : { private_note: listPrivateDraft };
    await api.updateTodoNotes(id, payload);
  };

  // Set priority on a reel (1=low, 2=medium, 3=high). Optimistic update.
  const handleSetPriority = async (reelId, priority) => {
    setList((l) => ({
      ...l,
      items: l.items.map((it) => it.reels?.id === reelId ? { ...it, priority } : it),
    }));
    try {
      await api.updateReelPriority(id, reelId, priority);
      // Reload to get re-sorted order from the server
      silentReload();
    } catch (err) {
      alert(`Failed to update priority: ${err.message}`);
      load();
    }
  };

  // Toggle hidden state. Optimistic update.
  const handleToggleHidden = async (reelId, currentlyHidden) => {
    const newHidden = !currentlyHidden;
    setList((l) => ({
      ...l,
      items: l.items.map((it) => it.reels?.id === reelId ? { ...it, is_hidden: newHidden } : it),
    }));
    try {
      await api.toggleReelHidden(id, reelId, newHidden);
    } catch (err) {
      alert(`Failed: ${err.message}`);
      load();
    }
  };

  // Move a reel to another list. Removes from current list.
  const handleMove = async (reelId, targetListId) => {
    setOpenMenuFor(null);
    try {
      await api.moveReel(id, reelId, targetListId);
      load();
    } catch (err) {
      alert(`Move failed: ${err.message}`);
    }
  };

  // Copy a reel to another list (keeps current). Notes are copied by default.
  const handleCopy = async (reelId, targetListId) => {
    setOpenMenuFor(null);
    try {
      await api.copyReel(id, reelId, targetListId);
      const target = allLists.find((l) => l.id === targetListId);
      if (target) {
        // brief feedback
        // eslint-disable-next-line no-alert
        // (could be a toast — keeping simple alert for now)
      }
    } catch (err) {
      alert(`Copy failed: ${err.message}`);
    }
  };

  // Direct video upload from file input
  const handleVideoSelected = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    setUploadProgress(0);
    try {
      await uploadVideoToTodo(id, file, (p) => setUploadProgress(p));
      load();
    } catch (err) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleRetryBackup = async (reelId) => {
    try {
      await api.retryReelBackup(id, reelId);
      setList((l) => ({
        ...l,
        items: l.items.map((it) =>
          it.reels?.id === reelId
            ? { ...it, reels: { ...it.reels, backup_status: 'pending', backup_error: null } }
            : it
        ),
      }));
    } catch (err) {
      alert(`Retry failed: ${err.message}`);
    }
  };

  const handleDownload = async (reel) => {
    if (!reel?.backup_video_url) return;
    const filename = reel.creators?.username
      ? `${reel.creators.username}-${reel.id.slice(0, 8)}.mp4`
      : `reel-${reel.id.slice(0, 8)}.mp4`;
    try {
      // Fetch the bytes ourselves and create a blob URL.
      // This bypasses Supabase Storage's missing Content-Disposition headers
      // (which would otherwise cause the browser to play the video inline).
      const res = await fetch(reel.backup_video_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      // Fallback: direct anchor download without target=_blank.
      // The browser may still inline-play if Content-Disposition isn't set,
      // but it works as a last resort.
      console.warn('[download] blob fetch failed, falling back to direct link:', err.message);
      const a = document.createElement('a');
      a.href = reel.backup_video_url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!list) return <div>Not found</div>;

  return (
    <div className="todo-detail">
      <button className="back-btn" onClick={() => navigate('/todos')}>
        <ArrowLeft size={16} /> All to-do lists
      </button>

      <div className="todo-detail-header">
        <div className="todo-detail-title-row">
          <ImageUploader
            shape="thumbnail"
            currentUrl={list.cover_image_url}
            placeholder="Add cover"
            onUpload={async (dataUrl) => {
              await api.uploadTodoCover(id, dataUrl);
              silentReload();
            }}
            onRemove={async () => {
              await api.removeTodoCover(id);
              silentReload();
            }}
          />
          <h1>{list.name}</h1>
          <button className="btn btn-secondary share-btn" onClick={handleShare}>
            <Share2 size={14} />
            {shareCopied ? 'Link copied!' : 'Share'}
          </button>
        </div>
        <div className="todo-detail-stats">
          {list.items.filter((i) => i.is_done).length} / {list.items.length} done
        </div>
      </div>

      {/* List-level notes (public + private) */}
      <div className="list-notes-block">
        <div className="list-note-card list-note-public">
          <div className="list-note-header">
            <StickyNote size={14} />
            <span>List note (visible to creator)</span>
          </div>
          <textarea
            placeholder="Write a note that appears at the top of the share link…"
            value={listPublicDraft}
            onChange={(e) => setListPublicDraft(e.target.value)}
            onBlur={() => saveListNotes('public')}
            rows={2}
          />
        </div>
        <div className="list-note-card list-note-private">
          <div className="list-note-header">
            <Lock size={14} />
            <span>Private note (team only)</span>
          </div>
          <textarea
            placeholder="Internal notes — never shown to the creator…"
            value={listPrivateDraft}
            onChange={(e) => setListPrivateDraft(e.target.value)}
            onBlur={() => saveListNotes('private')}
            rows={2}
          />
        </div>
      </div>

      <form className="add-by-link" onSubmit={handleAddByLink}>
        <Link2 size={16} className="add-by-link-icon" />
        <input
          type="text"
          placeholder="Paste an Instagram reel link to add it to this list"
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          disabled={linkAdding}
        />
        <button type="submit" className="btn btn-primary" disabled={linkAdding || !linkInput.trim()}>
          {linkAdding ? 'Adding...' : <><Plus size={14} /> Add</>}
        </button>
      </form>
      {linkError && <div className="add-by-link-error">{linkError}</div>}

      {/* Direct video upload */}
      <div className="upload-video-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4"
          style={{ display: 'none' }}
          onChange={(e) => handleVideoSelected(e.target.files?.[0])}
        />
        <button
          type="button"
          className="btn btn-secondary upload-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
          {uploading ? `Uploading… ${Math.round(uploadProgress * 100)}%` : 'Upload video (MP4, max 10 MB)'}
        </button>
        {uploading && (
          <div className="upload-progress-bar">
            <div className="upload-progress-fill" style={{ width: `${uploadProgress * 100}%` }} />
          </div>
        )}
      </div>
      {uploadError && <div className="add-by-link-error">{uploadError}</div>}

      {list.items.length === 0 ? (
        <div className="empty-state">
          <p>No reels saved yet. Add reels from the dashboard using the bookmark icon, or paste an Instagram link above.</p>
        </div>
      ) : (
        (() => {
          // Build a stable rank: based on the order reels were ADDED (oldest = #1).
          // Adding a new reel gives it the next highest number; existing numbering stays put.
          // The visible list order may shuffle when priority changes, but the rank
          // shown next to each reel stays tied to insertion order.
          const byAddedAsc = [...list.items].sort((a, b) =>
            new Date(a.added_at) - new Date(b.added_at)
          );
          const rankByReelId = new Map();
          byAddedAsc.forEach((it, i) => {
            if (it.reels?.id) rankByReelId.set(it.reels.id, i + 1);
          });

          const activeItems = list.items.filter((it) => !it.is_hidden);
          const hiddenItems = list.items.filter((it) => it.is_hidden);

          const renderItem = (item) => {
            const reel = item.reels;
            const hasBackup = reel?.backup_status === 'done' && reel?.backup_video_url;
            const isEditingPublic = editingNote?.reelId === reel?.id && editingNote?.kind === 'public';
            const isEditingPrivate = editingNote?.reelId === reel?.id && editingNote?.kind === 'private';
            const stableRank = rankByReelId.get(reel?.id) ?? '?';
            return (
              <div key={item.id} className={`todo-item ${item.is_done ? 'done' : ''} ${item.is_hidden ? 'is-hidden' : ''}`}>
                <div className="todo-item-main">
                  <input
                    type="checkbox"
                    checked={item.is_done}
                    onChange={() => toggleDone(item)}
                  />
                  <div className="todo-item-rank-col">
                    <div className="todo-item-rank">#{stableRank}</div>
                    <PriorityPill
                      priority={item.priority}
                      onChange={(p) => handleSetPriority(reel.id, p)}
                    />
                  </div>
                  <div className="todo-item-thumb">
                    {(reel?.backup_thumbnail_url || reel?.thumbnail_url) && (
                      <img src={reel.backup_thumbnail_url || reel.thumbnail_url} alt="" />
                    )}
                  </div>
                  <div className="todo-item-info">
                    <div className="todo-item-creator">
                      {reel?.creators?.username
                        ? `@${reel.creators.username}`
                        : reel?.is_uploaded
                          ? <span className="manual-badge">Uploaded video</span>
                          : <span className="manual-badge">Manually added</span>}
                    </div>
                    <div className="todo-item-caption">
                      {reel?.caption?.substring(0, 80) || '(no caption)'}
                    </div>
                    <div className="todo-item-stats">
                      <span><Eye size={12} /> {formatViews(reel?.views)}</span>
                      <span><Heart size={12} /> {formatViews(reel?.likes)}</span>
                    </div>
                    <BackupBadge
                      reel={reel}
                      onRetry={() => handleRetryBackup(reel.id)}
                    />
                  </div>
                  <div className="todo-item-actions">
                    {hasBackup && (
                      <>
                        <button
                          className="todo-item-action-btn"
                          onClick={() => setPlayingVideoUrl(reel.backup_video_url)}
                          title="Play video"
                          aria-label="Play video"
                        >
                          <Play size={14} />
                        </button>
                        <button
                          className="todo-item-action-btn"
                          onClick={() => handleDownload(reel)}
                          title="Download MP4"
                          aria-label="Download MP4"
                        >
                          <Download size={14} />
                        </button>
                      </>
                    )}
                    {!reel?.is_uploaded && (
                      <a
                        href={reel?.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="todo-item-action-btn"
                        title="Open on Instagram"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <button
                      className="todo-item-action-btn"
                      onClick={() => handleToggleHidden(reel.id, item.is_hidden)}
                      title={item.is_hidden ? 'Move back to Active' : 'Hide (move to Hidden section)'}
                      aria-label={item.is_hidden ? 'Unhide' : 'Hide'}
                    >
                      {item.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <div className="reel-menu-wrap">
                      <button
                        className="todo-item-action-btn"
                        onClick={(e) => { e.stopPropagation(); setOpenMenuFor(openMenuFor === reel.id ? null : reel.id); }}
                        title="More actions"
                        aria-label="More actions"
                      >
                        <MoreVertical size={14} />
                      </button>
                      {openMenuFor === reel.id && (
                        <div className="reel-menu" onClick={(e) => e.stopPropagation()}>
                          <ReelMoveCopyMenu
                            currentListId={id}
                            allLists={allLists}
                            onMove={(targetId) => handleMove(reel.id, targetId)}
                            onCopy={(targetId) => handleCopy(reel.id, targetId)}
                          />
                          <button
                            className="reel-menu-item danger"
                            onClick={() => { setOpenMenuFor(null); removeReel(reel.id); }}
                          >
                            <Trash2 size={12} /> Remove from list
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Per-reel notes block: public + private */}
                <div className="reel-notes-block">
                  {/* Public note */}
                  {isEditingPublic ? (
                    <div className="note-editor note-editor-public">
                      <div className="note-editor-label">
                        <StickyNote size={12} /> Public note (visible to creator)
                      </div>
                      <textarea
                        placeholder="Note for the creator…"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        rows={2}
                        autoFocus
                      />
                      <div className="note-editor-actions">
                        <button className="btn btn-primary btn-sm" onClick={saveNote}>
                          <Check size={12} /> Save
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={cancelEditingNote}>
                          <X size={12} /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : item.public_note ? (
                    <div className="note-display note-display-public" onClick={() => startEditingNote(item, 'public')}>
                      <StickyNote size={12} />
                      <span>{item.public_note}</span>
                      <span className="note-edit-hint">click to edit</span>
                    </div>
                  ) : (
                    <button className="add-note-btn" onClick={() => startEditingNote(item, 'public')}>
                      <StickyNote size={12} /> Add public note
                    </button>
                  )}

                  {/* Private note */}
                  {isEditingPrivate ? (
                    <div className="note-editor note-editor-private">
                      <div className="note-editor-label">
                        <Lock size={12} /> Private note (team only)
                      </div>
                      <textarea
                        placeholder="Internal note — never shown to the creator…"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        rows={2}
                        autoFocus
                      />
                      <div className="note-editor-actions">
                        <button className="btn btn-primary btn-sm" onClick={saveNote}>
                          <Check size={12} /> Save
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={cancelEditingNote}>
                          <X size={12} /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : item.private_note ? (
                    <div className="note-display note-display-private" onClick={() => startEditingNote(item, 'private')}>
                      <Lock size={12} />
                      <span>{item.private_note}</span>
                      <span className="note-edit-hint">click to edit · team only</span>
                    </div>
                  ) : (
                    <button className="add-note-btn add-note-btn-private" onClick={() => startEditingNote(item, 'private')}>
                      <Lock size={12} /> Add private note
                    </button>
                  )}
                </div>
              </div>
            );
          };

          return (
            <>
              {/* Tab switcher: Active vs Edited (hidden) */}
              <div className="todo-tabs">
                <button
                  type="button"
                  className={`todo-tab ${tab === 'active' ? 'active' : ''}`}
                  onClick={() => setTab('active')}
                >
                  Active <span className="todo-tab-count">{activeItems.length}</span>
                </button>
                <button
                  type="button"
                  className={`todo-tab ${tab === 'edited' ? 'active' : ''}`}
                  onClick={() => setTab('edited')}
                >
                  <EyeOff size={13} /> Edited <span className="todo-tab-count">{hiddenItems.length}</span>
                </button>
              </div>

              {tab === 'active' ? (
                <div className="todo-items">
                  {activeItems.length === 0 ? (
                    <div className="empty-state-inline">
                      <p>No active reels — all reels in this list have been edited.</p>
                    </div>
                  ) : (
                    activeItems.map(renderItem)
                  )}
                </div>
              ) : (
                <div className="todo-items todo-items-hidden">
                  {hiddenItems.length === 0 ? (
                    <div className="empty-state-inline">
                      <p>No edited reels yet. Hide reels from the Active tab to move them here.</p>
                    </div>
                  ) : (
                    hiddenItems.map(renderItem)
                  )}
                </div>
              )}
            </>
          );
        })()
      )}

      {/* Video modal */}
      {playingVideoUrl && (
        <div className="video-modal" onClick={() => setPlayingVideoUrl(null)}>
          <div className="video-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="video-modal-close" onClick={() => setPlayingVideoUrl(null)}>×</button>
            <video src={playingVideoUrl} controls autoPlay playsInline />
          </div>
        </div>
      )}
    </div>
  );
}

// ----- BackupBadge -----
function BackupBadge({ reel, onRetry }) {
  if (!reel) return null;
  const status = reel.backup_status;

  if (status === 'done') {
    const sizeMB = reel.backup_size_bytes ? (reel.backup_size_bytes / 1024 / 1024).toFixed(1) : null;
    return (
      <div className="backup-badge backup-done" title="Video backed up to your server">
        <Save size={11} />
        <span>Video backed up{sizeMB ? ` (${sizeMB} MB)` : ''}</span>
      </div>
    );
  }
  if (status === 'pending' || status === 'downloading') {
    return (
      <div className="backup-badge backup-progress">
        <Loader2 size={11} className="spin" />
        <span>{status === 'pending' ? 'Backup queued…' : 'Downloading video…'}</span>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="backup-badge backup-failed" title={reel.backup_error || 'Backup failed'}>
        <AlertCircle size={11} />
        <span>Backup failed</span>
        <button className="backup-retry-btn" onClick={onRetry} title="Retry backup">
          <RefreshCw size={11} />
        </button>
      </div>
    );
  }
  return (
    <div className="backup-badge backup-none">
      <span>No backup</span>
      <button className="backup-retry-btn" onClick={onRetry} title="Create backup">
        <Save size={11} />
      </button>
    </div>
  );
}

// ----- PriorityPill: cycles 1 → 2 → 3 on click -----
function PriorityPill({ priority, onChange }) {
  const p = priority ?? 2;
  const labels = { 1: 'Low', 2: 'Medium', 3: 'High' };
  const cycle = () => onChange(p === 3 ? 1 : p + 1);
  return (
    <button
      className={`priority-pill priority-${p}`}
      onClick={cycle}
      title={`Priority: ${labels[p]} (click to change)`}
    >
      {p === 3 && <Flame size={11} />}
      {labels[p]}
    </button>
  );
}

// ----- ReelMoveCopyMenu: shows a dropdown of other lists -----
function ReelMoveCopyMenu({ currentListId, allLists, onMove, onCopy }) {
  const [mode, setMode] = useState(null); // 'move' | 'copy' | null
  const otherLists = allLists.filter((l) => l.id !== currentListId);

  if (otherLists.length === 0) {
    return (
      <div className="reel-menu-empty">
        Create another list first to move/copy reels.
      </div>
    );
  }

  if (!mode) {
    return (
      <>
        <button className="reel-menu-item" onClick={() => setMode('move')}>
          <Move size={12} /> Move to…
        </button>
        <button className="reel-menu-item" onClick={() => setMode('copy')}>
          <Copy size={12} /> Copy to…
        </button>
      </>
    );
  }

  return (
    <>
      <div className="reel-menu-header">
        {mode === 'move' ? 'Move to which list?' : 'Copy to which list?'}
      </div>
      {otherLists.map((l) => (
        <button
          key={l.id}
          className="reel-menu-item"
          onClick={() => mode === 'move' ? onMove(l.id) : onCopy(l.id)}
        >
          {l.name}
        </button>
      ))}
    </>
  );
}
