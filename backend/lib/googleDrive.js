/*
 * Google Drive client for the agency's single OAuth account.
 *
 * The agency admin connects ONE Google account via OAuth (Settings page).
 * We store the refresh_token on agency_settings; access tokens are
 * refreshed on demand and cached in-memory for the rest of their lifetime
 * (typically 1h).
 *
 * Scope: drive.file — restricted to files our app creates. Safer than
 * full Drive access; the user keeps the rest of their Drive untouched.
 */

const supabase = require('./supabase');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI
  || `${process.env.BACKEND_PUBLIC_URL || 'https://reelstrack-backend.onrender.com'}/api/drive/oauth/callback`;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

// agency_settings is a singleton row keyed by id='default' in this codebase.
const AGENCY_SETTINGS_ID = 'default';

// In-memory access-token cache. Survives across requests in the same
// process but is rebuilt on dyno restart. That's fine — we just refresh
// again from the stored refresh_token.
let _accessToken = null;
let _accessTokenExpiresAt = 0;

function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new Error(
      'Google Drive is not configured — set GOOGLE_CLIENT_ID and ' +
      'GOOGLE_CLIENT_SECRET on Render.'
    );
  }
}

// ----- OAuth flow -----------------------------------------------------

function buildAuthUrl({ state }) {
  assertConfigured();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',     // gives us a refresh_token
    prompt: 'consent',          // forces a fresh refresh_token even on re-auth
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  assertConfigured();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: ${body.error_description || body.error || res.status}`);
  }
  return body; // { access_token, expires_in, refresh_token, scope, token_type, id_token? }
}

// Fetch the user's email so the UI can display "Connected as foo@bar.com"
async function fetchUserEmail(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.email || null;
}

async function saveConnection({ refresh_token, email }) {
  const { error } = await supabase
    .from('agency_settings')
    .update({
      google_drive_refresh_token: refresh_token,
      google_drive_user_email: email,
      google_drive_connected_at: new Date().toISOString(),
    })
    .eq('id', AGENCY_SETTINGS_ID);
  if (error) throw new Error(`Saving Drive connection failed: ${error.message}`);
  // Reset the in-memory cache so the next API call picks up the new
  // refresh_token instead of trying to refresh the old (now revoked) one.
  _accessToken = null;
  _accessTokenExpiresAt = 0;
}

async function disconnect() {
  const refreshToken = await getStoredRefreshToken();
  if (refreshToken) {
    // Best-effort revoke. Failure is fine — we still clear our row.
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
    }).catch(() => {});
  }
  const { error } = await supabase
    .from('agency_settings')
    .update({
      google_drive_refresh_token: null,
      google_drive_user_email: null,
      google_drive_connected_at: null,
    })
    .eq('id', AGENCY_SETTINGS_ID);
  if (error) throw new Error(`Disconnect failed: ${error.message}`);
  _accessToken = null;
  _accessTokenExpiresAt = 0;
}

async function getStoredRefreshToken() {
  const { data, error } = await supabase
    .from('agency_settings')
    .select('google_drive_refresh_token')
    .eq('id', AGENCY_SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error(`Reading Drive token failed: ${error.message}`);
  return data?.google_drive_refresh_token || null;
}

async function getConnectionStatus() {
  const { data, error } = await supabase
    .from('agency_settings')
    .select('google_drive_user_email, google_drive_connected_at, google_drive_refresh_token')
    .eq('id', AGENCY_SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    configured: isConfigured(),
    connected: !!data?.google_drive_refresh_token,
    email: data?.google_drive_user_email || null,
    connected_at: data?.google_drive_connected_at || null,
  };
}

// ----- Access-token refresh ------------------------------------------

async function getAccessToken() {
  assertConfigured();
  if (_accessToken && Date.now() < _accessTokenExpiresAt - 30_000) {
    return _accessToken;
  }
  const refreshToken = await getStoredRefreshToken();
  if (!refreshToken) {
    throw new Error('Google Drive is not connected — admin must authorize first.');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const body = await res.json();
  if (!res.ok) {
    // If the refresh token was revoked, surface a clear error so the UI
    // can prompt the admin to re-connect.
    const msg = body.error_description || body.error || `HTTP ${res.status}`;
    if (body.error === 'invalid_grant') {
      throw new Error('Google Drive token expired or revoked — please reconnect from Settings.');
    }
    throw new Error(`Drive token refresh failed: ${msg}`);
  }
  _accessToken = body.access_token;
  _accessTokenExpiresAt = Date.now() + (body.expires_in * 1000);
  return _accessToken;
}

// ----- Drive API operations ------------------------------------------

// List folders the admin can see — used by the folder picker UI.
// We only list "folder" mimeType items, sorted by recency.
async function listFolders({ query = '', pageSize = 50 } = {}) {
  const accessToken = await getAccessToken();
  const params = new URLSearchParams({
    q: [
      "mimeType='application/vnd.google-apps.folder'",
      'trashed=false',
      query ? `name contains '${query.replace(/'/g, "\\'")}'` : null,
    ].filter(Boolean).join(' and '),
    fields: 'files(id,name,parents,modifiedTime),nextPageToken',
    orderBy: 'modifiedTime desc',
    pageSize: String(Math.min(100, pageSize)),
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Listing folders failed: ${body.error?.message || res.status}`);
  }
  const body = await res.json();
  return body.files || [];
}

// Verify a folder ID exists and the admin can write to it.
async function getFolder(folderId) {
  const accessToken = await getAccessToken();
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,capabilities/canAddChildren',
    supportsAllDrives: 'true',
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Folder lookup failed: ${body.error?.message || res.status}`);
  }
  const body = await res.json();
  if (body.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('That Drive item is a file, not a folder.');
  }
  if (!body.capabilities?.canAddChildren) {
    throw new Error('That folder exists but the connected Google account cannot upload to it.');
  }
  return { id: body.id, name: body.name };
}

// Create a resumable upload session.
// Returns the session URL the browser will PUT the file to.
async function createResumableUploadSession({
  folderId,
  filename,
  mimeType = 'video/mp4',
  sizeBytes,            // optional — Drive uses it for progress reporting
}) {
  const accessToken = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': mimeType,
  };
  if (sizeBytes) headers['X-Upload-Content-Length'] = String(sizeBytes);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,size,mimeType',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: filename,
        parents: [folderId],
      }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Resumable session creation failed: ${body.error?.message || res.status}`);
  }
  const sessionUrl = res.headers.get('location') || res.headers.get('Location');
  if (!sessionUrl) {
    throw new Error('Drive did not return a session URL');
  }
  return { sessionUrl };
}

// Fetch metadata for a file we (admin) uploaded — used after the browser
// reports a successful PUT, so we can store the webViewLink alongside the
// file id.
async function getFileMetadata(fileId) {
  const accessToken = await getAccessToken();
  const params = new URLSearchParams({
    fields: 'id,name,webViewLink,webContentLink,size,mimeType',
    supportsAllDrives: 'true',
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`File metadata fetch failed: ${body.error?.message || res.status}`);
  }
  return res.json();
}

async function deleteFile(fileId) {
  const accessToken = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (res.status === 404) return { ok: true, alreadyGone: true };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`File delete failed: ${body.error?.message || res.status}`);
  }
  return { ok: true };
}

module.exports = {
  isConfigured,
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchUserEmail,
  saveConnection,
  disconnect,
  getConnectionStatus,
  listFolders,
  getFolder,
  createResumableUploadSession,
  getFileMetadata,
  deleteFile,
};
