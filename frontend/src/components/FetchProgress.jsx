import { useEffect, useState, useRef } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import './FetchProgress.css';

const POLL_INTERVAL_MS = 1500;

export default function FetchProgress() {
  const [job, setJob] = useState(null); // currently running job (null when idle)
  const [justCompleted, setJustCompleted] = useState(null); // briefly show "Done!" when a job finishes
  const lastJobIdRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = null;

    const poll = async () => {
      try {
        const active = await api.getActiveFetch();
        if (cancelled) return;

        if (active) {
          // A job is running
          setJob(active);
          lastJobIdRef.current = active.id;
        } else {
          // No active job. Did one JUST finish? Show "Done!" briefly.
          if (job && lastJobIdRef.current) {
            setJustCompleted({ total: job.total_creators });
            setJob(null);
            setTimeout(() => setJustCompleted(null), 3500);
            lastJobIdRef.current = null;
          } else {
            setJob(null);
          }
        }
      } catch (err) {
        // Silently ignore — backend might be redeploying, etc.
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  // Briefly show a success toast after a job finishes
  if (justCompleted) {
    return (
      <div className="fetch-progress fetch-progress-done">
        <CheckCircle2 size={18} />
        <span>Fetch complete{justCompleted.total ? ` — ${justCompleted.total} creator${justCompleted.total === 1 ? '' : 's'} processed` : ''}</span>
      </div>
    );
  }

  if (!job) return null;

  const total = job.total_creators ?? 0;
  const done = job.creators_processed ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="fetch-progress">
      <Loader2 size={18} className="fetch-progress-spin" />
      <div className="fetch-progress-content">
        <div className="fetch-progress-text">
          <span>Fetching reels…</span>
          <span className="fetch-progress-count">{done} / {total || '?'}</span>
        </div>
        <div className="fetch-progress-bar">
          <div className="fetch-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
