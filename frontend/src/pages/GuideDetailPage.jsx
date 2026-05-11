import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
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

export default function GuideDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState(null);
  const [contentText, setContentText] = useState('');
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getGuide(id)
      .then((a) => {
        if (cancelled) return;
        setArticle(a);
        setTitle(a.title || '');
        setContent(a.content);
        setContentText(a.content_text || '');
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
      // Drop back to idle after 1.5 sec so the indicator doesn't linger
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch (err) {
      setSaveState('error');
      setError(err.message);
    }
  };

  // Debounce typing to avoid hammering the API on every keystroke
  const debouncedSave = useDebouncedCallback(save, 1000);

  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    debouncedSave({ title: newTitle });
  };

  const handleContentChange = ({ content: newContent, content_text: newText }) => {
    setContent(newContent);
    setContentText(newText);
    debouncedSave({ content: newContent, content_text: newText });
  };

  const handleImageUpload = async (file) => {
    // Read as base64 data URL → POST to backend → backend uploads to Supabase Storage → returns URL
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

  return (
    <div className="guide-detail">
      <div className="guide-detail-topbar">
        <button className="back-btn" onClick={() => navigate('/guides')}>
          <ArrowLeft size={14} /> All guides
        </button>
        <div className="guide-detail-actions">
          <SaveIndicator state={saveState} />
          <button className="btn btn-ghost btn-sm danger-hover" onClick={handleDelete} title="Delete article">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <input
        type="text"
        className="guide-title-input"
        value={title}
        onChange={handleTitleChange}
        placeholder="Untitled article"
        spellCheck={false}
      />

      <GuideEditor
        content={content}
        onChange={handleContentChange}
        onImageUpload={handleImageUpload}
        placeholder="Start writing your SOP — type / for shortcuts, or use the toolbar above…"
      />

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
