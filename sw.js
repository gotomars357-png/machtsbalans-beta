// Service worker: het spel draait offline na één bezoek met verbinding.
// Netwerk eerst (zo krijg je altijd de nieuwste versie), cache als terugval.
// tools/build-beta.mjs vervangt CACHE door een versie per build en SCHIL door alle bestanden van het spel.
const CACHE = 'machtsbalans-63d5260-20261122-121719';
const SCHIL = ["./","css/bewaren.css","css/bouwkaart.css","css/bouwlade.css","css/evenwicht.css","css/gebieden.css","css/geluid.css","css/leren.css","css/levend.css","css/style.css","css/wijzer.css","icons/icoon-192.png","icons/icoon-512-maskable.png","icons/icoon-512.png","icons/icoon.svg","index.html","manifest.webmanifest","packs/drie-zeeen/actions/acties.json","packs/drie-zeeen/actors/blokken.json","packs/drie-zeeen/actors/doctrines.json","packs/drie-zeeen/actors/landen.json","packs/drie-zeeen/actors/persoonlijkheden.json","packs/drie-zeeen/actors/regimes.json","packs/drie-zeeen/actors/rivalen.json","packs/drie-zeeen/economy/gebouwen.json","packs/drie-zeeen/economy/model.json","packs/drie-zeeen/economy/resources.json","packs/drie-zeeen/economy/schokken.json","packs/drie-zeeen/events/brandhaarden.json","packs/drie-zeeen/events/events.json","packs/drie-zeeen/map/kaart.json","packs/drie-zeeen/military/eenheden.json","packs/drie-zeeen/pack.json","packs/drie-zeeen/story/krant.json","packs/drie-zeeen/story/tutorial.json","packs/drie-zeeen/story/verhaal.json","packs/index.json","packs/koude-front/actions/acties.json","packs/koude-front/actors/blokken.json","packs/koude-front/actors/landen.json","packs/koude-front/economy/gebouwen.json","packs/koude-front/economy/model.json","packs/koude-front/economy/resources.json","packs/koude-front/events/brandhaarden.json","packs/koude-front/events/events.json","packs/koude-front/map/kaart.json","packs/koude-front/military/eenheden.json","packs/koude-front/pack.json","packs/koude-front/story/krant.json","packs/koude-front/story/verhaal.json","packs/minimaal/map/kaart.json","packs/minimaal/pack.json","src/engine/ai.js","src/engine/brandhaarden.js","src/engine/contracten.js","src/engine/cyber.js","src/engine/defaults.js","src/engine/events.js","src/engine/gebieden.js","src/engine/geografie.js","src/engine/leger.js","src/engine/media.js","src/engine/packloader.js","src/engine/regimes.js","src/engine/rng.js","src/engine/samenleving.js","src/engine/sim.js","src/engine/validate.js","src/engine/verbouw.js","src/ui/bakbudget.js","src/ui/bewaren.js","src/ui/bouwfeedback.js","src/ui/bouwlade.js","src/ui/brandhaard.js","src/ui/camera.js","src/ui/chart.js","src/ui/cyber.js","src/ui/detail.js","src/ui/dilemma.js","src/ui/doelen.js","src/ui/einde.js","src/ui/evenwicht.js","src/ui/gebieden.js","src/ui/geluid.js","src/ui/geluidstart.js","src/ui/grens.js","src/ui/hemel.js","src/ui/huis.js","src/ui/infra.js","src/ui/krant.js","src/ui/kust.js","src/ui/leren.js","src/ui/leven.js","src/ui/main.js","src/ui/map.js","src/ui/natuur.js","src/ui/onderpaneel.js","src/ui/onrustrook.js","src/ui/oplevering.js","src/ui/ordersignaal.js","src/ui/pings.js","src/ui/ritten.js","src/ui/score.js","src/ui/seizoen.js","src/ui/sfeer.js","src/ui/sloopplaats.js","src/ui/stad.js","src/ui/straatstand.js","src/ui/tekeningen.js","src/ui/terrein.js","src/ui/treinkaart.js","src/ui/troepen.js","src/ui/uitdaging.js","src/ui/verbouwpaneel.js","src/ui/verkeerblok.js","src/ui/voertuigkaart.js","src/ui/wegennet.js","src/ui/werk.js","src/ui/wijzer.js","src/ui/zee.js"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SCHIL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Opnieuw valideren bij de server, zodat een HTTP-cache (GitHub Pages: 10 min) geen oude versie geeft.
  e.respondWith(fetch(req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' })).then((res) => {
    if (res.status === 200) { const kopie = res.clone(); caches.open(CACHE).then((c) => c.put(req, kopie)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r ?? (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
