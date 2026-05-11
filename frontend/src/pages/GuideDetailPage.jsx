import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, CheckCircle2, Loader2, AlertCircle, Pencil, Check, FileText } from 'lucide-react';
import { api } from '../lib/api';
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
  // A doc with one empty paragraph is still "empty"
  if (content.content.length === 1) {
    const node = content.content[0];
    if (node.type === 'paragraph' && (!node.content || node.content.length === 0)) {
      return true;
    }
  }
  return false;
}

export default function GuideDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [error, setError] = useState('');

  // Edit mode is OFF by default. Brand-new articles (untitled, empty) auto-open
  // in edit mode so users don't have to click Edit on something they just created.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getGuide(id)
      .then((a) => {
        if (cancelled) return;
        setArticle(a);
        setTitle(a.title || '');
        setContent(a.content);
        // Auto-open editor if this looks like a fresh, untouched article
        const isFresh = (a.title === 'Untitled article' || !a.title) && isEmptyContent(a.content);
        if (isFresh) setEditing(true);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
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
    const newTitle = e.target.value;
    setTitle(newTitle);
    debouncedSave({ title: newTitle });
  };

  const handleContentChange = ({ content: newContent, content_text: newText }) => {
    setContent(newContent);
    debouncedSave({ content: newContent, content_text: newText });
  };

  const handleImageUpload = async (file) => {
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
        </div>
      </div>

      {editing ? (
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
        <h1 className="guide-title-display" onClick={() => setEditing(true)} title="Click to edit">
          {title || 'Untitled article'}
        </h1>
      )}

      {!editing && empty ? (
        <div className="guide-empty-body" onClick={() => setEditing(true)}>
          <FileText size={32} />
          <p>This article is empty.</p>
          <button className="btn btn-primary btn-sm">
            <Pencil size={13} /> Start writing
          </button>
        </div>
      ) : (
        <GuideEditor
          content={content}
          onChange={handleContentChange}
          onImageUpload={handleImageUpload}
          editable={editing}
          placeholder="Start writing your SOP — use the toolbar above for formatting…"
        />
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
