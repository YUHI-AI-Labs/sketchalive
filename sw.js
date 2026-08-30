/*
 * SketchAlive service worker -- app-shell cached so the app (incl. the
 * three practice doodles) works fully offline after the first visit.
 *
 * index.html/core.js are fetched NETWORK-FIRST (falling back to cache only
 * when the network fails), not cache-first: this app is under active
 * development, and a pure cache-first shell meant anyone who'd visited once
 * kept getting silently served an old index.html forever after -- e.g. a
 * newly-added UI button just never appearing -- with no obvious way to
 * notice why. Static assets (icons/manifest) stay cache-first since they
 * rarely change and there's no harm in it.
 */
"use strict";
const CACHE_VERSION = "sketchalive-v2";
const NETWORK_FIRST = ["/index.html", "/core.js", "/"];
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
    const isNetworkFirst = NETWORK_FIRST.includes(url.pathname);
    if (isNetworkFirst) {
      event.respondWith(
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        }).catch(() => caches.match(req))
      );
      return;
    }
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
