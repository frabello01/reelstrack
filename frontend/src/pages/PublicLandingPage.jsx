import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { detectMetaWebview, openExternal } from '../lib/metaEscape';
import { decodeUrl } from '../lib/linkCipher';
import VerifiedBadge from '../components/VerifiedBadge';
import './PublicLandingPage.css';

// ---------- <head> metadata helpers -----------------------------------
// We rewrite the page's <title>, <link rel="icon">, and OG / Twitter meta
// tags AFTER the landing data lands. This handles the browser-tab + bookmark
// case for real users. Crawlers (WhatsApp / IG preview / Telegram / X /
// Facebook) don't run JS — for them, the Vercel Edge middleware injects
// the same metadata into the HTML before it leaves the edge.
function applyHeadMetadata(landing) {
  if (!landing || typeof document === 'undefined') return;
  const title = landing.title || 'Profile';
  const description = landing.bio || landing.subtitle || `${title} — official links`;
  const image = landing.background_url || landing.avatar_url || '';
  const url = typeof window !== 'undefined' ? window.location.href : '';

  document.title = title;

  // Favicon: prefer the landing's avatar; fall back to background.
  if (image) {
    upsertLink('icon', image);
    upsertLink('apple-touch-icon', image);
  }

  upsertMeta('name', 'description', description);
  upsertMeta('property', 'og:type', 'profile');
  upsertMeta('property', 'og:title', title);
  upsertMeta('property', 'og:description', description);
  upsertMeta('property', 'og:url', url);
  if (image) upsertMeta('property', 'og:image', image);
  upsertMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
  upsertMeta('name', 'twitter:title', title);
  upsertMeta('name', 'twitter:description', description);
  if (image) upsertMeta('name', 'twitter:image', image);
}

function upsertMeta(keyAttr, keyValue, content) {
  let el = document.head.querySelector(`meta[${keyAttr}="${keyValue}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(keyAttr, keyValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export default function PublicLandingPage() {
  const { slug } = useParams();
  const [landing, setLanding] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [ageGateLink, setAgeGateLink] = useState(null);
  const metaPlatformRef = useRef(null);

  useEffect(() => {
    metaPlatformRef.current = detectMetaWebview();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const host = window.location.hostname;
        const data = await api.getPublicLanding(host, slug);
        if (cancelled) return;
        setLanding(data);
        applyHeadMetadata(data);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Profile not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const handleLinkClick = (link) => {
    if (link.age_gate || landing?.age_gate_default) {
      setAgeGateLink(link);
      return;
    }
    fireLinkOpen(link);
  };

  const fireLinkOpen = (link) => {
    try { api.recordLandingClick(link.id, metaPlatformRef.current); } catch {}
    // The plaintext URL never lives in React state — decode it ONLY here,
    // moments before navigating. A bot that dumps the rendered DOM or the
    // React fiber tree won't find any usable URL anywhere on the page.
    const dest = decodeUrl(link.u);
    if (!dest) return;
    setTimeout(() => openExternal(dest), 30);
  };

  if (loading) {
    return (
      <div className="pl-shell pl-loading">
        <div className="pl-spinner" />
      </div>
    );
  }
  if (error || !landing) {
    return (
      <div className="pl-shell pl-error">
        <AlertTriangle size={42} />
        <h1>Profilo non trovato</h1>
        <p>Il link che hai aperto non esiste o è stato disattivato.</p>
      </div>
    );
  }

  const accent = landing.theme?.accent || '#7c6bff';
  const bgImage = landing.background_url || landing.avatar_url;

  return (
    <div
      className={`pl-shell ${bgImage ? 'pl-has-image' : 'pl-no-image'}`}
      style={{ '--pl-accent': accent }}
    >
      {/* Fixed full-viewport image — content scrolls over it (parallax-ish feel) */}
      {bgImage && (
        <div
          className="pl-bg"
          style={{ backgroundImage: `url(${bgImage})` }}
          aria-hidden
        />
      )}

      {/* ONE continuous gradient overlay — transparent up top, deep at bottom */}
      <div className="pl-overlay" aria-hidden />

      {/* Subtle corner vignette for cinematic finish */}
      <div className="pl-vignette" aria-hidden />

      <main className="pl-stage">
        {/* Spacer pushes content downward — content sits in lower portion of hero */}
        <div className="pl-spacer" />

        <section className="pl-content">
          <h1 className="pl-title">
            <span className="pl-title-text">{landing.title}</span>
            {landing.verified && (
              <VerifiedBadge size={28} color={accent} className="pl-verified" />
            )}
          </h1>
          {landing.subtitle && <div className="pl-subtitle">{landing.subtitle}</div>}
          {landing.bio && <p className="pl-bio">{landing.bio}</p>}
        </section>

        <section className="pl-links">
          {landing.links.length === 0 && (
            <div className="pl-empty">Nessun link disponibile.</div>
          )}
          {landing.links.map((link, i) => (
            <button
              key={link.id}
              className={`pl-link ${link.animation === 'bounce' ? 'pl-link-bounce' : ''}`}
              style={{ animationDelay: `${0.18 + i * 0.06}s` }}
              onClick={() => handleLinkClick(link)}
              type="button"
            >
              <span className="pl-link-icon">
                {link.icon || <ChevronRight size={16} strokeWidth={2.5} />}
              </span>
              <span className="pl-link-label">{link.label}</span>
              <ChevronRight size={18} className="pl-link-arrow" strokeWidth={2.25} />
            </button>
          ))}
        </section>

        <footer className="pl-footer">
          <span>© {new Date().getFullYear()} · {landing.title}</span>
        </footer>
      </main>

      {ageGateLink && (
        <AgeGateModal
          accent={accent}
          onConfirm={() => {
            const link = ageGateLink;
            setAgeGateLink(null);
            fireLinkOpen(link);
          }}
          onCancel={() => setAgeGateLink(null)}
        />
      )}
    </div>
  );
}

function AgeGateModal({ accent, onConfirm, onCancel }) {
  return (
    <div className="pl-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="pl-modal" role="dialog" aria-modal="true">
        <div className="pl-modal-icon" style={{ background: `${accent}22`, color: accent }}>
          18+
        </div>
        <h2 className="pl-modal-title">Contenuto maturo</h2>
        <p className="pl-modal-body">
          Questo link contiene contenuti riservati a un pubblico adulto.
          <br />
          Confermi di avere almeno 18 anni?
        </p>
        <div className="pl-modal-actions">
          <button className="pl-modal-btn pl-modal-cancel" onClick={onCancel} type="button">
            No, esco
          </button>
          <button
            className="pl-modal-btn pl-modal-confirm"
            onClick={onConfirm}
            style={{ background: accent }}
            type="button"
          >
            Sì, ho 18+
          </button>
        </div>
      </div>
    </div>
  );
}
