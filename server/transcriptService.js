const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

let _ytDlpBinary = null;
let _ytDlpChecked = false;

function findYtDlp() {
  if (_ytDlpChecked) return _ytDlpBinary;
  _ytDlpChecked = true;
  for (const bin of ['yt-dlp', 'yt-dlp.exe']) {
    try {
      execFileSync(bin, ['--version'], { timeout: 5000, stdio: 'pipe' });
      _ytDlpBinary = bin;
      console.log(`[Transcript] yt-dlp found: ${bin}`);
      return _ytDlpBinary;
    } catch { /* not found, try next */ }
  }
  console.warn('[Transcript] yt-dlp not found on PATH — transcripts will use fallback');
  return null;
}

function isYtDlpAvailable() {
  return !!findYtDlp();
}

function makeTempDir() {
  const dir = path.join(os.tmpdir(), `ytdlp-subs-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* best-effort */ }
}

function runYtDlp(args, timeoutMs = 30000) {
  const bin = findYtDlp();
  if (!bin) return Promise.reject(new Error('yt-dlp not available'));

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('yt-dlp timed out'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim().split('\n').pop() || `yt-dlp exit ${code}`));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function findSubFile(dir) {
  try {
    const files = fs.readdirSync(dir);
    for (const ext of ['.en.vtt', '.vtt', '.en.srt', '.srt', '.en.ttml', '.ttml']) {
      const match = files.find((f) => f.endsWith(ext));
      if (match) return path.join(dir, match);
    }
    const subFile = files.find((f) => /\.(vtt|srt|ttml)$/i.test(f));
    if (subFile) return path.join(dir, subFile);
  } catch { /* empty */ }
  return null;
}

function parseVtt(text) {
  return text
    .replace(/^WEBVTT[\s\S]*?\n\n/, '')
    .replace(/\d{2}:\d{2}[:.]\d{3}\s*-->\s*\d{2}:\d{2}[:.]\d{3}[^\n]*/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^NOTE\s[\s\S]*?\n\n/gm, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+$/.test(l))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseSrt(text) {
  return text
    .replace(/\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}\r?\n/g, '')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+$/.test(l))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseTtml(text) {
  return text
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseSubFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.vtt') return parseVtt(raw);
  if (ext === '.srt') return parseSrt(raw);
  if (ext === '.ttml') return parseTtml(raw);
  return parseVtt(raw);
}

/**
 * Fetch transcript for a single video using yt-dlp.
 * Returns { transcript, status, error }
 *   status: "ok" | "unavailable" | "fetch_failed"
 */
async function getTranscriptWithYtDlp(videoUrl, lang = 'en', timeoutMs = 30000) {
  const tmpDir = makeTempDir();
  const tmpl = path.join(tmpDir, '%(id)s');

  try {
    // Attempt 1: manual (human-written) subtitles
    try {
      await runYtDlp([
        '--skip-download', '--write-subs', '--no-write-auto-subs',
        '--sub-langs', lang, '--sub-format', 'vtt/srt/ttml',
        '-o', tmpl, videoUrl,
      ], timeoutMs);
    } catch { /* may fail if no manual subs */ }

    let subFile = findSubFile(tmpDir);

    // Attempt 2: auto-generated captions
    if (!subFile) {
      try {
        await runYtDlp([
          '--skip-download', '--write-auto-subs', '--no-write-subs',
          '--sub-langs', lang, '--sub-format', 'vtt/srt/ttml',
          '-o', tmpl, videoUrl,
        ], timeoutMs);
      } catch { /* may fail */ }
      subFile = findSubFile(tmpDir);
    }

    if (!subFile) {
      return { transcript: null, status: 'unavailable', error: null };
    }

    const transcript = parseSubFile(subFile);
    if (!transcript || transcript.length < 20) {
      return { transcript: null, status: 'unavailable', error: 'subtitle file was empty' };
    }
    return { transcript, status: 'ok', error: null };

  } catch (err) {
    return { transcript: null, status: 'fetch_failed', error: err.message };
  } finally {
    cleanupDir(tmpDir);
  }
}

module.exports = { getTranscriptWithYtDlp, isYtDlpAvailable, findYtDlp };
