// providers/pinoyhub.js
// PinoyMoviesHub - Original approach with KissKH-style TMDB auto-detect + embed resolvers

var cheerio = require("cheerio-without-node-native");

var PROVIDER_NAME = "PinoyMoviesHub";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var BASE_URL = "https://pinoymovieshub.win";

var HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE_URL,
    "Cookie": "starstruck_7da72d90b632af60dd1158c068193d61=99f22538d0588cdd7ccfc783299f88a7"
};

// ===== UTILITY FUNCTIONS =====

function merge(obj1, obj2) {
    var out = {};
    var k;
    for (k in obj1 || {}) out[k] = obj1[k];
    for (k in obj2 || {}) out[k] = obj2[k];
    return out;
}

function fetchText(url, options) {
    options = options || {};
    return fetch(url, {
        method: options.method || "GET",
        redirect: options.redirect || "follow",
        headers: merge(HEADERS, options.headers || {}),
        body: options.body
    }).then(function(res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
    });
}

function fetchJson(url, options) {
    options = options || {};
    return fetch(url, {
        method: options.method || "GET",
        redirect: options.redirect || "follow",
        headers: merge(HEADERS, options.headers || {}),
        body: options.body
    }).then(function(res) {
        if (!res.ok) return null;
        return res.json();
    }).catch(function() { return null; });
}

function slugify(title) {
    return String(title || "").toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function parseQuality(text) {
    var value = String(text || "").toLowerCase();
    var m = value.match(/\b(2160p|1440p|1080p|720p|480p|360p|4k|uhd|hd|sd|cam)\b/);
    if (m) {
        var q = m[1];
        if (q === "4k" || q === "uhd") return "2160p";
        if (q === "hd") return "720p";
        if (q === "sd") return "480p";
        if (q === "cam") return "CAM";
        return q;
    }
    return "Auto";
}

function inferLang(text) {
    var t = String(text || "").toLowerCase();
    if (t.indexOf("tagalog") !== -1 || t.indexOf("filipino") !== -1) return "Tagalog";
    if (t.indexOf("english") !== -1 || /\beng\b/.test(t)) return "English";
    if (t.indexOf("spanish") !== -1) return "Spanish";
    if (t.indexOf("korean") !== -1) return "Korean";
    if (t.indexOf("japanese") !== -1) return "Japanese";
    if (t.indexOf("chinese") !== -1) return "Chinese";
    if (t.indexOf("hindi") !== -1) return "Hindi";
    return "Tagalog";
}

function log(msg) {
    if (typeof console !== "undefined" && console.log) {
        console.log("[" + PROVIDER_NAME + "] " + msg);
    }
}

// ===== TMDB AUTO-DETECT (KissKH-style) =====

function getTmdbInfoAuto(tmdbId, forceTv) {
    return new Promise(function(resolve, reject) {
        if (forceTv) {
            var tvUrl = "https://api.themoviedb.org/3/tv/" + tmdbId + "?api_key=" + TMDB_API_KEY;
            log("Forced TV mode, fetching TMDB TV: " + tmdbId);
            fetchJson(tvUrl).then(function(tvData) {
                if (tvData && tvData.name) {
                    log("TMDB TV: " + tvData.name + " (" + (tvData.first_air_date || "").substring(0, 4) + ")");
                    resolve({
                        type: "tv",
                        title: tvData.name || tvData.original_name || "",
                        original: tvData.original_name || "",
                        year: (tvData.first_air_date || "").substring(0, 4),
                        raw: tvData
                    });
                    return;
                }
                reject(new Error("TMDB TV ID not found: " + tmdbId));
            }).catch(function(err) {
                reject(err);
            });
            return;
        }

        var movieUrl = "https://api.themoviedb.org/3/movie/" + tmdbId + "?api_key=" + TMDB_API_KEY;
        log("Fetching TMDB movie: " + tmdbId);

        fetchJson(movieUrl).then(function(data) {
            if (data && data.title) {
                log("TMDB movie: " + data.title + " (" + (data.release_date || "").substring(0, 4) + ")");
                resolve({
                    type: "movie",
                    title: data.title || data.original_title || "",
                    original: data.original_title || "",
                    year: (data.release_date || "").substring(0, 4),
                    raw: data
                });
                return;
            }

            var tvUrl = "https://api.themoviedb.org/3/tv/" + tmdbId + "?api_key=" + TMDB_API_KEY;
            log("Movie 404, trying TV: " + tmdbId);
            return fetchJson(tvUrl);
        }).then(function(tvData) {
            if (tvData && tvData.name) {
                log("TMDB TV: " + tvData.name + " (" + (tvData.first_air_date || "").substring(0, 4) + ")");
                resolve({
                    type: "tv",
                    title: tvData.name || tvData.original_name || "",
                    original: tvData.original_name || "",
                    year: (tvData.first_air_date || "").substring(0, 4),
                    raw: tvData
                });
                return;
            }
            if (tvData === undefined) return;
            reject(new Error("TMDB ID not found: " + tmdbId));
        }).catch(function(err) {
            reject(err);
        });
    });
}

function getTmdbEpisodeTitle(tmdbId, season, episode) {
    if (!season || !episode) return Promise.resolve("");
    var url = "https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "?api_key=" + TMDB_API_KEY;
    return fetchJson(url).then(function(data) {
        return data.name || "";
    }).catch(function() { return ""; });
}

// ===== EMBED RESOLVERS =====

function resolveMixdrop(embedUrl) {
    return new Promise(function(resolve) {
        log("Resolving Mixdrop: " + embedUrl.substring(0, 60));

        // Try /f/ URL (file page) instead of /e/ (embed page)
        var fileUrl = embedUrl.replace("/e/", "/f/");
        log("Trying Mixdrop file page: " + fileUrl.substring(0, 60));

        fetchText(fileUrl, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://mixdrop.top/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
        }).then(function(html) {
            // Look for packed JS with wurl
            var wurlMatch = html.match(/wurl\s*=\s*["']([^"']+)["']/);
            if (wurlMatch) {
                var videoUrl = wurlMatch[1];
                if (!videoUrl.startsWith("http")) videoUrl = "https:" + videoUrl;
                log("Found Mixdrop wurl: " + videoUrl.substring(0, 80));
                resolve(videoUrl);
                return;
            }

            var srcMatch = html.match(/src\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"]*)["']/i);
            if (srcMatch) {
                log("Found Mixdrop src: " + srcMatch[1].substring(0, 80));
                resolve(srcMatch[1]);
                return;
            }

            var videoMatch = html.match(/<video[^>]+src=["']([^"']+)["']/i);
            if (videoMatch) {
                resolve(videoMatch[1]);
                return;
            }

            // Fallback to embed page
            log("Mixdrop /f/ failed, trying /e/ page");
            return fetchText(embedUrl, {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://mixdrop.top/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9"
            });
        }).then(function(html) {
            if (!html) {
                resolve(embedUrl);
                return;
            }
            var wurlMatch = html.match(/wurl\s*=\s*["']([^"']+)["']/);
            if (wurlMatch) {
                var videoUrl = wurlMatch[1];
                if (!videoUrl.startsWith("http")) videoUrl = "https:" + videoUrl;
                resolve(videoUrl);
                return;
            }
            var videoMatch = html.match(/<video[^>]+src=["']([^"']+)["']/i);
            if (videoMatch) {
                resolve(videoMatch[1]);
                return;
            }
            log("Mixdrop resolver failed, returning embed URL");
            resolve(embedUrl);
        }).catch(function(err) {
            log("Mixdrop error: " + err.message);
            resolve(embedUrl);
        });
    });
}

function resolveBysesayeveum(embedUrl) {
    return new Promise(function(resolve) {
        log("Resolving Bysesayeveum: " + embedUrl.substring(0, 60));

        // Try /d/ URL instead of /e/ - the download page works better
        var downloadUrl = embedUrl.replace("/e/", "/d/");
        log("Trying download page: " + downloadUrl.substring(0, 60));

        fetchText(downloadUrl, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://bysesayeveum.com/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
        }).then(function(html) {
            // Look for video sources in download page
            var videoMatch = html.match(/<video[^>]+src=["']([^"']+)["']/i);
            if (videoMatch) {
                log("Found Bysesayeveum video src: " + videoMatch[1].substring(0, 80));
                resolve(videoMatch[1]);
                return;
            }

            var sourceMatch = html.match(/<source[^>]+src=["']([^"']+)["']/i);
            if (sourceMatch) {
                log("Found Bysesayeveum source: " + sourceMatch[1].substring(0, 80));
                resolve(sourceMatch[1]);
                return;
            }

            // Look for data attributes
            var dataMatch = html.match(/data-file=["']([^"']+)["']/i) ||
                           html.match(/data-video=["']([^"']+)["']/i) ||
                           html.match(/data-url=["']([^"']+)["']/i);
            if (dataMatch) {
                var dataFile = dataMatch[1];
                try {
                    var decoded = atob(dataFile);
                    if (/\.(m3u8|mp4)/i.test(decoded)) {
                        log("Found Bysesayeveum base64: " + decoded.substring(0, 80));
                        resolve(decoded);
                        return;
                    }
                } catch(e) {}
                if (/^https?:/i.test(dataFile)) {
                    log("Found Bysesayeveum data-file: " + dataFile.substring(0, 80));
                    resolve(dataFile);
                    return;
                }
            }

            // Look for scripts with video URLs
            var scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
            for (var i = 0; i < scripts.length; i++) {
                var urlMatch = scripts[i].match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i);
                if (urlMatch) {
                    log("Found Bysesayeveum script URL: " + urlMatch[1].substring(0, 80));
                    resolve(urlMatch[1]);
                    return;
                }
            }

            // Fallback to original embed URL
            log("Bysesayeveum /d/ page failed, trying /e/ page");
            return fetchText(embedUrl, {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://bysesayeveum.com/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9"
            });
        }).then(function(html) {
            if (!html) {
                resolve(embedUrl);
                return;
            }
            var videoMatch = html.match(/<video[^>]+src=["']([^"']+)["']/i);
            if (videoMatch) {
                resolve(videoMatch[1]);
                return;
            }
            var scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
            for (var i = 0; i < scripts.length; i++) {
                var urlMatch = scripts[i].match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i);
                if (urlMatch) {
                    resolve(urlMatch[1]);
                    return;
                }
            }
            log("Bysesayeveum resolver failed, returning embed URL");
            resolve(embedUrl);
        }).catch(function(err) {
            log("Bysesayeveum error: " + err.message);
            resolve(embedUrl);
        });
    });
}

function resolvePlaymogo(embedUrl) {
    return new Promise(function(resolve) {
        log("Resolving Playmogo: " + embedUrl.substring(0, 60));

        // Try /v/ URL (video page) instead of /e/ (embed page)
        var videoUrl = embedUrl.replace("/e/", "/v/");
        log("Trying Playmogo video page: " + videoUrl.substring(0, 60));

        fetchText(videoUrl, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://playmogo.com/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
        }).then(function(html) {
            var urlMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i);
            if (urlMatch) {
                log("Found Playmogo URL: " + urlMatch[1].substring(0, 80));
                resolve(urlMatch[1]);
                return;
            }

            var videoMatch = html.match(/<video[^>]+src=["']([^"']+)["']/i);
            if (videoMatch) {
                log("Found Playmogo video: " + videoMatch[1].substring(0, 80));
                resolve(videoMatch[1]);
                return;
            }

            // Fallback to embed page
            log("Playmogo /v/ failed, trying /e/ page");
            return fetchText(embedUrl, {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://playmogo.com/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9"
            });
        }).then(function(html) {
            if (!html) {
                resolve(embedUrl);
                return;
            }
            var urlMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i);
            if (urlMatch) {
                resolve(urlMatch[1]);
                return;
            }
            var iframeMatch = html.match(/<iframe[^>]+src=["']([^"]+)["']/i);
            if (iframeMatch) {
                var iframeUrl = iframeMatch[1];
                if (!iframeUrl.startsWith("http")) {
                    try { iframeUrl = new URL(iframeUrl, embedUrl).href; } catch(e) {}
                }
                log("Found Playmogo iframe, following: " + iframeUrl.substring(0, 60));
                resolveGenericEmbed(iframeUrl).then(resolve);
                return;
            }
            log("Playmogo resolver failed, returning embed URL");
            resolve(embedUrl);
        }).catch(function(err) {
            log("Playmogo error: " + err.message);
            resolve(embedUrl);
        });
    });
}

function resolveGenericEmbed(embedUrl) {
    return new Promise(function(resolve) {
        log("Generic embed resolver: " + embedUrl.substring(0, 60));
        fetchText(embedUrl, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": embedUrl,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
        }).then(function(html) {
            var patterns = [
                /<video[^>]+src=["']([^"']+)["']/i,
                /<source[^>]+src=["']([^"']+)["']/i,
                /file\s*:\s*["']([^"']+)["']/i,
                /src\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"]*)["']/i,
                /(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i
            ];
            for (var i = 0; i < patterns.length; i++) {
                var match = html.match(patterns[i]);
                if (match) {
                    var url = match[1] || match[0];
                    if (url && /\.(m3u8|mp4)/i.test(url)) {
                        log("Generic resolver found URL: " + url.substring(0, 80));
                        resolve(url);
                        return;
                    }
                }
            }
            resolve(embedUrl);
        }).catch(function() {
            resolve(embedUrl);
        });
    });
}

// Bysesayeveum resolver server
// Config: change this to your server IP
var RESOLVER_HOST = "194.233.72.38";
var RESOLVER_PORT = "3128";

function callExternalResolver(embedUrl) {
    return new Promise(function(resolve) {
        // Use the proxy server endpoint - it resolves AND proxies through RDP
        var proxyUrl = embedUrl;
        if (proxyUrl.indexOf("/e/") !== -1) {
            proxyUrl = proxyUrl.replace("/e/", "/d/");
        }
        var apiUrl = "http://" + RESOLVER_HOST + ":" + RESOLVER_PORT + "/proxy?u=" + encodeURIComponent(proxyUrl);
        log("Calling proxy server: " + apiUrl.substring(0, 80));

        // The proxy server returns a rewritten HLS playlist
        // All segment URLs inside are also proxied through RDP
        resolve(apiUrl);
    });
}

function resolveEmbed(embedUrl) {
    return new Promise(function(resolve) {
        var host = "";
        try {
            if (typeof URL !== "undefined") {
                host = new URL(embedUrl).hostname.toLowerCase();
            }
        } catch(e) {}
        log("Resolving embed host: " + host);

        // Bysesayeveum: route through proxy server (resolves + proxies through RDP)
        if (host.indexOf("bysesayeveum") !== -1) {
            var downloadUrl = embedUrl.replace("/e/", "/d/");
            log("Bysesayeveum: routing through proxy " + downloadUrl.substring(0, 60));

            callExternalResolver(downloadUrl).then(function(proxyUrl) {
                if (proxyUrl) {
                    log("Bysesayeveum proxy URL: " + proxyUrl.substring(0, 80));
                    resolve(proxyUrl);
                } else {
                    log("Bysesayeveum proxy failed, returning embed URL");
                    resolve(embedUrl);
                }
            });
            return;
        }

        // Mixdrop and Playmogo: return embed URL for WebView
        if (host.indexOf("mixdrop") !== -1 || host.indexOf("m1xdrop") !== -1 || 
            host.indexOf("playmogo") !== -1) {
            log("Host " + host + " requires WebView, returning embed URL");
            resolve(embedUrl);
            return;
        }

        // Generic fallback
        resolveGenericEmbed(embedUrl).then(resolve);
    });
}

// ===== DOOPLAYER API =====

function extractPlayerData(html) {
    var $ = cheerio.load(html);
    var players = [];

    $("[data-post][data-type][data-source], [data-post][data-type], #dooplay_player, .dooplay_player, .dooplay_player_response").each(function(_, el) {
        var postId = $(el).attr("data-post") || $(el).attr("data-id");
        var type = $(el).attr("data-type") || "movie";
        var source = $(el).attr("data-source") || $(el).attr("data-nume") || "1";
        var nonce = $(el).attr("data-nonce") || "";

        if (postId) {
            players.push({
                postId: postId,
                type: type,
                source: source,
                nonce: nonce
            });
        }
    });

    var scripts = $("script").map(function(_, el) { return $(el).html() || ""; }).get();
    var i;
    for (i = 0; i < scripts.length; i++) {
        var script = scripts[i];
        var postMatch = script.match(/data-post[=:]\s*["'](\d+)["']/);
        var typeMatch = script.match(/data-type[=:]\s*["']([^"']+)["']/);
        var sourceMatch = script.match(/data-source[=:]\s*["']([^"']+)["']/);
        var nonceMatch = script.match(/data-nonce[=:]\s*["']([^"']+)["']/);

        if (postMatch) {
            players.push({
                postId: postMatch[1],
                type: typeMatch ? typeMatch[1] : "movie",
                source: sourceMatch ? sourceMatch[1] : "1",
                nonce: nonceMatch ? nonceMatch[1] : ""
            });
        }
    }

    var seen = {};
    var unique = [];
    for (i = 0; i < players.length; i++) {
        var key = players[i].postId + "-" + players[i].source;
        if (!seen[key]) {
            seen[key] = 1;
            unique.push(players[i]);
        }
    }

    log("Found " + unique.length + " player(s)");
    return unique;
}

function callDooPlayerAPI(playerData) {
    var apiUrl = BASE_URL + "/wp-json/dooplayer/v2/" + playerData.postId + "/" + playerData.type + "/" + playerData.source;
    log("Calling Dooplayer API: " + apiUrl);

    return fetchJson(apiUrl, {
        headers: merge(HEADERS, {
            "X-Requested-With": "XMLHttpRequest"
        })
    }).then(function(data) {
        if (!data) {
            log("Dooplayer API returned null");
            return null;
        }
        log("Dooplayer API response keys: " + Object.keys(data || {}).join(", "));

        var embedUrl = data.embed_url || data.url || data.source || data.link || data.file || data.src;
        if (!embedUrl && data.data) {
            embedUrl = data.data.embed_url || data.data.url || data.data.source || data.data.link || data.data.file || data.data.src;
        }
        if (!embedUrl) {
            var html = data.html || data.iframe || data.embed || data.player;
            if (html && typeof html === "string") {
                var iframeMatch = html.match(/src=["']([^"']+)["']/);
                if (iframeMatch && iframeMatch[1]) embedUrl = iframeMatch[1];
            }
        }
        if (!embedUrl) {
            log("Dooplayer API response: " + JSON.stringify(data).substring(0, 200));
            return null;
        }
        log("Dooplayer embed URL: " + embedUrl);
        return resolveEmbed(embedUrl);
    }).catch(function(e) {
        log("Dooplayer API error: " + e.message);
        return null;
    });
}

// ===== STREAM BUILDER =====

function buildStream(name, url, quality, language, displayTitle, meta) {
    var lang = inferLang(language);
    var isSeries = !!(meta && meta.season);
    var host = "";
    try { host = new URL(url).hostname.replace(/^www\./, "").replace(/\.com$/, "").replace(/\.top$/, "").replace(/\.click$/, ""); } catch(e) {}

    var isEmbed = !/\.(m3u8|mp4|mkv|webm|avi|mov)(\?|#|$)/i.test(url);
    // Proxy URLs (containing /proxy?u=) are direct HLS streams, not embeds
    if (url.indexOf("/proxy?u=") !== -1) {
        isEmbed = false;
    }
    var q = isEmbed ? "Browser" : parseQuality(quality + " " + language);

    var line1, line2;
    if (isSeries) {
        var epPart = meta.episodeTitle ? " - " + meta.episodeTitle : "";
        line1 = "S" + meta.season + "E" + meta.episode + epPart + " | " + displayTitle;
    } else {
        line1 = displayTitle;
    }

    if (isEmbed) {
        line2 = "Browser | " + lang + (host ? " | " + host : "");
    } else {
        line2 = q + " | " + lang + (host ? " | " + host : "");
    }

    return {
        name: PROVIDER_NAME + (isEmbed ? " | " + lang + " | (Embed)" : " | " + q + " | " + lang),
        title: line1 + "\n" + line2,
        url: url,
        quality: q,
        headers: { Referer: BASE_URL },
        provider: "pinoymovieshub",
        behaviorHints: {
            bingeGroup: "pinoymovieshub-" + (isEmbed ? "embed" : q.toLowerCase()),
            notWebReady: isEmbed
        }
    };
}

// ===== MAIN ENTRY =====

function getStreams(tmdbId, season, episode) {
    var mediaType = null;
    if (season === "movie" || season === "tv") {
        mediaType = season;
        season = episode;
        episode = arguments[3];
        log("Detected old signature (mediaType=" + mediaType + "), remapped to season=" + season + " episode=" + episode);
    }

    var seasonStr = season || "";
    var episodeStr = episode || "";
    log("getStreams called: " + tmdbId + " S" + seasonStr + "E" + episodeStr);

    var forceTv = !!(season && episode);
    var isTv = forceTv || mediaType === "tv";

    var epPromise = isTv
        ? getTmdbEpisodeTitle(tmdbId, season, episode)
        : Promise.resolve("");

    return epPromise.then(function(episodeTitle) {
        return getTmdbInfoAuto(tmdbId, forceTv).then(function(tmdbData) {
            if (forceTv && tmdbData.type !== "tv") {
                log("Forcing TV mode");
                tmdbData.type = "tv";
            }

            log("Detected type: " + tmdbData.type + " | Title: " + tmdbData.title + " | Year: " + tmdbData.year);

            var title = tmdbData.title;
            var displayTitle;
            var pageUrl;

            if (tmdbData.type === "movie" || !isTv) {
                displayTitle = title;
                pageUrl = BASE_URL + "/movies/" + slugify(title) + "/";
            } else {
                displayTitle = title + " S" + season + "E" + episode;
                pageUrl = BASE_URL + "/episodes/" + slugify(title) + "-" + season + "x" + episode + "/";
            }

            log("Fetching page: " + pageUrl);

            return fetchText(pageUrl).then(function(html) {
                var meta = {
                    season: season,
                    episode: episode,
                    episodeTitle: episodeTitle
                };

                var players = extractPlayerData(html);
                if (!players.length) {
                    log("No player data found");
                    return [];
                }

                log("Using Dooplayer API approach");

                return Promise.all(players.map(function(player) {
                    return callDooPlayerAPI(player).then(function(embedUrl) {
                        if (!embedUrl) return null;
                        return buildStream(
                            PROVIDER_NAME + " - Source " + player.source,
                            embedUrl,
                            "Auto",
                            "",
                            displayTitle,
                            meta
                        );
                    });
                })).then(function(results) {
                    var streams = [];
                    var i;
                    for (i = 0; i < results.length; i++) {
                        if (results[i]) streams.push(results[i]);
                    }
                    log("Returning " + streams.length + " stream(s)");
                    return streams;
                });
            });
        });
    }).catch(function(err) {
        log("error: " + (err.message || err));
        return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    global.getStreams = getStreams;
}
