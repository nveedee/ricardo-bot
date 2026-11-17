import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import "dotenv/config";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");
const SEEN_PATH = path.join(__dirname, "seen.json");

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
const POLL_MINUTES = Number(process.env.POLL_MINUTES) || 5;
const RUN_ONCE = process.argv.includes("--once");

// Which curl to use. On a datacenter host (Railway) Cloudflare blocks plain
// curl's TLS fingerprint, so CURL_BIN points at a browser-impersonating curl
// wrapper there (e.g. curl_chrome110), which sets its own TLS + headers.
const CURL_BIN = process.env.CURL_BIN || "curl";
const BROWSER_CURL = CURL_BIN !== "curl";

const BASE = "https://www.ricardo.ch";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Known Ricardo size tokens (field "Grösse ...") we can recognise.
const SIZE_RE =
  /Gr\Ssse\s+(1 Size|One Size|XXXL|XXL|XXS|XL|XS|[SML]|[0-9]{2,3}(?:\.[0-9])?)/;

// Normalise text for brand matching: strip accents/punctuation, lowercase.
const norm = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Build word-boundary matchers from a { "brand name": maxPrice } map, longest first.
function buildBrandMatchers(brands) {
  return Object.entries(brands)
    .map(([name, maxPrice]) => ({ name, maxPrice, key: norm(name) }))
    .filter((m) => m.key)
    .sort((a, b) => b.key.length - a.key.length)
    .map((m) => ({ ...m, re: new RegExp(`\\b${m.key.replace(/ /g, "\\s+")}\\b`) }));
}

function matchBrand(hay, matchers) {
  for (const m of matchers) if (m.re.test(hay)) return m;
  return null;
}

// ----------------------------------------------------------------------------
// Config & persistence
// ----------------------------------------------------------------------------

// config.json = { defaults: {...}, searches: [...] }  (also accepts a bare array)
// A search can use:  keyword (searches all of Ricardo), url (a ready filter URL),
// or brand (substituted into defaults.categoryUrl's {brand} placeholder).
function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const defaults = Array.isArray(raw) ? {} : raw.defaults || {};
  const searches = Array.isArray(raw) ? raw : raw.searches || [];
  return searches
    .map((s) => {
      let url = s.url || null;
      const tmpl = s.categoryUrl || defaults.categoryUrl;
      if (!url && s.brand && tmpl)
        url = tmpl.replace("{brand}", encodeURIComponent(s.brand.trim()));
      const brands = s.brands || defaults.brands || null;
      return {
        label: s.label || s.brand || s.keyword || url || "(leer)",
        keyword: s.keyword || null,
        url,
        maxPrice: s.maxPrice ?? defaults.maxPrice ?? null,
        sizes: s.sizes ?? defaults.sizes ?? null,
        buyNowOnly: s.buyNowOnly ?? defaults.buyNowOnly ?? false,
        brands,
        brandMatchers: brands ? buildBrandMatchers(brands) : null,
      };
    })
    .filter((s) => s.keyword || s.url);
}

function searchKey(s) {
  return s.url || `kw:${s.keyword}`;
}

// seen.json: { "seen": [ids...], "baselined": [searchKeys...] }
function loadSeen() {
  if (!fs.existsSync(SEEN_PATH)) {
    return { data: { seen: [], baselined: [] }, firstRun: true };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(SEEN_PATH, "utf8"));
    return {
      data: {
        seen: Array.isArray(parsed.seen) ? parsed.seen : [],
        baselined: Array.isArray(parsed.baselined) ? parsed.baselined : [],
      },
      firstRun: false,
    };
  } catch {
    return { data: { seen: [], baselined: [] }, firstRun: true };
  }
}

function saveSeen(state) {
  const MAX = 8000;
  if (state.seen.length > MAX) state.seen = state.seen.slice(-MAX);
  fs.writeFileSync(SEEN_PATH, JSON.stringify(state, null, 2));
}

// ----------------------------------------------------------------------------
// Ricardo scraping
// ----------------------------------------------------------------------------

function searchUrl(keyword) {
  return `${BASE}/de/s/${encodeURIComponent(keyword.trim())}/?sort=newest`;
}

function parsePrice(text) {
  if (!text) return NaN;
  let t = text.replace(/[\s’ʼ'’]/g, "");
  if (t.includes(",") && !t.includes(".")) t = t.replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}

// The last price-number span that appears *before* a given label position.
function priceBefore(html, labelIdx) {
  if (labelIdx < 0) return NaN;
  let best = NaN;
  for (const m of html.matchAll(/>\s*([0-9][0-9’'. ]*?[.,][0-9]{2})\s*</g)) {
    if (m.index < labelIdx) best = parsePrice(m[1]);
    else break;
  }
  return best;
}

// Ricardo is behind Cloudflare (blocks Node's TLS fingerprint -> 403), so the
// page is fetched via the system `curl` binary, then parsed with cheerio.
async function fetchHtml(url) {
  const args = ["-sS", "--compressed", "--max-time", "30", "--fail-with-body"];
  if (!BROWSER_CURL) {
    // Plain curl: supply our own browser-ish headers.
    args.push(
      "-A", UA,
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-H", "Accept-Language: de-CH,de;q=0.9,en;q=0.8"
    );
  }
  // else: the browser-curl wrapper already sets a matching TLS + headers.
  args.push(url);
  try {
    const { stdout } = await execFileAsync(CURL_BIN, args, {
      maxBuffer: 48 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    if (err.code === "ENOENT")
      throw new Error(`\`${CURL_BIN}\` nicht gefunden (wird zum Laden von Ricardo gebraucht).`);
    const status = (err.message.match(/returned error: (\d+)/) || [])[1];
    throw new Error(status ? `HTTP ${status}` : err.message.trim());
  }
}

function parseListings(html) {
  const $ = cheerio.load(html);

  const listings = [];
  const ids = new Set();

  // Only the real results, not promoted blocks elsewhere on the page.
  const container = $('[data-testid="regular-results"]');
  const scope = container.length ? container : $.root();

  scope.find('a[href^="/de/a/"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const idMatch = href.match(/-(\d+)\/?$/);
    if (!idMatch) return;
    const id = idMatch[1];
    if (ids.has(id)) return;
    ids.add(id);

    const cardHtml = $(el).html() || "";
    // Skip paid "Boost" ads: old listings injected at the top of the results.
    if (/boost\.svg/i.test(cardHtml)) return;

    // Title = alt of the product image. Skip the "Ricardo AI icon" badge and
    // any .svg icon; fall back to the URL slug.
    let title = "";
    $(el)
      .find("img")
      .each((_, im) => {
        if (title) return;
        const alt = ($(im).attr("alt") || "").trim();
        const src = $(im).attr("src") || "";
        if (alt && alt !== "Ricardo AI icon" && !/\.svg(\?|$)/i.test(src)) title = alt;
      });
    if (!title) {
      const slug = (href.match(/\/de\/a\/(.+?)-\d+\/?$/) || [])[1] || "";
      title = slug
        ? decodeURIComponent(slug)
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase())
        : "(ohne Titel)";
    }

    const buyNowIdx = cardHtml.search(/Sofort kaufen/);
    const gebotIdx = cardHtml.search(/Gebot/);
    const buyNowPrice = priceBefore(cardHtml, buyNowIdx);
    const bidPrice = priceBefore(cardHtml, gebotIdx);
    const hasBuyNow = Number.isFinite(buyNowPrice);

    const cardText = cardHtml.replace(/<[^>]+>/g, " ");
    const sizeMatch = cardText.match(SIZE_RE);
    const size = sizeMatch ? sizeMatch[1] : null;
    const hay = norm(title + " " + cardText);

    listings.push({
      id, title, url: BASE + href,
      buyNowPrice, bidPrice, hasBuyNow, size, hay,
    });
  });

  return listings;
}

async function fetchListings(search) {
  const url = search.url || searchUrl(search.keyword);
  return parseListings(await fetchHtml(url));
}

// ----------------------------------------------------------------------------
// Filtering
// ----------------------------------------------------------------------------

const normSize = (s) => String(s).toLowerCase().replace(/\s+/g, "");

// Returns { ok, price, brand, maxPrice, reason } — whether to alert on a listing.
function evaluate(listing, search) {
  let maxPrice = search.maxPrice;
  let brand = null;

  // 1) Brand filter: listing must match one of the wanted brands; its price cap
  //    is that brand's "too cheap" threshold.
  if (search.brandMatchers) {
    const m = matchBrand(listing.hay, search.brandMatchers);
    if (!m) return { ok: false, reason: "Marke nicht in Liste" };
    brand = m.name;
    maxPrice = m.maxPrice;
  }

  // 2) Only buy-now listings, if requested.
  if (search.buyNowOnly && !listing.hasBuyNow)
    return { ok: false, reason: "kein Sofortkauf" };

  // 3) Price to compare on.
  const price = search.buyNowOnly
    ? listing.buyNowPrice
    : listing.hasBuyNow
    ? listing.buyNowPrice
    : listing.bidPrice;

  // 4) Size filter (only excludes when the size is known and doesn't match).
  if (search.sizes && search.sizes.length && listing.size) {
    const allowed = search.sizes.map(normSize);
    if (!allowed.includes(normSize(listing.size)))
      return { ok: false, reason: `Grösse ${listing.size}` };
  }

  // 5) Max price (the brand's threshold, or the search's maxPrice).
  if (maxPrice != null) {
    if (!Number.isFinite(price)) return { ok: false, reason: "kein Preis" };
    if (price > maxPrice) return { ok: false, reason: `zu teuer (${price})` };
  }

  return { ok: true, price, brand, maxPrice };
}

// ----------------------------------------------------------------------------
// Telegram
// ----------------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sendTelegram(listing, search, info) {
  const { price, brand, maxPrice } = info;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log(`    [dry] würde melden: ${listing.title}`);
    return;
  }
  const priceStr = Number.isFinite(price) ? `CHF ${price.toFixed(2)}` : "Preis n/a";
  const lines = [
    `🆕 <b>Neuer Marken-Deal!</b>`,
    ``,
    `📦 ${esc(listing.title)}`,
    `💰 ${priceStr} <i>(Sofort kaufen)</i>`,
  ];
  if (listing.size) lines.push(`📏 Grösse ${esc(listing.size)}`);
  const who = brand || search.label;
  lines.push(
    `🔍 ${esc(who)}${maxPrice != null ? ` · Deal-Limit CHF ${maxPrice}` : ""}`
  );
  lines.push(`🔗 ${esc(listing.url)}`);

  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: lines.join("\n"),
        parse_mode: "HTML",
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram HTTP ${res.status} ${body}`);
  }
}

// ----------------------------------------------------------------------------
// Core check
// ----------------------------------------------------------------------------

async function checkOnce() {
  const searches = loadConfig();
  const { data: state, firstRun } = loadSeen();
  const seen = new Set(state.seen);
  const baselined = new Set(state.baselined);

  let totalNew = 0;
  let totalAlerts = 0;

  for (const search of searches) {
    let listings;
    try {
      listings = await fetchListings(search);
    } catch (err) {
      console.error(`  ✗ "${search.label}": ${err.message}`);
      continue;
    }

    const key = searchKey(search);
    const isBaseline = firstRun || !baselined.has(key);
    let newCount = 0;
    let alerts = 0;

    for (const l of listings) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      newCount++;
      if (isBaseline) continue; // seed silently on first sighting of a search

      const res = evaluate(l, search);
      if (!res.ok) continue;

      try {
        await sendTelegram(l, search, res);
        alerts++;
      } catch (err) {
        console.error(`    ✗ Alert ${l.id} fehlgeschlagen: ${err.message}`);
      }
    }

    baselined.add(key);
    totalNew += newCount;
    totalAlerts += alerts;

    const flt =
      (search.buyNowOnly ? "Sofortkauf" : "alle") +
      (search.sizes ? ` · Gr. ${search.sizes.join("/")}` : "") +
      (search.brands ? ` · ${Object.keys(search.brands).length} Marken` : "") +
      (search.maxPrice != null ? ` · ≤${search.maxPrice}` : "");
    console.log(
      `  • ${search.label} [${flt}]: ${listings.length} Inserate, ${newCount} neu → ` +
        (isBaseline ? "Baseline" : `${alerts} Alert(s)`)
    );
  }

  state.seen = [...seen];
  state.baselined = [...baselined];
  saveSeen(state);

  console.log(
    `  Σ ${totalNew} neu, ${totalAlerts} Alert(s)` +
      (firstRun ? "  [erster Lauf: Baseline gesetzt, keine Alerts]" : "")
  );
}

// ----------------------------------------------------------------------------
// Runner
// ----------------------------------------------------------------------------

async function main() {
  console.log(
    `Ricardo Deal Alert Bot — Intervall ${POLL_MINUTES} Min` +
      (RUN_ONCE ? " (einmaliger Lauf)" : "")
  );
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID)
    console.warn("⚠  Kein Telegram-Token/Chat-ID — Dry-Mode (es wird nichts gesendet).");

  const tick = async () => {
    console.log(`\n[${new Date().toLocaleString("de-CH")}] prüfe …`);
    try {
      await checkOnce();
    } catch (err) {
      console.error("  ✗ Unerwarteter Fehler:", err.message);
    }
  };

  await tick();
  if (RUN_ONCE) return;
  setInterval(tick, POLL_MINUTES * 60 * 1000);
}

const isMain =
  path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
if (isMain) main();

export { parseListings, evaluate, loadConfig, fetchListings };
