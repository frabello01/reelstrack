import { useEffect, useMemo, useState } from 'react';
import {
  Link2, Plus, Copy, Check, ExternalLink, Edit2, Trash2, ShieldAlert,
  AlertCircle, X, Globe, Loader2, Search, Power, PowerOff,
} from 'lucide-react';
import { api } from '../lib/api';
import './RedirectsPage.css';

// ============================================================
// HELPERS
// ============================================================
function nFmt(n) {
  return (n || 0).toLocaleString('it-IT');
}
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  });
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// The host the "Copy link" button writes to the clipboard. Redirects
// resolve on ANY custom domain pointed at the Vercel project (the
// PublicSlugDispatcher races redirect-lookup before landing-lookup
// on bare /:slug paths), so this is purely a UI convenience — change
// it if you ever buy a dedicated short domain like qc.link.
const DEFAULT_SHORT_HOST = 'quellochecerchi.com';

// ============================================================
// PAGE
// ============================================================
export default function RedirectsPage() {
  const [items, setItems] = useState([]);
  const [talents, setTalents] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [rs, ts, accs] = await Promise.all([
        api.getRedirects(),
        api.getTalents(),
        api.getMyAccounts(),
      ]);
      setItems(rs || []);
      setTalents(ts || []);
      setAccounts(accs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const s = search.trim().toLowerCase();
    return items.filter((r) =>
      (r.slug || '').toLowerCase().includes(s) ||
      (r.title || '').toLowerCase().includes(s) ||
      (r.destination_url || '').toLowerCase().includes(s)
    );
  }, [items, search]);

  const totalClicks = useMemo(
    () => items.reduce((sum, r) => sum + (r.click_count || 0), 0),
    [items]
  );

  const handleDelete = async (r) => {
    if (!confirm(`Eliminare il redirect "${r.slug}"? Verranno persi anche i click registrati.`)) return;
    try {
      await api.deleteRedirect(r.id);
      setItems((prev) => prev.filter((x) => x.id !== r.id));
    } catch (err) {
      alert(`Errore: ${err.message}`);
    }
  };

  const handleToggleActive = async (r) => {
    try {
      const updated = await api.updateRedirect(r.id, { is_active: !r.is_active });
      setItems((prev) => prev.map((x) => x.id === r.id ? { ...x, ...updated } : x));
    } catch (err) {
      alert(`Errore: ${err.message}`);
    }
  };

  const handleCopy = (r) => {
    const url = `https://${DEFAULT_SHORT_HOST}/${r.slug}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(r.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  return (
    <div className="rp-page">
      <div className="rp-header">
        <div>
          <h1><Link2 size={22} /> Redirect Deeplinks</h1>
          <p className="rp-subtitle">
            Link brevi tipo <code>{DEFAULT_SHORT_HOST}/biancajorio</code> che reindirizzano alla destinazione scelta.
            Esce dal webview di Instagram/Threads/Facebook. Gate 18+ opzionale.
            Funzionano sullo stesso dominio delle landing pages — i redirect hanno la precedenza
            sulle landing con lo stesso slug.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
          <Plus size={14} /> Nuovo redirect
        </button>
      </div>

      {/* KPIs */}
      <div className="rp-kpis">
        <div className="rp-kpi">
          <div className="rp-kpi-label">Redirect attivi</div>
          <div className="rp-kpi-value">{items.filter((r) => r.is_active).length}</div>
        </div>
        <div className="rp-kpi">
          <div className="rp-kpi-label">Totale</div>
          <div className="rp-kpi-value">{items.length}</div>
        </div>
        <div className="rp-kpi">
          <div className="rp-kpi-label">Click totali</div>
          <div className="rp-kpi-value">{nFmt(totalClicks)}</div>
        </div>
      </div>

      {/* Search */}
      <div className="rp-toolbar">
        <div className="rp-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Cerca per slug, titolo o destinazione…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Setup hint */}
      <div className="rp-hint">
        <Globe size={14} />
        <div>
          <strong>Dominio:</strong> i redirect girano già su <code>{DEFAULT_SHORT_HOST}</code> (lo stesso delle landing pages).
          Se vuoi un dominio più corto in futuro (es. <code>qc.link</code>) basta puntarlo al progetto Vercel —
          non serve cambiare nulla nel codice.
        </div>
      </div>

      {error && <div className="rp-error"><AlertCircle size={14} /> {error}</div>}

      {/* Table */}
      {loading ? (
        <div className="rp-empty"><Loader2 size={22} className="spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="rp-empty">
          <Link2 size={32} />
          <p>
            {items.length === 0
              ? 'Nessun redirect ancora. Clicca "Nuovo redirect" per crearne uno.'
              : 'Nessun risultato per questa ricerca.'}
          </p>
        </div>
      ) : (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead>
              <tr>
                <th>Slug</th>
                <th>Destinazione</th>
                <th>Talent</th>
                <th>Gate</th>
                <th className="rp-num">Click</th>
                <th>Stato</th>
                <th>Creato</th>
                <th className="rp-actions-th"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={r.is_active ? '' : 'rp-row-off'}>
                  <td>
                    <div className="rp-slug">
                      <span className="rp-slug-text">/{r.slug}</span>
                      <button
                        className="rp-copy-btn"
                        onClick={() => handleCopy(r)}
                        title={`Copia https://${DEFAULT_SHORT_HOST}/${r.slug}`}
                      >
                        {copiedId === r.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                    {r.title && <div className="rp-title">{r.title}</div>}
                  </td>
                  <td>
                    <a
                      href={r.destination_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rp-dest"
                      title={r.destination_url}
                    >
                      {truncate(r.destination_url.replace(/^https?:\/\//, ''), 40)}
                      <ExternalLink size={11} />
                    </a>
                  </td>
                  <td>
                    {r.talent?.name
                      ? <span className="rp-talent">{r.talent.name}</span>
                      : <span className="rp-muted">—</span>}
                  </td>
                  <td>
                    {r.age_gate
                      ? <span className="rp-badge rp-badge-gate"><ShieldAlert size={11} /> 18+</span>
                      : <span className="rp-muted">—</span>}
                  </td>
                  <td className="rp-num">{nFmt(r.click_count)}</td>
                  <td>
                    <button
                      className={`rp-status-btn ${r.is_active ? 'on' : 'off'}`}
                      onClick={() => handleToggleActive(r)}
                      title={r.is_active ? 'Disattiva' : 'Attiva'}
                    >
                      {r.is_active ? <Power size={11} /> : <PowerOff size={11} />}
                      {r.is_active ? 'Attivo' : 'Off'}
                    </button>
                  </td>
                  <td className="rp-muted">{fmtDate(r.created_at)}</td>
                  <td className="rp-actions-td">
                    <button
                      className="rp-icon-btn"
                      onClick={() => { setEditing(r); setShowModal(true); }}
                      title="Modifica"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      className="rp-icon-btn rp-icon-btn-danger"
                      onClick={() => handleDelete(r)}
                      title="Elimina"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <RedirectModal
          redirect={editing}
          talents={talents}
          accounts={accounts}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={(saved) => {
            if (editing) {
              setItems((prev) => prev.map((x) => x.id === saved.id ? saved : x));
            } else {
              setItems((prev) => [saved, ...prev]);
            }
            setShowModal(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// CREATE / EDIT MODAL
// ============================================================
function RedirectModal({ redirect, talents, accounts, onClose, onSaved }) {
  const isEdit = !!redirect;
  const [slug, setSlug] = useState(redirect?.slug || '');
  const [destination, setDestination] = useState(redirect?.destination_url || '');
  const [title, setTitle] = useState(redirect?.title || '');
  const [ageGate, setAgeGate] = useState(!!redirect?.age_gate);
  const [talentId, setTalentId] = useState(redirect?.talent_id || '');
  const [myAccountId, setMyAccountId] = useState(redirect?.my_account_id || '');
  const [notes, setNotes] = useState(redirect?.notes || '');
  const [isActive, setIsActive] = useState(redirect ? !!redirect.is_active : true);
  const [botProtection, setBotProtection] = useState(!!redirect?.bot_protection_enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const accountsForTalent = useMemo(() => {
    if (!talentId) return [];
    return (accounts || []).filter((a) => a.talent_id === talentId);
  }, [talentId, accounts]);

  // Reset my_account if it doesn't belong to the new talent
  useEffect(() => {
    if (myAccountId && !accountsForTalent.some((a) => a.id === myAccountId)) {
      setMyAccountId('');
    }
  }, [accountsForTalent, myAccountId]);

  const handleSave = async () => {
    setError('');
    if (!slug.trim()) return setError('Lo slug è obbligatorio');
    if (!destination.trim()) return setError('La destinazione è obbligatoria');

    const body = {
      slug: slug.trim().toLowerCase(),
      destination_url: destination.trim(),
      title: title.trim() || null,
      age_gate: ageGate,
      talent_id: talentId || null,
      my_account_id: myAccountId || null,
      notes: notes.trim() || null,
      is_active: isActive,
      bot_protection_enabled: botProtection,
    };

    setSaving(true);
    try {
      const saved = isEdit
        ? await api.updateRedirect(redirect.id, body)
        : await api.createRedirect(body);
      onSaved(saved);
    } catch (err) {
      setError(err.message || 'Errore di salvataggio');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rp-modal-backdrop" onClick={saving ? undefined : onClose}>
      <div className="rp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rp-modal-header">
          <h3>{isEdit ? 'Modifica redirect' : 'Nuovo redirect'}</h3>
          <button className="rp-modal-close" onClick={onClose} disabled={saving}>
            <X size={16} />
          </button>
        </div>

        <div className="rp-modal-body">
          <div className="rp-field">
            <label>Slug *</label>
            <div className="rp-slug-input">
              <span className="rp-slug-prefix">{DEFAULT_SHORT_HOST}/</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="biancajorio"
                disabled={saving}
                maxLength={60}
                autoFocus
              />
            </div>
            <div className="rp-field-hint">
              Solo lettere minuscole, numeri, trattini, underscore. Max 60 caratteri.
            </div>
          </div>

          <div className="rp-field">
            <label>URL di destinazione *</label>
            <input
              type="url"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="https://onlyfans.com/bianca_jorio/c34"
              disabled={saving}
            />
          </div>

          <div className="rp-field">
            <label>Titolo interno (per riconoscerlo nel pannello)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Bianca - Campagna estate"
              disabled={saving}
              maxLength={120}
            />
          </div>

          <div className="rp-row-2">
            <div className="rp-field">
              <label>Talent (opzionale)</label>
              <select value={talentId} onChange={(e) => setTalentId(e.target.value)} disabled={saving}>
                <option value="">— Nessuno —</option>
                {(talents || []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="rp-field">
              <label>Profilo IG (opzionale)</label>
              <select
                value={myAccountId}
                onChange={(e) => setMyAccountId(e.target.value)}
                disabled={saving || !talentId}
              >
                <option value="">{talentId ? '— Nessuno —' : 'Scegli prima un talent'}</option>
                {accountsForTalent.map((a) => (
                  <option key={a.id} value={a.id}>@{a.username}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rp-toggles">
            <label className="rp-toggle">
              <input
                type="checkbox"
                checked={ageGate}
                onChange={(e) => setAgeGate(e.target.checked)}
                disabled={saving}
              />
              <span>
                <ShieldAlert size={13} />
                Gate 18+ — mostra "Contenuto maturo" prima del redirect
              </span>
            </label>
            <label className="rp-toggle">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={saving}
              />
              <span>
                <Power size={13} />
                Attivo — i visitatori possono usarlo
              </span>
            </label>
            <label className="rp-toggle">
              <input
                type="checkbox"
                checked={botProtection}
                onChange={(e) => setBotProtection(e.target.checked)}
                disabled={saving}
              />
              <span>
                🛡️ Bot Protection — wrappa il link in JWT verso il dominio
                sacrificale (parrocchiasanbasilio.com), cloak 410 ai crawler Meta
              </span>
            </label>
          </div>

          <div className="rp-field">
            <label>Note interne</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Es. UTM source per la dashboard, contesto della campagna…"
              rows={2}
              disabled={saving}
              maxLength={500}
            />
          </div>

          {error && <div className="rp-error"><AlertCircle size={14} /> {error}</div>}
        </div>

        <div className="rp-modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving
              ? <><Loader2 size={13} className="spin" /> Salvataggio…</>
              : (isEdit ? 'Salva modifiche' : 'Crea redirect')}
          </button>
        </div>
      </div>
    </div>
  );
}
