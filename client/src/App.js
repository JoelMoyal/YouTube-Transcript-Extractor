import { useState } from 'react';
const YouTubeTranscriptExtractor = () => {
  const [url, setUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const extractVideoId = url => {
    const match = url.match(/v=([^&]+)/);
    return match ? match[1] : null;
  };
  const fetchTranscript = async () => {
    setLoading(true);
    const videoId = extractVideoId(url);
    try {
      const res = await fetch(\`/api/transcript?videoId=\${videoId}\`);
      const data = await res.json();
      setTranscript(data.transcript);
    } catch (err) {
      setTranscript('Error: ' + err.message);
    }
    setLoading(false);
  };
  return (
    <div>
      <input value={url} onChange={e => setUrl(e.target.value)} placeholder="YouTube URL" />
      <button onClick={fetchTranscript} disabled={loading}>Get Transcript</button>
      {loading ? <p>Loading...</p> : <pre>{transcript}</pre>}
    </div>
  );
};
export default YouTubeTranscriptExtractor;
