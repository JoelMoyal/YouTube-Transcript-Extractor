import React, { useState, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';

// ── Palette ────────────────────────────────────────────────────────────────────
const P = {
  paper:       '#F6F3EE',
  surface:     '#FFFEFC',
  border:      '#E7E1D8',
  ink:         '#1C1917',
  muted:       '#6B645C',
  accent:      '#2D6CDF',
  accentHover: '#2459B8',
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
    width: 30, height: 30, borderRadius: '50%',
    color: P.muted, textDecoration: 'none',
    border: `1px solid ${P.border}`,
    background: 'transparent',
    transition: 'all 0.18s',
    flexShrink: 0,
  };
  return (
    <footer style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 24px',
      height: 48,
      background: P.surface,
      borderTop: `1px solid ${P.border}`,
      zIndex: 50,
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${P.border})` }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: P.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>
            Built by
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: P.ink, letterSpacing: '-0.02em' }}>
            Joel Moyal
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, marginLeft: 4 }}>
          <a href="https://joelmoyal.com/" target="_blank" rel="noopener noreferrer"
            title="Website" style={iconBtn}
            onMouseEnter={e => { e.currentTarget.style.color = P.ink; e.currentTarget.style.borderColor = P.ink; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = P.muted; e.currentTarget.style.borderColor = P.border; e.currentTarget.style.transform = 'none'; }}
          >
            <GlobeIcon />
          </a>
          <a href="https://github.com/joelmoyal" target="_blank" rel="noopener noreferrer"
            title="GitHub" style={iconBtn}
            onMouseEnter={e => { e.currentTarget.style.color = P.ink; e.currentTarget.style.borderColor = P.ink; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = P.muted; e.currentTarget.style.borderColor = P.border; e.currentTarget.style.transform = 'none'; }}
          >
            <GitHubIcon />
          </a>
        </div>
      </div>

      <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${P.border})` }} />
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
  const qaInputRef = useRef(null);
  const resultRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target))
        setShowDownloadMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleInputFocus = async () => {
    if (videoUrl) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text && (text.includes('youtube.com') || text.includes('youtu.be'))) {
        const cleaned = text.trim();
        setVideoUrl(cleaned);
        setPreviewId(extractVideoId(cleaned));
      }
    } catch {}
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

  const resetAll = () => {
    setVideoUrl(''); setPreviewId(null); setTranscript(''); setSegments([]);
    setTranscriptSource(''); setCurrentVideoId(null); setError(''); setSearch('');
    setSummary(''); setShowTimestamps(true); setShowQA(false);
    setQaQuestion(''); setQaMessages([]);
    setChapters([]); setShowChapters(false);
    setQuotes([]); setShowQuotes(false);
  };

  const askQuestion = async () => {
    const q = qaQuestion.trim();
    if (!q || qaLoading) return;
    setQaMessages(prev => [...prev, { role: 'user', text: q }]);
    setQaQuestion('');
    setQaLoading(true);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    const videoId = extractVideoId(videoUrl);
    if (!videoId) { setError('Invalid YouTube URL'); return; }

    setError(''); setTranscript(''); setTranscriptSource('');
    setSegments([]); setCurrentVideoId(null); setSearch('');
    setLoading(true); setLoadingMsg('Looking for subtitles…');
    setLoadingPercent(5); setLoadingStage('subtitles');

    const es = new EventSource(`/api/transcript?videoId=${videoId}&lang=${lang}`);

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
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
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

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
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

  const detectChapters = async () => {
    if (chaptersLoading) return;
    setChaptersLoading(true); setChapters([]);
    try {
      const res = await fetch('/api/chapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, segments }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch {
        throw new Error(res.ok ? 'Unexpected server response' : `Server error ${res.status}`);
      }
      if (!res.ok) throw new Error(data.error || 'Failed to detect chapters');
      setChapters(data.chapters || []);
      setShowChapters(true);
    } catch (err) {
      setChapters([{ seconds: 0, title: `Error: ${err.message}`, isError: true }]);
      setShowChapters(true);
    } finally {
      setChaptersLoading(false);
    }
  };

  const extractQuotes = async () => {
    if (quotesLoading) return;
    setQuotesLoading(true); setQuotes([]);
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch {
        throw new Error(res.ok ? 'Unexpected server response' : `Server error ${res.status}`);
      }
      if (!res.ok) throw new Error(data.error || 'Failed to extract quotes');
      setQuotes(data.quotes || []);
      setShowQuotes(true);
    } catch (err) {
      setQuotes([`Error: ${err.message}`]);
      setShowQuotes(true);
    } finally {
      setQuotesLoading(false);
    }
  };

  const highlightText = (text) => {
    if (!search.trim()) return text;
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part)
        ? <mark key={i} style={{ background: '#FEF08A', borderRadius: 2, padding: '0 1px' }}>{part}</mark>
        : part
    );
  };

  const wordCount = transcript ? transcript.trim().split(/\s+/).length : 0;
  const charCount = transcript ? transcript.length : 0;
  const readingMins = wordCount > 0 ? Math.max(1, Math.round(wordCount / 200)) : 0;
  const isShortTranscript = transcript && wordCount < 50;
  const matchCount = search.trim() && transcript
    ? (transcript.match(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
    : 0;

  // shared style for secondary toggle buttons (chapters, quotes, Q&A, summarize)
  const toggleBtn = (active, activeColor = P.ink) => ({
    display: 'flex', alignItems: 'center', gap: 6,
    width: '100%', justifyContent: 'center',
    marginTop: 10,
    background: active ? P.paper : P.surface,
    border: `1px solid ${P.border}`,
    borderRadius: 10, padding: '8px 14px',
    color: active ? activeColor : P.muted,
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
    transition: 'all 0.15s',
  });

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes bounce { 0%,80%,100% { transform: scale(0.6); opacity:0.4; } 40% { transform: scale(1); opacity:1; } }
        .fade-up { animation: fadeUp 0.35s ease forwards; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${P.paper}; }
        ::-webkit-scrollbar-thumb { background: ${P.border}; border-radius: 3px; }
        body { background: ${P.paper}; }
      `}</style>

      {/* Page */}
      <div className="min-h-screen flex flex-col items-center justify-center py-16 px-4 pb-24"
        style={{ background: P.paper }}>

        {/* Card */}
        <div className="w-full max-w-lg relative" style={{ animation: 'fadeUp 0.4s ease' }}>
          <div style={{
            background: P.surface,
            borderRadius: 20,
            border: `1px solid ${P.border}`,
            boxShadow: '0 4px 24px rgba(28,25,23,0.07)',
            overflow: 'hidden',
          }}>

            {/* Top rule */}
            <div style={{ height: 3, background: P.ink }} />

            <div className="p-8">
              {/* ── Header ── */}
              <div className="flex items-center gap-4 mb-8">
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: '#FF0000',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                </div>
                <div>
                  <h1 style={{ fontSize: 19, fontWeight: 700, color: P.ink, letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                    Transcript Extractor
                  </h1>
                  <p style={{ fontSize: 13, color: P.muted, marginTop: 2 }}>
                    Extract any YouTube video transcript instantly
                  </p>
                </div>
              </div>

              {/* ── Form ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* URL input */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: P.muted, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    YouTube URL
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color: P.border, pointerEvents:'none' }}>
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
                        e.target.style.borderColor = P.accent;
                        e.target.style.boxShadow = `0 0 0 3px rgba(45,108,223,0.1)`;
                        e.target.style.background = P.surface;
                      }}
                      onBlur={e => { e.target.style.borderColor = P.border; e.target.style.boxShadow = 'none'; e.target.style.background = P.paper; }}
                      onKeyDown={e => e.key === 'Enter' && !loading && getTranscript()}
                      placeholder="https://youtube.com/watch?v=…"
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '10px 12px 10px 36px',
                        fontSize: 14, color: P.ink,
                        border: `1.5px solid ${P.border}`, borderRadius: 10,
                        outline: 'none', background: P.paper,
                        transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
                        fontFamily: 'system-ui, sans-serif',
                      }}
                    />
                  </div>

                  {/* Enter key hint */}
                  {previewId && !transcript && !loading && (
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <kbd style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '1px 5px', fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: P.muted, background: P.paper, border: `1px solid ${P.border}`, borderRadius: 4, boxShadow: `0 1px 0 ${P.border}` }}>↵ Enter</kbd>
                      <span style={{ fontSize: 11, color: P.muted }}>to extract</span>
                    </div>
                  )}

                  {/* Video preview thumbnail */}
                  {previewId && !transcript && !loading && (
                    <div className="fade-up" style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', border: `1px solid ${P.border}`, position: 'relative' }}>
                      <img
                        src={`https://img.youtube.com/vi/${previewId}/mqdefault.jpg`}
                        alt="Video preview"
                        style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover' }}
                        onError={e => { e.target.parentElement.style.display = 'none'; }}
                      />
                      <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom, transparent 40%, rgba(28,25,23,0.5) 100%)' }} />
                      <div style={{ position:'absolute', bottom:8, left:10, fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.85)', fontFamily:'monospace' }}>
                        {previewId}
                      </div>
                    </div>
                  )}
                </div>

                {/* Language select */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: P.muted, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Language
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color: P.border, pointerEvents:'none' }}>
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
                        padding: '10px 36px 10px 36px',
                        fontSize: 14, color: P.ink,
                        border: `1.5px solid ${P.border}`, borderRadius: 10,
                        outline: 'none', background: P.paper, cursor: 'pointer',
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                        fontFamily: 'system-ui, sans-serif',
                      }}
                      onFocus={e => { e.target.style.borderColor = P.accent; e.target.style.boxShadow = `0 0 0 3px rgba(45,108,223,0.1)`; e.target.style.background = P.surface; }}
                      onBlur={e  => { e.target.style.borderColor = P.border; e.target.style.boxShadow = 'none'; e.target.style.background = P.paper; }}
                    >
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                    <span style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', color: P.muted, pointerEvents:'none' }}>
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
                    width: '100%', padding: '12px 20px',
                    background: loading ? `rgba(45,108,223,0.5)` : P.accent,
                    color: 'white', border: 'none', borderRadius: 10,
                    fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                    letterSpacing: '-0.01em',
                    boxShadow: loading ? 'none' : '0 2px 8px rgba(45,108,223,0.3)',
                    transition: 'background 0.15s, box-shadow 0.15s, transform 0.1s',
                  }}
                  onMouseEnter={e => { if (!loading) { e.currentTarget.style.background = P.accentHover; e.currentTarget.style.transform = 'translateY(-1px)'; }}}
                  onMouseLeave={e => { e.currentTarget.style.background = loading ? `rgba(45,108,223,0.5)` : P.accent; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  {loading ? (
                    <><SpinnerIcon /><span style={{ fontSize: 13, fontWeight: 500 }}>{loadingMsg || 'Loading…'}</span></>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
                    <div style={{ display: 'flex', gap: 5 }}>
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
                            background: isDone ? 'rgba(15,118,110,0.1)' : isActive ? 'rgba(45,108,223,0.1)' : P.paper,
                            color: isDone ? P.success : isActive ? P.accent : P.muted,
                            border: `1px solid ${isDone ? 'rgba(15,118,110,0.2)' : isActive ? 'rgba(45,108,223,0.2)' : P.border}`,
                            transition: 'all 0.3s',
                          }}>
                            {isDone ? '✓ ' : ''}{labels[stage]}
                          </span>
                        );
                      })}
                    </div>
                    <span style={{ fontSize: 11, color: P.muted, fontWeight: 600 }}>{loadingPercent}%</span>
                  </div>
                  <div style={{ height: 3, borderRadius: 999, background: P.border, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${loadingPercent}%`,
                      background: P.accent,
                      borderRadius: 999,
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                </div>
              )}

              {/* ── Error ── */}
              {error && (
                <div className="fade-up" style={{
                  marginTop: 16, padding: '11px 14px',
                  background: 'rgba(180,35,24,0.06)', border: `1px solid rgba(180,35,24,0.2)`,
                  borderRadius: 10, fontSize: 13, color: P.error,
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <svg style={{ flexShrink: 0, marginTop: 1 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span style={{ flex: 1 }}>{error}</span>
                  <button
                    onClick={getTranscript}
                    style={{ flexShrink: 0, border: `1px solid rgba(180,35,24,0.25)`, background: 'white', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: P.error, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* ── Transcript result ── */}
              {transcript && (
                <div ref={resultRef} className="fade-up" style={{ marginTop: 24 }}>

                  {/* New transcript button */}
                  <button
                    onClick={resetAll}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, marginBottom: 14,
                      border: `1px solid ${P.border}`, background: P.paper, borderRadius: 8,
                      padding: '5px 11px', fontSize: 12, fontWeight: 600, color: P.muted,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = P.border; e.currentTarget.style.color = P.ink; }}
                    onMouseLeave={e => { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.muted; }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                    New Transcript
                  </button>

                  {/* Hero thumbnail */}
                  {currentVideoId && (
                    <a href={`https://youtube.com/watch?v=${currentVideoId}`} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'block', marginBottom: 12, borderRadius: 10, overflow: 'hidden', border: `1px solid ${P.border}`, textDecoration: 'none', position: 'relative' }}>
                      <img
                        src={`https://img.youtube.com/vi/${currentVideoId}/mqdefault.jpg`}
                        alt="Video thumbnail"
                        style={{ width: '100%', display: 'block' }}
                      />
                      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <div style={{ width:40, height:40, borderRadius:'50%', background:'rgba(28,25,23,0.6)', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </div>
                      </div>
                    </a>
                  )}

                  {/* Short transcript warning */}
                  {isShortTranscript && (
                    <div className="fade-up" style={{
                      marginBottom: 12, padding: '8px 12px',
                      background: 'rgba(180,83,9,0.06)', border: `1px solid rgba(180,83,9,0.2)`,
                      borderRadius: 8, fontSize: 12, color: P.warning,
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
                  <div style={{ border: `1px solid ${P.border}`, borderRadius: 14, overflow: 'hidden' }}>

                    {/* Result header */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '11px 14px',
                      background: P.paper,
                      borderBottom: `1px solid ${P.border}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: P.ink }}>Transcript</span>
                        {transcriptSource === 'whisper' && (
                          <span style={{ padding: '2px 7px', fontSize: 10, fontWeight: 600, background: `rgba(107,100,92,0.1)`, color: P.muted, borderRadius: 999, border: `1px solid ${P.border}` }}>AI generated</span>
                        )}
                        {transcriptSource === 'subtitles' && (
                          <span style={{ padding: '2px 7px', fontSize: 10, fontWeight: 600, background: `rgba(15,118,110,0.1)`, color: P.success, borderRadius: 999, border: `1px solid rgba(15,118,110,0.2)` }}>From subtitles</span>
                        )}
                        <span style={{ fontSize: 11, color: P.muted }}>{wordCount.toLocaleString()} words</span>
                        <span style={{ fontSize: 11, color: P.border }}>·</span>
                        <span style={{ fontSize: 11, color: P.muted }} title={`${charCount.toLocaleString()} characters`}>{charCount >= 1000 ? `${(charCount / 1000).toFixed(1)}k` : charCount} chars</span>
                        <span style={{ fontSize: 11, color: P.border }}>·</span>
                        <span style={{ fontSize: 11, color: P.muted }}>~{readingMins} min read</span>
                      </div>

                      <div style={{ display: 'flex', gap: 5 }}>
                        {/* Timestamps toggle */}
                        {segments.length > 0 && (
                          <button
                            onClick={() => setShowTimestamps(v => !v)}
                            title={showTimestamps ? 'Hide timestamps' : 'Show timestamps'}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '4px 9px', borderRadius: 7,
                              border: `1px solid ${showTimestamps ? 'rgba(45,108,223,0.25)' : P.border}`,
                              background: showTimestamps ? 'rgba(45,108,223,0.07)' : P.surface,
                              cursor: 'pointer',
                              fontSize: 11, fontWeight: 600,
                              color: showTimestamps ? P.accent : P.muted,
                              transition: 'all 0.15s',
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                            </svg>
                            {showTimestamps ? 'TS on' : 'TS off'}
                          </button>
                        )}

                        {/* Summarize */}
                        <button
                          onClick={summarize}
                          disabled={summarizing}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '4px 9px', borderRadius: 7, border: `1px solid ${P.border}`,
                            background: summarizing ? P.paper : P.surface,
                            cursor: summarizing ? 'not-allowed' : 'pointer',
                            fontSize: 11, fontWeight: 600, color: P.muted,
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => { if (!summarizing) e.currentTarget.style.background = P.paper; }}
                          onMouseLeave={e => { if (!summarizing) e.currentTarget.style.background = P.surface; }}
                        >
                          {summarizing ? (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                          )}
                          {summarizing ? 'Summarizing…' : 'Summarize'}
                        </button>

                        {/* Copy */}
                        <button
                          onClick={copyToClipboard}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '4px 9px', borderRadius: 7,
                            border: `1px solid ${copied ? 'rgba(15,118,110,0.25)' : P.border}`,
                            background: copied ? 'rgba(15,118,110,0.07)' : P.surface,
                            cursor: 'pointer',
                            fontSize: 11, fontWeight: 600,
                            color: copied ? P.success : P.muted,
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
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '4px 9px', borderRadius: 7, border: 'none',
                              background: P.ink,
                              color: 'white', cursor: 'pointer',
                              fontSize: 11, fontWeight: 600,
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#2C2926'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = P.ink; }}
                          >
                            <DownloadIcon size={12} />
                            Download
                            <span style={{ opacity: 0.5 }}><ChevronIcon /></span>
                          </button>

                          {showDownloadMenu && (
                            <div className="fade-up" style={{
                              position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                              width: 186, background: P.surface,
                              border: `1px solid ${P.border}`, borderRadius: 12,
                              boxShadow: '0 8px 24px rgba(28,25,23,0.1)',
                              overflow: 'hidden', zIndex: 20,
                            }}>
                              {[
                                { label: 'Save as TXT', sub: 'Plain text file', fn: downloadTxt },
                                { label: 'Save as PDF', sub: 'Formatted document', fn: downloadPdf },
                                { label: 'Copy as Markdown', sub: 'With timestamps', fn: copyAsMarkdown },
                              ].map((item, i) => (
                                <React.Fragment key={item.label}>
                                  {i > 0 && <div style={{ height: 1, background: P.border }} />}
                                  <button onClick={item.fn} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    width: '100%', padding: '10px 14px',
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    textAlign: 'left', transition: 'background 0.1s',
                                  }}
                                    onMouseEnter={e => e.currentTarget.style.background = P.paper}
                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                  >
                                    <span style={{ color: P.muted }}><DownloadIcon size={13} /></span>
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

                    {/* Search bar */}
                    <div style={{ padding: '7px 12px', background: P.paper, borderBottom: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search transcript…"
                        style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 12, color: P.ink, fontFamily: 'system-ui, sans-serif' }}
                      />
                      {search && matchCount > 0 && (
                        <span style={{ fontSize: 11, color: P.muted, fontWeight: 500, whiteSpace: 'nowrap' }}>{matchCount} match{matchCount !== 1 ? 'es' : ''}</span>
                      )}
                      {search && (
                        <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, padding: 0, fontSize: 18, lineHeight: 1 }}>×</button>
                      )}
                    </div>

                    {/* Transcript text */}
                    <div style={{
                      padding: '16px', maxHeight: 320, overflowY: 'auto',
                      fontSize: 14, lineHeight: 1.8, color: P.ink,
                      background: P.surface,
                    }}>
                      {segments.length > 0 && showTimestamps ? (
                        segments.map((seg, i) => (
                          <span key={i}>
                            <a
                              href={`https://youtube.com/watch?v=${currentVideoId}&t=${seg.seconds}s`}
                              target="_blank" rel="noopener noreferrer"
                              title={`Jump to ${formatTime(seg.seconds)}`}
                              style={{ color: P.accent, fontWeight: 700, fontSize: 11, marginRight: 5, textDecoration: 'none', fontFamily: 'monospace', letterSpacing: '-0.02em', flexShrink: 0 }}
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
                    <div className="fade-up" style={{ marginTop: 10, border: `1px solid ${P.border}`, borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                          <span style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>AI Summary</span>
                          <span style={{ fontSize: 11, color: P.muted }}>
                            · {summary.trim().split(/\s+/).length.toLocaleString()} words
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => { navigator.clipboard.writeText(summary).then(() => { setSummaryCopied(true); setTimeout(() => setSummaryCopied(false), 2000); }); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, border: `1px solid ${P.border}`, background: summaryCopied ? P.paper : P.surface, cursor: 'pointer', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600, color: summaryCopied ? P.success : P.muted, transition: 'all 0.15s' }}
                          >
                            {summaryCopied ? <CheckIcon /> : <CopyIcon />}
                            {summaryCopied ? 'Copied!' : 'Copy'}
                          </button>
                          <button onClick={() => setSummary('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
                        </div>
                      </div>
                      <div style={{ padding: '14px 16px', background: P.surface, fontSize: 14, lineHeight: 1.8, color: P.ink, whiteSpace: 'pre-wrap' }}>
                        {summary}
                      </div>
                    </div>
                  )}

                  {/* Chapters toggle button */}
                  {segments.length > 0 && (
                    <button
                      onClick={() => { if (!showChapters && chapters.length === 0) detectChapters(); else setShowChapters(v => !v); }}
                      style={toggleBtn(showChapters)}
                      onMouseEnter={e => { if (!showChapters) { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; } }}
                      onMouseLeave={e => { if (!showChapters) { e.currentTarget.style.background = P.surface; e.currentTarget.style.color = P.muted; } }}
                    >
                      {chaptersLoading ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                          <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                        </svg>
                      )}
                      {chaptersLoading ? 'Detecting chapters…' : showChapters ? 'Hide Chapters' : 'Detect Chapters'}
                      {!chaptersLoading && <span style={{ opacity: 0.4, transform: showChapters ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><ChevronIcon /></span>}
                    </button>
                  )}

                  {/* Chapters panel */}
                  {showChapters && chapters.length > 0 && (
                    <div className="fade-up" style={{ marginTop: 8, border: `1px solid ${P.border}`, borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7, padding: '10px 14px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                          </svg>
                          <span style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>Chapters</span>
                          <span style={{ fontSize: 11, color: P.muted }}>· {chapters.filter(c => !c.isError).length} detected · click to jump</span>
                        </div>
                        <button
                          onClick={detectChapters}
                          disabled={chaptersLoading}
                          title="Re-detect chapters"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: 0 }}
                        >
                          Refresh
                        </button>
                      </div>
                      <div style={{ background: P.surface, padding: '6px 0' }}>
                        {chapters.map((ch, i) => (
                          ch.isError ? (
                            <div key={i} style={{ padding: '8px 14px', fontSize: 12, color: P.error }}>{ch.title}</div>
                          ) : (
                            <a
                              key={i}
                              href={`https://youtube.com/watch?v=${currentVideoId}&t=${ch.seconds}s`}
                              target="_blank" rel="noopener noreferrer"
                              style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '9px 14px', textDecoration: 'none',
                                transition: 'background 0.1s',
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = P.paper}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: P.accent, flexShrink: 0, minWidth: 36 }}>
                                {formatTime(ch.seconds)}
                              </span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: P.ink, lineHeight: 1.3 }}>{ch.title}</span>
                              <svg style={{ marginLeft: 'auto', flexShrink: 0, color: P.border }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                              </svg>
                            </a>
                          )
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Key Quotes toggle button */}
                  <button
                    onClick={() => { if (!showQuotes && quotes.length === 0) extractQuotes(); else setShowQuotes(v => !v); }}
                    style={toggleBtn(showQuotes)}
                    onMouseEnter={e => { if (!showQuotes) { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; } }}
                    onMouseLeave={e => { if (!showQuotes) { e.currentTarget.style.background = P.surface; e.currentTarget.style.color = P.muted; } }}
                  >
                    {quotesLoading ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
                        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
                      </svg>
                    )}
                    {quotesLoading ? 'Extracting quotes…' : showQuotes ? 'Hide Key Quotes' : 'Extract Key Quotes'}
                    {!quotesLoading && <span style={{ opacity: 0.4, transform: showQuotes ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><ChevronIcon /></span>}
                  </button>

                  {/* Key Quotes panel */}
                  {showQuotes && quotes.length > 0 && (
                    <div className="fade-up" style={{ marginTop: 8, border: `1px solid ${P.border}`, borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
                            <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
                          </svg>
                          <span style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>Key Quotes</span>
                          <span style={{ fontSize: 11, color: P.muted }}>· {quotes.filter(q => !q.startsWith('Error:')).length} quotes</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => { navigator.clipboard.writeText(quotes.map(q => `"${q}"`).join('\n\n')).then(() => { setQuotesCopied(true); setTimeout(() => setQuotesCopied(false), 2000); }); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, border: `1px solid ${P.border}`, background: quotesCopied ? P.paper : P.surface, cursor: 'pointer', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600, color: quotesCopied ? P.success : P.muted, transition: 'all 0.15s' }}
                          >
                            {quotesCopied ? <CheckIcon /> : <CopyIcon />}
                            {quotesCopied ? 'Copied!' : 'Copy all'}
                          </button>
                          <button onClick={extractQuotes} disabled={quotesLoading} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: 0 }}>Refresh</button>
                        </div>
                      </div>
                      <div style={{ background: P.surface, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {quotes.map((q, i) => (
                          q.startsWith('Error:') ? (
                            <div key={i} style={{ fontSize: 12, color: P.error }}>{q}</div>
                          ) : (
                            <div key={i} style={{
                              position: 'relative', padding: '10px 14px 10px 20px',
                              background: P.paper, borderRadius: 8,
                              borderLeft: `3px solid ${P.border}`,
                              fontSize: 13.5, lineHeight: 1.7, color: P.ink,
                              fontStyle: 'italic',
                            }}>
                              <span style={{ position: 'absolute', top: 6, left: -1, fontSize: 22, color: P.border, fontStyle: 'normal', lineHeight: 1 }}>"</span>
                              {q}
                            </div>
                          )
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Q&A toggle button */}
                  <button
                    onClick={() => { setShowQA(v => !v); setTimeout(() => qaInputRef.current?.focus(), 80); }}
                    style={{
                      ...toggleBtn(showQA, P.accent),
                      border: `1px solid ${showQA ? 'rgba(45,108,223,0.25)' : P.border}`,
                      background: showQA ? 'rgba(45,108,223,0.06)' : P.surface,
                    }}
                    onMouseEnter={e => { if (!showQA) { e.currentTarget.style.background = P.paper; e.currentTarget.style.color = P.ink; } }}
                    onMouseLeave={e => { if (!showQA) { e.currentTarget.style.background = P.surface; e.currentTarget.style.color = P.muted; } }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    {showQA ? 'Hide Q&A' : 'Ask AI about this transcript'}
                    <span style={{ opacity: 0.4, transform: showQA ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><ChevronIcon /></span>
                  </button>

                  {/* Q&A panel */}
                  {showQA && (
                    <div className="fade-up" style={{ marginTop: 8, border: `1px solid rgba(45,108,223,0.2)`, borderRadius: 12, overflow: 'hidden' }}>
                      {/* Q&A header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 14px', background: P.paper, borderBottom: `1px solid ${P.border}` }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                          <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <span style={{ fontSize: 12, fontWeight: 700, color: P.accent }}>Ask AI</span>
                        <span style={{ fontSize: 11, color: P.muted }}>· answers based on this transcript only</span>
                        {qaMessages.length > 0 && (
                          <button
                            onClick={() => setQaMessages([])}
                            style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 11, fontWeight: 600, padding: 0 }}
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      {/* Messages */}
                      {qaMessages.length > 0 && (
                        <div style={{ maxHeight: 280, overflowY: 'auto', background: P.surface, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {qaMessages.map((msg, i) => (
                            <div key={i} style={{
                              display: 'flex',
                              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            }}>
                              <div style={{
                                maxWidth: '82%',
                                padding: '8px 12px',
                                borderRadius: msg.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                                background: msg.role === 'user' ? P.accent : (msg.isError ? 'rgba(180,35,24,0.06)' : P.paper),
                                border: msg.role === 'ai' ? `1px solid ${msg.isError ? 'rgba(180,35,24,0.2)' : P.border}` : 'none',
                                fontSize: 13, lineHeight: 1.65,
                                color: msg.role === 'user' ? 'white' : (msg.isError ? P.error : P.ink),
                              }}>
                                {msg.text}
                              </div>
                            </div>
                          ))}
                          {qaLoading && (
                            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                              <div style={{ padding: '8px 14px', borderRadius: '12px 12px 12px 3px', background: P.paper, border: `1px solid ${P.border}`, display: 'flex', gap: 4, alignItems: 'center' }}>
                                {[0, 1, 2].map(d => (
                                  <div key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: P.accent, opacity: 0.5, animation: `bounce 1.2s ease-in-out ${d * 0.2}s infinite` }} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Input */}
                      <div style={{ display: 'flex', gap: 8, padding: '10px 12px', background: qaMessages.length > 0 ? P.paper : P.surface, borderTop: qaMessages.length > 0 ? `1px solid ${P.border}` : 'none' }}>
                        <input
                          ref={qaInputRef}
                          value={qaQuestion}
                          onChange={e => setQaQuestion(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && askQuestion()}
                          placeholder="Ask anything about this video…"
                          disabled={qaLoading}
                          style={{
                            flex: 1, border: `1.5px solid ${P.border}`, borderRadius: 9,
                            padding: '8px 12px', fontSize: 13, color: P.ink,
                            background: P.surface, outline: 'none',
                            transition: 'border-color 0.15s',
                            fontFamily: 'system-ui, sans-serif',
                          }}
                          onFocus={e => { e.target.style.borderColor = P.accent; }}
                          onBlur={e => { e.target.style.borderColor = P.border; }}
                        />
                        <button
                          onClick={askQuestion}
                          disabled={!qaQuestion.trim() || qaLoading}
                          style={{
                            flexShrink: 0, width: 36, height: 36,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            borderRadius: 9, border: 'none',
                            background: !qaQuestion.trim() || qaLoading ? P.border : P.accent,
                            color: !qaQuestion.trim() || qaLoading ? P.muted : 'white',
                            cursor: !qaQuestion.trim() || qaLoading ? 'not-allowed' : 'pointer',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => { if (qaQuestion.trim() && !qaLoading) e.currentTarget.style.background = P.accentHover; }}
                          onMouseLeave={e => { if (qaQuestion.trim() && !qaLoading) e.currentTarget.style.background = P.accent; }}
                        >
                          {qaLoading ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="22" y1="2" x2="11" y2="13"/>
                              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── History panel ── */}
          {history.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => setShowHistory(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', justifyContent: 'center',
                  background: 'rgba(28,25,23,0.04)', border: `1px solid ${P.border}`,
                  borderRadius: 10, padding: '7px 14px',
                  color: P.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(28,25,23,0.07)'; e.currentTarget.style.color = P.ink; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(28,25,23,0.04)'; e.currentTarget.style.color = P.muted; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                {showHistory ? 'Hide' : 'Recent transcripts'} ({history.length})
                <span style={{ opacity: 0.4, transform: showHistory ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><ChevronIcon /></span>
              </button>

              {showHistory && (
                <div className="fade-up" style={{
                  marginTop: 8,
                  background: P.surface,
                  border: `1px solid ${P.border}`,
                  borderRadius: 12, overflow: 'hidden',
                }}>
                  {history.map((h, i) => (
                    <React.Fragment key={h.id}>
                      {i > 0 && <div style={{ height: 1, background: P.border }} />}
                      <button
                        onClick={() => loadFromHistory(h)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          width: '100%', padding: '11px 14px',
                          background: 'none', border: 'none', cursor: 'pointer',
                          textAlign: 'left', transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = P.paper}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <img
                          src={h.thumbnail} alt=""
                          style={{ width: 60, height: 34, objectFit: 'cover', borderRadius: 5, flexShrink: 0, border: `1px solid ${P.border}` }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: P.ink, fontFamily: 'monospace' }}>{h.id}</div>
                          <div style={{ fontSize: 11, color: P.muted, marginTop: 3 }}>
                            {h.source === 'whisper' ? 'AI transcribed' : 'Subtitles'} · {new Date(h.date).toLocaleDateString()} · {h.transcript.trim().split(/\s+/).length.toLocaleString()} words
                          </div>
                        </div>
                        <button
                          onClick={(e) => deleteFromHistory(h.id, e)}
                          title="Remove from history"
                          style={{ flexShrink: 0, border: 'none', background: 'none', cursor: 'pointer', color: P.muted, fontSize: 16, lineHeight: 1, padding: '4px 6px', borderRadius: 6, transition: 'all 0.1s' }}
                          onMouseEnter={e => { e.currentTarget.style.color = P.error; e.currentTarget.style.background = 'rgba(180,35,24,0.07)'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = P.muted; e.currentTarget.style.background = 'none'; }}
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
