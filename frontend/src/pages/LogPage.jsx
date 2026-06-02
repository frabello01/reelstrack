import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ScrollText, Loader2, AlertCircle, Filter, X, ChevronDown, Search,
  Users as UsersIcon, Tag, ArrowDown, RefreshCw, User as UserIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { humanizeLogEntry } from '../lib/logHumanizer';
import './LogPage.css';

const SECTION_LABELS = {
  'todos': '✅ To-Dos',
  'creator-lists': '📋 Creator Lists',
  'reels': '🎬 Reels',
  'my-creators': '👥 My Creators',
  'my-accounts': '🪪 My Accounts',
  'daily-tasks': '☀️ My Day',
  'guides': '📚 Guides',
  'studio': '🎥 Studio',
  'characters': '🧑‍🎤 Characters',
  'team': '👤 Team',
  'settings': '⚙️ Settings',
  'tools': '🛠️ Tools',
  'other': '· Other',
};

const ACTION_LABELS = {
  'create': 'created',
  'update': 'updated',
  'delete': 'deleted',
  'mark-complete': 'marked complete',
  'unmark-complete': 'unmarked complete',
  'invite': 'invited',
  'move': 'moved',
  'copy': 'copied',
  'pin': 'pinned',
  'reorder': 'reordered',
  'mark-seen': 'marked seen',
  'generate': 'generated',
  'clean': 'cleaned',
  'trigger-fetch': 'triggered fetch',
  'upload-init': 'started upload',
  'upload-finalize': 'finalized upload',
};

const PAGE_SIZE = 100;

export default function LogPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [sections, setSections] = useState([]);
  const [users, setUsers] = useState([]);

  // Filters
  const [filterUser, setFilterUser] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
      return;
    }
    loadFilters();
    loadEntries(true);
  }, [isAdmin, navigate]);

  // Reload when filters change
  useEffect(() => {
    if (!isAdmin) return;
    loadEntries(true);
  }, [filterUser, filterSection, searchQuery]); // eslint-disable-line

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadFilters = async () => {
    try {
      const [s, u] = await Promise.all([
        api.getActivityLogSections(),
        api.getActivityLogUsers(),
      ]);
      setSections(s.sections || []);
      setUsers(u.users || []);
    } catch (err) {
      console.warn('Could not load filter options:', err.message);
    }
  };

  const loadEntries = async (reset = false) => {
    if (reset) {
      setLoading(true);
      setEntries([]);
    } else {
      setLoadingMore(true);
    }
    try {
      const params = { limit: PAGE_SIZE };
      if (!reset && entries.length > 0) {
        params.before = entries[entries.length - 1].created_at;
      }
      if (filterUser) params.user_id = filterUser;
      if (filterSection) params.section = filterSection;
      if (searchQuery) params.q = searchQuery;
      const data = await api.getActivityLog(params);
      const newEntries = data.entries || [];
      setEntries((prev) => reset ? newEntries : [...prev, ...newEntries]);
      setHasMore(newEntries.length === PAGE_SIZE);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Group entries by date for clean display
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const entry of entries) {
      const dateKey = formatDateKey(entry.created_at);
      if (!groups.has(dateKey)) groups.set(dateKey, []);
      groups.get(dateKey).push(entry);
    }
    return Array.from(groups.entries());
  }, [entries]);

  const clearFilters = () => {
    setFilterUser('');
    setFilterSection('');
    setSearchInput('');
    setSearchQuery('');
  };

  const hasActiveFilters = filterUser || filterSection || searchQuery;

  if (!isAdmin) return null;

  return (
    <div className="log-page">
      <header className="log-header">
        <div>
          <h1><ScrollText size={22} /> Activity Log</h1>
          <p className="log-subtitle">
            Everything every team member does, grouped by section. Auto-pruned after 90 days.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => { loadEntries(true); loadFilters(); }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </header>

      {error && (
        <div className="log-error"><AlertCircle size={14} /> {error}</div>
      )}

      {/* Filter bar */}
      <div className="log-filters">
        <div className="log-filter">
          <UserIcon size={13} />
          <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.user_id || u.id} value={u.user_id || u.id}>
                {u.display_name}{!u.is_active ? ' (deactivated)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="log-filter">
          <Tag size={13} />
          <select value={filterSection} onChange={(e) => setFilterSection(e.target.value)}>
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s} value={s}>{SECTION_LABELS[s] || s}</option>
            ))}
          </select>
        </div>

        <div className="log-filter log-filter-search">
          <Search size={13} />
          <input
            type="text"
            placeholder="Search action, target name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        {hasActiveFilters && (
          <button className="log-clear-btn" onClick={clearFilters}>
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {/* Entries */}
      {loading ? (
        <div className="log-loading-block">
          <Loader2 size={20} className="spin" />
          <span>Loading activity…</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="log-empty">
          <ScrollText size={28} />
          <h3>No activity</h3>
          <p>
            {hasActiveFilters
              ? 'No entries match your current filters.'
              : 'Once your team starts using the app, their actions will show here.'}
          </p>
          {hasActiveFilters && (
            <button className="btn btn-secondary btn-sm" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="log-entries">
            {grouped.map(([dateLabel, entriesForDate]) => (
              <section key={dateLabel} className="log-date-group">
                <h2 className="log-date-header">{dateLabel}</h2>
                <div className="log-date-entries">
                  {entriesForDate.map((entry) => (
                    <LogEntry key={entry.id} entry={entry} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {hasMore && (
            <div className="log-load-more">
              <button
                className="btn btn-secondary"
                onClick={() => loadEntries(false)}
                disabled={loadingMore}
              >
                {loadingMore
                  ? <><Loader2 size={13} className="spin" /> Loading…</>
                  : <><ArrowDown size={13} /> Load older entries</>}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// LOG ENTRY
// ============================================================
function LogEntry({ entry }) {
  const sectionLabel = SECTION_LABELS[entry.section] || entry.section;
  const humanAction = humanizeLogEntry(entry);
  const timeStr = new Date(entry.created_at).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });
  // Raw method+path is technical info — useful to admins debugging, but
  // visually noisy. Surface it only on hover via title attribute.
  const pathTooltip = entry.method && entry.path ? `${entry.method} ${entry.path}` : '';

  return (
    <div className="log-entry">
      <div className="log-entry-time">{timeStr}</div>
      <div className="log-entry-section">{sectionLabel}</div>
      <div className="log-entry-body">
        <div className="log-entry-line" title={pathTooltip}>
          <span className="log-entry-user">{entry.user_name || 'Unknown'}</span>
          <span className="log-entry-action">{humanAction}</span>
          {entry.target_name && (
            <span className="log-entry-target">"{entry.target_name}"</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// UTIL
// ============================================================
function formatDateKey(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dStart = new Date(d);
  dStart.setHours(0, 0, 0, 0);

  if (dStart.getTime() === today.getTime()) return 'Today';
  if (dStart.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: today.getFullYear() !== d.getFullYear() ? 'numeric' : undefined,
  });
}
