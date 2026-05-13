/**
 * PinoyMoviesHub Nuvio Plugin - Dooplay Edition
 * Domain: pinoymovieshub.win
 * Supports: Movies & TV Shows
 * Language: Filipino / Tagalog / English
 * Author: Enhanced by AI
 * Version: 2.0.0
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

function fetchJson(url) {
  return fetch(url, { headers: HEADERS }).then(function(res) {
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

// ===== LINK RESOLUTION =====

function resolveInternalLink(linkUrl) {
  console.log('[PinoyMoviesHub] Following internal link:', linkUrl);
  return fetch(linkUrl, {
    headers: HEADERS,
    redirect: "follow"
  }).then(function(res) {
    var finalUrl = res.url || linkUrl;
    console.log('[PinoyMoviesHub] Resolved to:', finalUrl);
    if (finalUrl !== linkUrl && finalUrl.indexOf("pinoymovieshub.win") === -1) {
      return finalUrl;
    }
    // If still on the same domain, try to extract from response
    return res.text().then(function(html) {
      // Look for meta refresh or JS redirect
      var metaMatch = html.match(/content="0;\s*url=([^"]+)"/) || html.match(/content="0;url=([^"]+)"/);
      if (metaMatch) return metaMatch[1];
      var jsMatch = html.match(/window\.location\s*=\s*["']([^"']+)["']/);
      if (jsMatch) return jsMatch[1];
      return null;
    }).catch(function() { return null; });
  }).catch(function(err) {
    console.log('[PinoyMoviesHub] Link follow error:', err.message);
    return null;
  });
}

// ===== DOWNLOAD LINK EXTRACTION =====

function extractDownloadLinks(html) {
  var $ = cheerio.load(html);
  var table = $("#download .links_table table");
  if (!table.length) {
    // Fallback: try other common Dooplay selectors
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

  // Also try alternative row structures
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

  console.log('[PinoyMoviesHub] Found', links.length, 'download links');
  return links;
}

// ===== STREAM BUILDER =====

function buildStream(name, url, quality, language, displayTitle, meta) {
  var lang = inferLang(language);
  var q = parseQuality(quality + " " + language);
  var isSeries = !!(meta && meta.season);

  var line1, line2;
  if (isSeries) {
    var epPart = meta.episodeTitle ? " - " + meta.episodeTitle : "";
    line1 = '📺 S' + meta.season + 'E' + meta.episode + epPart + ' | ' + displayTitle;
  } else {
    line1 = '🎬 ' + displayTitle;
  }

  var qIcon = (q.indexOf("2160") !== -1 || q.indexOf("4K") !== -1) ? "💎" : "📺";
  line2 = qIcon + ' ' + q + ' | 🌍 ' + lang + ' | 📎 ' + quality;

  return {
    name: "PinoyMoviesHub | " + q + " | " + lang,
    title: line1 + "\n" + line2,
    url: url,
    quality: q,
    headers: VIDEO_HEADERS,
    behaviorHints: {
      bingeGroup: "pinoymovieshub-" + q.toLowerCase()
    }
  };
}

// ===== MAIN ENTRY =====

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[PinoyMoviesHub] === START for ' + mediaType + ' TMDB ID:' + tmdbId + ' S' + season + 'E' + episode + ' ===');

  var epPromise = (mediaType === "tv")
    ? getTmdbEpisodeTitle(tmdbId, season, episode)
    : Promise.resolve("");

  return epPromise.then(function(episodeTitle) {
    return getTmdbTitle(tmdbId, mediaType).then(function(title) {
      if (!title) {
        console.log('[PinoyMoviesHub] TMDB title not found');
        return [];
      }
      console.log('[PinoyMoviesHub] TMDB title: \"' + title + '\"');

      var slug = slugify(title);
      var pageUrl, displayTitle;

      if (mediaType === "movie") {
        displayTitle = title;
        pageUrl = BASE_URL + "/movies/" + slug + "/";
      } else {
        displayTitle = title + ' S' + season + 'E' + episode;
        pageUrl = BASE_URL + "/episodes/" + slug + "-" + season + "x" + episode + "/";
      }

      console.log('[PinoyMoviesHub] Fetching page:', pageUrl);

      return fetchText(pageUrl).then(function(html) {
        var links = extractDownloadLinks(html);
        if (!links.length) {
          console.log('[PinoyMoviesHub] No download links found');
          return [];
        }

        var meta = {
          season: season,
          episode: episode,
          episodeTitle: episodeTitle
        };

        // Process all links in parallel
        return Promise.all(links.map(function(link) {
          var lowerQuality = String(link.quality || "").toLowerCase();
          var lowerLang = String(link.language || "").toLowerCase();

          // Skip subtitle-only links
          if (lowerQuality === "subtitle" || lowerLang === "subtitle") {
            console.log('[PinoyMoviesHub] Skipping subtitle link');
            return Promise.resolve(null);
          }

          console.log('[PinoyMoviesHub] Processing', link.quality, '/', link.language, ':', link.url);

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
          console.log('[PinoyMoviesHub] Returning', streams.length, 'stream(s)');
          return streams;
        });
      });
    });
  }).catch(function(err) {
    console.error('[PinoyMoviesHub] error:', err.message || err);
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
