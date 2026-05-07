import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Plus, Trash2, Users, ChevronRight } from 'lucide-react';
import './ListsPage.css';

const COLORS = ['#7c6bff', '#22d3a5', '#ff6b6b', '#ffd166', '#60a5fa', '#f472b6', '#a78bfa', '#34d399'];

export default function ListsPage() {
  const [lists, setLists] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: COLORS[0] });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    api.getLists().then(setLists).catch(console.error);
  }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const list = await api.createList(form);
      setLists((prev) => [...prev, list]);
      setShowModal(false);
      setForm({ name: '', description: '', color: COLORS[0] });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this list? Creators won\'t be deleted.')) return;
    setDeleting(id);
    try {
      await api.deleteList(id);
      setLists((prev) => prev.filter((l) => l.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="lists-page">
      <div className="dashboard-header">
        <div>
          <h1 className="page-title">Creator Lists</h1>
          <p className="page-sub">Organize creators into groups to filter your dashboard</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={15} /> New List
        </button>
      </div>

      {lists.length === 0 ? (
        <div className="empty-state">
          <Users size={48} />
          <h3>No lists yet</h3>
          <p>Create your first list — e.g. "Italian creators", "USA Fitness"</p>
          <button className="btn btn-primary" onClick={() => setShowModal(true)} style={{ marginTop: 8 }}>
            <Plus size={15} /> Create a list
          </button>
        </div>
      ) : (
        <div className="lists-grid">
          {lists.map((list) => {
            const count = list.list_creators?.[0]?.count ?? 0;
            return (
              <div key={list.id} className="list-card">
                <div className="list-color-bar" style={{ background: list.color }} />
                <div className="list-card-body">
                  <div className="list-card-top">
                    <h3 className="list-name">{list.name}</h3>
                    <button
                      className="btn btn-ghost btn-sm icon-btn"
                      onClick={() => handleDelete(list.id)}
                      disabled={deleting === list.id}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {list.description && <p className="list-desc">{list.description}</p>}
                  <div className="list-card-footer">
                    <span className="list-count"><Users size={13} /> {count} creators</span>
                    <Link to={`/lists/${list.id}`} className="btn btn-ghost btn-sm">
                      Manage <ChevronRight size={13} />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <h2 className="modal-title">New Creator List</h2>
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Italian Creators"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Color</label>
              <div className="color-picker">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`color-swatch ${form.color === c ? 'selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => setForm({ ...form, color: c })}
                  />
                ))}
              </div>
            </div>
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !form.name}>
                {saving ? 'Creating...' : 'Create List'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
