/*
 * Signed redirect tokens for the bot-protection feature.
 *
 * When a landing has bot_protection_enabled=true, each outbound link is
 * served as a URL to the redirector domain (parrocchiasanbasilio.com) with
 * a JWT payload as query param `t`. The redirector validates the JWT,
 * then decides 302 (human) or 410 (bot).
 *
 * Algorithm: HS256 (HMAC SHA-256). Stateless — no DB lookup needed by the
 * redirector to know which landing/link the token refers to.
 *
 * Token payload:
 *   {
 *     slug:       string  // landing slug (also in URL path for debugging)
 *     link_id:    string  // UUID of the specific link
 *     dest:       string  // the actual destination URL we want to redirect to
 *     iat:        number  // unix seconds
 *     exp:        number  // unix seconds, ~15 minutes from iat
 *   }
 *
 * Putting the destination INSIDE the signed token means the redirector
 * doesn't need to do a DB lookup at click time — it just verifies the
 * signature, checks expiry, and 302s. This keeps the redirector fast
 * and stateless, which is crucial for the JWT-scales-to-many-creators
 * pattern oopsie uses.
 *
 * Secret: REDIRECTOR_JWT_SECRET env var. Required. If missing, signing
 * throws — fails closed, no insecure default.
 */

const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 15 * 60; // 15 minutes — same as oopsie

function getSecret() {
  const s = process.env.REDIRECTOR_JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'REDIRECTOR_JWT_SECRET is missing or too short. Set a 32+ char ' +
      'random string in Render env vars for bot protection to work.'
    );
  }
  return s;
}

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? 0 : 4 - (str.length % 4);
  const padded = str + '='.repeat(pad);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payload, { ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = b64urlEncode(JSON.stringify(header));
  const payloadB64 = b64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = crypto
    .createHmac('sha256', getSecret())
    .update(signingInput)
    .digest();
  const sigB64 = b64urlEncode(sig);
  return `${signingInput}.${sigB64}`;
}

/**
 * Verify a JWT. Returns the payload on success, throws on failure.
 * Throws specific Error subclasses for the redirector to map to HTTP codes.
 */
class JwtInvalidError extends Error {}
class JwtExpiredError extends Error {}

function verify(token) {
  if (!token || typeof token !== 'string') {
    throw new JwtInvalidError('Token missing');
  }
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtInvalidError('Malformed token');
  const [headerB64, payloadB64, sigB64] = parts;

  // Recompute signature
  const expectedSig = crypto
    .createHmac('sha256', getSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  let providedSig;
  try { providedSig = b64urlDecode(sigB64); }
  catch { throw new JwtInvalidError('Signature decode failed'); }

  if (providedSig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(providedSig, expectedSig)) {
    throw new JwtInvalidError('Signature mismatch');
  }

  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')); }
  catch { throw new JwtInvalidError('Payload decode failed'); }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new JwtExpiredError('Token expired');
  }
  return payload;
}

module.exports = { sign, verify, JwtInvalidError, JwtExpiredError, DEFAULT_TTL_SECONDS };
