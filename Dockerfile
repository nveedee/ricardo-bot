# Container fuer den Ricardo Deal Alert Bot.
# node:24-slim (Debian) + curl, das zum Laden von Ricardo (an Cloudflare
# vorbei) gebraucht wird.
FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "index.js"]
