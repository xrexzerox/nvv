// providers/animotvslash.js
const cheerio = require('cheerio-without-node-native');

const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa'; // your key

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
    .then(data => {
      if (mediaType === 'tv') return data.name || data.original_name;
      else return data.title || data.original_title;
    })
    .catch(err => {
      console.error('[animotvslash] TMDB error:', err);
      return null;
    });
}

function extractVideoUrlFromHtml(html, baseUrl) {
  let videoUrl = null;
  const patterns = [
    /file:\s*["']([^"']+\.m3u8)["']/,
    /["'](https?:\/\/[^"']+\.m3u8)["']/,
    /src=["']([^"']+\.m3u8)["']/
  ];
  for (let p of patterns) {
    const match = html.match(p);
    if (match && match[1]) {
      videoUrl = match[1];
      break;
    }
  }
  if (videoUrl) return Promise.resolve(videoUrl);

  // Look for iframe
  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/);
  if (iframeMatch && iframeMatch[1]) {
    let iframeUrl = iframeMatch[1];
    if (!iframeUrl.startsWith('http')) {
      iframeUrl = new URL(iframeUrl, baseUrl).href;
    }
    return fetch(iframeUrl, { headers: HEADERS })
      .then(res => res.text())
      .then(iframeHtml => {
        for (let p of patterns) {
          const m = iframeHtml.match(p);
          if (m && m[1]) return m[1];
        }
        return null;
      });
  }
  return Promise.resolve(null);
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return new Promise((resolve) => {
    // Step 1: get the title from TMDB
    fetchTitleFromTMDB(tmdbId, mediaType)
      .then(title => {
        if (!title) {
          console.error('[animotvslash] No title from TMDB');
          resolve([]);
          return;
        }
        let baseSlug = slugify(title);
        let pageUrl;
        if (mediaType === 'tv') {
          // For season 2+, the slug includes the season number (e.g., farming-life-in-another-world-2)
          if (seasonNum > 1) baseSlug = `${baseSlug}-${seasonNum}`;
          pageUrl = `https://animotvslash.org/${baseSlug}-episode-${episodeNum}/`;
        } else {
          pageUrl = `https://animotvslash.org/${baseSlug}/`;
        }
        console.log(`[animotvslash] Fetching ${pageUrl}`);
        return fetch(pageUrl, { headers: HEADERS })
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then(html => extractVideoUrlFromHtml(html, pageUrl))
          .then(videoUrl => {
            if (!videoUrl) {
              console.log('[animotvslash] No video URL found');
              resolve([]);
              return;
            }
            let quality = 'Unknown';
            if (videoUrl.includes('1080')) quality = '1080p';
            else if (videoUrl.includes('720')) quality = '720p';
            else if (videoUrl.includes('480')) quality = '480p';
            const stream = {
              name: `ANIMOTVSLASH - ${quality}`,
              title: mediaType === 'tv' ? `Episode ${episodeNum}` : 'Movie',
              url: videoUrl,
              quality: quality,
              size: 'Unknown',
              headers: VIDEO_HEADERS,
              subtitles: [],
              provider: 'animotvslash'
            };
            resolve([stream]);
          });
      })
      .catch(err => {
        console.error('[animotvslash] Unexpected error:', err);
        resolve([]);
      });
  });
}

module.exports = { getStreams };
