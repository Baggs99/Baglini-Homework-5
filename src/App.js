import { useState } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import YouTubeDownload from './components/YouTubeDownload';
import './App.css';

function App() {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('chatapp_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [activeTab, setActiveTab] = useState('chat');
  const [channelData, setChannelData] = useState(() => {
    try {
      const stored = localStorage.getItem('chatapp_channel_data');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const handleLogin = (userInfo) => {
    localStorage.setItem('chatapp_user', JSON.stringify(userInfo));
    setUser(userInfo);
  };

  const handleLogout = () => {
    localStorage.removeItem('chatapp_user');
    setUser(null);
    setActiveTab('chat');
  };

  const handleChannelData = (data) => {
    setChannelData(data);
    if (data) {
      localStorage.setItem('chatapp_channel_data', JSON.stringify(data));
    } else {
      localStorage.removeItem('chatapp_channel_data');
    }
  };

  if (!user) {
    return <Auth onLogin={handleLogin} />;
  }

  return (
    <div className="app-container">
      <div className="app-tab-bar">
        <button
          className={`app-tab${activeTab === 'chat' ? ' active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          Chat
        </button>
        <button
          className={`app-tab${activeTab === 'youtube' ? ' active' : ''}`}
          onClick={() => setActiveTab('youtube')}
        >
          YouTube Channel Download
        </button>
        {channelData && (
          <span className="app-tab-badge">
            {channelData.length} video{channelData.length !== 1 ? 's' : ''} loaded
          </span>
        )}
      </div>

      {activeTab === 'chat' && (
        <Chat
          username={user.username}
          userInfo={user}
          channelData={channelData}
          onChannelData={handleChannelData}
          onLogout={handleLogout}
        />
      )}
      {activeTab === 'youtube' && (
        <YouTubeDownload
          onDataReady={handleChannelData}
          onSwitchToChat={() => setActiveTab('chat')}
        />
      )}
    </div>
  );
}

export default App;
