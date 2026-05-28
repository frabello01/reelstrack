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
 * Notify Discord when a profile transitions between healthy and unhealthy.
 *
 * We notify when:
 *   - previously "active" (or null/unknown) → now not-active   → red embed
 *   - previously not-active → now "active"                     → green embed
 *
 * We DO NOT notify when:
 *   - prevStatus and newStatus are both "active" (no news is good news)
 *   - prevStatus and newStatus are both unhealthy (avoid daily spam)
 *   - we don't have a webhook configured
 *
 * @param {object} ctx
 * @param {string} ctx.username     — IG handle (without @)
 * @param {string|null} ctx.talentName — friendly name from `talents.name` if available
 * @param {string|null} ctx.prevStatus
 * @param {string} ctx.newStatus
 * @param {string|null} ctx.errorMsg — populated when newStatus === 'error'
 */
async function notifyAccountStatusChange({ username, talentName, prevStatus, newStatus, errorMsg }) {
  const url = await getWebhookUrl();
  if (!url) return false; // no webhook configured

  const wasActive  = prevStatus === 'active';
  const isActive   = newStatus === 'active';
  const isFirstSeen = prevStatus == null || prevStatus === 'unknown';

  // Skip silent transitions:
  //  - first sighting of a healthy profile (no need to announce)
  //  - both states unhealthy (already alerted on the original drop)
  if (isFirstSeen && isActive) return false;
  if (!wasActive && !isActive) return false;
  if (prevStatus === newStatus) return false; // no transition at all

  const isRecovery = isActive && !wasActive;
  const goingDown  = wasActive && !isActive;

  // First-time sighting of an already-unhealthy profile: announce it.
  // (Most useful when an admin adds a brand-new profile that's already
  // private or banned.)
  if (isFirstSeen && !isActive) {
    // fall through to "went down" formatting below
  }

  const heading = isRecovery
    ? '✅ Profilo IG di nuovo attivo'
    : '⚠️ Profilo IG non disponibile';

  const color = isRecovery ? COLOR_GREEN : (goingDown || isFirstSeen ? COLOR_RED : COLOR_AMBER);

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
      title: heading,
      color,
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
