const CACHE_NAME = "mansi-shell-v4.1.0-master";
const SHELL = ["./","./index.html","./products.html","./css/style.css?v=4.1.0","./js/config.js","./js/data.js","./js/app.js","./data/catalog.json","./assets/brand/icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.includes("/api/") || url.hostname.includes("firebase") || url.hostname.includes("googleapis")) return;
  
  // Network-first for code assets (js, css, navigate) to ensure immediate release freshness
  if (request.mode === "navigate" || url.pathname.endsWith(".css") || url.pathname.endsWith(".js") || url.pathname.endsWith("/data/catalog.json")) {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => caches.match(request).then(cached => cached || caches.match("./index.html")))
    );
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && url.origin === self.location.origin) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
