const supabase = require('../lib/supabase');

const HIKERAPI_BASE = 'https://api.hikerapi.com';
const HIKERAPI_TOKEN = process.env.HIKERAPI_TOKEN;
const PROFILE_PIC_BUCKET = 'profile-pics';

if (!HIKERAPI_TOKEN) {
  console.warn('[fetchService] WARNING: HIKERAPI_TOKEN env var is not set. Fetches will fail.');
}

// ---------- Profile pic storage ----------

/**
 * Downloads an image from a URL and uploads it to Supabase Storage.
 * Returns the permanent public URL, or null on failure (caller should fallback to original URL).
 */
async function persistProfilePic(creatorId, sourceUrl) {
  if (!sourceUrl || !creatorId) return null;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) {
      console.warn(`[persistProfilePic] download failed (${res.status}) for ${creatorId}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const path = `${creatorId}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(PROFILE_PIC_BUCKET)
      .upload(path, buf, {
        contentType,
        upsert: true,
        cacheControl: '604800', // 7 days
      });

    if (upErr) {
      console.warn(`[persistProfilePic] upload failed for ${creatorId}:`, upErr.message);
      return null;
    }

    const { data: pub } = supabase.storage.from(PROFILE_PIC_BUCKET).getPublicUrl(path);
    return pub?.publicUrl || null;
  } catch (err) {
    console.warn(`[persistProfilePic] exception for ${creatorId}:`, err.message);
    return null;
  }
}

// ---------- Low-level HikerAPI helpers ----------

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

async function getUserByUsername(username) {
  // GET /v1/user/by/username?username=X
  return hikerGet('/v1/user/by/username', { username });
}

async function getUserClipsChunk(userId, endCursor = null) {
  // GET /v1/user/clips/chunk?user_id=X[&end_cursor=Y]
  // Returns [reelsArray, nextEndCursorOrNull]
  return hikerGet('/v1/user/clips/chunk', {
    user_id: userId,
    end_cursor: endCursor || undefined,
  });
}

// ---------- High-level: fetch + normalize for one creator ----------

async function fetchCreatorReels(creator, daysBack = 30) {
  console.log(`[Hiker] Fetching reels for @${creator.username} (last ${daysBack} days)`);

  let pk = creator.instagram_pk;
  let profilePic = null;
  let fullName = null;
  let isPrivate = false;
  let followerCount = null;

  // Step 1: resolve numeric pk if not cached
  if (!pk) {
    try {
      const profile = await getUserByUsername(creator.username);
      pk = profile.pk?.toString();
      profilePic = profile.profile_pic_url || null;
      fullName = profile.full_name || null;
      isPrivate = !!profile.is_private;
      followerCount = profile.follower_count ?? null;
    } catch (err) {
      if (err.status === 404) {
        return { items: [], status: 'inactive', error: 'Profile not found', profilePic: null, instagramPk: null, fullName: null, isPrivate: false, followerCount: null };
      }
      return { items: [], status: 'error', error: `Profile lookup failed: ${err.message}`, profilePic: null, instagramPk: null, fullName: null, isPrivate: false, followerCount: null };
    }
  }

  if (isPrivate) {
    return { items: [], status: 'private', error: 'Account is private', profilePic, instagramPk: pk, fullName, isPrivate, followerCount };
  }

  // Step 2: paginate clips, stopping when we've passed the date cutoff
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const allReels = [];
  let endCursor = null;
  const MAX_PAGES = 5;
  let pagesUsed = 0;

  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      const result = await getUserClipsChunk(pk, endCursor);
      pagesUsed++;
      const [reels, nextCursor] = Array.isArray(result) ? result : [[], null];
      if (!Array.isArray(reels) || reels.length === 0) break;

      allReels.push(...reels);

      const lastReel = reels[reels.length - 1];
      const lastReelDate = lastReel?.taken_at_ts
        ? new Date(lastReel.taken_at_ts * 1000)
        : (lastReel?.taken_at ? new Date(lastReel.taken_at) : null);
      if (lastReelDate && lastReelDate < cutoff) break;

      if (!nextCursor) break;
      endCursor = nextCursor;
    }
  } catch (err) {
    console.error(`[Hiker] Clips fetch failed for @${creator.username}:`, err.message);
    return { items: [], status: 'error', error: `Clips fetch failed: ${err.message}`, profilePic, instagramPk: pk, fullName, isPrivate, followerCount };
  }

  // Filter to date window and require valid code
  const filtered = allReels.filter(r => {
    if (!r?.code) return false;
    const ts = r.taken_at_ts ? new Date(r.taken_at_ts * 1000)
      : (r.taken_at ? new Date(r.taken_at) : null);
    if (!ts) return true;
    return ts >= cutoff;
  });

  console.log(`[Hiker] @${creator.username}: ${pagesUsed} page(s), ${allReels.length} reels seen, ${filtered.length} within last ${daysBack}d`);

  return {
    items: filtered,
    status: 'active',
    error: null,
    profilePic,
    instagramPk: pk,
    fullName,
    isPrivate,
    followerCount,
  };
}

// ---------- Main job runner ----------

async function runDailyFetch(creatorIds = null) {
  const { data: job } = await supabase
    .from('fetch_jobs')
    .insert({ status: 'running' })
    .select()
    .single();

  let creatorsCount = 0;
  let reelsCount = 0;

  try {
    let query = supabase.from('creators').select('*');
    if (creatorIds) query = query.in('id', creatorIds);
    const { data: creators, error } = await query;
    if (error) throw error;

    const MAX_CONCURRENT = 6;
    const queue = [...creators];
    const inFlight = new Set();

    const runOne = async (creator) => {
      try {
        const result = await fetchCreatorReels(creator, 30);

        const updates = {
          last_fetched_at: new Date().toISOString(),
          status: result.status,
          status_checked_at: new Date().toISOString(),
          status_error: result.error || null,
        };

        // If HikerAPI gave us a fresh profile pic, persist it to Supabase Storage
        // so we don't depend on Instagram's CDN URLs (which expire).
        if (result.profilePic) {
          const persisted = await persistProfilePic(creator.id, result.profilePic);
          updates.profile_pic_url = persisted || result.profilePic; // fallback to IG URL if upload failed
        }

        if (result.instagramPk && result.instagramPk !== creator.instagram_pk) updates.instagram_pk = result.instagramPk;
        if (result.fullName && !creator.display_name) updates.display_name = result.fullName;
        if (result.followerCount != null) updates.follower_count = result.followerCount;

        await supabase.from('creators').update(updates).eq('id', creator.id);

        if (result.items.length > 0) {
          const stored = await storeReels(creator, result.items);
          await updateCreatorAvgViews(creator.id);
          await computeOutlierScores(creator.id);
          reelsCount += stored;
        }
        creatorsCount++;
      } catch (err) {
        console.error(`[FetchService] Error for @${creator.username}:`, err.message);
        await supabase
          .from('creators')
          .update({
            status: 'error',
            status_checked_at: new Date().toISOString(),
            status_error: err.message,
          })
          .eq('id', creator.id);
      }
    };

    await new Promise((resolve) => {
      const launchNext = () => {
        while (inFlight.size < MAX_CONCURRENT && queue.length > 0) {
          const creator = queue.shift();
          const p = runOne(creator).then(() => {
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

    await supabase
      .from('fetch_jobs')
      .update({
        status: 'done',
        finished_at: new Date().toISOString(),
        creators_fetched: creatorsCount,
        reels_found: reelsCount,
      })
      .eq('id', job.id);

    return { creatorsCount, reelsCount };
  } catch (err) {
    await supabase
      .from('fetch_jobs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), error: err.message })
      .eq('id', job.id);
    throw err;
  }
}

// ---------- Persistence helpers ----------

async function storeReels(creator, rawReels) {
  if (!rawReels || rawReels.length === 0) return 0;

  const reels = rawReels.map((r) => {
    let postedAt;
    if (r.taken_at_ts) {
      postedAt = new Date(r.taken_at_ts * 1000).toISOString();
    } else if (r.taken_at) {
      postedAt = new Date(r.taken_at).toISOString();
    } else {
      postedAt = new Date().toISOString();
    }

    const shortCode = r.code;
    return {
      creator_id: creator.id,
      instagram_id: r.id || r.pk?.toString() || shortCode,
      url: `https://www.instagram.com/reel/${shortCode}/`,
      thumbnail_url: r.thumbnail_url || null,
      caption: (r.caption_text || '').substring(0, 500) || null,
      views: r.play_count || 0,
      likes: r.like_count || 0,
      comments: r.comment_count || 0,
      duration_seconds: r.video_duration ? Math.round(r.video_duration) : null,
      posted_at: postedAt,
    };
  });

  if (reels.length === 0) return 0;

  const { error } = await supabase
    .from('reels')
    .upsert(reels, { onConflict: 'instagram_id', ignoreDuplicates: false });

  if (error) console.error('[storeReels] Upsert error:', error.message);
  else console.log(`[storeReels] Saved ${reels.length} reels for @${creator.username}`);
  return reels.length;
}

async function updateCreatorAvgViews(creatorId) {
  const { data: reels } = await supabase
    .from('reels')
    .select('views')
    .eq('creator_id', creatorId)
    .order('posted_at', { ascending: false })
    .limit(30);

  if (!reels || reels.length === 0) return;
  const avg = reels.reduce((sum, r) => sum + (r.views || 0), 0) / reels.length;
  await supabase
    .from('creators')
    .update({ avg_views_30d: Math.round(avg) })
    .eq('id', creatorId);
}

async function computeOutlierScores(creatorId) {
  const { data: creator } = await supabase
    .from('creators')
    .select('avg_views_30d')
    .eq('id', creatorId)
    .single();

  if (!creator) return;
  const avg = creator.avg_views_30d || 0;

  const { data: reels } = await supabase
    .from('reels')
    .select('id, views')
    .eq('creator_id', creatorId);

  if (!reels || reels.length === 0) return;

  const scores = reels.map((r) => ({
    reel_id: r.id,
    creator_id: creatorId,
    outlier_score: avg > 0 ? parseFloat(((r.views || 0) / avg).toFixed(4)) : 0,
    views_at_score: r.views || 0,
    creator_avg_views: avg,
    computed_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('reel_scores')
    .upsert(scores, { onConflict: 'reel_id', ignoreDuplicates: false });
  if (error) console.error(`[computeOutlierScores] Upsert error:`, error.message);

  await Promise.all(
    scores.map((s) =>
      supabase
        .from('reels')
        .update({ outlier_score: s.outlier_score, creator_avg_views: s.creator_avg_views })
        .eq('id', s.reel_id)
    )
  );
  console.log(`[computeOutlierScores] Wrote ${scores.length} scores for creator ${creatorId} (avg=${avg})`);
}

module.exports = { runDailyFetch, fetchCreatorReels, computeOutlierScores };
