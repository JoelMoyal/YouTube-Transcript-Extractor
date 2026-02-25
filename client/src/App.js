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
const GlobeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
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

const CreditsWidget = ({ credits, onUpgrade }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
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
          width: 220, background: P.surface, border: `1px solid ${P.border}`,
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

      const { error: err } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: trimmedUser, username: trimmedUser.toLowerCase() } },
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
const Dashboard = ({ user, credits, history, onBack, onSignOut, onLoadTranscript, onChangePassword }) => {
  const [tab, setTab] = React.useState('overview');
  const [usageRange, setUsageRange] = React.useState('this');
  const [passwordResetState, setPasswordResetState] = React.useState({ type: 'idle', message: '' });

  const used = credits?.used ?? 0;
  const tierMax = credits?.tierMax || CREDITS_MAX;
  const resetAt = credits?.resetAt ?? (Date.now() + CREDITS_PERIOD_MS);
  const daysLeft = Math.max(0, Math.ceil((resetAt - Date.now()) / 86400000));
  const pct = Math.min(100, (used / tierMax) * 100);
  const remaining = Math.max(0, tierMax - used);
  const ytCount = history.filter(h => (h.platform || 'youtube') === 'youtube').length;
  const viCount = history.filter(h => h.platform === 'vimeo').length;
  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '—';
  const initial = (user.email || '?')[0].toUpperCase();
  const displayName = user.user_metadata?.username || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User';
  const latest = history[0] || null;

  const openTranscript = (entry) => {
    if (!entry) return;
    onLoadTranscript(entry);
    onBack();
  };

  const triggerPasswordReset = async () => {
    if (passwordResetState.type === 'loading') return;
    setPasswordResetState({ type: 'loading', message: `Sending reset link to ${user.email}...` });
    try {
      const result = await onChangePassword?.();
      if (result?.ok) {
        setPasswordResetState({
          type: 'success',
          message: `Reset link sent to ${user.email}. Check inbox/spam and open the link to set your new password.`,
        });
      } else {
        setPasswordResetState({
          type: 'error',
          message: result?.error || 'Could not send reset email right now. Please try again.',
        });
      }
    } catch (err) {
      setPasswordResetState({
        type: 'error',
        message: err?.message || 'Could not send reset email right now. Please try again.',
      });
    }
  };

  const statCards = [
    {
      key: 'credits',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
      ),
      value: `${used} / ${tierMax}`,
      label: 'Credits Used',
      sub: `Resets in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
      className: 'ds-stat-primary',
    },
    {
      key: 'total',
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="16" height="18" rx="2"/>
          <line x1="8" y1="8" x2="16" y2="8"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      ),
      value: history.length,
      label: 'Total Transcripts',
      sub: 'All time',
      className: 'ds-stat-neutral',
    },
    {
      key: 'yt',
      icon: <YouTubeIcon size={14} />,
      value: ytCount,
      label: 'YouTube Videos',
      sub: 'Connected',
      className: 'ds-stat-youtube',
    },
    {
      key: 'vimeo',
      icon: <VimeoIcon size={14} />,
      value: viCount,
      label: 'Vimeo Videos',
      sub: 'Connected',
      className: 'ds-stat-vimeo',
    },
  ];

  const weekSegments = Array.from({ length: 7 }, (_, i) => i);
  const activeDay = Math.min(6, Math.round((pct / 100) * 6));

  return (
    <div className="ds-shell">
      <style>{`
        .ds-shell {
          min-height: 100vh;
          padding-top: 56px;
          background: radial-gradient(70% 50% at 16% 14%, rgba(123,211,255,0.4) 0%, rgba(123,211,255,0.1) 30%, transparent 64%), #F6F2EA;
          position: relative;
          overflow: hidden;
        }
        .ds-shell::before {
          content: '';
          position: absolute;
          inset: 36px auto auto -220px;
          width: 760px;
          height: 760px;
          background:
            radial-gradient(circle at center, rgba(123,211,255,0.25) 0%, rgba(123,211,255,0.05) 54%, transparent 68%),
            conic-gradient(from 210deg, rgba(123,211,255,0) 0deg, rgba(60,140,255,0.14) 200deg, rgba(123,211,255,0) 360deg);
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
          background: radial-gradient(circle at center, rgba(60,140,255,0.16) 0%, rgba(60,140,255,0) 72%);
          pointer-events: none;
        }
        .ds-wrap {
          max-width: 1200px;
          margin: 0 auto;
          padding: 34px 24px 56px;
          position: relative;
          z-index: 1;
        }
        .ds-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: none;
          background: none;
          color: #5A5960;
          font-size: 15px;
          cursor: pointer;
          padding: 2px 0;
          margin-bottom: 10px;
          transition: color 0.15s ease;
        }
        .ds-back:hover { color: #1D1D1F; }
        .ds-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.85fr) minmax(318px, 1fr);
          gap: 18px;
          align-items: start;
        }
        .ds-card {
          background: rgba(251,247,240,0.72);
          border: 1px solid rgba(229,221,207,0.9);
          border-radius: 18px;
          box-shadow: 0 12px 34px rgba(31,53,95,0.08);
          backdrop-filter: blur(4px);
        }
        .ds-profile {
          display: flex;
          align-items: center;
          gap: 20px;
          padding: 24px 28px;
          margin-bottom: 14px;
        }
        .ds-avatar {
          width: 100px;
          height: 100px;
          border-radius: 50%;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 46px;
          font-weight: 700;
          color: #EAF2FF;
          background: linear-gradient(145deg, #7BD3FF 0%, #3C8CFF 52%, #1F6BFF 100%);
          box-shadow: 0 12px 26px rgba(60,140,255,0.3);
        }
        .ds-profile-name {
          font-size: clamp(28px, 3.2vw, 42px);
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #1D1D1F;
          margin: 0 0 2px;
        }
        .ds-profile-email {
          font-size: 17px;
          color: #5A5960;
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
          margin: 0 0 4px;
          font-size: 12px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #6E6A76;
          font-weight: 600;
        }
        .ds-profile-meta-value {
          margin: 0;
          font-size: 18px;
          color: #1D1D1F;
          font-weight: 700;
        }
        .ds-control-row {
          display: grid;
          grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.3fr);
          gap: 12px;
          margin-bottom: 14px;
        }
        .ds-extract-btn {
          height: 58px;
          border-radius: 15px;
          border: 1px solid rgba(60,140,255,0.35);
          background: linear-gradient(130deg, #7BD3FF 0%, #3C8CFF 50%, #1F6BFF 100%);
          color: white;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.01em;
          cursor: pointer;
          display: inline-flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          box-shadow: 0 10px 22px rgba(31,107,255,0.28);
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .ds-extract-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 24px rgba(31,107,255,0.36);
        }
        .ds-tabs {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px;
        }
        .ds-tab {
          flex: 1;
          min-width: 0;
          border: none;
          border-radius: 12px;
          padding: 10px 10px;
          background: transparent;
          color: #6E6A76;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ds-tab:hover { color: #1D1D1F; }
        .ds-tab.is-active {
          color: #1D1D1F;
          background: rgba(255,255,255,0.72);
          box-shadow: 0 8px 20px rgba(29,29,31,0.08);
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
          border: 1px solid rgba(229,221,207,0.9);
          background: rgba(251,247,240,0.8);
          box-shadow: 0 9px 26px rgba(31,53,95,0.07);
        }
        .ds-stat::before {
          content: '';
          position: absolute;
          inset: -16px;
          opacity: 0.7;
          pointer-events: none;
        }
        .ds-stat.ds-stat-primary::before {
          background: linear-gradient(130deg, rgba(123,211,255,0.4) 0%, rgba(60,140,255,0.35) 48%, rgba(31,107,255,0.3) 100%);
        }
        .ds-stat.ds-stat-neutral::before {
          background: linear-gradient(140deg, rgba(123,211,255,0.22) 0%, rgba(60,140,255,0.08) 100%);
        }
        .ds-stat.ds-stat-youtube::before {
          background: linear-gradient(145deg, rgba(255,0,0,0.08) 0%, rgba(123,211,255,0.18) 48%, rgba(60,140,255,0.12) 100%);
        }
        .ds-stat.ds-stat-vimeo::before {
          background: linear-gradient(140deg, rgba(26,183,234,0.12) 0%, rgba(123,211,255,0.2) 56%, rgba(31,107,255,0.08) 100%);
        }
        .ds-stat-head {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 6px;
          color: #3C8CFF;
          margin-bottom: 8px;
        }
        .ds-stat-value {
          position: relative;
          z-index: 1;
          margin: 0 0 2px;
          font-size: 28px;
          line-height: 1.05;
          letter-spacing: -0.02em;
          color: #1D1D1F;
          font-weight: 700;
        }
        .ds-stat-label {
          position: relative;
          z-index: 1;
          margin: 0 0 7px;
          font-size: 13px;
          color: #2E2D34;
          font-weight: 600;
        }
        .ds-stat-sub {
          position: relative;
          z-index: 1;
          margin: 0;
          font-size: 13px;
          color: #6E6A76;
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
          color: #1D1D1F;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .ds-usage-switch {
          display: inline-flex;
          border-radius: 10px;
          padding: 3px;
          background: rgba(123,211,255,0.18);
          border: 1px solid rgba(123,211,255,0.35);
          gap: 3px;
        }
        .ds-usage-switch button {
          border: none;
          border-radius: 8px;
          padding: 5px 10px;
          background: transparent;
          color: #666470;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ds-usage-switch button.is-active {
          background: rgba(255,255,255,0.72);
          color: #1D1D1F;
        }
        .ds-usage-track {
          height: 9px;
          border-radius: 999px;
          background: rgba(229,221,207,0.95);
          overflow: hidden;
        }
        .ds-usage-bar {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #7BD3FF 0%, #3C8CFF 60%, #1F6BFF 100%);
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
          color: #1D1D1F;
          font-size: 26px;
        }
        .ds-usage-days {
          display: flex;
          align-items: end;
          gap: 7px;
        }
        .ds-usage-day {
          width: 13px;
          border-radius: 4px 4px 3px 3px;
          background: rgba(123,211,255,0.24);
          transition: all 0.2s ease;
        }
        .ds-usage-day.is-active {
          background: linear-gradient(180deg, #7BD3FF 0%, #3C8CFF 100%);
        }
        .ds-list-card { padding: 14px 0 6px; overflow: hidden; }
        .ds-list-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 0 18px 10px;
        }
        .ds-list-title {
          margin: 0;
          font-size: 17px;
          color: #1D1D1F;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .ds-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 18px;
          border-top: 1px solid rgba(229,221,207,0.75);
          transition: background 0.15s ease;
        }
        .ds-row:first-of-type {
          border-top: 1px solid rgba(60,140,255,0.32);
          box-shadow: inset 2px 0 0 rgba(60,140,255,0.45);
        }
        .ds-row:hover { background: rgba(255,255,255,0.42); }
        .ds-thumb {
          width: 124px;
          height: 70px;
          border-radius: 11px;
          overflow: hidden;
          flex-shrink: 0;
          background: rgba(123,211,255,0.16);
          border: 1px solid rgba(60,140,255,0.16);
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
          margin: 0 0 4px;
          font-size: 16px;
          color: #1D1D1F;
          font-weight: 700;
          letter-spacing: -0.01em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ds-row-meta {
          margin: 0;
          font-size: 13px;
          color: #666470;
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .ds-row-actions {
          margin-left: auto;
          display: inline-flex;
          gap: 7px;
          flex-shrink: 0;
        }
        .ds-row-btn {
          border: 1px solid rgba(60,140,255,0.25);
          border-radius: 10px;
          padding: 8px 16px;
          min-width: 78px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ds-row-btn.primary {
          background: linear-gradient(130deg, #7BD3FF 0%, #3C8CFF 48%, #1F6BFF 100%);
          color: white;
          border-color: rgba(60,140,255,0.4);
        }
        .ds-row-btn.primary:hover { filter: brightness(0.96); }
        .ds-row-btn.ghost {
          background: rgba(255,255,255,0.72);
          color: #2E2D34;
          border-color: rgba(229,221,207,0.95);
        }
        .ds-row-btn.ghost:hover {
          border-color: rgba(60,140,255,0.32);
          color: #1F6BFF;
        }
        .ds-list-footer {
          border-top: 1px solid rgba(229,221,207,0.75);
          padding: 12px 18px 10px;
        }
        .ds-link-btn {
          border: none;
          background: none;
          color: #3C8CFF;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 0;
        }
        .ds-link-btn:hover { color: #1F6BFF; }
        .ds-side {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .ds-side-main {
          padding: 20px 18px 14px;
        }
        .ds-side-title {
          margin: 0 0 5px;
          font-size: 20px;
          line-height: 1.2;
          color: #1D1D1F;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .ds-side-subtitle {
          margin: 0;
          font-size: 14px;
          line-height: 1.45;
          color: #666470;
        }
        .ds-side-safe {
          margin: 12px 0 0;
          font-size: 13px;
          color: #666470;
        }
        .ds-side-safe strong { color: #1D1D1F; }
        .ds-side-action {
          margin-top: 12px;
          padding: 14px;
          border-radius: 14px;
          border: 1px solid rgba(229,221,207,0.95);
          background: rgba(255,255,255,0.58);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.75);
        }
        .ds-side-action + .ds-side-action { margin-top: 10px; }
        .ds-side-action-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
        }
        .ds-side-action-title {
          margin: 0;
          font-size: 20px;
          color: #1D1D1F;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .ds-side-action-desc {
          margin: 0;
          font-size: 15px;
          line-height: 1.4;
          color: #666470;
        }
        .ds-side-pills {
          margin-top: 11px;
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .ds-side-pill {
          border-radius: 999px;
          padding: 3px 9px;
          font-size: 12px;
          border: 1px solid rgba(123,211,255,0.45);
          color: #1F6BFF;
          background: rgba(123,211,255,0.18);
        }
        .ds-side-btn {
          margin-top: 11px;
          width: 100%;
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, #7BD3FF 0%, #3C8CFF 52%, #1F6BFF 100%);
          color: white;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: -0.01em;
          padding: 10px 12px;
          cursor: pointer;
          transition: transform 0.15s ease, filter 0.15s ease;
        }
        .ds-side-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .ds-side-btn:not(:disabled):hover {
          transform: translateY(-1px);
          filter: brightness(0.97);
        }
        .ds-empty {
          text-align: center;
          padding: 42px 18px;
          color: #666470;
        }
        .ds-empty h3 {
          margin: 0 0 8px;
          color: #1D1D1F;
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
          background: #3C8CFF;
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
          color: #1D1D1F;
          font-weight: 700;
        }
        .ds-setting-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding: 8px 0;
          border-bottom: 1px solid rgba(229,221,207,0.8);
        }
        .ds-setting-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        .ds-setting-label { color: #666470; font-size: 13px; }
        .ds-setting-value {
          color: #1D1D1F;
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
          border: 1px solid rgba(229,221,207,0.95);
          background: rgba(255,255,255,0.7);
          color: #1D1D1F;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .ds-settings-btn:hover {
          border-color: rgba(60,140,255,0.34);
          background: rgba(123,211,255,0.12);
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
          color: #666470;
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
          color: #1F6BFF;
          background: rgba(123,211,255,0.2);
          border-color: rgba(60,140,255,0.28);
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
        @media (max-width: 1130px) {
          .ds-grid { grid-template-columns: 1fr; }
          .ds-side { order: 2; }
        }
        @media (max-width: 930px) {
          .ds-control-row { grid-template-columns: 1fr; }
          .ds-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .ds-settings { grid-template-columns: 1fr; }
        }
        @media (max-width: 760px) {
          .ds-wrap { padding: 24px 14px 44px; }
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
          .ds-tabs { flex-wrap: wrap; }
          .ds-tab { flex: 1 1 calc(50% - 6px); }
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
        <button className="ds-back" onClick={onBack}>
          <ChevronIcon size={14} dir="left" /> Back
        </button>

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

            <section className="ds-control-row">
              <button className="ds-extract-btn" onClick={onBack}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>+</span> Extract new transcript
              </button>
              <div className="ds-card ds-tabs">
                {[['overview', 'Overview'], ['history', 'History'], ['settings', 'Settings']].map(([key, label]) => (
                  <button key={key} className={`ds-tab ${tab === key ? 'is-active' : ''}`} onClick={() => setTab(key)}>
                    {label}
                  </button>
                ))}
              </div>
            </section>

            {tab === 'overview' && (
              <div className="ds-overview-col">
                <section className="ds-stats">
                  {statCards.map(stat => (
                    <article key={stat.key} className={`ds-stat ${stat.className}`}>
                      <div className="ds-stat-head">{stat.icon}</div>
                      <p className="ds-stat-value">{stat.value}</p>
                      <p className="ds-stat-label">{stat.label}</p>
                      <p className="ds-stat-sub">{stat.sub}</p>
                    </article>
                  ))}
                </section>

                <section className="ds-card ds-usage">
                  <div className="ds-usage-head">
                    <h2 className="ds-usage-title">Weekly Usage</h2>
                    <div className="ds-usage-switch">
                      <button className={usageRange === 'this' ? 'is-active' : ''} onClick={() => setUsageRange('this')}>This week</button>
                      <button className={usageRange === 'past' ? 'is-active' : ''} onClick={() => setUsageRange('past')}>Past</button>
                    </div>
                  </div>
                  <div className="ds-usage-track">
                    <div className="ds-usage-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="ds-usage-meta">
                    <div>
                      <strong>{used} / {tierMax}</strong>{' '}
                      <span style={{ color: '#666470', fontSize: 14 }}>Credits Used</span>
                    </div>
                    <div className="ds-usage-days">
                      {weekSegments.map(i => (
                        <span
                          key={i}
                          className={`ds-usage-day ${i <= activeDay ? 'is-active' : ''}`}
                          style={{ height: `${8 + (i === activeDay ? 18 : i <= activeDay ? 12 : 6)}px` }}
                        />
                      ))}
                      <span style={{ marginLeft: 6, fontSize: 14, color: '#666470' }}>{remaining} remaining</span>
                    </div>
                  </div>
                  <p style={{ margin: '10px 0 0', fontSize: 13, color: '#666470' }}>
                    Resets in <strong style={{ color: '#1D1D1F' }}>{daysLeft} day{daysLeft !== 1 ? 's' : ''}</strong>
                  </p>
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
                      {history.slice(0, 4).map((h, idx) => {
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
                              <button className="ds-row-btn primary" onClick={() => openTranscript(h)}>View</button>
                              <button className="ds-row-btn ghost" onClick={() => setTab('history')}>More</button>
                            </div>
                          </div>
                        );
                      })}
                      <div className="ds-list-footer">
                        <button className="ds-link-btn" onClick={() => setTab('history')}>
                          + View all transcripts <ChevronIcon size={11} />
                        </button>
                      </div>
                    </>
                  )}
                </section>
              </div>
            )}

            {tab === 'history' && (
              <section className="ds-card ds-list-card">
                <div className="ds-list-head">
                  <h2 className="ds-list-title">Transcript History</h2>
                </div>
                {history.length === 0 ? (
                  <div className="ds-empty">
                    <h3>No history found</h3>
                    <p>Extract your first video transcript to start your library.</p>
                    <button onClick={onBack}>Extract transcript</button>
                  </div>
                ) : (
                  <>
                    {history.map((h, idx) => {
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
                              {h.source ? h.source : null}
                            </p>
                          </div>
                          <div className="ds-row-actions">
                            <button className="ds-row-btn primary" onClick={() => openTranscript(h)}>Open</button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </section>
            )}

            {tab === 'settings' && (
              <section className="ds-settings">
                <div className="ds-card">
                  <h3 className="ds-settings-title">Account</h3>
                  <div className="ds-setting-row">
                    <span className="ds-setting-label">Email</span>
                    <span className="ds-setting-value">{user.email}</span>
                  </div>
                  <div className="ds-setting-row">
                    <span className="ds-setting-label">Member since</span>
                    <span className="ds-setting-value">{memberSince}</span>
                  </div>
                  <div className="ds-setting-row">
                    <span className="ds-setting-label">Current plan</span>
                    <span className="ds-setting-value">Free · {tierMax} credits / 7 days</span>
                  </div>
                </div>

                <div className="ds-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <h3 className="ds-settings-title" style={{ marginBottom: 2 }}>Security</h3>
                  <p className="ds-settings-help">
                    Change password sends a secure reset link to your account email.
                  </p>
                  <button
                    className="ds-settings-btn"
                    onClick={triggerPasswordReset}
                    disabled={passwordResetState.type === 'loading'}
                  >
                    {passwordResetState.type === 'loading' ? 'Sending reset link...' : 'Change password'}
                  </button>
                  {passwordResetState.type !== 'idle' && (
                    <div className={`ds-security-feedback ${passwordResetState.type}`}>
                      {passwordResetState.message}
                    </div>
                  )}
                  <button className="ds-settings-btn danger" onClick={onSignOut}>Sign out of account</button>
                </div>
              </section>
            )}
          </main>

          {tab === 'overview' && (
            <aside className="ds-side">
              <section className="ds-card ds-side-main">
                <h2 className="ds-side-title">Do something with your last transcript</h2>
                <p className="ds-side-subtitle">
                  Pick one and we&apos;ll open your most recent video transcript so you can continue right away.
                </p>
                <p className="ds-side-safe"><strong>Safe:</strong> actions open your saved transcript and keep your source unchanged.</p>

                <article className="ds-side-action">
                  <div className="ds-side-action-head">
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(123,211,255,0.22)', color: '#3C8CFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                    </div>
                    <h3 className="ds-side-action-title">AI Summary</h3>
                  </div>
                  <p className="ds-side-action-desc">Generate a TLDR, key points, and chapter ideas for your latest transcript.</p>
                  <div className="ds-side-pills">
                    <span className="ds-side-pill">TLDR</span>
                    <span className="ds-side-pill">Key points</span>
                    <span className="ds-side-pill">Chapters</span>
                  </div>
                  <button className="ds-side-btn" disabled={!latest} onClick={() => openTranscript(latest)}>Generate summary</button>
                </article>

                <article className="ds-side-action">
                  <div className="ds-side-action-head">
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(123,211,255,0.22)', color: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                    </div>
                    <h3 className="ds-side-action-title">Ask AI (Chat)</h3>
                  </div>
                  <p className="ds-side-action-desc">Start chat with transcript context and ask focused questions instantly.</p>
                  <div className="ds-side-pills">
                    <span className="ds-side-pill">Transcript-aware</span>
                    <span className="ds-side-pill">Fast answers</span>
                  </div>
                  <button className="ds-side-btn" disabled={!latest} onClick={() => openTranscript(latest)}>Start chat</button>
                </article>

                <article className="ds-side-action">
                  <div className="ds-side-action-head">
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(123,211,255,0.22)', color: '#0F766E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <DownloadIcon size={18} />
                    </div>
                    <h3 className="ds-side-action-title">Export</h3>
                  </div>
                  <p className="ds-side-action-desc">Download transcript content in the format you need.</p>
                  <div className="ds-side-pills">
                    <span className="ds-side-pill">TXT</span>
                    <span className="ds-side-pill">PDF</span>
                    <span className="ds-side-pill">Markdown</span>
                  </div>
                  <button className="ds-side-btn" disabled={!latest} onClick={() => openTranscript(latest)}>Download</button>
                </article>
              </section>

              <button className="ds-link-btn" onClick={() => setTab('history')} style={{ alignSelf: 'center' }}>
                + View all transcripts <ChevronIcon size={11} />
              </button>
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
const Navbar = ({ onAskAI, hasTranscript, credits, user, onSignIn, onSignOut, onDashboard, onHome }) => (
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
      <CreditsWidget credits={credits} onUpgrade={() => onSignIn('signup')} />
      <div style={{ width: 1, height: 18, background: P.border }} />
      <a href="https://joelmoyal.com" target="_blank" rel="noopener noreferrer"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 7, color: P.muted, textDecoration: 'none', transition: 'all 0.15s' }}
        onMouseEnter={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = P.muted; }}
        title="Website"
      ><GlobeIcon /></a>
      <a href="https://github.com/joelmoyal" target="_blank" rel="noopener noreferrer"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 7, color: P.muted, textDecoration: 'none', transition: 'all 0.15s' }}
        onMouseEnter={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = P.muted; }}
        title="GitHub"
      ><GitHubIcon /></a>
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
  const [lang, setLang]                   = useState('en');
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
  const [error, setError]                 = useState('');
  const [copied, setCopied]               = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [search, setSearch]               = useState('');
  const [history, setHistory]             = useState(() => {
    try { return JSON.parse(localStorage.getItem('yte_history') || '[]'); } catch { return []; }
  });
  const [credits, setCredits] = useState(initCredits);
  const [showBookmarkBanner, setShowBookmarkBanner] = useState(false);
  const [user, setUser]                   = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authInitialTab, setAuthInitialTab] = useState('signin');
  const [view, setView]                   = useState('app');   // 'app' | 'dashboard'
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [summary, setSummary]             = useState('');
  const [summarizing, setSummarizing]     = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [showQA, setShowQA]               = useState(false);
  const [qaQuestion, setQaQuestion]       = useState('');
  const [qaMessages, setQaMessages]       = useState([]);
  const [qaLoading, setQaLoading]         = useState(false);
  const [chapters, setChapters]           = useState([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [showChapters, setShowChapters]   = useState(false);
  const [quotes, setQuotes]               = useState([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [showQuotes, setShowQuotes]       = useState(false);
  const [quotesCopied, setQuotesCopied]   = useState(false);
  const [activeTab, setActiveTab]         = useState('transcript'); // 'transcript' | 'chapters' | 'editor'
  const [currentTitle, setCurrentTitle]   = useState('');
  const [currentChannel, setCurrentChannel] = useState('');
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [exportToggle, setExportToggle]   = useState(false);

  const downloadMenuRef = useRef(null);
  const qaInputRef      = useRef(null);
  const urlInputRef     = useRef(null);
  const qaRef           = useRef(null);
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

  useEffect(() => {
    if (localStorage.getItem('yte_bookmark_dismissed')) return;
    const t = setTimeout(() => setShowBookmarkBanner(true), 4000);
    return () => clearTimeout(t);
  }, []);

  // ── Supabase auth session ──────────────────────────────────────────────────
  useEffect(() => {
    const authState = getAuthUrlState();
    recoveryIntentRef.current = authState.isRecovery;

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
    };
    bootstrapAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
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
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

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

      const tierMax = user ? CREDITS_MAX : CREDITS_FREE;

      if (!stored || typeof stored.resetAt !== 'number' || Date.now() > stored.resetAt) {
        stored = { used: 0, resetAt: Date.now() + CREDITS_PERIOD_MS };
      }

      if (stored.used > tierMax) stored = { ...stored, used: tierMax };

      stored = { ...stored, tierMax, userId: user ? user.id : null };
      localStorage.setItem(key, JSON.stringify(stored));
      setCredits(stored);
    } catch {
      setCredits({ used: 0, resetAt: Date.now() + CREDITS_PERIOD_MS, tierMax: user ? CREDITS_MAX : CREDITS_FREE, userId: user ? user.id : null });
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
      const max = user ? CREDITS_MAX : CREDITS_FREE;
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
  };

  const resetAll = () => {
    setVideoUrl(''); setTranscript(''); setSegments([]);
    setTranscriptSource(''); setCurrentVideoId(null); setCurrentPlatform('youtube'); setCurrentThumbnail(null); setError(''); setSearch('');
    setSummary(''); setShowTimestamps(true); setShowQA(false);
    setQaQuestion(''); setQaMessages([]);
    setChapters([]); setShowChapters(false);
    setQuotes([]); setShowQuotes(false);
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
    setTimeout(() => qaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
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

  const getTranscript = () => {
    const parsed = parseVideoUrl(videoUrl);
    if (!parsed) { setError('Please enter a valid YouTube or Vimeo URL'); return; }
    const { platform, id: videoId, url: videoCanonical } = parsed;

    setError(''); setTranscript(''); setTranscriptSource('');
    setSegments([]); setCurrentVideoId(null); setCurrentPlatform(platform); setCurrentThumbnail(null); setSearch('');
    setSummary(''); setChapters([]); setShowChapters(false);
    setQuotes([]); setShowQuotes(false); setQaMessages([]); setShowQA(false);
    setLoading(true); setLoadingMsg('Looking for subtitles…');
    setLoadingPercent(5); setLoadingStage('subtitles');

    const apiUrl = platform === 'vimeo'
      ? `/api/transcript?platform=vimeo&url=${encodeURIComponent(videoCanonical)}&lang=${lang}`
      : `/api/transcript?videoId=${videoId}&lang=${lang}`;
    const es = new EventSource(apiUrl);
    const killTimer = setTimeout(() => {
      es.close();
      setError('Request timed out. The video may be too long or unavailable.');
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
        setTranscriptSource(data.source || '');
        setCurrentVideoId(videoId);
        setCurrentThumbnail(thumb);
        setCurrentTitle(title);
        setCurrentChannel(channel);
        setLoadingPercent(100);
        incrementCredits();
        saveToHistory({
          id: videoId, platform, transcript: data.transcript, segments: data.segments || [],
          source: data.source || '', date: new Date().toISOString(),
          thumbnail: thumb, title, channel, url: videoCanonical,
        });
      } catch {
        setError('Failed to process transcript response.');
      } finally {
        setLoading(false); setLoadingMsg(''); setLoadingPercent(0); setLoadingStage('');
      }
    });

    es.addEventListener('error', (e) => {
      clearTimeout(killTimer); es.close();
      try {
        const data = JSON.parse(e.data);
        setError(data.details ? `${data.error}: ${data.details}` : (data.error || 'Failed to fetch transcript'));
      } catch { setError('Connection lost. Please try again.'); }
      setLoading(false); setLoadingMsg(''); setLoadingPercent(0); setLoadingStage('');
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      clearTimeout(killTimer); es.close();
      setError('Connection lost. Please try again.');
      setLoading(false); setLoadingMsg(''); setLoadingPercent(0); setLoadingStage('');
    };
  };

  const downloadTxt = () => {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([transcript], { type: 'text/plain' })),
      download: 'transcript.txt',
    });
    a.click(); URL.revokeObjectURL(a.href); setShowDownloadMenu(false);
  };

  const downloadPdf = () => {
    const doc = new jsPDF(); const m = 15; doc.setFontSize(12);
    doc.text(doc.splitTextToSize(transcript, doc.internal.pageSize.getWidth() - m * 2), m, m);
    doc.save('transcript.pdf'); setShowDownloadMenu(false);
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
      download: 'transcript.srt',
    });
    a.click(); URL.revokeObjectURL(a.href);
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
    } catch (err) { setSummary(`Error: ${err.message}`); }
    finally { setSummarizing(false); }
  };

  const detectChapters = async () => {
    if (chaptersLoading) return;
    setChaptersLoading(true); setChapters([]);
    try {
      const res = await fetch('/api/chapters', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, segments }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Server error ${res.status}`); }
      if (!res.ok) throw new Error(data.error || 'Failed to detect chapters');
      setChapters(data.chapters || []); setShowChapters(true);
    } catch (err) {
      setChapters([{ seconds: 0, title: `Error: ${err.message}`, isError: true }]); setShowChapters(true);
    } finally { setChaptersLoading(false); }
  };

  const extractQuotes = async () => {
    if (quotesLoading) return;
    setQuotesLoading(true); setQuotes([]);
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Server error ${res.status}`); }
      if (!res.ok) throw new Error(data.error || 'Failed to extract quotes');
      setQuotes(data.quotes || []); setShowQuotes(true);
    } catch (err) { setQuotes([`Error: ${err.message}`]); setShowQuotes(true); }
    finally { setQuotesLoading(false); }
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

  const handleChipClick = (chip) => {
    if (!transcript) return;
    setQaQuestion(chip);
    setShowQA(true);
    setTimeout(() => { qaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
    askQuestion(chip);
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
        .fade-up { animation: fadeUp 0.3s ease forwards; }
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
          onBack={() => setView('app')}
          onSignOut={handleSignOut}
          onLoadTranscript={loadFromHistory}
          onChangePassword={async () => {
            const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: getPasswordResetRedirectUrl() });
            if (error) return { ok: false, error: friendlyError(error.message) };
            return { ok: true };
          }}
        />
      )}

      <div style={{ minHeight: '100vh', paddingTop: showBookmarkBanner ? 97 : 56, background: transcript ? 'linear-gradient(180deg, rgba(110,80,220,0.06) 0%, #F6F3EE 35%)' : P.paper, transition: 'padding-top 0.3s ease, background 0.4s ease', display: view === 'dashboard' ? 'none' : 'block' }}>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* LANDING VIEW */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {!transcript && (
          <div style={{ animation: 'fadeUp 0.4s ease' }}>

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
                YouTube · Vimeo · Free · No account required
              </div>

              <h1 style={{
                fontSize: 'clamp(32px, 6vw, 52px)', fontWeight: 800, color: P.ink,
                letterSpacing: '-0.04em', lineHeight: 1.1, margin: '0 0 18px',
              }}>
                Extract any YouTube<br />transcript, ask AI anything
              </h1>
              <p style={{ fontSize: 17, color: P.muted, margin: '0 0 40px', lineHeight: 1.65, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
                Paste a link, get a precise transcript instantly. Then summarize, ask questions, or export — all AI-powered.
              </p>

              {/* Input card */}
              <div style={{
                background: P.surface, border: `1px solid ${P.border}`,
                borderRadius: 18, boxShadow: '0 8px 48px rgba(28,25,23,0.1)',
                padding: 8,
              }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: P.paper, borderRadius: 12, border: `1px solid ${P.border}` }}>
                    {parseVideoUrl(videoUrl)?.platform === 'vimeo' ? <VimeoIcon /> : <YouTubeIcon />}
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
                        fontSize: 16, color: P.ink,
                      }}
                    />
                  </div>
                  <button
                    onClick={getTranscript}
                    disabled={loading}
                    style={{
                      flexShrink: 0, padding: '0 24px', borderRadius: 12, border: 'none',
                      background: loading ? `rgba(45,108,223,0.5)` : P.accent,
                      color: 'white', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
                      transition: 'background 0.15s',
                      minWidth: 130,
                    }}
                    onMouseEnter={e => { if (!loading) e.currentTarget.style.background = P.accentHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = loading ? `rgba(45,108,223,0.5)` : P.accent; }}
                  >
                    {loading ? <SpinnerIcon /> : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    )}
                    {loading ? 'Extracting…' : 'Extract'}
                  </button>
                </div>

                {/* Hint row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px 5px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: P.muted }}>
                    <YouTubeIcon /> <VimeoIcon size={13} />
                    <span>YouTube &amp; Vimeo supported</span>
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: P.muted }}>Language:</span>
                    <select
                      value={lang}
                      onChange={e => setLang(e.target.value)}
                      style={{
                        border: `1px solid ${P.border}`, borderRadius: 6, background: P.paper,
                        fontSize: 11, color: P.ink, padding: '3px 6px', outline: 'none', cursor: 'pointer',
                      }}
                    >
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              {loading && loadingPercent > 0 && (
                <div className="fade-up" style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {['subtitles', 'audio', 'whisper'].map((stage) => {
                        const labels = { subtitles: 'Subtitles', audio: 'Audio', whisper: 'AI' };
                        const order = ['subtitles', 'audio', 'whisper'];
                        const isDone = order.indexOf(stage) < order.indexOf(loadingStage);
                        const isActive = stage === loadingStage;
                        return (
                          <span key={stage} style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
                            background: isDone ? 'rgba(15,118,110,0.1)' : isActive ? P.accentLight : P.paper,
                            color: isDone ? P.success : isActive ? P.accent : P.muted,
                            border: `1px solid ${isDone ? 'rgba(15,118,110,0.2)' : isActive ? 'rgba(45,108,223,0.2)' : P.border}`,
                          }}>{isDone ? '✓ ' : ''}{labels[stage]}</span>
                        );
                      })}
                    </div>
                    <span style={{ fontSize: 11, color: P.muted, fontWeight: 600 }}>{loadingPercent}%</span>
                  </div>
                  <div style={{ height: 3, borderRadius: 999, background: P.border, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${loadingPercent}%`, background: P.accent, borderRadius: 999, transition: 'width 0.5s ease' }} />
                  </div>
                  <p style={{ fontSize: 12, color: P.muted, marginTop: 8 }}>{loadingMsg}</p>
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

              {/* Demo question chips */}
              <div style={{ marginTop: 22, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                <span style={{ fontSize: 12, color: P.muted, width: '100%', marginBottom: 2, display: 'block' }}>Try asking:</span>
                {DEMO_CHIPS.map(chip => (
                  <button
                    key={chip}
                    className="chip-btn"
                    onClick={() => handleChipClick(chip)}
                    style={{
                      padding: '7px 15px', borderRadius: 999,
                      border: `1px solid ${P.border}`, background: P.surface,
                      fontSize: 13, color: P.muted, cursor: 'pointer',
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
            </div>{/* end hero-grad */}

            {/* How it works */}
            <div style={{
              maxWidth: 740,
              margin: '0 auto',
              padding: '6px 24px 36px',
              display: 'flex',
              gap: 16,
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap'
            }}>
              {[
                { num: '1', label: 'Paste a YouTube URL' },
                { num: '2', label: 'Get the transcript instantly' },
                { num: '3', label: 'Ask AI anything about it' },
              ].map((step, i) => (
                <React.Fragment key={step.num}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 210 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      border: `1.5px solid ${P.accent}`,
                      background: 'rgba(60,140,255,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 800, color: P.accent, flexShrink: 0
                    }}>{step.num}</div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: P.ink, letterSpacing: '-0.01em' }}>
                      {step.label}
                    </span>
                  </div>
                  {i < 2 && <div style={{ width: 26, height: 1, background: P.border, flexShrink: 0 }} />}
                </React.Fragment>
              ))}
            </div>

            {/* Feature cards */}
            <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 24px 48px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {[
                {
                  icon: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={P.accent} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                      <polyline points="10 9 9 9 8 9"/>
                    </svg>
                  ),
                  bg: 'rgba(45,108,223,0.07)',
                  label: 'Instant Transcript',
                  desc: 'Extract complete transcripts from YouTube & Vimeo with timestamps in seconds — no login needed',
                },
                {
                  icon: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={P.success} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  ),
                  bg: 'rgba(15,118,110,0.07)',
                  label: 'AI Summaries',
                  desc: 'Summarize long transcripts into concise highlights using fast LLMs',
                },
                {
                  icon: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  ),
                  bg: 'rgba(124,58,237,0.07)',
                  label: 'Ask Anything',
                  desc: 'Chat with the transcript — get precise answers from AI in seconds',
                },
                {
                  icon: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={P.warning} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                  ),
                  bg: 'rgba(180,83,9,0.07)',
                  label: 'Privacy First',
                  desc: 'No account needed. We never store your video data or conversations',
                },
              ].map(card => (
                <div key={card.label} className="feature-card" style={{
                  background: P.surface, border: `1px solid ${P.border}`, borderRadius: 16,
                  padding: '24px 20px',
                }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: card.bg, marginBottom: 14 }}>
                    {card.icon}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: P.ink, marginBottom: 8, letterSpacing: '-0.02em' }}>
                    {card.label}
                  </div>
                  <div style={{ fontSize: 13.5, color: P.muted, lineHeight: 1.6 }}>{card.desc}</div>
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
          <div className="fade-up" style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 20px 48px' }}>
          <div style={{
            background: '#FFFFFF',
            borderRadius: 24,
            boxShadow: '0 8px 48px rgba(28,25,23,0.09), 0 1px 3px rgba(28,25,23,0.04)',
            border: `1px solid ${P.border}`,
            overflow: 'hidden',
            display: 'grid',
            gridTemplateColumns: '280px 1fr 360px',
            gridTemplateRows: 'auto 1fr',
            minHeight: 'calc(100vh - 140px)',
          }}>

            {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'sticky', top: 72, background: P.surface, border: `1px solid ${P.border}`, borderRadius: 14, overflow: 'hidden' }}>

              {/* Back / New search */}
              <button onClick={resetAll} style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '12px 14px',
                border: 'none', borderBottom: `1px solid ${P.border}`, background: 'transparent',
                cursor: 'pointer', fontSize: 13, fontWeight: 600, color: P.muted, transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = P.ink; e.currentTarget.style.background = P.paper; }}
                onMouseLeave={e => { e.currentTarget.style.color = P.muted; e.currentTarget.style.background = 'transparent'; }}
              >
                <ChevronIcon dir="left" size={12} />
                New search
              </button>

              {/* Export section */}
              <div style={{ padding: '10px 14px 4px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Export</div>
              </div>
              <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[
                  { label: 'Text', sub: '.txt file', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>, fn: downloadTxt },
                  { label: 'PDF', sub: '.pdf file', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15v-1h6v1"/><path d="M12 15v3"/></svg>, fn: downloadPdf },
                  { label: 'Markdown', sub: 'copy to clipboard', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>, fn: copyAsMarkdown },
                  { label: copied ? 'Copied!' : 'Plain text', sub: 'copy to clipboard', icon: copied ? <CheckIcon /> : <CopyIcon />, fn: copyToClipboard },
                ].map(item => (
                  <button key={item.label} onClick={item.fn} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px',
                    borderRadius: 8, border: 'none', background: 'transparent',
                    cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left', width: '100%',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = P.accentLight; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ color: P.muted, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{item.icon}</span>
                    <span>
                      <div style={{ fontSize: 12, fontWeight: 600, color: P.ink, lineHeight: 1.3 }}>{item.label}</div>
                      <div style={{ fontSize: 10, color: P.muted, lineHeight: 1.3 }}>{item.sub}</div>
                    </span>
                  </button>
                ))}
              </div>

              {/* History section */}
              {history.length > 0 && (
                <>
                  <div style={{ borderTop: `1px solid ${P.border}`, padding: '10px 14px 4px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>History</div>
                  </div>
                  <div style={{ maxHeight: 320, overflowY: 'auto', padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {history.map((entry) => {
                      const hTitle = entry.title || entry.id;
                      const hChannel = entry.channel || (entry.platform === 'vimeo' ? 'Vimeo' : 'YouTube');
                      return (
                        <button key={entry.id}
                          onClick={() => loadFromHistory(entry)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px',
                            borderRadius: 8, border: 'none', background: entry.id === currentVideoId ? P.accentLight : 'transparent',
                            cursor: 'pointer', transition: 'background 0.1s', textAlign: 'left', width: '100%',
                          }}
                          onMouseEnter={e => { if (entry.id !== currentVideoId) e.currentTarget.style.background = P.paper; }}
                          onMouseLeave={e => { if (entry.id !== currentVideoId) e.currentTarget.style.background = 'transparent'; }}
                        >
                          {entry.thumbnail ? (
                            <img src={entry.thumbnail} alt="" style={{ width: 44, height: 28, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} onError={e => { e.target.style.display = 'none'; }} />
                          ) : (
                            <div style={{ width: 44, height: 28, borderRadius: 4, background: P.border, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <YouTubeIcon />
                            </div>
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: P.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{hTitle}</div>
                            <div style={{ fontSize: 10, color: P.muted, lineHeight: 1.3 }}>{hChannel} · {timeAgo(entry.date)}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* ── CENTER MAIN ───────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0, background: P.surface, border: `1px solid ${P.border}`, borderRadius: 14, overflow: 'hidden' }}>

              {/* Video embed */}
              {currentVideoId && (
                <a href={currentPlatform === 'vimeo' ? `https://vimeo.com/${currentVideoId}` : `https://youtube.com/watch?v=${currentVideoId}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ display: 'block', textDecoration: 'none', position: 'relative', background: '#000' }}>
                  {(currentThumbnail || currentPlatform === 'youtube') && (
                    <img
                      src={currentThumbnail || `https://img.youtube.com/vi/${currentVideoId}/mqdefault.jpg`}
                      alt="Video thumbnail"
                      style={{ width: '100%', display: 'block', maxHeight: 240, objectFit: 'cover', opacity: 0.92 }}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  )}
                  {/* Play button overlay */}
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(6px)', border: '2px solid rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                  </div>
                  {/* Title overlay at bottom */}
                  {currentTitle && (
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '28px 14px 12px', background: 'linear-gradient(transparent, rgba(0,0,0,0.72))' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'white', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentTitle}</div>
                    </div>
                  )}
                </a>
              )}

              {/* Video meta row */}
              {(currentTitle || currentChannel) && (
                <div style={{ padding: '10px 16px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {currentChannel && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: P.muted, fontWeight: 500 }}>
                      {currentPlatform === 'vimeo' ? <VimeoIcon size={11} /> : <YouTubeIcon />}
                      {currentChannel}
                    </span>
                  )}
                  {transcriptSource === 'whisper' && (
                    <span style={{ padding: '1px 6px', fontSize: 10, fontWeight: 600, background: 'rgba(107,100,92,0.1)', color: P.muted, borderRadius: 999, border: `1px solid ${P.border}` }}>AI generated</span>
                  )}
                  {transcriptSource === 'subtitles' && (
                    <span style={{ padding: '1px 6px', fontSize: 10, fontWeight: 600, background: 'rgba(15,118,110,0.1)', color: P.success, borderRadius: 999, border: `1px solid rgba(15,118,110,0.2)` }}>From subtitles</span>
                  )}
                </div>
              )}

              {/* Tab bar: Transcript | Chapters | Editor */}
              <div style={{ display: 'flex', padding: '10px 12px 0', gap: 2, borderBottom: `1px solid ${P.border}`, marginTop: 10 }}>
                {[
                  { key: 'transcript', label: 'Transcript' },
                  { key: 'chapters', label: chapters.length > 0 ? `Chapters (${chapters.filter(c => !c.isError).length})` : 'Chapters' },
                  { key: 'editor', label: 'Editor' },
                ].map(tab => (
                  <button key={tab.key} onClick={() => {
                    setActiveTab(tab.key);
                    if (tab.key === 'chapters' && chapters.length === 0 && !chaptersLoading) detectChapters();
                  }} style={{
                    padding: '7px 14px', border: 'none', background: 'transparent',
                    color: activeTab === tab.key ? P.accent : P.muted,
                    fontSize: 13, fontWeight: activeTab === tab.key ? 700 : 500,
                    cursor: 'pointer', transition: 'all 0.15s', position: 'relative',
                    borderBottom: activeTab === tab.key ? `2px solid ${P.accent}` : '2px solid transparent',
                    marginBottom: -1,
                  }}>{tab.label}</button>
                ))}
                {/* Timestamps toggle pushed right */}
                {segments.length > 0 && (
                  <button onClick={() => setShowTimestamps(v => !v)} style={{
                    marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, marginBottom: 6,
                    border: `1px solid ${showTimestamps ? 'rgba(45,108,223,0.25)' : P.border}`,
                    background: showTimestamps ? P.accentLight : 'transparent', cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, color: showTimestamps ? P.accent : P.muted, transition: 'all 0.15s',
                  }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Timestamps
                  </button>
                )}
              </div>

              {/* Action buttons row */}
              <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${P.border}`, background: P.paper, flexWrap: 'wrap' }}>
                <button onClick={summarize} disabled={summarizing} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 20,
                  border: `1px solid ${P.border}`, background: P.surface,
                  fontSize: 12, fontWeight: 600, color: P.ink, cursor: summarizing ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s', opacity: summarizing ? 0.7 : 1,
                }}
                  onMouseEnter={e => { if (!summarizing) { e.currentTarget.style.background = P.accentLight; e.currentTarget.style.borderColor = 'rgba(45,108,223,0.3)'; e.currentTarget.style.color = P.accent; } }}
                  onMouseLeave={e => { e.currentTarget.style.background = P.surface; e.currentTarget.style.borderColor = P.border; e.currentTarget.style.color = P.ink; }}
                >
                  {summarizing ? <SpinnerIcon size={11} /> : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
                  {summarizing ? 'Summarizing…' : 'Summarize'}
                </button>
                <button onClick={extractQuotes} disabled={quotesLoading} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 20,
                  border: `1px solid ${P.border}`, background: P.surface,
                  fontSize: 12, fontWeight: 600, color: P.ink, cursor: quotesLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s', opacity: quotesLoading ? 0.7 : 1,
                }}
                  onMouseEnter={e => { if (!quotesLoading) { e.currentTarget.style.background = P.accentLight; e.currentTarget.style.borderColor = 'rgba(45,108,223,0.3)'; e.currentTarget.style.color = P.accent; } }}
                  onMouseLeave={e => { e.currentTarget.style.background = P.surface; e.currentTarget.style.borderColor = P.border; e.currentTarget.style.color = P.ink; }}
                >
                  {quotesLoading ? <SpinnerIcon size={11} /> : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>}
                  {quotesLoading ? 'Extracting…' : 'Key Quotes'}
                </button>
                <button onClick={() => { detectChapters(); setActiveTab('chapters'); }} disabled={chaptersLoading} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 20,
                  border: `1px solid ${P.border}`, background: P.surface,
                  fontSize: 12, fontWeight: 600, color: P.ink, cursor: chaptersLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s', opacity: chaptersLoading ? 0.7 : 1,
                }}
                  onMouseEnter={e => { if (!chaptersLoading) { e.currentTarget.style.background = P.accentLight; e.currentTarget.style.borderColor = 'rgba(45,108,223,0.3)'; e.currentTarget.style.color = P.accent; } }}
                  onMouseLeave={e => { e.currentTarget.style.background = P.surface; e.currentTarget.style.borderColor = P.border; e.currentTarget.style.color = P.ink; }}
                >
                  {chaptersLoading ? <SpinnerIcon size={11} /> : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>}
                  {chaptersLoading ? 'Detecting…' : 'Chapters'}
                </button>
              </div>

              {/* Transcript tab */}
              {activeTab === 'transcript' && (
                <div>
                  {/* Search bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: `1px solid ${P.border}`, background: P.paper }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search transcript…"
                      style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: P.ink }} />
                    {search && matchCount > 0 && <span style={{ fontSize: 11, color: P.muted }}>{matchCount} match{matchCount !== 1 ? 'es' : ''}</span>}
                    {search && <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>}
                  </div>
                  {/* Transcript text */}
                  <div style={{ padding: '20px', maxHeight: 520, overflowY: 'auto', fontSize: 14, lineHeight: 2, color: P.ink, background: P.surface }}>
                    {segments.length > 0 && showTimestamps ? (
                      segments.map((seg, i) => (
                        <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
                          <a href={currentPlatform === 'vimeo' ? `https://vimeo.com/${currentVideoId}#t=${seg.seconds}s` : `https://youtube.com/watch?v=${currentVideoId}&t=${seg.seconds}s`}
                            target="_blank" rel="noopener noreferrer"
                            title={`Jump to ${formatTime(seg.seconds)}`}
                            style={{ color: P.accent, fontWeight: 700, fontSize: 11, textDecoration: 'none', fontFamily: 'monospace', flexShrink: 0, marginTop: 5, minWidth: 38 }}>
                            {formatTime(seg.seconds)}
                          </a>
                          <span style={{ lineHeight: 1.85 }}>{highlightText(seg.text)}</span>
                        </div>
                      ))
                    ) : (
                      <span>{highlightText(transcript)}</span>
                    )}
                  </div>
                  {/* Footer stats bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: P.paper, borderTop: `1px solid ${P.border}` }}>
                    <span style={{ fontSize: 11, color: P.muted }}><strong style={{ color: P.ink }}>{wordCount.toLocaleString()}</strong> words</span>
                    <span style={{ color: P.border }}>·</span>
                    <span style={{ fontSize: 11, color: P.muted }}><strong style={{ color: P.ink }}>{charCount >= 1000 ? `${(charCount / 1000).toFixed(1)}k` : charCount}</strong> chars</span>
                    <span style={{ color: P.border }}>·</span>
                    <span style={{ fontSize: 11, color: P.muted }}>~<strong style={{ color: P.ink }}>{readingMins}</strong> min read</span>
                  </div>
                </div>
              )}

              {/* Chapters tab */}
              {activeTab === 'chapters' && (
                <div>
                  {chaptersLoading ? (
                    <div style={{ padding: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: P.muted, fontSize: 13 }}>
                      <SpinnerIcon size={14} /> Detecting chapters…
                    </div>
                  ) : chapters.length > 0 ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>{chapters.filter(c => !c.isError).length} chapters · click to jump</span>
                        <button onClick={detectChapters} disabled={chaptersLoading} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: 0 }}>Refresh</button>
                      </div>
                      <div style={{ padding: '4px 0', maxHeight: 560, overflowY: 'auto' }}>
                        {chapters.map((ch, i) => (
                          ch.isError ? (
                            <div key={i} style={{ padding: '8px 16px', fontSize: 12, color: P.error }}>{ch.title}</div>
                          ) : (
                            <a key={i} href={`https://youtube.com/watch?v=${currentVideoId}&t=${ch.seconds}s`} target="_blank" rel="noopener noreferrer"
                              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 16px', textDecoration: 'none', transition: 'background 0.1s', borderBottom: `1px solid ${P.border}` }}
                              onMouseEnter={e => e.currentTarget.style.background = P.paper}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: P.accent, flexShrink: 0, minWidth: 36 }}>{formatTime(ch.seconds)}</span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: P.ink }}>{ch.title}</span>
                              <svg style={{ marginLeft: 'auto', color: P.border, flexShrink: 0 }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            </a>
                          )
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 13, color: P.muted }}>No chapters detected yet.</span>
                      <button onClick={detectChapters} style={{
                        padding: '8px 18px', borderRadius: 8, border: `1px solid ${P.border}`,
                        background: P.paper, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: P.ink, transition: 'all 0.15s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.background = P.accentLight; e.currentTarget.style.color = P.accent; e.currentTarget.style.borderColor = 'rgba(45,108,223,0.25)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; e.currentTarget.style.borderColor = P.border; }}
                      >Detect Chapters</button>
                    </div>
                  )}
                </div>
              )}

              {/* Editor tab */}
              {activeTab === 'editor' && (
                <div style={{ padding: '16px' }}>
                  <textarea
                    defaultValue={transcript}
                    style={{
                      width: '100%', minHeight: 480, border: `1px solid ${P.border}`, borderRadius: 10,
                      padding: '16px', fontSize: 13.5, lineHeight: 1.85, color: P.ink, background: P.paper,
                      outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                    onFocus={e => { e.target.style.borderColor = P.accent; }}
                    onBlur={e => { e.target.style.borderColor = P.border; }}
                  />
                  <div style={{ marginTop: 8, fontSize: 11, color: P.muted }}>Edit the transcript text above. Changes are local only.</div>
                </div>
              )}
            </div>

            {/* ── RIGHT SIDEBAR — Insights + Ask Anything ───────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 72, maxHeight: 'calc(100vh - 88px)', overflowY: 'auto' }}>

              {/* Insights header */}
              <div style={{ fontSize: 16, fontWeight: 700, color: P.ink, paddingLeft: 2 }}>Insights</div>

              {/* AI Summaries card */}
              <div style={{ background: P.surface, border: `1px solid ${P.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(45,108,223,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>AI Summaries</div>
                      <div style={{ fontSize: 10, color: P.muted }}>Bullet point summaries</div>
                    </div>
                  </div>
                  {summary && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => { navigator.clipboard.writeText(summary).then(() => { setSummaryCopied(true); setTimeout(() => setSummaryCopied(false), 2000); }); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 3, border: `1px solid ${P.border}`, background: summaryCopied ? P.paper : P.surface, cursor: 'pointer', borderRadius: 5, padding: '2px 7px', fontSize: 10, fontWeight: 600, color: summaryCopied ? P.success : P.muted, transition: 'all 0.15s' }}>
                        {summaryCopied ? <CheckIcon /> : <CopyIcon />} {summaryCopied ? 'Copied!' : 'Copy'}
                      </button>
                      <button onClick={() => setSummary('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
                    </div>
                  )}
                </div>
                {summary ? (
                  <div style={{ padding: '12px 14px', background: P.surface, fontSize: 12.5, lineHeight: 1.75, color: P.ink, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>{summary}</div>
                ) : (
                  <div style={{ padding: '10px 12px' }}>
                    <button onClick={summarize} disabled={summarizing} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%',
                      padding: '8px 14px', borderRadius: 8,
                      border: `1px solid ${summarizing ? P.border : 'rgba(45,108,223,0.25)'}`,
                      background: summarizing ? P.paper : P.accentLight,
                      color: summarizing ? P.muted : P.accent,
                      cursor: summarizing ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                    }}
                      onMouseEnter={e => { if (!summarizing) e.currentTarget.style.background = 'rgba(45,108,223,0.14)'; }}
                      onMouseLeave={e => { if (!summarizing) e.currentTarget.style.background = P.accentLight; }}
                    >
                      {summarizing ? <SpinnerIcon size={11} /> : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
                      {summarizing ? 'Summarizing…' : 'Generate Summary'}
                    </button>
                  </div>
                )}
              </div>

              {/* Key Quotes / Topic Extraction card */}
              <div style={{ background: P.surface, border: `1px solid ${P.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(180,83,9,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.warning} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>Key Quotes</div>
                      <div style={{ fontSize: 10, color: P.muted }}>Notable excerpts</div>
                    </div>
                  </div>
                  {quotes.length > 0 && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => { navigator.clipboard.writeText(quotes.map(q => `"${q}"`).join('\n\n')).then(() => { setQuotesCopied(true); setTimeout(() => setQuotesCopied(false), 2000); }); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 3, border: `1px solid ${P.border}`, background: quotesCopied ? P.paper : P.surface, cursor: 'pointer', borderRadius: 5, padding: '2px 7px', fontSize: 10, fontWeight: 600, color: quotesCopied ? P.success : P.muted, transition: 'all 0.15s' }}>
                        {quotesCopied ? <CheckIcon /> : <CopyIcon />} {quotesCopied ? 'Copied!' : 'Copy all'}
                      </button>
                    </div>
                  )}
                </div>
                {quotes.length > 0 ? (
                  <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                    {quotes.map((q, i) => (
                      q.startsWith('Error:') ? (
                        <div key={i} style={{ fontSize: 11, color: P.error }}>{q}</div>
                      ) : (
                        <div key={i} style={{ position: 'relative', padding: '8px 10px 8px 14px', background: P.paper, borderRadius: 7, borderLeft: `2px solid ${P.warning}`, fontSize: 12, lineHeight: 1.6, color: P.ink, fontStyle: 'italic' }}>
                          {q}
                        </div>
                      )
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '10px 12px' }}>
                    <button onClick={extractQuotes} disabled={quotesLoading} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%',
                      padding: '8px 14px', borderRadius: 8, border: `1px solid ${P.border}`,
                      background: quotesLoading ? P.paper : P.surface, color: P.muted,
                      cursor: quotesLoading ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                    }}
                      onMouseEnter={e => { if (!quotesLoading) { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; } }}
                      onMouseLeave={e => { if (!quotesLoading) { e.currentTarget.style.background = P.surface; e.currentTarget.style.color = P.muted; } }}
                    >
                      {quotesLoading ? <SpinnerIcon size={11} /> : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>}
                      {quotesLoading ? 'Extracting…' : 'Extract Key Quotes'}
                    </button>
                  </div>
                )}
              </div>

              {/* Ask Anything / Q&A card */}
              <div ref={qaRef} style={{ background: P.surface, border: `1px solid ${P.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(45,108,223,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>Ask Anything</div>
                      <div style={{ fontSize: 10, color: P.muted }}>Q&amp;A about transcript</div>
                    </div>
                  </div>
                  {qaMessages.length > 0 && (
                    <button onClick={() => setQaMessages([])} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: 0 }}>Clear</button>
                  )}
                </div>

                {/* Suggestion chips */}
                {qaMessages.length === 0 && (
                  <div style={{ padding: '8px 10px', background: P.surface, borderBottom: `1px solid ${P.border}`, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {DEMO_CHIPS.map(chip => (
                      <button key={chip} onClick={() => askQuestion(chip)} style={{
                        padding: '4px 9px', borderRadius: 999, border: `1px solid ${P.border}`,
                        background: P.paper, fontSize: 11, color: P.muted, cursor: 'pointer', transition: 'all 0.15s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = P.accent; e.currentTarget.style.color = P.accent; e.currentTarget.style.background = P.accentLight; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = P.border; e.currentTarget.style.color = P.muted; e.currentTarget.style.background = P.paper; }}
                      >{chip}</button>
                    ))}
                  </div>
                )}

                {/* Chat messages */}
                {qaMessages.length > 0 && (
                  <div style={{ maxHeight: 260, overflowY: 'auto', background: P.surface, padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {qaMessages.map((msg, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '90%', padding: '8px 11px',
                          borderRadius: msg.role === 'user' ? '10px 10px 3px 10px' : '10px 10px 10px 3px',
                          background: msg.role === 'user' ? P.accent : (msg.isError ? 'rgba(180,35,24,0.06)' : P.paper),
                          border: msg.role === 'ai' ? `1px solid ${msg.isError ? 'rgba(180,35,24,0.2)' : P.border}` : 'none',
                          fontSize: 12.5, lineHeight: 1.6,
                          color: msg.role === 'user' ? 'white' : (msg.isError ? P.error : P.ink),
                        }}>{msg.text}</div>
                      </div>
                    ))}
                    {qaLoading && (
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <div style={{ padding: '8px 12px', borderRadius: '10px 10px 10px 3px', background: P.paper, border: `1px solid ${P.border}`, display: 'flex', gap: 4, alignItems: 'center' }}>
                          {[0, 1, 2].map(d => <div key={d} style={{ width: 5, height: 5, borderRadius: '50%', background: P.accent, opacity: 0.5, animation: `bounce 1.2s ease-in-out ${d * 0.2}s infinite` }} />)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Input row */}
                <div style={{ display: 'flex', gap: 6, padding: '8px 10px', background: P.paper, borderTop: `1px solid ${P.border}` }}>
                  <input ref={qaInputRef} value={qaQuestion} onChange={e => setQaQuestion(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && askQuestion()}
                    placeholder="Ask anything about this video…" disabled={qaLoading}
                    style={{ flex: 1, border: `1.5px solid ${P.border}`, borderRadius: 8, padding: '7px 11px', fontSize: 12, color: P.ink, background: P.surface, outline: 'none', transition: 'border-color 0.15s' }}
                    onFocus={e => { e.target.style.borderColor = P.accent; }}
                    onBlur={e => { e.target.style.borderColor = P.border; }}
                  />
                  <button onClick={() => askQuestion()} disabled={!qaQuestion.trim() || qaLoading} style={{
                    flexShrink: 0, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 8, border: 'none',
                    background: !qaQuestion.trim() || qaLoading ? P.border : P.accent,
                    color: !qaQuestion.trim() || qaLoading ? P.muted : 'white',
                    cursor: !qaQuestion.trim() || qaLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { if (qaQuestion.trim() && !qaLoading) e.currentTarget.style.background = P.accentHover; }}
                    onMouseLeave={e => { if (qaQuestion.trim() && !qaLoading) e.currentTarget.style.background = P.accent; }}
                  >
                    {qaLoading
                      ? <SpinnerIcon size={12} />
                      : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    }
                  </button>
                </div>
              </div>

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
    </>
  );
};

export default App;
