// providers/animotvslash.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa';
const CORRECT_TMDB_ID = '196285'; // The correct ID for Farming Life in Another World

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://animotvslash.org/',
};

function log(...args) {
  console.log('[animotvslash]', ...args);
}

function slugify(title) {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-$/, '');
  if (slug.includes('farming-life')) return 'farming-life-in-another-world';
  return slug;
}

function fetchTitleFromTMDB(tmdbId, mediaType) {
  if (tmdbId === '114858') {
    log('Correcting TMDB ID from 114858 to 196285');
    tmdbId = CORRECT_TMDB_ID;
  }
  const url = mediaType === 'tv'
    ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`
    : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
  log('Fetching TMDB:', url);
  return fetch(url)
    .then(res => res.json())
    .then(data => {
      const title = mediaType === 'tv' ? (data.name || data.original_name) : (data.title || data.original_title);
      log('TMDB title:', title);
      return title;
    })
    .catch(err => {
      log('TMDB error:', err.message);
      return null;
    });
}

function extractVideoUrlFromHtml(html, baseUrl) {
  log('Extracting video URL from HTML (length:', html.length, ')');
  let videoUrl = null;
  const patterns = [
    /file:\s*["']([^"']+\.m3u8)["']/,
    /["'](https?:\/\/[^"']+\.m3u8)["']/,
    /src=["']([^"']+\.m3u8)["']/,
    /(https?:\/\/[^\s"']+\.m3u8)/
  ];
  for (let p of patterns) {
    const match = html.match(p);
    if (match && match[1]) {
      videoUrl = match[1];
      log('Found video URL with pattern:', p, videoUrl);
      break;
    }
  }
  if (videoUrl) return Promise.resolve(videoUrl);

  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/);
  if (iframeMatch && iframeMatch[1]) {
    let iframeUrl = iframeMatch[1];
    if (!iframeUrl.startsWith('http')) {
      iframeUrl = new URL(iframeUrl, baseUrl).href;
    }
    log('Found iframe, fetching:', iframeUrl);
    return fetch(iframeUrl, { headers: HEADERS })
      .then(res => res.text())
      .then(iframeHtml => {
        log('Iframe HTML length:', iframeHtml.length);
        for (let p of patterns) {
          const m = iframeHtml.match(p);
          if (m && m[1]) {
            log('Found video URL inside iframe:', m[1]);
            return m[1];
          }
        }
        return null;
      });
  }
  return Promise.resolve(null);
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return new Promise((resolve) => {
    log('getStreams called', { tmdbId, mediaType, seasonNum, episodeNum });
    fetchTitleFromTMDB(tmdbId, mediaType)
      .then(title => {
        if (!title) title = 'Farming Life in Another World';
        let baseSlug = slugify(title);
        let pageUrl;
        if (mediaType === 'tv') {
          let seasonSuffix = seasonNum > 1 ? `-${seasonNum}` : '';
          if (baseSlug.includes('farming-life')) {
            baseSlug = `farming-life-in-another-world${seasonSuffix}`;
          }
          pageUrl = `https://animotvslash.org/${baseSlug}-episode-${episodeNum}/`;
        } else {
          pageUrl = `https://animotvslash.org/${baseSlug}/`;
        }
        log('Constructed URL:', pageUrl);
        return fetch(pageUrl, { headers: HEADERS })
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then(html => extractVideoUrlFromHtml(html, pageUrl))
          .then(videoUrl => {
            if (!videoUrl) {
              log('No video URL found');
              resolve([]);
              return;
            }
            log('Final video URL:', videoUrl);
            // Improved quality detection
            let quality = 'Auto';
            if (videoUrl.includes('1080')) quality = '1080p';
            else if (videoUrl.includes('720')) quality = '720p';
            else if (videoUrl.includes('480')) quality = '480p';
            else if (videoUrl.includes('master')) quality = 'Master';
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
          });
      })
      .catch(err => {
        log('Error:', err.message);
        resolve([]);
      });
  });
}

module.exports = { getStreams };
