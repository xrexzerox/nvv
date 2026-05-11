// providers/animotvslash.js
const cheerio = require('cheerio-without-node-native');

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://animotvslash.org/',
  'DNT': '1',
};

const VIDEO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://animotvslash.org/',
  'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
};

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Fetch the title from TMDB – you must replace 'YOUR_API_KEY'
function fetchTitleFromTMDB(tmdbId, mediaType) {
  const apiKey = '6dc830f9624b43261325bed3bf7d0dfa'; // <-- REPLACE WITH YOUR REAL KEY
  const url = mediaType === 'tv'
    ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}`
    : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}`;

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

// Extract the .m3u8 URL from a page (episode or iframe)
function extractVideoUrlFromHtml(html, baseUrl) {
  let videoUrl = null;
  // Look for file: "..." or direct m3u8 link
  const patterns = [
    /file:\s*["']([^"']+\.m3u8)["']/,
    /["'](https?:\/\/[^"']+\.m3u8)["']/,
  ];
  for (let p of patterns) {
    const match = html.match(p);
    if (match && match[1]) {
      videoUrl = match[1];
      break;
    }
  }
  if (videoUrl) return videoUrl;

  // If not found, look for an iframe and fetch it
  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/);
  if (iframeMatch && iframeMatch[1]) {
    let iframeUrl = iframeMatch[1];
    if (!iframeUrl.startsWith('http')) {
      iframeUrl = new URL(iframeUrl, baseUrl).href;
    }
    return fetch(iframeUrl, { headers: REQUEST_HEADERS })
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
    // For now, if no TMDB key or lookup fails, fallback to a known slug.
    // You can also skip TMDB entirely and use a hardcoded slug for testing.
    let titlePromise;
    if (tmdbId && tmdbId !== '0') {
      titlePromise = fetchTitleFromTMDB(tmdbId, mediaType);
    } else {
      titlePromise = Promise.resolve('Farming Life in Another World 2');
    }

    titlePromise
      .then(title => {
        if (!title) title = 'Farming Life in Another World 2';
        let baseSlug = slugify(title);
        let episodeUrl;
        if (mediaType === 'tv') {
          if (seasonNum > 1) baseSlug = `${baseSlug}-${seasonNum}`;
          episodeUrl = `https://animotvslash.org/${baseSlug}-episode-${episodeNum}/`;
        } else {
          episodeUrl = `https://animotvslash.org/${baseSlug}/`;
        }
        console.log(`[animotvslash] Fetching ${episodeUrl}`);

        return fetch(episodeUrl, { headers: REQUEST_HEADERS })
          .then(res => res.text())
          .then(html => extractVideoUrlFromHtml(html, episodeUrl))
          .then(videoUrl => {
            if (!videoUrl) {
              console.log('[animotvslash] Video URL not found');
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
        console.error('[animotvslash] Error:', err);
        resolve([]);
      });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
