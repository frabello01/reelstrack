// ============================================================
// activityLogger — single source of truth for writing log entries
// ============================================================
// Two modes:
//
//   1. EXPLICIT (preferred for high-value actions):
//        const { log } = require('../lib/activityLogger');
//        log(req, {
//          section: 'todos',
//          action: 'create',
//          target_type: 'reel',
//          target_id: reel.id,
//          target_name: `Beach selfie → ${todo.name}`,
//          metadata: { todo_id: todo.id },
//        });
//      Marks the request so the auto-middleware skips it.
//
//   2. AUTO (fallback, in the express middleware):
//        See ./autoLogMiddleware.js
//
// Fire-and-forget: never throws, errors are console.error()'d only.
// The actual request must not be blocked by logging failures.
// ============================================================

const supabase = require('./supabase');

// Sentinel on req — middleware checks this to avoid double-logging.
const LOGGED_SYMBOL = Symbol.for('activityLogger.explicit');

async function log(req, fields = {}) {
  // Mark so the auto-middleware skips this request.
  if (req) req[LOGGED_SYMBOL] = true;

  const user = req?.user || {};
  const row = {
    user_id: user.id || null,
    user_name: user.display_name || user.email || null,
    section: fields.section || 'unknown',
    action: fields.action || 'unknown',
    target_type: fields.target_type || null,
    target_id: fields.target_id || null,
    target_name: fields.target_name || null,
    method: fields.method || req?.method || null,
    path: fields.path || req?.originalUrl || req?.url || null,
    status_code: fields.status_code || null,
    metadata: fields.metadata || null,
  };

  try {
    const { error } = await supabase.from('activity_log').insert(row);
    if (error) {
      console.warn('[activity-log] insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[activity-log] write error:', err.message);
  }
}

// Helper to mark a request as "don't auto-log" without writing a row.
// Useful for endpoints we want to silence entirely (e.g. /api/team/me).
function suppress(req) {
  if (req) req[LOGGED_SYMBOL] = true;
}

module.exports = { log, suppress, LOGGED_SYMBOL };
