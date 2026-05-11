// providers/animotvslash.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa';

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

// ----------------------------------------------------------------------
// Helper: decode a JW Player URL (base64‑encoded JSON)
// Example: /jw-player/eyJ1cmwiOiJodHRwczovL3J1bWJsZS5jb20vaGxzLXZvZC83N2FtZjQvcGxheWxpc3QubTN1OCIs...
// Decodes to: {"url":"https://rumble.com/hls-vod/77amf4/playlist.m3u8", ...}
// ----------------------------------------------------------------------
function decodeJwPlayerUrl(playerUrl) {
  const match = playerUrl.match(/\/jw-player\/([^/?&#]+)/);
  if (!match) return null;
  let b64 = match[1];
  // Add padding if needed
  while (b64.length % 4) b64 += '=';
  // Convert URL‑safe base64 to standard base64
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const decoded = atob(b64);
    const data = JSON.parse(decoded);
    return data.url || null;
  } catch (e) {
    console.log('[animotvslash] decode error:', e.message);
    return null;
  }
}

// ----------------------------------------------------------------------
// Extract all player URLs from HTML using multiple regex patterns
// (copied from working Python script)
// ----------------------------------------------------------------------
function getAllPlayerUrls(html, baseUrl) {
  const urls = new Set();
  // Pattern 1: iframe src
  const iframeRe = /<iframe[^>]+src=["']([^"']*?\/jw-player\/[^"']+)["']/gi;
  let match;
  while ((match = iframeRe.exec(html)) !== null) {
    if (match[1]) urls.add(match[1]);
  }
  // Pattern 2: data-src or data-url attributes
  const dataRe = /data-(?:src|url)=["']([^"']*?\/jw-player\/[^"']+)["']/gi;
  while ((match = dataRe.exec(html)) !== null) {
    if (match[1]) urls.add(match[1]);
  }
  // Pattern 3: base64 tokens inside scripts (starting with "eyJ")
  const tokenRe = /(eyJ[a-zA-Z0-9+/=]+)['"]/g;
  while ((match = tokenRe.exec(html)) !== null) {
    const token = match[1];
    if (token.length > 20 && token.startsWith('eyJ')) {
      const fullUrl = `https://animotvslash.org/jw-player/${token}/`;
      urls.add(fullUrl);
    }
  }
  // Make URLs absolute
  const absolute = new Set();
  for (let url of urls) {
    if (url.startsWith('http')) {
      absolute.add(url);
    } else {
      absolute.add(baseUrl.replace(/\/$/, '') + '/' + url.replace(/^\//, ''));
    }
  }
  return Array.from(absolute);
}

// ----------------------------------------------------------------------
// Slugify title (same as before)
// ----------------------------------------------------------------------
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ----------------------------------------------------------------------
// Fetch title from TMDB (same as before)
// ----------------------------------------------------------------------
function fetchTitleFromTMDB(tmdbId, mediaType) {
  const url = mediaType === 'tv'
    ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`
    : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
  return fetch(url)
    .then(res => res.json())
    .then(data => mediaType === 'tv' ? (data.name || data.original_name) : (data.title || data.original_title))
    .catch(() => null);
}

// ----------------------------------------------------------------------
// Main exported function
// ----------------------------------------------------------------------
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return new Promise((resolve) => {
    console.log(`[animotvslash] called for ${mediaType} ${tmdbId} S${seasonNum}E${episodeNum}`);
    fetchTitleFromTMDB(tmdbId, mediaType)
      .then(title => {
        if (!title) {
          console.log('[animotvslash] TMDB title not found');
          resolve([]);
          return;
        }
        let baseSlug = slugify(title);
        let pageUrl;
        if (mediaType === 'tv') {
          if (seasonNum > 1) baseSlug = `${baseSlug}-${seasonNum}`;
          pageUrl = `https://animotvslash.org/${baseSlug}-episode-${episodeNum}/`;
        } else {
          pageUrl = `https://animotvslash.org/${baseSlug}/`;
        }
        console.log(`[animotvslash] fetching ${pageUrl}`);
        fetch(pageUrl, { headers: HEADERS })
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then(html => {
            const playerUrls = getAllPlayerUrls(html, pageUrl);
            console.log(`[animotvslash] found ${playerUrls.length} player URLs`);
            const streams = [];
            const seen = new Set();
            for (let i = 0; i < playerUrls.length; i++) {
              const playerUrl = playerUrls[i];
              const videoUrl = decodeJwPlayerUrl(playerUrl);
              if (videoUrl && !seen.has(videoUrl)) {
                seen.add(videoUrl);
                let serverName = '';
                if (playerUrl.toLowerCase().includes('hard')) serverName = 'HARDSUB';
                else if (playerUrl.toLowerCase().includes('soft')) serverName = 'SOFTSUB';
                else serverName = `Server${streams.length + 1}`;
                let quality = 'Auto';
                if (videoUrl.includes('1080')) quality = '1080p';
                else if (videoUrl.includes('720')) quality = '720p';
                else if (videoUrl.includes('480')) quality = '480p';
                else if (videoUrl.match(/\d{3,4}p/)) quality = videoUrl.match(/\d{3,4}p/)[0];
                const stream = {
                  name: `ANIMOTVSLASH - ${serverName} (${quality})`,
                  title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
                  url: videoUrl,
                  quality: quality,
                  size: 'Unknown',
                  headers: VIDEO_HEADERS,
                  subtitles: [],
                  provider: 'animotvslash'
                };
                streams.push(stream);
              }
            }
            if (streams.length === 0) {
              console.log('[animotvslash] no video stream found');
            }
            resolve(streams);
          })
          .catch(err => {
            console.error('[animotvslash] fetch error:', err.message);
            resolve([]);
          });
      })
      .catch(err => {
        console.error('[animotvslash] TMDB error:', err.message);
        resolve([]);
      });
  });
}

module.exports = { getStreams };
