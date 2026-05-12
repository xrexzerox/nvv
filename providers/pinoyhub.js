/**
 * pinoyhub.js
 * Fetch movie / TV episode video sources from Pinoy Movies Hub.
 * Built to integrate with generic provider APIs.
 */

// ------------------------------
// Constants
// ------------------------------

const BASE_API = "https://pinoymovieshub.win/wp-json/dooplayer/v2";
const REFERER_PINOY = "https://pinoymovieshub.win/";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

// Headers required for API requests
const HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": REFERER_PINOY
};

// Cookie (may need refresh if expired)
const COOKIE = "starstruck_7da72d90b632af60dd1158c068193d61=99f22538d0588cdd7ccfc783299f88a7";

// ------------------------------
// Helper: Fetch and parse JSON
// ------------------------------

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: {
            ...HEADERS,
            "Cookie": COOKIE,
            ...options.headers
        }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
}

// ------------------------------
// Main Provider Function
// ------------------------------

/**
 * Get video streams from Pinoy Movies Hub
 * @param {string|number} tmdbId - Not directly used; here we expect the internal post ID or episode ID.
 * @param {string} mediaType - Either "movie" or "tv".
 * @param {number|string} [season] - Season number (required for TV).
 * @param {number|string} [episode] - Episode number (required for TV).
 * @returns {Promise<Array<{name: string, title: string, url: string, quality: string, headers: object, provider: string}>>}
 */
export async function getStreams(tmdbId, mediaType, season = null, episode = null) {
    console.log(`[PinoyHub] Fetching streams for ID: ${tmdbId}, Type: ${mediaType}, S:${season} E:${episode}`);

    try {
        let requestUrl;

        if (mediaType === "movie") {
            // Movie endpoint: /wp-json/dooplayer/v2/{movie_id}
            requestUrl = `${BASE_API}/${tmdbId}`;
        } else if (mediaType === "tv") {
            if (!season || !episode) {
                console.error("[PinoyHub] Missing season or episode for TV show");
                return [];
            }
            // TV episode endpoint: /wp-json/dooplayer/v2/{series_id}/tv/{episode_number}
            // Note: The HAR shows "tv/1", but season parameter appears omitted.
            // The dooplayer expects: /{post_id}/tv/{episode_number}
            requestUrl = `${BASE_API}/${tmdbId}/tv/${episode}`;
        } else {
            console.error(`[PinoyHub] Unsupported media type: ${mediaType}`);
            return [];
        }

        const data = await fetchJSON(requestUrl);
        console.log("[PinoyHub] API response:", data);

        // Handle both direct embed_url and manual download links
        let streams = [];

        // 1) If response contains embed_url (iframe) → try to resolve real video URL
        if (data.embed_url) {
            const resolved = await resolveEmbedUrl(data.embed_url);
            if (resolved) {
                streams.push({
                    name: "PinoyHub",
                    title: `PinoyHub - ${data.type || "iframe"}`,
                    url: resolved,
                    quality: "Auto",
                    headers: { "Referer": data.embed_url, "User-Agent": USER_AGENT },
                    provider: "pinoyhub"
                });
            } else {
                // fallback: return embed url itself
                streams.push({
                    name: "PinoyHub",
                    title: `PinoyHub - ${data.type || "iframe"}`,
                    url: data.embed_url,
                    quality: "Auto",
                    headers: { "Referer": REFERER_PINOY, "User-Agent": USER_AGENT },
                    provider: "pinoyhub"
                });
            }
        }

        // 2) If the API directly returns download links (alternative structure)
        if (data.links && Array.isArray(data.links)) {
            for (const link of data.links) {
                if (link.url) {
                    const finalUrl = await followRedirect(link.url);
                    if (finalUrl) {
                        streams.push({
                            name: "PinoyHub",
                            title: `PinoyHub - ${link.host || "Download"}`,
                            url: finalUrl,
                            quality: link.quality || "Unknown",
                            headers: { "Referer": REFERER_PINOY, "User-Agent": USER_AGENT },
                            provider: "pinoyhub"
                        });
                    }
                }
            }
        }

        // 3) If response contains download links in a "data" wrapper
        if (data.data && data.data.links) {
            for (const link of data.data.links) {
                if (link.url) {
                    const finalUrl = await followRedirect(link.url);
                    if (finalUrl) {
                        streams.push({
                            name: "PinoyHub",
                            title: `PinoyHub - ${link.host || "Download"}`,
                            url: finalUrl,
                            quality: link.quality || "Unknown",
                            headers: { "Referer": REFERER_PINOY, "User-Agent": USER_AGENT },
                            provider: "pinoyhub"
                        });
                    }
                }
            }
        }

        return streams;
    } catch (error) {
        console.error(`[PinoyHub] Error: ${error.message}`);
        return [];
    }
}

// ------------------------------
// Helper: Resolve embed_url to direct video URL
// ------------------------------

async function resolveEmbedUrl(embedUrl) {
    try {
        console.log(`[PinoyHub] Resolving embed: ${embedUrl}`);
        const res = await fetch(embedUrl, {
            method: "GET",
            headers: {
                "User-Agent": USER_AGENT,
                "Referer": REFERER_PINOY,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
            }
        });
        const html = await res.text();

        // Common patterns for video URLs in iframe sources
        const patterns = [
            /file:\s*"([^"]+)"/,                 // file:"URL"
            /src:\s*"([^"]+)"/,                  // src:"URL"
            /video_url:\s*"([^"]+)"/,            // video_url:"URL"
            /"videoUrl":"([^"]+)"/,              // "videoUrl":"URL"
            /'(https?:\/\/[^\s]+\.(?:m3u8|mp4)[^\s]*)'/ // direct .m3u8/.mp4 URL in quotes
        ];

        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) return match[1];
        }

        // If no pattern matches, try to find any .m3u8 or .mp4 URL in the page
        const directMatch = html.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/i);
        if (directMatch) return directMatch[1];
    } catch (err) {
        console.warn(`[PinoyHub] Failed to resolve embed ${embedUrl}: ${err.message}`);
    }
    return null;
}

// ------------------------------
// Helper: Follow redirects (for download links)
// ------------------------------

async function followRedirect(url) {
    try {
        const res = await fetch(url, {
            method: "GET",
            redirect: "manual",
            headers: {
                "User-Agent": USER_AGENT,
                "Referer": REFERER_PINOY
            }
        });
        const location = res.headers.get("location") || res.url;
        if (location && location !== url) return location;
    } catch (err) {
        console.warn(`[PinoyHub] Redirect error for ${url}: ${err.message}`);
    }
    return url;
}
