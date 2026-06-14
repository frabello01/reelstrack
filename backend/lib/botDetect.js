/*
 * Bot / crawler detection for the redirector and canary endpoints.
 *
 * Three layers, evaluated in order:
 *   1) IP in a known Meta CIDR  → kind: 'meta'
 *   2) IP in a known datacenter CIDR (AWS / GCP / Azure) → kind: 'cloud'
 *   3) User-agent matches a known bot signature → kind: 'crawler'
 *   4) IP in runtime canary blacklist (populated by /api/canary hits)
 *      → kind: 'canary'
 *
 * Used by:
 *   - backend/routes/redirector.js — to decide 302 (human) vs 410 (bot)
 *   - backend/routes/canary.js     — to log + cache the bot's IP
 */

const META_CIDRS = [
  '31.13.24.0/21',
  '31.13.64.0/18',
  '31.13.96.0/19',
  '66.220.144.0/20',
  '66.220.152.0/21',
  '69.63.176.0/20',
  '69.171.224.0/19',
  '69.171.250.0/24',
  '74.119.76.0/22',
  '102.132.96.0/20',
  '129.134.0.0/16',
  '157.240.0.0/16',
  '173.252.64.0/18',
  '179.60.192.0/22',
  '185.60.216.0/22',
  '204.15.20.0/22',
];

const CLOUD_CIDRS = [
  // AWS US-WEST-2 (Oregon) — observed Meta probes here
  '35.155.0.0/16',
  '35.160.0.0/13',
  '52.10.0.0/15',
  '52.32.0.0/14',
  '54.68.0.0/14',
  // AWS US-EAST-1 / 2
  '3.80.0.0/12',
  '52.0.0.0/15',
  '54.144.0.0/14',
  // GCP common
  '34.64.0.0/10',
  '35.184.0.0/13',
  // Azure common
  '13.64.0.0/11',
  '40.64.0.0/10',
  '52.224.0.0/11',
];

const BOT_UA_REGEX = new RegExp([
  'facebookexternalhit',
  'meta-externalagent',
  'facebookbot',
  'facebookcatalog',
  'twitterbot',
  'slackbot',
  'linkedinbot',
  'telegrambot',
  'whatsapp\\/',
  'discordbot',
  'embedly',
  'bingbot',
  'googlebot',
  'baiduspider',
  'duckduckbot',
  'yandexbot',
  'applebot',
  'mj12bot',
  'ahrefsbot',
  'semrushbot',
  'rogerbot',
  'screaming frog',
  'curl\\/',
  'wget\\/',
  'python-requests',
  'node-fetch',
  'axios\\/',
  'go-http-client',
  'headlesschrome',
  'phantomjs',
  'puppeteer',
  'playwright',
].join('|'), 'i');

// ====== Runtime canary blacklist (in-memory, per process) ====================
// When a request hits /api/canary, we add the IP here so subsequent requests
// from the same IP get treated as bots. TTL of 30 days. Survives in-memory
// across requests but resets on dyno restart — that's fine because the bot
// will just re-hit the canary on its next pass and get re-flagged.
//
// At our scale (single Render dyno) this is sufficient. If we ever scale
// horizontally we move this to Redis or rebuild the cache on boot from
// bot_hits (last 30 days, kind='canary').
const CANARY_BLACKLIST = new Map(); // ip -> expiresAtMs
const CANARY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function addToCanaryBlacklist(ip) {
  if (!ip) return;
  const ipv4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  CANARY_BLACKLIST.set(ipv4, Date.now() + CANARY_TTL_MS);
}

function isInCanaryBlacklist(ip) {
  if (!ip) return false;
  const ipv4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const exp = CANARY_BLACKLIST.get(ipv4);
  if (!exp) return false;
  if (Date.now() > exp) {
    CANARY_BLACKLIST.delete(ipv4);
    return false;
  }
  return true;
}

// ====== CIDR membership check (IPv4 only) ====================
function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = parseInt(p, 10);
    if (Number.isNaN(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function inCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const ipN = ipv4ToInt(ip);
  const rangeN = ipv4ToInt(range);
  if (ipN === null || rangeN === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ipN & mask) === (rangeN & mask);
}

function matchAnyCidr(ip, cidrs) {
  for (const cidr of cidrs) if (inCidr(ip, cidr)) return cidr;
  return null;
}

/**
 * Detect whether a request is from a known bot/crawler.
 * Returns null for humans, or { kind, reason } for bots.
 */
function detect(ip, userAgent) {
  if (!ip) return null;

  const ipv4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  // Localhost / private IPs are never bots
  if (
    ipv4 === '127.0.0.1' ||
    ipv4 === '::1' ||
    ipv4.startsWith('10.') ||
    ipv4.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ipv4)
  ) {
    return null;
  }

  if (isInCanaryBlacklist(ipv4)) {
    return { kind: 'canary', reason: `IP ${ipv4} previously hit canary` };
  }

  const metaHit = matchAnyCidr(ipv4, META_CIDRS);
  if (metaHit) return { kind: 'meta', reason: `IP ${ipv4} in Meta CIDR ${metaHit}` };

  const cloudHit = matchAnyCidr(ipv4, CLOUD_CIDRS);
  if (cloudHit) return { kind: 'cloud', reason: `IP ${ipv4} in cloud DC CIDR ${cloudHit}` };

  if (userAgent && BOT_UA_REGEX.test(userAgent)) {
    return { kind: 'crawler', reason: `UA matches bot regex` };
  }

  return null;
}

module.exports = {
  detect,
  addToCanaryBlacklist,
  isInCanaryBlacklist,
  META_CIDRS,
  CLOUD_CIDRS,
  BOT_UA_REGEX,
};
