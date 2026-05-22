import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Circle, Trash2, Image as ImageIcon, Pencil, X, Check, AlertCircle
} from 'lucide-react';
import { api } from '../lib/api';
import './LessonDetailPage.css';

const MAX_THUMB_BYTES = 5 * 1024 * 1024;
const ALLOWED_THUMB_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

export default function LessonDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '' });
  const [uploadingThumb, setUploadingThumb] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getLesson(id);
      setLesson(data);
      setDraft({ title: data.title, description: data.description || '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleToggleDone = async () => {
    const next = !lesson.is_done;
    setLesson((l) => ({ ...l, is_done: next, done_at: next ? new Date().toISOString() : null }));
    try {
      await api.updateLesson(id, { is_done: next });
    } catch (err) {
      alert(`Failed: ${err.message}`);
      load();
    }
  };

  const saveTitle = async () => {
    if (!draft.title.trim()) return setEditingTitle(false);
    try {
      const updated = await api.updateLesson(id, { title: draft.title.trim() });
      setLesson(updated);
      setEditingTitle(false);
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  };

  const saveDesc = async () => {
    try {
      const updated = await api.updateLesson(id, { description: draft.description || null });
      setLesson(updated);
      setEditingDesc(false);
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${lesson.title}"? This can't be undone.`)) return;
    await api.deleteLesson(id);
    navigate('/guides');
  };

  const handleThumbnailPick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!ALLOWED_THUMB_TYPES.includes(file.type)) {
        return alert('Please choose a JPG, PNG, or WebP image.');
      }
      if (file.size > MAX_THUMB_BYTES) {
        return alert(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`);
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
      setUploadingThumb(true);
      try {
        await api.uploadLessonThumbnail(id, dataUrl);
        load();
      } catch (err) {
        alert(`Upload failed: ${err.message}`);
      } finally {
        setUploadingThumb(false);
      }
    };
    input.click();
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (error || !lesson) return (
    <div className="lesson-detail-error">
      <AlertCircle size={16} /> {error || 'Lesson not found'}
    </div>
  );

  return (
    <div className="lesson-detail">
      <div className="lesson-detail-topbar">
        <button className="back-btn" onClick={() => navigate('/guides')}>
          <ArrowLeft size={14} /> Back to Guides
        </button>
        <div className="lesson-detail-actions">
          <button
            className={`btn btn-sm ${lesson.is_done ? 'btn-primary' : 'btn-secondary'}`}
            onClick={handleToggleDone}
          >
            {lesson.is_done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
            {lesson.is_done ? 'Completed' : 'Mark complete'}
          </button>
          <button className="btn btn-ghost btn-sm danger-hover" onClick={handleDelete} title="Delete lesson">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Title */}
      {editingTitle ? (
        <div className="lesson-title-edit">
          <input
            type="text"
            className="lesson-title-input"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
          />
          <button className="btn btn-primary btn-sm" onClick={saveTitle}><Check size={13} /></button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setDraft((d) => ({ ...d, title: lesson.title })); setEditingTitle(false); }}><X size={13} /></button>
        </div>
      ) : (
        <h1 className="lesson-title" onClick={() => setEditingTitle(true)}>
          {lesson.title}
          <Pencil size={14} className="lesson-title-pencil" />
        </h1>
      )}

      {/* Done timestamp */}
      {lesson.is_done && lesson.done_at && (
        <div className="lesson-done-stamp">
          <CheckCircle2 size={13} /> Completed {timeAgo(lesson.done_at)}
        </div>
      )}

      {/* Description — now BEFORE the player as requested */}
      <div className="lesson-desc-section">
        {editingDesc ? (
          <div className="lesson-desc-edit">
            <textarea
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Notes about this lesson…"
              rows={4}
              autoFocus
            />
            <div className="lesson-desc-actions">
              <button className="btn btn-primary btn-sm" onClick={saveDesc}><Check size={13} /> Save</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setDraft((d) => ({ ...d, description: lesson.description || '' })); setEditingDesc(false); }}><X size={13} /> Cancel</button>
            </div>
          </div>
        ) : lesson.description ? (
          <div className="lesson-desc" onClick={() => setEditingDesc(true)}>
            {lesson.description}
            <span className="lesson-desc-edit-hint">click to edit</span>
          </div>
        ) : (
          <button className="lesson-desc-add" onClick={() => setEditingDesc(true)}>
            <Pencil size={12} /> Add a description
          </button>
        )}
      </div>

      {/* Embedded player — now AFTER the description as requested */}
      <LessonPlayer lesson={lesson} />

      {/* Thumbnail manager */}
      <div className="lesson-thumb-section">
        <div className="lesson-thumb-label">Thumbnail</div>
        <div className="lesson-thumb-row">
          {lesson.thumbnail_url ? (
            <img src={lesson.thumbnail_url} alt="" className="lesson-thumb-preview" />
          ) : (
            <div className="lesson-thumb-empty">No thumbnail</div>
          )}
          <button className="btn btn-secondary btn-sm" onClick={handleThumbnailPick} disabled={uploadingThumb}>
            <ImageIcon size={13} /> {uploadingThumb ? 'Uploading…' : lesson.thumbnail_url ? 'Replace' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Player ----------
// For YouTube: renders an iframe pointing at the canonical embed URL.
// For embed_html: renders the SANITIZED iframe HTML (backend already validated host).
function LessonPlayer({ lesson }) {
  if (lesson.source_type === 'youtube') {
    return (
      <div className="lesson-player">
        <iframe
          src={lesson.source_data}
          frameBorder="0"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          title={lesson.title}
        />
      </div>
    );
  }
  if (lesson.source_type === 'embed_html') {
    return (
      <div className="lesson-player" dangerouslySetInnerHTML={{ __html: lesson.source_data }} />
    );
  }
  return <div className="lesson-player-error">Unknown source type: {lesson.source_type}</div>;
}

function timeAgo(iso) {
  if (!iso) return '';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
