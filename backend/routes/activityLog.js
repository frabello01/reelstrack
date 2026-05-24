// ============================================================
// /api/activity-log — admin-only read API
// ============================================================
//
// Endpoints:
//   GET /api/activity-log
//     Query params:
//       limit      (default 100, max 500)
//       before     (ISO timestamp — pagination cursor for older entries)
//       user_id    (filter to one user)
//       section    (filter to one section: 'todos', 'guides', 'studio', etc.)
//       q          (free-text search across action / target_name / path)
//
//   GET /api/activity-log/sections
//     Returns the list of distinct sections seen in the log so the UI
//     can populate the section filter dropdown.
//
//   GET /api/activity-log/users
//     Returns distinct (user_id, user_name) tuples for the user filter.
// ============================================================

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAdmin } = require('../middleware/auth');
const { suppress } = require('../lib/activityLogger');

router.use(requireAdmin);

router.get('/', async (req, res) => {
  suppress(req);
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 100));
  let q = supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (req.query.before) q = q.lt('created_at', req.query.before);
  if (req.query.user_id) q = q.eq('user_id', req.query.user_id);
  if (req.query.section) q = q.eq('section', req.query.section);
  if (req.query.q) {
    const term = String(req.query.q).trim();
    if (term) {
      const escaped = term.replace(/[%_]/g, '\\$&');
      q = q.or(
        `action.ilike.%${escaped}%,target_name.ilike.%${escaped}%,path.ilike.%${escaped}%`
      );
    }
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entries: data || [], count: data?.length || 0 });
});

router.get('/sections', async (req, res) => {
  suppress(req);
  const { data, error } = await supabase
    .from('activity_log')
    .select('section')
    .limit(5000);
  if (error) return res.status(500).json({ error: error.message });
  const distinct = Array.from(new Set((data || []).map((r) => r.section))).sort();
  res.json({ sections: distinct });
});

router.get('/users', async (req, res) => {
  suppress(req);
  // We pull from team_members directly (not from log) so deactivated members
  // also show up — admin might be looking for what someone did before being
  // deactivated.
  const { data, error } = await supabase
    .from('team_members')
    .select('id, user_id, display_name, email, role, is_active')
    .order('display_name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data || [] });
});

module.exports = router;
