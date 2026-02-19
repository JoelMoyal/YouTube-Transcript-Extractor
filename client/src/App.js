import React, { useState, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractVideoId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    let id = url.searchParams.get('v');
    if (!id && url.hostname === 'youtu.be') id = url.pathname.slice(1).split('?')[0];
    if (!id) {
      const m = url.pathname.match(/\/(shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) id = m[2];
    }
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const DownloadIcon = ({ size = 15 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const ChevronIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const GlobeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

const GitHubIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

const SpinnerIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    style={{ animation: 'spin 0.8s linear infinite' }}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);

// ── Footer ────────────────────────────────────────────────────────────────────
const Footer = () => {
  const iconBtn = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, borderRadius: '50%',
    color: '#64748b', textDecoration: 'none',
    border: '1.5px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    transition: 'all 0.18s',
    flexShrink: 0,
  };
  return (
    <footer style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 24px',
      height: 56,
      background: 'rgba(10,15,30,0.97)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      zIndex: 50,
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.08))' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 28px', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>
            Built by
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.03em' }}>
            Joel Moyal
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, marginLeft: 4 }}>
          <a href="https://joelmoyal.com/" target="_blank" rel="noopener noreferrer"
            title="Website" style={iconBtn}
            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.transform = 'none'; }}
          >
            <GlobeIcon />
          </a>
          <a href="https://github.com/joelmoyal" target="_blank" rel="noopener noreferrer"
            title="GitHub" style={iconBtn}
            onMouseEnter={e => { e.currentTarget.style.color = '#f1f5f9'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.transform = 'none'; }}
          >
            <GitHubIcon />
          </a>
        </div>
      </div>

      <div style={{ flex: 1, height: 1, background: 'linear-gradient(to left, transparent, rgba(255,255,255,0.08))' }} />
    </footer>
  );
};

// ── Main App ──────────────────────────────────────────────────────────────────
const App = () => {
  const [videoUrl, setVideoUrl]           = useState('');
  const [lang, setLang]                   = useState('en');
  const [previewId, setPreviewId]         = useState(null);
  const [transcript, setTranscript]       = useState('');
  const [segments, setSegments]           = useState([]);
  const [transcriptSource, setTranscriptSource] = useState('');
  const [currentVideoId, setCurrentVideoId] = useState(null);
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
  const [showHistory, setShowHistory]     = useState(false);
  const [summary, setSummary]             = useState('');
  const [summarizing, setSummarizing]     = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);

  const downloadMenuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target))
        setShowDownloadMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Auto-paste YouTube URL from clipboard on input focus
  const handleInputFocus = async () => {
    if (videoUrl) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text && (text.includes('youtube.com') || text.includes('youtu.be'))) {
        const cleaned = text.trim();
        setVideoUrl(cleaned);
        setPreviewId(extractVideoId(cleaned));
      }
    } catch {} // clipboard permission denied — ignore silently
  };

  const handleUrlChange = (e) => {
    const val = e.target.value;
    setVideoUrl(val);
    setPreviewId(extractVideoId(val));
  };

  const saveToHistory = (entry) => {
    setHistory(prev => {
      const next = [entry, ...prev.filter(h => h.id !== entry.id)].slice(0, 10);
      localStorage.setItem('yte_history', JSON.stringify(next));
      return next;
    });
  };

  const deleteFromHistory = (id, e) => {
    e.stopPropagation();
    setHistory(prev => {
      const next = prev.filter(h => h.id !== id);
      localStorage.setItem('yte_history', JSON.stringify(next));
      return next;
    });
  };

  const loadFromHistory = (entry) => {
    setVideoUrl(`https://youtube.com/watch?v=${entry.id}`);
    setPreviewId(entry.id);
    setTranscript(entry.transcript);
    setSegments(entry.segments || []);
    setTranscriptSource(entry.source || '');
    setCurrentVideoId(entry.id);
    setError('');
    setSearch('');
    setShowHistory(false);
  };

  const getTranscript = () => {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) { setError('Invalid YouTube URL'); return; }

    setError(''); setTranscript(''); setTranscriptSource('');
    setSegments([]); setCurrentVideoId(null); setSearch('');
    setLoading(true); setLoadingMsg('Looking for subtitles…');
    setLoadingPercent(5); setLoadingStage('subtitles');

    const es = new EventSource(`/api/transcript?videoId=${videoId}&lang=${lang}`);

    // 3-minute hard timeout
    const killTimer = setTimeout(() => {
      es.close();
      setError('Request timed out. The video may be too long or unavailable.');
      setLoading(false); setLoadingMsg(''); setLoadingPercent(0); setLoadingStage('');
    }, 180000);

    es.addEventListener('progress', (e) => {
      const { message, percent, stage } = JSON.parse(e.data);
      setLoadingMsg(message);
      setLoadingPercent(percent || 0);
      setLoadingStage(stage || '');
    });

    es.addEventListener('done', (e) => {
      clearTimeout(killTimer);
      es.close();
      const data = JSON.parse(e.data);
      setTranscript(data.transcript);
      setSegments(data.segments || []);
      setTranscriptSource(data.source || '');
      setCurrentVideoId(videoId);
      setLoadingPercent(100);
      saveToHistory({
        id: videoId,
        transcript: data.transcript,
        segments: data.segments || [],
        source: data.source || '',
        date: new Date().toISOString(),
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      });
      setLoading(false); setLoadingMsg(''); setLoadingPercent(0); setLoadingStage('');
    });

    es.addEventListener('error', (e) => {
      clearTimeout(killTimer);
      es.close();
      try {
        const data = JSON.parse(e.data);
        setError(data.details ? `${data.error}: ${data.details}` : (data.error || 'Failed to fetch transcript'));
      } catch {
        setError('Connection lost. Please try again.');
      }
      setLoading(false); setLoadingMsg(''); setLoadingPercent(0); setLoadingStage('');
    });

    // EventSource onerror fires on network errors
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return; // already handled
      clearTimeout(killTimer);
      es.close();
      setError('Connection lost. Please try again.');
      setLoading(false); setLoadingMsg(''); setLoadingPercent(0); setLoadingStage('');
    };
  };

  const downloadTxt = () => {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([transcript], { type: 'text/plain' })),
      download: 'transcript.txt',
    });
    a.click(); URL.revokeObjectURL(a.href);
    setShowDownloadMenu(false);
  };

  const downloadPdf = () => {
    const doc = new jsPDF();
    const m = 15;
    doc.setFontSize(12);
    doc.text(doc.splitTextToSize(transcript, doc.internal.pageSize.getWidth() - m * 2), m, m);
    doc.save('transcript.pdf');
    setShowDownloadMenu(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(transcript).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  const copyAsMarkdown = () => {
    let md;
    if (segments.length > 0) {
      md = segments
        .map(s => `**[${formatTime(s.seconds)}](https://youtube.com/watch?v=${currentVideoId}&t=${s.seconds}s)** ${s.text}`)
        .join('\n\n');
    } else {
      md = transcript;
    }
    navigator.clipboard.writeText(md).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
    setShowDownloadMenu(false);
  };

  const summarize = async () => {
    setSummarizing(true); setSummary('');
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch {
        throw new Error(res.ok ? 'Unexpected server response' : `Server error ${res.status}`);
      }
      if (!res.ok) throw new Error(data.error || 'Failed to summarize');
      setSummary(data.summary);
    } catch (err) {
      setSummary(`Error: ${err.message}`);
    } finally {
      setSummarizing(false);
    }
  };

  const highlightText = (text) => {
    if (!search.trim()) return text;
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part)
        ? <mark key={i} style={{ background: '#fef08a', borderRadius: 2, padding: '0 1px' }}>{part}</mark>
        : part
    );
  };

  const wordCount = transcript ? transcript.trim().split(/\s+/).length : 0;
  const readingMins = wordCount > 0 ? Math.max(1, Math.round(wordCount / 200)) : 0;
  const isShortTranscript = transcript && wordCount < 50;
  const matchCount = search.trim() && transcript
    ? (transcript.match(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
    : 0;

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fadeUp 0.35s ease forwards; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
      `}</style>

      {/* Dark page background */}
      <div className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center py-16 px-4 pb-24"
        style={{ background: 'linear-gradient(135deg, #0a0f1e 0%, #111827 50%, #0d1117 100%)' }}>

        {/* Decorative blobs */}
        <div style={{ position:'absolute', top:-80, right:-80, width:360, height:360,
          borderRadius:'50%', background:'radial-gradient(circle, rgba(239,68,68,0.18) 0%, transparent 70%)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:-60, left:-60, width:280, height:280,
          borderRadius:'50%', background:'radial-gradient(circle, rgba(99,102,241,0.14) 0%, transparent 70%)', pointerEvents:'none' }} />

        {/* Card */}
        <div className="w-full max-w-lg relative" style={{ animation: 'fadeUp 0.4s ease' }}>
          <div className="bg-white rounded-3xl overflow-hidden"
            style={{ boxShadow: '0 30px 90px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.06) inset' }}>

            {/* Card top accent bar */}
            <div style={{ height: 4, background: 'linear-gradient(90deg, #ef4444, #f97316)' }} />

            <div className="p-8">
              {/* ── Header ── */}
              <div className="flex items-center gap-4 mb-8">
                <div style={{
                  width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                  background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(239,68,68,0.35)',
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                </div>
                <div>
                  <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                    Transcript Extractor
                  </h1>
                  <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 2, fontWeight: 500 }}>
                    Extract any YouTube video transcript instantly
                  </p>
                </div>
              </div>

              {/* ── Form ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* URL input */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                    YouTube URL
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'#cbd5e1', pointerEvents:'none' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                      </svg>
                    </span>
                    <input
                      type="text"
                      value={videoUrl}
                      onChange={handleUrlChange}
                      onFocus={(e) => {
                        handleInputFocus();
                        e.target.style.borderColor = '#ef4444';
                        e.target.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.1)';
                        e.target.style.background = '#fff';
                      }}
                      onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#f8fafc'; }}
                      onKeyDown={e => e.key === 'Enter' && !loading && getTranscript()}
                      placeholder="https://youtube.com/watch?v=…"
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '11px 14px 11px 38px',
                        fontSize: 14, color: '#0f172a',
                        border: '1.5px solid #e2e8f0', borderRadius: 12,
                        outline: 'none', background: '#f8fafc',
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                    />
                  </div>

                  {/* Video preview thumbnail */}
                  {previewId && !transcript && !loading && (
                    <div className="fade-up" style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', border: '1.5px solid #e2e8f0', position: 'relative' }}>
                      <img
                        src={`https://img.youtube.com/vi/${previewId}/mqdefault.jpg`}
                        alt="Video preview"
                        style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover' }}
                        onError={e => { e.target.parentElement.style.display = 'none'; }}
                      />
                      <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.55) 100%)' }} />
                      <div style={{ position:'absolute', bottom:8, left:10, fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>
                        {previewId}
                      </div>
                    </div>
                  )}
                </div>

                {/* Language select */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                    Language
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'#cbd5e1', pointerEvents:'none' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                      </svg>
                    </span>
                    <select
                      value={lang}
                      onChange={e => setLang(e.target.value)}
                      style={{
                        width: '100%', boxSizing: 'border-box', appearance: 'none', WebkitAppearance: 'none',
                        padding: '11px 38px 11px 38px',
                        fontSize: 14, color: '#0f172a',
                        border: '1.5px solid #e2e8f0', borderRadius: 12,
                        outline: 'none', background: '#f8fafc', cursor: 'pointer',
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                      onFocus={e => { e.target.style.borderColor = '#ef4444'; e.target.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.1)'; e.target.style.background = '#fff'; }}
                      onBlur={e  => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#f8fafc'; }}
                    >
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                    <span style={{ position:'absolute', right:14, top:'50%', transform:'translateY(-50%)', color:'#94a3b8', pointerEvents:'none' }}>
                      <ChevronIcon />
                    </span>
                  </div>
                </div>

                {/* Submit button */}
                <button
                  onClick={getTranscript}
                  disabled={loading}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    width: '100%', padding: '13px 20px',
                    background: loading ? '#fca5a5' : 'linear-gradient(135deg, #ef4444, #dc2626)',
                    color: 'white', border: 'none', borderRadius: 12,
                    fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                    letterSpacing: '-0.01em',
                    boxShadow: loading ? 'none' : '0 4px 14px rgba(239,68,68,0.4)',
                    transition: 'opacity 0.15s, box-shadow 0.15s, transform 0.1s',
                  }}
                  onMouseEnter={e => { if (!loading) { e.currentTarget.style.boxShadow='0 6px 20px rgba(239,68,68,0.5)'; e.currentTarget.style.transform='translateY(-1px)'; }}}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow='0 4px 14px rgba(239,68,68,0.4)'; e.currentTarget.style.transform='translateY(0)'; }}
                >
                  {loading ? (
                    <><SpinnerIcon /><span style={{ fontSize: 13, fontWeight: 500 }}>{loadingMsg || 'Loading…'}</span></>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                      Extract Transcript
                    </>
                  )}
                </button>
              </div>

              {/* ── Progress bar ── */}
              {loading && loadingPercent > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['subtitles', 'audio', 'whisper'].map((stage) => {
                        const labels = { subtitles: 'Subtitles', audio: 'Audio', whisper: 'AI' };
                        const stageOrder = ['subtitles', 'audio', 'whisper'];
                        const currentIdx = stageOrder.indexOf(loadingStage);
                        const thisIdx = stageOrder.indexOf(stage);
                        const isDone = thisIdx < currentIdx;
                        const isActive = stage === loadingStage;
                        return (
                          <span key={stage} style={{
                            fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                            padding: '2px 7px', borderRadius: 999,
                            background: isDone ? '#dcfce7' : isActive ? '#fef2f2' : '#f1f5f9',
                            color: isDone ? '#16a34a' : isActive ? '#ef4444' : '#94a3b8',
                            transition: 'all 0.3s',
                          }}>
                            {isDone ? '✓ ' : ''}{labels[stage]}
                          </span>
                        );
                      })}
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{loadingPercent}%</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${loadingPercent}%`,
                      background: 'linear-gradient(90deg, #ef4444, #f97316)',
                      borderRadius: 999,
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                </div>
              )}

              {/* ── Error ── */}
              {error && (
                <div className="fade-up" style={{
                  marginTop: 16, padding: '12px 16px',
                  background: '#fef2f2', border: '1px solid #fecaca',
                  borderRadius: 12, fontSize: 13, color: '#dc2626',
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <svg style={{ flexShrink: 0, marginTop: 1 }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span style={{ flex: 1 }}>{error}</span>
                  <button
                    onClick={getTranscript}
                    style={{ flexShrink: 0, border: '1px solid #fca5a5', background: 'white', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* ── Transcript result ── */}
              {transcript && (
                <div className="fade-up" style={{ marginTop: 24 }}>

                  {/* Hero thumbnail */}
                  {currentVideoId && (
                    <a href={`https://youtube.com/watch?v=${currentVideoId}`} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'block', marginBottom: 12, borderRadius: 12, overflow: 'hidden', border: '1.5px solid #e2e8f0', textDecoration: 'none', position: 'relative' }}>
                      <img
                        src={`https://img.youtube.com/vi/${currentVideoId}/mqdefault.jpg`}
                        alt="Video thumbnail"
                        style={{ width: '100%', display: 'block' }}
                      />
                      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <div style={{ width:44, height:44, borderRadius:'50%', background:'rgba(0,0,0,0.65)', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </div>
                      </div>
                    </a>
                  )}

                  {/* Short transcript warning */}
                  {isShortTranscript && (
                    <div className="fade-up" style={{
                      marginBottom: 12, padding: '8px 12px',
                      background: '#fffbeb', border: '1px solid #fde68a',
                      borderRadius: 8, fontSize: 12, color: '#92400e',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                      Transcript is very short — subtitle coverage may be limited.
                    </div>
                  )}

                  {/* Result card */}
                  <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>

                    {/* Result header */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 16px',
                      background: '#f8fafc',
                      borderBottom: '1px solid #e2e8f0',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Transcript</span>
                        {transcriptSource === 'whisper' && (
                          <span style={{ padding: '2px 8px', fontSize: 11, fontWeight: 600, background: '#f3e8ff', color: '#7c3aed', borderRadius: 999 }}>AI generated</span>
                        )}
                        {transcriptSource === 'subtitles' && (
                          <span style={{ padding: '2px 8px', fontSize: 11, fontWeight: 600, background: '#dcfce7', color: '#16a34a', borderRadius: 999 }}>From subtitles</span>
                        )}
                        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{wordCount.toLocaleString()} words</span>
                        <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 500 }}>·</span>
                        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>~{readingMins} min read</span>
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        {/* Summarize */}
                        <button
                          onClick={summarize}
                          disabled={summarizing}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '5px 10px', borderRadius: 8, border: '1px solid #e2e8f0',
                            background: summarizing ? '#f5f3ff' : 'white', cursor: summarizing ? 'not-allowed' : 'pointer',
                            fontSize: 12, fontWeight: 600, color: '#7c3aed',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => { if (!summarizing) e.currentTarget.style.background = '#f5f3ff'; }}
                          onMouseLeave={e => { if (!summarizing) e.currentTarget.style.background = 'white'; }}
                        >
                          {summarizing ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                          )}
                          {summarizing ? 'Summarizing…' : 'Summarize'}
                        </button>

                        {/* Copy */}
                        <button
                          onClick={copyToClipboard}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '5px 10px', borderRadius: 8, border: '1px solid #e2e8f0',
                            background: copied ? '#f0fdf4' : 'white', cursor: 'pointer',
                            fontSize: 12, fontWeight: 600,
                            color: copied ? '#16a34a' : '#475569',
                            transition: 'all 0.15s',
                          }}
                        >
                          {copied ? <CheckIcon /> : <CopyIcon />}
                          {copied ? 'Copied!' : 'Copy'}
                        </button>

                        {/* Download dropdown */}
                        <div style={{ position: 'relative' }} ref={downloadMenuRef}>
                          <button
                            onClick={() => setShowDownloadMenu(v => !v)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              padding: '5px 10px', borderRadius: 8, border: 'none',
                              background: showDownloadMenu ? '#0f172a' : '#1e293b',
                              color: 'white', cursor: 'pointer',
                              fontSize: 12, fontWeight: 600,
                              transition: 'background 0.15s',
                              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                            }}
                          >
                            <DownloadIcon size={13} />
                            Download
                            <span style={{ opacity: 0.6, marginLeft: -2 }}><ChevronIcon /></span>
                          </button>

                          {showDownloadMenu && (
                            <div className="fade-up" style={{
                              position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                              width: 188, background: 'white',
                              border: '1px solid #e2e8f0', borderRadius: 12,
                              boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                              overflow: 'hidden', zIndex: 20,
                            }}>
                              {[
                                { label: 'Save as TXT', sub: 'Plain text file', color: '#64748b', fn: downloadTxt },
                                { label: 'Save as PDF', sub: 'Formatted document', color: '#ef4444', fn: downloadPdf },
                                { label: 'Copy as Markdown', sub: 'With timestamps', color: '#7c3aed', fn: copyAsMarkdown },
                              ].map((item, i) => (
                                <React.Fragment key={item.label}>
                                  {i > 0 && <div style={{ height: 1, background: '#f1f5f9' }} />}
                                  <button onClick={item.fn} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    width: '100%', padding: '10px 14px',
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    textAlign: 'left', transition: 'background 0.1s',
                                  }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                  >
                                    <span style={{ color: item.color }}><DownloadIcon size={14} /></span>
                                    <div>
                                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{item.label}</div>
                                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{item.sub}</div>
                                    </div>
                                  </button>
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Search bar */}
                    <div style={{ padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search transcript…"
                        style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 12, color: '#334155' }}
                      />
                      {search && matchCount > 0 && (
                        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, whiteSpace: 'nowrap' }}>{matchCount} match{matchCount !== 1 ? 'es' : ''}</span>
                      )}
                      {search && (
                        <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, fontSize: 18, lineHeight: 1 }}>×</button>
                      )}
                    </div>

                    {/* Transcript text */}
                    <div style={{
                      padding: '16px', maxHeight: 320, overflowY: 'auto',
                      fontSize: 13.5, lineHeight: 1.75, color: '#334155',
                      background: 'white',
                    }}>
                      {segments.length > 0 ? (
                        segments.map((seg, i) => (
                          <span key={i}>
                            <a
                              href={`https://youtube.com/watch?v=${currentVideoId}&t=${seg.seconds}s`}
                              target="_blank" rel="noopener noreferrer"
                              title={`Jump to ${formatTime(seg.seconds)}`}
                              style={{ color: '#ef4444', fontWeight: 700, fontSize: 11, marginRight: 5, textDecoration: 'none', fontFamily: 'monospace', letterSpacing: '-0.02em', flexShrink: 0 }}
                            >
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
                    <div className="fade-up" style={{ marginTop: 12, border: '1.5px solid #e9d5ff', borderRadius: 14, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f5f3ff', borderBottom: '1px solid #e9d5ff' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed' }}>AI Summary</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => { navigator.clipboard.writeText(summary).then(() => { setSummaryCopied(true); setTimeout(() => setSummaryCopied(false), 2000); }); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #e9d5ff', background: summaryCopied ? '#ede9fe' : 'white', cursor: 'pointer', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600, color: summaryCopied ? '#7c3aed' : '#a78bfa', transition: 'all 0.15s' }}
                          >
                            {summaryCopied ? <CheckIcon /> : <CopyIcon />}
                            {summaryCopied ? 'Copied!' : 'Copy'}
                          </button>
                          <button onClick={() => setSummary('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#a78bfa', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
                        </div>
                      </div>
                      <div style={{ padding: '14px 16px', background: 'white', fontSize: 13, lineHeight: 1.75, color: '#334155', whiteSpace: 'pre-wrap' }}>
                        {summary}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── History panel ── */}
          {history.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={() => setShowHistory(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, padding: '7px 14px',
                  color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#f1f5f9'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#94a3b8'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                {showHistory ? 'Hide' : 'Recent transcripts'} ({history.length})
                <span style={{ opacity: 0.5, transform: showHistory ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><ChevronIcon /></span>
              </button>

              {showHistory && (
                <div className="fade-up" style={{
                  marginTop: 8,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 14, overflow: 'hidden',
                }}>
                  {history.map((h, i) => (
                    <React.Fragment key={h.id}>
                      {i > 0 && <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />}
                      <button
                        onClick={() => loadFromHistory(h)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          width: '100%', padding: '12px 16px',
                          background: 'none', border: 'none', cursor: 'pointer',
                          textAlign: 'left', transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <img
                          src={h.thumbnail} alt=""
                          style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>{h.id}</div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                            {h.source === 'whisper' ? '🤖 AI' : '📝 Subtitles'} · {new Date(h.date).toLocaleDateString()} · {h.transcript.trim().split(/\s+/).length.toLocaleString()} words
                          </div>
                        </div>
                        <button
                          onClick={(e) => deleteFromHistory(h.id, e)}
                          title="Remove from history"
                          style={{ flexShrink: 0, border: 'none', background: 'none', cursor: 'pointer', color: '#475569', fontSize: 16, lineHeight: 1, padding: '4px 6px', borderRadius: 6, transition: 'all 0.1s' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.background = 'none'; }}
                        >×</button>
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Footer />
    </>
  );
};

export default App;
