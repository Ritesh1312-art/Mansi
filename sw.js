// Service Worker v4.3.0 — Network-first for code, cache-first for images
// Cache name includes version so it auto-invalidates on each release.
const CACHE_VERSION = "4.3.2";
const CACHE_NAME = "mansi-shell-v" + CACHE_VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./products.html",
  "./offline.html",
  "./css/style.css",
  "./js/config.js",
  "./js/data.js",
  "./js/app.js",
  "./js/vendor/firebase-app-compat.js",
  "./js/vendor/firebase-auth-compat.js",
  "./js/vendor/firebase-firestore-compat.js",
  "./data/catalog.json",
  "./assets/brand/icon.svg"
];

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(SHELL); })
      .catch(function() {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(
          keys
            .filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
        );
      })
      .then(function() { return self.clients.claim(); })
      .then(function() {
        // Notify all open tabs that a new version is active
        return self.clients.matchAll({ includeUncontrolled: true }).then(function(clients) {
          clients.forEach(function(client) {
            client.postMessage({ type: "NEW_VERSION_AVAILABLE", version: CACHE_VERSION });
          });
        });
      })
  );
});

// Handle SKIP_WAITING message from the app
self.addEventListener("message", function(event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", function(event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);

  // Cross-origin assets (including Vercel Blob product images) must be fetched
  // directly by the browser. Intercepting opaque responses here can turn a
  // healthy image response into net::ERR_FAILED in Chromium.
  if (url.origin !== self.location.origin) return;

  // Never intercept API calls, Firebase, or external services
  if (
    url.pathname.includes("/api/") ||
    url.hostname.includes("firebase") ||
    url.hostname.includes("googleapis") ||
    url.hostname.includes("telegram") ||
    url.hostname.includes("omnidimension") ||
    url.hostname.includes("resend")
  ) return;

  // Cache-first for product images (they rarely change)
  if (url.pathname.startsWith("/assets/products/")) {
    event.respondWith(
      caches.match(request).then(function(cached) {
        if (cached) return cached;
        return fetch(request).then(function(response) {
          if (response.ok) {
            caches.open(CACHE_NAME).then(function(cache) { cache.put(request, response.clone()); });
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first for HTML, JS, CSS, JSON (ensures release freshness)
  if (
    request.mode === "navigate" ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".json")
  ) {
    event.respondWith(
      fetch(request)
        .then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
          }
          return response;
        })
        .catch(function() {
          return caches.match(request).then(function(cached) {
            return cached || caches.match("./offline.html");
          });
        })
    );
    return;
  }

  // Cache-first for everything else (images, fonts, icons)
  event.respondWith(
    caches.match(request).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (response.ok && url.origin === self.location.origin) {
          caches.open(CACHE_NAME).then(function(cache) { cache.put(request, response.clone()); });
        }
        return response;
      });
    })
  );
});
