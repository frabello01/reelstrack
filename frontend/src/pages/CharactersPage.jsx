import { useEffect, useState } from 'react';
import {
  Sparkles, Users, Plus, Wand2, Download, Trash2, Loader2, AlertCircle,
  CheckCircle2, X, ChevronDown, ChevronUp, ImageIcon, Edit2, ExternalLink,
  Archive, RotateCcw, Info
} from 'lucide-react';
import { api } from '../lib/api';
import './CharactersPage.css';

const SIZE_OPTIONS = [
  { value: '1536x2048', label: 'Portrait 3:4 (1536×2048)', description: 'Best for IG feed' },
  { value: '1080x1920', label: 'Stories 9:16 (1080×1920)', description: 'Vertical for stories/reels' },
  { value: '1536x1536', label: 'Square 1:1 (1536×1536)', description: 'Profile pics' },
  { value: '2048x1536', label: 'Landscape 4:3 (2048×1536)', description: 'Wide shots' },
];

const QUALITY_OPTIONS = [
  { value: 'high', label: 'HD (best quality)' },
  { value: 'medium', label: 'Standard (faster)' },
];

const BATCH_OPTIONS = [1, 2, 4];

function downloadFromUrl(url, filename) {
  fetch(url)
    .then((r) => r.blob())
    .then((blob) => {
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    })
    .catch(() => window.open(url, '_blank'));
}

// Try to pull a UUID out of a pasted string (e.g. if user pastes a full URL)
function extractUuid(input) {
  if (!input) return '';
  const match = String(input).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : input.trim();
}

export default function CharactersPage() {
  const [configured, setConfigured] = useState(false);
  const [characters, setCharacters] = useState([]);
  const [loadingChars, setLoadingChars] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingChar, setEditingChar] = useState(null);

  // Form state
  const [selectedSoul, setSelectedSoul] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1536x2048');
  const [quality, setQuality] = useState('high');
  const [batchSize, setBatchSize] = useState(1);
  const [strength, setStrength] = useState(1.0);
  const [seed, setSeed] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const [generations, setGenerations] = useState([]);
  const [galleryFilter, setGalleryFilter] = useState('all');

  useEffect(() => {
    api.getHiggsfieldStatus()
      .then((s) => setConfigured(!!s.configured))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    if (!configured) return;
    loadCharacters();
    loadGenerations();
  }, [configured]);

  const loadCharacters = async () => {
    setLoadingChars(true);
    try {
      const { characters } = await api.getHiggsfieldCharacters();
      setCharacters(characters || []);
    } catch (err) {
      setError(`Could not load characters: ${err.message}`);
    } finally {
      setLoadingChars(false);
    }
  };

  const loadGenerations = async (soulFilter) => {
    try {
      const data = await api.getCharacterGenerations(soulFilter === 'all' ? null : soulFilter);
      setGenerations(data || []);
    } catch (err) {
      console.warn('[characters] gallery load failed:', err.message);
    }
  };

  const handleGenerate = async (e) => {
    e?.preventDefault();
    setError('');
    if (!selectedSoul) return setError('Pick a character first.');
    if (!prompt.trim()) return setError('Write a prompt.');

    setGenerating(true);
    try {
      const body = {
        soul_id: selectedSoul.id,
        soul_name: selectedSoul.name,
        prompt: prompt.trim(),
        size,
        quality,
        batch_size: batchSize,
        strength,
      };
      if (seed) body.seed = parseInt(seed, 10);

      const newGen = await api.generateCharacterImage(body);
      setGenerations((g) => [newGen, ...g]);
    } catch (err) {
      setError(err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteGen = async (gen) => {
    if (!confirm(`Delete this generation? "${gen.prompt.slice(0, 60)}…"`)) return;
    try {
      await api.deleteCharacterGeneration(gen.id);
      setGenerations((g) => g.filter((x) => x.id !== gen.id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleDeleteChar = async (char) => {
    if (!confirm(`Remove "${char.name}" from your characters? Past generations remain in the gallery.`)) return;
    try {
      await api.deleteHiggsfieldCharacter(char.internal_id);
      setCharacters((cs) => cs.filter((c) => c.internal_id !== char.internal_id));
      if (selectedSoul?.id === char.id) setSelectedSoul(null);
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  if (!configured) {
    return (
      <div className="characters-page">
        <div className="characters-header">
          <h1><Sparkles size={22} /> Characters</h1>
        </div>
        <div className="characters-not-configured">
          <AlertCircle size={32} />
          <h3>Higgsfield isn't configured yet</h3>
          <p>
            Set <code>HIGGSFIELD_KEY_ID</code> and <code>HIGGSFIELD_KEY_SECRET</code> in
            your Render environment variables. Get the credentials at{' '}
            <a href="https://cloud.higgsfield.ai" target="_blank" rel="noopener noreferrer">cloud.higgsfield.ai</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="characters-page">
      {/* Header */}
      <div className="characters-header">
        <div>
          <h1><Sparkles size={22} /> Characters</h1>
          <p className="subtitle">
            Generate consistent images of your trained Higgsfield characters using Soul 2.0.
          </p>
        </div>
      </div>

      {/* Generation Form */}
      <div className="characters-form-card">
        {/* Character picker */}
        <div className="char-form-section">
          <div className="char-form-label">
            <Users size={14} /> Character
            <button
              type="button"
              className="char-add-btn"
              onClick={() => { setEditingChar(null); setShowAddModal(true); }}
              title="Add a new character"
            >
              <Plus size={12} /> Add character
            </button>
          </div>
          {loadingChars ? (
            <div className="char-loading-inline"><Loader2 size={16} className="spin" /> Loading…</div>
          ) : characters.length === 0 ? (
            <div className="char-empty-inline">
              <Info size={14} />
              <div>
                <strong>No characters yet.</strong>{' '}
                Click <em>+ Add character</em> above to register your first Higgsfield Soul ID.
              </div>
            </div>
          ) : (
            <div className="char-grid">
              {characters.map((c) => (
                <div
                  key={c.internal_id}
                  className={`char-tile-wrap ${selectedSoul?.id === c.id ? 'selected' : ''}`}
                >
                  <button
                    type="button"
                    className="char-tile"
                    onClick={() => setSelectedSoul(c)}
                    title={c.name}
                  >
                    {c.thumbnail_url ? (
                      <img src={c.thumbnail_url} alt={c.name} onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="char-tile-placeholder">
                        <Users size={20} />
                      </div>
                    )}
                    <div className="char-tile-name">{c.name}</div>
                    {selectedSoul?.id === c.id && (
                      <div className="char-tile-check"><CheckCircle2 size={14} /></div>
                    )}
                  </button>
                  <div className="char-tile-controls">
                    <button
                      type="button"
                      onClick={() => { setEditingChar(c); setShowAddModal(true); }}
                      title="Edit"
                    >
                      <Edit2 size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteChar(c)}
                      title="Remove"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prompt */}
        <div className="char-form-section">
          <div className="char-form-label">Prompt</div>
          <textarea
            className="char-prompt-input"
            placeholder='e.g. "Sitting at a Milan cafe, warm afternoon light, beige trench coat, candid portrait"'
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
        </div>

        {/* Quick settings */}
        <div className="char-form-row">
          <div className="char-form-cell">
            <label>Size</label>
            <select value={size} onChange={(e) => setSize(e.target.value)} disabled={generating}>
              {SIZE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="char-form-cell">
            <label>Quality</label>
            <select value={quality} onChange={(e) => setQuality(e.target.value)} disabled={generating}>
              {QUALITY_OPTIONS.map((q) => (
                <option key={q.value} value={q.value}>{q.label}</option>
              ))}
            </select>
          </div>
          <div className="char-form-cell">
            <label>Count</label>
            <select value={batchSize} onChange={(e) => setBatchSize(parseInt(e.target.value, 10))} disabled={generating}>
              {BATCH_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} image{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          className="char-advanced-toggle"
          onClick={() => setShowAdvanced((s) => !s)}
        >
          {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Advanced settings
        </button>

        {showAdvanced && (
          <div className="char-advanced">
            <div className="char-form-row">
              <div className="char-form-cell">
                <label>Character likeness strength: <strong>{strength.toFixed(2)}</strong></label>
                <input
                  type="range"
                  min="0.5"
                  max="1.0"
                  step="0.05"
                  value={strength}
                  onChange={(e) => setStrength(parseFloat(e.target.value))}
                  disabled={generating}
                />
              </div>
              <div className="char-form-cell">
                <label>Seed (optional)</label>
                <input
                  type="number"
                  placeholder="random"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  disabled={generating}
                />
              </div>
            </div>
            <p className="char-hint">
              Higher strength = more faithful to the trained character. Lower strength gives the model more freedom.
              Use a specific seed to reproduce the same image; leave blank for variation.
            </p>
          </div>
        )}

        {error && (
          <div className="char-error">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <button
          className="btn btn-primary char-generate-btn"
          onClick={handleGenerate}
          disabled={generating || !selectedSoul || !prompt.trim()}
        >
          {generating ? (
            <><Loader2 size={14} className="spin" /> Generating… (15-40 sec)</>
          ) : (
            <><Wand2 size={14} /> Generate {batchSize > 1 ? `${batchSize} images` : 'image'}</>
          )}
        </button>
      </div>

      {/* Gallery */}
      <div className="characters-gallery-section">
        <div className="char-gallery-header">
          <h2><ImageIcon size={18} /> Recent generations</h2>
          {characters.length > 0 && (
            <select
              className="char-gallery-filter"
              value={galleryFilter}
              onChange={(e) => {
                setGalleryFilter(e.target.value);
                loadGenerations(e.target.value);
              }}
            >
              <option value="all">All characters</option>
              {characters.map((c) => (
                <option key={c.internal_id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>

        {generations.length === 0 ? (
          <div className="char-gallery-empty">
            <Sparkles size={32} />
            <p>No generations yet. {characters.length === 0 ? 'Add a character to start.' : 'Pick a character and write a prompt above.'}</p>
          </div>
        ) : (
          <div className="char-gallery">
            {generations.map((gen) => (
              <GenerationCard key={gen.id} gen={gen} onDelete={() => handleDeleteGen(gen)} />
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <CharacterModal
          character={editingChar}
          onClose={() => { setShowAddModal(false); setEditingChar(null); }}
          onSaved={(saved) => {
            if (editingChar) {
              setCharacters((cs) => cs.map((c) => (c.internal_id === saved.internal_id ? saved : c)));
              if (selectedSoul?.internal_id === saved.internal_id) setSelectedSoul(saved);
            } else {
              setCharacters((cs) => [saved, ...cs]);
            }
            setShowAddModal(false);
            setEditingChar(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Add/Edit Character Modal
// ============================================================
function CharacterModal({ character, onClose, onSaved }) {
  const isEdit = !!character;
  const [name, setName] = useState(character?.name || '');
  const [soulId, setSoulId] = useState(character?.id || '');
  const [thumbnail, setThumbnail] = useState(character?.thumbnail_url || '');
  const [notes, setNotes] = useState(character?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSoulIdChange = (e) => {
    const value = e.target.value;
    // If the user pasted a URL, try to extract the UUID
    setSoulId(extractUuid(value));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Name is required');
    if (!soulId.trim()) return setError('Soul ID is required');

    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        thumbnail_url: thumbnail.trim() || null,
        notes: notes.trim() || null,
      };
      let saved;
      if (isEdit) {
        saved = await api.updateHiggsfieldCharacter(character.internal_id, body);
      } else {
        saved = await api.addHiggsfieldCharacter({ ...body, soul_id: soulId.trim() });
      }
      onSaved(saved);
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="char-modal-backdrop" onClick={onClose}>
      <div className="char-modal" onClick={(e) => e.stopPropagation()}>
        <div className="char-modal-header">
          <h3>{isEdit ? 'Edit character' : 'Add character'}</h3>
          <button className="char-modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="char-modal-body">
          <div className="char-modal-field">
            <label>Display name *</label>
            <input
              type="text"
              placeholder="e.g. Sofia, Mia, Olivia"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="char-modal-field">
            <label>
              Soul ID (UUID) *
              {isEdit && <span className="char-modal-locked"> — can't be changed after creation</span>}
            </label>
            <input
              type="text"
              placeholder="abc12345-67de-89fa-bc01-234567890def"
              value={soulId}
              onChange={handleSoulIdChange}
              disabled={isEdit}
              className="char-modal-uuid-input"
            />
            <div className="char-modal-help">
              <Info size={11} />
              <div>
                <strong>How to find it:</strong> open your character on{' '}
                <a href="https://higgsfield.ai/character" target="_blank" rel="noopener noreferrer">
                  higgsfield.ai/character <ExternalLink size={10} />
                </a>. The UUID is in the page URL after <code>/character/</code>. You can also paste the
                full URL here — we'll auto-extract the UUID.
              </div>
            </div>
          </div>

          <div className="char-modal-field">
            <label>Thumbnail URL (optional)</label>
            <input
              type="text"
              placeholder="https://… (any image URL — Higgsfield character preview works)"
              value={thumbnail}
              onChange={(e) => setThumbnail(e.target.value)}
            />
            <div className="char-modal-help-mini">
              Right-click a character preview on Higgsfield → Copy image address → paste here.
            </div>
          </div>

          <div className="char-modal-field">
            <label>Notes (optional)</label>
            <input
              type="text"
              placeholder="e.g. blonde, 25-35, casual style"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && (
            <div className="char-error">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <div className="char-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><Loader2 size={12} className="spin" /> Saving…</> : (isEdit ? 'Save changes' : 'Add character')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Generation Card
// ============================================================
function GenerationCard({ gen, onDelete }) {
  const isMulti = gen.image_urls && gen.image_urls.length > 1;
  const [activeIdx, setActiveIdx] = useState(0);

  const handleDownload = (url, idx) => {
    const safeName = (gen.soul_name || 'character').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const filename = `${safeName}-${gen.id.slice(0, 8)}-${idx + 1}.jpg`;
    downloadFromUrl(url, filename);
  };

  if (gen.status === 'failed' || gen.status === 'nsfw') {
    return (
      <div className="gen-card gen-card-failed">
        <div className="gen-card-failed-icon"><AlertCircle size={22} /></div>
        <div className="gen-card-failed-body">
          <strong>{gen.status === 'nsfw' ? 'Rejected (NSFW)' : 'Failed'}</strong>
          <p>{gen.error_message || 'Generation did not complete'}</p>
          <span className="gen-card-meta">{gen.soul_name} · "{gen.prompt.slice(0, 50)}…"</span>
        </div>
        <button className="gen-card-delete" onClick={onDelete} title="Remove">
          <X size={14} />
        </button>
      </div>
    );
  }

  const urls = gen.image_urls || [];
  const currentUrl = urls[activeIdx];

  return (
    <div className="gen-card">
      <div className="gen-card-img-wrap">
        {currentUrl && <img src={currentUrl} alt="" />}
        {isMulti && (
          <div className="gen-card-pager">
            {urls.map((_, i) => (
              <button
                key={i}
                className={`gen-pager-dot ${activeIdx === i ? 'active' : ''}`}
                onClick={() => setActiveIdx(i)}
                aria-label={`Image ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
      <div className="gen-card-body">
        <div className="gen-card-meta">
          <strong>{gen.soul_name || 'Character'}</strong>
        </div>
        <div className="gen-card-prompt" title={gen.prompt}>
          "{gen.prompt}"
        </div>
        <div className="gen-card-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleDownload(currentUrl, activeIdx)}
          >
            <Download size={12} /> Download
          </button>
          <button
            className="gen-card-delete"
            onClick={onDelete}
            title="Delete generation"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
