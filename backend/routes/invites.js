// ============================================================
// /api/invites — public invite-acceptance flow
// ============================================================
// 1. GET  /api/invites/:token        → check if token is valid + return display_name/email/role
// 2. POST /api/invites/:token/accept → body { password } → creates Supabase Auth user,
//                                       links team_members.user_id, marks accepted.
// No auth required on either — the token IS the auth.
// ============================================================

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// ============================================================
// CHECK TOKEN
// ============================================================
router.get('/:token', async (req, res) => {
  const token = req.params.token;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const { data: invite, error } = await supabase
    .from('team_invites')
    .select('id, email, display_name, role, expires_at, accepted_at')
    .eq('token', token)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!invite) return res.status(404).json({ error: 'Invalid invite link' });
  if (invite.accepted_at) {
    return res.status(409).json({ error: 'This invite has already been accepted. Sign in normally.' });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: 'This invite has expired. Ask the admin for a fresh link.' });
  }

  res.json({
    email: invite.email,
    display_name: invite.display_name,
    role: invite.role,
    expires_at: invite.expires_at,
  });
});

// ============================================================
// ACCEPT — body { password }
// ============================================================
router.post('/:token/accept', async (req, res) => {
  const token = req.params.token;
  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  // Re-fetch + validate the invite
  const { data: invite, error: inviteErr } = await supabase
    .from('team_invites')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (inviteErr) return res.status(500).json({ error: inviteErr.message });
  if (!invite) return res.status(404).json({ error: 'Invalid invite link' });
  if (invite.accepted_at) {
    return res.status(409).json({ error: 'This invite has already been accepted. Sign in normally.' });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: 'This invite has expired. Ask the admin for a fresh link.' });
  }

  // Check if an auth user already exists for this email (e.g. admin reused
  // their personal Supabase project for testing). If so, we link to that
  // existing auth user rather than creating a duplicate.
  let authUser = null;
  try {
    const { data: existing } = await supabase.auth.admin.listUsers();
    authUser = existing?.users?.find?.(
      (u) => (u.email || '').toLowerCase() === invite.email.toLowerCase()
    ) || null;
  } catch (err) {
    // Service-role key needed for admin.listUsers. If our key isn't service-role,
    // skip the dedup check and just try to create — Supabase will error if dup.
    console.warn('[invites] could not list users for dedup check:', err.message);
  }

  if (!authUser) {
    // Create the Supabase Auth user. Mark email as confirmed (skip the verify-email flow).
    const { data, error } = await supabase.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: invite.display_name, invited_via_team: true },
    });
    if (error) return res.status(500).json({ error: `Could not create account: ${error.message}` });
    authUser = data.user;
  } else {
    // User exists already — update their password to whatever they typed.
    const { error } = await supabase.auth.admin.updateUserById(authUser.id, { password });
    if (error) return res.status(500).json({ error: `Could not set password: ${error.message}` });
  }

  if (!authUser) return res.status(500).json({ error: 'Auth user creation failed silently' });

  // Upsert into team_members linked to this auth user
  const { data: existingMember } = await supabase
    .from('team_members')
    .select('id')
    .eq('email', invite.email)
    .maybeSingle();

  let teamMember;
  if (existingMember) {
    const { data, error } = await supabase
      .from('team_members')
      .update({
        user_id: authUser.id,
        display_name: invite.display_name,
        role: invite.role,
        is_active: true,
        joined_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingMember.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    teamMember = data;
  } else {
    const { data, error } = await supabase
      .from('team_members')
      .insert({
        user_id: authUser.id,
        email: invite.email,
        display_name: invite.display_name,
        role: invite.role,
        is_active: true,
        joined_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    teamMember = data;
  }

  // Mark invite accepted
  await supabase
    .from('team_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  res.json({
    success: true,
    email: invite.email,
    display_name: invite.display_name,
    role: invite.role,
  });
});

module.exports = router;
