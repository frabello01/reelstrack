const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { uploadImageDataUrl } = require('../lib/imageUpload');

/**
 * Single-tenant: only one agency_settings row, id='default'.
 */

// GET current agency settings
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('agency_settings')
    .select('display_name, agency_logo_url, updated_at')
    .eq('id', 'default')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || { display_name: null, agency_logo_url: null });
});

// PATCH update display name
router.patch('/', async (req, res) => {
  const { display_name } = req.body;
  const { data, error } = await supabase
    .from('agency_settings')
    .upsert(
      { id: 'default', display_name: display_name ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    )
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
