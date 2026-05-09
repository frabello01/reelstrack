import { useEffect, useState } from 'react';
import { Save, CheckCircle2, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import ImageUploader from '../components/ImageUploader';
import './SettingsPage.css';

export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState({ display_name: '', agency_logo_url: null });
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
    </div>
  );
}
