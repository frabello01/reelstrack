import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen, Film, Plus, Pin, PinOff, Edit2, Trash2, Loader2, AlertCircle,
  X, ChevronDown, GripVertical, FolderOpen, Sparkles, Image as ImageIcon,
  ChevronRight, MoreVertical, Move,
} from 'lucide-react';
import { api } from '../lib/api';
import './GuidesPage.css';

// ============================================================
// CONSTANTS
// ============================================================
const UNCAT_CATEGORY = { id: 'uncategorized', name: 'Uncategorized', icon: '📋', color: '#71717a', sort_order: 9999 };

const COLOR_PRESETS = [
  '#a78bfa', '#f472b6', '#60a5fa', '#34d399', '#fbbf24',
  '#fb7185', '#22d3ee', '#a3e635', '#facc15', '#c084fc',
];

const ICON_PRESETS = ['📚', '🎬', '⚡', '🔧', '💡', '🎯', '🚀', '📋', '🎨', '🔒', '💰', '📊', '🏆', '⭐', '🛠️'];

// ============================================================
// PAGE
// ============================================================
export default function GuidesPage() {
  const navigate = useNavigate();

  const [categories, setCategories] = useState([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [items, setItems] = useState([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState('');

  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [showMoveModalFor, setShowMoveModalFor] = useState(null); // {type, id}

  // Drag state for items
  const draggedItemRef = useRef(null);

  useEffect(() => { loadCategories(); }, []);
  useEffect(() => {
    if (selectedCategoryId) loadItems(selectedCategoryId);
  }, [selectedCategoryId]);

  // Close the "new" dropdown on outside click
  useEffect(() => {
    if (!showNewMenu) return;
    const handler = () => setShowNewMenu(false);
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [showNewMenu]);

  const loadCategories = async () => {
    setLoadingCats(true);
    try {
      const r = await api.getGuideCategories();
      const cats = r.categories || [];
      setCategories(cats);
      setUncategorizedCount(r.uncategorized_count || 0);
      // Auto-select first category on first load (no "All" option anymore)
      if (!selectedCategoryId) {
        if (cats.length > 0) setSelectedCategoryId(cats[0].id);
        else if ((r.uncategorized_count || 0) > 0) setSelectedCategoryId('uncategorized');
      }
    } catch (err) {
      setError(`Couldn't load categories: ${err.message}`);
    } finally {
      setLoadingCats(false);
    }
  };

  const loadItems = async (catId) => {
    setLoadingItems(true);
    try {
      const r = await api.getGuideItems(catId);
      setItems(r.items || []);
    } catch (err) {
      setError(`Couldn't load items: ${err.message}`);
    } finally {
      setLoadingItems(false);
    }
  };

  // ============================================================
  // CATEGORY ACTIONS
  // ============================================================
  const handleSaveCategory = async (payload) => {
    try {
      if (editingCategory) {
        const updated = await api.updateGuideCategory(editingCategory.id, payload);
        setCategories((cs) => cs.map((c) => c.id === updated.id ? { ...c, ...updated } : c));
      } else {
        const created = await api.createGuideCategory(payload);
        setCategories((cs) => [...cs, { ...created, item_count: 0 }]);
      }
      setShowCategoryModal(false);
      setEditingCategory(null);
    } catch (err) {
      throw err;
    }
  };

  const handleDeleteCategory = async (cat) => {
    if (!confirm(`Delete category "${cat.name}"? Items in it become uncategorized (not deleted).`)) return;
    try {
      await api.deleteGuideCategory(cat.id);
      setCategories((cs) => {
        const next = cs.filter((c) => c.id !== cat.id);
        // If the deleted one was selected, jump to another
        if (selectedCategoryId === cat.id) {
          setSelectedCategoryId(next[0]?.id || 'uncategorized');
        }
        return next;
      });
      loadCategories(); // refresh counts (uncategorized went up)
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  // ============================================================
  // ITEM ACTIONS
  // ============================================================
  const handleNew = async (type) => {
    setShowNewMenu(false);
    if (type === 'category') {
      setEditingCategory(null);
      setShowCategoryModal(true);
      return;
    }
    if (type !== 'article' && type !== 'video') return;

    // Create the stub row server-side so we get a real UUID, then navigate.
    // Solves the "invalid input syntax for type uuid: undefined" bug.
    try {
      const catId = selectedCategoryId !== 'all' && selectedCategoryId !== 'uncategorized'
        ? selectedCategoryId
        : null;
      const stub = await api.createGuideItem(type, catId);
      if (type === 'article') navigate(`/guides/${stub.id}`);
      else navigate(`/lessons/${stub.id}`);
    } catch (err) {
      alert(`Couldn't create new ${type}: ${err.message}`);
    }
  };

  const handleOpenItem = (item) => {
    if (item.item_type === 'article') navigate(`/guides/${item.id}`);
    else if (item.item_type === 'video') navigate(`/lessons/${item.id}`);
  };

  const handlePin = async (item) => {
    try {
      const updated = await api.toggleGuideItemPin(item.item_type, item.id, !item.is_pinned);
      // Refresh the items list to get proper sort
      loadItems(selectedCategoryId);
    } catch (err) {
      alert(`Pin failed: ${err.message}`);
    }
  };

  const handleDelete = async (item) => {
    if (!confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    try {
      if (item.item_type === 'article') await api.deleteGuide(item.id);
      else await api.deleteLesson(item.id);
      setItems((arr) => arr.filter((x) => !(x.id === item.id && x.item_type === item.item_type)));
      loadCategories(); // refresh counts
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleMoveItem = async (categoryId) => {
    if (!showMoveModalFor) return;
    try {
      await api.moveGuideItem(showMoveModalFor.type, showMoveModalFor.id, categoryId);
      setShowMoveModalFor(null);
      loadItems(selectedCategoryId);
      loadCategories();
    } catch (err) {
      alert(`Move failed: ${err.message}`);
    }
  };

  // ============================================================
  // DRAG-DROP REORDER
  // ============================================================
  const onItemDragStart = (e, idx) => {
    draggedItemRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('dragging');
  };

  const onItemDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onItemDragEnter = (e, idx) => {
    e.preventDefault();
    if (draggedItemRef.current === null || draggedItemRef.current === idx) return;
    e.currentTarget.classList.add('drag-over');
  };

  const onItemDragLeave = (e) => {
    e.currentTarget.classList.remove('drag-over');
  };

  const onItemDrop = async (e, targetIdx) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const fromIdx = draggedItemRef.current;
    if (fromIdx === null || fromIdx === targetIdx) return;

    // Optimistic UI update
    const next = [...items];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(targetIdx, 0, moved);
    setItems(next);
    draggedItemRef.current = null;

    // Persist to backend
    try {
      const ordered = next.map((i) => ({ type: i.item_type, id: i.id }));
      await api.reorderGuideItems(ordered);
    } catch (err) {
      alert(`Reorder failed: ${err.message}`);
      loadItems(selectedCategoryId); // revert
    }
  };

  const onItemDragEnd = (e) => {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.gp-item.drag-over').forEach((el) => el.classList.remove('drag-over'));
  };

  // ============================================================
  // PILLS
  // ============================================================
  const visiblePills = useMemo(() => {
    const list = [...categories];
    if (uncategorizedCount > 0) list.push({ ...UNCAT_CATEGORY, item_count: uncategorizedCount });
    return list;
  }, [categories, uncategorizedCount]);

  const selectedCategory = useMemo(() => {
    return visiblePills.find((c) => c.id === selectedCategoryId) || visiblePills[0] || null;
  }, [visiblePills, selectedCategoryId]);

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="gp-page">
      <header className="gp-header">
        <div>
          <h1><BookOpen size={22} /> Guides</h1>
          <p className="gp-subtitle">
            Text guides and video tutorials, organized by category.
          </p>
        </div>
        <div className="gp-header-actions">
          <div className="gp-new-wrap">
            <button
              className="btn btn-primary"
              onClick={(e) => { e.stopPropagation(); setShowNewMenu((s) => !s); }}
            >
              <Plus size={14} /> New <ChevronDown size={12} />
            </button>
            {showNewMenu && (
              <div className="gp-new-menu" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => handleNew('article')}>
                  <BookOpen size={14} /> New article
                </button>
                <button onClick={() => handleNew('video')}>
                  <Film size={14} /> New video tutorial
                </button>
                <div className="gp-new-menu-sep" />
                <button onClick={() => handleNew('category')}>
                  <FolderOpen size={14} /> New category
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Category pills */}
      <div className="gp-pills-wrap">
        {loadingCats ? (
          <div className="gp-loading-row"><Loader2 size={14} className="spin" /> Loading categories…</div>
        ) : (
          <div className="gp-pills">
            {visiblePills.map((c) => (
              <CategoryPill
                key={c.id}
                category={c}
                selected={selectedCategoryId === c.id}
                onClick={() => setSelectedCategoryId(c.id)}
                onEdit={() => { setEditingCategory(c); setShowCategoryModal(true); }}
                onDelete={() => handleDeleteCategory(c)}
              />
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="gp-error"><AlertCircle size={14} /> {error}</div>
      )}

      {/* Items pane */}
      <div className="gp-items-pane">
        <div className="gp-items-header">
          <h2>
            <span className="gp-items-emoji">{selectedCategory?.icon || '📁'}</span>
            {selectedCategory?.name || 'No category selected'}
          </h2>
          <span className="gp-items-count">
            {loadingItems ? '…' : `${items.length} item${items.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {loadingItems || loadingCats ? (
          <div className="gp-loading-block"><Loader2 size={20} className="spin" /></div>
        ) : visiblePills.length === 0 ? (
          <div className="gp-empty">
            <Sparkles size={28} />
            <h3>No categories yet</h3>
            <p>
              Click <strong>+ New → New category</strong> at the top right to
              create your first category. Then add articles or video tutorials
              to it.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="gp-empty">
            <Sparkles size={28} />
            <h3>No items in this category yet</h3>
            <p>
              Click <strong>+ New</strong> at the top right to add an article
              or video to "{selectedCategory?.name || 'this category'}".
            </p>
          </div>
        ) : (
          <div className="gp-items-list">
            {items.map((item, idx) => (
              <div
                key={`${item.item_type}-${item.id}`}
                className={`gp-item ${item.is_pinned ? 'pinned' : ''}`}
                draggable
                onDragStart={(e) => onItemDragStart(e, idx)}
                onDragOver={onItemDragOver}
                onDragEnter={(e) => onItemDragEnter(e, idx)}
                onDragLeave={onItemDragLeave}
                onDrop={(e) => onItemDrop(e, idx)}
                onDragEnd={onItemDragEnd}
              >
                <div className="gp-item-handle"><GripVertical size={14} /></div>

                <div className="gp-item-thumb-wrap" onClick={() => handleOpenItem(item)}>
                  {item.thumbnail_url ? (
                    <img src={item.thumbnail_url} alt="" />
                  ) : (
                    <div className="gp-item-thumb-placeholder">
                      {item.item_type === 'article' ? <BookOpen size={18} /> : <Film size={18} />}
                    </div>
                  )}
                  {item.item_type === 'video' && (
                    <div className="gp-item-type-badge"><Film size={9} /> Video</div>
                  )}
                </div>

                <div className="gp-item-body" onClick={() => handleOpenItem(item)}>
                  <div className="gp-item-title-row">
                    {item.is_pinned && <Pin size={11} className="gp-item-pin-icon" />}
                    <h3>{item.title || 'Untitled'}</h3>
                  </div>
                  {item.summary && <p className="gp-item-summary">{item.summary}</p>}
                  <div className="gp-item-meta">
                    <span>Updated {formatDate(item.updated_at)}</span>
                    {item.duration_seconds && (
                      <span>· {formatDuration(item.duration_seconds)}</span>
                    )}
                  </div>
                </div>

                <ItemMenu
                  item={item}
                  onPin={() => handlePin(item)}
                  onMove={() => setShowMoveModalFor({ type: item.item_type, id: item.id })}
                  onDelete={() => handleDelete(item)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {showCategoryModal && (
        <CategoryModal
          category={editingCategory}
          onClose={() => { setShowCategoryModal(false); setEditingCategory(null); }}
          onSave={handleSaveCategory}
        />
      )}

      {showMoveModalFor && (
        <MoveItemModal
          categories={categories}
          onSelect={handleMoveItem}
          onClose={() => setShowMoveModalFor(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// CATEGORY PILL
// ============================================================
function CategoryPill({ category, selected, onClick, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(false);
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [menuOpen]);

  const isVirtual = category.id === 'uncategorized';

  return (
    <div
      className={`gp-pill ${selected ? 'selected' : ''}`}
      style={selected ? { borderColor: category.color, backgroundColor: `${category.color}22` } : undefined}
    >
      <button className="gp-pill-main" onClick={onClick}>
        <span className="gp-pill-icon">{category.icon}</span>
        <span className="gp-pill-name">{category.name}</span>
        {category.item_count !== undefined && (
          <span className="gp-pill-count">{category.item_count}</span>
        )}
      </button>
      {!isVirtual && (
        <div className="gp-pill-menu-wrap">
          <button
            className="gp-pill-menu-btn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((s) => !s); }}
            aria-label="Category options"
          >
            <MoreVertical size={12} />
          </button>
          {menuOpen && (
            <div className="gp-pill-menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setMenuOpen(false); onEdit(); }}>
                <Edit2 size={11} /> Edit
              </button>
              <button onClick={() => { setMenuOpen(false); onDelete(); }} className="danger">
                <Trash2 size={11} /> Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// ITEM MENU (pin / move / delete)
// ============================================================
function ItemMenu({ item, onPin, onMove, onDelete }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  return (
    <div className="gp-item-menu-wrap">
      <button
        className="gp-item-menu-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((s) => !s); }}
        aria-label="Item options"
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className="gp-item-menu" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setOpen(false); onPin(); }}>
            {item.is_pinned ? <><PinOff size={11} /> Unpin</> : <><Pin size={11} /> Pin to top</>}
          </button>
          <button onClick={() => { setOpen(false); onMove(); }}>
            <Move size={11} /> Move to…
          </button>
          <div className="gp-item-menu-sep" />
          <button onClick={() => { setOpen(false); onDelete(); }} className="danger">
            <Trash2 size={11} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// CATEGORY MODAL
// ============================================================
function CategoryModal({ category, onClose, onSave }) {
  const [name, setName] = useState(category?.name || '');
  const [description, setDescription] = useState(category?.description || '');
  const [icon, setIcon] = useState(category?.icon || '📚');
  const [color, setColor] = useState(category?.color || COLOR_PRESETS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) return setError('Name is required');
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim() || null, icon, color });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="gp-modal-backdrop" onClick={onClose}>
      <div className="gp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gp-modal-header">
          <h3>{category ? 'Edit category' : 'New category'}</h3>
          <button className="gp-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="gp-modal-body">
          <div className="gp-field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Onboarding, Chatter SOPs, Compliance"
              maxLength={100}
              autoFocus
            />
          </div>

          <div className="gp-field">
            <label>Icon</label>
            <div className="gp-icon-picker">
              {ICON_PRESETS.map((i) => (
                <button
                  key={i}
                  type="button"
                  className={`gp-icon-option ${icon === i ? 'selected' : ''}`}
                  onClick={() => setIcon(i)}
                >{i}</button>
              ))}
              <input
                type="text"
                className="gp-icon-custom"
                value={icon}
                onChange={(e) => setIcon(e.target.value.slice(0, 4))}
                placeholder="🎨"
                maxLength={4}
              />
            </div>
          </div>

          <div className="gp-field">
            <label>Color</label>
            <div className="gp-color-picker">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`gp-color-option ${color === c ? 'selected' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="gp-field">
            <label>Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What kind of items go in here?"
              rows={2}
              maxLength={300}
            />
          </div>

          {error && <div className="gp-error"><AlertCircle size={13} /> {error}</div>}

          <div className="gp-modal-actions">
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !name.trim()}>
              {saving ? <><Loader2 size={12} className="spin" /> Saving…</> : (category ? 'Save changes' : 'Create category')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MOVE-ITEM MODAL
// ============================================================
function MoveItemModal({ categories, onSelect, onClose }) {
  return (
    <div className="gp-modal-backdrop" onClick={onClose}>
      <div className="gp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gp-modal-header">
          <h3>Move to category</h3>
          <button className="gp-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="gp-modal-body gp-move-body">
          {categories.map((c) => (
            <button key={c.id} className="gp-move-option" onClick={() => onSelect(c.id)}>
              <span className="gp-move-icon">{c.icon}</span>
              <span className="gp-move-name">{c.name}</span>
              <ChevronRight size={14} />
            </button>
          ))}
          <div className="gp-move-sep" />
          <button className="gp-move-option" onClick={() => onSelect(null)}>
            <span className="gp-move-icon">📋</span>
            <span className="gp-move-name">Uncategorized</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// UTIL
// ============================================================
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString();
}

function formatDuration(s) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m > 0 ? `${m}:${String(ss).padStart(2, '0')}` : `0:${String(ss).padStart(2, '0')}`;
}
