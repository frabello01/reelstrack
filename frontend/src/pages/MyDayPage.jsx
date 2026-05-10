import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, Calendar, Sparkles, ListChecks, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import './MyDayPage.css';

export default function MyDayPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.getTodaysTasks();
      setData(result);
    } catch (err) {
      setError(err.message || 'Could not load tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const totals = useMemo(() => {
    if (!data?.groups) return { total: 0, done: 0 };
    let total = 0; let done = 0;
    for (const g of data.groups) {
      for (const p of g.profiles) {
        for (const t of p.tasks) {
          total++;
          if (t.is_done) done++;
        }
      }
    }
    return { total, done };
  }, [data]);

  const handleToggle = async (taskId, currentlyDone) => {
    // Optimistic update
    setData((d) => ({
      ...d,
      groups: d.groups.map((g) => ({
        ...g,
        profiles: g.profiles.map((p) => ({
          ...p,
          tasks: p.tasks.map((t) => t.id === taskId ? { ...t, is_done: !currentlyDone } : t),
        })),
      })),
    }));
    try {
      await api.toggleDailyTask(taskId, !currentlyDone);
    } catch (err) {
      console.error('[my-day] toggle failed, reloading:', err.message);
      load();
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00'); // mid-day to avoid TZ edge cases
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div className="my-day">
      <div className="my-day-header">
        <div>
          <h1><Sparkles size={22} /> My Day</h1>
          <p className="my-day-date">{formatDate(data?.date)}</p>
        </div>
        {totals.total > 0 && (
          <div className="my-day-progress">
            <div className="my-day-progress-text">
              <strong>{totals.done}</strong> / {totals.total} done
            </div>
            <div className="my-day-progress-bar">
              <div
                className="my-day-progress-fill"
                style={{ width: `${totals.total ? (totals.done / totals.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="my-day-error"><AlertCircle size={14} /> {error}</div>
      )}

      {!data?.groups || data.groups.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="my-day-groups">
          {data.groups.map((g) => (
            <TalentGroup key={g.id} group={g} onToggle={handleToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="my-day-empty">
      <ListChecks size={48} />
      <h3>No tasks for today</h3>
      <p>To get started:</p>
      <ol>
        <li>Define recurring tasks in <Link to="/settings">Settings → Daily tasks</Link> (e.g. "Post 1 Story", "15 min warmup")</li>
        <li>Make sure you have at least one <strong>active</strong> IG profile in <Link to="/my-creators">My Creators</Link></li>
        <li>Refresh this page — the system will generate today's checklist automatically</li>
      </ol>
    </div>
  );
}

function TalentGroup({ group, onToggle }) {
  // Per-talent progress
  const total = group.profiles.reduce((s, p) => s + p.tasks.length, 0);
  const done = group.profiles.reduce((s, p) => s + p.tasks.filter((t) => t.is_done).length, 0);
  const allDone = total > 0 && done === total;

  return (
    <div className={`talent-group ${allDone ? 'all-done' : ''}`}>
      <div className="talent-group-header">
        <h2>{group.name}</h2>
        <span className="talent-group-progress">
          {done} / {total}
        </span>
      </div>
      <div className="talent-group-profiles">
        {group.profiles.map((p) => (
          <ProfileBlock key={p.id} profile={p} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}

function ProfileBlock({ profile, onToggle }) {
  const done = profile.tasks.filter((t) => t.is_done).length;
  const total = profile.tasks.length;
  const allDone = done === total && total > 0;

  return (
    <div className={`profile-block ${allDone ? 'profile-all-done' : ''}`}>
      <div className="profile-block-header">
        <div className="profile-block-pic">
          {profile.profile_pic_url ? (
            <img src={profile.profile_pic_url} alt="" />
          ) : (
            <div className="profile-block-placeholder">{profile.username[0]?.toUpperCase()}</div>
          )}
        </div>
        <div className="profile-block-info">
          <div className="profile-block-username">@{profile.username}</div>
          <div className="profile-block-stats">{done} / {total}</div>
        </div>
      </div>
      <div className="profile-block-tasks">
        {profile.tasks.map((t) => (
          <button
            key={t.id}
            className={`task-item ${t.is_done ? 'done' : ''}`}
            onClick={() => onToggle(t.id, t.is_done)}
          >
            {t.is_done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
