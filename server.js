const express = require('express');
const cors = require('cors');
const path = require('path');
const fsPromises = require('fs').promises;
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
    if (/^\d+$/.test(trimmed)) continue; // cue ID

    const cleaned = trimmed.replace(/<[^>]+>/g, '').trim();
    if (cleaned) currentTexts.push(cleaned);
  }
  flush();

  // Deduplicate consecutive identical segments
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

// Classify a yt-dlp error into a user-friendly message
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

app.get('/api/transcript', async (req, res) => {
  const { videoId, lang } = req.query;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId parameter' });

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid videoId format' });
  }

  const safeLang = lang && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,10})?$/.test(lang) ? lang : 'en';
  const tmpDir = os.tmpdir();
  const outputTemplate = path.join(tmpDir, videoId);

  try {
    // ── Step 1: Try subtitle extraction ──────────────────────────────────────
    let lastSubError = null;

    for (const langArgs of [['--sub-lang', safeLang], []]) {
      try {
        await execFileAsync('yt-dlp', [
          '--skip-download',
          '--write-auto-sub',
          '--write-subs',
          '--cookies-from-browser', 'chrome',
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

    // If yt-dlp threw a recognisable error on both passes, surface it now
    if (lastSubError) {
      const friendly = classifyYtdlpError(lastSubError);
      if (friendly) return res.status(500).json({ error: friendly });
    }

    const subFile = (await fsPromises.readdir(tmpDir)).find(
      f => f.startsWith(videoId) && (f.endsWith('.vtt') || f.endsWith('.json3') || f.endsWith('.srt'))
    );

    if (subFile) {
      const subPath = path.join(tmpDir, subFile);
      const content = await fsPromises.readFile(subPath, 'utf-8');
      await fsPromises.unlink(subPath);
      const result = subFile.endsWith('.json3') ? parseJSON3(content) : parseVTT(content);
      return res.json({ transcript: result.transcript, segments: result.segments, source: 'subtitles' });
    }

    // ── Step 2: No subtitles — fall back to Whisper STT ──────────────────────
    const audioBase = path.join(tmpDir, `${videoId}_audio`);

    await execFileAsync('yt-dlp', [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      '--cookies-from-browser', 'chrome',
      '-o', audioBase,
      `https://www.youtube.com/watch?v=${videoId}`
    ], { timeout: 300000 }); // 5 min for download

    const audioFile = `${audioBase}.mp3`;

    await execFileAsync('whisper', [
      audioFile,
      '--model', 'base',
      '--output_format', 'vtt',
      '--output_dir', tmpDir,
      '--language', toWhisperLang(safeLang)
    ], { timeout: 600000 }); // 10 min for transcription

    const whisperVtt = path.join(tmpDir, `${videoId}_audio.vtt`);
    const whisperContent = await fsPromises.readFile(whisperVtt, 'utf-8');
    const result = parseVTT(whisperContent);

    await fsPromises.unlink(audioFile).catch(() => {});
    await fsPromises.unlink(whisperVtt).catch(() => {});

    return res.json({ transcript: result.transcript, segments: result.segments, source: 'whisper' });

  } catch (error) {
    await cleanup(tmpDir, videoId);
    const friendly = classifyYtdlpError(error);
    res.status(500).json({ error: friendly || 'Failed to fetch transcript', details: friendly ? undefined : error.message });
  }
});

// Handle all other requests with React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
