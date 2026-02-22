const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { streamChatInternal, chatWithToolsInternal } = require('./geminiProxy');
const { getGeminiModelName } = require('./geminiConfig');
const {
  resolveChannelId,
  getUploadsPlaylist,
  listVideoIds,
  getVideoDetails,
  getTranscript,
  isYtDlpAvailable,
} = require('./youtubeService');

const app = express();

const allowedOrigins = ['http://localhost:3000', process.env.CORS_ORIGIN].filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json({ limit: '10mb' }));

const URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.REACT_APP_MONGODB_URI ||
  process.env.REACT_APP_MONGO_URI;
const DB = 'chatapp';
let db;

async function connect() {
  const client = await MongoClient.connect(URI);
  db = client.db(DB);
  console.log('MongoDB connected');
}

// In production, serve the React build
const buildPath = path.join(__dirname, '..', 'build');
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  console.log('[Static] Serving React build from', buildPath);
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  let mongoConnected = false;
  try {
    if (db) {
      await db.command({ ping: 1 });
      mongoConnected = true;
    }
  } catch { /* not connected */ }

  res.json({
    ok: true,
    mongoConnected,
    youtubeKeyConfigured: !!process.env.YOUTUBE_API_KEY,
    ytDlpAvailable: isYtDlpAvailable(),
    env: {
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      YOUTUBE_API_KEY: !!process.env.YOUTUBE_API_KEY,
      ELEVENLABS_API_KEY: !!process.env.ELEVENLABS_API_KEY,
      MONGO_URI: !!URI,
    },
  });
});

app.get('/api/status', async (req, res) => {
  try {
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    res.json({ usersCount, sessionsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Transcript test (dev helper) ─────────────────────────────────────────────

app.get('/api/youtube/test-transcript', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url query param required (e.g. ?url=https://www.youtube.com/watch?v=094y1Z2wpJg)' });

    const videoId = url.includes('watch?v=')
      ? new URL(url).searchParams.get('v')
      : url.replace(/^.*[/=]/, '');

    if (!videoId) return res.status(400).json({ error: 'Could not extract video ID from URL' });

    const result = await getTranscript(videoId);
    res.json({
      videoId,
      transcript_status: result.transcript_status,
      transcript_error: result.transcript_error,
      transcript_length: result.transcript?.length || 0,
      transcript_preview: result.transcript?.slice(0, 500) || null,
      ytDlpAvailable: isYtDlpAvailable(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users ─────────────────────────────────────────────────────────────────────

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = String(username).trim().toLowerCase();
    const existing = await db.collection('users').findOne({ username: name });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({
      username: name,
      password: hashed,
      email: email ? String(email).trim().toLowerCase() : null,
      firstName: firstName ? String(firstName).trim() : null,
      lastName: lastName ? String(lastName).trim() : null,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = username.trim().toLowerCase();
    const user = await db.collection('users').findOne({ username: name });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({
      ok: true,
      username: name,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ──────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const sessions = await db.collection('sessions').find({ username }).sort({ createdAt: -1 }).toArray();
    res.json(
      sessions.map((s) => ({
        id: s._id.toString(),
        agent: s.agent || null,
        title: s.title || null,
        createdAt: s.createdAt,
        messageCount: (s.messages || []).length,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { username, agent, title } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const result = await db.collection('sessions').insertOne({
      username,
      agent: agent || null,
      title: title || null,
      createdAt: new Date().toISOString(),
      messages: [],
    });
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await db.collection('sessions').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/title', async (req, res) => {
  try {
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title: req.body.title } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages ──────────────────────────────────────────────────────────────────

app.post('/api/messages', async (req, res) => {
  try {
    const { session_id, role, content, imageData, charts, toolCalls } = req.body;
    if (!session_id || !role || content === undefined)
      return res.status(400).json({ error: 'session_id, role, content required' });
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(imageData && { imageData: Array.isArray(imageData) ? imageData : [imageData] }),
      ...(charts?.length && { charts }),
      ...(toolCalls?.length && { toolCalls }),
    };
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(session_id) },
      { $push: { messages: msg } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const doc = await db.collection('sessions').findOne({ _id: new ObjectId(session_id) });
    const raw = doc?.messages || [];
    const msgs = raw.map((m, i) => {
      const arr = m.imageData ? (Array.isArray(m.imageData) ? m.imageData : [m.imageData]) : [];
      return {
        id: `${doc._id}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        images: arr.length ? arr.map((img) => ({ data: img.data, mimeType: img.mimeType })) : undefined,
        charts: m.charts?.length ? m.charts : undefined,
        toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
      };
    });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI Proxy Routes ───────────────────────────────────────────────────────────

app.post('/api/gemini/stream', async (req, res) => {
  try {
    const { history, message, imageParts, useCodeExecution, userInfo } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of streamChatInternal(
      history || [],
      message,
      imageParts || [],
      !!useCodeExecution,
      userInfo || null
    )) {
      res.write(JSON.stringify(chunk) + '\n');
    }
    res.end();
  } catch (err) {
    console.error('[Gemini stream]', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

app.post('/api/gemini/chat', async (req, res) => {
  try {
    const { history, message, channelData, imageParts, userInfo } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const result = await chatWithToolsInternal(
      history || [],
      message,
      channelData || [],
      imageParts || [],
      userInfo || null
    );
    res.json(result);
  } catch (err) {
    console.error('[Gemini chat]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── YouTube Channel Download (NDJSON progress stream) ─────────────────────────

app.post('/api/youtube/download', async (req, res) => {
  try {
    const { channelUrl, maxVideos = 10 } = req.body;
    if (!channelUrl) return res.status(400).json({ error: 'channelUrl required' });
    if (!process.env.YOUTUBE_API_KEY)
      return res.status(503).json({ error: 'YOUTUBE_API_KEY not configured on server' });

    const max = Math.min(Math.max(1, parseInt(maxVideos) || 10), 100);

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (obj) => res.write(JSON.stringify(obj) + '\n');

    send({ type: 'status', message: 'Resolving channel...' });
    const channelId = await resolveChannelId(channelUrl);

    send({ type: 'status', message: 'Finding uploads playlist...' });
    const playlistId = await getUploadsPlaylist(channelId);

    send({ type: 'status', message: `Listing up to ${max} videos...` });
    const videoIds = await listVideoIds(playlistId, max);
    const total = videoIds.length;
    send({ type: 'status', message: `Found ${total} videos. Fetching details...` });

    const details = await getVideoDetails(videoIds);

    const videos = [];
    for (let i = 0; i < videoIds.length; i++) {
      const id = videoIds[i];
      const d = details[id];
      if (!d) continue;

      send({ type: 'progress', current: i + 1, total, title: d.title });

      let transcript = null;
      let transcript_status = 'unavailable';
      let transcript_error = null;
      try {
        const result = await getTranscript(id);
        transcript = result.transcript;
        transcript_status = result.transcript_status;
        transcript_error = result.transcript_error;
      } catch (err) {
        transcript_status = 'fetch_failed';
        transcript_error = err.message?.slice(0, 120) || 'unknown';
      }

      videos.push({
        video_id: id,
        title: d.title,
        description: (d.description || '').slice(0, 500),
        transcript,
        transcript_status,
        transcript_error,
        duration: d.duration,
        release_date: d.release_date,
        view_count: d.view_count,
        like_count: d.like_count,
        comment_count: d.comment_count,
        video_url: `https://www.youtube.com/watch?v=${id}`,
        thumbnail_url: d.thumbnail_url,
      });
    }

    send({ type: 'done', videos });
    res.end();
  } catch (err) {
    console.error('[YouTube download]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(JSON.stringify({ type: 'error', message: err.message }) + '\n');
      res.end();
    }
  }
});

// ── Image generation endpoint ─────────────────────────────────────────────────

app.post('/api/generate-image', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });

    const { prompt, anchor_description } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    let fullPrompt = prompt;
    if (anchor_description) fullPrompt += `\n\nStyle reference: ${anchor_description}`;

    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: fullPrompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
      }),
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || resp.statusText);

    const img = data.data?.[0];
    res.json({ imageBase64: img.b64_json, mimeType: 'image/png', revised_prompt: img.revised_prompt });
  } catch (err) {
    console.error('[GenerateImage]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── OpenAI & TTS (unchanged) ─────────────────────────────────────────────────

app.post('/api/openai', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
    const { prompt, model = 'gpt-4o-mini' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || resp.statusText);
    res.json({ text: data.choices?.[0]?.message?.content || '' });
  } catch (err) {
    console.error('[OpenAI]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'ELEVENLABS_API_KEY not configured' });
    const { text, voiceId = '21m00Tcm4TlvDq8ikWAM' } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, Accept: 'audio/mpeg' },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const audioBuffer = await resp.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error('[TTS]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SPA catch-all (must be last route) ────────────────────────────────────────

const indexHtml = path.join(__dirname, '..', 'build', 'index.html');
if (fs.existsSync(indexHtml)) {
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(indexHtml));
}

// ──────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

console.log('Env diagnostics:');
console.log('  GEMINI_API_KEY present?', process.env.GEMINI_API_KEY ? 'yes' : 'no');
console.log('  OPENAI_API_KEY present?', process.env.OPENAI_API_KEY ? 'yes' : 'no');
console.log('  YOUTUBE_API_KEY present?', process.env.YOUTUBE_API_KEY ? 'yes' : 'no');
console.log('  MONGO_URI present?', URI ? 'yes' : 'no');

connect()
  .then(async () => {
    if (process.env.GEMINI_API_KEY) {
      try { await getGeminiModelName(); } catch (err) {
        console.warn('[Startup] Gemini model init:', err.message);
      }
    }
    app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
