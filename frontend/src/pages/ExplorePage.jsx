import { useEffect, useState, useRef, useMemo } from 'react';
import { Compass, Sparkles, RefreshCw, Plus, EyeOff, Eye, Check, AlertCircle, BadgeCheck, Lock } from 'lucide-react';
import { api } from '../lib/api';
import './ExplorePage.css';

const POLL_MS = 1500;

export default function ExplorePage() {
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [sourceList, setSourceList] = useState(null);
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState(null);
  const [showHidden, setShowHidden] = useState(false);
  const [busyIds, setBusyIds] = useState(new Set());
  const [addPickerForId, setAddPickerForId] = useState(null); // suggestion id whose list-picker dropdown is open
  const [toast, setToast] = useState(null); // { type:'ok'|'err', text }
  const pollRef = useRef(null);

  // ---- Load lists once ----
  useEffect(() => {
    api.getLists().then((rows) => {
      setLists(rows);
      if (rows.length > 0 && !selectedListId) setSelectedListId(rows[0].id);
    }).catch((err) => setToast({ type: 'err', text: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Load suggestions whenever list changes ----
  const loadSuggestions = async (listId) => {
    if (!listId) return;
    setLoading(true);
    try {
      const { list, suggestions } = await api.getSuggestions(listId);
      setSourceList(list);
      setSuggestions(suggestions || []);
    } catch (err) {
      setToast({ type: 'err', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedListId) loadSuggestions(selectedListId);
    // Also pick up any already-running scan
    checkActiveScan(selectedListId);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedListId]);

  // ---- Scan handling ----
  const checkActiveScan = async (listId) => {
    if (!listId) return;
    try {
      const active = await api.getActiveSuggestionScan(listId);
      if (active) {
        setJob(active);
        startPolling(listId);
      } else {
        setJob(null);
      }
    } catch {}
  };

  const startPolling = (listId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const active = await api.getActiveSuggestionScan(listId);
        if (active) {
          setJob(active);
        } else {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setJob(null);
          // Scan finished — refresh suggestions
          await loadSuggestions(listId);
          setToast({ type: 'ok', text: 'Scan complete' });
        }
      } catch {}
    }, POLL_MS);
  };

  const handleRunScan = async () => {
    if (!selectedListId || job) return;
    try {
      await api.triggerSuggestionScan(selectedListId);
      setToast({ type: 'ok', text: 'Scan started' });
      // Wait a tick then start polling
      setTimeout(() => checkActiveScan(selectedListId), 500);
    } catch (err) {
      setToast({ type: 'err', text: err.message });
    }
  };

  // ---- Actions on suggestions ----
  const markBusy = (id, busy) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleAddToList = async (suggestion, targetListId) => {
    markBusy(suggestion.id, true);
    try {
      const targetId = targetListId || suggestion.list_id;
      const result = await api.addSuggestionToList(suggestion.id, targetId);
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setAddPickerForId(null);
      setToast({ type: 'ok', text: `Added @${suggestion.username} to ${result.list.name}` });
    } catch (err) {
      setToast({ type: 'err', text: err.message });
    } finally {
      markBusy(suggestion.id, false);
    }
  };

  const handleToggleHidden = async (suggestion) => {
    markBusy(suggestion.id, true);
    try {
      const updated = await api.setSuggestionHidden(suggestion.id, !suggestion.hidden);
      setSuggestions((prev) => prev.map((s) => (s.id === suggestion.id ? { ...s, ...updated } : s)));
    } catch (err) {
      setToast({ type: 'err', text: err.message });
    } finally {
      markBusy(suggestion.id, false);
    }
  };

  // ---- Derived ----
  const visible = useMemo(
    () => suggestions.filter((s) => !s.hidden),
    [suggestions]
  );
  const hiddenList = useMemo(
    () => suggestions.filter((s) => s.hidden),
    [suggestions]
  );

  // Auto-dismiss toast after 3.5s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const selectedList = lists.find((l) => l.id === selectedListId);
  const sourceCreatorCount = selectedList?.list_creators?.[0]?.count ?? 0;
  const scanProgress = job
    ? job.total_creators
      ? Math.round((job.creators_processed / job.total_creators) * 100)
      : 0
    : null;

  return (
    <div className="explore-page">
      <div className="dashboard-header">
        <div>
          <h1 className="page-title">
            <Compass size={22} style={{ marginRight: 8, verticalAlign: -3 }} />
            Explore Creators
          </h1>
          <p className="page-sub">
            Discover new creators based on who Instagram recommends to the people you already track
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="explore-controls card">
        <div className="explore-control-group">
          <label className="explore-control-label">Source list</label>
          <select
            value={selectedListId}
            onChange={(e) => setSelectedListId(e.target.value)}
            className="explore-list-select"
          >
            {lists.length === 0 && <option value="">No lists yet</option>}
            {lists.map((l) => {
              const count = l.list_creators?.[0]?.count ?? 0;
              return (
                <option key={l.id} value={l.id}>
                  {l.name} ({count} creator{count === 1 ? '' : 's'})
                </option>
              );
            })}
          </select>
        </div>

        <div className="explore-control-group">
          <label className="explore-control-label">&nbsp;</label>
          <button
            className="btn btn-primary"
            onClick={handleRunScan}
            disabled={!selectedListId || !!job || sourceCreatorCount === 0}
          >
            <Sparkles size={15} className={job ? 'spin' : ''} />
            {job ? 'Scanning…' : 'Run Scan'}
          </button>
        </div>
      </div>

      {/* Progress */}
      {job && (
        <div className="explore-progress">
          <div className="explore-progress-text">
            <RefreshCw size={14} className="spin" />
            <span>
              Scanning suggestions… {job.creators_processed} / {job.total_creators}
            </span>
          </div>
          <div className="explore-progress-bar">
            <div className="explore-progress-fill" style={{ width: `${scanProgress}%` }} />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`explore-toast ${toast.type === 'err' ? 'explore-toast-err' : 'explore-toast-ok'}`}>
          {toast.type === 'err' ? <AlertCircle size={14} /> : <Check size={14} />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Suggestions */}
      {loading ? (
        <div className="loading-screen" style={{ height: 200 }}><div className="spinner" /></div>
      ) : !selectedListId ? (
        <div className="empty-state">
          <Compass size={48} />
          <h3>Create a list first</h3>
          <p>Suggestions are built from the creators in one of your lists.</p>
        </div>
      ) : visible.length === 0 && hiddenList.length === 0 ? (
        <div className="empty-state">
          <Sparkles size={48} />
          <h3>No suggestions yet</h3>
          <p>Run a scan to fetch Instagram's recommended profiles for every creator in this list.</p>
          {sourceCreatorCount === 0 && (
            <p style={{ color: 'var(--red)', marginTop: 8 }}>
              This list has no creators — add some first.
            </p>
          )}
        </div>
      ) : (
        <>
          <SuggestionTable
            suggestions={visible}
            sourceListId={selectedListId}
            sourceListName={sourceList?.name || selectedList?.name || ''}
            allLists={lists}
            busyIds={busyIds}
            addPickerForId={addPickerForId}
            onTogglePicker={(id) => setAddPickerForId((cur) => (cur === id ? null : id))}
            onAddToList={handleAddToList}
            onToggleHidden={handleToggleHidden}
          />

          {hiddenList.length > 0 && (
            <div className="explore-hidden-section">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowHidden((v) => !v)}
              >
                {showHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                {showHidden ? 'Hide hidden profiles' : `Show ${hiddenList.length} hidden profile${hiddenList.length === 1 ? '' : 's'}`}
              </button>
              {showHidden && (
                <div style={{ marginTop: 16 }}>
                  <SuggestionTable
                    suggestions={hiddenList}
                    sourceListId={selectedListId}
                    sourceListName={sourceList?.name || selectedList?.name || ''}
                    allLists={lists}
                    busyIds={busyIds}
                    addPickerForId={addPickerForId}
                    onTogglePicker={(id) => setAddPickerForId((cur) => (cur === id ? null : id))}
                    onAddToList={handleAddToList}
                    onToggleHidden={handleToggleHidden}
                    isHiddenSection
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SuggestionTable({
  suggestions,
  sourceListId,
  sourceListName,
  allLists,
  busyIds,
  addPickerForId,
  onTogglePicker,
  onAddToList,
  onToggleHidden,
  isHiddenSection,
}) {
  if (suggestions.length === 0) return null;
  const otherLists = allLists.filter((l) => l.id !== sourceListId);

  return (
    <div className="suggestion-table">
      <div className="suggestion-table-header">
        <span>Profile</span>
        <span>Recommended</span>
        <span>Followers</span>
        <span>Actions</span>
      </div>
      {suggestions.map((s) => {
        const isBusy = busyIds.has(s.id);
        const showPicker = addPickerForId === s.id;
        return (
          <div key={s.id} className={`suggestion-row ${isHiddenSection ? 'suggestion-row-hidden' : ''}`}>
            <div className="suggestion-profile">
              <div className="suggestion-avatar">
                {s.profile_pic_url
                  ? <img src={s.profile_pic_url} alt={s.username} referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none'; }} />
                  : <span>{s.username[0].toUpperCase()}</span>
                }
              </div>
              <div className="suggestion-info">
                <div className="suggestion-username-row">
                  <a
                    href={`https://www.instagram.com/${s.username}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="suggestion-username"
                  >
                    @{s.username}
                  </a>
                  {s.is_verified && <BadgeCheck size={13} className="suggestion-verified" />}
                  {s.is_private && <Lock size={11} className="suggestion-private" />}
                  {s.new_in_last_run && !isHiddenSection && (
                    <span className="suggestion-new-badge">NEW</span>
                  )}
                </div>
                {s.full_name && <div className="suggestion-fullname">{s.full_name}</div>}
              </div>
            </div>

            <div className="suggestion-cell">
              <span className="suggestion-count">{s.recommendation_count}×</span>
              <span className="suggestion-count-sub">recommended</span>
            </div>

            <div className="suggestion-cell">
              {s.follower_count != null
                ? Number(s.follower_count).toLocaleString()
                : <span className="text-muted">—</span>}
            </div>

            <div className="suggestion-actions">
              {!isHiddenSection && (
                <div className="suggestion-add-wrap">
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={isBusy}
                    onClick={() => onAddToList(s, sourceListId)}
                    title={`Add to ${sourceListName}`}
                  >
                    <Plus size={13} /> Add to {sourceListName}
                  </button>
                  {otherLists.length > 0 && (
                    <button
                      className="btn btn-ghost btn-sm suggestion-add-chevron"
                      disabled={isBusy}
                      onClick={() => onTogglePicker(s.id)}
                      title="Add to a different list"
                      aria-label="Pick another list"
                    >
                      ▾
                    </button>
                  )}
                  {showPicker && otherLists.length > 0 && (
                    <div className="suggestion-picker" onMouseLeave={() => onTogglePicker(s.id)}>
                      <div className="suggestion-picker-label">Add to…</div>
                      {otherLists.map((l) => (
                        <button
                          key={l.id}
                          className="suggestion-picker-item"
                          onClick={() => onAddToList(s, l.id)}
                        >
                          <span className="suggestion-picker-dot" style={{ background: l.color }} />
                          {l.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                className="btn btn-ghost btn-sm icon-btn"
                disabled={isBusy}
                onClick={() => onToggleHidden(s)}
                title={s.hidden ? 'Unhide' : 'Hide this suggestion'}
              >
                {s.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
