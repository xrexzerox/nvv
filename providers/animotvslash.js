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

function extractVideoUrlFromHtml(html, baseUrl) {
  // Patterns to find .m3u8 URL
  const patterns = [
    /file:\s*["']([^"']+\.m3u8)["']/,
    /["'](https?:\/\/[^"']+\.m3u8)["']/,
    /src=["']([^"']+\.m3u8)["']/,
    /(https?:\/\/[^\s"']+\.m3u8)/
  ];
  for (let p of patterns) {
    const match = html.match(p);
    if (match && match[1]) return match[1];
  }

  // If not found, look for an iframe and fetch it
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

        fetch(pageUrl, { headers: HEADERS })
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then(html => extractVideoUrlFromHtml(html, pageUrl))
          .then(videoUrl => {
            if (!videoUrl) {
              resolve([]);
              return;
            }

            // Detect quality from URL
            let quality = 'HD';
            if (videoUrl.includes('1080')) quality = '1080p';
            else if (videoUrl.includes('720')) quality = '720p';
            else if (videoUrl.includes('480')) quality = '480p';
            else if (videoUrl.match(/\d{3,4}p/)) quality = videoUrl.match(/\d{3,4}p/)[0];

            const stream = {
              name: `ANIMOTVSLASH - ${quality}`,
              title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
              url: videoUrl,
              quality: quality,
              size: 'Unknown',
              headers: HEADERS,
              subtitles: [],
              provider: 'animotvslash'
            };
            resolve([stream]);
          })
          .catch(() => resolve([]));
      })
      .catch(() => resolve([]));
  });
}

module.exports = { getStreams };
