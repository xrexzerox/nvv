/**
 * PinoyMoviesHub Nuvio Plugin
 * Domain: pinoymovieshub.win
 * Supports: Movies (TV shows may be limited)
 * Language: Filipino / Tagalog / English
 * Author: Enhanced by AI
 * Version: 1.0.0
 */

var cheerio = require("cheerio-without-node-native");

var PROVIDER_NAME = "PinoyMoviesHub";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var DEFAULT_DOMAIN = "https://pinoymovieshub.win";

var FALLBACK_DOMAINS = [
  "https://pinoymovieshub.win",
  "https://pinoymovieshub.net",
  "https://pinoymovieshub.to"
];

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1"
};

var cachedDomain = null;
var domainCacheTime = 0;
var DOMAIN_CACHE_TTL = 30 * 60 * 1000;

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
    if (!res.ok && res.status !== 301 && res.status !== 302) {
      throw new Error("HTTP " + res.status);
    }
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
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

function fetchResponse(url, options) {
  options = options || {};
  return fetch(url, {
    method: options.method || "GET",
    redirect: options.redirect || "follow",
    headers: merge(HEADERS, options.headers || {}),
    body: options.body
  });
}

function fixUrl(url, baseUrl) {
  if (!url) return "";
  if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (!baseUrl) return url;
  try {
    return new URL(url, baseUrl).toString();
  } catch (e) {
    return url;
  }
}

function normalizeTitle(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function levenshteinDistance(s, t) {
  if (s === t) return 0;
  var n = s.length, m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;
  var d = [];
  var i, j, cost;
  for (i = 0; i <= n; i++) { d[i] = []; d[i][0] = i; }
  for (j = 0; j <= m; j++) d[0][j] = j;
  for (i = 1; i <= n; i++) {
    for (j = 1; j <= m; j++) {
      cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
      d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost);
    }
  }
  return d[n][m];
}

function parseQuality(text) {
  var value = String(text || "").toLowerCase();
  var m = value.match(/\b(2160p|1440p|1080p|720p|480p|360p|4k|uhd)\b/);
  if (m) {
    var q = m[1];
    if (q === "4k" || q === "uhd") return "2160p";
    return q;
  }
  if (/\bhd\b/.test(value) && !/\bsd\b/.test(value)) return "720p";
  if (/\bsd\b/.test(value)) return "480p";
  if (/\bcam\b/.test(value)) return "CAM";
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

function uniqueBy(list, keyFn) {
  var seen = {};
  var out = [];
  var i, key;
  for (i = 0; i < list.length; i++) {
    key = keyFn(list[i]);
    if (seen[key]) continue;
    seen[key] = 1;
    out.push(list[i]);
  }
  return out;
}

function isPlayableUrl(url) {
  var u = String(url || "").toLowerCase();
  if (!u) return false;
  if (/\.(mkv|mp4|m3u8|webm|avi|mov)(\?|#|$)/.test(u)) return true;
  if (u.indexOf("video-downloads.googleusercontent.com/") !== -1) return true;
  if (u.indexOf(".r2.dev/") !== -1) return true;
  if (u.indexOf(".workers.dev/") !== -1) return true;
  if (u.indexOf("stream") !== -1 && /\.(mp4|m3u8)/.test(u)) return true;
  return false;
}

function hostPriority(url) {
  var u = String(url || "").toLowerCase();
  if (u.indexOf("video-downloads.googleusercontent.com") !== -1) return 90;
  if (u.indexOf(".r2.dev") !== -1) return 85;
  if (u.indexOf(".workers.dev") !== -1) return 80;
  if (u.indexOf("stream") !== -1 && /\.(mp4|m3u8)/.test(u)) return 70;
  if (/\.(mp4|mkv|m3u8)(\?|#|$)/.test(u)) return 60;
  return 5;
}

function sortByPriority(streams) {
  return (streams || []).slice().sort(function(a, b) {
    return hostPriority(b.url) - hostPriority(a.url);
  });
}

// ===== DOMAIN MANAGEMENT =====

function probeDomain(domain) {
  return fetch(domain + "/", {
    method: "HEAD",
    redirect: "follow",
    headers: HEADERS
  }).then(function(res) {
    return res.ok || res.status === 200 || res.status === 301 || res.status === 302;
  }).catch(function() {
    return false;
  });
}

function getActiveDomain() {
  var now = Date.now();
  if (cachedDomain && now - domainCacheTime < DOMAIN_CACHE_TTL) {
    return Promise.resolve(cachedDomain);
  }
  return Promise.all(FALLBACK_DOMAINS.map(function(domain) {
    return probeDomain(domain).then(function(ok) {
      return { domain: domain, ok: ok };
    });
  })).then(function(results) {
    var i;
    for (i = 0; i < results.length; i++) {
      if (results[i].ok) {
        cachedDomain = results[i].domain;
        domainCacheTime = now;
        return cachedDomain;
      }
    }
    cachedDomain = DEFAULT_DOMAIN;
    domainCacheTime = now;
    return cachedDomain;
  });
}

// ===== TMDB =====

function getTmdbInfo(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
  return fetchJson(url).then(function(data) {
    var title = data.name || data.title || "";
    var original = data.original_name || data.original_title || title;
    var year = (data.release_date || data.first_air_date || "").split("-")[0];
    return {
      title: title,
      original: original,
      year: year
    };
  }).catch(function() {
    return { title: "", original: "", year: "" };
  });
}

function getTmdbEpisodeTitle(tmdbId, season, episode) {
  if (!season || !episode) return Promise.resolve("");
  var url = "https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "?api_key=" + TMDB_API_KEY;
  return fetchJson(url).then(function(data) {
    return data.name || "";
  }).catch(function() {
    return "";
  });
}

// ===== SEARCH =====

function searchContent(query, year, mediaType, season, episode) {
  return getActiveDomain().then(function(domain) {
    var searchQuery = query;
    if (year) searchQuery += " " + year;
    var searchUrl = domain + "/?s=" + encodeURIComponent(searchQuery);
    console.log("[PinoyMoviesHub] Searching:", searchUrl);
    return fetchText(searchUrl).then(function(html) {
      var $ = cheerio.load(html);
      var results = [];

      // Common WordPress movie theme selectors
      var selectors = [
        "div.result-item a",
        "article.post a.lnk-blk",
        "div.TPost a",
        "div.TPostMv a",
        "ul.MovieList li a",
        "div.card-grid a",
        "div.movie-card a",
        "div.item a",
        "div.poster a",
        "div.image a",
        "h2.entry-title a",
        "h3.entry-title a"
      ].join(", ");

      $(selectors).each(function(_, el) {
        var href = fixUrl($(el).attr("href"), domain);
        if (!href) return;

        // Skip non-content URLs
        if (/(\/category\/|\/tag\/|\/author\/|\/page\/|\/feed\/|\/wp-admin\/|\/wp-login\/|\/about\/|\/contact\/|\/dmca\/|\/privacy\/)/i.test(href)) return;
        if (href === domain + "/" || href === domain) return;

        try {
          if (new URL(href).hostname !== new URL(domain).hostname) return;
        } catch(e) {}

        var title = $(el).find(".title, h2, h3, h4, .entry-title").first().text().trim() ||
          $(el).attr("title") || $(el).attr("aria-label") ||
          $(el).find("img").attr("alt") || $(el).text().trim();
        if (!title || title.length < 2) return;

        var combinedText = (title + " " + href).toLowerCase();
        var fullText = $(el).closest("article, div.result-item, li, div.item").first().text().toLowerCase();

        // Check if it's a series
        var isSeries = /\bseries\b/i.test(title) ||
          /-series-?\d*/i.test(href) ||
          /\/series\//i.test(href) ||
          /\bseason\s*\d+\b/i.test(combinedText) ||
          /\bepisode\s*\d+\b/i.test(combinedText) ||
          /\bfinale\b/i.test(fullText) ||
          /\bcomplete\b/i.test(fullText);

        if (mediaType === "movie" && isSeries) return;
        if (mediaType !== "movie" && !isSeries) return;

        var cleanedTitle = String(title).replace(/\[.*?\[\]()\]/g, "").replace(/\s+details$/i, "").trim();
        var yearMatch = combinedText.match(/\b(19|20)\d{2}\b/);
        var itemYear = yearMatch ? parseInt(yearMatch[0], 10) : 0;

        // For TV, check season/episode match
        var episodeBoost = 0;
        if (mediaType === "tv" && season) {
          var seasonRe = new RegExp("season\s*0*" + season + "\b", "i");
          var epRe = episode ? new RegExp("episode\s*0*" + episode + "\b|ep\s*0*" + episode + "\b", "i") : null;
          if (seasonRe.test(combinedText) || seasonRe.test(fullText)) episodeBoost -= 30;
          if (epRe && (epRe.test(combinedText) || epRe.test(fullText))) episodeBoost -= 50;
          // If searching for S01E01 and title contains "Complete", it might be the full season
          if (episode === 1 && /\bcomplete\b/i.test(fullText)) episodeBoost -= 20;
        }

        var distance = levenshteinDistance(normalizeTitle(cleanedTitle), normalizeTitle(query));
        var yearDistance = year && itemYear ? Math.abs(itemYear - year) : 0;
        var exactBoost = normalizeTitle(cleanedTitle) === normalizeTitle(query) ? -100 : 0;
        var includesBoost = normalizeTitle(cleanedTitle).indexOf(normalizeTitle(query)) !== -1 ? -10 : 0;

        results.push({
          href: href,
          title: cleanedTitle,
          year: itemYear,
          score: distance + yearDistance + exactBoost + includesBoost + episodeBoost
        });
      });

      if (!results.length) return null;
      results.sort(function(a, b) {
        return a.score - b.score;
      });
      console.log("[PinoyMoviesHub] Best match:", results[0].title, "->", results[0].href);
      return results[0].href;
    });
  });
}

// ===== VIDEO EXTRACTION =====

function extractVideoSources(pageUrl) {
  return fetchText(pageUrl, { headers: { Referer: pageUrl } }).then(function(html) {
    var $ = cheerio.load(html);
    var sources = [];

    // Pattern 1: Direct video tags
    $("video source[src], video[src]").each(function(_, el) {
      var src = $(el).attr("src") || $(el).attr("data-src");
      var type = $(el).attr("type") || "";
      var label = $(el).attr("label") || $(el).attr("title") || "Movie";
      if (src) {
        sources.push({
          url: fixUrl(src, pageUrl),
          label: label,
          type: type,
          quality: parseQuality(label + " " + type)
        });
      }
    });

    // Pattern 2: iframe embeds - AGGRESSIVE: accept ANY iframe that isn't clearly an ad/social
    $("iframe[src]").each(function(_, el) {
      var src = $(el).attr("src");
      if (!src) return;
      var lower = src.toLowerCase();
      // Only skip obvious non-video iframes
      if (/youtube\.com\/watch|facebook\.com|twitter\.com|ads|banner|popup|disqus|comment/i.test(lower)) return;
      if (lower.indexOf("about:blank") !== -1) return;
      if (lower.indexOf("javascript:") !== -1) return;
      // Skip very small iframes (likely ads)
      var width = $(el).attr("width") || "";
      var height = $(el).attr("height") || "";
      if ((width && Number(width) < 200) || (height && Number(height) < 100)) return;

      sources.push({
        url: fixUrl(src, pageUrl),
        label: "Embed",
        type: "iframe",
        quality: "Auto"
      });
    });

    // Pattern 3: JWPlayer / VideoJS / Plyr data sources
    var scriptTags = $("script").map(function(_, el) { return $(el).html() || ""; }).get();
    var i;
    for (i = 0; i < scriptTags.length; i++) {
      var script = scriptTags[i];

      // JWPlayer sources array
      var jwMatch = script.match(/sources\s*:\s*\[([^\]]+)\]/);
      if (jwMatch) {
        var jwSources = jwMatch[1].match(/file\s*:\s*["']([^"']+)["']/g);
        if (jwSources) {
          var j;
          for (j = 0; j < jwSources.length; j++) {
            var fileMatch = jwSources[j].match(/file\s*:\s*["']([^"']+)["']/);
            var labelMatch = jwSources[j].match(/label\s*:\s*["']([^"']+)["']/);
            if (fileMatch) {
              sources.push({
                url: fixUrl(fileMatch[1], pageUrl),
                label: labelMatch ? labelMatch[1] : "Movie",
                type: "",
                quality: parseQuality((labelMatch ? labelMatch[1] : "") + " " + fileMatch[1])
              });
            }
          }
        }
      }

      // VideoJS / Plyr sources
      var vjsMatch = script.match(/src\s*:\s*["']([^"']+)["']/g);
      if (vjsMatch) {
        var k;
        for (k = 0; k < vjsMatch.length; k++) {
          var srcMatch = vjsMatch[k].match(/src\s*:\s*["']([^"']+)["']/);
          if (srcMatch) {
            sources.push({
              url: fixUrl(srcMatch[1], pageUrl),
              label: "VideoJS",
              type: "",
              quality: parseQuality(srcMatch[1])
            });
          }
        }
      }

      // Player configs with file/source URLs
      var fileMatches = script.match(/["'](https?:\/\/[^"']+\.(m3u8|mp4|mkv|webm|avi|mov)[^"']*)["']/gi);
      if (fileMatches) {
        var m;
        for (m = 0; m < fileMatches.length; m++) {
          var clean = fileMatches[m].replace(/["']/g, "");
          sources.push({
            url: fixUrl(clean, pageUrl),
            label: "Script",
            type: "",
            quality: parseQuality(clean)
          });
        }
      }

      // Generic URL patterns in player configs
      var urlMatches = script.match(/["'](https?:\/\/[^"']+(?:stream|video|play|embed|source)[^"']*)["']/gi);
      if (urlMatches) {
        var n;
        for (n = 0; n < urlMatches.length; n++) {
          var uClean = urlMatches[n].replace(/["']/g, "");
          if (uClean.indexOf("google") !== -1 || uClean.indexOf("facebook") !== -1 || uClean.indexOf("twitter") !== -1) continue;
          sources.push({
            url: fixUrl(uClean, pageUrl),
            label: "Player",
            type: "",
            quality: "Auto"
          });
        }
      }

      // Base64 encoded URLs in scripts
      var b64Matches = script.match(/["']([A-Za-z0-9+/=]{50,})["']/g);
      if (b64Matches) {
        var p;
        for (p = 0; p < b64Matches.length; p++) {
          try {
            var decoded = atob(b64Matches[p].replace(/["']/g, ""));
            if (/https?:\/\//.test(decoded) && /\.(mp4|m3u8|mkv)/i.test(decoded)) {
              sources.push({
                url: fixUrl(decoded, pageUrl),
                label: "Encoded",
                type: "",
                quality: "Auto"
              });
            }
          } catch(e) {}
        }
      }
    }

    // Pattern 4: data-src / data-video / data-file attributes
    $("[data-src], [data-video], [data-file], [data-url]").each(function(_, el) {
      var src = $(el).attr("data-src") || $(el).attr("data-video") || $(el).attr("data-file") || $(el).attr("data-url");
      if (src) {
        sources.push({
          url: fixUrl(src, pageUrl),
          label: "Data Source",
          type: "",
          quality: "Auto"
        });
      }
    });

    // Pattern 5: Any link that looks like a video or embed
    $("a[href]").each(function(_, el) {
      var href = $(el).attr("href");
      if (!href) return;
      var lower = href.toLowerCase();
      var text = $(el).text().toLowerCase();

      // Video file extensions
      if (/\.(mp4|m3u8|mkv|webm|avi|mov)(\?|#|$)/i.test(lower)) {
        sources.push({
          url: fixUrl(href, pageUrl),
          label: $(el).text().trim() || "Direct",
          type: "",
          quality: parseQuality($(el).text() + " " + href)
        });
        return;
      }

      // Embed/player links
      if (/embed|player|stream|watch|play|video/i.test(lower) && 
          !/category|tag|author|page|feed|wp-admin|about|contact|privacy|dmca/i.test(lower)) {
        sources.push({
          url: fixUrl(href, pageUrl),
          label: $(el).text().trim() || "Player",
          type: "iframe",
          quality: "Auto"
        });
      }
    });

    // Pattern 6: Form actions (some sites use forms to load video)
    $("form[action]").each(function(_, el) {
      var action = $(el).attr("action");
      if (action && /embed|player|stream|watch/i.test(action.toLowerCase())) {
        sources.push({
          url: fixUrl(action, pageUrl),
          label: "Form",
          type: "iframe",
          quality: "Auto"
        });
      }
    });

    // Pattern 7: Object/embed tags (Flash/HTML5 fallback)
    $("object[data], embed[src]").each(function(_, el) {
      var src = $(el).attr("data") || $(el).attr("src");
      if (src) {
        sources.push({
          url: fixUrl(src, pageUrl),
          label: "Object",
          type: "",
          quality: "Auto"
        });
      }
    });

    var uniqueSources = uniqueBy(sources, function(s) { return String(s.url || "").toLowerCase(); });
    console.log("[PinoyMoviesHub] Found", uniqueSources.length, "sources on", pageUrl);
    return uniqueSources;
  }).catch(function(e) {
    console.log("[PinoyMoviesHub] extractVideoSources error:", e.message);
    return [];
  });
}

// ===== IFRAME RESOLVER =====

function resolveIframe(iframeUrl, label, quality, meta) {
  console.log("[PinoyMoviesHub] Resolving iframe:", iframeUrl);

  // First try to follow any redirect
  return fetchResponse(iframeUrl, { 
    redirect: "follow",
    headers: { Referer: meta && meta.referer ? meta.referer : iframeUrl }
  }).then(function(res) {
    var finalUrl = res.url || iframeUrl;
    console.log("[PinoyMoviesHub] Iframe resolved to:", finalUrl);

    // If redirect went to a direct video URL
    if (isPlayableUrl(finalUrl) && finalUrl !== iframeUrl) {
      return [buildStream(label + " Direct", finalUrl, quality, { Referer: iframeUrl }, "", "", meta)];
    }

    return res.text().then(function(html) {
      var $ = cheerio.load(html);
      var sources = [];

      // Direct video in iframe
      $("video source[src], video[src]").each(function(_, el) {
        var src = $(el).attr("src") || $(el).attr("data-src");
        if (src) {
          sources.push(buildStream(label + " Video", fixUrl(src, finalUrl), quality, { Referer: finalUrl }, "", "", meta));
        }
      });

      // Nested iframe
      $("iframe[src]").each(function(_, el) {
        var src = $(el).attr("src");
        if (src && !/youtube|facebook|twitter|ads|disqus|comment/i.test(src.toLowerCase())) {
          sources.push({
            url: fixUrl(src, finalUrl),
            label: "Nested",
            type: "iframe",
            quality: quality
          });
        }
      });

      // Script-based players
      var scripts = $("script").map(function(_, el) { return $(el).html() || ""; }).get();
      var i;
      for (i = 0; i < scripts.length; i++) {
        var fileMatches = scripts[i].match(/["'](https?:\/\/[^"']+\.(m3u8|mp4|mkv|webm)[^"']*)["']/gi);
        if (fileMatches) {
          var j;
          for (j = 0; j < fileMatches.length; j++) {
            var clean = fileMatches[j].replace(/["']/g, "");
            sources.push(buildStream(label + " Stream", fixUrl(clean, finalUrl), quality, { Referer: finalUrl }, "", "", meta));
          }
        }

        // Base64 encoded in iframe scripts
        var b64Matches = scripts[i].match(/["']([A-Za-z0-9+/=]{50,})["']/g);
        if (b64Matches) {
          var k;
          for (k = 0; k < b64Matches.length; k++) {
            try {
              var decoded = atob(b64Matches[k].replace(/["']/g, ""));
              if (/https?:\/\//.test(decoded) && /\.(mp4|m3u8|mkv)/i.test(decoded)) {
                sources.push(buildStream(label + " Encoded", fixUrl(decoded, finalUrl), quality, { Referer: finalUrl }, "", "", meta));
              }
            } catch(e) {}
          }
        }
      }

      // Any playable link in iframe
      $("a[href]").each(function(_, el) {
        var href = $(el).attr("href");
        if (href && isPlayableUrl(href)) {
          sources.push(buildStream(label + " Link", fixUrl(href, finalUrl), quality, { Referer: finalUrl }, "", "", meta));
        }
      });

      return sources;
    });
  }).catch(function(e) {
    console.log("[PinoyMoviesHub] iframe resolve error:", e.message);
    return [];
  });
}

// ===== STREAM BUILDER =====

function buildStream(label, url, quality, headers, size, tech, meta) {
  var cleanedLabel = String(label || "").replace(/\s+/g, " ").trim();
  var lang = inferLang(cleanedLabel);
  var displayTitle = (meta && meta.title) ? meta.title : "Movie";
  var year = (meta && meta.year) ? " (" + meta.year + ")" : "";
  var isSeries = !!(meta && (meta.season || meta.episode));

  var line1, line2;
  if (isSeries) {
    var epPart = meta.episodeTitle ? " - " + meta.episodeTitle : "";
    line1 = "📺 S" + meta.season + "E" + meta.episode + epPart + " | " + displayTitle + year;
  } else {
    line1 = "🎬 " + displayTitle + year;
  }

  var qIcon = (quality.indexOf("2160") !== -1 || quality.indexOf("4K") !== -1) ? "💎" : "📺";
  line2 = qIcon + " " + quality + " | 🌍 " + lang + (size ? " | 💾 " + size : "");

  return {
    name: "PinoyMoviesHub | " + quality + (size ? " | " + size : ""),
    title: line1 + "\n" + line2,
    url: url,
    quality: quality,
    headers: Object.keys(headers || {}).length ? headers : undefined,
    behaviorHints: {
      bingeGroup: "pinoymovieshub-" + String(quality || "auto").toLowerCase()
    }
  };
}

// ===== MAIN ENTRY =====

function extractFromPage(contentUrl, meta, mediaType, season, episode) {
  return extractVideoSources(contentUrl).then(function(sources) {
    // For TV shows, try to find episode-specific links on the page
    if (mediaType === "tv" && season) {
      if (!sources.length) {
        return findEpisodeLink(contentUrl, season, episode).then(function(epUrl) {
          if (epUrl) {
            console.log("[PinoyMoviesHub] Episode URL:", epUrl);
            return extractVideoSources(epUrl).then(function(epSources) {
              return processSources(epSources, epUrl, meta);
            });
          }
          return [];
        });
      }
      // Even if we found sources on the series page, also try episode page for better quality
      return findEpisodeLink(contentUrl, season, episode).then(function(epUrl) {
        if (epUrl && epUrl !== contentUrl) {
          return extractVideoSources(epUrl).then(function(epSources) {
            var allSources = sources.concat(epSources || []);
            return processSources(allSources, epUrl, meta);
          }).catch(function() {
            return processSources(sources, contentUrl, meta);
          });
        }
        return processSources(sources, contentUrl, meta);
      });
    }
    return processSources(sources, contentUrl, meta);
  });
}

function processSources(sources, pageUrl, meta) {
  if (!sources.length) return [];

  var streams = [];
  var iframePromises = [];
  var i;

  // Pass referer through meta for iframe resolution
  var metaWithReferer = merge(meta || {}, { referer: pageUrl });

  for (i = 0; i < sources.length; i++) {
    var source = sources[i];
    if (source.type === "iframe") {
      iframePromises.push(
        resolveIframe(source.url, source.label, source.quality, metaWithReferer).then(function(iframeStreams) {
          streams = streams.concat(iframeStreams || []);
        }).catch(function() {})
      );
    } else {
      // Accept ALL URLs, not just isPlayableUrl - let the player try them
      streams.push(buildStream(source.label, source.url, source.quality, { Referer: pageUrl }, "", "", meta));
    }
  }

  return Promise.all(iframePromises).then(function() {
    streams = uniqueBy(streams, function(s) {
      return String(s.url || "").toLowerCase();
    });
    streams = sortByPriority(streams);
    console.log("[PinoyMoviesHub] Returning", streams.length, "streams");
    return streams;
  });
}

function findEpisodeLink(pageUrl, season, episode) {
  var sNum = Number(season);
  var eNum = Number(episode);

  return fetchText(pageUrl, { headers: { Referer: pageUrl } }).then(function(html) {
    var $ = cheerio.load(html);
    var candidates = [];

    // Look for episode links in various formats
    $("a[href]").each(function(_, el) {
      var href = fixUrl($(el).attr("href"), pageUrl);
      var text = $(el).text().toLowerCase();
      var title = ($(el).attr("title") || "").toLowerCase();
      var combined = text + " " + title;

      // Match patterns like "Episode 1", "S01E01", "Season 1 Episode 1", "E01"
      var epMatch = combined.match(/episode\s*0*([0-9]+)/i) ||
        combined.match(new RegExp("s\s*0*" + sNum + "\s*e\s*0*" + eNum, "i")) ||
        combined.match(new RegExp("e\s*0*" + eNum + "\b", "i"));

      if (epMatch && Number(epMatch[1]) === eNum) {
        var seasonMatch = combined.match(/season\s*0*([0-9]+)/i);
        if (!seasonMatch || Number(seasonMatch[1]) === sNum) {
          candidates.push({
            url: href,
            text: text,
            score: text.indexOf("episode") !== -1 ? 0 : 10
          });
        }
      }

      // Also match URL patterns like /episodes/show-name-1x1/
      var urlMatch = href.match(/\/episodes\/[^/]*-?" + sNum + "x" + eNum + "\b/i) ||
        href.match(/\/episodes\/[^/]*-?" + sNum + "-" + eNum + "\b/i) ||
        href.match(/\/episodes\/[^/]*-?s" + sNum + "e" + eNum + "\b/i);
      if (urlMatch) {
        candidates.push({ url: href, text: text, score: -5 });
      }
    });

    // Check for episode lists/season structures
    $("div.episode-item, div.episodelist-item, li.episode, div.season-episodes a, div.episode-list a").each(function(_, el) {
      var href = fixUrl($(el).find("a[href]").first().attr("href") || $(el).attr("href"), pageUrl);
      var text = $(el).text().toLowerCase();
      var epMatch = text.match(/episode\s*0*([0-9]+)/i) || text.match(/\b([0-9]+)\b/);
      if (epMatch && Number(epMatch[1]) === eNum) {
        candidates.push({ url: href, text: text, score: 0 });
      }
    });

    if (!candidates.length) {
      console.log("[PinoyMoviesHub] No episode link found on page");
      return null;
    }
    candidates.sort(function(a, b) { return a.score - b.score; });
    console.log("[PinoyMoviesHub] Best episode link:", candidates[0].url);
    return candidates[0].url;
  }).catch(function(e) { 
    console.log("[PinoyMoviesHub] findEpisodeLink error:", e.message);
    return null; 
  });
}

function findContentUrl(tmdbId, mediaType, season, episode) {
  return getTmdbInfo(tmdbId, mediaType).then(function(names) {
    if (!names.title && !names.original) return null;

    // For TV, try searching with season info
    var tvSuffix = "";
    if (mediaType === "tv" && season) {
      tvSuffix = " Season " + season;
    }

    return searchContent(names.title + tvSuffix, names.year, mediaType, season, episode).then(function(found) {
      if (found) return found;
      if (names.original && names.original !== names.title) {
        return searchContent(names.original + tvSuffix, names.year, mediaType, season, episode);
      }
      return null;
    });
  });
}

// ===== ENTRY POINT =====

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[PinoyMoviesHub] getStreams called:", tmdbId, mediaType, season, episode);

  var epPromise = (mediaType === "tv")
    ? getTmdbEpisodeTitle(tmdbId, season, episode)
    : Promise.resolve("");

  return epPromise.then(function(episodeTitle) {
    return getTmdbInfo(tmdbId, mediaType).then(function(tmdbData) {
      return findContentUrl(tmdbId, mediaType, season, episode).then(function(contentUrl) {
        if (!contentUrl) {
          console.log("[PinoyMoviesHub] No content URL found");
          return [];
        }
        console.log("[PinoyMoviesHub] Content URL:", contentUrl);

        var meta = {
          title: tmdbData.title || "Movie",
          year: tmdbData.year || "",
          season: season,
          episode: episode,
          episodeTitle: episodeTitle
        };

        return extractFromPage(contentUrl, meta, mediaType, season, episode);
      });
    });
  }).catch(function(err) {
    console.error("[PinoyMoviesHub] Error:", err.message || err);
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
