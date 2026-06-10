const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const drive = require('../lib/googleDrive');

// ============================================================
// Hard limits
// ============================================================
const MAX_FILE_BYTES = 500 * 1024 * 1024;      // 500 MB per clip
const ALLOWED_MIME_PREFIXES = ['video/'];      // mp4, mov, webm, etc.

// ============================================================
// HELPERS
// ============================================================

// Resolve the public token to a to-do list AND its talent's Drive folder.
// Returns { list, talent, folderId } or throws a 4xx-ish error string.
async function resolveListByToken(token) {
  const { data: list, error } = await supabase
    .from('todo_lists')
    .select('id, name, talent_id, creator_uploads_enabled')
    .eq('public_token', token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!list) throw Object.assign(new Error('List not found'), { status: 404 });
  if (!list.creator_uploads_enabled) {
    throw Object.assign(new Error('Uploads are not enabled on this list'), { status: 403 });
  }
  if (!list.talent_id) {
    throw Object.assign(new Error('This list is not linked to a creator yet — ask the admin to set it up.'), { status: 400 });
  }
  const { data: talent, error: tErr } = await supabase
    .from('talents')
    .select('id, name, drive_folder_id, drive_folder_name')
    .eq('id', list.talent_id)
    .maybeSingle();
  if (tErr) throw new Error(tErr.message);
  if (!talent?.drive_folder_id) {
    throw Object.assign(new Error('No Drive folder set for this creator yet — ask the admin to assign one.'), { status: 400 });
  }
  return { list, talent, folderId: talent.drive_folder_id };
}

// The creator-facing "#N" is now the immutable sequence_no stored on the
// row itself. No more computing from sort order — the number is stable
// for the lifetime of the reel and matches what's shown on both the
// admin and public pages.
async function getReelSequenceNo(todoListReelId) {
  const { data, error } = await supabase
    .from('todo_list_reels')
    .select('sequence_no')
    .eq('id', todoListReelId)
    .maybeSingle();
  if (error) return null;
  return data?.sequence_no || null;
}

// Build the Drive filename per the agreed convention:
//   "#N - <ig_url> - v<K>.<ext>"
//   "#N - v<K>.<ext>"           if no IG URL
function buildFilename({ positionLabel, reelUrl, version, mimeType, originalName }) {
  // Sanitize filename to avoid OS-level issues (Drive allows almost anything,
  // but creators may later download these to local disks). Strip control chars
  // and excessive whitespace; preserve URL characters since they're part of
  // the spec.
  const clean = (s) => String(s || '').replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();

  let extFromName = '';
  if (originalName) {
    const m = String(originalName).match(/\.([a-zA-Z0-9]{1,5})$/);
    if (m) extFromName = '.' + m[1].toLowerCase();
  }
  let ext = extFromName || (
    mimeType?.includes('quicktime') ? '.mov' :
    mimeType?.includes('webm') ? '.webm' :
    mimeType?.includes('x-matroska') ? '.mkv' :
    '.mp4'
  );

  const nbase = `#${positionLabel ?? '?'}`;
  const middle = reelUrl ? ` - ${clean(reelUrl)}` : '';
  const ver = ` - v${version}`;
  // Drive caps filenames at 32767 chars but Windows caps at 255 — stay safe.
  return `${nbase}${middle}${ver}${ext}`.slice(0, 240);
}

// Verify the reel actually belongs to this list (defensive, the token gives
// access to all reels in the list anyway). Also pulls backup_video_url as
// a safety net — for uploaded-MP4 reels, both url and backup_video_url
// point to the Supabase storage URL, but if a weird historical row ever
// has a NULL url, the backup wins so the filename never collapses to
// just "#N - vK.mp4".
async function verifyReelInList(listId, todoListReelId) {
  const { data, error } = await supabase
    .from('todo_list_reels')
    .select('id, reel_id, uploads_count, is_done, reels(url, backup_video_url)')
    .eq('todo_list_id', listId)
    .eq('id', todoListReelId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Object.assign(new Error('Reel not in this list'), { status: 404 });
  return data;
}

// Strip the trailing slash and any query string off a URL so it sits
// cleanly before " - vK.mp4" in the Drive filename.
// "https://www.instagram.com/reel/Cxy123/?utm=..." → "https://www.instagram.com/reel/Cxy123"
function tidyUrlForFilename(raw) {
  if (!raw) return null;
  let u = String(raw).trim();
  const q = u.indexOf('?');
  if (q >= 0) u = u.slice(0, q);
  if (u.endsWith('/')) u = u.slice(0, -1);
  return u || null;
}

// ============================================================
// PUBLIC (via share token) — creator-facing
// Mounted under /api/uploads/public — whitelisted before the auth gate.
// ============================================================

// POST /api/uploads/public/:token/reels/:todoListReelId/init
// Body: { filename, mime_type, size_bytes }
// Returns: { session_url, filename, version }
router.post('/public/:token/reels/:todoListReelId/init', async (req, res) => {
  try {
    const { filename: originalName, mime_type, size_bytes } = req.body || {};
    if (!mime_type || !ALLOWED_MIME_PREFIXES.some((p) => String(mime_type).startsWith(p))) {
      return res.status(400).json({ error: 'Only video files are allowed' });
    }
    if (size_bytes && Number(size_bytes) > MAX_FILE_BYTES) {
      return res.status(400).json({
        error: `File too large (${(Number(size_bytes) / 1024 / 1024).toFixed(1)} MB). Max ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
      });
    }

    const ctx = await resolveListByToken(req.params.token);
    const reel = await verifyReelInList(ctx.list.id, req.params.todoListReelId);

    // Version number is monotonic per (todo_list_reel_id). We don't recycle
    // numbers when an upload is deleted — the creator's Drive history stays
    // unambiguous.
    const { data: lastVersionRow } = await supabase
      .from('todo_list_reel_uploads')
      .select('version_number')
      .eq('todo_list_reel_id', reel.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (lastVersionRow?.version_number || 0) + 1;

    const positionLabel = await getReelSequenceNo(reel.id);
    // Two filename-source cases handled by the same `url` field:
    //   Instagram-tracked / paste-by-link reels → reels.url is the IG URL
    //   MP4-uploaded reels                      → reels.url is the Supabase storage URL
    // backup_video_url is a defensive fallback in case url ever ends up empty.
    const sourceUrl = reel.reels?.url || reel.reels?.backup_video_url || null;
    const filename = buildFilename({
      positionLabel,
      reelUrl: tidyUrlForFilename(sourceUrl),
      version,
      mimeType: mime_type,
      originalName,
    });

    // Pass the browser's Origin through to Drive so the eventual PUT has
    // the Access-Control-Allow-Origin header. Without this, Drive returns
    // the file metadata but with no CORS header and the browser blocks
    // the response.
    const browserOrigin = req.get('origin') || null;

    const { sessionUrl } = await drive.createResumableUploadSession({
      folderId: ctx.folderId,
      filename,
      mimeType: mime_type,
      sizeBytes: size_bytes ? Number(size_bytes) : undefined,
      origin: browserOrigin,
    });

    res.json({ session_url: sessionUrl, filename, version });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/uploads/public/:token/reels/:todoListReelId/complete
// Body: { drive_file_id, drive_file_name, size_bytes?, mime_type?, version }
// Stores the upload row, increments counter, sets is_done if first clip.
router.post('/public/:token/reels/:todoListReelId/complete', async (req, res) => {
  try {
    const { drive_file_id, drive_file_name, size_bytes, mime_type, version } = req.body || {};
    if (!drive_file_id || !drive_file_name) {
      return res.status(400).json({ error: 'drive_file_id and drive_file_name required' });
    }

    const ctx = await resolveListByToken(req.params.token);
    const reel = await verifyReelInList(ctx.list.id, req.params.todoListReelId);

    // Fetch the freshly-uploaded file's webViewLink so the admin can click
    // through. Best-effort — we don't fail the request if Drive is flaky.
    let viewUrl = null;
    try {
      const meta = await drive.getFileMetadata(drive_file_id);
      viewUrl = meta?.webViewLink || null;
    } catch (err) {
      console.warn('[uploads] getFileMetadata failed:', err.message);
    }

    const { data: insertedUpload, error: insertErr } = await supabase
      .from('todo_list_reel_uploads')
      .insert({
        todo_list_reel_id: reel.id,
        drive_file_id,
        drive_file_name,
        drive_view_url: viewUrl,
        size_bytes: size_bytes ? Number(size_bytes) : null,
        mime_type: mime_type || null,
        version_number: Number(version) || 1,
      })
      .select()
      .single();
    if (insertErr) return res.status(500).json({ error: `Saving upload failed: ${insertErr.message}` });

    // Bump counter + auto-done if first clip.
    // Done logic is one-way: first upload sets is_done=true; deleting all
    // uploads later does NOT revert it. Matches the spec ("non torna mai
    // indietro").
    const newCount = (reel.uploads_count || 0) + 1;
    const updates = { uploads_count: newCount };
    if (!reel.is_done) {
      updates.is_done = true;
      updates.done_at = new Date().toISOString();
    }
    await supabase
      .from('todo_list_reels')
      .update(updates)
      .eq('id', reel.id);

    res.json({ ok: true, upload: insertedUpload, became_done: !reel.is_done });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/uploads/public/:token/reels/:todoListReelId
// Returns the list of clips the creator has uploaded for this reel so far.
router.get('/public/:token/reels/:todoListReelId', async (req, res) => {
  try {
    const ctx = await resolveListByToken(req.params.token);
    const reel = await verifyReelInList(ctx.list.id, req.params.todoListReelId);
    const { data, error } = await supabase
      .from('todo_list_reel_uploads')
      .select('id, drive_file_id, drive_file_name, drive_view_url, size_bytes, mime_type, version_number, uploaded_at')
      .eq('todo_list_reel_id', reel.id)
      .order('version_number', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /api/uploads/public/:token/reels/:todoListReelId/uploads/:uploadId
// Creator removes a clip she uploaded by mistake. Deletes the file from
// Drive AND removes the row.
router.delete('/public/:token/reels/:todoListReelId/uploads/:uploadId', async (req, res) => {
  try {
    const ctx = await resolveListByToken(req.params.token);
    const reel = await verifyReelInList(ctx.list.id, req.params.todoListReelId);

    const { data: upload, error: lookupErr } = await supabase
      .from('todo_list_reel_uploads')
      .select('id, drive_file_id')
      .eq('id', req.params.uploadId)
      .eq('todo_list_reel_id', reel.id)
      .maybeSingle();
    if (lookupErr) return res.status(500).json({ error: lookupErr.message });
    if (!upload) return res.status(404).json({ error: 'Upload not found' });

    // Try Drive first; if Drive succeeds we delete the row. If Drive fails
    // (e.g. permission revoked), we surface the error and keep the row so
    // we don't end up with an orphan file silently lingering.
    try {
      await drive.deleteFile(upload.drive_file_id);
    } catch (err) {
      return res.status(502).json({ error: `Drive delete failed: ${err.message}` });
    }

    const { error: delErr } = await supabase
      .from('todo_list_reel_uploads')
      .delete()
      .eq('id', upload.id);
    if (delErr) return res.status(500).json({ error: delErr.message });

    // Decrement counter (uploads_count). If this was the LAST clip for
    // this reel, the reel goes back to "not done" — matches the creator's
    // mental model that "having clips uploaded" = done. (Spec corrected
    // from earlier: removing the last clip MUST reverse the done state.)
    const newCount = Math.max(0, (reel.uploads_count || 1) - 1);
    const updates = { uploads_count: newCount };
    if (newCount === 0) {
      updates.is_done = false;
      updates.done_at = null;
    }
    await supabase
      .from('todo_list_reels')
      .update(updates)
      .eq('id', reel.id);

    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ============================================================
// ADMIN endpoints — protected by the existing auth gate.
// Used by TodoDetailPage to show clip lists per reel and toggle "editato".
// ============================================================

// GET /api/uploads/reels/:todoListReelId — admin sees all clips for a reel
router.get('/reels/:todoListReelId', async (req, res) => {
  const { data, error } = await supabase
    .from('todo_list_reel_uploads')
    .select('*')
    .eq('todo_list_reel_id', req.params.todoListReelId)
    .order('version_number', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// DELETE /api/uploads/reels/:todoListReelId/uploads/:uploadId
// Admin nukes a clip the creator uploaded (e.g. the take is bad). Same
// guarantees as the creator-side delete: Drive first, then the row, then
// counter decrement. Mirrors auto-undone semantics — if the last clip
// goes, the reel goes back to "not done" (and lands in PENDING).
router.delete('/reels/:todoListReelId/uploads/:uploadId', async (req, res) => {
  const { todoListReelId, uploadId } = req.params;

  const { data: upload, error: lookupErr } = await supabase
    .from('todo_list_reel_uploads')
    .select('id, drive_file_id')
    .eq('id', uploadId)
    .eq('todo_list_reel_id', todoListReelId)
    .maybeSingle();
  if (lookupErr) return res.status(500).json({ error: lookupErr.message });
  if (!upload) return res.status(404).json({ error: 'Upload not found' });

  const { data: reelRow } = await supabase
    .from('todo_list_reels')
    .select('uploads_count')
    .eq('id', todoListReelId)
    .maybeSingle();

  // Drive first — if it fails we keep the DB row so we don't orphan it.
  try {
    await drive.deleteFile(upload.drive_file_id);
  } catch (err) {
    return res.status(502).json({ error: `Drive delete failed: ${err.message}` });
  }

  const { error: delErr } = await supabase
    .from('todo_list_reel_uploads')
    .delete()
    .eq('id', upload.id);
  if (delErr) return res.status(500).json({ error: delErr.message });

  const newCount = Math.max(0, (reelRow?.uploads_count || 1) - 1);
  const updates = { uploads_count: newCount };
  if (newCount === 0) {
    updates.is_done = false;
    updates.done_at = null;
  }
  await supabase
    .from('todo_list_reels')
    .update(updates)
    .eq('id', todoListReelId);

  res.json({
    ok: true,
    new_uploads_count: newCount,
    became_undone: newCount === 0,
  });
});

// PATCH /api/uploads/reels/:todoListReelId/edited — toggle is_edited
// Invariant: "edited" implies "done". When the admin flips is_edited=true
// we also force is_done=true (with a done_at if it wasn't already) so the
// Trello tabs stay mutually exclusive and a reel never appears in
// PENDING and EDITED at the same time. Un-flipping is_edited leaves
// is_done alone (admin would have to un-check done separately, same
// behaviour as the creator-removes-clip flow).
router.patch('/reels/:todoListReelId/edited', async (req, res) => {
  const { is_edited } = req.body || {};
  const nowIso = new Date().toISOString();

  // Read current is_done so we don't clobber an already-true done_at timestamp.
  const { data: existing } = await supabase
    .from('todo_list_reels')
    .select('is_done, done_at')
    .eq('id', req.params.todoListReelId)
    .maybeSingle();

  const updates = {
    is_edited: !!is_edited,
    edited_at: is_edited ? nowIso : null,
  };
  if (is_edited && !existing?.is_done) {
    updates.is_done = true;
    updates.done_at = nowIso;
  }

  const { data, error } = await supabase
    .from('todo_list_reels')
    .update(updates)
    .eq('id', req.params.todoListReelId)
    .select('id, is_edited, edited_at, is_done, done_at')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
