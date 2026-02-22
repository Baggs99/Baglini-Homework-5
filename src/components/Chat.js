import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { streamChat, chatWithTools } from '../services/gemini';
import {
  getSessions, createSession, deleteSession, saveMessage, loadMessages,
} from '../services/mongoApi';
import './Chat.css';

function svgToPng(containerEl, filename = 'chart.png') {
  const svg = containerEl?.querySelector('svg');
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  const styles = document.createElement('style');
  styles.textContent = `* { font-family: Inter, system-ui, sans-serif; }`;
  clone.prepend(styles);
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    a.click();
  };
  img.src = url;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const chatTitle = () => {
  const d = new Date();
  return `Chat · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const messageText = (m) => {
  if (m.parts) return m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return m.content || '';
};

// ── Structured part renderer ─────────────────────────────────────────────────

function StructuredParts({ parts }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text' && part.text?.trim())
          return <div key={i} className="part-text"><ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown></div>;
        if (part.type === 'code')
          return <div key={i} className="part-code"><div className="part-code-header"><span className="part-code-lang">{part.language === 'PYTHON' ? 'Python' : part.language}</span></div><pre className="part-code-body"><code>{part.code}</code></pre></div>;
        if (part.type === 'result') {
          const ok = part.outcome === 'OUTCOME_OK';
          return <div key={i} className="part-result"><div className="part-result-header"><span className={`part-result-badge ${ok ? 'ok' : 'err'}`}>{ok ? '✓ Output' : '✗ Error'}</span></div><pre className="part-result-body">{part.output}</pre></div>;
        }
        if (part.type === 'image')
          return <img key={i} src={`data:${part.mimeType};base64,${part.data}`} alt="Generated" className="part-image" />;
        return null;
      })}
    </>
  );
}

// ── Metric vs Time chart ─────────────────────────────────────────────────────

function MetricChart({ chart, onEnlarge }) {
  const { metric, data } = chart;
  const wrapRef = useRef(null);
  if (!data?.length) return null;

  const handleDownload = (e) => {
    e.stopPropagation();
    svgToPng(wrapRef.current, `chart-${metric}-${Date.now()}.png`);
  };

  return (
    <div className="metric-chart-wrap" ref={wrapRef} onClick={() => onEnlarge(chart)}>
      <div className="metric-chart-header">
        <p className="metric-chart-label">{metric} vs Release Date (click to enlarge)</p>
        <button className="metric-chart-dl" onClick={handleDownload} title="Download as PNG">PNG</button>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
          <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} angle={-30} textAnchor="end" />
          <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} width={60} tickFormatter={(v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v} />
          <Tooltip contentStyle={{ background: 'rgba(15,15,35,0.92)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: '#e2e8f0', fontSize: '0.82rem' }} />
          <Line type="monotone" dataKey={metric} stroke="#818cf8" strokeWidth={2} dot={{ r: 3, fill: '#818cf8' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Video Card ───────────────────────────────────────────────────────────────

function VideoCard({ video }) {
  return (
    <a href={video.video_url} target="_blank" rel="noreferrer" className="video-card">
      <img src={video.thumbnail_url} alt="" className="video-card-thumb" />
      <div className="video-card-info">
        <span className="video-card-title">{video.title}</span>
        <span className="video-card-stats">
          {(video.view_count || 0).toLocaleString()} views
          {video.duration ? ` · ${Math.floor(video.duration / 60)}m ${video.duration % 60}s` : ''}
        </span>
        <span className="video-card-cta">Click to watch on YouTube ↗</span>
      </div>
    </a>
  );
}

// ── Stats Card ───────────────────────────────────────────────────────────────

function StatsCard({ stats }) {
  const rows = [
    ['n (sample size)', stats.n],
    ['Mean', Number(stats.mean).toLocaleString(undefined, { maximumFractionDigits: 2 })],
    ['Median', Number(stats.median).toLocaleString(undefined, { maximumFractionDigits: 2 })],
    ['Std Dev', Number(stats.std).toLocaleString(undefined, { maximumFractionDigits: 2 })],
    ['Min', Number(stats.min).toLocaleString()],
    ['Max', Number(stats.max).toLocaleString()],
  ];
  return (
    <div className="stats-card">
      <p className="stats-card-title">Statistics: {stats.field}</p>
      <table className="stats-table">
        <tbody>
          {rows.map(([label, val]) => (
            <tr key={label}>
              <td className="stats-label">{label}</td>
              <td className="stats-value">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Generated Image ──────────────────────────────────────────────────────────

function GeneratedImage({ chart, onEnlarge }) {
  const src = `data:${chart.mimeType || 'image/png'};base64,${chart.imageBase64}`;

  const handleDownload = (e) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = src;
    a.download = `generated-image-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="generated-image-wrap">
      <img src={src} alt={chart.prompt || 'Generated image'} className="generated-image" onClick={() => onEnlarge(chart)} />
      <div className="generated-image-actions">
        <button onClick={handleDownload} className="img-download-btn">Download</button>
        <button onClick={() => onEnlarge(chart)} className="img-enlarge-btn">Enlarge</button>
      </div>
    </div>
  );
}

// ── Lightbox Modal ───────────────────────────────────────────────────────────

function Lightbox({ item, onClose }) {
  const chartRef = useRef(null);
  if (!item) return null;

  const handleDownload = () => {
    if (item._toolType === 'image') {
      const a = document.createElement('a');
      a.href = `data:${item.mimeType || 'image/png'};base64,${item.imageBase64}`;
      a.download = `generated-image-${Date.now()}.png`;
      a.click();
    } else if (item._toolType === 'chart') {
      svgToPng(chartRef.current, `chart-${item.metric}-${Date.now()}.png`);
    }
  };

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose}>×</button>

        {item._toolType === 'image' && (
          <img src={`data:${item.mimeType || 'image/png'};base64,${item.imageBase64}`} alt="Enlarged" className="lightbox-image" />
        )}

        {item._toolType === 'chart' && (
          <div className="lightbox-chart" ref={chartRef}>
            <h3>{item.metric} vs Release Date</h3>
            <ResponsiveContainer width="100%" height={450}>
              <LineChart data={item.data} margin={{ top: 16, right: 32, left: 16, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="date" tick={{ fill: '#e2e8f0', fontSize: 11 }} angle={-30} textAnchor="end" />
                <YAxis tick={{ fill: '#e2e8f0', fontSize: 11 }} width={70} tickFormatter={(v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v} />
                <Tooltip contentStyle={{ background: '#1e1e2e', border: '1px solid #555', borderRadius: 8, color: '#e2e8f0' }} />
                <Line type="monotone" dataKey={item.metric} stroke="#818cf8" strokeWidth={2.5} dot={{ r: 4, fill: '#818cf8' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <button className="lightbox-download" onClick={handleDownload}>Download</button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Chat({ username, userInfo, channelData, onChannelData, onLogout }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [jsonContext, setJsonContext] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [lightboxItem, setLightboxItem] = useState(null);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);
  const justCreatedSessionRef = useRef(false);

  useEffect(() => {
    const init = async () => {
      const list = await getSessions(username);
      setSessions(list);
      setActiveSessionId('new');
    };
    init();
  }, [username]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === 'new') { setMessages([]); return; }
    if (justCreatedSessionRef.current) { justCreatedSessionRef.current = false; return; }
    setMessages([]);
    loadMessages(activeSessionId).then(setMessages);
  }, [activeSessionId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  // ── Session management ────────────────────────────────────────────────────

  const handleNewChat = () => {
    setActiveSessionId('new'); setMessages([]); setInput(''); setImages([]);
    setJsonContext(null);
  };

  const handleSelectSession = (sid) => {
    if (sid === activeSessionId) return;
    setActiveSessionId(sid); setInput(''); setImages([]);
    setJsonContext(null);
  };

  const handleDeleteSession = async (sid, e) => {
    e.stopPropagation(); setOpenMenuId(null);
    await deleteSession(sid);
    const remaining = sessions.filter((s) => s.id !== sid);
    setSessions(remaining);
    if (activeSessionId === sid) {
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : 'new');
      setMessages([]);
    }
  };

  // ── File handling ─────────────────────────────────────────────────────────

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const fileToText = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });

  const processJsonFile = (text, fileName) => {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      onChannelData(arr);
      setJsonContext({ name: fileName, count: arr.length });
      return true;
    } catch {
      return false;
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];

    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (jsonFiles.length > 0) {
      const text = await fileToText(jsonFiles[0]);
      processJsonFile(text, jsonFiles[0].name);
    }

    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({ data: await fileToBase64(f), mimeType: f.type, name: f.name }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const handleFileSelect = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';

    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (jsonFiles.length > 0) {
      const text = await fileToText(jsonFiles[0]);
      processJsonFile(text, jsonFiles[0].name);
    }
    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({ data: await fileToBase64(f), mimeType: f.type, name: f.name }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const newImages = await Promise.all(
      imageItems.map((item) => new Promise((resolve) => {
        const file = item.getAsFile();
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve({ data: reader.result.split(',')[1], mimeType: file.type, name: 'pasted-image' });
        reader.readAsDataURL(file);
      }))
    );
    setImages((prev) => [...prev, ...newImages.filter(Boolean)]);
  };

  const handleStop = () => { abortRef.current = true; };

  // ── Send message ──────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !images.length && !jsonContext) || streaming || !activeSessionId) return;

    let sessionId = activeSessionId;
    if (sessionId === 'new') {
      const title = chatTitle();
      const { id } = await createSession(username, 'assistant', title);
      sessionId = id;
      justCreatedSessionRef.current = true;
      setActiveSessionId(id);
      setSessions((prev) => [{ id, agent: 'assistant', title, createdAt: new Date().toISOString(), messageCount: 0 }, ...prev]);
    }

    const hasData = !!channelData?.length;
    const capturedJson = jsonContext;
    const IMAGE_KEYWORDS = /\b(generate|create|make|draw|design)\b.*\b(image|picture|thumbnail|illustration|photo|artwork|icon)\b/i;
    const wantsImage = IMAGE_KEYWORDS.test(text);

    let contextPrefix = '';
    if (capturedJson || hasData) {
      const vids = channelData || [];
      const summary = vids.slice(0, 10).map((v, i) =>
        `${i + 1}. "${v.title}" (${(v.view_count || 0).toLocaleString()} views, ${v.release_date?.split('T')[0] || 'N/A'})`
      ).join('\n');
      contextPrefix = `[YouTube Channel Data: ${vids.length} videos loaded]\nFields: title, description, transcript, duration, release_date, view_count, like_count, comment_count, video_url, thumbnail_url\n\nSample:\n${summary}\n\n---\n\n`;
    }

    const userContent = text || (images.length ? '(Image)' : capturedJson ? `(Loaded ${capturedJson.name})` : '');
    const promptForGemini = contextPrefix + (text || (images.length ? 'What do you see in this image?' : 'Please analyze this YouTube channel data.'));

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString(),
      images: [...images],
      jsonName: capturedJson?.name || null,
    };

    setMessages((m) => [...m, userMsg]);
    setInput('');
    const capturedImages = [...images];
    setImages([]);
    setJsonContext(null);
    setStreaming(true);

    await saveMessage(sessionId, 'user', userContent, capturedImages.length ? capturedImages : null);

    const imageParts = capturedImages.map((img) => ({ mimeType: img.mimeType, data: img.data }));
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({ role: m.role, content: m.content || messageText(m) }));

    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [...m, { id: assistantId, role: 'model', content: '', timestamp: new Date().toISOString() }]);

    abortRef.current = false;
    let fullContent = '';
    let groundingData = null;
    let structuredParts = null;
    let toolCharts = [];
    let toolCalls = [];

    const useTools = hasData || wantsImage;

    try {
      if (useTools) {
        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls } = await chatWithTools(
          history, promptForGemini, channelData, imageParts, userInfo
        );
        fullContent = answer;
        toolCharts = returnedCharts || [];
        toolCalls = returnedCalls || [];
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: fullContent, charts: toolCharts.length ? toolCharts : undefined, toolCalls: toolCalls.length ? toolCalls : undefined }
              : msg
          )
        );
      } else {
        for await (const chunk of streamChat(history, promptForGemini, imageParts, false, userInfo)) {
          if (abortRef.current) break;
          if (chunk.type === 'text') {
            fullContent += chunk.text;
            setMessages((m) => m.map((msg) => (msg.id === assistantId ? { ...msg, content: fullContent } : msg)));
          } else if (chunk.type === 'fullResponse') {
            structuredParts = chunk.parts;
            setMessages((m) => m.map((msg) => (msg.id === assistantId ? { ...msg, content: '', parts: structuredParts } : msg)));
          } else if (chunk.type === 'grounding') {
            groundingData = chunk.data;
          }
        }
      }
    } catch (err) {
      const is429 = err?.message?.includes('429') || err?.message?.includes('Resource exhausted');
      const errText = is429 ? 'Rate limit reached. Please wait and try again.' : `Error: ${err.message}`;
      setMessages((m) => m.map((msg) => (msg.id === assistantId ? { ...msg, content: errText } : msg)));
      fullContent = errText;
    }

    if (groundingData) {
      setMessages((m) => m.map((msg) => (msg.id === assistantId ? { ...msg, grounding: groundingData } : msg)));
    }

    const savedContent = structuredParts
      ? structuredParts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
      : fullContent;
    await saveMessage(sessionId, 'model', savedContent, null, toolCharts.length ? toolCharts : null, toolCalls.length ? toolCalls : null);

    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, messageCount: s.messageCount + 2 } : s)));
    setStreaming(false);
    inputRef.current?.focus();
  };

  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const diffDays = Math.floor((Date.now() - d) / 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Today · ${time}`;
    if (diffDays === 1) return `Yesterday · ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
  };

  // ── Render tool results ───────────────────────────────────────────────────

  const renderCharts = (charts) => {
    if (!charts?.length) return null;
    return charts.map((chart, ci) => {
      if (chart._toolType === 'chart')
        return <MetricChart key={ci} chart={chart} onEnlarge={setLightboxItem} />;
      if (chart._toolType === 'image')
        return <GeneratedImage key={ci} chart={chart} onEnlarge={setLightboxItem} />;
      if (chart._toolType === 'video')
        return <VideoCard key={ci} video={chart} />;
      if (chart._toolType === 'stats')
        return <StatsCard key={ci} stats={chart} />;
      return null;
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <div className="sidebar-top">
          <h1 className="sidebar-title">Chat</h1>
          <button className="new-chat-btn" onClick={handleNewChat}>+ New Chat</button>
        </div>

        <div className="sidebar-sessions">
          {sessions.map((session) => (
            <div key={session.id} className={`sidebar-session${session.id === activeSessionId ? ' active' : ''}`} onClick={() => handleSelectSession(session.id)}>
              <div className="sidebar-session-info">
                <span className="sidebar-session-title">{session.title}</span>
                <span className="sidebar-session-date">{formatDate(session.createdAt)}</span>
              </div>
              <div className="sidebar-session-menu" onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === session.id ? null : session.id); }}>
                <span className="three-dots">⋮</span>
                {openMenuId === session.id && (
                  <div className="session-dropdown">
                    <button className="session-delete-btn" onClick={(e) => handleDeleteSession(session.id, e)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-username">{userInfo?.firstName || username}</span>
          <button onClick={onLogout} className="sidebar-logout">Log out</button>
        </div>
      </aside>

      <div className="chat-main">
        <header className="chat-header">
          <h2 className="chat-header-title">{activeSession?.title ?? 'New Chat'}</h2>
          {channelData?.length > 0 && (
            <span className="chat-header-badge">{channelData.length} videos loaded</span>
          )}
        </header>

        <div
          className={`chat-messages${dragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.role}`}>
              <div className="chat-msg-meta">
                <span className="chat-msg-role">{m.role === 'user' ? (userInfo?.firstName || username) : 'Assistant'}</span>
                <span className="chat-msg-time">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>

              {m.jsonName && <div className="msg-json-badge">📄 {m.jsonName}</div>}

              {m.images?.length > 0 && (
                <div className="chat-msg-images">
                  {m.images.map((img, i) => (
                    <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" className="chat-msg-thumb" />
                  ))}
                </div>
              )}

              <div className="chat-msg-content">
                {m.role === 'model' ? (
                  m.parts ? <StructuredParts parts={m.parts} />
                    : m.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    : <span className="thinking-dots"><span /><span /><span /></span>
                ) : m.content}
              </div>

              {m.toolCalls?.length > 0 && (
                <details className="tool-calls-details">
                  <summary className="tool-calls-summary">
                    🔧 {m.toolCalls.length} tool{m.toolCalls.length > 1 ? 's' : ''} used
                  </summary>
                  <div className="tool-calls-list">
                    {m.toolCalls.map((tc, i) => (
                      <div key={i} className="tool-call-item">
                        <span className="tool-call-name">{tc.name}</span>
                        <span className="tool-call-args">{JSON.stringify(tc.args)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {renderCharts(m.charts)}

              {m.grounding?.groundingChunks?.length > 0 && (
                <div className="chat-msg-sources">
                  <span className="sources-label">Sources</span>
                  <div className="sources-list">
                    {m.grounding.groundingChunks.map((chunk, i) =>
                      chunk.web ? <a key={i} href={chunk.web.uri} target="_blank" rel="noreferrer" className="source-link">{chunk.web.title || chunk.web.uri}</a> : null
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {dragOver && <div className="chat-drop-overlay">Drop JSON or images here</div>}

        <div className="chat-input-area">
          {jsonContext && (
            <div className="json-chip">
              <span className="json-chip-icon">📄</span>
              <span className="json-chip-name">{jsonContext.name}</span>
              <span className="json-chip-meta">{jsonContext.count} videos</span>
              <button className="json-chip-remove" onClick={() => setJsonContext(null)} aria-label="Remove">×</button>
            </div>
          )}

          {images.length > 0 && (
            <div className="chat-image-previews">
              {images.map((img, i) => (
                <div key={i} className="chat-img-preview">
                  <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                  <button type="button" onClick={() => removeImage(i)} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          )}

          <input ref={fileInputRef} type="file" accept="image/*,.json,application/json" multiple style={{ display: 'none' }} onChange={handleFileSelect} />

          <div className="chat-input-row">
            <button type="button" className="attach-btn" onClick={() => fileInputRef.current?.click()} disabled={streaming} title="Attach image or JSON">📎</button>
            <input
              ref={inputRef} type="text"
              placeholder={channelData?.length ? 'Ask about the loaded channel data, request a chart, play a video...' : 'Ask a question, or drop a JSON file to analyze...'}
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              onPaste={handlePaste} disabled={streaming}
            />
            {streaming ? (
              <button onClick={handleStop} className="stop-btn">■ Stop</button>
            ) : (
              <button onClick={handleSend} disabled={!input.trim() && !images.length && !jsonContext}>Send</button>
            )}
          </div>
        </div>
      </div>

      <Lightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </div>
  );
}
