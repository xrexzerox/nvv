// providers/vidrock.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

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

async function fetchTitleFromTMDB(tmdbId, mediaType) {
  const url = mediaType === 'tv'
    ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`
    : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const data = await fetchJSON(url);
  if (!data) return null;
  return mediaType === 'tv' ? (data.name || data.original_name) : (data.title || data.original_title);
}

function extractVideoUrl(html, baseUrl) {
  const $ = cheerio.load(html);
  // only simple iframe/video elements; JavaScript‑loaded content will be missed
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
  const urlMatch = html.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/i);
  if (urlMatch) return urlMatch[1];
  return null;
}

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

    const html = await fetchHTML(embedUrl);
    if (!html) return [];

    // try to find a direct video URL (rare)
    const direct = extractVideoUrl(html, embedUrl);
    if (direct) {
      return [{
        name: 'VidRock - Direct',
        title: displayTitle,
        url: direct,
        quality: 'Auto',
        headers: VIDEO_HEADERS,
        provider: 'vidrock'
      }];
    }

    // fallback – open in external browser
    return [{
      name: 'VidRock - Open in Browser',
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
