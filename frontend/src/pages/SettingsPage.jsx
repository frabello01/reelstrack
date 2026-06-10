import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Save, CheckCircle2, Image as ImageIcon, Plus, Trash2, ListChecks, GripVertical, Bell, Send, AlertCircle, HardDrive, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import ImageUploader from '../components/ImageUploader';
import './SettingsPage.css';

export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState({ display_name: '', agency_logo_url: null, discord_webhook_url: null });
  const [draftName, setDraftName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getSettings()
      .then((data) => {
        if (cancelled) return;
        setSettings(data);
        setDraftName(data.display_name || '');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const handleSaveName = async () => {
    setSaving(true);
    try {
      const updated = await api.updateSettings(draftName.trim() || null);
      setSettings(updated);
      setSavedAt(new Date());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const dirty = (draftName || '') !== (settings.display_name || '');

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <p className="subtitle">Customize your name and the agency branding shown on share links.</p>

      <div className="settings-section">
        <h2>Account</h2>
        <div className="settings-field">
          <label>Email</label>
          <div className="settings-readonly">{user?.email}</div>
        </div>

        <div className="settings-field">
          <label>Your name</label>
          <div className="settings-input-row">
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. Francesco"
            />
            <button
              className="btn btn-primary"
              onClick={handleSaveName}
              disabled={!dirty || saving}
            >
              {saving ? 'Saving...' : <><Save size={14} /> Save</>}
            </button>
            {savedAt && (
              <span className="saved-indicator"><CheckCircle2 size={14} /> Saved</span>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h2>Agency branding</h2>
        <p className="settings-help">
          The agency logo replaces the default Creator Advisor logo on every public to-do list share page.
          Use a square image (PNG with transparent background recommended).
        </p>
        <div className="settings-logo-row">
          <ImageUploader
            shape="thumbnail"
            currentUrl={settings.agency_logo_url}
            placeholder="Add logo"
            onUpload={async (dataUrl) => {
              const updated = await api.uploadAgencyLogo(dataUrl);
              setSettings(updated);
            }}
            onRemove={async () => {
              await api.removeAgencyLogo();
              setSettings((s) => ({ ...s, agency_logo_url: null }));
            }}
          />
          <div className="settings-logo-info">
            <ImageIcon size={14} />
            {settings.agency_logo_url
              ? 'Logo set — visible on all share links you create.'
              : 'No logo yet — your share links use the Creator Advisor logo.'}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h2><Bell size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} /> Discord notifications</h2>
        <p className="settings-help">
          Quando uno dei profili IG in "My Creators" cambia stato (sparisce, diventa privato, dà errore, o torna attivo),
          inviamo un messaggio al canale Discord collegato. Incolla qui l'URL del webhook (Server → Impostazioni canale →
          Integrazioni → Webhook).
        </p>
        <DiscordWebhookEditor
          initial={settings.discord_webhook_url || ''}
          onSaved={(url) => setSettings((s) => ({ ...s, discord_webhook_url: url }))}
        />
      </div>

      <div className="settings-section">
        <h2><HardDrive size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} /> Google Drive</h2>
        <p className="settings-help">
          Collega un account Google per abilitare il caricamento delle clip dei creator direttamente sulle
          loro cartelle Drive (dalla pagina pubblica della to-do list). Una sola connessione serve a tutto —
          le cartelle dei singoli creator si configurano in <em>My Creators</em>.
        </p>
        <DriveConnectionEditor />
      </div>

      <div className="settings-section">
        <h2><ListChecks size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} /> Daily tasks</h2>
        <p className="settings-help">
          Tasks defined here are generated <strong>every day at midnight (Rome time)</strong> for
          every active IG profile in My Creators. Your "My Day" page shows the daily checklist.
          To exclude a profile (e.g. shadowbanned), toggle it off on its talent's page.
        </p>
        <TaskTemplateManager />
      </div>
    </div>
  );
}

// ----- Discord webhook editor: paste URL, save, send test message -----
function DiscordWebhookEditor({ initial, onSaved }) {
  const [draft, setDraft] = useState(initial || '');
  const [saved, setSaved] = useState(initial || '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // { type: 'ok'|'err', text }
  const dirty = (draft || '') !== (saved || '');

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      // Empty string = clear the webhook
      const next = draft.trim() || null;
      await api.updateSettingsFields({ discord_webhook_url: next });
      setSaved(next || '');
      onSaved?.(next);
      setResult({ type: 'ok', text: next ? 'Webhook salvato' : 'Webhook rimosso' });
    } catch (err) {
      setResult({ type: 'err', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      // Use draft if it's dirty (so user can test before saving), else saved
      const urlToTest = dirty ? draft.trim() : null; // null = backend uses saved
      await api.testDiscordWebhook(urlToTest);
      setResult({ type: 'ok', text: 'Messaggio di test inviato su Discord' });
    } catch (err) {
      setResult({ type: 'err', text: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="discord-webhook-editor">
      <div className="settings-input-row">
        <input
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://discord.com/api/webhooks/123/abc..."
          spellCheck={false}
        />
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? 'Salvo…' : <><Save size={14} /> Salva</>}
        </button>
        <button
          className="btn btn-ghost"
          onClick={handleTest}
          disabled={testing || (!saved && !draft.trim())}
          title="Invia un messaggio di prova al webhook"
        >
          {testing ? 'Invio…' : <><Send size={14} /> Test</>}
        </button>
      </div>
      {result && (
        <div className={`settings-toast ${result.type === 'err' ? 'settings-toast-err' : 'settings-toast-ok'}`}>
          {result.type === 'err' ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
          <span>{result.text}</span>
        </div>
      )}
    </div>
  );
}

// ----- Drive connection: status + connect/disconnect -----
function DriveConnectionEditor() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(null); // { type, text }
  const [params, setParams] = useSearchParams();

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.getDriveStatus();
      setStatus(s);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Consume the ?drive_status=... flash params set by the OAuth callback redirect
  useEffect(() => {
    const ds = params.get('drive_status');
    if (!ds) return;
    if (ds === 'connected') {
      const email = params.get('drive_email') || '';
      setFlash({ type: 'ok', text: `Drive collegato${email ? ` come ${email}` : ''}.` });
    } else {
      const msg = params.get('drive_msg') || 'errore sconosciuto';
      setFlash({ type: 'err', text: `Connessione fallita: ${msg}` });
    }
    // Clean the URL so a refresh doesn't show the flash again
    const next = new URLSearchParams(params);
    next.delete('drive_status');
    next.delete('drive_email');
    next.delete('drive_msg');
    setParams(next, { replace: true });
    // Reload status after the redirect since the row was just updated
    load();
  }, []);

  const handleConnect = async () => {
    setBusy(true);
    setError('');
    try {
      const { auth_url } = await api.startDriveOAuth();
      window.location.href = auth_url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnettere Google Drive? Gli upload futuri sui to-do non funzioneranno finché non riconnetti.')) return;
    setBusy(true);
    setError('');
    try {
      await api.disconnectDrive();
      await load();
      setFlash({ type: 'ok', text: 'Drive disconnesso.' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="settings-toast"><Loader2 size={14} className="spin" /> Carico stato Drive…</div>;
  if (!status) return null;

  return (
    <div className="drive-connection-editor">
      {!status.configured ? (
        <div className="settings-toast settings-toast-err">
          <AlertCircle size={13} />
          <span>Drive non configurato sul server. Setta <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> su Render.</span>
        </div>
      ) : status.connected ? (
        <div className="drive-connected-row">
          <div className="drive-connected-info">
            <CheckCircle2 size={16} style={{ color: '#4ade80' }} />
            <div>
              <strong>Connesso</strong>
              {status.email && <> come <code>{status.email}</code></>}
              {status.connected_at && (
                <div className="drive-connected-since">
                  dal {new Date(status.connected_at).toLocaleDateString('it-IT')}
                </div>
              )}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={handleDisconnect}
            disabled={busy}
          >
            <LogOut size={13} /> Disconnetti
          </button>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={handleConnect} disabled={busy}>
          {busy
            ? <><Loader2 size={14} className="spin" /> Reindirizzamento…</>
            : <><HardDrive size={14} /> Connetti Google Drive</>}
        </button>
      )}

      {flash && (
        <div className={`settings-toast ${flash.type === 'err' ? 'settings-toast-err' : 'settings-toast-ok'}`}>
          {flash.type === 'err' ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
          <span>{flash.text}</span>
        </div>
      )}
      {error && (
        <div className="settings-toast settings-toast-err">
          <AlertCircle size={13} /> {error}
        </div>
      )}
    </div>
  );
}

// ----- TaskTemplateManager: list + add + delete templates -----
function TaskTemplateManager() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setTemplates(await api.getTaskTemplates());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setAdding(true);
    setError('');
    try {
      await api.createTaskTemplate(newLabel.trim());
      setNewLabel('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, label) => {
    if (!confirm(`Delete the task "${label}"? Existing daily checkboxes for this task will also be removed.`)) return;
    await api.deleteTaskTemplate(id);
    load();
  };

  const handleEdit = async (id, currentLabel) => {
    const next = prompt('Edit task label:', currentLabel);
    if (next === null) return; // cancelled
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentLabel) return;
    try {
      await api.updateTaskTemplate(id, { label: trimmed });
      load();
    } catch (err) {
      alert(`Update failed: ${err.message}`);
    }
  };

  return (
    <div className="task-template-manager">
      <form className="task-template-add" onSubmit={handleAdd}>
        <input
          type="text"
          placeholder="e.g. Post 1 Story, 15 min warmup, Reply to DMs"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          disabled={adding}
        />
        <button type="submit" className="btn btn-primary" disabled={adding || !newLabel.trim()}>
          {adding ? 'Adding...' : <><Plus size={14} /> Add task</>}
        </button>
      </form>
      {error && <div className="task-template-error">{error}</div>}

      {loading ? (
        <div className="task-template-loading">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="task-template-empty">
          No tasks defined yet. Add one above to start generating daily checklists.
        </div>
      ) : (
        <div className="task-template-list">
          {templates.map((t) => (
            <div key={t.id} className="task-template-row">
              <GripVertical size={14} className="task-template-grip" />
              <span className="task-template-label" onClick={() => handleEdit(t.id, t.label)}>
                {t.label}
              </span>
              <button
                className="task-template-delete-btn"
                onClick={() => handleDelete(t.id, t.label)}
                title="Delete task"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
