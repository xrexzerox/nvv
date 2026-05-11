// providers/animepahe.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const MAIN_URLS = [
  "https://animepahe.pw",
  "https://animepahe.ch",
  "https://animepahe.ru",
];
const PROXY_URL = "https://animepaheproxy.phisheranimepahe.workers.dev/?url=";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Cookie": "__ddg2_=1234567890",
  "Referer": "https://animepahe.pw/",
};
const TIMEOUT_MS = 10000;
const RETRIES = 2;

// ------------------------------------------------------------------
// Caches
// ------------------------------------------------------------------
const mappingCache = new Map();
const searchCache = new Map();
const sessionCache = new Map();

// ------------------------------------------------------------------
// Utility: fetch with retry & timeout
// ------------------------------------------------------------------
async function fetchText(url, options = {}, retries = RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error(`Failed after ${retries} retries`);
}
async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

// ------------------------------------------------------------------
// Domain discovery
// ------------------------------------------------------------------
let WORKING_MAIN_URL = null;
async function getWorkingMainUrl() {
  if (WORKING_MAIN_URL) return WORKING_MAIN_URL;
  for (const base of MAIN_URLS) {
    try {
      await fetchText(base, { method: "HEAD" });
      WORKING_MAIN_URL = base;
      return base;
    } catch {}
  }
  WORKING_MAIN_URL = MAIN_URLS[0];
  return WORKING_MAIN_URL;
}

// ------------------------------------------------------------------
// Mapping: TMDB → IMDB → MAL (with caching)
// ------------------------------------------------------------------
async function getImdbId(tmdbId, mediaType) {
  const url = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}/external_ids?api_key=1865f43a0549ca50d341dd9ab8b29f49`;
  try {
    const data = await fetchJson(url);
    return data.imdb_id;
  } catch (e) {
    console.error("[AnimePahe] TMDB external ID error:", e.message);
    return null;
  }
}
async function resolveMapping(imdbId, season, episode) {
  const key = `${imdbId}-${season}-${episode}`;
  if (mappingCache.has(key)) return mappingCache.get(key);
  const url = `https://id-mapping-api-malid.hf.space/api/resolve?id=${imdbId}&s=${season}&e=${episode}`;
  try {
    const res = await fetchJson(url);
    mappingCache.set(key, res);
    return res;
  } catch (e) {
    console.error("[AnimePahe] Mapping API error:", e.message);
    return null;
  }
}
async function getMalTitle(malId) {
  const url = `https://api.jikan.moe/v4/anime/${malId}`;
  try {
    const data = await fetchJson(url);
    return data.data.title;
  } catch (e) {
    console.error("[AnimePahe] Jikan API error:", e.message);
    return null;
  }
}
async function searchAnime(query) {
  if (searchCache.has(query)) return searchCache.get(query);
  const base = await getWorkingMainUrl();
  const url = `${base}/api?m=search&l=8&q=${encodeURIComponent(query)}`;
  try {
    const data = await fetchJson(url);
    searchCache.set(query, data);
    return data;
  } catch (e) {
    console.error("[AnimePahe] Search error:", e.message);
    return { data: [] };
  }
}

// ------------------------------------------------------------------
// Kwik extraction (unpack + fallback)
// ------------------------------------------------------------------
function unpack(code) {
  try {
    const match = code.match(/}\((['"])([\s\S]*?)\1,\s*(\d+),\s*(\d+),\s*(['"])([\s\S]*?)\5\.split\((['"])\|\7\)/);
    if (match) {
      let [_, quote1, p, a, c, quote2, kStr] = match;
      p = p.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      a = parseInt(a);
      c = parseInt(c);
      const k = kStr.split("|");
      const e = (c2) => (c2 < a ? "" : e(parseInt(c2 / a))) + ((c2 = c2 % a) > 35 ? String.fromCharCode(c2 + 29) : c2.toString(36));
      const d = {};
      while (c--) d[e(c)] = k[c] || e(c);
      return p.replace(/\b\w+\b/g, (w) => d[w]);
    }
  } catch (e) {}
  return code;
}
async function extractKwik(kwikUrl) {
  try {
    const html = await fetchText(kwikUrl, {
      headers: {
        "Referer": kwikUrl,
        "User-Agent": HEADERS["User-Agent"],
      },
      useProxy: false,  // kwik may block proxies; fetch directly
    });
    // 1. Try to find packed script
    const scriptMatches = html.match(/<script.*?>([\s\S]*?)<\/script>/g) || [];
    for (const script of scriptMatches) {
      if (script.includes("eval(function(p,a,c,k,e,d)")) {
        let pos = 0;
        while (true) {
          const start = script.indexOf("eval(function(p,a,c,k,e,d)", pos);
          if (start === -1) break;
          const end = script.indexOf("))", start);
          if (end === -1) break;
          const packed = script.substring(start, end + 2);
          const unpacked = unpack(packed);
          const urlMatch = unpacked.match(/source\s*=\s*['"](https?:\/\/[^'"]+\.m3u8)['"]/);
          if (urlMatch) {
            return {
              url: urlMatch[1],
              headers: {
                "Referer": "https://kwik.cx/",
                "Origin": "https://kwik.cx",
                "User-Agent": HEADERS["User-Agent"],
              },
            };
          }
          pos = end + 2;
        }
      }
    }
    // 2. Fallback: direct .m3u8 search
    const directM3u8 = html.match(/(https?:\/\/[^\s"']+\.m3u8)/);
    if (directM3u8) {
      return {
        url: directM3u8[1],
        headers: { "Referer": "https://kwik.cx/", "User-Agent": HEADERS["User-Agent"] },
      };
    }
  } catch (e) {
    console.error("[AnimePahe] Kwik extraction failed:", e.message);
  }
  return null;
}

// ------------------------------------------------------------------
// Main exported function
// ------------------------------------------------------------------
async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const base = await getWorkingMainUrl();
    let animeSession = null;
    let mappedEp = episode;
    let targetMalId = null;
    let animeTitle = "";

    if (mediaType === "tv") {
      const imdbId = await getImdbId(tmdbId, mediaType);
      if (!imdbId) return [];
      const mapping = await resolveMapping(imdbId, season, episode);
      if (!mapping || !mapping.mal_id) return [];
      targetMalId = mapping.mal_id;
      mappedEp = mapping.mal_episode || episode;
      animeTitle = await getMalTitle(targetMalId);
      if (!animeTitle) return [];

      const searchRes = await searchAnime(animeTitle);
      for (let i = 0; i < Math.min(searchRes.data.length, 3); i++) {
        const item = searchRes.data[i];
        if (sessionCache.has(item.session)) {
          animeSession = item.session;
          break;
        }
        const pageHtml = await fetchText(`/anime/${item.session}`);
        if (pageHtml.includes(`myanimelist.net/anime/${targetMalId}`)) {
          animeSession = item.session;
          sessionCache.set(item.session, true);
          break;
        }
      }
    } else { // movie
      const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=1865f43a0549ca50d341dd9ab8b29f49`;
      const tmdbData = await fetchJson(tmdbUrl);
      animeTitle = tmdbData.title || tmdbData.original_title;
      if (!animeTitle) return [];
      const searchRes = await searchAnime(animeTitle);
      const exactMatch = searchRes.data.find(item => item.title?.toLowerCase() === animeTitle.toLowerCase());
      animeSession = exactMatch?.session || searchRes.data[0]?.session;
      mappedEp = 1;
    }

    if (!animeSession) return [];

    // Get episode session
    const firstPageUrl = `/api?m=release&id=${animeSession}&sort=episode_asc&page=1`;
    const firstPageData = await fetchJson(firstPageUrl);
    if (!firstPageData.data.length) return [];
    const paheEpStart = Math.floor(firstPageData.data[0].episode);
    const targetPaheEp = paheEpStart - 1 + mappedEp;
    const perPage = firstPageData.per_page || 30;
    const targetPage = Math.ceil(mappedEp / perPage) || 1;
    const targetPageUrl = `/api?m=release&id=${animeSession}&sort=episode_asc&page=${targetPage}`;
    const targetPageData = await fetchJson(targetPageUrl);
    let episodeSession = targetPageData.data.find(e => Math.floor(e.episode) === targetPaheEp)?.session;
    if (!episodeSession && targetPage !== 1) {
      episodeSession = firstPageData.data.find(e => Math.floor(e.episode) === targetPaheEp)?.session;
    }
    if (!episodeSession) return [];

    // Get play page
    const playHtml = await fetchText(`/play/${animeSession}/${episodeSession}`);
    const $ = cheerio.load(playHtml);
    const streams = [];
    const promises = [];

    $("#resolutionMenu button").each((i, btn) => {
      const $btn = $(btn);
      const kwikUrl = $btn.attr("data-src");
      const qualityText = $btn.text();
      let quality = "720p";
      const match = qualityText.match(/(\d{3,4}p)/);
      if (match) quality = match[1];
      const type = qualityText.toLowerCase().includes("eng") ? "Dub" : "Sub";
      if (kwikUrl && kwikUrl.includes("kwik")) {
        promises.push(
          extractKwik(kwikUrl).then(res => {
            if (res) {
              streams.push({
                name: `AnimePahe (${quality} ${type})`,
                title: `${animeTitle} - Episode ${mappedEp}`,
                url: res.url,
                quality,
                headers: res.headers,
                provider: "animepahe",
              });
            }
          })
        );
      }
    });
    await Promise.all(promises);
    const qualityOrder = { "1080p": 3, "720p": 2, "480p": 1 };
    streams.sort((a, b) => (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0));
    return streams;
  } catch (err) {
    console.error("[AnimePahe] Scraper error:", err.message);
    return [];
  }
}

module.exports = { getStreams };
