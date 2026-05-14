// PinoyHub Plugin - Simple Proxy Edition
// Compatible with Nuvio/QuickJS

var BASE_URL = "https://pinoymovieshub.win";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI1YzI1MmM3Mzk4YjVhM2QxMTBkN2ZjMzFmM2M0MjFmOCIsInN1YiI6IjY1MDA2YzE2NmEyMjI5MDBjM2M1ZDkwNyIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.5MT8wB2dC9rlJ38f5R9O6v9x8Q9v8v8v8v8v8v8v8v8";

// Your RDP proxy server
var PROXY_HOST = "194.233.72.38";
var PROXY_PORT = "3128";
var PROXY_BASE = "http://" + PROXY_HOST + ":" + PROXY_PORT;

function log(msg) {
    if (typeof console !== "undefined" && console.log) {
        console.log("[PinoyMoviesHub] " + msg);
    }
}

function fetchText(url, headers) {
    var h = headers || {};
    if (!h["User-Agent"]) h["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    return fetch(url, { method: "GET", headers: h, redirect: "follow" })
        .then(function(r) { return r.text(); });
}

function fetchJson(url, headers) {
    var h = headers || {};
    if (!h["User-Agent"]) h["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    return fetch(url, { method: "GET", headers: h, redirect: "follow" })
        .then(function(r) { return r.json(); });
}

function getTmdbInfoAuto(tmdbId, forceTv) {
    var movieUrl = TMDB_API + "/movie/" + tmdbId + "?api_key=" + TMDB_KEY;
    var tvUrl = TMDB_API + "/tv/" + tmdbId + "?api_key=" + TMDB_KEY;

    if (forceTv) {
        log("Forced TV mode, fetching TMDB TV: " + tmdbId);
        return fetchJson(tvUrl).then(function(data) {
            return { type: "tv", title: data.name || data.original_name, original: data.original_name, year: (data.first_air_date || "").substring(0,4), raw: data };
        }).catch(function() {
            return { type: "tv", title: "", year: "" };
        });
    }

    return fetchJson(movieUrl).then(function(data) {
        log("TMDB movie: " + (data.title || data.original_title) + " (" + ((data.release_date || "").substring(0,4)) + ")");
        return { type: "movie", title: data.title || data.original_title, original: data.original_title, year: (data.release_date || "").substring(0,4), raw: data };
    }).catch(function() {
        log("Movie not found, trying TV: " + tmdbId);
        return fetchJson(tvUrl).then(function(data) {
            log("TMDB TV: " + (data.name || data.original_name) + " (" + ((data.first_air_date || "").substring(0,4)) + ")");
            return { type: "tv", title: data.name || data.original_name, original: data.original_name, year: (data.first_air_date || "").substring(0,4), raw: data };
        }).catch(function() {
            return { type: "movie", title: "", year: "" };
        });
    });
}

function getTmdbEpisodeTitle(tmdbId, season, episode) {
    var url = TMDB_API + "/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "?api_key=" + TMDB_KEY;
    return fetchJson(url).then(function(data) {
        return data.name || ("Episode " + episode);
    }).catch(function() {
        return "Episode " + episode;
    });
}

function similarityScore(a, b) {
    var aWords = a.toLowerCase().split(/\s+/);
    var bWords = b.toLowerCase().split(/\s+/);
    var matches = 0;
    for (var i = 0; i < aWords.length; i++) {
        for (var j = 0; j < bWords.length; j++) {
            if (aWords[i] === bWords[j] && aWords[i].length > 2) matches++;
        }
    }
    return matches * 1000;
}

function stripHtmlTags(html) {
    return html.replace(/<[^>]+>/g, "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").trim();
}

function extractBetween(str, start, end) {
    var s = str.indexOf(start);
    if (s === -1) return "";
    s += start.length;
    var e = str.indexOf(end, s);
    if (e === -1) return "";
    return str.substring(s, e);
}

function extractAllBetween(str, start, end) {
    var results = [];
    var s = 0;
    while (true) {
        var i = str.indexOf(start, s);
        if (i === -1) break;
        i += start.length;
        var j = str.indexOf(end, i);
        if (j === -1) break;
        results.push(str.substring(i, j));
        s = j + end.length;
    }
    return results;
}

function searchPinoyHub(title, year, type) {
    var query = encodeURIComponent(title + (year ? " " + year : ""));
    var searchUrl = BASE_URL + "/?s=" + query;
    log("Searching PinoyHub: " + searchUrl);

    return fetchText(searchUrl).then(function(html) {
        var results = [];
        var items = extractAllBetween(html, '<article', '</article>');
        if (items.length === 0) {
            items = extractAllBetween(html, '<div class="result-item">', '</div>');
        }
        if (items.length === 0) {
            items = extractAllBetween(html, '<div class="search-page">', '</div>');
        }

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var linkMatch = item.match(/href=["']([^"']+)["']/);
            var titleMatch = item.match(/title=["']([^"']+)["']/);
            var nameMatch = item.match(/>([^<]+)<\/a>/);

            var resultTitle = titleMatch ? titleMatch[1] : (nameMatch ? nameMatch[1] : "");
            var resultUrl = linkMatch ? linkMatch[1] : "";

            if (!resultTitle || !resultUrl) continue;
            resultTitle = stripHtmlTags(resultTitle);

            var score = similarityScore(title, resultTitle);
            if (year && resultTitle.indexOf(year) !== -1) score += 2000;
            if (type === "tv" && (resultTitle.toLowerCase().indexOf("series") !== -1 || resultTitle.toLowerCase().indexOf("season") !== -1)) score += 300;

            log("Result " + (i + 1) + " : " + resultTitle + " - Score: " + score);
            results.push({ title: resultTitle, url: resultUrl, score: score });
        }

        results.sort(function(a, b) { return b.score - a.score; });
        return results;
    });
}

function extractPlayerData(html) {
    var players = [];

    var playerBlocks = extractAllBetween(html, '<div class="player', '</div>');
    if (playerBlocks.length === 0) {
        playerBlocks = extractAllBetween(html, '<div id="player', '</div>');
    }
    if (playerBlocks.length === 0) {
        playerBlocks = extractAllBetween(html, '<div class="dooplay-player', '</div>');
    }

    for (var i = 0; i < playerBlocks.length; i++) {
        var block = playerBlocks[i];
        var post = extractBetween(block, 'data-post="', '"');
        var type = extractBetween(block, 'data-type="', '"');
        var source = extractBetween(block, 'data-source="', '"');
        var nume = extractBetween(block, 'data-nume="', '"');

        if (post && type) {
            players.push({ post: post, type: type, source: source || "1", nume: nume || "1" });
        }
    }

    if (players.length === 0) {
        var scripts = extractAllBetween(html, '<script>', '</script>');
        for (var j = 0; j < scripts.length; j++) {
            var s = scripts[j];
            var postMatch = s.match(/post["\']?\s*:\s*["\']?(\d+)/);
            var typeMatch = s.match(/type["\']?\s*:\s*["\']?(movie|tv)/);
            if (postMatch && typeMatch) {
                players.push({ post: postMatch[1], type: typeMatch[1], source: "1", nume: "1" });
            }
        }
    }

    if (players.length === 0) {
        var dp = extractBetween(html, 'data-post="', '"');
        var dt = extractBetween(html, 'data-type="', '"');
        if (dp && dt) {
            players.push({ post: dp, type: dt, source: "1", nume: "1" });
        }
    }

    return players;
}

function callDooPlayerAPI(post, type, source, nume) {
    var apiUrl = BASE_URL + "/wp-json/dooplayer/v2/" + post + "/" + type + "/" + (source || "1");
    if (nume && nume !== "1") {
        apiUrl += "?nume=" + nume;
    }
    log("Calling Dooplayer API: " + apiUrl);

    return fetchJson(apiUrl, { "Referer": BASE_URL + "/" }).then(function(data) {
        log("Dooplayer API response keys: " + Object.keys(data).join(", "));
        var embedUrl = data.embed_url || data.url || data.source || data.link || data.file || data.src || "";
        if (!embedUrl && typeof data === "string") {
            var iframeMatch = data.match(/src=["']([^"']+)["']/);
            if (iframeMatch) embedUrl = iframeMatch[1];
        }
        return embedUrl;
    }).catch(function(err) {
        log("Dooplayer API failed: " + err);
        return "";
    });
}

function getHostName(url) {
    try {
        if (typeof URL !== "undefined") {
            return new URL(url).hostname;
        }
        var m = url.match(/^https?:\/\/([^\/]+)/);
        return m ? m[1] : "";
    } catch (e) {
        return "";
    }
}

function buildStream(title, url, quality, lang, host, isEmbed, bingeGroup, epTitle) {
    var stream = {
        name: "PinoyMoviesHub | " + lang + " | " + quality,
        title: (epTitle ? epTitle + " | " : "") + title + (epTitle ? " " + epTitle : "") + " | " + quality + " | " + lang + " | " + host,
        url: url,
        behaviorHints: {
            bingeGroup: bingeGroup || "pinoymovieshub-" + (isEmbed ? "embed" : "direct"),
            notWebReady: isEmbed
        }
    };

    if (!isEmbed) {
        stream.behaviorHints.proxyHeaders = {
            request: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://bysesayeveum.com/",
                "Origin": "https://bysesayeveum.com"
            }
        };
    }

    return stream;
}

function getStreams(tmdbId, season, episode) {
    var mediaType = "";
    if (season === "movie" || season === "tv") {
        mediaType = season;
        season = episode;
        episode = arguments[3];
    }

    var forceTv = !!(season && episode);
    log("getStreams called: " + tmdbId + (forceTv ? " S" + season + "E" + episode : " SE"));

    return getTmdbInfoAuto(tmdbId, forceTv).then(function(tmdbInfo) {
        if (!tmdbInfo.title) {
            log("No TMDB info found");
            return [];
        }

        log("Detected type: " + tmdbInfo.type + " | Title: " + tmdbInfo.title + " | Year: " + tmdbInfo.year);

        var searchTitle = tmdbInfo.title;
        var searchYear = tmdbInfo.year;
        var isTv = tmdbInfo.type === "tv" || forceTv;

        return searchPinoyHub(searchTitle, searchYear, isTv ? "tv" : "movie").then(function(results) {
            if (!results || results.length === 0) {
                log("No search results");
                return [];
            }

            var best = results[0];
            if (best.score < 6000) {
                log("No confident match (score < 6000), aborting");
                return [];
            }

            log("Best match: " + best.title + " -> " + best.url + " (Score: " + best.score + ")");

            var contentUrl = best.url;
            if (!contentUrl.startsWith("http")) {
                contentUrl = BASE_URL + contentUrl;
            }

            return fetchText(contentUrl).then(function(pageHtml) {
                var players = extractPlayerData(pageHtml);
                log("Found " + players.length + " player(s)");

                if (players.length === 0) {
                    log("No players found");
                    return [];
                }

                log("Using Dooplayer API approach");
                var promises = [];
                for (var i = 0; i < players.length; i++) {
                    var p = players[i];
                    promises.push(callDooPlayerAPI(p.post, p.type, p.source, p.nume));
                }

                return Promise.all(promises).then(function(embedUrls) {
                    var streams = [];
                    var epTitlePromise = isTv && season && episode
                        ? getTmdbEpisodeTitle(tmdbId, season, episode)
                        : Promise.resolve("");

                    return epTitlePromise.then(function(epTitle) {
                        for (var j = 0; j < embedUrls.length; j++) {
                            var embedUrl = embedUrls[j];
                            if (!embedUrl) continue;

                            var host = getHostName(embedUrl);
                            var hostShort = host.replace(/^www\./, "").split(".")[0];

                            if (host.indexOf("bysesayeveum") !== -1) {
                                // Route through RDP proxy so CDN sees RDP's IP
                                var proxyUrl = embedUrl;
                                if (proxyUrl.indexOf("/e/") !== -1) {
                                    proxyUrl = proxyUrl.replace("/e/", "/d/");
                                }
                                var resolverUrl = PROXY_BASE + "/resolve?u=" + encodeURIComponent(proxyUrl);
                                log("Resolving via proxy: " + resolverUrl);

                                streams.push({
                                    type: "resolver",
                                    resolverUrl: resolverUrl,
                                    title: tmdbInfo.title,
                                    lang: "Tagalog",
                                    host: hostShort,
                                    bingeGroup: "pinoymovieshub-bysesayeveum",
                                    epTitle: epTitle,
                                    quality: "Auto"
                                });
                            } else {
                                streams.push(buildStream(
                                    tmdbInfo.title,
                                    embedUrl,
                                    "Browser",
                                    "Tagalog",
                                    hostShort,
                                    true,
                                    "pinoymovieshub-embed",
                                    epTitle
                                ));
                            }
                        }

                        log("Returning " + streams.length + " stream(s)");
                        return streams;
                    });
                });
            });
        });
    });
}

// Export for Nuvio
if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
}
