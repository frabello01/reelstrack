const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { encodeUrl } = require('../lib/linkCipher');
const { geoLookup } = require('../lib/geoLookup');
const botDetect = require('../lib/botDetect');
const linkJwt = require('../lib/linkJwt');

const REDIRECTOR_HOST = process.env.REDIRECTOR_HOST || 'parrocchiasanbasilio.com';

// ============================================================
// Helpers (mirror landings.js — keeping inline to avoid a
// cross-route refactor in the same PR)
// ============================================================
function classifySource({ metaPlatform, referrerHost, utmSource }) {
  if (utmSource) return String(utmSource).toLowerCase().slice(0, 40);
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
  if (h.includes('youtube.com') || h.includes('youtu.be')) return 'youtube';
  if (h.includes('google.')) return 'google';
  if (h.includes('bing.com')) return 'bing';
  if (h.includes('linkedin.com')) return 'linkedin';
  if (h.includes('discord.com') || h.includes('discord.gg')) return 'discord';
  return 'other';
}

function referrerHostFrom(req, fallbackBody) {
  const raw = (req.headers['referer'] || req.headers['referrer'] || fallbackBody || '').toString();
  if (!raw) return null;
  try { return new URL(raw).hostname.toLowerCase() || null; } catch { return null; }
}

// Slug rules:
//   - lowercase, alphanumeric + hyphens + underscores
//   - 1-60 chars
//   - reserved words blocked so the SPA's own paths don't collide
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const RESERVED_SLUGS = new Set([
  'api', 'admin', 'app', 'p', 'r', 'login', 'signup', 'share',
  'landings', 'todos', 'lists', 'my-day', 'my-accounts', 'my-creators',
  'converter', 'guides', 'image-cleaner', 'batch-cleaner', 'studio',
  'video-studio', 'explore', 'settings', 'team', 'log', 'assets', 'static',
]);

function normaliseSlug(raw) {
  return (raw || '').toString().trim().toLowerCase();
}

function validateSlug(slug) {
  if (!slug) return 'slug is required';
  if (!SLUG_RE.test(slug)) {
    return 'slug must be lowercase letters, numbers, hyphens or underscores (max 60 chars, must start with letter or number)';
  }
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved — pick another`;
  return null;
}

function normaliseUrl(raw) {
  const trimmed = (raw || '').toString().trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// ============================================================
// PUBLIC ENDPOINTS (whitelisted in index.js auth gate)
// ============================================================

// GET /api/redirects/public/lookup?slug=biancajorio
// Returns minimal info needed to render the redirect / age-gate.
// Two modes (mirrors landings):
//   (a) bot_protection_enabled = FALSE → destination shipped XOR-encoded
//       under "u". Frontend decodes at click time and navigates.
//   (b) bot_protection_enabled = TRUE  → destination wrapped in JWT and
//       exposed as redirect_url pointing to the sacrificial redirector
//       domain (parrocchiasanbasilio.com). Real destination is never sent
//       to the client in any decodable form. The redirector applies bot
//       detection + 410 cloaking before doing the 302.
router.get('/public/lookup', async (req, res) => {
  const slug = normaliseSlug(req.query.slug);
  if (!slug) return res.status(400).json({ error: 'slug required' });

  const { data, error } = await supabase
    .from('redirect_links')
    .select('id, slug, destination_url, title, age_gate, is_active, bot_protection_enabled')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Redirect not found' });

  const base = {
    id: data.id,
    slug: data.slug,
    title: data.title || null,
    age_gate: !!data.age_gate,
    bot_protection_enabled: !!data.bot_protection_enabled,
  };

  if (data.bot_protection_enabled) {
    try {
      const token = linkJwt.sign({
        kind: 'redirect_link',
        slug: data.slug,
        redirect_id: data.id,
        dest: data.destination_url,
      });
      return res.json({
        ...base,
        redirect_url: `https://${REDIRECTOR_HOST}/r/${encodeURIComponent(data.slug)}?t=${token}`,
      });
    } catch (err) {
      // JWT signing failed (most likely REDIRECTOR_JWT_SECRET unset on
      // Render). Fall back to the XOR mode so the link still works.
      console.error('[redirects] JWT signing failed, falling back to XOR:', err.message);
    }
  }

  res.json({ ...base, u: encodeUrl(data.destination_url) });
});

// POST /api/redirects/public/click/:id
// Body: { meta_platform?, referrer?, utm_source?, age_gate_confirmed? }
//
// Even when bot_protection_enabled is OFF (no JWT mode), we still run
// bot detection here so that crawler "clicks" don't pollute click_count
// and stats. Detected bots get a 410 + a bot_hits row tagged
// resource_kind='redirect_link', without bumping the counter or
// inserting into redirect_link_clicks.
router.post('/public/click/:id', async (req, res) => {
  const { id } = req.params;
  const metaPlatform = req.body?.meta_platform || null;
  const ua = (req.headers['user-agent'] || '').toString().slice(0, 250);
  const referrerHost = referrerHostFrom(req, req.body?.referrer);
  const utmSource = req.body?.utm_source || null;
  const ageGateConfirmed = typeof req.body?.age_gate_confirmed === 'boolean'
    ? req.body.age_gate_confirmed : null;
  const geo = geoLookup(req.ip);
  const source = classifySource({ metaPlatform, referrerHost, utmSource });

  const { data: link, error: lookupErr } = await supabase
    .from('redirect_links')
    .select('id, slug, click_count')
    .eq('id', id)
    .maybeSingle();
  if (lookupErr) return res.status(500).json({ error: lookupErr.message });
  if (!link) return res.status(404).json({ error: 'Redirect not found' });

  // Bot check — same detector used by the redirector route.
  const verdict = botDetect.detect(req.ip, req.headers['user-agent'] || '');
  if (verdict) {
    supabase.from('bot_hits').insert({
      resource_kind: 'redirect_link',
      resource_id: link.id,
      slug: link.slug,
      ip: geo.ip_truncated,
      full_ip: (req.ip || '').slice(0, 64),
      detection_kind: verdict.kind,
      reason: verdict.reason,
      user_agent: ua,
      path: req.path,
    }).then(() => {}, (e) => console.warn('[redirects] bot_hit insert failed:', e.message));
    return res.status(410).end();
  }

  // Respond instantly — DB writes are best-effort.
  res.json({ ok: true });

  supabase
    .from('redirect_links')
    .update({ click_count: (link.click_count || 0) + 1 })
    .eq('id', id)
    .then(() => {}, (e) => console.warn('[redirects] click counter update failed:', e.message));

  supabase
    .from('redirect_link_clicks')
    .insert({
      redirect_link_id: id,
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
      age_gate_confirmed: ageGateConfirmed,
    })
    .then(() => {}, (e) => console.warn('[redirects] click row insert failed:', e.message));
});

// ============================================================
// AUTHENTICATED ADMIN CRUD
// ============================================================

// GET /api/redirects — list all
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('redirect_links')
    .select('*, talent:talents(id, name), my_account:my_accounts(id, username)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /api/redirects/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('redirect_links')
    .select('*, talent:talents(id, name), my_account:my_accounts(id, username)')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Redirect not found' });
  res.json(data);
});

// GET /api/redirects/:id/clicks — recent click log
router.get('/:id/clicks', async (req, res) => {
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
  const { data, error } = await supabase
    .from('redirect_link_clicks')
    .select('*')
    .eq('redirect_link_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/redirects
router.post('/', async (req, res) => {
  const slug = normaliseSlug(req.body?.slug);
  const slugErr = validateSlug(slug);
  if (slugErr) return res.status(400).json({ error: slugErr });

  const destination = normaliseUrl(req.body?.destination_url);
  if (!destination) return res.status(400).json({ error: 'destination_url is required' });

  // Sanity-check URL parses
  try { new URL(destination); }
  catch { return res.status(400).json({ error: 'destination_url is not a valid URL' }); }

  const row = {
    slug,
    destination_url: destination,
    title: (req.body?.title || '').toString().trim().slice(0, 120) || null,
    age_gate: !!req.body?.age_gate,
    talent_id: req.body?.talent_id || null,
    my_account_id: req.body?.my_account_id || null,
    is_active: req.body?.is_active !== false,
    bot_protection_enabled: !!req.body?.bot_protection_enabled,
    notes: (req.body?.notes || '').toString().trim().slice(0, 500) || null,
  };

  const { data, error } = await supabase
    .from('redirect_links')
    .insert(row)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: `Slug "${slug}" is already taken` });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// PATCH /api/redirects/:id
router.patch('/:id', async (req, res) => {
  const update = { updated_at: new Date().toISOString() };

  if ('slug' in req.body) {
    const slug = normaliseSlug(req.body.slug);
    const slugErr = validateSlug(slug);
    if (slugErr) return res.status(400).json({ error: slugErr });
    update.slug = slug;
  }
  if ('destination_url' in req.body) {
    const dest = normaliseUrl(req.body.destination_url);
    if (!dest) return res.status(400).json({ error: 'destination_url cannot be empty' });
    try { new URL(dest); }
    catch { return res.status(400).json({ error: 'destination_url is not a valid URL' }); }
    update.destination_url = dest;
  }
  if ('title' in req.body) {
    update.title = (req.body.title || '').toString().trim().slice(0, 120) || null;
  }
  if ('age_gate' in req.body) update.age_gate = !!req.body.age_gate;
  if ('talent_id' in req.body) update.talent_id = req.body.talent_id || null;
  if ('my_account_id' in req.body) update.my_account_id = req.body.my_account_id || null;
  if ('is_active' in req.body) update.is_active = !!req.body.is_active;
  if ('bot_protection_enabled' in req.body) update.bot_protection_enabled = !!req.body.bot_protection_enabled;
  if ('notes' in req.body) {
    update.notes = (req.body.notes || '').toString().trim().slice(0, 500) || null;
  }

  const { data, error } = await supabase
    .from('redirect_links')
    .update(update)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: `Slug already taken` });
    }
    return res.status(500).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Redirect not found' });
  res.json(data);
});

// DELETE /api/redirects/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('redirect_links')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
