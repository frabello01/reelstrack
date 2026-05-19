import { useEffect, useState } from 'react';
import {
  Sparkles, Users, RefreshCw, Wand2, Download, Trash2, Loader2, AlertCircle,
  CheckCircle2, X, Palette, ChevronDown, ChevronUp, ImageIcon
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
    .catch(() => {
      // Fallback: open in new tab
      window.open(url, '_blank');
    });
}

export default function CharactersPage() {
  const [configured, setConfigured] = useState(false);
  const [characters, setCharacters] = useState([]);
  const [styles, setStyles] = useState([]);
  const [loadingChars, setLoadingChars] = useState(true);
  const [loadingStyles, setLoadingStyles] = useState(true);

  // Form state
  const [selectedSoul, setSelectedSoul] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(null);
  const [size, setSize] = useState('1536x2048');
  const [quality, setQuality] = useState('high');
  const [batchSize, setBatchSize] = useState(1);
  const [strength, setStrength] = useState(1.0);
  const [seed, setSeed] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Gallery state
  const [generations, setGenerations] = useState([]);
  const [galleryFilter, setGalleryFilter] = useState('all'); // 'all' | a soul_id

  // ============================================================
  // INITIAL LOAD
  // ============================================================
  useEffect(() => {
    api.getHiggsfieldStatus()
      .then((s) => setConfigured(!!s.configured))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    if (!configured) return;
    loadCharacters();
    loadStyles();
    loadGenerations();
  }, [configured]);

  const loadCharacters = async () => {
    setLoadingChars(true);
    try {
      const { characters } = await api.getHiggsfieldCharacters();
      setCharacters(characters || []);
    } catch (err) {
      console.error('[characters] load failed:', err.message);
      setError(`Could not load characters: ${err.message}`);
    } finally {
      setLoadingChars(false);
    }
  };

  const loadStyles = async () => {
    setLoadingStyles(true);
    try {
      const { styles } = await api.getHiggsfieldStyles();
      setStyles(styles || []);
    } catch (err) {
      console.warn('[characters] could not load styles:', err.message);
    } finally {
      setLoadingStyles(false);
    }
  };

  const loadGenerations = async (soulFilter) => {
    try {
      const data = await api.getCharacterGenerations(soulFilter === 'all' ? null : soulFilter);
      setGenerations(data || []);
    } catch (err) {
      console.warn('[characters] could not load gallery:', err.message);
    }
  };

  // ============================================================
  // GENERATE
  // ============================================================
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
      if (selectedStyle) {
        body.style_id = selectedStyle.id;
        body.style_name = selectedStyle.name;
      }
      if (seed) body.seed = parseInt(seed, 10);

      const newGen = await api.generateCharacterImage(body);
      // Prepend the new generation to the gallery
      setGenerations((g) => [newGen, ...g]);
    } catch (err) {
      setError(err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  // ============================================================
  // DELETE
  // ============================================================
  const handleDelete = async (gen) => {
    if (!confirm(`Delete this generation? "${gen.prompt.slice(0, 60)}…"`)) return;
    try {
      await api.deleteCharacterGeneration(gen.id);
      setGenerations((g) => g.filter((x) => x.id !== gen.id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  // ============================================================
  // RENDER
  // ============================================================
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
              className="char-refresh-btn"
              onClick={loadCharacters}
              disabled={loadingChars}
              title="Refresh from Higgsfield"
            >
              <RefreshCw size={12} className={loadingChars ? 'spin' : ''} />
            </button>
          </div>
          {loadingChars ? (
            <div className="char-loading-inline"><Loader2 size={16} className="spin" /> Loading characters…</div>
          ) : characters.length === 0 ? (
            <div className="char-empty-inline">
              No trained characters found.{' '}
              <a href="https://higgsfield.ai/character" target="_blank" rel="noopener noreferrer">
                Train one on Higgsfield
              </a>{' '}
              then click refresh.
            </div>
          ) : (
            <div className="char-grid">
              {characters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`char-tile ${selectedSoul?.id === c.id ? 'selected' : ''}`}
                  onClick={() => setSelectedSoul(c)}
                  title={c.name}
                >
                  {c.thumbnail_url ? (
                    <img src={c.thumbnail_url} alt={c.name} />
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
              ))}
            </div>
          )}
        </div>

        {/* Prompt */}
        <div className="char-form-section">
          <div className="char-form-label">Prompt</div>
          <textarea
            className="char-prompt-input"
            placeholder='e.g. "Sitting at a cafe in Milan, warm afternoon light, wearing a beige trench coat, looking at the camera, candid portrait"'
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
        </div>

        {/* Style preset (optional) */}
        {styles.length > 0 && (
          <div className="char-form-section">
            <div className="char-form-label">
              <Palette size={14} /> Style preset (optional)
            </div>
            <div className="char-style-row">
              <button
                type="button"
                className={`char-style-chip ${!selectedStyle ? 'selected' : ''}`}
                onClick={() => setSelectedStyle(null)}
              >
                None
              </button>
              {styles.slice(0, 24).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`char-style-chip ${selectedStyle?.id === s.id ? 'selected' : ''}`}
                  onClick={() => setSelectedStyle(s)}
                  title={s.name}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick settings: size, quality, batch */}
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

        {/* Advanced settings */}
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

        {/* Error */}
        {error && (
          <div className="char-error">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Generate button */}
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
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>

        {generations.length === 0 ? (
          <div className="char-gallery-empty">
            <Sparkles size={32} />
            <p>No generations yet. Pick a character and write a prompt above to start.</p>
          </div>
        ) : (
          <div className="char-gallery">
            {generations.map((gen) => (
              <GenerationCard key={gen.id} gen={gen} onDelete={() => handleDelete(gen)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
          {gen.style_name && <> · {gen.style_name}</>}
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
