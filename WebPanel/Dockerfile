FROM node:24-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV PORT=3001
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3001

CMD ["node", "server/index.mjs"]
