import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { BadgeCheck, ChevronRight, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { detectMetaWebview, openExternal } from '../lib/metaEscape';
import './PublicLandingPage.css';

export default function PublicLandingPage() {
  const { slug } = useParams();
  const [landing, setLanding] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [ageGateLink, setAgeGateLink] = useState(null); // the link awaiting confirmation
  const metaPlatformRef = useRef(null);

  // ---- Bootstrap: detect platform once, fetch landing ----
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
        // Set <title> and og tags so when shared the page looks right
        document.title = data.title || 'Profile';
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Profile not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // ---- Click handling ----
  const handleLinkClick = (link) => {
    // Always re-confirm on every click — no session memory (per spec).
    if (link.age_gate || landing?.age_gate_default) {
      setAgeGateLink(link);
      return;
    }
    fireLinkOpen(link);
  };

  const fireLinkOpen = (link) => {
    // Record the click — fire and forget, don't block navigation.
    try {
      api.recordLandingClick(link.id, metaPlatformRef.current);
    } catch {}
    // Small delay to let the POST start before we navigate away.
    setTimeout(() => openExternal(link.url), 30);
  };

  // ---- Render ----
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
  const cardBg = landing.theme?.cardBg || 'rgba(255,255,255,0.08)';
  const cardBorder = landing.theme?.cardBorder || 'rgba(255,255,255,0.12)';
  const textColor = landing.theme?.textColor || '#ffffff';
  const bgImage = landing.background_url || landing.avatar_url;

  return (
    <div className="pl-shell" style={{ '--pl-accent': accent, '--pl-text': textColor }}>
      {/* Full-bleed background — blurred copy of bg/avatar for visual richness */}
      {bgImage && (
        <div
          className="pl-bg-blur"
          style={{ backgroundImage: `url(${bgImage})` }}
          aria-hidden
        />
      )}
      <div className="pl-bg-tint" aria-hidden />

      <main className="pl-card">
        {/* Hero photo + dark fade */}
        <div className="pl-hero">
          {bgImage && (
            <div
              className="pl-hero-photo"
              style={{ backgroundImage: `url(${bgImage})` }}
            />
          )}
          <div className="pl-hero-fade" />
          <div className="pl-hero-content">
            <h1 className="pl-title">
              <span>{landing.title}</span>
              {landing.verified && (
                <BadgeCheck
                  size={28}
                  className="pl-verified"
                  fill={accent}
                  color="#fff"
                  strokeWidth={2.5}
                />
              )}
            </h1>
            {landing.subtitle && <div className="pl-subtitle">{landing.subtitle}</div>}
            {landing.bio && <p className="pl-bio">{landing.bio}</p>}
          </div>
        </div>

        {/* Links */}
        <div className="pl-links">
          {landing.links.length === 0 && (
            <div className="pl-empty">Nessun link disponibile.</div>
          )}
          {landing.links.map((link, i) => (
            <button
              key={link.id}
              className="pl-link"
              style={{
                animationDelay: `${0.05 + i * 0.05}s`,
                background: cardBg,
                borderColor: cardBorder,
              }}
              onClick={() => handleLinkClick(link)}
              type="button"
            >
              <span className="pl-link-icon" style={{ background: `${accent}22`, color: accent }}>
                {link.icon || '›'}
              </span>
              <span className="pl-link-label">{link.label}</span>
              <ChevronRight size={18} className="pl-link-arrow" />
            </button>
          ))}
        </div>

        <footer className="pl-footer">
          <span>© {new Date().getFullYear()} {landing.title}</span>
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
