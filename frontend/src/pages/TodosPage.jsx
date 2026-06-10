import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, CheckSquare, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import './TodosPage.css';

export default function TodosPage() {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      setTodos(await api.getTodos());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createTodo(name.trim());
    setName('');
    setShowModal(false);
    load();
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Delete this to-do list?')) return;
    await api.deleteTodo(id);
    load();
  };

  return (
    <div className="todos-page">
      <div className="page-header">
        <div>
          <h1>To-Do Lists</h1>
          <p className="page-subtitle">Save reels and track which ones the creator has done.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> New list
        </button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : todos.length === 0 ? (
        <div className="empty-state">
          <CheckSquare size={48} />
          <h3>No to-do lists yet</h3>
          <p>Create a list and save reels to it from the dashboard.</p>
        </div>
      ) : (
        <div className="todos-grid">
          {todos.map((t) => (
            <div key={t.id} className="todo-card" onClick={() => navigate(`/todos/${t.id}`)}>
              <div className="todo-thumb">
                {t.cover_image_url ? (
                  <img src={t.cover_image_url} alt={t.name} />
                ) : t.preview_thumbnail ? (
                  <img src={t.preview_thumbnail} alt={t.name} />
                ) : (
                  <div className="todo-thumb-placeholder"><CheckSquare size={32} /></div>
                )}
              </div>
              <div className="todo-info">
                <div className="todo-name">{t.name}</div>
                <div className="todo-meta todo-meta-stacked">
                  <span className="todo-meta-pending">
                    {(t.pending_count ?? 0)}/{t.total_reels ?? 0} pending
                  </span>
                  <span className="todo-meta-toedit">
                    {(t.to_be_edited_count ?? 0)} to be edited
                  </span>
                </div>
              </div>
              <button className="todo-delete" onClick={(e) => handleDelete(t.id, e)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <h2>New to-do list</h2>
            <form onSubmit={handleCreate}>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Bianca's reels"
              />
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
