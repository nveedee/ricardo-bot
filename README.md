# Ricardo.ch Deal Alert Bot

A tiny Node.js bot that watches [Ricardo.ch](https://www.ricardo.ch) search results
every few minutes and sends you a **Telegram** message when a new listing appears
that matches your keyword and is within your max price.

```
config.json  →  fetch Ricardo search (newest first)  →  parse listings
             →  compare against seen.json  →  Telegram alert for new & cheap enough
```

## Setup

```bash
cd deal-alert-bot
npm install
cp .env.example .env     # then fill in your Telegram token + chat id
```

### Get your Telegram credentials

1. In Telegram, message **@BotFather**, send `/newbot`, follow the prompts, copy the
   **token** into `TELEGRAM_BOT_TOKEN`.
2. Send any message to your new bot (so it can message you back).
3. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and copy
   the `"chat":{"id": ...}` number into `TELEGRAM_CHAT_ID`.

## Configure what to watch

Edit `config.json` — an array of `{ keyword, maxPrice }` (price in CHF):

```json
[
  { "keyword": "arcteryx", "maxPrice": 80 },
  { "keyword": "stone island", "maxPrice": 60 },
  { "keyword": "carhartt", "maxPrice": 40 }
]
```

## Run

```bash
node index.js          # runs forever, checks every POLL_MINUTES (default 5)
node index.js --once   # single check, then exit (handy for testing / cron)
```

- **First run is silent**: the bot records everything currently on the page as a
  *baseline* so you don't get spammed by dozens of existing listings. Only listings
  that appear *after* that first run trigger alerts. Adding a new keyword later also
  gets its own silent baseline.
- Without Telegram credentials it runs in **dry mode** and just logs what it *would*
  send — useful for a first test.
- Seen listing IDs are stored in `seen.json` (created automatically). Delete it to
  reset the baseline.

## Telegram message

```
🆕 New Ricardo listing!

📦 Arcteryx Cerium Hoody, Herren, Gr. M
💰 CHF 75.00 (Gebot)
🔍 matched "arcteryx" · max CHF 80
🔗 https://www.ricardo.ch/de/a/...-1335871892/
```

> `Gebot` = auction (price shown is the current bid) · `Sofort kaufen` = buy-now.

## How it fetches (important)

Ricardo.ch sits behind Cloudflare, which **blocks Node's built-in HTTP client**
(you get `HTTP 403`) because of its TLS fingerprint, while allowing a normal browser
or the `curl` command-line tool. So the bot fetches the search page by shelling out
to **`curl`**, then parses the HTML with `cheerio`.

`curl` ships by default on Windows 10+, macOS, most Linux distros, and the standard
Railway / Nixpacks images, so there's usually nothing to install. If you ever see
`` `curl` not found on PATH ``, install curl.

## Deploy to Railway

1. Push this folder to a Git repo.
2. New Railway project → deploy from the repo.
3. Set the **Start Command** to `node index.js`.
4. Add the env vars `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (and optionally
   `POLL_MINUTES`) in the Railway dashboard.

> Note: `seen.json` lives on the container's local disk. On Railway's ephemeral
> filesystem it resets on redeploy (meaning a fresh silent baseline each deploy).
> Attach a Railway **Volume** if you want the seen-history to persist.

## Files

| File            | Purpose                                             |
| --------------- | --------------------------------------------------- |
| `index.js`      | the bot                                              |
| `config.json`   | your watch list (`keyword` + `maxPrice`)            |
| `.env`          | Telegram secrets (not committed)                     |
| `seen.json`     | auto-generated history of already-seen listing IDs   |
