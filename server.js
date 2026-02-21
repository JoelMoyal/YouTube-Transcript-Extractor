const express = require('express');
const cors = require('cors');
const path = require('path');
const fsPromises = require('fs').promises;
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const Groq = require('groq-sdk');
const { Supadata } = require('@supadata/js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function geminiClient() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    .getGenerativeModel({ model: 'gemini-2.0-flash' });
}

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

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Serve static files from React app
app.use(express.static(path.join(__dirname, 'client/build')));

function parseTimestamp(ts) {
  const parts = ts.trim().replace(',', '.').split(':');
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  return 0;
}

function parseVTT(content) {
  const lines = content.split('\n');
  const segments = [];
  let currentSeconds = null;
  let currentTexts = [];

  const flush = () => {
    if (currentSeconds !== null && currentTexts.length > 0) {
      const text = currentTexts.join(' ').replace(/\s+/g, ' ').trim();
      if (text) segments.push({ seconds: currentSeconds, text });
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

  const seen = new Set();
  const deduped = segments.filter(s => {
    if (seen.has(s.text)) return false;
    seen.add(s.text);
    return true;
  });

  const transcript = deduped.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
  return { transcript, segments: deduped };
}

function parseJSON3(content) {
  const json3 = JSON.parse(content);
  const segments = [];

  for (const event of json3.events) {
    if (!event.segs) continue;
    const seconds = Math.floor((event.tStartMs || 0) / 1000);
    const text = event.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
    if (text) segments.push({ seconds, text });
  }

  const seen = new Set();
  const deduped = segments.filter(s => {
    if (seen.has(s.text)) return false;
    seen.add(s.text);
    return true;
  });

  const transcript = deduped.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
  return { transcript, segments: deduped };
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

// ── SSE transcript endpoint ───────────────────────────────────────────────────
app.get('/api/transcript', async (req, res) => {
  const { videoId, lang } = req.query;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId parameter' });
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId))
    return res.status(400).json({ error: 'Invalid videoId format' });

  const safeLang = lang && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,10})?$/.test(lang) ? lang : 'en';
  const tmpDir = os.tmpdir();
  const outputTemplate = path.join(tmpDir, videoId);

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // ── Stage 1a: Supadata (no cookies needed) ────────────────────────────────
    if (process.env.SUPADATA_API_KEY) {
      try {
        send('progress', { stage: 'subtitles', message: 'Fetching transcript…', percent: 15 });
        const supadata = new Supadata({ apiKey: process.env.SUPADATA_API_KEY });

        let result = await supadata.transcript({ url: `https://www.youtube.com/watch?v=${videoId}`, lang: safeLang, mode: 'auto' });

        // Videos >20 min return a jobId — poll until done
        if (result && 'jobId' in result) {
          send('progress', { stage: 'subtitles', message: 'Processing transcript…', percent: 25 });
          for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 3000));
            const job = await supadata.transcript.getJobStatus(result.jobId);
            if (job.status === 'completed') { result = job; break; }
            if (job.status === 'failed') { result = null; break; }
          }
        }

        if (result && Array.isArray(result.content) && result.content.length > 0) {
          const seen = new Set();
          const segments = result.content
            .map(s => ({ seconds: Math.floor((s.offset || 0) / 1000), text: (s.text || '').trim() }))
            .filter(s => s.text && !seen.has(s.text) && seen.add(s.text));
          const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
          send('done', { transcript, segments, source: 'subtitles' });
          res.end();
          return;
        }
      } catch {
        // Fall through to yt-dlp
      }
    }

    // ── Stage 1b: yt-dlp subtitles (needs cookies on Railway) ─────────────────
    send('progress', { stage: 'subtitles', message: 'Looking for subtitles…', percent: 10 });

    let lastSubError = null;

    for (const langArgs of [['--sub-lang', safeLang], []]) {
      try {
        await execFileAsync('yt-dlp', [
          '--skip-download',
          '--write-auto-sub',
          '--write-subs',
          ...jsRuntimeArgs,
          ...cookieArgs,
          ...langArgs,
          '-o', outputTemplate,
          `https://www.youtube.com/watch?v=${videoId}`
        ], { timeout: 45000 });
      } catch (err) {
        lastSubError = err;
      }

      const files = await fsPromises.readdir(tmpDir);
      if (files.find(f => f.startsWith(videoId) && (f.endsWith('.vtt') || f.endsWith('.json3') || f.endsWith('.srt')))) {
        lastSubError = null;
        break;
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
      send('done', { transcript: result.transcript, segments: result.segments, source: 'subtitles' });
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
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      ...jsRuntimeArgs,
      ...cookieArgs,
      '-o', audioBase,
      `https://www.youtube.com/watch?v=${videoId}`
    ], { timeout: 300000 });

    // ── Stage 3: Groq Whisper API ─────────────────────────────────────────────
    send('progress', { stage: 'whisper', message: 'Transcribing with Groq Whisper AI…', percent: 60 });

    const audioFile = `${audioBase}.mp3`;
    const audioStat = await fsPromises.stat(audioFile);
    if (audioStat.size > 24 * 1024 * 1024) {
      await fsPromises.unlink(audioFile).catch(() => {});
      send('error', { error: 'Audio file too large for AI transcription (max 24 MB). Try a shorter video.' });
      res.end();
      return;
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const { createReadStream } = require('fs');
    const transcription = await groq.audio.transcriptions.create({
      file: createReadStream(audioFile),
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
      language: toWhisperLang(safeLang),
    });

    await fsPromises.unlink(audioFile).catch(() => {});

    send('progress', { stage: 'whisper', message: 'Finalising transcript…', percent: 95 });

    const rawSegments = transcription.segments || [];
    const seen = new Set();
    const segments = rawSegments
      .map(s => ({ seconds: Math.floor(s.start), text: s.text.trim() }))
      .filter(s => s.text && !seen.has(s.text) && seen.add(s.text));
    const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();

    send('done', { transcript, segments, source: 'whisper' });
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
  const { transcript } = req.body;
  if (!transcript || typeof transcript !== 'string')
    return res.status(400).json({ error: 'Missing transcript' });
  if (!process.env.GEMINI_API_KEY)
    return res.status(503).json({ error: 'AI summary is not configured (missing GEMINI_API_KEY)' });

  try {
    const model = geminiClient();
    const result = await model.generateContent(
      `Summarize the following YouTube video transcript into clear bullet points. Focus on the key topics, main arguments, and important takeaways. Be concise.\n\nTranscript:\n${transcript.slice(0, 30000)}`
    );
    res.json({ summary: result.response.text() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to summarize', details: err.message });
  }
});

// ── Chapters endpoint ─────────────────────────────────────────────────────────
app.post('/api/chapters', async (req, res) => {
  const { transcript, segments } = req.body;
  if (!transcript || typeof transcript !== 'string')
    return res.status(400).json({ error: 'Missing transcript' });
  if (!process.env.GEMINI_API_KEY)
    return res.status(503).json({ error: 'AI not configured (missing GEMINI_API_KEY)' });

  try {
    const segmentsHint = Array.isArray(segments) && segments.length > 0
      ? `\n\nTimestamp reference (seconds → text snippet):\n${segments.slice(0, 60).map(s => `${s.seconds}s: ${s.text.slice(0, 80)}`).join('\n')}`
      : '';

    const model = geminiClient();
    const result = await model.generateContent(
      `You detect natural chapter breaks in YouTube video transcripts. Return ONLY a valid JSON array of chapter objects with "seconds" (integer, must match one of the provided timestamps) and "title" (short, 2-6 words). No explanation, no markdown, just the JSON array.\n\nDetect 3-8 natural chapter breaks in this transcript. Use the timestamp reference to assign accurate seconds values.\n\nTranscript:\n${transcript.slice(0, 30000)}${segmentsHint}\n\nReturn JSON array only: [{"seconds": 0, "title": "Introduction"}, ...]`
    );
    const raw = result.response.text();
    const match = raw.match(/\[[\s\S]*\]/);
    const chapters = match ? JSON.parse(match[0]) : [];
    res.json({ chapters });
  } catch (err) {
    res.status(500).json({ error: 'Failed to detect chapters', details: err.message });
  }
});

// ── Key quotes endpoint ───────────────────────────────────────────────────────
app.post('/api/quotes', async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || typeof transcript !== 'string')
    return res.status(400).json({ error: 'Missing transcript' });
  if (!process.env.GEMINI_API_KEY)
    return res.status(503).json({ error: 'AI not configured (missing GEMINI_API_KEY)' });

  try {
    const model = geminiClient();
    const result = await model.generateContent(
      `You extract memorable, insightful, or impactful quotes from YouTube video transcripts. Return ONLY a valid JSON array of strings — each string is a direct, verbatim quote from the transcript. No explanation, no markdown, no attribution, just the JSON array of quote strings.\n\nExtract 4-7 of the most memorable or insightful quotes from this transcript. Each quote should be a complete sentence or phrase, taken verbatim.\n\nTranscript:\n${transcript.slice(0, 30000)}\n\nReturn JSON array only: ["quote one", "quote two", ...]`
    );
    const raw = result.response.text();
    const match = raw.match(/\[[\s\S]*\]/);
    const quotes = match ? JSON.parse(match[0]) : [];
    res.json({ quotes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to extract quotes', details: err.message });
  }
});

// ── Q&A endpoint ─────────────────────────────────────────────────────────────
app.post('/api/ask', async (req, res) => {
  const { transcript, question } = req.body;
  if (!transcript || typeof transcript !== 'string' || !question || typeof question !== 'string')
    return res.status(400).json({ error: 'Missing transcript or question' });
  if (question.length > 500)
    return res.status(400).json({ error: 'Question too long' });
  if (!process.env.GEMINI_API_KEY)
    return res.status(503).json({ error: 'AI not configured (missing GEMINI_API_KEY)' });

  try {
    const model = geminiClient();
    const result = await model.generateContent(
      `You are a helpful assistant that answers questions about YouTube video transcripts. Be concise and accurate. Only use information from the provided transcript. If the answer is not in the transcript, say so.\n\nTranscript:\n${transcript.slice(0, 30000)}\n\nQuestion: ${question}`
    );
    res.json({ answer: result.response.text() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to answer', details: err.message });
  }
});

// Handle all other requests with React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
