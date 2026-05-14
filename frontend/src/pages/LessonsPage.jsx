import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap, Plus, Search, CheckCircle2, PlayCircle, Trash2, Youtube, Film } from 'lucide-react';
import { api } from '../lib/api';
import './LessonsPage.css';

export default function LessonsPage() {
  const navigate = useNavigate();
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const load = async (q = '') => {
    setLoading(true);
    try {
      setLessons(await api.getLessons(q));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const handleDelete = async (e, id, title) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${title}"? This can't be undone.`)) return;
    await api.deleteLesson(id);
    load(search);
  };

  const handleToggleDone = async (e, lesson) => {
    e.preventDefault();
    e.stopPropagation();
    const next = !lesson.is_done;
    // Optimistic
    setLessons((ls) => ls.map((l) => l.id === lesson.id ? { ...l, is_done: next, done_at: next ? new Date().toISOString() : null } : l));
    try {
      await api.updateLesson(lesson.id, { is_done: next });
    } catch (err) {
      alert(`Failed: ${err.message}`);
      load(search);
    }
  };

  const doneCount = lessons.filter((l) => l.is_done).length;

  return (
    <div className="lessons-page">
      <div className="lessons-header">
        <div>
          <h1><GraduationCap size={22} /> E-Learning</h1>
          <p className="subtitle">
            Your lesson library — YouTube videos and embeds.
            {lessons.length > 0 && (
              <span className="completion-summary"> · {doneCount} / {lessons.length} completed</span>
            )}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add lesson
        </button>
      </div>

      <div className="lessons-search-row">
        <Search size={14} className="lessons-search-icon" />
        <input
          type="text"
          placeholder="Search lessons…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : lessons.length === 0 ? (
        <EmptyState onAdd={() => setShowAdd(true)} hasSearch={!!search} search={search} />
      ) : (
        <div className="lessons-grid">
          {lessons.map((l) => (
            <Link to={`/lessons/${l.id}`} key={l.id} className={`lesson-card ${l.is_done ? 'done' : ''}`}>
              <div className="lesson-card-thumb">
                {l.thumbnail_url ? (
                  <img src={l.thumbnail_url} alt="" />
                ) : (
                  <div className="lesson-card-thumb-placeholder">
                    {l.source_type === 'youtube' ? <Youtube size={32} /> : <Film size={32} />}
                  </div>
                )}
                <div className="lesson-card-play"><PlayCircle size={36} /></div>
                {l.is_done && (
                  <div className="lesson-card-done-overlay">
                    <CheckCircle2 size={14} /> Completed
                  </div>
                )}
              </div>
              <div className="lesson-card-body">
                <div className="lesson-card-title">{l.title}</div>
                {l.description && <div className="lesson-card-desc">{l.description}</div>}
                <div className="lesson-card-actions">
                  <button
                    className={`lesson-card-toggle ${l.is_done ? 'done' : ''}`}
                    onClick={(e) => handleToggleDone(e, l)}
                  >
                    <CheckCircle2 size={12} /> {l.is_done ? 'Done' : 'Mark done'}
                  </button>
                  <button
                    className="lesson-card-delete"
                    onClick={(e) => handleDelete(e, l.id, l.title)}
                    aria-label="Delete lesson"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showAdd && (
        <AddLessonModal
          onClose={() => setShowAdd(false)}
          onCreated={(lesson) => {
            setShowAdd(false);
            navigate(`/lessons/${lesson.id}`);
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ onAdd, hasSearch, search }) {
  if (hasSearch) {
    return (
      <div className="lessons-empty">
        <Search size={48} />
        <h3>No matches</h3>
        <p>No lessons match "{search}". Try a different search term.</p>
      </div>
    );
  }
  return (
    <div className="lessons-empty">
      <GraduationCap size={48} />
      <h3>No lessons yet</h3>
      <p>Add your first lesson to start building the library.</p>
      <button className="btn btn-primary" onClick={onAdd}>
        <Plus size={14} /> Add lesson
      </button>
    </div>
  );
}

// ---------- Add lesson modal ----------
function AddLessonModal({ onClose, onCreated }) {
  const [sourceType, setSourceType] = useState('youtube'); // 'youtube' or 'embed'
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!title.trim()) return setError('Please enter a title.');
    if (!value.trim()) {
      return setError(sourceType === 'youtube'
        ? 'Please paste a YouTube URL.'
        : 'Please paste an <iframe> embed code.');
    }
    setCreating(true);
    setError('');
    try {
      const lesson = await api.createLesson({
        title: title.trim(),
        description: description.trim() || null,
        source: { type: sourceType, value: value.trim() },
      });
      onCreated(lesson);
    } catch (err) {
      setError(err.message || 'Could not create lesson');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="lesson-modal-overlay" onClick={onClose}>
      <div className="lesson-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add lesson</h2>

        <div className="lesson-source-tabs">
          <button
            type="button"
            className={`source-tab ${sourceType === 'youtube' ? 'active' : ''}`}
            onClick={() => setSourceType('youtube')}
          >
            <Youtube size={14} /> YouTube URL
          </button>
          <button
            type="button"
            className={`source-tab ${sourceType === 'embed' ? 'active' : ''}`}
            onClick={() => setSourceType('embed')}
          >
            <Film size={14} /> Embed code
          </button>
        </div>

        <form onSubmit={handleCreate}>
          <label className="lesson-label">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Bio setup checklist"
            autoFocus
          />

          <label className="lesson-label">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short context for this lesson…"
            rows={2}
          />

          {sourceType === 'youtube' ? (
            <>
              <label className="lesson-label">YouTube URL</label>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
              />
              <p className="lesson-hint">Works with watch URLs, shorts, or youtu.be short links.</p>
            </>
          ) : (
            <>
              <label className="lesson-label">Embed code</label>
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder='<iframe src="https://mega.nz/embed/…" …></iframe>'
                rows={5}
              />
              <p className="lesson-hint">
                Paste the complete &lt;iframe&gt; from the host's share menu.
                Allowed hosts: YouTube, Vimeo, Mega, Loom, Wistia, Dailymotion.
              </p>
            </>
          )}

          {error && <div className="lesson-modal-error">{error}</div>}

          <div className="lesson-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={creating}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? 'Creating...' : 'Create lesson'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
