const { ApifyClient } = require('apify-client');
const supabase = require('../lib/supabase');

const apify = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

const ACTOR_ID = 'hpix/ig-reels-scraper';

async function fetchCreatorReels(username, daysBack = 30) {
  console.log(`[Apify] Fetching reels for @${username}, last ${daysBack} days`);
  const run = await apify.actor(ACTOR_ID).call({
    profiles: [username],
    reels_count: 50,
  });
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  console.log(`[Apify] Got ${items.length} items for @${username}`);
  return items;
}

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

    for (const creator of creators) {
      try {
        const rawReels = await fetchCreatorReels(creator.username, 30);
        const stored = await storeReels(creator, rawReels);
        await updateCreatorAvgViews(creator.id);
        await computeOutlierScores(creator.id);
        reelsCount += stored;
        creatorsCount++;
        await supabase
          .from('creators')
          .update({ last_fetched_at: new Date().toISOString() })
          .eq('id', creator.id);
      } catch (err) {
        console.error(`[FetchService] Error for @${creator.username}:`, err.message);
      }
    }

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

async function storeReels(creator, rawReels) {
  if (!rawReels || rawReels.length === 0) return 0;

  const reels = rawReels.map((r) => {
    let postedAt;
    const ts = r.taken_at_formatted || r.timestamp || r.takenAtTimestamp || r.postedAt || r.taken_at;
    if (ts) {
      postedAt = typeof ts === 'string' ? new Date(ts).toISOString()
        : ts > 1e12 ? new Date(ts).toISOString()
        : new Date(ts * 1000).toISOString();
    } else {
      postedAt = new Date().toISOString();
    }

    const shortCode = r.code || r.shortCode || r.shortcode || r.id;
    return {
      creator_id: creator.id,
      instagram_id: r.id || shortCode,
      url: r.post_url || r.url || `https://www.instagram.com/reel/${shortCode}/`,
      thumbnail_url: r.thumbnail_url || r.displayUrl || r.thumbnailUrl || null,
      caption: (r.caption || r.text || r.description || '').substring(0, 500) || null,
      views: r.play_count || r.videoPlayCount || r.videoViewCount || 0,
      likes: r.like_count || r.likesCount || r.likes || 0,
      comments: r.comment_count || r.commentsCount || r.comments || 0,
      duration_seconds: r.duration || r.videoDuration || null,
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

  if (!creator || creator.avg_views_30d === 0) return;

  const { data: reels } = await supabase
    .from('reels')
    .select('id, views')
    .eq('creator_id', creatorId);

  if (!reels || reels.length === 0) return;

  const scores = reels.map((r) => ({
    reel_id: r.id,
    creator_id: creatorId,
    outlier_score: parseFloat(((r.views || 0) / creator.avg_views_30d).toFixed(4)),
    views_at_score: r.views || 0,
    creator_avg_views: creator.avg_views_30d,
    computed_at: new Date().toISOString(),
  }));

  await supabase
    .from('reel_scores')
    .upsert(scores, { onConflict: 'reel_id', ignoreDuplicates: false });
}

module.exports = { runDailyFetch, fetchCreatorReels, computeOutlierScores };
