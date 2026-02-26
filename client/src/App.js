import React, { useState, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { supabase } from './supabase';

// ── Palette ────────────────────────────────────────────────────────────────────
const P = {
  paper:       '#F6F3EE',
  surface:     '#FFFEFC',
  border:      '#E7E1D8',
  ink:         '#1C1917',
  muted:       '#6B645C',
  accent:      '#2D6CDF',
  accentHover: '#2459B8',
  accentLight: 'rgba(45,108,223,0.08)',
  success:     '#0F766E',
  warning:     '#B45309',
  error:       '#B42318',
};

const LANGUAGES = [
  { code: 'en',      label: 'English' },
  { code: 'es',      label: 'Spanish' },
  { code: 'fr',      label: 'French' },
  { code: 'de',      label: 'German' },
  { code: 'it',      label: 'Italian' },
  { code: 'pt',      label: 'Portuguese' },
  { code: 'ru',      label: 'Russian' },
  { code: 'zh-Hans', label: 'Chinese (Simplified)' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)' },
  { code: 'ja',      label: 'Japanese' },
  { code: 'ko',      label: 'Korean' },
  { code: 'ar',      label: 'Arabic' },
  { code: 'hi',      label: 'Hindi' },
  { code: 'tr',      label: 'Turkish' },
  { code: 'nl',      label: 'Dutch' },
  { code: 'pl',      label: 'Polish' },
];

const DEMO_CHIPS = [
  'Summarize the video',
  'What are the key points?',
  'What questions does this video answer?',
  'What is the main argument?',
];

const BRAND_NAME = 'ScribeSnap';
const BRAND_LOGO_SRC = '/logo-wordmark.png';
const FOOTER_LOGO_SRC = '/scribesnap_wordmark_footer.svg';
const CANONICAL_APP_ORIGIN = 'https://scribesnap.ai';
const CANONICAL_APP_HOST = new URL(CANONICAL_APP_ORIGIN).hostname.toLowerCase();
const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1']);
const PLATFORM_BRAND = {
  youtube: {
    icon: '#FF0000',
    stat: '#1F6BFF',
    bg: 'rgba(123,211,255,0.22)',
    bgSoft: 'rgba(123,211,255,0.18)',
  },
  vimeo: {
    icon: '#1AB7EA',
    stat: '#3C8CFF',
    bg: 'rgba(60,140,255,0.16)',
    bgSoft: 'rgba(60,140,255,0.14)',
  },
};

function getAuthRedirectUrl() {
  if (typeof window === 'undefined') return CANONICAL_APP_ORIGIN;
  const { hostname, origin } = window.location;
  if (LOCAL_DEV_HOSTS.has(hostname.toLowerCase())) return origin;
  return CANONICAL_APP_ORIGIN;
}

function getPasswordResetRedirectUrl() {
  const base = getAuthRedirectUrl();
  try {
    const u = new URL(base);
    u.searchParams.set('reset', '1');
    return u.toString();
  } catch {
    return `${base}?reset=1`;
  }
}

const AUTH_URL_KEYS = [
  'access_token',
  'refresh_token',
  'expires_at',
  'expires_in',
  'token_type',
  'provider_token',
  'provider_refresh_token',
  'code',
  'token_hash',
  'type',
  'mode',
  'action',
  'reset',
  'error',
  'error_code',
  'error_description',
  'state',
  'sb',
];

function getAuthUrlState() {
  if (typeof window === 'undefined') return { hasAuthParams: false, isRecovery: false, tokenHash: '' };
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  const getParam = (key) => searchParams.get(key) || hashParams.get(key) || '';

  const hasAuthParams = AUTH_URL_KEYS.some((k) => searchParams.has(k) || hashParams.has(k));
  const hasBlockingAuthParams = [
    'access_token',
    'refresh_token',
    'code',
    'token_hash',
    'provider_token',
    'provider_refresh_token',
  ].some((k) => searchParams.has(k) || hashParams.has(k));
  const type = getParam('type').toLowerCase();
  const mode = getParam('mode').toLowerCase();
  const action = getParam('action').toLowerCase();
  const resetFlag = getParam('reset').toLowerCase();
  const tokenHash = getParam('token_hash');
  const isRecovery = type === 'recovery' || mode === 'recovery' || mode === 'reset' || action === 'reset_password' || resetFlag === '1' || resetFlag === 'true';

  return { hasAuthParams, hasBlockingAuthParams, isRecovery, tokenHash };
}

function cleanupAuthUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams((url.hash || '').replace(/^#/, ''));

  let changed = false;
  AUTH_URL_KEYS.forEach((k) => {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k);
      changed = true;
    }
    if (hashParams.has(k)) {
      hashParams.delete(k);
      changed = true;
    }
  });
  if (!changed) return;

  const search = url.searchParams.toString();
  const hash = hashParams.toString();
  const nextUrl = `${url.pathname}${search ? `?${search}` : ''}${hash ? `#${hash}` : ''}`;
  window.history.replaceState({}, document.title, nextUrl);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Returns { platform: 'youtube'|'vimeo', id, url } or null
function parseVideoUrl(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // Vimeo
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes('vimeo.com')) {
      const m = u.pathname.match(/\/(\d+)/);
      if (m) return { platform: 'vimeo', id: m[1], url: `https://vimeo.com/${m[1]}` };
    }
  } catch {}

  // YouTube bare ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed))
    return { platform: 'youtube', id: trimmed, url: `https://youtube.com/watch?v=${trimmed}` };

  // YouTube URL
  try {
    const u = new URL(trimmed);
    let id = u.searchParams.get('v');
    if (!id && u.hostname === 'youtu.be') id = u.pathname.slice(1).split('?')[0];
    if (!id) {
      const m = u.pathname.match(/\/(shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) id = m[2];
    }
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(id))
      return { platform: 'youtube', id, url: `https://youtube.com/watch?v=${id}` };
  } catch {}

  return null;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatVideoDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min ${s} sec`;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function fetchVideoMeta(platform, canonicalUrl) {
  const endpoints = platform === 'vimeo'
    ? [
        `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(canonicalUrl)}`,
        `https://noembed.com/embed?url=${encodeURIComponent(canonicalUrl)}`,
      ]
    : [
        `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
        `https://noembed.com/embed?url=${encodeURIComponent(canonicalUrl)}`,
      ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) continue;
      const data = await res.json();
      return {
        title: (data.title || '').trim(),
        channel: (data.author_name || '').trim(),
        thumbnail: data.thumbnail_url || null,
      };
    } catch {}
  }

  return { title: '', channel: '', thumbnail: null };
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const DownloadIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);
const ChevronIcon = ({ size = 13, dir = 'down' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: dir === 'up' ? 'rotate(180deg)' : dir === 'left' ? 'rotate(90deg)' : 'none' }}>
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);
const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const SpinnerIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    style={{ animation: 'spin 0.8s linear infinite' }}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);
const YouTubeIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={PLATFORM_BRAND.youtube.icon}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);
const VimeoIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={PLATFORM_BRAND.vimeo.icon}>
    <path d="M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L5.322 11.4C4.603 8.816 3.834 7.522 3.01 7.522c-.179 0-.806.378-1.881 1.132L0 7.197c1.185-1.044 2.351-2.084 3.501-3.128C5.08 2.701 6.266 1.984 7.055 1.91c1.867-.18 3.016 1.1 3.447 3.838.465 2.953.789 4.789.971 5.507.539 2.45 1.131 3.674 1.776 3.674.502 0 1.256-.796 2.265-2.385 1.004-1.589 1.54-2.797 1.612-3.628.144-1.371-.395-2.061-1.614-2.061-.574 0-1.167.121-1.777.391 1.186-3.868 3.434-5.757 6.762-5.637 2.473.06 3.628 1.664 3.48 4.807z"/>
  </svg>
);
const GitHubIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);
const BrandLogo = ({ height = 36 }) => (
  <img
    src={BRAND_LOGO_SRC}
    alt={BRAND_NAME}
    style={{ height, width: 'auto', display: 'block' }}
  />
);

// ── Referral Promo Modal ───────────────────────────────────────────────────────
const ReferralPromoModal = ({ user, onClose }) => {
  const [copied, setCopied] = React.useState(false);
  const refLink = `${window.location.origin}?ref=${user.id}`;
  const shareText = `Check out ScribeSnap — it extracts YouTube transcripts in seconds! Sign up with my link and we both get +3 free credits: ${refLink}`;
  const tweetText = `I use ScribeSnap to get YouTube transcripts instantly 🎬 Try it free — use my invite link and we both get bonus credits 👉 ${refLink}`;
  const emailSubject = 'Try ScribeSnap — free YouTube transcript tool';
  const copyLink = () => { navigator.clipboard.writeText(refLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  const shareWA    = () => window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  const shareX     = () => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`, '_blank');
  const shareEmail = () => window.open(`mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(shareText)}`, '_blank');

  const shareBtn = (onClick, border, bg, hoverBg, color, icon, label) => (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
      borderRadius: 10, border, background: bg, color,
      fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s', flex: 1,
    }}
      onMouseEnter={e => { e.currentTarget.style.background = hoverBg; }}
      onMouseLeave={e => { e.currentTarget.style.background = bg; }}
    >{icon}{label}</button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(28,25,23,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: '100%', maxWidth: 420, background: P.surface, borderRadius: 20, border: `1px solid ${P.border}`, boxShadow: '0 24px 80px rgba(28,25,23,0.2)', overflow: 'hidden', animation: 'fadeUp 0.3s ease' }}>
        <div style={{ height: 4, background: 'linear-gradient(90deg, #2D6CDF, #5B9FFF)' }} />
        <div style={{ padding: '22px 22px 26px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(45,108,223,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2D6CDF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/>
                  <line x1="12" y1="22" x2="12" y2="7"/>
                  <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
                  <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
                </svg>
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: P.ink }}>Get more free credits</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: P.muted }}>Invite friends · earn +3 credits per signup</p>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: P.muted, fontSize: 20, lineHeight: 1, padding: '0 2px', transition: 'color 0.15s', flexShrink: 0 }}
              onMouseEnter={e => { e.currentTarget.style.color = P.ink; }}
              onMouseLeave={e => { e.currentTarget.style.color = P.muted; }}
            >×</button>
          </div>

          <div style={{ background: P.paper, borderRadius: 10, border: `1px solid ${P.border}`, padding: '9px 12px', marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: P.muted, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 3 }}>Your invite link</div>
            <div style={{ fontSize: 12, color: P.ink, wordBreak: 'break-all' }}>{refLink}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {shareBtn(shareWA,
              '1px solid rgba(37,211,102,0.3)', 'rgba(37,211,102,0.07)', 'rgba(37,211,102,0.14)', '#128C7E',
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>,
              'WhatsApp'
            )}
            {shareBtn(shareX,
              '1px solid rgba(0,0,0,0.13)', 'rgba(0,0,0,0.04)', 'rgba(0,0,0,0.09)', P.ink,
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>,
              'Share on X'
            )}
            {shareBtn(shareEmail,
              `1px solid ${P.border}`, P.paper, P.surface, P.ink,
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>,
              'Email'
            )}
            {shareBtn(copyLink,
              copied ? '1px solid rgba(15,118,110,0.3)' : `1px solid ${P.border}`,
              copied ? 'rgba(15,118,110,0.08)' : P.paper,
              copied ? 'rgba(15,118,110,0.08)' : P.surface,
              copied ? '#0F766E' : P.ink,
              copied
                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
              copied ? 'Copied!' : 'Copy link'
            )}
          </div>
          <p style={{ margin: 0, fontSize: 11, color: P.muted, textAlign: 'center' }}>
            Both you and your friend get <strong style={{ color: P.accent }}>+3 free credits</strong> automatically on signup
          </p>
        </div>
      </div>
    </div>
  );
};

// ── Credits ───────────────────────────────────────────────────────────────────
const CREDITS_FREE = 6;   // not signed in
const CREDITS_MAX  = 20;  // signed in
const CREDITS_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function initCredits() {
  try {
    const max = CREDITS_FREE;
    let stored = JSON.parse(localStorage.getItem('yte_credits') || 'null');
    if (!stored || typeof stored.resetAt !== 'number' || Date.now() > stored.resetAt) {
      stored = { used: 0, resetAt: Date.now() + CREDITS_PERIOD_MS };
    }
    if (stored.used > max) stored = { ...stored, used: max };
    stored = { ...stored, tierMax: max, userId: null };
    localStorage.setItem('yte_credits', JSON.stringify(stored));
    return stored;
  } catch {
    return { used: 0, resetAt: Date.now() + CREDITS_PERIOD_MS, tierMax: CREDITS_FREE, userId: null };
  }
}

const CreditsWidget = ({ credits, onUpgrade, user, onShowReferralPromo }) => {
  const [open, setOpen] = React.useState(false);
  const [refCopied, setRefCopied] = React.useState(false);
  const ref = React.useRef(null);
  const refLink = user ? `${window.location.origin}?ref=${user.id}` : '';
  const copyRefLink = () => {
    if (!refLink) return;
    navigator.clipboard.writeText(refLink).then(() => {
      setRefCopied(true);
      setTimeout(() => setRefCopied(false), 2000);
    });
  };
  const shareWA    = () => window.open(`https://wa.me/?text=${encodeURIComponent(`Check out ScribeSnap — it extracts YouTube transcripts in seconds! Sign up with my link and we both get +3 free credits: ${refLink}`)}`, '_blank');
  const shareX     = () => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`I use ScribeSnap to get YouTube transcripts instantly 🎬 Try it free — use my invite link and we both get bonus credits 👉 ${refLink}`)}`, '_blank');
  const shareEmail = () => window.open(`mailto:?subject=${encodeURIComponent('Try ScribeSnap — free YouTube transcript tool')}&body=${encodeURIComponent(`Check out ScribeSnap — it extracts YouTube transcripts in seconds! Sign up with my link and we both get +3 free credits: ${refLink}`)}`, '_blank');
  const used = credits?.used ?? 0;
  const resetAt = credits?.resetAt ?? (Date.now() + CREDITS_PERIOD_MS);
  const tierMax = credits?.tierMax || (credits?.userId ? CREDITS_MAX : CREDITS_FREE);
  const daysLeft = Math.max(0, Math.ceil((resetAt - Date.now()) / 86400000));
  const pct = Math.min(100, (used / tierMax) * 100);
  const nearLimit = used >= tierMax * 0.8;
  const isGuest = !credits?.userId;

  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 8,
          border: `1px solid ${nearLimit ? 'rgba(180,83,9,0.3)' : P.border}`,
          background: nearLimit ? 'rgba(180,83,9,0.06)' : P.paper,
          cursor: 'pointer', transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = nearLimit ? 'rgba(180,83,9,0.1)' : P.surface; }}
        onMouseLeave={e => { e.currentTarget.style.background = nearLimit ? 'rgba(180,83,9,0.06)' : P.paper; }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill={nearLimit ? P.warning : P.accent}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
        <span style={{ fontSize: 12, fontWeight: 600, color: nearLimit ? P.warning : P.ink, fontVariantNumeric: 'tabular-nums' }}>
          {used} / {tierMax}
        </span>
      </button>

      {open && (
        <div className="fade-up" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)',
          width: 290, background: P.surface, border: `1px solid ${P.border}`,
          borderRadius: 14, boxShadow: '0 8px 32px rgba(28,25,23,0.12)',
          padding: '14px 16px', zIndex: 200,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: P.ink, marginBottom: 6 }}>
            Free Credits
          </div>

          {/* Progress bar */}
          <div style={{ height: 5, borderRadius: 999, background: P.border, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{
              height: '100%', width: `${pct}%`, borderRadius: 999,
              background: nearLimit ? P.warning : P.accent,
              transition: 'width 0.4s ease',
            }} />
          </div>

          <div style={{ fontSize: 12, color: P.muted, marginBottom: 4 }}>
            <span style={{ color: P.ink, fontWeight: 600 }}>{used} of {tierMax}</span> used
          </div>
          <div style={{ fontSize: 11, color: P.muted }}>
            Resets in <span style={{ fontWeight: 600, color: P.ink }}>{daysLeft} day{daysLeft !== 1 ? 's' : ''}</span>
          </div>
          {isGuest && (
            <div style={{ marginTop: 10, fontSize: 11, color: P.muted, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>Sign in to get <strong style={{ color: P.ink }}>20 credits</strong> per 7-day period.</span>
              {used >= tierMax && (
                <button
                  onClick={onUpgrade}
                  style={{
                    alignSelf: 'flex-start',
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: `1px solid ${P.accent}`,
                    background: P.accent,
                    color: 'white',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = P.accentHover; }}
                  onMouseLeave={e => { e.currentTarget.style.background = P.accent; }}
                >
                  Create free account for 20 credits
                </button>
              )}
            </div>
          )}
          {!isGuest && refLink && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${P.border}` }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: 'rgba(45,108,223,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2D6CDF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>Invite friends, earn credits</div>
              </div>
              {/* Badge */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, background: 'rgba(45,108,223,0.09)', marginBottom: 7 }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="#2D6CDF"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#2D6CDF' }}>+3 free credits per friend who signs up</span>
              </div>
              {/* Description */}
              <p style={{ margin: '0 0 9px', fontSize: 11, color: P.muted, lineHeight: 1.5 }}>
                Share your personal link. Every friend who creates an account using it gets a bonus — and so do you.
              </p>
              {/* Link box */}
              <div style={{ background: P.paper, border: `1px solid ${P.border}`, borderRadius: 8, padding: '6px 9px', marginBottom: 7, fontSize: 11, color: P.muted, wordBreak: 'break-all', lineHeight: 1.4 }}>
                {refLink}
              </div>
              {/* Copy button */}
              <button onClick={copyRefLink} style={{
                width: '100%', padding: '7px 0', borderRadius: 8, marginBottom: 7,
                border: `1px solid ${refCopied ? 'rgba(15,118,110,0.3)' : 'rgba(45,108,223,0.3)'}`,
                background: refCopied ? 'rgba(15,118,110,0.08)' : 'rgba(45,108,223,0.07)',
                color: refCopied ? '#0F766E' : P.accent,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                transition: 'all 0.15s',
              }}>
                {refCopied
                  ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>Copied!</>
                  : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"/></svg>Copy link</>
                }
              </button>
              {/* Social share row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {[
                  { label: 'WhatsApp', color: '#128C7E', bg: 'rgba(37,211,102,0.07)', border: 'rgba(37,211,102,0.3)', fn: shareWA,
                    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg> },
                  { label: 'Share on X', color: P.ink, bg: 'rgba(0,0,0,0.04)', border: 'rgba(0,0,0,0.13)', fn: shareX,
                    icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> },
                  { label: 'Email', color: P.ink, bg: P.paper, border: P.border, fn: shareEmail,
                    icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg> },
                ].map(({ label, color, bg, border, fn, icon }) => (
                  <button key={label} onClick={fn} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '7px 4px', borderRadius: 8, border: `1px solid ${border}`,
                    background: bg, color, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(0.93)'; }}
                    onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
                  >{icon}{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Shared helpers ────────────────────────────────────────────────────────────
const AuthLogo = () => (
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
    <BrandLogo height={40} />
  </div>
);

const modalOverlay = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(28,25,23,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
};
const modalCard = {
  width: '100%', maxWidth: 420,
  background: P.surface, borderRadius: 20,
  border: `1px solid ${P.border}`,
  boxShadow: '0 24px 80px rgba(28,25,23,0.2)',
  padding: '32px 32px 28px',
  position: 'relative',
};
const friendlyError = (msg = '') => {
  if (msg.includes('Email not confirmed')) return 'Please confirm your email first. Check your inbox for the confirmation link.';
  if (msg.includes('Invalid login credentials')) return 'Incorrect email or password. Please try again.';
  if (msg.includes('User already registered')) return 'An account with this email already exists. Try signing in instead.';
  if (msg.includes('Password should be at least')) return 'Password must be at least 6 characters.';
  if (msg.includes('rate limit') || msg.includes('too many')) return 'Too many attempts. Please wait a moment and try again.';
  if (msg.includes('network') || msg.includes('fetch')) return 'Network error. Please check your connection.';
  return msg || 'Something went wrong. Please try again.';
};

const funnyTranscriptError = (msg = '') => {
  const m = msg.toLowerCase();
  if (m.includes('rate') || m.includes('too many requests') || m.includes('429'))
    return "YouTube's bouncer cut us off. Give it a minute, then try again.";
  if (m.includes('private') || m.includes('members only') || m.includes('members-only'))
    return "That video has trust issues. It's private or members-only — nothing we can do here.";
  if (m.includes('copyright'))
    return "A copyright lawyer got there first. This one's locked down.";
  if (m.includes('unavailable'))
    return "The video didn't show up. Classic. Double-check the URL and try again.";
  if (m.includes('no captions') || m.includes('no captions found'))
    return "This video went caption-free and AI transcription isn't set up. Nothing to grab, sadly.";
  if (m.includes('audio file too large') || m.includes('too large'))
    return "That video is way too long. Even we have limits. Try a shorter one.";
  if (m.includes('timed out') || m.includes('timeout'))
    return "Still loading... just kidding, we gave up. The video might be hiding. Try again.";
  if (m.includes('connection') || m.includes('network') || m.includes('fetch'))
    return "Connection ghosted us. Were you on a train? Try again.";
  if (m.includes('failed to process'))
    return "We got the transcript and immediately dropped it. Very smooth. Try again.";
  if (m.includes('invalid') && m.includes('url'))
    return "That URL looks suspicious. YouTube and Vimeo only, please.";
  if (m.includes('invalid') && m.includes('vimeo'))
    return "That Vimeo URL didn't pass the vibe check. Try pasting it again.";
  if (m.includes('failed to fetch') || m.includes('failed to download'))
    return "The transcript played hard to get. Try again.";
  return msg || "Something went sideways. Give it another shot.";
};

// ── AuthModal ─────────────────────────────────────────────────────────────────
const AuthModal = ({ onClose, onAuthSuccess, initialTab = 'signin' }) => {
  const [screen, setScreen]     = React.useState(initialTab); // 'signin'|'signup'|'forgot'|'pending'
  const [email, setEmail]       = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm]   = React.useState('');
  const [username, setUsername] = React.useState('');
  const [loading, setLoading]   = React.useState(false);
  const [error, setError]       = React.useState('');
  const [resendLoading, setResendLoading] = React.useState(false);
  const [resendDone, setResendDone]       = React.useState(false);
  const overlayRef = React.useRef(null);

  React.useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const inputStyle = {
    width: '100%', padding: '10px 13px', borderRadius: 10,
    border: `1px solid ${P.border}`, background: P.paper,
    fontSize: 14, color: P.ink, outline: 'none', transition: 'border-color 0.15s',
    fontFamily: 'inherit',
  };

  const switchScreen = (s) => { setScreen(s); setError(''); setResendDone(false); };

  const handleSignIn = async (e) => {
    e.preventDefault(); setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError('Please enter a valid email address.'); return; }
    setLoading(true);
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) { setError(friendlyError(err.message)); return; }
      if (data?.user) { onAuthSuccess(data.user); onClose(); }
    } finally { setLoading(false); }
  };

  const handleSignUp = async (e) => {
    e.preventDefault(); setError('');
    const trimmedUser = username.trim();
    const trimmedEmail = email.trim().toLowerCase();
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(trimmedEmail)) { setError('Please enter a valid email address (e.g. you@example.com).'); return; }
    // Block obvious disposable/fake domains
    const blockedDomains = ['mailinator.com','guerrillamail.com','trashmail.com','tempmail.com','yopmail.com','sharklasers.com','throwam.com','dispostable.com','maildrop.cc','fakeinbox.com'];
    const emailDomain = trimmedEmail.split('@')[1] || '';
    if (blockedDomains.includes(emailDomain)) { setError('Please use a real email address.'); return; }
    if (!trimmedUser) { setError('Please choose a username.'); return; }
    if (trimmedUser.length < 2) { setError('Username must be at least 2 characters.'); return; }
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedUser)) { setError('Username can only contain letters, numbers, _, . and -'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    // Require at least "Fair" strength
    const pwScore = [password.length>=8, password.length>=12, /[A-Z]/.test(password), /[a-z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
    if (pwScore <= 2) { setError('Password is too weak. Add uppercase letters, numbers, or symbols.'); return; }
    setLoading(true);
    try {
      // Check username availability against profiles table
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', trimmedUser)
        .maybeSingle();
      if (existing) { setError('Username already taken. Please choose another.'); return; }

      const signUpPendingRef = localStorage.getItem('yte_pending_ref');
      const { error: err } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: trimmedUser, username: trimmedUser.toLowerCase(), ...(signUpPendingRef ? { referred_by: signUpPendingRef } : {}) } },
      });
      if (err) { setError(friendlyError(err.message)); return; }
      setScreen('pending');
    } finally { setLoading(false); }
  };

  const handleForgot = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getPasswordResetRedirectUrl(),
      });
      if (err) { setError(friendlyError(err.message)); return; }
      setScreen('forgotSent');
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    setResendLoading(true);
    try {
      await supabase.auth.resend({ type: 'signup', email });
      setResendDone(true);
    } finally { setResendLoading(false); }
  };

  const CloseBtn = () => (
    <button onClick={onClose} style={{
      position: 'absolute', top: 16, right: 16, width: 28, height: 28,
      borderRadius: 7, background: 'none', border: 'none', cursor: 'pointer',
      color: P.muted, fontSize: 20, lineHeight: 1,
      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = P.muted; }}
    >×</button>
  );

  const SubmitBtn = ({ label }) => (
    <button type="submit" disabled={loading} style={{
      marginTop: 4, padding: '11px 0', borderRadius: 10, border: 'none',
      background: loading ? 'rgba(45,108,223,0.55)' : P.accent,
      color: 'white', fontSize: 14, fontWeight: 600,
      cursor: loading ? 'not-allowed' : 'pointer', transition: 'background 0.15s',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%',
    }}
      onMouseEnter={e => { if (!loading) e.currentTarget.style.background = P.accentHover; }}
      onMouseLeave={e => { if (!loading) e.currentTarget.style.background = P.accent; }}
    >{loading && <SpinnerIcon size={14} />}{label}</button>
  );

  const ErrorBox = ({ msg }) => msg ? (
    <div style={{ padding: '9px 12px', borderRadius: 8, background: 'rgba(180,35,24,0.07)', border: `1px solid rgba(180,35,24,0.18)`, fontSize: 13, color: P.error, lineHeight: 1.5 }}>{msg}</div>
  ) : null;

  // ── Email pending screen ───────────────────────────────────────────────────
  if (screen === 'pending') return (
    <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose(); }} style={modalOverlay}>
      <div className="fade-up" style={modalCard}>
        <CloseBtn />
        <AuthLogo />
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📬</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: P.ink, marginBottom: 8 }}>Check your inbox</div>
          <div style={{ fontSize: 13, color: P.muted, lineHeight: 1.6, marginBottom: 20 }}>
            We sent a confirmation link to <strong style={{ color: P.ink }}>{email}</strong>.<br />
            Click it to activate your account, then come back and sign in.
          </div>
          {resendDone
            ? <div style={{ fontSize: 13, color: P.success, marginBottom: 12 }}>Resent! Check your spam folder if needed.</div>
            : <button onClick={handleResend} disabled={resendLoading} style={{ background: 'none', border: 'none', cursor: resendLoading ? 'default' : 'pointer', fontSize: 13, color: P.accent, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, margin: '0 auto 12px' }}>
                {resendLoading && <SpinnerIcon size={12} />} Didn't get it? Resend
              </button>
          }
          <button onClick={() => switchScreen('signin')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: P.muted }}>
            ← Back to sign in
          </button>
        </div>
      </div>
    </div>
  );

  // ── Forgot sent screen ────────────────────────────────────────────────────
  if (screen === 'forgotSent') return (
    <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose(); }} style={modalOverlay}>
      <div className="fade-up" style={modalCard}>
        <CloseBtn />
        <AuthLogo />
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔑</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: P.ink, marginBottom: 8 }}>Reset link sent</div>
          <div style={{ fontSize: 13, color: P.muted, lineHeight: 1.6, marginBottom: 20 }}>
            We sent a password reset link to <strong style={{ color: P.ink }}>{email}</strong>.<br />
            Click it to set a new password.
          </div>
          <button onClick={() => switchScreen('signin')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: P.muted }}>← Back to sign in</button>
        </div>
      </div>
    </div>
  );

  // ── Forgot password screen ────────────────────────────────────────────────
  if (screen === 'forgot') return (
    <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose(); }} style={modalOverlay}>
      <div className="fade-up" style={modalCard}>
        <CloseBtn />
        <AuthLogo />
        <div style={{ fontSize: 18, fontWeight: 700, color: P.ink, marginBottom: 4 }}>Reset password</div>
        <div style={{ fontSize: 13, color: P.muted, marginBottom: 20 }}>Enter your email and we'll send you a reset link.</div>
        <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: P.ink, display: 'block', marginBottom: 5 }}>Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle}
              onFocus={e => { e.target.style.borderColor = P.accent; }} onBlur={e => { e.target.style.borderColor = P.border; }} />
          </div>
          <ErrorBox msg={error} />
          <SubmitBtn label="Send reset link" />
        </form>
        <p style={{ textAlign: 'center', fontSize: 12, color: P.muted, marginTop: 16, marginBottom: 0 }}>
          <button onClick={() => switchScreen('signin')} style={{ background: 'none', border: 'none', color: P.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>← Back to sign in</button>
        </p>
      </div>
    </div>
  );

  // ── Sign in / Sign up screen ──────────────────────────────────────────────
  const isSignUp = screen === 'signup';
  return (
    <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose(); }} style={modalOverlay}>
      <div className="fade-up" style={modalCard}>
        <CloseBtn />
        <AuthLogo />

        {/* Tabs */}
        <div style={{ display: 'flex', marginBottom: 24, background: P.paper, borderRadius: 10, padding: 3, border: `1px solid ${P.border}` }}>
          {[['signin', 'Sign in'], ['signup', 'Create account']].map(([key, label]) => (
            <button key={key} onClick={() => switchScreen(key)} style={{
              flex: 1, padding: '7px 0', borderRadius: 8, border: 'none',
              background: screen === key ? P.surface : 'transparent',
              color: screen === key ? P.ink : P.muted,
              fontSize: 13, fontWeight: screen === key ? 600 : 400,
              cursor: 'pointer', transition: 'all 0.15s',
              boxShadow: screen === key ? '0 1px 4px rgba(28,25,23,0.08)' : 'none',
            }}>{label}</button>
          ))}
        </div>

        <form onSubmit={isSignUp ? handleSignUp : handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isSignUp && (() => {
            const adjs = ['swift','dark','silent','bright','wild','bold','calm','sharp','keen','cool','neo','cyber','solar','lunar','nova','prime','pixel','sonic','turbo','neon','royal','iron','ghost','storm','vivid'];
            const nouns = ['eagle','wolf','fox','panda','tiger','hawk','coder','ninja','rider','blade','spark','pulse','drift','nexus','orbit','vault','scout','pilot','forge','creek','peak','comet','flare','prism','craft'];
            const seps = ['_','.',''];
            const generateUsername = () => {
              const adj  = adjs[Math.floor(Math.random() * adjs.length)];
              const noun = nouns[Math.floor(Math.random() * nouns.length)];
              const sep  = seps[Math.floor(Math.random() * seps.length)];
              const num  = Math.random() > 0.5 ? Math.floor(Math.random() * 90 + 10) : '';
              return `${adj}${sep}${noun}${num}`;
            };
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: P.ink }}>Username</label>
                  <button type="button" onClick={() => setUsername(generateUsername())}
                    style={{ background: 'none', border: 'none', fontSize: 11, color: P.muted, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4, transition: 'color 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.color = P.accent; }}
                    onMouseLeave={e => { e.currentTarget.style.color = P.muted; }}
                  >🎲 Random username</button>
                </div>
                <input type="text" required value={username} onChange={e => setUsername(e.target.value)} placeholder="yourname" style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = P.accent; }} onBlur={e => { e.target.style.borderColor = P.border; }} />
              </div>
            );
          })()}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: P.ink, display: 'block', marginBottom: 5 }}>Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle}
              onFocus={e => { e.target.style.borderColor = P.accent; }} onBlur={e => { e.target.style.borderColor = P.border; }} />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: P.ink }}>Password</label>
              {!isSignUp && (
                <button type="button" onClick={() => switchScreen('forgot')}
                  style={{ background: 'none', border: 'none', fontSize: 12, color: P.muted, cursor: 'pointer', padding: 0, transition: 'color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = P.accent; }}
                  onMouseLeave={e => { e.currentTarget.style.color = P.muted; }}
                >Forgot password?</button>
              )}
            </div>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
              placeholder={isSignUp ? 'Min. 6 characters' : '••••••••'} style={inputStyle}
              onFocus={e => { e.target.style.borderColor = P.accent; }} onBlur={e => { e.target.style.borderColor = P.border; }} />
            {isSignUp && password.length > 0 && (() => {
              // Strength scoring
              let score = 0;
              if (password.length >= 8)  score++;
              if (password.length >= 12) score++;
              if (/[A-Z]/.test(password)) score++;
              if (/[a-z]/.test(password)) score++;
              if (/[0-9]/.test(password)) score++;
              if (/[^A-Za-z0-9]/.test(password)) score++;
              const level = score <= 2 ? 0 : score <= 3 ? 1 : score <= 4 ? 2 : 3;
              const labels  = ['Weak',   'Fair',    'Good',    'Strong'];
              const colors  = ['#B42318','#B45309', '#0F766E', '#166534'];
              const widths  = ['25%',    '50%',     '75%',     '100%'];
              return (
                <div style={{ marginTop: 8 }}>
                  {/* Bar */}
                  <div style={{ height: 4, borderRadius: 999, background: P.border, overflow: 'hidden', marginBottom: 5 }}>
                    <div style={{ height: '100%', width: widths[level], borderRadius: 999, background: colors[level], transition: 'width 0.3s ease, background 0.3s ease' }} />
                  </div>
                  {/* Label + generator link */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: colors[level] }}>{labels[level]} password</span>
                    <a href="https://pwasecurity.org/" target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: P.muted, textDecoration: 'none', transition: 'color 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.color = P.accent; }}
                      onMouseLeave={e => { e.currentTarget.style.color = P.muted; }}
                    >🔐 Generate secure password</a>
                  </div>
                </div>
              );
            })()}
            {isSignUp && password.length === 0 && (
              <div style={{ marginTop: 5, textAlign: 'right' }}>
                <a href="https://pwasecurity.org/" target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, color: P.muted, textDecoration: 'none', transition: 'color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = P.accent; }}
                  onMouseLeave={e => { e.currentTarget.style.color = P.muted; }}
                >🔐 Generate secure password</a>
              </div>
            )}
          </div>
          {isSignUp && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: P.ink, display: 'block', marginBottom: 5 }}>Repeat password</label>
              <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat your password" style={inputStyle}
                onFocus={e => { e.target.style.borderColor = P.accent; }} onBlur={e => { e.target.style.borderColor = P.border; }} />
            </div>
          )}
          <ErrorBox msg={error} />
          <SubmitBtn label={isSignUp ? 'Create account' : 'Sign in'} />
        </form>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 14px' }}>
          <div style={{ flex: 1, height: 1, background: P.border }} />
          <span style={{ fontSize: 12, color: P.muted }}>or</span>
          <div style={{ flex: 1, height: 1, background: P.border }} />
        </div>

        {/* Google button */}
        <button
          onClick={async () => {
            setError('');
            const { error: err } = await supabase.auth.signInWithOAuth({
              provider: 'google',
              options: { redirectTo: getAuthRedirectUrl() },
            });
            if (err) setError(friendlyError(err.message));
          }}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 10,
            border: `1px solid ${P.border}`, background: P.paper,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            fontSize: 14, fontWeight: 600, color: P.ink, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = P.surface; e.currentTarget.style.borderColor = '#aaa'; }}
          onMouseLeave={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.borderColor = P.border; }}
        >
          {/* Google "G" logo */}
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            <path fill="none" d="M0 0h48v48H0z"/>
          </svg>
          Continue with Google
        </button>

        <p style={{ textAlign: 'center', fontSize: 12, color: P.muted, marginTop: 16, marginBottom: 0 }}>
          {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
          <button onClick={() => switchScreen(isSignUp ? 'signin' : 'signup')}
            style={{ background: 'none', border: 'none', color: P.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
          >{isSignUp ? 'Sign in' : 'Create one'}</button>
        </p>
      </div>
    </div>
  );
};

// ── PasswordResetModal ────────────────────────────────────────────────────────
const PasswordResetModal = ({ onClose }) => {
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm]   = React.useState('');
  const [loading, setLoading]   = React.useState(false);
  const [error, setError]       = React.useState('');
  const [done, setDone]         = React.useState(false);

  const inputStyle = {
    width: '100%', padding: '10px 13px', borderRadius: 10,
    border: `1px solid ${P.border}`, background: P.paper,
    fontSize: 14, color: P.ink, outline: 'none', transition: 'border-color 0.15s', fontFamily: 'inherit',
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) { setError(err.message); return; }
      setDone(true);
      setTimeout(onClose, 2000);
    } finally { setLoading(false); }
  };

  return (
    <div style={modalOverlay}>
      <div className="fade-up" style={modalCard}>
        <AuthLogo />
        {done ? (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: P.ink }}>Password updated!</div>
            <div style={{ fontSize: 13, color: P.muted, marginTop: 8 }}>Redirecting you back…</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 700, color: P.ink, marginBottom: 4 }}>Set new password</div>
            <div style={{ fontSize: 13, color: P.muted, marginBottom: 18 }}>Choose a new password for your account.</div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: P.ink, display: 'block', marginBottom: 5 }}>New password</label>
                <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = P.accent; }} onBlur={e => { e.target.style.borderColor = P.border; }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: P.ink, display: 'block', marginBottom: 5 }}>Confirm password</label>
                <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat new password" style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = P.accent; }} onBlur={e => { e.target.style.borderColor = P.border; }} />
              </div>
              <div style={{ marginTop: -2, textAlign: 'right' }}>
                <a href="https://pwasecurity.org/#" target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, color: P.muted, textDecoration: 'none', transition: 'color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = P.accent; }}
                  onMouseLeave={e => { e.currentTarget.style.color = P.muted; }}
                >🔐 Generate secure password</a>
              </div>
              {error && <div style={{ padding: '9px 12px', borderRadius: 8, background: 'rgba(180,35,24,0.07)', border: `1px solid rgba(180,35,24,0.18)`, fontSize: 13, color: P.error }}>{error}</div>}
              <button type="submit" disabled={loading} style={{
                marginTop: 4, padding: '11px 0', borderRadius: 10, border: 'none',
                background: loading ? 'rgba(45,108,223,0.55)' : P.accent,
                color: 'white', fontSize: 14, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.background = P.accentHover; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.background = P.accent; }}
              >{loading && <SpinnerIcon size={14} />}Update password</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
const Dashboard = ({ user, credits, history, setHistory, onBack, onSignOut, onLoadTranscript, lang, setLang }) => {
  const [tab, setTab] = React.useState('overview');
  const [prefLangSaved, setPrefLangSaved] = React.useState(false);
  const [copyLinkDone, setCopyLinkDone] = React.useState(false);
  const [copyRefDone, setCopyRefDone] = React.useState(false);
  const [showAllHistory, setShowAllHistory] = React.useState(false);

  // Profile editing
  const [editingName, setEditingName] = React.useState(false);
  const [nameInput, setNameInput] = React.useState(
    user.user_metadata?.username || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || ''
  );
  const [nameSaving, setNameSaving] = React.useState(false);
  const [nameSaved, setNameSaved] = React.useState(false);
  const [nameError, setNameError] = React.useState('');

  // Inline password change (multi-step)
  const [pwStep, setPwStep] = React.useState('idle'); // idle | form | confirm | loading | success | error
  const [pwCurrent, setPwCurrent] = React.useState('');
  const [pwNew, setPwNew] = React.useState('');
  const [pwConfirm, setPwConfirm] = React.useState('');
  const [pwError, setPwError] = React.useState('');

  // Confirmations
  const [signOutConfirm, setSignOutConfirm] = React.useState(false);
  const [clearConfirm, setClearConfirm] = React.useState(false);
  const [clearDone, setClearDone] = React.useState(false);

  // Extra preferences — read from Supabase user_metadata first, fall back to localStorage
  const prefKey = (k) => user ? `yte_pref_${k}_${user.id}` : `yte_pref_${k}`;
  const cloudPrefs = user.user_metadata?.prefs || {};
  const [prefTimestamps, setPrefTimestamps] = React.useState(() => {
    if ('timestamps' in cloudPrefs) return cloudPrefs.timestamps;
    try { return localStorage.getItem(prefKey('timestamps')) !== 'false'; } catch { return true; }
  });
  const [prefAutoCopy, setPrefAutoCopy] = React.useState(() => {
    if ('autocopy' in cloudPrefs) return cloudPrefs.autocopy;
    try { return localStorage.getItem(prefKey('autocopy')) === 'true'; } catch { return false; }
  });
  const [prefFormat, setPrefFormat] = React.useState(() => {
    if (cloudPrefs.format) return cloudPrefs.format;
    try { return localStorage.getItem(prefKey('format')) || 'plain'; } catch { return 'plain'; }
  });

  // Ref tracks latest prefs so rapid changes don't lose earlier updates (stale closure fix)
  const latestPrefsRef = React.useRef(user.user_metadata?.prefs || {});

  const savePrefsToCloud = async (updates) => {
    try {
      const merged = { ...latestPrefsRef.current, ...updates };
      latestPrefsRef.current = merged;
      await supabase.auth.updateUser({ data: { prefs: merged } });
    } catch (_) { /* localStorage still holds the value */ }
  };

  const refLink = `${window.location.origin}?ref=${user.id}`;
  const copyRefLink = () => {
    navigator.clipboard.writeText(refLink).then(() => {
      setCopyRefDone(true);
      setTimeout(() => setCopyRefDone(false), 2000);
    });
  };
  const saveLangPref = (newLang) => {
    const key = user ? `yte_lang_${user.id}` : 'yte_lang';
    localStorage.setItem(key, newLang);
    savePrefsToCloud({ lang: newLang });
  };

  const used = credits?.used ?? 0;
  const tierMax = credits?.tierMax || CREDITS_MAX;
  const resetAt = credits?.resetAt ?? (Date.now() + CREDITS_PERIOD_MS);
  const daysLeft = Math.max(0, Math.ceil((resetAt - Date.now()) / 86400000));
  const pct = Math.min(100, (used / tierMax) * 100);
  const remaining = Math.max(0, tierMax - used);
  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '—';
  const initial = (user.email || '?')[0].toUpperCase();
  const displayName = user.user_metadata?.username || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User';
  const latest = history[0] || null;
  const latestWc = latest && latest.transcript ? latest.transcript.trim().split(/\s+/).length : 0;

  // Per-day usage stats from history
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  history.forEach(h => { if (h.date) dayCounts[new Date(h.date).getDay()]++; });
  const maxCount = Math.max(...dayCounts);
  const mostUsedDayIdx = maxCount > 0 ? dayCounts.indexOf(maxCount) : -1;
  const mostUsedDay = mostUsedDayIdx >= 0 ? `${dayNames[mostUsedDayIdx]} (${maxCount})` : '—';
  const avgPerDay = history.length > 0 ? (history.length / 7).toFixed(1) : '0.0';

  const copyShareLink = () => {
    navigator.clipboard.writeText(window.location.origin).then(() => {
      setCopyLinkDone(true);
      setTimeout(() => setCopyLinkDone(false), 2000);
    });
  };

  const openTranscript = (entry) => {
    if (!entry) return;
    onLoadTranscript(entry);
    onBack();
  };

  // Save display name via Supabase
  const saveDisplayName = async () => {
    if (!nameInput.trim()) return;
    setNameSaving(true);
    setNameError('');
    try {
      const { error } = await supabase.auth.updateUser({
        data: { username: nameInput.trim(), full_name: nameInput.trim() },
      });
      if (error) { setNameError(error.message); return; }
      setEditingName(false);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 3000);
    } catch (e) {
      setNameError(e.message || 'Failed to save name.');
    } finally {
      setNameSaving(false);
    }
  };

  // Inline password change
  const handlePasswordChange = async () => {
    if (pwNew !== pwConfirm) { setPwError('New passwords do not match.'); return; }
    if (pwNew.length < 6) { setPwError('Password must be at least 6 characters.'); return; }
    setPwStep('loading');
    setPwError('');
    try {
      // Re-authenticate to verify current password
      const { error: reAuthErr } = await supabase.auth.signInWithPassword({ email: user.email, password: pwCurrent });
      if (reAuthErr) { setPwError('Current password is incorrect.'); setPwStep('confirm'); return; }
      const { error: updateErr } = await supabase.auth.updateUser({ password: pwNew });
      if (updateErr) { setPwError(updateErr.message); setPwStep('confirm'); return; }
      setPwStep('success');
      setTimeout(() => { setPwStep('idle'); setPwCurrent(''); setPwNew(''); setPwConfirm(''); setPwError(''); }, 3000);
    } catch (e) {
      setPwError(e.message || 'Failed to update password.');
      setPwStep('confirm');
    }
  };

  // Clear history
  const handleClearHistory = () => {
    const key = user ? `yte_history_${user.id}` : 'yte_history';
    localStorage.removeItem(key);
    if (setHistory) setHistory([]);
    setClearDone(true);
    setTimeout(() => { setClearConfirm(false); setClearDone(false); }, 2000);
  };

  // Export history as JSON
  const exportHistory = () => {
    const data = JSON.stringify(history, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scribesnap-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const weekSegments = Array.from({ length: 7 }, (_, i) => i);
  const activeDay = Math.min(6, Math.round((pct / 100) * 6));

  return (
    <div className="ds-shell">
      <style>{`
        .ds-shell {
          min-height: 100vh;
          padding-top: 56px;
          background: radial-gradient(ellipse 90% 55% at 50% -15%, rgba(45,108,223,0.1) 0%, transparent 65%), #F6F3EE;
          position: relative;
          overflow: hidden;
        }
        .ds-shell::before {
          content: '';
          position: absolute;
          inset: 36px auto auto -220px;
          width: 760px;
          height: 760px;
          background: radial-gradient(circle at center, rgba(45,108,223,0.06) 0%, transparent 68%);
          border-radius: 50%;
          pointer-events: none;
        }
        .ds-shell::after {
          content: '';
          position: absolute;
          inset: auto -160px -260px auto;
          width: 620px;
          height: 620px;
          border-radius: 50%;
          background: radial-gradient(circle at center, rgba(45,108,223,0.05) 0%, transparent 72%);
          pointer-events: none;
        }
        .ds-wrap {
          max-width: 1200px;
          margin: 0 auto;
          padding: 34px 24px 56px;
          position: relative;
          z-index: 1;
        }
        /* ── Top nav ── */
        .ds-topnav {
          display: flex;
          align-items: center;
          gap: 2px;
          margin-bottom: 22px;
        }
        .ds-topnav-back {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: none;
          color: #6B645C;
          cursor: pointer;
          padding: 6px 8px 6px 2px;
          transition: color 0.15s;
          flex-shrink: 0;
        }
        .ds-topnav-back:hover { color: #1C1917; }
        .ds-topnav-tab {
          border: none;
          background: none;
          color: #6B645C;
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          padding: 6px 14px;
          border-radius: 8px;
          transition: all 0.15s;
        }
        .ds-topnav-tab:hover { color: #1C1917; background: rgba(28,25,23,0.05); }
        .ds-topnav-tab.is-active {
          color: #1C1917;
          font-weight: 700;
        }
        .ds-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.85fr) minmax(318px, 1fr);
          gap: 18px;
          align-items: start;
        }
        .ds-card {
          background: #FFFEFC;
          border: 1px solid #E7E1D8;
          border-radius: 18px;
          box-shadow: 0 2px 12px rgba(28,25,23,0.06);
        }
        .ds-profile {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 18px 22px;
          margin-bottom: 12px;
        }
        .ds-avatar {
          width: 62px;
          height: 62px;
          border-radius: 50%;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 26px;
          font-weight: 700;
          color: white;
          background: #2D6CDF;
          box-shadow: 0 6px 16px rgba(45,108,223,0.25);
        }
        .ds-profile-name {
          font-size: clamp(20px, 2.4vw, 30px);
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #1C1917;
          margin: 0 0 2px;
        }
        .ds-profile-email {
          font-size: 14px;
          color: #6B645C;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ds-profile-meta {
          margin-left: auto;
          text-align: right;
          flex-shrink: 0;
        }
        .ds-profile-meta-label {
          margin: 0 0 3px;
          font-size: 11px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #6B645C;
          font-weight: 600;
        }
        .ds-profile-meta-value {
          margin: 0;
          font-size: 15px;
          color: #1C1917;
          font-weight: 700;
        }
        /* ── Section tabs (white card, blue active) ── */
        .ds-section-tabs {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px;
          margin-bottom: 14px;
          background: #FFFEFC;
          border: 1px solid #E7E1D8;
          border-radius: 18px;
          box-shadow: 0 2px 12px rgba(28,25,23,0.06);
        }
        .ds-section-tab {
          flex: 1;
          border: none;
          border-radius: 11px;
          padding: 8px;
          background: transparent;
          color: #6B645C;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
          text-align: center;
        }
        .ds-section-tab:hover { color: #1C1917; }
        .ds-section-tab.is-active {
          color: #2D6CDF;
          font-weight: 700;
          background: rgba(45,108,223,0.07);
        }
        .ds-overview-col {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .ds-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        .ds-stat {
          position: relative;
          overflow: hidden;
          padding: 16px 16px 14px;
          border-radius: 16px;
          border: 1px solid #E7E1D8;
          background: #FFFEFC;
          box-shadow: 0 2px 10px rgba(28,25,23,0.05);
        }
        .ds-stat::before {
          content: '';
          position: absolute;
          inset: -16px;
          opacity: 0.8;
          pointer-events: none;
        }
        .ds-stat.ds-stat-primary::before {
          background: linear-gradient(130deg, rgba(45,108,223,0.1) 0%, rgba(45,108,223,0.06) 100%);
        }
        .ds-stat.ds-stat-neutral::before {
          background: linear-gradient(140deg, rgba(45,108,223,0.05) 0%, rgba(45,108,223,0.02) 100%);
        }
        .ds-stat.ds-stat-youtube::before {
          background: linear-gradient(145deg, rgba(255,0,0,0.05) 0%, rgba(45,108,223,0.06) 100%);
        }
        .ds-stat.ds-stat-vimeo::before {
          background: linear-gradient(140deg, rgba(26,183,234,0.07) 0%, rgba(45,108,223,0.05) 100%);
        }
        .ds-stat-head {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 6px;
          color: #2D6CDF;
          margin-bottom: 8px;
        }
        .ds-stat-value {
          position: relative;
          z-index: 1;
          margin: 0 0 2px;
          font-size: 28px;
          line-height: 1.05;
          letter-spacing: -0.02em;
          color: #1C1917;
          font-weight: 700;
        }
        .ds-stat-label {
          position: relative;
          z-index: 1;
          margin: 0 0 7px;
          font-size: 13px;
          color: #1C1917;
          font-weight: 600;
        }
        .ds-stat-sub {
          position: relative;
          z-index: 1;
          margin: 0;
          font-size: 13px;
          color: #6B645C;
        }
        .ds-usage {
          padding: 16px 18px 14px;
        }
        .ds-usage-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          gap: 10px;
        }
        .ds-usage-title {
          margin: 0;
          font-size: 16px;
          color: #1C1917;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .ds-usage-switch {
          display: inline-flex;
          border-radius: 10px;
          padding: 3px;
          background: rgba(45,108,223,0.07);
          border: 1px solid rgba(45,108,223,0.18);
          gap: 3px;
        }
        .ds-usage-switch button {
          border: none;
          border-radius: 8px;
          padding: 5px 10px;
          background: transparent;
          color: #6B645C;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ds-usage-switch button.is-active {
          background: white;
          color: #1C1917;
        }
        .ds-usage-track {
          height: 9px;
          border-radius: 999px;
          background: #E7E1D8;
          overflow: hidden;
        }
        .ds-usage-bar {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #5B9BD5 0%, #2D6CDF 60%, #2459B8 100%);
          transition: width 0.45s ease;
        }
        .ds-usage-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 12px;
        }
        .ds-usage-meta strong {
          color: #1C1917;
          font-size: 22px;
        }
        .ds-usage-days {
          display: flex;
          align-items: end;
          gap: 7px;
        }
        .ds-usage-day {
          width: 13px;
          border-radius: 4px 4px 3px 3px;
          background: rgba(45,108,223,0.14);
          transition: all 0.2s ease;
        }
        .ds-usage-day.is-active {
          background: #2D6CDF;
        }
        .ds-usage-daystats {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #E7E1D8;
          font-size: 12px;
          color: #6B645C;
        }
        .ds-list-card { padding: 12px 0 4px; overflow: hidden; }
        .ds-list-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 0 16px 8px;
        }
        .ds-list-title {
          margin: 0;
          font-size: 15px;
          color: #1C1917;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .ds-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 16px;
          border-top: 1px solid #E7E1D8;
          transition: background 0.15s ease;
        }
        .ds-row:first-of-type {
          border-top: 1px solid rgba(45,108,223,0.2);
          box-shadow: inset 2px 0 0 rgba(45,108,223,0.3);
        }
        .ds-row:hover { background: rgba(45,108,223,0.03); }
        .ds-thumb {
          width: 96px;
          height: 54px;
          border-radius: 9px;
          overflow: hidden;
          flex-shrink: 0;
          background: rgba(45,108,223,0.06);
          border: 1px solid rgba(45,108,223,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .ds-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .ds-row-title {
          margin: 0 0 3px;
          font-size: 14px;
          color: #1C1917;
          font-weight: 700;
          letter-spacing: -0.01em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ds-row-meta {
          margin: 0;
          font-size: 12px;
          color: #6B645C;
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: wrap;
        }
        .ds-row-actions {
          margin-left: auto;
          display: inline-flex;
          gap: 6px;
          flex-shrink: 0;
        }
        .ds-row-btn {
          border: 1px solid #E7E1D8;
          border-radius: 8px;
          padding: 6px 13px;
          min-width: 60px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ds-row-btn.primary {
          background: #2D6CDF;
          color: white;
          border-color: rgba(45,108,223,0.4);
        }
        .ds-row-btn.primary:hover { background: #2459B8; }
        .ds-row-btn.ghost {
          background: white;
          color: #1C1917;
          border-color: #E7E1D8;
        }
        .ds-row-btn.ghost:hover {
          border-color: rgba(45,108,223,0.3);
          color: #2D6CDF;
        }
        .ds-list-footer {
          border-top: 1px solid #E7E1D8;
          padding: 10px 16px 8px;
        }
        .ds-link-btn {
          border: none;
          background: none;
          color: #2D6CDF;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 0;
        }
        .ds-link-btn:hover { color: #2459B8; }
        .ds-side {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        /* ── Continue where you left off ── */
        .ds-continue { padding: 0; overflow: hidden; }
        .ds-continue-header { padding: 13px 14px 0; }
        .ds-continue-body { padding: 9px 14px 13px; }
        .ds-side-title {
          margin: 0;
          font-size: 14px;
          line-height: 1.2;
          color: #1C1917;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .ds-continue-thumb {
          position: relative;
          width: 100%;
          aspect-ratio: 16/9;
          overflow: hidden;
          background: rgba(45,108,223,0.08);
          margin: 10px 0 0;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .ds-continue-thumb img {
          width: 100%; height: 100%; object-fit: cover; display: block;
        }
        .ds-continue-play {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.22);
          transition: background 0.15s;
        }
        .ds-continue-thumb:hover .ds-continue-play { background: rgba(0,0,0,0.4); }
        .ds-continue-play-icon {
          width: 40px; height: 40px;
          background: rgba(255,255,255,0.92);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 3px 10px rgba(0,0,0,0.18);
        }
        .ds-continue-video-title {
          margin: 0 0 2px;
          font-size: 14px;
          font-weight: 700;
          color: #1C1917;
          letter-spacing: -0.01em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ds-continue-meta {
          margin: 0 0 9px;
          font-size: 12px;
          color: #6B645C;
          display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
        }
        .ds-continue-open-btn {
          width: 100%;
          border: none;
          border-radius: 9px;
          background: rgba(45,108,223,0.13);
          color: #2D6CDF;
          font-size: 14px;
          font-weight: 700;
          padding: 9px 12px;
          cursor: pointer;
          transition: background 0.15s, transform 0.15s;
          margin-bottom: 7px;
        }
        .ds-continue-open-btn:hover { background: rgba(45,108,223,0.22); transform: translateY(-1px); }
        .ds-continue-quick {
          display: flex;
          gap: 5px;
        }
        .ds-continue-quick-btn {
          flex: 1;
          border: 1px solid #E7E1D8;
          border-radius: 7px;
          padding: 5px 2px;
          background: white;
          color: #6B645C;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          text-align: center;
        }
        .ds-continue-quick-btn:hover { border-color: rgba(45,108,223,0.3); color: #2D6CDF; background: rgba(45,108,223,0.04); }
        .ds-continue-empty {
          padding: 20px 14px 14px;
          text-align: center;
          color: #6B645C;
          font-size: 13px;
        }
        /* ── Share card ── */
        .ds-share { padding: 13px 14px; }
        .ds-share-head {
          display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
        }
        .ds-share-icon {
          width: 26px; height: 26px; border-radius: 8px;
          background: rgba(45,108,223,0.08); color: #2D6CDF;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .ds-share-title {
          margin: 0; font-size: 14px; font-weight: 700; color: #1C1917;
        }
        .ds-share-desc {
          margin: 0 0 8px; font-size: 12px; color: #6B645C; line-height: 1.4;
        }
        .ds-share-item {
          display: flex; align-items: center; gap: 9px;
          padding: 7px 0; border: none; border-bottom: 1px solid #E7E1D8;
          background: none; width: 100%; text-align: left; cursor: pointer;
          font-size: 13px; color: #1C1917; font-weight: 500;
          transition: color 0.15s;
        }
        .ds-share-item:last-child { border-bottom: none; padding-bottom: 0; }
        .ds-share-item:hover { color: #2D6CDF; }
        .ds-share-item-icon {
          width: 26px; height: 26px; border-radius: 7px;
          background: rgba(28,25,23,0.04);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; color: #6B645C;
        }
        .ds-share-item:hover .ds-share-item-icon { color: #2D6CDF; background: rgba(45,108,223,0.08); }
        /* ── Referral card ── */
        .ds-referral {
          padding: 0; overflow: hidden;
          border: 1.5px solid rgba(45,108,223,0.2) !important;
          box-shadow: 0 4px 20px rgba(45,108,223,0.1), 0 1px 4px rgba(0,0,0,0.05);
        }
        .ds-referral-banner {
          background: linear-gradient(135deg, #2D6CDF 0%, #6C47D9 100%);
          padding: 16px 18px 14px;
          position: relative; overflow: hidden;
        }
        .ds-referral-banner::before {
          content: ''; position: absolute;
          width: 100px; height: 100px; border-radius: 50%;
          background: rgba(255,255,255,0.08);
          top: -30px; right: -20px;
        }
        .ds-referral-banner::after {
          content: ''; position: absolute;
          width: 60px; height: 60px; border-radius: 50%;
          background: rgba(255,255,255,0.06);
          bottom: -15px; right: 40px;
        }
        .ds-referral-head {
          display: flex; align-items: center; gap: 10px; margin-bottom: 10px; position: relative; z-index: 1;
        }
        .ds-referral-icon {
          width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
          background: rgba(255,255,255,0.2);
          border: 1px solid rgba(255,255,255,0.25);
          color: white;
          display: flex; align-items: center; justify-content: center;
        }
        .ds-referral-title {
          margin: 0 0 1px; font-size: 14.5px; font-weight: 700; color: white; letter-spacing: -0.01em;
        }
        .ds-referral-subtitle {
          margin: 0; font-size: 11.5px; color: rgba(255,255,255,0.7);
        }
        .ds-referral-badge {
          display: inline-flex; align-items: center; gap: 5px; position: relative; z-index: 1;
          background: rgba(255,255,255,0.18); color: white;
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 999px; padding: 4px 11px 4px 8px;
          font-size: 11.5px; font-weight: 700;
        }
        .ds-referral-body {
          padding: 14px 18px 18px; background: white;
        }
        .ds-referral-desc {
          margin: 0 0 12px; font-size: 12.5px; color: #6B645C; line-height: 1.5;
        }
        .ds-referral-link-row {
          display: flex; gap: 7px; align-items: stretch; margin-bottom: 10px;
        }
        .ds-referral-link-box {
          flex: 1; min-width: 0;
          background: #F8F6F2; border: 1.5px solid #E7E1D8; border-radius: 9px;
          padding: 8px 11px; font-size: 11.5px; color: #6B645C;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-family: monospace; letter-spacing: -0.01em;
        }
        .ds-referral-copy-btn {
          border: none; border-radius: 9px;
          background: #2D6CDF; color: white;
          font-size: 12px; font-weight: 700;
          padding: 8px 14px; cursor: pointer; flex-shrink: 0;
          transition: all 0.15s; white-space: nowrap;
          box-shadow: 0 2px 8px rgba(45,108,223,0.35);
        }
        .ds-referral-copy-btn:hover { background: #2459B8; transform: translateY(-1px); box-shadow: 0 4px 14px rgba(45,108,223,0.45); }
        .ds-referral-copy-btn.done { background: #0F766E; box-shadow: 0 2px 8px rgba(15,118,110,0.3); }
        .ds-referral-share-row {
          display: grid; grid-template-columns: 1fr 1fr; gap: 7px;
        }
        .ds-referral-share-btn {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 9px 6px; border-radius: 9px; font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.15s; border: none; color: white;
        }
        .ds-referral-share-btn:hover { transform: translateY(-1px); filter: brightness(1.08); box-shadow: 0 4px 12px rgba(0,0,0,0.18); }
        .ds-referral-share-wa { background: #25D366; }
        .ds-referral-share-x { background: #1a1a2e; }
        .ds-referral-share-ig { background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%); }
        .ds-referral-share-email { background: #4A86D4; }
        .ds-referral-stats {
          display: flex; gap: 8px; margin-top: 12px;
        }
        .ds-referral-stat {
          flex: 1; background: linear-gradient(135deg, rgba(45,108,223,0.05), rgba(108,71,217,0.05));
          border: 1.5px solid rgba(45,108,223,0.15);
          border-radius: 10px; padding: 9px 10px; text-align: center;
        }
        .ds-referral-stat-value {
          display: block; font-size: 19px; font-weight: 800; color: #2D6CDF; line-height: 1;
        }
        .ds-referral-stat-label {
          display: block; font-size: 10.5px; color: #6B645C; margin-top: 3px;
        }
        .ds-empty {
          text-align: center;
          padding: 42px 18px;
          color: #6B645C;
        }
        .ds-empty h3 {
          margin: 0 0 8px;
          color: #1C1917;
          font-size: 20px;
        }
        .ds-empty p {
          margin: 0;
          font-size: 14px;
          line-height: 1.5;
        }
        .ds-empty button {
          margin-top: 14px;
          border: none;
          border-radius: 10px;
          background: #2D6CDF;
          color: white;
          font-size: 14px;
          font-weight: 600;
          padding: 10px 18px;
          cursor: pointer;
        }
        .ds-settings {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 14px;
        }
        .ds-settings .ds-card {
          padding: 18px;
        }
        .ds-settings-title {
          margin: 0 0 13px;
          font-size: 17px;
          color: #1C1917;
          font-weight: 700;
        }
        .ds-setting-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding: 8px 0;
          border-bottom: 1px solid #E7E1D8;
        }
        .ds-setting-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        .ds-setting-label { color: #6B645C; font-size: 13px; }
        .ds-setting-value {
          color: #1C1917;
          font-size: 13px;
          font-weight: 600;
          text-align: right;
          max-width: 66%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ds-settings-btn {
          width: 100%;
          border-radius: 10px;
          padding: 9px 11px;
          border: 1px solid #E7E1D8;
          background: white;
          color: #1C1917;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ds-settings-btn:hover {
          border-color: rgba(45,108,223,0.3);
          background: rgba(45,108,223,0.06);
        }
        .ds-settings-btn.danger {
          border-color: rgba(180,35,24,0.26);
          color: #B42318;
          background: rgba(180,35,24,0.06);
        }
        .ds-settings-btn.danger:hover {
          background: rgba(180,35,24,0.12);
        }
        .ds-settings-help {
          margin: -2px 0 4px;
          font-size: 12px;
          line-height: 1.45;
          color: #6B645C;
        }
        .ds-security-feedback {
          margin-top: 2px;
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 12px;
          line-height: 1.45;
          border: 1px solid transparent;
        }
        .ds-security-feedback.loading {
          color: #2D6CDF;
          background: rgba(45,108,223,0.08);
          border-color: rgba(45,108,223,0.22);
        }
        .ds-security-feedback.success {
          color: #0F766E;
          background: rgba(15,118,110,0.1);
          border-color: rgba(15,118,110,0.26);
        }
        .ds-security-feedback.error {
          color: #B42318;
          background: rgba(180,35,24,0.08);
          border-color: rgba(180,35,24,0.24);
        }
        /* ── Settings extras ── */
        .ds-settings-input {
          width: 100%; padding: 7px 10px; border-radius: 8px;
          border: 1px solid #E7E1D8; background: #F6F3EE;
          font-size: 13px; color: #1C1917; outline: none;
          transition: border-color 0.15s; font-family: inherit; box-sizing: border-box;
        }
        .ds-settings-input:focus { border-color: rgba(45,108,223,0.5); }
        .ds-settings-form { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
        .ds-settings-form-label { font-size: 11px; font-weight: 600; color: #6B645C; margin-bottom: 3px; display: block; }
        .ds-settings-row-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .ds-settings-edit-btn {
          padding: 4px 10px; border-radius: 6px; border: 1px solid #E7E1D8;
          background: white; font-size: 12px; font-weight: 600; color: #6B645C;
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
        }
        .ds-settings-edit-btn:hover { border-color: rgba(45,108,223,0.3); color: #2D6CDF; }
        .ds-settings-save-btn {
          padding: 4px 10px; border-radius: 6px; border: none;
          background: #2D6CDF; font-size: 12px; font-weight: 600;
          color: white; cursor: pointer; transition: background 0.15s; white-space: nowrap;
        }
        .ds-settings-save-btn:hover { background: #2459B8; }
        .ds-settings-save-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .ds-settings-cancel-btn {
          padding: 4px 10px; border-radius: 6px; border: 1px solid #E7E1D8;
          background: white; font-size: 12px; font-weight: 600;
          color: #6B645C; cursor: pointer; white-space: nowrap;
        }
        .ds-settings-confirm-box {
          margin-top: 8px; padding: 12px 14px; border-radius: 10px;
          background: rgba(180,35,24,0.05); border: 1px solid rgba(180,35,24,0.18);
        }
        .ds-settings-confirm-box.neutral {
          background: rgba(45,108,223,0.05); border-color: rgba(45,108,223,0.18);
        }
        .ds-settings-confirm-text { font-size: 13px; color: #1C1917; margin: 0 0 10px; line-height: 1.4; }
        .ds-settings-confirm-row { display: flex; gap: 8px; }
        /* Toggle switch */
        .ds-toggle-wrap { display: flex; align-items: center; gap: 8px; }
        .ds-toggle {
          position: relative; width: 36px; height: 20px; flex-shrink: 0;
          display: inline-block; cursor: pointer;
        }
        .ds-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
        .ds-toggle-track {
          position: absolute; inset: 0; border-radius: 20px;
          background: #D5CFC7; transition: background 0.2s; cursor: pointer;
        }
        .ds-toggle input:checked ~ .ds-toggle-track { background: #2D6CDF; }
        .ds-toggle-track::after {
          content: ''; position: absolute; width: 14px; height: 14px;
          border-radius: 50%; background: white; top: 3px; left: 3px;
          transition: transform 0.2s;
        }
        .ds-toggle input:checked ~ .ds-toggle-track::after { transform: translateX(16px); }
        .ds-settings-feedback {
          margin-top: 6px; border-radius: 8px; padding: 8px 11px;
          font-size: 12px; line-height: 1.45; border: 1px solid transparent;
        }
        .ds-settings-feedback.success { color: #0F766E; background: rgba(15,118,110,0.09); border-color: rgba(15,118,110,0.24); }
        .ds-settings-feedback.error { color: #B42318; background: rgba(180,35,24,0.07); border-color: rgba(180,35,24,0.22); }
        .ds-settings-feedback.loading { color: #2D6CDF; background: rgba(45,108,223,0.07); border-color: rgba(45,108,223,0.2); }
        @media (max-width: 1130px) {
          .ds-grid { grid-template-columns: 1fr; }
          .ds-side { order: 2; }
        }
        @media (max-width: 930px) {
          .ds-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .ds-settings { grid-template-columns: 1fr; }
        }
        @media (max-width: 760px) {
          .ds-wrap { padding: 16px 14px 44px; }
          .ds-topnav { margin-bottom: 14px; }
          .ds-profile {
            flex-wrap: wrap;
            justify-content: center;
            text-align: center;
            padding: 20px;
          }
          .ds-profile-meta {
            margin-left: 0;
            width: 100%;
            text-align: center;
          }
          .ds-profile-email {
            white-space: normal;
            overflow-wrap: anywhere;
          }
          .ds-section-tabs { overflow-x: auto; }
          .ds-stats { grid-template-columns: 1fr; }
          .ds-usage-head { flex-wrap: wrap; }
          .ds-row {
            flex-wrap: wrap;
            align-items: flex-start;
          }
          .ds-thumb {
            width: 100%;
            height: 168px;
          }
          .ds-row-main {
            width: 100%;
          }
          .ds-row-actions {
            width: 100%;
            margin-left: 0;
          }
          .ds-row-btn { flex: 1; }
        }
      `}</style>

      <div className="ds-wrap">
        {/* Top navigation bar */}
        <nav className="ds-topnav">
          <button className="ds-topnav-back" onClick={onBack} title="Back to extractor">
            <ChevronIcon size={16} dir="left" />
          </button>
          {[['overview', 'Overview'], ['settings', 'Settings']].map(([key, label]) => (
            <button key={key} className={`ds-topnav-tab ${tab === key ? 'is-active' : ''}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="ds-grid">
          <main>
            <section className="ds-card ds-profile">
              <div className="ds-avatar">{initial}</div>
              <div style={{ minWidth: 0 }}>
                <h1 className="ds-profile-name">{displayName}</h1>
                <p className="ds-profile-email">{user.email}</p>
              </div>
              <div className="ds-profile-meta">
                <p className="ds-profile-meta-label">Member since</p>
                <p className="ds-profile-meta-value">{memberSince}</p>
              </div>
            </section>

            {/* Inline section tabs */}
            <div className="ds-section-tabs">
              {[['overview', 'Overview'], ['settings', 'Settings']].map(([key, label]) => (
                <button key={key} className={`ds-section-tab ${tab === key ? 'is-active' : ''}`} onClick={() => setTab(key)}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="ds-overview-col">
                <section className="ds-card ds-usage">
                  <div className="ds-usage-head">
                    <h2 className="ds-usage-title">Weekly usage</h2>
                    <span style={{ fontSize: 13, color: '#6B645C', fontWeight: 500 }}>
                      Resets in <strong style={{ color: '#1C1917' }}>{daysLeft} day{daysLeft !== 1 ? 's' : ''}</strong>
                    </span>
                  </div>
                  <div className="ds-usage-track">
                    <div className="ds-usage-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="ds-usage-meta">
                    <div>
                      <strong>{used} / {tierMax}</strong>{' '}
                      <span style={{ color: '#6B645C', fontSize: 14 }}>used</span>
                    </div>
                    <div className="ds-usage-days">
                      {weekSegments.map(i => (
                        <span
                          key={i}
                          className={`ds-usage-day ${i <= activeDay ? 'is-active' : ''}`}
                          style={{ height: `${8 + (i === activeDay ? 18 : i <= activeDay ? 12 : 6)}px` }}
                        />
                      ))}
                      <span style={{ marginLeft: 6, fontSize: 13, color: '#6B645C' }}>{remaining} remaining</span>
                    </div>
                  </div>
                  <div className="ds-usage-daystats">
                    <span>Most used day: <strong style={{ color: '#1C1917' }}>{mostUsedDay}</strong></span>
                    <span>Avg per day: <strong style={{ color: '#1C1917' }}>{avgPerDay}</strong></span>
                  </div>
                </section>

                <section className="ds-card ds-list-card">
                  <div className="ds-list-head">
                    <h2 className="ds-list-title">Recent Transcripts</h2>
                    <span style={{ color: '#C6BCC9', letterSpacing: 2, fontWeight: 700 }}>•••</span>
                  </div>

                  {history.length === 0 ? (
                    <div className="ds-empty">
                      <h3>No transcripts yet</h3>
                      <p>Extract your first transcript and it will appear here.</p>
                      <button onClick={onBack}>Extract transcript</button>
                    </div>
                  ) : (
                    <>
                      {(showAllHistory ? history : history.slice(0, 4)).map((h, idx) => {
                        const wc = h.transcript ? h.transcript.trim().split(/\s+/).length : 0;
                        const title = h.title || h.id;
                        const channel = h.channel || (h.platform === 'vimeo' ? 'Vimeo' : 'YouTube');
                        return (
                          <div key={`${h.id}-${idx}`} className="ds-row">
                            <div className="ds-thumb">
                              {h.thumbnail ? (
                                <img src={h.thumbnail} alt={title} loading="lazy" />
                              ) : (
                                h.platform === 'vimeo' ? <VimeoIcon size={30} /> : <YouTubeIcon size={30} />
                              )}
                            </div>
                            <div className="ds-row-main" style={{ minWidth: 0 }}>
                              <p className="ds-row-title">{title}</p>
                              <p className="ds-row-meta">
                                {h.platform === 'vimeo' ? <VimeoIcon size={13} /> : <YouTubeIcon size={13} />}
                                {channel}
                                {wc > 0 ? `${wc.toLocaleString()} words` : null}
                                {timeAgo(h.date)}
                              </p>
                            </div>
                            <div className="ds-row-actions">
                              <button className="ds-row-btn primary" onClick={() => openTranscript(h)}>Open</button>
                            </div>
                          </div>
                        );
                      })}
                      {history.length > 4 && (
                        <div className="ds-list-footer">
                          <button className="ds-link-btn" onClick={() => setShowAllHistory(v => !v)}>
                            {showAllHistory ? 'Show less' : `+ View all ${history.length} transcripts`} <ChevronIcon size={11} dir={showAllHistory ? 'up' : 'right'} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </section>

              </div>
            )}

            {tab === 'settings' && (
              <section className="ds-settings">

                {/* ── Card 1: Profile ── */}
                <div className="ds-card">
                  <h3 className="ds-settings-title">Profile</h3>

                  {/* Display name */}
                  <div className="ds-setting-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                      <span className="ds-setting-label">Display name</span>
                      {!editingName && (
                        <div className="ds-settings-row-actions">
                          {nameSaved && <span style={{ fontSize: 12, color: P.success, fontWeight: 600 }}>Saved ✓</span>}
                          <button className="ds-settings-edit-btn" onClick={() => setEditingName(true)}>Edit</button>
                        </div>
                      )}
                    </div>
                    {editingName ? (
                      <div style={{ width: '100%' }}>
                        <input
                          className="ds-settings-input"
                          value={nameInput}
                          onChange={e => setNameInput(e.target.value)}
                          placeholder="Your display name"
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') saveDisplayName(); if (e.key === 'Escape') { setEditingName(false); setNameError(''); } }}
                        />
                        {nameError && <div className="ds-settings-feedback error" style={{ marginTop: 4 }}>{nameError}</div>}
                        <div className="ds-settings-row-actions" style={{ marginTop: 6 }}>
                          <button className="ds-settings-save-btn" onClick={saveDisplayName} disabled={nameSaving}>{nameSaving ? 'Saving…' : 'Save name'}</button>
                          <button className="ds-settings-cancel-btn" onClick={() => { setEditingName(false); setNameError(''); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <span className="ds-setting-value" style={{ textAlign: 'left', maxWidth: '100%' }}>{displayName}</span>
                    )}
                  </div>

                  {/* Email */}
                  <div className="ds-setting-row">
                    <span className="ds-setting-label">Email</span>
                    <span className="ds-setting-value">{user.email}</span>
                  </div>

                  {/* Member since */}
                  <div className="ds-setting-row">
                    <span className="ds-setting-label">Member since</span>
                    <span className="ds-setting-value">{memberSince}</span>
                  </div>

                  {/* Plan */}
                  <div className="ds-setting-row">
                    <span className="ds-setting-label">Current plan</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(45,108,223,0.1)', color: '#2D6CDF' }}>Free</span>
                      <span className="ds-setting-value" style={{ maxWidth: 'none' }}>{tierMax} credits / 7 days</span>
                    </div>
                  </div>
                </div>

                {/* ── Card 2: Preferences ── */}
                <div className="ds-card">
                  <h3 className="ds-settings-title">Preferences</h3>

                  {/* Transcript language */}
                  <div className="ds-setting-row" style={{ alignItems: 'center' }}>
                    <span className="ds-setting-label">Transcript language</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <select
                        value={lang}
                        onChange={e => {
                          const v = e.target.value;
                          setLang(v);
                          saveLangPref(v);
                          setPrefLangSaved(true);
                          setTimeout(() => setPrefLangSaved(false), 2000);
                        }}
                        style={{ fontSize: 13, padding: '5px 10px', borderRadius: 8, border: `1px solid ${P.border}`, background: P.paper, color: P.ink, cursor: 'pointer', outline: 'none' }}
                      >
                        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                      </select>
                      {prefLangSaved && <span style={{ fontSize: 12, color: P.success, fontWeight: 600 }}>Saved ✓</span>}
                    </div>
                  </div>

                  {/* Default export format */}
                  <div className="ds-setting-row" style={{ alignItems: 'center' }}>
                    <span className="ds-setting-label">Default export format</span>
                    <select
                      value={prefFormat}
                      onChange={e => {
                        setPrefFormat(e.target.value);
                        try { localStorage.setItem(prefKey('format'), e.target.value); } catch {}
                        savePrefsToCloud({ format: e.target.value });
                      }}
                      style={{ fontSize: 13, padding: '5px 10px', borderRadius: 8, border: `1px solid ${P.border}`, background: P.paper, color: P.ink, cursor: 'pointer', outline: 'none' }}
                    >
                      <option value="plain">Plain text (.txt)</option>
                      <option value="srt">Subtitles (.srt)</option>
                      <option value="pdf">Document (.pdf)</option>
                    </select>
                  </div>

                  {/* Show timestamps toggle */}
                  <div className="ds-setting-row" style={{ alignItems: 'center' }}>
                    <div>
                      <span className="ds-setting-label">Show timestamps</span>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9B9490' }}>Display time markers in transcripts</p>
                    </div>
                    <label className="ds-toggle">
                      <input
                        type="checkbox"
                        checked={prefTimestamps}
                        onChange={e => {
                          setPrefTimestamps(e.target.checked);
                          try { localStorage.setItem(prefKey('timestamps'), String(e.target.checked)); } catch {}
                          savePrefsToCloud({ timestamps: e.target.checked });
                        }}
                      />
                      <span className="ds-toggle-track" />
                    </label>
                  </div>

                  {/* Auto-copy toggle */}
                  <div className="ds-setting-row" style={{ alignItems: 'center' }}>
                    <div>
                      <span className="ds-setting-label">Auto-copy transcript</span>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9B9490' }}>Copy to clipboard after extraction</p>
                    </div>
                    <label className="ds-toggle">
                      <input
                        type="checkbox"
                        checked={prefAutoCopy}
                        onChange={e => {
                          setPrefAutoCopy(e.target.checked);
                          try { localStorage.setItem(prefKey('autocopy'), String(e.target.checked)); } catch {}
                          savePrefsToCloud({ autocopy: e.target.checked });
                        }}
                      />
                      <span className="ds-toggle-track" />
                    </label>
                  </div>
                </div>

                {/* ── Card 3: Security ── */}
                <div className="ds-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <h3 className="ds-settings-title" style={{ marginBottom: 2 }}>Security</h3>

                  {pwStep === 'idle' && (
                    <button className="ds-settings-btn" onClick={() => { setPwStep('form'); setPwError(''); }}>Change password</button>
                  )}

                  {(pwStep === 'form' || pwStep === 'confirm') && (
                    <div className="ds-settings-form">
                      <div>
                        <label className="ds-settings-form-label">Current password</label>
                        <input className="ds-settings-input" type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} placeholder="Enter current password" />
                      </div>
                      <div>
                        <label className="ds-settings-form-label">New password</label>
                        <input className="ds-settings-input" type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="Min. 6 characters" />
                      </div>
                      <div>
                        <label className="ds-settings-form-label">Confirm new password</label>
                        <input className="ds-settings-input" type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder="Repeat new password" />
                      </div>
                      {pwError && <div className="ds-settings-feedback error">{pwError}</div>}

                      {pwStep === 'form' && (
                        <div className="ds-settings-row-actions">
                          <button className="ds-settings-save-btn" style={{ flex: 1 }} onClick={() => {
                            if (!pwCurrent) { setPwError('Enter your current password.'); return; }
                            if (pwNew.length < 6) { setPwError('New password must be at least 6 characters.'); return; }
                            if (pwNew !== pwConfirm) { setPwError('New passwords do not match.'); return; }
                            setPwError(''); setPwStep('confirm');
                          }}>Continue</button>
                          <button className="ds-settings-cancel-btn" onClick={() => { setPwStep('idle'); setPwCurrent(''); setPwNew(''); setPwConfirm(''); setPwError(''); }}>Cancel</button>
                        </div>
                      )}

                      {pwStep === 'confirm' && (
                        <div className="ds-settings-confirm-box neutral">
                          <p className="ds-settings-confirm-text">Are you sure you want to change your password? You'll stay signed in on this device.</p>
                          <div className="ds-settings-confirm-row">
                            <button className="ds-settings-save-btn" style={{ flex: 1 }} onClick={handlePasswordChange}>Yes, change it</button>
                            <button className="ds-settings-cancel-btn" onClick={() => setPwStep('form')}>Go back</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {pwStep === 'loading' && <div className="ds-settings-feedback loading">Updating your password…</div>}
                  {pwStep === 'success' && <div className="ds-settings-feedback success">Password updated successfully ✓</div>}

                  <div style={{ borderTop: `1px solid ${P.border}`, paddingTop: 10, marginTop: 2 }}>
                    {!signOutConfirm ? (
                      <button className="ds-settings-btn danger" onClick={() => setSignOutConfirm(true)}>Sign out of account</button>
                    ) : (
                      <div className="ds-settings-confirm-box">
                        <p className="ds-settings-confirm-text">Are you sure you want to sign out?</p>
                        <div className="ds-settings-confirm-row">
                          <button className="ds-settings-save-btn" style={{ flex: 1, background: P.error }} onClick={onSignOut}>Yes, sign out</button>
                          <button className="ds-settings-cancel-btn" onClick={() => setSignOutConfirm(false)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Card 4: Data & Storage ── */}
                <div className="ds-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <h3 className="ds-settings-title" style={{ marginBottom: 2 }}>Data & Storage</h3>
                  <p className="ds-settings-help">Your transcripts are stored locally on this device.</p>

                  <div className="ds-setting-row" style={{ border: 'none', padding: '4px 0' }}>
                    <span className="ds-setting-label">Saved transcripts</span>
                    <span className="ds-setting-value">{history.length} / 10</span>
                  </div>

                  <button
                    className="ds-settings-btn"
                    onClick={exportHistory}
                    disabled={history.length === 0}
                    style={{ opacity: history.length === 0 ? 0.45 : 1 }}
                  >Export history as JSON</button>

                  {!clearConfirm ? (
                    <button
                      className="ds-settings-btn danger"
                      onClick={() => setClearConfirm(true)}
                      disabled={history.length === 0}
                      style={{ opacity: history.length === 0 ? 0.45 : 1 }}
                    >Clear all history</button>
                  ) : (
                    <div className="ds-settings-confirm-box">
                      {clearDone ? (
                        <div className="ds-settings-feedback success" style={{ margin: 0 }}>History cleared ✓</div>
                      ) : (
                        <>
                          <p className="ds-settings-confirm-text">This will permanently delete all {history.length} saved transcript{history.length !== 1 ? 's' : ''}. This cannot be undone.</p>
                          <div className="ds-settings-confirm-row">
                            <button className="ds-settings-save-btn" style={{ flex: 1, background: P.error }} onClick={handleClearHistory}>Yes, clear all</button>
                            <button className="ds-settings-cancel-btn" onClick={() => setClearConfirm(false)}>Cancel</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

              </section>
            )}
          </main>

          {tab === 'overview' && (
            <aside className="ds-side">
              {/* ── Continue where you left off ── */}
              <section className="ds-card ds-continue">
                <div className="ds-continue-header">
                  <h2 className="ds-side-title">Continue where you left off</h2>
                </div>
                {latest ? (
                  <>
                    <div className="ds-continue-thumb" onClick={() => openTranscript(latest)}>
                      {latest.thumbnail ? (
                        <img src={latest.thumbnail} alt={latest.title || 'Video'} loading="lazy" />
                      ) : (
                        <div style={{ color: 'rgba(45,108,223,0.3)' }}>
                          {latest.platform === 'vimeo' ? <VimeoIcon size={48} /> : <YouTubeIcon size={48} />}
                        </div>
                      )}
                      <div className="ds-continue-play">
                        <div className="ds-continue-play-icon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="#1C1917" style={{ marginLeft: 2 }}>
                            <polygon points="5 3 19 12 5 21 5 3"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                    <div className="ds-continue-body">
                      <p className="ds-continue-video-title">{latest.title || latest.id}</p>
                      <p className="ds-continue-meta">
                        {latest.platform === 'vimeo' ? <VimeoIcon size={12} /> : <YouTubeIcon size={12} />}
                        {latest.channel || (latest.platform === 'vimeo' ? 'Vimeo' : 'YouTube')}
                        {latestWc > 0 && <span style={{ color: '#C0BAB3' }}>·</span>}
                        {latestWc > 0 && `${latestWc.toLocaleString()} words`}
                      </p>
                      <button className="ds-continue-open-btn" onClick={() => openTranscript(latest)}>Open</button>
                      <div className="ds-continue-quick">
                        <button className="ds-continue-quick-btn" onClick={() => openTranscript(latest)}>Summarize</button>
                        <button className="ds-continue-quick-btn" onClick={() => openTranscript(latest)}>Flashcards</button>
                        <button className="ds-continue-quick-btn" onClick={() => openTranscript(latest)}>Study guide</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="ds-continue-empty">
                    <p style={{ margin: 0 }}>Extract a transcript to see it here.</p>
                    <button
                      style={{ marginTop: 12, border: 'none', borderRadius: 10, background: '#2D6CDF', color: 'white', fontSize: 13, fontWeight: 600, padding: '8px 16px', cursor: 'pointer' }}
                      onClick={onBack}
                    >Extract transcript</button>
                  </div>
                )}
              </section>

              {/* ── Invite friends (sidebar referral card) ── */}
              <section className="ds-card ds-referral">
                <div className="ds-referral-banner">
                  <div className="ds-referral-head">
                    <div className="ds-referral-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                    </div>
                    <div>
                      <h2 className="ds-referral-title">Invite friends, earn credits</h2>
                      <p className="ds-referral-subtitle">Share your link · both get rewarded</p>
                    </div>
                  </div>
                  <div className="ds-referral-badge">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    +3 free credits per friend who signs up
                  </div>
                </div>
                <div className="ds-referral-body">
                  <p className="ds-referral-desc">
                    Share your personal link. Every friend who signs up gets a bonus — and so do you.
                  </p>
                  <div className="ds-referral-link-row">
                    <div className="ds-referral-link-box">{refLink}</div>
                    <button
                      className={`ds-referral-copy-btn${copyRefDone ? ' done' : ''}`}
                      onClick={copyRefLink}
                    >
                      {copyRefDone ? '✓ Copied!' : 'Copy link'}
                    </button>
                  </div>
                  <div className="ds-referral-share-row">
                    <button className="ds-referral-share-btn ds-referral-share-wa"
                      onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Check out ScribeSnap — it extracts YouTube transcripts in seconds! Sign up with my link and we both get +3 free credits: ${refLink}`)}`, '_blank')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                      WhatsApp
                    </button>
                    <button className="ds-referral-share-btn ds-referral-share-x"
                      onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent('I use ScribeSnap to get YouTube transcripts instantly 🎬 Try it free — use my invite link and we both get +3 bonus credits 👉')}&url=${encodeURIComponent(refLink)}`, '_blank')}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                      Share on X
                    </button>
                    <button className="ds-referral-share-btn ds-referral-share-ig"
                      onClick={() => { navigator.clipboard.writeText(`Check out ScribeSnap — it extracts YouTube transcripts in seconds! Sign up with my link and we both get +3 free credits: ${refLink}`); window.open('https://www.instagram.com/', '_blank'); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="white">
                        <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
                      </svg>
                      Instagram
                    </button>
                    <button className="ds-referral-share-btn ds-referral-share-email"
                      onClick={() => { window.location.href = `mailto:?subject=${encodeURIComponent('Try ScribeSnap — free YouTube transcript tool')}&body=${encodeURIComponent(`Check out ScribeSnap — it extracts YouTube transcripts in seconds! Sign up with my link and we both get +3 free credits: ${refLink}`)}`; }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>
                      Email
                    </button>
                  </div>
                  {((user?.user_metadata?.referral_count || 0) > 0 || (user?.user_metadata?.referral_bonus || 0) > 0) && (
                    <div className="ds-referral-stats">
                      <div className="ds-referral-stat">
                        <span className="ds-referral-stat-value">{user?.user_metadata?.referral_count || 0}</span>
                        <span className="ds-referral-stat-label">friends joined</span>
                      </div>
                      <div className="ds-referral-stat">
                        <span className="ds-referral-stat-value">+{user?.user_metadata?.referral_bonus || 0}</span>
                        <span className="ds-referral-stat-label">credits earned</span>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};

// ── UserMenu ──────────────────────────────────────────────────────────────────
const UserMenu = ({ user, onSignOut, onDashboard }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const initial = (user.email || '?')[0].toUpperCase();

  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const menuItem = (icon, label, onClick, danger = false) => (
    <button onClick={() => { setOpen(false); onClick(); }} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 16px',
      background: 'none', border: 'none', cursor: 'pointer',
      fontSize: 13, color: danger ? P.muted : P.muted, textAlign: 'left', transition: 'all 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = danger ? P.error : P.ink; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = P.muted; }}
    >{icon}{label}</button>
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} title={user.email} style={{
        width: 32, height: 32, borderRadius: '50%',
        background: P.accent, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, color: 'white', transition: 'background 0.15s',
      }}
        onMouseEnter={e => { e.currentTarget.style.background = P.accentHover; }}
        onMouseLeave={e => { e.currentTarget.style.background = P.accent; }}
      >{initial}</button>

      {open && (
        <div className="fade-up" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)',
          width: 220, background: P.surface, border: `1px solid ${P.border}`,
          borderRadius: 14, boxShadow: '0 8px 32px rgba(28,25,23,0.12)',
          padding: '8px 0', zIndex: 200, overflow: 'hidden',
        }}>
          {/* User info */}
          <div style={{ padding: '8px 16px 10px', borderBottom: `1px solid ${P.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: P.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0 }}>{initial}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: P.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email?.split('@')[0]}</div>
                <div style={{ fontSize: 11, color: P.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
              </div>
            </div>
          </div>

          {menuItem(
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
            'Dashboard', onDashboard
          )}
          <div style={{ height: 1, background: P.border, margin: '4px 0' }} />
          {menuItem(
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
            'Sign out', onSignOut, true
          )}
        </div>
      )}
    </div>
  );
};

// ── Navbar ────────────────────────────────────────────────────────────────────
const Navbar = ({ onAskAI, hasTranscript, credits, user, onSignIn, onSignOut, onDashboard, onHome, onShowReferralPromo }) => (
  <nav style={{
    position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
    height: 56, display: 'flex', alignItems: 'center',
    padding: '0 28px',
    background: P.surface,
    borderBottom: `1px solid ${P.border}`,
  }}>
    <a
      href="/"
      onClick={(e) => { e.preventDefault(); onHome?.(); }}
      aria-label={`Go to ${BRAND_NAME} home`}
      style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}
    >
      <img
        src={FOOTER_LOGO_SRC}
        alt={BRAND_NAME}
        style={{ height: 40, width: 'auto', display: 'block' }}
      />
    </a>

    <div style={{ flex: 1 }} />

    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <CreditsWidget credits={credits} onUpgrade={() => onSignIn('signup')} user={user} onShowReferralPromo={onShowReferralPromo} />
      <div style={{ width: 1, height: 18, background: P.border }} />
      {user ? (
        <UserMenu user={user} onSignOut={onSignOut} onDashboard={onDashboard} />
      ) : (
        <button
          onClick={onSignIn}
          style={{
            marginLeft: 2, padding: '7px 16px', borderRadius: 8, border: 'none',
            background: P.accent, color: 'white',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = P.accentHover; }}
          onMouseLeave={e => { e.currentTarget.style.background = P.accent; }}
        >Sign in</button>
      )}
    </div>
  </nav>
);

// ── Main App ──────────────────────────────────────────────────────────────────
const App = () => {
  const [videoUrl, setVideoUrl]           = useState('');
  const [lang, setLang]                   = useState(() => localStorage.getItem('yte_lang') || 'en');
  const [transcript, setTranscript]       = useState('');
  const [segments, setSegments]           = useState([]);
  const [transcriptSource, setTranscriptSource] = useState('');
  const [currentVideoId, setCurrentVideoId] = useState(null);
  const [currentPlatform, setCurrentPlatform] = useState('youtube');
  const [currentThumbnail, setCurrentThumbnail] = useState(null);
  const [loading, setLoading]             = useState(false);
  const [loadingMsg, setLoadingMsg]       = useState('');
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [loadingStage, setLoadingStage]   = useState('');
  const [langRefetching, setLangRefetching] = useState(false);
  const [langRefetchMsg, setLangRefetchMsg] = useState('');
  const [isTranslated, setIsTranslated]   = useState(false);
  const [error, setError]                 = useState('');
  const [copied, setCopied]               = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [search, setSearch]               = useState('');
  const [history, setHistory]             = useState(() => {
    try { return JSON.parse(localStorage.getItem('yte_history') || '[]'); } catch { return []; }
  });
  const [credits, setCredits] = useState(initCredits);
  const [showBookmarkBanner, setShowBookmarkBanner] = useState(false);
  const [showReferralBanner, setShowReferralBanner] = useState(false);
  const [showReferralPromo, setShowReferralPromo] = useState(false);
  const [user, setUser]                   = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authInitialTab, setAuthInitialTab] = useState('signin');
  const [view, setView]                   = useState('app');   // 'app' | 'dashboard'
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [summary, setSummary]             = useState('');
  const [summarizing, setSummarizing]     = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [showTopics, setShowTopics]         = useState(false);
  const [showQA, setShowQA]               = useState(false);
  const [qaQuestion, setQaQuestion]       = useState('');
  const [qaMessages, setQaMessages]       = useState([]);
  const [qaLoading, setQaLoading]         = useState(false);
  const [timeline, setTimeline]           = useState(null);  // [{title, startSeconds, summary}]
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [flashcards, setFlashcards]               = useState([]);       // [{question, answer, topic}]
  const [flashcardsLoading, setFlashcardsLoading] = useState(false);
  const [showFlashcardModal, setShowFlashcardModal] = useState(false);
  const [flashcardIndex, setFlashcardIndex]       = useState(0);
  const [flashcardFlipped, setFlashcardFlipped]   = useState(false);
  const [flashcardKnown, setFlashcardKnown]       = useState(new Set());
  const [flashcardsMoreLoading, setFlashcardsMoreLoading] = useState(false);
  const [flashcardsExhausted, setFlashcardsExhausted]     = useState(false);
  const [flashcardsExhaustedReason, setFlashcardsExhaustedReason] = useState('');
  const [expandedCards, setExpandedCards]         = useState(new Set());  // indices expanded in tab view
  const [studyGuide, setStudyGuide]               = useState(null);     // {overview, objectives, keyConcepts, sections, reviewQuestions}
  const [studyGuideLoading, setStudyGuideLoading] = useState(false);
  const [studyGuideFull, setStudyGuideFull]       = useState(false);
  const [activeLogo, setActiveLogo]               = useState('youtube'); // 'youtube' | 'vimeo'
  const [logoFlip, setLogoFlip]                   = useState('idle');    // 'idle' | 'out' | 'in'
  const [sgQuestion, setSgQuestion]               = useState('');
  const [sgMessages, setSgMessages]               = useState([]);       // [{role, text, isError?}]
  const [sgLoading, setSgLoading]                 = useState(false);
  const [activeTab, setActiveTab]         = useState('transcript'); // 'transcript' | 'timeline' | 'editor' | 'summary' | 'study-guide'
  const [currentTitle, setCurrentTitle]   = useState('');
  const [currentChannel, setCurrentChannel] = useState('');
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [playingSegment, setPlayingSegment] = useState(null);
  const [exportToggle, setExportToggle]   = useState(false);

  const downloadMenuRef    = useRef(null);
  const qaInputRef         = useRef(null);
  const playerRef          = useRef(null);
  const segmentRefs        = useRef({});
  const transcriptListRef  = useRef(null);
  const playingSegmentRef  = useRef(null);
  const ytPlayerRef        = useRef(null);
  const ytPlayerDivRef     = useRef(null);
  const timeIntervalRef    = useRef(null);
  const segmentsRef        = useRef([]);
  const urlInputRef     = useRef(null);
  const qaRef           = useRef(null);
  const chatMessagesRef = useRef(null);
  const recoveryIntentRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = window.location.hostname.toLowerCase();
    if (host !== `www.${CANONICAL_APP_HOST}`) return;
    const target = `${CANONICAL_APP_ORIGIN}${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(target);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target))
        setShowDownloadMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keep segmentsRef in sync so intervals can read latest value without stale closure
  useEffect(() => { segmentsRef.current = segments; }, [segments]);

  // Study guide fullscreen — Escape to close
  useEffect(() => {
    if (!studyGuideFull) return;
    const handler = (e) => { if (e.key === 'Escape') setStudyGuideFull(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [studyGuideFull]);

  // Flashcard modal keyboard navigation
  useEffect(() => {
    if (!showFlashcardModal) return;
    const handler = (e) => {
      if (e.key === 'ArrowRight') fcNext();
      else if (e.key === 'ArrowLeft') fcPrev();
      else if (e.key === ' ') { e.preventDefault(); setFlashcardFlipped(f => !f); }
      else if (e.key === 'Escape') closeFlashcardModal();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showFlashcardModal, flashcardIndex, flashcards.length]);

  // Reset playing segment when transcript changes
  useEffect(() => {
    setPlayingSegment(null);
    playingSegmentRef.current = null;
  }, [segments]);

  // Flip-clock logo alternation — only when no URL is typed
  useEffect(() => {
    if (parseVideoUrl(videoUrl)?.platform) return;
    const FLIP_DURATION = 220;
    const id = setInterval(() => {
      setLogoFlip('out');
      const t1 = setTimeout(() => {
        setActiveLogo(p => p === 'youtube' ? 'vimeo' : 'youtube');
        setLogoFlip('in');
        const t2 = setTimeout(() => setLogoFlip('idle'), FLIP_DURATION);
        return () => clearTimeout(t2);
      }, FLIP_DURATION);
      return () => clearTimeout(t1);
    }, 2800);
    return () => clearInterval(id);
  }, [videoUrl]);

  // YouTube IFrame API — proper SDK approach for reliable time tracking
  useEffect(() => {
    if (!currentVideoId || currentPlatform === 'vimeo') return;

    // Cleanup previous player + interval
    clearInterval(timeIntervalRef.current);
    if (ytPlayerRef.current) {
      try { ytPlayerRef.current.destroy(); } catch (e) {}
      ytPlayerRef.current = null;
    }

    const createPlayer = () => {
      const wrapper = ytPlayerDivRef.current;
      if (!wrapper || !window.YT?.Player) return;
      // YT.Player replaces its target element with an <iframe>.
      // We must give it an inner div (not the React-managed wrapper) so React
      // doesn't destroy the iframe on the next re-render (e.g. when playingSegment updates).
      wrapper.innerHTML = '';
      const innerDiv = document.createElement('div');
      wrapper.appendChild(innerDiv);
      ytPlayerRef.current = new window.YT.Player(innerDiv, {
        videoId: currentVideoId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onStateChange: (e) => {
            clearInterval(timeIntervalRef.current);
            if (e.data === 1 /* PLAYING */) {
              timeIntervalRef.current = setInterval(() => {
                const t = ytPlayerRef.current?.getCurrentTime?.();
                if (typeof t !== 'number') return;
                const segs = segmentsRef.current;
                if (!segs.length) return;
                let idx = 0;
                for (let i = 0; i < segs.length; i++) {
                  if (segs[i].seconds <= t) idx = i;
                  else break;
                }
                if (idx !== playingSegmentRef.current) {
                  playingSegmentRef.current = idx;
                  setPlayingSegment(idx);
                  const el = segmentRefs.current[idx];
                  const listEl = transcriptListRef.current;
                  if (el && listEl) {
                    const elRect = el.getBoundingClientRect();
                    const listRect = listEl.getBoundingClientRect();
                    const relativeTop = elRect.top - listRect.top + listEl.scrollTop;
                    const scrollTarget = relativeTop - listEl.clientHeight / 3;
                    listEl.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
                  }
                }
              }, 500);
            }
          },
        },
      });
    };

    if (window.YT?.Player) {
      createPlayer();
    } else {
      // Load the YouTube IFrame API script once
      if (!document.getElementById('yt-iframe-api-script')) {
        const tag = document.createElement('script');
        tag.id = 'yt-iframe-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prev) prev();
        createPlayer();
      };
    }

    return () => {
      clearInterval(timeIntervalRef.current);
      if (ytPlayerRef.current) {
        try { ytPlayerRef.current.destroy(); } catch (e) {}
        ytPlayerRef.current = null;
      }
      if (ytPlayerDivRef.current) ytPlayerDivRef.current.innerHTML = '';
    };
  }, [currentVideoId, currentPlatform]);

  useEffect(() => {
    if (localStorage.getItem('yte_bookmark_dismissed')) return;
    const t = setTimeout(() => setShowBookmarkBanner(true), 4000);
    return () => clearTimeout(t);
  }, []);

  // Show referral promo after 5 min for signed-in users who haven't referred anyone yet
  useEffect(() => {
    if (!user) return;
    if ((user.user_metadata?.referral_count || 0) > 0) return;
    const t = setTimeout(() => setShowReferralPromo(true), 5 * 60 * 1000);
    return () => clearTimeout(t);
  }, [user]);

  // ── Supabase auth session ──────────────────────────────────────────────────
  useEffect(() => {
    const authState = getAuthUrlState();
    recoveryIntentRef.current = authState.isRecovery;

    // Capture ?ref= referral param before cleanupAuthUrl removes it
    const pendingRefParam = new URLSearchParams(window.location.search).get('ref');
    if (pendingRefParam) {
      localStorage.setItem('yte_pending_ref', pendingRefParam);
    }

    let mounted = true;
    const bootstrapAuth = async () => {
      // Handle recovery links that arrive as token_hash + type=recovery.
      if (authState.isRecovery && authState.tokenHash) {
        const { data, error } = await supabase.auth.verifyOtp({
          type: 'recovery',
          token_hash: authState.tokenHash,
        });
        if (!error && data?.session?.user) {
          if (!mounted) return;
          setUser(data.session.user);
          setShowPasswordReset(true);
          recoveryIntentRef.current = false;
          cleanupAuthUrl();
          return;
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      setUser(session?.user ?? null);
      if (recoveryIntentRef.current && session?.user) {
        setShowPasswordReset(true);
        recoveryIntentRef.current = false;
      }
      // Avoid stripping auth callback params before session exchange finishes.
      if (session?.user || !authState.hasBlockingAuthParams) cleanupAuthUrl();
      // Show referral invite banner if visitor arrived via a ref link and isn't signed in
      if (!session?.user && localStorage.getItem('yte_pending_ref')) {
        setShowReferralBanner(true);
      }
    };
    bootstrapAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowPasswordReset(true);
        recoveryIntentRef.current = false;
        cleanupAuthUrl();
        return;
      }

      const shouldOpenRecoveryModal = (
        recoveryIntentRef.current &&
        !!session?.user &&
        (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
      );
      setUser(session?.user ?? null);
      if (shouldOpenRecoveryModal) {
        setShowPasswordReset(true);
        recoveryIntentRef.current = false;
      }
      if (session?.user || !getAuthUrlState().hasBlockingAuthParams) cleanupAuthUrl();

      // Hide referral banner once signed in
      if (event === 'SIGNED_IN' && session?.user) setShowReferralBanner(false);

      // Auto-claim referral bonus on first sign-in
      if (event === 'SIGNED_IN' && session?.user) {
        const claimRef = localStorage.getItem('yte_pending_ref');
        if (claimRef && claimRef !== session.user.id) {
          try {
            const resp = await fetch('/api/referral/claim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ referrer_id: claimRef }),
            });
            // On success or known terminal error, clear the pending ref
            if (resp.ok || resp.status === 409 || resp.status === 400 || resp.status === 404) {
              localStorage.removeItem('yte_pending_ref');
            }
            if (resp.ok) {
              // Refresh user metadata so referral_bonus is reflected immediately
              const { data: { user: refreshed } } = await supabase.auth.getUser();
              if (refreshed) setUser(refreshed);
            }
          } catch (_) { /* network error — will retry next sign-in */ }
        }
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Load user-specific lang preference on login/logout — cloud takes priority over localStorage
  useEffect(() => {
    const cloudLang = user?.user_metadata?.prefs?.lang;
    if (cloudLang) { setLang(cloudLang); return; }
    const key = user ? `yte_lang_${user.id}` : 'yte_lang';
    const saved = localStorage.getItem(key);
    if (saved) setLang(saved);
  }, [user]);

  const saveLangPref = (newLang) => {
    const key = user ? `yte_lang_${user.id}` : 'yte_lang';
    localStorage.setItem(key, newLang);
  };

  // Re-init credits keyed by user when auth changes
  useEffect(() => {
    const anonKey = 'yte_credits';
    const key = user ? `yte_credits_${user.id}` : anonKey;
    try {
      let stored = JSON.parse(localStorage.getItem(key) || 'null');

      // If signed in and no user-specific credits yet, migrate anon credits once
      if (user && !stored) {
        const anon = JSON.parse(localStorage.getItem(anonKey) || 'null');
        if (anon && typeof anon.resetAt === 'number' && Date.now() <= anon.resetAt) {
          stored = anon;
          localStorage.setItem(key, JSON.stringify(stored));
        }
      }

      const referralBonus = user?.user_metadata?.referral_bonus || 0;
      const tierMax = user ? CREDITS_MAX + referralBonus : CREDITS_FREE;

      if (!stored || typeof stored.resetAt !== 'number' || Date.now() > stored.resetAt) {
        stored = { used: 0, resetAt: Date.now() + CREDITS_PERIOD_MS };
      }

      if (stored.used > tierMax) stored = { ...stored, used: tierMax };

      stored = { ...stored, tierMax, userId: user ? user.id : null };
      localStorage.setItem(key, JSON.stringify(stored));
      setCredits(stored);
    } catch {
      const referralBonus = user?.user_metadata?.referral_bonus || 0;
      setCredits({ used: 0, resetAt: Date.now() + CREDITS_PERIOD_MS, tierMax: user ? CREDITS_MAX + referralBonus : CREDITS_FREE, userId: user ? user.id : null });
    }
  }, [user]);

  // Re-init history keyed by user when auth changes
  useEffect(() => {
    const key = user ? `yte_history_${user.id}` : 'yte_history';
    try { setHistory(JSON.parse(localStorage.getItem(key) || '[]')); } catch { setHistory([]); }
  }, [user]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null); setView('app');
  };

  const dismissBookmarkBanner = () => {
    setShowBookmarkBanner(false);
    localStorage.setItem('yte_bookmark_dismissed', '1');
  };

  const incrementCredits = () => {
    setCredits(prev => {
      const bonus = user?.user_metadata?.referral_bonus || 0;
      const max = user ? CREDITS_MAX + bonus : CREDITS_FREE;
      const next = { ...prev, used: Math.min(max, prev.used + 1), tierMax: max, userId: user?.id ?? null };
      const key = user ? `yte_credits_${user.id}` : 'yte_credits';
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  };

  const handleInputFocus = async () => {
    if (videoUrl) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text && (text.includes('youtube.com') || text.includes('youtu.be'))) {
        setVideoUrl(text.trim());
      }
    } catch {}
  };

  const saveToHistory = (entry) => {
    setHistory(prev => {
      const next = [entry, ...prev.filter(h => h.id !== entry.id)].slice(0, 10);
      const key = user ? `yte_history_${user.id}` : 'yte_history';
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  };

  const deleteFromHistory = (id, e) => {
    e.stopPropagation();
    setHistory(prev => {
      const next = prev.filter(h => h.id !== id);
      const key = user ? `yte_history_${user.id}` : 'yte_history';
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  };

  const loadFromHistory = (entry) => {
    const platform = entry.platform || 'youtube';
    setVideoUrl(platform === 'vimeo' ? `https://vimeo.com/${entry.id}` : `https://youtube.com/watch?v=${entry.id}`);
    setTranscript(entry.transcript);
    setSegments(entry.segments || []);
    setTranscriptSource(entry.source || '');
    setCurrentVideoId(entry.id);
    setCurrentPlatform(platform);
    setCurrentThumbnail(entry.thumbnail || null);
    setCurrentTitle(entry.title || '');
    setCurrentChannel(entry.channel || '');
    setError(''); setSearch('');
    setSummary(''); setTimeline(null); setShowQA(false); setQaMessages([]);
    setFlashcards([]); setFlashcardsExhausted(false); setFlashcardsExhaustedReason(''); setExpandedCards(new Set()); setStudyGuide(null); setSgMessages([]); setStudyGuideFull(false); setShowFlashcardModal(false);
    setActiveTab('transcript');
  };

  const resetAll = () => {
    setVideoUrl(''); setTranscript(''); setSegments([]); setIsTranslated(false);
    setTranscriptSource(''); setCurrentVideoId(null); setCurrentPlatform('youtube'); setCurrentThumbnail(null); setError(''); setSearch('');
    setSummary(''); setShowTimestamps(true); setShowTopics(false); setShowQA(false);
    setQaQuestion(''); setQaMessages([]);
    setTimeline(null);
    setFlashcards([]); setFlashcardsExhausted(false); setFlashcardsExhaustedReason(''); setExpandedCards(new Set()); setStudyGuide(null); setSgMessages([]); setStudyGuideFull(false); setShowFlashcardModal(false);
    setActiveTab('transcript');
    setCurrentTitle(''); setCurrentChannel('');
    setSelectedSegment(null); setExportToggle(false);
  };

  const goHome = () => {
    setView('app');
    setShowAuthModal(false);
    setShowPasswordReset(false);
    resetAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const askQuestion = async (overrideQ) => {
    const q = (overrideQ || qaQuestion).trim();
    if (!q || qaLoading) return;
    setShowQA(true);
    setQaMessages(prev => [...prev, { role: 'user', text: q }]);
    setQaQuestion('');
    setQaLoading(true);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, question: q }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch {
        throw new Error(res.ok ? 'Unexpected server response' : `Server error ${res.status}`);
      }
      if (!res.ok) throw new Error(data.details || data.error || 'Failed to get answer');
      setQaMessages(prev => [...prev, { role: 'ai', text: data.answer }]);
    } catch (err) {
      setQaMessages(prev => [...prev, { role: 'ai', text: `Error: ${err.message}`, isError: true }]);
    } finally {
      setQaLoading(false);
      setTimeout(() => qaInputRef.current?.focus(), 50);
    }
  };

  // Auto-scroll chat messages container to bottom (direct scrollTop, no page scroll)
  useEffect(() => {
    const el = chatMessagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [qaMessages, qaLoading]);

  const getTranscript = (langOverride) => {
    const parsed = parseVideoUrl(videoUrl);
    if (!parsed) { setError(funnyTranscriptError('invalid url')); return; }
    const { platform, id: videoId, url: videoCanonical } = parsed;
    const langToUse = langOverride || lang;

    setError(''); setTranscript(''); setTranscriptSource('');
    setSegments([]); setCurrentVideoId(null); setCurrentPlatform(platform); setCurrentThumbnail(null); setSearch('');
    setSummary(''); setTimeline(null); setShowTopics(false);
    setFlashcards([]); setFlashcardsExhausted(false); setFlashcardsExhaustedReason(''); setExpandedCards(new Set()); setStudyGuide(null); setSgMessages([]); setStudyGuideFull(false); setQaMessages([]); setShowQA(false);
    setLoading(true); setLoadingMsg('Looking for subtitles…');
    setLoadingPercent(5); setLoadingStage('subtitles');

    const apiUrl = platform === 'vimeo'
      ? `/api/transcript?platform=vimeo&url=${encodeURIComponent(videoCanonical)}&lang=${langToUse}`
      : `/api/transcript?videoId=${videoId}&lang=${langToUse}`;
    const es = new EventSource(apiUrl);
    const killTimer = setTimeout(() => {
      es.close();
      setError(funnyTranscriptError('timed out'));
      setLoading(false); setLoadingMsg(''); setLoadingPercent(0); setLoadingStage('');
    }, 180000);

    es.addEventListener('progress', (e) => {
      const { message, percent, stage } = JSON.parse(e.data);
      setLoadingMsg(message); setLoadingPercent(percent || 0); setLoadingStage(stage || '');
    });

    es.addEventListener('done', async (e) => {
      clearTimeout(killTimer); es.close();
      try {
        const data = JSON.parse(e.data);
        const meta = await fetchVideoMeta(platform, videoCanonical);
        const title = meta.title || data.title || videoId;
        const channel = meta.channel || data.channel || (platform === 'vimeo' ? 'Vimeo' : 'YouTube');
        const thumb = data.thumbnail || meta.thumbnail || (platform === 'youtube' ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null);

        setTranscript(data.transcript);
        setSegments(data.segments || []);
        setIsTranslated(false); // never show banner on initial load
        setTranscriptSource(data.source || '');
        setCurrentVideoId(videoId);
        setCurrentThumbnail(thumb);
        setCurrentTitle(title);
        setCurrentChannel(channel);
        setLoadingPercent(100);
        incrementCredits();
        // After 3rd extraction, nudge signed-in users without referrals to share
        if (user && (credits.used + 1) === 3 && !(user.user_metadata?.referral_count)) {
          setTimeout(() => setShowReferralPromo(true), 1500);
        }
        saveToHistory({
          id: videoId, platform, transcript: data.transcript, segments: data.segments || [],
          source: data.source || '', date: new Date().toISOString(),
          thumbnail: thumb, title, channel, url: videoCanonical,
        });
      } catch {
        setError(funnyTranscriptError('failed to process'));
      } finally {
        setLoading(false); setLoadingMsg(''); setLoadingPercent(0); setLoadingStage('');
      }
    });

    es.addEventListener('error', (e) => {
      clearTimeout(killTimer); es.close();
      try {
        const data = JSON.parse(e.data);
        setError(funnyTranscriptError(data.details ? `${data.error}: ${data.details}` : (data.error || 'failed to fetch')));
      } catch { setError(funnyTranscriptError('connection')); }
      setLoading(false); setLoadingMsg(''); setLoadingPercent(0); setLoadingStage('');
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      clearTimeout(killTimer); es.close();
      setError(funnyTranscriptError('connection'));
      setLoading(false); setLoadingMsg(''); setLoadingPercent(0); setLoadingStage('');
    };
  };

  // Lightweight re-fetch that stays inside the transcript view (doesn't reset the layout)
  const refetchWithLang = (newLang) => {
    const parsed = parseVideoUrl(videoUrl);
    if (!parsed) return;
    const { platform, id: videoId, url: videoCanonical } = parsed;
    setLangRefetching(true);
    setLangRefetchMsg('');
    setSearch(''); setSummary(''); setTimeline(null); setShowTopics(false); setFlashcards([]); setFlashcardsExhausted(false); setFlashcardsExhaustedReason(''); setExpandedCards(new Set()); setStudyGuide(null); setSgMessages([]); setStudyGuideFull(false); setQaMessages([]);
    const apiUrl = platform === 'vimeo'
      ? `/api/transcript?platform=vimeo&url=${encodeURIComponent(videoCanonical)}&lang=${newLang}`
      : `/api/transcript?videoId=${videoId}&lang=${newLang}`;
    const es = new EventSource(apiUrl);
    const killTimer = setTimeout(() => { es.close(); setLangRefetching(false); setLangRefetchMsg(''); }, 120000);
    es.addEventListener('progress', (e) => {
      try { const { message } = JSON.parse(e.data); if (message) setLangRefetchMsg(message); } catch {}
    });
    es.addEventListener('done', async (e) => {
      clearTimeout(killTimer); es.close();
      try {
        const data = JSON.parse(e.data);
        const seen = new Set();
        const segs = (data.segments || []).filter(s => s.text && !seen.has(s.text) && seen.add(s.text));
        if (segs.length > 0) {
          setSegments(segs);
          setTranscript(data.transcript || segs.map(s => s.text).join(' '));
          setIsTranslated(data.translated || false);
          setSelectedSegment(null); setPlayingSegment(null); playingSegmentRef.current = null;
        }
      } catch {}
      setLangRefetching(false); setLangRefetchMsg('');
    });
    es.addEventListener('error', () => { clearTimeout(killTimer); es.close(); setLangRefetching(false); setLangRefetchMsg(''); });
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) return; clearTimeout(killTimer); es.close(); setLangRefetching(false); setLangRefetchMsg(''); };
  };

  const dlName = (ext) => {
    const safe = (currentTitle || 'transcript').replace(/[/\\?%*:|"<>]/g, '-').trim().slice(0, 80);
    return `ScribeSnap.ai - ${safe}.${ext}`;
  };

  const downloadTxt = () => {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([transcript], { type: 'text/plain' })),
      download: dlName('txt'),
    });
    a.click(); URL.revokeObjectURL(a.href); setShowDownloadMenu(false);
  };

  const downloadPdf = () => {
    const doc = new jsPDF(); const m = 15; doc.setFontSize(12);
    doc.text(doc.splitTextToSize(transcript, doc.internal.pageSize.getWidth() - m * 2), m, m);
    doc.save(dlName('pdf')); setShowDownloadMenu(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(transcript).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const copyAsMarkdown = () => {
    const tsLink = (s) => currentPlatform === 'vimeo'
      ? `https://vimeo.com/${currentVideoId}#t=${s.seconds}s`
      : `https://youtube.com/watch?v=${currentVideoId}&t=${s.seconds}s`;
    const md = segments.length > 0
      ? segments.map(s => `**[${formatTime(s.seconds)}](${tsLink(s)})** ${s.text}`).join('\n\n')
      : transcript;
    navigator.clipboard.writeText(md).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    setShowDownloadMenu(false);
  };

  const formatSrtTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  };

  const downloadSrt = () => {
    if (!segments.length) return;
    const srt = segments.map((seg, i) => {
      const start = formatSrtTime(seg.seconds);
      const end = formatSrtTime(segments[i + 1] ? segments[i + 1].seconds - 0.05 : seg.seconds + 5);
      return `${i + 1}\n${start} --> ${end}\n${seg.text.trim()}\n`;
    }).join('\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([srt], { type: 'text/srt' })),
      download: dlName('srt'),
    });
    a.click(); URL.revokeObjectURL(a.href);
  };

  const seekToTime = (seconds) => {
    if (currentPlatform !== 'vimeo' && ytPlayerRef.current?.seekTo) {
      ytPlayerRef.current.seekTo(seconds, true);
    } else {
      playerRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }),
        '*'
      );
    }
  };

  const summarize = async () => {
    setSummarizing(true); setSummary('');
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Server error ${res.status}`); }
      if (!res.ok) throw new Error(data.error || 'Failed to summarize');
      setSummary(data.summary);
      setActiveTab('summary');
    } catch (err) { setSummary(`Error: ${err.message}`); }
    finally { setSummarizing(false); }
  };

  const generateTimeline = async () => {
    if (timelineLoading) return;
    setTimelineLoading(true); setTimeline(null);
    try {
      const res = await fetch('/api/timeline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, segments }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Server error ${res.status}`); }
      if (!res.ok) throw new Error(data.error || 'Failed to generate timeline');
      setTimeline(data.sections || []);
    } catch (err) {
      setTimeline([{ title: 'Error', startSeconds: 0, summary: err.message, _error: true }]);
    } finally { setTimelineLoading(false); }
  };

  const generateFlashcards = async () => {
    if (flashcardsLoading) return;
    setFlashcardsLoading(true); setFlashcards([]); setFlashcardsExhausted(false); setFlashcardsExhaustedReason('');
    try {
      const res = await fetch('/api/flashcards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Server error ${res.status}`); }
      if (!res.ok) throw new Error(data.error || 'Failed to generate flashcards');
      if (data.noMore) {
        setFlashcardsExhausted(true);
        setFlashcardsExhaustedReason(data.reason || 'This content doesn\'t have educational concepts suitable for flashcards.');
        setActiveTab('flashcards');
        return;
      }
      const cards = (data.flashcards || []).filter(c => c && c.question && c.answer);
      setFlashcards(cards);
      setFlashcardIndex(0); setFlashcardFlipped(false); setFlashcardKnown(new Set()); setExpandedCards(new Set());
      if (cards.length > 0) { setActiveTab('flashcards'); pauseVideo(); setShowFlashcardModal(true); }
    } catch (err) { setFlashcards([]); }
    finally { setFlashcardsLoading(false); }
  };

  const generateMoreFlashcards = async () => {
    if (flashcardsMoreLoading || flashcardsExhausted) return;
    setFlashcardsMoreLoading(true);
    try {
      const existingQuestions = flashcards.map(c => c.question);
      const res = await fetch('/api/flashcards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, existingQuestions }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Server error ${res.status}`); }
      if (!res.ok) throw new Error(data.error || 'Failed to generate more flashcards');
      if (data.noMore) {
        setFlashcardsExhausted(true);
        setFlashcardsExhaustedReason(data.reason || 'All key concepts from this transcript are already covered.');
        return;
      }
      const existingQNorm = new Set(flashcards.map(c => c.question.trim().toLowerCase()));
      const newCards = (data.flashcards || [])
        .filter(c => c && c.question && c.answer)
        .filter(c => !existingQNorm.has(c.question.trim().toLowerCase()));
      if (newCards.length === 0) {
        setFlashcardsExhausted(true);
        setFlashcardsExhaustedReason('All key concepts from this transcript are already covered.');
        return;
      }
      setFlashcards(prev => [...prev, ...newCards]);
    } catch (err) { /* silent */ }
    finally { setFlashcardsMoreLoading(false); }
  };

  const generateStudyGuide = async () => {
    if (studyGuideLoading) return;
    setStudyGuideLoading(true); setStudyGuide(null);
    try {
      const res = await fetch('/api/study-guide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Server error ${res.status}`); }
      if (!res.ok) throw new Error(data.error || 'Failed to generate study guide');
      setStudyGuide(data);
      setActiveTab('study-guide');
    } catch (err) { setStudyGuide({ _error: err.message }); }
    finally { setStudyGuideLoading(false); }
  };

  const pauseVideo = () => {
    if (currentPlatform === 'vimeo') {
      playerRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'pause' }), '*');
    } else {
      ytPlayerRef.current?.pauseVideo?.();
    }
  };
  const resumeVideo = () => {
    if (currentPlatform === 'vimeo') {
      playerRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'play' }), '*');
    } else {
      ytPlayerRef.current?.playVideo?.();
    }
  };

  const openFlashcardModal = () => {
    pauseVideo();
    setFlashcardIndex(0); setFlashcardFlipped(false);
    setShowFlashcardModal(true);
  };
  const closeFlashcardModal = () => {
    setShowFlashcardModal(false);
  };

  const fcNext = () => {
    setFlashcardFlipped(false);
    setTimeout(() => setFlashcardIndex(i => Math.min(i + 1, flashcards.length - 1)), 150);
  };
  const fcPrev = () => {
    setFlashcardFlipped(false);
    setTimeout(() => setFlashcardIndex(i => Math.max(i - 1, 0)), 150);
  };
  const fcMarkKnown = (known) => {
    setFlashcardKnown(prev => {
      const next = new Set(prev);
      if (known) next.add(flashcardIndex); else next.delete(flashcardIndex);
      return next;
    });
    if (flashcardIndex < flashcards.length - 1) fcNext();
  };

  const askSgQuestion = async (overrideQ) => {
    const q = (overrideQ || sgQuestion).trim();
    if (!q || sgLoading) return;
    setSgMessages(prev => [...prev, { role: 'user', text: q }]);
    setSgQuestion('');
    setSgLoading(true);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setSgMessages(prev => [...prev, { role: 'ai', text: data.answer }]);
    } catch (err) {
      setSgMessages(prev => [...prev, { role: 'ai', text: `Error: ${err.message}`, isError: true }]);
    } finally { setSgLoading(false); }
  };

  const highlightText = (text) => {
    if (!search.trim()) return text;
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return text.split(regex).map((part, i) =>
      regex.test(part) ? <mark key={i} style={{ background: '#FEF08A', borderRadius: 2, padding: '0 1px' }}>{part}</mark> : part
    );
  };

  const wordCount    = transcript ? transcript.trim().split(/\s+/).length : 0;
  const charCount    = transcript ? transcript.length : 0;
  const readingMins  = wordCount > 0 ? Math.max(1, Math.round(wordCount / 200)) : 0;
  const matchCount   = search.trim() && transcript
    ? (transcript.match(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
    : 0;

  const onNavAskAI = () => {
    if (transcript) {
      setShowQA(true);
      setTimeout(() => { qaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); qaInputRef.current?.focus(); }, 100);
    } else {
      urlInputRef.current?.focus();
    }
  };

  // shared pill button style
  const pillBtn = (active) => ({
    display: 'flex', alignItems: 'center', gap: 5,
    width: '100%', justifyContent: 'center', marginTop: 8,
    background: active ? P.paper : P.surface,
    border: `1px solid ${P.border}`, borderRadius: 10, padding: '9px 14px',
    color: active ? P.ink : P.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    transition: 'all 0.15s',
  });

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes bounce { 0%,80%,100% { transform: scale(0.6); opacity:0.4; } 40% { transform: scale(1); opacity:1; } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
        @keyframes dot-flicker { 0%,80%,100% { opacity:0.2; transform:scale(0.8); } 40% { opacity:1; transform:scale(1); } }
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        @keyframes logoFlipOut { 0% { transform: perspective(300px) rotateX(0deg); opacity:1; } 100% { transform: perspective(300px) rotateX(-80deg); opacity:0; } }
        @keyframes logoFlipIn  { 0% { transform: perspective(300px) rotateX(80deg);  opacity:0; } 100% { transform: perspective(300px) rotateX(0deg);   opacity:1; } }
        .fade-up { animation: fadeUp 0.3s ease forwards; }
        .marquee-track { animation: marquee 28s linear infinite; }
        .marquee-track:hover { animation-play-state: paused; }
        * { box-sizing: border-box; }
        body { margin: 0; background: ${P.paper}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: ${P.paper}; }
        ::-webkit-scrollbar-thumb { background: ${P.border}; border-radius: 3px; }
        input, select, textarea { font-family: inherit; }
        .hero-grad {
          background: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(45,108,223,0.12) 0%, transparent 70%),
                      ${P.paper};
        }
        .feature-card { transition: box-shadow 0.2s, transform 0.2s; }
        .feature-card:hover { box-shadow: 0 8px 32px rgba(28,25,23,0.1); transform: translateY(-2px); }
        .chip-btn { transition: all 0.15s; }
        .chip-btn:hover { border-color: ${P.accent} !important; color: ${P.accent} !important; background: rgba(45,108,223,0.06) !important; }
        @keyframes slideDown { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        .bookmark-banner { animation: slideDown 0.3s ease forwards; }
      `}</style>

      <Navbar
        onAskAI={onNavAskAI}
        hasTranscript={!!transcript}
        credits={credits}
        user={user}
        onSignIn={(tab = 'signin') => { setAuthInitialTab(tab); setShowAuthModal(true); }}
        onSignOut={handleSignOut}
        onDashboard={() => setView('dashboard')}
        onHome={goHome}
        onShowReferralPromo={() => setShowReferralPromo(true)}
      />

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onAuthSuccess={(u) => setUser(u)}
          initialTab={authInitialTab}
        />
      )}

      {showPasswordReset && (
        <PasswordResetModal onClose={() => setShowPasswordReset(false)} />
      )}

      {showReferralBanner && !user && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 200, width: 'calc(100% - 32px)', maxWidth: 420,
          background: '#fff', borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
          border: '1px solid rgba(45,108,223,0.15)',
          overflow: 'hidden', animation: 'fadeUp 0.35s ease',
        }}>
          <div style={{ height: 4, background: 'linear-gradient(90deg, #2D6CDF, #5B9FFF)' }} />
          <div style={{ padding: '16px 18px 18px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{
              flexShrink: 0, width: 40, height: 40, borderRadius: 12,
              background: 'rgba(45,108,223,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2D6CDF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 12 20 22 4 22 4 12"/>
                <rect x="2" y="7" width="20" height="5"/>
                <line x1="12" y1="22" x2="12" y2="7"/>
                <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
                <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: '0 0 3px', fontWeight: 700, fontSize: 15, color: '#1a1a2e' }}>
                You've been invited!
              </p>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b7280', lineHeight: 1.45 }}>
                Sign up now and <strong style={{ color: '#2D6CDF' }}>both you and your friend get +3 free credits</strong> automatically.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { setShowReferralBanner(false); setAuthInitialTab('signup'); setShowAuthModal(true); }}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 10, border: 'none',
                    background: '#2D6CDF', color: '#fff', fontWeight: 600, fontSize: 13,
                    cursor: 'pointer', transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#2459B8'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#2D6CDF'; }}
                >
                  Sign up free →
                </button>
                <button
                  onClick={() => { setShowReferralBanner(false); setAuthInitialTab('signin'); setShowAuthModal(true); }}
                  style={{
                    padding: '9px 14px', borderRadius: 10,
                    border: '1px solid rgba(45,108,223,0.25)', background: 'none',
                    color: '#2D6CDF', fontWeight: 600, fontSize: 13,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(45,108,223,0.07)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                >
                  Sign in
                </button>
              </div>
            </div>
            <button
              onClick={() => setShowReferralBanner(false)}
              style={{
                flexShrink: 0, width: 24, height: 24, borderRadius: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#9ca3af', fontSize: 18, lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#374151'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; }}
              aria-label="Dismiss"
            >×</button>
          </div>
        </div>
      )}

      {showReferralPromo && user && (
        <ReferralPromoModal user={user} onClose={() => setShowReferralPromo(false)} />
      )}

      {showBookmarkBanner && (
        <div className="bookmark-banner" style={{
          position: 'fixed', top: 56, left: 0, right: 0, zIndex: 90,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          padding: '9px 16px',
          background: P.ink, color: 'rgba(255,255,255,0.92)',
          fontSize: 13,
        }}>
          <span style={{ fontSize: 15 }}>🚀</span>
          <span>
            Like this tool? Press{' '}
            <kbd style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '1px 6px', borderRadius: 5,
              background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
              fontSize: 12, fontFamily: 'inherit', fontWeight: 600, letterSpacing: '0.01em',
            }}>
              {/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ D' : 'Ctrl D'}
            </kbd>
            {' '}to bookmark us and always have quick access to your transcripts!
          </span>
          <button
            onClick={dismissBookmarkBanner}
            style={{
              marginLeft: 8, flexShrink: 0,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', fontSize: 18, lineHeight: 1, padding: '0 2px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'white'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
            aria-label="Dismiss"
          >×</button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* DASHBOARD VIEW */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {view === 'dashboard' && user && (
        <Dashboard
          user={user}
          credits={credits}
          history={history}
          setHistory={setHistory}
          lang={lang}
          setLang={setLang}
          onBack={() => setView('app')}
          onSignOut={handleSignOut}
          onLoadTranscript={loadFromHistory}
        />
      )}

      <div style={{ minHeight: '100vh', paddingTop: showBookmarkBanner ? 97 : 56, background: P.paper, transition: 'padding-top 0.3s ease', display: view === 'dashboard' ? 'none' : 'block' }}>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* LANDING VIEW */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {!transcript && (
          <div style={{ animation: 'fadeUp 0.4s ease', paddingBottom: 64 }}>

            {/* Hero */}
            <div className="hero-grad" style={{
              paddingBottom: 56,
            }}>
            <div style={{
              maxWidth: 700, margin: '0 auto', padding: '72px 24px 40px',
              textAlign: 'center',
            }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', borderRadius: 999, marginBottom: 28,
                background: 'rgba(45,108,223,0.08)', border: `1px solid rgba(45,108,223,0.18)`,
                fontSize: 12, fontWeight: 600, color: P.accent,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: P.accent, display: 'inline-block', animation: 'pulse 2s ease-in-out infinite' }} />
                YouTube &amp; Vimeo · Free · No account required
              </div>

              <h1 style={{
                fontSize: 'clamp(38px, 6.5vw, 62px)', fontWeight: 800, color: P.ink,
                letterSpacing: '-0.045em', lineHeight: 1.06, margin: '0 0 22px',
              }}>
                Watch less.<br />
                <span style={{ color: P.accent }}>Know more.</span>
              </h1>
              <p style={{ fontSize: 16, color: P.muted, margin: '0 0 40px', lineHeight: 1.7, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
                Extract full transcripts from YouTube &amp; Vimeo, then summarize with AI, generate flashcards, ask questions, and build study guides — in seconds.
              </p>

              {/* Input card */}
              <div style={{
                background: P.surface, border: `1px solid ${P.border}`,
                borderRadius: 20, boxShadow: '0 12px 56px rgba(28,25,23,0.13)',
                padding: 10,
              }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', background: P.paper, borderRadius: 14, border: `1px solid ${P.border}` }}>
                    {(() => {
                      const platform = parseVideoUrl(videoUrl)?.platform;
                      if (platform === 'youtube') return <YouTubeIcon />;
                      if (platform === 'vimeo') return <VimeoIcon />;
                      // Flip-clock animation between logos
                      const flipStyle = {
                        display: 'inline-flex', flexShrink: 0,
                        animation: logoFlip === 'out'
                          ? 'logoFlipOut 0.22s ease-in forwards'
                          : logoFlip === 'in'
                          ? 'logoFlipIn 0.22s ease-out forwards'
                          : 'none',
                      };
                      return (
                        <span style={flipStyle}>
                          {activeLogo === 'youtube' ? <YouTubeIcon /> : <VimeoIcon />}
                        </span>
                      );
                    })()}
                    <input
                      ref={urlInputRef}
                      type="text"
                      value={videoUrl}
                      onChange={e => setVideoUrl(e.target.value)}
                      onFocus={handleInputFocus}
                      onKeyDown={e => e.key === 'Enter' && !loading && getTranscript()}
                      placeholder="Paste a YouTube or Vimeo URL…"
                      style={{
                        flex: 1, border: 'none', background: 'transparent', outline: 'none',
                        fontSize: 17, color: P.ink,
                      }}
                    />
                  </div>
                  <button
                    onClick={getTranscript}
                    disabled={loading}
                    style={{
                      flexShrink: 0, padding: '0 28px', borderRadius: 14, border: 'none',
                      background: loading ? `rgba(45,108,223,0.5)` : P.accent,
                      color: 'white', fontSize: 16, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 9, whiteSpace: 'nowrap',
                      transition: 'background 0.15s',
                      minWidth: 148,
                    }}
                    onMouseEnter={e => { if (!loading) e.currentTarget.style.background = P.accentHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = loading ? `rgba(45,108,223,0.5)` : P.accent; }}
                  >
                    {loading ? <SpinnerIcon /> : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    )}
                    {loading ? 'Extracting…' : 'Extract'}
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              {loading && (
                <div className="fade-up" style={{ marginTop: 18 }}>
                  {/* Stage pills */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {['subtitles', 'audio', 'whisper'].map((s) => {
                        const labels = { subtitles: 'Captions', audio: 'Audio', whisper: 'AI' };
                        const order = ['subtitles', 'audio', 'whisper'];
                        const isDone = loadingStage && order.indexOf(s) < order.indexOf(loadingStage);
                        const isActive = s === loadingStage;
                        return (
                          <span key={s} style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                            background: isDone ? 'rgba(15,118,110,0.1)' : isActive ? P.accentLight : 'transparent',
                            color: isDone ? P.success : isActive ? P.accent : P.muted,
                            border: `1px solid ${isDone ? 'rgba(15,118,110,0.25)' : isActive ? 'rgba(45,108,223,0.25)' : P.border}`,
                            transition: 'all 0.3s',
                          }}>{isDone ? '✓ ' : isActive ? '· ' : ''}{labels[s]}</span>
                        );
                      })}
                    </div>
                    {loadingPercent > 0 && (
                      <span style={{ fontSize: 11, color: P.accent, fontWeight: 700 }}>{loadingPercent}%</span>
                    )}
                  </div>

                  {/* Progress bar — shimmer when 0%, real fill when > 0% */}
                  <div style={{ height: 4, borderRadius: 999, background: P.border, overflow: 'hidden', position: 'relative' }}>
                    {loadingPercent > 0 ? (
                      <div style={{ height: '100%', width: `${loadingPercent}%`, background: `linear-gradient(90deg, ${P.accent}, #5B9BD5)`, borderRadius: 999, transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, transparent, rgba(45,108,223,0.35), transparent)`, animation: 'shimmer 1.4s infinite' }} />
                    )}
                  </div>

                  {/* Status message with animated dots */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
                    <span style={{ fontSize: 12, color: P.muted }}>
                      {loadingMsg || 'Fetching transcript'}
                    </span>
                    <span style={{ display: 'flex', gap: 3 }}>
                      {[0, 1, 2].map(i => (
                        <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: P.accent, display: 'inline-block', animation: `dot-flicker 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                      ))}
                    </span>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="fade-up" style={{
                  marginTop: 14, padding: '11px 14px', textAlign: 'left',
                  background: 'rgba(180,35,24,0.06)', border: `1px solid rgba(180,35,24,0.2)`,
                  borderRadius: 10, fontSize: 13, color: P.error,
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <svg style={{ flexShrink: 0, marginTop: 1 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span style={{ flex: 1 }}>{error}</span>
                  <button onClick={getTranscript} style={{ flexShrink: 0, border: `1px solid rgba(180,35,24,0.25)`, background: 'white', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: P.error, cursor: 'pointer' }}>Retry</button>
                </div>
              )}

              {/* Social proof pills */}
              <div style={{ marginTop: 22, display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', alignItems: 'center' }}>
                {[
                  { icon: '⚡', text: 'Instant extraction' },
                  { icon: '🤖', text: 'AI-powered insights' },
                  { icon: '🔒', text: 'No account needed' },
                  { icon: '🏢', text: 'Trusted by SV teams' },
                ].map(p => (
                  <span key={p.text} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 12px', borderRadius: 999,
                    background: P.surface, border: `1px solid ${P.border}`,
                    fontSize: 12, fontWeight: 500, color: P.muted,
                  }}>
                    <span>{p.icon}</span>{p.text}
                  </span>
                ))}
              </div>
            </div>
            </div>{/* end hero-grad */}

            {/* Capability cards */}
            <div style={{ maxWidth: 820, margin: '0 auto', padding: '8px 24px 40px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
              {[
                {
                  emoji: '⚡',
                  label: 'Instant Transcript',
                  desc: 'Full text + timestamps from YouTube & Vimeo in seconds. Auto-translated to English when needed.',
                  accent: P.accent,
                  bg: 'rgba(45,108,223,0.06)',
                  border: 'rgba(45,108,223,0.14)',
                },
                {
                  emoji: '✨',
                  label: 'AI Insights',
                  desc: 'Summaries, chapter breakdowns, flashcards & study guides — generated on demand.',
                  accent: '#7C3AED',
                  bg: 'rgba(124,58,237,0.06)',
                  border: 'rgba(124,58,237,0.14)',
                },
                {
                  emoji: '💬',
                  label: 'Chat With Any Video',
                  desc: 'Ask questions, pull quotes, and get precise AI answers backed by the transcript.',
                  accent: P.success,
                  bg: 'rgba(15,118,110,0.06)',
                  border: 'rgba(15,118,110,0.14)',
                },
              ].map(card => (
                <div key={card.label} className="feature-card" style={{
                  background: card.bg, border: `1px solid ${card.border}`, borderRadius: 18,
                  padding: '26px 22px',
                }}>
                  <div style={{ fontSize: 30, marginBottom: 14, lineHeight: 1 }}>{card.emoji}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: P.ink, marginBottom: 8, letterSpacing: '-0.02em' }}>
                    {card.label}
                  </div>
                  <div style={{ fontSize: 13.5, color: P.muted, lineHeight: 1.65 }}>{card.desc}</div>
                </div>
              ))}
            </div>


            {/* Recent transcripts */}
            {history.length > 0 && (
              <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px 48px' }}>
                <div style={{ background: P.surface, border: `1px solid ${P.border}`, borderRadius: 16, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${P.border}` }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: P.ink }}>Recent transcripts</span>
                    <button
                      onClick={() => {
                        setHistory([]);
                        localStorage.removeItem('yte_history');
                      }}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: P.muted, fontWeight: 500 }}
                    >
                      Clear all
                    </button>
                  </div>
                  {history.map((h, i) => {
                    const wc = h.transcript ? h.transcript.trim().split(/\s+/).length : 0;
                    const displayTitle = h.title || h.id;
                    const displayChannel = h.channel || (h.platform === 'vimeo' ? 'Vimeo' : 'YouTube');
                    return (
                    <div key={h.id}>
                      {i > 0 && <div style={{ height: 1, background: P.border }} />}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = P.paper}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <img src={h.thumbnail} alt="" style={{ width: 72, height: 40, objectFit: 'cover', borderRadius: 7, border: `1px solid ${P.border}`, display: 'block' }}
                            onError={e => { e.target.style.display = 'none'; }} />
                          <div style={{ position: 'absolute', bottom: 3, right: 3, background: 'rgba(28,25,23,0.75)', color: 'white', fontSize: 9, fontWeight: 700, fontFamily: 'monospace', padding: '1px 3px', borderRadius: 3 }}>
                            {h.platform === 'vimeo' ? 'VIM' : h.source === 'whisper' ? 'AI' : 'YT'}
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: P.ink, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {displayTitle}
                          </div>
                          <div style={{ fontSize: 11, color: P.muted }}>
                            {displayChannel} · {wc.toLocaleString()} words · {timeAgo(h.date)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button
                            onClick={() => loadFromHistory(h)}
                            style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${P.border}`, background: P.surface, fontSize: 12, fontWeight: 600, color: P.ink, cursor: 'pointer', transition: 'all 0.1s' }}
                            onMouseEnter={e => { e.currentTarget.style.background = P.paper; }}
                            onMouseLeave={e => { e.currentTarget.style.background = P.surface; }}
                          >
                            View transcript
                          </button>
                          <button
                            onClick={(e) => deleteFromHistory(h.id, e)}
                            style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${P.border}`, background: P.surface, fontSize: 12, fontWeight: 600, color: P.muted, cursor: 'pointer', transition: 'all 0.1s' }}
                            onMouseEnter={e => { e.currentTarget.style.color = P.error; e.currentTarget.style.borderColor = 'rgba(180,35,24,0.3)'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = P.muted; e.currentTarget.style.borderColor = P.border; }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )})}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TRANSCRIPT VIEW — app shell 3-column layout                     */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {transcript && (
          <div className="fade-up" style={{
            display: 'grid',
            gridTemplateColumns: '280px 1fr 360px',
            gridTemplateRows: 'auto 1fr',
            height: 'calc(100vh - 56px)',
            overflow: 'hidden',
          }}>

            {/* ── LEFT SIDEBAR — col 1, spans both rows ────────────────────────── */}
            <div style={{
              gridColumn: 1, gridRow: '1 / 3',
              display: 'flex', flexDirection: 'column',
              background: P.paper, borderRight: `1px solid ${P.border}`,
              minHeight: 0,
            }}>
              {/* Export header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 16px 14px' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: P.ink }}>Export</span>
              </div>

              {/* Export format list */}
              <div style={{ padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[
                  { label: 'Text', selected: true, fn: downloadTxt, icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
                  { label: 'PDF', selected: false, fn: downloadPdf, icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10 11h4"/><path d="M10 15h4"/></svg> },
                  { label: 'SRT', selected: false, fn: downloadSrt, disabled: segments.length === 0, icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
                ].map(item => (
                  <button key={item.label} onClick={item.disabled ? undefined : item.fn} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10,
                    border: 'none', textAlign: 'left', width: '100%', cursor: item.disabled ? 'default' : 'pointer',
                    background: item.selected ? P.accentLight : 'transparent', transition: 'background 0.12s',
                    opacity: item.disabled ? 0.4 : 1,
                  }}
                    onMouseEnter={e => { if (!item.disabled && !item.selected) e.currentTarget.style.background = 'rgba(28,25,23,0.05)'; }}
                    onMouseLeave={e => { if (!item.selected) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ color: item.selected ? P.accent : P.muted, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: item.selected ? 600 : 500, color: item.selected ? P.accent : P.ink }}>{item.label}</span>
                  </button>
                ))}
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: P.border, margin: '0 16px' }} />

              {/* History header */}
              {history.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 8px' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: P.ink }}>History</span>
                  <button onClick={() => {}} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, padding: 4, display: 'flex', alignItems: 'center', borderRadius: 6, transition: 'background 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = P.border; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                  </button>
                </div>
              )}

              {/* History list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {history.map((entry) => {
                  const hTitle = entry.title || entry.id;
                  const hChannel = entry.channel || (entry.platform === 'vimeo' ? 'Vimeo' : 'YouTube');
                  const isActive = entry.id === currentVideoId;
                  return (
                    <button key={entry.id} onClick={() => loadFromHistory(entry)} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 11, padding: '10px 12px',
                      borderRadius: 12, border: `1px solid ${isActive ? 'rgba(45,108,223,0.2)' : 'transparent'}`,
                      background: isActive ? P.accentLight : 'transparent',
                      cursor: 'pointer', transition: 'background 0.1s', textAlign: 'left', width: '100%',
                    }}
                      onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(28,25,23,0.05)'; e.currentTarget.style.borderColor = P.border; } }}
                      onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; } }}
                    >
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        {entry.thumbnail
                          ? <img src={entry.thumbnail} alt="" style={{ width: 96, height: 60, objectFit: 'cover', borderRadius: 8, display: 'block' }} onError={e => { e.target.style.display = 'none'; }} />
                          : <div style={{ width: 96, height: 60, borderRadius: 8, background: P.border, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><YouTubeIcon /></div>
                        }
                      </div>
                      <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: isActive ? P.accent : P.ink, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.4, marginBottom: 5 }}>{hTitle}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: P.muted, marginBottom: 2 }}>
                          {entry.platform === 'vimeo' ? <VimeoIcon size={9} /> : <YouTubeIcon />}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hChannel}</span>
                        </div>
                        <div style={{ fontSize: 10.5, color: P.muted }}>{timeAgo(entry.date)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Back button pinned at bottom */}
              <div style={{ padding: '10px 12px', borderTop: `1px solid ${P.border}` }}>
                <button onClick={resetAll} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%',
                  padding: '8px', border: `1px solid ${P.border}`, borderRadius: 9, background: 'transparent',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600, color: P.muted, transition: 'all 0.15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.color = P.ink; e.currentTarget.style.background = P.surface; }}
                  onMouseLeave={e => { e.currentTarget.style.color = P.muted; e.currentTarget.style.background = 'transparent'; }}
                >
                  <ChevronIcon dir="left" size={11} /> New search
                </button>
              </div>
            </div>

            {/* ── CENTER — col 2, rows 1-2 ─────────────────────────────────────── */}
            <div style={{ gridColumn: 2, gridRow: '1 / 3', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: P.paper, borderRight: `1px solid ${P.border}` }}>

              {/* Video player card */}
              {currentVideoId && (
                <div style={{ flexShrink: 0, borderRadius: 16, overflow: 'hidden', border: `1px solid ${P.border}`, background: P.paper }}>
                  {/* Centered 16:9 player — max 391×220, no black bars, paper sides */}
                  <div style={{ display: 'flex', justifyContent: 'center', background: P.paper }}>
                    <div style={{ width: 'min(100%, 411px)', flexShrink: 0, borderRadius: 0, overflow: 'hidden' }}>
                      {currentPlatform === 'vimeo' ? (
                        <iframe
                          ref={playerRef}
                          src={`https://player.vimeo.com/video/${currentVideoId}?api=1`}
                          style={{ width: '100%', aspectRatio: '16/9', border: 'none', display: 'block' }}
                          allow="autoplay; fullscreen; picture-in-picture"
                          allowFullScreen
                          title="Video player"
                        />
                      ) : (
                        <div ref={ytPlayerDivRef} style={{ width: '100%', aspectRatio: '16/9', display: 'block' }} />
                      )}
                    </div>
                  </div>
                  {/* Slim meta bar */}
                  <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 10, background: '#FFFFFF' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: P.ink, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {currentTitle || currentChannel || currentVideoId}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                        {currentChannel && <span style={{ fontSize: 11, color: P.muted }}>{currentChannel}</span>}
                        {segments.length > 0 && (
                          <>
                            {currentChannel && <span style={{ fontSize: 11, color: P.border }}>·</span>}
                            <span style={{ fontSize: 11, color: P.muted }}>{formatVideoDuration(segments[segments.length - 1].seconds)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={copyToClipboard} style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 20,
                        border: `1px solid ${P.border}`, background: 'transparent', cursor: 'pointer',
                        fontSize: 12, fontWeight: 600, color: P.muted, transition: 'all 0.15s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.background = P.accentLight; e.currentTarget.style.color = P.accent; e.currentTarget.style.borderColor = 'rgba(45,108,223,0.3)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = P.muted; e.currentTarget.style.borderColor = P.border; }}>
                        {copied ? <CheckIcon /> : <CopyIcon />} {copied ? 'Copied' : 'Copy'}
                      </button>
                      <button onClick={downloadTxt} style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 20,
                        border: `1px solid ${P.border}`, background: 'transparent', cursor: 'pointer',
                        fontSize: 12, fontWeight: 600, color: P.muted, transition: 'all 0.15s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.background = P.accentLight; e.currentTarget.style.color = P.accent; e.currentTarget.style.borderColor = 'rgba(45,108,223,0.3)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = P.muted; e.currentTarget.style.borderColor = P.border; }}>
                        <DownloadIcon size={12} /> Download
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Browser-style tab bar — between video and content */}
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', gap: 2, padding: '6px 10px 0', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                {[
                  { key: 'transcript', label: 'Transcript', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg> },
                  { key: 'editor', label: 'Editor', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> },
                  ...(flashcards.length > 0 || flashcardsExhausted ? [{ key: 'flashcards', label: 'Flashcards', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> }] : []),
                  ...(summary ? [{ key: 'summary', label: 'Summary', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> }] : []),
                  ...(studyGuide && !studyGuide._error ? [{ key: 'study-guide', label: 'Study Guide', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> }] : []),
                ].map(tab => {
                  const isActive = activeTab === tab.key;
                  return (
                    <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12,
                      fontWeight: isActive ? 600 : 500,
                      border: isActive ? `1px solid ${P.border}` : '1px solid transparent',
                      borderBottom: isActive ? '1px solid #FFFFFF' : '1px solid transparent',
                      borderRadius: '7px 7px 0 0', marginBottom: '-1px',
                      background: isActive ? '#FFFFFF' : 'transparent',
                      color: isActive ? P.ink : P.muted, cursor: 'pointer', transition: 'all 0.15s',
                      whiteSpace: 'nowrap',
                    }}
                      onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(28,25,23,0.05)'; e.currentTarget.style.color = P.ink; }}}
                      onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = P.muted; }}}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Transcript card */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#FFFFFF', borderRadius: '0 0 16px 16px', boxShadow: '0 2px 12px rgba(28,25,23,0.07)', border: `1px solid ${P.border}`, borderTop: 'none', overflow: 'hidden' }}>

                {/* Transcript tab content */}
                {activeTab === 'transcript' && (
                  <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Search bar */}
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: `1px solid ${P.border}`, background: '#FFFFFF' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search transcript…"
                        style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: P.ink }} />
                      {search && matchCount > 0 && <span style={{ fontSize: 11, color: P.muted }}>{matchCount} match{matchCount !== 1 ? 'es' : ''}</span>}
                      {search && <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>}
                      {segments.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderLeft: `1px solid ${P.border}`, paddingLeft: 10, flexShrink: 0 }}>
                          {/* Timestamps toggle */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 11, color: P.muted, whiteSpace: 'nowrap' }}>Timestamps</span>
                            <div onClick={() => setShowTimestamps(v => !v)} style={{ width: 28, height: 16, borderRadius: 8, background: showTimestamps ? P.accent : P.border, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                              <div style={{ position: 'absolute', top: 2, left: showTimestamps ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
                            </div>
                          </div>
                          {/* Topics toggle */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 11, color: P.muted, whiteSpace: 'nowrap' }}>Topics</span>
                            <div onClick={() => {
                              const next = !showTopics;
                              setShowTopics(next);
                              if (next && !timeline && !timelineLoading) generateTimeline();
                            }} style={{ width: 28, height: 16, borderRadius: 8, background: showTopics ? '#7C3AED' : P.border, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                              <div style={{ position: 'absolute', top: 2, left: showTopics ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
                            </div>
                          </div>
                          {/* Language pill */}
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px 3px 7px', borderRadius: 20, border: `1px solid ${P.border}`, background: P.paper, cursor: 'pointer', position: 'relative', transition: 'border-color 0.15s' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = P.accent; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = P.border; }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                            <span style={{ fontSize: 10.5, fontWeight: 600, color: P.ink, letterSpacing: '0.03em' }}>{(LANGUAGES.find(l => l.code === lang) || LANGUAGES[0]).label.split(' ')[0].toUpperCase().slice(0, 3)}</span>
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                            <select value={lang} onChange={e => { const v = e.target.value; setLang(v); saveLangPref(v); refetchWithLang(v); }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}>
                              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                            </select>
                          </label>
                        </div>
                      )}
                    </div>
                    {/* Translation notice — disabled (on ice) */}
                    {/* Transcript list — 2-column grid: timestamp | text */}
                    <div ref={transcriptListRef} style={{ flex: 1, overflowY: 'auto', background: '#FFFFFF', position: 'relative' }}>
                      {langRefetching && (
                        <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(246,243,238,0.7)', backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {[0,1,2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: P.accent, display: 'inline-block', animation: `dot-flicker 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
                          </div>
                          <span style={{ fontSize: 12, color: P.muted, fontWeight: 500 }}>{langRefetchMsg || `Loading in ${LANGUAGES.find(l => l.code === lang)?.label}…`}</span>
                        </div>
                      )}
                      {segments.length > 0 && showTimestamps ? (
                        (() => {
                          // Pre-compute which segment index starts each topic section
                          const sectionBreaks = (showTopics && timeline && !timeline[0]?._error)
                            ? timeline.map(sec => segments.findIndex(s => s.seconds >= sec.startSeconds)).filter(idx => idx >= 0)
                            : [];
                          return segments.map((seg, i) => {
                            const secIdx = sectionBreaks.indexOf(i);
                            const section = secIdx >= 0 ? timeline[secIdx] : null;
                            return (
                              <React.Fragment key={i}>
                                {section && (
                                  <div
                                    onClick={() => seekToTime(section.startSeconds)}
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px 7px 10px', background: 'rgba(124,58,237,0.06)', borderBottom: `1px solid rgba(124,58,237,0.15)`, borderTop: i > 0 ? `1px solid rgba(124,58,237,0.15)` : 'none', cursor: 'pointer' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(124,58,237,0.11)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(124,58,237,0.06)'}
                                  >
                                    <span style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: '#7C3AED', flexShrink: 0 }}>{formatTime(section.startSeconds)}</span>
                                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#5B21B6', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.title}</span>
                                    {timelineLoading && secIdx === 0 && <span style={{ fontSize: 10, color: '#7C3AED', opacity: 0.6 }}>loading…</span>}
                                  </div>
                                )}
                                <div
                                  ref={el => { segmentRefs.current[i] = el; }}
                                  onClick={() => { setSelectedSegment(selectedSegment === i ? null : i); seekToTime(seg.seconds); }}
                                  style={{
                                    display: 'grid', gridTemplateColumns: '54px 1fr',
                                    gap: 0, padding: '0',
                                    background: selectedSegment === i ? 'rgba(45,108,223,0.08)' : playingSegment === i ? 'rgba(91,155,213,0.13)' : (i % 2 === 0 ? '#FFFFFF' : 'rgba(246,243,238,0.5)'),
                                    cursor: 'pointer', transition: 'background 0.15s',
                                    borderLeft: playingSegment === i ? `3px solid ${P.accent}` : '3px solid transparent',
                                    borderBottom: `1px solid ${selectedSegment === i ? 'rgba(45,108,223,0.15)' : P.border}`,
                                  }}
                                  onMouseEnter={e => { if (selectedSegment !== i && playingSegment !== i) e.currentTarget.style.background = 'rgba(45,108,223,0.03)'; }}
                                  onMouseLeave={e => { if (selectedSegment !== i) e.currentTarget.style.background = playingSegment === i ? 'rgba(45,108,223,0.05)' : (i % 2 === 0 ? '#FFFFFF' : 'rgba(246,243,238,0.5)'); }}
                                >
                                  <button
                                    onClick={e => { e.stopPropagation(); seekToTime(seg.seconds); setSelectedSegment(i); }}
                                    style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10px 6px 10px 0', background: 'none', border: 'none', cursor: 'pointer', color: selectedSegment === i ? P.accent : playingSegment === i ? '#5B9BD5' : '#999', fontWeight: playingSegment === i ? 700 : 600, fontSize: 10.5, fontFamily: 'monospace', flexShrink: 0 }}>
                                    {formatTime(seg.seconds)}
                                  </button>
                                  <div style={{ padding: '10px 14px 10px 8px', fontSize: 13.5, lineHeight: 1.7, color: P.ink, fontWeight: playingSegment === i ? 600 : selectedSegment === i ? 500 : 400 }}>
                                    {highlightText(seg.text)}
                                  </div>
                                </div>
                              </React.Fragment>
                            );
                          });
                        })()
                      ) : (
                        <div style={{ padding: '20px', fontSize: 14, lineHeight: 1.85, color: P.ink }}>
                          {highlightText(transcript)}
                        </div>
                      )}
                    </div>
                    {/* Bottom info bar */}
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: P.paper, borderTop: `1px solid ${P.border}` }}>
                      <span style={{ fontSize: 11, color: P.muted }}>Word Count: <strong style={{ color: P.ink }}>{wordCount.toLocaleString()}</strong></span>
                      <span style={{ color: P.border }}>·</span>
                      <span style={{ fontSize: 11, color: P.muted }}>Character Count: <strong style={{ color: P.ink }}>{charCount.toLocaleString()}</strong></span>
                      <span style={{ color: P.border }}>·</span>
                      <span style={{ fontSize: 11, color: P.muted }}>~<strong style={{ color: P.ink }}>{readingMins}</strong> min read</span>
                    </div>
                  </div>
                )}

                {/* Editor tab */}
                {activeTab === 'editor' && (
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>
                    <textarea defaultValue={transcript} style={{
                      width: '100%', minHeight: 400, border: `1px solid ${P.border}`, borderRadius: 10,
                      padding: '16px', fontSize: 13.5, lineHeight: 1.85, color: P.ink, background: P.paper,
                      outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                      onFocus={e => { e.target.style.borderColor = P.accent; }}
                      onBlur={e => { e.target.style.borderColor = P.border; }}
                    />
                    <div style={{ marginTop: 8, fontSize: 11, color: P.muted }}>Edit the transcript above. Changes are local only.</div>
                  </div>
                )}

                {/* Flashcards tab */}
                {activeTab === 'flashcards' && (
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
                    {/* Top bar */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(245,158,11,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D97706' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                        </div>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: P.ink }}>Flashcards</div>
                          <div style={{ fontSize: 11.5, color: P.muted }}>{flashcardKnown.size} / {flashcards.length} known</div>
                        </div>
                      </div>
                      <button
                        onClick={() => { setFlashcardIndex(0); setFlashcardFlipped(false); setShowFlashcardModal(true); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8, border: 'none', background: P.accent, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = P.accentHover; }}
                        onMouseLeave={e => { e.currentTarget.style.background = P.accent; }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        Study in Modal
                      </button>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: 6, borderRadius: 3, background: P.border, marginBottom: 18, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 3, background: P.success, width: `${flashcards.length > 0 ? (flashcardKnown.size / flashcards.length) * 100 : 0}%`, transition: 'width 0.4s' }} />
                    </div>
                    {/* Card list */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {flashcards.map((card, i) => {
                        const isExpanded = expandedCards.has(i);
                        const isKnown = flashcardKnown.has(i);
                        return (
                          <div key={i} style={{ borderRadius: 10, border: `1px solid ${isKnown ? 'rgba(15,118,110,0.3)' : P.border}`, background: isKnown ? 'rgba(15,118,110,0.04)' : '#fff', overflow: 'hidden', transition: 'border-color 0.2s' }}>
                            {/* Card header row */}
                            <div
                              onClick={() => setExpandedCards(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; })}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', userSelect: 'none' }}
                            >
                              <div style={{ width: 24, height: 24, borderRadius: 6, background: isKnown ? 'rgba(15,118,110,0.12)' : P.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: isKnown ? P.success : P.muted }}>{i + 1}</span>
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12.5, fontWeight: 600, color: P.ink, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isExpanded ? 'normal' : 'nowrap' }}>{card.question}</div>
                                {card.topic && !isExpanded && (
                                  <div style={{ fontSize: 10.5, color: '#D97706', fontWeight: 600, marginTop: 2 }}>{card.topic}</div>
                                )}
                              </div>
                              {isKnown && (
                                <div style={{ fontSize: 10, fontWeight: 700, color: P.success, background: 'rgba(15,118,110,0.1)', padding: '2px 8px', borderRadius: 4, flexShrink: 0, letterSpacing: '0.04em' }}>KNOWN</div>
                              )}
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
                            </div>
                            {/* Expanded answer */}
                            {isExpanded && (
                              <div style={{ borderTop: `1px solid ${P.border}`, padding: '12px 14px', background: P.paper }}>
                                {card.topic && (
                                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#D97706', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.topic}</div>
                                )}
                                <div style={{ fontSize: 13, lineHeight: 1.65, color: P.ink }}>{card.answer}</div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                  <button
                                    onClick={e => { e.stopPropagation(); setFlashcardKnown(prev => { const next = new Set(prev); if (isKnown) next.delete(i); else next.add(i); return next; }); }}
                                    style={{ flex: 1, padding: '6px 0', borderRadius: 7, border: `1px solid ${isKnown ? 'rgba(15,118,110,0.4)' : P.border}`, background: isKnown ? 'rgba(15,118,110,0.08)' : 'none', color: isKnown ? P.success : P.muted, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                                  >{isKnown ? '✓ Known' : 'Mark as Known'}</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Generate More / exhausted */}
                    <div style={{ marginTop: 14 }}>
                      {flashcardsExhausted ? (
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.07)' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#D97706', marginBottom: 3 }}>No more flashcards available</div>
                            <div style={{ fontSize: 12, color: P.muted, lineHeight: 1.55 }}>{flashcardsExhaustedReason}</div>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={generateMoreFlashcards}
                          disabled={flashcardsMoreLoading}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', padding: '8px 0', borderRadius: 8, border: `1.5px dashed ${P.border}`, background: 'none', color: flashcardsMoreLoading ? P.muted : P.ink, fontSize: 12.5, fontWeight: 600, cursor: flashcardsMoreLoading ? 'default' : 'pointer', transition: 'all 0.15s', opacity: flashcardsMoreLoading ? 0.6 : 1 }}
                          onMouseEnter={e => { if (!flashcardsMoreLoading) { e.currentTarget.style.borderColor = P.accent; e.currentTarget.style.color = P.accent; } }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = P.border; e.currentTarget.style.color = flashcardsMoreLoading ? P.muted : P.ink; }}
                        >
                          {flashcardsMoreLoading ? (
                            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Generating more…</>
                          ) : (
                            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Generate More Flashcards</>
                          )}
                        </button>
                      )}
                    </div>
                    {/* Reset progress */}
                    {flashcardKnown.size > 0 && (
                      <button
                        onClick={() => setFlashcardKnown(new Set())}
                        style={{ marginTop: 10, display: 'block', width: '100%', padding: '8px 0', borderRadius: 8, border: `1px solid ${P.border}`, background: 'none', color: P.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.color = P.ink; e.currentTarget.style.borderColor = P.ink; }}
                        onMouseLeave={e => { e.currentTarget.style.color = P.muted; e.currentTarget.style.borderColor = P.border; }}
                      >Reset Progress</button>
                    )}
                  </div>
                )}

                {/* Summary tab */}
                {activeTab === 'summary' && (
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
                    {summarizing ? (
                      <div style={{ padding: '60px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: P.muted, fontSize: 13 }}>
                        <SpinnerIcon size={14} /> Summarizing…
                      </div>
                    ) : summary ? (
                      <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 34, height: 34, borderRadius: 10, background: P.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: P.accent }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            </div>
                            <div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: P.ink }}>Summary</div>
                              <div style={{ fontSize: 11.5, color: P.muted }}>AI-generated from transcript</div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => { navigator.clipboard.writeText(summary).then(() => { setSummaryCopied(true); setTimeout(() => setSummaryCopied(false), 2000); }); }}
                              style={{ display: 'flex', alignItems: 'center', gap: 4, border: `1px solid ${P.border}`, background: 'none', cursor: 'pointer', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, color: summaryCopied ? P.success : P.muted, transition: 'all 0.15s' }}>
                              {summaryCopied ? <CheckIcon /> : <CopyIcon />} {summaryCopied ? 'Copied!' : 'Copy'}
                            </button>
                            <button onClick={() => { setSummary(''); setActiveTab('transcript'); }}
                              style={{ border: `1px solid ${P.border}`, background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6, transition: 'all 0.15s' }}
                              onMouseEnter={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = P.muted; }}
                            >Clear</button>
                          </div>
                        </div>
                        <div style={{ padding: '18px 20px', background: '#fff', borderRadius: 12, border: `1px solid ${P.border}`, boxShadow: '0 1px 4px rgba(28,25,23,0.04)', fontSize: 14, lineHeight: 1.8, color: P.ink, whiteSpace: 'pre-wrap' }}>{summary}</div>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Study Guide tab */}
                {activeTab === 'study-guide' && (
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
                    {studyGuideLoading ? (
                      <div style={{ padding: '60px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: P.muted, fontSize: 13 }}>
                        <SpinnerIcon size={14} /> Generating study guide…
                      </div>
                    ) : studyGuide && !studyGuide._error ? (() => {
                      const sgBody = (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 700, margin: '0 auto' }}>
                          {/* Header */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(15,118,110,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: P.success }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                              </div>
                              <div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: P.ink }}>Study Guide</div>
                                <div style={{ fontSize: 11.5, color: P.muted }}>AI-generated from transcript</div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => setStudyGuideFull(true)}
                                title="Full screen"
                                style={{ border: `1px solid ${P.border}`, background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 5 }}
                                onMouseEnter={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = P.muted; }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                                Full Screen
                              </button>
                              <button onClick={() => { setStudyGuide(null); setSgMessages([]); setActiveTab('transcript'); }}
                                style={{ border: `1px solid ${P.border}`, background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6, transition: 'all 0.15s' }}
                                onMouseEnter={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = P.muted; }}
                              >Clear</button>
                            </div>
                          </div>

                          {/* Overview */}
                          <div style={{ padding: '16px 18px', background: '#fff', borderRadius: 12, border: `1px solid ${P.border}`, boxShadow: '0 1px 4px rgba(28,25,23,0.04)' }}>
                            <div style={{ fontSize: 10.5, fontWeight: 700, color: P.success, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>Overview</div>
                            <div style={{ fontSize: 14, lineHeight: 1.7, color: P.ink }}>{studyGuide.overview}</div>
                          </div>

                          {/* Learning Objectives */}
                          {studyGuide.objectives?.length > 0 && (
                            <div style={{ padding: '16px 18px', background: '#fff', borderRadius: 12, border: `1px solid ${P.border}`, boxShadow: '0 1px 4px rgba(28,25,23,0.04)' }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: P.success, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>Learning Objectives</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {studyGuide.objectives.map((obj, i) => (
                                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                                    <div style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(15,118,110,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                                      <span style={{ fontSize: 10, fontWeight: 700, color: P.success }}>{i + 1}</span>
                                    </div>
                                    <div style={{ fontSize: 13.5, lineHeight: 1.6, color: P.ink }}>{obj}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Key Concepts */}
                          {studyGuide.keyConcepts?.length > 0 && (
                            <div style={{ padding: '16px 18px', background: '#fff', borderRadius: 12, border: `1px solid ${P.border}`, boxShadow: '0 1px 4px rgba(28,25,23,0.04)' }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: P.success, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>Key Concepts</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {studyGuide.keyConcepts.map((kc, i) => (
                                  <div key={i} style={{ paddingBottom: i < studyGuide.keyConcepts.length - 1 ? 10 : 0, borderBottom: i < studyGuide.keyConcepts.length - 1 ? `1px solid ${P.border}` : 'none' }}>
                                    <span style={{ fontSize: 13.5, fontWeight: 700, color: P.success }}>{kc.term}</span>
                                    <span style={{ fontSize: 13.5, color: P.muted }}> — </span>
                                    <span style={{ fontSize: 13.5, color: P.ink, lineHeight: 1.6 }}>{kc.definition}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Sections */}
                          {studyGuide.sections?.length > 0 && (
                            <div style={{ padding: '16px 18px', background: '#fff', borderRadius: 12, border: `1px solid ${P.border}`, boxShadow: '0 1px 4px rgba(28,25,23,0.04)' }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: P.success, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>Sections</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                {studyGuide.sections.map((sec, i) => (
                                  <div key={i} style={{ paddingBottom: i < studyGuide.sections.length - 1 ? 16 : 0, borderBottom: i < studyGuide.sections.length - 1 ? `1px solid ${P.border}` : 'none' }}>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: P.ink, marginBottom: 6 }}>{sec.title}</div>
                                    <div style={{ fontSize: 13, lineHeight: 1.65, color: P.muted, marginBottom: sec.keyPoints?.length ? 10 : 0 }}>{sec.summary}</div>
                                    {sec.keyPoints?.length > 0 && (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                        {sec.keyPoints.map((pt, j) => (
                                          <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: P.success, flexShrink: 0, marginTop: 6 }} />
                                            <div style={{ fontSize: 13, lineHeight: 1.6, color: P.ink }}>{pt}</div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Review Questions */}
                          {studyGuide.reviewQuestions?.length > 0 && (
                            <div style={{ padding: '16px 18px', background: '#fff', borderRadius: 12, border: `1px solid ${P.border}`, boxShadow: '0 1px 4px rgba(28,25,23,0.04)' }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: P.success, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>Review Questions</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {studyGuide.reviewQuestions.map((q, i) => (
                                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', background: P.paper, borderRadius: 8 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: P.success, flexShrink: 0, marginTop: 1 }}>Q{i + 1}</span>
                                    <span style={{ fontSize: 13.5, lineHeight: 1.6, color: P.ink }}>{q}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Ask ScribeSnap AI */}
                          <div style={{ padding: '16px 18px', background: '#fff', borderRadius: 12, border: `1.5px solid rgba(45,108,223,0.18)`, boxShadow: '0 1px 4px rgba(28,25,23,0.04)', marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                              <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg, rgba(45,108,223,0.13) 0%, rgba(45,108,223,0.05) 100%)', border: '1.5px solid rgba(45,108,223,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <img src="/scribesnap_icon_wave.svg" alt="AI" style={{ width: 14, height: 14 }} />
                              </div>
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: P.accent }}>Ask ScribeSnap AI</span>
                              <span style={{ fontSize: 11.5, color: P.muted, marginLeft: 2 }}>— deeper questions about this video</span>
                              {sgMessages.length > 0 && (
                                <button onClick={() => setSgMessages([])} style={{ marginLeft: 'auto', border: `1px solid ${P.border}`, background: 'none', cursor: 'pointer', color: P.muted, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5 }}>Clear</button>
                              )}
                            </div>

                            {/* Chat messages */}
                            {sgMessages.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                                {sgMessages.map((msg, i) => (
                                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                                    {msg.role === 'ai' ? (
                                      <div style={{ maxWidth: '90%', padding: '9px 13px', borderRadius: '3px 12px 12px 12px', background: P.paper, border: `1px solid ${P.border}`, fontSize: 13, lineHeight: 1.65, color: msg.isError ? P.error : P.ink }}>
                                        {msg.text.split('\n').map((line, li, arr) => <React.Fragment key={li}>{line}{li < arr.length - 1 && <br />}</React.Fragment>)}
                                      </div>
                                    ) : (
                                      <div style={{ maxWidth: '86%', padding: '9px 13px', borderRadius: '12px 12px 3px 12px', background: P.accent, fontSize: 13, lineHeight: 1.6, color: 'white' }}>{msg.text}</div>
                                    )}
                                  </div>
                                ))}
                                {sgLoading && (
                                  <div style={{ display: 'flex', gap: 5, padding: '10px 13px', background: P.paper, border: `1px solid ${P.border}`, borderRadius: '3px 12px 12px 12px', width: 'fit-content' }}>
                                    {[0,1,2].map(d => <div key={d} style={{ width: 5, height: 5, borderRadius: '50%', background: P.accent, opacity: 0.6, animation: `bounce 1.2s ease-in-out ${d * 0.2}s infinite` }} />)}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Input */}
                            <div style={{ display: 'flex', alignItems: 'center', background: P.paper, border: `1.5px solid ${P.border}`, borderRadius: 12, padding: '6px 6px 6px 14px', transition: 'border-color 0.2s' }}
                              onFocus={() => {}} onBlur={() => {}}
                            >
                              <input
                                value={sgQuestion}
                                onChange={e => setSgQuestion(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && askSgQuestion()}
                                placeholder="Ask a question about this video…"
                                disabled={sgLoading}
                                style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: P.ink, padding: '3px 0' }}
                                onFocus={e => { e.currentTarget.parentElement.style.borderColor = P.accent; e.currentTarget.parentElement.style.boxShadow = '0 0 0 3px rgba(45,108,223,0.1)'; }}
                                onBlur={e => { e.currentTarget.parentElement.style.borderColor = P.border; e.currentTarget.parentElement.style.boxShadow = 'none'; }}
                              />
                              <button
                                onClick={() => askSgQuestion()}
                                disabled={!sgQuestion.trim() || sgLoading}
                                style={{ flexShrink: 0, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: sgQuestion.trim() && !sgLoading ? 'linear-gradient(135deg, #5ba4f5 0%, #2D6CDF 100%)' : 'rgba(28,25,23,0.05)', color: sgQuestion.trim() && !sgLoading ? 'white' : P.muted, cursor: sgQuestion.trim() && !sgLoading ? 'pointer' : 'default', transition: 'all 0.2s' }}
                              >
                                {sgLoading ? <SpinnerIcon size={12} /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                      return sgBody;
                    })() : null}
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT SIDEBAR — col 3, spans both rows ───────────────────────── */}
            <div style={{ gridColumn: 3, gridRow: '1 / 3', display: 'flex', flexDirection: 'column', overflowY: 'auto', background: '#FFFFFF' }}>

              {/* ScribeSnap AI Chat — TOP of sidebar, composer at top */}
              <div ref={qaRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 18px 11px', borderBottom: `1px solid ${P.border}` }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    background: 'linear-gradient(135deg, rgba(45,108,223,0.13) 0%, rgba(45,108,223,0.05) 100%)',
                    border: `1.5px solid rgba(45,108,223,0.2)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <img src="/scribesnap_icon_wave.svg" alt="ScribeSnap AI" style={{ width: 19, height: 19 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: P.ink, lineHeight: 1.25 }}>ScribeSnap AI</div>
                    <div style={{ fontSize: 10.5, color: P.muted, lineHeight: 1 }}>Ask anything about this video</div>
                  </div>
                  {qaMessages.length > 0 && (
                    <button onClick={() => setQaMessages([])} style={{
                      marginLeft: 'auto', border: `1px solid ${P.border}`, background: 'none',
                      cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600,
                      padding: '3px 9px', borderRadius: 6, transition: 'all 0.15s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; e.currentTarget.style.borderColor = P.ink; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = P.muted; e.currentTarget.style.borderColor = P.border; }}
                    >Clear</button>
                  )}
                </div>

                {/* Composer — at the TOP, below header */}
                <div style={{
                  padding: '12px 16px 11px',
                  borderBottom: `1px solid ${P.border}`,
                  background: 'linear-gradient(180deg, rgba(45,108,223,0.04) 0%, transparent 100%)',
                }}>
                  <div
                    data-composer="true"
                    style={{
                      display: 'flex', alignItems: 'center',
                      background: '#fff',
                      border: `1.5px solid ${P.border}`,
                      borderRadius: 14,
                      padding: '6px 6px 6px 16px',
                      transition: 'border-color 0.2s, box-shadow 0.2s',
                      boxShadow: '0 1px 4px rgba(28,25,23,0.06)',
                    }}
                    onClick={() => qaInputRef.current?.focus()}
                  >
                    <input
                      ref={qaInputRef}
                      value={qaQuestion}
                      onChange={e => setQaQuestion(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && askQuestion()}
                      placeholder={qaMessages.length === 0 ? 'Ask anything about this video…' : 'Ask a follow-up…'}
                      disabled={qaLoading}
                      style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 13.5, color: P.ink, padding: '4px 0' }}
                      onFocus={e => {
                        const w = e.currentTarget.closest('[data-composer]');
                        if (w) { w.style.borderColor = P.accent; w.style.boxShadow = '0 0 0 3px rgba(45,108,223,0.12)'; }
                      }}
                      onBlur={e => {
                        const w = e.currentTarget.closest('[data-composer]');
                        if (w) { w.style.borderColor = P.border; w.style.boxShadow = '0 1px 4px rgba(28,25,23,0.06)'; }
                      }}
                    />
                    <button
                      onClick={e => { e.stopPropagation(); askQuestion(); }}
                      disabled={!qaQuestion.trim() || qaLoading}
                      style={{
                        flexShrink: 0, width: 38, height: 38,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 10, border: 'none',
                        background: qaQuestion.trim() && !qaLoading
                          ? 'linear-gradient(135deg, #5ba4f5 0%, #2D6CDF 100%)'
                          : 'rgba(28,25,23,0.05)',
                        color: qaQuestion.trim() && !qaLoading ? 'white' : P.muted,
                        cursor: qaQuestion.trim() && !qaLoading ? 'pointer' : 'default',
                        transition: 'all 0.2s',
                        boxShadow: qaQuestion.trim() && !qaLoading ? '0 2px 8px rgba(45,108,223,0.3)' : 'none',
                      }}
                      onMouseEnter={e => {
                        if (qaQuestion.trim() && !qaLoading) {
                          e.currentTarget.style.background = 'linear-gradient(135deg, #6bbcff 0%, #2459B8 100%)';
                          e.currentTarget.style.boxShadow = '0 3px 12px rgba(45,108,223,0.4)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (qaQuestion.trim() && !qaLoading) {
                          e.currentTarget.style.background = 'linear-gradient(135deg, #5ba4f5 0%, #2D6CDF 100%)';
                          e.currentTarget.style.boxShadow = '0 2px 8px rgba(45,108,223,0.3)';
                        }
                      }}
                    >
                      {qaLoading
                        ? <SpinnerIcon size={13} />
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                      }
                    </button>
                  </div>
                  {qaQuestion.trim() && (
                    <div style={{ fontSize: 10.5, color: P.muted, marginTop: 5, textAlign: 'right', paddingRight: 2 }}>↵ to send</div>
                  )}
                </div>

                {/* Empty state — intentional, not a bug */}
                {qaMessages.length === 0 && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 18px 16px', background: 'linear-gradient(180deg, rgba(45,108,223,0.025) 0%, transparent 50%)' }}>
                    {/* Hero */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 20, paddingTop: 4 }}>
                      <div style={{
                        width: 54, height: 54, borderRadius: 17,
                        background: 'linear-gradient(135deg, rgba(45,108,223,0.14) 0%, rgba(45,108,223,0.05) 100%)',
                        border: '1.5px solid rgba(45,108,223,0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 4px 16px rgba(45,108,223,0.1)',
                      }}>
                        <img src="/scribesnap_icon_wave.svg" alt="" style={{ width: 32, height: 32 }} />
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: P.ink, marginBottom: 3 }}>Ask anything</div>
                        <div style={{ fontSize: 11.5, color: P.muted, lineHeight: 1.4 }}>Questions answered from the video transcript</div>
                      </div>
                    </div>
                    {/* Suggestions */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {DEMO_CHIPS.map(chip => (
                        <button key={chip} onClick={() => askQuestion(chip)} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 14px', borderRadius: 10, border: `1px solid ${P.border}`,
                          background: '#fff', fontSize: 12.5, color: P.ink,
                          cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left', width: '100%',
                          boxShadow: '0 1px 3px rgba(28,25,23,0.04)',
                        }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = P.accent; e.currentTarget.style.background = P.accentLight; e.currentTarget.style.color = P.accent; e.currentTarget.style.boxShadow = '0 2px 8px rgba(45,108,223,0.1)'; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = P.border; e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = P.ink; e.currentTarget.style.boxShadow = '0 1px 3px rgba(28,25,23,0.04)'; }}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.35 }}><polyline points="9 18 15 12 9 6"/></svg>
                          {chip}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Chat messages */}
                {qaMessages.length > 0 && (
                  <div ref={chatMessagesRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 18px 8px' }}>
                    {qaMessages.map((msg, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        {msg.role === 'ai' ? (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, maxWidth: '93%' }}>
                            <div style={{
                              width: 26, height: 26, borderRadius: 7, flexShrink: 0, marginTop: 1,
                              background: 'linear-gradient(135deg, rgba(45,108,223,0.13) 0%, rgba(45,108,223,0.05) 100%)',
                              border: `1.5px solid rgba(45,108,223,0.2)`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <img src="/scribesnap_icon_wave.svg" alt="AI" style={{ width: 15, height: 15 }} />
                            </div>
                            <div style={{
                              padding: '9px 13px',
                              borderRadius: '3px 12px 12px 12px',
                              background: msg.isError ? 'rgba(180,35,24,0.05)' : P.paper,
                              border: `1px solid ${msg.isError ? 'rgba(180,35,24,0.2)' : P.border}`,
                              fontSize: 13, lineHeight: 1.65,
                              color: msg.isError ? P.error : P.ink,
                            }}>
                              {msg.text.split('\n').map((line, li, arr) => (
                                <React.Fragment key={li}>{line}{li < arr.length - 1 && <br />}</React.Fragment>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div style={{
                            maxWidth: '86%', padding: '9px 13px',
                            borderRadius: '12px 12px 3px 12px',
                            background: P.accent, fontSize: 13, lineHeight: 1.6, color: 'white',
                          }}>{msg.text}</div>
                        )}
                      </div>
                    ))}
                    {qaLoading && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                          background: 'linear-gradient(135deg, rgba(45,108,223,0.13) 0%, rgba(45,108,223,0.05) 100%)',
                          border: `1.5px solid rgba(45,108,223,0.2)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <img src="/scribesnap_icon_wave.svg" alt="AI" style={{ width: 15, height: 15 }} />
                        </div>
                        <div style={{ padding: '11px 15px', borderRadius: '3px 12px 12px 12px', background: P.paper, border: `1px solid ${P.border}`, display: 'flex', gap: 4, alignItems: 'center' }}>
                          {[0, 1, 2].map(d => <div key={d} style={{ width: 5, height: 5, borderRadius: '50%', background: P.accent, opacity: 0.6, animation: `bounce 1.2s ease-in-out ${d * 0.2}s infinite` }} />)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </div>

              {/* Divider */}
              <div style={{ height: 1, background: P.border, margin: '0 18px' }} />

              {/* Insights card — below chat */}
              <div style={{ padding: '14px 18px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: P.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={P.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: P.ink }}>Insights</span>
                </div>

                {[
                  { title: 'AI Summaries', sub: 'Bullet point summaries', color: P.accent, bg: 'rgba(45,108,223,0.1)',
                    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
                    onClick: summary ? () => setActiveTab('summary') : summarize, active: !!summary, loading: summarizing },
                  { title: 'Flash Cards', sub: 'Q&A cards with flip mode', color: P.warning, bg: 'rgba(180,83,9,0.1)',
                    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
                    onClick: flashcards.length > 0 ? openFlashcardModal : generateFlashcards, active: flashcards.length > 0, loading: flashcardsLoading },
                  { title: 'Study Guide', sub: 'Objectives, concepts & review', color: P.success, bg: 'rgba(15,118,110,0.1)',
                    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
                    onClick: studyGuide && !studyGuide._error ? () => setActiveTab('study-guide') : generateStudyGuide, active: !!studyGuide && !studyGuide._error, loading: studyGuideLoading },
                ].map(item => (
                  <div key={item.title}
                    onClick={item.loading ? undefined : item.onClick}
                    style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '12px 10px', borderRadius: 11, cursor: 'pointer', transition: 'background 0.12s', marginBottom: 3 }}
                    onMouseEnter={e => { e.currentTarget.style.background = P.paper; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: item.active ? item.bg : (item.bg.replace('0.1', '0.07')), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: item.color, transition: 'background 0.15s' }}>
                      {item.loading ? <SpinnerIcon size={14} /> : item.icon}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: item.active ? item.color : P.ink }}>{item.title}</div>
                      <div style={{ fontSize: 11.5, color: P.muted, marginTop: 1 }}>{item.sub}</div>
                    </div>
                    {item.active
                      ? <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                      : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.4 }}><polyline points="9 18 15 12 9 6"/></svg>
                    }
                  </div>
                ))}

                {/* Flashcards re-open button (cards are in full-screen modal) */}
                {flashcards.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={openFlashcardModal}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '9px 14px', background: 'rgba(180,83,9,0.07)', border: `1px solid rgba(180,83,9,0.2)`, borderRadius: 10, cursor: 'pointer', color: P.warning, fontSize: 12.5, fontWeight: 600, transition: 'all 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(180,83,9,0.12)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(180,83,9,0.07)'; }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                      Study {flashcards.length} Flashcards
                      <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>{flashcardKnown.size}/{flashcards.length} known</span>
                    </button>
                  </div>
                )}

                {/* Study guide ready — show jump link */}
                {studyGuide && !studyGuide._error && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() => setActiveTab('study-guide')}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '9px 14px', background: 'rgba(15,118,110,0.07)', border: `1px solid rgba(15,118,110,0.2)`, borderRadius: 10, cursor: 'pointer', color: P.success, fontSize: 12.5, fontWeight: 600, transition: 'all 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(15,118,110,0.13)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(15,118,110,0.07)'; }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                      View Study Guide
                      <svg style={{ marginLeft: 'auto' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>
                )}
                {studyGuide?._error && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(180,35,24,0.05)', border: `1px solid rgba(180,35,24,0.2)`, borderRadius: 8, fontSize: 12, color: P.error }}>
                    Failed to generate study guide: {studyGuide._error}
                  </div>
                )}

              </div>

            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {view !== 'dashboard' && <footer style={{
        background: P.surface, borderTop: `1px solid ${P.border}`,
        padding: '40px 24px 32px',
        marginTop: 24,
      }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          {/* Top row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 32, marginBottom: 32 }}>
            {/* Brand */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                <img
                  src={FOOTER_LOGO_SRC}
                  alt={BRAND_NAME}
                  style={{ height: 44, width: 'auto', display: 'block' }}
                />
              </div>
              <p style={{ fontSize: 13, color: P.muted, lineHeight: 1.6, maxWidth: 260, margin: 0 }}>
                Extract transcripts from YouTube and Vimeo videos and ask AI questions — free, no account needed.
              </p>
            </div>

            {/* Links */}
            <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: P.ink, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>Product</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {[
                    { label: 'Extract Transcript', href: '#' },
                    { label: 'AI Summaries', href: '#' },
                    { label: 'Q&A', href: '#' },
                  ].map(l => (
                    <a key={l.label} href={l.href} style={{ fontSize: 13, color: P.muted, textDecoration: 'none', transition: 'color 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.color = P.ink; }}
                      onMouseLeave={e => { e.currentTarget.style.color = P.muted; }}
                    >{l.label}</a>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: P.ink, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>Connect</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {[
                    { label: 'GitHub', href: 'https://github.com/joelmoyal/YouTube-Transcript-Extractor' },
                    { label: 'joelmoyal.com', href: 'https://joelmoyal.com' },
                  ].map(l => (
                    <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 13, color: P.muted, textDecoration: 'none', transition: 'color 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.color = P.ink; }}
                      onMouseLeave={e => { e.currentTarget.style.color = P.muted; }}
                    >{l.label}</a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: P.border, marginBottom: 20 }} />

          {/* Bottom row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <span style={{ fontSize: 12, color: P.muted }}>
              © {new Date().getFullYear()} {BRAND_NAME} · Built by{' '}
              <a href="https://joelmoyal.com" target="_blank" rel="noopener noreferrer"
                style={{ color: P.ink, fontWeight: 600, textDecoration: 'none' }}
                onMouseEnter={e => { e.currentTarget.style.color = P.accent; }}
                onMouseLeave={e => { e.currentTarget.style.color = P.ink; }}
              >Joël Moyal</a>
              {' '}· <a href="/privacy" style={{ color: P.muted, textDecoration: 'none' }}
                onMouseEnter={e => { e.currentTarget.style.color = P.ink; }}
                onMouseLeave={e => { e.currentTarget.style.color = P.muted; }}
              >Privacy Policy</a>
            </span>
            <a href="https://github.com/joelmoyal/YouTube-Transcript-Extractor" target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: P.muted, textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.color = P.ink; }}
              onMouseLeave={e => { e.currentTarget.style.color = P.muted; }}
            >
              <GitHubIcon /> Open source on GitHub
            </a>
          </div>
        </div>
      </footer>}

      {/* ── Study Guide Fullscreen Overlay ──────────────────────────────── */}
      {studyGuideFull && studyGuide && !studyGuide._error && (
        <div style={{ position: 'fixed', inset: 0, background: '#FAFAF8', zIndex: 9998, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: `1px solid ${P.border}`, background: '#fff', flexShrink: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(15,118,110,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: P.success, flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: P.ink, lineHeight: 1.2 }}>Study Guide</div>
              <div style={{ fontSize: 11, color: P.muted, marginTop: 1 }}>{currentTitle || 'Full study guide'}</div>
            </div>
            <button
              onClick={() => setStudyGuideFull(false)}
              style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7,
                padding: '9px 18px', borderRadius: 10,
                border: `1px solid ${P.border}`, background: P.paper,
                cursor: 'pointer', color: P.muted, fontSize: 13, fontWeight: 600,
                transition: 'all 0.15s', flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(180,35,24,0.06)'; e.currentTarget.style.borderColor = 'rgba(180,35,24,0.28)'; e.currentTarget.style.color = P.error; }}
              onMouseLeave={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.borderColor = P.border; e.currentTarget.style.color = P.muted; }}
              title="Close (Esc)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              Close
              <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 500, marginLeft: 2 }}>Esc</span>
            </button>
          </div>
          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px 40px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 800, margin: '0 auto' }}>
              {studyGuide.overview && (
                <div style={{ padding: '18px 22px', background: '#fff', borderRadius: 14, border: `1px solid ${P.border}`, boxShadow: '0 1px 6px rgba(28,25,23,0.05)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: P.success, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>Overview</div>
                  <div style={{ fontSize: 15, lineHeight: 1.75, color: P.ink }}>{studyGuide.overview}</div>
                </div>
              )}
              {studyGuide.objectives?.length > 0 && (
                <div style={{ padding: '18px 22px', background: '#fff', borderRadius: 14, border: `1px solid ${P.border}`, boxShadow: '0 1px 6px rgba(28,25,23,0.05)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: P.success, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>Learning Objectives</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {studyGuide.objectives.map((obj, i) => (
                      <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                        <div style={{ width: 26, height: 26, borderRadius: 7, background: 'rgba(15,118,110,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: P.success }}>{i + 1}</span>
                        </div>
                        <div style={{ fontSize: 14.5, lineHeight: 1.65, color: P.ink }}>{obj}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {studyGuide.keyConcepts?.length > 0 && (
                <div style={{ padding: '18px 22px', background: '#fff', borderRadius: 14, border: `1px solid ${P.border}`, boxShadow: '0 1px 6px rgba(28,25,23,0.05)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: P.success, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>Key Concepts</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {studyGuide.keyConcepts.map((kc, i) => (
                      <div key={i} style={{ paddingBottom: i < studyGuide.keyConcepts.length - 1 ? 12 : 0, borderBottom: i < studyGuide.keyConcepts.length - 1 ? `1px solid ${P.border}` : 'none' }}>
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: P.success }}>{kc.term}</span>
                        <span style={{ fontSize: 14.5, color: P.muted }}> — </span>
                        <span style={{ fontSize: 14.5, color: P.ink, lineHeight: 1.65 }}>{kc.definition}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {studyGuide.sections?.length > 0 && (
                <div style={{ padding: '18px 22px', background: '#fff', borderRadius: 14, border: `1px solid ${P.border}`, boxShadow: '0 1px 6px rgba(28,25,23,0.05)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: P.success, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>Sections</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    {studyGuide.sections.map((sec, i) => (
                      <div key={i} style={{ paddingBottom: i < studyGuide.sections.length - 1 ? 18 : 0, borderBottom: i < studyGuide.sections.length - 1 ? `1px solid ${P.border}` : 'none' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: P.ink, marginBottom: 7 }}>{sec.title}</div>
                        <div style={{ fontSize: 13.5, lineHeight: 1.7, color: P.muted, marginBottom: sec.keyPoints?.length ? 12 : 0 }}>{sec.summary}</div>
                        {sec.keyPoints?.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                            {sec.keyPoints.map((pt, j) => (
                              <div key={j} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: P.success, flexShrink: 0, marginTop: 7 }} />
                                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: P.ink }}>{pt}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {studyGuide.reviewQuestions?.length > 0 && (
                <div style={{ padding: '18px 22px', background: '#fff', borderRadius: 14, border: `1px solid ${P.border}`, boxShadow: '0 1px 6px rgba(28,25,23,0.05)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: P.success, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>Review Questions</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {studyGuide.reviewQuestions.map((q, i) => (
                      <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 16px', background: P.paper, borderRadius: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: P.success, flexShrink: 0, marginTop: 1 }}>Q{i + 1}</span>
                        <span style={{ fontSize: 14.5, lineHeight: 1.65, color: P.ink }}>{q}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Ask ScribeSnap AI — fullscreen version */}
              <div style={{ padding: '18px 22px', background: '#fff', borderRadius: 14, border: `1.5px solid rgba(45,108,223,0.18)`, boxShadow: '0 1px 6px rgba(28,25,23,0.05)', marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, rgba(45,108,223,0.13) 0%, rgba(45,108,223,0.05) 100%)', border: '1.5px solid rgba(45,108,223,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/scribesnap_icon_wave.svg" alt="AI" style={{ width: 16, height: 16 }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: P.accent }}>Ask ScribeSnap AI</span>
                  <span style={{ fontSize: 12.5, color: P.muted }}>— deeper questions about this video</span>
                  {sgMessages.length > 0 && <button onClick={() => setSgMessages([])} style={{ marginLeft: 'auto', border: `1px solid ${P.border}`, background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6 }}>Clear</button>}
                </div>
                {sgMessages.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
                    {sgMessages.map((msg, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        {msg.role === 'ai'
                          ? <div style={{ maxWidth: '85%', padding: '10px 16px', borderRadius: '3px 14px 14px 14px', background: P.paper, border: `1px solid ${P.border}`, fontSize: 14, lineHeight: 1.7, color: msg.isError ? P.error : P.ink }}>{msg.text.split('\n').map((l, li, a) => <React.Fragment key={li}>{l}{li < a.length - 1 && <br />}</React.Fragment>)}</div>
                          : <div style={{ maxWidth: '80%', padding: '10px 16px', borderRadius: '14px 14px 3px 14px', background: P.accent, fontSize: 14, lineHeight: 1.65, color: 'white' }}>{msg.text}</div>
                        }
                      </div>
                    ))}
                    {sgLoading && <div style={{ display: 'flex', gap: 5, padding: '10px 14px', background: P.paper, border: `1px solid ${P.border}`, borderRadius: '3px 14px 14px 14px', width: 'fit-content' }}>{[0,1,2].map(d => <div key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: P.accent, opacity: 0.6, animation: `bounce 1.2s ease-in-out ${d * 0.2}s infinite` }} />)}</div>}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', background: P.paper, border: `1.5px solid ${P.border}`, borderRadius: 14, padding: '8px 8px 8px 18px' }}>
                  <input value={sgQuestion} onChange={e => setSgQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && askSgQuestion()} placeholder="Ask a question about this video…" disabled={sgLoading}
                    style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: P.ink, padding: '4px 0' }}
                    onFocus={e => { e.currentTarget.parentElement.style.borderColor = P.accent; e.currentTarget.parentElement.style.boxShadow = '0 0 0 3px rgba(45,108,223,0.1)'; }}
                    onBlur={e => { e.currentTarget.parentElement.style.borderColor = P.border; e.currentTarget.parentElement.style.boxShadow = 'none'; }}
                  />
                  <button onClick={() => askSgQuestion()} disabled={!sgQuestion.trim() || sgLoading}
                    style={{ flexShrink: 0, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: 'none', background: sgQuestion.trim() && !sgLoading ? 'linear-gradient(135deg, #5ba4f5 0%, #2D6CDF 100%)' : 'rgba(28,25,23,0.05)', color: sgQuestion.trim() && !sgLoading ? 'white' : P.muted, cursor: sgQuestion.trim() && !sgLoading ? 'pointer' : 'default', transition: 'all 0.2s' }}>
                    {sgLoading ? <SpinnerIcon size={13} /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Flashcard Modal ─────────────────────────────────────────────── */}
      {showFlashcardModal && flashcards.length > 0 && (() => {
        const card = flashcards[flashcardIndex];
        const isLast = flashcardIndex === flashcards.length - 1;
        const allReviewed = flashcardKnown.size + (flashcards.length - flashcardKnown.size) === flashcards.length && flashcardIndex === isLast;
        const progressPct = Math.round((flashcardKnown.size / flashcards.length) * 100);
        return (
          <div
            onClick={(e) => { if (e.target === e.currentTarget) closeFlashcardModal(); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.72)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          >
            {/* Header */}
            <div style={{ width: '100%', maxWidth: 560, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', align: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.01em' }}>
                  Flashcards
                </span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginLeft: 8 }}>
                  {flashcardIndex + 1} / {flashcards.length}
                </span>
              </div>
              <button
                onClick={closeFlashcardModal}
                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '5px 12px', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
              >✕ Close</button>
            </div>

            {/* Progress bar */}
            <div style={{ width: '100%', maxWidth: 560, marginBottom: 20 }}>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.12)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progressPct}%`, background: '#0F766E', borderRadius: 4, transition: 'width 0.4s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>{flashcardKnown.size} known</span>
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>{flashcards.length - flashcardKnown.size} to review</span>
              </div>
            </div>

            {/* Card */}
            <div
              style={{ width: '100%', maxWidth: 560, height: 280, perspective: '1200px', cursor: 'pointer', marginBottom: 20 }}
              onClick={() => setFlashcardFlipped(f => !f)}
            >
              <div style={{
                width: '100%', height: '100%', position: 'relative',
                transformStyle: 'preserve-3d',
                transform: flashcardFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
              }}>
                {/* Front — Question */}
                <div style={{
                  position: 'absolute', inset: 0,
                  backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                  background: P.surface, borderRadius: 18,
                  border: `1.5px solid ${P.border}`,
                  boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: '28px 32px', textAlign: 'center',
                }}>
                  {card.topic && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: P.warning, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14, padding: '3px 10px', background: 'rgba(180,83,9,0.08)', borderRadius: 20 }}>
                      {card.topic}
                    </div>
                  )}
                  <div style={{ fontSize: 18, fontWeight: 600, color: P.ink, lineHeight: 1.5, maxHeight: 160, overflow: 'auto' }}>{card.question}</div>
                  <div style={{ marginTop: 20, fontSize: 11, color: P.muted, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                    Tap to reveal answer · Space
                  </div>
                </div>
                {/* Back — Answer */}
                <div style={{
                  position: 'absolute', inset: 0,
                  backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                  background: 'linear-gradient(135deg, #0F766E 0%, #0d5e57 100%)', borderRadius: 18,
                  boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: '28px 32px', textAlign: 'center',
                }}>
                  {card.topic && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
                      {card.topic}
                    </div>
                  )}
                  <div style={{ fontSize: 16, fontWeight: 500, color: '#fff', lineHeight: 1.65, maxHeight: 180, overflow: 'auto' }}>{card.answer}</div>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            {flashcardFlipped ? (
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <button
                  onClick={() => fcMarkKnown(false)}
                  style={{ padding: '10px 22px', borderRadius: 12, border: '1.5px solid rgba(180,35,24,0.5)', background: 'rgba(180,35,24,0.12)', color: '#ff8f86', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(180,35,24,0.22)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(180,35,24,0.12)'; }}
                >✗ Still Learning</button>
                <button
                  onClick={() => fcMarkKnown(true)}
                  style={{ padding: '10px 22px', borderRadius: 12, border: '1.5px solid rgba(15,118,110,0.5)', background: 'rgba(15,118,110,0.18)', color: '#5ee8d2', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(15,118,110,0.28)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(15,118,110,0.18)'; }}
                >✓ I Know This</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <button
                  onClick={fcPrev}
                  disabled={flashcardIndex === 0}
                  style={{ padding: '9px 18px', borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: flashcardIndex === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600, cursor: flashcardIndex === 0 ? 'default' : 'pointer', transition: 'all 0.15s' }}
                >← Prev</button>
                <button
                  onClick={() => setFlashcardFlipped(true)}
                  style={{ padding: '9px 24px', borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                >Reveal Answer</button>
                <button
                  onClick={fcNext}
                  disabled={isLast}
                  style={{ padding: '9px 18px', borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: isLast ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600, cursor: isLast ? 'default' : 'pointer', transition: 'all 0.15s' }}
                >Next →</button>
              </div>
            )}

            {/* Generate More / exhausted */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              {flashcardsExhausted ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 16px', borderRadius: 12, border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.1)', maxWidth: 420 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#FBBF24', marginBottom: 3 }}>No more flashcards available</div>
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55 }}>{flashcardsExhaustedReason}</div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={generateMoreFlashcards}
                  disabled={flashcardsMoreLoading}
                  style={{ padding: '8px 20px', borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.18)', background: flashcardsMoreLoading ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)', color: flashcardsMoreLoading ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.6)', fontSize: 12.5, fontWeight: 600, cursor: flashcardsMoreLoading ? 'default' : 'pointer', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6 }}
                  onMouseEnter={e => { if (!flashcardsMoreLoading) e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; }}
                  onMouseLeave={e => { if (!flashcardsMoreLoading) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                >
                  {flashcardsMoreLoading ? (
                    <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Generating…</>
                  ) : (
                    <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Generate More</>
                  )}
                </button>
              )}
            </div>

            {/* Keyboard hint */}
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.02em' }}>
              Space to flip · ← → to navigate · Esc to close
            </div>
          </div>
        );
      })()}

      {/* ── Sticky bottom trust bar — only on landing page ── */}
      {!transcript && (() => {
        const TRUST_ITEMS = [
          { icon: '🏢', label: 'Silicon Valley startups' },
          { icon: '🎓', label: 'Researchers & academics' },
          { icon: '🚀', label: 'Startup founders' },
          { icon: '🎙️', label: 'Podcast creators' },
          { icon: '📚', label: 'Educators & students' },
          { icon: '🗞️', label: 'Journalists & writers' },
          { icon: '💼', label: 'Product managers' },
          { icon: '🌍', label: '120+ countries' },
        ];
        return (
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
            height: 48,
            background: 'rgba(250,250,248,0.88)',
            backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            borderTop: `1px solid ${P.border}`,
            display: 'flex', alignItems: 'center',
            overflow: 'hidden',
          }}>
            {/* Static label */}
            <div style={{
              padding: '0 20px', flexShrink: 0,
              fontSize: 10.5, fontWeight: 700, color: P.muted,
              letterSpacing: '0.09em', textTransform: 'uppercase',
              borderRight: `1px solid ${P.border}`,
              height: '100%', display: 'flex', alignItems: 'center',
              whiteSpace: 'nowrap',
            }}>
              Trusted by
            </div>
            {/* Marquee area */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
              {/* fade left */}
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 48, background: 'linear-gradient(to right, rgba(250,250,248,0.95), transparent)', zIndex: 2, pointerEvents: 'none' }} />
              {/* fade right */}
              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 80, background: 'linear-gradient(to left, rgba(250,250,248,0.95), transparent)', zIndex: 2, pointerEvents: 'none' }} />
              <div className="marquee-track" style={{ display: 'flex', alignItems: 'center', gap: 6, width: 'max-content' }}>
                {[...TRUST_ITEMS, ...TRUST_ITEMS].map((item, i) => (
                  <span key={i} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 13px', borderRadius: 999,
                    border: `1px solid rgba(28,25,23,0.1)`,
                    fontSize: 12, fontWeight: 500, color: P.ink,
                    whiteSpace: 'nowrap', flexShrink: 0,
                    background: 'rgba(255,255,255,0.7)',
                  }}>
                    <span style={{ fontSize: 13 }}>{item.icon}</span>
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
};

export default App;
