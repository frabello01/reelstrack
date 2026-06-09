import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { detectMetaWebview, openExternal } from '../lib/metaEscape';
import { decodeUrl } from '../lib/linkCipher';
import './PublicRedirectPage.css';

/*
 * Short-URL redirect renderer.
 *
 * Two visual states:
 *   1. Spinner       — fetching, OR fetched & no age-gate (bouncing now)
 *   2. Age-gate card — fetched & age_gate === true; user must confirm
 *                      they are 18+ before we bounce.
 *
 * Like our landing pages, the destination URL never lives in plaintext
 * inside React state — it ships XOR-obfuscated under "u" and we only
 * decode at the moment of navigation, after the click is recorded.
 *
 * Webview escape is handled by openExternal() — same code path
 * landings use. Instagram/Threads in-app browsers get popped to the
 * system browser; Android uses intent://, iOS uses extbrowser:// for
 * IG/Threads, long-press splash for Facebook.
 */

const DECLINE_MESSAGE = 'Hai indicato di non essere maggiorenne. Questo contenuto non è accessibile.';

function setMinimalHead(title) {
  if (typeof document === 'undefined') return;
  document.title = title || 'Redirect';
  // Don't allow search engines to index these short links.
  let robots = document.head.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement('meta');
    robots.setAttribute('name', 'robots');
    document.head.appendChild(robots);
  }
  robots.setAttribute('content', 'noindex, nofollow');
}

export default function PublicRedirectPage() {
  const { slug } = useParams();
  const [link, setLink] = useState(null);   // { id, slug, title, age_gate, u }
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [declined, setDeclined] = useState(false);
  const metaPlatformRef = useRef(null);
  const bouncedRef = useRef(false);          // never bounce twice (covers pageshow re-runs)

  useEffect(() => {
    metaPlatformRef.current = detectMetaWebview();
    setMinimalHead('Redirect');
  }, []);

  // Lookup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api.getPublicRedirect(slug);
        if (cancelled) return;
        setLink(data);
        if (data?.title) setMinimalHead(data.title);

        // No age gate → bounce immediately.
        if (!data.age_gate) {
          fireBounce(data, { ageConfirmed: null });
        }
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Link non trovato');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Re-bounce if the page comes back from bfcache (back button on iOS Safari).
  // Without this the user lands on a frozen "redirecting…" spinner.
  useEffect(() => {
    const handler = () => {
      if (link && !link.age_gate && !bouncedRef.current) {
        fireBounce(link, { ageConfirmed: null });
      }
    };
    window.addEventListener('pageshow', handler);
    return () => window.removeEventListener('pageshow', handler);
  }, [link]);

  const fireBounce = (linkData, { ageConfirmed }) => {
    if (bouncedRef.current) return;
    bouncedRef.current = true;

    // Record the click — fire-and-forget. We do this BEFORE the bounce
    // so analytics doesn't depend on whether the user returns.
    try {
      const url = new URL(window.location.href);
      api.recordRedirectClick(linkData.id, {
        meta_platform: metaPlatformRef.current,
        referrer: document.referrer || null,
        utm_source: url.searchParams.get('utm_source') || null,
        age_gate_confirmed: ageConfirmed,
      }).catch(() => {});
    } catch {}

    // Decode the destination URL only NOW, the instant before we navigate.
    // It never lives in React state, the DOM, or anywhere a scraper bot
    // can dump it.
    const dest = decodeUrl(linkData.u);
    if (!dest) {
      setError('Destinazione non valida');
      return;
    }
    // Small delay lets the click POST flush.
    setTimeout(() => openExternal(dest), 30);
  };

  const handleConfirmAge = () => fireBounce(link, { ageConfirmed: true });
  const handleDeclineAge = () => {
    bouncedRef.current = true; // don't allow accidental bypass
    setDeclined(true);
    // Record the decline so analytics shows funnel drop-off.
    try {
      api.recordRedirectClick(link.id, {
        meta_platform: metaPlatformRef.current,
        referrer: document.referrer || null,
        age_gate_confirmed: false,
      }).catch(() => {});
    } catch {}
  };

  // === RENDER ===

  if (error) {
    return (
      <div className="rd-shell rd-error">
        <AlertTriangle size={42} />
        <h1>Link non trovato</h1>
        <p>Il link che hai aperto non esiste o è stato disattivato.</p>
      </div>
    );
  }

  if (declined) {
    return (
      <div className="rd-shell rd-error">
        <ShieldAlert size={42} />
        <h1>Accesso negato</h1>
        <p>{DECLINE_MESSAGE}</p>
      </div>
    );
  }

  if (loading || !link) {
    return (
      <div className="rd-shell rd-loading">
        <div className="rd-spinner" />
      </div>
    );
  }

  // age_gate === true: show the confirmation card.
  if (link.age_gate) {
    return (
      <div className="rd-shell rd-gate">
        <div className="rd-gate-card">
          <div className="rd-gate-icon"><ShieldAlert size={28} /></div>
          <h1>Contenuto maturo</h1>
          <p className="rd-gate-body">
            Questo link contiene contenuti riservati a un pubblico adulto.
          </p>
          <p className="rd-gate-question">
            Confermi di avere almeno <strong>18 anni</strong>?
          </p>
          <div className="rd-gate-actions">
            <button className="rd-btn rd-btn-secondary" onClick={handleDeclineAge}>
              No, ho meno di 18 anni
            </button>
            <button className="rd-btn rd-btn-primary" onClick={handleConfirmAge}>
              Sì, ho almeno 18 anni
            </button>
          </div>
          <p className="rd-gate-fineprint">
            Confermando dichiari sotto la tua responsabilità di essere maggiorenne secondo
            la legge del tuo Paese.
          </p>
        </div>
      </div>
    );
  }

  // No age gate — already bouncing. Spinner.
  return (
    <div className="rd-shell rd-loading">
      <div className="rd-spinner" />
    </div>
  );
}
