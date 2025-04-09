FROM node:16-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY client ./client
RUN if [ -d "./client" ]; then cd client && npm install && npm run build; fi
COPY server.js ./
COPY .env* ./
EXPOSE 3000
CMD ["npm", "start"]