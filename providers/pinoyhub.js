// PinoyMoviesHub Plugin for Nuvio/QuickJS
// Routes bysesayeveum through RDP proxy (194.233.72.38:3128)
// Other embeds fall back to WebView (notWebReady: true)

var TMDB_KEY = "6dc830f9624b43261325bed3bf7d0dfa";
var PINOY_BASE = "https://pinoymovieshub.win";
var PROXY_BASE = "http://194.233.72.38:3128";

function fetchText(url, headers) {
    var opts = { redirect: "follow" };
    if (headers) opts.headers = headers;
    return fetch(url, opts).then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
    });
}

function fetchJson(url, headers) {
    var opts = { redirect: "follow" };
    if (headers) opts.headers = headers;
    return fetch(url, opts).then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
    });
}

function getTmdbInfoAuto(tmdbId, forceTv) {
    var movieUrl = "https://api.themoviedb.org/3/movie/" + tmdbId + "?api_key=" + TMDB_KEY;
    var tvUrl = "https://api.themoviedb.org/3/tv/" + tmdbId + "?api_key=" + TMDB_KEY;

    if (forceTv) {
        return fetchJson(tvUrl).then(function(data) {
            return { type: "tv", data: data };
        }).catch(function() {
            return null;
        });
    }

    return fetchJson(movieUrl).then(function(data) {
        return { type: "movie", data: data };
    }).catch(function() {
        return fetchJson(tvUrl).then(function(data) {
            return { type: "tv", data: data };
        }).catch(function() {
            return null;
        });
    });
}

function similarityScore(a, b) {
    var cleanA = a.toLowerCase().replace(/[^a-z0-9]/g, "");
    var cleanB = b.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cleanA === cleanB) return 10000;
    if (cleanA.indexOf(cleanB) >= 0 || cleanB.indexOf(cleanA) >= 0) return 8000;
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

function searchPinoyHub(title, year, isTv) {
    var searchUrl = PINOY_BASE + "/wp-json/wp/v2/posts?search=" + encodeURIComponent(title) + "&per_page=30";
    return fetchJson(searchUrl).then(function(posts) {
        if (!posts || !posts.length) return null;
        var best = null;
        var bestScore = 0;
        var cleanTitle = title.toLowerCase().replace(/\(tagalog dubbed\)/gi, "").trim();

        for (var i = 0; i < posts.length; i++) {
            var p = posts[i];
            var rendered = (p.title && p.title.rendered) ? p.title.rendered : "";
            var score = similarityScore(rendered, cleanTitle);
            if (rendered.toLowerCase().indexOf("tagalog dubbed") >= 0 && similarityScore(rendered, cleanTitle) > 0) {
                score += 4000;
            }
            if (year && rendered.indexOf(year) >= 0) score += 500;
            if (isTv && rendered.toLowerCase().indexOf("season") >= 0) score += 300;
            console.log("[PinoyMoviesHub] Result " + (i+1) + " : " + rendered + " - Score: " + score);
            if (score > bestScore) {
                bestScore = score;
                best = p;
            }
        }

        if (bestScore < 3000) {
            console.log("[PinoyMoviesHub] Search score too low, trying direct slug...");
            return tryDirectSlug(title, year, isTv);
        }

        console.log("[PinoyMoviesHub] Best match: " + best.title.rendered + " -> " + best.link + " (Score: " + bestScore + ")");
        return best;
    }).catch(function() {
        return tryDirectSlug(title, year, isTv);
    });
}

function tryDirectSlug(title, year, isTv) {
    var slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    var paths = [];
    if (year) {
        paths.push("/movies/" + slug + "-" + year + "/");
        paths.push("/movies/" + slug + "-tagalog-dubbed/");
        paths.push("/series/" + slug + "-" + year + "/");
        paths.push("/series/" + slug + "-tagalog-dubbed/");
    }
    paths.push("/movies/" + slug + "/");
    paths.push("/series/" + slug + "/");

    function tryPath(index) {
        if (index >= paths.length) return null;
        var url = PINOY_BASE + paths[index];
        return fetchText(url).then(function(html) {
            if (html.indexOf('data-post="') >= 0 || html.indexOf('data-type="') >= 0) {
                console.log("[PinoyMoviesHub] Direct slug found valid page: " + url);
                return { link: url, title: { rendered: title } };
            }
            return tryPath(index + 1);
        }).catch(function() {
            return tryPath(index + 1);
        });
    }
    return tryPath(0);
}

function extractPlayerData(html) {
    var postMatch = html.match(/data-post="([^"]+)"/);
    var typeMatch = html.match(/data-type="([^"]+)"/);
    var sourceMatch = html.match(/data-source="([^"]+)"/);

    if (postMatch && typeMatch) {
        return {
            postId: postMatch[1],
            type: typeMatch[1],
            source: sourceMatch ? sourceMatch[1] : "1"
        };
    }

    var scriptMatch = html.match(/var\s+post_id\s*=\s*(\d+)/);
    if (scriptMatch) {
        return { postId: scriptMatch[1], type: "movie", source: "1" };
    }

    return null;
}

function callDooPlayerAPI(postId, type, source) {
    var apiUrl = PINOY_BASE + "/wp-json/dooplayer/v2/" + postId + "/" + type + "/" + source;
    return fetchJson(apiUrl).then(function(data) {
        if (data && data.embed_url) return data.embed_url;
        if (data && data.type === "iframe" && data.embed_url) return data.embed_url;
        return null;
    }).catch(function() {
        return null;
    });
}

function getProxyUrl(embedUrl) {
    if (!embedUrl) return null;
    var lower = embedUrl.toLowerCase();
    if (lower.indexOf("bysesayeveum") >= 0) {
        return PROXY_BASE + "/proxy?u=" + encodeURIComponent(embedUrl);
    }
    return null;
}

function buildStream(name, title, url, isProxy) {
    var stream = {
        name: name,
        title: title,
        url: url,
        behaviorHints: {
            bingeGroup: "pinoymovieshub",
            notWebReady: !isProxy
        }
    };
    if (isProxy) {
        stream.behaviorHints.proxyUrl = PROXY_BASE;
    }
    return stream;
}

function extractEpisodeSlug(html, season, episode) {
    var s = season.toString();
    var e = episode.toString();
    if (s.length < 2) s = "0" + s;
    if (e.length < 2) e = "0" + e;
    var patterns = [
        new RegExp('href="([^"]*-s' + s + 'e' + e + '-[^"]*)"', "i"),
        new RegExp('href="([^"]*-season-' + season + '-episode-' + episode + '-[^"]*)"', "i"),
        new RegExp('href="([^"]*-' + season + 'x' + episode + '-[^"]*)"', "i"),
        new RegExp('href="([^"]*-ep-' + episode + '-[^"]*)"', "i")
    ];
    for (var i = 0; i < patterns.length; i++) {
        var m = html.match(patterns[i]);
        if (m) return m[1];
    }
    return null;
}

function getStreams(tmdbId, season, episode) {
    console.log("[PinoyMoviesHub] getStreams called: " + tmdbId + " S" + season + "E" + episode);

    var mediaType = null;
    var actualSeason = season;
    var actualEpisode = episode;

    if (season === "movie" || season === "tv") {
        mediaType = season;
        actualSeason = episode;
        actualEpisode = arguments[3];
        console.log("[PinoyMoviesHub] Old Nuvio signature detected, remapped");
    }

    var forceTv = false;
    if (actualSeason && actualEpisode && actualSeason !== "movie") {
        forceTv = true;
        console.log("[PinoyMoviesHub] Forced TV mode, fetching TMDB TV: " + tmdbId);
    }

    return getTmdbInfoAuto(tmdbId, forceTv).then(function(tmdbInfo) {
        if (!tmdbInfo || !tmdbInfo.data) {
            console.log("[PinoyMoviesHub] No TMDB info found");
            return [];
        }

        var info = tmdbInfo.data;
        var title = info.title || info.name || "";
        var year = info.release_date ? info.release_date.substring(0, 4) : (info.first_air_date ? info.first_air_date.substring(0, 4) : "");
        var isTv = tmdbInfo.type === "tv";

        console.log("[PinoyMoviesHub] TMDB " + tmdbInfo.type + ": " + title + " (" + year + ")");

        return searchPinoyHub(title, year, isTv).then(function(post) {
            if (!post) {
                console.log("[PinoyMoviesHub] No PinoyHub match found");
                return [];
            }

            var pageUrl = post.link;
            return fetchText(pageUrl).then(function(html) {
                var playerData = extractPlayerData(html);
                if (!playerData) {
                    console.log("[PinoyMoviesHub] No player data found");
                    return [];
                }

                if (isTv && actualSeason && actualEpisode) {
                    var epSlug = extractEpisodeSlug(html, actualSeason, actualEpisode);
                    if (epSlug) {
                        console.log("[PinoyMoviesHub] Episode slug: " + epSlug);
                        return fetchText(epSlug).then(function(epHtml) {
                            var epPlayer = extractPlayerData(epHtml);
                            if (epPlayer) playerData = epPlayer;
                            return resolveAndBuild(playerData, title, actualSeason, actualEpisode, isTv);
                        }).catch(function() {
                            return resolveAndBuild(playerData, title, actualSeason, actualEpisode, isTv);
                        });
                    }
                }

                return resolveAndBuild(playerData, title, actualSeason, actualEpisode, isTv);
            });
        });
    }).catch(function(err) {
        console.log("[PinoyMoviesHub] Error: " + (err.message || err));
        return [];
    });
}

function resolveAndBuild(playerData, title, season, episode, isTv) {
    return callDooPlayerAPI(playerData.postId, playerData.type, playerData.source).then(function(embedUrl) {
        if (!embedUrl) {
            console.log("[PinoyMoviesHub] No embed URL from API");
            return [];
        }

        console.log("[PinoyMoviesHub] Embed: " + embedUrl);
        var proxyUrl = getProxyUrl(embedUrl);
        var streams = [];

        if (proxyUrl) {
            var streamTitle = title;
            if (isTv && season && episode) {
                streamTitle += " S" + season + "E" + episode;
            }
            streamTitle += " | Auto | Tagalog | bysesayeveum";

            streams.push(buildStream(
                "PinoyMoviesHub | Tagalog | Auto",
                streamTitle,
                proxyUrl,
                true
            ));
            console.log("[PinoyMoviesHub] Proxy stream: " + proxyUrl);
        } else {
            var host = "embed";
            var lower = embedUrl.toLowerCase();
            if (lower.indexOf("playmogo") >= 0) host = "playmogo";
            else if (lower.indexOf("mixdrop") >= 0 || lower.indexOf("m1xdrop") >= 0) host = "mixdrop";

            var streamTitle = title;
            if (isTv && season && episode) {
                streamTitle += " S" + season + "E" + episode;
            }
            streamTitle += " | Browser | Tagalog | " + host;

            streams.push(buildStream(
                "PinoyMoviesHub | Tagalog | Browser",
                streamTitle,
                embedUrl,
                false
            ));
            console.log("[PinoyMoviesHub] Embed stream: " + embedUrl);
        }

        return streams;
    });
}

// Exports for Nuvio
if (typeof module !== "undefined") {
    module.exports = { getStreams: getStreams };
}
