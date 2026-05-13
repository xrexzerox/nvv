// providers/vidrock.js
const crypto = require('crypto');
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const VIDROCK_BASE_URL = 'https://vidrock.net';
const PASSPHRASE = 'x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9'; // 32-byte key (AES-256)

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://vidrock.net/',
  'Origin': 'https://vidrock.net',
  'X-Requested-With': 'XMLHttpRequest',
  'DNT': '1'
};

const PLAYBACK_HEADERS = {
  'User-Agent': HEADERS['User-Agent'],
  'Referer': 'https://vidrock.net/',
  'Origin': 'https://vidrock.net'
};

// ------------------------------------------------------------------
// AES-256-CBC encryption (local, no external server)
// ------------------------------------------------------------------
function encryptAesCbc(text, passphrase) {
  // Derive a 32-byte key from the passphrase (SHA-256)
  const key = crypto.createHash('sha256').update(passphrase).digest();
  // Generate a random 16-byte IV
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  // Combine IV + encrypted data (IV is needed for decryption on the server)
  // Vidrock expects the IV prepended? The original remote server likely returned
  // a base64 string that includes the IV. We'll assume IV is separate.
  // Many implementations send IV as first 16 bytes of the base64 string.
  // Let's do: base64(iv) + ':' + base64(encrypted)
  const ivBase64 = iv.toString('base64');
  return ivBase64 + ':' + encrypted;
}

async function makeRequest(url, options = {}) {
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: { ...HEADERS, ...options.headers },
    ...options
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function getTMDBDetails(tmdbId, mediaType) {
  const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
  const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  const res = await makeRequest(url);
  const data = await res.json();
  const title = mediaType === 'tv' ? data.name : data.title;
  const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
  const year = releaseDate ? parseInt(releaseDate.split('-')[0]) : null;
  return { title, year, imdbId: data.external_ids?.imdb_id || null };
}

function extractQuality(url) {
  if (!url) return 'Unknown';
  const match = url.match(/(\d{3,4})p/i) || url.match(/(\d{3,4})x\d{3,4}/i);
  if (match) {
    const num = parseInt(match[1]);
    if (num >= 240 && num <= 2160) return `${num}p`;
  }
  if (url.includes('1080')) return '1080p';
  if (url.includes('720')) return '720p';
  if (url.includes('480')) return '480p';
  return 'Unknown';
}

function needsHeaders(serverName, url) {
  if (serverName === 'Astra') return true;
  if (serverName === 'Atlas' && url.includes('hls1.vdrk.site')) return true;
  if (serverName === 'Luna' && url.includes('cdn.niggaflix.xyz')) return true;
  if (url.includes('cdn.vidrock.store') || url.includes('proxy.vidrock.store')) return true;
  return false;
}

async function parseAstraPlaylist(playlistUrl, serverName, mediaInfo, seasonNum, episodeNum) {
  const res = await fetch(playlistUrl, { headers: PLAYBACK_HEADERS });
  const data = await res.json();
  const streams = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.url && item.resolution) {
        const quality = `${item.resolution}p`;
        let mediaTitle = mediaInfo.title;
        if (seasonNum && episodeNum) mediaTitle = `${mediaInfo.title} S${seasonNum}E${episodeNum}`;
        streams.push({
          name: `Vidrock ${serverName} - ${quality}`,
          title: mediaTitle,
          url: item.url,
          quality,
          headers: PLAYBACK_HEADERS,
          provider: 'vidrock'
        });
      }
    }
  }
  return streams;
}

async function processVidrockResponse(data, mediaInfo, seasonNum, episodeNum) {
  const streams = [];
  if (!data || typeof data !== 'object') return streams;

  const astraPromises = [];
  for (const [serverName, source] of Object.entries(data)) {
    if (!source?.url) continue;
    const videoUrl = source.url;
    if (serverName === 'Astra' && videoUrl.includes('cdn.vidrock.store/playlist/')) {
      astraPromises.push(parseAstraPlaylist(videoUrl, serverName, mediaInfo, seasonNum, episodeNum));
      continue;
    }
    let quality = extractQuality(videoUrl);
    if (source.type === 'hls' || videoUrl.includes('.m3u8')) quality = quality === 'Unknown' ? 'Adaptive' : quality;
    let langInfo = source.language ? ` [${source.language}]` : '';
    let mediaTitle = mediaInfo.title;
    if (seasonNum && episodeNum) mediaTitle = `${mediaInfo.title} S${seasonNum}E${episodeNum}`;
    const streamHeaders = needsHeaders(serverName, videoUrl) ? PLAYBACK_HEADERS : undefined;
    streams.push({
      name: `Vidrock ${serverName}${langInfo} - ${quality}`,
      title: mediaTitle,
      url: videoUrl,
      quality,
      headers: streamHeaders,
      provider: 'vidrock'
    });
  }
  if (astraPromises.length) {
    const astraStreams = await Promise.all(astraPromises);
    for (const astra of astraStreams) streams.push(...astra);
  }
  return streams;
}

async function fetchFromVidrock(mediaType, tmdbId, mediaInfo, seasonNum, episodeNum) {
  let itemId;
  if (mediaType === 'tv' && seasonNum && episodeNum) itemId = `${tmdbId}_${seasonNum}_${episodeNum}`;
  else itemId = tmdbId.toString();
  console.log(`[vidrock] Item ID: ${itemId}`);
  const encrypted = encryptAesCbc(itemId, PASSPHRASE);
  const encodedId = encodeURIComponent(encrypted);
  const apiUrl = `${VIDROCK_BASE_URL}/api/${mediaType}/${encodedId}`;
  console.log(`[vidrock] API URL: ${apiUrl}`);
  try {
    const res = await makeRequest(apiUrl);
    const json = await res.json();
    return await processVidrockResponse(json, mediaInfo, seasonNum, episodeNum);
  } catch (err) {
    console.error(`[vidrock] API call failed: ${err.message}`);
    return [];
  }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  console.log(`[vidrock] === START for ${mediaType} ID:${tmdbId} S${seasonNum}E${episodeNum} ===`);
  try {
    const mediaInfo = await getTMDBDetails(tmdbId, mediaType);
    console.log(`[vidrock] TMDB title: "${mediaInfo.title}" (${mediaInfo.year || 'N/A'})`);
    const streams = await fetchFromVidrock(mediaType, tmdbId, mediaInfo, seasonNum, episodeNum);
    if (streams.length > 0) {
      // sort by quality (1080p > 720p > ...)
      streams.sort((a, b) => {
        const getQ = (q) => {
          const match = q.match(/(\d+)/);
          return match ? parseInt(match[1]) : 0;
        };
        return getQ(b.quality) - getQ(a.quality);
      });
      console.log(`[vidrock] Returning ${streams.length} direct stream(s)`);
      return streams;
    }
    // fallback to embed URL
    let embedUrl;
    if (mediaType === 'movie') embedUrl = `${VIDROCK_BASE_URL}/movie/${tmdbId}`;
    else embedUrl = `${VIDROCK_BASE_URL}/tv/${tmdbId}/${seasonNum}/${episodeNum}`;
    console.log(`[vidrock] No direct streams, falling back to embed URL`);
    return [{
      name: 'VidRock - Open in Browser',
      title: mediaType === 'movie' ? mediaInfo.title : `${mediaInfo.title} S${seasonNum}E${episodeNum}`,
      url: embedUrl,
      quality: 'Auto',
      headers: HEADERS,
      provider: 'vidrock',
      behaviorHints: { notWebReady: true }
    }];
  } catch (err) {
    console.error('[vidrock] error:', err.message);
    return [];
  }
}

module.exports = { getStreams };
