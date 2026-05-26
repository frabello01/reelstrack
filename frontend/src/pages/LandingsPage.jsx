import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Globe, ExternalLink, Trash2, ChevronRight, BadgeCheck, Lock } from 'lucide-react';
import { api } from '../lib/api';
import './LandingsPage.css';

export default function LandingsPage() {
  const [landings, setLandings] = useState([]);
  const [talents, setTalents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ talent_id: '', slug: '', title: '', host: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [ls, ts] = await Promise.all([api.getLandings(), api.getTalents()]);
      setLandings(ls);
      setTalents(ts);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.slug.trim() || !form.title.trim()) return;
    setSaving(true);
    setError('');
    try {
      const created = await api.createLanding({
        talent_id: form.talent_id || null,
        slug: form.slug.toLowerCase().trim(),
        title: form.title.trim(),
        host: form.host?.trim() || null,
      });
      setLandings((prev) => [created, ...prev]);
      setShowCreate(false);
      setForm({ talent_id: '', slug: '', title: '', host: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Eliminare definitivamente questa landing?')) return;
    try {
      await api.deleteLanding(id);
      setLandings((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      alert(err.message);
    }
  };

  const publicUrl = (landing) => {
    const host = landing.host || window.location.host;
    const protocol = (host.startsWith('localhost') ? 'http' : 'https');
    return `${protocol}://${host}/p/${landing.slug}`;
  };

  return (
    <div className="landings-page">
      <div className="dashboard-header">
        <div>
          <h1 className="page-title">
            <Globe size={22} style={{ marginRight: 8, verticalAlign: -3 }} />
            Landing Pages
          </h1>
          <p className="page-sub">
            Pagine link-in-bio in stile link.me con tracciamento click e age-gate.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={15} /> Nuova Landing
        </button>
      </div>

      {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="loading-screen" style={{ height: 200 }}><div className="spinner" /></div>
      ) : landings.length === 0 ? (
        <div className="empty-state">
          <Globe size={48} />
          <h3>Nessuna landing</h3>
          <p>Crea la prima landing page collegata a un creator.</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ marginTop: 8 }}>
            <Plus size={15} /> Crea Landing
          </button>
        </div>
      ) : (
        <div className="landings-grid">
          {landings.map((l) => {
            const linkCount = l.landing_links?.[0]?.count ?? 0;
            const url = publicUrl(l);
            return (
              <Link to={`/landings/${l.id}`} key={l.id} className="landing-card">
                <div className="landing-card-thumb">
                  {l.background_url || l.avatar_url
                    ? <img src={l.background_url || l.avatar_url} alt={l.title} />
                    : <div className="landing-card-thumb-fallback">{l.title?.[0]?.toUpperCase() || '?'}</div>
                  }
                  {!l.published && <span className="landing-draft-badge"><Lock size={11} /> bozza</span>}
                </div>
                <div className="landing-card-body">
                  <div className="landing-card-title">
                    {l.title}
                    {l.verified && <BadgeCheck size={14} className="landing-verified-icon" />}
                  </div>
                  <div className="landing-card-meta">
                    <span className="landing-card-slug">/{l.slug}</span>
                    {l.talents?.name && <span className="landing-card-talent">· {l.talents.name}</span>}
                  </div>
                  <div className="landing-card-url" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank'); }}>
                    <ExternalLink size={12} /> {url.replace(/^https?:\/\//, '')}
                  </div>
                  <div className="landing-card-footer">
                    <span>{linkCount} link{linkCount === 1 ? '' : 's'}</span>
                    <span className="landing-card-arrow">Apri <ChevronRight size={13} /></span>
                  </div>
                </div>
                <button
                  className="landing-card-delete"
                  title="Elimina"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(l.id); }}
                >
                  <Trash2 size={14} />
                </button>
              </Link>
            );
          })}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal">
            <h2 className="modal-title">Nuova Landing</h2>
            <div className="form-group">
              <label className="form-label">Creator (opzionale)</label>
              <select
                value={form.talent_id}
                onChange={(e) => setForm({ ...form, talent_id: e.target.value })}
              >
                <option value="">— Nessuno —</option>
                {talents.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Slug *</label>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.replace(/[^a-z0-9_-]/gi, '').toLowerCase() })}
                placeholder="es. mariorossi"
                autoFocus
              />
              <div className="form-hint">URL: /p/{form.slug || 'mariorossi'}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Titolo *</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Es. Mario Rossi"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Dominio custom (opzionale)</label>
              <input
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value.toLowerCase().trim() })}
                placeholder="es. mylink.com — lascia vuoto per app.reelstrack.io"
              />
              <div className="form-hint">Aggiungi il dominio in Vercel prima di pubblicare.</div>
            </div>
            {error && <div className="login-error" style={{ marginTop: -8 }}>{error}</div>}
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => { setShowCreate(false); setError(''); }}>Annulla</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !form.slug || !form.title}>
                {saving ? 'Creazione…' : 'Crea Landing'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
