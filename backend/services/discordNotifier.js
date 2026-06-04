/*
 * Discord webhook notifier — used to alert when an IG profile in
 * "My Creators" changes state (active → inactive/private/error, or
 * back to active). The webhook URL is configured in agency_settings.
 *
 * Posts are fire-and-forget — a Discord outage MUST NOT block the
 * daily my-accounts fetch.
 */

const supabase = require('../lib/supabase');

// Lightweight cache so the cron doesn't hammer Supabase for the URL
// once per IG profile per day. Refreshed every 5 minutes.
let cachedUrl = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getWebhookUrl() {
  if (Date.now() - cachedAt < CACHE_TTL_MS) return cachedUrl;
  const { data } = await supabase
    .from('agency_settings')
    .select('discord_webhook_url')
    .eq('id', 'default')
    .maybeSingle();
  cachedUrl = data?.discord_webhook_url || null;
  cachedAt = Date.now();
  return cachedUrl;
}

// Discord embed colours (decimal). https://gist.github.com/thomasbnt/...
const COLOR_RED   = 15158332; // status went bad
const COLOR_GREEN = 3066993;  // status recovered
const COLOR_AMBER = 16098851; // edge case / unknown

// Friendly label for a my_accounts.status value
function describeStatus(s, errorMsg) {
  switch (s) {
    case 'active':   return 'attivo';
    case 'inactive': return 'profilo non trovato / disattivato';
    case 'private':  return 'profilo privato';
    case 'error':    return errorMsg ? `errore — ${errorMsg}` : 'errore';
    case 'unknown':
    default:         return 'sconosciuto';
  }
}

// Post arbitrary JSON to the webhook. Returns true on 2xx, false otherwise.
async function postWebhook(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[discord] webhook ${res.status}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[discord] webhook fetch failed:', err.message);
    return false;
  }
}

/**
 * Notify Discord ONLY when an IG profile becomes 'inactive' — i.e. when
 * HikerAPI's profile lookup returns 404, which means the account was
 * deleted, suspended, deactivated, or renamed.
 *
 * We deliberately DO NOT notify for any other transition:
 *   - → 'active'   (recovery is not announced)
 *   - → 'private'  (deliberate user choice, not a problem)
 *   - → 'error'    (transient HikerAPI failures: rate limits, 5xx, etc.)
 *   - same-status  (no actual change)
 *
 * Triggers covered by the single "newStatus === 'inactive'" rule:
 *   - active   → inactive  (alive → gone)
 *   - private  → inactive  (was hidden, now gone — yes, you DO get notified)
 *   - error    → inactive  (was flapping, now confirmed gone)
 *   - unknown  → inactive  (first time we see a brand-new account, already gone)
 *
 * @param {object} ctx
 * @param {string} ctx.username     — IG handle (without @)
 * @param {string|null} ctx.talentName — friendly name from `talents.name` if available
 * @param {string|null} ctx.prevStatus
 * @param {string} ctx.newStatus
 * @param {string|null} ctx.errorMsg — kept for context but only used if newStatus is 'inactive'
 */
async function notifyAccountStatusChange({ username, talentName, prevStatus, newStatus, errorMsg }) {
  const url = await getWebhookUrl();
  if (!url) return false; // no webhook configured

  // The single rule: only notify when the account becomes inactive,
  // and only on the actual transition (don't re-fire daily).
  if (newStatus !== 'inactive') return false;
  if (prevStatus === 'inactive') return false;

  const fields = [
    { name: 'Username', value: `[@${username}](https://www.instagram.com/${username}/)`, inline: true },
  ];
  if (talentName) fields.push({ name: 'Creator', value: talentName, inline: true });
  fields.push({ name: 'Stato', value: describeStatus(newStatus, errorMsg), inline: false });
  if (prevStatus && prevStatus !== newStatus) {
    fields.push({ name: 'Stato precedente', value: describeStatus(prevStatus), inline: true });
  }

  const payload = {
    embeds: [{
      title: '⚠️ Profilo IG non disponibile',
      color: COLOR_RED,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: 'Reels Tracker · My Creators' },
    }],
  };

  return postWebhook(url, payload);
}

// Manual test message — used by the "Test webhook" button in settings.
async function sendTestMessage(url) {
  if (!url) throw new Error('No webhook URL provided');
  const payload = {
    embeds: [{
      title: '🔔 Test webhook from Reels Tracker',
      description: 'Se vedi questo messaggio, il webhook è configurato correttamente.',
      color: COLOR_GREEN,
      timestamp: new Date().toISOString(),
      footer: { text: 'Reels Tracker · test' },
    }],
  };
  return postWebhook(url, payload);
}

// Force-invalidate the cached URL — call after a settings update.
function clearCache() {
  cachedUrl = null;
  cachedAt = 0;
}

module.exports = { notifyAccountStatusChange, sendTestMessage, clearCache };
