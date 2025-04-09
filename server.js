// server.js
// Backend for basic transcript fetching
const express = require('express');
const cors = require('cors');
const { YoutubeTranscript } = require('youtube-transcript');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'build')));
app.get('/api/transcript', async (req, res) => {
  try {
    const { videoId } = req.query;
    if (!videoId) return res.status(400).json({ error: 'Missing videoId' });
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
    const fullTranscript = transcriptItems.map(item => item.text).join(' ');
    res.json({ transcript: fullTranscript });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));