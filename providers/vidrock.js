let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const puppeteer = require('puppeteer');

const BASE_URL = 'https://vidrock.net';
const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': BASE_URL,
};

const VIDEO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': BASE_URL,
  'Accept': 'video/webm,video/ogg,video/*;q=0.9,*/*;q=0.5',
};

async function fetchHTML(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    console.error(`[vidrock] fetch error ${url}:`, err.message);
    return null;
  }
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// TMDB helpers
// ------------------------------------------------------------------
async function fetchTitleFromTMDB(tmdbId, mediaType) {
  const url = mediaType === 'tv'
    ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`
    : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const data = await fetchJSON(url);
  if (!data) return null;
  return mediaType === 'tv' ? (data.name || data.original_name) : (data.title || data.original_title);
}

// ------------------------------------------------------------------
// Static HTML extractor
// ------------------------------------------------------------------
function extractVideoUrl(html, baseUrl) {
  const $ = cheerio.load(html);
  const iframe = $('iframe').first();
  if (iframe.length && iframe.attr('src')) {
    let src = iframe.attr('src');
    if (src.startsWith('/')) src = baseUrl + src;
    return src;
  }
  const video = $('video').first();
  if (video.length && video.attr('src')) return video.attr('src');
  const source = $('video source').first();
  if (source.length && source.attr('src')) return source.attr('src');
  const matches = html.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/i);
  if (matches) return matches[1];
  return null;
}

// ------------------------------------------------------------------
// Puppeteer extractor
// ------------------------------------------------------------------
async function extractVideoUrlsWithPuppeteer(embedUrl) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const videoUrls = new Set();

  page.on('response', async (response) => {
    const url = response.url();
    if (url.match(/\.(m3u8|mp4)(\?.*)?$/i)) {
      console.log('[vidrock] Found stream:', url);
      videoUrls.add(url);
    }
  });

  await page.goto(embedUrl, { waitUntil: 'networkidle2' });

  const iframeSrc = await page.$eval('iframe', el => el.src).catch(() => null);
  const videoSrc = await page.$eval('video', el => el.src).catch(() => null);
  const sourceSrc = await page.$eval('video source', el => el.src).catch(() => null);

  [iframeSrc, videoSrc, sourceSrc].forEach(src => {
    if (src) videoUrls.add(src);
  });

  await browser.close();
  return Array.from(videoUrls);
}

// ------------------------------------------------------------------
// Main exported function
// ------------------------------------------------------------------
async function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[vidrock] === START for ${mediaType} TMDB ID:${tmdbId} S${season}E${episode} ===`);

  try {
    let embedUrl, displayTitle;

    if (mediaType === 'movie') {
      const title = await fetchTitleFromTMDB(tmdbId, 'movie');
      if (!title) return [];
      displayTitle = title;
      embedUrl = `${BASE_URL}/movie/${tmdbId}`;
    } else {
      const title = await fetchTitleFromTMDB(tmdbId, 'tv');
      if (!title) return [];
      displayTitle = `${title} S${season}E${episode}`;
      embedUrl = `${BASE_URL}/tv/${tmdbId}/${season}/${episode}`;
    }

    console.log(`[vidrock] Fetching embed page: ${embedUrl}`);
    const html = await fetchHTML(embedUrl);
    if (!html) return [];

    // Try static extraction first
    let directUrl = extractVideoUrl(html, embedUrl);
    if (directUrl) {
      console.log(`[vidrock] Extracted direct video: ${directUrl}`);
      return [{
        name: `VidRock - Direct Stream`,
        title: displayTitle,
        url: directUrl,
        quality: 'Auto',
        headers: VIDEO_HEADERS,
        provider: 'vidrock'
      }];
    }

    // If static fails, try Puppeteer
    console.log('[vidrock] No static video found, trying Puppeteer...');
    const urls = await extractVideoUrlsWithPuppeteer(embedUrl);
    if (urls.length) {
      return urls.map(u => ({
        name: `VidRock - Direct Stream`,
        title: displayTitle,
        url: u,
        quality: 'Auto',
        headers: VIDEO_HEADERS,
        provider: 'vidrock'
      }));
    }

    // Fallback: embed URL
    console.log('[vidrock] No direct video found, returning embed URL as fallback');
    return [{
      name: `VidRock - Open in Browser`,
      title: displayTitle,
      url: embedUrl,
      quality: 'Auto',
      headers: HEADERS,
      provider: 'vidrock',
      behaviorHints: { notWebReady: true }
    }];
  } catch (err) {
    console.error('[vidrock] error:', err.message);
    return [];
  }
}

module.exports = { getStreams };
