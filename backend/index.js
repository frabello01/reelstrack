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
const { runMyAccountsFetch } = require('./services/myAccountsService');
const { generateDailyTasks, cleanupOldDailyTasks } = require('./services/dailyTasksService');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Middleware
// CORS — supports multiple origins via comma-separated FRONTEND_URL env var.
// e.g. FRONTEND_URL="https://app.reelstrack.io,https://reels-tracker.vercel.app"
const allowedOrigins = (process.env.FRONTEND_URL || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-side)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Health check endpoint — exempt from rate limiting (used by UptimeRobot to keep the dyno awake)
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// Rate limiter — applies to all OTHER routes.
// Skip the high-frequency polling endpoint so the FetchProgress bar doesn't burn the limit.
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // raised from 200 to 1000 to accommodate normal in-app usage
  skip: (req) => req.path === '/api/fetch/active',
}));

// Routes
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

// Competitor reels fetch is now MANUAL only.
// Use the "Fetch Now" button on the dashboard (whole list) or the 🔄 button
// next to each creator (single creator) to trigger fetches on demand.
// This avoids burning HikerAPI credits on days the app isn't being used.

// My-accounts cron: runs every day at 5:00 AM UTC (1 hour before competitor fetch)
// Snapshots followers + reels for each account. Idempotent — safe to run multiple times per day.
cron.schedule('0 5 * * *', async () => {
  console.log('[CRON] Starting my-accounts daily snapshot...');
  try {
    const r = await runMyAccountsFetch();
    console.log(`[CRON] My-accounts snapshot complete: ${r.fetched} account(s).`);
  } catch (err) {
    console.error('[CRON] My-accounts snapshot failed:', err.message);
  }
});

// Daily-tasks cron: runs at 00:01 Europe/Rome every day.
// Generates fresh task instances for every (active + opted-in) profile, and
// cleans up tasks older than 30 days. node-cron's `timezone` option handles
// DST transitions automatically.
cron.schedule('1 0 * * *', async () => {
  console.log('[CRON] Generating daily tasks for today (Europe/Rome)...');
  try {
    const r = await generateDailyTasks();
    console.log(`[CRON] Daily tasks generated:`, r);
    await cleanupOldDailyTasks();
  } catch (err) {
    console.error('[CRON] Daily tasks generation failed:', err.message);
  }
}, {
  timezone: 'Europe/Rome',
});

app.listen(PORT, () => {
  console.log(`✅ Reels Tracker API running on port ${PORT}`);
});
