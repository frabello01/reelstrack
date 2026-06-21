import { useEffect, useMemo, useState } from 'react';
import {
  MessageSquare, Plus, Copy, Check, X, Loader2, RefreshCw,
  Trash2, Wallet, Phone, Globe, Search, Pencil, Send,
} from 'lucide-react';
import { api } from '../lib/api';
import './SmsVerificationsPage.css';

// ============================================================
// SMS Verifications page — buy a one-shot number via SMSPool,
// wait for the verification code, save a note about WHY it was
// bought. Active orders auto-poll every 5s so the OTP appears
// without a manual refresh.
// ============================================================

// Status pills config
const STATUS = {
  pending:   { label: 'In attesa',  className: 'sms-pill-pending'  },
  received:  { label: 'Ricevuto',   className: 'sms-pill-received' },
  cancelled: { label: 'Annullato',  className: 'sms-pill-cancelled'},
  expired:   { label: 'Scaduto',    className: 'sms-pill-expired'  },
  error:     { label: 'Errore',     className: 'sms-pill-error'    },
};

function nFmt(n) { return (n || 0).toLocaleString('it-IT'); }

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(iso) {
  if (!iso) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s fa`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m fa`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h fa`;
  return `${Math.floor(sec / 86400)}g fa`;
}

function timeLeft(iso) {
  if (!iso) return null;
  const sec = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (sec <= 0) return 'Scaduto';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function dollars(n) {
  if (n == null) return '—';
  return `$${Number(n).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

// ============================================================
// PAGE
// ============================================================
export default function SmsVerificationsPage() {
  const [balance, setBalance] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [busy, setBusy] = useState({});  // { [orderId]: 'cancel' | 'resend' | 'check' }
  const [, forceTick] = useState(0);       // re-render every second for countdowns

  // 1-second tick so "time left" / "time ago" stay fresh
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const loadOrders = async () => {
    try {
      const data = await api.getSmsOrders(100);
      setOrders(data.items || []);
    } catch (err) { setError(err.message); }
  };

  const loadBalance = async () => {
    try {
      const data = await api.getSmsBalance();
      setBalance(data?.balance ?? data?.amount ?? data);
    } catch { /* swallow — balance is informational */ }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadOrders(), loadBalance()]);
      setLoading(false);
    })();
  }, []);

  // Auto-poll every 5s for any order that's still pending — calls
  // SMSPool's /sms/check and updates our row. Stops automatically
  // when there's nothing pending.
  useEffect(() => {
    const pending = orders.filter((o) => o.status === 'pending');
    if (pending.length === 0) return;
    const id = setInterval(async () => {
      for (const o of pending) {
        try {
          const res = await api.checkSms(o.order_id);
          if (res?.row) {
            setOrders((prev) => prev.map((p) => p.order_id === o.order_id ? res.row : p));
          }
        } catch { /* keep polling */ }
      }
    }, 5000);
    return () => clearInterval(id);
  }, [orders]);

  const handleCancel = async (orderId) => {
    if (!confirm('Annullare l\'ordine e richiedere il refund?')) return;
    setBusy((b) => ({ ...b, [orderId]: 'cancel' }));
    try {
      const res = await api.cancelSms(orderId);
      if (res?.row) setOrders((prev) => prev.map((p) => p.order_id === orderId ? res.row : p));
      await loadBalance();
    } catch (err) { alert(`Cancel fallito: ${err.message}`); }
    setBusy((b) => { const c = { ...b }; delete c[orderId]; return c; });
  };

  const handleResend = async (orderId) => {
    setBusy((b) => ({ ...b, [orderId]: 'resend' }));
    try {
      const res = await api.resendSms(orderId);
      const msg = res?.message || 'Richiesta di re-invio inviata';
      alert(msg);
    } catch (err) { alert(`Resend fallito: ${err.message}`); }
    setBusy((b) => { const c = { ...b }; delete c[orderId]; return c; });
  };

  const handleCheck = async (orderId) => {
    setBusy((b) => ({ ...b, [orderId]: 'check' }));
    try {
      const res = await api.checkSms(orderId);
      if (res?.row) setOrders((prev) => prev.map((p) => p.order_id === orderId ? res.row : p));
    } catch (err) { alert(`Check fallito: ${err.message}`); }
    setBusy((b) => { const c = { ...b }; delete c[orderId]; return c; });
  };

  const handleCopy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* ignore */ }
  };

  const handleNoteEdit = async (orderId, current) => {
    const next = prompt('Nota (a cosa serviva questo numero?)', current || '');
    if (next == null) return;
    try {
      const updated = await api.updateSmsNote(orderId, next);
      setOrders((prev) => prev.map((p) => p.order_id === orderId ? updated : p));
    } catch (err) { alert(err.message); }
  };

  const onPurchased = async (row) => {
    setShowModal(false);
    if (row) setOrders((prev) => [row, ...prev]);
    await loadBalance();
  };

  const active   = useMemo(() => orders.filter((o) => o.status === 'pending'), [orders]);
  const finished = useMemo(() => orders.filter((o) => o.status !== 'pending'), [orders]);

  return (
    <div className="sms-page">
      <header className="sms-header">
        <div>
          <h1 className="sms-title"><MessageSquare size={22} /> SMS Verifications</h1>
          <p className="sms-subtitle">Compra un numero monouso via SMSPool e ricevi il codice di verifica.</p>
        </div>
        <div className="sms-header-right">
          <div className="sms-balance" title="Credito SMSPool">
            <Wallet size={16} />
            {balance == null ? '—' : <strong>${Number(balance).toFixed(2)}</strong>}
          </div>
          <button className="btn btn-secondary" onClick={() => loadOrders()} title="Aggiorna">
            <RefreshCw size={14} />
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> Nuovo SMS
          </button>
        </div>
      </header>

      {error && (
        <div className="sms-error" onClick={() => setError('')}>
          {error} <X size={14} />
        </div>
      )}

      {loading ? (
        <div className="sms-empty"><Loader2 size={16} className="spin" /> Caricamento…</div>
      ) : (
        <>
          {/* === Active orders === */}
          <section className="sms-section">
            <h2 className="sms-section-title">Ordini attivi {active.length > 0 && <span className="sms-counter">{active.length}</span>}</h2>
            {active.length === 0 ? (
              <div className="sms-empty">Nessun ordine attivo. Clicca <strong>Nuovo SMS</strong> per comprare un numero.</div>
            ) : (
              <div className="sms-active-grid">
                {active.map((o) => (
                  <ActiveOrderCard
                    key={o.order_id}
                    order={o}
                    busy={busy[o.order_id]}
                    copiedId={copiedId}
                    onCopy={handleCopy}
                    onCancel={() => handleCancel(o.order_id)}
                    onResend={() => handleResend(o.order_id)}
                    onCheck={() => handleCheck(o.order_id)}
                    onNoteEdit={() => handleNoteEdit(o.order_id, o.note)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* === History === */}
          <section className="sms-section">
            <h2 className="sms-section-title">Storico {finished.length > 0 && <span className="sms-counter">{finished.length}</span>}</h2>
            {finished.length === 0 ? (
              <div className="sms-empty">Nessun ordine completato.</div>
            ) : (
              <div className="sms-table-wrap">
                <table className="sms-table">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Paese / Servizio</th>
                      <th>Numero</th>
                      <th>Stato</th>
                      <th>Codice</th>
                      <th>Costo</th>
                      <th>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finished.map((o) => {
                      const st = STATUS[o.status] || STATUS.pending;
                      return (
                        <tr key={o.order_id}>
                          <td title={fmtDateTime(o.created_at)}>{timeAgo(o.created_at)}</td>
                          <td>
                            <span className="sms-cell-strong">{o.service_name || o.service}</span>
                            <span className="sms-cell-muted"> · {o.country_name || o.country}</span>
                          </td>
                          <td className="sms-mono">{o.phone_number || '—'}</td>
                          <td><span className={`sms-pill ${st.className}`}>{st.label}</span></td>
                          <td className="sms-mono sms-code-cell">
                            {o.sms_code ? (
                              <button className="sms-copy" onClick={() => handleCopy(o.sms_code, o.order_id)} title="Copia codice">
                                {o.sms_code}
                                {copiedId === o.order_id ? <Check size={12} /> : <Copy size={12} />}
                              </button>
                            ) : '—'}
                          </td>
                          <td className="sms-mono">{dollars(o.cost)}</td>
                          <td className="sms-note-cell">
                            <span className="sms-note-text">{o.note || <em className="sms-cell-muted">— nessuna —</em>}</span>
                            <button className="sms-icon-btn" onClick={() => handleNoteEdit(o.order_id, o.note)} title="Modifica nota">
                              <Pencil size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {showModal && (
        <NewSmsModal onClose={() => setShowModal(false)} onPurchased={onPurchased} />
      )}
    </div>
  );
}

function ActiveOrderCard({ order, busy, copiedId, onCopy, onCancel, onResend, onCheck, onNoteEdit }) {
  const elapsed = timeAgo(order.created_at);
  const left = timeLeft(order.expires_at);
  return (
    <div className={`sms-active-card ${order.sms_code ? 'sms-active-card-received' : ''}`}>
      <div className="sms-active-top">
        <div className="sms-active-service">
          <strong>{order.service_name || order.service}</strong>
          <span className="sms-cell-muted"> · {order.country_name || order.country}</span>
        </div>
        <span className="sms-cell-muted" title={fmtDateTime(order.created_at)}>{elapsed}</span>
      </div>
      <div className="sms-active-phone">
        <Phone size={14} />
        <span className="sms-mono">{order.phone_number || '—'}</span>
        {order.phone_number && (
          <button className="sms-copy-mini" onClick={() => onCopy(order.phone_number, `phone-${order.order_id}`)}>
            {copiedId === `phone-${order.order_id}` ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}
      </div>

      {order.sms_code ? (
        <div className="sms-code-box">
          <span className="sms-code-label">Codice ricevuto</span>
          <button className="sms-code-value" onClick={() => onCopy(order.sms_code, `code-${order.order_id}`)} title="Copia codice">
            <span className="sms-mono">{order.sms_code}</span>
            {copiedId === `code-${order.order_id}` ? <Check size={14} /> : <Copy size={14} />}
          </button>
          {order.full_sms && order.full_sms !== order.sms_code && (
            <div className="sms-code-full" title="SMS completo">{order.full_sms}</div>
          )}
        </div>
      ) : (
        <div className="sms-waiting">
          <Loader2 size={14} className="spin" />
          <span>In attesa dell'SMS… <span className="sms-cell-muted">{left ? `scade in ${left}` : ''}</span></span>
        </div>
      )}

      {order.note && (
        <div className="sms-active-note">"{order.note}"</div>
      )}

      <div className="sms-active-actions">
        <button className="btn btn-secondary btn-sm" onClick={onCheck} disabled={!!busy}>
          {busy === 'check' ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />} Controlla
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onResend} disabled={!!busy}>
          {busy === 'resend' ? <Loader2 size={12} className="spin" /> : <Send size={12} />} Re-invia
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onNoteEdit}>
          <Pencil size={12} /> Nota
        </button>
        <button className="btn btn-danger btn-sm" onClick={onCancel} disabled={!!busy}>
          {busy === 'cancel' ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />} Annulla
        </button>
      </div>
    </div>
  );
}

// ============================================================
// NEW SMS MODAL
// ============================================================
function NewSmsModal({ onClose, onPurchased }) {
  const [countries, setCountries] = useState([]);
  const [services, setServices] = useState([]);
  const [country, setCountry] = useState('');
  const [service, setService] = useState('');
  const [note, setNote] = useState('');
  const [price, setPrice] = useState(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [filterC, setFilterC] = useState('');
  const [filterS, setFilterS] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [cs, ss] = await Promise.all([api.getSmsCountries(), api.getSmsServices()]);
        // SMSPool returns either an array or an object — normalize.
        setCountries(Array.isArray(cs) ? cs : Object.values(cs || {}));
        setServices(Array.isArray(ss) ? ss : Object.values(ss || {}));
      } catch (err) { setError(err.message); }
    })();
  }, []);

  // Re-fetch the service list when country changes (some services are
  // not available in all countries).
  useEffect(() => {
    if (!country) return;
    (async () => {
      try {
        const ss = await api.getSmsServices(country);
        setServices(Array.isArray(ss) ? ss : Object.values(ss || {}));
      } catch { /* keep previous list */ }
    })();
  }, [country]);

  // Auto-fetch price when both selected
  useEffect(() => {
    if (!country || !service) { setPrice(null); return; }
    setLoadingPrice(true);
    api.getSmsPrice({ country, service })
      .then((p) => setPrice(p?.price ?? null))
      .catch(() => setPrice(null))
      .finally(() => setLoadingPrice(false));
  }, [country, service]);

  const submit = async () => {
    if (!country || !service) {
      setError('Seleziona paese e servizio');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const selC = countries.find((c) => idOf(c) === country);
      const selS = services.find((s) => idOf(s) === service);
      const res = await api.purchaseSms({
        country,
        service,
        note: note || null,
        country_name: nameOf(selC),
        service_name: nameOf(selS),
      });
      onPurchased(res?.row || null);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const filteredCountries = useMemo(
    () => countries.filter((c) => !filterC || nameOf(c).toLowerCase().includes(filterC.toLowerCase())),
    [countries, filterC],
  );
  const filteredServices = useMemo(
    () => services.filter((s) => !filterS || nameOf(s).toLowerCase().includes(filterS.toLowerCase())),
    [services, filterS],
  );

  return (
    <div className="sms-modal-backdrop" onClick={onClose}>
      <div className="sms-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sms-modal-header">
          <h2><MessageSquare size={18} /> Nuovo SMS</h2>
          <button className="sms-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="sms-modal-body">
          <div className="sms-modal-cols">
            <div className="sms-modal-col">
              <label className="sms-label"><Globe size={12} /> Paese</label>
              <div className="sms-filter"><Search size={12} />
                <input value={filterC} onChange={(e) => setFilterC(e.target.value)} placeholder="Filtra paesi…" />
              </div>
              <div className="sms-picker">
                {filteredCountries.map((c) => (
                  <button
                    key={idOf(c)}
                    className={`sms-pick-item ${country === idOf(c) ? 'sms-pick-selected' : ''}`}
                    onClick={() => setCountry(idOf(c))}
                  >
                    {nameOf(c)}
                  </button>
                ))}
              </div>
            </div>

            <div className="sms-modal-col">
              <label className="sms-label">Servizio</label>
              <div className="sms-filter"><Search size={12} />
                <input value={filterS} onChange={(e) => setFilterS(e.target.value)} placeholder="Filtra servizi…" />
              </div>
              <div className="sms-picker">
                {filteredServices.map((s) => (
                  <button
                    key={idOf(s)}
                    className={`sms-pick-item ${service === idOf(s) ? 'sms-pick-selected' : ''}`}
                    onClick={() => setService(idOf(s))}
                  >
                    {nameOf(s)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="sms-label">Nota (a cosa ti serve?)</label>
          <input
            className="sms-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='es. "per @ehiiigiulia signup IG"'
            maxLength={200}
          />

          <div className="sms-price-row">
            <div>
              <span>Prezzo</span>
              <div className="sms-price-caption">Pool con highest success rate</div>
            </div>
            <strong>
              {loadingPrice ? <Loader2 size={12} className="spin" /> : dollars(price)}
            </strong>
          </div>

          {error && <div className="sms-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>

        <div className="sms-modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>Annulla</button>
          <button className="btn btn-primary" onClick={submit} disabled={submitting || !country || !service}>
            {submitting ? <><Loader2 size={14} className="spin" /> Acquisto…</> : <><Plus size={14} /> Compra numero</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// SMSPool's catalog payloads sometimes use {ID, name}, sometimes
// {id, name}, sometimes {short_name, name} — normalize.
function idOf(x) {
  if (!x) return '';
  return String(x.ID ?? x.id ?? x.short_name ?? x.code ?? x.name ?? '');
}
function nameOf(x) {
  if (!x) return '';
  return String(x.name ?? x.Name ?? x.short_name ?? x.id ?? '');
}
