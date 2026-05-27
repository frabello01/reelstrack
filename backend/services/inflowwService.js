const supabase = require('../lib/supabase');

const INFLOWW_BASE = 'https://openapi.infloww.com/v1';
const API_KEY = process.env.INFLOWW_API_KEY;
const OID = process.env.INFLOWW_OID;

if (!API_KEY || !OID) {
  console.warn('[inflowwService] WARNING: INFLOWW_API_KEY or INFLOWW_OID env vars not set. Syncs will fail.');
}

// ----- low-level fetch ----------------------------------------------

async function inflowwGet(path, params = {}) {
  const url = new URL(`${INFLOWW_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': API_KEY,
      'x-oid': OID,
      'Accept': 'application/json',
      // Their Cloudflare WAF rejects requests with no User-Agent
      'User-Agent': 'reelstrack-server/1.0',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Infloww ${res.status} on ${path}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ----- sync a single creator ----------------------------------------

// Pulls every TRACKING link for a creator across pagination + a wide
// time window, then upserts each one and inserts a snapshot row keyed
// on today's date.
async function syncCreator(talentId, inflowwCreatorId) {
  if (!inflowwCreatorId) throw new Error('inflowwCreatorId is required');

  // Wide window — Infloww defaults to last 3 days otherwise. We want
  // historical links too, so anchor to ~2 years back. Their API uses
  // ms timestamps OR ISO 8601 — ISO is safer.
  const endTime = new Date().toISOString();
  const startTime = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();

  const allLinks = [];
  let cursor = null;
  let pages = 0;
  const MAX_PAGES = 30;

  do {
    const params = {
      linkType: 'TRACKING',
      creatorId: inflowwCreatorId,
      limit: 100,
      startTime,
      endTime,
    };
    if (cursor) params.cursor = cursor;
    const payload = await inflowwGet('/links', params);
    const list = payload?.data?.list || [];
    allLinks.push(...list);
    cursor = payload?.hasMore ? payload?.cursor : null;
    pages++;
  } while (cursor && pages < MAX_PAGES);

  // Upsert each link + write a snapshot row.
  const today = new Date().toISOString().slice(0, 10);
  let upserted = 0;

  for (const link of allLinks) {
    const row = mapLinkToRow(link, talentId);
    const { error } = await supabase
      .from('infloww_tracking_links')
      .upsert(row, { onConflict: 'infloww_link_id', ignoreDuplicates: false });
    if (error) {
      console.warn(`[infloww] upsert fail for link ${link.id}: ${error.message}`);
      continue;
    }

    // Snapshot — unique on (infloww_link_id, snapshot_date). Same
    // cents→dollars conversion as mapLinkToRow so the snapshot table
    // and the latest-state table stay consistent.
    await supabase
      .from('infloww_tracking_link_snapshots')
      .upsert({
        infloww_link_id: link.id.toString(),
        snapshot_date: today,
        click_count: parseInt(link.clickCount || 0),
        sub_count: parseInt(link.subCount || 0),
        paying_fans_count: parseInt(link.payingFansCount || 0),
        earnings_gross: parseFloat(link.earningsGross || 0) / 100,
        earnings_net: parseFloat(link.earningsNet || 0) / 100,
        subscription_cvr: parseFloat(link.subscriptionCVR || 0),
      }, { onConflict: 'infloww_link_id,snapshot_date', ignoreDuplicates: false });
    upserted++;
  }

  return { pages, fetched: allLinks.length, upserted };
}

function mapLinkToRow(link, talentId) {
  const toDate = (ms) => {
    if (!ms) return null;
    const n = typeof ms === 'string' ? parseInt(ms) : ms;
    if (Number.isNaN(n) || !n) return null;
    return new Date(n).toISOString();
  };
  // Infloww returns money values in CENTS (e.g. 11672 = $116.72).
  // We store dollars so the rest of the app can use raw values.
  const cents = (v) => parseFloat(v || 0) / 100;
  return {
    infloww_link_id: link.id.toString(),
    talent_id: talentId,
    name: link.name || null,
    code: link.code || null,
    source: link.source || null,
    tag_names: Array.isArray(link.relTagNames) ? link.relTagNames : null,
    click_count: parseInt(link.clickCount || 0),
    sub_count: parseInt(link.subCount || 0),
    paying_fans_count: parseInt(link.payingFansCount || 0),
    earnings_gross: cents(link.earningsGross),
    earnings_net: cents(link.earningsNet),
    subscription_cvr: parseFloat(link.subscriptionCVR || 0),
    spending_cvr: parseFloat(link.spendingCVR || 0),
    epc_gross: cents(link.epcGross),
    epc_net: cents(link.epcNet),
    currency: link.currency || 'USD',
    finished: !!link.finishedFlag,
    created_at_infloww: toDate(link.createdTime),
    expired_at_infloww: toDate(link.expiredTime),
    updated_at_infloww: toDate(link.updatedTime),
    last_synced_at: new Date().toISOString(),
  };
}

// ----- sync all talents that have an Infloww binding -----------------

async function syncAllTalents() {
  const { data: talents, error } = await supabase
    .from('talents')
    .select('id, name, infloww_creator_id')
    .not('infloww_creator_id', 'is', null);
  if (error) throw error;

  const results = [];
  for (const t of talents || []) {
    try {
      const r = await syncCreator(t.id, t.infloww_creator_id);
      results.push({ talent: t.name, ...r });
      console.log(`[infloww] synced ${t.name}: ${r.upserted} link(s)`);
    } catch (err) {
      console.error(`[infloww] sync failed for ${t.name}: ${err.message}`);
      results.push({ talent: t.name, error: err.message });
    }
  }
  return results;
}

module.exports = { syncCreator, syncAllTalents, inflowwGet };
