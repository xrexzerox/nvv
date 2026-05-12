// providers/animotvslash.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa';

// ------------------------------------------------------------------
// MANUAL VIDEO MAPPING – add entries only for episodes that fail dynamic extraction.
// Key format: "slug-episode-X" (e.g., "anime-title-season-2-episode-1")
// Value: master.m3u8 URL
// ------------------------------------------------------------------
const VIDEO_MAP = {
  // Example: "that-time-i-got-reincarnated-as-a-slime-season-4-episode-5": "https://rumble.com/hls-vod/77fbdu/playlist.m3u8",
};

// ------------------------------------------------------------------
// SLUG OVERRIDES – for anime where the TMDB title does not produce the correct slug
// Format: "tmdbId": "correct-slug"
// ------------------------------------------------------------------
const SLUG_OVERRIDES = {
  // Example: "12345": "welcome-to-demon-school-iruma-kun",
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://animotvslash.org/',
};

const VIDEO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://animotvslash.org/',
  'Accept': 'video/webm,video/ogg,video/*;q=0.9,*/*;q=0.5',
};

// ------------------------------------------------------------------
// Helper: fetch HTML with error handling
// ------------------------------------------------------------------
async function fetchHTML(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    console.error(`[animotvslash] fetch error ${url}:`, err.message);
    return null;
  }
}

// ------------------------------------------------------------------
// Helper: fetch JSON
// ------------------------------------------------------------------
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
// Fetch title from TMDB
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
// Slugify title
// ------------------------------------------------------------------
function slugify(title) {
  return title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ------------------------------------------------------------------
// Extract all possible video URLs from HTML
// ------------------------------------------------------------------
function getAllPlayerUrls(html, baseUrl) {
  const $ = cheerio.load(html);
  const urls = new Set();

  // 1. Iframes
  $('iframe').each((i, el) => {
    let src = $(el).attr('src');
    if (src) urls.add(src);
  });

  // 2. Video sources
  $('source').each((i, el) => {
    let src = $(el).attr('src');
    if (src) urls.add(src);
  });

  // 3. Data attributes (common in players)
  $('[data-src], [data-url], [data-video]').each((i, el) => {
    let src = $(el).attr('data-src') || $(el).attr('data-url') || $(el).attr('data-video');
    if (src) urls.add(src);
  });

  // 4. Script tags containing video configuration
  $('script').each((i, el) => {
    const script = $(el).html();
    if (!script) return;

    // Look for "file": "..." or "source": "..."
    let match = script.match(/["'](?:file|source)["']\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
    if (match) urls.add(match[1]);

    // Look for raw video URLs
    match = script.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/gi);
    if (match) match.forEach(u => urls.add(u));
  });

  // 5. Direct search in HTML for .m3u8 or .mp4
  const directMatches = html.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/gi);
  if (directMatches) directMatches.forEach(u => urls.add(u));

  // Convert relative URLs to absolute
  const absolute = new Set();
  for (let url of urls) {
    if (url.startsWith('http')) {
      absolute.add(url);
    } else if (url.startsWith('/')) {
      absolute.add(baseUrl.replace(/\/$/, '') + url);
    } else if (url.startsWith('//')) {
      absolute.add('https:' + url);
    }
  }
  return Array.from(absolute);
}

// ------------------------------------------------------------------
// Try to get post ID from page or API
// ------------------------------------------------------------------
async function getPostId(pageHtml, slug) {
  // From page HTML
  let match = pageHtml.match(/<link rel="shortlink" href="[^"]*\?p=(\d+)"/);
  if (match) return match[1];
  match = pageHtml.match(/"post_id":"(\d+)"/);
  if (match) return match[1];
  match = pageHtml.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/);
  if (match) return match[1];

  // Fallback to WordPress REST API using slug
  const apiUrl = `https://animotvslash.org/wp-json/wp/v2/posts?slug=${slug}`;
  const data = await fetchJSON(apiUrl);
  if (data && data.length > 0) return data[0].id;
  return null;
}

// ------------------------------------------------------------------
// Try to fetch video URL from Dooplayer API (like pinoymovieshub)
// ------------------------------------------------------------------
async function fetchDooplayerUrl(postId, mediaType, episode) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const apiUrl = `https://animotvslash.org/wp-json/dooplayer/v2/${postId}/${type}/${episode}`;
  const data = await fetchJSON(apiUrl);
  if (data && data.embed_url) return data.embed_url;
  if (data && data.source) return data.source;
  return null;
}

// ------------------------------------------------------------------
// Decode JW Player token URL (if present)
// ------------------------------------------------------------------
function decodeJwPlayerUrl(url) {
  const match = url.match(/\/jw-player\/([^/?&#]+)/);
  if (!match) return url;
  let b64 = match[1];
  while (b64.length % 4) b64 += '=';
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const decoded = atob(b64);
    const data = JSON.parse(decoded);
    if (data.url) return data.url;
  } catch (e) {}
  return url;
}

// ------------------------------------------------------------------
// Main exported function
// ------------------------------------------------------------------
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  console.log(`[animotvslash] === START for ${mediaType} ID:${tmdbId} S${seasonNum}E${episodeNum} ===`);

  try {
    const title = await fetchTitleFromTMDB(tmdbId, mediaType);
    if (!title) {
      console.log('[animotvslash] TMDB title not found');
      return [];
    }
    console.log(`[animotvslash] TMDB title: "${title}"`);

    let baseSlug = slugify(title);
    if (SLUG_OVERRIDES[tmdbId]) {
      baseSlug = SLUG_OVERRIDES[tmdbId];
      console.log(`[animotvslash] using override slug: ${baseSlug}`);
    }
    if (mediaType === 'tv' && seasonNum > 1) {
      baseSlug = `${baseSlug}-${seasonNum}`;
    }
    const episodeKey = `${baseSlug}-episode-${episodeNum}`;

    // Check manual mapping
    if (VIDEO_MAP[episodeKey]) {
      console.log(`[animotvslash] Using manual mapping for ${episodeKey}`);
      return [{
        name: `ANIMOTVSLASH - Manual`,
        title: `S${seasonNum}E${episodeNum}`,
        url: VIDEO_MAP[episodeKey],
        quality: 'Auto',
        headers: VIDEO_HEADERS,
        provider: 'animotvslash'
      }];
    }

    // Build page URL
    let pageUrl;
    if (mediaType === 'tv') {
      pageUrl = `https://animotvslash.org/${baseSlug}-episode-${episodeNum}/`;
    } else {
      pageUrl = `https://animotvslash.org/${baseSlug}/`;
    }
    console.log(`[animotvslash] Fetching page: ${pageUrl}`);

    const html = await fetchHTML(pageUrl);
    if (!html) {
      console.log('[animotvslash] Failed to fetch page');
      return [];
    }

    // Extract player URLs from HTML
    let playerUrls = getAllPlayerUrls(html, pageUrl);
    console.log(`[animotvslash] Found ${playerUrls.length} URLs from HTML:`, playerUrls);

    // If none found, try Dooplayer API
    if (playerUrls.length === 0) {
      const postId = await getPostId(html, baseSlug);
      if (postId) {
        console.log(`[animotvslash] Post ID: ${postId}, trying Dooplayer API`);
        const apiUrl = await fetchDooplayerUrl(postId, mediaType, episodeNum);
        if (apiUrl) {
          console.log(`[animotvslash] Dooplayer API returned: ${apiUrl}`);
          playerUrls.push(apiUrl);
        } else {
          console.log('[animotvslash] Dooplayer API returned nothing');
        }
      }
    }

    // Process all discovered URLs
    const streams = [];
    const seen = new Set();
    for (let url of playerUrls) {
      if (seen.has(url)) continue;
      seen.add(url);
      // Decode JW Player URLs
      const videoUrl = decodeJwPlayerUrl(url);
      streams.push({
        name: `ANIMOTVSLASH - Stream ${streams.length + 1}`,
        title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
        url: videoUrl,
        quality: 'Auto',
        headers: VIDEO_HEADERS,
        provider: 'animotvslash'
      });
    }

    console.log(`[animotvslash] Returning ${streams.length} stream(s)`);
    return streams;
  } catch (err) {
    console.error('[animotvslash] error:', err.message);
    return [];
  }
}

module.exports = { getStreams };
