import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { RefreshCw, TrendingUp, Eye, Film, Clock, ChevronDown } from 'lucide-react';
import ReelCard from '../components/ReelCard';
import './DashboardPage.css';

const DAY_OPTIONS = [
  { label: 'Last 24h', value: '1' },
  { label: 'Last 14 days', value: '14' },
  { label: 'Last 30 days', value: '30' },
];

export default function DashboardPage() {
  const [reels, setReels] = useState([]);
  const [lists, setLists] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);

  const [selectedList, setSelectedList] = useState('');
  const [days, setDays] = useState('30');
  const [sort, setSort] = useState('outlier_score');

  const loadReels = useCallback(async () => {
    setLoading(true);
    try {
      const params = { days, sort, limit: 100 };
      if (selectedList) params.list_id = selectedList;
      const [reelsData, statsData] = await Promise.all([
        api.getReels(params),
        api.getStats(selectedList ? { list_id: selectedList } : {}),
      ]);
      setReels(reelsData.data || []);
      setStats(statsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedList, days, sort]);

  useEffect(() => {
    api.getLists().then(setLists).catch(console.error);
  }, []);

  useEffect(() => {
    loadReels();
  }, [loadReels]);

  const handleFetch = async () => {
    setFetching(true);
    try {
      await api.triggerFetch(selectedList || undefined);
      setTimeout(() => {
        loadReels();
        setFetching(false);
      }, 3000);
    } catch (err) {
      setFetching(false);
    }
  };

  const formatViews = (n) => {
    if (!n) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1 className="page-title">Reels Dashboard</h1>
          <p className="page-sub">Ranked by outlier score — how much a reel outperforms the creator's average</p>
        </div>
        <button className="btn btn-primary" onClick={handleFetch} disabled={fetching}>
          <RefreshCw size={15} className={fetching ? 'spin' : ''} />
          {fetching ? 'Fetching...' : 'Fetch Now'}
        </button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="stats-row">
          <div className="stat-card">
            <TrendingUp size={18} className="stat-icon green" />
            <div>
              <div className="stat-value">{stats.top_outlier_score?.toFixed(2) ?? '—'}×</div>
              <div className="stat-label">Top Outlier Score</div>
            </div>
          </div>
          <div className="stat-card">
            <Film size={18} className="stat-icon purple" />
            <div>
              <div className="stat-value">{stats.total_reels ?? '—'}</div>
              <div className="stat-label">Reels Tracked</div>
            </div>
          </div>
          <div className="stat-card">
            <Clock size={18} className="stat-icon yellow" />
            <div>
              <div className="stat-value">{stats.last_fetch ? formatDate(stats.last_fetch) : 'Never'}</div>
              <div className="stat-label">Last Fetch</div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="filters-bar">
        <div className="filter-group">
          <label>List</label>
          <div className="select-wrap">
            <select value={selectedList} onChange={(e) => setSelectedList(e.target.value)}>
              <option value="">All Lists</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
        </div>
        <div className="filter-group">
          <label>Time Window</label>
          <div className="day-pills">
            {DAY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`day-pill ${days === opt.value ? 'active' : ''}`}
                onClick={() => setDays(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <label>Sort by</label>
          <div className="select-wrap">
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="outlier_score">Outlier Score</option>
              <option value="views">Views</option>
              <option value="posted_at">Most Recent</option>
            </select>
            <ChevronDown size={14} />
          </div>
        </div>
      </div>

      {/* Reels grid */}
      {loading ? (
        <div className="loading-screen" style={{ height: 300 }}><div className="spinner" /></div>
      ) : reels.length === 0 ? (
        <div className="empty-state">
          <Film size={48} />
          <h3>No reels yet</h3>
          <p>Add creators to a list and hit "Fetch Now" to pull their reels.</p>
          <Link to="/lists" className="btn btn-primary" style={{ marginTop: 8 }}>Manage Lists</Link>
        </div>
      ) : (
        <div className="reels-grid">
          {reels.map((reel, i) => (
            <ReelCard key={reel.id} reel={reel} rank={i + 1} formatViews={formatViews} />
          ))}
        </div>
      )}
    </div>
  );
}
