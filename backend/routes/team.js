// ============================================================
// /api/team — admin manages team members
// ============================================================
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { requireAdmin, requireAuth } = require('../middleware/auth');

// ============================================================
// LIST MEMBERS (any authenticated user can see who's on the team)
// ============================================================
router.get('/members', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('team_members')
    .select('id, email, display_name, role, is_active, invited_at, joined_at')
    .order('role', { ascending: true })   // admins first
    .order('display_name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ members: data || [] });
});

// ============================================================
// LIST PENDING INVITES (admin only)
// ============================================================
router.get('/invites', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('team_invites')
    .select('id, email, display_name, role, token, expires_at, accepted_at, created_at')
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ invites: data || [] });
});

// ============================================================
// CREATE INVITE (admin only) → returns the token, admin shares link
// ============================================================
router.post('/invites', requireAdmin, async (req, res) => {
  const { email, display_name, role = 'member' } = req.body || {};
  if (!email?.trim()) return res.status(400).json({ error: 'email is required' });
  if (!display_name?.trim()) return res.status(400).json({ error: 'display_name is required' });
  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or member' });
  }

  const emailLower = email.trim().toLowerCase();

  // Already a team member?
  const { data: existing } = await supabase
    .from('team_members')
    .select('id, is_active')
    .eq('email', emailLower)
    .maybeSingle();
  if (existing && existing.is_active) {
    return res.status(409).json({ error: 'This email is already an active team member' });
  }

  // Already has a pending invite that hasn't expired?
  const { data: existingInvite } = await supabase
    .from('team_invites')
    .select('id, token')
    .eq('email', emailLower)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (existingInvite) {
    return res.json({
      reused_existing: true,
      token: existingInvite.token,
      message: 'A pending invite already exists for this email. Sharing the same link.',
    });
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('team_invites')
    .insert({
      email: emailLower,
      display_name: display_name.trim(),
      role,
      token,
      expires_at,
      created_by: req.user.id,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

// ============================================================
// REVOKE INVITE (admin)
// ============================================================
router.delete('/invites/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('team_invites').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ============================================================
// CHANGE MEMBER ROLE (admin)
// ============================================================
router.patch('/members/:id', requireAdmin, async (req, res) => {
  const allowed = {};
  if ('role' in req.body) {
    if (!['admin', 'member'].includes(req.body.role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    allowed.role = req.body.role;
  }
  if ('display_name' in req.body) {
    if (typeof req.body.display_name !== 'string' || !req.body.display_name.trim()) {
      return res.status(400).json({ error: 'display_name must be a non-empty string' });
    }
    allowed.display_name = req.body.display_name.trim();
  }
  if ('is_active' in req.body) allowed.is_active = !!req.body.is_active;

  if (Object.keys(allowed).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  allowed.updated_at = new Date().toISOString();

  // Safety: don't let the only admin demote themselves
  if (allowed.role === 'member' || allowed.is_active === false) {
    const { data: target } = await supabase
      .from('team_members').select('role, is_active').eq('id', req.params.id).single();
    if (target?.role === 'admin') {
      const { count } = await supabase
        .from('team_members')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('is_active', true);
      if ((count || 0) <= 1) {
        return res.status(400).json({
          error: 'Cannot demote or deactivate the last active admin. Promote someone else first.',
        });
      }
    }
  }

  const { data, error } = await supabase
    .from('team_members')
    .update(allowed)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ============================================================
// DEACTIVATE / DELETE MEMBER (admin)
// ============================================================
// We don't actually delete — we set is_active=false so audit logs etc.
// keep working. To fully delete, use Supabase Auth admin dashboard.
router.delete('/members/:id', requireAdmin, async (req, res) => {
  // Same single-admin safety check
  const { data: target } = await supabase
    .from('team_members').select('role').eq('id', req.params.id).single();
  if (target?.role === 'admin') {
    const { count } = await supabase
      .from('team_members')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('is_active', true);
    if ((count || 0) <= 1) {
      return res.status(400).json({
        error: 'Cannot deactivate the last active admin.',
      });
    }
  }

  const { data, error } = await supabase
    .from('team_members')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ============================================================
// CURRENT USER ME (any signed-in user)
// Convenience endpoint — frontend reads this to know who it's logged in as.
// ============================================================
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    role: req.user.role,
    display_name: req.user.display_name,
    team_member_id: req.user.team_member_id,
  });
});

module.exports = router;
