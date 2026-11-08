// De straat (pakket A van de detailronde): de openbare ruimte tussen de gebouwen van steden en hoofdsteden.
// - Vrije vakjes in de stad worden een plein (bestrating in een patroon, fontein, een abstract monument of obelisk,
//   kiosk, bloembakken, bomen in boomspiegels, terrasjes in lente en zomer, in december een lichtjesmarkt met
//   kraampjes) of een stadspark (gazon, grindpaden, vijver met fonteintje en eenden, muziektent, perk, een laag
//   muurtje met soms een kat erop). Ligt er een weg of water door een vakje, dan krijgt elk vrij kwart iets kleins:
//   een buurtpleintje, een groen hoekje of een parkeerplaats.
// - Langs de wegen in de stad: geparkeerde auto's in vakken op de berm, bankjes, brievenbussen, fietsen tegen een
//   lantaarnpaal, paaltjes en voetgangerslichten bij de zebra's (in de maat met de verkeerslichten van infra.js),
//   plassen na regen.
// - Bij een gebouw in aanbouw: een bouwhek rond het vakje en ernaast een werf met zand, pallets stenen, buizen, een
//   container, een betonmixer met draaiende trommel en een bouwlamp. De steigers en de kraan zelf zijn van detail.js.
// - 's Nachts (tekenLichten): lantaarns met een lichtplas, de kiosk, terraslampjes, lichtjes in de bomen van de
//   decembermarkt, de bouwlamp, voetgangerslichten en licht uit de etalages bij de stadsingang.
// Wat infra.js al langs de wegen zet (stoepranden, zebra's, stopstrepen, lantaarns, laanbomen, afvalbakken,
// brandkranen, kolken, putdeksels, haltes en borden) en wat detail.js op de gebouwvakjes tekent, komt hier niet
// nog eens: deze laag houdt die plekken vrij (zie kiesStraat) en tekent alleen op vrije grond.
// Alles komt trapsgewijs op (DREMPEL): zoom 4-6 de vlakken, bomen en hekken, 7-10 auto's, fonteinen, mensen en
// bankjes, 12-14 voegen, putjes, fietsen, plassen en de kat.
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Plaatsing uit vaste hashes van vakje en
// volgnummer; de klok (nu) stuurt alleen beweging. Geen Math.random, geen Date. Licht uit het noordwesten:
// schaduwen vallen naar het zuidoosten, hoge dingen staan schuin omhoog. Geen tekst, geen echte personen of
// symbolen: monumenten zijn abstract.

import { seizoen, weer } from './seizoen.js';
import { maakBasis, TerreinLaag } from './terrein.js';

// ---------- gedeelde hulpjes (eigen kopie, zie inzoom-spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
const tri = (v) => 1 - Math.abs(1 - 2 * frac(v));
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

// Canvasfabriek: in de browser een echt canvas, in tests een nep. Raakt document pas aan als er gebakken wordt.
const standaardFabriek = (w, h) => (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null);
let fabriek = standaardFabriek;
export function zetCanvasFabriek(fn) { fabriek = fn ?? standaardFabriek; }

// ---------- plafonds en drempels ----------

// Hooguit zoveel per beeld (wat in beeld is); de wereldlijsten zelf zijn ook begrensd (MAX_*).
export const PLAFOND = { vakjes: 60, bouwplaatsen: 12, autos: 180, bankjes: 50, brievenbussen: 24, paaltjes: 80, voetlichten: 40, fietsen: 40, plassen: 60, fonteinen: 16, eenden: 18, mensen: 90, ijscokarren: 4, kraampjes: 40, katten: 6, mixers: 8, lichten: 260, bakken: 2 };
// Vanaf welke zoom iets verschijnt (4-6 grof, 8-10 middel, 12-14 klein).
export const DREMPEL = { grond: 4.5, bouwhek: 6, etalage: 6, auto: 7, fontein: 7.5, mensen: 8.5, bank: 9, ijsco: 9, voetlicht: 10.5, brievenbus: 10.5, paaltje: 10.5, klein: 12 };
const TREDE1 = 8, TREDE2 = 12; // detail in de gebakken vakjes: 0 grof, 1 middel (vanaf zoom 8), 2 fijn (vanaf 12)
const VAK_BAK = 1.2; // gebakken vakje: een tiende tegel marge rondom, zodat boomkruinen, schaduwen en de obelisk niet afgeknipt worden
const MAX_SPRITES = 64, MAX_BYTES = 40 * 1024 * 1024, MAX_P = 640;
const MAX_VAKJES = 600, MAX_BOUW = 60, MAX_AUTOS = 3000, MAX_MEUBEL = 900, MAX_PLAS = 900, MAX_FIETS = 500, MAX_PAAL = 600, MAX_VOET = 400, MAX_ETALAGE = 400;

const W = 1000, H = 620; // wereld in eenheden
const RC = 2, RW = W / RC, RH = H / RC; // botsraster: vakjes van 2 eenheden (zelfde maat als kust.js)
const INFRA = 1, GEBOUW = 4, BOUWP = 8, WATER = 16; // bits in het raster (WATER alleen als masker: komt uit natCel)
const KUST_BIT = 4; // wat kust.js in zijn raster als eigen bouwsel merkt

const LEEG = 0, HOOFD = 1, STAD = 2, OVERIG = 3, BOUW = 4;
const ALIAS = { olieveld: 'centrale', staalfabriek: 'industrie', landbouw: 'boerderij', zware_industrie: 'industrie', ruimtevaartcentrum: 'chipfabriek', spoor: 'opslag' };
const PLEIN = 1, PARK = 2, DEEL = 3; // soorten vakje
const Q_PLEIN = 1, Q_GROEN = 2, Q_PARKEER = 3; // soorten kwart
const KWART = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]; // NW, NO, ZW, ZO

// lichtsoorten (zelfde nummering als kust.js)
const WARM = 0, ROOD = 1, GROEN = 2, KOEL = 3, WIT = 4, AMBER = 5;
const LICHTKLEUR = [[255, 200, 120], [255, 50, 40], [70, 255, 120], [235, 242, 255], [255, 250, 230], [255, 170, 40]];
const LICHT = 5; // x, y, r, soort, sterkte

// kleuren (in de toon van infra.js en detail.js)
const STOEP = '#aca79c', RAND = '#8f8b82', TEGEL = '#c9bfaa', TEGEL_D = '#b4a990', VOEG = 'rgba(95,85,70,0.18)';
const ASFALT = '#4a4a47', LIJN = '#ecebe4', HOUT = '#7a5236', HOUT_D = '#5b3f2a', PAAL = '#3a3d40';
const WATERK = '#4f8a98', WATER_D = '#3f7483', IJS = '#c9dce2', IJS_D = '#b2c8cf', GRIND = '#cdbf9c', GRIND_D = '#a8997a';
const GRAS = ['#78a050', '#6b9248', '#86894e', '#7d8862']; // lente, zomer, herfst, winter
const HAAG = ['#3f6a34', '#3a6230', '#5d6a34', '#46583c'];
const KROON = [['#6f9a48', '#5d8a3f'], ['#4a7a3a', '#3f6a34'], ['#c9902f', '#a0602e'], null];
const BLOEM = [['#e04a5a', '#f2c84a', '#f4f2ea', '#d86aa0'], ['#c43c8a', '#f08a3a', '#8a5ac8', '#e8d040'], ['#c9902f', '#b0503a', '#e0b040'], null];
const AUTOS = ['#c8ccd0', '#2c3e50', '#8e2a24', '#f2f2ef', '#3a6ea5', '#5b5f63', '#b08d3c', '#2f5d3a'];
const PARASOL = ['#b8442f', '#efe9da', '#2f6d9a', '#3d7a4f', '#d9a63a'];
const KLEDING = ['#3a5a8a', '#a8322d', '#e8e2d0', '#3d6b48', '#d9a63a', '#5a4a6a', '#2a2c30', '#8a6a4a'];
const HUID = ['#e8c4a0', '#c8956a', '#8a5a3a'];
const FIETS = ['#2a2c30', '#a8322d', '#2f5d8a', '#3d6b48', '#c8ccd0'];
const KAT = ['#2a2622', '#c9873a', '#8a8580', '#e8e2d6'];
const BUS_KLEUR = ['#c8432f', '#d9a63a']; // brievenbussen: alleen kleur, geen merk

// ---------- vaste indeling van plein en park (tegeleenheden, midden van het vakje is 0,0) ----------

const PL = {
  F: [0, 0.04, 0.125], // fontein: x, y, straal van de bak
  M: [0, -0.28], // monument
  K: [0.3, -0.3, 0.058], // kiosk
  bomen: [[-0.41, -0.36], [-0.41, -0.18], [-0.41, 0.0], [-0.36, 0.42], [-0.18, 0.42], [0, 0.42], [0.18, 0.42], [0.36, 0.42], [-0.22, -0.42], [0.14, -0.42]],
  lampen: [[-0.24, -0.16], [0.24, -0.16], [-0.11, 0.3], [0.11, 0.3]],
  perken: [[-0.36, 0.14, -0.14, 0.2], [-0.36, 0.25, -0.14, 0.31]],
  tafels: [[0.2, 0.17], [0.29, 0.17], [0.38, 0.17], [0.2, 0.27], [0.29, 0.27], [0.38, 0.27]],
  kramen: [[0.2, 0.17], [0.31, 0.17], [0.42, 0.17], [0.2, 0.28], [0.31, 0.28], [0.42, 0.28], [-0.3, -0.29], [-0.17, -0.3]],
  plassen: [[-0.27, 0.07], [0.06, -0.15], [0.33, 0.04], [-0.04, 0.33]],
  ijsco: [-0.27, -0.04], // tussen de bankjes rond de fontein en de bomenrij aan de westkant
};
const PK = {
  pad1: [-0.5, -0.02, -0.1, -0.2, 0.5, -0.04],
  pad2: [0.02, -0.5, 0.12, 0.1, -0.02, 0.5],
  V: [-0.2, 0.2, 0.15, 0.1], // vijver: x, y, rx, ry
  T: [0.27, 0.26, 0.06], // muziektent
  perk: [0.26, -0.27, 0.05],
  bomen: [[-0.4, -0.38, 0.05], [-0.24, -0.37, 0.045], [-0.1, -0.42, 0.04], [0.17, -0.4, 0.05], [0.4, -0.38, 0.055], [0.41, -0.16, 0.045], [0.42, 0.07, 0.05], [0.41, 0.4, 0.05], [0.15, 0.41, 0.045], [-0.42, 0.4, 0.05]],
  banken: [[1, 0.3, 1], [1, 0.72, -1], [2, 0.25, 1], [2, 0.7, -1]], // pad, t, kant
  lampen: [[1, 0.17, -1], [1, 0.55, -1], [1, 0.88, 1], [2, 0.84, 1]],
  ijsco: [1, 0.62, -1],
  MUUR: 0.465, // zuidmuur (y) met een opening voor pad 2
};
// buurtpleintje, groen hoekje en parkeerplaats (ten opzichte van het midden van het kwart)
const QP = { lamp: [-0.18, -0.18], banken: [[0.12, -0.16, 1, 0], [-0.16, 0.11, 0, 1]], tafels: [[0.05, 0.15], [0.15, 0.15], [0.15, 0.05]], plas: [-0.08, 0.06] };
const QG = { bomen: [[-0.13, -0.14, 0.045], [0.15, -0.12, 0.04], [0.13, 0.15, 0.045], [-0.15, 0.14, 0.035]], lamp: [-0.03, 0.17], bank: [0, -0.15] };
const QK = { lamp: [0.2, 0], automaat: [-0.2, 0] };
// Afstand van de vakken op de berm tot het midden van de weg (tegels): voorbij het looppad van leven.js (0,075) en
// vóór het fietspad van infra.js (vanaf 0,118), zodat voetgangers niet door de auto's lopen.
const BERM = 0.099;

// Punt en raaklijn op een kwadratische bezier (p: x0, y0, cx, cy, x1, y1).
function bez(p, t, uit) {
  const s = 1 - t;
  uit[0] = s * s * p[0] + 2 * s * t * p[2] + t * t * p[4];
  uit[1] = s * s * p[1] + 2 * s * t * p[3] + t * t * p[5];
  const dx = 2 * s * (p[2] - p[0]) + 2 * t * (p[4] - p[2]), dy = 2 * s * (p[3] - p[1]) + 2 * t * (p[5] - p[3]), l = Math.hypot(dx, dy) || 1;
  uit[2] = dx / l; uit[3] = dy / l;
  return uit;
}
const B4 = [0, 0, 0, 0];
// Plek naast een parkpad: [x, y, raaklijn x, raaklijn y].
function naastPad(pad, t, kant, af) {
  bez(pad === 1 ? PK.pad1 : PK.pad2, t, B4);
  return [B4[0] - B4[3] * kant * af, B4[1] + B4[2] * kant * af, B4[2], B4[3]];
}

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

function segAfstand(x, y, ax, ay, bx, by) { const lx = bx - ax, ly = by - ay, ll = lx * lx + ly * ly || 1, t = clamp(((x - ax) * lx + (y - ay) * ly) / ll, 0, 1); return Math.hypot(ax + lx * t - x, ay + ly * t - y); }

// Maat van gebakken bitmaps in stappen van een kwart octaaf: zoomen bakt niet elk beeld opnieuw.
const emmer = (px) => Math.min(MAX_P, Math.max(24, Math.round(Math.pow(2, Math.round(Math.log2(Math.max(1, px)) * 4) / 4))));

function bakGloed(cv, [r, g, b]) {
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gr.addColorStop(0.35, `rgba(${r},${g},${b},0.45)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = gr;
  c.fillRect(0, 0, 32, 32);
}

// ---------- bakken: kleine bouwstenen (tegeleenheden) ----------

function vlak(g, x0, y0, x1, y1, kleur) { g.fillStyle = kleur; g.fillRect(x0, y0, x1 - x0, y1 - y0); }

// Boom: schaduw naar het zuidoosten, stam, kroon opgetild met een lichte noordwestkant (zoals de laanbomen van
// infra.js). b.kroon null is kaal (winter); groen houdt een conifeer ook dan zijn naalden.
function boom(g, x, y, r, b, h, groen = false) {
  g.fillStyle = 'rgba(0,0,0,0.26)';
  g.beginPath(); g.ellipse(x + r * 0.6, y + r * 0.9, r, r * 0.7, 0.6, 0, TAU); g.fill();
  g.strokeStyle = '#4a3a2c'; g.lineWidth = r * 0.16;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - r * 0.8); g.stroke();
  if (!b.kroon && !groen) {
    g.strokeStyle = '#6b5a4a'; g.lineWidth = r * 0.07; g.beginPath();
    for (let t = 0; t < 6; t++) { const hk = -Math.PI / 2 + (t - 2.5) * 0.5; g.moveTo(x, y - r * 0.8); g.lineTo(x + Math.cos(hk) * r, y - r * 0.8 + Math.sin(hk) * r * 0.9); }
    g.stroke();
    if (b.sn) { g.fillStyle = 'rgba(244,246,248,0.75)'; g.beginPath(); g.ellipse(x - r * 0.15, y - r * 1.45, r * 0.4, r * 0.18, 0, 0, TAU); g.fill(); }
    return;
  }
  const kl = groen ? ['#2f5a3a', '#264a30'] : b.kroon;
  g.fillStyle = kl[1]; g.beginPath(); g.arc(x + r * 0.12, y - r * 1.0, r, 0, TAU); g.fill();
  g.fillStyle = kl[h < 0.5 ? 0 : 1]; g.beginPath(); g.arc(x - r * 0.06, y - r * 1.16, r * 0.88, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,215,0.2)'; g.beginPath(); g.arc(x - r * 0.32, y - r * 1.42, r * 0.45, 0, TAU); g.fill();
  if (groen && b.sn) { g.fillStyle = 'rgba(244,246,248,0.8)'; g.beginPath(); g.arc(x - r * 0.25, y - r * 1.38, r * 0.42, 0, TAU); g.fill(); }
  if (b.bloei && !groen && h < 0.55) {
    g.fillStyle = '#f3c8d4'; g.beginPath();
    for (let t = 0; t < 7; t++) { const a = t * 2.4 + h * 9; g.moveTo(x + Math.cos(a) * r * 0.55 + r * 0.1, y - r * 1.1 + Math.sin(a) * r * 0.55); g.arc(x + Math.cos(a) * r * 0.55, y - r * 1.1 + Math.sin(a) * r * 0.55, r * 0.1, 0, TAU); }
    g.fill();
  }
}

// Boomspiegel: een rooster in de bestrating om de stam.
function boomspiegel(g, x, y, b) {
  vlak(g, x - 0.022, y - 0.022, x + 0.022, y + 0.022, '#6a6050');
  if (b.trede >= 1) { g.strokeStyle = 'rgba(40,36,30,0.6)'; g.lineWidth = 0.002; g.strokeRect(x - 0.02, y - 0.02, 0.04, 0.04); }
}

// Bankje langs (hx, hy): zitting, rugleuning aan de noordkant, schaduw.
function bankje(g, x, y, hx, hy) {
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); rechthoek(g, x + 0.006, y + 0.008, hx, hy, 0.026, 0.009); g.fill();
  g.fillStyle = HOUT; g.beginPath(); rechthoek(g, x, y, hx, hy, 0.025, 0.007); g.fill();
  g.strokeStyle = HOUT_D; g.lineWidth = 0.003;
  const nx = -hy, ny = hx, k = ny < 0 || (ny === 0 && nx < 0) ? 1 : -1; // leuning aan de bovenkant (noord)
  g.beginPath(); g.moveTo(x - hx * 0.025 + nx * 0.007 * k, y - hy * 0.025 + ny * 0.007 * k); g.lineTo(x + hx * 0.025 + nx * 0.007 * k, y + hy * 0.025 + ny * 0.007 * k); g.stroke();
}

// Lantaarnpaal: schaduw schuin naar het zuidoosten, paal recht omhoog, kap bovenop. Het licht komt per beeld.
const LAMP_H = 0.065;
function lantaarn(g, x, y) {
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.005;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + LAMP_H * SCHUIN, y + LAMP_H * SCHUIN); g.stroke();
  g.strokeStyle = PAAL; g.lineWidth = 0.006;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - LAMP_H); g.stroke();
  g.fillStyle = '#2a2c2e'; g.beginPath(); g.ellipse(x, y - LAMP_H - 0.004, 0.012, 0.006, 0, 0, TAU); g.fill();
  g.fillStyle = '#e8e2c8'; g.beginPath(); g.arc(x, y - LAMP_H, 0.006, 0, TAU); g.fill();
}

// Bloemen in een perk (rechthoek) of rond; de kleuren volgen het seizoen, in de winter kale aarde of sneeuw.
function bloemen(g, x0, y0, x1, y1, b, zaad, rond = false) {
  const r = rnd(zaad), kl = b.bloem;
  const vorm = () => { g.beginPath(); if (rond) g.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, TAU); else g.rect(x0, y0, x1 - x0, y1 - y0); };
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.save(); g.translate(0.005, 0.006); vorm(); g.fill(); g.restore();
  g.fillStyle = RAND; vorm(); g.fill();
  const m = 0.006;
  g.fillStyle = '#5b4a38'; g.beginPath(); if (rond) g.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 - m, (y1 - y0) / 2 - m, 0, 0, TAU); else g.rect(x0 + m, y0 + m, x1 - x0 - 2 * m, y1 - y0 - 2 * m); g.fill();
  if (b.sn) { g.fillStyle = 'rgba(240,243,245,0.85)'; g.fill(); return; }
  if (!kl) { g.fillStyle = '#3f5a3a'; g.beginPath(); for (let i = 0; i < 6; i++) stip(g, x0 + m + r() * (x1 - x0 - 2 * m), y0 + m + r() * (y1 - y0 - 2 * m), 0.006); g.fill(); return; }
  g.fillStyle = '#4f7a3a'; g.beginPath(); if (rond) g.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 - m * 1.6, (y1 - y0) / 2 - m * 1.6, 0, 0, TAU); else g.rect(x0 + m * 1.6, y0 + m * 1.6, x1 - x0 - 3.2 * m, y1 - y0 - 3.2 * m); g.fill();
  const n = b.trede >= 2 ? 40 : b.trede >= 1 ? 18 : 8, st = b.trede >= 2 ? 0.0035 : 0.006;
  for (let k = 0; k < kl.length; k++) {
    g.fillStyle = kl[k]; g.beginPath();
    for (let i = 0; i < n / kl.length; i++) {
      let px = x0 + m * 2 + r() * (x1 - x0 - 4 * m), py = y0 + m * 2 + r() * (y1 - y0 - 4 * m);
      if (rond) { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, a = r() * TAU, d = Math.sqrt(r()) * ((x1 - x0) / 2 - m * 2.2); px = cx + Math.cos(a) * d; py = cy + Math.sin(a) * d * ((y1 - y0) / (x1 - x0)); }
      g.moveTo(px + st, py); g.arc(px, py, st, 0, TAU);
    }
    g.fill();
  }
}

function sneeuwhoop(g, x, y, r) {
  g.fillStyle = 'rgba(150,165,180,0.35)'; g.beginPath(); g.ellipse(x + r * 0.25, y + r * 0.3, r, r * 0.6, 0, 0, TAU); g.fill();
  g.fillStyle = '#eef1f3'; g.beginPath(); g.ellipse(x, y, r, r * 0.62, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.2, r * 0.45, r * 0.25, 0, 0, TAU); g.fill();
}

// Kiosk: achthoekig paviljoen met een koperen dak en een luikje; schuin omhoog getekend.
function kiosk(g, x, y, r, b) {
  const h = 0.04, S = SCHUIN;
  const acht = (cx, cy, rr) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i + 0.5) * TAU / 8; const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.8; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); };
  g.fillStyle = 'rgba(0,0,0,0.28)'; acht(x + h * S, y + h * S, r); g.fill();
  g.fillStyle = '#d9d2c0'; acht(x, y, r * 0.92); g.fill();
  g.fillStyle = '#e7e1d2'; g.fillRect(x - r * 0.8, y - h, r * 1.6, h);
  g.fillStyle = '#2f4152'; g.fillRect(x - r * 0.45, y - h * 0.8, r * 0.9, h * 0.45);
  if (b.trede >= 1) { g.fillStyle = HOUT; g.fillRect(x - r * 0.5, y - h * 0.32, r, h * 0.12); }
  g.fillStyle = b.sn ? '#eef1f3' : '#3f6a5a'; acht(x, y - h, r * 1.05); g.fill();
  g.strokeStyle = b.sn ? 'rgba(170,180,190,0.6)' : 'rgba(30,60,50,0.6)'; g.lineWidth = 0.003; g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i + 0.5) * TAU / 8; g.moveTo(x, y - h - r * 0.1); g.lineTo(x + Math.cos(a) * r * 1.05, y - h + Math.sin(a) * r * 0.84); }
  g.stroke();
  g.fillStyle = 'rgba(255,255,230,0.18)'; g.beginPath(); g.ellipse(x - r * 0.35, y - h - r * 0.3, r * 0.4, r * 0.22, 0, 0, TAU); g.fill();
  g.fillStyle = '#2a2c2e'; g.beginPath(); g.arc(x, y - h - r * 0.12, 0.005, 0, TAU); g.fill();
}

// Fonteinbak: stenen rand, water (of ijs, of een lege bak in de winter) en een sokkel in het midden.
function fonteinBak(g, x, y, r, b) {
  g.fillStyle = 'rgba(0,0,0,0.24)'; g.beginPath(); g.arc(x + 0.012, y + 0.014, r, 0, TAU); g.fill();
  g.fillStyle = '#b9b1a1'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.fillStyle = b.ijs ? IJS : b.uit ? '#7f8f96' : WATERK; g.beginPath(); g.arc(x, y, r * 0.86, 0, TAU); g.fill();
  g.fillStyle = b.ijs ? IJS_D : WATER_D; g.beginPath(); g.arc(x + r * 0.12, y + r * 0.12, r * 0.6, 0, TAU); g.fill();
  if (b.trede >= 1) {
    g.strokeStyle = 'rgba(255,255,240,0.45)'; g.lineWidth = 0.004; g.beginPath(); g.arc(x, y, r * 0.93, Math.PI * 1.05, Math.PI * 1.7); g.stroke();
    g.strokeStyle = 'rgba(70,60,50,0.35)'; g.beginPath(); g.arc(x, y, r * 0.86, 0, TAU); g.stroke();
  }
  if (b.ijs && b.trede >= 1) { g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 0.002; g.beginPath(); g.moveTo(x - r * 0.5, y - r * 0.2); g.lineTo(x + r * 0.1, y + r * 0.1); g.lineTo(x + r * 0.45, y - r * 0.15); g.stroke(); }
  g.fillStyle = '#a9a090'; g.beginPath(); g.arc(x, y, r * 0.24, 0, TAU); g.fill();
  g.fillStyle = '#c9c1b0'; g.beginPath(); g.arc(x - r * 0.04, y - r * 0.05, r * 0.16, 0, TAU); g.fill();
}

// Abstract monument op een sokkel: een obelisk, een staande ring of gestapelde blokken. Geen persoon, geen symbool.
function monument(g, x, y, soort, b) {
  const S = SCHUIN;
  // sokkel met trapje
  g.fillStyle = 'rgba(0,0,0,0.26)'; g.fillRect(x - 0.04 + 0.02, y - 0.03 + 0.02, 0.08, 0.06);
  vlak(g, x - 0.045, y - 0.032, x + 0.045, y + 0.032, '#a8a092');
  vlak(g, x - 0.035, y - 0.024, x + 0.035, y + 0.024, '#bdb5a6');
  if (soort === 0) {
    // obelisk: taps, linkerkant in het licht, rechterkant in de schaduw, met een spits
    const hh = 0.2, b0 = 0.018, b1 = 0.009;
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.moveTo(x - b0 * 0.7, y + b0 * 0.7); g.lineTo(x + b0 * 0.7, y - b0 * 0.7); g.lineTo(x + hh * S, y + hh * S - 0.004); g.closePath(); g.fill();
    g.fillStyle = '#d8d0c0'; g.beginPath(); g.moveTo(x - b0, y); g.lineTo(x - b1, y - hh); g.lineTo(x, y - hh); g.lineTo(x, y); g.closePath(); g.fill();
    g.fillStyle = '#a8a090'; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - hh); g.lineTo(x + b1, y - hh); g.lineTo(x + b0, y); g.closePath(); g.fill();
    g.fillStyle = '#e6dfd0'; g.beginPath(); g.moveTo(x - b1, y - hh); g.lineTo(x, y - hh - 0.022); g.lineTo(x, y - hh); g.closePath(); g.fill();
    g.fillStyle = '#9a9282'; g.beginPath(); g.moveTo(x + b1, y - hh); g.lineTo(x, y - hh - 0.022); g.lineTo(x, y - hh); g.closePath(); g.fill();
  } else if (soort === 1) {
    // staande bronzen ring
    const cy = y - 0.075;
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.012; g.beginPath(); g.ellipse(x + 0.045, y + 0.02, 0.05, 0.02, 0.5, 0, TAU); g.stroke();
    g.strokeStyle = '#6e5a3a'; g.lineWidth = 0.014; g.beginPath(); g.ellipse(x, cy, 0.034, 0.055, 0, 0, TAU); g.stroke();
    g.strokeStyle = '#a88a52'; g.lineWidth = 0.005; g.beginPath(); g.ellipse(x - 0.004, cy - 0.004, 0.034, 0.055, 0, Math.PI * 0.6, Math.PI * 1.4); g.stroke();
    vlak(g, x - 0.008, y - 0.022, x + 0.008, y, '#6e5a3a');
  } else {
    // gestapelde blokken, schuin op elkaar
    const blok = (bx, by, w, hh, licht, donker) => {
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(bx - w / 2 + hh * S, by - w / 2 + hh * S, w, w * 0.8);
      g.fillStyle = donker; g.fillRect(bx - w / 2, by - hh, w, hh);
      g.fillStyle = licht; g.fillRect(bx - w / 2, by - hh - w * 0.5, w, w * 0.5);
    };
    blok(x, y, 0.05, 0.04, '#cfc7b6', '#9a9282');
    blok(x + 0.008, y - 0.04, 0.038, 0.035, '#b89a62', '#7d6640');
    blok(x - 0.006, y - 0.075, 0.026, 0.03, '#d8d0c0', '#a8a090');
  }
  if (b.sn) { g.fillStyle = 'rgba(244,246,248,0.8)'; g.fillRect(x - 0.04, y - 0.03, 0.05, 0.012); }
}

// Terrastafel met stoeltjes; in het seizoen een parasol erboven (opgetild, schaduw naar het zuidoosten).
function tafel(g, x, y, kleur, b, parasol) {
  g.fillStyle = '#6a5a4a';
  for (let i = 0; i < 3; i++) { const a = 0.6 + i * 2.09; g.fillRect(x + Math.cos(a) * 0.019 - 0.004, y + Math.sin(a) * 0.016 - 0.004, 0.008, 0.008); }
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.arc(x + 0.004, y + 0.005, 0.012, 0, TAU); g.fill();
  g.fillStyle = '#e2ddd0'; g.beginPath(); g.arc(x, y, 0.012, 0, TAU); g.fill();
  if (!parasol) return;
  const py = y - 0.035;
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.arc(x + 0.035 * SCHUIN, py + 0.035 * SCHUIN + 0.035 * SCHUIN, 0.03, 0, TAU); g.fill();
  g.strokeStyle = '#8a8d90'; g.lineWidth = 0.0025; g.beginPath(); g.moveTo(x, y); g.lineTo(x, py); g.stroke();
  g.fillStyle = kleur; g.beginPath(); g.arc(x, py, 0.031, 0, TAU); g.fill();
  if (b.trede >= 1) {
    g.fillStyle = kleur === '#efe9da' ? '#b8442f' : '#efe9da';
    g.beginPath(); for (let i = 0; i < 8; i += 2) { g.moveTo(x, py); g.arc(x, py, 0.031, (i * TAU) / 8, ((i + 1) * TAU) / 8); g.closePath(); } g.fill();
  }
  g.fillStyle = 'rgba(255,255,230,0.2)'; g.beginPath(); g.arc(x - 0.01, py - 0.01, 0.014, 0, TAU); g.fill();
}

// Houten marktkraampje van de decembermarkt: zadeldak, toonbank aan de zuidkant. Geen symbolen, alleen lichtjes.
function kraampje(g, x, y, b) {
  const w = 0.042, d = 0.03, h = 0.028, S = SCHUIN;
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x - w + h * S, y - d + h * S, 2 * w, 2 * d);
  vlak(g, x - w, y + d - h, x + w, y + d, '#8a5a36');
  vlak(g, x - w * 0.85, y + d - h * 0.8, x + w * 0.85, y + d - h * 0.35, '#3a2a20');
  vlak(g, x - w * 0.9, y + d - h * 0.38, x + w * 0.9, y + d - h * 0.25, '#b07a4a');
  g.fillStyle = b.sn ? '#eef1f3' : '#5a3a26'; g.fillRect(x - w - 0.004, y - d - h, 2 * w + 0.008, d + 0.004);
  g.fillStyle = b.sn ? '#d5dadd' : '#4a2e1e'; g.fillRect(x - w - 0.004, y - h, 2 * w + 0.008, d * 0.9);
  g.strokeStyle = 'rgba(30,20,15,0.5)'; g.lineWidth = 0.002; g.beginPath(); g.moveTo(x - w, y - h); g.lineTo(x + w, y - h); g.stroke();
}

// Geparkeerde auto van boven, met de neus langs (hx, hy).
function auto(g, x, y, hx, hy, kleur) {
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); rechthoek(g, x + 0.006, y + 0.008, hx, hy, 0.03, 0.014); g.fill();
  g.fillStyle = kleur; g.beginPath(); rechthoek(g, x, y, hx, hy, 0.029, 0.013); g.fill();
  g.fillStyle = 'rgba(30,40,50,0.8)'; g.beginPath(); rechthoek(g, x + hx * 0.009, y + hy * 0.009, hx, hy, 0.008, 0.011); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.2)'; g.beginPath(); rechthoek(g, x - hx * 0.008, y - hy * 0.008, hx, hy, 0.011, 0.009); g.fill();
}

// ---------- bakken: hele vakjes ----------

// Bestrating met stoep en stoeprand rond (x0, y0)-(x1, y1); fijn: voegen en putjes.
function bestrating(g, x0, y0, x1, y1, b, zaad) {
  vlak(g, x0, y0, x1, y1, STOEP);
  const m = 0.03;
  vlak(g, x0 + m, y0 + m, x1 - m, y1 - m, TEGEL);
  g.strokeStyle = RAND; g.lineWidth = 0.008; g.strokeRect(x0 + m * 0.7, y0 + m * 0.7, x1 - x0 - m * 1.4, y1 - y0 - m * 1.4);
  g.strokeStyle = 'rgba(30,28,25,0.35)'; g.lineWidth = 0.003; g.beginPath(); g.moveTo(x0 + m * 0.7, y0 + m * 0.7 + 0.005); g.lineTo(x1 - m * 0.7, y0 + m * 0.7 + 0.005); g.stroke();
  if (b.trede >= 2) {
    // stoeptegels en voegen
    g.strokeStyle = VOEG; g.lineWidth = 0.0015; g.beginPath();
    for (let x = x0 + 0.025; x < x1; x += 0.025) { g.moveTo(x, y0 + m); g.lineTo(x, y1 - m); }
    for (let y = y0 + 0.025; y < y1; y += 0.025) { g.moveTo(x0 + m, y); g.lineTo(x1 - m, y); }
    for (let x = x0 + 0.02; x < x1; x += 0.02) { g.moveTo(x, y0 + 0.002); g.lineTo(x, y0 + m * 0.6); g.moveTo(x, y1 - m * 0.6); g.lineTo(x, y1 - 0.002); }
    for (let y = y0 + 0.02; y < y1; y += 0.02) { g.moveTo(x0 + 0.002, y); g.lineTo(x0 + m * 0.6, y); g.moveTo(x1 - m * 0.6, y); g.lineTo(x1 - 0.002, y); }
    g.stroke();
    // putjes langs de rand en een paar verkleurde tegels
    const r = rnd(zaad);
    vlak(g, x0 + m + 0.004, y0 + (y1 - y0) * 0.5 - 0.004, x0 + m + 0.012, y0 + (y1 - y0) * 0.5 + 0.004, '#3a3a38');
    vlak(g, x1 - m - 0.012, y0 + (y1 - y0) * 0.3 - 0.004, x1 - m - 0.004, y0 + (y1 - y0) * 0.3 + 0.004, '#3a3a38');
    g.fillStyle = 'rgba(120,105,85,0.18)';
    for (let i = 0; i < 6; i++) { const tx = x0 + m + Math.floor(r() * (x1 - x0 - 2 * m) / 0.025) * 0.025, ty = y0 + m + Math.floor(r() * (y1 - y0 - 2 * m) / 0.025) * 0.025; g.fillRect(tx, ty, 0.025, 0.025); }
  }
}

// Sneeuw op bestrating: een dun laagje en hopen langs de rand; de looplijnen zijn geveegd.
function sneeuwOpBestrating(g, x0, y0, x1, y1, b, zaad) {
  if (!b.sn) return;
  const r = rnd(zaad + 7);
  g.fillStyle = b.sn === 2 ? 'rgba(238,242,244,0.7)' : 'rgba(238,242,244,0.4)';
  g.fillRect(x0 + 0.03, y0 + 0.03, x1 - x0 - 0.06, y1 - y0 - 0.06);
  for (let i = 0; i < 6; i++) {
    const t = r(), kant = Math.floor(r() * 4), m = 0.05;
    const x = kant < 2 ? x0 + m + t * (x1 - x0 - 2 * m) : kant === 2 ? x0 + m : x1 - m, y = kant >= 2 ? y0 + m + t * (y1 - y0 - 2 * m) : kant === 0 ? y0 + m : y1 - m;
    sneeuwhoop(g, x, y, 0.018 + r() * 0.012);
  }
}

function gazon(g, x0, y0, x1, y1, b) {
  vlak(g, x0, y0, x1, y1, b.gras);
  if (b.trede >= 1 && !b.sn) {
    // maaibanen
    g.fillStyle = 'rgba(255,255,220,0.06)';
    for (let x = x0; x < x1; x += 0.06) g.fillRect(x, y0, 0.03, y1 - y0);
  }
  if (b.sn) { g.fillStyle = b.sn === 2 ? 'rgba(240,243,245,0.88)' : 'rgba(240,243,245,0.6)'; g.fillRect(x0, y0, x1 - x0, y1 - y0); }
}

function bakPlein(g, v, b) {
  bestrating(g, -0.5, -0.5, 0.5, 0.5, b, v.zaad);
  const [fx, fy, fr] = PL.F;
  if (b.trede >= 1) {
    // patroon: ringen en spaken in donkerder steen rond de fontein
    g.strokeStyle = TEGEL_D; g.lineWidth = 0.014; g.beginPath(); g.arc(fx, fy, fr + 0.07, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(120,108,90,0.35)'; g.lineWidth = 0.004; g.beginPath(); g.arc(fx, fy, fr + 0.15, 0, TAU);
    for (let i = 0; i < 12; i++) { const a = (i * TAU) / 12; g.moveTo(fx + Math.cos(a) * (fr + 0.02), fy + Math.sin(a) * (fr + 0.02)); g.lineTo(fx + Math.cos(a) * (fr + 0.15), fy + Math.sin(a) * (fr + 0.15)); }
    g.stroke();
  }
  sneeuwOpBestrating(g, -0.5, -0.5, 0.5, 0.5, b, v.zaad);
  for (let i = 0; i < PL.bomen.length; i++) boomspiegel(g, PL.bomen[i][0], PL.bomen[i][1], b);
  for (const p of PL.perken) bloemen(g, p[0], p[1], p[2], p[3], b, v.zaad + p[1] * 1000);
  fonteinBak(g, fx, fy, fr, b);
  for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2, rx = fx + Math.cos(a) * (fr + 0.07), ry = fy + Math.sin(a) * (fr + 0.07); bankje(g, rx, ry, -Math.sin(a), Math.cos(a)); }
  if (b.kerst) for (const [x, y] of PL.kramen) kraampje(g, x, y, b);
  else for (let i = 0; i < PL.tafels.length; i++) { const [x, y] = PL.tafels[i]; if (b.terras || b.trede >= 1) tafel(g, x, y, PARASOL[Math.floor(hash(v.zaad, i, 31) * PARASOL.length)], b, b.terras); }
  kiosk(g, PL.K[0], PL.K[1], PL.K[2], b);
  monument(g, PL.M[0], PL.M[1], v.monument, b);
  for (const [x, y] of PL.lampen) lantaarn(g, x, y);
  if (b.kerst) {
    // lichtsnoeren tussen de lantaarns (de lampjes zelf branden per beeld)
    g.strokeStyle = 'rgba(40,40,40,0.55)'; g.lineWidth = 0.002; g.beginPath();
    for (let i = 0; i < v.snoer.length; i += 6) { const s = v.snoer; g.moveTo(s[i], s[i + 1]); g.quadraticCurveTo(s[i + 2], s[i + 3], s[i + 4], s[i + 5]); }
    g.stroke();
  }
  for (let i = 0; i < PL.bomen.length; i++) { const [x, y] = PL.bomen[i]; boom(g, x, y, 0.045 + 0.012 * hash(v.zaad, i, 11), b, hash(v.zaad, i, 12)); }
}

function bakPark(g, v, b) {
  gazon(g, -0.5, -0.5, 0.5, 0.5, b);
  // haag rondom met openingen waar de paden het park uit gaan; aan de zuidkant een laag muurtje
  const haag = b.sn ? '#c9d0cc' : b.haag, hw = 0.026;
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(-0.5, -0.5 + hw, 1, 0.01); g.fillRect(0.5 - hw - 0.01, -0.5, 0.01, 1);
  g.fillStyle = haag;
  g.fillRect(-0.5, -0.5, 0.5 + 0.02 - 0.06, hw); g.fillRect(0.02 + 0.06, -0.5, 0.5 - 0.08, hw);
  g.fillRect(-0.5, -0.5, hw, 0.5 - 0.02 - 0.06); g.fillRect(-0.5, -0.02 + 0.06, hw, 0.5 - 0.04 + 0.04 - 0.06);
  g.fillRect(0.5 - hw, -0.5, hw, 0.5 - 0.04 - 0.06); g.fillRect(0.5 - hw, -0.04 + 0.06, hw, 0.5 + 0.04 - 0.06);
  if (b.trede >= 1) { g.fillStyle = 'rgba(255,255,220,0.12)'; g.fillRect(-0.5, -0.5, 1, hw * 0.4); g.fillRect(-0.5, -0.5, hw * 0.4, 1); }
  // paden van grind
  const pad = (p, br) => { g.lineWidth = br; g.beginPath(); g.moveTo(p[0], p[1]); g.quadraticCurveTo(p[2], p[3], p[4], p[5]); g.stroke(); };
  const [vx, vy, vrx, vry] = PK.V;
  g.lineCap = 'butt';
  for (const [kl, br] of [[GRIND_D, 0.04], [b.sn ? '#d9dcda' : GRIND, 0.032]]) {
    g.strokeStyle = kl; pad(PK.pad1, br); pad(PK.pad2, br);
    g.lineWidth = br; g.beginPath(); g.ellipse(vx, vy, vrx + 0.05, vry + 0.045, 0, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(vx + vrx + 0.05, vy); g.lineTo(0.07, vy); g.stroke();
  }
  // vijver: oeverrand, water of ijs, riet
  g.fillStyle = '#8a7f68'; g.beginPath(); g.ellipse(vx, vy, vrx + 0.008, vry + 0.008, 0, 0, TAU); g.fill();
  g.fillStyle = b.ijs ? IJS : WATERK; g.beginPath(); g.ellipse(vx, vy, vrx, vry, 0, 0, TAU); g.fill();
  g.fillStyle = b.ijs ? IJS_D : WATER_D; g.beginPath(); g.ellipse(vx + 0.02, vy + 0.015, vrx * 0.65, vry * 0.6, 0, 0, TAU); g.fill();
  if (b.trede >= 1) {
    g.strokeStyle = 'rgba(255,255,240,0.35)'; g.lineWidth = 0.003; g.beginPath(); g.ellipse(vx, vy, vrx * 0.95, vry * 0.92, 0, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
    g.strokeStyle = b.gs === 3 ? '#8a7a52' : '#5a6a3a'; g.lineWidth = 0.003; g.beginPath();
    const r = rnd(v.zaad + 3);
    for (let i = 0; i < 18; i++) { const a = (i < 9 ? 3.4 : 0.2) + r() * 0.9, rx = vx + Math.cos(a) * vrx * 0.95, ry = vy + Math.sin(a) * vry * 0.95; g.moveTo(rx, ry); g.lineTo(rx + (r() - 0.5) * 0.006, ry - 0.016 - r() * 0.01); }
    g.stroke();
  }
  if (b.trede >= 2 && b.gs === 1 && !b.ijs) {
    // waterlelies
    const r = rnd(v.zaad + 5);
    g.fillStyle = '#4f7a3a'; g.beginPath(); for (let i = 0; i < 7; i++) stip(g, vx + (r() - 0.2) * vrx * 0.8, vy + (r() - 0.5) * vry * 0.9, 0.007); g.fill();
    g.fillStyle = '#f2e8f0'; g.beginPath(); for (let i = 0; i < 3; i++) stip(g, vx + (r() - 0.2) * vrx * 0.8, vy + (r() - 0.5) * vry * 0.9, 0.003); g.fill();
  }
  // fonteintje in de vijver: een steen in het midden
  g.fillStyle = '#a9a090'; g.beginPath(); g.arc(vx, vy, 0.012, 0, TAU); g.fill();
  bloemen(g, PK.perk[0] - PK.perk[2], PK.perk[1] - PK.perk[2] * 0.8, PK.perk[0] + PK.perk[2], PK.perk[1] + PK.perk[2] * 0.8, b, v.zaad + 11, true);
  // muziektent: rond platform, paaltjes, kegeldak
  const [tx, ty, tr] = PK.T, th = 0.05, S = SCHUIN;
  g.fillStyle = 'rgba(0,0,0,0.26)'; g.beginPath(); g.ellipse(tx + th * S, ty + th * S, tr, tr * 0.8, 0, 0, TAU); g.fill();
  g.fillStyle = '#d9d2c0'; g.beginPath(); g.ellipse(tx, ty, tr, tr * 0.8, 0, 0, TAU); g.fill();
  g.fillStyle = '#b9b2a0'; g.fillRect(tx - tr, ty, tr * 2, 0.008);
  g.strokeStyle = '#efe9da'; g.lineWidth = 0.004; g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i * TAU) / 8; if (Math.sin(a) < -0.2) continue; const px = tx + Math.cos(a) * tr * 0.85, py = ty + Math.sin(a) * tr * 0.68; g.moveTo(px, py); g.lineTo(px, py - th); }
  g.stroke();
  g.fillStyle = b.sn ? '#eef1f3' : '#7a2f2a'; g.beginPath(); g.ellipse(tx, ty - th, tr * 1.08, tr * 0.86, 0, 0, TAU); g.fill();
  g.fillStyle = b.sn ? '#d5dadd' : '#5e2420'; g.beginPath(); g.moveTo(tx, ty - th - 0.03); g.lineTo(tx + tr * 1.08, ty - th); g.ellipse(tx, ty - th, tr * 1.08, tr * 0.86, 0, 0, Math.PI); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,230,0.2)'; g.beginPath(); g.moveTo(tx, ty - th - 0.03); g.lineTo(tx - tr * 1.08, ty - th); g.lineTo(tx - tr * 0.2, ty - th - tr * 0.6); g.closePath(); g.fill();
  // zuidmuur in twee stukken (opening voor pad 2), met schaduw naar het zuidoosten
  const my = PK.MUUR, mh = 0.022;
  for (const [a, e] of [[-0.49, -0.07], [0.05, 0.49]]) {
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.moveTo(a, my); g.lineTo(e, my); g.lineTo(e + mh * S, my + mh * S); g.lineTo(a + mh * S, my + mh * S); g.closePath(); g.fill();
    vlak(g, a, my - mh, e, my, '#9a6a50');
    vlak(g, a, my - mh - 0.012, e, my - mh, b.sn ? '#eef1f3' : '#b7856a');
    if (b.trede >= 2) { g.strokeStyle = 'rgba(60,35,25,0.35)'; g.lineWidth = 0.0012; g.beginPath(); for (let y = my - mh + 0.007; y < my; y += 0.007) { g.moveTo(a, y); g.lineTo(e, y); } for (let x = a + 0.012; x < e; x += 0.024) { g.moveTo(x, my - mh); g.lineTo(x, my - mh + 0.007); g.moveTo(x + 0.012, my - mh + 0.007); g.lineTo(x + 0.012, my - mh + 0.014); } g.stroke(); }
  }
  for (const [p, t, k] of PK.banken) { const [x, y, hx, hy] = naastPad(p, t, k, 0.036); bankje(g, x, y, hx, hy); }
  for (const [p, t, k] of PK.lampen) { const [x, y] = naastPad(p, t, k, 0.03); lantaarn(g, x, y); }
  for (let i = 0; i < PK.bomen.length; i++) { const [x, y, r] = PK.bomen[i]; boom(g, x, y, r, b, hash(v.zaad, i, 12), hash(v.zaad, i, 13) < 0.25); }
}

function bakKwart(g, v, b, kw, soort) {
  const [qx, qy] = KWART[kw], m = 0.24, zaad = v.zaad * 4 + kw;
  if (soort === Q_PLEIN) {
    bestrating(g, qx - m, qy - m, qx + m, qy + m, b, zaad);
    sneeuwOpBestrating(g, qx - m, qy - m, qx + m, qy + m, b, zaad);
    boomspiegel(g, qx, qy, b);
    g.strokeStyle = HOUT; g.lineWidth = 0.008; g.beginPath(); g.arc(qx, qy, 0.042, 0, TAU); g.stroke();
    for (const [x, y, hx, hy] of QP.banken) bankje(g, qx + x, qy + y, hx, hy);
    for (let i = 0; i < QP.tafels.length; i++) { const [x, y] = QP.tafels[i]; if (b.terras && !b.kerst) tafel(g, qx + x, qy + y, PARASOL[Math.floor(hash(zaad, i, 31) * PARASOL.length)], b, true); }
    lantaarn(g, qx + QP.lamp[0], qy + QP.lamp[1]);
    boom(g, qx, qy, 0.05, b, hash(zaad, 12));
  } else if (soort === Q_GROEN) {
    gazon(g, qx - m, qy - m, qx + m, qy + m, b);
    g.strokeStyle = b.sn ? '#d9dcda' : GRIND; g.lineWidth = 0.026; g.beginPath(); g.arc(qx, qy, 0.12, 0, TAU); g.stroke();
    bloemen(g, qx - 0.05, qy - 0.04, qx + 0.05, qy + 0.04, b, zaad + 3, true);
    bankje(g, qx + QG.bank[0], qy + QG.bank[1] - 0.012, 1, 0);
    lantaarn(g, qx + QG.lamp[0], qy + QG.lamp[1]);
    for (let i = 0; i < QG.bomen.length; i++) { if (hash(zaad, i, 14) < 0.2) continue; const [x, y, r] = QG.bomen[i]; boom(g, qx + x, qy + y, r, b, hash(zaad, i, 12), hash(zaad, i, 13) < 0.3); }
  } else {
    // parkeerplaats: asfalt, vakken in twee rijen, auto's, een automaat en een lantaarn
    vlak(g, qx - m, qy - m, qx + m, qy + m, STOEP);
    vlak(g, qx - m + 0.018, qy - m + 0.018, qx + m - 0.018, qy + m - 0.018, ASFALT);
    g.strokeStyle = RAND; g.lineWidth = 0.006; g.strokeRect(qx - m + 0.015, qy - m + 0.015, 2 * m - 0.03, 2 * m - 0.03);
    g.strokeStyle = LIJN; g.lineWidth = 0.004; g.beginPath();
    for (let i = 0; i <= 5; i++) { const x = qx - 0.2125 + i * 0.085; g.moveTo(x, qy - 0.205); g.lineTo(x, qy - 0.1); g.moveTo(x, qy + 0.1); g.lineTo(x, qy + 0.205); }
    g.stroke();
    if (b.trede >= 2) { g.strokeStyle = 'rgba(20,20,20,0.25)'; g.lineWidth = 0.002; g.beginPath(); g.moveTo(qx - 0.18, qy + 0.02); g.lineTo(qx - 0.1, qy - 0.03); g.lineTo(qx - 0.02, qy + 0.01); g.stroke(); }
    for (let rij = 0; rij < 2; rij++) for (let i = 0; i < 5; i++) {
      if (hash(zaad, rij * 5 + i, 41) > 0.68) continue;
      const x = qx - 0.17 + i * 0.085, y = qy + (rij ? 0.152 : -0.152), hy = hash(zaad, rij * 5 + i, 42) < 0.8 ? (rij ? 1 : -1) : rij ? -1 : 1;
      auto(g, x, y, 0, hy, AUTOS[Math.floor(hash(zaad, rij * 5 + i, 43) * AUTOS.length)]);
      if (b.sn) { g.fillStyle = 'rgba(244,246,248,0.85)'; g.beginPath(); rechthoek(g, x, y, 0, 1, 0.012, 0.01); g.fill(); }
    }
    vlak(g, qx + QK.automaat[0] - 0.006, qy + QK.automaat[1] - 0.012, qx + QK.automaat[0] + 0.006, qy + QK.automaat[1], '#3a4a5a');
    vlak(g, qx + QK.automaat[0] - 0.004, qy + QK.automaat[1] - 0.01, qx + QK.automaat[0] + 0.004, qy + QK.automaat[1] - 0.006, '#d9a63a');
    lantaarn(g, qx + QK.lamp[0], qy + QK.lamp[1]);
    if (b.sn) for (const [dx, dy] of [[-1, -1], [1, 1], [1, -1]]) sneeuwhoop(g, qx + dx * 0.2, qy + dy * 0.2, 0.03);
  }
}

function bakVakje(g, v, b) {
  if (v.soort === PLEIN) bakPlein(g, v, b);
  else if (v.soort === PARK) bakPark(g, v, b);
  else for (let kw = 0; kw < 4; kw++) if (v.kw[kw]) bakKwart(g, v, b, kw, v.kw[kw]);
}

// ---------- bakken: bouwplaats (hek en werf rond een vakje in aanbouw) ----------

// Lokaal kader per zijde: u langs de zijde, w naar buiten. 0 noord, 1 oost, 2 zuid, 3 west.
function zijPunt(zijde, u, w) { return zijde === 0 ? [u, -w] : zijde === 1 ? [w, u] : zijde === 2 ? [u, w] : [-w, u]; }
const HEK_W = 0.53, HEK_H = 0.03, WERF_W = 0.63;

function bakBouw(g, o, b) {
  const S = SCHUIN;
  // bouwhek: panelen met gaas op betonnen voetjes; per zijde vier stukken, alleen waar het vrij is
  for (let zijde = 0; zijde < 4; zijde++) for (let k = 0; k < 4; k++) {
    if (!(o.hek & (1 << (zijde * 4 + k)))) continue;
    const u0 = -0.5 + k * 0.25 + 0.01, u1 = u0 + 0.23;
    const [ax, ay] = zijPunt(zijde, u0, HEK_W), [bx, by] = zijPunt(zijde, u1, HEK_W);
    g.fillStyle = 'rgba(0,0,0,0.16)'; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(bx + HEK_H * S, by + HEK_H * S); g.lineTo(ax + HEK_H * S, ay + HEK_H * S); g.closePath(); g.fill();
    g.fillStyle = o.doek & (1 << k) ? 'rgba(46,110,181,0.75)' : 'rgba(215,218,212,0.3)';
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(bx, by - HEK_H); g.lineTo(ax, ay - HEK_H); g.closePath(); g.fill();
    if (b.trede >= 1) {
      g.strokeStyle = 'rgba(200,204,198,0.45)'; g.lineWidth = 0.0012; g.beginPath();
      const n = 14;
      for (let i = 0; i <= n; i++) { const t = i / n, px = ax + (bx - ax) * t, py = ay + (by - ay) * t; g.moveTo(px, py); g.lineTo(px + (bx - ax) / n, py + (by - ay) / n - HEK_H); }
      g.stroke();
    }
    g.strokeStyle = '#c9ccc6'; g.lineWidth = 0.003; g.beginPath(); g.moveTo(ax, ay - HEK_H); g.lineTo(bx, by - HEK_H); g.moveTo(ax, ay); g.lineTo(bx, by);
    for (let i = 0; i <= 4; i++) { const px = ax + (bx - ax) * i / 4, py = ay + (by - ay) * i / 4; g.moveTo(px, py); g.lineTo(px, py - HEK_H); }
    g.stroke();
    g.fillStyle = '#8a8780';
    for (let i = 0; i <= 4; i++) { const px = ax + (bx - ax) * i / 4, py = ay + (by - ay) * i / 4; g.fillRect(px - 0.008, py - 0.003, 0.016, 0.007); }
  }
  if (o.werf < 0) return;
  const z = o.werf, P = (u, w) => zijPunt(z, u, w), r = rnd(o.zaad);
  // zandhoop
  { const [x, y] = P(-0.3, WERF_W); g.fillStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.ellipse(x + 0.012, y + 0.01, 0.065, 0.04, 0, 0, TAU); g.fill(); g.fillStyle = b.sn ? '#e4e6e4' : '#c9ad7a'; g.beginPath(); g.ellipse(x, y, 0.065, 0.04, 0, 0, TAU); g.fill(); g.fillStyle = b.sn ? 'rgba(255,255,255,0.7)' : 'rgba(255,240,200,0.35)'; g.beginPath(); g.ellipse(x - 0.015, y - 0.01, 0.035, 0.02, 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(110,80,40,0.25)'; g.beginPath(); g.ellipse(x + 0.018, y + 0.012, 0.035, 0.018, 0, 0, TAU); g.fill(); }
  // pallets met stenen
  for (let i = 0; i < 2; i++) {
    const [x, y] = P(-0.17 + i * 0.06, WERF_W - 0.015 + i * 0.03);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x - 0.022 + 0.01, y - 0.018 + 0.01, 0.044, 0.036);
    vlak(g, x - 0.022, y - 0.018, x + 0.022, y + 0.018, '#a67c52');
    vlak(g, x - 0.019, y - 0.03, x + 0.019, y + 0.006, '#8a3a2c');
    vlak(g, x - 0.019, y - 0.03, x + 0.019, y - 0.014, '#a8483a');
    if (b.trede >= 1) { g.strokeStyle = 'rgba(60,25,20,0.4)'; g.lineWidth = 0.0015; g.beginPath(); for (let k = 1; k < 4; k++) { g.moveTo(x - 0.019 + k * 0.0095, y - 0.03); g.lineTo(x - 0.019 + k * 0.0095, y - 0.014); } g.moveTo(x - 0.019, y - 0.022); g.lineTo(x + 0.019, y - 0.022); g.stroke(); }
  }
  // rioolbuizen, twee onder en één erop
  {
    const [x, y] = P(0.02, WERF_W), hor = z === 0 || z === 2;
    for (const [dx, dy] of [[-0.012, 0.008], [0.012, 0.008], [0, -0.006]]) {
      const px = x + (hor ? 0 : dx), py = y + (hor ? dx : 0) + dy;
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); rechthoek(g, px + 0.006, py + 0.008, hor ? 1 : 0, hor ? 0 : 1, 0.04, 0.011); g.fill();
      g.fillStyle = '#9a968e'; g.beginPath(); rechthoek(g, px, py, hor ? 1 : 0, hor ? 0 : 1, 0.04, 0.011); g.fill();
      g.fillStyle = '#5a5852'; g.beginPath(); g.arc(px + (hor ? -0.04 : 0), py + (hor ? 0 : -0.04), 0.008, 0, TAU); g.fill();
    }
  }
  // afvalcontainer met puin
  {
    const [x, y] = P(0.17, WERF_W), hor = z === 0 || z === 2, hl = hor ? 0.05 : 0.026, hb = hor ? 0.026 : 0.05;
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x - hl + 0.014, y - hb + 0.014, hl * 2, hb * 2);
    vlak(g, x - hl, y - hb, x + hl, y + hb, '#c8432f');
    vlak(g, x - hl + 0.006, y - hb + 0.006, x + hl - 0.006, y + hb - 0.006, '#6a5a4a');
    g.fillStyle = '#8a8478'; g.beginPath(); for (let i = 0; i < (b.trede >= 1 ? 10 : 4); i++) stip(g, x + (r() - 0.5) * (hl * 2 - 0.016), y + (r() - 0.5) * (hb * 2 - 0.016), 0.005); g.fill();
    if (b.trede >= 1) { g.strokeStyle = 'rgba(80,20,15,0.45)'; g.lineWidth = 0.002; g.strokeRect(x - hl, y - hb, hl * 2, hb * 2); }
  }
  // toilethokje en de voet van de bouwlamp
  { const [x, y] = P(-0.43, WERF_W - 0.02); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x - 0.01 + 0.01, y - 0.01 + 0.01, 0.02, 0.02); vlak(g, x - 0.01, y - 0.026, x + 0.01, y + 0.01, '#27ae60'); vlak(g, x - 0.01, y - 0.03, x + 0.01, y - 0.022, '#1f8a4c'); }
  { const [x, y] = o.lampLok; g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.004; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.09 * S, y + 0.09 * S); g.stroke(); g.strokeStyle = '#5a5d60'; g.lineWidth = 0.005; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 0.09); g.stroke(); vlak(g, x - 0.012, y - 0.1, x + 0.012, y - 0.088, '#2a2c2e'); vlak(g, x - 0.009, y - 0.097, x + 0.009, y - 0.091, '#f4f0d8'); }
  // bandensporen in de grond
  if (b.trede >= 1 && !b.sn) { const [x0, y0] = P(-0.45, 0.56), [x1, y1] = P(0.45, 0.56); g.strokeStyle = 'rgba(80,60,40,0.18)'; g.lineWidth = 0.005; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
}

// ---------- de laag ----------

const wereldCache = new WeakMap(); // basis → natte cellen (0 onbekend, 1 droog, 2 nat)

export class StadLaag {
  constructor() {
    this.state = null;
    this.geo = null;
    this.eigenaar = null;
    this.basis = null;
    this.tl = null;
    this.sig = '';
    this.raster = new Uint8Array(RW * RH);
    this.nat = null;
    this.soort = null;
    this.nabij = null;
    this.cache = new Map(); // sleutel → gebakken bitmap, in LRU-volgorde
    this.laatste = new Map(); // vakje → laatst gebakken bitmap (vervanger tijdens zoomen en seizoenswissel)
    this.bytes = 0;
    this.gebakken = 0;
    this.bakTeller = 0;
    this.licht = new Float32Array(PLAFOND.lichten * LICHT);
    this.zv = new Int32Array(PLAFOND.vakjes); // zichtbare vakjes
    this.zb = new Int32Array(PLAFOND.bouwplaatsen); // zichtbare bouwplaatsen
    this.zi = new Int32Array(Math.max(PLAFOND.autos, PLAFOND.plassen, PLAFOND.fietsen)); // zichtbare straatdingen
    this.fig = new Float32Array(PLAFOND.mensen * 4); // figuren: x, y, kleding, huid (scherm)
    this.zbank = new Int32Array(PLAFOND.bankjes); this.zbus = new Int32Array(PLAFOND.brievenbussen); this.zpaal = new Int32Array(PLAFOND.paaltjes);
    this.gloed = null;
    this.leeg();
    this.nul();
  }

  leeg() {
    this.vakjes = []; this.bouwplaatsen = [];
    this.autos = new Float32Array(0); this.meubels = new Float32Array(0); this.plasplekken = new Float32Array(0); this.fietsen = new Float32Array(0);
    this.paaltjes = new Float32Array(0); this.voetlichten = new Float32Array(0); this.etalages = new Float32Array(0);
    this.plekLijst = [];
  }

  nul() {
    this.n = { vakjes: 0, bouwplaatsen: 0, autos: 0, bankjes: 0, brievenbussen: 0, paaltjes: 0, voetlichten: 0, fietsen: 0, plassen: 0, fonteinen: 0, eenden: 0, mensen: 0, ijscokarren: 0, kraampjes: 0, katten: 0, mixers: 0, lichten: 0 };
    this.nLicht = 0; this.nFig = 0;
  }

  // Na het laden van een spel (of een andere wereld): alles opnieuw afleiden.
  laad(view) {
    this.state = view.state;
    this.geo = view.geo;
    this.eigenaar = view.eigenaar;
    const vt = view.terreinLaag;
    this.basis = vt && vt.basis && vt.basis.geo === view.geo ? vt.basis : maakBasis(view.geo, view.eigenaar);
    this.tl = vt && vt.basis === this.basis ? vt : Object.assign(new TerreinLaag(), { basis: this.basis, geo: view.geo });
    this.nat = wereldCache.get(this.basis) ?? null;
    if (!this.nat) { this.nat = new Uint8Array(RW * RH); wereldCache.set(this.basis, this.nat); }
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

  // Water of oever op een punt: zee, rivier (met marge) of meer.
  natPunt(x, y, marge = 1.2) { return this.isZee(x, y) || this.tl.rivierAfstand(x, y) < marge || this.tl.isMeer(x, y) || this.tl.isZoetWater(x, y); }

  // Een rastercel van 2x2 eenheden die (deels) nat is; per wereld één keer uitgerekend en bewaard.
  natCel(ci) {
    const v = this.nat[ci];
    if (v) return v === 2;
    const cx = (ci % RW) * RC, cy = Math.floor(ci / RW) * RC;
    const nat = this.isZee(cx, cy) || this.isZee(cx + 2, cy) || this.isZee(cx, cy + 2) || this.isZee(cx + 2, cy + 2) || this.natPunt(cx + 1, cy + 1, 1.8);
    this.nat[ci] = nat ? 2 : 1;
    return nat;
  }

  tegel(x, y) { const geo = this.geo, Tw = geo.T; return clamp(Math.floor(y / Tw), 0, geo.rij - 1) * geo.kol + clamp(Math.floor(x / Tw), 0, geo.kol - 1); }

  merk(x, y, r, bit) {
    const g = this.raster, rr = (r + 1.42) * (r + 1.42);
    const c0 = Math.max(0, Math.floor((x - r) / RC)), c1 = Math.min(RW - 1, Math.floor((x + r) / RC));
    const r0 = Math.max(0, Math.floor((y - r) / RC)), r1 = Math.min(RH - 1, Math.floor((y + r) / RC));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const dx = cx * RC + 1 - x, dy = cy * RC + 1 - y; if (dx * dx + dy * dy <= rr) g[cy * RW + cx] |= bit; }
  }

  merkLijn(ax, ay, bx, by, r, bit) {
    const l = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(l / 1.5));
    for (let j = 0; j <= k; j++) this.merk(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k, r, bit);
  }

  merkRect(x0, y0, x1, y1, bit) {
    const g = this.raster;
    const c0 = Math.max(0, Math.floor(x0 / RC)), c1 = Math.min(RW - 1, Math.floor((x1 - 0.01) / RC));
    const r0 = Math.max(0, Math.floor(y0 / RC)), r1 = Math.min(RH - 1, Math.floor((y1 - 0.01) / RC));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) g[cy * RW + cx] |= bit;
  }

  // Is de rechthoek (wereld) vrij van de soorten in het masker (WATER: natte cellen; ook wat kust.js daar bouwde)?
  vrijRect(x0, y0, x1, y1, masker) {
    if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) return false;
    const g = this.raster, kr = this.kustRaster;
    const c0 = Math.floor(x0 / RC), c1 = Math.min(RW - 1, Math.floor((x1 - 0.01) / RC));
    const r0 = Math.floor(y0 / RC), r1 = Math.min(RH - 1, Math.floor((y1 - 0.01) / RC));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const ci = cy * RW + cx;
      if (g[ci] & masker) return false;
      if (masker & WATER && this.natCel(ci)) return false;
      if (kr && kr[ci] & KUST_BIT) return false;
    }
    return true;
  }

  // ---------- kiezen (alleen als de toestand iets verandert) ----------

  werkCache(view) {
    const s = this.state;
    let nP = 0, nB = 0, somT = 0;
    for (let i = 0; i < s.landen.length; i++) {
      const l = s.landen[i];
      nP += l.plaatsingen.length; nB += l.bouw.length;
      for (let j = 0; j < l.plaatsingen.length; j++) somT += l.plaatsingen[j].t;
      for (let j = 0; j < l.bouw.length; j++) somT += l.bouw[j].tegel * 3;
    }
    const inf = view.infraLaag, kust = view.kustLaag;
    const sig = `${s.grensVersie}|${nP}|${nB}|${somT}|${s.landen.length}|${s.kolonies?.length ?? 0}|${inf ? inf.sig : '-'}|${kust ? kust.sig : '-'}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.kustRaster = kust && kust.raster && kust.geo === this.geo ? kust.raster : null;
    this.kies(inf);
  }

  kies(inf) {
    this.leeg();
    this.bouwSoorten(inf);
    this.raster.fill(0);
    this.merkInfra(inf);
    this.merkGebouwen(inf);
    this.kiesBouwplaatsen();
    this.kiesVakjes(inf);
    this.kiesStraat(inf);
  }

  bouwSoorten(inf) {
    const s = this.state, P = s.pack, geo = this.geo, n = geo.tegels.length;
    if (!this.soort || this.soort.length !== n) { this.soort = new Uint8Array(n); this.nabij = new Uint8Array(n); }
    this.soort.fill(LEEG);
    for (const land of s.landen) {
      for (const p of land.plaatsingen) {
        if (p.t < 0) continue;
        const g = P.gebouwIndex[p.g], tek = g.tekening ?? ALIAS[g.id] ?? g.id;
        this.soort[p.t] = tek === 'woonwijk' ? STAD : OVERIG;
      }
    }
    for (let t = 0; t < n; t++) { const b = s.bezet[t]; if (b && this.soort[t] === LEEG) this.soort[t] = b.bouw ? BOUW : OVERIG; else if (b && b.bouw) this.soort[t] = BOUW; }
    for (const land of s.landen) { const h = geo.hoofdstad[land.idx]; if (h != null && h >= 0) this.soort[h] = HOOFD; }
    // vrij vakje in of vlak naast de stad: binnen twee vakjes van een hoofdstad, of tussen de bebouwing (een
    // woonwijk of hoofdstad ernaast telt 2, een ander gebouw of een bouwplaats 1)
    const stad = this.basis.stad;
    this.nabij.fill(0);
    for (let t = 0; t < n; t++) {
      const tg = geo.tegels[t];
      if (this.soort[t] !== LEEG || tg.terrein === 'water' || (inf && inf.gereserveerd && inf.gereserveerd(t))) continue;
      let k = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
        const kk = tg.k + dk, rr = tg.r + dr;
        if ((dr || dk) && kk >= 0 && rr >= 0 && kk < geo.kol && rr < geo.rij) { const so = this.soort[rr * geo.kol + kk]; if (so === STAD || so === HOOFD) k += 2; else if (so !== LEEG) k++; }
      }
      this.nabij[t] = Math.min(255, stad && stad[t] ? Math.max(2, k) : k);
    }
  }

  // Wegen, spoor, bruggen, pijpleidingen, masten en kruisingen van infra.js.
  merkInfra(inf) {
    if (!inf) return;
    const Tw = this.geo.T;
    for (const w of inf.wegen ?? []) this.merkLijn(w.ax, w.ay, w.bx, w.by, 0.27 * Tw, INFRA);
    for (const r of inf.routes ?? []) for (let i = 0; i + 1 < r.n; i++) this.merkLijn(r.x[i], r.y[i], r.x[i + 1], r.y[i + 1], 0.16 * Tw, INFRA);
    const v = inf.brugVlakken ? inf.brugVlakken() : null;
    if (v) for (let i = 0; i < v.n; i++) { const o = i * 5, d = v.data; this.merkLijn(d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4] + 1, INFRA); }
    for (const p of inf.pijpen ?? []) this.merkLijn(p.ax, p.ay, p.bx, p.by, 0.08 * Tw, INFRA);
    for (const l of inf.lijnen ?? []) for (let i = 0; i + 1 < l.m.length; i += 2) this.merk(l.m[i], l.m[i + 1], 0.1 * Tw, INFRA);
    const W = inf.wegen ?? [];
    for (const k of inf.kruisingen ?? []) {
      if (k.rotonde) this.merk(k.x, k.y, 0.22 * Tw, INFRA);
      else if (k.zij && W[k.a]) { const A = W[k.a], nx = -A.uy * k.zij, ny = A.ux * k.zij; this.merkLijn(k.x, k.y, k.x + nx * 0.52 * Tw, k.y + ny * 0.52 * Tw, 0.14 * Tw, INFRA); }
      else this.merk(k.x, k.y, 0.25 * Tw, INFRA);
    }
    for (const o of inf.overwegen ?? []) this.merk(o.x, o.y, 0.2 * Tw, INFRA);
  }

  // Bebouwde en door infra.js gereserveerde vakjes: daar komt niets van deze laag.
  merkGebouwen(inf) {
    const s = this.state, geo = this.geo, Tw = geo.T;
    for (let t = 0; t < geo.tegels.length; t++) {
      if (!s.bezet[t] && !(inf && inf.gereserveerd && inf.gereserveerd(t)) && this.soort[t] === LEEG) continue;
      const tg = geo.tegels[t];
      this.merkRect(tg.x - Tw / 2, tg.y - Tw / 2, tg.x + Tw / 2, tg.y + Tw / 2, GEBOUW);
    }
  }

  plek(soort, x, y) { this.plekLijst.push({ soort, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }); }

  // Rechthoek in het lokale kader van een zijde (u langs, w naar buiten), als wereldrechthoek.
  zijRect(tg, zijde, u0, u1, w0, w1) {
    const Tw = this.geo.T, [ax, ay] = zijPunt(zijde, u0, w0), [bx, by] = zijPunt(zijde, u1, w1);
    return [tg.x + Math.min(ax, bx) * Tw, tg.y + Math.min(ay, by) * Tw, tg.x + Math.max(ax, bx) * Tw, tg.y + Math.max(ay, by) * Tw];
  }

  // Vakjes in aanbouw (state.bezet[t].bouw): hek waar het vrij is, en een werf aan de eerste vrije zijde.
  kiesBouwplaatsen() {
    const geo = this.geo, n = geo.tegels.length, Tw = geo.T, M = INFRA | GEBOUW | WATER | BOUWP;
    for (let t = 0; t < n && this.bouwplaatsen.length < MAX_BOUW; t++) {
      if (this.soort[t] !== BOUW) continue;
      const tg = geo.tegels[t];
      let hek = 0, werf = -1;
      for (let zijde = 0; zijde < 4; zijde++) for (let k = 0; k < 4; k++) {
        const u0 = -0.5 + k * 0.25, [x0, y0, x1, y1] = this.zijRect(tg, zijde, u0, u0 + 0.25, 0.505, 0.6);
        if (this.vrijRect(x0, y0, x1, y1, M)) hek |= 1 << (zijde * 4 + k);
      }
      if (!hek) continue;
      for (const zijde of [2, 1, 3, 0]) {
        if (((hek >> (zijde * 4)) & 15) !== 15) continue;
        const [x0, y0, x1, y1] = this.zijRect(tg, zijde, -0.5, 0.5, 0.505, 0.75);
        if (this.vrijRect(x0, y0, x1, y1, M)) { werf = zijde; break; }
      }
      for (let zijde = 0; zijde < 4; zijde++) for (let k = 0; k < 4; k++) if (hek & (1 << (zijde * 4 + k))) { const u0 = -0.5 + k * 0.25, [x0, y0, x1, y1] = this.zijRect(tg, zijde, u0, u0 + 0.25, 0.505, 0.6); this.merkRect(x0, y0, x1, y1, BOUWP); }
      let mixer = null, lampLok = [0, 0];
      if (werf >= 0) {
        const [x0, y0, x1, y1] = this.zijRect(tg, werf, -0.5, 0.5, 0.505, 0.75);
        this.merkRect(x0, y0, x1, y1, BOUWP);
        const [mx, my] = zijPunt(werf, 0.34, WERF_W), [lx, ly] = zijPunt(werf, 0.46, WERF_W + 0.04);
        mixer = [mx, my, werf === 0 || werf === 2 ? 1 : 0, werf === 0 || werf === 2 ? 0 : 1];
        lampLok = [lx, ly];
      }
      const o = { t, x: tg.x, y: tg.y, hek, werf, zaad: (t * 7919 + 17) | 0, doek: Math.floor(hash(t, 5) * 16) & (hash(t, 6) < 0.5 ? 0 : 15), mixer, lampLok, sl: `b${t}|${hek}|${werf}` };
      this.bouwplaatsen.push(o);
      this.plek(werf >= 0 ? 'bouwwerf' : 'bouwhek', tg.x, tg.y);
    }
  }

  // Vrije vakjes in de stad: plein, park of per kwart iets kleins.
  kiesVakjes(inf) {
    const s = this.state, geo = this.geo, n = geo.tegels.length, Tw = geo.T, b = this.basis;
    const M = INFRA | GEBOUW | WATER | BOUWP;
    for (let t = 0; t < n && this.vakjes.length < MAX_VAKJES; t++) {
      const k = this.nabij[t];
      if (!k || this.soort[t] !== LEEG) continue;
      const tg = geo.tegels[t], stadT = b.stad && b.stad[t];
      if (tg.terrein !== 'vlakte' && tg.terrein !== 'kust') continue;
      const eig = s.eigenaar[t];
      if (eig == null || eig < 0 || (b.akker && b.akker[t]) || (b.moeras && b.moeras[t]) || (b.klif && b.klif[t]) || (b.duin && b.duin[t]) || (b.bergvoet && b.bergvoet[t])) continue;
      if (!stadT && k < 3) continue;
      // niet aan een grens (daar staan de hekken en posten van grens.js), en buiten de stad niet naast bos of berg
      // (daar loopt het wild van natuur.js) of bij een rivier (reigers en ooievaars)
      let rand = false;
      for (let dr = -1; dr <= 1 && !rand; dr++) for (let dk = -1; dk <= 1 && !rand; dk++) {
        const kk = tg.k + dk, rr = tg.r + dr;
        if (kk < 0 || rr < 0 || kk >= geo.kol || rr >= geo.rij) { rand = true; continue; }
        const nb = geo.tegels[rr * geo.kol + kk];
        if (nb.terrein !== 'water' && s.eigenaar[nb.i] !== eig) rand = true;
        if (!stadT && (nb.terrein === 'bos' || nb.terrein === 'berg')) rand = true;
      }
      if (rand || (!stadT && this.tl.rivierAfstand(tg.x, tg.y) < 8)) continue;
      // leven.js: geen kudde (wei met hash 111 < 0,42) en geen strandleven op een kustvakje zonder wei
      const wei = (tg.terrein === 'vlakte' && hash(t, 3) >= 0.45 && hash(t, 61) < 0.6) || (tg.terrein === 'kust' && hash(t, 61) < 0.6);
      if (wei && hash(t, 111) < 0.42) continue;
      if (tg.terrein === 'kust' && !wei && hash(t, 175) < 0.6) continue;
      const kw = [0, 0, 0, 0];
      let vrij = 0;
      for (let q = 0; q < 4; q++) {
        const cx = tg.x + KWART[q][0] * Tw, cy = tg.y + KWART[q][1] * Tw, m = 0.25 * Tw;
        if (this.vrijRect(cx - m, cy - m, cx + m, cy + m, M)) { kw[q] = 1; vrij++; }
      }
      if (!vrij) continue;
      const zaad = (t * 2654435 + 97) | 0;
      let soort = DEEL;
      // op een wei laat leven.js kinderen sleeën (hash 134) en vliegeren (hash 121): waar de glijbaan ligt geen plein
      // of park (alleen groene hoekjes), en geen plein onder een vlieger
      const glij = wei && hash(t, 134) < 0.35, vlieger = wei && hash(t, 121) < 0.18;
      if (vrij === 4 && !glij) soort = !vlieger && ((stadT && hash(t, 201) < 0.55) || hash(t, 201) < 0.3) ? PLEIN : PARK;
      if (soort === DEEL) for (let q = 0; q < 4; q++) {
        if (!kw[q]) continue;
        const h = hash(t, q, 202);
        kw[q] = wei ? Q_GROEN : h < 0.4 ? Q_PLEIN : h < 0.72 ? Q_GROEN : Q_PARKEER;
      }
      const v = { t, x: tg.x, y: tg.y, soort, kw, zaad, monument: Math.floor(hash(t, 203) * 3), lampen: [], bomen: [], snoer: [], sl: `${t}|${soort}${kw.join('')}` };
      this.indeling(v);
      this.vakjes.push(v);
      for (let q = 0; q < 4; q++) if (soort === DEEL && kw[q]) this.merkRect(tg.x + (KWART[q][0] - 0.25) * Tw, tg.y + (KWART[q][1] - 0.25) * Tw, tg.x + (KWART[q][0] + 0.25) * Tw, tg.y + (KWART[q][1] + 0.25) * Tw, BOUWP);
      if (soort !== DEEL) this.merkRect(tg.x - Tw / 2, tg.y - Tw / 2, tg.x + Tw / 2, tg.y + Tw / 2, BOUWP);
      this.plek(soort === PLEIN ? 'plein' : soort === PARK ? 'park' : kw.includes(Q_PARKEER) ? 'parkeerplaats' : kw.includes(Q_PLEIN) ? 'buurtpleintje' : 'groen hoekje', tg.x, tg.y);
    }
  }

  // Lampen, bomen en lichtsnoeren van een vakje (lokaal, tegeleenheden), voor de lichten en het leven per beeld.
  indeling(v) {
    if (v.soort === PLEIN) {
      v.lampen = PL.lampen.map((p) => p.slice());
      v.bomen = PL.bomen.map((p) => p.slice());
      const L = PL.lampen, H = LAMP_H, snoer = [];
      for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) snoer.push(L[a][0], L[a][1] - H, (L[a][0] + L[b][0]) / 2, (L[a][1] + L[b][1]) / 2 - H + 0.03, L[b][0], L[b][1] - H);
      v.snoer = snoer;
    } else if (v.soort === PARK) {
      v.lampen = PK.lampen.map(([p, t, k]) => naastPad(p, t, k, 0.03).slice(0, 2));
      v.bomen = PK.bomen.map((p) => p.slice(0, 2));
    } else {
      for (let q = 0; q < 4; q++) {
        const [qx, qy] = KWART[q];
        if (v.kw[q] === Q_PLEIN) v.lampen.push([qx + QP.lamp[0], qy + QP.lamp[1]]);
        else if (v.kw[q] === Q_GROEN) v.lampen.push([qx + QG.lamp[0], qy + QG.lamp[1]]);
        else if (v.kw[q] === Q_PARKEER) v.lampen.push([qx + QK.lamp[0], qy + QK.lamp[1]]);
      }
    }
  }

  // Langs de wegen in de stad: vakken op de berm met auto's, bankjes, brievenbussen en plasplekken; fietsen bij
  // de lantaarns; voetgangerslichten en paaltjes bij de zebra's; etalagelicht bij de stadsingang. Plekken waar
  // infra.js of leven.js al iets heeft (lantaarns, haltes, borden, kruisingen, overwegen) blijven vrij.
  kiesStraat(inf) {
    if (!inf || !inf.wegen) return;
    const W = inf.wegen, Tw = this.geo.T;
    const autos = [], meub = [], plas = [], fiets = [], paal = [], voet = [], etal = [];
    const bezet = new Uint8Array(RW * RH); // eenmalig per keuze: één ding per cel
    const tegelOk = (x, y) => { const t = this.tegel(x, y); return this.soort[t] === LEEG && this.nabij[t] >= 2 && !(inf.gereserveerd && inf.gereserveerd(t)); };
    const vrijCel = (x, y) => { const ci = clamp(Math.floor(y / RC), 0, RH - 1) * RW + clamp(Math.floor(x / RC), 0, RW - 1); if (bezet[ci] || this.raster[ci] & (GEBOUW | BOUWP)) return false; bezet[ci] = 1; return true; };
    const opAndereWeg = (i, x, y) => {
      for (let j = 0; j < W.length; j++) {
        if (j === i) continue;
        const o = W[j];
        if (x < o.x0 - 2 || x > o.x1 + 2 || y < o.y0 - 2 || y > o.y1 + 2) continue;
        if (segAfstand(x, y, o.ax, o.ay, o.bx, o.by) < 0.12 * Tw) return true;
      }
      // spoor (de rails liggen niet in de wegenlijst)
      for (const r of inf.routes ?? []) for (let k = 0; k + 1 < r.n; k++) {
        const ax = r.x[k], ay = r.y[k], bx = r.x[k + 1], by = r.y[k + 1];
        if (x < Math.min(ax, bx) - 3 || x > Math.max(ax, bx) + 3 || y < Math.min(ay, by) - 3 || y > Math.max(ay, by) + 3) continue;
        if (segAfstand(x, y, ax, ay, bx, by) < 0.12 * Tw) return true;
      }
      return false;
    };
    const res = [];
    for (let i = 0; i < W.length; i++) {
      const w = W[i], nx = -w.uy, ny = w.ux;
      res.length = 0;
      // lantaarns van infra.js (om en om links en rechts) met de afvalbak ernaast
      for (let q = w.s0 + Tw * 0.2, j = 0; q < w.s1 - Tw * 0.1; q += Tw * 0.4, j++) res.push(q, 0.07 * Tw, j & 1 ? 1 : -1);
      // haltes van infra.js en leven.js
      if (hash(w.zaad, 21) <= 0.35 && w.s1 - w.s0 >= 1.2 * Tw) res.push((w.s0 + w.s1) / 2, 0.1 * Tw, 1);
      if (w.len >= 2 * Tw) { const rnd0 = Math.min(0.45, (Tw * 0.42) / w.len), rijd = 1 - 2 * rnd0; for (let h = 1; h <= 2; h++) res.push((rnd0 + (h / 3) * rijd) * w.len, 0.09 * Tw, 0); }
      // borden van infra.js
      for (let q = w.s0 + Tw * 0.5, j = 0; q < w.s1 - Tw * 0.2; q += Tw * 1.1, j++) if (hash(w.zaad, j, 31) <= 0.6) res.push(q, 0.06 * Tw, hash(w.zaad, j, 33) < 0.5 ? 1 : -1);
      // kruisingen en overwegen
      for (const k of inf.kruisingen ?? []) if (k.a === i || k.b === i) res.push((k.x - w.ax) * w.ux + (k.y - w.ay) * w.uy, 0.24 * Tw, 0);
      for (const o of inf.overwegen ?? []) if (segAfstand(o.x, o.y, w.ax, w.ay, w.bx, w.by) < 0.25 * Tw) res.push((o.x - w.ax) * w.ux + (o.y - w.ay) * w.uy, 0.22 * Tw, 0);
      const vrijQ = (q, kant) => { for (let r = 0; r < res.length; r += 3) if (Math.abs(q - res[r]) < res[r + 1] && (!res[r + 2] || res[r + 2] === kant)) return false; return true; };
      // vakken op de berm
      for (const kant of [-1, 1]) {
        for (let q = w.s0 + Tw * 0.22, j = 0; q <= w.s1 - Tw * 0.22 && autos.length < MAX_AUTOS * 6; q += Tw * 0.075, j++) {
          if (!vrijQ(q, kant) || (inf.inTunnel && inf.inTunnel(w, q)) || (inf.opBrug && inf.opBrug(w, q))) continue;
          const x = w.ax + w.ux * q + nx * kant * BERM * Tw, y = w.ay + w.uy * q + ny * kant * BERM * Tw;
          if (!tegelOk(x, y) || this.natPunt(x, y, 1.4) || (inf.opBouwwerk && inf.opBouwwerk(x, y)) || opAndereWeg(i, x, y) || !vrijCel(x, y)) continue;
          const h = hash(w.zaad, j * 2 + (kant > 0 ? 1 : 0), 201), zaad = (w.zaad * 31 + j * 2 + (kant > 0 ? 1 : 0)) | 0;
          // rechts rijden: aan de rechterkant (kant +1) staat de neus in de rijrichting
          if (h < 0.56) autos.push(x, y, w.ux * kant, w.uy * kant, Math.floor(hash(zaad, 203) * AUTOS.length), hash(zaad, 204) < 0.15 ? 1 : 0);
          else if (h < 0.62 && meub.length < MAX_MEUBEL * 5) meub.push(x, y, w.ux, w.uy, 0);
          else if (h < 0.645 && meub.length < MAX_MEUBEL * 5) meub.push(x, y, w.ux, w.uy, 1 + Math.floor(hash(zaad, 205) * BUS_KLEUR.length));
          else if (h < 0.8 && plas.length < MAX_PLAS * 4) plas.push(x, y, w.ux, w.uy);
        }
      }
      // fietsen tegen een lantaarnpaal (zelfde plekken als infra.js)
      for (let q = w.s0 + Tw * 0.2, j = 0; q < w.s1 - Tw * 0.1 && fiets.length < MAX_FIETS * 5; q += Tw * 0.4, j++) {
        const kant = j & 1 ? 1 : -1, x = w.ax + w.ux * q + nx * kant * 0.095 * Tw, y = w.ay + w.uy * q + ny * kant * 0.095 * Tw;
        if (hash(w.zaad, j, 211) > 0.35 || !tegelOk(x, y) || opAndereWeg(i, x, y) || (inf.opBouwwerk && inf.opBouwwerk(x, y)) || (inf.inTunnel && inf.inTunnel(w, q)) || this.natPunt(x, y, 1)) continue;
        const zij = hash(w.zaad, j, 212) < 0.5 ? 1 : -1;
        const fx = x + w.ux * zij * 0.014 * Tw - nx * kant * 0.004 * Tw, fy = y + w.uy * zij * 0.014 * Tw - ny * kant * 0.004 * Tw;
        if (!tegelOk(fx, fy)) continue;
        fiets.push(fx, fy, w.ux, w.uy, Math.floor(hash(w.zaad, j, 213) * FIETS.length));
      }
      // stadsingangen: voetgangerslichten aan beide kanten van de zebra, paaltjes, etalagelicht
      for (const eind of [0, 1]) {
        if (eind ? !w.stadB : !w.stadA) continue;
        const q = eind ? w.s1 - 0.045 * Tw : w.s0 + 0.045 * Tw, rich = eind ? -1 : 1;
        for (const zij of [-1, 1]) {
          const x = w.ax + w.ux * q + nx * zij * 0.076 * Tw, y = w.ay + w.uy * q + ny * zij * 0.076 * Tw;
          if (!this.natPunt(x, y, 0.8) && !(inf.opBouwwerk && inf.opBouwwerk(x, y)) && tegelOk(x, y) && !opAndereWeg(i, x, y) && voet.length < MAX_VOET * 6) voet.push(x, y, 14000, hash(w.zaad, eind, 7), 0.58, 0.95);
          const ex = w.ax + w.ux * (eind ? w.s1 + 0.04 * Tw : w.s0 - 0.04 * Tw) + nx * zij * 0.16 * Tw, ey = w.ay + w.uy * (eind ? w.s1 + 0.04 * Tw : w.s0 - 0.04 * Tw) + ny * zij * 0.16 * Tw;
          if (etal.length < MAX_ETALAGE * 2 && !this.natPunt(ex, ey, 0.5)) etal.push(ex, ey);
        }
        // paaltjes op de stoeprand aan de kant zonder verkeerslicht
        for (const d of [0.03, 0.05, 0.07]) {
          const x = w.ax + w.ux * (q + rich * d * Tw) - nx * rich * 0.068 * Tw, y = w.ay + w.uy * (q + rich * d * Tw) - ny * rich * 0.068 * Tw;
          if (!this.natPunt(x, y, 0.8) && tegelOk(x, y) && !opAndereWeg(i, x, y) && paal.length < MAX_PAAL * 2) paal.push(x, y);
        }
      }
    }
    // voetgangerslichten op gewone kruispunten in de stad: groen voor wie oversteekt als de auto's op die arm rood hebben
    for (const k of inf.kruisingen ?? []) {
      if (k.rotonde || k.zij || !W[k.a] || !W[k.b]) continue;
      const t = this.tegel(k.x, k.y);
      if (this.soort[t] !== LEEG || this.nabij[t] < 2) continue;
      for (const [w, lo, hi] of [[W[k.a], 0.54, 0.96], [W[k.b], 0.04, 0.46]]) for (const sg of [-1, 1]) for (const zij of [-1, 1]) {
        const x = k.x + w.ux * sg * 0.11 * Tw - w.uy * zij * 0.072 * Tw, y = k.y + w.uy * sg * 0.11 * Tw + w.ux * zij * 0.072 * Tw;
        if (!this.natPunt(x, y, 0.8) && tegelOk(x, y) && voet.length < MAX_VOET * 6) voet.push(x, y, 16000, hash(k.zaad, 3), lo, hi);
      }
    }
    this.autos = Float32Array.from(autos); this.meubels = Float32Array.from(meub); this.plasplekken = Float32Array.from(plas);
    this.fietsen = Float32Array.from(fiets); this.paaltjes = Float32Array.from(paal); this.voetlichten = Float32Array.from(voet); this.etalages = Float32Array.from(etal);
    if (autos.length) this.plek('geparkeerde auto', autos[0], autos[1]);
    if (voet.length) this.plek('voetgangerslicht', voet[0], voet[1]);
    if (fiets.length) this.plek('fiets', fiets[0], fiets[1]);
  }

  // ---------- tekenen ----------

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

  inBeeld(x, y, m) { return x >= this.wx0 - m && x <= this.wx1 + m && y >= this.wy0 - m && y <= this.wy1 + m; }
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
    g.lineCap = 'round';
    fn(g, obj, this.bakStand);
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

  // Een gebakken bitmap waarvan het midden op wereldpunt (wx, wy) valt.
  plak(c, e, wx, wy) {
    const k = (this.T * this.dpr) / e.P, dpr = this.dpr;
    const w = (e.w * k) / dpr, h = (e.h * k) / dpr;
    const X = wx * this.sc + this.ox, Y = wy * this.sc + this.oy;
    if (Math.abs(k - 1) < 0.002) c.drawImage(e.cv, Math.round((X - w / 2) * dpr) / dpr, Math.round((Y - h / 2) * dpr) / dpr, w, h);
    else c.drawImage(e.cv, X - w / 2, Y - h / 2, w, h);
  }

  // Seizoen, weer en de stand van het bakken voor dit beeld.
  stand(s, view) {
    const sz = seizoen(s.dag);
    this.sz = sz;
    this.wr = weer(s.dag, view.cx, view.cy);
    const gisteren = weer(s.dag - 1, view.cx, view.cy);
    this.sn = sz.sneeuw > 0.66 ? 2 : sz.sneeuw > 0.25 ? 1 : 0;
    const gs = sz.winter > 0.5 ? 3 : sz.herfst > 0.5 ? 2 : sz.zomer > 0.45 ? 1 : 0;
    this.gs = gs;
    this.ijs = sz.koud > 0.86 ? 1 : 0;
    this.fonteinUit = sz.winter > 0.45 || this.ijs;
    this.terras = sz.lente + sz.zomer > 0.55 && sz.winter < 0.2 ? 1 : 0;
    this.kerst = sz.maand === 11 ? 1 : 0;
    // plassen: het regent, of het regende gisteren flink, en het vriest niet
    this.plassen = !this.sn && sz.koud < 0.85 && (this.wr.regen > 0.15 || gisteren.regen > 0.35);
    this.trede = this.zoom < TREDE1 ? 0 : this.zoom < TREDE2 ? 1 : 2;
    const bloei = sz.bloei > 0.25 ? 1 : 0;
    this.sk = `${this.sn}${gs}${bloei}${this.ijs}${this.fonteinUit ? 1 : 0}${this.terras}${this.kerst}${this.trede}`;
    this.bakStand = { sn: this.sn, gs, ijs: this.ijs, uit: this.fonteinUit ? 1 : 0, terras: this.terras, kerst: this.kerst, trede: this.trede, bloei, gras: GRAS[gs], haag: HAAG[gs], kroon: KROON[gs], bloem: BLOEM[gs] };
  }

  // Na de koopvaardij, vóór de gebouwen: de openbare ruimte op vrije grond en langs de stadswegen.
  teken(c, view, sc, nu, dt = 0, tempo = 0) {
    this.nul();
    const s = view.state;
    if (!s || !view.geo || !view.w || !view.eigenaar) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar || (view.terreinLaag?.basis && view.terreinLaag.basis !== this.basis)) this.laad(view);
    const z = view.zoom;
    this.zoom = z;
    if (z < DREMPEL.grond - 0.4) return;
    this.werkCache(view);
    this.kader(view, sc);
    this.stand(s, view);
    this.nacht = view.nacht ?? 0;
    this.nu = nu;
    this.bakTeller = 0;
    this.gloed ??= LICHTKLEUR.map((k) => { const cv = fabriek(32, 32); if (cv) bakGloed(cv, k); return cv; });
    const a = smooth(DREMPEL.grond - 0.4, DREMPEL.grond + 0.4, z);
    this.vervaag = a;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    this.tekenVakjes(c, a);
    if (z >= DREMPEL.bouwhek - 0.5) this.tekenBouwplaatsen(c, a * smooth(DREMPEL.bouwhek - 0.5, DREMPEL.bouwhek + 0.3, z), nu);
    if (z >= DREMPEL.auto - 0.5) this.tekenAutos(c, smooth(DREMPEL.auto - 0.5, DREMPEL.auto + 0.3, z));
    if (z >= DREMPEL.bank - 0.5) this.tekenMeubels(c, smooth(DREMPEL.bank - 0.5, DREMPEL.bank + 0.3, z));
    if (z >= DREMPEL.voetlicht - 0.5) this.tekenVoetlichten(c, smooth(DREMPEL.voetlicht - 0.5, DREMPEL.voetlicht + 0.3, z), nu);
    if (z >= DREMPEL.klein - 0.5) { const ak = smooth(DREMPEL.klein - 0.5, DREMPEL.klein + 0.3, z); this.tekenFietsen(c, ak); if (this.plassen) this.tekenPlassen(c, ak, nu); }
    this.tekenLeven(c, nu);
    if (this.nacht > 0.05 && z >= DREMPEL.etalage) this.zetEtalages();
    c.restore();
    this.n.lichten = this.nLicht;
    void dt; void tempo;
  }

  tekenVakjes(c, a) {
    const Tw = this.geo.T, V = this.vakjes, lampen = this.nacht > 0.05 && this.zoom >= 6.5;
    let n = 0;
    c.globalAlpha = a;
    for (let i = 0; i < V.length && n < PLAFOND.vakjes; i++) {
      const v = V[i];
      if (!this.inBeeld(v.x, v.y, Tw * 0.6)) continue;
      const e = this.bak(`${v.sl}|${this.sk}|${this.P}`, v.sl, VAK_BAK, VAK_BAK, this.P, bakVakje, v);
      if (e) this.plak(c, e, v.x, v.y);
      this.zv[n++] = i;
      if (lampen) for (const [lx, ly] of v.lampen) {
        const x = (v.x + lx * Tw) * this.sc + this.ox, y = (v.y + ly * Tw) * this.sc + this.oy;
        this.zetLicht(x, y - LAMP_H * this.T, Math.max(2, this.T * 0.03), WARM, 0.9);
        this.zetLicht(x, y, this.T * 0.09, WARM, 0.22);
      }
    }
    this.nZv = n;
    this.n.vakjes = n;
    c.globalAlpha = 1;
  }

  tekenBouwplaatsen(c, a, nu) {
    const Tw = this.geo.T, B = this.bouwplaatsen, T = this.T;
    let n = 0;
    c.globalAlpha = a;
    for (let i = 0; i < B.length && n < PLAFOND.bouwplaatsen; i++) {
      const o = B[i];
      if (!this.inBeeld(o.x, o.y, Tw)) continue;
      const e = this.bak(`${o.sl}|${this.sn}|${this.trede}|${this.P}`, o.sl, 1.56, 1.56, this.P, bakBouw, o);
      if (e) this.plak(c, e, o.x, o.y);
      this.zb[n++] = i;
      const sx = o.x * this.sc + this.ox, sy = o.y * this.sc + this.oy;
      // betonmixer met draaiende trommel (vanaf zoom 7)
      if (o.mixer && this.zoom >= 7 && this.n.mixers < PLAFOND.mixers) {
        this.n.mixers++;
        this.mixer(c, sx + o.mixer[0] * T, sy + o.mixer[1] * T, o.mixer[2], o.mixer[3], nu, o.zaad);
      }
      if (this.nacht > 0.05) {
        // bouwlamp en een knipperlicht op de hoek van het hek
        if (o.werf >= 0) { this.zetLicht(sx + o.lampLok[0] * T, sy + (o.lampLok[1] - 0.094) * T, Math.max(2, T * 0.05), WIT, 0.85); this.zetLicht(sx + o.lampLok[0] * T, sy + (o.lampLok[1] + 0.02) * T, T * 0.12, WIT, 0.18); }
        if (o.hek & ((1 << 7) | (1 << 11)) && frac(nu / 1100 + hash(o.t, 9)) < 0.5) this.zetLicht(sx + 0.53 * T, sy + (0.53 - HEK_H) * T, Math.max(1.5, T * 0.015), AMBER, 0.9);
      }
    }
    this.nZb = n;
    this.n.bouwplaatsen = n;
    c.globalAlpha = 1;
  }

  // Betonmixer: cabine, chassis en een trommel met strepen die doordraaien.
  mixer(c, x, y, hx, hy, nu, zaad) {
    const T = this.T, L = T * 0.05, B = T * 0.016, px = -hy, py = hx;
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); rechthoek(c, x + T * 0.012, y + T * 0.014, hx, hy, L, B); c.fill();
    c.fillStyle = '#3a3a38'; c.beginPath(); rechthoek(c, x, y, hx, hy, L, B * 0.9); c.fill();
    const cx = x + hx * L * 0.72, cy = y + hy * L * 0.72;
    c.fillStyle = '#e8e6de'; c.beginPath(); rechthoek(c, cx, cy, hx, hy, L * 0.26, B); c.fill();
    c.fillStyle = '#2f4152'; c.beginPath(); rechthoek(c, cx + hx * L * 0.14, cy + hy * L * 0.14, hx, hy, L * 0.08, B * 0.8); c.fill();
    const dx = x - hx * L * 0.25, dy = y - hy * L * 0.25 - T * 0.008;
    c.fillStyle = '#d9a63a'; c.beginPath(); c.ellipse(dx, dy, L * 0.62, B * 1.15, Math.atan2(hy, hx), 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,240,200,0.3)'; c.beginPath(); c.ellipse(dx - px * B * 0.4, dy - py * B * 0.4, L * 0.5, B * 0.45, Math.atan2(hy, hx), 0, TAU); c.fill();
    // de strepen schuiven langs de trommel: hij draait
    c.strokeStyle = 'rgba(90,60,20,0.65)'; c.lineWidth = Math.max(0.6, T * 0.004); c.beginPath();
    for (let k = 0; k < 3; k++) {
      const f = frac(nu / 1400 + k / 3 + hash(zaad, 4)), u = (f - 0.5) * 1.1 * L;
      c.moveTo(dx + hx * u - px * B, dy + hy * u - py * B); c.lineTo(dx + hx * (u + L * 0.12) + px * B, dy + hy * (u + L * 0.12) + py * B);
    }
    c.stroke();
  }

  // Zichtbare punten uit een lijst (stap st) in de buffer zi; geeft het aantal terug (hooguit max).
  zichtbaar(lijst, st, max, m) {
    let n = 0;
    for (let i = 0; i < lijst.length && n < max; i += st) if (this.inBeeld(lijst[i], lijst[i + 1], m)) this.zi[n++] = i;
    return n;
  }

  tekenAutos(c, a) {
    const L = this.autos, T = this.T, sc = this.sc, ox = this.ox, oy = this.oy;
    const n = this.zichtbaar(L, 6, PLAFOND.autos, this.geo.T * 0.1);
    this.n.autos = n;
    if (!n) return;
    c.globalAlpha = a;
    const lang = T * 0.029, breed = T * 0.0125;
    // vak op de berm: klinkers met een witte lijn tussen de vakken
    c.fillStyle = '#8e8a82'; c.beginPath();
    for (let k = 0; k < n; k++) { const o = this.zi[k]; rechthoek(c, L[o] * sc + ox, L[o + 1] * sc + oy, L[o + 2], L[o + 3], T * 0.0375, T * 0.018); }
    c.fill();
    if (this.zoom >= 9) {
      c.strokeStyle = 'rgba(236,235,228,0.7)'; c.lineWidth = Math.max(0.5, T * 0.002); c.beginPath();
      for (let k = 0; k < n; k++) { const o = this.zi[k], x = L[o] * sc + ox, y = L[o + 1] * sc + oy, hx = L[o + 2], hy = L[o + 3], e = T * 0.0375; c.moveTo(x + hx * e - hy * T * 0.018, y + hy * e + hx * T * 0.018); c.lineTo(x + hx * e + hy * T * 0.018, y + hy * e - hx * T * 0.018); }
      c.stroke();
    }
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath();
    for (let k = 0; k < n; k++) { const o = this.zi[k]; rechthoek(c, L[o] * sc + ox + T * 0.006, L[o + 1] * sc + oy + T * 0.008, L[o + 2], L[o + 3], lang * (L[o + 5] ? 1.15 : 1), breed); }
    c.fill();
    for (let kl = 0; kl < AUTOS.length; kl++) {
      c.fillStyle = AUTOS[kl]; c.beginPath();
      let iets = false;
      for (let k = 0; k < n; k++) { const o = this.zi[k]; if (L[o + 4] !== kl) continue; iets = true; rechthoek(c, L[o] * sc + ox, L[o + 1] * sc + oy, L[o + 2], L[o + 3], lang * (L[o + 5] ? 1.15 : 1), breed); }
      if (iets) c.fill();
    }
    if (this.zoom >= 9) {
      c.fillStyle = 'rgba(30,40,50,0.8)'; c.beginPath();
      for (let k = 0; k < n; k++) { const o = this.zi[k], hx = L[o + 2], hy = L[o + 3]; rechthoek(c, L[o] * sc + ox + hx * T * 0.01, L[o + 1] * sc + oy + hy * T * 0.01, hx, hy, T * 0.007, breed * 0.85); }
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.2)'; c.beginPath();
      for (let k = 0; k < n; k++) { const o = this.zi[k], hx = L[o + 2], hy = L[o + 3]; if (L[o + 5]) continue; rechthoek(c, L[o] * sc + ox - hx * T * 0.008, L[o + 1] * sc + oy - hy * T * 0.008, hx, hy, T * 0.011, breed * 0.7); }
      c.fill();
    }
    if (this.sn) {
      c.fillStyle = 'rgba(244,246,248,0.85)'; c.beginPath();
      for (let k = 0; k < n; k++) { const o = this.zi[k]; rechthoek(c, L[o] * sc + ox, L[o + 1] * sc + oy, L[o + 2], L[o + 3], lang * 0.45, breed * 0.75); }
      c.fill();
    }
    c.globalAlpha = 1;
  }

  // Bankjes (vanaf zoom 9) en brievenbussen (vanaf 10,5) op de berm. Eerst per soort de zichtbare binnen het
  // plafond, dan tekenen: zo krijgt geen bankje boven het plafond toch een schaduw of leuning.
  tekenMeubels(c, a) {
    const L = this.meubels, T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, Tw = this.geo.T;
    const bus = this.zoom >= DREMPEL.brievenbus, ZB = this.zbank, ZP = this.zbus;
    let nb = 0, np = 0;
    for (let i = 0; i < L.length && (nb < PLAFOND.bankjes || (bus && np < PLAFOND.brievenbussen)); i += 5) {
      if (!this.inBeeld(L[i], L[i + 1], Tw * 0.1)) continue;
      if (!L[i + 4]) { if (nb < PLAFOND.bankjes) ZB[nb++] = i; }
      else if (bus && np < PLAFOND.brievenbussen) ZP[np++] = i;
    }
    this.n.bankjes = nb; this.n.brievenbussen = np;
    if (!nb && !np) return;
    c.globalAlpha = a;
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath();
    for (let k = 0; k < nb; k++) { const o = ZB[k]; rechthoek(c, L[o] * sc + ox + T * 0.006, L[o + 1] * sc + oy + T * 0.008, L[o + 2], L[o + 3], T * 0.026, T * 0.009); }
    for (let k = 0; k < np; k++) { const o = ZP[k], x = L[o] * sc + ox, y = L[o + 1] * sc + oy; c.rect(x - T * 0.002, y - T * 0.002, T * 0.012, T * 0.01); }
    c.fill();
    if (nb) {
      c.fillStyle = HOUT; c.beginPath();
      for (let k = 0; k < nb; k++) { const o = ZB[k]; rechthoek(c, L[o] * sc + ox, L[o + 1] * sc + oy, L[o + 2], L[o + 3], T * 0.025, T * 0.007); }
      c.fill();
      if (this.zoom >= 10) {
        c.strokeStyle = HOUT_D; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
        for (let k = 0; k < nb; k++) { const o = ZB[k], x = L[o] * sc + ox, y = L[o + 1] * sc + oy, hx = L[o + 2], hy = L[o + 3]; c.moveTo(x - hx * T * 0.025 + hy * T * 0.007, y - hy * T * 0.025 - hx * T * 0.007); c.lineTo(x + hx * T * 0.025 + hy * T * 0.007, y + hy * T * 0.025 - hx * T * 0.007); }
        c.stroke();
      }
    }
    if (np) {
      for (let kl = 0; kl < BUS_KLEUR.length; kl++) {
        c.fillStyle = BUS_KLEUR[kl]; c.beginPath();
        for (let k = 0; k < np; k++) { const o = ZP[k]; if (L[o + 4] !== kl + 1) continue; const x = L[o] * sc + ox, y = L[o + 1] * sc + oy; c.rect(x - T * 0.006, y - T * 0.018, T * 0.012, T * 0.016); }
        c.fill();
      }
      c.fillStyle = '#2a2622'; c.beginPath();
      for (let k = 0; k < np; k++) { const o = ZP[k], x = L[o] * sc + ox, y = L[o + 1] * sc + oy; c.rect(x - T * 0.004, y - T * 0.014, T * 0.008, T * 0.0018); c.rect(x - T * 0.0015, y - T * 0.002, T * 0.003, T * 0.004); }
      c.fill();
    }
    c.globalAlpha = 1;
  }

  // Voetgangerslichten (rood of groen, het groen knippert vlak voor het omslaat) en paaltjes bij de zebra's.
  tekenVoetlichten(c, a, nu) {
    const T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, Tw = this.geo.T;
    const P = this.paaltjes;
    c.globalAlpha = a;
    const ZP = this.zpaal;
    let np = 0;
    for (let i = 0; i < P.length && np < PLAFOND.paaltjes; i += 2) if (this.inBeeld(P[i], P[i + 1], Tw * 0.05)) ZP[np++] = i;
    if (np) {
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath();
      for (let k = 0; k < np; k++) { const i = ZP[k]; stip(c, P[i] * sc + ox + T * 0.003, P[i + 1] * sc + oy + T * 0.003, T * 0.004); }
      c.fill();
      c.fillStyle = PAAL; c.beginPath();
      for (let k = 0; k < np; k++) { const i = ZP[k]; stip(c, P[i] * sc + ox, P[i + 1] * sc + oy, T * 0.004); }
      c.fill();
      if (this.zoom >= DREMPEL.klein) { c.fillStyle = '#e8e6de'; c.beginPath(); for (let k = 0; k < np; k++) { const i = ZP[k]; stip(c, P[i] * sc + ox, P[i + 1] * sc + oy, T * 0.0018); } c.fill(); }
    }
    this.n.paaltjes = np;
    const V = this.voetlichten, hgt = T * 0.035;
    let nv = 0;
    for (let i = 0; i < V.length && nv < PLAFOND.voetlichten; i += 6) {
      if (!this.inBeeld(V[i], V[i + 1], Tw * 0.05)) continue;
      nv++;
      const x = V[i] * sc + ox, y = V[i + 1] * sc + oy, f = frac(nu / V[i + 2] + V[i + 3]);
      const groen = f >= V[i + 4] && f < V[i + 5] && !(f > V[i + 5] - 0.05 && frac(nu / 500) < 0.5);
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.5, T * 0.004); c.beginPath(); c.moveTo(x, y); c.lineTo(x + hgt * SCHUIN, y + hgt * SCHUIN); c.stroke();
      c.strokeStyle = PAAL; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - hgt); c.stroke();
      c.fillStyle = '#1d1f21'; c.fillRect(x - T * 0.005, y - hgt - T * 0.017, T * 0.01, T * 0.02);
      const ly = y - hgt - T * (groen ? 0.004 : 0.012);
      c.fillStyle = 'rgba(80,80,80,0.9)'; c.beginPath(); stip(c, x, y - hgt - T * (groen ? 0.012 : 0.004), T * 0.003); c.fill();
      c.fillStyle = groen ? '#4dff7a' : '#ff4a3a'; c.beginPath(); stip(c, x, ly, T * 0.0033); c.fill();
      this.zetLicht(x, ly, Math.max(1.5, T * 0.014), groen ? GROEN : ROOD, 0.8);
    }
    this.n.voetlichten = nv;
    c.globalAlpha = 1;
  }

  tekenFietsen(c, a) {
    const L = this.fietsen, T = this.T, sc = this.sc, ox = this.ox, oy = this.oy;
    const n = this.zichtbaar(L, 5, PLAFOND.fietsen, this.geo.T * 0.05);
    this.n.fietsen = n;
    if (!n) return;
    c.globalAlpha = a;
    const r = T * 0.0065, l = T * 0.011;
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = Math.max(0.5, T * 0.002); c.beginPath();
    for (let k = 0; k < n; k++) { const o = this.zi[k], x = L[o] * sc + ox + T * 0.004, y = L[o + 1] * sc + oy + T * 0.005, hx = L[o + 2], hy = L[o + 3]; c.moveTo(x - hx * l, y - hy * l); c.lineTo(x + hx * l, y + hy * l); }
    c.stroke();
    c.strokeStyle = '#2a2c30'; c.beginPath();
    for (let k = 0; k < n; k++) { const o = this.zi[k], x = L[o] * sc + ox, y = L[o + 1] * sc + oy, hx = L[o + 2], hy = L[o + 3]; for (const s of [-1, 1]) { const cx = x + hx * l * s, cy = y + hy * l * s; c.moveTo(cx + r, cy); c.ellipse(cx, cy, r, r * 0.5, Math.atan2(hy, hx), 0, TAU); } }
    c.stroke();
    for (let kl = 0; kl < FIETS.length; kl++) {
      c.strokeStyle = FIETS[kl]; c.lineWidth = Math.max(0.6, T * 0.0028); c.beginPath();
      let iets = false;
      for (let k = 0; k < n; k++) { const o = this.zi[k]; if (L[o + 4] !== kl) continue; iets = true; const x = L[o] * sc + ox, y = L[o + 1] * sc + oy, hx = L[o + 2], hy = L[o + 3]; c.moveTo(x - hx * l, y - hy * l); c.lineTo(x, y - T * 0.004); c.lineTo(x + hx * l, y + hy * l); c.moveTo(x + hx * l * 0.7, y + hy * l * 0.7 - T * 0.006); c.lineTo(x + hx * l * 0.4 - hy * T * 0.006, y + hy * l * 0.4 - T * 0.007); }
      if (iets) c.stroke();
    }
    c.globalAlpha = 1;
  }

  // Plassen op de berm en het plein na regen; regent het nog, dan slaan er druppels in.
  tekenPlassen(c, a, nu) {
    const L = this.plasplekken, T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, Tw = this.geo.T;
    let n = this.zichtbaar(L, 4, PLAFOND.plassen, Tw * 0.05);
    const regent = this.wr.regen > 0.3;
    c.globalAlpha = a;
    const plas = (x, y, hk, zaad) => {
      const rx = T * (0.012 + 0.008 * hash(zaad, 1)), ry = rx * 0.5;
      c.fillStyle = 'rgba(110,130,150,0.5)'; c.beginPath(); c.ellipse(x, y, rx, ry, hk, 0, TAU); c.fill();
      c.fillStyle = 'rgba(230,240,250,0.35)'; c.beginPath(); c.ellipse(x - rx * 0.3, y - ry * 0.3, rx * 0.4, ry * 0.25, hk, 0, TAU); c.fill();
      if (regent) {
        const f = frac(nu / 650 + hash(zaad, 2));
        c.strokeStyle = `rgba(230,240,250,${(0.6 * (1 - f)).toFixed(2)})`; c.lineWidth = Math.max(0.4, T * 0.0015);
        c.beginPath(); c.ellipse(x + (hash(zaad, 3) - 0.5) * rx, y, rx * 0.6 * f + 0.5, ry * 0.6 * f + 0.3, hk, 0, TAU); c.stroke();
      }
    };
    for (let k = 0; k < n; k++) { const o = this.zi[k]; plas(L[o] * sc + ox, L[o + 1] * sc + oy, Math.atan2(L[o + 3], L[o + 2]), o); }
    // op de pleinen
    for (let i = 0; i < this.nZv && n < PLAFOND.plassen; i++) {
      const v = this.vakjes[this.zv[i]];
      if (v.soort !== PLEIN) continue;
      for (let j = 0; j < PL.plassen.length && n < PLAFOND.plassen; j++) { n++; plas((v.x + PL.plassen[j][0] * Tw) * sc + ox, (v.y + PL.plassen[j][1] * Tw) * sc + oy, 0, v.t * 7 + j); }
    }
    this.n.plassen = n;
    c.globalAlpha = 1;
  }

  // ---------- leven op pleinen en in parken ----------

  tekenLeven(c, nu) {
    const Tw = this.geo.T, T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, sz = this.sz;
    const dag = this.nacht < 0.6, droog = this.wr.regen < 0.3 && this.wr.sneeuw < 0.3;
    const fontein = z >= DREMPEL.fontein - 0.5 && !this.fonteinUit, aF = smooth(DREMPEL.fontein - 0.5, DREMPEL.fontein + 0.3, z);
    const mensen = z >= DREMPEL.mensen - 0.5, aM = smooth(DREMPEL.mensen - 0.5, DREMPEL.mensen + 0.3, z);
    const ijsco = z >= DREMPEL.ijsco - 0.5 && sz.zomer > 0.5 && dag && droog;
    const nachtLicht = this.nacht > 0.05;
    this.nFig = 0;
    for (let i = 0; i < this.nZv; i++) {
      const v = this.vakjes[this.zv[i]], X = v.x * sc + ox, Y = v.y * sc + oy;
      const P = (lx, ly) => [X + lx * T, Y + ly * T];
      if (v.soort === PLEIN) {
        if (fontein && this.n.fonteinen < PLAFOND.fonteinen) { this.n.fonteinen++; c.globalAlpha = aF; this.fontein(c, X + PL.F[0] * T, Y + PL.F[1] * T, PL.F[2] * T * 0.86, nu, v.zaad, 1); }
        if (mensen && !this.kerst && this.terras && dag && droog) this.gasten(v, PL.tafels, X, Y, nu, 0);
        if (mensen && this.kerst && this.nacht < 0.9) this.kopers(v, X, Y, nu);
        if (ijsco && this.n.ijscokarren < PLAFOND.ijscokarren && !this.kerst) { c.globalAlpha = aM; this.ijscokar(c, ...P(PL.ijsco[0], PL.ijsco[1]), nu, v.zaad); }
        if (nachtLicht) {
          this.zetLicht(...P(PL.K[0], PL.K[1] - 0.03), T * 0.06, WARM, 0.45);
          if (this.kerst) this.kerstLichtjes(v, X, Y, nu);
          else if (this.terras && z >= 7) for (const [tx, ty] of PL.tafels) this.zetLicht(...P(tx, ty - 0.035), T * 0.03, WARM, 0.35);
        }
      } else if (v.soort === PARK) {
        const [vx, vy, vrx, vry] = PK.V;
        if (fontein && this.n.fonteinen < PLAFOND.fonteinen) { this.n.fonteinen++; c.globalAlpha = aF; this.fontein(c, X + vx * T, Y + vy * T, vry * T * 0.7, nu, v.zaad, 0); }
        if (z >= 8 && dag && !this.ijs && sz.winter < 0.5) { c.globalAlpha = smooth(8, 8.8, z); this.eenden(c, X + vx * T, Y + vy * T, vrx * T, vry * T, nu, v.zaad); }
        if (ijsco && this.n.ijscokarren < PLAFOND.ijscokarren) { const [x, y] = naastPad(PK.ijsco[0], PK.ijsco[1], PK.ijsco[2], 0.05); c.globalAlpha = aM; this.ijscokar(c, ...P(x, y), nu, v.zaad); }
        if (z >= DREMPEL.klein - 0.5 && hash(v.t, 41) < 0.7 && this.n.katten < PLAFOND.katten) { c.globalAlpha = smooth(DREMPEL.klein - 0.5, DREMPEL.klein + 0.3, z); this.kat(c, X, Y, nu, v.zaad); }
      } else if (mensen && this.terras && dag && droog && !this.kerst) {
        for (let q = 0; q < 4; q++) if (v.kw[q] === Q_PLEIN) this.gasten(v, QP.tafels, X + KWART[q][0] * T, Y + KWART[q][1] * T, nu, q + 1);
      }
    }
    c.globalAlpha = aM;
    this.tekenFiguren(c);
    c.globalAlpha = 1;
  }

  // Fontein: een waterzuil met bogen die in de bak vallen, schuim op het water en kringen.
  fontein(c, x, y, r, nu, zaad, groot) {
    const T = this.T, h = r * (groot ? 0.75 : 0.9) * (0.9 + 0.1 * Math.sin(nu / 260 + zaad));
    c.strokeStyle = 'rgba(225,238,246,0.7)'; c.lineWidth = Math.max(0.5, T * 0.0035); c.beginPath();
    const n = groot ? 8 : 5;
    for (let k = 0; k < n; k++) {
      const a = (k * TAU) / n + nu / 5000, ex = x + Math.cos(a) * r * 0.72, ey = y + Math.sin(a) * r * 0.58;
      c.moveTo(x, y - h * 0.55); c.quadraticCurveTo(x + Math.cos(a) * r * 0.4, y - h * 0.95 + Math.sin(a) * r * 0.2, ex, ey);
    }
    c.stroke();
    c.strokeStyle = 'rgba(240,248,252,0.85)'; c.lineWidth = Math.max(0.6, T * 0.006); c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h); c.stroke();
    c.fillStyle = 'rgba(245,250,252,0.7)'; c.beginPath();
    for (let k = 0; k < 5; k++) { const f = frac(nu / 900 + k / 5 + hash(zaad, k)); stip(c, x + Math.sin(k * 2.3 + nu / 700) * r * 0.12, y - h - f * r * 0.15 + f * f * r * 0.3, Math.max(0.5, T * 0.0022)); }
    c.fill();
    for (let k = 0; k < 2; k++) {
      const f = frac(nu / 1800 + k * 0.5 + hash(zaad, 9));
      c.strokeStyle = `rgba(230,240,248,${(0.45 * (1 - f)).toFixed(2)})`; c.lineWidth = Math.max(0.4, T * 0.002);
      c.beginPath(); c.ellipse(x, y, r * (0.3 + 0.6 * f), r * (0.25 + 0.5 * f), 0, 0, TAU); c.stroke();
    }
  }

  // Eenden die rondjes zwemmen in de vijver, met een kielzog.
  eenden(c, x, y, rx, ry, nu, zaad) {
    const T = this.T, n = 2 + Math.floor(hash(zaad, 51) * 3);
    for (let i = 0; i < n && this.n.eenden < PLAFOND.eenden; i++) {
      this.n.eenden++;
      const sn = (0.6 + 0.5 * hash(zaad, i, 52)) * (i & 1 ? -1 : 1), a = (nu / 14000) * sn * TAU + i * 2.1 + hash(zaad, i, 53) * 6;
      const px = x + Math.cos(a) * rx * 0.55, py = y + Math.sin(a) * ry * 0.5;
      let hx = -Math.sin(a) * rx * sn, hy = Math.cos(a) * ry * sn; const l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l;
      c.strokeStyle = 'rgba(230,240,248,0.45)'; c.lineWidth = Math.max(0.4, T * 0.0015); c.beginPath();
      c.moveTo(px - hx * T * 0.01 - hy * T * 0.006, py - hy * T * 0.01 + hx * T * 0.006); c.lineTo(px - hx * T * 0.004, py - hy * T * 0.004); c.lineTo(px - hx * T * 0.01 + hy * T * 0.006, py - hy * T * 0.01 - hx * T * 0.006); c.stroke();
      c.fillStyle = hash(zaad, i, 54) < 0.4 ? '#f2f0ea' : '#8a6a4a'; c.beginPath(); c.ellipse(px, py, T * 0.008, T * 0.0045, Math.atan2(hy, hx), 0, TAU); c.fill();
      c.fillStyle = hash(zaad, i, 54) < 0.4 ? '#f2f0ea' : '#2f6a3a'; c.beginPath(); stip(c, px + hx * T * 0.007, py + hy * T * 0.007 - T * 0.002, T * 0.0032); c.fill();
      c.fillStyle = '#e0a020'; c.beginPath(); stip(c, px + hx * T * 0.0105, py + hy * T * 0.0105 - T * 0.002, T * 0.0013); c.fill();
    }
  }

  // Ijscokar met parasol en een rijtje wachtenden dat langzaam opschuift.
  ijscokar(c, x, y, nu, zaad) {
    const T = this.T;
    this.n.ijscokarren++;
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(x - T * 0.025 + T * 0.008, y - T * 0.012 + T * 0.01, T * 0.05, T * 0.024);
    c.fillStyle = '#f2efe6'; c.fillRect(x - T * 0.025, y - T * 0.02, T * 0.05, T * 0.024);
    c.fillStyle = '#7ab8d8'; c.fillRect(x - T * 0.025, y - T * 0.004, T * 0.05, T * 0.006);
    c.fillStyle = '#2a2c30'; c.beginPath(); stip(c, x - T * 0.016, y + T * 0.005, T * 0.004); stip(c, x + T * 0.016, y + T * 0.005, T * 0.004); c.fill();
    const py = y - T * 0.05;
    c.strokeStyle = '#8a8d90'; c.lineWidth = Math.max(0.5, T * 0.002); c.beginPath(); c.moveTo(x, y - T * 0.02); c.lineTo(x, py); c.stroke();
    c.fillStyle = '#f2b8c8'; c.beginPath(); c.arc(x, py, T * 0.026, 0, TAU); c.fill();
    c.fillStyle = '#f8f4ee'; c.beginPath(); for (let i = 0; i < 6; i += 2) { c.moveTo(x, py); c.arc(x, py, T * 0.026, (i * TAU) / 6, ((i + 1) * TAU) / 6); c.closePath(); } c.fill();
    const n = 2 + Math.floor(tri(nu / 40000 + hash(zaad, 61)) * 3);
    for (let i = 0; i < n; i++) {
      const schuif = frac(nu / 9000 + hash(zaad, 62)) < 0.15 ? 0.004 : 0;
      this.zetFig(x - T * 0.006 + Math.sin(i * 1.7) * T * 0.004, y + T * (0.03 + i * 0.017 - schuif), Math.floor(hash(zaad, i, 63) * KLEDING.length), Math.floor(hash(zaad, i, 64) * 3));
    }
  }

  // Een kat op het muurtje: zit en zwiept met de staart, loopt af en toe een stukje.
  kat(c, X, Y, nu, zaad) {
    const T = this.T, my = PK.MUUR - 0.022 - 0.006;
    const links = hash(zaad, 71) < 0.5, x0 = links ? -0.42 : 0.1, x1 = links ? -0.14 : 0.42;
    const f = frac(nu / 47000 + hash(zaad, 72)), loop = f > 0.8 ? (f - 0.8) / 0.2 : 0;
    const basis = x0 + (x1 - x0) * (0.2 + 0.6 * hash(zaad, 73)), u = basis + Math.sin(loop * Math.PI) * 0.08 * (hash(zaad, 74) < 0.5 ? -1 : 1);
    const x = X + clamp(u, x0, x1) * T, y = Y + my * T;
    this.n.katten++;
    const kl = KAT[Math.floor(hash(zaad, 75) * KAT.length)];
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(x + T * 0.004, y + T * 0.012, T * 0.007, T * 0.003, 0, 0, TAU); c.fill();
    c.fillStyle = kl;
    if (loop > 0) { c.beginPath(); c.ellipse(x, y, T * 0.009, T * 0.0035, 0, 0, TAU); c.fill(); c.beginPath(); stip(c, x + T * 0.009, y - T * 0.001, T * 0.0035); c.fill(); }
    else { c.beginPath(); c.ellipse(x, y - T * 0.003, T * 0.0045, T * 0.0055, 0, 0, TAU); c.fill(); c.beginPath(); stip(c, x, y - T * 0.0095, T * 0.0033); c.fill();
      c.beginPath(); c.moveTo(x - T * 0.003, y - T * 0.011); c.lineTo(x - T * 0.002, y - T * 0.015); c.lineTo(x - T * 0.0005, y - T * 0.012); c.moveTo(x + T * 0.003, y - T * 0.011); c.lineTo(x + T * 0.002, y - T * 0.015); c.lineTo(x + T * 0.0005, y - T * 0.012); c.fill(); }
    // staart: zwiept langzaam heen en weer
    const zw = Math.sin(nu / 600 + hash(zaad, 76) * 6) * 0.6;
    c.strokeStyle = kl; c.lineWidth = Math.max(0.5, T * 0.0018); c.beginPath();
    c.moveTo(x - T * 0.004, y); c.quadraticCurveTo(x - T * 0.01, y + T * 0.002, x - T * 0.012 + zw * T * 0.004, y + T * 0.008); c.stroke();
  }

  // Gasten aan de terrastafels: zitten aan de zuid- en westkant, bewegen een beetje; een ober loopt rond.
  gasten(v, tafels, X, Y, nu, sub) {
    const T = this.T, druk = 0.4 + 0.5 * tri(nu / 120000 + hash(v.t, sub, 81));
    for (let i = 0; i < tafels.length; i++) {
      const [tx, ty] = tafels[i];
      for (let j = 0; j < 3; j++) {
        if (hash(v.t, sub * 16 + i * 3 + j, 82) > druk) continue;
        const a = 0.6 + j * 2.09, b = Math.sin(nu / 900 + i + j * 1.7) * T * 0.0012;
        this.zetFig(X + (tx + Math.cos(a) * 0.022) * T + b, Y + (ty + Math.sin(a) * 0.02) * T, Math.floor(hash(v.t, sub * 16 + i * 3 + j, 83) * KLEDING.length), Math.floor(hash(v.t, sub * 16 + i * 3 + j, 84) * 3));
      }
    }
    if (this.zoom >= 10 && tafels.length > 3) {
      const f = tri(nu / 14000 + hash(v.t, sub, 85)), A = tafels[0], B = tafels[tafels.length - 1];
      this.zetFig(X + (A[0] + (B[0] - A[0]) * f) * T, Y + (A[1] + (B[1] - A[1]) * f + 0.05) * T, 6, 0);
    }
  }

  // Kopers bij de kraampjes van de decembermarkt.
  kopers(v, X, Y, nu) {
    const T = this.T;
    for (let i = 0; i < PL.kramen.length && this.n.kraampjes < PLAFOND.kraampjes; i++) {
      this.n.kraampjes++;
      const [kx, ky] = PL.kramen[i];
      for (let j = 0; j < 2; j++) {
        if (hash(v.t, i * 2 + j, 91) > 0.75) continue;
        const f = tri(nu / 30000 + hash(v.t, i * 2 + j, 92));
        this.zetFig(X + (kx - 0.03 + f * 0.06) * T, Y + (ky + 0.045 + j * 0.012) * T, Math.floor(hash(v.t, i * 2 + j, 93) * KLEDING.length), Math.floor(hash(v.t, i * 2 + j, 94) * 3));
      }
    }
  }

  // Lichtjes in de bomen en langs de snoeren van de decembermarkt; ze twinkelen een beetje.
  kerstLichtjes(v, X, Y, nu) {
    const T = this.T, s = v.snoer;
    for (let i = 0; i < s.length; i += 6) for (let k = 1; k < 9; k++) {
      const t = k / 9, u = 1 - t, x = u * u * s[i] + 2 * u * t * s[i + 2] + t * t * s[i + 4], y = u * u * s[i + 1] + 2 * u * t * s[i + 3] + t * t * s[i + 5];
      this.zetLicht(X + x * T, Y + y * T, Math.max(1.2, T * 0.012), k & 1 ? WARM : AMBER, 0.6 + 0.3 * Math.sin(nu / 400 + k + i));
    }
    for (let b = 0; b < v.bomen.length; b++) {
      const [bx, by] = v.bomen[b];
      for (let k = 0; k < 5; k++) {
        const a = k * 1.26 + b, r = 0.035;
        this.zetLicht(X + (bx + Math.cos(a) * r) * T, Y + (by - 0.055 + Math.sin(a) * r * 0.8) * T, Math.max(1.2, T * 0.011), WARM, 0.5 + 0.4 * frac(nu / 1300 + k * 0.37 + b * 0.11));
      }
    }
    for (const [kx, ky] of PL.kramen) this.zetLicht(X + kx * T, Y + (ky + 0.03) * T, T * 0.05, WARM, 0.4);
  }

  zetFig(x, y, kleding, huid) {
    if (this.nFig >= PLAFOND.mensen || !this.opScherm(x, y, 10)) return;
    const o = this.nFig++ * 4, f = this.fig;
    f[o] = x; f[o + 1] = y; f[o + 2] = kleding; f[o + 3] = huid;
  }

  // Alle figuren in een paar vullingen: schaduw, lijf per kleur, hoofdjes per huidskleur.
  tekenFiguren(c) {
    const n = this.nFig, f = this.fig, T = this.T;
    this.n.mensen = n;
    if (!n) return;
    const r = Math.max(0.8, T * 0.0055), hr = Math.max(0.6, T * 0.0036);
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath();
    for (let i = 0; i < n; i++) stip(c, f[i * 4] + r * 0.6, f[i * 4 + 1] + r * 0.7, r);
    c.fill();
    for (let kl = 0; kl < KLEDING.length; kl++) {
      c.fillStyle = KLEDING[kl]; c.beginPath();
      let iets = false;
      for (let i = 0; i < n; i++) if (f[i * 4 + 2] === kl) { iets = true; stip(c, f[i * 4], f[i * 4 + 1], r); }
      if (iets) c.fill();
    }
    for (let h = 0; h < HUID.length; h++) {
      c.fillStyle = HUID[h]; c.beginPath();
      let iets = false;
      for (let i = 0; i < n; i++) if (f[i * 4 + 3] === h) { iets = true; stip(c, f[i * 4], f[i * 4 + 1] - r * 0.9, hr); }
      if (iets) c.fill();
    }
  }

  // Licht uit de etalages bij de stadsingang, op de stoep.
  zetEtalages() {
    const E = this.etalages, T = this.T, sc = this.sc, Tw = this.geo.T;
    for (let i = 0; i < E.length; i += 2) {
      if (!this.inBeeld(E[i], E[i + 1], Tw * 0.1)) continue;
      this.zetLicht(E[i] * sc + this.ox, E[i + 1] * sc + this.oy, T * 0.07, WARM, 0.3);
    }
  }

  // Na tekenNacht en de lichten van leven, grens, infra en kust: de lantaarns, de markt en de bouwlamp.
  tekenLichten(c, view, sc, nu) {
    const nacht = view.nacht ?? 0;
    const k = nacht * (this.vervaag ?? 1);
    if (k < 0.05 || !this.gloed || !this.nLicht) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
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

  // ---------- voor tests en andere lagen ----------

  // Wat er dit beeld getekend is.
  telling() { return { ...this.n, sprites: this.cache.size }; }

  statistiek() {
    const tel = (s) => this.vakjes.filter((v) => v.soort === s).length;
    return {
      sprites: this.cache.size, bytes: this.bytes, gebakken: this.gebakken,
      vakjes: this.vakjes.length, pleinen: tel(PLEIN), parken: tel(PARK), delen: tel(DEEL), bouwplaatsen: this.bouwplaatsen.length,
      autos: this.autos.length / 6, meubels: this.meubels.length / 5, plasplekken: this.plasplekken.length / 4, fietsen: this.fietsen.length / 5,
      paaltjes: this.paaltjes.length / 2, voetlichten: this.voetlichten.length / 6, etalages: this.etalages.length / 2,
    };
  }

  // Vrije stadsgrond van deze laag (wereld): andere lagen kunnen hier wegblijven. 0 niets, 1 plein/park/kwart of
  // bouwwerf of bouwhek.
  bezetDoorStad(x, y) {
    const px = Math.floor(x / RC), py = Math.floor(y / RC);
    if (px < 0 || py < 0 || px >= RW || py >= RH) return 0;
    return this.raster[py * RW + px] & BOUWP ? 1 : 0;
  }

  // Waar alles ligt (wereldcoördinaten), alleen-lezen: om naartoe te zoomen of te testen.
  plekken() { return this.plekLijst; }
}
