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

// Meta IP ranges now come from botCidrs, which auto-refreshes daily from
// a BGP-derived public source. See backend/lib/botCidrs.js.
const botCidrs = require('./botCidrs');

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

// ====== IPv4 CIDR membership check ===========================================
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

function inCidrV4(ip, cidr) {
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

function matchAnyCidrV4(ip, cidrs) {
  for (const cidr of cidrs) if (inCidrV4(ip, cidr)) return cidr;
  return null;
}

// ====== IPv6 CIDR membership check ===========================================
// Uses BigInt arithmetic since IPv6 addresses are 128-bit.
function ipv6ToBigInt(addr) {
  if (!addr || typeof addr !== 'string') return null;
  // Handle the :: zero-compression
  let parts;
  if (addr.includes('::')) {
    const [head, tail] = addr.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    if (headParts.length + tailParts.length > 8) return null;
    const missing = 8 - headParts.length - tailParts.length;
    parts = [...headParts, ...new Array(missing).fill('0'), ...tailParts];
  } else {
    parts = addr.split(':');
  }
  if (parts.length !== 8) return null;
  let result = 0n;
  for (const p of parts) {
    const num = parseInt(p || '0', 16);
    if (Number.isNaN(num) || num < 0 || num > 0xffff) return null;
    result = (result << 16n) | BigInt(num);
  }
  return result;
}

function inCidrV6(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 128) return false;
  const ipN = ipv6ToBigInt(ip);
  const rangeN = ipv6ToBigInt(range);
  if (ipN === null || rangeN === null) return false;
  if (bits === 0) return true;
  const allOnes = (1n << 128n) - 1n;
  const mask = allOnes ^ ((1n << BigInt(128 - bits)) - 1n);
  return (ipN & mask) === (rangeN & mask);
}

function matchAnyCidrV6(ip, cidrs) {
  for (const cidr of cidrs) if (inCidrV6(ip, cidr)) return cidr;
  return null;
}

/**
 * Detect whether a request is from a known bot/crawler.
 * Returns null for humans, or { kind, reason } for bots.
 * Supports both IPv4 and IPv6 source addresses.
 */
function detect(ip, userAgent) {
  if (!ip) return null;

  // Strip the IPv4-in-IPv6 prefix some proxies leave on req.ip
  const stripped = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  // Localhost / private IPs are never bots
  if (
    stripped === '127.0.0.1' ||
    stripped === '::1' ||
    stripped.startsWith('10.') ||
    stripped.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(stripped) ||
    stripped.startsWith('fc') || stripped.startsWith('fd')   // IPv6 ULA
  ) {
    return null;
  }

  // Canary blacklist check (works with both v4 and v6 strings)
  if (isInCanaryBlacklist(stripped)) {
    return { kind: 'canary', reason: `IP ${stripped} previously hit canary` };
  }

  // Decide IPv4 vs IPv6 — IPv6 contains colons and isn't a plain dotted-quad.
  const isIpv4 = /^\d+\.\d+\.\d+\.\d+$/.test(stripped);

  if (isIpv4) {
    const metaHit = matchAnyCidrV4(stripped, botCidrs.getMetaCidrsV4());
    if (metaHit) return { kind: 'meta', reason: `IPv4 ${stripped} in Meta CIDR ${metaHit}` };

    const cloudHit = matchAnyCidrV4(stripped, CLOUD_CIDRS);
    if (cloudHit) return { kind: 'cloud', reason: `IPv4 ${stripped} in cloud DC CIDR ${cloudHit}` };
  } else if (stripped.includes(':')) {
    const metaHit = matchAnyCidrV6(stripped, botCidrs.getMetaCidrsV6());
    if (metaHit) return { kind: 'meta', reason: `IPv6 ${stripped} in Meta CIDR ${metaHit}` };
    // (No IPv6 cloud CIDRs hardcoded — Meta is the main source we care
    //  about, and Render-bound traffic is overwhelmingly IPv4.)
  }

  if (userAgent && BOT_UA_REGEX.test(userAgent)) {
    return { kind: 'crawler', reason: `UA matches bot regex` };
  }

  return null;
}

module.exports = {
  detect,
  addToCanaryBlacklist,
  isInCanaryBlacklist,
  CLOUD_CIDRS,
  BOT_UA_REGEX,
};
