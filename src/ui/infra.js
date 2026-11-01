// Infrastructuur op de kaart (pakket B van de inzoomronde): wegdetail over de bestaande wegen, spoorlijnen met
// rijdende treinen, hoogspanningslijnen, containerhavens met kranen, een vliegveld bij elke hoofdstad, bruggen,
// brandstofdepots en pijpleidingen. Alles komt trapsgewijs op bij het inzoomen (zie DREMPEL).
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Waar iets ligt volgt uit de kaart, de gebouwen
// en vaste hashes van tegel en volgnummer; de klok stuurt alleen beweging. Geen Math.random, geen Date.
// Licht uit het noordwesten zoals de andere lagen: schaduwen vallen naar het zuidoosten, hoge dingen (masten,
// kranen, palen) staan schuin omhoog getekend zoals de gebouwen in detail.js.

import { seizoen, weer, wind } from './seizoen.js';

// ---------- gedeelde hulpjes (eigen kopie, zie inzoom-spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
const tri = (v) => 1 - Math.abs(1 - 2 * frac(v));
const TAU = Math.PI * 2;
const SCHUIN = 0.566; // schaduwlengte per hoogte-eenheid, zon op ~45° in het noordwesten (0.8 · √½)
const COS06 = Math.cos(0.6), SIN06 = Math.sin(0.6); // draaiing van de boomschaduw

// Reeks pseudo-random getallen uit één zaad (mulberry32, dezelfde als in detail.js en leven.js).
function rnd(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Canvasfabriek: pas bij gebruik een canvas maken, zodat de module ook zonder document (in Node) laadt.
const standaardFabriek = (w, h) => (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h })
  : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : null);
let fabriek = standaardFabriek;
export function zetCanvasFabriek(fn) { fabriek = fn ?? standaardFabriek; }

// ---------- vaste waarden ----------

// Harde plafonds per beeld: een drukke wereld mag nooit de framerate opeten.
export const PLAFOND = { sporen: 60, treinen: 24, wagons: 160, masten: 240, lantaarns: 260, haltes: 16, borden: 120, bomen: 220, verkeerslichten: 80, kruisingen: 40, vliegtuigen: 16, kranen: 24, lichten: 600, bakken: 2 };
// Vanaf welke zoom iets verschijnt (de kaart wordt 'diep' op zoom 4). Andere lagen mogen dit lezen.
export const DREMPEL = { spoor: 4, kades: 4, vliegveld: 4, hoogspanning: 4.5, pijp: 4.5, dwarsliggers: 5.5, stoeprand: 5.5, markering: 8, lantaarn: 8, zebra: 8, bovenleiding: 8, halte: 9, overweg: 9, verkeerslicht: 11, bord: 11, sein: 11, klein: 13 };
const MAX_SPRITES = 40, MAX_BYTES = 48 * 1024 * 1024, MAX_P = 640, MAX_KLEIN = 400;

// Soort plek per tegel (wat er staat, voor de keuze van routes en doelen).
const LEEG = 0, HOOFD = 1, STAD = 2, IND = 3, ENERGIE = 4, HAVEN = 5, KNOOP = 6, OVERIG = 7;
// Gebouwen uit andere packs met dezelfde tekening (zelfde lijst als TEKENING_ALIAS in map.js).
const ALIAS = { olieveld: 'centrale', staalfabriek: 'industrie', landbouw: 'boerderij', zware_industrie: 'industrie', ruimtevaartcentrum: 'chipfabriek', spoor: 'opslag' };
const INDUSTRIE = { industrie: 1, mijn: 1, chipfabriek: 1 };
const ENERGIEBRON = { centrale: 1, zonnepark: 1 };

// Kleuren. Fictief en zonder merken; liveries zijn alleen kleurvlakken.
const ASFALT = '#4a4a47', BAAN = '#2e3032', BETON = '#a7a39a', BETON_D = '#8b877e', GRIND = '#8a8173', GRIND_SNEEUW = '#c9cbcc';
const GRIND_RAND = '#4f493f', WIT = '#ecebe4', GEEL = '#dcb43c', STAAL = '#c7cbd0', HOUT = '#5b4636', PAAL = '#3a3d40', GLAS = '#2f4152';
const CONTAINERS = ['#b8442f', '#2f6d9a', '#d9a63a', '#3d7a4f', '#7a7d80', '#c8c2b4', '#8a4a7a', '#d46a2a'];
const AUTOS = ['#c8ccd0', '#2c3e50', '#8e2a24', '#f2f2ef', '#3a6ea5', '#5b5f63', '#b08d3c', '#2f5d3a'];
const KRAAN = ['#d6a23a', '#2e6fa0', '#c84a32'];
const LIVREI = [['#f2f2ee', '#2f6d9a'], ['#f2f2ee', '#c0392b'], ['#e9e6dc', '#3d7a4f'], ['#f2f2ee', '#d9a63a']];
const RIJTUIG = ['#d9d4c4', '#c9a43a', '#c43c32', '#3f6e9e'];
const LOC = ['#c43c32', '#2f5d8a', '#d9a63a', '#3d6b48'];
const WAGON = ['#6b4a36', '#55595e', '#2f6d9a', '#b8442f', '#3d7a4f'];
const BUS = ['#d9a63a', '#2f6d9a', '#c43c32', '#3d7a4f'];
const GRAS = ['#6f8f4a', '#868a4e', '#7b8660']; // zomer en lente, herfst, winter
const BORDEN = 5;

// Lichtsoorten in de lichtbuffer (index in this.gloed; 0 is de warme gloed van de kaart).
const WARM = 0, ROOD = 1, GROEN = 2, KOEL = 3, BLAUW = 4, AMBER = 5;
const LICHTKLEUR = [null, [255, 50, 40], [70, 255, 120], [235, 242, 255], [90, 140, 255], [255, 170, 40]];

// Stride van de buffers.
const LICHT = 5; // x, y, r, soort, sterkte
const LUCHT = 8; // gx, gy, hoogte (px), hoek, schaal, livrei, alfa, lengte (px)

// Gedraaide rechthoek rond (x, y), lang 2l langs (hx, hy), breed 2w. Voegt toe aan het open pad.
function rechthoek(c, x, y, hx, hy, l, w) {
  const px = -hy * w, py = hx * w, lx = hx * l, ly = hy * l;
  c.moveTo(x + lx + px, y + ly + py);
  c.lineTo(x + lx - px, y + ly - py);
  c.lineTo(x - lx - px, y - ly - py);
  c.lineTo(x - lx + px, y - ly + py);
  c.closePath();
}

function stip(c, x, y, r) {
  if (r < 1.5) { c.rect(x - r, y - r, r * 2, r * 2); return; }
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, TAU);
}

// Maat van gebakken bitmaps in stappen van een kwart octaaf: zoomen bakt niet elk beeld opnieuw.
const emmer = (px) => Math.min(MAX_P, Math.max(24, Math.round(Math.pow(2, Math.round(Math.log2(Math.max(1, px)) * 4) / 4))));

// ---------- bakken (lokale coördinaten: 1 = één tegel; (sx, sy) is het zuidoosten in dat stelsel) ----------

function vulRond(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }

// Vliegveld over twee tegels: startbaan langs de lokale x-as, taxibaan, platform, terminal, toren, hangars.
function bakVliegveld(g, v, b) {
  const r = rnd(v.zaad), { sx, sy } = b, fijn = b.P > 300;
  g.fillStyle = GRAS[b.gs]; g.fillRect(-1, -0.5, 2, 1);
  // maaibanen evenwijdig aan de baan
  for (let i = 0; i < 10; i++) { g.fillStyle = i & 1 ? 'rgba(255,255,240,0.06)' : 'rgba(0,0,0,0.05)'; g.fillRect(-1, -0.5 + i * 0.1, 2, 0.1); }
  // sneeuw in plekken (geen witte vlakte); de banen zelf zijn geveegd en komen er later overheen
  if (b.sn) {
    g.fillStyle = b.sn === 2 ? 'rgba(238,241,244,0.78)' : 'rgba(238,241,244,0.5)';
    for (let i = 0; i < 22 * b.sn; i++) { g.beginPath(); g.ellipse(-1 + r() * 2, -0.5 + r(), 0.05 + r() * 0.13, 0.025 + r() * 0.06, r() * 3, 0, TAU); g.fill(); }
  }
  g.strokeStyle = 'rgba(55,58,56,0.75)'; g.lineWidth = 0.004; g.setLineDash([0.014, 0.006]);
  g.strokeRect(-0.98, -0.48, 1.96, 0.96); g.setLineDash([]);
  // naderingslichten (de palen; 's nachts branden ze) buiten de baankoppen
  g.fillStyle = '#6a6c6e';
  for (const d of [-1, 1]) for (let i = 0; i < 5; i++) { const x = d * (0.94 + i * 0.022); g.fillRect(x - 0.002, -0.255, 0.004, 0.03); }
  // startbaan: berm, asfalt, markeringen
  g.fillStyle = '#5c5e5f'; g.fillRect(-0.93, -0.3, 1.86, 0.12);
  g.fillStyle = BAAN; g.fillRect(-0.92, -0.285, 1.84, 0.09);
  if (b.sn) { g.fillStyle = 'rgba(240,243,246,0.85)'; g.fillRect(-0.93, -0.3, 1.86, 0.012); g.fillRect(-0.93, -0.192, 1.86, 0.012); }
  g.fillStyle = WIT;
  g.fillRect(-0.9, -0.28, 1.8, 0.003); g.fillRect(-0.9, -0.203, 1.8, 0.003);
  for (let x = -0.76; x < 0.76; x += 0.05) g.fillRect(x, -0.2415, 0.028, 0.003);
  for (const d of [-1, 1]) {
    // drempel ('piano'), richtingsblokken zonder cijfers, landingszone en mikpunt
    for (let k = 0; k < 8; k++) g.fillRect(d > 0 ? 0.865 : -0.9, -0.276 + k * 0.0095 + (k >= 4 ? 0.0055 : 0), 0.035, 0.0055);
    for (let k = 0; k < 3; k++) g.fillRect(d * 0.835 - 0.006, -0.254 + k * 0.01, 0.012, 0.006);
    for (const x of [0.7, 0.63, 0.56]) { g.fillRect(d * x - 0.012, -0.262, 0.024, 0.005); g.fillRect(d * x - 0.012, -0.223, 0.024, 0.005); }
    g.fillRect(d * 0.76 - 0.025, -0.266, 0.05, 0.009); g.fillRect(d * 0.76 - 0.025, -0.223, 0.05, 0.009);
    // blast pad met gele pijlpunten
    g.fillStyle = '#3c3e40'; g.fillRect(d > 0 ? 0.92 : -0.965, -0.27, 0.045, 0.06);
    g.strokeStyle = GEEL; g.lineWidth = 0.003; g.beginPath();
    for (let k = 0; k < 3; k++) { const x = d * (0.93 + k * 0.012); g.moveTo(x + d * 0.01, -0.265); g.lineTo(x, -0.24); g.lineTo(x + d * 0.01, -0.215); }
    g.stroke(); g.fillStyle = WIT;
  }
  // taxibaan en verbindingen, gele hartlijn en stopstrepen
  g.fillStyle = '#3a3c3e';
  g.fillRect(-0.87, -0.118, 1.74, 0.036);
  for (const x of [-0.86, -0.3, 0.3, 0.86]) g.fillRect(x - 0.018, -0.2, 0.036, 0.1);
  g.strokeStyle = GEEL; g.lineWidth = 0.003; g.beginPath();
  g.moveTo(-0.86, -0.1); g.lineTo(0.86, -0.1);
  for (const x of [-0.86, -0.3, 0.3, 0.86]) { g.moveTo(x, -0.1); g.lineTo(x, -0.205); }
  g.stroke();
  g.lineWidth = 0.002; g.beginPath();
  for (const x of [-0.86, -0.3, 0.3, 0.86]) for (const dy of [0, 0.006]) { g.moveTo(x - 0.016, -0.17 + dy); g.lineTo(x + 0.016, -0.17 + dy); }
  g.stroke();
  // platform met voegen en opstelplaatsen
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(-0.6 + sx * 0.006, -0.082 + sy * 0.006, 1.06, 0.252);
  g.fillStyle = '#aaa69d'; g.fillRect(-0.6, -0.082, 1.06, 0.252);
  if (fijn) {
    g.strokeStyle = 'rgba(70,68,62,0.18)'; g.lineWidth = 0.0015; g.beginPath();
    for (let x = -0.6; x < 0.46; x += 0.04) { g.moveTo(x, -0.082); g.lineTo(x, 0.17); }
    for (let y = -0.082; y < 0.17; y += 0.04) { g.moveTo(-0.6, y); g.lineTo(0.46, y); }
    g.stroke();
  }
  g.strokeStyle = GEEL; g.lineWidth = 0.003; g.beginPath();
  for (const x of v.standen) { g.moveTo(x, -0.082); g.lineTo(x, 0.12); g.moveTo(x - 0.02, 0.125); g.lineTo(x + 0.02, 0.125); }
  g.stroke();
  // terminal: schaduw, dak met daklichten, glazen gevel en loopbruggen
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-0.56 + sx * 0.03, 0.17 + sy * 0.03, 0.92, 0.14);
  g.fillStyle = '#c4c8cc'; g.fillRect(-0.56, 0.17, 0.92, 0.14);
  g.fillStyle = '#d6d9dc'; g.fillRect(-0.56, 0.17, 0.92, 0.05);
  g.fillStyle = GLAS; g.fillRect(-0.56, 0.17, 0.92, 0.008);
  g.fillStyle = 'rgba(40,55,70,0.55)'; for (let x = -0.52; x < 0.32; x += 0.07) g.fillRect(x, 0.235, 0.04, 0.02);
  if (fijn) { g.fillStyle = '#8e9398'; for (let i = 0; i < 6; i++) g.fillRect(-0.5 + r() * 0.8, 0.275 + r() * 0.02, 0.022, 0.012); }
  g.fillStyle = '#9aa0a6';
  for (const x of v.standen) { g.save(); g.translate(x, 0.17); g.rotate(-0.25); g.fillRect(-0.006, -0.065, 0.012, 0.065); g.restore(); }
  // verkeerstoren: lange schaduw, schacht en glazen kanzel
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.028; g.beginPath(); g.moveTo(0.42, 0.25); g.lineTo(0.42 + sx * 0.13, 0.25 + sy * 0.13); g.stroke();
  g.fillStyle = '#b9b9b2'; g.fillRect(0.395, 0.225, 0.05, 0.05);
  g.fillStyle = '#d8d8d2'; vulRond(g, 0.42, 0.25, 0.02);
  g.fillStyle = '#5b6b78'; vulRond(g, 0.42, 0.25, 0.03);
  g.fillStyle = GLAS; vulRond(g, 0.42, 0.25, 0.024);
  g.fillStyle = '#e6e6e0'; vulRond(g, 0.42, 0.25, 0.012);
  // hangars met gebogen daken (licht op de noordwestkant)
  for (const [x0, w] of [[0.5, 0.17], [0.7, 0.18]]) {
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x0 + sx * 0.035, 0.0 + sy * 0.035, w, 0.27);
    const gr = g.createLinearGradient(x0, 0, x0 + w, 0);
    gr.addColorStop(0, '#d4d7d9'); gr.addColorStop(0.5, '#a9adb1'); gr.addColorStop(1, '#7f8387');
    g.fillStyle = gr; g.fillRect(x0, 0.0, w, 0.27);
    g.strokeStyle = 'rgba(60,62,66,0.35)'; g.lineWidth = 0.002; g.beginPath();
    for (let y = 0.03; y < 0.27; y += 0.03) { g.moveTo(x0, y); g.lineTo(x0 + w, y); }
    g.stroke();
    g.fillStyle = '#4b4f54'; g.fillRect(x0 + 0.01, -0.004, w - 0.02, 0.008);
    if (b.sn) { g.fillStyle = 'rgba(240,243,246,0.6)'; g.fillRect(x0, 0.0, w * 0.45, 0.27); }
  }
  // parkeerterrein met auto's en de toegangsweg
  g.fillStyle = '#45474a'; g.fillRect(-0.56, 0.33, 0.92, 0.14); g.fillRect(-0.13, 0.47, 0.06, 0.04);
  g.strokeStyle = 'rgba(230,230,220,0.55)'; g.lineWidth = 0.0018; g.beginPath();
  for (let x = -0.54; x < 0.34; x += 0.026) { g.moveTo(x, 0.335); g.lineTo(x, 0.36); g.moveTo(x, 0.44); g.lineTo(x, 0.465); }
  g.stroke();
  for (let x = -0.54; x < 0.33; x += 0.026) for (const y of [0.348, 0.452]) {
    if (r() > 0.72) continue;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 0.002 + sx * 0.003, y - 0.011 + sy * 0.003, 0.02, 0.022);
    g.fillStyle = AUTOS[Math.floor(r() * AUTOS.length)]; g.fillRect(x + 0.002, y - 0.011, 0.02, 0.022);
    if (fijn) { g.fillStyle = 'rgba(30,40,50,0.6)'; g.fillRect(x + 0.005, y - 0.004, 0.014, 0.007); }
  }
  // brandstoftanks en radarpost
  for (let i = 0; i < 3; i++) {
    const x = -0.85 + i * 0.07, y = 0.06;
    g.fillStyle = 'rgba(0,0,0,0.3)'; vulRond(g, x + sx * 0.02, y + sy * 0.02, 0.028);
    g.fillStyle = '#dcdad4'; vulRond(g, x, y, 0.028);
    g.fillStyle = 'rgba(255,255,255,0.5)'; vulRond(g, x - 0.008, y - 0.008, 0.012);
  }
  g.fillStyle = '#8b877e'; g.fillRect(-0.82, 0.27, 0.05, 0.05);
  g.fillStyle = '#c9c9c2'; vulRond(g, -0.795, 0.295, 0.016);
  if (fijn) {
    // geel-zwarte baanborden bij de verbindingen, blauwe reflectoren langs de taxibaan
    for (const x of [-0.86, -0.3, 0.3, 0.86]) for (const dx of [-0.03, 0.03]) {
      g.fillStyle = '#1f1d1b'; g.fillRect(x + dx - 0.009, -0.152, 0.018, 0.008);
      g.fillStyle = GEEL; g.fillRect(x + dx - 0.008, -0.151, dx < 0 ? 0.008 : 0.016, 0.006);
    }
    g.fillStyle = '#4a7ad0';
    for (let x = -0.84; x <= 0.84; x += 0.06) { vulRond(g, x, -0.12, 0.0025); vulRond(g, x, -0.08, 0.0025); }
  }
  // windzakpaal (de zak zelf beweegt mee met de wind)
  g.fillStyle = '#e6e6e0'; vulRond(g, v.zak[0], v.zak[1], 0.006);
}

// Containerterminal aan een kade: lokaal x langs de kade, y naar het water. Het schip ligt er vast in gebakken.
function bakHaven(g, h, b) {
  const r = rnd(h.zaad), { sx, sy } = b, dq = h.dq, fijn = b.P > 300;
  const y0 = dq - 0.42;
  // schaduw van de kademuur op het water en het schip
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(-0.47, dq, 0.94, 0.02);
  if (h.schip) {
    const a = dq + 0.03, d = 0.085;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath();
    g.moveTo(-0.33 + sx * 0.02, a + sy * 0.02); g.lineTo(0.24 + sx * 0.02, a + sy * 0.02); g.lineTo(0.31 + sx * 0.02, a + d / 2 + sy * 0.02); g.lineTo(0.24 + sx * 0.02, a + d + sy * 0.02); g.lineTo(-0.33 + sx * 0.02, a + d + sy * 0.02); g.closePath(); g.fill();
    g.fillStyle = h.romp; g.beginPath();
    g.moveTo(-0.33, a); g.lineTo(0.24, a); g.lineTo(0.31, a + d / 2); g.lineTo(0.24, a + d); g.lineTo(-0.33, a + d); g.closePath(); g.fill();
    g.fillStyle = '#5a5f63'; g.fillRect(-0.32, a + 0.008, 0.55, d - 0.016);
    for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) {
      if (r() < 0.12) continue;
      g.fillStyle = CONTAINERS[Math.floor(r() * CONTAINERS.length)];
      g.fillRect(-0.22 + i * 0.05, a + 0.012 + j * 0.022, 0.046, 0.02);
      if (fijn) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(-0.22 + i * 0.05, a + 0.012 + j * 0.022, 0.046, 0.004); }
    }
    // brug achteraan met schoorsteen
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-0.31 + sx * 0.03, a + 0.01 + sy * 0.03, 0.06, d - 0.02);
    g.fillStyle = '#eceae4'; g.fillRect(-0.31, a + 0.01, 0.06, d - 0.02);
    g.fillStyle = GLAS; g.fillRect(-0.258, a + 0.014, 0.006, d - 0.028);
    g.fillStyle = '#7a2a24'; g.fillRect(-0.3, a + d / 2 - 0.01, 0.02, 0.02);
  }
  // kadeterrein: beton met voegen, kraanbaan, belijning
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(-0.45 + sx * 0.01, y0 + sy * 0.01, 0.9, 0.42);
  g.fillStyle = '#9d998f'; g.fillRect(-0.45, y0, 0.9, 0.42);
  if (b.sn) { g.fillStyle = b.sn === 2 ? 'rgba(236,239,242,0.55)' : 'rgba(236,239,242,0.3)'; for (let i = 0; i < 10 * b.sn; i++) { g.beginPath(); g.ellipse(-0.45 + r() * 0.9, y0 + r() * 0.36, 0.04 + r() * 0.06, 0.02 + r() * 0.03, 0, 0, TAU); g.fill(); } }
  if (fijn) {
    g.strokeStyle = 'rgba(60,58,52,0.2)'; g.lineWidth = 0.0015; g.beginPath();
    for (let x = -0.45; x < 0.45; x += 0.05) { g.moveTo(x, y0); g.lineTo(x, dq); }
    g.stroke();
  }
  g.fillStyle = '#b6b2a8'; g.fillRect(-0.47, dq - 0.024, 0.94, 0.024);
  g.fillStyle = '#3a3633'; g.fillRect(-0.47, dq - 0.003, 0.94, 0.003);
  g.strokeStyle = '#6d6a64'; g.lineWidth = 0.003; g.beginPath();
  for (const y of [dq - 0.067, dq - 0.015]) { g.moveTo(-0.46, y); g.lineTo(0.46, y); }
  g.stroke();
  g.fillStyle = '#1f1d1b';
  for (let x = -0.44; x < 0.45; x += 0.055) { g.fillRect(x, dq - 0.0015, 0.016, 0.006); if (fijn) vulRond(g, x + 0.03, dq - 0.01, 0.0035); }
  g.strokeStyle = 'rgba(235,235,225,0.6)'; g.lineWidth = 0.002; g.beginPath();
  g.moveTo(-0.44, dq - 0.1); g.lineTo(0.44, dq - 0.1); g.moveTo(-0.44, y0 + 0.03); g.lineTo(0.44, y0 + 0.03);
  g.stroke();
  // containerstapels: drie blokken, vijf rijen, hoogte 1 tot 4 (hoger = langere schaduw, lichter dak)
  for (let blok = 0; blok < 3; blok++) for (let j = 0; j < 5; j++) for (let i = 0; i < 4; i++) {
    const hoog = Math.floor(r() * 5);
    if (!hoog) continue;
    const x = -0.42 + blok * 0.29 + i * 0.062, y = y0 + 0.05 + j * 0.044;
    const k = CONTAINERS[Math.floor(r() * CONTAINERS.length)];
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x + sx * 0.007 * hoog, y + sy * 0.007 * hoog, 0.058, 0.026);
    g.fillStyle = k; g.fillRect(x, y, 0.058, 0.026);
    g.fillStyle = `rgba(255,255,255,${0.04 * hoog})`; g.fillRect(x, y, 0.058, 0.026);
    if (fijn) {
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.0012; g.beginPath();
      for (let q = 1; q < 6; q++) { g.moveTo(x + q * 0.0097, y); g.lineTo(x + q * 0.0097, y + 0.026); }
      g.stroke();
    }
    if (b.sn && r() < 0.5 + 0.25 * b.sn) { g.fillStyle = 'rgba(242,244,246,0.8)'; g.fillRect(x + 0.004, y + 0.003, 0.05, 0.02); }
  }
  // lichtmasten (de voet; de kop en het licht komen per beeld)
  g.fillStyle = '#5a5d60';
  for (const x of [-0.44, 0.44]) vulRond(g, x, dq - 0.2, 0.008);
}

// Station: perrons met overkapping langs de lokale x-as, sporen op vaste banen, stationsgebouw en voorplein.
function bakStation(g, st, b) {
  const r = rnd(st.zaad), { sx, sy } = b, fijn = b.P > 300;
  g.fillStyle = '#b8b1a1'; g.fillRect(-0.48, 0.2, 0.96, 0.28);
  g.fillStyle = b.sn ? GRIND_SNEEUW : GRIND; g.fillRect(-0.5, -0.2, 1, 0.4);
  // vier sporen
  for (const y of st.banen) {
    g.strokeStyle = HOUT; g.lineWidth = 0.032; g.setLineDash([0.008, 0.016]);
    g.beginPath(); g.moveTo(-0.5, y); g.lineTo(0.5, y); g.stroke(); g.setLineDash([]);
    g.strokeStyle = STAAL; g.lineWidth = 0.004; g.beginPath();
    g.moveTo(-0.5, y - 0.0175); g.lineTo(0.5, y - 0.0175); g.moveTo(-0.5, y + 0.0175); g.lineTo(0.5, y + 0.0175); g.stroke();
  }
  // perrons met witte veiligheidslijn
  for (const y of [-0.1, 0.1]) {
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-0.42 + sx * 0.008, y - 0.022 + sy * 0.008, 0.84, 0.044);
    g.fillStyle = '#a9a59b'; g.fillRect(-0.42, y - 0.022, 0.84, 0.044);
    g.fillStyle = WIT; g.fillRect(-0.42, y - 0.022, 0.84, 0.003); g.fillRect(-0.42, y + 0.019, 0.84, 0.003);
  }
  if (fijn) {
    // wachtende reizigers en bankjes op de perrons
    const kleding = ['#c0392b', '#2e86c1', '#f0b429', '#ecefe9', '#34495e', '#2f9e5b'];
    for (const y of [-0.1, 0.1]) {
      g.fillStyle = '#6b4a36'; for (let x = -0.3; x <= 0.3; x += 0.15) g.fillRect(x - 0.012, y - 0.004, 0.024, 0.008);
      for (let i = 0; i < 12; i++) {
        const x = -0.4 + r() * 0.8, yy = y + (r() - 0.5) * 0.028;
        g.fillStyle = 'rgba(0,0,0,0.3)'; vulRond(g, x + sx * 0.004, yy + sy * 0.004, 0.0045);
        g.fillStyle = kleding[Math.floor(r() * kleding.length)]; vulRond(g, x, yy, 0.0045);
        g.fillStyle = '#e0b48a'; vulRond(g, x, yy, 0.0022);
      }
    }
  }
  // overkappingen: half doorzichtig dak met spanten
  for (const y of [-0.1, 0.1]) {
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(-0.34 + sx * 0.04, y - 0.03 + sy * 0.04, 0.68, 0.06);
    g.fillStyle = 'rgba(150,170,185,0.85)'; g.fillRect(-0.34, y - 0.03, 0.68, 0.06);
    g.strokeStyle = 'rgba(70,80,90,0.7)'; g.lineWidth = 0.002; g.beginPath();
    for (let x = -0.34; x <= 0.34; x += 0.04) { g.moveTo(x, y - 0.03); g.lineTo(x, y + 0.03); }
    g.moveTo(-0.34, y); g.lineTo(0.34, y); g.stroke();
    if (b.sn) { g.fillStyle = 'rgba(240,243,246,0.7)'; g.fillRect(-0.34, y - 0.03, 0.68, 0.03); }
  }
  // loopbrug over de sporen
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0.28 + sx * 0.05, -0.2 + sy * 0.05, 0.04, 0.42);
  g.fillStyle = '#7d8187'; g.fillRect(0.28, -0.2, 0.04, 0.42);
  g.fillStyle = '#9ea2a7'; g.fillRect(0.28, -0.2, 0.04, 0.008);
  // stationsgebouw met kap en klokje
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-0.26 + sx * 0.04, 0.2 + sy * 0.04, 0.52, 0.13);
  g.fillStyle = '#9c5a3c'; g.fillRect(-0.26, 0.2, 0.52, 0.13);
  g.fillStyle = '#b8714f'; g.fillRect(-0.26, 0.2, 0.52, 0.06);
  g.fillStyle = '#7a4630'; g.fillRect(-0.26, 0.262, 0.52, 0.004);
  g.fillStyle = '#e8e4da'; vulRond(g, 0, 0.29, 0.016);
  g.strokeStyle = '#333'; g.lineWidth = 0.002; g.beginPath(); g.moveTo(0, 0.29); g.lineTo(0, 0.279); g.moveTo(0, 0.29); g.lineTo(0.008, 0.29); g.stroke();
  // voorplein: taxi's, auto's, fietsenrekken, bomen
  for (let i = 0; i < 10; i++) {
    if (r() < 0.3) continue;
    const x = -0.44 + i * 0.09, y = 0.42;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + sx * 0.004, y + sy * 0.004, 0.024, 0.045);
    g.fillStyle = i < 3 ? '#d9b43a' : AUTOS[Math.floor(r() * AUTOS.length)]; g.fillRect(x, y, 0.024, 0.045);
    if (fijn) { g.fillStyle = 'rgba(30,40,50,0.6)'; g.fillRect(x + 0.003, y + 0.012, 0.018, 0.009); }
  }
  if (fijn) {
    g.strokeStyle = '#505357'; g.lineWidth = 0.0015; g.beginPath();
    for (let i = 0; i < 14; i++) { const x = 0.3 + (i % 7) * 0.022, y = 0.36 + Math.floor(i / 7) * 0.03; g.moveTo(x, y); g.lineTo(x, y + 0.02); }
    g.stroke();
  }
  for (const [x, y] of [[-0.42, 0.25], [0.42, 0.25], [-0.36, 0.33]]) {
    g.fillStyle = 'rgba(0,0,0,0.28)'; vulRond(g, x + sx * 0.03, y + sy * 0.03, 0.035);
    g.fillStyle = b.gs === 2 ? '#6b5a44' : b.gs === 1 ? '#b0773a' : '#3f6a34'; vulRond(g, x, y, 0.035);
    g.fillStyle = 'rgba(255,255,220,0.18)'; vulRond(g, x - 0.01, y - 0.01, 0.018);
  }
}

// Brandstofdepot: tanks in een wal, leidingen en een laadstation voor tankwagens.
function bakDepot(g, d, b) {
  const r = rnd(d.zaad), { sx, sy } = b;
  g.fillStyle = '#8f8a7f'; g.fillRect(-0.47, -0.45, 0.94, 0.92);
  g.fillStyle = '#a49f93'; g.fillRect(-0.43, -0.41, 0.86, 0.68);
  g.strokeStyle = '#77736a'; g.lineWidth = 0.012; g.strokeRect(-0.43, -0.41, 0.86, 0.68);
  // leidingenbrug tussen de tankrijen
  g.strokeStyle = '#6f7378'; g.lineWidth = 0.006; g.beginPath();
  g.moveTo(-0.4, -0.06); g.lineTo(0.4, -0.06); g.moveTo(-0.4, -0.045); g.lineTo(0.4, -0.045); g.moveTo(0.36, -0.05); g.lineTo(0.36, 0.34);
  g.stroke();
  for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) {
    const x = -0.27 + i * 0.27, y = -0.22 + j * 0.31, rr = 0.075 + r() * 0.035;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x + sx * 0.05, y + sy * 0.05, rr * 1.05, rr, 0, 0, TAU); g.fill();
    const gr = g.createRadialGradient(x - rr * 0.4, y - rr * 0.4, rr * 0.1, x, y, rr);
    gr.addColorStop(0, '#f4f2ec'); gr.addColorStop(1, d.kleur);
    g.fillStyle = gr; vulRond(g, x, y, rr);
    g.strokeStyle = 'rgba(80,80,76,0.6)'; g.lineWidth = 0.003; g.beginPath(); g.arc(x, y, rr * 0.82, 0, TAU); g.stroke();
    g.beginPath(); g.arc(x, y, rr, 0.3, 1.3); g.stroke();
    g.fillStyle = '#6a6c6e'; vulRond(g, x, y, 0.008);
    if (b.sn) { g.fillStyle = 'rgba(244,246,248,0.75)'; vulRond(g, x, y, rr * 0.7); }
  }
  // laadstation met afdak en twee tankwagens
  g.fillStyle = '#4a4a47'; g.fillRect(-0.45, 0.3, 0.8, 0.16);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-0.3 + sx * 0.02, 0.31 + sy * 0.02, 0.32, 0.1);
  for (let i = 0; i < 2; i++) {
    const x = -0.26 + i * 0.15;
    g.fillStyle = '#d7d5cf'; g.fillRect(x, 0.33, 0.1, 0.032); g.fillStyle = '#c43c32'; g.fillRect(x + 0.1, 0.333, 0.025, 0.026);
  }
  g.fillStyle = 'rgba(200,200,195,0.85)'; g.fillRect(-0.3, 0.31, 0.32, 0.03);
  // kantoortje
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0.12 + sx * 0.02, 0.32 + sy * 0.02, 0.1, 0.08);
  g.fillStyle = '#c9c4b8'; g.fillRect(0.12, 0.32, 0.1, 0.08);
  g.fillStyle = '#9a6a4a'; g.fillRect(0.12, 0.32, 0.1, 0.03);
}

// Verkeersvliegtuig van boven, neus naar +x. Met schaduw = alleen het silhouet in zwart.
function bakVliegtuig(g, liv, schaduw) {
  const [romp, staart] = LIVREI[liv];
  g.fillStyle = schaduw ? '#000' : romp;
  g.beginPath(); g.moveTo(0.012, 0); g.lineTo(-0.022, 0.072); g.lineTo(-0.034, 0.072); g.lineTo(-0.02, 0); g.lineTo(-0.034, -0.072); g.lineTo(-0.022, -0.072); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-0.055, 0); g.lineTo(-0.073, 0.03); g.lineTo(-0.08, 0.03); g.lineTo(-0.072, 0); g.lineTo(-0.08, -0.03); g.lineTo(-0.073, -0.03); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(-0.004, 0, 0.078, 0.0095, 0, 0, TAU); g.fill();
  if (schaduw) return;
  g.fillStyle = '#8d9196';
  for (const y of [-0.028, 0.028]) { g.beginPath(); g.ellipse(0.002, y, 0.011, 0.0042, 0, 0, TAU); g.fill(); }
  g.fillStyle = staart; g.fillRect(-0.082, -0.0025, 0.032, 0.005);
  g.fillRect(-0.034, 0.066, 0.012, 0.006); g.fillRect(-0.034, -0.072, 0.012, 0.006);
  g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.ellipse(-0.004, -0.0035, 0.06, 0.0028, 0, 0, TAU); g.fill();
  g.fillStyle = '#2b3a48'; g.beginPath(); g.ellipse(0.066, 0, 0.005, 0.006, 0, -1.2, 1.2); g.fill();
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

// ---------- de laag ----------

export class InfraLaag {
  constructor() {
    // Eigen klok zoals de levenslaag: loopt alleen als het spel loopt, staat stil op pauze.
    this.klok = 0;
    this.state = null;
    this.geo = null;
    this.sig = '';
    this.landSig = [];
    this.wegen = [];
    this.kruisingen = [];
    this.overwegen = [];
    this.perLand = [];
    this.routes = [];
    this.stations = [];
    this.vliegvelden = [];
    this.havens = [];
    this.depots = [];
    this.lijnen = [];
    this.pijpen = [];
    this.res = new Uint8Array(0);
    this.cache = new Map(); // sleutel → gebakken bitmap, in LRU-volgorde
    this.laatste = new Map(); // sleutel zonder maat → laatst gebakken bitmap (tijdelijke vervanger tijdens het zoomen)
    this.bytes = 0;
    this.gebakken = 0;
    this.licht = new Float32Array(PLAFOND.lichten * LICHT);
    this.lucht = new Float32Array(PLAFOND.vliegtuigen * LUCHT);
    this.zw = new Int32Array(4096); // zichtbare wegen, per beeld
    this.zr = new Int32Array(PLAFOND.sporen); // zichtbare spoorroutes, per beeld
    this.gloed = null;
    this.vliegSprites = new Map();
    this.nul();
  }

  nul() {
    this.n = { sporen: 0, treinen: 0, wagons: 0, masten: 0, lantaarns: 0, haltes: 0, borden: 0, verkeerslichten: 0, kruisingen: 0, vliegtuigen: 0, kranen: 0, lichten: 0, bomen: 0 };
    this.nLicht = 0; this.nLucht = 0; this.nZw = 0; this.nZr = 0;
  }

  // Na het laden van een spel: alles opnieuw afleiden.
  laad(view) {
    this.state = view.state;
    this.geo = view.geo;
    this.eigenaar = view.eigenaar;
    this.sig = '';
    this.landSig = [];
    this.perLand = [];
    this.vorig = [];
    const n = this.geo.tegels.length;
    this.res = new Uint8Array(n);
    this.resLand = new Int16Array(n).fill(-1);
    this.soort = new Uint8Array(n);
    this.olie = new Uint8Array(n);
    this.dist = new Float64Array(n);
    this.prev = new Int32Array(n);
    this.heapT = new Int32Array(n * 8 + 8);
    this.heapK = new Float64Array(n * 8 + 8);
    this.cache.clear();
    this.laatste.clear();
    this.bytes = 0;
  }

  isWater(x, y) {
    const e = this.eigenaar;
    if (!e) return false;
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= 1000 || py >= 620) return true;
    return e[py * 1000 + px] === -1;
  }

  // Wat op een tegel van deze laag ligt: 0 niets, 1 station, 2 vliegveld, 3 haven, 4 depot. Voor andere lagen
  // (bijvoorbeeld om er geen bomen op te zetten).
  gereserveerd(t) { return this.res[t] ?? 0; }

  // Hetzelfde voor een wereldpunt: staat hier een bouwwerk van deze laag (dan hoort er geen straatmeubilair)?
  opBouwwerk(wx, wy) {
    const Tw = this.geo.T;
    if (wx < 0 || wy < 0 || wx >= this.geo.kol * Tw) return 0;
    return this.res[Math.floor(wy / Tw) * this.geo.kol + Math.floor(wx / Tw)] ?? 0;
  }

  // ---------- het netwerk afleiden (alleen als er iets verandert) ----------

  werkCache(view) {
    const s = this.state;
    let nP = 0, somT = 0;
    for (let i = 0; i < s.landen.length; i++) {
      const l = s.landen[i];
      nP += l.plaatsingen.length + l.bouw.length * 7;
      for (let j = 0; j < l.plaatsingen.length; j++) somT += l.plaatsingen[j].t;
      for (let j = 0; j < l.bouw.length; j++) somT += l.bouw[j].tegel * 3;
    }
    const sig = `${s.grensVersie}|${nP}|${somT}|${s.landen.length}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.bouwSoorten();
    this.bouwWegen(view);
    // Per land alleen opnieuw rekenen als dat land zelf iets bouwde (padzoeken is het duurste deel).
    for (const land of s.landen) {
      let t = 0;
      for (const p of land.plaatsingen) t = (t * 31 + p.t + 7) | 0;
      for (const b of land.bouw) t = (t * 17 + b.tegel + 3) | 0;
      const ls = `${s.grensVersie}|${land.plaatsingen.length}|${land.bouw.length}|${t}|${s.landen.length}`;
      if (this.landSig[land.idx] === ls && this.perLand[land.idx]) continue;
      this.landSig[land.idx] = ls;
      this.perLand[land.idx] = this.bouwLand(view, land);
    }
    const pl = this.perLand.filter(Boolean);
    this.routes = pl.flatMap((x) => x.routes);
    this.stations = pl.flatMap((x) => x.stations);
    this.vliegvelden = pl.flatMap((x) => x.vliegvelden);
    this.havens = pl.flatMap((x) => x.havens);
    this.depots = pl.flatMap((x) => x.depots);
    this.lijnen = pl.flatMap((x) => x.lijnen);
    this.pijpen = pl.flatMap((x) => x.pijpen);
    this.bouwOverwegen();
    // De bitmapcache blijft staan: de sleutels beschrijven de bitmap volledig (tegel, stand, seizoen, maat), dus een
    // nieuw gebouw ergens in de wereld hoeft niet alles opnieuw te laten bakken. Wat niet meer gebruikt wordt, valt
    // vanzelf uit de LRU.
  }

  bouwSoorten() {
    const s = this.state, P = s.pack, geo = this.geo;
    this.soort.fill(LEEG);
    this.olie.fill(0);
    for (const land of s.landen) {
      for (const p of land.plaatsingen) {
        if (p.t < 0) continue;
        const g = P.gebouwIndex[p.g];
        const tek = g.tekening ?? ALIAS[g.id] ?? g.id;
        this.soort[p.t] = g.handel_bonus ? HAVEN : tek === 'woonwijk' ? STAD : INDUSTRIE[tek] || g.id === 'spoor' ? IND : ENERGIEBRON[tek] ? ENERGIE : g.knooppunt ? KNOOP : OVERIG;
        if (g.id === 'olieveld') this.olie[p.t] = 1;
      }
    }
    for (const land of s.landen) { const h = geo.hoofdstad[land.idx]; if (h != null && h >= 0) this.soort[h] = HOOFD; }
  }

  // Wegen: precies de lijnen van tekenWegen in map.js (gebouw naar knooppunt), met het stuk buiten beide gebouwen.
  bouwWegen(view) {
    const s = this.state, geo = this.geo, Tw = geo.T;
    const W = [];
    for (const land of s.landen) {
      for (const p of land.plaatsingen) {
        if (p.t < 0) continue;
        const nb = view.knooppuntVoor(land, p.t);
        if (nb < 0) continue;
        const A = geo.tegels[p.t], B = geo.tegels[nb];
        const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
        if (len < Tw * 0.9) continue;
        const ux = dx / len, uy = dy / len, d = 0.5 * Tw / Math.max(Math.abs(ux), Math.abs(uy));
        if (len - 2 * d < 0.15 * Tw) continue;
        const w = { ax: A.x, ay: A.y, bx: B.x, by: B.y, len, ux, uy, s0: d, s1: len - d, stadA: this.soort[p.t] === STAD, stadB: this.soort[nb] === HOOFD, land: land.idx, zaad: (p.t * 4099 + nb) | 0, brug: null };
        w.x0 = Math.min(A.x, B.x); w.x1 = Math.max(A.x, B.x); w.y0 = Math.min(A.y, B.y); w.y1 = Math.max(A.y, B.y);
        // bruggen: waar het zichtbare stuk over water loopt
        let in0 = -1;
        const spans = [];
        for (let q = w.s0; q <= w.s1; q += 1) {
          const nat = this.isWater(A.x + ux * q, A.y + uy * q);
          if (nat && in0 < 0) in0 = q;
          if (!nat && in0 >= 0) { spans.push(Math.max(w.s0, in0 - 0.8), Math.min(w.s1, q + 0.8)); in0 = -1; }
        }
        if (in0 >= 0) spans.push(Math.max(w.s0, in0 - 0.8), w.s1);
        if (spans.length) w.brug = spans;
        W.push(w);
      }
    }
    this.wegen = W;
    // Kruispunten: waar twee wegen elkaar echt snijden, buiten gebouwen. Om en om een rotonde.
    const K = [];
    for (let i = 0; i < W.length && K.length < 200; i++) {
      const a = W[i];
      for (let j = i + 1; j < W.length && K.length < 200; j++) {
        const b = W[j];
        if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) continue;
        const den = a.ux * b.uy - a.uy * b.ux;
        if (Math.abs(den) < 0.3) continue;
        const ex = b.ax - a.ax, ey = b.ay - a.ay;
        const t = (ex * b.uy - ey * b.ux) / den, q = (ex * a.uy - ey * a.ux) / den;
        if (t < a.s0 + 0.12 * Tw || t > a.s1 - 0.12 * Tw || q < b.s0 + 0.12 * Tw || q > b.s1 - 0.12 * Tw) continue;
        const x = a.ax + a.ux * t, y = a.ay + a.uy * t;
        const tg = Math.floor(y / Tw) * geo.kol + Math.floor(x / Tw);
        if (s.bezet[tg] || this.isWater(x, y)) continue;
        if (K.some((k) => Math.abs(k.x - x) + Math.abs(k.y - y) < 0.4 * Tw)) continue;
        K.push({ x, y, a: i, b: j, rotonde: hash(tg, 41) < 0.5, zaad: tg });
      }
    }
    // Wegen zijn kort en ontmoeten elkaar meestal in een gebouw; daarom halverwege langere wegen een
    // T-kruising met een zijweggetje naar het land (een erf, een dorpsstraatje).
    const tegel = (x, y) => Math.floor(y / Tw) * geo.kol + Math.floor(x / Tw);
    for (let i = 0; i < W.length && K.length < 260; i++) {
      const w = W[i];
      if (w.s1 - w.s0 < 0.95 * Tw || hash(w.zaad, 61) > 0.75) continue;
      const voorkeur = hash(w.zaad, 62) < 0.5 ? 1 : -1;
      // zoek langs de weg een plek naast vrij land, eerst aan de voorkeurskant
      zoek: for (const f of [0.5, 0.3, 0.7, 0.2, 0.8]) {
        const q = w.s0 + (w.s1 - w.s0) * f, x = w.ax + w.ux * q, y = w.ay + w.uy * q;
        if (s.bezet[tegel(x, y)] || this.isWater(x, y)) continue;
        for (const kant of [voorkeur, -voorkeur]) {
          const ex = x - w.uy * kant * 0.42 * Tw, ey = y + w.ux * kant * 0.42 * Tw, tg = tegel(ex, ey);
          if (s.bezet[tg] || this.isWater(ex, ey)) continue;
          if (K.some((k) => Math.abs(k.x - x) + Math.abs(k.y - y) < 0.5 * Tw)) continue;
          K.push({ x, y, a: i, b: i, rotonde: false, zij: kant, tg, zaad: (w.zaad * 3 + 1) | 0 });
          break zoek;
        }
      }
    }
    this.kruisingen = K;
  }

  vrij(t, land) {
    const s = this.state, tg = this.geo.tegels[t];
    return !!tg && tg.terrein !== 'water' && !s.bezet[t] && !this.res[t] && s.eigenaar[t] === land;
  }

  reserveer(t, soort, land) { this.res[t] = soort; this.resLand[t] = land; }

  // Station, vliegveld, havens, depot, spoorlijnen, hoogspanning en pijpleidingen van één land.
  bouwLand(view, land) {
    const s = this.state, geo = this.geo, Tw = geo.T, kol = geo.kol, rij = geo.rij, L = land.idx;
    for (let t = 0; t < this.res.length; t++) if (this.resLand[t] === L) { this.res[t] = 0; this.resLand[t] = -1; }
    const uit = { routes: [], stations: [], vliegvelden: [], havens: [], depots: [], lijnen: [], pijpen: [] };
    const h = geo.hoofdstad[L];
    if (h == null || h < 0 || s.eigenaar[h] !== L) return uit;
    const H = geo.tegels[h];
    const cheb = (a, b) => Math.max(Math.abs(geo.tegels[a].k - geo.tegels[b].k), Math.abs(geo.tegels[a].r - geo.tegels[b].r));
    const buren = (t, d, fn) => {
      const tg = geo.tegels[t];
      for (let dr = -d; dr <= d; dr++) for (let dk = -d; dk <= d; dk++) {
        if (!dr && !dk) continue;
        const k = tg.k + dk, r = tg.r + dr;
        if (k < 0 || r < 0 || k >= kol || r >= rij) continue;
        fn(r * kol + k, dk, dr);
      }
    };
    const terreinKost = (t) => { const x = geo.tegels[t].terrein; return x === 'vlakte' ? 0 : x === 'kust' ? 0.4 : x === 'bos' ? 1.2 : 5; };
    // Wat dit land de vorige keer kreeg, blijft liggen zolang de plek nog vrij is: bouwt het land ergens anders iets,
    // dan springen station, vliegveld, haven en depot niet naar een andere tegel.
    const vorig = this.vorig[L] ?? null;

    // 1. station zo dicht mogelijk bij de hoofdstad (in een volgebouwde stad aan de rand)
    let st = -1, best = Infinity;
    if (vorig && vorig.st >= 0 && this.vrij(vorig.st, L) && cheb(vorig.st, h) <= 3) st = vorig.st;
    for (let d = 1; d <= 3 && st < 0; d++) buren(h, d, (t) => { if (!this.vrij(t, L)) return; const k = cheb(t, h) * 2 + terreinKost(t) + hash(t, 11) * 0.5; if (k < best) { best = k; st = t; } });
    if (st >= 0) this.reserveer(st, 1, L);

    // 2. vliegveld: twee vrije, vlakke tegels op twee tot zes tegels van de hoofdstad, zonder eigen wegen erdoor
    const eigenWegen = this.wegen.filter((w) => w.land === L);
    const doorsnijdt = (x0, y0, x1, y1) => {
      let n = 0;
      for (const w of eigenWegen) {
        if (w.x1 < x0 || w.x0 > x1 || w.y1 < y0 || w.y0 > y1) continue;
        // steekproef langs de weg
        for (let q = w.s0; q < w.s1; q += 3) { const x = w.ax + w.ux * q, y = w.ay + w.uy * q; if (x > x0 && x < x1 && y > y0 && y < y1) { n++; break; } }
      }
      return n;
    };
    const vvKandidaat = (a, staand) => {
      if (cheb(a, h) < 2 || cheb(a, h) > 6 || !this.vrij(a, L) || geo.tegels[a].terrein === 'berg') return null;
      const A = geo.tegels[a], b = staand ? a + kol : a + 1;
      if (staand ? A.r + 1 >= rij : A.k + 1 >= kol) return null;
      if (!this.vrij(b, L) || geo.tegels[b].terrein === 'berg') return null;
      const B = geo.tegels[b];
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      const half = Tw * 0.5, x0 = Math.min(A.x, B.x) - half, x1 = Math.max(A.x, B.x) + half, y0 = Math.min(A.y, B.y) - half, y1 = Math.max(A.y, B.y) + half;
      const d = Math.hypot(mx - H.x, my - H.y) / Tw, kruist = doorsnijdt(x0, y0, x1, y1);
      return { a, b, staand, mx, my, kruist, k: Math.abs(d - 3.5) * 0.6 + terreinKost(a) + terreinKost(b) + kruist * 3 + hash(a, 13, staand) * 0.4 };
    };
    let vv = null; best = Infinity;
    // het vorige vliegveld houden, tenzij er sindsdien een eigen weg dwars overheen is gekomen
    const oudVv = vorig?.vv ? vvKandidaat(vorig.vv.a, vorig.vv.staand) : null;
    if (oudVv && oudVv.kruist <= vorig.vv.kruist) vv = oudVv;
    else buren(h, 6, (a) => { for (const staand of [0, 1]) { const k = vvKandidaat(a, staand); if (k && k.k < best) { best = k.k; vv = k; } } });
    if (vv) {
      this.reserveer(vv.a, 2, L); this.reserveer(vv.b, 2, L);
      const zaad = (vv.a * 131 + 7) | 0;
      uit.vliegvelden.push({ a: vv.a, b: vv.b, staand: vv.staand, mx: vv.mx, my: vv.my, hoek: vv.staand ? Math.PI / 2 : 0, land: L, zaad, standen: [-0.42, -0.2, 0.02, 0.24], zak: [0.6, -0.36], liv: Math.floor(hash(zaad, 3) * LIVREI.length) });
    }

    // 3. containerhavens: bij een kusthoofdstad en naast elke eigen haven, op een vrije tegel aan het water
    const waterVan = (t) => {
      let vx = 0, vy = 0, n = 0;
      buren(t, 1, (u, dk, dr) => { if (geo.tegels[u].terrein === 'water') { const w = dk && dr ? 0.5 : 1; vx += dk * w; vy += dr * w; n++; } });
      return n ? [vx, vy] : null;
    };
    const havenOp = (t) => {
      const d = waterVan(t);
      if (!d) return;
      const T0 = geo.tegels[t];
      let [vx, vy] = d;
      const l = Math.hypot(vx, vy);
      if (l < 0.01) return;
      vx /= l; vy /= l;
      // afstand van het tegelmidden tot het water langs de waterrichting: daar ligt de kade
      let dq = 0.45;
      for (let q = 0.05; q <= 0.6; q += 0.025) if (this.isWater(T0.x + vx * q * Tw, T0.y + vy * q * Tw)) { dq = q - 0.01; break; }
      dq = clamp(dq, 0.08, 0.45);
      const hoek = Math.atan2(vy, vx) - Math.PI / 2;
      const co = Math.cos(hoek), si = Math.sin(hoek);
      const opWater = (u, v) => this.isWater(T0.x + (u * co - v * si) * Tw, T0.y + (u * si + v * co) * Tw);
      const schip = [-0.3, -0.1, 0.1, 0.28].every((u) => opWater(u, dq + 0.05) && opWater(u, dq + 0.11));
      const sleep = [-0.3, -0.1, 0.1, 0.3].every((u) => opWater(u, dq + 0.17) && opWater(u, dq + 0.23));
      // past er geen groot schip, dan ligt er misschien een vissersboot aan de kade
      const kotter = !schip && [-0.16, -0.05, 0.05, 0.16].every((u) => opWater(u, dq + 0.05) && opWater(u, dq + 0.08));
      this.reserveer(t, 3, L);
      const zaad = (t * 977 + 5) | 0;
      uit.havens.push({ t, x: T0.x, y: T0.y, hoek, dq, schip, sleep, kotter, zaad, romp: hash(zaad, 2) < 0.5 ? '#2b3440' : '#7a2a24', kraan: KRAAN[Math.floor(hash(zaad, 4) * KRAAN.length)], land: L });
    };
    let kust = -1; best = Infinity;
    if (vorig && vorig.kust >= 0 && this.vrij(vorig.kust, L) && waterVan(vorig.kust) && cheb(vorig.kust, h) <= 5) kust = vorig.kust;
    else buren(h, 2, (t) => { if (!this.vrij(t, L) || !waterVan(t)) return; const k = cheb(t, h) + hash(t, 17) * 0.5; if (k < best) { best = k; kust = t; } });
    if (kust < 0) {
      // geen plek aan het water bij de hoofdstad: dan een havenstadje verderop aan de eigen kust
      buren(h, 5, (t) => { if (!this.vrij(t, L) || !waterVan(t)) return; const k = cheb(t, h) + hash(t, 17) * 0.5; if (k < best) { best = k; kust = t; } });
    }
    if (kust >= 0) havenOp(kust);
    for (const p of land.plaatsingen) {
      if (p.t < 0 || this.soort[p.t] !== HAVEN || uit.havens.length >= 3) continue;
      let t0 = -1; best = Infinity;
      buren(p.t, 1, (t) => { if (!this.vrij(t, L) || !waterVan(t)) return; const k = hash(t, 19); if (k < best) { best = k; t0 = t; } });
      if (t0 >= 0) havenOp(t0);
    }

    // 4. brandstofdepot naast de eerste haven, anders naast een knooppunt of de hoofdstad; alleen als er centrales zijn
    const centrales = land.plaatsingen.filter((p) => p.t >= 0 && this.soort[p.t] === ENERGIE);
    let dp = -1;
    if (centrales.length) {
      const bij = uit.havens[0]?.t ?? land.plaatsingen.find((p) => p.t >= 0 && this.soort[p.t] === KNOOP)?.t ?? h;
      best = Infinity;
      if (vorig && vorig.dp >= 0 && vorig.dp !== bij && this.vrij(vorig.dp, L) && cheb(vorig.dp, bij) <= 2) dp = vorig.dp;
      else buren(bij, 2, (t) => { if (!this.vrij(t, L)) return; const k = cheb(t, bij) + terreinKost(t) * 0.5 + hash(t, 23) * 0.3; if (k < best) { best = k; dp = t; } });
      if (dp >= 0) {
        this.reserveer(dp, 4, L);
        const D = geo.tegels[dp], zaad = (dp * 733 + 9) | 0;
        uit.depots.push({ t: dp, x: D.x, y: D.y, zaad, kleur: hash(zaad, 1) < 0.5 ? '#c9c6be' : '#b9bdc1', land: L });
        // pijpleidingen naar centrales en olievelden binnen tien tegels (hooguit vier)
        const doelen = centrales.filter((p) => cheb(p.t, dp) <= 10 && cheb(p.t, dp) >= 2).slice(0, 4);
        for (const p of doelen) {
          const C = geo.tegels[p.t];
          const dx = C.x - D.x, dy = C.y - D.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
          const d = 0.48 * Tw / Math.max(Math.abs(ux), Math.abs(uy));
          // een pijpleiding ligt op het land: een stukje kust mag, een baai of zee oversteken niet
          let nat = 0, maxNat = 0;
          for (let q = d; q <= len - d; q += 1) { nat = this.isWater(D.x + ux * q, D.y + uy * q) ? nat + 1 : 0; if (nat > maxNat) maxNat = nat; }
          if (maxNat > 0.5 * Tw) continue;
          uit.pijpen.push({ ax: D.x + ux * d, ay: D.y + uy * d, bx: C.x - ux * d, by: C.y - uy * d, ux, uy, olie: !!this.olie[p.t], zaad: (p.t * 31 + dp) | 0 });
        }
      }
    }

    // 5. spoorlijnen van het station naar de verste steden en industrie (hooguit vier, verspreid gekozen)
    const start = st >= 0 ? st : h;
    const kand = [];
    for (const p of land.plaatsingen) if (p.t >= 0 && (this.soort[p.t] === STAD || this.soort[p.t] === IND) && cheb(p.t, h) >= 3) kand.push(p.t);
    const doelen = [];
    while (doelen.length < 4 && kand.length) {
      let bi = -1, bd = -1;
      for (let i = 0; i < kand.length; i++) {
        let m = cheb(kand[i], start);
        for (const d of doelen) m = Math.min(m, cheb(kand[i], d));
        const sc = m * 2 + (this.soort[kand[i]] === STAD ? 1 : 0);
        if (sc > bd) { bd = sc; bi = i; }
      }
      if (bd < 6) break; // dichter dan drie tegels bij een ander doel: geen eigen lijn
      doelen.push(kand[bi]);
      kand.splice(bi, 1);
    }
    // de stand van het station (richting van de perrons) blijft ook gelijk zolang het station op dezelfde tegel ligt
    let as = vorig && st >= 0 && vorig.st === st ? vorig.as : null;
    if (doelen.length) {
      this.dijkstra(start, L);
      let eerste = null;
      for (let di = 0; di < doelen.length; di++) {
        const pad = [];
        for (let t = doelen[di]; t >= 0 && pad.length < 400; t = this.prev[t]) pad.push(t);
        pad.reverse();
        if (pad[0] !== start || pad.length < 3) continue;
        let nat = 0, maxNat = 0;
        for (const t of pad) { nat = geo.tegels[t].terrein === 'water' ? nat + 1 : 0; maxNat = Math.max(maxNat, nat); }
        if (maxNat > 3) continue;
        const S = geo.tegels[start], N1 = geo.tegels[pad[1]];
        if (!as) { const l = Math.hypot(N1.x - S.x, N1.y - S.y) || 1; as = [(N1.x - S.x) / l, (N1.y - S.y) / l]; }
        eerste ??= as;
        uit.routes.push(this.maakRoute(pad, st >= 0, as, uit.routes.length, L, this.soort[doelen[di]] === IND));
      }
      if (st >= 0 && eerste) {
        const S = geo.tegels[st];
        uit.stations.push({ t: st, x: S.x, y: S.y, hoek: Math.atan2(as[1], as[0]), zaad: (st * 389 + 3) | 0, banen: [-0.15, -0.05, 0.05, 0.15] });
      }
    }
    // geen spoorlijn, dan ook geen station: de tegel weer vrijgeven (anders blijft hij leeg en zonder bomen)
    if (st >= 0 && !uit.stations.length) { this.res[st] = 0; this.resLand[st] = -1; }
    this.vorig[L] = { st, as: uit.stations.length ? as : null, vv: vv ? { a: vv.a, staand: vv.staand, kruist: vv.kruist } : null, kust, dp };

    // 6. hoogspanning van elke centrale naar de dichtstbijzijnde stad of de hoofdstad (hooguit zes lijnen)
    const steden = [h, ...land.plaatsingen.filter((p) => p.t >= 0 && this.soort[p.t] === STAD).map((p) => p.t)];
    for (const p of centrales) {
      if (uit.lijnen.length >= 6) break;
      let doel = -1, bd = Infinity;
      for (const t of steden) { const d = cheb(t, p.t); if (d < bd) { bd = d; doel = t; } }
      if (doel < 0 || bd < 2) continue;
      const A = geo.tegels[p.t], B = geo.tegels[doel];
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      let nat = 0, n = 0;
      for (let q = 0; q < len; q += 2) { n++; if (this.isWater(A.x + ux * q, A.y + uy * q)) nat++; }
      if (nat > n * 0.3) continue;
      const span = Tw * 0.8, m = Math.max(1, Math.round((len - 1.1 * Tw) / span));
      const masten = [A.x, A.y];
      for (let i = 0; i <= m; i++) {
        const q = 0.55 * Tw + (len - 1.1 * Tw) * (i / m);
        const x = A.x + ux * q, y = A.y + uy * q;
        const tg = Math.floor(y / Tw) * kol + Math.floor(x / Tw);
        if (this.isWater(x, y) || (s.bezet[tg] && tg !== p.t && tg !== doel) || this.res[tg]) continue;
        masten.push(x, y);
      }
      masten.push(B.x, B.y);
      uit.lijnen.push({ ux, uy, m: Float32Array.from(masten), x0: Math.min(A.x, B.x), x1: Math.max(A.x, B.x), y0: Math.min(A.y, B.y), y1: Math.max(A.y, B.y), zaad: (p.t * 53 + doel) | 0 });
    }
    return uit;
  }

  kost(u, land, start) {
    const t = this.geo.tegels[u], s = this.state;
    let c = t.terrein === 'water' ? 7 : t.terrein === 'berg' ? 3.2 : t.terrein === 'bos' ? 1.5 : 1;
    if (s.bezet[u]) c += 30;
    if (this.res[u] && this.resLand[u] === land && u !== start) c += 40;
    if (s.eigenaar[u] !== land) c += 3;
    return c;
  }

  // Kortste pad over de tegels (acht richtingen) vanaf start; vult this.prev.
  dijkstra(start, land) {
    const geo = this.geo, kol = geo.kol, rij = geo.rij;
    const D = this.dist, PR = this.prev, HT = this.heapT, HK = this.heapK, MAXH = HT.length;
    D.fill(Infinity); PR.fill(-1);
    let hn = 0;
    const push = (t, k) => {
      let i = hn++;
      while (i > 0) { const p = (i - 1) >> 1; if (HK[p] <= k) break; HT[i] = HT[p]; HK[i] = HK[p]; i = p; }
      HT[i] = t; HK[i] = k;
    };
    const pop = () => {
      const t = HT[0];
      hn--;
      const lt = HT[hn], lk = HK[hn];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hn) break;
        if (c + 1 < hn && HK[c + 1] < HK[c]) c++;
        if (HK[c] >= lk) break;
        HT[i] = HT[c]; HK[i] = HK[c]; i = c;
      }
      HT[i] = lt; HK[i] = lk;
      return t;
    };
    D[start] = 0; push(start, 0);
    while (hn) {
      const k0 = HK[0], t = pop();
      if (k0 > D[t]) continue;
      const tk = t % kol, tr = (t / kol) | 0;
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
        if (!dr && !dk) continue;
        const k = tk + dk, r = tr + dr;
        if (k < 0 || r < 0 || k >= kol || r >= rij) continue;
        const u = r * kol + k;
        const nd = D[t] + this.kost(u, land, start) * (dr && dk ? 1.414 : 1);
        if (nd < D[u]) { D[u] = nd; PR[u] = t; if (hn < MAXH) push(u, nd); }
      }
    }
  }

  // Tegelpad → vloeiende spoorlijn. Bij een station begint hij op een vaste baan langs de perrons.
  maakRoute(pad, station, as, nr, land, goederen) {
    const geo = this.geo, Tw = geo.T;
    const pts = [];
    const S = geo.tegels[pad[0]];
    if (station) {
      const baan = [-0.15, 0.05, 0.15, -0.05][nr % 4] * Tw, nx = -as[1], ny = as[0];
      const N1 = geo.tegels[pad[1]];
      const sg = (N1.x - S.x) * as[0] + (N1.y - S.y) * as[1] >= 0 ? 1 : -1;
      pts.push(S.x - as[0] * 0.42 * Tw * sg + nx * baan, S.y - as[1] * 0.42 * Tw * sg + ny * baan);
      pts.push(S.x + as[0] * 0.48 * Tw * sg + nx * baan, S.y + as[1] * 0.48 * Tw * sg + ny * baan);
    } else pts.push(S.x, S.y);
    for (let i = 1; i < pad.length; i++) { const t = geo.tegels[pad[i]]; pts.push(t.x, t.y); }
    // Chaikin twee keer, met vaste uiteinden: lokaal, dus gedeelde stukken van twee lijnen vallen precies samen
    let p = pts;
    for (let it = 0; it < 2; it++) {
      const q = [p[0], p[1]];
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
        q.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
      }
      q.push(p[p.length - 2], p[p.length - 1]);
      p = q;
    }
    const n = p.length / 2;
    const X = new Float32Array(n), Y = new Float32Array(n), NX = new Float32Array(n), NY = new Float32Array(n), Sd = new Float32Array(n);
    for (let i = 0; i < n; i++) { X[i] = p[i * 2]; Y[i] = p[i * 2 + 1]; if (i) Sd[i] = Sd[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]); }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const dx = X[b] - X[a], dy = Y[b] - Y[a], l = Math.hypot(dx, dy) || 1;
      NX[i] = -dy / l; NY[i] = dx / l;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]); }
    const L = Sd[n - 1];
    const zaad = (pad[pad.length - 1] * 613 + land * 7) | 0;
    const r = { x: X, y: Y, nx: NX, ny: NY, s: Sd, n, L, x0, y0, x1, y1, land, zaad, goederen, brug: null, beton: hash(zaad, 5) < 0.5, elektrisch: !goederen || hash(zaad, 6) < 0.6 };
    // bruggen
    const spans = [];
    let in0 = -1;
    for (let q = 0; q <= L; q += 1) {
      this.punt(r, q);
      const nat = this.isWater(this.px, this.py);
      if (nat && in0 < 0) in0 = q;
      if (!nat && in0 >= 0) { spans.push(Math.max(0, in0 - 0.8), Math.min(L, q + 0.8)); in0 = -1; }
    }
    if (in0 >= 0) spans.push(Math.max(0, in0 - 0.8), L);
    if (spans.length) r.brug = spans;
    // treinen: een personentrein naar een stad, een goederentrein naar industrie; lange lijnen krijgen er twee
    const tr = [];
    const aantal = L > 14 * Tw ? 2 : 1;
    for (let j = 0; j < aantal; j++) {
      const z = hash(zaad, j, 9);
      const wagons = goederen ? 6 + Math.floor(hash(zaad, j, 10) * 4) : 3 + Math.floor(hash(zaad, j, 10) * 3);
      const lengtes = [0.085];
      for (let i = 0; i < wagons; i++) lengtes.push(goederen ? 0.062 : 0.08);
      const totaal = lengtes.reduce((a, b) => a + b, 0) + 0.005 * wagons;
      tr.push({ fase: z, lengtes: Float32Array.from(lengtes), totaal: totaal * Tw, loc: LOC[Math.floor(hash(zaad, j, 11) * LOC.length)], rijtuig: RIJTUIG[Math.floor(hash(zaad, j, 12) * RIJTUIG.length)], lading: Uint8Array.from(lengtes, (_, i) => Math.floor(hash(zaad, j * 31 + i, 14) * 5)) });
    }
    r.treinen = tr;
    return r;
  }

  // Overwegen: waar een spoorlijn een weg kruist.
  bouwOverwegen() {
    const Tw = this.geo.T, O = [];
    for (let ri = 0; ri < this.routes.length && O.length < 150; ri++) {
      const r = this.routes[ri];
      const ws = this.wegen.filter((w) => !(w.x1 < r.x0 || w.x0 > r.x1 || w.y1 < r.y0 || w.y0 > r.y1));
      if (!ws.length) continue;
      for (let i = 0; i + 1 < r.n && O.length < 150; i++) {
        const ax = r.x[i], ay = r.y[i], dx = r.x[i + 1] - ax, dy = r.y[i + 1] - ay;
        const sl = Math.hypot(dx, dy);
        if (sl < 1e-6) continue;
        const hx = dx / sl, hy = dy / sl;
        for (const w of ws) {
          const den = hx * w.uy - hy * w.ux;
          if (Math.abs(den) < 0.35) continue;
          const ex = w.ax - ax, ey = w.ay - ay;
          const t = (ex * w.uy - ey * w.ux) / den, q = (ex * hy - ey * hx) / den;
          if (t < 0 || t >= sl || q < w.s0 + 0.08 * Tw || q > w.s1 - 0.08 * Tw) continue;
          const x = ax + hx * t, y = ay + hy * t;
          if (this.isWater(x, y) || O.some((o) => o.r === ri && Math.abs(o.x - x) + Math.abs(o.y - y) < 0.4 * Tw)) continue;
          O.push({ x, y, r: ri, sr: r.s[i] + t, ux: w.ux, uy: w.uy, hx, hy });
        }
      }
    }
    this.overwegen = O;
  }

  // Punt op afstand q langs een route (wereld): this.px, this.py en de richting this.hx, this.hy.
  punt(r, q) {
    const S = r.s, X = r.x, Y = r.y, n = r.n;
    if (q <= 0) q = 0; else if (q >= S[n - 1]) q = S[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= q) lo = m; else hi = m; }
    const d = S[hi] - S[lo] || 1, f = (q - S[lo]) / d;
    this.px = X[lo] + (X[hi] - X[lo]) * f; this.py = Y[lo] + (Y[hi] - Y[lo]) * f;
    this.hx = (X[hi] - X[lo]) / d; this.hy = (Y[hi] - Y[lo]) / d;
    this.pi = lo;
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

  // Ligt een wereldkader (met marge m in wereldeenheden) in beeld?
  inBeeld(x0, y0, x1, y1, m) { return x1 >= this.wx0 - m && x0 <= this.wx1 + m && y1 >= this.wy0 - m && y0 <= this.wy1 + m; }
  opScherm(x, y, m) { return x > -m && y > -m && x < this.w + m && y < this.h + m; }

  zetLicht(x, y, r, soort, a) {
    if (this.nLicht >= PLAFOND.lichten || !this.opScherm(x, y, r)) return;
    const o = this.nLicht++ * LICHT, b = this.licht;
    b[o] = x; b[o + 1] = y; b[o + 2] = r; b[o + 3] = soort; b[o + 4] = a;
  }

  // Tussen de wegen en de gebouwen: alles wat op de grond ligt of rijdt.
  teken(c, view, sc, nu, dt = 0, tempo = 0) {
    if (tempo > 0) this.klok += dt;
    this.nul();
    const s = view.state;
    if (!s || !view.geo || !view.w) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar) this.laad(view);
    const z = view.zoom;
    this.zoom = z;
    if (z < DREMPEL.spoor - 0.4) return;
    this.werkCache(view);
    this.kader(view, sc);
    this.sz = seizoen(s.dag);
    this.wr = weer(s.dag, view.cx, view.cy);
    this.wd = wind(s.dag);
    this.sn = this.sz.sneeuw > 0.66 ? 2 : this.sz.sneeuw > 0.25 ? 1 : 0;
    this.gs = this.sz.winter > 0.5 ? 2 : this.sz.herfst > 0.5 ? 1 : 0;
    this.nacht = view.nacht ?? 0;
    this.nu = nu;
    this.bakTeller = 0;
    this.gloed ??= LICHTKLEUR.map((k) => { if (!k) return null; const cv = fabriek(32, 32); if (cv) bakGloed(cv, k); return cv; });
    // zichtbare wegen
    const Tw = this.geo.T;
    let nz = 0;
    for (let i = 0; i < this.wegen.length && nz < this.zw.length; i++) { const w = this.wegen[i]; if (this.inBeeld(w.x0, w.y0, w.x1, w.y1, Tw * 0.3)) this.zw[nz++] = i; }
    this.nZw = nz;
    nz = 0;
    for (let i = 0; i < this.routes.length && nz < PLAFOND.sporen; i++) { const r = this.routes[i]; if (this.inBeeld(r.x0, r.y0, r.x1, r.y1, Tw * 0.3)) this.zr[nz++] = i; }
    this.nZr = nz;
    this.n.sporen = nz;
    const a = smooth(3.6, 4.4, z);
    c.save();
    c.lineCap = 'butt';
    c.lineJoin = 'round';
    this.tekenBruggen(c, a);
    if (z >= DREMPEL.pijp) this.tekenPijpen(c, smooth(4.5, 5.5, z));
    this.tekenSporen(c, a);
    if (z >= DREMPEL.stoeprand) this.tekenWegdetail(c, nu);
    if (z >= DREMPEL.stoeprand) this.tekenKruisingen(c, nu);
    if (z >= 6) this.tekenOverwegen(c, nu);
    if (z >= 6.5) this.tekenLaanbomen(c, smooth(6.5, 7.5, z));
    if (z >= DREMPEL.lantaarn - 0.5) this.tekenStraatmeubilair(c, nu);
    // Station, haven, vliegveld en depot pas na het wegdetail: loopt een weg van tekenWegen onder zo'n bouwwerk
    // door, dan dekt de bitmap de weg al af en moeten stoepranden, strepen en lantaarns daar ook verdwijnen.
    this.tekenSprites(c, a);
    this.tekenTreinen(c, a);
    this.tekenHavenLeven(c, a);
    this.tekenVliegvelden(c, a, nu);
    if (z >= DREMPEL.bovenleiding - 0.5) this.tekenBovenleiding(c, nu);
    if (z >= DREMPEL.hoogspanning - 0.3) this.tekenHoogspanning(c, smooth(4.2, 5, z), nu);
    c.restore();
    this.n.lichten = this.nLicht;
  }

  // ---------- lijnen langs routes ----------

  // Voegt het zichtbare deel van een route toe aan het pad, verschoven over `off` wereldeenheden langs de normaal
  // en daarna nog (dx, dy) schermpixels.
  lijn(c, r, off, dx, dy) {
    const sc = this.sc, ox = this.ox + dx, oy = this.oy + dy, m = 20, w = this.w + m, h = this.h + m;
    const X = r.x, Y = r.y, NX = r.nx, NY = r.ny, n = r.n;
    let open = false;
    let px = (X[0] + NX[0] * off) * sc + ox, py = (Y[0] + NY[0] * off) * sc + oy;
    for (let i = 1; i < n; i++) {
      const qx = (X[i] + NX[i] * off) * sc + ox, qy = (Y[i] + NY[i] * off) * sc + oy;
      if ((px < -m && qx < -m) || (px > w && qx > w) || (py < -m && qy < -m) || (py > h && qy > h)) open = false;
      else { if (!open) { c.moveTo(px, py); open = true; } c.lineTo(qx, qy); }
      px = qx; py = qy;
    }
  }

  // Stuk van een route tussen q0 en q1 (voor bruggen).
  deel(c, r, q0, q1, off, dx = 0, dy = 0) {
    const sc = this.sc;
    this.punt(r, q0);
    let i = this.pi + 1;
    c.moveTo((this.px - this.hy * off) * sc + this.ox + dx, (this.py + this.hx * off) * sc + this.oy + dy);
    for (; i < r.n && r.s[i] < q1; i++) c.lineTo((r.x[i] + r.nx[i] * off) * sc + this.ox + dx, (r.y[i] + r.ny[i] * off) * sc + this.oy + dy);
    this.punt(r, q1);
    c.lineTo((this.px - this.hy * off) * sc + this.ox + dx, (this.py + this.hx * off) * sc + this.oy + dy);
  }

  tekenSporen(c, a) {
    const nz = this.nZr;
    if (!nz) return;
    const T = this.T, Tw = this.geo.T, z = this.zoom, R = this.routes;
    const lijnen = (kleur, breedte, off, dx = 0, dy = 0, filter = null) => {
      c.strokeStyle = kleur; c.lineWidth = breedte; c.beginPath();
      for (let i = 0; i < nz; i++) { const r = R[this.zr[i]]; if (!filter || filter(r)) this.lijn(c, r, off, dx, dy); }
      c.stroke();
    };
    c.globalAlpha = a;
    lijnen(GRIND_RAND, Math.max(1.5, T * 0.118), 0);
    lijnen(this.sn === 2 ? GRIND_SNEEUW : GRIND, Math.max(1, T * 0.1), 0);
    if (z >= DREMPEL.dwarsliggers) {
      c.globalAlpha = a * smooth(5.5, 6.5, z) * (this.sn === 2 ? 0.55 : 1);
      c.setLineDash([T * 0.008, T * 0.017]);
      lijnen(HOUT, T * 0.066, 0, 0, 0, (r) => !r.beton);
      lijnen('#a6a299', T * 0.066, 0, 0, 0, (r) => r.beton);
      c.setLineDash([]);
      c.globalAlpha = a;
    }
    if (z >= DREMPEL.markering) for (const o of [-1, 1]) lijnen('rgba(30,26,22,0.6)', T * 0.007, o * 0.0175 * Tw, T * 0.004, T * 0.004);
    for (const o of [-1, 1]) lijnen(STAAL, Math.max(0.6, T * 0.0055), o * 0.0175 * Tw);
    if (z >= DREMPEL.klein) {
      // onkruid in het grind en kilometerpaaltjes
      c.fillStyle = this.sn ? '#9aa39a' : '#5f7a3c';
      c.beginPath();
      for (let i = 0; i < nz; i++) {
        const r = R[this.zr[i]];
        for (let q = 0; q < r.L; q += Tw * 0.11) {
          const k = Math.floor(q);
          if (hash(r.zaad, k, 71) > 0.35) continue;
          this.punt(r, q);
          const off = (hash(r.zaad, k, 72) - 0.5) * 0.09 * Tw;
          const x = (this.px - this.hy * off) * this.sc + this.ox, y = (this.py + this.hx * off) * this.sc + this.oy;
          if (this.opScherm(x, y, 4)) stip(c, x, y, T * 0.004);
        }
      }
      c.fill();
      for (let i = 0; i < nz; i++) {
        const r = R[this.zr[i]];
        for (let q = Tw; q < r.L; q += Tw) {
          this.punt(r, q);
          const x = (this.px - this.hy * 0.075 * Tw) * this.sc + this.ox, y = (this.py + this.hx * 0.075 * Tw) * this.sc + this.oy;
          if (!this.opScherm(x, y, 6)) continue;
          c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x, y, T * 0.012, T * 0.006);
          c.fillStyle = WIT; c.fillRect(x - T * 0.004, y - T * 0.012, T * 0.008, T * 0.014);
          c.fillStyle = '#222'; c.fillRect(x - T * 0.004, y - T * 0.012, T * 0.008, T * 0.003);
        }
      }
    }
    c.globalAlpha = 1;
  }

  tekenBruggen(c, a) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, z = this.zoom;
    c.globalAlpha = a;
    // spoorbruggen: schaduw op het water, pijlers, dek, leuningen en vakwerk
    for (let i = 0; i < this.nZr; i++) {
      const r = this.routes[this.zr[i]];
      if (!r.brug) continue;
      for (let k = 0; k < r.brug.length; k += 2) {
        const q0 = r.brug[k], q1 = r.brug[k + 1];
        c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = T * 0.15; c.beginPath(); this.deel(c, r, q0, q1, 0, T * 0.05, T * 0.06); c.stroke();
        if (z >= 6) {
          c.fillStyle = '#5f5b55';
          c.beginPath();
          for (let q = q0 + Tw * 0.2; q < q1 - Tw * 0.1; q += Tw * 0.32) {
            this.punt(r, q);
            const x = this.px * sc + this.ox, y = this.py * sc + this.oy;
            rechthoek(c, x + T * 0.03, y + T * 0.04, -this.hy, this.hx, T * 0.06, T * 0.012);
          }
          c.fill();
        }
        c.strokeStyle = '#86827a'; c.lineWidth = T * 0.14; c.beginPath(); this.deel(c, r, q0, q1, 0); c.stroke();
        c.strokeStyle = '#a19d94'; c.lineWidth = Math.max(0.6, T * 0.008); c.beginPath(); this.deel(c, r, q0, q1, 0.068 * Tw); this.deel(c, r, q0, q1, -0.068 * Tw); c.stroke();
        if (z >= DREMPEL.markering) {
          // vakwerk: zigzag langs beide randen
          c.strokeStyle = '#5c6066'; c.lineWidth = Math.max(0.6, T * 0.006); c.beginPath();
          for (const o of [-0.062, 0.062]) {
            let eerst = true;
            for (let q = q0, j = 0; q <= q1; q += Tw * 0.06, j++) {
              this.punt(r, q);
              const off = (o + (j & 1 ? 0.008 : -0.008)) * Tw;
              const x = (this.px - this.hy * off) * sc + this.ox, y = (this.py + this.hx * off) * sc + this.oy;
              if (eerst) { c.moveTo(x, y); eerst = false; } else c.lineTo(x, y);
            }
          }
          c.stroke();
        }
      }
    }
    // wegbruggen: zelfde opbouw, maar alleen naast de weg. De weg van tekenWegen ligt al getekend (met de
    // vrachtwagens erop) en blijft zichtbaar: alles hieronder wordt buiten die strook geknipt.
    for (let i = 0; i < this.nZw; i++) {
      const w = this.wegen[this.zw[i]];
      if (!w.brug) continue;
      for (let k = 0; k < w.brug.length; k += 2) {
        const q0 = w.brug[k], q1 = w.brug[k + 1];
        const ax = (w.ax + w.ux * q0) * sc + this.ox, ay = (w.ay + w.uy * q0) * sc + this.oy;
        const bx = (w.ax + w.ux * q1) * sc + this.ox, by = (w.ay + w.uy * q1) * sc + this.oy;
        const nx = -w.uy, ny = w.ux, hb = Math.max(1, T * 0.08); // halve breedte van de weg met zijn donkere rand
        c.save();
        c.beginPath(); c.rect(-T, -T, this.w + 2 * T, this.h + 2 * T);
        c.moveTo(ax + nx * hb, ay + ny * hb); c.lineTo(bx + nx * hb, by + ny * hb); c.lineTo(bx - nx * hb, by - ny * hb); c.lineTo(ax - nx * hb, ay - ny * hb); c.closePath();
        c.clip('evenodd');
        c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = T * 0.2;
        c.beginPath(); c.moveTo(ax + T * 0.05, ay + T * 0.06); c.lineTo(bx + T * 0.05, by + T * 0.06); c.stroke();
        if (z >= 6) {
          c.fillStyle = '#5f5b55'; c.beginPath();
          for (let q = q0 + Tw * 0.2; q < q1 - Tw * 0.1; q += Tw * 0.32) {
            const x = (w.ax + w.ux * q) * sc + this.ox, y = (w.ay + w.uy * q) * sc + this.oy;
            rechthoek(c, x + T * 0.03, y + T * 0.04, nx, ny, T * 0.08, T * 0.014);
          }
          c.fill();
        }
        c.strokeStyle = '#8f8b83'; c.lineWidth = T * 0.19;
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
        c.strokeStyle = '#b4b0a7'; c.lineWidth = Math.max(0.6, T * 0.01); c.beginPath();
        for (const o of [-0.09, 0.09]) { c.moveTo(ax + nx * o * T, ay + ny * o * T); c.lineTo(bx + nx * o * T, by + ny * o * T); }
        c.stroke();
        if (z >= DREMPEL.lantaarn) {
          // leuningpaaltjes
          c.fillStyle = '#d6d3cb'; c.beginPath();
          for (let q = q0; q < q1; q += Tw * 0.12) for (const o of [-0.09, 0.09]) {
            const x = (w.ax + w.ux * q + nx * o * Tw) * sc + this.ox, y = (w.ay + w.uy * q + ny * o * Tw) * sc + this.oy;
            stip(c, x, y, T * 0.005);
          }
          c.fill();
        }
        c.restore();
      }
    }
    c.globalAlpha = 1;
  }

  tekenPijpen(c, a) {
    const T = this.T, sc = this.sc, z = this.zoom;
    c.globalAlpha = a;
    for (const p of this.pijpen) {
      if (!this.inBeeld(Math.min(p.ax, p.bx), Math.min(p.ay, p.by), Math.max(p.ax, p.bx), Math.max(p.ay, p.by), 8)) continue;
      const ax = p.ax * sc + this.ox, ay = p.ay * sc + this.oy, bx = p.bx * sc + this.ox, by = p.by * sc + this.oy;
      const nx = -p.uy, ny = p.ux;
      // schaduw, steunen, dan twee buizen (de oliebuis donker, de gasbuis zilver)
      c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = T * 0.03;
      c.beginPath(); c.moveTo(ax + T * 0.012, ay + T * 0.014); c.lineTo(bx + T * 0.012, by + T * 0.014); c.stroke();
      if (z >= 6) {
        c.strokeStyle = '#55524c'; c.lineWidth = T * 0.036; c.setLineDash([T * 0.006, T * 0.07]);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.setLineDash([]);
      }
      for (const [o, k] of [[-0.009, p.olie ? '#3b3a38' : '#9aa0a6'], [0.009, '#b9bec3']]) {
        c.strokeStyle = k; c.lineWidth = Math.max(0.8, T * 0.012);
        c.beginPath(); c.moveTo(ax + nx * o * T, ay + ny * o * T); c.lineTo(bx + nx * o * T, by + ny * o * T); c.stroke();
      }
      if (z >= DREMPEL.markering) {
        c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = Math.max(0.4, T * 0.003);
        c.beginPath(); c.moveTo(ax + nx * 0.006 * T, ay + ny * 0.006 * T - T * 0.003); c.lineTo(bx + nx * 0.006 * T, by + ny * 0.006 * T - T * 0.003); c.stroke();
        // pompstation halverwege
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        if (Math.hypot(bx - ax, by - ay) > T * 1.6) {
          c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); rechthoek(c, mx + nx * T * 0.06 + T * 0.02, my + ny * T * 0.06 + T * 0.022, p.ux, p.uy, T * 0.05, T * 0.03); c.fill();
          c.fillStyle = '#b9b4a8'; c.beginPath(); rechthoek(c, mx + nx * T * 0.06, my + ny * T * 0.06, p.ux, p.uy, T * 0.05, T * 0.03); c.fill();
          c.fillStyle = '#7d8187'; c.beginPath(); rechthoek(c, mx + nx * T * 0.06, my + ny * T * 0.06, p.ux, p.uy, T * 0.05, T * 0.01); c.fill();
          c.fillStyle = '#4b4f54'; c.beginPath(); rechthoek(c, mx + nx * T * 0.03, my + ny * T * 0.03, p.ux, p.uy, T * 0.01, T * 0.004); c.fill();
        }
        // afsluiters met rode handwielen
        const len = Math.hypot(bx - ax, by - ay);
        for (let q = T * 0.7; q < len - T * 0.3; q += T * 1.6) {
          const x = ax + p.ux * q, y = ay + p.uy * q;
          c.fillStyle = '#6b6f74'; c.beginPath(); rechthoek(c, x, y, p.ux, p.uy, T * 0.012, T * 0.022); c.fill();
          c.fillStyle = '#c43c32'; c.beginPath(); stip(c, x, y - T * 0.012, T * 0.007); c.fill();
        }
      }
    }
    c.globalAlpha = 1;
  }

  // ---------- gebakken bouwwerken ----------

  haal(sleutel) {
    const e = this.cache.get(sleutel);
    if (e) { this.cache.delete(sleutel); this.cache.set(sleutel, e); }
    return e;
  }

  // Bak een (gedraaide) bitmap. bw en bh zijn de afmetingen in tegels vóór het draaien.
  bak(sleutel, basis, bw, bh, hoek, fn, obj) {
    if (this.bakTeller >= PLAFOND.bakken) return this.laatste.get(basis) ?? null;
    const P = this.P, co = Math.cos(hoek), si = Math.sin(hoek);
    const W = Math.ceil((Math.abs(co) * bw + Math.abs(si) * bh) * P), H = Math.ceil((Math.abs(si) * bw + Math.abs(co) * bh) * P);
    const cv = fabriek(W, H);
    if (!cv) return null;
    this.bakTeller++;
    const g = cv.getContext('2d');
    g.setTransform(P * co, P * si, -P * si, P * co, W / 2, H / 2);
    fn(g, obj, { sx: (co + si) * Math.SQRT1_2, sy: (co - si) * Math.SQRT1_2, P, sn: this.sn, gs: this.gs });
    const e = { cv, w: W, h: H, P, bytes: W * H * 4, basis };
    this.cache.set(sleutel, e);
    this.laatste.set(basis, e);
    this.bytes += e.bytes;
    this.gebakken++;
    for (const [k, x] of this.cache) {
      if (this.cache.size <= MAX_SPRITES && this.bytes <= MAX_BYTES) break;
      this.cache.delete(k);
      this.bytes -= x.bytes;
      if (this.laatste.get(x.basis) === x) this.laatste.delete(x.basis);
    }
    return e;
  }

  // Een gebakken bitmap met middelpunt (wx, wy); op de exacte maat op hele apparaatpixels.
  plak(c, e, wx, wy) {
    const k = (this.T * this.dpr) / e.P, dpr = this.dpr;
    const X = wx * this.sc + this.ox, Y = wy * this.sc + this.oy;
    const w = (e.w * k) / dpr, h = (e.h * k) / dpr;
    if (Math.abs(k - 1) < 0.002) c.drawImage(e.cv, Math.round((X - w / 2) * dpr) / dpr, Math.round((Y - h / 2) * dpr) / dpr, w, h);
    else c.drawImage(e.cv, X - w / 2, Y - h / 2, w, h);
  }

  tekenSprites(c, a) {
    const Tw = this.geo.T, P = this.P, sn = this.sn, gs = this.gs;
    c.globalAlpha = a;
    for (let i = 0; i < this.stations.length; i++) {
      const st = this.stations[i];
      if (!this.inBeeld(st.x, st.y, st.x, st.y, Tw)) continue;
      const basis = `st${st.t}|${Math.round(st.hoek * 1000)}|${sn}|${gs}`;
      const e = this.haal(`${basis}|${P}`) ?? this.bak(`${basis}|${P}`, basis, 1, 1, st.hoek, bakStation, st);
      if (e) this.plak(c, e, st.x, st.y);
    }
    for (const d of this.depots) {
      if (!this.inBeeld(d.x, d.y, d.x, d.y, Tw)) continue;
      const basis = `dp${d.t}|${sn}`;
      const e = this.haal(`${basis}|${P}`) ?? this.bak(`${basis}|${P}`, basis, 1, 1, 0, bakDepot, d);
      if (e) this.plak(c, e, d.x, d.y);
    }
    for (const h of this.havens) {
      if (!this.inBeeld(h.x, h.y, h.x, h.y, Tw)) continue;
      const basis = `hv${h.t}|${sn}`;
      const e = this.haal(`${basis}|${P}`) ?? this.bak(`${basis}|${P}`, basis, 1, 1.3, h.hoek, bakHaven, h);
      if (e) this.plak(c, e, h.x, h.y);
    }
    for (const v of this.vliegvelden) {
      if (!this.inBeeld(v.mx - Tw, v.my - Tw, v.mx + Tw, v.my + Tw, Tw * 0.2)) continue;
      const basis = `vv${v.a}|${v.staand}|${sn}|${gs}`;
      const e = this.haal(`${basis}|${P}`) ?? this.bak(`${basis}|${P}`, basis, 2.1, 1.1, v.hoek, bakVliegveld, v);
      if (e) this.plak(c, e, v.mx, v.my);
    }
    c.globalAlpha = 1;
  }

  // ---------- wegdetail ----------

  tekenWegdetail(c, nu) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, z = this.zoom, W = this.wegen, nz = this.nZw;
    if (!nz) return;
    const evenwijdig = (off, kleur, breedte, alleenStad = false) => {
      c.strokeStyle = kleur; c.lineWidth = breedte; c.beginPath();
      for (let i = 0; i < nz; i++) {
        const w = W[this.zw[i]];
        if (alleenStad && !w.stadA && !w.stadB) continue;
        const nx = -w.uy * off, ny = w.ux * off;
        for (const sgn of [-1, 1]) {
          c.moveTo((w.ax + w.ux * w.s0 + nx * sgn) * sc + this.ox, (w.ay + w.uy * w.s0 + ny * sgn) * sc + this.oy);
          c.lineTo((w.ax + w.ux * w.s1 + nx * sgn) * sc + this.ox, (w.ay + w.uy * w.s1 + ny * sgn) * sc + this.oy);
        }
      }
      c.stroke();
    };
    // stoepranden (licht beton) met een schaduwlijntje aan de asfaltkant
    c.globalAlpha = smooth(5.5, 6.5, z);
    evenwijdig(0.062 * Tw, '#97938a', Math.max(0.6, T * 0.01));
    if (z >= 7) evenwijdig(0.054 * Tw, 'rgba(25,25,24,0.45)', Math.max(0.4, T * 0.004));
    // sneeuwhopen langs de stoep als het hartje winter is (de rijbaan is geveegd)
    if (this.sz.sneeuw > 0.3) {
      c.globalAlpha = smooth(5.5, 6.5, z) * clamp(this.sz.sneeuw, 0, 1) * 0.85;
      c.setLineDash([T * 0.05, T * 0.012, T * 0.02, T * 0.008]);
      evenwijdig(0.073 * Tw, '#eef1f3', T * 0.014);
      c.setLineDash([]);
    }
    if (z < DREMPEL.markering - 0.5) { c.globalAlpha = 1; return; }
    const aM = smooth(7.5, 8.5, z);
    c.globalAlpha = aM;
    // kantstrepen
    evenwijdig(0.046 * Tw, '#e4e2d8', Math.max(0.5, T * 0.0035));
    // rode fietspaden langs de wegen naar woonwijken en hoofdstad, met een berm ertussen
    evenwijdig(0.13 * Tw, this.sn === 2 ? '#b98a80' : '#9a4a3a', T * 0.024, true);
    if (z >= DREMPEL.bord) { c.setLineDash([T * 0.02, T * 0.02]); evenwijdig(0.13 * Tw, 'rgba(240,236,226,0.7)', Math.max(0.4, T * 0.002), true); c.setLineDash([]); }
    // plassen in de regen, met druppels die erin slaan
    if (this.wr.regen > 0.3 && z >= DREMPEL.bord) {
      for (let i = 0; i < nz; i++) {
        const w = W[this.zw[i]];
        for (let q = w.s0, j = 0; q < w.s1; q += Tw * 0.23, j++) {
          if (hash(w.zaad, j, 91) > 0.3) continue;
          const o = (hash(w.zaad, j, 92) - 0.5) * 0.09 * Tw;
          const x = (w.ax + w.ux * q - w.uy * o) * sc + this.ox, y = (w.ay + w.uy * q + w.ux * o) * sc + this.oy;
          if (!this.opScherm(x, y, T * 0.05)) continue;
          const hk = Math.atan2(w.uy, w.ux);
          c.fillStyle = 'rgba(120,140,160,0.45)'; c.beginPath(); c.ellipse(x, y, T * 0.018, T * 0.009, hk, 0, TAU); c.fill();
          c.fillStyle = 'rgba(230,240,250,0.35)'; c.beginPath(); c.ellipse(x - T * 0.004, y - T * 0.003, T * 0.007, T * 0.002, hk, 0, TAU); c.fill();
          const r = frac(this.nu / 600 + hash(w.zaad, j, 93));
          c.strokeStyle = `rgba(230,240,250,${(0.6 * (1 - r)).toFixed(2)})`; c.lineWidth = Math.max(0.4, T * 0.0015);
          c.beginPath(); c.ellipse(x, y, T * 0.012 * r + 0.5, T * 0.006 * r + 0.3, hk, 0, TAU); c.stroke();
        }
      }
    }
    // natte weg: glans in de regen
    if (this.wr.regen > 0.25) {
      c.globalAlpha = aM * clamp((this.wr.regen - 0.25) * 2, 0, 1) * 0.5;
      c.strokeStyle = 'rgba(190,205,220,0.35)'; c.lineWidth = T * 0.07;
      c.setLineDash([T * 0.05, T * 0.13, T * 0.02, T * 0.09]);
      c.beginPath();
      for (let i = 0; i < nz; i++) { const w = W[this.zw[i]]; c.moveTo((w.ax + w.ux * w.s0) * sc + this.ox, (w.ay + w.uy * w.s0) * sc + this.oy); c.lineTo((w.ax + w.ux * w.s1) * sc + this.ox, (w.ay + w.uy * w.s1) * sc + this.oy); }
      c.stroke(); c.setLineDash([]);
      c.globalAlpha = aM;
    }
    // zebrapaden en stopstrepen waar de weg een woonwijk of de hoofdstad in gaat
    c.fillStyle = WIT;
    c.beginPath();
    for (let i = 0; i < nz; i++) {
      const w = W[this.zw[i]];
      for (const kant of [0, 1]) {
        if (kant ? !w.stadB : !w.stadA) continue;
        const q = kant ? w.s1 - 0.045 * Tw : w.s0 + 0.045 * Tw, rich = kant ? -1 : 1;
        const x = (w.ax + w.ux * q) * sc + this.ox, y = (w.ay + w.uy * q) * sc + this.oy;
        if (!this.opScherm(x, y, T * 0.2)) continue;
        for (let k = -2; k <= 2; k++) rechthoek(c, x - w.uy * k * T * 0.021, y + w.ux * k * T * 0.021, w.ux, w.uy, T * 0.017, T * 0.0065);
        // stopstreep op de inkomende rijstrook
        const sx = x + w.ux * rich * T * 0.035, sy = y + w.uy * rich * T * 0.035;
        rechthoek(c, sx + w.uy * rich * T * 0.025, sy - w.ux * rich * T * 0.025, -w.uy, w.ux, T * 0.024, T * 0.003);
      }
    }
    c.fill();
    if (z >= DREMPEL.bord) {
      // rijstrookpijlen voor de stopstreep
      c.fillStyle = WIT; c.beginPath();
      for (let i = 0; i < nz; i++) {
        const w = W[this.zw[i]];
        for (let kant = 0; kant <= 1; kant++) {
          if (kant ? !w.stadB : !w.stadA) continue;
          const rich = kant ? 1 : -1, q = kant ? w.s1 - 0.16 * Tw : w.s0 + 0.16 * Tw;
          const hx = w.ux * rich, hy = w.uy * rich;
          const x = (w.ax + w.ux * q + w.uy * rich * 0.026 * Tw) * sc + this.ox, y = (w.ay + w.uy * q - w.ux * rich * 0.026 * Tw) * sc + this.oy;
          if (!this.opScherm(x, y, T * 0.05)) continue;
          rechthoek(c, x - hx * T * 0.01, y - hy * T * 0.01, hx, hy, T * 0.014, T * 0.0025);
          c.moveTo(x + hx * T * 0.016, y + hy * T * 0.016); c.lineTo(x + hx * T * 0.002 - hy * T * 0.008, y + hy * T * 0.002 + hx * T * 0.008); c.lineTo(x + hx * T * 0.002 + hy * T * 0.008, y + hy * T * 0.002 - hx * T * 0.008); c.closePath();
        }
      }
      c.fill();
    }
    if (z >= DREMPEL.klein) this.tekenWegKlein(c);
    c.globalAlpha = 1;
    void nu;
  }

  // Op het kleinste niveau: putdeksels, kolken, reparatieplekken, olievlekken en scheurtjes. Eerst de plekken
  // verzamelen, dan per soort één pad: een paar vullingen per beeld in plaats van een paar per plek.
  tekenWegKlein(c) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, W = this.wegen;
    const buf = this.kleinPos ??= new Float32Array(MAX_KLEIN * 6);
    let n = 0;
    for (let i = 0; i < this.nZw && n < MAX_KLEIN; i++) {
      const w = W[this.zw[i]];
      for (let q = w.s0 + Tw * 0.15, j = 0; q < w.s1 - Tw * 0.1 && n < MAX_KLEIN; q += Tw * 0.3, j++) {
        const x = (w.ax + w.ux * q) * sc + this.ox, y = (w.ay + w.uy * q) * sc + this.oy;
        if (!this.opScherm(x, y, T * 0.1)) continue;
        const o = n++ * 6;
        buf[o] = x; buf[o + 1] = y; buf[o + 2] = w.ux; buf[o + 3] = w.uy; buf[o + 4] = hash(w.zaad, j, 81); buf[o + 5] = j & 1 ? 1 : -1;
      }
    }
    c.globalAlpha = smooth(13, 13.6, this.zoom);
    if (n) {
      // putdeksels in de rijstrook (h < 0.4), met een lichtere rand
      const rd = T * 0.0065;
      c.fillStyle = '#2f302f'; c.beginPath();
      for (let k = 0; k < n; k++) { const o = k * 6; if (buf[o + 4] >= 0.4) continue; const d = buf[o + 5] * 0.028 * T; stip(c, buf[o] - buf[o + 3] * d, buf[o + 1] + buf[o + 2] * d, T * 0.008); }
      c.fill();
      c.strokeStyle = '#6a6a66'; c.lineWidth = Math.max(0.5, T * 0.0015); c.beginPath();
      for (let k = 0; k < n; k++) { const o = k * 6; if (buf[o + 4] >= 0.4) continue; const d = buf[o + 5] * 0.028 * T, px = buf[o] - buf[o + 3] * d, py = buf[o + 1] + buf[o + 2] * d; c.moveTo(px + rd, py); c.arc(px, py, rd, 0, TAU); }
      c.stroke();
      // reparatieplekken: donkerder asfalt (0.4 ≤ h < 0.55)
      c.fillStyle = 'rgba(30,30,29,0.35)'; c.beginPath();
      for (let k = 0; k < n; k++) { const o = k * 6, h = buf[o + 4]; if (h < 0.4 || h >= 0.55) continue; const ux = buf[o + 2], uy = buf[o + 3]; rechthoek(c, buf[o] - uy * T * 0.01, buf[o + 1] + ux * T * 0.01, ux, uy, T * 0.03, T * 0.018); }
      c.fill();
      // olievlekken (0.55 ≤ h < 0.7): de ellips ligt langs de weg, dus zijn beginpunt is het midden plus rx · richting
      const rx = T * 0.012;
      c.fillStyle = 'rgba(20,20,25,0.3)'; c.beginPath();
      for (let k = 0; k < n; k++) {
        const o = k * 6, h = buf[o + 4];
        if (h < 0.55 || h >= 0.7) continue;
        const ux = buf[o + 2], uy = buf[o + 3], ex = buf[o] - uy * T * 0.025, ey = buf[o + 1] + ux * T * 0.025;
        c.moveTo(ex + ux * rx, ey + uy * rx); c.ellipse(ex, ey, rx, T * 0.007, Math.atan2(uy, ux), 0, TAU);
      }
      c.fill();
      // scheurtjes (h ≥ 0.7)
      c.strokeStyle = 'rgba(25,25,24,0.55)'; c.lineWidth = Math.max(0.4, T * 0.0012); c.beginPath();
      for (let k = 0; k < n; k++) {
        const o = k * 6;
        if (buf[o + 4] < 0.7) continue;
        const x = buf[o], y = buf[o + 1], ux = buf[o + 2], uy = buf[o + 3], nx = -uy, ny = ux;
        c.moveTo(x - nx * T * 0.03, y - ny * T * 0.03); c.lineTo(x + ux * T * 0.01, y + uy * T * 0.01); c.lineTo(x + nx * T * 0.02 + ux * T * 0.025, y + ny * T * 0.02 + uy * T * 0.025);
      }
      c.stroke();
      // kolken bij de stoeprand, bij elke plek
      c.fillStyle = '#1e1f1f'; c.beginPath();
      for (let k = 0; k < n; k++) { const o = k * 6, ux = buf[o + 2], uy = buf[o + 3]; rechthoek(c, buf[o] - uy * T * 0.052, buf[o + 1] + ux * T * 0.052, ux, uy, T * 0.006, T * 0.003); }
      c.fill();
    }
    // reflectorpaaltjes (kattenogen) langs de kantstreep
    c.fillStyle = '#f4f2ea'; c.beginPath();
    for (let i = 0; i < this.nZw; i++) {
      const w = W[this.zw[i]];
      for (let q = w.s0; q < w.s1; q += Tw * 0.1) for (const o of [-0.046, 0.046]) {
        const x = (w.ax + w.ux * q - w.uy * o * Tw) * sc + this.ox, y = (w.ay + w.uy * q + w.ux * o * Tw) * sc + this.oy;
        if (this.opScherm(x, y, 2)) stip(c, x, y, T * 0.0018);
      }
    }
    c.fill();
  }

  tekenKruisingen(c, nu) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, z = this.zoom;
    let n = 0;
    c.globalAlpha = smooth(5.5, 6.5, z);
    for (const k of this.kruisingen) {
      if (n >= PLAFOND.kruisingen) break;
      const x = k.x * sc + this.ox, y = k.y * sc + this.oy;
      if (!this.opScherm(x, y, T * 0.3) || (k.zij && this.res[k.tg])) continue;
      n++;
      const A = this.wegen[k.a], B = this.wegen[k.b];
      if (k.rotonde) {
        c.fillStyle = '#2a2b2a'; c.beginPath(); c.arc(x, y, T * 0.15, 0, TAU); c.fill();
        c.fillStyle = ASFALT; c.beginPath(); c.arc(x, y, T * 0.135, 0, TAU); c.fill();
        c.fillStyle = '#97938a'; c.beginPath(); c.arc(x, y, T * 0.07, 0, TAU); c.fill();
        c.fillStyle = this.gs === 2 && this.sn ? '#dfe3e2' : GRAS[this.gs]; c.beginPath(); c.arc(x, y, T * 0.062, 0, TAU); c.fill();
        if (z >= DREMPEL.markering) {
          c.strokeStyle = WIT; c.lineWidth = Math.max(0.5, T * 0.003); c.setLineDash([T * 0.02, T * 0.02]);
          c.beginPath(); c.arc(x, y, T * 0.1, 0, TAU); c.stroke(); c.setLineDash([]);
          // boom op het middeneiland
          c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.arc(x + T * 0.02, y + T * 0.02, T * 0.035, 0, TAU); c.fill();
          c.fillStyle = this.gs === 1 ? '#b0773a' : this.gs === 2 ? '#6b5a44' : '#3f6a34'; c.beginPath(); c.arc(x, y, T * 0.035, 0, TAU); c.fill();
          c.fillStyle = 'rgba(255,255,220,0.2)'; c.beginPath(); c.arc(x - T * 0.01, y - T * 0.01, T * 0.016, 0, TAU); c.fill();
        }
        if (z >= DREMPEL.verkeerslicht) {
          // haaientanden bij elke ingang
          c.fillStyle = WIT; c.beginPath();
          for (const w of [A, B]) for (const sg of [-1, 1]) {
            const ex = x + w.ux * sg * T * 0.16, ey = y + w.uy * sg * T * 0.16;
            for (let j = 0; j < 3; j++) {
              const o = (0.012 + j * 0.016) * T * sg, px = ex - w.uy * o, py = ey + w.ux * o;
              c.moveTo(px - w.uy * T * 0.006, py + w.ux * T * 0.006); c.lineTo(px + w.uy * T * 0.006, py - w.ux * T * 0.006); c.lineTo(px - w.ux * sg * T * 0.012, py - w.uy * sg * T * 0.012); c.closePath();
            }
          }
          c.fill();
        }
      } else {
        if (k.zij) {
          // T-kruising: zijweg met stoepranden, zebra op de hoofdweg en haaientanden op de zijweg
          const nx = -A.uy * k.zij, ny = A.ux * k.zij, ex = x + nx * T * 0.42, ey = y + ny * T * 0.42;
          c.strokeStyle = '#97938a'; c.lineWidth = T * 0.1; c.beginPath(); c.moveTo(x + nx * T * 0.05, y + ny * T * 0.05); c.lineTo(ex, ey); c.stroke();
          c.strokeStyle = ASFALT; c.lineWidth = T * 0.08; c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke();
          c.fillStyle = ASFALT; c.beginPath(); c.arc(ex, ey, T * 0.04, 0, TAU); c.fill();
          if (z >= DREMPEL.zebra) {
            c.fillStyle = WIT; c.beginPath();
            for (let j = -2; j <= 2; j++) rechthoek(c, x + A.ux * T * 0.09 - A.uy * j * T * 0.021, y + A.uy * T * 0.09 + A.ux * j * T * 0.021, A.ux, A.uy, T * 0.016, T * 0.0065);
            for (let j = 0; j < 4; j++) { const o = (j - 1.5) * T * 0.016, px = x + nx * T * 0.075 + A.ux * o, py = y + ny * T * 0.075 + A.uy * o; c.moveTo(px - A.ux * T * 0.006, py - A.uy * T * 0.006); c.lineTo(px + A.ux * T * 0.006, py + A.uy * T * 0.006); c.lineTo(px - nx * T * 0.012, py - ny * T * 0.012); c.closePath(); }
            c.fill();
          }
          if (z >= DREMPEL.bord) {
            // brievenbus en een hekje aan het eind van het zijweggetje
            c.fillStyle = '#c43c32'; c.fillRect(ex + A.ux * T * 0.06 - T * 0.006, ey + A.uy * T * 0.06 - T * 0.02, T * 0.012, T * 0.012);
            c.strokeStyle = '#d8d4c8'; c.lineWidth = Math.max(0.5, T * 0.004); c.beginPath(); c.moveTo(ex - A.ux * T * 0.045 + nx * T * 0.04, ey - A.uy * T * 0.045 + ny * T * 0.04); c.lineTo(ex + A.ux * T * 0.045 + nx * T * 0.04, ey + A.uy * T * 0.045 + ny * T * 0.04); c.stroke();
          }
          continue;
        }
        // gewoon kruispunt: vlak asfalt, zebra's op elke arm, verkeerslichten op de hoeken
        c.fillStyle = ASFALT; c.beginPath(); c.arc(x, y, T * 0.07, 0, TAU); c.fill();
        if (z >= DREMPEL.zebra) {
          c.fillStyle = WIT; c.beginPath();
          for (const w of [A, B]) for (const sg of [-1, 1]) {
            const ex = x + w.ux * sg * T * 0.11, ey = y + w.uy * sg * T * 0.11;
            for (let j = -2; j <= 2; j++) rechthoek(c, ex - w.uy * j * T * 0.021, ey + w.ux * j * T * 0.021, w.ux, w.uy, T * 0.016, T * 0.0065);
          }
          c.fill();
        }
        if (z >= DREMPEL.verkeerslicht) {
          const groenA = frac(nu / 16000 + hash(k.zaad, 3)) < 0.5;
          for (const [w, groen] of [[A, groenA], [B, !groenA]]) for (const sg of [-1, 1]) {
            const px = x + w.ux * sg * T * 0.15 - w.uy * sg * T * 0.08, py = y + w.uy * sg * T * 0.15 + w.ux * sg * T * 0.08;
            this.verkeerslicht(c, px, py, groen ? 2 : 0);
          }
        }
      }
    }
    this.n.kruisingen = n;
    c.globalAlpha = 1;
  }

  // Laanbomen langs de wegen (in de stad voorbij het fietspad), in de kleur van het seizoen (kaal in de winter, bloesem in het voorjaar).
  tekenLaanbomen(c, a) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, W = this.wegen, s = this.state, kol = this.geo.kol;
    const buf = this.boomPos ??= new Float32Array(PLAFOND.bomen * 4);
    let n = 0;
    for (let i = 0; i < this.nZw && n < PLAFOND.bomen; i++) {
      const w = W[this.zw[i]];
      if (hash(w.zaad, 51) > 0.85) continue;
      const af = (w.stadA || w.stadB ? 0.2 : 0.16) * Tw; // in de stad voorbij het fietspad
      for (let q = w.s0 + Tw * 0.14, j = 0; q < w.s1 - Tw * 0.1 && n < PLAFOND.bomen; q += Tw * 0.28, j++) {
        for (let kant = -1; kant <= 1 && n < PLAFOND.bomen; kant += 2) {
          const wx = w.ax + w.ux * q - w.uy * kant * af, wy = w.ay + w.uy * q + w.ux * kant * af;
          const x = wx * sc + this.ox, y = wy * sc + this.oy;
          if (!this.opScherm(x, y, T * 0.1)) continue;
          const tg = Math.floor(wy / Tw) * kol + Math.floor(wx / Tw);
          if (s.bezet[tg] || this.res[tg] || this.isWater(wx, wy)) continue;
          const o = n * 4, h = hash(w.zaad, j * 2 + (kant > 0 ? 1 : 0), 52);
          buf[o] = x; buf[o + 1] = y; buf[o + 2] = T * 0.034 * (0.75 + 0.5 * h); buf[o + 3] = h;
          n++;
        }
      }
    }
    this.n.bomen = n;
    if (!n) return;
    const sz = this.sz, kaal = sz.winter > 0.55;
    c.globalAlpha = a;
    // schaduw naar het zuidoosten, dan de stam, dan de kruin (opgetild: de boom staat schuin omhoog)
    c.fillStyle = 'rgba(0,0,0,0.26)'; c.beginPath();
    // (moveTo naar het beginpunt van de gedraaide ellips, anders trekt het pad een puntje naar buiten)
    for (let k = 0; k < n; k++) { const o = k * 4, r = buf[o + 2]; c.moveTo(buf[o] + r * (0.6 + COS06), buf[o + 1] + r * (0.9 + SIN06)); c.ellipse(buf[o] + r * 0.6, buf[o + 1] + r * 0.9, r, r * 0.7, 0.6, 0, TAU); }
    c.fill();
    c.strokeStyle = '#4a3a2c'; c.lineWidth = Math.max(0.6, T * 0.005); c.beginPath();
    for (let k = 0; k < n; k++) { const o = k * 4; c.moveTo(buf[o], buf[o + 1]); c.lineTo(buf[o], buf[o + 1] - buf[o + 2] * 0.8); }
    c.stroke();
    if (kaal) {
      // kale takken, met wat sneeuw erop
      c.strokeStyle = '#6b5a4a'; c.lineWidth = Math.max(0.5, T * 0.0025); c.beginPath();
      for (let k = 0; k < n; k++) {
        const o = k * 4, x = buf[o], y = buf[o + 1] - buf[o + 2] * 0.8, r = buf[o + 2];
        for (let t = 0; t < 5; t++) { const hk = -Math.PI / 2 + (t - 2) * 0.55; c.moveTo(x, y); c.lineTo(x + Math.cos(hk) * r, y + Math.sin(hk) * r * 0.9); }
      }
      c.stroke();
      if (this.sn) { c.fillStyle = 'rgba(244,246,248,0.7)'; c.beginPath(); for (let k = 0; k < n; k++) { const o = k * 4; stip(c, buf[o] - buf[o + 2] * 0.2, buf[o + 1] - buf[o + 2] * 1.4, buf[o + 2] * 0.35); } c.fill(); }
    } else {
      for (let groep = 0; groep < 2; groep++) {
        c.fillStyle = sz.herfst > 0.5 ? (groep ? '#c9902f' : '#a0602e') : sz.lente > 0.5 ? (groep ? '#6f9a48' : '#5d8a3f') : (groep ? '#4a7a3a' : '#3f6a34');
        c.beginPath();
        for (let k = 0; k < n; k++) { const o = k * 4; if ((buf[o + 3] < 0.5 ? 0 : 1) !== groep) continue; stip(c, buf[o], buf[o + 1] - buf[o + 2] * 1.1, buf[o + 2]); }
        c.fill();
      }
      c.fillStyle = 'rgba(255,255,215,0.2)'; c.beginPath();
      for (let k = 0; k < n; k++) { const o = k * 4, r = buf[o + 2]; stip(c, buf[o] - r * 0.3, buf[o + 1] - r * 1.4, r * 0.45); }
      c.fill();
      if (sz.bloei > 0.25 && this.zoom >= DREMPEL.halte) {
        c.fillStyle = '#f3c8d4'; c.beginPath();
        for (let k = 0; k < n; k++) { if (buf[k * 4 + 3] > 0.45) continue; const o = k * 4, r = buf[o + 2]; for (let t = 0; t < 4; t++) stip(c, buf[o] + Math.cos(t * 1.9 + k) * r * 0.6, buf[o + 1] - r * 1.1 + Math.sin(t * 1.9 + k) * r * 0.6, Math.max(0.6, r * 0.12)); }
        c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  // Paal met lichtkast, schuin omhoog; stand 0 rood, 1 oranje, 2 groen. Rood zit bovenaan (verst van de grond),
  // groen onderaan, zoals bij een echt verkeerslicht.
  verkeerslicht(c, x, y, stand) {
    if (this.n.verkeerslichten >= PLAFOND.verkeerslichten || !this.opScherm(x, y, this.T * 0.1)) return;
    this.n.verkeerslichten++;
    const T = this.T, hgt = T * 0.05;
    c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = Math.max(0.6, T * 0.005);
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + hgt * SCHUIN, y + hgt * SCHUIN); c.stroke();
    c.strokeStyle = PAAL; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - hgt); c.stroke();
    c.fillStyle = '#1d1f21'; c.fillRect(x - T * 0.006, y - hgt - T * 0.016, T * 0.012, T * 0.03);
    const kleur = ['#ff4a3a', '#ffb02e', '#4dff7a'][stand], ly = y - hgt - T * 0.01 + stand * T * 0.009;
    c.fillStyle = 'rgba(80,80,80,0.9)';
    c.beginPath();
    for (let j = 0; j < 3; j++) if (j !== stand) stip(c, x, y - hgt - T * 0.01 + j * T * 0.009, T * 0.0035);
    c.fill();
    c.fillStyle = kleur; c.beginPath(); stip(c, x, ly, T * 0.004); c.fill();
    this.zetLicht(x, ly, Math.max(2, T * 0.02), stand === 0 ? ROOD : stand === 1 ? AMBER : GROEN, 0.9);
  }

  tekenOverwegen(c, nu) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, z = this.zoom;
    c.globalAlpha = smooth(6, 7, z);
    for (const o of this.overwegen) {
      const x = o.x * sc + this.ox, y = o.y * sc + this.oy;
      if (!this.opScherm(x, y, T * 0.2)) continue;
      // betonplaten over de hele breedte van de weg (stoeprand tot stoeprand, langs het spoor gemeten dus breder
      // naarmate de weg schuiner kruist) en dwars over de grindbaan; de rails er weer overheen
      const kr = o.hx * o.uy - o.hy * o.ux, ak = Math.max(0.35, Math.abs(kr)), cosk = o.hx * o.ux + o.hy * o.uy;
      const lp = T * 0.068 / ak;
      c.fillStyle = '#8e8a80'; c.beginPath(); rechthoek(c, x, y, o.hx, o.hy, lp, T * 0.058); c.fill();
      c.strokeStyle = STAAL; c.lineWidth = Math.max(0.6, T * 0.0055); c.beginPath();
      for (const g of [-0.0175, 0.0175]) { const px = x - o.hy * g * T, py = y + o.hx * g * T; c.moveTo(px - o.hx * lp, py - o.hy * lp); c.lineTo(px + o.hx * lp, py + o.hy * lp); }
      c.stroke();
      if (z < DREMPEL.overweg) continue;
      // slagbomen: dicht als er een trein binnen anderhalve tegel is
      const r = this.routes[o.r];
      let d = Infinity;
      for (let j = 0; j < r.treinen.length; j++) { this.treinStand(r, j); const lo = Math.min(this.kop, this.staart), hi = Math.max(this.kop, this.staart); d = Math.min(d, o.sr < lo ? lo - o.sr : o.sr > hi ? o.sr - hi : 0); }
      const dicht = clamp((1.6 * Tw - d) / (0.4 * Tw), 0, 1);
      const knip = dicht > 0 && frac(nu / 700) < 0.5;
      // palen naast de weg en net buiten de grindbaan, ook als de weg schuin over het spoor gaat
      const dp = (T * 0.075 - T * 0.07 * cosk * (kr < 0 ? -1 : 1)) / ak;
      for (const k of [-1, 1]) {
        const nx = -o.uy * k, ny = o.ux * k;
        const px = x + o.ux * k * dp + nx * T * 0.07, py = y + o.uy * k * dp + ny * T * 0.07;
        const ex = px - nx * T * 0.065 * dicht, ey = py - ny * T * 0.065 * dicht - T * 0.06 * (1 - dicht);
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.6, T * 0.006);
        c.beginPath(); c.moveTo(px + T * 0.01, py + T * 0.01); c.lineTo(ex + T * 0.01 + T * 0.03 * (1 - dicht), ey + T * 0.01 + T * 0.06 * (1 - dicht)); c.stroke();
        c.strokeStyle = WIT; c.lineWidth = Math.max(0.8, T * 0.007); c.beginPath(); c.moveTo(px, py); c.lineTo(ex, ey); c.stroke();
        c.strokeStyle = '#c43c32'; c.setLineDash([T * 0.01, T * 0.01]); c.beginPath(); c.moveTo(px, py); c.lineTo(ex, ey); c.stroke(); c.setLineDash([]);
        c.fillStyle = '#222'; c.fillRect(px - T * 0.006, py - T * 0.006, T * 0.012, T * 0.012);
        // waarschuwingslichten knipperen om en om
        c.fillStyle = knip === (k > 0) ? '#ff4a3a' : '#5a2a28'; c.beginPath(); stip(c, px, py - T * 0.02, T * 0.004); c.fill();
        if (knip === (k > 0)) this.zetLicht(px, py - T * 0.02, Math.max(2, T * 0.025), ROOD, 1);
      }
    }
    c.globalAlpha = 1;
  }

  // ---------- treinen ----------

  // Waar trein j op route r nu rijdt: this.kop (voorkant in de rijrichting), this.staart en this.rich (+1 heen, -1 terug).
  treinStand(r, j) {
    const tr = r.treinen[j], Tw = this.geo.T, L = r.L, Ltr = Math.min(tr.totaal, L * 0.5);
    const v = Tw * (r.goederen ? 0.45 : 0.65), rit = Math.max(1, (L - Ltr) / v), wacht = r.goederen ? 10 : 6;
    const per = 2 * (rit + wacht);
    const t = frac(this.klok / per + tr.fase) * per;
    // cycloïde: optrekken en afremmen zonder schok
    const glad = (u) => u - Math.sin(TAU * u) / TAU;
    if (t < wacht) { this.rich = 1; this.kop = Ltr; }
    else if (t < wacht + rit) { this.rich = 1; this.kop = Ltr + (L - Ltr) * glad((t - wacht) / rit); }
    else if (t < 2 * wacht + rit) { this.rich = -1; this.kop = L - Ltr; }
    else { this.rich = -1; this.kop = (L - Ltr) - (L - Ltr) * glad((t - 2 * wacht - rit) / rit); }
    this.staart = this.kop - this.rich * Ltr;
    this.ltr = Ltr;
  }

  tekenTreinen(c, a) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, z = this.zoom, R = this.routes;
    if (!this.nZr) return;
    const B = 0.017 * T;
    c.globalAlpha = a;
    alle: for (let i = 0; i < this.nZr; i++) {
      const r = R[this.zr[i]];
      for (let j = 0; j < r.treinen.length; j++) {
        if (this.n.treinen >= PLAFOND.treinen) break alle;
        const tr = r.treinen[j];
        this.treinStand(r, j);
        const kop = this.kop, rich = this.rich, schaal = this.ltr / tr.totaal;
        // grof uitsnijden met het middelpunt van de trein
        this.punt(r, kop - rich * this.ltr * 0.5);
        const mx = this.px * sc + this.ox, my = this.py * sc + this.oy;
        if (!this.opScherm(mx, my, this.ltr * sc)) continue;
        this.n.treinen++;
        // wagons: eerst alle schaduwen, dan elke bak in zijn kleur
        let q = kop;
        const nW = tr.lengtes.length;
        const pos = this.wagonPos ??= new Float32Array(PLAFOND.wagons * 6);
        let nw = 0;
        for (let k = 0; k < nW && this.n.wagons < PLAFOND.wagons; k++) {
          const l = tr.lengtes[k] * Tw * schaal;
          const voor = q, achter = q - rich * l;
          this.punt(r, voor); const fx = this.px, fy = this.py;
          this.punt(r, achter); const bx = this.px, by = this.py;
          const dx = fx - bx, dy = fy - by, dl = Math.hypot(dx, dy) || 1;
          const o = nw * 6;
          pos[o] = ((fx + bx) / 2) * sc + this.ox; pos[o + 1] = ((fy + by) / 2) * sc + this.oy;
          pos[o + 2] = dx / dl; pos[o + 3] = dy / dl; pos[o + 4] = (dl * sc) / 2 - T * 0.003; pos[o + 5] = k;
          nw++; this.n.wagons++;
          q = achter - rich * 0.005 * Tw * schaal;
        }
        c.fillStyle = 'rgba(0,0,0,0.3)';
        c.beginPath();
        for (let k = 0; k < nw; k++) { const o = k * 6; rechthoek(c, pos[o] + T * 0.012, pos[o + 1] + T * 0.014, pos[o + 2], pos[o + 3], pos[o + 4], B); }
        c.fill();
        for (let k = 0; k < nw; k++) {
          const o = k * 6, x = pos[o], y = pos[o + 1], hx = pos[o + 2], hy = pos[o + 3], l = pos[o + 4], idx = pos[o + 5];
          const lading = tr.lading[idx];
          c.fillStyle = idx === 0 ? tr.loc : r.goederen ? WAGON[lading] : tr.rijtuig;
          c.beginPath(); rechthoek(c, x, y, hx, hy, l, B); c.fill();
          // koplamp en verlichte ramen 's nachts, ook van verder weg (vóór de uitsnede op zoom 8 hieronder)
          if (this.nacht > 0.05) {
            if (idx === 0) this.zetLicht(x + hx * l, y + hy * l, Math.max(2, T * 0.03), KOEL, 1);
            else if (!r.goederen) { this.zetLicht(x + hx * l * 0.4, y + hy * l * 0.4, Math.max(1.5, T * 0.018), WARM, 0.6); this.zetLicht(x - hx * l * 0.4, y - hy * l * 0.4, Math.max(1.5, T * 0.018), WARM, 0.6); }
          }
          if (z < 8) continue;
          if (idx === 0) {
            // locomotief: dak, cabineramen aan de voorkant en (elektrisch) een pantograaf
            c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); rechthoek(c, x, y, hx, hy, l * 0.8, B * 0.55); c.fill();
            c.fillStyle = GLAS; c.beginPath(); rechthoek(c, x + hx * l * 0.85, y + hy * l * 0.85, hx, hy, l * 0.1, B * 0.8); c.fill();
            if (r.elektrisch && z >= 11) { c.strokeStyle = '#2a2c2e'; c.lineWidth = Math.max(0.5, T * 0.002); c.beginPath(); c.moveTo(x - hx * l * 0.3 - hy * B, y - hy * l * 0.3 + hx * B); c.lineTo(x - hx * l * 0.15 + hy * B, y - hy * l * 0.15 - hx * B); c.lineTo(x, y); c.stroke(); }
          } else if (r.goederen) {
            if (lading === 2 || lading === 3) {
              // containerwagen: twee containers in andere kleuren
              for (const h of [-0.5, 0.5]) { c.fillStyle = CONTAINERS[(lading * 3 + idx + (h > 0 ? 1 : 0)) % CONTAINERS.length]; c.beginPath(); rechthoek(c, x + hx * l * h, y + hy * l * h, hx, hy, l * 0.46, B * 0.9); c.fill(); }
            } else if (lading === 1) {
              // ketelwagen: glanslijn over de lengte
              c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = Math.max(0.5, B * 0.3); c.beginPath(); c.moveTo(x - hx * l * 0.85 + hy * B * 0.3, y - hy * l * 0.85 - hx * B * 0.3); c.lineTo(x + hx * l * 0.85 + hy * B * 0.3, y + hy * l * 0.85 - hx * B * 0.3); c.stroke();
            } else {
              // open wagen met kolen of erts
              c.fillStyle = lading === 0 ? '#2a2724' : '#8a5a3a'; c.beginPath(); rechthoek(c, x, y, hx, hy, l * 0.85, B * 0.7); c.fill();
            }
          } else {
            c.fillStyle = 'rgba(255,255,255,0.2)'; c.beginPath(); rechthoek(c, x, y, hx, hy, l * 0.9, B * 0.45); c.fill();
            if (z >= 12) {
              // raambanden langs beide zijden
              c.fillStyle = 'rgba(30,40,52,0.75)'; c.beginPath();
              for (const sg of [-1, 1]) rechthoek(c, x - hy * B * 0.82 * sg, y + hx * B * 0.82 * sg, hx, hy, l * 0.8, B * 0.12);
              c.fill();
            }
          }
        }
        // koplamp overdag als stip
        if (nw && z >= 9) { const x = pos[0] + pos[2] * pos[4], y = pos[1] + pos[3] * pos[4]; c.fillStyle = '#fffbe8'; c.beginPath(); stip(c, x, y, T * 0.004); c.fill(); }
      }
    }
    c.globalAlpha = 1;
  }

  tekenBovenleiding(c, nu) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, z = this.zoom, R = this.routes;
    const a = smooth(7.5, 8.5, z);
    if (!this.nZr || a <= 0) return;
    const H = T * 0.072;
    c.globalAlpha = a;
    // rijdraad en zijn schaduw: de route zelf, opgetild
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
    for (let i = 0; i < this.nZr; i++) { const r = R[this.zr[i]]; if (r.elektrisch) this.lijn(c, r, 0, H * SCHUIN, H * SCHUIN); }
    c.stroke();
    // masten om de 0.45 tegel
    const mast = this.mastPos ??= new Float32Array(PLAFOND.masten * 4);
    let nm = 0;
    for (let i = 0; i < this.nZr && this.n.masten + nm < PLAFOND.masten; i++) {
      const r = R[this.zr[i]];
      if (!r.elektrisch) continue;
      for (let q = Tw * 0.2; q < r.L && this.n.masten + nm < PLAFOND.masten; q += Tw * 0.45) {
        this.punt(r, q);
        const off = 0.068 * Tw;
        const bx = (this.px - this.hy * off) * sc + this.ox, by = (this.py + this.hx * off) * sc + this.oy;
        if (!this.opScherm(bx, by, T * 0.1)) continue;
        const o = nm * 4;
        mast[o] = bx; mast[o + 1] = by; mast[o + 2] = this.px * sc + this.ox; mast[o + 3] = this.py * sc + this.oy;
        nm++;
      }
    }
    this.n.masten += nm;
    c.beginPath();
    for (let k = 0; k < nm; k++) { const o = k * 4; c.moveTo(mast[o], mast[o + 1]); c.lineTo(mast[o] + H * SCHUIN, mast[o + 1] + H * SCHUIN); c.lineTo(mast[o + 2] + H * SCHUIN, mast[o + 3] + H * SCHUIN); }
    c.stroke();
    c.strokeStyle = '#2a2c2e'; c.lineWidth = Math.max(0.5, T * 0.0028); c.beginPath();
    for (let i = 0; i < this.nZr; i++) { const r = R[this.zr[i]]; if (r.elektrisch) this.lijn(c, r, 0, 0, -H); }
    c.stroke();
    c.strokeStyle = '#6d7176'; c.lineWidth = Math.max(0.6, T * 0.006); c.beginPath();
    for (let k = 0; k < nm; k++) { const o = k * 4; c.moveTo(mast[o], mast[o + 1]); c.lineTo(mast[o], mast[o + 1] - H * 1.05); c.lineTo(mast[o + 2], mast[o + 3] - H); }
    c.stroke();
    // seinen bij de stations en om de drie tegels: rood als er een trein vlakbij is
    if (z >= DREMPEL.sein) {
      for (let i = 0; i < this.nZr; i++) {
        const r = R[this.zr[i]];
        for (let q = Tw * 0.9; q < r.L - Tw * 0.5; q += Tw * 3) {
          this.punt(r, q);
          const off = -0.07 * Tw;
          const x = (this.px - this.hy * off) * sc + this.ox, y = (this.py + this.hx * off) * sc + this.oy;
          if (!this.opScherm(x, y, T * 0.1)) continue;
          let rood = false;
          for (let j = 0; j < r.treinen.length; j++) { this.treinStand(r, j); if (Math.abs((this.kop + this.staart) / 2 - q) < 2 * Tw) rood = true; }
          c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.6, T * 0.005);
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + T * 0.05 * SCHUIN, y + T * 0.05 * SCHUIN); c.stroke();
          c.strokeStyle = PAAL; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - T * 0.05); c.stroke();
          c.fillStyle = '#1d1f21'; c.fillRect(x - T * 0.007, y - T * 0.066, T * 0.014, T * 0.02);
          c.fillStyle = rood ? '#ff4a3a' : '#4dff7a'; c.beginPath(); stip(c, x, y - T * 0.056, T * 0.0045); c.fill();
          this.zetLicht(x, y - T * 0.056, Math.max(2, T * 0.02), rood ? ROOD : GROEN, 0.8);
        }
      }
    }
    c.globalAlpha = 1;
    void nu;
  }

  // ---------- straatmeubilair ----------

  tekenStraatmeubilair(c, nu) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, z = this.zoom, W = this.wegen, nz = this.nZw;
    if (!nz) return;
    const aL = smooth(7.5, 8.5, z);
    // lantaarnpalen: om de 0.4 tegel, om en om links en rechts, net buiten de stoeprand
    const buf = this.lantaarnPos ??= new Float32Array(PLAFOND.lantaarns * 4);
    let n = 0;
    for (let i = 0; i < nz && n < PLAFOND.lantaarns; i++) {
      const w = W[this.zw[i]];
      for (let q = w.s0 + Tw * 0.2, j = 0; q < w.s1 - Tw * 0.1 && n < PLAFOND.lantaarns; q += Tw * 0.4, j++) {
        const kant = j & 1 ? 1 : -1, nx = -w.uy * kant, ny = w.ux * kant;
        const wx = w.ax + w.ux * q + nx * 0.095 * Tw, wy = w.ay + w.uy * q + ny * 0.095 * Tw;
        const x = wx * sc + this.ox, y = wy * sc + this.oy;
        if (!this.opScherm(x, y, T * 0.1) || this.opBouwwerk(wx, wy)) continue;
        const o = n * 4;
        buf[o] = x; buf[o + 1] = y; buf[o + 2] = nx; buf[o + 3] = ny;
        n++;
      }
    }
    this.n.lantaarns = n;
    const H = T * 0.065, arm = T * 0.03;
    c.globalAlpha = aL;
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.5, T * 0.005); c.beginPath();
    for (let k = 0; k < n; k++) { const o = k * 4, x = buf[o], y = buf[o + 1]; c.moveTo(x, y); c.lineTo(x + H * SCHUIN, y + H * SCHUIN); c.lineTo(x + H * SCHUIN - buf[o + 2] * arm, y + H * SCHUIN - buf[o + 3] * arm); }
    c.stroke();
    c.strokeStyle = PAAL; c.lineWidth = Math.max(0.6, T * 0.006); c.beginPath();
    for (let k = 0; k < n; k++) { const o = k * 4, x = buf[o], y = buf[o + 1]; c.moveTo(x, y); c.lineTo(x, y - H); c.lineTo(x - buf[o + 2] * arm, y - H - buf[o + 3] * arm); }
    c.stroke();
    c.fillStyle = this.nacht > 0.3 ? '#fff2c4' : '#d8d6cc'; c.beginPath();
    for (let k = 0; k < n; k++) { const o = k * 4; stip(c, buf[o] - buf[o + 2] * arm, buf[o + 1] - H - buf[o + 3] * arm, T * 0.008); }
    c.fill();
    c.lineCap = 'butt';
    if (this.nacht > 0.05) for (let k = 0; k < n; k++) {
      const o = k * 4, hx = buf[o] - buf[o + 2] * arm, hy = buf[o + 1] - H - buf[o + 3] * arm;
      this.zetLicht(hx, hy, Math.max(2, T * 0.03), WARM, 0.9);
      // lichtplas op het asfalt onder de lamp
      this.zetLicht(buf[o] - buf[o + 2] * arm * 1.5, buf[o + 1] - buf[o + 3] * arm * 1.5, T * 0.09, WARM, 0.22);
    }
    // afvalbakken (elke derde lantaarn) en brandkranen op het kleinste niveau, per kleur één pad
    if (z >= DREMPEL.klein && n) {
      const laag = (kleur, wie, dx, dy, r) => {
        c.fillStyle = kleur; c.beginPath();
        for (let k = 0; k < n; k++) { if (wie(k)) { const o = k * 4; stip(c, buf[o] + buf[o + 3] * T * 0.03 + dx, buf[o + 1] - buf[o + 2] * T * 0.03 + dy, r); } }
        c.fill();
      };
      const bak = (k) => k % 3 === 0, kraan = (k) => k % 3 !== 0 && k % 5 === 1;
      laag('rgba(0,0,0,0.3)', bak, T * 0.004, T * 0.004, T * 0.007);
      laag('#3d5a3a', bak, 0, 0, T * 0.007);
      laag('#1e2a1c', bak, 0, 0, T * 0.004);
      laag('#b8322a', kraan, 0, 0, T * 0.005);
      laag('#e8d8c8', kraan, -T * 0.0015, -T * 0.0015, T * 0.0018);
    }
    if (z >= DREMPEL.halte - 0.3) this.tekenHaltes(c, smooth(8.7, 9.5, z));
    if (z >= DREMPEL.bord - 0.3) {
      const aB = smooth(10.7, 11.4, z);
      c.globalAlpha = aB;
      this.tekenBorden(c);
      // verkeerslichten bij de ingang van woonwijken en hoofdstad
      for (let i = 0; i < nz; i++) {
        const w = W[this.zw[i]];
        for (const kant of [0, 1]) {
          if (kant ? !w.stadB : !w.stadA) continue;
          const q = kant ? w.s1 - 0.1 * Tw : w.s0 + 0.1 * Tw, rich = kant ? -1 : 1;
          const fase = frac(nu / 14000 + hash(w.zaad, kant, 7));
          const stand = fase < 0.45 ? 2 : fase < 0.55 ? 1 : 0;
          const wx = w.ax + w.ux * q - w.uy * rich * 0.085 * Tw, wy = w.ay + w.uy * q + w.ux * rich * 0.085 * Tw;
          if (this.opBouwwerk(wx, wy)) continue;
          this.verkeerslicht(c, wx * sc + this.ox, wy * sc + this.oy, stand);
        }
      }
    }
    c.globalAlpha = 1;
  }

  tekenHaltes(c, a) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, z = this.zoom, W = this.wegen;
    c.globalAlpha = a;
    let n = 0;
    for (let i = 0; i < this.nZw && n < PLAFOND.haltes; i++) {
      const w = W[this.zw[i]];
      if (hash(w.zaad, 21) > 0.35 || w.s1 - w.s0 < 1.2 * Tw) continue;
      const q = (w.s0 + w.s1) / 2, nx = -w.uy, ny = w.ux;
      const wx = w.ax + w.ux * q + nx * 0.105 * Tw, wy = w.ay + w.uy * q + ny * 0.105 * Tw;
      const x = wx * sc + this.ox, y = wy * sc + this.oy;
      if (!this.opScherm(x, y, T * 0.2) || this.opBouwwerk(wx, wy) || this.isWater(wx, wy)) continue;
      n++;
      // abri: schaduw, glazen dak met rand, bankje, paal met bordje
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); rechthoek(c, x + T * 0.02, y + T * 0.022, w.ux, w.uy, T * 0.032, T * 0.012); c.fill();
      c.fillStyle = '#5d6166'; c.beginPath(); rechthoek(c, x, y, w.ux, w.uy, T * 0.032, T * 0.012); c.fill();
      c.fillStyle = 'rgba(165,190,205,0.85)'; c.beginPath(); rechthoek(c, x, y, w.ux, w.uy, T * 0.028, T * 0.009); c.fill();
      c.fillStyle = '#7a5236'; c.beginPath(); rechthoek(c, x + nx * T * 0.004, y + ny * T * 0.004, w.ux, w.uy, T * 0.018, T * 0.003); c.fill();
      const px = x + w.ux * T * 0.045 - nx * T * 0.008, py = y + w.uy * T * 0.045 - ny * T * 0.008;
      c.strokeStyle = PAAL; c.lineWidth = Math.max(0.5, T * 0.004); c.beginPath(); c.moveTo(px, py); c.lineTo(px, py - T * 0.045); c.stroke();
      c.fillStyle = '#2f6d9a'; c.fillRect(px - T * 0.008, py - T * 0.06, T * 0.016, T * 0.016);
      c.fillStyle = '#e8d84a'; c.fillRect(px - T * 0.004, py - T * 0.056, T * 0.008, T * 0.004);
      if (this.nacht > 0.05) this.zetLicht(x, y, T * 0.05, KOEL, 0.35);
      // bus aan de halte: komt, wacht en rijdt weer door
      const f = frac(this.klok / 45 + hash(w.zaad, 22));
      if (f < 0.35) {
        const k = f < 0.05 ? (0.05 - f) / 0.05 : f > 0.3 ? -(f - 0.3) / 0.05 : 0;
        const bx = x - nx * T * 0.075 + w.ux * T * 0.4 * -k, by = y - ny * T * 0.075 + w.uy * T * 0.4 * -k;
        c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); rechthoek(c, bx + T * 0.012, by + T * 0.014, w.ux, w.uy, T * 0.06, T * 0.018); c.fill();
        c.fillStyle = BUS[Math.floor(hash(w.zaad, 23) * BUS.length)]; c.beginPath(); rechthoek(c, bx, by, w.ux, w.uy, T * 0.06, T * 0.018); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); rechthoek(c, bx, by, w.ux, w.uy, T * 0.05, T * 0.009); c.fill();
        if (z >= 11) {
          c.fillStyle = '#7d8187'; c.beginPath(); rechthoek(c, bx - w.ux * T * 0.025, by - w.uy * T * 0.025, w.ux, w.uy, T * 0.012, T * 0.008); c.fill();
          c.fillStyle = GLAS; c.beginPath(); rechthoek(c, bx + w.ux * T * 0.055, by + w.uy * T * 0.055, w.ux, w.uy, T * 0.004, T * 0.015); c.fill();
        }
        if (this.nacht > 0.05) this.zetLicht(bx + w.ux * T * 0.06, by + w.uy * T * 0.06, T * 0.03, KOEL, 0.9);
      }
    }
    this.n.haltes = n;
  }

  // Verkeersborden zonder tekst: snelheid (rode rand), waarschuwing (driehoek), gebod (blauw rond),
  // voorrang (gele ruit) en een groene wegwijzer met strepen in plaats van letters.
  tekenBorden(c) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, W = this.wegen;
    let n = 0;
    const r = T * 0.011, H = T * 0.045;
    for (let i = 0; i < this.nZw && n < PLAFOND.borden; i++) {
      const w = W[this.zw[i]];
      for (let q = w.s0 + Tw * 0.5, j = 0; q < w.s1 - Tw * 0.2 && n < PLAFOND.borden; q += Tw * 1.1, j++) {
        if (hash(w.zaad, j, 31) > 0.6) continue;
        const soort = Math.floor(hash(w.zaad, j, 32) * BORDEN), kant = hash(w.zaad, j, 33) < 0.5 ? 1 : -1;
        const wx = w.ax + w.ux * q - w.uy * kant * 0.105 * Tw, wy = w.ay + w.uy * q + w.ux * kant * 0.105 * Tw;
        const x = wx * sc + this.ox, y = wy * sc + this.oy;
        if (!this.opScherm(x, y, T * 0.1) || this.opBouwwerk(wx, wy) || this.isWater(wx, wy)) continue;
        n++;
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.5, T * 0.004);
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + H * SCHUIN, y + H * SCHUIN); c.stroke();
        c.strokeStyle = '#8a8d90'; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - H); c.stroke();
        const sy = y - H - r * 0.6;
        if (soort === 0) {
          c.fillStyle = '#c43c32'; c.beginPath(); c.arc(x, sy, r, 0, TAU); c.fill();
          c.fillStyle = '#f4f2ea'; c.beginPath(); c.arc(x, sy, r * 0.7, 0, TAU); c.fill();
          c.fillStyle = '#222'; c.fillRect(x - r * 0.35, sy - r * 0.12, r * 0.7, r * 0.24);
        } else if (soort === 1) {
          c.fillStyle = '#c43c32'; c.beginPath(); c.moveTo(x, sy - r * 1.1); c.lineTo(x + r, sy + r * 0.7); c.lineTo(x - r, sy + r * 0.7); c.closePath(); c.fill();
          c.fillStyle = '#f4f2ea'; c.beginPath(); c.moveTo(x, sy - r * 0.6); c.lineTo(x + r * 0.6, sy + r * 0.45); c.lineTo(x - r * 0.6, sy + r * 0.45); c.closePath(); c.fill();
        } else if (soort === 2) {
          c.fillStyle = '#2f5d9a'; c.beginPath(); c.arc(x, sy, r, 0, TAU); c.fill();
          c.strokeStyle = '#f4f2ea'; c.lineWidth = Math.max(0.5, r * 0.25); c.beginPath(); c.moveTo(x - r * 0.5, sy + r * 0.3); c.lineTo(x, sy - r * 0.4); c.lineTo(x + r * 0.5, sy + r * 0.3); c.stroke();
        } else if (soort === 3) {
          c.fillStyle = '#f4f2ea'; c.beginPath(); c.moveTo(x, sy - r); c.lineTo(x + r, sy); c.lineTo(x, sy + r); c.lineTo(x - r, sy); c.closePath(); c.fill();
          c.fillStyle = '#e0b020'; c.beginPath(); c.moveTo(x, sy - r * 0.65); c.lineTo(x + r * 0.65, sy); c.lineTo(x, sy + r * 0.65); c.lineTo(x - r * 0.65, sy); c.closePath(); c.fill();
        } else {
          c.fillStyle = '#2f6a45'; c.fillRect(x - r * 1.8, sy - r * 0.8, r * 3.6, r * 1.6);
          c.fillStyle = 'rgba(240,240,232,0.85)'; c.fillRect(x - r * 1.4, sy - r * 0.4, r * 2.2, r * 0.22); c.fillRect(x - r * 1.4, sy + r * 0.15, r * 1.6, r * 0.22);
        }
      }
    }
    this.n.borden = n;
  }

  // ---------- havens ----------

  tekenHavenLeven(c, a) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, z = this.zoom;
    const stil = this.wr.onweer > 0.5; // bij onweer liggen de kranen stil
    c.globalAlpha = a;
    for (const hv of this.havens) {
      if (!this.inBeeld(hv.x, hv.y, hv.x, hv.y, Tw * 0.8)) continue;
      const co = Math.cos(hv.hoek), si = Math.sin(hv.hoek);
      const L = (u, v) => { this.qx = (hv.x + (u * co - v * si) * Tw) * sc + this.ox; this.qy = (hv.y + (u * si + v * co) * Tw) * sc + this.oy; };
      const dq = hv.dq;
      const t = stil ? 0 : this.klok;
      // vrachtwagens op een rondje over het terrein
      if (z >= DREMPEL.halte) {
        for (let k = 0; k < 3; k++) {
          const f = frac(t / 30 + k / 3 + hash(hv.zaad, k));
          // rondje: langs de kade heen, achterlangs terug
          let u, v, hu, hv2;
          if (f < 0.4) { u = -0.4 + f / 0.4 * 0.8; v = dq - 0.09; hu = 1; hv2 = 0; }
          else if (f < 0.5) { u = 0.4; v = dq - 0.09 - (f - 0.4) / 0.1 * 0.3; hu = 0; hv2 = -1; }
          else if (f < 0.9) { u = 0.4 - (f - 0.5) / 0.4 * 0.8; v = dq - 0.39; hu = -1; hv2 = 0; }
          else { u = -0.4; v = dq - 0.39 + (f - 0.9) / 0.1 * 0.3; hu = 0; hv2 = 1; }
          L(u, v);
          const hx = hu * co - hv2 * si, hy = hu * si + hv2 * co;
          c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); rechthoek(c, this.qx + T * 0.008, this.qy + T * 0.009, hx, hy, T * 0.04, T * 0.011); c.fill();
          c.fillStyle = CONTAINERS[(k * 3 + 1) % CONTAINERS.length]; c.beginPath(); rechthoek(c, this.qx - hx * T * 0.008, this.qy - hy * T * 0.008, hx, hy, T * 0.03, T * 0.011); c.fill();
          c.fillStyle = '#d8d6cf'; c.beginPath(); rechthoek(c, this.qx + hx * T * 0.03, this.qy + hy * T * 0.03, hx, hy, T * 0.009, T * 0.01); c.fill();
          if (this.nacht > 0.05) this.zetLicht(this.qx + hx * T * 0.04, this.qy + hy * T * 0.04, T * 0.02, KOEL, 0.8);
        }
      }
      // portaalkraan boven de stapels
      if (z >= DREMPEL.markering && this.n.kranen < PLAFOND.kranen) {
        const u = -0.3 + 0.6 * tri(t / 50 + hash(hv.zaad, 9)), Hp = T * 0.05;
        for (const v of [dq - 0.37, dq - 0.17]) {
          L(u, v); const ax = this.qx, ay = this.qy;
          L(u, v + 0.16); const bx = this.qx, by = this.qy;
          c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.6, T * 0.006); c.beginPath(); c.moveTo(ax + Hp * SCHUIN, ay + Hp * SCHUIN); c.lineTo(bx + Hp * SCHUIN, by + Hp * SCHUIN); c.stroke();
          c.strokeStyle = '#d9a63a'; c.lineWidth = Math.max(0.8, T * 0.008); c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax, ay - Hp); c.lineTo(bx, by - Hp); c.lineTo(bx, by); c.stroke();
        }
        this.n.kranen++;
      }
      // sleepboot die heen en weer pendelt langs het schip, met een kielzog
      if (hv.sleep && z >= DREMPEL.markering) {
        const f = tri(t / 70 + hash(hv.zaad, 31)), u = -0.34 + 0.68 * f, rich = frac(t / 70 + hash(hv.zaad, 31)) < 0.5 ? 1 : -1;
        L(u, dq + 0.2);
        const hx = co * rich, hy = si * rich, x = this.qx, y = this.qy;
        c.fillStyle = 'rgba(235,245,250,0.35)'; c.beginPath();
        c.moveTo(x - hx * T * 0.02, y - hy * T * 0.02); c.lineTo(x - hx * T * 0.09 - hy * T * 0.02, y - hy * T * 0.09 + hx * T * 0.02); c.lineTo(x - hx * T * 0.09 + hy * T * 0.02, y - hy * T * 0.09 - hx * T * 0.02); c.closePath(); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); rechthoek(c, x + T * 0.006, y + T * 0.007, hx, hy, T * 0.024, T * 0.009); c.fill();
        c.fillStyle = '#7a2a24'; c.beginPath(); rechthoek(c, x, y, hx, hy, T * 0.024, T * 0.009); c.fill();
        c.fillStyle = '#eceae4'; c.beginPath(); rechthoek(c, x + hx * T * 0.004, y + hy * T * 0.004, hx, hy, T * 0.009, T * 0.006); c.fill();
        c.fillStyle = '#1f1d1b'; c.beginPath(); stip(c, x - hx * T * 0.006, y - hy * T * 0.006, T * 0.003); c.fill();
        if (this.nacht > 0.05) this.zetLicht(x, y, T * 0.02, KOEL, 0.9);
      }
      // vissersboot aan de kade: deint, met stuurhuis, mast en netten
      if (hv.kotter && z >= DREMPEL.markering) {
        const dein = Math.sin(this.klok * 1.3 + hv.zaad) * 0.004;
        L(-0.02, dq + 0.065 + dein);
        const x = this.qx, y = this.qy;
        c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); rechthoek(c, x + T * 0.008, y + T * 0.009, co, si, T * 0.11, T * 0.022); c.fill();
        c.fillStyle = hv.romp === '#2b3440' ? '#2f6d9a' : '#3d7a4f'; c.beginPath();
        c.moveTo(x - co * T * 0.11 - si * T * 0.022, y - si * T * 0.11 + co * T * 0.022); c.lineTo(x + co * T * 0.08 - si * T * 0.022, y + si * T * 0.08 + co * T * 0.022);
        c.lineTo(x + co * T * 0.12, y + si * T * 0.12); c.lineTo(x + co * T * 0.08 + si * T * 0.022, y + si * T * 0.08 - co * T * 0.022);
        c.lineTo(x - co * T * 0.11 + si * T * 0.022, y - si * T * 0.11 - co * T * 0.022); c.closePath(); c.fill();
        c.fillStyle = '#d8d2c2'; c.beginPath(); rechthoek(c, x, y, co, si, T * 0.1, T * 0.016); c.fill();
        c.fillStyle = '#eceae4'; c.beginPath(); rechthoek(c, x + co * T * 0.035, y + si * T * 0.035, co, si, T * 0.025, T * 0.014); c.fill();
        c.fillStyle = GLAS; c.beginPath(); rechthoek(c, x + co * T * 0.055, y + si * T * 0.055, co, si, T * 0.004, T * 0.012); c.fill();
        if (z >= DREMPEL.bord) {
          // mast schuin omhoog en een stapel netten op het achterdek
          c.strokeStyle = '#3a3d40'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath(); c.moveTo(x - co * T * 0.02, y - si * T * 0.02); c.lineTo(x - co * T * 0.02, y - si * T * 0.02 - T * 0.06); c.stroke();
          c.fillStyle = '#c9a24a'; c.beginPath(); stip(c, x - co * T * 0.07, y - si * T * 0.07, T * 0.01); c.fill();
        }
        if (this.nacht > 0.05) this.zetLicht(x - co * T * 0.02, y - si * T * 0.02 - T * 0.06, T * 0.02, WARM, 0.8);
      }
      // zeilbootjes die voor de haven kruisen, alleen waar water is en niet hartje winter
      if (z >= DREMPEL.halte && this.sz.winter < 0.6) {
        for (let k = 0; k < 2; k++) {
          const f = (this.klok / 90 + hash(hv.zaad, 70 + k)) * TAU, u = Math.cos(f) * 0.24, v = dq + 0.32 + Math.sin(f) * 0.1;
          if (!this.isWater(hv.x + (u * co - v * si) * Tw, hv.y + (u * si + v * co) * Tw)) continue;
          L(u, v);
          const du = -Math.sin(f) * 0.24, dv = Math.cos(f) * 0.1, dl = Math.hypot(du, dv) || 1;
          const hx = (du * co - dv * si) / dl, hy = (du * si + dv * co) / dl, x = this.qx, y = this.qy;
          c.strokeStyle = 'rgba(235,245,250,0.4)'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath(); c.moveTo(x - hx * T * 0.012, y - hy * T * 0.012); c.lineTo(x - hx * T * 0.05, y - hy * T * 0.05); c.stroke();
          c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath(); c.moveTo(x, y); c.lineTo(x + T * 0.02, y + T * 0.011); c.lineTo(x + hx * T * 0.012, y + hy * T * 0.012); c.closePath(); c.fill();
          c.fillStyle = '#f4f2ec'; c.beginPath(); rechthoek(c, x, y, hx, hy, T * 0.014, T * 0.0045); c.fill();
          c.fillStyle = k ? '#f4f2ec' : CONTAINERS[hv.zaad & 7]; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - T * 0.032); c.lineTo(x + hx * T * 0.012, y + hy * T * 0.012 - T * 0.004); c.closePath(); c.fill();
        }
      }
      // dekverlichting op het schip
      if (hv.schip && this.nacht > 0.05) for (const u of [-0.28, -0.05, 0.18]) { L(u, dq + 0.07); this.zetLicht(this.qx, this.qy, T * 0.04, WARM, 0.6); }
      // kadekranen: rijden langzaam langs de kade, de loopkat haalt containers van het schip
      const nK = hv.schip ? 2 : 1, Hk = T * 0.16;
      for (let k = 0; k < nK && this.n.kranen < PLAFOND.kranen; k++) {
        this.n.kranen++;
        const u = -0.18 + k * 0.3 + 0.06 * Math.sin(t * 0.04 + k * 2 + hv.zaad);
        const cyc = t / 16 + k * 0.37 + hash(hv.zaad, k, 2);
        const vt = dq - 0.03 + 0.17 * tri(cyc);
        const poten = [];
        for (const du of [-0.024, 0.024]) for (const v of [dq - 0.067, dq - 0.015]) { L(u + du, v); poten.push(this.qx, this.qy); }
        L(u, dq - 0.12); const achterX = this.qx, achterY = this.qy;
        L(u, dq + 0.17); const voorX = this.qx, voorY = this.qy;
        L(u, vt); const katX = this.qx, katY = this.qy;
        // schaduw van poten en giek
        c.strokeStyle = 'rgba(0,0,0,0.26)'; c.lineWidth = Math.max(0.8, T * 0.01); c.beginPath();
        for (let p = 0; p < 8; p += 2) { c.moveTo(poten[p], poten[p + 1]); c.lineTo(poten[p] + Hk * SCHUIN, poten[p + 1] + Hk * SCHUIN); }
        c.moveTo(achterX + Hk * SCHUIN, achterY + Hk * SCHUIN); c.lineTo(voorX + Hk * SCHUIN, voorY + Hk * SCHUIN);
        c.stroke();
        c.strokeStyle = hv.kraan; c.lineWidth = Math.max(0.8, T * 0.007); c.beginPath();
        for (let p = 0; p < 8; p += 2) { c.moveTo(poten[p], poten[p + 1]); c.lineTo(poten[p], poten[p + 1] - Hk); }
        c.moveTo(poten[0], poten[1] - Hk * 0.55); c.lineTo(poten[4], poten[5] - Hk * 0.55);
        c.moveTo(poten[2], poten[3] - Hk * 0.55); c.lineTo(poten[6], poten[7] - Hk * 0.55);
        c.stroke();
        c.lineWidth = Math.max(1, T * 0.013); c.beginPath(); c.moveTo(achterX, achterY - Hk); c.lineTo(voorX, voorY - Hk); c.stroke();
        c.fillStyle = '#d8d6cf'; c.beginPath(); rechthoek(c, achterX, achterY - Hk, co, si, T * 0.022, T * 0.016); c.fill();
        // loopkat met een container aan de kabel; de container zakt en stijgt mee met de cyclus
        const zak = Hk * (0.25 + 0.55 * Math.abs(Math.sin(cyc * Math.PI)));
        c.fillStyle = '#2a2c2e'; c.beginPath(); rechthoek(c, katX, katY - Hk, co, si, T * 0.01, T * 0.012); c.fill();
        c.strokeStyle = '#2a2c2e'; c.lineWidth = Math.max(0.4, T * 0.0015); c.beginPath(); c.moveTo(katX, katY - Hk); c.lineTo(katX, katY - Hk + zak); c.stroke();
        const kh = Hk - zak;
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); rechthoek(c, katX + kh * SCHUIN, katY + kh * SCHUIN, -si, co, T * 0.029, T * 0.012); c.fill();
        c.fillStyle = CONTAINERS[Math.floor(cyc) % CONTAINERS.length]; c.beginPath(); rechthoek(c, katX, katY - kh, -si, co, T * 0.029, T * 0.012); c.fill();
        this.zetLicht(voorX, voorY - Hk, T * 0.05, WARM, 0.8);
        if (frac(this.nu / 1500 + k * 0.3) < 0.2) this.zetLicht(achterX, achterY - Hk - T * 0.01, Math.max(2, T * 0.02), ROOD, 1);
      }
      // lichtmasten
      if (z >= DREMPEL.halte) {
        for (const u of [-0.44, 0.44]) {
          L(u, dq - 0.2);
          const x = this.qx, y = this.qy, Hm = T * 0.12;
          c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = Math.max(0.6, T * 0.005); c.beginPath(); c.moveTo(x, y); c.lineTo(x + Hm * SCHUIN, y + Hm * SCHUIN); c.stroke();
          c.strokeStyle = '#7d8187'; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - Hm); c.stroke();
          c.fillStyle = '#d8d6cc'; c.fillRect(x - T * 0.012, y - Hm - T * 0.005, T * 0.024, T * 0.008);
          this.zetLicht(x, y - Hm, T * 0.08, KOEL, 0.9);
          this.zetLicht(x, y - T * 0.02, T * 0.2, KOEL, 0.25);
        }
      }
    }
    // depots: fakkel op de hoek en lampjes op de tanks
    for (const d of this.depots) {
      const x = d.x * sc + this.ox, y = d.y * sc + this.oy;
      if (!this.opScherm(x, y, T)) continue;
      if (z >= DREMPEL.halte) {
        const fx = x + T * 0.4, fy = y - T * 0.4, Hf = T * 0.09;
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.6, T * 0.006); c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + Hf * SCHUIN, fy + Hf * SCHUIN); c.stroke();
        c.strokeStyle = '#6d7176'; c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx, fy - Hf); c.stroke();
        const fl = 0.7 + 0.3 * Math.sin(this.nu / 90 + d.zaad) * Math.sin(this.nu / 37);
        c.fillStyle = '#ffb02e'; c.beginPath(); c.ellipse(fx, fy - Hf - T * 0.012 * fl, T * 0.006, T * 0.014 * fl, 0, 0, TAU); c.fill();
        c.fillStyle = '#fff2b0'; c.beginPath(); stip(c, fx, fy - Hf - T * 0.008, T * 0.003); c.fill();
        this.zetLicht(fx, fy - Hf - T * 0.01, T * 0.06 * fl, AMBER, 1);
      }
      if (this.nacht > 0.05) for (let i = 0; i < 6; i++) this.zetLicht(x + (-0.27 + (i % 3) * 0.27) * T, y + (-0.22 + Math.floor(i / 3) * 0.31) * T, Math.max(1.5, T * 0.012), ROOD, 0.7);
    }
    c.globalAlpha = 1;
  }

  // ---------- vliegvelden ----------

  vliegSprite(liv, schaduw) {
    const P = this.P, k = `${schaduw ? 's' : liv}|${P}`;
    let e = this.vliegSprites.get(k);
    if (e) return e;
    if (this.vliegSprites.size > 24) this.vliegSprites.clear();
    const S = Math.ceil(0.18 * P) + 2;
    const cv = fabriek(S, S);
    if (!cv) return null;
    const g = cv.getContext('2d');
    g.setTransform(P, 0, 0, P, S / 2, S / 2);
    bakVliegtuig(g, liv, schaduw);
    e = { cv, S, P };
    this.vliegSprites.set(k, e);
    return e;
  }

  // Waar vliegtuig j van vliegveld v nu is, in lokale tegelcoördinaten: this.vx, this.vy, this.vh (hoogte in tegels),
  // this.vk (koers), this.va (zichtbaarheid). Het vliegveld gebruikt de baan tegen de wind in.
  vliegStand(v, j, d, stand) {
    const PER = 80;
    const geland = this.wr.mist > 0.6 || this.wr.onweer > 0.5;
    const u = geland ? 0.9 : frac(this.klok / PER + j * 0.5 + hash(v.zaad, 5));
    const sx = v.standen[stand];
    this.vh = 0; this.va = 1;
    const pad = (pts, f) => {
      let tot = 0;
      for (let i = 0; i + 3 < pts.length; i += 2) tot += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
      let q = clamp(f, 0, 1) * tot;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const l = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
        if (q <= l || i + 4 >= pts.length) { const k = l ? Math.min(1, q / l) : 0; this.vx = pts[i] + (pts[i + 2] - pts[i]) * k; this.vy = pts[i + 1] + (pts[i + 3] - pts[i + 1]) * k; this.vk = Math.atan2(pts[i + 3] - pts[i + 1], pts[i + 2] - pts[i]); return; }
        q -= l;
      }
    };
    const glad = (x) => x * x * (3 - 2 * x);
    if (u < 0.1 || u >= 0.8) { this.vx = sx; this.vy = 0.07; this.vk = Math.PI / 2; return 'staat'; }
    if (u < 0.22) { pad([sx, 0.07, sx, -0.1, -0.86 * d, -0.1, -0.86 * d, -0.24], glad((u - 0.1) / 0.12)); return 'taxi'; }
    if (u < 0.26) { this.vx = -0.86 * d; this.vy = -0.24; this.vk = d > 0 ? 0 : Math.PI; return 'wacht'; }
    if (u < 0.42) {
      // aanloop en opstijgen, daarna verder klimmen tot buiten beeld
      const q = (u - 0.26) / 0.16;
      const x = q < 0.45 ? 1.4 * (q / 0.45) ** 2 : 1.4 + (q - 0.45) / 0.55 * 4.2;
      this.vx = -0.86 * d + d * x; this.vy = -0.24; this.vk = d > 0 ? 0 : Math.PI;
      this.vh = x > 1.05 ? Math.min(0.7, (x - 1.05) * 0.18) : 0;
      this.va = 1 - smooth(0.8, 1, q);
      return 'lucht';
    }
    if (u < 0.56) { this.va = 0; return 'weg'; }
    if (u < 0.64) {
      // nadering en landing op het begin van de baan
      const q = (u - 0.56) / 0.08;
      this.vx = -0.6 * d - d * 4 * (1 - q); this.vy = -0.24; this.vk = d > 0 ? 0 : Math.PI;
      this.vh = 0.5 * (1 - q) ** 1.3;
      this.va = smooth(0, 0.2, q);
      return 'lucht';
    }
    if (u < 0.7) { const q = (u - 0.64) / 0.06; this.vx = -0.6 * d + d * 0.9 * (1 - (1 - q) ** 2); this.vy = -0.24; this.vk = d > 0 ? 0 : Math.PI; return 'uitrol'; }
    pad([0.3 * d, -0.24, 0.3 * d, -0.1, sx, -0.1, sx, 0.07], glad((u - 0.7) / 0.1));
    return 'taxi';
  }

  tekenVliegvelden(c, a, nu) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, z = this.zoom;
    c.globalAlpha = a;
    for (const v of this.vliegvelden) {
      if (!this.inBeeld(v.mx - 6 * Tw, v.my - 6 * Tw, v.mx + 6 * Tw, v.my + 6 * Tw, 0)) continue;
      const co = Math.cos(v.hoek), si = Math.sin(v.hoek);
      const naar = (lx, ly) => { this.qx = (v.mx + (lx * co - ly * si) * Tw) * sc + this.ox; this.qy = (v.my + (lx * si + ly * co) * Tw) * sc + this.oy; };
      const opVeld = this.inBeeld(v.mx - Tw * 1.1, v.my - Tw * 1.1, v.mx + Tw * 1.1, v.my + Tw * 1.1, 0);
      // baanrichting tegen de wind in
      const d = Math.cos(this.wd.hoek - v.hoek) > 0 ? -1 : 1;
      if (opVeld) {
        // windzak: wijst met de wind mee, slapper bij weinig wind
        naar(v.zak[0], v.zak[1]);
        const zx = this.qx, zy = this.qy, kr = this.wd.kracht, fl = Math.sin(nu / 180 + v.zaad) * 0.15 * kr;
        const hk = this.wd.hoek + fl, lz = T * (0.02 + 0.03 * kr);
        c.strokeStyle = '#e6e6e0'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath(); c.moveTo(zx, zy); c.lineTo(zx, zy - T * 0.04); c.stroke();
        c.strokeStyle = '#ff7a2a'; c.lineWidth = Math.max(1, T * 0.008); c.setLineDash([T * 0.008, T * 0.006]);
        c.beginPath(); c.moveTo(zx, zy - T * 0.04); c.lineTo(zx + Math.cos(hk) * lz, zy - T * 0.04 + Math.sin(hk) * lz * 0.7 + (1 - kr) * T * 0.012); c.stroke(); c.setLineDash([]);
        // draaiende radar
        if (z >= DREMPEL.markering) {
          naar(-0.795, 0.295);
          const rh = nu / 900;
          c.strokeStyle = '#e8e8e2'; c.lineWidth = Math.max(0.8, T * 0.006); c.beginPath(); c.moveTo(this.qx - Math.cos(rh) * T * 0.02, this.qy - T * 0.02 - Math.sin(rh) * T * 0.008); c.lineTo(this.qx + Math.cos(rh) * T * 0.02, this.qy - T * 0.02 + Math.sin(rh) * T * 0.008); c.stroke();
        }
        if (z >= DREMPEL.halte) {
          // bagagetreintje rond het platform, tankwagen bij een vliegtuig, follow-me-auto op de taxibaan
          const f0 = this.klok / 40 + hash(v.zaad, 41);
          for (let k = 0; k < 4; k++) {
            this.platformLus(frac(f0 - k * 0.012));
            naar(this.lx, this.ly);
            const hx = Math.cos(v.hoek + this.lk), hy = Math.sin(v.hoek + this.lk);
            c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); rechthoek(c, this.qx + T * 0.004, this.qy + T * 0.005, hx, hy, T * 0.008, T * 0.005); c.fill();
            c.fillStyle = k === 0 ? '#d9b43a' : '#8d9196'; c.beginPath(); rechthoek(c, this.qx, this.qy, hx, hy, T * 0.008, T * 0.005); c.fill();
            if (k && z >= DREMPEL.bord) { c.fillStyle = CONTAINERS[(k + v.zaad) & 7]; c.beginPath(); rechthoek(c, this.qx, this.qy, hx, hy, T * 0.005, T * 0.0035); c.fill(); }
          }
          naar(v.standen[2] + 0.055, 0.035);
          const th = v.hoek + Math.PI / 2, tx = Math.cos(th), ty = Math.sin(th);
          c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); rechthoek(c, this.qx + T * 0.006, this.qy + T * 0.007, tx, ty, T * 0.022, T * 0.008); c.fill();
          c.fillStyle = '#e8e6df'; c.beginPath(); rechthoek(c, this.qx - tx * T * 0.004, this.qy - ty * T * 0.004, tx, ty, T * 0.017, T * 0.008); c.fill();
          c.fillStyle = '#c43c32'; c.beginPath(); rechthoek(c, this.qx + tx * T * 0.016, this.qy + ty * T * 0.016, tx, ty, T * 0.006, T * 0.008); c.fill();
          const fm = tri(this.klok / 55 + hash(v.zaad, 43));
          naar(-0.8 + 1.6 * fm, -0.1);
          const fr = frac(this.klok / 55 + hash(v.zaad, 43)) < 0.5 ? 1 : -1, mx = Math.cos(v.hoek) * fr, my = Math.sin(v.hoek) * fr;
          c.fillStyle = '#e0b020'; c.beginPath(); rechthoek(c, this.qx, this.qy, mx, my, T * 0.009, T * 0.005); c.fill();
          c.fillStyle = '#1f1d1b'; c.beginPath(); rechthoek(c, this.qx, this.qy, mx, my, T * 0.003, T * 0.005); c.fill();
          if (frac(nu / 500) < 0.5) this.zetLicht(this.qx, this.qy, Math.max(2, T * 0.015), AMBER, 1);
        }
        // twee vliegtuigen vast aan de slurf
        for (const stand of [2, 3]) {
          naar(v.standen[stand], 0.07);
          this.tekenVliegtuig(c, this.qx, this.qy, 0, v.hoek + Math.PI / 2, (v.liv + stand) % LIVREI.length, 1, 1);
        }
        // baanverlichting 's nachts en bij mist
        const zicht = Math.max(this.nacht, this.wr.mist * 0.8);
        if (zicht > 0.05) {
          for (let x = -0.9; x <= 0.9; x += 0.1) for (const y of [-0.28, -0.2]) { naar(x, y); this.zetLicht(this.qx, this.qy, Math.max(1.5, T * 0.012), KOEL, 0.8); }
          for (let x = -0.84; x <= 0.84; x += 0.12) for (const y of [-0.12, -0.08]) { naar(x, y); this.zetLicht(this.qx, this.qy, Math.max(1.2, T * 0.009), BLAUW, 0.8); }
          for (const e of [-1, 1]) for (let k = 0; k < 4; k++) { naar(e * 0.915, -0.27 + k * 0.02); this.zetLicht(this.qx, this.qy, Math.max(1.5, T * 0.012), e === -d ? GROEN : ROOD, 0.9); }
          // flitsende naderingslichten: een lichtje dat naar de baan toe rent
          const fl = Math.floor(frac(nu / 1000) * 6);
          for (let k = 0; k < 5; k++) { naar(-d * (0.94 + (4 - k) * 0.022), -0.24); this.zetLicht(this.qx, this.qy, Math.max(2, T * (k === fl ? 0.035 : 0.012)), KOEL, k === fl ? 1 : 0.5); }
          naar(0.42, 0.25); this.zetLicht(this.qx, this.qy, T * 0.05, frac(nu / 2000) < 0.5 ? GROEN : KOEL, 0.8);
        }
        if (frac(nu / 1200) < 0.15) { naar(0.42, 0.25); this.zetLicht(this.qx, this.qy - T * 0.02, Math.max(2, T * 0.02), ROOD, 1); }
      }
      // de twee rijdende vliegtuigen
      for (let j = 0; j < 2 && this.n.vliegtuigen < PLAFOND.vliegtuigen; j++) {
        const fase = this.vliegStand(v, j, d, j);
        if (fase === 'weg' || this.va <= 0.01) continue;
        naar(this.vx, this.vy);
        const hoek = v.hoek + this.vk, hpx = this.vh * T;
        if (!this.opScherm(this.qx, this.qy - hpx, T * 0.3) && !this.opScherm(this.qx + hpx * SCHUIN, this.qy + hpx * SCHUIN, T * 0.3)) continue;
        const liv = (v.liv + j) % LIVREI.length;
        if (fase === 'lucht' && this.nLucht < PLAFOND.vliegtuigen) {
          // in de lucht: boven de gebouwen tekenen (tekenLucht)
          const o = this.nLucht++ * LUCHT, b = this.lucht;
          b[o] = this.qx; b[o + 1] = this.qy; b[o + 2] = hpx; b[o + 3] = hoek; b[o + 4] = 1 + this.vh * 0.9; b[o + 5] = liv; b[o + 6] = this.va * a; b[o + 7] = 0;
        } else this.tekenVliegtuig(c, this.qx, this.qy, 0, hoek, liv, 1, a);
        this.vliegLichten(this.qx, this.qy - hpx, hoek, 1 + this.vh * 0.9, fase !== 'staat');
      }
    }
    c.globalAlpha = 1;
  }

  // Rondje over het platform (lokale coordinaten): this.lx, this.ly en koers this.lk.
  platformLus(f) {
    const x0 = -0.55, x1 = 0.4, y0 = -0.065, y1 = 0.15, bw = x1 - x0, bh = y1 - y0, om = 2 * (bw + bh);
    let q = f * om;
    if (q < bw) { this.lx = x0 + q; this.ly = y0; this.lk = 0; return; }
    q -= bw;
    if (q < bh) { this.lx = x1; this.ly = y0 + q; this.lk = Math.PI / 2; return; }
    q -= bh;
    if (q < bw) { this.lx = x1 - q; this.ly = y1; this.lk = Math.PI; return; }
    q -= bw;
    this.lx = x0; this.ly = y1 - q; this.lk = -Math.PI / 2;
  }

  // Schaduw en romp; h is de hoogte in pixels (schuin omhoog), de schaduw blijft op de grond.
  tekenVliegtuig(c, x, y, h, hoek, liv, schaal, alfa) {
    const lijf = this.vliegSprite(liv, false), sch = this.vliegSprite(0, true);
    if (!lijf || !sch) return;
    this.n.vliegtuigen++;
    const k = (this.T * this.dpr) / lijf.P, S = (lijf.S * k) / this.dpr;
    c.save();
    c.globalAlpha = alfa * 0.32;
    c.translate(x + h * SCHUIN + this.T * 0.012, y + h * SCHUIN + this.T * 0.014);
    c.rotate(hoek);
    c.drawImage(sch.cv, -S / 2, -S / 2, S, S);
    c.restore();
    c.save();
    c.globalAlpha = alfa;
    c.translate(x, y - h);
    c.rotate(hoek);
    c.drawImage(lijf.cv, (-S / 2) * schaal, (-S / 2) * schaal, S * schaal, S * schaal);
    c.restore();
  }

  vliegLichten(x, y, hoek, schaal, aan) {
    const T = this.T * schaal, co = Math.cos(hoek), si = Math.sin(hoek);
    const vleugel = (lx, ly) => [x + (lx * co - ly * si) * T, y + (lx * si + ly * co) * T];
    if (this.nacht > 0.05) {
      const [lx, ly] = vleugel(-0.03, -0.072), [rx, ry] = vleugel(-0.03, 0.072);
      this.zetLicht(lx, ly, Math.max(1.5, T * 0.015), ROOD, 1);
      this.zetLicht(rx, ry, Math.max(1.5, T * 0.015), GROEN, 1);
    }
    if (aan && frac(this.nu / 1100 + x * 0.001) < 0.12) { const [bx, by] = vleugel(-0.01, 0); this.zetLicht(bx, by, Math.max(2, T * 0.03), ROOD, 1); }
    if (aan && frac(this.nu / 900) < 0.08) { const [sx, sy] = vleugel(-0.03, 0.072); this.zetLicht(sx, sy, Math.max(2, T * 0.03), KOEL, 1); }
  }

  // Na de eenheden: vliegtuigen in de lucht, met hun schaduw op de grond.
  tekenLucht(c, view, sc, nu) {
    if (!this.nLucht) return;
    for (let i = 0; i < this.nLucht; i++) {
      const o = i * LUCHT, b = this.lucht;
      this.tekenVliegtuig(c, b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 5], b[o + 4], b[o + 6]);
    }
    void view; void sc; void nu;
  }

  // ---------- hoogspanning ----------

  tekenHoogspanning(c, a, nu) {
    const T = this.T, sc = this.sc, z = this.zoom;
    const H = T * 0.2, arm = T * 0.05, zak = T * 0.045, fijn = z >= 7;
    let nm = 0;
    c.globalAlpha = a;
    for (const ln of this.lijnen) {
      if (!this.inBeeld(ln.x0, ln.y0, ln.x1, ln.y1, 20)) continue;
      const M = ln.m, n = M.length / 2, px = -ln.uy, py = ln.ux;
      // schaduwen van masten en draden
      c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
      for (let i = 0; i < n; i++) {
        const x = M[i * 2] * sc + this.ox, y = M[i * 2 + 1] * sc + this.oy;
        const eind = i === 0 || i === n - 1, h = eind ? H * 0.4 : H;
        const sx = x + h * SCHUIN, sy = y + h * SCHUIN;
        if (!eind) { c.moveTo(x, y); c.lineTo(sx, sy); c.moveTo(sx - px * arm, sy - py * arm); c.lineTo(sx + px * arm, sy + py * arm); }
        if (i + 1 < n) {
          const x2 = M[i * 2 + 2] * sc + this.ox, y2 = M[i * 2 + 3] * sc + this.oy;
          if (!this.opScherm((x + x2) / 2, (y + y2) / 2, Math.abs(x2 - x) + Math.abs(y2 - y))) continue;
          const h2 = i + 1 === n - 1 ? H * 0.4 : H;
          const mx = (x + x2) / 2 + (((h + h2) / 2) - zak) * SCHUIN, my = (y + y2) / 2 + (((h + h2) / 2) - zak) * SCHUIN;
          for (const k of fijn ? [-1, 0, 1] : [0]) {
            const ax = sx + px * arm * k, ay = sy + py * arm * k, bx = x2 + h2 * SCHUIN + px * arm * k, by = y2 + h2 * SCHUIN + py * arm * k;
            c.moveTo(ax, ay); c.quadraticCurveTo(2 * (mx + px * arm * k) - (ax + bx) / 2, 2 * (my + py * arm * k) - (ay + by) / 2, bx, by);
          }
        }
      }
      c.stroke();
      // geleiders: doorhangend tussen de armen
      c.strokeStyle = 'rgba(40,42,44,0.85)'; c.lineWidth = Math.max(0.5, T * 0.0028); c.beginPath();
      for (let i = 0; i + 1 < n; i++) {
        const x = M[i * 2] * sc + this.ox, y = M[i * 2 + 1] * sc + this.oy, x2 = M[i * 2 + 2] * sc + this.ox, y2 = M[i * 2 + 3] * sc + this.oy;
        if (!this.opScherm((x + x2) / 2, (y + y2) / 2, Math.abs(x2 - x) + Math.abs(y2 - y) + H)) continue;
        const h = i === 0 ? H * 0.4 : H, h2 = i + 1 === n - 1 ? H * 0.4 : H;
        for (const k of fijn ? [-1, 0, 1] : [0]) {
          const ax = x + px * arm * k, ay = y - h + py * arm * k - (k === 0 ? T * 0.02 : 0), bx = x2 + px * arm * k, by = y2 - h2 + py * arm * k - (k === 0 ? T * 0.02 : 0);
          c.moveTo(ax, ay); c.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + 2 * zak, bx, by);
        }
      }
      c.stroke();
      // masten: vakwerk dat naar boven smaller wordt, met dwarsarm
      c.strokeStyle = '#7c8086'; c.lineWidth = Math.max(0.6, T * 0.004); c.beginPath();
      for (let i = 1; i < n - 1 && this.n.masten + nm < PLAFOND.masten; i++) {
        const x = M[i * 2] * sc + this.ox, y = M[i * 2 + 1] * sc + this.oy;
        if (!this.opScherm(x, y - H / 2, H)) continue;
        nm++;
        const bw = T * 0.022, tw = T * 0.007;
        c.moveTo(x - px * bw, y - py * bw); c.lineTo(x - px * tw, y - H - py * tw);
        c.moveTo(x + px * bw, y + py * bw); c.lineTo(x + px * tw, y - H + py * tw);
        c.moveTo(x - px * arm, y - H - py * arm); c.lineTo(x + px * arm, y - H + py * arm);
        c.moveTo(x, y - H); c.lineTo(x, y - H - T * 0.02);
        if (fijn) {
          // kruisverbanden
          for (let k = 0; k < 3; k++) {
            const f0 = k / 3, f1 = (k + 1) / 3, w0 = bw + (tw - bw) * f0, w1 = bw + (tw - bw) * f1;
            c.moveTo(x - px * w0, y - H * f0 - py * w0); c.lineTo(x + px * w1, y - H * f1 + py * w1);
            c.moveTo(x + px * w0, y - H * f0 + py * w0); c.lineTo(x - px * w1, y - H * f1 - py * w1);
          }
          c.moveTo(x - px * arm * 0.7, y - H * 0.72 - py * arm * 0.7); c.lineTo(x + px * arm * 0.7, y - H * 0.72 + py * arm * 0.7);
        }
        if (z >= DREMPEL.halte && i % 3 === 1 && frac(nu / 1500 + i * 0.13) < 0.3) this.zetLicht(x, y - H - T * 0.02, Math.max(2, T * 0.02), ROOD, 1);
      }
      c.stroke();
      if (z >= DREMPEL.verkeerslicht) {
        // isolatoren aan de armen
        c.fillStyle = '#9fb8c8'; c.beginPath();
        for (let i = 1; i < n - 1; i++) {
          const x = M[i * 2] * sc + this.ox, y = M[i * 2 + 1] * sc + this.oy;
          if (!this.opScherm(x, y - H, T * 0.1)) continue;
          for (const k of [-1, 0, 1]) stip(c, x + px * arm * k, y - H + py * arm * k - (k === 0 ? T * 0.02 : 0) + T * 0.004, T * 0.0035);
        }
        c.fill();
      }
    }
    this.n.masten += nm;
    c.globalAlpha = 1;
  }

  // ---------- licht ----------

  // Na de nachtlaag: alle verzamelde lichtpunten met de gloed-sprites, opgeteld ('lighter').
  tekenLichten(c, view, sc, nu) {
    const nacht = view.nacht ?? 0, mist = this.wr?.mist ?? 0;
    const k = Math.max(nacht, mist * 0.5);
    if (k < 0.05 || !this.nLicht || !this.gloed) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const b = this.licht;
    for (let i = 0; i < this.nLicht; i++) {
      const o = i * LICHT, soort = b[o + 3], r = b[o + 2];
      const sprite = soort === WARM ? view.lichtSprite : this.gloed[soort];
      if (!sprite) continue;
      c.globalAlpha = k * b[o + 4];
      c.drawImage(sprite, b[o] - r, b[o + 1] - r, r * 2, r * 2);
    }
    c.restore();
    void sc; void nu;
  }

  // Wat er dit beeld getekend is (voor de test en om te meten).
  telling() { return { ...this.n, lucht: this.nLucht, sprites: this.cache.size }; }

  statistiek() { return { sprites: this.cache.size, bytes: this.bytes, gebakken: this.gebakken, routes: this.routes.length, vliegvelden: this.vliegvelden.length, havens: this.havens.length, depots: this.depots.length, stations: this.stations.length, lijnen: this.lijnen.length, pijpen: this.pijpen.length, kruisingen: this.kruisingen.length, overwegen: this.overwegen.length, wegen: this.wegen.length }; }

  // Het afgeleide netwerk, alleen-lezen, voor andere lagen (bijvoorbeeld leven.js die treinreizigers wil laten lopen).
  netwerk() { return { routes: this.routes, stations: this.stations, vliegvelden: this.vliegvelden, havens: this.havens, depots: this.depots, lijnen: this.lijnen, pijpen: this.pijpen, kruisingen: this.kruisingen, overwegen: this.overwegen }; }
}
