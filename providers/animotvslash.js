// providers/animotvslash.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa';

// ------------------------------------------------------------------
// ONE PIECE SEASON OFFSETS – mapping season number → starting absolute episode
// Add or update entries here when new seasons are released.
// ------------------------------------------------------------------
const ONE_PIECE_SEASON_OFFSET = {
  1: 1,
  2: 62,
  3: 93,
  4: 131,
  5: 159,
  6: 196,
  7: 207,
  8: 230,
  9: 264,
  10: 279,
  11: 293,
  12: 303,
  13: 317,
  14: 337,
  15: 354,
  16: 382,
  17: 391,
  18: 409,
  19: 419,
  20: 430,
  21: 446,
  22: 460,
  23: 1157,  // Season 23 starts at absolute episode 1157
  // Add future seasons here as needed
};

// ------------------------------------------------------------------
// MANUAL VIDEO MAPPING – fallback for episodes that still fail
// ------------------------------------------------------------------
const VIDEO_MAP = {
  // Example: "one-piece-episode-1161": "https://rumble.com/hls-vod/77h4iq/playlist.m3u8",
};

// ------------------------------------------------------------------
// SLUG OVERRIDES – for anime where the TMDB title doesn't match the slug
// ------------------------------------------------------------------
const SLUG_OVERRIDES = {};

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
// Helper functions
// ------------------------------------------------------------------
async function fetchHTMLWithRedirect(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    const finalUrl = res.url;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return { html, finalUrl };
  } catch (err) {
    console.error(`[animotvslash] fetch error ${url}:`, err.message);
    return { html: null, finalUrl: url };
  }
}

async function fetchHTML(url) {
  const { html } = await fetchHTMLWithRedirect(url);
  return html;
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

function slugify(title) {
  return title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getAllPlayerUrls(html, baseUrl) {
  const $ = cheerio.load(html);
  const urls = new Set();

  $('iframe').each((i, el) => {
    let src = $(el).attr('src');
    if (src) urls.add(src);
  });

  $('source').each((i, el) => {
    let src = $(el).attr('src');
    if (src) urls.add(src);
  });

  $('[data-src], [data-url], [data-video]').each((i, el) => {
    let src = $(el).attr('data-src') || $(el).attr('data-url') || $(el).attr('data-video');
    if (src) urls.add(src);
  });

  $('script').each((i, el) => {
    const script = $(el).html();
    if (!script) return;
    let match = script.match(/["'](?:file|source)["']\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
    if (match) urls.add(match[1]);
    match = script.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/gi);
    if (match) match.forEach(u => urls.add(u));
  });

  const directMatches = html.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/gi);
  if (directMatches) directMatches.forEach(u => urls.add(u));

  const absolute = new Set();
  for (let url of urls) {
    if (url.startsWith('http')) absolute.add(url);
    else if (url.startsWith('/')) absolute.add(baseUrl.replace(/\/$/, '') + url);
    else if (url.startsWith('//')) absolute.add('https:' + url);
  }
  return Array.from(absolute);
}

async function getPostId(pageHtml, slug) {
  let match = pageHtml.match(/<link rel="shortlink" href="[^"]*\?p=(\d+)"/);
  if (match) return match[1];
  match = pageHtml.match(/"post_id":"(\d+)"/);
  if (match) return match[1];
  match = pageHtml.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/);
  if (match) return match[1];

  const apiUrl = `https://animotvslash.org/wp-json/wp/v2/posts?slug=${slug}`;
  const data = await fetchJSON(apiUrl);
  if (data && data.length > 0) return data[0].id;
  return null;
}

async function fetchDooplayerUrl(postId, mediaType, episode) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const apiUrl = `https://animotvslash.org/wp-json/dooplayer/v2/${postId}/${type}/${episode}`;
  const data = await fetchJSON(apiUrl);
  if (data && data.embed_url) return data.embed_url;
  if (data && data.source) return data.source;
  return null;
}

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
  console.log(`[animotvslash] === START for ${mediaType} TMDB ID:${tmdbId} S${seasonNum}E${episodeNum} ===`);

  // ------------------------------------------------------------------
  // SPECIAL CASE: One Piece (TMDB ID 37854)
  // Convert season/episode → absolute episode number using the mapping table.
  // ------------------------------------------------------------------
  if (Number(tmdbId) === 37854) {
    if (ONE_PIECE_SEASON_OFFSET[seasonNum] !== undefined) {
      const absoluteEpisode = ONE_PIECE_SEASON_OFFSET[seasonNum] + (episodeNum - 1);
      const absoluteUrl = `https://animotvslash.org/one-piece-episode-${absoluteEpisode}/`;
      console.log(`[animotvslash] One Piece: S${seasonNum}E${episodeNum} → absolute episode ${absoluteEpisode} → ${absoluteUrl}`);

      // Fetch the absolute episode page using the same extraction logic as normal episodes
      const { html, finalUrl } = await fetchHTMLWithRedirect(absoluteUrl);
      if (html) {
        // Check for P2P redirect
        if (finalUrl && (finalUrl.includes('p2pplay.pro') || finalUrl.includes('.p2pplay.pro'))) {
          console.log(`[animotvslash] Redirected to P2P domain: ${finalUrl}`);
          return [{
            name: `ANIMOTVSLASH - P2P Stream (Open in Browser)`,
            title: `Episode ${absoluteEpisode}`,
            url: finalUrl,
            quality: 'Auto',
            headers: VIDEO_HEADERS,
            provider: 'animotvslash',
            behaviorHints: { notWebReady: true }
          }];
        }

        let playerUrls = getAllPlayerUrls(html, absoluteUrl);
        console.log(`[animotvslash] Found ${playerUrls.length} URLs from HTML for One Piece episode ${absoluteEpisode}`);

        if (playerUrls.length === 0) {
          const postId = await getPostId(html, 'one-piece');
          if (postId) {
            console.log(`[animotvslash] Post ID: ${postId}, trying Dooplayer API`);
            const apiUrl = await fetchDooplayerUrl(postId, mediaType, absoluteEpisode);
            if (apiUrl) {
              console.log(`[animotvslash] Dooplayer API returned: ${apiUrl}`);
              playerUrls.push(apiUrl);
            }
          }
        }

        const streams = [];
        const seen = new Set();
        for (let url of playerUrls) {
          if (seen.has(url)) continue;
          seen.add(url);
          const videoUrl = decodeJwPlayerUrl(url);
          streams.push({
            name: `ANIMOTVSLASH - Stream ${streams.length + 1}`,
            title: `Episode ${absoluteEpisode}`,
            url: videoUrl,
            quality: 'Auto',
            headers: VIDEO_HEADERS,
            provider: 'animotvslash'
          });
        }
        console.log(`[animotvslash] Returning ${streams.length} stream(s) for One Piece`);
        return streams;
      } else {
        console.log(`[animotvslash] Failed to fetch One Piece absolute episode page (${absoluteUrl}) – falling back to normal logic`);
      }
    } else {
      console.log(`[animotvslash] One Piece season ${seasonNum} not mapped; falling back to normal logic`);
    }
  }

  // ------------------------------------------------------------------
  // NORMAL EXTRACTION FOR ALL OTHER ANIME (including One Piece fallback)
  // ------------------------------------------------------------------
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
      baseSlug = `${baseSlug}-season-${seasonNum}`;
    }
    const episodeKey = `${baseSlug}-episode-${episodeNum}`;

    if (VIDEO_MAP[episodeKey]) {
      console.log(`[animotvslash] Using manual mapping for ${episodeKey}`);
      return [{
        name: `ANIMOTVSLASH - Manual`,
        title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
        url: VIDEO_MAP[episodeKey],
        quality: 'Auto',
        headers: VIDEO_HEADERS,
        provider: 'animotvslash',
        behaviorHints: { notWebReady: !VIDEO_MAP[episodeKey].match(/\.(mp4|m3u8)$/i) }
      }];
    }

    let pageUrl;
    if (mediaType === 'tv') {
      pageUrl = `https://animotvslash.org/${baseSlug}-episode-${episodeNum}/`;
    } else {
      pageUrl = `https://animotvslash.org/${baseSlug}/`;
    }
    console.log(`[animotvslash] Fetching page: ${pageUrl}`);

    const { html, finalUrl } = await fetchHTMLWithRedirect(pageUrl);
    if (!html) {
      console.log('[animotvslash] Failed to fetch page');
      return [];
    }

    if (finalUrl && (finalUrl.includes('p2pplay.pro') || finalUrl.includes('.p2pplay.pro'))) {
      console.log(`[animotvslash] Redirected to P2P domain: ${finalUrl}`);
      return [{
        name: `ANIMOTVSLASH - P2P Stream (Open in Browser)`,
        title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
        url: finalUrl,
        quality: 'Auto',
        headers: VIDEO_HEADERS,
        provider: 'animotvslash',
        behaviorHints: { notWebReady: true }
      }];
    }

    let playerUrls = getAllPlayerUrls(html, pageUrl);
    console.log(`[animotvslash] Found ${playerUrls.length} URLs from HTML`);

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

    const streams = [];
    const seen = new Set();
    for (let url of playerUrls) {
      if (seen.has(url)) continue;
      seen.add(url);
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
