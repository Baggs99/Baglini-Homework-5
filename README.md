# YouTube AI Chat Assistant — Homework 5

A React + Express chat app that lets you download YouTube channel metadata, analyze it with AI-powered tools, generate images, plot metrics over time, play videos, and compute statistics — all inside a conversational interface powered by Google Gemini.

## RUN INSTRUCTIONS

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in your keys:

```
GEMINI_API_KEY=your_gemini_api_key        # Required — Google AI Studio
OPENAI_API_KEY=your_openai_api_key        # Required for generateImage tool (DALL-E 3)
YOUTUBE_API_KEY=your_youtube_data_api_key  # Required for YouTube Channel Download tab
MONGO_URI=mongodb+srv://...               # Required — MongoDB Atlas connection string
ELEVENLABS_API_KEY=...                     # Optional — text-to-speech
REACT_APP_API_URL=                         # Leave blank for local dev
```

**How to get a YouTube Data API v3 key:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable "YouTube Data API v3" under APIs & Services
4. Create an API key under Credentials
5. Paste it as `YOUTUBE_API_KEY` in `.env`

### 2. Install yt-dlp (recommended — for reliable transcripts)

The app uses `yt-dlp` to download video subtitles/captions. Without it, a less reliable npm fallback is used.

**Windows:**
```
pip install yt-dlp
```
Or download the `.exe` from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) and place it on your PATH.

**macOS:**
```
brew install yt-dlp
```

**Linux:**
```
pip install yt-dlp
```

Verify it works: `yt-dlp --version`

### 3. Install & Start

```bash
npm install
npm start
```

This runs both the Express backend (port 3001) and React frontend (port 3000) via `concurrently`.

Open **http://localhost:3000** in your browser.

### 4. Quick Test — Each Requirement

| # | Requirement | How to Test |
|---|-------------|-------------|
| A | **Chat personalization** | Click "Create an account" → fill First Name + Last Name → create → log in. The AI addresses you by name. |
| B | **YouTube Channel Download** | Click the "YouTube Channel Download" tab → enter `https://www.youtube.com/@veritasium` → set max 10 → click "Download Channel Data". Watch the progress bar. Click "Save JSON" to download the file. |
| C | **JSON drag-and-drop** | Switch to "Chat" tab → drag `public/veritasium_10.json` (or the saved JSON) into the chat area. A badge appears. Send a message like "What videos are loaded?" |
| D | **generateImage** | With or without JSON loaded, type "Generate an image of a scientist looking at a blackboard" → the AI calls `generateImage` → image appears inline. Click to enlarge, click Download. |
| E | **plot_metric_vs_time** | Load JSON first, then type "Plot view count over time" → a line chart renders in chat. Click to enlarge + download. |
| F | **play_video** | Load JSON first, then type "Play the most viewed video" or "Play the electricity video" → a clickable video card appears with thumbnail. Click opens YouTube. |
| G | **compute_stats_json** | Load JSON first, then type "What are the average view counts?" → the AI calls `compute_stats_json` and reports mean, median, std, min, max. |
| H | **Prompt engineering** | See `public/prompt_chat.txt` — describes all 4 tools with exact names, inputs, and outputs. |

### 5. Pre-downloaded Sample Data

`public/veritasium_10.json` contains 10 Veritasium videos for quick testing without needing a YouTube API key. Drag this file into the chat to start analyzing immediately.

### 6. Sanity Check

After `npm start`, verify the backend is healthy:

```
curl http://localhost:3001/api/health
```

Expected response (all booleans should be `true` for full functionality):

```json
{
  "ok": true,
  "mongoConnected": true,
  "youtubeKeyConfigured": true,
  "ytDlpAvailable": true,
  "env": {
    "GEMINI_API_KEY": true,
    "OPENAI_API_KEY": true,
    "YOUTUBE_API_KEY": true,
    "ELEVENLABS_API_KEY": true,
    "MONGO_URI": true
  }
}
```

If `mongoConnected` is `false`, check your `MONGO_URI`. If `youtubeKeyConfigured` is `false`, the YouTube Channel Download tab will fail (but you can still drag `public/veritasium_10.json` into chat).

### 7. Deployment (Render)

The `render.yaml` blueprint defines two services:
- **chatapp-backend**: Express API (node, free tier)
- **chatapp-frontend**: React static site (free tier)

Set all env vars in the Render dashboard. Set `REACT_APP_API_URL` on the frontend to your backend URL (e.g., `https://chatapp-backend.onrender.com`).

## Architecture

```
React 19 (CRA)  ←→  Express 5  ←→  MongoDB Atlas
                         ↓
              Google Gemini (function calling)
              OpenAI DALL-E 3 (image generation)
              YouTube Data API v3 (channel download)
```

### Chat Tools (exact names for grading)

| Tool Name | Purpose |
|-----------|---------|
| `generateImage` | Generate images via DALL-E 3 with optional anchor image |
| `plot_metric_vs_time` | Chart any numeric metric vs release date (Recharts) |
| `play_video` | Find and display a clickable video card |
| `compute_stats_json` | Compute mean, median, std, min, max for any numeric field |
