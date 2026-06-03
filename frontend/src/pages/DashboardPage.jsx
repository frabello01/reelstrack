import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { RefreshCw, TrendingUp, Eye, Film, Clock, ChevronDown, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react';
import ReelCard from '../components/ReelCard';
import './DashboardPage.css';

const PAGE_SIZE = 100;

const DAY_OPTIONS = [
  { label: 'Last 24h', value: '1' },
  { label: 'Last 14 days', value: '14' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
];

const SEEN_OPTIONS = [
  { label: 'Unseen only', value: 'unseen' },
  { label: 'Seen only', value: 'seen' },
  { label: 'All', value: 'all' },
];

export default function DashboardPage() {
  const [reels, setReels] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [lists, setLists] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);

  const [selectedList, setSelectedList] = useState('');
  const [days, setDays] = useState('30');
  // Defaults requested: sort by Views, Unseen only, 30 days, with the
  // user-chosen default list applied on first mount.
  const [sort, setSort] = useState('views');
  const [seenFilter, setSeenFilter] = useState('unseen');
  const [page, setPage] = useState(0); // zero-indexed
  // Track whether we've applied the default list yet, so manual changes
  // by the user aren't overwritten if settings reload later.
  const [defaultApplied, setDefaultApplied] = useState(false);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const offset = page * PAGE_SIZE;

  const loadReels = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        days,
        sort,
        limit: PAGE_SIZE,
        offset,
        seen_filter: seenFilter,
      };
      if (selectedList) params.list_id = selectedList;
      const [reelsData, statsData] = await Promise.all([
        api.getReels(params),
        api.getStats(selectedList ? { list_id: selectedList } : {}),
      ]);
      setReels(reelsData.data || []);
      setTotalCount(reelsData.count || 0);
      setStats(statsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedList, days, sort, seenFilter, offset]);

  useEffect(() => {
    api.getLists().then(setLists).catch(console.error);
    // Apply the user-configured default list once on mount.
    api.getSettings().then((s) => {
      if (s?.default_list_id && !defaultApplied) {
        setSelectedList(s.default_list_id);
        setDefaultApplied(true);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever filters change, jump back to page 0
  useEffect(() => {
    setPage(0);
  }, [selectedList, days, sort, seenFilter]);

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

  const handleToggleSeen = async (reelId, currentlySeen) => {
    const newSeen = !currentlySeen;
    setReels((prev) => {
      if (seenFilter === 'unseen' && newSeen) return prev.filter((r) => r.id !== reelId);
      if (seenFilter === 'seen' && !newSeen) return prev.filter((r) => r.id !== reelId);
      return prev.map((r) =>
        r.id === reelId ? { ...r, seen_at: newSeen ? new Date().toISOString() : null } : r
      );
    });
    try {
      await api.setReelSeen(reelId, newSeen);
    } catch (err) {
      console.error('[seen] toggle failed, reloading:', err.message);
      loadReels();
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
        <div className="filter-group">
          <label>Seen state</label>
          <div className="day-pills">
            {SEEN_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`day-pill ${seenFilter === opt.value ? 'active' : ''}`}
                onClick={() => setSeenFilter(opt.value)}
              >
                {opt.value === 'unseen' && <EyeOff size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-screen" style={{ height: 300 }}><div className="spinner" /></div>
      ) : reels.length === 0 ? (
        <div className="empty-state">
          <Film size={48} />
          {seenFilter === 'unseen' ? (
            <>
              <h3>You're all caught up!</h3>
              <p>Nothing new to review. Either no fresh reels yet — or come back after the next daily fetch.</p>
              <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setSeenFilter('all')}>
                Show all reels (including seen)
              </button>
            </>
          ) : (
            <>
              <h3>No reels yet</h3>
              <p>Add creators to a list and hit "Fetch Now" to pull their reels.</p>
              <Link to="/lists" className="btn btn-primary" style={{ marginTop: 8 }}>Manage Lists</Link>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="reels-grid">
            {reels.map((reel, i) => (
              <ReelCard
                key={reel.id}
                reel={reel}
                rank={offset + i + 1}
                formatViews={formatViews}
                onToggleSeen={handleToggleSeen}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={PAGE_SIZE}
              onPageChange={(p) => {
                setPage(p);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ----- Pagination component -----
function Pagination({ page, totalPages, totalCount, pageSize, onPageChange }) {
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, totalCount);

  // Build a compact page-number list with ellipses for many pages.
  const buildPages = () => {
    const pages = [];
    const max = totalPages;
    const cur = page + 1; // 1-indexed for display

    if (max <= 7) {
      for (let i = 1; i <= max; i++) pages.push(i);
      return pages;
    }
    pages.push(1);
    if (cur > 4) pages.push('…');
    const startN = Math.max(2, cur - 2);
    const endN = Math.min(max - 1, cur + 2);
    for (let i = startN; i <= endN; i++) pages.push(i);
    if (cur < max - 3) pages.push('…');
    pages.push(max);
    return pages;
  };

  return (
    <div className="pagination">
      <div className="pagination-info">
        Showing <strong>{start.toLocaleString()}–{end.toLocaleString()}</strong> of <strong>{totalCount.toLocaleString()}</strong>
      </div>
      <div className="pagination-controls">
        <button
          className="page-btn"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        {buildPages().map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="page-ellipsis">…</span>
          ) : (
            <button
              key={p}
              className={`page-btn page-num ${p === page + 1 ? 'active' : ''}`}
              onClick={() => onPageChange(p - 1)}
            >
              {p}
            </button>
          )
        )}
        <button
          className="page-btn"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages - 1}
          aria-label="Next page"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
