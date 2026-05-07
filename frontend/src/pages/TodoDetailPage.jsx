import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Trash2, Eye, Heart } from 'lucide-react';
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

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!list) return <div>Not found</div>;

  return (
    <div className="todo-detail">
      <button className="back-btn" onClick={() => navigate('/todos')}>
        <ArrowLeft size={16} /> All to-do lists
      </button>

      <div className="todo-detail-header">
        <h1>{list.name}</h1>
        <div className="todo-detail-stats">
          {list.items.filter((i) => i.is_done).length} / {list.items.length} done
        </div>
      </div>

      {list.items.length === 0 ? (
        <div className="empty-state">
          <p>No reels saved yet. Add reels from the dashboard using the bookmark icon.</p>
        </div>
      ) : (
        <div className="todo-items">
          {list.items.map((item) => (
            <div key={item.id} className={`todo-item ${item.is_done ? 'done' : ''}`}>
              <input
                type="checkbox"
                checked={item.is_done}
                onChange={() => toggleDone(item)}
              />
              <div className="todo-item-thumb">
                {item.reels?.thumbnail_url && <img src={item.reels.thumbnail_url} alt="" />}
              </div>
              <div className="todo-item-info">
                <div className="todo-item-creator">@{item.reels?.creators?.username}</div>
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
          ))}
        </div>
      )}
    </div>
  );
}
