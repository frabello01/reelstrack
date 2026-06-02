/*
 * IP → geo helper. Uses geoip-lite (offline MaxMind-derived data bundled
 * with the npm package — no API calls, no rate limits, no PII leaving
 * our backend).
 *
 * Returns null for unresolvable IPs (localhost, private ranges, IPv6
 * the DB doesn't cover, etc.) — callers should treat geo fields as
 * optional and store nulls happily.
 *
 * IP storage convention: we mask IPv4 to /24 (zero the last octet) so
 * we keep city-level analytics value without storing a fully personal
 * identifier. IPv6 is kept as-is for now (the protocol's huge address
 * space already makes single-host identification fuzzy).
 */

const geoip = require('geoip-lite');

// Country code → flag emoji + full name (small lookup; geoip returns code only)
// Used by the dashboard for display, but we resolve names here so the
// frontend doesn't need to ship a 200KB country-names table.
const COUNTRY_NAMES = {
  IT: 'Italia', CH: 'Svizzera', DE: 'Germania', FR: 'Francia',
  ES: 'Spagna', GB: 'Regno Unito', US: 'Stati Uniti', BR: 'Brasile',
  CA: 'Canada', AU: 'Australia', NL: 'Olanda', BE: 'Belgio',
  AT: 'Austria', PT: 'Portogallo', IE: 'Irlanda', SE: 'Svezia',
  NO: 'Norvegia', DK: 'Danimarca', FI: 'Finlandia', PL: 'Polonia',
  GR: 'Grecia', RO: 'Romania', HU: 'Ungheria', CZ: 'Repubblica Ceca',
  SK: 'Slovacchia', HR: 'Croazia', SI: 'Slovenia', RS: 'Serbia',
  BG: 'Bulgaria', UA: 'Ucraina', RU: 'Russia', TR: 'Turchia',
  AR: 'Argentina', MX: 'Messico', CL: 'Cile', CO: 'Colombia',
  PE: 'Perù', VE: 'Venezuela', JP: 'Giappone', KR: 'Corea del Sud',
  CN: 'Cina', IN: 'India', PH: 'Filippine', ID: 'Indonesia',
  TH: 'Thailandia', VN: 'Vietnam', MY: 'Malesia', SG: 'Singapore',
  HK: 'Hong Kong', TW: 'Taiwan', AE: 'Emirati Arabi Uniti',
  SA: 'Arabia Saudita', IL: 'Israele', EG: 'Egitto', MA: 'Marocco',
  TN: 'Tunisia', ZA: 'Sudafrica', NG: 'Nigeria', KE: 'Kenya',
  NZ: 'Nuova Zelanda',
};

function countryName(code) {
  if (!code) return null;
  return COUNTRY_NAMES[code] || code; // fall back to the code itself
}

// Truncate IPv4 to /24 (mask last octet → 0). IPv6 left as-is.
function truncateIp(ip) {
  if (!ip) return null;
  // Strip IPv6-mapped-IPv4 prefix if present
  const cleaned = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    if (parts.length === 4) {
      parts[3] = '0';
      return parts.join('.');
    }
  }
  return cleaned;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (clean === '127.0.0.1' || clean === '::1') return true;
  if (clean.startsWith('10.')) return true;
  if (clean.startsWith('192.168.')) return true;
  if (clean.startsWith('172.')) {
    const second = parseInt(clean.split('.')[1] || '0', 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
  return false;
}

/**
 * Look up geo data for an IP. Returns:
 *   {
 *     ip_truncated, country_code, country_name,
 *     region, city, lat, lng, timezone
 *   }
 * Any field may be null. The returned object is always safe to spread.
 */
function geoLookup(ip) {
  const out = {
    ip_truncated: truncateIp(ip),
    country_code: null,
    country_name: null,
    region: null,
    city: null,
    lat: null,
    lng: null,
    timezone: null,
  };
  if (!ip || isPrivateIp(ip)) return out;
  try {
    const cleaned = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    const g = geoip.lookup(cleaned);
    if (!g) return out;
    out.country_code = g.country || null;
    out.country_name = countryName(g.country);
    out.region = g.region || null;
    out.city = g.city || null;
    if (Array.isArray(g.ll) && g.ll.length === 2) {
      out.lat = g.ll[0];
      out.lng = g.ll[1];
    }
    out.timezone = g.timezone || null;
  } catch (err) {
    // Don't let geo failures break click recording
    console.warn('[geoLookup] error:', err.message);
  }
  return out;
}

module.exports = { geoLookup, truncateIp, countryName };
