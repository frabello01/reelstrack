const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { uploadImageDataUrl } = require('../lib/imageUpload');

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

  // Normalize host: drop port, drop "www."
  const host = rawHost.replace(/:\d+$/, '').replace(/^www\./, '');
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
  // Strip click_count from the public payload — admins see it in the editor, but
  // there's no reason to leak counters to every visitor.
  const publicLinks = links.map((l) => ({
    id: l.id,
    label: l.label,
    url: l.url,
    icon: l.icon,
    age_gate: l.age_gate,
  }));

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
    links: publicLinks,
  });
});

// POST /api/landings/public/click/:linkId
// Records a click. Fire-and-forget from the client. Body may include
// { meta_platform: 'instagram'|'threads'|'facebook'|null }.
router.post('/public/click/:linkId', async (req, res) => {
  const { linkId } = req.params;
  const metaPlatform = (req.body?.meta_platform || null);
  const ua = (req.headers['user-agent'] || '').toString().slice(0, 250);

  // Verify the link exists + fetch its landing_id for the click row.
  const { data: link, error: lookupErr } = await supabase
    .from('landing_links')
    .select('id, landing_id, click_count')
    .eq('id', linkId)
    .maybeSingle();
  if (lookupErr) return res.status(500).json({ error: lookupErr.message });
  if (!link) return res.status(404).json({ error: 'Link not found' });

  // Respond instantly — DB writes are best-effort.
  res.json({ ok: true });

  // Increment lifetime counter
  supabase
    .from('landing_links')
    .update({ click_count: (link.click_count || 0) + 1 })
    .eq('id', linkId)
    .then(() => {}, (e) => console.warn('[landings] click counter update failed:', e.message));

  // Insert time-series row
  supabase
    .from('landing_link_clicks')
    .insert({
      link_id: linkId,
      landing_id: link.landing_id,
      user_agent: ua,
      meta_platform: metaPlatform,
    })
    .then(() => {}, (e) => console.warn('[landings] click row insert failed:', e.message));
});

// ============================================================
// AUTHENTICATED ENDPOINTS (admin-only via the existing auth gate)
// ============================================================

// GET /api/landings — all landings, with link count and talent join
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('landings')
    .select('*, talents(id, name, profile_pic_url), landing_links(count)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/landings/:id — full detail including links
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('landings')
    .select('*, talents(id, name, profile_pic_url), landing_links(*)')
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
    host: body.host?.toLowerCase().trim() || null,
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
  const allowed = ['talent_id', 'host', 'slug', 'title', 'subtitle', 'bio', 'avatar_url',
    'background_url', 'verified', 'theme', 'published', 'age_gate_default'];
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
  if (updates.host !== undefined && updates.host) {
    updates.host = updates.host.toString().toLowerCase().trim();
  }
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

// POST /api/landings/:id/avatar  →  body { image_data_url }
router.post('/:id/avatar', async (req, res) => {
  const { image_data_url } = req.body || {};
  if (!image_data_url) return res.status(400).json({ error: 'image_data_url required' });
  try {
    const url = await uploadImageDataUrl(image_data_url, `landings/${req.params.id}-avatar`);
    const { data, error } = await supabase
      .from('landings')
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
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
      .update({ background_url: url, updated_at: new Date().toISOString() })
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
  const { label, url, icon, age_gate } = req.body || {};
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
  const allowed = ['label', 'url', 'icon', 'enabled', 'age_gate', 'sort_order'];
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
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);
  const sinceISO = since.toISOString();

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
      .gte('clicked_at', sinceISO),
  ]);

  // Build day-bucketed series for the chart
  const dayKey = (d) => {
    const x = new Date(d);
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
  };
  const series = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    series[dayKey(d)] = 0;
  }
  for (const c of clicks || []) {
    const k = dayKey(c.clicked_at);
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
