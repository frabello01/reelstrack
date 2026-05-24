import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, UserPlus, Crown, User, Mail, Copy, Trash2, Loader2, AlertCircle,
  CheckCircle2, X, Power, ShieldCheck, Shield,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import './TeamPage.css';

export default function TeamPage() {
  const { isAdmin, profile } = useAuth();
  const navigate = useNavigate();

  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);

  useEffect(() => {
    // Only admins reach this page; non-admins get redirected by the route guard
    if (!isAdmin) {
      navigate('/');
      return;
    }
    load();
  }, [isAdmin, navigate]);

  const load = async () => {
    setLoading(true);
    try {
      const [m, i] = await Promise.all([api.getTeamMembers(), api.getTeamInvites()]);
      setMembers(m.members || []);
      setInvites(i.invites || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeRole = async (member, newRole) => {
    if (!confirm(`Change ${member.display_name} to ${newRole}?`)) return;
    try {
      await api.updateTeamMember(member.id, { role: newRole });
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  };

  const handleDeactivate = async (member) => {
    if (member.id === profile?.team_member_id) {
      return alert("You can't deactivate yourself.");
    }
    if (!confirm(`Deactivate ${member.display_name}? They will be signed out and can't access the app anymore.`)) return;
    try {
      await api.deactivateTeamMember(member.id);
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  };

  const handleReactivate = async (member) => {
    try {
      await api.updateTeamMember(member.id, { is_active: true });
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  };

  const handleRevokeInvite = async (invite) => {
    if (!confirm(`Revoke invite for ${invite.email}?`)) return;
    try {
      await api.revokeTeamInvite(invite.id);
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="team-page">
      <header className="team-header">
        <div>
          <h1><Users size={22} /> Team</h1>
          <p className="team-subtitle">
            Invite team members and manage their access. Everyone shares the same data
            (creator lists, to-dos, guides, etc.) — members can view & complete things
            but only admins can edit.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowInviteModal(true)}>
          <UserPlus size={14} /> Invite member
        </button>
      </header>

      {error && (
        <div className="team-error"><AlertCircle size={14} /> {error}</div>
      )}

      {loading ? (
        <div className="team-loading"><Loader2 size={20} className="spin" /></div>
      ) : (
        <>
          {/* Active members */}
          <section className="team-section">
            <h2><ShieldCheck size={16} /> Members ({members.filter((m) => m.is_active).length})</h2>
            <div className="team-list">
              {members.filter((m) => m.is_active).map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isSelf={m.id === profile?.team_member_id}
                  onRoleChange={handleChangeRole}
                  onDeactivate={handleDeactivate}
                />
              ))}
            </div>
          </section>

          {/* Pending invites */}
          {invites.length > 0 && (
            <section className="team-section">
              <h2><Mail size={16} /> Pending invites ({invites.length})</h2>
              <div className="team-list">
                {invites.map((inv) => (
                  <InviteRow key={inv.id} invite={inv} onRevoke={handleRevokeInvite} />
                ))}
              </div>
            </section>
          )}

          {/* Deactivated members */}
          {members.some((m) => !m.is_active) && (
            <section className="team-section">
              <h2><Shield size={16} /> Deactivated</h2>
              <div className="team-list">
                {members.filter((m) => !m.is_active).map((m) => (
                  <DeactivatedRow key={m.id} member={m} onReactivate={handleReactivate} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {showInviteModal && (
        <InviteModal
          onClose={() => setShowInviteModal(false)}
          onCreated={() => { setShowInviteModal(false); load(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// MEMBER ROW
// ============================================================
function MemberRow({ member, isSelf, onRoleChange, onDeactivate }) {
  const isAdminMember = member.role === 'admin';
  return (
    <div className="team-row">
      <div className="team-row-avatar" style={isAdminMember ? { background: 'rgba(252,211,77,0.15)' } : undefined}>
        {member.display_name.slice(0, 1).toUpperCase()}
      </div>
      <div className="team-row-body">
        <div className="team-row-name">
          {member.display_name}
          {isSelf && <span className="team-self-badge">you</span>}
          {isAdminMember && <span className="team-admin-badge"><Crown size={10} /> Admin</span>}
        </div>
        <div className="team-row-email">{member.email}</div>
        <div className="team-row-meta">
          {member.joined_at
            ? `Joined ${new Date(member.joined_at).toLocaleDateString()}`
            : `Invited ${new Date(member.invited_at).toLocaleDateString()}`}
        </div>
      </div>
      <div className="team-row-actions">
        {!isSelf && (
          <>
            <select
              className="team-role-select"
              value={member.role}
              onChange={(e) => onRoleChange(member, e.target.value)}
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
            <button
              className="team-row-delete"
              onClick={() => onDeactivate(member)}
              title="Deactivate"
            >
              <Power size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// INVITE ROW
// ============================================================
function InviteRow({ invite, onRevoke }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/signup?token=${invite.token}`;
  const expiresIn = Math.max(0, Math.round((new Date(invite.expires_at) - Date.now()) / (1000 * 60 * 60 * 24)));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = link;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="team-row team-row-invite">
      <div className="team-row-avatar team-row-avatar-pending">
        <Mail size={16} />
      </div>
      <div className="team-row-body">
        <div className="team-row-name">{invite.display_name}</div>
        <div className="team-row-email">{invite.email}</div>
        <div className="team-row-meta">
          Role: <strong>{invite.role}</strong> · expires in {expiresIn} day{expiresIn === 1 ? '' : 's'}
        </div>
        <div className="team-invite-link">
          <code>{link}</code>
        </div>
      </div>
      <div className="team-row-actions">
        <button className="btn btn-secondary btn-sm" onClick={handleCopy}>
          {copied ? <><CheckCircle2 size={12} /> Copied</> : <><Copy size={12} /> Copy link</>}
        </button>
        <button className="team-row-delete" onClick={() => onRevoke(invite)} title="Revoke">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// DEACTIVATED ROW
// ============================================================
function DeactivatedRow({ member, onReactivate }) {
  return (
    <div className="team-row team-row-deactivated">
      <div className="team-row-avatar team-row-avatar-off">
        {member.display_name.slice(0, 1).toUpperCase()}
      </div>
      <div className="team-row-body">
        <div className="team-row-name">{member.display_name}</div>
        <div className="team-row-email">{member.email}</div>
        <div className="team-row-meta">Deactivated</div>
      </div>
      <div className="team-row-actions">
        <button className="btn btn-secondary btn-sm" onClick={() => onReactivate(member)}>
          Reactivate
        </button>
      </div>
    </div>
  );
}

// ============================================================
// INVITE MODAL
// ============================================================
function InviteModal({ onClose, onCreated }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdInvite, setCreatedInvite] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!displayName.trim() || !email.trim()) {
      return setError('Both name and email are required');
    }
    setCreating(true);
    try {
      const r = await api.createTeamInvite({
        email: email.trim(),
        display_name: displayName.trim(),
        role,
      });
      setCreatedInvite(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const link = createdInvite
    ? `${window.location.origin}/signup?token=${createdInvite.token}`
    : '';

  const handleCopyAndClose = async () => {
    try { await navigator.clipboard.writeText(link); } catch {}
    setCopied(true);
    setTimeout(() => { onCreated(); }, 800);
  };

  return (
    <div className="team-modal-backdrop" onClick={onClose}>
      <div className="team-modal" onClick={(e) => e.stopPropagation()}>
        <div className="team-modal-header">
          <h3><UserPlus size={16} /> Invite team member</h3>
          <button className="team-modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        {!createdInvite ? (
          <form className="team-modal-body" onSubmit={handleSubmit}>
            <div className="team-field">
              <label>Their name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Sofia"
                autoFocus
                maxLength={100}
              />
            </div>
            <div className="team-field">
              <label>Their email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sofia@example.com"
              />
            </div>
            <div className="team-field">
              <label>Role</label>
              <div className="team-role-radio">
                <label className={role === 'member' ? 'active' : ''}>
                  <input type="radio" name="role" value="member" checked={role === 'member'} onChange={() => setRole('member')} />
                  <User size={13} />
                  <div>
                    <strong>Member</strong>
                    <p>View everything, complete guides & tasks, mark reels seen. Can't edit.</p>
                  </div>
                </label>
                <label className={role === 'admin' ? 'active' : ''}>
                  <input type="radio" name="role" value="admin" checked={role === 'admin'} onChange={() => setRole('admin')} />
                  <Crown size={13} />
                  <div>
                    <strong>Admin</strong>
                    <p>Full access. Can invite/remove members, edit anything.</p>
                  </div>
                </label>
              </div>
            </div>

            {error && <div className="team-error"><AlertCircle size={13} /> {error}</div>}

            <div className="team-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? <><Loader2 size={12} className="spin" /> Creating…</> : 'Create invite'}
              </button>
            </div>
          </form>
        ) : (
          <div className="team-modal-body">
            <div className="team-invite-success">
              <CheckCircle2 size={24} />
              <h4>Invite created</h4>
              <p>Send this link to <strong>{createdInvite.email || email}</strong>. It expires in 7 days.</p>
              <div className="team-invite-link-box">
                <code>{link}</code>
              </div>
              {createdInvite.reused_existing && (
                <p className="team-invite-note">
                  An existing pending invite for this email was reused — same link.
                </p>
              )}
            </div>
            <div className="team-modal-actions">
              <button className="btn btn-primary" onClick={handleCopyAndClose}>
                {copied ? <><CheckCircle2 size={12} /> Copied</> : <><Copy size={12} /> Copy link & close</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
