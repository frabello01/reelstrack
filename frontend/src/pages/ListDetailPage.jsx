import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ArrowLeft, Plus, Trash2, UserPlus, RefreshCw } from 'lucide-react';
import './ListDetailPage.css';

export default function ListDetailPage() {
  const { id } = useParams();
  const [list, setList] = useState(null);
  const [allCreators, setAllCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [adding, setAdding] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [listData, creatorsData] = await Promise.all([
        api.getList(id),
        api.getCreators(),
      ]);
      setList(listData);
      setAllCreators(creatorsData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const listCreatorIds = new Set(
    (list?.list_creators || []).map((lc) => lc.creator_id)
  );

  const listCreators = (list?.list_creators || []).map((lc) => lc.creators).filter(Boolean);

  const handleAddCreator = async () => {
    if (!newUsername.trim()) return;
    setAdding(true);
    setError('');
    try {
      // Add or get creator
      const creator = await api.addCreator({ username: newUsername.trim().replace('@', '') });
      // Add to list
      await api.addCreatorToList(id, creator.id);
      setNewUsername('');
      setShowAddModal(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (creatorId) => {
    if (!confirm('Remove creator from this list?')) return;
    await api.removeCreatorFromList(id, creatorId);
    load();
  };

  const handleFetch = async () => {
    setFetching(true);
    try {
      await api.triggerFetch(id);
    } finally {
      setTimeout(() => setFetching(false), 2000);
    }
  };

  if (loading) return <div className="loading-screen" style={{ height: 300 }}><div className="spinner" /></div>;
  if (!list) return <div>List not found.</div>;

  return (
    <div className="list-detail">
      <div className="detail-header">
        <Link to="/lists" className="back-link"><ArrowLeft size={16} /> All Lists</Link>
        <div className="detail-title-row">
          <div className="detail-color-dot" style={{ background: list.color }} />
          <h1 className="page-title">{list.name}</h1>
        </div>
        {list.description && <p className="page-sub">{list.description}</p>}
      </div>

      <div className="detail-actions">
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <UserPlus size={15} /> Add Creator
        </button>
        <button className="btn btn-ghost" onClick={handleFetch} disabled={fetching}>
          <RefreshCw size={15} className={fetching ? 'spin' : ''} />
          {fetching ? 'Fetching...' : 'Fetch This List'}
        </button>
      </div>

      {listCreators.length === 0 ? (
        <div className="empty-state">
          <UserPlus size={48} />
          <h3>No creators yet</h3>
          <p>Add Instagram usernames to start tracking their reels</p>
        </div>
      ) : (
        <div className="creators-table">
          <div className="table-header">
            <span>Creator</span>
            <span>Avg Views (30d)</span>
            <span>Last Fetched</span>
            <span></span>
          </div>
          {listCreators.map((creator) => (
            <div key={creator.id} className="table-row">
              <div className="creator-cell">
                <div className="creator-avatar-sm">
                  {creator.profile_pic_url
                    ? <img src={creator.profile_pic_url} alt={creator.username} />
                    : <span>{creator.username[0].toUpperCase()}</span>
                  }
                </div>
                <div>
                  <div className="creator-username">@{creator.username}</div>
                  {creator.display_name && <div className="creator-display">{creator.display_name}</div>}
                </div>
              </div>
              <div className="table-cell">
                {creator.avg_views_30d
                  ? Number(creator.avg_views_30d).toLocaleString()
                  : <span style={{ color: 'var(--text2)' }}>—</span>
                }
              </div>
              <div className="table-cell text-muted">
                {creator.last_fetched_at
                  ? new Date(creator.last_fetched_at).toLocaleDateString()
                  : 'Never'
                }
              </div>
              <div className="table-cell">
                <button className="btn btn-danger btn-sm icon-btn" onClick={() => handleRemove(creator.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="modal">
            <h2 className="modal-title">Add Creator</h2>
            <div className="form-group">
              <label className="form-label">Instagram Username</label>
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="@username or username"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddCreator()}
              />
            </div>
            {error && <div className="login-error" style={{ marginTop: -8 }}>{error}</div>}
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => { setShowAddModal(false); setError(''); }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddCreator} disabled={adding || !newUsername}>
                {adding ? 'Adding...' : 'Add Creator'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
