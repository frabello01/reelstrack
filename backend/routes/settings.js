const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { uploadImageDataUrl } = require('../lib/imageUpload');
const { sendTestMessage, clearCache: clearDiscordCache } = require('../services/discordNotifier');

/**
 * Single-tenant: only one agency_settings row, id='default'.
 */

// GET current agency settings
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('agency_settings')
    .select('display_name, agency_logo_url, discord_webhook_url, default_list_id, updated_at')
    .eq('id', 'default')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || { display_name: null, agency_logo_url: null, discord_webhook_url: null, default_list_id: null });
});

// PATCH update settings (display_name and/or discord_webhook_url)
router.patch('/', async (req, res) => {
  const allowed = ['display_name', 'discord_webhook_url', 'default_list_id'];
  const updates = { id: 'default', updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (k in (req.body || {})) {
      const v = req.body[k];
      updates[k] = v == null || v === '' ? null : String(v).trim();
    }
  }
  // Light validation on the webhook URL
  if (updates.discord_webhook_url) {
    if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(updates.discord_webhook_url)) {
      return res.status(400).json({ error: 'discord_webhook_url must be a Discord webhook URL (https://discord.com/api/webhooks/...)' });
    }
  }
  const { data, error } = await supabase
    .from('agency_settings')
    .upsert(updates, { onConflict: 'id' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  // Invalidate the cached webhook URL in the notifier
  clearDiscordCache();
  res.json(data);
});

// POST send a test message to the Discord webhook (uses the body's URL if
// provided, otherwise the one already saved in agency_settings).
router.post('/discord/test', async (req, res) => {
  let url = req.body?.url;
  if (!url) {
    const { data } = await supabase
      .from('agency_settings')
      .select('discord_webhook_url')
      .eq('id', 'default')
      .maybeSingle();
    url = data?.discord_webhook_url || null;
  }
  if (!url) return res.status(400).json({ error: 'No webhook URL configured' });
  try {
    const ok = await sendTestMessage(url);
    if (!ok) return res.status(502).json({ error: 'Discord rejected the message' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST upload agency logo (base64 data URL)
router.post('/logo', async (req, res) => {
  const { image_data_url } = req.body;
  if (!image_data_url) return res.status(400).json({ error: 'image_data_url is required' });

  try {
    const url = await uploadImageDataUrl(image_data_url, 'agency-logos/default');
    const { data, error } = await supabase
      .from('agency_settings')
      .upsert(
        { id: 'default', agency_logo_url: url, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE agency logo
router.delete('/logo', async (req, res) => {
  const { error } = await supabase
    .from('agency_settings')
    .update({ agency_logo_url: null, updated_at: new Date().toISOString() })
    .eq('id', 'default');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// PUBLIC: same data as GET / but without any auth concerns (single-tenant)
// Used by the public share page. Same as GET / since there's only one agency.
router.get('/public', async (req, res) => {
  const { data } = await supabase
    .from('agency_settings')
    .select('display_name, agency_logo_url')
    .eq('id', 'default')
    .maybeSingle();
  res.json(data || { display_name: null, agency_logo_url: null });
});

module.exports = router;
