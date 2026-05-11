// providers/animotvslash.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa';

// ------------------------------------------------------------------
// MANUAL VIDEO MAPPING – overrides dynamic extraction for problematic episodes
// Key format: "slug-episode-X" (e.g., "welcome-to-demon-school-iruma-kun-season-2-episode-1")
// Value: master.m3u8 URL (the playlist that contains #EXT-X-STREAM-INF lines)
// ------------------------------------------------------------------
const VIDEO_MAP = {
  'welcome-to-demon-school-iruma-kun-season-2-episode-1': 'https://rumble.com/hls-vod/77fbdu/playlist.m3u8',
  // Add more entries as you discover them
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
  'Accept-Encoding': 'identity',
};

// ------------------------------------------------------------------
// Helper: fetch and parse a master playlist to extract quality variants
// ------------------------------------------------------------------
function fetchQualities(masterUrl) {
  return new Promise((resolve) => {
    fetch(masterUrl, { headers: HEADERS })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(data => {
        const lines = data.split('\n');
        const variants = [];
        let currentQuality = null;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('#EXT-X-STREAM-INF')) {
            const resolutionMatch = line.match(/RESOLUTION=([\dx]+)/);
            const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
            if (resolutionMatch) {
              currentQuality = resolutionMatch[1];
            } else if (bandwidthMatch) {
              const bw = parseInt(bandwidthMatch[1]);
              if (bw >= 4000000) currentQuality = '1080p';
              else if (bw >= 2000000) currentQuality = '720p';
              else if (bw >= 800000) currentQuality = '480p';
              else currentQuality = '360p';
            }
          } else if (currentQuality && line && !line.startsWith('#')) {
            let variantUrl = line;
            if (!variantUrl.startsWith('http')) {
              const base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
              variantUrl = base + variantUrl;
            }
            variants.push({ quality: currentQuality, url: variantUrl });
            currentQuality = null;
          }
        }
        if (variants.length === 0) {
          resolve([{ quality: 'Auto', url: masterUrl }]);
        } else {
          resolve(variants);
        }
      })
      .catch(err => {
        console.error('[animotvslash] Failed to fetch master playlist:', err);
        resolve([{ quality: 'Auto', url: masterUrl }]);
      });
  });
}

// ------------------------------------------------------------------
// Original dynamic extraction helpers (unchanged)
// ------------------------------------------------------------------
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

function getAllPlayerUrls(html, baseUrl) {
  const urls = new Set();
  const iframeRe = /<iframe[^>]+src=["']([^"']*?\/jw-player\/[^"']+)["']/gi;
  let match;
  while ((match = iframeRe.exec(html)) !== null) {
    if (match[1]) urls.add(match[1]);
  }
  const dataRe = /data-(?:src|url)=["']([^"']*?\/jw-player\/[^"']+)["']/gi;
  while ((match = dataRe.exec(html)) !== null) {
    if (match[1]) urls.add(match[1]);
  }
  const tokenRe = /(eyJ[a-zA-Z0-9+/=]+)['"]/g;
  while ((match = tokenRe.exec(html)) !== null) {
    const token = match[1];
    if (token.length > 20 && token.startsWith('eyJ')) {
      urls.add(`https://animotvslash.org/jw-player/${token}/`);
    }
  }
  const absolute = new Set();
  for (let url of urls) {
    if (url.startsWith('http')) absolute.add(url);
    else absolute.add(baseUrl.replace(/\/$/, '') + '/' + url.replace(/^\//, ''));
  }
  return Array.from(absolute);
}

function getPostId(html) {
  let match = html.match(/<link rel="shortlink" href="[^"]*\?p=(\d+)"/);
  if (match) return match[1];
  match = html.match(/"post_id":"(\d+)"/);
  if (match) return match[1];
  match = html.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/);
  if (match) return match[1];
  return null;
}

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

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function fetchTitleFromTMDB(tmdbId, mediaType) {
  const url = mediaType === 'tv'
    ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`
    : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
  return fetch(url)
    .then(res => res.json())
    .then(data => mediaType === 'tv' ? (data.name || data.original_name) : (data.title || data.original_title))
    .catch(() => null);
}

// ------------------------------------------------------------------
// Main exported function
// ------------------------------------------------------------------
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return new Promise((resolve) => {
    console.log(`[animotvslash] === START for ${mediaType} ID:${tmdbId} S${seasonNum}E${episodeNum} ===`);

    // Step 1: Build episode key for manual mapping
    let baseSlug = null;
    let episodeKey = null;

    // First try to get slug from TMDB (needed for the key)
    fetchTitleFromTMDB(tmdbId, mediaType)
      .then(title => {
        if (!title) {
          console.log('[animotvslash] TMDB title not found, aborting');
          resolve([]);
          return;
        }
        console.log(`[animotvslash] TMDB title: "${title}"`);
        baseSlug = slugify(title);
        if (SLUG_OVERRIDES[tmdbId]) {
          baseSlug = SLUG_OVERRIDES[tmdbId];
          console.log(`[animotvslash] using override slug: ${baseSlug}`);
        }
        if (mediaType === 'tv' && seasonNum > 1) {
          baseSlug = `${baseSlug}-${seasonNum}`;
        }
        episodeKey = `${baseSlug}-episode-${episodeNum}`;

        // Check manual mapping first
        if (VIDEO_MAP[episodeKey]) {
          console.log(`[animotvslash] Using manual mapping for ${episodeKey}`);
          const masterUrl = VIDEO_MAP[episodeKey];
          return fetchQualities(masterUrl).then(variants => {
            const streams = variants.map(v => ({
              name: `ANIMOTVSLASH - ${v.quality}`,
              title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
              url: v.url,
              quality: v.quality,
              size: 'Unknown',
              headers: VIDEO_HEADERS,
              subtitles: [],
              provider: 'animotvslash',
            }));
            resolve(streams);
          });
        } else {
          // Proceed with dynamic extraction
          let pageUrl;
          if (mediaType === 'tv') {
            pageUrl = `https://animotvslash.org/${baseSlug}-episode-${episodeNum}/`;
          } else {
            pageUrl = `https://animotvslash.org/${baseSlug}/`;
          }
          console.log(`[animotvslash] constructed URL: ${pageUrl}`);
          return fetch(pageUrl, { headers: HEADERS })
            .then(res => {
              console.log(`[animotvslash] HTTP response: ${res.status}`);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.text();
            })
            .then(html => {
              const playerUrls = getAllPlayerUrls(html, pageUrl);
              const postId = getPostId(html);
              console.log(`[animotvslash] found ${playerUrls.length} player URLs:`, playerUrls);
              console.log(`[animotvslash] post ID: ${postId || 'not found'}`);
              const streams = [];
              const seen = new Set();

              function addStreamFromPlayerUrl(pUrl, serverHint) {
                const videoUrl = decodeJwPlayerUrl(pUrl);
                if (videoUrl) {
                  console.log(`[animotvslash] decoded video URL: ${videoUrl}`);
                  if (!seen.has(videoUrl)) {
                    seen.add(videoUrl);
                    let serverName = serverHint;
                    if (!serverName) {
                      if (pUrl.toLowerCase().includes('hard')) serverName = 'HARDSUB';
                      else if (pUrl.toLowerCase().includes('soft')) serverName = 'SOFTSUB';
                      else serverName = `Server${streams.length + 1}`;
                    }
                    streams.push({
                      name: `ANIMOTVSLASH - ${serverName} (HD)`,
                      title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
                      url: videoUrl,
                      quality: 'HD',
                      size: 'Unknown',
                      headers: VIDEO_HEADERS,
                      subtitles: [],
                      provider: 'animotvslash'
                    });
                  }
                } else {
                  console.log(`[animotvslash] failed to decode player URL: ${pUrl}`);
                }
              }

              for (let pUrl of playerUrls) {
                addStreamFromPlayerUrl(pUrl, null);
              }

              if (streams.length < 2 && postId) {
                console.log('[animotvslash] only one stream, trying AJAX fallback');
                return fetchAdditionalPlayerUrl(postId).then(extraPlayerUrl => {
                  if (extraPlayerUrl) {
                    console.log(`[animotvslash] AJAX fallback returned player URL: ${extraPlayerUrl}`);
                    addStreamFromPlayerUrl(extraPlayerUrl, 'SOFTSUB');
                  } else {
                    console.log('[animotvslash] AJAX fallback returned nothing');
                  }
                  return streams;
                });
              }
              return streams;
            })
            .then(streams => {
              console.log(`[animotvslash] returning ${streams.length} stream(s)`);
              resolve(streams);
            });
        }
      })
      .catch(err => {
        console.error('[animotvslash] error:', err.message);
        resolve([]);
      });
  });
}

module.exports = { getStreams };
