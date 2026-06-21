// ============================================================
// SMSPool routes — proxies SMSPool's HTTP API and shadows every
// purchase in our `sms_orders` table so the admin can tag each number
// with a free-form note ("for @talent_x IG signup") and we keep a
// usable history even if SMSPool archives or rotates theirs.
//
// All routes require an authenticated team member (mounted under the
// global /api auth gate in backend/index.js). No admin-only guard:
// any member who needs to log into a creator account may need an SMS.
// ============================================================

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const smspool = require('../lib/smspool');

// Map SMSPool's numeric status (returned by /sms/check) to our string
// status. SMSPool itself sometimes returns a `text_status` field too;
// we keep both.
function mapStatus(code) {
  switch (Number(code)) {
    case 1: return 'pending';
    case 3: return 'received';
    case 4: return 'cancelled';
    case 6: return 'expired';
    default: return 'pending';
  }
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Wraps an SMSPool client call so smspool-specific errors come back
// as a clean JSON error to the frontend (instead of bubbling to the
// generic 500 handler).
function smspoolHandler(fn) {
  return asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err.name === 'SmspoolError') {
        return res.status(502).json({
          error: 'smspool',
          message: err.message,
          smspool_status: err.status || null,
          smspool_body: err.body || null,
        });
      }
      throw err;
    }
  });
}

// ============================================================
// CATALOG / ACCOUNT
// ============================================================

router.get('/balance', smspoolHandler(async (req, res) => {
  const data = await smspool.getBalance();
  res.json(data);
}));

router.get('/countries', smspoolHandler(async (req, res) => {
  const data = await smspool.getCountries();
  res.json(data);
}));

router.get('/services', smspoolHandler(async (req, res) => {
  const country = req.query.country || undefined;
  const data = await smspool.getServices(country);
  res.json(data);
}));

router.get('/price', smspoolHandler(async (req, res) => {
  const { country, service, pool } = req.query;
  if (!country || !service) {
    return res.status(400).json({ error: 'country and service are required' });
  }
  const data = await smspool.getPrice({ country, service, pool });
  res.json(data);
}));

// ============================================================
// LOCAL HISTORY (reads our shadow table)
// ============================================================

router.get('/orders', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const { data, error } = await supabase
    .from('sms_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data || [] });
}));

router.get('/orders/active', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('sms_orders')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data || [] });
}));

// Edit the admin note (the only mutable user-supplied field).
router.patch('/orders/:order_id', asyncHandler(async (req, res) => {
  const { order_id } = req.params;
  const note = typeof req.body?.note === 'string' ? req.body.note : null;
  const { data, error } = await supabase
    .from('sms_orders')
    .update({ note })
    .eq('order_id', order_id)
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Order not found' });
  res.json(data);
}));

// ============================================================
// PURCHASE — calls SMSPool, then inserts our row.
//
// Body: { country, service, pool?, note?, max_price?, areacode?,
//         country_name?, service_name? }
//
// The *_name fields are optional pretty labels the frontend already
// has from the picker — saving them avoids re-resolving the codes
// every time the history is shown.
// ============================================================
router.post('/purchase', smspoolHandler(async (req, res) => {
  const {
    country, service, pool, note,
    max_price, areacode,
    country_name, service_name,
  } = req.body || {};

  if (!country || !service) {
    return res.status(400).json({ error: 'country and service are required' });
  }

  // Try to capture the price BEFORE purchase so we always know what we
  // paid. If the price call fails we still proceed — SMSPool's purchase
  // call itself returns the price, and we'd rather risk a missing cost
  // than abort the purchase.
  let cost = null;
  try {
    const priceRes = await smspool.getPrice({ country, service, pool });
    if (priceRes && (priceRes.price || priceRes.price === 0)) {
      cost = Number(priceRes.price);
    }
  } catch { /* swallow */ }

  const order = await smspool.purchaseSms({
    country, service, pool, max_price, areacode,
  });

  // SMSPool's purchase response (per docs):
  //   { success, message, order_id, number, country, service, pool, expires_in, cost }
  if (!order || !order.order_id) {
    return res.status(502).json({
      error: 'smspool',
      message: 'SMSPool did not return an order_id',
      smspool_body: order,
    });
  }

  if (order.cost && cost == null) cost = Number(order.cost);

  const expires_at = order.expires_in
    ? new Date(Date.now() + Number(order.expires_in) * 1000).toISOString()
    : null;

  const insertRow = {
    order_id: String(order.order_id),
    country: String(country),
    country_name: country_name || null,
    service: String(service),
    service_name: service_name || null,
    phone_number: order.number || null,
    pool: order.pool || pool || null,
    status: 'pending',
    cost,
    expires_at,
    note: note || null,
    created_by: req.user?.id || null,
  };

  const { data, error } = await supabase
    .from('sms_orders')
    .insert(insertRow)
    .select()
    .single();
  if (error) {
    // The purchase already went through — log loudly and still return
    // the SMSPool order so the admin can use the number, plus our
    // insertion error so they know history is out of sync.
    console.error('[smspool] sms_orders insert failed:', error.message, insertRow);
    return res.json({ ...order, _persist_error: error.message });
  }

  res.json({ ...order, row: data });
}));

// ============================================================
// CHECK — polls SMSPool for the SMS arrival, then updates our row.
//
// Returns: { status: <our string>, status_code, sms, full_sms, row }
// ============================================================
router.get('/check/:order_id', smspoolHandler(async (req, res) => {
  const { order_id } = req.params;
  const sp = await smspool.checkSms(order_id);

  // SMSPool /sms/check response:
  //   { status: <int>, sms: "<otp>", full_sms: "...", time_left, expiration, resend, ... }
  const code = sp?.status;
  const ourStatus = mapStatus(code);

  const patch = {
    status: ourStatus,
    status_code: code != null ? Number(code) : null,
  };
  if (sp?.sms)      patch.sms_code = String(sp.sms);
  if (sp?.full_sms) patch.full_sms = String(sp.full_sms);
  if (ourStatus === 'received' && !patch.received_at) {
    patch.received_at = new Date().toISOString();
  }

  const { data: row } = await supabase
    .from('sms_orders')
    .update(patch)
    .eq('order_id', order_id)
    .select()
    .maybeSingle();

  res.json({ ...sp, row });
}));

// ============================================================
// CANCEL — refunds the order at SMSPool, updates our row.
// ============================================================
router.post('/cancel/:order_id', smspoolHandler(async (req, res) => {
  const { order_id } = req.params;
  const sp = await smspool.cancelSms(order_id);

  const { data: row } = await supabase
    .from('sms_orders')
    .update({ status: 'cancelled', status_code: 4 })
    .eq('order_id', order_id)
    .select()
    .maybeSingle();

  res.json({ ...sp, row });
}));

// ============================================================
// RESEND — asks SMSPool to request a new SMS on the same number.
// (Not all services support it; SMSPool returns the success flag.)
// ============================================================
router.post('/resend/:order_id', smspoolHandler(async (req, res) => {
  const { order_id } = req.params;
  const sp = await smspool.resendSms(order_id);
  res.json(sp);
}));

module.exports = router;
