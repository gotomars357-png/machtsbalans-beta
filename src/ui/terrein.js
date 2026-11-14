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
//
// Natuur (C8):
// - Bomen als echte kronen in sprites per seizoensstap (één drawImage per boom): loofbomen uit lobben met een lichte
//   noordwestkant en een donkere zuidoostkant, sparren als spitse sterren, dennen als plukken, berken, populieren met
//   een lange schaduw en struiken. Soort en kleur volgen trage ruis, zodat een bos in de herfst in vlekken oker,
//   olijf en goudbruin kleurt; in de winter kale takken (sommige eiken houden hun bruine blad) en sneeuw op de sparren.
// - Bosranden met struiken en jonge berken, open plekken met gras, omgevallen stammen; vanaf zoom 11,5 varens,
//   paddenstoelen, mos en takjes op de bosgrond.
// - Bergen met leesbaar reliëf: kammen en zijkammen, graten als lijnen, rotswanden en puin, bruingrijze rots met
//   lagen; bergbos tot de boomgrens, alpenweiden, kale rots, sneeuw boven een sneeuwgrens die met het seizoen stijgt
//   en daalt, eeuwige sneeuw en gletsjers op de hoogste toppen en bergmeertjes in vlakke kommen.
// - Bakken in stappen (grond, water, akkers, de rest, bomen, politiek) met een werkbudget per frame, zodat een
//   seizoenswissel niet hapert; geheugen ruim onder de grens (lege maskers worden niet bewaard).

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
const MAX_BYTES = 64 * 1024 * 1024; // harde grens
const DOEL_BYTES = 38 * 1024 * 1024; // hierheen ruimt de LRU op, zodat er naast pool, werkbrok en atlas ruimte overblijft
const POOL_BYTES = 5 * 1024 * 1024; // herbruikbare canvassen
const BAK_BUDGET = 1.5; // werk per frame aan bakken, in geschatte milliseconden; één stap gaat altijd door
const MAX_PRIMITIEVEN = 1500; // scherpe kenmerken per frame
const GROF_PER_FRAME = 6; // werk aan nieuwe terugvalversies per frame: 1 per stuk (~0,3 ms), 3 als de grondgegevens nog ontbreken (~2,5 ms)
const PATROON_SPAN = CH / 6; // wereldeenheden per herhaling van een detailpatroon; 6 passen precies in een brok

// Terreinsoorten in de gewichten.
const GRAS = 0, BOS = 1, BERG = 2, ZAND = 3, AKKER = 4;
const SOORTEN = 5;

// Kenmerktypen; per kenmerk 6 getallen: [type, x, y, r, variant, extra], x en y vanaf het midden van het vakje.
const STAP = 6;
const BOOM = 1, LOSBOOM = 2, ROTS = 3, GRUIS = 4, PLUK = 5, PERCEEL = 6, KIEZEL = 7, DRIJFHOUT = 8;
const RIET = 9, PLAS = 10, BOERDERIJ = 11, STEEN = 12, HELM = 13, BAAL = 14;
// GRAAT: stuk van een kamlijn [x1, y1, x2, y2, hoogte (+10 voor een zijkam)];
// BERGMEER [x, y, r, hoek, hoogte]; STAM (omgevallen boom) [x, y, lengte, hoek, zaad]; OPENPLEK (gras) [x, y, r, hoek].
const GRAAT = 15, BERGMEER = 16, STAM = 17, OPENPLEK = 18;
const TYPES = 19;
// Boomsoorten; de variant van BOOM en LOSBOOM is soort | vorm << 3 | kleur << 5.
const SPAR = 0, LOOF = 1, LINDE = 2, BERK = 3, POPULIER = 4, STRUIK = 5, DEN = 6;
const BOOM_VORMEN = [3, 3, 2, 2, 1, 2, 2], BOOM_KLEUREN = [1, 5, 5, 2, 2, 3, 1];
const boomCode = (soort, vorm, kleur) => soort | (vorm << 3) | (kleur << 5);
const NAALD = (soort) => soort === SPAR || soort === DEN;
// Hoogtezones in de bergen, op de schaal van hoogteOp (bergen lopen van ongeveer 0,8 tot 2,3).
export const BOOMGRENS = 1.27, ALMGRENS = 1.5, SNEEUW_VAST = 1.78, GLETSJER = 1.98;
// Sneeuwgrens van het seizoen: midden in de winter tot in de dalen, in de zomer alleen de eeuwige sneeuw
// (de zomergrens ligt boven de hoogste toppen, anders liggen er witte aders over elke kam).
export function sneeuwLijn(sz) { return 1.95 - 1.01 * smooth(0.3, 0.97, sz.koud); }
// Perceelsoorten (variant & 15); bit 16 = rijen dwars, (variant >> 5) & 7 = randsoort, (variant >> 8) & 255 = 1 + hoek
// in graden langs een weg (0 = het akkerrooster van het land).
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
  // bergen: warm bruin en koel grijs gesteente, wanden, puin, bergbos, alpenweide, gletsjerijs
  rotsWarm: hex('#8a7660'), rotsKoel: hex('#77736c'), wand: hex('#4a4038'), puin: hex('#a69c8a'),
  bergBos: hex('#2f4430'), alm: hex('#8c9a54'), almDroog: hex('#a39a5c'), almHerfst: hex('#a8864a'),
  gletsjer: hex('#d4e4ee'), spleet: hex('#8eb2c8'),
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
        // C12: het rooster vervormd met trage ruis, zodat een meer geen rechte oevers en haakse hoeken van de cellen
        // houdt (een meer van blokjes las als een ingegraven bak)
        const u = (x + 0.5) / RG - 0.5 + (ruis(x * 0.04 + 211, y * 0.04 + 57) - 0.5) * 2.8;
        const v = (y + 0.5) / RG - 0.5 + (ruis(x * 0.04 + 93, y * 0.04 + 301) - 0.5) * 2.8;
        const ui = Math.max(0, Math.min(RGW - 2, Math.floor(u))), vj = Math.max(0, Math.min(RGH - 2, Math.floor(v)));
        const fu = Math.max(0, Math.min(1, u - ui)), fv = Math.max(0, Math.min(1, v - vj)), c = vj * RGW + ui;
        const a = meerCel[c] + (meerCel[c + 1] - meerCel[c]) * fu, e = meerCel[c + RGW] + (meerCel[c + RGW + 1] - meerCel[c + RGW]) * fu;
        const L = a + (e - a) * fv + (ruis(x * 0.12 + 5, y * 0.12 + 9) - 0.5) * 0.3 + (ruis(x * 0.07 + 17, y * 0.07 + 41) - 0.5) * 0.2;
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
  // C12: hoe ver ligt elk stuk van de rand van een meer? Bij strenge vorst bevriest het laatste stuk van een rivier
  // die in een bevroren meer uitkomt (of eruit stroomt) mee, in plaats van open een dichtgevroren meer in te lopen.
  for (const st of stukken) {
    const p = rivieren[st.r].pts;
    let d = Infinity;
    for (const m of meren) {
      for (let i = st.a; i <= st.e; i++) d = Math.min(d, Math.hypot(p[i * 2] - m.x, p[i * 2 + 1] - m.y) - m.r);
    }
    st.meerAfst = d;
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
  // fijne ruis zwakker dan voorheen: die gaf een verfrommeld beeld in plaats van leesbare bergen
  h += 0.04 * (ruis(x * 0.21 + 13, y * 0.21 + 7) - 0.5) * (1 + bg);
  // geulen en ribben op de flanken
  h += bg * Math.abs(ruis(x * 0.3 + 71, y * 0.3 + 13) - 0.5) * 0.2;
  // bergkammen van zo'n 12 eenheden met een scherpe graat (steiler vlak onder de top), plus zijkammen,
  // zodat een massief uit meerdere toppen en dalen bestaat; de graten liggen waar de kamruis precies 0,5 is
  const kam = Math.max(-1, Math.min(1, (ruis(x * 0.075 + 5, y * 0.075 + 9) - 0.5) * 5));
  const zij = Math.max(-1, Math.min(1, (ruis(x * 0.17 + 23, y * 0.17 + 41) - 0.5) * 5));
  const k1 = 1 - Math.abs(kam);
  h += bg * (0.8 * k1 * (0.55 + 0.45 * k1) + 0.24 * (1 - Math.abs(zij)));
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
  // voor de seizoenssneeuw in de bergen: hoogte (x100), steilte en alpenweide (x255) per monster
  const hoogte8 = new Uint8Array(NN), steil8 = new Uint8Array(NN), alm8 = new Uint8Array(NN);
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
      const wB0 = gewicht[BERG * NN + m];
      // in de bergen een sterker reliëf: de kammen en dalen moeten op zoom 5 al te lezen zijn
      const relief = 6 + 3 * smooth(0.2, 0.7, wB0);
      let nx = -hx * relief, ny = -hy * relief, nz = 1;
      const nl = Math.sqrt(nx * nx + ny * ny + 1); nx /= nl; ny /= nl; nz /= nl;
      let schaduw = 0.62 + 0.55 * Math.max(0, nx * Lx + ny * Ly + nz * Lz);
      // kamlicht en dalschaduw (kromming): graten iets lichter, geulen en dalbodems iets donkerder
      if (wB0 > 0.05) schaduw *= 1 - Math.max(-0.1, Math.min(0.14, (hl + hr + hu + hd - 4 * hoogte[m]) * 1.6)) * smooth(0.1, 0.6, wB0);
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
      let steil = 0, almF = 0;
      if (wg(BERG) > 0.002) {
        const hm = hoogte[m];
        // gesteente: per massief warmer bruin of koeler grijs, lagen op hoogte, dalen donker en toppen licht
        const massief = ruis(x * 0.035 + 3, y * 0.035 + 8), korrel = ruis(x * 0.3 + 3, y * 0.3 + 8);
        meng(K.rotsWarm, K.rotsKoel, smooth(0.38, 0.62, massief), tmp2);
        const toon = smooth(0.95, 1.85, hm) + (korrel - 0.5) * 0.16 + 0.07 * Math.sin(hm * 28 + massief * 7);
        meng(K.rotsDonker, tmp2, smooth(0, 0.45, toon), tmp); meng(tmp, K.rotsLicht, smooth(0.55, 1.1, toon) * 0.75, tmp);
        // rotswand: donker en gestreept; puin: lichte waaiers op de matige hellingen boven het bos
        steil = smooth(0.17, 0.36, helling);
        if (steil > 0.01) { meng(K.wand, K.rotsDonker, ruis(x * 1.2 + 9, y * 0.3 + 4), tmp2); meng(tmp, tmp2, steil * 0.7, tmp); }
        const puin = smooth(0.07, 0.14, helling) * (1 - steil) * smooth(BOOMGRENS, BOOMGRENS + 0.15, hm) * smooth(0.48, 0.66, ruis(x * 0.22 + 61, y * 0.22 + 29));
        if (puin > 0.01) meng(tmp, K.puin, puin * 0.55, tmp);
        // zones: bergbos tot de boomgrens, daarboven alpenweide, dan kale rots; de grenzen rafelen met ruis
        const rafel = (ruis(x * 0.21 + 5, y * 0.21 + 3) - 0.5) * 0.1;
        const bosZ = (1 - smooth(BOOMGRENS - 0.08, BOOMGRENS + 0.02, hm - rafel)) * (1 - steil * 0.7);
        almF = smooth(BOOMGRENS - 0.07, BOOMGRENS + 0.03, hm - rafel) * (1 - smooth(ALMGRENS - 0.07, ALMGRENS + 0.05, hm + rafel * 1.4)) * (1 - steil);
        if (almF > 0.01) { meng(K.alm, K.almDroog, smooth(0.45, 0.7, korrel), tmp2); meng(tmp, tmp2, almF * 0.85, tmp); }
        if (bosZ > 0.01) meng(tmp, K.bergBos, bosZ * 0.8, tmp);
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
      // reliëf, plus een lichte warme toon in het zonlicht (minder blauw); schaduwflanken in de bergen koeler
      c[0] *= schaduw; c[1] *= schaduw; c[2] *= schaduw * 0.9;
      if (wB0 > 0.05 && schaduw < 0.95) { const k = (0.95 - schaduw) * 40 * smooth(0.1, 0.6, wB0); c[0] -= k * 0.6; c[2] = Math.max(c[2], Math.min(c[1] - 1, c[2] + k)); }
      licht[m] = schaduw;
      meerA[m] = mz;
      // sneeuwgevoeligheid: in het laagland vlekkerig, weinig op zand en steile hellingen;
      // in de bergen telt de sneeuwgrens (seizoensGrond), daar is dit alleen de rafel langs die grens
      const vlekS = ruis(x * 0.045 + 201, y * 0.045 + 77) * 0.6 + ruis(x * 0.12 + 13, y * 0.12 + 91) * 0.28 + ruis(x * 0.4 + 7, y * 0.4 + 3) * 0.12;
      // opgerekt rond het midden: de ruis zelf heeft weinig spreiding, zo worden het duidelijke plekken
      let sb = 0.08 + 0.7 * Math.max(0, Math.min(1, 0.5 + (vlekS - 0.5) * 1.9));
      sb += 0.2 * smooth(0.9, 1.4, hoogte[m]);
      sb *= (1 - 0.5 * smooth(0.12, 0.35, helling)) * (1 - 0.65 * wg(ZAND)) * (1 - 0.5 * fk);
      sneeuwBasis[m] = Math.max(0, Math.min(1, sb));
      hoogte8[m] = Math.max(0, Math.min(255, Math.round(hoogte[m] * 100)));
      steil8[m] = Math.round(steil * 255);
      alm8[m] = Math.round(almF * wg(BERG) * 255);
      // eeuwige sneeuw op de hoogste, niet te steile plekken; gletsjerijs op de allerhoogste, met spleten.
      // Pas boven SNEEUW_VAST: lager lag hij in de zomer als smalle witte aders op elke kam.
      const sn = 0.94 * smooth(SNEEUW_VAST + 0.03, SNEEUW_VAST + 0.12, hoogte[m]) * (1 - smooth(0.2, 0.42, helling)) * smooth(0.45, 0.8, wg(BERG));
      sneeuw[m] = sn;
      if (sn > 0) {
        const f = 0.8 + 0.2 * Math.min(1.15, schaduw);
        tmp2[0] = K.sneeuw[0] * f; tmp2[1] = K.sneeuw[1] * f; tmp2[2] = Math.min(255, K.sneeuw[2] * f + 8 * (1 - schaduw));
        const gl = smooth(GLETSJER - 0.06, GLETSJER + 0.05, hoogte[m]) * (1 - smooth(0.1, 0.26, helling));
        if (gl > 0.01) {
          meng(K.gletsjer, K.spleet, smooth(0.6, 0.72, ruis(x * 0.9 + 17, y * 0.24 + 5)) * 0.8, tmp);
          tmp[0] *= f; tmp[1] *= f; tmp[2] *= f;
          meng(tmp2, tmp, gl, tmp2);
        }
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
  // heeftWater: zit er in dit brok ergens water of een meer (anders hoeft de waterstap niet)
  let heeftWater = false;
  for (let m = 0; m < NN && !heeftWater; m++) if (water[m] || meerA[m] < 1.2 || sd[m] > -1.5) heeftWater = true;
  return { ck, cr, x0, y0, n: N, gewicht, water, sd, hoogte, sneeuw, kleur, land, zee, vlag, sneeuwBasis, licht, meer: meerA, hoogte8, steil8, alm8, heeftWater };
}

// Seizoen over de gebakken grondkleuren: gras dof in de winter en droog in de nazomer, herfsttinten in het bos,
// vlekkerige sneeuw (bergen vol, laagland gedeeltelijk) en bevroren meren. Puur; schrijft in uitLand en uitZee.
export function seizoensGrond(g, sz, uitLand, uitZee) {
  const NN = N * N, ml = g.maskers;
  const A = 0.3 * smooth(0.45, 0.85, sz.koud) + 0.28 * sz.sneeuw; // sneeuwhoeveelheid, 0..0,58
  const drempel = 1 - A;
  const ijs = smooth(0.86, 0.97, sz.koud);
  const lijn = sneeuwLijn(sz);
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
    // alpenweide: fris in het voorjaar, goudbruin in de herfst, dof in de winter
    const al = g.alm8 ? g.alm8[m] / 255 : 0;
    if (al > 0.02) {
      if (sz.blad > 0) meng(c, K.almHerfst, sz.blad * 0.55 * al, c);
      if (sz.lente > 0) meng(c, K.grasLente, sz.lente * 0.3 * al, c);
      if (sz.winter > 0) meng(c, K.grasWinter, sz.winter * 0.4 * al, c);
    }
    const sb = g.sneeuwBasis[m];
    // laagland: in hartje winter een egale sluier met hooguit een zachte golving (geen losse vlekken op vlak gras);
    // bergen: alles boven de sneeuwgrens, steile wanden blijven kaal
    const sbL = 0.5 + (sb - 0.5) * 0.25;
    let dek = A > 0.01 && sbL > drempel - 0.12 ? smooth(drempel - 0.1, drempel + 0.14, sbL) : 0;
    if (wR > 0.02 && g.hoogte8) {
      const h = g.hoogte8[m] / 100 + (sb - 0.5) * 0.2, st = g.steil8[m] / 255;
      const dekB = smooth(lijn - 0.07, lijn + 0.07, h) * (1 - 0.8 * st);
      const bf = smooth(0.15, 0.6, wR);
      dek = Math.max(dek * (1 - 0.6 * bf), dekB * bf);
    }
    if (dek > 0.005) {
      const f = 0.8 + 0.2 * Math.min(1.15, g.licht[m]);
      tmp[0] = K.sneeuw[0] * f; tmp[1] = K.sneeuw[1] * f; tmp[2] = Math.min(255, K.sneeuw[2] * f + 6);
      meng(c, tmp, Math.min(1, dek) * 0.93, c);
    }
    uitLand[p] = c[0]; uitLand[p + 1] = c[1]; uitLand[p + 2] = c[2]; uitLand[p + 3] = 255;
    uitZee[p] = g.zee[p]; uitZee[p + 1] = g.zee[p + 1]; uitZee[p + 2] = g.zee[p + 2]; uitZee[p + 3] = 255;
    if (ijs > 0 && g.meer[m] < 1) {
      // ijs groeit vanaf de oever; dichtgevroren is het hele meer licht ijs (C12: dezelfde kleur als de bevroren
      // rivieren, zie rivierIjs in palet), met in het midden nog een zweem van het diepe water
      const f = ijs * (0.8 + 0.2 * smooth(-1, 0.5, g.meer[m]));
      tmp[0] = uitZee[p]; tmp[1] = uitZee[p + 1]; tmp[2] = uitZee[p + 2];
      meng(tmp, K.ijs, f, tmp);
      uitZee[p] = tmp[0]; uitZee[p + 1] = tmp[1]; uitZee[p + 2] = tmp[2];
    }
  }
}

// Water- en schuimmaskers op 3 monsters per eenheid (met dezelfde marge), wit met alfa.
// Meren tellen mee in het watermasker (dus ook glinsteringen). C12: een meer blijft een meer, ook onder een
// bebouwd vakje; de kavel snijdt het water uit zijn eigen tekening (detail.js), de grond legt niets droog.
export function bakMaskerData(b, ck, cr) {
  const ruis = b.geo.ruis;
  const x0 = ck * CH - MARGE, y0 = cr * CH - MARGE;
  const water = new Uint8ClampedArray(MN * MN * 4), schuim1 = new Uint8ClampedArray(MN * MN * 4), schuim2 = new Uint8ClampedArray(MN * MN * 4);
  const meer = b.water.meer;
  const meerM = new Uint8ClampedArray(MN * MN * 4); // alleen de meren: daar komen bij vorst geen golfjes (C12)
  let heeftWater = false, heeftSchuim = false, heeftMeer = false;
  for (let j = 0; j < MN; j++) {
    for (let i = 0; i < MN; i++) {
      const x = x0 + (i + 0.5) / M, y = y0 + (j + 0.5) / M, p = (j * MN + i) * 4;
      const sd = sdOp(b, x, y);
      // ondiep water is wat doorschijnend, zodat het zand eronder zichtbaar blijft
      let wa = smooth(-0.18, 0.18, sd) * (0.72 + 0.28 * smooth(0.2, 2.6, sd));
      const md = veldOp(meer, x, y);
      if (md < 0.35) {
        const la = smooth(0.35, -0.35, md) * (0.82 + 0.16 * smooth(0, -3, md));
        wa = Math.max(wa, la);
        if (la > 0.002) { heeftMeer = true; meerM[p] = meerM[p + 1] = meerM[p + 2] = 255; meerM[p + 3] = Math.min(1, la * 1.25) * 255; }
      }
      water[p] = water[p + 1] = water[p + 2] = 255; water[p + 3] = wa * 255;
      if (wa > 0.002) heeftWater = true;
      if (sd < -0.12 || sd > 1.15) continue; // geen schuim: maskers blijven leeg
      const breuk = 0.5 + 0.5 * ruis(x * 0.9 + 11, y * 0.9 + 3);
      const s1 = smooth(-0.12, 0.06, sd) * (1 - smooth(0.25, 0.55, sd)) * (0.55 + 0.45 * breuk);
      const s2 = smooth(0.42, 0.62, sd) * (1 - smooth(0.88, 1.15, sd)) * breuk;
      if (s1 > 0.002 || s2 > 0.002) heeftSchuim = true;
      schuim1[p] = 236; schuim1[p + 1] = 246; schuim1[p + 2] = 248; schuim1[p + 3] = s1 * 255;
      schuim2[p] = 236; schuim2[p + 1] = 246; schuim2[p + 2] = 248; schuim2[p + 3] = s2 * 255;
    }
  }
  return { water, schuim1, schuim2, heeftWater, heeftSchuim, meer: meerM, heeftMeer };
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
// ---------- wegen van het wegennet (C12) ----------
// Het wegennet (view.wegennet) hangt de terreinlaag elke frame aan de gedeelde basis (zetNet); zonder net verandert
// er niets. Bomen, plukken, stenen en akkers komen niet op asfalt, stoep, oprit of berm. Straten liggen op
// tegelranden (bits 0-3: N, O, Z, W), een weg door het tegelbinnenste loopt schuin door het midden (bit 4, langs
// wegHoek), bit 5 is een berm. grondOp van het net telt mee als het er is.
export const WEG_HALF = 0.105; // in T: halve breedte van de breedste weg plus stoep (STAM 0,16 / 2 + 0,025)
const WEG_BERM = 0.08; // in T: extra bij een berm
export function zetNet(b, net) {
  const n = net && net.versie > 0 && typeof net.wegBits === 'function' ? net : null;
  if (b) b.net = n;
  return n;
}
const wegBitsVan = (net, i) => (net && i >= 0 ? net.wegBits(i) | 0 : 0);
// Hoek van de belangrijkste weg in of langs vakje i (of NaN).
function wegHoekVan(net, i) {
  const h = net && typeof net.wegHoek === 'function' ? net.wegHoek(i) : NaN;
  return typeof h === 'number' ? h : NaN;
}
// Ligt (wx, wy), met een marge in wereldeenheden, op een weg, stoep, oprit of berm?
export function opWeg(b, wx, wy, marge = 0) {
  const net = b.net;
  if (!net) return false;
  const geo = b.geo, T = geo.T;
  if (typeof net.grondOp === 'function') {
    for (let q = 0; q < 5; q++) {
      const g = net.grondOp(wx + (q === 1 ? marge : q === 2 ? -marge : 0), wy + (q === 3 ? marge : q === 4 ? -marge : 0));
      if (g === 1 || g === 2 || g === 4) return true;
    }
  }
  const k = Math.floor(wx / T), r = Math.floor(wy / T);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dk = -1; dk <= 1; dk++) {
      const kk = k + dk, rr = r + dr;
      if (kk < 0 || rr < 0 || kk >= geo.kol || rr >= geo.rij) continue;
      const bits = wegBitsVan(net, rr * geo.kol + kk);
      if (!bits) continue;
      const half = T / 2, cx = (kk + 0.5) * T, cy = (rr + 0.5) * T, dx = wx - cx, dy = wy - cy;
      const band = (WEG_HALF + (bits & 32 ? WEG_BERM : 0)) * T + marge;
      // alleen het stuk van de straat langs dit vakje (plus de band om de hoek, zodat kruisingen dicht zijn)
      const binnenX = Math.abs(dx) <= half + band, binnenY = Math.abs(dy) <= half + band;
      if ((bits & 1) && binnenX && Math.abs(dy + half) < band) return true;
      if ((bits & 4) && binnenX && Math.abs(dy - half) < band) return true;
      if ((bits & 2) && binnenY && Math.abs(dx - half) < band) return true;
      if ((bits & 8) && binnenY && Math.abs(dx + half) < band) return true;
      if ((bits & 16) && dk === 0 && dr === 0) {
        let h = wegHoekVan(net, rr * geo.kol + kk);
        if (!(h === h)) h = Math.PI / 4;
        if (Math.abs(-dx * Math.sin(h) + dy * Math.cos(h)) < band) return true;
      }
    }
  }
  return false;
}
// Sleutel van de wegen in en rond een vakje (3x3): verandert hij, dan rekent het vakje zijn kenmerken opnieuw uit.
function wegSleutel(b, t) {
  const net = b.net;
  if (!net) return 0;
  const geo = b.geo;
  let k = 7, iets = false;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dk = -1; dk <= 1; dk++) {
      const kk = t.k + dk, rr = t.r + dr;
      const bits = kk < 0 || rr < 0 || kk >= geo.kol || rr >= geo.rij ? 0 : wegBitsVan(net, rr * geo.kol + kk);
      if (bits) iets = true;
      k = (Math.imul(k, 31) + bits + 1) | 0;
    }
  }
  if (!iets) return 0;
  const h = wegHoekVan(net, t.i);
  return (Math.imul(k, 31) + (h === h ? Math.round(h * 1000) : -1)) | 1;
}
// Raakt een kenmerk een weg? Een perceel als gedraaide rechthoek (rand en midden), de rest als schijf.
function kenmerkOpWeg(b, t, type, x, y, rr, variant, extra) {
  if (type === GRAAT) return false;
  const wx = t.x + x, wy = t.y + y;
  if (type === PERCEEL) {
    const h = hoekVan(t, [0, 0, 0, 0, variant], 0), co = Math.cos(h), si = Math.sin(h), hu = rr + 0.15, hv = extra + 0.15;
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        if (Math.abs(i) < 2 && Math.abs(j) < 2 && (i || j)) continue;
        const u = (i / 2) * hu, v = (j / 2) * hv;
        if (opWeg(b, wx + u * co - v * si, wy + u * si + v * co, 0)) return true;
      }
    }
    return false;
  }
  const r = type === OPENPLEK ? rr * 0.5 : type === STAM ? rr * 0.5 : type === BOERDERIJ ? 2.2 : rr * 0.8;
  return opWeg(b, wx, wy, Math.min(2.5, r + 0.1));
}

export function kenmerkenVoorTegel(t, b) {
  const wk = b.net ? wegSleutel(b, t) : 0;
  if (b.kenmerken[t.i] && (b.kenmWeg ? b.kenmWeg[t.i] : 0) === wk) return b.kenmerken[t.i];
  if (wk || b.kenmWeg) { b.kenmWeg ??= new Int32Array(b.geo.tegels.length); b.kenmWeg[t.i] = wk; b.kosten[t.i] = -1; }
  const uit = [];
  const g = new Float32Array(SOORTEN);
  const geo = b.geo, half = geo.T / 2;
  const r = rnd(t.i * 9176 + 31);
  const zet = (type, x, y, rr, variant, extra = 0) => { if (!wk || !kenmerkOpWeg(b, t, type, x, y, rr, variant, extra)) uit.push(type, x, y, rr, variant, extra); };
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
  if (akkerBuur && t.eig >= 0 && t.terrein !== 'berg') {
    // langs een weg volgen de akkers de weg (C12); anders het akkerrooster van het land
    const wh = wk && wegBitsVan(b.net, t.i) ? wegHoekVan(b.net, t.i) : NaN;
    if (wh === wh) percelenLangsWeg(t, b, zet, g, wh);
    else percelen(t, b, zet, g);
  }
  if (bosBuur) {
    // dicht bladerdak: een verschoven rooster van 1,6 eenheid; aan de bosrand struiken en jonge berken,
    // op open plekken gras met hier en daar een struik
    const cel = 1.6, n = Math.round(geo.T / cel);
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < n; ci++) {
        const q = ci * 31 + cj;
        if (hash(t.i, q, 3) >= 0.88) continue;
        const x = -half + (ci + 0.5) * cel + (hash(t.i, q, 1) - 0.5) * 1.3;
        const y = -half + (cj + 0.5) * cel + (hash(t.i, q, 2) - 0.5) * 1.3;
        const wx = t.x + x, wy = t.y + y;
        if (isWater(b, wx, wy)) continue;
        const wB = gew(x, y)[BOS];
        if (wB <= 0.3 || g[BERG] > 0.5 || !droog(x, y, 0.5)) continue;
        const h = hash(t.i, q, 4), h6 = hash(t.i, q, 6), open = openPlekOp(b, wx, wy);
        if (open > 0.5 && wB > 0.5) {
          if (hash(t.i, q, 8) < 0.1) zet(BOOM, x, y, 0.4 + 0.2 * h, boomCode(STRUIK, Math.floor(hash(t.i, q, 5) * 2), boomKleurVan(STRUIK, b, wx, wy, h6)), h6);
          continue;
        }
        if (wB <= 0.5) {
          const k = hash(t.i, q, 9);
          if (k < 0.5) zet(BOOM, x, y, 0.38 + 0.22 * h, boomCode(STRUIK, Math.floor(hash(t.i, q, 5) * 2), boomKleurVan(STRUIK, b, wx, wy, h6)), h6);
          else if (k < 0.66) zet(BOOM, x, y, 0.5 + 0.16 * h, boomCode(BERK, Math.floor(hash(t.i, q, 5) * 2), boomKleurVan(BERK, b, wx, wy, h6)), h6);
          continue;
        }
        const soort = bosSoort(b, t, wx, wy, hash(t.i, q, 7), hash(t.i, q, 10));
        const oud = hash(t.i, q, 11) < 0.05 ? 1.22 : 1;
        const vorm = Math.floor(hash(t.i, q, 5) * BOOM_VORMEN[soort]);
        zet(BOOM, x, y, (0.62 + h * 0.42) * BOOM_MAAT[soort] * oud * (open > 0.3 ? 0.85 : 1), boomCode(soort, vorm, boomKleurVan(soort, b, wx, wy, h6)), h6);
      }
    }
    if (t.terrein === 'bos') {
      // open plekken: grasvlekken die samen een open plek vormen; omgevallen stammen, liefst aan de rand ervan
      for (let q = 0; q < 16; q++) {
        const x = -half + ((q & 3) + 0.5) * (geo.T / 4) + (hash(t.i, q, 12) - 0.5) * 2, y = -half + ((q >> 2) + 0.5) * (geo.T / 4) + (hash(t.i, q, 13) - 0.5) * 2;
        const open = openPlekOp(b, t.x + x, t.y + y);
        if (open > 0.55 && gew(x, y)[BOS] > 0.55 && droog(x, y, 1)) zet(OPENPLEK, x, y, 1.8 + 1.4 * open + hash(t.i, q, 14), hash(t.i, q, 15), hash(t.i, q, 16) * Math.PI);
      }
      const stammen = hash(t.i, 17) < 0.7 ? 1 + (hash(t.i, 18) < 0.4 ? 1 : 0) : 0;
      for (let q = 0, gezet = 0; q < 8 && gezet < stammen; q++) {
        const x = (hash(t.i, q, 19) - 0.5) * geo.T * 0.85, y = (hash(t.i, q, 20) - 0.5) * geo.T * 0.85;
        const open = openPlekOp(b, t.x + x, t.y + y);
        if ((open < 0.3 && q < 5) || !droog(x, y, 1.5) || gew(x, y)[BOS] < 0.5) continue;
        zet(STAM, x, y, 1.1 + hash(t.i, q, 21) * 0.9, hash(t.i, q, 22) * Math.PI * 2, hash(t.i, q, 23));
        gezet++;
      }
    }
  }
  if (t.terrein === 'berg') bergKenmerken(t, b, zet, r, g);
  else if (t.terrein !== 'bos') {
    // vlakte, kust en onbewoonde eilanden: losse bomen en graspollen op open grasland
    if (!b.akker[t.i]) {
      const bomen = Math.floor(r() * (moeras ? 2 : 4));
      for (let q = 0; q < bomen; q++) {
        const x = (r() - 0.5) * geo.T * 0.8, y = (r() - 0.5) * geo.T * 0.8;
        if (sdOp(b, t.x + x, t.y + y) > -1.5 || !droog(x, y, 1)) continue;
        gew(x, y);
        if (g[ZAND] > 0.35 || g[BOS] > 0.4 || g[AKKER] > 0.4) continue;
        const rr = 0.7 + r() * 0.4, k = r(), zaad = r(), soort = moeras ? (k < 0.6 ? BERK : STRUIK) : k < 0.55 ? LOOF : k < 0.8 ? LINDE : k < 0.9 ? BERK : STRUIK;
        zet(LOSBOOM, x, y, rr * (soort === STRUIK ? 0.6 : 1), boomCode(soort, Math.floor(zaad * BOOM_VORMEN[soort]), boomKleurVan(soort, b, t.x + x, t.y + y, zaad)), zaad);
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
    // hooguit de helft van het oude aantal (2..5): een moeras is nat, geen pokdalig vlak
    const plassen = 1 + Math.floor(r() * 2);
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

// ---------- bos en bergen ----------

// Kroongrootte per soort ten opzichte van een gewone loofboom.
const BOOM_MAAT = [0.85, 1, 1, 0.72, 0.6, 0.6, 0.92];

// Open plek in het bos: 0 dicht bos, 1 midden op een open plek. Trage ruis, plekken van 5 tot 10 eenheden.
function openPlekOp(b, wx, wy) { return smooth(0.64, 0.74, b.geo.ruis(wx * 0.085 + 211, wy * 0.085 + 63)); }

// Soort van een boom midden in het bos: naaldbos in vlekken (meer naarmate het hoger ligt), dennen in eigen
// groepen, berken en populieren bij water, verder eik/beuk (loof) en linde in grote vlekken.
function bosSoort(b, t, wx, wy, h7, h10) {
  const ruis = b.geo.ruis;
  const vlek = ruis(wx * 0.065 + 151, wy * 0.065 + 29);
  const naald = Math.max(0, Math.min(0.95, 0.18 + 0.55 * smooth(0.55, 0.75, t.hoogte) + (vlek - 0.5) * 1.6));
  if (h7 < naald) return ruis(wx * 0.09 + 17, wy * 0.09 + 5) > 0.56 ? DEN : SPAR;
  if (h10 < 0.5 && zoetOp(b, wx, wy) < 3.5) return h10 < 0.3 ? BERK : POPULIER;
  if (h10 > 0.93) return BERK;
  return ruis(wx * 0.08 + 41, wy * 0.08 + 13) > 0.53 ? LINDE : LOOF;
}

// Kleurslot van een boom: trage ruis plus een beetje toeval, zodat bomen in groepen dezelfde herfstkleur krijgen
// (geen confetti); slot 4 van loof en linde is de zeldzame felle boom.
function boomKleurVan(soort, b, wx, wy, h) {
  const nk = BOOM_KLEUREN[soort];
  if (nk === 1) return 0;
  const v = 0.75 * b.geo.ruis(wx * 0.11 + 77, wy * 0.11 + 19) + 0.25 * h;
  if (nk === 5) return h < 0.05 ? 4 : v < 0.36 ? 0 : v < 0.52 ? 1 : v < 0.68 ? 2 : 3;
  if (nk === 3) return v < 0.45 ? 0 : v < 0.62 ? 1 : 2;
  return v < 0.5 ? 0 : 1;
}

// Bergvakje: bergmeertje in een vlakke kom, bergbos tot de boomgrens, rotspartijen met puin, en de graten.
function bergKenmerken(t, b, zet, r, g) {
  const geo = b.geo, half = geo.T / 2, ruis = geo.ruis;
  const gew = (x, y) => gewichtenOp(b, t.x + x, t.y + y, g);
  const droog = (x, y, marge) => zoetOp(b, t.x + x, t.y + y) > marge;
  const hOp = (x, y) => hoogteOp(b, t.x + x, t.y + y, gew(x, y)[BERG]);
  const helOp = (x, y, h) => Math.hypot(hOp(x + 0.7, y) - h, hOp(x, y + 0.7) - h) / 0.7;
  // 1. bergmeertje: in de vlakste van een paar kandidaten tussen boomgrens en eeuwige sneeuw
  let meer = null;
  if (hash(t.i, 61) < 0.3) {
    let best = 0.075;
    for (let q = 0; q < 10; q++) {
      const x = (hash(t.i, q, 62) - 0.5) * geo.T * 0.7, y = (hash(t.i, q, 63) - 0.5) * geo.T * 0.7;
      if (gew(x, y)[BERG] < 0.6) continue;
      const h = hOp(x, y);
      if (h < BOOMGRENS + 0.04 || h > SNEEUW_VAST + 0.15) continue;
      const hel = helOp(x, y, h);
      if (hel < best && droog(x, y, 3)) { best = hel; meer = [x, y, h]; }
    }
    if (meer) zet(BERGMEER, meer[0], meer[1], 0.8 + hash(t.i, 64) * 0.8, hash(t.i, 65) * Math.PI, meer[2]);
  }
  const bijMeer = (x, y, m) => meer && Math.hypot(x - meer[0], y - meer[1]) < 2.4 + m;
  // 2. bergbos: sparren en dennen tot de (rafelige) boomgrens, dunner en kleiner naar boven, niet op steile wanden
  const cel = 1.75, n = Math.floor(geo.T / cel);
  for (let cj = 0; cj < n; cj++) {
    for (let ci = 0; ci < n; ci++) {
      const q = ci * 37 + cj;
      const x = -half + (ci + 0.5) * cel + (hash(t.i, q, 66) - 0.5) * 1.3, y = -half + (cj + 0.5) * cel + (hash(t.i, q, 67) - 0.5) * 1.3;
      const gB = gew(x, y)[BERG];
      if (gB < 0.25 || g[BOS] > 0.3) continue;
      const wx = t.x + x, wy = t.y + y, h = hoogteOp(b, wx, wy, gB);
      const grens = BOOMGRENS + (ruis(wx * 0.21 + 5, wy * 0.21 + 3) - 0.5) * 0.1;
      if (h > grens) continue;
      const dicht = smooth(0, 0.14, grens - h);
      if (hash(t.i, q, 68) > 0.3 + 0.62 * dicht || isWater(b, wx, wy) || !droog(x, y, 0.5) || bijMeer(x, y, 0)) continue;
      if (helOp(x, y, h) > 0.3) continue;
      const k = hash(t.i, q, 69), zaad = hash(t.i, q, 70);
      const soort = h < BOOMGRENS - 0.22 && k < 0.14 ? (k < 0.07 ? BERK : LOOF) : k < 0.62 ? SPAR : DEN;
      zet(BOOM, x, y, (0.5 + 0.35 * hash(t.i, q, 71)) * (0.65 + 0.35 * dicht) * BOOM_MAAT[soort], boomCode(soort, Math.floor(zaad * BOOM_VORMEN[soort]), boomKleurVan(soort, b, wx, wy, zaad)), zaad);
    }
  }
  // 3. rotspartijen, vooral boven de boomgrens, met puin dat naar beneden is gerold; de hoogte gaat mee voor de sneeuw
  const clusters = 4 + Math.floor(r() * 5);
  for (let c = 0; c < clusters; c++) {
    let x = 0, y = 0;
    for (let poging = 0; poging < 4; poging++) {
      x = (r() - 0.5) * geo.T * 0.85; y = (r() - 0.5) * geo.T * 0.85;
      if (gew(x, y)[BERG] > 0.4 && !isWater(b, t.x + x, t.y + y)) break;
    }
    const laag = r() < 0.7;
    if (g[BERG] <= 0.4 || isWater(b, t.x + x, t.y + y) || !droog(x, y, 0.8) || bijMeer(x, y, 0.5)) continue;
    if (laag && hoogteOp(b, t.x + x, t.y + y, g[BERG]) < BOOMGRENS - 0.05) continue;
    const rotsen = 2 + Math.floor(r() * 3);
    for (let q = 0; q < rotsen; q++) {
      const rx = x + (r() - 0.5) * 2.4, ry = y + (r() - 0.5) * 2.4, rr = 0.5 + r() * 0.8, v = r();
      if (!droog(rx, ry, rr * 0.6)) continue; // de groep ligt op het droge, maar een losse kei kan in een beek rollen
      zet(ROTS, rx, ry, rr, v, hOp(rx, ry));
    }
    const gruis = 3 + Math.floor(r() * 5);
    for (let q = 0; q < gruis; q++) {
      const gx = x + 0.6 + r() * 2.6, gy = y + 0.6 + r() * 2.6, gr = 0.12 + r() * 0.14, v = r();
      if (droog(gx, gy, 0.1)) zet(GRUIS, gx, gy, gr, v);
    }
  }
  // 4. graten
  graten(t, b, zet, g, meer);
}

// Graten: de kamlijnen van hoogteOp (daar is de kamruis precies 0,5) als korte lijnstukken, via marching squares
// op een rooster van één eenheid per vakje. Hoofdkam boven de boomgrens, zijkammen alleen hoog in het massief.
// GRAAT: [x1, y1, x2, y2, hoogte + 10 voor een zijkam].
const GR_N = 16, GR_V = new Float32Array((GR_N + 1) * (GR_N + 1)), GR_P = new Float32Array(8);
const MS_TABEL = [null, [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2], [2, 3], [0, 2], [0, 1, 2, 3], [1, 2], [1, 3], [0, 1], [3, 0], null];
function graten(t, b, zet, g, meer) {
  const geo = b.geo, ruis = geo.ruis, half = geo.T / 2, d = geo.T / GR_N, n1 = GR_N + 1;
  for (let zij = 0; zij < 2; zij++) {
    const f = zij ? 0.17 : 0.075, ox = zij ? 23 : 5, oy = zij ? 41 : 9;
    for (let j = 0; j <= GR_N; j++) for (let i = 0; i <= GR_N; i++) GR_V[j * n1 + i] = ruis((t.x - half + i * d) * f + ox, (t.y - half + j * d) * f + oy) - 0.5;
    for (let j = 0; j < GR_N; j++) {
      for (let i = 0; i < GR_N; i++) {
        const a = GR_V[j * n1 + i], bb = GR_V[j * n1 + i + 1], c = GR_V[(j + 1) * n1 + i + 1], e = GR_V[(j + 1) * n1 + i];
        const tab = MS_TABEL[(a > 0 ? 1 : 0) | (bb > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (e > 0 ? 8 : 0)];
        if (!tab) continue;
        // snijpunten op de vier randen van de cel (boven, rechts, onder, links)
        GR_P[0] = i + a / (a - bb); GR_P[1] = j;
        GR_P[2] = i + 1; GR_P[3] = j + bb / (bb - c);
        GR_P[4] = i + e / (e - c); GR_P[5] = j + 1;
        GR_P[6] = i; GR_P[7] = j + a / (a - e);
        for (let s = 0; s < tab.length; s += 2) {
          const ax = -half + GR_P[tab[s] * 2] * d, ay = -half + GR_P[tab[s] * 2 + 1] * d;
          const bx = -half + GR_P[tab[s + 1] * 2] * d, by = -half + GR_P[tab[s + 1] * 2 + 1] * d;
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          if (!Number.isFinite(ax + ay + bx + by)) continue;
          const gB = gewichtenOp(b, t.x + mx, t.y + my, g)[BERG];
          if (gB < (zij ? 0.7 : 0.55)) continue;
          const h = hoogteOp(b, t.x + mx, t.y + my, gB);
          if (h < (zij ? ALMGRENS - 0.05 : BOOMGRENS + 0.03)) continue;
          if (zoetOp(b, t.x + mx, t.y + my) < 1 || zoetOp(b, t.x + ax, t.y + ay) < 0.6 || isWater(b, t.x + ax, t.y + ay)) continue;
          if (meer && Math.hypot(mx - meer[0], my - meer[1]) < 3) continue;
          zet(GRAAT, ax, ay, bx, by, h + (zij ? 10 : 0));
        }
      }
    }
  }
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
      const u = (r() < 0.5 ? -1 : 1) * (2.4 + r() * 0.8), v = (r() - 0.5) * 3.6, rr = 0.6 + r() * 0.35, k = r(), zaad = r();
      const soort = k < 0.5 ? LINDE : LOOF;
      zet(LOSBOOM, x + u * co - v * si, y + u * si + v * co, rr, boomCode(soort, Math.floor(zaad * BOOM_VORMEN[soort]), boomKleurVan(soort, b, t.x + x, t.y + y, zaad)), zaad);
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

function hoekInWegvak(b, x, y, hu, hv, co, si) {
  const geo = b.geo;
  for (const [du, dv] of [[-hu, -hv], [hu, -hv], [-hu, hv], [hu, hv], [0, 0]]) {
    const px = x + du * co - dv * si, py = y + du * si + dv * co, k = Math.floor(px / geo.T), r = Math.floor(py / geo.T);
    if (k >= 0 && r >= 0 && k < geo.kol && r < geo.rij && wegBitsVan(b.net, r * geo.kol + k)) return true;
  }
  return false;
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
        // en niet in een vakje met een weg: daar liggen de akkers langs de weg (percelenLangsWeg)
        if (b.net && hoekInWegvak(b, x, y, hu, hv, co, si)) continue;
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

// Akkers langs een weg (C12): een eigen rooster in dit vakje, evenwijdig aan de weg, met de eerste strook direct
// naast de berm. Elk perceel ligt helemaal binnen het vakje, zodat het niet over de akkers van de buren valt.
function percelenLangsWeg(t, b, zet, g, hoek) {
  const geo = b.geo, half = geo.T / 2, T = geo.T;
  hoek = ((hoek % Math.PI) + Math.PI) % Math.PI;
  const graad = Math.round((hoek * 180) / Math.PI) % 180, h = (graad * Math.PI) / 180, co = Math.cos(h), si = Math.sin(h);
  const bits = wegBitsVan(b.net, t.i);
  const cv = 4 + hash(t.i, 12) * 1.5;
  const naast = (WEG_HALF + (bits & 32 ? WEG_BERM : 0)) * T + 0.3;
  // door het midden: de stroken beginnen naast de weg; langs een rand: naast die rand
  const v0 = bits & 16 ? naast : -half + naast;
  const helling = b.bergvoet[t.i] || t.hoogte > 0.58, bijStad = b.stad[t.i];
  const ext = half * Math.SQRT2;
  const binnen = (px, py) => Math.abs(px - t.x) <= half - 0.1 && Math.abs(py - t.y) <= half - 0.1;
  for (let bb = Math.floor((-ext - v0) / cv); v0 + bb * cv < ext; bb++) {
    const v = v0 + (bb + 0.5) * cv, hv = cv / 2 - 0.2;
    const rl = 5.5 + 3 * hash(t.i, bb, 15);
    for (let a = Math.floor(-ext / rl) - 1; a * rl < ext; a++) {
      const u = (a + 0.5) * rl + (hash(t.i, bb, 16) - 0.5) * 1.2, hu = rl / 2 - 0.2;
      const x = t.x + u * co - v * si, y = t.y + u * si + v * co;
      let ok = true;
      for (const [du, dv] of [[-hu, -hv], [hu, -hv], [-hu, hv], [hu, hv]]) if (!binnen(x + du * co - dv * si, y + du * si + dv * co)) { ok = false; break; }
      if (!ok || gewichtenOp(b, x, y, g)[AKKER] <= 0.5 || !droogVlak(b, x, y, hu, hv, co, si)) continue;
      const zaad = t.i * 131 + a * 7 + bb, k = hash(zaad, bb, 14);
      let soort = k < 0.27 ? GRAAN : k < 0.39 ? GROEN : k < 0.51 ? PLOEG : k < 0.61 ? KOOLZAAD : k < 0.75 ? WEI : k < 0.85 ? MAIS : k < 0.9 ? BRAAK : BOOMGAARD;
      const k2 = hash(zaad, bb, 19);
      if (helling && k2 < 0.45) soort = WIJN;
      else if (bijStad && k2 < 0.3) soort = KAS;
      const rijen = hash(zaad, bb, 18) < 0.5 ? 16 : 0, k3 = hash(zaad, bb, 20);
      const rand = k3 < 0.14 ? ZANDPAD : t.hoogte > 0.56 && k3 < 0.7 ? MUUR : t.hoogte < 0.47 && k3 < 0.65 ? SLOOT : HAAGRAND;
      zet(PERCEEL, x - t.x, y - t.y, hu, soort | rijen | (rand << 5) | ((graad + 1) << 8), hv);
    }
  }
}

// ---------- boomsprites ----------

// Kleuren per boomsoort en kleurslot: [winter, lente, zomer, herfst], of één kleur voor het hele jaar (naaldbomen).
// Herfst in vlekken oker, olijf en goudbruin, wat roest en af en toe een felle boom; lente fris lichtgroen.
const BOOM_TINT = [
  [['#21402c']], // spar
  [['#6e5a40', '#7cab4c', '#3d6a33', '#a8843a'], ['#6a5a44', '#8ab554', '#4a7838', '#7f7a38'], ['#6e5840', '#71a046', '#355f30', '#b38c45'],
    ['#6a5440', '#93bd5c', '#527f3c', '#9c5a2e'], ['#6e5a42', '#eeece2', '#5f8a3a', '#d26a26']], // loof
  [['#6a5a46', '#8cba58', '#4f7f3c', '#c9a032'], ['#6c5c48', '#9ac462', '#5a8a44', '#b89a3a'], ['#685844', '#84b052', '#477638', '#a08a38'],
    ['#6a5a46', '#a2c86a', '#62904a', '#c8a84a'], ['#6c5a44', '#90bc5a', '#4a7a3a', '#8a7a2e']], // linde
  [['#7a6458', '#a8d070', '#6f9a48', '#d8b83a'], ['#76604f', '#b4d67a', '#7aa652', '#c8a83a']], // berk
  [['#6a5a48', '#88b458', '#4f7a3a', '#d0b040'], ['#6c5c4a', '#94bc60', '#5a8440', '#b89a38']], // populier
  [['#6a5a48', '#6e9a44', '#4a6a32', '#8a6a30'], ['#665846', '#7aa24c', '#56763a', '#9a5a2a'], ['#6a5848', '#f2f0e6', '#5a7038', '#7a5a2a']], // struik
  [['#2a4e40']], // den
];
const BOOM_START = [];
let BOOM_TOTAAL = 0;
for (let s = 0; s < 7; s++) { BOOM_START[s] = BOOM_TOTAAL; BOOM_TOTAAL += BOOM_VORMEN[s] * BOOM_KLEUREN[s]; }
// sprite per variantcode: index in de atlas (of -1)
const BOOM_SLOT = new Int16Array(256).fill(-1);
for (let s = 0; s < 7; s++) for (let v = 0; v < BOOM_VORMEN[s]; v++) for (let k = 0; k < BOOM_KLEUREN[s]; k++) BOOM_SLOT[boomCode(s, v, k)] = BOOM_START[s] + v * BOOM_KLEUREN[s] + k;
const BS = 72; // pixels per sprite in de atlas
const BS_SPAN = 2.7; // breedte van een sprite in kroonstralen
const ATLAS_KOL = 9;
export const BOOM_SPRITES = BOOM_TOTAAL;

// Tekent één boom van boven in een cel van de atlas: kroon met lichte noordwestkant en donkere zuidoostkant,
// in de winter kale takken (sommige eiken houden hun bruine blad) en sneeuw op de naaldbomen.
function tekenBoomSprite(c, soort, vorm, kleur, pal, cx, cy) {
  const rr = BS / BS_SPAN, R = rnd(soort * 977 + vorm * 131 + kleur * 17 + 5);
  const basis = pal.boomRgb[soort][Math.min(kleur, pal.boomRgb[soort].length - 1)];
  const donker = [basis[0] * 0.58, basis[1] * 0.62, basis[2] * 0.66];
  const licht = meng(basis, [236, 244, 196], 0.32, [0, 0, 0]);
  const kaal = NAALD(soort) ? 0 : pal.kaal, kap = pal.kap;
  const rondje = (x, y, r) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); };
  const vulKleur = (k, a) => { c.fillStyle = css(k, a); c.fill(); };
  c.save();
  c.lineCap = 'round';
  if (NAALD(soort)) {
    if (soort === SPAR) {
      // spar: spitse sterren in lagen, donker naar licht, de top iets naar het noordwesten
      for (let L = 0; L < 3; L++) {
        const rl = rr * (1.02 - L * 0.3) * (vorm === 2 ? 0.92 : 1), punten = 9 - L * 2 + (vorm === 1 ? 1 : 0), rot = R() * Math.PI;
        const ox = cx - L * rr * 0.07 + (L === 0 ? rr * 0.05 : 0), oy = cy - L * rr * 0.08 + (L === 0 ? rr * 0.06 : 0);
        c.beginPath();
        for (let q = 0; q < punten * 2; q++) {
          const a = rot + (q * Math.PI) / punten, d = q % 2 ? rl * (0.5 + R() * 0.12) : rl * (0.9 + R() * 0.1);
          if (q) c.lineTo(ox + Math.cos(a) * d, oy + Math.sin(a) * d); else c.moveTo(ox + Math.cos(a) * d, oy + Math.sin(a) * d);
        }
        c.closePath();
        vulKleur(L === 0 ? donker : L === 1 ? basis : meng(basis, licht, 0.7, [0, 0, 0]), 1);
      }
      if (kap > 0.04) {
        // sneeuw op de takken: witte vlokken op de buitenste punten en in het midden
        c.beginPath();
        for (let q = 0; q < 9; q++) { const a = q * 0.698 + R() * 0.3, d = rr * (0.45 + R() * 0.4); rondje(cx + Math.cos(a) * d - rr * 0.06, cy + Math.sin(a) * d - rr * 0.07, rr * (0.09 + R() * 0.05)); }
        rondje(cx - rr * 0.12, cy - rr * 0.14, rr * 0.2);
        vulKleur([244, 247, 250], 0.92 * kap);
      }
    } else {
      // den: losse plukken naalden met een blauwgroene glans
      const n = vorm === 0 ? 6 : 5, plukken = [];
      for (let q = 0; q < n; q++) { const a = (q / n) * Math.PI * 2 + R() * 0.6, d = rr * (0.36 + R() * 0.2); plukken.push(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr * (0.36 + R() * 0.12)); }
      plukken.push(cx, cy, rr * 0.4);
      c.beginPath(); for (let q = 0; q < plukken.length; q += 3) rondje(plukken[q] + rr * 0.07, plukken[q + 1] + rr * 0.09, plukken[q + 2]); vulKleur(donker, 1);
      c.beginPath(); for (let q = 0; q < plukken.length; q += 3) rondje(plukken[q], plukken[q + 1], plukken[q + 2] * 0.86); vulKleur(basis, 1);
      c.beginPath(); for (let q = 0; q < plukken.length; q += 3) rondje(plukken[q] - rr * 0.08, plukken[q + 1] - rr * 0.09, plukken[q + 2] * 0.45); vulKleur(meng(basis, [150, 196, 180], 0.45, [0, 0, 0]), 0.9);
      if (kap > 0.04) { c.beginPath(); for (let q = 0; q < plukken.length; q += 3) rondje(plukken[q] - rr * 0.06, plukken[q + 1] - rr * 0.08, plukken[q + 2] * 0.42); vulKleur([244, 247, 250], 0.9 * kap); }
    }
    c.restore();
    return;
  }
  // loofbomen, berk, populier, struik: lobben rond het midden
  const berk = soort === BERK, struik = soort === STRUIK, pop = soort === POPULIER, linde = soort === LINDE;
  const n = berk ? 10 : struik ? 5 : pop ? 6 : linde ? 8 : vorm === 1 ? 9 : 7;
  const lobR = berk ? 0.3 : struik ? 0.44 : pop ? 0.4 : linde ? 0.46 : 0.42, lobD = berk ? 0.55 : struik ? 0.4 : pop ? 0.36 : linde ? 0.44 : 0.46;
  const lobben = [];
  for (let q = 0; q < n; q++) {
    const a = (q / n) * Math.PI * 2 + R() * (linde ? 0.2 : 0.6), d = rr * (lobD + R() * 0.16 - 0.04), lr = rr * (lobR + R() * 0.14);
    lobben.push(cx + Math.cos(a) * d, cy + Math.sin(a) * d * (vorm === 2 && !linde ? 0.85 : 0.96), lr, Math.cos(a) + Math.sin(a));
  }
  lobben.push(cx, cy, rr * (berk ? 0.36 : 0.5), 0);
  // kroondichtheid: in de winter kaal; sommige eiken (loof, vorm 2) houden in de late herfst nog wat bruin blad,
  // maar in hartje winter is elke loofboom kaal
  let kroonA = 1 - smooth(0.3, 0.85, kaal);
  if (soort === LOOF && vorm === 2) kroonA = Math.max(kroonA, 0.5 * kaal * (1 - smooth(0.6, 0.9, kaal)));
  if (berk) kroonA *= 0.9;
  const takA = smooth(0.12, 0.55, kaal);
  if (takA > 0.01) {
    // kale kruin: een waas van twijgjes en kromme hoofdtakken vanuit de stam
    const twijg = berk ? [138, 112, 104] : [104, 86, 70];
    const g = c.createRadialGradient(cx, cy, rr * 0.1, cx, cy, rr * 1.02);
    g.addColorStop(0, css(twijg, 0.5 * takA)); g.addColorStop(0.7, css(twijg, 0.32 * takA)); g.addColorStop(1, css(twijg, 0));
    c.fillStyle = g; c.beginPath(); rondje(cx, cy, rr * 1.02); c.fill();
    const takken = struik ? 7 : 6;
    c.beginPath();
    for (let q = 0; q < takken; q++) {
      const a = (q / takken) * Math.PI * 2 + R() * 0.7, l = rr * (struik ? 0.75 : 0.92), bocht = (R() - 0.5) * 0.8;
      const mx = cx + Math.cos(a + bocht) * l * 0.5, my = cy + Math.sin(a + bocht) * l * 0.5, ex = cx + Math.cos(a) * l, ey = cy + Math.sin(a) * l;
      c.moveTo(cx, cy); c.quadraticCurveTo(mx, my, ex, ey);
      for (const zij of [-0.6, 0.55]) { const sx = (cx + mx) / 2 + (mx - cx) * 0.5, sy = (cy + my) / 2 + (my - cy) * 0.5; c.moveTo(sx, sy); c.lineTo(sx + Math.cos(a + zij) * l * 0.42, sy + Math.sin(a + zij) * l * 0.42); }
    }
    c.strokeStyle = berk ? css([228, 222, 210], 0.95 * takA) : css([82, 64, 50], 0.9 * takA);
    c.lineWidth = rr * (struik ? 0.05 : 0.065);
    c.stroke();
    if (kap > 0.05) {
      // sneeuw op de takken aan de noordwestkant
      c.beginPath();
      for (let q = 0; q < 6; q++) { const a = Math.PI * 1.25 + (R() - 0.5) * 1.6, d = rr * (0.25 + R() * 0.6); c.moveTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d); c.lineTo(cx + Math.cos(a) * d + rr * 0.12, cy + Math.sin(a) * d + rr * 0.05); }
      c.strokeStyle = css([246, 248, 250], 0.85 * kap * takA); c.lineWidth = rr * 0.08; c.stroke();
    }
  }
  if (kroonA > 0.02) {
    c.globalAlpha = kroonA;
    const kl = soort === LOOF && vorm === 2 && kaal > 0.3 ? meng(basis, [122, 84, 48], kaal, [0, 0, 0]) : basis;
    const dk = [kl[0] * 0.58, kl[1] * 0.62, kl[2] * 0.66], lk = meng(kl, [236, 244, 196], berk ? 0.4 : 0.3, [0, 0, 0]);
    c.beginPath(); for (let q = 0; q < lobben.length; q += 4) rondje(lobben[q] + rr * 0.07, lobben[q + 1] + rr * 0.09, lobben[q + 2]); vulKleur(dk, 1);
    c.beginPath(); for (let q = 0; q < lobben.length; q += 4) rondje(lobben[q], lobben[q + 1], lobben[q + 2] * 0.9); vulKleur(kl, 1);
    c.beginPath(); for (let q = 0; q < lobben.length; q += 4) if (lobben[q + 3] < 0.3) rondje(lobben[q] - rr * 0.1, lobben[q + 1] - rr * 0.12, lobben[q + 2] * 0.58); vulKleur(lk, berk ? 0.8 : 0.75);
    // bladstructuur: lichte stipjes aan de zonkant, donkere aan de schaduwkant
    c.beginPath(); for (let q = 0; q < 12; q++) { const a = Math.PI * 1.25 + (R() - 0.5) * 2.4, d = rr * R() * 0.8; rondje(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr * (0.05 + R() * 0.04)); } vulKleur(meng(lk, [250, 250, 220], 0.3, [0, 0, 0]), 0.6);
    c.beginPath(); for (let q = 0; q < 10; q++) { const a = Math.PI * 0.25 + (R() - 0.5) * 2.4, d = rr * (0.3 + R() * 0.6); rondje(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr * (0.06 + R() * 0.05)); } vulKleur(dk, 0.55);
    // meidoorn: rode bessen in de herfst
    if (struik && kleur === 2 && pal.bes > 0.05) { c.beginPath(); for (let q = 0; q < 9; q++) { const a = R() * Math.PI * 2, d = rr * (0.2 + R() * 0.6); rondje(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr * 0.06); } vulKleur([190, 40, 36], pal.bes); }
    c.globalAlpha = 1;
  }
  c.restore();
}

// ---------- seizoenspalet ----------

const css = (c, a = 1) => (a >= 0.999 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`);
const mengH = (a, b, t) => meng(typeof a === 'string' ? hex(a) : a, typeof b === 'string' ? hex(b) : b, Math.max(0, Math.min(1, t)), [0, 0, 0]);

// Seizoen in stappen: de brokken hoeven dan maar eens per 12 dagen opnieuw gebakken te worden.
export const seizoensStap = (dag) => Math.floor((dag ?? 0) / SEIZOEN_STAP);
export const seizoenVanStap = (stap) => seizoen(stap * SEIZOEN_STAP + SEIZOEN_STAP / 2);
// De ene ijs- en sneeuwwaarheid (C12): op de seizoensstap, net als de gebakken grond. Kust, zee, gebouwen en
// strooiwagens lezen deze, zodat een meer niet in de ene laag bevroren en in de andere open is.
// ijsVan: 0 open water, 1 dicht bevroren (meren en sloten); sneeuwDekVan: 0 kaal, 1 alles wit (daken, erven, wegen).
export const ijsVan = (dag) => smooth(0.86, 0.97, seizoenVanStap(seizoensStap(dag)).koud);
export function sneeuwDekVan(dag) {
  const sz = seizoenVanStap(seizoensStap(dag));
  return smooth(0.12, 0.42, 0.3 * smooth(0.45, 0.85, sz.koud) + 0.28 * sz.sneeuw);
}

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
    // boomsprites: basiskleur per soort en kleurslot (rgb), de sprites zelf bouwt TerreinLaag per palet
    boomRgb: BOOM_TINT.map((slots) => slots.map((k) => (k.length === 1 ? hex(k[0]) : seiz(k[0], k[1], k[2], k[3])))),
    bes: smooth(0.15, 0.6, sz.herfst) * (1 - sz.winter),
    // bergen: sneeuwgrens, graten, rotsen, bergmeertjes; open plekken in het bos; omgevallen stammen
    lijn: sneeuwLijn(sz),
    // in de sneeuw nog zachter: een grijze lijn over wit oogt anders als een kluwen paden
    graat: `rgba(196,184,164,${0.12 - 0.06 * smooth(0.3, 0.8, A)})`, graatSchaduw: `rgba(36,28,20,${0.13 - 0.06 * smooth(0.3, 0.8, A)})`,
    rotsDonker: '#655648', rotsLicht: '#a8957a',
    bergmeer: css(mengH('#2e5866', '#cddde4', ijs)), bergmeerDiep: css(mengH('#1f4452', '#bcd0d8', ijs), 0.7),
    bergmeerRand: 'rgba(84,76,62,0.55)', bergmeerLicht: css(hex('#e8f4f6'), 0.45), bergmeerIjs: '#d4e2e8',
    open: css(mengH(seiz('#80845e', '#80aa4c', '#789c48', '#9a9454'), wit, A * 1.3), 0.15),
    openLicht: css(mengH(seiz('#929474', '#98c060', '#8cae58', '#b0a660'), wit, A * 1.3), 0.22),
    stamKleur: css(mengH('#5e4632', wit, kap * 0.5)), stamLicht: css(mengH('#8e7250', wit, kap * 0.8)), stamKern: '#c4aa82',
    pluk: [css(seiz('#7a7a5a', '#3e6a2a', '#3e5c2a', '#6a6a3a'), 0.8), css(seiz('#a8a080', '#9ac060', '#96b460', '#b0a060'), 0.8)],
    helm: [css(seiz('#a8a07a', '#b0b07a', '#b8b27c', '#b4a874'), 0.85), css(seiz('#8e8a68', '#94985e', '#9a9a62', '#9a9060'), 0.85)],
    riet: css(seiz('#b0a070', '#7a9a48', '#6f8a3a', '#a08a50')), rietLicht: css(seiz('#c8b88a', '#9aba60', '#8aa850', '#c0a868'), 0.8),
    rietKop: css(hex('#5a3a22'), 1 - 0.5 * sz.winter),
    plas: css(mengH(seiz('#3f6a66', '#3f706a', '#3d6c66', '#45706a'), '#c0d4da', ijs)),
    plasRand: 'rgba(70,64,40,0.7)', plasLicht: css(hex('#e6f4f4'), 0.35 + 0.3 * ijs),
    rivier: css(mengH('#3f7f8c', '#b8ccd2', ijs * 0.55)), rivierDiep: css(mengH('#2c6678', '#a8bec6', ijs * 0.5), 0.24),
    // het stuk vlak bij een bevroren meer: dicht, met dezelfde ijskleur als het meer (K.ijs)
    rivierIjs: ijs > 0.5 ? css(mengH(K.meerDiep, K.ijs, 0.8)) : null,
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
// Hoek van een perceel: langs een weg de hoek van die weg (in het variantgetal, bits 8-15: 1 + graden), anders die
// van het akkerrooster van het land.
const hoekVan = (t, f = null, p = 0) => { const k = f ? (f[p + 4] >> 8) & 255 : 0; return k ? ((k - 1) * Math.PI) / 180 : hash(t.eig, 9) * Math.PI; };

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
  const ovaal = (x, y, rx, ry, h) => { c.moveTo(x + rx * Math.cos(h), y + rx * Math.sin(h)); c.ellipse(x, y, rx, ry, h, 0, Math.PI * 2); };
  // bakken gaat in fasen (1 akkers en plassen, 2 de rest van de grond, 3 bomen); de scherpe laag doet alles in één keer
  const fase = opties.fase ?? 0;
  if (fase === 0 || fase === 1) {
  // open plekken in het bos: gras met een lichtere rand
  if (em[OPENPLEK].length) {
    // C12: geen platte schijf met een harde rand, maar drie zachte lagen die naar het midden toe dichter worden
    for (const sch of OPEN_LAGEN) vul(pal.open, (iets) => elk(OPENPLEK, (t, f, p) => { iets(); ovaal(t.x + f[p + 1], t.y + f[p + 2], f[p + 3] * sch, f[p + 3] * sch * (0.7 + 0.25 * f[p + 4]), f[p + 5]); }));
    if (fijn) for (const sch of [0.6, 0.4]) vul(pal.openLicht, (iets) => elk(OPENPLEK, (t, f, p) => { iets(); ovaal(t.x + f[p + 1] - 0.3, t.y + f[p + 2] - 0.3, f[p + 3] * sch, f[p + 3] * sch * 0.75, f[p + 5]); }));
  }
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
      const t = tegels[perceelLijst[q]], f = b.kenmerken[perceelLijst[q]], p = perceelLijst[q + 1], h = hoekVan(t, f, p);
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
          const h = hoekVan(t, f, p) + ((f[p + 4] & 16) ? Math.PI / 2 : 0), co = Math.cos(h), si = Math.sin(h);
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
        const dwars = (f[p + 4] & 16) !== 0, h = hoekVan(t, f, p) + (dwars ? Math.PI / 2 : 0), co = Math.cos(h), si = Math.sin(h);
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
        const h = hoekVan(t, f, p), co = Math.cos(h), si = Math.sin(h), x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3], hv = f[p + 5];
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
        const h = hoekVan(t, f, p), co = Math.cos(h), si = Math.sin(h), x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3], hv = f[p + 5];
        for (let u = -hu + 0.6; u < hu; u += 0.6) { c.moveTo(x + u * co + hv * si, y + u * si - hv * co); c.lineTo(x + u * co - hv * si, y + u * si + hv * co); }
        c.moveTo(x - hu * co, y - hu * si); c.lineTo(x + hu * co, y + hu * si);
      }
    });
    lijn(pal.kasLicht, Math.max(0.1, 0.5 * pix), (iets) => {
      for (const q of kassen) {
        const t = tegels[perceelLijst[q]], f = b.kenmerken[perceelLijst[q]], p = perceelLijst[q + 1];
        iets();
        const h = hoekVan(t, f, p), co = Math.cos(h), si = Math.sin(h), x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3] * 0.8, hv = f[p + 5] * 0.5;
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
        const h = hoekVan(t, f, p), co = Math.cos(h), si = Math.sin(h), x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3], hv = f[p + 5];
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
      if (((f[p + 4] >> 5) & 7) !== soort) continue;
      const h = hoekVan(t, f, p);
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
  // strobalen: de kenmerken blijven staan (ze wijzen de graanakkers met balen aan), maar het tekenen doet werk.js:
  // daar maakt de pers ze na het maaien en haalt een trekker met een wagen ze weer op. Zo liggen er geen balen
  // voor de oogst en geen dubbele balen naast die van de pers (C11).

  // 2. plassen in het moeras: modderrand, water, glans
  vul(pal.plasRand, (iets) => elk(PLAS, (t, f, p) => { iets(); ovaal(t.x + f[p + 1], t.y + f[p + 2], f[p + 3] + 0.22, f[p + 3] * 0.62 + 0.22, f[p + 5]); }));
  vul(pal.plas, (iets) => elk(PLAS, (t, f, p) => { iets(); ovaal(t.x + f[p + 1], t.y + f[p + 2], f[p + 3], f[p + 3] * 0.62, f[p + 5]); }));
  if (fijn) lijn(pal.plasLicht, 0.12, (iets) => elk(PLAS, (t, f, p) => {
    iets();
    const x = t.x + f[p + 1] - f[p + 3] * 0.25, y = t.y + f[p + 2] - f[p + 3] * 0.2;
    c.moveTo(x - f[p + 3] * 0.35, y); c.quadraticCurveTo(x, y - f[p + 3] * 0.18, x + f[p + 3] * 0.3, y - f[p + 3] * 0.05);
  }));
  // bergmeertjes: stenige rand, donker diep midden, glans aan de noordwestkant; boven de sneeuwgrens bevroren
  if (em[BERGMEER].length) {
    const ijsMeer = (f, p) => pal.ijs > 0.5 || f[p + 5] > pal.lijn - 0.05;
    vul(pal.bergmeerRand, (iets) => elk(BERGMEER, (t, f, p) => { iets(); ovaal(t.x + f[p + 1], t.y + f[p + 2], f[p + 3] + 0.28, f[p + 3] * 0.72 + 0.28, f[p + 4]); }));
    vul(pal.bergmeerIjs, (iets) => elk(BERGMEER, (t, f, p) => { if (!ijsMeer(f, p)) return; iets(); ovaal(t.x + f[p + 1], t.y + f[p + 2], f[p + 3], f[p + 3] * 0.72, f[p + 4]); }));
    vul(pal.bergmeer, (iets) => elk(BERGMEER, (t, f, p) => { if (ijsMeer(f, p)) return; iets(); ovaal(t.x + f[p + 1], t.y + f[p + 2], f[p + 3], f[p + 3] * 0.72, f[p + 4]); }));
    vul(pal.bergmeerDiep, (iets) => elk(BERGMEER, (t, f, p) => { if (ijsMeer(f, p)) return; iets(); ovaal(t.x + f[p + 1] + f[p + 3] * 0.1, t.y + f[p + 2] + f[p + 3] * 0.08, f[p + 3] * 0.55, f[p + 3] * 0.38, f[p + 4]); }));
    if (fijn) lijn(pal.bergmeerLicht, 0.1, (iets) => elk(BERGMEER, (t, f, p) => {
      iets();
      const x = t.x + f[p + 1], y = t.y + f[p + 2], rr = f[p + 3];
      c.moveTo(x - rr * 0.75, y - rr * 0.1); c.quadraticCurveTo(x - rr * 0.55, y - rr * 0.55, x - rr * 0.05, y - rr * 0.62);
    }));
  }
  }

  // kleine dingen (alleen de scherpe laag): bloemen, lelies, paddenstoelen; onder gras, riet, rotsen, boerderijen en
  // bomen, zodat een paddenstoel niet boven op een boomkruin ligt
  if (opties.naPlassen) opties.naPlassen();

  if (fase === 0 || fase === 2) {
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

  // 4b. graten: een zachte schaduwlijn aan de zuidoostkant (alleen gebakken) en een vage kamlijn; geen witte lijnen
  if (em[GRAAT].length) {
    const graat = (zij, sneeuw, dx, dy) => (iets) => elk(GRAAT, (t, f, p) => {
      const h = f[p + 5] >= 10 ? f[p + 5] - 10 : f[p + 5];
      if ((f[p + 5] >= 10) !== zij || (sneeuw != null && (h > pal.lijn - 0.03) !== sneeuw)) return;
      iets();
      c.moveTo(t.x + f[p + 1] + dx, t.y + f[p + 2] + dy); c.lineTo(t.x + f[p + 3] + dx, t.y + f[p + 4] + dy);
    });
    c.lineCap = 'round';
    for (const zij of [false, true]) {
      const br = zij ? 0.13 : 0.2;
      if (opties.schaduw) lijn(pal.graatSchaduw, Math.max(br * 1.8, 1.2 * pix), graat(zij, null, 0.12, 0.14));
      // de kamlijn zelf is een zachte aanzet in de kleur van de helling, nooit een witte streep
      lijn(pal.graat, Math.max(br, 0.7 * pix), graat(zij, null, -0.03, -0.03));
    }
    c.lineCap = 'butt';
  }

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
  // rotsen in de bergen: warm bruingrijs; boven de sneeuwgrens van het seizoen (of de eeuwige sneeuw) een witte kop
  const sneeuwRots = Math.min(SNEEUW_VAST + 0.03, pal.lijn - 0.05);
  rotsLaag(ROTS, pal.rotsDonker, 1, 0, 0);
  rotsLaag(ROTS, pal.rotsLicht, 0.68, -0.2, -0.22);
  rotsLaag(ROTS, '#eef0f2', 0.45, -0.24, -0.3, (f, p) => f[p + 5] > sneeuwRots);
  rotsLaag(STEEN, pal.steen, 1, 0, 0);
  rotsLaag(STEEN, pal.steenLicht, 0.6, -0.22, -0.24);
  if (fijn) rotsLaag(STEEN, pal.mos, 0.35, 0.18, 0.1, (f, p) => f[p + 4] < 0.35);
  if (pal.kap > 0.02) {
    vul(pal.sneeuwKap, (iets) => {
      elk(STEEN, (t, f, p) => { iets(); const r = f[p + 3]; veelhoek(t.x + f[p + 1], t.y + f[p + 2], r, f[p + 4], 0.5, -0.2 * r, -0.25 * r); });
    });
  }
  vul('#8d877b', (iets) => elk(GRUIS, (t, f, p) => { iets(); rond(t.x + f[p + 1], t.y + f[p + 2], f[p + 3]); }));

  // 5b. omgevallen stammen: schaduw, stam met een lichte bovenkant, kluit aan de voet, zaagvlak aan de top
  if (em[STAM].length) {
    const stam = (dx, dy, schaal) => (iets) => elk(STAM, (t, f, p) => {
      iets();
      const x = t.x + f[p + 1], y = t.y + f[p + 2], l = f[p + 3] * 0.5 * schaal, co = Math.cos(f[p + 4]), si = Math.sin(f[p + 4]);
      c.moveTo(x - co * l + dx, y - si * l + dy); c.lineTo(x + co * l + dx, y + si * l + dy);
    });
    c.lineCap = 'round';
    if (opties.schaduw) lijn('rgba(20,16,10,0.35)', 0.34, stam(0.08, 0.1, 1));
    lijn(pal.stamKleur, Math.max(0.24, 0.8 * pix), stam(0, 0, 1));
    if (fijn) lijn(pal.stamLicht, 0.08, stam(-0.05, -0.06, 0.85));
    c.lineCap = 'butt';
    vul('rgba(78,62,44,0.85)', (iets) => elk(STAM, (t, f, p) => {
      iets();
      const l = f[p + 3] * 0.5;
      rond(t.x + f[p + 1] - Math.cos(f[p + 4]) * l, t.y + f[p + 2] - Math.sin(f[p + 4]) * l, 0.3);
    }));
    if (fijn) vul(pal.stamKern, (iets) => elk(STAM, (t, f, p) => {
      iets();
      const l = f[p + 3] * 0.5;
      rond(t.x + f[p + 1] + Math.cos(f[p + 4]) * l, t.y + f[p + 2] + Math.sin(f[p + 4]) * l, 0.1);
    }));
  }

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

  }

  if (fase === 0 || fase === 3) {
  // 7. bomen: schaduw naar het zuidoosten (alleen gebakken; naaldbomen spits, populieren lang, kale bomen vaag),
  // dan per boom één sprite uit de atlas van het seizoen. Wiegen in de wind: alleen in de scherpe laag.
  const amp = 0.04 + 0.1 * kracht;
  const zx = (f, p) => (zwaai == null ? 0 : Math.sin(zwaai / 1300 + f[p + 5] * 6.283) * amp * wx + amp * 0.4 * wx);
  const zy = (f, p) => (zwaai == null ? 0 : Math.sin(zwaai / 1300 + f[p + 5] * 6.283) * amp * wy + amp * 0.4 * wy);
  const bomen = (fn) => { elk(BOOM, fn); elk(LOSBOOM, fn); };
  if (opties.schaduw) {
    vul('rgba(8,18,8,0.42)', (iets) => bomen((t, f, p) => {
      if (!NAALD(f[p + 4] & 7)) return;
      iets(); const r = f[p + 3]; ovaal(t.x + f[p + 1] + r * 0.42, t.y + f[p + 2] + r * 0.48, r * 1.12, r * 0.78, Math.PI / 4);
    }));
    vul(`rgba(8,18,8,${(0.42 * (1 - 0.6 * pal.kaal)).toFixed(3)})`, (iets) => bomen((t, f, p) => {
      const soort = f[p + 4] & 7;
      if (NAALD(soort)) return;
      iets(); const r = f[p + 3];
      if (soort === POPULIER) ovaal(t.x + f[p + 1] + r * 1.0, t.y + f[p + 2] + r * 1.12, r * 1.75, r * 0.62, Math.PI / 4);
      else rond(t.x + f[p + 1] + r * 0.32, t.y + f[p + 2] + r * 0.38, r * 1.02);
    }));
  }
  const atlas = opties.atlas;
  if (atlas) {
    const cv = atlas.cv;
    bomen((t, f, p) => {
      const slot = BOOM_SLOT[f[p + 4] & 255];
      if (slot < 0) return;
      const w = f[p + 3] * BS_SPAN;
      c.drawImage(cv, (slot % ATLAS_KOL) * BS, Math.floor(slot / ATLAS_KOL) * BS, BS, BS, t.x + f[p + 1] - w / 2 + zx(f, p), t.y + f[p + 2] - w / 2 + zy(f, p), w, w);
    });
  } else {
    // nog geen atlas (alleen in tests zonder laag): eenvoudige kronen
    vul(pal.kroon[1], (iets) => bomen((t, f, p) => { iets(); rond(t.x + f[p + 1] + zx(f, p), t.y + f[p + 2] + zy(f, p), f[p + 3]); }));
  }
  }
}

// Bouwt de boomatlas van een palet verder op, hooguit `max` sprites; geeft het aantal gebouwde sprites terug.
function bouwAtlas(atlas, pal, max) {
  const c = atlas.cv.getContext('2d');
  let n = 0;
  if (atlas.klaar === 0) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, atlas.cv.width, atlas.cv.height); }
  while (atlas.klaar < BOOM_TOTAAL && n < max) {
    const slot = atlas.klaar;
    let soort = 6;
    while (soort > 0 && BOOM_START[soort] > slot) soort--;
    const rest = slot - BOOM_START[soort], vorm = Math.floor(rest / BOOM_KLEUREN[soort]), kleur = rest % BOOM_KLEUREN[soort];
    tekenBoomSprite(c, soort, vorm, kleur, pal, (slot % ATLAS_KOL) * BS + BS / 2, Math.floor(slot / ATLAS_KOL) * BS + BS / 2);
    atlas.klaar++; n++;
  }
  return n;
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
    } else n += ty === BOERDERIJ ? 16 : ty === ROTS || ty === STEEN || ty === PLAS ? 2.5 : ty === BOOM || ty === LOSBOOM ? 1 : ty === RIET ? 1.2
      : ty === BERGMEER ? 6 : ty === STAM ? 3 : ty === OPENPLEK ? 1.2 : ty === GRAAT ? 0.4 : 0.6;
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

// Open plekken in het bos: drie lagen (schaal van de straal) met elk de alfa van pal.open; de rand is zo zacht.
const OPEN_LAGEN = [1, 0.88, 0.76, 0.64, 0.52];

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
  // C12: de geul verloopt in drie zachte lagen naar het midden, zonder harde rand (anders lijkt de rivier een weg met
  // twee rijstroken)
  for (const f of RIVIER_GEUL) laag(pal.rivierDiep, (bw) => bw * f, (bw) => bw > 1.2);
  // bevroren monding bij een bevroren meer: ijs over de volle breedte (zonder diepe geul)
  if (pal.rivierIjs) {
    c.strokeStyle = pal.rivierIjs;
    for (let q = 0; q < n; q++) {
      const st = w.stukken[lijst[q]];
      if (!(st.meerAfst < RIVIER_IJS_AFST)) continue;
      c.beginPath(); pad(st); c.lineWidth = Math.max(pix, st.w + 0.05); c.stroke();
    }
  }
}
const RIVIER_GEUL = [0.7, 0.5, 0.3];
// Tot hoe ver van de rand van een meer een rivier mee bevriest (wereldeenheden).
export const RIVIER_IJS_AFST = 12;

// Glinsteringen die stroomafwaarts drijven (C12): korte, onregelmatige streepjes in twee of drie banen die elk
// zacht van de ene oever naar de andere slingeren, nooit op de middenlijn. Zo lijkt een rivier niet langer op een
// weg met een witte middenstreep. De verschuiving rekent vanaf de bron, dus het patroon loopt door over de naden
// tussen stukken. In een stroomversnelling gaat het sneller en schuimt het. Op een dichtgevroren stuk niets.
// [baan (deel van de halve breedte), slinger, golflengte, streepjes, periode, snelheid, breedte, max, alfa]
// De streepjes zijn kort en onregelmatig (geen vast ritme van streep en gat), zodat er geen rijstrookmarkering ontstaat.
export const GLINSTER_PASSEN = [
  [-0.46, 0.3, 0.55, [0.3, 2.9, 0.12, 1.3, 0.22, 4.4, 0.08, 2.1], 11.42, 1, 0.14, 0.12, 0.42],
  [0.4, 0.34, 0.37, [0.16, 3.6, 0.26, 1.7, 0.1, 2.6], 8.42, 1.3, 0.08, 0.08, 0.5],
];
function tekenGlinsters(c, w, lijst, n, pal, nu) {
  const t = nu / 1000, basisA = c.globalAlpha;
  c.lineCap = 'round';
  const pas = (baan, slinger, golf, dash, periode, snelF, breedteF, kleur, alleenSnel, maxB = Infinity, alfa = 1) => {
    c.setLineDash(dash);
    c.strokeStyle = kleur;
    c.globalAlpha = basisA * alfa;
    for (let q = 0; q < n; q++) {
      const st = w.stukken[lijst[q]];
      if (alleenSnel && !st.snel) continue;
      if (pal.rivierIjs && st.meerAfst < RIVIER_IJS_AFST) continue;
      const rv = w.rivieren[st.r], p = rv.pts, v = rv.snelheid * snelF * (st.snel ? 2 : 1), np = rv.br.length;
      c.beginPath();
      for (let i = st.a; i <= st.e; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(np - 1, i + 1);
        let tx = p[i1 * 2] - p[i0 * 2], ty = p[i1 * 2 + 1] - p[i0 * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const off = (baan + slinger * Math.sin(rv.s[i] * golf + st.r * 1.7)) * rv.br[i] * 0.5;
        const x = p[i * 2] - ty * off, y = p[i * 2 + 1] + tx * off;
        if (i === st.a) c.moveTo(x, y); else c.lineTo(x, y);
      }
      const o = (rv.s[st.a] - t * v) % periode;
      c.lineDashOffset = o < 0 ? o + periode : o;
      c.lineWidth = Math.max(0.08, Math.min(maxB, st.w * breedteF));
      c.stroke();
    }
  };
  for (const [baan, slinger, golf, dash, periode, snelF, breedteF, maxB, alfa] of GLINSTER_PASSEN) pas(baan, slinger, golf, dash, periode, snelF, breedteF, pal.glinster, false, maxB, alfa);
  pas(0, 0.3, 0.8, [0.6, 0.45], 1.05, 1.25, 0.65, pal.schuim, true);
  c.globalAlpha = basisA;
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
      const h = hoekVan(t, f, p), co = Math.cos(h), si = Math.sin(h), x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3], hv = f[p + 5];
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
  mos: 'rgba(104,136,62,0.7)', tak: '#6a5238',
  wit: '#f4f2ea', geel: '#f0d23c', paars: '#9a7ac8', rood: '#d23a2a', grijs: '#9a958a', steel: '#e8dfc8', paddo: '#c0301e', paddoBruin: '#9a6a3a', stip: '#f6f0e6',
  blad1: '#c8782a', blad2: '#d8b03a', lelie: '#4f7f3a', lelieBloem: '#f2c6d8', mol: '#5e4630', molLicht: '#7a6046', varen: '#4f7a36',
};
const MICRO_NAMEN = Object.keys(MICRO_KLEUR);
const MICRO_INDEX = Object.fromEntries(MICRO_NAMEN.map((k, i) => [k, i]));
// varens en takjes als lijntjes; mos, takjes, steeltjes en bruine paddenstoelen pas vanaf zoom 11,5
const MICRO_STREEP = MICRO_NAMEN.map((k) => k === 'tak' || k === 'varen');
const MICRO_DIEP = MICRO_NAMEN.map((k) => k === 'mos' || k === 'tak' || k === 'steel' || k === 'paddoBruin');

// Akkers (ook die van een buurvakje die over de rand steken) en plassen rond een vakje, per stuk
// [akker, x, y, co, si, hu, hv] met 0,3 marge. Alleen bij het uitrekenen van de kleine en fijne dingen per vakje.
function vlakkenBij(t, b) {
  const geo = b.geo, T = geo.T, vlak = [];
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
        const h = akker ? hoekVan(nb, g, p) : g[p + 5];
        vlak.push(akker ? 1 : 0, x, y, Math.cos(h), Math.sin(h), hu, hv);
      }
    }
  }
  return vlak;
}
// Op het droge en niet op het strand, niet in rivier of meer, niet op een akker of in een plas.
function vrijVanVlak(b, vlak, x, y) {
  if (sdOp(b, x, y) > -2.4 || zoetOp(b, x, y) < 0.25) return false;
  for (let q = 0; q < vlak.length; q += 7) {
    const dx = x - vlak[q + 1], dy = y - vlak[q + 2], u = (dx * vlak[q + 3] + dy * vlak[q + 4]) / vlak[q + 5], v = (dy * vlak[q + 3] - dx * vlak[q + 4]) / vlak[q + 6];
    if (vlak[q] ? Math.abs(u) < 1 && Math.abs(v) < 1 : u * u + v * v < 1) return false;
  }
  return true;
}

// ---------- fijne laag (zoom 11-14): wat je pas ziet als je er met je neus bovenop zit ----------
// Grassprieten en polletjes die in de wind wiegen, wilde bloemen per soort en seizoen (paardenbloemen en
// boterbloemen in de lente, pluizenbollen, klaver, klaprozen en korenbloemen langs het graan in de zomer,
// knoopkruid in de nazomer), paarse heide op zandgrond in de late zomer, keien met mos, mierenhopen en bramen aan
// de bosrand, rijtjes verse molshopen in de wei, riet op de slootkanten en knotwilgen langs de sloten in laag land,
// paddenstoelen bij omgevallen stammen en heksenkringen in de herfst, een tapijt van gevallen blad in het herfstbos
// en onder losse bomen, en in de sneeuw sporen van wandelaars, hazen, vogels en vossen. Per vakje en seizoensstap
// één keer uitgerekend (vaste hashes), net als de kleine dingen; hard plafond MAX_FIJN per frame.
const MAX_FIJN = 900;
const F_POL = 0, F_PAARD = 1, F_PLUIS = 2, F_BOTER = 3, F_KLAVER = 4, F_KLAP = 5, F_KOREN = 6, F_KNOOP = 7, F_HEIDE = 8,
  F_KEI = 9, F_MIER = 10, F_MOL = 11, F_RIET = 12, F_KNOT = 13, F_BRAAM = 14, F_BLAD = 15, F_PADDO = 16, F_HEKS = 17, F_SPOOR = 18;
const F_SOORTEN = 19, FS = 6; // per ding: soort, x, y, r (bij een spoor de lengte), hoek, zaad (bij een spoor: soort + zaad)
export const FIJN_NAMEN = ['gras', 'paardenbloem', 'pluizenbol', 'boterbloem', 'klaver', 'klaproos', 'korenbloem', 'knoopkruid', 'heide',
  'kei', 'mierenhoop', 'molshoop', 'slootriet', 'knotwilg', 'braam', 'bladerdek', 'paddenstoel', 'heksenkring', 'spoor'];
// Bloeitijd in dagen van het jaar: [soort, van, tot]
const BLOEI = [[F_PAARD, 85, 140], [F_PLUIS, 136, 162], [F_BOTER, 110, 185], [F_KLAVER, 140, 240], [F_KLAP, 150, 210], [F_KOREN, 160, 215], [F_KNOOP, 190, 250]];
const BLOEM_KLEUR = { [F_PAARD]: '#f2c41c', [F_BOTER]: '#ffdc28', [F_KLAVER]: '#f1ece4', [F_KLAP]: '#d6281e', [F_KOREN]: '#4c6ad6', [F_KNOOP]: '#8e4aa6' };
const BLOEM_HART = { [F_PAARD]: '#c88a12', [F_BOTER]: '#fff6b0', [F_KLAVER]: '#e6b8c8', [F_KLAP]: '#2a1814', [F_KOREN]: '#26306a', [F_KNOOP]: '#5e2a70' };
const SPOOR_STAP = [0.32, 0.9, 0.13, 0.28]; // mens, haas, vogel, vos
const FIJN_G = new Float32Array(SOORTEN);
const TAU_T = Math.PI * 2;
const frac = (v) => v - Math.floor(v);

// Een plek vol wilde bloemen in een open grasvakje (of null), vast per vakje. Gedeeld met natuur.js: daar zoemen de
// bijen en hommels precies boven deze plekken.
export function bloemenPlek(t, b) {
  if ((t.terrein !== 'vlakte' && t.terrein !== 'kust') || b.akker[t.i] || b.moeras[t.i] || b.duin[t.i] || b.stad[t.i] || hash(t.i, 801) > 0.35) return null;
  const x = t.x + (hash(t.i, 802) - 0.5) * b.geo.T * 0.55, y = t.y + (hash(t.i, 803) - 0.5) * b.geo.T * 0.55, r = 1.3 + hash(t.i, 804) * 0.8;
  if (sdOp(b, x, y) > -(r + 2.5) || zoetOp(b, x, y) < r + 0.5) return null;
  const g = gewichtenOp(b, x, y, FIJN_G);
  if (g[AKKER] > 0.25 || g[BOS] > 0.3) return null;
  const f = kenmerkenVoorTegel(t, b);
  for (let p = 0; p < f.length; p += STAP) {
    if (f[p] !== LOSBOOM && f[p] !== STEEN && f[p] !== BOERDERIJ) continue;
    const m = f[p] === BOERDERIJ ? 3 : f[p + 3];
    if (Math.hypot(t.x + f[p + 1] - x, t.y + f[p + 2] - y) < r + m + 0.3) return null;
  }
  return { x, y, r };
}
// Voor andere lagen (natuur.js): de typen van kenmerkenVoorTegel (per kenmerk STAP getallen), de gewassen en
// randen van een perceel (variant & 15 en variant >> 5) en de hoek van het akkerrooster van een vakje.
export const KENMERK = { BOOM, LOSBOOM, ROTS, STEEN, PLAS, BOERDERIJ, STAM, OPENPLEK, PERCEEL, RIET, STAP };
export const GEWAS = { GRAAN, GROEN, PLOEG, KOOLZAAD, WEI, BOOMGAARD, WIJN, KAS, MAIS, BRAAK };
export const RAND = { HAAGRAND, MUUR, SLOOT, ZANDPAD };
export const perceelHoek = (t, f = null, p = 0) => hoekVan(t, f, p);
// Heide: zandgrond achter de duinen (kustvakjes die geen duin of moeras zijn), in vlekken.
function heideOp(b, t) { return t.terrein === 'kust' && !b.duin[t.i] && !b.moeras[t.i] && !b.akker[t.i] && b.geo.ruis(t.x * 0.05 + 141, t.y * 0.05 + 77) > 0.42; }

// ---------- de laag ----------

export class TerreinLaag {
  constructor() {
    this.basis = null;
    this.cache = new Map(); // `${R}:${ck}:${cr}` -> brok, in LRU-volgorde
    this.bytes = 0;
    this.frame = 0;
    this.politiek = []; // per brok: { sig, raster, ketens }
    this.pool = [];
    this.aantalGebakken = 0; // teller (gebakken() is de vraag of een wereldvak klaar is)
    this.taak = null; // brok dat in stappen gebakken wordt
    this.werk = 0; // geschat bakwerk in deze frame (ms); 0 = een rustige frame
    this.atlasKlaar = null; // laatste complete boomatlas
    this.grof = new Map(); // brokindex -> { stap, cv }: terugvalversie (1 pixel per eenheid) tot het echte brok af is
    this.grofBytes = 0;
    this.klaar = null; // per brok in de laatste frame: 2 actueel gebakken, 1 echte (oudere) grond, 0 alleen de terugval
    this.klaarFrame = -1;
    this.paletten = new Map(); // seizoensstap -> palet, hooguit 3
    this.optBak = { schaduw: true, zwaai: null, pal: null, wind: null, emmers: nieuweEmmers(), fase: 0, atlas: null };
    this.optScherp = { schaduw: false, zwaai: 0, pal: null, wind: null, emmers: nieuweEmmers(), atlas: null };
  }

  // ---- voor de natuurlaag en andere lagen: puur decor, vast per wereld ----

  // Hoogte van het terrein op de schaal van de bergzones (BOOMGRENS enz.), zoals de gebakken grond hem gebruikt.
  hoogte(wx, wy) {
    if (!this.basis) return 0;
    const g = this._g ?? (this._g = new Float32Array(SOORTEN));
    gewichtenOp(this.basis, wx, wy, g);
    return hoogteOp(this.basis, wx, wy, g[BERG]);
  }
  // Terreingewichten op een punt (samen 1).
  gewicht(wx, wy) {
    if (!this.basis) return { gras: 1, bos: 0, berg: 0, zand: 0, akker: 0 };
    const g = this._g ?? (this._g = new Float32Array(SOORTEN));
    gewichtenOp(this.basis, wx, wy, g);
    return { gras: g[GRAS], bos: g[BOS], berg: g[BERG], zand: g[ZAND], akker: g[AKKER] };
  }
  // 0 in dicht bos, 1 midden op een open plek.
  openPlek(wx, wy) { return this.basis ? openPlekOp(this.basis, wx, wy) : 0; }
  // Is dit punt vrij van boomkruinen, rotsen, bergmeertjes, plassen en boerderijen (plus marge)? Met alleenBomen
  // tellen alleen de boomkruinen (bijvoorbeeld voor een pad: dat loopt om een rots heen, maar onder een kruin door).
  boomvrij(wx, wy, marge = 0, alleenBomen = false) {
    if (!this.basis) return true;
    const geo = this.geo, tk = Math.floor(wx / geo.T), tr = Math.floor(wy / geo.T);
    for (let r = Math.max(0, tr - 1); r <= Math.min(geo.rij - 1, tr + 1); r++) {
      for (let k = Math.max(0, tk - 1); k <= Math.min(geo.kol - 1, tk + 1); k++) {
        const t = geo.tegels[r * geo.kol + k], f = kenmerkenVoorTegel(t, this.basis);
        for (let p = 0; p < f.length; p += STAP) {
          const ty = f[p];
          const straal = ty === BOOM || ty === LOSBOOM ? f[p + 3] : alleenBomen ? -1
            : ty === ROTS || ty === STEEN ? f[p + 3] : ty === BERGMEER ? f[p + 3] + 0.4 : ty === PLAS ? f[p + 3] + 0.2 : ty === BOERDERIJ ? 2.8 : -1;
          if (straal < 0) continue;
          const dx = t.x + f[p + 1] - wx, dy = t.y + f[p + 2] - wy, rr = straal + marge;
          if (dx * dx + dy * dy < rr * rr) return false;
        }
      }
    }
    return true;
  }
  // Vlaggen per vakje (Uint8Array per soort), vast per wereld.
  get vlaggen() {
    const b = this.basis;
    return b ? { moeras: b.moeras, klif: b.klif, duin: b.duin, bergvoet: b.bergvoet, stad: b.stad, akker: b.akker } : null;
  }
  // Bergmeertjes: [{ x, y, r, h }], vast per wereld.
  get bergmeren() {
    if (!this.basis) return [];
    if (this._meertjes) return this._meertjes;
    const uit = [];
    for (const t of this.geo.tegels) {
      if (t.terrein !== 'berg') continue;
      const f = kenmerkenVoorTegel(t, this.basis);
      for (let p = 0; p < f.length; p += STAP) if (f[p] === BERGMEER) uit.push({ x: t.x + f[p + 1], y: t.y + f[p + 2], r: f[p + 3], h: f[p + 5] });
    }
    return (this._meertjes = uit);
  }
  // Watervallen: de steilste punten langs de rivieren (verval over een paar punten, ten opzichte van de lengte),
  // op het droge, niet bij de kust of in een meer, minstens 14 eenheden uit elkaar, hooguit 14 per wereld.
  // [{ x, y, hoek (stroomrichting), br (breedte), kracht 0..1, rivier, i }]
  get watervallen() {
    if (!this.basis) return [];
    if (this._vallen) return this._vallen;
    const b = this.basis, geo = this.geo, w = b.water, kand = [];
    for (let ri = 0; ri < w.rivieren.length; ri++) {
      const rv = w.rivieren[ri], n = rv.br.length;
      if (rv.delta || n < 12) continue;
      const d = new Float32Array(n);
      for (let i = 3; i < n - 3; i++) d[i] = (tegelHoogte(geo, rv.pts[(i - 3) * 2], rv.pts[(i - 3) * 2 + 1]) - tegelHoogte(geo, rv.pts[(i + 3) * 2], rv.pts[(i + 3) * 2 + 1])) / Math.max(0.5, rv.s[i + 3] - rv.s[i - 3]);
      for (let i = 4; i < n - 4; i++) {
        if (d[i] < 0.0062 || !rv.open[i]) continue;
        let top = true;
        for (let j = Math.max(3, i - 6); j <= Math.min(n - 4, i + 6) && top; j++) if (d[j] > d[i] || (d[j] === d[i] && j < i)) top = false;
        const x = rv.pts[i * 2], y = rv.pts[i * 2 + 1];
        if (!top || sdOp(b, x, y) > -4 || veldOp(w.meer, x, y) < 3) continue;
        kand.push({ x, y, hoek: Math.atan2(rv.pts[(i + 1) * 2 + 1] - rv.pts[(i - 1) * 2 + 1], rv.pts[(i + 1) * 2] - rv.pts[(i - 1) * 2]), br: rv.br[i], kracht: smooth(0.006, 0.011, d[i]), rivier: ri, i, d: d[i] });
      }
    }
    kand.sort((p, q) => q.d - p.d || p.rivier - q.rivier || p.i - q.i);
    const uit = [];
    for (const k of kand) {
      if (uit.length >= 14) break;
      if (uit.some((u) => Math.hypot(u.x - k.x, u.y - k.y) < 14)) continue;
      uit.push(k);
    }
    return (this._vallen = uit);
  }

  // ---- boomatlas: per palet, in stukjes gebouwd zodat een seizoenswissel niet hapert ----

  atlasVan(pal) {
    if (!pal.atlas) pal.atlas = { cv: fabriek(ATLAS_KOL * BS, Math.ceil(BOOM_TOTAAL / ATLAS_KOL) * BS), klaar: 0 };
    return pal.atlas;
  }
  // Bouwt verder aan de atlas van dit palet; geeft terug of hij af is.
  bouwAtlasStuk(pal, max) {
    const a = this.atlasVan(pal);
    if (a.klaar < BOOM_TOTAAL) {
      this.werk += 0.06 * bouwAtlas(a, pal, max);
      if (a.klaar >= BOOM_TOTAAL) this.atlasKlaar = a;
    }
    return a.klaar >= BOOM_TOTAAL;
  }
  // Atlas voor de scherpe laag: die van dit palet als hij af is, anders de laatste complete (alleen de allereerste
  // keer bouwt hij hem in één keer).
  scherpeAtlas(pal) {
    const a = this.atlasVan(pal);
    if (a.klaar >= BOOM_TOTAAL) return a;
    if (!this.atlasKlaar) { bouwAtlas(a, pal, BOOM_TOTAAL); this.atlasKlaar = a; return a; }
    return this.atlasKlaar;
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
      if (this.paletten.size >= 3) {
        // de atlas van een weggegooid palet mag weg, tenzij het de laatste complete is
        const weg = this.paletten.keys().next().value, oud = this.paletten.get(weg);
        if (oud.atlas && oud.atlas !== this.atlasKlaar) oud.atlas = null;
        this.paletten.delete(weg);
      }
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
    this.taak = null;
    this._vallen = null; this._meertjes = null; // hoorden bij de vorige wereld
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
    this._micro = null; this._fijn = null; // kleine en fijne dingen per vakje hoorden bij de vorige wereld
    this.grof = new Map(); this.grofBytes = 0;
    this.klaar = new Uint8Array(this.kolC * this.rijC); this.klaarFrame = -1;
  }

  dekking(zoom) { return smooth(2.2, 3.2, zoom); }

  // Geheugen: brokken in de cache (bytes), de pool met herbruikbare canvassen, het brok in de maak en de boomatlassen.
  statistiek() {
    let pool = 0, atlas = 0;
    for (const c of this.pool) pool += c.width * c.height * 4;
    const gezien = [];
    for (const p of this.paletten.values()) if (p.atlas && !gezien.includes(p.atlas)) gezien.push(p.atlas);
    if (this.atlasKlaar && !gezien.includes(this.atlasKlaar)) gezien.push(this.atlasKlaar);
    for (const a of gezien) atlas += a.cv.width * a.cv.height * 4;
    const werk = this.taak ? (CH * this.taak.R) ** 2 * 4 : 0;
    return { canvassen: this.cache.size, bytes: this.bytes, gebakken: this.aantalGebakken, pool, atlas, werk, grof: this.grofBytes, totaal: this.bytes + pool + atlas + werk + this.grofBytes };
  }

  // ---- handtekeningen ----

  globaleSig(s) {
    let t = `${s.grensVersie}|`;
    for (let i = 0; i < s.landen.length; i++) t += `${s.landen[i].alignment},`;
    return t;
  }

  // Eigenaars en bebouwing van de vakjes in (en rond) een brok, als twee getallen. De wegen van het net tellen mee
  // in z (C12), twee vakjes ver: de kenmerken van een vakje hangen van de wegen in zijn 3x3-buurt af. Een nieuwe weg
  // bakt zo alleen de brokken met (of vlak naast) die vakjes opnieuw.
  brokSig(s, ck, cr) {
    const geo = this.geo, net = this.basis?.net ?? null;
    let e = 7, z = 11;
    for (let r = cr * 4 - 2; r <= cr * 4 + 5; r++) {
      if (r < 0 || r >= geo.rij) continue;
      for (let k = ck * 4 - 2; k <= ck * 4 + 5; k++) {
        if (k < 0 || k >= geo.kol) continue;
        const t = r * geo.kol + k;
        const rand = r < cr * 4 - 1 || r > cr * 4 + 4 || k < ck * 4 - 1 || k > ck * 4 + 4;
        if (!rand) {
          e = Math.imul(e, 31) + s.eigenaar[t] + 3 | 0;
          z = Math.imul(z, 31) + (s.bezet[t] ? 1 : 0) | 0;
        }
        if (net) { const w = wegBitsVan(net, t); if (w) z = Math.imul(z, 37) + w * 1009 + t | 0; }
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
      // grof watermasker (1 monster per eenheid) voor de terugvalversie: zee en meren zoals in bakMaskerData
      const wa8 = new Uint8Array(NN);
      for (let i = 0; i < NN; i++) {
        let wa = smooth(-0.18, 0.18, d.sd[i]);
        if (d.meer[i] < 0.35) wa = Math.max(wa, smooth(0.35, -0.35, d.meer[i]));
        wa8[i] = wa * 255;
      }
      g = { land: d.land, zee: d.zee, maskers, sneeuwBasis: d.sneeuwBasis, licht: d.licht, meer: d.meer, hoogte8: d.hoogte8, steil8: d.steil8, alm8: d.alm8, heeftWater: d.heeftWater, wa8 };
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

  // Een grondcanvas terug in de pool, zolang die onder zijn grens blijft (maskers gaan nooit in de pool: die kunnen
  // door twee brokken van verschillende resolutie gedeeld worden).
  geefTerug(cv) {
    if (!cv) return;
    let bytes = cv.width * cv.height * 4;
    for (const c of this.pool) bytes += c.width * c.height * 4;
    if (bytes <= POOL_BYTES) this.pool.push(cv);
  }

  patroon(soort, R) {
    const k = `${soort}:${R}`;
    if (!this.patronen[k]) this.patronen[k] = this.tctx.createPattern(this.patroonBron[soort][R], 'repeat');
    return this.patronen[k];
  }

  // ---- bakken in stappen ----
  // Een brok bakt in zes stappen: grond (seizoenskleur plus detailpatronen), water (rivieren, zee en meren),
  // akkers en plassen, de rest van de grond, bomen, en politiek (tint en grenzen). Elke frame doet zoveel stappen als
  // in het werkbudget past (minstens één); pas als alles klaar is, vervangt het nieuwe canvas het oude in de cache.
  // Zo hapert een seizoenswissel niet: het oude seizoen blijft zichtbaar tot het nieuwe brok af is.

  begin(view, doel) {
    const s = view.state, geo = this.geo, { ck, cr, R } = doel;
    // maskers hangen alleen af van de bebouwing, niet van het seizoen of de resolutie: hergebruiken als het kan
    let maskers = null;
    for (const l of LODS) { const o = this.cache.get(`${l}:${ck}:${cr}`); if (o && o.zSig === doel.z) { maskers = o; break; } }
    const lijst = new Int32Array(36), kale = [];
    let n = 0, kosten = 0, bomen = 0;
    for (let r = cr * 4 - 1; r <= cr * 4 + 4; r++) {
      if (r < 0 || r >= geo.rij) continue;
      for (let kk = ck * 4 - 1; kk <= ck * 4 + 4; kk++) {
        if (kk < 0 || kk >= geo.kol) continue;
        const ti = r * geo.kol + kk, tg = geo.tegels[ti];
        if (tg.terrein === 'water') continue;
        // bebouwd: geen bomen, wel een kale, betreden plek waar het gebouw op staat
        if (s.bezet[ti]) { kale.push(tg.x, tg.y); continue; }
        lijst[n++] = ti;
        kosten += kostenVan(tg, this.basis);
        const f = kenmerkenVoorTegel(tg, this.basis);
        for (let p = 0; p < f.length; p += STAP) if (f[p] === BOOM || f[p] === LOSBOOM) bomen++;
      }
    }
    this.taak = { ...doel, stap: 0, grond: null, maskers, md: null, lijst, n, kale, kosten, bomen };
  }

  breekAf() {
    if (!this.taak) return;
    this.geefTerug(this.taak.grond);
    this.taak = null;
  }

  // Geschatte kosten (ms) van de volgende stap.
  stapKosten(tk) {
    const RF = (tk.R / 12) ** 2, g = this.basis.grond[tk.cr * this.kolC + tk.ck];
    switch (tk.stap) {
      case 0: return 0.3 + 1.1 * RF;
      case 1: return g && !g.heeftWater ? 0.1 + 0.3 * RF : 0.15 + 0.6 * RF + (tk.maskers ? 0 : 2.2);
      case 2: return 0.1 + (tk.kosten * 0.35) / 1500;
      case 3: return 0.1 + (tk.kosten * 0.35) / 1500;
      case 4: return 0.1 + tk.bomen / 2500 + (this.palVoor(this._dag).atlas?.klaar >= BOOM_TOTAAL ? 0 : 1.5);
      default: return 0.3 + 0.4 * RF + (this.politiek[tk.cr * this.kolC + tk.ck]?.sig === tk.polSig ? 0 : 1.5);
    }
  }

  // Werkt binnen het budget aan het brok in de maak; geeft het brok terug als het af is.
  werkAan(view) {
    const tk = this.taak;
    this._dag = view.state.dag;
    while (tk.stap < 6) {
      const kost = this.stapKosten(tk);
      if (this.werk > 0 && this.werk + kost > BAK_BUDGET) return null;
      this.werk += kost;
      this.bakStap(view, tk);
      tk.stap++;
    }
    const { R, ck, cr } = tk, S = CH * R, sleutel = `${R}:${ck}:${cr}`, oud = this.cache.get(sleutel);
    if (oud) { this.cache.delete(sleutel); this.bytes -= oud.bytes; this.geefTerug(oud.grond); }
    const m = tk.maskers;
    const bytes = S * S * 4 + (m?.waterMasker ? MN * MN * 4 : 0) + (m?.schuim1 ? 2 * MN * MN * 4 : 0) + (m?.meerMasker ? MN * MN * 4 : 0);
    const brok = { R, ck, cr, grond: tk.grond, waterMasker: m?.waterMasker ?? null, schuim1: m?.schuim1 ?? null, schuim2: m?.schuim2 ?? null, meerMasker: m?.meerMasker ?? null, sig: tk.sig, zSig: tk.z, bytes, gebruikt: this.frame };
    this.cache.set(sleutel, brok);
    this.bytes += bytes;
    this.aantalGebakken += 1;
    this.taak = null;
    this.ruimOp();
    return brok;
  }

  bakStap(view, tk) {
    const s = view.state, b = this.basis, { R, ck, cr } = tk, S = CH * R;
    const g = this.grondVan(ck, cr);
    const pal = this.palVoor(s.dag);
    const k = this.kctx, t = this.tctx;
    if (tk.stap === 0) {
      tk.grond = this.canvas(S, S);
      const gc = tk.grond.getContext('2d');
      gc.setTransform(1, 0, 0, 1, 0, 0);
      gc.globalAlpha = 1;
      gc.globalCompositeOperation = 'source-over';
      gc.imageSmoothingEnabled = true;
      gc.imageSmoothingQuality = 'high';
      // 1. kleurbeeld van het land in het seizoen van nu, vergroot met smoothing: zachte overgangen en reliëf
      const NN4 = N * N * 4;
      const sl = this._seizLand ?? (this._seizLand = new Uint8ClampedArray(NN4)), sz = this._seizZee ?? (this._seizZee = new Uint8ClampedArray(NN4));
      seizoensGrond(g, pal.sz, sl, sz);
      tk.zee = sz.slice(); // de waterstap heeft de zeekleur van dit seizoen nodig
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
      return;
    }
    const gc = tk.grond.getContext('2d');
    if (tk.stap === 1) {
      // 2b. rivieren, onder het zeewater: in een monding loopt de rivier zo zacht de zee in
      const stukken = b.water.perBrok[cr * this.kolC + ck];
      if (stukken.length) {
        gc.setTransform(R, 0, 0, R, -ck * CH * R, -cr * CH * R);
        tekenRivierLijf(gc, b.water, stukken, stukken.length, R, pal, true);
        gc.setTransform(1, 0, 0, 1, 0, 0);
      }
      // 3. water erover (zee en meren), met een fijn masker voor een strakke kustlijn; lege maskers bewaren we niet
      if (!tk.maskers) {
        const md = g.heeftWater ? bakMaskerData(b, ck, cr) : null;
        const maak = (data, nodig) => {
          if (!nodig) return null;
          const cv = fabriek(MN, MN);
          cv.getContext('2d').putImageData(maakBeeld(data, MN, MN), 0, 0);
          return cv;
        };
        tk.maskers = { waterMasker: maak(md?.water, md?.heeftWater), schuim1: maak(md?.schuim1, md?.heeftSchuim), schuim2: maak(md?.schuim2, md?.heeftSchuim), meerMasker: maak(md?.meer, md?.heeftMeer) };
      }
      if (tk.maskers.waterMasker) {
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.globalCompositeOperation = 'source-over';
        t.globalAlpha = 1;
        t.clearRect(0, 0, S, S);
        k.putImageData(maakBeeld(tk.zee, N, N), 0, 0);
        t.drawImage(this.klein, -MARGE * R, -MARGE * R, N * R, N * R);
        t.globalCompositeOperation = 'destination-in';
        t.drawImage(tk.maskers.waterMasker, -MARGE * R, -MARGE * R, N * R, N * R);
        t.globalCompositeOperation = 'source-over';
        gc.drawImage(this.tijdelijk, 0, 0, S, S, 0, 0, S, S);
      }
      tk.zee = null;
      return;
    }
    if (tk.stap <= 4) {
      // 4. kenmerken van de vakjes in en rond de brok, in wereldcoördinaten, in drie fasen
      gc.setTransform(R, 0, 0, R, -ck * CH * R, -cr * CH * R);
      if (tk.stap === 2 && tk.kale.length) {
        gc.fillStyle = 'rgba(112,100,70,0.22)';
        for (let q = 0; q < tk.kale.length; q += 2) gc.fillRect(tk.kale[q] - 7.2, tk.kale[q + 1] - 7.2, 14.4, 14.4);
      }
      const opt = this.optBak;
      opt.pal = pal;
      opt.fase = tk.stap - 1;
      if (tk.stap === 4) {
        if (!this.bouwAtlasStuk(pal, BOOM_TOTAAL)) bouwAtlas(this.atlasVan(pal), pal, BOOM_TOTAAL);
        opt.atlas = this.atlasVan(pal);
      }
      tekenLagen(gc, b, tk.lijst, tk.n, R, opt);
      opt.fase = 0; opt.atlas = null;
      gc.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    // 5. eigenaar: lichte tint in de blokkleur, sterker langs de grens; daarna de grenslijnen
    const pol = this.politiekVan(s, ck, cr, tk.polSig);
    this.tintBeeld(view, pol.raster);
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.drawImage(this.eigCanvas, (-RM / OR) * R, (-RM / OR) * R, (ON / OR) * R, (ON / OR) * R);
    gc.setTransform(R, 0, 0, R, -ck * CH * R, -cr * CH * R);
    tekenGrenzen(gc, pol.ketens, R, (o) => this.blokKleur(view, o), (a, c) => this.zelfdeBlok(view, a, c));
    gc.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Bakt een brok in één keer (voor tests en gereedschap); het gewone pad is begin() plus werkAan() over frames.
  bak(view, ck, cr, R, sig, polSig) {
    this.breekAf();
    this.brokSig(view.state, ck, cr);
    this.begin(view, { ck, cr, R, sig, polSig, z: this._z });
    const werk = this.werk;
    this.werk = 0;
    let br = null;
    while (!br) { this.werk = 0; br = this.werkAan(view); }
    this.werk = werk;
    return br;
  }

  // LRU: het langst niet getekende brok eerst weg, maar nooit iets dat deze frame getekend is. Ruimt op tot onder
  // het doel, zodat pool, werkbrok en atlassen er samen ruim onder de harde grens bij passen.
  ruimOp() {
    while (this.cache.size > MAX_CANVASSEN || this.bytes > DOEL_BYTES) {
      let sleutel = null, br = null;
      for (const [k, b] of this.cache) if (b.gebruikt !== this.frame && (!br || b.gebruikt < br.gebruikt)) { sleutel = k; br = b; }
      if (!br) break;
      this.cache.delete(sleutel);
      this.bytes -= br.bytes;
      this.geefTerug(br.grond);
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

  // ---- gebakken of nog niet (C12) ----

  // Welk deel (0..1) van de brokken in het wereldvak is in de laatste frame echt gebakken (en actueel) getekend?
  // Heeft deze laag in de laatste frame niets getekend (te ver uitgezoomd, of nog nooit), dan geldt alles als gebakken.
  gebakkenDeel(x0, y0, x1, y1) {
    if (!this.basis || !this.klaar || this.klaarFrame !== this.frame || !this._kader) return 1;
    const [k0, k1, r0, r1] = this._kader;
    const a0 = Math.max(k0, Math.floor(x0 / CH)), a1 = Math.min(k1, Math.floor(x1 / CH));
    const b0 = Math.max(r0, Math.floor(y0 / CH)), b1 = Math.min(r1, Math.floor(y1 / CH));
    let n = 0, ja = 0;
    for (let cr = b0; cr <= b1; cr++) for (let ck = a0; ck <= a1; ck++) { n++; ja += this.klaar[cr * this.kolC + ck] === 2 ? 1 : 0; }
    return n ? ja / n : 1;
  }
  // Natuur, werk, kust en zee tekenen alleen op gebakken grond: deze knipt het canvas tot de brokken die dit beeld
  // echt gebakken getekend zijn. 0: niets gebakken (niet tekenen); 1: alles (of terrein tekende niet), geen knip;
  // 2: geknipt na c.save(), de aanroeper doet c.restore().
  klemOpGebakken(c) {
    if (!this.basis || !this.klaar || this.klaarFrame !== this.frame || !this._kader || !this._naar || typeof c.clip !== 'function') return 1;
    const [k0, k1, r0, r1] = this._kader, { cx, cy, sc, w, h, dpr } = this._naar;
    let n = 0, ja = 0;
    for (let cr = r0; cr <= r1; cr++) for (let ck = k0; ck <= k1; ck++) { n++; ja += this.klaar[cr * this.kolC + ck] ? 1 : 0; }
    if (ja === n) return 1;
    if (!ja) return 0;
    const nx = (x) => Math.round(((x - cx) * sc + w / 2) * dpr) / dpr, ny = (y) => Math.round(((y - cy) * sc + h / 2) * dpr) / dpr;
    c.save();
    c.beginPath();
    for (let cr = r0; cr <= r1; cr++) for (let ck = k0; ck <= k1; ck++) {
      if (!this.klaar[cr * this.kolC + ck]) continue;
      const x = nx(ck * CH), y = ny(cr * CH);
      c.rect(x, y, nx(ck * CH + CH) - x, ny(cr * CH + CH) - y);
    }
    c.clip();
    return 2;
  }
  // Is het hele wereldvak gebakken? (natuur, werk, kust en zee tekenen pas op gebakken grond; de kijkhulp wacht erop)
  gebakken(x0, y0, x1, y1) { return this.gebakkenDeel(x0, y0, x1, y1) >= 1; }

  // Terugvalversie van een brok: de seizoenskleur van land en water op 1 pixel per eenheid, vergroot met smoothing.
  // Grof, maar het reliëf, de kust, bos en sneeuw staan erin; nooit een vlakke kleur. null als er geen tijd voor is.
  grofVan(view, ck, cr, mag) {
    const ci = cr * this.kolC + ck, stap = seizoensStap(view.state.dag);
    let e = this.grof.get(ci);
    if (e && e.stap === stap) return e.cv;
    if (!mag) return e ? e.cv : null; // het vorige seizoen is beter dan niets
    const g = this.grondVan(ck, cr);
    const NN4 = N * N * 4;
    const sl = this._grofL ?? (this._grofL = new Uint8ClampedArray(NN4)), sz = this._grofZ ?? (this._grofZ = new Uint8ClampedArray(NN4));
    seizoensGrond(g, this.palVoor(view.state.dag).sz, sl, sz);
    const wa = g.wa8;
    for (let i = 0; i < N * N; i++) {
      const a = wa[i] / 255, p = i * 4;
      if (a <= 0) continue;
      sl[p] += (sz[p] - sl[p]) * a; sl[p + 1] += (sz[p + 1] - sl[p + 1]) * a; sl[p + 2] += (sz[p + 2] - sl[p + 2]) * a;
    }
    // zacht maken (2x een 3x3-vak): vergroot gaf 1 pixel per eenheid anders trapjes langs sneeuw en kust
    const bl = this._grofB ?? (this._grofB = new Uint8ClampedArray(NN4));
    for (let ronde = 0; ronde < 2; ronde++) {
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          let r = 0, gg = 0, bb = 0, n = 0;
          for (let dj = -1; dj <= 1; dj++) {
            const jj = j + dj;
            if (jj < 0 || jj >= N) continue;
            for (let di = -1; di <= 1; di++) {
              const ii = i + di;
              if (ii < 0 || ii >= N) continue;
              const q = (jj * N + ii) * 4;
              r += sl[q]; gg += sl[q + 1]; bb += sl[q + 2]; n++;
            }
          }
          const p = (j * N + i) * 4;
          bl[p] = r / n; bl[p + 1] = gg / n; bl[p + 2] = bb / n; bl[p + 3] = 255;
        }
      }
      sl.set(bl);
    }
    const cv = e?.cv ?? fabriek(N, N);
    cv.getContext('2d').putImageData(maakBeeld(sl, N, N), 0, 0);
    if (!e) { e = { stap, cv }; this.grof.set(ci, e); this.grofBytes += N * N * 4; }
    e.stap = stap;
    return cv;
  }

  // ---- elke frame ----

  teken(c, view, sc, nu) {
    if (!this.basis || view.geo !== this.geo) return;
    this.frame += 1;
    zetNet(this.basis, view.wegennet);
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
    while (R > 3 && zichtbaar * (CH * R * CH * R * 4 + 3 * MN * MN * 4) > DOEL_BYTES) R /= 2;
    const glob = this.globaleSig(s);
    const stap = seizoensStap(s.dag);
    const mx = (wx0 + wx1) / 2, my = (wy0 + wy1) / 2;
    let beste = null, bd = Infinity;
    const getekend = this._getekend ?? (this._getekend = []);
    getekend.length = 0;
    const ontbreekt = this._ontbreekt ?? (this._ontbreekt = []);
    ontbreekt.length = 0;
    this._kader = [k0, k1, r0, r1];
    this.werk = 0;
    const tk = this.taak;
    let taakGeldig = false;
    for (let cr = r0; cr <= r1; cr++) {
      for (let ck = k0; ck <= k1; ck++) {
        this.brokSig(s, ck, cr);
        const polSig = `${glob}${this._e}`;
        const sig = `${polSig}|${this._z}|${stap}`;
        let br = this.cache.get(`${R}:${ck}:${cr}`);
        if (tk && tk.ck === ck && tk.cr === cr && tk.sig === sig) taakGeldig = true;
        if (!br || br.sig !== sig) {
          const d = (ck * CH + CH / 2 - mx) ** 2 + (cr * CH + CH / 2 - my) ** 2;
          if (d < bd) { bd = d; beste = { ck, cr, R, sig, polSig, z: this._z }; }
        }
        // ontbreekt hij nog, dan dezelfde brok op een andere resolutie; anders schijnt de kaart eronder door
        if (!br) for (const l of LODS) { br = this.cache.get(`${l}:${ck}:${cr}`); if (br) break; }
        if (br) { br.gebruikt = this.frame; getekend.push(br); } else ontbreekt.push(ck, cr);
        // 2 actueel gebakken; 1 echte grond van een vorig seizoen, oude wegen of een andere resolutie (daarop mogen
        // natuur, werk, kust en zee gewoon doortekenen, anders verdwijnt alles om de 12 dagen); 0 alleen de terugval
        this.klaar[cr * this.kolC + ck] = !br ? 0 : br.R === R && br.sig === sig ? 2 : 1;
      }
    }
    // De boomatlas van dit seizoen groeit in stukjes mee; bakken gebeurt in stappen binnen een werkbudget per frame.
    // Een brok in de maak dat niet meer klopt (ander seizoen, nieuw gebouw) of buiten beeld ligt terwijl er in beeld
    // werk is, gaat weg. Een brok dat nog nooit gebakken is, krijgt eerst een frame voor zijn grondgegevens.
    const pal = this.palVoor(s.dag);
    if (!pal.atlas || pal.atlas.klaar < BOOM_TOTAAL) this.bouwAtlasStuk(pal, 12);
    if (tk && !taakGeldig) {
      const buiten = tk.ck < k0 || tk.ck > k1 || tk.cr < r0 || tk.cr > r1;
      if (!buiten || beste) this.breekAf();
      else {
        this.brokSig(s, tk.ck, tk.cr);
        if (tk.sig !== `${glob}${this._e}|${this._z}|${stap}`) this.breekAf();
      }
    }
    if (!this.taak) {
      if (beste) {
        if (!this.basis.grond[beste.cr * this.kolC + beste.ck]) { this.grondVan(beste.ck, beste.cr); this.werk += 2.5; }
        else this.begin(view, beste);
      } else this.voorbak(view, k0, k1, r0, r1, R, glob, mx, my);
    }
    if (this.taak && this.werk < BAK_BUDGET) {
      const br = this.werkAan(view);
      if (br) {
        getekend.push(br);
        if (br.sig && br.ck >= k0 && br.ck <= k1 && br.cr >= r0 && br.cr <= r1) {
          this.klaar[br.cr * this.kolC + br.ck] = br.R === R ? 2 : Math.max(1, this.klaar[br.cr * this.kolC + br.ck]);
          for (let q = 0; q < ontbreekt.length; q += 2) if (ontbreekt[q] === br.ck && ontbreekt[q + 1] === br.cr) { ontbreekt.splice(q, 2); break; }
        }
      }
    }
    this.klaarFrame = this.frame;
    this._naar = { cx: view.cx, cy: view.cy, sc, w: view.w, h: view.h, dpr };
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
    // nog nooit gebakken: de grove terugvalversie (hooguit GROF_PER_FRAME nieuwe per frame; de grondgegevens zijn
    // daarna ook klaar voor het echte bakken)
    let budget = GROF_PER_FRAME;
    for (let q = 0; q < ontbreekt.length; q += 2) {
      const ck = ontbreekt[q], cr = ontbreekt[q + 1], ci = cr * this.kolC + ck;
      const vers = this.grof.get(ci)?.stap !== stap, duur = !this.basis.grond[ci];
      const cv = this.grofVan(view, ck, cr, budget > 0);
      if (vers && budget > 0) budget -= duur ? 3 : 1;
      if (!cv) continue;
      const x = naarX(ck * CH), y = naarY(cr * CH);
      c.drawImage(cv, MARGE, MARGE, CH, CH, x, y, naarX(ck * CH + CH) - x, naarY(cr * CH + CH) - y);
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
    if (this.cache.size >= MAX_CANVASSEN || this.bytes + bytes > DOEL_BYTES) return;
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
        if (d < bd) { bd = d; beste = { ck, cr, R, sig, polSig, z: this._z }; }
      }
    }
    if (!beste) return;
    if (!this.basis.grond[beste.cr * this.kolC + beste.ck]) { this.grondVan(beste.ck, beste.cr); this.werk += 2.5; }
    else this.begin(view, beste);
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
    let nat = 0;
    for (const br of getekend) {
      if (!br.waterMasker) continue; // droog brok: geen masker bewaard
      nat++;
      const x = naarX(br.ck * CH), y = naarY(br.cr * CH);
      mc.drawImage(br.waterMasker, MARGE * M, MARGE * M, CH * M, CH * M, x * dpr, y * dpr, (naarX(br.ck * CH + CH) - x) * dpr, (naarY(br.cr * CH + CH) - y) * dpr);
    }
    if (!nat) return;
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
    // C12: geen golfjes op een bevroren meer (dezelfde ijswaarde als de grond: het palet van de seizoensstap)
    const ijs = this.palVoor(view.state.dag).ijs;
    if (ijs > 0.02) {
      kc.globalCompositeOperation = 'destination-out';
      kc.globalAlpha = Math.min(1, ijs * 1.15);
      for (const br of getekend) {
        if (!br.meerMasker) continue;
        const x = naarX(br.ck * CH), y = naarY(br.cr * CH);
        kc.drawImage(br.meerMasker, MARGE * M, MARGE * M, CH * M, CH * M, x * dpr, y * dpr, (naarX(br.ck * CH + CH) - x) * dpr, (naarY(br.cr * CH + CH) - y) * dpr);
      }
    }
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
      if (!br.schuim1) continue;
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
    this.laatsteBanden = this.laatsteMicro = this.laatsteFijn = 0;
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
    opt.zwaai = nu; opt.pal = pal; opt.wind = wnd; opt.atlas = this.scherpeAtlas(pal);
    // C. windvlagen over het gewas en E. kleine dingen vanaf zoom 9,5: tekenLagen roept ze op hun plek in de
    // laagvolgorde aan (op de velden en bij de plassen), niet erbovenop
    const aW = smooth(7.5, 8.5, zoom) * alfa, aM = smooth(9.5, 10.5, zoom), aF = smooth(11, 12, zoom);
    this._fk = sc; this._fz = zoom;
    opt.naVelden = aW > 0 ? () => {
      const ga = c.globalAlpha;
      c.globalAlpha = aW;
      this.laatsteBanden = tekenWindBanden(c, b, opt.emmers, pal, wnd, nu);
      c.globalAlpha = ga;
    } : null;
    opt.naPlassen = aM > 0 ? () => {
      const ga = c.globalAlpha;
      c.globalAlpha = aM;
      this.laatsteMicro = this.tekenMicro(c, b, lijst, n, pal, seizoensStap(s.dag), zoom >= 11.5);
      // F. de fijne laag vanaf zoom 11: gras, wilde bloemen, heide, keien, sloten met riet en knotwilgen, sporen
      if (aF > 0) { c.globalAlpha = aF; this.laatsteFijn = this.tekenFijn(c, b, lijst, n, pal, seizoensStap(s.dag), nu, wnd, wx0, wy0, wx1, wy1); }
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
      // geen kringen onder een gebouw (het meer loopt daar door, maar de kavel ligt erover)
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
  tekenMicro(c, b, lijst, n, pal, stap, diep) {
    const tegels = b.geo.tegels;
    const em = this._microEmmers ?? (this._microEmmers = MICRO_NAMEN.map(() => []));
    for (let k = 0; k < em.length; k++) em[k].length = 0;
    let tel = 0;
    for (let q = 0; q < n && tel < MAX_MICRO; q++) {
      const m = this.microVan(tegels[lijst[q]], b, pal, stap);
      for (let i = 0; i < m.length && tel < MAX_MICRO; i += 4) {
        if (MICRO_DIEP[m[i]] && !diep) continue;
        em[m[i]].push(m[i + 1], m[i + 2], m[i + 3]); tel++;
      }
    }
    for (let k = 0; k < em.length; k++) {
      const l = em[k];
      if (!l.length) continue;
      c.beginPath();
      if (MICRO_STREEP[k]) {
        const tak = MICRO_NAMEN[k] === 'tak';
        for (let i = 0; i < l.length; i += 3) {
          const x = l[i], y = l[i + 1], r = l[i + 2];
          if (tak) { c.moveTo(x - r, y - r * 0.35); c.lineTo(x + r, y + r * 0.35); c.moveTo(x + r * 0.2, y + r * 0.07); c.lineTo(x + r * 0.5, y - r * 0.3); }
          else for (let q = 0; q < 5; q++) { const a = q * 1.2566 + x * 3.1; c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + 0.3) * r * 0.6, y + Math.sin(a + 0.3) * r * 0.6, x + Math.cos(a) * r, y + Math.sin(a) * r); }
        }
        c.strokeStyle = MICRO_KLEUR[MICRO_NAMEN[k]];
        c.lineWidth = tak ? 0.05 : 0.04;
        c.stroke();
      } else {
        for (let i = 0; i < l.length; i += 3) { c.moveTo(l[i] + l[i + 2], l[i + 1]); c.arc(l[i], l[i + 1], l[i + 2], 0, Math.PI * 2); }
        c.fillStyle = MICRO_KLEUR[MICRO_NAMEN[k]];
        c.fill();
      }
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
    const vlak = vlakkenBij(t, b);
    const vrij = (x, y) => vrijVanVlak(b, vlak, x, y);
    const bloemen = Math.round(16 * Math.min(1, pal.bloemen)), herfst = pal.herfst, groen = 1 - pal.kaal;
    if (t.terrein === 'bos') {
      // bosgrond: paddenstoelen en blad in de herfst, varens, en vanaf zoom 11,5 mos en takjes
      const sneeuwt = pal.sneeuwVeld > 0.25;
      for (let i = 0; i < 18; i++) {
        const x = t.x + (r() - 0.5) * T, y = t.y + (r() - 0.5) * T, kies = r(), k2 = r();
        if (!vrij(x, y)) continue;
        if (i < 4 && kies < herfst * 1.4) {
          zet('steel', x + 0.035, y + 0.045, 0.05);
          if (k2 < 0.6) { zet('paddo', x, y, 0.1); zet('stip', x - 0.03, y - 0.03, 0.03); } else zet('paddoBruin', x, y, 0.09 + k2 * 0.03);
        } else if (i < 10 && kies < herfst) zet(kies < herfst / 2 ? 'blad1' : 'blad2', x, y, 0.07);
        else if (i < 10 && kies < herfst + 0.5 * groen && !sneeuwt) zet('varen', x, y, 0.22 + k2 * 0.12);
        else if (i >= 10 && i < 14 && !sneeuwt) zet('mos', x, y, 0.14 + k2 * 0.14);
        else if (i >= 14) zet('tak', x, y, 0.18 + k2 * 0.16);
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
        if (soort === WEI && hash(t.i, p, 825) < 0.4) continue; // daar zet de fijne laag een rijtje molshopen (fijnVan)
        const h = hoekVan(t, f, p), co = Math.cos(h), si = Math.sin(h), hu = f[p + 3], hv = f[p + 5];
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

  // De fijne dingen van één vakje als [soort, x, y, r, hoek, zaad, ...] in wereldcoördinaten (zie FIJN_NAMEN).
  // Alleen afhankelijk van het vakje en de seizoensstap; per stap één keer uitgerekend, net als microVan.
  fijnVan(t, b, pal, stap) {
    const fc = this._fijn ?? (this._fijn = { stap: -1, per: [] });
    if (fc.stap !== stap) { fc.stap = stap; fc.per = []; }
    if (fc.per[t.i]) return fc.per[t.i];
    const uit = [];
    if (t.terrein === 'water' || b.stad[t.i]) return (fc.per[t.i] = new Float32Array(0));
    const geo = b.geo, T = geo.T, r = rnd(t.i * 5303 + 17), f = kenmerkenVoorTegel(t, b);
    const zet = (s, x, y, rr, a = 0, z = 0) => { uit.push(s, x, y, rr, a, z); };
    const vlak = vlakkenBij(t, b), vrij = (x, y) => vrijVanVlak(b, vlak, x, y);
    const droog = (x, y) => sdOp(b, x, y) < -0.7 && zoetOp(b, x, y) > 0.3;
    const rp = () => (r() - 0.5) * T;
    const d = pal.sz.dagInJaar, wit = pal.A > 0.3, moeras = b.moeras[t.i], duin = b.duin[t.i];
    const open = (t.terrein === 'vlakte' || t.terrein === 'kust') && !b.akker[t.i];
    const bloei = BLOEI.filter(([, a, e]) => d >= a && d <= e).map(([s]) => s);
    const bloem = (zaad) => bloei[Math.floor(zaad * bloei.length)];
    if (open) {
      // polletjes en sprieten, losse bloemen, een plek vol bloemen (met de bijen van natuur.js)
      if (!wit) for (let i = 0; i < (moeras ? 8 : 14); i++) { const x = t.x + rp(), y = t.y + rp(); if (vrij(x, y)) zet(F_POL, x, y, 0.2 + r() * 0.2, 0, r()); }
      if (!wit && !moeras && !duin && bloei.length) {
        for (let i = 0; i < 10; i++) {
          const x = t.x + rp(), y = t.y + rp(), k = bloem(r());
          if ((k === F_KLAP || k === F_KOREN) && r() < 0.6) continue; // die staan vooral langs het graan
          if (vrij(x, y)) zet(k, x, y, 0.055 + r() * 0.025, 0, r());
        }
        const bp = bloemenPlek(t, b);
        if (bp) for (let i = 0; i < 18; i++) {
          const a = r() * TAU_T, dd = Math.sqrt(r()) * bp.r, x = bp.x + Math.cos(a) * dd, y = bp.y + Math.sin(a) * dd * 0.8;
          if (vrij(x, y)) zet(bloem(r()), x, y, 0.06 + r() * 0.025, 0, r());
        }
      }
      if (heideOp(b, t)) {
        for (let i = 0; i < 14; i++) {
          const x = t.x + rp(), y = t.y + rp();
          if (vrij(x, y) && sdOp(b, x, y) < -3.5 && this.boomvrij(x, y, 0.3)) zet(F_HEIDE, x, y, 0.28 + r() * 0.24, r() * Math.PI, r());
        }
      }
      // keien, en aan de bosrand een mierenhoop en bramen
      if (hash(t.i, 811) < 0.3) {
        for (let i = 0, n = hash(t.i, 812) < 0.4 ? 2 : 1; i < n; i++) {
          const x = t.x + rp() * 0.85, y = t.y + rp() * 0.85, rr = 0.16 + r() * 0.22;
          if (vrij(x, y) && this.boomvrij(x, y, rr + 0.1)) zet(F_KEI, x, y, rr, r() * Math.PI, r());
        }
      }
      if (!moeras) {
        let mier = hash(t.i, 813) < 0.55 ? 1 : 0, braam = 3;
        for (let i = 0; i < 14 && (mier || braam); i++) {
          const x = t.x + rp(), y = t.y + rp(), wB = gewichtenOp(b, x, y, FIJN_G)[BOS];
          if (wB < 0.15 || wB > 0.55 || !vrij(x, y)) continue;
          if (mier && wB < 0.45 && this.boomvrij(x, y, 0.5)) { zet(F_MIER, x, y, 0.3 + r() * 0.12, 0, r()); mier = 0; }
          else if (braam && wB > 0.2 && this.boomvrij(x, y, 0.15)) { zet(F_BRAAM, x, y, 0.34 + r() * 0.2, r() * TAU_T, r()); braam--; }
        }
      }
      if (!moeras && !wit && hash(t.i, 814) < 0.35) this.molRij(t, r, zet, vrij, 0, 0, T * 0.35);
      // heksenkring: paddenstoelen in een ring in het najaarsgras
      if (!wit && d >= 255 && d <= 320 && hash(t.i, 815) < 0.2) {
        const x = t.x + rp() * 0.7, y = t.y + rp() * 0.7, R = 0.7 + r() * 0.4;
        if (vrij(x, y) && vrij(x + R, y) && vrij(x - R, y) && vrij(x, y + R) && vrij(x, y - R) && this.boomvrij(x, y, R + 0.15)) zet(F_HEKS, x, y, R, r() * TAU_T, r());
      }
      // gevallen blad rond de stam van een losse boom, laat in de herfst
      if (d >= 285 && d <= 345 && !wit) for (let p = 0; p < f.length; p += STAP) if (f[p] === LOSBOOM) zet(F_BLAD, t.x + f[p + 1] + f[p + 3] * 0.25, t.y + f[p + 2] + f[p + 3] * 0.3, f[p + 3] * 1.25, r() * Math.PI, r());
    }
    if (t.terrein === 'bos') {
      if (!wit && d >= 268 && d <= 340) for (let i = 0; i < 8; i++) { const x = t.x + rp(), y = t.y + rp(); if (droog(x, y)) zet(F_BLAD, x, y, 0.6 + r() * 0.7, r() * Math.PI, r()); }
      for (let p = 0; p < f.length; p += STAP) {
        if (f[p] === STAM && !wit && d >= 250 && d <= 325) {
          // zwammen in een rijtje langs de vermolmde stam
          const co = Math.cos(f[p + 4]), si = Math.sin(f[p + 4]), l = f[p + 3], n = 3 + Math.floor(r() * 3);
          for (let k = 0; k < n; k++) {
            const u = (r() - 0.5) * l * 0.8, zij = (r() < 0.5 ? -1 : 1) * (0.16 + r() * 0.08);
            zet(F_PADDO, t.x + f[p + 1] + co * u - si * zij, t.y + f[p + 2] + si * u + co * zij, 0.06 + r() * 0.04, 0, r());
          }
        } else if (f[p] === OPENPLEK && hash(t.i, p, 816) < 0.45) {
          const a = r() * TAU_T, x = t.x + f[p + 1] + Math.cos(a) * f[p + 3] * 0.75, y = t.y + f[p + 2] + Math.sin(a) * f[p + 3] * 0.6;
          if (!droog(x, y)) continue;
          if (r() < 0.45) { if (!wit && this.boomvrij(x, y, 0.5)) zet(F_MIER, x, y, 0.3 + r() * 0.12, 0, r()); }
          else if (this.boomvrij(x, y, 0.15)) zet(F_BRAAM, x, y, 0.32 + r() * 0.2, r() * TAU_T, r());
        }
      }
    }
    // percelen: riet en knotwilgen langs de sloten, klaprozen en korenbloemen in de rand van het graan, en in de wei
    // gras, bloemen en molshopen
    for (let p = 0; p < f.length; p += STAP) {
      if (f[p] !== PERCEEL) continue;
      const soort = f[p + 4] & 15, rand = (f[p + 4] >> 5) & 7, h = hoekVan(t, f, p), co = Math.cos(h), si = Math.sin(h);
      const px = t.x + f[p + 1], py = t.y + f[p + 2], hu = f[p + 3], hv = f[p + 5];
      const op = (u, v, fn) => fn(px + u * co - v * si, py + u * si + v * co);
      if (rand === SLOOT) {
        for (let e = 0; e < 4; e++) {
          const langs = e < 2, L = langs ? 2 * hu + 0.2 : 2 * hv + 0.2, kant = e % 2 ? 1 : -1;
          for (let s = 0.5, k = 0; s < L - 0.5; s += 0.7, k++) {
            if (hash(t.i, p * 97 + e * 31 + k, 822) > 0.55) continue;
            const zij = (hash(t.i, p * 97 + e * 31 + k, 823) - 0.5) * 0.28;
            const u = langs ? -hu - 0.1 + s : kant * (hu + 0.1) + zij, v = langs ? kant * (hv + 0.1) + zij : -hv - 0.1 + s;
            op(u, v, (x, y) => { if (droog(x, y)) zet(F_RIET, x, y, 0.24 + r() * 0.14, 0, r()); });
          }
        }
        // knotwilgen: altijd aan de +v-kant, zodat twee buurpercelen niet allebei een rij op dezelfde sloot zetten
        if (hash(t.i, p, 824) < 0.5) {
          for (let s = 1.2; s < 2 * hu - 0.8; s += 2.8) {
            op(-hu + s, hv + 0.1, (x, y) => { if (droog(x, y) && this.boomvrij(x, y, 0.35)) zet(F_KNOT, x, y, 0.48 + r() * 0.12, r() * TAU_T, r()); });
          }
        }
      }
      if (wit) continue;
      if (soort === GRAAN) {
        for (let i = 0; i < 12; i++) {
          const k = d >= 150 && d <= 210 && r() < 0.65 ? F_KLAP : d >= 160 && d <= 215 ? F_KOREN : -1;
          const langs = r() < 0.7, zij = (r() < 0.5 ? -1 : 1), w = 0.15 + r() * 0.3;
          const u = langs ? (r() - 0.5) * 2 * (hu - 0.2) : zij * (hu - w), v = langs ? zij * (hv - w) : (r() - 0.5) * 2 * (hv - 0.2);
          if (k >= 0) op(u, v, (x, y) => { if (droog(x, y)) zet(k, x, y, 0.06 + r() * 0.025, 0, r()); });
        }
      } else if (soort === WEI) {
        for (let i = 0; i < 8; i++) {
          const u = (r() - 0.5) * 2 * (hu - 0.3), v = (r() - 0.5) * 2 * (hv - 0.3), k = i < 5 ? F_POL : bloei.length ? bloem(r()) : -1;
          if (k === F_KLAP || k === F_KOREN || k < 0) continue;
          op(u, v, (x, y) => { if (droog(x, y)) zet(k, x, y, k === F_POL ? 0.2 + r() * 0.15 : 0.055 + r() * 0.025, 0, r()); });
        }
        if (hash(t.i, p, 825) < 0.4) this.molRij(t, r, zet, droog, px - t.x, py - t.y, Math.min(hu, hv) - 0.6);
      }
    }
    // sporen in de sneeuw: van een wandelaar, een haas, een vogel of een vos, dwars over het veld
    if (pal.A > 0.22 && t.terrein !== 'bos' && t.terrein !== 'berg') {
      const n = (hash(t.i, 831) < 0.6 ? 1 : 0) + (hash(t.i, 832) < 0.3 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const a = hash(t.i, k, 833) * TAU_T, L = 5 + hash(t.i, k, 834) * 6;
        const x0 = t.x + (hash(t.i, k, 835) - 0.5) * T * 0.6 - Math.cos(a) * L / 2, y0 = t.y + (hash(t.i, k, 836) - 0.5) * T * 0.6 - Math.sin(a) * L / 2;
        let ok = true;
        for (let q = 0; q <= 6 && ok; q++) {
          const x = x0 + Math.cos(a) * L * q / 6, y = y0 + Math.sin(a) * L * q / 6;
          ok = droog(x, y) && x > 0 && y > 0 && x < W && y < H && !b.stad[Math.floor(y / T) * geo.kol + Math.floor(x / T)];
        }
        const h = hash(t.i, k, 837), soort = h < 0.45 ? 0 : h < 0.75 ? 1 : h < 0.88 ? 2 : 3;
        if (ok) zet(F_SPOOR, x0, y0, L, a, soort + 0.1 + 0.8 * hash(t.i, k, 838));
      }
    }
    return (fc.per[t.i] = Float32Array.from(uit));
  }

  // Een rijtje van 3 tot 6 verse molshopen rond (t.x + dx, t.y + dy), binnen straal `ruimte`.
  molRij(t, r, zet, vrij, dx, dy, ruimte) {
    if (ruimte < 0.5) return;
    const x0 = t.x + dx + (r() - 0.5) * 2 * ruimte, y0 = t.y + dy + (r() - 0.5) * 2 * ruimte, a = r() * TAU_T, n = 3 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const s = (k - n / 2) * 0.62, w = Math.sin(k * 1.7 + a * 3) * 0.25;
      const x = x0 + Math.cos(a) * s - Math.sin(a) * w, y = y0 + Math.sin(a) * s + Math.cos(a) * w;
      if (vrij(x, y) && this.boomvrij(x, y, 0.15)) zet(F_MOL, x, y, 0.12 + r() * 0.05, 0, r());
    }
  }

  // Tekent de fijne dingen van de vakjes in `lijst` (dichtstbijzijnde eerst) die het beeld raken, tot MAX_FIJN.
  // Licht uit het noordwesten: schaduwen naar het zuidoosten, de lichte kant linksboven. Gras, riet en de
  // twijgen van de knotwilgen buigen mee met de wind. Geeft het aantal getekende dingen terug.
  tekenFijn(c, b, lijst, n, pal, stap, nu, wnd, wx0, wy0, wx1, wy1) {
    const tegels = b.geo.tegels, half = b.geo.T / 2;
    const em = this._fijnEmmers ?? (this._fijnEmmers = Array.from({ length: F_SOORTEN }, () => []));
    for (let k = 0; k < F_SOORTEN; k++) em[k].length = 0;
    let tel = 0, vol = false;
    for (let q = 0; q < n && !vol; q++) {
      const t = tegels[lijst[q]];
      if (t.x + half + 2 < wx0 || t.x - half - 2 > wx1 || t.y + half + 2 < wy0 || t.y - half - 2 > wy1) continue;
      const m = this.fijnVan(t, b, pal, stap);
      for (let i = 0; i < m.length; i += FS) {
        const s = m[i];
        // een spoor kost zoveel als het afdrukken heeft (een haas vier per sprong), een heksenkring twaalf
        const kost = s === F_SPOOR ? Math.ceil(m[i + 3] / SPOOR_STAP[Math.floor(m[i + 5])]) * (Math.floor(m[i + 5]) === 1 ? 4 : 1) : s === F_HEKS ? 12 : 1;
        if (tel + kost > MAX_FIJN) { vol = true; break; }
        em[s].push(m[i + 1], m[i + 2], m[i + 3], m[i + 4], m[i + 5]);
        tel += kost;
      }
    }
    if (!tel) return 0;
    const t = nu / 1000, wx = Math.cos(wnd.hoek), wy = Math.sin(wnd.hoek), kr = wnd.kracht, sz = pal.sz, d = sz.dagInJaar;
    const golf = (x, y, z) => 0.6 + 0.4 * Math.sin(t * 2.3 - (x * wx + y * wy) * 0.55 + z * 2);
    const rond = (x, y, r) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU_T); };
    const ovaal = (x, y, rx, ry, h) => { c.moveTo(x + rx * Math.cos(h), y + rx * Math.sin(h)); c.ellipse(x, y, rx, ry, h, 0, TAU_T); };
    const vul = (kleur) => { c.fillStyle = kleur; c.fill(); };
    const trek = (kleur, br) => { c.strokeStyle = kleur; c.lineWidth = br; c.stroke(); };
    // fn(x, y, r, hoek, zaad) voor elk ding van een soort, in één pad
    const elk = (s, fn) => { const l = em[s]; c.beginPath(); for (let i = 0; i < l.length; i += 5) fn(l[i], l[i + 1], l[i + 2], l[i + 3], l[i + 4]); return l.length > 0; };
    const schaduw = 'rgba(20,18,12,0.3)';
    // 1. gevallen blad: een warm tapijt in vlekken
    for (let k = 0; k < 3; k++) {
      if (elk(F_BLAD, (x, y, r, h, z) => { if (Math.floor(z * 3) === k) ovaal(x, y, r, r * 0.62, h); })) vul(['rgba(196,118,40,0.5)', 'rgba(164,84,40,0.45)', 'rgba(214,162,58,0.5)'][k]);
    }
    if (em[F_BLAD].length && elk(F_BLAD, (x, y, r, h, z) => { for (let q = 0; q < 4; q++) { const a = z * 40 + q * 1.9; rond(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.4, 0.06); } })) vul('#b8542a');
    // 2. heide: lage struikjes, paars in de bloei (eind juli tot half september), verder bruingroen
    if (em[F_HEIDE].length) {
      const paars = smooth(200, 215, d) * (1 - smooth(255, 270, d));
      elk(F_HEIDE, (x, y, r, h) => ovaal(x + r * 0.25, y + r * 0.3, r, r * 0.7, h)); vul(schaduw);
      elk(F_HEIDE, (x, y, r, h) => ovaal(x, y, r, r * 0.7, h)); vul('#56563a');
      elk(F_HEIDE, (x, y, r, h) => ovaal(x - r * 0.12, y - r * 0.12, r * 0.75, r * 0.5, h)); vul(css(mengH('#6e6448', '#a8549e', paars)));
      if (paars > 0.2) { elk(F_HEIDE, (x, y, r, h, z) => { for (let q = 0; q < 3; q++) rond(x - r * 0.3 + q * r * 0.25, y - r * 0.25 + Math.sin(z * 9 + q) * r * 0.15, r * 0.12); }); vul(css(hex('#d49ad0'), paars)); }
    }
    // 3. sporen in de sneeuw: een meanderend lijntje afdrukken
    if (em[F_SPOOR].length) {
      elk(F_SPOOR, (x0, y0, L, a, z) => {
        const soort = Math.floor(z), zaad = z - soort, st = SPOOR_STAP[soort], co = Math.cos(a), si = Math.sin(a);
        for (let s = 0.2, k = 0; s < L; s += st, k++) {
          const m = Math.sin(s * 0.7 + zaad * 9) * 0.4, x = x0 + co * s - si * m, y = y0 + si * s + co * m;
          if (soort === 0) { const w = k % 2 ? 0.06 : -0.06; ovaal(x - si * w, y + co * w, 0.065, 0.035, a); }
          else if (soort === 1) { ovaal(x - si * 0.06, y + co * 0.06, 0.08, 0.03, a); ovaal(x + si * 0.06, y - co * 0.06, 0.08, 0.03, a); rond(x - co * 0.28, y - si * 0.28, 0.03); rond(x - co * 0.42, y - si * 0.42, 0.03); }
          else if (soort === 2) { const w = k % 2 ? 0.025 : -0.025; rond(x - si * w, y + co * w, 0.018); }
          else rond(x, y, 0.035);
        }
      });
      vul('rgba(104,122,146,0.5)');
    }
    // 4. molshopen, mierenhopen en keien: schaduw, lijf en een lichte kant
    if (em[F_MOL].length) {
      elk(F_MOL, (x, y, r) => rond(x + r * 0.3, y + r * 0.35, r)); vul(schaduw);
      elk(F_MOL, (x, y, r) => rond(x, y, r)); vul('#5a4028');
      elk(F_MOL, (x, y, r) => rond(x - r * 0.3, y - r * 0.32, r * 0.45)); vul('#7c5e42');
    }
    if (em[F_MIER].length) {
      elk(F_MIER, (x, y, r) => ovaal(x + r * 0.3, y + r * 0.35, r * 1.05, r * 0.85, 0.6)); vul(schaduw);
      elk(F_MIER, (x, y, r) => rond(x, y, r)); vul('#6a4e32');
      elk(F_MIER, (x, y, r) => rond(x - r * 0.25, y - r * 0.28, r * 0.55)); vul('#94744c');
      elk(F_MIER, (x, y, r, h, z) => { for (let q = 0; q < 6; q++) { const a = z * 30 + q * 2.4, dd = r * (0.2 + 0.12 * q); rond(x + Math.cos(a) * dd, y + Math.sin(a) * dd, 0.018); } }); vul('#3a2818');
      // mieren die over de hoop krioelen (pas vanaf zoom 13 te zien)
      if (this._fz >= 13 && sz.winter < 0.5) { elk(F_MIER, (x, y, r, h, z) => { for (let q = 0; q < 5; q++) { const a = t * (0.6 + q * 0.13) * (q % 2 ? 1 : -1) + z * 20 + q, dd = r * (0.35 + 0.5 * frac(z * 7 + q * 0.37)); rond(x + Math.cos(a) * dd, y + Math.sin(a) * dd, 0.012); } }); vul('#1a120a'); }
    }
    if (em[F_KEI].length) {
      elk(F_KEI, (x, y, r, h) => ovaal(x + r * 0.32, y + r * 0.38, r * 1.05, r * 0.8, h)); vul('rgba(20,18,14,0.38)');
      elk(F_KEI, (x, y, r, h) => ovaal(x, y, r, r * 0.78, h)); vul('#8a8478');
      elk(F_KEI, (x, y, r, h) => ovaal(x - r * 0.25, y - r * 0.28, r * 0.55, r * 0.4, h)); vul('#bcb6a8');
      if (elk(F_KEI, (x, y, r, h, z) => { if (z < 0.4) ovaal(x + r * 0.1, y - r * 0.45, r * 0.45, r * 0.22, h); })) vul(pal.mos);
      if (pal.kap > 0.02) { elk(F_KEI, (x, y, r, h) => ovaal(x - r * 0.15, y - r * 0.2, r * 0.6, r * 0.42, h)); vul(pal.sneeuwKap); }
    }
    // 5. bloemen: per soort de kroon en het hart; pluizenbollen als ringetjes
    for (const s of [F_KLAVER, F_PAARD, F_BOTER, F_KNOOP, F_KOREN, F_KLAP]) {
      if (!em[s].length) continue;
      elk(s, (x, y, r) => rond(x, y, r)); vul(BLOEM_KLEUR[s]);
      elk(s, (x, y, r) => rond(x - r * 0.1, y - r * 0.1, r * (s === F_BOTER ? 0.35 : 0.38))); vul(BLOEM_HART[s]);
    }
    if (em[F_PLUIS].length) {
      elk(F_PLUIS, (x, y, r) => rond(x, y, r)); trek('rgba(248,248,240,0.85)', 0.025);
      elk(F_PLUIS, (x, y) => rond(x, y, 0.02)); vul('#b8ae88');
    }
    // 6. gras: drie sprieten per pol, de toppen buigen mee met de wind
    if (em[F_POL].length) {
      for (let s = 0; s < 2; s++) {
        elk(F_POL, (x, y, r, h, z) => {
          if ((z < 0.5 ? 0 : 1) !== s) return;
          const buig = r * (0.15 + 0.45 * kr) * golf(x, y, z), bx = wx * buig, by = wy * buig * 0.5;
          c.moveTo(x - r * 0.42 + bx, y - r * 0.85 + by); c.lineTo(x - 0.02, y); c.lineTo(x + 0.04 + bx * 1.2, y - r * 1.1 + by);
          c.moveTo(x + 0.02, y); c.lineTo(x + r * 0.45 + bx, y - r * 0.8 + by);
        });
        trek(pal.pluk[s], Math.max(0.03, 0.45 / this._fk));
      }
    }
    // 7. paddenstoelen: bij de stammen en in heksenkringen
    if (em[F_PADDO].length || em[F_HEKS].length) {
      const kring = (fn) => elk(F_HEKS, (x, y, R, h, z) => { for (let q = 0; q < 12; q++) { const a = h + q * 0.5236 + Math.sin(q * 2.1 + z * 7) * 0.12, rr = R * (0.92 + 0.16 * frac(z * 13 + q * 0.29)); fn(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85, 0.05 + 0.02 * frac(z * 5 + q * 0.61)); } });
      elk(F_PADDO, (x, y, r) => rond(x + r * 0.35, y + r * 0.4, r)); kring((x, y, r) => rond(x + r * 0.35, y + r * 0.4, r)); vul(schaduw);
      elk(F_PADDO, (x, y, r) => rond(x, y, r)); vul('#9a6234');
      kring((x, y, r) => rond(x, y, r)); vul('#e8dcc0');
      elk(F_PADDO, (x, y, r) => rond(x - r * 0.3, y - r * 0.3, r * 0.4)); kring((x, y, r) => rond(x - r * 0.3, y - r * 0.3, r * 0.35)); vul('#d8b888');
    }
    // 8. riet op de slootkanten
    if (em[F_RIET].length) {
      elk(F_RIET, (x, y, r, h, z) => {
        const buig = r * (0.1 + 0.35 * kr) * golf(x, y, z), bx = wx * buig, by = wy * buig * 0.4;
        for (let q = -1; q <= 1; q++) { c.moveTo(x + q * 0.04, y); c.lineTo(x + q * r * 0.25 + bx, y - r * (1.2 + 0.12 * ((q + 1 + z * 10) % 3)) + by); }
      });
      trek(pal.riet, Math.max(0.03, 0.4 / this._fk));
      if (elk(F_RIET, (x, y, r, h, z) => { if (z < 0.45) { const buig = r * (0.1 + 0.35 * kr) * golf(x, y, z); rond(x + r * 0.25 + wx * buig, y - r * 1.3 + wy * buig * 0.4, 0.05); } })) vul(pal.rietKop);
    }
    // 9. bramen: donkere kluwen met ranken, witte bloempjes in juni, rode en dan zwarte bessen in de nazomer
    if (em[F_BRAAM].length) {
      const kaal = sz.winter > 0.5;
      elk(F_BRAAM, (x, y, r, h) => ovaal(x + r * 0.3, y + r * 0.35, r * 1.1, r * 0.8, h)); vul('rgba(10,18,8,0.32)');
      elk(F_BRAAM, (x, y, r, h) => { for (let q = 0; q < 4; q++) { const a = h + q * 1.57; rond(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.35, r * 0.55); } }); vul(kaal ? '#5c4c3a' : '#34502a');
      elk(F_BRAAM, (x, y, r, h) => rond(x - r * 0.25, y - r * 0.28, r * 0.42)); vul(kaal ? '#7a6a54' : '#4e6e36');
      elk(F_BRAAM, (x, y, r, h) => { for (let q = 0; q < 3; q++) { const a = h + q * 2.1; c.moveTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.5); c.quadraticCurveTo(x + Math.cos(a + 0.5) * r * 1.2, y + Math.sin(a + 0.5) * r * 1.0, x + Math.cos(a + 0.9) * r * 1.3, y + Math.sin(a + 0.9) * r * 1.1); } });
      trek('#6a3a30', Math.max(0.025, 0.4 / this._fk));
      const bes = d >= 150 && d <= 198 ? '#f2ecee' : d >= 199 && d <= 222 ? '#b02a2a' : d >= 223 && d <= 265 ? '#22142a' : null;
      if (bes) { elk(F_BRAAM, (x, y, r, h, z) => { for (let q = 0; q < 5; q++) { const a = z * 30 + q * 1.3; rond(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.45, 0.035); } }); vul(bes); }
    }
    // 10. knotwilgen: een dikke knot met in de zomer een bol zilvergroen blad, in de winter kale rode twijgen
    if (em[F_KNOT].length) {
      const kaal = pal.kaal > 0.5, buig = (0.04 + 0.1 * kr);
      elk(F_KNOT, (x, y, r) => ovaal(x + r * 0.45, y + r * 0.5, r * 1.05, r * 0.72, Math.PI / 4)); vul('rgba(8,18,8,0.34)');
      elk(F_KNOT, (x, y, r) => rond(x, y, r * 0.38)); vul('#5a4634');
      if (kaal) {
        elk(F_KNOT, (x, y, r, h) => { const g = golf(x, y, h) * buig; for (let q = 0; q < 9; q++) { const a = h + q * 0.698; c.moveTo(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25); c.lineTo(x + Math.cos(a) * r + wx * g, y + Math.sin(a) * r + wy * g); } });
        trek('#8a4a36', Math.max(0.03, 0.45 / this._fk));
        elk(F_KNOT, (x, y, r) => rond(x - r * 0.1, y - r * 0.1, r * 0.2)); vul('#7a6450');
      } else {
        const blad = css(mengH(mengH('#9ab66e', '#7f9a68', sz.zomer), '#b8a858', sz.herfst));
        elk(F_KNOT, (x, y, r, h) => { const g = golf(x, y, h) * buig; for (let q = 0; q < 6; q++) { const a = h + q * 1.047; rond(x + Math.cos(a) * r * 0.5 + wx * g, y + Math.sin(a) * r * 0.5 + wy * g, r * 0.42); } }); vul(blad);
        elk(F_KNOT, (x, y, r) => { rond(x - r * 0.3, y - r * 0.32, r * 0.32); rond(x + r * 0.05, y - r * 0.45, r * 0.2); }); vul('rgba(214,226,184,0.75)');
      }
    }
    return tel;
  }
}
