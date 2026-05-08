import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ExternalLink, Eye, Heart, StickyNote, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import './PublicTodoPage.css';

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
          <img src="/logo.png" alt="Creator Advisor" className="public-logo" />
          <h1>{list.name}</h1>
          <div className="public-progress">
            <div className="public-progress-bar">
              <div className="public-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="public-progress-text">{doneCount} of {total} done</div>
          </div>
        </header>

        {list.items.length === 0 ? (
          <div className="public-empty">
            <p>No reels in this list yet.</p>
          </div>
        ) : (
          <div className="public-items">
            {list.items.map((item) => (
              <div key={item.id} className={`public-item ${item.is_done ? 'done' : ''}`}>
                <button
                  className="public-checkbox"
                  onClick={() => toggleDone(item)}
                  aria-label={item.is_done ? 'Mark as not done' : 'Mark as done'}
                >
                  {item.is_done ? <CheckCircle2 size={22} /> : <div className="public-checkbox-empty" />}
                </button>
                <div className="public-item-thumb">
                  {item.reels?.thumbnail_url && <img src={item.reels.thumbnail_url} alt="" />}
                </div>
                <div className="public-item-info">
                  <div className="public-item-creator">
                    {item.reels?.creators?.username
                      ? `@${item.reels.creators.username}`
                      : 'Reel'}
                  </div>
                  {item.reels?.caption && (
                    <div className="public-item-caption">
                      {item.reels.caption.substring(0, 100)}
                    </div>
                  )}
                  <div className="public-item-stats">
                    <span><Eye size={12} /> {formatViews(item.reels?.views)}</span>
                    <span><Heart size={12} /> {formatViews(item.reels?.likes)}</span>
                  </div>
                  {item.note && (
                    <div className="public-note">
                      <StickyNote size={12} />
                      <span>{item.note}</span>
                    </div>
                  )}
                </div>
                <a
                  href={item.reels?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="public-item-link"
                  aria-label="Open reel on Instagram"
                >
                  <ExternalLink size={16} />
                </a>
              </div>
            ))}
          </div>
        )}

        <footer className="public-footer">
          <p>Tap the circle to mark a reel as done.</p>
        </footer>
      </div>
    </div>
  );
}
