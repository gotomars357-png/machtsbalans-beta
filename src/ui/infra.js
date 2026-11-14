// Infrastructuur op de kaart: het wegdek van het wegennet (wegennet.js) per profiel met stoepen, markering,
// afgeronde hoeken, stopstrepen, zebra's, verkeerslichten, haltes, parkeerhavens, overwegen, bruggen en tunnels; verder
// spoorlijnen met treinen, hoogspanningslijnen, containerhavens met kranen, een vliegveld bij elke hoofdstad en
// brandstofdepots met pijpleidingen. Alles komt trapsgewijs op bij het inzoomen (zie DREMPEL).
// voorbereid(view) zet station, vliegveld, havens, depots, spoor en leidingen neer, op elke zoom en zonder wegen: het
// wegennet bouwt daarop verder. Wat van het net afhangt (wegdek, bruggen, overwegen) volgt daarna uit net.versie.
// Eén klok: alles wat rijdt of schakelt (treinen, lichten, slagbomen, kranen, vliegtuigen) loopt op u = verkeersTijd(nu)
// en is periodiek in de dag van 180 s; er is geen eigen klok die op pauze stilstaat.
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Waar iets ligt volgt uit de kaart, de gebouwen
// en vaste hashes van tegel en volgnummer. Geen Math.random, geen Date.
// Licht uit het noordwesten zoals de andere lagen: schaduwen vallen naar het zuidoosten, hoge dingen (masten,
// kranen, palen) staan schuin omhoog getekend zoals de gebouwen in detail.js.

import { seizoen, weer, wind } from './seizoen.js';
import { Wegennet, KLASSE, KNOOP as NK, PROFIEL, ROTONDE_STRAAL, H as DAG, verkeersTijd, lichtStand as netLicht } from './wegennet.js';

// ---------- gedeelde hulpjes (eigen kopie, zie inzoom-spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
const tri = (v) => 1 - Math.abs(1 - 2 * frac(v));
const TAU = Math.PI * 2;
// Periode die de dag (180 s) precies deelt, zo dicht mogelijk bij p: wat erop loopt, is na een dag weer gelijk.
const pd = (p) => DAG / Math.max(1, Math.round(DAG / p));
const SCHUIN = 0.566; // schaduwlengte per hoogte-eenheid, zon op ~45° in het noordwesten (0.8 · √½)
const COS06 = Math.cos(0.6), SIN06 = Math.sin(0.6); // draaiing van de boomschaduw
// Knoopsoort van een gewone kruising met voorrang: KNOOP.KRUIS uit het bevroren contract van wegennet.js (infratest
// controleert dat het 0 blijft). Eigen naam, zodat het losse woord nergens in de tekencode staat (kusttest).
const KRUISING = 0;

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
export const PLAFOND = { sporen: 60, treinen: 24, wagons: 160, masten: 240, lantaarns: 260, haltes: 16, borden: 120, bomen: 220, verkeerslichten: 80, kruisingen: 40, vliegtuigen: 16, kranen: 24, lichten: 600, bakken: 2, bruggen: 40, voetbruggen: 16, tunnels: 16, viaducten: 16, wegwerk: 8, hekjes: 160, wegwerkers: 16, kopperrons: 16, reizigers: 80 };
// Vanaf welke zoom iets verschijnt (de kaart wordt 'diep' op zoom 4). Andere lagen mogen dit lezen.
export const DREMPEL = { spoor: 4, kades: 4, vliegveld: 4, hoogspanning: 4.5, pijp: 4.5, tunnel: 4.5, brugtype: 5, dwarsliggers: 5.5, stoeprand: 5.5, voetbrug: 6.5, markering: 8, lantaarn: 7, zebra: 7, bovenleiding: 8, halte: 9, overweg: 9, verkeerslicht: 9.5, bord: 11, sein: 11, klein: 13, wegdek: 3.6 };
const MAX_SPRITES = 40, MAX_BYTES = 48 * 1024 * 1024, MAX_P = 640, MAX_KLEIN = 400;

// Verkeerslichten: de stand komt uit het wegennet (lichtStand van wegennet.js, op u); hier alleen doorgegeven, zodat
// andere lagen en tests hem ook uit infra.js kunnen halen.
export const lichtStand = netLicht;
// Oude stopplekken voor leven.js (w.stops, STOP getallen per stop; w.zebras, ZEBRA getallen). Het net heeft ze niet
// meer: de ritten (ritten.js) rekenen met de lichten en zebra's van het net zelf.
export const STOP = 7, ZEBRA = 5;
// Overweg: de slagboom zakt in BOOM_TIJD s voor het dichte venster en gaat er in BOOM_TIJD s na weer omhoog; de lampen
// knipperen vanaf KNIPPER_VOOR s voor het venster. Een venster dekt elke treinpassage met VENSTER_MARGE s marge.
const BOOM_TIJD = 1.5, KNIPPER_VOOR = 3, VENSTER_MARGE = 2.2;

// Brugsoorten. De breedte van het water kiest de soort: stenen bogen over een beek, staal of beton over een brede
// rivier, tuien of een hangbrug over de breedste monding en over zee; het spoor krijgt eigen vormen.
const BOOG = 0, LIGGER = 1, VAKWERK = 2, TUI = 3, HANG = 4, STAALBOOG = 5;
const BRUGSTAAL = ['#5e7378', '#8a3f2f', '#4d6a5a', '#6b6f76']; // grijsgroen, roestrood, groen, grafiet
const STEEN = '#a3937a', STEEN_D = '#7d6f5b', STEEN_L = '#c2b49a';
const BEEK = 2.4, BREED = 3.4, STAALBOOG_BR = 3.9, MONDING = 4.3; // rivierbreedte in wereldeenheden
const TUNNEL_H = 0.7; // vakjeshoogte waarboven een weg of spoor de berg in gaat
const MAX_BP = 48; // monsterpunten langs één brug per beeld

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
const SPIEGEL = 8; // soort + SPIEGEL: dezelfde kleur als spiegeling in de natte weg
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
  // sneeuw als een gelijkmatig waas over het gras (geen losse ovalen); de banen zelf zijn geveegd en komen er later
  // overheen, langs de randen ligt hij wat dikker
  if (b.sn) {
    g.fillStyle = b.sn === 2 ? 'rgba(238,241,244,0.72)' : 'rgba(238,241,244,0.4)';
    g.fillRect(-1, -0.5, 2, 1);
    const gr = g.createLinearGradient(0, -0.5, 0, 0.5);
    gr.addColorStop(0, 'rgba(244,246,248,0.25)'); gr.addColorStop(0.5, 'rgba(244,246,248,0)'); gr.addColorStop(1, 'rgba(244,246,248,0.25)');
    g.fillStyle = gr; g.fillRect(-1, -0.5, 2, 1);
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
  // sneeuw: een gelijkmatig waas over het terrein, de rijstroken zijn geveegd
  if (b.sn) { g.fillStyle = b.sn === 2 ? 'rgba(236,239,242,0.5)' : 'rgba(236,239,242,0.28)'; g.fillRect(-0.45, y0, 0.9, 0.42); }
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
    this.u = 0; // verkeerstijd van dit beeld (s, 0..180): de enige klok voor alles wat rijdt of schakelt
    this.nu = 0;
    this.tekentWegdek = true; // dit is de laag die het wegdek van het net tekent (map.js tekent dan geen eenvoudig asfalt)
    this.net = null; // het wegennet waar wegen, bruggen en overwegen op liggen
    this.eigenNet = null; // alleen voor een kaartbeeld zonder wegennet (tests): een eigen net
    this.vzSig = ''; // handtekening van de voorzieningen (station, haven, vliegveld, depot, spoor)
    this.netSleutel = '';
    this.state = null;
    this.geo = null;
    this.sig = ''; // voor andere lagen: verandert als voorzieningen of net veranderen
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
    this.terrein = null; // de terreinlaag (rivieren en meren), als die er is
    this.voetbruggen = [];
    this.vlak = new Float32Array(0); // bruggen als rechthoeken in de wereld (ax, ay, bx, by, halve breedte)
    this.nVlak = 0;
    this.bp = new Float32Array(MAX_BP * 5); // monsterpunten langs een brug: x, y, nx, ny (scherm), q
    this.nul();
  }

  nul() {
    this.n = { sporen: 0, treinen: 0, wagons: 0, masten: 0, lantaarns: 0, haltes: 0, borden: 0, verkeerslichten: 0, kruisingen: 0, vliegtuigen: 0, kranen: 0, lichten: 0, bomen: 0, bruggen: 0, voetbruggen: 0, tunnels: 0, viaducten: 0, wegwerk: 0, hekjes: 0, wegwerkers: 0, spiegels: 0, sporenSneeuw: 0, kopperrons: 0, reizigers: 0 };
    this.nLicht = 0; this.nLucht = 0; this.nZw = 0; this.nZr = 0;
    (this.lampen ??= []).length = 0;
  }

  // Na het laden van een spel: alles opnieuw afleiden.
  laad(view) {
    this.state = view.state;
    this.geo = view.geo;
    this.eigenaar = view.eigenaar;
    this.terrein = view.terreinLaag ?? null;
    this.sig = ''; this.vzSig = ''; this.netSleutel = '';
    this.landSig = [];
    this.perLand = [];
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

  // Water zoals het wegennet het ziet (zee, of rivier en meer uit de terreinlaag): daar komt geen baan en geen poort.
  natOp(x, y) {
    if (this.isWater(x, y)) return true;
    const tl = this.terrein;
    return !!(tl && tl.basis && tl.isZoetWater(x, y));
  }

  // Soort water op een punt: 0 droog, 1 zee, 2 rivier, 3 meer. Rivieren en meren komen uit de terreinlaag; zonder
  // die laag (of voordat hij geladen is) is er alleen zee.
  waterSoort(x, y) {
    if (this.isWater(x, y)) return 1;
    const tl = this.terrein;
    if (!tl || !tl.basis) return 0;
    if (tl.rivierAfstand(x, y) < 0.1) return 2;
    return tl.isMeer(x, y) ? 3 : 0;
  }

  // Zoet water (rivier of meer) op een punt; voor bomen en lantaarns die er niet in horen.
  isZoet(x, y) { const tl = this.terrein; return !!tl && !!tl.basis && tl.isZoetWater(x, y); }

  // Vakjeshoogte op een punt, bilineair tussen de middens (zelfde regel als het afwateringsrooster in terrein.js).
  hoogte(x, y) {
    const geo = this.geo, t = geo.tegels;
    const u = Math.min(geo.kol - 1.001, Math.max(0, x / geo.T - 0.5)), v = Math.min(geo.rij - 1.001, Math.max(0, y / geo.T - 0.5));
    const k = Math.floor(u), r = Math.floor(v), fu = u - k, fv = v - r, i = r * geo.kol + k;
    const a = t[i].hoogte + (t[i + 1].hoogte - t[i].hoogte) * fu;
    const c = t[i + geo.kol].hoogte + (t[i + geo.kol + 1].hoogte - t[i + geo.kol].hoogte) * fu;
    return a + (c - a) * fv;
  }

  // Punt op afstand q langs een weg (rechte lijn) of spoorlijn (route): this.px, this.py en de richting this.hx, this.hy.
  langs(d, q) {
    if (d.n) { this.punt(d, q); return; }
    this.px = d.ax + d.ux * q; this.py = d.ay + d.uy * q; this.hx = d.ux; this.hy = d.uy;
  }

  // Waar een weg of spoor over water loopt (zee, rivier of meer). Korte droge stukjes ertussen (een eilandje, een
  // kronkel van dezelfde rivier) horen bij dezelfde brug. De breedte van de rivier ter plekke kiest de brugsoort.
  overspanningen(d, s0, s1, spoor) {
    const uit = [], Tw = this.geo.T;
    let in0 = -1, laatst = -1, zee = false, meer = false;
    const sluit = () => {
      const w0 = in0, w1 = laatst + 0.5, lang = w1 - w0;
      const b = { q0: Math.max(s0, w0 - (zee ? 0.8 : 0.7)), q1: Math.min(s1, w1 + (zee ? 0.8 : 0.7)), w0, w1, lang, zee, meer, br: 0, breed: 0, fx: 0, fy: 1, monding: false, soort: LIGGER, zaad: 0 };
      this.langs(d, (w0 + w1) / 2);
      const mx = this.px, my = this.py, hx = this.hx, hy = this.hy;
      b.zaad = (Math.floor(mx * 7) * 131 + Math.floor(my * 7)) | 0;
      if (!zee && !meer) this.rivierBij(mx, my, b);
      // een weg die bijna langs de rivier loopt, steekt hem schuin over: dan telt de breedte dwars op de rivier
      const dwars = Math.abs(hx * b.fy - hy * b.fx);
      b.soort = this.brugSoort(b, spoor, dwars);
      uit.push(b);
      in0 = -1;
    };
    for (let q = s0; q <= s1 + 1e-6; q += 0.5) {
      this.langs(d, q);
      const ws = this.waterSoort(this.px, this.py);
      if (ws) {
        if (in0 < 0) { in0 = q; zee = false; meer = false; }
        laatst = q;
        if (ws === 1) zee = true; else if (ws === 3) meer = true;
      } else if (in0 >= 0 && q - laatst > 1.6) sluit();
    }
    if (in0 >= 0) sluit();
    void Tw;
    return uit.length ? uit : null;
  }

  // Breedte en stroomrichting van de rivier het dichtst bij (x, y), en of dat een monding is.
  rivierBij(x, y, b) {
    const R = this.terrein?.rivieren ?? [];
    let bd = Infinity;
    for (let ri = 0; ri < R.length; ri++) {
      const rv = R[ri], p = rv.pts, m = rv.br.length;
      for (let i = 0; i < m; i++) {
        const d = (p[i * 2] - x) ** 2 + (p[i * 2 + 1] - y) ** 2;
        if (d >= bd) continue;
        bd = d;
        const a = Math.max(0, i - 1), c = Math.min(m - 1, i + 1);
        const dx = p[c * 2] - p[a * 2], dy = p[c * 2 + 1] - p[a * 2 + 1], l = Math.hypot(dx, dy) || 1;
        b.br = rv.br[i]; b.fx = dx / l; b.fy = dy / l;
        b.monding = rv.naarZee && rv.s[m - 1] - rv.s[i] < 14;
      }
    }
  }

  // Brugsoort uit de breedte van het water: een stenen boog over een beek, staal (vakwerk of ligger) over een
  // brede rivier, een stalen boog voor het spoor over de breedste. Tuibruggen en hangbruggen komen pas in
  // bouwWegen, voor de breedste oversteken van de hele wereld.
  brugSoort(b, spoor, dwars) {
    if (b.zee) return spoor ? (b.lang < 6 ? LIGGER : VAKWERK) : b.lang < 7 ? LIGGER : b.lang < 18 ? TUI : HANG;
    if (b.meer) return LIGGER;
    const br = (b.breed = Math.max(b.br, b.lang * dwars * 0.8));
    // langs de rivier: een lange, lage brug op pijlers
    if (b.lang > Math.max(b.br, 1) * 2.6 + 2.5) return LIGGER;
    if (br < BEEK) return BOOG;
    if (spoor) return br >= STAALBOOG_BR ? STAALBOOG : VAKWERK;
    return hash(b.zaad, 3) < 0.5 ? VAKWERK : LIGGER;
  }

  // Hoogteprofiel langs een weg of spoor: tunnels waar hij hoog door de berg gaat, viaducten waar hij een diep dal
  // oversteekt. Uitkomst in d.tunnel en d.viaduct als [q0, q1, ...] en [q0, q1, diepte, ...].
  profiel(d, s0, s1) {
    const Tw = this.geo.T, stap = 1;
    const n = Math.max(2, Math.floor((s1 - s0) / stap) + 1);
    const h = this.profielBuf ??= new Float32Array(2048);
    const m = Math.min(n, h.length);
    for (let i = 0; i < m; i++) { this.langs(d, s0 + i * stap); h[i] = this.hoogte(this.px, this.py); }
    const tunnel = [], viaduct = [];
    // tunnels: een aaneengesloten stuk boven TUNNEL_H van minstens 0.4 tegel, met de monden buiten de gebouwen
    let a = -1;
    for (let i = 0; i <= m; i++) {
      const hoog = i < m && h[i] > TUNNEL_H;
      if (hoog && a < 0) a = i;
      if (!hoog && a >= 0) {
        const q0 = Math.max(s0 + a * stap, s0 + 0.22 * Tw), q1 = Math.min(s0 + (i - 1) * stap, s1 - 0.22 * Tw);
        if (q1 - q0 >= 0.4 * Tw) tunnel.push(q0, q1);
        a = -1;
      }
    }
    // viaducten: waar het pad diep onder de hoogste punten aan weerszijden zakt, in bergland
    const W = Math.round((1.3 * Tw) / stap);
    a = -1;
    let diep = 0;
    for (let i = 0; i <= m; i++) {
      let dal = 0;
      if (i < m) {
        let l = 0, r = 0;
        for (let j = Math.max(0, i - W); j < i; j++) l = Math.max(l, h[j]);
        for (let j = i + 1; j < Math.min(m, i + W + 1); j++) r = Math.max(r, h[j]);
        dal = Math.min(l, r) > 0.5 ? Math.min(l, r) - h[i] : 0;
      }
      if (dal > 0.05) { if (a < 0) { a = i; diep = 0; } diep = Math.max(diep, dal); }
      else if (a >= 0) {
        const q0 = Math.max(s0 + (a - 1) * stap, s0 + 0.15 * Tw), q1 = Math.min(s0 + i * stap, s1 - 0.15 * Tw);
        // niet over zee of een meer: daar blijft de gewone brug
        const nat = d.brug && d.brug.some((b) => (b.zee || b.meer) && q1 > b.q0 && q0 < b.q1);
        if (q1 - q0 >= 0.25 * Tw && !nat && !this.overlapt(tunnel, q0, q1)) viaduct.push(q0, q1, diep);
        a = -1;
      }
    }
    d.tunnel = tunnel.length ? tunnel : null;
    d.viaduct = viaduct.length ? viaduct : null;
    // een rivierbrug midden in een viaduct is het viaduct zelf; in een tunnel ligt geen brug
    if (d.brug) {
      d.brug = d.brug.filter((b) => !this.overlapt(tunnel, b.w0, b.w1) && !this.overlapt3(viaduct, b.w0, b.w1));
      if (!d.brug.length) d.brug = null;
    }
  }

  overlapt(lijst, q0, q1) { for (let i = 0; i < lijst.length; i += 2) if (q1 > lijst[i] && q0 < lijst[i + 1]) return true; return false; }
  overlapt3(lijst, q0, q1) { for (let i = 0; i < lijst.length; i += 3) if (q1 > lijst[i] && q0 < lijst[i + 1]) return true; return false; }

  // Ligt q langs deze weg of dit spoor in een tunnel (dan geen lantaarns, bomen of borden)?
  inTunnel(d, q) { const t = d.tunnel; if (!t) return false; for (let i = 0; i < t.length; i += 2) if (q > t[i] - 0.4 && q < t[i + 1] + 0.4) return true; return false; }

  // Ligt q op een brug of viaduct (dan geen bushalte)?
  opBrug(d, q) {
    const b = d.brug, v = d.viaduct;
    if (b) for (let i = 0; i < b.length; i++) if (q > b[i].q0 - 0.5 && q < b[i].q1 + 0.5) return true;
    if (v) for (let i = 0; i < v.length; i += 3) if (q > v[i] - 0.5 && q < v[i + 1] + 0.5) return true;
    return false;
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

  // ---------- de voorzieningen en het net afleiden (alleen als er iets verandert) ----------

  // Vóór het wegennet en op elke zoom: station, vliegveld, havens, depots, spoorlijnen, hoogspanning, pijpleidingen en
  // de gereserveerde tegels (res, resLand). Daarna wat van het net afhangt (wegen, bruggen, tunnels, overwegen), zodra
  // er een nieuwe versie van het net is. Heeft het kaartbeeld geen wegennet (tests), dan bouwt deze laag er zelf een.
  voorbereid(view) {
    const s = view.state;
    if (!s || !view.geo) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar) this.laad(view);
    if (this.terrein !== (view.terreinLaag ?? null)) { this.terrein = view.terreinLaag ?? null; this.vzSig = ''; this.landSig = []; }
    this.werkCache(view);
    this.volgNet(view);
  }

  werkCache(view) {
    const s = this.state;
    if (!s) return;
    let nP = 0, somT = 0;
    for (let i = 0; i < s.landen.length; i++) {
      const l = s.landen[i];
      nP += l.plaatsingen.length + l.bouw.length * 7;
      for (let j = 0; j < l.plaatsingen.length; j++) somT += l.plaatsingen[j].t;
      for (let j = 0; j < l.bouw.length; j++) somT += l.bouw[j].tegel * 3;
    }
    // zodra de terreinlaag zijn rivieren heeft, komen er bruggen over rivieren en meren bij
    const zoet = this.terrein?.basis ? 1 : 0;
    // de eigenaars per tegel veranderen alleen bij een dagstap of een grenswijziging: niet elk beeld opnieuw hashen
    if (this.eigDag !== s.dag || this.eigGv !== s.grensVersie || this.eigS !== s) {
      let h = 0;
      for (let t = 0; t < s.eigenaar.length; t++) h = (Math.imul(h, 31) + (s.eigenaar[t] ?? -1) + 2) | 0;
      this.eigHash = h; this.eigDag = s.dag; this.eigGv = s.grensVersie; this.eigS = s;
    }
    const eig = this.eigHash;
    // eerst de getallen vergelijken (elk beeld), pas bij een verschil de tekst maken
    const v = this.vzGetal ??= [];
    if (v[0] === s.grensVersie && v[1] === nP && v[2] === somT && v[3] === s.landen.length && v[4] === zoet && v[5] === eig && this.vzSig) return;
    v[0] = s.grensVersie; v[1] = nP; v[2] = somT; v[3] = s.landen.length; v[4] = zoet; v[5] = eig;
    const sig = `${s.grensVersie}|${nP}|${somT}|${s.landen.length}|${zoet}|${eig}`;
    if (sig === this.vzSig) return;
    this.vzSig = sig;
    this.bouwSoorten();
    // Elk land rekent puur uit de toestand: geen herinnering aan de vorige plek, zodat laden en doorspelen hetzelfde
    // geven.
    // de reserveringen hangen van elkaar af (vrije tegels): alles in vaste volgorde opnieuw
    this.res.fill(0); this.resLand.fill(-1);
    for (const land of s.landen) this.perLand[land.idx] = this.bouwLand(view, land);
    const pl = this.perLand.filter(Boolean);
    this.routes = pl.flatMap((x) => x.routes);
    this.stations = pl.flatMap((x) => x.stations);
    this.vliegvelden = pl.flatMap((x) => x.vliegvelden);
    this.havens = pl.flatMap((x) => x.havens);
    this.depots = pl.flatMap((x) => x.depots);
    this.lijnen = pl.flatMap((x) => x.lijnen);
    this.pijpen = pl.flatMap((x) => x.pijpen);
    this.netSleutel = '';
    // De bitmapcache blijft staan: de sleutels beschrijven de bitmap volledig (tegel, stand, seizoen, maat), dus een
    // nieuw gebouw ergens in de wereld hoeft niet alles opnieuw te laten bakken. Wat niet meer gebruikt wordt, valt
    // vanzelf uit de LRU.
  }

  // Het wegennet van dit kaartbeeld, of null zolang het nog gebouwd wordt.
  netVan(view) {
    const n = view.wegennet;
    if (n) return n.klaar ? n : null;
    if (!view.geo || !view.state) return null;
    // geen wegennet in het kaartbeeld (een test): een eigen net op dezelfde toestand
    const eigen = (this.eigenNet ??= new Wegennet());
    if (eigen.geo !== view.geo) eigen.laad(view);
    const tv = { geo: view.geo, state: view.state, eigenaar: view.eigenaar, terreinLaag: view.terreinLaag, infraLaag: this };
    eigen.werk(tv, Infinity);
    return eigen.klaar ? eigen : null;
  }

  // Wat van het net afhangt: de wegen (rechte stukken met bruggen en tunnels), de overwegen met hun dichte vensters,
  // de voetbruggen en de brugvlakken. Alleen opnieuw als het net of de voorzieningen veranderen.
  volgNet(view) {
    const net = this.netVan(view);
    if (this.vnVz === this.vzSig && this.vnNet === net && this.vnVersie === (net ? net.versie : -1) && this.netSleutel) return;
    this.vnVz = this.vzSig; this.vnNet = net; this.vnVersie = net ? net.versie : -1;
    const sleutel = `${this.vzSig}|${net ? net.versie : '-'}|${net === this.eigenNet ? 'e' : 'k'}`;
    if (sleutel === this.netSleutel) return;
    this.netSleutel = sleutel;
    this.net = net;
    this.bouwNetWegen(net);
    this.bouwOverwegen();
    this.bouwVoetbruggen();
    this.bouwVlakken();
    this.sig = sleutel;
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

  // Wegen voor deze laag en voor de oude lezers (hemel, kust, werk, stad): de rechte stukken van net.wegen(), elk met
  // zijn brug (tak over water: tBouw 1 of 2) of tunnel (tBouw 3). Per tak ook waar hij begint en eindigt, voor de
  // tunnelmonden en het straatmeubilair (niet op het kruisvlak).
  bouwNetWegen(net) {
    const W = [];
    this.takStuk = new Map();
    if (net) {
      const lijst = net.wegen(), T = this.geo.T, P = net.punten;
      for (const w0 of lijst) {
        const i = w0.tak, bouw = net.tBouw[i];
        const w = { ...w0, brug: null, tunnel: null, viaduct: null, bouw, kA: -1, kB: -1 };
        const p0 = net.tP0[i], pl = p0 + net.tNP[i] - 1;
        const isA = (x, y, p) => Math.abs(P[p * 2] - x) + Math.abs(P[p * 2 + 1] - y) < 1e-3;
        // ligt een eind van dit stuk op een eind van de tak, dan weten we de knoop daar
        if (isA(w.ax, w.ay, p0)) w.kA = net.tA[i]; else if (isA(w.ax, w.ay, pl)) w.kA = net.tB[i];
        if (isA(w.bx, w.by, pl)) w.kB = net.tB[i]; else if (isA(w.bx, w.by, p0)) w.kB = net.tA[i];
        if (bouw === 1 || bouw === 2) w.brug = this.overspanningen(w, 0, w.len, false);
        if (bouw === 3) w.tunnel = [0, w.len];
        const k = W.length;
        W.push(w);
        const st = this.takStuk.get(i);
        if (st) st[1] = k; else this.takStuk.set(i, [k, k]);
        void T;
      }
    }
    this.wegen = W;
    this.kruisingen = []; // de kruispunten zijn knopen van het net (net.lichten, net.zebras)
    // De breedste rivieroversteken van de wereld (een monding telt zwaarder) krijgen een tuibrug, de allerbreedste
    // een hangbrug.
    const kand = [];
    for (const w of W) if (w.brug) for (const b of w.brug) if (!b.zee && !b.meer && b.soort !== BOOG && b.breed >= BREED && b.lang <= Math.max(b.br, 1) * 2.6 + 2.5) kand.push(b);
    const gewicht = (b) => b.breed + (b.monding ? 1 : 0);
    kand.sort((a, b) => gewicht(b) - gewicht(a) || a.zaad - b.zaad);
    for (let i = 0; i < kand.length && i < 3; i++) kand[i].soort = i === 0 && kand[i].breed >= MONDING ? HANG : TUI;
    // tunnelmonden: aan elk eind van een tunneltak waar een tak zonder tunnel aansluit
    const M = [];
    if (net) for (const [i, [k0, k1]] of this.takStuk) {
      if (net.tBouw[i] !== 3) continue;
      for (const [knoop, stuk, eind] of [[net.tA[i], k0, 0], [net.tB[i], k1, 1]]) {
        let open = false;
        for (let j = net.adj0[knoop]; j < net.adj0[knoop + 1]; j++) { const g = net.adj[j], t = g >= 0 ? g : ~g; if (t !== i && net.tBouw[t] !== 3) open = true; }
        if (!open) continue;
        const w = W[stuk];
        // de mond ligt aan het eind van het stuk dat bij deze knoop hoort
        const opA = w.kA === knoop;
        M.push({ w: stuk, q: opA ? 0 : w.len, rich: opA ? 1 : -1, x: opA ? w.ax : w.bx, y: opA ? w.ay : w.by });
        void eind;
      }
    }
    this.monden = M;
    // Een tunneltak tussen de gebouwen (het stadsrooster op een bergvakje) ligt niet in de berg maar in een bak met
    // een dak: daar tekent tekenWegdek een betonnen overkapping in plaats van kaal terrein tussen de kavels.
    const dak = (this.dakTak = new Uint8Array(net ? net.nT : 0));
    if (net) {
      const o = {}, T = this.geo.T, s = this.state, kol = this.geo.kol, rij = this.geo.rij;
      const bebouwd = (x, y) => { const k = Math.floor(x / T), r = Math.floor(y / T); if (k < 0 || r < 0 || k >= kol || r >= rij) return false; const t = r * kol + k; return !!s.bezet[t] || !!this.res[t]; };
      for (let i = 0; i < net.nT; i++) {
        if (net.tBouw[i] !== 3 || net.tKlasse[i] === KLASSE.OPRIT) continue;
        net.puntIn(net.D, i, net.tLen[i] / 2, o);
        const nx = -Math.sin(o.hoek) * 0.3 * T, ny = Math.cos(o.hoek) * 0.3 * T;
        if (bebouwd(o.x + nx, o.y + ny) || bebouwd(o.x - nx, o.y - ny)) dak[i] = 1;
      }
    }
  }

  vrij(t, land) {
    const s = this.state, tg = this.geo.tegels[t];
    return !!tg && tg.terrein !== 'water' && !s.bezet[t] && !this.res[t] && s.eigenaar[t] === land;
  }

  reserveer(t, soort, land) { this.res[t] = soort; this.resLand[t] = land; }

  // Station, vliegveld, havens, depot, spoorlijnen, hoogspanning en pijpleidingen van één land. Alles volgt uit de
  // toestand van nu (geen geschiedenis): dezelfde toestand geeft altijd dezelfde plekken.
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

    // 1. station zo dicht mogelijk bij de hoofdstad (in een volgebouwde stad aan de rand)
    let st = -1, best = Infinity;
    for (let d = 1; d <= 3 && st < 0; d++) buren(h, d, (t) => { if (!this.vrij(t, L)) return; const k = cheb(t, h) * 2 + terreinKost(t) + hash(t, 11) * 0.5; if (k < best) { best = k; st = t; } });
    if (st >= 0) this.reserveer(st, 1, L);

    // 2. vliegveld: twee vrije, vlakke tegels op twee tot zes tegels van de hoofdstad. Het wegennet rijdt om
    // gereserveerde tegels heen, dus er loopt nooit een weg over de baan. Geen wegtoets, wel water: de baan ligt
    // niet in een meer of rivier, en de eerste tegel (daar zet het net de poort) heeft een droge halve rand aan een
    // van zijn drie buitenzijden, anders kan er geen weg naar de poort.
    const halfDroog = (ax, ay, bx, by) => { for (let i = 0; i <= 10; i++) if (this.natOp(ax + (bx - ax) * i / 10, ay + (by - ay) * i / 10)) return false; return true; };
    const vvKandidaat = (a, staand) => {
      if (cheb(a, h) < 2 || cheb(a, h) > 6 || !this.vrij(a, L) || geo.tegels[a].terrein === 'berg') return null;
      const A = geo.tegels[a], b = staand ? a + kol : a + 1;
      if (staand ? A.r + 1 >= rij : A.k + 1 >= kol) return null;
      if (!this.vrij(b, L) || geo.tegels[b].terrein === 'berg') return null;
      const B = geo.tegels[b];
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      // de hele baan op het droge (ook geen meer of rivier)
      const ux = staand ? 0 : 1, uy = staand ? 1 : 0;
      for (let q = -0.95; q <= 0.95; q += 0.1) for (const w of [-0.45, 0, 0.45]) if (this.natOp(mx + (ux * q - uy * w) * Tw, my + (uy * q + ux * w) * Tw)) return null;
      // een droge halve rand aan een buitenzijde van tegel a (N, O, Z, W; niet de zijde naar b)
      const x0 = A.k * Tw, y0 = A.r * Tw, x1 = x0 + Tw, y1 = y0 + Tw, xm = x0 + Tw / 2, ym = y0 + Tw / 2;
      const zijden = [[x0, y0, xm, y0, x1, y0], [x1, y0, x1, ym, x1, y1], [x0, y1, xm, y1, x1, y1], [x0, y0, x0, ym, x0, y1]];
      let poort = false;
      for (let z = 0; z < 4 && !poort; z++) {
        if ((staand && z === 2) || (!staand && z === 1)) continue;
        const [p0, q0, p1, q1, p2, q2] = zijden[z];
        if (halfDroog(p0, q0, p1, q1) || halfDroog(p1, q1, p2, q2)) poort = true;
      }
      if (!poort) return null;
      const d = Math.hypot(mx - H.x, my - H.y) / Tw;
      return { a, b, staand, mx, my, k: Math.abs(d - 3.5) * 0.6 + terreinKost(a) + terreinKost(b) + hash(a, 13, staand) * 0.4 };
    };
    let vv = null; best = Infinity;
    buren(h, 6, (a) => { for (const staand of [0, 1]) { const k = vvKandidaat(a, staand); if (k && k.k < best) { best = k.k; vv = k; } } });
    if (vv) {
      this.reserveer(vv.a, 2, L); this.reserveer(vv.b, 2, L);
      const zaad = (vv.a * 131 + 7) | 0;
      uit.vliegvelden.push({ a: vv.a, b: vv.b, staand: vv.staand, mx: vv.mx, my: vv.my, hoek: vv.staand ? Math.PI / 2 : 0, land: L, zaad, standen: [-0.42, -0.2, 0.02, 0.24], zak: [0.6, -0.36], liv: Math.floor(hash(zaad, 3) * LIVREI.length) });
    }

    // 3. containerhavens: alleen waar echt zee ligt. Vanuit het tegelmidden zoeken we langs zestien richtingen de
    // eerste zee; daar komt de kade, met droog land erachter en water ervoor over de hele kadelengte. Lukt dat
    // nergens, dan komt er geen terminal (vroeger viel hij terug op een kade midden in het gras).
    const havenPlek = (t) => {
      const T0 = geo.tegels[t];
      if (!T0 || T0.terrein === 'water') return null;
      let beste = null;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU, vx = Math.cos(a), vy = Math.sin(a);
        let dq = -1;
        for (let q = 0.06; q <= 0.6; q += 0.02) if (this.isWater(T0.x + vx * q * Tw, T0.y + vy * q * Tw)) { dq = q - 0.01; break; }
        if (dq < 0.12) continue;
        const hoek = a - Math.PI / 2, co = Math.cos(hoek), si = Math.sin(hoek);
        const opWater = (u, v) => this.isWater(T0.x + (u * co - v * si) * Tw, T0.y + (u * si + v * co) * Tw);
        // kadeterrein (0.42 diep, 0.9 breed) op het droge; voor de kade water over minstens vier van de vijf punten
        let droog = true;
        for (const u of [-0.44, -0.22, 0, 0.22, 0.44]) for (const v of [dq - 0.04, dq - 0.2, dq - 0.4]) if (opWater(u, v)) droog = false;
        if (!droog) continue;
        let nat = 0;
        for (const u of [-0.4, -0.2, 0, 0.2, 0.4]) if (opWater(u, dq + 0.05) && opWater(u, dq + 0.1)) nat++;
        if (nat < 4 || !opWater(0, dq + 0.04)) continue;
        const k = nat * 2 - dq + hash(t, i, 29) * 0.1;
        if (!beste || k > beste.k) beste = { k, hoek, dq, opWater };
      }
      return beste;
    };
    const havenOp = (t, p) => {
      const { hoek, dq, opWater } = p, T0 = geo.tegels[t];
      const schip = [-0.3, -0.1, 0.1, 0.28].every((u) => opWater(u, dq + 0.05) && opWater(u, dq + 0.11));
      const sleep = [-0.3, -0.1, 0.1, 0.3].every((u) => opWater(u, dq + 0.17) && opWater(u, dq + 0.23));
      // past er geen groot schip, dan ligt er misschien een vissersboot aan de kade
      const kotter = !schip && [-0.16, -0.05, 0.05, 0.16].every((u) => opWater(u, dq + 0.05) && opWater(u, dq + 0.08));
      this.reserveer(t, 3, L);
      const zaad = (t * 977 + 5) | 0;
      uit.havens.push({ t, x: T0.x, y: T0.y, hoek, dq, schip, sleep, kotter, zaad, romp: hash(zaad, 2) < 0.5 ? '#2b3440' : '#7a2a24', kraan: KRAAN[Math.floor(hash(zaad, 4) * KRAAN.length)], land: L });
    };
    const kiesHaven = (rond, d, sl) => {
      let t0 = -1, p0 = null, bk = Infinity;
      buren(rond, d, (t) => { if (!this.vrij(t, L)) return; const k = cheb(t, rond) + hash(t, sl) * 0.5; if (k >= bk) return; const p = havenPlek(t); if (p) { bk = k; t0 = t; p0 = p; } });
      if (t0 >= 0) havenOp(t0, p0);
      return t0;
    };
    // een terminal bij de hoofdstad als die aan zee ligt, anders een havenstadje verderop aan de eigen kust
    if (kiesHaven(h, 2, 17) < 0) kiesHaven(h, 5, 17);
    // naast elk eigen havengebouw hooguit één terminal
    for (const p of land.plaatsingen) {
      if (p.t < 0 || this.soort[p.t] !== HAVEN || uit.havens.length >= 3) continue;
      let al = false;
      for (const hv of uit.havens) if (cheb(hv.t, p.t) <= 1) al = true;
      if (!al) kiesHaven(p.t, 1, 19);
    }

    // 4. brandstofdepot naast de eerste haven, anders naast een knooppunt of de hoofdstad; alleen als er centrales zijn
    const centrales = land.plaatsingen.filter((p) => p.t >= 0 && this.soort[p.t] === ENERGIE);
    let dp = -1;
    if (centrales.length) {
      const bij = uit.havens[0]?.t ?? land.plaatsingen.find((p) => p.t >= 0 && this.soort[p.t] === KNOOP)?.t ?? h;
      best = Infinity;
      buren(bij, 2, (t) => { if (!this.vrij(t, L)) return; const k = cheb(t, bij) + terreinKost(t) * 0.5 + hash(t, 23) * 0.3; if (k < best) { best = k; dp = t; } });
      if (dp >= 0) {
        this.reserveer(dp, 4, L);
        const D = geo.tegels[dp], zaad = (dp * 733 + 9) | 0;
        uit.depots.push({ t: dp, x: D.x, y: D.y, zaad, kleur: hash(zaad, 1) < 0.5 ? '#c9c6be' : '#b9bdc1', land: L });
        // pijpleidingen naar centrales en olievelden binnen tien tegels (hooguit vier); niet over zee en niet
        // dwars door een ander gebouw
        const doelen = centrales.filter((p) => cheb(p.t, dp) <= 10 && cheb(p.t, dp) >= 2).slice(0, 4);
        // De leiding loopt over vrije landtegels (geen gebouw, bouwplaats of bouwwerk van deze laag, geen water) van
        // tegelmidden naar tegelmidden, met haakse bochten: de kortste weg in breedte-eerst over de vier buren, hooguit
        // zestien tegels. Lukt dat niet, dan komt er geen leiding.
        const vrijT = (t) => !s.bezet[t] && !this.res[t] && this.soort[t] === LEEG && geo.tegels[t].terrein !== 'water';
        const vorig = new Int32Array(geo.tegels.length);
        const pad = (a, b) => {
          vorig.fill(-2);
          const rij = [a];
          vorig[a] = -1;
          for (let k = 0; k < rij.length; k++) {
            const t = rij[k];
            if (t === b) break;
            const tk = t % kol, tr = (t - tk) / kol;
            for (const [dk, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nk = tk + dk, nr = tr + dr;
              if (nk < 0 || nr < 0 || nk >= kol || nr >= geo.rij) continue;
              const n = nr * kol + nk;
              if (vorig[n] !== -2 || cheb(n, a) > 12) continue;
              if (n !== b && !vrijT(n)) continue;
              vorig[n] = t;
              rij.push(n);
            }
          }
          if (vorig[b] === -2) return null;
          const uitP = [];
          for (let t = b; t !== -1; t = vorig[t]) uitP.push(t);
          return uitP.length <= 17 ? uitP.reverse() : null;
        };
        for (const p of doelen) {
          const P = pad(dp, p.t);
          if (!P || P.length < 3) continue;
          const olie = !!this.olie[p.t];
          // hoekpunten: begin, elke bocht, eind; begin en eind op de rand van depot en centrale
          const hoeken = [P[0]];
          for (let k = 1; k + 1 < P.length; k++) if (P[k] - P[k - 1] !== P[k + 1] - P[k]) hoeken.push(P[k]);
          hoeken.push(P[P.length - 1]);
          for (let k = 0; k + 1 < hoeken.length; k++) {
            const A = geo.tegels[hoeken[k]], B = geo.tegels[hoeken[k + 1]];
            const len = Math.hypot(B.x - A.x, B.y - A.y), ux = (B.x - A.x) / len, uy = (B.y - A.y) / len;
            const a0 = k === 0 ? 0.48 * Tw : 0, b0 = k + 2 === hoeken.length ? 0.48 * Tw : 0;
            uit.pijpen.push({ ax: A.x + ux * a0, ay: A.y + uy * a0, bx: B.x - ux * b0, by: B.y - uy * b0, ux, uy, olie, kopA: k === 0, kopB: k + 2 === hoeken.length, zaad: (p.t * 31 + dp + k * 7) | 0 });
          }
        }
      }
    }

    // 5. spoorlijnen van het station naar de verste steden en industrie (hooguit vier, verspreid gekozen). Spoor
    // gaat nooit over zee: zeetegels zijn verboden en een lijn die na het afronden toch de zee raakt, zoekt opnieuw
    // met die tegels erbij verboden; lukt dat niet, dan vervalt hij.
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
    let as = null;
    if (doelen.length) {
      const verboden = new Set();
      let eerste = null;
      for (let di = 0; di < doelen.length; di++) {
        let r = null;
        for (let poging = 0; poging < 4 && !r; poging++) {
          this.verboden = verboden;
          this.dijkstra(start, L);
          this.verboden = null;
          const pad = [];
          for (let t = doelen[di]; t >= 0 && pad.length < 400; t = this.prev[t]) pad.push(t);
          pad.reverse();
          if (pad[0] !== start || pad.length < 3) break;
          const S = geo.tegels[start], N1 = geo.tegels[pad[1]];
          let a = as;
          if (!a) { const l = Math.hypot(N1.x - S.x, N1.y - S.y) || 1; a = [(N1.x - S.x) / l, (N1.y - S.y) / l]; }
          const kand2 = this.maakRoute(pad, st >= 0, a, uit.routes.length, L, this.soort[doelen[di]] === IND);
          const nat = this.zeeTegels(kand2);
          if (!nat.length) { r = kand2; as = a; break; }
          let nieuw = 0;
          for (const t of nat) if (t !== start && t !== doelen[di] && !verboden.has(t)) { verboden.add(t); nieuw++; }
          if (!nieuw) break;
        }
        if (!r) continue;
        eerste ??= as;
        uit.routes.push(r);
      }
      if (st >= 0 && eerste) {
        const S = geo.tegels[st];
        uit.stations.push({ t: st, x: S.x, y: S.y, hoek: Math.atan2(as[1], as[0]), zaad: (st * 389 + 3) | 0, banen: [-0.15, -0.05, 0.05, 0.15] });
      }
    }
    // geen spoorlijn, dan ook geen station: de tegel weer vrijgeven (anders blijft hij leeg en zonder bomen)
    if (st >= 0 && !uit.stations.length) { this.res[st] = 0; this.resLand[st] = -1; }

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

  // Tegels waar een spoorlijn (na het afronden) de zee raakt, in volgorde langs de lijn.
  zeeTegels(r) {
    const Tw = this.geo.T, kol = this.geo.kol, uit = [];
    for (let i = 0; i + 1 < r.n; i++) for (let q = 0; q < 4; q++) {
      const x = r.x[i] + (r.x[i + 1] - r.x[i]) * q / 4, y = r.y[i] + (r.y[i + 1] - r.y[i]) * q / 4;
      if (!this.isWater(x, y)) continue;
      const t = Math.floor(y / Tw) * kol + Math.floor(x / Tw);
      if (uit[uit.length - 1] !== t) uit.push(t);
    }
    return uit;
  }

  kost(u, land, start) {
    const t = this.geo.tegels[u], s = this.state;
    if (t.terrein === 'water' || this.verboden?.has(u)) return Infinity;
    let c = t.terrein === 'berg' ? 3.2 : t.terrein === 'bos' ? 1.5 : t.terrein === 'kust' ? 1.6 : 1;
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
        // schuin alleen als beide hoektegels droog zijn (anders snijdt de lijn de zee)
        if (dr && dk && (geo.tegels[tr * kol + k].terrein === 'water' || geo.tegels[r * kol + tk].terrein === 'water')) continue;
        const c = this.kost(u, land, start);
        if (c === Infinity) continue;
        const nd = D[t] + c * (dr && dk ? 1.414 : 1);
        if (nd < D[u]) { D[u] = nd; PR[u] = t; if (hn < MAXH) push(u, nd); }
      }
    }
  }

  // Tegelpad → vloeiende spoorlijn. Bij een station begint hij op een vaste baan langs de perrons.
  maakRoute(pad, station, as, nr, land, goederen) {
    const geo = this.geo, Tw = geo.T;
    const pts = [];
    const S = geo.tegels[pad[0]];
    let perron = null;
    if (station) {
      const baan = [-0.15, 0.05, 0.15, -0.05][nr % 4] * Tw, nx = -as[1], ny = as[0];
      const N1 = geo.tegels[pad[1]];
      const sg = (N1.x - S.x) * as[0] + (N1.y - S.y) * as[1] >= 0 ? 1 : -1;
      // voor de reizigers: het perron naast deze baan (dwars op het spoor, in de richting van de route gemeten) en waar
      // ze het perron af gaan: aan de kant van het stationsgebouw recht het gebouw in, aan de overkant via de loopbrug
      const pv = (baan > 0 ? 0.1 : -0.1) * Tw;
      perron = { dw: sg * (pv - baan), uitDw: pv > 0 ? sg * (0.21 * Tw - baan) : sg * (pv - baan), uitS: pv > 0 ? -1 : (0.42 + 0.3 * sg) * Tw };
      pts.push(S.x - as[0] * 0.42 * Tw * sg + nx * baan, S.y - as[1] * 0.42 * Tw * sg + ny * baan);
      pts.push(S.x + as[0] * 0.48 * Tw * sg + nx * baan, S.y + as[1] * 0.48 * Tw * sg + ny * baan);
    } else pts.push(S.x, S.y);
    for (let i = 1; i < pad.length; i++) { const t = geo.tegels[pad[i]]; pts.push(t.x, t.y); }
    // aan de verre kant houdt het spoor op aan de rand van het doelgebouw, bij een kopperron met een stootblok (zie
    // tekenKopperrons): daar staat de trein naast het gebouw en niet eronder
    {
      const k = pts.length, ex = pts[k - 2], ey = pts[k - 1], dx = ex - pts[k - 4], dy = ey - pts[k - 3], l = Math.hypot(dx, dy) || 1;
      const d = (0.4 * Tw) / Math.max(Math.abs(dx / l), Math.abs(dy / l));
      if (l > d + 0.2 * Tw) { pts[k - 2] = ex - (dx / l) * d; pts[k - 1] = ey - (dy / l) * d; }
    }
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
    const r = { x: X, y: Y, nx: NX, ny: NY, s: Sd, n, L, x0, y0, x1, y1, land, zaad, goederen, brug: null, beton: hash(zaad, 5) < 0.5, elektrisch: !goederen || hash(zaad, 6) < 0.6, perron, kopKant: hash(zaad, 15) < 0.5 ? 1 : -1 };
    // bruggen, tunnels en viaducten (zie bouwWegen)
    r.brug = this.overspanningen(r, 0, L, true);
    this.profiel(r, 0, L);
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

  // Overwegen: waar een spoorlijn een tak van het net gelijkvloers kruist (niet in een tunnel, niet waar het spoor
  // over een brug of door een tunnel gaat, niet op een oprit). Per overweg de vensters in u (s binnen [0, 180))
  // waarin hij dicht is: elke passage van elke trein op die lijn, met VENSTER_MARGE ervoor en erna.
  bouwOverwegen() {
    const Tw = this.geo.T, O = [], net = this.net, W = this.wegen;
    for (let ri = 0; ri < this.routes.length && O.length < 150; ri++) {
      const r = this.routes[ri];
      for (let wi = 0; wi < W.length && O.length < 150; wi++) {
        const w = W[wi];
        if (w.tunnel || w.x1 < r.x0 || w.x0 > r.x1 || w.y1 < r.y0 || w.y0 > r.y1) continue;
        for (let i = 0; i + 1 < r.n; i++) {
          const ax = r.x[i], ay = r.y[i], dx = r.x[i + 1] - ax, dy = r.y[i + 1] - ay;
          const sl = Math.hypot(dx, dy);
          if (sl < 1e-6) continue;
          const hx = dx / sl, hy = dy / sl;
          const den = hx * w.uy - hy * w.ux;
          if (Math.abs(den) < 0.2) continue;
          const ex = w.ax - ax, ey = w.ay - ay;
          const t = (ex * w.uy - ey * w.ux) / den, q = (ex * hy - ey * hx) / den;
          if (t < 0 || t >= sl || q < 0 || q > w.len) continue;
          const x = ax + hx * t, y = ay + hy * t, sr = r.s[i] + t;
          if (this.isWater(x, y) || this.opBrug(r, sr) || this.inTunnel(r, sr) || this.opBrug(w, q)) continue;
          if (O.some((o) => o.route === ri && Math.abs(o.x - x) + Math.abs(o.y - y) < 0.3 * Tw)) continue;
          const tak = w.tak, s = net ? net.projecteer(net.D, tak, x, y) : q;
          O.push({ tak, s, x, y, route: ri, r: ri, sr, ux: w.ux, uy: w.uy, hx, hy, w: wi, q, klasse: w.klasse, dicht: this.vensters(r, sr) });
        }
      }
    }
    this.overwegen = O;
  }

  // Dicht-vensters van een overweg op afstand sr langs route r: [van, tot, ...] in u, oplopend, binnen [0, 180).
  // Bemonsterd per 0,1 s (de treinen zijn periodiek binnen 180 s): dicht zodra een deel van een trein binnen 0,3 tegel
  // van de overweg is, plus VENSTER_MARGE aan beide kanten.
  vensters(r, sr) {
    const Tw = this.geo.T, N = 1800, st = DAG / N, aan = new Uint8Array(N);
    for (let j = 0; j < r.treinen.length; j++) for (let k = 0; k < N; k++) {
      this.treinStand(r, j, k * st);
      const lo = Math.min(this.kop, this.staart) - 0.3 * Tw, hi = Math.max(this.kop, this.staart) + 0.3 * Tw;
      if (sr >= lo && sr <= hi) aan[k] = 1;
    }
    // uitzetten met de marge (rond: het venster van een passage vlak voor 180 loopt door na 0)
    const m = Math.ceil(VENSTER_MARGE / st), uit = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (aan[k]) for (let d = -m; d <= m; d++) uit[(k + d + N) % N] = 1;
    const v = [];
    for (let k = 0; k < N; k++) if (uit[k] && !uit[(k - 1 + N) % N]) {
      let e = k;
      while (uit[(e + 1) % N] && e - k < N) e++;
      const a = k * st, b = (e + 1) * st;
      if (b <= DAG) v.push(a, b); else v.push(a, DAG, 0, b - DAG);
    }
    if (!v.length && uit[0]) v.push(0, DAG);
    // oplopend op begin
    const paren = [];
    for (let i = 0; i < v.length; i += 2) paren.push([v[i], v[i + 1]]);
    paren.sort((p, q) => p[0] - q[0]);
    return Float32Array.from(paren.flat());
  }

  // Slagboom van overweg o op u: 1 dicht, 0 open. Precies binnen een venster dicht; ervoor zakt hij in BOOM_TIJD, erna
  // gaat hij in BOOM_TIJD omhoog. Tussen twee vensters die minder dan twee keer BOOM_TIJD uit elkaar liggen gaat hij niet
  // helemaal open.
  boomStand(o, u) {
    const v = o.dicht;
    if (!v || !v.length) return 0;
    let tot = Infinity;
    for (let i = 0; i < v.length; i += 2) {
      if (u >= v[i] && u < v[i + 1]) return 1;
      tot = Math.min(tot, ((v[i] - u) % DAG + DAG) % DAG, ((u - v[i + 1]) % DAG + DAG) % DAG);
    }
    // net buiten het venster (ook precies op het eind) is hij al aan het opengaan: nooit 1
    return tot < BOOM_TIJD ? Math.min(0.999, 1 - tot / BOOM_TIJD) : 0;
  }

  // Knipperen de rode lichten op u? Vanaf KNIPPER_VOOR voor het venster tot het eind ervan.
  knippert(o, u) {
    const v = o.dicht;
    if (!v) return false;
    for (let i = 0; i < v.length; i += 2) {
      if (u >= v[i] && u < v[i + 1]) return true;
      const voor = ((v[i] - u) % DAG + DAG) % DAG;
      if (voor < KNIPPER_VOOR) return true;
    }
    return false;
  }

  // Voetgangersbruggetjes waar een rivier langs een woonwijk of de hoofdstad loopt: hooguit één per stadstegel,
  // dwars op de stroom, met beide landhoofden op het droge en niet vlak bij een gewone brug.
  bouwVoetbruggen() {
    const R = this.terrein?.rivieren ?? [], geo = this.geo, Tw = geo.T, kol = geo.kol, rij = geo.rij, s = this.state;
    const uit = [], gehad = new Set(), andere = [];
    for (const w of this.wegen) if (w.brug) for (const b of w.brug) { const q = (b.w0 + b.w1) / 2; andere.push(w.ax + w.ux * q, w.ay + w.uy * q); }
    for (const r of this.routes) if (r.brug) for (const b of r.brug) { this.punt(r, (b.w0 + b.w1) / 2); andere.push(this.px, this.py); }
    const stadBij = (t) => {
      const k0 = t % kol, r0 = (t - k0) / kol;
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
        const k = k0 + dk, r = r0 + dr;
        if (k < 0 || r < 0 || k >= kol || r >= rij) continue;
        const u = r * kol + k;
        if (this.soort[u] === STAD || this.soort[u] === HOOFD) return u;
      }
      return -1;
    };
    for (let ri = 0; ri < R.length && uit.length < 24; ri++) {
      const rv = R[ri], p = rv.pts, m = rv.br.length;
      if (!rv.open) continue;
      for (let i = 2; i < m - 2 && uit.length < 24; i += 3) {
        if (!rv.open[i] || rv.br[i] < 0.9 || rv.br[i] > BREED || hash(ri, i, 307) > 0.4) continue;
        const x = p[i * 2], y = p[i * 2 + 1], t = Math.floor(y / Tw) * kol + Math.floor(x / Tw);
        if (!geo.tegels[t] || geo.tegels[t].terrein === 'water' || s.bezet[t] || this.res[t]) continue;
        const st = stadBij(t);
        if (st < 0 || gehad.has(st)) continue;
        const dx = p[i * 2 + 2] - p[i * 2 - 2], dy = p[i * 2 + 3] - p[i * 2 - 1], l = Math.hypot(dx, dy) || 1;
        const fx = dx / l, fy = dy / l, nx = -fy, ny = fx, half = rv.br[i] / 2 + 0.75;
        if (this.waterSoort(x + nx * half, y + ny * half) || this.waterSoort(x - nx * half, y - ny * half)) continue;
        let vrij = true;
        for (let j = 0; j < andere.length && vrij; j += 2) if (Math.abs(andere[j] - x) + Math.abs(andere[j + 1] - y) < 0.7 * Tw) vrij = false;
        if (!vrij) continue;
        gehad.add(st);
        andere.push(x, y);
        uit.push({ x, y, fx, fy, half, br: rv.br[i], zaad: (ri * 1009 + i) | 0, x0: x - half, y0: y - half, x1: x + half, y1: y + half });
      }
    }
    this.voetbruggen = uit;
  }

  // Alle bruggen als rechthoeken in de wereld, voor lagen die eronderdoor varen (de binnenvaart in kust.js knipt
  // zijn schepen daar weg). Een gebogen spoorbrug wordt een reeks korte rechthoeken.
  bouwVlakken() {
    const Tw = this.geo.T, v = [];
    for (const w of this.wegen) if (w.brug) for (const b of w.brug) v.push(w.ax + w.ux * b.q0, w.ay + w.uy * b.q0, w.ax + w.ux * b.q1, w.ay + w.uy * b.q1, 0.1 * Tw);
    for (const r of this.routes) {
      if (!r.brug) continue;
      for (const b of r.brug) {
        const n = Math.max(1, Math.ceil((b.q1 - b.q0) / (0.4 * Tw)));
        this.punt(r, b.q0);
        let ax = this.px, ay = this.py;
        for (let i = 1; i <= n; i++) {
          this.punt(r, b.q0 + ((b.q1 - b.q0) * i) / n);
          v.push(ax, ay, this.px, this.py, 0.09 * Tw);
          ax = this.px; ay = this.py;
        }
      }
    }
    for (const f of this.voetbruggen) v.push(f.x + f.fy * f.half, f.y - f.fx * f.half, f.x - f.fy * f.half, f.y + f.fx * f.half, 0.045 * Tw);
    this.vlak = Float32Array.from(v);
    this.nVlak = v.length / 5;
  }

  // Bruggen als rechthoeken (ax, ay, bx, by, halve breedte; wereldeenheden), alleen-lezen voor andere lagen.
  brugVlakken() { return { data: this.vlak, n: this.nVlak }; }

  // Wegwerk hoort bij het net en de ritten; deze laag zet er geen meer. Blijft bestaan voor oude lezers (leven.js).
  werkOp() { return false; }

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

  // Spiegeling van een licht in de natte weg (alleen als het regent): een lange, zwakke streep naar beneden.
  zetSpiegel(x, y, r, soort, a) {
    if (this.nat < 0.03) return;
    const voor = this.nLicht;
    this.zetLicht(x, y + r, r * 2, soort + SPIEGEL, a * this.nat);
    if (this.nLicht > voor) this.n.spiegels++;
  }

  // Tussen de wegen en de gebouwen: alles wat op de grond ligt of rijdt.
  teken(c, view, sc, nu, dt = 0, tempo = 0) {
    void dt; void tempo;
    this.nul();
    const s = view.state;
    if (!s || !view.geo || !view.w) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar) this.laad(view);
    if (this.terrein !== (view.terreinLaag ?? null)) { this.terrein = view.terreinLaag ?? null; this.vzSig = ''; }
    this.view = view;
    // één klok voor treinen, lichten, slagbomen en havens: u = verkeersTijd(nu), periodiek in 180 s
    this.nu = nu;
    this.u = verkeersTijd(this.nu);
    const z = view.zoom;
    this.zoom = z;
    // station, haven, vliegveld en depot verschijnen al vanaf zoom 2,5, net als de verkleinde gebouwen van map.js
    if (z < 2.5) return;
    this.voorbereid(view);
    this.kader(view, sc);
    this.sz = seizoen(s.dag);
    this.wr = weer(s.dag, view.cx, view.cy);
    this.wd = wind(s.dag);
    this.sn = this.sz.sneeuw > 0.66 ? 2 : this.sz.sneeuw > 0.25 ? 1 : 0;
    this.gs = this.sz.winter > 0.5 ? 2 : this.sz.herfst > 0.5 ? 1 : 0;
    this.nacht = view.nacht ?? 0;
    const aS = smooth(2.5, 3, z);
    if (z < DREMPEL.spoor - 0.4) { this.nZw = 0; this.nZr = 0; this.n.sporen = 0; c.save(); this.tekenSprites(c, aS); c.restore(); return; }
    // natte weg: hoe sterk lichten erin spiegelen (alleen dichtbij, waar je de lampen ziet)
    this.nat = z >= DREMPEL.markering ? smooth(0.2, 0.45, this.wr.regen) : 0;
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
    this.lampen.length = 0;
    // pijpleidingen eerst: waar een leiding een weg kruist, gaat hij eronderdoor (het wegdek dekt hem af)
    if (z >= DREMPEL.pijp) this.tekenPijpen(c, smooth(4.5, 5.5, z));
    if (this.net) this.tekenWegdek(c, smooth(DREMPEL.wegdek, DREMPEL.wegdek + 0.8, z));
    this.tekenBruggen(c, a);
    this.tekenSporen(c, a);
    if (z >= 6) this.tekenOverwegen(c);
    if (this.net && z >= 6) this.tekenWegmeubilair(c, smooth(6, 6.8, z));
    // Station, haven, vliegveld en depot pas na het wegdetail: loopt een weg van tekenWegen onder zo'n bouwwerk
    // door, dan dekt de bitmap de weg al af en moeten stoepranden, strepen en lantaarns daar ook verdwijnen.
    this.tekenSprites(c, Math.max(a, aS));
    if (z >= DREMPEL.halte - 0.5) this.tekenKopperrons(c, smooth(DREMPEL.halte - 0.5, DREMPEL.halte + 0.5, z));
    this.tekenTreinen(c, a);
    if (z >= DREMPEL.halte) this.tekenReizigers(c, smooth(DREMPEL.halte, DREMPEL.halte + 1, z));
    this.tekenHavenLeven(c, a);
    this.tekenVliegvelden(c, a, nu);
    if (z >= DREMPEL.bovenleiding - 0.5) this.tekenBovenleiding(c, nu);
    // tunnels na sporen, treinen en bovenleiding: wat in de berg rijdt, verdwijnt onder het teruggelegde terrein. Dat
    // terrein komt even sterk op als spoor en treinen zelf (a), anders schemeren ze bij zoom 4-5 door de berg; de
    // monden komen later op
    this.tekenTunnels(c, a, smooth(4.1, 4.9, z));
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

  // ---------- bruggen, viaducten en tunnels ----------

  // Dekpunt op afstand q langs een weg of spoor, verschoven over `off` pixels langs de normaal: this.ex, this.ey.
  dek(d, q, off) {
    this.langs(d, q);
    this.ex = this.px * this.sc + this.ox - this.hy * off;
    this.ey = this.py * this.sc + this.oy + this.hx * off;
  }

  // Monsterpunten langs een brug (scherm): x, y, normaal nx, ny en q, met per punt de dekhoogte boven het water in
  // this.hs (pixels; loopt naar nul bij de landhoofden). Dicht bij de landhoofden (waar het dek oploopt), daartussen
  // bij een weg (recht) hooguit acht stukken, bij spoor elk hoekpunt van de route met de normaal die de rails daar
  // ook hebben (zie deel): zo blijven rails en treinen in een lange bocht binnen het dek en onder de tunnelstrook.
  monsters(d, q0, q1, w0, w1, H) {
    const b = this.bp, hs = this.hs ??= new Float32Array(MAX_BP), qs = this.qs ??= new Float32Array(MAX_BP), sc = this.sc;
    const S = d.n ? d.s : null;
    this.nq = 0;
    if (S) {
      // eerste hoekpunt voorbij q0; zijn het er te veel voor de buffer, dan om de zoveel
      let lo = 0, hi = d.n - 1;
      while (lo < hi) { const md = (lo + hi) >> 1; if (S[md] <= q0) lo = md + 1; else hi = md; }
      let tel = 0;
      for (let i = lo; i < d.n - 1 && S[i] < q1; i++) tel++;
      this.hk = lo; this.hkStap = Math.max(1, Math.ceil(tel / (MAX_BP - 8)));
    }
    this.zetQ(q0, q0, q1);
    this.zetHoeken(d, w0 + 0.1, q0, q1); this.zetQ(w0 + 0.1, q0, q1);
    this.zetHoeken(d, w0 + 0.7, q0, q1); this.zetQ(w0 + 0.7, q0, q1);
    const m0 = w0 + 0.7, m1 = w1 - 0.7;
    // een wegstuk is recht en het dek ligt tussen m0 en m1 op volle hoogte: daar zijn geen tussenpunten nodig
    this.zetHoeken(d, w1 - 0.7, q0, q1); this.zetQ(w1 - 0.7, q0, q1);
    this.zetHoeken(d, w1 - 0.1, q0, q1); this.zetQ(w1 - 0.1, q0, q1);
    this.zetHoeken(d, q1, q0, q1);
    // het eindpunt altijd, desnoods in plaats van een te dichte voorganger
    if (this.nq > 1 && q1 - qs[this.nq - 1] <= 0.3) qs[this.nq - 1] = q1; else if (this.nq < MAX_BP) qs[this.nq++] = q1;
    const n = this.nq;
    for (let i = 0; i < n; i++) {
      const q = qs[i], o = i * 5;
      this.langs(d, q);
      let nx = -this.hy, ny = this.hx;
      if (S && this.pi > 0 && this.pi < d.n - 1 && q === S[this.pi]) { nx = d.nx[this.pi]; ny = d.ny[this.pi]; }
      b[o] = this.px * sc + this.ox; b[o + 1] = this.py * sc + this.oy; b[o + 2] = nx; b[o + 3] = ny; b[o + 4] = q;
      hs[i] = H * smooth(w0 - 0.5, w0 + 0.7, q) * (1 - smooth(w1 - 0.7, w1 + 0.5, q));
    }
    return n;
  }

  // Hoekpunten van spoorroute d tot q als monsterpunt (zie monsters).
  zetHoeken(d, q, q0, q1) {
    if (!d.n) return;
    const S = d.s;
    for (; this.hk < d.n - 1 && S[this.hk] < q && S[this.hk] < q1; this.hk += this.hkStap) this.zetQ(S[this.hk], q0, q1);
  }

  // Voeg q toe aan de monsterlijst als hij binnen de brug en voorbij het vorige punt ligt (oplopend, 0,3 uit elkaar).
  zetQ(q, q0, q1) {
    const n = this.nq;
    if (n >= MAX_BP - 1 || q < q0 || q >= q1 || (n && q - this.qs[n - 1] <= 0.3)) return;
    this.qs[this.nq++] = q;
  }

  // Pad langs de monsterpunten op `off` pixels van de as; dy0 en dyH verschuiven omlaag (vast en maal dekhoogte),
  // dxH naar rechts (maal dekhoogte): zo komen gevels en schaduwen uit dezelfde punten. terug: van achter naar voren.
  bpLijn(c, n, off, dx, dy0, dxH, dyH, terug, verder) {
    const b = this.bp, hs = this.hs;
    for (let j = 0; j < n; j++) {
      const i = terug ? n - 1 - j : j, o = i * 5, h = hs[i];
      const x = b[o] + b[o + 2] * off + dx + dxH * h, y = b[o + 1] + b[o + 3] * off + dy0 + dyH * h;
      if (j === 0 && !verder) c.moveTo(x, y); else c.lineTo(x, y);
    }
  }

  // Strook van -hb tot +hb rond de as, als gesloten vorm (voor dek en schaduw).
  bpStrook(c, n, hb, dx, dy0, dxH, dyH) {
    this.bpLijn(c, n, -hb, dx, dy0, dxH, dyH, false, false);
    this.bpLijn(c, n, hb, dx, dy0, dxH, dyH, true, true);
    c.closePath();
  }

  // Dekhoogte (pixels) op afstand q, voor punten tussen de monsters (pijlers, bogen, kabels).
  dekHoogte(b, q, H) { return H * smooth(b.w0 - 0.5, b.w0 + 0.7, q) * (1 - smooth(b.w1 - 0.7, b.w1 + 0.5, q)); }

  brugInBeeld(d, q0, q1, m) {
    this.langs(d, q0); const ax = this.px, ay = this.py;
    this.langs(d, q1);
    return this.inBeeld(Math.min(ax, this.px), Math.min(ay, this.py), Math.max(ax, this.px), Math.max(ay, this.py), m);
  }

  tekenBruggen(c, a) {
    const Tw = this.geo.T, z = this.zoom;
    let nb = 0, nv = 0;
    c.globalAlpha = a;
    // spoorbruggen; de sporen en treinen komen er daarna overheen (tekenSporen)
    for (let i = 0; i < this.nZr; i++) {
      const r = this.routes[this.zr[i]];
      if (r.brug) for (const b of r.brug) if (nb < PLAFOND.bruggen && this.brugInBeeld(r, b.q0, b.q1, Tw * 0.6)) { this.brug(c, r, b, true); nb++; }
      if (r.viaduct && z >= DREMPEL.tunnel - 0.4) for (let k = 0; k < r.viaduct.length; k += 3) if (nv < PLAFOND.viaducten && this.brugInBeeld(r, r.viaduct[k], r.viaduct[k + 1], Tw * 0.6)) { this.viaduct(c, r, r.viaduct[k], r.viaduct[k + 1], r.viaduct[k + 2], true); nv++; }
    }
    // wegbruggen: de weg van tekenWegen ligt al getekend (met de vrachtwagens erop) en blijft zichtbaar; wat onder
    // het dek hoort, wordt buiten die strook geknipt
    for (let i = 0; i < this.nZw; i++) {
      const w = this.wegen[this.zw[i]];
      if (w.brug) for (const b of w.brug) if (nb < PLAFOND.bruggen && this.brugInBeeld(w, b.q0, b.q1, Tw * 0.6)) { this.brug(c, w, b, false); nb++; }
      if (w.viaduct && z >= DREMPEL.tunnel - 0.4) for (let k = 0; k < w.viaduct.length; k += 3) if (nv < PLAFOND.viaducten && this.brugInBeeld(w, w.viaduct[k], w.viaduct[k + 1], Tw * 0.6)) { this.viaduct(c, w, w.viaduct[k], w.viaduct[k + 1], w.viaduct[k + 2], false); nv++; }
    }
    this.n.bruggen = nb;
    this.n.viaducten = nv;
    if (z >= DREMPEL.voetbrug - 0.5) this.tekenVoetbruggen(c, a * smooth(DREMPEL.voetbrug - 0.5, DREMPEL.voetbrug + 0.3, z));
    c.globalAlpha = 1;
  }

  // Knip de strook van een weg weg (alles wat nu komt, ligt onder het wegdek).
  knipWeg(c, d, q0, q1) {
    const T = this.T, hb = Math.max(1, T * 0.08);
    this.dek(d, q0, hb); const ax = this.ex, ay = this.ey;
    this.dek(d, q1, hb); const bx = this.ex, by = this.ey;
    this.dek(d, q1, -hb); const cx = this.ex, cy = this.ey;
    this.dek(d, q0, -hb);
    c.save();
    c.beginPath(); c.rect(-T, -T, this.w + 2 * T, this.h + 2 * T);
    c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(cx, cy); c.lineTo(this.ex, this.ey); c.closePath();
    c.clip('evenodd');
  }

  // Eén brug: schaduw op het water, pijlers, gevel aan de kant van de kijker, dek met leuningen en de bovenbouw
  // van zijn soort (vakwerk, pylonen met tuien, torens met draagkabels, stalen boog). Hoge delen staan schuin omhoog
  // en werpen hun schaduw naar het zuidoosten, zoals de rest van de kaart.
  brug(c, d, b, spoor) {
    const T = this.T, z = this.zoom, Tw = this.geo.T, S = SCHUIN;
    const grof = z < DREMPEL.brugtype - 0.5;
    const soort = grof && b.soort !== BOOG ? LIGGER : b.soort;
    const hb = (spoor ? 0.075 : 0.095) * T;
    const H = T * (soort === BOOG ? 0.05 : soort === HANG ? 0.085 : soort === TUI ? 0.075 : 0.055) * (b.zee ? 1.3 : 1);
    const n = this.monsters(d, b.q0, b.q1, b.w0, b.w1, H), bp = this.bp;
    const m = n >> 1, zuid = bp[m * 5 + 3] >= 0 ? 1 : -1; // de dekrand aan de kant van de kijker
    const staal = BRUGSTAAL[Math.floor(hash(b.zaad, 7) * BRUGSTAAL.length)];
    if (!spoor) this.knipWeg(c, d, b.q0, b.q1);
    // schaduw van dek en gevel op het water (de grond onder het dek ligt een dekhoogte lager in beeld)
    c.fillStyle = 'rgba(0,0,0,0.26)'; c.beginPath(); this.bpStrook(c, n, hb, T * 0.006, T * 0.006, S, 1 + S); c.fill();
    // onder het dek: beschaduwd water, met de pijlers
    if (soort !== BOOG) {
      c.fillStyle = 'rgba(8,20,26,0.4)'; c.beginPath();
      this.bpLijn(c, n, zuid * hb, 0, 0, 0, 0, false, false); this.bpLijn(c, n, zuid * hb, 0, 0, 0, 1, true, true); c.closePath(); c.fill();
      if (z >= 6 || b.zee) this.pijlers(c, d, b, soort, H, hb, zuid);
    }
    // gevel aan de kant van de kijker: stenen bogen of een stalen of betonnen ligger
    const gd = soort === BOOG ? 1 : soort === VAKWERK || soort === STAALBOOG ? 0.22 : 0.32;
    c.fillStyle = soort === BOOG ? STEEN_D : soort === VAKWERK || soort === STAALBOOG ? '#55595c' : '#8a857b';
    c.beginPath(); this.bpLijn(c, n, zuid * hb, 0, 0, 0, 0, false, false); this.bpLijn(c, n, zuid * hb, 0, 0, 0, gd, true, true); c.closePath(); c.fill();
    if (soort === BOOG) this.bogen(c, d, b, H, hb * zuid);
    // het dek: onder het spoor een eigen bed, naast de weg alleen de randen (de weg zelf is weggeknipt)
    c.fillStyle = soort === BOOG ? STEEN : spoor ? '#86827a' : '#8f8b83'; c.beginPath(); this.bpStrook(c, n, hb, 0, 0, 0, 0); c.fill();
    if (!spoor) c.restore();
    // leuningen of borstweringen op beide randen, met sneeuw erop in de winter
    c.strokeStyle = soort === BOOG ? STEEN_L : spoor ? '#a19d94' : '#b4b0a7'; c.lineWidth = Math.max(0.6, T * (soort === BOOG ? 0.012 : 0.008));
    c.beginPath(); this.bpLijn(c, n, hb, 0, 0, 0, 0, false, false); this.bpLijn(c, n, -hb, 0, 0, 0, 0, false, false); c.stroke();
    if (this.sn) { c.strokeStyle = 'rgba(244,246,248,0.85)'; c.lineWidth = Math.max(0.5, T * 0.005); c.beginPath(); this.bpLijn(c, n, hb, 0, -T * 0.002, 0, 0, false, false); this.bpLijn(c, n, -hb, 0, -T * 0.002, 0, 0, false, false); c.stroke(); }
    if (z >= DREMPEL.lantaarn && soort !== BOOG) {
      // leuningpaaltjes
      c.fillStyle = '#d6d3cb'; c.beginPath();
      for (let q = b.q0; q < b.q1; q += Tw * 0.06) for (let o = -hb; o <= hb; o += 2 * hb) { this.dek(d, q, o); if (this.opScherm(this.ex, this.ey, 4)) stip(c, this.ex, this.ey, T * 0.004); }
      c.fill();
    }
    // bovenbouw
    if (soort === VAKWERK) this.vakwerkBrug(c, d, b, H, hb, zuid, staal);
    else if (soort === TUI) this.tuiBrug(c, d, b, H, hb, zuid);
    else if (soort === HANG) this.hangBrug(c, d, b, H, hb, zuid, staal);
    else if (soort === STAALBOOG) this.staalBoog(c, d, b, H, hb, zuid, staal);
    else if (soort === BOOG && z >= DREMPEL.markering + 2) {
      // voegen in de borstwering (pas van dichtbij: het net heeft veel bruggetjes over beken)
      c.strokeStyle = 'rgba(60,50,40,0.35)'; c.lineWidth = Math.max(0.4, T * 0.0015); c.beginPath();
      for (let q = b.q0 + 0.3; q < b.q1; q += 0.6) for (let o = -hb; o <= hb; o += 2 * hb) { this.dek(d, q, o * 0.92); const x = this.ex, y = this.ey; if (!this.opScherm(x, y, 4)) continue; this.dek(d, q, o * 1.08); c.moveTo(x, y); c.lineTo(this.ex, this.ey); }
      c.stroke();
    }
  }

  // Pijlers in het water: een ronde kop tegen de stroom in, schaduw naar het zuidoosten en een schuimkraag.
  pijlers(c, d, b, soort, H, hb, zuid) {
    const T = this.T, Tw = this.geo.T, z = this.zoom;
    const af = soort === LIGGER ? 3 : soort === VAKWERK ? Math.max(4, Tw * 0.45) : 1e9;
    const pos = this.pijlerPos ??= new Float32Array(64 * 3);
    this.np = 0;
    const off = zuid * hb * 0.6;
    if (soort === TUI) { if (b.lang < 14) this.pijlerOp(d, b, (b.w0 + b.w1) / 2, off, H); else { this.pijlerOp(d, b, b.w0 + b.lang * 0.33, off, H); this.pijlerOp(d, b, b.w1 - b.lang * 0.33, off, H); } }
    else if (soort === HANG) { this.pijlerOp(d, b, b.w0 + b.lang * 0.18, off, H); this.pijlerOp(d, b, b.w1 - b.lang * 0.18, off, H); }
    else { const k = Math.max(1, Math.round(b.lang / af)); for (let i = 1; i < k; i++) this.pijlerOp(d, b, b.w0 + (b.lang * i) / k, off, H); }
    const np = this.np;
    if (!np) return;
    const fx = b.zee ? -this.hy : b.fx, fy = b.zee ? this.hx : b.fy, hk = Math.atan2(fy, fx), ch = Math.cos(hk), sh = Math.sin(hk);
    const rw = T * (soort === TUI || soort === HANG ? 0.03 : 0.02), rl = rw * 1.8;
    // schaduw, schacht (licht links, donker rechts), voet in het water
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath();
    for (let i = 0; i < np; i++) { const o = i * 3, x = pos[o] + pos[o + 2] * SCHUIN, y = pos[o + 1] + pos[o + 2] * (1 + SCHUIN); c.moveTo(x + rl * ch, y + rl * sh); c.ellipse(x, y, rl, rw, hk, 0, TAU); }
    c.fill();
    c.fillStyle = '#7f7a71'; c.beginPath();
    for (let i = 0; i < np; i++) { const o = i * 3; c.rect(pos[o] - rw * 0.8, pos[o + 1], rw * 1.6, pos[o + 2]); }
    c.fill();
    c.fillStyle = 'rgba(255,255,240,0.2)'; c.beginPath();
    for (let i = 0; i < np; i++) { const o = i * 3; c.rect(pos[o] - rw * 0.8, pos[o + 1], rw * 0.6, pos[o + 2]); }
    c.fill();
    if (z >= DREMPEL.markering) {
      c.strokeStyle = 'rgba(235,245,248,0.55)'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
      for (let i = 0; i < np; i++) { const o = i * 3, x = pos[o], y = pos[o + 1] + pos[o + 2], f = 0.5 + 0.5 * Math.sin(this.nu / 500 + i * 1.7); c.moveTo(x + rl * (1.05 + 0.15 * f) * ch, y + rl * (1.05 + 0.15 * f) * sh); c.ellipse(x, y, rl * (1.05 + 0.15 * f), rw * (1.1 + 0.2 * f), hk, 0, TAU); }
      c.stroke();
    }
  }

  // Een pijler op afstand q, alleen als daar water is (een eilandje midden in de rivier krijgt geen pijlervoet in de lucht).
  pijlerOp(d, b, q, off, H) {
    if (this.np >= 64) return;
    this.langs(d, q);
    if (!this.waterSoort(this.px, this.py)) return;
    this.dek(d, q, off);
    const o = this.np++ * 3, pos = this.pijlerPos;
    pos[o] = this.ex; pos[o + 1] = this.ey; pos[o + 2] = this.dekHoogte(b, q, H);
  }

  // Stenen bogen in de gevel: donkere openingen boven het water, met een lichte rand van boogstenen.
  bogen(c, d, b, H, off) {
    const T = this.T, z = this.zoom;
    const k = Math.max(1, Math.round(b.lang / 2.4)), aw = b.lang / k, pijler = Math.min(aw * 0.18, 0.35);
    const rand = z >= DREMPEL.markering;
    for (const laag of rand ? [0, 1] : [0]) {
      if (laag) { c.strokeStyle = STEEN_L; c.lineWidth = Math.max(0.5, T * 0.004); } else c.fillStyle = 'rgba(14,30,36,0.78)';
      c.beginPath();
      for (let i = 0; i < k; i++) {
        const qa = b.w0 + i * aw + pijler, qb = b.w0 + (i + 1) * aw - pijler, qm = (qa + qb) / 2;
        const ha = this.dekHoogte(b, qa, H), hm = this.dekHoogte(b, qm, H), hbb = this.dekHoogte(b, qb, H);
        this.dek(d, qa, off); const x0 = this.ex, y0 = this.ey + ha;
        this.dek(d, qb, off); const x1 = this.ex, y1 = this.ey + hbb;
        this.dek(d, qm, off);
        // boogtop op een kwart van de dekhoogte onder het dek: controlepunt zo dat de kromme daar uitkomt
        const tx = this.ex, ty = this.ey + hm * 0.28;
        const cx = 2 * tx - (x0 + x1) / 2, cy = 2 * ty - (y0 + y1) / 2;
        c.moveTo(x0, y0); c.quadraticCurveTo(cx, cy, x1, y1);
        if (!laag) c.closePath();
      }
      if (laag) c.stroke(); else c.fill();
    }
  }

  // Vakwerk op beide dekranden (eerst de verre, dan de nabije), lange overspanningen in delen met pijlers ertussen.
  vakwerkBrug(c, d, b, H, hb, zuid, kleur) {
    const T = this.T, Tw = this.geo.T, z = this.zoom, S = SCHUIN;
    const qa0 = b.w0 - 0.3, qb0 = b.w1 + 0.3, delen = Math.max(1, Math.round((qb0 - qa0) / Math.max(6, Tw * 0.45)));
    const Ht = T * 0.07, dl = (qb0 - qa0) / delen;
    // vakken: van ver grover, zodat de staven niet tot een grijze waas samenvallen
    this.vak = 0.055 * Tw * (z < DREMPEL.markering ? 2 : 1);
    // schaduw van het vakwerk: hetzelfde patroon, verschoven naar waar de zon het op het water legt
    // (één ligger: die van de verre kant valt grotendeels in de schaduw van het dek)
    if (z >= 6) {
      c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = Math.max(0.5, T * 0.004); c.beginPath();
      for (let k = 0; k < delen; k++) this.vakwerk(c, d, qa0 + k * dl, qa0 + (k + 1) * dl, zuid * hb, H * S, H * (1 + S), (H + Ht) * S, H + (H + Ht) * S, false);
      c.stroke();
    }
    for (let j = 0; j < 2; j++) {
      const kant = j ? zuid : -zuid;
      c.strokeStyle = j ? kleur : '#3c4246'; c.lineWidth = Math.max(0.6, T * (z >= 8 ? 0.005 : 0.007)); c.beginPath();
      for (let k = 0; k < delen; k++) this.vakwerk(c, d, qa0 + k * dl, qa0 + (k + 1) * dl, kant * hb, 0, 0, 0, -Ht, z >= DREMPEL.verkeerslicht);
      c.stroke();
    }
    if (z >= DREMPEL.verkeerslicht) {
      // windverband tussen de bovenranden
      c.strokeStyle = 'rgba(40,46,50,0.7)'; c.lineWidth = Math.max(0.4, T * 0.0025); c.beginPath();
      for (let k = 0; k < delen; k++) {
        const np = Math.max(2, Math.round(dl / this.vak)), pw = dl / np;
        for (let i = 0; i < np - 1; i++) {
          const q1 = qa0 + k * dl + (i + 0.5) * pw, q2 = q1 + pw;
          this.dek(d, q1, -hb); const x1 = this.ex, y1 = this.ey - Ht;
          this.dek(d, q2, hb); c.moveTo(x1, y1); c.lineTo(this.ex, this.ey - Ht);
          this.dek(d, q1, hb); const x2 = this.ex, y2 = this.ey - Ht;
          this.dek(d, q2, -hb); c.moveTo(x2, y2); c.lineTo(this.ex, this.ey - Ht);
        }
      }
      c.stroke();
    }
    if (this.sn) { c.strokeStyle = 'rgba(244,246,248,0.7)'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath(); for (let k = 0; k < delen; k++) for (let kant = -1; kant <= 1; kant += 2) { this.dek(d, qa0 + (k + 0.1) * dl, kant * hb); c.moveTo(this.ex, this.ey - Ht - T * 0.002); this.dek(d, qa0 + (k + 0.9) * dl, kant * hb); c.lineTo(this.ex, this.ey - Ht - T * 0.002); } c.stroke(); }
  }

  // Eén vakwerkligger (warrenligger) van qa tot qb op `off` pixels van de as: een bovenrand en een zigzag van
  // diagonalen als één doorlopende lijn. Onderpunten schuiven (bx, by), bovenpunten liggen (tx, ty) van het dekpunt:
  // zo tekent dezelfde functie ligger en schaduw. Met stijlen ook de verticalen (van dichtbij).
  vakwerk(c, d, qa, qb, off, bx, by, tx, ty, stijlen) {
    const np = Math.max(2, Math.round((qb - qa) / this.vak)), pw = (qb - qa) / np;
    this.dek(d, qa + pw * 0.5, off); c.moveTo(this.ex + tx, this.ey + ty);
    this.dek(d, qb - pw * 0.5, off); c.lineTo(this.ex + tx, this.ey + ty);
    this.dek(d, qa, off); c.moveTo(this.ex + bx, this.ey + by);
    for (let k = 0; k < np; k++) {
      this.dek(d, qa + (k + 0.5) * pw, off); c.lineTo(this.ex + tx, this.ey + ty);
      this.dek(d, qa + (k + 1) * pw, off); c.lineTo(this.ex + bx, this.ey + by);
    }
    if (stijlen) for (let k = 0; k < np; k++) { this.dek(d, qa + (k + 0.5) * pw, off); c.moveTo(this.ex + tx, this.ey + ty); c.lineTo(this.ex + bx, this.ey + by); }
  }

  // Tuibrug: één of twee pylonen in A-vorm met een waaier van tuien naar beide dekranden.
  tuiBrug(c, d, b, H, hb, zuid) {
    const T = this.T, Tw = this.geo.T, z = this.zoom, S = SCHUIN;
    const twee = b.lang >= 14, pyl = twee ? [b.w0 + b.lang * 0.33, b.w1 - b.lang * 0.33] : [(b.w0 + b.w1) / 2];
    const Hp = clamp(b.lang * this.sc * (twee ? 0.3 : 0.45), T * 0.16, T * 0.4);
    const half = twee ? b.lang * 0.33 + 0.4 : b.lang / 2 + 0.4, nk = z >= DREMPEL.markering ? Math.max(3, Math.min(9, Math.round(half / 1.1))) : 3;
    for (const qp of pyl) {
      this.dek(d, qp, 0); const px = this.ex, py = this.ey, ap = py - Hp;
      // schaduw van pyloon en tuien op het water
      c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = Math.max(1, T * 0.012); c.beginPath();
      c.moveTo(px + H * S, py + H * (1 + S)); c.lineTo(px + (H + Hp) * S, py + H + (H + Hp) * S); c.stroke();
      c.lineWidth = Math.max(0.4, T * 0.002); c.beginPath();
      for (const sg of [-1, 1]) for (let k = 1; k <= nk; k++) { this.dek(d, qp + sg * (half * k) / nk, 0); c.moveTo(px + (H + Hp) * S, py + H + (H + Hp) * S); c.lineTo(this.ex + H * S, this.ey + H * (1 + S)); }
      c.stroke();
      // tuien: eerst de verre rand, dan de nabije (achter en voor de pyloon)
      for (const kant of [-zuid, zuid]) {
        c.strokeStyle = kant === zuid ? 'rgba(236,236,230,0.9)' : 'rgba(170,172,170,0.8)'; c.lineWidth = Math.max(0.4, T * 0.0022); c.beginPath();
        for (const sg of [-1, 1]) for (let k = 1; k <= nk; k++) {
          const f = k / nk;
          this.dek(d, qp, kant * hb * 0.25); const ax = this.ex, ay = this.ey - Hp * (0.98 - 0.25 * (1 - f));
          this.dek(d, qp + sg * half * f, kant * hb); c.moveTo(ax, ay); c.lineTo(this.ex, this.ey);
        }
        c.stroke();
        // poot van de pyloon aan deze kant
        this.dek(d, qp, kant * hb * 1.15);
        c.strokeStyle = kant === zuid ? '#d9d6cd' : '#a8a49b'; c.lineWidth = Math.max(1, T * 0.013); c.beginPath(); c.moveTo(this.ex, this.ey); c.lineTo(px, ap); c.stroke();
      }
      // kop van de pyloon, met een rood licht voor het luchtverkeer
      c.fillStyle = '#c9c5bb'; c.beginPath(); stip(c, px, ap, Math.max(1, T * 0.01)); c.fill();
      if (this.nacht > 0.05 && frac(this.nu / 1800 + hash(b.zaad, 9)) < 0.5) this.zetLicht(px, ap - T * 0.006, Math.max(2, T * 0.025), ROOD, 1);
    }
    void Tw;
  }

  // Hangbrug: twee torens met dwarsbalken, draagkabels die tussen de torens doorhangen en hangers naar het dek.
  hangBrug(c, d, b, H, hb, zuid, kleur) {
    const T = this.T, z = this.zoom, S = SCHUIN;
    const qt0 = b.w0 + b.lang * 0.18, qt1 = b.w1 - b.lang * 0.18;
    const Hp = clamp(b.lang * this.sc * 0.32, T * 0.14, T * 0.36);
    const nh = z >= DREMPEL.markering ? Math.max(6, Math.min(26, Math.round((qt1 - qt0) / 0.9))) : 6;
    // kabelhoogte boven het dek: van de torentop doorhangend tot een tiende van de torenhoogte in het midden
    const hoog = (q) => {
      if (q <= qt0) return Hp * clamp((q - b.q0) / Math.max(0.1, qt0 - b.q0), 0, 1);
      if (q >= qt1) return Hp * clamp((b.q1 - q) / Math.max(0.1, b.q1 - qt1), 0, 1);
      const t = (q - qt0) / (qt1 - qt0); return Hp * ((1 - t) * (1 - t) + t * t) - 1.6 * Hp * t * (1 - t);
    };
    // schaduw van torens en kabels
    c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = Math.max(0.6, T * 0.004); c.beginPath();
    for (const kant of [-1, 1]) for (let i = 0; i <= nh + 4; i++) {
      const q = b.q0 + ((b.q1 - b.q0) * i) / (nh + 4), h = hoog(q);
      this.dek(d, q, kant * hb);
      const x = this.ex + (H + h) * S, y = this.ey + H + (H + h) * S;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    for (const qt of [qt0, qt1]) { this.dek(d, qt, 0); c.moveTo(this.ex + H * S, this.ey + H * (1 + S)); c.lineTo(this.ex + (H + Hp) * S, this.ey + H + (H + Hp) * S); }
    c.stroke();
    for (const kant of [-zuid, zuid]) {
      const voor = kant === zuid;
      // hangers
      if (z >= 6) {
        c.strokeStyle = voor ? 'rgba(220,222,218,0.8)' : 'rgba(150,152,150,0.7)'; c.lineWidth = Math.max(0.4, T * 0.0018); c.beginPath();
        for (let i = 1; i < nh; i++) { const q = qt0 + ((qt1 - qt0) * i) / nh; this.dek(d, q, kant * hb); c.moveTo(this.ex, this.ey); c.lineTo(this.ex, this.ey - hoog(q)); }
        c.stroke();
      }
      // draagkabel van anker tot anker
      c.strokeStyle = voor ? kleur : '#3c4246'; c.lineWidth = Math.max(0.7, T * 0.005); c.beginPath();
      for (let i = 0; i <= nh + 4; i++) { const q = b.q0 + ((b.q1 - b.q0) * i) / (nh + 4); this.dek(d, q, kant * hb); if (i) c.lineTo(this.ex, this.ey - hoog(q)); else c.moveTo(this.ex, this.ey); }
      c.stroke();
      // torenpoten
      c.strokeStyle = voor ? '#cfcac0' : '#9c978e'; c.lineWidth = Math.max(1, T * 0.012); c.beginPath();
      for (const qt of [qt0, qt1]) { this.dek(d, qt, kant * hb * 1.1); c.moveTo(this.ex, this.ey + this.dekHoogte(b, qt, H) * (voor ? 1 : 0)); c.lineTo(this.ex, this.ey - Hp - T * 0.01); }
      c.stroke();
    }
    // dwarsbalken tussen de poten
    c.strokeStyle = '#bdb8ae'; c.lineWidth = Math.max(0.8, T * 0.008); c.beginPath();
    for (const qt of [qt0, qt1]) for (const f of [0.55, 1]) { this.dek(d, qt, -hb * 1.1); c.moveTo(this.ex, this.ey - Hp * f); this.dek(d, qt, hb * 1.1); c.lineTo(this.ex, this.ey - Hp * f); }
    c.stroke();
    if (this.nacht > 0.05 && frac(this.nu / 1800 + hash(b.zaad, 9)) < 0.5) for (const qt of [qt0, qt1]) { this.dek(d, qt, 0); this.zetLicht(this.ex, this.ey - Hp - T * 0.015, Math.max(2, T * 0.025), ROOD, 1); }
  }

  // Stalen boog over het spoor: twee bogen met hangers en een windverband bovenin.
  staalBoog(c, d, b, H, hb, zuid, kleur) {
    const T = this.T, z = this.zoom, S = SCHUIN;
    const qa = b.w0 - 0.2, qb = b.w1 + 0.2, Ha = clamp((qb - qa) * this.sc * 0.25, T * 0.08, T * 0.2);
    const nh = z >= DREMPEL.markering ? Math.max(5, Math.min(18, Math.round((qb - qa) / 0.8))) : 5;
    const hoog = (t) => Ha * 4 * t * (1 - t);
    c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = Math.max(0.6, T * 0.005); c.beginPath();
    for (const kant of [-1, 1]) for (let i = 0; i <= nh; i++) { const t = i / nh; this.dek(d, qa + (qb - qa) * t, kant * hb); const h = hoog(t), x = this.ex + (H + h) * S, y = this.ey + H + (H + h) * S; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.stroke();
    for (const kant of [-zuid, zuid]) {
      const voor = kant === zuid;
      c.strokeStyle = voor ? 'rgba(210,212,210,0.85)' : 'rgba(120,124,124,0.8)'; c.lineWidth = Math.max(0.4, T * 0.0018); c.beginPath();
      for (let i = 1; i < nh; i++) { const t = i / nh; this.dek(d, qa + (qb - qa) * t, kant * hb); c.moveTo(this.ex, this.ey); c.lineTo(this.ex, this.ey - hoog(t)); }
      c.stroke();
      c.strokeStyle = voor ? kleur : '#3c4246'; c.lineWidth = Math.max(0.8, T * 0.008); c.beginPath();
      for (let i = 0; i <= nh; i++) { const t = i / nh; this.dek(d, qa + (qb - qa) * t, kant * hb); if (i) c.lineTo(this.ex, this.ey - hoog(t)); else c.moveTo(this.ex, this.ey); }
      c.stroke();
    }
    if (z >= DREMPEL.markering) {
      c.strokeStyle = 'rgba(50,56,60,0.8)'; c.lineWidth = Math.max(0.4, T * 0.003); c.beginPath();
      for (let i = 2; i < nh - 1; i++) { const t = i / nh; this.dek(d, qa + (qb - qa) * t, -hb); const x = this.ex, y = this.ey - hoog(t); this.dek(d, qa + (qb - qa) * t, hb); c.moveTo(x, y); c.lineTo(this.ex, this.ey - hoog(t)); }
      c.stroke();
    }
  }

  // Viaduct over een diep dal: slanke pijlers tot op de dalbodem, een ligger aan de kant van de kijker en een lange
  // schaduw in het dal.
  viaduct(c, d, q0, q1, diep, spoor) {
    const T = this.T, Tw = this.geo.T, z = this.zoom, S = SCHUIN;
    const H = clamp(diep * T * 2.4, T * 0.08, T * 0.42), hb = (spoor ? 0.075 : 0.095) * T;
    const v = { w0: q0 + 0.12 * Tw, w1: q1 - 0.12 * Tw };
    const n = this.monsters(d, q0, q1, v.w0, v.w1, H), bp = this.bp, m = n >> 1, zuid = bp[m * 5 + 3] >= 0 ? 1 : -1;
    if (!spoor) this.knipWeg(c, d, q0, q1);
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); this.bpStrook(c, n, hb, 0, 0, S, 1 + S); c.fill();
    // pijlers om de 0.2 tegel: van de onderkant van de ligger tot de dalbodem, onderaan breder
    const af = 0.2 * Tw, k = Math.max(2, Math.round((q1 - q0) / af));
    c.fillStyle = '#9a958b'; c.beginPath();
    for (let i = 1; i < k; i++) {
      const q = q0 + ((q1 - q0) * i) / k, h = this.dekHoogte(v, q, H);
      if (h < T * 0.01) continue;
      this.dek(d, q, zuid * hb * 0.5);
      const x = this.ex, y = this.ey, bw = T * 0.012, ow = T * 0.02;
      c.moveTo(x - bw, y); c.lineTo(x + bw, y); c.lineTo(x + ow, y + h); c.lineTo(x - ow, y + h); c.closePath();
    }
    c.fill();
    c.fillStyle = 'rgba(30,30,28,0.3)'; c.beginPath();
    for (let i = 1; i < k; i++) {
      const q = q0 + ((q1 - q0) * i) / k, h = this.dekHoogte(v, q, H);
      if (h < T * 0.01) continue;
      this.dek(d, q, zuid * hb * 0.5);
      const x = this.ex, y = this.ey;
      c.moveTo(x + T * 0.002, y); c.lineTo(x + T * 0.012, y); c.lineTo(x + T * 0.02, y + h); c.lineTo(x + T * 0.004, y + h); c.closePath();
    }
    c.fill();
    // ligger
    c.fillStyle = '#86817a'; c.beginPath();
    this.bpLijn(c, n, zuid * hb, 0, 0, 0, 0, false, false); this.bpLijn(c, n, zuid * hb, 0, T * 0.022, 0, 0, true, true); c.closePath(); c.fill();
    if (!spoor) c.restore();
    if (spoor) { c.fillStyle = '#86827a'; c.beginPath(); this.bpStrook(c, n, hb, 0, 0, 0, 0); c.fill(); }
    c.strokeStyle = '#b4b0a7'; c.lineWidth = Math.max(0.6, T * 0.008); c.beginPath(); this.bpLijn(c, n, hb, 0, 0, 0, 0, false, false); this.bpLijn(c, n, -hb, 0, 0, 0, 0, false, false); c.stroke();
    if (this.sn) { c.strokeStyle = 'rgba(244,246,248,0.8)'; c.lineWidth = Math.max(0.5, T * 0.004); c.beginPath(); this.bpLijn(c, n, hb, 0, -T * 0.002, 0, 0, false, false); this.bpLijn(c, n, -hb, 0, -T * 0.002, 0, 0, false, false); c.stroke(); }
    void z;
  }

  // Voetgangersbruggetjes in de stad: een smal dek met een lichte bult, leuningen en 's avonds een lampje aan elke kant.
  tekenVoetbruggen(c, a) {
    const T = this.T, sc = this.sc, z = this.zoom, Tw = this.geo.T;
    let n = 0;
    c.globalAlpha = a;
    for (const f of this.voetbruggen) {
      if (n >= PLAFOND.voetbruggen || !this.inBeeld(f.x0, f.y0, f.x1, f.y1, Tw * 0.2)) continue;
      n++;
      const nx = -f.fy, ny = f.fx, L = f.half * sc, hw = T * 0.03, bult = T * 0.014;
      const mx = f.x * sc + this.ox, my = f.y * sc + this.oy;
      const hout = hash(f.zaad, 2) < 0.5;
      const P = (t, o, dy) => { this.ex = mx + nx * L * t - f.fx * o; this.ey = my + ny * L * t - f.fy * o - bult * (1 - t * t) + dy; };
      // schaduw op het water
      c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath();
      for (let i = 0; i <= 6; i++) { const t = -1 + i / 3; P(t, -hw, 0); const h = bult * (1 - t * t) * 2 + T * 0.02; i ? c.lineTo(this.ex + h * SCHUIN, this.ey + h * (1 + SCHUIN)) : c.moveTo(this.ex + h * SCHUIN, this.ey + h * (1 + SCHUIN)); }
      for (let i = 6; i >= 0; i--) { const t = -1 + i / 3; P(t, hw, 0); const h = bult * (1 - t * t) * 2 + T * 0.02; c.lineTo(this.ex + h * SCHUIN, this.ey + h * (1 + SCHUIN)); }
      c.fill();
      // dek
      c.fillStyle = hout ? '#9a7a56' : '#cfcbc2'; c.beginPath();
      for (let i = 0; i <= 6; i++) { const t = -1 + i / 3; P(t, -hw, 0); i ? c.lineTo(this.ex, this.ey) : c.moveTo(this.ex, this.ey); }
      for (let i = 6; i >= 0; i--) { const t = -1 + i / 3; P(t, hw, 0); c.lineTo(this.ex, this.ey); }
      c.fill();
      if (this.sn) { c.fillStyle = 'rgba(240,243,246,0.75)'; c.fill(); }
      // planken op het kleinste niveau, dan de leuningen
      if (z >= DREMPEL.verkeerslicht && hout) {
        c.strokeStyle = 'rgba(60,44,30,0.45)'; c.lineWidth = Math.max(0.4, T * 0.0012); c.beginPath();
        for (let i = 1; i < 18; i++) { const t = -1 + i / 9; P(t, -hw, 0); c.moveTo(this.ex, this.ey); P(t, hw, 0); c.lineTo(this.ex, this.ey); }
        c.stroke();
      }
      c.strokeStyle = hout ? '#5b4636' : '#5a6066'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
      for (const o of [-hw, hw]) for (let i = 0; i <= 6; i++) { const t = -1 + i / 3; P(t, o, -T * 0.012); i ? c.lineTo(this.ex, this.ey) : c.moveTo(this.ex, this.ey); }
      c.stroke();
      if (z >= DREMPEL.markering) {
        c.beginPath();
        for (const o of [-hw, hw]) for (let i = 0; i <= 8; i++) { const t = -1 + i / 4; P(t, o, 0); c.moveTo(this.ex, this.ey); c.lineTo(this.ex, this.ey - T * 0.012); }
        c.stroke();
      }
      if (this.nacht > 0.05) for (const t of [-0.9, 0.9]) { P(t, hw * 1.2, -T * 0.03); this.zetLicht(this.ex, this.ey, Math.max(2, T * 0.03), WARM, 0.8); }
    }
    this.n.voetbruggen = n;
    c.globalAlpha = 1;
  }

  // Tunnels: het terrein van de terreinlaag komt terug over weg en spoor tussen de monden (wat erin rijdt,
  // verdwijnt), en elke mond krijgt een betonnen kopmuur met een donkere boog. Een mond die van de kijker af wijst,
  // ligt achter de helling: daar is alleen de bovenrand van de kopmuur te zien.
  tekenTunnels(c, aDek, aMond) {
    const Tw = this.geo.T;
    let n = 0;
    this.aDek = aDek; this.aMond = aMond;
    for (let i = 0; i < this.nZr; i++) {
      const r = this.routes[this.zr[i]];
      if (r.tunnel) for (let k = 0; k < r.tunnel.length && n < PLAFOND.tunnels; k += 2) if (this.brugInBeeld(r, r.tunnel[k], r.tunnel[k + 1], Tw * 0.4)) { this.tunnel(c, r, r.tunnel[k], r.tunnel[k + 1], true); n++; }
    }
    // wegen: de tunneltak tekent het wegdek niet; alleen een mond waar hij op een gewone tak aansluit
    if (aMond > 0) {
      c.globalAlpha = aMond;
      for (const m of this.monden ?? []) {
        if (n >= PLAFOND.tunnels) break;
        const x = m.x * this.sc + this.ox, y = m.y * this.sc + this.oy;
        if (!this.opScherm(x, y, this.T * 0.4)) continue;
        this.tunnelMond(c, this.wegen[m.w], m.q, m.rich, false); n++;
      }
    }
    this.n.tunnels = n;
    c.globalAlpha = 1;
  }

  tunnel(c, d, q0, q1, spoor) {
    const T = this.T, hb = (spoor ? 0.1 : 0.115) * T;
    c.globalAlpha = this.aDek;
    this.bergDek(c, d, q0 + 0.15, q1 - 0.15, hb);
    if (this.aMond <= 0) return;
    c.globalAlpha = this.aMond;
    this.tunnelMond(c, d, q0, 1, spoor);
    this.tunnelMond(c, d, q1, -1, spoor);
  }

  // Leg het gebakken terrein van de terreinlaag terug over een strook langs weg of spoor. Geen terreinlaag of nog
  // geen gebakken brok: dan blijft de weg zichtbaar (alleen de monden).
  bergDek(c, d, q0, q1, hb) {
    const tl = this.terrein, cache = tl && tl.cache, view = this.view;
    if (!(cache instanceof Map) || !view || q1 <= q0) return;
    const n = this.monsters(d, q0, q1, q0, q1, 0);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const bp = this.bp;
    for (let i = 0; i < n; i++) { const x = bp[i * 5], y = bp[i * 5 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const sc = this.sc, dpr = this.dpr, CH = 64;
    const k0 = Math.floor(((x0 - hb - this.ox) / sc) / CH), k1 = Math.floor(((x1 + hb - this.ox) / sc) / CH);
    const r0 = Math.floor(((y0 - hb - this.oy) / sc) / CH), r1 = Math.floor(((y1 + hb - this.oy) / sc) / CH);
    c.save();
    c.beginPath(); this.bpStrook(c, n, hb, 0, 0, 0, 0); c.clip();
    const rond = (v) => Math.round(v * dpr) / dpr;
    for (let cr = r0; cr <= r1; cr++) for (let ck = k0; ck <= k1; ck++) {
      let br = null;
      for (const R of [12, 6, 3]) { const e = cache.get(`${R}:${ck}:${cr}`); if (e && e.grond && (!br || e.gebruikt === tl.frame)) br = e; }
      if (!br) continue;
      const X = rond(ck * CH * sc + this.ox), Y = rond(cr * CH * sc + this.oy);
      c.drawImage(br.grond, X, Y, rond((ck + 1) * CH * sc + this.ox) - X, rond((cr + 1) * CH * sc + this.oy) - Y);
    }
    c.restore();
  }

  // Tunnelmond op afstand q; rich +1 als de tunnel in de richting van de weg doorloopt, -1 als hij erachter ligt.
  tunnelMond(c, d, q, rich, spoor) {
    const T = this.T, z = this.zoom, S = SCHUIN;
    this.dek(d, q, 0);
    const x = this.ex, y = this.ey, hx = this.hx * rich, hy = this.hy * rich, nx = -hy, ny = hx;
    const w = (spoor ? 0.1 : 0.115) * T, Hm = T * (spoor ? 0.06 : 0.055), ingang = T * 0.16;
    const naarKijker = -hy > -0.15; // de mond kijkt naar buiten (-h); naar het zuiden is naar de kijker toe
    // keermuren langs de inrit, aflopend naar het open land
    if (z >= DREMPEL.markering) {
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath();
      c.moveTo(x + nx * w, y + ny * w); c.lineTo(x + nx * w + Hm * S, y + ny * w + Hm * S); c.lineTo(x - hx * ingang + nx * w, y - hy * ingang + ny * w); c.closePath();
      c.moveTo(x - nx * w, y - ny * w); c.lineTo(x - nx * w + Hm * S, y - ny * w + Hm * S); c.lineTo(x - hx * ingang - nx * w, y - hy * ingang - ny * w); c.closePath();
      c.fill();
    }
    c.strokeStyle = '#b3aea3'; c.lineWidth = Math.max(0.6, T * 0.009); c.beginPath();
    for (const o of [w, -w]) { c.moveTo(x + nx * o, y + ny * o); c.lineTo(x - hx * ingang + nx * o * 1.15, y - hy * ingang + ny * o * 1.15); }
    c.stroke();
    // kopmuur: in het verticale vlak dwars op de weg
    const ax = x + nx * w * 1.25, ay = y + ny * w * 1.25, bx = x - nx * w * 1.25, by = y - ny * w * 1.25;
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.moveTo(ax, ay - Hm); c.lineTo(bx, by - Hm); c.lineTo(bx + Hm * S, by - Hm + Hm * (1 + S)); c.lineTo(ax + Hm * S, ay - Hm + Hm * (1 + S)); c.closePath(); c.fill();
    if (naarKijker) {
      c.fillStyle = '#9c978c'; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(bx, by - Hm); c.lineTo(ax, ay - Hm); c.closePath(); c.fill();
      // de boog: donker, met een lichte rand van betonblokken
      const ox = x + nx * w * 0.9, oy = y + ny * w * 0.9, px = x - nx * w * 0.9, py = y - ny * w * 0.9, cx = 2 * x - (ox + px) / 2, cy = 2 * (y - Hm * 0.8) - (oy + py) / 2;
      c.fillStyle = '#141414'; c.beginPath(); c.moveTo(ox, oy); c.quadraticCurveTo(cx, cy, px, py); c.closePath(); c.fill();
      if (z >= DREMPEL.markering) {
        c.strokeStyle = '#c6c1b6'; c.lineWidth = Math.max(0.5, T * 0.004); c.beginPath(); c.moveTo(ox, oy); c.quadraticCurveTo(cx, cy, px, py); c.stroke();
        // lampjes in de tunnel
        if (z >= DREMPEL.verkeerslicht) { c.fillStyle = '#e8c56a'; c.beginPath(); for (const f of [-0.45, 0.45]) stip(c, x + nx * w * f, y + ny * w * f - Hm * 0.5, T * 0.0035); c.fill(); }
      }
    }
    // bovenrand van de kopmuur, licht op de noordwestkant, en sneeuw in de winter
    c.strokeStyle = '#cdc8bd'; c.lineWidth = Math.max(0.8, T * 0.012); c.beginPath(); c.moveTo(ax, ay - Hm); c.lineTo(bx, by - Hm); c.stroke();
    if (this.sn) { c.strokeStyle = 'rgba(244,246,248,0.9)'; c.lineWidth = Math.max(0.6, T * 0.006); c.beginPath(); c.moveTo(ax, ay - Hm - T * 0.004); c.lineTo(bx, by - Hm - T * 0.004); c.stroke(); }
    if (this.nacht > 0.05 && naarKijker) this.zetLicht(x, y - Hm * 0.3, Math.max(2, T * 0.05), AMBER, 0.6);
  }

  // Pijpleidingen liggen ondergronds (plan §3.2): boven de grond zie je alleen het tracé (een lichte strook gemaaid
  // gras of een gekapte strook door het bos), gele markeringspaaltjes, een afsluiterstation halverwege en aan elk eind
  // een kort stuk buis met een afsluiter waar de leiding bij het depot en de centrale de grond uit komt.
  tekenPijpen(c, a) {
    const T = this.T, sc = this.sc, z = this.zoom, sn = this.sn;
    c.globalAlpha = a;
    for (const p of this.pijpen) {
      if (!this.inBeeld(Math.min(p.ax, p.bx), Math.min(p.ay, p.by), Math.max(p.ax, p.bx), Math.max(p.ay, p.by), 8)) continue;
      const ax = p.ax * sc + this.ox, ay = p.ay * sc + this.oy, bx = p.bx * sc + this.ox, by = p.by * sc + this.oy;
      const nx = -p.uy, ny = p.ux, len = Math.hypot(bx - ax, by - ay);
      // het tracé: in de sneeuw nauwelijks te zien
      c.strokeStyle = sn === 2 ? 'rgba(236,238,240,0.18)' : 'rgba(206,196,150,0.30)'; c.lineWidth = T * 0.075;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      c.strokeStyle = sn === 2 ? 'rgba(255,255,255,0.12)' : 'rgba(226,218,178,0.28)'; c.lineWidth = T * 0.03;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      if (z < 7) continue;
      // markeringspaaltjes om de 0,8 tegel, net naast het tracé (vaste plekken langs de leiding)
      if (z >= DREMPEL.markering) {
        c.fillStyle = '#e0b52a';
        c.beginPath();
        for (let q = T * 0.4; q < len - T * 0.2; q += T * 0.8) {
          const x = ax + p.ux * q + nx * T * 0.05, y = ay + p.uy * q + ny * T * 0.05;
          c.rect(x - T * 0.005, y - T * 0.018, T * 0.01, T * 0.018);
        }
        c.fill();
      }
      // afsluiterstation halverwege: een omheind vakje met een kastje
      if (len > T * 1.6) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); rechthoek(c, mx + T * 0.01, my + T * 0.012, p.ux, p.uy, T * 0.06, T * 0.045); c.fill();
        c.fillStyle = '#a9a69c'; c.beginPath(); rechthoek(c, mx, my, p.ux, p.uy, T * 0.06, T * 0.045); c.fill();
        c.fillStyle = '#7d8187'; c.beginPath(); rechthoek(c, mx + nx * T * 0.012, my + ny * T * 0.012, p.ux, p.uy, T * 0.022, T * 0.012); c.fill();
        if (z >= DREMPEL.markering) { c.fillStyle = '#c43c32'; c.beginPath(); stip(c, mx - nx * T * 0.012, my - ny * T * 0.012, T * 0.006); c.fill(); }
      }
      // bij het depot en de centrale komt de buis boven de grond: een kort stuk met een afsluiter
      for (const [x0, y0, r, kop] of [[ax, ay, 1, p.kopA], [bx, by, -1, p.kopB]]) {
        if (!kop) continue;
        const x1 = x0 + p.ux * T * 0.12 * r, y1 = y0 + p.uy * T * 0.12 * r;
        c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = T * 0.024;
        c.beginPath(); c.moveTo(x0 + T * 0.01, y0 + T * 0.012); c.lineTo(x1 + T * 0.01, y1 + T * 0.012); c.stroke();
        c.strokeStyle = p.olie ? '#3b3a38' : '#9aa0a6'; c.lineWidth = Math.max(0.8, T * 0.016);
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        if (z >= DREMPEL.markering) { c.fillStyle = '#c43c32'; c.beginPath(); stip(c, x0 + (x1 - x0) * 0.6, y0 + (y1 - y0) * 0.6 - T * 0.01, T * 0.007); c.fill(); }
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

  // ---------- het wegdek van het net ----------
  //
  // Elke tak van het net als polylijn, per klasse met de breedte uit PROFIEL: eerst de berm van de stamwegen en de
  // stoepen van straten en hoofdwegen, dan de opritten (die de stoep doorsnijden), de stoeprand en het asfalt. Waar
  // twee armen van een knoop een hoek maken, rondt een boog de stoeprand af (straal 0,06 T, dezelfde binnenstraal als
  // net.bocht). Daarna de markering, stopstrepen, zebra's (net.zebras), haaientanden en parkeervakken. Tunneltakken
  // (tBouw 3) liggen in de berg: daar alleen de monden. Bruggen komen er in tekenBruggen onder.

  // Zichtbare takken (this.zt) en knopen (this.zk) van het net.
  zichtNet() {
    const net = this.net, B = net.tBox, m = this.geo.T * 0.4;
    const zt = this.zt ??= [], zk = this.zk ??= [];
    zt.length = 0; zk.length = 0;
    const x0 = this.wx0 - m, x1 = this.wx1 + m, y0 = this.wy0 - m, y1 = this.wy1 + m;
    if (!this.ztIn || this.ztIn.length < net.nT) this.ztIn = new Uint8Array(net.nT);
    this.ztIn.fill(0);
    const ztK = this.ztK ??= [[], [], [], [], []];
    for (const l of ztK) l.length = 0;
    for (let i = 0; i < net.nT; i++) if (B[i * 4 + 2] >= x0 && B[i * 4] <= x1 && B[i * 4 + 3] >= y0 && B[i * 4 + 1] <= y1) { zt.push(i); this.ztIn[i] = 1; ztK[net.tKlasse[i]]?.push(i); }
    for (let k = 0; k < net.nK; k++) { const x = net.kx[k], y = net.ky[k]; if (x >= x0 && x <= x1 && y >= y0 && y <= y1) zk.push(k); }
  }

  // Voegt het stuk [s0, s1] van tak i toe aan het pad, off wereldeenheden rechts van de richting A→B (schermcoördinaten:
  // rechts is (-uy, ux)). Op de hoekpunten verspringt de verschoven lijn niet: daar staat hij op de bissectrice.
  takPad(c, i, s0, s1, off) {
    const net = this.net, P = net.punten, cum = net.cum, p0 = net.tP0[i], np = net.tNP[i], sc = this.sc, ox = this.ox, oy = this.oy;
    if (!(s1 > s0)) return;
    let eerst = true;
    const zet = (x, y, nx, ny) => {
      const X = (x + nx * off) * sc + ox, Y = (y + ny * off) * sc + oy;
      if (eerst) { c.moveTo(X, Y); eerst = false; } else c.lineTo(X, Y);
    };
    for (let j = 0; j + 1 < np; j++) {
      const a = cum[p0 + j], b = cum[p0 + j + 1];
      if (b <= s0 || b - a < 1e-9) continue;
      const ax = P[(p0 + j) * 2], ay = P[(p0 + j) * 2 + 1], bx = P[(p0 + j) * 2 + 2], by = P[(p0 + j) * 2 + 3], l = b - a;
      const ux = (bx - ax) / l, uy = (by - ay) / l, nx = -uy, ny = ux;
      if (eerst) { const f = Math.max(0, s0 - a); zet(ax + ux * f, ay + uy * f, nx, ny); }
      if (s1 < b) { const f = s1 - a; zet(ax + ux * f, ay + uy * f, nx, ny); return; }
      if (j + 2 < np && off) {
        const cx = P[(p0 + j) * 2 + 4], cy = P[(p0 + j) * 2 + 5], l2 = Math.hypot(cx - bx, cy - by) || 1;
        const mx = -(cy - by) / l2, my = (cx - bx) / l2;
        let qx = nx + mx, qy = ny + my;
        const ql = Math.hypot(qx, qy) || 1;
        qx /= ql; qy /= ql;
        const k = 1 / Math.max(0.35, qx * nx + qy * ny);
        zet(bx, by, qx * k, qy * k);
      } else zet(bx, by, nx, ny);
    }
  }

  // Armen van knoop k (zonder opritten): hoek, klasse en gerichte tak naar buiten.
  armenVan(k) {
    const net = this.net, o = this.po ??= {};
    // per versie van het net één keer uitgerekend (de armen veranderen alleen met het net)
    if (this.armNet !== net || this.armVersie !== net.versie) { this.armNet = net; this.armVersie = net.versie; this.armC = new Array(net.nK); }
    if (this.armC[k]) return this.armC[k];
    const uit = (this.armC[k] = []);
    for (let j = net.adj0[k]; j < net.adj0[k + 1]; j++) {
      const g = net.adj[j], i = g >= 0 ? g : ~g, kl = net.tKlasse[i];
      if (kl === KLASSE.OPRIT || net.tLen[i] < 1e-6) continue;
      net.punt(g, Math.min(net.tLen[i], 0.02 * this.geo.T), o);
      uit.push({ g, i, kl, h: Math.atan2(o.y - net.ky[k], o.x - net.kx[k]), tunnel: net.tBouw[i] === 3 });
    }
    uit.sort((a, b) => a.h - b.h);
    return uit;
  }

  // Afgeronde hoek tussen twee armen (hoeken h1 < h2 in de draairichting, opening h2 - h1): het stuk tussen de twee
  // randen (op e1 en e2 van de as) en een boog met straal r, in wereldcoördinaten achter aan uit (12 getallen, zie
  // hoekBogen); false als de hoek te scherp is.
  hoekBoog(uit, x, y, h1, h2, e1, e2, r) {
    const gap = h2 - h1;
    if (gap < 0.35 || gap > 2.8 || r <= 0) return false;
    const d1x = Math.cos(h1), d1y = Math.sin(h1), d2x = Math.cos(h2), d2y = Math.sin(h2);
    const n1x = -d1y, n1y = d1x, n2x = d2y, n2y = -d2x; // normalen naar de opening toe
    const det = -d1x * d2y + d1y * d2x;
    if (Math.abs(det) < 1e-6) return false;
    const los = (a1, a2) => {
      const vx = n2x * a2 - n1x * a1, vy = n2y * a2 - n1y * a1;
      return [(-vx * d2y + vy * d2x) / det, (d1x * vy - d1y * vx) / det];
    };
    const [t1, t2] = los(e1 + r, e2 + r), [p1] = los(e1, e2);
    const Tw = this.geo.T;
    if (t1 <= 0 || t2 <= 0 || t1 > 0.5 * Tw || t2 > 0.5 * Tw) return false;
    const cx = x + n1x * (e1 + r) + d1x * t1, cy = y + n1y * (e1 + r) + d1y * t1;
    const ax = x + n1x * e1 + d1x * t1, ay = y + n1y * e1 + d1y * t1;
    const bx = x + n2x * e2 + d2x * t2, by = y + n2y * e2 + d2y * t2;
    const px = x + n1x * e1 + d1x * p1, py = y + n1y * e1 + d1y * p1;
    const aA = Math.atan2(ay - cy, ax - cx), aB = Math.atan2(by - cy, bx - cx);
    let d = aA - aB;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    uit.push(ax, ay, px, py, bx, by, cx, cy, r, aB, aA, d < 0 ? 1 : 0);
    return true;
  }

  // Alle hoekbogen van de zichtbare knopen voor één laag van het profiel: rand(kl) is de afstand van de as tot de rand
  // van die laag (of < 0 als die klasse de laag niet heeft), krimp hoeveel kleiner de straal is.
  hoekBogen(c, rand, krimp, laag) {
    const net = this.net, Tw = this.geo.T;
    if (this.hbNet !== net || this.hbVersie !== net.versie) { this.hbNet = net; this.hbVersie = net.versie; this.hbC = [[], [], []]; }
    const C = this.hbC[laag];
    const sc = this.sc, ox = this.ox, oy = this.oy;
    c.beginPath();
    let n = 0;
    for (const k of this.zk) {
      let B = C[k];
      if (B === undefined) {
        // de bogen van deze knoop in wereldcoördinaten: per boog ax, ay, px, py, bx, by, cx, cy, r, hoekB, hoekA, tegen
        const L = [];
        if (net.kSoort[k] !== NK.ROTONDE && net.kSoort[k] !== NK.DOCK) {
          const A = this.armenVan(k);
          for (let a = 0; A.length >= 2 && a < A.length; a++) {
            const p = A[a], q = A[(a + 1) % A.length];
            if (p.tunnel || q.tunnel) continue;
            const e1 = rand(p.kl), e2 = rand(q.kl);
            if (e1 < 0 || e2 < 0) continue;
            const h2 = a + 1 < A.length ? q.h : q.h + TAU;
            this.hoekBoog(L, net.kx[k], net.ky[k], p.h, h2, e1, e2, 0.06 * Tw - krimp);
          }
        }
        B = C[k] = L.length ? Float32Array.from(L) : null;
      }
      if (!B) continue;
      for (let j = 0; j < B.length; j += 12) {
        c.moveTo(B[j] * sc + ox, B[j + 1] * sc + oy);
        c.lineTo(B[j + 2] * sc + ox, B[j + 3] * sc + oy);
        c.lineTo(B[j + 4] * sc + ox, B[j + 5] * sc + oy);
        c.arc(B[j + 6] * sc + ox, B[j + 7] * sc + oy, B[j + 8] * sc, B[j + 9], B[j + 10], B[j + 11] > 0);
        c.closePath();
        n++;
      }
    }
    if (n) c.fill();
  }

  // Strook van de zichtbare takken van klasse kl (of alle klassen met fn(kl) > 0) met breedte fn(kl) wereldeenheden.
  strook(c, filter, breedte, kleur, rond = true) {
    const net = this.net, sc = this.sc;
    for (const kl of [KLASSE.ERF, KLASSE.STRAAT, KLASSE.HOOFD, KLASSE.STAM, KLASSE.OPRIT]) {
      const b = breedte(kl);
      if (!(b > 0)) continue;
      c.beginPath();
      let n = 0;
      for (const i of this.ztK[kl]) {
        if (!filter(i)) continue;
        this.takPad(c, i, 0, net.tLen[i], 0);
        n++;
      }
      if (!n) continue;
      c.lineCap = rond ? 'round' : 'butt';
      c.strokeStyle = typeof kleur === 'function' ? kleur(kl) : kleur;
      c.lineWidth = b * sc;
      c.stroke();
    }
    c.lineCap = 'butt';
  }

  tekenWegdek(c, a) {
    const net = this.net;
    if (!net?.klaar || !net.nT || a <= 0.01) return;
    this.zichtNet();
    if (!this.zt.length) return;
    const Tw = this.geo.T, z = this.zoom, sc = this.sc, T = this.T;
    const pr = PROFIEL, RAND = 0.007 * Tw;
    const nietTunnel = (i) => net.tBouw[i] !== 3;
    const grond = (i) => net.tBouw[i] === 0;
    const winter = this.sn;
    c.save();
    c.globalAlpha = a;
    c.lineJoin = 'round';
    // berm langs de stamwegen (niet op bruggen)
    this.strook(c, grond, (kl) => (kl === KLASSE.STAM ? (pr[kl].asfalt + 0.07) * Tw : 0), winter === 2 ? 'rgba(214,218,214,0.7)' : 'rgba(146,140,112,0.55)');
    // stoep: straat en hoofdweg, met afgeronde hoeken
    const stoepKleur = winter === 2 ? '#c9cccd' : '#a9a59b';
    this.strook(c, nietTunnel, (kl) => (pr[kl].stoep && kl !== KLASSE.OPRIT ? (pr[kl].asfalt + 2 * pr[kl].stoep) * Tw : 0), stoepKleur);
    c.fillStyle = stoepKleur;
    this.hoekBogen(c, (kl) => (pr[kl].stoep ? (pr[kl].asfalt / 2 + pr[kl].stoep) * Tw : -1), pr[KLASSE.STRAAT].stoep * Tw, 0);
    // opritten: beton tot het dock, over de stoep heen
    if (z >= 4) this.strook(c, nietTunnel, (kl) => (kl === KLASSE.OPRIT ? pr[kl].asfalt * Tw : 0), winter === 2 ? '#c4c4c0' : BETON_D, false);
    // stoeprand (bij de stamweg: de donkere asfaltrand)
    const randKleur = (kl) => (kl === KLASSE.STAM ? '#34363a' : kl === KLASSE.ERF ? '#6b625a' : '#8f8b82');
    this.strook(c, nietTunnel, (kl) => (kl === KLASSE.OPRIT ? 0 : pr[kl].asfalt * Tw + 2 * RAND), randKleur);
    // de stoeprand in de hoeken pas van dichtbij (verder weg is hij smaller dan een pixel)
    c.fillStyle = '#8f8b82';
    if (z >= 9) this.hoekBogen(c, (kl) => pr[kl].asfalt / 2 * Tw + RAND, RAND, 1);
    // asfalt; het woonerf in klinkers
    const dek = (kl) => (kl === KLASSE.ERF ? '#5d5650' : ASFALT);
    this.strook(c, nietTunnel, (kl) => (kl === KLASSE.OPRIT ? 0 : pr[kl].asfalt * Tw), dek);
    c.fillStyle = ASFALT;
    this.hoekBogen(c, (kl) => pr[kl].asfalt / 2 * Tw, 0, 2);
    // overkapte tunnelbak tussen de gebouwen: een betonnen dak met lichtstraten (wat erin rijdt, is niet te zien)
    const dakTak = this.dakTak;
    if (dakTak && dakTak.length === net.nT && z >= 4) {
      const inDak = (i) => dakTak[i] === 1;
      this.strook(c, inDak, (kl) => (pr[kl].asfalt + 2 * Math.max(pr[kl].stoep, 0.012)) * Tw, winter === 2 ? '#b9bbb9' : '#7f7b73', false);
      this.strook(c, inDak, (kl) => pr[kl].asfalt * Tw, winter === 2 ? '#d5d8d8' : BETON, false);
      if (z >= 8) { c.setLineDash([T * 0.03, T * 0.05]); this.strook(c, inDak, (kl) => pr[kl].asfalt * Tw * 0.3, 'rgba(96,120,134,0.75)', false); c.setLineDash([]); }
    }
    // rotondes: een ring om een groen eiland
    for (const k of this.zk) {
      if (net.kSoort[k] !== NK.ROTONDE) continue;
      const x = net.kx[k] * sc + this.ox, y = net.ky[k] * sc + this.oy, R = ROTONDE_STRAAL * T, b = pr[KLASSE.HOOFD].asfalt * T / 2;
      c.fillStyle = '#8f8b82'; c.beginPath(); c.arc(x, y, R + b + RAND * sc, 0, TAU); c.fill();
      c.fillStyle = ASFALT; c.beginPath(); c.arc(x, y, R + b, 0, TAU); c.fill();
      c.fillStyle = '#8f8b82'; c.beginPath(); c.arc(x, y, R - b + RAND * sc, 0, TAU); c.fill();
      c.fillStyle = winter === 2 ? '#dfe3e4' : this.gs === 1 ? '#7f8450' : '#5f7f3e'; c.beginPath(); c.arc(x, y, R - b, 0, TAU); c.fill();
      if (z >= 8) { c.fillStyle = 'rgba(40,60,30,0.6)'; c.beginPath(); stip(c, x - T * 0.008, y - T * 0.006, T * 0.014); stip(c, x + T * 0.01, y + T * 0.007, T * 0.011); c.fill(); }
    }
    // sneeuw: hopen langs de stoeprand; terwijl het sneeuwt een laagje op de rijbaan met bandensporen
    if (this.sz.sneeuw > 0.3 && z >= 5.5) {
      c.globalAlpha = a * smooth(5.5, 6.5, z) * clamp(this.sz.sneeuw, 0, 1) * 0.85;
      c.setLineDash([T * 0.05, T * 0.012, T * 0.02, T * 0.008]);
      c.strokeStyle = '#eef1f3'; c.lineWidth = T * 0.012;
      c.beginPath();
      for (const i of this.zt) { const kl = net.tKlasse[i]; if (kl === KLASSE.OPRIT || !nietTunnel(i)) continue; const e = pr[kl].asfalt / 2 * Tw; this.takPad(c, i, 0.1 * Tw, net.tLen[i] - 0.1 * Tw, e); this.takPad(c, i, 0.1 * Tw, net.tLen[i] - 0.1 * Tw, -e); }
      c.stroke(); c.setLineDash([]);
    }
    const vers = clamp(Math.max(this.wr.sneeuw * 1.8, (this.sz.sneeuw - 0.6) * 2.5), 0, 1);
    if (vers > 0.04 && z >= 5.5) {
      // het laagje ligt tot over de stoeprand (anders lijkt de donkere rand tussen de sneeuwhopen op dwarsliggers);
      // de rijsporen zijn brede, zachte banen waar het asfalt doorheen schemert
      c.globalAlpha = a * smooth(5.5, 6.5, z) * vers * 0.62;
      this.strook(c, nietTunnel, (kl) => (kl === KLASSE.OPRIT ? 0 : pr[kl].asfalt * Tw + 2 * RAND), '#e9edf0');
      if (z >= 7) {
        c.globalAlpha = a * smooth(7, 8, z) * vers * 0.5;
        c.strokeStyle = 'rgba(74,74,71,0.8)'; c.lineWidth = T * 0.013; c.beginPath();
        for (const i of this.zt) { const kl = net.tKlasse[i]; if (kl === KLASSE.OPRIT || !nietTunnel(i)) continue; const b = pr[kl].baan * Tw; for (const o of b ? [b - 0.012 * Tw, b + 0.012 * Tw, -b - 0.012 * Tw, -b + 0.012 * Tw] : [-0.012 * Tw, 0.012 * Tw]) this.takPad(c, i, 0, net.tLen[i], o); }
        c.stroke();
        this.n.sporenSneeuw = this.zt.length;
      }
    }
    // natte weg: glans in de regen
    if (this.wr.regen > 0.25 && z >= 6) {
      c.globalAlpha = a * clamp((this.wr.regen - 0.25) * 2, 0, 1) * 0.35;
      c.setLineDash([T * 0.05, T * 0.13, T * 0.02, T * 0.09]);
      this.strook(c, nietTunnel, (kl) => (kl === KLASSE.OPRIT ? 0 : pr[kl].asfalt * Tw * 0.5), 'rgba(190,205,220,0.5)', false);
      c.setLineDash([]);
    }
    c.globalAlpha = a;
    if (z >= 5) this.tekenMarkering(c, a * smooth(5, 6, z) * (1 - 0.6 * vers));
    c.restore();
  }

  // Hoe ver de markering van tak i bij knoop k wegblijft: bij een kruising, rotonde of licht tot voorbij het kruisvlak.
  markeerVrij(k, i) {
    const net = this.net;
    if (this.mvNet !== net || this.mvVersie !== net.versie) { this.mvNet = net; this.mvVersie = net.versie; this.mvC = new Float32Array(net.nT * 2).fill(-1); }
    const j = i * 2 + (net.tB[i] === k ? 1 : 0);
    if (this.mvC[j] < 0) this.mvC[j] = this.markeerVrijReken(k, i);
    return this.mvC[j];
  }

  markeerVrijReken(k, i) {
    const net = this.net, Tw = this.geo.T;
    if (net.kSoort[k] === NK.ROTONDE) return (ROTONDE_STRAAL + 0.09) * Tw;
    let n = 0, b = 0;
    for (let j = net.adj0[k]; j < net.adj0[k + 1]; j++) { const g = net.adj[j], t = g >= 0 ? g : ~g; if (net.tKlasse[t] === KLASSE.OPRIT) continue; n++; b = Math.max(b, PROFIEL[net.tKlasse[t]].asfalt); }
    void i;
    return n >= 3 ? (b / 2 + 0.07) * Tw : 0;
  }

  // Afstand vanaf knoop k waarop de stopstreep van tak i ligt (voor de zebra als die er is).
  stopAfstand(k, i) {
    const net = this.net, Tw = this.geo.T;
    const zb = this.zebraVan?.get(i * 2 + (net.tB[i] === k ? 1 : 0));
    if (zb) return (net.tB[i] === k ? net.tLen[i] - zb.s : zb.s) + 0.045 * Tw;
    return this.markeerVrij(k, i) + 0.01 * Tw;
  }

  tekenMarkering(c, a) {
    const net = this.net, Tw = this.geo.T, T = this.T, sc = this.sc, z = this.zoom, pr = PROFIEL;
    if (a <= 0.01) return;
    c.globalAlpha = a;
    // zebra's per tak en kant (voor de stopstrepen)
    if (!this.zebraVan || this.zebraNet !== net.versie) {
      this.zebraVan = new Map();
      for (const zb of net.zebras) this.zebraVan.set(zb.tak * 2 + (net.tB[zb.tak] === zb.knoop ? 1 : 0), zb);
      this.zebraNet = net.versie;
    }
    // hartlijnen: onderbroken op hoofdwegen, op stamwegen ook doorgetrokken kantstrepen
    c.strokeStyle = 'rgba(236,235,228,0.85)';
    c.lineWidth = Math.max(0.5, 0.006 * T);
    c.setLineDash([0.06 * T, 0.08 * T]);
    c.beginPath();
    for (const i of this.zt) {
      const kl = net.tKlasse[i];
      if ((kl !== KLASSE.HOOFD && kl !== KLASSE.STAM) || net.tBouw[i] === 3) continue;
      const v0 = this.markeerVrij(net.tA[i], i), v1 = this.markeerVrij(net.tB[i], i);
      this.takPad(c, i, v0, net.tLen[i] - v1, 0);
    }
    c.stroke();
    c.setLineDash([]);
    c.lineWidth = Math.max(0.5, 0.004 * T);
    c.beginPath();
    for (const i of this.zt) {
      if (net.tKlasse[i] !== KLASSE.STAM || net.tBouw[i] === 3) continue;
      const v0 = this.markeerVrij(net.tA[i], i), v1 = this.markeerVrij(net.tB[i], i), e = (pr[KLASSE.STAM].asfalt / 2 - 0.009) * Tw;
      this.takPad(c, i, v0, net.tLen[i] - v1, e);
      this.takPad(c, i, v0, net.tLen[i] - v1, -e);
    }
    c.stroke();
    if (z < DREMPEL.zebra - 0.5) return;
    c.globalAlpha = a * smooth(DREMPEL.zebra - 0.5, DREMPEL.zebra + 0.3, z);
    const o = this.po ??= {};
    c.fillStyle = WIT;
    c.beginPath();
    // zebra's: strepen langs de weg, over de hele breedte van het asfalt
    for (const zb of net.zebras) {
      const x = zb.x * sc + this.ox, y = zb.y * sc + this.oy;
      if (!this.opScherm(x, y, T * 0.2)) continue;
      net.puntIn(net.D, zb.tak, zb.s, o);
      const hx = Math.cos(o.hoek), hy = Math.sin(o.hoek), b = pr[net.tKlasse[zb.tak]].asfalt * T / 2;
      for (let k = -b + T * 0.012; k <= b - T * 0.008; k += T * 0.021) rechthoek(c, x - hy * k, y + hx * k, hx, hy, T * 0.017, T * 0.0065);
    }
    // stopstrepen op de inkomende strook bij elk licht
    for (const L of net.lichten) {
      const k = L.knoop, kx = net.kx[k] * sc + this.ox, ky = net.ky[k] * sc + this.oy;
      if (!this.opScherm(kx, ky, T * 0.5)) continue;
      for (const gIn of L.armen) {
        const i = gIn >= 0 ? gIn : ~gIn, kl = net.tKlasse[i], d = this.stopAfstand(k, i);
        if (d > net.tLen[i] * 0.6) continue;
        const naarB = gIn >= 0, s = naarB ? net.tLen[i] - d : d;
        net.puntIn(net.D, i, s, o);
        const hx = Math.cos(o.hoek), hy = Math.sin(o.hoek), b = pr[kl].asfalt / 2 * T, sg = naarB ? 1 : -1;
        const x = o.x * sc + this.ox, y = o.y * sc + this.oy, m = (b * 0.5 + T * 0.001) * sg;
        rechthoek(c, x - hy * m, y + hx * m, -hy, hx, b * 0.46, T * 0.003);
      }
    }
    // haaientanden waar een lagere klasse op een hogere uitkomt (kruisingen zonder licht)
    for (const k of this.zk) {
      if (net.kSoort[k] !== KRUISING && net.kSoort[k] !== NK.ROTONDE) continue;
      const A = this.armenVan(k);
      if (A.length < 3 && net.kSoort[k] !== NK.ROTONDE) continue;
      let hoog = -1;
      for (const p of A) hoog = Math.max(hoog, p.kl);
      for (const p of A) {
        if (net.kSoort[k] !== NK.ROTONDE && (p.kl >= hoog || p.kl === KLASSE.ERF)) continue;
        if (p.tunnel) continue;
        const i = p.i, d = this.markeerVrij(k, i) + 0.012 * Tw;
        if (d > net.tLen[i] * 0.6) continue;
        const naarB = net.tB[i] === k, s = naarB ? net.tLen[i] - d : d;
        net.puntIn(net.D, i, s, o);
        const hx = Math.cos(o.hoek) * (naarB ? 1 : -1), hy = Math.sin(o.hoek) * (naarB ? 1 : -1), b = pr[p.kl].asfalt / 2 * T;
        const x = o.x * sc + this.ox, y = o.y * sc + this.oy;
        // de punten wijzen naar de naderende bestuurder (van de knoop af)
        for (let q = T * 0.006; q < b - T * 0.004; q += T * 0.013) {
          const cx = x - hy * q, cy = y + hx * q;
          c.moveTo(cx - hy * T * 0.0045, cy + hx * T * 0.0045); c.lineTo(cx + hy * T * 0.0045, cy - hx * T * 0.0045); c.lineTo(cx - hx * T * 0.012, cy - hy * T * 0.012); c.closePath();
        }
      }
    }
    c.fill();
    // parkeervakken: korte witte streepjes langs de stoeprand
    if (z >= 7.5) {
      c.strokeStyle = 'rgba(236,235,228,0.7)'; c.lineWidth = Math.max(0.4, T * 0.0025); c.beginPath();
      for (const p of net.parkeerstroken) {
        const i = p.tak;
        if (!this.ztIn[i]) continue;
        const b = pr[net.tKlasse[i]].asfalt / 2 * Tw, stap = (p.s1 - p.s0) / p.plekken;
        for (let j = 0; j <= p.plekken; j++) {
          net.puntIn(net.D, i, p.s0 + j * stap, o);
          const hx = Math.cos(o.hoek), hy = Math.sin(o.hoek), nx = -hy * p.kant, ny = hx * p.kant;
          const x0 = o.x + nx * (b - 0.028 * Tw), y0 = o.y + ny * (b - 0.028 * Tw), x1 = o.x + nx * (b - 0.002 * Tw), y1 = o.y + ny * (b - 0.002 * Tw);
          c.moveTo(x0 * sc + this.ox, y0 * sc + this.oy); c.lineTo(x1 * sc + this.ox, y1 * sc + this.oy);
        }
      }
      c.stroke();
    }
    // haltes: een gele zigzag langs de stoeprand
    c.strokeStyle = GEEL; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
    for (const hl of net.haltes) {
      const x = hl.x * sc + this.ox, y = hl.y * sc + this.oy;
      if (!this.opScherm(x, y, T * 0.3)) continue;
      const i = hl.tak, b = pr[net.tKlasse[i]].asfalt / 2 * Tw - 0.008 * Tw;
      for (let j = 0; j <= 8; j++) {
        const s = clamp(hl.s - 0.09 * Tw + j * 0.0225 * Tw, 0, net.tLen[i]);
        net.puntIn(net.D, i, s, o);
        const nx = -Math.sin(o.hoek) * hl.kant, ny = Math.cos(o.hoek) * hl.kant, e = b - (j & 1 ? 0.012 * Tw : 0);
        const X = (o.x + nx * e) * sc + this.ox, Y = (o.y + ny * e) * sc + this.oy;
        if (j) c.lineTo(X, Y); else c.moveTo(X, Y);
      }
    }
    c.stroke();
  }

  // Verkeerslichten (per arm, op de stoep rechts van de stopstreep), bushokjes bij de haltes en lantaarns langs de
  // stamwegen. Wat getekend is, staat in this.lampen (knoop, arm, stand) voor de test.
  tekenWegmeubilair(c, a) {
    const net = this.net, Tw = this.geo.T, T = this.T, sc = this.sc, z = this.zoom, pr = PROFIEL, u = this.u, o = this.po ??= {};
    if (!this.zk) return;
    c.globalAlpha = a;
    for (const L of net.lichten) {
      const k = L.knoop, kx = net.kx[k] * sc + this.ox, ky = net.ky[k] * sc + this.oy;
      if (!this.opScherm(kx, ky, T * 0.5)) continue;
      for (let arm = 0; arm < L.armen.length; arm++) {
        const gIn = L.armen[arm], i = gIn >= 0 ? gIn : ~gIn, kl = net.tKlasse[i], d = this.stopAfstand(k, i);
        if (d > net.tLen[i] * 0.6) continue;
        const naarB = gIn >= 0, s = naarB ? net.tLen[i] - d : d, sg = naarB ? 1 : -1;
        net.puntIn(net.D, i, s, o);
        const hx = Math.cos(o.hoek) * sg, hy = Math.sin(o.hoek) * sg;
        const e = (pr[kl].asfalt / 2 + Math.max(0.012, pr[kl].stoep * 0.55)) * Tw;
        const x = (o.x - hy * e) * sc + this.ox, y = (o.y + hx * e) * sc + this.oy;
        const stand = lichtStand(net, k, arm, u);
        this.lampen.push(k, arm, stand);
        this.verkeerslicht(c, x, y, stand, hx, hy);
      }
    }
    // bushokjes
    if (z >= DREMPEL.halte - 1.5) {
      c.globalAlpha = a * smooth(DREMPEL.halte - 1.5, DREMPEL.halte - 0.5, z);
      for (const hl of net.haltes) {
        if (this.n.haltes >= PLAFOND.haltes) break;
        const i = hl.tak, kl = net.tKlasse[i];
        net.puntIn(net.D, i, hl.s, o);
        const hx = Math.cos(o.hoek), hy = Math.sin(o.hoek), nx = -hy * hl.kant, ny = hx * hl.kant;
        const e = (pr[kl].asfalt / 2 + pr[kl].stoep * 0.6) * Tw;
        const x = (o.x + nx * e) * sc + this.ox, y = (o.y + ny * e) * sc + this.oy;
        if (!this.opScherm(x, y, T * 0.1)) continue;
        this.n.haltes++;
        // schaduw, dak met een lichte rand, glazen achterwand aan de stoepkant
        c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); rechthoek(c, x + T * 0.008, y + T * 0.009, hx, hy, T * 0.03, T * 0.009); c.fill();
        c.fillStyle = '#3d4a52'; c.beginPath(); rechthoek(c, x, y, hx, hy, T * 0.03, T * 0.009); c.fill();
        c.fillStyle = 'rgba(190,215,230,0.55)'; c.beginPath(); rechthoek(c, x + nx * T * 0.004, y + ny * T * 0.004, hx, hy, T * 0.027, T * 0.003); c.fill();
        if (z >= DREMPEL.halte) { c.fillStyle = '#d9a63a'; c.beginPath(); stip(c, x + hx * T * 0.036, y + hy * T * 0.036, Math.max(0.7, T * 0.004)); c.fill(); }
        if (this.nacht > 0.05) this.zetLicht(x, y, Math.max(2, T * 0.04), KOEL, 0.55 * this.nacht);
      }
    }
    // lantaarns langs de stamwegen, om en om op de berm (in de stad zet stad.js ze op de stoep)
    if (z >= DREMPEL.lantaarn - 0.5) {
      c.globalAlpha = a * smooth(DREMPEL.lantaarn - 0.5, DREMPEL.lantaarn + 0.3, z);
      const S = SCHUIN;
      for (const i of this.zt) {
        if (net.tKlasse[i] !== KLASSE.STAM || net.tBouw[i] === 3) continue;
        const len = net.tLen[i], e = (pr[KLASSE.STAM].asfalt / 2 + 0.025) * Tw;
        for (let s = 0.25 * Tw, j = 0; s < len - 0.15 * Tw; s += 0.5 * Tw, j++) {
          if (this.n.lantaarns >= PLAFOND.lantaarns) break;
          net.puntIn(net.D, i, s, o);
          const kant = (j + net.tZaad[i]) & 1 ? 1 : -1, nx = -Math.sin(o.hoek) * kant, ny = Math.cos(o.hoek) * kant;
          const wx = o.x + nx * e, wy = o.y + ny * e;
          if (net.tBouw[i] === 0 && this.isWater(wx, wy)) continue;
          const x = wx * sc + this.ox, y = wy * sc + this.oy;
          if (!this.opScherm(x, y, T * 0.1)) continue;
          this.n.lantaarns++;
          const hgt = T * 0.06, kx = x - nx * T * 0.022, ky = y - ny * T * 0.022 - hgt;
          c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.5, T * 0.004);
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + hgt * S, y + hgt * S); c.stroke();
          c.strokeStyle = PAAL; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - hgt); c.lineTo(kx, ky); c.stroke();
          c.fillStyle = '#d8d6cc'; c.beginPath(); stip(c, kx, ky, Math.max(0.6, T * 0.004)); c.fill();
          if (this.nacht > 0.05) { this.zetLicht(kx, ky + hgt * 0.9, Math.max(3, T * 0.09), WARM, 0.55 * this.nacht); this.zetSpiegel(kx, ky + hgt, Math.max(2, T * 0.03), WARM, 0.5); }
        }
      }
    }
    c.globalAlpha = 1;
  }

  // Een verkeerslicht op (x, y) dat naar de weggebruiker kijkt die in richting (hx, hy) rijdt. stand: 0 rood, 1 groen,
  // 2 oranje (lichtStand).
  verkeerslicht(c, x, y, stand, hx = 0, hy = 1) {
    if (this.n.verkeerslichten >= PLAFOND.verkeerslichten || !this.opScherm(x, y, this.T * 0.1)) return;
    this.n.verkeerslichten++;
    const T = this.T, hgt = T * 0.045, z = this.zoom;
    const kleur = stand === 0 ? '#ff4a3a' : stand === 1 ? '#4dff7a' : '#ffb02e';
    const soort = stand === 0 ? ROOD : stand === 1 ? GROEN : AMBER;
    if (z < DREMPEL.verkeerslicht) {
      // van verder weg: een gekleurde stip op de stoep
      c.fillStyle = '#1d1f21'; c.beginPath(); stip(c, x, y, Math.max(0.8, T * 0.006)); c.fill();
      c.fillStyle = kleur; c.beginPath(); stip(c, x, y, Math.max(0.6, T * 0.0042)); c.fill();
      this.zetLicht(x, y, Math.max(2, T * 0.02), soort, 0.9);
      return;
    }
    c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = Math.max(0.6, T * 0.004);
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + hgt * SCHUIN, y + hgt * SCHUIN); c.stroke();
    c.strokeStyle = PAAL; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - hgt); c.stroke();
    // de kast staat dwars op de rijrichting; de lampen boven elkaar (rood boven, groen onder)
    const bx = x, by = y - hgt;
    c.fillStyle = '#1d1f21'; c.fillRect(bx - T * 0.006, by - T * 0.016, T * 0.012, T * 0.03);
    const pos = [0, 2, 1]; // rij van rood, groen, oranje in de kast
    c.fillStyle = 'rgba(80,80,80,0.9)'; c.beginPath();
    for (let j = 0; j < 3; j++) if (j !== pos[stand]) stip(c, bx, by - T * 0.01 + j * T * 0.009, T * 0.0033);
    c.fill();
    const ly = by - T * 0.01 + pos[stand] * T * 0.009;
    c.fillStyle = kleur; c.beginPath(); stip(c, bx, ly, T * 0.004); c.fill();
    this.zetLicht(bx, ly, Math.max(2, T * 0.02), soort, 0.9);
    this.zetSpiegel(bx + T * 0.004, y + T * 0.004, Math.max(2, T * 0.016), soort, 0.7);
    void hx; void hy;
  }

  tekenOverwegen(c) {
    const T = this.T, sc = this.sc, z = this.zoom, u = this.u;
    c.globalAlpha = smooth(6, 7, z);
    for (const o of this.overwegen) {
      const x = o.x * sc + this.ox, y = o.y * sc + this.oy;
      if (!this.opScherm(x, y, T * 0.2)) continue;
      // betonplaten over de hele breedte van de weg (langs het spoor gemeten dus breder naarmate de weg schuiner
      // kruist) en dwars over de grindbaan; de rails er weer overheen
      const kr = o.hx * o.uy - o.hy * o.ux, ak = Math.max(0.35, Math.abs(kr)), cosk = o.hx * o.ux + o.hy * o.uy;
      const b = PROFIEL[o.klasse ?? KLASSE.STRAAT].asfalt / 2, lp = T * (b + 0.008) / ak;
      c.fillStyle = '#8e8a80'; c.beginPath(); rechthoek(c, x, y, o.hx, o.hy, lp, T * 0.058); c.fill();
      c.strokeStyle = STAAL; c.lineWidth = Math.max(0.6, T * 0.0055); c.beginPath();
      for (const g of [-0.0175, 0.0175]) { const px = x - o.hy * g * T, py = y + o.hx * g * T; c.moveTo(px - o.hx * lp, py - o.hy * lp); c.lineTo(px + o.hx * lp, py + o.hy * lp); }
      c.stroke();
      if (z < DREMPEL.overweg - 1) continue;
      // slagbomen volgen de dicht-vensters; de rode lichten knipperen om en om op u
      const dicht = this.boomStand(o, u), knip = this.knippert(o, u) && frac(u / 0.7) < 0.5;
      const dp = (T * (b + 0.008) - T * 0.07 * cosk * (kr < 0 ? -1 : 1)) / ak;
      for (const k of [-1, 1]) {
        const nx = -o.uy * k, ny = o.ux * k;
        const px = x + o.ux * k * dp + nx * T * (b + 0.004), py = y + o.uy * k * dp + ny * T * (b + 0.004);
        const L = T * (b * 0.95);
        const ex = px - nx * L * dicht, ey = py - ny * L * dicht - T * 0.06 * (1 - dicht);
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.6, T * 0.006);
        c.beginPath(); c.moveTo(px + T * 0.01, py + T * 0.01); c.lineTo(ex + T * 0.01 + T * 0.03 * (1 - dicht), ey + T * 0.01 + T * 0.06 * (1 - dicht)); c.stroke();
        c.strokeStyle = WIT; c.lineWidth = Math.max(0.8, T * 0.007); c.beginPath(); c.moveTo(px, py); c.lineTo(ex, ey); c.stroke();
        c.strokeStyle = '#c43c32'; c.setLineDash([T * 0.01, T * 0.01]); c.beginPath(); c.moveTo(px, py); c.lineTo(ex, ey); c.stroke(); c.setLineDash([]);
        c.fillStyle = '#222'; c.fillRect(px - T * 0.006, py - T * 0.006, T * 0.012, T * 0.012);
        const aan = knip === (k > 0) && this.knippert(o, u);
        c.fillStyle = aan ? '#ff4a3a' : '#5a2a28'; c.beginPath(); stip(c, px, py - T * 0.02, T * 0.004); c.fill();
        if (aan) this.zetLicht(px, py - T * 0.02, Math.max(2, T * 0.025), ROOD, 1);
      }
    }
    c.globalAlpha = 1;
  }

  // ---------- treinen ----------

  // Aan de verre kant van elke lijn (zie maakRoute): een kort perron naast het spoor, met een witte rand, een lamp
  // en een rood-wit stootblok voorbij het eind van de rails.
  tekenKopperrons(c, a) {
    const T = this.T, sc = this.sc, R = this.routes;
    c.globalAlpha = a;
    for (let i = 0; i < this.nZr && this.n.kopperrons < PLAFOND.kopperrons; i++) {
      const r = R[this.zr[i]], L = r.L, Ltr = this.lengteTrein(r);
      const ex = r.x[r.n - 1] * sc + this.ox, ey = r.y[r.n - 1] * sc + this.oy;
      if (!this.opScherm(ex, ey, T * 0.8)) continue;
      this.n.kopperrons++;
      const lp = Math.min(L * 0.5, Ltr + 0.06 * this.geo.T), k = r.kopKant;
      this.punt(r, L - lp / 2);
      const mx = this.px * sc + this.ox, my = this.py * sc + this.oy, hx = this.hx, hy = this.hy, nx = -hy * k, ny = hx * k;
      const px = mx + nx * T * 0.078, py = my + ny * T * 0.078, hl = (lp / this.geo.T / 2) * T;
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); rechthoek(c, px + T * 0.006, py + T * 0.006, hx, hy, hl, T * 0.024); c.fill();
      c.fillStyle = '#a9a59b'; c.beginPath(); rechthoek(c, px, py, hx, hy, hl, T * 0.024); c.fill();
      c.fillStyle = WIT; c.beginPath(); rechthoek(c, px - nx * T * 0.021, py - ny * T * 0.021, hx, hy, hl, T * 0.0018); c.fill();
      // stootblok
      this.punt(r, L);
      const sx = this.px * sc + this.ox + this.hx * T * 0.012, sy = this.py * sc + this.oy + this.hy * T * 0.012;
      c.fillStyle = '#2b2b2b'; c.beginPath(); rechthoek(c, sx, sy, this.hx, this.hy, T * 0.006, T * 0.03); c.fill();
      c.fillStyle = '#c43c32'; c.beginPath(); rechthoek(c, sx, sy, this.hx, this.hy, T * 0.004, T * 0.026); c.fill();
      c.fillStyle = WIT; c.beginPath(); rechthoek(c, sx, sy, this.hx, this.hy, T * 0.0042, T * 0.008); c.fill();
      // lamp op het perron
      const lx = px + hx * hl * 0.6, ly = py + hy * hl * 0.6;
      c.fillStyle = PAAL; c.beginPath(); stip(c, lx, ly, Math.max(0.8, T * 0.005)); c.fill();
      if (this.nacht > 0.05) this.zetLicht(lx, ly - T * 0.03, Math.max(2, T * 0.05), 0, 0.7 * this.nacht);
    }
    c.globalAlpha = 1;
  }

  lengteTrein(r) { return r.treinen.length ? Math.min(r.treinen[0].totaal, r.L * 0.5) : 0; }

  // Reizigers die uitstappen: zodra een personentrein stilstaat (aan het perron van het station of aan het kopperron
  // aan de verre kant), stappen er uit elke wagon een paar mensen uit. Ze lopen naar het perron en dan naar de
  // uitgang: het stationsgebouw, de loopbrug of het gebouw aan het eind van de lijn, waar ze naar binnen gaan.
  // Alles volgt uit de tijd sinds de trein aankwam, dus ook als hij al weer vertrekt lopen ze gewoon door.
  tekenReizigers(c, a) {
    const T = this.T, Tw = this.geo.T, sc = this.sc, R = this.routes, K = ['#c0392b', '#2e86c1', '#f0b429', '#ecefe9', '#34495e', '#2f9e5b', '#8e5a9b', '#d9822b'];
    c.globalAlpha = a;
    for (let i = 0; i < this.nZr; i++) {
      const r = R[this.zr[i]];
      if (r.goederen) continue;
      for (let j = 0; j < r.treinen.length; j++) {
        const tr = r.treinen[j];
        this.treinStand(r, j);
        const per = this.per, Ltr = this.ltr, L = r.L, rit = this.rit, wacht = this.wacht, t = this.tTrein;
        for (let kant = 0; kant <= 1; kant++) {
          // aankomst: aan de verre kant op wacht + rit, terug bij het station op 2 · (wacht + rit) = per
          const ta = kant ? t - (wacht + rit) : t < wacht + rit ? t : t - per;
          if (ta < 0 || ta > 14) continue;
          if (!kant && !r.perron) continue;
          const nW = tr.lengtes.length, mensen = Math.min(nW * 2, 8);
          for (let m = 0; m < mensen && this.n.reizigers < PLAFOND.reizigers; m++) {
            const h1 = hash(r.zaad, j * 64 + m, 31 + kant), h2 = hash(r.zaad, j * 64 + m, 33 + kant);
            const tt = ta - 0.6 - 2.2 * h1;
            if (tt < 0) continue;
            // deur: ergens in de trein (de trein staat op [0, Ltr] bij het station en op [L - Ltr, L] aan de verre kant)
            const sd = (0.12 + 0.82 * ((m + 0.5 * h2) / mensen)) * Ltr, s0 = kant ? L - sd : sd;
            const stap = 0.25, loopV = 0.11 * Tw;
            // eerst de stap naar het perron, dan langs en (bij het station) dwars naar de uitgang
            let s = s0, dw, alfa = 1;
            const dwP = kant ? 0.078 * Tw * r.kopKant : r.perron.dw;
            if (tt < stap) dw = dwP * (0.4 + 0.6 * (tt / stap));
            else {
              const w = (tt - stap) * loopV;
              if (kant) {
                const lang = L + 0.05 * Tw - s0;
                if (w < lang) { s = s0 + w; dw = dwP; }
                else { s = L + 0.05 * Tw + (w - lang); dw = dwP * Math.max(0, 1 - (w - lang) / (0.1 * Tw)); alfa = clamp(1 - (w - lang) / (0.12 * Tw), 0, 1); }
              } else if (r.perron.uitS < 0) {
                const dwars = Math.abs(r.perron.uitDw - dwP);
                if (w < dwars) dw = dwP + Math.sign(r.perron.uitDw - dwP) * w;
                else { dw = r.perron.uitDw; alfa = clamp(1 - (w - dwars) / (0.04 * Tw), 0, 1); }
              } else {
                const lang = Math.abs(r.perron.uitS - s0);
                dw = dwP;
                if (w < lang) s = s0 + Math.sign(r.perron.uitS - s0) * w;
                else { s = r.perron.uitS; alfa = clamp(1 - (w - lang) / (0.05 * Tw), 0, 1); }
              }
            }
            if (alfa <= 0.02) continue;
            this.punt(r, Math.min(s, L));
            const over = s > L ? s - L : 0;
            const x = (this.px + this.hx * over - this.hy * dw) * sc + this.ox, y = (this.py + this.hy * over + this.hx * dw) * sc + this.oy;
            if (!this.opScherm(x, y, T * 0.02)) continue;
            this.n.reizigers++;
            const rr = Math.max(0.7, T * 0.008), zw = tt > stap && alfa >= 1 ? Math.sin(tt * 9 + m) * rr * 0.25 : 0;
            c.globalAlpha = a * alfa * 0.35; c.fillStyle = '#000'; c.beginPath(); stip(c, x + rr * 0.6, y + rr * 0.6, rr); c.fill();
            c.globalAlpha = a * alfa; c.fillStyle = K[Math.floor(h2 * K.length)]; c.beginPath(); stip(c, x, y + zw, rr); c.fill();
            c.fillStyle = '#e0b48f'; c.beginPath(); stip(c, x, y - rr * 0.9 + zw, rr * 0.55); c.fill();
          }
        }
      }
    }
    c.globalAlpha = 1;
  }

  // Waar trein j op route r op tijdstip u rijdt: this.kop (voorkant in de rijrichting), this.staart en this.rich (+1
  // heen, -1 terug). De dienstregeling is periodiek: this.per deelt 180, dus de stand op u is die op u + 180.
  treinStand(r, j, u = this.u) {
    const tr = r.treinen[j], Tw = this.geo.T, L = r.L, Ltr = Math.min(tr.totaal, L * 0.5);
    const v = Tw * (r.goederen ? 0.45 : 0.65), wacht = r.goederen ? 10 : 6;
    // de natuurlijke omloop afgerond naar boven op een deler van 180; de rit wordt iets sneller, nooit langzamer
    const nat = 2 * (Math.max(1, (L - Ltr) / v) + wacht);
    const per = DAG / Math.max(1, Math.floor(DAG / nat)), rit = per / 2 - wacht;
    this.per = per; this.rit = rit; this.wacht = wacht;
    const t = frac(u / per + tr.fase) * per;
    // cycloïde: optrekken en afremmen zonder schok
    const glad = (q) => q - Math.sin(TAU * q) / TAU;
    if (t < wacht) { this.rich = 1; this.kop = Ltr; }
    else if (t < wacht + rit) { this.rich = 1; this.kop = Ltr + (L - Ltr) * glad((t - wacht) / rit); }
    else if (t < 2 * wacht + rit) { this.rich = -1; this.kop = L - Ltr; }
    else { this.rich = -1; this.kop = (L - Ltr) - (L - Ltr) * glad((t - 2 * wacht - rit) / rit); }
    this.staart = this.kop - this.rich * Ltr;
    this.ltr = Ltr;
    this.tTrein = t;
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
        const pos = this.wagonPos ??= new Float32Array(PLAFOND.wagons * 6), inBerg = this.wagonTunnel ??= new Uint8Array(PLAFOND.wagons);
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
          // in een tunnel dekt het terrein de wagon af (tekenTunnels); dan ook geen licht dat erdoorheen schijnt
          inBerg[nw] = r.tunnel && this.inTunnel(r, (voor + achter) / 2) ? 1 : 0;
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
          if (this.nacht > 0.05 && !inBerg[k]) {
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
        if (this.inTunnel(r, q)) continue; // geen masttoppen die boven de berg uitsteken
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
          if (this.inTunnel(r, q)) continue; // een sein in de berg zou 's nachts door het terrein heen gloeien
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
      const t = stil ? 0 : this.u; // u: periodiek in 180 s, en alle perioden hieronder delen 180
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
        const u = -0.3 + 0.6 * tri(t / 45 + hash(hv.zaad, 9)), Hp = T * 0.05;
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
        const f = tri(t / 60 + hash(hv.zaad, 31)), u = -0.34 + 0.68 * f, rich = frac(t / 60 + hash(hv.zaad, 31)) < 0.5 ? 1 : -1;
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
        const dein = Math.sin((this.u / 5) * TAU + hv.zaad) * 0.004;
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
          const f = (this.u / 90 + hash(hv.zaad, 70 + k)) * TAU, u = Math.cos(f) * 0.24, v = dq + 0.32 + Math.sin(f) * 0.1;
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
    const PER = 90;
    const geland = this.wr.mist > 0.6 || this.wr.onweer > 0.5;
    const u = geland ? 0.9 : frac(this.u / PER + j * 0.5 + hash(v.zaad, 5));
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
          const f0 = this.u / 45 + hash(v.zaad, 41);
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
          const fm = tri(this.u / 60 + hash(v.zaad, 43));
          naar(-0.8 + 1.6 * fm, -0.1);
          const fr = frac(this.u / 60 + hash(v.zaad, 43)) < 0.5 ? 1 : -1, mx = Math.cos(v.hoek) * fr, my = Math.sin(v.hoek) * fr;
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
      const o = i * LICHT, r = b[o + 2];
      let soort = b[o + 3];
      const spiegel = soort >= SPIEGEL;
      if (spiegel) soort -= SPIEGEL;
      const sprite = soort === WARM ? view.lichtSprite : this.gloed[soort];
      if (!sprite) continue;
      c.globalAlpha = k * b[o + 4];
      // een spiegeling is smal en lang (r is hier de halve lengte)
      if (spiegel) c.drawImage(sprite, b[o] - r * 0.22, b[o + 1] - r, r * 0.44, r * 2);
      else c.drawImage(sprite, b[o] - r, b[o + 1] - r, r * 2, r * 2);
    }
    c.restore();
    void sc; void nu;
  }

  // Wat er dit beeld getekend is (voor de test en om te meten).
  telling() { return { ...this.n, lucht: this.nLucht, sprites: this.cache.size }; }

  statistiek() {
    let bruggen = 0, tunnels = 0, viaducten = 0, rotondes = 0;
    const soorten = [0, 0, 0, 0, 0, 0]; // boog, ligger, vakwerk, tui, hang, staalboog
    for (const d of this.wegen) { if (d.brug) for (const b of d.brug) { bruggen++; soorten[b.soort]++; } if (d.tunnel) tunnels += d.tunnel.length / 2; if (d.viaduct) viaducten += d.viaduct.length / 3; }
    for (const d of this.routes) { if (d.brug) for (const b of d.brug) { bruggen++; soorten[b.soort]++; } if (d.tunnel) tunnels += d.tunnel.length / 2; if (d.viaduct) viaducten += d.viaduct.length / 3; }
    const net = this.net;
    if (net) for (let k = 0; k < net.nK; k++) if (net.kSoort[k] === NK.ROTONDE) rotondes++;
    return { sprites: this.cache.size, bytes: this.bytes, gebakken: this.gebakken, routes: this.routes.length, vliegvelden: this.vliegvelden.length, havens: this.havens.length, depots: this.depots.length, stations: this.stations.length, lijnen: this.lijnen.length, pijpen: this.pijpen.length, kruisingen: this.kruisingen.length, overwegen: this.overwegen.length, wegen: this.wegen.length, bruggen, brugsoorten: { boog: soorten[BOOG], ligger: soorten[LIGGER], vakwerk: soorten[VAKWERK], tui: soorten[TUI], hang: soorten[HANG], staalboog: soorten[STAALBOOG] }, voetbruggen: this.voetbruggen.length, tunnels, viaducten, rotondes };
  }

  // Het afgeleide netwerk, alleen-lezen, voor andere lagen (bijvoorbeeld leven.js die treinreizigers wil laten lopen).
  netwerk() { return { routes: this.routes, stations: this.stations, vliegvelden: this.vliegvelden, havens: this.havens, depots: this.depots, lijnen: this.lijnen, pijpen: this.pijpen, kruisingen: this.kruisingen, overwegen: this.overwegen, wegen: this.wegen, voetbruggen: this.voetbruggen }; }
}
