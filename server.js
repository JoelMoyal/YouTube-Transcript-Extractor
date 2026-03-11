const express = require('express');
const compression = require('compression');
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
const multer = require('multer');

// Load local .env values for `npm start`/local development.
// In production, platform environment variables still take precedence.
require('dotenv').config();

const hashEmail = (email) => crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
const ANON_CREDITS_MAX = Math.max(0, Number.parseInt(process.env.ANON_CREDITS_MAX || '2', 10) || 2);
const ANON_CREDITS_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const _anonCreditsMap = new Map();
const _creditFallbackCounts = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getClientKey = (req) => String(req.ip || req.socket?.remoteAddress || 'unknown');
const redactClientKey = (value) => crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 10);

function normalizeCreditFallbackReason(reason) {
  const text = String(reason || 'unknown').toLowerCase();
  if (text.includes('fetch failed')) return 'supabase_network_fetch_failed';
  if (text.includes('network')) return 'supabase_network_error';
  if (text.includes('timeout')) return 'supabase_timeout';
  if (text.includes('jwt')) return 'auth_jwt_error';
  if (text.includes('permission') || text.includes('denied') || text.includes('forbidden')) return 'db_permission_error';
  if (text.includes('concurrent')) return 'db_concurrency_conflict';
  return text.slice(0, 120);
}

function sendSseEventAndClose(res, event, body) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`);
  res.end();
}

function denyCreditRequest(req, res, { status, body, sseEvent = 'transcript_error', user = null }) {
  if (res.headersSent) {
    sendSseEventAndClose(res, sseEvent, body);
  } else {
    res.status(status).json(body);
  }
  return { ok: false, user, creditInfo: null };
}

function consumeAnonCredit(req, res) {
  if (ANON_CREDITS_MAX <= 0) {
    return denyCreditRequest(req, res, {
      status: 402,
      body: { error: 'Guest credits are currently unavailable. Please sign in.' },
      sseEvent: 'out_of_credits',
    });
  }

  const key = getClientKey(req);
  const now = Date.now();
  let e = _anonCreditsMap.get(key);
  if (!e || now > e.resetAt) e = { used: 0, resetAt: now + ANON_CREDITS_PERIOD_MS };

  if (e.used >= ANON_CREDITS_MAX) {
    return denyCreditRequest(req, res, {
      status: 402,
      body: {
        error: 'Out of credits',
        used: e.used,
        tier_max: ANON_CREDITS_MAX,
        reset_at: new Date(e.resetAt).toISOString(),
      },
      sseEvent: 'out_of_credits',
    });
  }

  e.used += 1;
  _anonCreditsMap.set(key, e);
  return {
    ok: true,
    user: null,
    creditInfo: {
      used: e.used,
      tier_max: ANON_CREDITS_MAX,
      reset_at: new Date(e.resetAt).toISOString(),
    },
  };
}

function fallbackToAnonOnCreditError(req, res, reason) {
  const reasonKey = normalizeCreditFallbackReason(reason);
  const count = (_creditFallbackCounts.get(reasonKey) || 0) + 1;
  _creditFallbackCounts.set(reasonKey, count);
  if (count <= 3 || count % 25 === 0) {
    console.warn(
      `[credits] fallback mode=anon reason=${reasonKey} count=${count} method=${req.method} path=${req.path} client=${redactClientKey(getClientKey(req))} auth=${Boolean(req.headers.authorization)}`
    );
  }
  return consumeAnonCredit(req, res);
}

// ── Multer config for local file uploads ──────────────────────────────────────
const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase() || '.mp3';
    const name = `upload_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const ALLOWED_AUDIO_MIME = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a',
  'audio/wav', 'audio/x-wav', 'audio/webm', 'video/webm',
  'audio/ogg', 'audio/opus', 'audio/flac', 'video/mp4',
  'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'video/x-ms-wmv', 'video/mpeg', 'video/3gpp',
]);

const uploadMiddleware = multer({
  storage: uploadStorage,
  limits: { fileSize: 500 * 1024 * 1024 },  // 500 MB — ffmpeg compresses before Whisper
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_AUDIO_MIME.has(file.mimetype)) return cb(null, true);
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    const ALLOWED_EXT = ['mp3', 'mp4', 'm4a', 'wav', 'webm', 'ogg', 'opus', 'flac', 'mpeg', 'mpga', 'mov', 'avi', 'mkv', 'wmv', '3gp'];
    if (ALLOWED_EXT.includes(ext)) return cb(null, true);
    cb(new Error('Unsupported file type. Use mp4, mov, mp3, m4a, wav, or similar.'));
  },
}).single('file');

// ── Compress any audio/video to a tiny speech-quality mp3 for Whisper ────────
// 16 kHz mono 16 kbps ≈ 7 MB/hour — comfortably under Groq's 25 MB limit
async function compressForWhisper(inputFile) {
  const outFile = inputFile.replace(/(\.[^.]+)?$/, '_whisper.mp3');
  await withTimeout(
    execFileAsync('ffmpeg', [
      '-i', inputFile,
      '-vn',           // strip video
      '-ar', '16000',  // 16 kHz (Whisper's native rate)
      '-ac', '1',      // mono
      '-b:a', '16k',   // 16 kbps — tiny, excellent for speech
      '-y',            // overwrite if exists
      outFile,
    ]),
    300000  // 5-minute cap for very large files
  );
  return outFile;
}

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

// ── Server-side credit system ─────────────────────────────────────────────────
// Reads the JWT token from either the Authorization header or the ?_t= query
// param (needed for EventSource / SSE which cannot send custom headers).
// For authenticated users: checks and atomically deducts 1 credit from the
// user_credits table (see supabase/user_credits.sql).
// For anonymous / unauthenticated users: enforces server-side free credits per
// client IP (default 2 per 7 days, configurable via ANON_CREDITS_MAX).
//
// Returns: { ok, user, creditInfo }
//   ok         — true if the request may proceed
//   user       — Supabase user object (null for anon)
//   creditInfo — { used, tier_max, reset_at } after deduction
//   response already sent if ok === false (402/503)
async function checkAndDeductCredit(req, res) {
  try {
    // Read token from Authorization header OR ?_t= query param (for SSE)
    const authHeader = req.headers.authorization || '';
    const tokenFromQuery = typeof req.query?._t === 'string' ? req.query._t : null;
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : tokenFromQuery;

    // Anonymous request — enforce guest credits server-side
    if (!token) return consumeAnonCredit(req, res);

    // No Supabase admin client in a token-authenticated request.
    // Fall back to anonymous quota instead of allowing unlimited usage.
    if (!supabaseAdmin) return consumeAnonCredit(req, res);

    // Validate JWT
    let user = null;
    let authErr = null;
    try {
      const authResult = await supabaseAdmin.auth.getUser(token);
      user = authResult?.data?.user || null;
      authErr = authResult?.error || null;
    } catch (err) {
      return fallbackToAnonOnCreditError(req, res, `auth_get_user_throw:${err?.message || err}`);
    }
    if (authErr || !user) {
      console.warn('[credits] invalid token; applying anonymous quota:', authErr?.message || 'no user');
      return consumeAnonCredit(req, res);
    }

    const referralBonus = user.user_metadata?.referral_bonus || 0;
    const tierMax = 20 + referralBonus;
    const now = new Date();
    const nowIso = now.toISOString();
    const resetAt = new Date(now.getTime() + ANON_CREDITS_PERIOD_MS).toISOString();

    // Ensure a credits row exists for this user (insert only if missing)
    await supabaseAdmin
      .from('user_credits')
      .insert({ user_id: user.id, used: 0, reset_at: resetAt, tier_max: tierMax })
      .select()
      .maybeSingle() // ignore conflict (row already exists)
      .catch((err) => {
        console.warn('[credits] ensure-row insert failed (continuing):', err?.message || err);
      });

    // Retry loop handles concurrent requests racing on the same user.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error: rowErr } = await supabaseAdmin
        .from('user_credits')
        .select('used, reset_at, tier_max')
        .eq('user_id', user.id)
        .single();

      if (rowErr || !row) {
        console.error('[credits] read error:', rowErr?.message);
        return fallbackToAnonOnCreditError(req, res, rowErr?.message || 'row read failed');
      }

      let currentUsed = row.used;
      let currentResetAt = row.reset_at;
      const effectiveTierMax = Math.max(row.tier_max || 0, tierMax);

      if (new Date(row.reset_at) < now) {
        // Best-effort reset (guarded by reset_at < now so only stale windows are reset).
        await supabaseAdmin
          .from('user_credits')
          .update({ used: 0, reset_at: resetAt, tier_max: effectiveTierMax, updated_at: nowIso })
          .eq('user_id', user.id)
          .lt('reset_at', nowIso)
          .catch(() => {});
        currentUsed = 0;
        currentResetAt = resetAt;
      }

      if (currentUsed >= effectiveTierMax) {
        return denyCreditRequest(req, res, {
          status: 402,
          body: { error: 'Out of credits', used: currentUsed, tier_max: effectiveTierMax, reset_at: currentResetAt },
          sseEvent: 'out_of_credits',
          user,
        });
      }

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('user_credits')
        .update({ used: currentUsed + 1, tier_max: effectiveTierMax, updated_at: nowIso })
        .eq('user_id', user.id)
        .eq('used', currentUsed)
        .select('used, tier_max, reset_at')
        .maybeSingle();

      if (updateErr) {
        console.error(`[credits] deduct error (attempt ${attempt + 1}/3):`, updateErr.message);
        if (attempt < 2) {
          await delay(20 + attempt * 20);
          continue;
        }
        return fallbackToAnonOnCreditError(req, res, updateErr.message || 'update failed');
      }

      // No row updated means a concurrent request won the race; retry with fresh row.
      if (!updated) {
        if (attempt < 2) {
          await delay(20 + attempt * 20);
          continue;
        }
        return fallbackToAnonOnCreditError(req, res, 'concurrent credit update retries exhausted');
      }

      const creditInfo = {
        used: updated.used,
        tier_max: updated.tier_max || effectiveTierMax,
        reset_at: updated.reset_at || currentResetAt,
      };
      console.log(`[credits] deducted 1 credit for ${user.id}: ${creditInfo.used}/${creditInfo.tier_max}`);
      return { ok: true, user, creditInfo };
    }

    return fallbackToAnonOnCreditError(req, res, 'credit retries exhausted');
  } catch (err) {
    console.error('[credits] unexpected error:', err?.message || err);
    return fallbackToAnonOnCreditError(req, res, err?.message || String(err));
  }
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

// ── Production flag ───────────────────────────────────────────────────────────
const isProd = !!(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production');
const safeErr = (err) => isProd ? undefined : (err?.message || String(err));

// ── Simple in-memory rate limiter (no extra dep) ──────────────────────────────
const _rlMap = new Map();
// Purge expired entries every minute to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, e] of _rlMap) if (now > e.resetAt) _rlMap.delete(key);
  for (const [key, e] of _anonCreditsMap) if (now > e.resetAt) _anonCreditsMap.delete(key);
}, 60_000).unref(); // .unref() so this timer doesn't keep the process alive alone
function makeRateLimit({ windowMs, max, scope }) {
  return function rateLimitMw(req, res, next) {
    const key = `${scope}:${getClientKey(req)}`;
    const now = Date.now();
    let e = _rlMap.get(key);
    if (!e || now > e.resetAt) e = { count: 0, resetAt: now + windowMs };
    e.count++;
    _rlMap.set(key, e);
    if (e.count > max) {
      const retryAfter = Math.ceil((e.resetAt - now) / 1000);
      const body = { error: 'Too many requests. Please slow down and try again shortly.' };
      res.setHeader('Retry-After', retryAfter);

      // EventSource clients cannot read non-2xx JSON bodies. Return an SSE error
      // event so the UI can show the real reason instead of a generic connection error.
      const accept = String(req.headers.accept || '').toLowerCase();
      if (accept.includes('text/event-stream')) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        res.write(`event: transcript_error\ndata: ${JSON.stringify(body)}\n\n`);
        res.end();
        return;
      }

      return res.status(429).json(body);
    }
    next();
  };
}
const aiRateLimit         = makeRateLimit({ scope: 'ai',         windowMs: 60_000, max: 20 }); // 20 AI calls/min per IP
const uploadRateLimit     = makeRateLimit({ scope: 'upload',     windowMs: 60_000, max: 3  }); // 3 uploads/min per IP
const transcriptRateLimit = makeRateLimit({ scope: 'transcript', windowMs: 60_000, max: 30 }); // 30 fetches/min per IP

// ── SSRF guard: only allow safe external http/https URLs ──────────────────────
function isSafeExternalUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();

  // Block all loopback / localhost forms
  if (host === 'localhost') return false;

  // Block IPv6 — covers ::1, ::ffff:127.x, fc00::/7, fe80::/10, and all bracketed forms
  if (host.startsWith('[') || host.includes(':')) return false;

  // Block IPv4 private/reserved ranges
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10) return false;                          // 10.0.0.0/8
    if (a === 127) return false;                         // 127.0.0.0/8
    if (a === 169 && b === 254) return false;            // 169.254.0.0/16 (link-local + AWS metadata)
    if (a === 172 && b >= 16 && b <= 31) return false;   // 172.16.0.0/12
    if (a === 192 && b === 168) return false;            // 192.168.0.0/16
    if (a === 0) return false;                           // 0.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return false;  // 100.64.0.0/10 (CGNAT)
    if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 (benchmarking)
    if (a === 240) return false;                         // 240.0.0.0/4 (reserved)
  }

  // Block hostnames that are just decimal/octal/hex IP encodings (e.g. http://2130706433 = 127.0.0.1)
  if (/^\d+$/.test(host) || /^0x[\da-f]+$/i.test(host)) return false;

  return true;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Write cookies to a temp file once at startup if YT_COOKIES env var is set
let cookiesPath = null;
if (process.env.YT_COOKIES) {
  cookiesPath = require('path').join(require('os').tmpdir(), 'yt-cookies.txt');
  require('fs').writeFileSync(cookiesPath, process.env.YT_COOKIES);
  console.log('YouTube cookies loaded from YT_COOKIES env var');
}

// Build cookie args: use file if YT_COOKIES env var is set, otherwise no cookies.
// --cookies-from-browser was removed: it causes yt-dlp to abort on systems where
// Chrome's keychain is inaccessible (e.g. headless servers, macOS without UI).
const cookieArgs = cookiesPath ? ['--cookies', cookiesPath] : [];

// Resolve Node.js path for yt-dlp JS runtime (avoids "no runtime found" warning)
const { execFileSync } = require('child_process');
let nodePath = 'node';
try { nodePath = execFileSync('which', ['node'], { encoding: 'utf8' }).trim(); } catch {}
const jsRuntimeArgs = ['--js-runtimes', `node:${nodePath}`];

// Webshare residential proxy (bypasses YouTube datacenter IP blocking)
const proxyArgs = process.env.WEBSHARE_PROXY_URL ? ['--proxy', process.env.WEBSHARE_PROXY_URL] : [];
if (process.env.WEBSHARE_PROXY_URL) console.log('Webshare proxy loaded');
else console.log('No proxy configured — running without proxy');

// AI fallback download quality (Whisper source audio).
// Higher quality by default; can be tuned via env vars.
const ytdlpAudioQuality = process.env.YTDLP_AUDIO_QUALITY || '0'; // 0 best, 9 smallest
const ytdlpAudioFormat = process.env.YTDLP_AUDIO_FORMAT || 'bestaudio';

app.disable('x-powered-by');
app.set('trust proxy', 1); // Trust Railway/Cloudflare's X-Forwarded-For so req.ip is the real client IP
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Redirect www → non-www (canonical domain)
app.use((req, res, next) => {
  if (req.hostname && req.hostname.startsWith('www.')) {
    const nonWww = req.hostname.slice(4);
    return res.redirect(301, `${req.protocol}://${nonWww}${req.originalUrl}`);
  }
  next();
});

// ── Security headers ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // HSTS: only set over HTTPS (Railway sets x-forwarded-proto; direct TLS sets req.protocol)
  if (req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

// ── Redirect .html → clean canonical URL (must run before static middleware) ──
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const clean = req.path.slice(0, -5) || '/';
    return res.redirect(301, clean);
  }
  next();
});

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
  if (err?.code === 'ENOENT') return 'Transcript extraction tool (yt-dlp) is not installed on this server.';
  const msg = (err?.stderr || err?.message || '').toLowerCase();
  const missingBinary =
    (msg.includes('spawn yt-dlp') && msg.includes('enoent')) ||
    (msg.includes('yt-dlp') && msg.includes(': not found')) ||
    (msg.includes('yt-dlp') && msg.includes('no such file or directory') && msg.includes('spawn'));
  if (missingBinary)
    return 'Transcript extraction tool (yt-dlp) is not installed on this server.';
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
app.get('/api/transcript', transcriptRateLimit, async (req, res) => {
  const { videoId, url, platform = 'youtube' } = req.query; // lang param ignored while translation is on ice
  console.log(`[transcript] platform=${platform} videoId=${videoId || url} proxy=${!!process.env.WEBSHARE_PROXY_URL}`);
  // LANGUAGE TRANSLATION ON ICE — force English until the feature is stable
  const safeLang = 'en'; // was: lang && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,10})?$/.test(lang) ? lang : 'en';
  const tmpDir = os.tmpdir();
  const isVimeo = platform === 'vimeo';
  const isYouTube = platform === 'youtube';
  const isGeneric = !isVimeo && !isYouTube; // TikTok, Twitter, Instagram, Twitch, etc.
  const vimeoMatch = isVimeo ? (url || '').match(/vimeo\.com\/(\d+)/) : null;

  // Validate inputs before starting SSE response to avoid headers-sent crashes.
  if (isVimeo) {
    if (!vimeoMatch) return res.status(400).json({ error: 'Invalid Vimeo URL' });
  } else if (isGeneric) {
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });
    if (!isSafeExternalUrl(url)) return res.status(400).json({ error: 'Invalid or disallowed URL' });
  } else {
    if (!videoId) return res.status(400).json({ error: 'Missing videoId parameter' });
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId))
      return res.status(400).json({ error: 'Invalid videoId format' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx/Railway proxy buffering so events stream in real-time
  res.flushHeaders();

  // ── Server-side credit check ────────────────────────────────────────────────
  // Run this after SSE headers so "out of credits" can be emitted as an SSE
  // event (instead of an opaque EventSource network error on the client).
  const { ok: creditOk, user: creditUser, creditInfo } = await checkAndDeductCredit(req, res);
  if (!creditOk) return; // checkAndDeductCredit already wrote out_of_credits + ended

  // Inject updated credit counts into every 'done' event so the client can
  // sync without an extra round-trip.
  const send = (event, data) => {
    const payload = (event === 'done' && creditUser && creditInfo) ? { ...data, credits: creditInfo } : data;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
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
        send('transcript_error', { error: 'No captions found for this Vimeo video and AI transcription is not configured.' });
        res.end();
        return;
      }

      send('progress', { stage: 'audio', message: 'No captions — downloading audio for AI transcription…', percent: 30 });
      const audioBase = path.join(tmpDir, `${filePrefix}_audio`);

      try {
        await execFileAsync('yt-dlp', [
          '--extract-audio', '--audio-format', 'mp3', '--audio-quality', ytdlpAudioQuality,
          '--format', ytdlpAudioFormat,
          ...jsRuntimeArgs, ...proxyArgs,
          '-o', audioBase,
          vimeoUrl,
        ], { timeout: 300000 });
      } catch (err) {
        const friendly = classifyYtdlpError(err);
        send('transcript_error', { error: friendly || 'Failed to download Vimeo audio', details: friendly ? undefined : err.message });
        res.end();
        return;
      }

      // ── Stage 3: Groq Whisper ─────────────────────────────────────────────
      send('progress', { stage: 'whisper', message: 'Transcribing with Groq Whisper AI…', percent: 60 });
      const audioFile = `${audioBase}.mp3`;
      const audioStat = await fsPromises.stat(audioFile).catch(() => null);
      if (!audioStat || audioStat.size > 24 * 1024 * 1024) {
        await fsPromises.unlink(audioFile).catch(() => {});
        send('transcript_error', { error: 'Audio file too large for AI transcription (max ~25 min). Try a shorter video.' });
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
      send('transcript_error', { error: 'Failed to fetch Vimeo transcript', details: error.message });
      res.end();
    }
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GENERIC PLATFORM (TikTok, Twitter/X, Instagram, Facebook, Loom,
  //                   Wistia, Dailymotion, and any other yt-dlp-supported URL)
  if (isGeneric) {
    const filePrefix = `gen_${Date.now()}`;
    const outputTemplate = path.join(tmpDir, filePrefix);

    // Thumbnail via noembed.com (supports most platforms)
    const thumbnailPromise = fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.thumbnail_url || null)
      .catch(() => null);

    try {
      // ── Stage 1: yt-dlp subtitles ─────────────────────────────────────────
      send('progress', { stage: 'subtitles', message: 'Looking for captions…', percent: 15 });
      try {
        await execFileAsync('yt-dlp', [
          '--skip-download', '--write-auto-sub', '--write-subs',
          ...jsRuntimeArgs, ...proxyArgs,
          '-o', outputTemplate,
          url,
        ], { timeout: 45000 });
      } catch {}

      const subFile = (await fsPromises.readdir(tmpDir)).find(
        f => f.startsWith(filePrefix) && (f.endsWith('.vtt') || f.endsWith('.json3') || f.endsWith('.srt'))
      );

      if (subFile) {
        send('progress', { stage: 'subtitles', message: 'Parsing captions…', percent: 80 });
        const content = await fsPromises.readFile(path.join(tmpDir, subFile), 'utf-8');
        await fsPromises.unlink(path.join(tmpDir, subFile)).catch(() => {});
        const result = subFile.endsWith('.json3') ? parseJSON3(content) : parseVTT(content);
        const thumbnail = await thumbnailPromise;
        send('done', { transcript: result.transcript, segments: result.segments, source: 'subtitles', thumbnail });
        res.end();
        return;
      }

      // ── Stage 2: Audio download ───────────────────────────────────────────
      if (!process.env.GROQ_API_KEY) {
        send('transcript_error', { error: 'No captions found for this video and AI transcription is not configured.' });
        res.end();
        return;
      }

      send('progress', { stage: 'audio', message: 'No captions — downloading audio for AI transcription…', percent: 30 });
      const audioBase = path.join(tmpDir, `${filePrefix}_audio`);

      try {
        await execFileAsync('yt-dlp', [
          '--extract-audio', '--audio-format', 'mp3', '--audio-quality', ytdlpAudioQuality,
          '--format', ytdlpAudioFormat,
          ...jsRuntimeArgs, ...proxyArgs,
          '-o', audioBase,
          url,
        ], { timeout: 300000 });
      } catch (err) {
        const friendly = classifyYtdlpError(err);
        send('transcript_error', { error: friendly || 'Failed to download audio', details: friendly ? undefined : err.message });
        res.end();
        return;
      }

      // ── Stage 3: Groq Whisper ─────────────────────────────────────────────
      send('progress', { stage: 'whisper', message: 'Transcribing with Groq Whisper AI…', percent: 60 });
      const audioFile = `${audioBase}.mp3`;
      const audioStat = await fsPromises.stat(audioFile).catch(() => null);
      if (!audioStat || audioStat.size > 24 * 1024 * 1024) {
        await fsPromises.unlink(audioFile).catch(() => {});
        send('transcript_error', { error: 'Audio file too large for AI transcription (max ~25 min). Try a shorter video.' });
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
      send('transcript_error', { error: 'Failed to fetch transcript', details: error.message });
      res.end();
    }
    return;
  }

  // YOUTUBE
  const outputTemplate = path.join(tmpDir, videoId);

  try {
    // ── Stage 1a: (reserved for future fast-path — currently falls through to yt-dlp) ──

    // ── Stage 1b: yt-dlp subtitles (primary fast path) ───────────────────────
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
      if (friendly) { send('transcript_error', { error: friendly }); res.end(); return; }
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

    // ── Stage 1c: Supadata API (fallback for edge cases / missing captions) ──
    // Keep this bounded so it doesn't add large latency on normal requests.
    if (process.env.SUPADATA_API_KEY) {
      try {
        send('progress', { stage: 'subtitles', message: 'Trying backup caption source…', percent: 35 });
        const supadata = new Supadata({ apiKey: process.env.SUPADATA_API_KEY });
        let result = await supadata.transcript({ url: `https://www.youtube.com/watch?v=${videoId}`, lang: safeLang, mode: 'native' });
        if (result && 'jobId' in result) {
          const maxPolls = Math.max(1, parseInt(process.env.SUPADATA_MAX_POLLS || '6', 10));
          const pollMs = Math.max(1000, parseInt(process.env.SUPADATA_POLL_MS || '2500', 10));
          for (let i = 0; i < maxPolls; i++) {
            await new Promise(r => setTimeout(r, pollMs));
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
        // Fall through to audio/whisper
      }
    }

    // ── Stage 2: download audio ───────────────────────────────────────────────
    if (!process.env.GROQ_API_KEY) {
      send('transcript_error', { error: 'No captions found for this video and AI transcription is not configured.' });
      res.end();
      return;
    }

    send('progress', { stage: 'audio', message: 'No captions found — downloading audio for AI transcription…', percent: 30 });
    const audioBase = path.join(tmpDir, `${videoId}_audio`);
    await execFileAsync('yt-dlp', [
      '--extract-audio', '--audio-format', 'mp3', '--audio-quality', ytdlpAudioQuality,
      '--format', ytdlpAudioFormat,
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
      send('transcript_error', { error: 'Audio file too large for AI transcription (max 24 MB). Try a shorter video.' });
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
    send('transcript_error', { error: friendly || 'Failed to fetch transcript', details: friendly ? undefined : error.message });
    res.end();
  }
});

// ── AI summary endpoint ───────────────────────────────────────────────────────
app.post('/api/summarize', aiRateLimit, async (req, res) => {
  const { transcript, platform } = req.body;
  if (!transcript || typeof transcript !== 'string')
    return res.status(400).json({ error: 'Missing transcript' });
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY)
    return res.status(503).json({ error: 'AI summary is not configured (missing GROQ_API_KEY or OPENROUTER_API_KEY)' });

  const platformLabels = { youtube: 'YouTube', vimeo: 'Vimeo', tiktok: 'TikTok', twitter: 'Twitter/X', instagram: 'Instagram', dailymotion: 'Dailymotion', facebook: 'Facebook', loom: 'Loom', wistia: 'Wistia' };
  const source = `${platformLabels[platform] || 'video'} video`;
  try {
    const text = await aiComplete(
      `Summarize the following ${source} transcript into clear bullet points. Focus on the key topics, main arguments, and important takeaways. Be concise.\n\nTranscript:\n${transcript.slice(0, 15000)}`
    );
    res.json({ summary: text });
  } catch (err) {
    res.status(500).json({ error: 'Failed to summarize', details: safeErr(err) });
  }
});

// ── Chapters endpoint ─────────────────────────────────────────────────────────
app.post('/api/timeline', aiRateLimit, async (req, res) => {
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
    res.status(500).json({ error: 'Failed to generate timeline', details: safeErr(err) });
  }
});

// ── Flashcards endpoint ───────────────────────────────────────────────────────
app.post('/api/flashcards', aiRateLimit, async (req, res) => {
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
    res.status(500).json({ error: 'Failed to generate flashcards', details: safeErr(err) });
  }
});

// ── Study guide endpoint ──────────────────────────────────────────────────────
app.post('/api/study-guide', aiRateLimit, async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || typeof transcript !== 'string')
    return res.status(400).json({ error: 'Missing transcript' });
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY)
    return res.status(503).json({ error: 'AI not configured (missing GROQ_API_KEY or OPENROUTER_API_KEY)' });

  try {
    const raw = await aiComplete(
      `You create structured study guides from YouTube video transcripts. Return ONLY a valid JSON object with exactly these fields — no markdown, no explanation:\n- "overview": 1-2 sentence description of what this video teaches\n- "objectives": array of 3-5 learning objectives starting with action verbs (Understand, Identify, Apply, Analyze, Explain)\n- "keyConcepts": array of 4-8 objects with "term" (string) and "definition" (string, 1-2 sentences)\n- "sections": array of 3-5 objects with "title" (string), "summary" (2-3 sentences), and "keyPoints" (array of 2-4 strings)\n- "reviewQuestions": array of 4-6 thoughtful questions to test understanding\n\nTranscript:\n${transcript.slice(0, 8000)}\n\nReturn JSON object only.`,
      2000
    );
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Failed to parse study guide response. Raw: ${raw.slice(0, 200)}`);
    const studyGuide = JSON.parse(match[0]);
    res.json(studyGuide);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate study guide', details: safeErr(err) });
  }
});

// ── Academic Insights endpoint ────────────────────────────────────────────────
app.post('/api/academic-insights', aiRateLimit, async (req, res) => {
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
    res.status(500).json({ error: 'Failed to generate academic insights', details: safeErr(err) });
  }
});

// ── Discover endpoint ─────────────────────────────────────────────────────────
app.post('/api/discover', aiRateLimit, async (req, res) => {
  const { transcript, videoId, title } = req.body;
  if (!transcript || typeof transcript !== 'string')
    return res.status(400).json({ error: 'Missing transcript' });

  try {
    // Step 1: Extract separate optimised queries for video search and academic papers
    const kwRaw = await aiComplete(
      `Analyse this transcript${title ? ` titled "${title}"` : ''} and return a JSON object with three fields — no markdown, no explanation:
{
  "videoQuery": "2-5 word YouTube search phrase that would find highly relevant videos on the exact same topic",
  "paperQuery": "specific academic search query (topic + field) for finding research papers on the core subject",
  "keywords": ["topic tag 1", "topic tag 2", "topic tag 3"]
}

Transcript:\n${transcript.slice(0, 6000)}`,
      300
    );
    const kwMatch = kwRaw.match(/\{[\s\S]*\}/);
    const parsed = kwMatch ? JSON.parse(kwMatch[0]) : {};
    const videoQuery = (parsed.videoQuery || title || '').trim();
    const paperQuery = (parsed.paperQuery || parsed.videoQuery || '').trim();
    const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.filter(k => typeof k === 'string') : [];
    if (!videoQuery && !paperQuery) return res.json({ keywords: [], videos: [], papers: [] });

    // Step 2: Parallel search — YouTube + Semantic Scholar + CrossRef
    const [ytResult, ssResult, crResult] = await Promise.allSettled([
      process.env.YOUTUBE_API_KEY && videoQuery
        ? fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(videoQuery)}&type=video&maxResults=8&key=${process.env.YOUTUBE_API_KEY}`)
            .then(r => r.json())
        : Promise.resolve(null),
      paperQuery
        ? fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(paperQuery)}&limit=5&fields=title,authors,year,abstract,externalIds,openAccessPdf`, {
            headers: { 'User-Agent': 'ScribeSnap/1.0' }
          }).then(r => r.json())
        : Promise.resolve(null),
      paperQuery
        ? fetch(`https://api.crossref.org/works?query=${encodeURIComponent(paperQuery)}&rows=5&select=DOI,title,author,published,abstract`, {
            headers: { 'User-Agent': 'ScribeSnap/1.0 (mailto:hello@scribesnap.io)' }
          }).then(r => r.json())
        : Promise.resolve(null),
    ]);

    // Parse YouTube results — exclude current video
    const videos = (ytResult.status === 'fulfilled' && ytResult.value?.items)
      ? ytResult.value.items
          .filter(item => item.id?.videoId && item.id.videoId !== videoId)
          .slice(0, 6)
          .map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
            description: item.snippet.description?.slice(0, 120),
          }))
      : [];

    // Parse Semantic Scholar results
    const ssPapers = (ssResult.status === 'fulfilled' && ssResult.value?.data)
      ? ssResult.value.data.map(p => ({
          paperId: p.paperId,
          title: p.title,
          authors: p.authors?.map(a => a.name) || [],
          year: p.year || null,
          abstract: p.abstract ? p.abstract.slice(0, 220) + (p.abstract.length > 220 ? '…' : '') : null,
          doi: p.externalIds?.DOI || null,
          pdfUrl: p.openAccessPdf?.url || null,
          source: 'ss',
        }))
      : [];

    // Parse CrossRef results
    const crPapers = (crResult.status === 'fulfilled' && crResult.value?.message?.items)
      ? crResult.value.message.items
          .filter(item => item.title?.length)
          .map(item => ({
            paperId: item.DOI,
            title: Array.isArray(item.title) ? item.title[0] : item.title,
            authors: (item.author || []).slice(0, 5).map(a => [a.given, a.family].filter(Boolean).join(' ')),
            year: item.published?.['date-parts']?.[0]?.[0] || null,
            abstract: item.abstract ? item.abstract.replace(/<[^>]*>/g, '').slice(0, 220) + '…' : null,
            doi: item.DOI || null,
            pdfUrl: null,
            source: 'cr',
          }))
      : [];

    // Merge: prefer SS papers, fill remainder from CrossRef, dedupe by title prefix
    const seenTitles = new Set();
    const papers = [];
    for (const p of [...ssPapers, ...crPapers]) {
      const key = p.title?.slice(0, 40).toLowerCase();
      if (key && !seenTitles.has(key) && papers.length < 6) {
        seenTitles.add(key);
        papers.push(p);
      }
    }

    res.json({ keywords, videos, papers });
  } catch (err) {
    res.status(500).json({ error: 'Failed to discover related content', details: safeErr(err) });
  }
});

// ── Q&A endpoint ─────────────────────────────────────────────────────────────
app.post('/api/ask', aiRateLimit, async (req, res) => {
  const { transcript, question, platform, segments, history } = req.body;
  if (!transcript || typeof transcript !== 'string' || !question || typeof question !== 'string')
    return res.status(400).json({ error: 'Missing transcript or question' });
  if (question.length > 500)
    return res.status(400).json({ error: 'Question too long' });
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY)
    return res.status(503).json({ error: 'AI not configured (missing GROQ_API_KEY or OPENROUTER_API_KEY)' });

  try {
    const platformLabels = { youtube: 'YouTube', vimeo: 'Vimeo', tiktok: 'TikTok', twitter: 'Twitter/X', instagram: 'Instagram', dailymotion: 'Dailymotion', facebook: 'Facebook', loom: 'Loom', wistia: 'Wistia' };
    const source = `${platformLabels[platform] || 'video'} video`;

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
    res.status(500).json({ error: 'Failed to answer', details: safeErr(err) });
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

// ── Local file upload transcription ───────────────────────────────────────────
app.post('/api/transcript/upload', uploadRateLimit, (req, res) => {
  uploadMiddleware(req, res, async (multerErr) => {
    // Reject invalid uploads BEFORE touching credits or SSE headers so we
    // can still return plain JSON errors and no credit is wasted.
    if (multerErr) {
      const isSize = multerErr.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        error: isSize
          ? 'File exceeds 500 MB. Please trim or compress the video first.'
          : multerErr.message || 'Upload failed',
      });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received.' });

    // Credit check BEFORE SSE headers so we can still send a JSON 402 response.
    const { ok: creditOk, user: creditUser, creditInfo } = await checkAndDeductCredit(req, res);
    if (!creditOk) {
      await fsPromises.unlink(req.file.path).catch(() => {});
      return;
    }

    // SSE headers must be sent before any write
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event, data) => {
      const payload = (event === 'done' && creditUser && creditInfo) ? { ...data, credits: creditInfo } : data;
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const uploadedFile = req.file.path;

    if (!process.env.GROQ_API_KEY) {
      await fsPromises.unlink(uploadedFile).catch(() => {});
      send('transcript_error', { error: 'AI transcription is not configured on this server.' });
      return res.end();
    }

    let compressedFile = null;
    try {
      send('progress', { stage: 'upload', message: 'File received — extracting audio…', percent: 20 });
      compressedFile = await compressForWhisper(uploadedFile);
      await fsPromises.unlink(uploadedFile).catch(() => {});  // free disk space immediately

      send('progress', { stage: 'whisper', message: 'Transcribing with Groq Whisper AI…', percent: 55 });
      const { transcript, segments } = await whisperTranscribe(compressedFile, 'en');
      // whisperTranscribe unlinks compressedFile itself on success

      send('progress', { stage: 'whisper', message: 'Finalising transcript…', percent: 90 });
      send('done', { transcript, segments, source: 'whisper', thumbnail: null });
      res.end();
    } catch (err) {
      await fsPromises.unlink(uploadedFile).catch(() => {});
      if (compressedFile) await fsPromises.unlink(compressedFile).catch(() => {});
      send('transcript_error', { error: 'Transcription failed', details: safeErr(err) });
      res.end();
    }
  });
});

// Unknown API routes should return JSON 404
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Redirect .html URLs to clean URLs (prevents duplicate content)
const htmlRedirects = [
  'youtube-transcript', 'youtube-summarizer', 'vimeo-transcript',
  'tiktok-transcript', 'loom-transcript', 'instagram-transcript',
  'facebook-transcript', 'twitter-transcript', 'transcribe-audio',
  'transcribe-video', 'privacy',
];
htmlRedirects.forEach(slug => {
  app.get(`/${slug}.html`, (_req, res) => res.redirect(301, `/${slug}`));
});

// Privacy policy static route
app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'privacy.html'));
});

// SEO landing pages — served from client/public so they work before and after build
app.get('/youtube-transcript', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/public', 'youtube-transcript.html'));
});
app.get('/youtube-summarizer', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/public', 'youtube-summarizer.html'));
});
app.get('/vimeo-transcript', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/public', 'vimeo-transcript.html'));
});
app.get('/tiktok-transcript', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/public', 'tiktok-transcript.html'));
});
app.get('/loom-transcript', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/public', 'loom-transcript.html'));
});
app.get('/instagram-transcript', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/public', 'instagram-transcript.html'));
});
app.get('/facebook-transcript', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/public', 'facebook-transcript.html'));
});
app.get('/twitter-transcript', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/public', 'twitter-transcript.html'));
});
app.get('/transcribe-audio', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/public', 'transcribe-audio.html'));
});
app.get('/transcribe-video', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client/public', 'transcribe-video.html'));
});

// Studio route — serves the SPA (noindex handled client-side)
app.get('/studio', (_req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// Unknown web routes get branded 404 page
app.get('*', (_req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'client/build', '404.html'));
});

// ── Global error guards ───────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1); // Let the process manager (Railway / nodemon) restart
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
