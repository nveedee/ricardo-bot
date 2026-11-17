# Container fuer den Ricardo Deal Alert Bot.
# Enthaelt curl-impersonate: ein curl, das einen echten Chrome imitiert
# (TLS-Fingerprint + Header), damit Ricardos Cloudflare auch von einer
# Server-/Datacenter-IP (Railway) nicht mit HTTP 403 blockt.
FROM node:24-slim

ARG CI_VERSION=0.6.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL -o /tmp/ci.tar.gz \
        "https://github.com/lwthiker/curl-impersonate/releases/download/v${CI_VERSION}/curl-impersonate-v${CI_VERSION}.x86_64-linux-gnu.tar.gz" \
    && mkdir -p /opt/curl-impersonate \
    && tar -xzf /tmp/ci.tar.gz -C /opt/curl-impersonate \
    && rm /tmp/ci.tar.gz \
    && rm -rf /var/lib/apt/lists/*

# Make the browser-curl available and tell the bot to use the Chrome wrapper
# (the wrapper script sets the full Chrome TLS fingerprint + headers itself).
ENV PATH="/opt/curl-impersonate:${PATH}"
ENV LD_LIBRARY_PATH="/opt/curl-impersonate"
ENV CURL_BIN="curl_chrome110"

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "index.js"]
