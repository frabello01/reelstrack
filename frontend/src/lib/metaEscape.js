/*
 * Meta-webview escape — breaks the visitor out of Instagram / Threads /
 * Facebook in-app browsers into the system default browser, so the link
 * actually opens where the user expects.
 *
 * Mirrors the Bouncy.ai technique that biancajorio.com uses in
 * production. The private URI schemes were reverse-engineered against
 * real device tests — if Meta ever patches them, edit the SCHEME_*
 * constants here and redeploy. Nothing else needs to change.
 */

const SCHEME_INSTAGRAM = 'instagram://extbrowser/?url=';
const SCHEME_THREADS = 'barcelona://extbrowser/?url='; // Threads' internal codename

/**
 * Detect which Meta in-app browser (if any) we're sitting inside.
 * Returns 'instagram' | 'threads' | 'facebook' | null.
 */
export function detectMetaWebview() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  // Check Barcelona (Threads) BEFORE Instagram — Threads UAs may contain
  // both tokens since Threads is built on IG's codebase.
  if (/Barcelona/i.test(ua)) return 'threads';
  if (/FBAN|FBAV/i.test(ua)) return 'facebook';
  if (/Instagram/i.test(ua)) return 'instagram';
  return null;
}

export function isIOS() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  return /iPhone|iPad|iPod/i.test(ua);
}

export function isAndroid() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  return /Android/i.test(ua);
}

function normaliseUrl(u) {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/**
 * Build an Android intent:// URL that asks the OS to open `dest` in the
 * default browser, with a graceful fallback to the original URL if
 * something goes wrong.
 */
function buildIntentUrl(dest) {
  const u = new URL(dest);
  const host = u.host;
  const path = (u.pathname || '/') + (u.search || '') + (u.hash || '');
  const scheme = u.protocol.replace(':', '');
  return `intent://${host}${path}#Intent;scheme=${scheme};` +
    `S.browser_fallback_url=${encodeURIComponent(dest)};end`;
}

/**
 * Renders the iOS Facebook press-and-hold splash. There's no private
 * scheme that works for FB iOS — the only reliable break-out is to make
 * the user long-press a real <a href>, which triggers iOS's native
 * context menu containing "Open in Browser".
 */
function showFacebookSplash(dest) {
  const root = document.createElement('div');
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:32px', 'padding:32px', 'background:#0a0a0f',
    'font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif', 'color:#fff', 'text-align:center',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'Apri questo link';
  title.style.cssText = 'font-size:22px;font-weight:600;';

  const a = document.createElement('a');
  a.href = dest;
  a.textContent = 'Continua';
  a.style.cssText = [
    'display:inline-block', 'padding:18px 64px',
    'font-size:17px', 'font-weight:600',
    'color:#0a0a0f', 'background:#fff',
    'border-radius:50px', 'text-decoration:none',
    'box-shadow:0 4px 24px rgba(0,0,0,0.3)',
  ].join(';');
  // Prevent normal navigation — the user must press-and-hold to get
  // the iOS context menu with "Open in Browser".
  a.addEventListener('click', (e) => e.preventDefault());

  const hint = document.createElement('div');
  hint.textContent = 'Tieni premuto il pulsante per 3 secondi e scegli "Apri in browser"';
  hint.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.6);max-width:300px;line-height:1.5;';

  root.appendChild(title);
  root.appendChild(a);
  root.appendChild(hint);
  document.body.appendChild(root);
}

/**
 * Send the user to `destUrl`, escaping any Meta in-app browser we
 * happen to be sitting inside. Returns true if we handled it, false if
 * the caller should perform the default navigation themselves.
 */
export function openExternal(destUrl) {
  if (!destUrl) return false;
  const dest = normaliseUrl(destUrl);
  const platform = detectMetaWebview();

  // Not inside a Meta app — just navigate normally.
  if (!platform) {
    window.location.href = dest;
    return true;
  }

  // Android: intent:// is the universal answer for all three Meta apps.
  if (isAndroid()) {
    window.location.href = buildIntentUrl(dest);
    return true;
  }

  // iOS — Instagram + Threads have private extbrowser schemes.
  if (isIOS()) {
    if (platform === 'instagram') {
      window.location.replace(SCHEME_INSTAGRAM + encodeURIComponent(dest));
      return true;
    }
    if (platform === 'threads') {
      window.location.replace(SCHEME_THREADS + encodeURIComponent(dest));
      return true;
    }
    if (platform === 'facebook') {
      showFacebookSplash(dest);
      return true;
    }
  }

  // Unknown desktop-ish webview — best effort: navigate normally.
  window.location.href = dest;
  return true;
}
