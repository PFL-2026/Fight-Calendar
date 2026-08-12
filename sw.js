/* Shell cache-first so the app opens instantly offline.
   data.json network-first so the daily refresh always wins when online.
   Bump VERSION whenever you edit index.html. */
const VERSION = "fc-v3";
const SHELL = ["./", "./index.html", "./icon.png",
  "./logos/cagewarriors.png", "./logos/matchroom.png", "./logos/misfits.png", "./logos/mvp.png",
  "./logos/oktagon.png", "./logos/one.png", "./logos/pfl.png", "./logos/queensberry.png",
  "./logos/rizin.png", "./logos/ufc.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).catch(()=>{}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("data.json")) {                       // always try live first
    e.respondWith(fetch(request)
      .then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(request, c)); return r; })
      .catch(() => caches.match(request)));
    return;
  }
  e.respondWith(caches.match(request).then(hit => hit || fetch(request).then(r => {
    if (r && r.status === 200) { const c = r.clone(); caches.open(VERSION).then(x => x.put(request, c)); }
    return r;
  })));
});
