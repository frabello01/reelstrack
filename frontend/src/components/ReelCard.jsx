import { Eye, EyeOff, Heart, MessageCircle, ExternalLink, Check } from 'lucide-react';
import SaveToTodo from './SaveToTodo';
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

export default function ReelCard({ reel, rank, formatViews, onToggleSeen }) {
  const score = reel.outlier_score ?? 0;
  const isSeen = !!reel.seen_at;

  const handleSeenClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onToggleSeen) onToggleSeen(reel.id, isSeen);
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
        {reel.thumbnail_url ? (
          <img src={reel.thumbnail_url} alt="reel thumbnail" loading="lazy" />
        ) : (
          <div className="reel-thumb-placeholder">📹</div>
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
