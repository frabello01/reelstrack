import { useEffect, useState, Fragment } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Trash2, RefreshCw, ExternalLink,
  TrendingUp, TrendingDown, Eye, Heart, Users, Film, Trophy, AlertTriangle, CheckCircle2,
  StickyNote, Check, X, ListChecks, MousePointerClick, UserPlus, DollarSign, Link2,
  EyeOff, ChevronDown, ChevronRight as ChevronRightIcon, Lock, HardDrive, Folder, Search, Loader2
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api } from '../lib/api';
import ImageUploader from '../components/ImageUploader';
import { formatMoney } from '../lib/format';
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
            {(m.banned_or_inactive_count ?? 0) > 0 && (
              <span className="banned-stat"> · {m.banned_or_inactive_count} banned/inactive</span>
            )}
            {(m.private_count ?? 0) > 0 && (
              <span className="private-stat"> · {m.private_count} private</span>
            )}
          </div>
          <LanguagePicker
            talentId={id}
            current={talent.language || 'it'}
            onChanged={(lang) => setTalent((t) => ({ ...t, language: lang }))}
          />
        </div>
        <button className="btn btn-secondary" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>

      <DriveFolderSection
        talentId={id}
        currentFolderId={talent.drive_folder_id}
        currentFolderName={talent.drive_folder_name}
        onSaved={(folder) => {
          // Mutate locally — avoids a full reload
          setTalent((t) => ({
            ...t,
            drive_folder_id: folder?.id || null,
            drive_folder_name: folder?.name || null,
          }));
        }}
      />

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
                  <div
                    title={(b.landings_count ?? 0) === 0
                      ? 'Nessuna landing collegata a questo profilo'
                      : `${b.landings_count} landing${b.landings_count === 1 ? '' : 's'} collegate`}
                    style={{ color: (b.landing_clicks ?? 0) > 0 ? '#f472b6' : undefined }}
                  >
                    <MousePointerClick size={11} /> {formatNum(b.landing_clicks ?? 0)}
                  </div>
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
        {talent.charts.subs_per_day && (
          <ChartCard
            title="Combined OF subscribers per day (last 30 days)"
            data={talent.charts.subs_per_day}
            type="bar"
            color="#34d399"
          />
        )}
      </div>

      {/* Infloww monetization summary */}
      {talent.infloww_creator_id && <InflowwSection talentId={talent.id} />}

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

// Subscribers by source — day / week / MTD breakdown with pie chart.
// Pulls from the Infloww sources endpoint; sources are taken from the
// `source` field Infloww sets on each tracking link (Instagram, Telegram,
// MistressAdvisor, OnlyFans, DTP, Twitter, ...).
const SOURCE_COLORS = {
  Instagram:        '#E1306C',
  Telegram:         '#0088CC',
  Twitter:          '#1DA1F2',
  X:                '#1DA1F2',
  OnlyFans:         '#00AFF0',
  MistressAdvisor:  '#a855f7',
  DTP:              '#ff8c42',
  Reddit:           '#FF4500',
  TikTok:           '#69C9D0',
  YouTube:          '#FF0000',
  Other:            '#94a3b8',
  Unknown:          '#94a3b8',
};
const FALLBACK_PALETTE = ['#a78bfa', '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#fb7185', '#22d3ee'];

function colorForSource(name, idx) {
  return SOURCE_COLORS[name] || FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}

function SubsBySourceSection({ talentId }) {
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    api.getInflowwSources(talentId, period)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({ by_source: [], total: 0, label: '—' }); });
    return () => { cancelled = true; };
  }, [talentId, period]);

  const PERIODS = [
    { key: 'day',   label: 'Ieri' },
    { key: 'week',  label: 'Settimana' },
    { key: 'month', label: 'Mese' },
  ];

  if (!data) {
    return (
      <div className="subs-by-source">
        <div className="subs-by-source-header">
          <h2>Subscribers per fonte</h2>
        </div>
        <div className="subs-by-source-loading">Caricamento…</div>
      </div>
    );
  }

  const rows = data.by_source.filter((s) => s.new_subs > 0);
  const totalPositive = rows.reduce((s, r) => s + r.new_subs, 0);

  return (
    <div className="subs-by-source">
      <div className="subs-by-source-header">
        <div>
          <h2>Subscribers per fonte</h2>
          <p className="subs-by-source-sub">
            {data.label} · {data.start_date === data.end_date
              ? data.start_date
              : `${data.start_date} → ${data.end_date}`}
          </p>
        </div>
        <div className="subs-by-source-period-tabs">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={`subs-period-btn ${period === p.key ? 'active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >{p.label}</button>
          ))}
        </div>
      </div>

      {data.by_source.length === 0 ? (
        <div className="subs-by-source-empty">
          Nessun tracking link Infloww registrato per questo creator.
        </div>
      ) : totalPositive === 0 ? (
        <div className="subs-by-source-empty">
          Nessun nuovo subscriber registrato nel periodo selezionato.
          {data.total === 0 && ' Servono almeno due snapshot consecutivi (uno al giorno) prima che le delta diventino calcolabili.'}
        </div>
      ) : (
        <div className="subs-by-source-content">
          <div className="subs-by-source-chart">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="new_subs"
                  nameKey="source"
                  innerRadius={45}
                  outerRadius={85}
                  paddingAngle={2}
                  stroke="rgba(0,0,0,0.25)"
                >
                  {rows.map((r, i) => (
                    <Cell key={r.source} fill={colorForSource(r.source, i)} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v, name) => [`${v} subs`, name]}
                  contentStyle={{ background: 'rgba(20, 22, 40, 0.95)', border: '1px solid rgba(167, 139, 250, 0.3)', borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: 'white' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="subs-by-source-total">
              <div className="subs-by-source-total-num">{totalPositive}</div>
              <div className="subs-by-source-total-label">subs totali</div>
            </div>
          </div>

          <div className="subs-by-source-table">
            <div className="subs-by-source-row subs-by-source-row-head">
              <span>Fonte</span>
              <span className="num">New subs</span>
              <span className="num">%</span>
            </div>
            {data.by_source.map((r, i) => {
              const pct = totalPositive > 0 ? (r.new_subs / totalPositive) * 100 : 0;
              return (
                <div key={r.source} className="subs-by-source-row">
                  <span className="subs-by-source-name">
                    <span className="subs-by-source-dot" style={{ background: colorForSource(r.source, i) }} />
                    {r.source}
                  </span>
                  <span className="num">{r.new_subs}</span>
                  <span className="num subs-by-source-pct">{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Inline-editable name for a tracking link. The displayed text is the
// local_name if set (with the Infloww-side name shown subtly underneath),
// otherwise the Infloww name. Clicking opens an inline input.
function InflowwLinkName({ link, onSaved }) {
  const display = link.local_name || link.name || '(senza nome)';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(link.local_name || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = value.trim();
    // No change? Just bail
    if ((trimmed || null) === (link.local_name || null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await api.renameInflowwLink(link.infloww_link_id, trimmed);
      onSaved?.(updated);
      setEditing(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="infloww-name-edit">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            else if (e.key === 'Escape') { setEditing(false); setValue(link.local_name || ''); }
          }}
          placeholder={link.name || 'Nome locale'}
          disabled={saving}
        />
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving} title="Salva">
          <Check size={12} />
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { setEditing(false); setValue(link.local_name || ''); }}
          disabled={saving}
          title="Annulla"
        >
          <X size={12} />
        </button>
      </div>
    );
  }
  return (
    <div
      className="infloww-row-name infloww-row-name-editable"
      onClick={() => { setValue(link.local_name || ''); setEditing(true); }}
      title="Clicca per rinominare"
    >
      {display}
      {link.local_name && link.name && link.local_name !== link.name && (
        <span className="infloww-original-name"> · {link.name}</span>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Infloww monetization section — lifetime subscribers + earnings
// pulled from Infloww's API, aggregated across all this talent's
// tracking links. Hidden if the talent isn't bound to Infloww.
// ----------------------------------------------------------------
// localStorage key for the user's earnings-display preference (net | gross)
const EARNINGS_MODE_KEY = 'infloww_earnings_mode';

function InflowwSection({ talentId }) {
  const [links, setLinks] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [snapshotsCache, setSnapshotsCache] = useState({}); // infloww_link_id -> snapshots[]
  const [busy, setBusy] = useState(null);
  // Net (default) shows what the creator actually receives after OF's cut.
  // Gross shows what the customer paid (Infloww-reported gross).
  const [earningsMode, setEarningsMode] = useState(() => {
    try { return localStorage.getItem(EARNINGS_MODE_KEY) || 'net'; }
    catch { return 'net'; }
  });
  const setEarningsModePersisted = (mode) => {
    setEarningsMode(mode);
    try { localStorage.setItem(EARNINGS_MODE_KEY, mode); } catch {}
  };
  // Pick the right earnings field for a single link based on the current mode
  const linkEarnings = (l) => Number((earningsMode === 'gross' ? l.earnings_gross : l.earnings_net) || 0);
  const earningsLabel = earningsMode === 'gross' ? 'Earnings (gross)' : 'Earnings (net)';

  const load = async () => {
    try {
      const rows = await api.getInflowwLinks(talentId);
      setLinks(rows || []);
    } catch (err) {
      setLinks([]);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [talentId]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.triggerInflowwSync(talentId);
      setTimeout(async () => { await load(); setSyncing(false); }, 2500);
    } catch (err) {
      alert(err.message);
      setSyncing(false);
    }
  };

  const handleToggleHidden = async (link) => {
    setBusy(link.infloww_link_id);
    try {
      await api.setInflowwLinkHidden(link.infloww_link_id, !link.hidden);
      setLinks((prev) => prev.map((l) =>
        l.infloww_link_id === link.infloww_link_id ? { ...l, hidden: !link.hidden } : l
      ));
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleToggleExpand = async (link) => {
    if (expandedId === link.infloww_link_id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(link.infloww_link_id);
    if (!snapshotsCache[link.infloww_link_id]) {
      try {
        const snaps = await api.getInflowwLinkSnapshots(link.infloww_link_id, 30);
        setSnapshotsCache((c) => ({ ...c, [link.infloww_link_id]: snaps }));
      } catch (err) {
        setSnapshotsCache((c) => ({ ...c, [link.infloww_link_id]: [] }));
      }
    }
  };

  if (links == null) return null;

  const visibleLinks = showHidden ? links : links.filter((l) => !l.hidden);
  const hiddenCount = links.filter((l) => l.hidden).length;

  // Aggregate ALL links (including hidden) for the lifetime totals — the
  // hidden flag is purely a display-time filter, not a data filter.
  const totalSubs = links.reduce((s, l) => s + (l.sub_count || 0), 0);
  const totalPaying = links.reduce((s, l) => s + (l.paying_fans_count || 0), 0);
  const totalEarnings = links.reduce((s, l) => s + linkEarnings(l), 0);
  const totalClicksInfloww = links.reduce((s, l) => s + (l.click_count || 0), 0);
  const blendedCvr = totalClicksInfloww > 0 ? (totalSubs / totalClicksInfloww) * 100 : null;
  const blendedLtv = totalSubs > 0 ? totalEarnings / totalSubs : null;
  const currency = links[0]?.currency || 'USD';

  return (
    <div className="infloww-section">
      <div className="infloww-section-header">
        <h2><Link2 size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Infloww — link-in-bio monetization</h2>
        <div className="infloww-header-actions">
          <div className="infloww-mode-toggle" role="group" aria-label="Earnings mode">
            <button
              className={earningsMode === 'net' ? 'active' : ''}
              onClick={() => setEarningsModePersisted('net')}
              title="Net: dopo la commissione di OnlyFans (default)"
            >Net</button>
            <button
              className={earningsMode === 'gross' ? 'active' : ''}
              onClick={() => setEarningsModePersisted('gross')}
              title="Gross: cifra pagata dal cliente, prima della commissione OF"
            >Gross</button>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw size={13} className={syncing ? 'spin' : ''} />
            {syncing ? 'Sincronizzo…' : 'Sync ora'}
          </button>
        </div>
      </div>

      <p className="infloww-section-hint">
        Dati lifetime estratti da Infloww (totale storico). Sincronizzazione automatica ogni notte;
        Infloww ritarda i dati di ~2 ore rispetto a OnlyFans. Apri una riga per vedere i nuovi sub giorno per giorno.
      </p>

      <div className="infloww-totals">
        <div className="infloww-total">
          <div className="infloww-total-label"><UserPlus size={13} /> Subscribers</div>
          <div className="infloww-total-num">{formatNum(totalSubs)}</div>
          <div className="infloww-total-sub">{formatNum(totalPaying)} paying</div>
        </div>
        <div className="infloww-total">
          <div className="infloww-total-label"><DollarSign size={13} /> {earningsLabel}</div>
          <div className="infloww-total-num">{formatMoney(totalEarnings, currency)}</div>
          <div className="infloww-total-sub">lifetime</div>
        </div>
        <div className="infloww-total">
          <div className="infloww-total-label"><DollarSign size={13} /> Avg LTV</div>
          <div className="infloww-total-num">{blendedLtv == null ? '—' : formatMoney(blendedLtv, currency)}</div>
          <div className="infloww-total-sub">per subscriber ({earningsMode})</div>
        </div>
        <div className="infloww-total">
          <div className="infloww-total-label"><MousePointerClick size={13} /> CVR</div>
          <div className="infloww-total-num">{blendedCvr == null ? '—' : `${blendedCvr.toFixed(2)}%`}</div>
          <div className="infloww-total-sub">subs / click</div>
        </div>
      </div>

      <SubsBySourceSection talentId={talentId} />

      {visibleLinks.length === 0 && hiddenCount === 0 ? (
        <div className="infloww-empty">
          Nessun tracking link trovato. Crea i tracking link su Infloww e clicca "Sync ora".
        </div>
      ) : (
        <>
        <div className="infloww-table-wrap">
          <table className="infloww-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Link</th>
                <th className="num">Clicks</th>
                <th className="num">Subs</th>
                <th className="num">Paying</th>
                <th className="num">{earningsLabel}</th>
                <th className="num">Avg LTV</th>
                <th className="num">CVR</th>
                <th>Collegato a</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {visibleLinks.map((l) => {
                const isExpanded = expandedId === l.infloww_link_id;
                const snaps = snapshotsCache[l.infloww_link_id];
                return (
                  <Fragment key={l.infloww_link_id}>
                    <tr
                      className={`${l.hidden ? 'infloww-row-hidden' : ''} ${isExpanded ? 'infloww-row-expanded' : ''}`}
                    >
                      <td>
                        <button
                          className="infloww-expand-btn"
                          onClick={() => handleToggleExpand(l)}
                          title={isExpanded ? 'Chiudi dettaglio giornaliero' : 'Vedi nuovi sub giorno per giorno'}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRightIcon size={14} />}
                        </button>
                      </td>
                      <td>
                        <InflowwLinkName
                          link={l}
                          onSaved={(updated) => setLinks((prev) => prev.map((x) =>
                            x.infloww_link_id === updated.infloww_link_id ? { ...x, ...updated } : x
                          ))}
                        />
                        <div className="infloww-row-code">
                          {l.code ? `/c${l.code}` : ''}
                          {l.source ? ` · ${l.source}` : ''}
                        </div>
                      </td>
                      <td className="num">{formatNum(l.click_count)}</td>
                      <td className="num">{formatNum(l.sub_count)}</td>
                      <td className="num">{formatNum(l.paying_fans_count)}</td>
                      <td className="num">{formatMoney(linkEarnings(l), l.currency || 'USD')}</td>
                      <td className="num">
                        {/* Avg LTV = earnings (in the active mode) / subs.
                            Undefined when a link has 0 subs — show "—". */}
                        {(l.sub_count || 0) > 0
                          ? formatMoney(linkEarnings(l) / l.sub_count, l.currency || 'USD')
                          : '—'}
                      </td>
                      <td className="num">
                        {l.subscription_cvr != null
                          ? <span className={Number(l.subscription_cvr) >= 1 ? 'cvr-good' : ''}>{Number(l.subscription_cvr).toFixed(2)}%</span>
                          : '—'}
                      </td>
                      <td>
                        {l.landing_links
                          ? <Link to={`/landings/${l.landing_links.landing_id}`} className="infloww-bound-link">{l.landing_links.label}</Link>
                          : <span className="infloww-unbound">non collegato</span>}
                      </td>
                      <td>
                        <button
                          className="infloww-hide-btn"
                          onClick={() => handleToggleHidden(l)}
                          disabled={busy === l.infloww_link_id}
                          title={l.hidden ? 'Mostra di nuovo' : 'Nascondi questo link'}
                        >
                          {l.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="infloww-detail-row">
                        <td></td>
                        <td colSpan={9}>
                          <DailySubsStrip snapshots={snaps} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {hiddenCount > 0 && (
          <button
            className="btn btn-ghost btn-sm infloww-show-hidden"
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden
              ? <><EyeOff size={13} /> Nascondi i link nascosti</>
              : <><Eye size={13} /> Mostra {hiddenCount} link nascost{hiddenCount === 1 ? 'o' : 'i'}</>}
          </button>
        )}
        </>
      )}
    </div>
  );
}

// Renders a horizontal scroll of date pills, one per day in the last 30,
// each showing the count of new subs for that day. Days where new_subs is
// null (e.g. the most recent day with no follow-up snapshot yet) show "—".
function DailySubsStrip({ snapshots }) {
  if (!snapshots) {
    return <div className="infloww-daily-loading">Caricamento…</div>;
  }
  if (snapshots.length === 0) {
    return <div className="infloww-daily-empty">Nessuno snapshot disponibile ancora.</div>;
  }
  // Reverse so newest comes first — easier to scan
  const rows = [...snapshots].reverse();
  const totalKnown = rows.reduce((s, r) => s + (r.new_subs || 0), 0);
  return (
    <div className="infloww-daily-strip-wrap">
      <div className="infloww-daily-strip-header">
        <span>Nuovi sub per giorno (ultimi 30 giorni)</span>
        <span className="infloww-daily-total">Totale finestra: <strong>+{totalKnown}</strong></span>
      </div>
      <div className="infloww-daily-strip">
        {rows.map((row) => {
          const d = new Date(row.date);
          const label = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
          const val = row.new_subs;
          const cls = val == null ? 'infloww-daily-na' : (val > 0 ? 'infloww-daily-pos' : 'infloww-daily-zero');
          return (
            <div key={row.date} className={`infloww-daily-pill ${cls}`} title={row.date}>
              <div className="infloww-daily-date">{label}</div>
              <div className="infloww-daily-val">{val == null ? '—' : (val >= 0 ? `+${val}` : `${val}`)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProfileStatusBadge({ status, small }) {
  const map = {
    active: { label: 'Active', className: 'status-active', icon: CheckCircle2 },
    inactive: { label: 'Banned/Removed', className: 'status-inactive', icon: AlertTriangle },
    private: { label: 'Private', className: 'status-private', icon: Lock },
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

// ============================================================
// DriveFolderSection — pick / validate the talent's Drive folder
// where creator-uploaded clips will land.
// ============================================================
function DriveFolderSection({ talentId, currentFolderId, currentFolderName, onSaved }) {
  const [driveStatus, setDriveStatus] = useState(null);
  const [folderId, setFolderId] = useState(currentFolderId || '');
  const [folderName, setFolderName] = useState(currentFolderName || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setFolderId(currentFolderId || '');
    setFolderName(currentFolderName || '');
  }, [currentFolderId, currentFolderName]);

  useEffect(() => {
    api.getDriveStatus().then(setDriveStatus).catch(() => setDriveStatus({ connected: false }));
  }, []);

  const dirty = (folderId || '') !== (currentFolderId || '');

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      let resolvedName = folderName;
      if (folderId.trim()) {
        const folder = await api.validateDriveFolder(folderId.trim());
        resolvedName = folder.name;
      } else {
        resolvedName = null;
      }
      const updated = await api.updateTalent(talentId, {
        drive_folder_id: folderId.trim() || null,
        drive_folder_name: resolvedName,
      });
      setFolderName(resolvedName || '');
      onSaved?.({ id: updated.drive_folder_id, name: updated.drive_folder_name });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('Rimuovere la cartella Drive da questo creator?')) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateTalent(talentId, {
        drive_folder_id: null,
        drive_folder_name: null,
      });
      setFolderId('');
      setFolderName('');
      onSaved?.({ id: null, name: null });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePicked = (folder) => {
    setFolderId(folder.id);
    setFolderName(folder.name);
    setPickerOpen(false);
  };

  if (driveStatus && !driveStatus.connected) {
    return (
      <div className="drive-folder-section">
        <div className="drive-folder-header">
          <HardDrive size={14} /> Cartella Google Drive
        </div>
        <div className="drive-folder-disconnected">
          Google Drive non è ancora connesso. Vai su <Link to="/settings">Settings</Link> per collegarlo.
        </div>
      </div>
    );
  }

  return (
    <div className="drive-folder-section">
      <div className="drive-folder-header">
        <HardDrive size={14} /> Cartella Google Drive
        <span className="drive-folder-hint">
          Dove finiscono i video che le creator caricano dai share link delle to-do list
        </span>
      </div>

      <div className="drive-folder-row">
        <input
          type="text"
          className="drive-folder-input"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          placeholder="ID cartella Drive (es. 1aB2cD3eF4gH...)"
          disabled={saving}
          spellCheck={false}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setPickerOpen(true)}
          disabled={saving}
          title="Sfoglia le tue cartelle Drive"
        >
          <Folder size={13} /> Sfoglia
        </button>
        {dirty && (
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Salva
          </button>
        )}
        {!dirty && currentFolderId && (
          <button className="btn btn-ghost btn-sm" onClick={handleClear} disabled={saving} title="Rimuovi cartella">
            <X size={12} />
          </button>
        )}
      </div>

      {folderName && !error && (
        <div className="drive-folder-current">
          <Folder size={12} /> <strong>{folderName}</strong>
        </div>
      )}
      {error && (
        <div className="drive-folder-error">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {pickerOpen && (
        <DriveFolderPicker
          onPick={handlePicked}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ----- DriveFolderPicker: lightweight searchable modal -----
function DriveFolderPicker({ onPick, onClose }) {
  const [folders, setFolders] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (q) => {
    setLoading(true);
    setError('');
    try {
      const list = await api.listDriveFolders(q);
      setFolders(list || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(''); }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => { load(query.trim()); }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="drive-picker-backdrop" onClick={onClose}>
      <div className="drive-picker" onClick={(e) => e.stopPropagation()}>
        <div className="drive-picker-header">
          <h3><Folder size={14} /> Scegli cartella Drive</h3>
          <button className="drive-picker-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="drive-picker-search">
          <Search size={13} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca per nome cartella…"
            autoFocus
          />
        </div>
        <div className="drive-picker-list">
          {loading ? (
            <div className="drive-picker-loading"><Loader2 size={16} className="spin" /></div>
          ) : error ? (
            <div className="drive-picker-error"><AlertTriangle size={13} /> {error}</div>
          ) : folders.length === 0 ? (
            <div className="drive-picker-empty">Nessuna cartella trovata</div>
          ) : (
            folders.map((f) => (
              <button key={f.id} className="drive-picker-item" onClick={() => onPick(f)}>
                <Folder size={13} />
                <span className="drive-picker-name">{f.name}</span>
                <span className="drive-picker-id">{f.id.slice(0, 12)}…</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LanguagePicker — flag buttons next to the talent name. Sets the
// language used by the public share page (PublicTodoPage) shown to
// this creator.
// ============================================================
function LanguagePicker({ talentId, current, onChanged }) {
  const [saving, setSaving] = useState(false);
  const LANGS = [
    { code: 'it', flag: '🇮🇹', label: 'Italiano' },
    { code: 'en', flag: '🇬🇧', label: 'English' },
    { code: 'es', flag: '🇪🇸', label: 'Español' },
  ];

  const set = async (code) => {
    if (saving || code === current) return;
    setSaving(true);
    try {
      await api.updateTalent(talentId, { language: code });
      onChanged?.(code);
    } catch (err) {
      alert(`Lingua non salvata: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lang-picker" title="Lingua mostrata sulla share page del creator">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          className={`lang-picker-btn ${current === l.code ? 'active' : ''}`}
          onClick={() => set(l.code)}
          disabled={saving}
          title={l.label}
          aria-label={l.label}
        >
          <span className="lang-flag">{l.flag}</span>
          <span className="lang-code">{l.code.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}
