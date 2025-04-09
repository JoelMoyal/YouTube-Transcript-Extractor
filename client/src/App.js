
import React, { useState } from 'react';

const App = () => {
  const [videoUrl, setVideoUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [loading, setLoading] = useState(false);

  const getTranscript = async () => {
    const videoId = new URL(videoUrl).searchParams.get("v");
    if (!videoId) return alert("Invalid YouTube URL");

    setLoading(true);
    const res = await fetch(\`/api/transcript?videoId=\${videoId}\`);
    const data = await res.json();
    if (data.transcript) setTranscript(data.transcript);
    else alert("Transcript not available");
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center sm:py-12">
      <div className="relative py-3 sm:max-w-xl sm:mx-auto">
        <div className="relative px-4 py-10 bg-white mx-8 md:mx-0 shadow rounded-3xl sm:p-10">
          <div className="max-w-md mx-auto">
            <div className="flex items-center space-x-5">
              <div className="h-14 w-14 bg-red-600 rounded-full flex justify-center items-center text-white text-2xl font-mono">YT</div>
              <div className="pl-2 font-semibold text-xl text-gray-700">
                <h2>YouTube Transcript Extractor</h2>
                <p className="text-sm text-gray-500">Paste a YouTube URL to extract its transcript</p>
              </div>
            </div>
            <div className="py-8 text-base space-y-4 text-gray-700 sm:text-lg">
              <div>
                <label className="block">YouTube URL</label>
                <input
                  type="text"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-md w-full"
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </div>
              <button
                onClick={getTranscript}
                className="bg-red-600 w-full text-white px-4 py-3 rounded-md"
              >
                {loading ? "Extracting..." : "Extract Transcript"}
              </button>
            </div>
            {transcript && (
              <div className="mt-6">
                <h3 className="text-lg font-medium">Transcript</h3>
                <div className="mt-2 p-4 bg-gray-50 rounded-md max-h-96 overflow-auto text-sm">
                  {transcript}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
