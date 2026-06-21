// ============================================================
// SMSPool API client.
//
// Thin wrapper around https://api.smspool.net — all requests are GET
// with the API key passed as the `key` query parameter (per the
// official docs and the unofficial JS SDK).
//
// Requires env var: SMSPOOL_API_KEY
//
// All functions return the parsed JSON response from SMSPool. We do
// NOT reshape the payload here — the route layer decides what to expose
// to the frontend.
//
// Status codes returned by /sms/check (and recorded on the order):
//   0  pending  (also: cancelled in some flows — we use SMSPool's text)
//   1  pending
//   3  delivered (sms_code is set)
//   4  refunded (cancel succeeded)
//   6  expired
//
// References:
//   - https://www.smspool.net/article/how-to-use-the-smspool-api
//   - https://github.com/Siddhart/SMSPool.js (parameter names + URLs)
// ============================================================

const BASE = 'https://api.smspool.net';

class SmspoolError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'SmspoolError';
    this.status = status;
    this.body = body;
  }
}

function apiKey() {
  const k = process.env.SMSPOOL_API_KEY;
  if (!k) {
    throw new SmspoolError(
      'SMSPOOL_API_KEY env var is not set on the backend. Add it on Render to enable SMS verifications.'
    );
  }
  return k;
}

async function call(path, params = {}, { requireKey = true } = {}) {
  const qs = new URLSearchParams();
  if (requireKey) qs.set('key', apiKey());
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const url = `${BASE}${path}?${qs.toString()}`;
  let res;
  try {
    res = await fetch(url, { method: 'GET' });
  } catch (err) {
    throw new SmspoolError(`SMSPool network error: ${err.message}`);
  }
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; }
  catch { body = text; }

  if (!res.ok) {
    const msg = (body && body.message) || `SMSPool HTTP ${res.status}`;
    throw new SmspoolError(msg, { status: res.status, body });
  }
  // SMSPool sometimes returns 200 with { success: 0, message: "..." }
  // for application-level errors (e.g. insufficient balance, bad service)
  if (body && typeof body === 'object' && body.success === 0 && body.message) {
    throw new SmspoolError(body.message, { status: 200, body });
  }
  return body;
}

// ---- Catalog (no API key required by SMSPool) ----
const getCountries = () => call('/country/retrieve_all', {}, { requireKey: false });
const getServices  = (country) => call('/service/retrieve_all', { country }, { requireKey: false });

// ---- Account ----
const getBalance       = () => call('/request/balance');
const getActiveOrders  = () => call('/request/active');
const getOrderHistory  = () => call('/request/history');
const archiveOrders    = () => call('/request/archive');
const getPrice = ({ country, service, pool }) =>
  call('/request/price', { country, service, pool });

// ---- One-shot SMS lifecycle ----
const purchaseSms = ({ country, service, pool, max_price, pricing_option, areacode, exclude }) =>
  call('/purchase/sms', { country, service, pool, max_price, pricing_option, areacode, exclude });
const checkSms   = (orderid) => call('/sms/check',  { orderid });
const cancelSms  = (orderid) => call('/sms/cancel', { orderid });
const resendSms  = (orderid) => call('/sms/resend', { orderid });

module.exports = {
  SmspoolError,
  getCountries,
  getServices,
  getBalance,
  getActiveOrders,
  getOrderHistory,
  archiveOrders,
  getPrice,
  purchaseSms,
  checkSms,
  cancelSms,
  resendSms,
};
