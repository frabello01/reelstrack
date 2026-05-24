// ============================================================
// autoLogMiddleware — catches state-changing requests and writes
// a generic log entry IF no explicit log() was called earlier.
// ============================================================
//
// Triggered for: POST, PATCH, PUT, DELETE
// Skipped for: GET, HEAD, OPTIONS (reads don't need logging)
// Skipped for: paths matching SKIP_PATTERNS below
// Skipped if: req[LOGGED_SYMBOL] is true (an explicit log() handled it)
// Skipped if: response status is not 2xx (don't log failures as actions)
//
// The middleware hooks into res.on('finish') so we know the final
// status code AND that the actual mutation succeeded.
//
// SECTION inference:
//   /api/todos/...        -> todos
//   /api/lists/...        -> creator-lists
//   /api/my-creators...   -> my-creators  (URL is /api/talents though)
//   /api/talents/...      -> my-creators
//   /api/reels/...        -> reels
//   /api/fetch/...        -> creator-lists
//   /api/daily-tasks/...  -> daily-tasks
//   /api/guides...        -> guides (covers guides, lessons, guides-v2)
//   /api/lessons/...      -> guides
//   /api/guides-v2/...    -> guides
//   /api/studio/...       -> studio
//   /api/higgsfield/...   -> characters
//   /api/team/...         -> team
//   /api/settings/...     -> settings
//   /api/my-accounts/...  -> my-accounts
//   /api/image-cleaner... -> tools
//   /api/converter/...    -> tools
//   /api/batch-cleaner... -> tools
// ============================================================

const supabase = require('../lib/supabase');
const { LOGGED_SYMBOL } = require('../lib/activityLogger');

// Patterns that should NEVER be auto-logged (too noisy or sensitive)
const SKIP_PATTERNS = [
  /^\/api\/fetch\/active/,           // polled constantly
  /^\/api\/fetch\/jobs/,             // polled constantly
  /^\/api\/team\/me/,                // every page load
  /^\/api\/health/,
  /^\/api\/invites\//,               // public unauth flow
  /^\/api\/todos\/public\//,         // public share links
  /^\/api\/settings\/public/,        // public branding
];

function inferSection(path) {
  if (path.startsWith('/api/lists') || path.startsWith('/api/creators') || path.startsWith('/api/fetch')) {
    return 'creator-lists';
  }
  if (path.startsWith('/api/todos')) return 'todos';
  if (path.startsWith('/api/reels')) return 'reels';
  if (path.startsWith('/api/talents') || path.startsWith('/api/my-creators')) return 'my-creators';
  if (path.startsWith('/api/my-accounts')) return 'my-accounts';
  if (path.startsWith('/api/daily-tasks')) return 'daily-tasks';
  if (path.startsWith('/api/guides-v2')) return 'guides';
  if (path.startsWith('/api/guides')) return 'guides';
  if (path.startsWith('/api/lessons')) return 'guides';
  if (path.startsWith('/api/studio')) return 'studio';
  if (path.startsWith('/api/higgsfield')) return 'characters';
  if (path.startsWith('/api/team')) return 'team';
  if (path.startsWith('/api/settings')) return 'settings';
  if (path.startsWith('/api/image-cleaner') || path.startsWith('/api/batch-cleaner') ||
      path.startsWith('/api/converter')) return 'tools';
  return 'other';
}

// Infer a human-readable action from method + path
function inferAction(method, path) {
  if (method === 'POST') {
    if (/\/reels\/[^/]+\/move\b/.test(path)) return 'move';
    if (/\/reels\/[^/]+\/copy\b/.test(path)) return 'copy';
    if (/\/reels\/upload\/init\b/.test(path)) return 'upload-init';
    if (/\/reels\/upload\/finalize\b/.test(path)) return 'upload-finalize';
    if (/\/clean\b/.test(path)) return 'clean';
    if (/\/generate\b/.test(path)) return 'generate';
    if (/\/run\b/.test(path)) return 'trigger-fetch';
    if (/\/fetch\b/.test(path)) return 'trigger-fetch';
    if (/\/reorder\b/.test(path)) return 'reorder';
    if (/\/pin\b/.test(path)) return 'pin';
    if (/\/mark-seen\b/.test(path)) return 'mark-seen';
    if (/\/invites\b/.test(path) && method === 'POST') return 'invite';
    return 'create';
  }
  if (method === 'PATCH' || method === 'PUT') return 'update';
  if (method === 'DELETE') return 'delete';
  return method.toLowerCase();
}

function shouldSkip(path) {
  return SKIP_PATTERNS.some((re) => re.test(path));
}

function autoLogMiddleware(req, res, next) {
  const method = req.method.toUpperCase();

  // Only log state-changing methods
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    return next();
  }

  // Skip noisy/public endpoints
  const path = req.originalUrl || req.url;
  if (shouldSkip(path)) {
    return next();
  }

  res.on('finish', async () => {
    try {
      // Skip if explicit log() already handled this request
      if (req[LOGGED_SYMBOL]) return;
      // Skip if no user (unauth requests shouldn't end up here in P1+P2 but be safe)
      if (!req.user) return;
      // Skip if the mutation failed
      if (res.statusCode < 200 || res.statusCode >= 300) return;

      const section = inferSection(path);
      const action = inferAction(method, path);

      await supabase.from('activity_log').insert({
        user_id: req.user.id,
        user_name: req.user.display_name || req.user.email,
        section,
        action,
        method,
        path,
        status_code: res.statusCode,
      });
    } catch (err) {
      console.warn('[auto-log] error:', err.message);
    }
  });

  next();
}

module.exports = { autoLogMiddleware };
