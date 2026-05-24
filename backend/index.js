require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');

const listsRouter = require('./routes/lists');
const creatorsRouter = require('./routes/creators');
const reelsRouter = require('./routes/reels');
const fetchRouter = require('./routes/fetch');
const todosRouter = require('./routes/todos');
const myAccountsRouter = require('./routes/myAccounts');
const talentsRouter = require('./routes/talents');
const converterRouter = require('./routes/converter');
const settingsRouter = require('./routes/settings');
const dailyTasksRouter = require('./routes/dailyTasks');
const guidesRouter = require('./routes/guides');
const lessonsRouter = require('./routes/lessons');
const imageCleanerRouter = require('./routes/imageCleaner');
const higgsfieldRouter = require('./routes/higgsfield');
const studioRouter = require('./routes/studio');
const guidesV2Router = require('./routes/guidesV2');
const teamRouter = require('./routes/team');
const invitesRouter = require('./routes/invites');
const activityLogRouter = require('./routes/activityLog');
const guideCompletionsRouter = require('./routes/guideCompletions');
const { requireAuth } = require('./middleware/auth');
const { requireAdminForWrites } = require('./middleware/requireAdminForWrites');
const { autoLogMiddleware } = require('./middleware/autoLogMiddleware');
const { runMyAccountsFetch } = require('./services/myAccountsService');
const { generateDailyTasks, cleanupOldDailyTasks } = require('./services/dailyTasksService');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// ============================================================
// Middleware
// ============================================================
const allowedOrigins = (process.env.FRONTEND_URL || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '15mb' }));

// ============================================================
// PUBLIC ROUTES (no auth required) — mount BEFORE the auth gate
// ============================================================
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));
app.use('/api/invites', invitesRouter);

// ============================================================
// RATE LIMIT
// ============================================================
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: (req) => req.path === '/api/fetch/active',
}));

// ============================================================
// AUTH GATE — every /api/* request below this must be authenticated
// EXCEPT the public to-do share endpoints
// ============================================================
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/todos/public/')) return next();
  return requireAuth(req, res, next);
});

// ============================================================
// AUTO-LOG MIDDLEWARE — must come AFTER auth (needs req.user) and
// BEFORE the routes (so it can register the res.on('finish') hook).
// Any route that calls log() explicitly will mark req[LOGGED_SYMBOL]
// and the auto-logger will skip it for that request.
// ============================================================
app.use(autoLogMiddleware);

// ============================================================
// ADMIN-ONLY WRITES on guides surfaces
// (members can READ guides + mark complete via /api/guide-completions,
//  but cannot create/edit/delete guides, articles, videos, or categories)
// ============================================================
app.use('/api/guides', requireAdminForWrites);
app.use('/api/lessons', requireAdminForWrites);
app.use('/api/guides-v2', requireAdminForWrites);

// ============================================================
// AUTHENTICATED ROUTES
// ============================================================
app.use('/api/lists', listsRouter);
app.use('/api/creators', creatorsRouter);
app.use('/api/reels', reelsRouter);
app.use('/api/fetch', fetchRouter);
app.use('/api/todos', todosRouter);
app.use('/api/my-accounts', myAccountsRouter);
app.use('/api/talents', talentsRouter);
app.use('/api/converter', converterRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/daily-tasks', dailyTasksRouter);
app.use('/api/guides', guidesRouter);
app.use('/api/lessons', lessonsRouter);
app.use('/api/image-cleaner', imageCleanerRouter);
app.use('/api/higgsfield', higgsfieldRouter);
app.use('/api/studio', studioRouter);
app.use('/api/guides-v2', guidesV2Router);
app.use('/api/team', teamRouter);
app.use('/api/activity-log', activityLogRouter);
app.use('/api/guide-completions', guideCompletionsRouter);

// ============================================================
// CRONS (unchanged + new log retention cleanup)
// ============================================================
cron.schedule('0 5 * * *', async () => {
  console.log('[CRON] Starting my-accounts daily snapshot...');
  try {
    const r = await runMyAccountsFetch();
    console.log(`[CRON] My-accounts snapshot complete: ${r.fetched} account(s).`);
  } catch (err) {
    console.error('[CRON] My-accounts snapshot failed:', err.message);
  }
});

cron.schedule('1 0 * * *', async () => {
  console.log('[CRON] Generating daily tasks for today (Europe/Rome)...');
  try {
    const r = await generateDailyTasks();
    console.log(`[CRON] Daily tasks generated:`, r);
    await cleanupOldDailyTasks();
  } catch (err) {
    console.error('[CRON] Daily tasks generation failed:', err.message);
  }

  // While we're at it, prune activity_log older than 90 days
  try {
    const supabase = require('./lib/supabase');
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('activity_log').delete().lt('created_at', cutoff);
    if (error) console.warn('[CRON] activity_log prune failed:', error.message);
    else console.log(`[CRON] Pruned activity_log entries older than ${cutoff}`);
  } catch (err) {
    console.warn('[CRON] activity_log prune error:', err.message);
  }
}, {
  timezone: 'Europe/Rome',
});

app.listen(PORT, () => {
  console.log(`✅ Reels Tracker API running on port ${PORT}`);
});
