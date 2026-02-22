// Server-side CSV tool execution — ported from src/services/csvTools.js
// Pure JS, no browser APIs.

const COL_NOTE =
  'Use the exact column name as it appears in the [CSV columns: ...] header at the top of the message.';

const resolveCol = (rows, name) => {
  if (!rows.length || !name) return name;
  const keys = Object.keys(rows[0]);
  if (keys.includes(name)) return name;
  const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const target = norm(name);
  return keys.find((k) => norm(k) === target) || name;
};

const numericValues = (rows, col) =>
  rows.map((r) => parseFloat(r[col])).filter((v) => !isNaN(v));

const median = (sorted) =>
  sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

const fmt = (n) => +n.toFixed(4);

exports.CSV_TOOL_DECLARATIONS = [
  {
    name: 'compute_column_stats',
    description: 'Compute descriptive statistics (mean, median, std, min, max, count) for a numeric column. ' + COL_NOTE,
    parameters: {
      type: 'OBJECT',
      properties: {
        column: {
          type: 'STRING',
          description: 'Exact column name copied from [CSV columns: ...].',
        },
      },
      required: ['column'],
    },
  },
  {
    name: 'get_value_counts',
    description: 'Count occurrences of each unique value in a column (for categorical data). ' + COL_NOTE,
    parameters: {
      type: 'OBJECT',
      properties: {
        column: { type: 'STRING', description: 'Exact column name.' },
        top_n: { type: 'NUMBER', description: 'How many top values to return (default 10)' },
      },
      required: ['column'],
    },
  },
  {
    name: 'get_top_tweets',
    description:
      'Return the top or bottom N tweets sorted by any metric, including "engagement". Returns tweet text + key metrics.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sort_column: { type: 'STRING', description: 'Metric to sort by.' },
        n: { type: 'NUMBER', description: 'Number of tweets to return (default 10).' },
        ascending: { type: 'BOOLEAN', description: 'false = highest first, true = lowest first.' },
      },
      required: ['sort_column'],
    },
  },
];

exports.executeTool = function executeTool(toolName, args, rows) {
  const availableHeaders = rows.length ? Object.keys(rows[0]) : [];

  switch (toolName) {
    case 'compute_column_stats': {
      const col = resolveCol(rows, args.column);
      const vals = numericValues(rows, col);
      if (!vals.length)
        return { error: `No numeric values in "${col}". Available: ${availableHeaders.join(', ')}` };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      return {
        column: col,
        count: vals.length,
        mean: fmt(mean),
        median: fmt(median(sorted)),
        std: fmt(Math.sqrt(variance)),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    case 'get_value_counts': {
      const col = resolveCol(rows, args.column);
      const topN = args.top_n || 10;
      const counts = {};
      rows.forEach((r) => {
        const v = r[col];
        if (v !== undefined && v !== '') counts[v] = (counts[v] || 0) + 1;
      });
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN);
      return {
        column: col,
        total_rows: rows.length,
        value_counts: Object.fromEntries(sorted),
      };
    }

    case 'get_top_tweets': {
      const sortCol = resolveCol(rows, args.sort_column) || args.sort_column;
      const n = args.n || 10;
      const asc = args.ascending ?? false;
      const textCol =
        availableHeaders.find((h) => /^text$/i.test(h)) ||
        availableHeaders.find((h) => /text|content|tweet|body/i.test(h));
      const favCol = availableHeaders.find((h) => /favorite.?count/i.test(h));
      const viewCol = availableHeaders.find((h) => /view.?count/i.test(h));
      const engCol = availableHeaders.includes('engagement') ? 'engagement' : null;

      const sorted = [...rows].sort((a, b) => {
        const av = parseFloat(a[sortCol]);
        const bv = parseFloat(b[sortCol]);
        if (!isNaN(av) && !isNaN(bv)) return asc ? av - bv : bv - av;
        return 0;
      });

      const topRows = sorted.slice(0, n).map((r, i) => {
        const out = { rank: i + 1 };
        if (textCol) out.text = String(r[textCol] || '').slice(0, 150);
        if (favCol) out[favCol] = r[favCol];
        if (viewCol) out[viewCol] = r[viewCol];
        if (engCol) out.engagement = r.engagement;
        return out;
      });

      if (!topRows.length)
        return { error: `No rows. Column "${sortCol}"? Available: ${availableHeaders.join(', ')}` };

      return {
        sort_column: sortCol,
        direction: asc ? 'ascending' : 'descending',
        count: topRows.length,
        tweets: topRows,
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
};
