// Service worker: cache dell'app per l'uso offline (i dati stanno in localStorage)
// Bump CACHE e i ?v= in index.html insieme, a ogni modifica di app.js/style.css.
const CACHE = "trasferte-v26";
const ASSETS = ["./", "./index.html", "./style.css?v=26", "./app.js?v=26", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // le chiamate API passano dirette
  // no-cache: il browser rivalida sempre col server (GitHub Pages manda max-age=600,
  // senza questo l'app poteva restare indietro di 10 minuti). Offline si cade sulla cache.
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
