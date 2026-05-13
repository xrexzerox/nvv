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
// Extract video URL from the embed page
// ------------------------------------------------------------------
function extractVideoUrl(html, baseUrl) {
  const $ = cheerio.load(html);
  // Look for iframe (some sites embed another player)
  const iframe = $('iframe').first();
  if (iframe.length && iframe.attr('src')) {
    let src = iframe.attr('src');
    if (src.startsWith('/')) src = baseUrl + src;
    return src;
  }
  // Look for video element
  const video = $('video').first();
  if (video.length && video.attr('src')) {
    return video.attr('src');
  }
  // Look for source tag inside video
  const source = $('video source').first();
  if (source.length && source.attr('src')) {
    return source.attr('src');
  }
  // Search for .mp4 or .m3u8 in page source (sometimes in JSON or data attributes)
  const matches = html.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/i);
  if (matches) return matches[1];
  return null;
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
      if (!title) {
        console.log('[vidrock] TMDB title not found');
        return [];
      }
      console.log(`[vidrock] TMDB title: "${title}"`);
      displayTitle = title;
      embedUrl = `${BASE_URL}/movie/${tmdbId}`;
    } else {
      const title = await fetchTitleFromTMDB(tmdbId, 'tv');
      if (!title) {
        console.log('[vidrock] TMDB title not found');
        return [];
      }
      console.log(`[vidrock] TMDB title: "${title}"`);
      displayTitle = `${title} S${season}E${episode}`;
      embedUrl = `${BASE_URL}/tv/${tmdbId}/${season}/${episode}`;
    }

    console.log(`[vidrock] Fetching embed page: ${embedUrl}`);
    const html = await fetchHTML(embedUrl);
    if (!html) return [];

    // Try to get direct video URL
    let videoUrl = extractVideoUrl(html, embedUrl);
    if (videoUrl) {
      console.log(`[vidrock] Extracted direct video: ${videoUrl}`);
      return [{
        name: `VidRock - Stream 1`,
        title: displayTitle,
        url: videoUrl,
        quality: 'Auto',
        headers: VIDEO_HEADERS,
        provider: 'vidrock'
      }];
    }

    // If no direct URL found, fallback to embed page (external player)
    console.log(`[vidrock] No direct video found, using embed URL fallback`);
    return [{
      name: `VidRock - Embed (Open in Browser)`,
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
