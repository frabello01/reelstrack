/*
 * Dynamic Meta CIDR list — auto-refreshed daily from a public BGP-derived
 * source on GitHub.
 *
 * Source: https://github.com/disposable/cloud-ip-ranges/blob/master/json/meta-crawler.json
 *
 * The file is auto-generated from RIPE BGP announcements for Meta's ASNs
 * (AS32934 Facebook + AS54115 + AS63293 + AS11917 + AS34825). It refreshes
 * daily and covers everything that Meta routers announce to the global
 * internet, including IPv6 (which our previous hardcoded list ignored).
 *
 * Failure model:
 *   - On boot, we fetch once. If it fails, we fall back to a hardcoded
 *     snapshot of the most important ranges so the redirector still has
 *     SOMETHING to block.
 *   - Every 24h we re-fetch in the background. If a refresh fails, we
 *     keep using the previous list (don't reset to fallback).
 *   - We never block production traffic on a failed fetch — the request
 *     path uses whatever list is currently in memory.
 */

const SOURCE_URL = process.env.META_CIDRS_URL ||
  'https://raw.githubusercontent.com/disposable/cloud-ip-ranges/master/json/meta-crawler.json';

const FETCH_TIMEOUT_MS = 10_000;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ====== Hardcoded fallback ===================================================
// Used ONLY when the very first GitHub fetch fails (e.g. network blip during
// dyno boot). Subset of the most-active Meta ranges hand-picked from past
// snapshots — enough to catch ~80% of Meta crawl traffic.
const FALLBACK_IPV4 = [
  '31.13.24.0/21', '31.13.64.0/18', '31.13.96.0/19',
  '66.220.144.0/20', '66.220.152.0/21',
  '69.63.176.0/20', '69.171.224.0/19', '69.171.250.0/24',
  '74.119.76.0/22', '102.132.96.0/20',
  '129.134.0.0/17', '157.240.0.0/16',
  '173.252.64.0/18', '179.60.192.0/22',
  '185.60.216.0/22', '204.15.20.0/22',
  '57.144.0.0/14', '163.114.128.0/20',
];
const FALLBACK_IPV6 = [
  '2620:0:1c00::/40', '2a03:2880::/32', '2c0f:ef78::/40',
];

let currentIpv4 = FALLBACK_IPV4.slice();
let currentIpv6 = FALLBACK_IPV6.slice();
let lastSuccessfulRefresh = null;
let lastError = null;
let refreshTimer = null;

async function fetchAndParse() {
  // Native fetch (Node 18+) with AbortSignal timeout
  const res = await fetch(SOURCE_URL, {
    method: 'GET',
    headers: {
      'User-Agent': 'reelstrack-bot-protection/1.0',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from source`);
  const json = await res.json();
  if (!Array.isArray(json.ipv4)) throw new Error('Malformed source: ipv4 not array');
  // ipv6 may be absent in older format versions — accept empty
  const ipv6 = Array.isArray(json.ipv6) ? json.ipv6 : [];
  return { ipv4: json.ipv4, ipv6, generatedAt: json.generated_at || null };
}

async function refresh() {
  try {
    const { ipv4, ipv6, generatedAt } = await fetchAndParse();
    const prevV4 = currentIpv4.length;
    const prevV6 = currentIpv6.length;
    currentIpv4 = ipv4;
    currentIpv6 = ipv6;
    lastSuccessfulRefresh = new Date();
    lastError = null;
    const dV4 = ipv4.length - prevV4;
    const dV6 = ipv6.length - prevV6;
    const fmt = (n) => n > 0 ? `+${n}` : `${n}`;
    console.log(
      `[bot_cidrs] Meta CIDR list refreshed from ${generatedAt || 'unknown date'}: ` +
      `${ipv4.length} IPv4 (${fmt(dV4)}), ${ipv6.length} IPv6 (${fmt(dV6)})`
    );
    return true;
  } catch (err) {
    lastError = err.message;
    console.warn(
      `[bot_cidrs] Refresh failed (${err.message}). ` +
      `Keeping current list of ${currentIpv4.length} IPv4 + ${currentIpv6.length} IPv6.`
    );
    return false;
  }
}

function startRefreshLoop() {
  if (refreshTimer) return;
  refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
  // Don't keep the process alive just for this timer
  if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
}

function stopRefreshLoop() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function getMetaCidrsV4() { return currentIpv4; }
function getMetaCidrsV6() { return currentIpv6; }

function status() {
  return {
    source_url: SOURCE_URL,
    ipv4_count: currentIpv4.length,
    ipv6_count: currentIpv6.length,
    last_refresh: lastSuccessfulRefresh,
    last_error: lastError,
    next_refresh_in_ms: refreshTimer ? REFRESH_INTERVAL_MS : null,
  };
}

module.exports = {
  refresh,
  startRefreshLoop,
  stopRefreshLoop,
  getMetaCidrsV4,
  getMetaCidrsV6,
  status,
};
