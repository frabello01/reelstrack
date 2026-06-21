/*
 * Honeypot canary endpoints.
 *
 * The public landing page (for landings with bot_protection_enabled=true)
 * renders two invisible <a> tags:
 *
 *   <div style="display:none">
 *     <a href="/api/canary?landing_id=X&t=hidden">.</a>
 *   </div>
 *   <div style="position:absolute;left:-9999px;top:-9999px" aria-hidden>
 *     <a href="/api/canary?landing_id=X&t=offscreen">.</a>
 *   </div>
 *
 * A real human can't click these (display:none / off-screen). A scraper
 * that follows every <a href> in the DOM falls into the trap. We:
 *   1. Add the visitor IP to the runtime canary blacklist
 *   2. Log to bot_hits for offline analysis
 *   3. Respond 204 No Content — silent
 *
 * After being canary-flagged, subsequent requests from that IP to the
 * redirector receive 410 (the runtime blacklist is checked inside
 * botDetect.detect).
 */

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const botDetect = require('../lib/botDetect');
const { geoLookup } = require('../lib/geoLookup');

router.get('/canary', (req, res) => {
  const ip = (req.ip || '').toString();
  const ua = (req.headers['user-agent'] || '').toString();
  // Accept either landing_id (legacy) or redirect_id so the canary can
  // trap scrapers on both surfaces. Whichever is present wins.
  const landingId  = (req.query.landing_id  || '').toString().slice(0, 64);
  const redirectId = (req.query.redirect_id || '').toString().slice(0, 64);
  const trapKind = (req.query.t || '').toString().slice(0, 32) || 'unknown';
  const resourceKind = redirectId ? 'canary-redirect' : 'canary';
  const resourceId = redirectId || landingId || null;

  // 1) Add to runtime blacklist (immediate effect, in-memory)
  botDetect.addToCanaryBlacklist(ip);

  // 2) Persist to bot_hits for audit + future restart-warm
  const geo = geoLookup(ip);
  supabase.from('bot_hits').insert({
    resource_kind: resourceKind,
    resource_id: resourceId,
    slug: null,
    ip: geo.ip_truncated,
    full_ip: ip.slice(0, 64),
    detection_kind: 'canary',
    reason: `Hit canary trap '${trapKind}'`,
    user_agent: ua.slice(0, 500),
    path: req.path,
  }).then(() => {}, (e) => console.warn('[canary] insert failed:', e.message));

  // 3) Silent 204
  return res.status(204).end();
});

module.exports = router;
