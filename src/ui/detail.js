// Gedetailleerde weergave voor diep inzoomen: alles in code getekend, schuin van boven, in de bouwstijl van het regime.
// Elke functie tekent binnen één vakje met middelpunt (x, y) en zijde s (in schermpixels).
//
// Detail groeit mee met de tegelgrootte: lod0 (< 120 px) is de eenvoudige tekening, lod1 (tot 220 px) voegt
// daknokken, schoorstenen, raamrijen, tuinen, hekken en geparkeerde auto's toe, lod2 (daarboven) ramen per gevel,
// dakinstallaties, auto's op parkeerplaatsen en kleine extra's. Daarnaast heeft elk gebouw een bouwniveau 1–3:
// een woonwijk groeit van vrijstaande huizen via rijtjes naar woonblokken, een fabriek krijgt een extra hal en
// een spooraansluiting. Lage efficiëntie, een cyberuitval, onrust en oorlog zijn ook te zien.
//
// Het vaste deel van elk gebouw wordt één keer in een bitmap gebakken (LRU-cache). Per beeld komen alleen de
// levende delen erbij: rook, knipperlichten, kranen, glinstering, voertuigen, vlaggen en verlichte ramen.
// Geen toevalsgenerator van de browser en de toestand wordt nooit gewijzigd: plaatsing volgt uit een hash van tegel en index,
// de klok stuurt alleen beweging.
//
// Pakket D (gebouwen plus): binnen elke lod komen er trapsgewijs nog meer kleine dingen bij, op vaste tegelmaten
// (D5 … D13, ongeveer zoom 5 … 13): straatmeubilair, tuinen, dakinstallaties, gevels met balkons en winkels, parken,
// bouwplaatsen, blikvangers in de hoofdstad en per gebouwsoort eigen bewegende delen (wieken, radar, banden,
// schachtwiel, fonteinen, helikopter). Seizoen en wind komen uit seizoen.js: sneeuw op de daken, herfstkleuren,
// kale bomen, rookpluimen die met de wind meewaaien. Het seizoen zit als emmer in de cachesleutel.

import { seizoen, wind } from './seizoen.js';

const STIJL = {
  democratie: { daken: ['#b5563b', '#7c8a99', '#4f6d8f', '#a8623a', '#8b6f5a'], muur: '#ddd5c6', accent: '#4c8ef7' },
  eenpartijstaat: { daken: ['#6d6f73', '#7b7d80', '#86888a'], muur: '#b0b0aa', accent: '#d9443c', blokken: true, strak: true },
  theocratie: { daken: ['#eadfc4', '#dccca6', '#e4d6b4'], muur: '#f0e8d4', accent: '#8a63b8', plat: true },
  militair: { daken: ['#5d6b4a', '#6b6b5a', '#73715c'], muur: '#8f8f78', accent: '#c2a14a', strak: true },
  monarchie: { daken: ['#9c3b2f', '#7d2f2a', '#a8463a'], muur: '#e6dbc8', accent: '#d4af37' },
};

export function stijlVan(regime) {
  return STIJL[regime] ?? STIJL.democratie;
}

// Deterministische pseudo-random per vakje, zodat elk vakje er altijd hetzelfde uitziet.
function rnd(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gedeelde hash uit de inzoom-spec: zelfde invoer, zelfde getal in [0, 1).
function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const frac = (v) => v - Math.floor(v);

// ---------- canvasfabriek en bitmapcache ----------

// Geen document bij het laden: de fabriek maakt pas een canvas als er gebakken wordt. In Node zonder canvas
// geeft hij null en tekent de module rechtstreeks (zoals vroeger), zodat headless tests gewoon werken.
// Een gewoon canvas gaat vóór OffscreenCanvas: gemeten tekent drawImage van een OffscreenCanvas (of ImageBitmap)
// in de hoofdkaart zo'n zes keer trager (35 bitmaps: 28 ms tegen 4,8 ms per beeld).
// Om dezelfde reden bakt de cache op de exacte maat in schermpixels en tekent hij op hele pixels: een bitmap
// die ook maar 4% geschaald of een halve pixel verschoven wordt, kostte gemeten vijf keer zoveel (10 ms tegen 2 ms).
const standaardFabriek = (w, h) => (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h })
  : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : null);
let fabriek = standaardFabriek;

export function zetCanvasFabriek(fn) {
  fabriek = fn ?? standaardFabriek;
  leegCache();
}

// tegelgrootte in px waar lod1 en lod2 beginnen; afgestemd op het echte kaartvak (zo'n 880 px breed bij 1300x850,
// T ≈ 14·zoom): lod1 vanaf zoom ~6.4, lod2 vanaf zoom ~10.7
const LOD1 = 90, LOD2 = 150;
const MAX_BITMAPS = 300, MAX_PX = 600;
const MAX_BYTES = 64 * 1024 * 1024; // plafond uit de spec; ruim 40 bitmaps op de grootste maat tegelijk in beeld
const BAKKEN_PER_BEELD = 4; // daarna tijdelijk de vorige maat geschaald tonen, zodat zoomen niet hapert
const ZOOMMARGE = 1.25; // tijdens het zoomen mag de vorige bitmap tot deze factor geschaald worden
const RAAMLICHT = '#ffe9a8';

const CACHE = new Map(); // sleutel → bitmap; Map houdt de volgorde bij, dus de eerste is het langst ongebruikt
const LAATSTE = new Map(); // sleutel zonder maat → laatst gebakken bitmap, als tijdelijke vervanger
const VORIGE_MAAT = new Map(); // sleutel zonder maat → tegelgrootte van het vorige beeld (om zoomen te herkennen)
let cacheBytes = 0, bakBeeld = -1, bakTeller = 0;

export function leegCache() {
  CACHE.clear();
  LAATSTE.clear();
  VORIGE_MAAT.clear();
  cacheBytes = 0;
  bakTeller = 0;
  bakBeeld = -1;
  extraTeller = 0;
  extraBeeld = -1;
}

export function cacheInfo() {
  return { aantal: CACHE.size, bytes: cacheBytes, maxAantal: MAX_BITMAPS, maxBytes: MAX_BYTES };
}

// De soorten met een detailtekening (voor tests en de kaart).
export function gebouwSoorten() {
  return Object.keys(TEKEN);
}

function opruimen() {
  for (const [k, e] of CACHE) {
    if (CACHE.size <= MAX_BITMAPS && cacheBytes <= MAX_BYTES) break;
    CACHE.delete(k);
    cacheBytes -= e.bytes;
    if (LAATSTE.get(e.vast) === e) { LAATSTE.delete(e.vast); VORIGE_MAAT.delete(e.vast); }
  }
  if (VORIGE_MAAT.size > 2 * MAX_BITMAPS) VORIGE_MAAT.clear();
}

// Doorzichtige kleuren per beeld uit een vaste tabel (16 stappen), zodat er per frame geen nieuwe strings ontstaan.
const ALFA_STAPPEN = 16;
const ALFA = new Map();
function rgba(rgb, a) {
  let t = ALFA.get(rgb);
  if (!t) {
    t = [];
    for (let i = 0; i <= ALFA_STAPPEN; i++) t.push(`rgba(${rgb},${i / ALFA_STAPPEN})`);
    ALFA.set(rgb, t);
  }
  const i = Math.round(a * ALFA_STAPPEN);
  return t[i < 0 ? 0 : i > ALFA_STAPPEN ? ALFA_STAPPEN : i];
}

// ---------- kleuren ----------

const ASFALT = '#3d3e3c', STOEP = '#a29e94', PLEIN = '#b8b1a1';
// Gras en heg kleuren mee met het seizoen; zetB kiest per bak de juiste set (z zomer, b bloei, h herfst, l laat, k kaal).
const GRAS_SEIZOEN = {
  z: ['#5f8a45', '#6f9a52', '#4d6b35'], b: ['#639149', '#75a258', '#4f7037'], h: ['#6b8644', '#7a9150', '#556a34'],
  l: ['#738350', '#808c5a', '#5a6638'], k: ['#77806b', '#848c76', '#56604b'],
};
let GRAS = GRAS_SEIZOEN.z[0], GRAS_LICHT = GRAS_SEIZOEN.z[1], HEG = GRAS_SEIZOEN.z[2];
const GLAS = '#2f3a46', ROEST = '#8a5a3a', BETON = '#9b978d', GRIND = '#a39a84', AARDE = '#8c7d68', WATER = '#23677f';
const AUTOS = ['#c8ccd0', '#2c3e50', '#8e2a24', '#f2f2ef', '#3a6ea5', '#5b5f63', '#b08d3c', '#2f5d3a'];
const AUTOS_STRAK = ['#6d6f73', '#5d6b4a', '#7b7d80', '#4a4f45'];
const CONTAINERS = ['#c0392b', '#2e86c1', '#f0b429', '#27ae60', '#d35400'];
const AKKER = ['#c8b46a', '#84a656', '#7d5f3f', '#c8b46a', '#84a656', '#d6c84a']; // gelijk aan de akkers van het terrein

// Lichter (f > 1, naar wit) of donkerder (f < 1). Alleen #rrggbb; het resultaat wordt onthouden.
const TINT = new Map();
function tint(hex, f) {
  const k = hex + f;
  let v = TINT.get(k);
  if (v) return v;
  const n = parseInt(hex.slice(1, 7), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f <= 1) { r *= f; g *= f; b *= f; } else { const m = Math.min(1, f - 1); r += (255 - r) * m; g += (255 - g) * m; b += (255 - b) * m; }
  v = `rgb(${r | 0},${g | 0},${b | 0})`;
  TINT.set(k, v);
  return v;
}

// ---------- bakcontext ----------

// Wat nu getekend wordt: maat, detail- en bouwniveau, staat van het gebouw, en de lijsten waarin ramen en
// levende delen worden vastgelegd (genormaliseerd op het midden van het vakje, in eenheden van s).
const B = {
  S: 100, cx: 0, cy: 0, lod: 0, niveau: 1, seed: 0, regime: 'democratie', kleur: '#ffffff',
  verwaarloosd: false, uit: false, onrust: false, oorlog: false, strak: false, r2: rnd(1), ramen: null, levend: null,
  sneeuw: 0, blad: 'z', groeiend: false, nieuw: 0, lamp: 0, soort: '', wv: 1, nieuwB: 0,
};

// Detailtrappen binnen de lods: tegelmaat in px (T ≈ 14·zoom op het gewone kaartvak), dus D9 ≈ zoom 9.
const D5 = 66, D7 = 96, D9 = 124, D11 = 152, D13 = 178;
const vanaf = (d) => B.S >= d;
// Plafonds: zoveel nieuwe levende delen per gebouw (bij het bakken) en per beeld voor alle gebouwen samen.
// Straatlantaarns hebben een eigen potje per gebouw: anders aten deurlampjes en rookpluimen (die eerder in de
// tekenvolgorde komen) op zoom 13–14 het plafond op en bleef de straat in een rijtjeswijk donker.
const MAX_NIEUW_GEBOUW = 40, MAX_LANTAARN_GEBOUW = 16, MAX_EXTRA_BEELD = 2400;
// Pakket B (daken, gevels, bedrijf) heeft een eigen potje per gebouw, zodat het de bestaande delen niet verdringt.
// Een dichte woonwijk (vier bouwblokken met winkels, balkons en platte daken) vraagt er 40 tot 65: met 24 kregen
// alleen de eerste blokken rook, was, rolluiken en lichtsnoeren en bleef de rest van de wijk kaal.
const MAX_B_GEBOUW = 24, MAX_B_WONEN = 64;
let extraBeeld = -1, extraTeller = 0;

// Seizoen als emmer voor de cache: sneeuw 0–3 en bladstand. Zonder speldag blijft het zomer, zoals voorheen.
const GEEN_SEIZOEN = { sneeuw: 0, blad: 'z', koud: 0.3, sleutel: 'z0', windHoek: 0.35, windKracht: 0.5 };
let szDag = NaN, szWaarde = GEEN_SEIZOEN;
function seizoenVan(dag) {
  if (typeof dag !== 'number' || !Number.isFinite(dag)) return GEEN_SEIZOEN;
  const d = Math.floor(dag);
  if (d === szDag) return szWaarde;
  const z = seizoen(d), w = wind(d);
  const sneeuw = z.sneeuw > 0.85 ? 3 : z.sneeuw > 0.45 ? 2 : z.sneeuw > 0.1 ? 1 : 0;
  // In de koude overgangen (eind november, begin maart) is het blad nooit zomergroen: laat herfst of nog kaal.
  const blad = z.koud > 0.82 ? 'k' : z.blad > 0.45 ? (z.koud > 0.62 ? 'l' : 'h') : z.bloei > 0.3 ? 'b'
    : z.koud > 0.62 ? (z.herfst > z.lente ? 'l' : 'k') : 'z';
  szDag = d;
  szWaarde = { sneeuw, blad, koud: z.koud, sleutel: blad + sneeuw, windHoek: w.hoek, windKracht: w.kracht };
  return szWaarde;
}
// De kaart geeft de speldag (nog) niet mee; dan lezen we hem alleen-lezend uit de debughandvat van main.js.
const dagVan = (ctx) => ctx.dag ?? globalThis.machtsbalans?.ui?.state?.dag;

// Mag dit beeld nog een levend extraatje bij? Telt per beeld (60 per seconde) over alle gebouwen.
function extraMag(tijd) {
  const b = Math.floor(tijd * 60);
  if (b !== extraBeeld) { extraBeeld = b; extraTeller = 0; }
  if (extraTeller >= MAX_EXTRA_BEELD) return false;
  extraTeller++;
  return true;
}

export function beeldInfo() {
  return { extra: extraTeller, maxExtra: MAX_EXTRA_BEELD, maxPerGebouw: MAX_NIEUW_GEBOUW + MAX_LANTAARN_GEBOUW + MAX_B_WONEN };
}

// Levende delen: per stuk zes getallen [soort, x, y, a, b, k].
const L_ROOK = 1, L_STOOM = 2, L_KNIPPER = 3, L_ZWAAI = 4, L_KAARS = 5, L_VUUR = 6, L_LED = 7, L_VLAG = 8,
  L_KRAAN = 9, L_GLINS = 10, L_VOERTUIG = 11, L_LAMP = 12;
// Pakket D: nieuwe levende delen (allemaal onder het plafond per beeld).
const L_WIEK = 20, L_RADAR = 21, L_BAND = 22, L_SCHACHT = 23, L_FONTEIN = 24, L_HELI = 25, L_STATUS = 26, L_PLUIM = 27,
  L_FAN = 28, L_MARS = 29, L_BAL = 30, L_SCHOMMEL = 31, L_TREIN = 32, L_EEND = 33, L_SCHIJN = 34, L_BOUWKRAAN = 35,
  L_WAS = 36, L_WINDZAK = 37, L_DEURLICHT = 38, L_LANTAARN = 39;
// Pakket B: duiven op de nok, kerstlichtjes, rolluiken, laaddock, heftruck, lorries, mensen (kinderen, studenten,
// bezoekers), appèl, hindernisbaan, erewacht, zwarte auto, publiek in het stadion.
const L_DUIF = 40, L_SNOER = 41, L_ROLLUIK = 42, L_DOCK = 43, L_HEFTRUCK = 44, L_LORRIE = 45, L_MENSEN = 46,
  L_APPEL = 47, L_OEFEN = 48, L_WACHT = 49, L_LIMO = 50, L_PUBLIEK = 51;
// Deze levende delen tekenen alleen 's nachts; overdag tellen ze niet mee in het plafond.
const NACHTWERK = { [L_DEURLICHT]: true, [L_SCHIJN]: true, [L_LANTAARN]: true, [L_SNOER]: true, [L_ROLLUIK]: true };

function levend(soort, x, y, a = 0, b = 0, k = 0) {
  if (B.levend) B.levend.push(soort, (x - B.cx) / B.S, (y - B.cy) / B.S, a / B.S, b / B.S, k);
}

// Nieuwe levende delen met een plafond per gebouw, zodat een groot blok nooit honderden lampjes krijgt.
function levendNieuw(soort, x, y, a = 0, b = 0, k = 0) {
  if (soort === L_LANTAARN) {
    if (B.lamp >= MAX_LANTAARN_GEBOUW) return;
    B.lamp++;
  } else {
    if (B.nieuw >= MAX_NIEUW_GEBOUW) return;
    B.nieuw++;
  }
  levend(soort, x, y, a, b, k);
}

// Pakket B: levende delen uit een eigen potje per gebouw. De laatste B_BEDRIJF plekken zijn voor de gebouwen in
// bedrijf (erewacht, dienstauto, laaddock, mensen ...): die worden als laatste gebakken en mochten niet wegvallen
// doordat ventilatoren, duiven en lichtsnoeren op een groot dak het potje al hadden leeggemaakt.
const B_BEDRIJF = 4;
function levendB(soort, x, y, a = 0, b = 0, k = 0) {
  if (B.nieuwB >= (WONEN[B.soort] ? MAX_B_WONEN : MAX_B_GEBOUW) - B_BEDRIJF) return;
  B.nieuwB++;
  levend(soort, x, y, a, b, k);
}
function levendBedrijf(soort, x, y, a = 0, b = 0, k = 0) {
  if (B.nieuwB >= (WONEN[B.soort] ? MAX_B_WONEN : MAX_B_GEBOUW)) return;
  B.nieuwB++;
  levend(soort, x, y, a, b, k);
}

// Vaste hash per plek in het vakje, onafhankelijk van de volgorde van tekenen.
const plekHash = (x, y, k = 0) => hash(B.seed, Math.round(((x - B.cx) / B.S) * 997) + k * 7919, Math.round(((y - B.cy) / B.S) * 991));

function raamVast(x, y, w, h) {
  if (B.ramen) B.ramen.push((x - B.cx) / B.S, (y - B.cy) / B.S, w / B.S, h / B.S);
}

// ---------- tekenhulpen ----------

const NIETS = {};

function rect(c, x, y, w, h, kleur) {
  c.fillStyle = kleur;
  c.fillRect(x, y, w, h);
}

function rond(c, x, y, r) {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
}

const lijn = (S, f = 0.004) => Math.max(0.5, S * f);

// Een pand schuin van boven: plattegrond (x, y, w, d) op de grond en v verdiepingen. Het dak ligt v·fh hoger,
// de zuidgevel met ramen is zichtbaar en de schaduw valt naar het zuidoosten (zon in het noordwesten, zoals het terrein).
// Geeft de bovenkant van het dak terug.
function pand(c, x, y, w, d, v, dak, muur, o = NIETS) {
  const S = B.S, lod = B.lod, fh = S * 0.017, h = v * fh;
  if (!o.geenSchaduw) {
    const sx = h * 0.75 + S * 0.006, sy = h * 0.5 + S * 0.004;
    c.fillStyle = 'rgba(0,0,0,0.26)';
    c.beginPath();
    c.moveTo(x + w, y - h); c.lineTo(x + w + sx, y - h + sy); c.lineTo(x + w + sx, y + d + sy * 0.4);
    c.lineTo(x + sx * 0.4, y + d + sy * 0.4); c.lineTo(x, y + d); c.closePath();
    c.fill();
  }
  if (h > 0) {
    c.fillStyle = tint(muur, 0.78);
    c.fillRect(x, y + d - h, w, h);
    if (lod >= 1) { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(x, y + d - h * 0.12, w, h * 0.12); }
    if (!o.geenRamen) gevelRamen(c, x, y + d - h, w, v, fh, o);
    if (!o.geenRamen && !o.dicht && lod >= 1) gevel(c, x, y + d - h, w, v, fh, o);
  }
  const ry = y - h;
  dakV = v;
  if (o.schuin) schuinDak(c, x, ry, w, d, dak, muur, o);
  else platDak(c, x, ry, w, d, dak, o);
  if (B.verwaarloosd) roest(c, x, ry, w, d);
  else if (B.wv === 0 && B.sneeuw < 2 && vanaf(D9) && plekHash(x, y, 31) < 0.45) verweerd(c, x, ry, w, d, o.schuin);
  return ry;
}

let dakV = 1; // verdiepingen van het pand waarvan nu het dak getekend wordt

function gevelRamen(c, x, y0, w, v, fh, o) {
  const S = B.S;
  const kol = Math.max(1, Math.floor(w / (S * (o.raamAfstand ?? 0.028))));
  const kw = w / kol, rw = kw * 0.5, rh = fh * 0.45;
  c.fillStyle = o.dicht ? '#4a3b2c' : GLAS;
  for (let f = 0; f < v; f++) {
    const ry = y0 + f * fh + fh * 0.25;
    for (let k = 0; k < kol; k++) c.fillRect(x + k * kw + (kw - rw) / 2, ry, rw, rh);
  }
  if (!o.dicht) {
    // vanaf D11 hangen er gordijnen opzij in een deel van de ramen: dan brandt 's nachts alleen het glas ertussen
    const gordijn = vanaf(D11) ? GORDIJN[Math.floor(plekHash(x, y0, 15) * GORDIJN.length)] : null, gw = rw * 0.2;
    if (gordijn) c.fillStyle = gordijn;
    for (let f = 0; f < v; f++) {
      const ry = y0 + f * fh + fh * 0.25;
      for (let k = 0; k < kol; k++) {
        const rx = x + k * kw + (kw - rw) / 2;
        if (gordijn && hash(B.seed, Math.round((rx - B.cx) / B.S * 997), f * 31 + 7) < 0.6) {
          c.fillRect(rx, ry, gw, rh); c.fillRect(rx + rw - gw, ry, gw, rh);
          raamVast(rx + gw, ry, rw - 2 * gw, rh);
        } else raamVast(rx, ry, rw, rh);
      }
    }
    // bloembakken onder de ramen van de begane grond (huizen, niet in de winter)
    if (o.schuin && vanaf(D13) && B.blad !== 'k' && plekHash(x, y0, 16) < 0.4) {
      const ry = y0 + (v - 1) * fh + fh * 0.25 + rh;
      for (let k = 0; k < kol; k++) {
        const rx = x + k * kw + (kw - rw) / 2;
        rect(c, rx - rw * 0.05, ry, rw * 1.1, Math.max(0.5, fh * 0.1), '#7a5a3a');
        c.fillStyle = B.blad === 'h' ? '#c9902f' : WINKEL[(k + B.seed) % WINKEL.length];
        rond(c, rx + rw * 0.3, ry, Math.max(0.45, fh * 0.07)); rond(c, rx + rw * 0.7, ry, Math.max(0.45, fh * 0.07));
      }
    }
  }
  if (o.dicht && B.lod >= 1) {
    // dichtgetimmerd: schuine planken over de ramen
    c.strokeStyle = '#7a6448';
    c.lineWidth = lijn(S, 0.003);
    c.beginPath();
    for (let k = 0; k < kol; k++) { const rx = x + k * kw + (kw - rw) / 2; c.moveTo(rx, y0 + fh * 0.25); c.lineTo(rx + rw, y0 + fh * 0.7); }
    c.stroke();
  }
}

function schuinDak(c, x, y, w, d, dak, muur, o) {
  const S = B.S, lod = B.lod, liggend = w >= d;
  c.fillStyle = tint(dak, 1.15);
  if (liggend) c.fillRect(x, y, w, d / 2); else c.fillRect(x, y, w / 2, d);
  c.fillStyle = tint(dak, 0.74);
  if (liggend) c.fillRect(x, y + d / 2, w, d / 2); else c.fillRect(x + w / 2, y, w / 2, d);
  // nok, en vanaf lod1 een schilddak met graten naar de hoeken
  c.strokeStyle = tint(dak, 1.35);
  c.lineWidth = lijn(S);
  c.beginPath();
  if (lod === 0) {
    if (liggend) { c.moveTo(x, y + d / 2); c.lineTo(x + w, y + d / 2); } else { c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + d); }
  } else if (liggend) {
    const a = Math.min(w / 2, d * 0.45);
    c.moveTo(x, y); c.lineTo(x + a, y + d / 2); c.lineTo(x, y + d);
    c.moveTo(x + w, y); c.lineTo(x + w - a, y + d / 2); c.lineTo(x + w, y + d);
    c.moveTo(x + a, y + d / 2); c.lineTo(x + w - a, y + d / 2);
  } else {
    const a = Math.min(d / 2, w * 0.45);
    c.moveTo(x, y); c.lineTo(x + w / 2, y + a); c.lineTo(x + w, y);
    c.moveTo(x, y + d); c.lineTo(x + w / 2, y + d - a); c.lineTo(x + w, y + d);
    c.moveTo(x + w / 2, y + a); c.lineTo(x + w / 2, y + d - a);
  }
  c.stroke();
  if (lod >= 1) {
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.strokeRect(x, y, w, d);
  }
  if (lod >= 2) {
    // pannenrijen evenwijdig aan de nok
    c.strokeStyle = 'rgba(0,0,0,0.1)';
    c.lineWidth = lijn(S, 0.002);
    c.beginPath();
    for (const f of [0.15, 0.32, 0.68, 0.85]) {
      if (liggend) { c.moveTo(x + w * 0.04, y + d * f); c.lineTo(x + w * 0.96, y + d * f); } else { c.moveTo(x + w * f, y + d * 0.04); c.lineTo(x + w * f, y + d * 0.96); }
    }
    c.stroke();
  }
  schuinExtras(c, x, y, w, d, liggend, o);
  if (lod >= 1 && o.schoorsteen !== false) {
    const cs = S * 0.014;
    const sx = liggend ? x + w * 0.72 : x + w * 0.62, sy = liggend ? y + d * 0.6 : y + d * 0.24;
    if (B.sneeuw && vanaf(D9)) {
      // de warme schoorsteen smelt een kring in de sneeuw: het dak komt erdoor, met een natte rand
      const zuid = liggend ? sy > y + d / 2 : sx > x + w / 2;
      c.fillStyle = 'rgba(70,60,55,0.18)';
      c.beginPath(); c.ellipse(sx + cs * 0.5, sy + cs * 0.55, cs * 1.55, cs * 1.25, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = tint(dak, zuid ? 0.74 : 1.15);
      c.beginPath(); c.ellipse(sx + cs * 0.5, sy + cs * 0.55, cs * 1.25, cs * 0.98, 0, 0, Math.PI * 2); c.fill();
    }
    rect(c, sx + cs * 0.5, sy + cs * 0.35, cs, cs, 'rgba(0,0,0,0.3)');
    rect(c, sx, sy, cs, cs, '#6b4a3a');
    rect(c, sx + cs * 0.2, sy + cs * 0.2, cs * 0.6, cs * 0.6, '#2a2220');
    if (B.sneeuw >= 2) rect(c, sx, sy, cs, cs * 0.25, '#eef1f5');
    // rookpluimpje uit een deel van de schoorstenen; het levende deel tekent alleen als het koud is
    if (vanaf(D9) && plekHash(sx, sy, 4) < (WONEN[B.soort] ? 0.6 : 0.4)) levendNieuw(L_PLUIM, sx + cs / 2, sy + cs / 2);
  }
  if (vanaf(D13) && w > S * 0.04 && plekHash(x, y, 27) < 0.32) {
    // duiven op de nok: een paar grijze stipjes, af en toe fladdert er een op
    if (liggend) levendB(L_DUIF, x + w * 0.22, y + d / 2, w * 0.5, 0, Math.floor(plekHash(x, y, 28) * 1000));
    else levendB(L_DUIF, x + w / 2, y + d * 0.22, 0, d * 0.5, Math.floor(plekHash(x, y, 28) * 1000));
  }
  if (lod >= 2 && liggend && w > S * 0.07 && o.dakkapel !== false) {
    // dakkapel op het zuidvlak, met een raam dat 's nachts kan branden
    const dx = x + w * 0.24, dw = w * 0.18, dd = d * 0.26, dy = y + d * 0.56;
    rect(c, dx + dw * 0.15, dy + dd * 0.2, dw, dd, 'rgba(0,0,0,0.25)');
    rect(c, dx, dy, dw, dd, tint(dak, 0.9));
    rect(c, dx + dw * 0.2, dy + dd * 0.55, dw * 0.6, dd * 0.4, muur);
    rect(c, dx + dw * 0.3, dy + dd * 0.62, dw * 0.4, dd * 0.28, GLAS);
    raamVast(dx + dw * 0.3, dy + dd * 0.62, dw * 0.4, dd * 0.28);
  }
}

function platDak(c, x, y, w, d, dak, o) {
  const S = B.S, lod = B.lod, r2 = B.r2;
  c.fillStyle = dak;
  c.fillRect(x, y, w, d);
  c.strokeStyle = tint(dak, 0.72);
  const lw = lijn(S, 0.005);
  c.lineWidth = lw;
  c.strokeRect(x + lw / 2, y + lw / 2, w - lw, d - lw);
  if (B.sneeuw) { c.fillStyle = rgba('240,244,250', [0, 0.3, 0.6, 0.78][B.sneeuw]); c.fillRect(x + w * 0.05, y + d * 0.05, w * 0.9, d * 0.9); }
  if (lod >= 1 && o.units !== 0) {
    // dakinstallaties: kastjes met schaduw
    const n = o.units ?? Math.min(3, Math.max(1, Math.round((w * d) / (S * S * 0.01))));
    const uw = Math.min(w * 0.3, S * 0.02), ud = Math.min(d * 0.3, S * 0.015);
    for (let i = 0; i < n; i++) {
      const ux = x + (w - uw) * (0.12 + 0.76 * r2()), uy = y + (d - ud) * (0.12 + 0.76 * r2());
      rect(c, ux + uw * 0.25, uy + ud * 0.3, uw, ud, 'rgba(0,0,0,0.25)');
      rect(c, ux, uy, uw, ud, '#8f9397');
      rect(c, ux, uy, uw, ud * 0.3, '#a9adb1');
      // aircokast met ventilator
      if (vanaf(D9)) { c.fillStyle = '#5d6266'; rond(c, ux + uw * 0.5, uy + ud * 0.62, Math.min(uw, ud) * 0.3); }
      // draaiende ventilator: op woonblokken één per dak (anders raakt het potje van een dichte wijk vol)
      if (vanaf(D13) && i < (WONEN[B.soort] ? 1 : 2) && plekHash(ux, uy, 29) < 0.6) levendB(L_FAN, ux + uw * 0.5, uy + ud * 0.62, 0, Math.min(uw, ud) * 0.26, 1);
    }
  }
  if (o.units !== 0 && !o.geenExtras && vanaf(D9)) platExtras(c, x, y, w, d, dak);
  if (lod >= 1 && o.kern) {
    // trappenhuis: iets hoger blok op het dak
    const kw = Math.min(w, d) * 0.28;
    for (const f of w >= d ? [0.25, 0.7] : [0.5]) {
      const kx = x + w * f - kw / 2, ky = y + d * (w >= d ? 0.3 : 0.4);
      rect(c, kx + kw * 0.3, ky + kw * 0.25, kw, kw, 'rgba(0,0,0,0.22)');
      rect(c, kx, ky, kw, kw, tint(dak, 0.88));
      if (vanaf(D11)) liftOpbouw(c, kx, ky, kw, dak);
    }
    if (vanaf(D11)) kernExtras(c, x, y, w, d);
  }
  if (lod >= 2) {
    c.fillStyle = 'rgba(30,30,30,0.45)';
    for (let i = 0; i < 2; i++) rond(c, x + w * (0.2 + 0.6 * r2()), y + d * (0.2 + 0.6 * r2()), S * 0.004);
  }
}

function roest(c, x, y, w, d) {
  const r2 = B.r2;
  c.globalAlpha = 0.3;
  c.fillStyle = ROEST;
  for (let i = 0; i < 2; i++) {
    c.beginPath();
    c.ellipse(x + w * (0.2 + 0.6 * r2()), y + d * (0.2 + 0.6 * r2()), w * (0.08 + 0.1 * r2()), d * (0.1 + 0.12 * r2()), 0, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

// Koepel: platte cirkels met een lichtvlek. Geen verloop per aanroep en nooit een symbool erop.
function koepel(c, x, y, r, kleur) {
  c.fillStyle = 'rgba(0,0,0,0.25)';
  rond(c, x + r * 0.25, y + r * 0.25, r);
  c.fillStyle = tint(kleur, 0.78);
  rond(c, x, y, r);
  c.fillStyle = kleur;
  rond(c, x - r * 0.1, y - r * 0.1, r * 0.82);
  c.fillStyle = tint(kleur, 1.45);
  rond(c, x - r * 0.36, y - r * 0.36, r * 0.3);
}

// Boom met seizoen: groen, bloesem in het voorjaar, eigen herfstkleur per boom, kaal in de winter.
// Een op de vijf is een naaldboom: die blijft groen en krijgt een sneeuwkapje.
const LOOF = ['#2f5530', '#3f6b3a', '#5a8a4a'], NAALD = ['#22422c', '#2e5538', '#43704c'];
const HERFST = ['#b5652a', '#c9902f', '#8e3b24', '#d1a43a', '#7d7a34', '#a84a2a'];
function boom(c, x, y, r) {
  const blad = B.blad, h = plekHash(x, y);
  const naald = h < 0.2;
  if (!naald && (blad === 'k' || (blad === 'l' && h > 0.62))) return kaleBoom(c, x, y, r, h);
  c.fillStyle = 'rgba(0,0,0,0.25)';
  rond(c, x + r * 0.35, y + r * 0.3, r);
  let k = naald ? NAALD : LOOF;
  if (!naald && (blad === 'h' || blad === 'l') && h > 0.3) {
    const b = HERFST[Math.floor(hash(B.seed, Math.round(h * 1e6), 3) * HERFST.length)];
    k = [tint(b, 0.68), b, tint(b, 1.3)];
  }
  c.fillStyle = k[0];
  rond(c, x, y, r);
  c.fillStyle = k[1];
  rond(c, x - r * 0.2, y - r * 0.2, r * 0.7);
  if (B.lod >= 1) { c.fillStyle = k[2]; rond(c, x - r * 0.38, y - r * 0.38, r * 0.3); }
  if (B.S >= D11 && r > 1.5) {
    // bladertextuur: een paar donkere vlekjes aan de schaduwkant
    c.fillStyle = 'rgba(0,0,0,0.16)';
    rond(c, x + r * 0.35, y + r * 0.2, r * 0.22);
    rond(c, x + r * 0.05, y + r * 0.5, r * 0.18);
  }
  if (blad === 'b' && !naald && h > 0.45 && B.S >= D7) {
    c.fillStyle = h > 0.75 ? '#f6f0f2' : '#efb8c8';
    for (let i = 0; i < 4; i++) rond(c, x + r * (hash(B.seed, i, Math.round(h * 1e5)) - 0.5) * 1.2, y + r * (hash(B.seed, i + 9, Math.round(h * 1e5)) - 0.5) * 1.2, r * 0.18);
  }
  if (naald && B.sneeuw >= 2) { c.fillStyle = rgba('245,248,252', 0.85); rond(c, x - r * 0.3, y - r * 0.32, r * 0.42); }
}

// Kale winterboom: stam, takken in één pad en een vage kroon; met sneeuw op de takken.
function kaleBoom(c, x, y, r, h) {
  const S = B.S;
  c.strokeStyle = 'rgba(0,0,0,0.18)';
  c.lineWidth = lijn(S, 0.003);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + r * 0.9, y + r * 0.6); c.stroke();
  c.fillStyle = 'rgba(120,100,82,0.28)';
  rond(c, x, y, r * 0.85);
  c.strokeStyle = '#5b4636';
  c.lineWidth = lijn(S, B.lod >= 1 ? 0.003 : 0.004);
  c.beginPath();
  const n = B.lod >= 1 ? 6 : 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + h * 6;
    c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85);
  }
  c.stroke();
  c.fillStyle = '#4a3a2c';
  rond(c, x, y, Math.max(0.5, r * 0.16));
  if (B.sneeuw >= 2) { c.fillStyle = rgba('245,248,252', 0.7); rond(c, x - r * 0.3, y - r * 0.3, r * 0.3); }
}

function silo(c, x, y, r) {
  c.fillStyle = 'rgba(0,0,0,0.28)';
  rond(c, x + r * 0.45, y + r * 0.35, r);
  c.fillStyle = '#aeb2b6';
  rond(c, x, y, r);
  c.fillStyle = '#ccd0d3';
  rond(c, x - r * 0.12, y - r * 0.12, r * 0.8);
  if (B.lod >= 1) {
    c.strokeStyle = 'rgba(0,0,0,0.2)';
    c.lineWidth = lijn(B.S, 0.003);
    c.beginPath(); c.arc(x, y, r * 0.55, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#8c9094';
    rond(c, x, y, r * 0.15);
  }
}

function autoKleur(i) {
  const p = B.strak ? AUTOS_STRAK : AUTOS;
  return p[Math.floor(hash(B.seed, i, 31) * p.length)];
}

// Auto met middelpunt (x, y); liggend = rijrichting oost-west.
function auto(c, x, y, kleur, liggend, schaal = 1) {
  const S = B.S, l = S * 0.06 * schaal, b = S * 0.032 * schaal;
  const w = liggend ? l : b, h = liggend ? b : l;
  rect(c, x - w / 2 + S * 0.004, y - h / 2 + S * 0.004, w, h, 'rgba(0,0,0,0.3)');
  rect(c, x - w / 2, y - h / 2, w, h, kleur);
  if (B.lod >= 1) {
    c.fillStyle = 'rgba(20,28,36,0.75)';
    if (liggend) c.fillRect(x - w * 0.16, y - h * 0.38, w * 0.4, h * 0.76); else c.fillRect(x - w * 0.38, y - h * 0.16, w * 0.76, h * 0.4);
  }
}

function vrachtwagen(c, x, y, kleur, liggend, laadbak = '#d9d6cc') {
  const S = B.S, l = S * 0.12, b = S * 0.04;
  const w = liggend ? l : b, h = liggend ? b : l;
  rect(c, x - w / 2 + S * 0.005, y - h / 2 + S * 0.005, w, h, 'rgba(0,0,0,0.3)');
  if (liggend) { rect(c, x - w / 2, y - h / 2, w * 0.74, h, laadbak); rect(c, x + w * 0.26, y - h / 2, w * 0.24, h, kleur); } else { rect(c, x - w / 2, y - h / 2 + h * 0.26, w, h * 0.74, laadbak); rect(c, x - w / 2, y - h / 2, w, h * 0.24, kleur); }
  if (B.lod >= 2) {
    c.strokeStyle = 'rgba(0,0,0,0.15)';
    c.lineWidth = lijn(S, 0.002);
    c.beginPath();
    for (let i = 1; i < 4; i++) { if (liggend) { c.moveTo(x - w / 2 + i * w * 0.18, y - h / 2); c.lineTo(x - w / 2 + i * w * 0.18, y + h / 2); } else { c.moveTo(x - w / 2, y - h / 2 + h * 0.26 + i * h * 0.18); c.lineTo(x + w / 2, y - h / 2 + h * 0.26 + i * h * 0.18); } }
    c.stroke();
  }
}

// Tank van bovenaf: romp, toren en loop.
function tankje(c, x, y) {
  const S = B.S;
  rect(c, x - S * 0.035 + S * 0.005, y - S * 0.022 + S * 0.005, S * 0.07, S * 0.044, 'rgba(0,0,0,0.3)');
  rect(c, x - S * 0.035, y - S * 0.022, S * 0.07, S * 0.044, '#5d6b4a');
  if (B.lod >= 1) { rect(c, x - S * 0.035, y - S * 0.022, S * 0.07, S * 0.008, '#3d4632'); rect(c, x - S * 0.035, y + S * 0.014, S * 0.07, S * 0.008, '#3d4632'); }
  c.fillStyle = '#4d5a3c';
  rond(c, x - S * 0.004, y, S * 0.014);
  c.strokeStyle = '#3d4632';
  c.lineWidth = lijn(S, 0.005);
  c.beginPath(); c.moveTo(x + S * 0.008, y); c.lineTo(x + S * 0.05, y); c.stroke();
}

function drone(c, x, y, r) {
  c.strokeStyle = '#2a2e33';
  c.lineWidth = lijn(B.S, 0.005);
  c.beginPath(); c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r); c.stroke();
  c.fillStyle = '#3b4148';
  rond(c, x, y, r * 0.35);
  if (B.lod >= 1) {
    c.strokeStyle = 'rgba(200,205,210,0.7)';
    c.lineWidth = lijn(B.S, 0.002);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.beginPath(); c.arc(x + dx * r, y + dy * r, r * 0.45, 0, Math.PI * 2); c.stroke(); }
  }
}

function hek(c, x, y, s, kleur) {
  c.strokeStyle = kleur;
  c.lineWidth = Math.max(0.8, s * 0.02);
  c.setLineDash([s * 0.04, s * 0.03]);
  c.strokeRect(x - s * 0.44, y - s * 0.44, s * 0.88, s * 0.88);
  c.setLineDash([]);
}

function hekje(c, x, y, w, h) {
  c.strokeStyle = 'rgba(228,218,190,0.75)';
  c.lineWidth = lijn(B.S, 0.003);
  c.strokeRect(x, y, w, h);
}

// Vlaggenmast: de paal is vast, het doek wappert als levend deel. k = 0 eigenaarskleur, 1 accent van het regime.
function paal(c, x, y, lengte, k = 0) {
  c.strokeStyle = '#dcdcdc';
  c.lineWidth = lijn(B.S, 0.006);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - lengte); c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + lengte * 0.5, y + lengte * 0.3); c.stroke();
  levend(L_VLAG, x, y - lengte, lengte * 0.42, lengte * 0.26, k);
}

// Rook stijgt op en waait met de wind mee (wx, wy: windvector uit seizoen.js, kracht 0..1).
function rook(c, x, y, s, tijd, seed, wx = 0.47, wy = 0.17) {
  for (let i = 0; i < 4; i++) {
    const f = (tijd * 0.35 + i / 4 + (seed % 7) / 7) % 1;
    c.fillStyle = rgba('200,200,200', 0.45 * (1 - f));
    c.beginPath();
    c.arc(x + f * s * (0.04 + 0.24 * wx), y - f * s * (0.55 - 0.15 * wy), s * (0.04 + f * 0.09), 0, Math.PI * 2);
    c.fill();
  }
}

function ster(c, x, y, r, kleur) {
  c.fillStyle = kleur;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

function rails(c, x0, x1, y, s) {
  const S = B.S;
  if (B.lod >= 1) {
    c.strokeStyle = '#6a5a48';
    c.lineWidth = lijn(S, 0.006);
    c.beginPath();
    for (let xx = x0; xx < x1; xx += S * 0.025) { c.moveTo(xx, y - S * 0.014); c.lineTo(xx, y + S * 0.014); }
    c.stroke();
  }
  c.strokeStyle = '#9aa0a6';
  c.lineWidth = lijn(S, 0.003);
  c.beginPath(); c.moveTo(x0, y - S * 0.009); c.lineTo(x1, y - S * 0.009); c.moveTo(x0, y + S * 0.009); c.lineTo(x1, y + S * 0.009); c.stroke();
}

function spoorwagons(c, x0, y, n, kleur, lading) {
  const S = B.S;
  for (let i = 0; i < n; i++) {
    const wx = x0 + i * S * 0.1;
    rect(c, wx + S * 0.004, y - S * 0.016, S * 0.09, S * 0.036, 'rgba(0,0,0,0.3)');
    rect(c, wx, y - S * 0.02, S * 0.09, S * 0.036, kleur);
    if (lading) rect(c, wx + S * 0.01, y - S * 0.014, S * 0.07, S * 0.024, lading);
  }
}

// ---------- pakket D: gevels en daken ----------

const GORDIJN = ['#e8dcc4', '#c9b48a', '#a8463a', '#d8d4cc', '#6d7f99', '#b9a07a', '#8a6a5a'];
const DEUREN = ['#5a3b28', '#2f4a5e', '#6b2a24', '#2f5d3a', '#3a3a3a', '#7a5a2e'];
const WINKEL = ['#c0392b', '#2e86c1', '#27ae60', '#d35400', '#7d4fa0', '#e0a020', '#1f7a7a'];

// Gevelleven: voordeur met stoepje, winkels met luifel en uithangbord op de begane grond, balkons erboven.
function gevel(c, x, y0, w, v, fh, o) {
  const S = B.S, yb = y0 + v * fh;
  if (o.winkels && vanaf(D9) && v >= 2) winkelPui(c, x, yb - fh, w, fh);
  else if (o.schuin && vanaf(D7) && w > S * 0.03) {
    const dw = Math.min(S * 0.011, w * 0.16), h = plekHash(x, y0, 3), dx = x + w * (0.3 + 0.4 * h);
    rect(c, dx - dw * 0.25, yb - S * 0.0015, dw * 1.5, S * 0.003, '#c4bcaa');
    rect(c, dx, yb - fh * 0.64, dw, fh * 0.62, DEUREN[Math.floor(h * 997) % DEUREN.length]);
    if (vanaf(D11)) rect(c, dx + dw * 0.68, yb - fh * 0.36, Math.max(0.4, dw * 0.16), Math.max(0.4, dw * 0.16), '#d8c070');
    // buitenlamp naast de deur bij ongeveer de helft van de huizen: brandt 's nachts
    if (vanaf(D13) && plekHash(x, y0, 7) < 0.5) levendNieuw(L_DEURLICHT, dx + dw * 1.4, yb - fh * 0.5);
    // lichtsnoer langs de dakgoot: brandt alleen in december en de eerste dagen van januari, 's avonds
    if (vanaf(D9) && plekHash(x, y0, 19) < 0.3 + 0.15 * B.wv) levendB(L_SNOER, x + w * 0.04, y0 + fh * 0.06, w * 0.92, 0, Math.floor(plekHash(x, y0, 20) * 999));
  }
  if (o.balkons && vanaf(D9) && v >= 3) balkons(c, x, y0, w, v, fh, o);
}

function winkelPui(c, x, y, w, fh) {
  const S = B.S, n = Math.max(1, Math.round(w / (S * 0.05))), bw = w / n;
  if (vanaf(D11)) levendB(L_SNOER, x + bw * 0.04, y + fh * 0.36, w - bw * 0.08, 0, Math.floor(plekHash(x, y, 24) * 999));
  for (let i = 0; i < n; i++) {
    const bx = x + i * bw, h = plekHash(bx, y, 5), kleur = WINKEL[Math.floor(h * WINKEL.length)];
    const hr = plekHash(bx, y, 25);
    if (vanaf(D13) && hr < (B.wv === 0 ? 0.45 : 0.08)) {
      // leegstand of failliet: het rolluik blijft dicht
      rolluik(c, bx + bw * 0.08, y + fh * 0.32, bw * 0.84, fh * 0.6);
    } else {
      rect(c, bx + bw * 0.08, y + fh * 0.32, bw * 0.84, fh * 0.6, '#34444f');
      raamVast(bx + bw * 0.08, y + fh * 0.32, bw * 0.84, fh * 0.6);
      // 's avonds gaan bij een deel van de winkels de rolluiken een voor een naar beneden
      if (vanaf(D13) && hr > 0.5) levendB(L_ROLLUIK, bx + bw * 0.08, y + fh * 0.32, bw * 0.84, fh * 0.6, Math.floor(hr * 9973));
    }
    // luifel met schaduw op de stoep; vanaf D11 gestreept
    rect(c, bx + bw * 0.04, y + fh, bw * 0.92, fh * 0.45, 'rgba(0,0,0,0.16)');
    rect(c, bx + bw * 0.04, y + fh * 0.1, bw * 0.92, fh * 0.26, kleur);
    if (vanaf(D11)) { c.fillStyle = 'rgba(255,255,255,0.5)'; for (let k = 0; k < 4; k++) c.fillRect(bx + bw * (0.04 + k * 0.23), y + fh * 0.1, bw * 0.115, fh * 0.26); }
    // uithangbord haaks op de gevel: alleen kleur en een vorm, geen naam of merk
    if (h > 0.35) {
      rect(c, bx + bw * 0.88, y - fh * 0.3, Math.max(0.5, S * 0.002), fh * 0.3, '#3a3a3a');
      rect(c, bx + bw * 0.88 - S * 0.004, y - fh * 0.26, S * 0.009, fh * 0.2, tint(kleur, 1.25));
    }
  }
}

function balkons(c, x, y0, w, v, fh, o) {
  const S = B.S, kol = Math.max(1, Math.floor(w / (S * (o.raamAfstand ?? 0.028)))), kw = w / kol;
  c.fillStyle = 'rgba(232,229,220,0.92)';
  for (let f = 0; f < v - 1; f++) for (let k = f % 2; k < kol; k += 2) c.fillRect(x + k * kw + kw * 0.08, y0 + f * fh + fh * 0.78, kw * 0.84, fh * 0.16);
  if (vanaf(D11)) {
    c.strokeStyle = 'rgba(40,40,40,0.4)';
    c.lineWidth = lijn(S, 0.0015);
    c.beginPath();
    for (let f = 0; f < v - 1; f++) for (let k = f % 2; k < kol; k += 2) { const by = y0 + f * fh + fh * 0.8; c.moveTo(x + k * kw + kw * 0.08, by); c.lineTo(x + k * kw + kw * 0.92, by); }
    c.stroke();
  }
  if (vanaf(D13)) {
    // plantenbakken op een deel van de balkons
    for (let f = 0; f < v - 1; f++) for (let k = f % 2; k < kol; k += 2) {
      const h = plekHash(x + k * kw, y0 + f * fh, 6);
      if (h < 0.3) { c.fillStyle = h < 0.12 ? '#c0392b' : '#4f7a3a'; rond(c, x + k * kw + kw * 0.25, y0 + f * fh + fh * 0.84, Math.max(0.5, fh * 0.1)); }
      else if (h > 0.9 && B.blad !== 'k') levendB(L_WAS, x + k * kw + kw * 0.14, y0 + f * fh + fh * 0.82, kw * 0.7, 0, Math.floor(h * 100));
      else if (h > 0.4 && h < (B.strak ? 0.6 : 0.47)) schotel(c, x + k * kw + kw * 0.8, y0 + f * fh + fh * 0.78, fh * 0.16);
    }
  }
}

// Extra's op een schuin dak: sneeuw, zonnepanelen op het zuidvlak, dakraam op het noordvlak, antenne.
function schuinExtras(c, x, y, w, d, liggend) {
  const S = B.S, h = plekHash(x, y, 9);
  if (B.sneeuw) sneeuwDak(c, x, y, w, d, liggend);
  const zonKans = (B.strak ? 0.08 : 0.26) + 0.12 * B.wv + (B.regime === 'democratie' ? 0.1 : 0);
  if (vanaf(D9) && h < zonKans && w > S * 0.03) {
    const px = liggend ? x + w * 0.44 : x + w * 0.56, py = liggend ? y + d * 0.57 : y + d * 0.1, pw = liggend ? w * 0.24 : w * 0.34, pd = liggend ? d * 0.33 : d * 0.38;
    rect(c, px, py, pw, pd, '#24384f');
    rect(c, px, py, pw, Math.max(0.4, S * 0.002), 'rgba(180,210,240,0.55)');
    if (vanaf(D11)) {
      c.strokeStyle = 'rgba(150,180,215,0.35)';
      c.lineWidth = lijn(S, 0.0012);
      c.beginPath();
      for (let k = 1; k < 4; k++) { c.moveTo(px + (pw * k) / 4, py); c.lineTo(px + (pw * k) / 4, py + pd); }
      c.moveTo(px, py + pd / 2); c.lineTo(px + pw, py + pd / 2);
      c.stroke();
    }
  }
  if (vanaf(D11) && h > 0.55) {
    const rw = Math.min(w * 0.14, S * 0.012), rd = Math.min(d * 0.22, S * 0.01);
    const rx = liggend ? x + w * 0.6 : x + w * 0.18, ry = liggend ? y + d * 0.16 : y + d * 0.6;
    rect(c, rx, ry, rw, rd, '#c9cfd4');
    rect(c, rx + rw * 0.15, ry + rd * 0.15, rw * 0.7, rd * 0.7, GLAS);
    raamVast(rx + rw * 0.15, ry + rd * 0.15, rw * 0.7, rd * 0.7);
  }
  if (vanaf(D13) && h > 0.78 && h < 0.92) schotel(c, liggend ? x + w * 0.12 : x + w * 0.78, liggend ? y + d * 0.72 : y + d * 0.14, S * 0.0055);
  if (vanaf(D13) && h > 0.3 && h < 0.5) {
    const ax = x + w * 0.3, ay = liggend ? y + d * 0.5 : y + d * 0.3;
    c.strokeStyle = '#4a4f55';
    c.lineWidth = lijn(S, 0.0015);
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax, ay - S * 0.03);
    for (let k = 0; k < 3; k++) { const ty = ay - S * (0.012 + k * 0.007); c.moveTo(ax - S * 0.008, ty); c.lineTo(ax + S * 0.008, ty); }
    c.stroke();
  }
}

// Sneeuw op een schuin dak: het noordvlak houdt hem langer vast dan het zonnige zuidvlak.
function sneeuwDak(c, x, y, w, d, liggend) {
  const n = B.sneeuw;
  c.fillStyle = rgba('246,248,252', [0, 0.45, 0.82, 0.92][n]);
  if (liggend) c.fillRect(x, y, w, d / 2); else c.fillRect(x, y, w / 2, d);
  c.fillStyle = rgba('236,240,246', [0, 0.22, 0.48, 0.74][n]);
  if (liggend) c.fillRect(x, y + d / 2, w, d / 2); else c.fillRect(x + w / 2, y, w / 2, d);
  if (B.lod >= 1 && n >= 2) {
    // gesmolten plek op het zuidvlak: het dak schemert erdoor
    const h = plekHash(x, y, 11);
    c.fillStyle = 'rgba(90,70,60,0.3)';
    c.beginPath();
    if (liggend) c.ellipse(x + w * (0.2 + 0.6 * h), y + d * 0.78, w * 0.12, d * 0.12, 0, 0, Math.PI * 2);
    else c.ellipse(x + w * 0.78, y + d * (0.2 + 0.6 * h), w * 0.12, d * 0.12, 0, 0, Math.PI * 2);
    c.fill();
  }
}

// Extra's op een plat dak: watertank, zonnepanelen of dakramen, antenne met schotel en soms een daktuin.
function platExtras(c, x, y, w, d) {
  const S = B.S, h = plekHash(x, y, 13);
  if (w < S * 0.06 || d < S * 0.04) return;
  if (h < 0.3) {
    const r = Math.min(w, d, S * 0.08) * 0.16, tx = x + w * 0.8, ty = y + d * 0.32;
    c.fillStyle = 'rgba(0,0,0,0.28)'; rond(c, tx + r * 0.6, ty + r * 0.5, r);
    if (vanaf(D11)) { c.strokeStyle = '#3e3a36'; c.lineWidth = lijn(S, 0.002); c.beginPath(); c.moveTo(tx - r * 0.7, ty + r * 0.6); c.lineTo(tx - r * 0.7, ty + r * 1.3); c.moveTo(tx + r * 0.7, ty + r * 0.6); c.lineTo(tx + r * 0.7, ty + r * 1.3); c.stroke(); }
    c.fillStyle = '#7a644e'; rond(c, tx, ty, r);
    c.fillStyle = '#93795e'; rond(c, tx - r * 0.12, ty - r * 0.12, r * 0.72);
    c.fillStyle = '#5a4a3a'; rond(c, tx, ty, r * 0.25);
  } else if (h < 0.6) {
    const rijen = Math.max(1, Math.min(4, Math.floor(d / (S * 0.022)))), pw = w * 0.5;
    for (let i = 0; i < rijen; i++) {
      const py = y + d * 0.12 + i * S * 0.02;
      rect(c, x + w * 0.1 + S * 0.002, py + S * 0.003, pw, S * 0.011, 'rgba(0,0,0,0.25)');
      rect(c, x + w * 0.1, py, pw, S * 0.011, '#24384f');
      rect(c, x + w * 0.1, py, pw, Math.max(0.4, S * 0.0018), 'rgba(180,210,240,0.55)');
    }
  } else if (h < 0.8) {
    for (let i = 0; i < 3; i++) {
      const rx = x + w * (0.2 + i * 0.22), ry = y + d * 0.55, rw = Math.min(w * 0.12, S * 0.02), rd = Math.min(d * 0.18, S * 0.012);
      rect(c, rx, ry, rw, rd, '#c9cfd4');
      rect(c, rx + rw * 0.12, ry + rd * 0.15, rw * 0.76, rd * 0.7, '#6c8796');
      raamVast(rx + rw * 0.12, ry + rd * 0.15, rw * 0.76, rd * 0.7);
    }
  }
  if (vanaf(D11) && h > 0.45 && h < 0.75) {
    const ax = x + w * 0.15, ay = y + d * 0.3;
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = lijn(S, 0.002);
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + S * 0.02, ay + S * 0.014); c.stroke();
    c.strokeStyle = '#5a6068';
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax, ay - S * 0.028); c.stroke();
    c.fillStyle = '#d6dadd';
    c.beginPath(); c.ellipse(ax + S * 0.006, ay - S * 0.02, S * 0.007, S * 0.005, -0.6, 0, Math.PI * 2); c.fill();
  }
  // daktuin: vaker in een welvarend land, dan ook in de strakke regimes
  if (vanaf(D11) && h > (B.wv === 2 ? 0.8 : 0.86) && (!B.strak || B.wv === 2) && B.blad !== 'k') {
    rect(c, x + w * 0.55, y + d * 0.6, w * 0.3, d * 0.28, '#5f8a45');
    c.fillStyle = '#3f6b3a';
    for (let i = 0; i < 4; i++) rond(c, x + w * (0.58 + i * 0.07), y + d * (0.68 + (i % 2) * 0.1), Math.min(w, d) * 0.035);
    if (vanaf(D13)) {
      // plantenbakken langs de rand en een pad van tegels
      rect(c, x + w * 0.55, y + d * 0.6, w * 0.3, Math.max(0.5, S * 0.002), '#8a6a4a');
      c.fillStyle = B.blad === 'h' ? '#c9902f' : '#e8a0b8';
      for (let i = 0; i < 5; i++) rond(c, x + w * (0.57 + i * 0.06), y + d * 0.63, Math.max(0.5, S * 0.0022));
      rect(c, x + w * 0.69, y + d * 0.6, w * 0.03, d * 0.28, '#c9bfa8');
    }
  }
  // dakterras met parasols, alleen in de zomer; ligt links onderaan, waar de andere dakdingen niet staan
  const terras = vanaf(D11) && B.blad === 'z' && !B.sneeuw && (h < 0.3 || h >= 0.8) && w > S * 0.08 && (!B.strak || B.wv === 2)
    && plekHash(x, y, 33) < 0.22 + 0.14 * B.wv;
  if (terras) dakTerras(c, x + w * 0.06, y + d * 0.58, w * 0.36, d * 0.34);
  // rijk land: ook op de daken met een watertank nog twee rijen zonnepanelen (niet waar een terras ligt)
  if (vanaf(D11) && B.wv === 2 && h < 0.3 && !terras && d > S * 0.06) {
    for (let i = 0; i < 2; i++) {
      const py = y + d * 0.12 + i * S * 0.02;
      rect(c, x + w * 0.1 + S * 0.002, py + S * 0.003, w * 0.4, S * 0.011, 'rgba(0,0,0,0.25)');
      rect(c, x + w * 0.1, py, w * 0.4, S * 0.011, '#24384f');
      rect(c, x + w * 0.1, py, w * 0.4, Math.max(0.4, S * 0.0018), 'rgba(180,210,240,0.55)');
    }
  }
}

// ---------- pakket D: straat en tuin ----------

// Lantaarnpaal op de stoep: paal en kap gebakken, het licht brandt 's nachts als levend deel.
function lantaarn(c, x, y, armDx, armDy) {
  const S = B.S;
  c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = lijn(S, 0.003);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + S * 0.02, y + S * 0.013); c.stroke();
  c.strokeStyle = '#3a3f44'; c.lineWidth = lijn(S, 0.0025);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + armDx, y + armDy); c.stroke();
  c.fillStyle = '#2c3034'; rond(c, x, y, Math.max(0.5, S * 0.003));
  c.fillStyle = '#c8ccd0'; rond(c, x + armDx, y + armDy, Math.max(0.5, S * 0.0035));
  levendNieuw(L_LANTAARN, x + armDx, y + armDy);
}

function bankje(c, x, y, liggend) {
  const S = B.S, l = S * 0.022, b = S * 0.007, w = liggend ? l : b, h = liggend ? b : l;
  rect(c, x - w / 2 + S * 0.002, y - h / 2 + S * 0.002, w, h, 'rgba(0,0,0,0.25)');
  rect(c, x - w / 2, y - h / 2, w, h, '#7a5a3a');
  if (vanaf(D11)) { c.fillStyle = '#5a4028'; if (liggend) c.fillRect(x - w / 2, y - h / 2, w, h * 0.3); else c.fillRect(x - w / 2, y - h / 2, w * 0.3, h); }
}

function prullenbak(c, x, y) {
  const S = B.S;
  c.fillStyle = 'rgba(0,0,0,0.25)'; rond(c, x + S * 0.002, y + S * 0.002, S * 0.0045);
  c.fillStyle = '#2f5d3a'; rond(c, x, y, S * 0.0045);
  c.fillStyle = '#1e3a26'; rond(c, x, y, S * 0.0025);
}

// Fietsenrek met een paar gekleurde fietsen.
function fietsenrek(c, x, y, n, liggend) {
  const S = B.S, stap = S * 0.008;
  c.strokeStyle = '#8c949c'; c.lineWidth = lijn(S, 0.0015);
  c.beginPath();
  if (liggend) { c.moveTo(x, y); c.lineTo(x + n * stap, y); } else { c.moveTo(x, y); c.lineTo(x, y + n * stap); }
  c.stroke();
  c.lineWidth = lijn(S, 0.0018);
  for (let i = 0; i < n; i++) {
    if (plekHash(x + i, y, 17) < 0.3) continue;
    c.strokeStyle = AUTOS[Math.floor(plekHash(x, y + i, 18) * AUTOS.length)];
    c.beginPath();
    if (liggend) { c.moveTo(x + i * stap + stap * 0.5, y - S * 0.008); c.lineTo(x + i * stap + stap * 0.5, y + S * 0.008); } else { c.moveTo(x - S * 0.008, y + i * stap + stap * 0.5); c.lineTo(x + S * 0.008, y + i * stap + stap * 0.5); }
    c.stroke();
  }
}

// Straatmeubilair langs het straatkruis, trapsgewijs: lantaarns (D7), banken, prullenbakken, fietsen,
// putdeksels en verkeersborden (D9), paaltjes, bushokje en brandkraan (D11), stoeptegels en olievlekken (D13).
// Alles staat op de stoepband buiten het looppad (±0.045·s) of plat op het asfalt. 'plein' is de halve maat van
// een plein op de kruising (hoofdstad: 0.15): daar komen geen sneeuwwallen, borden, paaltjes of putdeksels.
function straatMeubels(c, x, y, s, plein = 0) {
  if (!vanaf(D7)) return;
  const z = 0.055, vrij = Math.max(0.07, plein);
  for (const f of [-0.42, -0.22, 0.22, 0.42]) {
    const kant = f < 0 ? -1 : 1, arm = s * 0.012;
    lantaarn(c, x + f * s, y + kant * z * s, 0, -kant * arm);
    lantaarn(c, x - kant * z * s, y + f * s, kant * arm, 0);
  }
  if (B.sneeuw >= 2) {
    // sneeuwwallen langs de stoeprand: de straat zelf is geveegd
    c.strokeStyle = rgba('240,244,250', 0.75);
    c.lineWidth = lijn(s, 0.006);
    c.beginPath();
    for (const d of [-0.034, 0.034]) {
      c.moveTo(x - s / 2, y + d * s); c.lineTo(x - s * vrij, y + d * s); c.moveTo(x + s * vrij, y + d * s); c.lineTo(x + s / 2, y + d * s);
      c.moveTo(x + d * s, y - s / 2); c.lineTo(x + d * s, y - s * vrij); c.moveTo(x + d * s, y + s * vrij); c.lineTo(x + d * s, y + s / 2);
    }
    c.stroke();
  }
  if (!vanaf(D9)) return;
  for (let i = 0; i < 4; i++) {
    const f = [-0.33, 0.33][i % 2], kant = i < 2 ? -1 : 1, h = hash(B.seed, i, 33);
    if (h < 0.7) bankje(c, x + f * s, y + kant * 0.05 * s, true);
    prullenbak(c, x + (f + 0.03) * s, y + kant * 0.05 * s);
    if (h > 0.4) fietsenrek(c, x + kant * 0.05 * s, y + (f - 0.04) * s, 4, false);
  }
  // putdeksels op het asfalt
  c.fillStyle = '#2e2f2d';
  for (const f of [-0.28, 0.14, 0.36]) { if (Math.abs(f) < vrij) continue; rond(c, x + f * s, y + s * 0.012, s * 0.005); rond(c, x - s * 0.012, y + f * s, s * 0.005); }
  // verkeersborden bij de kruising: rond, alleen kleur (niet op een plein)
  if (!plein) for (const [dx, dy, k] of [[-0.08, -0.05, '#c0392b'], [0.08, 0.05, '#2e6eb5']]) {
    c.strokeStyle = '#6a6e72'; c.lineWidth = lijn(s, 0.0015);
    c.beginPath(); c.moveTo(x + dx * s, y + dy * s); c.lineTo(x + dx * s, y + dy * s - s * 0.016); c.stroke();
    c.fillStyle = k; rond(c, x + dx * s, y + dy * s - s * 0.018, s * 0.005);
  }
  if (!vanaf(D11)) return;
  // paaltjes op de hoeken en een brandkraan
  c.fillStyle = '#4a4e52';
  if (!plein) for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let i = 0; i < 3; i++) rond(c, x + dx * s * (0.066 + i * 0.008), y + dy * s * 0.058, s * 0.0022);
  c.fillStyle = '#c0392b'; rond(c, x + s * Math.max(0.12, vrij + 0.03), y - s * 0.05, s * 0.0035);
  // bushokje: glas met een dak
  const bx = x + s * 0.26, by = y + s * 0.048;
  rect(c, bx + s * 0.003, by + s * 0.003, s * 0.03, s * 0.009, 'rgba(0,0,0,0.25)');
  rect(c, bx, by, s * 0.03, s * 0.009, 'rgba(170,200,215,0.75)');
  rect(c, bx, by, s * 0.03, s * 0.002, '#6a6e72');
  if (!vanaf(D13)) return;
  // stoeptegels en een paar olievlekken op het asfalt
  c.strokeStyle = 'rgba(0,0,0,0.08)'; c.lineWidth = lijn(s, 0.001);
  c.beginPath();
  for (let f = -0.5; f < 0.5; f += 0.012) {
    if (Math.abs(f) < Math.max(0.065, plein)) continue;
    for (const d of [-0.046, 0.046]) { c.moveTo(x + f * s, y + d * s + Math.sign(d) * s * 0.016); c.lineTo(x + f * s, y + d * s); c.moveTo(x + d * s, y + f * s); c.lineTo(x + d * s + Math.sign(d) * s * 0.016, y + f * s); }
  }
  c.stroke();
  c.fillStyle = 'rgba(20,20,20,0.18)';
  for (let i = 0; i < 3; i++) {
    const f = (hash(B.seed, i, 34) - 0.5) * 0.8;
    if (Math.abs(f) < plein) continue;
    c.beginPath(); c.ellipse(x + s * f, y + s * 0.01, s * 0.008, s * 0.004, 0, 0, Math.PI * 2); c.fill();
  }
}

// Tuinextra in een vrij vlak (x, y, w, h): zwembadje, trampoline, moestuin, waslijn, tuinset of schommel.
function tuinExtra(c, x, y, w, h, keuze) {
  const S = B.S, winter = B.blad === 'k';
  if (keuze < 0.2 && !B.strak) {
    // zwembadje met witte rand; in de winter afgedekt
    const pw = Math.min(w * 0.8, S * 0.05), ph = Math.min(h * 0.7, S * 0.03), px = x + (w - pw) / 2, py = y + (h - ph) / 2;
    rect(c, px - S * 0.003, py - S * 0.003, pw + S * 0.006, ph + S * 0.006, '#e8e4da');
    rect(c, px, py, pw, ph, winter ? '#5c6f7a' : '#3fa7c4');
    if (!winter) { rect(c, px, py, pw, ph * 0.25, 'rgba(255,255,255,0.3)'); levendNieuw(L_GLINS, px, py, pw, ph, 5); }
  } else if (keuze < 0.38) {
    const r = Math.min(w, h, S * 0.04) * 0.4, tx = x + w / 2, ty = y + h / 2;
    c.fillStyle = 'rgba(0,0,0,0.22)'; rond(c, tx + r * 0.3, ty + r * 0.3, r);
    c.fillStyle = '#2e6eb5'; rond(c, tx, ty, r);
    c.fillStyle = '#1c1f22'; rond(c, tx, ty, r * 0.82);
    if (B.sneeuw >= 2) { c.fillStyle = rgba('240,244,250', 0.8); rond(c, tx, ty, r * 0.7); }
  } else if (keuze < 0.58) {
    // moestuin: rijen aarde met plantjes; kaal in de winter
    for (let i = 0; i < 4; i++) {
      const ry = y + (h * i) / 4;
      rect(c, x, ry + h * 0.04, w, h * 0.16, '#6b5440');
      if (!winter) { c.fillStyle = i % 2 ? '#5e9a3e' : '#7fae4a'; for (let k = 0; k < 5; k++) rond(c, x + w * (0.1 + k * 0.2), ry + h * 0.12, Math.max(0.5, h * 0.06)); }
    }
  } else if (keuze < 0.76) {
    // waslijn tussen twee palen met wasgoed; vanaf D13 waait het wasgoed als levend deel
    const lx0 = x + w * 0.1, lx1 = x + w * 0.9, ly = y + h * 0.5;
    c.strokeStyle = '#d8d8d0'; c.lineWidth = lijn(S, 0.0012);
    c.beginPath(); c.moveTo(lx0, ly); c.lineTo(lx1, ly); c.stroke();
    c.fillStyle = '#6a5a48'; rond(c, lx0, ly, Math.max(0.5, S * 0.0025)); rond(c, lx1, ly, Math.max(0.5, S * 0.0025));
    if (!winter) {
      if (vanaf(D13)) levendNieuw(L_WAS, lx0, ly, lx1 - lx0, 0, Math.floor(keuze * 100));
      else for (let i = 0; i < 4; i++) rect(c, lx0 + (lx1 - lx0) * (0.1 + i * 0.22), ly, (lx1 - lx0) * 0.12, S * 0.008, WINKEL[(i + Math.floor(keuze * 50)) % WINKEL.length]);
    }
  } else if (keuze < 0.9) {
    // tuinset, met parasol in de zomer
    const tx = x + w / 2, ty = y + h / 2;
    c.fillStyle = '#d8d2c2'; rond(c, tx, ty, S * 0.006);
    c.fillStyle = '#5a4a3a'; for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) rond(c, tx + dx * S * 0.01, ty + dy * S * 0.01, S * 0.0025);
    if (B.blad === 'z') { c.fillStyle = 'rgba(0,0,0,0.2)'; rond(c, tx + S * 0.008, ty + S * 0.006, S * 0.014); c.fillStyle = WINKEL[Math.floor(keuze * 70) % WINKEL.length]; rond(c, tx, ty, S * 0.013); }
  } else {
    // schommel: een rek met twee zitjes
    const sx = x + w * 0.2, sy = y + h * 0.4, sw = Math.min(w * 0.6, S * 0.03);
    c.strokeStyle = '#8a6a43'; c.lineWidth = lijn(S, 0.002);
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + sw, sy); c.stroke();
    rect(c, sx + sw * 0.25, sy + S * 0.004, S * 0.004, S * 0.002, '#c0392b');
    rect(c, sx + sw * 0.65, sy + S * 0.004, S * 0.004, S * 0.002, '#2e6eb5');
  }
}

// Bloemenrand langs een hek: kleurig in voorjaar en zomer, herfsttinten in de herfst, niets in de winter.
function bloemenrand(c, x, y, w) {
  if (B.blad === 'k' || B.blad === 'l') return;
  const S = B.S, n = Math.max(3, Math.floor(w / (S * 0.008)));
  const kleuren = B.blad === 'h' ? ['#c9902f', '#a84a2a', '#d1a43a'] : ['#e74c3c', '#f1c40f', '#ecf0f1', '#9b59b6', '#e67e22'];
  for (let i = 0; i < n; i++) { c.fillStyle = kleuren[(i * 7 + B.seed) % kleuren.length]; rond(c, x + (w * (i + 0.5)) / n, y, Math.max(0.5, S * 0.0028)); }
}

// Sneeuwvlekken op gras: in hartje winter ligt het laagland half wit, niet als één vlakte.
function sneeuwVlekken(c, x, y, w, h) {
  if (B.sneeuw < 2) return;
  c.fillStyle = rgba('242,245,250', B.sneeuw >= 3 ? 0.7 : 0.5);
  const n = B.lod >= 1 ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const hx = plekHash(x + i, y, 21), hy = plekHash(x, y + i, 22);
    c.beginPath();
    c.ellipse(x + w * (0.15 + 0.7 * hx), y + h * (0.15 + 0.7 * hy), w * (0.12 + 0.1 * hy), h * (0.1 + 0.1 * hx), 0, 0, Math.PI * 2);
    c.fill();
  }
}

// Park: gras, kronkelpad, vijver met fontein, bomen, banken, bloemperk, speeltuintje en eenden.
function park(c, qx, qy, qw, qh, kw) {
  const S = B.S, winter = B.blad === 'k';
  rect(c, qx + qw * 0.02, qy + qh * 0.02, qw * 0.96, qh * 0.96, GRAS_LICHT);
  sneeuwVlekken(c, qx, qy, qw, qh);
  c.strokeStyle = '#c9bfa0'; c.lineWidth = lijn(S, 0.012);
  c.beginPath(); c.moveTo(qx + qw * 0.02, qy + qh * 0.8); c.quadraticCurveTo(qx + qw * 0.5, qy + qh * 0.2, qx + qw * 0.98, qy + qh * 0.7); c.stroke();
  const vx = qx + qw * 0.5, vy = qy + qh * 0.62, vr = Math.min(qw, qh) * 0.2;
  c.fillStyle = '#c4bca8';
  c.beginPath(); c.ellipse(vx, vy, vr * 1.08, vr * 0.78, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = winter && B.sneeuw >= 2 ? '#c8d8e0' : '#3f7f95';
  c.beginPath(); c.ellipse(vx, vy, vr, vr * 0.7, 0, 0, Math.PI * 2); c.fill();
  if (B.lod >= 1) { c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.ellipse(vx - vr * 0.3, vy - vr * 0.3, vr * 0.4, vr * 0.12, 0, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = '#9a9488'; rond(c, vx, vy, vr * 0.16);
  levendNieuw(L_FONTEIN, vx, vy, vr * 0.5);
  if (vanaf(D11) && !winter) { levendNieuw(L_EEND, vx, vy, vr * 0.65, vr * 0.42, kw); levendNieuw(L_EEND, vx, vy, vr * 0.5, vr * 0.32, kw + 3); }
  const bomen = [4, 6, 8][B.lod];
  for (let i = 0; i < bomen; i++) {
    const a = (i / bomen) * Math.PI * 2 + hash(B.seed, kw, 72);
    boom(c, vx + Math.cos(a) * qw * 0.38, vy - qh * 0.12 + Math.sin(a) * qh * 0.3, S * (0.022 + 0.01 * hash(B.seed, kw * 10 + i, 73)));
  }
  if (vanaf(D9)) {
    bankje(c, qx + qw * 0.28, qy + qh * 0.46, true);
    bankje(c, qx + qw * 0.74, qy + qh * 0.44, true);
    prullenbak(c, qx + qw * 0.34, qy + qh * 0.46);
    lantaarn(c, qx + qw * 0.15, qy + qh * 0.66, 0, -S * 0.01);
    lantaarn(c, qx + qw * 0.86, qy + qh * 0.6, 0, -S * 0.01);
    if (!winter) { c.fillStyle = '#6b5440'; c.beginPath(); c.ellipse(qx + qw * 0.2, qy + qh * 0.25, qw * 0.08, qh * 0.05, 0, 0, Math.PI * 2); c.fill(); bloemenrand(c, qx + qw * 0.13, qy + qh * 0.25, qw * 0.14); }
  }
  if (vanaf(D11)) {
    // speeltuintje met glijbaan en zandbak
    c.fillStyle = '#d8c896'; rond(c, qx + qw * 0.82, qy + qh * 0.2, S * 0.014);
    rect(c, qx + qw * 0.7, qy + qh * 0.14, S * 0.006, S * 0.02, '#c0392b');
    rect(c, qx + qw * 0.7, qy + qh * 0.14, S * 0.01, S * 0.005, '#f0b429');
  }
}

// Bouwplaats in een groeiende wijk: zand, fundering, half opgetrokken blok in de steigers, keten, materiaal
// en een torenkraan waarvan de giek draait.
function bouwplaats(c, qx, qy, qw, qh, st) {
  const S = B.S, lod = B.lod;
  rect(c, qx + qw * 0.02, qy + qh * 0.02, qw * 0.96, qh * 0.96, '#b9a47e');
  if (lod >= 1) {
    // bandensporen in het zand
    c.strokeStyle = 'rgba(80,60,40,0.25)'; c.lineWidth = lijn(S, 0.004);
    c.beginPath(); for (let i = 0; i < 3; i++) { c.moveTo(qx + qw * 0.1, qy + qh * (0.75 + i * 0.06)); c.quadraticCurveTo(qx + qw * 0.5, qy + qh * (0.7 + i * 0.06), qx + qw * 0.9, qy + qh * (0.8 + i * 0.05)); } c.stroke();
  }
  // fundering van het volgende blok
  c.strokeStyle = '#8f8b82'; c.lineWidth = lijn(S, 0.008);
  c.strokeRect(qx + qw * 0.55, qy + qh * 0.55, qw * 0.36, qh * 0.3);
  // half opgetrokken blok met steigers
  const bx = qx + qw * 0.1, by = qy + qh * 0.12 + 2 * S * 0.017, bw = qw * 0.5, bd = qh * 0.34;
  pand(c, bx, by, bw, bd, 2, '#a59f94', st.muur, { units: 0, geenRamen: true });
  if (lod >= 1) {
    c.strokeStyle = '#d8a030'; c.lineWidth = lijn(S, 0.0025);
    const top = by - 2 * S * 0.017;
    c.beginPath();
    for (let i = 0; i <= 6; i++) { const sx = bx + (bw * i) / 6; c.moveTo(sx, top - S * 0.004); c.lineTo(sx, by + bd + S * 0.006); }
    for (let j = 0; j < 3; j++) { const sy = by + bd - j * S * 0.012; c.moveTo(bx - S * 0.004, sy); c.lineTo(bx + bw + S * 0.004, sy); }
    c.stroke();
  }
  // bouwketen, container met puin, stapels materiaal
  rect(c, qx + qw * 0.68, qy + qh * 0.14, qw * 0.22, qh * 0.1, '#e8e4da');
  rect(c, qx + qw * 0.68, qy + qh * 0.14, qw * 0.22, qh * 0.025, '#2e6eb5');
  if (lod >= 1) {
    rect(c, qx + qw * 0.68, qy + qh * 0.27, qw * 0.16, qh * 0.08, '#c0392b');
    rect(c, qx + qw * 0.69, qy + qh * 0.285, qw * 0.14, qh * 0.05, '#7a6a5a');
    for (let i = 0; i < 4; i++) rect(c, qx + qw * (0.12 + i * 0.09), qy + qh * 0.62, qw * 0.07, qh * 0.06, i % 2 ? '#a67c52' : '#b0aca2');
  }
  if (vanaf(D9)) {
    // toilethokje, betonmixer en een bouwlamp
    rect(c, qx + qw * 0.92, qy + qh * 0.3, S * 0.008, S * 0.008, '#27ae60');
    c.fillStyle = '#e0b020'; rond(c, qx + qw * 0.4, qy + qh * 0.82, S * 0.01);
    c.fillStyle = '#8a8f96'; rond(c, qx + qw * 0.4, qy + qh * 0.82, S * 0.006);
    levendNieuw(L_LAMP, qx + qw * 0.94, qy + qh * 0.1);
  }
  // bouwhek
  c.strokeStyle = 'rgba(220,220,210,0.8)'; c.lineWidth = lijn(S, 0.002);
  c.setLineDash([S * 0.006, S * 0.003]);
  c.strokeRect(qx + qw * 0.03, qy + qh * 0.03, qw * 0.94, qh * 0.94);
  c.setLineDash([]);
  // voet van de torenkraan; de giek draait per beeld
  const mx = qx + qw * 0.62, my = qy + qh * 0.42;
  rect(c, mx - S * 0.01, my - S * 0.01, S * 0.02, S * 0.02, '#8a8f96');
  levendNieuw(L_BOUWKRAAN, mx, my, Math.min(qw, qh) * 0.6, 0, B.seed % 7);
}

// Windturbine: mast en gondel gebakken (schaduw naar het zuidoosten), de wieken draaien als levend deel.
function windturbine(c, x, y, hoogte) {
  const S = B.S;
  c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = Math.max(0.8, S * 0.006);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + hoogte * 0.75, y + hoogte * 0.5); c.stroke();
  c.fillStyle = '#9a9a92'; rond(c, x, y, S * 0.008);
  c.strokeStyle = '#eef0f2'; c.lineWidth = Math.max(0.8, S * 0.005);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - hoogte); c.stroke();
  c.fillStyle = '#e4e7ea'; rond(c, x, y - hoogte, Math.max(0.8, S * 0.006));
  levendNieuw(L_WIEK, x, y - hoogte, hoogte * 0.5, 0, Math.floor(plekHash(x, y, 23) * 100));
}

// Hoogspanningsmast met draden naar de randen van het vakje.
function hoogspanningsmast(c, x, y, h) {
  const S = B.S;
  c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = lijn(S, 0.003);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + h * 0.75, y + h * 0.5); c.stroke();
  c.strokeStyle = '#a8adb2'; c.lineWidth = lijn(S, 0.0025);
  c.beginPath();
  c.moveTo(x - S * 0.012, y); c.lineTo(x, y - h); c.lineTo(x + S * 0.012, y);
  c.moveTo(x - S * 0.02, y - h * 0.7); c.lineTo(x + S * 0.02, y - h * 0.7);
  c.moveTo(x - S * 0.014, y - h * 0.9); c.lineTo(x + S * 0.014, y - h * 0.9);
  c.stroke();
  if (vanaf(D9)) {
    c.strokeStyle = 'rgba(60,60,60,0.45)'; c.lineWidth = lijn(S, 0.001);
    c.beginPath();
    for (const dx of [-0.02, 0.02]) { c.moveTo(B.cx - S * 0.5, y - h * 0.7 + S * 0.02); c.quadraticCurveTo(x + dx * S - S * 0.15, y - h * 0.6, x + dx * S, y - h * 0.7); c.moveTo(x + dx * S, y - h * 0.7); c.quadraticCurveTo(x + dx * S + S * 0.15, y - h * 0.6, B.cx + S * 0.5, y - h * 0.7 + S * 0.02); }
    c.stroke();
  }
}

// Lopende band: onderstel en rollen gebakken, de vracht schuift per beeld.
function lopendeBand(c, x0, y0, x1, y1) {
  const S = B.S;
  c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = lijn(S, 0.016);
  c.beginPath(); c.moveTo(x0 + S * 0.006, y0 + S * 0.006); c.lineTo(x1 + S * 0.006, y1 + S * 0.006); c.stroke();
  c.strokeStyle = '#3e3f40'; c.lineWidth = lijn(S, 0.013);
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  if (vanaf(D11)) {
    c.strokeStyle = '#6a6c6e'; c.lineWidth = lijn(S, 0.0015);
    c.setLineDash([S * 0.002, S * 0.006]);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.setLineDash([]);
  }
  levendNieuw(L_BAND, x0, y0, x1 - x0, y1 - y0, 0);
}

// ---------- straten en woonwijken ----------

// Straatcontract: kruis door het midden (y = 0 en x = 0, breedte 0.06·s) met stoepen tot 0.062·s; daar staan
// nooit gebouwen, want daar lopen de mensen en rijden de auto's van de levenslaag.
const Z0 = 0.062;

function straten(c, x, y, s) {
  const lod = B.lod;
  c.fillStyle = STOEP;
  c.fillRect(x - s / 2, y - s * Z0, s, s * Z0 * 2);
  c.fillRect(x - s * Z0, y - s / 2, s * Z0 * 2, s);
  c.fillStyle = ASFALT;
  c.fillRect(x - s / 2, y - s * 0.03, s, s * 0.06);
  c.fillRect(x - s * 0.03, y - s / 2, s * 0.06, s);
  if (lod >= 1) {
    c.strokeStyle = 'rgba(0,0,0,0.3)';
    c.lineWidth = lijn(s, 0.003);
    c.beginPath();
    for (const d of [-0.03, 0.03]) {
      c.moveTo(x - s / 2, y + d * s); c.lineTo(x - s * 0.03, y + d * s); c.moveTo(x + s * 0.03, y + d * s); c.lineTo(x + s / 2, y + d * s);
      c.moveTo(x + d * s, y - s / 2); c.lineTo(x + d * s, y - s * 0.03); c.moveTo(x + d * s, y + s * 0.03); c.lineTo(x + d * s, y + s / 2);
    }
    c.stroke();
    c.strokeStyle = 'rgba(240,236,220,0.6)';
    c.setLineDash([s * 0.03, s * 0.025]);
    c.beginPath();
    c.moveTo(x - s / 2, y); c.lineTo(x - s * 0.07, y); c.moveTo(x + s * 0.07, y); c.lineTo(x + s / 2, y);
    c.moveTo(x, y - s / 2); c.lineTo(x, y - s * 0.07); c.moveTo(x, y + s * 0.07); c.lineTo(x, y + s / 2);
    c.stroke();
    c.setLineDash([]);
  }
  if (lod >= 2) {
    // zebrapaden op de vier armen
    c.fillStyle = 'rgba(240,238,228,0.75)';
    const b = s * 0.006, l = s * 0.022;
    for (let i = -2; i <= 2; i++) {
      const o = i * s * 0.011;
      c.fillRect(x - s * 0.085 - l / 2, y + o - b / 2, l, b);
      c.fillRect(x + s * 0.085 - l / 2, y + o - b / 2, l, b);
      c.fillRect(x + o - b / 2, y - s * 0.085 - l / 2, b, l);
      c.fillRect(x + o - b / 2, y + s * 0.085 - l / 2, b, l);
    }
  }
}

// Bomen op de stoeprand langs de straten (alleen lod2), buiten het looppad van ±0.045·s.
function straatBomen(c, x, y, s) {
  if (B.lod < 2) return;
  for (const f of [-0.42, -0.3, -0.18, 0.18, 0.3, 0.42]) {
    for (const z of [-0.08, 0.08]) {
      if (hash(B.seed, Math.round(f * 100), Math.round(z * 100)) < 0.35) continue;
      boom(c, x + f * s, y + z * s, s * 0.018);
      boom(c, x + z * s, y + f * s, s * 0.018);
    }
  }
}

// Eén kwart van een wijk in het vak (qx, qy, qw, qh); de vorm hangt af van regime en bouwniveau.
function wijkKwart(c, qx, qy, qw, qh, st, kw) {
  if (st.blokken) return platen(c, qx, qy, qw, qh, st, kw);
  if (B.niveau >= 3) return bouwblok(c, qx, qy, qw, qh, st, kw);
  if (B.niveau === 2) return rijtjes(c, qx, qy, qw, qh, st, kw);
  return vrijstaand(c, qx, qy, qw, qh, st, kw);
}

// Dichtgetimmerd bij onrust; in een arm of onrustig land (pakket B) staat er ook zonder rellen wat leeg.
const dichtGetimmerd = (id) => (B.onrust && hash(B.seed, id, 7) < 0.15) || (B.wv === 0 && hash(B.seed, id, 7) > 0.92);

// Niveau 1: vrijstaande huizen op vier kavels, elk met tuin, boom en (vanaf lod1) hek, oprit en auto.
function vrijstaand(c, qx, qy, qw, qh, st, kw) {
  const S = B.S, lod = B.lod, kx = qw / 2, ky = qh / 2;
  for (let i = 0; i < 4; i++) {
    const px = qx + (i % 2) * kx, py = qy + (i >> 1) * ky, id = kw * 4 + i;
    const h1 = hash(B.seed, id, 1), h2 = hash(B.seed, id, 2), h3 = hash(B.seed, id, 3);
    rect(c, px + kx * 0.03, py + ky * 0.03, kx * 0.94, ky * 0.94, h3 < 0.5 ? GRAS : GRAS_LICHT);
    sneeuwVlekken(c, px + kx * 0.03, py + ky * 0.03, kx * 0.94, ky * 0.94);
    if (lod >= 1) hekje(c, px + kx * 0.04, py + ky * 0.04, kx * 0.92, ky * 0.92);
    if (vanaf(D11)) bloemenrand(c, px + kx * 0.08, py + ky * 0.075, kx * 0.84);
    const v = h1 > 0.72 ? 2 : 1, hgt = v * S * 0.017;
    const w = kx * (0.46 + 0.14 * h1), d = ky * (0.34 + 0.1 * h2);
    const links = h2 < 0.5;
    const hx = links ? px + kx * 0.1 : px + kx * 0.9 - w, hy = py + ky * 0.12 + hgt;
    // oprit met auto naast het huis
    if (lod >= 1 && h3 > 0.3) {
      const ox = links ? hx + w + kx * 0.05 : hx - kx * 0.05 - kx * 0.2;
      rect(c, ox, py + ky * 0.12, kx * 0.2, ky * 0.84, BETON);
      if (h3 > 0.5) auto(c, ox + kx * 0.1, py + ky * 0.62, autoKleur(id), false);
      // kliko's bovenaan de oprit, vanaf D13 een fiets ernaast
      if (vanaf(D11)) containers(c, ox + kx * 0.025, py + ky * 0.15, 2 + (h1 > 0.6), false);
      if (vanaf(D13) && h2 > 0.35) fiets(c, ox + kx * 0.15, py + ky * 0.2, false, autoKleur(id + 3));
    }
    if (lod >= 2) {
      // terras en tuinpad
      rect(c, hx + w * 0.15, hy + d + S * 0.004, w * 0.5, ky * 0.1, '#c9bfa8');
      if (h1 > 0.4) pand(c, links ? px + kx * 0.74 : px + kx * 0.1, py + ky * 0.72, kx * 0.16, ky * 0.12, 1, '#7a6a55', '#9a8a70', { geenRamen: true, units: 0 });
    }
    pand(c, hx, hy, w, d, v, st.daken[Math.floor(h2 * 997) % st.daken.length], st.muur, { schuin: !st.plat, dicht: dichtGetimmerd(id) });
    if (st.plat && h1 < 0.25) koepel(c, hx + w / 2, hy - hgt + d / 2, Math.min(w, d) * 0.3, st.accent);
    // achtertuin: zwembadje, trampoline, moestuin, waslijn, tuinset of schommel
    if (vanaf(D9)) tuinExtra(c, links ? px + kx * 0.1 : px + kx * 0.46, py + ky * 0.66, kx * 0.42, ky * 0.26, hash(B.seed, id, 12));
    boom(c, links ? px + kx * 0.72 : px + kx * 0.28, py + ky * 0.8, Math.min(kx, ky) * 0.12);
    if (lod >= 1 && h2 > 0.6) boom(c, links ? px + kx * 0.32 : px + kx * 0.7, py + ky * 0.84, Math.min(kx, ky) * 0.08);
  }
}

// Niveau 2: twee rijtjes met achtertuinen; elke woning eigen dakkleur, schoorsteen en tuinhek.
function rijtjes(c, qx, qy, qw, qh, st, kw) {
  const S = B.S, lod = B.lod, n = 4, v = 2, hgt = v * S * 0.017;
  for (let rij = 0; rij < 2; rij++) {
    const ry = qy + rij * qh * 0.5, rh = qh * 0.5;
    rect(c, qx + qw * 0.03, ry + rh * 0.04, qw * 0.94, rh * 0.32, GRAS);
    sneeuwVlekken(c, qx + qw * 0.03, ry + rh * 0.04, qw * 0.94, rh * 0.32);
    const bw = (qw * 0.94) / n, by = ry + rh * 0.38 + hgt, bd = rh * 0.26;
    for (let i = 0; i < n; i++) {
      const id = kw * 8 + rij * 4 + i, bx = qx + qw * 0.03 + i * bw;
      if (vanaf(D9) && hash(B.seed, id, 12) < 0.7) tuinExtra(c, bx + bw * 0.42, ry + rh * 0.08, bw * 0.5, rh * 0.24, hash(B.seed, id, 13));
      if (lod >= 1) {
        hekje(c, bx, ry + rh * 0.04, bw, rh * 0.32);
        if (hash(B.seed, id, 4) < 0.5) boom(c, bx + bw * 0.5, ry + rh * 0.18, Math.min(bw, rh) * 0.14);
      }
      if (lod >= 2 && hash(B.seed, id, 5) < 0.4) rect(c, bx + bw * 0.1, ry + rh * 0.06, bw * 0.25, rh * 0.1, '#7a6a55');
      pand(c, bx, by, bw, bd, v, st.daken[Math.floor(hash(B.seed, id, 6) * st.daken.length)], st.muur, { schuin: !st.plat, dicht: dichtGetimmerd(id), dakkapel: hash(B.seed, id, 8) < 0.5 });
      if (st.plat && hash(B.seed, id, 9) < 0.12) koepel(c, bx + bw / 2, by - hgt + bd / 2, Math.min(bw, bd) * 0.3, st.accent);
      if (lod >= 1 && hash(B.seed, id, 3) < 0.55) auto(c, bx + bw * 0.5, by + bd + rh * 0.13, autoKleur(id), true, 0.9);
      if (vanaf(D11)) containers(c, bx + bw * 0.8, by + bd + S * 0.003, 2, true);
      if (vanaf(D13) && hash(B.seed, id, 14) < 0.35) fiets(c, bx + bw * 0.12, by + bd + S * 0.008, true, autoKleur(id + 5));
    }
  }
}

// Niveau 3: woonblok van drie tot vijf lagen rond een binnenhof, met trappenhuizen en dakinstallaties.
function bouwblok(c, qx, qy, qw, qh, st, kw) {
  const S = B.S, lod = B.lod, v = 3 + Math.floor(hash(B.seed, kw, 6) * 3), hgt = v * S * 0.017;
  const m = Math.min(qw, qh) * 0.05, bx = qx + m, by = qy + m + hgt, W = qw - 2 * m, H = qh - 2 * m - hgt;
  const dw = Math.min(W, H) * 0.2;
  const dak = st.daken[Math.floor(hash(B.seed, kw, 2) * st.daken.length)];
  // schaduw van het hele blok, dan de hof
  c.fillStyle = 'rgba(0,0,0,0.26)';
  c.fillRect(bx + hgt * 0.75, by - hgt * 0.5, W, H + hgt * 0.5);
  rect(c, bx + dw, by + dw, W - 2 * dw, H - 2 * dw, GRAS);
  sneeuwVlekken(c, bx + dw, by + dw, W - 2 * dw, H - 2 * dw);
  if (vanaf(D9)) {
    // fietsenrek en bankjes in de hof, vanaf D11 ook moestuinbakken
    fietsenrek(c, bx + dw * 1.2, by + dw * 1.3, 6, true);
    bankje(c, bx + W * 0.5, by + dw * 1.4, true);
    if (vanaf(D11)) {
      tuinExtra(c, bx + W - dw * 2.6, by + dw * 1.2, dw * 1.4, dw * 0.8, 0.45);
      // ondergrondse afvalcontainers en een grofvuilbak in de hof
      containers(c, bx + dw * 1.15, by + H - dw * 1.5, 3, true, true);
    }
  }
  if (lod >= 1) {
    const n = lod >= 2 ? 4 : 2;
    for (let i = 0; i < n; i++) boom(c, bx + dw + (W - 2 * dw) * (0.2 + 0.6 * hash(B.seed, kw * 10 + i, 1)), by + dw + (H - 2 * dw) * (0.55 + 0.35 * hash(B.seed, kw * 10 + i, 2)), S * 0.02);
  }
  if (lod >= 2) {
    // speelplek met zandbak in de hof
    c.fillStyle = '#d8c896';
    rond(c, bx + W / 2, by + H - dw - (H - 2 * dw) * 0.25, S * 0.018);
    rect(c, bx + W / 2 + S * 0.03, by + H - dw - (H - 2 * dw) * 0.3, S * 0.012, S * 0.012, '#c0392b');
  }
  const o = { kern: true, geenSchaduw: true, dicht: dichtGetimmerd(kw * 4), balkons: true };
  pand(c, bx, by, W, dw, v, dak, st.muur, o);
  pand(c, bx, by + dw, dw, H - 2 * dw, v, dak, st.muur, o);
  pand(c, bx + W - dw, by + dw, dw, H - 2 * dw, v, dak, st.muur, o);
  pand(c, bx, by + H - dw, W, dw, v, dak, st.muur, { ...o, winkels: true });
  if (st.plat && hash(B.seed, kw, 9) < 0.3) koepel(c, bx + dw / 2, by + H - dw - hgt + dw / 2, dw * 0.35, st.accent);
}

// Eenpartijstaat: lange woonplaten in het groen, hoger naarmate het land groeit.
function platen(c, qx, qy, qw, qh, st, kw) {
  const S = B.S, lod = B.lod, v = [3, 5, 7][B.niveau - 1], hgt = v * S * 0.017;
  rect(c, qx + qw * 0.02, qy + qh * 0.02, qw * 0.96, qh * 0.96, '#6a8a4c');
  const d = qh * 0.15, gat = qh * 0.9 - 2 * (d + hgt);
  const by1 = qy + qh * 0.05 + hgt, by2 = by1 + d + gat + hgt;
  if (lod >= 1) {
    // parkeerstrook of bomen tussen de platen
    if (gat > S * 0.05) {
      rect(c, qx + qw * 0.08, by1 + d + gat * 0.3, qw * 0.84, gat * 0.6, '#55575a');
      for (let i = 0; i < 6; i++) if (hash(B.seed, kw * 10 + i, 3) < 0.7) auto(c, qx + qw * (0.14 + i * 0.14), by1 + d + gat * 0.6, autoKleur(kw * 10 + i), false, 0.85);
    } else {
      for (let i = 0; i < 4; i++) boom(c, qx + qw * (0.15 + i * 0.23), by1 + d + gat * 0.5 + S * 0.01, S * 0.016);
    }
  }
  if (lod >= 2) for (let i = 0; i < 3; i++) boom(c, qx + qw * (0.06 + 0.88 * hash(B.seed, kw, 20 + i)), qy + qh * 0.97, S * 0.015);
  if (vanaf(D11)) {
    // speelplek met klimrek op het gras voor de plaat
    rect(c, qx + qw * 0.7, qy + qh * 0.9, S * 0.03, S * 0.02, '#d8c896');
    c.strokeStyle = '#c0392b'; c.lineWidth = lijn(S, 0.002); c.strokeRect(qx + qw * 0.78, qy + qh * 0.9, S * 0.016, S * 0.016);
  }
  pand(c, qx + qw * 0.06, by1, qw * 0.88, d, v, st.daken[kw % st.daken.length], st.muur, { kern: true, dicht: dichtGetimmerd(kw * 2), balkons: true });
  pand(c, qx + qw * 0.06, by2, qw * 0.88, d, v, st.daken[(kw + 1) % st.daken.length], st.muur, { kern: true, dicht: dichtGetimmerd(kw * 2 + 1), balkons: true, winkels: kw < 2 });
}

function kwartVak(x, y, s, kx, ky) {
  return [kx < 0 ? x - s * 0.5 : x + s * Z0, ky < 0 ? y - s * 0.5 : y + s * Z0, s * (0.5 - Z0), s * (0.5 - Z0)];
}

// ---------- regeringsgebouwen in de hoofdstad ----------
// De hoofdstad: het kruis met een plein in het midden (daar verzamelt de levenslaag protesten), het
// regeringsgebouw in het noordwesten, een voorplein of tuin in het noordoosten en woonwijken in het zuiden.
// (gx, gy) is de linkerbovenhoek van het noordwestvak, (vx, vy) van het noordoostvak; beide g × h groot.

const REGERING = {
  democratie(c, gx, gy, vx, vy, g, h, st) {
    const S = B.S, lod = B.lod, hgt = 3 * S * 0.017;
    rect(c, gx, gy, g, h, GRAS);
    const bx = gx + g * 0.08, by = gy + h * 0.25 + hgt, bw = g * 0.84, bd = h * 0.5;
    pand(c, bx, by, bw, bd, 3, '#9aa5b0', st.muur, { units: 0, raamAfstand: 0.04 });
    zuilen(c, bx, by + bd - hgt, bw, hgt, lod >= 1 ? 10 : 7);
    koepel(c, bx + bw / 2, by - hgt + bd / 2, bd * 0.42, '#8fa9c9');
    if (lod >= 1) { c.fillStyle = 'rgba(255,255,255,0.35)'; for (let i = 0; i < 3; i++) c.fillRect(bx + bw * 0.2, by + bd + S * 0.006 * (i + 1), bw * 0.6, S * 0.003); }
    // voorplein met vlaggenrij en fontein
    rect(c, vx, vy, g, h, PLEIN);
    rect(c, vx + g * 0.06, vy + h * 0.08, g * 0.88, h * 0.3, GRAS);
    for (let i = 0; i < 3; i++) paal(c, vx + g * (0.25 + i * 0.25), vy + h * 0.72, S * 0.09, i === 1 ? 1 : 0);
    if (lod >= 1) {
      c.fillStyle = '#c9c2b2'; rond(c, vx + g * 0.5, vy + h * 0.23, S * 0.035);
      c.fillStyle = '#5d9fb8'; rond(c, vx + g * 0.5, vy + h * 0.23, S * 0.027);
      levendNieuw(L_FONTEIN, vx + g * 0.5, vy + h * 0.23, S * 0.02);
      for (let i = 0; i < 4; i++) boom(c, vx + g * (0.1 + i * 0.27), vy + h * 0.92, S * 0.02);
    }
  },
  eenpartijstaat(c, gx, gy, vx, vy, g, h, st) {
    const S = B.S, lod = B.lod, hgt = 4 * S * 0.017;
    rect(c, gx, gy, g, h, '#9a9a94');
    const bx = gx + g * 0.1, by = gy + h * 0.2 + hgt, bw = g * 0.8, bd = h * 0.55;
    const top = pand(c, bx, by, bw, bd, 4, '#8a8a86', st.muur, { units: 0, raamAfstand: 0.022 });
    rect(c, bx + bw * 0.25, top + bd * 0.2, bw * 0.5, bd * 0.6, '#a2a29d');
    if (lod >= 1) { c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = lijn(S); c.strokeRect(bx + bw * 0.25, top + bd * 0.2, bw * 0.5, bd * 0.6); }
    ster(c, bx + bw / 2, top + bd / 2, bd * 0.22, st.accent);
    // paradeplein met een grote ster in de bestrating en vlaggen in het accent
    rect(c, vx, vy, g, h, '#a7a59c');
    c.globalAlpha = 0.55;
    ster(c, vx + g * 0.5, vy + h * 0.45, h * 0.3, st.accent);
    c.globalAlpha = 1;
    for (let i = 0; i < (lod >= 1 ? 4 : 2); i++) paal(c, vx + g * (0.12 + i * (lod >= 1 ? 0.25 : 0.76)), vy + h * 0.9, S * 0.08, 1);
    if (lod >= 2) { c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = lijn(S, 0.002); for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(vx + g * i / 6, vy); c.lineTo(vx + g * i / 6, vy + h); c.stroke(); } }
  },
  militair(c, gx, gy, vx, vy, g, h, st) {
    const S = B.S, lod = B.lod, hgt = 2 * S * 0.017;
    rect(c, gx, gy, g, h, '#8a8a76');
    const bx = gx + g * 0.12, by = gy + h * 0.25 + hgt, bw = g * 0.76, bd = h * 0.5;
    const top = pand(c, bx, by, bw, bd, 2, '#6b6b55', st.muur, { units: 0, raamAfstand: 0.04 });
    ster(c, bx + bw / 2, top + bd / 2, bd * 0.4, '#8f8f73');
    ster(c, bx + bw / 2, top + bd / 2, bd * 0.24, '#a8a888');
    paal(c, bx + bw * 0.9, top + bd * 0.2, S * 0.1, 1);
    rect(c, vx, vy, g, h, '#9a9a8a');
    const n = lod >= 1 ? 4 : 3;
    for (let i = 0; i < n; i++) tankje(c, vx + g * (0.15 + i * 0.7 / (n - 1)), vy + h * 0.3);
    for (let i = 0; i < n; i++) vrachtwagen(c, vx + g * (0.15 + i * 0.7 / (n - 1)), vy + h * 0.68, '#5d6b4a', false, '#6b7a55');
    if (lod >= 2) { c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = lijn(S, 0.003); c.strokeRect(vx + g * 0.05, vy + h * 0.08, g * 0.9, h * 0.84); }
  },
  monarchie(c, gx, gy, vx, vy, g, h, st) {
    const S = B.S, lod = B.lod, hgt = 3 * S * 0.017;
    rect(c, gx, gy, g, h, GRAS_LICHT);
    // paleis in U-vorm rond een erehof, met paviljoens op de hoeken
    const bx = gx + g * 0.08, by = gy + h * 0.12 + hgt, bw = g * 0.84, bd = h * 0.26;
    rect(c, bx + bw * 0.22, by + bd, bw * 0.56, h * 0.36, '#d8ccb4');
    pand(c, bx, by + bd, bw * 0.2, h * 0.4, 2, st.daken[0], st.muur, { schuin: true });
    pand(c, bx + bw * 0.8, by + bd, bw * 0.2, h * 0.4, 2, st.daken[0], st.muur, { schuin: true });
    pand(c, bx, by, bw, bd, 3, st.daken[0], st.muur, { schuin: true, raamAfstand: 0.03 });
    for (const [dx, dy] of [[0, 0], [1, 0]]) koepel(c, bx + dx * bw, by - hgt + dy * bd + bd * 0.5, bd * 0.32, st.daken[0]);
    paal(c, bx + bw / 2, by - hgt + bd * 0.4, S * 0.09, 1);
    // formele tuin met heggen, grindpaden en een fontein
    rect(c, vx, vy, g, h, GRIND);
    c.fillStyle = HEG;
    for (const [px, py] of [[0.08, 0.1], [0.56, 0.1], [0.08, 0.56], [0.56, 0.56]]) c.fillRect(vx + g * px, vy + h * py, g * 0.36, h * 0.34);
    if (lod >= 1) {
      c.fillStyle = '#6f9a52';
      for (const [px, py] of [[0.08, 0.1], [0.56, 0.1], [0.08, 0.56], [0.56, 0.56]]) c.fillRect(vx + g * (px + 0.05), vy + h * (py + 0.05), g * 0.26, h * 0.24);
      for (let i = 0; i < 4; i++) boom(c, vx + g * (0.12 + i * 0.25), vy + h * 0.96, S * 0.018);
    }
    c.fillStyle = '#c9c2b2'; rond(c, vx + g * 0.5, vy + h * 0.5, S * 0.035);
    c.fillStyle = '#5d9fb8'; rond(c, vx + g * 0.5, vy + h * 0.5, S * 0.026);
    levendNieuw(L_FONTEIN, vx + g * 0.5, vy + h * 0.5, S * 0.02);
  },
  // Huis van de Orde: ommuurde vierkante hof met één eenvoudige koepel, een spiegelvijver en vier lantaarnpalen.
  // Bewust zonder torens, maansikkels, kruisen, sterren, uivormige daken of schrift (inhoudsregel AGENTS.md §5.4).
  theocratie(c, gx, gy, vx, vy, g, h, st) {
    const S = B.S, lod = B.lod;
    rect(c, gx, gy, g, h, GRAS_LICHT);
    const m = Math.min(g, h) * 0.86, hx = gx + (g - m) / 2, hy = gy + (h - m) / 2;
    const wand = S * 0.022;
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(hx + wand, hy + wand, m, m);
    rect(c, hx, hy, m, m, st.muur);
    rect(c, hx + wand, hy + wand, m - wand * 2, m - wand * 2, '#e9dfc8');
    rect(c, hx + m * 0.4, hy + m - wand, m * 0.2, wand, '#e9dfc8'); // poort aan de zuidkant
    if (lod >= 1) {
      // zuilengang langs de binnenkant van de muur
      c.strokeStyle = tint(st.muur, 0.82);
      c.lineWidth = lijn(S, 0.004);
      c.strokeRect(hx + wand * 1.8, hy + wand * 1.8, m - wand * 3.6, m - wand * 3.6);
      for (const [dx, dy] of [[0.22, 0.22], [0.78, 0.22], [0.22, 0.78], [0.78, 0.78]]) boom(c, hx + m * dx, hy + m * dy, S * 0.018);
    }
    const kb = m * 0.5;
    pand(c, hx + (m - kb) / 2, hy + (m - kb) / 2 + 2 * S * 0.017, kb, kb, 2, st.daken[0], st.muur, { units: 0, raamAfstand: 0.03 });
    koepel(c, hx + m / 2, hy + m / 2, kb * 0.46, st.accent);
    // spiegelvijver met vier lantaarnpalen op de hoeken
    rect(c, vx, vy, g, h, GRAS_LICHT);
    const px = vx + g * 0.18, py = vy + h * 0.2, pw = g * 0.64, ph = h * 0.6;
    rect(c, px - S * 0.01, py - S * 0.01, pw + S * 0.02, ph + S * 0.02, st.muur);
    rect(c, px, py, pw, ph, '#5d93a8');
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.fillRect(px + pw * 0.1, py + ph * 0.15, pw * 0.8, ph * 0.08);
    if (lod >= 2) { c.strokeStyle = HEG; c.lineWidth = lijn(S, 0.01); c.strokeRect(vx + g * 0.06, vy + h * 0.06, g * 0.88, h * 0.88); }
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const lx = px - S * 0.02 + dx * (pw + S * 0.04), ly = py - S * 0.02 + dy * (ph + S * 0.04);
      c.fillStyle = 'rgba(0,0,0,0.25)'; rond(c, lx + S * 0.006, ly + S * 0.005, S * 0.009);
      c.fillStyle = '#efe6cf'; rond(c, lx, ly, S * 0.009);
      levend(L_KAARS, lx, ly - S * 0.004);
    }
  },
};

// Zuilen op een zuidgevel: lichte banen met schaduw ertussen.
function zuilen(c, x, y, w, h, n) {
  const S = B.S;
  const stap = w / n;
  for (let i = 0; i < n; i++) {
    rect(c, x + i * stap + stap * 0.2, y, stap * 0.32, h, '#f2ece0');
    rect(c, x + i * stap + stap * 0.52, y, stap * 0.12, h, 'rgba(0,0,0,0.22)');
  }
  if (B.lod >= 1) rect(c, x, y, w, Math.max(0.6, S * 0.004), '#f8f4ea');
}

// Plein op het kruispunt van de hoofdstad; het blijft vrij van gebouwen.
function plein(c, x, y, s) {
  const m = s * 0.15;
  rect(c, x - m, y - m, m * 2, m * 2, PLEIN);
  if (B.lod >= 1) {
    c.strokeStyle = 'rgba(0,0,0,0.14)';
    c.lineWidth = lijn(s, 0.003);
    c.strokeRect(x - m * 0.7, y - m * 0.7, m * 1.4, m * 1.4);
    c.beginPath(); c.arc(x, y, m * 0.35, 0, Math.PI * 2); c.stroke();
  }
  if (B.lod >= 2) {
    // bankjes op de hoeken
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rect(c, x + dx * m * 0.82 - s * 0.012, y + dy * m * 0.82 - s * 0.004, s * 0.024, s * 0.008, '#7a5a3a');
  }
  if (vanaf(D7)) monument(c, x, y, s);
  if (vanaf(D9)) for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) lantaarn(c, x + dx * m * 0.95, y + dy * m * 0.6, 0, -s * 0.012);
}

// Oorlog: zandzakken rond het regeringsgebouw en slagbomen op de vier toegangswegen.
function oorlogsstand(c, x, y, s, gx, gy, g, h) {
  const S = B.S, n = B.lod >= 1 ? 28 : 16;
  c.fillStyle = '#a89470';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    c.beginPath();
    c.ellipse(gx + g / 2 + Math.cos(a) * g * 0.46, gy + h / 2 + Math.sin(a) * h * 0.52, S * 0.014, S * 0.009, a, 0, Math.PI * 2);
    c.fill();
  }
  for (const [dx, dy] of [[-0.3, 0], [0.3, 0], [0, -0.3], [0, 0.3]]) {
    const bx = x + dx * s, by = y + dy * s, staand = dx !== 0;
    const w = staand ? s * 0.012 : s * 0.08, hh = staand ? s * 0.08 : s * 0.012;
    rect(c, bx - w / 2, by - hh / 2, w, hh, '#f2f2ef');
    c.fillStyle = '#d9443c';
    for (let i = 0; i < 4; i += 2) { if (staand) c.fillRect(bx - w / 2, by - hh / 2 + (i * hh) / 4, w, hh / 4); else c.fillRect(bx - w / 2 + (i * w) / 4, by - hh / 2, w / 4, hh); }
  }
  if (B.lod >= 1) pand(c, x + s * 0.34, y - s * 0.12, s * 0.06, s * 0.05, 1, '#5d6b4a', '#7a7a62', { units: 0 }); // wachthuisje
}

// ---------- pakket D: blikvangers in de hoofdstad ----------
// Het zuidoostvak van de hoofdstad krijgt een herkenbaar gebouw per regime (archetypen, geen echte plekken
// en geen gebedshuizen): centraal station, monumentplein met erepoort, stadion, ministerie, Hof van Raden.
// (lx, ly) is de linkerbovenhoek van het vak, lw × lh de maat.

const LANDMERK = {
  democratie(c, lx, ly, lw, lh, st) {
    // centraal station: glazen hal, klokkentoren, perrons met kappen; de treinen rijden als levend deel
    const S = B.S, lod = B.lod;
    rect(c, lx, ly, lw, lh, PLEIN);
    const sy0 = ly + lh * 0.5;
    rect(c, lx, sy0, lw, lh * 0.48, '#7d776c');
    for (let i = 0; i < 3; i++) {
      const ty = sy0 + lh * (0.08 + i * 0.15);
      rails(c, lx, lx + lw, ty, S);
      if (i < 2) {
        rect(c, lx + lw * 0.04, ty + lh * 0.04, lw * 0.92, lh * 0.055, '#b8b1a1');
        if (lod >= 1) { rect(c, lx + lw * 0.1, ty + lh * 0.045, lw * 0.8, lh * 0.045, 'rgba(120,135,150,0.65)'); rect(c, lx + lw * 0.1, ty + lh * 0.045, lw * 0.8, Math.max(0.5, S * 0.002), 'rgba(220,230,240,0.6)'); }
      }
      if (vanaf(D9) || i === 0) levendNieuw(L_TREIN, lx, ty, lw, 0, i);
    }
    const hx = lx + lw * 0.06, hy = ly + lh * 0.08 + 2 * S * 0.017, hw = lw * 0.88, hd = lh * 0.3;
    const top = pand(c, hx, hy, hw, hd, 2, '#9aa5b0', st.muur, { units: 0, raamAfstand: 0.03 });
    rect(c, hx + hw * 0.18, top, hw * 0.64, hd, '#a9bcc6');
    raamVast(hx + hw * 0.2, top + hd * 0.1, hw * 0.6, hd * 0.8);
    if (lod >= 1) {
      c.strokeStyle = 'rgba(60,75,90,0.5)'; c.lineWidth = lijn(S, 0.002);
      c.beginPath(); for (let k = 1; k < 10; k++) { const bx = hx + hw * (0.18 + (0.64 * k) / 10); c.moveTo(bx, top); c.lineTo(bx, top + hd); } c.stroke();
    }
    const top2 = pand(c, hx + hw * 0.03, hy - hd * 0.05, hw * 0.1, hd * 0.55, 6, '#7c8a99', st.muur, { units: 0, raamAfstand: 0.03 });
    if (vanaf(D9)) { c.fillStyle = '#f2ece0'; rond(c, hx + hw * 0.08, top2 + hd * 0.55 + S * 0.02, S * 0.008); c.fillStyle = '#2a2e33'; rond(c, hx + hw * 0.08, top2 + hd * 0.55 + S * 0.02, S * 0.0015); }
    if (vanaf(D9)) {
      // taxi's en een bus voor de ingang, fietsen bij het station
      for (let i = 0; i < 4; i++) auto(c, hx + hw * (0.3 + i * 0.1), ly + lh * 0.46, '#e8c22a', true, 0.8);
      vrachtwagen(c, hx + hw * 0.78, ly + lh * 0.46, '#2e86c1', true, '#2e86c1');
      fietsenrek(c, hx + hw * 0.05, ly + lh * 0.44, 8, true);
    }
  },
  monarchie(c, lx, ly, lw, lh, st) {
    // monumentplein met erepoort, fonteinen, formele perken en lantaarns
    const S = B.S, lod = B.lod, mx = lx + lw / 2, my = ly + lh / 2;
    rect(c, lx, ly, lw, lh, PLEIN);
    if (lod >= 1) {
      c.strokeStyle = 'rgba(0,0,0,0.1)'; c.lineWidth = lijn(S, 0.003);
      c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; c.moveTo(mx, my); c.lineTo(mx + Math.cos(a) * lw * 0.5, my + Math.sin(a) * lh * 0.5); } c.stroke();
      c.beginPath(); c.ellipse(mx, my, lw * 0.3, lh * 0.32, 0, 0, Math.PI * 2); c.stroke();
    }
    for (const [fx, fy] of [[0.04, 0.06], [0.72, 0.06], [0.04, 0.74], [0.72, 0.74]]) {
      rect(c, lx + lw * fx, ly + lh * fy, lw * 0.24, lh * 0.2, HEG);
      rect(c, lx + lw * (fx + 0.02), ly + lh * (fy + 0.03), lw * 0.2, lh * 0.14, GRAS_LICHT);
      if (vanaf(D9)) bloemenrand(c, lx + lw * (fx + 0.03), ly + lh * (fy + 0.1), lw * 0.18);
    }
    const bw = lw * 0.24, bd = lh * 0.14, bx = mx - bw / 2, hgt = 4 * S * 0.017, by = my - bd / 2 + hgt;
    const top = pand(c, bx, by, bw, bd, 4, '#d8ccb0', '#e6dcc4', { units: 0, geenRamen: true });
    rect(c, mx - bw * 0.14, by + bd - hgt * 0.75, bw * 0.28, hgt * 0.75, '#5a5045');
    if (lod >= 1) { rect(c, bx, top + bd * 0.2, bw, bd * 0.12, tint('#d8ccb0', 0.85)); rect(c, bx + bw * 0.08, by + bd - hgt * 0.9, bw * 0.06, hgt * 0.9, '#efe6d2'); rect(c, bx + bw * 0.86, by + bd - hgt * 0.9, bw * 0.06, hgt * 0.9, '#efe6d2'); }
    if (B.sneeuw) { c.fillStyle = rgba('246,248,252', 0.7); c.fillRect(bx, top, bw, bd); }
    for (const dx of [-0.32, 0.32]) {
      const fx = mx + dx * lw, fy = my + lh * 0.05;
      c.fillStyle = '#c9c2b2'; rond(c, fx, fy, S * 0.03);
      c.fillStyle = B.sneeuw >= 2 ? '#c8d8e0' : '#5d9fb8'; rond(c, fx, fy, S * 0.023);
      levendNieuw(L_FONTEIN, fx, fy, S * 0.018);
    }
    if (vanaf(D7)) for (const [fx, fy] of [[0.3, 0.1], [0.7, 0.1], [0.3, 0.9], [0.7, 0.9]]) lantaarn(c, lx + lw * fx, ly + lh * fy, 0, -S * 0.01);
    if (vanaf(D11)) for (const fx of [0.12, 0.88]) {
      // beelden op sokkels: anonieme figuren, geen bestaande personen
      rect(c, lx + lw * fx - S * 0.008, my - S * 0.008, S * 0.016, S * 0.016, '#cfc8b8');
      c.fillStyle = '#5f6b5a'; rond(c, lx + lw * fx, my - S * 0.004, S * 0.005);
    }
  },
  eenpartijstaat(c, lx, ly, lw, lh, st) {
    // stadion voor massabijeenkomsten: tribunes in het accent, veld met maaipatroon, lichtmasten
    const S = B.S, lod = B.lod, mx = lx + lw / 2, my = ly + lh / 2, rx = lw * 0.46, ry = lh * 0.44, hgt = 3 * S * 0.017;
    rect(c, lx, ly, lw, lh, '#9a9a94');
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath(); c.ellipse(mx + hgt * 0.75, my + hgt * 0.5, rx, ry, 0, 0, Math.PI * 2); c.fill();
    const ringen = [['#b0b0aa', 1], [tint(st.accent, 0.75), 0.9], ['#8a8a86', 0.8], [tint(st.accent, 1.15), 0.7]];
    for (const [k, f] of ringen) { c.fillStyle = k; c.beginPath(); c.ellipse(mx, my - hgt * (1 - f), rx * f, ry * f, 0, 0, Math.PI * 2); c.fill(); }
    if (lod >= 1) {
      c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = lijn(S, 0.0015);
      for (const f of [0.95, 0.85, 0.75]) { c.beginPath(); c.ellipse(mx, my - hgt * (1 - f), rx * f, ry * f, 0, 0, Math.PI * 2); c.stroke(); }
    }
    const vx = mx - rx * 0.48, vy = my - ry * 0.42, vw = rx * 0.96, vh = ry * 0.84;
    rect(c, vx, vy, vw, vh, B.sneeuw >= 2 ? '#dfe6e8' : '#4f9a48');
    if (vanaf(D9) && B.sneeuw < 2) { c.fillStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i < 6; i += 2) c.fillRect(vx + (vw * i) / 6, vy, vw / 6, vh); }
    if (lod >= 1) {
      c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = lijn(S, 0.0018);
      c.strokeRect(vx + vw * 0.04, vy + vh * 0.06, vw * 0.92, vh * 0.88);
      c.beginPath(); c.moveTo(mx, vy + vh * 0.06); c.lineTo(mx, vy + vh * 0.94); c.stroke();
      c.beginPath(); c.arc(mx, my, vh * 0.16, 0, Math.PI * 2); c.stroke();
    }
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = mx + dx * rx * 0.86, py = my + dy * ry * 0.86;
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = lijn(S, 0.004);
      c.beginPath(); c.moveTo(px, py); c.lineTo(px + S * 0.06, py + S * 0.04); c.stroke();
      c.strokeStyle = '#c8ccd0'; c.lineWidth = lijn(S, 0.004);
      c.beginPath(); c.moveTo(px, py); c.lineTo(px, py - S * 0.06); c.stroke();
      rect(c, px - S * 0.008, py - S * 0.066, S * 0.016, S * 0.008, '#e8ecef');
      levendNieuw(L_SCHIJN, px, py - S * 0.062, S * 0.07);
    }
  },
  militair(c, lx, ly, lw, lh, st) {
    // ministerie van defensie: H-vormig blok, helikopterplatform, radarkoepel en een marcherende eenheid
    const S = B.S, lod = B.lod, hgt = 3 * S * 0.017;
    rect(c, lx, ly, lw, lh, '#8a8a76');
    const bx = lx + lw * 0.05, by = ly + lh * 0.08 + hgt, bh = lh * 0.5;
    pand(c, bx, by, lw * 0.12, bh, 3, '#6b6b55', st.muur, { raamAfstand: 0.03 });
    pand(c, bx + lw * 0.12, by + bh * 0.38, lw * 0.22, bh * 0.24, 3, '#6b6b55', st.muur, { raamAfstand: 0.03 });
    pand(c, bx + lw * 0.34, by, lw * 0.12, bh, 3, '#6b6b55', st.muur, { raamAfstand: 0.03 });
    const hx = lx + lw * 0.76, hy = ly + lh * 0.3, hr = Math.min(lw, lh) * 0.16;
    c.fillStyle = '#4d5155'; rond(c, hx, hy, hr);
    if (lod >= 1) { c.fillStyle = '#e8e4c8'; c.fillRect(hx - hr * 0.35, hy - hr * 0.4, hr * 0.14, hr * 0.8); c.fillRect(hx + hr * 0.21, hy - hr * 0.4, hr * 0.14, hr * 0.8); c.fillRect(hx - hr * 0.35, hy - hr * 0.07, hr * 0.7, hr * 0.14); }
    levendNieuw(L_HELI, hx, hy, hr);
    koepel(c, lx + lw * 0.9, ly + lh * 0.82, S * 0.03, '#e8eaec');
    c.strokeStyle = '#8f9690'; c.lineWidth = lijn(S, 0.004);
    c.beginPath(); c.moveTo(lx + lw * 0.62, ly + lh * 0.9); c.lineTo(lx + lw * 0.62, ly + lh * 0.9 - S * 0.05); c.stroke();
    levendNieuw(L_RADAR, lx + lw * 0.62, ly + lh * 0.9 - S * 0.05, S * 0.022);
    rect(c, lx + lw * 0.04, ly + lh * 0.7, lw * 0.5, lh * 0.24, '#9a9a8a');
    if (vanaf(D7)) levendNieuw(L_MARS, lx + lw * 0.06, ly + lh * 0.72, lw * 0.46, lh * 0.2, 0);
    paal(c, lx + lw * 0.58, ly + lh * 0.7, S * 0.08, 1);
  },
  // Hof van Raden: lange zuilengang rond een hof met een rechthoekig waterbekken, bomenrijen en lantaarns.
  // Een raadsgebouw, geen gebedshuis: geen torens, symbolen of schrift.
  theocratie(c, lx, ly, lw, lh, st) {
    const S = B.S, lod = B.lod, hgt = 2 * S * 0.017;
    rect(c, lx, ly, lw, lh, GRAS_LICHT);
    const bx = lx + lw * 0.06, by = ly + lh * 0.06 + hgt, bw = lw * 0.88, bd = lh * 0.2;
    pand(c, bx, by, bw, bd, 2, st.daken[1], st.muur, { units: 0, raamAfstand: 0.03 });
    zuilen(c, bx, by + bd - hgt, bw, hgt, lod >= 1 ? 12 : 7);
    pand(c, bx, by + bd, lw * 0.1, lh * 0.5, 1, st.daken[1], st.muur, { units: 0, geenRamen: true });
    pand(c, bx + bw - lw * 0.1, by + bd, lw * 0.1, lh * 0.5, 1, st.daken[1], st.muur, { units: 0, geenRamen: true });
    const wx = lx + lw * 0.3, wy = ly + lh * 0.44, ww = lw * 0.4, wh = lh * 0.14;
    rect(c, wx - S * 0.006, wy - S * 0.006, ww + S * 0.012, wh + S * 0.012, st.muur);
    rect(c, wx, wy, ww, wh, B.sneeuw >= 2 ? '#c8d8e0' : '#5d93a8');
    for (let i = 0; i < 5; i++) { boom(c, lx + lw * (0.24 + i * 0.13), ly + lh * 0.72, S * 0.016); if (lod >= 1) boom(c, lx + lw * (0.24 + i * 0.13), ly + lh * 0.88, S * 0.016); }
    for (const fx of [0.26, 0.74]) { const lx2 = lx + lw * fx, ly2 = wy + wh / 2; c.fillStyle = '#efe6cf'; rond(c, lx2, ly2, S * 0.007); levendNieuw(L_KAARS, lx2, ly2 - S * 0.003); }
  },
};

// Monument midden op het plein van de hoofdstad: sokkel met een anoniem beeld (geen echte persoon).
function monument(c, x, y, s) {
  rect(c, x - s * 0.016 + s * 0.004, y - s * 0.016 + s * 0.004, s * 0.032, s * 0.032, 'rgba(0,0,0,0.25)');
  rect(c, x - s * 0.016, y - s * 0.016, s * 0.032, s * 0.032, '#c9c2b2');
  rect(c, x - s * 0.011, y - s * 0.011, s * 0.022, s * 0.022, '#d8d2c4');
  c.fillStyle = 'rgba(0,0,0,0.3)'; rond(c, x + s * 0.004, y, s * 0.006);
  c.fillStyle = '#5f6b5a'; rond(c, x, y - s * 0.004, s * 0.006);
  if (vanaf(D11)) { c.fillStyle = '#7f8b78'; rond(c, x - s * 0.002, y - s * 0.006, s * 0.0025); }
  if (B.sneeuw >= 2) rect(c, x - s * 0.011, y - s * 0.011, s * 0.022, s * 0.006, '#eef1f5');
}

// ---------- pakket D: extra's per gebouwsoort (gebakken na de basistekening) ----------

const EXTRA = {
  boerderij(c, x, y, s) {
    if (B.sneeuw >= 2) { c.fillStyle = rgba('242,245,250', 0.45); c.fillRect(x - s * 0.5, y - s * 0.5, s, s * 0.47); c.fillRect(x - s * 0.5, y + s * 0.03, s * 0.47, s * 0.47); }
    if (vanaf(D7) && hash(B.seed, 81) < 0.75) windturbine(c, x + s * 0.4, y + s * 0.015, s * 0.3);
    if (!vanaf(D9)) return;
    if (B.blad !== 'k') {
      // hooibalen op het middelste perceel en koeien in de wei
      for (let i = 0; i < 4; i++) {
        const bx = x + s * (-0.12 + 0.24 * hash(B.seed, i, 82)), by = y - s * (0.42 - 0.36 * hash(B.seed, i, 83));
        c.fillStyle = 'rgba(0,0,0,0.25)'; rond(c, bx + s * 0.004, by + s * 0.003, s * 0.011);
        c.fillStyle = '#d4b65a'; rond(c, bx, by, s * 0.011);
        c.fillStyle = '#b89a48'; rond(c, bx, by, s * 0.005);
      }
      for (let i = 0; i < 5; i++) {
        const kx = x - s * (0.44 - 0.38 * hash(B.seed, i, 84)), ky = y + s * (0.06 + 0.16 * hash(B.seed, i, 85));
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(kx + s * 0.003, ky + s * 0.003, s * 0.009, s * 0.005, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#f2f0ea'; c.beginPath(); c.ellipse(kx, ky, s * 0.009, s * 0.005, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#2a2826'; rond(c, kx + s * 0.002, ky - s * 0.001, s * 0.0028);
      }
    }
    if (vanaf(D11)) {
      // kippen op het erf en een voerbak
      c.fillStyle = '#f4f1e8';
      for (let i = 0; i < 6; i++) rond(c, x + s * (0.1 + 0.3 * hash(B.seed, i, 86)), y + s * (0.22 + 0.06 * hash(B.seed, i, 87)), s * 0.0028);
      rect(c, x + s * 0.12, y + s * 0.2, s * 0.03, s * 0.006, '#7a5a3a');
    }
  },
  mijn(c, x, y, s) {
    const S = B.S;
    if (vanaf(D7)) levendNieuw(L_SCHACHT, x + s * 0.34, y - s * 0.26, s * 0.03);
    if (B.lod >= 1) levendNieuw(L_BAND, x + s * 0.138, y - s * 0.125, s * 0.102, -s * 0.201, 3);
    if (!vanaf(D9)) return;
    // ertshopen in twee kleuren en lichtmasten bij de verwerking
    for (const [dx, dy, k] of [[0.43, -0.14, '#5e5246'], [0.43, -0.02, '#7a6248']]) {
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(x + dx * s + S * 0.006, y + dy * s + S * 0.004, s * 0.05, s * 0.035, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = k; c.beginPath(); c.ellipse(x + dx * s, y + dy * s, s * 0.05, s * 0.035, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = tint(k, 1.25); c.beginPath(); c.ellipse(x + dx * s - s * 0.012, y + dy * s - s * 0.01, s * 0.022, s * 0.014, 0, 0, Math.PI * 2); c.fill();
    }
    for (const [dx, dy] of [[-0.45, -0.45], [0.1, 0.42]]) lantaarn(c, x + dx * s, y + dy * s, 0, -s * 0.02);
    if (vanaf(D11)) vrachtwagen(c, x - s * 0.2, y - s * 0.4, '#e0b020', true, '#6e6152');
  },
  houtkap(c, x, y, s) {
    if (!vanaf(D9)) return;
    c.fillStyle = '#c8a46e'; c.beginPath(); c.ellipse(x - s * 0.06, y + s * 0.44, s * 0.05, s * 0.025, 0, 0, Math.PI * 2); c.fill();
    if (B.niveau >= 2) {
      // zagerij met schoorsteen en een band met stammen
      const kx = x + s * 0.4, ky = y + s * 0.2;
      c.fillStyle = '#5a4f46'; rond(c, kx, ky, s * 0.012);
      levendNieuw(L_ROOK, kx, ky, s * 0.5);
      if (vanaf(D11)) lopendeBand(c, x - s * 0.14, y + s * 0.3, x + s * 0.1, y + s * 0.3);
    }
  },
  centrale(c, x, y, s) {
    if (vanaf(D7)) hoogspanningsmast(c, x + s * 0.1, y + s * 0.47, s * 0.12);
    if (!vanaf(D9)) return;
    c.fillStyle = '#2a2826'; c.beginPath(); c.ellipse(x + s * 0.42, y + s * 0.06, s * 0.05, s * 0.035, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3e3a36'; c.beginPath(); c.ellipse(x + s * 0.41, y + s * 0.05, s * 0.025, s * 0.015, 0, 0, Math.PI * 2); c.fill();
    lopendeBand(c, x + s * 0.38, y + s * 0.08, x + s * 0.0, y + s * 0.12);
    if (vanaf(D11)) vrachtwagen(c, x + s * 0.3, y - s * 0.46, '#8e2a24', true, '#c8ccd0');
  },
  zonnepark(c, x, y, s) {
    // de naaf (bovenaan de mast) moet binnen het vakje vallen: de bitmap knipt de mast op de rand af, de wieken
    // tekenen per beeld zonder knip en zouden anders los boven de buurtegel zweven
    if (vanaf(D7) && B.niveau >= 2) { windturbine(c, x + s * 0.455, y - s * 0.1, s * 0.24); windturbine(c, x + s * 0.455, y + s * 0.35, s * 0.24); }
    if (!vanaf(D9)) return;
    for (let i = 0; i < 3; i++) rect(c, x - s * 0.455, y - s * 0.4 + i * s * 0.3, s * 0.025, s * 0.02, '#d8dde2');
    auto(c, x + s * 0.3, y + s * 0.47, '#f2f2ef', true, 0.8);
    if (vanaf(D11) && B.blad !== 'k') {
      // schapen grazen tussen de rijen
      for (let i = 0; i < 6; i++) {
        const sx = x + s * (-0.4 + 0.8 * hash(B.seed, i, 88)), sy = y - s * 0.44 + (Math.floor(hash(B.seed, i, 89) * 4) + 0.86) * ((s * 0.88) / (4 + (B.niveau >= 2 ? 1 : 0)));
        c.fillStyle = '#efece4'; c.beginPath(); c.ellipse(sx, sy, s * 0.006, s * 0.004, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#2a2826'; rond(c, sx + s * 0.005, sy, s * 0.0018);
      }
    }
  },
  industrie(c, x, y, s) {
    if (vanaf(D7)) lopendeBand(c, x + s * 0.16, y - s * 0.015, x + s * 0.46, y - s * 0.015);
    if (!vanaf(D9)) return;
    // stoom uit de dakventilatoren en een pijpenbrug
    levendNieuw(L_STOOM, x - s * 0.3, y - s * 0.16, s * 0.12);
    levendNieuw(L_STOOM, x - s * 0.05, y - s * 0.16, s * 0.1);
    c.strokeStyle = '#7c848c'; c.lineWidth = lijn(s, 0.006);
    c.beginPath(); c.moveTo(x + s * 0.17, y - s * 0.44); c.lineTo(x + s * 0.46, y - s * 0.44); c.stroke();
    if (vanaf(D11)) for (let i = 0; i < 2; i++) { rect(c, x - s * (0.4 - i * 0.12), y + s * 0.2, s * 0.025, s * 0.018, '#e0b020'); rect(c, x - s * (0.4 - i * 0.12) + s * 0.025, y + s * 0.204, s * 0.01, s * 0.01, '#555'); }
  },
  chipfabriek(c, x, y, s) {
    if (!vanaf(D9)) return;
    // twee gastanks naast elkaar boven de hallen (de daken beginnen op y −0.36)
    silo(c, x + s * 0.4, y - s * 0.42, s * 0.025);
    silo(c, x + s * 0.32, y - s * 0.42, s * 0.025);
    levendNieuw(L_STOOM, x - s * 0.1, y - s * 0.3, s * 0.08);
    levendNieuw(L_STATUS, x - s * 0.38, y + s * 0.13, s * 0.4, s * 0.008, 10);
    if (vanaf(D11)) fietsenrek(c, x - s * 0.44, y + s * 0.22, 10, true);
  },
  haven(c, x, y, s) {
    if (!vanaf(D9)) return;
    for (const dx of [-0.46, 0.46]) lantaarn(c, x + dx * s, y + s * 0.09, 0, -s * 0.02);
    if (vanaf(D11)) { rect(c, x + s * 0.02, y - s * 0.16, s * 0.05, s * 0.03, '#c0392b'); rect(c, x + s * 0.07, y - s * 0.155, s * 0.02, s * 0.02, '#2a2e33'); }
  },
  opslag(c, x, y, s) {
    if (vanaf(D9)) lopendeBand(c, x + s * 0.15, y - s * 0.12, x + s * 0.26, y - s * 0.22);
    if (vanaf(D11)) for (let i = 0; i < 2; i++) rect(c, x + s * (0.2 + i * 0.07), y + s * 0.42, s * 0.05, s * 0.04, '#7a5a3a');
  },
  school(c, x, y, s) {
    if (!vanaf(D7)) return;
    // speelplaats in de binnenhoek van het gebouw: klimrek, glijbaan, zandbak, schommels, hinkelbaan
    const px = x - s * 0.25, py = y - s * 0.22, pw = s * 0.27, ph = s * 0.24;
    rect(c, px, py, pw, ph, '#a39d90');
    c.fillStyle = '#d8c896'; rond(c, px + pw * 0.75, py + ph * 0.75, s * 0.03);
    c.strokeStyle = '#c0392b'; c.lineWidth = lijn(s, 0.002);
    c.strokeRect(px + pw * 0.1, py + ph * 0.12, pw * 0.25, ph * 0.25);
    c.beginPath(); c.moveTo(px + pw * 0.1 + pw * 0.125, py + ph * 0.12); c.lineTo(px + pw * 0.225, py + ph * 0.37); c.moveTo(px + pw * 0.1, py + ph * 0.245); c.lineTo(px + pw * 0.35, py + ph * 0.245); c.stroke();
    rect(c, px + pw * 0.5, py + ph * 0.1, pw * 0.06, ph * 0.3, '#2e6eb5');
    if (vanaf(D9)) {
      // doelen op het veld, fietsenrek en een vlaggenmast
      rect(c, x + s * 0.21, y - s * 0.035, s * 0.08, s * 0.008, '#f2f2ef');
      rect(c, x + s * 0.21, y + s * 0.41, s * 0.08, s * 0.008, '#f2f2ef');
      fietsenrek(c, x - s * 0.25, y + s * 0.3, 10, true);
      paal(c, x - s * 0.02, y - s * 0.24, s * 0.08, 0);
    }
    if (vanaf(D11)) {
      c.strokeStyle = '#8a6a43'; c.lineWidth = lijn(s, 0.0025);
      c.beginPath(); c.moveTo(px + pw * 0.1, py + ph * 0.55); c.lineTo(px + pw * 0.45, py + ph * 0.55); c.stroke();
      levendNieuw(L_SCHOMMEL, px + pw * 0.1, py + ph * 0.55, pw * 0.35);
      c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = lijn(s, 0.0015);
      for (let i = 0; i < 4; i++) c.strokeRect(px + pw * 0.62, py + ph * (0.48 + i * 0.1) - ph * 0.3, pw * 0.08, ph * 0.08);
      if (B.lod >= 1) levendNieuw(L_BAL, x + s * 0.09, y - s * 0.01, s * 0.32, s * 0.4);
    }
  },
  universiteit(c, x, y, s) {
    if (!vanaf(D9)) return;
    fietsenrek(c, x - s * 0.28, y + s * 0.47, 14, true);
    bankje(c, x - s * 0.15, y + s * 0.0, true);
    bankje(c, x + s * 0.15, y + s * 0.3, true);
    for (const [dx, dy] of [[-0.25, -0.1], [0.25, -0.1], [-0.25, 0.42], [0.25, 0.42]]) lantaarn(c, x + dx * s, y + dy * s, 0, -s * 0.012);
  },
  ziekenhuis(c, x, y, s) {
    if (B.lod >= 1) levendNieuw(L_HELI, x - s * 0.025, y - s * 0.07, s * 0.09);
    if (!vanaf(D7)) return;
    rect(c, x - s * 0.5, y + s * 0.255, s, s * 0.035, '#55575a');
    levendNieuw(L_VOERTUIG, x - s * 0.44, y + s * 0.272, s * 0.88, 0, 3);
    if (vanaf(D9)) {
      // overkapping bij de ingang en bankjes in de tuin
      rect(c, x - s * 0.12 + s * 0.004, y + s * 0.13, s * 0.14, s * 0.04, 'rgba(0,0,0,0.2)');
      rect(c, x - s * 0.12, y + s * 0.125, s * 0.14, s * 0.035, '#d8dde0');
      bankje(c, x + s * 0.18, y + s * 0.47, true);
      bankje(c, x + s * 0.36, y + s * 0.47, true);
    }
  },
  politie(c, x, y, s) {
    if (!vanaf(D9)) return;
    // radiomast in de vrije zuidoosthoek (het bijgebouw vanaf niveau 2 staat op x 0.26–0.44, y −0.1–0.12)
    c.strokeStyle = '#a8adb2'; c.lineWidth = lijn(s, 0.003);
    c.beginPath(); c.moveTo(x + s * 0.4, y + s * 0.43); c.lineTo(x + s * 0.4, y + s * 0.27); c.stroke();
    levendNieuw(L_KNIPPER, x + s * 0.4, y + s * 0.27, s * 0.8, 0, 2);
  },
  rechtbank(c, x, y, s) {
    if (!vanaf(D9)) return;
    paal(c, x - s * 0.22, y + s * 0.14, s * 0.08, 0);
    paal(c, x + s * 0.22, y + s * 0.14, s * 0.08, 1);
    if (vanaf(D11)) for (const dx of [-0.3, 0.3]) lantaarn(c, x + dx * s, y + s * 0.46, 0, -s * 0.012);
  },
  omroep(c, x, y, s) {
    if (!vanaf(D9)) return;
    vrachtwagen(c, x - s * 0.1, y + s * 0.42, '#f2f2ef', true, '#e8e8e2');
    c.fillStyle = '#d8dde2'; c.beginPath(); c.ellipse(x - s * 0.12, y + s * 0.42, s * 0.012, s * 0.009, 0.5, 0, Math.PI * 2); c.fill();
  },
  kazerne(c, x, y, s) {
    if (vanaf(D7)) levendNieuw(L_MARS, x - s * 0.02, y - s * 0.4, s * 0.42, s * 0.34, 1);
    if (B.lod >= 1) levendNieuw(L_RADAR, x + s * 0.37, y - s * 0.44, s * 0.03);
    if (!vanaf(D9)) return;
    // zandzakken bij de poort en een hindernisbaan
    c.fillStyle = '#a89470';
    for (let i = 0; i < 8; i++) { c.beginPath(); c.ellipse(x - s * 0.1 + i * s * 0.02, y + s * 0.47, s * 0.01, s * 0.006, 0, 0, Math.PI * 2); c.fill(); }
    if (vanaf(D11)) {
      c.strokeStyle = '#6a5a40'; c.lineWidth = lijn(s, 0.004);
      c.beginPath(); for (let i = 0; i < 5; i++) { c.moveTo(x - s * 0.4 + i * s * 0.06, y + s * 0.32); c.lineTo(x - s * 0.4 + i * s * 0.06, y + s * 0.42); } c.stroke();
      c.strokeRect(x - s * 0.42, y + s * 0.3, s * 0.3, s * 0.14);
    }
  },
  wapenfabriek(c, x, y, s) {
    if (B.niveau >= 2 && B.lod >= 1) levendNieuw(L_VOERTUIG, x + s * 0.3, y - s * 0.1, s * 0.1, s * 0.22, 4);
  },
  dronebasis(c, x, y, s) {
    if (B.lod >= 1) levendNieuw(L_RADAR, x + s * 0.18, y - s * 0.38, s * 0.025);
    if (vanaf(D9)) {
      c.strokeStyle = '#d8dcd0'; c.lineWidth = lijn(s, 0.003);
      c.beginPath(); c.moveTo(x + s * 0.4, y - s * 0.16); c.lineTo(x + s * 0.4, y - s * 0.22); c.stroke();
      levendNieuw(L_WINDZAK, x + s * 0.4, y - s * 0.22, s * 0.035);
    }
  },
  cybercentrum(c, x, y, s) {
    if (!vanaf(D9)) return;
    const fans = B.lod >= 2 ? 4 : 2;
    for (let i = 0; i < 4; i++) levendNieuw(L_FAN, x - s * 0.3 + i * s * 0.19, y - s * 0.14, (s * 0.3) / fans, s * 0.03, fans);
    levendNieuw(L_STATUS, x - s * 0.38, y + s * 0.252, s * 0.76, s * 0.01, 14);
    // satellietschotel en camera's op de hoeken van het hek
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(x + s * 0.42, y - s * 0.38, s * 0.03, s * 0.022, 0.6, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e4e7ea'; c.beginPath(); c.ellipse(x + s * 0.41, y - s * 0.39, s * 0.03, s * 0.022, 0.6, 0, Math.PI * 2); c.fill();
    if (vanaf(D11)) { c.fillStyle = '#2a2e33'; for (const [dx, dy] of [[-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46]]) rond(c, x + dx * s, y + dy * s, s * 0.005); }
  },
  kolonie(c, x, y, s) {
    if (!vanaf(D9)) return;
    c.strokeStyle = '#8a6a43'; c.lineWidth = lijn(s, 0.003);
    c.beginPath(); c.moveTo(x - s * 0.2, y - s * 0.1); c.lineTo(x - s * 0.08, y - s * 0.1); c.stroke();
    for (let i = 0; i < 3; i++) rect(c, x - s * (0.19 - i * 0.04), y - s * 0.1, s * 0.025, s * 0.012, '#c8bf9f');
    if (vanaf(D11)) { c.fillStyle = '#f4f1e8'; for (let i = 0; i < 5; i++) rond(c, x + s * (0.12 + 0.1 * hash(B.seed, i, 90)), y - s * (0.02 + 0.1 * hash(B.seed, i, 91)), s * 0.0028); }
  },
};

// ---------- pakket B: daken, gevels en gebouwen in bedrijf ----------
// Bovenop pakket D: nog fijner spul op de gebouwen zelf, vooral op zoom 11–14, en gebouwen die zichtbaar werken.
// Het vaste deel wordt meegebakken; wat beweegt is levend en komt uit een eigen potje per gebouw (MAX_B_GEBOUW).
// Welvaart en rust van het land (alleen gelezen uit ctx.welvaart en ctx.stab) geven drie standen: verval,
// gewoon en verzorgd. Die stand zit, net als het seizoen, in de cachesleutel maar niet in 'vast'.

// Klok van de dag uit ctx.tijd: dezelfde cyclus van drie minuten als de dag en nacht van de kaart (tekenNacht in
// map.js). 0–1 is overdag (zonsopgang tot zonsondergang), 1–2 's nachts (avond tot ochtend).
const CYCLUS = 180;
function klok(t) { const f = frac(t / CYCLUS); return f >= 0.75 ? (f - 0.75) * 2 : f < 0.25 ? (f + 0.25) * 2 : 1 + (f - 0.25) * 2; }
// Hoe ver de nacht is (0 avond, 1 ochtend). Zegt de kaart 'nacht' terwijl de klok dag zegt, dan geldt middernacht.
function nachtUur(t) { const k = klok(t); return k >= 1 ? k - 1 : 0.5; }
// 's nachts -1: dan is niets van de dag (school, appèl) aan de gang.
function dagUur(t) { const k = klok(t); return k < 1 ? k : -1; }
const isOchtend = (t) => { const k = klok(t); return k > 0.04 && k < 0.2; };
// Schooltijd: 0 niemand, 1 les (een paar kinderen buiten), 2 pauze (vol plein), 3 vrij overdag (buurtkinderen).
// Werkdagen buiten de zomer- en kerstvakantie; de speldag 0 is 1 januari.
function schoolStand(dag, t) {
  const u = dagUur(t), d = typeof dag === 'number' && Number.isFinite(dag) ? Math.floor(dag) : 100, j = ((d % 365) + 365) % 365;
  if (u < 0.1 || u > 0.85) return 0;
  if (d % 7 >= 5 || (j >= 196 && j < 238) || j < 3 || j > 357) return u > 0.25 && u < 0.75 ? 3 : 0;
  if (u < 0.14 || u > 0.72) return 0;
  return (u > 0.3 && u < 0.38) || (u > 0.52 && u < 0.6) ? 2 : 1;
}
// December tot en met 4 januari: lichtsnoeren (alleen lichtjes, geen symbolen).
function kerstVan(dag) {
  if (typeof dag !== 'number' || !Number.isFinite(dag)) return false;
  const j = ((Math.floor(dag) % 365) + 365) % 365;
  return j >= 334 || j < 4;
}
let isKerst = false, stNu = STIJL.democratie, dagNu = NaN;
// 0 arm of onrustig (verval), 1 gewoon, 2 welvarend en rustig (verzorgd).
function welzijnVan(ctx) {
  const w = ctx.welvaart ?? 1, st = ctx.stab ?? 60;
  return w < 0.6 || st < 30 ? 0 : w > 1.3 && st >= 55 ? 2 : 1;
}

// Schotelantenne: wit schoteltje schuin naar het zuiden, met de kop in het midden en schaduw naar het zuidoosten.
function schotel(c, x, y, r) {
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath(); c.ellipse(x + r * 0.6, y + r * 0.5, r, r * 0.7, -0.6, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#e4e7ea';
  c.beginPath(); c.ellipse(x, y, r, r * 0.7, -0.6, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#9aa0a6'; rond(c, x + r * 0.2, y + r * 0.15, Math.max(0.4, r * 0.25));
}

// Liftopbouw op het trappenhuis: machinekamer met ventilatieroosters en een deur naar het dak.
function liftOpbouw(c, kx, ky, kw, dak) {
  const S = B.S, lw = kw * 0.52, lh = lw * 0.8, ox = kx + kw * 0.06, oy = ky + kw * 0.06;
  rect(c, ox + lw * 0.3, oy + lh * 0.3, lw, lh, 'rgba(0,0,0,0.2)');
  rect(c, ox, oy, lw, lh, tint(dak, 1.12));
  c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = lijn(S, 0.0008);
  c.beginPath();
  for (let i = 1; i < 4; i++) { const ly = oy + (lh * i) / 4; c.moveTo(ox + lw * 0.12, ly); c.lineTo(ox + lw * 0.88, ly); }
  c.stroke();
  rect(c, kx + kw * 0.66, ky + kw * 0.56, kw * 0.18, kw * 0.34, '#4a4f55');
}

// Op platte woonblokken: afvoerpijpen van de cv-ketels die in de kou dampen, en op hoge blokken een antennemast.
function kernExtras(c, x, y, w, d) {
  const S = B.S, h = plekHash(x, y, 35);
  if (WONEN[B.soort] && w > S * 0.05) {
    for (let i = 0; i < 2; i++) {
      const px = x + w * (0.12 + 0.76 * hash(B.seed, Math.round(h * 1e4), i)), py = y + d * 0.76;
      c.fillStyle = 'rgba(0,0,0,0.25)'; rond(c, px + S * 0.002, py + S * 0.0015, S * 0.003);
      c.fillStyle = '#8f9397'; rond(c, px, py, S * 0.003);
      c.fillStyle = '#3a3c3e'; rond(c, px, py, S * 0.0015);
      if (i === 0) levendB(L_PLUIM, px, py);
    }
  }
  // de mast (met knipperlicht in de top) alleen als de top binnen het eigen vakje blijft
  const mh = S * 0.045;
  if (dakV >= 5 && h < 0.55 && y + d * 0.25 - mh * 1.5 > B.cy - S / 2) {
    const mx = x + w * 0.88, my = y + d * 0.25;
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = lijn(S, 0.002);
    c.beginPath(); c.moveTo(mx, my); c.lineTo(mx + mh * 0.75, my + mh * 0.5); c.stroke();
    c.strokeStyle = 'rgba(200,205,210,0.5)'; c.lineWidth = lijn(S, 0.0008);
    c.beginPath(); c.moveTo(mx, my - mh * 0.7); c.lineTo(mx - S * 0.012, my + S * 0.004); c.moveTo(mx, my - mh * 0.7); c.lineTo(mx + S * 0.01, my + S * 0.006); c.stroke();
    c.strokeStyle = '#8c949c'; c.lineWidth = lijn(S, 0.0025);
    c.beginPath(); c.moveTo(mx, my); c.lineTo(mx, my - mh);
    for (let k = 0; k < 3; k++) { const ty = my - mh * (0.45 + k * 0.18); c.moveTo(mx - S * 0.005, ty); c.lineTo(mx + S * 0.005, ty); }
    c.stroke();
    levendB(L_KNIPPER, mx, my - mh, S * 0.5, 0, Math.floor(h * 8));
  }
}

// Verweerd dak in een arm of onrustig land: mos op de pannen of roest op het platte dak, en een paar gaten.
function verweerd(c, x, y, w, d, schuin) {
  const S = B.S;
  c.fillStyle = schuin ? 'rgba(74,92,48,0.35)' : 'rgba(138,90,58,0.3)';
  for (let i = 0; i < 3; i++) {
    const h1 = plekHash(x + i, y, 36), h2 = plekHash(x, y + i, 37);
    c.beginPath(); c.ellipse(x + w * (0.15 + 0.7 * h1), y + d * (0.15 + 0.7 * h2), w * (0.05 + 0.06 * h2), d * (0.06 + 0.06 * h1), 0, 0, Math.PI * 2); c.fill();
  }
  if (schuin && vanaf(D11)) {
    c.fillStyle = 'rgba(30,24,20,0.55)';
    for (let i = 0; i < 2; i++) c.fillRect(x + w * (0.2 + 0.6 * plekHash(x, y, 40 + i)), y + d * (0.15 + 0.7 * plekHash(x, y, 42 + i)), S * 0.006, S * 0.004);
  }
}

// Dakterras met planken, ligstoelen, plantenbakken en parasols (alleen in de zomer gebakken).
function dakTerras(c, x, y, w, h) {
  const S = B.S;
  rect(c, x, y, w, h, '#a8865a');
  if (vanaf(D13)) {
    c.strokeStyle = 'rgba(60,40,20,0.25)'; c.lineWidth = lijn(S, 0.0008);
    c.beginPath(); for (let i = 1; i < 6; i++) { c.moveTo(x + (w * i) / 6, y); c.lineTo(x + (w * i) / 6, y + h); } c.stroke();
  }
  for (let i = 0; i < 2; i++) rect(c, x + w * (0.12 + i * 0.2), y + h * 0.62, w * 0.1, h * 0.3, '#f2efe6');
  const n = w > S * 0.05 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const px = x + w * (0.3 + i * 0.42), py = y + h * 0.38, r = Math.min(w * 0.22, S * 0.014);
    c.fillStyle = 'rgba(0,0,0,0.22)'; rond(c, px + r * 0.5, py + r * 0.4, r);
    const k = WINKEL[Math.floor(plekHash(px, py, 38) * WINKEL.length)];
    c.fillStyle = k; rond(c, px, py, r);
    // twee lichte banen: het doek vangt de zon uit het noordwesten
    c.fillStyle = tint(k, 1.3);
    c.beginPath(); c.moveTo(px, py); c.arc(px, py, r, -2.6, -1.8); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(px, py); c.arc(px, py, r, -1.0, -0.2); c.closePath(); c.fill();
    c.fillStyle = '#f2efe6'; rond(c, px, py, Math.max(0.4, r * 0.12));
  }
  c.fillStyle = '#4f7a3a';
  for (let i = 0; i < 4; i++) rond(c, x + w * (0.1 + i * 0.27), y + h * 0.08, Math.max(0.5, S * 0.003));
}

function rolluik(c, x, y, w, h) {
  rect(c, x, y, w, h, '#80858a');
  c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = lijn(B.S, 0.0008);
  c.beginPath(); for (let i = 1; i < 5; i++) { c.moveTo(x, y + (h * i) / 5); c.lineTo(x + w, y + (h * i) / 5); } c.stroke();
}

// Kliko's of afvalcontainers in een rij; het deksel vangt het licht. In een arm land staat er een zak naast.
const KLIKO = ['#2f6a3a', '#55595d', '#3a5f8a', '#8a6a2a'];
function containers(c, x, y, n, liggend, groot = false) {
  const S = B.S, b = S * (groot ? 0.011 : 0.0065), stap = b * 1.25;
  for (let i = 0; i < n; i++) {
    const cx = liggend ? x + i * stap : x, cy = liggend ? y : y + i * stap, k = KLIKO[(i + B.seed) % KLIKO.length];
    rect(c, cx + S * 0.0015, cy + S * 0.0015, b, b, 'rgba(0,0,0,0.25)');
    rect(c, cx, cy, b, b, k);
    rect(c, cx, cy, b, b * 0.3, tint(k, 1.25));
    if (B.wv === 0 && vanaf(D13) && i === 0) { c.fillStyle = '#d8d2c0'; rond(c, cx - b * 0.4, cy + b * 0.6, b * 0.32); }
  }
}

// Fiets: twee wielen en een frame in een kleur, schaduw naar het zuidoosten.
function fiets(c, x, y, liggend, kleur) {
  const S = B.S, l = S * 0.009, r = S * 0.0026, dx = liggend ? l / 2 : 0, dy = liggend ? 0 : l / 2;
  c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = lijn(S, 0.0015);
  c.beginPath(); c.moveTo(x - dx + S * 0.002, y - dy + S * 0.0015); c.lineTo(x + dx + S * 0.002, y + dy + S * 0.0015); c.stroke();
  c.strokeStyle = '#2a2e33'; c.lineWidth = lijn(S, 0.0009);
  c.beginPath(); c.arc(x - dx, y - dy, r, 0, Math.PI * 2); c.moveTo(x + dx + r, y + dy); c.arc(x + dx, y + dy, r, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = kleur; c.lineWidth = lijn(S, 0.0014);
  c.beginPath(); c.moveTo(x - dx, y - dy); c.lineTo(x + dx, y + dy); c.stroke();
}

function plantenbak(c, x, y) {
  const S = B.S, b = S * 0.008;
  rect(c, x - b / 2 + S * 0.002, y - b / 2 + S * 0.002, b, b, 'rgba(0,0,0,0.25)');
  rect(c, x - b / 2, y - b / 2, b, b, '#8f8a80');
  c.fillStyle = B.blad === 'k' ? '#2e5538' : '#3f6b3a'; rond(c, x, y - b * 0.1, b * 0.42);
  if (B.blad === 'z' || B.blad === 'b') { c.fillStyle = '#e8a0b8'; rond(c, x - b * 0.15, y - b * 0.25, b * 0.14); }
  if (B.sneeuw >= 2) { c.fillStyle = rgba('245,248,252', 0.8); rond(c, x - b * 0.12, y - b * 0.2, b * 0.22); }
}

function pallet(c, x, y) {
  const S = B.S, w = S * 0.022, h = S * 0.018;
  rect(c, x + S * 0.002, y + S * 0.002, w, h, 'rgba(0,0,0,0.28)');
  rect(c, x, y, w, h, '#9a7448');
  rect(c, x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.75, '#c8b48a');
  if (vanaf(D13)) { rect(c, x + w * 0.1, y + h * 0.42, w * 0.8, Math.max(0.4, h * 0.08), '#a89470'); rect(c, x + w * 0.47, y + h * 0.1, Math.max(0.4, w * 0.06), h * 0.75, '#a89470'); }
}

function steenhoop(c, x, y, r) {
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(x + r * 0.4, y + r * 0.3, r, r * 0.75, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#6e665c'; c.beginPath(); c.ellipse(x, y, r, r * 0.75, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#8a8276'; rond(c, x - r * 0.25, y - r * 0.2, r * 0.5);
  c.fillStyle = '#a39a8c'; rond(c, x - r * 0.4, y - r * 0.35, r * 0.2);
  if (vanaf(D13)) { c.fillStyle = '#5a534a'; for (let i = 0; i < 5; i++) rond(c, x + r * (hash(B.seed, i, 105) - 0.3) * 1.6, y + r * (hash(B.seed, i, 106) - 0.3) * 1.2, Math.max(0.4, r * 0.08)); }
}

function wachthuisje(c, x, y) {
  const S = B.S, b = S * 0.011;
  rect(c, x - b / 2 + S * 0.003, y - b + S * 0.002, b, b, 'rgba(0,0,0,0.25)');
  rect(c, x - b / 2, y - b, b, b, '#e6e2d6');
  c.fillStyle = B.regime === 'democratie' ? '#2c3e5a' : stijlVan(B.regime).accent;
  for (let i = 0; i < 3; i++) c.fillRect(x - b / 2 + (b * i) / 3, y - b, b / 6, b * 0.3);
}

// Per regime: y van de erewacht (deel van h vanaf de bovenkant van het regeringsvak), y van de rij dienstauto's op
// het voorplein (deel van h), en welk uniform.
const REGERING_LEVEN = { democratie: [0.93, 0.82, 0], eenpartijstaat: [0.97, 0.1, 1], militair: [0.9, 0.1, 2], monarchie: [0.95, 0.05, 3], theocratie: [0.965, -1, 4] };
const UNIFORM = [['#2c3e5a', '#1c2433'], ['#5a5f52', '#3a3d34'], ['#4a5340', '#2f3528'], ['#9c2a2a', '#1a1a1a'], ['#ece6d4', '#b9ab84']];
const VUIL = ['#d8d2c0', '#8a9aa8', '#b84a3a', '#e0d8a0', '#6a7a5a', '#c8c4b8'];

// Gebouwen in bedrijf: per soort wat er pas vanaf zoom 9–13 bijkomt (gebakken na pakket D).
const BEDRIJF = {
  hoofdstad(c, x, y, s) {
    if (!vanaf(D9)) return;
    const g = s * (0.5 - Z0), h = s * 0.35, gx = x - s * 0.5, gy = y - s * 0.5, vx = x + s * Z0;
    const r = REGERING_LEVEN[B.regime] ?? REGERING_LEVEN.democratie, wy = gy + h * r[0];
    // erewacht voor de ingang van het regeringsgebouw; vanaf D13 vier man, vanaf D11 met wachthuisjes
    if (vanaf(D11)) for (const kant of [-1, 1]) wachthuisje(c, gx + g * (0.5 + kant * 0.13), wy);
    levendBedrijf(L_WACHT, gx + g * 0.5, wy, g * 0.035, 0, (vanaf(D13) ? 4 : 2) + 8 * r[2]);
    if (!vanaf(D11)) return;
    // zwarte dienstauto's op het voorplein; af en toe rijdt er een voor (niet bij de theocratie: daar ligt een
    // gazon met spiegelvijver, geen verharding)
    const ly = gy + h * r[1];
    if (r[1] >= 0) {
      auto(c, vx + g * 0.1, ly, '#15171a', true, 0.95);
      auto(c, vx + g * 0.23, ly, '#15171a', true, 0.95);
      levendBedrijf(L_LIMO, vx + g * 0.42, ly, g * 0.5, 0, 0);
    }
    // stadion van de eenpartijstaat: publiek op de tribunes op wedstrijddagen
    if (B.regime === 'eenpartijstaat') {
      const lx = x + s * Z0, ly2 = y + s * 0.15, lw = s * (0.5 - Z0), lh = s * 0.35;
      levendBedrijf(L_PUBLIEK, lx + lw / 2, ly2 + lh / 2, lw * 0.46, lh * 0.44, 510);
    }
  },
  industrie(c, x, y, s) {
    if (!vanaf(D11)) return;
    // pallets met dozen naast de oostelijke deur; de heftruck rijdt ze naar binnen, aan de middelste deur
    // steekt een vrachtwagen achteruit in
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) pallet(c, x + s * (0.088 + i * 0.026), y + s * (0.2 + j * 0.022));
    levendBedrijf(L_DOCK, x - s * 0.152, y + s * 0.154, s * 0.17, s * 0.59, 0);
    levendBedrijf(L_HEFTRUCK, x + s * 0.07, y + s * 0.222, -s * 0.042, -s * 0.05, 0);
  },
  opslag(c, x, y, s) {
    if (!vanaf(D11)) return;
    levendBedrijf(L_HEFTRUCK, x - s * 0.36, y + s * 0.315, 0, -s * 0.14, 0);
    if (B.niveau >= 2) levendBedrijf(L_HEFTRUCK, x - s * 0.18, y + s * 0.315, 0, -s * 0.14, 2);
  },
  mijn(c, x, y, s) {
    if (!vanaf(D11)) return;
    // smalspoor langs de zuidrand van de put naar de stort; de lorries rijden vol heen en leeg terug
    rails(c, x - s * 0.3, x + s * 0.06, y + s * 0.395, s);
    levendBedrijf(L_LORRIE, x + s * 0.04, y + s * 0.395, s * 0.31, 0, 0);
    for (const [dx, dy, r] of [[-0.33, 0.27, 0.026], [0.1, 0.35, 0.022], [0.16, 0.33, 0.015]]) steenhoop(c, x + dx * s, y + dy * s, r * s);
  },
  centrale(c, x, y, s) {
    if (!vanaf(D11)) return;
    // brandstoftanks in de zuidoosthoek en een shovel die de kolenberg bijschuift
    silo(c, x + s * 0.43, y + s * 0.35, s * 0.028);
    silo(c, x + s * 0.43, y + s * 0.43, s * 0.028);
    levendBedrijf(L_HEFTRUCK, x + s * 0.385, y + s * 0.045, s * 0.065, s * 0.02, 1);
  },
  ziekenhuis(c, x, y, s) {
    if (!vanaf(D11)) return;
    // bezoekers in de tuin en een windzak op het dak bij het helikopterplatform
    levendBedrijf(L_MENSEN, x + s * 0.06, y + s * 0.31, s * 0.36, s * 0.1, (6 << 2) | 2);
    c.strokeStyle = '#d8dcd0'; c.lineWidth = lijn(s, 0.0025);
    c.beginPath(); c.moveTo(x + s * 0.16, y - s * 0.24); c.lineTo(x + s * 0.16, y - s * 0.27); c.stroke();
    levendBedrijf(L_WINDZAK, x + s * 0.16, y - s * 0.27, s * 0.025);
  },
  school(c, x, y, s) {
    if (vanaf(D9)) levendBedrijf(L_MENSEN, x - s * 0.24, y - s * 0.21, s * 0.25, s * 0.22, (14 << 2) | 0);
  },
  universiteit(c, x, y, s) {
    if (!vanaf(D11)) return;
    const qx = x - s * 0.3, qy = y - s * 0.12, qw = s * 0.6, qh = s * 0.58;
    levendBedrijf(L_MENSEN, qx + qw * 0.12, qy + qh * 0.08, qw * 0.76, qh * 0.4, (12 << 2) | 1);
  },
  kazerne(c, x, y, s) {
    if (vanaf(D9)) levendBedrijf(L_APPEL, x + s * 0.06, y - s * 0.17, s * 0.24, s * 0.12, 0);
    if (vanaf(D11)) levendBedrijf(L_OEFEN, x - s * 0.41, y + s * 0.31, s * 0.28, s * 0.12, 0);
  },
};

// Staat van de kavel bij verval of welvaart (vanaf D11): zwerfvuil, onkruid en scheuren, of verzorgde plantenbakken.
// Bij woonwijken op de stoepband langs het straatkruis (nooit op het plein), bij bedrijven langs de noord- en westrand.
function kavelStaat(c, x, y, s, naam) {
  if (B.wv === 1) return;
  const wonen = WONEN[naam];
  if (!wonen && GEEN_RANDGOED[naam]) return;
  const vrij = naam === 'hoofdstad' ? 0.16 : 0.1;
  if (B.wv === 0) {
    const n = vanaf(D13) ? 22 : 12;
    for (let i = 0; i < n; i++) {
      const h1 = hash(B.seed, i, 101), h2 = hash(B.seed, i, 102), h3 = hash(B.seed, i, 103);
      let px, py;
      if (wonen) {
        const f = (vrij + (0.48 - vrij) * h1) * (h2 < 0.5 ? -1 : 1), zij = (0.036 + 0.02 * h3) * (i % 2 ? 1 : -1);
        if (i % 4 < 2) { px = x + f * s; py = y + zij * s; } else { px = x + zij * s; py = y + f * s; }
      } else {
        const f = -0.44 + 0.88 * h1, rand = -0.468 + 0.01 * h3;
        if (i % 2) { px = x + f * s; py = y + rand * s; } else { px = x + rand * s; py = y + f * s; }
      }
      if (h3 < 0.55) rect(c, px, py, s * (0.003 + 0.003 * h2), s * 0.0025, VUIL[i % VUIL.length]);
      else { c.fillStyle = h2 < 0.5 ? '#6f7f3a' : '#5a6a2e'; rond(c, px, py, s * 0.003); rond(c, px + s * 0.003, py - s * 0.002, s * 0.0024); }
    }
    if (wonen && vanaf(D13)) {
      // scheuren in het asfalt
      c.strokeStyle = 'rgba(20,20,20,0.35)'; c.lineWidth = lijn(s, 0.001);
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const f = (vrij + 0.05 + 0.3 * hash(B.seed, i, 104)) * (i % 2 ? 1 : -1);
        if (i < 2) { c.moveTo(x + f * s, y - s * 0.025); c.lineTo(x + (f + 0.01) * s, y - s * 0.005); c.lineTo(x + (f - 0.004) * s, y + s * 0.02); }
        else { c.moveTo(x - s * 0.025, y + f * s); c.lineTo(x - s * 0.005, y + (f + 0.01) * s); c.lineTo(x + s * 0.02, y + (f - 0.004) * s); }
      }
      c.stroke();
    }
  } else if (wonen) {
    for (const f of [-0.16, 0.16]) for (const z of [-0.052, 0.052]) { plantenbak(c, x + f * s, y + z * s); plantenbak(c, x + z * s, y + f * s); }
  }
}

// ---------- pakket B: levende delen per beeld ----------

// Pakket B-delen die op dit moment niets tekenen (geen december, nacht, geen wedstrijddag, geen schooltijd)
// slaan we over vóór het plafond, zodat ze straatlantaarns en andere zichtbare delen niet verdringen.
function bRust(soort, k, t, nacht) {
  switch (soort) {
    case L_SNOER: return !isKerst;
    case L_DUIF: return nacht >= 0.6;
    case L_MENSEN: return (k & 3) === 0 ? schoolStand(dagNu, t) === 0 : nacht >= 0.5;
    case L_APPEL: return nacht >= 0.5 || !isOchtend(t);
    case L_PUBLIEK: return typeof dagNu !== 'number' || Math.floor(dagNu) % 4 !== 2;
    default: return false;
  }
}

const KLEREN = ['#c0453a', '#3a6ea5', '#e0b020', '#4f8a4a', '#f2efe6', '#7d4fa0'];
const HUID = ['#e8c4a0', '#b07a52', '#7a5238'];
const KERST = ['#ff5a4a', '#5aff7a', '#5aa8ff', '#ffd35a'];
const DOCK_KLEUR = ['#c0392b', '#2e86c1', '#27ae60'];

// Vrachtwagen van bovenaf; richting 0 = cabine west, 1 = cabine oost, 2 = cabine zuid. (cx, cy) is het midden.
function vrachtB(c, cx, cy, richting, s, kleur, achter) {
  const L = s * 0.1, cab = s * 0.026, W = s * 0.036, T = L + cab;
  if (richting === 2) {
    const y0 = cy - T / 2;
    rect(c, cx - W / 2 + s * 0.005, y0 + s * 0.005, W, T, 'rgba(0,0,0,0.3)');
    rect(c, cx - W / 2, y0, W, L, '#d9d6cc');
    rect(c, cx - W / 2, y0 + L, W, cab, kleur);
    rect(c, cx - W * 0.35, y0 + L + cab * 0.55, W * 0.7, cab * 0.3, 'rgba(20,28,36,0.7)');
    c.strokeStyle = 'rgba(0,0,0,0.15)'; c.lineWidth = Math.max(0.5, s * 0.002);
    c.beginPath(); for (let i = 1; i < 4; i++) { c.moveTo(cx - W / 2, y0 + (L * i) / 4); c.lineTo(cx + W / 2, y0 + (L * i) / 4); } c.stroke();
    if (achter) { c.fillStyle = '#ffb030'; c.fillRect(cx - W / 2, y0, W * 0.2, s * 0.004); c.fillRect(cx + W * 0.3, y0, W * 0.2, s * 0.004); }
  } else {
    const x0 = cx - T / 2, west = richting === 0, bx = west ? x0 + cab : x0, kx = west ? x0 : x0 + L;
    rect(c, x0 + s * 0.005, cy - W / 2 + s * 0.005, T, W, 'rgba(0,0,0,0.3)');
    rect(c, bx, cy - W / 2, L, W, '#d9d6cc');
    rect(c, kx, cy - W / 2, cab, W, kleur);
    rect(c, west ? kx + cab * 0.15 : kx + cab * 0.55, cy - W * 0.35, cab * 0.3, W * 0.7, 'rgba(20,28,36,0.7)');
  }
}

// Vrachtwagen die achteruit insteekt aan het laaddock: rijdt binnen, draait, steekt achteruit in (oranje
// achterlichten), laadt, rijdt weg. (px, py) is de deur in de gevel, a de afstand tot de rijstrook, b de lengte ervan.
function laadDock(c, px, py, a, b, s, t, fase, draait, kleur) {
  const T = s * 0.126, laan = py + a, dock = py + s * 0.004 + T / 2;
  const p = draait ? frac(t / 48 + fase) : 0.5;
  let alfa = 1;
  if (p < 0.16) { const q = p / 0.16, e = q * (2 - q); alfa = Math.min(1, q * 5); c.globalAlpha = alfa; vrachtB(c, px + b * (1 - e) + T / 2 * 0.0, laan, 0, s, kleur, false); }
  else if (p < 0.2) vrachtB(c, px, laan, 2, s, kleur, false);
  else if (p < 0.32) { const q = (p - 0.2) / 0.12, e = q * q * (3 - 2 * q); vrachtB(c, px, laan + (dock - laan) * e, 2, s, kleur, Math.floor(t * 4) % 2 === 0); }
  else if (p < 0.7) vrachtB(c, px, dock, 2, s, kleur, false);
  else if (p < 0.8) { const q = (p - 0.7) / 0.1, e = q * q * (3 - 2 * q); vrachtB(c, px, dock + (laan - dock) * e, 2, s, kleur, false); }
  else if (p < 0.84) vrachtB(c, px, laan, 1, s, kleur, false);
  else { const q = (p - 0.84) / 0.16; alfa = q > 0.8 ? (1 - q) * 5 : 1; c.globalAlpha = alfa; vrachtB(c, px + b * q * q, laan, 1, s, kleur, false); }
  c.globalAlpha = 1;
}

// Heftruck (k 0 geel, 2 oranje) of shovel (k 1) die heen en weer rijdt tussen (px, py) en (px + a, py + b);
// de vorken wijzen altijd naar het doel, heen met een pallet (of een volle bak), terug leeg.
function heftruck(c, px, py, a, b, k, s, t, fase, draait) {
  const p = draait ? frac(t / 18 + fase) : 0.95;
  let q, vol;
  if (p < 0.38) { q = p / 0.38; vol = true; } else if (p < 0.5) { q = 1; vol = p < 0.44; } else if (p < 0.88) { q = 1 - (p - 0.5) / 0.38; vol = false; } else { q = 0; vol = p > 0.94; }
  q = q * q * (3 - 2 * q);
  const x = px + a * q, y = py + b * q, liggend = Math.abs(a) >= Math.abs(b), sg = liggend ? Math.sign(a) || 1 : Math.sign(b) || 1;
  const bl = s * (k === 1 ? 0.024 : 0.016), bw = s * (k === 1 ? 0.016 : 0.012), w = liggend ? bl : bw, h = liggend ? bw : bl;
  rect(c, x - w / 2 + s * 0.003, y - h / 2 + s * 0.003, w, h, 'rgba(0,0,0,0.3)');
  rect(c, x - w / 2, y - h / 2, w, h, k === 2 ? '#d86a20' : '#e0b020');
  rect(c, liggend ? x - sg * w * 0.15 - w * 0.2 : x - w * 0.35, liggend ? y - h * 0.35 : y - sg * h * 0.15 - h * 0.2, liggend ? w * 0.4 : w * 0.7, liggend ? h * 0.7 : h * 0.4, '#2a2e33');
  const fx = liggend ? x + sg * w / 2 : x, fy = liggend ? y : y + sg * h / 2, f = s * 0.011;
  if (k === 1) {
    // de bak van de shovel, vol met kolen
    rect(c, liggend ? (sg > 0 ? fx : fx - s * 0.008) : fx - w * 0.6, liggend ? fy - h * 0.6 : (sg > 0 ? fy : fy - s * 0.008), liggend ? s * 0.008 : w * 1.2, liggend ? h * 1.2 : s * 0.008, vol ? '#2a2826' : '#5a5f63');
    return;
  }
  c.strokeStyle = '#3a3c3e'; c.lineWidth = Math.max(0.5, s * 0.0018);
  c.beginPath();
  if (liggend) { c.moveTo(fx, fy - h * 0.25); c.lineTo(fx + sg * f, fy - h * 0.25); c.moveTo(fx, fy + h * 0.25); c.lineTo(fx + sg * f, fy + h * 0.25); }
  else { c.moveTo(fx - w * 0.25, fy); c.lineTo(fx - w * 0.25, fy + sg * f); c.moveTo(fx + w * 0.25, fy); c.lineTo(fx + w * 0.25, fy + sg * f); }
  c.stroke();
  if (vol) {
    const ox = liggend ? fx + sg * f * 0.5 : fx, oy = liggend ? fy : fy + sg * f * 0.5, pw = s * 0.013;
    rect(c, ox - pw / 2, oy - pw / 2, pw, pw, '#9a7448');
    rect(c, ox - pw * 0.4, oy - pw * 0.4, pw * 0.8, pw * 0.8, '#c8b48a');
  }
}

// Drie lorries op het smalspoor: vol naar de stort, kiepen, leeg terug, laden onder de schacht.
function lorries(c, px, py, a, s, t, fase, draait) {
  const p = draait ? frac(t / 34 + fase) : 0.9;
  let q, vol;
  if (p < 0.35) { q = p / 0.35; vol = 1; } else if (p < 0.5) { q = 1; vol = 1 - (p - 0.35) / 0.15; } else if (p < 0.85) { q = 1 - (p - 0.5) / 0.35; vol = 0; } else { q = 0; vol = (p - 0.85) / 0.15; }
  q = q * q * (3 - 2 * q);
  const kop = px - a * q, w = s * 0.018, h = s * 0.012;
  for (let j = 0; j < 3; j++) {
    const x = kop + j * s * 0.022;
    rect(c, x - w / 2 + s * 0.003, py - h / 2 + s * 0.003, w, h, 'rgba(0,0,0,0.3)');
    rect(c, x - w / 2, py - h / 2, w, h, '#5a5450');
    rect(c, x - w * 0.4, py - h * 0.35, w * 0.8, h * 0.7, '#2e2a26');
    const v = j === 0 && p >= 0.35 && p < 0.5 ? vol : j === 2 && p >= 0.85 ? Math.min(1, vol * 1.5) : vol;
    if (v > 0.05) { c.fillStyle = '#7a6a56'; c.beginPath(); c.ellipse(x, py - h * 0.05, w * 0.38 * v, h * 0.3 * v + 0.2, 0, 0, Math.PI * 2); c.fill(); }
  }
}

// Mensen in een vak (a × b): k & 3 is de soort (0 schoolkinderen, 1 studenten, 2 bezoekers), k >> 2 het aantal.
// Eén pad per kleur: eerst schaduwen, dan kleren, dan hoofdjes.
function mensen(c, px, py, a, b, k, s, t, fase, dag, sz) {
  const soort = k & 3, max = k >> 2;
  let n = 0, snel = 0.25, zit = 0;
  if (soort === 0) { const st = schoolStand(dagNu, t); n = st === 2 ? max : st === 1 ? 2 : st === 3 ? 4 : 0; snel = 0.7; }
  else if (soort === 1) { if (!dag) return; const warm = (sz.blad === 'z' || sz.blad === 'b') && sz.koud < 0.5; n = warm ? max : 3; zit = warm ? Math.floor(max * 0.6) : 0; snel = 0.12; }
  else { if (!dag) return; n = max; snel = 0.1; }
  if (!n) return;
  const d = Math.max(1, s * 0.0055);
  // dekens onder de zittende studenten (per twee)
  for (let j = 0; j + 1 < zit; j += 2) {
    c.fillStyle = KLEREN[(j + 3) % KLEREN.length];
    c.fillRect(px + a * hash(j, 3, 7) - d * 0.6, py + b * hash(j, 4, 7) - d * 0.8, d * 3.4, d * 2.2);
  }
  for (let laag = 0; laag < 5; laag++) {
    c.fillStyle = laag === 0 ? 'rgba(0,0,0,0.25)' : laag < 4 ? KLEREN[(laag - 1) * 2 + (soort === 0 ? 0 : 1)] : HUID[soort];
    c.beginPath();
    for (let j = 0; j < n; j++) {
      if (laag >= 1 && laag <= 3 && j % 3 !== laag - 1) continue;
      let ux, uy;
      if (j < zit) { ux = hash(j - (j & 1), 3, 7) + (j & 1) * (d * 1.6) / a; uy = hash(j - (j & 1), 4, 7); }
      else {
        const w1 = snel * (0.5 + hash(j, 1, 9)), w2 = snel * (0.4 + hash(j, 2, 9));
        ux = 0.5 + 0.48 * Math.sin(t * w1 + j * 2.1 + fase * 6.28);
        uy = 0.5 + 0.46 * Math.sin(t * w2 + j * 1.3 + fase * 3.1);
      }
      const x = px + a * ux, y = py + b * uy;
      if (laag === 0) c.rect(x + d * 0.35, y + d * 0.3, d, d);
      else if (laag < 4) c.rect(x - d / 2, y - d / 2, d, d);
      else c.rect(x - d * 0.28, y - d * 0.62, d * 0.56, d * 0.5);
    }
    c.fill();
  }
}

// Ochtendappèl op de kazerne: drie rijen van zeven en een officier ervoor (alleen 's ochtends).
function appel(c, px, py, a, b, s, t, draait) {
  if (!draait || !isOchtend(t)) return;
  const d = Math.max(1, s * 0.006), sx = a / 7, sy = b / 4;
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath(); for (let r = 0; r < 3; r++) for (let q = 0; q < 7; q++) c.rect(px + q * sx + d * 0.4, py + (r + 1) * sy + d * 0.3, d, d); c.fill();
  c.fillStyle = '#4a5340';
  c.beginPath(); for (let r = 0; r < 3; r++) for (let q = 0; q < 7; q++) c.rect(px + q * sx, py + (r + 1) * sy, d, d); c.fill();
  c.fillStyle = '#2f3528';
  const stap = Math.floor(t * 0.5) % 2 ? d * 0.4 : 0;
  c.fillRect(px + a * 0.43 + stap, py, d * 1.1, d * 1.1);
}

// Hindernisbaan: soldaten rennen er in een rij doorheen en springen over de palen; een instructeur kijkt toe.
function oefenen(c, px, py, a, b, s, t, fase, dag, draait) {
  if (!dag || !draait || isOchtend(t)) return;
  const d = Math.max(1, s * 0.006);
  c.fillStyle = '#4a5340';
  c.beginPath();
  for (let j = 0; j < 5; j++) {
    const f = frac(t * 0.035 + j * 0.13 + fase), hop = Math.abs(Math.sin(f * Math.PI * 5)) * s * 0.005;
    c.rect(px + a * f, py + b * (0.35 + 0.3 * hash(j, 5, 3)) - hop, d, d);
  }
  c.fill();
  c.fillStyle = '#2f3528'; c.fillRect(px + a * 0.5, py - d * 1.5, d * 1.1, d * 1.1);
}

// Erewacht: n wachten naast elkaar; elke 14 s marcheren ze een paar passen naar buiten en terug (de aflossing).
function erewacht(c, px, py, a, k, s, t, fase) {
  const n = k & 7, u = UNIFORM[(k >> 3) % UNIFORM.length], d = Math.max(1, s * 0.0055);
  const p = frac(t / 14 + fase), uit = p < 0.12 ? Math.sin((p / 0.12) * Math.PI) : 0;
  for (let laag = 0; laag < 3; laag++) {
    c.fillStyle = laag === 0 ? 'rgba(0,0,0,0.25)' : laag === 1 ? u[0] : u[1];
    c.beginPath();
    for (let j = 0; j < n; j++) {
      const o = j - (n - 1) / 2, x = px + o * a + Math.sign(o) * uit * a * 0.6;
      if (laag === 0) c.rect(x - d / 2 + d * 0.4, py - d * 1.3 + d * 0.4, d, d * 1.3);
      else if (laag === 1) c.rect(x - d / 2, py - d * 1.3, d, d * 1.3);
      else c.rect(x - d * 0.35, py - d * 1.3 - (u === UNIFORM[3] ? d * 0.5 : 0), d * 0.7, d * (u === UNIFORM[3] ? 0.9 : 0.5));
    }
    c.fill();
  }
}

// Zwarte dienstauto die voorrijdt: komt van het oosten binnen, staat een tijd stil bij de ingang, rijdt terug.
function dienstauto(c, px, py, a, s, t, fase, nacht, accent) {
  const p = frac(t / 46 + fase);
  let x, alfa = 1, oost = false;
  if (p < 0.12) { const q = p / 0.12, e = q * (2 - q); x = px + a * (1 - e); alfa = Math.min(1, q * 4); }
  else if (p < 0.55) x = px;
  else if (p < 0.68) { const q = (p - 0.55) / 0.13; x = px + a * q * q; alfa = q > 0.75 ? (1 - q) * 4 : 1; oost = true; }
  else return;
  const l = s * 0.06, b = s * 0.03;
  c.globalAlpha = alfa;
  rect(c, x - l / 2 + s * 0.004, py - b / 2 + s * 0.004, l, b, 'rgba(0,0,0,0.3)');
  rect(c, x - l / 2, py - b / 2, l, b, '#15171a');
  rect(c, x - l * 0.2, py - b * 0.36, l * 0.42, b * 0.72, '#3a4652');
  // twee vaantjes op de voorspatborden in de kleur van het regime (fictief, zonder tekens)
  const vx = oost ? x + l * 0.42 : x - l * 0.48;
  rect(c, vx, py - b * 0.5, l * 0.06, b * 0.18, accent); rect(c, vx, py + b * 0.32, l * 0.06, b * 0.18, accent);
  if (nacht > 0.2) { c.fillStyle = rgba('255,240,200', nacht); const kx = oost ? x + l / 2 : x - l / 2; rond(c, kx, py - b * 0.3, Math.max(0.6, s * 0.002)); rond(c, kx, py + b * 0.3, Math.max(0.6, s * 0.002)); }
  c.globalAlpha = 1;
}

// Publiek op de tribunes van het stadion: alleen op wedstrijddagen, overdag en in de vroege avond, met een wave.
function publiek(c, mx, my, rx, ry, hgtF, s, t, nacht, accent) {
  const d = dagNu;
  if (typeof d !== 'number' || Math.floor(d) % 4 !== 2) return;
  if (nacht > 0.5 && nachtUur(t) > 0.35) return;
  const hgt = (hgtF / 10000) * s, n = 96, p = Math.max(0.8, s * 0.004), golf = (t * 0.9) % (Math.PI * 2);
  for (let laag = 0; laag < 4; laag++) {
    c.fillStyle = laag === 0 ? accent : laag === 1 ? '#e8e0d0' : laag === 2 ? '#3a3a3a' : '#fafaf6';
    c.beginPath();
    for (let j = 0; j < n; j++) {
      const th = (j / n) * Math.PI * 2 + hash(j, 1, 4) * 0.05, f = 0.74 + 0.22 * hash(j, 2, 4);
      const inGolf = Math.abs(((th - golf + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.25;
      if (laag === 3 ? !inGolf : inGolf || j % 3 !== laag) continue;
      c.rect(mx + Math.cos(th) * rx * f - p / 2, my - hgt * (1 - f) + Math.sin(th) * ry * f - p / 2 - (inGolf ? p : 0), p, p);
    }
    c.fill();
  }
}

// Duiven op de nok: een paar grijze stipjes langs de lijn (px, py) → (px + a, py + b); af en toe fladdert er een op.
function duiven(c, px, py, a, b, k, s, t) {
  const n = 2 + (k % 3), r = Math.max(0.6, s * 0.003);
  c.fillStyle = '#8d9096';
  c.beginPath();
  for (let j = 0; j < n; j++) {
    const f = 0.08 + 0.84 * hash(k, j, 1), fl = frac(t / 11 + hash(k, j, 2)), op = fl < 0.05 ? Math.sin((fl / 0.05) * Math.PI) * s * 0.012 : 0;
    const x = px + a * f, y = py + b * f - op;
    c.moveTo(x + r, y); c.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
    if (op > 0) { c.moveTo(x - r * 2.2, y - r); c.lineTo(x, y); c.lineTo(x + r * 2.2, y - r); }
  }
  c.fill();
  c.fillStyle = '#5d6168';
  c.beginPath();
  for (let j = 0; j < n; j++) { const f = 0.08 + 0.84 * hash(k, j, 1), x = px + a * f + r * 0.7, y = py + b * f - r * 0.2; c.rect(x - r * 0.3, y - r * 0.3, r * 0.6, r * 0.6); }
  c.fill();
}

// Lichtsnoer in december: lampjes langs een lijn; warm wit, kleur die knippert, of kleur die langzaam wisselt.
function snoer(c, px, py, a, k, s, t, nacht) {
  const n = Math.max(3, Math.min(24, Math.floor(a / (s * 0.007)))), r = Math.max(0.6, s * 0.0022), stijl = k % 3;
  c.strokeStyle = rgba('255,220,150', 0.12 * nacht); c.lineWidth = Math.max(0.6, s * 0.004);
  c.beginPath(); c.moveTo(px, py); c.lineTo(px + a, py); c.stroke();
  for (let kl = 0; kl < (stijl === 0 ? 1 : 4); kl++) {
    c.fillStyle = stijl === 0 ? '#ffe6a0' : KERST[kl];
    c.globalAlpha = stijl === 2 ? 0.55 + 0.45 * Math.sin(t * 1.3 + kl * 1.57) : 1;
    c.beginPath();
    for (let j = 0; j < n; j++) {
      if (stijl > 0 && j % 4 !== kl) continue;
      if (stijl === 1 && (Math.floor(t * 1.6) + j) % 2) continue;
      const f = (j + 0.5) / n, x = px + a * f, y = py + Math.abs(Math.sin(f * n * 0.8)) * s * 0.002;
      c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2);
    }
    c.fill();
  }
  c.globalAlpha = 1;
}

// ---------- pakket D: levende delen per beeld ----------

// Torenkraan: de giek zwenkt heen en weer met een last aan de haak; 's nachts een rood lampje in de top.
function torenkraan(c, mx, my, len, t, fase, s, nacht) {
  const hoek = fase * 6.28 + Math.sin(t * 0.12 + fase * 9) * 1.3;
  const dx = Math.cos(hoek), dy = Math.sin(hoek) * 0.6;
  const ex = mx + dx * len, ey = my - s * 0.05 + dy * len, bx = mx - dx * len * 0.28, by = my - s * 0.05 - dy * len * 0.28;
  c.strokeStyle = 'rgba(0,0,0,0.2)';
  c.lineWidth = Math.max(1, s * 0.008);
  c.beginPath(); c.moveTo(bx + s * 0.05, by + s * 0.08); c.lineTo(ex + s * 0.05, ey + s * 0.08); c.stroke();
  c.strokeStyle = '#e0a020';
  c.beginPath(); c.moveTo(mx, my); c.lineTo(mx, my - s * 0.05); c.moveTo(bx, by); c.lineTo(ex, ey); c.stroke();
  rect(c, bx - s * 0.012, by - s * 0.008, s * 0.024, s * 0.016, '#8a8f96');
  const f = 0.45 + 0.35 * Math.sin(t * 0.21 + fase * 4), hx = mx + (ex - mx) * f, hy = my - s * 0.05 + (ey - my + s * 0.05) * f;
  c.strokeStyle = 'rgba(40,40,40,0.6)'; c.lineWidth = Math.max(0.5, s * 0.0015);
  c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx, hy + s * 0.03); c.stroke();
  rect(c, hx - s * 0.01, hy + s * 0.03, s * 0.02, s * 0.008, '#a67c52');
  if (nacht > 0.2 && Math.floor(t + fase) % 2 === 0) { c.fillStyle = '#ff4d4d'; rond(c, mx, my - s * 0.05, Math.max(1, s * 0.004)); }
}

// Steigers over een gebouw in aanbouw: hoe verder het werk, hoe meer steigerlagen.
function steigers(c, x, y, s, voortgang) {
  const lagen = 1 + Math.floor(voortgang * 4), x0 = x - s * 0.34, x1 = x + s * 0.3, y1 = y + s * 0.28;
  c.strokeStyle = 'rgba(216,160,48,0.85)';
  c.lineWidth = Math.max(0.6, s * 0.003);
  c.beginPath();
  for (let i = 0; i <= 8; i++) { const sx = x0 + ((x1 - x0) * i) / 8; c.moveTo(sx, y1); c.lineTo(sx, y1 - lagen * s * 0.05); }
  for (let j = 0; j <= lagen; j++) { const sy = y1 - j * s * 0.05; c.moveTo(x0, sy); c.lineTo(x1, sy); }
  c.stroke();
  // materiaal en een bouwkeet
  rect(c, x - s * 0.42, y + s * 0.3, s * 0.08, s * 0.05, '#a67c52');
  rect(c, x - s * 0.32, y + s * 0.31, s * 0.06, s * 0.04, '#b0aca2');
  rect(c, x + s * 0.32, y + s * 0.26, s * 0.1, s * 0.06, '#e8e4da');
  rect(c, x + s * 0.32, y + s * 0.26, s * 0.1, s * 0.012, '#2e6eb5');
}

// Helikopter op het platform: staat stil, draait op, stijgt op en vliegt weg, komt later terug en landt.
function helikopter(c, px, py, r, t, fase, s, draait) {
  const p = frac(t / 70 + fase);
  let hoog = 0, rotor = 0;
  if (!draait || p < 0.45) rotor = 0;
  else if (p < 0.55) rotor = (p - 0.45) / 0.1;
  else if (p < 0.65) { rotor = 1; hoog = (p - 0.55) / 0.1; }
  else if (p < 0.8) return;
  else if (p < 0.9) { rotor = 1; hoog = 1 - (p - 0.8) / 0.1; }
  else rotor = 1 - (p - 0.9) / 0.1;
  const vx = px + hoog * hoog * s * 0.25, vy = py - hoog * s * 0.12 - hoog * hoog * s * 0.2;
  c.fillStyle = rgba('0,0,0', 0.28 * (1 - hoog * 0.6));
  c.beginPath(); c.ellipse(px + s * 0.012 + hoog * s * 0.08, py + s * 0.008 + hoog * s * 0.05, r * 0.42, r * 0.2, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#4a5560'; c.lineWidth = Math.max(1, s * 0.006);
  c.beginPath(); c.moveTo(vx, vy); c.lineTo(vx + r * 0.75, vy); c.stroke();
  c.fillStyle = '#d9443c';
  c.beginPath(); c.ellipse(vx, vy, r * 0.32, r * 0.17, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(160,200,230,0.8)'; rond(c, vx - r * 0.18, vy, r * 0.09);
  const a = rotor > 0.95 ? t * 40 : fase * 6 + t * 12 * rotor * rotor;
  if (rotor > 0.6) { c.fillStyle = rgba('40,45,50', 0.18); rond(c, vx, vy, r * 0.62); }
  c.strokeStyle = rgba('40,45,50', rotor > 0.6 ? 0.45 : 0.9); c.lineWidth = Math.max(0.6, s * 0.003);
  c.beginPath();
  for (let j = 0; j < 2; j++) { const b = a + j * Math.PI / 2; c.moveTo(vx - Math.cos(b) * r * 0.62, vy - Math.sin(b) * r * 0.62); c.lineTo(vx + Math.cos(b) * r * 0.62, vy + Math.sin(b) * r * 0.62); }
  c.stroke();
}

// Trein langs een perron: rijdt binnen, staat stil, rijdt weer weg. Wagons worden tegen de randen afgekapt.
function trein(c, px, py, len, k, t, s, nacht) {
  const p = frac(t / 45 + k * 0.37), wl = s * 0.07, n = 5, totaal = n * wl * 1.05;
  let kop;
  if (p < 0.25) kop = px - totaal + (len * 0.85 + totaal) * (1 - (1 - p / 0.25) ** 2);
  else if (p < 0.55) kop = px + len * 0.85;
  else if (p < 0.8) kop = px + len * 0.85 + (len * 0.15 + totaal) * ((p - 0.55) / 0.25) ** 2;
  else return;
  const kleur = ['#d9443c', '#2e6eb5', '#e0a020'][k % 3];
  c.fillStyle = 'rgba(0,0,0,0.28)';
  for (let i = 0; i < n; i++) { const a = Math.max(px, kop - (i + 1) * wl * 1.05), b = Math.min(px + len, kop - i * wl * 1.05 - wl * 0.05); if (b > a) c.fillRect(a + s * 0.004, py - s * 0.009, b - a, s * 0.022); }
  c.fillStyle = kleur;
  for (let i = 0; i < n; i++) { const a = Math.max(px, kop - (i + 1) * wl * 1.05), b = Math.min(px + len, kop - i * wl * 1.05 - wl * 0.05); if (b > a) c.fillRect(a, py - s * 0.012, b - a, s * 0.022); }
  c.fillStyle = nacht > 0.3 ? rgba('255,236,190', 0.85) : 'rgba(30,40,50,0.6)';
  for (let i = 0; i < n; i++) { const a = Math.max(px, kop - (i + 1) * wl * 1.05 + wl * 0.08), b = Math.min(px + len, kop - i * wl * 1.05 - wl * 0.13); if (b > a) c.fillRect(a, py - s * 0.006, b - a, s * 0.008); }
}

// Draaiende wieken van een windturbine: het rotorvlak staat dwars op de wind (seizoen.js), de snelheid volgt de windkracht.
function wieken(c, px, py, L, t, fase, s, sz, draait, nacht) {
  const hoek = sz.windHoek, ux = -Math.sin(hoek), uy = Math.cos(hoek) * 0.5;
  const th = (draait ? t * (0.6 + 2.2 * sz.windKracht) : 0) + fase * 0.063;
  c.strokeStyle = '#f4f6f8';
  c.lineWidth = Math.max(0.8, s * 0.004);
  c.beginPath();
  for (let j = 0; j < 3; j++) { const a = th + j * 2.0944, ca = Math.cos(a), sa = Math.sin(a); c.moveTo(px, py); c.lineTo(px + ca * ux * L, py + (ca * uy - sa * 0.9) * L); }
  c.stroke();
  c.fillStyle = '#d8dce0'; rond(c, px, py, Math.max(0.8, s * 0.005));
  if (nacht > 0.2 && Math.floor(t * 0.8 + fase) % 2 === 0) { c.fillStyle = '#ff4d4d'; rond(c, px, py - s * 0.004, Math.max(0.8, s * 0.003)); }
}

// ---------- gebouwen ----------

const TEKEN = {
  hoofdstad(c, x, y, s, st, r, d) {
    straten(c, x, y, s);
    plein(c, x, y, s);
    // groenstroken langs het plein, dan woonwijken in het zuiden
    for (const kx of [-1, 1]) {
      const sx = kx < 0 ? x - s * 0.5 : x + s * 0.15;
      rect(c, sx, y + s * Z0, s * 0.35, s * 0.088, GRAS);
      rect(c, sx, y - s * 0.15, s * 0.35, s * 0.088, GRAS);
      if (B.lod >= 1) for (let i = 0; i < 3; i++) { boom(c, sx + s * (0.06 + i * 0.12), y + s * 0.105, s * 0.02); boom(c, sx + s * (0.06 + i * 0.12), y - s * 0.105, s * 0.02); }
    }
    wijkKwart(c, x - s * 0.5, y + s * 0.15, s * (0.5 - Z0), s * 0.35, st, 2);
    // zuidoost: de blikvanger van het regime (station, erepoort, stadion, ministerie of Hof van Raden)
    (LANDMERK[d.regime] ?? LANDMERK.democratie)(c, x + s * Z0, y + s * 0.15, s * (0.5 - Z0), s * 0.35, st);
    const g = s * (0.5 - Z0), h = s * 0.35;
    const gx = x - s * 0.5, gy = y - s * 0.5, vx = x + s * Z0;
    (REGERING[d.regime] ?? REGERING.democratie)(c, gx, gy, vx, gy, g, h, st);
    if (d.oorlog) oorlogsstand(c, x, y, s, gx, gy, g, h);
    straatMeubels(c, x, y, s, 0.15); // het plein op de kruising blijft vrij
  },
  woonwijk(c, x, y, s, st) {
    straten(c, x, y, s);
    // een groeiende wijk heeft een bouwplaats; vanaf niveau 2 is een kwart soms een park
    const bouwKw = Math.floor(hash(B.seed, 14) * 4);
    for (let kw = 0; kw < 4; kw++) {
      const [qx, qy, qw, qh] = kwartVak(x, y, s, kw % 2 ? 1 : -1, kw > 1 ? 1 : -1);
      if (B.groeiend && kw === bouwKw) bouwplaats(c, qx, qy, qw, qh, st);
      else if (B.niveau >= 2 && hash(B.seed, kw, 71) < 0.12) park(c, qx, qy, qw, qh, kw);
      else wijkKwart(c, qx, qy, qw, qh, st, kw);
    }
    straatBomen(c, x, y, s);
    straatMeubels(c, x, y, s);
  },
  kolonie(c, x, y, s, st) {
    // open plek met een ringvormig wandelpad op 0.38·s (straatcontract), hutten binnen de ring
    const lod = B.lod, n = 3 + B.niveau;
    c.fillStyle = '#9a9468';
    rond(c, x, y, s * 0.46);
    c.strokeStyle = '#8a6a43';
    c.lineWidth = Math.max(1, s * 0.03);
    c.beginPath(); c.arc(x, y, s * 0.38, 0, Math.PI * 2); c.stroke();
    if (lod >= 1) {
      // akkertjes en tenten in de hoeken buiten de ring
      for (const [dx, dy, i] of [[-1, -1, 0], [1, 1, 1]]) rect(c, x + dx * s * 0.44 - s * 0.05, y + dy * s * 0.44 - s * 0.05, s * 0.1, s * 0.1, AKKER[i * 2 + 1]);
      for (const [dx, dy] of [[1, -1], [-1, 1]]) pand(c, x + dx * s * 0.42 - s * 0.04, y + dy * s * 0.42 - s * 0.02, s * 0.08, s * 0.05, 0, '#d8cfb0', '#c8bf9f', { schuin: true, schoorsteen: false, geenRamen: true });
    }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash(B.seed, i, 1) * 0.5;
      const hx = x + Math.cos(a) * s * 0.22, hy = y + Math.sin(a) * s * 0.2;
      pand(c, hx - s * 0.05, hy - s * 0.02, s * 0.1, s * 0.07, 1, st.daken[i % st.daken.length], st.muur, { schuin: true, raamAfstand: 0.04 });
    }
    if (lod >= 2) {
      // waterput en houtstapel
      c.fillStyle = '#8c8a84'; rond(c, x - s * 0.1, y + s * 0.08, s * 0.025);
      c.fillStyle = '#3a6e78'; rond(c, x - s * 0.1, y + s * 0.08, s * 0.015);
      for (let i = 0; i < 3; i++) rect(c, x + s * 0.04, y + s * 0.12 + i * s * 0.012, s * 0.06, s * 0.01, i % 2 ? '#a67c52' : '#8a6a43');
    }
    // kampvuur met stenen kring, vlag in het midden
    c.fillStyle = '#7a756c'; rond(c, x + s * 0.08, y + s * 0.05, s * 0.022);
    c.fillStyle = '#3a2e24'; rond(c, x + s * 0.08, y + s * 0.05, s * 0.014);
    levend(L_VUUR, x + s * 0.08, y + s * 0.05);
    paal(c, x, y, s * 0.2, 0);
  },
  boerderij(c, x, y, s, st) {
    const lod = B.lod, n = B.niveau;
    // percelen: drie in het noorden, twee in het zuidwesten; het erf ligt in het zuidoosten
    const perc = [[-0.5, -0.5, 0.34, 0.47], [-0.16, -0.5, 0.33, 0.47], [0.17, -0.5, 0.33, 0.47], [-0.5, 0.03, 0.47, 0.22], [-0.5, 0.25, 0.47, 0.25]];
    const stap = s / (lod === 0 ? 14 : lod === 1 ? 24 : 32);
    for (let i = 0; i < perc.length; i++) {
      const [px, py, pw, ph] = perc[i];
      const X = x + px * s, Y = y + py * s, W = pw * s, H = ph * s;
      if (n >= 3 && i === 4) {
        // kassen
        rect(c, X, Y, W, H, '#cfe0dd');
        c.strokeStyle = 'rgba(80,110,110,0.45)';
        c.lineWidth = lijn(s, 0.003);
        c.beginPath();
        for (let k = 1; k < 6; k++) { c.moveTo(X + (W * k) / 6, Y); c.lineTo(X + (W * k) / 6, Y + H); }
        c.stroke();
        raamVast(X + W * 0.05, Y + H * 0.1, W * 0.9, H * 0.8);
        continue;
      }
      let kleur = AKKER[Math.floor(hash(B.seed, i, 21) * AKKER.length)];
      if (B.verwaarloosd && i % 2 === 0) kleur = '#8f8a5a'; // braak
      else if (B.blad === 'k') kleur = i % 2 ? '#8a7a62' : '#7d8466'; // winter: omgeploegd of kaal
      else if (B.blad === 'l' && kleur === '#c8b46a') kleur = '#b8a878'; // stoppels na de oogst
      rect(c, X, Y, W, H, kleur);
      c.strokeStyle = tint(kleur, 0.8);
      c.lineWidth = lijn(s, 0.004);
      c.beginPath();
      if (i % 2) for (let yy = Y + stap / 2; yy < Y + H; yy += stap) { c.moveTo(X, yy); c.lineTo(X + W, yy); }
      else for (let xx = X + stap / 2; xx < X + W; xx += stap) { c.moveTo(xx, Y); c.lineTo(xx, Y + H); }
      c.stroke();
      if (lod >= 1 && kleur === '#c8b46a') {
        c.fillStyle = '#d9c27a';
        for (let k = 0; k < 3; k++) rond(c, X + W * (0.25 + k * 0.25), Y + H * (0.3 + 0.4 * hash(B.seed, i, k)), s * 0.014);
      }
    }
    if (lod >= 1) {
      c.strokeStyle = HEG;
      c.lineWidth = lijn(s, 0.012);
      for (const [px, py, pw, ph] of perc) c.strokeRect(x + px * s, y + py * s, pw * s, ph * s);
      levend(L_VOERTUIG, x - s * 0.48, y - s * 0.46, s * 0.3, s * 0.42, 1);
    }
    if (lod >= 2) for (let i = 0; i < 6; i++) boom(c, x + s * (-0.16 + i * 0.066), y - s * 0.03, s * 0.016);
    // erf met woonhuis, schuur en silo's
    const ex = x + s * 0.04, ey = y + s * 0.04;
    rect(c, ex, ey, s * 0.46, s * 0.46, GRIND);
    if (lod >= 1) hekje(c, ex + s * 0.01, ey + s * 0.01, s * 0.44, s * 0.44);
    if (lod >= 2) {
      c.fillStyle = '#3a9aa5';
      c.beginPath(); c.ellipse(ex + s * 0.1, ey + s * 0.1, s * 0.05, s * 0.035, 0, 0, Math.PI * 2); c.fill();
      boom(c, ex + s * 0.03, ey + s * 0.2, s * 0.022);
    }
    pand(c, ex + s * 0.2, ey + s * 0.07, s * 0.22, s * 0.13, 2, '#8b4a32', '#a0896a', { schuin: true, schoorsteen: false, raamAfstand: 0.06 });
    if (n >= 2) pand(c, ex + s * 0.02, ey + s * 0.3 - s * 0.02, s * 0.1, s * 0.16, 2, '#7d878c', '#9aa0a4', { schuin: true, schoorsteen: false, geenRamen: true });
    pand(c, ex + s * 0.15, ey + s * 0.3, s * 0.14, s * 0.1, 2, st.daken[0], st.muur, { schuin: !st.plat });
    for (let i = 0; i < n; i++) silo(c, ex + s * 0.38, ey + s * (0.27 + i * 0.07), s * 0.032);
  },
  mijn(c, x, y, s) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, AARDE);
    // terrassen van de dagbouwput, van licht (rand) naar donker (bodem)
    const cx = x - s * 0.06, cy = y + s * 0.04, rx = s * 0.36, ry = s * 0.3, ringen = 4 + lod;
    for (let i = 0; i < ringen; i++) {
      const f = 1 - i / ringen;
      c.fillStyle = tint('#a08f78', 1 - (i / ringen) * 0.62);
      c.beginPath(); c.ellipse(cx, cy, rx * f, ry * f, 0, 0, Math.PI * 2); c.fill();
      if (lod >= 1) {
        c.strokeStyle = 'rgba(255,240,210,0.25)';
        c.lineWidth = lijn(s, 0.004);
        c.beginPath(); c.ellipse(cx, cy, rx * f, ry * f, 0, Math.PI * 0.9, Math.PI * 1.6); c.stroke();
      }
    }
    if (lod >= 1) {
      // hellingbaan
      c.strokeStyle = '#b8a88c';
      c.lineWidth = lijn(s, 0.014);
      for (let i = 0; i < ringen - 1; i++) { const f = 1 - (i + 0.5) / ringen; c.beginPath(); c.ellipse(cx, cy, rx * f, ry * f, 0, i * 1.1, i * 1.1 + Math.PI * 0.8); c.stroke(); }
    }
    if (lod >= 2) { c.fillStyle = '#3a6e78'; c.beginPath(); c.ellipse(cx, cy, rx * 0.12, ry * 0.1, 0, 0, Math.PI * 2); c.fill(); }
    // stort in het zuidwesten
    c.fillStyle = '#6e6152'; rond(c, x - s * 0.4, y + s * 0.4, s * 0.1);
    c.fillStyle = '#8a7a66'; rond(c, x - s * 0.42, y + s * 0.38, s * 0.06);
    // verwerking met lopende band
    const sx = x + s * 0.2, sy = y - s * 0.42 + 2 * s * 0.017;
    if (lod >= 1) {
      c.strokeStyle = '#4d4d4b';
      c.lineWidth = lijn(s, 0.02);
      c.beginPath(); c.moveTo(cx + rx * 0.55, cy - ry * 0.55); c.lineTo(sx + s * 0.04, sy + s * 0.06); c.stroke();
      if (lod >= 2) {
        c.strokeStyle = '#9a9a96';
        c.lineWidth = lijn(s, 0.006);
        c.setLineDash([s * 0.008, s * 0.012]);
        c.beginPath(); c.moveTo(cx + rx * 0.55, cy - ry * 0.55); c.lineTo(sx + s * 0.04, sy + s * 0.06); c.stroke();
        c.setLineDash([]);
      }
    }
    pand(c, sx, sy, s * 0.26, s * 0.12, 2, '#7d858c', '#9a958c', { raamAfstand: 0.05 });
    // schachtbok
    c.strokeStyle = '#c9b48a';
    c.lineWidth = Math.max(1, s * 0.02);
    c.beginPath(); c.moveTo(x + s * 0.26, y - s * 0.1); c.lineTo(x + s * 0.34, y - s * 0.26); c.lineTo(x + s * 0.42, y - s * 0.1); c.closePath(); c.stroke();
    if (n >= 2) pand(c, x + s * 0.3, y + s * 0.2, s * 0.15, s * 0.1, 3, '#6f6a62', '#8f8a80', { raamAfstand: 0.05 });
    if (n >= 3) { rails(c, x - s * 0.5, x + s * 0.5, y + s * 0.45, s); spoorwagons(c, x - s * 0.2, y + s * 0.45, 5, '#5a4a3a', '#2e2a26'); }
    // twee kiepwagens rijden over de terrassen (levend)
    levend(L_VOERTUIG, cx, cy, rx * 0.72, ry * 0.72, 0);
    levend(L_VOERTUIG, cx, cy, rx * 0.5, ry * 0.5, 0);
  },
  houtkap(c, x, y, s) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#6f7f45');
    // bosrand in het noorden; meer bomen bij meer detail, de eerste staan altijd op dezelfde plek
    const aantal = [8, 13, 18][lod];
    for (let i = 0; i < aantal; i++) boom(c, x - s * 0.45 + hash(B.seed, i, 1) * s * 0.9, y - s * 0.44 + hash(B.seed, i, 2) * s * 0.28, s * (0.06 + hash(B.seed, i, 3) * 0.03));
    if (lod >= 1) {
      for (let i = 0; i < 6; i++) {
        const sx = x - s * 0.4 + hash(B.seed, i, 4) * s * 0.8, sy = y - s * 0.1 + hash(B.seed, i, 5) * s * 0.16;
        c.fillStyle = '#7a5a38'; rond(c, sx, sy, s * 0.016);
        c.fillStyle = '#c8a46e'; rond(c, sx, sy, s * 0.01);
      }
    }
    // houtstapels met kopse kanten
    for (let k = 0; k < 1 + n; k++) {
      const lx = x - s * 0.45, ly = y + s * (0.12 + k * 0.11);
      rect(c, lx + s * 0.008, ly + s * 0.008, s * 0.3, s * 0.08, 'rgba(0,0,0,0.25)');
      rect(c, lx, ly, s * 0.3, s * 0.08, '#7a5a38');
      if (lod >= 1) {
        c.fillStyle = '#c8a46e';
        for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) rond(c, lx + s * 0.012, ly + s * (0.014 + j * 0.026), s * 0.011);
      }
      if (lod >= 2) { c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = lijn(s, 0.002); c.beginPath(); c.moveTo(lx + s * 0.03, ly + s * 0.027); c.lineTo(lx + s * 0.3, ly + s * 0.027); c.moveTo(lx + s * 0.03, ly + s * 0.053); c.lineTo(lx + s * 0.3, ly + s * 0.053); c.stroke(); }
    }
    if (lod >= 1) {
      // laadschop
      rect(c, x + s * 0.0, y + s * 0.02, s * 0.07, s * 0.045, '#e0b020');
      rect(c, x + s * 0.01, y + s * 0.03, s * 0.025, s * 0.025, '#2a2e33');
      c.strokeStyle = '#c99a18'; c.lineWidth = lijn(s, 0.008);
      c.beginPath(); c.moveTo(x + s * 0.07, y + s * 0.04); c.lineTo(x + s * 0.13, y + s * 0.0); c.stroke();
    }
    if (lod >= 2) {
      c.strokeStyle = 'rgba(60,45,30,0.3)'; c.lineWidth = lijn(s, 0.006);
      c.beginPath(); c.moveTo(x - s * 0.1, y + s * 0.5); c.quadraticCurveTo(x + s * 0.0, y + s * 0.1, x + s * 0.3, y - s * 0.12); c.stroke();
    }
    if (n >= 2) pand(c, x + s * 0.1, y + s * 0.22, s * 0.32, s * 0.15, 2, '#7d878c', '#a0896a', { schuin: true, schoorsteen: false, raamAfstand: 0.05 });
    if (n >= 3) vrachtwagen(c, x + s * 0.3, y + s * 0.08, '#6b4a3a', true, '#8a6a43');
  },
  centrale(c, x, y, s, st) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8f8b82');
    // schakelstation
    if (lod >= 1) {
      const zx = x - s * 0.46, zy = y + s * 0.33, zw = s * 0.5, zh = s * 0.15;
      rect(c, zx, zy, zw, zh, '#a8a294');
      c.strokeStyle = '#d0d3d6'; c.lineWidth = lijn(s, 0.003);
      c.beginPath();
      for (let i = 0; i <= 6; i++) { c.moveTo(zx + (zw * i) / 6, zy); c.lineTo(zx + (zw * i) / 6, zy + zh); }
      c.moveTo(zx, zy + zh / 2); c.lineTo(zx + zw, zy + zh / 2);
      c.moveTo(zx, zy + zh * 0.5); c.lineTo(x - s * 0.5, zy + zh * 0.5);
      c.stroke();
      for (let i = 0; i < (lod >= 2 ? 6 : 4); i++) rect(c, zx + zw * (0.06 + i * (lod >= 2 ? 0.15 : 0.23)), zy + zh * 0.15, s * 0.03, s * 0.03, '#5f6a72');
    }
    pand(c, x - s * 0.44, y + s * 0.08 + 3 * s * 0.017, s * 0.42, s * 0.18, 3, '#6f747a', st.muur, { units: 2, raamAfstand: 0.035 });
    // schoorsteen(s): lange schaduw en rook
    for (let i = 0; i < (n >= 3 ? 2 : 1); i++) {
      const kx = x - s * (0.06 + i * 0.1), ky = y + s * 0.02;
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = s * 0.03;
      c.beginPath(); c.moveTo(kx, ky); c.lineTo(kx + s * 0.13, ky + s * 0.08); c.stroke();
      c.fillStyle = '#9a8f86'; rond(c, kx, ky, s * 0.024);
      c.fillStyle = '#3a3632'; rond(c, kx, ky, s * 0.013);
      levend(L_ROOK, kx, ky, s * 0.8);
    }
    // koeltorens
    const torens = [[0.22, -0.2, 0.17], [-0.24, -0.26, 0.15], [0.26, 0.28, 0.13]];
    for (let i = 0; i < n; i++) {
      const [dx, dy, rr] = torens[i];
      const tx = x + dx * s, ty = y + dy * s, R = rr * s;
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.beginPath(); c.ellipse(tx + R * 0.4, ty + R * 0.3, R, R * 0.95, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#b9bcc0'; rond(c, tx, ty, R);
      c.fillStyle = '#d3d5d8'; rond(c, tx - R * 0.06, ty - R * 0.06, R * 0.9);
      c.fillStyle = '#9a9da1'; rond(c, tx, ty, R * 0.72);
      c.fillStyle = '#5f6468'; rond(c, tx + R * 0.04, ty + R * 0.04, R * 0.6);
      if (lod >= 1) {
        c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = lijn(s, 0.003);
        c.beginPath(); c.arc(tx, ty, R * 0.84, 0, Math.PI * 2); c.stroke();
        levend(L_KNIPPER, tx + R * 0.7, ty - R * 0.7, s, 0, i);
      }
      if (lod >= 2) { c.fillStyle = '#4f6f7a'; rond(c, tx + R * 0.05, ty + R * 0.05, R * 0.42); }
      levend(L_STOOM, tx, ty, R * 2.2);
    }
  },
  zonnepark(c, x, y, s) {
    const lod = B.lod, n = B.niveau, rijen = 4 + (n >= 2 ? 1 : 0);
    rect(c, x - s / 2, y - s / 2, s, s, '#7c8f58');
    if (lod >= 1) hekje(c, x - s * 0.47, y - s * 0.47, s * 0.94, s * 0.94);
    const rh = (s * 0.88) / rijen;
    for (let rij = 0; rij < rijen; rij++) {
      const ry = y - s * 0.44 + rij * rh;
      if (lod >= 1) rect(c, x - s * 0.42, ry + rh * 0.78, s * 0.84, rh * 0.12, 'rgba(0,0,0,0.25)');
      for (let k = 0; k < 3; k++) {
        if (n >= 3 && rij === rijen - 1 && k === 2) {
          // batterijopslag in containers
          for (let b = 0; b < 2; b++) { rect(c, x + s * 0.17, ry + b * rh * 0.4, s * 0.25, rh * 0.32, '#e8e8e2'); rect(c, x + s * 0.17, ry + b * rh * 0.4, s * 0.25, rh * 0.06, '#4c8ef7'); }
          continue;
        }
        const px = x - s * 0.42 + k * s * 0.29, pw = s * 0.26, ph = rh * 0.72;
        rect(c, px, ry, pw, ph, '#2e4f7a');
        c.strokeStyle = 'rgba(160,200,255,0.5)';
        c.lineWidth = 0.6;
        c.strokeRect(px, ry, pw, ph);
        if (lod >= 1) {
          c.strokeStyle = 'rgba(150,190,240,0.3)';
          c.beginPath();
          for (let xx = px + s * 0.03; xx < px + pw; xx += s * 0.03) { c.moveTo(xx, ry); c.lineTo(xx, ry + ph); }
          if (lod >= 2) { c.moveTo(px, ry + ph / 2); c.lineTo(px + pw, ry + ph / 2); }
          c.stroke();
        }
      }
      levend(L_GLINS, x - s * 0.42, ry, s * 0.84, rh * 0.72, rij);
    }
    if (lod >= 2) for (let i = 0; i < 3; i++) rect(c, x - s * 0.36 + i * s * 0.29, y + s * 0.455, s * 0.04, s * 0.03, '#8c949c');
  },
  industrie(c, x, y, s, st) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8a857c');
    // tanks met leidingen
    const tanks = [[0.33, -0.36], [0.33, -0.14]];
    if (lod >= 1) {
      c.strokeStyle = '#8c949c'; c.lineWidth = lijn(s, 0.012);
      c.beginPath();
      for (const [dx, dy] of tanks) { c.moveTo(x + dx * s, y + dy * s); c.lineTo(x + s * 0.17, y + dy * s); }
      c.stroke();
      if (lod >= 2) { c.fillStyle = '#6a7076'; for (const [, dy] of tanks) for (let i = 0; i < 3; i++) rond(c, x + s * (0.2 + i * 0.03), y + dy * s, s * 0.008); }
    }
    for (const [dx, dy] of tanks) silo(c, x + dx * s, y + dy * s, s * 0.08);
    // hoofdhal met zaagtanddak; het glas brandt 's nachts
    const hx = x - s * 0.44, hy = y - s * 0.22 + 2 * s * 0.017, hw = s * 0.6, hd = s * 0.34;
    const top = pand(c, hx, hy, hw, hd, 2, '#7d6f62', '#9a8d80', { units: 0, raamAfstand: 0.05 });
    const tanden = 6, tw = hw / tanden;
    for (let i = 0; i < tanden; i++) {
      rect(c, hx + i * tw, top, tw * 0.68, hd, '#8a7a6b');
      rect(c, hx + i * tw + tw * 0.68, top, tw * 0.32, hd, '#a9bcc6');
      raamVast(hx + i * tw + tw * 0.68, top, tw * 0.32, hd);
      if (lod >= 1) { c.strokeStyle = 'rgba(40,50,60,0.35)'; c.lineWidth = lijn(s, 0.002); c.beginPath(); for (let k = 1; k < 5; k++) { c.moveTo(hx + i * tw + tw * 0.68, top + (hd * k) / 5); c.lineTo(hx + (i + 1) * tw, top + (hd * k) / 5); } c.stroke(); }
    }
    if (lod >= 2) { c.fillStyle = '#5a5048'; for (let i = 0; i < tanden; i++) rond(c, hx + i * tw + tw * 0.34, top + hd * 0.5, s * 0.008); }
    if (B.verwaarloosd) roest(c, hx, top, hw, hd);
    // laaddeuren en vrachtwagens aan de zuidkant
    if (lod >= 1) {
      for (let i = 0; i < 3; i++) rect(c, hx + hw * (0.12 + i * 0.3), hy + hd - s * 0.022, hw * 0.12, s * 0.02, '#2e2a26');
      for (let i = 0; i < 2 + (lod >= 2 ? 1 : 0); i++) if (i === 0 || !vanaf(D11)) vrachtwagen(c, hx + hw * (0.18 + i * 0.3), hy + hd + s * 0.08, '#c0392b', false);
    }
    // kantoor in de stijl van het regime
    pand(c, x - s * 0.46, y + s * 0.34 + 3 * s * 0.017, s * 0.2, s * 0.08, 3, st.daken[0], st.muur, { schuin: !st.plat && !st.blokken, raamAfstand: 0.025 });
    rect(c, x - s * 0.46, y + s * 0.42 + 3 * s * 0.017 - s * 0.012, s * 0.2, s * 0.006, st.accent);
    if (n >= 2) pand(c, x + s * 0.2, y + s * 0.06 + 2 * s * 0.017, s * 0.26, s * 0.18, 2, '#8a7d70', '#9a8d80', { raamAfstand: 0.04 });
    if (n >= 3) { rails(c, x - s * 0.2, x + s * 0.5, y + s * 0.46, s); spoorwagons(c, x - s * 0.1, y + s * 0.46, 4, '#4a5560', '#8c949c'); }
    // schoorstenen
    for (let i = 0; i < 1 + (n >= 3 ? 1 : 0); i++) {
      const kx = x + s * (0.1 - i * 0.07), ky = y - s * 0.4;
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = s * 0.025;
      c.beginPath(); c.moveTo(kx, ky); c.lineTo(kx + s * 0.1, ky + s * 0.06); c.stroke();
      c.fillStyle = '#5a4f46'; rond(c, kx, ky, s * 0.022);
      c.fillStyle = '#2a2420'; rond(c, kx, ky, s * 0.012);
      levend(L_ROOK, kx, ky, s);
    }
  },
  chipfabriek(c, x, y, s, st) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, GRAS_LICHT);
    // parkeerplaats met bomen
    if (lod >= 1) {
      rect(c, x - s * 0.44, y + s * 0.26, s * 0.88, s * 0.18, '#55575a');
      c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = lijn(s, 0.002);
      c.beginPath(); for (let i = 0; i <= 10; i++) { c.moveTo(x - s * 0.42 + i * s * 0.084, y + s * 0.27); c.lineTo(x - s * 0.42 + i * s * 0.084, y + s * 0.33); } c.stroke();
      for (let i = 0; i < 10; i++) if (hash(B.seed, i, 41) < (lod >= 2 ? 0.75 : 0.45)) auto(c, x - s * 0.38 + i * s * 0.084, y + s * 0.3, autoKleur(i), false, 0.85);
      for (let i = 0; i < 4; i++) boom(c, x - s * 0.36 + i * s * 0.24, y + s * 0.41, s * 0.022);
    } else rect(c, x - s * 0.4, y + s * 0.3, s * 0.8, s * 0.12, '#55575a');
    // witte cleanroomhal met ventilatiepunten op het dak en een band in het accent
    const bx = x - s * 0.42, by = y - s * 0.36 + 2 * s * 0.017, bw = n >= 2 ? s * 0.5 : s * 0.84, bd = s * 0.5;
    const top = pand(c, bx, by, bw, bd, 2, '#e9eef2', '#dfe5ea', { units: 0, raamAfstand: 0.04 });
    rect(c, bx, by + bd - s * 0.02, bw, s * 0.006, st.accent);
    const rij = [3, 5, 7][lod];
    c.fillStyle = '#9aa6b2';
    for (let i = 0; i < rij; i++) for (let j = 0; j < 3; j++) rond(c, bx + bw * ((i + 0.5) / rij), top + bd * (0.2 + j * 0.3), s * (lod >= 2 ? 0.008 : 0.011));
    if (n >= 2) pand(c, x + s * 0.12, by, s * 0.32, bd * 0.7, 2, '#eef2f5', '#dfe5ea', { raamAfstand: 0.04 });
    if (n >= 3) { silo(c, x + s * 0.2, y + s * 0.12, s * 0.04); silo(c, x + s * 0.32, y + s * 0.12, s * 0.04); }
  },
  haven(c, x, y, s) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s * 0.62, '#6b665e');
    rect(c, x - s / 2, y + s * 0.12, s, s * 0.38, WATER);
    if (lod >= 1) {
      c.strokeStyle = 'rgba(180,220,235,0.18)'; c.lineWidth = lijn(s, 0.003);
      c.beginPath(); for (let i = 0; i < 4; i++) { const wy = y + s * (0.4 + i * 0.025); c.moveTo(x - s * 0.5 + i * s * 0.1, wy); c.lineTo(x - s * 0.2 + i * s * 0.12, wy); } c.stroke();
    }
    // kade met bolders en kraanbaan
    rect(c, x - s / 2, y + s * 0.1, s, s * 0.035, '#b0aca2');
    if (lod >= 1) {
      c.fillStyle = '#2e2a26';
      for (let i = 0; i < 12; i++) rond(c, x - s * 0.46 + i * s * 0.084, y + s * 0.125, s * 0.006);
      rails(c, x - s / 2, x + s / 2, y + s * 0.06, s);
    }
    // schip aan de kade, brug achteraan; het brugglas brandt 's nachts
    const sx0 = x - s * 0.44, sx1 = x + s * 0.4, sy0 = y + s * 0.18, sy1 = y + s * 0.34;
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); c.moveTo(sx0 + s * 0.01, sy0 + s * 0.015); c.lineTo(sx1 - s * 0.06, sy0 + s * 0.015); c.lineTo(sx1 + s * 0.04, (sy0 + sy1) / 2 + s * 0.015); c.lineTo(sx1 - s * 0.06, sy1 + s * 0.015); c.lineTo(sx0 + s * 0.01, sy1 + s * 0.015); c.closePath(); c.fill();
    c.fillStyle = '#3b3f45';
    c.beginPath(); c.moveTo(sx0, sy0); c.lineTo(sx1 - s * 0.08, sy0); c.lineTo(sx1, (sy0 + sy1) / 2); c.lineTo(sx1 - s * 0.08, sy1); c.lineTo(sx0, sy1); c.closePath(); c.fill();
    rect(c, sx0 + s * 0.02, sy0 + s * 0.015, sx1 - sx0 - s * 0.12, sy1 - sy0 - s * 0.03, '#7c8086');
    if (lod >= 1) {
      for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) rect(c, sx0 + s * (0.13 + i * 0.07), sy0 + s * (0.025 + j * 0.06), s * 0.062, s * 0.05, CONTAINERS[Math.floor(hash(B.seed, i * 2 + j, 51) * 5)]);
    }
    if (lod >= 2) {
      c.strokeStyle = 'rgba(230,230,220,0.6)'; c.lineWidth = lijn(s, 0.002);
      c.beginPath(); c.moveTo(sx0 + s * 0.02, sy0); c.lineTo(sx0 - s * 0.02, y + s * 0.125); c.moveTo(sx1 - s * 0.12, sy0); c.lineTo(sx1 - s * 0.08, y + s * 0.125); c.stroke();
    }
    rect(c, sx0 + s * 0.02, sy0 + s * 0.02, s * 0.09, sy1 - sy0 - s * 0.04, '#eceae4');
    rect(c, sx0 + s * 0.085, sy0 + s * 0.03, s * 0.015, sy1 - sy0 - s * 0.06, GLAS);
    raamVast(sx0 + s * 0.085, sy0 + s * 0.03, s * 0.015, sy1 - sy0 - s * 0.06);
    levend(L_LAMP, sx0 + s * 0.05, (sy0 + sy1) / 2);
    levend(L_LAMP, sx1 - s * 0.03, (sy0 + sy1) / 2);
    // containerstapels op de kade
    const rijen = 2 + (lod >= 1 ? 1 : 0);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < rijen; j++) {
        const cx = x - s * 0.44 + i * s * 0.15, cy = y - s * 0.44 + j * s * 0.09, kleur = CONTAINERS[Math.floor(hash(B.seed, i, j) * 5)];
        rect(c, cx + s * 0.006, cy + s * 0.006, s * 0.13, s * 0.065, 'rgba(0,0,0,0.3)');
        rect(c, cx, cy, s * 0.13, s * 0.065, kleur);
        if (lod >= 1) { c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = lijn(s, 0.002); c.beginPath(); for (let k = 1; k < 6; k++) { c.moveTo(cx + (s * 0.13 * k) / 6, cy); c.lineTo(cx + (s * 0.13 * k) / 6, cy + s * 0.065); } c.stroke(); }
        if (lod >= 2) rect(c, cx, cy + s * 0.032, s * 0.13, s * 0.004, 'rgba(0,0,0,0.25)');
      }
    }
    if (n >= 2) pand(c, x + s * 0.18, y - s * 0.44 + 2 * s * 0.017, s * 0.3, s * 0.15, 2, '#8c949c', '#a0a6ab', { raamAfstand: 0.05 });
    if (lod >= 1) { vrachtwagen(c, x + s * 0.24, y - s * 0.12, '#2e86c1', true); if (n >= 3) vrachtwagen(c, x + s * 0.24, y - s * 0.04, '#27ae60', true); }
    // twee kranen: onderstel vast, de arm zwaait boven het schip (levend)
    for (let i = 0; i < 2; i++) {
      const kx = x + s * (-0.22 + i * 0.36), ky = y + s * 0.06;
      rect(c, kx - s * 0.045 + s * 0.008, ky - s * 0.03 + s * 0.008, s * 0.09, s * 0.06, 'rgba(0,0,0,0.3)');
      rect(c, kx - s * 0.045, ky - s * 0.03, s * 0.09, s * 0.06, '#c9961e');
      rect(c, kx - s * 0.03, ky - s * 0.018, s * 0.06, s * 0.036, '#e0b020');
      levend(L_KRAAN, kx, ky, s * 0.26, 0, i);
    }
  },
  opslag(c, x, y, s) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8a857c');
    for (let i = 0; i < 2; i++) {
      const by = y - s * 0.4 + i * s * 0.32 + 2 * s * 0.017;
      const top = pand(c, x - s * 0.44, by, s * 0.58, s * 0.2, 2, '#8c949c', '#a0a6ab', { units: 0, raamAfstand: 0.06 });
      c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = 0.6;
      c.beginPath(); for (let k = 1; k < 5; k++) { c.moveTo(x - s * 0.44 + k * s * 0.116, top); c.lineTo(x - s * 0.44 + k * s * 0.116, top + s * 0.2); } c.stroke();
      if (lod >= 1) for (let k = 0; k < 3; k++) rect(c, x - s * 0.4 + k * s * 0.18, by + s * 0.2 - s * 0.018, s * 0.08, s * 0.016, '#2e2a26');
    }
    for (let i = 0; i < 1 + n; i++) silo(c, x + s * 0.32, y - s * 0.36 + i * s * 0.16, s * 0.065);
    const pallets = [3, 6, 9][lod];
    for (let i = 0; i < pallets; i++) rect(c, x - s * 0.42 + (i % 6) * s * 0.07, y + s * 0.34 + Math.floor(i / 6) * s * 0.06, s * 0.05, s * 0.04, '#a67c52');
    if (lod >= 1) {
      // heftruck
      rect(c, x + s * 0.06, y + s * 0.34, s * 0.04, s * 0.03, '#e0b020');
      c.strokeStyle = '#555'; c.lineWidth = lijn(s, 0.003);
      c.beginPath(); c.moveTo(x + s * 0.1, y + s * 0.345); c.lineTo(x + s * 0.13, y + s * 0.345); c.moveTo(x + s * 0.1, y + s * 0.365); c.lineTo(x + s * 0.13, y + s * 0.365); c.stroke();
    }
    if (lod >= 2) vrachtwagen(c, x + s * 0.06, y + s * 0.22, '#2c3e50', true);
  },
  school(c, x, y, s, st) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#b3aa98');
    // sportveld met belijning, op lod2 met een atletiekbaan eromheen
    const fx = x + s * 0.06, fy = y - s * 0.04, fw = s * 0.38, fh = s * 0.46;
    if (lod >= 2) { c.strokeStyle = '#b5523b'; c.lineWidth = s * 0.03; c.beginPath(); c.roundRect(fx - s * 0.015, fy - s * 0.015, fw + s * 0.03, fh + s * 0.03, s * 0.08); c.stroke(); }
    rect(c, fx, fy, fw, fh, '#5f9e53');
    c.strokeStyle = '#fff';
    c.lineWidth = Math.max(0.7, s * 0.004);
    c.strokeRect(fx + s * 0.03, fy + s * 0.03, fw - s * 0.06, fh - s * 0.06);
    if (lod >= 1) {
      c.beginPath(); c.moveTo(fx + s * 0.03, fy + fh / 2); c.lineTo(fx + fw - s * 0.03, fy + fh / 2); c.stroke();
      c.beginPath(); c.arc(fx + fw / 2, fy + fh / 2, s * 0.05, 0, Math.PI * 2); c.stroke();
      c.strokeRect(fx + fw * 0.3, fy + s * 0.03, fw * 0.4, s * 0.06);
      c.strokeRect(fx + fw * 0.3, fy + fh - s * 0.09, fw * 0.4, s * 0.06);
    }
    // L-vormig schoolgebouw
    const v = 1 + Math.min(2, n), hgt = v * s * 0.017;
    pand(c, x - s * 0.44, y - s * 0.3 + hgt, s * 0.16, s * 0.58, v, st.daken[0], '#d9a441', { schuin: !st.plat, raamAfstand: 0.03 });
    pand(c, x - s * 0.44, y - s * 0.44 + hgt, s * 0.48, s * 0.16, v, st.daken[0], '#d9a441', { schuin: !st.plat, raamAfstand: 0.03 });
    if (lod >= 1) {
      for (let i = 0; i < 3; i++) boom(c, x - s * 0.18 + i * s * 0.07, y + s * 0.08 + i * s * 0.08, s * 0.024);
      vrachtwagen(c, x - s * 0.18, y + s * 0.42, '#f0b429', true, '#f0b429');
    }
    if (lod >= 2) { c.strokeStyle = '#555'; c.lineWidth = lijn(s, 0.003); c.beginPath(); for (let i = 0; i < 6; i++) { c.moveTo(x - s * 0.24 + i * s * 0.015, y - s * 0.22); c.lineTo(x - s * 0.24 + i * s * 0.015, y - s * 0.19); } c.stroke(); }
  },
  universiteit(c, x, y, s, st) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#b9b09c');
    // binnenplein met kruisende paden en bomen rondom
    const qx = x - s * 0.3, qy = y - s * 0.12, qw = s * 0.6, qh = s * 0.58;
    rect(c, qx, qy, qw, qh, GRAS);
    c.strokeStyle = '#d8cfb4'; c.lineWidth = s * 0.018;
    c.beginPath(); c.moveTo(qx, qy); c.lineTo(qx + qw, qy + qh); c.moveTo(qx + qw, qy); c.lineTo(qx, qy + qh); c.stroke();
    const bomen = [4, 8, 12][lod];
    for (let i = 0; i < bomen; i++) {
      const f = (i + 0.5) / bomen, kant = i % 2;
      boom(c, kant ? qx + qw * 0.06 : qx + qw * 0.94, qy + qh * f, s * 0.022);
    }
    if (lod >= 2) { c.fillStyle = '#c9c2b2'; rond(c, qx + qw / 2, qy + qh / 2, s * 0.03); c.fillStyle = '#5d9fb8'; rond(c, qx + qw / 2, qy + qh / 2, s * 0.022); }
    // gebouwen rond het plein; het hoofdgebouw heeft een eenvoudige koepel
    const hgt = 3 * s * 0.017;
    pand(c, x - s * 0.46, y - s * 0.12 + 2 * s * 0.017, s * 0.14, s * 0.56, 2, st.daken[0], st.muur, { schuin: !st.plat });
    pand(c, x + s * 0.32, y - s * 0.12 + 2 * s * 0.017, s * 0.14, s * 0.56, 2, st.daken[0], st.muur, { schuin: !st.plat });
    pand(c, x - s * 0.46, y - s * 0.44 + hgt, s * 0.92, s * 0.16, 3, st.daken[0], st.muur, { schuin: !st.plat, raamAfstand: 0.03 });
    koepel(c, x, y - s * 0.44 + s * 0.08, s * 0.07, '#8fa9c9');
    if (n >= 2) pand(c, x + s * 0.12, y + s * 0.3 + 2 * s * 0.017, s * 0.18, s * 0.12, 2, '#7c8a99', st.muur, { raamAfstand: 0.03 });
    if (n >= 3) pand(c, x - s * 0.28, y + s * 0.28 + 6 * s * 0.017 - s * 0.06, s * 0.12, s * 0.1, 6, '#6d7884', '#c9ced6', { kern: true, raamAfstand: 0.025 });
  },
  ziekenhuis(c, x, y, s) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#a9b1a6');
    if (lod >= 1) {
      rect(c, x - s * 0.46, y + s * 0.3, s * 0.5, s * 0.16, '#55575a');
      for (let i = 0; i < 6; i++) if (hash(B.seed, i, 61) < 0.7) auto(c, x - s * 0.42 + i * s * 0.08, y + s * 0.38, autoKleur(i), false, 0.85);
      for (let i = 0; i < 3; i++) boom(c, x + s * 0.12 + i * s * 0.12, y + s * 0.44, s * 0.022);
    }
    if (n >= 2) pand(c, x + s * 0.22, y - s * 0.3 + 3 * s * 0.017, s * 0.22, s * 0.44, 3, '#e4e8e8', '#dfe3e3', { raamAfstand: 0.025 });
    if (n >= 3) pand(c, x - s * 0.46, y - s * 0.44 + 2 * s * 0.017, s * 0.18, s * 0.16, 2, '#e4e8e8', '#dfe3e3', { raamAfstand: 0.025 });
    // hoofdgebouw met helikopterplatform op het dak (een H van drie balkjes, geen kruis)
    const bx = x - s * 0.3, by = y - s * 0.28 + 4 * s * 0.017, bw = s * 0.5, bd = s * 0.42;
    const top = pand(c, bx, by, bw, bd, 4, '#eef0f0', '#e2e5e6', { units: 2, raamAfstand: 0.025 });
    rect(c, bx, by + bd - s * 0.02, bw, s * 0.006, '#3a9a6a');
    const hx = bx + bw * 0.55, hy = top + bd * 0.5, hr = s * 0.09;
    c.fillStyle = '#5c6166'; rond(c, hx, hy, hr);
    if (lod >= 1) {
      c.strokeStyle = '#f2f2ef'; c.lineWidth = lijn(s, 0.006);
      c.beginPath(); c.arc(hx, hy, hr * 0.8, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#f2f2ef';
      c.fillRect(hx - hr * 0.35, hy - hr * 0.4, hr * 0.14, hr * 0.8);
      c.fillRect(hx + hr * 0.21, hy - hr * 0.4, hr * 0.14, hr * 0.8);
      c.fillRect(hx - hr * 0.35, hy - hr * 0.07, hr * 0.7, hr * 0.14);
      // ambulance met zwaailicht
      const ax = x + s * 0.12, ay = y + s * 0.22;
      rect(c, ax - s * 0.035 + s * 0.005, ay - s * 0.02 + s * 0.005, s * 0.07, s * 0.04, 'rgba(0,0,0,0.3)');
      rect(c, ax - s * 0.035, ay - s * 0.02, s * 0.07, s * 0.04, '#f6f6f2');
      rect(c, ax - s * 0.035, ay - s * 0.004, s * 0.07, s * 0.008, '#d9443c');
      levend(L_ZWAAI, ax, ay - s * 0.012, 0, 0, 0);
    }
    if (lod >= 2) for (let i = 0; i < 4; i++) levend(L_LAMP, hx + Math.cos(i * Math.PI / 2 + 0.78) * hr, hy + Math.sin(i * Math.PI / 2 + 0.78) * hr);
  },
  politie(c, x, y, s, st) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8f918c');
    if (lod >= 1) hekje(c, x - s * 0.46, y - s * 0.46, s * 0.92, s * 0.92);
    if (n >= 2) pand(c, x + s * 0.26, y - s * 0.1 + s * 0.017, s * 0.18, s * 0.2, 1, '#5b6470', '#8a929c', { raamAfstand: 0.06 });
    pand(c, x - s * 0.38, y - s * 0.36 + 3 * s * 0.017, s * 0.6, s * 0.26, 3, '#4a5a6e', '#c9ced6', { units: 2, raamAfstand: 0.028 });
    rect(c, x - s * 0.38, y - s * 0.1 - s * 0.018, s * 0.6, s * 0.008, '#3b5b8c');
    if (n >= 3) pand(c, x - s * 0.42, y + s * 0.02 + 2 * s * 0.017, s * 0.2, s * 0.12, 2, '#4a5a6e', '#c9ced6', { raamAfstand: 0.04 });
    // surveillancewagens
    const wagens = [2, 3, 4][lod];
    for (let i = 0; i < wagens; i++) {
      const ax = x - s * 0.3 + i * s * 0.18, ay = y + s * 0.33;
      rect(c, ax - s * 0.06 + s * 0.005, ay - s * 0.025 + s * 0.005, s * 0.12, s * 0.05, 'rgba(0,0,0,0.3)');
      rect(c, ax - s * 0.06, ay - s * 0.025, s * 0.12, s * 0.05, '#e8eef6');
      rect(c, ax + s * 0.03, ay - s * 0.025, s * 0.03, s * 0.05, '#3b5b8c');
      if (lod >= 1) { rect(c, ax - s * 0.012, ay - s * 0.02, s * 0.01, s * 0.019, '#d9443c'); rect(c, ax - s * 0.012, ay + s * 0.001, s * 0.01, s * 0.019, '#3d7bff'); }
    }
    if (lod >= 1) { levend(L_ZWAAI, x - s * 0.3, y + s * 0.33, 0, 0, 1); paal(c, x + s * 0.32, y - s * 0.3, s * 0.12, 0); }
  },
  rechtbank(c, x, y, s, st) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, GRAS);
    rect(c, x - s * 0.3, y + s * 0.12, s * 0.6, s * 0.38, PLEIN);
    if (lod >= 1) {
      c.fillStyle = 'rgba(255,255,255,0.4)';
      for (let i = 0; i < 4; i++) c.fillRect(x - s * 0.3, y + s * (0.13 + i * 0.012), s * 0.6, s * 0.004);
      for (const dx of [-0.4, 0.4]) for (let i = 0; i < 3; i++) boom(c, x + dx * s, y + s * (0.15 + i * 0.12), s * 0.03);
    }
    if (lod >= 2) for (const dx of [-0.2, 0.2]) { c.fillStyle = '#c9c2b2'; rond(c, x + dx * s, y + s * 0.3, s * 0.02); }
    const v = 2 + Math.min(2, n), hgt = v * s * 0.017;
    const bx = x - s * 0.4, by = y - s * 0.3 + hgt, bw = s * 0.8, bd = s * 0.34;
    const top = pand(c, bx, by, bw, bd, v, '#b8ad97', st.muur, { units: 0, geenRamen: true });
    zuilen(c, bx, by + bd - hgt, bw, hgt, lod >= 1 ? 10 : 6);
    // timpaan aan de voorkant
    c.fillStyle = tint('#b8ad97', 1.15);
    c.beginPath(); c.moveTo(bx, top + bd); c.lineTo(bx + bw / 2, top + bd * 0.55); c.lineTo(bx + bw, top + bd); c.fill();
    if (lod >= 1) { c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = lijn(s); c.beginPath(); c.moveTo(bx + bw / 2, top); c.lineTo(bx + bw / 2, top + bd * 0.55); c.stroke(); }
  },
  omroep(c, x, y, s) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8e9188');
    pand(c, x - s * 0.42, y + s * 0.0 + 2 * s * 0.017, s * 0.5, s * 0.3, 2, '#6c7a89', '#aeb6bf', { units: 2, raamAfstand: 0.03 });
    if (n >= 2) pand(c, x - s * 0.42, y - s * 0.4 + 2 * s * 0.017, s * 0.3, s * 0.2, 2, '#6c7a89', '#aeb6bf', { raamAfstand: 0.03 });
    if (lod >= 1) {
      for (const [dx, dy] of [[0.0, -0.3], [-0.06, 0.4]]) {
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(x + dx * s + s * 0.008, y + dy * s + s * 0.008, s * 0.05, s * 0.04, 0.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#d8dde2'; c.beginPath(); c.ellipse(x + dx * s, y + dy * s, s * 0.05, s * 0.04, 0.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#555'; rond(c, x + dx * s, y + dy * s, s * 0.008);
      }
    }
    // vakwerkmast met tuidraden; het lampje bovenin knippert
    const mx = x + s * 0.25, voet = y + s * 0.38, topY = y - s * 0.42;
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(1, s * 0.02);
    c.beginPath(); c.moveTo(mx, voet); c.lineTo(mx + s * 0.2, voet + s * 0.12); c.stroke();
    if (lod >= 1) {
      c.strokeStyle = 'rgba(220,225,230,0.5)'; c.lineWidth = lijn(s, 0.002);
      c.beginPath(); for (const dx of [-0.16, 0.16]) { c.moveTo(mx, topY + s * 0.2); c.lineTo(mx + dx * s, voet); } c.stroke();
    }
    c.strokeStyle = '#c7ccd1';
    c.lineWidth = Math.max(1, s * 0.01);
    const b = s * 0.03, delen = [4, 8, 14][lod];
    c.beginPath();
    c.moveTo(mx - b, voet); c.lineTo(mx, topY); c.lineTo(mx + b, voet);
    for (let i = 0; i < delen; i++) {
      const f0 = i / delen, f1 = (i + 1) / delen;
      c.moveTo(mx - b * (1 - f0), voet + (topY - voet) * f0); c.lineTo(mx + b * (1 - f1), voet + (topY - voet) * f1);
    }
    c.stroke();
    levend(L_KNIPPER, mx, topY, s * 1.3, 0, 0);
    if (n >= 3) { c.strokeStyle = '#c7ccd1'; c.beginPath(); c.moveTo(mx - s * 0.12, voet); c.lineTo(mx - s * 0.12, y - s * 0.05); c.stroke(); levend(L_KNIPPER, mx - s * 0.12, y - s * 0.05, s, 0, 1); }
  },
  kazerne(c, x, y, s, st) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8a8a76');
    hek(c, x, y, s, '#8a8a73');
    // paradeplaats
    rect(c, x - s * 0.04, y - s * 0.42, s * 0.46, s * 0.4, '#9a9a8a');
    if (lod >= 1) {
      c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = lijn(s, 0.003);
      c.beginPath(); for (let i = 1; i < 4; i++) { c.moveTo(x - s * 0.04 + (s * 0.46 * i) / 4, y - s * 0.4); c.lineTo(x - s * 0.04 + (s * 0.46 * i) / 4, y - s * 0.04); } c.stroke();
    }
    paal(c, x + s * 0.19, y - s * 0.22, s * 0.14, 0);
    // barakken
    for (let i = 0; i < 3; i++) pand(c, x - s * 0.42, y - s * 0.36 + i * s * 0.22 + s * 0.017, s * 0.3, s * 0.12, 1, '#6b6b55', '#a39a7a', { schuin: true, raamAfstand: 0.04 });
    // voertuigen in rijen
    const rij = [3, 5, 7][lod];
    for (let i = 0; i < rij; i++) vrachtwagen(c, x - s * 0.0 + i * s * 0.06, y + s * 0.24, '#5d6b4a', false, '#6b7a55');
    if (lod >= 1) pand(c, x + s * 0.34, y - s * 0.44 + 4 * s * 0.017, s * 0.06, s * 0.06, 4, '#5a5a48', '#7a7a62', { units: 0, geenRamen: true });
    if (n >= 2) pand(c, x - s * 0.02, y + s * 0.36 + s * 0.017, s * 0.42, s * 0.08, 1, '#73715c', '#8f8f78', { geenRamen: true });
    if (n >= 3) for (let i = 0; i < 3; i++) tankje(c, x + s * 0.06 + i * s * 0.12, y + s * 0.06);
  },
  wapenfabriek(c, x, y, s) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#7a7a70');
    hek(c, x, y, s, '#6d6d6d');
    if (n >= 2) { c.strokeStyle = '#8c7d68'; c.lineWidth = s * 0.03; c.beginPath(); c.ellipse(x + s * 0.3, y - s * 0.1, s * 0.1, s * 0.22, 0, 0, Math.PI * 2); c.stroke(); }
    const top = pand(c, x - s * 0.38, y - s * 0.3 + 2 * s * 0.017, s * 0.56, s * 0.46, 2, '#4f4a45', '#6d675f', { units: 0, raamAfstand: 0.05 });
    if (lod >= 1) { c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = lijn(s, 0.003); c.beginPath(); for (let i = 1; i < 8; i++) { c.moveTo(x - s * 0.38 + (s * 0.56 * i) / 8, top); c.lineTo(x - s * 0.38 + (s * 0.56 * i) / 8, top + s * 0.46); } c.stroke(); }
    if (B.verwaarloosd) roest(c, x - s * 0.38, top, s * 0.56, s * 0.46);
    // schoorsteen met rook
    const kx = x + s * 0.24, ky = y - s * 0.38;
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = s * 0.025;
    c.beginPath(); c.moveTo(kx, ky); c.lineTo(kx + s * 0.1, ky + s * 0.06); c.stroke();
    c.fillStyle = '#3a3632'; rond(c, kx, ky, s * 0.024);
    levend(L_ROOK, kx, ky, s);
    const rij = [3, 4, 5][lod];
    for (let i = 0; i < rij; i++) tankje(c, x - s * 0.32 + i * s * 0.13, y + s * 0.32);
    if (lod >= 1) for (const [dx, dy] of [[-0.42, -0.42], [0.36, 0.36]]) pand(c, x + dx * s, y + dy * s + 3 * s * 0.017, s * 0.06, s * 0.06, 3, '#5a5a50', '#7a7a70', { units: 0, geenRamen: true });
    if (n >= 3) pand(c, x + s * 0.22, y + s * 0.1 + s * 0.017, s * 0.2, s * 0.12, 1, '#5d6b4a', '#7a7a62', { geenRamen: true });
  },
  dronebasis(c, x, y, s) {
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#7c8f58');
    rect(c, x - s * 0.45, y - s * 0.08, s * 0.9, s * 0.16, '#3d3f42');
    c.strokeStyle = '#f0f0f0';
    c.setLineDash([s * 0.06, s * 0.05]);
    c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(x - s * 0.36, y); c.lineTo(x + s * 0.36, y); c.stroke();
    c.setLineDash([]);
    if (lod >= 1) {
      c.fillStyle = '#f0f0f0';
      for (const kant of [-1, 1]) for (let i = 0; i < 4; i++) c.fillRect(x + kant * s * 0.41 - s * 0.01, y - s * 0.06 + i * s * 0.035, s * 0.02, s * 0.018);
    }
    if (lod >= 2) for (let i = 0; i < 6; i++) { levend(L_LAMP, x - s * 0.4 + i * s * 0.16, y - s * 0.085); levend(L_LAMP, x - s * 0.4 + i * s * 0.16, y + s * 0.085); }
    // platform met geparkeerde drones
    rect(c, x - s * 0.1, y + s * 0.14, s * 0.55, s * 0.3, '#6e7276');
    const aantal = 1 + Math.min(2, n);
    for (let i = 0; i < aantal; i++) drone(c, x + s * (0.02 + i * 0.15), y + s * 0.29, s * 0.035);
    const top = pand(c, x - s * 0.36, y - s * 0.42 + 2 * s * 0.017, s * 0.36, s * 0.24, 2, '#7c858e', '#9aa3ab', { units: 0, raamAfstand: 0.06 });
    if (lod >= 1) { c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = lijn(s, 0.003); c.beginPath(); for (let i = 1; i < 6; i++) { c.moveTo(x - s * 0.36, top + (s * 0.24 * i) / 6); c.lineTo(x, top + (s * 0.24 * i) / 6); } c.stroke(); }
    pand(c, x + s * 0.14, y - s * 0.38 + 4 * s * 0.017, s * 0.08, s * 0.08, 4, '#5b6470', '#c9ced6', { units: 0, raamAfstand: 0.03 });
    levend(L_KNIPPER, x + s * 0.18, y - s * 0.38, s, 0, 0);
    if (lod >= 1) levend(L_VOERTUIG, x + s * 0.18, y + s * 0.29, s * 0.14, 0, 2);
  },
  cybercentrum(c, x, y, s) {
    // laag datacentrum met serverrijen en koelers op het dak; de lampjes knipperen als het in bedrijf is
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#7d8084');
    if (lod >= 1) hekje(c, x - s * 0.47, y - s * 0.47, s * 0.94, s * 0.94);
    if (n >= 2) pand(c, x - s * 0.42, y + s * 0.3 + s * 0.017, s * 0.4, s * 0.12, 1, '#2b3138', '#4a525b', { units: 0, geenRamen: true });
    const top = pand(c, x - s * 0.42, y - s * 0.32 + 2 * s * 0.017, s * 0.84, s * 0.56, 2, '#2b3138', '#4a525b', { units: 0, geenRamen: true });
    for (let i = 0; i < 4; i++) {
      const rx = x - s * 0.36 + i * s * 0.19;
      rect(c, rx, top + s * 0.06, s * 0.12, s * 0.44, '#3c4650');
      if (lod >= 1) {
        c.fillStyle = '#56606b';
        const fans = lod >= 2 ? 4 : 2;
        for (let k = 0; k < fans; k++) rond(c, rx + s * 0.06, top + s * (0.18 + (k * 0.3) / fans), s * 0.035);
        if (lod >= 2) { c.strokeStyle = '#2b3138'; c.lineWidth = lijn(s, 0.002); for (let k = 0; k < fans; k++) { c.beginPath(); c.arc(rx + s * 0.06, top + s * (0.18 + (k * 0.3) / fans), s * 0.022, 0, Math.PI * 2); c.stroke(); } }
      }
      levend(L_LED, rx + s * 0.03, top + s * 0.1, s * 0.05, s * 0.04, i);
    }
    if (lod >= 2) for (let i = 0; i < 3; i++) rect(c, x + s * 0.1 + i * s * 0.1, y + s * 0.34, s * 0.07, s * 0.05, '#5a6168');
    c.strokeStyle = '#c7ccd1';
    c.lineWidth = Math.max(1, s * 0.025);
    c.beginPath(); c.arc(x + s * 0.3, y + s * 0.4, s * 0.08, Math.PI, 0); c.stroke();
  },
};

// Soorten met bewoners: hun niveau volgt uit bezetting, en onrust timmert ramen dicht.
const WONEN = { hoofdstad: true, woonwijk: true };

function niveauVan(soort, ctx) {
  let n;
  if (WONEN[soort]) {
    if (ctx.L != null && ctx.capaciteit > 0) {
      // drukte (bezetting) of groei (bijgebouwde woningen t.o.v. de start) maakt de wijk dichter;
      // de sim houdt de bezetting vrijwel altijd onder 1, dus zonder groei kwam niveau 3 nooit voor
      const b = ctx.L / ctx.capaciteit, groei = ctx.basis > 0 ? ctx.capaciteit / ctx.basis : 1;
      n = 1 + (b > 0.9 || groei > 1.15) + (b > 1.2 || groei > 1.35);
    }
    else if (ctx.niveau != null) n = ctx.niveau;
    else {
      // zonder cijfers groeit de wijk met het aantal woonwijken; een op de vier blijft een trede lager
      const a = ctx.aantal ?? 1;
      n = 1 + (a >= 3) + (a >= 6);
      if (n > 1 && hash(ctx.seed ?? 0, 11) < 0.25) n -= 1;
    }
  } else if (soort === 'kolonie') n = ctx.niveau ?? 1;
  else n = ctx.niveau ?? 1 + ((ctx.eff ?? 1) >= 1.05) + ((ctx.aantal ?? 1) >= 4);
  return n < 1 ? 1 : n > 3 ? 3 : n | 0;
}

const lodVan = (s) => (s < LOD1 ? 0 : s <= LOD2 ? 1 : 2);
const effEmmer = (eff) => (eff < 0.7 ? 0 : eff < 1.05 ? 1 : 2);

// Zet de bakcontext voor één gebouw.
function zetB(soort, ctx, S, cx, cy, niveau, effB, ramen, levendLijst, sz, groeiend, wv = 1) {
  B.S = S; B.cx = cx; B.cy = cy; B.lod = lodVan(S); B.niveau = niveau;
  B.seed = ctx.seed ?? 0; B.regime = ctx.regime; B.kleur = ctx.kleur;
  B.verwaarloosd = effB === 0; B.uit = !!ctx.uit;
  B.onrust = !!WONEN[soort] && ctx.stab != null && ctx.stab < 30;
  B.oorlog = soort === 'hoofdstad' && !!ctx.oorlog;
  B.strak = stijlVan(ctx.regime).strak === true;
  B.r2 = rnd(B.seed * 7919 + 101);
  B.ramen = ramen; B.levend = levendLijst;
  B.sneeuw = sz.sneeuw; B.blad = sz.blad; B.groeiend = groeiend; B.nieuw = 0; B.lamp = 0;
  B.soort = soort; B.wv = wv; B.nieuwB = 0;
  [GRAS, GRAS_LICHT, HEG] = GRAS_SEIZOEN[sz.blad];
}

// Basistekening plus de extra's van pakket D voor deze soort.
function tekenAlles(f, naam, c, x, y, s, st, ctx) {
  f(c, x, y, s, st, rnd((ctx.seed ?? 0) * 7919 + 13), B);
  EXTRA[naam]?.(c, x, y, s, st);
  BEDRIJF[naam]?.(c, x, y, s, st);
  if (vanaf(D11)) kavelStaat(c, x, y, s, naam);
  if (!WONEN[naam] && !GEEN_RANDGOED[naam] && vanaf(D13)) randGoed(c, x, y, s);
}

// Heel klein spul op de rand van een bedrijfsterrein, pas vanaf D13 (zoom 13–14): tonnen, pionnen, kratten,
// werkers met een helm en een fiets tegen het hek. Langs de zuid- en oostrand, waar meestal grond of hek is.
// Niet bij de haven (daar ligt water aan de zuid- en oostrand) en niet bij een kolonie (alleen de ronde open
// plek is grond; de hoeken zijn doorzichtig, daar ligt het terrein of de zee eronder).
const GEEN_RANDGOED = { haven: true, kolonie: true };
function randGoed(c, x, y, s) {
  for (let i = 0; i < 9; i++) {
    const h = hash(B.seed, i, 95), zuid = i % 2 === 0;
    const px = zuid ? x - s * 0.42 + s * 0.84 * hash(B.seed, i, 96) : x + s * 0.475;
    const py = zuid ? y + s * 0.475 : y - s * 0.42 + s * 0.84 * hash(B.seed, i, 96);
    const r = s * 0.0045;
    c.fillStyle = 'rgba(0,0,0,0.25)'; rond(c, px + r * 0.6, py + r * 0.5, r);
    if (h < 0.25) { c.fillStyle = h < 0.12 ? '#2e6eb5' : '#a8322a'; rond(c, px, py, r); c.fillStyle = 'rgba(255,255,255,0.3)'; rond(c, px - r * 0.3, py - r * 0.3, r * 0.35); }
    else if (h < 0.45) { c.fillStyle = '#f07a2a'; rond(c, px, py, r * 0.8); c.fillStyle = '#f4f4f0'; rond(c, px, py, r * 0.35); }
    else if (h < 0.65) { rect(c, px - r, py - r, r * 2, r * 2, '#a67c52'); rect(c, px - r, py - r * 0.15, r * 2, r * 0.3, '#7a5a3a'); }
    else if (h < 0.85) { c.fillStyle = '#3a4a5a'; rond(c, px, py + r * 0.4, r * 0.7); c.fillStyle = '#f0c020'; rond(c, px, py - r * 0.2, r * 0.55); }
    else fietsenrek(c, px - r, py, 2, zuid);
  }
}

// Groeiende wijk: als de woningvoorraad boven de start ligt, staat er af en toe een bouwplaats (wisselt per 40 dagen).
function groeitVan(naam, ctx, dag) {
  if (naam !== 'woonwijk') return false;
  const blok = typeof dag === 'number' ? Math.floor(dag / 40) : 0, seed = ctx.seed ?? 0;
  if (ctx.capaciteit > 0 && ctx.basis > 0) return ctx.capaciteit / ctx.basis > 1.02 && hash(seed, blok, 13) < 0.4;
  return hash(seed, blok, 13) < 0.15;
}

// Tekent een gebouw in detail. Geeft false terug als er geen detailtekening is (dan valt de kaart terug op het icoon).
export function tekenGebouwDetail(c, soort, x, y, s, ctx) {
  const naam = TEKEN[soort] ? soort : TEKEN[ctx.alias] ? ctx.alias : null;
  if (!naam) return false;
  const f = TEKEN[naam];
  const st = stijlVan(ctx.regime);
  const niveau = niveauVan(naam, ctx);
  const effB = effEmmer(ctx.eff ?? 1);
  const uit = ctx.uit ? 1 : 0;
  const dag = dagVan(ctx), sz = seizoenVan(dag), groeiend = groeitVan(naam, ctx, dag), wv = welzijnVan(ctx);
  const toestand = (WONEN[naam] && ctx.stab != null && ctx.stab < 30 ? 'o' : '') + (naam === 'hoofdstad' && ctx.oorlog ? 'w' : '');
  // Schaal van het doel (apparaatpixels per CSS-pixel), zodat de bitmap 1-op-1 op het scherm valt.
  const m = typeof c.getTransform === 'function' ? c.getTransform() : null;
  const dpr = m && m.a > 0 ? m.a : typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
  const echt = Math.round(s * dpr); // exacte maat in apparaatpixels; boven MAX_PX wordt de bitmap geschaald getoond
  const px = Math.min(MAX_PX, Math.max(8, echt));
  const lod = lodVan(s);
  // De eigenaarskleur hoort niet in de sleutel: rand en vlaggen in die kleur worden per beeld getekend,
  // dus een land dat van blok wisselt hoeft niets opnieuw te bakken.
  // Seizoen en bouwplaats wisselen vanzelf in de loop van het spel, voor alle gebouwen in beeld tegelijk. Daarom
  // zitten ze wel in de sleutel maar niet in 'vast': zolang de nieuwe bitmap nog niet gebakken is (hoogstens vier
  // per beeld), staat de vorige als vervanger klaar en hoeft er niets rechtstreeks getekend te worden.
  const vast = `${naam}|${ctx.seed}|${ctx.regime}|${niveau}|${effB}|${uit}|${toestand}`;
  // Welvaart en rust van het land (pakket B) wisselen ook in de loop van het spel: net als het seizoen buiten 'vast'.
  const basis = `${vast}|${groeiend ? 'g' : ''}|${sz.sleutel}|${wv}`;
  const sleutel = `${basis}|${px}|${lod}`;

  let e = CACHE.get(sleutel);
  if (e) {
    CACHE.delete(sleutel);
    CACHE.set(sleutel, e);
  } else {
    const beeld = Math.floor((ctx.tijd ?? 0) * 60);
    if (beeld !== bakBeeld) { bakBeeld = beeld; bakTeller = 0; }
    // Zoomt de speler nog (andere maat dan vorig beeld) en ligt de vorige bitmap dichtbij, dan die geschaald tonen;
    // pas als de maat stil staat wordt er op de exacte maat gebakken, hoogstens een paar per beeld.
    const vorige = LAATSTE.get(vast);
    const verhouding = vorige ? vorige.px / px : 0;
    const zoomt = Math.abs((VORIGE_MAAT.get(vast) ?? s) - s) > 0.01;
    if (vorige && ((zoomt && verhouding > 1 / ZOOMMARGE && verhouding < ZOOMMARGE) || bakTeller >= BAKKEN_PER_BEELD)) e = vorige;
    else if (!vorige && bakTeller >= BAKKEN_PER_BEELD) {
      // Geen vervanger en het bakbudget van dit beeld is op: dit beeld rechtstreeks tekenen (hieronder), volgend beeld bakken.
    } else {
      const doek = fabriek(px, px);
      if (doek) {
        bakTeller++;
        const g = doek.getContext('2d');
        g.setTransform(px / s, 0, 0, px / s, 0, 0);
        const ramen = [], lev = [];
        zetB(naam, ctx, s, s / 2, s / 2, niveau, effB, ramen, lev, sz, groeiend, wv);
        tekenAlles(f, naam, g, s / 2, s / 2, s, st, ctx);
        B.ramen = B.levend = null;
        e = { doek, px, bytes: px * px * 4, vast, ramen: Float32Array.from(ramen), levend: Float32Array.from(lev), lod, verwaarloosd: effB === 0, uit: !!uit };
        CACHE.set(sleutel, e);
        LAATSTE.set(vast, e);
        cacheBytes += e.bytes;
        opruimen();
      }
    }
  }
  VORIGE_MAAT.set(vast, s);

  if (ctx.voortgang != null) c.globalAlpha = 0.35 + 0.65 * ctx.voortgang;
  if (e) {
    if (e.px === echt) {
      // exacte maat: op hele apparaatpixels, dan kopieert de browser zonder herbemonstering
      c.drawImage(e.doek, Math.round((x - s / 2) * dpr) / dpr, Math.round((y - s / 2) * dpr) / dpr, px / dpr, px / dpr);
    } else c.drawImage(e.doek, x - s / 2, y - s / 2, s, s);
  } else {
    // Geen canvas beschikbaar (headless zonder fabriek): rechtstreeks tekenen, binnen het vakje geknipt.
    const ramen = [], lev = [];
    c.save();
    c.beginPath();
    c.rect(x - s / 2, y - s / 2, s, s);
    c.clip();
    zetB(naam, ctx, s, x, y, niveau, effB, ramen, lev, sz, groeiend, wv);
    tekenAlles(f, naam, c, x, y, s, st, ctx);
    B.ramen = B.levend = null;
    c.restore();
    e = { ramen, levend: lev, lod: lodVan(s), verwaarloosd: effB === 0, uit: !!uit };
  }
  c.globalAlpha = 1;

  const tijd = ctx.tijd ?? 0;
  tekenRamen(c, x, y, s, e, ctx, tijd * 1000);
  tekenLevend(c, x, y, s, e, st, ctx, tijd, sz);

  if (ctx.voortgang != null) {
    if (e.lod >= 1) { steigers(c, x, y, s, ctx.voortgang); bouwkraan(c, x, y, s, tijd, ctx.seed ?? 0); }
    c.strokeStyle = '#f0b429';
    c.setLineDash([s * 0.06, s * 0.05]);
    c.lineWidth = Math.max(1, s * 0.025);
    c.strokeRect(x - s * 0.46, y - s * 0.46, s * 0.92, s * 0.92);
    c.setLineDash([]);
    rect(c, x - s * 0.4, y + s * 0.38, s * 0.8, s * 0.06, '#0c131b');
    rect(c, x - s * 0.4, y + s * 0.38, s * 0.8 * ctx.voortgang, s * 0.06, '#f0b429');
  }
  // dunne rand in de kleur van de eigenaar
  c.strokeStyle = ctx.kleur;
  c.globalAlpha = 0.55;
  c.lineWidth = Math.max(1, s * 0.02);
  c.strokeRect(x - s / 2 + 1, y - s / 2 + 1, s - 2, s - 2);
  c.globalAlpha = 1;
  return true;
}

// ---------- levende delen per beeld ----------

// Verlichte ramen 's nachts, vaker aan bij meer welvaart, minder bij verwaarlozing, en allemaal donker bij een
// cyberuitval. Elk gebouw heeft een eigen patroon: losse ramen, hele verdiepingen, kolommen (trappenhuizen) of
// kantoorblokken. Pakket B: elk raam (of elke groep) heeft een vast moment in de avond waarop het licht aangaat,
// dus de ramen gaan een voor een aan; een deel gaat midden in de nacht weer uit, de rest blijft tot de ochtend.
// Welke ramen meedoen wisselt per nacht. Een op de tien ramen is koel wit, een op de twaalf flakkert van een scherm.
// Drie paden, drie vullingen; de indeling per raam wordt één keer per bitmap berekend.
const RAAM_KOEL = '#dfe9ff', RAAM_TV = '#9fc2ff';
function raamIndeling(e, seed) {
  const R = e.ramen, n = R.length / 4, patroon = Math.floor(hash(seed, 91) * 4);
  const groep = new Int32Array(n), klas = new Uint8Array(n), aan = new Float32Array(n), uit = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const rx = R[i * 4], ry = R[i * 4 + 1];
    const g = patroon === 1 ? 10000 + Math.round(ry * 80) : patroon === 2 ? 20000 + Math.round(rx * 60) : patroon === 3 ? 30000 + Math.round(rx * 10) * 41 + Math.round(ry * 10) : i;
    groep[i] = g;
    const h = hash(seed, i, 5);
    klas[i] = h < 0.1 ? 1 : h < 0.18 ? 2 : 0;
    // aan tussen het begin van de avond en een derde van de nacht; ruim een derde gaat voor de ochtend weer uit
    aan[i] = 0.02 + 0.3 * hash(seed, g, 11);
    uit[i] = hash(seed, g, 12) < 0.4 ? 0.48 + 0.4 * hash(seed, g, 13) : 2;
  }
  e.indeling = { groep, klas, patroon, aan, uit };
  return e.indeling;
}

function tekenRamen(c, x, y, s, e, ctx, nu) {
  const nacht = ctx.nacht ?? 0;
  const R = e.ramen;
  if (!(nacht > 0.05) || e.uit || ctx.uit || R.length === 0) return;
  const w = ctx.welvaart ?? 1;
  const wn = w <= 0.4 ? 0 : w >= 1.6 ? 1 : (w - 0.4) / 1.2;
  const p = (0.45 + 0.4 * wn) * (e.verwaarloosd ? 0.4 : 1);
  const seed = ctx.seed ?? 0;
  const { groep, klas, patroon, aan, uit } = e.indeling ?? raamIndeling(e, seed);
  const n = groep.length, a = 0.5 + 0.5 * Math.min(1, nacht);
  const u = nachtUur(nu / 1000), nr = Math.floor(nu / 1000 / CYCLUS);
  for (let k = 0; k < 3; k++) {
    c.fillStyle = k === 0 ? RAAMLICHT : k === 1 ? RAAM_KOEL : RAAM_TV;
    c.globalAlpha = k === 2 ? a * (0.55 + 0.35 * Math.sin(nu / 170 + seed)) : a;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      if (klas[i] !== k || u < aan[i] || u >= uit[i]) continue;
      const g = groep[i];
      if (hash(seed, g, nr) >= p) continue;
      // in een verdieping of kolom die aan is, blijft een op de zes ramen toch donker
      if (patroon > 0 && hash(seed, i, 6) < 0.17) continue;
      const j = i * 4;
      c.rect(x + R[j] * s, y + R[j + 1] * s, R[j + 2] * s, R[j + 3] * s);
    }
    c.fill();
    if (k === 0 && n < 12) break; // kleine gebouwen: alleen warm licht
  }
  c.globalAlpha = 1;
}

function tekenLevend(c, x, y, s, e, st, ctx, t, sz = GEEN_SEIZOEN) {
  const L = e.levend;
  if (!L.length) return;
  dagNu = dagVan(ctx); isKerst = kerstVan(dagNu); stNu = st;
  const nu = t * 1000, nacht = ctx.nacht ?? 0, seed = ctx.seed ?? 0;
  const draait = ctx.actief !== false && !ctx.uit && ctx.voortgang == null && !e.verwaarloosd;
  const wx = Math.cos(sz.windHoek) * sz.windKracht, wy = Math.sin(sz.windHoek) * sz.windKracht;
  for (let i = 0; i < L.length; i += 6) {
    const soort = L[i], px = x + L[i + 1] * s, py = y + L[i + 2] * s, a = L[i + 3], b = L[i + 4], k = L[i + 5];
    if (soort >= L_WIEK) {
      if ((NACHTWERK[soort] && !(nacht > 0.05)) || (soort >= L_DUIF && bRust(soort, k, t, nacht)) || !extraMag(t)) continue;
      tekenExtra(c, soort, px, py, a * s, b * s, k, s, e, ctx, t, sz, draait, nacht, hash(seed, i, 77), wx, wy, i);
      continue;
    }
    const fase = hash(seed, i, 77);
    switch (soort) {
      case L_ROOK:
        if (draait) rook(c, px, py, s * (a || 1), t, seed + i, wx, wy);
        break;
      case L_STOOM:
        if (draait) {
          // de stoompluim drijft met de wind af
          for (let j = 0; j < 4; j++) {
            const f = (t * 0.22 + j / 4 + fase) % 1;
            c.fillStyle = rgba('236,238,240', 0.55 * (1 - f));
            rond(c, px + f * s * (0.03 + 0.2 * wx), py - f * s * (0.3 - 0.12 * Math.abs(wx)) + f * s * 0.06 * wy, s * a * (0.08 + f * 0.12));
          }
        }
        break;
      case L_KNIPPER: {
        if (Math.floor(t + fase + k * 0.5) % 2 !== 0) break;
        const r = Math.max(1.2, s * 0.01 * (a || 1));
        if (nacht > 0.2) { c.fillStyle = rgba('255,80,70', 0.25 * nacht); rond(c, px, py, r * 3.5); }
        c.fillStyle = '#ff4d4d';
        rond(c, px, py, r);
        break;
      }
      case L_ZWAAI: {
        const aan = Math.floor(t * 4 + fase * 4) % 2 === 0;
        const kleur = k === 1 && !aan ? '#ff4040' : '#3d7bff';
        if (!aan && k !== 1) break;
        const r = Math.max(1.2, s * 0.008);
        c.fillStyle = kleur === '#3d7bff' ? 'rgba(61,123,255,0.3)' : 'rgba(255,64,64,0.3)';
        rond(c, px, py, r * 3);
        c.fillStyle = kleur;
        rond(c, px, py, r);
        break;
      }
      case L_KAARS: {
        const fl = 0.7 + 0.3 * Math.sin(nu / 90 + i);
        if (nacht > 0.05) { c.fillStyle = rgba('255,190,90', 0.22 * nacht * fl); rond(c, px, py, s * 0.03); }
        c.fillStyle = rgba('255,200,110', fl);
        rond(c, px, py, Math.max(1, s * 0.006));
        break;
      }
      case L_VUUR: {
        const g = 0.6 + 0.3 * Math.sin(nu / 90 + i);
        if (nacht > 0.05) { c.fillStyle = rgba('255,150,40', 0.25 * nacht); rond(c, px, py, s * 0.05); }
        c.fillStyle = rgba('255,150,40', g);
        rond(c, px, py, s * 0.011);
        c.fillStyle = rgba('255,230,120', g);
        rond(c, px + Math.sin(nu / 130) * s * 0.003, py - s * 0.003, s * 0.006);
        break;
      }
      case L_LED:
        if (ctx.actief !== false && !ctx.uit && Math.floor(t * 3 + k) % 2 === 0) rect(c, px, py, a * s, b * s, '#3ef0d0');
        break;
      case L_VLAG: {
        const w = a * s, h = b * s, golf = Math.sin(t * 3 + fase * 6) * h * 0.18;
        c.fillStyle = k === 1 ? st.accent : ctx.kleur;
        c.beginPath();
        c.moveTo(px, py);
        c.quadraticCurveTo(px + w * 0.5, py + golf, px + w, py - golf * 0.5);
        c.lineTo(px + w, py + h - golf * 0.5);
        c.quadraticCurveTo(px + w * 0.5, py + h + golf, px, py + h);
        c.closePath();
        c.fill();
        break;
      }
      case L_KRAAN: {
        const len = a * s, hoek = Math.PI / 2 + Math.sin(nu / 5000 + fase * 6) * 0.8;
        const dx = Math.cos(hoek), dy = Math.sin(hoek);
        const ex = px + dx * len, ey = py + dy * len, bx = px - dx * len * 0.25, by = py - dy * len * 0.25;
        c.strokeStyle = 'rgba(0,0,0,0.25)';
        c.lineWidth = Math.max(1, s * 0.016);
        c.beginPath(); c.moveTo(bx + s * 0.03, by + s * 0.02); c.lineTo(ex + s * 0.03, ey + s * 0.02); c.stroke();
        c.strokeStyle = '#f0b429';
        c.beginPath(); c.moveTo(bx, by); c.lineTo(ex, ey); c.stroke();
        rect(c, bx - s * 0.015, by - s * 0.015, s * 0.03, s * 0.03, '#8a8f96');
        if (e.lod >= 1) {
          const kleur = CONTAINERS[(k + Math.floor(nu / 5000 / Math.PI)) % 5 | 0];
          rect(c, ex - s * 0.03, ey - s * 0.012, s * 0.06, s * 0.024, kleur);
        }
        break;
      }
      case L_GLINS: {
        const w = a * s, h = b * s, sw = w * 0.12;
        const sx = px - sw + (w + sw) * frac(nu / 4000 + k * 0.13);
        const x0 = Math.max(px, sx), x1 = Math.min(px + w, sx + sw);
        if (x1 > x0) { c.fillStyle = 'rgba(225,240,255,0.32)'; c.fillRect(x0, py, x1 - x0, h); }
        break;
      }
      case L_VOERTUIG:
        voertuig(c, px, py, a * s, b * s, k, draait, t, fase, s, e.lod);
        break;
      case L_LAMP:
        if (nacht > 0.05) {
          c.fillStyle = rgba('255,217,138', 0.3 * nacht);
          rond(c, px, py, s * 0.02);
          c.fillStyle = rgba('255,236,190', nacht);
          rond(c, px, py, Math.max(1, s * 0.005));
        }
        break;
    }
  }
}

// Pakket D: alle nieuwe levende delen. a en b zijn hier al in px; elk stuk telt mee in het plafond per beeld.
function tekenExtra(c, soort, px, py, a, b, k, s, e, ctx, t, sz, draait, nacht, fase, wx, wy, i) {
  const dag = nacht < 0.5;
  switch (soort) {
    case L_WIEK:
      wieken(c, px, py, a, t, k * 0.063 + fase, s, sz, draait, nacht);
      break;
    case L_RADAR: {
      const th = (draait ? t * 1.6 : 0) + fase * 6.28, ca = Math.cos(th), sa = Math.sin(th) * 0.6;
      if (nacht > 0.2 && draait) {
        c.fillStyle = rgba('120,255,160', 0.18 * nacht);
        c.beginPath(); c.moveTo(px, py); c.arc(px, py, a * 2.2, th - 0.6, th); c.closePath(); c.fill();
      }
      c.strokeStyle = '#e4e8e0'; c.lineWidth = Math.max(1, s * 0.006);
      c.beginPath(); c.moveTo(px - ca * a, py - sa * a); c.lineTo(px + ca * a, py + sa * a); c.stroke();
      c.fillStyle = '#6a6f66'; rond(c, px, py, Math.max(0.8, s * 0.005));
      break;
    }
    case L_BAND: {
      // vracht op de band: vijf blokjes die doorschuiven, stil als het gebouw stilstaat
      const v = draait ? t * 0.12 : 0, w = Math.max(1, s * 0.011);
      c.fillStyle = k === 3 ? '#6e5a46' : '#a67c52';
      for (let j = 0; j < 5; j++) { const f = frac(v + j / 5 + fase); c.fillRect(px + a * f - w / 2, py + b * f - w / 2, w, w); }
      break;
    }
    case L_SCHACHT: {
      // schachtwiel boven de mijnschacht: draait als de mijn draait
      const th = (draait ? t * 1.4 : 0) + fase * 6.28;
      c.strokeStyle = '#3e3a36'; c.lineWidth = Math.max(0.8, s * 0.004);
      c.beginPath(); c.arc(px, py, a, 0, Math.PI * 2);
      for (let j = 0; j < 3; j++) { const q = th + (j * Math.PI) / 3; c.moveTo(px - Math.cos(q) * a, py - Math.sin(q) * a); c.lineTo(px + Math.cos(q) * a, py + Math.sin(q) * a); }
      c.stroke();
      break;
    }
    case L_FONTEIN: {
      if (sz.koud > 0.82) break; // bevroren
      c.fillStyle = rgba('225,242,255', 0.7);
      rond(c, px, py, Math.max(0.8, a * (0.28 + 0.06 * Math.sin(t * 6 + fase * 9))));
      for (let j = 0; j < 6; j++) {
        const f = frac(t * 0.7 + j / 6 + fase), q = j * 1.047 + fase * 3;
        c.fillStyle = rgba('210,235,250', 0.75 * (1 - f));
        rond(c, px + Math.cos(q) * a * f, py + Math.sin(q) * a * f * 0.7 - Math.sin(f * Math.PI) * a * 0.25, Math.max(0.6, a * 0.09));
      }
      break;
    }
    case L_HELI:
      helikopter(c, px, py, a, t, fase, s, draait);
      break;
    case L_STATUS: {
      // statuslampjes: groen, soms oranje; bij een cyberuitval knipperen ze allemaal rood
      const n = k | 0, stap = a / n, w = Math.max(0.8, s * 0.004), h = Math.max(0.8, b);
      c.fillStyle = ctx.uit ? '#ff4040' : '#3ef07a';
      for (let j = 0; j < n; j++) if (ctx.uit ? Math.floor(t * 2) % 2 === 0 : hash(j, Math.floor(t * 3 + hash(j, i, 2) * 3), 9) > 0.25) c.fillRect(px + j * stap, py, w, h);
      if (!ctx.uit) { c.fillStyle = '#ffb340'; for (let j = 0; j < n; j += 5) if (Math.floor(t * 1.5 + j) % 3 === 0) c.fillRect(px + j * stap + stap * 0.5, py, w, h); }
      break;
    }
    case L_PLUIM: {
      // schoorsteenrook van de kachel: alleen als het koud is, en hij waait met de wind mee
      if (sz.koud < 0.45) break;
      const sterk = (sz.koud - 0.45) / 0.55, n = s >= D13 ? 5 : 3;
      for (let j = 0; j < n; j++) {
        const f = frac(t * 0.3 + j / n + fase);
        c.fillStyle = rgba('215,215,220', 0.42 * sterk * (1 - f));
        rond(c, px + f * s * (0.008 + 0.075 * wx), py + f * s * (-0.05 + 0.03 * sz.windKracht + 0.035 * wy), s * (0.005 + f * 0.012));
      }
      break;
    }
    case L_FAN: {
      // ventilatoren op de koelunits: alle bladen van een rij in één pad
      const th = (draait ? t * 9 : 0) + fase * 6.28, n = k | 0;
      c.strokeStyle = '#2b3138'; c.lineWidth = Math.max(0.8, s * 0.004);
      c.beginPath();
      for (let j = 0; j < n; j++) {
        const fy = py + j * a;
        for (let q = 0; q < 2; q++) { const h = th + q * 1.5708; c.moveTo(px - Math.cos(h) * b, fy - Math.sin(h) * b); c.lineTo(px + Math.cos(h) * b, fy + Math.sin(h) * b); }
      }
      c.stroke();
      break;
    }
    case L_MARS: {
      // een peloton marcheert heen en weer over het exercitieterrein (alleen overdag)
      if (!dag || !draait || (k === 1 && isOchtend(t))) break;
      const p = 0.5 + 0.5 * Math.sin(t * 0.18 + fase * 6), stap = Math.floor(t * 4) % 2, d = Math.max(1, s * 0.006);
      const ox = px + a * (0.08 + 0.6 * p), oy = py + b * (0.3 + 0.2 * Math.sin(t * 0.05 + fase * 3));
      c.fillStyle = k === 1 ? '#3d4632' : '#4a5340';
      for (let r = 0; r < 3; r++) for (let q = 0; q < 5; q++) c.fillRect(ox + q * d * 2.2, oy + r * d * 2.2 + (q % 2 === stap ? d * 0.3 : 0), d, d);
      break;
    }
    case L_BAL: {
      // balspel op het sportveld: bal en spelertjes, alleen overdag
      if (!dag) break;
      const bx = px + a * (0.5 + 0.4 * Math.sin(t * 0.7 + fase * 5)), by = py + b * (0.5 + 0.42 * Math.sin(t * 0.43 + fase * 3));
      const d = Math.max(1, s * 0.006);
      c.fillStyle = '#d9443c';
      for (let j = 0; j < 6; j++) {
        if (j === 3) c.fillStyle = '#2e6eb5';
        const q = j * 1.05 + t * 0.3, r = s * (0.03 + 0.05 * hash(j, 1, 2));
        c.fillRect(bx + Math.cos(q) * r - d / 2, by + Math.sin(q) * r * 0.8 - d / 2, d, d);
      }
      c.fillStyle = '#f8f8f4'; rond(c, bx, by, Math.max(0.8, s * 0.003));
      break;
    }
    case L_SCHOMMEL: {
      if (!dag) break;
      c.fillStyle = '#c0392b';
      for (let j = 0; j < 2; j++) c.fillRect(px + a * (0.25 + j * 0.45), py + s * 0.004 + Math.sin(t * 2.6 + j * 1.3 + fase * 4) * s * 0.006, Math.max(1, s * 0.005), Math.max(0.8, s * 0.0025));
      break;
    }
    case L_TREIN:
      trein(c, px, py, a, k | 0, t, s, nacht);
      break;
    case L_EEND: {
      const th = t * 0.06 + fase * 6.28 + k;
      const ex = px + Math.cos(th) * a, ey = py + Math.sin(th) * b;
      c.fillStyle = k % 2 ? '#8a6a43' : '#f4f1e8'; rond(c, ex, ey, Math.max(0.8, s * 0.004));
      c.fillStyle = '#2f5d3a'; rond(c, ex - Math.sin(th) * s * 0.003, ey + Math.cos(th) * s * 0.003, Math.max(0.6, s * 0.002));
      break;
    }
    case L_SCHIJN:
      // lichtmasten van het stadion branden 's nachts
      if (nacht > 0.05 && !ctx.uit) { c.fillStyle = rgba('230,240,255', 0.22 * nacht); rond(c, px, py, a); c.fillStyle = rgba('250,252,255', nacht); rond(c, px, py, Math.max(1, s * 0.006)); }
      break;
    case L_BOUWKRAAN:
      torenkraan(c, px, py, a, t, fase + k * 0.1, s, nacht);
      break;
    case L_WAS: {
      // wasgoed dat in de wind waait
      const n = 5, stap = a / n, h = s * 0.009, zwaai = s * 0.003 * (0.3 + sz.windKracht);
      for (let j = 0; j < n; j++) {
        c.fillStyle = WINKEL[(j + (k | 0)) % WINKEL.length];
        const dx = Math.sin(t * 3 + j * 1.7 + fase * 5) * zwaai;
        c.beginPath(); c.moveTo(px + j * stap + stap * 0.1, py); c.lineTo(px + j * stap + stap * 0.8, py); c.lineTo(px + j * stap + stap * 0.8 + dx, py + h); c.lineTo(px + j * stap + stap * 0.1 + dx, py + h); c.closePath(); c.fill();
      }
      break;
    }
    case L_WINDZAK: {
      // windzak wijst met de wind mee en hangt slap bij weinig wind
      const l = a * (0.4 + 0.6 * sz.windKracht), dx = Math.cos(sz.windHoek) * l, dy = Math.sin(sz.windHoek) * l * 0.5 + (1 - sz.windKracht) * a * 0.4;
      c.fillStyle = '#f07a2a';
      c.beginPath(); c.moveTo(px, py - a * 0.15); c.lineTo(px + dx, py + dy - a * 0.06); c.lineTo(px + dx, py + dy + a * 0.06); c.lineTo(px, py + a * 0.15); c.closePath(); c.fill();
      c.fillStyle = '#f4f4f0'; rond(c, px + dx * 0.5, py + dy * 0.5, a * 0.1);
      break;
    }
    case L_LANTAARN:
      // straatlantaarns; bij een cyberuitval valt de straatverlichting ook uit
      if (!ctx.uit) { c.fillStyle = rgba('255,217,138', 0.28 * nacht); rond(c, px, py, s * 0.016); c.fillStyle = rgba('255,236,190', nacht); rond(c, px, py, Math.max(0.8, s * 0.004)); }
      break;
    case L_DEURLICHT:
      if (nacht > 0.1 && !ctx.uit) { c.fillStyle = rgba('255,214,150', 0.25 * nacht); rond(c, px, py, s * 0.008); c.fillStyle = rgba('255,230,180', nacht); rond(c, px, py, Math.max(0.6, s * 0.0025)); }
      break;
    // pakket B
    case L_DUIF:
      if (nacht < 0.6) duiven(c, px, py, a, b, k, s, t);
      break;
    case L_SNOER:
      if (isKerst && !ctx.uit) snoer(c, px, py, a, k, s, t, nacht);
      break;
    case L_ROLLUIK: {
      // 's avonds gaat het rolluik op een vast moment per winkel dicht, tegen de ochtend weer open
      const u = nachtUur(t);
      if (u < 0.05 + 0.4 * hash(k, 1, 3) || u > 0.96) break;
      c.fillStyle = '#80858a'; c.fillRect(px, py, a, b);
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.5, s * 0.0008);
      c.beginPath(); for (let j = 1; j < 5; j++) { c.moveTo(px, py + (b * j) / 5); c.lineTo(px + a, py + (b * j) / 5); } c.stroke();
      break;
    }
    case L_DOCK:
      laadDock(c, px, py, a, b, s, t, fase, draait, DOCK_KLEUR[Math.floor(t / 48 + fase) % 3]);
      break;
    case L_HEFTRUCK:
      heftruck(c, px, py, a, b, k, s, t, fase, draait);
      break;
    case L_LORRIE:
      lorries(c, px, py, a, s, t, fase, draait);
      break;
    case L_MENSEN:
      mensen(c, px, py, a, b, k, s, t, fase, dag, sz);
      break;
    case L_APPEL:
      if (dag) appel(c, px, py, a, b, s, t, draait);
      break;
    case L_OEFEN:
      oefenen(c, px, py, a, b, s, t, fase, dag, draait);
      break;
    case L_WACHT:
      erewacht(c, px, py, a, k, s, t, fase);
      break;
    case L_LIMO:
      dienstauto(c, px, py, a, s, t, fase, nacht, stNu.accent);
      break;
    case L_PUBLIEK:
      publiek(c, px, py, a, b, k, s, t, nacht, stNu.accent);
      break;
  }
}

// Bewegende voertuigen: 0 kiepwagen over de terrassen van een mijn, 1 trekker die een akker afrijdt,
// 2 drone die rondjes vliegt, 3 ambulance heen en weer langs het ziekenhuis, 4 tank op de testbaan.
// Staat het gebouw stil, dan staan ze ook stil.
function voertuig(c, px, py, a, b, soort, draait, t, fase, s, lod) {
  if (soort === 0) {
    const th = (draait ? t * 0.25 : 0) + fase * Math.PI * 2;
    const vx = px + Math.cos(th) * a, vy = py + Math.sin(th) * b;
    const rich = Math.atan2(Math.cos(th) * b, -Math.sin(th) * a);
    c.save();
    c.translate(vx, vy);
    c.rotate(rich);
    rect(c, -s * 0.03 + s * 0.004, -s * 0.017 + s * 0.004, s * 0.06, s * 0.034, 'rgba(0,0,0,0.3)');
    rect(c, -s * 0.03, -s * 0.017, s * 0.06, s * 0.034, '#e0b020');
    rect(c, -s * 0.026, -s * 0.012, s * 0.036, s * 0.024, draait ? '#6e6152' : '#8a7a66');
    c.restore();
  } else if (soort === 1) {
    if (lod < 1) return;
    const rijen = 5, p = (draait ? frac(t * 0.012 + fase) : fase) * rijen;
    const rij = Math.floor(p), f = p - rij;
    const vx = px + (rij % 2 ? 1 - f : f) * a, vy = py + ((rij + 0.5) / rijen) * b;
    rect(c, vx - s * 0.02 + s * 0.003, vy - s * 0.013 + s * 0.003, s * 0.04, s * 0.026, 'rgba(0,0,0,0.3)');
    rect(c, vx - s * 0.02, vy - s * 0.013, s * 0.04, s * 0.026, '#3f7f3a');
    rect(c, vx - s * 0.02, vy - s * 0.016, s * 0.012, s * 0.032, '#1e1e1e');
  } else if (soort === 3) {
    // ambulance: rijdt van links naar rechts met zwaailicht, wacht, en rijdt terug
    const p = draait ? frac(t / 30 + fase) : 0.3, heen = p < 0.5, q = heen ? p * 2 : (1 - p) * 2;
    const f = q < 0.15 ? 0 : q > 0.85 ? 1 : (q - 0.15) / 0.7, rijdt = q > 0.15 && q < 0.85 && draait;
    const vx = px + f * a, vy = py + (heen ? -s * 0.008 : s * 0.008);
    rect(c, vx - s * 0.03 + s * 0.004, vy - s * 0.012 + s * 0.004, s * 0.06, s * 0.024, 'rgba(0,0,0,0.3)');
    rect(c, vx - s * 0.03, vy - s * 0.012, s * 0.06, s * 0.024, '#f6f6f2');
    rect(c, vx - s * 0.03, vy - s * 0.003, s * 0.06, s * 0.006, '#d9443c');
    if (rijdt && Math.floor(t * 4) % 2 === 0) { c.fillStyle = 'rgba(61,123,255,0.35)'; rond(c, vx, vy, s * 0.02); c.fillStyle = '#3d7bff'; rond(c, vx, vy, Math.max(1, s * 0.005)); }
  } else if (soort === 4) {
    if (lod < 1) return;
    const th = (draait ? t * 0.2 : 0) + fase * Math.PI * 2;
    const vx = px + Math.cos(th) * a, vy = py + Math.sin(th) * b;
    c.save();
    c.translate(vx, vy);
    c.rotate(Math.atan2(Math.cos(th) * b, -Math.sin(th) * a));
    rect(c, -s * 0.032 + s * 0.004, -s * 0.02 + s * 0.004, s * 0.064, s * 0.04, 'rgba(0,0,0,0.3)');
    rect(c, -s * 0.032, -s * 0.02, s * 0.064, s * 0.04, '#5d6b4a');
    c.fillStyle = '#4d5a3c'; rond(c, 0, 0, s * 0.013);
    rect(c, 0, -s * 0.003, s * 0.045, s * 0.006, '#3d4632');
    c.restore();
  } else if (soort === 2 && draait) {
    const th = t * 0.6 + fase * Math.PI * 2;
    const vx = px + Math.cos(th) * a, vy = py + Math.sin(th) * a * 0.7;
    c.fillStyle = 'rgba(0,0,0,0.2)';
    rond(c, vx + s * 0.05, vy + s * 0.06, s * 0.025);
    c.strokeStyle = '#2a2e33';
    c.lineWidth = Math.max(0.8, s * 0.005);
    const r = s * 0.03;
    c.beginPath(); c.moveTo(vx - r, vy - r); c.lineTo(vx + r, vy + r); c.moveTo(vx + r, vy - r); c.lineTo(vx - r, vy + r); c.stroke();
    if (Math.floor(t * 2) % 2 === 0) { c.fillStyle = '#ff4d4d'; rond(c, vx, vy, Math.max(1, s * 0.006)); }
  }
}

// Bouwkraan op een bouwplaats: mast in de noordoosthoek, de giek draait langzaam.
function bouwkraan(c, x, y, s, t, seed) {
  const mx = x + s * 0.3, my = y - s * 0.3, len = s * 0.42, hoek = t * 0.15 + hash(seed, 5) * 6;
  const ex = mx + Math.cos(hoek) * len, ey = my + Math.sin(hoek) * len;
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.lineWidth = Math.max(1, s * 0.012);
  c.beginPath(); c.moveTo(mx + s * 0.05, my + s * 0.04); c.lineTo(ex + s * 0.05, ey + s * 0.04); c.stroke();
  c.strokeStyle = '#f0b429';
  c.beginPath(); c.moveTo(mx - Math.cos(hoek) * len * 0.25, my - Math.sin(hoek) * len * 0.25); c.lineTo(ex, ey); c.stroke();
  rect(c, mx - s * 0.02, my - s * 0.02, s * 0.04, s * 0.04, '#d9a020');
  rect(c, ex - s * 0.015, ey - s * 0.015, s * 0.03, s * 0.03, '#8a8f96');
}

// ---------- landschap (oude tekening, blijft voor compatibiliteit; de terreinlaag neemt het over) ----------

function boomKlassiek(c, x, y, r) {
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath(); c.arc(x + r * 0.3, y + r * 0.3, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#2d5a32';
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#3f7a43';
  c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.55, 0, Math.PI * 2); c.fill();
}

// Landschap op een onbebouwd vakje.
export function tekenTerreinDetail(c, terrein, x, y, s, seed) {
  const r = rnd(seed * 104729 + 7);
  if (terrein === 'bos') {
    for (let i = 0; i < 7; i++) boomKlassiek(c, x - s * 0.4 + r() * s * 0.8, y - s * 0.4 + r() * s * 0.8, s * (0.07 + r() * 0.05));
  } else if (terrein === 'berg') {
    for (let i = 0; i < 3; i++) {
      const bx = x - s * 0.3 + r() * s * 0.6, by = y - s * 0.15 + r() * s * 0.4, h = s * (0.25 + r() * 0.15);
      c.fillStyle = '#6f6a62';
      c.beginPath(); c.moveTo(bx - h * 0.7, by + h * 0.3); c.lineTo(bx, by - h); c.lineTo(bx + h * 0.7, by + h * 0.3); c.fill();
      c.fillStyle = '#8c867c';
      c.beginPath(); c.moveTo(bx, by - h); c.lineTo(bx + h * 0.7, by + h * 0.3); c.lineTo(bx + h * 0.15, by + h * 0.3); c.fill();
      c.fillStyle = '#f2f2ef';
      c.beginPath(); c.moveTo(bx - h * 0.2, by - h * 0.55); c.lineTo(bx, by - h); c.lineTo(bx + h * 0.2, by - h * 0.55); c.fill();
    }
  } else if (terrein === 'vlakte') {
    c.strokeStyle = 'rgba(150,190,110,0.35)';
    c.lineWidth = Math.max(0.6, s * 0.012);
    for (let i = 0; i < 10; i++) {
      const gx = x - s * 0.45 + r() * s * 0.9, gy = y - s * 0.45 + r() * s * 0.9;
      c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + s * 0.02, gy - s * 0.05); c.stroke();
    }
    if (r() < 0.3) boomKlassiek(c, x - s * 0.3 + r() * s * 0.6, y - s * 0.3 + r() * s * 0.6, s * 0.07);
  } else if (terrein === 'kust') {
    c.strokeStyle = 'rgba(170,215,240,0.5)';
    c.lineWidth = Math.max(0.8, s * 0.015);
    for (let i = 0; i < 2; i++) {
      const wy = y - s * 0.15 + i * s * 0.3;
      c.beginPath(); c.moveTo(x - s * 0.35, wy); c.quadraticCurveTo(x - s * 0.18, wy - s * 0.06, x, wy); c.quadraticCurveTo(x + s * 0.18, wy + s * 0.06, x + s * 0.35, wy); c.stroke();
    }
  }
}
