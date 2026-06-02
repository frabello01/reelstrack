import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, MousePointerClick, Eye as EyeIcon, Globe2, Radio,
  ArrowLeft, RefreshCw,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { formatIntIT } from '../lib/format';
import './LandingsDashboardPage.css';

// ----- Helpers ----------------------------------------------------

const SOURCE_LABELS = {
  instagram: 'Instagram', threads: 'Threads', facebook: 'Facebook',
  twitter: 'Twitter/X', tiktok: 'TikTok', reddit: 'Reddit',
  telegram: 'Telegram', youtube: 'YouTube', google: 'Google',
  bing: 'Bing', linkedin: 'LinkedIn', discord: 'Discord',
  direct: 'Diretto', other: 'Altro',
};
const SOURCE_COLORS = {
  instagram: '#E1306C', threads: '#000000', facebook: '#1877F2',
  twitter: '#1DA1F2', tiktok: '#69C9D0', reddit: '#FF4500',
  telegram: '#0088CC', youtube: '#FF0000', google: '#4285F4',
  bing: '#00809D', linkedin: '#0077B5', discord: '#5865F2',
  direct: '#94a3b8', other: '#64748b',
};
const FALLBACK_PALETTE = ['#a78bfa', '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#fb7185'];

function sourceLabel(k)  { return SOURCE_LABELS[k] || (k ? k[0].toUpperCase() + k.slice(1) : 'Altro'); }
function sourceColor(k, i = 0) { return SOURCE_COLORS[k] || FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]; }

function countryFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  // Unicode regional indicator hack: A → 🇦, etc.
  const A = 0x1F1E6;
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => A + c.charCodeAt(0) - 65));
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ----- Page ------------------------------------------------------

const REFRESH_MS = 60_000;
const PERIODS = [
  { key: 'day',   label: 'Oggi' },
  { key: 'week',  label: 'Settimana' },
  { key: 'month', label: 'Mese' },
];

export default function LandingsDashboardPage() {
  const [period, setPeriod] = useState('day');
  const [talents, setTalents] = useState([]);
  const [landings, setLandings] = useState([]);
  const [talentFilter, setTalentFilter] = useState('');
  const [landingFilter, setLandingFilter] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Live feed maintained client-side: starts from API "live_feed" snapshot
  // then prepends events from Supabase Realtime as they arrive.
  const [liveFeed, setLiveFeed] = useState([]);
  // Live KPI overlay (incremented from realtime, reset on refresh)
  const [liveTickClicks, setLiveTickClicks] = useState(0);
  const liveTickRef = useRef(0);

  // Load creator + landing options once
  useEffect(() => {
    Promise.all([api.getTalents(), api.getLandings()])
      .then(([ts, ls]) => { setTalents(ts); setLandings(ls); })
      .catch(() => {});
  }, []);

  // Load overview whenever period or filters change, then poll every 60s
  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const params = { period };
      if (talentFilter) params.talent_id = talentFilter;
      if (landingFilter) params.landing_id = landingFilter;
      const d = await api.getLandingsOverview(params);
      setData(d);
      setLiveFeed(d.live_feed || []);
      // Reset the "extra clicks since refresh" overlay
      liveTickRef.current = 0;
      setLiveTickClicks(0);
    } catch (err) {
      console.warn('overview load failed:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  useEffect(() => {
    load();
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [period, talentFilter, landingFilter]);

  // Available landings narrow with talent filter
  const filteredLandings = useMemo(() => {
    if (!talentFilter) return landings;
    return landings.filter((l) => l.talent_id === talentFilter);
  }, [talentFilter, landings]);

  // ---- Supabase Realtime: live click stream ----
  useEffect(() => {
    // Subscribe to INSERTs on landing_link_clicks. Filter client-side by
    // landing/talent so we don't need separate channels per filter.
    const channel = supabase
      .channel('landing-clicks-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'landing_link_clicks' },
        (payload) => {
          const row = payload.new;
          if (landingFilter && row.landing_id !== landingFilter) return;
          if (talentFilter) {
            const l = landings.find((x) => x.id === row.landing_id);
            if (!l || l.talent_id !== talentFilter) return;
          }
          // Hydrate landing/link names from the loaded landings list
          const landingMeta = landings.find((x) => x.id === row.landing_id);
          const enriched = {
            clicked_at: row.clicked_at || new Date().toISOString(),
            landing_id: row.landing_id,
            landing_title: landingMeta?.title || '(unknown)',
            link_label: null, // we don't ship link names in this stream
            source_kind: row.source_kind || null,
            country_code: row.country_code || null,
            country_name: row.country_name || null,
            city: row.city || null,
            _live: true,
          };
          setLiveFeed((prev) => [enriched, ...prev].slice(0, 50));
          liveTickRef.current += 1;
          setLiveTickClicks(liveTickRef.current);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [talentFilter, landingFilter, landings]);

  const totals = data?.totals || { clicks: 0, views: 0, ctr: null, active_now: 0 };
  const displayClicks = (totals.clicks || 0) + liveTickClicks;
  const displayActiveNow = totals.active_now || 0;

  return (
    <div className="ldb">
      <div className="ldb-header">
        <div>
          <Link to="/landings" className="ldb-back"><ArrowLeft size={14} /> Tutte le landing</Link>
          <h1 className="ldb-title"><Activity size={22} style={{ verticalAlign: -3, marginRight: 8 }} />Landing Pages — Dashboard</h1>
          <p className="ldb-sub">
            Click in tempo reale, sorgenti di traffico, paesi. Aggiornamento ogni 60s ·
            feed live via Supabase Realtime.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => load()} disabled={refreshing}>
          <RefreshCw size={13} className={refreshing ? 'spin' : ''} />
          {refreshing ? 'Aggiorno…' : 'Aggiorna'}
        </button>
      </div>

      {/* Filters */}
      <div className="ldb-filters">
        <div className="ldb-period">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={`ldb-period-btn ${period === p.key ? 'active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >{p.label}</button>
          ))}
        </div>
        <select
          value={talentFilter}
          onChange={(e) => { setTalentFilter(e.target.value); setLandingFilter(''); }}
        >
          <option value="">Tutti i creator</option>
          {talents.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          value={landingFilter}
          onChange={(e) => setLandingFilter(e.target.value)}
          disabled={filteredLandings.length === 0}
        >
          <option value="">Tutte le landing</option>
          {filteredLandings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
      </div>

      {/* KPI cards */}
      <div className="ldb-kpis">
        <KPI icon={<Radio size={13} />} label="Active now" value={displayActiveNow} sub="ultimi 5 min" live />
        <KPI icon={<MousePointerClick size={13} />} label="Clicks" value={displayClicks} sub={periodSub(period, data)} />
        <KPI icon={<EyeIcon size={13} />} label="Views" value={totals.views} sub={periodSub(period, data)} />
        <KPI icon={<Activity size={13} />} label="CTR" value={totals.ctr == null ? '—' : `${totals.ctr.toFixed(2)}%`} sub="clicks / views" />
      </div>

      {/* Charts row */}
      <div className="ldb-row">
        <div className="ldb-card ldb-card-chart">
          <h3 className="ldb-card-title">
            {period === 'day' ? 'Clicks per ora (oggi)' : 'Clicks per giorno'}
          </h3>
          <div className="ldb-chart-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data?.series || []} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="bucket" stroke="rgba(255,255,255,0.5)" fontSize={10} tickFormatter={(v) => period === 'day' ? `${v}h` : v.slice(5)} />
                <YAxis stroke="rgba(255,255,255,0.5)" fontSize={10} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#fff' }}
                  labelFormatter={(v) => period === 'day' ? `Ora ${v}:00` : v}
                />
                <Bar dataKey="count" fill="#a78bfa" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="ldb-card ldb-card-sources">
          <h3 className="ldb-card-title">Sorgenti</h3>
          {(data?.by_source || []).length === 0 ? (
            <div className="ldb-empty">Nessun click nel periodo.</div>
          ) : (
            <div className="ldb-sources-content">
              <div className="ldb-pie-wrap">
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie data={data.by_source} dataKey="count" nameKey="source_kind" innerRadius={35} outerRadius={70} paddingAngle={2}>
                      {data.by_source.map((s, i) => (
                        <Cell key={s.source_kind} fill={sourceColor(s.source_kind, i)} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v, name) => [`${v} click`, sourceLabel(name)]}
                      contentStyle={{ background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#fff', fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="ldb-source-list">
                {data.by_source.slice(0, 8).map((s, i) => (
                  <li key={s.source_kind}>
                    <span className="ldb-source-dot" style={{ background: sourceColor(s.source_kind, i) }} />
                    <span className="ldb-source-name">{sourceLabel(s.source_kind)}</span>
                    <span className="ldb-source-count">{s.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Countries + Top landings */}
      <div className="ldb-row">
        <div className="ldb-card">
          <h3 className="ldb-card-title"><Globe2 size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Da dove arriva il traffico</h3>
          {(data?.by_country || []).length === 0 ? (
            <div className="ldb-empty">Nessun dato geografico ancora.</div>
          ) : (
            <ul className="ldb-country-list">
              {data.by_country.slice(0, 10).map((c) => {
                const pct = totals.clicks > 0 ? (c.count / totals.clicks) * 100 : 0;
                return (
                  <li key={c.code}>
                    <span className="ldb-country-flag">{countryFlag(c.code)}</span>
                    <span className="ldb-country-name">{c.name}</span>
                    <span className="ldb-country-bar"><span style={{ width: `${pct}%` }} /></span>
                    <span className="ldb-country-count">{c.count}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="ldb-card">
          <h3 className="ldb-card-title">Top landings</h3>
          {(data?.top_landings || []).length === 0 ? (
            <div className="ldb-empty">Nessun click nel periodo.</div>
          ) : (
            <table className="ldb-top-table">
              <thead>
                <tr>
                  <th>Landing</th>
                  <th className="num">Clicks</th>
                  <th className="num">Views</th>
                  <th className="num">CTR</th>
                </tr>
              </thead>
              <tbody>
                {data.top_landings.slice(0, 8).map((l) => (
                  <tr key={l.landing_id}>
                    <td>
                      <Link to={`/landings/${l.landing_id}`} className="ldb-link">
                        {l.title}
                      </Link>
                      {l.talent_name && <div className="ldb-top-meta">{l.talent_name}</div>}
                    </td>
                    <td className="num">{formatIntIT(l.clicks)}</td>
                    <td className="num">{formatIntIT(l.views)}</td>
                    <td className="num">{l.ctr == null ? '—' : `${l.ctr.toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Live feed */}
      <div className="ldb-card">
        <h3 className="ldb-card-title">
          <span className="ldb-live-pulse" /> Feed live
          <span className="ldb-feed-hint">Nuovi click in tempo reale (ultimi 50)</span>
        </h3>
        {liveFeed.length === 0 ? (
          <div className="ldb-empty">Nessun click recente — questa lista si riempie da sola appena qualcuno clicca.</div>
        ) : (
          <ul className="ldb-feed">
            {liveFeed.map((c, i) => (
              <li key={`${c.clicked_at}-${i}`} className={c._live ? 'ldb-feed-row ldb-feed-new' : 'ldb-feed-row'}>
                <span className="ldb-feed-time">{fmtTime(c.clicked_at)}</span>
                <span className="ldb-feed-flag">{countryFlag(c.country_code)}</span>
                <span className="ldb-feed-landing">{c.landing_title}</span>
                {c.link_label && <span className="ldb-feed-link">· "{c.link_label}"</span>}
                <span className="ldb-feed-source" style={{ color: sourceColor(c.source_kind) }}>
                  {sourceLabel(c.source_kind)}
                </span>
                {c.city && <span className="ldb-feed-city">{c.city}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function KPI({ icon, label, value, sub, live }) {
  return (
    <div className={`ldb-kpi ${live ? 'ldb-kpi-live' : ''}`}>
      <div className="ldb-kpi-label">{icon} {label}{live && <span className="ldb-kpi-live-dot" />}</div>
      <div className="ldb-kpi-value">{typeof value === 'number' ? formatIntIT(value) : value}</div>
      <div className="ldb-kpi-sub">{sub}</div>
    </div>
  );
}

function periodSub(period, data) {
  if (!data) return '';
  if (period === 'day') return 'oggi';
  if (period === 'week') return `dal ${data.start_date}`;
  if (period === 'month') return `dal ${data.start_date}`;
  return '';
}
