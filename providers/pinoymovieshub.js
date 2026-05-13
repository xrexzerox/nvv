/**
 * PinoyMoviesHub Nuvio Plugin - Dooplay API Edition
 * Domain: pinoymovieshub.win
 * Supports: Movies & TV Shows
 * Language: Filipino / Tagalog / English
 * Author: Enhanced by AI
 * Version: 3.0.0
 */

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

var VIDEO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Referer": BASE_URL,
  "Accept": "video/webm,video/ogg,video/*;q=0.9,*/*;q=0.5"
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

// ===== TMDB =====

function getTmdbTitle(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
  return fetchJson(url).then(function(data) {
    if (!data) return null;
    if (mediaType === "tv") return data.name || data.original_name || null;
    return data.title || data.original_title || null;
  });
}

function getTmdbEpisodeTitle(tmdbId, season, episode) {
  if (!season || !episode) return Promise.resolve("");
  var url = "https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "?api_key=" + TMDB_API_KEY;
  return fetchJson(url).then(function(data) {
    return data.name || "";
  }).catch(function() { return ""; });
}

// ===== DOOPLAYER API =====

function extractPlayerData(html) {
  var $ = cheerio.load(html);
  var players = [];

  // Look for dooplayer elements with data attributes
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

  // Also look in scripts for dooplayer initialization
  var scripts = $("script").map(function(_, el) { return $(el).html() || ""; }).get();
  var i;
  for (i = 0; i < scripts.length; i++) {
    var script = scripts[i];

    // Look for dooplayer data in scripts
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

  // Deduplicate by postId+source
  var seen = {};
  var unique = [];
  for (i = 0; i < players.length; i++) {
    var key = players[i].postId + "-" + players[i].source;
    if (!seen[key]) {
      seen[key] = 1;
      unique.push(players[i]);
    }
  }

  console.log("[PinoyMoviesHub] Found", unique.length, "player(s)");
  return unique;
}

function callDooPlayerAPI(playerData) {
  // Dooplayer v2 API: /wp-json/dooplayer/v2/{post_id}/{type}/{source}
  var apiUrl = BASE_URL + "/wp-json/dooplayer/v2/" + playerData.postId + "/" + playerData.type + "/" + playerData.source;
  console.log("[PinoyMoviesHub] Calling Dooplayer API:", apiUrl);

  return fetchJson(apiUrl, {
    headers: merge(HEADERS, {
      "X-Requested-With": "XMLHttpRequest"
    })
  }).then(function(data) {
    if (!data) {
      console.log("[PinoyMoviesHub] Dooplayer API returned null");
      return null;
    }
    console.log("[PinoyMoviesHub] Dooplayer API response keys:", Object.keys(data || {}).join(", "));

    // The API returns various formats depending on the source type
    var embedUrl = data.embed_url || data.url || data.source || data.link || data.file || data.src;
    if (embedUrl) {
      console.log("[PinoyMoviesHub] Dooplayer embed URL:", embedUrl);
      return embedUrl;
    }

    // Some APIs return the data in a nested structure
    if (data.data) {
      embedUrl = data.data.embed_url || data.data.url || data.data.source || data.data.link || data.data.file || data.data.src;
      if (embedUrl) {
        console.log("[PinoyMoviesHub] Dooplayer nested embed URL:", embedUrl);
        return embedUrl;
      }
    }

    // Check if response is an iframe HTML string
    var html = data.html || data.iframe || data.embed || data.player;
    if (html && typeof html === "string") {
      var iframeMatch = html.match(/src=["']([^"']+)["']/);
      if (iframeMatch && iframeMatch[1]) {
        console.log("[PinoyMoviesHub] Dooplayer iframe src:", iframeMatch[1]);
        return iframeMatch[1];
      }
    }

    console.log("[PinoyMoviesHub] Dooplayer API response:", JSON.stringify(data).substring(0, 200));
    return null;
  }).catch(function(e) {
    console.log("[PinoyMoviesHub] Dooplayer API error:", e.message);
    return null;
  });
}

// ===== EMBED RESOLVERS =====

function resolveBysesayeveum(url) {
  console.log("[PinoyMoviesHub] Resolving bysesayeveum:", url);

  return fetchText(url, { headers: { Referer: url } }).then(function(html) {
    var $ = cheerio.load(html);
    var scripts = $("script").map(function(_, el) { return $(el).html() || ""; }).get();
    var i;

    // Look for player config or source URLs in scripts
    for (i = 0; i < scripts.length; i++) {
      var script = scripts[i];

      // Look for any m3u8 or mp4 URL
      var videoMatch = script.match(/(https?:\/\/[^\s"']+\.(m3u8|mp4)[^\s"']*)/);
      if (videoMatch) {
        console.log("[PinoyMoviesHub] bysesayeveum video:", videoMatch[1]);
        return videoMatch[1];
      }

      // Look for source assignment
      var srcMatch = script.match(/source\s*[=:]\s*["']([^"']+)["']/);
      if (srcMatch && srcMatch[1]) {
        var srcUrl = srcMatch[1];
        if (srcUrl.indexOf("http") !== 0) srcUrl = "https:" + srcUrl;
        console.log("[PinoyMoviesHub] bysesayeveum source:", srcUrl);
        return srcUrl;
      }

      // Look for base64 encoded URLs
      var b64Match = script.match(/["']([A-Za-z0-9+/=]{40,})["']/g);
      if (b64Match) {
        var j;
        for (j = 0; j < b64Match.length; j++) {
          try {
            var decoded = atob(b64Match[j].replace(/["']/g, ""));
            if (/https?:\/\//.test(decoded) && /\.(m3u8|mp4)/i.test(decoded)) {
              console.log("[PinoyMoviesHub] bysesayeveum b64:", decoded);
              return decoded;
            }
          } catch(e) {}
        }
      }
    }

    // Look for data attributes on player elements
    var playerData = $("[data-player], [data-video-id], [data-embed], [data-source], [data-url]").first();
    if (playerData.length) {
      var dataSrc = playerData.attr("data-source") || playerData.attr("data-url") || playerData.attr("data-embed") || playerData.attr("data-video-id");
      if (dataSrc) {
        console.log("[PinoyMoviesHub] bysesayeveum player data:", dataSrc);
        if (dataSrc.indexOf("http") === 0) return dataSrc;
      }
    }

    // Try common API endpoints - Promise chain version
    var apiEndpoints = ["/sources/", "/ajax/sources/", "/api/source/", "/ajax/embed/", "/api/embed/"];
    var pathMatch = url.match(/\/e\/([^/]+)/);
    var videoId = pathMatch ? pathMatch[1] : "";
    var domain = new URL(url).hostname;

    function tryApiEndpoint(index) {
      if (index >= apiEndpoints.length) {
        console.log("[PinoyMoviesHub] bysesayeveum fallback to generic");
        return resolveGenericEmbed(url);
      }

      var apiUrl = "https://" + domain + apiEndpoints[index] + videoId;
      console.log("[PinoyMoviesHub] bysesayeveum trying API:", apiUrl);

      return fetch(apiUrl, {
        method: "POST",
        headers: merge(HEADERS, {
          "Referer": url,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded"
        }),
        body: "r=" + encodeURIComponent(url) + "&d=" + encodeURIComponent(domain)
      }).then(function(res) {
        return res.text().then(function(apiText) {
          console.log("[PinoyMoviesHub] bysesayeveum API response:", apiText.substring(0, 100));

          try {
            var data = JSON.parse(apiText);
            if (data && data.source) return data.source;
            if (data && data.data && data.data.length) {
              var src = data.data[0].file || data.data[0].url || data.data[0].src;
              if (src) return src;
            }
          } catch(e) {
            var m = apiText.match(/(https?:\/\/[^\s"']+\.(m3u8|mp4)[^\s"']*)/);
            if (m) return m[1];
          }

          // Try next endpoint
          return tryApiEndpoint(index + 1);
        });
      }).catch(function() {
        return tryApiEndpoint(index + 1);
      });
    }

    return tryApiEndpoint(0);
  }).catch(function(e) {
    console.log("[PinoyMoviesHub] bysesayeveum error:", e.message);
    return resolveGenericEmbed(url);
  });
}

function resolveEmbedUrl(embedUrl) {
  var lower = String(embedUrl || "").toLowerCase();
  console.log("[PinoyMoviesHub] resolveEmbedUrl called for:", embedUrl);

  // Hosts we CAN resolve to direct video
  if (lower.indexOf("streamtape") !== -1 || lower.indexOf("strtape") !== -1) {
    console.log("[PinoyMoviesHub] Routing to Streamtape resolver");
    return resolveStreamtape(embedUrl);
  }
  if (lower.indexOf("dood") !== -1 || lower.indexOf("ds2play") !== -1 || lower.indexOf("d0000d") !== -1) {
    console.log("[PinoyMoviesHub] Routing to Doodstream resolver");
    return resolveDoodstream(embedUrl);
  }
  if (lower.indexOf("vidcloud") !== -1 || lower.indexOf("vidstream") !== -1 || lower.indexOf("mcloud") !== -1) {
    console.log("[PinoyMoviesHub] Routing to Vidcloud resolver");
    return resolveVidcloud(embedUrl);
  }

  // Hosts that are protected (Mixdrop with 403, bysesayeveum with recaptcha, playmogo with not found)
  // Return the embed URL directly - Nuvio WebView player might handle it
  if (lower.indexOf("mixdrop") !== -1 || lower.indexOf("m1xdrop") !== -1 || lower.indexOf("mixdroop") !== -1) {
    console.log("[PinoyMoviesHub] Mixdrop protected (403), returning embed URL directly");
    return Promise.resolve(embedUrl);
  }
  if (lower.indexOf("bysesayeveum") !== -1) {
    console.log("[PinoyMoviesHub] bysesayeveum protected (recaptcha), returning embed URL directly");
    return Promise.resolve(embedUrl);
  }
  if (lower.indexOf("playmogo") !== -1) {
    console.log("[PinoyMoviesHub] playmogo protected (not found/expired), returning embed URL directly");
    return Promise.resolve(embedUrl);
  }

  // Try generic resolver for unknown hosts
  console.log("[PinoyMoviesHub] Routing to generic resolver");
  return resolveGenericEmbed(embedUrl);
}

function resolveMixdrop(url) {
  console.log("[PinoyMoviesHub] Resolving Mixdrop:", url);
  return fetchText(url, { headers: { Referer: BASE_URL } }).then(function(html) {
    // First: look for actual video file URLs
    var videoMatches = html.match(/(https?:\/\/[^\s"']+\.(m3u8|mp4|mkv|webm)[^\s"']*)/gi);
    if (videoMatches) {
      var i;
      for (i = 0; i < videoMatches.length; i++) {
        var v = videoMatches[i];
        if (v.indexOf("http") === 0 && v.length > 20 && !/google|recaptcha|gstatic/i.test(v)) {
          console.log("[PinoyMoviesHub] Mixdrop video URL:", v);
          return v;
        }
      }
    }

    // Second: look for wurl patterns (Mixdrop specific)
    var wurlMatch = html.match(/wurl\s*=\s*["']([^"']+)["']/);
    if (!wurlMatch) wurlMatch = html.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/);
    if (wurlMatch && wurlMatch[1]) {
      var videoUrl = wurlMatch[1];
      if (videoUrl.indexOf("http") !== 0) videoUrl = "https:" + videoUrl;
      if (!/google|recaptcha|gstatic/i.test(videoUrl)) {
        console.log("[PinoyMoviesHub] Mixdrop wurl:", videoUrl);
        return videoUrl;
      }
    }

    // Third: base64 encoded
    var b64Matches = html.match(/["']([A-Za-z0-9+/=]{40,})["']/g);
    if (b64Matches) {
      for (i = 0; i < b64Matches.length; i++) {
        try {
          var decoded = atob(b64Matches[i].replace(/["']/g, ""));
          if (/https?:\/\//.test(decoded) && /\.(m3u8|mp4)/i.test(decoded) && !/google|recaptcha/i.test(decoded)) {
            console.log("[PinoyMoviesHub] Mixdrop base64:", decoded);
            return decoded;
          }
        } catch(e) {}
      }
    }

    console.log("[PinoyMoviesHub] Mixdrop patterns failed");
    return null;
  }).catch(function(e) {
    console.log("[PinoyMoviesHub] Mixdrop error:", e.message);
    return null;
  });
}

function resolveStreamtape(url) {
  return fetchText(url, { headers: { Referer: url } }).then(function(html) {
    var tokenMatch = html.match(/document\.getElementById\(["']videolink["']\)\.innerHTML\s*=\s*["']([^"']+)["']/);
    if (tokenMatch && tokenMatch[1]) {
      return "https:" + tokenMatch[1];
    }
    var altMatch = html.match(/innerHTML\s*=\s*["']([^"']+)["']/);
    if (altMatch && altMatch[1] && altMatch[1].indexOf("streamtape") !== -1) {
      return "https:" + altMatch[1];
    }
    return null;
  }).catch(function() { return null; });
}

function resolveDoodstream(url) {
  return fetchText(url, { headers: { Referer: url } }).then(function(html) {
    var md5Match = html.match(/\/pass_md5\/([^"']+)/);
    var tokenMatch = html.match(/token\s*=\s*["']([^"']+)["']/);
    if (md5Match && tokenMatch) {
      var md5Url = "https:" + md5Match[0];
      var token = tokenMatch[1];
      return fetchText(md5Url, { headers: { Referer: url } }).then(function(md5Res) {
        var base = md5Res.trim();
        if (base) {
          return base + "?token=" + token + "&expiry=" + Date.now();
        }
        return null;
      });
    }
    return null;
  }).catch(function() { return null; });
}

function resolveVidcloud(url) {
  return fetchText(url, { headers: { Referer: url } }).then(function(html) {
    var sourcesMatch = html.match(/sources\s*:\s*(\[[^\]]+\])/);
    if (sourcesMatch) {
      try {
        var sources = JSON.parse(sourcesMatch[1]);
        if (sources && sources.length) {
          var best = sources[0].file || sources[0].src || sources[0];
          if (best && typeof best === "string") return best;
        }
      } catch(e) {}
    }
    var m3u8Match = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    if (m3u8Match) return m3u8Match[1];
    return null;
  }).catch(function() { return null; });
}

function resolveGenericEmbed(url) {
  console.log("[PinoyMoviesHub] Resolving generic embed:", url);
  return fetchText(url, { headers: { Referer: url } }).then(function(html) {
    var $ = cheerio.load(html);

    var videoSrc = $("video source").first().attr("src") || $("video").first().attr("src");
    if (videoSrc) {
      console.log("[PinoyMoviesHub] Generic video tag:", videoSrc);
      return videoSrc.indexOf("http") === 0 ? videoSrc : "https:" + videoSrc;
    }

    var scripts = $("script").map(function(_, el) { return $(el).html() || ""; }).get();
    var i;
    for (i = 0; i < scripts.length; i++) {
      var script = scripts[i];

      var sourcesMatch = script.match(/sources\s*:\s*(\[[^\]]+\])/);
      if (sourcesMatch) {
        try {
          var parsed = JSON.parse(sourcesMatch[1]);
          if (parsed && parsed.length) {
            var file = parsed[0].file || parsed[0].src || parsed[0];
            if (file && typeof file === "string") {
              console.log("[PinoyMoviesHub] Generic sources:", file);
              return file.indexOf("http") === 0 ? file : "https:" + file;
            }
          }
        } catch(e) {}
      }

      var directMatch = script.match(/["'](https?:\/\/[^"']+\.(m3u8|mp4)[^"']*)["']/);
      if (directMatch) {
        console.log("[PinoyMoviesHub] Generic direct:", directMatch[1]);
        return directMatch[1];
      }

      var wurlMatch = script.match(/wurl\s*=\s*["']([^"']+)["']/);
      if (wurlMatch && wurlMatch[1]) {
        var wurl = wurlMatch[1];
        console.log("[PinoyMoviesHub] Generic wurl:", wurl);
        return wurl.indexOf("http") === 0 ? wurl : "https:" + wurl;
      }

      var srcMatch = script.match(/src\s*:\s*["'](https?:\/\/[^"']+)["']/);
      if (srcMatch) {
        console.log("[PinoyMoviesHub] Generic src:", srcMatch[1]);
        return srcMatch[1];
      }

      var b64Matches = script.match(/["']([A-Za-z0-9+/=]{50,})["']/g);
      if (b64Matches) {
        var j;
        for (j = 0; j < b64Matches.length; j++) {
          try {
            var decoded = atob(b64Matches[j].replace(/["']/g, ""));
            if (/https?:\/\//.test(decoded) && /\.(m3u8|mp4)/i.test(decoded)) {
              console.log("[PinoyMoviesHub] Generic base64:", decoded);
              return decoded;
            }
          } catch(e) {}
        }
      }
    }

    var iframeSrc = $("iframe[src]").filter(function() { var s = $(this).attr("src") || ""; return s.indexOf("about:blank") === -1; }).first().attr("src");
    if (iframeSrc && iframeSrc !== url && !/youtube|facebook|twitter|disqus/i.test(iframeSrc)) {
      console.log("[PinoyMoviesHub] Nested iframe:", iframeSrc);
      return resolveGenericEmbed(fixUrl(iframeSrc, url));
    }

    console.log("[PinoyMoviesHub] Could not resolve generic embed:", url);
    return null;
  }).catch(function(e) {
    console.log("[PinoyMoviesHub] Generic resolve error:", e.message);
    return null;
  });
}

// ===== DOWNLOAD LINKS FALLBACK =====

function extractDownloadLinks(html) {
  var $ = cheerio.load(html);
  var table = $("#download .links_table table");
  if (!table.length) {
    table = $(".links_table table, #downloads table, .download-links table").first();
  }
  if (!table.length) {
    console.log("[PinoyMoviesHub] No download table found");
    return [];
  }

  var links = [];
  table.find("tbody tr").each(function(_, row) {
    var cols = $(row).find("td");
    if (cols.length < 3) return;
    var a = $(cols[0]).find("a");
    if (!a.length) return;
    var url = a.attr("href");
    if (url && url.indexOf("http") !== 0) url = BASE_URL + url;
    var quality = $(cols[1]).find("strong.quality").text().trim() || $(cols[1]).text().trim() || "Unknown";
    var language = $(cols[2]).text().trim() || "";
    links.push({ url: url, quality: quality, language: language });
  });

  if (!links.length) {
    table.find("tr").each(function(_, row) {
      var cols = $(row).find("td");
      if (cols.length < 2) return;
      var a = $(cols[0]).find("a");
      if (!a.length) return;
      var url = a.attr("href");
      if (url && url.indexOf("http") !== 0) url = BASE_URL + url;
      var quality = $(cols[1]).text().trim() || "Unknown";
      var language = cols.length > 2 ? $(cols[2]).text().trim() : "";
      links.push({ url: url, quality: quality, language: language });
    });
  }

  console.log("[PinoyMoviesHub] Found", links.length, "download links");
  return links;
}

function resolveInternalLink(linkUrl) {
  console.log("[PinoyMoviesHub] Following internal link:", linkUrl);
  return fetch(linkUrl, {
    headers: HEADERS,
    redirect: "follow"
  }).then(function(res) {
    var finalUrl = res.url || linkUrl;
    console.log("[PinoyMoviesHub] Resolved to:", finalUrl);
    if (finalUrl !== linkUrl && finalUrl.indexOf("pinoymovieshub.win") === -1) {
      return resolveEmbedUrl(finalUrl).then(function(directUrl) {
        if (directUrl) {
          console.log("[PinoyMoviesHub] Direct video:", directUrl);
          return directUrl;
        }
        return finalUrl;
      });
    }
    return res.text().then(function(html) {
      var metaMatch = html.match(/content="0;\s*url=([^"]+)"/) || html.match(/content="0;url=([^"]+)"/);
      if (metaMatch) return metaMatch[1];
      var jsMatch = html.match(/window\.location\s*=\s*["']([^"']+)["']/);
      if (jsMatch) return jsMatch[1];
      return null;
    }).catch(function() { return null; });
  }).catch(function(err) {
    console.log("[PinoyMoviesHub] Link follow error:", err.message);
    return null;
  });
}

// ===== STREAM BUILDER =====

function buildStream(name, url, quality, language, displayTitle, meta) {
  var lang = inferLang(language);
  var q = parseQuality(quality + " " + language);
  var isSeries = !!(meta && meta.season);
  var isEmbed = /\.(com|top|click|win|net)\/e\//i.test(url) || /playmogo|bysesayeveum|mixdrop/i.test(url);

  var line1, line2;
  if (isSeries) {
    var epPart = meta.episodeTitle ? " - " + meta.episodeTitle : "";
    line1 = "📺 S" + meta.season + "E" + meta.episode + epPart + " | " + displayTitle;
  } else {
    line1 = "🎬 " + displayTitle;
  }

  var qIcon = (q.indexOf("2160") !== -1 || q.indexOf("4K") !== -1) ? "💎" : "📺";
  var embedLabel = isEmbed ? " | 🔗 Embed" : "";
  line2 = qIcon + " " + q + " | 🌍 " + lang + embedLabel;

  return {
    name: "PinoyMoviesHub | " + q + " | " + lang + (isEmbed ? " | Embed" : ""),
    title: line1 + "\n" + line2,
    url: url,
    quality: q,
    headers: isEmbed ? { Referer: BASE_URL } : VIDEO_HEADERS,
    provider: "pinoymovieshub",
    behaviorHints: {
      bingeGroup: "pinoymovieshub-" + q.toLowerCase()
    }
  };
}

// ===== MAIN ENTRY =====

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[PinoyMoviesHub] === START for " + mediaType + " TMDB ID:" + tmdbId + " S" + season + "E" + episode + " ===");

  var epPromise = (mediaType === "tv")
    ? getTmdbEpisodeTitle(tmdbId, season, episode)
    : Promise.resolve("");

  return epPromise.then(function(episodeTitle) {
    return getTmdbTitle(tmdbId, mediaType).then(function(title) {
      if (!title) {
        console.log("[PinoyMoviesHub] TMDB title not found");
        return [];
      }
      console.log("[PinoyMoviesHub] TMDB title: '" + title + "'");

      var slug = slugify(title);
      var pageUrl, displayTitle;

      if (mediaType === "movie") {
        displayTitle = title;
        pageUrl = BASE_URL + "/movies/" + slug + "/";
      } else {
        displayTitle = title + " S" + season + "E" + episode;
        pageUrl = BASE_URL + "/episodes/" + slug + "-" + season + "x" + episode + "/";
      }

      console.log("[PinoyMoviesHub] Fetching page:", pageUrl);

      return fetchText(pageUrl).then(function(html) {
        var meta = {
          season: season,
          episode: episode,
          episodeTitle: episodeTitle
        };

        // APPROACH 1: Use Dooplayer API (preferred)
        var players = extractPlayerData(html);
        if (players.length) {
          console.log("[PinoyMoviesHub] Using Dooplayer API approach");
          return Promise.all(players.map(function(player) {
            return callDooPlayerAPI(player).then(function(embedUrl) {
              if (!embedUrl) return null;
              return resolveEmbedUrl(embedUrl).then(function(directUrl) {
                if (!directUrl) return null;
                return buildStream(
                  "PinoyMoviesHub - API",
                  directUrl,
                  "Auto",
                  "",
                  displayTitle,
                  meta
                );
              });
            });
          })).then(function(results) {
            var streams = [];
            var i;
            for (i = 0; i < results.length; i++) {
              if (results[i]) streams.push(results[i]);
            }
            if (streams.length) {
              console.log("[PinoyMoviesHub] Returning", streams.length, "stream(s) from API");
              return streams;
            }
            // Fallback to download links
            console.log("[PinoyMoviesHub] API returned no streams, falling back to download links");
            return resolveDownloadLinks(html, meta, displayTitle);
          });
        }

        // APPROACH 2: Use download links (fallback)
        console.log("[PinoyMoviesHub] No Dooplayer data found, using download links");
        return resolveDownloadLinks(html, meta, displayTitle);
      });
    });
  }).catch(function(err) {
    console.error("[PinoyMoviesHub] error:", err.message || err);
    return [];
  });
}

function resolveDownloadLinks(html, meta, displayTitle) {
  var links = extractDownloadLinks(html);
  if (!links.length) {
    console.log("[PinoyMoviesHub] No download links found");
    return [];
  }

  return Promise.all(links.map(function(link) {
    var lowerQuality = String(link.quality || "").toLowerCase();
    var lowerLang = String(link.language || "").toLowerCase();

    if (lowerQuality === "subtitle" || lowerLang === "subtitle") {
      console.log("[PinoyMoviesHub] Skipping subtitle link");
      return Promise.resolve(null);
    }

    console.log("[PinoyMoviesHub] Processing", link.quality, "/", link.language, ":", link.url);

    return resolveInternalLink(link.url).then(function(externalUrl) {
      if (!externalUrl) return null;
      return buildStream(
        "PinoyMoviesHub - " + link.quality,
        externalUrl,
        link.quality,
        link.language,
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
    console.log("[PinoyMoviesHub] Returning", streams.length, "stream(s) from download links");
    return streams;
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
