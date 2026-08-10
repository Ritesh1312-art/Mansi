"use strict";
// In-memory sliding-window rate limiter for Vercel serverless functions.
// Works per cold-start instance — effective first-line defence without Redis.

const windows = new Map();

/**
 * Check rate limit. Returns { allowed: boolean, retryAfter?: number }.
 * @param {string} key       Identifier (e.g. IP + route).
 * @param {number} limit     Max requests in window.
 * @param {number} windowMs  Window size in milliseconds.
 */
function rateLimit(key, limit, windowMs) {
  if (limit === undefined) limit = 20;
  if (windowMs === undefined) windowMs = 60000;
  var now = Date.now();
  var cutoff = now - windowMs;
  var prev = windows.get(key) || [];
  var recent = prev.filter(function(ts) { return ts > cutoff; });
  if (recent.length >= limit) {
    var oldest = recent[0];
    var retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, retryAfter: retryAfter };
  }
  recent.push(now);
  windows.set(key, recent);
  // Evict stale keys to prevent memory growth in long-lived instances
  if (windows.size > 5000) {
    for (var entry of windows.entries()) {
      if (entry[1].every(function(ts) { return ts <= cutoff; })) windows.delete(entry[0]);
    }
  }
  return { allowed: true };
}

/**
 * Returns a middleware function that sends 429 if rate limited.
 * Call it at the top of a Vercel handler: if (!mw(req, res)) return;
 */
function withRateLimit(options) {
  var limit = (options && options.limit) || 20;
  var windowMs = (options && options.windowMs) || 60000;
  var keyFn = options && options.keyFn;
  return function rateLimitMiddleware(req, res) {
    var ip = String(
      req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      "unknown"
    ).split(",")[0].trim();
    var key = keyFn ? keyFn(req, ip) : (ip + ":" + req.url);
    var result = rateLimit(key, limit, windowMs);
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfter || 60));
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = 429;
      res.end(JSON.stringify({
        ok: false,
        error: "Too many requests. Please slow down.",
        retryAfter: result.retryAfter
      }));
      return false;
    }
    return true;
  };
}

module.exports = { rateLimit: rateLimit, withRateLimit: withRateLimit };
