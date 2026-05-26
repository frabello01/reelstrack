/*
 * Reversible URL obfuscation for public landing-link payloads.
 *
 * The goal is not cryptographic secrecy — anyone who reads our JS bundle
 * can recover URLs. The goal is to make scraping require running our
 * specific decode function, which defeats:
 *   • Grep-style scrapers that scan the API JSON for "https://" patterns
 *   • Crawlers that execute JS but only dump the rendered DOM / fetched
 *     JSON (the URLs aren't there in plain form)
 *   • IG / FB / X / WhatsApp / Telegram preview crawlers (which don't
 *     execute JS at all)
 *
 * Algorithm: XOR each byte of the URL with a key derived from a shared
 * secret + a per-link 4-byte salt that we ship with the encoded blob.
 * The salt makes the same URL encode differently across landings, so
 * grep'ing for one known encoded URL won't reveal others.
 *
 * Output format: base64( salt[4 bytes] || ciphertext )
 */

const SHARED_SECRET = 'rt-7c6bff-2026';

function deriveKey(saltBytes) {
  // Mix the secret with the salt into a longer key by chaining XORs.
  const secret = Buffer.from(SHARED_SECRET, 'utf8');
  const key = Buffer.alloc(secret.length);
  for (let i = 0; i < secret.length; i++) {
    key[i] = secret[i] ^ saltBytes[i % saltBytes.length];
  }
  return key;
}

function encodeUrl(plainUrl) {
  if (!plainUrl) return '';
  const url = Buffer.from(plainUrl, 'utf8');
  // 4 random salt bytes — different every call, even for the same URL
  const salt = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) salt[i] = Math.floor(Math.random() * 256);
  const key = deriveKey(salt);
  const cipher = Buffer.alloc(url.length);
  for (let i = 0; i < url.length; i++) {
    cipher[i] = url[i] ^ key[i % key.length];
  }
  return Buffer.concat([salt, cipher]).toString('base64');
}

module.exports = { encodeUrl };
