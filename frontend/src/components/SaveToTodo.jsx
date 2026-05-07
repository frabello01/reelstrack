import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, Plus, Check } from 'lucide-react';
import { api } from '../lib/api';
import './SaveToTodo.css';

export default function SaveToTodo({ reelId }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [todos, setTodos] = useState([]);
  const [savedIn, setSavedIn] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const btnRef = useRef();
  const dropdownRef = useRef();

  useEffect(() => {
    const handler = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadTodos = async () => {
    setLoading(true);
    try {
      const lists = await api.getTodos();
      setTodos(lists);
      const containing = new Set();
      for (const l of lists) {
        const detail = await api.getTodo(l.id);
        if ((detail.items || []).some((i) => i.reels?.id === reelId)) containing.add(l.id);
      }
      setSavedIn(containing);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // Position above & to the right; flip if near bottom of viewport
      const dropdownH = 280;
      const dropdownW = 220;
      const top = rect.bottom + dropdownH > window.innerHeight
        ? rect.top - dropdownH - 6
        : rect.bottom + 6;
      const left = Math.min(rect.right - dropdownW, window.innerWidth - dropdownW - 8);
      setCoords({ top: Math.max(8, top), left: Math.max(8, left) });
      loadTodos();
    }
    setOpen(!open);
  };

  const toggleSave = async (todoId) => {
    if (savedIn.has(todoId)) {
      await api.removeReelFromTodo(todoId, reelId);
      const next = new Set(savedIn);
      next.delete(todoId);
      setSavedIn(next);
    } else {
      await api.addReelToTodo(todoId, reelId);
      setSavedIn(new Set([...savedIn, todoId]));
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const list = await api.createTodo(newName.trim());
    await api.addReelToTodo(list.id, reelId);
    setNewName('');
    setCreating(false);
    loadTodos();
  };

  return (
    <>
      <button
        ref={btnRef}
        className={`save-btn ${savedIn.size > 0 ? 'saved' : ''}`}
        onClick={handleOpen}
        title="Save to to-do list"
      >
        <Bookmark size={14} fill={savedIn.size > 0 ? 'currentColor' : 'none'} />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="save-dropdown"
          style={{ top: coords.top, left: coords.left }}
        >
          <div className="save-dropdown-header">Save to…</div>

          {loading && <div className="save-loading">Loading…</div>}
          {!loading && todos.length === 0 && !creating && (
            <div className="save-empty">No lists yet</div>
          )}

          {!loading && todos.map((t) => (
            <button
              key={t.id}
              className={`save-item ${savedIn.has(t.id) ? 'active' : ''}`}
              onClick={() => toggleSave(t.id)}
            >
              <span>{t.name}</span>
              {savedIn.has(t.id) && <Check size={14} />}
            </button>
          ))}

          {creating ? (
            <div className="save-create">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="List name…"
              />
              <button onClick={handleCreate}>Create</button>
            </div>
          ) : (
            <button className="save-new" onClick={() => setCreating(true)}>
              <Plus size={14} /> New list
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
