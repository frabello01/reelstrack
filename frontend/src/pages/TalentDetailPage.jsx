import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Trash2, RefreshCw, ExternalLink,
  TrendingUp, TrendingDown, Eye, Heart, Users, Film, Trophy, AlertTriangle, CheckCircle2,
  StickyNote, Check, X, ListChecks, MousePointerClick
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../lib/api';
import ImageUploader from '../components/ImageUploader';
import './TalentDetailPage.css';

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

function timeAgo(iso) {
  if (!iso) return '';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// Translate raw HikerAPI errors into something the user can act on
function humanizeStatusError(rawError) {
  if (!rawError) return '';
  const e = String(rawError).toLowerCase();
  if (e.includes('entries not found') || e.includes('user not found') || (e.includes('404') && e.includes('user'))) {
    return "Instagram couldn't find this username. Check the spelling, or the account may have been deleted/renamed.";
  }
  if (e.includes('private')) {
    return 'This account is private — public reel data is not available.';
  }
  if (e.includes('rate limit') || e.includes('429')) {
    return 'Hit Instagram rate limit. Try again in a few minutes.';
  }
  if (e.includes('login') || e.includes('challenge')) {
    return 'Instagram is challenging the connection. Will retry on the next daily cron.';
  }
  // Fallback: show the raw message but truncated
  return rawError.length > 140 ? rawError.slice(0, 140) + '…' : rawError;
}

function Delta({ current, previous, label }) {
  const pct = pctChange(current, previous);
  if (pct == null) return <span className="delta-text delta-neutral">no prior data</span>;
  if (pct === 0) return <span className="delta-text delta-neutral">no change vs {label}</span>;
  const positive = pct > 0;
  return (
    <span className={`delta-text ${positive ? 'delta-up' : 'delta-down'}`}>
      {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {positive ? '+' : ''}{pct}% vs {label}
    </span>
  );
}

const PERIODS = [
  { key: '7d', label: '7 days', comparisonLabel: 'previous 7 days' },
  { key: '14d', label: '14 days', comparisonLabel: 'previous 14 days' },
  { key: '30d', label: '30 days', comparisonLabel: 'previous 30 days' },
];

export default function TalentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [talent, setTalent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('7d');
  const [newProfile, setNewProfile] = useState('');
  const [addingProfile, setAddingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setTalent(await api.getTalent(id));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleAddProfile = async (e) => {
    e.preventDefault();
    if (!newProfile.trim()) return;
    setAddingProfile(true);
    setProfileError('');
    try {
      await api.addProfileToTalent(id, newProfile.trim());
      setNewProfile('');
      // Wait a bit for the initial fetch to populate data, then reload
      setTimeout(load, 3000);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setAddingProfile(false);
    }
  };

  const handleRemoveProfile = async (profileId, username) => {
    if (!confirm(`Remove @${username} from this creator? Snapshot history will be deleted.`)) return;
    await api.removeProfileFromTalent(id, profileId);
    load();
  };

  const handleRefresh = async () => {
    if (refreshing) return; // guard against double-clicks
    setRefreshing(true);
    try {
      await api.triggerTalentFetch(id);
      // The backend kicks off the fetch in the background — it usually takes
      // 10-60 seconds depending on how many profiles. We poll the talent
      // detail endpoint, looking for changes in last_fetched_at on the profiles.
      // After ~90 sec we give up and just reload once anyway.
      let attempts = 0;
      const initialFetched = (talent.profiles || [])
        .map((p) => p.last_fetched_at || '')
        .join(',');
      const interval = setInterval(async () => {
        attempts++;
        try {
          const fresh = await api.getTalent(id);
          const freshFetched = (fresh.profiles || [])
            .map((p) => p.last_fetched_at || '')
            .join(',');
          const dataChanged = freshFetched !== initialFetched;
          if (dataChanged || attempts >= 18) {
            clearInterval(interval);
            setTalent(fresh);
            setRefreshing(false);
          }
        } catch (err) {
          console.error('[refresh] poll error:', err.message);
          if (attempts >= 18) {
            clearInterval(interval);
            setRefreshing(false);
          }
        }
      }, 5000);
    } catch (err) {
      alert(`Refresh failed: ${err.message}`);
      setRefreshing(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!talent) return <div>Creator not found</div>;

  const m = talent.metrics[period] || {};
  const periodInfo = PERIODS.find((p) => p.key === period);
  const compareLabel = periodInfo?.comparisonLabel || '';

  return (
    <div className="talent-detail">
      <button className="back-btn" onClick={() => navigate('/my-creators')}>
        <ArrowLeft size={16} /> All my creators
      </button>

      <div className="talent-detail-header">
        <ImageUploader
          shape="circle"
          currentUrl={talent.profile_pic_url}
          placeholder="Add photo"
          onUpload={async (dataUrl) => {
            await api.uploadTalentProfilePic(id, dataUrl);
            load();
          }}
          onRemove={async () => {
            await api.removeTalentProfilePic(id);
            load();
          }}
        />
        <div className="talent-detail-info">
          <h1>{talent.name}</h1>
          <div className="talent-detail-stats">
            {talent.profiles.length} {talent.profiles.length === 1 ? 'profile' : 'profiles'}
            {m.active_profiles_count != null && m.active_profiles_count !== talent.profiles.length && (
              <span className="banned-stat"> · {talent.profiles.length - m.active_profiles_count} not active</span>
            )}
          </div>
        </div>
        <button className="btn btn-secondary" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>

      {/* Profiles management section */}
      <div className="profiles-section">
        <h2>IG Profiles</h2>
        <form className="add-profile-form" onSubmit={handleAddProfile}>
          <input
            type="text"
            placeholder="Add an IG username (e.g. bianca_jorio)"
            value={newProfile}
            onChange={(e) => setNewProfile(e.target.value)}
            disabled={addingProfile}
          />
          <button type="submit" className="btn btn-primary" disabled={addingProfile || !newProfile.trim()}>
            {addingProfile ? 'Adding...' : <><Plus size={14} /> Add profile</>}
          </button>
        </form>
        {profileError && <div className="add-error">{profileError}</div>}

        {talent.profiles.length === 0 ? (
          <div className="empty-profiles">No profiles yet. Add one above to start tracking.</div>
        ) : (
          <div className="profiles-list">
            {talent.profiles.map((p) => (
              <div key={p.id} className="profile-card">
                <div className="profile-row">
                  <Link to={`/my-accounts/${p.id}`} className="profile-row-main">
                    <div className="profile-avatar">
                      {p.profile_pic_url ? (
                        <img src={p.profile_pic_url} alt="" />
                      ) : (
                        <div className="profile-avatar-placeholder">{p.username[0]?.toUpperCase()}</div>
                      )}
                    </div>
                    <div className="profile-row-info">
                      <div className="profile-username">@{p.username}</div>
                      <div className="profile-row-meta">
                        <ProfileStatusBadge status={p.status} />
                        {p.follower_count != null && (
                          <span><Users size={11} /> {formatNum(p.follower_count)} followers</span>
                        )}
                        {p.last_fetched_at && (
                          <span className="last-fetched" title={`Last fetched: ${new Date(p.last_fetched_at).toLocaleString()}`}>
                            updated {timeAgo(p.last_fetched_at)}
                          </span>
                        )}
                      </div>
                      {p.status === 'error' && p.status_error && (
                        <div className="profile-error-detail">
                          <AlertTriangle size={11} />
                          <span>{humanizeStatusError(p.status_error)}</span>
                        </div>
                      )}
                    </div>
                  </Link>
                  <DailyTasksToggle
                    profileId={p.id}
                    initialEnabled={p.daily_tasks_enabled !== false}
                  />
                  <a
                    href={`https://www.instagram.com/${p.username}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="profile-row-btn"
                    onClick={(e) => e.stopPropagation()}
                    title="Open on Instagram"
                  >
                    <ExternalLink size={14} />
                  </a>
                  <button
                    className="profile-row-btn danger"
                    onClick={() => handleRemoveProfile(p.id, p.username)}
                    title="Remove profile"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <AccountInfoEditor profileId={p.id} initialValue={p.account_info} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Period selector */}
      <div className="period-tabs">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            className={`period-tab ${period === p.key ? 'active' : ''}`}
            onClick={() => setPeriod(p.key)}
          >
            Last {p.label}
          </button>
        ))}
      </div>

      {/* Aggregate metrics */}
      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-card-label"><Eye size={14} /> Cumulative views</div>
          <div className="metric-card-value">{formatNum(m.cumulative_views)}</div>
          <Delta current={m.cumulative_views} previous={m.cumulative_views_prev} label={compareLabel} />
        </div>
        <div className="metric-card">
          <div className="metric-card-label"><Film size={14} /> Reels published</div>
          <div className="metric-card-value">{m.reels_published ?? 0}</div>
          <Delta current={m.reels_published} previous={m.reels_published_prev} label={compareLabel} />
        </div>
        <div className="metric-card">
          <div className="metric-card-label"><Users size={14} /> Active followers</div>
          <div className="metric-card-value">{formatNum(m.total_followers_active)}</div>
          {m.lost_to_bans > 0 && (
            <span className="delta-text delta-down">
              <AlertTriangle size={12} /> −{formatNum(m.lost_to_bans)} lost to bans
            </span>
          )}
        </div>
        <div className="metric-card">
          <div className="metric-card-label"><Users size={14} /> Follower change</div>
          <div className="metric-card-value">
            {m.follower_delta != null
              ? (m.follower_delta >= 0 ? '+' : '') + formatNum(m.follower_delta)
              : '—'}
          </div>
          <Delta current={m.follower_delta} previous={m.follower_delta_prev} label={compareLabel} />
        </div>
        <div className="metric-card">
          <div className="metric-card-label"><Trophy size={14} /> Hits (10K+)</div>
          <div className="metric-card-value">{m.above_10k ?? 0}</div>
          <Delta current={m.above_10k} previous={m.above_10k_prev} label={compareLabel} />
        </div>
        <div className="metric-card">
          <div className="metric-card-label"><Trophy size={14} /> Big hits (50K+)</div>
          <div className="metric-card-value">{m.above_50k ?? 0}</div>
          <Delta current={m.above_50k} previous={m.above_50k_prev} label={compareLabel} />
        </div>
        <div className="metric-card">
          <div className="metric-card-label"><Trophy size={14} /> Viral (100K+)</div>
          <div className="metric-card-value">{m.above_100k ?? 0}</div>
          <Delta current={m.above_100k} previous={m.above_100k_prev} label={compareLabel} />
        </div>
        <div className="metric-card">
          <div className="metric-card-label"><MousePointerClick size={14} /> Landing clicks</div>
          <div className="metric-card-value">{formatNum(m.landing_clicks ?? 0)}</div>
          {(m.landings_count ?? 0) === 0
            ? <span className="delta-text delta-neutral">no landings yet</span>
            : <Delta current={m.landing_clicks} previous={m.landing_clicks_prev} label={compareLabel} />}
        </div>
      </div>

      {/* Per-profile contribution breakdown */}
      {m.breakdown && m.breakdown.length > 0 && (
        <div className="breakdown-section">
          <h2>Contribution by profile (last {periodInfo?.label})</h2>
          <div className="breakdown-grid">
            {m.breakdown.map((b) => (
              <div key={b.profile_id} className={`breakdown-row status-${b.status || 'unknown'}`}>
                <div className="breakdown-username">
                  @{b.username}
                  <ProfileStatusBadge status={b.status} small />
                </div>
                <div className="breakdown-stats">
                  <div><Eye size={11} /> {formatNum(b.cumulative_views)}</div>
                  <div><Film size={11} /> {b.reels_published}</div>
                  <div><Users size={11} /> {formatNum(b.follower_count)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="charts-grid">
        <ChartCard title="Combined views per day (last 30 days)" data={talent.charts.views_per_day} type="line" color="#a78bfa" />
        <ChartCard title="Active-profile followers (last 30 days)" data={talent.charts.followers_per_day} type="line" color="#60a5fa" />
        <ChartCard title="Reels published per day (last 30 days)" data={talent.charts.reels_per_day} type="bar" color="#34d399" />
        {talent.charts.clicks_per_day && (
          <ChartCard
            title="Combined landing clicks per day (last 30 days)"
            data={talent.charts.clicks_per_day}
            type="bar"
            color="#f472b6"
          />
        )}
      </div>

      {/* Top reels */}
      {talent.top_reels && talent.top_reels.length > 0 && (
        <div className="top-reels-section">
          <h2>Top reels (last 30 days, all profiles)</h2>
          <div className="top-reels-grid">
            {talent.top_reels.map((r) => (
              <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" className="top-reel">
                {r.thumbnail_url && <img src={r.thumbnail_url} alt="" />}
                <div className="top-reel-overlay">
                  <div className="top-reel-from">@{r.profile_username}</div>
                  <div className="top-reel-stats">
                    <span><Eye size={11} /> {formatNum(r.views)}</span>
                    <span><Heart size={11} /> {formatNum(r.likes)}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileStatusBadge({ status, small }) {
  const map = {
    active: { label: 'Active', className: 'status-active', icon: CheckCircle2 },
    inactive: { label: 'Banned/Removed', className: 'status-inactive', icon: AlertTriangle },
    private: { label: 'Private', className: 'status-private', icon: AlertTriangle },
    error: { label: 'Error', className: 'status-error', icon: AlertTriangle },
    unknown: { label: 'Pending', className: 'status-unknown', icon: null },
  };
  const info = map[status] || map.unknown;
  const Icon = info.icon;
  return (
    <span className={`status-badge ${info.className} ${small ? 'small' : ''}`}>
      {Icon && <Icon size={small ? 10 : 11} />}
      {info.label}
    </span>
  );
}

function ChartCard({ title, data, type, color }) {
  const hasData = data && data.length > 0 && data.some((d) => d.value != null);
  return (
    <div className="chart-card">
      <div className="chart-card-title">{title}</div>
      {!hasData ? (
        <div className="chart-empty">Not enough data yet — keep tracking.</div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          {type === 'bar' ? (
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }} tickFormatter={(d) => d.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'white' }} />
              <Bar dataKey="value" fill={color} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }} tickFormatter={(d) => d.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }} tickFormatter={(v) => formatNum(v)} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'white' }} formatter={(v) => formatNum(v)} />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  );
}

const tooltipStyle = {
  background: 'rgba(20, 22, 40, 0.95)',
  border: '1px solid rgba(167, 139, 250, 0.3)',
  borderRadius: 6,
  fontSize: 12,
  color: 'white',
};

// ----- AccountInfoEditor: inline editable note for each IG profile -----
// Free-text field for emails, phone numbers, recovery info, etc.
// NO PASSWORDS — that's by design. This is for non-sensitive context only.
function AccountInfoEditor({ profileId, initialValue }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue || '');
  const [saved, setSaved] = useState(initialValue || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (value === saved) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.updateMyAccountInfo(profileId, value || null);
      setSaved(value);
      setEditing(false);
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setValue(saved);
    setEditing(false);
    setError('');
  };

  if (editing) {
    return (
      <div className="account-info-editor">
        <div className="account-info-label">
          <StickyNote size={11} /> Account info (non-sensitive notes — no passwords)
        </div>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. [email protected] · phone +39 333 1234567 · recovery: [email protected]"
          rows={3}
          autoFocus
          disabled={saving}
        />
        <div className="account-info-actions">
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            <Check size={12} /> {saving ? 'Saving...' : 'Save'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleCancel} disabled={saving}>
            <X size={12} /> Cancel
          </button>
        </div>
        {error && <div className="account-info-error">{error}</div>}
      </div>
    );
  }

  if (saved) {
    return (
      <div className="account-info-display" onClick={() => setEditing(true)}>
        <StickyNote size={11} />
        <span>{saved}</span>
        <span className="account-info-edit-hint">click to edit</span>
      </div>
    );
  }

  return (
    <button className="account-info-add-btn" onClick={() => setEditing(true)}>
      <StickyNote size={11} /> Add account info (email, phone, recovery — no passwords)
    </button>
  );
}

// ----- DailyTasksToggle: per-profile opt-in for daily task generation -----
function DailyTasksToggle({ profileId, initialEnabled }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);

  const handleToggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const next = !enabled;
    setEnabled(next); // optimistic
    setPending(true);
    try {
      await api.toggleProfileDailyTasks(profileId, next);
    } catch (err) {
      setEnabled(!next); // revert
      alert(`Could not update: ${err.message}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      className={`daily-tasks-toggle ${enabled ? 'enabled' : 'disabled'}`}
      onClick={handleToggle}
      title={enabled
        ? 'Including this profile in daily tasks. Click to exclude (e.g. shadowbanned).'
        : 'Excluded from daily tasks. Click to include.'}
    >
      <ListChecks size={13} />
      <span>{enabled ? 'In daily tasks' : 'Excluded'}</span>
    </button>
  );
}
