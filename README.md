# YouTube Transcript Extractor

A web application that extracts transcripts from YouTube videos.

## Features

- Extract transcripts from any YouTube video URL
- Clean, responsive UI using Tailwind CSS
- Copy transcript to clipboard with one click

## Technology Stack

- **Frontend**: React, Tailwind CSS
- **Backend**: Node.js, Express
- **API**: youtube-transcript npm package

## Installation

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/youtube-transcript-extractor.git
   cd youtube-transcript-extractor
   ```

2. Install server dependencies:
   ```bash
   npm install
   ```

3. Install client dependencies:
   ```bash
   cd client
   npm install
   cd ..
   ```

4. Build the client:
   ```bash
   cd client
   npm run build
   cd ..
   ```

5. Start the server:
   ```bash
   npm start
   ```

The application will be running at [http://localhost:3000](http://localhost:3000)

## Development Mode

To run the application in development mode:

1. Start the backend server:
   ```bash
   npm run dev
   ```

2. In a separate terminal, start the frontend development server:
   ```bash
   cd client
   npm start
   ```

The frontend will be running at [http://localhost:3001](http://localhost:3001) with hot reloading enabled.

## Deployment

### Docker

You can use the included Dockerfile to build and run the application in a container:

```bash
docker build -t youtube-transcript-extractor .
docker run -p 3000:3000 youtube-transcript-extractor
```

### Vercel

This application is configured for deployment on Vercel. Simply push to your GitHub repository and connect it to Vercel for automatic deployments.

## License

MIT
