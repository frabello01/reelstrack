/*
 * Vercel Edge Middleware — runs on every incoming request before any
 * static file is served. Its only job is to make social-share previews
 * (WhatsApp, IG, Telegram, FB, X, Slack, Discord) and search-engine
 * crawlers see the correct title, favicon, and OG image for each
 * landing page — because crawlers never execute JavaScript.
 *
 * For human visitors, we ALSO inject the same meta tags so the browser
 * tab shows the right title/favicon immediately (no "ReelsTrack App"
 * flash before React mounts).
 *
 * The middleware looks up the landing through the public backend
 * endpoint we already exposed (no auth, any origin), then rewrites
 * <title>, <link rel="icon">, and the OG/Twitter meta tags in the
 * cached copy of index.html, returning the modified HTML.
 *
 * If anything goes wrong (API unreachable, slug not found, etc.) we
 * pass through silently — the SPA will then render its own "Profilo
 * non trovato" state from the client.
 */

export const config = {
  // Run on every path EXCEPT obvious static assets and the API surface.
  // We can't list specific landing slugs because admins create them
  // dynamically — so we match everything and bail out internally for
  // non-landing requests.
  matcher:
    '/((?!api/|assets/|favicon\\.png|favicon\\.ico|logo\\.png|robots\\.txt|sitemap\\.xml|.*\\.(?:js|css|map|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf)).*)',
};

const ADMIN_HOSTS = new Set([
  'app.reelstrack.io',
  'localhost',
  '127.0.0.1',
]);

// Backend API base. We prefer the explicit middleware env var, then fall
// back to the same VITE_ var the SPA uses, then a sensible default so the
// middleware works even before any env wiring is done.
const API_BASE =
  process.env.LANDING_API_BASE ||
  process.env.VITE_API_URL ||
  'https://reels-tracker-backend.onrender.com';

// Slugs reserved for the admin SPA — never treat these as landings.
const ADMIN_PATHS = new Set([
  '', 'login', 'signup', 'share',
  'lists', 'explore', 'todos', 'my-accounts', 'my-creators',
  'converter', 'my-day', 'guides', 'lessons', 'image-cleaner',
  'batch-cleaner', 'characters', 'studio', 'settings', 'team',
  'log', 'landings',
]);

export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname;

    const isAdminHost = ADMIN_HOSTS.has(hostname);

    // Determine which slug (if any) this request is asking for.
    let slug = null;
    if (isAdminHost) {
      // On the admin app, only /p/<slug> is a public landing page.
      const m = pathname.match(/^\/p\/([^\/?#]+)/);
      if (m) slug = m[1];
    } else {
      // On any custom domain, the first path segment IS the slug
      // (unless it's the support /p/<slug> alias).
      const m = pathname.match(/^\/(?:p\/)?([^\/?#]+)/);
      if (m) slug = m[1];
    }

    if (!slug) return;                       // root / not a landing path
    if (ADMIN_PATHS.has(slug)) return;       // reserved admin route

    // Fetch the landing record from the backend.
    const apiUrl =
      `${API_BASE}/api/landings/public/lookup` +
      `?host=${encodeURIComponent(hostname)}` +
      `&slug=${encodeURIComponent(slug)}`;

    let landing;
    try {
      const apiRes = await fetch(apiUrl, { headers: { accept: 'application/json' } });
      if (!apiRes.ok) return; // landing not found — let the SPA show its 404 state
      landing = await apiRes.json();
    } catch {
      return; // network error — fail open
    }

    // Fetch the canonical index.html that Vercel would have served.
    let indexRes;
    try {
      indexRes = await fetch(`${url.origin}/index.html`);
    } catch {
      return;
    }
    if (!indexRes.ok) return;
    let html = await indexRes.text();

    // Inject metadata.
    const title = escapeHtml(landing.title || 'Profile');
    const description = escapeHtml(
      landing.bio || landing.subtitle || `${landing.title || 'Profile'} — official links`
    );
    const image = landing.background_url || landing.avatar_url || '';
    const fullUrl = url.origin + pathname;

    const metaBlock = [
      `<title>${title}</title>`,
      `<meta name="description" content="${description}" />`,
      image ? `<link rel="icon" type="image/jpeg" href="${escapeHtml(image)}" />` : '',
      image ? `<link rel="apple-touch-icon" href="${escapeHtml(image)}" />` : '',
      `<meta property="og:type" content="profile" />`,
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:description" content="${description}" />`,
      `<meta property="og:url" content="${escapeHtml(fullUrl)}" />`,
      image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : '',
      image ? `<meta name="twitter:card" content="summary_large_image" />`
            : `<meta name="twitter:card" content="summary" />`,
      `<meta name="twitter:title" content="${title}" />`,
      `<meta name="twitter:description" content="${description}" />`,
      image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : '',
    ].filter(Boolean).join('\n    ');

    // Strip the default <title> and the default favicon link, then
    // inject the new block just before </head>.
    html = html
      .replace(/<title>[^<]*<\/title>/i, '')
      .replace(/<link\s+rel=["']icon["'][^>]*>/i, '')
      .replace('</head>', `    ${metaBlock}\n  </head>`);

    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Short edge cache — admin can update a landing and changes
        // propagate quickly. CDN cache 5 min, browser cache 1 min.
        'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
      },
    });
  } catch {
    // Any unexpected failure — fail open and serve the default index.
    return;
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
