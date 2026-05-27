const supabase = require('../lib/supabase');

const HIKERAPI_BASE = 'https://api.hikerapi.com';
const HIKERAPI_TOKEN = process.env.HIKERAPI_TOKEN;
const PROFILE_PIC_BUCKET = 'profile-pics'; // reuse existing bucket

// ----- Generic HikerAPI helper (same pattern as fetchService) -----

async function hikerGet(path, params = {}) {
  if (!HIKERAPI_TOKEN) throw new Error('HIKERAPI_TOKEN not configured');
  const url = new URL(`${HIKERAPI_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'x-access-key': HIKERAPI_TOKEN, accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HikerAPI ${res.status} on ${path}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ----- Profile pic persistence (same as fetchService) -----

async function persistProfilePic(accountId, sourceUrl) {
  if (!sourceUrl || !accountId) return null;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const path = `my-account-${accountId}.${ext}`;
    const { error } = await supabase.storage
      .from(PROFILE_PIC_BUCKET)
      .upload(path, buf, { contentType, upsert: true, cacheControl: '604800' });
    if (error) return null;
    const { data: pub } = supabase.storage.from(PROFILE_PIC_BUCKET).getPublicUrl(path);
    return pub?.publicUrl || null;
  } catch (err) {
    console.warn(`[persistProfilePic] failed for ${accountId}:`, err.message);
    return null;
  }
}

// ----- Fetch + store one account -----

async function fetchAccount(account) {
  console.log(`[MyAccounts] Fetching @${account.username}`);

  // Step 1: profile lookup (always — we want fresh follower count)
  let profile;
  try {
    profile = await hikerGet('/v1/user/by/username', { username: account.username });
  } catch (err) {
    if (err.status === 404) {
      return await markAccountStatus(account.id, 'inactive', 'Profile not found');
    }
    return await markAccountStatus(account.id, 'error', err.message);
  }

  if (profile.is_private) {
    await persistAndUpdateAccount(account, profile, 'private', 'Account is private');
    return;
  }

  const pk = profile.pk?.toString();
  if (!pk) {
    return await markAccountStatus(account.id, 'error', 'No pk returned from HikerAPI');
  }

  // Step 2: paginate through reels (we want as many as possible to compute "all time" totals)
  // For "my accounts" we cap pagination at 10 pages (~120 reels) to keep cost low.
  const allReels = [];
  let endCursor = null;
  const MAX_PAGES = 10;
  let reelsFetchError = null;
  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      const result = await hikerGet('/v1/user/clips/chunk', {
        user_id: pk,
        end_cursor: endCursor || undefined,
      });
      const [reels, nextCursor] = Array.isArray(result) ? result : [[], null];
      if (!Array.isArray(reels) || reels.length === 0) break;
      allReels.push(...reels);
      if (!nextCursor) break;
      endCursor = nextCursor;
    }
  } catch (err) {
    // HikerAPI returns 404 on /v1/user/clips/chunk when the account simply has
    // zero reels (even if it has other media like photos). That's a perfectly
    // normal state — not a real error. We still save everything else we have.
    if (err.status === 404) {
      console.log(`[MyAccounts] @${account.username}: no reels yet (HikerAPI 404 on clips)`);
    } else {
      reelsFetchError = err.message;
    }
  }

  console.log(`[MyAccounts] @${account.username}: got ${allReels.length} reels`);

  // If reels fetch hit a real error (not a 404 = no reels), mark as error but
  // still keep the profile data we got from step 1.
  if (reelsFetchError) {
    await persistAndUpdateAccount(account, profile, 'error', `Reels fetch failed: ${reelsFetchError}`);
    return { reelsStored: 0 };
  }

  // Step 3: persist account info + reels + daily snapshot. Account is "active"
  // even if it has zero reels — the profile is fine, just empty.
  await persistAndUpdateAccount(account, profile, 'active', null);
  const stored = await storeAccountReels(account.id, allReels);
  await writeDailySnapshot(account.id, profile.follower_count, stored.totalViews, stored.reelsCount);

  return { reelsStored: stored.reelsCount };
}

async function persistAndUpdateAccount(account, profile, status, errorMsg) {
  const updates = {
    last_fetched_at: new Date().toISOString(),
    status,
    status_error: errorMsg,
    status_checked_at: new Date().toISOString(),
    instagram_pk: profile.pk?.toString() || account.instagram_pk,
    follower_count: profile.follower_count ?? account.follower_count,
    display_name: profile.full_name || account.display_name,
  };
  // Persist profile pic to storage so URL doesn't expire
  if (profile.profile_pic_url) {
    const persisted = await persistProfilePic(account.id, profile.profile_pic_url);
    updates.profile_pic_url = persisted || profile.profile_pic_url;
  }
  await supabase.from('my_accounts').update(updates).eq('id', account.id);
}

async function markAccountStatus(accountId, status, errorMsg) {
  await supabase
    .from('my_accounts')
    .update({
      status,
      status_error: errorMsg,
      status_checked_at: new Date().toISOString(),
      last_fetched_at: new Date().toISOString(),
    })
    .eq('id', accountId);
}

async function storeAccountReels(accountId, rawReels) {
  if (!rawReels || rawReels.length === 0) return { totalViews: 0, reelsCount: 0 };

  const reels = rawReels
    .filter((r) => r?.code)
    .map((r) => ({
      account_id: accountId,
      instagram_id: r.id || r.pk?.toString() || r.code,
      shortcode: r.code,
      url: `https://www.instagram.com/reel/${r.code}/`,
      thumbnail_url: r.thumbnail_url || null,
      caption: (r.caption_text || '').substring(0, 500) || null,
      views: r.play_count || 0,
      likes: r.like_count || 0,
      comments: r.comment_count || 0,
      duration_seconds: r.video_duration ? Math.round(r.video_duration) : null,
      posted_at: r.taken_at_ts
        ? new Date(r.taken_at_ts * 1000).toISOString()
        : (r.taken_at ? new Date(r.taken_at).toISOString() : new Date().toISOString()),
      last_updated_at: new Date().toISOString(),
    }));

  // Upsert and ask Supabase to return the rows so we can grab each reel's
  // uuid for the per-reel daily snapshots.
  const { data: stored, error } = await supabase
    .from('account_reels')
    .upsert(reels, { onConflict: 'account_id,instagram_id', ignoreDuplicates: false })
    .select('id, views, likes, comments');
  if (error) console.error(`[storeAccountReels] error:`, error.message);

  // Per-reel daily snapshot — one row per (reel, today). Idempotent: same
  // day rerun overwrites the same row. Day-over-day deltas computed at
  // read time give us the real "audience reached" metric.
  if (stored && stored.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const snapshots = stored.map((row) => ({
      reel_id: row.id,
      account_id: accountId,
      snapshot_date: today,
      views: row.views || 0,
      likes: row.likes || 0,
      comments: row.comments || 0,
    }));
    const { error: snapErr } = await supabase
      .from('account_reel_snapshots')
      .upsert(snapshots, { onConflict: 'reel_id,snapshot_date', ignoreDuplicates: false });
    if (snapErr) console.error('[reel snapshots] error:', snapErr.message);
  }

  const totalViews = reels.reduce((sum, r) => sum + (r.views || 0), 0);
  return { totalViews, reelsCount: reels.length };
}

async function writeDailySnapshot(accountId, followerCount, totalViews, reelsCount) {
  // Use upsert so re-running on the same day doesn't create duplicates.
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { error } = await supabase
    .from('account_snapshots')
    .upsert({
      account_id: accountId,
      snapshot_date: today,
      follower_count: followerCount ?? null,
      total_views_lifetime: totalViews,
      reels_count_lifetime: reelsCount,
    }, { onConflict: 'account_id,snapshot_date' });
  if (error) console.error('[writeDailySnapshot] error:', error.message);
}

// ----- Daily fetch runner -----

async function runMyAccountsFetch(accountIds = null) {
  let query = supabase.from('my_accounts').select('*');
  if (accountIds) query = query.in('id', accountIds);
  const { data: accounts, error } = await query;
  if (error) throw error;

  if (!accounts || accounts.length === 0) {
    console.log('[MyAccounts] No accounts to fetch');
    return { fetched: 0 };
  }

  // Sequential — small list, no concurrency needed
  let fetched = 0;
  for (const acc of accounts) {
    try {
      await fetchAccount(acc);
      fetched++;
    } catch (err) {
      console.error(`[MyAccounts] Fatal error for @${acc.username}:`, err.message);
    }
  }
  return { fetched };
}

module.exports = { fetchAccount, runMyAccountsFetch };
