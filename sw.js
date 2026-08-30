/*
 * SketchAlive service worker -- app-shell cache-first, so the app (incl. the
 * three practice doodles) works fully offline after the first visit. Bump
 * CACHE_VERSION whenever index.html/core.js/icons change so clients pick up
 * the new files instead of serving stale ones from cache.
 */
"use strict";
const CACHE_VERSION = "sketchalive-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./core.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for the app shell + same-origin assets (works fully offline).
// Cross-origin requests (Google Fonts) get a stale-while-revalidate: serve
// from cache instantly if present, and refresh the cache in the background
// -- keeps the app usable offline even before fonts were ever cached, since
// the CSS already has a system-font fallback stack.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req).then((res) => { cache.put(req, res.clone()); return res; }).catch(() => cached);
          return cached || network;
        })
      )
    );
  }
});
