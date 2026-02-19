FROM node:18-alpine

# Install yt-dlp dependencies and the binary itself
RUN apk add --no-cache python3 ffmpeg curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
         -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy server and pre-built React app
COPY server.js ./
COPY client/build ./client/build

EXPOSE 3000

CMD ["node", "server.js"]
