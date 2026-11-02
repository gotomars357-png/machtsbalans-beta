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
export const PLAFOND = { vuurtorens: 10, pieren: 8, havenhoofden: 16, jachthavens: 6, boeien: 48, rotsen: 90, zeehonden: 16, spatten: 24, rollers: 90, kades: 40, woonboten: 24, aken: 12, stuwen: 6, dammen: 2, windparken: 4, turbines: 48, booreilanden: 4, viskwekerijen: 8, lichten: 260, bakken: 2 };
// Vanaf welke zoom iets verschijnt (4-6 grof, 8-10 middel, 12-14 klein).
export const DREMPEL = { groot: 4, havenhoofd: 4.5, viskweek: 5, aak: 5, rots: 5.5, kade: 5.5, stuw: 5.5, pier: 6, jachthaven: 6, boei: 7, woonboot: 7, zeehond: 8, fijn: 8, roller: 9, spat: 9, klein: 11, kleinst: 13 };
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
  const leven = levenWater(geo, b.eigenaar);
  return { kapen: kaap, rotsen: Float32Array.from(rots), rollers: Float32Array.from(rol), baaien, aakRuns, dammen, leven };
}

// Schijven (x, y, r) waar leven.js boten, eenden of zwemmers heeft, alleen uit de kaart.
function levenWater(geo, eig) {
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
      const d = Math.hypot(beste.x - a.x, beste.y - a.y), k = Math.ceil(d / (0.2 * T));
      for (let s = 0; s <= k; s++) uit.push(a.x + ((beste.x - a.x) * s) / k, a.y + ((beste.y - a.y) * s) / k, 0.24 * T);
    }
  }
  return Float32Array.from(uit);
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
    this.gloed = null;
    this.bundel = null;
    this.nul();
  }

  leeg() {
    this.vuurtorens = []; this.havenhoofden = []; this.boeien = new Float32Array(0); this.pieren = []; this.jachthavens = [];
    this.kades = []; this.woonboten = []; this.aken = []; this.stuwen = []; this.dammen = []; this.windparken = [];
    this.turbines = new Float32Array(0); this.booreilanden = []; this.viskwekerijen = [];
    this.rotsen = new Float32Array(0); this.rollers = new Float32Array(0); this.plekLijst = [];
  }

  nul() {
    this.n = { vuurtorens: 0, pieren: 0, havenhoofden: 0, jachthavens: 0, boeien: 0, rotsen: 0, zeehonden: 0, spatten: 0, rollers: 0, kades: 0, woonboten: 0, aken: 0, stuwen: 0, dammen: 0, windparken: 0, turbines: 0, booreilanden: 0, viskwekerijen: 0, lichten: 0 };
    this.nLicht = 0; this.nBundel = 0;
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
    c.save();
    c.lineCap = 'butt';
    c.lineJoin = 'round';
    if (z >= DREMPEL.roller - 0.5) this.tekenRollers(c, a * smooth(DREMPEL.roller - 0.5, DREMPEL.roller + 0.5, z));
    this.tekenDammen(c, a);
    if (z >= DREMPEL.viskweek - 0.5) this.tekenViskwekerijen(c, a * smooth(DREMPEL.viskweek - 0.5, DREMPEL.viskweek + 0.3, z));
    if (z >= DREMPEL.stuw - 0.5) this.tekenStuwen(c, a * smooth(DREMPEL.stuw - 0.5, DREMPEL.stuw + 0.3, z));
    if (z >= DREMPEL.kade - 0.5) this.tekenKades(c, a * smooth(DREMPEL.kade - 0.5, DREMPEL.kade + 0.3, z));
    if (z >= DREMPEL.woonboot - 0.5) this.tekenWoonboten(c, a * smooth(DREMPEL.woonboot - 0.5, DREMPEL.woonboot + 0.3, z));
    if (z >= DREMPEL.aak - 0.5) this.tekenAken(c, a * smooth(DREMPEL.aak - 0.5, DREMPEL.aak + 0.3, z));
    if (z >= DREMPEL.boei - 0.5) this.tekenBoeien(c, a * smooth(DREMPEL.boei - 0.5, DREMPEL.boei + 0.3, z));
    if (z >= DREMPEL.havenhoofd - 0.4) this.tekenHavenhoofden(c, a * smooth(DREMPEL.havenhoofd - 0.4, DREMPEL.havenhoofd + 0.3, z));
    if (z >= DREMPEL.jachthaven - 0.5) this.tekenJachthavens(c, a * smooth(DREMPEL.jachthaven - 0.5, DREMPEL.jachthaven + 0.3, z));
    if (z >= DREMPEL.pier - 0.5) this.tekenPieren(c, a * smooth(DREMPEL.pier - 0.5, DREMPEL.pier + 0.3, z));
    if (z >= DREMPEL.rots - 0.5) this.tekenRotsen(c, a * smooth(DREMPEL.rots - 0.5, DREMPEL.rots + 0.3, z));
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
          const d = 0.4 + (1 - p) * 5.5, cx = x + nx * d, cy = y + ny * d, hl = L * (0.55 + 0.45 * p);
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
    };
  }

  // Waar alles ligt (wereldcoördinaten), alleen-lezen: om naartoe te zoomen of te testen.
  plekken() { return this.plekLijst; }
}
