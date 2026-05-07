require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');

const listsRouter = require('./routes/lists');
const creatorsRouter = require('./routes/creators');
const reelsRouter = require('./routes/reels');
const fetchRouter = require('./routes/fetch');
const { runDailyFetch } = require('./services/fetchService');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// Routes
app.use('/api/lists', listsRouter);
app.use('/api/creators', creatorsRouter);
app.use('/api/reels', reelsRouter);
app.use('/api/fetch', fetchRouter);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// Daily cron: runs every day at 6:00 AM UTC
cron.schedule('0 6 * * *', async () => {
  console.log('[CRON] Starting daily fetch job...');
  try {
    await runDailyFetch();
    console.log('[CRON] Daily fetch complete.');
  } catch (err) {
    console.error('[CRON] Daily fetch failed:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Reels Tracker API running on port ${PORT}`);
});
