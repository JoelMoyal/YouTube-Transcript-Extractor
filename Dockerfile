FROM node:20-alpine

# Install yt-dlp dependencies and the binary itself
RUN apk add --no-cache python3 ffmpeg curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
         -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Install server + client dependencies
COPY package*.json ./
COPY client/package*.json ./client/
RUN npm install && npm --prefix client install

# Copy app source
COPY server.js ./
COPY client ./client

# Build frontend so deploys always include latest UI source changes
RUN npm --prefix client run build && npm prune --omit=dev && rm -rf client/node_modules

EXPOSE 3000

CMD ["node", "server.js"]
