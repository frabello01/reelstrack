import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Trash2, GripVertical, ExternalLink, Image as ImageIcon,
  BadgeCheck, Save, Eye, EyeOff, ChevronUp, ChevronDown, BarChart3, Upload, X, Copy,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../lib/api';
import './LandingEditorPage.css';

const TAB_PROFILE = 'profile';
const TAB_LINKS = 'links';
const TAB_THEME = 'theme';
const TAB_ANALYTICS = 'analytics';

export default function LandingEditorPage() {
  const { id } = useParams();
  const [landing, setLanding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingField, setSavingField] = useState(null); // which field is currently saving
  const [tab, setTab] = useState(TAB_PROFILE);
  const [savedAt, setSavedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      setLanding(await api.getLanding(id));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [id]);

  // ----- Field-level autosave on blur -----
  const saveField = async (patch) => {
    setSavingField(Object.keys(patch)[0]);
    try {
      const updated = await api.updateLanding(id, patch);
      setLanding((cur) => ({ ...cur, ...updated }));
      setSavedAt(Date.now());
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingField(null);
    }
  };

  if (loading) return <div className="loading-screen" style={{ height: 300 }}><div className="spinner" /></div>;
  if (error) return <div className="login-error">{error}</div>;
  if (!landing) return <div>Landing non trovata.</div>;

  const publicHost = landing.host || window.location.host;
  const publicProtocol = publicHost.startsWith('localhost') ? 'http' : 'https';
  const publicUrl = `${publicProtocol}://${publicHost}/p/${landing.slug}`;

  return (
    <div className="landing-editor">
      <div className="editor-header">
        <Link to="/landings" className="back-link"><ArrowLeft size={16} /> Tutte le landing</Link>
        <div className="editor-title-row">
          <h1 className="page-title">{landing.title}</h1>
          {landing.verified && <BadgeCheck size={20} className="title-verified" />}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => saveField({ published: !landing.published })}
            title={landing.published ? 'Pubblicata — clicca per nascondere' : 'Bozza — clicca per pubblicare'}
          >
            {landing.published ? <><Eye size={14} /> Live</> : <><EyeOff size={14} /> Bozza</>}
          </button>
        </div>
        <div className="editor-public-url">
          <span>{publicUrl}</span>
          <button
            className="btn btn-ghost btn-sm icon-btn"
            onClick={() => { navigator.clipboard.writeText(publicUrl); setSavedAt(Date.now()); }}
            title="Copia URL"
          ><Copy size={13} /></button>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm icon-btn" title="Apri">
            <ExternalLink size={13} />
          </a>
        </div>
        {savedAt && (Date.now() - savedAt < 3000) && (
          <div className="editor-save-toast"><Save size={12} /> Salvato</div>
        )}
      </div>

      {/* Tabs */}
      <div className="editor-tabs">
        <button
          className={`editor-tab ${tab === TAB_PROFILE ? 'active' : ''}`}
          onClick={() => setTab(TAB_PROFILE)}
        >Profilo</button>
        <button
          className={`editor-tab ${tab === TAB_LINKS ? 'active' : ''}`}
          onClick={() => setTab(TAB_LINKS)}
        >Link <span className="editor-tab-count">{(landing.landing_links || []).length}</span></button>
        <button
          className={`editor-tab ${tab === TAB_THEME ? 'active' : ''}`}
          onClick={() => setTab(TAB_THEME)}
        >Tema</button>
        <button
          className={`editor-tab ${tab === TAB_ANALYTICS ? 'active' : ''}`}
          onClick={() => setTab(TAB_ANALYTICS)}
        ><BarChart3 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Analytics</button>
      </div>

      {tab === TAB_PROFILE && <ProfileTab landing={landing} saveField={saveField} savingField={savingField} reload={load} />}
      {tab === TAB_LINKS && <LinksTab landing={landing} reload={load} />}
      {tab === TAB_THEME && <ThemeTab landing={landing} saveField={saveField} />}
      {tab === TAB_ANALYTICS && <AnalyticsTab landingId={id} />}
    </div>
  );
}

// ------------------------------------------------------------
// Profile tab
// ------------------------------------------------------------
function ProfileTab({ landing, saveField, savingField, reload }) {
  const [title, setTitle] = useState(landing.title || '');
  const [subtitle, setSubtitle] = useState(landing.subtitle || '');
  const [bio, setBio] = useState(landing.bio || '');
  const [slug, setSlug] = useState(landing.slug || '');
  const [host, setHost] = useState(landing.host || '');
  const avatarInput = useRef(null);
  const bgInput = useRef(null);
  const [uploading, setUploading] = useState(null);

  // Sync when landing changes
  useEffect(() => {
    setTitle(landing.title || '');
    setSubtitle(landing.subtitle || '');
    setBio(landing.bio || '');
    setSlug(landing.slug || '');
    setHost(landing.host || '');
  }, [landing]);

  const handleUpload = async (e, kind) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(kind);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      if (kind === 'avatar') await api.uploadLandingAvatar(landing.id, dataUrl);
      else await api.uploadLandingBackground(landing.id, dataUrl);
      reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(null);
      if (e.target) e.target.value = '';
    }
  };

  return (
    <div className="editor-content">
      {/* Images */}
      <div className="editor-card">
        <h3 className="editor-card-title">Immagini</h3>
        <div className="editor-image-row">
          <div className="editor-image-block">
            <div className="editor-image-preview">
              {landing.background_url
                ? <img src={landing.background_url} alt="bg" />
                : <span className="editor-image-empty">—</span>}
            </div>
            <input
              ref={bgInput} type="file" accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => handleUpload(e, 'bg')}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => bgInput.current?.click()} disabled={uploading === 'bg'}>
              {uploading === 'bg' ? 'Caricamento…' : <><Upload size={13} /> Sfondo</>}
            </button>
            <span className="editor-hint">Foto principale visibile in alto sulla landing.</span>
          </div>

          <div className="editor-image-block">
            <div className="editor-image-preview editor-image-avatar">
              {landing.avatar_url
                ? <img src={landing.avatar_url} alt="avatar" />
                : <span className="editor-image-empty"><ImageIcon size={28} /></span>}
            </div>
            <input
              ref={avatarInput} type="file" accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => handleUpload(e, 'avatar')}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => avatarInput.current?.click()} disabled={uploading === 'avatar'}>
              {uploading === 'avatar' ? 'Caricamento…' : <><Upload size={13} /> Avatar</>}
            </button>
            <span className="editor-hint">Usato come fallback quando manca lo sfondo.</span>
          </div>
        </div>
      </div>

      {/* Profile text */}
      <div className="editor-card">
        <h3 className="editor-card-title">Profilo</h3>

        <div className="form-group">
          <label className="form-label">Nome visualizzato *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== landing.title && saveField({ title })}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Username / Sottotitolo</label>
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            onBlur={() => subtitle !== (landing.subtitle || '') && saveField({ subtitle: subtitle || null })}
            placeholder="@username"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            onBlur={() => bio !== (landing.bio || '') && saveField({ bio: bio || null })}
            rows={3}
            placeholder="Descrizione breve. Una o due righe."
          />
        </div>

        <div className="editor-toggle-row">
          <label className="editor-toggle">
            <input
              type="checkbox"
              checked={!!landing.verified}
              onChange={(e) => saveField({ verified: e.target.checked })}
            />
            <span><BadgeCheck size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> Spunta verificato</span>
          </label>
          <label className="editor-toggle">
            <input
              type="checkbox"
              checked={!!landing.age_gate_default}
              onChange={(e) => saveField({ age_gate_default: e.target.checked })}
            />
            <span>Age-gate su tutti i link (18+)</span>
          </label>
        </div>
      </div>

      {/* Slug + host */}
      <div className="editor-card">
        <h3 className="editor-card-title">URL</h3>

        <div className="form-group">
          <label className="form-label">Slug</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9_-]/gi, '').toLowerCase())}
            onBlur={() => slug !== landing.slug && slug && saveField({ slug })}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Host custom (opzionale)</label>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value.toLowerCase().trim())}
            onBlur={() => (host || null) !== (landing.host || null) && saveField({ host: host || null })}
            placeholder="es. mylink.com"
          />
          <div className="form-hint">Aggiungi il dominio nel pannello Vercel prima di pubblicare.</div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Links tab
// ------------------------------------------------------------
function LinksTab({ landing, reload }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: '', url: '', age_gate: false, icon: '' });
  const [busy, setBusy] = useState(null); // link id being mutated
  const links = (landing.landing_links || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const handleAdd = async () => {
    if (!form.label.trim() || !form.url.trim()) return;
    setAdding(true);
    try {
      await api.createLandingLink(landing.id, {
        label: form.label.trim(),
        url: form.url.trim(),
        age_gate: form.age_gate,
        icon: form.icon || null,
      });
      setForm({ label: '', url: '', age_gate: false, icon: '' });
      reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleUpdate = async (linkId, patch) => {
    setBusy(linkId);
    try {
      await api.updateLandingLink(linkId, patch);
      reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (linkId) => {
    if (!confirm('Eliminare questo link?')) return;
    setBusy(linkId);
    try {
      await api.deleteLandingLink(linkId);
      reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  };

  const move = async (idx, dir) => {
    const next = idx + dir;
    if (next < 0 || next >= links.length) return;
    const newOrder = [...links];
    const [item] = newOrder.splice(idx, 1);
    newOrder.splice(next, 0, item);
    try {
      await api.reorderLandingLinks(landing.id, newOrder.map((l) => l.id));
      reload();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="editor-content">
      <div className="editor-card">
        <h3 className="editor-card-title">Aggiungi link</h3>
        <div className="link-form">
          <input
            placeholder="Etichetta — es. Il mio mondo segreto 🤍"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <input
            placeholder="https://onlyfans.com/..."
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
          <div className="link-form-row">
            <input
              placeholder="Icona (emoji o nome lucide)"
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              style={{ flex: 1 }}
            />
            <label className="editor-toggle" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={form.age_gate}
                onChange={(e) => setForm({ ...form, age_gate: e.target.checked })}
              />
              <span>Age-gate 18+</span>
            </label>
            <button
              className="btn btn-primary"
              onClick={handleAdd}
              disabled={adding || !form.label || !form.url}
            >
              <Plus size={14} /> {adding ? 'Aggiunta…' : 'Aggiungi'}
            </button>
          </div>
        </div>
      </div>

      <div className="editor-card">
        <h3 className="editor-card-title">Link ({links.length})</h3>
        {links.length === 0 ? (
          <div className="editor-empty">Nessun link aggiunto.</div>
        ) : (
          <div className="link-list">
            {links.map((link, i) => (
              <div key={link.id} className={`link-row ${!link.enabled ? 'link-disabled' : ''}`}>
                <div className="link-row-handle">
                  <button className="icon-btn-mini" onClick={() => move(i, -1)} disabled={i === 0} title="Su"><ChevronUp size={14} /></button>
                  <button className="icon-btn-mini" onClick={() => move(i, +1)} disabled={i === links.length - 1} title="Giù"><ChevronDown size={14} /></button>
                </div>
                <div className="link-row-icon">{link.icon || '›'}</div>
                <div className="link-row-info">
                  <input
                    className="link-row-label"
                    value={link.label}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Optimistic local update
                      const next = { ...landing };
                      next.landing_links = next.landing_links.map((l) => l.id === link.id ? { ...l, label: v } : l);
                    }}
                    onBlur={(e) => e.target.value !== link.label && handleUpdate(link.id, { label: e.target.value })}
                  />
                  <input
                    className="link-row-url"
                    value={link.url}
                    onChange={(e) => {
                      const v = e.target.value;
                      const next = { ...landing };
                      next.landing_links = next.landing_links.map((l) => l.id === link.id ? { ...l, url: v } : l);
                    }}
                    onBlur={(e) => e.target.value !== link.url && handleUpdate(link.id, { url: e.target.value })}
                  />
                </div>
                <div className="link-row-actions">
                  <button
                    className={`link-pill ${link.age_gate ? 'link-pill-on' : ''}`}
                    onClick={() => handleUpdate(link.id, { age_gate: !link.age_gate })}
                    title="Age-gate 18+"
                    disabled={busy === link.id}
                  >18+</button>
                  <button
                    className={`link-pill ${link.enabled ? 'link-pill-on-green' : ''}`}
                    onClick={() => handleUpdate(link.id, { enabled: !link.enabled })}
                    title={link.enabled ? 'Attivo' : 'Disattivo'}
                    disabled={busy === link.id}
                  >{link.enabled ? 'ON' : 'OFF'}</button>
                  <span className="link-click-count" title="Click totali">{link.click_count || 0} click</span>
                  <button
                    className="btn btn-danger btn-sm icon-btn"
                    onClick={() => handleDelete(link.id)}
                    disabled={busy === link.id}
                  ><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Theme tab
// ------------------------------------------------------------
const ACCENT_PRESETS = ['#7c6bff', '#22d3a5', '#ff6b6b', '#ffd166', '#60a5fa', '#f472b6', '#ff8c42', '#a855f7'];

function ThemeTab({ landing, saveField }) {
  const theme = landing.theme || {};
  const accent = theme.accent || '#7c6bff';
  return (
    <div className="editor-content">
      <div className="editor-card">
        <h3 className="editor-card-title">Colore principale</h3>
        <div className="theme-swatches">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              className={`theme-swatch ${accent === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => saveField({ theme: { ...theme, accent: c } })}
            />
          ))}
          <input
            type="color"
            value={accent}
            onChange={(e) => saveField({ theme: { ...theme, accent: e.target.value } })}
            className="theme-color-picker"
            title="Colore custom"
          />
        </div>
        <div className="editor-hint" style={{ marginTop: 12 }}>
          Il colore viene usato per la spunta verificato, l'icona dei link e i pulsanti del prompt 18+.
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Analytics tab
// ------------------------------------------------------------
function AnalyticsTab({ landingId }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getLandingAnalytics(landingId, days)
      .then(setData)
      .finally(() => setLoading(false));
  }, [landingId, days]);

  if (loading) return <div className="loading-screen" style={{ height: 200 }}><div className="spinner" /></div>;
  if (!data) return <div className="editor-empty">Nessun dato.</div>;

  return (
    <div className="editor-content">
      <div className="editor-card">
        <div className="editor-card-title-row">
          <h3 className="editor-card-title">Click totali</h3>
          <div className="analytics-range">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                className={`analytics-range-btn ${days === d ? 'active' : ''}`}
                onClick={() => setDays(d)}
              >{d}g</button>
            ))}
          </div>
        </div>
        <div className="analytics-totals">
          <div className="analytics-total">
            <div className="analytics-total-num">{data.total_in_window.toLocaleString()}</div>
            <div className="analytics-total-label">ultimi {days} giorni</div>
          </div>
          <div className="analytics-total">
            <div className="analytics-total-num">{data.total_lifetime.toLocaleString()}</div>
            <div className="analytics-total-label">totale storico</div>
          </div>
        </div>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.timeline} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.5)" fontSize={11}
                tickFormatter={(d) => {
                  const dt = new Date(d);
                  return `${dt.getDate()}/${dt.getMonth() + 1}`;
                }}
              />
              <YAxis stroke="rgba(255,255,255,0.5)" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#fff' }}
                labelFormatter={(d) => new Date(d).toLocaleDateString()}
              />
              <Line type="monotone" dataKey="count" stroke="#7c6bff" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="editor-card">
        <h3 className="editor-card-title">Per link</h3>
        {data.links.length === 0 ? (
          <div className="editor-empty">Nessun link.</div>
        ) : (
          <div className="analytics-link-list">
            {data.links.map((l) => {
              const max = Math.max(1, ...data.links.map((x) => x.click_count_window));
              const pct = (l.click_count_window / max) * 100;
              return (
                <div key={l.id} className="analytics-link-row">
                  <div className="analytics-link-label">{l.label}{!l.enabled && <span className="analytics-link-off"> (disattivo)</span>}</div>
                  <div className="analytics-link-bar">
                    <div className="analytics-link-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="analytics-link-counts">
                    <span className="analytics-link-window">{l.click_count_window}</span>
                    <span className="analytics-link-lifetime">/ {l.click_count_lifetime} totali</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
