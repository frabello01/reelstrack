const { ApifyClient } = require('apify-client');
const supabase = require('../lib/supabase');

const apify = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

// Apify actor for Instagram Reels
const ACTOR_ID = 'apify/instagram-reel-scraper';

/**
 * Fetch reels for a single creator via Apify
 */
async function fetchCreatorReels(username, daysBack = 30) {
  console.log(`[Apify] Fetching reels for @${username}, last ${daysBack} days`);

  const run = await apify.actor(ACTOR_ID).call({
    directUrls: [`https://www.instagram.com/${username}/`],
    resultsLimit: 50,
    proxy: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
    },
  });

  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  console.log(`[Apify] Got ${items.length} items for @${username}`);
  return items;
}

/**
 * Main daily fetch: loops all tracked creators, stores reels, computes scores
 */
async function runDailyFetch(creatorIds = null) {
  // Create fetch job log
  const { data: job } = await supabase
    .from('fetch_jobs')
    .insert({ status: 'running' })
    .select()
    .single();

  let creatorsCount = 0;
  let reelsCount = 0;

  try {
    // Get creators to fetch (all or specific ones)
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

        // Update last_fetched_at
        await supabase
          .from('creators')
          .update({ last_fetched_at: new Date().toISOString() })
          .eq('id', creator.id);
      } catch (err) {
        console.error(`[FetchService] Error for @${creator.username}:`, err.message);
      }
    }

    // Mark job done
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

/**
 * Store/upsert reels for a creator
 */
async function storeReels(creator, rawReels) {
  if (!rawReels || rawReels.length === 0) return 0;

  // Debug: log the first item so we can see the actual field names
  console.log('[storeReels] Sample keys:', Object.keys(rawReels[0] || {}).join(', '));
  console.log('[storeReels] Sample:', JSON.stringify(rawReels[0]).substring(0, 600));

  const reels = rawReels
    .filter((r) => true) // accept all items
    .map((r) => {
      // Handle timestamp: could be unix seconds, unix ms, or ISO string
      let postedAt;
      const ts = r.timestamp || r.takenAtTimestamp || r.postedAt || r.taken_at;
      if (ts) {
        if (typeof ts === 'string') {
          postedAt = new Date(ts).toISOString();
        } else if (ts > 1e12) {
          postedAt = new Date(ts).toISOString(); // milliseconds
        } else {
          postedAt = new Date(ts * 1000).toISOString(); // seconds
        }
      } else {
        postedAt = new Date().toISOString();
      }

      const shortCode = r.shortCode || r.shortcode || r.code || r.id;
      return {
        creator_id: creator.id,
        instagram_id: r.id || shortCode,
        url: r.url || r.link || `https://www.instagram.com/reel/${shortCode}/`,
        thumbnail_url: r.displayUrl || r.thumbnailUrl || r.thumbnail || r.previewUrl || null,
        caption: (r.caption || r.text || r.description || '').substring(0, 500) || null,
        views: r.videoPlayCount || r.videoViewCount || r.playsCount || r.viewsCount || r.plays || r.views || 0,
        likes: r.likesCount || r.likes || r.likeCount || 0,
        comments: r.commentsCount || r.comments || r.commentCount || 0,
        duration_seconds: r.videoDuration || r.duration || null,
        posted_at: postedAt,
      };
    });

  if (reels.length === 0) return 0;

  const { error } = await supabase
    .from('reels')
    .upsert(reels, { onConflict: 'instagram_id', ignoreDuplicates: false });

  if (error) console.error('[storeReels] Upsert error:', error.message);
  return reels.length;
}

/**
 * Compute and update avg views for a creator (based on last 30 reels)
 */
async function updateCreatorAvgViews(creatorId) {
  const { data: reels } = await supabase
    .from('reels')
    .select('views')
    .eq('creator_id', creatorId)
    .order('posted_at', { ascending: false })
    .limit(30);

  if (!reels || reels.length === 0) return;

  const avg = reels.reduce((sum, r) => sum + r.views, 0) / reels.length;

  await supabase
    .from('creators')
    .update({ avg_views_30d: Math.round(avg) })
    .eq('id', creatorId);
}

/**
 * Compute outlier scores for all reels of a creator
 */
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
    outlier_score: parseFloat((r.views / creator.avg_views_30d).toFixed(4)),
    views_at_score: r.views,
    creator_avg_views: creator.avg_views_30d,
    computed_at: new Date().toISOString(),
  }));

  await supabase
    .from('reel_scores')
    .upsert(scores, { onConflict: 'reel_id', ignoreDuplicates: false });
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

module.exports = { runDailyFetch, fetchCreatorReels, computeOutlierScores };
