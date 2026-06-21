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
const suggestionsRouter = require('./routes/suggestions');
const landingsRouter = require('./routes/landings');
const inflowwRouter = require('./routes/infloww');
const videoStudioRouter = require('./routes/videoStudio');
const redirectsRouter = require('./routes/redirects');
const redirectorRouter = require('./routes/redirector');
const canaryRouter = require('./routes/canary');
const driveRouter = require('./routes/drive');
const uploadsRouter = require('./routes/uploads');
const smspoolRouter = require('./routes/smspool');
const { requireAuth } = require('./middleware/auth');
const { requireAdminForWrites } = require('./middleware/requireAdminForWrites');
const { autoLogMiddleware } = require('./middleware/autoLogMiddleware');
const { runMyAccountsFetch } = require('./services/myAccountsService');
const { generateDailyTasks, cleanupOldDailyTasks } = require('./services/dailyTasksService');
const { syncAllTalents: syncAllInflowwTalents } = require('./services/inflowwService');

const app = express();
// Trust the entire X-Forwarded-For chain. Render sits behind 2+ proxy hops
// (ingress + internal LB), so `1` only gave us the LB's private 10.x.x.x
// IP — req.ip needs to walk all the way back to the original client for
// geolocation on landing-page clicks to work.
app.set('trust proxy', true);
const PORT = process.env.PORT || 3001;

// ============================================================
// BOT-PROTECTION REDIRECTOR DOMAIN
//
// Hosts listed here are mapped to the redirector router. Any request
// arriving on these hostnames is handled BEFORE the regular API stack
// — no CORS, no auth gate, no rate-limit interference. The redirector
// does its own bot detection + JWT validation + 302/410 dispatch.
//
// To add a new sacrificial domain: just add the host here and point
// its DNS at this Render service. Nothing else changes.
// ============================================================
const REDIRECTOR_HOSTS = new Set([
  'parrocchiasanbasilio.com',
  'www.parrocchiasanbasilio.com',
]);

app.use((req, res, next) => {
  const host = (req.hostname || '').toLowerCase();
  if (REDIRECTOR_HOSTS.has(host)) {
    // The redirector handles /r/:slug — everything else from this host
    // gets a generic 404 (defined inside the router).
    return redirectorRouter(req, res, next);
  }
  return next();
});

// ============================================================
// Middleware
// ============================================================
const allowedOrigins = (process.env.FRONTEND_URL || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Strict CORS for the admin app — only origins in FRONTEND_URL allowed.
const strictCors = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
});

// Permissive CORS for public landing endpoints — any origin allowed.
// These routes are intentionally public (no auth) so any custom domain
// pointing at the SPA can fetch its landing data without us having to
// add it to FRONTEND_URL on Render.
const publicLandingsCors = cors({ origin: '*' });

app.use((req, res, next) => {
  if (req.path.startsWith('/api/landings/public/')) {
    return publicLandingsCors(req, res, next);
  }
  if (req.path.startsWith('/api/redirects/public/')) {
    return publicLandingsCors(req, res, next);
  }
  if (req.path.startsWith('/api/uploads/public/')) {
    return publicLandingsCors(req, res, next);
  }
  if (req.path === '/api/canary') {
    return publicLandingsCors(req, res, next);
  }
  return strictCors(req, res, next);
});
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
  if (req.path.startsWith('/landings/public/')) return next();
  if (req.path.startsWith('/redirects/public/')) return next();
  if (req.path.startsWith('/uploads/public/')) return next();
  // Public agency branding (logo, display_name) used on share pages — must
  // be readable without auth so the share link renders the agency logo.
  if (req.path === '/settings/public') return next();
  // Canary honeypot — fired by scrapers that follow hidden <a> tags. Must
  // be reachable without auth so the trap actually springs.
  if (req.path === '/canary') return next();
  // Google OAuth callback is a browser-initiated GET from Google's domain
  // — there's no JWT to attach. CSRF is enforced via HMAC state inside
  // the handler.
  if (req.path === '/drive/oauth/callback') return next();
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
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/landings', landingsRouter);
// Canary honeypot. Mounted at /api/canary (matches the path used in the
// hidden <a> tags on bot-protected landings).
app.use('/api', canaryRouter);
app.use('/api/infloww', inflowwRouter);
app.use('/api/video-studio', videoStudioRouter);
app.use('/api/redirects', redirectsRouter);
app.use('/api/drive', driveRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/smspool', smspoolRouter);

// ============================================================
// CRONS (unchanged + new log retention cleanup)
// ============================================================
// ============================================================
// Daily snapshot crons — Europe/Rome, DST-aware.
//   10:00 + 20:00  – my-accounts (IG views / followers / status check)
//                    Twice a day so a banned/deleted profile is detected
//                    within ~10h instead of 24h; the Discord notifier
//                    fires on the transition.
//   00:10          – Infloww (subs / earnings)
// Snapshots are upserted on (account_id, snapshot_date) and
// (reel_id, snapshot_date), so two runs on the same calendar day
// overwrite each other's row — the day's snapshot reflects the
// most recent state, which is what the activity table reads.
// ============================================================
cron.schedule('0 10,20 * * *', async () => {
  console.log('[CRON] Starting my-accounts status check + snapshot (Europe/Rome)...');
  try {
    const r = await runMyAccountsFetch();
    console.log(`[CRON] My-accounts run complete: ${r.fetched} account(s).`);
  } catch (err) {
    console.error('[CRON] My-accounts run failed:', err.message);
  }
}, { timezone: 'Europe/Rome' });

cron.schedule('10 0 * * *', async () => {
  console.log('[CRON] Starting Infloww tracking-link sync (00:10 Europe/Rome)...');
  try {
    const r = await syncAllInflowwTalents();
    console.log(`[CRON] Infloww sync complete: ${r.length} talent(s)`);
  } catch (err) {
    console.error('[CRON] Infloww sync failed:', err.message);
  }
}, { timezone: 'Europe/Rome' });

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

// ============================================================
// Bot Protection — Meta CIDR list bootstrap
// Fetches the BGP-derived Meta IP ranges from GitHub on startup,
// then refreshes every 24h. If the first fetch fails the redirector
// falls back to a hardcoded subset (defined in botCidrs.js).
// ============================================================
const botCidrs = require('./lib/botCidrs');
botCidrs.refresh()
  .then(() => botCidrs.startRefreshLoop())
  .catch((err) => console.warn('[boot] botCidrs initial refresh threw:', err.message));

app.listen(PORT, () => {
  console.log(`✅ Reels Tracker API running on port ${PORT}`);
});
