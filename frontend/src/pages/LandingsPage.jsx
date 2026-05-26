import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Globe, ExternalLink, Trash2, ChevronRight, BadgeCheck, Lock, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import './LandingsPage.css';

const UNASSIGNED_KEY = '__unassigned__';

export default function LandingsPage() {
  const [landings, setLandings] = useState([]);
  const [talents, setTalents] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    talent_id: '',
    my_account_id: '',
    slug: '',
    title: '',
    host: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [ls, ts, accs] = await Promise.all([
        api.getLandings(),
        api.getTalents(),
        api.getMyAccounts(),
      ]);
      setLandings(ls);
      setTalents(ts);
      setAccounts(accs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // IG profiles available for the talent currently picked in the create form.
  // If no talent yet, show none — the picker is disabled until talent is set.
  const accountsForChosenTalent = useMemo(() => {
    if (!form.talent_id) return [];
    return accounts.filter((a) => a.talent_id === form.talent_id);
  }, [form.talent_id, accounts]);

  // Group landings by their talent so the page shows one section per creator.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const l of landings) {
      const key = l.talent_id || UNASSIGNED_KEY;
      if (!map.has(key)) {
        map.set(key, {
          talentId: l.talent_id,
          talent: l.talents || null,
          landings: [],
        });
      }
      map.get(key).landings.push(l);
    }
    // Sort sections: real talents first (alphabetical), then unassigned at bottom.
    return [...map.values()].sort((a, b) => {
      if (a.talentId === null && b.talentId !== null) return 1;
      if (b.talentId === null && a.talentId !== null) return -1;
      const an = a.talent?.name || '';
      const bn = b.talent?.name || '';
      return an.localeCompare(bn);
    });
  }, [landings]);

  const handleCreate = async () => {
    if (!form.talent_id || !form.slug.trim() || !form.title.trim()) return;
    setSaving(true);
    setError('');
    try {
      const created = await api.createLanding({
        talent_id: form.talent_id,
        my_account_id: form.my_account_id || null,
        slug: form.slug.toLowerCase().trim(),
        title: form.title.trim(),
        host: form.host?.trim() || null,
      });
      setLandings((prev) => [created, ...prev]);
      setShowCreate(false);
      setForm({ talent_id: '', my_account_id: '', slug: '', title: '', host: '' });
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
    const path = landing.host ? `/${landing.slug}` : `/p/${landing.slug}`;
    return `${protocol}://${host}${path}`;
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
            Pagine link-in-bio per ogni creator. Tracciamento click, age-gate, dominio custom.
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
        <div className="landings-sections">
          {grouped.map((group) => (
            <section key={group.talentId || UNASSIGNED_KEY} className="landings-section">
              <header className="landings-section-header">
                <div className="landings-section-talent">
                  {group.talent?.profile_pic_url ? (
                    <img src={group.talent.profile_pic_url} alt={group.talent.name} className="landings-section-avatar" />
                  ) : (
                    <div className="landings-section-avatar landings-section-avatar-fallback">
                      <UserRound size={18} />
                    </div>
                  )}
                  <h2 className="landings-section-title">
                    {group.talent?.name || 'Senza creator'}
                  </h2>
                  <span className="landings-section-count">
                    {group.landings.length} landing{group.landings.length === 1 ? '' : 's'}
                  </span>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setForm({
                      talent_id: group.talentId || '',
                      my_account_id: '',
                      slug: '', title: '', host: '',
                    });
                    setShowCreate(true);
                  }}
                  disabled={!group.talentId}
                  title={group.talentId ? 'Aggiungi una landing per questo creator' : 'Assegna prima un creator'}
                >
                  <Plus size={13} /> Aggiungi
                </button>
              </header>

              <div className="landings-grid">
                {group.landings.map((l) => {
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
                          {l.my_accounts?.username && (
                            <span className="landing-card-talent" title="Profilo IG collegato">
                              · @{l.my_accounts.username}
                            </span>
                          )}
                        </div>
                        <div
                          className="landing-card-url"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank'); }}
                        >
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
            </section>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal">
            <h2 className="modal-title">Nuova Landing</h2>

            <div className="form-group">
              <label className="form-label">Creator *</label>
              <select
                value={form.talent_id}
                onChange={(e) => setForm({ ...form, talent_id: e.target.value, my_account_id: '' })}
                autoFocus
              >
                <option value="">— Scegli un creator —</option>
                {talents.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Profilo IG collegato (opzionale)</label>
              <select
                value={form.my_account_id}
                onChange={(e) => setForm({ ...form, my_account_id: e.target.value })}
                disabled={!form.talent_id}
              >
                <option value="">— Nessuno —</option>
                {accountsForChosenTalent.map((a) => (
                  <option key={a.id} value={a.id}>@{a.username}</option>
                ))}
              </select>
              <div className="form-hint">
                {!form.talent_id
                  ? 'Scegli prima un creator.'
                  : accountsForChosenTalent.length === 0
                    ? 'Questo creator non ha profili IG collegati.'
                    : 'Collega questa landing a uno specifico profilo IG per vedere i click in "My Creators".'
                }
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Slug *</label>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.replace(/[^a-z0-9_-]/gi, '').toLowerCase() })}
                placeholder="es. mariorossi"
              />
              <div className="form-hint">
                URL: {form.host
                  ? `${form.host}/${form.slug || 'mariorossi'}`
                  : `app.reelstrack.io/p/${form.slug || 'mariorossi'}`}
              </div>
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
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={saving || !form.talent_id || !form.slug || !form.title}
              >
                {saving ? 'Creazione…' : 'Crea Landing'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
