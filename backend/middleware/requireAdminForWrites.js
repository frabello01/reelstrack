// ============================================================
// requireAdminForWrites — middleware that allows GETs from any
// signed-in user but blocks POST/PATCH/PUT/DELETE for non-admins.
//
// Used on /api/guides, /api/lessons, /api/guides-v2 in phase 2 so
// members can READ guides but only admins can edit/create/delete.
//
// The single exception is "marking complete" which uses a separate
// route entirely (/api/guide-completions/*) and is open to members.
// ============================================================

function requireAdminForWrites(req, res, next) {
  const method = req.method.toUpperCase();
  // Reads are open
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  // Writes require admin
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Only admins can edit guides. Ask the team admin if you need access.',
    });
  }
  next();
}

module.exports = { requireAdminForWrites };
