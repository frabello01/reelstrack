// ============================================================
// AUTH MIDDLEWARE — verifies the Supabase JWT on every request
// ============================================================
// Reads `Authorization: Bearer <jwt>` from the request, asks Supabase
// to verify it, then looks up the team_members row to attach the
// effective role + display name to req.user.
//
// Three helpers exported:
//   - requireAuth      — any signed-in active member
//   - requireAdmin     — admin role only
//   - softAuth         — attaches req.user if present, but never blocks
//                        (used for endpoints that work for both anon and
//                        signed-in users; we don't have any yet but it's
//                        cheap to provide)
// ============================================================

const supabase = require('../lib/supabase');

async function loadUserFromHeader(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  // Ask Supabase to verify the JWT and tell us who it belongs to.
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  // Look up the team_members row for role + display_name.
  // If the user has an auth.users row but no team_members row, treat them
  // as a NON-member (refuse access). This prevents random people who
  // somehow got an auth session from using the API.
  const { data: member } = await supabase
    .from('team_members')
    .select('id, role, display_name, is_active, email')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member || !member.is_active) return null;

  return {
    id: user.id,
    email: member.email || user.email,
    role: member.role,
    display_name: member.display_name,
    team_member_id: member.id,
  };
}

async function requireAuth(req, res, next) {
  try {
    const u = await loadUserFromHeader(req);
    if (!u) return res.status(401).json({ error: 'Not signed in' });
    req.user = u;
    next();
  } catch (err) {
    console.error('[auth] requireAuth error:', err.message);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const u = await loadUserFromHeader(req);
    if (!u) return res.status(401).json({ error: 'Not signed in' });
    if (u.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    req.user = u;
    next();
  } catch (err) {
    console.error('[auth] requireAdmin error:', err.message);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

async function softAuth(req, res, next) {
  try {
    req.user = await loadUserFromHeader(req); // may be null
  } catch {
    req.user = null;
  }
  next();
}

module.exports = { requireAuth, requireAdmin, softAuth, loadUserFromHeader };
