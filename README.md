# 📊 Reels Tracker

Track Instagram Reels from any creator, rank them by outlier score (how much a reel outperforms the creator's average views), and share the dashboard with your whole team.

---

## How it Works

1. You create **Creator Lists** (e.g. "Italian", "USA Fitness")
2. You add Instagram usernames to each list
3. Every day at 6 AM UTC (or manually), the backend fetches reels via Apify
4. Each reel gets an **Outlier Score** = `reel views ÷ creator's 30-day avg views`
   - `3.0×` = 3x their normal performance → viral
   - `1.0×` = average
   - `0.5×` = below average
5. The dashboard shows all reels ranked by this score, filterable by list and time window

---

## Prerequisites

- Node.js 18+
- A **Supabase** account → https://supabase.com (free)
- An **Apify** account → https://apify.com (pay-per-use, ~$0.001 per reel)
- A **Render** account → https://render.com (for hosting backend, free tier works)
- A **Vercel** account → https://vercel.com (for hosting frontend, free)

---

## Step 1 — Set up Supabase

1. Go to https://supabase.com → New Project
2. Name it `reels-tracker`, choose a region close to you, set a password
3. Wait for the project to spin up (~1 min)
4. Go to **SQL Editor** → paste the full contents of `supabase/schema.sql` → Run
5. Go to **Project Settings → API**:
   - Copy **Project URL** → this is your `SUPABASE_URL`
   - Copy **anon public** key → this is your `VITE_SUPABASE_ANON_KEY`
   - Copy **service_role** key → this is your `SUPABASE_SERVICE_ROLE_KEY`
6. Go to **Authentication → Email** → make sure "Enable Email Signup" is ON
7. To invite team members: **Authentication → Users → Invite user** (or they can sign up via the app)

---

## Step 2 — Set up Apify

1. Go to https://apify.com → Sign up
2. Go to **Settings → Integrations** → copy your **API token**
3. The app uses the actor `apify/instagram-reel-scraper`
   - This is a public actor, no extra setup needed
   - Billing is per compute unit — for ~10 creators/day, cost is negligible (<$1/month)
4. Add $5 prepaid credit to get started

---

## Step 3 — Deploy the Backend (Render)

1. Push this entire project to a GitHub repo
2. Go to https://render.com → New → **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (or Starter for always-on)
5. Add Environment Variables (from the `.env.example`):
   ```
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   APIFY_API_TOKEN=your-apify-token
   FRONTEND_URL=https://your-vercel-app.vercel.app
   PORT=3001
   ```
6. Deploy → copy the service URL (e.g. `https://reels-tracker-backend.onrender.com`)

> **Note**: On Render's free tier, the service sleeps after 15 min of inactivity. Upgrade to Starter ($7/mo) for the cron job to run reliably 24/7.

---

## Step 4 — Deploy the Frontend (Vercel)

1. Go to https://vercel.com → New Project → import your GitHub repo
2. Set **Root Directory** to `frontend`
3. Add Environment Variables:
   ```
   VITE_SUPABASE_URL=https://xxx.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_API_URL=https://your-render-backend-url.onrender.com
   ```
4. Deploy → Vercel gives you a URL like `https://reels-tracker.vercel.app`
5. Go back to Render → update `FRONTEND_URL` to this Vercel URL → redeploy

---

## Step 5 — First Login

1. Open your Vercel URL
2. Click "Sign up" → create your account
3. Check email for confirmation link (Supabase sends this automatically)
4. Log in → you're in!

**Invite team members**: In the app they can sign up themselves, OR you can pre-invite them from Supabase → Authentication → Users → Invite.

---

## Local Development

```bash
# Backend
cd backend
cp .env.example .env   # fill in your values
npm install
npm run dev            # runs on http://localhost:3001

# Frontend (new terminal)
cd frontend
cp .env.example .env   # fill in your values
npm install
npm run dev            # runs on http://localhost:5173
```

---

## Outlier Score Explained

```
outlier_score = reel_views / creator_avg_views_30d
```

- The avg is computed from the creator's last 30 reels stored in the database
- Every time a fetch runs, scores are recomputed with fresh avg
- A creator with 100K avg views who posts a 500K reel gets a score of **5.0×**
- Scores above **2.0×** = genuine outlier, worth studying

---

## Manual Fetch

- Hit **Fetch Now** on the dashboard to trigger an immediate fetch for all creators
- Or **Fetch This List** inside a specific list to only fetch those creators
- The daily cron runs at 6:00 AM UTC automatically

---

## Project Structure

```
reels-tracker/
├── supabase/
│   └── schema.sql          # Run this in Supabase SQL editor
├── backend/
│   ├── index.js            # Express server + cron job
│   ├── routes/
│   │   ├── lists.js
│   │   ├── creators.js
│   │   ├── reels.js
│   │   └── fetch.js
│   ├── services/
│   │   └── fetchService.js # Apify integration + scoring logic
│   └── lib/
│       └── supabase.js
└── frontend/
    └── src/
        ├── pages/
        │   ├── LoginPage.jsx
        │   ├── DashboardPage.jsx
        │   ├── ListsPage.jsx
        │   └── ListDetailPage.jsx
        ├── components/
        │   ├── Layout.jsx
        │   └── ReelCard.jsx
        ├── hooks/
        │   └── useAuth.jsx
        └── lib/
            ├── supabase.js
            └── api.js
```

---

## Troubleshooting

**Apify returns no reels**: Some accounts may be private or the actor may need a proxy. Check your Apify run logs at apify.com → Storage → Runs.

**CORS error**: Make sure `FRONTEND_URL` in your backend env exactly matches your Vercel URL (no trailing slash).

**Cron not running**: Upgrade Render to a paid instance so it doesn't sleep.

**Auth email not arriving**: Check Supabase → Authentication → Email Templates → make sure SMTP is configured, or use Supabase's default (limited to 4/hr on free tier).
