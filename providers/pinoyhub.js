// providers/pinoyhub.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa'; // same as animotvslash

// ------------------------------------------------------------------
// MANUAL VIDEO MAPPING – add entries only for episodes that fail dynamic extraction.
// Key format: "slug-S{season}E{episode}" or "movie-slug"
// Value: direct video URL (mp4/m3u8) or embed URL (will be resolved)
// ------------------------------------------------------------------
const VIDEO_MAP = {
  // "if-wishes-could-kill-S1E1": "https://mixdrop.co/f/abc123",
};

// ------------------------------------------------------------------
// SLUG OVERRIDES – for titles where the TMDB title does not produce the correct slug
// Format: "tmdbId": "correct-slug"
// ------------------------------------------------------------------
const SLUG_OVERRIDES = {
  // "12345": "some-series-slug",
};

// Headers used for fetching pages
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://pinoymovieshub.win/',
  'Cookie': 'starstruck_7da72d90b632af60dd1158c068193d61=99f22538d0588cdd7ccfc783299f88a7' // may need refresh
};

// Headers for video requests (could be empty or referer)
const VIDEO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://pinoymovieshub.win/',
};

// ------------------------------------------------------------------
// Helper: fetch HTML with error handling
// ------------------------------------------------------------------
async function fetchHTML(url) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    console.error(`[pinoyhub] fetch error ${url}:`, err.message);
    return null;
  }
}

// ------------------------------------------------------------------
// Helper: fetch JSON from API endpoint
// ------------------------------------------------------------------
async function fetchJSON(url) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`[pinoyhub] API error ${url}:`, err.message);
    return null;
  }
}

// ------------------------------------------------------------------
// Resolve internal /links/... redirect to external URL
// ------------------------------------------------------------------
async function resolveInternalLink(linkUrl) {
  const html = await fetchHTML(linkUrl);
  if (!html) return null;

  // Method 1: meta refresh
  const $ = cheerio.load(html);
  let meta = $('meta[http-equiv="refresh"]');
  if (meta.length) {
    const content = meta.attr('content');
    const match = content.match(/url=(.+)/);
    if (match) return match[1];
  }

  // Method 2: direct download button link
  let a = $('a.download-btn, a.button, a[target="_blank"]').first();
  if (a.length && a.attr('href')) return a.attr('href');

  // Method 3: JavaScript redirect
  const scripts = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
  if (scripts) return scripts[1];

  // Method 4: any external link not pointing to pinoymovieshub
  let allLinks = $('a[href]');
  for (let i = 0; i < allLinks.length; i++) {
    const href = allLinks.eq(i).attr('href');
    if (href && !href.includes('pinoymovieshub.win') && (href.startsWith('http') || href.startsWith('//'))) {
      return href;
    }
  }
  return null;
}

// ------------------------------------------------------------------
// Resolve external video host (mixdrop, playmogo, dood, byse, etc.)
// Returns direct video URL (mp4/m3u8) or null.
// ------------------------------------------------------------------
async function resolveExternalHost(externalUrl) {
  const html = await fetchHTML(externalUrl);
  if (!html) return null;

  // Patterns for different hosts
  const patterns = [
    // token & expiry (doodstream / playmogo)
    /token\s*[:=]\s*["']([^"']+)["']/.source,
    /expiry\s*[:=]\s*["']([^"']+)["']/.source,
    // file variable
    /file:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/,
    // source in JSON
    /"source":"([^"]+)"/,
    // raw URL
    /(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/i,
    // player setup source
    /player\.setup\([^)]*source:\s*["']([^"']+)["']/
  ];

  for (let pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      let url = match[1];
      if (url.includes('\\/')) url = url.replace(/\\\//g, '/');
      // If token/expiry found, build direct download URL
      if (pattern.toString().includes('token') && pattern.toString().includes('expiry')) {
        const tokenMatch = html.match(/token\s*[:=]\s*["']([^"']+)["']/);
        const expiryMatch = html.match(/expiry\s*[:=]\s*["']([^"']+)["']/);
        if (tokenMatch && expiryMatch) {
          const videoId = externalUrl.split('/').pop();
          const domain = externalUrl.split('/')[2];
          url = `https://${domain}/dl/${videoId}?token=${tokenMatch[1]}&expiry=${expiryMatch[1]}`;
          // Verify
          const head = await fetch(url, { method: 'HEAD', headers: VIDEO_HEADERS });
          if (head.ok && head.headers.get('content-type')?.includes('video')) return url;
          continue;
        }
      }
      return url;
    }
  }
  return null;
}

// ------------------------------------------------------------------
// Extract download links from a movie or episode page HTML
// ------------------------------------------------------------------
function extractDownloadLinks(html, contextTitle, season, episode) {
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
    if (url && !url.startsWith('http')) url = 'https://pinoymovieshub.win' + url;
    const quality = $(cols[1]).find('strong.quality').text().trim() || 'Unknown';
    const language = $(cols[2]).text().trim();
    const title = contextTitle + (season ? ` - S${season}E${episode}` : '');
    links.push({ url, quality, language, title });
  });
  return links;
}

// ------------------------------------------------------------------
// Slugify title (same as animotvslash)
// ------------------------------------------------------------------
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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
// Main exported function
// ------------------------------------------------------------------
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  console.log(`[pinoyhub] === START for ${mediaType} ID:${tmdbId} S${seasonNum}E${episodeNum} ===`);

  try {
    // Get TMDB title
    let title = await fetchTitleFromTMDB(tmdbId, mediaType);
    if (!title) {
      console.log('[pinoyhub] TMDB title not found');
      return [];
    }
    console.log(`[pinoyhub] TMDB title: "${title}"`);

    // Determine slug
    let baseSlug = slugify(title);
    if (SLUG_OVERRIDES[tmdbId]) {
      baseSlug = SLUG_OVERRIDES[tmdbId];
      console.log(`[pinoyhub] using override slug: ${baseSlug}`);
    }

    // Construct page URL and manual mapping key
    let pageUrl, manualKey;
    if (mediaType === 'movie') {
      pageUrl = `https://pinoymovieshub.win/movies/${baseSlug}/`;
      manualKey = baseSlug;
    } else {
      // TV episode
      if (!seasonNum || !episodeNum) return [];
      pageUrl = `https://pinoymovieshub.win/episodes/${baseSlug}-${seasonNum}x${episodeNum}/`;
      manualKey = `${baseSlug}-S${seasonNum}E${episodeNum}`;
    }

    // Check manual mapping first
    if (VIDEO_MAP[manualKey]) {
      console.log(`[pinoyhub] Using manual mapping for ${manualKey}`);
      let videoUrl = VIDEO_MAP[manualKey];
      // If it's not a direct video, try to resolve
      if (!videoUrl.match(/\.(m3u8|mp4)$/i)) {
        const resolved = await resolveExternalHost(videoUrl);
        if (resolved) videoUrl = resolved;
      }
      return [{
        name: `PinoyHub - Manual`,
        title: mediaType === 'movie' ? title : `S${seasonNum}E${episodeNum}`,
        url: videoUrl,
        quality: 'Auto',
        headers: VIDEO_HEADERS,
        provider: 'pinoyhub'
      }];
    }

    // Fetch page HTML
    console.log(`[pinoyhub] fetching page: ${pageUrl}`);
    const html = await fetchHTML(pageUrl);
    if (!html) return [];

    // Extract download links
    const links = extractDownloadLinks(html, title, seasonNum, episodeNum);
    if (links.length === 0) {
      console.log('[pinoyhub] No download links found on page');
      return [];
    }

    console.log(`[pinoyhub] Found ${links.length} download links`);

    // Process each link
    const streams = [];
    for (const link of links) {
      console.log(`[pinoyhub] Processing link: ${link.quality} / ${link.language} => ${link.url}`);
      // 1. Resolve internal redirect
      let externalUrl = await resolveInternalLink(link.url);
      if (!externalUrl) {
        console.log(`[pinoyhub] Failed to resolve internal link, skipping`);
        continue;
      }
      console.log(`[pinoyhub] External URL: ${externalUrl}`);
      // 2. Resolve external host to direct video
      let directUrl = await resolveExternalHost(externalUrl);
      if (!directUrl) {
        // Fallback: use external URL as is (could be embed)
        directUrl = externalUrl;
      }
      console.log(`[pinoyhub] Direct video URL: ${directUrl}`);
      streams.push({
        name: `PinoyHub - ${link.quality} ${link.language}`,
        title: link.title,
        url: directUrl,
        quality: link.quality,
        headers: VIDEO_HEADERS,
        provider: 'pinoyhub'
      });
    }

    console.log(`[pinoyhub] returning ${streams.length} stream(s)`);
    return streams;

  } catch (err) {
    console.error('[pinoyhub] error:', err.message);
    return [];
  }
}

module.exports = { getStreams };
