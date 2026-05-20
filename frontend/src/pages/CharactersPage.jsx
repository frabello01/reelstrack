import { useEffect, useRef, useState } from 'react';
import {
  Sparkles, Users, Plus, Wand2, Download, Trash2, Loader2, AlertCircle,
  CheckCircle2, X, ChevronDown, ChevronUp, ImageIcon, Edit2, ExternalLink,
  Info, Upload, Clock, GraduationCap
} from 'lucide-react';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import './CharactersPage.css';

const ASPECT_RATIO_OPTIONS = [
  { value: '9:16', label: 'Stories 9:16 (vertical)' },
  { value: '3:4', label: 'Portrait 3:4 (IG feed)' },
  { value: '1:1', label: 'Square 1:1' },
  { value: '4:3', label: 'Landscape 4:3' },
  { value: '16:9', label: 'Cinematic 16:9' },
];

const RESOLUTION_OPTIONS = [
  { value: '1080p', label: 'HD (1080p — best)' },
  { value: '720p', label: 'Standard (720p — faster)' },
];

const BATCH_OPTIONS = [1, 2, 4];

const STATUS_LABELS = {
  not_ready: 'Not ready',
  queued: 'Queued',
  in_progress: 'Training',
  completed: 'Ready',
  failed: 'Failed',
};

const STATUS_COLORS = {
  not_ready: '#9ca3af',
  queued: '#fbbf24',
  in_progress: '#60a5fa',
  completed: '#4ade80',
  failed: '#f87171',
};

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

function extractUuid(input) {
  if (!input) return '';
  const m = String(input).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : input.trim();
}

// Read a File as data URL
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}

export default function CharactersPage() {
  const [configured, setConfigured] = useState(false);
  const [characters, setCharacters] = useState([]);
  const [apiCharacters, setApiCharacters] = useState([]); // Real Higgsfield statuses
  const [loadingChars, setLoadingChars] = useState(true);
  const [showTrainModal, setShowTrainModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingChar, setEditingChar] = useState(null);

  // Generation form
  const [selectedSoul, setSelectedSoul] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [resolution, setResolution] = useState('1080p');
  const [batchSize, setBatchSize] = useState(1);
  const [enhancePrompt, setEnhancePrompt] = useState(false);
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
    loadAll();
  }, [configured]);

  const loadAll = async () => {
    setLoadingChars(true);
    try {
      const [{ characters }, apiList] = await Promise.all([
        api.getHiggsfieldCharacters(),
        api.getHiggsfieldApiCharacters().catch(() => ({ items: [] })),
      ]);
      setCharacters(characters || []);
      setApiCharacters(apiList?.items || []);
    } catch (err) {
      setError(`Could not load characters: ${err.message}`);
    } finally {
      setLoadingChars(false);
    }
    loadGenerations();
  };

  const loadGenerations = async (soulFilter) => {
    try {
      const data = await api.getCharacterGenerations(soulFilter === 'all' ? null : soulFilter);
      setGenerations(data || []);
    } catch (err) {
      console.warn('[characters] gallery load failed:', err.message);
    }
  };

  // Poll training characters every 10 seconds
  const pollIntervalRef = useRef(null);
  useEffect(() => {
    const hasTraining = apiCharacters.some(
      (c) => c.status === 'queued' || c.status === 'in_progress' || c.status === 'not_ready'
    );
    if (hasTraining && !pollIntervalRef.current) {
      console.log('[characters] starting status poll (characters in training)');
      pollIntervalRef.current = setInterval(async () => {
        try {
          const apiList = await api.getHiggsfieldApiCharacters();
          setApiCharacters(apiList?.items || []);
        } catch {}
      }, 10000);
    } else if (!hasTraining && pollIntervalRef.current) {
      console.log('[characters] stopping status poll (all trained)');
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [apiCharacters]);

  // Merge: each local char gets the live training status from apiCharacters
  const charactersWithStatus = characters.map((c) => {
    const apiData = apiCharacters.find((ac) => ac.id === c.id);
    return {
      ...c,
      status: apiData?.status || 'completed', // assume ready if not found via API
      api_thumbnail: apiData?.thumbnail_url,
    };
  });

  const handleGenerate = async (e) => {
    e?.preventDefault();
    setError('');
    if (!selectedSoul) return setError('Pick a character first.');
    if (!prompt.trim()) return setError('Write a prompt.');
    if (selectedSoul.status && selectedSoul.status !== 'completed') {
      return setError(`Character is still ${STATUS_LABELS[selectedSoul.status] || selectedSoul.status}. Wait for training to finish.`);
    }

    setGenerating(true);
    try {
      const body = {
        soul_id: selectedSoul.id,
        soul_name: selectedSoul.name,
        prompt: prompt.trim(),
        aspect_ratio: aspectRatio,
        resolution,
        batch_size: batchSize,
        enhance_prompt: enhancePrompt,
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
    if (!confirm(`Remove "${char.name}" from your characters? Past generations remain in the gallery.\n\n(This does NOT delete the character from Higgsfield — only from your local registry.)`)) return;
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
        <div className="characters-header"><h1><Sparkles size={22} /> Characters</h1></div>
        <div className="characters-not-configured">
          <AlertCircle size={32} />
          <h3>Higgsfield isn't configured yet</h3>
          <p>
            Set <code>HIGGSFIELD_KEY_ID</code> and <code>HIGGSFIELD_KEY_SECRET</code> in
            your Render environment variables. Get them at{' '}
            <a href="https://cloud.higgsfield.ai" target="_blank" rel="noopener noreferrer">cloud.higgsfield.ai</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="characters-page">
      <div className="characters-header">
        <div>
          <h1><Sparkles size={22} /> Characters</h1>
          <p className="subtitle">
            Train consistent characters and generate images of them with Higgsfield Soul 2.0.
          </p>
        </div>
      </div>

      <div className="characters-form-card">
        {/* Character picker */}
        <div className="char-form-section">
          <div className="char-form-label">
            <Users size={14} /> Character
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="char-add-btn"
                onClick={() => setShowTrainModal(true)}
                title="Train a new character via Higgsfield API"
              >
                <GraduationCap size={12} /> Train new
              </button>
              <button
                type="button"
                className="char-add-btn char-add-btn-secondary"
                onClick={() => { setEditingChar(null); setShowAddModal(true); }}
                title="Manually register an existing Higgsfield Soul ID"
              >
                <Plus size={12} /> Add by UUID
              </button>
            </div>
          </div>
          {loadingChars ? (
            <div className="char-loading-inline"><Loader2 size={16} className="spin" /> Loading…</div>
          ) : charactersWithStatus.length === 0 ? (
            <div className="char-empty-inline">
              <Info size={14} />
              <div>
                <strong>No characters yet.</strong>{' '}
                Click <em>Train new</em> to upload 20+ photos and train your first character.
                Training takes ~3-5 minutes.
              </div>
            </div>
          ) : (
            <div className="char-grid">
              {charactersWithStatus.map((c) => {
                const isReady = c.status === 'completed';
                const statusColor = STATUS_COLORS[c.status] || '#9ca3af';
                const statusLabel = STATUS_LABELS[c.status] || c.status;
                return (
                  <div
                    key={c.internal_id}
                    className={`char-tile-wrap ${selectedSoul?.id === c.id ? 'selected' : ''} ${!isReady ? 'not-ready' : ''}`}
                  >
                    <button
                      type="button"
                      className="char-tile"
                      onClick={() => isReady && setSelectedSoul(c)}
                      disabled={!isReady}
                      title={isReady ? c.name : `${c.name} — ${statusLabel}`}
                    >
                      {(c.thumbnail_url || c.api_thumbnail) ? (
                        <img
                          src={c.thumbnail_url || c.api_thumbnail}
                          alt={c.name}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="char-tile-placeholder"><Users size={20} /></div>
                      )}
                      <div className="char-tile-name">{c.name}</div>
                      {selectedSoul?.id === c.id && (
                        <div className="char-tile-check"><CheckCircle2 size={14} /></div>
                      )}
                      {!isReady && (
                        <div className="char-tile-status" style={{ background: statusColor }}>
                          {c.status === 'in_progress' || c.status === 'queued' ? (
                            <Loader2 size={10} className="spin" />
                          ) : c.status === 'failed' ? (
                            <AlertCircle size={10} />
                          ) : (
                            <Clock size={10} />
                          )}
                          {statusLabel}
                        </div>
                      )}
                    </button>
                    <div className="char-tile-controls">
                      <button type="button" onClick={() => { setEditingChar(c); setShowAddModal(true); }} title="Edit">
                        <Edit2 size={11} />
                      </button>
                      <button type="button" onClick={() => handleDeleteChar(c)} title="Remove">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Prompt */}
        <div className="char-form-section">
          <div className="char-form-label">Prompt</div>
          <textarea
            className="char-prompt-input"
            placeholder='e.g. "ultra realistic iphone selfie of [character], laying sideways on couch, relaxed expression, daylight, authentic phone image quality"'
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
        </div>

        {/* Settings */}
        <div className="char-form-row">
          <div className="char-form-cell">
            <label>Aspect ratio</label>
            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} disabled={generating}>
              {ASPECT_RATIO_OPTIONS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
            </select>
          </div>
          <div className="char-form-cell">
            <label>Resolution</label>
            <select value={resolution} onChange={(e) => setResolution(e.target.value)} disabled={generating}>
              {RESOLUTION_OPTIONS.map((q) => (<option key={q.value} value={q.value}>{q.label}</option>))}
            </select>
          </div>
          <div className="char-form-cell">
            <label>Count</label>
            <select value={batchSize} onChange={(e) => setBatchSize(parseInt(e.target.value, 10))} disabled={generating}>
              {BATCH_OPTIONS.map((n) => (<option key={n} value={n}>{n} image{n > 1 ? 's' : ''}</option>))}
            </select>
          </div>
        </div>

        <button type="button" className="char-advanced-toggle" onClick={() => setShowAdvanced((s) => !s)}>
          {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Advanced settings
        </button>

        {showAdvanced && (
          <div className="char-advanced">
            <div className="char-form-row">
              <div className="char-form-cell">
                <label>
                  <input
                    type="checkbox"
                    checked={enhancePrompt}
                    onChange={(e) => setEnhancePrompt(e.target.checked)}
                    disabled={generating}
                    style={{ marginRight: 6 }}
                  />
                  Enhance prompt (let Higgsfield rewrite it)
                </label>
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
              <strong>Enhance prompt</strong>: Higgsfield rewrites your prompt to add detail. Off by default.
              <br />
              <strong>Seed</strong>: pin a number for reproducible results. Leave blank for variation.
            </p>
          </div>
        )}

        {error && (<div className="char-error"><AlertCircle size={14} /> {error}</div>)}

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
          {charactersWithStatus.length > 0 && (
            <select
              className="char-gallery-filter"
              value={galleryFilter}
              onChange={(e) => { setGalleryFilter(e.target.value); loadGenerations(e.target.value); }}
            >
              <option value="all">All characters</option>
              {charactersWithStatus.map((c) => (<option key={c.internal_id} value={c.id}>{c.name}</option>))}
            </select>
          )}
        </div>

        {generations.length === 0 ? (
          <div className="char-gallery-empty">
            <Sparkles size={32} />
            <p>No generations yet. {charactersWithStatus.length === 0 ? 'Train a character to start.' : 'Pick a character and write a prompt above.'}</p>
          </div>
        ) : (
          <div className="char-gallery">
            {generations.map((gen) => (
              <GenerationCard key={gen.id} gen={gen} onDelete={() => handleDeleteGen(gen)} />
            ))}
          </div>
        )}
      </div>

      {/* Training Modal */}
      {showTrainModal && (
        <TrainCharacterModal
          onClose={() => setShowTrainModal(false)}
          onTrained={() => {
            setShowTrainModal(false);
            loadAll();
          }}
        />
      )}

      {/* Add by UUID / Edit modal */}
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
// Train New Character Modal — drag-drop photos + name + submit
// ============================================================
function TrainCharacterModal({ onClose, onTrained }) {
  const [name, setName] = useState('');
  const [photos, setPhotos] = useState([]); // [{file, dataUrl, previewUrl, name}]
  const [step, setStep] = useState('compose'); // 'compose' | 'uploading' | 'done' | 'failed'
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleFiles = async (files) => {
    setError('');
    const accepted = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 10 * 1024 * 1024) {
        setError(`"${file.name}" is over 10MB. Resize first.`);
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        accepted.push({
          file,
          dataUrl,
          previewUrl: dataUrl,
          name: file.name,
          size: file.size,
        });
      } catch (e) {
        setError(`Could not read "${file.name}"`);
      }
    }
    setPhotos((p) => [...p, ...accepted].slice(0, 100));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleFiles(e.dataTransfer.files);
  };

  const removePhoto = (idx) => {
    setPhotos((p) => p.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) return setError('Give your character a name');
    if (photos.length < 10) return setError(`Need at least 10 photos (you have ${photos.length})`);

    setStep('uploading');
    setProgress(`Uploading 0/${photos.length} photos…`);

    try {
      // Upload each photo DIRECTLY to Supabase Storage from the browser.
      // This bypasses Render's request-size limit entirely.
      const folder = `training/${Date.now()}-${name.trim().replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40)}`;
      const uploadedUrls = [];

      // Upload in parallel batches of 5 for speed without overwhelming the connection
      const BATCH_SIZE = 5;
      for (let batchStart = 0; batchStart < photos.length; batchStart += BATCH_SIZE) {
        const batch = photos.slice(batchStart, batchStart + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (photo, idx) => {
            const i = batchStart + idx;
            const ext = photo.file.type.includes('png') ? 'png'
                       : photo.file.type.includes('webp') ? 'webp'
                       : 'jpg';
            const path = `${folder}/${String(i + 1).padStart(3, '0')}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from('training-photos')
              .upload(path, photo.file, {
                contentType: photo.file.type || 'image/jpeg',
                cacheControl: '604800',
                upsert: false,
              });
            if (upErr) throw new Error(`Upload ${i + 1} failed: ${upErr.message}`);

            const { data: pub } = supabase.storage.from('training-photos').getPublicUrl(path);
            if (!pub?.publicUrl) throw new Error(`No public URL for photo ${i + 1}`);
            return pub.publicUrl;
          })
        );
        uploadedUrls.push(...batchResults);
        setProgress(`Uploaded ${uploadedUrls.length}/${photos.length} photos…`);
      }

      // All uploaded — now tell the backend to submit URLs to Higgsfield
      setProgress(`Submitting to Higgsfield for training…`);
      const response = await api.trainHiggsfieldCharacter({
        name: name.trim(),
        image_urls: uploadedUrls,
      });
      setResult(response);
      setProgress('Training submitted. Higgsfield will train your character in ~3-5 min.');
      setStep('done');
    } catch (err) {
      setError(err.message || 'Training failed');
      setStep('failed');
    }
  };

  return (
    <div className="char-modal-backdrop" onClick={step === 'uploading' ? undefined : onClose}>
      <div className="char-modal char-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="char-modal-header">
          <h3><GraduationCap size={18} /> Train new character</h3>
          {step !== 'uploading' && (
            <button className="char-modal-close" onClick={onClose}><X size={16} /></button>
          )}
        </div>

        {step === 'compose' && (
          <div className="char-modal-body">
            <div className="char-modal-field">
              <label>Character name</label>
              <input
                type="text"
                placeholder="e.g. Sofia, MAIA, Olivia"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                maxLength={100}
              />
            </div>

            <div className="char-modal-field">
              <label>Reference photos ({photos.length} added, recommended 20+)</label>
              <div
                className="train-dropzone"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={handleDrop}
                onClick={() => document.getElementById('train-file-input').click()}
              >
                <Upload size={28} />
                <strong>Drop photos here or click to browse</strong>
                <p>10-100 photos. JPG/PNG/WebP. Max 10MB each. Use varied angles, expressions, lighting.</p>
                <input
                  id="train-file-input"
                  type="file"
                  multiple
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </div>
              {photos.length > 0 && (
                <div className="train-photo-grid">
                  {photos.map((p, i) => (
                    <div key={i} className="train-photo-thumb">
                      <img src={p.previewUrl} alt={p.name} />
                      <button
                        type="button"
                        className="train-photo-remove"
                        onClick={() => removePhoto(i)}
                        title="Remove"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="char-modal-help">
              <Info size={11} />
              <div>
                <strong>What makes good training photos:</strong> same person, varied angles (front, profile, 3/4),
                different expressions, consistent lighting (avoid heavy shadows), at least one full-body shot.
                Avoid sunglasses, masks, or heavy filters.
              </div>
            </div>

            {error && (<div className="char-error"><AlertCircle size={14} /> {error}</div>)}

            <div className="char-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!name.trim() || photos.length < 10}
              >
                <GraduationCap size={12} /> Train character ({photos.length} photos)
              </button>
            </div>
          </div>
        )}

        {step === 'uploading' && (
          <div className="char-modal-body train-progress">
            <Loader2 size={32} className="spin" />
            <h4>Training in progress…</h4>
            <p>{progress}</p>
            <p className="char-hint">
              Don't close this window. Uploading photos to your server, then submitting to Higgsfield.
            </p>
          </div>
        )}

        {step === 'done' && result && (
          <div className="char-modal-body train-progress">
            <CheckCircle2 size={32} style={{ color: '#4ade80' }} />
            <h4>Training started! 🎉</h4>
            <p>
              <strong>{result.name}</strong> is now in Higgsfield's training queue.
              You'll see it in the character grid with a "Training" badge.
              It typically completes in 3-5 minutes.
            </p>
            <p className="char-hint">
              Soul ID: <code>{result.soul_id}</code>
            </p>
            <button type="button" className="btn btn-primary" onClick={onTrained}>
              Got it
            </button>
          </div>
        )}

        {step === 'failed' && (
          <div className="char-modal-body train-progress">
            <AlertCircle size={32} style={{ color: '#f87171' }} />
            <h4>Training failed</h4>
            <p className="char-error" style={{ textAlign: 'left' }}>{error}</p>
            <div className="char-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
              <button type="button" className="btn btn-primary" onClick={() => setStep('compose')}>
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Manual Add / Edit Modal
// ============================================================
function CharacterModal({ character, onClose, onSaved }) {
  const isEdit = !!character;
  const [name, setName] = useState(character?.name || '');
  const [soulId, setSoulId] = useState(character?.id || '');
  const [thumbnail, setThumbnail] = useState(character?.thumbnail_url || '');
  const [notes, setNotes] = useState(character?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSoulIdChange = (e) => setSoulId(extractUuid(e.target.value));

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
      const saved = isEdit
        ? await api.updateHiggsfieldCharacter(character.internal_id, body)
        : await api.addHiggsfieldCharacter({ ...body, soul_id: soulId.trim() });
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
          <h3>{isEdit ? 'Edit character' : 'Add by UUID'}</h3>
          <button className="char-modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="char-modal-body">
          {!isEdit && (
            <div className="char-modal-help">
              <Info size={11} />
              <div>
                Use this only if you already have a Higgsfield <strong>API-trained</strong> Soul ID UUID
                from a previous training. Most users should use <strong>Train new</strong> instead.
              </div>
            </div>
          )}

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
              {isEdit && <span className="char-modal-locked"> — can't be changed</span>}
            </label>
            <input
              type="text"
              placeholder="abc12345-67de-89fa-bc01-234567890def"
              value={soulId}
              onChange={handleSoulIdChange}
              disabled={isEdit}
              className="char-modal-uuid-input"
            />
          </div>

          <div className="char-modal-field">
            <label>Thumbnail URL (optional)</label>
            <input
              type="text"
              placeholder="https://… (any public image URL)"
              value={thumbnail}
              onChange={(e) => setThumbnail(e.target.value)}
            />
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

          {error && (<div className="char-error"><AlertCircle size={14} /> {error}</div>)}

          <div className="char-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
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
        <button className="gen-card-delete" onClick={onDelete} title="Remove"><X size={14} /></button>
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
              <button key={i} className={`gen-pager-dot ${activeIdx === i ? 'active' : ''}`} onClick={() => setActiveIdx(i)} aria-label={`Image ${i + 1}`} />
            ))}
          </div>
        )}
      </div>
      <div className="gen-card-body">
        <div className="gen-card-meta"><strong>{gen.soul_name || 'Character'}</strong></div>
        <div className="gen-card-prompt" title={gen.prompt}>"{gen.prompt}"</div>
        <div className="gen-card-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => handleDownload(currentUrl, activeIdx)}>
            <Download size={12} /> Download
          </button>
          <button className="gen-card-delete" onClick={onDelete} title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
