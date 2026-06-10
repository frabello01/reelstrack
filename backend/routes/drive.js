const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const drive = require('../lib/googleDrive');

// CSRF state for the OAuth round-trip. We HMAC a timestamp with the
// service-role key (server-only secret) so the callback can verify the
// state without a cookie or DB lookup. State is good for 10 minutes.
const STATE_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || 'unsafe-dev-secret';
const STATE_TTL_MS = 10 * 60 * 1000;

function signState(payload) {
  const data = `${payload.ts}:${payload.nonce}`;
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(data).digest('hex').slice(0, 24);
  return `${data}:${sig}`;
}
function verifyState(state) {
  if (!state || typeof state !== 'string') return false;
  const parts = state.split(':');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const expected = crypto.createHmac('sha256', STATE_SECRET).update(`${ts}:${nonce}`).digest('hex').slice(0, 24);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) return false;
  if (Date.now() - tsNum > STATE_TTL_MS) return false;
  return true;
}

// Where the user lands after the OAuth round-trip. The Settings page reads
// ?drive_status=connected|error to render a flash.
function frontendUrl() {
  const raw = (process.env.FRONTEND_URL || 'https://app.reelstrack.io').split(',')[0].trim();
  return raw.replace(/\/$/, '');
}

// ============================================================
// STATUS / CONNECT / DISCONNECT  (admin-authenticated)
// ============================================================
router.get('/status', async (req, res) => {
  try {
    const s = await drive.getConnectionStatus();
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Returns the Google authorization URL. The frontend window.location's to it.
router.get('/oauth/start', async (req, res) => {
  if (!drive.isConfigured()) {
    return res.status(503).json({ error: 'Google Drive is not configured (set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET on Render)' });
  }
  const state = signState({ ts: Date.now(), nonce: crypto.randomBytes(8).toString('hex') });
  const url = drive.buildAuthUrl({ state });
  res.json({ auth_url: url });
});

router.post('/disconnect', async (req, res) => {
  try {
    await drive.disconnect();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// FOLDERS (admin-authenticated)
// ============================================================
router.get('/folders', async (req, res) => {
  try {
    const folders = await drive.listFolders({
      query: (req.query.q || '').toString().slice(0, 100),
      pageSize: parseInt(req.query.page_size, 10) || 50,
    });
    res.json(folders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate a folder ID before saving it on the talent — surfaces a clean
// error if the connected account can't write to it.
router.post('/folders/validate', async (req, res) => {
  const { folder_id } = req.body || {};
  if (!folder_id) return res.status(400).json({ error: 'folder_id is required' });
  try {
    const folder = await drive.getFolder(folder_id.trim());
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json(folder);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
// OAUTH CALLBACK  (PUBLIC — Google's redirect)
// Mounted at /api/drive/oauth/callback. The auth middleware whitelists
// this path in index.js. The state HMAC verifies CSRF.
// ============================================================
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  const front = frontendUrl();

  // User clicked "Cancel" on Google's consent screen
  if (oauthError) {
    return res.redirect(`${front}/settings?drive_status=error&drive_msg=${encodeURIComponent(String(oauthError))}`);
  }
  if (!code) {
    return res.redirect(`${front}/settings?drive_status=error&drive_msg=missing-code`);
  }
  if (!verifyState(String(state || ''))) {
    return res.redirect(`${front}/settings?drive_status=error&drive_msg=invalid-state`);
  }

  try {
    const tokens = await drive.exchangeCodeForTokens(String(code));
    if (!tokens.refresh_token) {
      // We always pass prompt=consent on /oauth/start so we should get one.
      // If we don't, it usually means the user already authorized and revoked
      // via the Google account page — they need to "approve" again.
      return res.redirect(`${front}/settings?drive_status=error&drive_msg=no-refresh-token`);
    }
    const email = await drive.fetchUserEmail(tokens.access_token);
    await drive.saveConnection({ refresh_token: tokens.refresh_token, email });
    res.redirect(`${front}/settings?drive_status=connected&drive_email=${encodeURIComponent(email || '')}`);
  } catch (err) {
    console.error('[drive] oauth callback failed:', err.message);
    res.redirect(`${front}/settings?drive_status=error&drive_msg=${encodeURIComponent(err.message.slice(0, 200))}`);
  }
});

module.exports = router;
