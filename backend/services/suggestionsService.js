const supabase = require('../lib/supabase');

const HIKERAPI_BASE = 'https://api.hikerapi.com';
const HIKERAPI_TOKEN = process.env.HIKERAPI_TOKEN;
const MAX_CONCURRENT = 5;

if (!HIKERAPI_TOKEN) {
  console.warn('[suggestionsService] WARNING: HIKERAPI_TOKEN env var is not set. Suggestion scans will fail.');
}

async function hikerGet(path, params = {}) {
  const url = new URL(`${HIKERAPI_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      'x-access-key': HIKERAPI_TOKEN,
      'accept': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HikerAPI ${res.status} on ${path}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// HikerAPI's suggested-profiles payload comes in a couple of shapes depending
// on the version. Normalize them all into a flat array of user-like objects.
function normalizeSuggestions(payload) {
  if (!payload) return [];

  // Common v2 shape: { suggested_users: { suggestions: [ { user: {...} } ] } }
  // Sometimes: { suggested_users: [ { user: {...} } ] }
  // Sometimes: an array of user objects directly
  // Sometimes: { users: [...] }
  let raw = [];
  if (Array.isArray(payload)) {
    raw = payload;
  } else if (payload.suggested_users) {
    if (Array.isArray(payload.suggested_users)) raw = payload.suggested_users;
    else if (Array.isArray(payload.suggested_users.suggestions)) raw = payload.suggested_users.suggestions;
    else if (Array.isArray(payload.suggested_users.users)) raw = payload.suggested_users.users;
  } else if (Array.isArray(payload.users)) {
    raw = payload.users;
  } else if (Array.isArray(payload.suggestions)) {
    raw = payload.suggestions;
  } else if (Array.isArray(payload.items)) {
    raw = payload.items;
  }

  const out = [];
  for (const entry of raw) {
    // Unwrap { user: {...} } envelopes
    const u = entry?.user || entry;
    if (!u || typeof u !== 'object') continue;
    const username = (u.username || u.handle || '').toString().toLowerCase().trim();
    if (!username) continue;
    out.push({
      username,
      instagram_pk: (u.pk ?? u.id ?? u.user_id)?.toString() || null,
      full_name: u.full_name || null,
      profile_pic_url: u.profile_pic_url || u.profile_pic_url_hd || null,
      is_verified: !!u.is_verified,
      is_private: !!u.is_private,
      follower_count: u.follower_count ?? null,
    });
  }
  return out;
}

async function getSuggestedProfiles(userPk) {
  // GET /v2/user/suggested/profiles?user_id=X
  const payload = await hikerGet('/v2/user/suggested/profiles', { user_id: userPk });
  return normalizeSuggestions(payload);
}

// Fetch creators in a list, resolving instagram_pk on the fly for any that
// don't have one cached yet (so a never-fetched list still works).
async function loadListCreators(listId) {
  const { data, error } = await supabase
    .from('list_creators')
    .select('creator_id, creators(id, username, instagram_pk)')
    .eq('list_id', listId);
  if (error) throw error;
  return (data || []).map((r) => r.creators).filter(Boolean);
}

async function resolveInstagramPk(creator) {
  if (creator.instagram_pk) return creator.instagram_pk;
  try {
    const profile = await hikerGet('/v1/user/by/username', { username: creator.username });
    const pk = profile?.pk?.toString() || null;
    if (pk) {
      await supabase.from('creators').update({ instagram_pk: pk }).eq('id', creator.id);
    }
    return pk;
  } catch (err) {
    console.warn(`[suggestionsService] pk lookup failed for @${creator.username}: ${err.message}`);
    return null;
  }
}

// Main entry point — runs a scan for one list.
// Each source creator's suggestions are merged into an in-memory aggregate
// before we upsert, so we hit the DB once per unique suggestion.
async function runSuggestionScan(listId) {
  const { data: list, error: listErr } = await supabase
    .from('lists')
    .select('id, name')
    .eq('id', listId)
    .single();
  if (listErr || !list) throw new Error('List not found');

  const creators = await loadListCreators(listId);
  if (creators.length === 0) throw new Error('List has no creators');

  const { data: job, error: jobErr } = await supabase
    .from('creator_suggestion_jobs')
    .insert({
      list_id: listId,
      status: 'running',
      total_creators: creators.length,
    })
    .select()
    .single();
  if (jobErr) throw jobErr;

  // Mark every existing suggestion in this list as "not new" before we start
  // — so only rows touched by this run can flip back to new_in_last_run=true.
  await supabase
    .from('creator_suggestions')
    .update({ new_in_last_run: false })
    .eq('list_id', listId);

  // Build a set of usernames already in this list — we'll filter those out
  // of the suggestion aggregate before persisting.
  const inListUsernames = new Set(creators.map((c) => c.username.toLowerCase()));

  // Aggregate: username -> { ...userObj, count }
  const aggregate = new Map();
  let processedSoFar = 0;

  const runOne = async (creator) => {
    try {
      const pk = await resolveInstagramPk(creator);
      if (!pk) return;
      const suggestions = await getSuggestedProfiles(pk);
      for (const s of suggestions) {
        if (!s.username || inListUsernames.has(s.username)) continue;
        const cur = aggregate.get(s.username);
        if (cur) {
          cur.count += 1;
          // Prefer the most-populated profile metadata we've seen
          if (!cur.full_name && s.full_name) cur.full_name = s.full_name;
          if (!cur.profile_pic_url && s.profile_pic_url) cur.profile_pic_url = s.profile_pic_url;
          if (!cur.instagram_pk && s.instagram_pk) cur.instagram_pk = s.instagram_pk;
          if (cur.follower_count == null && s.follower_count != null) cur.follower_count = s.follower_count;
          if (s.is_verified) cur.is_verified = true;
          if (s.is_private) cur.is_private = true;
        } else {
          aggregate.set(s.username, { ...s, count: 1 });
        }
      }
    } catch (err) {
      console.warn(`[suggestionsService] @${creator.username} failed: ${err.message}`);
    } finally {
      processedSoFar++;
      supabase
        .from('creator_suggestion_jobs')
        .update({ creators_processed: processedSoFar })
        .eq('id', job.id)
        .then(() => {}, () => {});
    }
  };

  // Bounded concurrency loop (same pattern as fetchService).
  const queue = [...creators];
  const inFlight = new Set();
  await new Promise((resolve) => {
    const launchNext = () => {
      while (inFlight.size < MAX_CONCURRENT && queue.length > 0) {
        const c = queue.shift();
        const p = runOne(c).then(() => {
          inFlight.delete(p);
          if (queue.length === 0 && inFlight.size === 0) resolve();
          else launchNext();
        });
        inFlight.add(p);
      }
      if (queue.length === 0 && inFlight.size === 0) resolve();
    };
    launchNext();
  });

  // Persist the aggregate. We can't use a single upsert here because we need
  // to increment recommendation_count atomically per row, so we do it row by row.
  // The aggregate is usually small (~ a few hundred unique profiles at most).
  let suggestionsNew = 0;
  let suggestionsUpdated = 0;
  const now = new Date().toISOString();

  // Pre-load existing rows for this list so we know which usernames are new.
  const { data: existingRows } = await supabase
    .from('creator_suggestions')
    .select('id, username, recommendation_count')
    .eq('list_id', listId);
  const existingByUsername = new Map((existingRows || []).map((r) => [r.username, r]));

  for (const [username, info] of aggregate.entries()) {
    const existing = existingByUsername.get(username);
    if (existing) {
      const { error } = await supabase
        .from('creator_suggestions')
        .update({
          recommendation_count: (existing.recommendation_count || 0) + info.count,
          last_suggested_at: now,
          last_scan_id: job.id,
          new_in_last_run: false,
          // refresh profile metadata in case it's gotten richer
          instagram_pk: info.instagram_pk || undefined,
          full_name: info.full_name || undefined,
          profile_pic_url: info.profile_pic_url || undefined,
          is_verified: info.is_verified || undefined,
          is_private: info.is_private || undefined,
          follower_count: info.follower_count ?? undefined,
        })
        .eq('id', existing.id);
      if (error) console.warn(`[suggestionsService] update fail for ${username}: ${error.message}`);
      else suggestionsUpdated++;
    } else {
      const { error } = await supabase.from('creator_suggestions').insert({
        list_id: listId,
        username,
        instagram_pk: info.instagram_pk,
        full_name: info.full_name,
        profile_pic_url: info.profile_pic_url,
        is_verified: info.is_verified,
        is_private: info.is_private,
        follower_count: info.follower_count,
        recommendation_count: info.count,
        hidden: false,
        new_in_last_run: true,
        first_suggested_at: now,
        last_suggested_at: now,
        last_scan_id: job.id,
      });
      if (error) console.warn(`[suggestionsService] insert fail for ${username}: ${error.message}`);
      else suggestionsNew++;
    }
  }

  await supabase
    .from('creator_suggestion_jobs')
    .update({
      status: 'done',
      finished_at: new Date().toISOString(),
      creators_processed: processedSoFar,
      suggestions_new: suggestionsNew,
      suggestions_updated: suggestionsUpdated,
    })
    .eq('id', job.id);

  console.log(`[suggestionsService] Scan complete for list "${list.name}": ${suggestionsNew} new, ${suggestionsUpdated} updated, ${aggregate.size} total unique`);
  return { jobId: job.id, suggestionsNew, suggestionsUpdated, totalUnique: aggregate.size };
}

module.exports = { runSuggestionScan };
