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
};
const KROON = ['#24402a', '#30552f', '#3f6b3a'];
const KROON_LICHT = '#5a8a4a';
const PERCEEL_KLEUR = ['#c8b46a', '#84a656', '#7d5f3f', '#d6c84a']; // tarwe, groen, geploegd, koolzaad
const VOOR_KLEUR = ['rgba(150,128,60,0.55)', 'rgba(90,122,58,0.55)', 'rgba(70,50,30,0.75)', null];
const HAAG = '#4d6b35';

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
  if (!opties.vers) basisCache.set(geo, basis);
  return basis;
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
  const g = new Float32Array(SOORTEN);
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
    }
  }
  const kleur = new Uint8ClampedArray(NN * 4); // samengesteld: wat je ziet
  const land = new Uint8ClampedArray(NN * 4); // landkleur overal (onder water: zand)
  const zee = new Uint8ClampedArray(NN * 4); // waterkleur overal (op land: ondiep)
  const sneeuw = new Float32Array(NN);
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
      // reliëf, plus een lichte warme toon in het zonlicht (minder blauw)
      c[0] *= schaduw; c[1] *= schaduw; c[2] *= schaduw * 0.9;
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
      const wv = 0.94 + 0.12 * ruis(x * 0.06 + 90, y * 0.06 + 30);
      zee[p] = tmp[0] * wv; zee[p + 1] = tmp[1] * wv; zee[p + 2] = tmp[2] * wv; zee[p + 3] = 255;
      const bron = water[m] ? zee : land;
      kleur[p] = bron[p]; kleur[p + 1] = bron[p + 1]; kleur[p + 2] = bron[p + 2]; kleur[p + 3] = 255;
    }
  }
  return { ck, cr, x0, y0, n: N, gewicht, water, sd, hoogte, sneeuw, kleur, land, zee };
}

// Water- en schuimmaskers op 3 monsters per eenheid (met dezelfde marge), wit met alfa.
export function bakMaskerData(b, ck, cr) {
  const ruis = b.geo.ruis;
  const x0 = ck * CH - MARGE, y0 = cr * CH - MARGE;
  const water = new Uint8ClampedArray(MN * MN * 4), schuim1 = new Uint8ClampedArray(MN * MN * 4), schuim2 = new Uint8ClampedArray(MN * MN * 4);
  for (let j = 0; j < MN; j++) {
    for (let i = 0; i < MN; i++) {
      const x = x0 + (i + 0.5) / M, y = y0 + (j + 0.5) / M, p = (j * MN + i) * 4;
      const sd = sdOp(b, x, y);
      // ondiep water is wat doorschijnend, zodat het zand eronder zichtbaar blijft
      const wa = smooth(-0.18, 0.18, sd) * (0.72 + 0.28 * smooth(0.2, 2.6, sd));
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
// Wordt gecachet in de basis; bakken en scherp tekenen gebruiken dezelfde lijst.
export function kenmerkenVoorTegel(t, b) {
  if (b.kenmerken[t.i]) return b.kenmerken[t.i];
  const uit = [];
  const g = new Float32Array(SOORTEN);
  const geo = b.geo, half = geo.T / 2;
  const r = rnd(t.i * 9176 + 31);
  const zet = (type, x, y, rr, variant, extra = 0) => { uit.push(type, x, y, rr, variant, extra); };
  const gew = (x, y) => gewichtenOp(b, t.x + x, t.y + y, g);
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
        if (isWater(b, t.x + x, t.y + y) || gew(x, y)[BOS] <= 0.5) continue;
        zet(BOOM, x, y, 0.62 + hash(t.i, q, 4) * 0.42, Math.floor(hash(t.i, q, 5) * 3), hash(t.i, q, 6));
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
      if (g[BERG] <= 0.4 || isWater(b, t.x + x, t.y + y)) continue;
      const rotsen = 2 + Math.floor(r() * 3);
      for (let q = 0; q < rotsen; q++) {
        const rx = x + (r() - 0.5) * 2.4, ry = y + (r() - 0.5) * 2.4, rr = 0.5 + r() * 0.8;
        const hoog = hoogteOp(b, t.x + rx, t.y + ry, gew(rx, ry)[BERG]) > 1.66 ? 1 : 0;
        zet(ROTS, rx, ry, rr, r(), hoog);
      }
      const gruis = 2 + Math.floor(r() * 4);
      for (let q = 0; q < gruis; q++) zet(GRUIS, x + 0.6 + r() * 2.2, y + 0.6 + r() * 2.2, 0.12 + r() * 0.14, r());
    }
  } else if (t.terrein !== 'bos') {
    // vlakte, kust en onbewoonde eilanden: losse bomen en graspollen op open grasland
    if (!b.akker[t.i]) {
      const bomen = Math.floor(r() * 4);
      for (let q = 0; q < bomen; q++) {
        const x = (r() - 0.5) * geo.T * 0.8, y = (r() - 0.5) * geo.T * 0.8;
        if (sdOp(b, t.x + x, t.y + y) > -1.5) continue;
        gew(x, y);
        if (g[ZAND] > 0.35 || g[BOS] > 0.4 || g[AKKER] > 0.4) continue;
        zet(LOSBOOM, x, y, 0.7 + r() * 0.4, Math.floor(r() * 3), r());
      }
    }
    const plukken = 7 + Math.floor(r() * 5);
    for (let q = 0; q < plukken; q++) {
      const x = (r() - 0.5) * geo.T * 0.95, y = (r() - 0.5) * geo.T * 0.95;
      if (sdOp(b, t.x + x, t.y + y) > -0.8) continue;
      gew(x, y);
      if (g[BOS] > 0.45 || g[AKKER] > 0.45) continue;
      zet(PLUK, x, y, 0.35 + r() * 0.25, r() < 0.5 ? 0 : 1);
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
  }
  b.kenmerken[t.i] = Float32Array.from(uit);
  return b.kenmerken[t.i];
}

// Lappendeken van akkers op een gedraaid rooster per land: buurvakjes van hetzelfde land lopen door.
// Een perceel hoort bij het vakje waarin zijn midden ligt en bestaat waar het akkergewicht boven 0,5 ligt.
function percelen(t, b, zet, g) {
  const geo = b.geo, half = geo.T / 2;
  const hoek = hash(t.eig, 9) * Math.PI, co = Math.cos(hoek), si = Math.sin(hoek);
  const cu = 5.5 + hash(t.eig, 11) * 2, cv = 4 + hash(t.eig, 12) * 1.5;
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
        // geen akker die in zee steekt
        let nat = false;
        for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const px = x + (su * hu) * co - (sv * hv) * si, py = y + (su * hu) * si + (sv * hv) * co;
          if (sdOp(b, px, py) > -0.6) { nat = true; break; }
        }
        if (nat) continue;
        const k = hash(t.eig * 131 + a, bb * 7 + d, 14);
        const soort = k < 0.4 ? 0 : k < 0.72 ? 1 : k < 0.95 ? 2 : 3;
        zet(PERCEEL, x - t.x, y - t.y, hu, soort, hv);
      }
    }
  }
}

// ---------- kenmerken tekenen (gedeeld door bakken en scherpe laag) ----------

// Tekent de kenmerken van de vakjes in `lijst` (n stuks) in wereldcoördinaten; de aanroeper zet de transformatie.
// k = pixels per wereldeenheid (voor minimale lijndiktes). Per kleur één pad.
function tekenLagen(c, b, lijst, n, k, opties) {
  const tegels = b.geo.tegels;
  const zwaai = opties.zwaai; // null of tijd in ms
  const pix = 1 / k;
  const elk = (type, fn) => {
    for (let q = 0; q < n; q++) {
      const t = tegels[lijst[q]], f = kenmerkenVoorTegel(t, b);
      for (let p = 0; p < f.length; p += STAP) if (f[p] === type) fn(t, f, p);
    }
  };
  const elkVan = (types, fn) => {
    for (let q = 0; q < n; q++) {
      const t = tegels[lijst[q]], f = kenmerkenVoorTegel(t, b);
      for (let p = 0; p < f.length; p += STAP) if (types.includes(f[p])) fn(t, f, p);
    }
  };
  const rond = (x, y, r) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); };

  // 1. akkers: vlakken, voren, hagen
  const hoekVan = (t) => hash(t.eig, 9) * Math.PI;
  const rechthoek = (t, f, p, krimp) => {
    const h = hoekVan(t), co = Math.cos(h), si = Math.sin(h);
    const x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3] - krimp, hv = f[p + 5] - krimp;
    c.moveTo(x - hu * co + hv * si, y - hu * si - hv * co);
    c.lineTo(x + hu * co + hv * si, y + hu * si - hv * co);
    c.lineTo(x + hu * co - hv * si, y + hu * si + hv * co);
    c.lineTo(x - hu * co - hv * si, y - hu * si + hv * co);
    c.closePath();
  };
  for (let s = 0; s < 4; s++) {
    c.beginPath();
    let iets = false;
    elk(PERCEEL, (t, f, p) => { if (f[p + 4] === s) { rechthoek(t, f, p, 0); iets = true; } });
    if (iets) { c.fillStyle = PERCEEL_KLEUR[s]; c.fill(); }
  }
  c.lineWidth = Math.max(0.12, 0.6 * pix);
  for (let s = 0; s < 3; s++) {
    c.beginPath();
    let iets = false;
    elk(PERCEEL, (t, f, p) => {
      if (f[p + 4] !== s) return;
      iets = true;
      const h = hoekVan(t), co = Math.cos(h), si = Math.sin(h);
      const x = t.x + f[p + 1], y = t.y + f[p + 2], hu = f[p + 3] - 0.15, hv = f[p + 5];
      const tussen = s === 2 ? 0.5 : 0.7;
      for (let v = -hv + tussen / 2; v < hv; v += tussen) {
        c.moveTo(x - hu * co - v * si, y - hu * si + v * co);
        c.lineTo(x + hu * co - v * si, y + hu * si + v * co);
      }
    });
    if (iets) { c.strokeStyle = VOOR_KLEUR[s]; c.stroke(); }
  }
  c.beginPath();
  let hagen = false;
  elk(PERCEEL, (t, f, p) => { rechthoek(t, f, p, -0.1); hagen = true; });
  if (hagen) { c.strokeStyle = HAAG; c.lineWidth = Math.max(0.28, 0.8 * pix); c.stroke(); }

  // 2. grasplukjes
  c.lineWidth = Math.max(0.08, 0.5 * pix);
  for (let s = 0; s < 2; s++) {
    c.beginPath();
    let iets = false;
    elk(PLUK, (t, f, p) => {
      if (f[p + 4] !== s) return;
      iets = true;
      const x = t.x + f[p + 1], y = t.y + f[p + 2], r = f[p + 3];
      c.moveTo(x - r * 0.35, y - r); c.lineTo(x, y); c.lineTo(x + r * 0.35, y - r);
      c.moveTo(x, y); c.lineTo(x + r * 0.05, y - r * 1.15);
    });
    if (iets) { c.strokeStyle = s ? 'rgba(150,180,96,0.8)' : 'rgba(62,92,42,0.8)'; c.stroke(); }
  }

  // 3. kust: kiezels en drijfhout
  for (let s = 0; s < 2; s++) {
    c.beginPath();
    let iets = false;
    elk(KIEZEL, (t, f, p) => { if (f[p + 4] === s) { rond(t.x + f[p + 1], t.y + f[p + 2], f[p + 3]); iets = true; } });
    if (iets) { c.fillStyle = s ? '#8f8a80' : '#bdb6a6'; c.fill(); }
  }
  c.beginPath();
  let hout = false;
  elk(DRIJFHOUT, (t, f, p) => {
    hout = true;
    const x = t.x + f[p + 1], y = t.y + f[p + 2], l = f[p + 3], h = f[p + 4];
    c.moveTo(x - Math.cos(h) * l, y - Math.sin(h) * l); c.lineTo(x + Math.cos(h) * l, y + Math.sin(h) * l);
  });
  if (hout) { c.strokeStyle = '#8a7458'; c.lineWidth = Math.max(0.16, 0.8 * pix); c.stroke(); }

  // 4. rotsen: schaduw, lijf, belichte kant, sneeuw, gruis
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
    c.beginPath();
    let iets = false;
    elk(ROTS, (t, f, p) => { iets = true; const r = f[p + 3]; veelhoek(t.x + f[p + 1], t.y + f[p + 2], r, f[p + 4], 1.05, r * 0.3, r * 0.35); });
    if (iets) { c.fillStyle = 'rgba(25,22,18,0.4)'; c.fill(); }
  }
  const rotsLaag = (kleur, schaal, dx, dy, alleenSneeuw) => {
    c.beginPath();
    let iets = false;
    elk(ROTS, (t, f, p) => {
      if (alleenSneeuw && !f[p + 5]) return;
      iets = true;
      const r = f[p + 3];
      veelhoek(t.x + f[p + 1], t.y + f[p + 2], r, f[p + 4], schaal, dx * r, dy * r);
    });
    if (iets) { c.fillStyle = kleur; c.fill(); }
  };
  rotsLaag('#5f584e', 1, 0, 0, false);
  rotsLaag('#9a9386', 0.68, -0.2, -0.22, false);
  rotsLaag('#eef0f2', 0.4, -0.26, -0.32, true);
  c.beginPath();
  let gruis = false;
  elk(GRUIS, (t, f, p) => { gruis = true; rond(t.x + f[p + 1], t.y + f[p + 2], f[p + 3]); });
  if (gruis) { c.fillStyle = '#8d877b'; c.fill(); }

  // 5. bomen: schaduw naar het zuidoosten, kroon in drie tinten, lichte kant naar het noordwesten
  // wiegen in de wind: alleen in de scherpe laag, een fractie van een eenheid
  const dx = (f, p) => (zwaai == null ? 0 : Math.sin(zwaai / 1300 + f[p + 5] * 6.283) * 0.08);
  const bomen = [BOOM, LOSBOOM];
  if (opties.schaduw) {
    c.beginPath();
    let iets = false;
    elkVan(bomen, (t, f, p) => { iets = true; const r = f[p + 3]; rond(t.x + f[p + 1] + r * 0.32, t.y + f[p + 2] + r * 0.38, r * 1.02); });
    if (iets) { c.fillStyle = 'rgba(8,18,8,0.42)'; c.fill(); }
  }
  for (let s = 0; s < 3; s++) {
    c.beginPath();
    let iets = false;
    elkVan(bomen, (t, f, p) => { if (f[p + 4] === s) { iets = true; rond(t.x + f[p + 1] + dx(f, p), t.y + f[p + 2], f[p + 3]); } });
    if (iets) { c.fillStyle = KROON[s]; c.fill(); }
  }
  c.beginPath();
  let licht = false;
  elkVan(bomen, (t, f, p) => { licht = true; const r = f[p + 3]; rond(t.x + f[p + 1] - r * 0.28 + dx(f, p) * 1.3, t.y + f[p + 2] - r * 0.3, r * 0.45); });
  if (licht) { c.fillStyle = KROON_LICHT; c.fill(); }
}

// Hoeveel vormen de scherpe laag voor een vakje tekent (voor het plafond van 1500 per frame).
function kostenVan(t, b) {
  if (b.kosten[t.i] >= 0) return b.kosten[t.i];
  const f = kenmerkenVoorTegel(t, b);
  let n = 0;
  for (let p = 0; p < f.length; p += STAP) n += f[p] === ROTS ? 2 : f[p] === BOOM || f[p] === LOSBOOM ? 1 : f[p] === PERCEEL ? 3 : 0.5;
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
      g = { land: d.land, zee: d.zee, maskers };
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
    // 1. kleurbeeld van het land, vergroot met smoothing: zachte overgangen en reliëf
    k.putImageData(maakBeeld(g.land, N, N), 0, 0);
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
    // 3. water erover, met een fijn masker voor een strakke kustlijn
    const md = bakMaskerData(b, ck, cr);
    const maskers = ['water', 'schuim1', 'schuim2'].map((naam) => {
      const cv = oud?.[naam === 'water' ? 'waterMasker' : naam] ?? this.canvas(MN, MN);
      cv.getContext('2d').putImageData(maakBeeld(md[naam], MN, MN), 0, 0);
      return cv;
    });
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, S, S);
    k.putImageData(maakBeeld(g.zee, N, N), 0, 0);
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
    tekenLagen(gc, b, lijst, n, R, { schaduw: true, zwaai: null });
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
    const mx = (wx0 + wx1) / 2, my = (wy0 + wy1) / 2;
    let beste = null, bd = Infinity;
    const getekend = this._getekend ?? (this._getekend = []);
    getekend.length = 0;
    for (let cr = r0; cr <= r1; cr++) {
      for (let ck = k0; ck <= k1; ck++) {
        this.brokSig(s, ck, cr);
        const polSig = `${glob}${this._e}`;
        const sig = `${polSig}|${this._z}`;
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
    // Ketens van buurbrokken overlappen een kwart eenheid; per brok knippen, anders wordt de naad dubbel donker.
    const scherp = sc * dpr > R * 1.3;
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
        const polSig = `${glob}${this._e}`, sig = `${polSig}|${this._z}`;
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

  // Scherpe kenmerken bij diep inzoomen (vervangt de oude tekenTerreinDetail): vanaf zoom 7 vector, vloeiend in.
  tekenKenmerken(c, view, sc, nu) {
    if (!this.basis || view.geo !== this.geo) return;
    const alfa = smooth(6.5, 8, view.zoom);
    if (alfa <= 0) return;
    const geo = this.geo, s = view.state;
    const [wx0, wy0] = view.naarWereld(0, 0), [wx1, wy1] = view.naarWereld(view.w, view.h);
    const k0 = Math.max(0, Math.floor(wx0 / geo.T) - 1), k1 = Math.min(geo.kol - 1, Math.floor(wx1 / geo.T) + 1);
    const r0 = Math.max(0, Math.floor(wy0 / geo.T) - 1), r1 = Math.min(geo.rij - 1, Math.floor(wy1 / geo.T) + 1);
    const mx = (wx0 + wx1) / 2, my = (wy0 + wy1) / 2;
    // dichtstbijzijnde vakjes eerst, tot het plafond aan vormen bereikt is; verder weg blijft de gebakken versie
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
      const kk = kostenVan(tg[i], this.basis);
      if (kosten + kk > MAX_PRIMITIEVEN) break;
      kosten += kk;
      lijst[n++] = i;
    }
    this.laatsteKosten = kosten;
    c.save();
    c.globalAlpha = alfa;
    c.translate(view.w / 2 - view.cx * sc, view.h / 2 - view.cy * sc);
    c.scale(sc, sc);
    tekenLagen(c, this.basis, lijst, n, sc, { schaduw: false, zwaai: nu });
    c.restore();
  }
}
