const YOUTUBE_TOOL_DECLARATIONS = [
  {
    name: 'generateImage',
    description:
      'Generate an image from a text prompt. If the user provided a reference/anchor image, include key visual details in anchor_description to guide style and composition.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: { type: 'STRING', description: 'Detailed text description of the image to generate.' },
        anchor_description: {
          type: 'STRING',
          description: 'Optional description of a reference/anchor image provided by the user to guide style.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'plot_metric_vs_time',
    description:
      'Plot a numeric metric vs release date from the loaded YouTube channel JSON. Use when user asks to chart, plot, visualize, or graph a metric over time.',
    parameters: {
      type: 'OBJECT',
      properties: {
        metric: {
          type: 'STRING',
          description: 'Numeric field to plot on Y-axis: view_count, like_count, comment_count, or duration.',
        },
        sort: { type: 'STRING', description: 'Sort by date: "asc" (oldest first) or "desc" (newest first). Default "asc".' },
        video_limit: { type: 'NUMBER', description: 'Max videos to include. Default: all.' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'play_video',
    description:
      'Find and display a video from the loaded YouTube channel data so the user can watch it. Supports lookup by title match (partial text), ordinal ("first", "second", "3rd"), or "most viewed".',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Title keyword, ordinal like "first"/"3rd", or "most viewed".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'compute_stats_json',
    description:
      'Compute descriptive statistics (mean, median, standard deviation, min, max, n) for any numeric field in the loaded YouTube channel JSON. Use for "average", "statistics", "distribution", etc.',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: {
          type: 'STRING',
          description: 'Numeric field name: view_count, like_count, comment_count, or duration.',
        },
      },
      required: ['field'],
    },
  },
];

// ── Tool execution ──────────────────────────────────────────────────────────

function resolveField(videos, field) {
  if (!videos.length || !field) return field;
  const keys = Object.keys(videos[0]);
  if (keys.includes(field)) return field;
  const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');
  return keys.find((k) => norm(k) === norm(field)) || field;
}

function numericValues(videos, field) {
  return videos.map((v) => parseFloat(v[field])).filter((n) => !isNaN(n));
}

function median(sorted) {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function fmt(n) {
  return +n.toFixed(4);
}

function computeStatsJson(args, videos) {
  const field = resolveField(videos, args.field);
  const vals = numericValues(videos, field);
  if (!vals.length) {
    const available = videos.length ? Object.keys(videos[0]).join(', ') : 'none';
    return { error: `No numeric values for "${field}". Available fields: ${available}` };
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sorted = [...vals].sort((a, b) => a - b);
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;

  return {
    _toolType: 'stats',
    field,
    n: vals.length,
    mean: fmt(mean),
    median: fmt(median(sorted)),
    std: fmt(Math.sqrt(variance)),
    min: Math.min(...vals),
    max: Math.max(...vals),
  };
}

function plotMetricVsTime(args, videos) {
  const metric = resolveField(videos, args.metric);
  const sortDir = (args.sort || 'asc').toLowerCase();
  const limit = args.video_limit || videos.length;

  const mapped = videos
    .filter((v) => v.release_date && v[metric] !== undefined && v[metric] !== null)
    .map((v) => ({
      date: v.release_date,
      title: (v.title || '').slice(0, 60),
      value: parseFloat(v[metric]),
      video_url: v.video_url || null,
    }))
    .filter((v) => !isNaN(v.value));

  mapped.sort((a, b) =>
    sortDir === 'desc'
      ? new Date(b.date) - new Date(a.date)
      : new Date(a.date) - new Date(b.date)
  );

  const data = mapped.slice(0, limit).map((v) => ({
    date: v.date.split('T')[0],
    title: v.title,
    [metric]: v.value,
    video_url: v.video_url,
  }));

  return {
    _toolType: 'chart',
    chartType: 'metric_vs_time',
    metric,
    data,
  };
}

const ORDINALS = {
  first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2,
  fourth: 3, '4th': 3, fifth: 4, '5th': 4, sixth: 5, '6th': 5,
  seventh: 6, '7th': 6, eighth: 7, '8th': 7, ninth: 8, '9th': 8,
  tenth: 9, '10th': 9, last: -1,
};

function playVideo(args, videos) {
  if (!videos.length) return { error: 'No channel data loaded.' };
  const q = (args.query || '').toLowerCase().trim();

  // "most viewed"
  if (q.includes('most viewed') || q.includes('most popular') || q.includes('top viewed')) {
    const sorted = [...videos].sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
    return videoResult(sorted[0]);
  }

  // "least viewed"
  if (q.includes('least viewed')) {
    const sorted = [...videos].sort((a, b) => (a.view_count || 0) - (b.view_count || 0));
    return videoResult(sorted[0]);
  }

  // ordinal
  for (const [word, idx] of Object.entries(ORDINALS)) {
    if (q.includes(word)) {
      const i = idx === -1 ? videos.length - 1 : idx;
      if (i >= 0 && i < videos.length) return videoResult(videos[i]);
      return { error: `Only ${videos.length} videos loaded.` };
    }
  }

  // title match (case-insensitive contains)
  const match = videos.find((v) => (v.title || '').toLowerCase().includes(q));
  if (match) return videoResult(match);

  // fuzzy: match any word
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const fuzzy = videos.find((v) => {
    const t = (v.title || '').toLowerCase();
    return words.some((w) => t.includes(w));
  });
  if (fuzzy) return videoResult(fuzzy);

  return { error: `No video matching "${args.query}" found in loaded data.` };
}

function videoResult(v) {
  const videoId = v.video_id || extractVideoId(v.video_url);
  return {
    _toolType: 'video',
    title: v.title,
    thumbnail_url: v.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    video_url: v.video_url || `https://www.youtube.com/watch?v=${videoId}`,
    video_id: videoId,
    view_count: v.view_count,
    like_count: v.like_count,
    duration: v.duration,
  };
}

function extractVideoId(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.searchParams.get('v') || u.pathname.split('/').pop() || '';
  } catch {
    return '';
  }
}

async function generateImageTool(args) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return { error: 'OPENAI_API_KEY not configured — cannot generate images.' };

  let prompt = args.prompt;
  if (args.anchor_description) {
    prompt += `\n\nStyle/composition reference: ${args.anchor_description}`;
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const errMsg = data.error?.message || res.statusText;
    return { error: `Image generation failed: ${errMsg}` };
  }

  const img = data.data?.[0];
  return {
    _toolType: 'image',
    imageBase64: img.b64_json,
    mimeType: 'image/png',
    prompt: args.prompt,
    revised_prompt: img.revised_prompt || args.prompt,
  };
}

async function executeTool(toolName, args, channelData) {
  const videos = channelData || [];

  switch (toolName) {
    case 'compute_stats_json':
      return computeStatsJson(args, videos);
    case 'plot_metric_vs_time':
      return plotMetricVsTime(args, videos);
    case 'play_video':
      return playVideo(args, videos);
    case 'generateImage':
      return generateImageTool(args);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

module.exports = { YOUTUBE_TOOL_DECLARATIONS, executeTool };
