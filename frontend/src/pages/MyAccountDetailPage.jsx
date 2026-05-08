import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, TrendingUp, TrendingDown, Eye, Heart, Users, Film, Trophy } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../lib/api';
import './MyAccountDetailPage.css';

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

function MetricCard({ icon, label, value, prevValue, comparisonLabel }) {
  return (
    <div className="metric-card">
      <div className="metric-card-label">{icon} {label}</div>
      <div className="metric-card-value">{value}</div>
      <Delta current={value === '—' ? null : parseFloat(String(value).replace(/[^0-9.-]/g, ''))} previous={prevValue} label={comparisonLabel} />
    </div>
  );
}

const PERIODS = [
  { key: '7d', label: '7 days', comparisonLabel: 'previous 7 days' },
  { key: '14d', label: '14 days', comparisonLabel: 'previous 14 days' },
  { key: '30d', label: '30 days', comparisonLabel: 'previous 30 days' },
];

export default function MyAccountDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('7d');

  const load = async () => {
    setLoading(true);
    try {
      setAccount(await api.getMyAccount(id));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!account) return <div>Account not found</div>;

  const m = account.metrics[period] || {};
  const periodInfo = PERIODS.find((p) => p.key === period);
  const compareLabel = periodInfo?.comparisonLabel || '';

  return (
    <div className="account-detail">
      <button className="back-btn" onClick={() => navigate('/my-accounts')}>
        <ArrowLeft size={16} /> All my accounts
      </button>

      <div className="account-detail-header">
        <div className="account-avatar-lg">
          {account.profile_pic_url ? (
            <img src={account.profile_pic_url} alt="" />
          ) : (
            <div className="account-avatar-placeholder-lg">{account.username[0]?.toUpperCase()}</div>
          )}
        </div>
        <div className="account-detail-info">
          <h1>@{account.username}</h1>
          {account.display_name && account.display_name !== account.username && (
            <div className="account-detail-name">{account.display_name}</div>
          )}
          <div className="account-detail-followers">
            <Users size={14} /> {formatNum(account.follower_count)} followers
          </div>
        </div>
        <a
          href={`https://www.instagram.com/${account.username}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost"
        >
          <ExternalLink size={14} /> View on Instagram
        </a>
      </div>

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
      </div>

      <div className="charts-grid">
        <ChartCard title="Views per day (last 30 days)" data={account.charts.views_per_day} type="line" color="#a78bfa" />
        <ChartCard title="Followers (last 30 days)" data={account.charts.followers_per_day} type="line" color="#60a5fa" />
        <ChartCard title="Reels published per day (last 30 days)" data={account.charts.reels_per_day} type="bar" color="#34d399" />
      </div>

      {account.top_reels && account.top_reels.length > 0 && (
        <div className="top-reels-section">
          <h2>Top reels (last 30 days)</h2>
          <div className="top-reels-grid">
            {account.top_reels.map((r) => (
              <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" className="top-reel">
                {r.thumbnail_url && <img src={r.thumbnail_url} alt="" />}
                <div className="top-reel-overlay">
                  <div className="top-reel-views"><Eye size={12} /> {formatNum(r.views)}</div>
                  <div className="top-reel-likes"><Heart size={12} /> {formatNum(r.likes)}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, data, type, color }) {
  const hasData = data && data.length > 0 && data.some((d) => d.value != null);
  return (
    <div className="chart-card">
      <div className="chart-card-title">{title}</div>
      {!hasData ? (
        <div className="chart-empty">Not enough data yet — keep tracking and the chart will fill in.</div>
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
