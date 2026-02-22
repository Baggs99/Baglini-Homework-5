import { useState, useRef } from 'react';
import './YouTubeDownload.css';

const API = process.env.REACT_APP_API_URL || process.env.REACT_APP_API_BASE_URL || '';

// Curated list of ~100 popular English-language YouTube channels across categories.
const SUGGESTED_CHANNELS = [
  // Education & Science
  { name: 'Veritasium', url: 'https://www.youtube.com/@veritasium' },
  { name: 'Kurzgesagt', url: 'https://www.youtube.com/@kurzgesagt' },
  { name: 'Vsauce', url: 'https://www.youtube.com/@Vsauce' },
  { name: '3Blue1Brown', url: 'https://www.youtube.com/@3blue1brown' },
  { name: 'SmarterEveryDay', url: 'https://www.youtube.com/@smartereveryday' },
  { name: 'MinutePhysics', url: 'https://www.youtube.com/@MinutePhysics' },
  { name: 'Tom Scott', url: 'https://www.youtube.com/@TomScottGo' },
  { name: 'Mark Rober', url: 'https://www.youtube.com/@MarkRober' },
  { name: 'CGP Grey', url: 'https://www.youtube.com/@CGPGrey' },
  { name: 'Numberphile', url: 'https://www.youtube.com/@numberphile' },
  { name: 'Real Engineering', url: 'https://www.youtube.com/@RealEngineering' },
  { name: 'Practical Engineering', url: 'https://www.youtube.com/@PracticalEngineeringChannel' },
  { name: 'Steve Mould', url: 'https://www.youtube.com/@SteveMould' },
  { name: 'CrashCourse', url: 'https://www.youtube.com/@crashcourse' },
  { name: 'Wendover Productions', url: 'https://www.youtube.com/@Wendoverproductions' },
  { name: 'Half as Interesting', url: 'https://www.youtube.com/@halfasinteresting' },
  { name: 'Stuff Made Here', url: 'https://www.youtube.com/@StuffMadeHere' },
  { name: 'Thought Emporium', url: 'https://www.youtube.com/@thethoughtemporium' },
  { name: 'NileRed', url: 'https://www.youtube.com/@NileRed' },
  { name: 'ElectroBOOM', url: 'https://www.youtube.com/@ElectroBOOM' },
  // Tech
  { name: 'MKBHD', url: 'https://www.youtube.com/@mkbhd' },
  { name: 'Linus Tech Tips', url: 'https://www.youtube.com/@LinusTechTips' },
  { name: 'Fireship', url: 'https://www.youtube.com/@Fireship' },
  { name: 'NetworkChuck', url: 'https://www.youtube.com/@NetworkChuck' },
  { name: 'Dave2D', url: 'https://www.youtube.com/@Dave2D' },
  { name: 'Unbox Therapy', url: 'https://www.youtube.com/@UnboxTherapy' },
  { name: 'Austin Evans', url: 'https://www.youtube.com/@austinevans' },
  { name: 'JerryRigEverything', url: 'https://www.youtube.com/@JerryRigEverything' },
  { name: 'iJustine', url: 'https://www.youtube.com/@ijustine' },
  { name: 'The Verge', url: 'https://www.youtube.com/@TheVerge' },
  // Business & Finance
  { name: 'Graham Stephan', url: 'https://www.youtube.com/@GrahamStephan' },
  { name: 'Ali Abdaal', url: 'https://www.youtube.com/@aliabdaal' },
  { name: 'Andrei Jikh', url: 'https://www.youtube.com/@AndreiJikh' },
  { name: 'How Money Works', url: 'https://www.youtube.com/@HowMoneyWorks' },
  { name: 'Economics Explained', url: 'https://www.youtube.com/@EconomicsExplained' },
  { name: 'Patrick Boyle', url: 'https://www.youtube.com/@PBoyle' },
  // Comedy & Entertainment
  { name: 'MrBeast', url: 'https://www.youtube.com/@MrBeast' },
  { name: 'Dude Perfect', url: 'https://www.youtube.com/@DudePerfect' },
  { name: 'Ryan Trahan', url: 'https://www.youtube.com/@ryantrahan' },
  { name: 'Airrack', url: 'https://www.youtube.com/@Airrack' },
  { name: 'Danny Gonzalez', url: 'https://www.youtube.com/@dannygonzalez' },
  { name: 'Drew Gooden', url: 'https://www.youtube.com/@DrewGooden' },
  { name: 'Kurtis Conner', url: 'https://www.youtube.com/@KurtisConner' },
  { name: 'penguinz0', url: 'https://www.youtube.com/@penguinz0' },
  { name: 'Casually Explained', url: 'https://www.youtube.com/@CasuallyExplained' },
  { name: 'Oversimplified', url: 'https://www.youtube.com/@OverSimplified' },
  // News & Commentary
  { name: 'Philip DeFranco', url: 'https://www.youtube.com/@PhilipDeFranco' },
  { name: 'Johnny Harris', url: 'https://www.youtube.com/@johnnyharris' },
  { name: 'TLDR News', url: 'https://www.youtube.com/@TLDRnewsGlobal' },
  { name: 'Vox', url: 'https://www.youtube.com/@Vox' },
  { name: 'PolyMatter', url: 'https://www.youtube.com/@PolyMatter' },
  // Podcasts & Interviews
  { name: 'Lex Fridman', url: 'https://www.youtube.com/@lexfridman' },
  { name: 'Joe Rogan (JRE Clips)', url: 'https://www.youtube.com/@JREClips' },
  { name: 'Diary of a CEO', url: 'https://www.youtube.com/@TheDiaryOfACEO' },
  { name: 'Colin and Samir', url: 'https://www.youtube.com/@ColinandSamir' },
  // Cooking & Food
  { name: "Binging with Babish", url: 'https://www.youtube.com/@baborish' },
  { name: 'Joshua Weissman', url: 'https://www.youtube.com/@JoshuaWeissman' },
  { name: "Adam Ragusea", url: 'https://www.youtube.com/@aragusea' },
  { name: "Ethan Chlebowski", url: 'https://www.youtube.com/@EthanChlebowski' },
  { name: "J. Kenji López-Alt", url: 'https://www.youtube.com/@JKenjiLopezAlt' },
  { name: "Internet Shaquille", url: 'https://www.youtube.com/@InternetShaquille' },
  { name: 'Nick DiGiovanni', url: 'https://www.youtube.com/@NickDigiovanni' },
  { name: "Sam the Cooking Guy", url: 'https://www.youtube.com/@samthecookingguy' },
  // Fitness & Health
  { name: 'Jeff Nippard', url: 'https://www.youtube.com/@JeffNippard' },
  { name: 'AthleanX', url: 'https://www.youtube.com/@ataborish' },
  { name: 'Natacha Océane', url: 'https://www.youtube.com/@natachaoceane' },
  { name: 'Jeremy Ethier', url: 'https://www.youtube.com/@JeremyEthier' },
  // Gaming
  { name: 'Markiplier', url: 'https://www.youtube.com/@markiplier' },
  { name: 'Jacksepticeye', url: 'https://www.youtube.com/@jacksepticeye' },
  { name: 'Dream', url: 'https://www.youtube.com/@dream' },
  { name: 'Technoblade', url: 'https://www.youtube.com/@Technoblade' },
  { name: 'TheRadBrad', url: 'https://www.youtube.com/@theRadBrad' },
  { name: 'Game Makers Toolkit', url: 'https://www.youtube.com/@GMTK' },
  { name: 'Dunkey', url: 'https://www.youtube.com/@videogamedunkey' },
  { name: 'DigitalFoundry', url: 'https://www.youtube.com/@DigitalFoundry' },
  // DIY & Maker
  { name: 'Adam Savage (Tested)', url: 'https://www.youtube.com/@tested' },
  { name: 'DIY Perks', url: 'https://www.youtube.com/@DIYPerks' },
  { name: 'I Like To Make Stuff', url: 'https://www.youtube.com/@iliketomakestuff' },
  { name: 'Simone Giertz', url: 'https://www.youtube.com/@simonegiertz' },
  { name: 'William Osman', url: 'https://www.youtube.com/@williamosman' },
  { name: 'Michael Reeves', url: 'https://www.youtube.com/@MichaelReeves' },
  // Music
  { name: 'Adam Neely', url: 'https://www.youtube.com/@AdamNeely' },
  { name: 'Andrew Huang', url: 'https://www.youtube.com/@andrewhuang' },
  { name: 'Rick Beato', url: 'https://www.youtube.com/@RickBeato' },
  { name: 'Jacob Collier', url: 'https://www.youtube.com/@jacobcollier' },
  { name: 'Polyphonic', url: 'https://www.youtube.com/@Polyphonic' },
  // History & Documentaries
  { name: 'Kurzgesagt', url: 'https://www.youtube.com/@kurzgesagt' },
  { name: 'History Matters', url: 'https://www.youtube.com/@HistoryMatters' },
  { name: 'Kings and Generals', url: 'https://www.youtube.com/@KingsandGenerals' },
  { name: 'Mustard', url: 'https://www.youtube.com/@MustardChannel' },
  { name: 'LEMMiNO', url: 'https://www.youtube.com/@LEMMiNO' },
  { name: 'The Infographics Show', url: 'https://www.youtube.com/@TheInfographicsShow' },
  // Film & Video Essays
  { name: 'Nerdwriter1', url: 'https://www.youtube.com/@Nerdwriter1' },
  { name: 'Every Frame a Painting', url: 'https://www.youtube.com/@everyframeapainting' },
  { name: 'Lessons from the Screenplay', url: 'https://www.youtube.com/@LessonsFromTheScreenplay' },
  { name: 'Thomas Flight', url: 'https://www.youtube.com/@ThomasFlight' },
  // Design & Creative
  { name: 'The Futur', url: 'https://www.youtube.com/@thefutur' },
  { name: 'Yes Theory', url: 'https://www.youtube.com/@YesTheory' },
  { name: 'Casey Neistat', url: 'https://www.youtube.com/@CaseyNeistat' },
  { name: 'Peter McKinnon', url: 'https://www.youtube.com/@PeterMcKinnon' },
  { name: 'Mango Street', url: 'https://www.youtube.com/@MangoStreet' },
];

export default function YouTubeDownload({ onDataReady, onSwitchToChat }) {
  const [channelUrl, setChannelUrl] = useState('https://www.youtube.com/@veritasium');
  const [maxVideos, setMaxVideos] = useState(10);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [suggestedName, setSuggestedName] = useState(null);
  const [lastSuggestedUrl, setLastSuggestedUrl] = useState(null);
  const abortRef = useRef(null);

  const handleSuggest = () => {
    let pick;
    for (let i = 0; i < 4; i++) {
      pick = SUGGESTED_CHANNELS[Math.floor(Math.random() * SUGGESTED_CHANNELS.length)];
      if (pick.url !== lastSuggestedUrl) break;
    }
    setChannelUrl(pick.url);
    setSuggestedName(pick.name);
    setLastSuggestedUrl(pick.url);
  };

  const handleDownload = async () => {
    setDownloading(true);
    setProgress(null);
    setStatusMsg('Starting download...');
    setError('');
    setResult(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API}/api/youtube/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelUrl: channelUrl.trim(),
          maxVideos: Math.min(Math.max(1, parseInt(maxVideos) || 10), 100),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error || res.statusText);
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
          let chunk;
          try {
            chunk = JSON.parse(line);
          } catch {
            continue;
          }
          if (chunk.type === 'status') setStatusMsg(chunk.message);
          if (chunk.type === 'progress') {
            setProgress({ current: chunk.current, total: chunk.total });
            setStatusMsg(`Processing ${chunk.current}/${chunk.total}: ${chunk.title}`);
          }
          if (chunk.type === 'done') {
            setResult(chunk.videos);
            onDataReady(chunk.videos);
            setStatusMsg(`Done! ${chunk.videos.length} videos downloaded.`);
          }
          if (chunk.type === 'error') throw new Error(chunk.message);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setStatusMsg('Download cancelled.');
      } else {
        setError(err.message);
        setStatusMsg('');
      }
    } finally {
      setDownloading(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleSaveJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const channelName = channelUrl.split('@')[1]?.split('/')[0] || 'channel';
    a.download = `${channelName}_${result.length}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const progressPct = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="yt-download">
      <div className="yt-download-card">
        <h2>YouTube Channel Download</h2>
        <p className="yt-download-desc">
          Download video metadata (title, stats, transcript) from any YouTube channel.
        </p>

        <div className="yt-download-form">
          <label>
            Channel URL
            <div className="yt-url-row">
              <input
                type="url"
                placeholder="https://www.youtube.com/@veritasium"
                value={channelUrl}
                onChange={(e) => { setChannelUrl(e.target.value); setSuggestedName(null); }}
                disabled={downloading}
              />
              <button
                type="button"
                className="yt-btn-suggest"
                onClick={handleSuggest}
                disabled={downloading}
              >
                Suggest a channel
              </button>
            </div>
            {suggestedName && <span className="yt-suggested-hint">Suggested: {suggestedName}</span>}
          </label>

          <label>
            Max Videos
            <input
              type="number"
              min="1"
              max="100"
              value={maxVideos}
              onChange={(e) => setMaxVideos(e.target.value)}
              disabled={downloading}
            />
            <span className="yt-download-hint">1–100 (default 10)</span>
          </label>

          <div className="yt-download-actions">
            {downloading ? (
              <button className="yt-btn-cancel" onClick={handleCancel}>
                Cancel
              </button>
            ) : (
              <button
                className="yt-btn-download"
                onClick={handleDownload}
                disabled={!channelUrl.trim()}
              >
                Download Channel Data
              </button>
            )}
          </div>
        </div>

        {(downloading || progress) && (
          <div className="yt-progress-section">
            <div className="yt-progress-bar-track">
              <div
                className="yt-progress-bar-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="yt-progress-text">{statusMsg}</p>
          </div>
        )}

        {error && <p className="yt-error">{error}</p>}

        {result && (
          <div className="yt-result-section">
            <div className="yt-result-header">
              <h3>{result.length} Videos Downloaded</h3>
              <div className="yt-result-actions">
                <button className="yt-btn-save" onClick={handleSaveJson}>
                  Save JSON
                </button>
                <button className="yt-btn-chat" onClick={onSwitchToChat}>
                  Analyze in Chat
                </button>
              </div>
            </div>
            <div className="yt-video-list">
              {result.slice(0, 20).map((v, i) => (
                <div key={v.video_id || i} className="yt-video-item">
                  <img
                    src={v.thumbnail_url}
                    alt=""
                    className="yt-video-thumb"
                    loading="lazy"
                  />
                  <div className="yt-video-info">
                    <span className="yt-video-title">{v.title}</span>
                    <span className="yt-video-stats">
                      {(v.view_count || 0).toLocaleString()} views ·{' '}
                      {(v.like_count || 0).toLocaleString()} likes ·{' '}
                      {v.transcript_status === 'ok' ? 'transcript ✓' : v.transcript ? 'transcript ✓' : 'no transcript'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
