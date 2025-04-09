const express = require('express');
const cors = require('cors');
const { YoutubeTranscript } = require('youtube-transcript');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client/build')));

app.get('/api/transcript', async (req, res) => {
  const { videoId } = req.query;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId' });
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    const fullText = transcript.map(line => line.text).join(' ');
    res.json({ transcript: fullText });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch transcript', message: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build/index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));