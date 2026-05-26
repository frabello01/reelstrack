/*
 * Client-side counterpart to backend/lib/linkCipher.js.
 *
 * Encoded payload format: base64( salt[4 bytes] || ciphertext )
 * Algorithm: same XOR-with-derived-key the backend uses.
 *
 * IMPORTANT: this is obfuscation, not encryption. Anyone determined
 * enough to read our minified JS bundle can re-implement decode() in a
 * minute. The point is to defeat passive scraping — anyone who wants
 * URLs has to run our code (or read our code), not just grep our JSON.
 */

const SHARED_SECRET = 'rt-7c6bff-2026';

function strToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function deriveKey(saltBytes) {
  const secret = strToBytes(SHARED_SECRET);
  const key = new Uint8Array(secret.length);
  for (let i = 0; i < secret.length; i++) {
    key[i] = secret[i] ^ saltBytes[i % saltBytes.length];
  }
  return key;
}

export function decodeUrl(encoded) {
  if (!encoded) return '';
  try {
    const raw = atob(encoded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    if (bytes.length < 5) return '';
    const salt = bytes.slice(0, 4);
    const cipher = bytes.slice(4);
    const key = deriveKey(salt);
    let out = '';
    for (let i = 0; i < cipher.length; i++) {
      out += String.fromCharCode(cipher[i] ^ key[i % key.length]);
    }
    return out;
  } catch {
    return '';
  }
}
