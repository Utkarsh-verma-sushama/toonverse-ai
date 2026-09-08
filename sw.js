"use strict";
const CACHE_NAME = "toonverse-shell-v19";
const CORE = [
  "./","./index.html","./qa.html","./plans.html","./support.html","./utilities.html","./camera.html","./coloring.html","./multimodal.html","./memory.html","./create.html","./editor.html","./layout.html","./wallpaper.html","./library.html","./account.html","./404.html",
  "./assets/css/main.css","./assets/css/components.css","./assets/js/config.js","./assets/js/main.js",
  "./assets/js/qa-suite.js","./assets/js/monetization-growth.js","./assets/js/support-community.js","./assets/js/utility-hub.js","./assets/js/camera-intelligence.js","./assets/js/coloring-studio.js","./assets/js/multimodal.js","./assets/js/memory-studio.js","./assets/js/project-store.js","./assets/js/cloud-sync.js","./assets/js/auth.js","./assets/js/ai-runtime.js","./assets/js/ai-capabilities.js",
  "./manifest.webmanifest","./assets/toonverse-icon.svg"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
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
  if (url.origin !== self.location.origin) return;
  const networkFirst = request.mode === "navigate" || /\.(?:html|js|css|webmanifest)$/.test(url.pathname);
  if (networkFirst) {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(async () => (await caches.match(request)) || (request.mode === "navigate" ? caches.match("./index.html") : Response.error()))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }))
  );
});
