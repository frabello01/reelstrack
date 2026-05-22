import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, Users, Plus, Wand2, Download, Trash2, Loader2, AlertCircle,
  CheckCircle2, X, ChevronDown, ChevronUp, Image as ImageIcon, Edit2,
  Info, Upload, Copy, Eye, FileText
} from 'lucide-react';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import './StudioPage.css';

// ============================================================
// CONSTANTS
// ============================================================
const ASPECT_RATIO_OPTIONS = [
  { value: '9:16', label: '9:16 — Stories (vertical)' },
  { value: '3:4', label: '3:4 — Portrait (IG feed)' },
  { value: '1:1', label: '1:1 — Square' },
  { value: '4:3', label: '4:3 — Landscape' },
  { value: '16:9', label: '16:9 — Cinematic' },
  { value: '2:3', label: '2:3 — Portrait classic' },
  { value: '3:2', label: '3:2 — Landscape classic' },
  { value: 'match_input_image', label: 'Match reference dimensions' },
];

const SIZE_OPTIONS = [
  { value: '1K', label: '1K — fast drafts (~5s)' },
  { value: '2K', label: '2K — recommended (~15s)' },
  { value: '4K', label: '4K — high detail (~60-80s)' },
];

const BATCH_OPTIONS = [1, 2, 4];

const MAX_HINT_CHARS = 500;
const MIN_REFS = 3;
const MAX_REFS = 14;
const MAX_REF_FILE_MB = 10;

const REF_BUCKET = 'studio-reference-photos';

// ============================================================
// HELPERS
// ============================================================
function downloadFromUrl(url, filename) {
  fetch(url)
    .then((r) => r.blob())
    .then((blob) => {
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    })
    .catch(() => window.open(url, '_blank'));
}

function bytesToHuman(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// ============================================================
// PAGE
// ============================================================
export default function StudioPage() {
  const [configured, setConfigured] = useState(true);
  const [characters, setCharacters] = useState([]);
  const [loadingChars, setLoadingChars] = useState(true);

  const [selectedChar, setSelectedChar] = useState(null);
  const [variationHint, setVariationHint] = useState('');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [size, setSize] = useState('2K');
  const [batchSize, setBatchSize] = useState(1);
  const [seed, setSeed] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const [generations, setGenerations] = useState([]);
  const [galleryFilter, setGalleryFilter] = useState('all');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingChar, setEditingChar] = useState(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [previewLen, setPreviewLen] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.getStudioStatus();
        setConfigured(!!s.configured);
      } catch {
        setConfigured(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (configured) loadAll();
  }, [configured]);

  const loadAll = async () => {
    setLoadingChars(true);
    try {
      const { characters } = await api.getStudioCharacters();
      setCharacters(characters || []);
      if (!selectedChar && characters?.length) {
        setSelectedChar(characters[0]);
        setAspectRatio(characters[0].default_aspect_ratio || '9:16');
        setSize(characters[0].default_size || '2K');
      }
    } catch (err) {
      setError(`Couldn't load characters: ${err.message}`);
    } finally {
      setLoadingChars(false);
    }
    loadGenerations(galleryFilter);
  };

  const loadGenerations = async (filter) => {
    try {
      const data = await api.getStudioGenerations(filter && filter !== 'all' ? filter : null);
      setGenerations(data || []);
    } catch (err) {
      console.warn('[studio] gallery load failed:', err.message);
    }
  };

  // ============================================================
  // GENERATE
  // ============================================================
  const handleGenerate = async () => {
    setError('');
    if (!selectedChar) return setError('Pick a character first.');
    setGenerating(true);
    try {
      const body = {
        character_id: selectedChar.id,
        variation_hint: variationHint.trim() || null,
        aspect_ratio: aspectRatio,
        size,
        batch_size: batchSize,
      };
      if (seed) body.seed = parseInt(seed, 10);
      const gen = await api.generateStudioImage(body);
      setGenerations((g) => [gen, ...g]);
    } catch (err) {
      setError(err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handlePreview = async () => {
    if (!selectedChar) return;
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const r = await api.previewStudioPrompt({
        character_id: selectedChar.id,
        variation_hint: variationHint.trim() || null,
      });
      setPreviewText(r.final_prompt || '');
      setPreviewLen(r.length || 0);
    } catch (err) {
      setPreviewText(`Error: ${err.message}`);
      setPreviewLen(0);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDeleteGen = async (gen) => {
    if (!confirm(`Delete this generation?`)) return;
    try {
      await api.deleteStudioGeneration(gen.id);
      setGenerations((g) => g.filter((x) => x.id !== gen.id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleDeleteChar = async (char) => {
    if (!confirm(`Delete character "${char.name}"? Past generations stay in the gallery.`)) return;
    try {
      await api.deleteStudioCharacter(char.id);
      setCharacters((cs) => cs.filter((c) => c.id !== char.id));
      if (selectedChar?.id === char.id) setSelectedChar(null);
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  // ============================================================
  // RENDER
  // ============================================================
  if (!configured) {
    return (
      <div className="studio-page">
        <div className="studio-header">
          <h1><Sparkles size={22} /> Studio</h1>
        </div>
        <div className="studio-not-configured">
          <AlertCircle size={32} />
          <h3>Studio isn't configured yet</h3>
          <p>
            Set <code>REPLICATE_API_TOKEN</code> in your Render environment variables.
            Get one at <a href="https://replicate.com/account/api-tokens" target="_blank" rel="noopener noreferrer">replicate.com/account/api-tokens</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-page">
      <div className="studio-header">
        <div>
          <h1><Sparkles size={22} /> Studio</h1>
          <p className="subtitle">
            Generate consistent character images via Seedream 4.5. Reference images stay with each character — write a short variation hint and the LLM merges it with the base prompt.
          </p>
        </div>
      </div>

      <div className="studio-form-card">
        {/* Character picker */}
        <div className="st-section">
          <div className="st-section-label">
            <Users size={14} /> Character
            <button
              type="button"
              className="st-add-btn"
              onClick={() => { setEditingChar(null); setShowCreateModal(true); }}
            >
              <Plus size={12} /> New character
            </button>
          </div>
          {loadingChars ? (
            <div className="st-loading"><Loader2 size={16} className="spin" /> Loading…</div>
          ) : characters.length === 0 ? (
            <div className="st-empty">
              <Info size={14} />
              <div>
                <strong>No characters yet.</strong> Click <em>New character</em> to set one up.
                You'll upload 3-14 reference photos and write a base prompt (the full Seedream
                directive used every time).
              </div>
            </div>
          ) : (
            <div className="st-char-grid">
              {characters.map((c) => (
                <div
                  key={c.id}
                  className={`st-char-wrap ${selectedChar?.id === c.id ? 'selected' : ''}`}
                >
                  <button
                    type="button"
                    className="st-char-tile"
                    onClick={() => {
                      setSelectedChar(c);
                      setAspectRatio(c.default_aspect_ratio || '9:16');
                      setSize(c.default_size || '2K');
                    }}
                  >
                    {c.cover_image_url ? (
                      <img src={c.cover_image_url} alt={c.name}
                        onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="st-char-placeholder"><Users size={22} /></div>
                    )}
                    <div className="st-char-name">{c.name}</div>
                    <div className="st-char-meta">{(c.reference_image_urls || []).length} refs</div>
                    {selectedChar?.id === c.id && (
                      <div className="st-char-check"><CheckCircle2 size={14} /></div>
                    )}
                  </button>
                  <div className="st-char-controls">
                    <button type="button" onClick={() => { setEditingChar(c); setShowCreateModal(true); }} title="Edit">
                      <Edit2 size={11} />
                    </button>
                    <button type="button" onClick={() => handleDeleteChar(c)} title="Delete">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Variation hint */}
        <div className="st-section">
          <div className="st-section-label-row">
            <span className="st-section-label-text">Variation for this generation</span>
            <span className={`st-counter ${variationHint.length > MAX_HINT_CHARS - 50 ? 'warn' : ''}`}>
              {variationHint.length}/{MAX_HINT_CHARS}
            </span>
          </div>
          <textarea
            className="st-textarea"
            placeholder={selectedChar
              ? 'e.g. "at the beach, sunset, wearing a casual sundress" — short hint, the LLM weaves it into the base prompt'
              : 'Pick a character first'}
            value={variationHint}
            onChange={(e) => setVariationHint(e.target.value.slice(0, MAX_HINT_CHARS))}
            disabled={!selectedChar || generating}
            rows={3}
          />
          {selectedChar && (
            <button
              type="button"
              className="st-preview-btn"
              onClick={handlePreview}
              disabled={previewLoading}
              title="See what will actually be sent to Seedream"
            >
              {previewLoading ? <Loader2 size={11} className="spin" /> : <Eye size={11} />}
              Preview merged prompt
            </button>
          )}
        </div>

        {/* Settings */}
        <div className="st-row">
          <div className="st-cell">
            <label>Aspect ratio</label>
            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} disabled={generating}>
              {ASPECT_RATIO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="st-cell">
            <label>Resolution</label>
            <select value={size} onChange={(e) => setSize(e.target.value)} disabled={generating}>
              {SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="st-cell">
            <label>Count</label>
            <select value={batchSize} onChange={(e) => setBatchSize(parseInt(e.target.value, 10))} disabled={generating}>
              {BATCH_OPTIONS.map((n) => <option key={n} value={n}>{n} image{n > 1 ? 's' : ''}</option>)}
            </select>
          </div>
        </div>

        <button type="button" className="st-advanced-toggle" onClick={() => setShowAdvanced((s) => !s)}>
          {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Advanced
        </button>

        {showAdvanced && (
          <div className="st-advanced">
            <div className="st-row">
              <div className="st-cell">
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
            <p className="st-hint">
              <strong>Seed</strong>: pin a number for reproducible results. Leave blank for variation.
            </p>
          </div>
        )}

        {error && <div className="st-error"><AlertCircle size={14} /> {error}</div>}

        <button
          className="btn btn-primary st-generate-btn"
          onClick={handleGenerate}
          disabled={generating || !selectedChar}
        >
          {generating ? (
            <><Loader2 size={14} className="spin" /> Generating… (15-90 sec)</>
          ) : (
            <><Wand2 size={14} /> Generate {batchSize > 1 ? `${batchSize} images` : 'image'}</>
          )}
        </button>
      </div>

      {/* Gallery */}
      <div className="studio-gallery-section">
        <div className="st-gallery-header">
          <h2><ImageIcon size={18} /> Recent generations</h2>
          {characters.length > 0 && (
            <select
              className="st-gallery-filter"
              value={galleryFilter}
              onChange={(e) => { setGalleryFilter(e.target.value); loadGenerations(e.target.value); }}
            >
              <option value="all">All characters</option>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {generations.length === 0 ? (
          <div className="st-gallery-empty">
            <Sparkles size={32} />
            <p>No generations yet.</p>
          </div>
        ) : (
          <div className="st-gallery">
            {generations.map((gen) => (
              <GenerationCard
                key={gen.id}
                gen={gen}
                onDelete={() => handleDeleteGen(gen)}
                onUpdate={(updated) => setGenerations((g) => g.map((x) => x.id === updated.id ? updated : x))}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CharacterModal
          character={editingChar}
          onClose={() => { setShowCreateModal(false); setEditingChar(null); }}
          onSaved={(saved) => {
            if (editingChar) {
              setCharacters((cs) => cs.map((c) => c.id === saved.id ? saved : c));
              if (selectedChar?.id === saved.id) setSelectedChar(saved);
            } else {
              setCharacters((cs) => [saved, ...cs]);
              setSelectedChar(saved);
              setAspectRatio(saved.default_aspect_ratio || '9:16');
              setSize(saved.default_size || '2K');
            }
            setShowCreateModal(false);
            setEditingChar(null);
          }}
        />
      )}

      {previewOpen && (
        <div className="st-modal-backdrop" onClick={() => setPreviewOpen(false)}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3><Eye size={16} /> Prompt that will be sent to Seedream</h3>
              <button className="st-modal-close" onClick={() => setPreviewOpen(false)}><X size={16} /></button>
            </div>
            <div className="st-modal-body">
              {previewLoading ? (
                <div className="st-loading"><Loader2 size={16} className="spin" /> Merging prompt…</div>
              ) : (
                <>
                  <div className="st-preview-meta">
                    Length: <strong>{previewLen}</strong> chars
                    {previewLen >= 1999 && (
                      <span className="st-preview-warn"> · close to 2000-char limit, may be truncated</span>
                    )}
                  </div>
                  <textarea
                    className="st-preview-textarea"
                    value={previewText}
                    readOnly
                    rows={20}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// CHARACTER MODAL — create / edit
// Reference photo upload goes browser-direct to Supabase Storage
// to dodge Render's request-size limit.
// ============================================================
function CharacterModal({ character, onClose, onSaved }) {
  const isEdit = !!character;

  const [name, setName] = useState(character?.name || '');
  const [basePrompt, setBasePrompt] = useState(character?.base_prompt || '');
  const [notes, setNotes] = useState(character?.notes || '');
  const [defaultAspect, setDefaultAspect] = useState(character?.default_aspect_ratio || '9:16');
  const [defaultSize, setDefaultSize] = useState(character?.default_size || '2K');
  const [coverUrl, setCoverUrl] = useState(character?.cover_image_url || '');

  // For new characters OR adding more refs to existing
  const [stagedFiles, setStagedFiles] = useState([]); // {file, previewUrl}
  // Already-uploaded URLs (from existing character or just-uploaded)
  const [refUrls, setRefUrls] = useState(character?.reference_image_urls || []);

  const [step, setStep] = useState('compose'); // compose | uploading | saving | failed
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const handleFiles = (files) => {
    setError('');
    const accepted = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > MAX_REF_FILE_MB * 1024 * 1024) {
        setError(`"${file.name}" is over ${MAX_REF_FILE_MB} MB`);
        continue;
      }
      accepted.push({
        file,
        previewUrl: URL.createObjectURL(file),
        name: file.name,
        size: file.size,
      });
    }
    setStagedFiles((s) => [...s, ...accepted]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleFiles(e.dataTransfer.files);
  };

  const removeStaged = (idx) => {
    setStagedFiles((s) => {
      const target = s[idx];
      if (target?.previewUrl) try { URL.revokeObjectURL(target.previewUrl); } catch {}
      return s.filter((_, i) => i !== idx);
    });
  };

  const removeExisting = (idx) => {
    setRefUrls((u) => u.filter((_, i) => i !== idx));
  };

  const totalRefs = refUrls.length + stagedFiles.length;

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) return setError('Name is required');
    if (!basePrompt.trim()) return setError('Base prompt is required');
    if (totalRefs < MIN_REFS) return setError(`Need at least ${MIN_REFS} reference images`);
    if (totalRefs > MAX_REFS) return setError(`Max ${MAX_REFS} reference images`);

    let finalUrls = [...refUrls];

    // Upload staged photos to Supabase Storage (browser-direct, no backend)
    if (stagedFiles.length > 0) {
      setStep('uploading');
      const folder = `chars/${Date.now()}-${name.trim().replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40)}`;

      const BATCH = 5;
      for (let i = 0; i < stagedFiles.length; i += BATCH) {
        const slice = stagedFiles.slice(i, i + BATCH);
        const results = await Promise.all(
          slice.map(async (s, j) => {
            const idx = i + j;
            const ext = s.file.type.includes('png') ? 'png'
                      : s.file.type.includes('webp') ? 'webp' : 'jpg';
            const path = `${folder}/${String(idx + 1).padStart(3, '0')}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from(REF_BUCKET)
              .upload(path, s.file, {
                contentType: s.file.type || 'image/jpeg',
                cacheControl: '604800',
                upsert: false,
              });
            if (upErr) throw new Error(`Upload ${idx + 1}: ${upErr.message}`);
            const { data: pub } = supabase.storage.from(REF_BUCKET).getPublicUrl(path);
            if (!pub?.publicUrl) throw new Error(`No public URL for photo ${idx + 1}`);
            return pub.publicUrl;
          })
        );
        finalUrls.push(...results);
        setProgress(`Uploaded ${finalUrls.length - refUrls.length}/${stagedFiles.length} new photos…`);
      }
    }

    setStep('saving');
    setProgress('Saving character…');
    try {
      const body = {
        name: name.trim(),
        base_prompt: basePrompt.trim(),
        reference_image_urls: finalUrls,
        cover_image_url: coverUrl?.trim() || finalUrls[0] || null,
        notes: notes?.trim() || null,
        default_aspect_ratio: defaultAspect,
        default_size: defaultSize,
      };
      const saved = isEdit
        ? await api.updateStudioCharacter(character.id, body)
        : await api.createStudioCharacter(body);
      onSaved(saved);
    } catch (err) {
      setError(err.message || 'Save failed');
      setStep('failed');
    }
  };

  return (
    <div className="st-modal-backdrop" onClick={step === 'uploading' || step === 'saving' ? undefined : onClose}>
      <div className="st-modal st-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="st-modal-header">
          <h3>{isEdit ? 'Edit character' : 'New character'}</h3>
          {step !== 'uploading' && step !== 'saving' && (
            <button className="st-modal-close" onClick={onClose}><X size={16} /></button>
          )}
        </div>

        {(step === 'compose' || step === 'failed') && (
          <div className="st-modal-body">
            <div className="st-field">
              <label>Name</label>
              <input
                type="text"
                placeholder="e.g. Sofia, Maia, Olivia"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                autoFocus
              />
            </div>

            <div className="st-field">
              <div className="st-section-label-row">
                <label>Base prompt (the full Seedream directive)</label>
                <span className={`st-counter ${basePrompt.length > 1900 ? 'warn' : ''}`}>
                  {basePrompt.length} chars
                </span>
              </div>
              <textarea
                className="st-textarea st-textarea-tall"
                placeholder={
                  `e.g. "Ultra realistic daylight iPhone front camera selfie of the same female character, ` +
                  `maintaining perfectly identical facial identity, same eyes, freckles, lips, jawline as the reference image…"`
                }
                value={basePrompt}
                onChange={(e) => setBasePrompt(e.target.value)}
                rows={10}
              />
              <p className="st-hint">
                <Info size={11} />
                This is the FULL directive used every time. Your variation hint (e.g. "at the beach")
                gets woven in by an LLM. Keep under ~1900 chars to leave room for variations.
              </p>
            </div>

            <div className="st-field">
              <div className="st-section-label-row">
                <label>Reference images ({totalRefs} total — need {MIN_REFS}-{MAX_REFS})</label>
              </div>
              {refUrls.length > 0 && (
                <div className="st-photo-grid">
                  {refUrls.map((url, i) => (
                    <div key={`existing-${i}`} className="st-photo-thumb st-photo-existing">
                      <img src={url} alt={`Reference ${i + 1}`} />
                      <button
                        type="button"
                        className="st-photo-remove"
                        onClick={() => removeExisting(i)}
                        title="Remove"
                      ><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
              {stagedFiles.length > 0 && (
                <div className="st-photo-grid">
                  {stagedFiles.map((s, i) => (
                    <div key={`staged-${i}`} className="st-photo-thumb st-photo-staged">
                      <img src={s.previewUrl} alt={s.name} />
                      <div className="st-photo-pending">new</div>
                      <button
                        type="button"
                        className="st-photo-remove"
                        onClick={() => removeStaged(i)}
                        title="Remove"
                      ><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
              {totalRefs < MAX_REFS && (
                <div
                  className="st-dropzone"
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('st-ref-file-input').click()}
                >
                  <Upload size={22} />
                  <strong>Drop reference photos or click to browse</strong>
                  <p>{MIN_REFS}-{MAX_REFS} total · JPG/PNG/WebP · max {MAX_REF_FILE_MB}MB each</p>
                  <input
                    id="st-ref-file-input"
                    type="file"
                    multiple
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                </div>
              )}
            </div>

            <div className="st-row">
              <div className="st-cell">
                <label>Default aspect ratio</label>
                <select value={defaultAspect} onChange={(e) => setDefaultAspect(e.target.value)}>
                  {ASPECT_RATIO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="st-cell">
                <label>Default resolution</label>
                <select value={defaultSize} onChange={(e) => setDefaultSize(e.target.value)}>
                  {SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            <div className="st-field">
              <label>Cover image URL (optional)</label>
              <input
                type="text"
                placeholder="Leave blank — defaults to the first reference"
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
              />
            </div>

            <div className="st-field">
              <label>Notes (optional)</label>
              <input
                type="text"
                placeholder="e.g. blonde, 25-35, casual Italian streetwear"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
              />
            </div>

            {error && <div className="st-error"><AlertCircle size={14} /> {error}</div>}

            <div className="st-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!name.trim() || !basePrompt.trim() || totalRefs < MIN_REFS}
              >
                {isEdit ? 'Save character' : 'Create character'} ({totalRefs} refs)
              </button>
            </div>
          </div>
        )}

        {(step === 'uploading' || step === 'saving') && (
          <div className="st-modal-body st-progress">
            <Loader2 size={32} className="spin" />
            <h4>{step === 'uploading' ? 'Uploading references…' : 'Saving…'}</h4>
            <p>{progress}</p>
            <p className="st-hint">Don't close this window.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// GENERATION CARD — image preview + Copy / Clean / Download / Delete
// ============================================================
function GenerationCard({ gen, onDelete, onUpdate }) {
  const urls = gen.image_urls || [];
  const cleanedUrls = gen.cleaned_image_urls || [];
  const hasCleaned = cleanedUrls.length > 0;
  const isMulti = urls.length > 1;
  const [activeIdx, setActiveIdx] = useState(0);
  const [showCleaned, setShowCleaned] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanError, setCleanError] = useState('');
  const [copied, setCopied] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  const handleDownload = (url, idx) => {
    const safeName = (gen.character_name || 'studio').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const suffix = showCleaned ? 'cleaned-' : '';
    const filename = `${safeName}-${suffix}${gen.id.slice(0, 8)}-${idx + 1}.jpg`;
    downloadFromUrl(url, filename);
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(gen.final_prompt || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = gen.final_prompt || '';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
      document.body.removeChild(ta);
    }
  };

  const handleClean = async () => {
    setCleanError('');
    setCleaning(true);
    try {
      const updated = await api.cleanStudioGeneration(gen.id);
      onUpdate?.(updated);
      setShowCleaned(true);
    } catch (err) {
      setCleanError(err.message || 'Cleaning failed');
    } finally {
      setCleaning(false);
    }
  };

  if (gen.status === 'failed' || gen.status === 'nsfw') {
    return (
      <div className="st-card st-card-failed">
        <div className="st-card-failed-icon"><AlertCircle size={22} /></div>
        <div className="st-card-failed-body">
          <strong>{gen.status === 'nsfw' ? 'Rejected (NSFW)' : 'Failed'}</strong>
          <p>{gen.error_message || 'Generation did not complete'}</p>
          <span className="st-card-meta">{gen.character_name}</span>
        </div>
        <button className="st-card-delete" onClick={onDelete} title="Remove"><X size={14} /></button>
      </div>
    );
  }

  const displayUrls = showCleaned && hasCleaned ? cleanedUrls : urls;
  const currentUrl = displayUrls[activeIdx];

  return (
    <div className="st-card">
      <div className="st-card-img-wrap">
        {currentUrl && <img src={currentUrl} alt="" />}
        {showCleaned && hasCleaned && (
          <div className="st-card-cleaned-badge"><Sparkles size={10} /> Cleaned</div>
        )}
        {isMulti && (
          <div className="st-card-pager">
            {displayUrls.map((_, i) => (
              <button
                key={i}
                className={`st-pager-dot ${activeIdx === i ? 'active' : ''}`}
                onClick={() => setActiveIdx(i)}
                aria-label={`Image ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
      <div className="st-card-body">
        <div className="st-card-meta"><strong>{gen.character_name || 'Character'}</strong></div>
        {gen.variation_hint && (
          <div className="st-card-hint" title={gen.variation_hint}>
            "{gen.variation_hint}"
          </div>
        )}
        {hasCleaned && (
          <div className="st-card-toggle">
            <button className={!showCleaned ? 'active' : ''} onClick={() => setShowCleaned(false)}>Original</button>
            <button className={showCleaned ? 'active' : ''} onClick={() => setShowCleaned(true)}>
              <Sparkles size={10} /> Cleaned
            </button>
          </div>
        )}
        {cleanError && (
          <div className="st-card-clean-error">
            <AlertCircle size={11} /> {cleanError}
          </div>
        )}
        <div className="st-card-actions">
          <button
            className="btn btn-secondary btn-sm st-card-action"
            onClick={() => handleDownload(currentUrl, activeIdx)}
          >
            <Download size={12} /> Download
          </button>
          {hasCleaned ? (
            <button
              className="btn btn-secondary btn-sm st-card-action st-card-action-cleaned"
              disabled
            >
              <CheckCircle2 size={12} /> Cleaned
            </button>
          ) : (
            <button
              className="btn btn-secondary btn-sm st-card-action"
              onClick={handleClean}
              disabled={cleaning}
            >
              {cleaning ? <><Loader2 size={12} className="spin" /> Cleaning…</> : <><Sparkles size={12} /> Clean</>}
            </button>
          )}
          <button
            className="st-card-icon-btn"
            onClick={() => setPromptOpen(true)}
            title="View full prompt"
          ><FileText size={12} /></button>
          <button
            className="st-card-icon-btn"
            onClick={handleCopyPrompt}
            title="Copy prompt"
          >
            {copied ? <CheckCircle2 size={12} style={{ color: '#4ade80' }} /> : <Copy size={12} />}
          </button>
          <button className="st-card-delete" onClick={onDelete} title="Delete"><Trash2 size={12} /></button>
        </div>
      </div>

      {promptOpen && (
        <div className="st-modal-backdrop" onClick={() => setPromptOpen(false)}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3><FileText size={16} /> Full prompt sent to Seedream</h3>
              <button className="st-modal-close" onClick={() => setPromptOpen(false)}><X size={16} /></button>
            </div>
            <div className="st-modal-body">
              {gen.variation_hint && (
                <div className="st-preview-meta">
                  Your variation hint: <strong>"{gen.variation_hint}"</strong>
                </div>
              )}
              <textarea
                className="st-preview-textarea"
                value={gen.final_prompt || ''}
                readOnly
                rows={20}
              />
              <div className="st-modal-actions">
                <button className="btn btn-secondary" onClick={handleCopyPrompt}>
                  {copied ? <><CheckCircle2 size={12} /> Copied</> : <><Copy size={12} /> Copy to clipboard</>}
                </button>
                <button className="btn btn-secondary" onClick={() => setPromptOpen(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
