import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Trash2, Eye, Heart, Share2, Link2, StickyNote, Check, X, Plus } from 'lucide-react';
import { api } from '../lib/api';
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
  const [editingNoteFor, setEditingNoteFor] = useState(null); // reel_id whose note is being edited
  const [noteDraft, setNoteDraft] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setList(await api.getTodo(id));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

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

  const startEditingNote = (item) => {
    setEditingNoteFor(item.reels.id);
    setNoteDraft(item.note || '');
  };

  const saveNote = async (reelId) => {
    await api.updateReelNote(id, reelId, noteDraft);
    setEditingNoteFor(null);
    setNoteDraft('');
    load();
  };

  const cancelEditingNote = () => {
    setEditingNoteFor(null);
    setNoteDraft('');
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

      {list.items.length === 0 ? (
        <div className="empty-state">
          <p>No reels saved yet. Add reels from the dashboard using the bookmark icon, or paste an Instagram link above.</p>
        </div>
      ) : (
        <div className="todo-items">
          {list.items.map((item) => (
            <div key={item.id} className={`todo-item ${item.is_done ? 'done' : ''}`}>
              <div className="todo-item-main">
                <input
                  type="checkbox"
                  checked={item.is_done}
                  onChange={() => toggleDone(item)}
                />
                <div className="todo-item-thumb">
                  {item.reels?.thumbnail_url && <img src={item.reels.thumbnail_url} alt="" />}
                </div>
                <div className="todo-item-info">
                  <div className="todo-item-creator">
                    {item.reels?.creators?.username
                      ? `@${item.reels.creators.username}`
                      : <span className="manual-badge">Manually added</span>}
                  </div>
                  <div className="todo-item-caption">
                    {item.reels?.caption?.substring(0, 80) || '(no caption)'}
                  </div>
                  <div className="todo-item-stats">
                    <span><Eye size={12} /> {formatViews(item.reels?.views)}</span>
                    <span><Heart size={12} /> {formatViews(item.reels?.likes)}</span>
                  </div>
                </div>
                <a href={item.reels?.url} target="_blank" rel="noopener noreferrer" className="todo-item-link">
                  <ExternalLink size={14} />
                </a>
                <button className="todo-item-remove" onClick={() => removeReel(item.reels.id)}>
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="todo-item-note-row">
                {editingNoteFor === item.reels.id ? (
                  <div className="note-editor">
                    <textarea
                      placeholder="Note for the creator (visible on the shared link)..."
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      rows={2}
                      autoFocus
                    />
                    <div className="note-editor-actions">
                      <button className="btn btn-primary btn-sm" onClick={() => saveNote(item.reels.id)}>
                        <Check size={12} /> Save
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={cancelEditingNote}>
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : item.note ? (
                  <div className="note-display" onClick={() => startEditingNote(item)}>
                    <StickyNote size={12} />
                    <span>{item.note}</span>
                    <span className="note-edit-hint">click to edit</span>
                  </div>
                ) : (
                  <button className="add-note-btn" onClick={() => startEditingNote(item)}>
                    <StickyNote size={12} /> Add a note
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
