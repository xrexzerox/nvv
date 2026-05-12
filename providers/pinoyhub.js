// providers/pinoyhub.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const BASE_URL = 'https://pinoymovieshub.win';
const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': BASE_URL,
  'Cookie': 'starstruck_7da72d90b632af60dd1158c068193d61=99f22538d0588cdd7ccfc783299f88a7' // update if expired
};

const VIDEO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': BASE_URL,
  'Accept': 'video/webm,video/ogg,video/*;q=0.9,*/*;q=0.5'
};

// ------------------------------------------------------------------
// Helper: fetch HTML with redirects
// ------------------------------------------------------------------
async function fetchHTML(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    console.error(`[pinoyhub] fetch error ${url}:`, err.message);
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
// Follow internal /links/... redirect to the final external URL
// ------------------------------------------------------------------
async function resolveInternalLink(linkUrl) {
  console.log(`[pinoyhub] Following internal link: ${linkUrl}`);
  try {
    const res = await fetch(linkUrl, { headers: HEADERS, redirect: 'follow' });
    const finalUrl = res.url;
    if (finalUrl !== linkUrl && !finalUrl.includes('pinoymovieshub.win')) {
      console.log(`[pinoyhub] Redirected to: ${finalUrl}`);
      return finalUrl;
    }
  } catch (err) {}
  return null;
}

// ------------------------------------------------------------------
// Extract the download links table from the page
// ------------------------------------------------------------------
function extractDownloadLinks(html) {
  const $ = cheerio.load(html);
  const table = $('#download .links_table table');
  if (!table.length) return [];
  const links = [];
  table.find('tbody tr').each((i, row) => {
    const cols = $(row).find('td');
    if (cols.length < 4) return;
    const a = $(cols[0]).find('a');
    if (!a.length) return;
    let url = a.attr('href');
    if (url && !url.startsWith('http')) url = BASE_URL + url;
    const quality = $(cols[1]).find('strong.quality').text().trim() || 'Unknown';
    const language = $(cols[2]).text().trim();
    links.push({ url, quality, language });
  });
  return links;
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

function slugify(title) {
  return title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function getSeriesSlug(tmdbId) {
  const title = await fetchTitleFromTMDB(tmdbId, 'tv');
  if (!title) throw new Error('Cannot derive series slug from TMDB');
  return slugify(title);
}

// ------------------------------------------------------------------
// Main exported function
// ------------------------------------------------------------------
async function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[pinoyhub] === START for ${mediaType} TMDB ID:${tmdbId} S${season}E${episode} ===`);

  try {
    let pageUrl, displayTitle;

    if (mediaType === 'movie') {
      const movieTitle = await fetchTitleFromTMDB(tmdbId, 'movie');
      if (!movieTitle) {
        console.log('[pinoyhub] TMDB title not found');
        return [];
      }
      console.log(`[pinoyhub] TMDB title: "${movieTitle}"`);
      displayTitle = 'Movie';
      const movieSlug = slugify(movieTitle);
      pageUrl = `${BASE_URL}/movies/${movieSlug}/`;
    } else {
      const seriesSlug = await getSeriesSlug(tmdbId);
      const originalTitle = await fetchTitleFromTMDB(tmdbId, 'tv');
      console.log(`[pinoyhub] TMDB title: "${originalTitle}"`);
      displayTitle = `S${season}E${episode}`;
      pageUrl = `${BASE_URL}/episodes/${seriesSlug}-${season}x${episode}/`;
    }

    console.log(`[pinoyhub] Fetching page: ${pageUrl}`);
    const html = await fetchHTML(pageUrl);
    if (!html) return [];

    const links = extractDownloadLinks(html);
    if (links.length === 0) return [];

    const streams = [];
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      // Skip subtitle-only links
      if (link.quality.toLowerCase() === 'subtitle' || link.language.toLowerCase() === 'english') continue;

      console.log(`[pinoyhub] Processing ${link.quality} / ${link.language}: ${link.url}`);
      const externalUrl = await resolveInternalLink(link.url);
      if (!externalUrl) continue;

      streams.push({
        name: `PinoyHub - Stream ${streams.length + 1}`,
        title: displayTitle,
        url: externalUrl,
        quality: 'Auto',
        headers: VIDEO_HEADERS,
        provider: 'pinoyhub',
        behaviorHints: { notWebReady: true }
      });
    }

    console.log(`[pinoyhub] Returning ${streams.length} stream(s)`);
    return streams;
  } catch (err) {
    console.error('[pinoyhub] error:', err.message);
    return [];
  }
}

module.exports = { getStreams };
