// Terrein bij inzoomen (P1 van docs/inzoom-spec.md): land ziet eruit als land.
// Vanaf zoom 2,2 legt deze laag een gebakken ondergrond over de strategische kaart: gras, bos, rots, zand en akkers
// die organisch in elkaar overlopen, reliëf met licht uit het noordwesten, sneeuw op de toppen, een zandstrook langs
// de kust, water dat dieper donkerder wordt, golfglinsteringen en schuim dat aanrolt. Grenzen zijn scherpe lijnen.
//
// Opbouw:
// - maakBasis: per wereld één keer een afstandsveld land/water (chamfer), zodat kust en diepte overal kloppen.
// - bakGrondData: puur en testbaar; per brok van 64x64 wereldeenheden een rooster van 68x68 monsters
//   (1 per eenheid, 2 marge) met terreingewichten, hoogte, schaduw en kleur.
// - kenmerkenVoorTegel: bomen, rotsen, akkers, kiezels per vakje, vast per vakje (zelfde bij bakken en scherp tekenen).
// - TerreinLaag: bakt brokken naar canvassen (LRU, maximaal 1 per frame) en tekent ze elke frame met bewegend water.
//
// Alles is eigen code; geen externe beelden. Plaatsing hangt alleen af van een hash van vakje, brok en index;
// de tijd stuurt alleen beweging (golven, schuim, wiegende bomen). Deze module schrijft nooit in state.
//
// Terrein plus (meer detail bij diep inzoomen):
// - maakWater: rivieren uit het hoogteveld (priority flood naar zee, stroomopwaarts opgeteld regenwater), met
//   meanders, een trechter of delta aan de kust, en meren in kommen. Eenmalig per wereld, puur decor.
// - Moerassen, duinen met helm, kliffen langs hoge kusten, puin aan de bergvoet, rotspartijen in het gras.
// - Akkers als percelen met gewasrijen, boomgaarden, wijngaarden, kassen, weiden; heggen, muurtjes, sloten en
//   zandpaden; boerderijen met huis, schuur en silo; strobalen in de oogsttijd.
// - Seizoenen via seizoen(dag) in stappen van 12 dagen (de brokken bakken dan opnieuw, één per frame):
//   vlekkerige sneeuw, herfstbos, kale bomen, bloesem, rijp graan, bevroren meren.
// - Wind (wind(dag)): golven over het graan, gras en bomen buigen mee; glinsteringen drijven stroomafwaarts.
// - Vanaf zoom 9,5 kleine dingen: bloemen, paddenstoelen, waterlelies, steentjes, molshopen, kringen op plassen.

import { seizoen, wind } from './seizoen.js';

const W = 1000, H = 620;
const CH = 64; // brok in wereldeenheden (4x4 vakjes)
const MARGE = 2; // monsters marge rond een brok, zodat randen naadloos aansluiten
const N = CH + MARGE * 2; // 68 monsters per zijde
const M = 3; // maskers (water, schuim) per wereldeenheid
const MN = N * M; // 204
const OR = 2; // eigenaarmonsters per wereldeenheid
const RM = 4; // marge van het eigenaarrooster in monsters: gladgestreken grenzen sluiten zo precies aan op de buurbrok
const ON = CH * OR + 2 * RM; // 136
const LODS = [3, 6, 12]; // pixels per wereldeenheid in een gebakken brok
const MAX_CANVASSEN = 40;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_PRIMITIEVEN = 1500; // scherpe kenmerken per frame
const PATROON_SPAN = CH / 6; // wereldeenheden per herhaling van een detailpatroon; 6 passen precies in een brok

// Terreinsoorten in de gewichten.
const GRAS = 0, BOS = 1, BERG = 2, ZAND = 3, AKKER = 4;
const SOORTEN = 5;

// Kenmerktypen; per kenmerk 6 getallen: [type, x, y, r, variant, extra], x en y vanaf het midden van het vakje.
const STAP = 6;
const BOOM = 1, LOSBOOM = 2, ROTS = 3, GRUIS = 4, PLUK = 5, PERCEEL = 6, KIEZEL = 7, DRIJFHOUT = 8;
const RIET = 9, PLAS = 10, BOERDERIJ = 11, STEEN = 12, HELM = 13, BAAL = 14;
const TYPES = 15;
// Perceelsoorten (variant & 15); bit 16 = rijen dwars, (variant >> 5) = randsoort.
const GRAAN = 0, GROEN = 1, PLOEG = 2, KOOLZAAD = 3, WEI = 4, BOOMGAARD = 5, WIJN = 6, KAS = 7, MAIS = 8, BRAAK = 9;
const PSOORTEN = 10;
const HAAGRAND = 0, MUUR = 1, SLOOT = 2, ZANDPAD = 3;

// Rivieren
const RG = 4; // wereldeenheden per cel van het afwateringsrooster
const RGW = W / RG, RGH = Math.ceil(H / RG);
const RIVIER_MIN = 95; // opgeteld regenwater waarboven een cel een rivier is
const MEER_D = 0.008; // minimale diepte van een kom voor een meer
const VER = 12; // waarde van de waterafstandsvelden ver van rivier of meer
const MAX_MICRO = 520; // kleine dingen per frame vanaf zoom 9,5
const MAX_STUKKEN = 70; // rivierstukken per frame in de scherpe laag
const MAX_BANDEN = 260; // windbanden over gewas per frame
const SEIZOEN_STAP = 12; // dagen per seizoensstap (de brokken bakken dan opnieuw)

// ---------- hulpjes (eigen kopie, zie spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
// mulberry32, zoals rnd in detail.js
function rnd(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const meng = (a, b, t, uit) => { uit[0] = a[0] + (b[0] - a[0]) * t; uit[1] = a[1] + (b[1] - a[1]) * t; uit[2] = a[2] + (b[2] - a[2]) * t; return uit; };

// Geen document bij importeren: de canvasfabriek is pas nodig bij laad() en is te vervangen in tests.
let fabriek = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
export function zetCanvasFabriek(fn) { fabriek = fn; }
const maakBeeld = (data, w, h) => (typeof ImageData !== 'undefined' ? new ImageData(data, w, h) : { data, width: w, height: h });

// ---------- kleuren ----------

const K = {
  gras: hex('#6f8f4a'), grasLicht: hex('#7d9a52'), grasDonker: hex('#5f7f40'), grasDroog: hex('#9a9a5a'),
  bos: hex('#2f4a2a'),
  // rots iets warmer dan neutraal grijs, zodat bergen niet op de grijze kleur van zwevende landen lijken
  rots: hex('#7a6b58'), rotsDonker: hex('#564a3e'), rotsLicht: hex('#9c8a70'), sneeuw: hex('#eef0f2'),
  zand: hex('#d8c896'), zandNat: hex('#b8a878'),
  akker: hex('#8c9656'),
  ondiep: hex('#3a9aa5'), midden: hex('#23677f'), diep: hex('#123a56'),
  moeras: hex('#56623a'), veen: hex('#5e5236'), duin: hex('#ddd0a2'), helm: hex('#a9a66c'),
  oeverGroen: hex('#5a8c44'), modder: hex('#6f6648'), meerOndiep: hex('#4d8780'), meerDiep: hex('#2a5a6c'),
  grasWinter: hex('#7d7f62'), grasLente: hex('#76a648'), bosHerfst: hex('#7d5a2a'), bosWinter: hex('#4a4a3c'), ijs: hex('#c6d8de'),
};

// ---------- basis per wereld ----------

const basisCache = new WeakMap();

// Afstandsveld en akkers voor een wereld. `eigenaar` is het statische eigenaarbeeld per pixel van de kaart
// (view.eigenaar); zonder dat rekent de basis het zelf uit, wat in tests gebeurt.
export function maakBasis(geo, eigenaar = null, opties = {}) {
  if (!opties.vers && basisCache.has(geo)) return basisCache.get(geo);
  let eig = eigenaar;
  if (!eig) {
    eig = new Int16Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) eig[y * W + x] = geo.eigenaarOp(x + 0.5, y + 0.5);
  }
  // Twee-pass chamfer: afstand tot water voor land en tot land voor water, in wereldeenheden.
  const naarWater = new Float32Array(W * H), naarLand = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const nat = eig[i] === -1;
    naarWater[i] = nat ? 0 : 1e9;
    naarLand[i] = nat ? 1e9 : 0;
  }
  chamfer(naarWater, W, H);
  chamfer(naarLand, W, H);
  // Getekende afstand tot de kustlijn (die halverwege twee monsters ligt): positief op water, negatief op land.
  const sd = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) sd[i] = eig[i] === -1 ? Math.min(40, naarLand[i]) - 0.5 : -(Math.min(40, naarWater[i]) - 0.5);
  // Het pixelbeeld geeft een trapjeskust; twee keer een 3x3-vervaging maakt er een vloeiende lijn van.
  vervaag(sd, naarWater, W, H);
  vervaag(sd, naarWater, W, H);
  // Akker op vlakte-vakjes met een eigenaar; vast per vakje.
  const akker = new Uint8Array(geo.tegels.length);
  for (const t of geo.tegels) akker[t.i] = t.terrein === 'vlakte' && t.eig >= 0 && hash(t.i, 3) < 0.45 ? 1 : 0;
  const basis = { geo, eigenaar: eig, sd, akker, kenmerken: new Array(geo.tegels.length), kosten: new Float32Array(geo.tegels.length).fill(-1), grond: [] };
  basis.water = maakWater(basis);
  maakVlaggen(basis);
  if (!opties.vers) basisCache.set(geo, basis);
  return basis;
}

// ---------- rivieren en meren (eenmalig per wereld) ----------

// Hoogte van de vakjes, bilineair tussen de middens.
function tegelHoogte(geo, x, y) {
  const u = Math.min(geo.kol - 1.001, Math.max(0, x / geo.T - 0.5)), v = Math.min(geo.rij - 1.001, Math.max(0, y / geo.T - 0.5));
  const k = Math.floor(u), r = Math.floor(v), fu = u - k, fv = v - r, t = geo.tegels, i = r * geo.kol + k;
  const a = t[i].hoogte + (t[i + 1].hoogte - t[i].hoogte) * fu;
  const c = t[i + geo.kol].hoogte + (t[i + geo.kol + 1].hoogte - t[i + geo.kol].hoogte) * fu;
  return a + (c - a) * fv;
}

// Binaire hoop op (sleutel, index); gelijke sleutels op index, zodat de volgorde vastligt.
class Hoop {
  constructor(n) { this.k = new Float64Array(n); this.v = new Int32Array(n); this.n = 0; }
  lager(i, j) { return this.k[i] < this.k[j] || (this.k[i] === this.k[j] && this.v[i] < this.v[j]); }
  wissel(i, j) { const k = this.k[i], v = this.v[i]; this.k[i] = this.k[j]; this.v[i] = this.v[j]; this.k[j] = k; this.v[j] = v; }
  push(k, v) {
    let i = this.n++;
    this.k[i] = k; this.v[i] = v;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.lager(i, p)) break; this.wissel(i, p); i = p; }
  }
  pop() {
    const v = this.v[0];
    this.n -= 1;
    if (this.n > 0) {
      this.k[0] = this.k[this.n]; this.v[0] = this.v[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.lager(l, m)) m = l;
        if (r < this.n && this.lager(r, m)) m = r;
        if (m === i) break;
        this.wissel(i, m); i = m;
      }
    }
    return v;
  }
}

// Chaikin met extra kenmerken per punt (dim getallen per punt); eindpunten blijven staan.
function chaikin(p, dim, keer) {
  for (let it = 0; it < keer; it++) {
    const n = p.length / dim;
    if (n < 3) return p;
    const uit = p.slice(0, dim);
    for (let i = 0; i < n - 1; i++) {
      for (const f of [0.25, 0.75]) for (let d = 0; d < dim; d++) uit.push(p[i * dim + d] + (p[(i + 1) * dim + d] - p[i * dim + d]) * f);
    }
    for (let d = 0; d < dim; d++) uit.push(p[(n - 1) * dim + d]);
    p = uit;
  }
  return p;
}

// Herbemonsteren op vaste stap langs de lijn; kenmerken lineair mee.
function herbemonster(p, dim, stap) {
  const n = p.length / dim, uit = p.slice(0, dim);
  let rest = stap;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * dim], ay = p[i * dim + 1], bx = p[(i + 1) * dim], by = p[(i + 1) * dim + 1];
    const l = Math.hypot(bx - ax, by - ay);
    let s = rest;
    while (s < l) {
      const f = s / l;
      for (let d = 0; d < dim; d++) uit.push(p[i * dim + d] + (p[(i + 1) * dim + d] - p[i * dim + d]) * f);
      s += stap;
    }
    rest = s - l;
  }
  const lx = uit[uit.length - dim], ly = uit[uit.length - dim + 1];
  if (Math.hypot(p[(n - 1) * dim] - lx, p[(n - 1) * dim + 1] - ly) > stap * 0.3) for (let d = 0; d < dim; d++) uit.push(p[(n - 1) * dim + d]);
  return uit;
}

// Waterafstandsveld op een punt (bilineair tussen de pixelmiddens); ver weg geeft VER.
function veldOp(v, x, y) {
  const fx = x - 0.5, fy = y - 0.5;
  if (fx < 0 || fy < 0 || fx > W - 1 || fy > H - 1) return VER;
  const ix = Math.min(W - 2, Math.floor(fx)), iy = Math.min(H - 2, Math.floor(fy));
  const tx = fx - ix, ty = fy - iy, i = iy * W + ix;
  const a = v[i] + (v[i + 1] - v[i]) * tx, c = v[i + W] + (v[i + W + 1] - v[i + W]) * tx;
  return a + (c - a) * ty;
}
// Afstand tot de rand van zoet water (rivier of meer); negatief in het water.
const zoetOp = (b, x, y) => Math.min(veldOp(b.water.rivier, x, y), veldOp(b.water.meer, x, y));

// Afwatering: elke landcel stroomt via de laagste route naar zee (priority flood, Barnes e.a.). Waar de
// gevulde hoogte boven de echte ligt, is een kom: daar komen meren. Regen valt vooral in de bergen, dus
// rivieren ontspringen daar. Uitkomst: rivieren als polylijnen in wereldcoördinaten met breedte per punt.
export function maakWater(b) {
  const geo = b.geo, ruis = geo.ruis, n = RGW * RGH;
  const h = new Float32Array(n), th = new Float32Array(n), zee = new Uint8Array(n), regen = new Float32Array(n);
  for (let j = 0; j < RGH; j++) {
    for (let i = 0; i < RGW; i++) {
      const c = j * RGW + i, x = (i + 0.5) * RG, y = Math.min(H - 0.5, (j + 0.5) * RG);
      zee[c] = isWater(b, x, y) ? 1 : 0;
      const t = tegelHoogte(geo, x, y);
      th[c] = t;
      h[c] = t + 0.05 * (ruis(x * 0.03 + 17, y * 0.03 + 29) - 0.5) + 0.02 * (ruis(x * 0.1 + 3, y * 0.1 + 5) - 0.5);
      regen[c] = 0.3 + 1.7 * smooth(0.5, 0.75, t);
    }
  }
  const DI = [-1, 0, 1, -1, 1, -1, 0, 1], DJ = [-1, -1, -1, 0, 0, 1, 1, 1];
  const F = new Float32Array(n), rcv = new Int32Array(n).fill(-1), gezien = new Uint8Array(n), volg = new Int32Array(n);
  const hoop = new Hoop(n);
  let nv = 0;
  for (let c = 0; c < n; c++) {
    if (!zee[c]) continue;
    gezien[c] = 1; F[c] = -1;
    const ci = c % RGW, cj = (c - ci) / RGW;
    for (let q = 0; q < 8; q++) {
      const ni = ci + DI[q], nj = cj + DJ[q];
      if (ni >= 0 && nj >= 0 && ni < RGW && nj < RGH && !zee[nj * RGW + ni]) { hoop.push(-1, c); break; }
    }
  }
  while (hoop.n) {
    const c = hoop.pop(), fc = F[c], ci = c % RGW, cj = (c - ci) / RGW;
    for (let q = 0; q < 8; q++) {
      const ni = ci + DI[q], nj = cj + DJ[q];
      if (ni < 0 || nj < 0 || ni >= RGW || nj >= RGH) continue;
      const nb = nj * RGW + ni;
      if (gezien[nb]) continue;
      gezien[nb] = 1;
      F[nb] = Math.max(h[nb], fc + 1e-5);
      rcv[nb] = c;
      volg[nv++] = nb;
      // in een gevulde kom is alles even hoog; zonder hulp loopt het water er dan kaarsrecht doorheen.
      // Een trage ruis in de volgorde laat het door de laagste plooien van de kom slingeren.
      const vlak = h[nb] <= fc + 1e-5;
      hoop.push(F[nb] + (vlak ? 0.03 * ruis((ni + 0.5) * RG * 0.05 + 131, (nj + 0.5) * RG * 0.05 + 57) : 0), nb);
    }
  }
  // regen stroomafwaarts optellen: de volgorde van vullen is een topologische volgorde vanaf zee
  const acc = new Float32Array(n);
  for (let c = 0; c < n; c++) acc[c] = zee[c] ? 0 : regen[c];
  for (let q = nv - 1; q >= 0; q--) { const c = volg[q], r = rcv[c]; if (r >= 0 && !zee[r]) acc[r] += acc[c]; }

  // ---- meren: kommen met genoeg diepte en oppervlak, niet bij een hoofdstad ----
  const stad = new Uint8Array(geo.tegels.length);
  for (const hi of geo.hoofdstad) {
    if (hi == null || hi < 0) continue;
    const t = geo.tegels[hi];
    for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
      const k = t.k + dk, r = t.r + dr;
      if (k >= 0 && r >= 0 && k < geo.kol && r < geo.rij) stad[r * geo.kol + k] = 1;
    }
  }
  const tegelVanCel = (c) => { const ci = c % RGW, cj = (c - ci) / RGW; return Math.min(geo.rij - 1, Math.floor(((cj + 0.5) * RG) / geo.T)) * geo.kol + Math.min(geo.kol - 1, Math.floor(((ci + 0.5) * RG) / geo.T)); };
  const label = new Int32Array(n).fill(-1), groepen = [];
  for (let c = 0; c < n; c++) {
    if (zee[c] || label[c] >= 0 || F[c] - h[c] <= MEER_D) continue;
    const cellen = [c];
    label[c] = groepen.length;
    let diepst = 0, bijStad = false;
    for (let q = 0; q < cellen.length; q++) {
      const d = cellen[q], di = d % RGW, dj = (d - di) / RGW;
      diepst = Math.max(diepst, F[d] - h[d]);
      if (stad[tegelVanCel(d)]) bijStad = true;
      for (const [ei, ej] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = di + ei, nj = dj + ej;
        if (ni < 0 || nj < 0 || ni >= RGW || nj >= RGH) continue;
        const nb = nj * RGW + ni;
        if (zee[nb] || label[nb] >= 0 || F[nb] - h[nb] <= MEER_D) continue;
        label[nb] = groepen.length;
        cellen.push(nb);
      }
    }
    groepen.push({ cellen, diepst, bijStad });
  }
  const gekozen = groepen.filter((g) => g.cellen.length >= 4 && g.cellen.length <= 170 && g.diepst > 0.014 && !g.bijStad)
    .sort((a, c) => c.cellen.length - a.cellen.length || a.cellen[0] - c.cellen[0]).slice(0, 11);
  const meerCel = new Uint8Array(n);
  const meren = [];
  for (const g of gekozen) {
    let sx = 0, sy = 0;
    for (const c of g.cellen) { meerCel[c] = 1; const ci = c % RGW; sx += (ci + 0.5) * RG; sy += ((c - ci) / RGW + 0.5) * RG; }
    meren.push({ x: sx / g.cellen.length, y: sy / g.cellen.length, r: Math.sqrt(g.cellen.length / Math.PI) * RG, cellen: g.cellen });
  }

  // ---- rivieren: van de monding stroomopwaarts, de grootste zijtak loopt door als hoofdstroom ----
  const isR = new Uint8Array(n);
  for (let c = 0; c < n; c++) isR[c] = !zee[c] && rcv[c] >= 0 && acc[c] >= RIVIER_MIN ? 1 : 0;
  const tel = new Int32Array(n + 1);
  for (let c = 0; c < n; c++) if (isR[c] && isR[rcv[c]]) tel[rcv[c] + 1] += 1;
  for (let c = 0; c < n; c++) tel[c + 1] += tel[c];
  const kind = new Int32Array(tel[n]), pos = tel.slice(0, n);
  for (let c = 0; c < n; c++) if (isR[c] && isR[rcv[c]]) kind[pos[rcv[c]]++] = c;
  const mondingen = [];
  for (let c = 0; c < n; c++) if (isR[c] && zee[rcv[c]]) mondingen.push(c);
  mondingen.sort((a, c) => acc[c] - acc[a] || a - c);
  const rivieren = [];
  const wachtrij = [];
  const celX = (c) => ((c % RGW) + 0.5) * RG, celY = (c) => (Math.floor(c / RGW) + 0.5) * RG;
  const breedte = (a) => Math.min(4.6, 0.5 + 0.105 * Math.sqrt(a));
  const volgLoop = (start, eind, ouder, naarZee) => {
    const cellen = [];
    let cur = start, zijtak = false;
    for (;;) {
      cellen.push(cur);
      let beste = -1;
      for (let q = tel[cur]; q < tel[cur + 1]; q++) {
        const k = kind[q];
        if (beste < 0 || acc[k] > acc[beste] || (acc[k] === acc[beste] && k < beste)) beste = k;
      }
      for (let q = tel[cur]; q < tel[cur + 1]; q++) if (kind[q] !== beste) { wachtrij.push([kind[q], cur, rivieren.length]); zijtak = true; }
      if (beste < 0) break;
      cur = beste;
    }
    cellen.reverse(); // bron eerst
    // Een stompje met zijtakken blijft staan: de zijtakken verwijzen naar dit nummer als hun hoofdstroom.
    // Zonder dat zou een zijtak de volgende rivier als ouder krijgen en midden op het land ophouden.
    if (cellen.length < 3 && !zijtak) return;
    // [x, y, breedte, vakjeshoogte] per punt; het laatste punt ligt in zee of op de hoofdstroom
    const p = [];
    for (const c of cellen) p.push(celX(c), celY(c), breedte(acc[c]), th[c]);
    const l = cellen[cellen.length - 1];
    p.push(celX(eind), celY(eind), breedte(acc[l]), th[l]);
    maakRivier(b, p, ouder, naarZee, rivieren);
  };
  for (const m of mondingen) volgLoop(m, rcv[m], -1, true);
  for (let q = 0; q < wachtrij.length; q++) { const [s, e, o] = wachtrij[q]; volgLoop(s, e, o, false); }

  // ---- velden: afstand tot de rivierrand en tot de meeroever, op 1 eenheid ----
  const rivier = new Float32Array(W * H).fill(VER), meer = new Float32Array(W * H).fill(VER);
  for (const rv of rivieren) {
    const p = rv.pts, br = rv.br;
    for (let i = 0; i < br.length - 1; i++) {
      const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[i * 2 + 2], by = p[i * 2 + 3];
      const h0 = br[i] / 2, h1 = br[i + 1] / 2, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - 7)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + 7));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - 7)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + 7));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const cx = x + 0.5, cy = y + 0.5;
          const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / l2));
          const d = Math.hypot(cx - ax - dx * t, cy - ay - dy * t) - (h0 + (h1 - h0) * t);
          const q = y * W + x;
          if (d < rivier[q]) rivier[q] = d;
        }
      }
    }
  }
  for (const m of meren) {
    let i0 = RGW, i1 = 0, j0 = RGH, j1 = 0;
    for (const c of m.cellen) { const ci = c % RGW, cj = (c - ci) / RGW; i0 = Math.min(i0, ci); i1 = Math.max(i1, ci); j0 = Math.min(j0, cj); j1 = Math.max(j1, cj); }
    const x0 = Math.max(0, (i0 - 2) * RG), x1 = Math.min(W - 1, (i1 + 3) * RG), y0 = Math.max(0, (j0 - 2) * RG), y1 = Math.min(H - 1, (j1 + 3) * RG);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const u = (x + 0.5) / RG - 0.5, v = (y + 0.5) / RG - 0.5;
        const ui = Math.max(0, Math.min(RGW - 2, Math.floor(u))), vj = Math.max(0, Math.min(RGH - 2, Math.floor(v)));
        const fu = Math.max(0, Math.min(1, u - ui)), fv = Math.max(0, Math.min(1, v - vj)), c = vj * RGW + ui;
        const a = meerCel[c] + (meerCel[c + 1] - meerCel[c]) * fu, e = meerCel[c + RGW] + (meerCel[c + RGW + 1] - meerCel[c + RGW]) * fu;
        const L = a + (e - a) * fv + (ruis(x * 0.12 + 5, y * 0.12 + 9) - 0.5) * 0.3;
        let d = (0.5 - L) * 7;
        if (b.sd[y * W + x] > -1) d = Math.max(d, 1); // een meer loopt niet in zee over
        const q = y * W + x;
        if (d < meer[q]) meer[q] = d;
      }
    }
  }

  // ---- open: punten op het droge, met de halve breedte (plus afronding) als marge tot zee en meer ----
  // Alleen open stukken komen in de scherpe laag. In zee en in een meer ligt de gebakken rivier al onder het water;
  // scherp eroverheen getekend gaf een rivierband dwars over het meer en een klodder in de monding.
  // Het meerveld loopt 7 per 4 eenheden op (1,75 per eenheid), met wat ruis: vandaar de ruimere marge daar.
  for (const rv of rivieren) {
    const m = rv.br.length;
    rv.open = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
      const x = rv.pts[i * 2], y = rv.pts[i * 2 + 1], hw = (rv.br[i] + 0.3) / 2;
      rv.open[i] = sdOp(b, x, y) < -(hw + 0.35) && veldOp(meer, x, y) > 1.75 * (hw + 0.6) ? 1 : 0;
    }
  }

  // ---- tekenstukken: runs met (bijna) gelijke breedte, per brok in een bakje ----
  const stukken = [];
  const kolC = Math.ceil(W / CH), rijC = Math.ceil(H / CH);
  const perBrok = Array.from({ length: kolC * rijC }, () => []);
  for (let ri = 0; ri < rivieren.length; ri++) {
    const rv = rivieren[ri], br = rv.br, np = br.length;
    let a = 0;
    while (a < np - 1) {
      const q = Math.round(br[a] / 0.2), op = rv.open[a];
      let e = a + 1;
      while (e < np - 1 && e - a < 20 && Math.round(br[e] / 0.2) === q && (rv.snel[e] > 0.5) === (rv.snel[a] > 0.5) && rv.open[e] === op) e++;
      // een open stuk houdt op bij zijn laatste open punt, zodat het nergens het water in steekt
      if (op && !rv.open[e] && e - 1 > a) e--;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, w = 0;
      for (let i = a; i <= e; i++) {
        x0 = Math.min(x0, rv.pts[i * 2]); x1 = Math.max(x1, rv.pts[i * 2]); y0 = Math.min(y0, rv.pts[i * 2 + 1]); y1 = Math.max(y1, rv.pts[i * 2 + 1]);
        w = Math.max(w, br[i]);
      }
      const st = { r: ri, a, e, w, snel: rv.snel[a] > 0.5, open: op === 1 && rv.open[e] === 1, x0: x0 - w, y0: y0 - w, x1: x1 + w, y1: y1 + w };
      const si = stukken.length;
      stukken.push(st);
      for (let cr = Math.max(0, Math.floor((st.y0 - 1) / CH)); cr <= Math.min(rijC - 1, Math.floor((st.y1 + 1) / CH)); cr++) {
        for (let ck = Math.max(0, Math.floor((st.x0 - 1) / CH)); ck <= Math.min(kolC - 1, Math.floor((st.x1 + 1) / CH)); ck++) perBrok[cr * kolC + ck].push(si);
      }
      a = e;
    }
  }
  return { rivieren, meren, rivier, meer, stukken, perBrok, gezien: new Int32Array(stukken.length) };
}

// Van ruwe cellijn naar rivier: gladstrijken, herbemonsteren, meanders, trechter of delta aan zee.
function maakRivier(b, p, ouder, naarZee, rivieren) {
  const ruis = b.geo.ruis, id = rivieren.length;
  p = chaikin(p, 4, 3);
  p = herbemonster(p, 4, 0.7);
  const n = p.length / 4;
  const s = new Float32Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(p[i * 4] - p[i * 4 - 4], p[i * 4 + 1] - p[i * 4 - 3]);
  const L = s[n - 1];
  const fase = hash(id, 77) * Math.PI * 2;
  const uit = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), c = Math.min(n - 1, i + 2);
    let tx = p[c * 4] - p[a * 4], ty = p[c * 4 + 1] - p[a * 4 + 1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const w = p[i * 4 + 2], t = p[i * 4 + 3];
    // in vlak land slingert een rivier meer; bij bron en monding (of samenvloeiing) niet
    const vlak = 1 - smooth(0.55, 0.75, t);
    const A = (0.3 + 0.3 * w) * (0.3 + 0.7 * vlak) * (0.4 + 0.6 * ruis(s[i] * 0.04 + id * 7.3, 3.7));
    const lam = 9 + 3 * w;
    const taper = smooth(0, 5, s[i]) * smooth(0, 5, L - s[i]);
    const o = A * taper * Math.sin((s[i] / lam) * Math.PI * 2 + fase);
    let breed = w;
    if (naarZee && w > 1.2) breed *= 1 + 0.6 * smooth(L - 9, L, s[i]); // trechtermonding
    uit.push(p[i * 4] - ty * o, p[i * 4 + 1] + tx * o, breed, t);
  }
  // stop zodra de rivier in zee ligt
  let m = uit.length / 4;
  for (let i = 2; i < m; i++) if (sdOp(b, uit[i * 4], uit[i * 4 + 1]) > 0.8) { m = i + 1; break; }
  // een zijtak eindigt precies op de (geslingerde) hoofdstroom
  if (ouder >= 0 && rivieren[ouder]) {
    const op = rivieren[ouder].pts, ex = uit[(m - 1) * 4], ey = uit[(m - 1) * 4 + 1];
    let bd = Infinity, bx = ex, by = ey;
    for (let i = 0; i < op.length; i += 2) { const d = (op[i] - ex) ** 2 + (op[i + 1] - ey) ** 2; if (d < bd) { bd = d; bx = op[i]; by = op[i + 1]; } }
    if (bd < 16) { uit[(m - 1) * 4] = bx; uit[(m - 1) * 4 + 1] = by; }
  }
  if (m < 3) return;
  const rv = { pts: new Float32Array(m * 2), br: new Float32Array(m), s: new Float32Array(m), snel: new Float32Array(m), naarZee, delta: false, ouder, snelheid: 0 };
  for (let i = 0; i < m; i++) {
    rv.pts[i * 2] = uit[i * 4]; rv.pts[i * 2 + 1] = uit[i * 4 + 1]; rv.br[i] = uit[i * 4 + 2];
    if (i) rv.s[i] = rv.s[i - 1] + Math.hypot(rv.pts[i * 2] - rv.pts[i * 2 - 2], rv.pts[i * 2 + 1] - rv.pts[i * 2 - 1]);
  }
  // verval: waar het snel daalt, schuimt het (stroomversnelling)
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 4), c = Math.min(m - 1, i + 4);
    const dh = uit[a * 4 + 3] - uit[c * 4 + 3], ds = Math.max(1, rv.s[c] - rv.s[a]);
    rv.snel[i] = smooth(0.0035, 0.007, dh / ds);
  }
  let bm = 0;
  for (let i = 0; i < m; i++) bm = Math.max(bm, rv.br[i]);
  rv.snelheid = 1.1 + 0.35 * bm;
  rivieren.push(rv);
  // delta: een brede rivier in laag land splitst zich vlak voor de kust in twee zijarmen
  const wEind = p[Math.min(n - 1, m - 1) * 4 + 2], tEind = uit[(m - 1) * 4 + 3];
  const delta = rivieren.reduce((k, r) => k + (r.delta ? 1 : 0), 0);
  if (!naarZee || wEind < 2.2 || tEind > 0.5 || rv.s[m - 1] < 30 || delta >= 8) return;
  let si = m - 1;
  while (si > 0 && rv.s[m - 1] - rv.s[si] < 13) si--;
  const sx = rv.pts[si * 2], sy = rv.pts[si * 2 + 1];
  let dx = rv.pts[(m - 1) * 2] - sx, dy = rv.pts[(m - 1) * 2 + 1] - sy;
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  for (const teken of [-1, 1]) {
    const hoek = teken * (0.55 + 0.2 * hash(id, teken + 5)), co = Math.cos(hoek), sn = Math.sin(hoek);
    const rx = dx * co - dy * sn, ry = dx * sn + dy * co;
    let eind = -1;
    for (let k = 4; k < 30; k++) if (sdOp(b, sx + rx * k * 0.8, sy + ry * k * 0.8) > 0.6) { eind = k * 0.8; break; }
    if (eind < 0) continue;
    const ex = sx + rx * eind, ey = sy + ry * eind;
    const mx = (sx + ex) / 2 - ry * teken * 1.2, my = (sy + ey) / 2 + rx * teken * 1.2;
    let q = [sx, sy, wEind * 0.42, tEind, mx, my, wEind * 0.5, tEind, ex, ey, wEind * 0.7, tEind];
    q = herbemonster(chaikin(q, 4, 3), 4, 0.7);
    const k = q.length / 4;
    const arm = { pts: new Float32Array(k * 2), br: new Float32Array(k), s: new Float32Array(k), snel: new Float32Array(k), naarZee: true, delta: true, ouder: id, snelheid: rv.snelheid * 0.8 };
    for (let i = 0; i < k; i++) {
      arm.pts[i * 2] = q[i * 4]; arm.pts[i * 2 + 1] = q[i * 4 + 1]; arm.br[i] = q[i * 4 + 2];
      if (i) arm.s[i] = arm.s[i - 1] + Math.hypot(arm.pts[i * 2] - arm.pts[i * 2 - 2], arm.pts[i * 2 + 1] - arm.pts[i * 2 - 1]);
    }
    for (let i = 0; i < k; i++) arm.s[i] += rv.s[si];
    rivieren.push(arm);
  }
}

// Vlaggen per vakje: moeras, klif, duin, bergvoet, bij een stad. Vast per wereld.
function maakVlaggen(b) {
  const geo = b.geo, nT = geo.tegels.length, ruis = geo.ruis;
  const moeras = new Uint8Array(nT), klif = new Uint8Array(nT), duin = new Uint8Array(nT), bergvoet = new Uint8Array(nT), stad = new Uint8Array(nT);
  const hs = geo.hoofdstad.filter((i) => i != null && i >= 0).map((i) => geo.tegels[i]);
  for (const t of geo.tegels) {
    if (t.terrein === 'water') continue;
    let nat = false, berg = false;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dk = -1; dk <= 1; dk++) {
        const k = t.k + dk, r = t.r + dr;
        if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) { nat = true; continue; }
        const nb = geo.tegels[r * geo.kol + k];
        if (nb.terrein === 'water') nat = true;
        if (nb.terrein === 'berg') berg = true;
      }
    }
    const zd = zoetOp(b, t.x, t.y);
    if ((nat || sdOp(b, t.x, t.y) > -10) && (t.hoogte > 0.6 || berg)) klif[t.i] = 1;
    else if (t.terrein === 'kust' && t.hoogte < 0.56 && hash(t.i, 61) < 0.8) duin[t.i] = 1;
    if ((t.terrein === 'vlakte' || t.terrein === 'kust') && !b.akker[t.i] && !duin[t.i] && !klif[t.i] && t.hoogte < 0.5) {
      const n = ruis(t.x * 0.03 + 81, t.y * 0.03 + 17);
      if ((zd < 11 && n > 0.38) || n > 0.68) moeras[t.i] = 1;
    }
    if (t.terrein !== 'berg' && berg) bergvoet[t.i] = 1;
    for (const h of hs) if (Math.max(Math.abs(h.k - t.k), Math.abs(h.r - t.r)) <= 2) stad[t.i] = 1;
  }
  Object.assign(b, { moeras, klif, duin, bergvoet, stad });
}

// Vlaggen als zacht veld op een punt (zelfde weging als de terreingewichten): [moeras, klif, duin].
function vlaggenOp(b, x, y, uit) {
  const geo = b.geo;
  uit[0] = uit[1] = uit[2] = 0;
  const tk = Math.floor(x / geo.T), tr = Math.floor(y / geo.T);
  // snel pad: geen gevlagd vakje in de buurt (het meeste land), dan geen gewichten uitrekenen
  let iets = 0;
  for (let r = Math.max(0, tr - 1); r <= Math.min(geo.rij - 1, tr + 1); r++) {
    for (let k = Math.max(0, tk - 1); k <= Math.min(geo.kol - 1, tk + 1); k++) { const i = r * geo.kol + k; iets |= b.moeras[i] | b.klif[i] | b.duin[i]; }
  }
  if (!iets) return uit;
  let som = 0;
  for (let dr = -1; dr <= 1; dr++) {
    const r = tr + dr;
    if (r < 0 || r >= geo.rij) continue;
    for (let dk = -1; dk <= 1; dk++) {
      const k = tk + dk;
      if (k < 0 || k >= geo.kol) continue;
      const t = geo.tegels[r * geo.kol + k];
      if (t.terrein === 'water') continue;
      const dx = x - t.x, dy = y - t.y, w = Math.exp(-(dx * dx + dy * dy) / 81);
      som += w;
      uit[0] += b.moeras[t.i] * w; uit[1] += b.klif[t.i] * w; uit[2] += b.duin[t.i] * w;
    }
  }
  if (som > 1e-6) { uit[0] /= som; uit[1] /= som; uit[2] /= som; }
  return uit;
}

// Scheidbare 3x3-boxvervaging in place; `tmp` is een hulpbuffer van dezelfde grootte.
function vervaag(v, tmp, w, h) {
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) tmp[r + x] = (v[r + Math.max(0, x - 1)] + v[r + x] + v[r + Math.min(w - 1, x + 1)]) / 3;
  }
  for (let y = 0; y < h; y++) {
    const a = Math.max(0, y - 1) * w, b = y * w, c = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) v[b + x] = (tmp[a + x] + tmp[b + x] + tmp[c + x]) / 3;
  }
}

function chamfer(d, w, h) {
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
        if (x > 0) v = Math.min(v, d[i + w - 1] + D);
      }
      d[i] = v;
    }
  }
}

const isWater = (b, x, y) => {
  const px = Math.floor(x), py = Math.floor(y);
  return px < 0 || py < 0 || px >= W || py >= H || b.eigenaar[py * W + px] === -1;
};

// Getekende kustafstand op een willekeurig punt (bilineair tussen de pixelmiddens).
function sdOp(b, x, y) {
  const fx = x - 0.5, fy = y - 0.5;
  if (fx < 0 || fy < 0 || fx > W - 1 || fy > H - 1) return 30;
  const ix = Math.min(W - 2, Math.floor(fx)), iy = Math.min(H - 2, Math.floor(fy));
  const tx = fx - ix, ty = fy - iy, i = iy * W + ix, s = b.sd;
  const a = s[i] + (s[i + 1] - s[i]) * tx, c = s[i + W] + (s[i + W + 1] - s[i + W]) * tx;
  return a + (c - a) * ty;
}

// Terreingewichten op een punt: de 3x3 vakjes rond het punt, elk gewogen met exp(-(d/9)^2) vanaf een met ruis
// verschoven positie, zodat randen organisch worden. Daarna een zandstrook langs het water.
function gewichtenOp(b, x, y, uit, sd = sdOp(b, x, y)) {
  const geo = b.geo, ruis = geo.ruis;
  // de spec-ruis (0,13, x6) plus een trage, grotere verschuiving: anders blijven de randen vierkant als de vakjes
  const jx = x + (ruis(x * 0.13, y * 0.13) - 0.5) * 6 + (ruis(x * 0.045 + 7.1, y * 0.045 + 3.3) - 0.5) * 16;
  const jy = y + (ruis(x * 0.13 + 31.7, y * 0.13 + 17.3) - 0.5) * 6 + (ruis(x * 0.045 + 61.9, y * 0.045 + 45.2) - 0.5) * 16;
  uit.fill(0);
  const tk = Math.floor(x / geo.T), tr = Math.floor(y / geo.T);
  let som = 0;
  for (let dr = -1; dr <= 1; dr++) {
    const r = tr + dr;
    if (r < 0 || r >= geo.rij) continue;
    for (let dk = -1; dk <= 1; dk++) {
      const k = tk + dk;
      if (k < 0 || k >= geo.kol) continue;
      const t = geo.tegels[r * geo.kol + k];
      if (t.terrein === 'water') continue;
      const dx = jx - t.x, dy = jy - t.y;
      const w = Math.exp(-(dx * dx + dy * dy) / 81);
      som += w;
      if (t.terrein === 'bos') uit[BOS] += w;
      else if (t.terrein === 'berg') uit[BERG] += w;
      else if (t.terrein === 'kust') { uit[GRAS] += w * 0.72; uit[ZAND] += w * 0.28; }
      else if (b.akker[t.i]) uit[AKKER] += w;
      else uit[GRAS] += w;
    }
  }
  if (som <= 1e-6) { uit[GRAS] = 0.6; uit[ZAND] = 0.4; som = 1; }
  for (let s = 0; s < SOORTEN; s++) uit[s] /= som;
  // Zandstrook: hoe dichter bij het water, hoe meer zand.
  const extra = 1 - smooth(0, 2.2, Math.max(0, -sd));
  if (extra > 0) {
    uit[ZAND] += extra;
    for (let s = 0; s < SOORTEN; s++) uit[s] /= 1 + extra;
  }
  return uit;
}

// Hoogte: bilineair tussen de vakjeshoogtes, plus fijne ruis; in de bergen sterker en met een geribbelde octaaf.
function hoogteOp(b, x, y, berg) {
  const geo = b.geo, ruis = geo.ruis;
  const u = Math.min(geo.kol - 1.001, Math.max(0, x / geo.T - 0.5)), v = Math.min(geo.rij - 1.001, Math.max(0, y / geo.T - 0.5));
  const k = Math.floor(u), r = Math.floor(v), fu = u - k, fv = v - r;
  const t = geo.tegels, i = r * geo.kol + k;
  const a = t[i].hoogte + (t[i + 1].hoogte - t[i].hoogte) * fu;
  const c = t[i + geo.kol].hoogte + (t[i + geo.kol + 1].hoogte - t[i + geo.kol].hoogte) * fu;
  const bg = smooth(0.2, 0.55, berg);
  let h = a + (c - a) * fv + berg * 0.12;
  h += 0.06 * (ruis(x * 0.21 + 13, y * 0.21 + 7) - 0.5) * (1 + 2 * bg);
  h += bg * Math.abs(ruis(x * 0.35 + 71, y * 0.35 + 13) - 0.5) * 0.5;
  // bergkammen van zo'n 12 eenheden: grote vormen met een lichte noordwestflank en een schaduwkant
  // plus kleinere zijkammen, zodat een massief uit meerdere toppen bestaat
  const kam = Math.max(-1, Math.min(1, (ruis(x * 0.075 + 5, y * 0.075 + 9) - 0.5) * 5));
  const zij = Math.max(-1, Math.min(1, (ruis(x * 0.17 + 23, y * 0.17 + 41) - 0.5) * 5));
  h += bg * (0.75 * (1 - Math.abs(kam)) + 0.22 * (1 - Math.abs(zij)));
  return h;
}

// ---------- grond van één brok (puur) ----------

// Rekent het monsterrooster van brok (ck, cr) uit. Monster (i, j) ligt op wereldpositie
// (ck*64 - 2 + i + 0.5, cr*64 - 2 + j + 0.5). Geeft gewichten, hoogte, kustafstand en kleur (RGBA) terug.
export function bakGrondData(b, ck, cr) {
  const ruis = b.geo.ruis;
  const x0 = ck * CH - MARGE, y0 = cr * CH - MARGE;
  const NN = N * N;
  const gewicht = new Float32Array(SOORTEN * NN);
  const water = new Uint8Array(NN);
  const sd = new Float32Array(NN);
  const hoogte = new Float32Array(NN);
  const vlag = new Float32Array(3 * NN); // moeras, klif, duin
  const g = new Float32Array(SOORTEN), vl = new Float32Array(3);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = x0 + i + 0.5, y = y0 + j + 0.5, m = j * N + i;
      water[m] = isWater(b, x, y) ? 1 : 0;
      const px = Math.floor(x), py = Math.floor(y);
      sd[m] = px < 0 || py < 0 || px >= W || py >= H ? 30 : b.sd[py * W + px];
      // diep water: de grond eronder is onzichtbaar, dus alleen zand en geen ruis
      if (sd[m] > 3) { gewicht[ZAND * NN + m] = 1; hoogte[m] = 0; continue; }
      gewichtenOp(b, x, y, g, sd[m]);
      for (let s = 0; s < SOORTEN; s++) gewicht[s * NN + m] = g[s];
      hoogte[m] = hoogteOp(b, x, y, g[BERG]);
      vlaggenOp(b, x, y, vl);
      vlag[m] = vl[0]; vlag[NN + m] = vl[1]; vlag[2 * NN + m] = vl[2];
      const kd = Math.max(0, -sd[m]);
      // klif: het land stijgt steil op vanaf de waterlijn; duinen: bulten achter het strand. Het reliëf doet de rest.
      if (vl[1] > 0.01) hoogte[m] += vl[1] * 0.42 * smooth(0.2, 3, kd);
      if (vl[2] > 0.01) hoogte[m] += vl[2] * 0.1 * smooth(0.6, 2, kd) * (1 - smooth(5, 8, kd)) * ruis(x * 0.33 + 11, y * 0.33 + 5);
    }
  }
  const kleur = new Uint8ClampedArray(NN * 4); // samengesteld: wat je ziet
  const land = new Uint8ClampedArray(NN * 4); // landkleur overal (onder water: zand)
  const zee = new Uint8ClampedArray(NN * 4); // waterkleur overal (op land: ondiep)
  const sneeuw = new Float32Array(NN);
  const sneeuwBasis = new Float32Array(NN), licht = new Float32Array(NN).fill(1), meerA = new Float32Array(NN).fill(VER);
  const c = [0, 0, 0], tmp = [0, 0, 0], tmp2 = [0, 0, 0];
  // zon uit het noordwesten
  const ll = Math.hypot(1, 1, 1.4), Lx = -1 / ll, Ly = -1 / ll, Lz = 1.4 / ll;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const m = j * N + i, x = x0 + i + 0.5, y = y0 + j + 0.5, p = m * 4;
      if (sd[m] > 3) {
        // diep water: vaste zandkleur eronder, alleen de waterkleur telt
        land[p] = K.zandNat[0]; land[p + 1] = K.zandNat[1]; land[p + 2] = K.zandNat[2] * 0.9; land[p + 3] = 255;
        meng(K.midden, K.diep, smooth(3.5, 8, sd[m]), tmp);
        const wv = 0.94 + 0.12 * ruis(x * 0.06 + 90, y * 0.06 + 30);
        zee[p] = kleur[p] = tmp[0] * wv; zee[p + 1] = kleur[p + 1] = tmp[1] * wv; zee[p + 2] = kleur[p + 2] = tmp[2] * wv; zee[p + 3] = kleur[p + 3] = 255;
        continue;
      }
      const hl = hoogte[j * N + Math.max(0, i - 1)], hr = hoogte[j * N + Math.min(N - 1, i + 1)];
      const hu = hoogte[Math.max(0, j - 1) * N + i], hd = hoogte[Math.min(N - 1, j + 1) * N + i];
      const hx = (hr - hl) / 2, hy = (hd - hu) / 2;
      let nx = -hx * 6, ny = -hy * 6, nz = 1;
      const nl = Math.sqrt(nx * nx + ny * ny + 1); nx /= nl; ny /= nl; nz /= nl;
      const schaduw = 0.62 + 0.55 * Math.max(0, nx * Lx + ny * Ly + nz * Lz);
      const helling = Math.sqrt(hx * hx + hy * hy);
      const wg = (s) => gewicht[s * NN + m];
      c[0] = c[1] = c[2] = 0;
      // gras: drie tinten en droge plekken, gestuurd door trage ruis
      if (wg(GRAS) > 0.002) {
        const n1 = ruis(x * 0.08 + 5.3, y * 0.08 + 1.7);
        if (n1 < 0.45) meng(K.grasDonker, K.gras, smooth(0.25, 0.45, n1), tmp); else meng(K.gras, K.grasLicht, smooth(0.45, 0.62, n1), tmp);
        meng(tmp, K.grasDroog, smooth(0.64, 0.8, ruis(x * 0.05 + 40, y * 0.05 + 9)) * 0.8, tmp);
        c[0] = tmp[0] * wg(GRAS); c[1] = tmp[1] * wg(GRAS); c[2] = tmp[2] * wg(GRAS);
      }
      if (wg(BOS) > 0.002) {
        const bv = 0.9 + 0.2 * ruis(x * 0.3 + 2, y * 0.3 + 5);
        c[0] += K.bos[0] * bv * wg(BOS); c[1] += K.bos[1] * bv * wg(BOS); c[2] += K.bos[2] * bv * wg(BOS);
      }
      if (wg(BERG) > 0.002) {
        // dalen donker, toppen licht: dat maakt de vorm van het massief leesbaar; een beetje ruis voor gesteente
        const toon = smooth(1.0, 1.7, hoogte[m]) + (ruis(x * 0.3 + 3, y * 0.3 + 8) - 0.5) * 0.35;
        meng(K.rotsDonker, K.rots, smooth(0, 0.5, toon), tmp); meng(tmp, K.rotsLicht, smooth(0.5, 1, toon), tmp);
        c[0] += tmp[0] * wg(BERG); c[1] += tmp[1] * wg(BERG); c[2] += tmp[2] * wg(BERG);
      }
      meng(K.zandNat, K.zand, smooth(0.25, 0.9, Math.max(0, -sd[m])), tmp);
      c[0] += tmp[0] * wg(ZAND); c[1] += tmp[1] * wg(ZAND); c[2] += tmp[2] * wg(ZAND);
      c[0] += K.akker[0] * wg(AKKER); c[1] += K.akker[1] * wg(AKKER); c[2] += K.akker[2] * wg(AKKER);
      const kd = Math.max(0, -sd[m]);
      // moeras: donker olijfgroen met veenbruine plekken
      const fm = vlag[m];
      if (fm > 0.01) {
        const vlek = ruis(x * 0.25 + 41, y * 0.25 + 3);
        meng(K.moeras, K.veen, smooth(0.58, 0.72, vlek), tmp);
        meng(c, tmp, fm * (0.45 + 0.3 * vlek), c);
      }
      // duinen: licht zand met helmgroene bulten, alleen in een strook achter het strand
      const fd = vlag[2 * NN + m] * smooth(0.5, 1.4, kd) * (1 - smooth(4.5, 7.5, kd));
      if (fd > 0.01) {
        meng(K.duin, K.helm, smooth(0.42, 0.7, ruis(x * 0.33 + 11, y * 0.33 + 5)) * smooth(1.2, 4.5, kd), tmp);
        meng(c, tmp, fd * 0.85, c);
      }
      // klif: kale rotswand met verticale strepen, donker aan de voet
      const fk = vlag[NN + m] * (1 - smooth(2, 3.6, kd));
      if (fk > 0.01) {
        const streep = ruis(x * 1.1 + 3, y * 0.22 + 7);
        meng(K.rotsDonker, K.rotsLicht, 0.15 + 0.6 * streep, tmp);
        const voet = 0.7 + 0.3 * smooth(0, 1.4, kd);
        tmp[0] *= voet; tmp[1] *= voet; tmp[2] *= voet;
        meng(c, tmp, fk * 0.92, c);
      }
      // oevers: weelderig groen langs rivieren, modder langs meren
      const rz = veldOp(b.water.rivier, x, y), mz = veldOp(b.water.meer, x, y);
      if (rz < 3.5) meng(c, K.oeverGroen, 0.38 * (1 - smooth(0.2, 3.5, rz)) * (1 - wg(BERG)) * (1 - wg(ZAND)), c);
      if (mz < 1.8) meng(c, K.modder, 0.55 * (1 - smooth(0, 1.8, mz)), c);
      // reliëf, plus een lichte warme toon in het zonlicht (minder blauw)
      c[0] *= schaduw; c[1] *= schaduw; c[2] *= schaduw * 0.9;
      licht[m] = schaduw;
      meerA[m] = mz;
      // sneeuwgevoeligheid: in de bergen hoog, in het laagland vlekkerig, weinig op zand en steile hellingen
      const bergF = smooth(0.3, 0.7, wg(BERG));
      const vlekS = ruis(x * 0.045 + 201, y * 0.045 + 77) * 0.6 + ruis(x * 0.12 + 13, y * 0.12 + 91) * 0.28 + ruis(x * 0.4 + 7, y * 0.4 + 3) * 0.12;
      // opgerekt rond het midden: de ruis zelf heeft weinig spreiding, zo worden het duidelijke plekken
      let sb = 0.08 + 0.7 * Math.max(0, Math.min(1, 0.5 + (vlekS - 0.5) * 1.9));
      sb += (0.66 + 0.34 * vlekS - sb) * bergF;
      sb += 0.2 * smooth(0.9, 1.4, hoogte[m]);
      sb *= (1 - 0.5 * smooth(0.12, 0.35, helling)) * (1 - 0.65 * wg(ZAND)) * (1 - 0.5 * fk);
      sneeuwBasis[m] = Math.max(0, Math.min(1, sb));
      // sneeuw op hoge, vlakke plekken in de bergen
      const sn = 0.92 * smooth(1.58, 1.74, hoogte[m]) * (1 - smooth(0.12, 0.3, helling)) * smooth(0.5, 0.8, wg(BERG));
      sneeuw[m] = sn;
      if (sn > 0) {
        const f = 0.8 + 0.2 * Math.min(1.15, schaduw);
        tmp2[0] = K.sneeuw[0] * f; tmp2[1] = K.sneeuw[1] * f; tmp2[2] = K.sneeuw[2] * f;
        meng(c, tmp2, sn, c);
      }
      land[p] = c[0]; land[p + 1] = c[1]; land[p + 2] = c[2]; land[p + 3] = 255;
      // water: ondiep turkoois, dieper blauw, met een lichte golving in de tint
      const diepte = Math.max(0, sd[m]);
      meng(K.ondiep, K.midden, smooth(0.6, 2.4, diepte), tmp);
      meng(tmp, K.diep, smooth(3.5, 8, diepte), tmp);
      // meren: eigen, groenere tinten (het watermasker bepaalt waar ze zichtbaar zijn)
      if (!water[m] && mz < 1) meng(K.meerOndiep, K.meerDiep, smooth(0, 5, -mz), tmp);
      const wv = 0.94 + 0.12 * ruis(x * 0.06 + 90, y * 0.06 + 30);
      zee[p] = tmp[0] * wv; zee[p + 1] = tmp[1] * wv; zee[p + 2] = tmp[2] * wv; zee[p + 3] = 255;
      const bron = water[m] ? zee : land;
      kleur[p] = bron[p]; kleur[p + 1] = bron[p + 1]; kleur[p + 2] = bron[p + 2]; kleur[p + 3] = 255;
    }
  }
  return { ck, cr, x0, y0, n: N, gewicht, water, sd, hoogte, sneeuw, kleur, land, zee, vlag, sneeuwBasis, licht, meer: meerA };
}

// Seizoen over de gebakken grondkleuren: gras dof in de winter en droog in de nazomer, herfsttinten in het bos,
// vlekkerige sneeuw (bergen vol, laagland gedeeltelijk) en bevroren meren. Puur; schrijft in uitLand en uitZee.
export function seizoensGrond(g, sz, uitLand, uitZee) {
  const NN = N * N, ml = g.maskers;
  const A = 0.3 * smooth(0.45, 0.85, sz.koud) + 0.28 * sz.sneeuw; // sneeuwhoeveelheid, 0..0,58
  const drempel = 1 - A;
  const ijs = smooth(0.86, 0.97, sz.koud);
  const tmp = [0, 0, 0], c = [0, 0, 0];
  for (let m = 0; m < NN; m++) {
    const p = m * 4;
    c[0] = g.land[p]; c[1] = g.land[p + 1]; c[2] = g.land[p + 2];
    const wG = ml[0][p + 3] / 255, wB = ml[1][p + 3] / 255, wR = ml[2][p + 3] / 255, wZ = ml[3][p + 3] / 255;
    const wA = Math.max(0, 1 - wG - wB - wR - wZ);
    const gras = wG + wA * 0.6;
    if (gras > 0.01) {
      if (sz.winter > 0) meng(c, K.grasWinter, sz.winter * 0.5 * gras, c);
      if (sz.oogst > 0) meng(c, K.grasDroog, sz.oogst * 0.32 * wG, c);
      if (sz.lente > 0) meng(c, K.grasLente, sz.lente * 0.25 * wG, c);
    }
    if (wB > 0.01) {
      if (sz.blad > 0) meng(c, K.bosHerfst, sz.blad * 0.5 * wB, c);
      if (sz.winter > 0) meng(c, K.bosWinter, sz.winter * 0.35 * wB, c);
    }
    const sb = g.sneeuwBasis[m];
    if (A > 0.01 && sb > drempel - 0.12) {
      const dek = smooth(drempel, drempel + 0.12, sb);
      const f = 0.8 + 0.2 * Math.min(1.15, g.licht[m]);
      tmp[0] = K.sneeuw[0] * f; tmp[1] = K.sneeuw[1] * f; tmp[2] = Math.min(255, K.sneeuw[2] * f + 6);
      meng(c, tmp, dek * 0.93, c);
    }
    uitLand[p] = c[0]; uitLand[p + 1] = c[1]; uitLand[p + 2] = c[2]; uitLand[p + 3] = 255;
    uitZee[p] = g.zee[p]; uitZee[p + 1] = g.zee[p + 1]; uitZee[p + 2] = g.zee[p + 2]; uitZee[p + 3] = 255;
    if (ijs > 0 && g.meer[m] < 1) {
      // ijs groeit vanaf de oever
      const f = ijs * (0.55 + 0.45 * smooth(-1, 0.5, g.meer[m]));
      tmp[0] = uitZee[p]; tmp[1] = uitZee[p + 1]; tmp[2] = uitZee[p + 2];
      meng(tmp, K.ijs, f, tmp);
      uitZee[p] = tmp[0]; uitZee[p + 1] = tmp[1]; uitZee[p + 2] = tmp[2];
    }
  }
}

// Water- en schuimmaskers op 3 monsters per eenheid (met dezelfde marge), wit met alfa.
// Meren tellen mee in het watermasker (dus ook glinsteringen); op een bebouwd vakje is het meer drooggelegd.
export function bakMaskerData(b, ck, cr, bezet = null) {
  const ruis = b.geo.ruis, geo = b.geo;
  const x0 = ck * CH - MARGE, y0 = cr * CH - MARGE;
  const water = new Uint8ClampedArray(MN * MN * 4), schuim1 = new Uint8ClampedArray(MN * MN * 4), schuim2 = new Uint8ClampedArray(MN * MN * 4);
  const meer = b.water.meer;
  for (let j = 0; j < MN; j++) {
    for (let i = 0; i < MN; i++) {
      const x = x0 + (i + 0.5) / M, y = y0 + (j + 0.5) / M, p = (j * MN + i) * 4;
      const sd = sdOp(b, x, y);
      // ondiep water is wat doorschijnend, zodat het zand eronder zichtbaar blijft
      let wa = smooth(-0.18, 0.18, sd) * (0.72 + 0.28 * smooth(0.2, 2.6, sd));
      const md = veldOp(meer, x, y);
      if (md < 0.35) {
        let la = smooth(0.35, -0.35, md) * (0.82 + 0.16 * smooth(0, -3, md));
        if (bezet && x >= 0 && y >= 0 && x < W && y < H && bezet[Math.floor(y / geo.T) * geo.kol + Math.floor(x / geo.T)]) la = 0;
        wa = Math.max(wa, la);
      }
      water[p] = water[p + 1] = water[p + 2] = 255; water[p + 3] = wa * 255;
      if (sd < -0.12 || sd > 1.15) continue; // geen schuim: maskers blijven leeg
      const breuk = 0.5 + 0.5 * ruis(x * 0.9 + 11, y * 0.9 + 3);
      const s1 = smooth(-0.12, 0.06, sd) * (1 - smooth(0.25, 0.55, sd)) * (0.55 + 0.45 * breuk);
      const s2 = smooth(0.42, 0.62, sd) * (1 - smooth(0.88, 1.15, sd)) * breuk;
      schuim1[p] = 236; schuim1[p + 1] = 246; schuim1[p + 2] = 248; schuim1[p + 3] = s1 * 255;
      schuim2[p] = 236; schuim2[p + 1] = 246; schuim2[p + 2] = 248; schuim2[p + 3] = s2 * 255;
    }
  }
  return { water, schuim1, schuim2 };
}

// Eigenaar op 2 monsters per eenheid, 136x136 met 4 monsters marge. Monster i ligt op x = ck*64 + (i - 4 + 0.5) / 2.
// Snel pad via het pixelbeeld; alleen bij een grenspixel rekent hij de echte eigenaar uit. Veroverde vakjes
// krijgen hun nieuwe eigenaar, net als tekenBasis in map.js.
export function eigenaarRaster(b, ck, cr, huidig) {
  const geo = b.geo, eig = b.eigenaar;
  const r = new Int16Array(ON * ON);
  for (let j = 0; j < ON; j++) {
    const y = cr * CH + (j - RM + 0.5) / OR;
    for (let i = 0; i < ON; i++) {
      const x = ck * CH + (i - RM + 0.5) / OR;
      const px = Math.floor(x), py = Math.floor(y);
      let e;
      if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) e = px < 0 || py < 0 || px >= W || py >= H ? -1 : eig[py * W + px];
      else {
        const q = py * W + px;
        e = eig[q];
        if (eig[q - 1] !== e || eig[q + 1] !== e || eig[q - W] !== e || eig[q + W] !== e) e = geo.eigenaarOp(x, y);
      }
      if (huidig && e !== -1 && px >= 0 && py >= 0 && px < W && py < H) {
        const t = Math.floor(y / geo.T) * geo.kol + Math.floor(x / geo.T);
        const nu = huidig[t];
        if (nu !== geo.tegels[t].eig && nu !== -1) e = nu;
      }
      r[j * ON + i] = e;
    }
  }
  return r;
}

// Grenslijnen uit het eigenaarrooster: punten op de middens van celranden waar de eigenaar wisselt, aan elkaar
// geregen tot lijnen en gladgestreken. Elke lijn kent de eigenaar links en rechts (in de looprichting), voor de
// gekleurde binnenlijn. Coördinaten in wereldeenheden.
export function ketensUitRaster(r, ck, cr) {
  // monster i ligt op ox + (i - 0.5) / OR
  const ox = ck * CH - (RM - 1) / OR, oy = cr * CH - (RM - 1) / OR;
  const id = (i, j, v) => (j * ON + i) * 2 + v; // v=0: horizontale rand (i,j)-(i+1,j); v=1: verticale (i,j)-(i,j+1)
  const segA = [], segB = [], segPaar = [];
  const knoopX = new Map(), knoopY = new Map(); // middelpunten van cellen waar drie of vier randen wisselen
  const punt = (k, uit) => {
    if (k < 0) { uit[0] = knoopX.get(k); uit[1] = knoopY.get(k); return uit; }
    const v = k & 1, c = k >> 1, i = c % ON, j = (c - i) / ON;
    uit[0] = ox + (v ? i - 0.5 : i) / OR;
    uit[1] = oy + (v ? j : j - 0.5) / OR;
    return uit;
  };
  const rand = [0, 0, 0, 0];
  for (let j = 0; j < ON - 1; j++) {
    for (let i = 0; i < ON - 1; i++) {
      const a = r[j * ON + i], b2 = r[j * ON + i + 1], c = r[(j + 1) * ON + i], d = r[(j + 1) * ON + i + 1];
      if (a === b2 && a === c && a === d) continue;
      let n = 0;
      if (a !== b2) rand[n++] = id(i, j, 0);
      if (c !== d) rand[n++] = id(i, j + 1, 0);
      if (a !== c) rand[n++] = id(i, j, 1);
      if (b2 !== d) rand[n++] = id(i + 1, j, 1);
      if (n === 2) { segA.push(rand[0]); segB.push(rand[1]); segPaar.push(paarVan(r, rand[0])); }
      else {
        const k = -(j * ON + i) - 1;
        knoopX.set(k, ox + i / OR); knoopY.set(k, oy + j / OR);
        for (let q = 0; q < n; q++) { segA.push(rand[q]); segB.push(k); segPaar.push(paarVan(r, rand[q])); }
      }
    }
  }
  // aan elkaar rijgen
  const buren = new Map();
  const voeg = (k, s) => { const l = buren.get(k); if (l) l.push(s); else buren.set(k, [s]); };
  for (let s = 0; s < segA.length; s++) { voeg(segA[s], s); voeg(segB[s], s); }
  const gebruikt = new Uint8Array(segA.length);
  const ketens = [];
  const p = [0, 0];
  const verder = (start, s0, lijst) => {
    // loop vanaf knoop `start` via segment s0 zo ver mogelijk
    let k = start, s = s0;
    for (;;) {
      gebruikt[s] = 1;
      k = segA[s] === k ? segB[s] : segA[s];
      lijst.push(k);
      const l = buren.get(k);
      if (!l || l.length !== 2 || k < 0) return;
      const volgende = l[0] === s ? l[1] : l[0];
      if (gebruikt[volgende] || segPaar[volgende] !== segPaar[s]) return;
      s = volgende;
    }
  };
  for (let s = 0; s < segA.length; s++) {
    if (gebruikt[s]) continue;
    const voor = [segA[s]], na = [];
    verder(segA[s], s, voor); // voor: [A, B, ...]
    // terug vanaf A
    const lA = buren.get(segA[s]);
    if (lA && lA.length === 2 && segA[s] >= 0) {
      const ander = lA[0] === s ? lA[1] : lA[0];
      if (!gebruikt[ander] && segPaar[ander] === segPaar[s]) verder(segA[s], ander, na);
    }
    const knopen = na.reverse().concat(voor);
    const pts = new Float32Array(knopen.length * 2);
    for (let q = 0; q < knopen.length; q++) { punt(knopen[q], p); pts[q * 2] = p[0]; pts[q * 2 + 1] = p[1]; }
    // welke eigenaar ligt links? neem een randpunt (geen kruisknoop) en het monster aan één kant ervan
    let q = 0;
    while (knopen[q] < 0) q++;
    const kq = knopen[q], v = kq & 1, c = kq >> 1, i = c % ON, j = (c - i) / ON;
    const o1 = r[c], o2 = v ? r[c + ON] : r[c + 1];
    const sx = ox + (i - 0.5) / OR, sy = oy + (j - 0.5) / OR; // monster o1
    const voorwaarts = q < knopen.length - 1;
    const nq = voorwaarts ? q + 1 : q - 1;
    let tx = pts[nq * 2] - pts[q * 2], ty = pts[nq * 2 + 1] - pts[q * 2 + 1];
    if (!voorwaarts) { tx = -tx; ty = -ty; }
    const kruis = tx * (sy - pts[q * 2 + 1]) - ty * (sx - pts[q * 2]);
    const dicht = knopen[0] === knopen[knopen.length - 1];
    strijk(pts, dicht);
    ketens.push({ links: kruis > 0 ? o1 : o2, rechts: kruis > 0 ? o2 : o1, pts, dicht });
  }
  return ketens;
}

// Gladstrijken met [1 2 1]/4, drie keer: de trapjes van een half eenheid verdwijnen. Eindpunten blijven staan;
// ze liggen in de marge, dus de buurbrok rekent rond de naad dezelfde punten uit.
function strijk(pts, dicht) {
  const n = pts.length / 2;
  if (n < 3) return;
  const tmp = new Float32Array(pts.length);
  for (let it = 0; it < 3; it++) {
    tmp.set(pts);
    for (let q = 0; q < n; q++) {
      let a = q - 1, b = q + 1;
      if (dicht) { if (a < 0) a = n - 2; if (b > n - 1) b = 1; } else if (a < 0 || b > n - 1) continue;
      pts[q * 2] = (tmp[a * 2] + 2 * tmp[q * 2] + tmp[b * 2]) / 4;
      pts[q * 2 + 1] = (tmp[a * 2 + 1] + 2 * tmp[q * 2 + 1] + tmp[b * 2 + 1]) / 4;
    }
  }
}

function paarVan(r, k) {
  const v = k & 1, c = k >> 1;
  const a = r[c], b = v ? r[c + ON] : r[c + 1];
  return a < b ? (a + 4) * 65536 + b + 4 : (b + 4) * 65536 + a + 4;
}

// ---------- kenmerken per vakje ----------

// Vaste kenmerken van een vakje: [type, x, y, r, variant, extra] in wereldeenheden vanaf het midden van het vakje.
// Wordt gecachet in de basis; bakken en scherp tekenen gebruiken dezelfde lijst. Seizoen en wind veranderen
// alleen kleuren en beweging, nooit de plaatsing.
export function kenmerkenVoorTegel(t, b) {
  if (b.kenmerken[t.i]) return b.kenmerken[t.i];
  const uit = [];
  const g = new Float32Array(SOORTEN);
  const geo = b.geo, half = geo.T / 2;
  const r = rnd(t.i * 9176 + 31);
  const zet = (type, x, y, rr, variant, extra = 0) => { uit.push(type, x, y, rr, variant, extra); };
  const gew = (x, y) => gewichtenOp(b, t.x + x, t.y + y, g);
  const droog = (x, y, marge) => zoetOp(b, t.x + x, t.y + y) > marge; // niet in of vlak bij een rivier of meer
  if (t.terrein === 'water') { b.kenmerken[t.i] = new Float32Array(0); return b.kenmerken[t.i]; }
  // Bomen en akkers volgen het gewichtenveld, niet de vakjesgrens: ook een buurvakje krijgt ze waar het bos of de
  // akker doorloopt. Zo krijgen bosranden en akkercomplexen een grillige vorm.
  let bosBuur = false, akkerBuur = false;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dk = -1; dk <= 1; dk++) {
      const k = t.k + dk, rr = t.r + dr;
      if (k < 0 || rr < 0 || k >= geo.kol || rr >= geo.rij) continue;
      const n = geo.tegels[rr * geo.kol + k];
      if (n.terrein === 'bos') bosBuur = true;
      if (b.akker[n.i]) akkerBuur = true;
    }
  }
  const moeras = b.moeras[t.i];
  if (akkerBuur && t.eig >= 0 && t.terrein !== 'berg') percelen(t, b, zet, g);
  if (bosBuur) {
    // dicht bladerdak: een verschoven rooster van 1,6 eenheid
    const cel = 1.6, n = Math.round(geo.T / cel);
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < n; ci++) {
        const q = ci * 31 + cj;
        if (hash(t.i, q, 3) >= 0.85) continue;
        const x = -half + (ci + 0.5) * cel + (hash(t.i, q, 1) - 0.5) * 1.3;
        const y = -half + (cj + 0.5) * cel + (hash(t.i, q, 2) - 0.5) * 1.3;
        if (isWater(b, t.x + x, t.y + y) || gew(x, y)[BOS] <= 0.5 || !droog(x, y, 0.5)) continue;
        // variant 0 is een naaldboom (blijft groen), 1 en 2 zijn loofbomen; hoger in de bergen meer naald
        const naald = hash(t.i, q, 7) < 0.25 + 0.5 * smooth(0.55, 0.75, t.hoogte);
        zet(BOOM, x, y, 0.62 + hash(t.i, q, 4) * 0.42, naald ? 0 : 1 + Math.floor(hash(t.i, q, 5) * 2), hash(t.i, q, 6));
      }
    }
  }
  if (t.terrein === 'berg') {
    const clusters = 4 + Math.floor(r() * 5);
    for (let c = 0; c < clusters; c++) {
      let x = 0, y = 0;
      for (let poging = 0; poging < 4; poging++) {
        x = (r() - 0.5) * geo.T * 0.85; y = (r() - 0.5) * geo.T * 0.85;
        if (gew(x, y)[BERG] > 0.4 && !isWater(b, t.x + x, t.y + y)) break;
      }
      if (g[BERG] <= 0.4 || isWater(b, t.x + x, t.y + y) || !droog(x, y, 0.8)) continue;
      const rotsen = 2 + Math.floor(r() * 3);
      for (let q = 0; q < rotsen; q++) {
        const rx = x + (r() - 0.5) * 2.4, ry = y + (r() - 0.5) * 2.4, rr = 0.5 + r() * 0.8, v = r();
        if (!droog(rx, ry, rr * 0.6)) continue; // de groep ligt op het droge, maar een losse kei kan in een beek rollen
        const hoog = hoogteOp(b, t.x + rx, t.y + ry, gew(rx, ry)[BERG]) > 1.66 ? 1 : 0;
        zet(ROTS, rx, ry, rr, v, hoog);
      }
      const gruis = 2 + Math.floor(r() * 4);
      for (let q = 0; q < gruis; q++) {
        const gx = x + 0.6 + r() * 2.2, gy = y + 0.6 + r() * 2.2, gr = 0.12 + r() * 0.14, v = r();
        if (droog(gx, gy, 0.1)) zet(GRUIS, gx, gy, gr, v);
      }
    }
  } else if (t.terrein !== 'bos') {
    // vlakte, kust en onbewoonde eilanden: losse bomen en graspollen op open grasland
    if (!b.akker[t.i]) {
      const bomen = Math.floor(r() * (moeras ? 2 : 4));
      for (let q = 0; q < bomen; q++) {
        const x = (r() - 0.5) * geo.T * 0.8, y = (r() - 0.5) * geo.T * 0.8;
        if (sdOp(b, t.x + x, t.y + y) > -1.5 || !droog(x, y, 1)) continue;
        gew(x, y);
        if (g[ZAND] > 0.35 || g[BOS] > 0.4 || g[AKKER] > 0.4) continue;
        zet(LOSBOOM, x, y, 0.7 + r() * 0.4, 1 + Math.floor(r() * 2), r());
      }
      // rotspartij: een groepje keien in het gras
      if (!moeras && hash(t.i, 41) < 0.14) {
        const x = (r() - 0.5) * geo.T * 0.6, y = (r() - 0.5) * geo.T * 0.6;
        if (sdOp(b, t.x + x, t.y + y) < -2 && droog(x, y, 1.5) && gew(x, y)[AKKER] < 0.3) {
          const n = 3 + Math.floor(r() * 4);
          for (let q = 0; q < n; q++) zet(STEEN, x + (r() - 0.5) * 2.6, y + (r() - 0.5) * 2.2, 0.28 + r() * 0.45, r());
        }
      }
    }
    const plukken = (moeras ? 4 : 7) + Math.floor(r() * 5);
    for (let q = 0; q < plukken; q++) {
      const x = (r() - 0.5) * geo.T * 0.95, y = (r() - 0.5) * geo.T * 0.95;
      if (sdOp(b, t.x + x, t.y + y) > -0.8 || !droog(x, y, 0.4)) continue;
      gew(x, y);
      if (g[BOS] > 0.45 || g[AKKER] > 0.45) continue;
      zet(PLUK, x, y, 0.35 + r() * 0.25, r() < 0.5 ? 0 : 1, r());
    }
    if (t.terrein === 'kust') {
      const kiezels = 4 + Math.floor(r() * 5);
      for (let q = 0; q < kiezels * 3 && q < 30; q++) {
        const x = (r() - 0.5) * geo.T, y = (r() - 0.5) * geo.T, sd = sdOp(b, t.x + x, t.y + y);
        if (sd < -1.7 || sd > -0.25) continue;
        zet(KIEZEL, x, y, 0.1 + r() * 0.14, r() < 0.6 ? 0 : 1);
      }
      if (r() < 0.6) {
        for (let q = 0; q < 8; q++) {
          const x = (r() - 0.5) * geo.T, y = (r() - 0.5) * geo.T, sd = sdOp(b, t.x + x, t.y + y);
          if (sd < -1.4 || sd > -0.35) continue;
          zet(DRIJFHOUT, x, y, 0.5 + r() * 0.5, r() * Math.PI);
          break;
        }
      }
    }
    // duinen: helmgras in de strook achter het strand
    if (b.duin[t.i]) {
      for (let q = 0; q < 40; q++) {
        const x = (r() - 0.5) * geo.T, y = (r() - 0.5) * geo.T, sd = sdOp(b, t.x + x, t.y + y);
        if (sd < -6.5 || sd > -1.2 || !droog(x, y, 0.3)) continue; // niet in de rivier die door de duinen naar zee loopt
        zet(HELM, x, y, 0.32 + r() * 0.25, r() < 0.5 ? 0 : 1, r());
      }
    }
  }
  // bergvoet: puin en losse brokken die van de helling zijn gerold
  if (b.bergvoet[t.i] && t.terrein !== 'bos') {
    const n = 4 + Math.floor(r() * 6);
    for (let q = 0; q < n; q++) {
      const x = (r() - 0.5) * geo.T * 0.9, y = (r() - 0.5) * geo.T * 0.9;
      if (sdOp(b, t.x + x, t.y + y) > -1 || !droog(x, y, 0.6) || gew(x, y)[AKKER] > 0.35) continue;
      if (q % 3 === 0) zet(STEEN, x, y, 0.22 + r() * 0.3, r());
      else zet(GRUIS, x, y, 0.1 + r() * 0.13, r());
    }
  }
  // moeras: plassen met riet eromheen
  if (moeras) {
    const plassen = 2 + Math.floor(r() * 4);
    for (let q = 0; q < plassen; q++) {
      const x = (r() - 0.5) * geo.T * 0.75, y = (r() - 0.5) * geo.T * 0.75, rr = 0.7 + r() * 1.5, hoek = r() * Math.PI;
      if (sdOp(b, t.x + x, t.y + y) > -rr - 1.2 || !droog(x, y, rr + 0.4)) continue;
      zet(PLAS, x, y, rr, r(), hoek);
      const riet = 3 + Math.floor(r() * 4);
      for (let k = 0; k < riet; k++) {
        const a = r() * Math.PI * 2, d = rr * (1.05 + r() * 0.35);
        zet(RIET, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, 0.3 + r() * 0.22, r() < 0.5 ? 0 : 1, r());
      }
    }
    for (let q = 0; q < 6; q++) {
      const x = (r() - 0.5) * geo.T * 0.9, y = (r() - 0.5) * geo.T * 0.9;
      if (droog(x, y, 0.3) && sdOp(b, t.x + x, t.y + y) < -0.8) zet(RIET, x, y, 0.3 + r() * 0.2, r() < 0.5 ? 0 : 1, r());
    }
  }
  if (t.terrein !== 'berg' || hash(t.i, 45) < 0.3) oeverRiet(t, b, zet);
  if (b.akker[t.i] && t.eig >= 0 && !b.stad[t.i] && hash(t.i, 43) < 0.22) boerderij(t, b, zet, r);
  b.kenmerken[t.i] = Float32Array.from(uit);
  return b.kenmerken[t.i];
}

// Riet langs rivieroevers en meren in dit vakje, om en om aan beide kanten.
function oeverRiet(t, b, zet) {
  const geo = b.geo, half = geo.T / 2, w = b.water;
  const ci = Math.floor(t.y / CH) * Math.ceil(W / CH) + Math.floor(t.x / CH);
  const vlak = 1 - smooth(0.55, 0.72, t.hoogte);
  for (const si of w.perBrok[ci] ?? []) {
    const st = w.stukken[si], rv = w.rivieren[st.r], p = rv.pts;
    for (let i = st.a; i < st.e; i += 2) {
      const x = p[i * 2], y = p[i * 2 + 1];
      if (x < t.x - half || x >= t.x + half || y < t.y - half || y >= t.y + half) continue;
      if (hash(t.i, st.r * 4096 + i, 44) > 0.25 + 0.5 * vlak) continue;
      const a = Math.max(0, i - 1), c = Math.min(rv.br.length - 1, i + 1);
      let tx = p[c * 2] - p[a * 2], ty = p[c * 2 + 1] - p[a * 2 + 1];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const kant = hash(t.i, st.r * 4096 + i, 46) < 0.5 ? 1 : -1, d = rv.br[i] / 2 + 0.25 + hash(t.i, i, 47) * 0.55;
      const rx = x - ty * d * kant, ry = y + tx * d * kant;
      if (zoetOp(b, rx, ry) < 0.08 || sdOp(b, rx, ry) > -0.6) continue;
      zet(RIET, rx - t.x, ry - t.y, 0.28 + hash(t.i, i, 48) * 0.22, hash(t.i, i, 49) < 0.5 ? 0 : 1, hash(t.i, i, 50));
    }
  }
  // meeroevers: een rooster afzoeken naar de rand van het water
  if (veldOp(w.meer, t.x, t.y) < 10) {
    for (let q = 0; q < 36; q++) {
      const x = -half + ((q % 6) + hash(t.i, q, 52)) * (geo.T / 6), y = -half + (Math.floor(q / 6) + hash(t.i, q, 53)) * (geo.T / 6);
      const md = veldOp(w.meer, t.x + x, t.y + y);
      if (md < 0.1 || md > 1.1 || hash(t.i, q, 54) > 0.6) continue;
      zet(RIET, x, y, 0.3 + hash(t.i, q, 55) * 0.2, hash(t.i, q, 56) < 0.5 ? 0 : 1, hash(t.i, q, 57));
    }
  }
}

// Boerderij: erf met huis, schuur en silo, gedraaid mee met het akkerrooster, en een paar erfbomen.
function boerderij(t, b, zet, r) {
  const geo = b.geo, hoek = hash(t.eig, 9) * Math.PI, co = Math.cos(hoek), si = Math.sin(hoek);
  for (let poging = 0; poging < 4; poging++) {
    const x = (r() - 0.5) * geo.T * 0.55, y = (r() - 0.5) * geo.T * 0.55;
    let ok = true;
    for (const [u, v] of [[-2.6, -2], [2.6, -2], [-2.6, 2], [2.6, 2], [0, 0]]) {
      const px = t.x + x + u * co - v * si, py = t.y + y + u * si + v * co;
      if (sdOp(b, px, py) > -1 || zoetOp(b, px, py) < 0.6) { ok = false; break; }
    }
    if (!ok) continue;
    zet(BOERDERIJ, x, y, 1, r(), hoek);
    for (let q = 0; q < 3; q++) {
      const u = (r() < 0.5 ? -1 : 1) * (2.4 + r() * 0.8), v = (r() - 0.5) * 3.6;
      zet(LOSBOOM, x + u * co - v * si, y + u * si + v * co, 0.6 + r() * 0.35, 1 + Math.floor(r() * 2), r());
    }
    return;
  }
}

// Ligt een gedraaide rechthoek (midden x, y; halve maten hu langs (co, si), hv dwars) helemaal op het droge?
// Eerst snel via de afstandsvelden in het midden; anders een rooster van monsters met hooguit een eenheid ertussen,
// want alleen de hoeken toetsen liet een smalle rivier dwars door een lange akker lopen.
function droogVlak(b, x, y, hu, hv, co, si) {
  const diag = Math.hypot(hu, hv), md = veldOp(b.water.meer, x, y);
  // het meerveld loopt 1,75 per eenheid op (plus ruis); VER betekent: buiten het bereik van elk meer
  if (sdOp(b, x, y) < -(diag + 0.8) && veldOp(b.water.rivier, x, y) > diag + 0.5 && (md >= VER - 0.01 || md > 1.75 * (diag + 0.5) + 1.1)) return true;
  const nu = Math.max(2, Math.ceil(2 * hu)), nv = Math.max(2, Math.ceil(2 * hv));
  for (let i = 0; i <= nu; i++) {
    const u = ((i / nu) * 2 - 1) * hu;
    for (let j = 0; j <= nv; j++) {
      const v = ((j / nv) * 2 - 1) * hv, px = x + u * co - v * si, py = y + u * si + v * co;
      if (sdOp(b, px, py) > -0.6 || zoetOp(b, px, py) < 0.3) return false;
    }
  }
  return true;
}

// Lappendeken van akkers op een gedraaid rooster per land: buurvakjes van hetzelfde land lopen door.
// Een perceel hoort bij het vakje waarin zijn midden ligt en bestaat waar het akkergewicht boven 0,5 ligt.
// Elk perceel krijgt een gewas, een rijrichting en een rand (heg, muurtje, sloot of zandpad).
function percelen(t, b, zet, g) {
  const geo = b.geo, half = geo.T / 2;
  const hoek = hash(t.eig, 9) * Math.PI, co = Math.cos(hoek), si = Math.sin(hoek);
  const cu = 5.5 + hash(t.eig, 11) * 2, cv = 4 + hash(t.eig, 12) * 1.5;
  const helling = b.bergvoet[t.i] || t.hoogte > 0.58, bijStad = b.stad[t.i];
  // het rooster in gedraaide coördinaten (u langs, v dwars) dat dit vakje raakt
  const hoeken = [[-half, -half], [half, -half], [-half, half], [half, half]];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [dx, dy] of hoeken) {
    const x = t.x + dx, y = t.y + dy, u = x * co + y * si, v = -x * si + y * co;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  // Elke rij (strook dwars op v) heeft een eigen perceellengte en verschuiving, zoals bij echte verkaveling.
  for (let bb = Math.floor(v0 / cv); bb <= Math.floor(v1 / cv); bb++) {
    const rl = cu * (0.7 + 0.7 * hash(t.eig * 131 + bb, 15)), rv = hash(t.eig * 131 + bb, 16) * rl;
    for (let a = Math.floor((u0 - rv) / rl); a <= Math.floor((u1 - rv) / rl); a++) {
      const deel = hash(t.eig * 131 + a, bb, 13) < 0.4 ? 0.3 + 0.4 * hash(t.eig * 131 + a, bb, 17) : 1;
      for (let d = 0; d < (deel < 1 ? 2 : 1); d++) {
        const lu = rl * (d === 0 ? deel : 1 - deel);
        const u = rv + a * rl + (d === 0 ? lu / 2 : rl * deel + lu / 2), v = (bb + 0.5) * cv;
        const x = u * co - v * si, y = u * si + v * co;
        if (x < t.x - half || x >= t.x + half || y < t.y - half || y >= t.y + half) continue;
        if (gewichtenOp(b, x, y, g)[AKKER] <= 0.5) continue;
        const hu = lu / 2 - 0.2, hv = cv / 2 - 0.2;
        // geen akker die in zee, een meer of een rivier steekt (ook niet tussen de hoeken door)
        if (!droogVlak(b, x, y, hu, hv, co, si)) continue;
        const zaad = t.eig * 131 + a, k = hash(zaad, bb * 7 + d, 14);
        let soort = k < 0.27 ? GRAAN : k < 0.39 ? GROEN : k < 0.51 ? PLOEG : k < 0.61 ? KOOLZAAD : k < 0.75 ? WEI : k < 0.85 ? MAIS : k < 0.9 ? BRAAK : BOOMGAARD;
        const k2 = hash(zaad, bb * 7 + d, 19);
        if (helling && k2 < 0.45) soort = WIJN;
        else if (bijStad && k2 < 0.3) soort = KAS;
        const rijen = hash(zaad, bb * 7 + d, 18) < 0.5 ? 16 : 0;
        const k3 = hash(zaad, bb * 7 + d, 20);
        const rand = k3 < 0.14 ? ZANDPAD : t.hoogte > 0.56 && k3 < 0.7 ? MUUR : t.hoogte < 0.47 && k3 < 0.65 ? SLOOT : HAAGRAND;
        zet(PERCEEL, x - t.x, y - t.y, hu, soort | rijen | (rand << 5), hv);
        // strobalen op een deel van de graanakkers; ze zijn alleen te zien rond de oogst
        if (soort === GRAAN && hash(zaad, bb * 7 + d, 21) < 0.6) {
          const n = 2 + Math.floor(hash(zaad, bb, 22) * 4);
          for (let q = 0; q < n; q++) {
            const bu = (hash(zaad, bb * 31 + q, 23) - 0.5) * (2 * hu - 1.2), bv = (hash(zaad, bb * 31 + q, 24) - 0.5) * (2 * hv - 1.2);
            zet(BAAL, x - t.x + bu * co - bv * si, y - t.y + bu * si + bv * co, 0.22 + hash(zaad, q, 25) * 0.05, 0);
          }
        }
      }
    }
  }
}

// ---------- seizoenspalet ----------

const css = (c, a = 1) => (a >= 0.999 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`);
const mengH = (a, b, t) => meng(typeof a === 'string' ? hex(a) : a, typeof b === 'string' ? hex(b) : b, Math.max(0, Math.min(1, t)), [0, 0, 0]);

// Seizoen in stappen: de brokken hoeven dan maar eens per 12 dagen opnieuw gebakken te worden.
export const seizoensStap = (dag) => Math.floor((dag ?? 0) / SEIZOEN_STAP);
export const seizoenVanStap = (stap) => seizoen(stap * SEIZOEN_STAP + SEIZOEN_STAP / 2);

// Alle kleuren die van het seizoen afhangen, als CSS-tekst. Gedeeld door bakken en de scherpe laag.
export function palet(sz) {
  const som = sz.winter + sz.lente + sz.zomer + sz.herfst || 1;
  const seiz = (w, l, z, h) => {
    const a = hex(w), b = hex(l), c = hex(z), d = hex(h);
    return [0, 1, 2].map((i) => (a[i] * sz.winter + b[i] * sz.lente + c[i] * sz.zomer + d[i] * sz.herfst) / som);
  };
  const A = 0.3 * smooth(0.45, 0.85, sz.koud) + 0.28 * sz.sneeuw;
  const kap = smooth(0.12, 0.42, A), ijs = smooth(0.86, 0.97, sz.koud);
  const wit = hex('#e9edf0');
  const veldBasis = [];
  veldBasis[GRAAN] = mengH(seiz('#6f8a4e', '#7fa452', '#c9b45e', '#b9a473'), '#dcbc52', sz.oogst);
  veldBasis[GROEN] = seiz('#7a6448', '#7a9a50', '#5f8f3e', '#86744a');
  veldBasis[PLOEG] = seiz('#86735e', '#866646', '#7d5f3f', '#76573a');
  veldBasis[KOOLZAAD] = mengH(seiz('#4f7a3a', '#86a03e', '#8c8a4a', '#6a8a46'), '#e6d23a', sz.bloei * 1.8);
  veldBasis[WEI] = seiz('#7b8462', '#7fa851', '#7a9a4c', '#83904e');
  veldBasis[BOOMGAARD] = seiz('#7d8462', '#7aa04e', '#749a4a', '#82904e');
  veldBasis[WIJN] = seiz('#8a7c5c', '#968a5c', '#9a8a5c', '#93825a');
  veldBasis[KAS] = hex('#b9cdd2');
  veldBasis[MAIS] = seiz('#a39470', '#8a7a52', '#4f7a32', '#b8a050');
  veldBasis[BRAAK] = seiz('#8a8a6a', '#8f9a58', '#8f9258', '#8e8858');
  const veld = [], rij = [];
  for (let s = 0; s < PSOORTEN; s++) {
    veld[s] = []; rij[s] = [];
    for (let nv = 0; nv < 4; nv++) {
      const sneeuwT = s === KAS ? 0 : [0, 0.35, 0.62, 0.88][nv];
      const v = meng(veldBasis[s], wit, sneeuwT, [0, 0, 0]);
      veld[s][nv] = css(v);
      const donker = s === PLOEG ? 0.68 : s === MAIS ? 0.7 : 0.8;
      rij[s][nv] = css([v[0] * donker, v[1] * donker, v[2] * donker], s === PLOEG ? 0.8 : 0.6);
    }
  }
  const grasRij = sz.lente + sz.zomer;
  return {
    sz, A, kap, ijs,
    sneeuwVeld: A,
    groei: Math.min(1, sz.lente + sz.zomer + 0.3 * sz.herfst) * (1 - smooth(0.2, 0.5, A)),
    veld, rij,
    weiStreep: grasRij > 0.05 ? css(mengH(veldBasis[WEI], '#c8dc90', 0.3), 0.3 * grasRij) : null,
    gaardKroon: css(seiz('#6b5a48', '#f2e6ea', '#4f7f3a', '#c89a3a'), 1 - 0.5 * sz.winter),
    gaardBloesem: css(hex('#f0c2d4'), smooth(0.05, 0.3, sz.bloei)),
    gaardLicht: css(seiz('#8a7a66', '#ffffff', '#6f9f50', '#e0b860'), 0.8 - 0.5 * sz.winter),
    fruit: css(hex('#c0392b'), smooth(0.2, 0.6, sz.oogst)),
    wijnRij: css(seiz('#6a5440', '#88a84e', '#5e8a3a', '#b0582a')),
    wijnLicht: css(seiz('#8a7460', '#a8c86a', '#7aaa52', '#d08a40'), 0.7),
    kasLijn: 'rgba(120,150,158,0.8)', kasLicht: 'rgba(245,252,255,0.7)',
    haag: css(mengH(seiz('#4a5a38', '#4f7034', '#4d6b35', '#6a6a34'), wit, kap * 0.35)),
    haagLicht: css(mengH(seiz('#667060', '#6e9446', '#6a8c48', '#90883e'), wit, kap * 0.6), 0.9),
    muur: '#9e978a', muurVoeg: 'rgba(70,64,56,0.7)',
    sloot: css(mengH('#4d6f70', '#bccdd2', ijs * 0.8)), slootRand: 'rgba(52,60,34,0.55)',
    pad: css(mengH('#b6a47a', wit, kap * 0.5)), padLicht: css(mengH('#cbbb90', wit, kap * 0.5)),
    balen: Math.max(smooth(0.2, 0.55, sz.oogst), sz.herfst * 0.6 * (1 - sz.winter)),
    baal: '#d6bf74', baalLicht: '#ecd896', baalRand: 'rgba(120,100,50,0.7)',
    kroon: [
      css(mengH('#22402e', '#1e3a2a', sz.winter)),
      css(seiz('#6a5a48', '#4e7a3a', '#30552f', '#b8692a'), 1 - 0.42 * sz.winter),
      css(seiz('#6a5a48', '#5a8640', '#335a30', '#a3442a'), 1 - 0.42 * sz.winter),
      css(seiz('#6a5a48', '#5f8e44', '#3f6b3a', '#c9a032'), 1 - 0.42 * sz.winter),
      css(seiz('#6a5a48', '#6a9648', '#41703c', '#8a7a2e'), 1 - 0.42 * sz.winter),
    ],
    naaldLicht: '#3a6244',
    loofLicht: css(seiz('#9a8a74', '#86b05a', '#5a8a4a', '#d8a050'), 1 - 0.6 * sz.winter),
    kaal: sz.winter,
    stam: 'rgba(60,46,34,0.9)',
    pluk: [css(seiz('#7a7a5a', '#3e6a2a', '#3e5c2a', '#6a6a3a'), 0.8), css(seiz('#a8a080', '#9ac060', '#96b460', '#b0a060'), 0.8)],
    helm: [css(seiz('#a8a07a', '#b0b07a', '#b8b27c', '#b4a874'), 0.85), css(seiz('#8e8a68', '#94985e', '#9a9a62', '#9a9060'), 0.85)],
    riet: css(seiz('#b0a070', '#7a9a48', '#6f8a3a', '#a08a50')), rietLicht: css(seiz('#c8b88a', '#9aba60', '#8aa850', '#c0a868'), 0.8),
    rietKop: css(hex('#5a3a22'), 1 - 0.5 * sz.winter),
    plas: css(mengH(seiz('#3f6a66', '#3f706a', '#3d6c66', '#45706a'), '#c0d4da', ijs)),
    plasRand: 'rgba(70,64,40,0.7)', plasLicht: css(hex('#e6f4f4'), 0.35 + 0.3 * ijs),
    rivier: css(mengH('#3f7f8c', '#b8ccd2', ijs * 0.55)), rivierDiep: css(mengH('#2c6678', '#a8bec6', ijs * 0.5), 0.6),
    oever: 'rgba(72,66,42,0.5)', glinster: css(hex('#e6f6fa'), 0.6 * (1 - ijs * 0.7)), schuim: css(hex('#f4fbfc'), 0.7 * (1 - ijs * 0.8)),
    steen: css(mengH('#8b867b', wit, 0)), steenLicht: '#b3ad9f', mos: css(hex('#6f7f45'), 1 - kap),
    sneeuwKap: css(hex('#f0f4f8'), 0.9 * kap),
    erf: 'rgba(150,135,100,0.6)',
    dakHuis: [['#b0503a', '#7d3626'], ['#6f747a', '#4a4e54'], ['#b49a5c', '#8a7444']].map(([l, d]) => [css(mengH(l, wit, kap * 0.85)), css(mengH(d, '#c8cdd2', kap * 0.85))]),
    dakSchuur: [['#8a8c88', '#5e605c'], ['#8a3a2e', '#5e2620']].map(([l, d]) => [css(mengH(l, wit, kap * 0.85)), css(mengH(d, '#c8cdd2', kap * 0.85))]),
    silo: '#c9c4b6', siloDonker: '#8e897c', siloLicht: '#ecebe4',
    moestuin: css(seiz('#7a6a50', '#6f9a48', '#5f8e3e', '#8a7a48')),
    bloemen: sz.lente * 1 + sz.zomer * 0.7 + sz.herfst * 0.15,
    herfst: sz.herfst, zomer: sz.zomer,
  };
}

// ---------- kenmerken tekenen (gedeeld door bakken en scherpe laag) ----------

export const nieuweEmmers = () => Array.from({ length: TYPES }, () => []);

// Hoek van het akkerrooster van een land (zelfde als in percelen()).
const hoekVan = (t) => hash(t.eig, 9) * Math.PI;

// Tekent de kenmerken van de vakjes in `lijst` (n stuks) in wereldcoördinaten; de aanroeper zet de transformatie.
// k = pixels per wereldeenheid (voor minimale lijndiktes en fijne details). Per kleur één pad.
// opties: { schaduw, zwaai (null of tijd in ms), pal (palet), wind ({hoek, kracht}), emmers (herbruikbaar) }
function tekenLagen(c, b, lijst, n, k, opties) {
  const tegels = b.geo.tegels, pal = opties.pal, zwaai = opties.zwaai;
  const pix = 1 / k, fijn = k >= 6;
  const em = opties.emmers;
  for (let q = 0; q < TYPES; q++) em[q].length = 0;
  for (let q = 0; q < n; q++) {
    const ti = lijst[q], f = kenmerkenVoorTegel(tegels[ti], b);
    for (let p = 0; p < f.length; p += STAP) em[f[p]].push(ti, p);
  }
  const elk = (type, fn) => {
    const e = em[type];
    for (let q = 0; q < e.length; q += 2) fn(tegels[e[q]], b.kenmerken[e[q]], e[q + 1]);
  };
  const rond = (x, y, r) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); };
  const vul = (kleur, fn) => { c.beginPath(); let iets = false; fn(() => { iets = true; }); if (iets) { c.fillStyle = kleur; c.fill(); } };
  const lijn = (kleur, breedte, fn, streep) => {
    c.beginPath(); let iets = false; fn(() => { iets = true; });
    if (!iets) return;
    if (streep) c.setLineDash(streep);
    c.strokeStyle = kleur; c.lineWidth = breedte; c.stroke();
    if (streep) c.setLineDash([]);
  };
  // wind: richting en een golf die over het land trekt; alleen in de scherpe laag
  const wx = opties.wind ? Math.cos(opties.wind.hoek) : 0, wy = opties.wind ? Math.sin(opties.wind.hoek) : 0;
  const kracht = opties.wind ? opties.wind.kracht : 0, tijd = zwaai == null ? 0 : zwaai / 1000;
  const golf = (x, y) => (zwaai == null ? 0 : 0.6 + 0.4 * Math.sin(tijd * 2.3 - (x * wx + y * wy) * 0.55));

  // 1. akkers: vlakken per gewas en sneeuwniveau, dan rijen, maaistroken, bomen, glas en randen
  const vierhoek = (x, y, hu, hv, co, si) => {
    c.moveTo(x - hu * co + hv * si, y - hu * si - hv * co);
    c.lineTo(x + hu * co + hv * si, y + hu * si - hv * co);
    c.lineTo(x + hu * co - hv * si, y + hu * si + hv * co);
    c.lineTo(x - hu * co - hv * si, y - hu * si + hv * co);
    c.closePath();
  };
  const niveau = (x, y) => {
    if (pal.sneeuwVeld <= 0.01) return 0;
    const h = hash(Math.round(x * 10), Math.round(y * 10), 71);
    return Math.min(3, Math.floor(Math.max(0, Math.min(0.999, pal.sneeuwVeld * 1.9 - h * 0.85)) * 4));
  };
  const perceelLijst = em[PERCEEL];
  const sleutel = opties.sleutels ?? (opties.sleutels = []);
  for (let q = 0; q < PSOORTEN * 4; q++) (sleutel[q] ??= []).length = 0;
  for (let q = 0; q < perceelLijst.length; q += 2) {
    const t = tegels[perceelLijst[q]], f = b.kenmerken[perceelLijst[q]], p = perceelLijst[q + 1];
    const soort = f[p + 4] & 15, nv = niveau(t.x + f[p + 1], t.y + f[p + 2]);
    sleutel[soort * 4 + nv].push(q);
  }
  for (let key = 0; key < PSOORTEN * 4; key++) {
    const l = sleutel[key];
    if (!l.length) continue;
    c.beginPath();
    for (const q of l) {
      const t = tegels[perceelLijst[q]], f = b.kenmerken[perceelLijst[q]], p = perceelLijst[q + 1], h = hoekVan(t);
      vierhoek(t.x + f[p + 1], t.y + f[p + 2], f[p + 3], f[p + 5], Math.cos(h), Math.sin(h));
    }
    c.fillStyle = pal.veld[key >> 2][key & 3];
    c.fill();
  }
  // gewasrijen: lijnen langs of dwars over het perceel
  const rijen = (soort, tussen, nvBoven) => {
    lijn(pal.rij[soort][nvBoven ? 2 : 0], Math.max(soort === WIJN ? 0.16 : 0.12, (soort === PLOEG ? 0.75 : 0.6) * pix), (iets) => {
      for (let key = soort * 4 + (nvBoven ? 2 : 0); key < soort * 4 + (nvBoven ? 4 : 2); key++) {
        for (const q of sleutel[key]) {
          const t = tegels[perceelLijst[q]], f = b.kenmerken[perceelLijst[q]], p = perceelLijst[q + 1];
          iets();
          const h = hoekVan(t) + ((f[p + 4] & 16) ? Math.PI / 2 : 0), co = Math.cos(h), si = Math.sin(h);
          const dwars = (f[p + 4] & 16) !== 0;
          const x = t.x + f[p + 1], y = t.y + f[p + 2], hu = (dwars ? f[p + 5] : f[p + 3]) - 0.15, hv = dwars ? f[p + 3] : f[p + 5];
          for (let v = -hv + tussen / 2; v < hv; v += tussen) {
            c.moveTo(x - hu * co - v * si, y - hu * si + v * co);
            c.lineTo(x + hu * co - v * si, y + hu * si + v * co);
          }
        }
      }
    });
  };
  for (const [s, tussen] of [[GRAAN, 0.6], [GROEN, 0.7], [PLOEG, 0.5], [KOOLZAAD, 0.7], [MAIS, 0.75], [WIJN, 0.9]]) { rijen(s, tussen, false); rijen(s, tussen, true); }
  // wijngaard: lichte kant van elke rij (zon uit het noordwesten)
  const wijnLicht = () => lijn(pal.wijnLicht, Math.max(0.08, 0.4 * pix), (iets) => {
    for (let key = WIJN * 4; key < WIJN * 4 + 4; key++) {
      for (const q of sleutel[key]) {
        const t = tegels[perceelLijst[q]], f = b.kenmerken[perceelLijst[q]], p = perceelLijst[q + 1];
        iets();
        const dwars = (f[p + 4] & 16) !== 0, h = hoekVan(t) + (dwars ? Math.PI / 2 : 0), co = Math.cos(h), si = Math.sin(h);
        const x = t.x + f[p + 1] - 0.07, y = t.y + f[p + 2] - 0.07, hu = (dwars ? f[p + 5] : f[p + 3]) - 0.15, hv = dwars ? f[p + 3] : f[p + 5];
        for (let v = -hv + 0.45; v < hv; v += 0.9) { c.moveTo(x - hu * co - v * si, y - hu * si + v * co); c.lineTo(x + hu * co - v * si, y + hu * si + v * co); }
      }
    }
  });
  if (fijn) wijnLicht();
  // weide: brede maaistroken in lente en zomer
  if (pal.weiStreep) vul(pal.weiStreep, (iets) => {
    for (let key = WEI * 4; key < WEI * 4 + 2; key++) {
      for (const q of sleutel[key]) {
        const t = tegels[perceelLijst[q]], f = b.kenmerken[perceelLijst[q]], p = perceelLijst[q + 1];
        iets();
        const h = hoekVan(t), co = Math.cos(h), si = Math.sin(h), x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3], hv = f[p + 5];
        for (let v = -hv + 0.8; v < hv - 0.4; v += 1.6) {
          const m = Math.min(0.8, hv - v) / 2, vm = v + m;
          vierhoek(x - vm * si, y + vm * co, hu, m, co, si);
        }
      }
    }
  });
  // kassen: glasvlakken met spanten en een glimlicht
  const kassen = [];
  for (let key = KAS * 4; key < KAS * 4 + 4; key++) for (const q of sleutel[key]) kassen.push(q);
  if (kassen.length) {
    lijn(pal.kasLijn, Math.max(0.06, 0.4 * pix), (iets) => {
      for (const q of kassen) {
        const t = tegels[perceelLijst[q]], f = b.kenmerken[perceelLijst[q]], p = perceelLijst[q + 1];
        iets();
        const h = hoekVan(t), co = Math.cos(h), si = Math.sin(h), x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3], hv = f[p + 5];
        for (let u = -hu + 0.6; u < hu; u += 0.6) { c.moveTo(x + u * co + hv * si, y + u * si - hv * co); c.lineTo(x + u * co - hv * si, y + u * si + hv * co); }
        c.moveTo(x - hu * co, y - hu * si); c.lineTo(x + hu * co, y + hu * si);
      }
    });
    lijn(pal.kasLicht, Math.max(0.1, 0.5 * pix), (iets) => {
      for (const q of kassen) {
        const t = tegels[perceelLijst[q]], f = b.kenmerken[perceelLijst[q]], p = perceelLijst[q + 1];
        iets();
        const h = hoekVan(t), co = Math.cos(h), si = Math.sin(h), x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3] * 0.8, hv = f[p + 5] * 0.5;
        c.moveTo(x - hu * co + hv * si, y - hu * si - hv * co); c.lineTo(x - hu * 0.3 * co + hv * si, y - hu * 0.3 * si - hv * co);
      }
    });
  }
  // boomgaard: bomen in rijen; bloesem in de lente, fruit rond de oogst, kaal in de winter
  const gaard = [];
  for (let key = BOOMGAARD * 4; key < BOOMGAARD * 4 + 4; key++) for (const q of sleutel[key]) gaard.push(q);
  if (gaard.length) {
    const elkeGaardboom = (fn) => {
      for (const q of gaard) {
        const t = tegels[perceelLijst[q]], f = b.kenmerken[perceelLijst[q]], p = perceelLijst[q + 1];
        const h = hoekVan(t), co = Math.cos(h), si = Math.sin(h), x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3], hv = f[p + 5];
        let i = 0;
        for (let u = -hu + 0.6; u < hu - 0.3; u += 1.25) for (let v = -hv + 0.6; v < hv - 0.3; v += 1.25) fn(x + u * co - v * si, y + u * si + v * co, i++);
      }
    };
    if (opties.schaduw) vul('rgba(10,20,8,0.35)', (iets) => elkeGaardboom((x, y) => { iets(); rond(x + 0.14, y + 0.17, 0.4); }));
    vul(pal.gaardKroon, (iets) => elkeGaardboom((x, y) => { iets(); rond(x, y, 0.4); }));
    vul(pal.gaardBloesem, (iets) => elkeGaardboom((x, y, i) => { if (i % 2) { iets(); rond(x, y, 0.36); } }));
    vul(pal.gaardLicht, (iets) => elkeGaardboom((x, y) => { iets(); rond(x - 0.12, y - 0.13, 0.17); }));
    if (fijn && pal.sz.oogst > 0.2) vul(pal.fruit, (iets) => elkeGaardboom((x, y, i) => { iets(); rond(x + 0.15 * ((i % 3) - 1), y + 0.12, 0.07); rond(x - 0.12, y - 0.04 * (i % 2), 0.06); }));
  }
  // windvlagen over het gewas (alleen de scherpe laag): op de velden, onder heggen, balen, boerderijen en bomen
  if (opties.naVelden) opties.naVelden();
  // randen: heg, stenen muurtje, sloot of zandpad
  const randen = (soort, fn) => {
    for (let q = 0; q < perceelLijst.length; q += 2) {
      const t = tegels[perceelLijst[q]], f = b.kenmerken[perceelLijst[q]], p = perceelLijst[q + 1];
      if ((f[p + 4] >> 5) !== soort) continue;
      const h = hoekVan(t);
      fn(t.x + f[p + 1], t.y + f[p + 2], f[p + 3] + 0.1, f[p + 5] + 0.1, Math.cos(h), Math.sin(h));
    }
  };
  const randPad = (soort, dx, dy) => (iets) => randen(soort, (x, y, hu, hv, co, si) => { iets(); vierhoek(x + dx, y + dy, hu, hv, co, si); });
  lijn('rgba(12,22,8,0.3)', Math.max(0.3, 0.9 * pix), randPad(HAAGRAND, 0.13, 0.15));
  lijn(pal.haag, Math.max(0.3, 0.8 * pix), randPad(HAAGRAND, 0, 0));
  if (fijn) lijn(pal.haagLicht, 0.14, randPad(HAAGRAND, -0.06, -0.06), [0.22, 0.3]);
  lijn('rgba(20,18,12,0.3)', Math.max(0.16, 0.6 * pix), randPad(MUUR, 0.09, 0.11));
  lijn(pal.muur, Math.max(0.18, 0.6 * pix), randPad(MUUR, 0, 0));
  if (fijn) lijn(pal.muurVoeg, 0.2, randPad(MUUR, 0, 0), [0.3, 0.07]);
  lijn(pal.slootRand, Math.max(0.36, 0.9 * pix), randPad(SLOOT, 0, 0));
  lijn(pal.sloot, Math.max(0.16, 0.5 * pix), randPad(SLOOT, 0, 0));
  lijn(pal.pad, Math.max(0.4, 0.9 * pix), randPad(ZANDPAD, 0, 0));
  if (fijn) lijn(pal.padLicht, 0.18, randPad(ZANDPAD, -0.04, -0.04));
  // strobalen: rond de oogst
  if (pal.balen > 0.05) {
    const ga = c.globalAlpha; // precies terugzetten: delen door een kleine factor geeft afrondingsfouten
    c.globalAlpha = ga * pal.balen;
    vul('rgba(30,24,10,0.35)', (iets) => elk(BAAL, (t, f, p) => { iets(); rond(t.x + f[p + 1] + 0.1, t.y + f[p + 2] + 0.12, f[p + 3]); }));
    vul(pal.baal, (iets) => elk(BAAL, (t, f, p) => { iets(); rond(t.x + f[p + 1], t.y + f[p + 2], f[p + 3]); }));
    if (fijn) vul(pal.baalLicht, (iets) => elk(BAAL, (t, f, p) => { iets(); rond(t.x + f[p + 1] - 0.06, t.y + f[p + 2] - 0.07, f[p + 3] * 0.5); }));
    c.globalAlpha = ga;
  }

  // 2. plassen in het moeras: modderrand, water, glans
  const ovaal = (x, y, rx, ry, h) => { c.moveTo(x + rx * Math.cos(h), y + rx * Math.sin(h)); c.ellipse(x, y, rx, ry, h, 0, Math.PI * 2); };
  vul(pal.plasRand, (iets) => elk(PLAS, (t, f, p) => { iets(); ovaal(t.x + f[p + 1], t.y + f[p + 2], f[p + 3] + 0.22, f[p + 3] * 0.62 + 0.22, f[p + 5]); }));
  vul(pal.plas, (iets) => elk(PLAS, (t, f, p) => { iets(); ovaal(t.x + f[p + 1], t.y + f[p + 2], f[p + 3], f[p + 3] * 0.62, f[p + 5]); }));
  if (fijn) lijn(pal.plasLicht, 0.12, (iets) => elk(PLAS, (t, f, p) => {
    iets();
    const x = t.x + f[p + 1] - f[p + 3] * 0.25, y = t.y + f[p + 2] - f[p + 3] * 0.2;
    c.moveTo(x - f[p + 3] * 0.35, y); c.quadraticCurveTo(x, y - f[p + 3] * 0.18, x + f[p + 3] * 0.3, y - f[p + 3] * 0.05);
  }));

  // kleine dingen (alleen de scherpe laag): bloemen, lelies, paddenstoelen; onder gras, riet, rotsen, boerderijen en
  // bomen, zodat een paddenstoel niet boven op een boomkruin ligt
  if (opties.naPlassen) opties.naPlassen();

  // 3. grasplukjes, helm en riet; in de wind buigen de toppen mee
  c.lineWidth = Math.max(0.08, 0.5 * pix);
  const pollen = (type, kleuren, hoog) => {
    for (let s = 0; s < 2; s++) {
      lijn(kleuren[s], Math.max(0.08, 0.5 * pix), (iets) => elk(type, (t, f, p) => {
        if (f[p + 4] !== s) return;
        iets();
        const x = t.x + f[p + 1], y = t.y + f[p + 2], r = f[p + 3];
        const buig = r * (0.12 + 0.4 * kracht) * golf(x, y), bx = wx * buig, by = wy * buig * 0.5;
        c.moveTo(x - r * 0.35 + bx, y - r * hoog + by); c.lineTo(x, y); c.lineTo(x + r * 0.35 + bx, y - r * hoog + by);
        c.moveTo(x, y); c.lineTo(x + r * 0.05 + bx * 1.2, y - r * hoog * 1.15 + by);
      }));
    }
  };
  pollen(PLUK, pal.pluk, 1);
  pollen(HELM, pal.helm, 1.25);
  lijn(pal.riet, Math.max(0.07, 0.45 * pix), (iets) => elk(RIET, (t, f, p) => {
    iets();
    const x = t.x + f[p + 1], y = t.y + f[p + 2], r = f[p + 3];
    const buig = r * (0.1 + 0.35 * kracht) * golf(x, y), bx = wx * buig, by = wy * buig * 0.4;
    for (let q = -2; q <= 2; q++) { c.moveTo(x + q * 0.05, y); c.lineTo(x + q * r * 0.22 + bx, y - r * (1.25 + 0.15 * ((q * 7 + f[p + 5] * 10) % 3)) + by); }
  }));
  if (fijn) {
    lijn(pal.rietLicht, 0.06, (iets) => elk(RIET, (t, f, p) => {
      if (f[p + 4] !== 1) return;
      iets();
      const x = t.x + f[p + 1], y = t.y + f[p + 2], r = f[p + 3];
      const buig = r * (0.1 + 0.35 * kracht) * golf(x, y);
      c.moveTo(x - 0.04, y); c.lineTo(x - r * 0.3 + wx * buig, y - r * 1.1 + wy * buig * 0.4);
    }));
    if (k >= 8) vul(pal.rietKop, (iets) => elk(RIET, (t, f, p) => {
      if (f[p + 5] > 0.5) return;
      iets();
      const x = t.x + f[p + 1], y = t.y + f[p + 2], r = f[p + 3];
      const buig = r * (0.1 + 0.35 * kracht) * golf(x, y);
      rond(x + r * 0.22 + wx * buig, y - r * 1.3 + wy * buig * 0.4, 0.06);
    }));
  }

  // 4. kust: kiezels en drijfhout
  for (let s = 0; s < 2; s++) vul(s ? '#8f8a80' : '#bdb6a6', (iets) => elk(KIEZEL, (t, f, p) => { if (f[p + 4] === s) { iets(); rond(t.x + f[p + 1], t.y + f[p + 2], f[p + 3]); } }));
  lijn('#8a7458', Math.max(0.16, 0.8 * pix), (iets) => elk(DRIJFHOUT, (t, f, p) => {
    iets();
    const x = t.x + f[p + 1], y = t.y + f[p + 2], l = f[p + 3], h = f[p + 4];
    c.moveTo(x - Math.cos(h) * l, y - Math.sin(h) * l); c.lineTo(x + Math.cos(h) * l, y + Math.sin(h) * l);
  }));

  // 5. rotsen: schaduw, lijf, belichte kant, sneeuw, gruis; keien in het gras met mos
  const veelhoek = (x, y, r, zaad, schaal, dx, dy) => {
    for (let q = 0; q < 6; q++) {
      const a = (q / 6) * Math.PI * 2 + zaad * 2;
      const rr = r * schaal * (0.75 + 0.35 * hash(Math.floor(zaad * 1e6), q, 21));
      const px = x + dx + Math.cos(a) * rr, py = y + dy + Math.sin(a) * rr * 0.85;
      if (q === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
  };
  if (opties.schaduw) {
    vul('rgba(25,22,18,0.4)', (iets) => {
      elk(ROTS, (t, f, p) => { iets(); const r = f[p + 3]; veelhoek(t.x + f[p + 1], t.y + f[p + 2], r, f[p + 4], 1.05, r * 0.3, r * 0.35); });
      elk(STEEN, (t, f, p) => { iets(); const r = f[p + 3]; veelhoek(t.x + f[p + 1], t.y + f[p + 2], r, f[p + 4], 1.05, r * 0.35, r * 0.4); });
    });
  }
  const rotsLaag = (type, kleur, schaal, dx, dy, filter) => vul(kleur, (iets) => elk(type, (t, f, p) => {
    if (filter && !filter(f, p)) return;
    iets();
    const r = f[p + 3];
    veelhoek(t.x + f[p + 1], t.y + f[p + 2], r, f[p + 4], schaal, dx * r, dy * r);
  }));
  rotsLaag(ROTS, '#5f584e', 1, 0, 0);
  rotsLaag(ROTS, '#9a9386', 0.68, -0.2, -0.22);
  rotsLaag(ROTS, '#eef0f2', 0.4, -0.26, -0.32, (f, p) => f[p + 5] > 0);
  rotsLaag(STEEN, pal.steen, 1, 0, 0);
  rotsLaag(STEEN, pal.steenLicht, 0.6, -0.22, -0.24);
  if (fijn) rotsLaag(STEEN, pal.mos, 0.35, 0.18, 0.1, (f, p) => f[p + 4] < 0.35);
  if (pal.kap > 0.02) {
    vul(pal.sneeuwKap, (iets) => {
      elk(ROTS, (t, f, p) => { if (f[p + 5] > 0) return; iets(); const r = f[p + 3]; veelhoek(t.x + f[p + 1], t.y + f[p + 2], r, f[p + 4], 0.5, -0.22 * r, -0.28 * r); });
      elk(STEEN, (t, f, p) => { iets(); const r = f[p + 3]; veelhoek(t.x + f[p + 1], t.y + f[p + 2], r, f[p + 4], 0.5, -0.2 * r, -0.25 * r); });
    });
  }
  vul('#8d877b', (iets) => elk(GRUIS, (t, f, p) => { iets(); rond(t.x + f[p + 1], t.y + f[p + 2], f[p + 3]); }));

  // 6. boerderijen: erf, schaduwen, daken (licht en donker vlak), nok, silo, moestuin
  if (em[BOERDERIJ].length) {
    const delen = (fn) => elk(BOERDERIJ, (t, f, p) => {
      const x = t.x + f[p + 1], y = t.y + f[p + 2], v = f[p + 4], h = f[p + 5], co = Math.cos(h), si = Math.sin(h);
      const op = (u, w) => [x + u * co - w * si, y + u * si + w * co];
      fn(op, co, si, v);
    });
    const blok = (op, co, si, u, w, hu, hv, dx = 0, dy = 0) => { const [px, py] = op(u, w); vierhoek(px + dx, py + dy, hu, hv, co, si); };
    vul(pal.erf, (iets) => delen((op, co, si) => { iets(); blok(op, co, si, 0, 0, 2.3, 1.75); }));
    if (fijn) vul(pal.moestuin, (iets) => delen((op, co, si) => { iets(); blok(op, co, si, -1, 1.15, 0.75, 0.38); }));
    vul('rgba(20,18,12,0.38)', (iets) => delen((op, co, si) => {
      iets();
      blok(op, co, si, -0.85, -0.5, 0.85, 0.55, 0.22, 0.27);
      blok(op, co, si, 0.75, 0.3, 1.2, 0.7, 0.26, 0.31);
      const [sx, sy] = op(1.65, -1.05); rond(sx + 0.2, sy + 0.24, 0.4);
    }));
    // dakvlak dat naar het noordwesten kijkt is licht: de -v-helft kijkt naar (si, -co), dus naar het noordwesten als co - si > 0
    const lichtBoven = (co, si) => co - si > 0;
    const daken = (lijst, kies, u, w, hu, hv) => {
      for (let vk = 0; vk < lijst.length; vk++) {
        for (let licht = 0; licht < 2; licht++) {
          vul(lijst[vk][licht ? 0 : 1], (iets) => delen((op, co, si, v) => {
            if (kies(v) !== vk) return;
            iets();
            const boven = lichtBoven(co, si) === (licht === 1);
            blok(op, co, si, u, w + (boven ? -hv / 2 : hv / 2), hu, hv / 2);
          }));
        }
      }
    };
    daken(pal.dakHuis, (v) => Math.floor(v * 3) % 3, -0.85, -0.5, 0.85, 0.55);
    daken(pal.dakSchuur, (v) => Math.floor(v * 7) % 2, 0.75, 0.3, 1.2, 0.7);
    if (fijn) lijn('rgba(40,30,20,0.55)', 0.07, (iets) => delen((op) => {
      iets();
      let [a, b2] = op(-1.7, -0.5); c.moveTo(a, b2); [a, b2] = op(0, -0.5); c.lineTo(a, b2);
      [a, b2] = op(-0.45, 0.3); c.moveTo(a, b2); [a, b2] = op(1.95, 0.3); c.lineTo(a, b2);
    }));
    vul(pal.silo, (iets) => delen((op) => { iets(); const [sx, sy] = op(1.65, -1.05); rond(sx, sy, 0.38); }));
    vul(pal.siloDonker, (iets) => delen((op) => { iets(); const [sx, sy] = op(1.65, -1.05); c.moveTo(sx + 0.38, sy); c.arc(sx, sy, 0.38, 0, Math.PI * 0.5 + 0.4); c.arc(sx + 0.08, sy + 0.08, 0.26, Math.PI * 0.5 + 0.4, 0, true); c.closePath(); }));
    vul(pal.siloLicht, (iets) => delen((op) => { iets(); const [sx, sy] = op(1.65, -1.05); rond(sx - 0.11, sy - 0.12, 0.12); }));
  }

  // 7. bomen: schaduw naar het zuidoosten, kroon per soort en seizoen, lichte kant naar het noordwesten, sneeuw
  // wiegen in de wind: alleen in de scherpe laag, een fractie van een eenheid
  const amp = 0.04 + 0.1 * kracht;
  const zx = (f, p) => (zwaai == null ? 0 : Math.sin(zwaai / 1300 + f[p + 5] * 6.283) * amp * wx + amp * 0.4 * wx);
  const zy = (f, p) => (zwaai == null ? 0 : Math.sin(zwaai / 1300 + f[p + 5] * 6.283) * amp * wy + amp * 0.4 * wy);
  const bomen = (fn) => { elk(BOOM, fn); elk(LOSBOOM, fn); };
  const groep = (f, p) => (f[p + 4] === 0 ? 0 : 1 + (f[p + 4] - 1) * 2 + (f[p + 5] < 0.5 ? 0 : 1));
  if (opties.schaduw) {
    vul('rgba(8,18,8,0.42)', (iets) => bomen((t, f, p) => { if (f[p + 4] !== 0) return; iets(); const r = f[p + 3]; rond(t.x + f[p + 1] + r * 0.32, t.y + f[p + 2] + r * 0.38, r * 1.02); }));
    vul(`rgba(8,18,8,${(0.42 * (1 - 0.6 * pal.kaal)).toFixed(3)})`, (iets) => bomen((t, f, p) => { if (f[p + 4] === 0) return; iets(); const r = f[p + 3]; rond(t.x + f[p + 1] + r * 0.32, t.y + f[p + 2] + r * 0.38, r * 1.02); }));
  }
  for (let s = 0; s < 5; s++) vul(pal.kroon[s], (iets) => bomen((t, f, p) => { if (groep(f, p) === s) { iets(); rond(t.x + f[p + 1] + zx(f, p), t.y + f[p + 2] + zy(f, p), f[p + 3]); } }));
  if (pal.kaal > 0.3 && fijn && zwaai != null) {
    lijn(pal.stam, 0.07, (iets) => bomen((t, f, p) => {
      if (f[p + 4] === 0) return;
      iets();
      const x = t.x + f[p + 1] + zx(f, p), y = t.y + f[p + 2] + zy(f, p), r = f[p + 3];
      for (let q = 0; q < 5; q++) { const a = q * 1.256 + f[p + 5] * 6; c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8); }
    }));
  }
  vul(pal.naaldLicht, (iets) => bomen((t, f, p) => { if (f[p + 4] !== 0) return; iets(); const r = f[p + 3]; rond(t.x + f[p + 1] - r * 0.28 + zx(f, p) * 1.3, t.y + f[p + 2] - r * 0.3 + zy(f, p) * 1.3, r * 0.45); }));
  vul(pal.loofLicht, (iets) => bomen((t, f, p) => { if (f[p + 4] === 0) return; iets(); const r = f[p + 3]; rond(t.x + f[p + 1] - r * 0.28 + zx(f, p) * 1.3, t.y + f[p + 2] - r * 0.3 + zy(f, p) * 1.3, r * 0.45); }));
  if (pal.kap > 0.02) {
    vul(pal.sneeuwKap, (iets) => bomen((t, f, p) => {
      iets();
      const r = f[p + 3], naald = f[p + 4] === 0;
      rond(t.x + f[p + 1] - r * 0.22 + zx(f, p) * 1.3, t.y + f[p + 2] - r * 0.26 + zy(f, p) * 1.3, r * (naald ? 0.55 : 0.32));
    }));
  }
}

// Hoeveel vormen de scherpe laag voor een vakje tekent (voor het plafond per frame).
function kostenVan(t, b) {
  if (b.kosten[t.i] >= 0) return b.kosten[t.i];
  const f = kenmerkenVoorTegel(t, b);
  let n = 0;
  for (let p = 0; p < f.length; p += STAP) {
    const ty = f[p];
    if (ty === PERCEEL) {
      const s = f[p + 4] & 15, hu = f[p + 3], hv = f[p + 5];
      n += 4 + (s === BOOMGAARD ? (hu * hv * 4) / 1.56 * 3 : s === KAS ? 4 : s === WEI ? 1 : hv / 0.35);
    } else n += ty === BOERDERIJ ? 16 : ty === ROTS || ty === STEEN || ty === PLAS ? 2.5 : ty === BOOM || ty === LOSBOOM ? 1.4 : ty === RIET ? 1.2 : 0.6;
  }
  b.kosten[t.i] = n;
  return n;
}

// Grenzen tekenen in wereldcoördinaten. kleurVan(o) geeft de blokkleur (of null), zelfdeBlok(a, b) of ze één blok zijn.
function lijn(c, pts, d) {
  // vloeiende lijn door de middens van de stukken; d schuift hem loodrecht op (links positief)
  const n = pts.length / 2;
  const px = (q) => {
    if (!d) return pts[q * 2];
    const a = Math.max(0, q - 1), b = Math.min(n - 1, q + 1);
    const tx = pts[b * 2] - pts[a * 2], ty = pts[b * 2 + 1] - pts[a * 2 + 1], l = Math.hypot(tx, ty) || 1;
    return pts[q * 2] - (ty / l) * d;
  };
  const py = (q) => {
    if (!d) return pts[q * 2 + 1];
    const a = Math.max(0, q - 1), b = Math.min(n - 1, q + 1);
    const tx = pts[b * 2] - pts[a * 2], ty = pts[b * 2 + 1] - pts[a * 2 + 1], l = Math.hypot(tx, ty) || 1;
    return pts[q * 2 + 1] + (tx / l) * d;
  };
  c.moveTo(px(0), py(0));
  if (n === 2) { c.lineTo(px(1), py(1)); return; }
  for (let q = 1; q < n - 1; q++) c.quadraticCurveTo(px(q), py(q), (px(q) + px(q + 1)) / 2, (py(q) + py(q + 1)) / 2);
  c.lineTo(px(n - 1), py(n - 1));
}

function tekenGrenzen(c, ketens, k, kleurVan, zelfdeBlok) {
  const pix = 1 / k;
  // donkere grens tussen blokken, lichter en gestippeld binnen een blok
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  let iets = false;
  for (const kt of ketens) if (kt.links !== -1 && kt.rechts !== -1 && !zelfdeBlok(kt.links, kt.rechts)) { lijn(c, kt.pts, 0); iets = true; }
  if (iets) { c.strokeStyle = 'rgba(10,12,16,0.55)'; c.lineWidth = Math.max(0.35, 1.1 * pix); c.stroke(); }
  c.beginPath();
  iets = false;
  for (const kt of ketens) if (kt.links !== -1 && kt.rechts !== -1 && zelfdeBlok(kt.links, kt.rechts)) { lijn(c, kt.pts, 0); iets = true; }
  if (iets) {
    c.setLineDash([0.9, 0.7]);
    c.strokeStyle = 'rgba(10,12,16,0.32)'; c.lineWidth = Math.max(0.22, 0.9 * pix); c.stroke();
    c.setLineDash([]);
  }
  // binnenlijn in de blokkleur aan beide kanten
  c.lineWidth = Math.max(0.18, 0.7 * pix);
  const d = Math.max(0.265, 1.2 * pix);
  const perKleur = new Map();
  for (const kt of ketens) {
    if (kt.links === -1 || kt.rechts === -1 || zelfdeBlok(kt.links, kt.rechts)) continue;
    for (const [o, zijde] of [[kt.links, 1], [kt.rechts, -1]]) {
      const kl = kleurVan(o);
      if (!kl) continue;
      let l = perKleur.get(kl);
      if (!l) { l = []; perKleur.set(kl, l); }
      l.push(kt, zijde);
    }
  }
  c.globalAlpha *= 0.8;
  for (const [kl, l] of perKleur) {
    c.beginPath();
    for (let q = 0; q < l.length; q += 2) lijn(c, l[q].pts, d * l[q + 1]);
    c.strokeStyle = kl;
    c.stroke();
  }
  c.globalAlpha /= 0.8;
}

// ---------- detailpatronen ----------

// Naadloze grijze patronen van 128x128 voor soft-light: 128 is neutraal.
function maakPatronen() {
  const S = 128;
  const ruisP = (x, y, cel, zaad) => {
    // naadloze waarderuis met periode S
    const n = S / cel, fx = x / cel, fy = y / cel, xi = Math.floor(fx), yi = Math.floor(fy);
    const tx = fx - xi, ty = fy - yi, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const h = (a, b) => hash(((a % n) + n) % n, ((b % n) + n) % n, zaad);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const maak = (fn, streken) => {
    const v = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) v[y * S + x] = fn(x, y);
    if (streken) streken(v);
    const data = new Uint8ClampedArray(S * S * 4);
    for (let i = 0; i < S * S; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v[i]; data[i * 4 + 3] = 255; }
    return data;
  };
  const zet = (v, x, y, waarde, mix) => { const i = (((y % S) + S) % S) * S + (((x % S) + S) % S); v[i] += (waarde - v[i]) * mix; };
  const gras = maak((x, y) => 128 + (hash(x, y, 101) - 0.5) * 34 + (ruisP(x, y, 16, 102) - 0.5) * 30, (v) => {
    const r = rnd(103);
    for (let q = 0; q < 260; q++) {
      const x = r() * S, y = r() * S, l = 3 + r() * 4, sl = (r() - 0.5) * 0.8, waarde = r() < 0.55 ? 78 : 182;
      for (let s = 0; s < l; s++) zet(v, Math.round(x + sl * s), Math.round(y - s), waarde, 0.7);
    }
  });
  const bos = maak((x, y) => 128 + (ruisP(x, y, 16, 201) - 0.5) * 110 + (ruisP(x, y, 8, 202) - 0.5) * 60 + (hash(x, y, 203) - 0.5) * 18);
  const berg = maak((x, y) => {
    const n = ruisP(x, y, 32, 301);
    return 128 + Math.sin((y + n * 14) * (Math.PI * 2 * 10 / S)) * 20 + (ruisP(x, y, 8, 302) - 0.5) * 44 + (hash(x, y, 303) - 0.5) * 16;
  }, (v) => {
    const r = rnd(304);
    for (let q = 0; q < 14; q++) {
      let x = r() * S, y = r() * S, h = r() * Math.PI * 2;
      for (let s = 0; s < 34; s++) { zet(v, Math.round(x), Math.round(y), 52, 0.8); h += (r() - 0.5) * 0.9; x += Math.cos(h); y += Math.sin(h); }
    }
  });
  const zand = maak((x, y) => 128 + Math.sin(Math.PI * 2 * (3 * x + 8 * y) / S + ruisP(x, y, 32, 401) * 5) * 24 + (hash(x, y, 402) - 0.5) * 20);
  return [gras, bos, berg, zand]; // volgorde GRAS, BOS, BERG, ZAND
}

// Water: naadloze textuur van 256x256 met dunne lichte boogjes (golfkammen).
function maakGlinster() {
  const S = 256, cv = fabriek(S, S), c = cv.getContext('2d');
  const r = rnd(911);
  c.lineCap = 'round';
  for (let q = 0; q < 90; q++) {
    const x = r() * S, y = r() * S, rr = 5 + r() * 16, a = 0.5 + r() * 0.9, w = 0.8 + r() * 1.2, al = 0.35 + r() * 0.6;
    c.strokeStyle = `rgba(235,250,255,${al.toFixed(3)})`;
    c.lineWidth = w;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        if (x + ox + rr < 0 || x + ox - rr > S || y + oy + rr < 0 || y + oy - rr > S) continue;
        c.beginPath(); c.arc(x + ox, y + oy + rr, rr, -Math.PI / 2 - a / 2, -Math.PI / 2 + a / 2); c.stroke();
      }
    }
  }
  return cv;
}

// ---------- rivieren, wind en kleine dingen tekenen ----------

// Rivierlijf in wereldcoördinaten: modderige oever, water, donkere geul in het midden van brede stromen.
// Eén pad per breedte (gekwantiseerd op 0,2), zodat het aantal aanroepen klein blijft.
function tekenRivierLijf(c, w, lijst, n, k, pal, oever) {
  const pix = 1 / k;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const groepen = new Map();
  for (let q = 0; q < n; q++) {
    const st = w.stukken[lijst[q]], key = Math.round(st.w * 5);
    let g = groepen.get(key);
    if (!g) { g = []; groepen.set(key, g); }
    g.push(st);
  }
  const sleutels = [...groepen.keys()].sort((a, b) => a - b);
  const pad = (st) => {
    const p = w.rivieren[st.r].pts;
    c.moveTo(p[st.a * 2], p[st.a * 2 + 1]);
    for (let i = st.a + 1; i <= st.e; i++) c.lineTo(p[i * 2], p[i * 2 + 1]);
  };
  const laag = (kleur, breedte, alleen) => {
    for (const key of sleutels) {
      const bw = key / 5;
      if (alleen && !alleen(bw)) continue;
      c.beginPath();
      for (const st of groepen.get(key)) pad(st);
      c.strokeStyle = kleur;
      c.lineWidth = Math.max(pix, breedte(bw));
      c.stroke();
    }
  };
  if (oever) laag(pal.oever, (bw) => bw + 1.1);
  laag(pal.rivier, (bw) => bw);
  laag(pal.rivierDiep, (bw) => bw * 0.42, (bw) => bw > 1.2);
}

// Glinsteringen die stroomafwaarts drijven: streepjes langs de middenlijn met een verschuiving die meeloopt met de
// tijd. De verschuiving rekent vanaf de bron, dus het patroon loopt door over de naden tussen stukken.
// In een stroomversnelling gaat het sneller en schuimt het.
function tekenGlinsters(c, w, lijst, n, pal, nu) {
  const t = nu / 1000;
  c.lineCap = 'round';
  const pas = (dash, periode, snelF, breedteF, kleur, alleenSnel) => {
    c.setLineDash(dash);
    c.strokeStyle = kleur;
    for (let q = 0; q < n; q++) {
      const st = w.stukken[lijst[q]];
      if (alleenSnel && !st.snel) continue;
      const rv = w.rivieren[st.r], p = rv.pts, v = rv.snelheid * snelF * (st.snel ? 2 : 1);
      c.beginPath();
      c.moveTo(p[st.a * 2], p[st.a * 2 + 1]);
      for (let i = st.a + 2; i < st.e; i += 2) c.lineTo(p[i * 2], p[i * 2 + 1]);
      c.lineTo(p[st.e * 2], p[st.e * 2 + 1]);
      const o = (rv.s[st.a] - t * v) % periode;
      c.lineDashOffset = o < 0 ? o + periode : o;
      c.lineWidth = Math.max(0.08, st.w * breedteF);
      c.stroke();
    }
  };
  pas([0.5, 2.4], 2.9, 1, 0.2, pal.glinster, false);
  pas([0.22, 1.6], 1.82, 1.35, 0.09, pal.glinster, false);
  pas([0.6, 0.45], 1.05, 1.25, 0.65, pal.schuim, true);
  c.setLineDash([]);
  c.lineDashOffset = 0;
}

// Knipt een convexe veelhoek (n punten in a) tussen d0 <= x*dx + y*dy <= d1; uitkomst in u, geeft het aantal punten.
function knipBand(a, n, d0, d1, dx, dy, u, tmp) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ai = a[i * 2] * dx + a[i * 2 + 1] * dy - d0, aj = a[j * 2] * dx + a[j * 2 + 1] * dy - d0;
    if (ai >= 0) { tmp[m * 2] = a[i * 2]; tmp[m * 2 + 1] = a[i * 2 + 1]; m++; }
    if ((ai >= 0) !== (aj >= 0)) { const f = ai / (ai - aj); tmp[m * 2] = a[i * 2] + (a[j * 2] - a[i * 2]) * f; tmp[m * 2 + 1] = a[i * 2 + 1] + (a[j * 2 + 1] - a[i * 2 + 1]) * f; m++; }
  }
  let k = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m, ai = d1 - (tmp[i * 2] * dx + tmp[i * 2 + 1] * dy), aj = d1 - (tmp[j * 2] * dx + tmp[j * 2 + 1] * dy);
    if (ai >= 0) { u[k * 2] = tmp[i * 2]; u[k * 2 + 1] = tmp[i * 2 + 1]; k++; }
    if ((ai >= 0) !== (aj >= 0)) { const f = ai / (ai - aj); u[k * 2] = tmp[i * 2] + (tmp[j * 2] - tmp[i * 2]) * f; u[k * 2 + 1] = tmp[i * 2 + 1] + (tmp[j * 2 + 1] - tmp[i * 2 + 1]) * f; k++; }
  }
  return k;
}

// Windvlagen over graan, koolzaad, maïs en weide: lichte banden (de halmen buigen en vangen licht) met een
// donkere schaduwband erachter, die in de windrichting over de percelen trekken. Geeft het aantal banden terug.
const BAND_HOEK = new Float64Array(8), BAND_UIT = new Float64Array(16), BAND_TMP = new Float64Array(16); // hulpbuffers, eenmalig
function tekenWindBanden(c, b, em, pal, wnd, nu) {
  if (pal.groei <= 0.05 || wnd.kracht < 0.05) return 0;
  const tegels = b.geo.tegels, lijst = em[PERCEEL];
  const dx = Math.cos(wnd.hoek), dy = Math.sin(wnd.hoek), lam = 7, bw = 1.4, v = 1.2 + 3 * wnd.kracht;
  const fase = ((nu / 1000) * v) % lam;
  const hoek4 = BAND_HOEK, uit = BAND_UIT, tmp = BAND_TMP;
  let banden = 0;
  const sterkte = pal.groei * (0.35 + 0.65 * wnd.kracht);
  // elke pas (licht en schaduw) de helft van het plafond, per band geteld: zo blijft het plafond echt een plafond
  // en houdt elke lichte band zijn schaduwband
  const perPas = MAX_BANDEN >> 1;
  for (let pas = 0; pas < 2; pas++) {
    c.beginPath();
    let tel = 0;
    for (let q = 0; q < lijst.length && tel < perPas; q += 2) {
      const t = tegels[lijst[q]], f = b.kenmerken[lijst[q]], p = lijst[q + 1], soort = f[p + 4] & 15;
      if (soort !== GRAAN && soort !== KOOLZAAD && soort !== MAIS && soort !== WEI) continue;
      const h = hoekVan(t), co = Math.cos(h), si = Math.sin(h), x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3], hv = f[p + 5];
      hoek4[0] = x - hu * co + hv * si; hoek4[1] = y - hu * si - hv * co;
      hoek4[2] = x + hu * co + hv * si; hoek4[3] = y + hu * si - hv * co;
      hoek4[4] = x + hu * co - hv * si; hoek4[5] = y + hu * si + hv * co;
      hoek4[6] = x - hu * co - hv * si; hoek4[7] = y - hu * si + hv * co;
      let p0 = Infinity, p1 = -Infinity;
      for (let i = 0; i < 4; i++) { const d = hoek4[i * 2] * dx + hoek4[i * 2 + 1] * dy; p0 = Math.min(p0, d); p1 = Math.max(p1, d); }
      for (let s0 = fase + Math.floor((p0 - 2 * bw - fase) / lam) * lam; s0 < p1 && tel < perPas; s0 += lam) {
        const a0 = pas === 0 ? s0 : s0 - bw * 0.9, a1 = pas === 0 ? s0 + bw : s0;
        const m = knipBand(hoek4, 4, a0, a1, dx, dy, uit, tmp);
        if (m < 3) continue;
        c.moveTo(uit[0], uit[1]);
        for (let i = 1; i < m; i++) c.lineTo(uit[i * 2], uit[i * 2 + 1]);
        c.closePath();
        tel++;
      }
    }
    if (tel) {
      c.fillStyle = pas === 0 ? `rgba(255,246,206,${(0.2 * sterkte).toFixed(3)})` : `rgba(40,44,12,${(0.12 * sterkte).toFixed(3)})`;
      c.fill();
    }
    banden += tel;
  }
  return banden;
}

const MICRO_KLEUR = {
  wit: '#f4f2ea', geel: '#f0d23c', paars: '#9a7ac8', rood: '#d23a2a', grijs: '#9a958a', paddo: '#c0301e', stip: '#f6f0e6',
  blad1: '#c8782a', blad2: '#d8b03a', lelie: '#4f7f3a', lelieBloem: '#f2c6d8', mol: '#5e4630', molLicht: '#7a6046', varen: '#4f7a36',
};
const MICRO_NAMEN = Object.keys(MICRO_KLEUR);
const MICRO_INDEX = Object.fromEntries(MICRO_NAMEN.map((k, i) => [k, i]));

// ---------- de laag ----------

export class TerreinLaag {
  constructor() {
    this.basis = null;
    this.cache = new Map(); // `${R}:${ck}:${cr}` -> brok, in LRU-volgorde
    this.bytes = 0;
    this.frame = 0;
    this.politiek = []; // per brok: { sig, raster, ketens }
    this.pool = [];
    this.gebakken = 0;
    this.paletten = new Map(); // seizoensstap -> palet, hooguit 3
    this.optBak = { schaduw: true, zwaai: null, pal: null, wind: null, emmers: nieuweEmmers() };
    this.optScherp = { schaduw: false, zwaai: 0, pal: null, wind: null, emmers: nieuweEmmers() };
  }

  // ---- voor andere lagen (bijvoorbeeld bruggen): rivieren zijn puur decor ----

  // Rivieren als polylijnen in wereldcoördinaten: { pts: [x0, y0, x1, y1, ...], br: breedte per punt,
  // s: afstand vanaf de bron, naarZee, delta, ouder }. Van bron naar monding.
  get rivieren() { return this.basis ? this.basis.water.rivieren : []; }
  get meren() { return this.basis ? this.basis.water.meren.map((m) => ({ x: m.x, y: m.y, r: m.r })) : []; }
  // Afstand tot de rand van een rivier (negatief = in het water); ver weg 12.
  rivierAfstand(wx, wy) { return this.basis ? veldOp(this.basis.water.rivier, wx, wy) : VER; }
  isRivier(wx, wy, marge = 0) { return this.rivierAfstand(wx, wy) < marge; }
  isMeer(wx, wy) { return !!this.basis && veldOp(this.basis.water.meer, wx, wy) < 0; }
  isZoetWater(wx, wy) { return !!this.basis && zoetOp(this.basis, wx, wy) < 0; }

  // Palet van de seizoensstap van een speldag (gedeeld door bakken en scherp tekenen).
  palVoor(dag) {
    const stap = seizoensStap(dag);
    let p = this.paletten.get(stap);
    if (!p) {
      if (this.paletten.size >= 3) this.paletten.delete(this.paletten.keys().next().value);
      p = palet(seizoenVanStap(stap));
      this.paletten.set(stap, p);
    }
    return p;
  }

  laad(view) {
    this.geo = view.geo;
    this.basis = maakBasis(view.geo, view.eigenaar);
    this.kolC = Math.ceil(W / CH);
    this.rijC = Math.ceil(H / CH);
    this.cache.clear();
    this.bytes = 0;
    this.politiek = [];
    this.pool = [];
    // hulpcanvassen voor het bakken
    this.tijdelijk = fabriek(CH * 12, CH * 12);
    this.tctx = this.tijdelijk.getContext('2d');
    this.klein = fabriek(N, N);
    this.kctx = this.klein.getContext('2d');
    this.eigCanvas = fabriek(ON, ON);
    this.ectx = this.eigCanvas.getContext('2d');
    this.maskCanvas = fabriek(MN, MN);
    // detailpatronen op drie resoluties (32, 64, 128 px per herhaling), patronen zelf maken we per LOD
    const data = maakPatronen();
    this.patroonBron = data.map((d) => {
      const groot = fabriek(128, 128);
      groot.getContext('2d').putImageData(maakBeeld(d, 128, 128), 0, 0);
      const per = { 12: groot };
      for (const R of [6, 3]) {
        const s = (128 * R) / 12, cv = fabriek(s, s), cx = cv.getContext('2d');
        cx.imageSmoothingEnabled = true;
        cx.drawImage(per[R * 2], 0, 0, s, s);
        per[R] = cv;
      }
      return per;
    });
    this.patronen = {};
    this.glinster = maakGlinster();
    this.glinsterPatroon = null;
    this.krabbel = null;
    this._micro = null; // kleine dingen per vakje hoorden bij de vorige wereld
  }

  dekking(zoom) { return smooth(2.2, 3.2, zoom); }

  statistiek() { return { canvassen: this.cache.size, bytes: this.bytes, gebakken: this.gebakken }; }

  // ---- handtekeningen ----

  globaleSig(s) {
    let t = `${s.grensVersie}|`;
    for (let i = 0; i < s.landen.length; i++) t += `${s.landen[i].alignment},`;
    return t;
  }

  // Eigenaars en bebouwing van de vakjes in (en rond) een brok, als twee getallen.
  brokSig(s, ck, cr) {
    const geo = this.geo;
    let e = 7, z = 11;
    for (let r = cr * 4 - 1; r <= cr * 4 + 4; r++) {
      if (r < 0 || r >= geo.rij) continue;
      for (let k = ck * 4 - 1; k <= ck * 4 + 4; k++) {
        if (k < 0 || k >= geo.kol) continue;
        const t = r * geo.kol + k;
        e = Math.imul(e, 31) + s.eigenaar[t] + 3 | 0;
        z = Math.imul(z, 31) + (s.bezet[t] ? 1 : 0) | 0;
      }
    }
    this._e = e; this._z = z;
  }

  politiekVan(s, ck, cr, sig) {
    const ci = cr * this.kolC + ck;
    let p = this.politiek[ci];
    if (!p || p.sig !== sig) {
      const raster = eigenaarRaster(this.basis, ck, cr, s.eigenaar);
      p = { sig, raster, ketens: ketensUitRaster(raster, ck, cr) };
      this.politiek[ci] = p;
    }
    return p;
  }

  grondVan(ck, cr) {
    const ci = cr * this.kolC + ck;
    let g = this.basis.grond[ci];
    if (!g) {
      const d = bakGrondData(this.basis, ck, cr);
      const NN = N * N;
      // maskers per terreinsoort voor de detailpatronen
      const maskers = [GRAS, BOS, BERG, ZAND].map((s) => {
        const m = new Uint8ClampedArray(NN * 4);
        for (let i = 0; i < NN; i++) { m[i * 4] = m[i * 4 + 1] = m[i * 4 + 2] = 255; m[i * 4 + 3] = d.gewicht[s * NN + i] * 255; }
        return m;
      });
      g = { land: d.land, zee: d.zee, maskers, sneeuwBasis: d.sneeuwBasis, licht: d.licht, meer: d.meer };
      this.basis.grond[ci] = g;
    }
    return g;
  }

  // ---- bakken ----

  canvas(w, h) {
    for (let i = 0; i < this.pool.length; i++) {
      const c = this.pool[i];
      if (c.width === w && c.height === h) { this.pool.splice(i, 1); return c; }
    }
    return fabriek(w, h);
  }

  patroon(soort, R) {
    const k = `${soort}:${R}`;
    if (!this.patronen[k]) this.patronen[k] = this.tctx.createPattern(this.patroonBron[soort][R], 'repeat');
    return this.patronen[k];
  }

  bak(view, ck, cr, R, sig, polSig) {
    const s = view.state, b = this.basis, geo = this.geo;
    const S = CH * R;
    const g = this.grondVan(ck, cr);
    const oud = this.cache.get(`${R}:${ck}:${cr}`);
    const grond = oud?.grond ?? this.canvas(S, S);
    const gc = grond.getContext('2d');
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.globalAlpha = 1;
    gc.globalCompositeOperation = 'source-over';
    gc.imageSmoothingEnabled = true;
    const k = this.kctx, t = this.tctx;
    // 1. kleurbeeld van het land in het seizoen van nu, vergroot met smoothing: zachte overgangen en reliëf
    const pal = this.palVoor(s.dag);
    const NN4 = N * N * 4;
    const sl = this._seizLand ?? (this._seizLand = new Uint8ClampedArray(NN4)), sz = this._seizZee ?? (this._seizZee = new Uint8ClampedArray(NN4));
    seizoensGrond(g, pal.sz, sl, sz);
    k.putImageData(maakBeeld(sl, N, N), 0, 0);
    gc.drawImage(this.klein, -MARGE * R, -MARGE * R, N * R, N * R);
    // 2. detailpatronen per terreinsoort, gemaskeerd met het gewicht, in soft-light
    const sterkte = R === 3 ? 0.45 : R === 6 ? 0.75 : 1;
    for (let q = 0; q < 4; q++) {
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.globalCompositeOperation = 'source-over';
      t.globalAlpha = 1;
      t.clearRect(0, 0, S, S);
      t.fillStyle = this.patroon(q, R);
      t.fillRect(0, 0, S, S);
      k.putImageData(maakBeeld(g.maskers[q], N, N), 0, 0);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(this.klein, -MARGE * R, -MARGE * R, N * R, N * R);
      gc.globalCompositeOperation = 'soft-light';
      gc.globalAlpha = sterkte * (q === GRAS ? 0.8 : q === BERG ? 0.6 : 1);
      gc.drawImage(this.tijdelijk, 0, 0, S, S, 0, 0, S, S);
    }
    gc.globalCompositeOperation = 'source-over';
    gc.globalAlpha = 1;
    // 2b. rivieren, onder het zeewater: in een monding loopt de rivier zo zacht de zee in
    const stukken = b.water.perBrok[cr * this.kolC + ck];
    if (stukken.length) {
      gc.setTransform(R, 0, 0, R, -ck * CH * R, -cr * CH * R);
      tekenRivierLijf(gc, b.water, stukken, stukken.length, R, pal, true);
      gc.setTransform(1, 0, 0, 1, 0, 0);
    }
    // 3. water erover (zee en meren), met een fijn masker voor een strakke kustlijn
    const md = bakMaskerData(b, ck, cr, s.bezet);
    const maskers = ['water', 'schuim1', 'schuim2'].map((naam) => {
      const cv = oud?.[naam === 'water' ? 'waterMasker' : naam] ?? this.canvas(MN, MN);
      cv.getContext('2d').putImageData(maakBeeld(md[naam], MN, MN), 0, 0);
      return cv;
    });
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, S, S);
    k.putImageData(maakBeeld(sz, N, N), 0, 0);
    t.drawImage(this.klein, -MARGE * R, -MARGE * R, N * R, N * R);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(maskers[0], -MARGE * R, -MARGE * R, N * R, N * R);
    t.globalCompositeOperation = 'source-over';
    gc.drawImage(this.tijdelijk, 0, 0, S, S, 0, 0, S, S);
    // 4. kenmerken van de vakjes in en rond de brok, in wereldcoördinaten
    gc.setTransform(R, 0, 0, R, -ck * CH * R, -cr * CH * R);
    const lijst = this._lijst ?? (this._lijst = new Int32Array(64));
    let n = 0;
    gc.fillStyle = 'rgba(112,100,70,0.22)';
    for (let r = cr * 4 - 1; r <= cr * 4 + 4; r++) {
      if (r < 0 || r >= geo.rij) continue;
      for (let kk = ck * 4 - 1; kk <= ck * 4 + 4; kk++) {
        if (kk < 0 || kk >= geo.kol) continue;
        const ti = r * geo.kol + kk, tg = geo.tegels[ti];
        if (tg.terrein === 'water') continue;
        // bebouwd: geen bomen, wel een kale, betreden plek waar het gebouw op staat
        if (s.bezet[ti]) { gc.fillRect(tg.x - 7.2, tg.y - 7.2, 14.4, 14.4); continue; }
        lijst[n++] = ti;
      }
    }
    this.optBak.pal = pal;
    tekenLagen(gc, b, lijst, n, R, this.optBak);
    // 5. eigenaar: lichte tint in de blokkleur, sterker langs de grens; daarna de grenslijnen
    const pol = this.politiekVan(s, ck, cr, polSig);
    this.tintBeeld(view, pol.raster);
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.drawImage(this.eigCanvas, (-RM / OR) * R, (-RM / OR) * R, (ON / OR) * R, (ON / OR) * R);
    gc.setTransform(R, 0, 0, R, -ck * CH * R, -cr * CH * R);
    tekenGrenzen(gc, pol.ketens, R, (o) => this.blokKleur(view, o), (a, c) => this.zelfdeBlok(view, a, c));
    gc.setTransform(1, 0, 0, 1, 0, 0);

    const bytes = S * S * 4 + 3 * MN * MN * 4;
    const brok = { R, ck, cr, grond, waterMasker: maskers[0], schuim1: maskers[1], schuim2: maskers[2], sig, bytes, gebruikt: this.frame };
    const sleutel = `${R}:${ck}:${cr}`;
    if (oud) { this.cache.delete(sleutel); this.bytes -= oud.bytes; }
    this.cache.set(sleutel, brok);
    this.bytes += bytes;
    this.gebakken += 1;
    this.ruimOp();
    return brok;
  }

  // LRU: het langst niet getekende brok eerst weg, maar nooit iets dat deze frame getekend is.
  ruimOp() {
    while (this.cache.size > MAX_CANVASSEN || this.bytes > MAX_BYTES) {
      let sleutel = null, br = null;
      for (const [k, b] of this.cache) if (b.gebruikt !== this.frame && (!br || b.gebruikt < br.gebruikt)) { sleutel = k; br = b; }
      if (!br) break;
      this.cache.delete(sleutel);
      this.bytes -= br.bytes;
      this.pool.push(br.grond, br.waterMasker, br.schuim1, br.schuim2);
      if (this.pool.length > 16) this.pool.splice(0, this.pool.length - 16);
    }
  }

  blokKleur(view, o) { return o >= 0 ? view.kleurVan(view.state.landen[o]) : null; }
  zelfdeBlok(view, a, b) { return a >= 0 && b >= 0 && view.kleurVan(view.state.landen[a]) === view.kleurVan(view.state.landen[b]); }

  tintBeeld(view, raster) {
    // per eigenaarmonster de blokkleur: alfa 0,10 binnenin, oplopend tot 0,24 vlak bij een grens
    const s = view.state;
    const data = this._tint ?? (this._tint = new Uint8ClampedArray(ON * ON * 4));
    const kleuren = this._kleuren ?? (this._kleuren = []);
    for (let i = 0; i < s.landen.length; i++) kleuren[i] = hex(view.kleurVan(s.landen[i]));
    for (let j = 0; j < ON; j++) {
      for (let i = 0; i < ON; i++) {
        const m = j * ON + i, e = raster[m], p = m * 4;
        if (e < 0) { data[p + 3] = 0; continue; }
        let rand = false;
        for (let dj = -2; dj <= 2 && !rand; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= ON) continue;
          for (let di = -2; di <= 2; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= ON) continue;
            const o = raster[jj * ON + ii];
            if (o !== e && o !== -1) { rand = true; break; }
          }
        }
        const kl = kleuren[e];
        data[p] = kl[0]; data[p + 1] = kl[1]; data[p + 2] = kl[2]; data[p + 3] = (rand ? 0.24 : 0.1) * 255;
      }
    }
    this.ectx.putImageData(maakBeeld(data, ON, ON), 0, 0);
  }

  // ---- elke frame ----

  teken(c, view, sc, nu) {
    if (!this.basis || view.geo !== this.geo) return;
    this.frame += 1;
    const zoom = view.zoom;
    if (zoom < 1.9) return;
    const a = this.dekking(zoom);
    const s = view.state, dpr = view.dpr || 1;
    const [wx0, wy0] = view.naarWereld(0, 0), [wx1, wy1] = view.naarWereld(view.w, view.h);
    const k0 = Math.max(0, Math.floor(wx0 / CH)), k1 = Math.min(this.kolC - 1, Math.floor(wx1 / CH));
    const r0 = Math.max(0, Math.floor(wy0 / CH)), r1 = Math.min(this.rijC - 1, Math.floor(wy1 / CH));
    // resolutie: de kleinste die scherp genoeg is, en nooit meer geheugen dan het budget aankan
    let R = LODS.find((l) => l >= sc * dpr * 0.6) ?? 12;
    const zichtbaar = (k1 - k0 + 1) * (r1 - r0 + 1);
    while (R > 3 && zichtbaar * (CH * R * CH * R * 4 + 3 * MN * MN * 4) > MAX_BYTES * 0.8) R /= 2;
    const glob = this.globaleSig(s);
    const stap = seizoensStap(s.dag);
    const mx = (wx0 + wx1) / 2, my = (wy0 + wy1) / 2;
    let beste = null, bd = Infinity;
    const getekend = this._getekend ?? (this._getekend = []);
    getekend.length = 0;
    for (let cr = r0; cr <= r1; cr++) {
      for (let ck = k0; ck <= k1; ck++) {
        this.brokSig(s, ck, cr);
        const polSig = `${glob}${this._e}`;
        const sig = `${polSig}|${this._z}|${stap}`;
        let br = this.cache.get(`${R}:${ck}:${cr}`);
        if (!br || br.sig !== sig) {
          const d = (ck * CH + CH / 2 - mx) ** 2 + (cr * CH + CH / 2 - my) ** 2;
          if (d < bd) { bd = d; beste = { ck, cr, sig, polSig }; }
        }
        // ontbreekt hij nog, dan dezelfde brok op een andere resolutie; anders schijnt de kaart eronder door
        if (!br) for (const l of LODS) { br = this.cache.get(`${l}:${ck}:${cr}`); if (br) break; }
        if (br) { br.gebruikt = this.frame; getekend.push(br); }
      }
    }
    // maximaal één brok per frame bakken, de dichtstbijzijnde eerst; anders alvast de ring eromheen.
    // Een brok die nog nooit gebakken is, krijgt eerst een frame voor zijn grondgegevens en daarna een voor het canvas.
    if (beste) {
      if (!this.basis.grond[beste.cr * this.kolC + beste.ck]) this.grondVan(beste.ck, beste.cr);
      else getekend.push(this.bak(view, beste.ck, beste.cr, R, beste.sig, beste.polSig));
    } else this.voorbak(view, k0, k1, r0, r1, R, glob, mx, my);
    if (a <= 0) return;

    const naarX = (x) => Math.round(((x - view.cx) * sc + view.w / 2) * dpr) / dpr;
    const naarY = (y) => Math.round(((y - view.cy) * sc + view.h / 2) * dpr) / dpr;
    c.save();
    c.globalAlpha = a;
    c.imageSmoothingEnabled = true;
    // dubbele (oude resolutie plus nieuw gebakken) alleen de laatste tekenen
    const gezien = this._gezien ?? (this._gezien = new Set());
    gezien.clear();
    for (let i = getekend.length - 1; i >= 0; i--) {
      const br = getekend[i], id = br.cr * this.kolC + br.ck;
      if (gezien.has(id)) { getekend.splice(i, 1); continue; }
      gezien.add(id);
    }
    for (const br of getekend) {
      const x = naarX(br.ck * CH), y = naarY(br.cr * CH);
      c.drawImage(br.grond, x, y, naarX(br.ck * CH + CH) - x, naarY(br.cr * CH + CH) - y);
    }
    // bewegend water en aanrollend schuim
    if (zoom >= 3) this.tekenWater(c, view, sc, nu, a, getekend, naarX, naarY);
    // grenzen scherp als vector zodra de gebakken brok merkbaar vergroot wordt, en de selectie
    c.translate(view.w / 2 - view.cx * sc, view.h / 2 - view.cy * sc);
    c.scale(sc, sc);
    // scherpe rivieren onder de grenzen en de selectie, anders wissen ze die waar een rivier een grens kruist
    const rivierScherp = this.tekenRivieren(c, view, sc, nu, a);
    // Ketens van buurbrokken overlappen een kwart eenheid; per brok knippen, anders wordt de naad dubbel donker.
    // Ligt er een scherpe rivier over de gebakken grens, dan moet de grens als vector terug.
    const scherp = sc * dpr > R * 1.3 || rivierScherp;
    const sel = view.geselecteerd;
    const metSel = sel != null && sel >= 0;
    if (scherp || metSel) {
      for (const br of getekend) {
        const pol = this.politiek[br.cr * this.kolC + br.ck];
        if (!pol) continue;
        let selectie = false;
        if (metSel) for (const kt of pol.ketens) if ((kt.links === sel) !== (kt.rechts === sel)) { selectie = true; break; }
        if (!scherp && !selectie) continue;
        c.save();
        c.beginPath();
        c.rect(br.ck * CH, br.cr * CH, CH, CH);
        c.clip();
        if (scherp) tekenGrenzen(c, pol.ketens, sc, (o) => this.blokKleur(view, o), (p, q) => this.zelfdeBlok(view, p, q));
        if (selectie) {
          c.globalAlpha = 0.8 * a;
          c.strokeStyle = '#ffecb4';
          c.lineWidth = Math.max(0.3, 2 / sc);
          c.lineCap = 'round';
          c.lineJoin = 'round';
          c.beginPath();
          for (const kt of pol.ketens) if ((kt.links === sel) !== (kt.rechts === sel)) lijn(c, kt.pts, 0);
          c.stroke();
        }
        c.restore();
      }
    }
    c.restore();
  }

  voorbak(view, k0, k1, r0, r1, R, glob, mx, my) {
    const S = CH * R, bytes = S * S * 4 + 3 * MN * MN * 4;
    if (this.cache.size >= MAX_CANVASSEN || this.bytes + bytes > MAX_BYTES) return;
    const s = view.state;
    let beste = null, bd = Infinity;
    for (let cr = r0 - 1; cr <= r1 + 1; cr++) {
      for (let ck = k0 - 1; ck <= k1 + 1; ck++) {
        if (ck < 0 || cr < 0 || ck >= this.kolC || cr >= this.rijC) continue;
        if (ck >= k0 && ck <= k1 && cr >= r0 && cr <= r1) continue;
        this.brokSig(s, ck, cr);
        const polSig = `${glob}${this._e}`, sig = `${polSig}|${this._z}|${seizoensStap(s.dag)}`;
        const br = this.cache.get(`${R}:${ck}:${cr}`);
        if (br && br.sig === sig) continue;
        const d = (ck * CH + CH / 2 - mx) ** 2 + (cr * CH + CH / 2 - my) ** 2;
        if (d < bd) { bd = d; beste = { ck, cr, sig, polSig }; }
      }
    }
    if (!beste) return;
    if (!this.basis.grond[beste.cr * this.kolC + beste.ck]) this.grondVan(beste.ck, beste.cr);
    else this.bak(view, beste.ck, beste.cr, R, beste.sig, beste.polSig);
  }

  tekenWater(c, view, sc, nu, a, getekend, naarX, naarY) {
    const Wd = view.canvas.width, Hd = view.canvas.height, dpr = view.dpr || 1;
    if (!this.krabbel || this.krabbel.width !== Wd || this.krabbel.height !== Hd) {
      this.krabbel = fabriek(Wd, Hd);
      this.maskerScherm = fabriek(Wd, Hd);
      this.glinsterPatroon = null;
    }
    const kc = this.krabbel.getContext('2d'), mc = this.maskerScherm.getContext('2d');
    // 1. één watermasker voor het hele scherm
    mc.setTransform(1, 0, 0, 1, 0, 0);
    mc.clearRect(0, 0, Wd, Hd);
    mc.imageSmoothingEnabled = true;
    for (const br of getekend) {
      const x = naarX(br.ck * CH), y = naarY(br.cr * CH);
      mc.drawImage(br.waterMasker, MARGE * M, MARGE * M, CH * M, CH * M, x * dpr, y * dpr, (naarX(br.ck * CH + CH) - x) * dpr, (naarY(br.cr * CH + CH) - y) * dpr);
    }
    // 2. glinsteringen in twee lagen die elk een andere kant op drijven
    kc.setTransform(1, 0, 0, 1, 0, 0);
    kc.globalCompositeOperation = 'source-over';
    kc.globalAlpha = 1;
    kc.clearRect(0, 0, Wd, Hd);
    this.glinsterPatroon ??= kc.createPattern(this.glinster, 'repeat');
    kc.fillStyle = this.glinsterPatroon;
    const span = 16; // wereldeenheden per herhaling
    const f = (span * sc * dpr) / 256;
    const t = nu / 1000;
    for (const [vx, vy, ox, oy] of [[3, 1, 0, 0], [-2, 2.5, 7.3, 4.1]]) {
      const wx = (ox + t * vx) % span, wy = (oy + t * vy) % span;
      const px = ((wx - view.cx) * sc + view.w / 2) * dpr, py = ((wy - view.cy) * sc + view.h / 2) * dpr;
      const tx = px - Math.floor(px / (256 * f)) * 256 * f, ty = py - Math.floor(py / (256 * f)) * 256 * f;
      kc.setTransform(f, 0, 0, f, tx, ty);
      kc.globalAlpha = 0.5;
      kc.fillRect(-tx / f - 256, -ty / f - 256, Wd / f + 512, Hd / f + 512);
    }
    kc.setTransform(1, 0, 0, 1, 0, 0);
    kc.globalAlpha = 1;
    kc.globalCompositeOperation = 'destination-in';
    kc.drawImage(this.maskerScherm, 0, 0);
    kc.globalCompositeOperation = 'source-over';
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    // twee lagen op 0,5 en samen op 0,32: elke laag zo'n 0,16 (spec)
    c.globalAlpha = a * 0.32 * smooth(3, 3.6, view.zoom);
    c.drawImage(this.krabbel, 0, 0);
    c.restore();
    // 3. schuim: twee banden die om beurten oplichten, zodat het lijkt aan te rollen
    const s1 = a * (0.3 + 0.2 * Math.sin(nu / 850)), s2 = a * (0.3 + 0.2 * Math.sin(nu / 850 + Math.PI));
    for (const br of getekend) {
      const x = naarX(br.ck * CH), y = naarY(br.cr * CH), w = naarX(br.ck * CH + CH) - x, h = naarY(br.cr * CH + CH) - y;
      c.globalAlpha = s1;
      c.drawImage(br.schuim1, MARGE * M, MARGE * M, CH * M, CH * M, x, y, w, h);
      c.globalAlpha = s2;
      c.drawImage(br.schuim2, MARGE * M, MARGE * M, CH * M, CH * M, x, y, w, h);
    }
    c.globalAlpha = a;
  }

  // Scherpe rivieren, vanuit teken() in wereldcoördinaten (de aanroeper zet de transformatie), vóór de grenzen.
  // Zoom 4+: glinsteringen die stroomafwaarts drijven; 6,5-8: het rivierlijf zelf scherp als vector.
  // Alleen open stukken (op het droge); dichtstbijzijnde eerst, tot het plafond. Geeft terug of het lijf getekend is.
  tekenRivieren(c, view, sc, nu, a) {
    const zoom = view.zoom, aR = smooth(4, 5, zoom), alfa = smooth(6.5, 8, zoom);
    this.laatsteStukken = 0;
    if (aR <= 0) return false;
    const w = this.basis.water, pal = this.palVoor(view.state.dag);
    const [wx0, wy0] = view.naarWereld(0, 0), [wx1, wy1] = view.naarWereld(view.w, view.h);
    const mx = (wx0 + wx1) / 2, my = (wy0 + wy1) / 2;
    const stempel = (this._stempel = (this._stempel | 0) + 1);
    const stuk = this._stukken ?? (this._stukken = []);
    stuk.length = 0;
    for (let cr = Math.max(0, Math.floor(wy0 / CH)); cr <= Math.min(this.rijC - 1, Math.floor(wy1 / CH)); cr++) {
      for (let ck = Math.max(0, Math.floor(wx0 / CH)); ck <= Math.min(this.kolC - 1, Math.floor(wx1 / CH)); ck++) {
        for (const si of w.perBrok[cr * this.kolC + ck]) {
          if (w.gezien[si] === stempel) continue;
          w.gezien[si] = stempel;
          const st = w.stukken[si];
          if (!st.open || st.x1 < wx0 || st.x0 > wx1 || st.y1 < wy0 || st.y0 > wy1) continue;
          stuk.push(si);
        }
      }
    }
    const afst = (si) => { const st = w.stukken[si]; return ((st.x0 + st.x1) / 2 - mx) ** 2 + ((st.y0 + st.y1) / 2 - my) ** 2; };
    stuk.sort((p, q) => afst(p) - afst(q) || p - q);
    if (stuk.length > MAX_STUKKEN) stuk.length = MAX_STUKKEN;
    this.laatsteStukken = stuk.length;
    if (!stuk.length) return false;
    c.save();
    if (alfa > 0) { c.globalAlpha = a * alfa; tekenRivierLijf(c, w, stuk, stuk.length, sc, pal, false); }
    c.globalAlpha = a * aR;
    tekenGlinsters(c, w, stuk, stuk.length, pal, nu);
    c.restore();
    return alfa > 0;
  }

  // Scherpe laag bij diep inzoomen (vervangt de oude tekenTerreinDetail). Trapsgewijs (de rivieren tekent teken()):
  // 6,5-8: kenmerken scherp als vector; 8+: windvlagen over het gewas; 9+: kringen op plassen en meren;
  // 9,5+: bloemen, paddenstoelen, lelies, molshopen.
  tekenKenmerken(c, view, sc, nu) {
    if (!this.basis || view.geo !== this.geo) return;
    const zoom = view.zoom;
    const alfa = smooth(6.5, 8, zoom);
    this.laatsteBanden = this.laatsteMicro = 0;
    if (alfa <= 0) return;
    const geo = this.geo, s = view.state, b = this.basis;
    const pal = this.palVoor(s.dag), wnd = wind(s.dag);
    const [wx0, wy0] = view.naarWereld(0, 0), [wx1, wy1] = view.naarWereld(view.w, view.h);
    const mx = (wx0 + wx1) / 2, my = (wy0 + wy1) / 2;
    c.save();
    c.translate(view.w / 2 - view.cx * sc, view.h / 2 - view.cy * sc);
    c.scale(sc, sc);

    // B. kenmerken: dichtstbijzijnde vakjes eerst, tot het plafond aan vormen bereikt is; verder weg blijft de gebakken versie
    const k0 = Math.max(0, Math.floor(wx0 / geo.T) - 1), k1 = Math.min(geo.kol - 1, Math.floor(wx1 / geo.T) + 1);
    const r0 = Math.max(0, Math.floor(wy0 / geo.T) - 1), r1 = Math.min(geo.rij - 1, Math.floor(wy1 / geo.T) + 1);
    const kand = this._kand ?? (this._kand = []);
    kand.length = 0;
    for (let r = r0; r <= r1; r++) {
      for (let k = k0; k <= k1; k++) {
        const t = geo.tegels[r * geo.kol + k];
        if (t.terrein === 'water' || s.bezet[t.i]) continue;
        kand.push(t.i);
      }
    }
    const tg = geo.tegels;
    kand.sort((p, q) => ((tg[p].x - mx) ** 2 + (tg[p].y - my) ** 2) - ((tg[q].x - mx) ** 2 + (tg[q].y - my) ** 2) || p - q);
    const lijst = this._klijst ?? (this._klijst = new Int32Array(geo.tegels.length));
    let n = 0, kosten = 0;
    for (const i of kand) {
      const kk = kostenVan(tg[i], b);
      if (kosten + kk > MAX_PRIMITIEVEN) break;
      kosten += kk;
      lijst[n++] = i;
    }
    this.laatsteKosten = kosten;
    c.globalAlpha = alfa;
    const opt = this.optScherp;
    opt.zwaai = nu; opt.pal = pal; opt.wind = wnd;
    // C. windvlagen over het gewas en E. kleine dingen vanaf zoom 9,5: tekenLagen roept ze op hun plek in de
    // laagvolgorde aan (op de velden en bij de plassen), niet erbovenop
    const aW = smooth(7.5, 8.5, zoom) * alfa, aM = smooth(9.5, 10.5, zoom);
    opt.naVelden = aW > 0 ? () => {
      const ga = c.globalAlpha;
      c.globalAlpha = aW;
      this.laatsteBanden = tekenWindBanden(c, b, opt.emmers, pal, wnd, nu);
      c.globalAlpha = ga;
    } : null;
    opt.naPlassen = aM > 0 ? () => {
      const ga = c.globalAlpha;
      c.globalAlpha = aM;
      this.laatsteMicro = this.tekenMicro(c, b, lijst, n, pal, seizoensStap(s.dag));
      c.globalAlpha = ga;
    } : null;
    tekenLagen(c, b, lijst, n, sc, opt);
    opt.naVelden = opt.naPlassen = null;

    // D. kringen op plassen en meren (een vis, een druppel), vanaf zoom 9
    const aK = smooth(9, 10, zoom);
    if (aK > 0) { c.globalAlpha = aK; this.tekenKringen(c, b, opt.emmers, pal, nu, wx0, wy0, wx1, wy1, s.bezet); }
    c.restore();
  }

  tekenKringen(c, b, em, pal, nu, wx0, wy0, wx1, wy1, bezet) {
    const t = nu / 1000, geo = b.geo, tegels = geo.tegels;
    c.beginPath();
    let iets = false;
    const ring = (x, y, rmax, zaad) => {
      const ph = (t * 0.32 + zaad * 7.31) % 1, r = 0.12 + ph * rmax;
      if (ph > 0.85) return;
      // een meer op een bebouwd vakje is drooggelegd (bakMaskerData): daar geen kringen
      if (bezet && bezet[Math.min(geo.rij - 1, Math.floor(y / geo.T)) * geo.kol + Math.min(geo.kol - 1, Math.floor(x / geo.T))]) return;
      iets = true;
      c.moveTo(x + r, y); c.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
    };
    const e = em[PLAS];
    for (let q = 0; q < e.length; q += 2) {
      const tt = tegels[e[q]], f = b.kenmerken[e[q]], p = e[q + 1];
      ring(tt.x + f[p + 1] + (f[p + 4] - 0.5) * f[p + 3] * 0.6, tt.y + f[p + 2] + (f[p + 4] - 0.5) * f[p + 3] * 0.3, f[p + 3] * 0.45, f[p + 4]);
    }
    for (let mi = 0; mi < b.water.meren.length; mi++) {
      const m = b.water.meren[mi];
      if (m.x + m.r < wx0 || m.x - m.r > wx1 || m.y + m.r < wy0 || m.y - m.r > wy1) continue;
      for (let q = 0; q < 6; q++) {
        const cel = m.cellen[Math.floor(hash(mi, q, 81) * m.cellen.length)], ci = cel % RGW;
        const x = (ci + 0.2 + hash(mi, q, 82) * 0.6) * RG, y = ((cel - ci) / RGW + 0.2 + hash(mi, q, 83) * 0.6) * RG;
        if (veldOp(b.water.meer, x, y) < -0.6) ring(x, y, 1.1, hash(mi, q, 84));
      }
    }
    if (!iets || pal.ijs > 0.6) return;
    c.strokeStyle = 'rgba(225,240,240,0.45)';
    c.lineWidth = 0.06;
    c.stroke();
  }

  // Bloemen in het gras, paddenstoelen en gevallen blad in het herfstbos, varens, waterlelies op plassen,
  // molshopen in de wei, klaprozen langs het graan, steentjes. Plaatsing per vakje vast; het seizoen bepaalt
  // hoeveel van de vaste plekken iets dragen. Hard plafond van MAX_MICRO. Geeft het aantal getekende dingen terug.
  tekenMicro(c, b, lijst, n, pal, stap) {
    const tegels = b.geo.tegels;
    const em = this._microEmmers ?? (this._microEmmers = MICRO_NAMEN.map(() => []));
    for (let k = 0; k < em.length; k++) em[k].length = 0;
    let tel = 0;
    for (let q = 0; q < n && tel < MAX_MICRO; q++) {
      const m = this.microVan(tegels[lijst[q]], b, pal, stap);
      for (let i = 0; i < m.length && tel < MAX_MICRO; i += 4) { em[m[i]].push(m[i + 1], m[i + 2], m[i + 3]); tel++; }
    }
    for (let k = 0; k < em.length; k++) {
      const l = em[k];
      if (!l.length) continue;
      c.beginPath();
      for (let i = 0; i < l.length; i += 3) { c.moveTo(l[i] + l[i + 2], l[i + 1]); c.arc(l[i], l[i + 1], l[i + 2], 0, Math.PI * 2); }
      c.fillStyle = MICRO_KLEUR[MICRO_NAMEN[k]];
      c.fill();
    }
    return tel;
  }

  // De kleine dingen van één vakje als [soort, x, y, r, ...] in wereldcoördinaten. Ze hangen alleen af van het
  // vakje en de seizoensstap, dus per stap één keer uitgerekend (de cache gaat leeg bij een nieuwe stap of wereld).
  microVan(t, b, pal, stap) {
    const mc = this._micro ?? (this._micro = { stap: -1, per: [] });
    if (mc.stap !== stap) { mc.stap = stap; mc.per = []; }
    if (mc.per[t.i]) return mc.per[t.i];
    const geo = b.geo, T = geo.T, r = rnd(t.i * 7717 + 3), f = kenmerkenVoorTegel(t, b);
    const uit = [];
    const zet = (soort, x, y, rr) => { uit.push(MICRO_INDEX[soort], x, y, rr); };
    // akkers (ook die van een buurvakje die over de rand steken) en plassen: daar geen bloemen of steentjes
    const vlak = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dk = -1; dk <= 1; dk++) {
        const k = t.k + dk, rr = t.r + dr;
        if (k < 0 || rr < 0 || k >= geo.kol || rr >= geo.rij) continue;
        const nb = geo.tegels[rr * geo.kol + k];
        if (nb.terrein === 'water') continue;
        const g = kenmerkenVoorTegel(nb, b);
        for (let p = 0; p < g.length; p += STAP) {
          if (g[p] !== PERCEEL && g[p] !== PLAS) continue;
          const akker = g[p] === PERCEEL, x = nb.x + g[p + 1], y = nb.y + g[p + 2];
          const hu = g[p + 3] + 0.3, hv = (akker ? g[p + 5] : g[p + 3] * 0.62) + 0.3, bereik = Math.max(hu, hv);
          if (Math.abs(x - t.x) > T / 2 + bereik || Math.abs(y - t.y) > T / 2 + bereik) continue;
          const h = akker ? hoekVan(nb) : g[p + 5];
          vlak.push(akker ? 1 : 0, x, y, Math.cos(h), Math.sin(h), hu, hv);
        }
      }
    }
    // op het droge en niet op het strand, niet in rivier of meer, niet op een akker of in een plas
    const vrij = (x, y) => {
      if (sdOp(b, x, y) > -2.4 || zoetOp(b, x, y) < 0.25) return false;
      for (let q = 0; q < vlak.length; q += 7) {
        const dx = x - vlak[q + 1], dy = y - vlak[q + 2], u = (dx * vlak[q + 3] + dy * vlak[q + 4]) / vlak[q + 5], v = (dy * vlak[q + 3] - dx * vlak[q + 4]) / vlak[q + 6];
        if (vlak[q] ? Math.abs(u) < 1 && Math.abs(v) < 1 : u * u + v * v < 1) return false;
      }
      return true;
    };
    const bloemen = Math.round(16 * Math.min(1, pal.bloemen)), herfst = pal.herfst, groen = 1 - pal.kaal;
    if (t.terrein === 'bos') {
      for (let i = 0; i < 10; i++) {
        const x = t.x + (r() - 0.5) * T, y = t.y + (r() - 0.5) * T, kies = r();
        if (!vrij(x, y)) continue;
        if (i < 4 && kies < herfst * 1.4) { zet('paddo', x, y, 0.1); zet('stip', x - 0.03, y - 0.03, 0.03); }
        else if (kies < herfst) zet(kies < herfst / 2 ? 'blad1' : 'blad2', x, y, 0.07);
        else if (kies < herfst + 0.5 * groen) zet('varen', x, y, 0.12);
      }
    } else if ((t.terrein === 'vlakte' || t.terrein === 'kust') && !b.akker[t.i]) {
      const max = b.moeras[t.i] ? 6 : 16;
      for (let i = 0; i < max; i++) {
        const x = t.x + (r() - 0.5) * T, y = t.y + (r() - 0.5) * T, kies = r();
        if (i >= bloemen || !vrij(x, y)) continue;
        zet(kies < 0.4 ? 'wit' : kies < 0.7 ? 'geel' : kies < 0.88 ? 'paars' : 'rood', x, y, 0.07 + kies * 0.04);
      }
      for (let i = 0; i < 3; i++) { const x = t.x + (r() - 0.5) * T, y = t.y + (r() - 0.5) * T, rr = 0.05 + r() * 0.04; if (vrij(x, y)) zet('grijs', x, y, rr); }
    }
    // per kenmerk: lelies op plassen, molshopen in de wei, klaprozen in het graan
    for (let p = 0; p < f.length; p += STAP) {
      if (f[p] === PLAS) {
        if (pal.ijs > 0.5) continue;
        const h = f[p + 5], co = Math.cos(h), si = Math.sin(h), rx = f[p + 3], ry = rx * 0.62;
        for (let i = 0; i < 4; i++) {
          const a = hash(t.i, p * 7 + i, 91) * Math.PI * 2, d = 0.35 + 0.5 * hash(t.i, p * 7 + i, 92);
          const u = Math.cos(a) * rx * d, v = Math.sin(a) * ry * d;
          const x = t.x + f[p + 1] + u * co - v * si, y = t.y + f[p + 2] + u * si + v * co;
          zet('lelie', x, y, 0.16 + 0.06 * hash(t.i, i, 93));
          if (i === 0 && pal.zomer > 0.3) zet('lelieBloem', x + 0.04, y - 0.04, 0.06);
        }
      } else if (f[p] === PERCEEL) {
        const soort = f[p + 4] & 15;
        if (soort !== WEI && !(soort === GRAAN && pal.zomer > 0.3)) continue;
        const h = hoekVan(t), co = Math.cos(h), si = Math.sin(h), hu = f[p + 3], hv = f[p + 5];
        for (let i = 0; i < 4; i++) {
          const u = (hash(t.i, p * 5 + i, 94) - 0.5) * 2 * (hu - 0.4), v = (hash(t.i, p * 5 + i, 95) - 0.5) * 2 * (hv - 0.4);
          const x = t.x + f[p + 1] + u * co - v * si, y = t.y + f[p + 2] + u * si + v * co;
          if (soort === WEI) { zet('mol', x, y, 0.13); zet('molLicht', x - 0.03, y - 0.04, 0.06); }
          else zet('rood', x, y, 0.065);
        }
      }
    }
    return (mc.per[t.i] = Float32Array.from(uit));
  }
}
