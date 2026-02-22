const API = process.env.REACT_APP_API_URL || process.env.REACT_APP_API_BASE_URL || '';

export const CODE_KEYWORDS =
  /\b(plot|chart|graph|analyz|statistic|regression|correlat|histogram|visualiz|calculat|compute|run code|write code|execute|pandas|numpy|matplotlib|csv|data)\b/i;

export const streamChat = async function* (
  history,
  newMessage,
  imageParts = [],
  useCodeExecution = false,
  userInfo = null
) {
  const res = await fetch(`${API}/api/gemini/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, message: newMessage, imageParts, useCodeExecution, userInfo }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || res.statusText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line); } catch { /* skip */ }
    }
  }

  if (buffer.trim()) {
    try { yield JSON.parse(buffer); } catch { /* skip */ }
  }
};

export const chatWithTools = async (history, newMessage, channelData = [], imageParts = [], userInfo = null) => {
  const res = await fetch(`${API}/api/gemini/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, message: newMessage, channelData, imageParts, userInfo }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || res.statusText);
  }

  return res.json();
};
