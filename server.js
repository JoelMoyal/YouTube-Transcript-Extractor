const express = require('express');
const cors = require('cors');
const path = require('path');
const fsPromises = require('fs').promises;
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const Groq = require('groq-sdk');
const { Supadata } = require('@supadata/js');
const { createClient } = require('@supabase/supabase-js');

const hashEmail = (email) => crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');

// ── Supabase admin client (server-side only, uses service role key) ───────────
let supabaseAdmin = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── requireAuth middleware ─────────────────────────────────────────────────────
// Validates the Bearer JWT from the client. Attaches req.user if valid.
// Returns 401 if no valid token. Not applied to any routes yet (future use).
async function requireAuth(req, res, next) {
  console.log(`[requireAuth] ${req.method} ${req.path}`);
  if (!supabaseAdmin) {
    console.error('[requireAuth] supabaseAdmin is null — SUPABASE_SERVICE_ROLE_KEY missing?');
    return res.status(503).json({ error: 'Auth not configured' });
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    console.error('[requireAuth] No Bearer token in request');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    console.error('[requireAuth] Token invalid:', error?.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = user;
  next();
}

async function aiComplete(prompt, maxTokens = 1024) {
  // Try Groq first
  if (process.env.GROQ_API_KEY) {
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      });
      return completion.choices[0].message.content;
    } catch (err) {
      const msg = err.message || '';
      const status = err.status || err.statusCode || 0;
      // Only hard-fail on auth errors — fall through to OpenRouter for everything else
      if (status === 401 || msg.includes('401') || msg.includes('invalid_api_key') || msg.includes('unauthorized')) throw err;
      // Fall through to OpenRouter for rate limits, 5xx, timeouts, model errors, etc.
    }
  }

  // Fallback: OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.1-8b-instruct:free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `OpenRouter error: ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }

  throw new Error('No AI provider configured (GROQ_API_KEY or OPENROUTER_API_KEY required)');
}

// Multi-turn chat — accepts a full messages array (system / user / assistant)
async function aiChat(messages, maxTokens = 1024) {
  if (process.env.GROQ_API_KEY) {
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages,
        max_tokens: maxTokens,
      });
      return completion.choices[0].message.content;
    } catch (err) {
      const msg = err.message || '';
      const status = err.status || err.statusCode || 0;
      if (status === 401 || msg.includes('401') || msg.includes('invalid_api_key') || msg.includes('unauthorized')) throw err;
    }
  }
  if (process.env.OPENROUTER_API_KEY) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.1-8b-instruct:free',
        messages,
        max_tokens: maxTokens,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `OpenRouter error: ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }
  throw new Error('No AI provider configured (GROQ_API_KEY or OPENROUTER_API_KEY required)');
}

const LANG_NAMES = { en:'English', es:'Spanish', fr:'French', de:'German', it:'Italian', pt:'Portuguese', ru:'Russian', 'zh-Hans':'Chinese (Simplified)', 'zh-Hant':'Chinese (Traditional)', ja:'Japanese', ko:'Korean', ar:'Arabic', hi:'Hindi', tr:'Turkish', nl:'Dutch', pl:'Polish' };

// Translate segments to targetLang using AI, in parallel batches to stay within token limits
// DISABLED — translation is on ice until a better solution is found
async function translateSegments(segments, targetLang, send) {
  return segments; // no-op: skip all AI translation
  if (!segments.length) return segments;
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) return segments;
  const langName = LANG_NAMES[targetLang] || targetLang;
  send('progress', { stage: 'translate', message: `Translating to ${langName}…`, percent: 88 });

  const SEP = '|||';
  const CHUNK = 80;
  const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

  // Split into chunks upfront
  const chunks = [];
  for (let i = 0; i < segments.length; i += CHUNK) chunks.push(segments.slice(i, i + CHUNK));

  // Translate a single chunk with retry
  const translateChunk = async (batch) => {
    const inputText = batch.map(s => s.text).join(`\n${SEP}\n`);
    const messages = [
      { role: 'system', content: `You are a translator. Translate the user's text to ${langName}. The text contains segments separated by "${SEP}". Preserve every "${SEP}" separator exactly where it is. Do not add or remove separators.` },
      { role: 'user', content: inputText },
    ];

    let translatedText = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
        if (groq) {
          const r = await groq.chat.completions.create({ model: 'llama-3.1-8b-instant', messages, max_tokens: 8192, temperature: 0 });
          translatedText = r.choices[0].message.content;
        } else {
          const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'meta-llama/llama-3.1-8b-instruct:free', messages, max_tokens: 8192, temperature: 0 }) });
          const d = await r.json();
          translatedText = d.choices[0].message.content;
        }
        break;
      } catch (e) {
        console.error(`[translate] attempt ${attempt + 1} failed:`, e.message);
      }
    }

    if (translatedText) {
      const parts = translatedText.split(SEP).map(p => p.trim());
      if (parts.length > 0) {
        return batch.map((s, j) => ({ ...s, text: (parts[j] && parts[j].trim()) || s.text }));
      }
    }
    return batch; // keep originals on failure
  };

  // Run all chunks in parallel — ~4× faster than sequential for multi-chunk videos
  const results = await Promise.allSettled(chunks.map(chunk => translateChunk(chunk)));
  return results.flatMap((r, i) => r.status === 'fulfilled' ? r.value : chunks[i]);
}

// Race a promise against a ms timeout (rejects on timeout)
const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
]);

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;

// Write cookies to a temp file once at startup if YT_COOKIES env var is set
let cookiesPath = null;
if (process.env.YT_COOKIES) {
  cookiesPath = require('path').join(require('os').tmpdir(), 'yt-cookies.txt');
  require('fs').writeFileSync(cookiesPath, process.env.YT_COOKIES);
  console.log('YouTube cookies loaded from YT_COOKIES env var');
}

// Build cookie args: file (Railway) → browser (local dev) → none
const cookieArgs = cookiesPath
  ? ['--cookies', cookiesPath]
  : process.env.RAILWAY_ENVIRONMENT
    ? []
    : ['--cookies-from-browser', 'chrome'];

// Resolve Node.js path for yt-dlp JS runtime (avoids "no runtime found" warning)
const { execFileSync } = require('child_process');
let nodePath = 'node';
try { nodePath = execFileSync('which', ['node'], { encoding: 'utf8' }).trim(); } catch {}
const jsRuntimeArgs = ['--js-runtimes', `node:${nodePath}`];

// Webshare residential proxy (bypasses YouTube datacenter IP blocking)
const proxyArgs = process.env.WEBSHARE_PROXY_URL ? ['--proxy', process.env.WEBSHARE_PROXY_URL] : [];
if (process.env.WEBSHARE_PROXY_URL) console.log('Webshare proxy loaded');
else console.log('No proxy configured — running without proxy');

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Serve static files from React app
// `index: false` prevents `/` from resolving to client/public/index.html (template).
app.use(express.static(path.join(__dirname, 'client/public'), { index: false }));
app.use(express.static(path.join(__dirname, 'client/build'), {
  setHeaders: (res, filePath) => {
    // Never cache index.html — browsers must always fetch the latest so
    // new content-hashed JS/CSS filenames are picked up after each deploy.
    if (path.basename(filePath) === 'index.html') {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

function parseTimestamp(ts) {
  const parts = ts.trim().replace(',', '.').split(':');
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  return 0;
}

function parseVTT(content) {
  const lines = content.split('\n');
  const rawSegments = [];
  let currentSeconds = null;
  let currentTexts = [];

  const flush = () => {
    if (currentSeconds !== null && currentTexts.length > 0) {
      const text = currentTexts.join(' ').replace(/\s+/g, ' ').trim();
      if (text) rawSegments.push({ seconds: currentSeconds, text });
    }
    currentTexts = [];
    currentSeconds = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    if (trimmed.startsWith('WEBVTT') || trimmed.startsWith('Kind:') || trimmed.startsWith('Language:')) continue;

    const tsMatch = trimmed.match(/^([\d:]+[.,]\d+)\s*-->/);
    if (tsMatch) {
      flush();
      currentSeconds = Math.floor(parseTimestamp(tsMatch[1]));
      continue;
    }
    if (/^\d+$/.test(trimmed)) continue;

    const cleaned = trimmed.replace(/<[^>]+>/g, '').trim();
    if (cleaned) currentTexts.push(cleaned);
  }
  flush();

  // Strip rolling overlaps: YouTube auto-captions repeat previous line in each block.
  // For each segment, remove words at the start that already appeared at the end of the previous segment.
  const segments = [];
  let lastText = '';
  for (const seg of rawSegments) {
    const words = seg.text.split(/\s+/);
    const lastWords = lastText.split(/\s+/);
    let overlap = 0;
    for (let len = Math.min(words.length, lastWords.length); len > 0; len--) {
      if (lastWords.slice(-len).join(' ').toLowerCase() === words.slice(0, len).join(' ').toLowerCase()) {
        overlap = len;
        break;
      }
    }
    const newWords = words.slice(overlap);
    if (newWords.length === 0) { lastText = seg.text; continue; }
    segments.push({ seconds: seg.seconds, text: newWords.join(' ') });
    lastText = seg.text;
  }

  const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
  return { transcript, segments };
}

function parseJSON3(content) {
  const json3 = JSON.parse(content);
  const rawSegments = [];

  for (const event of json3.events) {
    if (!event.segs) continue;
    const seconds = Math.floor((event.tStartMs || 0) / 1000);
    const text = event.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
    if (text) rawSegments.push({ seconds, text });
  }

  // Same rolling overlap removal as VTT
  const segments = [];
  let lastText = '';
  for (const seg of rawSegments) {
    const words = seg.text.split(/\s+/);
    const lastWords = lastText.split(/\s+/);
    let overlap = 0;
    for (let len = Math.min(words.length, lastWords.length); len > 0; len--) {
      if (lastWords.slice(-len).join(' ').toLowerCase() === words.slice(0, len).join(' ').toLowerCase()) {
        overlap = len;
        break;
      }
    }
    const newWords = words.slice(overlap);
    if (newWords.length === 0) { lastText = seg.text; continue; }
    segments.push({ seconds: seg.seconds, text: newWords.join(' ') });
    lastText = seg.text;
  }

  const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
  return { transcript, segments };
}

function toWhisperLang(lang) {
  return lang.split('-')[0];
}

function classifyYtdlpError(err) {
  const msg = (err?.stderr || err?.message || '').toLowerCase();
  if (msg.includes('429') || msg.includes('too many requests'))
    return 'YouTube is rate-limiting this IP. Please wait a minute and try again.';
  if (msg.includes('private') || msg.includes('members only'))
    return 'This video is private or members-only.';
  if (msg.includes('unavailable') || msg.includes('no longer available'))
    return 'This video is unavailable.';
  if (msg.includes('copyright'))
    return 'This video is unavailable due to a copyright claim.';
  return null;
}

async function cleanup(tmpDir, prefix) {
  try {
    const files = await fsPromises.readdir(tmpDir);
    for (const f of files.filter(f => f.startsWith(prefix))) {
      await fsPromises.unlink(path.join(tmpDir, f)).catch(() => {});
    }
  } catch {}
}

// ── Shared Whisper transcription helper ───────────────────────────────────────
async function whisperTranscribe(audioFile, safeLang) {
  const { createReadStream } = require('fs');
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const transcription = await groq.audio.transcriptions.create({
    file: createReadStream(audioFile),
    model: 'whisper-large-v3-turbo',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
    language: toWhisperLang(safeLang),
  });
  await fsPromises.unlink(audioFile).catch(() => {});
  const rawSegments = transcription.segments || [];
  const seen = new Set();
  const segments = rawSegments
    .map(s => ({ seconds: Math.floor(s.start), text: s.text.trim() }))
    .filter(s => s.text && !seen.has(s.text) && seen.add(s.text));
  const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
  return { transcript, segments };
}

// ── SSE transcript endpoint ───────────────────────────────────────────────────
app.get('/api/transcript', async (req, res) => {
  const { videoId, url, platform = 'youtube' } = req.query; // lang param ignored while translation is on ice
  console.log(`[transcript] platform=${platform} videoId=${videoId || url} proxy=${!!process.env.WEBSHARE_PROXY_URL}`);
  // LANGUAGE TRANSLATION ON ICE — force English until the feature is stable
  const safeLang = 'en'; // was: lang && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,10})?$/.test(lang) ? lang : 'en';
  const tmpDir = os.tmpdir();
  const isVimeo = platform === 'vimeo';
  const vimeoMatch = isVimeo ? (url || '').match(/vimeo\.com\/(\d+)/) : null;

  // Validate inputs before starting SSE response to avoid headers-sent crashes.
  if (isVimeo) {
    if (!vimeoMatch) return res.status(400).json({ error: 'Invalid Vimeo URL' });
  } else {
    if (!videoId) return res.status(400).json({ error: 'Missing videoId parameter' });
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId))
      return res.status(400).json({ error: 'Invalid videoId format' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // VIMEO
  // ══════════════════════════════════════════════════════════════════════════
  if (isVimeo) {
    const vimeoId = vimeoMatch[1];
    const filePrefix = `vimeo_${vimeoId}`;
    const outputTemplate = path.join(tmpDir, filePrefix);
    const vimeoUrl = `https://vimeo.com/${vimeoId}`;

    // Start thumbnail fetch in background
    const thumbnailPromise = fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(vimeoUrl)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.thumbnail_url?.replace(/(_\d+)?(\.\w+)$/, '_640$2') || null)
      .catch(() => null);

    try {
      // ── Stage 1: yt-dlp subtitles ─────────────────────────────────────────
      send('progress', { stage: 'subtitles', message: 'Looking for Vimeo captions…', percent: 15 });
      try {
        await execFileAsync('yt-dlp', [
          '--skip-download', '--write-subs', '--write-auto-sub',
          ...jsRuntimeArgs, ...proxyArgs,
          '-o', outputTemplate,
          vimeoUrl,
        ], { timeout: 45000 });
      } catch {}

      const subFile = (await fsPromises.readdir(tmpDir)).find(
        f => f.startsWith(filePrefix) && (f.endsWith('.vtt') || f.endsWith('.srt'))
      );

      if (subFile) {
        send('progress', { stage: 'subtitles', message: 'Parsing captions…', percent: 80 });
        const content = await fsPromises.readFile(path.join(tmpDir, subFile), 'utf-8');
        await fsPromises.unlink(path.join(tmpDir, subFile)).catch(() => {});
        const result = parseVTT(content);
        const thumbnail = await thumbnailPromise;
        send('done', { transcript: result.transcript, segments: result.segments, source: 'subtitles', thumbnail });
        res.end();
        return;
      }

      // ── Stage 2: Audio download ───────────────────────────────────────────
      if (!process.env.GROQ_API_KEY) {
        send('error', { error: 'No captions found for this Vimeo video and AI transcription is not configured.' });
        res.end();
        return;
      }

      send('progress', { stage: 'audio', message: 'No captions — downloading audio for AI transcription…', percent: 30 });
      const audioBase = path.join(tmpDir, `${filePrefix}_audio`);

      try {
        await execFileAsync('yt-dlp', [
          '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '5',
          ...jsRuntimeArgs, ...proxyArgs,
          '-o', audioBase,
          vimeoUrl,
        ], { timeout: 300000 });
      } catch (err) {
        const friendly = classifyYtdlpError(err);
        send('error', { error: friendly || 'Failed to download Vimeo audio', details: friendly ? undefined : err.message });
        res.end();
        return;
      }

      // ── Stage 3: Groq Whisper ─────────────────────────────────────────────
      send('progress', { stage: 'whisper', message: 'Transcribing with Groq Whisper AI…', percent: 60 });
      const audioFile = `${audioBase}.mp3`;
      const audioStat = await fsPromises.stat(audioFile).catch(() => null);
      if (!audioStat || audioStat.size > 24 * 1024 * 1024) {
        await fsPromises.unlink(audioFile).catch(() => {});
        send('error', { error: 'Audio file too large for AI transcription (max ~25 min). Try a shorter video.' });
        res.end();
        return;
      }

      send('progress', { stage: 'whisper', message: 'Finalising transcript…', percent: 90 });
      const { transcript, segments } = await whisperTranscribe(audioFile, safeLang);
      const thumbnail = await thumbnailPromise;
      send('done', { transcript, segments, source: 'whisper', thumbnail });
      res.end();

    } catch (error) {
      await cleanup(tmpDir, filePrefix);
      send('error', { error: 'Failed to fetch Vimeo transcript', details: error.message });
      res.end();
    }
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // YOUTUBE
  // ══════════════════════════════════════════════════════════════════════════
  const outputTemplate = path.join(tmpDir, videoId);

  try {
    // ── Stage 1a: youtube-transcript npm (fastest, no API key, YT timedtext) ──
    try {
      send('progress', { stage: 'subtitles', message: 'Fetching transcript…', percent: 15 });
      const { YoutubeTranscript } = require('youtube-transcript');

      let raw = null;
      let gotTargetLang = false;

      // Always try target language first — YouTube provides auto-translated captions
      // for most languages. This handles both directions: en→de AND de→en instantly.
      try {
        const attempt = await withTimeout(YoutubeTranscript.fetchTranscript(videoId, { lang: safeLang }), 3000);
        if (attempt && attempt.length > 0) { raw = attempt; gotTargetLang = true; }
      } catch {}

      // Fall back to any available captions (video's native language)
      if (!gotTargetLang) {
        try { raw = await withTimeout(YoutubeTranscript.fetchTranscript(videoId), 3000); } catch {}
      }

      if (raw && raw.length > 0) {
        const seen = new Set();
        let segments = raw
          .map(s => ({ seconds: Math.floor((s.offset || 0) / 1000), text: (s.text || '').trim() }))
          .filter(s => s.text && !seen.has(s.text) && seen.add(s.text));

        let didTranslate = false;
        if (!gotTargetLang) {
          // YouTube didn't have target-language captions — use AI to translate
          segments = await translateSegments(segments, safeLang, send);
          didTranslate = true;
        }

        const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
        send('done', { transcript, segments, source: 'subtitles', translated: didTranslate });
        res.end();
        return;
      }
    } catch {
      // Fall through to Supadata
    }

    // ── Stage 1b: Supadata API (fallback for edge cases / missing captions) ───
    if (process.env.SUPADATA_API_KEY) {
      try {
        const supadata = new Supadata({ apiKey: process.env.SUPADATA_API_KEY });
        let result = await supadata.transcript({ url: `https://www.youtube.com/watch?v=${videoId}`, lang: safeLang, mode: 'auto' });
        if (result && 'jobId' in result) {
          send('progress', { stage: 'subtitles', message: 'Processing transcript…', percent: 35 });
          for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 3000));
            const job = await supadata.transcript.getJobStatus(result.jobId);
            if (job.status === 'completed') { result = job; break; }
            if (job.status === 'failed') { result = null; break; }
          }
        }
        if (result && Array.isArray(result.content) && result.content.length > 0) {
          const seen = new Set();
          let segments = result.content
            .map(s => ({ seconds: Math.floor((s.offset || 0) / 1000), text: (s.text || '').trim() }))
            .filter(s => s.text && !seen.has(s.text) && seen.add(s.text));
          segments = await translateSegments(segments, safeLang, send);
          const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
          send('done', { transcript, segments, source: 'subtitles', translated: safeLang !== 'en' });
          res.end();
          return;
        }
      } catch {
        // Fall through to yt-dlp
      }
    }

    // ── Stage 1c: yt-dlp subtitles ────────────────────────────────────────────
    send('progress', { stage: 'subtitles', message: 'Looking for subtitles…', percent: 10 });
    let lastSubError = null;

    for (const langArgs of [['--sub-lang', safeLang], []]) {
      try {
        await execFileAsync('yt-dlp', [
          '--skip-download', '--write-auto-sub', '--write-subs',
          ...jsRuntimeArgs, ...proxyArgs, ...cookieArgs, ...langArgs,
          '-o', outputTemplate,
          `https://www.youtube.com/watch?v=${videoId}`
        ], { timeout: 45000 });
      } catch (err) { lastSubError = err; }

      const files = await fsPromises.readdir(tmpDir);
      if (files.find(f => f.startsWith(videoId) && (f.endsWith('.vtt') || f.endsWith('.json3') || f.endsWith('.srt')))) {
        lastSubError = null; break;
      }
    }

    if (lastSubError) {
      const friendly = classifyYtdlpError(lastSubError);
      if (friendly) { send('error', { error: friendly }); res.end(); return; }
    }

    const subFile = (await fsPromises.readdir(tmpDir)).find(
      f => f.startsWith(videoId) && (f.endsWith('.vtt') || f.endsWith('.json3') || f.endsWith('.srt'))
    );

    if (subFile) {
      send('progress', { stage: 'subtitles', message: 'Parsing subtitles…', percent: 80 });
      const subPath = path.join(tmpDir, subFile);
      const content = await fsPromises.readFile(subPath, 'utf-8');
      await fsPromises.unlink(subPath);
      const result = subFile.endsWith('.json3') ? parseJSON3(content) : parseVTT(content);
      // Check if yt-dlp found subs in the target language (filename contains lang code)
      const subIsNative = safeLang !== 'en' && (subFile.includes(`.${safeLang}.`) || subFile.includes(`.${safeLang}-`));
      const subNeedsTranslation = !subIsNative && safeLang !== 'en';
      let translatedSegs = result.segments;
      if (subNeedsTranslation) translatedSegs = await translateSegments(result.segments, safeLang, send);
      const translatedTxt = translatedSegs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
      send('done', { transcript: translatedTxt, segments: translatedSegs, source: 'subtitles', translated: subNeedsTranslation });
      res.end();
      return;
    }

    // ── Stage 2: download audio ───────────────────────────────────────────────
    if (!process.env.GROQ_API_KEY) {
      send('error', { error: 'No captions found for this video and AI transcription is not configured.' });
      res.end();
      return;
    }

    send('progress', { stage: 'audio', message: 'No captions found — downloading audio for AI transcription…', percent: 30 });
    const audioBase = path.join(tmpDir, `${videoId}_audio`);
    await execFileAsync('yt-dlp', [
      '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '5',
      ...jsRuntimeArgs, ...proxyArgs, ...cookieArgs,
      '-o', audioBase,
      `https://www.youtube.com/watch?v=${videoId}`
    ], { timeout: 300000 });

    // ── Stage 3: Groq Whisper ─────────────────────────────────────────────────
    send('progress', { stage: 'whisper', message: 'Transcribing with Groq Whisper AI…', percent: 60 });
    const audioFile = `${audioBase}.mp3`;
    const audioStat = await fsPromises.stat(audioFile);
    if (audioStat.size > 24 * 1024 * 1024) {
      await fsPromises.unlink(audioFile).catch(() => {});
      send('error', { error: 'Audio file too large for AI transcription (max 24 MB). Try a shorter video.' });
      res.end();
      return;
    }

    send('progress', { stage: 'whisper', message: 'Finalising transcript…', percent: 90 });
    const { transcript: rawTxt, segments: rawSegs } = await whisperTranscribe(audioFile, safeLang);
    const translatedSegs = await translateSegments(rawSegs, safeLang, send);
    const translatedTxt = translatedSegs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    send('done', { transcript: translatedTxt || rawTxt, segments: translatedSegs, source: 'whisper', translated: safeLang !== 'en' });
    res.end();

  } catch (error) {
    await cleanup(tmpDir, videoId);
    const friendly = classifyYtdlpError(error);
    send('error', { error: friendly || 'Failed to fetch transcript', details: friendly ? undefined : error.message });
    res.end();
  }
});

// ── AI summary endpoint ───────────────────────────────────────────────────────
app.post('/api/summarize', async (req, res) => {
  const { transcript, platform } = req.body;
  if (!transcript || typeof transcript !== 'string')
    return res.status(400).json({ error: 'Missing transcript' });
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY)
    return res.status(503).json({ error: 'AI summary is not configured (missing GROQ_API_KEY or OPENROUTER_API_KEY)' });

  const source = platform === 'vimeo' ? 'Vimeo video' : 'YouTube video';
  try {
    const text = await aiComplete(
      `Summarize the following ${source} transcript into clear bullet points. Focus on the key topics, main arguments, and important takeaways. Be concise.\n\nTranscript:\n${transcript.slice(0, 15000)}`
    );
    res.json({ summary: text });
  } catch (err) {
    res.status(500).json({ error: 'Failed to summarize', details: err.message });
  }
});

// ── Chapters endpoint ─────────────────────────────────────────────────────────
app.post('/api/timeline', async (req, res) => {
  const { transcript, segments } = req.body;
  if (!transcript || typeof transcript !== 'string')
    return res.status(400).json({ error: 'Missing transcript' });
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY)
    return res.status(503).json({ error: 'AI not configured (missing GROQ_API_KEY or OPENROUTER_API_KEY)' });

  try {
    const segmentsHint = Array.isArray(segments) && segments.length > 0
      ? `\n\nTimestamp reference (seconds → text):\n${segments.slice(0, 80).map(s => `${s.seconds}s: ${s.text.slice(0, 100)}`).join('\n')}`
      : '';

    const raw = await aiComplete(
      `You segment YouTube video transcripts into logical topic sections for a learning timeline. Return ONLY a valid JSON array. Each object must have: "title" (2-5 words, topic name), "startSeconds" (integer matching one of the provided timestamps), "summary" (1 concise sentence describing what this section covers). Produce 4-8 sections covering the whole video.\n\nTranscript:\n${transcript.slice(0, 15000)}${segmentsHint}\n\nReturn JSON array only: [{"title": "Introduction", "startSeconds": 0, "summary": "Speaker introduces the topic and sets context."}, ...]`,
      1024
    );
    const match = raw.match(/\[[\s\S]*\]/);
    const sections = match ? JSON.parse(match[0]) : [];
    res.json({ sections });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate timeline', details: err.message });
  }
});

// ── Flashcards endpoint ───────────────────────────────────────────────────────
app.post('/api/flashcards', async (req, res) => {
  const { transcript, existingQuestions } = req.body;
  if (!transcript || typeof transcript !== 'string')
    return res.status(400).json({ error: 'Missing transcript' });
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY)
    return res.status(503).json({ error: 'AI not configured (missing GROQ_API_KEY or OPENROUTER_API_KEY)' });

  const isMore = Array.isArray(existingQuestions) && existingQuestions.length > 0;

  try {
    let prompt;
    if (isMore) {
      const coveredList = existingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n');
      prompt = `You are creating additional study flashcards from a YouTube video transcript.\n\nFirst assess: how many distinct learnable concepts remain that are NOT already covered? The answer depends entirely on the content — a dense technical video may have many left; a short explainer may have none.\n\nRules:\n- Generate one card per remaining concept — however many that genuinely is\n- Do NOT pad to reach any number — if 1 concept remains, return 1 card\n- Always prefer noMore over weak, redundant, or padded cards\n- If no meaningful new concepts remain, return: {"noMore":true,"reason":"<one sentence — e.g. all key concepts are covered, or this content doesn't have more learnable depth>"}\n- Each card: "question" (specific), "answer" (1-3 sentences), "topic" (1-3 word label)\n\nTranscript:\n${transcript.slice(0, 12000)}\n\nAlready covered (do not repeat):\n${coveredList}\n\nReturn ONLY a JSON array OR the noMore object — no markdown, no explanation.\nFormat: [{"question":"...","answer":"...","topic":"<1-3 word label>"},...]`;
    } else {
      prompt = `You are creating high-quality study flashcards from a YouTube video transcript.\n\nFirst, assess the content:\n- Is this educational content (tutorial, lecture, explainer, documentary, interview with learnable information)? If yes, generate flashcards.\n- Is this non-educational content (music, entertainment, vlog, comedy, fiction, etc.) with no meaningful concepts to study? If yes, return: {"noMore":true,"reason":"<one sentence explaining why — e.g. this is a music video with no educational concepts>"}\n\nIf generating cards:\n- Generate one card per distinct learnable concept the transcript contains — however many that is\n- A 2-minute explainer may warrant 2-3 cards. A 1-hour lecture may warrant 20+. Let the content decide.\n- Each card covers a DIFFERENT concept — no duplicates or rephrasing\n- Only create cards for concepts clearly explained in the transcript — do not invent\n- Skip trivial or obvious questions\n- "answer" should be concise but complete (1-3 sentences)\n- "topic" is a short 1-3 word category label\n\nTranscript:\n${transcript.slice(0, 12000)}\n\nReturn ONLY a JSON array OR the noMore object — no markdown, no explanation.\nFormat: [{"question":"...","answer":"...","topic":"..."},...]`;
    }

    const raw = await aiComplete(prompt, 3000);

    // Check for noMore signal first
    const noMoreMatch = raw.match(/\{\s*"noMore"\s*:\s*true[\s\S]*?\}/);
    if (noMoreMatch) {
      try {
        const parsed = JSON.parse(noMoreMatch[0]);
        return res.json({ flashcards: [], noMore: true, reason: parsed.reason || 'All key concepts from this transcript are already covered.' });
      } catch { /* fall through to array parse */ }
    }

    const match = raw.match(/\[[\s\S]*\]/);
    const flashcards = match ? JSON.parse(match[0]).filter(c => c && c.question && c.answer) : [];
    res.json({ flashcards });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate flashcards', details: err.message });
  }
});

// ── Study guide endpoint ──────────────────────────────────────────────────────
app.post('/api/study-guide', async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || typeof transcript !== 'string')
    return res.status(400).json({ error: 'Missing transcript' });
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY)
    return res.status(503).json({ error: 'AI not configured (missing GROQ_API_KEY or OPENROUTER_API_KEY)' });

  try {
    const raw = await aiComplete(
      `You create structured study guides from YouTube video transcripts. Return ONLY a valid JSON object with exactly these fields — no markdown, no explanation:\n- "overview": 1-2 sentence description of what this video teaches\n- "objectives": array of 3-5 learning objectives starting with action verbs (Understand, Identify, Apply, Analyze, Explain)\n- "keyConcepts": array of 4-8 objects with "term" (string) and "definition" (string, 1-2 sentences)\n- "sections": array of 3-5 objects with "title" (string), "summary" (2-3 sentences), and "keyPoints" (array of 2-4 strings)\n- "reviewQuestions": array of 4-6 thoughtful questions to test understanding\n\nTranscript:\n${transcript.slice(0, 15000)}\n\nReturn JSON object only.`,
      4096
    );
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Failed to parse study guide response. Raw: ${raw.slice(0, 200)}`);
    const studyGuide = JSON.parse(match[0]);
    res.json(studyGuide);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate study guide', details: err.message });
  }
});

// ── Academic Insights endpoint ────────────────────────────────────────────────
app.post('/api/academic-insights', async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || typeof transcript !== 'string')
    return res.status(400).json({ error: 'Missing transcript' });
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY)
    return res.status(503).json({ error: 'AI not configured (missing GROQ_API_KEY or OPENROUTER_API_KEY)' });

  try {
    const raw = await aiComplete(
      `You extract academic information from video transcripts. Return ONLY a valid JSON object with exactly these fields — no markdown, no explanation:\n- "references": array of objects with "author" (string, e.g. "Vaswani et al." or "John Smith"), "year" (string or null), "title" (string or null), "type" ("paper"|"book"|"article"|"other"). Include every academic work, author, or publication mentioned. Empty array if none.\n- "claims": array of objects with "claim" (string — the specific claim made), "supported" (boolean — true if evidence or data is cited alongside it, false if stated without support), "evidence" (string or null — what evidence was provided). Include 3-8 notable claims only.\n- "glossary": array of objects with "term" (string) and "definition" (string, 1-2 sentences derived from the transcript context). Include 4-10 domain-specific terms that are defined or explained. Empty array if none.\n- "researchGaps": array of strings — paraphrases of places where the speaker mentions open problems, future work, unsolved questions, or limitations. Empty array if none.\n\nTranscript:\n${transcript.slice(0, 15000)}\n\nReturn JSON object only.`,
      3000
    );
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Failed to parse academic insights response');
    const insights = JSON.parse(match[0]);
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate academic insights', details: err.message });
  }
});

// ── Q&A endpoint ─────────────────────────────────────────────────────────────
app.post('/api/ask', async (req, res) => {
  const { transcript, question, platform, segments, history } = req.body;
  if (!transcript || typeof transcript !== 'string' || !question || typeof question !== 'string')
    return res.status(400).json({ error: 'Missing transcript or question' });
  if (question.length > 500)
    return res.status(400).json({ error: 'Question too long' });
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY)
    return res.status(503).json({ error: 'AI not configured (missing GROQ_API_KEY or OPENROUTER_API_KEY)' });

  try {
    const source = platform === 'vimeo' ? 'Vimeo video' : 'YouTube video';

    // Build timestamped transcript if segments are available with real timing data
    // (requires at least one segment with seconds > 0, otherwise all times are 0:00 which is useless)
    const hasTimestamps = Array.isArray(segments) && segments.length > 0 && segments.some(s => s.seconds > 0);
    let transcriptContext;
    if (hasTimestamps) {
      transcriptContext = segments.map(s => {
        const mins = Math.floor(s.seconds / 60);
        const secs = Math.floor(s.seconds % 60).toString().padStart(2, '0');
        return `[${mins}:${secs}] ${s.text}`;
      }).join('\n').slice(0, 15000);
    } else {
      transcriptContext = transcript.slice(0, 15000);
    }

    const timestampInstruction = hasTimestamps
      ? ' Each transcript line is prefixed with a time code like [1:23]. Whenever you locate or quote something from the transcript, always include its time code inline (e.g. "he mentions this at [1:23]"). Never quote transcript text as a timestamp — only use the bracketed time code. Only use time codes that appear in the transcript.'
      : ' This transcript is plain text with no time codes. Do not mention, estimate, or guess any timestamps or time positions in your answer.';

    const systemPrompt = `You are a helpful assistant that answers questions about ${source} transcripts. Be concise and accurate. Only use information from the provided transcript. If the answer is not in the transcript, say so.${timestampInstruction}\n\nIMPORTANT FEATURE GUIDANCE: If the user asks about flashcards, making flashcards, or studying with flashcards — tell them to click the "Insights" tab and then click the "Flashcards" button there. If the user asks about a study guide, study notes, or a structured summary — tell them to click the "Insights" tab and then click the "Study Guide" button there.\n\nTranscript:\n${transcriptContext}`;

    // Build multi-turn message list (system + up to last 10 history messages + current question)
    const messages = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(history)) {
      for (const msg of history.slice(-10)) {
        messages.push({ role: msg.role === 'ai' ? 'assistant' : 'user', content: msg.text });
      }
    }
    messages.push({ role: 'user', content: question });

    const text = await aiChat(messages);
    res.json({ answer: text });
  } catch (err) {
    res.status(500).json({ error: 'Failed to answer', details: err.message });
  }
});

// ── Referral claim ────────────────────────────────────────────────────────────
// Called after a new user signs in for the first time.
// Awards +3 referral_bonus to both the new user and the referrer.
app.post('/api/referral/claim', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Auth not configured' });

  const referred_id = req.user.id;
  const { referrer_id } = req.body || {};

  if (!referrer_id || typeof referrer_id !== 'string')
    return res.status(400).json({ error: 'referrer_id required' });
  if (referrer_id === referred_id)
    return res.status(400).json({ error: 'Self-referral not allowed' });

  // Fetch both users
  const [{ data: referredData }, { data: referrerData }] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(referred_id),
    supabaseAdmin.auth.admin.getUserById(referrer_id),
  ]);

  if (!referredData?.user)  return res.status(404).json({ error: 'User not found' });
  if (!referrerData?.user)  return res.status(404).json({ error: 'Referrer not found' });

  const referredMeta  = referredData.user.user_metadata  || {};
  const referrerMeta  = referrerData.user.user_metadata  || {};

  // Idempotent — only credit once per referred user
  if (referredMeta.referral_credited)
    return res.status(409).json({ error: 'Already credited' });

  const BONUS = 3;

  // Award the new user +3
  await supabaseAdmin.auth.admin.updateUserById(referred_id, {
    user_metadata: {
      ...referredMeta,
      referred_by:       referrer_id,
      referral_credited: true,
      referral_bonus:    (referredMeta.referral_bonus || 0) + BONUS,
    },
  });

  // Award the referrer +3 and increment their count
  await supabaseAdmin.auth.admin.updateUserById(referrer_id, {
    user_metadata: {
      ...referrerMeta,
      referral_bonus: (referrerMeta.referral_bonus || 0) + BONUS,
      referral_count: (referrerMeta.referral_count || 0) + 1,
    },
  });

  res.json({ ok: true, bonus: BONUS });
});

// ── Delete account endpoint ───────────────────────────────────────────────────
app.delete('/api/delete-account', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' });
  try {
    const { reason } = req.body || {};
    const userId = req.user.id;
    const email = req.user.email;
    console.log(`[delete-account] Starting deletion for user ${userId} (${email}), reason: ${reason}`);

    // Save deletion reason (best-effort)
    const { error: insertErr } = await supabaseAdmin.from('deletion_reasons').insert({
      user_id: userId,
      email,
      reason: reason || 'No reason given',
    });
    if (insertErr) console.warn('[delete-account] Could not save reason:', insertErr.message);

    // Save hashed email + credits for potential re-registration restore (GDPR-safe)
    const meta = req.user.user_metadata || {};
    const { error: deletedErr } = await supabaseAdmin.from('deleted_accounts').insert({
      email_hash: hashEmail(email),
      referral_bonus: meta.referral_bonus || 0,
      referral_count: meta.referral_count || 0,
    });
    if (deletedErr) console.warn('[delete-account] Could not save deleted_accounts:', deletedErr.message);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('[delete-account] deleteUser failed:', error.message);
      return res.status(500).json({ error: error.message });
    }
    console.log(`[delete-account] Successfully deleted user ${userId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[delete-account] Unexpected error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Restore account credits on re-registration ───────────────────────────────
app.post('/api/restore-account', requireAuth, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' });
  try {
    const hash = hashEmail(req.user.email);
    const { data, error } = await supabaseAdmin
      .from('deleted_accounts')
      .select('*')
      .eq('email_hash', hash)
      .is('restored_at', null)
      .order('deleted_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return res.json({ restored: false });

    // Restore referral credits to new account
    const meta = req.user.user_metadata || {};
    await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
      user_metadata: {
        ...meta,
        referral_bonus: (meta.referral_bonus || 0) + data.referral_bonus,
        referral_count: data.referral_count,
      },
    });

    // Mark as restored so it only happens once
    await supabaseAdmin.from('deleted_accounts').update({ restored_at: new Date().toISOString() }).eq('id', data.id);

    console.log(`[restore-account] Restored ${data.referral_bonus} bonus credits to re-registered user ${req.user.id}`);
    res.json({ restored: true, referral_bonus: data.referral_bonus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unknown API routes should return JSON 404
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Privacy policy static route
app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'privacy.html'));
});

// Unknown web routes get branded 404 page
app.get('*', (_req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'client/build', '404.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
