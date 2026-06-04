import { useState } from 'react';
import { Eye, EyeOff, Heart, MessageCircle, ExternalLink, Check, Play, Loader2, X, AlertCircle } from 'lucide-react';
import SaveToTodo from './SaveToTodo';
import { api } from '../lib/api';
import './ReelCard.css';

function getScoreClass(score) {
  if (score >= 2) return 'score-high';
  if (score >= 1) return 'score-mid';
  return 'score-low';
}

function getScoreLabel(score) {
  if (score >= 3) return '🔥 Viral';
  if (score >= 2) return '⬆ Outlier';
  if (score >= 1) return '~ Normal';
  return '⬇ Below avg';
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 36e5);
  const d = Math.floor(diff / 864e5);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return 'Just now';
}

export default function ReelCard({ reel, rank, formatViews, onToggleSeen, prefetchedVideoUrl }) {
  const score = reel.outlier_score ?? 0;
  const isSeen = !!reel.seen_at;
  // Inline-player state machine. We fetch the IG video URL on demand —
  // it's signed and time-limited but valid for hours, more than enough
  // to watch one reel. The video streams direct from IG's CDN to the
  // user's browser, so no bandwidth flows through our backend.
  const [video, setVideo] = useState(
    prefetchedVideoUrl
      ? { state: 'ready', url: prefetchedVideoUrl }
      : { state: 'idle' }
  );

  const handleSeenClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onToggleSeen) onToggleSeen(reel.id, isSeen);
  };

  const handlePlay = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (video.state === 'playing' || video.state === 'loading') return;
    // If we already have a URL (from prefetch or a previous load) jump straight in
    if (video.state === 'ready' && video.url) {
      setVideo({ state: 'playing', url: video.url });
      return;
    }
    setVideo({ state: 'loading' });
    try {
      const data = await api.fetchReelForConverter(reel.url);
      if (!data?.video_url) throw new Error('No video URL returned');
      setVideo({ state: 'playing', url: data.video_url });
    } catch (err) {
      setVideo({ state: 'error', message: err.message || 'Could not load video' });
    }
  };

  const handleClosePlayer = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Keep the URL around so re-opening is instant — just hide the player
    setVideo((prev) => (prev.url ? { state: 'ready', url: prev.url } : { state: 'idle' }));
  };

  return (
    <div className={`reel-card ${isSeen ? 'reel-card-seen' : ''}`}>
      <div className="reel-rank">#{rank}</div>

      {/* Mark-seen button — top-right corner over thumbnail */}
      {onToggleSeen && (
        <button
          className={`reel-seen-btn ${isSeen ? 'active' : ''}`}
          onClick={handleSeenClick}
          title={isSeen ? 'Mark as unseen' : 'Mark as seen'}
          aria-label={isSeen ? 'Mark as unseen' : 'Mark as seen'}
        >
          {isSeen ? <Check size={14} /> : <EyeOff size={14} />}
        </button>
      )}

      <div className="reel-thumbnail">
        {video.state === 'playing' && video.url ? (
          <>
            <video
              src={video.url}
              controls
              autoPlay
              playsInline
              className="reel-video"
              // poster keeps something on screen during the network-buffer phase
              poster={reel.thumbnail_url || undefined}
              onError={() => setVideo({ state: 'error', message: 'Playback failed — IG link may have expired.' })}
            />
            <button
              className="reel-video-close"
              onClick={handleClosePlayer}
              title="Close player"
              aria-label="Close player"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="reel-thumb-btn"
            onClick={handlePlay}
            disabled={video.state === 'loading'}
            aria-label="Play reel"
          >
            {reel.thumbnail_url ? (
              <img src={reel.thumbnail_url} alt="reel thumbnail" loading="lazy" />
            ) : (
              <div className="reel-thumb-placeholder">📹</div>
            )}
            <span className="reel-thumb-overlay">
              {video.state === 'loading' ? (
                <Loader2 size={28} className="spin" />
              ) : video.state === 'error' ? (
                <span className="reel-thumb-error" title={video.message}>
                  <AlertCircle size={20} />
                </span>
              ) : (
                <Play size={28} fill="currentColor" />
              )}
            </span>
          </button>
        )}
        <div className={`reel-score-badge ${getScoreClass(score)}`}>
          {score.toFixed(2)}×
        </div>
      </div>

      <div className="reel-body">
        <div className="reel-creator">
          <div className="creator-avatar">
            {reel.creator?.profile_pic_url ? (
              <img src={reel.creator.profile_pic_url} alt={reel.creator.username} />
            ) : (
              <span>{reel.creator?.username?.[0]?.toUpperCase() ?? '?'}</span>
            )}
          </div>
          <div>
            <div className="creator-name">@{reel.creator?.username}</div>
            <div className="creator-avg">avg {formatViews(reel.creator_avg_views)} views</div>
          </div>
          <a href={reel.url} target="_blank" rel="noopener noreferrer" className="reel-link">
            <ExternalLink size={14} />
          </a>
        </div>

        {reel.caption && (
          <p className="reel-caption">{reel.caption.substring(0, 80)}{reel.caption.length > 80 ? '…' : ''}</p>
        )}

        <div className="reel-stats">
          <span><Eye size={13} /> {formatViews(reel.views)}</span>
          <span><Heart size={13} /> {formatViews(reel.likes)}</span>
          <span><MessageCircle size={13} /> {formatViews(reel.comments)}</span>
        </div>

        <div className="reel-footer">
          <span className={`score-pill ${getScoreClass(score)}`}>{getScoreLabel(score)}</span>
          <span className="reel-time">{timeAgo(reel.posted_at)}</span>
          <SaveToTodo reelId={reel.id} />
        </div>
      </div>
    </div>
  );
}
