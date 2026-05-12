// providers/pinoyhub.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const BASE_URL = 'https://pinoymovieshub.win';
const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa'; // you can reuse your key

// Headers (cookie may need refreshing)
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': BASE_URL,
  'Cookie': 'starstruck_7da72d90b632af60dd1158c068193d61=99f22538d0588cdd7ccfc783299f88a7' // update if expired
};

const VIDEO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': BASE_URL
};

// ------------------------------------------------------------------
// Helper: fetch HTML
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
// Follow internal /links/... redirect
// ------------------------------------------------------------------
async function resolveInternalLink(linkUrl) {
  const html = await fetchHTML(linkUrl);
  if (!html) return null;
  const $ = cheerio.load(html);

  // meta refresh
  const meta = $('meta[http-equiv="refresh"]');
  if (meta.length) {
    const content = meta.attr('content');
    const match = content.match(/url=(.+)/);
    if (match) return match[1];
  }

  // download button
  const btn = $('a.download-btn, a.button, a[target="_blank"]').first();
  if (btn.length && btn.attr('href')) return btn.attr('href');

  // javascript redirect
  const jsMatch = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
  if (jsMatch) return jsMatch[1];

  // any external link
  const extLink = $('a[href]').filter((i, el) => {
    const href = $(el).attr('href');
    return href && !href.includes('pinoymovieshub.win') && (href.startsWith('http') || href.startsWith('//'));
  }).first();
  if (extLink.length) return extLink.attr('href');

  return null;
}

// ------------------------------------------------------------------
// Extract direct video URL from external host (mixdrop, playmogo, etc.)
// ------------------------------------------------------------------
async function resolveExternalHost(externalUrl) {
  const html = await fetchHTML(externalUrl);
  if (!html) return null;

  // 1) Playmogo / Doodstream pattern (token + expiry)
  const tokenMatch = html.match(/token\s*[:=]\s*['"]([^'"]+)['"]/);
  const expiryMatch = html.match(/expiry\s*[:=]\s*['"]([^'"]+)['"]/);
  if (tokenMatch && expiryMatch) {
    const videoId = externalUrl.split('/').pop();
    const domain = externalUrl.split('/')[2];
    const direct = `https://${domain}/dl/${videoId}?token=${tokenMatch[1]}&expiry=${expiryMatch[1]}`;
    // verify
    const head = await fetch(direct, { method: 'HEAD', headers: VIDEO_HEADERS });
    if (head.ok && head.headers.get('content-type')?.includes('video')) return direct;
  }

  // 2) file: "url"
  const fileMatch = html.match(/file:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/);
  if (fileMatch) return fileMatch[1];

  // 3) "source": "url"
  const sourceMatch = html.match(/"source":"([^"]+)"/);
  if (sourceMatch) return sourceMatch[1].replace(/\\\//g, '/');

  // 4) raw m3u8/mp4 URL
  const urlMatch = html.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/i);
  if (urlMatch) return urlMatch[1];

  return null;
}

// ------------------------------------------------------------------
// Extract download links from the HTML page
// ------------------------------------------------------------------
function extractDownloadLinks(html, title, season, episode) {
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
    if (url && !url.startsWith('http')) url = BASE_URL + url;
    const quality = $(cols[1]).find('strong.quality').text().trim() || 'Unknown';
    const language = $(cols[2]).text().trim();
    links.push({
      url,
      quality,
      language,
      title: season ? `${title} S${season}E${episode}` : title
    });
  });
  return links;
}

// ------------------------------------------------------------------
// Get series slug from TMDB title (with optional override)
// ------------------------------------------------------------------
function slugify(title) {
  return title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function getSeriesSlug(tmdbId) {
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const title = data.name || data.original_name;
  return slugify(title);
}

// ------------------------------------------------------------------
// Main exported function
// ------------------------------------------------------------------
async function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[pinoyhub] Request: ${mediaType} ID:${tmdbId} S${season}E${episode}`);

  try {
    let pageUrl;

    if (mediaType === 'movie') {
      // For movies, tmdbId should be the slug (e.g., "scissors")
      pageUrl = `${BASE_URL}/movies/${tmdbId}/`;
    } else {
      // For TV, we need the series slug from TMDB
      const seriesSlug = await getSeriesSlug(tmdbId);
      if (!seriesSlug) throw new Error('Cannot derive series slug');
      pageUrl = `${BASE_URL}/episodes/${seriesSlug}-${season}x${episode}/`;
    }

    console.log(`[pinoyhub] Fetching ${pageUrl}`);
    const html = await fetchHTML(pageUrl);
    if (!html) return [];

    const links = extractDownloadLinks(html, mediaType === 'movie' ? `Movie ${tmdbId}` : `Series ${tmdbId}`, season, episode);
    if (links.length === 0) return [];

    const streams = [];
    for (const link of links) {
      console.log(`[pinoyhub] Processing ${link.quality} / ${link.language} => ${link.url}`);
      const external = await resolveInternalLink(link.url);
      if (!external) continue;
      const direct = await resolveExternalHost(external) || external;
      streams.push({
        name: `PinoyHub - ${link.quality} ${link.language}`,
        title: link.title,
        url: direct,
        quality: link.quality,
        headers: VIDEO_HEADERS,
        provider: 'pinoyhub'
      });
    }
    return streams;
  } catch (err) {
    console.error('[pinoyhub] error:', err.message);
    return [];
  }
}

module.exports = { getStreams };
