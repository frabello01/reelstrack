const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { uploadImageDataUrl } = require('../lib/imageUpload');
const { encodeUrl } = require('../lib/linkCipher');
const { italyDateOf, italyLastNDates, italyPeriodStartIso } = require('../lib/dateUtils');
const { geoLookup } = require('../lib/geoLookup');
const linkJwt = require('../lib/linkJwt');

// The hostname we hand out for bot-protected landings. Configurable so we
// can swap the sacrificial domain without a deploy if it ever gets blocked.
const REDIRECTOR_HOST = process.env.REDIRECTOR_HOST || 'parrocchiasanbasilio.com';

// Classify the visitor's traffic source based on Meta-UA detection +
// referrer host + UTM tag (if provided). First non-empty wins.
function classifySource({ metaPlatform, referrerHost, utmSource }) {
  if (utmSource) return String(utmSource).toLowerCase().slice(0, 40);
  if (metaPlatform) return metaPlatform;          // 'instagram'|'threads'|'facebook'
  if (!referrerHost) return 'direct';
  const h = referrerHost.toLowerCase();
  if (h.includes('instagram.com'))                return 'instagram';
  if (h.includes('threads.net') || h.includes('threads.com')) return 'threads';
  if (h.includes('facebook.com') || h.includes('fb.com')) return 'facebook';
  if (h.includes('twitter.com') || h.includes('x.com'))    return 'twitter';
  if (h.includes('tiktok.com'))                   return 'tiktok';
  if (h.includes('reddit.com'))                   return 'reddit';
  if (h.includes('telegram.org') || h.includes('t.me'))    return 'telegram';
  if (h.includes('youtube.com') || h.includes('youtu.be')) return 'youtube';
  if (h.includes('google.'))                      return 'google';
  if (h.includes('bing.com'))                     return 'bing';
  if (h.includes('linkedin.com'))                 return 'linkedin';
  if (h.includes('discord.com') || h.includes('discord.gg')) return 'discord';
  return 'other';
}

// Pull a normalised host from a Referer header. Returns null if absent
// or unparseable. We store only the host (no path) for privacy and
// because the host is all we need for source classification.
function referrerHostFrom(req, fallbackBody) {
  const raw = (req.headers['referer'] || req.headers['referrer'] || fallbackBody || '').toString();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

// Normalise any user-pasted hostname to a canonical form:
//   "https://www.Example.com:443/" → "example.com"
// We store and look up landings using this canonical form so the
// "with www" and "without www" variants always match the same row.
function normaliseHost(h) {
  if (!h) return null;
  const trimmed = h.toString().toLowerCase().trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    || null;
}

// ============================================================
// PUBLIC ENDPOINTS (whitelisted before the auth gate in index.js)
//   Mounted under /api/landings — the whitelist matches paths
//   that start with "/public/".
// ============================================================

// GET /api/landings/public/lookup?host=mylink.com&slug=mariorossi
// Returns the landing + its enabled links, ordered. Returns 404 if no match.
router.get('/public/lookup', async (req, res) => {
  const rawHost = (req.query.host || '').toString().toLowerCase().trim();
  const slug = (req.query.slug || '').toString().toLowerCase().trim();
  if (!slug) return res.status(400).json({ error: 'slug required' });

  const host = normaliseHost(rawHost) || '';
  const DEFAULT_HOSTS = new Set([
    'app.reelstrack.io',
    'localhost',
    '127.0.0.1',
    '',
  ]);
  const isDefaultHost = DEFAULT_HOSTS.has(host);

  let query = supabase
    .from('landings')
    .select('*, landing_links(*)')
    .eq('slug', slug)
    .eq('published', true);

  if (isDefaultHost) {
    query = query.is('host', null);
  } else {
    query = query.eq('host', host);
  }

  const { data, error } = await query.maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Landing not found' });

  // Filter + sort links server-side so the client gets exactly what it should render
  const links = (data.landing_links || [])
    .filter((l) => l.enabled)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  // Two modes for the link payload:
  //
  // (a) bot_protection_enabled = FALSE (default):
  //     URL is XOR-encoded under "u". The frontend decodes at click time
  //     and navigates directly to the destination. Same as before.
  //
  // (b) bot_protection_enabled = TRUE:
  //     URL is wrapped in a JWT and exposed as redirect_url pointing to
  //     parrocchiasanbasilio.com (the sacrificial redirector domain).
  //     The destination is NEVER shipped to the client in any decodable
  //     form. The redirector applies bot detection + 410 cloaking on its
  //     own host before doing the 302.
  let publicLinks;
  if (data.bot_protection_enabled) {
    try {
      publicLinks = links.map((l) => {
        const token = linkJwt.sign({ slug: data.slug, link_id: l.id, dest: l.url });
        const redirectUrl = `https://${REDIRECTOR_HOST}/r/${encodeURIComponent(data.slug)}?t=${token}`;
        return {
          id: l.id,
          label: l.label,
          redirect_url: redirectUrl,
          icon: l.icon,
          age_gate: l.age_gate,
          animation: l.animation || null,
        };
      });
    } catch (err) {
      // JWT signing failed (most likely REDIRECTOR_JWT_SECRET not set on
      // Render). Fall back to the legacy XOR mode so the landing keeps
      // working — better than a broken page.
      console.error('[landings] JWT signing failed, falling back to XOR:', err.message);
      publicLinks = links.map((l) => ({
        id: l.id,
        label: l.label,
        u: encodeUrl(l.url),
        icon: l.icon,
        age_gate: l.age_gate,
        animation: l.animation || null,
      }));
    }
  } else {
    publicLinks = links.map((l) => ({
      id: l.id,
      label: l.label,
      u: encodeUrl(l.url),
      icon: l.icon,
      age_gate: l.age_gate,
      animation: l.animation || null,
    }));
  }

  res.json({
    id: data.id,
    title: data.title,
    subtitle: data.subtitle,
    bio: data.bio,
    avatar_url: data.avatar_url,
    background_url: data.background_url,
    verified: data.verified,
    theme: data.theme || {},
    age_gate_default: data.age_gate_default,
    bot_protection_enabled: !!data.bot_protection_enabled,
    links: publicLinks,
  });
});

// POST /api/landings/public/click/:linkId
// Records a click. Fire-and-forget from the client. Body may include
// { meta_platform, referrer, utm_source }.
router.post('/public/click/:linkId', async (req, res) => {
  const { linkId } = req.params;
  const metaPlatform = (req.body?.meta_platform || null);
  const ua = (req.headers['user-agent'] || '').toString().slice(0, 250);
  const referrerHost = referrerHostFrom(req, req.body?.referrer);
  const utmSource = req.body?.utm_source || null;
  const geo = geoLookup(req.ip);
  const source = classifySource({ metaPlatform, referrerHost, utmSource });

  const { data: link, error: lookupErr } = await supabase
    .from('landing_links')
    .select('id, landing_id, click_count')
    .eq('id', linkId)
    .maybeSingle();
  if (lookupErr) return res.status(500).json({ error: lookupErr.message });
  if (!link) return res.status(404).json({ error: 'Link not found' });

  // Respond instantly — DB writes are best-effort.
  res.json({ ok: true });

  supabase
    .from('landing_links')
    .update({ click_count: (link.click_count || 0) + 1 })
    .eq('id', linkId)
    .then(() => {}, (e) => console.warn('[landings] click counter update failed:', e.message));

  supabase
    .from('landing_link_clicks')
    .insert({
      link_id: linkId,
      landing_id: link.landing_id,
      user_agent: ua,
      meta_platform: metaPlatform,
      ip: geo.ip_truncated,
      country_code: geo.country_code,
      country_name: geo.country_name,
      region: geo.region,
      city: geo.city,
      lat: geo.lat,
      lng: geo.lng,
      timezone: geo.timezone,
      referrer_host: referrerHost,
      source_kind: source,
    })
    .then(() => {}, (e) => console.warn('[landings] click row insert failed:', e.message));
});

// POST /api/landings/public/view/:landingId
// Page-view ping. Fired by the public landing page once on mount.
// Body: { referrer?, meta_platform?, utm_source?, utm_medium?, utm_campaign? }
router.post('/public/view/:landingId', async (req, res) => {
  const { landingId } = req.params;
  const metaPlatform = req.body?.meta_platform || null;
  const referrerHost = referrerHostFrom(req, req.body?.referrer);
  const utmSource = req.body?.utm_source || null;
  const utmMedium = req.body?.utm_medium || null;
  const utmCampaign = req.body?.utm_campaign || null;
  const ua = (req.headers['user-agent'] || '').toString().slice(0, 250);
  const geo = geoLookup(req.ip);
  const source = classifySource({ metaPlatform, referrerHost, utmSource });

  // Respond instantly — DB writes are best-effort.
  res.json({ ok: true });

  supabase
    .from('landing_page_views')
    .insert({
      landing_id: landingId,
      user_agent: ua,
      referrer_host: referrerHost,
      source_kind: source,
      meta_platform: metaPlatform,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      ip: geo.ip_truncated,
      country_code: geo.country_code,
      country_name: geo.country_name,
      region: geo.region,
      city: geo.city,
      lat: geo.lat,
      lng: geo.lng,
      timezone: geo.timezone,
    })
    .then(() => {}, (e) => console.warn('[landings] page view insert failed:', e.message));
});

// ============================================================
// AUTHENTICATED ENDPOINTS (admin-only via the existing auth gate)
// ============================================================

// GET /api/landings/analytics/overview?period=day|week|month&talent_id=&landing_id=
// One-shot aggregation for the live dashboard. Returns everything the
// page needs (totals, hourly/daily series, by-source, by-country, top
// landings, recent feed, active-now). Designed to be refreshed every
// ~60s; the live feed comes via Supabase Realtime instead.
router.get('/analytics/overview', async (req, res) => {
  const period = String(req.query.period || 'day').toLowerCase();
  const talentFilter = req.query.talent_id || null;
  const landingFilter = req.query.landing_id || null;

  // Resolve period window in Italy local time
  const { italyDate, italyDateNDaysAgo } = require('../lib/dateUtils');
  let sinceDateStr, granularity;
  if (period === 'month') {
    const [y, m] = italyDate().split('-').map(Number);
    sinceDateStr = `${y}-${String(m).padStart(2, '0')}-01`;
    granularity = 'day';
  } else if (period === 'week') {
    sinceDateStr = italyDateNDaysAgo(6);   // today + 6 prior = 7 days
    granularity = 'day';
  } else {
    sinceDateStr = italyDate();             // today only
    granularity = 'hour';
  }
  const sinceIso = `${sinceDateStr}T00:00:00+00:00`;

  // Resolve the candidate landing IDs (for optional filters)
  let landingIds = null;
  if (landingFilter) {
    landingIds = [landingFilter];
  } else if (talentFilter) {
    const { data: lrows } = await supabase
      .from('landings')
      .select('id')
      .eq('talent_id', talentFilter);
    landingIds = (lrows || []).map((x) => x.id);
    if (landingIds.length === 0) {
      // No landings → return empty payload
      return res.json(emptyOverview(period, sinceDateStr, granularity));
    }
  }

  let clicksQ = supabase
    .from('landing_link_clicks')
    .select('clicked_at, landing_id, source_kind, country_code, country_name, city, link_id')
    .gte('clicked_at', sinceIso);
  if (landingIds) clicksQ = clicksQ.in('landing_id', landingIds);

  let viewsQ = supabase
    .from('landing_page_views')
    .select('viewed_at, landing_id, source_kind, country_code')
    .gte('viewed_at', sinceIso);
  if (landingIds) viewsQ = viewsQ.in('landing_id', landingIds);

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  let liveQ = supabase
    .from('landing_link_clicks')
    .select('clicked_at, landing_id, link_id, source_kind, country_code, country_name, city')
    .gte('clicked_at', fiveMinAgo)
    .order('clicked_at', { ascending: false })
    .limit(50);
  if (landingIds) liveQ = liveQ.in('landing_id', landingIds);

  const [{ data: clicks, error: clicksErr },
         { data: views },
         { data: liveClicks }] = await Promise.all([clicksQ, viewsQ, liveQ]);
  if (clicksErr) return res.status(500).json({ error: clicksErr.message });

  // ----- Subs in window (from Infloww snapshots) -----
  // Sum per-day sub_count deltas across every Infloww link bound to a
  // landing_link of these landings. Uses the same shift-by-one-day
  // convention as the activity table elsewhere.
  const subsByLanding = await computeSubsForLandings({
    landingIds: landingIds || null,
    sinceDateStr,
  });

  // Resolve landing/link names for display (only for the IDs we touched)
  const touchedLandingIds = new Set([
    ...(clicks || []).map((c) => c.landing_id),
    ...(views || []).map((v) => v.landing_id),
    ...(liveClicks || []).map((c) => c.landing_id),
  ]);
  const touchedLinkIds = new Set([
    ...(clicks || []).map((c) => c.link_id).filter(Boolean),
    ...(liveClicks || []).map((c) => c.link_id).filter(Boolean),
  ]);
  const { data: landingsMeta } = touchedLandingIds.size > 0
    ? await supabase
        .from('landings')
        .select('id, title, slug, host, talents(id, name), my_accounts(id, username)')
        .in('id', [...touchedLandingIds])
    : { data: [] };
  const { data: linksMeta } = touchedLinkIds.size > 0
    ? await supabase.from('landing_links').select('id, label').in('id', [...touchedLinkIds])
    : { data: [] };
  const landingById = new Map((landingsMeta || []).map((l) => [l.id, l]));
  const linkById = new Map((linksMeta || []).map((l) => [l.id, l]));

  // ----- Aggregations -----
  const totalsByLanding = new Map();
  for (const c of clicks || []) {
    totalsByLanding.set(c.landing_id, (totalsByLanding.get(c.landing_id) || 0) + 1);
  }
  const totalsByLandingView = new Map();
  for (const v of views || []) {
    totalsByLandingView.set(v.landing_id, (totalsByLandingView.get(v.landing_id) || 0) + 1);
  }

  const bySource = new Map();
  for (const c of clicks || []) {
    const k = c.source_kind || 'other';
    bySource.set(k, (bySource.get(k) || 0) + 1);
  }

  const byCountry = new Map();
  for (const c of clicks || []) {
    if (!c.country_code) continue;
    const key = c.country_code;
    if (!byCountry.has(key)) byCountry.set(key, { code: key, name: c.country_name || key, count: 0 });
    byCountry.get(key).count++;
  }

  // Time series buckets (Italy local)
  const series = [];
  if (granularity === 'hour') {
    for (let h = 0; h < 24; h++) series.push({ bucket: String(h).padStart(2, '0'), count: 0 });
    for (const c of clicks || []) {
      const d = new Date(c.clicked_at);
      // Convert UTC instant → Italy hour
      const h = parseInt(d.toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }), 10);
      if (!Number.isNaN(h)) series[h].count++;
    }
  } else {
    // Daily buckets in Italy date
    const days = [];
    const start = new Date(sinceDateStr);
    const today = new Date(italyDate());
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }
    const dayMap = Object.fromEntries(days.map((d) => [d, 0]));
    for (const c of clicks || []) {
      const day = new Date(c.clicked_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
      if (day in dayMap) dayMap[day]++;
    }
    for (const d of days) series.push({ bucket: d, count: dayMap[d] });
  }

  // Top landings (sorted by clicks desc)
  const topLandings = [...totalsByLanding.entries()]
    .map(([id, clickCount]) => {
      const meta = landingById.get(id);
      const viewCount = totalsByLandingView.get(id) || 0;
      return {
        landing_id: id,
        title: meta?.title || '(unknown)',
        slug: meta?.slug,
        host: meta?.host,
        talent_name: meta?.talents?.name || null,
        ig_username: meta?.my_accounts?.username || null,
        clicks: clickCount,
        views: viewCount,
        subs: subsByLanding.perLanding.get(id) || 0,
        ctr: viewCount > 0 ? (clickCount / viewCount) * 100 : null,
      };
    })
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20);

  const totalClicks = (clicks || []).length;
  const totalViews = (views || []).length;
  const blendedCtr = totalViews > 0 ? (totalClicks / totalViews) * 100 : null;

  // Recent feed (last 5 min, hydrated with landing/link/source labels)
  const liveFeed = (liveClicks || []).map((c) => {
    const meta = landingById.get(c.landing_id);
    const link = linkById.get(c.link_id);
    return {
      clicked_at: c.clicked_at,
      landing_id: c.landing_id,
      landing_title: meta?.title || '(unknown)',
      link_label: link?.label || null,
      source_kind: c.source_kind,
      country_code: c.country_code,
      country_name: c.country_name,
      city: c.city,
    };
  });
  const activeNow = liveFeed.length;

  res.json({
    period,
    granularity,
    start_date: sinceDateStr,
    totals: {
      clicks: totalClicks,
      views: totalViews,
      subs: subsByLanding.total,
      ctr: blendedCtr,
      active_now: activeNow,
    },
    series,
    by_source: [...bySource.entries()].map(([source_kind, count]) => ({ source_kind, count })).sort((a, b) => b.count - a.count),
    by_country: [...byCountry.values()].sort((a, b) => b.count - a.count).slice(0, 20),
    top_landings: topLandings,
    live_feed: liveFeed,
  });
});

function emptyOverview(period, sinceDateStr, granularity) {
  return {
    period, granularity, start_date: sinceDateStr,
    totals: { clicks: 0, views: 0, subs: 0, ctr: null, active_now: 0 },
    series: [], by_source: [], by_country: [],
    top_landings: [], live_feed: [],
  };
}

// Sums Infloww sub-count deltas inside [sinceDateStr, today] across every
// Infloww link bound to a landing_link of the given landings. Returns
// { perLanding: Map<landing_id, subs>, total }.
//
// Uses the "next-day minus this-day" delta convention used elsewhere in
// the app: subs gained DURING day D = snapshot[D+1] - snapshot[D]. We
// fetch one extra day before the window so the first reporting day has
// a usable "start" snapshot too.
async function computeSubsForLandings({ landingIds, sinceDateStr }) {
  const empty = { perLanding: new Map(), total: 0 };

  // 1) Find landing_links for these landings (or all landings if no filter)
  let llq = supabase.from('landing_links').select('id, landing_id');
  if (landingIds) llq = llq.in('landing_id', landingIds);
  const { data: lLinks } = await llq;
  if (!lLinks || lLinks.length === 0) return empty;

  // 2) Find Infloww links bound to those landing_links
  const linkIds = lLinks.map((x) => x.id);
  const { data: inflowwLinks } = await supabase
    .from('infloww_tracking_links')
    .select('infloww_link_id, landing_link_id')
    .in('landing_link_id', linkIds);
  if (!inflowwLinks || inflowwLinks.length === 0) return empty;

  // 3) Map infloww_link_id → landing_id
  const landingByLandingLink = new Map(lLinks.map((x) => [x.id, x.landing_id]));
  const landingByInflowwLink = new Map();
  for (const il of inflowwLinks) {
    const lid = landingByLandingLink.get(il.landing_link_id);
    if (lid) landingByInflowwLink.set(il.infloww_link_id, lid);
  }

  // 4) Pull snapshots from one day before sinceDateStr (so the first day
  // of the window has a "start" snapshot to delta against).
  const inflowwIds = inflowwLinks.map((x) => x.infloww_link_id);
  const sinceMinusOne = (() => {
    const d = new Date(sinceDateStr);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const { data: snaps } = await supabase
    .from('infloww_tracking_link_snapshots')
    .select('infloww_link_id, snapshot_date, sub_count')
    .in('infloww_link_id', inflowwIds)
    .gte('snapshot_date', sinceMinusOne)
    .order('snapshot_date', { ascending: true });
  if (!snaps || snaps.length === 0) return empty;

  // 5) For each Infloww link, walk consecutive snapshots and sum deltas
  // for pairs whose START date is inside the window.
  const byLink = new Map();
  for (const s of snaps) {
    if (!byLink.has(s.infloww_link_id)) byLink.set(s.infloww_link_id, []);
    byLink.get(s.infloww_link_id).push(s);
  }

  const perLanding = new Map();
  let total = 0;
  for (const [inflowwId, rows] of byLink.entries()) {
    if (rows.length < 2) continue;
    let linkDelta = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const startDay = rows[i].snapshot_date;
      if (startDay < sinceDateStr) continue;       // outside window
      const d = Number(rows[i + 1].sub_count || 0) - Number(rows[i].sub_count || 0);
      if (d > 0) linkDelta += d;                   // ignore downward corrections
    }
    if (linkDelta === 0) continue;
    const landingId = landingByInflowwLink.get(inflowwId);
    if (!landingId) continue;
    perLanding.set(landingId, (perLanding.get(landingId) || 0) + linkDelta);
    total += linkDelta;
  }
  return { perLanding, total };
}

// GET /api/landings — all landings, with link count and talent + IG profile joins
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('landings')
    .select('*, talents(id, name, profile_pic_url), my_accounts(id, username, profile_pic_url), landing_links(count)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/landings/:id — full detail including links
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('landings')
    .select('*, talents(id, name, profile_pic_url), my_accounts(id, username, profile_pic_url), landing_links(*)')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Landing not found' });
  // sort links by sort_order asc
  data.landing_links = (data.landing_links || []).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  res.json(data);
});

// POST /api/landings — create. Body: { talent_id, slug, title, ... }
router.post('/', async (req, res) => {
  const body = req.body || {};
  const slug = (body.slug || '').toString().toLowerCase().trim();
  const title = (body.title || '').toString().trim();
  if (!slug || !title) return res.status(400).json({ error: 'slug and title are required' });
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
    return res.status(400).json({ error: 'slug must be lowercase letters, digits, -, _' });
  }

  const insert = {
    talent_id: body.talent_id || null,
    my_account_id: body.my_account_id || null,
    host: normaliseHost(body.host),
    slug,
    title,
    subtitle: body.subtitle || null,
    bio: body.bio || null,
    avatar_url: body.avatar_url || null,
    background_url: body.background_url || null,
    verified: !!body.verified,
    theme: body.theme || {},
    published: body.published !== false,
    age_gate_default: !!body.age_gate_default,
  };

  const { data, error } = await supabase
    .from('landings')
    .insert(insert)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A landing with this slug already exists on this host' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// PATCH /api/landings/:id — partial update
router.patch('/:id', async (req, res) => {
  const allowed = ['talent_id', 'my_account_id', 'host', 'slug', 'title', 'subtitle', 'bio', 'avatar_url',
    'background_url', 'verified', 'theme', 'published', 'age_gate_default', 'bot_protection_enabled'];
  const updates = {};
  for (const k of allowed) {
    if (k in (req.body || {})) updates[k] = req.body[k];
  }
  if (updates.slug !== undefined) {
    const s = updates.slug.toString().toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(s)) {
      return res.status(400).json({ error: 'slug must be lowercase letters, digits, -, _' });
    }
    updates.slug = s;
  }
  if (updates.host !== undefined) {
    updates.host = normaliseHost(updates.host);
  }
  // Coerce empty strings to null for nullable FKs
  if (updates.talent_id === '') updates.talent_id = null;
  if (updates.my_account_id === '') updates.my_account_id = null;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('landings')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A landing with this slug already exists on this host' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// DELETE /api/landings/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('landings').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Cache-buster appended to the stored URL on every (re)upload.
// Same Supabase storage path is reused (upsert overwrites the file),
// so without this the URL would be identical across uploads and the
// browser would serve the stale image for 1 week (cacheControl).
// Public visitors still benefit from the long cache because the URL
// only changes when the admin re-uploads.
function withCacheBuster(url) {
  if (!url) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${Date.now()}`;
}

// POST /api/landings/:id/avatar  →  body { image_data_url }
router.post('/:id/avatar', async (req, res) => {
  const { image_data_url } = req.body || {};
  if (!image_data_url) return res.status(400).json({ error: 'image_data_url required' });
  try {
    const url = await uploadImageDataUrl(image_data_url, `landings/${req.params.id}-avatar`);
    const { data, error } = await supabase
      .from('landings')
      .update({ avatar_url: withCacheBuster(url), updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/landings/:id/background  →  body { image_data_url }
router.post('/:id/background', async (req, res) => {
  const { image_data_url } = req.body || {};
  if (!image_data_url) return res.status(400).json({ error: 'image_data_url required' });
  try {
    const url = await uploadImageDataUrl(image_data_url, `landings/${req.params.id}-bg`);
    const { data, error } = await supabase
      .from('landings')
      .update({ background_url: withCacheBuster(url), updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ----- Links sub-resource -----------------------------------

// POST /api/landings/:id/links — create
router.post('/:id/links', async (req, res) => {
  const { label, url, icon, age_gate, animation } = req.body || {};
  if (!label || !url) return res.status(400).json({ error: 'label and url required' });

  // Place at the end: sort_order = max(existing) + 1
  const { data: existing } = await supabase
    .from('landing_links')
    .select('sort_order')
    .eq('landing_id', req.params.id)
    .order('sort_order', { ascending: false })
    .limit(1);
  const nextSort = ((existing?.[0]?.sort_order ?? -1) + 1);

  const { data, error } = await supabase
    .from('landing_links')
    .insert({
      landing_id: req.params.id,
      label,
      url,
      icon: icon || null,
      age_gate: !!age_gate,
      animation: animation || null,
      enabled: true,
      sort_order: nextSort,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/landings/links/:linkId
router.patch('/links/:linkId', async (req, res) => {
  const allowed = ['label', 'url', 'icon', 'enabled', 'age_gate', 'sort_order', 'animation'];
  const updates = {};
  for (const k of allowed) {
    if (k in (req.body || {})) updates[k] = req.body[k];
  }
  const { data, error } = await supabase
    .from('landing_links')
    .update(updates)
    .eq('id', req.params.linkId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/landings/links/:linkId
router.delete('/links/:linkId', async (req, res) => {
  const { error } = await supabase.from('landing_links').delete().eq('id', req.params.linkId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/landings/:id/links/reorder
// Body: { ordered_ids: [linkId, linkId, ...] }
router.post('/:id/links/reorder', async (req, res) => {
  const ids = Array.isArray(req.body?.ordered_ids) ? req.body.ordered_ids : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ordered_ids required' });

  // Run updates sequentially (small N — usually <30 links per landing)
  for (let i = 0; i < ids.length; i++) {
    await supabase
      .from('landing_links')
      .update({ sort_order: i })
      .eq('id', ids[i])
      .eq('landing_id', req.params.id);
  }
  res.json({ success: true });
});

// ----- Analytics --------------------------------------------

// GET /api/landings/:id/analytics?days=30
// Returns lifetime totals per link + a daily series for the chart.
router.get('/:id/analytics', async (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days || '30', 10)));

  const [{ data: links }, { data: clicks }] = await Promise.all([
    supabase
      .from('landing_links')
      .select('id, label, click_count, enabled, sort_order')
      .eq('landing_id', req.params.id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('landing_link_clicks')
      .select('link_id, clicked_at')
      .eq('landing_id', req.params.id)
      .gte('clicked_at', italyPeriodStartIso(days)),
  ]);

  // Day-bucketed series for the chart, keyed by Italy calendar dates.
  const series = {};
  italyLastNDates(days).forEach((d) => { series[d] = 0; });
  for (const c of clicks || []) {
    const k = italyDateOf(c.clicked_at);
    if (k in series) series[k]++;
  }
  const timeline = Object.entries(series).map(([date, count]) => ({ date, count }));

  const totalInWindow = (clicks || []).length;
  const totalLifetime = (links || []).reduce((s, l) => s + (l.click_count || 0), 0);

  res.json({
    days,
    total_lifetime: totalLifetime,
    total_in_window: totalInWindow,
    timeline,
    links: (links || []).map((l) => ({
      id: l.id,
      label: l.label,
      enabled: l.enabled,
      click_count_lifetime: l.click_count || 0,
      click_count_window: (clicks || []).filter((c) => c.link_id === l.id).length,
    })),
  });
});

module.exports = router;
