/*
 * Redirector router — mounted on the SACRIFICIAL DOMAIN
 * (parrocchiasanbasilio.com).
 *
 * Flow:
 *   GET /r/{slug}?t={JWT}
 *
 *   1. Bot detection (IP CIDRs + UA + canary blacklist) → 410 if bot
 *   2. JWT signature/expiry verification → 401 if invalid/expired
 *   3. Slug consistency check → 401 if mismatched
 *   4. Click recorded server-side (humans only)
 *   5. 302 to JWT.payload.dest (the real destination URL)
 *
 * The destination URL is INSIDE the signed token — no DB lookup needed
 * here. That keeps the redirector stateless and fast.
 *
 * Why 410 and not 404 for bots: 410 Gone is the HTTP status documented
 * to tell crawlers "stop probing, this resource is permanently removed".
 * Meta caches the 410 verdict and stops retrying.
 */

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const botDetect = require('../lib/botDetect');
const linkJwt = require('../lib/linkJwt');
const { geoLookup } = require('../lib/geoLookup');

// Async fire-and-forget bot_hits insert
function logBotHit({ ip, ua, kind, reason, slug, resourceId, path }) {
  const geo = geoLookup(ip);
  supabase.from('bot_hits').insert({
    resource_kind: 'redirect',
    resource_id: resourceId,
    slug,
    ip: geo.ip_truncated,
    full_ip: (ip || '').slice(0, 64),
    detection_kind: kind,
    reason,
    user_agent: (ua || '').slice(0, 500),
    path,
  }).then(() => {}, (e) => console.warn('[redirector] bot_hit insert failed:', e.message));
}

// Same source classification we use on landings, kept inline for now to
// avoid a cross-route import.
function classifySource({ metaPlatform, referrerHost }) {
  if (metaPlatform) return metaPlatform;
  if (!referrerHost) return 'direct';
  const h = referrerHost.toLowerCase();
  if (h.includes('instagram.com')) return 'instagram';
  if (h.includes('threads.net') || h.includes('threads.com')) return 'threads';
  if (h.includes('facebook.com') || h.includes('fb.com')) return 'facebook';
  if (h.includes('twitter.com') || h.includes('x.com')) return 'twitter';
  if (h.includes('tiktok.com')) return 'tiktok';
  if (h.includes('reddit.com')) return 'reddit';
  if (h.includes('telegram.org') || h.includes('t.me')) return 'telegram';
  return 'other';
}

function detectMetaPlatformFromUa(ua) {
  if (!ua) return null;
  if (/Barcelona/i.test(ua)) return 'threads';
  if (/FBAN|FBAV/i.test(ua)) return 'facebook';
  if (/Instagram/i.test(ua)) return 'instagram';
  return null;
}

router.get('/r/:slug', async (req, res) => {
  const ip = (req.ip || '').toString();
  const ua = (req.headers['user-agent'] || '').toString();
  const slug = req.params.slug;
  const token = req.query.t;

  // ---- 1) Bot detection ---------------------------------------------------
  const verdict = botDetect.detect(ip, ua);
  if (verdict) {
    logBotHit({
      ip, ua, kind: verdict.kind, reason: verdict.reason,
      slug, resourceId: null, path: req.path,
    });
    return res.status(410).end();
  }

  // ---- 2) JWT verification ------------------------------------------------
  let payload;
  try {
    payload = linkJwt.verify(token);
  } catch (err) {
    // 401 with empty body — bots and humans alike just see "unauthorized"
    return res.status(401).end();
  }

  // ---- 3) Slug consistency ------------------------------------------------
  if (!payload.slug || payload.slug !== slug) {
    return res.status(401).end();
  }
  if (!payload.dest || typeof payload.dest !== 'string') {
    return res.status(401).end();
  }

  // ---- 4) Record click (humans only) --------------------------------------
  const metaPlatform = detectMetaPlatformFromUa(ua);
  const refRaw = (req.headers['referer'] || req.headers['referrer'] || '').toString();
  let referrerHost = null;
  try { referrerHost = refRaw ? new URL(refRaw).hostname.toLowerCase() : null; } catch {}
  const source = classifySource({ metaPlatform, referrerHost });
  const geo = geoLookup(ip);

  if (payload.link_id) {
    supabase.from('landing_links')
      .select('click_count, landing_id')
      .eq('id', payload.link_id)
      .maybeSingle()
      .then(({ data: link }) => {
        if (!link) return;
        supabase.from('landing_links')
          .update({ click_count: (link.click_count || 0) + 1 })
          .eq('id', payload.link_id)
          .then(() => {}, () => {});

        supabase.from('landing_link_clicks').insert({
          link_id: payload.link_id,
          landing_id: link.landing_id,
          user_agent: ua.slice(0, 250),
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
        }).then(() => {}, () => {});
      }, () => {});
  }

  // ---- 5) Redirect --------------------------------------------------------
  // No-referrer policy: when the browser follows the 302 it should not
  // leak parrocchiasanbasilio.com (or oopsie.bio-equivalent) to the
  // destination. Same trick oopsie uses.
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.redirect(302, payload.dest);
});

// Block any request that doesn't match /r/:slug — the redirector domain
// shouldn't expose anything else. Returns a generic 404.
router.use((req, res) => {
  res.status(404).end();
});

module.exports = router;
