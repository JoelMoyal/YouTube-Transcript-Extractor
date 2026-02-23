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
        redirectTo: getAuthRedirectUrl(),
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
            <div style={{ fontSize: 13, color: P.muted, marginBottom: 20 }}>Choose a new password for your account.</div>
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
  // Keep the dashboard on the updated ScribeSnap brand palette
  const P = {
    paper:       '#F6F2EA',
    surface:     '#FBF7F0',
    border:      '#E5DDCF',
    ink:         '#1D1D1F',
    muted:       '#5A5960',
    accent:      '#3C8CFF',
    accentHover: '#1F6BFF',
    accentLight: 'rgba(123,211,255,0.22)',
    success:     '#0F766E',
    warning:     '#B45309',
    error:       '#B42318',
  };

  const [tab, setTab] = React.useState('overview');
  const used      = credits?.used ?? 0;
  const tierMax   = CREDITS_MAX; // Dashboard is only for signed-in users
  const resetAt   = credits?.resetAt ?? (Date.now() + CREDITS_PERIOD_MS);
  const daysLeft  = Math.max(0, Math.ceil((resetAt - Date.now()) / 86400000));
  const pct       = Math.min(100, (used / tierMax) * 100);
  const memberSince = user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—';
  const initial   = (user.email || '?')[0].toUpperCase();

  const tabStyle = (active) => ({
    padding: '8px 18px', borderRadius: 8, border: 'none',
    background: active ? P.surface : 'transparent',
    color: active ? P.ink : P.muted,
    fontSize: 13, fontWeight: active ? 600 : 400,
    cursor: 'pointer', transition: 'all 0.15s',
    boxShadow: active ? '0 1px 4px rgba(28,25,23,0.08)' : 'none',
  });

  const ytCount = history.filter(h => (h.platform || 'youtube') === 'youtube').length;
  const viCount = history.filter(h => h.platform === 'vimeo').length;

  return (
    <div style={{ minHeight: '100vh', background: P.paper, paddingTop: 56 }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px 60px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <button onClick={onBack} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, color: P.muted, padding: 0, transition: 'color 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.color = P.ink; }}
            onMouseLeave={e => { e.currentTarget.style.color = P.muted; }}
          >
            <ChevronIcon size={13} dir="left" /> Back
          </button>
          <div style={{ flex: 1 }} />
        </div>

        {/* Profile hero */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 18, marginBottom: 32,
          padding: '24px 28px', background: P.surface,
          border: `1px solid ${P.border}`, borderRadius: 18,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: P.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 700, color: 'white', flexShrink: 0,
          }}>{initial}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: P.ink, marginBottom: 3 }}>
              {user.user_metadata?.username || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0]}
            </div>
            <div style={{ fontSize: 13, color: P.muted }}>{user.email}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Member since</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: P.ink }}>{memberSince}</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 28, background: P.paper, borderRadius: 10, padding: 3, border: `1px solid ${P.border}`, width: 'fit-content' }}>
          {[['overview', 'Overview'], ['history', 'History'], ['settings', 'Settings']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={tabStyle(tab === key)}>{label}</button>
          ))}
        </div>

        {/* ── Overview tab ────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              {[
                { label: 'Credits used', value: `${used} / ${tierMax}`, sub: `Resets in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`, color: used >= tierMax * 0.8 ? P.warning : P.accent },
                { label: 'Total transcripts', value: history.length, sub: 'All time', color: P.success },
                { label: 'YouTube', value: ytCount, sub: 'videos', color: PLATFORM_BRAND.youtube.stat },
                { label: 'Vimeo', value: viCount, sub: 'videos', color: PLATFORM_BRAND.vimeo.stat },
              ].map(stat => (
                <div key={stat.label} style={{ padding: '18px 20px', background: P.surface, border: `1px solid ${P.border}`, borderRadius: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{stat.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: stat.color, letterSpacing: '-0.02em', marginBottom: 2 }}>{stat.value}</div>
                  <div style={{ fontSize: 12, color: P.muted }}>{stat.sub}</div>
                </div>
              ))}
            </div>

            {/* Credits bar card */}
            <div style={{ padding: '20px 22px', background: P.surface, border: `1px solid ${P.border}`, borderRadius: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: P.ink }}>Weekly credit usage</div>
                <div style={{ fontSize: 12, color: P.muted }}>Resets in <strong style={{ color: P.ink }}>{daysLeft}d</strong></div>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: P.border, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: pct > 80 ? P.warning : P.accent, transition: 'width 0.5s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <div style={{ fontSize: 12, color: P.muted }}><strong style={{ color: P.ink }}>{used}</strong> used</div>
                <div style={{ fontSize: 12, color: P.muted }}><strong style={{ color: P.ink }}>{Math.max(0, tierMax - used)}</strong> remaining</div>
              </div>
            </div>

            {/* Recent transcripts preview */}
            {history.length > 0 && (
              <div style={{ padding: '20px 22px', background: P.surface, border: `1px solid ${P.border}`, borderRadius: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: P.ink, marginBottom: 14 }}>Recent transcripts</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {history.slice(0, 4).map(h => {
                    const displayTitle = h.title || h.id;
                    const displayChannel = h.channel || (h.platform === 'vimeo' ? 'Vimeo' : 'YouTube');
                    return (
                    <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: `1px solid ${P.border}`, background: P.paper }}>
                      <div style={{ width: 28, height: 28, borderRadius: 7, background: h.platform === 'vimeo' ? PLATFORM_BRAND.vimeo.bg : PLATFORM_BRAND.youtube.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {h.platform === 'vimeo' ? <VimeoIcon size={14} /> : <YouTubeIcon />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: P.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayTitle}</div>
                        <div style={{ fontSize: 11, color: P.muted }}>{displayChannel} · {timeAgo(h.date)}</div>
                      </div>
                      <button onClick={() => { onLoadTranscript(h); onBack(); }}
                        style={{ fontSize: 12, color: P.accent, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6, transition: 'all 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = P.accentLight; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                      >Open →</button>
                    </div>
                  )})}
                </div>
                {history.length > 4 && (
                  <button onClick={() => setTab('history')} style={{ marginTop: 12, fontSize: 12, color: P.muted, background: 'none', border: 'none', cursor: 'pointer' }}>
                    View all {history.length} transcripts →
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── History tab ─────────────────────────────────────────────────── */}
        {tab === 'history' && (
          <div>
            {history.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: P.muted }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: P.ink, marginBottom: 6 }}>No transcripts yet</div>
                <div style={{ fontSize: 13 }}>Extract your first transcript to see it here.</div>
                <button onClick={onBack} style={{ marginTop: 16, padding: '9px 20px', borderRadius: 10, border: 'none', background: P.accent, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Extract a transcript</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {history.map(h => {
                  const wc = h.transcript ? h.transcript.trim().split(/\s+/).length : 0;
                  const displayTitle = h.title || h.id;
                  const displayChannel = h.channel || (h.platform === 'vimeo' ? 'Vimeo' : 'YouTube');
                  return (
                    <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: P.surface, border: `1px solid ${P.border}`, borderRadius: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 9, background: h.platform === 'vimeo' ? PLATFORM_BRAND.vimeo.bgSoft : PLATFORM_BRAND.youtube.bgSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {h.platform === 'vimeo' ? <VimeoIcon size={16} /> : <YouTubeIcon />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: P.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{displayTitle}</div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <span style={{ fontSize: 12, color: P.muted }}>{displayChannel}</span>
                          <span style={{ fontSize: 12, color: P.muted }}>{timeAgo(h.date)}</span>
                          {wc > 0 && <span style={{ fontSize: 12, color: P.muted }}>· {wc.toLocaleString()} words</span>}
                          {h.source && <span style={{ fontSize: 12, color: P.muted }}>· {h.source}</span>}
                        </div>
                      </div>
                      <button onClick={() => { onLoadTranscript(h); onBack(); }}
                        style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${P.border}`, background: P.paper, fontSize: 12, fontWeight: 600, color: P.ink, cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0 }}
                        onMouseEnter={e => { e.currentTarget.style.background = P.accent; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = P.accent; }}
                        onMouseLeave={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; e.currentTarget.style.borderColor = P.border; }}
                      >Open</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Settings tab ────────────────────────────────────────────────── */}
        {tab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 500 }}>
            {/* Account info */}
            <div style={{ padding: '20px 22px', background: P.surface, border: `1px solid ${P.border}`, borderRadius: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: P.ink, marginBottom: 14 }}>Account</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: P.muted }}>Email</span>
                  <span style={{ fontSize: 13, color: P.ink, fontWeight: 500 }}>{user.email}</span>
                </div>
                <div style={{ height: 1, background: P.border }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: P.muted }}>Member since</span>
                  <span style={{ fontSize: 13, color: P.ink, fontWeight: 500 }}>{memberSince}</span>
                </div>
              </div>
            </div>

            {/* Security */}
            <div style={{ padding: '20px 22px', background: P.surface, border: `1px solid ${P.border}`, borderRadius: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: P.ink, marginBottom: 14 }}>Security</div>
              <button onClick={onChangePassword}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${P.border}`, background: P.paper, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = P.accentLight; e.currentTarget.style.borderColor = P.accent; }}
                onMouseLeave={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.borderColor = P.border; }}
              >
                <span style={{ fontSize: 13, fontWeight: 500, color: P.ink }}>Change password</span>
                <ChevronIcon size={13} dir="right" />
              </button>
            </div>

            {/* Danger zone */}
            <div style={{ padding: '20px 22px', background: P.surface, border: `1px solid rgba(180,35,24,0.2)`, borderRadius: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: P.error, marginBottom: 14 }}>Sign out</div>
              <button onClick={onSignOut}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, border: `1px solid rgba(180,35,24,0.2)`, background: 'rgba(180,35,24,0.04)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: P.error, transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(180,35,24,0.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(180,35,24,0.04)'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Sign out of account
              </button>
            </div>
          </div>
        )}
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

  const downloadMenuRef = useRef(null);
  const qaInputRef      = useRef(null);
  const urlInputRef     = useRef(null);
  const qaRef           = useRef(null);

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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { setShowPasswordReset(true); return; }
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
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
    setError(''); setSearch('');
  };

  const resetAll = () => {
    setVideoUrl(''); setTranscript(''); setSegments([]);
    setTranscriptSource(''); setCurrentVideoId(null); setCurrentPlatform('youtube'); setCurrentThumbnail(null); setError(''); setSearch('');
    setSummary(''); setShowTimestamps(true); setShowQA(false);
    setQaQuestion(''); setQaMessages([]);
    setChapters([]); setShowChapters(false);
    setQuotes([]); setShowQuotes(false);
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
            const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: getAuthRedirectUrl() });
            if (!error) alert('Password reset link sent to ' + user.email);
          }}
        />
      )}

      <div style={{ minHeight: '100vh', paddingTop: showBookmarkBanner ? 97 : 56, background: P.paper, transition: 'padding-top 0.3s ease', display: view === 'dashboard' ? 'none' : 'block' }}>

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
        {/* TRANSCRIPT VIEW */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {transcript && (
          <div className="fade-up" style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 32px' }}>

            {/* Back button */}
            <button
              onClick={resetAll}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                marginBottom: 20, border: `1px solid ${P.border}`,
                background: P.surface, borderRadius: 8,
                padding: '6px 12px', fontSize: 13, fontWeight: 600, color: P.muted,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; }}
              onMouseLeave={e => { e.currentTarget.style.background = P.surface; e.currentTarget.style.color = P.muted; }}
            >
              <ChevronIcon dir="left" size={12} />
              New search
            </button>

            {/* Video thumbnail */}
            {currentVideoId && (
              <a href={currentPlatform === 'vimeo' ? `https://vimeo.com/${currentVideoId}` : `https://youtube.com/watch?v=${currentVideoId}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: 'block', marginBottom: 16, borderRadius: 14, overflow: 'hidden', border: `1px solid ${P.border}`, textDecoration: 'none', position: 'relative' }}>
                {(currentThumbnail || currentPlatform === 'youtube') && (
                  <img
                    src={currentThumbnail || `https://img.youtube.com/vi/${currentVideoId}/mqdefault.jpg`}
                    alt="Video thumbnail"
                    style={{ width: '100%', display: 'block', maxHeight: 240, objectFit: 'cover' }}
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                )}
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background: 'rgba(28,25,23,0.15)' }}>
                  <div style={{ width:48, height:48, borderRadius:'50%', background:'rgba(28,25,23,0.65)', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}>
                    {currentPlatform === 'vimeo'
                      ? <VimeoIcon size={22} />
                      : <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
                  </div>
                </div>
                <div style={{ position:'absolute', bottom:10, left:14, display:'flex', alignItems:'center', gap:5, background:'rgba(28,25,23,0.5)', padding:'2px 8px', borderRadius:4 }}>
                  {currentPlatform === 'vimeo' ? <VimeoIcon size={11} /> : <YouTubeIcon />}
                  <span style={{ fontSize:11, fontFamily:'monospace', fontWeight:700, color:'rgba(255,255,255,0.9)' }}>{currentVideoId}</span>
                </div>
              </a>
            )}

            {/* Transcript card */}
            <div style={{ background: P.surface, border: `1px solid ${P.border}`, borderRadius: 16, overflow: 'hidden', marginBottom: 10 }}>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: P.paper, borderBottom: `1px solid ${P.border}`, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: P.ink }}>Transcript</span>
                  {transcriptSource === 'whisper' && (
                    <span style={{ padding: '2px 7px', fontSize: 10, fontWeight: 600, background: `rgba(107,100,92,0.1)`, color: P.muted, borderRadius: 999, border: `1px solid ${P.border}` }}>AI generated</span>
                  )}
                  {transcriptSource === 'subtitles' && (
                    <span style={{ padding: '2px 7px', fontSize: 10, fontWeight: 600, background: `rgba(15,118,110,0.1)`, color: P.success, borderRadius: 999, border: `1px solid rgba(15,118,110,0.2)` }}>From subtitles</span>
                  )}
                  <span style={{ fontSize: 11, color: P.muted }}>{wordCount.toLocaleString()} words · {charCount >= 1000 ? `${(charCount/1000).toFixed(1)}k` : charCount} chars · ~{readingMins} min read</span>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {/* Timestamps toggle */}
                  {segments.length > 0 && (
                    <button onClick={() => setShowTimestamps(v => !v)} style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 7,
                      border: `1px solid ${showTimestamps ? 'rgba(45,108,223,0.25)' : P.border}`,
                      background: showTimestamps ? P.accentLight : P.surface, cursor: 'pointer',
                      fontSize: 11, fontWeight: 600, color: showTimestamps ? P.accent : P.muted, transition: 'all 0.15s',
                    }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      {showTimestamps ? 'TS on' : 'TS off'}
                    </button>
                  )}
                  {/* Summarize */}
                  <button onClick={summarize} disabled={summarizing} style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 7,
                    border: `1px solid ${P.border}`, background: summarizing ? P.paper : P.surface,
                    cursor: summarizing ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 600, color: P.muted, transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { if (!summarizing) e.currentTarget.style.background = P.paper; }}
                    onMouseLeave={e => { if (!summarizing) e.currentTarget.style.background = P.surface; }}
                  >
                    {summarizing ? <SpinnerIcon size={11} /> : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
                    {summarizing ? 'Summarizing…' : 'Summarize'}
                  </button>
                  {/* Copy */}
                  <button onClick={copyToClipboard} style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 7,
                    border: `1px solid ${copied ? 'rgba(15,118,110,0.25)' : P.border}`,
                    background: copied ? 'rgba(15,118,110,0.07)' : P.surface,
                    cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    color: copied ? P.success : P.muted, transition: 'all 0.15s',
                  }}>
                    {copied ? <CheckIcon /> : <CopyIcon />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  {/* Download */}
                  <div style={{ position: 'relative' }} ref={downloadMenuRef}>
                    <button onClick={() => setShowDownloadMenu(v => !v)} style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 7,
                      border: 'none', background: P.ink, color: 'white', cursor: 'pointer',
                      fontSize: 11, fontWeight: 600, transition: 'background 0.15s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#2C2926'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = P.ink; }}
                    >
                      <DownloadIcon size={11} /> Download <span style={{ opacity: 0.5 }}><ChevronIcon size={11} /></span>
                    </button>
                    {showDownloadMenu && (
                      <div className="fade-up" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 182, background: P.surface, border: `1px solid ${P.border}`, borderRadius: 12, boxShadow: '0 8px 24px rgba(28,25,23,0.1)', overflow: 'hidden', zIndex: 20 }}>
                        {[
                          { label: 'Save as TXT', sub: 'Plain text file', fn: downloadTxt },
                          { label: 'Save as PDF', sub: 'Formatted document', fn: downloadPdf },
                          { label: 'Copy as Markdown', sub: 'With timestamps', fn: copyAsMarkdown },
                        ].map((item, i) => (
                          <React.Fragment key={item.label}>
                            {i > 0 && <div style={{ height: 1, background: P.border }} />}
                            <button onClick={item.fn} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s' }}
                              onMouseEnter={e => e.currentTarget.style.background = P.paper}
                              onMouseLeave={e => e.currentTarget.style.background = 'none'}
                            >
                              <span style={{ color: P.muted }}><DownloadIcon /></span>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: P.ink }}>{item.label}</div>
                                <div style={{ fontSize: 11, color: P.muted, marginTop: 1 }}>{item.sub}</div>
                              </div>
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Search */}
              <div style={{ padding: '7px 14px', background: P.paper, borderBottom: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search transcript…"
                  style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 12, color: P.ink }} />
                {search && matchCount > 0 && <span style={{ fontSize: 11, color: P.muted }}>{matchCount} match{matchCount !== 1 ? 'es' : ''}</span>}
                {search && <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>}
              </div>

              {/* Transcript text */}
              <div style={{ padding: '18px', maxHeight: 340, overflowY: 'auto', fontSize: 14, lineHeight: 1.85, color: P.ink, background: P.surface }}>
                {segments.length > 0 && showTimestamps ? (
                  segments.map((seg, i) => (
                    <span key={i}>
                      <a href={currentPlatform === 'vimeo' ? `https://vimeo.com/${currentVideoId}#t=${seg.seconds}s` : `https://youtube.com/watch?v=${currentVideoId}&t=${seg.seconds}s`} target="_blank" rel="noopener noreferrer"
                        title={`Jump to ${formatTime(seg.seconds)}`}
                        style={{ color: P.accent, fontWeight: 700, fontSize: 11, marginRight: 5, textDecoration: 'none', fontFamily: 'monospace' }}>
                        {formatTime(seg.seconds)}
                      </a>
                      {highlightText(seg.text)}{' '}
                    </span>
                  ))
                ) : (
                  <span>{highlightText(transcript)}</span>
                )}
              </div>
            </div>

            {/* AI Summary panel */}
            {summary && (
              <div className="fade-up" style={{ marginBottom: 10, border: `1px solid ${P.border}`, borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <span style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>AI Summary</span>
                    <span style={{ fontSize: 11, color: P.muted }}>· {summary.trim().split(/\s+/).length.toLocaleString()} words</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => { navigator.clipboard.writeText(summary).then(() => { setSummaryCopied(true); setTimeout(() => setSummaryCopied(false), 2000); }); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, border: `1px solid ${P.border}`, background: summaryCopied ? P.paper : P.surface, cursor: 'pointer', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600, color: summaryCopied ? P.success : P.muted, transition: 'all 0.15s' }}>
                      {summaryCopied ? <CheckIcon /> : <CopyIcon />} {summaryCopied ? 'Copied!' : 'Copy'}
                    </button>
                    <button onClick={() => setSummary('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                </div>
                <div style={{ padding: '16px 18px', background: P.surface, fontSize: 14, lineHeight: 1.8, color: P.ink, whiteSpace: 'pre-wrap' }}>{summary}</div>
              </div>
            )}

            {/* Chapters toggle */}
            {segments.length > 0 && (
              <button onClick={() => { if (!showChapters && chapters.length === 0) detectChapters(); else setShowChapters(v => !v); }}
                style={pillBtn(showChapters)}
                onMouseEnter={e => { if (!showChapters) { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; } }}
                onMouseLeave={e => { if (!showChapters) { e.currentTarget.style.background = P.surface; e.currentTarget.style.color = P.muted; } }}
              >
                {chaptersLoading ? <SpinnerIcon size={12} /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>}
                {chaptersLoading ? 'Detecting chapters…' : showChapters ? 'Hide Chapters' : 'Detect Chapters'}
                {!chaptersLoading && <span style={{ opacity: 0.4, transform: showChapters ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><ChevronIcon /></span>}
              </button>
            )}

            {/* Chapters panel */}
            {showChapters && chapters.length > 0 && (
              <div className="fade-up" style={{ marginTop: 8, marginBottom: 2, border: `1px solid ${P.border}`, borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    <span style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>Chapters</span>
                    <span style={{ fontSize: 11, color: P.muted }}>· {chapters.filter(c => !c.isError).length} detected · click to jump</span>
                  </div>
                  <button onClick={detectChapters} disabled={chaptersLoading} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: 0 }}>Refresh</button>
                </div>
                <div style={{ background: P.surface, padding: '6px 0' }}>
                  {chapters.map((ch, i) => (
                    ch.isError ? (
                      <div key={i} style={{ padding: '8px 16px', fontSize: 12, color: P.error }}>{ch.title}</div>
                    ) : (
                      <a key={i} href={`https://youtube.com/watch?v=${currentVideoId}&t=${ch.seconds}s`} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', textDecoration: 'none', transition: 'background 0.1s' }}
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
              </div>
            )}

            {/* Quotes toggle */}
            <button onClick={() => { if (!showQuotes && quotes.length === 0) extractQuotes(); else setShowQuotes(v => !v); }}
              style={pillBtn(showQuotes)}
              onMouseEnter={e => { if (!showQuotes) { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; } }}
              onMouseLeave={e => { if (!showQuotes) { e.currentTarget.style.background = P.surface; e.currentTarget.style.color = P.muted; } }}
            >
              {quotesLoading ? <SpinnerIcon size={12} /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>}
              {quotesLoading ? 'Extracting quotes…' : showQuotes ? 'Hide Key Quotes' : 'Extract Key Quotes'}
              {!quotesLoading && <span style={{ opacity: 0.4, transform: showQuotes ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><ChevronIcon /></span>}
            </button>

            {/* Quotes panel */}
            {showQuotes && quotes.length > 0 && (
              <div className="fade-up" style={{ marginTop: 8, marginBottom: 2, border: `1px solid ${P.border}`, borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
                    <span style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>Key Quotes</span>
                    <span style={{ fontSize: 11, color: P.muted }}>· {quotes.filter(q => !q.startsWith('Error:')).length} quotes</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => { navigator.clipboard.writeText(quotes.map(q => `"${q}"`).join('\n\n')).then(() => { setQuotesCopied(true); setTimeout(() => setQuotesCopied(false), 2000); }); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, border: `1px solid ${P.border}`, background: quotesCopied ? P.paper : P.surface, cursor: 'pointer', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600, color: quotesCopied ? P.success : P.muted, transition: 'all 0.15s' }}>
                      {quotesCopied ? <CheckIcon /> : <CopyIcon />} {quotesCopied ? 'Copied!' : 'Copy all'}
                    </button>
                    <button onClick={extractQuotes} disabled={quotesLoading} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: 0 }}>Refresh</button>
                  </div>
                </div>
                <div style={{ background: P.surface, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {quotes.map((q, i) => (
                    q.startsWith('Error:') ? (
                      <div key={i} style={{ fontSize: 12, color: P.error }}>{q}</div>
                    ) : (
                      <div key={i} style={{ position: 'relative', padding: '10px 14px 10px 20px', background: P.paper, borderRadius: 8, borderLeft: `3px solid ${P.border}`, fontSize: 14, lineHeight: 1.7, color: P.ink, fontStyle: 'italic' }}>
                        <span style={{ position: 'absolute', top: 6, left: -1, fontSize: 22, color: P.border, fontStyle: 'normal', lineHeight: 1 }}>"</span>
                        {q}
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}

            {/* Q&A toggle */}
            <button
              onClick={() => { setShowQA(v => !v); setTimeout(() => { qaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); qaInputRef.current?.focus(); }, 80); }}
              style={{
                ...pillBtn(showQA),
                border: `1px solid ${showQA ? 'rgba(45,108,223,0.25)' : P.border}`,
                background: showQA ? P.accentLight : P.surface,
                color: showQA ? P.accent : P.muted,
              }}
              onMouseEnter={e => { if (!showQA) { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; } }}
              onMouseLeave={e => { if (!showQA) { e.currentTarget.style.background = P.surface; e.currentTarget.style.color = P.muted; } }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {showQA ? 'Hide Q&A' : 'Ask AI about this transcript'}
              <span style={{ opacity: 0.4, transform: showQA ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><ChevronIcon /></span>
            </button>

            {/* Q&A panel */}
            {showQA && (
              <div ref={qaRef} className="fade-up" style={{ marginTop: 8, border: `1px solid rgba(45,108,223,0.2)`, borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 16px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  <span style={{ fontSize: 12, fontWeight: 700, color: P.accent }}>Ask AI</span>
                  <span style={{ fontSize: 11, color: P.muted }}>· answers based on this transcript only</span>
                  {qaMessages.length > 0 && (
                    <button onClick={() => setQaMessages([])} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: 0 }}>Clear</button>
                  )}
                </div>

                {/* Question chips in Q&A */}
                {qaMessages.length === 0 && (
                  <div style={{ padding: '12px 14px', background: P.surface, borderBottom: `1px solid ${P.border}`, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {DEMO_CHIPS.map(chip => (
                      <button key={chip} onClick={() => askQuestion(chip)} style={{
                        padding: '5px 12px', borderRadius: 999, border: `1px solid ${P.border}`,
                        background: P.paper, fontSize: 12, color: P.muted, cursor: 'pointer', transition: 'all 0.15s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = P.accent; e.currentTarget.style.color = P.accent; e.currentTarget.style.background = P.accentLight; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = P.border; e.currentTarget.style.color = P.muted; e.currentTarget.style.background = P.paper; }}
                      >{chip}</button>
                    ))}
                  </div>
                )}

                {/* Messages */}
                {qaMessages.length > 0 && (
                  <div style={{ maxHeight: 300, overflowY: 'auto', background: P.surface, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {qaMessages.map((msg, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '82%', padding: '9px 13px',
                          borderRadius: msg.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                          background: msg.role === 'user' ? P.accent : (msg.isError ? 'rgba(180,35,24,0.06)' : P.paper),
                          border: msg.role === 'ai' ? `1px solid ${msg.isError ? 'rgba(180,35,24,0.2)' : P.border}` : 'none',
                          fontSize: 13.5, lineHeight: 1.65,
                          color: msg.role === 'user' ? 'white' : (msg.isError ? P.error : P.ink),
                        }}>{msg.text}</div>
                      </div>
                    ))}
                    {qaLoading && (
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <div style={{ padding: '9px 14px', borderRadius: '12px 12px 12px 3px', background: P.paper, border: `1px solid ${P.border}`, display: 'flex', gap: 4, alignItems: 'center' }}>
                          {[0, 1, 2].map(d => <div key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: P.accent, opacity: 0.5, animation: `bounce 1.2s ease-in-out ${d * 0.2}s infinite` }} />)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Input */}
                <div style={{ display: 'flex', gap: 8, padding: '10px 12px', background: qaMessages.length > 0 ? P.paper : P.surface, borderTop: qaMessages.length > 0 ? `1px solid ${P.border}` : 'none' }}>
                  <input ref={qaInputRef} value={qaQuestion} onChange={e => setQaQuestion(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && askQuestion()}
                    placeholder="Ask anything about this video…" disabled={qaLoading}
                    style={{ flex: 1, border: `1.5px solid ${P.border}`, borderRadius: 9, padding: '9px 13px', fontSize: 13, color: P.ink, background: P.surface, outline: 'none', transition: 'border-color 0.15s' }}
                    onFocus={e => { e.target.style.borderColor = P.accent; }}
                    onBlur={e => { e.target.style.borderColor = P.border; }}
                  />
                  <button onClick={() => askQuestion()} disabled={!qaQuestion.trim() || qaLoading} style={{
                    flexShrink: 0, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 9, border: 'none',
                    background: !qaQuestion.trim() || qaLoading ? P.border : P.accent,
                    color: !qaQuestion.trim() || qaLoading ? P.muted : 'white',
                    cursor: !qaQuestion.trim() || qaLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { if (qaQuestion.trim() && !qaLoading) e.currentTarget.style.background = P.accentHover; }}
                    onMouseLeave={e => { if (qaQuestion.trim() && !qaLoading) e.currentTarget.style.background = P.accent; }}
                  >
                    {qaLoading
                      ? <SpinnerIcon size={14} />
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    }
                  </button>
                </div>
              </div>
            )}
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
