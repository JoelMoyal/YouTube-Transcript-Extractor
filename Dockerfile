FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY client ./client
RUN cd client && npm install && npm run build
COPY server.js .
COPY .env .
EXPOSE 3000
CMD ["npm", "start"]
