FROM node:20-alpine AS client-builder
WORKDIR /app

# Build frontend from source so Railway deployments always include latest UI changes.
COPY client/package*.json ./client/
RUN npm --prefix client ci

COPY client ./client
RUN npm --prefix client run build

FROM node:20-alpine

# Install yt-dlp dependencies and the binary itself
RUN apk add --no-cache python3 ffmpeg curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
         -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Install server dependencies only (smaller runtime image)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server and static assets
COPY server.js ./
COPY client/public ./client/public
COPY --from=client-builder /app/client/build ./client/build

EXPOSE 3000

CMD ["node", "server.js"]
