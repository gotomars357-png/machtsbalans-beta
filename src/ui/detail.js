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
    if (LAATSTE.get(e.basis) === e) { LAATSTE.delete(e.basis); VORIGE_MAAT.delete(e.basis); }
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

const ASFALT = '#3d3e3c', STOEP = '#a29e94', PLEIN = '#b8b1a1', GRAS = '#5f8a45', GRAS_LICHT = '#6f9a52', HEG = '#4d6b35';
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
};

// Levende delen: per stuk zes getallen [soort, x, y, a, b, k].
const L_ROOK = 1, L_STOOM = 2, L_KNIPPER = 3, L_ZWAAI = 4, L_KAARS = 5, L_VUUR = 6, L_LED = 7, L_VLAG = 8,
  L_KRAAN = 9, L_GLINS = 10, L_VOERTUIG = 11, L_LAMP = 12;

function levend(soort, x, y, a = 0, b = 0, k = 0) {
  if (B.levend) B.levend.push(soort, (x - B.cx) / B.S, (y - B.cy) / B.S, a / B.S, b / B.S, k);
}

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
  }
  const ry = y - h;
  if (o.schuin) schuinDak(c, x, ry, w, d, dak, muur, o);
  else platDak(c, x, ry, w, d, dak, o);
  if (B.verwaarloosd) roest(c, x, ry, w, d);
  return ry;
}

function gevelRamen(c, x, y0, w, v, fh, o) {
  const S = B.S;
  const kol = Math.max(1, Math.floor(w / (S * (o.raamAfstand ?? 0.028))));
  const kw = w / kol, rw = kw * 0.5, rh = fh * 0.45;
  c.fillStyle = o.dicht ? '#4a3b2c' : GLAS;
  for (let f = 0; f < v; f++) {
    const ry = y0 + f * fh + fh * 0.25;
    for (let k = 0; k < kol; k++) {
      const rx = x + k * kw + (kw - rw) / 2;
      c.fillRect(rx, ry, rw, rh);
      if (!o.dicht) raamVast(rx, ry, rw, rh);
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
  if (lod >= 1 && o.schoorsteen !== false) {
    const cs = S * 0.014;
    const sx = liggend ? x + w * 0.72 : x + w * 0.62, sy = liggend ? y + d * 0.6 : y + d * 0.24;
    rect(c, sx + cs * 0.5, sy + cs * 0.35, cs, cs, 'rgba(0,0,0,0.3)');
    rect(c, sx, sy, cs, cs, '#6b4a3a');
    rect(c, sx + cs * 0.2, sy + cs * 0.2, cs * 0.6, cs * 0.6, '#2a2220');
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
  if (lod >= 1 && o.units !== 0) {
    // dakinstallaties: kastjes met schaduw
    const n = o.units ?? Math.min(3, Math.max(1, Math.round((w * d) / (S * S * 0.01))));
    const uw = Math.min(w * 0.3, S * 0.02), ud = Math.min(d * 0.3, S * 0.015);
    for (let i = 0; i < n; i++) {
      const ux = x + (w - uw) * (0.12 + 0.76 * r2()), uy = y + (d - ud) * (0.12 + 0.76 * r2());
      rect(c, ux + uw * 0.25, uy + ud * 0.3, uw, ud, 'rgba(0,0,0,0.25)');
      rect(c, ux, uy, uw, ud, '#8f9397');
      rect(c, ux, uy, uw, ud * 0.3, '#a9adb1');
    }
  }
  if (lod >= 1 && o.kern) {
    // trappenhuis: iets hoger blok op het dak
    const kw = Math.min(w, d) * 0.28;
    for (const f of w >= d ? [0.25, 0.7] : [0.5]) {
      const kx = x + w * f - kw / 2, ky = y + d * (w >= d ? 0.3 : 0.4);
      rect(c, kx + kw * 0.3, ky + kw * 0.25, kw, kw, 'rgba(0,0,0,0.22)');
      rect(c, kx, ky, kw, kw, tint(dak, 0.88));
    }
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

function boom(c, x, y, r) {
  c.fillStyle = 'rgba(0,0,0,0.25)';
  rond(c, x + r * 0.35, y + r * 0.3, r);
  c.fillStyle = '#2f5530';
  rond(c, x, y, r);
  c.fillStyle = '#3f6b3a';
  rond(c, x - r * 0.2, y - r * 0.2, r * 0.7);
  if (B.lod >= 1) { c.fillStyle = '#5a8a4a'; rond(c, x - r * 0.38, y - r * 0.38, r * 0.3); }
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

function rook(c, x, y, s, tijd, seed) {
  for (let i = 0; i < 4; i++) {
    const f = (tijd * 0.35 + i / 4 + (seed % 7) / 7) % 1;
    c.fillStyle = rgba('200,200,200', 0.45 * (1 - f));
    c.beginPath();
    c.arc(x + f * s * 0.15, y - f * s * 0.55, s * (0.04 + f * 0.09), 0, Math.PI * 2);
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

const dichtGetimmerd = (id) => B.onrust && hash(B.seed, id, 7) < 0.15;

// Niveau 1: vrijstaande huizen op vier kavels, elk met tuin, boom en (vanaf lod1) hek, oprit en auto.
function vrijstaand(c, qx, qy, qw, qh, st, kw) {
  const S = B.S, lod = B.lod, kx = qw / 2, ky = qh / 2;
  for (let i = 0; i < 4; i++) {
    const px = qx + (i % 2) * kx, py = qy + (i >> 1) * ky, id = kw * 4 + i;
    const h1 = hash(B.seed, id, 1), h2 = hash(B.seed, id, 2), h3 = hash(B.seed, id, 3);
    rect(c, px + kx * 0.03, py + ky * 0.03, kx * 0.94, ky * 0.94, h3 < 0.5 ? GRAS : GRAS_LICHT);
    if (lod >= 1) hekje(c, px + kx * 0.04, py + ky * 0.04, kx * 0.92, ky * 0.92);
    const v = h1 > 0.72 ? 2 : 1, hgt = v * S * 0.017;
    const w = kx * (0.46 + 0.14 * h1), d = ky * (0.34 + 0.1 * h2);
    const links = h2 < 0.5;
    const hx = links ? px + kx * 0.1 : px + kx * 0.9 - w, hy = py + ky * 0.12 + hgt;
    // oprit met auto naast het huis
    if (lod >= 1 && h3 > 0.3) {
      const ox = links ? hx + w + kx * 0.05 : hx - kx * 0.05 - kx * 0.2;
      rect(c, ox, py + ky * 0.12, kx * 0.2, ky * 0.84, BETON);
      if (h3 > 0.5) auto(c, ox + kx * 0.1, py + ky * 0.62, autoKleur(id), false);
    }
    if (lod >= 2) {
      // terras en tuinpad
      rect(c, hx + w * 0.15, hy + d + S * 0.004, w * 0.5, ky * 0.1, '#c9bfa8');
      if (h1 > 0.4) pand(c, links ? px + kx * 0.74 : px + kx * 0.1, py + ky * 0.72, kx * 0.16, ky * 0.12, 1, '#7a6a55', '#9a8a70', { geenRamen: true, units: 0 });
    }
    pand(c, hx, hy, w, d, v, st.daken[Math.floor(h2 * 997) % st.daken.length], st.muur, { schuin: !st.plat, dicht: dichtGetimmerd(id) });
    if (st.plat && h1 < 0.25) koepel(c, hx + w / 2, hy - hgt + d / 2, Math.min(w, d) * 0.3, st.accent);
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
    const bw = (qw * 0.94) / n, by = ry + rh * 0.38 + hgt, bd = rh * 0.26;
    for (let i = 0; i < n; i++) {
      const id = kw * 8 + rij * 4 + i, bx = qx + qw * 0.03 + i * bw;
      if (lod >= 1) {
        hekje(c, bx, ry + rh * 0.04, bw, rh * 0.32);
        if (hash(B.seed, id, 4) < 0.5) boom(c, bx + bw * 0.5, ry + rh * 0.18, Math.min(bw, rh) * 0.14);
      }
      if (lod >= 2 && hash(B.seed, id, 5) < 0.4) rect(c, bx + bw * 0.1, ry + rh * 0.06, bw * 0.25, rh * 0.1, '#7a6a55');
      pand(c, bx, by, bw, bd, v, st.daken[Math.floor(hash(B.seed, id, 6) * st.daken.length)], st.muur, { schuin: !st.plat, dicht: dichtGetimmerd(id), dakkapel: hash(B.seed, id, 8) < 0.5 });
      if (st.plat && hash(B.seed, id, 9) < 0.12) koepel(c, bx + bw / 2, by - hgt + bd / 2, Math.min(bw, bd) * 0.3, st.accent);
      if (lod >= 1 && hash(B.seed, id, 3) < 0.55) auto(c, bx + bw * 0.5, by + bd + rh * 0.13, autoKleur(id), true, 0.9);
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
  const o = { kern: true, geenSchaduw: true, dicht: dichtGetimmerd(kw * 4) };
  pand(c, bx, by, W, dw, v, dak, st.muur, o);
  pand(c, bx, by + dw, dw, H - 2 * dw, v, dak, st.muur, o);
  pand(c, bx + W - dw, by + dw, dw, H - 2 * dw, v, dak, st.muur, o);
  pand(c, bx, by + H - dw, W, dw, v, dak, st.muur, o);
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
  pand(c, qx + qw * 0.06, by1, qw * 0.88, d, v, st.daken[kw % st.daken.length], st.muur, { kern: true, dicht: dichtGetimmerd(kw * 2) });
  pand(c, qx + qw * 0.06, by2, qw * 0.88, d, v, st.daken[(kw + 1) % st.daken.length], st.muur, { kern: true, dicht: dichtGetimmerd(kw * 2 + 1) });
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
    wijkKwart(c, x + s * Z0, y + s * 0.15, s * (0.5 - Z0), s * 0.35, st, 3);
    const g = s * (0.5 - Z0), h = s * 0.35;
    const gx = x - s * 0.5, gy = y - s * 0.5, vx = x + s * Z0;
    (REGERING[d.regime] ?? REGERING.democratie)(c, gx, gy, vx, gy, g, h, st);
    if (d.oorlog) oorlogsstand(c, x, y, s, gx, gy, g, h);
  },
  woonwijk(c, x, y, s, st) {
    straten(c, x, y, s);
    for (let kw = 0; kw < 4; kw++) {
      const [qx, qy, qw, qh] = kwartVak(x, y, s, kw % 2 ? 1 : -1, kw > 1 ? 1 : -1);
      wijkKwart(c, qx, qy, qw, qh, st, kw);
    }
    straatBomen(c, x, y, s);
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
      for (let i = 0; i < 2 + (lod >= 2 ? 1 : 0); i++) vrachtwagen(c, hx + hw * (0.18 + i * 0.3), hy + hd + s * 0.08, '#c0392b', false);
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
function zetB(soort, ctx, S, cx, cy, niveau, effB, ramen, levendLijst) {
  B.S = S; B.cx = cx; B.cy = cy; B.lod = lodVan(S); B.niveau = niveau;
  B.seed = ctx.seed ?? 0; B.regime = ctx.regime; B.kleur = ctx.kleur;
  B.verwaarloosd = effB === 0; B.uit = !!ctx.uit;
  B.onrust = !!WONEN[soort] && ctx.stab != null && ctx.stab < 30;
  B.oorlog = soort === 'hoofdstad' && !!ctx.oorlog;
  B.strak = stijlVan(ctx.regime).strak === true;
  B.r2 = rnd(B.seed * 7919 + 101);
  B.ramen = ramen; B.levend = levendLijst;
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
  const toestand = (WONEN[naam] && ctx.stab != null && ctx.stab < 30 ? 'o' : '') + (naam === 'hoofdstad' && ctx.oorlog ? 'w' : '');
  // Schaal van het doel (apparaatpixels per CSS-pixel), zodat de bitmap 1-op-1 op het scherm valt.
  const m = typeof c.getTransform === 'function' ? c.getTransform() : null;
  const dpr = m && m.a > 0 ? m.a : typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
  const echt = Math.round(s * dpr); // exacte maat in apparaatpixels; boven MAX_PX wordt de bitmap geschaald getoond
  const px = Math.min(MAX_PX, Math.max(8, echt));
  const lod = lodVan(s);
  // De eigenaarskleur hoort niet in de sleutel: rand en vlaggen in die kleur worden per beeld getekend,
  // dus een land dat van blok wisselt hoeft niets opnieuw te bakken.
  const basis = `${naam}|${ctx.seed}|${ctx.regime}|${niveau}|${effB}|${uit}|${toestand}`;
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
    const vorige = LAATSTE.get(basis);
    const verhouding = vorige ? vorige.px / px : 0;
    const zoomt = Math.abs((VORIGE_MAAT.get(basis) ?? s) - s) > 0.01;
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
        zetB(naam, ctx, s, s / 2, s / 2, niveau, effB, ramen, lev);
        f(g, s / 2, s / 2, s, st, rnd((ctx.seed ?? 0) * 7919 + 13), B);
        B.ramen = B.levend = null;
        e = { doek, px, bytes: px * px * 4, basis, ramen: Float32Array.from(ramen), levend: Float32Array.from(lev), lod, verwaarloosd: effB === 0, uit: !!uit };
        CACHE.set(sleutel, e);
        LAATSTE.set(basis, e);
        cacheBytes += e.bytes;
        opruimen();
      }
    }
  }
  VORIGE_MAAT.set(basis, s);

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
    zetB(naam, ctx, s, x, y, niveau, effB, ramen, lev);
    f(c, x, y, s, st, rnd((ctx.seed ?? 0) * 7919 + 13), B);
    B.ramen = B.levend = null;
    c.restore();
    e = { ramen, levend: lev, lod: lodVan(s), verwaarloosd: effB === 0, uit: !!uit };
  }
  c.globalAlpha = 1;

  const tijd = ctx.tijd ?? 0;
  tekenRamen(c, x, y, s, e, ctx, tijd * 1000);
  tekenLevend(c, x, y, s, e, st, ctx, tijd);

  if (ctx.voortgang != null) {
    if (e.lod >= 1) bouwkraan(c, x, y, s, tijd, ctx.seed ?? 0);
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

// Verlichte ramen 's nachts: elk raam wisselt elke 20 s (verschoven per raam), vaker aan bij meer welvaart,
// minder bij verwaarlozing, en allemaal donker bij een cyberuitval. Eén pad, één vulling.
function tekenRamen(c, x, y, s, e, ctx, nu) {
  const nacht = ctx.nacht ?? 0;
  const R = e.ramen;
  if (!(nacht > 0.05) || e.uit || ctx.uit || R.length === 0) return;
  const w = ctx.welvaart ?? 1;
  const wn = w <= 0.4 ? 0 : w >= 1.6 ? 1 : (w - 0.4) / 1.2;
  const p = (0.35 + 0.35 * wn) * (e.verwaarloosd ? 0.4 : 1);
  const seed = ctx.seed ?? 0;
  c.fillStyle = RAAMLICHT;
  c.globalAlpha = 0.5 + 0.5 * Math.min(1, nacht);
  c.beginPath();
  for (let i = 0, n = 0; i < R.length; i += 4, n++) {
    if (hash(seed, n, Math.floor(nu / 20000 + hash(seed, n, 3))) >= p) continue;
    c.rect(x + R[i] * s, y + R[i + 1] * s, R[i + 2] * s, R[i + 3] * s);
  }
  c.fill();
  c.globalAlpha = 1;
}

function tekenLevend(c, x, y, s, e, st, ctx, t) {
  const L = e.levend;
  if (!L.length) return;
  const nu = t * 1000, nacht = ctx.nacht ?? 0, seed = ctx.seed ?? 0;
  const draait = ctx.actief !== false && !ctx.uit && ctx.voortgang == null && !e.verwaarloosd;
  for (let i = 0; i < L.length; i += 6) {
    const soort = L[i], px = x + L[i + 1] * s, py = y + L[i + 2] * s, a = L[i + 3], b = L[i + 4], k = L[i + 5];
    const fase = hash(seed, i, 77);
    switch (soort) {
      case L_ROOK:
        if (draait) rook(c, px, py, s * (a || 1), t, seed + i);
        break;
      case L_STOOM:
        if (draait) {
          for (let j = 0; j < 4; j++) {
            const f = (t * 0.22 + j / 4 + fase) % 1;
            c.fillStyle = rgba('236,238,240', 0.55 * (1 - f));
            rond(c, px + f * s * 0.12, py - f * s * 0.3, s * a * (0.08 + f * 0.12));
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

// Bewegende voertuigen: 0 kiepwagen over de terrassen van een mijn, 1 trekker die een akker afrijdt,
// 2 drone die rondjes vliegt. Staat het gebouw stil, dan staan ze ook stil.
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
