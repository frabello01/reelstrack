import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ExternalLink, Eye, Heart, StickyNote, CheckCircle2, Play } from 'lucide-react';
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
  const [playingVideoUrl, setPlayingVideoUrl] = useState(null);

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
            {list.items.map((item, idx) => {
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
                  <div className="public-item-rank">#{idx + 1}</div>
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
                </div>
              );
            })}
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
