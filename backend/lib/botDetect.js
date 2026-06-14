/*
 * Bot / crawler detection for our public endpoints.
 *
 * Three layers, evaluated in order:
 *   1) IP in a known Meta CIDR  → kind: 'meta'
 *   2) IP in a known datacenter CIDR (AWS / GCP / Azure) → kind: 'cloud'
 *   3) User-agent matches a known bot signature → kind: 'crawler'
 *
 * We use this on the public landings / redirects lookup so that when a
 * Meta safety scanner probes our URLs (their pattern: multiple IPs from
 * Prineville datacenter, faked iPhone/Android UAs, hitting in bursts
 * within seconds of the URL going up on a profile) it sees a sanitised
 * version of the page — no destination URLs, no analytics writes.
 *
 * The CIDR list below is intentionally CONSERVATIVE: we list ranges
 * we've directly observed in our own data + a few well-known Meta
 * blocks. It's better to miss a probe than block a real user behind
 * an unusual proxy. Expand the list when bot_hits gives evidence.
 */

// ====== KNOWN META / FACEBOOK CIDRs ============================
// Sourced from Facebook AS32934 published peering ranges + observed
// hits in our own bot_hits log (Prineville, OR).
const META_CIDRS = [
  '31.13.24.0/21',
  '31.13.64.0/18',
  '31.13.96.0/19',
  '66.220.144.0/20',     // Prineville datacenter — observed
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

// ====== KNOWN CLOUD DATACENTER CIDRs ==========================
// AWS / GCP / Azure — Meta sometimes runs probes from cloud regions
// too (we observed Boardman, OR = AWS us-west-2). Real users almost
// never connect from these ranges; serving them the bot version is
// safe in practice for an adult-content link-in-bio context.
const CLOUD_CIDRS = [
  // AWS US-WEST-2 (Oregon) — observed Boardman probe
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

// ====== BOT USER-AGENT PATTERNS ===============================
// Anything classed here we mark 'crawler' regardless of IP. Catches
// the easy cases — the more sophisticated probes faking mobile UAs
// only get caught via IP.
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
  return n >>> 0; // force unsigned
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

  // Strip IPv4-in-IPv6 prefix that some proxies leave on req.ip
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

  const metaHit = matchAnyCidr(ipv4, META_CIDRS);
  if (metaHit) return { kind: 'meta', reason: `IP ${ipv4} in Meta CIDR ${metaHit}` };

  const cloudHit = matchAnyCidr(ipv4, CLOUD_CIDRS);
  if (cloudHit) return { kind: 'cloud', reason: `IP ${ipv4} in cloud DC CIDR ${cloudHit}` };

  if (userAgent && BOT_UA_REGEX.test(userAgent)) {
    return { kind: 'crawler', reason: `UA matches bot regex` };
  }

  return null;
}

module.exports = { detect, META_CIDRS, CLOUD_CIDRS, BOT_UA_REGEX };
