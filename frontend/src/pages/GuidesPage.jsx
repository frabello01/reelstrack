import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, BookOpen, Trash2, FileText } from 'lucide-react';
import { api } from '../lib/api';
import './GuidesPage.css';

export default function GuidesPage() {
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async (q = '') => {
    setLoading(true);
    try {
      setArticles(await api.getGuides(q));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const article = await api.createGuide({ title: 'Untitled article', content: null, content_text: '' });
      navigate(`/guides/${article.id}`);
    } catch (err) {
      alert(`Could not create: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e, id, title) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${title}"? This can't be undone.`)) return;
    await api.deleteGuide(id);
    load(search);
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="guides-page">
      <div className="guides-header">
        <div>
          <h1><BookOpen size={22} /> Guides</h1>
          <p className="subtitle">Your internal knowledge base — SOPs, runbooks, anything worth writing down.</p>
        </div>
        <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
          <Plus size={14} /> {creating ? 'Creating...' : 'New article'}
        </button>
      </div>

      <div className="guides-search-row">
        <Search size={14} className="guides-search-icon" />
        <input
          type="text"
          placeholder="Search by title or content…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : articles.length === 0 ? (
        <div className="guides-empty">
          <FileText size={48} />
          {search ? (
            <>
              <h3>No matches</h3>
              <p>No articles match "{search}". Try a different search term.</p>
            </>
          ) : (
            <>
              <h3>No articles yet</h3>
              <p>Click "New article" to write your first SOP.</p>
            </>
          )}
        </div>
      ) : (
        <div className="guides-list">
          {articles.map((a) => (
            <Link to={`/guides/${a.id}`} key={a.id} className="guide-card">
              <div className="guide-card-main">
                <FileText size={16} className="guide-card-icon" />
                <div className="guide-card-info">
                  <div className="guide-card-title">{a.title || 'Untitled'}</div>
                  <div className="guide-card-meta">
                    Updated {formatDate(a.updated_at)}
                    {a.created_at !== a.updated_at && (
                      <span className="guide-card-created"> · created {formatDate(a.created_at)}</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                className="guide-card-delete"
                onClick={(e) => handleDelete(e, a.id, a.title)}
                aria-label="Delete article"
              >
                <Trash2 size={13} />
              </button>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
