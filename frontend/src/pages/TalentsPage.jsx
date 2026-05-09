import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, RefreshCw, TrendingUp, TrendingDown, Eye, Users, Film, AlertTriangle } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { api } from '../lib/api';
import './TalentsPage.css';

function formatNum(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toString();
}

function pctChange(current, previous) {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function DeltaBadge({ current, previous }) {
  const pct = pctChange(current, previous);
  if (pct == null) return <span className="delta delta-neutral">—</span>;
  if (pct === 0) return <span className="delta delta-neutral">0%</span>;
  const positive = pct > 0;
  return (
    <span className={`delta ${positive ? 'delta-up' : 'delta-down'}`}>
      {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {positive ? '+' : ''}{pct}%
    </span>
  );
}

export default function TalentsPage() {
  const [talents, setTalents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setTalents(await api.getTalents());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    setError('');
    try {
      await api.createTalent({ name: newName.trim() });
      setNewName('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (e, id, name) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete creator "${name}"? All their IG profiles and snapshot history will be deleted too.`)) return;
    await api.deleteTalent(id);
    load();
  };

  return (
    <div className="talents-page">
      <div className="talents-header">
        <div>
          <h1>My Creators</h1>
          <p className="subtitle">Track all the IG profiles you manage for each creator</p>
        </div>
      </div>

      <form className="add-talent-form" onSubmit={handleAdd}>
        <input
          type="text"
          placeholder="Add a creator name (e.g. Bianca, Jane Doe)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={adding}
        />
        <button type="submit" className="btn btn-primary" disabled={adding || !newName.trim()}>
          {adding ? 'Adding...' : <><Plus size={14} /> Add creator</>}
        </button>
      </form>
      {error && <div className="add-error">{error}</div>}

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : talents.length === 0 ? (
        <div className="empty-state">
          <p>No creators yet. Add one above to start tracking their performance.</p>
        </div>
      ) : (
        <div className="talent-cards">
          {talents.map((t) => (
            <Link to={`/my-creators/${t.id}`} key={t.id} className="talent-card">
              <div className="talent-card-header">
                <div className="talent-info">
                  <div className="talent-name">{t.name}</div>
                  <div className="talent-profile-count">
                    {t.profiles.length} {t.profiles.length === 1 ? 'profile' : 'profiles'}
                    {t.metrics_7d?.active_profiles_count != null && t.metrics_7d.active_profiles_count !== t.profiles.length && (
                      <span className="banned-tag"> · {t.profiles.length - t.metrics_7d.active_profiles_count} banned/inactive</span>
                    )}
                  </div>
                </div>
                <button
                  className="talent-delete-btn"
                  onClick={(e) => handleDelete(e, t.id, t.name)}
                  aria-label="Delete creator"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Profile chips */}
              {t.profiles.length > 0 && (
                <div className="profile-chips">
                  {t.profiles.map((p) => (
                    <div key={p.id} className={`profile-chip status-${p.status || 'unknown'}`} title={p.status}>
                      {p.profile_pic_url && <img src={p.profile_pic_url} alt="" />}
                      <span>@{p.username}</span>
                      {p.status && p.status !== 'active' && p.status !== 'unknown' && (
                        <AlertTriangle size={10} className="chip-warning" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="talent-card-body">
                <div className="metric-row">
                  <div className="metric">
                    <div className="metric-label"><Eye size={11} /> Views (7d)</div>
                    <div className="metric-value">{formatNum(t.metrics_7d?.cumulative_views)}</div>
                    <DeltaBadge current={t.metrics_7d?.cumulative_views} previous={t.metrics_7d?.cumulative_views_prev} />
                  </div>
                  <div className="metric">
                    <div className="metric-label"><Film size={11} /> Reels (7d)</div>
                    <div className="metric-value">{t.metrics_7d?.reels_published ?? 0}</div>
                    <DeltaBadge current={t.metrics_7d?.reels_published} previous={t.metrics_7d?.reels_published_prev} />
                  </div>
                  <div className="metric">
                    <div className="metric-label"><Users size={11} /> Active followers</div>
                    <div className="metric-value">{formatNum(t.metrics_7d?.total_followers_active)}</div>
                    {t.metrics_7d?.lost_to_bans > 0 && (
                      <span className="lost-to-bans">−{formatNum(t.metrics_7d.lost_to_bans)} lost to bans</span>
                    )}
                  </div>
                </div>

                {t.sparkline && t.sparkline.length > 0 && (
                  <div className="sparkline">
                    <ResponsiveContainer width="100%" height={40}>
                      <LineChart data={t.sparkline}>
                        <Line type="monotone" dataKey="value" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
