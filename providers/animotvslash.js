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
// Decode JW Player base64 token
// ----------------------------------------------------------------------
function decodeJwPlayerUrl(playerUrl) {
  const match = playerUrl.match(/\/jw-player\/([^/?&#]+)/);
  if (!match) return null;
  let b64 = match[1];
  while (b64.length % 4) b64 += '=';
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
// Extract all player URLs from HTML (iframes, data-*, base64 tokens)
// ----------------------------------------------------------------------
function getAllPlayerUrls(html, baseUrl) {
  const urls = new Set();
  // iframe src
  const iframeRe = /<iframe[^>]+src=["']([^"']*?\/jw-player\/[^"']+)["']/gi;
  let match;
  while ((match = iframeRe.exec(html)) !== null) {
    if (match[1]) urls.add(match[1]);
  }
  // data-src / data-url
  const dataRe = /data-(?:src|url)=["']([^"']*?\/jw-player\/[^"']+)["']/gi;
  while ((match = dataRe.exec(html)) !== null) {
    if (match[1]) urls.add(match[1]);
  }
  // base64 tokens (starting with eyJ)
  const tokenRe = /(eyJ[a-zA-Z0-9+/=]+)['"]/g;
  while ((match = tokenRe.exec(html)) !== null) {
    const token = match[1];
    if (token.length > 20 && token.startsWith('eyJ')) {
      urls.add(`https://animotvslash.org/jw-player/${token}/`);
    }
  }
  // make absolute
  const absolute = new Set();
  for (let url of urls) {
    if (url.startsWith('http')) absolute.add(url);
    else absolute.add(baseUrl.replace(/\/$/, '') + '/' + url.replace(/^\//, ''));
  }
  return Array.from(absolute);
}

// ----------------------------------------------------------------------
// Extract post ID from HTML (shortlink or JSON)
// ----------------------------------------------------------------------
function getPostId(html) {
  let match = html.match(/<link rel="shortlink" href="[^"]*\?p=(\d+)"/);
  if (match) return match[1];
  match = html.match(/"post_id":"(\d+)"/);
  if (match) return match[1];
  match = html.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/);
  if (match) return match[1];
  return null;
}

// ----------------------------------------------------------------------
// Try to fetch additional player URL via AJAX (for SOFTSUB, etc.)
// ----------------------------------------------------------------------
function fetchAdditionalPlayerUrl(postId) {
  return new Promise((resolve) => {
    const ajaxUrl = 'https://animotvslash.org/wp-admin/admin-ajax.php';
    const actions = ['get_embed', 'get_video', 'get_player', 'load_player', 'get_video_sources', 'embed'];
    let index = 0;
    function tryNext() {
      if (index >= actions.length) {
        resolve(null);
        return;
      }
      const action = actions[index];
      const params = new URLSearchParams();
      params.append('action', action);
      params.append('post_id', postId);
      fetch(ajaxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      })
        .then(res => res.json())
        .then(data => {
          const str = JSON.stringify(data);
          const playerMatch = str.match(/\/jw-player\/([^"']+)/);
          if (playerMatch) {
            resolve(`https://animotvslash.org/jw-player/${playerMatch[1]}`);
          } else {
            index++;
            tryNext();
          }
        })
        .catch(() => {
          index++;
          tryNext();
        });
    }
    tryNext();
  });
}

// ----------------------------------------------------------------------
// Slugify title
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
// Fetch title from TMDB
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
    fetchTitleFromTMDB(tmdbId, mediaType)
      .then(title => {
        if (!title) {
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
        return fetch(pageUrl, { headers: HEADERS })
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then(html => {
            const playerUrls = getAllPlayerUrls(html, pageUrl);
            const postId = getPostId(html);
            let streams = [];
            const seen = new Set();

            // Helper to add stream from player URL
            function addStreamFromPlayerUrl(pUrl, serverHint) {
              const videoUrl = decodeJwPlayerUrl(pUrl);
              if (videoUrl && !seen.has(videoUrl)) {
                seen.add(videoUrl);
                let serverName = serverHint;
                if (!serverName) {
                  if (pUrl.toLowerCase().includes('hard')) serverName = 'HARDSUB';
                  else if (pUrl.toLowerCase().includes('soft')) serverName = 'SOFTSUB';
                  else serverName = `Server${streams.length + 1}`;
                }
                let quality = 'Auto';
                if (videoUrl.includes('1080')) quality = '1080p';
                else if (videoUrl.includes('720')) quality = '720p';
                else if (videoUrl.includes('480')) quality = '480p';
                else if (videoUrl.match(/\d{3,4}p/)) quality = videoUrl.match(/\d{3,4}p/)[0];
                streams.push({
                  name: `ANIMOTVSLASH - ${serverName} (${quality})`,
                  title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
                  url: videoUrl,
                  quality: quality,
                  size: 'Unknown',
                  headers: VIDEO_HEADERS,
                  subtitles: [],
                  provider: 'animotvslash'
                });
              }
            }

            // Add streams from existing player URLs
            for (let pUrl of playerUrls) {
              addStreamFromPlayerUrl(pUrl, null);
            }

            // If only one stream found, try to fetch additional via AJAX
            if (streams.length < 2 && postId) {
              return fetchAdditionalPlayerUrl(postId).then(extraPlayerUrl => {
                if (extraPlayerUrl) {
                  addStreamFromPlayerUrl(extraPlayerUrl, 'SOFTSUB');
                }
                return streams;
              });
            }
            return streams;
          })
          .then(streams => resolve(streams))
          .catch(err => {
            console.error('[animotvslash] error:', err.message);
            resolve([]);
          });
      })
      .catch(() => resolve([]));
  });
}

module.exports = { getStreams };
