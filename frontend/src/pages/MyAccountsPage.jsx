import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, RefreshCw, TrendingUp, TrendingDown, Eye, Users, Film } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { api } from '../lib/api';
import './MyAccountsPage.css';

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

export default function MyAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setAccounts(await api.getMyAccounts());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newUsername.trim()) return;
    setAdding(true);
    setError('');
    try {
      await api.addMyAccount({ username: newUsername.trim() });
      setNewUsername('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, username) => {
    if (!confirm(`Remove @${username} from your accounts? All snapshot history will be deleted.`)) return;
    await api.deleteMyAccount(id);
    load();
  };

  const handleRefresh = async () => {
    await api.triggerMyAccountsFetch();
    setTimeout(load, 3000);
  };

  return (
    <div className="my-accounts-page">
      <div className="my-accounts-header">
        <div>
          <h1>My Accounts</h1>
          <p className="subtitle">Daily performance tracking for accounts you manage</p>
        </div>
        <button className="btn btn-secondary" onClick={handleRefresh}>
          <RefreshCw size={14} /> Refresh now
        </button>
      </div>

      <form className="add-account-form" onSubmit={handleAdd}>
        <input
          type="text"
          placeholder="Add an Instagram username (e.g. mybrand)"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          disabled={adding}
        />
        <button type="submit" className="btn btn-primary" disabled={adding || !newUsername.trim()}>
          {adding ? 'Adding...' : <><Plus size={14} /> Add account</>}
        </button>
      </form>
      {error && <div className="add-error">{error}</div>}

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : accounts.length === 0 ? (
        <div className="empty-state">
          <p>No accounts yet. Add one above to start tracking its daily performance.</p>
        </div>
      ) : (
        <div className="account-cards">
          {accounts.map((acc) => (
            <Link to={`/my-accounts/${acc.id}`} key={acc.id} className="account-card">
              <div className="account-card-header">
                <div className="account-avatar">
                  {acc.profile_pic_url ? (
                    <img src={acc.profile_pic_url} alt="" />
                  ) : (
                    <div className="account-avatar-placeholder">
                      {acc.username[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="account-info">
                  <div className="account-username">@{acc.username}</div>
                  {acc.display_name && acc.display_name !== acc.username && (
                    <div className="account-display-name">{acc.display_name}</div>
                  )}
                  <div className="account-followers">
                    <Users size={11} /> {formatNum(acc.follower_count)} followers
                  </div>
                </div>
                <button
                  className="account-delete-btn"
                  onClick={(e) => { e.preventDefault(); handleDelete(acc.id, acc.username); }}
                  aria-label="Remove account"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="account-card-body">
                <div className="metric-row">
                  <div className="metric">
                    <div className="metric-label"><Eye size={11} /> Views (7d)</div>
                    <div className="metric-value">{formatNum(acc.metrics_7d?.cumulative_views)}</div>
                    <DeltaBadge
                      current={acc.metrics_7d?.cumulative_views}
                      previous={acc.metrics_7d?.cumulative_views_prev}
                    />
                  </div>
                  <div className="metric">
                    <div className="metric-label"><Film size={11} /> Reels (7d)</div>
                    <div className="metric-value">{acc.metrics_7d?.reels_published ?? 0}</div>
                    <DeltaBadge
                      current={acc.metrics_7d?.reels_published}
                      previous={acc.metrics_7d?.reels_published_prev}
                    />
                  </div>
                  <div className="metric">
                    <div className="metric-label"><Users size={11} /> Followers (7d)</div>
                    <div className="metric-value">
                      {acc.metrics_7d?.follower_delta != null
                        ? (acc.metrics_7d.follower_delta >= 0 ? '+' : '') + formatNum(acc.metrics_7d.follower_delta)
                        : '—'}
                    </div>
                    <DeltaBadge
                      current={acc.metrics_7d?.follower_delta}
                      previous={acc.metrics_7d?.follower_delta_prev}
                    />
                  </div>
                </div>

                {acc.sparkline && acc.sparkline.length > 0 && (
                  <div className="sparkline">
                    <ResponsiveContainer width="100%" height={40}>
                      <LineChart data={acc.sparkline}>
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#a78bfa"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
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
