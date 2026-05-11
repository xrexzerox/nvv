// src/animotvslash/extractor.js
const fetch = global.fetch;

export async function extractFromPage(pageUrl) {
  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://animotvslash.org/'
    }
  });

  const html = await response.text();
  
  // Method 1: Find video URL in script tags
  let match = html.match(/file:\s*["']([^"']+\.m3u8)["']/);
  if (match && match[1]) return match[1];
  
  match = html.match(/["'](https?:\/\/[^"']+\.m3u8)["']/);
  if (match && match[1]) return match[1];
  
  // Method 2: Find iframe and extract from it
  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/);
  if (iframeMatch && iframeMatch[1]) {
    const iframeUrl = iframeMatch[1];
    const iframeResponse = await fetch(iframeUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const iframeHtml = await iframeResponse.text();
    const m3u8Match = iframeHtml.match(/["'](https?:\/\/[^"']+\.m3u8)["']/);
    if (m3u8Match && m3u8Match[1]) return m3u8Match[1];
  }

  return null;
}
