// Kust en water op de kaart (pakket C van de inzoomronde). Aan zee: vuurtorens op kapen met 's nachts een draaiende
// lichtbundel, pieren met lantaarns bij badplaatsen, havenhoofden met een licht op de kop, jachthavens met rijen
// jachten en masten, rode en groene boeien langs de vaargeul naar een haven, rotskusten met opspattend water en
// zeehonden, en brekende rollers op het strand. Aan de rivieren: kademuren waar een rivier door de stad loopt,
// woonboten, binnenvaartschepen die traag heen en weer varen, een stuw met sluis, en een stuwdam met stuwmeer op een
// bergrivier. Op zee: windparken met draaiende wieken, booreilanden met een fakkel en viskwekerijen in beschutte
// baaien. Alles komt trapsgewijs op bij het inzoomen (zie DREMPEL): 4-6 de grote dingen, 8-10 de middelgrote, 12-14
// de kleine.
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Waar iets ligt volgt uit de kaart, de gebouwen en
// vaste hashes; de klok stuurt alleen beweging. Geen Math.random, geen Date. Licht uit het noordwesten: schaduwen
// vallen naar het zuidoosten, hoge dingen staan schuin omhoog.
// Botst niet met leven.js: de boten, zeilboten, vissers, veerboten, eenden, parasols en zwemmers daar hebben vaste
// plaatsingsregels, en die regels houden hun water hier vrij. Ook niet met infra.js: wegen, spoor, bruggen en havens
// blijven vrij, en binnenvaartschepen verdwijnen onder een brug.

import { seizoen, weer, wind } from './seizoen.js';
import { maakBasis, TerreinLaag } from './terrein.js';

// ---------- gedeelde hulpjes (eigen kopie, zie inzoom-spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
const tri = (v) => 1 - Math.abs(1 - 2 * frac(v));
const triRichting = (v) => (frac(v) < 0.5 ? 1 : -1);
const TAU = Math.PI * 2;
const SCHUIN = 0.566; // schaduwlengte per hoogte-eenheid, zon op ~45° in het noordwesten (zelfde als infra.js)

// Vast toeval voor het bakken (mulberry32).
function rnd(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Canvasfabriek: in de browser een echt canvas, in tests een nep (zie zetCanvasFabriek). Raakt document pas aan
// als er gebakken wordt, nooit bij het importeren.
const standaardFabriek = (w, h) => (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null);
let fabriek = standaardFabriek;
export function zetCanvasFabriek(fn) { fabriek = fn ?? standaardFabriek; }

// ---------- plafonds en drempels ----------

// Hooguit zoveel per beeld (wat in beeld is); de wereldlijsten zelf zijn ook begrensd.
export const PLAFOND = {
  vuurtorens: 10, pieren: 8, havenhoofden: 16, jachthavens: 6, boeien: 48, rotsen: 90, zeehonden: 16, spatten: 24, rollers: 90, kades: 40, woonboten: 24, aken: 12, stuwen: 6, dammen: 2, windparken: 4, turbines: 48, booreilanden: 4, viskwekerijen: 8, lichten: 260, bakken: 2,
  // strand en kust van dichtbij (pakket D)
  strandpunten: 700, getij: 24, vloedlijn: 260, aangespoeld: 30, sporen: 24, huisjes: 40, paviljoens: 3, reddingsposten: 4, velden: 4, stoelsets: 30, schermen: 24, handdoeken: 60,
  kastelen: 16, gaten: 8, mensen: 140, lopers: 24, honden: 12, duinpaden: 8, rekken: 6, helm: 180, konijnen: 16, dijken: 8, schapen: 30, zandbanken: 4, bankzeehonden: 14,
  hengelaars: 16, sloepen: 20, kraantjes: 6, vissershavens: 3, kotters: 9, meeuwen: 24, veerstoepen: 4, autos: 24,
};
// Vanaf welke zoom iets verschijnt (4-6 grof, 8-10 middel, 12-14 klein).
export const DREMPEL = {
  groot: 4, havenhoofd: 4.5, viskweek: 5, aak: 5, rots: 5.5, kade: 5.5, stuw: 5.5, pier: 6, jachthaven: 6, boei: 7, woonboot: 7, zeehond: 8, fijn: 8, roller: 9, spat: 9, klein: 11, kleinst: 13,
  dijk: 7, veerstoep: 7.5, zandbank: 7.5, getij: 8, vissershaven: 8, paviljoen: 8.5, huisje: 9, duinpad: 9, schaap: 9, sloep: 9.5, auto: 9.5, strandmens: 10, loper: 10,
  hengel: 10, kraan: 10, meeuw: 10, veld: 10, vloedlijn: 11, hek: 11, helm: 11, konijn: 11, netten: 11, kasteel: 11.5, aangespoeld: 12, spoor: 12.5, emmer: 13,
};
const MAX_SPRITES = 32, MAX_BYTES = 32 * 1024 * 1024, MAX_P = 640;

const W = 1000, H = 620; // wereld in eenheden (gelijk aan het eigenaarbeeld)
const RC = 2, RW = W / RC, RH = H / RC; // botsraster: vakjes van 2 eenheden
const INFRA = 1, LEVEN = 2, KUST = 4, GEBOUW = 8;

const LEEG = 0, HOOFD = 1, STAD = 2, ENERGIE = 4, HAVEN = 5, OVERIG = 7;
const ALIAS = { olieveld: 'centrale', staalfabriek: 'industrie', landbouw: 'boerderij', zware_industrie: 'industrie', ruimtevaartcentrum: 'chipfabriek', spoor: 'opslag' };
const ENERGIEBRON = { centrale: 1, zonnepark: 1 };

// lichtsoorten (zelfde nummering als infra.js) en een eigen wit
const WARM = 0, ROOD = 1, GROEN = 2, KOEL = 3, WIT = 4, AMBER = 5;
const LICHTKLEUR = [[255, 200, 120], [255, 50, 40], [70, 255, 120], [235, 242, 255], [255, 250, 230], [255, 170, 40]];
const LICHT = 5; // x, y, r, soort, sterkte

const ROMPEN = ['#2b3440', '#5a2a24', '#2f4a3a', '#3a3f45'];
const LADING = ['#c9b07a', '#3b3734', '#b8442f', '#2f6d9a', '#8a8173'];
const WOONBOOT = ['#3d6b5a', '#8a4a3a', '#3f5d7a', '#7a6a3a', '#5e4a6a'];
const JACHT = ['#f4f2ec', '#f4f2ec', '#f4f2ec', '#1f3550', '#e9dfc7', '#7a2a24'];
const ZEEHOND = ['#6e6a62', '#857a68', '#5b5853'];
// strand (pakket D): mensen, handdoeken, huisjes (dak in het licht, dak in de schaduw, wand), parasols, honden
const KLEDING = ['#c0392b', '#2e86c1', '#f0b429', '#ecefe9', '#34495e', '#2f9e5b', '#e8669a', '#3fc0c0'];
const HUID = ['#f1c9a5', '#c68e5d', '#7d5136'];
const DOEK = [['#e8433a', '#f6f2e6'], ['#2f7fc1', '#f0d34a'], ['#f0b429', '#e86a3a'], ['#3fbf9a', '#f6f2e6'], ['#8a4bb8', '#f0b429'], ['#ff7aa8', '#ffffff'], ['#2d4f8a', '#e8e4d8']];
const HUISJE = [['#f2efe6', '#cfcabd', '#8fb8c9'], ['#eaf1f2', '#c3ccd0', '#e5a29a'], ['#f4efd8', '#d1c9a8', '#9fc49a'], ['#e9e6de', '#c4bfb4', '#f0d57a'], ['#eef0f4', '#c6c9d2', '#b9a6d0'], ['#f6f3ea', '#d4cfc2', '#6f9fc4']];
const SCHERM = ['#e8433a', '#f6f2e6', '#2f7fc1', '#f0b429', '#3fbf9a', '#e86a3a'];
const PARASOL = [['#2f6fb0', '#f2efe6'], ['#e8433a', '#f2efe6'], ['#f0b429', '#ffffff'], ['#2f9e5b', '#f2e7b8']];
const VACHT = ['#8a5a34', '#2a2522', '#e3d3b0', '#c9a06a'];
const EMMER = ['#e8433a', '#f0d34a', '#2f7fc1', '#3fbf5a', '#ff7aa8'];
const FIETS = ['#2a2c30', '#a8322d', '#2f5d8a', '#3d6b48', '#d9d9d4', '#e09a2a'];
const AUTO = ['#d9d9d4', '#f1efe8', '#2a2c30', '#a8322d', '#2f5d8a', '#d9a63a', '#3d6b48', '#7a5236'];
const KRAT = ['#2f6fb0', '#e8e4d8', '#c0392b', '#3a8a5a'];
const KOTTER = ['#2b4a6a', '#7a2a24', '#2f5a48', '#3a3f45', '#c9b07a'];
const KOTTER_U = [-2.3, 0, 2.3]; // ligplaatsen langs de kade van een vissershaven (u, eenheden)
// noordwest (waar het licht vandaan komt) als eenheidsvector
const NWX = -Math.SQRT1_2, NWY = -Math.SQRT1_2;
const S_DUIN = 1, S_DIJK = 2, S_DROOG = 4; // vlaggen per strandpunt (vast per wereld)
const P_VRIJ = 1, P_PAD = 2, P_BEZET = 4; // per strandpunt, per toestand (druk in de bits 4-5)
const STAP = 1.5; // afstand tussen strandpunten langs de waterlijn (eenheden)
// strandinrichting: soort, x, y, nx, ny, zaad, druk, extra
const DING = 8;
const HUISJE_S = 0, STOEL_S = 1, SCHERM_S = 2, DOEK_S = 3, PAVILJOEN_S = 4, POST_S = 5, VELD_S = 6, KASTEEL_S = 7, GAT_S = 8, REK_S = 9;
// lopers langs de waterlijn: eerste punt, laatste punt, soort, zaad, snelheid, afstand tot de waterlijn, druk
const LOOP = 7;
const WANDEL = 0, JOGGER = 1, IJSKAR = 2, JUTTER = 3;
// mensen en honden op het strand worden eerst verzameld en dan per kleur in één keer getekend
const MENS = 8; // X, Y, hx, hy, houding (0 staand, 1 liggend, 2 zittend, 3 kind, 4 alleen hoofd), kleding, huid, fase
const STAAND = 0, LIGGEND = 1, ZITTEND = 2, KIND = 3, HOOFD_S = 4;
const HOND = 6; // X, Y, hx, hy, vacht, fase
const DRUK_F = [0.2, 0.45, 0.75, 1]; // hoeveel van de inrichting bezet is, per drukte (stil strand .. badplaats)
const D_TELLERS = ['strandpunten', 'getij', 'vloedlijn', 'aangespoeld', 'sporen', 'huisjes', 'paviljoens', 'reddingsposten', 'velden', 'stoelsets', 'schermen', 'handdoeken', 'kastelen', 'gaten', 'mensen', 'lopers', 'honden', 'duinpaden', 'rekken', 'helm', 'konijnen', 'dijken', 'schapen', 'zandbanken', 'bankzeehonden', 'hengelaars', 'sloepen', 'kraantjes', 'vissershavens', 'kotters', 'meeuwen', 'veerstoepen', 'autos'];
// Lichtjes op de hoeken van het booreilanddek, ten opzichte van het anker (tegels).
const BOOR_LICHT = [[-0.09, -0.02], [0.09, -0.02], [-0.09, -0.14], [0.09, -0.14]];
// Havenarmen in het havenkader (u langs de kade, v het water in vanaf de kade; u maal de kant, v plus dq).
const HAVENARM = [
  [[0.62, -0.1], [0.66, 0.55], [0.54, 0.96], [0.24, 1.14]],
  [[0.62, -0.1], [0.66, 0.5], [0.52, 0.88]],
  [[0.8, -0.1], [0.86, 0.62], [0.7, 0.9]],
  [[0.55, -0.1], [0.58, 0.62]],
  [[0.95, -0.1], [1.0, 0.65]],
  [[0.75, -0.1], [0.62, 0.55]],
];

function stip(c, x, y, r) {
  if (r < 1.5) { c.rect(x - r, y - r, r * 2, r * 2); return; }
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, TAU);
}

// Rechthoek met halve lengte l langs (hx, hy) en halve breedte w.
function rechthoek(c, x, y, hx, hy, l, w) {
  const px = -hy * w, py = hx * w, lx = hx * l, ly = hy * l;
  c.moveTo(x + lx + px, y + ly + py);
  c.lineTo(x + lx - px, y + ly - py);
  c.lineTo(x - lx - px, y - ly - py);
  c.lineTo(x - lx + px, y - ly + py);
  c.closePath();
}

// Maat van gebakken bitmaps in stappen van een kwart octaaf: zoomen bakt niet elk beeld opnieuw.
const emmer = (px) => Math.min(MAX_P, Math.max(24, Math.round(Math.pow(2, Math.round(Math.log2(Math.max(1, px)) * 4) / 4))));

function sdOp(sd, x, y) {
  const px = x < 0 ? 0 : x > W - 1 ? W - 1 : x | 0, py = y < 0 ? 0 : y > H - 1 ? H - 1 : y | 0;
  return sd[py * W + px];
}

// Richting van de kust af (zeewaarts) op (x, y): de helling van het afstandsveld. Geeft de lengte terug.
function normaal(sd, x, y, uit) {
  const gx = sdOp(sd, x + 1.5, y) - sdOp(sd, x - 1.5, y), gy = sdOp(sd, x, y + 1.5) - sdOp(sd, x, y - 1.5);
  const l = Math.hypot(gx, gy);
  if (l < 1e-6) { uit[0] = 1; uit[1] = 0; return 0; }
  uit[0] = gx / l; uit[1] = gy / l;
  return l;
}

function bakGloed(cv, [r, g, b]) {
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gr.addColorStop(0.35, `rgba(${r},${g},${b},0.45)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = gr;
  c.fillRect(0, 0, 32, 32);
}

// De lichtbundel van een vuurtoren: een wig die naar buiten toe uitdooft (128 x 32, oorsprong links in het midden).
function bakBundel(cv) {
  const c = cv.getContext('2d');
  const gr = c.createLinearGradient(0, 0, 128, 0);
  gr.addColorStop(0, 'rgba(255,246,214,0.85)');
  gr.addColorStop(0.4, 'rgba(255,240,200,0.32)');
  gr.addColorStop(1, 'rgba(255,240,200,0)');
  c.fillStyle = gr;
  c.beginPath(); c.moveTo(0, 15); c.lineTo(128, 0); c.lineTo(128, 32); c.lineTo(0, 17); c.closePath(); c.fill();
}

// ---------- bakken (tegeleenheden, oorsprong in het midden van de bitmap; zie elk anker) ----------

// Vuurtoren met wachtershuisje. Anker (voet van de toren) op (-0.1, 0.16); de lamp zit 0,428 tegel hoger.
function bakVuurtoren(g, v, b) {
  const fx = -0.1, fy = 0.16, Ht = 0.4, r0 = 0.042, r1 = 0.028, S = SCHUIN;
  const hx = fx - v.nx * 0.14, hy = fy - v.ny * 0.14;
  const huis = () => {
    const hw = 0.052, hd = 0.032, hh = 0.038;
    g.fillStyle = 'rgba(0,0,0,0.26)';
    g.beginPath(); g.moveTo(hx - hw, hy + hd); g.lineTo(hx + hw, hy + hd); g.lineTo(hx + hw + hh * S, hy + hd + hh * S); g.lineTo(hx - hw + hh * S, hy + hd + hh * S); g.closePath(); g.fill();
    g.fillRect(hx + hw, hy - hd, hh * S, 2 * hd + hh * S);
    g.fillStyle = '#e9e4d8'; g.fillRect(hx - hw, hy + hd - hh, 2 * hw, hh);
    g.fillStyle = '#4a3a2c'; g.fillRect(hx - 0.008, hy + hd - 0.024, 0.016, 0.024);
    g.fillStyle = '#3a4a52'; g.fillRect(hx - hw * 0.7, hy + hd - 0.026, 0.012, 0.012); g.fillRect(hx + hw * 0.7 - 0.012, hy + hd - 0.026, 0.012, 0.012);
    g.fillStyle = b.sn ? '#eef1f3' : '#a8483a'; g.fillRect(hx - hw - 0.006, hy - hd - hh - 0.004, 2 * hw + 0.012, hd + 0.004);
    g.fillStyle = b.sn ? '#d5dadd' : '#7f3328'; g.fillRect(hx - hw - 0.006, hy - hh, 2 * hw + 0.012, hd + 0.004);
  };
  // erf om de voet, pad naar het huisje
  g.fillStyle = b.sn ? '#dfe3e5' : '#b9b2a2';
  g.beginPath(); g.ellipse(fx, fy, 0.066, 0.044, 0, 0, TAU); g.fill();
  g.strokeStyle = g.fillStyle; g.lineWidth = 0.016; g.beginPath(); g.moveTo(fx, fy); g.lineTo(hx, hy); g.stroke();
  // schaduw van de toren naar het zuidoosten
  const k = Math.SQRT1_2;
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath();
  g.moveTo(fx - r0 * k, fy + r0 * k); g.lineTo(fx + r0 * k, fy - r0 * k);
  g.lineTo(fx + Ht * S + r1 * k, fy + Ht * S - r1 * k); g.lineTo(fx + Ht * S - r1 * k, fy + Ht * S + r1 * k); g.closePath(); g.fill();
  if (hy < fy) huis();
  // toren: taps, wit met twee rode banden, rechts in de schaduw
  g.fillStyle = '#efebe3'; g.beginPath();
  g.moveTo(fx - r0, fy); g.lineTo(fx - r1, fy - Ht); g.lineTo(fx + r1, fy - Ht); g.lineTo(fx + r0, fy); g.ellipse(fx, fy, r0, r0 * 0.4, 0, 0, Math.PI); g.closePath(); g.fill();
  const r = (h) => r0 + ((r1 - r0) * h) / Ht;
  g.fillStyle = '#b33a2f';
  for (const [a, c] of [[0.1, 0.17], [0.24, 0.31]]) { g.beginPath(); g.moveTo(fx - r(a), fy - a); g.lineTo(fx - r(c), fy - c); g.lineTo(fx + r(c), fy - c); g.lineTo(fx + r(a), fy - a); g.closePath(); g.fill(); }
  g.fillStyle = 'rgba(40,30,30,0.22)'; g.beginPath(); g.moveTo(fx + r0 * 0.15, fy); g.lineTo(fx + r1 * 0.15, fy - Ht); g.lineTo(fx + r1, fy - Ht); g.lineTo(fx + r0, fy); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.006; g.beginPath(); g.moveTo(fx - r0 * 0.6, fy - 0.01); g.lineTo(fx - r1 * 0.6, fy - Ht + 0.01); g.stroke();
  g.fillStyle = '#3a2e26'; g.fillRect(fx - 0.01, fy - 0.03, 0.02, 0.03);
  g.fillStyle = '#2f3a40'; g.fillRect(fx - 0.005, fy - 0.215, 0.01, 0.014); g.fillRect(fx - 0.004, fy - 0.36, 0.008, 0.012);
  // omloop, lantaarn met glas, koepel
  g.fillStyle = '#2c2c2c'; g.fillRect(fx - r1 * 1.6, fy - Ht - 0.006, r1 * 3.2, 0.012);
  g.strokeStyle = '#2c2c2c'; g.lineWidth = 0.003; g.beginPath(); g.moveTo(fx - r1 * 1.6, fy - Ht - 0.018); g.lineTo(fx + r1 * 1.6, fy - Ht - 0.018); g.stroke();
  g.fillStyle = '#33464f'; g.fillRect(fx - r1 * 0.75, fy - Ht - 0.05, r1 * 1.5, 0.044);
  g.fillStyle = '#e8d9a0'; g.fillRect(fx - r1 * 0.45, fy - Ht - 0.044, r1 * 0.9, 0.032);
  g.fillStyle = b.sn ? '#eef1f3' : '#9b2f26'; g.beginPath(); g.ellipse(fx, fy - Ht - 0.05, r1 * 0.85, 0.022, 0, Math.PI, TAU); g.fill();
  g.strokeStyle = '#2c2c2c'; g.lineWidth = 0.004; g.beginPath(); g.moveTo(fx, fy - Ht - 0.072); g.lineTo(fx, fy - Ht - 0.086); g.stroke();
  if (hy >= fy) huis();
}

// Booreiland op vier poten met boortoren, kraan, helidek (zonder tekens), woonblok en fakkelarm. Anker (waterlijn
// onder het midden van het dek) op (-0.08, 0.14); de fakkel zit op (+0.24, -0.255) van het anker.
function bakBooreiland(g, o, b) {
  const cx = -0.08, cy = 0.14, hd = 0.075, w = 0.11, d = 0.08, S = SCHUIN, r = rnd(o.zaad);
  const toren = r() < 0.5 ? '#c8a23a' : '#b84a32';
  // schaduw van dek en toren op het water
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(cx - w + hd * S, cy - d + hd * S, 2 * w, 2 * d);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.02; g.beginPath(); g.moveTo(cx + w * 0.35 + hd * S, cy - d * 0.2 + hd * S); g.lineTo(cx + w * 0.35 + (hd + 0.2) * S, cy - d * 0.2 + (hd + 0.2) * S); g.stroke();
  // poten, met een schuimkraag op het water
  g.strokeStyle = 'rgba(235,245,248,0.6)'; g.lineWidth = 0.005;
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.beginPath(); g.ellipse(cx + u * w * 0.8, cy + v * d * 0.8, 0.02, 0.009, 0, 0, TAU); g.stroke(); }
  g.strokeStyle = '#5d5a55'; g.lineWidth = 0.016; g.beginPath();
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.moveTo(cx + u * w * 0.8, cy + v * d * 0.8); g.lineTo(cx + u * w * 0.8, cy + v * d * 0.8 - hd); }
  g.stroke();
  g.strokeStyle = '#6d6a64'; g.lineWidth = 0.004; g.beginPath(); g.moveTo(cx - w * 0.8, cy + d * 0.8 - hd * 0.2); g.lineTo(cx + w * 0.8, cy + d * 0.8 - hd * 0.7); g.moveTo(cx - w * 0.8, cy + d * 0.8 - hd * 0.7); g.lineTo(cx + w * 0.8, cy + d * 0.8 - hd * 0.2); g.stroke();
  // dek: zijkant naar de kijker, dan het bovenvlak met roosters
  g.fillStyle = '#4a4a48'; g.fillRect(cx - w, cy + d - hd, 2 * w, 0.026);
  g.fillStyle = '#8f8c86'; g.fillRect(cx - w, cy - d - hd, 2 * w, 2 * d);
  if (b.P > 260) { g.strokeStyle = 'rgba(40,40,40,0.25)'; g.lineWidth = 0.002; g.beginPath(); for (let x = cx - w; x < cx + w; x += 0.02) { g.moveTo(x, cy - d - hd); g.lineTo(x, cy + d - hd); } g.stroke(); }
  g.strokeStyle = '#d7b84a'; g.lineWidth = 0.004; g.strokeRect(cx - w + 0.004, cy - d - hd + 0.004, 2 * w - 0.008, 2 * d - 0.008);
  // woonblok
  const qx = cx - w * 0.9, qy = cy - d * 0.9 - hd, qw = w * 0.75, qd = d * 0.8, qh = 0.05;
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(qx + qh * S, qy + qh * S, qw, qd);
  g.fillStyle = '#d9d5cc'; g.fillRect(qx, qy + qd - qh, qw, qh);
  g.fillStyle = '#2f4152'; for (let i = 0; i < 4; i++) g.fillRect(qx + 0.008 + i * qw / 4, qy + qd - qh + 0.012, qw / 8, 0.008);
  g.fillStyle = '#efece5'; g.fillRect(qx, qy - qh, qw, qd);
  // helidek op palen, zonder letters: een ring en een gestippelde rand
  const hx = cx - w * 0.45, hy = cy + d * 0.3 - hd - 0.02, hr = 0.05;
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(hx + 0.02, hy + 0.025, hr, hr * 0.9, 0, 0, TAU); g.fill();
  g.fillStyle = '#3f5a48'; g.beginPath(); g.ellipse(hx, hy, hr, hr * 0.9, 0, 0, TAU); g.fill();
  g.strokeStyle = '#e8e4d8'; g.lineWidth = 0.004; g.beginPath(); g.ellipse(hx, hy, hr * 0.62, hr * 0.56, 0, 0, TAU); g.stroke();
  g.strokeStyle = '#e0b020'; g.setLineDash([0.012, 0.008]); g.beginPath(); g.ellipse(hx, hy, hr * 0.95, hr * 0.85, 0, 0, TAU); g.stroke(); g.setLineDash([]);
  // boortoren: vakwerk dat taps oploopt
  const tx = cx + w * 0.35, ty = cy - d * 0.2 - hd, th = 0.2;
  g.strokeStyle = toren; g.lineWidth = 0.006; g.beginPath();
  g.moveTo(tx - 0.03, ty); g.lineTo(tx - 0.007, ty - th); g.moveTo(tx + 0.03, ty); g.lineTo(tx + 0.007, ty - th);
  for (let i = 0; i < 6; i++) { const a = i / 6, c = (i + 1) / 6, ra = 0.03 - 0.023 * a, rc = 0.03 - 0.023 * c; g.moveTo(tx - ra, ty - th * a); g.lineTo(tx + rc, ty - th * c); g.moveTo(tx + ra, ty - th * a); g.lineTo(tx - rc, ty - th * c); }
  g.stroke();
  g.fillStyle = '#4a4a48'; g.fillRect(tx - 0.012, ty - th - 0.014, 0.024, 0.014);
  // kraan
  const kx = cx + w * 0.8, ky = cy + d * 0.6 - hd;
  g.fillStyle = '#d6a23a'; g.fillRect(kx - 0.01, ky - 0.03, 0.02, 0.03);
  g.strokeStyle = '#d6a23a'; g.lineWidth = 0.007; g.beginPath(); g.moveTo(kx, ky - 0.03); g.lineTo(kx - 0.12, ky - 0.12); g.stroke();
  g.strokeStyle = '#333'; g.lineWidth = 0.0025; g.beginPath(); g.moveTo(kx - 0.12, ky - 0.12); g.lineTo(kx - 0.12, ky - 0.06); g.stroke();
  // fakkelarm schuin naar buiten
  const ax = cx + w, ay = cy - d * 0.5 - hd, fx = cx + 0.24 + 0.08 - 0.08, fy = cy - 0.255;
  g.strokeStyle = '#7a7d80'; g.lineWidth = 0.005; g.beginPath();
  g.moveTo(ax, ay); g.lineTo(fx, fy); g.moveTo(ax, ay + 0.014); g.lineTo(fx, fy + 0.006);
  for (let i = 0; i < 5; i++) { const a = i / 5, c = (i + 1) / 5; g.moveTo(ax + (fx - ax) * a, ay + (fy - ay) * a); g.lineTo(ax + (fx - ax) * c, ay + 0.014 + (fy + 0.006 - ay - 0.014) * c); }
  g.stroke();
}

// Viskwekerij: ronde netkooien met een drijvende ring, een looppad en een voerponton. Anker in het midden; de
// opstelling schuift VK_U langs de looprichting zodat kooien en ponton samen om het anker liggen.
const VK_U = -0.12;
function bakViskweek(g, o, b) {
  const co = Math.cos(o.hoek), si = Math.sin(o.hoek), r = rnd(o.zaad), S = SCHUIN;
  const P = (u, v) => [(u + VK_U) * co - v * si, (u + VK_U) * si + v * co];
  const rij = o.rijen, kol = o.kolommen, af = 0.17, R = 0.062;
  // looppad
  g.strokeStyle = '#7d7466'; g.lineWidth = 0.012; g.beginPath();
  const [a0x, a0y] = P(-af * (kol - 1) / 2, 0), [a1x, a1y] = P(af * (kol - 1) / 2 + 0.2, 0);
  g.moveTo(a0x, a0y); g.lineTo(a1x, a1y); g.stroke();
  for (let i = 0; i < rij; i++) for (let j = 0; j < kol; j++) {
    const [x, y] = P((j - (kol - 1) / 2) * af, (i - (rij - 1) / 2) * af);
    g.fillStyle = 'rgba(6,26,34,0.42)'; g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
    if (b.P > 260) { g.strokeStyle = 'rgba(200,210,205,0.18)'; g.lineWidth = 0.002; g.beginPath(); g.arc(x, y, R * 0.6, 0, TAU); g.moveTo(x + R * 0.3, y); g.arc(x, y, R * 0.3, 0, TAU); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.01; g.beginPath(); g.arc(x + 0.006, y + 0.008, R, 0, TAU); g.stroke();
    g.strokeStyle = '#d8d2c0'; g.lineWidth = 0.009; g.beginPath(); g.arc(x, y, R, 0, TAU); g.stroke();
    g.strokeStyle = '#5f5f5a'; g.lineWidth = 0.003; g.beginPath(); g.arc(x, y, R + 0.007, 0, TAU); g.stroke();
    if (b.P > 260) { g.fillStyle = '#5f5f5a'; for (let k = 0; k < 8; k++) { const a = (k * TAU) / 8; g.fillRect(x + Math.cos(a) * (R + 0.007) - 0.002, y + Math.sin(a) * (R + 0.007) - 0.006, 0.004, 0.006); } }
  }
  // voerponton met silo
  const [bx, by] = P(af * (kol - 1) / 2 + 0.26, 0);
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); rechthoek(g, bx + 0.012, by + 0.016, co, si, 0.06, 0.035); g.fill();
  g.fillStyle = '#3f4a52'; g.beginPath(); rechthoek(g, bx, by, co, si, 0.06, 0.035); g.fill();
  g.fillStyle = '#d9d5cc'; g.fillRect(bx - 0.03, by - 0.03, 0.04, 0.03);
  g.fillStyle = '#e9e6de'; g.fillRect(bx - 0.03, by - 0.04, 0.04, 0.012);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(bx + 0.03 + 0.05 * S, by + 0.05 * S, 0.016, 0.009, 0, 0, TAU); g.fill();
  g.fillStyle = '#b9bcbf'; g.fillRect(bx + 0.014, by - 0.05, 0.032, 0.05);
  g.fillStyle = '#d9dcde'; g.beginPath(); g.ellipse(bx + 0.03, by - 0.05, 0.016, 0.007, 0, 0, TAU); g.fill();
  // ankerboeien op de hoeken
  g.fillStyle = '#d46a2a';
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const [x, y] = P(u * (af * (kol - 1) / 2 + 0.1), v * (af * (rij - 1) / 2 + 0.1)); g.beginPath(); g.arc(x, y, 0.008, 0, TAU); g.fill(); }
  void r;
}

// Jachthaven: drijvende steiger met vingers, jachten met masten en kuipjes, een drijvende golfbreker en een clubhuis op
// de wal. Gebakken in wereldrichting: de masten staan recht omhoog. Anker (punt op de waterlijn) op o.ax, o.ay.
function bakJachthaven(g, o, b) {
  const tx = -o.ny, ty = o.nx, nx = o.nx, ny = o.ny, S = SCHUIN, r = rnd(o.zaad);
  const X = (u, v) => o.ax + tx * u + nx * v, Y = (u, v) => o.ay + ty * u + ny * v;
  const balk = (u0, v0, u1, v1, br, kleur) => { g.strokeStyle = kleur; g.lineWidth = br; g.beginPath(); g.moveTo(X(u0, v0), Y(u0, v0)); g.lineTo(X(u1, v1), Y(u1, v1)); g.stroke(); };
  // clubhuis op de wal
  if (o.club) {
    const cx = X(0.2, -0.1), cy = Y(0.2, -0.1), hh = 0.035;
    g.fillStyle = 'rgba(0,0,0,0.26)'; g.fillRect(cx - 0.05 + hh * S, cy - 0.03 + hh * S, 0.1, 0.06);
    g.fillStyle = '#e9e6de'; g.fillRect(cx - 0.05, cy + 0.03 - hh, 0.1, hh);
    g.fillStyle = '#2f4152'; g.fillRect(cx - 0.04, cy + 0.03 - hh + 0.01, 0.08, 0.01);
    g.fillStyle = b.sn ? '#eef1f3' : '#2f5d7a'; g.fillRect(cx - 0.054, cy - 0.03 - hh, 0.108, 0.06);
  }
  // golfbreker (drijvend), met een opening aan één kant
  const L = o.lang, f = L / 0.46;
  balk(-0.38 * f, L + 0.08, 0.26 * f, L + 0.08, 0.022, 'rgba(0,0,0,0.25)');
  balk(-0.38 * f, L + 0.07, 0.26 * f, L + 0.07, 0.02, '#9a958b');
  // steiger en vingers
  balk(0, 0, 0, L, 0.03, '#6f6250');
  balk(0, 0, 0, L, 0.022, '#b9a888');
  const boten = [];
  for (let v = 0.08; v <= L - 0.04; v += 0.065) {
    for (const kant of [-1, 1]) {
      balk(kant * 0.012, v, kant * 0.13, v, 0.012, '#b9a888');
      // een jacht in de box naast deze vinger
      if (r() < 0.78) boten.push({ u: kant * 0.075, v: v + 0.0325, kant, zeil: r() < 0.72, kleur: JACHT[Math.floor(r() * JACHT.length)], mast: 0.13 + r() * 0.07, hoes: r() < 0.5 ? '#2f5d9a' : '#c9c2b4' });
    }
  }
  // rompen: de boeg wijst van de steiger af; eerst alle schaduwen, dan de rompen, dan de masten (van achter naar voor)
  for (const bt of boten) {
    const hx = tx * bt.kant, hy = ty * bt.kant, x = X(bt.u, bt.v), y = Y(bt.u, bt.v);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); romp(g, x + 0.008, y + 0.01, hx, hy, 0.05, 0.016); g.fill();
    g.fillStyle = bt.kleur; g.beginPath(); romp(g, x, y, hx, hy, 0.05, 0.016); g.fill();
    g.fillStyle = bt.zeil ? '#a4865a' : '#e7e3da'; g.beginPath(); rechthoek(g, x - hx * 0.01, y - hy * 0.01, hx, hy, 0.022, 0.009); g.fill();
    if (!bt.zeil) { g.fillStyle = '#2f4152'; g.beginPath(); rechthoek(g, x + hx * 0.008, y + hy * 0.008, hx, hy, 0.008, 0.008); g.fill(); }
  }
  boten.sort((p, q) => Y(p.u, p.v) - Y(q.u, q.v));
  for (const bt of boten) {
    if (!bt.zeil) continue;
    const x = X(bt.u, bt.v), y = Y(bt.u, bt.v), hx = tx * bt.kant, hy = ty * bt.kant;
    g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 0.003; g.beginPath(); g.moveTo(x, y); g.lineTo(x + bt.mast * S, y + bt.mast * S); g.stroke();
    g.strokeStyle = bt.hoes; g.lineWidth = 0.007; g.beginPath(); g.moveTo(x, y - 0.012); g.lineTo(x - hx * 0.03, y - hy * 0.03 - 0.012); g.stroke();
    g.strokeStyle = '#d8d8d4'; g.lineWidth = 0.0035; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - bt.mast); g.stroke();
    if (b.P > 300) { g.strokeStyle = 'rgba(200,200,196,0.6)'; g.lineWidth = 0.0012; g.beginPath(); g.moveTo(x, y - bt.mast); g.lineTo(x + hx * 0.045, y + hy * 0.045); g.moveTo(x, y - bt.mast); g.lineTo(x - hx * 0.045, y - hy * 0.045); g.stroke(); }
  }
  o.masten = boten.filter((bt) => bt.zeil).slice(0, 8).map((bt) => [X(bt.u, bt.v) - o.ax, Y(bt.u, bt.v) - o.ay, bt.mast]);
}

// Romp van een jacht: spitse boeg in de richting (hx, hy).
function romp(g, x, y, hx, hy, l, w) {
  const px = -hy * w, py = hx * w;
  g.moveTo(x + hx * l, y + hy * l);
  g.lineTo(x + hx * l * 0.35 + px, y + hy * l * 0.35 + py);
  g.lineTo(x - hx * l + px * 0.85, y - hy * l + py * 0.85);
  g.lineTo(x - hx * l - px * 0.85, y - hy * l - py * 0.85);
  g.lineTo(x + hx * l * 0.35 - px, y + hy * l * 0.35 - py);
  g.closePath();
}

// Rotsblok of groepje rotsen (variant 0..5). Bitmap van 0,16 x 0,14 tegel voor een rots met straal 1 eenheid.
function bakRots(g, o, b) {
  const r = rnd(o.variant * 7919 + 13), n = 1 + Math.floor(r() * 3);
  const kl = ['#7d776c', '#6f6a62', '#857c6c', '#6a6560'];
  const blokken = [];
  for (let i = 0; i < n; i++) blokken.push({ x: (r() - 0.5) * 0.06 * (i ? 1 : 0.3), y: (r() - 0.5) * 0.04 * (i ? 1 : 0.3), rb: (i ? 0.018 + r() * 0.012 : 0.03 + r() * 0.01), k: kl[Math.floor(r() * kl.length)], f: r() * TAU });
  blokken.sort((p, q) => p.y - q.y);
  const vorm = (bl, s, dx, dy) => {
    g.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = bl.f + (k * TAU) / 7, rr = bl.rb * s * (0.78 + 0.3 * hash(o.variant, k, Math.floor(bl.f * 100)));
      const x = bl.x + dx + Math.cos(a) * rr, y = bl.y + dy + Math.sin(a) * rr * 0.72;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath();
  };
  for (const bl of blokken) { g.fillStyle = 'rgba(0,0,0,0.3)'; vorm(bl, 1, bl.rb * 0.45, bl.rb * 0.5); g.fill(); }
  for (const bl of blokken) {
    g.fillStyle = bl.k; vorm(bl, 1, 0, 0); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.18)'; vorm(bl, 0.75, bl.rb * 0.2, bl.rb * 0.2); g.fill();
    g.fillStyle = 'rgba(255,250,235,0.22)'; vorm(bl, 0.55, -bl.rb * 0.3, -bl.rb * 0.3); g.fill();
    if (b.sn) { g.fillStyle = 'rgba(244,246,248,0.9)'; vorm(bl, 0.5, -bl.rb * 0.25, -bl.rb * 0.35); g.fill(); }
    if (b.P > 300) { g.strokeStyle = 'rgba(30,26,22,0.35)'; g.lineWidth = 0.0015; g.beginPath(); g.moveTo(bl.x - bl.rb * 0.3, bl.y); g.lineTo(bl.x + bl.rb * 0.1, bl.y + bl.rb * 0.25); g.stroke(); }
  }
}

// Stuwdam met stuwmeer, in wereldrichting. o.meer: oeverpunten (wereld) van het meer, o.dam: de damboog.
// Oorsprong van de bitmap = o.mx, o.my (midden van het kader).
function bakDam(g, o, b) {
  const L = (x) => x - o.mx, M = (y) => y - o.my, Tw = o.Tw, S = SCHUIN;
  const pts = o.meer, n = pts.length / 2;
  const pad = () => { g.beginPath(); for (let i = 0; i < n; i++) { const x = L(pts[i * 2]) / Tw, y = M(pts[i * 2 + 1]) / Tw; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); };
  // meer: oeverrand van steen en ondiep water, dan het diepe midden; in de winter ijs
  const ijs = b.ijs;
  g.fillStyle = b.sn ? '#c9cccd' : '#8a8173'; g.strokeStyle = g.fillStyle; g.lineWidth = 0.05; pad(); g.stroke();
  g.fillStyle = ijs > 0.5 ? '#c6d8de' : '#4d8780'; pad(); g.fill();
  g.strokeStyle = ijs > 0.5 ? '#b2c8cf' : '#4d8780'; g.lineWidth = 0.02; g.stroke();
  g.save(); pad(); g.clip();
  g.strokeStyle = ijs > 0.5 ? 'rgba(170,196,204,0.8)' : 'rgba(42,90,108,0.9)'; g.lineWidth = 0.09;
  g.beginPath(); for (let i = 0; i < o.as.length / 2; i++) { const x = L(o.as[i * 2]) / Tw, y = M(o.as[i * 2 + 1]) / Tw; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
  g.restore();
  // de dam: een boog bovenstrooms, kruin met weg, en (als die naar de kijker kijkt) de betonnen voorkant met overlaat
  const [ax, ay, kx, ky, bx, by] = o.dam.map((v, i) => (i & 1 ? M(v) : L(v)) / Tw);
  const hoog = 0.05, voor = o.voorzicht;
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.035; g.beginPath(); g.moveTo(ax + hoog * S, ay + hoog * S); g.quadraticCurveTo(kx + hoog * S, ky + hoog * S, bx + hoog * S, by + hoog * S); g.stroke();
  if (voor) {
    g.fillStyle = '#9f9a8e'; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(kx, ky, bx, by); g.lineTo(bx, by + hoog); g.quadraticCurveTo(kx, ky + hoog, ax, ay + hoog); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(60,58,52,0.35)'; g.lineWidth = 0.003; g.beginPath();
    for (let i = 1; i < 12; i++) { const t = i / 12, x = (1 - t) * (1 - t) * ax + 2 * t * (1 - t) * kx + t * t * bx, y = (1 - t) * (1 - t) * ay + 2 * t * (1 - t) * ky + t * t * by; g.moveTo(x, y); g.lineTo(x, y + hoog); }
    g.stroke();
    // overlaat in het midden: een witte goot
    const x = 0.25 * ax + 0.5 * kx + 0.25 * bx, y = 0.25 * ay + 0.5 * ky + 0.25 * by;
    g.fillStyle = 'rgba(235,245,248,0.85)'; g.fillRect(x - 0.02, y, 0.04, hoog);
  }
  g.strokeStyle = '#c9c4b8'; g.lineWidth = 0.03; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(kx, ky, bx, by); g.stroke();
  g.strokeStyle = '#55524c'; g.lineWidth = 0.008; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(kx, ky, bx, by); g.stroke();
  if (b.sn) { g.strokeStyle = 'rgba(244,246,248,0.8)'; g.lineWidth = 0.01; g.beginPath(); g.moveTo(ax, ay - 0.01); g.quadraticCurveTo(kx, ky - 0.01, bx, by - 0.01); g.stroke(); }
  // centrale onder de dam
  const cx = L(o.centrale[0]) / Tw, cy = M(o.centrale[1]) / Tw, hh = 0.035;
  g.fillStyle = 'rgba(0,0,0,0.26)'; g.fillRect(cx - 0.05 + hh * S, cy - 0.03 + hh * S, 0.1, 0.06);
  g.fillStyle = '#b9b4a8'; g.fillRect(cx - 0.05, cy + 0.03 - hh, 0.1, hh);
  g.fillStyle = '#2f4152'; for (let i = 0; i < 3; i++) g.fillRect(cx - 0.04 + i * 0.03, cy + 0.03 - hh + 0.01, 0.018, 0.012);
  g.fillStyle = b.sn ? '#eef1f3' : '#6d6a64'; g.fillRect(cx - 0.052, cy - 0.03 - hh, 0.104, 0.06);
}

// ---------- vaste analyse per wereld (alleen kaart en terrein, geen toestand) ----------

const wereldCache = new WeakMap(); // basis → analyse

function analyse(geo, b, tl) {
  const sd = b.sd, Tw = geo.T, kol = geo.kol, rij = geo.rij, n2 = [0, 0];
  const tegel = (x, y) => clamp(Math.floor(y / Tw), 0, rij - 1) * kol + clamp(Math.floor(x / Tw), 0, kol - 1);
  const ring = (x, y, r, zee) => { let n = 0; for (let i = 0; i < 16; i++) { const a = (i * TAU) / 16, s = sdOp(sd, x + Math.cos(a) * r, y + Math.sin(a) * r); if (zee ? s > 0 : s < 0) n++; } return n / 16; };
  // kapen: landpunten vlak bij de kust met veel zee eromheen
  const kapen = [];
  for (let y = 4; y < H - 4; y += 2) for (let x = 4; x < W - 4; x += 2) {
    const s = sdOp(sd, x, y);
    if (s < -2.6 || s > -0.8) continue;
    const f = ring(x, y, 10, true);
    if (f < 0.58) continue;
    const t = tegel(x, y), tg = geo.tegels[t];
    if (!tg || tg.terrein === 'water' || normaal(sd, x, y, n2) < 0.1) continue;
    kapen.push({ x, y, score: f + 0.15 * ring(x, y, 18, true), nx: n2[0], ny: n2[1], t });
  }
  kapen.sort((p, q) => q.score - p.score || p.t - q.t || p.y - q.y || p.x - q.x);
  const kaap = [];
  for (const k of kapen) { if (kaap.length >= 60) break; if (!kaap.some((o) => Math.abs(o.x - k.x) + Math.abs(o.y - k.y) < 1.5 * Tw)) kaap.push(k); }
  // rotsen langs kliffen, rollers langs stranden
  const rots = [], rol = [];
  for (let y = 3; y < H - 3; y += 2) for (let x = 3; x < W - 3; x += 2) {
    const px = x + (hash(x, y, 1) - 0.5) * 1.6, py = y + (hash(x, y, 2) - 0.5) * 1.6, s = sdOp(sd, px, py);
    if (s < -0.4 || s > 2.5) continue;
    if (normaal(sd, px, py, n2) < 0.1) continue;
    const nx = n2[0], ny = n2[1], t = tegel(px - nx * 2.5, py - ny * 2.5), tg = geo.tegels[t];
    if (!tg || tg.terrein === 'water') continue;
    if (b.klif[t]) {
      if (s <= 1.6 && hash(x, y, 3) < 0.5 && rots.length < 4000 * 6) rots.push(px, py, 0.45 + hash(x, y, 4) * 0.9 * (1 - s / 3), (x * 977 + y * 131) | 0, nx, ny);
    } else if ((b.duin[t] || (tg.terrein === 'kust' && tg.hoogte < 0.5)) && s >= 0.6 && x % 4 === 1 && y % 4 === 1 && hash(x, y, 5) < 0.65) {
      // een strand met open zee ervoor: punt op ~0,8 van de waterlijn
      const x0 = px - nx * (s - 0.8), y0 = py - ny * (s - 0.8);
      if (sdOp(sd, x0 + nx * 6, y0 + ny * 6) > 3.5 && rol.length < 6000 * 6) rol.push(x0, y0, nx, ny, hash(x, y, 6), 1.4 + hash(x, y, 7) * 1.4);
    }
  }
  // beschutte baaien: zee met veel land eromheen maar genoeg water voor de kooien
  const baai = [];
  for (let y = 8; y < H - 8; y += 4) for (let x = 8; x < W - 8; x += 4) {
    const s = sdOp(sd, x, y);
    if (s < 3 || s > 8) continue;
    if (ring(x, y, 7, true) < 1) continue;
    const f = 1 - ring(x, y, 14, true);
    if (f < 0.55) continue;
    baai.push({ x, y, score: f, t: tegel(x, y) });
  }
  baai.sort((p, q) => q.score - p.score || p.t - q.t || p.y - q.y || p.x - q.x);
  const baaien = [];
  for (const k of baai) { if (baaien.length >= 30) break; if (!baaien.some((o) => Math.hypot(o.x - k.x, o.y - k.y) < 3 * Tw)) baaien.push(k); }
  // rivieren: lange brede stukken voor de binnenvaart, en bergrivieren voor een stuwdam
  const R = tl.rivieren, aakRuns = [], dammen = [];
  for (let ri = 0; ri < R.length; ri++) {
    const rv = R[ri], m = rv.br.length, p = rv.pts;
    if (!rv.open) continue;
    let a = -1;
    for (let i = 0; i <= m; i++) {
      const ok = i < m && rv.open[i] && rv.br[i] >= 2.3;
      if (ok && a < 0) a = i;
      if (!ok && a >= 0) { if (rv.s[i - 1] - rv.s[a] >= 50) aakRuns.push({ ri, a, e: i - 1 }); a = -1; }
    }
    // dampunten: open stukken in de bergen met genoeg rivier erboven voor een meer; per rivier de beste paar
    const kand = [];
    let open = 0;
    for (let i = 1; i < m - 1; i++) {
      open = rv.open[i] ? open + (rv.s[i] - rv.s[i - 1]) : 0;
      if (!rv.open[i] || rv.br[i] < 1.1 || rv.br[i] > 2.6 || open < 15) continue;
      const tg = geo.tegels[tegel(p[i * 2], p[i * 2 + 1])];
      if (!tg || (tg.terrein !== 'berg' && tg.hoogte < 0.6)) continue;
      kand.push({ ri, i, score: tg.hoogte + (tg.terrein === 'berg' ? 0.2 : 0) + 0.001 * open });
    }
    kand.sort((a, b) => b.score - a.score || a.i - b.i);
    const gekozen = [];
    for (const k of kand) { if (gekozen.length >= 6) break; if (!gekozen.some((o) => Math.abs(rv.s[o.i] - rv.s[k.i]) < 6)) gekozen.push(k); }
    dammen.push(...gekozen);
  }
  dammen.sort((p, q) => q.score - p.score || p.ri - q.ri || p.i - q.i);
  // water dat leven.js gebruikt en dat niet van de toestand afhangt: zeilboten, eenden, visgronden, strand en veerboten
  // (zelfde regels als laadPlus en laad daar, op tegels en vaste hashes)
  const veer = [];
  const leven = levenWater(geo, b.eigenaar, veer);
  return { kapen: kaap, rotsen: Float32Array.from(rots), rollers: Float32Array.from(rol), baaien, aakRuns, dammen, leven, veer, strand: strandKetens(geo, b, tl), zandbanken: zandbankPlekken(geo, b), land: landBezet(geo, b, tl) };
}

// Schijven (x, y, r) waar leven.js boten, eenden of zwemmers heeft, alleen uit de kaart. In veer komen de
// veerroutes: begin, eind en welke schijven bij die route horen (ax, ay, bx, by, eerste schijf, laatste schijf).
function levenWater(geo, eig, veer = []) {
  const T = geo.T, uit = [], kol = geo.kol, rij = geo.rij;
  const zee = (x, y) => { const px = Math.floor(x), py = Math.floor(y); if (px < 0 || py < 0 || px >= W || py >= H) return true; return eig[py * W + px] === -1; };
  const ringZee = (cx, cy, rx, ry) => { for (let i = 0; i < 8; i++) if (!zee(cx + Math.cos((i * TAU) / 8) * rx, cy + Math.sin((i * TAU) / 8) * ry)) return false; return true; };
  const aanLand = (t) => { for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) { const k = t.k + dk, r = t.r + dr; if (k < 0 || r < 0 || k >= kol || r >= rij) continue; if (geo.tegels[r * kol + k].terrein !== 'water') return true; } return false; };
  const landBinnen = (t, d) => { for (let dr = -d; dr <= d; dr++) for (let dk = -d; dk <= d; dk++) { const k = t.k + dk, r = t.r + dr; if (k < 0 || r < 0 || k >= kol || r >= rij) continue; if (geo.tegels[r * kol + k].terrein !== 'water') return true; } return false; };
  const kust = [];
  let nVis = 0;
  for (const t of geo.tegels) {
    if (t.terrein === 'water') {
      if (aanLand(t)) {
        kust.push(t);
        // zeilboot: vaarronde iets van de kust af
        if (hash(t.i, 5) < 0.08) {
          let vx = 0, vy = 0;
          for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) { const b = geo.tegels[(t.r + dr) * kol + t.k + dk]; if (b && b.terrein !== 'water' && Math.abs(b.k - t.k) <= 1) { vx -= dk; vy -= dr; } }
          const vl = Math.hypot(vx, vy) || 1;
          let x = t.x + (vx / vl) * 0.25 * T, y = t.y + (vy / vl) * 0.25 * T;
          if (!zee(x, y)) { x = t.x; y = t.y; }
          let r = 0.3;
          while (r > 0.08 && !ringZee(x, y, (r + 0.1) * T, (r * 0.6 + 0.1) * T)) r -= 0.04;
          if (r > 0.08) uit.push(x, y, (r + 0.14) * T);
        }
        // eenden (vanaf zoom 9 in leven.js)
        if (hash(t.i, 141) < 0.3) uit.push(t.x, t.y, 0.17 * T);
      } else if (hash(t.i, 71) < 0.07 && landBinnen(t, 3) && nVis < 40) {
        let r = 0.45;
        while (r > 0.15 && !ringZee(t.x, t.y, (r + 0.12) * T, (r * 0.7 + 0.12) * T)) r -= 0.06;
        if (r > 0.15) { nVis++; uit.push(t.x, t.y, (r + 0.16) * T); }
      }
      continue;
    }
    // strand: parasols op het zand, zwemmers ervoor in het water
    if (t.terrein === 'kust' && hash(t.i, 175) < 0.6) {
      let wx = 0, wy = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) { const k = t.k + dk, r = t.r + dr; if (k < 0 || r < 0 || k >= kol || r >= rij) continue; if (geo.tegels[r * kol + k].terrein === 'water') { wx += dk; wy += dr; } }
      const l = Math.hypot(wx, wy);
      if (l) { wx /= l; wy /= l; uit.push(t.x + wx * 0.26 * T, t.y + wy * 0.26 * T, 0.32 * T, t.x + wx * 0.65 * T, t.y + wy * 0.65 * T, 0.34 * T); }
    }
  }
  // veerboten: tussen twee stukken kust met open water ertussen
  const open = (x, y) => { const k = Math.floor(x / T), r = Math.floor(y / T); if (k < 0 || r < 0 || k >= kol || r >= rij) return false; const t = geo.tegels[r * kol + k]; return t.terrein === 'water' && !aanLand(t); };
  let nVeer = 0;
  for (let i = 0; i < kust.length && nVeer < 10; i++) {
    const a = kust[i];
    if (hash(a.i, 73) > 0.06) continue;
    let beste = null, bOpen = 0, bd = 0;
    for (let j = 0; j < kust.length; j++) {
      const b = kust[j], d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < 4 * T || d > 10 * T) continue;
      let nat = true, o = 0;
      for (let s = 1; s < 24 && nat; s++) { const x = a.x + ((b.x - a.x) * s) / 24, y = a.y + ((b.y - a.y) * s) / 24; if (!zee(x, y)) nat = false; else if (open(x, y)) o++; }
      if (nat && o >= 8 && (o > bOpen || (o === bOpen && d > bd))) { beste = b; bOpen = o; bd = d; }
    }
    if (beste) {
      nVeer++;
      const d = Math.hypot(beste.x - a.x, beste.y - a.y), k = Math.ceil(d / (0.2 * T)), eerste = uit.length / 3;
      for (let s = 0; s <= k; s++) uit.push(a.x + ((beste.x - a.x) * s) / k, a.y + ((beste.y - a.y) * s) / k, 0.24 * T);
      veer.push(a.x, a.y, beste.x, beste.y, eerste, uit.length / 3 - 1);
    }
  }
  return Float32Array.from(uit);
}

// Stranden als ketens van punten op de waterlijn, om de STAP eenheden, met de zeewaartse normaal. Zelfde
// strandregel als de rollers hierboven en de krabben in zee.js: zand of duin, geen klif, open zee ervoor, geen
// riviermonding. Per punt: S_DROOG (de zandstrook erachter is droog land), S_DUIN (duinen erachter) of S_DIJK (laag
// land zonder duinen: daar ligt een dijk). Vast per wereld.
function strandKetens(geo, b, tl) {
  const sd = b.sd, eig = b.eigenaar, Tw = geo.T, kol = geo.kol, rij = geo.rij, n2 = [0, 0];
  const tegel = (x, y) => clamp(Math.floor(y / Tw), 0, rij - 1) * kol + clamp(Math.floor(x / Tw), 0, kol - 1);
  const zee = (x, y) => { const px = Math.floor(x), py = Math.floor(y); if (px < 0 || py < 0 || px >= W || py >= H) return true; return eig[py * W + px] === -1; };
  const droog = (x, y) => !zee(x, y) && tl.rivierAfstand(x, y) > 0.4 && !tl.isMeer(x, y);
  const soort = (x, y, nx, ny) => {
    if (x < 10 || y < 10 || x > W - 10 || y > H - 10) return -1;
    const t = tegel(x - nx * 2.5, y - ny * 2.5), tg = geo.tegels[t];
    if (!tg || tg.terrein === 'water' || b.klif[t] || !(b.duin[t] || (tg.terrein === 'kust' && tg.hoogte < 0.5))) return -1;
    if (!zee(x + nx * 0.8, y + ny * 0.8) || sdOp(sd, x + nx * 6, y + ny * 6) < 3) return -1;
    if (tl.rivierAfstand(x - nx * 1.2, y - ny * 1.2) < 1.5 || tl.isMeer(x - nx, y - ny)) return -1;
    let f = 0;
    const op = (d) => droog(x - nx * d, y - ny * d);
    if (op(0.45) && op(1.3) && op(2.3) && sdOp(sd, x - nx * 2.3, y - ny * 2.3) < -1) f |= S_DROOG;
    if (f & S_DROOG) {
      if (b.duin[tegel(x - nx * 3.5, y - ny * 3.5)] && op(3.4) && op(4.8) && op(6.2)) f |= S_DUIN;
      else if (!b.duin[t] && tg.hoogte < 0.42 && hash(t, 701) < 0.6 && op(3.3)) f |= S_DIJK;
    }
    return f;
  };
  const q = { x: 0, y: 0, nx: 0, ny: 0 };
  // naar de waterlijn trekken (sd = 0) langs de normaal
  const proj = (x, y) => {
    for (let k = 0; k < 3; k++) { if (normaal(sd, x, y, n2) < 0.1) return false; const s = sdOp(sd, x, y); x -= n2[0] * s; y -= n2[1] * s; }
    if (normaal(sd, x, y, n2) < 0.1 || Math.abs(sdOp(sd, x, y)) > 1) return false;
    q.x = x; q.y = y; q.nx = n2[0]; q.ny = n2[1];
    return true;
  };
  const px = [], py = [], pnx = [], pny = [], pf = [], cel = new Int32Array(RW * RH).fill(-1);
  const vrijVan = (x, y, a, b2) => {
    const cx = Math.floor(x / RC), cy = Math.floor(y / RC);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gy = cy + dy;
      if (gx < 0 || gy < 0 || gx >= RW || gy >= RH) continue;
      const k = cel[gy * RW + gx];
      if (k >= 0 && k !== a && k !== b2 && Math.hypot(px[k] - x, py[k] - y) < 1.1) return false;
    }
    return true;
  };
  const zet = (f) => { const i = px.length; px.push(q.x); py.push(q.y); pnx.push(q.nx); pny.push(q.ny); pf.push(f); cel[Math.floor(q.y / RC) * RW + Math.floor(q.x / RC)] = i; return i; };
  const loop = (i0, sgn, uit) => {
    let i = i0, vorig = -1;
    while (uit.length < 400 && px.length < 14000) {
      const tx = -pny[i] * sgn, ty = pnx[i] * sgn;
      if (!proj(px[i] + tx * STAP, py[i] + ty * STAP)) break;
      const d = Math.hypot(q.x - px[i], q.y - py[i]);
      if (d < 0.7 || d > 2.6 || q.nx * pnx[i] + q.ny * pny[i] < 0.5) break;
      const f = soort(q.x, q.y, q.nx, q.ny);
      if (f < 0 || !vrijVan(q.x, q.y, i, vorig)) break;
      const j = zet(f);
      uit.push(j); vorig = i; i = j;
    }
  };
  const ketens = [];
  for (let y = 10; y < H - 10; y += 3) for (let x = 10; x < W - 10; x += 3) {
    const s = sdOp(sd, x, y);
    if (s < -1 || s > 1 || !proj(x, y)) continue;
    const f = soort(q.x, q.y, q.nx, q.ny);
    if (f < 0 || !vrijVan(q.x, q.y, -1, -1)) continue;
    const i0 = zet(f), voor = [], terug = [];
    loop(i0, 1, voor); loop(i0, -1, terug);
    if (voor.length + terug.length >= 3) ketens.push([...terug.reverse(), i0, ...voor]);
  }
  // in ketenvolgorde achter elkaar: een loper of een strook loopt gewoon van punt i naar i + 1
  let n = 0;
  for (const k of ketens) n += k.length;
  const X = new Float32Array(n), Y = new Float32Array(n), NX = new Float32Array(n), NY = new Float32Array(n), F = new Uint8Array(n);
  const ks = new Int32Array(ketens.length), kn = new Int32Array(ketens.length), kader = new Float32Array(ketens.length * 4);
  let o = 0;
  for (let k = 0; k < ketens.length; k++) {
    ks[k] = o; kn[k] = ketens[k].length;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of ketens[k]) {
      X[o] = px[i]; Y[o] = py[i]; NX[o] = pnx[i]; NY[o] = pny[i]; F[o] = pf[i];
      x0 = Math.min(x0, px[i]); x1 = Math.max(x1, px[i]); y0 = Math.min(y0, py[i]); y1 = Math.max(y1, py[i]);
      o++;
    }
    kader[k * 4] = x0 - 7; kader[k * 4 + 1] = y0 - 7; kader[k * 4 + 2] = x1 + 7; kader[k * 4 + 3] = y1 + 7;
  }
  return { x: X, y: Y, nx: NX, ny: NY, f: F, ks, kn, kader, n };
}

// Zandbanken die bij eb droogvallen: langgerekt evenwijdig aan een strand, een paar eenheden uit de kust.
function zandbankPlekken(geo, b) {
  const sd = b.sd, eig = b.eigenaar, n2 = [0, 0], kand = [];
  const zee = (x, y) => { const px = Math.floor(x), py = Math.floor(y); if (px < 0 || py < 0 || px >= W || py >= H) return true; return eig[py * W + px] === -1; };
  for (let y = 14; y < H - 14; y += 4) for (let x = 14; x < W - 14; x += 4) {
    const s = sdOp(sd, x, y);
    if (s < 2.2 || s > 4.4 || hash(x, y, 711) > 0.25 || normaal(sd, x, y, n2) < 0.1) continue;
    const nx = n2[0], ny = n2[1], tx = -ny, ty = nx, rx = 1.6 + hash(x, y, 712) * 1.2, ry = 0.42 + hash(x, y, 713) * 0.3;
    // het strand erachter (geen klif) en open zee ervoor
    const lx = x - nx * (s + 2.5), ly = y - ny * (s + 2.5), t = clamp(Math.floor(ly / geo.T), 0, geo.rij - 1) * geo.kol + clamp(Math.floor(lx / geo.T), 0, geo.kol - 1), tg = geo.tegels[t];
    if (!tg || tg.terrein === 'water' || b.klif[t] || sdOp(sd, x + nx * 5, y + ny * 5) < 4) continue;
    let ok = true;
    for (let i = 0; i < 10 && ok; i++) { const a = (i * TAU) / 10, ex = Math.cos(a) * (rx + 0.6), ey = Math.sin(a) * (ry + 0.5), qx = x + tx * ex + nx * ey, qy = y + ty * ex + ny * ey; if (!zee(qx, qy) || sdOp(sd, qx, qy) < 1.3) ok = false; }
    if (ok) kand.push({ x, y, nx, ny, rx, ry, score: hash(x, y, 714), zaad: (x * 131 + y * 17) | 0 });
  }
  kand.sort((p, q) => q.score - p.score || p.y - q.y || p.x - q.x);
  const uit = [];
  for (const k of kand) { if (uit.length >= 24) break; if (!uit.some((o) => Math.hypot(o.x - k.x, o.y - k.y) < 40)) uit.push(k); }
  return uit;
}

// Wat leven.js en natuur.js vast op het land aan de kust zetten, alleen uit de kaart (zelfde regels als daar): de
// parasols per kusttegel (strand() in leven.js), de weides met een kudde, vlieger, sneeuwpop of sleetjes (een schijf
// om het midden van de tegel) en de tegels met ooievaars of wolven (natuur.js). Daar komt geen strandinrichting.
function landBezet(geo, b, tl) {
  const T = geo.T, kol = geo.kol, rij = geo.rij, n = geo.tegels.length;
  const parS = new Int32Array(n + 1), xy = [], weiR = new Float32Array(n), mijd = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    parS[t] = xy.length / 2;
    const tg = geo.tegels[t];
    if (tg.terrein !== 'kust' && tg.terrein !== 'vlakte') continue;
    const wei = tg.eig >= 0 && hash(t, 61) < 0.6 && !(tg.terrein === 'vlakte' && hash(t, 3) < 0.45);
    if (wei) weiR[t] = (hash(t, 111) < 0.42 ? 0.4 : hash(t, 121) < 0.18 || hash(t, 131) < 0.3 || hash(t, 134) < 0.35 ? 0.31 : 0) * T;
    const nat = b.moeras[t] || tl.rivierAfstand(tg.x, tg.y) < 6.5;
    if (nat && hash(t, 421) < (b.moeras[t] ? 0.35 : 0.1)) mijd[t] = 1;
    if (hash(t, 471) <= 0.06) for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
      const k = tg.k + dk, r = tg.r + dr;
      if (k < 0 || r < 0 || k >= kol || r >= rij) continue;
      const nb = geo.tegels[r * kol + k];
      if (nb.terrein === 'bos' || nb.terrein === 'berg') mijd[t] = 1;
    }
    if (tg.terrein !== 'kust' || wei || hash(t, 175) >= 0.6) continue;
    let wx = 0, wy = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) { const k = tg.k + dk, r = tg.r + dr; if (k < 0 || r < 0 || k >= kol || r >= rij) continue; if (geo.tegels[r * kol + k].terrein === 'water') { wx += dk; wy += dr; } }
    const l = Math.hypot(wx, wy);
    if (!l) continue;
    wx /= l; wy /= l;
    for (let i = 0; i < 5; i++) {
      if (hash(t, i, 179) > 0.7) continue;
      const zij = (i - 2) * 0.13 * T, af = (0.22 + 0.08 * hash(t, i, 180)) * T;
      xy.push(tg.x + wx * af - wy * zij, tg.y + wy * af + wx * zij);
    }
  }
  parS[n] = xy.length / 2;
  return { parS, parXY: Float32Array.from(xy), weiR, mijd };
}

// ---------- de laag ----------

export class KustLaag {
  constructor() {
    this.klok = 0; // eigen klok: loopt alleen als het spel loopt (binnenvaart)
    this.state = null;
    this.geo = null;
    this.eigenaar = null;
    this.basis = null;
    this.tl = null;
    this.wereld = null;
    this.sig = '';
    this.raster = new Uint8Array(RW * RH);
    this.leeg();
    this.cache = new Map(); // sleutel → gebakken bitmap, in LRU-volgorde
    this.laatste = new Map(); // sleutel zonder maat → laatst gebakken bitmap (vervanger tijdens het zoomen)
    this.bytes = 0;
    this.gebakken = 0;
    this.bakTeller = 0;
    this.licht = new Float32Array(PLAFOND.lichten * LICHT);
    this.bundels = new Float32Array(PLAFOND.vuurtorens * 4); // x, y, hoek, lengte (scherm)
    this.mens = new Float32Array(PLAFOND.mensen * MENS);
    this.hond = new Float32Array(PLAFOND.honden * HOND);
    this.tij = 0; // getij in eenheden: + vloed (de waterlijn schuift het strand op), - eb
    this.gloed = null;
    this.bundel = null;
    this.nul();
  }

  leeg() {
    this.vuurtorens = []; this.havenhoofden = []; this.boeien = new Float32Array(0); this.pieren = []; this.jachthavens = [];
    this.kades = []; this.woonboten = []; this.aken = []; this.stuwen = []; this.dammen = []; this.windparken = [];
    this.turbines = new Float32Array(0); this.booreilanden = []; this.viskwekerijen = [];
    this.rotsen = new Float32Array(0); this.rollers = new Float32Array(0); this.plekLijst = [];
    // pakket D: strandinrichting, lopers, duinpaden, dijken, konijnen, zandbanken; havens van dichtbij
    this.dingen = new Float32Array(0); this.lopers = new Float32Array(0); this.duinpaden = []; this.dijken = []; this.schapen = new Float32Array(0);
    this.konijnen = new Float32Array(0); this.zandbanken = []; this.hengelplekken = new Float32Array(0); this.sloepen = []; this.kraantjes = [];
    this.vissershavens = []; this.veerstoepen = [];
  }

  nul() {
    this.n = { vuurtorens: 0, pieren: 0, havenhoofden: 0, jachthavens: 0, boeien: 0, rotsen: 0, zeehonden: 0, spatten: 0, rollers: 0, kades: 0, woonboten: 0, aken: 0, stuwen: 0, dammen: 0, windparken: 0, turbines: 0, booreilanden: 0, viskwekerijen: 0, lichten: 0 };
    for (const k of D_TELLERS) this.n[k] = 0;
    this.nLicht = 0; this.nBundel = 0; this.nMens = 0; this.nHond = 0;
  }

  // Na het laden van een spel (of een andere wereld): alles opnieuw afleiden.
  laad(view) {
    this.state = view.state;
    this.geo = view.geo;
    this.eigenaar = view.eigenaar;
    const vt = view.terreinLaag;
    this.basis = vt && vt.basis && vt.basis.geo === view.geo ? vt.basis : maakBasis(view.geo, view.eigenaar);
    // rivieren en meren uit de terreinlaag; zonder die laag (tests) een eigen, alleen voor het opzoeken
    this.tl = vt && vt.basis === this.basis ? vt : Object.assign(new TerreinLaag(), { basis: this.basis, geo: view.geo });
    this.wereld = wereldCache.get(this.basis) ?? null;
    if (!this.wereld) { this.wereld = analyse(view.geo, this.basis, this.tl); wereldCache.set(this.basis, this.wereld); }
    this.sig = '';
    this.leeg();
    this.cache.clear();
    this.laatste.clear();
    this.bytes = 0;
  }

  // ---------- opzoeken ----------

  isZee(x, y) {
    const e = this.eigenaar;
    if (!e) return false;
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= W || py >= H) return true;
    return e[py * W + px] === -1;
  }

  // 0 droog, 1 zee, 2 rivier, 3 meer
  waterSoort(x, y) {
    if (this.isZee(x, y)) return 1;
    const tl = this.tl;
    if (tl.rivierAfstand(x, y) < 0.1) return 2;
    return tl.isMeer(x, y) ? 3 : 0;
  }

  sd(x, y) { return sdOp(this.basis.sd, x, y); }

  tegel(x, y) { const geo = this.geo, Tw = geo.T; return clamp(Math.floor(y / Tw), 0, geo.rij - 1) * geo.kol + clamp(Math.floor(x / Tw), 0, geo.kol - 1); }

  // Botsraster: merk een schijf, of kijk of een schijf vrij is van de gegeven soorten.
  merk(x, y, r, bit) {
    const g = this.raster, rr = (r + 1.42) * (r + 1.42);
    const c0 = Math.max(0, Math.floor((x - r) / RC)), c1 = Math.min(RW - 1, Math.floor((x + r) / RC));
    const r0 = Math.max(0, Math.floor((y - r) / RC)), r1 = Math.min(RH - 1, Math.floor((y + r) / RC));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const dx = cx * RC + 1 - x, dy = cy * RC + 1 - y; if (dx * dx + dy * dy <= rr) g[cy * RW + cx] |= bit; }
  }

  vrij(x, y, r, masker) {
    const g = this.raster, rr = (r + 1.42) * (r + 1.42);
    const c0 = Math.max(0, Math.floor((x - r) / RC)), c1 = Math.min(RW - 1, Math.floor((x + r) / RC));
    const r0 = Math.max(0, Math.floor((y - r) / RC)), r1 = Math.min(RH - 1, Math.floor((y + r) / RC));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const dx = cx * RC + 1 - x, dy = cy * RC + 1 - y; if (dx * dx + dy * dy <= rr && g[cy * RW + cx] & masker) return false; }
    return true;
  }

  merkLijn(ax, ay, bx, by, r, bit) {
    const l = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(l / 1.5));
    for (let j = 0; j <= k; j++) this.merk(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k, r, bit);
  }

  aanZee(t) {
    const geo = this.geo, tg = geo.tegels[t];
    for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) { const k = tg.k + dk, r = tg.r + dr; if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue; if (geo.tegels[r * geo.kol + k].terrein === 'water') return true; }
    return false;
  }

  // Ligt (x, y) in of vlak naast een woonwijk of de hoofdstad (binnen marge tegels van het midden)?
  inStad(x, y, marge = 0.95) {
    const geo = this.geo, Tw = geo.T, k0 = Math.floor(x / Tw), r0 = Math.floor(y / Tw);
    for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
      const k = k0 + dk, r = r0 + dr;
      if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
      const t = r * geo.kol + k, s = this.soort[t];
      if ((s === STAD || s === HOOFD) && Math.max(Math.abs(geo.tegels[t].x - x), Math.abs(geo.tegels[t].y - y)) <= marge * Tw) return true;
    }
    return false;
  }

  // ---------- kiezen (alleen als de toestand iets verandert) ----------

  werkCache(view) {
    const s = this.state;
    let nP = 0, somT = 0;
    for (let i = 0; i < s.landen.length; i++) {
      const l = s.landen[i];
      nP += l.plaatsingen.length;
      for (let j = 0; j < l.plaatsingen.length; j++) somT += l.plaatsingen[j].t;
    }
    const inf = view.infraLaag;
    const sig = `${s.grensVersie}|${nP}|${somT}|${s.landen.length}|${inf ? inf.sig : '-'}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.kies(inf);
  }

  kies(inf) {
    this.leeg();
    this.bouwSoorten();
    this.raster.fill(0);
    this.merkInfra(inf);
    this.merkGebouwen(inf);
    this.merkLeven();
    this.kiesHavens(inf);
    this.kiesVuurtorens();
    this.kiesPieren();
    this.kiesJachthavens(inf);
    this.kiesStuwen();
    this.kiesDammen();
    this.kiesKades();
    this.kiesAken();
    this.kiesWindparken();
    this.kiesBooreilanden();
    this.kiesViskwekerijen();
    this.kiesRotsenRollers();
    this.kiesHengelplekken();
    this.kiesVissershavens(inf);
    this.kiesVeerstoepen();
    this.kiesStrand();
  }

  bouwSoorten() {
    const s = this.state, P = s.pack, geo = this.geo, n = geo.tegels.length, L = s.landen.length;
    if (!this.soort || this.soort.length !== n) this.soort = new Uint8Array(n);
    this.soort.fill(LEEG);
    this.energie = new Int16Array(L);
    this.kustCentrale = new Int32Array(L).fill(-1);
    this.olieTegel = new Int32Array(L).fill(-1);
    this.heeftOlie = P.gebouwen.some((g) => g.id === 'olieveld');
    for (const land of s.landen) {
      for (const p of land.plaatsingen) {
        if (p.t < 0) continue;
        const g = P.gebouwIndex[p.g], tek = g.tekening ?? ALIAS[g.id] ?? g.id;
        this.soort[p.t] = g.handel_bonus ? HAVEN : tek === 'woonwijk' ? STAD : ENERGIEBRON[tek] ? ENERGIE : OVERIG;
        if (ENERGIEBRON[tek]) {
          this.energie[land.idx]++;
          if (tek === 'centrale' && this.kustCentrale[land.idx] < 0 && this.aanZee(p.t)) this.kustCentrale[land.idx] = p.t;
        }
        if (g.id === 'olieveld' && this.olieTegel[land.idx] < 0) this.olieTegel[land.idx] = p.t;
      }
    }
    for (const land of s.landen) { const h = geo.hoofdstad[land.idx]; if (h != null && h >= 0) this.soort[h] = HOOFD; }
  }

  // Wegen, spoor, bruggen, pijpleidingen en de havens van infra.js.
  merkInfra(inf) {
    if (!inf) return;
    const Tw = this.geo.T;
    for (const w of inf.wegen ?? []) this.merkLijn(w.ax, w.ay, w.bx, w.by, 0.11 * Tw, INFRA);
    for (const r of inf.routes ?? []) for (let i = 0; i + 1 < r.n; i++) this.merkLijn(r.x[i], r.y[i], r.x[i + 1], r.y[i + 1], 0.1 * Tw, INFRA);
    const v = inf.brugVlakken ? inf.brugVlakken() : null;
    if (v) for (let i = 0; i < v.n; i++) { const o = i * 5, d = v.data; this.merkLijn(d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4] + 1, INFRA); }
    for (const p of inf.pijpen ?? []) this.merkLijn(p.ax, p.ay, p.bx, p.by, 0.06 * Tw, INFRA);
    // containerhaven: het schip aan de kade en de sleepboot erlangs (u -0,36..0,36, v dq..dq+0,26 in het havenkader)
    for (const h of inf.havens ?? []) {
      const co = Math.cos(h.hoek), si = Math.sin(h.hoek), v = h.dq + 0.13;
      this.merkLijn(h.x + (-0.42 * co - v * si) * Tw, h.y + (-0.42 * si + v * co) * Tw, h.x + (0.42 * co - v * si) * Tw, h.y + (0.42 * si + v * co) * Tw, 0.16 * Tw, INFRA);
    }
  }

  // Bebouwde en door infra.js gereserveerde vakjes: daar komt niets van deze laag.
  merkGebouwen(inf) {
    const s = this.state, geo = this.geo, Tw = geo.T, g = this.raster;
    for (let t = 0; t < geo.tegels.length; t++) {
      if (!s.bezet[t] && !(inf && inf.gereserveerd && inf.gereserveerd(t)) && this.soort[t] === LEEG) continue;
      const tg = geo.tegels[t];
      const c0 = Math.max(0, Math.floor((tg.x - Tw / 2) / RC)), c1 = Math.min(RW - 1, Math.floor((tg.x + Tw / 2 - 0.01) / RC));
      const r0 = Math.max(0, Math.floor((tg.y - Tw / 2) / RC)), r1 = Math.min(RH - 1, Math.floor((tg.y + Tw / 2 - 0.01) / RC));
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) g[cy * RW + cx] |= GEBOUW;
    }
  }

  // Het water van leven.js: de vaste schijven uit de analyse, plus de boten bij elke haven (dezelfde regel als
  // havenBoten daar: 1 tot 3 boten, aangemeerd bij de kade of rondjes varend om een watertegel ernaast).
  merkLeven() {
    const L = this.wereld.leven;
    for (let i = 0; i < L.length; i += 3) this.merk(L[i], L[i + 1], L[i + 2], LEVEN);
    const s = this.state, P = s.pack, geo = this.geo, T = geo.T;
    const ringZee = (cx, cy, r) => { for (let i = 0; i < 8; i++) if (!this.isZee(cx + Math.cos((i * TAU) / 8) * r, cy + Math.sin((i * TAU) / 8) * r)) return false; return true; };
    for (const land of s.landen) for (const p of land.plaatsingen) {
      if (p.t < 0 || !P.gebouwIndex[p.g].handel_bonus) continue;
      const h = p.t, Hh = geo.tegels[h], water = [];
      for (let d = 1; d <= 2 && !water.length; d++) for (let dr = -d; dr <= d; dr++) for (let dk = -d; dk <= d; dk++) {
        const k = Hh.k + dk, r = Hh.r + dr;
        if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
        const t = geo.tegels[r * geo.kol + k];
        if (t.terrein === 'water' && water.length < 3) water.push(t);
      }
      if (!water.length) continue;
      const aantal = 1 + Math.floor(hash(h, 1) * 3);
      for (let j = 0; j < aantal; j++) {
        const w = water[j % water.length], dx = Hh.x - w.x, dy = Hh.y - w.y, d = Math.hypot(dx, dy) || 1;
        if (hash(h, j, 2) < 0.5) {
          const zij = ((j % 3) - 1) * 0.18 * T;
          let x = 0, y = 0;
          for (let f = 0.3; f >= 0; f -= 0.05) { x = w.x + (dx / d) * f * T - (dy / d) * zij; y = w.y + (dy / d) * f * T + (dx / d) * zij; if (this.isZee(x, y)) break; }
          this.merk(x, y, 0.16 * T, LEVEN);
        } else {
          let r = 0.3;
          while (r > 0.12 && !ringZee(w.x, w.y, r * T)) r -= 0.06;
          this.merk(w.x, w.y, (r + 0.14) * T, LEVEN);
        }
      }
    }
  }

  plek(soort, x, y) { this.plekLijst.push({ soort, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }); }

  // Havenhoofden bij elke containerhaven van infra.js, met boeien langs de geul naar open water.
  kiesHavens(inf) {
    const Tw = this.geo.T, uit = [], boei = [];
    for (const h of inf?.havens ?? []) {
      if (uit.length >= 2 * PLAFOND.havenhoofden) break;
      const co = Math.cos(h.hoek), si = Math.sin(h.hoek), dq = h.dq;
      const X = (u, v) => h.x + (u * co - v * si) * Tw, Y = (u, v) => h.y + (u * si + v * co) * Tw;
      const armen = [];
      for (const kant of [-1, 1]) {
        // vormen van lang en gebogen (de monding ligt voor de kade) tot kort en recht; de eerste die past, telt
        for (const vorm of HAVENARM) {
          const pts = [];
          let begonnen = false, droog = 0, lengte = 0;
          stuk: for (let k = 0; k + 1 < vorm.length; k++) {
            const u0 = vorm[k][0] * kant, v0 = dq + vorm[k][1], u1 = vorm[k + 1][0] * kant, v1 = dq + vorm[k + 1][1];
            const l = Math.hypot(u1 - u0, v1 - v0), m = Math.ceil(l / 0.04);
            for (let j = k ? 1 : 0; j <= m; j++) {
              const u = u0 + ((u1 - u0) * j) / m, v = v0 + ((v1 - v0) * j) / m, x = X(u, v), y = Y(u, v);
              const nat = this.sd(x, y) > 0.45;
              if (!begonnen) { if (!nat) { droog += l / m; if (droog > 0.4) break stuk; continue; } begonnen = true; }
              if (!nat || !this.vrij(x, y, 0.035 * Tw, LEVEN | INFRA | KUST)) break stuk;
              if (pts.length) lengte += Math.hypot(x - pts[pts.length - 2], y - pts[pts.length - 1]);
              pts.push(x, y);
            }
          }
          if (begonnen && lengte >= 0.38 * Tw) { armen.push({ pts: Float32Array.from(pts), kant, zaad: (h.t * 31 + kant + 7) | 0, x0: 0, y0: 0, x1: 0, y1: 0 }); break; }
        }
      }
      for (const a of armen) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < a.pts.length; i += 2) { x0 = Math.min(x0, a.pts[i]); x1 = Math.max(x1, a.pts[i]); y0 = Math.min(y0, a.pts[i + 1]); y1 = Math.max(y1, a.pts[i + 1]); this.merk(a.pts[i], a.pts[i + 1], 0.05 * Tw, KUST); }
        Object.assign(a, { x0, y0, x1, y1 });
        uit.push(a);
        this.plek('havenhoofd', a.pts[a.pts.length - 2], a.pts[a.pts.length - 1]);
      }
      // de geul: van de monding naar buiten, telkens naar het diepste water
      if (boei.length >= 4 * 40) continue;
      for (const v0 of [1.3, 1.65, 2.0]) {
        let x = X(0.08, dq + v0), y = Y(0.08, dq + v0), hx = -si, hy = co;
        const paar = [];
        for (let k = 0; k < 6; k++) {
          let bh = hx, bv = hy, bs = -Infinity;
          for (const da of [-0.5, -0.25, 0, 0.25, 0.5]) {
            const c = Math.cos(da), s = Math.sin(da), ex = hx * c - hy * s, ey = hx * s + hy * c;
            const sc = this.sd(x + ex * 0.32 * Tw, y + ey * 0.32 * Tw) + (da === 0 ? 1 : 0);
            if (sc > bs) { bs = sc; bh = ex; bv = ey; }
          }
          hx = bh; hy = bv;
          const px = -hy * 0.12 * Tw, py = hx * 0.12 * Tw;
          const ok = (bx, by) => this.sd(bx, by) > 0.9 && this.vrij(bx, by, 0.03 * Tw, LEVEN | INFRA | KUST);
          if (!ok(x + px, y + py) || !ok(x - px, y - py)) break;
          paar.push(x + px, y + py, 0, x - px, y - py, 1);
          x += hx * 0.3 * Tw; y += hy * 0.3 * Tw;
        }
        if (paar.length >= 12) {
          for (let i = 0; i < paar.length; i += 3) { boei.push(paar[i], paar[i + 1], paar[i + 2], (h.t * 13 + i) | 0); this.merk(paar[i], paar[i + 1], 0.05 * Tw, KUST); }
          this.plek('boeien', paar[0], paar[1]);
          break;
        }
      }
    }
    this.havenhoofden = uit;
    this.boeien = Float32Array.from(boei);
  }

  kiesVuurtorens() {
    const Tw = this.geo.T, uit = [];
    for (const k of this.wereld.kapen) {
      if (uit.length >= PLAFOND.vuurtorens) break;
      if (uit.some((o) => Math.hypot(o.x - k.x, o.y - k.y) < 4 * Tw)) continue;
      const hx = k.x - k.nx * 0.14 * Tw, hy = k.y - k.ny * 0.14 * Tw;
      if (!this.vrij(k.x, k.y, 0.12 * Tw, INFRA | GEBOUW | KUST) || !this.vrij(hx, hy, 0.08 * Tw, INFRA | GEBOUW | KUST) || this.sd(hx, hy) > -0.5 || this.waterSoort(hx, hy) || this.waterSoort(k.x, k.y)) continue;
      // de bitmapsleutel beschrijft de vuurtoren zelf (plek), niet zijn volgnummer: na opnieuw kiezen schuiven de nummers
      uit.push({ x: k.x, y: k.y, nx: k.nx, ny: k.ny, zaad: (k.t * 53 + k.x) | 0, id: uit.length, sleutel: `vt${k.x}_${k.y}` });
      this.merk(k.x, k.y, 0.2 * Tw, KUST);
      this.plek('vuurtoren', k.x, k.y);
    }
    this.vuurtorens = uit;
  }

  // Pieren bij badplaatsen: een stadje aan een zandkust, de pier recht de zee in met een paviljoen op de kop.
  kiesPieren() {
    const geo = this.geo, Tw = geo.T, uit = [], n2 = [0, 0];
    for (let t = 0; t < geo.tegels.length && uit.length < PLAFOND.pieren; t++) {
      if (this.soort[t] !== STAD && this.soort[t] !== HOOFD) continue;
      const tg = geo.tegels[t];
      if (this.sd(tg.x, tg.y) < -2.8 * Tw || uit.some((o) => Math.hypot(o.x - tg.x, o.y - tg.y) < 3 * Tw)) continue;
      // de voet van de pier: een strandpunt binnen een paar tegels van de wijk, het dichtstbij eerst; past een lange
      // pier nergens, dan een kortere
      const kand = this.kustPunten(tg.x, tg.y, 2.6 * Tw, -1.6, -0.3);
      let gevonden = null;
      for (const L of [0.78, 0.6, 0.46]) for (let j = 0; j < kand.length && j < 3 * 80 && !gevonden; j += 3) {
        const x = kand[j], y = kand[j + 1], u = this.tegel(x, y);
        if (this.basis.klif[u] || geo.tegels[u].terrein === 'berg' || normaal(this.basis.sd, x, y, n2) < 0.1) continue;
        const p = this.pierOp(x, y, n2[0], n2[1], L);
        if (p && !uit.some((o) => Math.hypot(o.x - x, o.y - y) < 3 * Tw)) gevonden = p;
      }
      if (!gevonden) continue;
      const p = gevonden;
      p.zaad = (t * 41 + 3) | 0;
      uit.push(p);
      for (let v = 0; v <= p.L; v += 0.05) this.merk(p.x + p.nx * v * Tw, p.y + p.ny * v * Tw, 0.06 * Tw, KUST);
      this.merk(p.x + p.nx * p.L * Tw, p.y + p.ny * p.L * Tw, 0.14 * Tw, KUST);
      this.plek('pier', p.x + p.nx * p.L * Tw, p.y + p.ny * p.L * Tw);
    }
    this.pieren = uit;
  }

  // Punten (x, y, afstand) op een raster van 2 eenheden binnen r van (cx, cy) met sd tussen lo en hi, dichtstbij eerst.
  kustPunten(cx, cy, r, lo, hi) {
    const kand = [];
    for (let y = Math.floor(cy - r) | 1; y <= cy + r; y += 2) for (let x = Math.floor(cx - r) | 1; x <= cx + r; x += 2) {
      if (x < 6 || y < 6 || x > W - 6 || y > H - 6) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      const s = this.sd(x, y);
      if (s >= lo && s <= hi) kand.push(x, y, d);
    }
    const n = kand.length / 3, volgorde = new Array(n);
    for (let i = 0; i < n; i++) volgorde[i] = i;
    volgorde.sort((a, b) => kand[a * 3 + 2] - kand[b * 3 + 2] || a - b);
    const uit = new Array(kand.length);
    for (let i = 0; i < n; i++) { uit[i * 3] = kand[volgorde[i] * 3]; uit[i * 3 + 1] = kand[volgorde[i] * 3 + 1]; uit[i * 3 + 2] = kand[volgorde[i] * 3 + 2]; }
    return uit;
  }

  pierOp(x, y, nx, ny, L) {
    const Tw = this.geo.T, tx = -ny, ty = nx;
    let nat = false;
    for (let v = 0.04; v <= L; v += 0.04) {
      const px = x + nx * v * Tw, py = y + ny * v * Tw, s = this.sd(px, py);
      if (!nat) { if (s > 0.3) nat = true; else if (v > 0.16) return null; else continue; }
      if (s < 0.35 || !this.vrij(px, py, 0.04 * Tw, LEVEN | INFRA | KUST)) return null;
    }
    for (const u of [-0.13, 0.13]) {
      const px = x + nx * L * Tw + tx * u * Tw, py = y + ny * L * Tw + ty * u * Tw;
      if (this.sd(px, py) < 0.35 || !this.vrij(px, py, 0.03 * Tw, LEVEN | INFRA | KUST)) return null;
    }
    if (!this.vrij(x, y, 0.05 * Tw, INFRA | GEBOUW) || !this.droog(x, y) || !this.droog(x - nx * 0.6, y - ny * 0.6)) return null;
    return { x, y, nx, ny, L, zaad: 0, x0: Math.min(x, x + nx * L * Tw) - 0.15 * Tw, y0: Math.min(y, y + ny * L * Tw) - 0.15 * Tw, x1: Math.max(x, x + nx * L * Tw) + 0.15 * Tw, y1: Math.max(y, y + ny * L * Tw) + 0.15 * Tw };
  }

  kiesJachthavens(inf) {
    const geo = this.geo, Tw = geo.T, uit = [], n2 = [0, 0], havens = inf?.havens ?? [];
    for (let t = 0; t < geo.tegels.length && uit.length < PLAFOND.jachthavens; t++) {
      if (this.soort[t] !== STAD && this.soort[t] !== HOOFD) continue;
      const tg = geo.tegels[t];
      if (this.sd(tg.x, tg.y) < -2.8 * Tw || uit.some((o) => Math.hypot(o.ax - tg.x, o.ay - tg.y) < 3 * Tw)) continue;
      const kand = this.kustPunten(tg.x, tg.y, 2.6 * Tw, -0.6, 0.6);
      let klaar = false;
      // eerst een volle jachthaven (steiger 0,46 tegel), anders een kleine (0,34)
      for (const lang of [0.46, 0.34]) for (let j = 0; j * 3 < kand.length && j < 120 && !klaar; j++) {
        const x = kand[j * 3], y = kand[j * 3 + 1], f = lang / 0.46;
        if (normaal(this.basis.sd, x, y, n2) < 0.1) continue;
        if (havens.some((h) => Math.hypot(h.x - x, h.y - y) < 1.4 * Tw)) continue;
        const nx = n2[0], ny = n2[1], tx = -ny, ty = nx;
        let ok = true;
        for (const u of [-0.36, -0.18, 0, 0.18, 0.3]) for (const v of [0.06, 0.18, 0.3, 0.42, 0.53]) {
          if (!ok) break;
          const px = x + (tx * u * f + nx * v * f) * Tw, py = y + (ty * u * f + ny * v * f) * Tw;
          if (this.sd(px, py) < 0.5 || !this.vrij(px, py, 0.05 * Tw, LEVEN | INFRA | KUST)) ok = false;
        }
        if (!ok) continue;
        const cx = x + (tx * 0.2 - nx * 0.1) * Tw, cy = y + (ty * 0.2 - ny * 0.1) * Tw;
        const club = this.sd(cx, cy) < -0.6 && !this.waterSoort(cx, cy) && this.vrij(cx, cy, 0.06 * Tw, INFRA | GEBOUW | KUST);
        const zaad = (t * 71 + j) | 0;
        uit.push({ ax: x, ay: y, nx, ny, lang, club, zaad, id: uit.length, sleutel: `jh${x}_${y}_${lang}_${club ? 1 : 0}_${zaad}`, masten: null, x0: x - 0.7 * Tw, y0: y - 0.8 * Tw, x1: x + 0.7 * Tw, y1: y + 0.7 * Tw });
        for (const u of [-0.36, -0.18, 0, 0.18, 0.3]) for (const v of [0.06, 0.18, 0.3, 0.42, 0.53]) this.merk(x + (tx * u * f + nx * v * f) * Tw, y + (ty * u * f + ny * v * f) * Tw, 0.1 * Tw, KUST);
        if (club) this.merk(cx, cy, 0.08 * Tw, KUST);
        this.plek('jachthaven', x + nx * 0.25 * Tw, y + ny * 0.25 * Tw);
        klaar = true;
      }
    }
    this.jachthavens = uit;
  }

  // Richting en normaal van rivier ri bij punt i: this.fx, this.fy (stroomafwaarts) en de halve breedte this.hw.
  rivierRichting(rv, i) {
    const p = rv.pts, m = rv.br.length, a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
    const dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1], l = Math.hypot(dx, dy) || 1;
    this.fx = dx / l; this.fy = dy / l; this.hw = (rv.br[i] + 0.3) / 2;
  }

  // Is het naast de rivier droog land (geen zee, geen meer, geen andere rivier)?
  droog(x, y) { return !this.isZee(x, y) && this.tl.rivierAfstand(x, y) > 0.2 && !this.tl.isMeer(x, y); }

  // Stuw met sluis: één per lange brede rivier, buiten de stad en weg van wegen en bruggen.
  kiesStuwen() {
    const R = this.tl.rivieren, Tw = this.geo.T, uit = [], gehad = new Set();
    for (const run of this.wereld.aakRuns) {
      if (uit.length >= PLAFOND.stuwen) break;
      const rv = R[run.ri];
      if (gehad.has(run.ri) || rv.s[run.e] - rv.s[run.a] < 60) continue;
      const midden = (rv.s[run.a] + rv.s[run.e]) / 2;
      let im = run.a;
      while (im < run.e && rv.s[im] < midden) im++;
      for (let k = 0; k < 16; k++) {
        const i = im + (k & 1 ? -1 : 1) * (k >> 1) * 2;
        if (i <= run.a + 3 || i >= run.e - 3) continue;
        const x = rv.pts[i * 2], y = rv.pts[i * 2 + 1];
        this.rivierRichting(rv, i);
        const nx = -this.fy, ny = this.fx, hw = this.hw;
        if (this.inStad(x, y, 1.6) || !this.vrij(x, y, hw + 2, INFRA | KUST | GEBOUW)) continue;
        if (!this.droog(x + nx * (hw + 0.8), y + ny * (hw + 0.8)) || !this.droog(x - nx * (hw + 0.8), y - ny * (hw + 0.8))) continue;
        uit.push({ ri: run.ri, i, x, y, fx: this.fx, fy: this.fy, hw, s: rv.s[i], zaad: (run.ri * 97 + i) | 0, sluis: hash(run.ri, i, 5) < 0.5 ? 1 : -1 });
        gehad.add(run.ri);
        this.merk(x, y, hw + 1.5, KUST);
        this.plek('stuw', x, y);
        break;
      }
    }
    this.stuwen = uit;
  }

  // Stuwdam met stuwmeer op een bergrivier: het meer volgt het dal stroomopwaarts en wordt naar de dam toe breder.
  kiesDammen() {
    const R = this.tl.rivieren, Tw = this.geo.T, uit = [];
    for (const kd of this.wereld.dammen) {
      if (uit.length >= PLAFOND.dammen) break;
      const rv = R[kd.ri], p = rv.pts, i = kd.i, x = p[i * 2], y = p[i * 2 + 1];
      if (uit.some((o) => Math.hypot(o.x - x, o.y - y) < 8 * Tw)) continue;
      if (this.wereld.aakRuns.some((r) => r.ri === kd.ri && rv.s[r.e] > rv.s[i] - 16 && rv.s[r.a] < rv.s[i] + 2)) continue;
      this.rivierRichting(rv, i);
      const fx = this.fx, fy = this.fy, nx = -fy, ny = fx, Wd = clamp(2.6 + rv.br[i], 3, 4.5);
      // oevers van het meer: van de dam stroomopwaarts, 14 eenheden lang
      const links = [], rechts = [], as = [];
      let j = i, ok = true;
      const s0 = rv.s[i];
      while (j > 0 && s0 - rv.s[j] < 14 && ok) {
        const t = (s0 - rv.s[j]) / 14, px = p[j * 2], py = p[j * 2 + 1];
        this.rivierRichting(rv, j);
        const mx = -this.fy, my = this.fx, w = (rv.br[j] / 2 + 0.4) + (Wd - rv.br[j] / 2 - 0.4) * Math.pow(1 - t, 0.7);
        for (const f of [1, 0.5, 0, -0.5, -1]) {
          const qx = px + mx * w * f, qy = py + my * w * f;
          if (this.isZee(qx, qy) || this.tl.isMeer(qx, qy) || this.sd(qx, qy) > -1 || !this.vrij(qx, qy, 1, INFRA | GEBOUW | KUST)) { ok = false; break; }
        }
        links.push(px + mx * w, py + my * w); rechts.push(px - mx * w, py - my * w); as.push(px, py);
        j--;
      }
      if (!ok || links.length < 6) continue;
      // damboog: van wal tot wal, bolling stroomopwaarts; de centrale stroomafwaarts
      const ax = x + nx * (Wd + 0.5), ay = y + ny * (Wd + 0.5), bx = x - nx * (Wd + 0.5), by = y - ny * (Wd + 0.5);
      const kx = x - fx * 1.4, ky = y - fy * 1.4, cx = x + fx * 1.4 + nx * 1.2, cy = y + fy * 1.4 + ny * 1.2;
      if (!this.droog(ax + nx * 0.4, ay + ny * 0.4) || !this.droog(bx - nx * 0.4, by - ny * 0.4) || !this.droog(cx, cy) || !this.vrij(cx, cy, 1, INFRA | GEBOUW | KUST)) continue;
      const meer = [];
      for (let k = 0; k < links.length; k += 2) meer.push(links[k], links[k + 1]);
      for (let k = rechts.length - 2; k >= 0; k -= 2) meer.push(rechts[k], rechts[k + 1]);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < meer.length; k += 2) { x0 = Math.min(x0, meer[k]); x1 = Math.max(x1, meer[k]); y0 = Math.min(y0, meer[k + 1]); y1 = Math.max(y1, meer[k + 1]); }
      for (const v of [ax, bx, cx]) { x0 = Math.min(x0, v); x1 = Math.max(x1, v); }
      for (const v of [ay, by, cy]) { y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
      x0 -= 2; y0 -= 2; x1 += 2; y1 += 2;
      const d = { x, y, ri: kd.ri, i, meer: Float32Array.from(meer), as: Float32Array.from(as), dam: [ax, ay, kx, ky, bx, by], centrale: [cx, cy], voorzicht: fy > 0.1, fx, fy, nx, ny, Wd, mx: (x0 + x1) / 2, my: (y0 + y1) / 2, bw: (x1 - x0) / Tw, bh: (y1 - y0) / Tw, x0, y0, x1, y1, Tw, zaad: (kd.ri * 131 + i) | 0, id: uit.length, sleutel: `dam${kd.ri}_${i}` };
      uit.push(d);
      for (let k = 0; k < meer.length; k += 2) this.merk(meer[k], meer[k + 1], 1.5, KUST);
      for (let k = 0; k < as.length; k += 2) this.merk(as[k], as[k + 1], Wd, KUST);
      this.plek('stuwdam', x, y);
    }
    this.dammen = uit;
  }

  // Kademuren waar een rivier door de stad loopt, met woonboten langs de kant.
  kiesKades() {
    const R = this.tl.rivieren, Tw = this.geo.T, kades = [], boten = [];
    for (let ri = 0; ri < R.length && kades.length < 60; ri++) {
      const rv = R[ri], p = rv.pts, m = rv.br.length;
      if (!rv.open) continue;
      let a = -1;
      for (let i = 0; i <= m; i++) {
        const ok = i < m && rv.open[i] && rv.br[i] >= 1.1 && this.inStad(p[i * 2], p[i * 2 + 1]);
        if (ok && a < 0) a = i;
        if (!ok && a >= 0) { if (i - a >= 4) this.maakKade(ri, a, i - 1, kades, boten); a = -1; }
      }
    }
    this.kades = kades;
    this.woonboten = boten;
    if (kades.length) this.plek('kade', kades[0].pts[0], kades[0].pts[1]);
    if (boten.length) this.plek('woonboot', boten[0].x, boten[0].y);
  }

  maakKade(ri, a, e, kades, boten) {
    const rv = this.tl.rivieren[ri], p = rv.pts, Tw = this.geo.T;
    for (const kant of [-1, 1]) {
      let pts = [], sinds = 99;
      const sluit = () => {
        if (pts.length >= 12 && kades.length < 60) {
          const d = Float32Array.from(pts);
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let k = 0; k < d.length; k += 4) { x0 = Math.min(x0, d[k]); x1 = Math.max(x1, d[k]); y0 = Math.min(y0, d[k + 1]); y1 = Math.max(y1, d[k + 1]); }
          kades.push({ pts: d, x0, y0, x1, y1, zaad: (ri * 211 + a * 3 + kant) | 0 });
        }
        pts = [];
      };
      for (let i = a; i <= e; i++) {
        this.rivierRichting(rv, i);
        const x = p[i * 2], y = p[i * 2 + 1], nx = -this.fy * kant, ny = this.fx * kant, hw = this.hw;
        const bx = x + nx * (hw + 0.1), by = y + ny * (hw + 0.1);
        if (!this.droog(x + nx * (hw + 0.6), y + ny * (hw + 0.6)) || !this.vrij(bx, by, 0.6, INFRA | KUST)) { sluit(); continue; }
        // uitwaartse normaal (van de kade het water in): -n
        pts.push(bx, by, -nx, -ny);
        sinds += i > a ? rv.s[i] - rv.s[i - 1] : 0;
        if (rv.br[i] >= 1.6 && sinds >= 2.6 && hash(ri, i * 2 + (kant > 0 ? 1 : 0), 77) < 0.45 && boten.length < 60) {
          const cx = x + nx * (hw - 0.45), cy = y + ny * (hw - 0.45);
          if (this.tl.rivierAfstand(cx + this.fx * 0.8, cy + this.fy * 0.8) < -0.2 && this.tl.rivierAfstand(cx - this.fx * 0.8, cy - this.fy * 0.8) < -0.2 && this.vrij(cx, cy, 1, INFRA | KUST)) {
            boten.push({ x: cx, y: cy, fx: this.fx, fy: this.fy, zaad: (ri * 389 + i * 2 + kant) | 0 });
            this.merk(cx, cy, 0.9, KUST);
            sinds = 0;
          }
        }
      }
      sluit();
    }
    void Tw;
  }

  // Binnenvaart: lange brede stukken rivier, gesplitst bij een stuw; één of twee schepen per stuk.
  kiesAken() {
    const R = this.tl.rivieren, uit = [];
    for (const run of this.wereld.aakRuns) {
      const rv = R[run.ri];
      let grenzen = [rv.s[run.a], rv.s[run.e]];
      for (const st of this.stuwen) if (st.ri === run.ri && st.s > grenzen[0] && st.s < grenzen[grenzen.length - 1]) grenzen = [grenzen[0], st.s - 4, st.s + 4, grenzen[grenzen.length - 1]];
      for (let k = 0; k + 1 < grenzen.length; k += 2) {
        const sa = grenzen[k], se = grenzen[k + 1], L = se - sa;
        if (L < 40) continue;
        const aantal = L > 150 ? 2 : 1;
        for (let j = 0; j < aantal && uit.length < 16; j++) {
          const zaad = (run.ri * 61 + Math.floor(sa) * 7 + j) | 0;
          uit.push({ ri: run.ri, a: run.a, e: run.e, sa, se, zaad, j, v: 0.45 + 0.25 * hash(zaad, 1), fase: hash(zaad, 2) + j * 0.5, romp: ROMPEN[Math.floor(hash(zaad, 3) * ROMPEN.length)], lading: LADING[Math.floor(hash(zaad, 4) * LADING.length)] });
        }
        const mi = Math.floor((run.a + run.e) / 2);
        this.plek('binnenvaart', rv.pts[mi * 2], rv.pts[mi * 2 + 1]);
      }
    }
    this.aken = uit;
  }

  // Zoek het dichtstbijzijnde stuk open zee (binnen r tegels van een punt) waar een opstelling past; pas(x, y, nx, ny)
  // geeft true als hij daar past.
  zoekZee(ax, ay, rMin, rMax, sdMin, pas) {
    const Tw = this.geo.T, kand = [], n2 = [0, 0];
    for (let dy = -rMax; dy <= rMax; dy += 0.5) for (let dx = -rMax; dx <= rMax; dx += 0.5) {
      const d = Math.hypot(dx, dy);
      if (d < rMin || d > rMax) continue;
      const x = ax + dx * Tw, y = ay + dy * Tw;
      if (x < 26 || y < 26 || x > W - 26 || y > H - 26 || this.sd(x, y) < sdMin) continue; // niet tegen de kaartrand
      kand.push(x, y, d);
    }
    const volgorde = [];
    for (let i = 0; i < kand.length; i += 3) volgorde.push(i);
    volgorde.sort((a, b) => kand[a + 2] - kand[b + 2] || a - b);
    for (let j = 0; j < volgorde.length && j < 80; j++) {
      const x = kand[volgorde[j]], y = kand[volgorde[j] + 1];
      normaal(this.basis.sd, x, y, n2);
      if (pas(x, y, n2[0], n2[1])) return true;
    }
    return false;
  }

  // Windparken op zee voor landen met veel energie of een centrale aan de kust: 3 rijen van 4 turbines.
  kiesWindparken() {
    const s = this.state, geo = this.geo, Tw = geo.T, parken = [], tb = [];
    for (const land of s.landen) {
      if (parken.length >= PLAFOND.windparken) break;
      const kc = this.kustCentrale[land.idx];
      if (this.energie[land.idx] < 4 && kc < 0) continue;
      const anker = kc >= 0 ? kc : geo.hoofdstad[land.idx];
      if (anker == null || anker < 0) continue;
      const at = geo.tegels[anker];
      this.zoekZee(at.x, at.y, 1.5, 7, 3.5, (x, y, nx, ny) => {
        const tx = -ny, ty = nx, pos = [];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
          const px = x + (tx * (j - 1.5) + nx * (i - 1)) * 0.42 * Tw, py = y + (ty * (j - 1.5) + ny * (i - 1)) * 0.42 * Tw;
          if (px < 10 || py < 10 || px > W - 10 || py > H - 10 || this.sd(px, py) < 2.5 || !this.vrij(px, py, 0.2 * Tw, LEVEN | INFRA | KUST)) return false;
          pos.push(px, py);
        }
        const id = parken.length;
        for (let k = 0; k < pos.length; k += 2) { tb.push(pos[k], pos[k + 1], hash(land.idx, k, 17), id); this.merk(pos[k], pos[k + 1], 0.3 * Tw, KUST); }
        parken.push({ x, y, land: land.idx, x0: x - 1.2 * Tw, y0: y - 1.3 * Tw, x1: x + 1.2 * Tw, y1: y + 1 * Tw });
        this.plek('windpark', x, y);
        return true;
      });
    }
    this.windparken = parken;
    this.turbines = Float32Array.from(tb);
  }

  // Booreilanden voor landen met een olieveld (in packs zonder olievelden: landen met veel centrales).
  kiesBooreilanden() {
    const s = this.state, geo = this.geo, Tw = geo.T, uit = [];
    for (const land of s.landen) {
      if (uit.length >= PLAFOND.booreilanden) break;
      let anker = this.olieTegel[land.idx];
      if (anker < 0 && !this.heeftOlie && this.energie[land.idx] >= 5) anker = geo.hoofdstad[land.idx];
      if (anker == null || anker < 0) continue;
      const at = geo.tegels[anker];
      this.zoekZee(at.x, at.y, 2, 7, 4.5, (x, y) => {
        if (!this.vrij(x, y, 0.42 * Tw, LEVEN | INFRA | KUST) || uit.some((o) => Math.hypot(o.x - x, o.y - y) < 3 * Tw)) return false;
        uit.push({ x, y, zaad: (land.idx * 7 + 11) | 0, id: uit.length, sleutel: `bo${(land.idx * 7 + 11) | 0}`, x0:x - 0.4 * Tw, y0: y - 0.5 * Tw, x1: x + 0.5 * Tw, y1: y + 0.4 * Tw });
        this.merk(x, y, 0.5 * Tw, KUST);
        this.plek('booreiland', x, y);
        return true;
      });
    }
    this.booreilanden = uit;
  }

  kiesViskwekerijen() {
    const Tw = this.geo.T, uit = [];
    for (const b of this.wereld.baaien) {
      if (uit.length >= PLAFOND.viskwekerijen) break;
      if (uit.some((o) => Math.hypot(o.x - b.x, o.y - b.y) < 3 * Tw)) continue;
      // een vrije plek in de baai: rond het baaipunt zoeken, het dichtstbij eerst
      const kand = this.kustPunten(b.x, b.y, 1.2 * Tw, 2.6, 12);
      for (let j = 0; j * 3 < kand.length && j < 60; j++) {
        const x = kand[j * 3], y = kand[j * 3 + 1];
        if (!this.vrij(x, y, 0.4 * Tw, LEVEN | INFRA | KUST | GEBOUW)) continue;
        let nat = true;
        for (let i = 0; i < 12 && nat; i++) { const a = (i * TAU) / 12; if (this.sd(x + Math.cos(a) * 0.42 * Tw, y + Math.sin(a) * 0.42 * Tw) < 0.8) nat = false; }
        if (!nat) continue;
        const zaad = (b.t * 17 + 5) | 0;
        uit.push({ x, y, zaad, hoek: hash(zaad, 1) * Math.PI, rijen: hash(zaad, 2) < 0.5 ? 2 : 1, kolommen: 2 + Math.floor(hash(zaad, 3) * 2), id: uit.length, sleutel: `vk${zaad}`, x0: x - 0.45 * Tw, y0: y - 0.45 * Tw, x1: x + 0.45 * Tw, y1: y + 0.45 * Tw });
        this.merk(x, y, 0.45 * Tw, KUST);
        this.plek('viskwekerij', x, y);
        break;
      }
    }
    this.viskwekerijen = uit;
  }

  // Rotsen en rollers waar niets anders ligt of vaart.
  kiesRotsenRollers() {
    const A = this.wereld, rots = [], rol = [];
    for (let i = 0; i < A.rotsen.length; i += 6) if (this.vrij(A.rotsen[i], A.rotsen[i + 1], A.rotsen[i + 2], INFRA | KUST | LEVEN)) for (let k = 0; k < 6; k++) rots.push(A.rotsen[i + k]);
    for (let i = 0; i < A.rollers.length; i += 6) if (this.vrij(A.rollers[i], A.rollers[i + 1], 2.5, INFRA | KUST)) for (let k = 0; k < 6; k++) rol.push(A.rollers[i + k]);
    this.rotsen = Float32Array.from(rots);
    this.rollers = Float32Array.from(rol);
    if (rots.length) this.plek('rotskust', rots[0], rots[1]);
    if (rol.length) this.plek('strand', rol[0], rol[1]);
  }

  // ---------- pakket D: kiezen voor strand, duinen, dijken en havens ----------

  // Mag hier op het land iets van het strand staan? Droog land, vrij van wegen, gebouwen en de rest van deze laag, en
  // niet op de parasols, kuddes, vliegers en sneeuwpoppen van leven.js of de ooievaars en wolven van natuur.js.
  landVrij(x, y, r) {
    if (!this.droog(x, y) || this.sd(x, y) > -0.15 || !this.vrij(x, y, r, INFRA | GEBOUW | KUST)) return false;
    const L = this.wereld.land, geo = this.geo, Tw = geo.T, k0 = Math.floor(x / Tw), r0 = Math.floor(y / Tw);
    for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
      const k = k0 + dk, rr = r0 + dr;
      if (k < 0 || rr < 0 || k >= geo.kol || rr >= geo.rij) continue;
      const t = rr * geo.kol + k, tg = geo.tegels[t];
      if (L.weiR[t] && Math.hypot(tg.x - x, tg.y - y) < L.weiR[t] + r) return false;
      for (let j = L.parS[t]; j < L.parS[t + 1]; j++) if (Math.hypot(L.parXY[j * 2] - x, L.parXY[j * 2 + 1] - y) < 1.25 + r) return false;
    }
    return !L.mijd[this.tegel(x, y)];
  }

  // Ligt er binnen 5 eenheden land van een ander land? Daar tekent grens.js zijn palen en posten.
  grensBij(x, y) {
    const e = this.eigenaar, eig = e[clamp(y | 0, 0, H - 1) * W + clamp(x | 0, 0, W - 1)];
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12, r = i & 1 ? 5 : 2.5, px = clamp((x + Math.cos(a) * r) | 0, 0, W - 1), py = clamp((y + Math.sin(a) * r) | 0, 0, H - 1), v = e[py * W + px];
      if (v !== -1 && v !== eig) return true;
    }
    return false;
  }

  // Hoe druk het strand is: 3 vlak bij een woonwijk of de hoofdstad, 2 binnen drie tegels, 1 bewoond land, 0 wild.
  drukBij(x, y) {
    const geo = this.geo, Tw = geo.T, k0 = Math.floor(x / Tw), r0 = Math.floor(y / Tw);
    let d = 9;
    for (let dr = -3; dr <= 3; dr++) for (let dk = -3; dk <= 3; dk++) {
      const k = k0 + dk, r = r0 + dr;
      if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
      const s = this.soort[r * geo.kol + k];
      if (s === STAD || s === HOOFD) d = Math.min(d, Math.max(Math.abs(dk), Math.abs(dr)));
    }
    if (d <= 1) return 3;
    if (d <= 3) return 2;
    return this.eigenaar[clamp(y | 0, 0, H - 1) * W + clamp(x | 0, 0, W - 1)] >= 0 ? 1 : 0;
  }

  // Markeer alleen landvakjes (midden ruim achter de waterlijn): de surfers, boten en kwallen in zee.js blijven
  // gewoon in de branding, maar stad.js, hemel.js en de krabben houden het strand vrij.
  merkLand(x, y, r, bit) {
    const g = this.raster, rr = (r + 1.42) * (r + 1.42), sd = this.basis.sd;
    const c0 = Math.max(0, Math.floor((x - r) / RC)), c1 = Math.min(RW - 1, Math.floor((x + r) / RC));
    const r0 = Math.max(0, Math.floor((y - r) / RC)), r1 = Math.min(RH - 1, Math.floor((y + r) / RC));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const dx = cx * RC + 1 - x, dy = cy * RC + 1 - y;
      if (dx * dx + dy * dy <= rr && sdOp(sd, cx * RC + 1, cy * RC + 1) < -0.9) g[cy * RW + cx] |= bit;
    }
  }

  // Hengelaars op de pieren en havenhoofden: x, y, kant (naar het water), zaad, soort (0 pier, 1 havenhoofd).
  kiesHengelplekken() {
    const Tw = this.geo.T, uit = [];
    for (const p of this.pieren) {
      const tx = -p.ny, ty = p.nx;
      for (let k = 0; k < 4; k++) {
        const zaad = (p.zaad * 7 + k * 13) | 0, v = (0.3 + k * 0.14) * p.L, zij = hash(zaad, 1) < 0.5 ? -1 : 1;
        if (hash(zaad, 2) > 0.7) continue;
        uit.push(p.x + (p.nx * v + tx * zij * 0.021) * Tw, p.y + (p.ny * v + ty * zij * 0.021) * Tw, tx * zij, ty * zij, zaad, 0);
      }
    }
    for (const a of this.havenhoofden) {
      const q = a.pts, m = q.length / 2;
      for (let j = 2; j + 1 < m; j += 3) {
        const zaad = (a.zaad * 11 + j * 5) | 0;
        if (hash(zaad, 3) > 0.55) continue;
        const dx = q[j * 2 + 2] - q[j * 2 - 2], dy = q[j * 2 + 3] - q[j * 2 - 1], l = Math.hypot(dx, dy) || 1, zij = hash(zaad, 4) < 0.5 ? -1 : 1;
        const hx = (-dy / l) * zij, hy = (dx / l) * zij;
        uit.push(q[j * 2] + hx * 0.012 * Tw, q[j * 2 + 1] + hy * 0.012 * Tw, hx, hy, zaad, 1);
      }
    }
    this.hengelplekken = Float32Array.from(uit.slice(0, 6 * 120));
    if (uit.length) this.plek('hengelaars', uit[0], uit[1]);
    // sloepjes langs de kades in de stad, en hier en daar een hijskraantje op de kademuur
    const sloep = [], kraan = [], winter = [];
    for (const ak of this.aken) { this.aakStand(ak, true); winter.push(this.ax, this.ay); }
    for (const kd of this.kades) {
      const p = kd.pts, m = p.length / 4;
      let laatst = -99, n = 0;
      for (let i = 1; i + 1 < m && sloep.length < 80; i++) {
        const zaad = (kd.zaad * 31 + i * 7) | 0;
        if (i - laatst < 3 || hash(zaad, 1) > 0.35) continue;
        const wx = p[i * 4 + 2], wy = p[i * 4 + 3];
        let fx = p[i * 4 + 4] - p[i * 4 - 4], fy = p[i * 4 + 5] - p[i * 4 - 3];
        const fl = Math.hypot(fx, fy) || 1;
        fx /= fl; fy /= fl;
        const x = p[i * 4] + wx * 0.62, y = p[i * 4 + 1] + wy * 0.62, tl = this.tl;
        if (tl.rivierAfstand(x + fx * 0.45, y + fy * 0.45) > -0.2 || tl.rivierAfstand(x - fx * 0.45, y - fy * 0.45) > -0.2 || tl.rivierAfstand(x, y) > -0.3 || tl.rivierAfstand(x + wx * 0.45, y + wy * 0.45) > -0.6) continue;
        if (!this.vrij(x, y, 0.35, KUST | INFRA | LEVEN)) continue;
        let vrijVanAak = true;
        for (let j = 0; j < winter.length; j += 2) if (Math.hypot(winter[j] - x, winter[j + 1] - y) < 2.4) vrijVanAak = false;
        if (!vrijVanAak) continue;
        sloep.push({ x, y, fx, fy, wx, wy, zaad });
        this.merk(x, y, 0.45, KUST);
        laatst = i; n++;
      }
      if (n && kraan.length < 30 && hash(kd.zaad, 9) < 0.6) {
        const i = Math.floor(m / 2), x = p[i * 4] - p[i * 4 + 2] * 0.12, y = p[i * 4 + 1] - p[i * 4 + 3] * 0.12;
        if (this.vrij(x, y, 0.2, INFRA | KUST)) { kraan.push({ x, y, wx: p[i * 4 + 2], wy: p[i * 4 + 3], zaad: (kd.zaad * 5 + 1) | 0 }); this.merk(x, y, 0.3, KUST); }
      }
    }
    this.sloepen = sloep;
    this.kraantjes = kraan;
    if (sloep.length) this.plek('sloepen', sloep[0].x, sloep[0].y);
  }

  // Een vissershaventje aan de kust bij een woonwijk: kademuur met bolders, een visafslag met kratten, netten die
  // op de kade geboet worden, kotters aan de trossen, een hijskraantje en meeuwen. In een eigen kader (u langs de
  // kade, v het water in), maten in eenheden.
  kiesVissershavens(inf) {
    const geo = this.geo, Tw = geo.T, uit = [], n2 = [0, 0], havens = inf?.havens ?? [];
    for (let t = 0; t < geo.tegels.length && uit.length < 6; t++) {
      if (this.soort[t] !== STAD && this.soort[t] !== HOOFD) continue;
      const tg = geo.tegels[t];
      if (this.sd(tg.x, tg.y) < -3 * Tw || uit.some((o) => Math.hypot(o.x - tg.x, o.y - tg.y) < 4 * Tw)) continue;
      const kand = this.kustPunten(tg.x, tg.y, 3 * Tw, -0.8, 0.8);
      for (let j = 0; j * 3 < kand.length && j < 300; j++) {
        const x = kand[j * 3], y = kand[j * 3 + 1];
        if (normaal(this.basis.sd, x, y, n2) < 0.1 || this.basis.klif[this.tegel(x, y)]) continue;
        if (havens.some((h) => Math.hypot(h.x - x, h.y - y) < 1.0 * Tw) || this.jachthavens.some((h) => Math.hypot(h.ax - x, h.ay - y) < 1.2 * Tw) || this.pieren.some((p) => Math.hypot(p.x - x, p.y - y) < 1.0 * Tw) || uit.some((o) => Math.hypot(o.x - x, o.y - y) < 3 * Tw)) continue;
        const nx = n2[0], ny = n2[1], tx = -ny, ty = nx, P = (u, v) => { this.vhx = x + tx * u + nx * v; this.vhy = y + ty * u + ny * v; };
        let ok = true;
        for (let u = -3.5; u <= 3.51 && ok; u += 1.75) for (const v of [0.35, 0.9, 1.6, 2.4]) {
          P(u, v);
          if (!this.isZee(this.vhx, this.vhy) || this.sd(this.vhx, this.vhy) < (v < 0.5 ? 0.02 : 0.3) || (v > 0.5 && !this.vrij(this.vhx, this.vhy, 0.2, LEVEN | INFRA | KUST))) { ok = false; break; }
        }
        for (let u = -3.2; u <= 3.21 && ok; u += 1.6) for (const v of [-0.9, -1.8, -2.7]) {
          P(u, v);
          if (!this.landVrij(this.vhx, this.vhy, 0.2) || (v > -1 && this.sd(this.vhx, this.vhy) > -0.25)) { ok = false; break; }
        }
        if (!ok) continue;
        const zaad = (t * 97 + j * 3) | 0, nk = 2 + (hash(zaad, 1) < 0.5 ? 1 : 0);
        uit.push({ x, y, nx, ny, tx, ty, zaad, nk, x0: x - 6, y0: y - 6, x1: x + 6, y1: y + 6 });
        for (let u = -3.5; u <= 3.51; u += 1.75) for (const v of [-2.6, -1.2, 0.4, 1.4]) { P(u, v); this.merk(this.vhx, this.vhy, 0.8, KUST); }
        this.plek('vissershaven', x, y);
        break;
      }
    }
    this.vissershavens = uit;
  }

  // Waar de veerboten van leven.js aanleggen: een veerstoep van de achtersteven naar de wal, met een rij wachtende
  // auto's. De boot zelf blijft van leven.js; hier alleen de stoep en de auto's die eraf en erop rijden.
  kiesVeerstoepen() {
    const F = this.wereld.veer, L = this.wereld.leven, Tw = this.geo.T, uit = [];
    for (let i = 0; i * 6 < F.length; i++) {
      const ax = F[i * 6], ay = F[i * 6 + 1], bx = F[i * 6 + 2], by = F[i * 6 + 3], e0 = F[i * 6 + 4], e1 = F[i * 6 + 5];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      for (let zij = 0; zij < 2; zij++) {
        const p = zij ? 0.92 : 0.08, bx0 = zij ? ux : -ux, by0 = zij ? uy : -uy;
        const sx = ax + (bx - ax) * p + bx0 * 0.125 * Tw, sy = ay + (by - ay) * p + by0 * 0.125 * Tw;
        // de kortste weg naar de wal in een waaier rond het verlengde van de boot; de eerste die past, telt
        const kand = [];
        for (let k = -3; k <= 3; k++) {
          const h = Math.atan2(by0, bx0) + k * 0.35, ex = Math.cos(h), ey = Math.sin(h);
          for (let w = 0; w <= 1.6 * Tw; w += 0.25) { const qx = sx + ex * w, qy = sy + ey * w; if (!this.isZee(qx, qy) && this.sd(qx, qy) < -0.5) { if (w >= 0.3) kand.push(w + Math.abs(k) * 0.8, w, ex, ey); break; } }
        }
        const volg = [];
        for (let k = 0; k < kand.length; k += 4) volg.push(k);
        volg.sort((q, r) => kand[q] - kand[r] || q - r);
        for (const k of volg) {
          const v = kand[k + 1], ex = kand[k + 2], ey = kand[k + 3];
          const Lj = v + 0.7, kx = sx + ex * Lj, ky = sy + ey * Lj;
          if (!this.droog(kx, ky) || !this.vrij(kx, ky, 0.3, INFRA | GEBOUW | KUST)) continue;
          let ok = true;
          for (let w = 0; w <= v && ok; w += 0.6) {
            const qx = sx + ex * w, qy = sy + ey * w;
            if (!this.vrij(qx, qy, 0.25, INFRA | KUST)) ok = false;
            for (let j = 0; j * 3 < L.length && ok; j++) if ((j < e0 || j > e1) && Math.hypot(L[j * 3] - qx, L[j * 3 + 1] - qy) < L[j * 3 + 2] + 0.35) ok = false;
          }
          if (!ok) continue;
          // wachtrij op de wal, zolang het droog en vrij is
          let nq = 0;
          while (nq < 3) { const qx = kx + ex * (0.6 + nq * 0.6), qy = ky + ey * (0.6 + nq * 0.6); if (!this.droog(qx, qy) || !this.vrij(qx, qy, 0.2, INFRA | GEBOUW | KUST)) break; nq++; }
          const zaad = (i * 53 + zij * 7 + 1) | 0;
          uit.push({ i, zij, sx, sy, ex, ey, L: Lj, nq, len, zaad, x0: Math.min(sx, kx) - 4, y0: Math.min(sy, ky) - 4, x1: Math.max(sx, kx) + 4, y1: Math.max(sy, ky) + 4 });
          for (let w = v; w <= Lj + nq * 0.6 + 0.3; w += 0.6) this.merk(sx + ex * w, sy + ey * w, 0.3, KUST);
          for (let w = 0; w < v; w += 0.6) this.merk(sx + ex * w, sy + ey * w, 0.35, KUST);
          this.plek('veerstoep', kx, ky);
          break;
        }
      }
    }
    this.veerstoepen = uit;
  }

  // Het strand zelf: per strandpunt of het vrij is en hoe druk; dan percelen van drie punten met een vaste
  // inrichting (strandhuisjes achteraan, een paviljoen op palen, een reddingspost, een volleybalveld, stoelen,
  // schermen en handdoeken, zandkastelen en gaten vooraan); lopers langs de waterlijn; duinpaden met een fietsenrek;
  // helm en konijnen in de duinen; dijken met schapen op laag land; zandbanken met zeehonden. Wie er is en wat er
  // staat hangt per beeld af van seizoen, weer en tijd van de dag (zie tekenStrand); hier alleen de plekken.
  kiesStrand() {
    const A = this.wereld.strand, n = A.n;
    if (!this.pv || this.pv.length !== n) { this.pv = new Uint8Array(n); this.isDijk = new Uint8Array(n); }
    const pv = this.pv, isDijk = this.isDijk;
    pv.fill(0); isDijk.fill(0);
    for (let i = 0; i < n; i++) {
      if (!(A.f[i] & S_DROOG)) continue;
      const bx = A.x[i] - A.nx[i] * 1.3, by = A.y[i] - A.ny[i] * 1.3;
      if (!this.landVrij(bx, by, 0.4) || this.grensBij(bx, by)) continue;
      pv[i] = P_VRIJ | (this.drukBij(bx, by) << 4);
    }
    const D = [], merk = [], lopers = [], paden = [], konijn = [], dijken = [], schaap = [];
    this.postXY = []; this.pavXY = [];
    for (let k = 0; k < A.ks.length; k++) {
      const s0 = A.ks[k], m = A.kn[k];
      // dijken: aaneengesloten laag land zonder duinen
      let a = -1;
      for (let j = 0; j <= m; j++) {
        const i = s0 + j, ok = j < m && A.f[i] & S_DIJK && pv[i] & P_VRIJ && this.landVrij(A.x[i] - A.nx[i] * 2.6, A.y[i] - A.ny[i] * 2.6, 0.5);
        if (ok && a < 0) a = j;
        if (!ok && a >= 0) {
          if (j - a >= 4 && dijken.length < 60) {
            const i0 = s0 + a, i1 = s0 + j - 1;
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (let q = i0; q <= i1; q++) {
              isDijk[q] = 1;
              x0 = Math.min(x0, A.x[q]); x1 = Math.max(x1, A.x[q]); y0 = Math.min(y0, A.y[q]); y1 = Math.max(y1, A.y[q]);
              merk.push(A.x[q] - A.nx[q] * 1.6, A.y[q] - A.ny[q] * 1.6, 1.4);
              const zq = (q * 977 + 41) | 0;
              if (hash(zq, 1) < 0.45 && schaap.length < 3 * 400) schaap.push(q, hash(zq, 2) < 0.55 ? 1.15 + hash(zq, 3) * 0.35 : 2.25 + hash(zq, 3) * 0.4, zq);
            }
            dijken.push({ i0, i1, zaad: (i0 * 31 + i1) | 0, x0: x0 - 4, y0: y0 - 4, x1: x1 + 4, y1: y1 + 4 });
          }
          a = -1;
        }
      }
      // percelen van drie punten
      for (let j = 1; j + 1 < m; j += 3) {
        const i = s0 + j;
        if (!(pv[i - 1] & pv[i] & pv[i + 1] & P_VRIJ) || isDijk[i - 1] || isDijk[i] || isDijk[i + 1]) continue;
        this.richtPerceel(i, pv[i] >> 4, D, merk);
      }
    }
    // tweede ronde, nu alle inrichting er staat: lopers, duinpaden en konijnen
    for (let k = 0; k < A.ks.length; k++) {
      const s0 = A.ks[k], m = A.kn[k];
      let a;
      // lopers: stukken van aaneengesloten vrije punten, hooguit 24 punten per loper
      a = -1;
      for (let j = 0; j <= m; j++) {
        const i = s0 + j, ok = j < m && pv[i] & P_VRIJ && !isDijk[i];
        if (ok && a < 0) a = j;
        if (!ok && a >= 0) {
          for (let q = a; q + 6 <= j && lopers.length < LOOP * 300; q += 24) {
            const i0 = s0 + q, i1 = s0 + Math.min(j - 1, q + 23), zq = (i0 * 613 + i1 * 7) | 0;
            lopers.push(i0, i1, 0, zq, 0, 0, Math.max(pv[i0] >> 4, pv[i1] >> 4));
          }
          a = -1;
        }
      }
      // duinpaden over de duinen naar het strand, met een fietsenrek aan het eind; konijnen in de duinen
      let laatst = -99;
      for (let j = 2; j + 2 < m; j++) {
        const i = s0 + j;
        if (!(A.f[i] & S_DUIN) || !(pv[i] & P_VRIJ)) continue;
        const x = A.x[i], y = A.y[i], nx = A.nx[i], ny = A.ny[i], zq = (i * 389 + 5) | 0;
        if (hash(zq, 41) < 0.05 && konijn.length < 3 * 120) {
          const d = 3.6 + hash(zq, 42) * 1.8, kx = x - nx * d, ky = y - ny * d;
          if (this.landVrij(kx, ky, 0.3)) konijn.push(kx, ky, zq);
        }
        if (j - laatst < 14 || paden.length >= 40 || (pv[i] >> 4) < 1 || hash(zq, 43) > 0.45) continue;
        // niet dwars door de strandhuisjes, het paviljoen of de reddingspost waar het pad op het strand uitkomt
        let ok = true;
        for (let q = 0; q < D.length && ok; q += DING) {
          const sq = D[q], r = sq === PAVILJOEN_S ? 1.3 : sq === HUISJE_S || sq === POST_S ? 0.6 : 0;
          if (r && (Math.hypot(D[q + 1] - (x - nx * 2.1), D[q + 2] - (y - ny * 2.1)) < r || Math.hypot(D[q + 1] - (x - nx * 2.6), D[q + 2] - (y - ny * 2.6)) < r)) ok = false;
        }
        for (let d = 2.6; d <= 5.9 && ok; d += 0.8) if (!this.landVrij(x - nx * d, y - ny * d, 0.25)) ok = false;
        if (!ok) continue;
        const tx = -ny, ty = nx, rx = x - nx * 6.1 + tx * 0.75, ry = y - ny * 6.1 + ty * 0.75, rek = this.landVrij(rx, ry, 0.3);
        paden.push({ i, x, y, nx, ny, zaad: zq, rek, druk: pv[i] >> 4, x0: x - 8, y0: y - 8, x1: x + 8, y1: y + 8 });
        for (let d = 2.4; d <= 6.2; d += 1.2) merk.push(x - nx * d, y - ny * d, 0.4);
        if (rek) merk.push(rx, ry, 0.4);
        laatst = j;
      }
    }
    // zandbanken: vrij van de boten van leven.js en de rest van deze laag
    const banken = [];
    for (const z of this.wereld.zandbanken) {
      if (banken.length >= 12 || !this.vrij(z.x, z.y, z.rx + 0.4, LEVEN | INFRA | KUST)) continue;
      banken.push(z);
      this.merk(z.x, z.y, z.rx * 0.8, KUST);
    }
    // nu pas merken: binnen een perceel botsen de dingen niet met hun eigen merktekens
    for (let j = 0; j < merk.length; j += 3) this.merkLand(merk[j], merk[j + 1], merk[j + 2], KUST);
    this.dingen = Float32Array.from(D);
    this.lopers = Float32Array.from(lopers);
    this.duinpaden = paden;
    this.konijnen = Float32Array.from(konijn);
    this.dijken = dijken;
    this.schapen = Float32Array.from(schaap);
    this.zandbanken = banken;
    // plekken om naartoe te zoomen
    const eerste = (soort) => { for (let j = 0; j < D.length; j += DING) if (D[j] === soort) return j; return -1; };
    for (const [soort, naam] of [[PAVILJOEN_S, 'paviljoen'], [POST_S, 'reddingspost'], [VELD_S, 'volleybal'], [HUISJE_S, 'strandhuisjes'], [KASTEEL_S, 'zandkastelen']]) {
      const j = eerste(soort);
      if (j >= 0) this.plek(naam, D[j + 1], D[j + 2]);
    }
    if (paden.length) this.plek('duinovergang', paden[0].x - paden[0].nx * 3, paden[0].y - paden[0].ny * 3);
    if (dijken.length) { const q = (dijken[0].i0 + dijken[0].i1) >> 1; this.plek('dijk', A.x[q] - A.nx[q] * 1.6, A.y[q] - A.ny[q] * 1.6); }
    if (banken.length) this.plek('zandbank', banken[0].x, banken[0].y);
    if (konijn.length) this.plek('konijnen', konijn[0], konijn[1]);
    for (let j = 0; j < lopers.length; j += LOOP) if (lopers[j + 6] === 0) { const q = lopers[j]; this.plek('stil strand', A.x[q] - A.nx[q], A.y[q] - A.ny[q]); break; }
  }

  // Eén perceel: drie strandpunten (zo'n 4,5 eenheid langs de waterlijn). Kader: u langs het strand, d landinwaarts.
  // Achteraan (d 1,8-2,25) strandhuisjes, een paviljoen of een reddingspost; in het midden (d 1-1,5) een veld of
  // het ligvak; vooraan (d 0,4-0,6) zandkastelen en gaten.
  richtPerceel(i, druk, D, merk) {
    const A = this.wereld.strand, x = A.x[i], y = A.y[i], nx = A.nx[i], ny = A.ny[i], tx = -ny, ty = nx;
    const zaad = (Math.round(x * 7) * 131 + Math.round(y * 7) * 17) | 0;
    if (druk === 0) return;
    const wx = (u, d) => x + tx * u - nx * d, wy = (u, d) => y + ty * u - ny * d;
    const past = (u, d, hu, hd) => {
      for (let k = 0; k < 5; k++) {
        const pu = k === 4 ? u : u + (k & 1 ? hu : -hu), pd = k === 4 ? d : d + (k & 2 ? hd : -hd);
        if (!this.landVrij(wx(pu, pd), wy(pu, pd), 0)) return false;
      }
      return true;
    };
    const zet = (soort, u, d, extra, r) => {
      const X = wx(u, d), Y = wy(u, d), z2 = (zaad * 7 + D.length) | 0;
      D.push(soort, X, Y, tx, ty, z2, druk, extra);
      merk.push(X, Y, r);
    };
    const r = hash(zaad, 1);
    let midden = true, achter = true, vrijU = 0; // vrijU: ligvak alleen buiten |u| < vrijU
    // een paviljoen (ook een enkele strandtent op een rustig strand), hooguit om de 24 eenheden strand
    if (r < [0, 0.04, 0.14, 0.3][druk] && !this.pavXY.some((p, j) => j % 2 === 0 && Math.hypot(p - x, this.pavXY[j + 1] - y) < 24) && past(0, 1.75, 0.75, 0.55)) {
      this.pavXY.push(x, y);
      zet(PAVILJOEN_S, 0, 1.75, Math.floor(hash(zaad, 2) * 4), 1.1);
      achter = false; vrijU = 1.05;
    } else if (r < (druk >= 2 ? 0.3 : 0.12) && !this.postXY.some((p, j) => j % 2 === 0 && Math.hypot(p - x, this.postXY[j + 1] - y) < 28)) {
      const u = (hash(zaad, 3) - 0.5) * 2;
      if (past(u, 1.65, 0.4, 0.4)) { zet(POST_S, u, 1.65, 0, 0.7); this.postXY.push(x, y); achter = false; vrijU = 0; midden = hash(zaad, 4) < 0.5; }
    }
    if (achter && (druk === 3 ? hash(zaad, 5) < 0.85 : druk === 2 ? hash(zaad, 5) < 0.55 : hash(zaad, 5) < 0.18)) {
      // een rij huisjes, links of rechts beginnend; elk huisje kijkt naar zee
      const nh = druk === 3 ? 5 + Math.floor(hash(zaad, 6) * 3) : 2 + Math.floor(hash(zaad, 6) * 3), u0 = -((nh - 1) * 0.62) / 2;
      for (let h = 0; h < nh; h++) { const u = u0 + h * 0.62; if (past(u, 2.02, 0.26, 0.2)) zet(HUISJE_S, u, 2.02, Math.floor(hash(zaad, 20 + h) * HUISJE.length), 0.4); }
    }
    if (midden && druk >= 2 && vrijU === 0 && hash(zaad, 7) < 0.3 && past(0, 1.25, 0.9, 0.42)) {
      zet(VELD_S, 0, 1.25, 0, 1.0);
    } else if (midden) {
      const kans = [0, 0.35, 0.6, 0.8][druk];
      for (let s = 0; s < 8; s++) {
        const u = -1.85 + s * 0.53, zs = hash(zaad, 30 + s);
        if (Math.abs(u) < vrijU || zs > kans) continue;
        const soort = druk >= 2 && hash(zaad, 40 + s) < 0.3 ? STOEL_S : hash(zaad, 50 + s) < 0.3 ? SCHERM_S : DOEK_S;
        const d = 1.18 + (hash(zaad, 60 + s) - 0.5) * 0.2;
        if (past(u, d, 0.22, 0.26)) zet(soort, u, d, Math.floor(hash(zaad, 70 + s) * 64), 0.3);
      }
    }
    // vooraan: zandkastelen en gaten (waar kinderen zijn)
    for (let s = 0; s < 2; s++) {
      if (hash(zaad, 80 + s) > (druk >= 2 ? 0.4 : 0.15)) continue;
      const u = (s ? 0.4 : -1.2) + hash(zaad, 82 + s) * 0.8;
      if (past(u, 0.5, 0.2, 0.15)) zet(hash(zaad, 84 + s) < 0.7 ? KASTEEL_S : GAT_S, u, 0.5, Math.floor(hash(zaad, 86 + s) * 64), 0.25);
    }
  }

  // ---------- per beeld ----------

  kader(view, sc) {
    const [wx0, wy0] = view.naarWereld(0, 0);
    const [wx1, wy1] = view.naarWereld(view.w, view.h);
    this.sc = sc;
    this.T = this.geo.T * sc;
    this.ox = view.w / 2 - view.cx * sc;
    this.oy = view.h / 2 - view.cy * sc;
    this.wx0 = wx0; this.wy0 = wy0; this.wx1 = wx1; this.wy1 = wy1;
    this.w = view.w; this.h = view.h;
    this.dpr = view.dpr || 1;
    this.P = emmer(this.T * this.dpr);
  }

  inBeeld(x0, y0, x1, y1, m) { return x1 >= this.wx0 - m && x0 <= this.wx1 + m && y1 >= this.wy0 - m && y0 <= this.wy1 + m; }
  puntInBeeld(x, y, m) { return x >= this.wx0 - m && x <= this.wx1 + m && y >= this.wy0 - m && y <= this.wy1 + m; }
  opScherm(x, y, m) { return x > -m && y > -m && x < this.w + m && y < this.h + m; }

  zetLicht(x, y, r, soort, a) {
    if (this.nLicht >= PLAFOND.lichten || !this.opScherm(x, y, r)) return;
    const o = this.nLicht++ * LICHT, b = this.licht;
    b[o] = x; b[o + 1] = y; b[o + 2] = r; b[o + 3] = soort; b[o + 4] = a;
  }

  haal(sleutel) {
    const e = this.cache.get(sleutel);
    if (e) { this.cache.delete(sleutel); this.cache.set(sleutel, e); }
    return e;
  }

  // Bak een bitmap van bw x bh tegels op P pixels per tegel (LRU, hooguit PLAFOND.bakken per beeld).
  bak(sleutel, basis, bw, bh, P, fn, obj) {
    const oud = this.haal(sleutel);
    if (oud) return oud;
    if (this.bakTeller >= PLAFOND.bakken) return this.laatste.get(basis) ?? null;
    const Wp = Math.max(2, Math.ceil(bw * P)), Hp = Math.max(2, Math.ceil(bh * P));
    const cv = fabriek(Wp, Hp);
    if (!cv) return null;
    this.bakTeller++;
    const g = cv.getContext('2d');
    g.setTransform(P, 0, 0, P, Wp / 2, Hp / 2);
    fn(g, obj, { P, sn: this.sn, ijs: this.ijs });
    const e = { cv, w: Wp, h: Hp, P, bytes: Wp * Hp * 4, basis };
    this.cache.set(sleutel, e);
    this.laatste.set(basis, e);
    this.bytes += e.bytes;
    this.gebakken++;
    for (const [k, x] of this.cache) {
      if (this.cache.size <= MAX_SPRITES && this.bytes <= MAX_BYTES) break;
      if (x === e) continue;
      this.cache.delete(k);
      this.bytes -= x.bytes;
      if (this.laatste.get(x.basis) === x) this.laatste.delete(x.basis);
    }
    return e;
  }

  // Een gebakken bitmap waarvan het lokale punt (ax, ay) (tegels vanaf het midden) op wereldpunt (wx, wy) valt.
  plak(c, e, wx, wy, ax, ay) {
    const k = (this.T * this.dpr) / e.P, dpr = this.dpr;
    const w = (e.w * k) / dpr, h = (e.h * k) / dpr;
    const X = wx * this.sc + this.ox - ax * this.T, Y = wy * this.sc + this.oy - ay * this.T;
    if (Math.abs(k - 1) < 0.002) c.drawImage(e.cv, Math.round((X - w / 2) * dpr) / dpr, Math.round((Y - h / 2) * dpr) / dpr, w, h);
    else c.drawImage(e.cv, X - w / 2, Y - h / 2, w, h);
  }

  // Na de infralaag: alles op en aan het water. Hoge dingen (turbines, booreilanden, vuurtorens) als laatste.
  teken(c, view, sc, nu, dt = 0, tempo = 0) {
    if (tempo > 0) this.klok += dt;
    this.nul();
    const s = view.state;
    if (!s || !view.geo || !view.w || !view.eigenaar) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar || (view.terreinLaag?.basis && view.terreinLaag.basis !== this.basis)) this.laad(view);
    const z = view.zoom;
    this.zoom = z;
    if (z < DREMPEL.groot - 0.4) return;
    this.werkCache(view);
    this.kader(view, sc);
    this.sz = seizoen(s.dag);
    this.wr = weer(s.dag, view.cx, view.cy);
    this.wd = wind(s.dag);
    this.sn = this.sz.sneeuw > 0.66 ? 2 : this.sz.sneeuw > 0.25 ? 1 : 0;
    this.ijs = smooth(0.86, 0.97, this.sz.koud);
    this.nacht = view.nacht ?? 0;
    this.nu = nu;
    this.bakTeller = 0;
    this.gloed ??= LICHTKLEUR.map((k) => { const cv = fabriek(32, 32); if (cv) bakGloed(cv, k); return cv; });
    if (!this.bundel) { const cv = fabriek(128, 32); if (cv) bakBundel(cv); this.bundel = cv; }
    this.bruggen = view.infraLaag?.brugVlakken ? view.infraLaag.brugVlakken() : null;
    const a = smooth(3.6, 4.4, z);
    this.vervaag = a; // ook de lichtjes komen bij het inzoomen geleidelijk op (zie tekenLichten)
    // eb en vloed: een getij van drie minuten op de klok, alleen beeld
    this.tij = 0.55 * Math.sin((TAU * nu) / 180000 + 0.7);
    this.strandWeer();
    this.nZr = 0;
    if (z >= DREMPEL.getij - 0.5) this.strandZicht();
    const op = (drempel) => a * smooth(drempel - 0.5, drempel + 0.3, z);
    c.save();
    c.lineCap = 'butt';
    c.lineJoin = 'round';
    if (this.nZr) this.tekenGetij(c, op(DREMPEL.getij));
    if (z >= DREMPEL.roller - 0.5) this.tekenRollers(c, a * smooth(DREMPEL.roller - 0.5, DREMPEL.roller + 0.5, z));
    if (z >= DREMPEL.zandbank - 0.5) this.tekenZandbanken(c, op(DREMPEL.zandbank));
    if (z >= DREMPEL.dijk - 0.5) this.tekenDijken(c, op(DREMPEL.dijk));
    this.tekenDammen(c, a);
    if (z >= DREMPEL.viskweek - 0.5) this.tekenViskwekerijen(c, a * smooth(DREMPEL.viskweek - 0.5, DREMPEL.viskweek + 0.3, z));
    if (z >= DREMPEL.stuw - 0.5) this.tekenStuwen(c, a * smooth(DREMPEL.stuw - 0.5, DREMPEL.stuw + 0.3, z));
    if (z >= DREMPEL.kade - 0.5) this.tekenKades(c, a * smooth(DREMPEL.kade - 0.5, DREMPEL.kade + 0.3, z));
    if (z >= DREMPEL.woonboot - 0.5) this.tekenWoonboten(c, a * smooth(DREMPEL.woonboot - 0.5, DREMPEL.woonboot + 0.3, z));
    if (z >= DREMPEL.sloep - 0.5) this.tekenSloepen(c, op(DREMPEL.sloep));
    if (z >= DREMPEL.aak - 0.5) this.tekenAken(c, a * smooth(DREMPEL.aak - 0.5, DREMPEL.aak + 0.3, z));
    if (z >= DREMPEL.boei - 0.5) this.tekenBoeien(c, a * smooth(DREMPEL.boei - 0.5, DREMPEL.boei + 0.3, z));
    if (z >= DREMPEL.havenhoofd - 0.4) this.tekenHavenhoofden(c, a * smooth(DREMPEL.havenhoofd - 0.4, DREMPEL.havenhoofd + 0.3, z));
    if (z >= DREMPEL.jachthaven - 0.5) this.tekenJachthavens(c, a * smooth(DREMPEL.jachthaven - 0.5, DREMPEL.jachthaven + 0.3, z));
    if (z >= DREMPEL.veerstoep - 0.5) this.tekenVeerstoepen(c, op(DREMPEL.veerstoep));
    if (z >= DREMPEL.pier - 0.5) this.tekenPieren(c, a * smooth(DREMPEL.pier - 0.5, DREMPEL.pier + 0.3, z));
    if (z >= DREMPEL.vissershaven - 0.5) this.tekenVissershavens(c, op(DREMPEL.vissershaven));
    if (z >= DREMPEL.rots - 0.5) this.tekenRotsen(c, a * smooth(DREMPEL.rots - 0.5, DREMPEL.rots + 0.3, z));
    // het strand van dichtbij: vloedlijn, duinen, inrichting, lopers, hengelaars; de mensen en honden als laatste
    if (this.nZr && z >= DREMPEL.vloedlijn - 0.5) this.tekenVloedlijn(c, op(DREMPEL.vloedlijn));
    if (z >= DREMPEL.duinpad - 0.5) this.tekenDuinen(c, op(DREMPEL.duinpad));
    if (z >= DREMPEL.paviljoen - 0.5) this.tekenStrand(c, op(DREMPEL.paviljoen));
    if (z >= DREMPEL.loper - 0.5) this.tekenLopers(c, op(DREMPEL.loper));
    if (z >= DREMPEL.hengel - 0.5) this.tekenHengelaars(c, op(DREMPEL.hengel));
    if (this.nMens || this.nHond) { c.globalAlpha = op(DREMPEL.strandmens); this.tekenMensen(c); }
    this.tekenWindparken(c, a);
    this.tekenBooreilanden(c, a);
    this.tekenVuurtorens(c, a);
    c.restore();
    this.n.lichten = this.nLicht;
  }

  // ---------- rollers op het strand ----------

  tekenRollers(c, a) {
    const B = this.rollers, n = B.length / 6, sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, nu = this.nu, sd = this.basis.sd;
    if (!n) return;
    // eerst de plekken in beeld (elke plek geeft twee golven, samen hooguit het plafond), dan beide lagen uit
    // dezelfde lijst: zo houdt de brekende laag altijd zijn deel
    const zicht = this.rolZicht ??= new Int32Array(PLAFOND.rollers >> 1);
    let m = 0;
    for (let i = 0; i < n && m < zicht.length; i++) if (this.puntInBeeld(B[i * 6], B[i * 6 + 1], 8)) zicht[m++] = i;
    if (!m) return;
    let tel = 0;
    c.globalAlpha = a;
    c.lineCap = 'round';
    for (let laag = 0; laag < 2; laag++) {
      c.strokeStyle = laag ? 'rgba(255,255,255,0.7)' : 'rgba(232,244,248,0.32)';
      c.lineWidth = Math.max(0.6, T * (laag ? 0.006 : 0.0035));
      c.beginPath();
      for (let j = 0; j < m; j++) {
        const o = zicht[j] * 6, x = B[o], y = B[o + 1];
        const nx = B[o + 2], ny = B[o + 3], zaad = B[o + 4], L = B[o + 5];
        for (let k = 0; k < 2; k++) {
          const p = frac(nu / 5200 + zaad + k * 0.5);
          // laag 0: de golf die aanrolt; laag 1: het breken vlak voor de kust
          if (laag === 0 ? p > 0.74 : p <= 0.74) continue;
          const d = Math.max(0.3, 0.4 + (1 - p) * 5.5 - this.tij * 0.9), cx = x + nx * d, cy = y + ny * d, hl = L * (0.55 + 0.45 * p);
          const ax = cx - ny * hl, ay = cy + nx * hl, bx = cx + ny * hl, by = cy - nx * hl;
          if (sdOp(sd, ax, ay) < 0.25 || sdOp(sd, bx, by) < 0.25) continue;
          c.moveTo(ax * sc + ox, ay * sc + oy);
          c.quadraticCurveTo((cx - nx * 0.6) * sc + ox, (cy - ny * 0.6) * sc + oy, bx * sc + ox, by * sc + oy);
          tel++;
        }
      }
      c.stroke();
    }
    c.lineCap = 'butt';
    this.n.rollers = tel;
  }

  // ---------- rotsen, schuim, opspattend water, zeehonden ----------

  tekenRotsen(c, a) {
    const B = this.rotsen, n = B.length / 6, sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, z = this.zoom, nu = this.nu;
    if (!n) return;
    const zicht = this.rotsZicht ??= new Int32Array(PLAFOND.rotsen);
    let m = 0;
    for (let i = 0; i < n && m < PLAFOND.rotsen; i++) if (this.puntInBeeld(B[i * 6], B[i * 6 + 1], 3)) zicht[m++] = i;
    this.n.rotsen = m;
    if (!m) return;
    c.globalAlpha = a;
    // schuim tegen de zeekant
    if (z >= DREMPEL.fijn) {
      c.strokeStyle = 'rgba(236,246,250,0.5)'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
      for (let j = 0; j < m; j++) {
        const o = zicht[j] * 6, x = B[o] * sc + ox, y = B[o + 1] * sc + oy, r = B[o + 2] * sc * (1.15 + 0.12 * Math.sin(nu / 650 + B[o + 3]));
        const hk = Math.atan2(B[o + 5], B[o + 4]);
        c.moveTo(x + Math.cos(hk - 1.2) * r, y + Math.sin(hk - 1.2) * r); c.arc(x, y, r, hk - 1.2, hk + 1.2);
      }
      c.stroke();
    }
    // de rotsen zelf: zes gebakken varianten
    const P = this.P, rs = this.rotsSprites ??= new Array(6);
    rs.fill(undefined); // per beeld één keer per variant opzoeken (of bakken), niet per rots
    for (let j = 0; j < m; j++) {
      const o = zicht[j] * 6, v = (B[o + 3] >>> 0) % 6;
      if (rs[v] === undefined) rs[v] = this.bak(`rots${v}|${P}|${this.sn}`, `rots${v}`, 0.16, 0.14, P, bakRots, { variant: v });
      const e = rs[v];
      if (!e) continue;
      const k = B[o + 2], w = 0.16 * T * k, h = 0.14 * T * k;
      c.drawImage(e.cv, B[o] * sc + ox - w / 2, B[o + 1] * sc + oy - h / 2, w, h);
    }
    // opspattend water op de buitenste rotsen
    if (z >= DREMPEL.spat - 0.5) {
      let ns = 0;
      c.fillStyle = 'rgba(255,255,255,0.72)'; c.beginPath();
      for (let j = 0; j < m && ns < PLAFOND.spatten; j++) {
        const o = zicht[j] * 6, zaad = B[o + 3];
        if (hash(zaad, 3) > 0.3) continue;
        const p = frac(nu / 2800 + hash(zaad, 4) * 7);
        if (p > 0.3) continue;
        ns++;
        const k = p / 0.3, nx = B[o + 4], ny = B[o + 5], r = B[o + 2];
        const bx = (B[o] + nx * r * 0.7) * sc + ox, by = (B[o + 1] + ny * r * 0.7) * sc + oy;
        for (let d = 0; d < 3; d++) {
          const zij = (d - 1) * T * 0.018 * k, op = T * 0.06 * k * (1 - k) * 4 * (1 - Math.abs(d - 1) * 0.3);
          stip(c, bx - ny * zij, by + nx * zij - op, T * 0.008 * (1 + k) * (1 - k * 0.5));
        }
      }
      c.fill();
      this.n.spatten = ns;
    }
    // zeehonden op de grotere rotsen
    if (z >= DREMPEL.zeehond - 0.5) {
      let nz = 0;
      c.globalAlpha = a * smooth(DREMPEL.zeehond - 0.5, DREMPEL.zeehond + 0.3, z);
      for (let j = 0; j < m && nz < PLAFOND.zeehonden; j++) {
        const o = zicht[j] * 6, zaad = B[o + 3];
        if (B[o + 2] < 0.7 || hash(zaad, 9) > 0.2) continue;
        const twee = hash(zaad, 10) < 0.35;
        for (let s = 0; s < (twee ? 2 : 1) && nz < PLAFOND.zeehonden; s++) {
          nz++;
          this.zeehond(c, B[o] * sc + ox + (s ? T * 0.02 : 0), B[o + 1] * sc + oy - B[o + 2] * sc * 0.25 + (s ? T * 0.008 : 0), hash(zaad, 11 + s) * TAU, zaad + s * 17);
        }
      }
      this.n.zeehonden = nz;
    }
  }

  zeehond(c, x, y, hk, zaad) {
    const T = this.T, hx = Math.cos(hk), hy = Math.sin(hk) * 0.6, l = T * 0.018, w = T * 0.008;
    // af en toe tilt hij kop en staart op (de banaan)
    const f = frac(this.nu / 9000 + hash(zaad, 1));
    const op = smooth(0.55, 0.62, f) * (1 - smooth(0.85, 0.92, f));
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(x + T * 0.004, y + T * 0.004, l, w, Math.atan2(hy, hx), 0, TAU); c.fill();
    c.fillStyle = ZEEHOND[Math.floor(hash(zaad, 2) * ZEEHOND.length)];
    c.beginPath(); c.ellipse(x, y, l, w, Math.atan2(hy, hx), 0, TAU); c.fill();
    const kx = x + hx * l * 0.95, ky = y + hy * l * 0.95 - op * T * 0.008;
    c.beginPath(); stip(c, kx, ky, w * 0.75); c.fill();
    // staartvinnen
    c.beginPath(); c.moveTo(x - hx * l * 0.9, y - hy * l * 0.9); c.lineTo(x - hx * l * 1.35 - hy * w, y - hy * l * 1.35 + hx * w - op * T * 0.004); c.lineTo(x - hx * l * 1.35 + hy * w, y - hy * l * 1.35 - hx * w - op * T * 0.004); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.ellipse(x - hy * w * 0.3, y - w * 0.35, l * 0.7, w * 0.35, Math.atan2(hy, hx), 0, TAU); c.fill();
    if (this.zoom >= DREMPEL.klein) { c.fillStyle = '#1a1a1a'; c.beginPath(); stip(c, kx + hx * w * 0.4, ky - w * 0.15, Math.max(0.4, T * 0.0012)); c.fill(); }
  }

  // ---------- havenhoofden en boeien ----------

  tekenHavenhoofden(c, a) {
    const T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, Tw = this.geo.T;
    let n = 0;
    c.globalAlpha = a;
    c.lineCap = 'round';
    for (const arm of this.havenhoofden) {
      if (n >= PLAFOND.havenhoofden || !this.inBeeld(arm.x0, arm.y0, arm.x1, arm.y1, Tw * 0.2)) continue;
      n++;
      const p = arm.pts, m = p.length / 2;
      const pad = (dx, dy) => { c.beginPath(); for (let i = 0; i < m; i++) { const x = p[i * 2] * sc + ox + dx, y = p[i * 2 + 1] * sc + oy + dy; if (i) c.lineTo(x, y); else c.moveTo(x, y); } };
      c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = T * 0.07; pad(T * 0.012, T * 0.018); c.stroke();
      if (z >= DREMPEL.fijn) { c.strokeStyle = 'rgba(235,245,248,0.45)'; c.lineWidth = T * 0.085; pad(0, T * 0.006); c.stroke(); }
      c.strokeStyle = '#8f8a80'; c.lineWidth = T * 0.06; pad(0, 0); c.stroke();
      if (z >= DREMPEL.fijn) { c.strokeStyle = '#6f6a62'; c.lineWidth = T * 0.055; c.setLineDash([T * 0.012, T * 0.009]); pad(0, 0); c.stroke(); c.setLineDash([]); }
      c.strokeStyle = this.sn ? '#e4e8ea' : '#b9b4a8'; c.lineWidth = T * 0.026; pad(0, -T * 0.006); c.stroke();
      // licht op de kop: een torentje, rood aan de ene kant van de monding, groen aan de andere
      const ex = p[(m - 1) * 2] * sc + ox, ey = p[(m - 1) * 2 + 1] * sc + oy, H = T * 0.07, rood = arm.kant < 0;
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = Math.max(1, T * 0.012); c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex + H * SCHUIN, ey + H * SCHUIN); c.stroke();
      c.strokeStyle = rood ? '#c43c32' : '#3d8a4f'; c.lineWidth = Math.max(1, T * 0.016); c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex, ey - H); c.stroke();
      if (z >= DREMPEL.fijn) { c.strokeStyle = '#f2f0ea'; c.lineWidth = Math.max(1, T * 0.016); c.beginPath(); c.moveTo(ex, ey - H * 0.35); c.lineTo(ex, ey - H * 0.55); c.stroke(); }
      c.fillStyle = '#2c2c2c'; c.fillRect(ex - T * 0.009, ey - H - T * 0.012, T * 0.018, T * 0.012);
      if (this.nacht > 0.05 && frac(this.nu / 3000 + hash(arm.zaad, 1)) < 0.55) this.zetLicht(ex, ey - H - T * 0.006, Math.max(3, T * 0.06), rood ? ROOD : GROEN, 1);
    }
    c.lineCap = 'butt';
    this.n.havenhoofden = n;
  }

  tekenBoeien(c, a) {
    const B = this.boeien, n = B.length / 4, T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, nu = this.nu;
    if (!n) return;
    const zicht = this.boeiZicht ??= new Int32Array(PLAFOND.boeien);
    let m = 0;
    for (let i = 0; i < n && m < PLAFOND.boeien; i++) if (this.puntInBeeld(B[i * 4], B[i * 4 + 1], 2)) zicht[m++] = i;
    this.n.boeien = m;
    if (!m) return;
    c.globalAlpha = a;
    const r = Math.max(0.8, T * 0.011);
    const dobber = (o) => Math.sin(nu / 700 + B[o + 3]) * T * 0.002;
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath();
    for (let j = 0; j < m; j++) { const o = zicht[j] * 4; stip(c, B[o] * sc + ox + r * 0.6, B[o + 1] * sc + oy + r * 0.8, r); }
    c.fill();
    if (z >= DREMPEL.klein) {
      c.strokeStyle = 'rgba(235,245,248,0.4)'; c.lineWidth = Math.max(0.4, T * 0.002); c.beginPath();
      for (let j = 0; j < m; j++) { const o = zicht[j] * 4, x = B[o] * sc + ox, y = B[o + 1] * sc + oy, rr = r * (1.6 + 0.4 * Math.sin(nu / 500 + B[o + 3])); c.moveTo(x + rr, y); c.ellipse(x, y, rr, rr * 0.6, 0, 0, TAU); }
      c.stroke();
    }
    for (let kleur = 0; kleur < 2; kleur++) {
      c.fillStyle = kleur ? '#3d8a4f' : '#c43c32'; c.beginPath();
      for (let j = 0; j < m; j++) {
        const o = zicht[j] * 4;
        if (B[o + 2] !== kleur) continue;
        const x = B[o] * sc + ox, y = B[o + 1] * sc + oy + dobber(o);
        if (kleur) { c.moveTo(x - r, y); c.lineTo(x, y - r * 2.2); c.lineTo(x + r, y); c.closePath(); }
        else c.rect(x - r * 0.8, y - r * 2, r * 1.6, r * 2);
      }
      c.fill();
    }
    if (z >= DREMPEL.fijn) {
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath();
      for (let j = 0; j < m; j++) { const o = zicht[j] * 4; c.rect(B[o] * sc + ox - r * 0.7, B[o + 1] * sc + oy + dobber(o) - r * 1.4, r * 0.4, r * 1.2); }
      c.fill();
    }
    if (this.nacht > 0.05) for (let j = 0; j < m; j++) {
      const o = zicht[j] * 4;
      if (frac(nu / 1600 + B[o + 3] * 0.37) < 0.3) this.zetLicht(B[o] * sc + ox, B[o + 1] * sc + oy - r * 2.2, Math.max(2.5, T * 0.04), B[o + 2] ? GROEN : ROOD, 0.95);
    }
  }

  // ---------- pieren ----------

  tekenPieren(c, a) {
    const T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, Tw = this.geo.T, S = SCHUIN;
    let n = 0;
    c.globalAlpha = a;
    for (const p of this.pieren) {
      if (n >= PLAFOND.pieren || !this.inBeeld(p.x0, p.y0, p.x1, p.y1, 2)) continue;
      n++;
      const nx = p.nx, ny = p.ny, tx = -ny, ty = nx, L = p.L * T, bw = T * 0.025, kw = T * 0.12, kd = T * 0.08, hp = T * 0.025;
      const x0 = p.x * sc + ox, y0 = p.y * sc + oy, kx = x0 + nx * L, ky = y0 + ny * L;
      const vorm = (dx, dy) => {
        c.beginPath();
        c.moveTo(x0 + tx * bw + dx, y0 + ty * bw + dy); c.lineTo(kx - nx * kd + tx * bw + dx, ky - ny * kd + ty * bw + dy);
        c.lineTo(kx - nx * kd + tx * kw + dx, ky - ny * kd + ty * kw + dy); c.lineTo(kx + tx * kw + dx, ky + ty * kw + dy);
        c.lineTo(kx - tx * kw + dx, ky - ty * kw + dy); c.lineTo(kx - nx * kd - tx * kw + dx, ky - ny * kd - ty * kw + dy);
        c.lineTo(kx - nx * kd - tx * bw + dx, ky - ny * kd - ty * bw + dy); c.lineTo(x0 - tx * bw + dx, y0 - ty * bw + dy); c.closePath();
      };
      // schaduw op het water, palen eronder, dan het dek
      c.fillStyle = 'rgba(0,0,0,0.26)'; vorm(hp * S, hp * (1 + S)); c.fill();
      if (z >= DREMPEL.fijn) {
        c.strokeStyle = '#4a3a2c'; c.lineWidth = Math.max(0.6, T * 0.005); c.beginPath();
        const zuid = ty >= 0 ? 1 : -1;
        for (let v = 0.12 * T; v < L; v += 0.06 * T) { const w = v > L - kd ? kw : bw, x = x0 + nx * v + tx * w * zuid, y = y0 + ny * v + ty * w * zuid; c.moveTo(x, y); c.lineTo(x, y + hp); }
        c.stroke();
      }
      c.fillStyle = this.sn ? '#e2e5e7' : '#9a7a56'; vorm(0, 0); c.fill();
      if (z >= DREMPEL.klein && !this.sn) {
        c.strokeStyle = 'rgba(60,44,30,0.4)'; c.lineWidth = Math.max(0.4, T * 0.0012); c.beginPath();
        for (let v = T * 0.01; v < L - kd; v += T * 0.012) { c.moveTo(x0 + nx * v + tx * bw, y0 + ny * v + ty * bw); c.lineTo(x0 + nx * v - tx * bw, y0 + ny * v - ty * bw); }
        c.stroke();
      }
      c.strokeStyle = '#e8e4da'; c.lineWidth = Math.max(0.5, T * 0.003); vorm(0, -T * 0.008); c.stroke();
      // paviljoen op de kop
      const px = kx - nx * kd * 0.5, py = ky - ny * kd * 0.5, ph = T * 0.035;
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); rechthoek(c, px + ph * S, py + ph * S, tx, ty, T * 0.05, T * 0.025); c.fill();
      c.fillStyle = '#e9e4d8'; c.beginPath(); rechthoek(c, px, py, tx, ty, T * 0.05, T * 0.025); c.fill();
      c.beginPath(); rechthoek(c, px, py - ph * 0.5, tx, ty, T * 0.05, T * 0.025); c.fill();
      c.fillStyle = this.sn ? '#eef1f3' : hash(p.zaad, 1) < 0.5 ? '#3d7a7a' : '#a8483a'; c.beginPath(); rechthoek(c, px, py - ph, tx, ty, T * 0.055, T * 0.03); c.fill();
      // lantaarns om en om langs de leuning
      if (z >= DREMPEL.fijn - 0.5 || this.nacht > 0.05) {
        c.strokeStyle = '#2f3336'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
        let k = 0;
        for (let v = 0.1 * T; v < L - kd; v += 0.13 * T, k++) { const s = k & 1 ? 1 : -1, x = x0 + nx * v + tx * bw * s, y = y0 + ny * v + ty * bw * s; c.moveTo(x, y); c.lineTo(x, y - T * 0.04); }
        c.stroke();
        k = 0;
        for (let v = 0.1 * T; v < L - kd; v += 0.13 * T, k++) {
          const s = k & 1 ? 1 : -1, x = x0 + nx * v + tx * bw * s, y = y0 + ny * v + ty * bw * s;
          if (this.nacht > 0.05) { this.zetLicht(x, y - T * 0.04, Math.max(2, T * 0.03), WARM, 0.9); this.zetLicht(x + T * 0.004, y + hp + T * 0.02, T * 0.05, WARM, 0.18); }
        }
        if (this.nacht > 0.05) this.zetLicht(px, py - ph * 0.5, T * 0.06, WARM, 0.6);
      }
    }
    this.n.pieren = n;
    void Tw;
  }

  // ---------- jachthavens ----------

  tekenJachthavens(c, a) {
    const T = this.T, z = this.zoom, Tw = this.geo.T;
    let n = 0;
    c.globalAlpha = a;
    const P = Math.min(this.P, 448);
    for (const j of this.jachthavens) {
      if (n >= PLAFOND.jachthavens || !this.inBeeld(j.x0, j.y0, j.x1, j.y1, 2)) continue;
      n++;
      // bitmap van 1,4 x 1,4 tegel, met het midden 0,27 tegel zeewaarts en iets omhoog (ruimte voor de masten)
      const mx = j.nx * 0.27, my = j.ny * 0.27 - 0.05;
      const o = { ax: -mx, ay: -my, nx: j.nx, ny: j.ny, lang: j.lang, club: j.club, zaad: j.zaad, masten: null };
      const e = this.bak(`${j.sleutel}|${P}|${this.sn}`, j.sleutel, 1.4, 1.4, P, bakJachthaven, o);
      // de masttoppen komen uit het bakken; bij een bitmap uit de cache (ook na opnieuw kiezen) staan ze erbij
      if (o.masten) { j.masten = o.masten; if (e) e.masten = o.masten; } else if (!j.masten && e && e.masten) j.masten = e.masten;
      if (!e) continue;
      this.plak(c, e, j.ax, j.ay, -mx, -my);
      if (this.nacht > 0.05 && j.masten) {
        const sc = this.sc, ox = this.ox, oy = this.oy;
        for (let k = 0; k < j.masten.length; k += 2) { const ms = j.masten[k]; this.zetLicht(j.ax * sc + ox + ms[0] * T, j.ay * sc + oy + (ms[1] - ms[2]) * T, Math.max(1.5, T * 0.018), WIT, 0.9); }
        for (let v = 0.1; v < j.lang; v += 0.12) this.zetLicht((j.ax + j.nx * v * Tw) * sc + ox, (j.ay + j.ny * v * Tw) * sc + oy - T * 0.02, T * 0.03, WARM, 0.7);
      }
    }
    this.n.jachthavens = n;
    void z;
  }

  // ---------- rivieren: kades, woonboten, binnenvaart, stuwen ----------

  tekenKades(c, a) {
    const T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom;
    let n = 0;
    c.globalAlpha = a;
    for (const k of this.kades) {
      if (n >= PLAFOND.kades || !this.inBeeld(k.x0, k.y0, k.x1, k.y1, 2)) continue;
      n++;
      const p = k.pts, m = p.length / 4, hq = T * 0.014;
      // muur: zichtbaar waar het water ten zuiden van de kade ligt (de muur kijkt naar de kijker)
      c.fillStyle = '#6f675b'; c.beginPath();
      for (let i = 0; i + 1 < m; i++) {
        if (p[i * 4 + 3] < 0.15 || p[i * 4 + 7] < 0.15) continue;
        const ax = p[i * 4] * sc + ox, ay = p[i * 4 + 1] * sc + oy, bx = p[i * 4 + 4] * sc + ox, by = p[i * 4 + 5] * sc + oy;
        c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(bx, by + hq); c.lineTo(ax, ay + hq); c.closePath();
      }
      c.fill();
      // deksteen langs de rand
      c.strokeStyle = this.sn ? '#e4e8ea' : '#b3a994'; c.lineWidth = Math.max(0.8, T * 0.01); c.beginPath();
      for (let i = 0; i < m; i++) { const x = p[i * 4] * sc + ox, y = p[i * 4 + 1] * sc + oy; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
      c.stroke();
      if (z >= DREMPEL.fijn + 1) {
        // bolders
        c.fillStyle = '#2b2b2a'; c.beginPath();
        for (let i = 1; i < m; i += 2) stip(c, p[i * 4] * sc + ox - p[i * 4 + 2] * T * 0.006, p[i * 4 + 1] * sc + oy - p[i * 4 + 3] * T * 0.006 - T * 0.003, Math.max(0.6, T * 0.0035));
        c.fill();
      }
      if (this.nacht > 0.05) for (let i = 1; i < m; i += 3) {
        const x = p[i * 4] * sc + ox - p[i * 4 + 2] * T * 0.012, y = p[i * 4 + 1] * sc + oy - p[i * 4 + 3] * T * 0.012;
        this.zetLicht(x, y - T * 0.04, Math.max(2, T * 0.03), WARM, 0.85);
        this.zetLicht(x + p[i * 4 + 2] * T * 0.05, y + p[i * 4 + 3] * T * 0.05 + T * 0.02, T * 0.05, WARM, 0.2); // weerschijn op het water
      }
    }
    this.n.kades = n;
  }

  tekenWoonboten(c, a) {
    const T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, S = SCHUIN;
    const zicht = this.wbZicht ??= new Int32Array(PLAFOND.woonboten);
    let m = 0;
    for (let i = 0; i < this.woonboten.length && m < PLAFOND.woonboten; i++) { const b = this.woonboten[i]; if (this.puntInBeeld(b.x, b.y, 2)) zicht[m++] = i; }
    this.n.woonboten = m;
    if (!m) return;
    c.globalAlpha = a;
    const l = 0.75 * sc, w = 0.24 * sc, kh = T * 0.016;
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath();
    for (let j = 0; j < m; j++) { const b = this.woonboten[zicht[j]]; rechthoek(c, b.x * sc + ox + kh * S, b.y * sc + oy + kh * S, b.fx, b.fy, l, w); }
    c.fill();
    c.fillStyle = '#2a2d30'; c.beginPath();
    for (let j = 0; j < m; j++) { const b = this.woonboten[zicht[j]]; rechthoek(c, b.x * sc + ox, b.y * sc + oy, b.fx, b.fy, l, w); }
    c.fill();
    for (let j = 0; j < m; j++) {
      const b = this.woonboten[zicht[j]], x = b.x * sc + ox, y = b.y * sc + oy, kl = WOONBOOT[Math.floor(hash(b.zaad, 1) * WOONBOOT.length)];
      c.fillStyle = kl; c.beginPath(); rechthoek(c, x, y - kh * 0.5, b.fx, b.fy, l * 0.82, w * 0.8); c.fill();
      c.fillStyle = this.sn ? '#eef1f3' : '#3a3633'; c.beginPath(); rechthoek(c, x, y - kh, b.fx, b.fy, l * 0.85, w * 0.84); c.fill();
      if (z >= DREMPEL.klein) {
        // ramen en wat groen op het dek
        c.fillStyle = '#2f4152'; c.beginPath();
        for (let k = -2; k <= 2; k++) rechthoek(c, x + b.fx * k * l * 0.3 - b.fy * w * 0.82, y + b.fy * k * l * 0.3 + b.fx * w * 0.82 - kh * 0.5, b.fx, b.fy, l * 0.07, w * 0.08);
        c.fill();
        c.fillStyle = '#4f7a3a'; c.beginPath(); stip(c, x + b.fx * l * 0.92, y + b.fy * l * 0.92 - kh * 0.2, T * 0.006); stip(c, x - b.fx * l * 0.92, y - b.fy * l * 0.92 - kh * 0.2, T * 0.005); c.fill();
      }
      if (this.nacht > 0.05) this.zetLicht(x, y - kh * 0.4, T * 0.04, WARM, 0.55);
    }
  }

  // Waar een binnenvaartschip nu vaart (wereld): this.ax, this.ay, de koers this.ahx, this.ahy en this.arich (1 met
  // de stroom mee, -1 ertegenin). Heen en weer langs zijn stuk rivier op de eigen klok; rechts houden. Op een
  // bevroren rivier ligt het aangemeerd aan de oever.
  aakStand(ak, ijs) {
    const rv = this.tl.rivieren[ak.ri], L = ak.se - ak.sa, p = rv.pts;
    const u = ak.fase + (this.klok * ak.v) / (2 * (L - 4));
    const s = ijs ? ak.sa + 2 + ak.j * 3.2 + hash(ak.zaad, 5) * 0.8 : ak.sa + 2 + tri(u) * (L - 4);
    const rich = ijs ? 1 : triRichting(u);
    let lo = ak.a, hi = ak.e;
    while (hi - lo > 1) { const md = (lo + hi) >> 1; if (rv.s[md] <= s) lo = md; else hi = md; }
    const d = rv.s[hi] - rv.s[lo] || 1, f = clamp((s - rv.s[lo]) / d, 0, 1);
    const wx = p[lo * 2] + (p[hi * 2] - p[lo * 2]) * f, wy = p[lo * 2 + 1] + (p[hi * 2 + 1] - p[lo * 2 + 1]) * f;
    let hx = (p[hi * 2] - p[lo * 2]) / d, hy = (p[hi * 2 + 1] - p[lo * 2 + 1]) / d;
    const hl = Math.hypot(hx, hy) || 1;
    hx = (hx / hl) * rich; hy = (hy / hl) * rich;
    const hw = (rv.br[lo] + 0.3) / 2, zij = ijs ? hw - 0.45 : 0.3;
    this.ax = wx - hy * zij; this.ay = wy + hx * zij; this.ahx = hx; this.ahy = hy; this.arich = rich;
  }

  tekenAken(c, a) {
    const T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, S = SCHUIN;
    let n = 0;
    c.globalAlpha = a;
    const ijs = this.ijs > 0.6;
    for (const ak of this.aken) {
      if (n >= PLAFOND.aken) break;
      this.aakStand(ak, ijs);
      const bx = this.ax, by = this.ay, hx = this.ahx, hy = this.ahy;
      if (!this.puntInBeeld(bx, by, 3)) continue;
      n++;
      const x = bx * sc + ox, y = by * sc + oy, l = 1.1 * sc, w = 0.24 * sc;
      // onder een brug door: de brug ligt al getekend (infra.js), dus het schip wordt daar weggeknipt
      const geknipt = this.knipBruggen(c, bx, by, 1.4);
      if (!ijs && z >= DREMPEL.boei - 0.5) {
        c.strokeStyle = 'rgba(235,245,248,0.45)'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
        for (const k of [-1, 1]) { c.moveTo(x - hx * l - hy * w * k, y - hy * l + hx * w * k); c.lineTo(x - hx * l * 2.6 - hy * w * k * 2.6, y - hy * l * 2.6 + hx * w * k * 2.6); }
        c.stroke();
      }
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); rechthoek(c, x + T * 0.006, y + T * 0.008, hx, hy, l, w); c.fill();
      c.fillStyle = ak.romp; c.beginPath(); rechthoek(c, x, y, hx, hy, l, w);
      c.moveTo(x + hx * l - hy * w, y + hy * l + hx * w); c.lineTo(x + hx * (l + w * 1.2), y + hy * (l + w * 1.2)); c.lineTo(x + hx * l + hy * w, y + hy * l - hx * w); c.closePath(); c.fill();
      c.fillStyle = this.sn && ijs ? '#e4e8ea' : ak.lading; c.beginPath(); rechthoek(c, x + hx * l * 0.12, y + hy * l * 0.12, hx, hy, l * 0.68, w * 0.72); c.fill();
      if (z >= DREMPEL.fijn) { c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.4, T * 0.0015); c.beginPath(); for (let k = -2; k <= 3; k++) { const cx = x + hx * l * (0.12 + k * 0.2), cy = y + hy * l * (0.12 + k * 0.2); c.moveTo(cx - hy * w * 0.72, cy + hx * w * 0.72); c.lineTo(cx + hy * w * 0.72, cy - hx * w * 0.72); } c.stroke(); }
      // stuurhut achterop
      const sx = x - hx * l * 0.82, sy = y - hy * l * 0.82, sh = T * 0.016;
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); rechthoek(c, sx + sh * S, sy + sh * S, hx, hy, l * 0.14, w * 0.7); c.fill();
      c.fillStyle = '#e9e6de'; c.beginPath(); rechthoek(c, sx, sy - sh, hx, hy, l * 0.14, w * 0.7); c.fill();
      if (z >= DREMPEL.fijn) { c.fillStyle = '#2f4152'; c.beginPath(); rechthoek(c, sx + hx * l * 0.1, sy + hy * l * 0.1 - sh, hx, hy, l * 0.03, w * 0.6); c.fill(); }
      if (geknipt) c.restore();
      if (this.nacht > 0.05) {
        this.zetLicht(sx, sy - sh * 1.4, Math.max(2, T * 0.025), WIT, 0.9);
        // (-hy, hx) is de rechterkant in de vaarrichting: groen aan stuurboord, rood aan bakboord
        this.zetLicht(x + hx * l - hy * w, y + hy * l + hx * w, Math.max(1.5, T * 0.018), GROEN, 0.8);
        this.zetLicht(x + hx * l + hy * w, y + hy * l - hx * w, Math.max(1.5, T * 0.018), ROOD, 0.8);
      }
    }
    this.n.aken = n;
  }

  // Knip de bruggen weg rond (x, y) (straal r): elke brug in de buurt wordt een gat in het tekengebied, apart geknipt
  // zodat overlappende brugstukken elkaar niet opheffen. Geeft true als er geknipt is (dan volgt c.restore()).
  knipBruggen(c, x, y, r) {
    const v = this.bruggen;
    if (!v || !v.n) return false;
    const d = v.data, sc = this.sc, ox = this.ox, oy = this.oy;
    let geknipt = false;
    for (let i = 0; i < v.n; i++) {
      const o = i * 5, ax = d[o], ay = d[o + 1], bx = d[o + 2], by = d[o + 3], hb = d[o + 4];
      const lx = bx - ax, ly = by - ay, ll = lx * lx + ly * ly || 1, t = clamp(((x - ax) * lx + (y - ay) * ly) / ll, 0, 1);
      if (Math.hypot(ax + lx * t - x, ay + ly * t - y) > hb + r) continue;
      if (!geknipt) { c.save(); geknipt = true; }
      const l = Math.sqrt(ll), nx = (-ly / l) * hb * sc, ny = (lx / l) * hb * sc;
      const pax = ax * sc + ox, pay = ay * sc + oy, pbx = bx * sc + ox, pby = by * sc + oy;
      c.beginPath(); c.rect(-10, -10, this.w + 20, this.h + 20);
      c.moveTo(pax + nx, pay + ny); c.lineTo(pbx + nx, pby + ny); c.lineTo(pbx - nx, pby - ny); c.lineTo(pax - nx, pay - ny); c.closePath();
      c.clip('evenodd');
    }
    return geknipt;
  }

  tekenStuwen(c, a) {
    const T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, nu = this.nu, S = SCHUIN;
    let n = 0;
    c.globalAlpha = a;
    for (const st of this.stuwen) {
      if (n >= PLAFOND.stuwen || !this.puntInBeeld(st.x, st.y, st.hw + 3)) continue;
      n++;
      const fx = st.fx, fy = st.fy, nx = -fy, ny = fx, hw = st.hw + 0.25, x = st.x * sc + ox, y = st.y * sc + oy;
      const P = (u, v) => { this.ex = x + (nx * u + fx * v) * sc; this.ey = y + (ny * u + fy * v) * sc; };
      // de sluis ligt aan één kant: twee muren langs de stroom, deuren aan beide kanten
      const k = st.sluis, u0 = k * hw, u1 = k * (hw - Math.min(1.1, hw * 0.45));
      // schuim onder de stuw (stroomafwaarts)
      if (z >= DREMPEL.fijn && this.ijs <= 0.6) {
        c.strokeStyle = 'rgba(240,248,250,0.6)'; c.lineWidth = Math.max(0.5, T * 0.004); c.setLineDash([T * 0.01, T * 0.012]); c.lineDashOffset = -nu / 60;
        c.beginPath();
        for (let i = 0; i < 4; i++) { const u = -k * hw + (u1 + k * hw) * ((i + 0.5) / 4); P(u, 0.3); const ax = this.ex, ay = this.ey; P(u, 1.6); c.moveTo(ax, ay); c.lineTo(this.ex, this.ey); }
        c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
      }
      // stuwbalk dwars over de rivier
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); P(-k * hw, -0.15); c.moveTo(this.ex + T * 0.01, this.ey + T * 0.012); P(u1, -0.15); c.lineTo(this.ex + T * 0.01, this.ey + T * 0.012); P(u1, 0.2); c.lineTo(this.ex + T * 0.01, this.ey + T * 0.012); P(-k * hw, 0.2); c.lineTo(this.ex + T * 0.01, this.ey + T * 0.012); c.closePath(); c.fill();
      c.fillStyle = '#a7a39a'; c.beginPath(); P(-k * hw, -0.15); c.moveTo(this.ex, this.ey); P(u1, -0.15); c.lineTo(this.ex, this.ey); P(u1, 0.2); c.lineTo(this.ex, this.ey); P(-k * hw, 0.2); c.lineTo(this.ex, this.ey); c.closePath(); c.fill();
      // pijlers met de schuiven ertussen
      c.fillStyle = '#4b4f52'; c.beginPath();
      for (let i = 0; i < 3; i++) { const u = -k * hw + (u1 + k * hw) * ((i + 0.5) / 3); P(u, 0.02); rechthoek(c, this.ex, this.ey, fx, fy, 0.12 * sc, 0.32 * sc * Math.abs(u1 + k * hw) / 3 / Math.max(0.5, hw)); }
      c.fill();
      c.fillStyle = '#d6d2c8'; c.beginPath();
      for (let i = 0; i <= 3; i++) { const u = -k * hw + (u1 + k * hw) * (i / 3); P(u, 0.02); stip(c, this.ex, this.ey - T * 0.012, Math.max(0.8, T * 0.008)); }
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = Math.max(0.6, T * 0.006); c.beginPath();
      for (let i = 0; i <= 3; i++) { const u = -k * hw + (u1 + k * hw) * (i / 3); P(u, 0.02); c.moveTo(this.ex, this.ey); c.lineTo(this.ex + T * 0.022 * S, this.ey + T * 0.022 * S); }
      c.stroke();
      // sluiskolk: twee muren, deuren aan beide einden
      c.strokeStyle = '#8f8a80'; c.lineWidth = Math.max(0.8, T * 0.008); c.beginPath();
      for (const u of [u0, u1]) { P(u, -1.6); c.moveTo(this.ex, this.ey); P(u, 1.6); c.lineTo(this.ex, this.ey); }
      c.stroke();
      c.strokeStyle = '#3a3d40'; c.lineWidth = Math.max(0.8, T * 0.007); c.beginPath();
      for (const v of [-1.5, 1.5]) { P(u0, v); c.moveTo(this.ex, this.ey); P(u1, v); c.lineTo(this.ex, this.ey); }
      c.stroke();
      if (this.nacht > 0.05) for (const v of [-1.5, 1.5]) { P(u1, v); this.zetLicht(this.ex, this.ey - T * 0.02, Math.max(2, T * 0.025), frac(nu / 8000 + st.zaad * 0.01) < 0.5 ? ROOD : GROEN, 0.9); }
    }
    this.n.stuwen = n;
  }

  // ---------- stuwdam ----------

  tekenDammen(c, a) {
    const T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, nu = this.nu;
    let n = 0;
    c.globalAlpha = a;
    const P = Math.min(this.P, 512), ijs = this.ijs > 0.5 ? 1 : 0;
    for (const d of this.dammen) {
      if (n >= PLAFOND.dammen || !this.inBeeld(d.x0, d.y0, d.x1, d.y1, 2)) continue;
      n++;
      const e = this.bak(`${d.sleutel}|${P}|${this.sn}|${ijs}`, d.sleutel, d.bw, d.bh, P, bakDam, d);
      if (e) this.plak(c, e, d.mx, d.my, 0, 0);
      // water over de overlaat en schuim in de kolk eronder
      if (z >= DREMPEL.fijn && !ijs && d.voorzicht) {
        const [ax, ay, kx, ky, bx, by] = d.dam;
        const x = (0.25 * ax + 0.5 * kx + 0.25 * bx) * sc + ox, y = (0.25 * ay + 0.5 * ky + 0.25 * by) * sc + oy, hoog = T * 0.05;
        c.strokeStyle = 'rgba(245,250,252,0.75)'; c.lineWidth = Math.max(0.5, T * 0.004); c.setLineDash([T * 0.008, T * 0.01]); c.lineDashOffset = -nu / 40;
        c.beginPath(); for (let k = -1; k <= 1; k++) { c.moveTo(x + k * T * 0.012, y); c.lineTo(x + k * T * 0.012, y + hoog); } c.stroke();
        c.setLineDash([]); c.lineDashOffset = 0;
        c.fillStyle = 'rgba(240,248,250,0.5)'; c.beginPath();
        for (let k = 0; k < 4; k++) { const f = frac(nu / 1400 + k * 0.25); stip(c, x + (k - 1.5) * T * 0.015, y + hoog + T * 0.01 + f * T * 0.02, T * 0.008 * (1 - f * 0.5)); }
        c.fill();
      }
      if (this.nacht > 0.05) {
        const [ax, ay, kx, ky, bx, by] = d.dam;
        for (let k = 0; k <= 4; k++) { const t = k / 4, x = (1 - t) * (1 - t) * ax + 2 * t * (1 - t) * kx + t * t * bx, y = (1 - t) * (1 - t) * ay + 2 * t * (1 - t) * ky + t * t * by; this.zetLicht(x * sc + ox, y * sc + oy - T * 0.02, Math.max(2, T * 0.025), WARM, 0.8); }
        this.zetLicht(d.centrale[0] * sc + ox, d.centrale[1] * sc + oy - T * 0.02, T * 0.05, WARM, 0.6);
      }
    }
    this.n.dammen = n;
  }

  // ---------- viskwekerijen ----------

  tekenViskwekerijen(c, a) {
    const T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, nu = this.nu;
    let n = 0;
    c.globalAlpha = a;
    const P = Math.min(this.P, 448);
    for (const v of this.viskwekerijen) {
      if (n >= PLAFOND.viskwekerijen || !this.inBeeld(v.x0, v.y0, v.x1, v.y1, 1)) continue;
      n++;
      const e = this.bak(`${v.sleutel}|${P}`, v.sleutel, 0.9, 0.9, P, bakViskweek, v);
      if (e) this.plak(c, e, v.x, v.y, 0, 0);
      // een vis die opspringt: een kringetje in een van de kooien
      if (z >= DREMPEL.spat) {
        const co = Math.cos(v.hoek), si = Math.sin(v.hoek), f = frac(nu / 2300 + hash(v.zaad, 7));
        const i = Math.floor(frac(nu / 2300 * 0.37 + hash(v.zaad, 8)) * v.rijen * v.kolommen), r0 = Math.floor(i / v.kolommen), k0 = i % v.kolommen;
        const u = (k0 - (v.kolommen - 1) / 2) * 0.17 + VK_U, w = (r0 - (v.rijen - 1) / 2) * 0.17;
        const x = v.x * sc + ox + (u * co - w * si) * T, y = v.y * sc + oy + (u * si + w * co) * T;
        c.strokeStyle = `rgba(235,245,248,${(0.6 * (1 - f)).toFixed(3)})`; c.lineWidth = Math.max(0.4, T * 0.002); c.beginPath(); c.ellipse(x, y, T * 0.035 * f + 0.5, T * 0.025 * f + 0.4, 0, 0, TAU); c.stroke();
      }
      if (this.nacht > 0.05) { const co = Math.cos(v.hoek), si = Math.sin(v.hoek), u = 0.17 * (v.kolommen - 1) / 2 + 0.26 + VK_U; this.zetLicht(v.x * sc + ox + u * co * T, v.y * sc + oy + u * si * T - T * 0.04, T * 0.04, WARM, 0.7); }
    }
    this.n.viskwekerijen = n;
  }

  // ---------- windparken ----------

  tekenWindparken(c, a) {
    const B = this.turbines, nt = B.length / 4, T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, nu = this.nu, S = SCHUIN;
    if (!nt) return;
    const zicht = this.tbZicht ??= new Int32Array(PLAFOND.turbines);
    let m = 0;
    for (let i = 0; i < nt && m < PLAFOND.turbines; i++) if (this.puntInBeeld(B[i * 4], B[i * 4 + 1], this.geo.T * 0.4)) zicht[m++] = i;
    this.n.turbines = m;
    if (!m) return;
    let parken = 0, vorig = -1;
    for (let j = 0; j < m; j++) { const p = B[zicht[j] * 4 + 3]; if (p !== vorig) { parken++; vorig = p; } }
    this.n.windparken = Math.min(parken, PLAFOND.windparken);
    c.globalAlpha = a;
    const Ht = T * 0.3, R = T * 0.13, h = this.wd.hoek, px = -Math.sin(h), py = Math.cos(h), dx = Math.cos(h), dy = Math.sin(h);
    const rot = (nu / 1000) * (0.8 + 1.6 * this.wd.kracht);
    const fijn = z >= 6;
    // schaduwen van mast en wieken op het water
    c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = Math.max(0.6, T * 0.006); c.beginPath();
    for (let j = 0; j < m; j++) {
      const o = zicht[j] * 4, x = B[o] * sc + ox, y = B[o + 1] * sc + oy;
      c.moveTo(x, y); c.lineTo(x + Ht * S, y + Ht * S);
      if (fijn) for (let k = 0; k < 3; k++) {
        const f = rot + B[o + 2] * TAU + (k * TAU) / 3, cf = Math.cos(f), hh = Ht + R * Math.sin(f);
        c.moveTo(x + Ht * S, y + Ht * S); c.lineTo(x + px * R * cf + hh * S, y + py * R * cf + hh * S);
      }
    }
    c.stroke();
    // voet in het water
    if (fijn) { c.fillStyle = '#d9b43a'; c.beginPath(); for (let j = 0; j < m; j++) { const o = zicht[j] * 4; stip(c, B[o] * sc + ox, B[o + 1] * sc + oy, Math.max(0.8, T * 0.007)); } c.fill(); }
    // mast
    c.strokeStyle = '#eceae4'; c.lineWidth = Math.max(0.8, T * 0.007); c.beginPath();
    for (let j = 0; j < m; j++) { const o = zicht[j] * 4, x = B[o] * sc + ox, y = B[o + 1] * sc + oy; c.moveTo(x, y); c.lineTo(x, y - Ht); }
    c.stroke();
    if (fijn) {
      c.strokeStyle = 'rgba(120,120,116,0.5)'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
      for (let j = 0; j < m; j++) { const o = zicht[j] * 4, x = B[o] * sc + ox + T * 0.002, y = B[o + 1] * sc + oy; c.moveTo(x, y); c.lineTo(x, y - Ht); }
      c.stroke();
      // gondel, in de wind gedraaid
      c.fillStyle = '#e4e2dc'; c.beginPath();
      for (let j = 0; j < m; j++) { const o = zicht[j] * 4, x = B[o] * sc + ox - dx * T * 0.012, y = B[o + 1] * sc + oy - Ht - dy * T * 0.012; rechthoek(c, x, y, dx, dy, T * 0.016, T * 0.006); }
      c.fill();
    }
    // wieken: het rotorvlak staat dwars op de wind
    c.strokeStyle = '#f4f3ef'; c.lineWidth = Math.max(0.6, T * 0.005); c.beginPath();
    for (let j = 0; j < m; j++) {
      const o = zicht[j] * 4, x = B[o] * sc + ox, y = B[o + 1] * sc + oy - Ht;
      for (let k = 0; k < 3; k++) { const f = rot + B[o + 2] * TAU + (k * TAU) / 3; c.moveTo(x, y); c.lineTo(x + px * R * Math.cos(f), y + py * R * Math.cos(f) - R * Math.sin(f)); }
    }
    c.stroke();
    if (this.nacht > 0.05 && frac(nu / 2000) < 0.5) for (let j = 0; j < m; j++) { const o = zicht[j] * 4; this.zetLicht(B[o] * sc + ox, B[o + 1] * sc + oy - Ht - T * 0.006, Math.max(2, T * 0.03), ROOD, 0.9); }
  }

  // ---------- booreilanden ----------

  tekenBooreilanden(c, a) {
    const T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, nu = this.nu;
    let n = 0;
    c.globalAlpha = a;
    for (const b of this.booreilanden) {
      if (n >= PLAFOND.booreilanden || !this.inBeeld(b.x0, b.y0, b.x1, b.y1, 1)) continue;
      n++;
      const e = this.bak(`${b.sleutel}|${this.P}`, b.sleutel, 0.7, 0.7, this.P, bakBooreiland, b);
      if (e) this.plak(c, e, b.x, b.y, -0.08, 0.14);
      // de fakkel: een flakkerende vlam aan het eind van de arm, rook met de wind mee
      const fx = b.x * sc + ox + 0.24 * T, fy = b.y * sc + oy - 0.255 * T;
      const f = 0.85 + 0.2 * Math.sin(nu / 70 + b.zaad) + 0.1 * Math.sin(nu / 31 + b.zaad * 3);
      if (z >= DREMPEL.fijn) {
        const wx = Math.cos(this.wd.hoek), wy = Math.sin(this.wd.hoek);
        c.fillStyle = 'rgba(70,66,62,0.22)'; c.beginPath();
        for (let k = 0; k < 4; k++) { const p = frac(nu / 3000 + k * 0.25); stip(c, fx + wx * p * T * 0.25, fy - T * 0.03 - p * T * 0.08 + wy * p * T * 0.12, T * (0.012 + p * 0.03)); }
        c.fill();
      }
      c.fillStyle = 'rgba(255,140,40,0.75)'; c.beginPath(); c.ellipse(fx, fy - T * 0.012 * f, T * 0.012 * f, T * 0.022 * f, 0, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,220,120,0.9)'; c.beginPath(); c.ellipse(fx, fy - T * 0.008 * f, T * 0.006 * f, T * 0.012 * f, 0, 0, TAU); c.fill();
      this.zetLicht(fx, fy - T * 0.012, T * 0.09 * f, AMBER, this.nacht > 0.05 ? 1 : 0.35);
      if (this.nacht > 0.05) {
        // het dek loopt (ten opzichte van het anker) van -0,11 tot +0,11 en van -0,155 tot 0; de boortoren staat op
        // +0,0385 en zijn top op -0,291
        for (const [u, v] of BOOR_LICHT) this.zetLicht(b.x * sc + ox + u * T, b.y * sc + oy + v * T, T * 0.035, WARM, 0.7);
        this.zetLicht(b.x * sc + ox + 0.0385 * T, b.y * sc + oy - 0.298 * T, Math.max(2, T * 0.025), ROOD, frac(nu / 1800) < 0.5 ? 1 : 0.3);
      }
    }
    this.n.booreilanden = n;
  }

  // ---------- vuurtorens ----------

  tekenVuurtorens(c, a) {
    const T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, nu = this.nu;
    let n = 0;
    c.globalAlpha = a;
    const licht = this.nacht > 0.05 || (this.wr?.mist ?? 0) > 0.3, bereik = Math.min(900, T * 2.6);
    for (const v of this.vuurtorens) {
      // 's nachts zwaait de bundel ook vanaf een toren net buiten beeld over het scherm
      const dichtbij = n < PLAFOND.vuurtorens && this.puntInBeeld(v.x, v.y, this.geo.T * 0.6);
      if (!dichtbij && !(licht && this.puntInBeeld(v.x, v.y, bereik / sc))) continue;
      if (dichtbij) {
        n++;
        const e = this.bak(`${v.sleutel}|${this.P}|${this.sn}`, v.sleutel, 0.7, 0.86, this.P, bakVuurtoren, v);
        if (e) this.plak(c, e, v.x, v.y, -0.1, 0.16);
      }
      const lx = v.x * sc + ox, ly = v.y * sc + oy - 0.428 * T;
      if (licht) {
        const hk = (nu / 1000) * 0.8 + hash(v.zaad, 1) * TAU;
        // de bundel wijst naar de kijker (zuid): even een felle flits in de lantaarn
        const flits = Math.pow(Math.max(0, Math.sin(hk)), 8) + Math.pow(Math.max(0, -Math.sin(hk)), 8);
        this.zetLicht(lx, ly, T * (0.06 + 0.1 * flits), WIT, 0.7 + 0.3 * flits);
        if (this.nBundel < PLAFOND.vuurtorens) { const o = this.nBundel++ * 4; this.bundels[o] = lx; this.bundels[o + 1] = ly; this.bundels[o + 2] = hk; this.bundels[o + 3] = bereik; }
      }
    }
    this.n.vuurtorens = n;
  }

  // Na de nachtlaag: alle lichtjes als gloed, en de draaiende bundels van de vuurtorens.
  tekenLichten(c, view, sc, nu) {
    const nacht = view.nacht ?? 0, mist = this.wr?.mist ?? 0;
    const k = Math.max(nacht, mist * 0.5) * (this.vervaag ?? 1);
    if (k < 0.05 || !this.gloed) return;
    if (!this.nLicht && !this.nBundel) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    // twee bundels rug aan rug die rondgaan: de wig begint smal bij de lamp en dooft naar buiten uit
    if (this.bundel) for (let i = 0; i < this.nBundel; i++) {
      const o = i * 4, x = this.bundels[o], y = this.bundels[o + 1], hk = this.bundels[o + 2], L = this.bundels[o + 3], br = L * 0.14;
      c.globalAlpha = k * 0.5;
      c.save();
      c.translate(x, y);
      c.rotate(hk);
      c.drawImage(this.bundel, 0, -br / 2, L, br);
      c.rotate(Math.PI);
      c.drawImage(this.bundel, 0, -br / 2, L, br);
      c.restore();
    }
    const b = this.licht;
    for (let i = 0; i < this.nLicht; i++) {
      const o = i * LICHT, soort = b[o + 3], r = b[o + 2];
      const sprite = soort === WARM && view.lichtSprite ? view.lichtSprite : this.gloed[soort];
      if (!sprite) continue;
      c.globalAlpha = Math.min(1, k * b[o + 4]);
      c.drawImage(sprite, b[o] - r, b[o + 1] - r, r * 2, r * 2);
    }
    c.restore();
    void sc; void nu;
  }

  // ---------- pakket D: strand, getij, duinen, dijken en havens van dichtbij ----------

  // Weer en seizoen voor het strand, per beeld: bez is hoe vol het strand is (0 leeg .. 1 een warme zonnige
  // zomerdag), seizoenStrand of de huisjes en stoelen er staan (in de winter zijn ze weggehaald).
  strandWeer() {
    const sz = this.sz, wr = this.wr;
    this.dagL = 1 - smooth(0.3, 0.7, this.nacht);
    this.warm = smooth(0.62, 0.12, sz.koud);
    this.zon = smooth(0.95, 0.4, wr.wolken) * (1 - smooth(0.02, 0.2, wr.regen + wr.sneeuw)) * (1 - clamp(+wr.onweer || 0, 0, 1));
    // in oorlog (openbaar: state.oorlogen) blijven de meeste mensen van het strand weg
    this.oorlogHier = this.oorlogInBeeld();
    this.bez = this.dagL * this.warm * this.zon * (this.oorlogHier ? 0.25 : 1);
    this.seizoenStrand = clamp(sz.zomer + sz.lente * 0.6 + sz.herfst * 0.3, 0, 1);
    this.dagNr = Math.floor(this.state.dag) | 0;
    this.windX = Math.cos(this.wd.hoek); this.windY = Math.sin(this.wd.hoek);
  }

  // Is een land in beeld in oorlog? Negen punten over het beeld; zelfde partijregel als hemel.js.
  oorlogInBeeld() {
    const s = this.state, O = s.oorlogen;
    if (!O || !O.length) return false;
    for (let q = 0; q < 9; q++) {
      const x = this.wx0 + ((q % 3) + 0.5) * (this.wx1 - this.wx0) / 3, y = this.wy0 + (Math.floor(q / 3) + 0.5) * (this.wy1 - this.wy0) / 3;
      const e = this.eigenaar[clamp(Math.floor(y), 0, H - 1) * W + clamp(Math.floor(x), 0, W - 1)], l = e >= 0 ? s.landen[e] : null;
      if (!l) continue;
      const p = l.alignment && l.alignment !== 'zwevend' ? l.alignment : `land:${l.idx}`;
      for (let i = 0; i < O.length; i++) if (O[i].a === p || O[i].b === p) return true;
    }
    return false;
  }

  // De strandpunten in beeld, in stukken (runs) langs de ketens; uitgezoomd elk tweede punt.
  strandZicht() {
    const A = this.wereld.strand, zp = this.zp ??= new Int32Array(PLAFOND.strandpunten), zr = this.zr ??= new Int32Array(PLAFOND.getij + 1);
    const stap = this.zoom < 11 ? 2 : 1;
    let m = 0, nr = 0;
    for (let k = 0; k < A.ks.length && m < zp.length; k++) {
      if (!this.inBeeld(A.kader[k * 4], A.kader[k * 4 + 1], A.kader[k * 4 + 2], A.kader[k * 4 + 3], 0)) continue;
      let open = false;
      for (let j = 0; j < A.kn[k] && m < zp.length; j += stap) {
        const i = A.ks[k] + j;
        if (!this.puntInBeeld(A.x[i], A.y[i], 7)) { open = false; continue; }
        if (!open) { if (nr >= PLAFOND.getij) break; zr[nr++] = m; open = true; }
        zp[m++] = i;
      }
    }
    zr[nr] = m;
    this.nZp = m; this.nZr = nr;
    this.n.strandpunten = m;
  }

  // Eb en vloed (alleen beeld): de waterlijn schuift langzaam op en neer met de klok. Bij eb glinstert het natte
  // zand, bij vloed ligt er een strook ondiep water over het strand; de schuimrand volgt de lijn van dat moment.
  tekenGetij(c, a) {
    const A = this.wereld.strand, zp = this.zp, zr = this.zr, nr = this.nZr, sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, tij = this.tij, nu = this.nu, z = this.zoom;
    if (!nr) return;
    let runs = 0;
    c.globalAlpha = a * Math.min(1, Math.abs(tij) / 0.3);
    c.fillStyle = tij < 0 ? 'rgba(128,112,80,0.36)' : 'rgba(96,150,168,0.45)';
    c.beginPath();
    for (let r = 0; r < nr; r++) {
      const b0 = zr[r], b1 = zr[r + 1];
      if (b1 - b0 < 2) continue;
      runs++;
      for (let j = b0; j < b1; j++) { const i = zp[j], X = A.x[i] * sc + ox, Y = A.y[i] * sc + oy; if (j === b0) c.moveTo(X, Y); else c.lineTo(X, Y); }
      for (let j = b1 - 1; j >= b0; j--) { const i = zp[j]; c.lineTo((A.x[i] - A.nx[i] * tij) * sc + ox, (A.y[i] - A.ny[i] * tij) * sc + oy); }
      c.closePath();
    }
    c.fill();
    this.n.getij = runs;
    // glinsteringen op het natte zand bij eb
    if (tij < -0.1 && z >= DREMPEL.klein) {
      c.globalAlpha = a * smooth(-0.1, -0.3, tij);
      c.fillStyle = 'rgba(255,255,250,0.85)'; c.beginPath();
      const g = Math.max(0.8, T * 0.0028);
      for (let j = 0; j < zr[nr]; j++) {
        const i = zp[j];
        if (frac(nu / 900 + hash(i, 5) * 7) > 0.2) continue;
        const d = tij * (0.15 + 0.7 * hash(i, 6)), u = (hash(i, 7) - 0.5) * 1.2;
        c.rect((A.x[i] - A.nx[i] * d - A.ny[i] * u) * sc + ox - g / 2, (A.y[i] - A.ny[i] * d + A.nx[i] * u) * sc + oy - g / 2, g, g);
      }
      c.fill();
    }
    // de schuimrand op de waterlijn van nu, en daarachter losse vlokken zeeschuim
    c.globalAlpha = a;
    c.strokeStyle = 'rgba(250,252,250,0.78)'; c.lineWidth = Math.max(0.6, T * 0.0035); c.lineCap = 'round';
    c.beginPath();
    for (let r = 0; r < nr; r++) {
      const b0 = zr[r], b1 = zr[r + 1];
      if (b1 - b0 < 2) continue;
      for (let j = b0; j < b1; j++) {
        const i = zp[j], d = tij + 0.04 * Math.sin(nu / 700 + i * 0.9);
        const X = (A.x[i] - A.nx[i] * d) * sc + ox, Y = (A.y[i] - A.ny[i] * d) * sc + oy;
        if (j === b0) c.moveTo(X, Y); else c.lineTo(X, Y);
      }
    }
    c.stroke();
    if (z >= DREMPEL.klein) {
      c.fillStyle = 'rgba(248,250,246,0.6)'; c.beginPath();
      const r0 = Math.max(0.6, T * 0.0032);
      for (let j = 0; j < zr[nr]; j++) {
        const i = zp[j];
        if (hash(i, 8) > 0.45) continue;
        const d = tij - 0.12 - 0.35 * frac(hash(i, 9) + nu / 6000), u = (hash(i, 10) - 0.5) * 1.3;
        stip(c, (A.x[i] - A.nx[i] * d - A.ny[i] * u) * sc + ox, (A.y[i] - A.ny[i] * d + A.nx[i] * u) * sc + oy, r0 * (0.6 + hash(i, 11)));
      }
      c.fill();
    }
    c.lineCap = 'butt';
  }

  // Vloedlijn met wier en schelpen, en wat de zee aanspoelt (zeesterren en kwallen) waar het nu droog ligt.
  tekenVloedlijn(c, a) {
    const A = this.wereld.strand, zp = this.zp, zr = this.zr, nr = this.nZr, sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, tij = this.tij, z = this.zoom, isDijk = this.isDijk;
    if (!nr) return;
    let nv = 0;
    c.globalAlpha = a;
    c.strokeStyle = this.sn ? 'rgba(90,96,80,0.4)' : 'rgba(78,84,48,0.62)'; c.lineWidth = Math.max(0.5, T * 0.0026); c.lineCap = 'round';
    c.beginPath();
    for (let r = 0; r < nr; r++) {
      let open = false;
      for (let j = zr[r]; j < zr[r + 1]; j++) {
        const i = zp[j];
        if (isDijk[i] || nv >= PLAFOND.vloedlijn) { open = false; continue; }
        nv++;
        const d = 0.8 + 0.07 * Math.sin(i * 1.7), X = (A.x[i] - A.nx[i] * d) * sc + ox, Y = (A.y[i] - A.ny[i] * d) * sc + oy;
        if (open) c.lineTo(X, Y); else { c.moveTo(X, Y); open = true; }
      }
    }
    c.stroke();
    this.n.vloedlijn = nv;
    if (z >= DREMPEL.kasteel) {
      c.fillStyle = '#f2ebe0'; c.beginPath();
      const g = Math.max(0.6, T * 0.0022);
      for (let j = 0; j < zr[nr]; j++) {
        const i = zp[j];
        if (isDijk[i]) continue;
        for (let s = 0; s < 2; s++) { const d = 0.74 + hash(i, s, 12) * 0.16, u = (hash(i, s, 13) - 0.5) * 1.4; c.rect((A.x[i] - A.nx[i] * d - A.ny[i] * u) * sc + ox, (A.y[i] - A.ny[i] * d + A.nx[i] * u) * sc + oy, g, g * 0.8); }
      }
      c.fill();
    }
    // aangespoeld: alleen waar het water nu niet staat
    if (z < DREMPEL.aangespoeld - 0.5) return;
    let na = 0;
    const zs = this.zsZicht ??= new Int32Array(PLAFOND.aangespoeld * 2);
    for (let j = 0; j < zr[nr] && na < PLAFOND.aangespoeld; j++) {
      const i = zp[j];
      if (isDijk[i] || hash(i, 14) > 0.1) continue;
      const d = 0.1 + 0.4 * hash(i, 15);
      if (d < tij + 0.06) continue;
      zs[na * 2] = i; zs[na * 2 + 1] = hash(i, 16) < 0.55 ? 0 : 1; na++;
    }
    this.n.aangespoeld = na;
    if (!na) return;
    const R = T * 0.0055;
    c.strokeStyle = '#e0763a'; c.lineWidth = Math.max(0.6, T * 0.0024); c.beginPath();
    for (let q = 0; q < na; q++) {
      if (zs[q * 2 + 1]) continue;
      const i = zs[q * 2], d = 0.1 + 0.4 * hash(i, 15), X = (A.x[i] - A.nx[i] * d) * sc + ox, Y = (A.y[i] - A.ny[i] * d) * sc + oy, h0 = hash(i, 17) * TAU;
      for (let s = 0; s < 5; s++) { const h = h0 + (s * TAU) / 5; c.moveTo(X, Y); c.lineTo(X + Math.cos(h) * R, Y + Math.sin(h) * R * 0.8); }
    }
    c.stroke();
    c.fillStyle = 'rgba(196,222,236,0.6)'; c.beginPath();
    for (let q = 0; q < na; q++) { if (!zs[q * 2 + 1]) continue; const i = zs[q * 2], d = 0.1 + 0.4 * hash(i, 15); stip(c, (A.x[i] - A.nx[i] * d) * sc + ox, (A.y[i] - A.ny[i] * d) * sc + oy, R * 1.1); }
    c.fill();
    c.strokeStyle = 'rgba(150,120,190,0.55)'; c.lineWidth = Math.max(0.5, T * 0.0014); c.beginPath();
    for (let q = 0; q < na; q++) { if (!zs[q * 2 + 1]) continue; const i = zs[q * 2], d = 0.1 + 0.4 * hash(i, 15), X = (A.x[i] - A.nx[i] * d) * sc + ox, Y = (A.y[i] - A.ny[i] * d) * sc + oy; c.moveTo(X + R * 0.5, Y); c.arc(X, Y, R * 0.5, 0, TAU); }
    c.stroke();
    c.lineCap = 'butt';
  }

  // Dijken op laag land: basalt aan de zeekant, grastaluds die in het licht of in de schaduw liggen, een pad over
  // de kruin, een sloot aan de teen, en schapen op de helling.
  tekenDijken(c, a) {
    const A = this.wereld.strand, sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, z = this.zoom, nu = this.nu, S = SCHUIN;
    let n = 0, ns = 0;
    const stap = z < 10 ? 2 : 1, h = 0.45 * sc; // kruinhoogte op het scherm
    c.globalAlpha = a;
    // banden: van d, tot d, hoogte bij van, hoogte bij tot (fractie van h)
    const band = (i0, i1, d0, d1, h0, h1) => {
      for (let i = i0; i <= i1; i += stap) { const X = (A.x[i] - A.nx[i] * d0) * sc + ox, Y = (A.y[i] - A.ny[i] * d0) * sc + oy - h0 * h; if (i === i0) c.moveTo(X, Y); else c.lineTo(X, Y); }
      const e = i0 + Math.floor((i1 - i0) / stap) * stap;
      for (let i = e; i >= i0; i -= stap) c.lineTo((A.x[i] - A.nx[i] * d1) * sc + ox, (A.y[i] - A.ny[i] * d1) * sc + oy - h1 * h);
      c.closePath();
    };
    for (const dk of this.dijken) {
      if (n >= PLAFOND.dijken || !this.inBeeld(dk.x0, dk.y0, dk.x1, dk.y1, 1)) continue;
      n++;
      const q = (dk.i0 + dk.i1) >> 1, licht = A.nx[q] * NWX + A.ny[q] * NWY; // > 0: de zeekant kijkt naar de zon
      const gras = this.sn ? ['#eef1f2', '#dfe4e7', '#cdd4d9'] : ['#8fb162', '#76984f', '#5d7d40'];
      c.fillStyle = this.sn ? '#c9cfd3' : '#4a5057'; c.beginPath(); band(dk.i0, dk.i1, 0.25, 0.9, 0, 0.2); c.fill();
      c.fillStyle = gras[licht > 0.3 ? 0 : licht > -0.3 ? 1 : 2]; c.beginPath(); band(dk.i0, dk.i1, 0.9, 1.55, 0.2, 1); c.fill();
      c.fillStyle = gras[licht < -0.3 ? 0 : licht < 0.3 ? 1 : 2]; c.beginPath(); band(dk.i0, dk.i1, 1.85, 2.75, 1, 0); c.fill();
      c.fillStyle = this.sn ? '#f2f4f5' : '#bdb59f'; c.beginPath(); band(dk.i0, dk.i1, 1.55, 1.85, 1, 1); c.fill();
      if (z >= DREMPEL.fijn + 2) {
        // stenen in het basalt en de sloot langs de teen
        c.strokeStyle = 'rgba(20,24,28,0.35)'; c.lineWidth = Math.max(0.4, T * 0.0012); c.beginPath();
        for (let i = dk.i0; i <= dk.i1; i++) for (let s = 0; s < 3; s++) { const d = 0.35 + s * 0.18, X = (A.x[i] - A.nx[i] * d) * sc + ox, Y = (A.y[i] - A.ny[i] * d) * sc + oy - h * 0.06 * s; c.moveTo(X - A.ny[i] * T * 0.004, Y + A.nx[i] * T * 0.004); c.lineTo(X + A.ny[i] * T * 0.004, Y - A.nx[i] * T * 0.004); }
        c.stroke();
        c.strokeStyle = this.ijs > 0.5 ? '#cfe0e8' : '#5d808c'; c.lineWidth = Math.max(0.6, T * 0.003); c.beginPath();
        for (let i = dk.i0; i <= dk.i1; i += stap) { const X = (A.x[i] - A.nx[i] * 2.95) * sc + ox, Y = (A.y[i] - A.ny[i] * 2.95) * sc + oy; if (i === dk.i0) c.moveTo(X, Y); else c.lineTo(X, Y); }
        c.stroke();
      }
      // schapen op de helling (traag grazend)
      if (z >= DREMPEL.schaap - 0.5 && !this.sn) {
        const B = this.schapen, r = Math.max(0.7, T * 0.0042);
        c.fillStyle = 'rgba(0,0,0,0.18)'; c.beginPath();
        const s0 = ns;
        for (let j = 0; j < B.length && ns < PLAFOND.schapen; j += 3) {
          const i = B[j];
          if (i < dk.i0 || i > dk.i1) continue;
          ns++;
          const d = B[j + 1], zq = B[j + 2], u = 0.3 * Math.sin(nu / 9000 + hash(zq, 4) * TAU);
          const hh = d < 1.7 ? (d - 0.9) / 0.65 : (2.75 - d) / 0.9;
          const X = (A.x[i] - A.nx[i] * d - A.ny[i] * u) * sc + ox, Y = (A.y[i] - A.ny[i] * d + A.nx[i] * u) * sc + oy - h * hh;
          c.rect(X - r * 0.6, Y - r * 0.2, r * (1.6 + S), r * 0.7);
        }
        c.fill();
        c.fillStyle = '#f1efe6'; c.beginPath();
        let k = 0;
        for (let j = 0; j < B.length && k < ns - s0; j += 3) {
          const i = B[j];
          if (i < dk.i0 || i > dk.i1) continue;
          k++;
          const d = B[j + 1], zq = B[j + 2], u = 0.3 * Math.sin(nu / 9000 + hash(zq, 4) * TAU);
          const hh = d < 1.7 ? (d - 0.9) / 0.65 : (2.75 - d) / 0.9;
          const X = (A.x[i] - A.nx[i] * d - A.ny[i] * u) * sc + ox, Y = (A.y[i] - A.ny[i] * d + A.nx[i] * u) * sc + oy - h * hh;
          c.rect(X - r, Y - r * 0.9, r * 2, r * 1.2);
        }
        c.fill();
        if (z >= DREMPEL.klein) {
          c.fillStyle = '#2b2826'; c.beginPath();
          k = 0;
          for (let j = 0; j < B.length && k < ns - s0; j += 3) {
            const i = B[j];
            if (i < dk.i0 || i > dk.i1) continue;
            k++;
            const d = B[j + 1], zq = B[j + 2], u = 0.3 * Math.sin(nu / 9000 + hash(zq, 4) * TAU), kant = hash(zq, 5) < 0.5 ? -1 : 1;
            const hh = d < 1.7 ? (d - 0.9) / 0.65 : (2.75 - d) / 0.9, graas = Math.sin(nu / 1300 + zq) > 0.2 ? r * 0.35 : 0;
            const X = (A.x[i] - A.nx[i] * d - A.ny[i] * u) * sc + ox, Y = (A.y[i] - A.ny[i] * d + A.nx[i] * u) * sc + oy - h * hh;
            c.rect(X + kant * r * 1.05 - r * 0.35, Y - r * 0.85 + graas, r * 0.7, r * 0.6);
          }
          c.fill();
        }
      }
    }
    this.n.dijken = n; this.n.schapen = ns;
  }

  // Zandbanken die bij eb droogvallen, met zeehonden erop; bij vloed alleen hun koppen in het water.
  tekenZandbanken(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, z = this.zoom, tij = this.tij, nu = this.nu;
    const droog = smooth(-0.05, -0.4, tij);
    let n = 0, nz = 0;
    for (const b of this.zandbanken) {
      if (n >= PLAFOND.zandbanken || !this.puntInBeeld(b.x, b.y, b.rx + 2)) continue;
      n++;
      const X = b.x * sc + ox, Y = b.y * sc + oy, rot = Math.atan2(b.nx, -b.ny), rx = b.rx * sc, ry = b.ry * sc;
      c.globalAlpha = a;
      c.fillStyle = 'rgba(206,222,196,0.22)'; c.beginPath(); c.ellipse(X, Y, rx * 1.15, ry * 1.25, rot, 0, TAU); c.fill();
      if (droog > 0.02) {
        const f = 0.5 + 0.5 * droog;
        c.globalAlpha = a * droog;
        c.fillStyle = '#b9a77c'; c.beginPath(); c.ellipse(X, Y, rx * f, ry * f, rot, 0, TAU); c.fill();
        c.fillStyle = this.sn ? '#e9ecec' : '#dccb9c'; c.beginPath(); c.ellipse(X - ry * 0.12, Y - ry * 0.15, rx * f * 0.86, ry * f * 0.7, rot, 0, TAU); c.fill();
        if (z >= DREMPEL.klein) { c.strokeStyle = 'rgba(250,252,250,0.6)'; c.lineWidth = Math.max(0.5, T * 0.0025); c.beginPath(); c.ellipse(X, Y, rx * f * 1.04, ry * f * 1.1, rot, 0, TAU); c.stroke(); }
      }
      if (z < DREMPEL.zeehond - 0.5) continue;
      c.globalAlpha = a * smooth(DREMPEL.zeehond - 0.5, DREMPEL.zeehond + 0.3, z);
      const N = 3 + Math.floor(hash(b.zaad, 1) * 5), tx = -b.ny, ty = b.nx;
      for (let k = 0; k < N && nz < PLAFOND.bankzeehonden; k++) {
        const u = (hash(b.zaad, k, 2) - 0.5) * 1.3 * b.rx, v = (hash(b.zaad, k, 3) - 0.5) * 0.8 * b.ry;
        const sx = (b.x + tx * u + b.nx * v) * sc + ox, sy = (b.y + ty * u + b.ny * v) * sc + oy;
        nz++;
        if (droog > 0.55) this.zeehond(c, sx, sy, hash(b.zaad, k, 4) * TAU, b.zaad + k * 17);
        else {
          // alleen de kop boven water, die af en toe onderduikt
          if (frac(nu / 8000 + hash(b.zaad, k, 5)) > 0.75) continue;
          const kx = sx + (b.nx * 1.4 + tx * 0.2 * Math.sin(nu / 3000 + k)) * sc, ky = sy + (b.ny * 1.4 + ty * 0.2 * Math.sin(nu / 3000 + k)) * sc;
          c.strokeStyle = 'rgba(240,248,252,0.5)'; c.lineWidth = Math.max(0.5, T * 0.0016); c.beginPath(); c.moveTo(kx + T * 0.008, ky); c.arc(kx, ky, T * 0.008, 0, TAU); c.stroke();
          c.fillStyle = ZEEHOND[k % ZEEHOND.length]; c.beginPath(); stip(c, kx, ky - T * 0.002, T * 0.0045); c.fill();
        }
      }
    }
    this.n.zandbanken = n; this.n.bankzeehonden = nz;
  }

  // ---------- mensen en honden: eerst verzamelen, dan per kleur in één keer ----------

  zetMens(X, Y, hx, hy, houding, kleding, huid, fase) {
    if (this.nMens >= PLAFOND.mensen || !this.opScherm(X, Y, 10)) return;
    const o = this.nMens++ * MENS, b = this.mens;
    b[o] = X; b[o + 1] = Y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = houding; b[o + 5] = kleding; b[o + 6] = huid; b[o + 7] = fase;
  }

  zetHond(X, Y, hx, hy, vacht, nat) {
    if (this.nHond >= PLAFOND.honden || !this.opScherm(X, Y, 10)) return;
    const o = this.nHond++ * HOND, b = this.hond;
    b[o] = X; b[o + 1] = Y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = vacht; b[o + 5] = nat;
  }

  tekenMensen(c) {
    const b = this.mens, n = this.nMens, T = this.T, S = SCHUIN;
    this.n.mensen = n;
    if (n) {
      const lw = T * 0.0062, lh = T * 0.016, hr = T * 0.0036;
      c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * MENS, hd = b[o + 4];
        if (hd === STAAND || hd === KIND) { const f = hd === KIND ? 0.7 : 1; c.rect(b[o], b[o + 1] - lw * 0.25, lh * S * f + lw * 0.4, lw * 0.5); }
      }
      c.fill();
      for (let k = 0; k < KLEDING.length; k++) {
        let open = false;
        for (let i = 0; i < n; i++) {
          const o = i * MENS;
          if (b[o + 5] !== k) continue;
          if (!open) { c.beginPath(); open = true; }
          const X = b[o], Y = b[o + 1], hd = b[o + 4];
          if (hd === STAAND || hd === KIND) { const f = hd === KIND ? 0.68 : 1, bob = Math.abs(Math.sin(b[o + 7])) * T * 0.0012; c.rect(X - lw * f * 0.5, Y - lh * f - bob, lw * f, lh * f * 0.62); }
          else if (hd === ZITTEND) c.rect(X - lw * 0.55, Y - lh * 0.58, lw * 1.1, lh * 0.5);
          else if (hd === LIGGEND) rechthoek(c, X, Y, b[o + 2], b[o + 3], lh * 0.42, lw * 0.55);
        }
        if (open) { c.fillStyle = KLEDING[k]; c.fill(); }
      }
      // benen en armen in huidskleur, dan de hoofden
      for (let k = 0; k < HUID.length; k++) {
        let open = false;
        for (let i = 0; i < n; i++) {
          const o = i * MENS;
          if (b[o + 6] !== k) continue;
          if (!open) { c.beginPath(); open = true; }
          const X = b[o], Y = b[o + 1], hd = b[o + 4], hx = b[o + 2], hy = b[o + 3];
          if (hd === STAAND || hd === KIND) {
            const f = hd === KIND ? 0.68 : 1, bob = Math.abs(Math.sin(b[o + 7])) * T * 0.0012, stap = Math.sin(b[o + 7]) * lw * 0.35 * f;
            c.rect(X - lw * f * 0.45 + stap, Y - lh * f * 0.4 - bob * 0.5, lw * f * 0.38, lh * f * 0.4);
            c.rect(X + lw * f * 0.07 - stap, Y - lh * f * 0.4 - bob * 0.5, lw * f * 0.38, lh * f * 0.4);
            stip(c, X, Y - lh * f - hr * f * 0.75 - bob, hr * f);
          } else if (hd === ZITTEND) {
            c.rect(X - lw * 0.5, Y - lh * 0.12, lw * 1.6, lh * 0.12);
            stip(c, X, Y - lh * 0.58 - hr * 0.8, hr);
          } else if (hd === LIGGEND) {
            stip(c, X + hx * lh * 0.55, Y + hy * lh * 0.55, hr * 0.95);
            rechthoek(c, X - hx * lh * 0.62, Y - hy * lh * 0.62, hx, hy, lh * 0.22, lw * 0.4);
          } else stip(c, X, Y, hr);
        }
        if (open) { c.fillStyle = HUID[k]; c.fill(); }
      }
    }
    // honden: lijf, kop en een staart; in de branding een spatkring
    const d = this.hond, m = this.nHond;
    this.n.honden = m;
    if (!m) return;
    const l = T * 0.0062, w = T * 0.0028;
    c.strokeStyle = 'rgba(250,252,252,0.7)'; c.lineWidth = Math.max(0.5, T * 0.0015); c.beginPath();
    for (let i = 0; i < m; i++) { const o = i * HOND; if (d[o + 5]) { c.moveTo(d[o] + l * 1.6, d[o + 1]); c.ellipse(d[o], d[o + 1], l * 1.6, l * 0.8, 0, 0, TAU); } }
    c.stroke();
    for (let k = 0; k < VACHT.length; k++) {
      let open = false;
      for (let i = 0; i < m; i++) {
        const o = i * HOND;
        if (d[o + 4] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        const X = d[o], Y = d[o + 1] - w * 1.6, hx = d[o + 2], hy = d[o + 3] * 0.6;
        rechthoek(c, X, Y, hx, hy, l, w);
        stip(c, X + hx * l * 1.15, Y + hy * l * 1.15 - w * 0.9, w * 0.95);
      }
      if (open) { c.fillStyle = VACHT[k]; c.fill(); }
    }
    c.strokeStyle = '#3a2a1e'; c.lineWidth = Math.max(0.5, T * 0.0014); c.beginPath();
    for (let i = 0; i < m; i++) { const o = i * HOND, X = d[o], Y = d[o + 1] - w * 1.6, hx = d[o + 2], hy = d[o + 3] * 0.6; c.moveTo(X - hx * l, Y - hy * l); c.lineTo(X - hx * l * 1.6, Y - hy * l * 1.6 - w * 1.4); for (const s of [-0.6, 0.6]) { c.moveTo(X + hx * l * s, Y + hy * l * s + w * 0.6); c.lineTo(X + hx * l * s, Y + hy * l * s + w * 1.7); } }
    c.stroke();
  }

  // ---------- het strand zelf ----------

  tekenStrand(c, a) {
    const D = this.dingen, nD = D.length / DING, sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, z = this.zoom, nu = this.nu, S = SCHUIN;
    const bez = this.bez, seiz = this.seizoenStrand, dagNr = this.dagNr, tij = this.tij;
    const zicht = this.dingZicht ??= new Int32Array(260);
    let m = 0;
    if (nD && z >= DREMPEL.paviljoen - 0.5) for (let j = 0; j < nD && m < zicht.length; j++) if (this.puntInBeeld(D[j * DING + 1], D[j * DING + 2], 2)) zicht[m++] = j;
    const tel = { huisjes: 0, paviljoens: 0, reddingsposten: 0, velden: 0, stoelsets: 0, schermen: 0, handdoeken: 0, kastelen: 0, gaten: 0, sporen: 0 };
    const zichtbaar = (j) => {
      const o = j * DING, soort = D[o], zd = D[o + 5], hv = hash(zd, dagNr, 3), klein = z >= DREMPEL.strandmens - 0.5;
      if (soort === PAVILJOEN_S) return tel.paviljoens < PLAFOND.paviljoens ? (tel.paviljoens++, true) : false;
      if (soort === POST_S) return tel.reddingsposten < PLAFOND.reddingsposten ? (tel.reddingsposten++, true) : false;
      if (soort === HUISJE_S) return z >= DREMPEL.huisje - 0.5 && seiz > 0.3 && hash(zd, 9) < 0.35 + seiz && tel.huisjes < PLAFOND.huisjes ? (tel.huisjes++, true) : false;
      if (soort === VELD_S) return klein && seiz > 0.5 && tel.velden < PLAFOND.velden ? (tel.velden++, true) : false;
      if (soort === STOEL_S) return klein && seiz > 0.5 && tel.stoelsets < PLAFOND.stoelsets ? (tel.stoelsets++, true) : false;
      if (soort === SCHERM_S) return klein && hv < bez && tel.schermen < PLAFOND.schermen ? (tel.schermen++, true) : false;
      if (soort === DOEK_S) return klein && hv < bez && tel.handdoeken < PLAFOND.handdoeken ? (tel.handdoeken++, true) : false;
      if (soort === KASTEEL_S) return z >= DREMPEL.kasteel - 0.5 && seiz > 0.3 && hv < bez * 1.6 && tel.kastelen < PLAFOND.kastelen ? (tel.kastelen++, true) : false;
      if (soort === GAT_S) return z >= DREMPEL.kasteel - 0.5 && hv < bez && tel.gaten < PLAFOND.gaten ? (tel.gaten++, true) : false;
      return false;
    };
    let k = 0;
    for (let j = 0; j < m; j++) if (zichtbaar(zicht[j])) zicht[k++] = zicht[j];
    m = k;
    Object.assign(this.n, tel);
    c.globalAlpha = a;
    // 1. op de grond: veldlijnen, handdoeken, gaten, kastelen, voetsporen
    if (z >= DREMPEL.strandmens - 0.5) {
      c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = Math.max(0.5, T * 0.0018); c.beginPath();
      for (let j = 0; j < m; j++) { const o = zicht[j] * DING; if (D[o] === VELD_S) rechthoek(c, D[o + 1] * sc + ox, D[o + 2] * sc + oy, D[o + 3], D[o + 4], 0.8 * sc, 0.38 * sc); }
      c.stroke();
      for (let kl = 0; kl < DOEK.length; kl++) {
        let open = false;
        for (let j = 0; j < m; j++) {
          const o = zicht[j] * DING;
          if ((D[o] !== DOEK_S && D[o] !== SCHERM_S) || D[o + 7] % DOEK.length !== kl) continue;
          if (!open) { c.beginPath(); open = true; }
          rechthoek(c, D[o + 1] * sc + ox, D[o + 2] * sc + oy, D[o + 4], -D[o + 3], 0.24 * sc, 0.11 * sc);
        }
        if (open) { c.fillStyle = DOEK[kl][0]; c.fill(); }
      }
      if (z >= DREMPEL.klein) {
        // een streep over de handdoek in de tweede kleur
        for (let kl = 0; kl < DOEK.length; kl++) {
          let open = false;
          for (let j = 0; j < m; j++) {
            const o = zicht[j] * DING;
            if ((D[o] !== DOEK_S && D[o] !== SCHERM_S) || D[o + 7] % DOEK.length !== kl) continue;
            if (!open) { c.beginPath(); open = true; }
            const nx = D[o + 4], ny = -D[o + 3];
            rechthoek(c, (D[o + 1] - nx * 0.12) * sc + ox, (D[o + 2] - ny * 0.12) * sc + oy, nx, ny, 0.035 * sc, 0.11 * sc);
          }
          if (open) { c.fillStyle = DOEK[kl][1]; c.fill(); }
        }
      }
      // voetsporen van een paar handdoeken naar de waterlijn
      if (z >= DREMPEL.spoor - 0.5) {
        let ns = 0;
        c.fillStyle = 'rgba(120,100,70,0.35)'; c.beginPath();
        const g = Math.max(0.6, T * 0.002);
        for (let j = 0; j < m && ns < PLAFOND.sporen; j++) {
          const o = zicht[j] * DING;
          if (D[o] !== DOEK_S || hash(D[o + 5], 11) > 0.35) continue;
          ns++;
          const nx = D[o + 4], ny = -D[o + 3], tx = D[o + 3], ty = D[o + 4], x0 = D[o + 1], y0 = D[o + 2], eind = Math.max(0, tij) + 0.05;
          // het strandpunt: de handdoek ligt op ~1,2 landinwaarts; de sporen lopen naar zee tot de waterlijn van nu
          for (let s = 0, d = 0.95; d > eind && s < 14; s++, d -= 0.14) {
            const zij = (s & 1 ? 1 : -1) * 0.035 + Math.sin(s * 0.7 + D[o + 5]) * 0.04, w = 1.18 - d;
            c.rect((x0 + nx * w + tx * zij) * sc + ox, (y0 + ny * w + ty * zij) * sc + oy, g, g * 0.7);
          }
        }
        c.fill();
        this.n.sporen = ns;
      }
    }
    if (z >= DREMPEL.kasteel - 0.5) {
      // gaten en zandkastelen; bij hoog water zakt een kasteel in
      c.fillStyle = 'rgba(96,80,56,0.55)'; c.beginPath();
      for (let j = 0; j < m; j++) { const o = zicht[j] * DING; if (D[o] === GAT_S) c.ellipse(D[o + 1] * sc + ox, D[o + 2] * sc + oy, 0.12 * sc, 0.08 * sc, 0, 0, TAU); }
      c.fill();
      c.fillStyle = this.sn ? '#e6e9ea' : '#c9b386'; c.beginPath();
      for (let j = 0; j < m; j++) {
        const o = zicht[j] * DING, X = D[o + 1] * sc + ox, Y = D[o + 2] * sc + oy;
        if (D[o] === GAT_S) { stip(c, X + 0.2 * sc, Y - 0.02 * sc, 0.08 * sc); continue; }
        if (D[o] !== KASTEEL_S) continue;
        const ingezakt = smooth(0.25, 0.5, tij);
        stip(c, X, Y, 0.13 * sc * (1 - 0.3 * ingezakt));
        if (ingezakt < 0.6) {
          const th = 0.16 * sc * (1 - ingezakt), tw = 0.06 * sc;
          c.rect(X - 0.11 * sc, Y - 0.05 * sc - th, tw, th); c.rect(X + 0.05 * sc, Y - 0.05 * sc - th, tw, th); c.rect(X - 0.03 * sc, Y + 0.06 * sc - th, tw, th);
        }
      }
      c.fill();
      c.strokeStyle = 'rgba(70,110,130,0.55)'; c.lineWidth = Math.max(0.5, T * 0.0015); c.beginPath();
      for (let j = 0; j < m; j++) { const o = zicht[j] * DING; if (D[o] === KASTEEL_S) { const X = D[o + 1] * sc + ox, Y = D[o + 2] * sc + oy; c.moveTo(X + 0.2 * sc, Y); c.ellipse(X, Y, 0.2 * sc, 0.15 * sc, 0, 0, TAU); } }
      c.stroke();
      // emmertjes en schepjes
      if (z >= DREMPEL.emmer - 0.5) {
        for (let kl = 0; kl < EMMER.length; kl++) {
          let open = false;
          for (let j = 0; j < m; j++) {
            const o = zicht[j] * DING;
            if ((D[o] !== KASTEEL_S && D[o] !== GAT_S) || D[o + 7] % EMMER.length !== kl) continue;
            if (!open) { c.beginPath(); open = true; }
            const X = D[o + 1] * sc + ox, Y = D[o + 2] * sc + oy;
            c.rect(X - 0.24 * sc, Y + 0.02 * sc, 0.06 * sc, 0.07 * sc);
            c.rect(X + 0.26 * sc, Y + 0.1 * sc, 0.09 * sc, 0.025 * sc);
          }
          if (open) { c.fillStyle = EMMER[kl]; c.fill(); }
        }
      }
    }
    // 2. schaduwen van alles wat hoog is
    c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath();
    for (let j = 0; j < m; j++) {
      const o = zicht[j] * DING, X = D[o + 1] * sc + ox, Y = D[o + 2] * sc + oy, s = D[o];
      if (s === HUISJE_S) c.rect(X - 0.2 * sc, Y - 0.1 * sc, (0.5 + 0.4 * S) * sc, 0.26 * sc);
      else if (s === PAVILJOEN_S) c.rect(X - 0.6 * sc, Y - 0.05 * sc, (1.4 + 0.7 * S) * sc, 0.5 * sc);
      else if (s === POST_S) { c.rect(X - 0.15 * sc, Y - 0.05 * sc, (0.45 + 0.8 * S) * sc, 0.3 * sc); c.rect(X + 0.2 * sc, Y, 1.1 * S * sc, 0.06 * sc); }
      else if (s === STOEL_S && z >= DREMPEL.strandmens - 0.5) c.rect(X - 0.18 * sc, Y, 0.45 * sc, 0.12 * sc);
    }
    c.fill();
    // 3. strandhuisjes: gevel naar de kijker, dak in twee tinten (de oosthelft in de schaduw), deur
    if (tel.huisjes) {
      const w = 0.48 * sc, hm = 0.32 * sc, dd = 0.26 * sc;
      for (let kl = 0; kl < HUISJE.length; kl++) {
        let open = false;
        for (let j = 0; j < m; j++) { const o = zicht[j] * DING; if (D[o] !== HUISJE_S || D[o + 7] !== kl) continue; if (!open) { c.beginPath(); open = true; } c.rect(D[o + 1] * sc + ox - w / 2, D[o + 2] * sc + oy - hm, w, hm); }
        if (open) { c.fillStyle = HUISJE[kl][2]; c.fill(); }
      }
      c.fillStyle = this.sn ? '#f4f6f7' : '#f1ede4'; c.beginPath();
      for (let j = 0; j < m; j++) { const o = zicht[j] * DING; if (D[o] === HUISJE_S) c.rect(D[o + 1] * sc + ox - w / 2 - 0.03 * sc, D[o + 2] * sc + oy - hm - dd, w + 0.06 * sc, dd); }
      c.fill();
      c.fillStyle = this.sn ? '#d9dee1' : '#cdc6b8'; c.beginPath();
      for (let j = 0; j < m; j++) { const o = zicht[j] * DING; if (D[o] === HUISJE_S) c.rect(D[o + 1] * sc + ox, D[o + 2] * sc + oy - hm - dd, w / 2 + 0.03 * sc, dd); }
      c.fill();
      if (z >= DREMPEL.strandmens - 0.5) {
        c.fillStyle = '#3a3a3a'; c.beginPath();
        for (let j = 0; j < m; j++) { const o = zicht[j] * DING; if (D[o] === HUISJE_S && hash(D[o + 5], dagNr, 4) < (0.25 + bez) * this.dagL) c.rect(D[o + 1] * sc + ox - w * 0.17, D[o + 2] * sc + oy - hm * 0.78, w * 0.34, hm * 0.78); }
        c.fill();
      }
    }
    // 4. strandstoelen: twee ligstoelen met een rugleuning; leeg bij slecht weer
    if (tel.stoelsets) {
      for (let kl = 0; kl < SCHERM.length; kl++) {
        let open = false;
        for (let j = 0; j < m; j++) {
          const o = zicht[j] * DING;
          if (D[o] !== STOEL_S || D[o + 7] % SCHERM.length !== kl) continue;
          if (!open) { c.beginPath(); open = true; }
          const X = D[o + 1] * sc + ox, Y = D[o + 2] * sc + oy;
          for (let q = -1; q <= 1; q += 2) { const u = q * 0.13 * sc; c.rect(X + u - 0.08 * sc, Y - 0.06 * sc, 0.16 * sc, 0.12 * sc); c.rect(X + u - 0.08 * sc, Y - 0.16 * sc, 0.16 * sc, 0.1 * sc); }
        }
        if (open) { c.fillStyle = SCHERM[kl]; c.fill(); }
      }
    }
    // 5. windschermen: palen met doek in een U om de handdoek, open naar zee
    if (tel.schermen) {
      c.lineWidth = Math.max(0.7, 0.06 * sc);
      for (let kl = 0; kl < SCHERM.length; kl++) {
        let open = false;
        for (let j = 0; j < m; j++) {
          const o = zicht[j] * DING;
          if (D[o] !== SCHERM_S || Math.floor(D[o + 7] / 8) % SCHERM.length !== kl) continue;
          if (!open) { c.beginPath(); open = true; }
          // u langs het strand, d landinwaarts; de paaltjes staan 0,12 hoog
          const X = D[o + 1] * sc + ox, Y = D[o + 2] * sc + oy - 0.12 * sc, tx = D[o + 3] * sc, ty = D[o + 4] * sc, nx = ty, ny = -tx;
          c.moveTo(X - tx * 0.24 + nx * 0.15, Y - ty * 0.24 + ny * 0.15);
          c.lineTo(X - tx * 0.26 - nx * 0.32, Y - ty * 0.26 - ny * 0.32);
          c.lineTo(X + tx * 0.26 - nx * 0.32, Y + ty * 0.26 - ny * 0.32);
          c.lineTo(X + tx * 0.24 + nx * 0.15, Y + ty * 0.24 + ny * 0.15);
        }
        if (open) { c.strokeStyle = SCHERM[kl]; c.stroke(); }
      }
    }
    // 6. paviljoen, reddingspost, net van het volleybalveld (elk apart, er zijn er maar een paar)
    for (let j = 0; j < m; j++) {
      const o = zicht[j] * DING, s = D[o];
      if (s === PAVILJOEN_S) this.paviljoen(c, o);
      else if (s === POST_S) this.post(c, o);
      else if (s === VELD_S) this.veld(c, o);
    }
    // 7. mensen bij de dingen
    if (z >= DREMPEL.strandmens - 0.5) {
      for (let j = 0; j < m; j++) {
        const o = zicht[j] * DING, s = D[o], zd = D[o + 5], X = D[o + 1] * sc + ox, Y = D[o + 2] * sc + oy, nx = D[o + 4], ny = -D[o + 3];
        if (s === DOEK_S || s === SCHERM_S) {
          const lig = hash(zd, 12) < 0.7;
          this.zetMens(X + D[o + 3] * 0.02 * sc, Y, -nx, -ny, lig ? LIGGEND : ZITTEND, Math.floor(hash(zd, 13) * KLEDING.length), Math.floor(hash(zd, 14) * HUID.length), 0);
          if (hash(zd, 15) < 0.35) this.zetMens(X + D[o + 3] * 0.32 * sc, Y + D[o + 4] * 0.32 * sc, -nx, -ny, ZITTEND, Math.floor(hash(zd, 16) * KLEDING.length), Math.floor(hash(zd, 17) * HUID.length), 0);
        } else if (s === STOEL_S) {
          for (let q = 0; q < 2; q++) if (hash(zd, dagNr, 20 + q) < bez) this.zetMens(X + (q ? 0.13 : -0.13) * sc, Y - 0.02 * sc, 0, 1, ZITTEND, Math.floor(hash(zd, 22 + q) * KLEDING.length), Math.floor(hash(zd, 24 + q) * HUID.length), 0);
        } else if (s === KASTEEL_S || s === GAT_S) {
          if (hash(zd, dagNr, 26) > bez * 1.3 || (s === KASTEEL_S && tij > 0.35)) continue;
          const graaf = nu / 260 + zd;
          this.zetMens(X - 0.2 * sc, Y - 0.06 * sc, 0, 1, hash(zd, 27) < 0.5 ? ZITTEND : KIND, Math.floor(hash(zd, 28) * KLEDING.length), Math.floor(hash(zd, 29) * HUID.length), graaf);
          if (hash(zd, 30) < 0.4) this.zetMens(X + 0.22 * sc, Y + 0.04 * sc, 0, 1, KIND, Math.floor(hash(zd, 31) * KLEDING.length), Math.floor(hash(zd, 32) * HUID.length), graaf * 1.3);
        } else if (s === HUISJE_S && hash(zd, dagNr, 33) < bez * 0.4) {
          this.zetMens(X + 0.3 * sc, Y + 0.12 * sc, 0, 1, ZITTEND, Math.floor(hash(zd, 34) * KLEDING.length), Math.floor(hash(zd, 35) * HUID.length), 0);
        }
      }
    }
  }

  // Paviljoen op palen met een terras naar zee: parasols en tafeltjes, 's avonds lichtjes. Het gebouw staat recht
  // naar de kijker; het terras ligt aan de kant waar de zee is: ervoor (zee in het zuiden), opzij (zee in het oosten
  // of westen) of erachter boven het dak uit (zee in het noorden), zodat gebouw en terras elkaar niet bedekken.
  paviljoen(c, o) {
    const D = this.dingen, sc = this.sc, T = this.T, z = this.zoom, X = D[o + 1] * sc + this.ox, Y = D[o + 2] * sc + this.oy, nx = D[o + 4], ny = -D[o + 3], zd = D[o + 5];
    const w = 1.3 * sc, hp = 0.16 * sc, hm = 0.36 * sc, dd = 0.4 * sc;
    // terras: midden (tX, tY) van het dek, halve maten (hw, hd), voorrand yF; opzij staan de tafels onder elkaar
    const opzij = Math.abs(nx) >= 0.6 && ny < 0.6, achter = !opzij && ny <= -0.35;
    const hw = opzij ? 0.3 * sc : w / 2, hd = opzij ? 0.36 * sc : 0.18 * sc;
    const yF = opzij ? Y - hp + 0.04 * sc : achter ? Y - hp - hm - dd + 0.06 * sc : Y + 0.52 * sc;
    const tX = opzij ? X + Math.sign(nx) * (w / 2 + hw + 0.04 * sc) : X + nx * 0.4 * sc, tY = yF - hd;
    const nT = opzij ? 3 : 4, tafel = (k, uit) => { if (opzij) { uit[0] = tX; uit[1] = tY + (k - 1) * 0.24 * sc; } else { uit[0] = tX + (-0.45 + k * 0.3) * sc; uit[1] = tY; } };
    const q = this.q4 ??= [0, 0];
    c.strokeStyle = '#5a4634'; c.lineWidth = Math.max(0.6, 0.05 * sc); c.beginPath();
    for (const u of [-0.6, -0.2, 0.2, 0.6]) { c.moveTo(X + u * sc, Y); c.lineTo(X + u * sc, Y - hp); }
    if (!achter) for (const f of [-0.9, -0.3, 0.3, 0.9]) { const px = tX + f * hw; c.moveTo(px, yF - 0.02 * sc); c.lineTo(px, yF + hp * 0.8); }
    c.stroke();
    c.fillStyle = this.sn ? '#e8ebed' : '#a8865e'; c.beginPath(); c.rect(tX - hw, tY - hd, hw * 2, hd * 2); c.fill();
    if (z >= DREMPEL.klein) { c.strokeStyle = '#efe9dc'; c.lineWidth = Math.max(0.5, 0.025 * sc); c.beginPath(); c.rect(tX - hw, tY - hd, hw * 2, hd * 2); c.stroke(); }
    c.fillStyle = '#e9e2d2'; c.beginPath(); c.rect(X - w / 2, Y - hp - hm, w, hm); c.fill();
    c.fillStyle = '#2f4a5c'; c.beginPath(); for (let k = 0; k < 5; k++) c.rect(X - w / 2 + (0.08 + k * 0.25) * sc, Y - hp - hm * 0.78, 0.16 * sc, hm * 0.5); c.fill();
    c.fillStyle = this.sn ? '#f2f4f5' : ['#2f6f7a', '#8a3a2e', '#3c5a7a', '#6a6a5a'][D[o + 7] % 4]; c.beginPath(); c.rect(X - w / 2 - 0.06 * sc, Y - hp - hm - dd, w + 0.12 * sc, dd); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.18)'; c.beginPath(); c.rect(X, Y - hp - hm - dd, w / 2 + 0.06 * sc, dd); c.fill();
    const open = this.seizoenStrand > 0.3 && this.dagL > 0.3;
    if (open && z >= DREMPEL.strandmens - 0.5) {
      const nP = Math.min(nT, 1 + Math.floor(this.bez * nT));
      for (let k = 0; k < nP; k++) {
        tafel(k, q);
        const px = q[0], py = q[1];
        this.zetMens(px - 0.07 * sc, py + 0.02 * sc, 0, 1, ZITTEND, Math.floor(hash(zd, k, 40) * KLEDING.length), Math.floor(hash(zd, k, 41) * HUID.length), 0);
        this.zetMens(px + 0.08 * sc, py + 0.03 * sc, 0, 1, ZITTEND, Math.floor(hash(zd, k, 42) * KLEDING.length), Math.floor(hash(zd, k, 43) * HUID.length), 0);
      }
      c.fillStyle = PARASOL[D[o + 7] % PARASOL.length][0]; c.beginPath();
      for (let k = 0; k < nP; k++) { tafel(k, q); stip(c, q[0], q[1] - 0.28 * sc, 0.13 * sc); }
      c.fill();
      c.fillStyle = PARASOL[D[o + 7] % PARASOL.length][1]; c.beginPath();
      for (let k = 0; k < nP; k++) { tafel(k, q); stip(c, q[0] - 0.03 * sc, q[1] - 0.3 * sc, 0.04 * sc); }
      c.fill();
    }
    if (this.nacht > 0.05) {
      for (let k = 0; k < 5; k++) this.zetLicht(X - w / 2 + (0.16 + k * 0.25) * sc, Y - hp - hm * 0.55, Math.max(2, T * 0.02), WARM, 0.8);
      // het terras alleen in het seizoen
      if (this.seizoenStrand > 0.3) for (let k = 0; k < 6; k++) {
        const f = (k + 0.5) / 6 - 0.5;
        this.zetLicht(opzij ? tX : tX + f * hw * 2, opzij ? tY + f * hd * 2 : tY - 0.02 * sc, Math.max(1.5, T * 0.012), WARM, 0.9);
      }
    }
  }

  // Reddingspost: een hokje op palen met een uitkijktoren en een vlag in twee kleuren (rood boven, geel onder,
  // zonder tekens); in het seizoen twee strandwachten en een reddingsplank ervoor.
  post(c, o) {
    const D = this.dingen, sc = this.sc, T = this.T, z = this.zoom, X = D[o + 1] * sc + this.ox, Y = D[o + 2] * sc + this.oy, nx = D[o + 4], ny = -D[o + 3], zd = D[o + 5];
    const hp = 0.3 * sc, w = 0.42 * sc, hm = 0.26 * sc, th = 1.05 * sc;
    c.strokeStyle = '#4e4a44'; c.lineWidth = Math.max(0.6, 0.045 * sc); c.beginPath();
    for (const u of [-0.17, 0.17]) { c.moveTo(X + u * sc, Y); c.lineTo(X + u * sc, Y - hp); }
    c.moveTo(X + 0.3 * sc, Y + 0.02 * sc); c.lineTo(X + 0.3 * sc, Y - th);
    c.stroke();
    c.fillStyle = '#f2efe8'; c.beginPath(); c.rect(X - w / 2, Y - hp - hm, w, hm); c.fill();
    c.fillStyle = '#c8322b'; c.beginPath(); c.rect(X - w / 2, Y - hp - hm * 0.45, w, hm * 0.18); c.rect(X - w / 2 - 0.03 * sc, Y - hp - hm - 0.12 * sc, w + 0.06 * sc, 0.12 * sc); c.fill();
    // uitkijkplatform bovenop de paal
    c.fillStyle = '#d9d3c6'; c.beginPath(); c.rect(X + 0.2 * sc, Y - th - 0.03 * sc, 0.2 * sc, 0.06 * sc); c.fill();
    const seizoen = this.seizoenStrand > 0.5 && this.dagL > 0.5;
    if (!seizoen) return;
    // de vlag waait mee met de wind
    const fx = X + 0.3 * sc, fy = Y - th + 0.02 * sc, wx = this.windX >= 0 ? 1 : -1, wap = Math.sin(this.nu / 260 + zd) * 0.03 * sc, fl = 0.26 * sc * (0.6 + 0.4 * this.wd.kracht);
    c.fillStyle = '#d8342b'; c.beginPath(); c.moveTo(fx, fy - 0.16 * sc); c.lineTo(fx + wx * fl, fy - 0.16 * sc + wap); c.lineTo(fx + wx * fl, fy - 0.08 * sc + wap); c.lineTo(fx, fy - 0.08 * sc); c.closePath(); c.fill();
    c.fillStyle = '#f2c22e'; c.beginPath(); c.moveTo(fx, fy - 0.08 * sc); c.lineTo(fx + wx * fl, fy - 0.08 * sc + wap); c.lineTo(fx + wx * fl, fy + wap); c.lineTo(fx, fy); c.closePath(); c.fill();
    if (z < DREMPEL.strandmens - 0.5) return;
    // reddingsplank en twee strandwachten (rood en geel), een op de uitkijk en een die naar het water loopt
    c.fillStyle = '#e8432f'; c.beginPath(); rechthoek(c, X - 0.42 * sc + nx * 0.25 * sc, Y + ny * 0.25 * sc, nx, ny * 0.6, 0.16 * sc, 0.035 * sc); c.fill();
    this.zetMens(X + 0.3 * sc, Y - th + 0.01 * sc, 0, 1, STAAND, 0, Math.floor(hash(zd, 1) * HUID.length), 0);
    const loop = tri(this.nu / 24000 + hash(zd, 2)), lx = X + nx * (0.3 + loop * 0.5) * sc, ly = Y + ny * (0.3 + loop * 0.5) * sc;
    this.zetMens(lx, ly, 0, 1, STAAND, 2, Math.floor(hash(zd, 3) * HUID.length), this.nu / 180);
    void T;
  }

  // Beachvolleybalveld: net tussen twee palen, vier spelers, en een bal die over het net gaat.
  veld(c, o) {
    const D = this.dingen, sc = this.sc, T = this.T, nu = this.nu, X = D[o + 1] * sc + this.ox, Y = D[o + 2] * sc + this.oy, tx = D[o + 3], ty = D[o + 4], nx = ty, ny = -tx, zd = D[o + 5];
    const hn = 0.22 * sc;
    c.strokeStyle = '#3a3634'; c.lineWidth = Math.max(0.6, 0.035 * sc); c.beginPath();
    for (const s of [-1, 1]) { const px = X + nx * s * 0.45 * sc, py = Y + ny * s * 0.45 * sc; c.moveTo(px, py); c.lineTo(px, py - hn); }
    c.stroke();
    c.strokeStyle = 'rgba(245,245,240,0.85)'; c.lineWidth = Math.max(0.6, 0.03 * sc); c.beginPath();
    c.moveTo(X + nx * 0.45 * sc, Y + ny * 0.45 * sc - hn); c.lineTo(X - nx * 0.45 * sc, Y - ny * 0.45 * sc - hn);
    c.moveTo(X + nx * 0.45 * sc, Y + ny * 0.45 * sc - hn * 0.6); c.lineTo(X - nx * 0.45 * sc, Y - ny * 0.45 * sc - hn * 0.6);
    c.stroke();
    if (hash(zd, this.dagNr, 3) > this.bez * 1.4) return;
    const f = frac(nu / 2400 + hash(zd, 1)), kant = Math.floor(nu / 2400 + hash(zd, 1)) & 1 ? 1 : -1;
    for (let k = 0; k < 4; k++) {
      const s = k < 2 ? -1 : 1, v = (k & 1 ? 0.35 : -0.35) + 0.1 * Math.sin(nu / 700 + k * 2), u = 0.42 + 0.12 * Math.sin(nu / 900 + k);
      this.zetMens(X + tx * u * s * sc + nx * v * sc, Y + ty * u * s * sc + ny * v * sc, 0, 1, STAAND, [0, 0, 1, 1][k] + (zd & 1 ? 4 : 0), Math.floor(hash(zd, k, 2) * HUID.length), nu / 150 + k);
    }
    // bal: boog van de ene naar de andere kant
    const bu = (f * 2 - 1) * 0.5 * kant, bx = X + tx * bu * sc, by = Y + ty * bu * sc - (0.15 + Math.sin(f * Math.PI) * 0.5) * sc;
    c.fillStyle = '#f6f3ea'; c.beginPath(); stip(c, bx, by, Math.max(0.8, T * 0.0028)); c.fill();
  }

  // Lopers langs de waterlijn: wandelaars met een hond die door de branding rent, joggers, een ijsventer met zijn
  // kar, en in herfst en winter een strandjutter. In de kou hooguit één wandelaar met hond en één strandjutter.
  tekenLopers(c, a) {
    const A = this.wereld.strand, B = this.lopers, sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, nu = this.nu, tij = this.tij;
    if (!B.length || this.dagL < 0.3) return;
    const koud = this.warm < 0.25, tijd = nu / 1000;
    let n = 0, nWandel = 0, nJut = 0;
    c.globalAlpha = a;
    for (let j = 0; j < B.length && n < PLAFOND.lopers; j += LOOP) {
      const i0 = B[j], i1 = B[j + 1], zq = B[j + 3], druk = B[j + 6];
      if (!this.puntInBeeld(A.x[i0], A.y[i0], 40) && !this.puntInBeeld(A.x[i1], A.y[i1], 40)) continue;
      let soort;
      if (koud) {
        if (nWandel === 0) soort = WANDEL; else if (nJut === 0) soort = JUTTER; else break;
      } else {
        if (hash(zq, this.dagNr, 1) > 0.25 + 0.75 * this.bez * DRUK_F[druk] + 0.15) continue;
        const h = hash(zq, 2);
        soort = h < 0.45 ? WANDEL : h < 0.72 ? JOGGER : h < 0.86 && druk >= 2 && this.bez > 0.3 ? IJSKAR : this.sz.herfst + this.sz.lente > 0.3 ? JUTTER : WANDEL;
      }
      const v = soort === JOGGER ? 1.0 : soort === WANDEL ? 0.32 : soort === IJSKAR ? 0.22 : 0.12;
      const np = i1 - i0, per = (2 * np * STAP) / v, f = frac(tijd / per + hash(zq, 3)), s = tri(f) * np, dir = triRichting(f);
      const q = i0 + Math.min(np - 1, Math.floor(s)), fr = s - (q - i0), q2 = q + 1;
      const px = A.x[q] + (A.x[q2] - A.x[q]) * fr, py = A.y[q] + (A.y[q2] - A.y[q]) * fr, nx = A.nx[q], ny = A.ny[q];
      const d = soort === IJSKAR ? 0.92 : soort === JUTTER ? 0.78 + 0.08 * Math.sin(tijd * 0.7 + zq) : Math.max(0, tij) + (soort === JOGGER ? 0.22 : 0.32) + 0.1 * hash(zq, 4);
      const wx = px - nx * d, wy = py - ny * d;
      if (!this.puntInBeeld(wx, wy, 3)) continue;
      n++;
      const X = wx * sc + ox, Y = wy * sc + oy, hx = -ny * dir, hy = nx * dir;
      if (soort === WANDEL) nWandel++; else if (soort === JUTTER) nJut++;
      const fase = tijd * (soort === JOGGER ? 14 : soort === JUTTER ? 3 : 7) + zq;
      const kl = soort === JUTTER ? 4 : soort === IJSKAR ? 3 : Math.floor(hash(zq, 5) * KLEDING.length);
      this.zetMens(X, Y, hx, hy, STAAND, kl, Math.floor(hash(zq, 6) * HUID.length), fase);
      if (soort === WANDEL && (koud || hash(zq, 7) < 0.4)) {
        // de hond rent heen en weer door de branding, voor en achter zijn baas
        const t2 = tijd * 1.3 + zq, du = Math.sin(t2) * 0.6, dd = Math.min(d, tij) - 0.12 + 0.2 * Math.sin(t2 * 1.7);
        const hxw = px - nx * dd + hx * du, hyw = py - ny * dd + hy * du;
        this.zetHond(hxw * sc + ox, hyw * sc + oy, Math.cos(t2) >= 0 ? hx : -hx, Math.cos(t2) >= 0 ? hy : -hy, Math.floor(hash(zq, 8) * VACHT.length), dd < tij ? 1 : 0);
      } else if (soort === IJSKAR) {
        const kx = X + hx * 0.3 * sc, ky = Y + hy * 0.3 * sc;
        c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath(); c.rect(kx - 0.12 * sc, ky - 0.04 * sc, 0.34 * sc, 0.1 * sc); c.fill();
        c.fillStyle = '#f4f1ea'; c.beginPath(); c.rect(kx - 0.14 * sc, ky - 0.22 * sc, 0.28 * sc, 0.2 * sc); c.fill();
        c.fillStyle = '#e86a8a'; c.beginPath(); c.rect(kx - 0.14 * sc, ky - 0.15 * sc, 0.28 * sc, 0.05 * sc); stip(c, kx, ky - 0.4 * sc, 0.16 * sc); c.fill();
        c.fillStyle = '#2a2a2a'; c.beginPath(); stip(c, kx - 0.08 * sc, ky - 0.01 * sc, 0.035 * sc); stip(c, kx + 0.08 * sc, ky - 0.01 * sc, 0.035 * sc); c.fill();
      } else if (soort === JUTTER) {
        // zak over de schouder en een stok om in het wier te porren
        c.fillStyle = '#6e5a3e'; c.beginPath(); stip(c, X - hx * 0.08 * sc, Y - 0.2 * sc, 0.06 * sc); c.fill();
        c.strokeStyle = '#4a3a2a'; c.lineWidth = Math.max(0.5, T * 0.0012); c.beginPath(); c.moveTo(X + hx * 0.05 * sc, Y - 0.16 * sc); c.lineTo(X + hx * 0.2 * sc, Y + 0.02 * sc); c.stroke();
      }
    }
    this.n.lopers = n;
  }

  // Duinen: paden met houten hekjes en een trap naar het strand, een fietsenrek aan het eind, wuivend helmgras en
  // konijnen.
  tekenDuinen(c, a) {
    const A = this.wereld.strand, sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, z = this.zoom, nu = this.nu;
    let np = 0, nr = 0;
    c.globalAlpha = a;
    if (z >= DREMPEL.duinpad - 0.5) for (const p of this.duinpaden) {
      if (np >= PLAFOND.duinpaden || !this.inBeeld(p.x0, p.y0, p.x1, p.y1, 1)) continue;
      np++;
      const tx = -p.ny, ty = p.nx, pt = (u, d, uit) => { uit[0] = (p.x + tx * u - p.nx * d) * sc + ox; uit[1] = (p.y + ty * u - p.ny * d) * sc + oy; };
      const q = this.q2 ??= [0, 0];
      // het pad, licht slingerend
      c.strokeStyle = this.sn ? '#f1f2f0' : '#e3d3a6'; c.lineWidth = Math.max(1, 0.36 * sc); c.lineCap = 'round'; c.beginPath();
      for (let k = 0; k <= 8; k++) { const d = 2.2 + k * 0.5, u = 0.18 * Math.sin(k * 0.9 + hash(p.zaad, 1) * 6); pt(u, d, q); if (k) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }
      c.stroke();
      c.lineCap = 'butt';
      if (z >= DREMPEL.hek - 0.5) {
        // trap van planken het duin af, dan hekjes langs het pad
        c.strokeStyle = '#7a5a3a'; c.lineWidth = Math.max(0.5, 0.03 * sc); c.beginPath();
        for (let d = 2.25; d <= 2.9; d += 0.11) { const u = 0.18 * Math.sin(hash(p.zaad, 1) * 6); pt(u - 0.2, d, q); c.moveTo(q[0], q[1]); pt(u + 0.2, d, q); c.lineTo(q[0], q[1]); }
        c.stroke();
        c.strokeStyle = '#6a5038'; c.lineWidth = Math.max(0.5, 0.025 * sc); c.beginPath();
        for (const s of [-1, 1]) {
          for (let k = 2; k <= 7; k++) { const d = 2.2 + k * 0.5, u = 0.18 * Math.sin(k * 0.9 + hash(p.zaad, 1) * 6) + s * 0.32; pt(u, d, q); c.moveTo(q[0], q[1]); c.lineTo(q[0], q[1] - 0.12 * sc); }
          for (let k = 2; k <= 7; k++) { const d = 2.2 + k * 0.5, u = 0.18 * Math.sin(k * 0.9 + hash(p.zaad, 1) * 6) + s * 0.32; pt(u, d, q); if (k > 2) c.lineTo(q[0], q[1] - 0.09 * sc); else c.moveTo(q[0], q[1] - 0.09 * sc); }
        }
        c.stroke();
      }
      // fietsenrek met fietsen (meer in de zomer)
      if (p.rek && z >= DREMPEL.huisje - 0.5) {
        nr++;
        pt(0.75, 6.1, q);
        const X = q[0], Y = q[1], nf = Math.min(6, Math.round((0.3 + this.bez * 0.7) * (2 + p.druk * 1.4) * (this.dagL > 0.3 ? 1 : 0.3)));
        c.strokeStyle = '#8c9094'; c.lineWidth = Math.max(0.5, 0.03 * sc); c.beginPath(); c.moveTo(X - 0.45 * sc, Y); c.lineTo(X + 0.45 * sc, Y); c.stroke();
        for (let k = 0; k < nf; k++) {
          const fx = X - 0.4 * sc + k * 0.16 * sc;
          c.strokeStyle = FIETS[Math.floor(hash(p.zaad, k, 3) * FIETS.length)]; c.lineWidth = Math.max(0.5, 0.025 * sc); c.beginPath();
          c.moveTo(fx, Y - 0.12 * sc); c.lineTo(fx, Y + 0.12 * sc);
          c.stroke();
          if (z >= DREMPEL.klein) { c.fillStyle = '#26282a'; c.beginPath(); c.rect(fx - 0.02 * sc, Y - 0.15 * sc, 0.04 * sc, 0.06 * sc); c.rect(fx - 0.02 * sc, Y + 0.1 * sc, 0.04 * sc, 0.06 * sc); c.fill(); }
        }
      }
    }
    this.n.duinpaden = np; this.n.rekken = nr;
    // helm: plukjes die met de wind meebuigen
    let nh = 0;
    if (z >= DREMPEL.helm - 0.5 && this.nZr) {
      const zp = this.zp, g = this.raster, h = 0.2 * sc, kr = this.wd.kracht, wx = this.windX;
      const zwaai = (0.15 + 0.35 * kr) * h;
      for (let laag = 0; laag < 2; laag++) {
        c.strokeStyle = this.sn ? (laag ? '#c9cdb8' : '#a9ad94') : laag ? '#b6b26a' : '#8d8a4c'; c.lineWidth = Math.max(0.5, T * 0.0016); c.beginPath();
        for (let j = 0; j < this.zr[this.nZr] && nh < PLAFOND.helm; j++) {
          const i = zp[j];
          if (!(A.f[i] & S_DUIN)) continue;
          for (let k = 0; k < 2 && nh < PLAFOND.helm; k++) {
            if ((k & 1) !== laag) continue;
            const d = 2.8 + hash(i, k, 21) * 2.8, u = (hash(i, k, 22) - 0.5) * 1.4, x = A.x[i] - A.nx[i] * d - A.ny[i] * u, y = A.y[i] - A.ny[i] * d + A.nx[i] * u;
            const cx = clamp(Math.floor(x / RC), 0, RW - 1), cy = clamp(Math.floor(y / RC), 0, RH - 1);
            if (g[cy * RW + cx] & (INFRA | GEBOUW | KUST)) continue;
            nh++;
            const X = x * sc + ox, Y = y * sc + oy, buig = wx * zwaai * 0.6 + Math.sin(nu / 650 + i * 0.7 + k) * zwaai;
            for (let s = -1; s <= 1; s++) { c.moveTo(X + s * h * 0.15, Y); c.lineTo(X + s * h * 0.4 + buig * (1 + s * 0.2), Y - h * (1 - Math.abs(s) * 0.25)); }
          }
        }
        c.stroke();
      }
    }
    this.n.helm = nh;
    // konijnen: zitten, kijken rond en maken af en toe een sprongetje
    let nk = 0;
    if (z >= DREMPEL.konijn - 0.5 && this.nacht < 0.85) {
      const K = this.konijnen, r = Math.max(0.7, T * 0.0034);
      c.fillStyle = this.sn ? '#a08a72' : '#8a6e52'; c.beginPath();
      for (let j = 0; j < K.length && nk < PLAFOND.konijnen; j += 3) {
        if (!this.puntInBeeld(K[j], K[j + 1], 1)) continue;
        nk++;
        const f = frac(nu / 6000 + hash(K[j + 2], 1)), sprong = f < 0.08 ? Math.sin((f / 0.08) * Math.PI) : 0, verder = (Math.floor(nu / 6000 + hash(K[j + 2], 1)) % 5) * 0.12;
        const X = (K[j] + verder) * sc + ox, Y = K[j + 1] * sc + oy - sprong * r * 2.5;
        c.rect(X - r, Y - r * 0.9, r * 2, r * 1.3);
        c.rect(X + r * 0.6, Y - r * 1.6, r * 0.9, r * 0.9);
        c.rect(X + r * 0.75, Y - r * 2.6, r * 0.25, r * 1.1);
        c.rect(X + r * 1.1, Y - r * 2.5, r * 0.25, r * 1.0);
      }
      c.fill();
      if (nk) { c.fillStyle = '#f2efe8'; c.beginPath(); for (let j = 0, q = 0; j < K.length && q < nk; j += 3) { if (!this.puntInBeeld(K[j], K[j + 1], 1)) continue; q++; const f = frac(nu / 6000 + hash(K[j + 2], 1)), sprong = f < 0.08 ? Math.sin((f / 0.08) * Math.PI) : 0, verder = (Math.floor(nu / 6000 + hash(K[j + 2], 1)) % 5) * 0.12; c.rect((K[j] + verder) * sc + ox - r * 1.25, K[j + 1] * sc + oy - sprong * r * 2.5 - r * 0.6, r * 0.45, r * 0.45); } c.fill(); }
    }
    this.n.konijnen = nk;
  }

  // ---------- havens van dichtbij ----------

  // Hengelaars op de pieren en havenhoofden: hengel, lijn en dobber; af en toe beet. In de winter een enkeling,
  // 's avonds met een lantaarntje.
  tekenHengelaars(c, a) {
    const B = this.hengelplekken, sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, nu = this.nu;
    if (!B.length) return;
    let n = 0;
    const kans = (0.15 + 0.55 * clamp(this.sz.zomer + this.sz.lente * 0.7 + this.sz.herfst * 0.6, 0, 1)) * (0.4 + 0.6 * this.zon) * (this.dagL > 0.3 ? 1 : 0.3);
    const hz = this.hzZicht ??= new Int32Array(PLAFOND.hengelaars);
    for (let j = 0; j < B.length && n < PLAFOND.hengelaars; j += 6) if (this.puntInBeeld(B[j], B[j + 1], 2) && hash(B[j + 4], this.dagNr, 1) < kans) hz[n++] = j;
    this.n.hengelaars = n;
    if (!n) return;
    c.globalAlpha = a;
    const hoog = T * 0.008; // dekhoogte van pier en havenhoofd
    c.strokeStyle = '#2a2a2a'; c.lineWidth = Math.max(0.5, T * 0.0013); c.beginPath();
    for (let q = 0; q < n; q++) {
      const j = hz[q], X = B[j] * sc + ox, Y = B[j + 1] * sc + oy - hoog, hx = B[j + 2], hy = B[j + 3], beet = frac(nu / 7000 + hash(B[j + 4], 2)) < 0.08;
      const tx = X + hx * 0.45 * sc, ty = Y + hy * 0.45 * sc - (beet ? 0.18 : 0.35) * sc;
      c.moveTo(X + hx * 0.04 * sc, Y - 0.2 * sc); c.lineTo(tx, ty);
    }
    c.stroke();
    c.strokeStyle = 'rgba(240,240,240,0.55)'; c.lineWidth = Math.max(0.4, T * 0.0008); c.beginPath();
    for (let q = 0; q < n; q++) {
      const j = hz[q], X = B[j] * sc + ox, Y = B[j + 1] * sc + oy - hoog, hx = B[j + 2], hy = B[j + 3], beet = frac(nu / 7000 + hash(B[j + 4], 2)) < 0.08;
      const tx = X + hx * 0.45 * sc, ty = Y + hy * 0.45 * sc - (beet ? 0.18 : 0.35) * sc, dx = X + hx * 0.75 * sc, dy = Y + hy * 0.75 * sc + hoog + Math.sin(nu / 500 + j) * 0.01 * sc;
      c.moveTo(tx, ty); c.lineTo(dx, dy);
    }
    c.stroke();
    c.fillStyle = '#e8432f'; c.beginPath();
    for (let q = 0; q < n; q++) { const j = hz[q], X = B[j] * sc + ox, Y = B[j + 1] * sc + oy, hx = B[j + 2], hy = B[j + 3], beet = frac(nu / 7000 + hash(B[j + 4], 2)) < 0.08; if (!beet) stip(c, X + hx * 0.75 * sc, Y + hy * 0.75 * sc + Math.sin(nu / 500 + j) * 0.01 * sc, Math.max(0.6, T * 0.0018)); }
    c.fill();
    for (let q = 0; q < n; q++) {
      const j = hz[q], X = B[j] * sc + ox, Y = B[j + 1] * sc + oy - hoog, zq = B[j + 4];
      this.zetMens(X, Y, 0, 1, hash(zq, 3) < 0.5 ? ZITTEND : STAAND, [4, 5, 1, 3, 6][Math.floor(hash(zq, 4) * 5)], Math.floor(hash(zq, 5) * HUID.length), 0);
      if (this.nacht > 0.3) this.zetLicht(X - B[j + 2] * 0.1 * sc, Y - 0.05 * sc, Math.max(2, T * 0.018), WARM, 0.7);
    }
  }

  // Sloepjes langs de kades, aan een tros, en een hijskraantje op de kademuur.
  tekenSloepen(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, z = this.zoom, nu = this.nu, S = SCHUIN;
    let n = 0;
    c.globalAlpha = a;
    const ijs = this.ijs > 0.6;
    for (const b of this.sloepen) {
      if (n >= PLAFOND.sloepen || !this.puntInBeeld(b.x, b.y, 1.5)) continue;
      n++;
      const dein = ijs ? 0 : Math.sin(nu / 900 + b.zaad) * 0.012 * sc;
      const X = b.x * sc + ox, Y = b.y * sc + oy + dein, l = 0.42 * sc, w = 0.15 * sc;
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); romp(c, X + 0.04 * sc * S, Y + 0.05 * sc, b.fx, b.fy, l, w); c.fill();
      c.fillStyle = ['#f2efe6', '#2f4a6a', '#7a3a2a', '#3d6b4a', '#c9a64a'][Math.floor(hash(b.zaad, 2) * 5)]; c.beginPath(); romp(c, X, Y, b.fx, b.fy, l, w); c.fill();
      c.fillStyle = hash(b.zaad, 3) < 0.4 ? '#2f5a7a' : '#9a7a52'; c.beginPath(); romp(c, X, Y, b.fx, b.fy, l * 0.78, w * 0.68); c.fill();
      if (z >= DREMPEL.klein) {
        c.strokeStyle = '#d8d0b8'; c.lineWidth = Math.max(0.4, T * 0.0012); c.beginPath();
        c.moveTo(X + b.fx * l * 0.8, Y + b.fy * l * 0.8); c.lineTo((b.x - b.wx * 0.62 + b.fx * 0.5) * sc + ox, (b.y - b.wy * 0.62 + b.fy * 0.5) * sc + oy - 0.04 * sc);
        c.stroke();
      }
    }
    this.n.sloepen = n;
    let nk = 0;
    if (z >= DREMPEL.kraan - 0.5) for (const k of this.kraantjes) {
      if (nk >= PLAFOND.kraantjes || !this.puntInBeeld(k.x, k.y, 2)) continue;
      nk++;
      this.kraantje(c, k.x * sc + ox, k.y * sc + oy, k.wx, k.wy, k.zaad);
    }
    this.n.kraantjes = nk;
  }

  // Klein draaibaar kraantje: paal, giek over het water, haak aan een kabel die zachtjes slingert.
  kraantje(c, X, Y, wx, wy, zaad) {
    const sc = this.sc, T = this.T, h = 0.75 * sc, zw = Math.sin(this.nu / 5000 + zaad) * 0.4;
    const gx = X + (wx * Math.cos(zw) - wy * Math.sin(zw)) * 0.6 * sc, gy = Y + (wy * Math.cos(zw) + wx * Math.sin(zw)) * 0.6 * sc - h;
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.6, 0.05 * sc); c.beginPath(); c.moveTo(X, Y); c.lineTo(X + h * SCHUIN, Y + h * SCHUIN * 0.6); c.stroke();
    c.strokeStyle = '#d9a63a'; c.lineWidth = Math.max(0.7, 0.06 * sc); c.beginPath(); c.moveTo(X, Y); c.lineTo(X, Y - h); c.lineTo(gx, gy); c.stroke();
    c.strokeStyle = '#2b2b2b'; c.lineWidth = Math.max(0.4, T * 0.001); c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + Math.sin(this.nu / 1300 + zaad) * 0.03 * sc, gy + 0.45 * sc); c.stroke();
    c.fillStyle = '#3a3a3a'; c.beginPath(); c.rect(X - 0.06 * sc, Y - 0.08 * sc, 0.12 * sc, 0.1 * sc); c.fill();
  }

  // Een kotter: romp, dek, stuurhut, mast met de giek van het vistuig. (X, Y) scherm, (hx, hy) koers.
  kotter(c, X, Y, hx, hy, zaad) {
    const sc = this.sc, z = this.zoom, l = 0.8 * sc, w = 0.27 * sc, S = SCHUIN;
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); romp(c, X + 0.06 * sc, Y + 0.08 * sc, hx, hy, l, w); c.fill();
    c.fillStyle = KOTTER[Math.floor(hash(zaad, 1) * KOTTER.length)]; c.beginPath(); romp(c, X, Y, hx, hy, l, w); c.fill();
    c.fillStyle = this.sn ? '#eef1f3' : '#b8ad94'; c.beginPath(); romp(c, X, Y - 0.03 * sc, hx, hy, l * 0.82, w * 0.72); c.fill();
    const sx = X - hx * l * 0.15, sy = Y - hy * l * 0.15, sh = 0.2 * sc;
    c.fillStyle = '#f0ece2'; c.beginPath(); c.rect(sx - 0.12 * sc, sy - sh, 0.24 * sc, sh); c.fill();
    c.fillStyle = '#9a3a2a'; c.beginPath(); c.rect(sx - 0.14 * sc, sy - sh - 0.05 * sc, 0.28 * sc, 0.06 * sc); c.fill();
    if (z >= DREMPEL.klein) { c.fillStyle = '#2f4152'; c.beginPath(); c.rect(sx - 0.09 * sc, sy - sh * 0.8, 0.18 * sc, sh * 0.3); c.fill(); }
    // mast en giek
    const mx = X + hx * l * 0.35, my = Y + hy * l * 0.35, mh = 0.75 * sc;
    c.strokeStyle = '#3a3634'; c.lineWidth = Math.max(0.5, 0.035 * sc); c.beginPath();
    c.moveTo(mx, my); c.lineTo(mx, my - mh);
    c.moveTo(mx, my - mh * 0.7); c.lineTo(mx - hy * 0.55 * sc, my + hx * 0.55 * sc - mh * 0.35);
    c.moveTo(mx, my - mh * 0.7); c.lineTo(mx + hy * 0.55 * sc, my - hx * 0.55 * sc - mh * 0.35);
    c.stroke();
    this.kTopX = mx; this.kTopY = my - mh;
    void S;
  }

  tekenVissershavens(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, z = this.zoom, nu = this.nu, S = SCHUIN;
    let n = 0, nk = 0, nm = 0;
    c.globalAlpha = a;
    const ijs = this.ijs > 0.6;
    for (const h of this.vissershavens) {
      if (n >= PLAFOND.vissershavens || !this.inBeeld(h.x0, h.y0, h.x1, h.y1, 1)) continue;
      n++;
      const tx = h.tx, ty = h.ty, nx = h.nx, ny = h.ny;
      const P = (u, v, uit) => { uit[0] = (h.x + tx * u + nx * v) * sc + ox; uit[1] = (h.y + ty * u + ny * v) * sc + oy; };
      const q = this.q3 ??= [0, 0];
      const vlak = (u0, u1, v0, v1) => { P(u0, v0, q); c.moveTo(q[0], q[1]); P(u1, v0, q); c.lineTo(q[0], q[1]); P(u1, v1, q); c.lineTo(q[0], q[1]); P(u0, v1, q); c.lineTo(q[0], q[1]); c.closePath(); };
      // kade en muur
      const hq = 0.14 * sc;
      c.fillStyle = '#5f5a52'; c.beginPath(); P(-3.7, 0.15, q); c.moveTo(q[0], q[1]); P(3.7, 0.15, q); c.lineTo(q[0], q[1]); c.lineTo(q[0], q[1] + hq); P(-3.7, 0.15, q); c.lineTo(q[0], q[1] + hq); c.closePath(); c.fill();
      c.fillStyle = this.sn ? '#e6e9eb' : '#a39d90'; c.beginPath(); vlak(-3.7, 3.7, -1.1, 0.15); c.fill();
      if (z >= DREMPEL.fijn + 1) {
        c.fillStyle = '#2b2b2a'; c.beginPath();
        for (let u = -3.3; u <= 3.4; u += 1.1) { P(u, 0.05, q); stip(c, q[0], q[1] - 0.02 * sc, Math.max(0.6, 0.05 * sc)); }
        c.fill();
      }
      // visafslag: lange loods met een open voorkant, kratten ervoor
      P(-1.7, -2.1, q);
      const ax = q[0], ay = q[1], aw = 2.4 * sc, ah = 0.55 * sc, ad = 0.9 * sc;
      c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.rect(ax - aw / 2, ay - ad * 0.3, aw + ah * S, ad * 0.6 + ah * S * 0.4); c.fill();
      c.fillStyle = '#d9d4c8'; c.beginPath(); c.rect(ax - aw / 2, ay - ah, aw, ah); c.fill();
      c.fillStyle = '#3a3c3e'; c.beginPath(); c.rect(ax - aw * 0.35, ay - ah * 0.8, aw * 0.7, ah * 0.8); c.fill();
      c.fillStyle = this.sn ? '#f1f3f4' : '#5d6f7a'; c.beginPath(); c.rect(ax - aw / 2 - 0.08 * sc, ay - ah - ad, aw + 0.16 * sc, ad); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.16)'; c.beginPath(); c.rect(ax, ay - ah - ad, aw / 2 + 0.08 * sc, ad); c.fill();
      if (z >= DREMPEL.klein - 1) {
        for (let k = 0; k < KRAT.length; k++) {
          c.fillStyle = KRAT[k]; c.beginPath();
          for (let s = 0; s < 8; s++) {
            if (s % KRAT.length !== k) continue;
            P(-2.9 + s * 0.3, -1.25 + (s & 1) * 0.12, q);
            const st = 1 + Math.floor(hash(h.zaad, s, 3) * 3);
            for (let e = 0; e < st; e++) c.rect(q[0] - 0.13 * sc, q[1] - 0.12 * sc * (e + 1), 0.26 * sc, 0.11 * sc);
          }
          c.fill();
        }
      }
      // netten op de kade, met twee vissers die ze boeten
      if (z >= DREMPEL.netten - 0.5) {
        c.fillStyle = this.sn ? 'rgba(80,90,84,0.6)' : 'rgba(54,70,60,0.85)'; c.beginPath(); vlak(0.5, 3.1, -2.4, -1.3); c.fill();
        c.strokeStyle = 'rgba(160,170,150,0.5)'; c.lineWidth = Math.max(0.4, T * 0.001); c.beginPath();
        for (let u = 0.6; u < 2.7; u += 0.3) { P(u, -2.4, q); c.moveTo(q[0], q[1]); P(u + 0.4, -1.3, q); c.lineTo(q[0], q[1]); }
        c.stroke();
        c.fillStyle = '#e8732f'; c.beginPath(); for (let u = 0.6; u < 3.1; u += 0.45) { P(u, -1.3, q); stip(c, q[0], q[1], Math.max(0.6, 0.05 * sc)); } c.fill();
        if (this.dagL > 0.4 && !ijs) for (let k = 0; k < 2; k++) { P(1.1 + k * 1.3, -1.15, q); this.zetMens(q[0], q[1], 0, 1, ZITTEND, [4, 3][k], Math.floor(hash(h.zaad, k, 5) * HUID.length), nu / 400 + k); }
      }
      // kotters aan de kade met trossen naar de bolders
      for (let k = 0; k < h.nk && nk < PLAFOND.kotters; k++) {
        nk++;
        const dein = ijs ? 0 : Math.sin(nu / 1100 + k * 1.7 + h.zaad) * 0.03 * sc, kant = hash(h.zaad, k, 6) < 0.5 ? 1 : -1;
        P(KOTTER_U[k], 0.75, q);
        const X = q[0], Y = q[1] + dein;
        this.kotter(c, X, Y, tx * kant, ty * kant, h.zaad + k * 13);
        if (z >= DREMPEL.klein - 1) {
          c.strokeStyle = '#d8d0b8'; c.lineWidth = Math.max(0.4, T * 0.0012); c.beginPath();
          for (const s of [-1, 1]) { const bx = X + tx * kant * s * 0.65 * sc, by = Y + ty * kant * s * 0.65 * sc; P(KOTTER_U[k] + s * 0.9, 0.05, q); c.moveTo(bx, by - 0.04 * sc); c.lineTo(q[0], q[1] - 0.03 * sc); }
          c.stroke();
        }
        if (this.nacht > 0.05) this.zetLicht(this.kTopX, this.kTopY, Math.max(1.5, T * 0.016), WIT, 0.85);
      }
      // hijskraantje op de kop van de kade
      if (z >= DREMPEL.kraan - 0.5) { P(3.4, -0.3, q); this.kraantje(c, q[0], q[1], nx, ny, h.zaad); }
      // meeuwen: rondjes boven de afslag en de boten, een paar op het dak; 's nachts zitten ze alleen op het dak
      if (z >= DREMPEL.meeuw - 0.5) {
        const nM = this.dagL < 0.3 ? 2 : 6 + Math.floor(hash(h.zaad, 7) * 4);
        c.strokeStyle = '#f4f4f0'; c.lineWidth = Math.max(0.6, T * 0.0018); c.beginPath();
        let zit = 0;
        for (let k = 0; k < nM && nm < PLAFOND.meeuwen; k++) {
          nm++;
          if (k < 2) { zit++; continue; }
          const hk = nu / (2600 + k * 300) * (k & 1 ? 1 : -1) + k * 1.9, R = (1.2 + hash(h.zaad, k, 8) * 1.5) * sc;
          P(-1 + hash(h.zaad, k, 9) * 2.5, -0.5, q);
          const mx = q[0] + Math.cos(hk) * R, my = q[1] + Math.sin(hk) * R * 0.5 - (0.9 + 0.3 * k) * sc, sl = Math.sin(nu / 160 + k) * 0.05 * sc, sp = 0.13 * sc;
          c.moveTo(mx - sp, my - sl); c.quadraticCurveTo(mx - sp * 0.4, my - sp * 0.5, mx, my); c.quadraticCurveTo(mx + sp * 0.4, my - sp * 0.5, mx + sp, my - sl);
        }
        c.stroke();
        c.fillStyle = '#f4f4f0'; c.beginPath();
        for (let k = 0; k < zit; k++) stip(c, ax - aw * 0.3 + k * aw * 0.45, ay - ah - ad * 0.55, Math.max(0.7, 0.06 * sc));
        c.fill();
      }
      if (this.nacht > 0.05) { this.zetLicht(ax, ay - ah * 0.6, Math.max(3, T * 0.04), WARM, 0.75); P(0, -0.4, q); this.zetLicht(q[0], q[1] - 0.6 * sc, Math.max(2, T * 0.03), WARM, 0.8); }
    }
    this.n.vissershavens = n; this.n.kotters = nk; this.n.meeuwen = nm;
  }

  // Veerstoepen: de oprit van beton van de wal naar de achtersteven, een loket, en auto's die eraf rijden als de
  // veerboot van leven.js ligt, en daarna de wachtrij die erop rijdt. Zelfde klok en dienstregeling als daar.
  tekenVeerstoepen(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, z = this.zoom, Tw = this.geo.T, tijd = this.nu / 1000;
    let n = 0, na = 0;
    c.globalAlpha = a;
    for (const v of this.veerstoepen) {
      if (n >= PLAFOND.veerstoepen || !this.inBeeld(v.x0, v.y0, v.x1, v.y1, 1)) continue;
      n++;
      const ex = v.ex, ey = v.ey, px = -ey, py = ex, br = 0.32;
      const X0 = v.sx * sc + ox, Y0 = v.sy * sc + oy, X1 = (v.sx + ex * v.L) * sc + ox, Y1 = (v.sy + ey * v.L) * sc + oy;
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); rechthoek(c, (X0 + X1) / 2 + 0.05 * sc, (Y0 + Y1) / 2 + 0.08 * sc, ex, ey, (v.L / 2) * sc, br * sc); c.fill();
      c.fillStyle = this.sn ? '#e2e5e7' : '#9a9690'; c.beginPath(); rechthoek(c, (X0 + X1) / 2, (Y0 + Y1) / 2, ex, ey, (v.L / 2) * sc, br * sc); c.fill();
      if (z >= DREMPEL.fijn + 1) {
        c.strokeStyle = '#e8c63a'; c.lineWidth = Math.max(0.5, 0.03 * sc); c.beginPath();
        for (const s of [-1, 1]) { c.moveTo(X0 + px * s * br * 0.85 * sc, Y0 + py * s * br * 0.85 * sc); c.lineTo(X1 + px * s * br * 0.85 * sc, Y1 + py * s * br * 0.85 * sc); }
        c.stroke();
        // loket naast de oprit op de wal
        const lx = X1 + px * 0.7 * sc, ly = Y1 + py * 0.7 * sc;
        c.fillStyle = '#ece6d8'; c.beginPath(); c.rect(lx - 0.2 * sc, ly - 0.3 * sc, 0.4 * sc, 0.3 * sc); c.fill();
        c.fillStyle = '#3f5d7a'; c.beginPath(); c.rect(lx - 0.24 * sc, ly - 0.38 * sc, 0.48 * sc, 0.09 * sc); c.fill();
      }
      if (this.nacht > 0.05) this.zetLicht(X1, Y1 - 0.5 * sc, Math.max(2, T * 0.03), WARM, 0.85);
      if (z < DREMPEL.auto - 0.5) continue;
      // dienstregeling van leven.js: varen, zes seconden liggen, terug, liggen
      const varen = v.len / (0.3 * Tw), liggen = 6, Pd = 2 * (varen + liggen), u = frac(tijd / Pd + hash(v.i, 141)) * Pd;
      const start = v.zij ? liggen + varen : 0, f = u >= start && u < start + liggen ? (u - start) / liggen : -1;
      const auto = (w, kl) => {
        if (na >= PLAFOND.autos) return;
        na++;
        const ax = (v.sx + ex * w) * sc + ox, ay = (v.sy + ey * w) * sc + oy;
        c.fillStyle = AUTO[Math.floor(kl) % AUTO.length]; c.beginPath(); rechthoek(c, ax, ay - 0.05 * sc, ex, ey, 0.2 * sc, 0.1 * sc); c.fill();
        if (z >= DREMPEL.klein) { c.fillStyle = 'rgba(30,40,50,0.6)'; c.beginPath(); rechthoek(c, ax - ex * 0.02 * sc, ay - 0.07 * sc - ey * 0.02 * sc, ex, ey, 0.09 * sc, 0.08 * sc); c.fill(); }
      };
      const rij = v.L + 0.6, wacht = (k) => v.L + 0.6 + k * 0.6;
      if (f >= 0 && f < 0.45) {
        // eraf: van de boot over de stoep de wal op
        for (let k = 0; k < 3; k++) { const w = (f / 0.45) * (rij + 1.2) - k * 0.75 - 0.3; if (w > 0.05 && w < rij + 0.6) auto(w, hash(v.zaad, k, 1) * 8); }
      } else if (f >= 0.5) {
        // erop: de wachtrij rijdt naar de boot
        for (let k = 0; k < v.nq; k++) { const g = clamp((f - 0.5 - k * 0.1) / 0.3, 0, 1), w = wacht(k) + (-0.3 - wacht(k)) * g; if (w > 0.05) auto(w, hash(v.zaad, k, 2) * 8); }
      } else for (let k = 0; k < v.nq; k++) auto(wacht(k), hash(v.zaad, k, 2) * 8);
    }
    this.n.veerstoepen = n; this.n.autos = na;
  }

  // ---------- voor tests en andere lagen ----------

  // Wat er dit beeld getekend is.
  telling() { return { ...this.n, sprites: this.cache.size }; }

  statistiek() {
    return {
      sprites: this.cache.size, bytes: this.bytes, gebakken: this.gebakken,
      vuurtorens: this.vuurtorens.length, havenhoofden: this.havenhoofden.length, boeien: this.boeien.length / 4, pieren: this.pieren.length,
      jachthavens: this.jachthavens.length, rotsen: this.rotsen.length / 6, rollers: this.rollers.length / 6, kades: this.kades.length,
      woonboten: this.woonboten.length, aken: this.aken.length, stuwen: this.stuwen.length, dammen: this.dammen.length,
      windparken: this.windparken.length, turbines: this.turbines.length / 4, booreilanden: this.booreilanden.length, viskwekerijen: this.viskwekerijen.length,
      // pakket D
      strandpunten: this.wereld ? this.wereld.strand.n : 0, vrijePunten: this.pv ? this.pv.reduce((t, v) => t + (v & P_VRIJ), 0) : 0, ...this.telDingen(),
      lopers: this.lopers.length / LOOP, duinpaden: this.duinpaden.length, rekken: this.duinpaden.filter((p) => p.rek).length, konijnen: this.konijnen.length / 3,
      dijken: this.dijken.length, schapen: this.schapen.length / 3, zandbanken: this.zandbanken.length, hengelplekken: this.hengelplekken.length / 6,
      sloepen: this.sloepen.length, kraantjes: this.kraantjes.length, vissershavens: this.vissershavens.length, veerstoepen: this.veerstoepen.length,
    };
  }

  // Strandinrichting per soort (wereld).
  telDingen() {
    const D = this.dingen, t = { huisjes: 0, paviljoens: 0, reddingsposten: 0, velden: 0, stoelsets: 0, schermen: 0, handdoeken: 0, kastelen: 0, gaten: 0 };
    const naam = ['huisjes', 'stoelsets', 'schermen', 'handdoeken', 'paviljoens', 'reddingsposten', 'velden', 'kastelen', 'gaten'];
    for (let j = 0; j < D.length; j += DING) t[naam[D[j]]]++;
    return t;
  }

  // Waar alles ligt (wereldcoördinaten), alleen-lezen: om naartoe te zoomen of te testen.
  plekken() { return this.plekLijst; }
}
