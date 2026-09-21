// Service worker: cache dell'app per l'uso offline (i dati stanno in localStorage)
// A ogni modifica di app.js/style.css: cambiare V qui sotto e i due ?v= in
// index.html. Sono TRE numeri in tutto, e in questo file uno solo.
// ⚠ Prima il numero in sw.js stava in tre punti (CACHE e i due ?v= dentro
// ASSETS) e ogni tanto restavano indietro: a v23 ASSETS diceva ancora v22, e
// il 18 set il giro di T4 ha bumpato CACHE lasciando ASSETS a v27. Un ASSETS
// vecchio non si vede online (il fetch va prima in rete) ma rompe l'OFFLINE:
// si precarica app.js?v=27 mentre la pagina chiede app.js?v=28, e senza rete
// quella richiesta non trova niente in cache. Ora ASSETS lo ricava da V.
const V = 38;
const CACHE = "trasferte-v" + V;
const ASSETS = ["./", "./index.html", `./style.css?v=${V}`, `./app.js?v=${V}`, "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // le chiamate API passano dirette
  // no-cache: il browser rivalida sempre col server (GitHub Pages manda max-age=600,
  // senza questo l'app poteva restare indietro di 10 minuti). Offline si cade sulla cache.
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
