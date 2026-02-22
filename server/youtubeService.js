const YT_API = 'https://www.googleapis.com/youtube/v3';

function apiKey() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error('YOUTUBE_API_KEY not configured');
  return k;
}

function parseDuration(iso) {
  const m = (iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

async function resolveChannelId(channelUrl) {
  const key = apiKey();
  const url = new URL(channelUrl);
  const p = url.pathname;

  if (p.startsWith('/channel/')) return p.slice(9).split('/')[0];

  let handle = null;
  if (p.startsWith('/@')) handle = p.slice(2).split('/')[0];
  else if (p.startsWith('/c/')) handle = p.slice(3).split('/')[0];
  else if (p.startsWith('/user/')) handle = p.slice(6).split('/')[0];
  else handle = p.split('/').filter(Boolean)[0];

  if (!handle) throw new Error(`Cannot parse channel URL: ${channelUrl}`);

  const res = await fetch(`${YT_API}/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${key}`);
  const data = await res.json();
  if (data.items?.[0]?.id) return data.items[0].id;

  const res2 = await fetch(`${YT_API}/search?part=id&q=${encodeURIComponent(handle)}&type=channel&maxResults=1&key=${key}`);
  const data2 = await res2.json();
  if (data2.items?.[0]?.id?.channelId) return data2.items[0].id.channelId;

  throw new Error(`Could not resolve channel: ${channelUrl}`);
}

async function getUploadsPlaylist(channelId) {
  const key = apiKey();
  const res = await fetch(`${YT_API}/channels?part=contentDetails&id=${channelId}&key=${key}`);
  const data = await res.json();
  const pl = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!pl) throw new Error('Could not find uploads playlist');
  return pl;
}

async function listVideoIds(playlistId, maxResults) {
  const key = apiKey();
  const ids = [];
  let pageToken = '';

  while (ids.length < maxResults) {
    const n = Math.min(50, maxResults - ids.length);
    let url = `${YT_API}/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${n}&key=${key}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'YouTube API error');
    if (!data.items?.length) break;

    for (const item of data.items) {
      const vid = item.snippet.resourceId?.videoId;
      if (vid && item.snippet.title !== 'Private video' && item.snippet.title !== 'Deleted video') {
        ids.push(vid);
      }
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return ids.slice(0, maxResults);
}

async function getVideoDetails(videoIds) {
  const key = apiKey();
  const details = {};

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const res = await fetch(
      `${YT_API}/videos?part=snippet,statistics,contentDetails&id=${batch.join(',')}&key=${key}`
    );
    const data = await res.json();

    for (const item of (data.items || [])) {
      const s = item.snippet;
      const st = item.statistics;
      details[item.id] = {
        title: s.title,
        description: s.description || '',
        release_date: s.publishedAt,
        thumbnail_url: s.thumbnails?.high?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
        view_count: parseInt(st.viewCount || '0', 10),
        like_count: parseInt(st.likeCount || '0', 10),
        comment_count: parseInt(st.commentCount || '0', 10),
        duration: parseDuration(item.contentDetails?.duration),
      };
    }
  }

  return details;
}

const { getTranscriptWithYtDlp, isYtDlpAvailable } = require('./transcriptService');

/**
 * Fetch transcript for a video. Tries yt-dlp first (more reliable),
 * then falls back to the youtube-transcript npm package.
 * Returns { transcript, transcript_status, transcript_error }
 */
async function getTranscript(videoId, timeoutMs = 30000) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Primary: yt-dlp
  if (isYtDlpAvailable()) {
    try {
      const result = await getTranscriptWithYtDlp(videoUrl, 'en', timeoutMs);
      if (result.status === 'ok') {
        return { transcript: result.transcript, transcript_status: 'ok', transcript_error: null };
      }
      if (result.status === 'unavailable') {
        // yt-dlp ran but found no subs — skip fallback since it's authoritative
        return { transcript: null, transcript_status: 'unavailable', transcript_error: result.error };
      }
      // fetch_failed — try fallback
    } catch { /* fall through to fallback */ }
  }

  // Fallback: youtube-transcript npm
  try {
    const { YoutubeTranscript } = require('youtube-transcript');
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    const text = segments.map((s) => s.text).join(' ').trim();
    if (text.length > 20) {
      return { transcript: text, transcript_status: 'ok', transcript_error: null };
    }
    return { transcript: null, transcript_status: 'unavailable', transcript_error: 'fallback returned empty' };
  } catch (err) {
    return { transcript: null, transcript_status: 'fetch_failed', transcript_error: err.message?.slice(0, 120) || 'unknown' };
  }
}

module.exports = {
  resolveChannelId,
  getUploadsPlaylist,
  listVideoIds,
  getVideoDetails,
  getTranscript,
  isYtDlpAvailable,
};
