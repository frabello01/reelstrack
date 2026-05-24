import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Trash2, CheckCircle2, Circle, Loader2, AlertCircle, Pencil, Check,
  FileText, Users as UsersIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import GuideEditor from '../components/GuideEditor';
import './GuideDetailPage.css';

// Debounce helper — saves the doc 1 second after the user stops typing
function useDebouncedCallback(fn, delay) {
  const timer = useRef(null);
  return (...args) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  };
}

// Detect if the article is genuinely empty (no content or just empty paragraphs)
function isEmptyContent(content) {
  if (!content) return true;
  if (!content.content || content.content.length === 0) return true;
  if (content.content.length === 1) {
    const node = content.content[0];
    if (node.type === 'paragraph' && (!node.content || node.content.length === 0)) {
      return true;
    }
  }
  return false;
}

function timeAgo(iso) {
  if (!iso) return '';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export default function GuideDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [error, setError] = useState('');

  // Edit mode is OFF by default. Auto-opens for admins on fresh articles.
  // Members never see edit mode.
  const [editing, setEditing] = useState(false);

  // Per-user completion state
  const [completedByMe, setCompletedByMe] = useState(false);
  const [completions, setCompletions] = useState([]);
  const [togglingComplete, setTogglingComplete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getGuide(id)
      .then((a) => {
        if (cancelled) return;
        setArticle(a);
        setTitle(a.title || '');
        setContent(a.content);
        // Auto-open editor only for admins on fresh untouched articles
        if (isAdmin) {
          const isFresh = (a.title === 'Untitled article' || !a.title) && isEmptyContent(a.content);
          if (isFresh) setEditing(true);
        }
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [id, isAdmin]);

  // Load completion state
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getMyGuideCompletions().catch(() => ({ articles: [] })),
      api.getGuideCompletionsForItem('article', id).catch(() => ({ completions: [] })),
    ]).then(([mine, all]) => {
      if (cancelled) return;
      setCompletedByMe((mine.articles || []).includes(id));
      setCompletions(all.completions || []);
    });
    return () => { cancelled = true; };
  }, [id]);

  const save = async (updates) => {
    setSaveState('saving');
    try {
      await api.updateGuide(id, updates);
      setSaveState('saved');
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch (err) {
      setSaveState('error');
      setError(err.message);
    }
  };

  const debouncedSave = useDebouncedCallback(save, 1000);

  const handleTitleChange = (e) => {
    if (!isAdmin) return;
    const newTitle = e.target.value;
    setTitle(newTitle);
    debouncedSave({ title: newTitle });
  };

  const handleContentChange = ({ content: newContent, content_text: newText }) => {
    if (!isAdmin) return;
    setContent(newContent);
    debouncedSave({ content: newContent, content_text: newText });
  };

  const handleImageUpload = async (file) => {
    if (!isAdmin) throw new Error('Members cannot upload images');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
    const { url } = await api.uploadGuideImage(id, dataUrl);
    return url;
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${title || 'this article'}"? This can't be undone.`)) return;
    await api.deleteGuide(id);
    navigate('/guides');
  };

  const handleToggleMyCompletion = async () => {
    setTogglingComplete(true);
    try {
      if (completedByMe) {
        await api.unmarkGuideComplete('article', id);
      } else {
        await api.markGuideComplete('article', id);
      }
      // Refresh both states
      const [mine, all] = await Promise.all([
        api.getMyGuideCompletions(),
        api.getGuideCompletionsForItem('article', id),
      ]);
      setCompletedByMe((mine.articles || []).includes(id));
      setCompletions(all.completions || []);
    } catch (err) {
      alert(`Failed: ${err.message}`);
    } finally {
      setTogglingComplete(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (error && !article) return <div className="guide-detail-error"><AlertCircle size={14} /> {error}</div>;

  const empty = isEmptyContent(content);

  return (
    <div className="guide-detail">
      <div className="guide-detail-topbar">
        <button className="back-btn" onClick={() => navigate('/guides')}>
          <ArrowLeft size={14} /> All guides
        </button>
        <div className="guide-detail-actions">
          {/* Per-user "Mark complete" — visible to everyone */}
          <button
            className={`btn btn-sm ${completedByMe ? 'btn-primary' : 'btn-secondary'}`}
            onClick={handleToggleMyCompletion}
            disabled={togglingComplete}
          >
            {completedByMe ? <CheckCircle2 size={13} /> : <Circle size={13} />}
            {completedByMe ? 'Completed by you' : 'Mark complete'}
          </button>

          {/* Admin-only: save indicator + edit toggle + delete */}
          {isAdmin && (
            <>
              <SaveIndicator state={saveState} />
              {editing ? (
                <button className="btn btn-primary btn-sm" onClick={() => setEditing(false)}>
                  <Check size={13} /> Done
                </button>
              ) : (
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
                  <Pencil size={13} /> Edit
                </button>
              )}
              <button className="btn btn-ghost btn-sm danger-hover" onClick={handleDelete} title="Delete article">
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Title — editable input for admin in edit mode, read-only display otherwise */}
      {editing && isAdmin ? (
        <input
          type="text"
          className="guide-title-input"
          value={title}
          onChange={handleTitleChange}
          placeholder="Untitled article"
          spellCheck={false}
          autoFocus={!title}
        />
      ) : (
        <h1
          className={`guide-title-display ${isAdmin ? 'guide-title-editable' : ''}`}
          onClick={isAdmin ? () => setEditing(true) : undefined}
          title={isAdmin ? 'Click to edit' : undefined}
        >
          {title || 'Untitled article'}
        </h1>
      )}

      {/* Body */}
      {!editing && empty ? (
        isAdmin ? (
          <div className="guide-empty-body" onClick={() => setEditing(true)}>
            <FileText size={32} />
            <p>This article is empty.</p>
            <button className="btn btn-primary btn-sm">
              <Pencil size={13} /> Start writing
            </button>
          </div>
        ) : (
          <div className="guide-empty-body guide-empty-body-readonly">
            <FileText size={32} />
            <p>This article is empty.</p>
            <p className="guide-empty-body-hint">Ask the admin to add content.</p>
          </div>
        )
      ) : (
        <GuideEditor
          content={content}
          onChange={handleContentChange}
          onImageUpload={handleImageUpload}
          editable={editing && isAdmin}
          placeholder="Start writing your SOP — use the toolbar above for formatting…"
        />
      )}

      {/* Admin-only: who's completed this article */}
      {isAdmin && (
        <div className="guide-completions">
          <div className="guide-completions-header">
            <UsersIcon size={13} /> Completion progress
            {completions.length > 0 && <span className="guide-completions-count">({completions.length})</span>}
          </div>
          {completions.length === 0 ? (
            <p className="guide-completions-empty">No team members have marked this complete yet.</p>
          ) : (
            <ul className="guide-completions-list">
              {completions.map((c) => (
                <li key={c.user_id}>
                  <span className="guide-completion-name">{c.user_name || 'Unknown'}</span>
                  <span className="guide-completion-time">{timeAgo(c.completed_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <div className="guide-detail-error"><AlertCircle size={14} /> {error}</div>}
    </div>
  );
}

function SaveIndicator({ state }) {
  if (state === 'idle') return null;
  if (state === 'saving') return (
    <span className="save-indicator saving"><Loader2 size={13} className="spin" /> Saving…</span>
  );
  if (state === 'saved') return (
    <span className="save-indicator saved"><CheckCircle2 size={13} /> Saved</span>
  );
  if (state === 'error') return (
    <span className="save-indicator error"><AlertCircle size={13} /> Save failed</span>
  );
  return null;
}
