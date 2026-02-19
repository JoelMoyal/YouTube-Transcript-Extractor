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

function parseVTT(content) {
  const lines = content.split('\n');
  const textLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('WEBVTT') ||
      trimmed.startsWith('Kind:') ||
      trimmed.startsWith('Language:') ||
      trimmed.includes('-->')
    ) continue;
    const cleaned = trimmed.replace(/<[^>]+>/g, '').trim();
    if (cleaned) textLines.push(cleaned);
  }
  return [...new Set(textLines)].join(' ').replace(/\s+/g, ' ').trim();
}

function parseJSON3(content) {
  const json3 = JSON.parse(content);
  return json3.events
    .filter(e => e.segs)
    .flatMap(e => e.segs.map(s => s.utf8))
    .join(' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
      const text = subFile.endsWith('.json3') ? parseJSON3(content) : parseVTT(content);
      return res.json({ transcript: text, source: 'subtitles' });
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
      '--output_format', 'txt',
      '--output_dir', tmpDir,
      '--language', toWhisperLang(safeLang)
    ], { timeout: 600000 }); // 10 min for transcription

    const whisperTxt = path.join(tmpDir, `${videoId}_audio.txt`);
    const text = (await fsPromises.readFile(whisperTxt, 'utf-8')).trim();

    await fsPromises.unlink(audioFile).catch(() => {});
    await fsPromises.unlink(whisperTxt).catch(() => {});

    return res.json({ transcript: text, source: 'whisper' });

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
