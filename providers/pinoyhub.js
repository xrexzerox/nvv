// providers/pinoyhub.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const BASE_URL = 'https://pinoymovieshub.win';
const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa'; // reuse your key

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
// Helper: fetch HTML with timeout and redirects
// ------------------------------------------------------------------
async function fetchHTML(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    console.error(`[pinoyhub] fetch error ${url}:`, err.message);
    return null;
  }
}

// ------------------------------------------------------------------
// Follow internal /links/... redirect to external URL
// ------------------------------------------------------------------
async function resolveInternalLink(linkUrl) {
  console.log(`[pinoyhub] Following internal link: ${linkUrl}`);
  // First, try to fetch with redirects – the server might 302 to external host
  try {
    const res = await fetch(linkUrl, { headers: HEADERS, redirect: 'follow' });
    const finalUrl = res.url;
    if (finalUrl !== linkUrl && !finalUrl.includes('pinoymovieshub.win')) {
      console.log(`[pinoyhub] Redirected to: ${finalUrl}`);
      return finalUrl;
    }
  } catch (err) {
    // fall through to HTML parsing
  }

  const html = await fetchHTML(linkUrl);
  if (!html) return null;

  const $ = cheerio.load(html);
  const currentDomain = new URL(linkUrl).hostname;

  // 1) iframe (MixDrop, Dood, etc.)
  const iframe = $('.download-top iframe, iframe[src*="/e/"]').first();
  if (iframe.length && iframe.attr('src')) {
    let src = iframe.attr('src');
    if (src.startsWith('/')) src = `https://${currentDomain}${src}`;
    return src;
  }

  // 2) Byse / React: look for JSON in script tags
  let videoUrl = null;
  $('script').each((i, el) => {
    const scriptContent = $(el).html();
    if (!scriptContent) return;
    // Look for "source":"url"
    const sourceMatch = scriptContent.match(/"source"\s*:\s*"([^"]+)"/);
    if (sourceMatch) {
      videoUrl = sourceMatch[1].replace(/\\\//g, '/');
      if (videoUrl.startsWith('/')) videoUrl = `https://${currentDomain}${videoUrl}`;
      return false; // break
    }
    // Look for "url":"...mp4"
    const urlMatch = scriptContent.match(/"url"\s*:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/);
    if (urlMatch) {
      videoUrl = urlMatch[1];
      return false;
    }
    // Raw video URL in script
    const rawMatch = scriptContent.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/i);
    if (rawMatch) {
      videoUrl = rawMatch[1];
      return false;
    }
  });
  if (videoUrl) return videoUrl;

  // 3) ?download button
  const downloadBtn = $('a[href="?download"], a.download-btn').first();
  if (downloadBtn.length && downloadBtn.attr('href') === '?download') {
    const fullUrl = linkUrl + '?download';
    try {
      const res = await fetch(fullUrl, { headers: HEADERS, redirect: 'follow' });
      if (res.ok && res.headers.get('content-type')?.includes('video')) {
        return res.url;
      }
    } catch (err) {}
  }

  // 4) Meta refresh
  const meta = $('meta[http-equiv="refresh"]');
  if (meta.length) {
    const content = meta.attr('content');
    const match = content.match(/url=(.+)/);
    if (match) return match[1];
  }

  // 5) Any external link to known hosts
  const knownHosts = ['mixdrop', 'playmogo', 'dood', 'byse', 'bysesayeveum'];
  let external = null;
  $('a[href]').each((i, el) => {
    const href = $(el).attr('href');
    if (href && knownHosts.some(host => href.includes(host)) && (href.startsWith('http') || href.startsWith('//'))) {
      external = href.startsWith('//') ? 'https:' + href : href;
      return false;
    }
  });
  return external;
}

// ------------------------------------------------------------------
// Resolve external host (MixDrop, Byse, etc.) to direct video URL
// ------------------------------------------------------------------
async function resolveExternalHost(externalUrl) {
  if (!externalUrl) return null;
  if (!externalUrl.startsWith('http')) externalUrl = 'https://' + externalUrl;
  console.log(`[pinoyhub] Resolving external host: ${externalUrl}`);

  // If it's already a direct video URL, return it
  if (/\.(m3u8|mp4)(\?|$)/i.test(externalUrl)) return externalUrl;

  const html = await fetchHTML(externalUrl);
  if (!html) return null;

  const $ = cheerio.load(html);
  const currentDomain = new URL(externalUrl).hostname;

  // Follow iframe again
  const iframe = $('iframe[src*="/e/"], iframe[src*="/dl/"]').first();
  if (iframe.length && iframe.attr('src')) {
    let src = iframe.attr('src');
    if (src.startsWith('/')) src = `https://${currentDomain}${src}`;
    return resolveExternalHost(src); // recurse
  }

  // Doodstream / MixDrop token+expiry
  const htmlStr = html;
  const tokenMatch = htmlStr.match(/token\s*[:=]\s*["']([^"']+)["']/);
  const expiryMatch = htmlStr.match(/expiry\s*[:=]\s*["']([^"']+)["']/);
  if (tokenMatch && expiryMatch) {
    const videoId = externalUrl.split('/').pop();
    const domain = externalUrl.split('/')[2];
    const direct = `https://${domain}/dl/${videoId}?token=${tokenMatch[1]}&expiry=${expiryMatch[1]}`;
    // verify (optional, can skip for speed)
    return direct;
  }

  // file: or source:
  const fileMatch = htmlStr.match(/file:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/);
  if (fileMatch) return fileMatch[1];
  const sourceMatch = htmlStr.match(/"source":"([^"]+)"/);
  if (sourceMatch) return sourceMatch[1].replace(/\\\//g, '/');
  const rawMatch = htmlStr.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/i);
  if (rawMatch) return rawMatch[1];

  // fallback: return the external URL itself (might be an embed page)
  return externalUrl;
}

// ------------------------------------------------------------------
// Extract download links from the HTML page (movie or episode)
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
    links.push({ url, quality, language });
  });
  return links;
}

// ------------------------------------------------------------------
// Get series slug from TMDB ID (for TV episodes)
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
// Main exported function (same interface as other providers)
// ------------------------------------------------------------------
async function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[pinoyhub] Request: ${mediaType} ID:${tmdbId} S${season}E${episode}`);

  try {
    let pageUrl;
    let contextTitle = '';

    if (mediaType === 'movie') {
      // For movies, tmdbId is actually the slug (e.g., "scissors")
      pageUrl = `${BASE_URL}/movies/${tmdbId}/`;
      contextTitle = `Movie: ${tmdbId}`;
    } else {
      // For TV, we need the series slug from TMDB
      const seriesSlug = await getSeriesSlug(tmdbId);
      if (!seriesSlug) throw new Error('Cannot derive series slug from TMDB');
      pageUrl = `${BASE_URL}/episodes/${seriesSlug}-${season}x${episode}/`;
      contextTitle = `${seriesSlug} S${season}E${episode}`;
    }

    console.log(`[pinoyhub] Fetching page: ${pageUrl}`);
    const html = await fetchHTML(pageUrl);
    if (!html) {
      console.error('[pinoyhub] Failed to fetch page');
      return [];
    }

    const links = extractDownloadLinks(html, contextTitle, season, episode);
    if (links.length === 0) {
      console.log('[pinoyhub] No download links found on page');
      return [];
    }

    const streams = [];
    for (const link of links) {
      // Skip subtitle only links (English language or quality "Subtitle")
      if (link.quality.toLowerCase() === 'subtitle' || link.language.toLowerCase() === 'english') {
        console.log(`[pinoyhub] Skipping subtitle link: ${link.quality} / ${link.language}`);
        continue;
      }

      console.log(`[pinoyhub] Processing ${link.quality} / ${link.language}: ${link.url}`);
      const external = await resolveInternalLink(link.url);
      if (!external) {
        console.log(`[pinoyhub] Failed to resolve internal link, skipping`);
        continue;
      }
      const direct = await resolveExternalHost(external);
      const finalUrl = direct || external; // fallback to external if resolution failed

      streams.push({
        name: `PinoyHub - ${link.quality} ${link.language}`,
        title: contextTitle,
        url: finalUrl,
        quality: link.quality,
        headers: VIDEO_HEADERS,
        provider: 'pinoyhub'
      });
    }

    console.log(`[pinoyhub] Returning ${streams.length} stream(s)`);
    return streams;
  } catch (err) {
    console.error('[pinoyhub] Error:', err.message);
    return [];
  }
}

module.exports = { getStreams };
