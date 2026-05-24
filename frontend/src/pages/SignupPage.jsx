import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle2, UserPlus, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import './SignupPage.css';

export default function SignupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const token = searchParams.get('token') || '';
  const [stage, setStage] = useState('loading');  // loading | invalid | ready | submitting | done
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (!token) {
      setStage('invalid');
      setError('No invite token in this link.');
      return;
    }
    (async () => {
      try {
        const data = await api.checkInvite(token);
        setInvite(data);
        setStage('ready');
      } catch (err) {
        setError(err.message);
        setStage('invalid');
      }
    })();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords don\'t match');

    setStage('submitting');
    try {
      await api.acceptInvite(token, password);
      // Now sign in with the new credentials
      const { error: signInErr } = await signIn(invite.email, password);
      if (signInErr) throw new Error(signInErr.message);
      setStage('done');
      // Brief pause so user sees the success state, then redirect
      setTimeout(() => navigate('/'), 1200);
    } catch (err) {
      setError(err.message);
      setStage('ready');
    }
  };

  return (
    <div className="signup-page">
      <div className="signup-card">
        <div className="signup-logo">
          <img src="/logo.png" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
        </div>

        {stage === 'loading' && (
          <div className="signup-loading">
            <Loader2 size={24} className="spin" />
            <p>Checking invite…</p>
          </div>
        )}

        {stage === 'invalid' && (
          <div className="signup-error-state">
            <AlertCircle size={32} />
            <h2>Can't accept this invite</h2>
            <p>{error}</p>
            <p className="signup-hint">
              Ask the team admin for a fresh invite link.
            </p>
          </div>
        )}

        {(stage === 'ready' || stage === 'submitting') && invite && (
          <>
            <div className="signup-greeting">
              <UserPlus size={20} />
              <h1>Welcome, {invite.display_name}!</h1>
              <p>You've been invited as a <strong>{invite.role}</strong>. Choose a password to finish signing up.</p>
              <p className="signup-email">{invite.email}</p>
            </div>

            <form onSubmit={handleSubmit} className="signup-form">
              <div className="signup-field">
                <label><Lock size={12} /> Password (at least 8 characters)</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoFocus
                  autoComplete="new-password"
                  disabled={stage === 'submitting'}
                />
              </div>
              <div className="signup-field">
                <label><Lock size={12} /> Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={stage === 'submitting'}
                />
              </div>

              {error && <div className="signup-error"><AlertCircle size={13} /> {error}</div>}

              <button
                type="submit"
                className="btn btn-primary signup-submit"
                disabled={stage === 'submitting' || !password || !confirm}
              >
                {stage === 'submitting'
                  ? <><Loader2 size={14} className="spin" /> Creating account…</>
                  : 'Create account & sign in'}
              </button>
            </form>
          </>
        )}

        {stage === 'done' && (
          <div className="signup-success">
            <CheckCircle2 size={32} />
            <h2>You're in!</h2>
            <p>Taking you to the app…</p>
          </div>
        )}
      </div>
    </div>
  );
}
