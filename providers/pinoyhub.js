/**
 * pinoyhub.js - Fetch movie / TV episode video sources from Pinoy Movies Hub.
 * Uses both the Dooplayer API and direct HTML scraping of download links.
 */

// ------------------------------
// Constants
// ------------------------------
const BASE_URL = "https://pinoymovieshub.win";
const API_BASE = `${BASE_URL}/wp-json/dooplayer/v2`;
const REFERER = BASE_URL;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": REFERER
};

// Cookie (you may need to update this periodically)
let COOKIE = "starstruck_7da72d90b632af60dd1158c068193d61=99f22538d0588cdd7ccfc783299f88a7";

/**
 * Update cookie if you obtain a fresh one
 */
export function setCookie(cookie) {
    COOKIE = cookie;
}

// ------------------------------
// Helper: Fetch JSON from API
// ------------------------------
async function fetchAPI(url) {
    const res = await fetch(url, {
        headers: { ...HEADERS, "Cookie": COOKIE }
    });
    if (!res.ok) throw new Error(`API HTTP ${res.status}`);
    return res.json();
}

// ------------------------------
// Helper: Fetch HTML page
// ------------------------------
async function fetchHTML(url) {
    const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Referer": REFERER }
    });
    return res.text();
}

// ------------------------------
// Extract download links from HTML (like your Python script)
// ------------------------------
function extractDownloadLinksFromHTML(html, animeTitle, season, episode) {
    const $ = cheerio.load(html); // you need to import cheerio or use regex
    const links = [];
    $("#download .links_table tbody tr").each((i, row) => {
        const $row = $(row);
        const qualityCell = $row.find("td:nth-child(2) strong.quality");
        const languageCell = $row.find("td:nth-child(3)");
        const linkCell = $row.find("td:first-child a");
        const url = linkCell.attr("href");
        if (!url) return;
        const quality = qualityCell.text().trim() || "Unknown";
        const language = languageCell.text().trim();
        links.push({
            url: `${BASE_URL}${url.startsWith("/") ? url : "/" + url}`,
            quality,
            language,
            title: `${animeTitle} - ${season ? `S${season}E${episode}` : "Movie"}`
        });
    });
    return links;
}

// ------------------------------
// Resolve embed URL to direct video (for Mixdrop, Doodstream, Byse)
// ------------------------------
async function resolveEmbedToVideo(embedUrl) {
    try {
        const html = await fetchHTML(embedUrl);
        // Mixdrop pattern: "file":"https://..."
        let match = html.match(/file:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/);
        if (match) return match[1];
        // Doodstream pattern: const player = new Player({ ... source: '...' })
        match = html.match(/source:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/);
        if (match) return match[1];
        // Byse pattern: data-video-url="..."
        match = html.match(/data-video-url=["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/);
        if (match) return match[1];
        // Any .m3u8 or .mp4 URL in the page
        match = html.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/i);
        if (match) return match[1];
    } catch (e) {
        console.warn(`[PinoyHub] Failed to resolve ${embedUrl}:`, e.message);
    }
    return null;
}

// ------------------------------
// Main provider function
// ------------------------------
export async function getStreams(tmdbId, mediaType, season = null, episode = null) {
    console.log(`[PinoyHub] Request: ID=${tmdbId}, type=${mediaType}, S=${season} E=${episode}`);
    const streams = [];

    try {
        // ---------- 1. Try API (gives embed_url) ----------
        let apiUrl = null;
        if (mediaType === "movie") {
            apiUrl = `${API_BASE}/stream?id=${tmdbId}&type=movie&num=1`;
        } else if (mediaType === "tv") {
            if (!episode) throw new Error("Episode required for TV");
            apiUrl = `${API_BASE}/${tmdbId}/tv/${episode}`;
        } else {
            throw new Error("Unsupported media type");
        }

        let apiData = null;
        try {
            apiData = await fetchAPI(apiUrl);
            console.log("[PinoyHub] API response:", apiData);
        } catch (err) {
            console.warn("[PinoyHub] API failed, falling back to HTML scraping:", err.message);
        }

        if (apiData && apiData.embed_url) {
            const directUrl = await resolveEmbedToVideo(apiData.embed_url);
            if (directUrl) {
                streams.push({
                    name: "PinoyHub (API)",
                    title: `${mediaType === "movie" ? "Movie" : `S${season}E${episode}`}`,
                    url: directUrl,
                    quality: "Auto",
                    headers: { Referer: apiData.embed_url, "User-Agent": USER_AGENT },
                    provider: "pinoyhub"
                });
            } else {
                // Fallback: return embed URL itself (if player supports iframes)
                streams.push({
                    name: "PinoyHub (Embed)",
                    title: `${mediaType === "movie" ? "Movie" : `S${season}E${episode}`}`,
                    url: apiData.embed_url,
                    quality: "Embed",
                    headers: { Referer: REFERER, "User-Agent": USER_AGENT },
                    provider: "pinoyhub"
                });
            }
        }

        // ---------- 2. Scrape HTML for direct download links (like Python script) ----------
        let pageUrl = "";
        if (mediaType === "movie") {
            // You need a slug (e.g., "scissors") – you might need a mapping from tmdbId to slug
            // For now assume you have a way to get the slug, or call search API.
            pageUrl = `${BASE_URL}/movies/${tmdbId}`; // tmdbId is actually the slug here
        } else {
            // For TV: the episode page URL pattern from HAR: /episodes/{slug}-1x1
            // We need to know the slug. This is tricky; you may need to search.
            // Simpler: use the API's embed_url to get the episode page referer.
            if (apiData && apiData.embed_url) {
                // The referer in the HAR is like https://pinoymovieshub.win/episodes/if-wishes-could-kill-1x1
                // We can extract from the embed request's referer? Not possible. Better to construct from title.
                // For now, skip HTML scraping for TV unless we have a reliable slug.
            }
        }

        // If we have a page URL (for movies or we can fetch episode page via other means)
        if (pageUrl) {
            const html = await fetchHTML(pageUrl);
            // Use cheerio or regex to extract links
            const downloadLinks = extractDownloadLinksFromHTML(html, "Pinoy Movie", season, episode);
            for (const link of downloadLinks) {
                // Try to resolve the download link (might be an intermediary page)
                let finalUrl = link.url;
                // If it's a mixdrop/doodstream/byse link, resolve it
                if (finalUrl.includes("mixdrop") || finalUrl.includes("dood") || finalUrl.includes("byse")) {
                    const resolved = await resolveEmbedToVideo(finalUrl);
                    if (resolved) finalUrl = resolved;
                }
                streams.push({
                    name: "PinoyHub (Download)",
                    title: link.title,
                    url: finalUrl,
                    quality: link.quality,
                    headers: { Referer: pageUrl, "User-Agent": USER_AGENT },
                    provider: "pinoyhub"
                });
            }
        }

        return streams;
    } catch (error) {
        console.error("[PinoyHub] Error:", error.message);
        return [];
    }
}

// ------------------------------
// Simple regex-based HTML parsing if you don't have cheerio
// ------------------------------
function extractDownloadLinksRegex(html, title, season, episode) {
    const links = [];
    // Match table rows: <tr id='link-...'> ... <a href='...'> ... </a> ... <strong class='quality'>720p</strong> ...
    const rowRegex = /<tr[^>]*id='link-\d+'>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
        const row = rowMatch[1];
        const urlMatch = row.match(/<a[^>]+href=['"]([^'"]+)['"]/);
        if (!urlMatch) continue;
        let url = urlMatch[1];
        if (!url.startsWith("http")) url = BASE_URL + url;
        const qualityMatch = row.match(/<strong[^>]*class=['"]quality['"][^>]*>([^<]+)<\/strong>/);
        const quality = qualityMatch ? qualityMatch[1].trim() : "Unknown";
        const languageMatch = row.match(/<td[^>]*>([^<]+)<\/td>/g);
        let language = "";
        if (languageMatch && languageMatch.length >= 3) {
            language = languageMatch[2].replace(/<\/?td>/g, "").trim();
        }
        links.push({
            url,
            quality,
            language,
            title: `${title} - ${season ? `S${season}E${episode}` : "Movie"}`
        });
    }
    return links;
}
