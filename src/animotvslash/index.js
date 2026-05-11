// src/animotvslash/index.js
import { extractFromPage } from './extractor.js';

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  console.log(`[animotvslash] Started: ${mediaType} ${tmdbId} S${seasonNum}E${episodeNum}`);
  
  if (mediaType !== 'tv') {
    console.log('[animotvslash] Skipping: Only TV episodes supported');
    return [];
  }

  try {
    const episodeUrl = `https://animotvslash.org/farming-life-in-another-world-2-episode-${episodeNum}/`;
    console.log(`[animotvslash] Fetching: ${episodeUrl}`);

    const videoUrl = await extractFromPage(episodeUrl);
    if (!videoUrl) {
      console.log('[animotvslash] No video URL found');
      return [];
    }

    console.log(`[animotvslash] Found URL: ${videoUrl}`);
    const quality = videoUrl.includes('1080') ? '1080p' : (videoUrl.includes('720') ? '720p' : 'Unknown');
    
    return [{
      name: `animotvslash - ${quality}`,
      title: `Episode ${episodeNum}`,
      url: videoUrl,
      quality: quality,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://animotvslash.org/'
      },
      provider: 'animotvslash'
    }];
  } catch (err) {
    console.error(`[animotvslash] Error: ${err.message}`);
    return [];
  }
}

module.exports = { getStreams };
