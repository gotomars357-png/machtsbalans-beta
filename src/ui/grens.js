// Grenzen en macht op de kaart (pakket D van detailronde C8): waar landen ophouden en wie waar invloed heeft.
// - Grensovergangen: waar de wegennetten van twee buurlanden elkaar over de grens het dichtst naderen, een korte
//   verbindingsweg met een grenspost (slagbomen, douanehokjes, overkapping, de vlaggen van beide landen en een rij
//   wachtende vrachtwagens). Open tussen bondgenoten, streng tussen blokken, dicht en bewaakt in oorlog.
// - Grenslijnen op het land: paaltjes tussen bondgenoten, een laag hek naast zwevende landen, een hoog hek met
//   palen en een patrouillestrook tussen blokken, en in oorlog een dubbel hek met prikkeldraad, wachttorens met
//   zoeklichten, tankversperringen en patrouilles. Daarachter de frontlinie: loopgraven in zigzag,
//   zandzakstellingen en mijnenveldbordjes, vooral waar eenheden staan.
// - Bezet gebied: controleposten op de wegen, de vlag van de bezetter, schroeiplekken en puin.
// - Vlaggen: elk land een eigen fictieve vlag (banen, kantons en eenvoudige vormen uit de landkleur en het
//   volgnummer; geen echte vlaggen, geen kruisen, sterren of manen, geen tekst). Ze wapperen met de wind mee.
// - Macht op straat in de hoofdstad: reclame van het blok van de speler waar dat veel media-invloed heeft,
//   banieren en camera's in eenpartijstaten en militaire regimes, verkiezingsaffiches in democratieën, en alleen
//   voor het eigen geheime netwerk van de speler een paar figuren in lange jassen bij het regeringsgebouw.
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Plaatsing volgt uit vaste hashes van grensstuk,
// tegel en volgnummer; de klok stuurt alleen beweging. Geen Math.random, geen Date.
// Licht uit het noordwesten zoals de andere lagen: schaduwen vallen naar het zuidoosten, hoge dingen staan recht
// omhoog getekend. Detail komt trapsgewijs op (zie DREMPEL): zoom 4-6 hekken, torens, posten en vlaggen als grove
// vormen, 8-10 slagbomen, hokjes, vrachtwagens, tanden en patrouilles, 12-14 prikkeldraadrollen, douaniers,
// pionnen, camera's en de figuren in lange jassen.

import { inOorlog } from '../engine/leger.js';
import { seizoen, wind } from './seizoen.js';

// ---------- gedeelde hulpjes (eigen kopie, zie inzoom-spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
// Driehoeksgolf 0 → 1 → 0: heen en weer lopen.
const tri = (v) => 1 - Math.abs(1 - 2 * frac(v));
const TAU = Math.PI * 2;
const SCHUIN = 0.566; // schaduwlengte per hoogte-eenheid, zon op ~45° in het noordwesten (zoals infra.js)

// Canvasfabriek: pas bij gebruik een canvas maken, zodat de module ook zonder document (in Node) laadt.
const standaardFabriek = (w, h) => (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h })
  : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : null);
let fabriek = standaardFabriek;
export function zetCanvasFabriek(fn) { fabriek = fn ?? standaardFabriek; }

// ---------- vaste waarden ----------

// Harde plafonds per beeld: een lange oorlogsgrens mag nooit de framerate opeten.
export const PLAFOND = {
  stukken: 2400, runs: 160, palen: 700, torens: 24, tanden: 260, bordjes: 120, loopgraaf: 1600, stellingen: 40,
  soldaten: 90, overgangen: 12, wegen: 64, vrachtwagens: 60, hokjes: 24, slagbomen: 24, vlaggen: 70, bezet: 60, schroei: 90,
  puin: 90, controleposten: 16, borden: 24, affiches: 60, banieren: 24, cameras: 16, jassen: 6, lichten: 260,
  bundels: 16, voertuigen: 24, bruggen: 12, bouw: 2,
};
// Vanaf welke zoom iets verschijnt (de kaart wordt 'diep' op zoom 4). Andere lagen mogen dit lezen.
export const DREMPEL = {
  weg: 2, hek: 4.3, post: 4, toren: 4.5, loopgraaf: 4.5, vlag: 5, bezet: 4.5, macht: 6, hokje: 5.5, vrachtwagen: 5,
  tanden: 7, patrouille: 7, bordjes: 9, rollen: 12, douanier: 10, pion: 12, camera: 11, affiche: 10, jassen: 11, ambassade: 8,
};

// Grensklassen tussen twee landen.
export const BONDGENOOT = 0, NEUTRAAL = 1, BLOK = 2, OORLOG = 3;
const GEEN = 255;

// Grensrooster: dezelfde bemonstering als terrein.js, zodat hekken precies op de getekende grenslijn staan.
const W = 1000, H = 620;
const CH = 64; // brok in wereldeenheden (4x4 vakjes)
const OR = 2; // eigenaarmonsters per wereldeenheid
const RM = 4; // marge in monsters
const ON = CH * OR + 2 * RM; // 136
const STUK = 1; // afstand tussen grensstukken langs de grens, in wereldeenheden
const PS = 6; // per stuk: x, y, tx, ty, s (booglengte in de run), run
const RS = 6; // per run: begin, aantal, a (eigenaar aan de +n-kant), b (aan de −n-kant), lengte, zaad
// Afstanden dwars op de grens (wereldeenheden), vanaf de grenslijn het eigen land in.
const D_HEK = 1.0, D_TAND = 2.6, D_BORD = 4.4, D_GRAAF = 6.5, D_TOREN = 2.8, D_PATROUILLE = 1.9, D_STROOK = 1.8;
// Bits per stuk: of het stuk zelf en de punten ernaast op het goede land liggen (vast per brok).
// HEK: beide hekken (een eenheid aan weerszijden) staan op het land van hun eigen kant, dus niet in zee of een meer.
const OK = 1, T_PLUS = 2, T_MIN = 4, B_PLUS = 8, B_MIN = 16, G_PLUS = 32, G_MIN = 64, HEK = 128;
const MAX_WEG = 176; // langste verbindingsweg (11 vakjes): vroeg in het spel liggen de wegennetten nog ver uiteen
const GAT = 3.4; // het hek stopt zo ver voor en na een grenspost

// Kleuren. Fictief en zonder merken.
const ASFALT = '#4a4a47', RAND = '#0d0f12', STREEP = '#d8c87a', ZAND = '#c9b48a';
const TRUCK = ['#d9d4c4', '#b8442f', '#2f6d9a', '#d9a63a', '#3d7a4f', '#7a7d80', '#8a4a7a', '#e8e6df'];
const CABINE = ['#c43c32', '#2f5d8a', '#f2f2ee', '#3d6b48', '#d9a63a', '#55595e'];
const UNIFORM = ['#4f5a3a', '#3e4a32', '#5a5f46']; // olijf, voor soldaten
const DOUANE = { 0: '#5f86b0', 1: '#4a5f73', 2: '#2c3e57', 3: '#4f5a3a' }; // per klasse
const PARTIJ = ['#e0703a', '#3a8fd0', '#5aa84a', '#c9b03a', '#8a5ab8']; // verkiezingsaffiches, abstract
const JAS = ['#2b2d31', '#5c5346', '#3a3f47'];

// Vaste maten van een grenspost, in eenheden langs de weg (l, van a naar b) en dwars erop (d, naar rechts).
const POST_VRIJ = [[-2.5, 1.95], [2.5, -1.95], [-1.0, -3.2], [1.0, 3.2], [0, 2.2], [0, -2.2]]; // hokjes, vlaggen, pilaren
const POST_DREMPEL = [[-3.0, 0.95], [3.0, -0.95]];
const POST_BLOKKEN = [[-3.0, -0.65], [-3.0, 0.65], [3.0, 0], [-3.9, 0], [3.9, -0.65], [3.9, 0.65]]; // betonblokken in oorlog
const POST_EGELS = [[-4.8, 1.7], [-5.6, -1.6], [4.8, -1.7], [5.6, 1.6], [-6.4, 0.4], [6.4, -0.4]]; // tankegels in oorlog
const POST_WACHT = [[-3.4, 1.5], [-3.2, -1.6], [3.4, -1.5], [3.2, 1.6]]; // soldaten bij de hokjes in oorlog
const WIELEN = [-0.75, -0.45, 0.7]; // wielparen van een vrachtwagen, als deel van de halve lengte

// Plekken in de hoofdstad (vakje-coördinaten, −0,5..0,5), passend op de indeling van detail.js: het
// regeringsgebouw in het noordwesten, groenstroken met bomen op x ±0,20, ±0,32 en ±0,44 langs de oost-weststraat.
const BORDPLEK = [[-0.26, 0.14], [-0.38, 0.14], [0.38, -0.142]]; // reclameborden, tussen de bomen
const BANIER_X = [-0.40, -0.28, -0.16]; // banieren aan de zuidgevel van het regeringsgebouw
// controlepost in bezet gebied (langs, dwars): weg, hokje, vlag en de vier hoeken van de zandzakken
export const CP_PUNTEN = [0, 0, 0.2, 2.6, 0, -2.4, -1.2, 1.7, 1.2, 1.7, -1.2, -1.7, 1.2, -1.7];
const TUSSEN_BOMEN = [0.26, 0.38]; // banierpalen in de noordoostelijke groenstrook
const AFFICHE_X = [0.26, 0.38, 0.235, 0.285, 0.355, 0.405]; // verkiezingsborden, de eerste twee altijd
const JASPLEK = [-0.37, -0.078, -0.17, -0.082, -0.29, -0.072]; // x, y: op de stoep voor het regeringsgebouw
const CAMERA = [-0.165, -0.165, 0.165, -0.165, -0.165, 0.165, 0.165, 0.165, -0.1, -0.2]; // x, y per camera

// Licht in de lichtbuffer.
const WARM = 0, KOEL = 1, ROOD = 2, GROEN = 3;
const LICHTKLEUR = [[255, 214, 140], [225, 236, 255], [255, 60, 50], [80, 255, 120]];
const LICHT = 5; // x, y, r, soort, sterkte
const TOREN = 6; // x, y (scherm, voet), hoogte px, hoek naar de vijand, zaad, zichtbaar 0..1

// ---------- vlaggen ----------

// Kleuren voor vlaggen: bewust gebroken tinten (oker, pruim, zeegroen, leisteen), zodat er geen echte vlag ontstaat.
const VLAG_PALET = ['#ece6d2', '#24343f', '#c9a227', '#7a4b8a', '#2bb5a0', '#8a3b2f', '#5d7a3a', '#d9822b', '#3a5f7d', '#b8c4cc', '#a8323a', '#1f6f5c'];
const PATRONEN = 8, EMBLEMEN = 6;
const VW = 48, VH = 30; // maat van een gebakken vlag

function helder(h) { const n = parseInt(h.slice(1, 7), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }

function ontwerp(i, poging, blokKleur) {
  const h = (k) => hash(i + 1, k + poging * 17, 977);
  const hoofd = poging < 6 && blokKleur ? blokKleur : VLAG_PALET[Math.floor(h(1) * VLAG_PALET.length)];
  const lh = helder(hoofd);
  const tweeden = VLAG_PALET.filter((k) => k !== hoofd && Math.abs(helder(k) - lh) > 0.26);
  const tweede = tweeden[Math.floor(h(2) * tweeden.length)] ?? '#ece6d2';
  const derden = VLAG_PALET.filter((k) => k !== hoofd && k !== tweede && Math.abs(helder(k) - helder(tweede)) > 0.22);
  const derde = derden[Math.floor(h(3) * derden.length)] ?? '#24343f';
  const patroon = Math.floor(h(4) * PATRONEN);
  // een effen veld met alleen banen lijkt te veel op bestaande vlaggen: daar hoort altijd een vorm bij
  let embleem = Math.floor(h(5) * EMBLEMEN);
  if (embleem === EMBLEMEN - 1 && (patroon === 0 || patroon === 1 || patroon === 2 || patroon === 7)) embleem = 0;
  return { hoofd, tweede, derde, patroon, embleem };
}

// Vlagontwerp per land, vast per wereld: hoofdkleur uit de kleur van het blok waarmee het land begon (anders uit
// het palet), patroon en embleem uit het volgnummer. Twee landen krijgen nooit dezelfde vlag.
const ontwerpCache = new WeakMap();
export function vlagOntwerpen(state) {
  const P = state.pack;
  let lijst = ontwerpCache.get(P);
  if (lijst) return lijst;
  lijst = [];
  const gezien = {};
  for (let i = 0; i < P.landen.length; i++) {
    const blok = P.blokken.find((b) => b.id === P.landen[i].blok);
    let v = null;
    for (let poging = 0; poging < 40; poging++) {
      v = ontwerp(i, poging, blok?.kleur);
      const sleutel = `${v.patroon}|${v.embleem}|${v.hoofd}|${v.tweede}|${v.derde}`;
      if (!gezien[sleutel]) { gezien[sleutel] = 1; break; }
    }
    lijst.push(v);
  }
  ontwerpCache.set(P, lijst);
  return lijst;
}

// Een vlag in [0, w] x [0, h] met de mast links. Alleen rechte banen, driehoeken, ruiten en cirkels.
function bakVlag(g, v, w, h) {
  const A = v.hoofd, B = v.tweede, C = v.derde;
  const vak = (k, x, y, ww, hh) => { g.fillStyle = k; g.fillRect(x, y, ww, hh); };
  let ex = w * 0.5, ey = h * 0.5, er = h * 0.2, ek = C;
  switch (v.patroon) {
    case 0: vak(A, 0, 0, w, h); vak(B, 0, h * 0.3, w, h * 0.4); ek = C; break; // drie liggende banen
    case 1: vak(A, 0, 0, w / 3, h); vak(B, w / 3, 0, w / 3, h); vak(C, (2 * w) / 3, 0, w / 3, h); ek = A; break; // drie staande banen
    case 2: vak(A, 0, 0, w, h / 2); vak(B, 0, h / 2, w, h / 2); ex = w * 0.3; ek = C; break; // twee helften
    case 3: // schuin gedeeld
      vak(A, 0, 0, w, h);
      g.fillStyle = B; g.beginPath(); g.moveTo(w, 0); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
      ex = w * 0.26; ey = h * 0.3; er = h * 0.15; ek = C; break;
    case 4: // driehoek aan de mast
      vak(A, 0, 0, w, h / 2); vak(C, 0, h / 2, w, h / 2);
      g.fillStyle = B; g.beginPath(); g.moveTo(0, 0); g.lineTo(w * 0.42, h / 2); g.lineTo(0, h); g.closePath(); g.fill();
      ex = w * 0.13; er = h * 0.13; ek = Math.abs(helder(A) - helder(B)) > Math.abs(helder(C) - helder(B)) ? A : C; break;
    case 5: vak(B, 0, 0, w, h); vak(A, h * 0.16, h * 0.16, w - h * 0.32, h * 0.68); ek = C; break; // rand
    case 6: vak(A, 0, 0, w, h); vak(C, 0, h * 0.8, w, h * 0.2); vak(B, 0, 0, w * 0.42, h * 0.52); ex = w * 0.21; ey = h * 0.26; er = h * 0.14; ek = Math.abs(helder(C) - helder(B)) > 0.2 ? C : A; break; // kanton
    default: vak(A, 0, 0, w, h); vak(C, 0, h * 0.36, w, h * 0.28); vak(B, 0, h * 0.4, w, h * 0.2); ek = B; break; // smalle middenbaan
  }
  g.fillStyle = ek;
  g.beginPath();
  switch (v.embleem) {
    case 0: g.arc(ex, ey, er, 0, TAU); break; // schijf
    case 1: g.moveTo(ex, ey - er * 1.3); g.lineTo(ex + er, ey); g.lineTo(ex, ey + er * 1.3); g.lineTo(ex - er, ey); g.closePath(); break; // ruit
    case 2: g.arc(ex, ey, er, 0, TAU); g.arc(ex, ey, er * 0.55, 0, TAU, true); break; // ring
    case 3: g.rect(ex - er * 0.85, ey - er * 0.85, er * 1.7, er * 1.7); break; // vierkant
    case 4: g.arc(ex - er * 0.75, ey, er * 0.55, 0, TAU); g.moveTo(ex + er * 1.3, ey); g.arc(ex + er * 0.75, ey, er * 0.55, 0, TAU); break; // twee schijfjes
    default: break;
  }
  g.fill();
  // licht en schaduw: de mastzijde iets donkerder, een glans langs de bovenrand
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, 0, w * 0.05, h);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, w, h * 0.08);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, w - 1, h - 1);
}

// ---------- kleine sprites (vaste set, dus de cache groeit niet) ----------

function bakGloed(cv, [r, g, b]) {
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gr.addColorStop(0.35, `rgba(${r},${g},${b},0.45)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = gr;
  c.fillRect(0, 0, 32, 32);
}

// Lichtbundel van een zoeklicht: een kegel die vanaf de lamp (links) naar rechts uitwaaiert en vervaagt.
function bakBundel(cv) {
  const c = cv.getContext('2d');
  const gr = c.createLinearGradient(0, 0, 128, 0);
  gr.addColorStop(0, 'rgba(235,240,255,0.75)');
  gr.addColorStop(0.7, 'rgba(225,232,255,0.22)');
  gr.addColorStop(1, 'rgba(220,228,255,0)');
  c.fillStyle = gr;
  c.beginPath(); c.moveTo(0, 30); c.lineTo(128, 0); c.lineTo(128, 64); c.lineTo(0, 34); c.closePath(); c.fill();
}

// Schroeiplek: zwarte kern met een bruine, rafelige rand.
function bakSchroei(cv) {
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(18,14,10,0.85)');
  gr.addColorStop(0.45, 'rgba(38,28,18,0.55)');
  gr.addColorStop(0.8, 'rgba(70,52,30,0.2)');
  gr.addColorStop(1, 'rgba(70,52,30,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, 64, 64);
  c.fillStyle = 'rgba(25,20,14,0.5)';
  for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + hash(i, 3) * 0.5, d = 14 + hash(i, 4) * 10; c.beginPath(); c.arc(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 2 + hash(i, 5) * 3, 0, TAU); c.fill(); }
}

// Puin: brokken beton, baksteen of verkoold hout met schaduw naar het zuidoosten.
function bakPuin(cv, soort) {
  const c = cv.getContext('2d');
  const kleuren = [['#9a968c', '#b9b5aa', '#6e6a62'], ['#9a5a3e', '#b8714f', '#6b3e2b'], ['#3a3330', '#55493f', '#241f1c']][soort];
  for (let i = 0; i < 16; i++) {
    const a = hash(i, soort, 21) * TAU, d = hash(i, soort, 22) * 18, x = 32 + Math.cos(a) * d, y = 32 + Math.sin(a) * d * 0.8, r = 3 + hash(i, soort, 23) * 5;
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x - r + 2, y - r * 0.7 + 2, r * 2, r * 1.4);
    c.fillStyle = kleuren[i % 3]; c.fillRect(x - r, y - r * 0.7, r * 2, r * 1.4);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x - r, y - r * 0.7, r * 2, r * 0.35);
  }
}

// Gaasmotief voor het hoge hek: ruitjes van dunne draad.
function bakGaas(cv) {
  const c = cv.getContext('2d');
  c.strokeStyle = 'rgba(205,210,214,0.55)';
  c.lineWidth = 0.6;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(6, 6); c.moveTo(6, 0); c.lineTo(0, 6); c.stroke();
}

// ---------- grenzen uit het eigenaarrooster (eigen kopie van eigenaarRaster en ketensUitRaster in terrein.js) ----------

// Eigenaar op 2 monsters per eenheid met 4 monsters marge; bij een grenspixel de echte eigenaar, en veroverde
// vakjes krijgen hun nieuwe eigenaar. Schrijft in r (ON x ON).
function grensRaster(geo, eig, ck, cr, huidig, r) {
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
      if (e !== -1 && px >= 0 && py >= 0 && px < W && py < H) {
        const t = Math.floor(y / geo.T) * geo.kol + Math.floor(x / geo.T);
        const nu = huidig[t];
        if (nu !== geo.tegels[t].eig && nu !== -1) e = nu;
      }
      r[j * ON + i] = e;
    }
  }
}

function paarVan(r, k) {
  const v = k & 1, c = k >> 1;
  const a = r[c], b = v ? r[c + ON] : r[c + 1];
  return a < b ? (a + 4) * 65536 + b + 4 : (b + 4) * 65536 + a + 4;
}

// Gladstrijken met [1 2 1]/4, drie keer, zoals terrein.js: de trapjes van een halve eenheid verdwijnen.
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

// Grenslijnen als ketens van punten, met de eigenaars aan weerszijden (in wereldeenheden).
function grensKetens(r, ck, cr) {
  const ox = ck * CH - (RM - 1) / OR, oy = cr * CH - (RM - 1) / OR;
  const id = (i, j, v) => (j * ON + i) * 2 + v;
  const segA = [], segB = [], segPaar = [];
  const knoopX = new Map(), knoopY = new Map();
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
  const buren = new Map();
  const voeg = (k, s) => { const l = buren.get(k); if (l) l.push(s); else buren.set(k, [s]); };
  for (let s = 0; s < segA.length; s++) { voeg(segA[s], s); voeg(segB[s], s); }
  const gebruikt = new Uint8Array(segA.length);
  const ketens = [];
  const p = [0, 0];
  const verder = (start, s0, lijst) => {
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
    verder(segA[s], s, voor);
    const lA = buren.get(segA[s]);
    if (lA && lA.length === 2 && segA[s] >= 0) {
      const ander = lA[0] === s ? lA[1] : lA[0];
      if (!gebruikt[ander] && segPaar[ander] === segPaar[s]) verder(segA[s], ander, na);
    }
    const knopen = na.reverse().concat(voor);
    const pts = new Float32Array(knopen.length * 2);
    for (let q = 0; q < knopen.length; q++) { punt(knopen[q], p); pts[q * 2] = p[0]; pts[q * 2 + 1] = p[1]; }
    // de twee eigenaars van dit paar (het paar is voor alle segmenten van de keten gelijk)
    const pr = segPaar[s], e1 = Math.floor(pr / 65536) - 4, e2 = (pr % 65536) - 4;
    strijk(pts, knopen[0] === knopen[knopen.length - 1]);
    ketens.push({ e1, e2, pts });
  }
  return ketens;
}

// ---------- tekenhulpjes ----------

// Gedraaide rechthoek rond (x, y), lang 2l langs (hx, hy), breed 2w. Voegt toe aan het open pad.
function rechthoek(c, x, y, hx, hy, l, w) {
  const px = -hy * w, py = hx * w, lx = hx * l, ly = hy * l;
  c.moveTo(x + lx + px, y + ly + py);
  c.lineTo(x + lx - px, y + ly - py);
  c.lineTo(x - lx - px, y - ly - py);
  c.lineTo(x - lx + px, y - ly + py);
  c.closePath();
}

// Een stip: onder 1,5 px een vierkantje (sneller en net zo goed zichtbaar), anders een cirkel.
function stip(c, x, y, r) {
  if (r < 1.5) { c.rect(x - r, y - r, r * 2, r * 2); return; }
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, TAU);
}

// ---------- de laag ----------

export class GrensLaag {
  constructor() {
    // Eigen klok zoals de levenslaag: loopt alleen als het spel loopt, staat stil op pauze.
    this.klok = 0;
    this.state = null;
    this.geo = null;
    this.eigenaar = null;
    this.kolC = Math.ceil(W / CH);
    this.rijC = Math.ceil(H / CH);
    this.brokken = [];
    this.raster = new Int16Array(ON * ON);
    this.klas = new Uint8Array(0);
    this.klasSig = [];
    this.inOorlogLand = new Uint8Array(0);
    this.wegSig = [-1, -1, -1, -1];
    this.landSig = [];
    this.landWegen = [];
    this.paarSig = [];
    this.paarLijst = [];
    this.buren = [];
    this.burenVersie = -1;
    this.overgangen = [];
    this.controleposten = [];
    this.bezetVersie = -1;
    this.bezetLijst = new Int32Array(0);
    this.isBezet = new Uint8Array(0);
    // werkbuffers, één keer gemaakt en elke frame hergebruikt
    this.zr = new Int32Array(PLAFOND.runs * 5);
    this.nZr = 0;
    this.masker = new Uint8Array(PLAFOND.stukken);
    this.zo = new Int32Array(PLAFOND.wegen);
    this.nZo = 0;
    this.vlag = new Float32Array(PLAFOND.vlaggen * 6);
    this.licht = new Float32Array(PLAFOND.lichten * LICHT);
    this.toren = new Float32Array(PLAFOND.torens * TOREN);
    this.stempel = new Uint16Array(0);
    this.stempelNr = 0;
    this.sprites = null;
    this.vlagSprites = [];
    this.sz = seizoen(0);
    this.wnd = wind(0);
    this.szDag = -1;
    this.nul();
  }

  nul() {
    this.n = {};
    for (const k of Object.keys(PLAFOND)) this.n[k] = 0;
    this.nVlag = 0; this.nLicht = 0; this.nToren = 0; this.nZr = 0; this.nZo = 0;
  }

  // Na het laden van een spel: alles opnieuw afleiden.
  laad(view) {
    this.state = view.state;
    this.geo = view.geo;
    this.eigenaar = view.eigenaar;
    const n = this.geo.tegels.length;
    this.brokken = new Array(this.kolC * this.rijC).fill(null);
    this.oorsprong = Int16Array.from(this.geo.tegels, (t) => t.eig);
    this.stempel = new Uint16Array(n);
    this.isBezet = new Uint8Array(n);
    this.klasSig = [];
    this.wegSig = [-1, -1, -1, -1];
    this.infraSig = null;
    this.landSig = [];
    this.landWegen = [];
    this.paarSig = [];
    this.paarLijst = [];
    this.burenVersie = -1;
    this.bezetVersie = -1;
    this.overgangen = [];
    this.controleposten = [];
    this.vlagSprites = [];
  }

  // Eigenaar van een wereldpunt zoals de kaart hem toont (veroverde vakjes hebben hun nieuwe eigenaar).
  eigOp(x, y) {
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= W || py >= H) return -1;
    const e = this.eigenaar[py * W + px];
    if (e === -1) return -1;
    const T = this.geo.T, t = Math.floor(py / T) * this.geo.kol + Math.floor(px / T);
    const nu = this.state.eigenaar[t];
    return nu !== this.oorsprong[t] && nu !== -1 ? nu : e;
  }

  tegelVan(x, y) {
    const T = this.geo.T, k = Math.floor(x / T), r = Math.floor(y / T);
    if (k < 0 || r < 0 || k >= this.geo.kol || r >= this.geo.rij) return -1;
    return r * this.geo.kol + k;
  }

  // Staat hier een gebouw of een bouwwerk van de infralaag? Dan geen hek of loopgraaf eroverheen.
  bebouwd(x, y, view) {
    const t = this.tegelVan(x, y);
    if (t < 0) return true;
    if (this.state.bezet[t]) return true;
    return !!view?.infraLaag?.opBouwwerk?.(x, y);
  }

  zoet(view, x, y) { const tl = view.terreinLaag; return !!tl?.isZoetWater && tl.isZoetWater(x, y); }

  // Grensklasse tussen twee landen (BONDGENOOT, NEUTRAAL, BLOK of OORLOG). Voor andere lagen.
  grensKlasse(a, b) {
    const n = this.state?.landen.length ?? 0;
    if (a < 0 || b < 0 || a >= n || b >= n || this.klas.length !== n * n) return GEEN;
    return this.klas[a * n + b];
  }

  // ---------- afgeleide gegevens (alleen opnieuw als er iets verandert) ----------

  werkKlassen() {
    const s = this.state;
    // elk beeld vergelijken zonder iets te maken: de blokken van alle landen en de partijen van alle oorlogen
    const sig = this.klasSig, nl = s.landen.length, no = s.oorlogen.length;
    let zelfde = sig.length === nl + 2 * no;
    for (let i = 0; zelfde && i < nl; i++) zelfde = sig[i] === s.landen[i].alignment;
    for (let i = 0; zelfde && i < no; i++) zelfde = sig[nl + 2 * i] === s.oorlogen[i].a && sig[nl + 2 * i + 1] === s.oorlogen[i].b;
    if (zelfde) return;
    sig.length = 0;
    for (let i = 0; i < nl; i++) sig.push(s.landen[i].alignment);
    for (let i = 0; i < no; i++) sig.push(s.oorlogen[i].a, s.oorlogen[i].b);
    const n = s.landen.length;
    if (this.klas.length !== n * n) this.klas = new Uint8Array(n * n);
    if (this.inOorlogLand.length !== n) this.inOorlogLand = new Uint8Array(n);
    this.inOorlogLand.fill(0);
    const zwevend = (l) => !l.alignment || l.alignment === 'zwevend';
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        if (a === b) { this.klas[a * n + b] = GEEN; continue; }
        const A = s.landen[a], B = s.landen[b];
        let k;
        if (inOorlog(s, A, B)) { k = OORLOG; this.inOorlogLand[a] = 1; }
        else if (!zwevend(A) && A.alignment === B.alignment) k = BONDGENOOT;
        else if (zwevend(A) || zwevend(B)) k = NEUTRAAL;
        else k = BLOK;
        this.klas[a * n + b] = k;
      }
    }
  }

  // Bezette vakjes: de huidige eigenaar is een ander land dan het land waar het vakje bij hoorde.
  werkBezet() {
    const s = this.state;
    if (this.bezetVersie === s.grensVersie) return;
    this.bezetVersie = s.grensVersie;
    const lijst = [];
    this.isBezet.fill(0);
    for (let t = 0; t < this.oorsprong.length; t++) {
      const o = this.oorsprong[t], nu = s.eigenaar[t];
      if (o >= 0 && nu >= 0 && nu !== o) { lijst.push(t); this.isBezet[t] = 1; }
    }
    this.bezetLijst = Int32Array.from(lijst);
  }

  // Wegen per land: precies de lijnen van tekenWegen in map.js, met het stuk buiten beide gebouwen (zoals infra.js).
  wegenVan(view, land) {
    const geo = this.geo, Tw = geo.T, uit = [];
    for (const p of land.plaatsingen) {
      if (p.t < 0) continue;
      const nb = view.knooppuntVoor(land, p.t);
      if (nb < 0) continue;
      const A = geo.tegels[p.t], B = geo.tegels[nb];
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
      if (len < Tw * 0.9) continue;
      const ux = dx / len, uy = dy / len, d = (0.5 * Tw) / Math.max(Math.abs(ux), Math.abs(uy));
      if (len - 2 * d < 0.15 * Tw) continue;
      uit.push(A.x, A.y, B.x, B.y, ux, uy, d, len - d);
    }
    return Float32Array.from(uit);
  }

  werkWegen(view) {
    const s = this.state;
    let nP = 0, somT = 0;
    for (let i = 0; i < s.landen.length; i++) {
      const l = s.landen[i];
      nP += l.plaatsingen.length;
      for (let j = 0; j < l.plaatsingen.length; j++) somT += l.plaatsingen[j].t;
    }
    const sig = this.wegSig;
    // de infralaag rekent haar stations, vliegvelden en depots pas vanaf zoom 3,6 uit (wij al vanaf zoom 2): kent
    // zij een nieuw netwerk, dan alle overgangen opnieuw toetsen, anders blijft er een post op een station staan
    const infraSig = view.infraLaag?.sig ?? null;
    if (sig[0] === s.grensVersie && sig[1] === nP && sig[2] === somT && sig[3] === s.landen.length && this.infraSig === infraSig) return;
    sig[0] = s.grensVersie; sig[1] = nP; sig[2] = somT; sig[3] = s.landen.length;
    if (this.infraSig !== infraSig) { this.infraSig = infraSig; this.paarSig = []; }
    const n = s.landen.length;
    // per land alleen opnieuw als dat land iets bouwde (zoals infra.js)
    const veranderd = new Uint8Array(n);
    for (const land of s.landen) {
      let t = 0;
      for (const p of land.plaatsingen) t = (t * 31 + p.t + 7) | 0;
      const ls = `${land.plaatsingen.length}|${t}`;
      if (this.landSig[land.idx] === ls && this.landWegen[land.idx]) continue;
      this.landSig[land.idx] = ls;
      this.landWegen[land.idx] = this.wegenVan(view, land);
      veranderd[land.idx] = 1;
    }
    // buurlanden en de lengte van hun gedeelde grens, uit de vakjes
    if (this.burenVersie !== s.grensVersie) {
      this.burenVersie = s.grensVersie;
      const geo = this.geo, tel = new Int32Array(n * n);
      for (let r = 0; r < geo.rij; r++) {
        for (let k = 0; k < geo.kol; k++) {
          const t = r * geo.kol + k, a = s.eigenaar[t];
          if (a < 0) continue;
          if (k + 1 < geo.kol) { const b = s.eigenaar[t + 1]; if (b >= 0 && b !== a) tel[Math.min(a, b) * n + Math.max(a, b)]++; }
          if (r + 1 < geo.rij) { const b = s.eigenaar[t + geo.kol]; if (b >= 0 && b !== a) tel[Math.min(a, b) * n + Math.max(a, b)]++; }
        }
      }
      this.buren = [];
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (tel[a * n + b] >= 2) this.buren.push(a, b, tel[a * n + b]);
      this.paarSig = [];
    }
    const lijst = [];
    for (let q = 0; q < this.buren.length; q += 3) {
      const a = this.buren[q], b = this.buren[q + 1], sleutel = a * n + b;
      const ps = `${this.landSig[a]}#${this.landSig[b]}`;
      if (this.paarSig[sleutel] !== ps || veranderd[a] || veranderd[b] || !this.paarLijst[sleutel]) {
        this.paarSig[sleutel] = ps;
        this.paarLijst[sleutel] = this.zoekOvergangen(view, a, b, this.buren[q + 2]);
      }
      for (const g of this.paarLijst[sleutel]) lijst.push(g);
    }
    this.overgangen = lijst;
    this.zoekControleposten(view);
  }

  // Waar de wegennetten van a en b elkaar over de grens het dichtst naderen: een verbindingsweg met een post.
  zoekOvergangen(view, a, b, grens) {
    const Pa = this.wegPunten(a), Pb = this.wegPunten(b);
    if (!Pa.length || !Pb.length) return [];
    // kandidaten: paren punten op beide netten, kortste eerst; bijna dezelfde verbinding telt één keer, zodat er
    // ook verder weg nog keuze is als de dichtste plek niet kan (een gebouw op de grens, een meer)
    const K = 40, best = new Float64Array(K * 5).fill(Infinity), M2 = MAX_WEG * MAX_WEG;
    for (let i = 0; i < Pa.length; i += 2) {
      const ax = Pa[i], ay = Pa[i + 1];
      for (let j = 0; j < Pb.length; j += 2) {
        const bx = Pb[j], by = Pb[j + 1], d2 = (bx - ax) ** 2 + (by - ay) ** 2;
        if (d2 > M2 || d2 >= best[(K - 1) * 5]) continue;
        let dubbel = -1;
        for (let q = 0; q < K && best[q * 5] < Infinity; q++) if (Math.abs(best[q * 5 + 1] - ax) + Math.abs(best[q * 5 + 2] - ay) + Math.abs(best[q * 5 + 3] - bx) + Math.abs(best[q * 5 + 4] - by) < 20) { dubbel = q; break; }
        if (dubbel >= 0 && best[dubbel * 5] <= d2) continue;
        // een betere variant van een bestaande kandidaat vervangt die
        let q = dubbel >= 0 ? dubbel : K - 1;
        while (q > 0 && best[(q - 1) * 5] > d2) { for (let z = 0; z < 5; z++) best[q * 5 + z] = best[(q - 1) * 5 + z]; q--; }
        best[q * 5] = d2; best[q * 5 + 1] = ax; best[q * 5 + 2] = ay; best[q * 5 + 3] = bx; best[q * 5 + 4] = by;
      }
    }
    const uit = [];
    const max = grens >= 24 ? 2 : 1;
    for (let q = 0; q < K && uit.length < max; q++) {
      if (best[q * 5] === Infinity) break;
      const g = this.toetsWeg(view, best[q * 5 + 1], best[q * 5 + 2], best[q * 5 + 3], best[q * 5 + 4], a, b);
      if (!g) continue;
      if (uit.length && Math.hypot(uit[0].x - g.x, uit[0].y - g.y) < 80) continue;
      uit.push(g);
    }
    return uit;
  }

  // Punten om de 8 eenheden op de wegen van een land, van midden tot midden zoals tekenWegen ze trekt (het eind
  // ligt onder een gebouw of in de stad; toetsWeg laat de verbindingsweg daar naar buiten komen).
  wegPunten(land) {
    const Wl = this.landWegen[land], uit = [];
    if (!Wl) return uit;
    for (let i = 0; i < Wl.length; i += 8) {
      const len = Math.hypot(Wl[i + 2] - Wl[i], Wl[i + 3] - Wl[i + 1]), n = Math.max(1, Math.round(len / 8));
      for (let k = 0; k <= n; k++) uit.push(Wl[i] + (Wl[i + 2] - Wl[i]) * (k / n), Wl[i + 1] + (Wl[i + 3] - Wl[i + 1]) * (k / n));
    }
    return uit;
  }

  // Hoe ver een straal vanuit (x, y) in richting (ux, uy) loopt voordat hij het vakje t verlaat.
  uitVakje(t, x, y, ux, uy) {
    const T = this.geo.T, k = t % this.geo.kol, r = (t - k) / this.geo.kol;
    const tx = ux > 1e-9 ? ((k + 1) * T - x) / ux : ux < -1e-9 ? (k * T - x) / ux : Infinity;
    const ty = uy > 1e-9 ? ((r + 1) * T - y) / uy : uy < -1e-9 ? (r * T - y) / uy : Infinity;
    return Math.max(0, Math.min(tx, ty));
  }

  // Vanaf het eind van een weg door aaneengesloten bebouwde vakjes van het eigen land naar buiten (een weg de
  // stad uit); geeft de afstand tot het eerste vrije punt.
  uitStad(x, y, ux, uy, land) {
    let d = 0;
    for (let i = 0; i < 6; i++) {
      const t = this.tegelVan(x + ux * d, y + uy * d), b = t >= 0 ? this.state.bezet[t] : null;
      if (!b || b.land !== land) return d;
      d += this.uitVakje(t, x + ux * d, y + uy * d, ux, uy) + 0.3;
    }
    return d;
  }

  // Een verbindingsweg mag niet door zee, een meer, een derde land of een gebouw, en kruist de grens één keer.
  // Begint hij onder een gebouw of in een stad (waar de weg van tekenWegen eindigt), dan gaat hij er aan de
  // andere kant uit: dat stuk telt niet mee en wordt ook niet getekend.
  toetsWeg(view, ax, ay, bx, by, a, b) {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < 1.5 || len > MAX_WEG) return null;
    if (this.eigOp(ax, ay) !== a || this.eigOp(bx, by) !== b) return null;
    const ux = dx / len, uy = dy / len;
    const s0 = this.uitStad(ax, ay, ux, uy, a), s1 = len - this.uitStad(bx, by, -ux, -uy, b);
    if (s1 - s0 < 9) return null; // ruimte voor de post en een vrachtwagen aan elke kant
    const n = Math.ceil((s1 - s0) / 0.3);
    let wissel = -1, vorige = a;
    const brug = [];
    let inRivier = -1;
    const tl = view.terreinLaag;
    for (let k = 0; k <= n; k++) {
      const sk = s0 + ((s1 - s0) * k) / n, x = ax + ux * sk, y = ay + uy * sk;
      const o = this.eigOp(x, y);
      if (o !== a && o !== b) return null;
      if (o === b && vorige === a) { if (wissel >= 0) return null; wissel = k; }
      if (o === a && vorige === b) return null;
      vorige = o;
      if (this.bebouwd(x, y, view)) return null;
      if (tl?.isMeer?.(x, y)) return null;
      const nat = !!tl?.isRivier?.(x, y, 0.4);
      if (nat && inRivier < 0) inRivier = sk - s0;
      if (!nat && inRivier >= 0) { brug.push(Math.max(0, inRivier - 0.8), Math.min(s1 - s0, sk - s0 + 0.8)); inRivier = -1; }
    }
    if (wissel < 1) return null;
    if (inRivier >= 0) return null; // eindigt in een rivier
    const la = ((s1 - s0) * (wissel - 0.5)) / n, lb = s1 - s0 - la;
    if (la < 4.5 || lb < 4.5) return null;
    const x = ax + ux * (s0 + la), y = ay + uy * (s0 + la);
    // de post zelf (hokjes en vlaggen tot 3,5 eenheid van de weg) mag niet op een rivier, een gebouw of in zee staan
    for (const [l, d] of POST_VRIJ) {
      const px = x + ux * l - uy * d, py = y + uy * l + ux * d;
      if (this.eigOp(px, py) < 0 || tl?.isRivier?.(px, py, 0.2) || tl?.isMeer?.(px, py) || this.bebouwd(px, py, view)) return null;
    }
    for (let q = 0; q < brug.length; q += 2) if (Math.abs(la - brug[q]) < 4 || Math.abs(la - brug[q + 1]) < 4) return null;
    const x0 = ax + ux * s0, y0 = ay + uy * s0, x1 = ax + ux * s1, y1 = ay + uy * s1;
    return { x, y, ux, uy, a, b, ax: x0, ay: y0, bx: x1, by: y1, la, lb, len: s1 - s0, brug, zaad: (Math.floor(x * 7) * 7919 + Math.floor(y * 7)) | 0 };
  }

  // Controleposten in bezet gebied: waar een weg door een bezet vakje loopt, één per vakje.
  zoekControleposten(view) {
    this.werkBezet();
    const s = this.state, uit = [], gehad = {};
    // hokje, vlag en zandzakken moeten op droog land staan, niet op een gebouw of bouwwerk
    const vrij = (x, y, ux, uy, l, d) => {
      const px = x + ux * l - uy * d, py = y + uy * l + ux * d;
      return this.eigOp(px, py) >= 0 && !this.zoet(view, px, py) && !this.bebouwd(px, py, view);
    };
    if (!this.bezetLijst.length) { this.controleposten = uit; return; }
    for (let L = 0; L < s.landen.length && uit.length < 60; L++) {
      const Wl = this.landWegen[L];
      if (!Wl) continue;
      for (let i = 0; i < Wl.length && uit.length < 60; i += 8) {
        for (let q = Wl[i + 6] + 2; q < Wl[i + 7] - 2; q += 4) {
          const x = Wl[i] + Wl[i + 4] * q, y = Wl[i + 1] + Wl[i + 5] * q, t = this.tegelVan(x, y);
          if (t < 0 || !this.isBezet[t] || gehad[t] || s.bezet[t]) continue;
          // de eerste plek op deze weg in het vakje waar de hele post past (anders verder langs de weg zoeken)
          const ux = Wl[i + 4], uy = Wl[i + 5];
          let past = true;
          for (let j = 0; j < CP_PUNTEN.length && past; j += 2) past = vrij(x, y, ux, uy, CP_PUNTEN[j], CP_PUNTEN[j + 1]);
          if (!past) continue;
          gehad[t] = 1;
          uit.push({ x, y, ux, uy, land: s.eigenaar[t], t });
          break;
        }
      }
    }
    this.controleposten = uit;
  }

  // ---------- grensstukken per brok (lui, hooguit een paar per beeld) ----------

  brokSig(ck, cr) {
    const s = this.state, geo = this.geo;
    let e = 7;
    for (let r = cr * 4 - 1; r <= cr * 4 + 4; r++) {
      if (r < 0 || r >= geo.rij) continue;
      for (let k = ck * 4 - 1; k <= ck * 4 + 4; k++) {
        if (k < 0 || k >= geo.kol) continue;
        e = (Math.imul(e, 31) + s.eigenaar[r * geo.kol + k] + 3) | 0;
      }
    }
    return e;
  }

  brokVan(view, ck, cr) {
    const bi = cr * this.kolC + ck;
    const e = this.brokken[bi], sig = this.brokSig(ck, cr);
    if (e && e.sig === sig) return e;
    if (this.n.bouw >= PLAFOND.bouw) return e; // budget op: dit beeld nog de oude grens, het volgende de nieuwe
    this.n.bouw++;
    const nieuw = this.bouwBrok(view, ck, cr, sig);
    this.brokken[bi] = nieuw;
    return nieuw;
  }

  bouwBrok(view, ck, cr, sig) {
    const s = this.state, geo = this.geo;
    grensRaster(geo, this.eigenaar, ck, cr, s.eigenaar, this.raster);
    const ketens = grensKetens(this.raster, ck, cr);
    const x0 = ck * CH, y0 = cr * CH;
    const st = [], runs = [];
    for (const kt of ketens) {
      if (kt.e1 < 0 || kt.e2 < 0 || kt.e1 === kt.e2) continue;
      const p = kt.pts, m = p.length / 2;
      // een segment hoort bij de brok waarin zijn midden ligt: geen dubbele en geen ontbrekende stukken op de naad
      const binnen = (q) => { const mx = (p[q * 2] + p[q * 2 + 2]) / 2, my = (p[q * 2 + 1] + p[q * 2 + 3]) / 2; return mx >= x0 && mx < x0 + CH && my >= y0 && my < y0 + CH; };
      let q = 0;
      while (q < m - 1) {
        while (q < m - 1 && !binnen(q)) q++;
        if (q >= m - 1) break;
        const q0 = q;
        while (q < m - 1 && binnen(q)) q++;
        this.bemonster(p, q0, q, st, runs, kt);
      }
    }
    const n = st.length / PS, nr = runs.length / RS;
    const stukken = Float32Array.from(st), rf = Float32Array.from(runs);
    // vaste bits per stuk: ligt het stuk op land, en liggen de punten ernaast op het land van die kant?
    const bits = new Uint8Array(n), graaf = new Float32Array(n * 4);
    for (let r = 0; r < nr; r++) {
      const b0 = rf[r * RS], cnt = rf[r * RS + 1], A = rf[r * RS + 2], B = rf[r * RS + 3];
      for (let i = b0; i < b0 + cnt; i++) {
        const o = i * PS, x = stukken[o], y = stukken[o + 1], nx = -stukken[o + 3], ny = stukken[o + 2], sb = stukken[o + 4];
        let v = 0;
        if (this.eigOp(x, y) >= 0 && !this.zoet(view, x, y)) v |= OK;
        const zij = (d, eig) => { const px = x + nx * d, py = y + ny * d; return this.eigOp(px, py) === eig && !this.zoet(view, px, py); };
        if (zij(D_TAND + 0.6, A)) v |= T_PLUS;
        if (zij(-D_TAND - 0.6, B)) v |= T_MIN;
        if (zij(D_BORD, A)) v |= B_PLUS;
        if (zij(-D_BORD, B)) v |= B_MIN;
        // loopgraaf in zigzag: elke 5 eenheden een knik
        const zz = D_GRAAF + 0.8 * (tri(sb / 5) * 2 - 1);
        graaf[i * 4] = x + nx * zz; graaf[i * 4 + 1] = y + ny * zz;
        graaf[i * 4 + 2] = x - nx * zz; graaf[i * 4 + 3] = y - ny * zz;
        if (zij(zz, A) && zij(zz - 1.6, A)) v |= G_PLUS;
        if (zij(-zz, B) && zij(-zz + 1.6, B)) v |= G_MIN;
        if (zij(D_HEK + 0.3, A) && zij(-D_HEK - 0.3, B)) v |= HEK;
        bits[i] = v;
      }
    }
    return { sig, ck, cr, st: stukken, n, runs: rf, nr, bits, graaf };
  }

  // Een run punten (q0..q1) op vaste afstanden bemonsteren; stukken en run komen in st en runs.
  bemonster(p, q0, q1, st, runs, kt) {
    let L = 0;
    for (let q = q0; q < q1; q++) L += Math.hypot(p[q * 2 + 2] - p[q * 2], p[q * 2 + 3] - p[q * 2 + 1]);
    if (L < 0.8) return;
    const begin = st.length / PS, run = runs.length / RS;
    let acc = 0, q = q0, segL = Math.hypot(p[q * 2 + 2] - p[q * 2], p[q * 2 + 3] - p[q * 2 + 1]);
    for (let sP = STUK / 2; sP <= L; sP += STUK) {
      while (acc + segL < sP && q < q1 - 1) { acc += segL; q++; segL = Math.hypot(p[q * 2 + 2] - p[q * 2], p[q * 2 + 3] - p[q * 2 + 1]); }
      const f = segL > 0 ? clamp((sP - acc) / segL, 0, 1) : 0;
      const dx = p[q * 2 + 2] - p[q * 2], dy = p[q * 2 + 3] - p[q * 2 + 1], dl = Math.hypot(dx, dy) || 1;
      st.push(p[q * 2] + dx * f, p[q * 2 + 1] + dy * f, dx / dl, dy / dl, sP, run);
    }
    const n = st.length / PS - begin;
    if (!n) return;
    // welke eigenaar ligt aan de +n-kant (n = (−ty, tx))? kijk in het midden van de run
    const o = (begin + (n >> 1)) * PS, x = st[o], y = st[o + 1], nx = -st[o + 3], ny = st[o + 2];
    const plus = this.eigOp(x + nx * 1.6, y + ny * 1.6), min = this.eigOp(x - nx * 1.6, y - ny * 1.6);
    const omgekeerd = plus === kt.e2 || min === kt.e1;
    const a = omgekeerd ? kt.e2 : kt.e1, b = omgekeerd ? kt.e1 : kt.e2;
    runs.push(begin, n, a, b, L, (Math.floor(st[begin * PS] * 4) * 7919 + Math.floor(st[begin * PS + 1] * 4)) | 0);
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
  }

  inBeeld(wx, wy, m) { return wx > this.wx0 - m && wx < this.wx1 + m && wy > this.wy0 - m && wy < this.wy1 + m; }

  omgeving() {
    const dag = this.state.dag ?? 0;
    if (this.szDag !== dag) { this.sz = seizoen(dag); this.wnd = wind(dag); this.szDag = dag; }
    this.sneeuw = this.sz.sneeuw;
  }

  zetLicht(x, y, r, soort, a) {
    if (this.nLicht >= PLAFOND.lichten || x < -r || y < -r || x > this.w + r || y > this.h + r) return;
    const o = this.nLicht++ * LICHT, b = this.licht;
    b[o] = x; b[o + 1] = y; b[o + 2] = r; b[o + 3] = soort; b[o + 4] = a;
  }

  // Vlag in de buffer: voet (wereld), hoogte van de mast en lengte van het doek in wereldeenheden.
  zetVlag(wx, wy, mast, lengte, land, zaad) {
    if (this.nVlag >= PLAFOND.vlaggen || land < 0 || !this.inBeeld(wx, wy, mast + lengte + 1)) return;
    const o = this.nVlag++ * 6, b = this.vlag;
    b[o] = wx; b[o + 1] = wy; b[o + 2] = mast; b[o + 3] = lengte; b[o + 4] = land; b[o + 5] = zaad;
  }

  sprite() {
    if (this.sprites) return this.sprites;
    const maak = (w, h, fn) => { const cv = fabriek(w, h); if (cv) fn(cv); return cv; };
    this.sprites = {
      gloed: LICHTKLEUR.map((k) => maak(32, 32, (cv) => bakGloed(cv, k))),
      bundel: maak(128, 64, bakBundel),
      schroei: maak(64, 64, bakSchroei),
      puin: [0, 1, 2].map((s) => maak(64, 64, (cv) => bakPuin(cv, s))),
      gaas: maak(6, 6, bakGaas),
      gaasPatroon: null,
    };
    return this.sprites;
  }

  vlagSprite(land, spiegel) {
    const k = land * 2 + (spiegel ? 1 : 0);
    let cv = this.vlagSprites[k];
    if (cv !== undefined) return cv;
    cv = fabriek(VW, VH);
    if (cv) {
      const g = cv.getContext('2d');
      if (spiegel) { g.translate(VW, 0); g.scale(-1, 1); }
      bakVlag(g, vlagOntwerpen(this.state)[land] ?? vlagOntwerpen(this.state)[0], VW, VH);
    }
    this.vlagSprites[k] = cv;
    return cv;
  }

  // Tussen de gebouwen en het leven: alles wat op en langs de grens staat.
  teken(c, view, sc, nu, dt = 0, tempo = 0) {
    if (tempo > 0) this.klok += dt;
    this.nul();
    const s = view.state;
    if (!s || !view.geo || !view.w || !view.eigenaar) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar) this.laad(view);
    const z = view.zoom;
    this.zoom = z;
    // lijnen langs de grens: ver weg om de drie eenheden een punt, dichtbij elke eenheid (de grens is gladgestreken)
    this.stap = z < 6 ? 3 : z < 10 ? 2 : 1;
    this.nacht = view.nacht ?? 0;
    this.nu = nu;
    if (z < DREMPEL.weg) return;
    this.werkKlassen();
    this.werkBezet();
    this.werkWegen(view);
    this.kader(view, sc);
    this.omgeving();
    this.sprite();
    c.save();
    c.lineCap = 'butt';
    c.lineJoin = 'round';
    // zichtbare overgangen (ook voor het gat in het hek): de hele verbindingsweg telt, dus ook als je midden op een
    // lange weg inzoomt en de post en beide uiteinden buiten beeld liggen; de marge dekt de post met zijn egels
    for (let i = 0; i < this.overgangen.length && this.nZo < PLAFOND.wegen; i++) {
      const g = this.overgangen[i];
      if (Math.max(g.ax, g.bx) > this.wx0 - 14 && Math.min(g.ax, g.bx) < this.wx1 + 14 && Math.max(g.ay, g.by) > this.wy0 - 14 && Math.min(g.ay, g.by) < this.wy1 + 14) this.zo[this.nZo++] = i;
    }
    this.n.wegen = this.nZo;
    this.n.overgangen = 0;
    this.tekenVerbindingswegen(c, smooth(DREMPEL.weg, DREMPEL.weg + 0.6, z));
    if (z >= DREMPEL.post - 0.4) {
      this.verzamel(view);
      const a = smooth(DREMPEL.hek - 0.3, DREMPEL.hek + 0.5, z);
      this.tekenStroken(c, a);
      if (z >= DREMPEL.loopgraaf - 0.3) this.tekenLoopgraven(c, smooth(DREMPEL.loopgraaf - 0.3, DREMPEL.loopgraaf + 0.5, z), view);
      if (z >= DREMPEL.bezet - 0.3) this.tekenBezetGrond(c, smooth(DREMPEL.bezet - 0.3, DREMPEL.bezet + 0.5, z), view);
      if (z >= DREMPEL.tanden - 0.5) this.tekenTanden(c, smooth(DREMPEL.tanden - 0.5, DREMPEL.tanden + 0.3, z));
      if (z >= DREMPEL.bordjes - 0.5) this.tekenBordjes(c, smooth(DREMPEL.bordjes - 0.5, DREMPEL.bordjes + 0.3, z));
      this.tekenHekken(c, a);
      if (z >= DREMPEL.toren - 0.3) this.tekenTorens(c, smooth(DREMPEL.toren - 0.3, DREMPEL.toren + 0.5, z));
      this.tekenPosten(c, smooth(DREMPEL.post - 0.4, DREMPEL.post + 0.4, z));
      if (z >= DREMPEL.bezet) this.tekenControleposten(c, smooth(DREMPEL.bezet, DREMPEL.bezet + 0.6, z));
      if (z >= DREMPEL.patrouille - 0.5) this.tekenPatrouilles(c, smooth(DREMPEL.patrouille - 0.5, DREMPEL.patrouille + 0.3, z));
      this.tekenMacht(c, view);
      this.tekenVlaggen(c, smooth(DREMPEL.vlag - 0.4, DREMPEL.vlag + 0.4, z), nu);
    }
    c.restore();
    this.n.vlaggen = this.nVlag;
    this.n.lichten = this.nLicht;
    this.n.torens = this.nToren;
  }

  // Zichtbare runs en per stuk of er iets mag staan (niet op een gebouw, niet in een grenspost, niet in het water).
  verzamel(view) {
    const m = 8;
    const ck0 = Math.max(0, Math.floor((this.wx0 - m) / CH)), ck1 = Math.min(this.kolC - 1, Math.floor((this.wx1 + m) / CH));
    const cr0 = Math.max(0, Math.floor((this.wy0 - m) / CH)), cr1 = Math.min(this.rijC - 1, Math.floor((this.wy1 + m) / CH));
    // dichtstbijzijnde brokken eerst, zodat het bouwbudget naar het midden van het beeld gaat
    let nm = 0;
    const mx = (this.wx0 + this.wx1) / 2, my = (this.wy0 + this.wy1) / 2;
    const volg = this._volg ?? (this._volg = new Int32Array(this.kolC * this.rijC));
    let nv = 0;
    for (let cr = cr0; cr <= cr1; cr++) for (let ck = ck0; ck <= ck1; ck++) volg[nv++] = cr * this.kolC + ck;
    // invoegsortering op afstand (hooguit een paar tientallen brokken)
    const afst = (bi) => { const ck = bi % this.kolC, cr = (bi - ck) / this.kolC; return (ck * CH + CH / 2 - mx) ** 2 + (cr * CH + CH / 2 - my) ** 2; };
    for (let i = 1; i < nv; i++) { const v = volg[i], d = afst(v); let j = i - 1; while (j >= 0 && afst(volg[j]) > d) { volg[j + 1] = volg[j]; j--; } volg[j + 1] = v; }
    const s = this.state, kol = this.geo.kol, Tw = this.geo.T;
    // alleen de posten bij het beeld maken een gat in het hek
    const gat = this._gat ?? (this._gat = new Float32Array(PLAFOND.wegen * 2));
    let ng = 0;
    for (let k = 0; k < this.nZo; k++) { const g = this.overgangen[this.zo[k]]; if (this.inBeeld(g.x, g.y, m + GAT)) { gat[ng * 2] = g.x; gat[ng * 2 + 1] = g.y; ng++; } }
    for (let q = 0; q < nv; q++) {
      const bi = volg[q], ck = bi % this.kolC, cr = (bi - ck) / this.kolC;
      const e = this.brokVan(view, ck, cr);
      if (!e) continue;
      const st = e.st;
      for (let r = 0; r < e.nr; r++) {
        const b0 = e.runs[r * RS], cnt = e.runs[r * RS + 1];
        let i0 = -1, i1 = -1;
        for (let i = b0; i < b0 + cnt; i++) {
          const o = i * PS, x = st[o], y = st[o + 1];
          if (x > this.wx0 - m && x < this.wx1 + m && y > this.wy0 - m && y < this.wy1 + m) { if (i0 < 0) i0 = i; i1 = i; }
        }
        if (i0 < 0) continue;
        if (nm + (i1 - i0 + 1) > PLAFOND.stukken || this.nZr >= PLAFOND.runs) break;
        const o5 = this.nZr++ * 5;
        this.zr[o5] = bi; this.zr[o5 + 1] = r; this.zr[o5 + 2] = i0; this.zr[o5 + 3] = i1; this.zr[o5 + 4] = nm;
        for (let i = i0; i <= i1; i++) {
          const o = i * PS, x = st[o], y = st[o + 1];
          let ok = (e.bits[i] & (OK | HEK)) === (OK | HEK);
          if (ok) {
            const t = Math.floor(y / Tw) * kol + Math.floor(x / Tw);
            if (s.bezet[t] || view.infraLaag?.opBouwwerk?.(x, y)) ok = false;
          }
          if (ok) for (let k = 0; k < ng; k++) { if (Math.abs(gat[k * 2] - x) < GAT && Math.abs(gat[k * 2 + 1] - y) < GAT) { ok = false; break; } }
          this.masker[nm++] = ok ? 1 : 0;
        }
      }
    }
    this.n.stukken = nm;
    this.n.runs = this.nZr;
  }

  klasseVanRun(e, r) {
    const n = this.state.landen.length, a = e.runs[r * RS + 2], b = e.runs[r * RS + 3];
    return a >= 0 && b >= 0 && a < n && b < n ? this.klas[a * n + b] : GEEN;
  }

  // Voegt het zichtbare stuk van een run toe aan het open pad, d wereldeenheden langs de normaal en dy pixels omhoog.
  // Met stap > 1 wordt het laatste stuk altijd meegenomen, zodat een lijn niet te vroeg ophoudt; dx schuift in pixels
  // naar rechts (voor schaduwen naar het zuidoosten).
  lijnLangs(c, e, i0, i1, off, d, dy, stap, bits = 0, dx = 0) {
    const st = e.st, U = this.sc, ox = this.ox + dx, oy = this.oy - dy;
    let open = false;
    for (let i = i0, laatste = false; !laatste; i += stap) {
      if (i >= i1) { i = i1; laatste = true; }
      if (!this.masker[off + i - i0] || (bits && !(e.bits[i] & bits))) { open = false; continue; }
      const o = i * PS, x = (st[o] - st[o + 3] * d) * U + ox, y = (st[o + 1] + st[o + 2] * d) * U + oy;
      if (open) c.lineTo(x, y); else { c.moveTo(x, y); open = true; }
    }
  }

  // ---------- verbindingswegen en bruggen ----------

  tekenVerbindingswegen(c, a) {
    if (a <= 0 || !this.nZo) return;
    const T = this.T, U = this.sc, ox = this.ox, oy = this.oy, diep = this.zoom >= 4;
    const breed = Math.max(2, T * 0.16), asfalt = Math.max(1, T * (diep ? 0.11 : 0.08));
    const speler = this.state.speler;
    // net als tekenWegen: de wegen van de speler voller dan die van anderen (een overgang hoort bij beide landen)
    for (let k = 0; k < this.nZo; k++) {
      const g = this.overgangen[this.zo[k]];
      c.globalAlpha = a * (g.a === speler || g.b === speler ? 0.85 : 0.6);
      for (let pass = 0; pass < (diep ? 3 : 2); pass++) {
        // de rand begint pas na de bestaande weg, anders komt er een donkere ring op de aansluiting
        const kop = pass === 0 ? breed / 2 / U : 0;
        c.beginPath();
        c.moveTo((g.ax + g.ux * kop) * U + ox, (g.ay + g.uy * kop) * U + oy);
        c.lineTo((g.bx - g.ux * kop) * U + ox, (g.by - g.uy * kop) * U + oy);
        if (pass === 0) { c.strokeStyle = RAND; c.lineWidth = breed; }
        else if (pass === 1) { c.strokeStyle = diep ? ASFALT : ZAND; c.lineWidth = asfalt; }
        else { c.strokeStyle = STREEP; c.lineWidth = Math.max(0.6, T * 0.01); c.setLineDash([T * 0.06, T * 0.06]); }
        c.stroke();
      }
      if (diep) c.setLineDash([]);
    }
    // stoeprand en berm bij diep inzoomen, en een brug waar de weg een rivier kruist
    if (this.zoom >= 5.5) {
      c.globalAlpha = a * smooth(5.5, 6.2, this.zoom);
      c.strokeStyle = 'rgba(200,196,186,0.55)';
      c.lineWidth = Math.max(0.5, U * 0.12);
      c.beginPath();
      for (let k = 0; k < this.nZo; k++) {
        const g = this.overgangen[this.zo[k]], rx = -g.uy, ry = g.ux, w = 0.94;
        for (let k2 = -1; k2 <= 1; k2 += 2) { const z = k2 * w; c.moveTo((g.ax + rx * z) * U + ox, (g.ay + ry * z) * U + oy); c.lineTo((g.bx + rx * z) * U + ox, (g.by + ry * z) * U + oy); }
      }
      c.stroke();
    }
    if (diep) {
      for (let k = 0; k < this.nZo && this.n.bruggen < PLAFOND.bruggen; k++) {
        const g = this.overgangen[this.zo[k]];
        for (let q = 0; q < g.brug.length; q += 2) {
          const l = (g.brug[q + 1] - g.brug[q]) / 2, m = (g.brug[q] + g.brug[q + 1]) / 2;
          const x = (g.ax + g.ux * m) * U + ox, y = (g.ay + g.uy * m) * U + oy;
          c.globalAlpha = a;
          c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); rechthoek(c, x + U * 0.5, y + U * 0.5, g.ux, g.uy, l * U, 1.3 * U); c.fill();
          c.fillStyle = '#8b877e'; c.beginPath(); rechthoek(c, x, y, g.ux, g.uy, l * U, 1.3 * U); c.fill();
          c.fillStyle = ASFALT; c.beginPath(); rechthoek(c, x, y, g.ux, g.uy, l * U, 0.9 * U); c.fill();
          c.strokeStyle = '#d6d2c8'; c.lineWidth = Math.max(0.5, U * 0.14); c.beginPath();
          for (let k2 = -1; k2 <= 1; k2 += 2) { const z = 1.2 * k2; c.moveTo(x + (-g.ux * l - g.uy * z) * U, y + (-g.uy * l + g.ux * z) * U); c.lineTo(x + (g.ux * l - g.uy * z) * U, y + (g.uy * l + g.ux * z) * U); }
          c.stroke();
          this.n.bruggen++;
        }
      }
    }
    c.globalAlpha = 1;
  }

  // ---------- grond langs de grens ----------

  tekenStroken(c, a) {
    if (a <= 0 || !this.nZr) return;
    const U = this.sc, stap = this.stap, sn = this.sneeuw;
    c.globalAlpha = a;
    c.lineCap = 'round';
    // niemandsland in oorlog: kale, omgewoelde grond tussen de hekken
    c.strokeStyle = sn > 0.5 ? 'rgba(214,214,206,0.55)' : 'rgba(112,92,64,0.42)';
    c.lineWidth = (D_HEK * 2 + 1.2) * U;
    c.beginPath();
    for (let q = 0; q < this.nZr; q++) {
      const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
      if (this.klasseVanRun(e, r) === OORLOG) this.lijnLangs(c, e, this.zr[o5 + 2], this.zr[o5 + 3], this.zr[o5 + 4], 0, 0, stap);
    }
    c.stroke();
    // patrouillestrook langs een blokgrens: aangeharkt zand aan één kant van het hek
    c.strokeStyle = sn > 0.5 ? 'rgba(236,238,240,0.6)' : 'rgba(176,156,112,0.45)';
    c.lineWidth = 1.7 * U;
    c.beginPath();
    for (let q = 0; q < this.nZr; q++) {
      const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
      if (this.klasseVanRun(e, r) !== BLOK) continue;
      const zij = hash(e.runs[r * RS + 5], 3) < 0.5 ? 1 : -1;
      this.lijnLangs(c, e, this.zr[o5 + 2], this.zr[o5 + 3], this.zr[o5 + 4], D_STROOK * zij, 0, stap, zij > 0 ? T_PLUS : T_MIN);
    }
    c.stroke();
    if (this.zoom >= 9) {
      // harksporen in het zand
      c.strokeStyle = 'rgba(120,100,70,0.25)';
      c.lineWidth = Math.max(0.4, U * 0.06);
      c.setLineDash([U * 0.6, U * 0.4]);
      c.beginPath();
      for (let q = 0; q < this.nZr; q++) {
        const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
        if (this.klasseVanRun(e, r) !== BLOK) continue;
        const zij = hash(e.runs[r * RS + 5], 3) < 0.5 ? 1 : -1;
        for (let k2 = -1; k2 <= 1; k2 += 2) this.lijnLangs(c, e, this.zr[o5 + 2], this.zr[o5 + 3], this.zr[o5 + 4], (D_STROOK + 0.4 * k2) * zij, 0, stap, zij > 0 ? T_PLUS : T_MIN);
      }
      c.stroke();
      c.setLineDash([]);
    }
    c.lineCap = 'butt';
    c.globalAlpha = 1;
  }

  // Eenheden in oorlog stempelen de vakjes om zich heen: daar ligt de frontlinie, dus daar zijn loopgraven en stellingen.
  stempelEenheden() {
    const s = this.state, geo = this.geo, n = s.landen.length;
    this.stempelNr = (this.stempelNr + 1) & 0xffff;
    if (this.stempelNr === 0) { this.stempel.fill(0); this.stempelNr = 1; }
    const nr = this.stempelNr;
    for (let i = 0; i < s.eenheden.length; i++) {
      const u = s.eenheden[i];
      if (u.land < 0 || u.land >= n || !this.inOorlogLand[u.land] || !this.inBeeld(u.x, u.y, 48)) continue;
      const k0 = Math.floor(u.x / geo.T), r0 = Math.floor(u.y / geo.T);
      for (let dr = -2; dr <= 2; dr++) for (let dk = -2; dk <= 2; dk++) {
        const k = k0 + dk, r = r0 + dr;
        if (k >= 0 && r >= 0 && k < geo.kol && r < geo.rij) this.stempel[r * geo.kol + k] = nr;
      }
    }
  }

  // Ligt de loopgraaf hier? Bij eenheden altijd, verder in vaste stukken van 24 eenheden.
  graafHier(e, r, i, zij) {
    const st = e.st, o = i * PS;
    const t = this.tegelVan(st[o], st[o + 1]);
    if (t >= 0 && this.stempel[t] === this.stempelNr) return true;
    return hash(e.runs[r * RS + 5], Math.floor(st[o + 4] / 24), zij > 0 ? 11 : 12) < 0.35;
  }

  tekenLoopgraven(c, a, view) {
    if (a <= 0 || !this.nZr) return;
    let oorlog = false;
    for (let q = 0; q < this.nZr && !oorlog; q++) oorlog = this.klasseVanRun(this.brokken[this.zr[q * 5]], this.zr[q * 5 + 1]) === OORLOG;
    if (!oorlog) return;
    this.stempelEenheden();
    const U = this.sc, ox = this.ox, oy = this.oy, stap = this.stap, sn = this.sneeuw;
    this.wegenInBeeld();
    // Eén keer de punten van de graaf verzamelen (wereld, normaal naar de vijand, begin van een stuk); elke laag
    // hieronder tekent dezelfde punten, zodat het plafond aarde, graaf, zandzakken en planken gelijk afkapt.
    const P = this._graaf ?? (this._graaf = new Float32Array(PLAFOND.loopgraaf * 5));
    let punten = 0;
    for (let zi = 1; zi >= -1 && punten < PLAFOND.loopgraaf; zi -= 2) {
      const zijBit = zi > 0 ? G_PLUS : G_MIN, kol = zi > 0 ? 0 : 2;
      for (let q = 0; q < this.nZr && punten < PLAFOND.loopgraaf; q++) {
        const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
        if (this.klasseVanRun(e, r) !== OORLOG) continue;
        const i0 = this.zr[o5 + 2], i1 = this.zr[o5 + 3], G = e.graaf;
        let open = false;
        for (let i = i0; i <= i1 && punten < PLAFOND.loopgraaf; i += stap) {
          if (!(e.bits[i] & zijBit) || !this.graafHier(e, r, i, zi)) { open = false; continue; }
          const gx = G[i * 4 + kol], gy = G[i * 4 + kol + 1];
          // niet door een gebouw, een bouwwerk van de infralaag of over de weg naar een grenspost
          if (this.bebouwdSnel(gx, gy) || view.infraLaag?.opBouwwerk?.(gx, gy) || this.opVerbindingsweg(gx, gy, 1.9)) { open = false; continue; }
          const o = punten * 5;
          P[o] = gx; P[o + 1] = gy; P[o + 2] = -e.st[i * PS + 3] * zi; P[o + 3] = e.st[i * PS + 2] * zi; P[o + 4] = open ? 0 : 1;
          open = true;
          punten++;
        }
      }
    }
    // borstwering: dd eenheden naar de vijand toe
    const pad = (dd) => {
      for (let k = 0; k < punten; k++) {
        const o = k * 5, x = (P[o] - P[o + 2] * dd) * U + ox, y = (P[o + 1] - P[o + 3] * dd) * U + oy;
        if (P[o + 4]) c.moveTo(x, y); else c.lineTo(x, y);
      }
    };
    c.globalAlpha = a;
    c.lineCap = 'round';
    // uitgegraven aarde naast de graaf, dan de graaf zelf, dan de zandzakken op de borstwering
    c.strokeStyle = sn > 0.5 ? 'rgba(222,222,214,0.7)' : 'rgba(128,104,72,0.55)';
    c.lineWidth = 1.7 * U;
    c.beginPath(); pad(0.2); c.stroke();
    c.strokeStyle = '#2f261c';
    c.lineWidth = Math.max(1, 0.7 * U);
    c.beginPath(); pad(-0.1); c.stroke();
    if (this.zoom >= 9) {
      c.strokeStyle = sn > 0.5 ? '#d8d6cc' : '#a89470';
      c.lineWidth = 0.32 * U;
      c.setLineDash([U * 0.42, U * 0.18]);
      c.beginPath(); pad(0.55); c.stroke();
      c.setLineDash([]);
    }
    if (this.zoom >= 12.5) {
      // loopplanken op de bodem van de graaf
      c.strokeStyle = '#6b5236';
      c.lineWidth = 0.18 * U;
      c.setLineDash([U * 0.08, U * 0.22]);
      c.beginPath(); pad(-0.1); c.stroke();
      c.setLineDash([]);
    }
    this.n.loopgraaf = punten;
    c.lineCap = 'butt';
    // zandzakstellingen: hoefijzers naar de vijand, om de 20 eenheden (bij eenheden om de 10)
    if (this.zoom >= 6) {
      const nest = this._nest ?? (this._nest = new Float32Array(PLAFOND.stellingen * 4));
      let n = 0;
      for (let q = 0; q < this.nZr && n < PLAFOND.stellingen; q++) {
        const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
        if (this.klasseVanRun(e, r) !== OORLOG) continue;
        for (let i = this.zr[o5 + 2]; i <= this.zr[o5 + 3] && n < PLAFOND.stellingen; i++) {
          const sb = e.st[i * PS + 4], t = this.tegelVan(e.st[i * PS], e.st[i * PS + 1]), bij = t >= 0 && this.stempel[t] === this.stempelNr;
          const per = bij ? 10 : 20;
          if (Math.floor(sb / per) === Math.floor((sb - 1) / per)) continue;
          for (let zi = 1; zi >= -1; zi -= 2) {
            if (n >= PLAFOND.stellingen || !(e.bits[i] & (zi > 0 ? G_PLUS : G_MIN)) || !this.graafHier(e, r, i, zi)) continue;
            if (!bij && hash(e.runs[r * RS + 5], Math.floor(sb / per), zi > 0 ? 13 : 14) > 0.6) continue;
            const nx = -e.st[i * PS + 3] * zi, ny = e.st[i * PS + 2] * zi;
            const gx = e.graaf[i * 4 + (zi > 0 ? 0 : 2)] - nx * 1.4, gy = e.graaf[i * 4 + (zi > 0 ? 1 : 3)] - ny * 1.4;
            if (!this.inBeeld(gx, gy, 3) || this.bebouwdSnel(gx, gy) || view.infraLaag?.opBouwwerk?.(gx, gy) || this.opVerbindingsweg(gx, gy, 2.2)) continue;
            nest[n * 4] = gx * U + ox; nest[n * 4 + 1] = gy * U + oy; nest[n * 4 + 2] = Math.atan2(-ny, -nx); nest[n * 4 + 3] = bij ? 1 : 0;
            n++;
          }
        }
      }
      this.n.stellingen = n;
      const R = 0.9 * U;
      c.fillStyle = 'rgba(30,24,18,0.75)'; c.beginPath();
      for (let k = 0; k < n; k++) stip(c, nest[k * 4], nest[k * 4 + 1], R * 0.75);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.42 * U; c.beginPath();
      for (let k = 0; k < n; k++) { const x = nest[k * 4] + U * 0.2, y = nest[k * 4 + 1] + U * 0.2, h = nest[k * 4 + 2]; c.moveTo(x + Math.cos(h - 1.7) * R, y + Math.sin(h - 1.7) * R); c.arc(x, y, R, h - 1.7, h + 1.7); }
      c.stroke();
      c.strokeStyle = sn > 0.5 ? '#e4e2da' : '#b39d76'; c.lineWidth = 0.4 * U;
      if (this.zoom >= 8) c.setLineDash([U * 0.36, U * 0.12]);
      c.beginPath();
      for (let k = 0; k < n; k++) { const x = nest[k * 4], y = nest[k * 4 + 1], h = nest[k * 4 + 2]; c.moveTo(x + Math.cos(h - 1.7) * R, y + Math.sin(h - 1.7) * R); c.arc(x, y, R, h - 1.7, h + 1.7); }
      c.stroke();
      c.setLineDash([]);
      if (this.zoom >= 10) {
        // een helm en een loop die naar de vijand wijst, alleen waar eenheden liggen
        c.strokeStyle = '#1e1e1c'; c.lineWidth = Math.max(0.6, 0.1 * U); c.beginPath();
        for (let k = 0; k < n; k++) if (nest[k * 4 + 3]) { const x = nest[k * 4], y = nest[k * 4 + 1], h = nest[k * 4 + 2]; c.moveTo(x, y); c.lineTo(x + Math.cos(h) * R * 1.5, y + Math.sin(h) * R * 1.5); }
        c.stroke();
        c.fillStyle = UNIFORM[1]; c.beginPath();
        for (let k = 0; k < n; k++) if (nest[k * 4 + 3]) stip(c, nest[k * 4] - Math.cos(nest[k * 4 + 2]) * R * 0.2, nest[k * 4 + 1] - Math.sin(nest[k * 4 + 2]) * R * 0.2, 0.22 * U);
        c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  bebouwdSnel(x, y) { const t = this.tegelVan(x, y); return t < 0 || !!this.state.bezet[t]; }

  // De verbindingswegen in beeld als lijnstukken (begin, richting, lengte), voor opVerbindingsweg.
  wegenInBeeld() {
    const b = this._weg ?? (this._weg = new Float32Array(PLAFOND.wegen * 5));
    let n = 0;
    for (let k = 0; k < this.nZo; k++) {
      const g = this.overgangen[this.zo[k]], o = n++ * 5;
      b[o] = g.ax; b[o + 1] = g.ay; b[o + 2] = g.ux; b[o + 3] = g.uy; b[o + 4] = g.len;
    }
    this.nWeg = n;
  }

  // Ligt (x, y) binnen r eenheden van een verbindingsweg in beeld (de weg zelf is 2,6 eenheden breed)?
  opVerbindingsweg(x, y, r) {
    const b = this._weg;
    for (let k = 0; k < this.nWeg; k++) {
      const o = k * 5, dx = x - b[o], dy = y - b[o + 1], l = clamp(dx * b[o + 2] + dy * b[o + 3], 0, b[o + 4]);
      const px = dx - b[o + 2] * l, py = dy - b[o + 3] * l;
      if (px * px + py * py < r * r) return true;
    }
    return false;
  }

  // ---------- tankversperringen en mijnenveldbordjes ----------

  tekenTanden(c, a) {
    if (a <= 0 || !this.nZr) return;
    const U = this.sc, ox = this.ox, oy = this.oy, groot = this.zoom >= 10;
    const buf = this._tand ?? (this._tand = new Float32Array(PLAFOND.tanden * 2));
    let n = 0;
    for (let q = 0; q < this.nZr && n < PLAFOND.tanden; q++) {
      const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
      if (this.klasseVanRun(e, r) !== OORLOG) continue;
      const st = e.st, i0 = this.zr[o5 + 2], off = this.zr[o5 + 4], zaad = e.runs[r * RS + 5];
      for (let i = i0; i <= this.zr[o5 + 3] && n < PLAFOND.tanden; i++) {
        if (!this.masker[off + i - i0]) continue;
        const o = i * PS, j = Math.floor(st[o + 4] / 28);
        if (hash(zaad, j, 5) > 0.45) continue;
        const zij = hash(zaad, j, 6) < 0.5 ? 1 : -1;
        if (!(e.bits[i] & (zij > 0 ? T_PLUS : T_MIN))) continue;
        // niet onder een wachttoren (die staan om de 40 eenheden, afwisselend links en rechts; zie tekenTorens)
        const tm = Math.round((st[o + 4] + 20) / 40);
        if (Math.abs(st[o + 4] + 20 - tm * 40) < 1.6 && (tm & 1 ? 1 : -1) === zij) continue;
        const nx = -st[o + 3] * zij, ny = st[o + 2] * zij;
        // twee rijen, de tweede een halve stap verschoven
        for (let rij = 0; rij < 2 && n < PLAFOND.tanden; rij++) {
          const d = D_TAND + rij * 0.9, sh = rij * 0.5;
          const wx = st[o] + nx * d + st[o + 2] * sh, wy = st[o + 1] + ny * d + st[o + 3] * sh;
          if (!this.inBeeld(wx, wy, 1) || this.bebouwdSnel(wx, wy)) continue;
          buf[n * 2] = wx * U + ox; buf[n * 2 + 1] = wy * U + oy; n++;
        }
      }
    }
    this.n.tanden = n;
    if (!n) return;
    const r = 0.3 * U, h = 0.45 * U;
    c.globalAlpha = a;
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath();
    for (let k = 0; k < n; k++) { const x = buf[k * 2], y = buf[k * 2 + 1]; if (groot) { c.moveTo(x - r, y + r * 0.4); c.lineTo(x + r, y + r * 0.4); c.lineTo(x + r + h * SCHUIN, y + r * 0.4 + h * SCHUIN); c.closePath(); } else c.rect(x - r + h * 0.3, y - r * 0.4 + h * 0.3, r * 2, r * 1.2); }
    c.fill();
    c.fillStyle = this.sneeuw > 0.6 ? '#b4b3ad' : '#8f8c84'; c.beginPath();
    for (let k = 0; k < n; k++) { const x = buf[k * 2], y = buf[k * 2 + 1]; if (groot) { c.moveTo(x - r, y + r * 0.4); c.lineTo(x + r, y + r * 0.4); c.lineTo(x, y - h); c.closePath(); } else c.rect(x - r, y - r, r * 2, r * 1.4); }
    c.fill();
    if (groot) {
      // het vlak naar het noordwesten vangt het licht
      c.fillStyle = this.sneeuw > 0.6 ? '#eef0f1' : '#bdb9ae'; c.beginPath();
      for (let k = 0; k < n; k++) { const x = buf[k * 2], y = buf[k * 2 + 1]; c.moveTo(x - r, y + r * 0.4); c.lineTo(x, y + r * 0.4); c.lineTo(x, y - h); c.closePath(); }
      c.fill();
    }
    c.globalAlpha = 1;
  }

  tekenBordjes(c, a) {
    if (a <= 0 || !this.nZr) return;
    const U = this.sc, ox = this.ox, oy = this.oy;
    const buf = this._bord ?? (this._bord = new Float32Array(PLAFOND.bordjes * 2));
    let n = 0;
    for (let q = 0; q < this.nZr && n < PLAFOND.bordjes; q++) {
      const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
      if (this.klasseVanRun(e, r) !== OORLOG) continue;
      const st = e.st, i0 = this.zr[o5 + 2], off = this.zr[o5 + 4];
      for (let i = i0; i <= this.zr[o5 + 3] && n < PLAFOND.bordjes; i++) {
        if (!this.masker[off + i - i0]) continue;
        const o = i * PS, sb = st[o + 4];
        if (Math.floor(sb / 9) === Math.floor((sb - 1) / 9)) continue;
        const zij = Math.floor(sb / 9) & 1 ? 1 : -1;
        if (!(e.bits[i] & (zij > 0 ? B_PLUS : B_MIN))) continue;
        const wx = st[o] - st[o + 3] * zij * D_BORD, wy = st[o + 1] + st[o + 2] * zij * D_BORD;
        if (!this.inBeeld(wx, wy, 1) || this.bebouwdSnel(wx, wy)) continue;
        buf[n * 2] = wx * U + ox; buf[n * 2 + 1] = wy * U + oy; n++;
      }
    }
    this.n.bordjes = n;
    if (!n) return;
    const H = 0.7 * U, b = 0.32 * U;
    c.globalAlpha = a;
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.5, 0.08 * U); c.beginPath();
    for (let k = 0; k < n; k++) { const x = buf[k * 2], y = buf[k * 2 + 1]; c.moveTo(x, y); c.lineTo(x + H * SCHUIN, y + H * SCHUIN); }
    c.stroke();
    c.strokeStyle = '#5b4636'; c.beginPath();
    for (let k = 0; k < n; k++) { const x = buf[k * 2], y = buf[k * 2 + 1]; c.moveTo(x, y); c.lineTo(x, y - H); }
    c.stroke();
    // rode driehoek met een witte binnenrand, zonder tekst
    c.fillStyle = '#c8302a'; c.beginPath();
    for (let k = 0; k < n; k++) { const x = buf[k * 2], y = buf[k * 2 + 1] - H; c.moveTo(x - b, y); c.lineTo(x + b, y); c.lineTo(x, y + b * 1.6); c.closePath(); }
    c.fill();
    if (this.zoom >= 11) {
      c.fillStyle = '#f2efe6'; c.beginPath();
      for (let k = 0; k < n; k++) { const x = buf[k * 2], y = buf[k * 2 + 1] - H + b * 0.35; c.moveTo(x - b * 0.45, y); c.lineTo(x + b * 0.45, y); c.lineTo(x, y + b * 0.75); c.closePath(); }
      c.fill();
    }
    c.globalAlpha = 1;
  }

  // ---------- hekken en paaltjes ----------

  tekenHekken(c, a) {
    if (a <= 0 || !this.nZr) return;
    const U = this.sc, ox = this.ox, oy = this.oy, z = this.zoom;
    const stap = this.stap;
    c.globalAlpha = a;
    // NEUTRAAL: houten paaltjes met twee draden
    // BLOK: hoog gaashek met betonpalen, bovenregel en lampen
    // OORLOG: dubbel hek met prikkeldraad en een rol ertussen
    // Een lijn langs alle zichtbare runs van een klasse, d eenheden van de grens, dy pixels omhoog en dx naar rechts.
    const lijn = (klas, d, dy, kleur, breedte, dash, dx = 0) => {
      c.beginPath();
      let iets = false;
      for (let q = 0; q < this.nZr; q++) {
        const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
        if (this.klasseVanRun(e, r) !== klas) continue;
        this.lijnLangs(c, e, this.zr[o5 + 2], this.zr[o5 + 3], this.zr[o5 + 4], d, dy, stap, 0, dx);
        iets = true;
      }
      if (!iets) return false;
      c.strokeStyle = kleur; c.lineWidth = breedte;
      if (dash) c.setLineDash(dash);
      c.stroke();
      if (dash) c.setLineDash([]);
      return true;
    };
    // gaas: een lint tussen de grond en de bovenregel, per aaneengesloten stuk een veelhoek
    const gaas = (klas, d, h, vul) => {
      c.beginPath();
      let iets = false;
      for (let q = 0; q < this.nZr; q++) {
        const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
        if (this.klasseVanRun(e, r) !== klas) continue;
        const i0 = this.zr[o5 + 2], i1 = this.zr[o5 + 3], off = this.zr[o5 + 4], st = e.st;
        let j = i0;
        while (j <= i1) {
          while (j <= i1 && !this.masker[off + j - i0]) j++;
          if (j > i1) break;
          const j0 = j;
          while (j <= i1 && this.masker[off + j - i0]) j++;
          const j1 = j - 1;
          if (j1 <= j0) continue;
          for (let i = j0; i <= j1; i += stap) { const o = i * PS, x = (st[o] - st[o + 3] * d) * U + ox, y = (st[o + 1] + st[o + 2] * d) * U + oy; if (i === j0) c.moveTo(x, y); else c.lineTo(x, y); }
          for (let i = j1; i >= j0; i -= stap) { const o = i * PS; c.lineTo((st[o] - st[o + 3] * d) * U + ox, (st[o + 1] + st[o + 2] * d) * U + oy - h * U); }
          c.closePath();
          iets = true;
        }
      }
      if (!iets) return;
      c.fillStyle = vul;
      c.fill();
    };
    // palen: om de zoveel stukken een staande lijn met een schaduw naar het zuidoosten
    const palen = (klas, d, h, elke, kleur, breedte) => {
      const buf = this._paal ?? (this._paal = new Float32Array(PLAFOND.palen * 2));
      let n = 0;
      for (let q = 0; q < this.nZr && this.n.palen + n < PLAFOND.palen; q++) {
        const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
        if (this.klasseVanRun(e, r) !== klas) continue;
        const i0 = this.zr[o5 + 2], off = this.zr[o5 + 4], st = e.st;
        for (let i = i0; i <= this.zr[o5 + 3] && this.n.palen + n < PLAFOND.palen; i++) {
          if (!this.masker[off + i - i0]) continue;
          const o = i * PS, sb = st[o + 4];
          if (Math.floor(sb / elke) === Math.floor((sb - STUK) / elke)) continue;
          const x = (st[o] - st[o + 3] * d) * U + ox, y = (st[o + 1] + st[o + 2] * d) * U + oy;
          if (x < -20 || y < -20 || x > this.w + 20 || y > this.h + 20) continue;
          buf[n * 2] = x; buf[n * 2 + 1] = y; n++;
        }
      }
      this.n.palen += n;
      if (!n) return;
      const H = h * U;
      c.lineWidth = breedte;
      c.strokeStyle = 'rgba(0,0,0,0.22)'; c.beginPath();
      for (let k = 0; k < n; k++) { const x = buf[k * 2], y = buf[k * 2 + 1]; c.moveTo(x, y); c.lineTo(x + H * SCHUIN, y + H * SCHUIN); }
      c.stroke();
      c.strokeStyle = kleur; c.beginPath();
      for (let k = 0; k < n; k++) { const x = buf[k * 2], y = buf[k * 2 + 1]; c.moveTo(x, y); c.lineTo(x, y - H); }
      c.stroke();
    };
    const pix = (v) => Math.max(0.5, v * U);
    // zwevende buren: houten palen met draad
    if (z >= 6) {
      lijn(NEUTRAAL, 0, 0.32 * U, 'rgba(60,54,46,0.55)', pix(0.05));
      if (z >= 9) lijn(NEUTRAAL, 0, 0.55 * U, 'rgba(60,54,46,0.55)', pix(0.05));
    } else lijn(NEUTRAAL, 0, 0, 'rgba(70,58,44,0.45)', pix(0.12), [U * 0.5, U * 0.5]);
    palen(NEUTRAAL, 0, 0.6, z < 6 ? 6 : 3, '#6b5139', pix(0.16));
    // blokgrens: schaduw, gaas, palen, bovenregel
    const hB = 0.75;
    // de schaduw van het gaas valt als een smalle grijze band naar het zuidoosten
    const sB = hB * SCHUIN * U * 0.5;
    lijn(BLOK, 0, -sB, 'rgba(0,0,0,0.14)', pix(0.36), null, sB);
    let gaasVul = 'rgba(205,210,214,0.2)';
    if (z >= 9 && this.sprites.gaas && c.createPattern) {
      this.sprites.gaasPatroon ??= c.createPattern(this.sprites.gaas, 'repeat');
      const pt = this.sprites.gaasPatroon;
      if (pt) {
        gaasVul = pt;
        // het gaas hoort bij de wereld: één ruit is een halve eenheid en schuift mee als je de kaart versleept
        if (typeof pt.setTransform === 'function' && typeof DOMMatrix === 'function') {
          const m = this._gaasM ?? (this._gaasM = new DOMMatrix());
          m.a = m.d = (U * 0.5) / 6; m.b = m.c = 0; m.e = this.ox; m.f = this.oy;
          try { pt.setTransform(m); } catch { /* oudere browser: het gaas staat dan vast op het scherm */ }
        }
      }
    }
    if (z >= 5.5) gaas(BLOK, 0, hB, gaasVul);
    palen(BLOK, 0, hB, z < 6 ? 6 : 3, '#8b9096', pix(0.15));
    lijn(BLOK, 0, hB * U, '#aeb3b8', pix(0.09));
    if (z >= DREMPEL.rollen) {
      lijn(BLOK, 0, (hB + 0.12) * U, 'rgba(50,50,50,0.7)', pix(0.035));
      lijn(BLOK, 0, (hB + 0.24) * U, 'rgba(50,50,50,0.7)', pix(0.035));
    }
    // oorlog: twee hekken met prikkeldraad bovenop en een rol prikkeldraad ertussen
    const hO = 0.8;
    for (let k2 = 1; k2 >= -1; k2 -= 2) {
      const d = D_HEK * k2;
      const sO = hO * SCHUIN * U * 0.5;
      lijn(OORLOG, d, -sO, 'rgba(0,0,0,0.16)', pix(0.38), null, sO);
      if (z >= 5.5) gaas(OORLOG, d, hO, z >= 9 && typeof gaasVul !== 'string' ? gaasVul : 'rgba(170,175,170,0.18)');
      palen(OORLOG, d, hO, z < 6 ? 4 : 2, '#4a4d4f', pix(0.14));
      lijn(OORLOG, d, hO * U, '#6e7276', pix(0.08));
      if (z >= 8) lijn(OORLOG, d, (hO + 0.15) * U, 'rgba(40,40,40,0.75)', pix(0.04), [U * 0.12, U * 0.08]);
    }
    if (z >= 8) this.tekenRollen(c, z >= DREMPEL.rollen);
    // bondgenoten: alleen witte grenspaaltjes met een gekleurde kop
    this.tekenPaaltjes(c);
    // lampen langs de blokgrens (om de 24 eenheden)
    if (z >= 7) {
      const buf = this._lamp ?? (this._lamp = new Float32Array(48 * 4));
      let n = 0;
      for (let q = 0; q < this.nZr && n < 48; q++) {
        const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
        const k = this.klasseVanRun(e, r);
        if (k !== BLOK && k !== OORLOG) continue;
        const i0 = this.zr[o5 + 2], off = this.zr[o5 + 4], st = e.st;
        for (let i = i0; i <= this.zr[o5 + 3] && n < 48; i++) {
          if (!this.masker[off + i - i0]) continue;
          const o = i * PS, sb = st[o + 4];
          if (Math.floor(sb / 24) === Math.floor((sb - 1) / 24)) continue;
          const d = k === OORLOG ? D_HEK : 0;
          buf[n * 4] = (st[o] - st[o + 3] * d) * U + ox; buf[n * 4 + 1] = (st[o + 1] + st[o + 2] * d) * U + oy;
          buf[n * 4 + 2] = st[o + 2]; buf[n * 4 + 3] = st[o + 3]; n++;
        }
      }
      const H = 1.5 * U, arm = 0.35 * U;
      c.lineWidth = pix(0.12);
      c.strokeStyle = 'rgba(0,0,0,0.22)'; c.beginPath();
      for (let k = 0; k < n; k++) { const x = buf[k * 4], y = buf[k * 4 + 1]; c.moveTo(x, y); c.lineTo(x + H * SCHUIN, y + H * SCHUIN); }
      c.stroke();
      c.strokeStyle = '#5d6166'; c.beginPath();
      for (let k = 0; k < n; k++) { const x = buf[k * 4], y = buf[k * 4 + 1]; c.moveTo(x, y); c.lineTo(x, y - H); c.lineTo(x + arm, y - H); }
      c.stroke();
      c.fillStyle = this.nacht > 0.3 ? '#f4f6ff' : '#d4d6d0'; c.beginPath();
      for (let k = 0; k < n; k++) stip(c, buf[k * 4] + arm, buf[k * 4 + 1] - H + U * 0.08, Math.max(0.6, 0.12 * U));
      c.fill();
      if (this.nacht > 0.05) for (let k = 0; k < n; k++) { this.zetLicht(buf[k * 4] + arm, buf[k * 4 + 1] - H, 0.9 * U, KOEL, 0.9); this.zetLicht(buf[k * 4] + arm, buf[k * 4 + 1], 2.4 * U, KOEL, 0.25); }
      // waarschuwingsbordjes naast elke lamp aan het gaas: gele driehoek, geen tekst
      if (z >= 11) {
        c.fillStyle = '#e8c23a'; c.beginPath();
        for (let k = 0; k < n; k++) {
          const x = buf[k * 4] - buf[k * 4 + 2] * U * 1.5, y = buf[k * 4 + 1] - buf[k * 4 + 3] * U * 1.5 - U * 0.42;
          c.moveTo(x - U * 0.18, y + U * 0.15); c.lineTo(x + U * 0.18, y + U * 0.15); c.lineTo(x, y - U * 0.17); c.closePath();
        }
        c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  // Concertina tussen de oorlogshekken: dichtbij als lusjes, verder weg als zigzag.
  tekenRollen(c, lussen) {
    const U = this.sc, ox = this.ox, oy = this.oy;
    c.strokeStyle = 'rgba(48,48,46,0.8)';
    c.lineWidth = Math.max(0.4, 0.04 * U);
    c.beginPath();
    let n = 0;
    for (let q = 0; q < this.nZr; q++) {
      const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
      if (this.klasseVanRun(e, r) !== OORLOG) continue;
      const i0 = this.zr[o5 + 2], off = this.zr[o5 + 4], st = e.st;
      let open = false;
      for (let i = i0; i <= this.zr[o5 + 3]; i++) {
        if (!this.masker[off + i - i0]) { open = false; continue; }
        const o = i * PS, x = st[o] * U + ox, y = st[o + 1] * U + oy;
        if (lussen) {
          if (n++ > 400) break;
          // twee lusjes per eenheid: ellipsen die de rol suggereren
          for (let k = 0; k < 2; k++) {
            const lx = x + st[o + 2] * U * (k * 0.5 - 0.25), ly = y + st[o + 3] * U * (k * 0.5 - 0.25) - U * 0.2;
            c.moveTo(lx + U * 0.25, ly);
            c.ellipse(lx, ly, U * 0.25, U * 0.2, 0, 0, TAU);
          }
        } else {
          const zz = (i & 1 ? 1 : -1) * 0.3 * U;
          const lx = x - st[o + 3] * zz, ly = y + st[o + 2] * zz - U * 0.2;
          if (open) c.lineTo(lx, ly); else { c.moveTo(lx, ly); open = true; }
        }
      }
    }
    c.stroke();
  }

  // Grenspaaltjes tussen bondgenoten: wit met een kop in de vlagkleur van beide landen, om de 12 eenheden.
  tekenPaaltjes(c) {
    const U = this.sc, ox = this.ox, oy = this.oy, z = this.zoom;
    const buf = this._paaltje ?? (this._paaltje = new Float32Array(160 * 4));
    let n = 0;
    const vlaggen = vlagOntwerpen(this.state);
    const max = Math.min(160, PLAFOND.palen - this.n.palen);
    for (let q = 0; q < this.nZr && n < max; q++) {
      const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
      if (this.klasseVanRun(e, r) !== BONDGENOOT) continue;
      const i0 = this.zr[o5 + 2], off = this.zr[o5 + 4], st = e.st;
      const elke = z >= 11 ? 4 : 12;
      for (let i = i0; i <= this.zr[o5 + 3] && n < max; i++) {
        if (!this.masker[off + i - i0]) continue;
        const sb = st[i * PS + 4];
        if (Math.floor(sb / elke) === Math.floor((sb - 1) / elke)) continue;
        const groot = Math.floor(sb / 12) !== Math.floor((sb - 1) / 12);
        buf[n * 4] = st[i * PS] * U + ox; buf[n * 4 + 1] = st[i * PS + 1] * U + oy;
        buf[n * 4 + 2] = groot ? e.runs[r * RS + 2] : -1; buf[n * 4 + 3] = e.runs[r * RS + 3];
        n++;
      }
    }
    this.n.palen += n;
    if (!n) return;
    const H = 0.55 * U, b = Math.max(0.6, 0.11 * U);
    // grenssteentjes (klein, grijs) tussen de paaltjes vanaf zoom 11
    if (z >= 11) {
      c.fillStyle = '#b9b6ad'; c.beginPath();
      for (let k = 0; k < n; k++) if (buf[k * 4 + 2] < 0) c.rect(buf[k * 4] - b, buf[k * 4 + 1] - b * 0.8, b * 2, b * 1.4);
      c.fill();
    }
    c.lineWidth = Math.max(0.7, 0.14 * U);
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.beginPath();
    for (let k = 0; k < n; k++) if (buf[k * 4 + 2] >= 0) { const x = buf[k * 4], y = buf[k * 4 + 1]; c.moveTo(x, y); c.lineTo(x + H * SCHUIN, y + H * SCHUIN); }
    c.stroke();
    c.strokeStyle = '#efede6'; c.beginPath();
    for (let k = 0; k < n; k++) if (buf[k * 4 + 2] >= 0) { const x = buf[k * 4], y = buf[k * 4 + 1]; c.moveTo(x, y); c.lineTo(x, y - H); }
    c.stroke();
    if (z >= 7) {
      for (let k = 0; k < n; k++) {
        const A = buf[k * 4 + 2];
        if (A < 0) continue;
        const x = buf[k * 4], y = buf[k * 4 + 1] - H, w = Math.max(0.8, 0.12 * U);
        c.fillStyle = vlaggen[A]?.hoofd ?? '#c0392b'; c.fillRect(x - w, y - w * 0.9, w, w * 1.8);
        c.fillStyle = vlaggen[buf[k * 4 + 3]]?.hoofd ?? '#2e86c1'; c.fillRect(x, y - w * 0.9, w, w * 1.8);
      }
    }
  }

  // ---------- wachttorens ----------

  tekenTorens(c, a) {
    if (a <= 0 || !this.nZr) return;
    const U = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, buf = this.toren;
    let n = 0;
    for (let q = 0; q < this.nZr && n < PLAFOND.torens; q++) {
      const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1];
      if (this.klasseVanRun(e, r) !== OORLOG) continue;
      const i0 = this.zr[o5 + 2], off = this.zr[o5 + 4], st = e.st, zaad = e.runs[r * RS + 5];
      for (let i = i0; i <= this.zr[o5 + 3] && n < PLAFOND.torens; i++) {
        if (!this.masker[off + i - i0]) continue;
        const o = i * PS, sb = st[o + 4] + 20;
        if (Math.floor(sb / 40) === Math.floor((sb - 1) / 40)) continue;
        const zij = Math.floor(sb / 40) & 1 ? 1 : -1;
        if (!(e.bits[i] & (zij > 0 ? T_PLUS : T_MIN))) continue;
        const nx = -st[o + 3] * zij, ny = st[o + 2] * zij;
        const wx = st[o] + nx * D_TOREN, wy = st[o + 1] + ny * D_TOREN;
        if (!this.inBeeld(wx, wy, 6) || this.bebouwdSnel(wx, wy)) continue;
        const b = n * TOREN;
        buf[b] = wx * U + ox; buf[b + 1] = wy * U + oy; buf[b + 2] = 2.2 * U; buf[b + 3] = Math.atan2(-ny, -nx); buf[b + 4] = (zaad * 31 + i) | 0; buf[b + 5] = a;
        n++;
      }
    }
    this.nToren = n;
    if (!n) return;
    const hw = 0.38 * U, cw = 0.55 * U, ch = 0.42 * U, groot = z >= 8;
    c.globalAlpha = a;
    // schaduw: poten als dikke streep naar het zuidoosten, de cabine als vlek aan het eind
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath();
    for (let k = 0; k < n; k++) { const b = k * TOREN, x = buf[b], y = buf[b + 1], Ht = buf[b + 2]; c.rect(x + Ht * SCHUIN - cw, y + Ht * SCHUIN - cw * 0.7, cw * 2, cw * 1.4); }
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = Math.max(0.8, hw * 0.8); c.beginPath();
    for (let k = 0; k < n; k++) { const b = k * TOREN, x = buf[b], y = buf[b + 1], Ht = buf[b + 2]; c.moveTo(x, y); c.lineTo(x + Ht * SCHUIN, y + Ht * SCHUIN); }
    c.stroke();
    // poten (en bij diep inzoomen kruisverbanden en een ladder)
    c.strokeStyle = '#4a4136'; c.lineWidth = Math.max(0.6, 0.09 * U); c.beginPath();
    for (let k = 0; k < n; k++) {
      const b = k * TOREN, x = buf[b], y = buf[b + 1], Ht = buf[b + 2], top = y - Ht + ch;
      for (let dx = -1; dx <= 1; dx += 2) for (let dy = -0.5; dy <= 0.5; dy += 1) { c.moveTo(x + dx * hw, y + dy * hw); c.lineTo(x + dx * hw * 0.75, top + dy * hw * 0.4); }
      if (groot) { c.moveTo(x - hw, y + hw * 0.5); c.lineTo(x + hw * 0.75, top); c.moveTo(x + hw, y + hw * 0.5); c.lineTo(x - hw * 0.75, top); }
    }
    c.stroke();
    if (z >= 11) {
      c.strokeStyle = '#7a6a52'; c.lineWidth = Math.max(0.5, 0.05 * U); c.beginPath();
      for (let k = 0; k < n; k++) { const b = k * TOREN, x = buf[b] + hw * 1.2, y = buf[b + 1] + hw * 0.6, Ht = buf[b + 2]; c.moveTo(x, y); c.lineTo(x - hw * 0.4, y - Ht + ch); for (let j = 1; j < 6; j++) { const f = j / 6; c.moveTo(x - hw * 0.4 * f - U * 0.1, y - (Ht - ch) * f); c.lineTo(x - hw * 0.4 * f + U * 0.1, y - (Ht - ch) * f); } }
      c.stroke();
    }
    // cabine, raamband en dak (met sneeuw in de winter)
    c.fillStyle = '#6b5a44'; c.beginPath();
    for (let k = 0; k < n; k++) { const b = k * TOREN, x = buf[b], y = buf[b + 1] - buf[b + 2]; c.rect(x - cw, y, cw * 2, ch); }
    c.fill();
    c.fillStyle = '#1b2228'; c.beginPath();
    for (let k = 0; k < n; k++) { const b = k * TOREN, x = buf[b], y = buf[b + 1] - buf[b + 2]; c.rect(x - cw * 0.85, y + ch * 0.2, cw * 1.7, ch * 0.38); }
    c.fill();
    const sn = this.sneeuw > 0.5;
    c.fillStyle = sn ? '#e9edf0' : '#4f5a46'; c.beginPath();
    for (let k = 0; k < n; k++) { const b = k * TOREN, x = buf[b], y = buf[b + 1] - buf[b + 2]; c.moveTo(x - cw * 1.25, y + ch * 0.05); c.lineTo(x + cw * 1.25, y + ch * 0.05); c.lineTo(x + cw * 0.9, y - ch * 0.55); c.lineTo(x - cw * 0.9, y - ch * 0.55); c.closePath(); }
    c.fill();
    if (groot) {
      // de noordwestkant van het dak vangt het licht
      c.fillStyle = sn ? '#ffffff' : '#6f7b62'; c.beginPath();
      for (let k = 0; k < n; k++) { const b = k * TOREN, x = buf[b], y = buf[b + 1] - buf[b + 2]; c.moveTo(x - cw * 1.25, y + ch * 0.05); c.lineTo(x - cw * 0.9, y - ch * 0.55); c.lineTo(x, y - ch * 0.55); c.lineTo(x - cw * 0.2, y + ch * 0.05); c.closePath(); }
      c.fill();
    }
    if (z >= 10) {
      // zoeklicht op het dak, met de lamp in de richting van de vijand; een wachter in het raam
      c.fillStyle = '#c9ccc8'; c.beginPath();
      for (let k = 0; k < n; k++) { const b = k * TOREN, x = buf[b] + Math.cos(buf[b + 3]) * cw * 0.6, y = buf[b + 1] - buf[b + 2] - ch * 0.6 + Math.sin(buf[b + 3]) * ch * 0.3; stip(c, x, y, Math.max(0.6, 0.13 * U)); }
      c.fill();
      c.fillStyle = UNIFORM[0]; c.beginPath();
      for (let k = 0; k < n; k++) { const b = k * TOREN, x = buf[b] + Math.sin(this.klok * 0.3 + buf[b + 4]) * cw * 0.5, y = buf[b + 1] - buf[b + 2] + ch * 0.38; stip(c, x, y, Math.max(0.5, 0.12 * U)); }
      c.fill();
    }
    // 's nachts brandt er licht in de cabine
    if (this.nacht > 0.05) for (let k = 0; k < n; k++) { const b = k * TOREN; this.zetLicht(buf[b], buf[b + 1] - buf[b + 2] + ch * 0.4, cw * 1.6, WARM, 0.5); }
    c.globalAlpha = 1;
  }

  // ---------- patrouilles ----------

  tekenPatrouilles(c, a) {
    if (a <= 0 || !this.nZr) return;
    const U = this.sc, ox = this.ox, oy = this.oy, z = this.zoom;
    const buf = this._soldaat ?? (this._soldaat = new Float32Array(PLAFOND.soldaten * 4));
    const wagen = this._wagen ?? (this._wagen = new Float32Array(PLAFOND.voertuigen * 4));
    let n = 0, nw = 0;
    const plek = PLAFOND.soldaten - this.n.soldaten; // de posten hebben hun soldaten al getekend
    for (let q = 0; q < this.nZr; q++) {
      const o5 = q * 5, e = this.brokken[this.zr[o5]], r = this.zr[o5 + 1], k = this.klasseVanRun(e, r);
      if (k !== OORLOG && k !== BLOK) continue;
      const b0 = e.runs[r * RS], cnt = e.runs[r * RS + 1], zaad = e.runs[r * RS + 5], st = e.st;
      const i0 = this.zr[o5 + 2], i1 = this.zr[o5 + 3], off = this.zr[o5 + 4];
      const venster = k === OORLOG ? 40 : 70;
      const w0 = Math.floor(st[i0 * PS + 4] / venster), w1 = Math.floor(st[i1 * PS + 4] / venster);
      for (let v = w0; v <= w1; v++) {
        // in oorlog afwisselend aan beide kanten, langs een blokgrens altijd op de kant van de patrouillestrook
        const zij = k === BLOK ? (hash(zaad, 3) < 0.5 ? 1 : -1) : ((v + (zaad & 1)) & 1 ? 1 : -1);
        const ruimte = Math.min(venster * 0.7, e.runs[r * RS + 4] - 2);
        if (ruimte < 4) continue;
        const begin = clamp(v * venster + venster * 0.15, 0.5, e.runs[r * RS + 4] - ruimte - 0.5);
        const snel = k === OORLOG ? 0.7 : 2.2; // eenheden per seconde: lopen of rijden
        const fase = this.klok * snel / ruimte / 2 + hash(zaad, v, 7);
        const pos = begin + ruimte * tri(fase), rich = frac(fase) < 0.5 ? 1 : -1;
        const leden = k === OORLOG ? 3 : 1;
        for (let m = 0; m < leden; m++) {
          const sp = pos - rich * m * 1.1;
          const fi = clamp(sp / STUK - 0.5, 0, cnt - 1.001), ii = Math.floor(fi), f = fi - ii, i = b0 + ii, j = Math.min(b0 + cnt - 1, i + 1);
          if (i < i0 || i > i1 || !this.masker[off + i - i0]) continue;
          if (!(e.bits[i] & (zij > 0 ? T_PLUS : T_MIN))) continue;
          const oi = i * PS, oj = j * PS;
          const tx = st[oi + 2] * rich, ty = st[oi + 3] * rich;
          const d = (k === OORLOG ? D_PATROUILLE : D_STROOK) * zij;
          const wx = st[oi] + (st[oj] - st[oi]) * f - st[oi + 3] * d, wy = st[oi + 1] + (st[oj + 1] - st[oi + 1]) * f + st[oi + 2] * d;
          if (!this.inBeeld(wx, wy, 2)) continue;
          if (k === OORLOG) { if (n >= plek) continue; buf[n * 4] = wx * U + ox; buf[n * 4 + 1] = wy * U + oy; buf[n * 4 + 2] = tx; buf[n * 4 + 3] = ty; n++; }
          else if (nw < PLAFOND.voertuigen && hash(zaad, v, 8) < 0.6) { wagen[nw * 4] = wx * U + ox; wagen[nw * 4 + 1] = wy * U + oy; wagen[nw * 4 + 2] = tx; wagen[nw * 4 + 3] = ty; nw++; }
        }
      }
    }
    this.n.soldaten += n;
    this.n.voertuigen += nw;
    c.globalAlpha = a;
    if (n) this.tekenSoldaten(c, buf, n, z, UNIFORM[0]);
    // grenswacht in een terreinwagen op de patrouillestrook
    if (nw) {
      const L = 0.62 * U, B = 0.3 * U;
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath();
      for (let k = 0; k < nw; k++) rechthoek(c, wagen[k * 4] + U * 0.25, wagen[k * 4 + 1] + U * 0.25, wagen[k * 4 + 2], wagen[k * 4 + 3], L, B);
      c.fill();
      c.fillStyle = '#e8e6df'; c.beginPath();
      for (let k = 0; k < nw; k++) rechthoek(c, wagen[k * 4], wagen[k * 4 + 1], wagen[k * 4 + 2], wagen[k * 4 + 3], L, B);
      c.fill();
      c.fillStyle = '#2f6b4a'; c.beginPath();
      for (let k = 0; k < nw; k++) rechthoek(c, wagen[k * 4] - wagen[k * 4 + 2] * L * 0.2, wagen[k * 4 + 1] - wagen[k * 4 + 3] * L * 0.2, wagen[k * 4 + 2], wagen[k * 4 + 3], L * 0.55, B * 1.02);
      c.fill();
      if (z >= 10) {
        c.fillStyle = '#20303a'; c.beginPath();
        for (let k = 0; k < nw; k++) rechthoek(c, wagen[k * 4] + wagen[k * 4 + 2] * L * 0.45, wagen[k * 4 + 1] + wagen[k * 4 + 3] * L * 0.45, wagen[k * 4 + 2], wagen[k * 4 + 3], L * 0.12, B * 0.85);
        c.fill();
      }
      if (this.nacht > 0.05) for (let k = 0; k < nw; k++) this.zetLicht(wagen[k * 4] + wagen[k * 4 + 2] * L * 1.6, wagen[k * 4 + 1] + wagen[k * 4 + 3] * L * 1.6, L * 1.4, WARM, 0.55);
    }
    c.globalAlpha = 1;
  }

  // Soldaten of douaniers: schaduw, lijf, helm of pet, en dichtbij een geweer over de schouder.
  tekenSoldaten(c, buf, n, z, kleur, pet = null) {
    const U = this.sc, r = Math.max(0.6, 0.2 * U);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath();
    for (let k = 0; k < n; k++) stip(c, buf[k * 4] + r * 0.6, buf[k * 4 + 1] + r * 0.5, r);
    c.fill();
    c.fillStyle = kleur; c.beginPath();
    for (let k = 0; k < n; k++) stip(c, buf[k * 4], buf[k * 4 + 1], r);
    c.fill();
    if (z >= 9) {
      c.fillStyle = pet ?? '#3a4430'; c.beginPath();
      for (let k = 0; k < n; k++) stip(c, buf[k * 4] + buf[k * 4 + 2] * r * 0.15, buf[k * 4 + 1] + buf[k * 4 + 3] * r * 0.15 - r * 0.15, r * 0.62);
      c.fill();
    }
    if (z >= 11 && !pet) {
      c.strokeStyle = '#1e1e1c'; c.lineWidth = Math.max(0.5, 0.06 * U); c.beginPath();
      for (let k = 0; k < n; k++) { const x = buf[k * 4], y = buf[k * 4 + 1], hx = buf[k * 4 + 2], hy = buf[k * 4 + 3]; c.moveTo(x - hy * r * 0.8 - hx * r, y + hx * r * 0.8 - hy * r); c.lineTo(x - hy * r * 0.8 + hx * r * 1.3, y + hx * r * 0.8 + hy * r * 1.3); }
      c.stroke();
    }
  }

  // ---------- grensposten ----------

  tekenPosten(c, a) {
    if (a <= 0 || !this.nZo) return;
    for (let k = 0; k < this.nZo && this.n.overgangen < PLAFOND.overgangen; k++) {
      const g = this.overgangen[this.zo[k]];
      if (!this.inBeeld(g.x, g.y, 14)) continue;
      this.tekenPost(c, g, a);
      this.n.overgangen++;
    }
  }

  tekenPost(c, g, a) {
    const U = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, s = this.state;
    const n = s.landen.length, klas = g.a < n && g.b < n ? this.klas[g.a * n + g.b] : NEUTRAAL;
    const ux = g.ux, uy = g.uy, rx = -uy, ry = ux;
    // wereld (langs, dwars) → scherm
    const X = (l, d) => (g.x + ux * l + rx * d) * U + ox;
    const Y = (l, d) => (g.y + uy * l + ry * d) * U + oy;
    const sn = this.sneeuw > 0.5;
    c.globalAlpha = a;
    // verbreed asfalt bij de post, met stopstrepen en een middenlijn
    if (z >= 5) {
      c.fillStyle = RAND; c.beginPath(); rechthoek(c, X(0, 0), Y(0, 0), ux, uy, 3.6 * U, 2.0 * U); c.fill();
      c.fillStyle = ASFALT; c.beginPath(); rechthoek(c, X(0, 0), Y(0, 0), ux, uy, 3.5 * U, 1.85 * U); c.fill();
      if (z >= 8) {
        c.fillStyle = '#ecebe4'; c.beginPath();
        rechthoek(c, X(-2.3, 0.95), Y(-2.3, 0.95), ux, uy, 0.08 * U, 0.85 * U);
        rechthoek(c, X(2.3, -0.95), Y(2.3, -0.95), ux, uy, 0.08 * U, 0.85 * U);
        c.fill();
        c.strokeStyle = '#ecebe4'; c.lineWidth = Math.max(0.5, 0.07 * U); c.setLineDash([U * 0.4, U * 0.3]); c.beginPath();
        c.moveTo(X(-3.4, 0), Y(-3.4, 0)); c.lineTo(X(3.4, 0), Y(3.4, 0)); c.stroke(); c.setLineDash([]);
      }
      if (z >= 10 && klas !== OORLOG) {
        // verkeersdrempels in geel en zwart
        c.fillStyle = '#d9b43a'; c.beginPath();
        for (const [l, d] of POST_DREMPEL) rechthoek(c, X(l, d), Y(l, d), ux, uy, 0.12 * U, 0.85 * U);
        c.fill();
      }
    }
    // Volgorde van achter naar voren: grond en schaduwen, hokjes, wat op de weg staat of rijdt, mensen, en als laatste
    // de overkapping (die hangt hoog boven de rijstroken, dus vrachtwagens rijden eronder door, niet eroverheen).
    // schaduw van de overkapping op het asfalt
    const hC = 0.95;
    const dak = klas === OORLOG ? '#6b6f5a' : '#dfe1de', bies = klas === BONDGENOOT ? '#3d8a5a' : klas === OORLOG ? '#4a4d3c' : klas === BLOK ? '#3f5468' : '#8a7a5a';
    c.fillStyle = 'rgba(0,0,0,0.24)'; c.beginPath(); rechthoek(c, X(0, 0) + hC * SCHUIN * U, Y(0, 0) + hC * SCHUIN * U, ux, uy, 1.25 * U, 2.15 * U); c.fill();
    // wat dicht bij de weg staat, mag niet voorbij het begin of eind van de verbindingsweg (daar ligt een stad of gebouw)
    const vrij = (l) => (l < 0 ? -l <= g.la - 0.8 : l <= g.lb - 0.8);
    if (klas === OORLOG && z >= 7) {
      // zandzakken rond de hokjes, achter de hokjes getekend
      c.strokeStyle = sn ? '#e2e0d8' : '#b39d76'; c.lineWidth = 0.4 * U; c.setLineDash([U * 0.34, U * 0.1]); c.beginPath();
      for (let k2 = -1; k2 <= 1; k2 += 2) { const x = X(2.5 * k2, -1.95 * k2), y = Y(2.5 * k2, -1.95 * k2); c.moveTo(x + 1.1 * U, y); c.arc(x, y, 1.1 * U, 0, TAU); }
      c.stroke(); c.setLineDash([]);
    }
    // douanehokjes: elk land een eigen hokje rechts van zijn rijstrook, met de deur in de vlagkleur
    const vl = vlagOntwerpen(s);
    if (z >= DREMPEL.hokje - 0.3) {
      for (let k2 = 0; k2 < 2; k2++) {
        const l = k2 ? 2.5 : -2.5, d = k2 ? -1.95 : 1.95, land = k2 ? g.b : g.a;
        if (this.n.hokjes >= PLAFOND.hokjes) break;
        const x = X(l, d), y = Y(l, d), hB = 0.55 * U;
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); rechthoek(c, x + hB * SCHUIN, y + hB * SCHUIN, ux, uy, 0.48 * U, 0.4 * U); c.fill();
        c.fillStyle = '#cfc8b8'; c.beginPath(); rechthoek(c, x, y, ux, uy, 0.48 * U, 0.4 * U); c.fill();
        c.fillStyle = sn ? '#eef1f3' : klas === OORLOG ? '#5a5f46' : '#5d6670'; c.beginPath(); rechthoek(c, x, y - hB, ux, uy, 0.52 * U, 0.44 * U); c.fill();
        if (z >= 8) {
          c.fillStyle = this.nacht > 0.3 ? '#ffe9a8' : '#2f4152'; c.beginPath(); rechthoek(c, x, y - hB * 0.45, ux, uy, 0.36 * U, 0.06 * U); c.fill();
          c.fillStyle = vl[land]?.hoofd ?? '#888888'; c.beginPath(); rechthoek(c, x - rx * 0.4 * U * Math.sign(d), y - ry * 0.4 * U * Math.sign(d) - hB * 0.3, ux, uy, 0.1 * U, 0.04 * U); c.fill();
        }
        if (this.nacht > 0.05) this.zetLicht(x, y - hB * 0.4, 0.9 * U, WARM, 0.7);
        this.n.hokjes++;
      }
    }
    // vlaggen van beide landen, elk aan de kant van zijn eigen land
    this.zetVlag(g.x + ux * -1.0 - rx * 3.2, g.y + uy * -1.0 - ry * 3.2, 1.7, 0.85, g.a, g.zaad);
    this.zetVlag(g.x + ux * 1.0 + rx * 3.2, g.y + uy * 1.0 + ry * 3.2, 1.7, 0.85, g.b, g.zaad + 1);
    // oorlog: betonblokken en egels op de weg
    if (klas === OORLOG) {
      const blok = (l, d) => rechthoek(c, X(l, d), Y(l, d), ux, uy, 0.22 * U, 0.55 * U);
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath();
      for (const [l, d] of POST_BLOKKEN) rechthoek(c, X(l, d) + U * 0.25, Y(l, d) + U * 0.25, ux, uy, 0.22 * U, 0.55 * U);
      c.fill();
      c.fillStyle = '#a8a59c'; c.beginPath();
      for (const [l, d] of POST_BLOKKEN) blok(l, d);
      c.fill();
      if (z >= 7) {
        c.strokeStyle = '#34342f'; c.lineWidth = Math.max(0.6, 0.12 * U); c.beginPath();
        for (const [l, d] of POST_EGELS) {
          if (!vrij(l)) continue;
          const x = X(l, d), y = Y(l, d), R = 0.45 * U;
          for (let j = 0; j < 3; j++) { const h = j * 1.047; c.moveTo(x - Math.cos(h) * R, y - Math.sin(h) * R * 0.7); c.lineTo(x + Math.cos(h) * R, y + Math.sin(h) * R * 0.7); }
        }
        c.stroke();
      }
    }
    // verkeer: open stroom tussen bondgenoten, een rij voor de slagboom elders, niets in oorlog
    const v = g.zaad;
    for (let baan = 0; baan < 2; baan++) {
      // baan 0 rijdt van a naar b, baan 1 terug; aanloop is de weg vóór de post, uitloop die erna
      const rich = baan ? -1 : 1, aan = baan ? g.lb : g.la, uit = baan ? g.la : g.lb;
      let open = 0;
      if (klas === BONDGENOOT) {
        open = 1;
        if (z >= DREMPEL.vrachtwagen - 0.5) {
          const L = aan + uit;
          for (let i = 0; i < 2; i++) {
            const f = frac(this.klok * 1.4 / L + hash(v, baan, i));
            this.zetWagen(c, g, rich, -aan + f * L, (v + i * 7 + baan * 3) | 0, a * (f < 0.06 ? f / 0.06 : f > 0.94 ? (1 - f) / 0.06 : 1), i === 1, a);
          }
        }
      } else if (klas !== OORLOG) {
        const P = (klas === NEUTRAAL ? 6 : 13) + hash(v, baan, 2) * 4;
        const t = this.klok / P + hash(v, baan, 3), cyclus = Math.floor(t), fi = t - cyclus;
        open = smooth(0, 0.07, fi) * (1 - smooth(0.3, 0.37, fi));
        const adv = smooth(0.06, 0.3, fi);
        const max = klas === NEUTRAAL ? 2 : 4 + Math.floor(hash(v, baan, 4) * 3);
        const nq = Math.min(max, Math.floor((aan - 3.4) / 2.9) + 1);
        if (z >= DREMPEL.vrachtwagen - 0.5 && nq > 0) {
          for (let i = 0; i <= nq; i++) {
            const slot = i - adv;
            let langs = -(3.6 + slot * 2.9);
            // de voorste rijdt door en verdwijnt aan de overkant
            if (i === 0) langs = -3.6 + adv * 2.9 + smooth(0.2, 1, fi) * (uit + 0.5);
            if (-langs > aan - 1.2 || langs > uit - 0.5) continue;
            const alfa = i === nq ? smooth(0, 0.5, fi) : 1;
            this.zetWagen(c, g, rich, langs, (cyclus + i + baan * 31 + v) | 0, a * alfa, false, a);
          }
        }
      }
      // slagboom: draaipunt aan de stoeprand, arm over de eigen rijstrook
      if (z >= DREMPEL.hokje - 0.3 && this.n.slagbomen < PLAFOND.slagbomen) {
        this.slagboom(c, X(-1.8 * rich, 1.0 * rich), Y(-1.8 * rich, 1.0 * rich), -rx * rich, -ry * rich, 1.0 * U, open, klas);
        this.n.slagbomen++;
      }
    }
    // mensen: soldaten bij de hokjes in oorlog, anders douaniers bij de slagboom en pionnen tussen de rijstroken
    if (klas === OORLOG) {
      if (z >= 9 && this.n.soldaten + POST_WACHT.length <= PLAFOND.soldaten) {
        const buf = this._wacht ?? (this._wacht = new Float32Array(8 * 4));
        let m = 0;
        for (const [l, d] of POST_WACHT) { buf[m * 4] = X(l, d); buf[m * 4 + 1] = Y(l, d); buf[m * 4 + 2] = ux * (l < 0 ? 1 : -1); buf[m * 4 + 3] = uy * (l < 0 ? 1 : -1); m++; }
        this.tekenSoldaten(c, buf, m, z, UNIFORM[0]);
        this.n.soldaten += m;
      }
    } else if (z >= DREMPEL.douanier) {
      const buf = this._wacht ?? (this._wacht = new Float32Array(8 * 4));
      let m = 0;
      const wieg = Math.sin(this.klok * 0.8 + g.zaad) * 0.15;
      for (let k2 = -1; k2 <= 1; k2 += 2) { const l = (1.5 - wieg) * k2, d = -1.45 * k2; buf[m * 4] = X(l, d); buf[m * 4 + 1] = Y(l, d); buf[m * 4 + 2] = -rx; buf[m * 4 + 3] = -ry; m++; }
      if (this.n.soldaten + m <= PLAFOND.soldaten) {
        this.tekenSoldaten(c, buf, m, z, DOUANE[klas] ?? DOUANE[1], '#1f2a36');
        this.n.soldaten += m;
      }
      if (z >= DREMPEL.pion) {
        c.fillStyle = '#f07a2a'; c.beginPath();
        for (let i = 0; i < 4; i++) { const l = -5.2 + i * 0.7; if (vrij(l)) stip(c, X(l, 0), Y(l, 0), 0.14 * U); if (vrij(-l)) stip(c, X(-l, 0), Y(-l, 0), 0.14 * U); }
        c.fill();
        c.fillStyle = '#f4f4f0'; c.beginPath();
        for (let i = 0; i < 4; i++) { const l = -5.2 + i * 0.7; if (vrij(l)) stip(c, X(l, 0), Y(l, 0) - 0.05 * U, 0.06 * U); if (vrij(-l)) stip(c, X(-l, 0), Y(-l, 0) - 0.05 * U, 0.06 * U); }
        c.fill();
      }
    }
    // overkapping: pilaren, dak met een bies in de kleur van de grens
    if (z >= 6) {
      c.strokeStyle = '#8d9094'; c.lineWidth = Math.max(0.6, 0.12 * U); c.beginPath();
      for (let i = 0; i < 4; i++) { const l = i & 1 ? 1.1 : -1.1, d = i & 2 ? 1.95 : -1.95; c.moveTo(X(l, d), Y(l, d)); c.lineTo(X(l, d), Y(l, d) - hC * U); }
      c.stroke();
    }
    c.fillStyle = sn ? '#f1f3f5' : dak; c.beginPath(); rechthoek(c, X(0, 0), Y(0, 0) - hC * U, ux, uy, 1.25 * U, 2.15 * U); c.fill();
    c.fillStyle = bies; c.beginPath();
    rechthoek(c, X(0, 2.05), Y(0, 2.05) - hC * U, ux, uy, 1.25 * U, 0.1 * U);
    rechthoek(c, X(0, -2.05), Y(0, -2.05) - hC * U, ux, uy, 1.25 * U, 0.1 * U);
    c.fill();
    if (z >= 9) {
      // daklichten onder de overkapping (overdag grijze vlakjes, 's nachts fel)
      c.fillStyle = this.nacht > 0.3 ? '#f6f8ff' : '#b9bcbf'; c.beginPath();
      for (let d = -1; d <= 1; d += 2) rechthoek(c, X(0, d), Y(0, d) - hC * U, ux, uy, 0.7 * U, 0.08 * U);
      c.fill();
    }
    if (this.nacht > 0.05) for (let d = -1; d <= 1; d += 2) { this.zetLicht(X(0, d), Y(0, d), 2.6 * U, KOEL, 0.55); this.zetLicht(X(0, d), Y(0, d) - hC * U, 0.9 * U, KOEL, 0.8); }
    if (klas === BLOK && z >= DREMPEL.camera && this.n.cameras < PLAFOND.cameras) {
      // camera op een paal bij de overkapping
      const x = X(1.3, 2.3), y = Y(1.3, 2.3), Hc = 1.3 * U, h = Math.sin(this.nu / 2400 + g.zaad) * 0.6 + Math.atan2(-uy, -ux);
      c.strokeStyle = '#5d6166'; c.lineWidth = Math.max(0.5, 0.08 * U); c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - Hc); c.stroke();
      c.fillStyle = '#d8dad6'; c.beginPath(); rechthoek(c, x + Math.cos(h) * 0.15 * U, y - Hc + Math.sin(h) * 0.15 * U, Math.cos(h), Math.sin(h), 0.2 * U, 0.09 * U); c.fill();
      this.n.cameras++;
    }
    c.globalAlpha = 1;
  }

  // Een slagboom met draaipunt (x, y): de arm ligt over (hx, hy) als hij dicht is en staat rechtop als hij open is.
  slagboom(c, x, y, hx, hy, L, open, klas) {
    const U = this.sc, z = this.zoom, f = open * Math.PI * 0.47;
    const H = 0.35 * U;
    const tx = x + hx * L * Math.cos(f), ty = y - H + hy * L * Math.cos(f) - L * Math.sin(f);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); stip(c, x + H * SCHUIN, y + H * SCHUIN, 0.14 * U); c.fill();
    c.strokeStyle = '#3a3d40'; c.lineWidth = Math.max(0.8, 0.14 * U); c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - H); c.stroke();
    c.lineCap = 'round';
    c.strokeStyle = '#f2f2ef'; c.lineWidth = Math.max(0.8, 0.13 * U); c.beginPath(); c.moveTo(x, y - H); c.lineTo(tx, ty); c.stroke();
    c.strokeStyle = '#c8302a'; c.setLineDash([L * 0.16, L * 0.16]); c.beginPath(); c.moveTo(x, y - H); c.lineTo(tx, ty); c.stroke(); c.setLineDash([]);
    c.lineCap = 'butt';
    if (z >= 9) {
      // seinlicht: groen als de boom open is, rood als hij dicht is
      c.fillStyle = open > 0.5 ? '#3ad070' : '#e0342a'; c.beginPath(); stip(c, x, y - H - 0.12 * U, Math.max(0.6, 0.1 * U)); c.fill();
      if (this.nacht > 0.05) this.zetLicht(x, y - H - 0.12 * U, 0.6 * U, open > 0.5 ? GROEN : ROOD, 0.8);
    }
    void klas;
  }

  // Vrachtwagen (of bestelauto) op de verbindingsweg, langs (langs) eenheden vanaf de post in rijrichting rich.
  // alfa is de dekking van deze wagen (in- en uitfaden), basis die van de post: zo hoeft niemand de context uit te lezen.
  zetWagen(c, g, rich, langs, zaad, alfa, klein, basis) {
    if (this.n.vrachtwagens >= PLAFOND.vrachtwagens || alfa <= 0.01) return;
    const U = this.sc, z = this.zoom, ux = g.ux * rich, uy = g.uy * rich, rx = -uy, ry = ux;
    const wx = g.x + ux * langs + rx * 0.48, wy = g.y + uy * langs + ry * 0.48;
    if (!this.inBeeld(wx, wy, 2)) return;
    this.n.vrachtwagens++;
    const x = wx * U + this.ox, y = wy * U + this.oy;
    const L = (klein ? 0.62 : 1.25) * U, B = (klein ? 0.34 : 0.42) * U;
    c.globalAlpha = alfa;
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); rechthoek(c, x + U * 0.3, y + U * 0.3, ux, uy, L, B); c.fill();
    const h = hash(zaad, 17);
    if (klein) {
      c.fillStyle = TRUCK[Math.floor(h * TRUCK.length)]; c.beginPath(); rechthoek(c, x, y, ux, uy, L, B); c.fill();
      if (z >= 9) { c.fillStyle = '#22303a'; c.beginPath(); rechthoek(c, x + ux * L * 0.35, y + uy * L * 0.35, ux, uy, L * 0.16, B * 0.85); c.fill(); }
    } else {
      // oplegger achter, cabine voor; dichtbij een voorruit en een lichte rand bovenop
      const tx = x - ux * L * 0.22, ty = y - uy * L * 0.22;
      c.fillStyle = TRUCK[Math.floor(h * TRUCK.length)]; c.beginPath(); rechthoek(c, tx, ty, ux, uy, L * 0.76, B); c.fill();
      c.fillStyle = CABINE[Math.floor(hash(zaad, 18) * CABINE.length)]; c.beginPath(); rechthoek(c, x + ux * L * 0.74, y + uy * L * 0.74, ux, uy, L * 0.22, B * 0.94); c.fill();
      if (z >= 9) {
        c.fillStyle = '#1f2a33'; c.beginPath(); rechthoek(c, x + ux * L * 0.9, y + uy * L * 0.9, ux, uy, L * 0.05, B * 0.8); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); rechthoek(c, tx - rx * B * 0.55, ty - ry * B * 0.55, ux, uy, L * 0.74, B * 0.25); c.fill();
      }
      if (z >= 12) {
        c.fillStyle = '#1b1b1b'; c.beginPath();
        for (let w = 0; w < WIELEN.length; w++) for (let d = -1; d <= 1; d += 2) rechthoek(c, x + ux * L * WIELEN[w] + rx * B * d, y + uy * L * WIELEN[w] + ry * B * d, ux, uy, L * 0.07, B * 0.12);
        c.fill();
      }
    }
    c.globalAlpha = basis;
    if (this.nacht > 0.05) {
      this.zetLicht(x + ux * L * 1.15, y + uy * L * 1.15, L * 0.8, WARM, 0.5 * alfa);
      this.zetLicht(x - ux * L, y - uy * L, L * 0.35, ROOD, 0.6 * alfa);
    }
  }

  // ---------- bezet gebied ----------

  tekenBezetGrond(c, a, view) {
    if (a <= 0 || !this.bezetLijst.length) return;
    const U = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, Tw = this.geo.T, sp = this.sprites;
    let nb = 0, ns = 0, np = 0;
    c.globalAlpha = a;
    for (let q = 0; q < this.bezetLijst.length && nb < PLAFOND.bezet; q++) {
      const t = this.bezetLijst[q], tg = this.geo.tegels[t];
      if (!this.inBeeld(tg.x, tg.y, Tw)) continue;
      nb++;
      const land = this.state.eigenaar[t];
      // schroeiplekken: twee tot vier, vast per vakje
      const nS = 2 + Math.floor(hash(t, 51) * 3);
      const gebouw = !!this.state.bezet[t];
      for (let i = 0; i < nS && ns < PLAFOND.schroei; i++) {
        // op een vakje met een gebouw alleen langs de rand, zodat het gebouw zelf heel blijft
        let fx = hash(t, i, 52) - 0.5, fy = hash(t, i, 53) - 0.5;
        if (gebouw) { if (hash(t, i, 62) < 0.5) fx = fx < 0 ? -0.46 : 0.46; else fy = fy < 0 ? -0.46 : 0.46; }
        const wx = tg.x + fx * Tw * 0.9, wy = tg.y + fy * Tw * 0.9;
        if (this.eigOp(wx, wy) < 0) continue;
        const r = (1.2 + hash(t, i, 54) * 2.4) * U;
        if (sp.schroei) c.drawImage(sp.schroei, wx * U + ox - r, wy * U + oy - r * 0.8, r * 2, r * 1.6);
        ns++;
      }
      // puin vanaf zoom 6
      if (z >= 6) {
        const nP = 1 + Math.floor(hash(t, 55) * 3);
        for (let i = 0; i < nP && np < PLAFOND.puin; i++) {
          const wx = tg.x + (hash(t, i, 56) - 0.5) * Tw * 0.8, wy = tg.y + (hash(t, i, 57) - 0.5) * Tw * 0.8;
          if (this.eigOp(wx, wy) < 0 || this.bebouwdSnel(wx, wy)) continue;
          const r = (0.6 + hash(t, i, 58) * 0.7) * U, s = sp.puin[Math.floor(hash(t, i, 59) * 3)];
          if (s) c.drawImage(s, wx * U + ox - r, wy * U + oy - r, r * 2, r * 2);
          np++;
        }
      }
      // de vlag van de bezetter op ongeveer de helft van de vakjes (op een gebouw: in de hoek)
      if (hash(t, 60) < 0.5) {
        const hoek = this.state.bezet[t] ? 0.42 : 0.15;
        const vx = tg.x + Tw * hoek * (hash(t, 61) < 0.5 ? -1 : 1), vy = tg.y - Tw * hoek;
        // een kustvakje of een vakje met een rivier: geen vlag in het water
        if (this.eigOp(vx, vy) >= 0 && !this.zoet(view, vx, vy)) this.zetVlag(vx, vy, 1.6, 0.8, land, t);
      }
    }
    this.n.bezet = nb; this.n.schroei = ns; this.n.puin = np;
    c.globalAlpha = 1;
  }

  // Controlepost op een weg in bezet gebied: zandzakken, een dichte slagboom, een hokje, de vlag en wachtposten.
  tekenControleposten(c, a) {
    if (a <= 0 || !this.controleposten.length) return;
    const U = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, sn = this.sneeuw > 0.5;
    c.globalAlpha = a;
    for (let q = 0; q < this.controleposten.length && this.n.controleposten < PLAFOND.controleposten; q++) {
      const p = this.controleposten[q];
      if (!this.inBeeld(p.x, p.y, 5)) continue;
      this.n.controleposten++;
      const ux = p.ux, uy = p.uy, rx = -uy, ry = ux;
      const X = (l, d) => (p.x + ux * l + rx * d) * U + ox, Y = (l, d) => (p.y + uy * l + ry * d) * U + oy;
      c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = 0.5 * U; c.beginPath();
      for (let k2 = -1; k2 <= 1; k2 += 2) { const d = 1.7 * k2; c.moveTo(X(-1.2, d) + U * 0.2, Y(-1.2, d) + U * 0.2); c.lineTo(X(1.2, d) + U * 0.2, Y(1.2, d) + U * 0.2); }
      c.stroke();
      c.strokeStyle = sn ? '#e2e0d8' : '#b39d76'; c.lineWidth = 0.42 * U;
      if (z >= 8) c.setLineDash([U * 0.34, U * 0.1]);
      c.beginPath();
      for (let k2 = -1; k2 <= 1; k2 += 2) { const d = 1.7 * k2; c.moveTo(X(-1.2, d), Y(-1.2, d)); c.lineTo(X(1.2, d), Y(1.2, d)); }
      c.stroke(); c.setLineDash([]);
      // hokje van zandzakken en golfplaat
      const hx = X(0.2, 2.6), hy = Y(0.2, 2.6), hB = 0.45 * U;
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); rechthoek(c, hx + hB * SCHUIN, hy + hB * SCHUIN, ux, uy, 0.5 * U, 0.42 * U); c.fill();
      c.fillStyle = '#7d7a62'; c.beginPath(); rechthoek(c, hx, hy, ux, uy, 0.5 * U, 0.42 * U); c.fill();
      c.fillStyle = sn ? '#eef1f3' : '#5d6b4a'; c.beginPath(); rechthoek(c, hx, hy - hB, ux, uy, 0.55 * U, 0.46 * U); c.fill();
      if (z >= 6) this.slagboom(c, X(-0.6, 1.0), Y(-0.6, 1.0), -rx, -ry, 1.0 * U, 0, OORLOG);
      this.zetVlag(p.x - rx * 2.4, p.y - ry * 2.4, 1.6, 0.8, p.land, p.t);
      if (z >= 9 && this.n.soldaten + 2 <= PLAFOND.soldaten) {
        const buf = this._wacht ?? (this._wacht = new Float32Array(8 * 4));
        buf[0] = X(-1.4, 0.6); buf[1] = Y(-1.4, 0.6); buf[2] = -ux; buf[3] = -uy;
        buf[4] = X(0.9, -1.1); buf[5] = Y(0.9, -1.1); buf[6] = rx; buf[7] = ry;
        this.tekenSoldaten(c, buf, 2, z, UNIFORM[2]);
        this.n.soldaten += 2;
      }
      if (this.nacht > 0.05) { this.zetLicht(hx, hy - hB * 0.4, 1.2 * U, WARM, 0.7); this.zetLicht(X(0, 0), Y(0, 0), 2.4 * U, KOEL, 0.3); }
    }
    c.globalAlpha = 1;
  }

  // ---------- macht op straat in de hoofdsteden, vlaggen bij kazernes ----------

  tekenMacht(c, view) {
    const s = this.state, z = this.zoom, U = this.sc, ox = this.ox, oy = this.oy, T = this.T, Tw = this.geo.T, geo = this.geo;
    const P = s.pack, vl = vlagOntwerpen(s);
    // kazernes: een mast met de eigen vlag bij de poort
    if (z >= DREMPEL.vlag + 1) {
      for (const land of s.landen) {
        for (const p of land.plaatsingen) {
          if (p.t < 0 || p.g !== 'kazerne') continue;
          const tg = geo.tegels[p.t];
          if (!this.inBeeld(tg.x, tg.y, Tw)) continue;
          this.zetVlag(tg.x - Tw * 0.44, tg.y + Tw * 0.33, 2.2, 1.0, land.idx, p.t);
        }
      }
    }
    const blokKleur = s.blokken.find((b) => b.id === s.spelerBlok)?.kleur ?? '#f0b429';
    for (const land of s.landen) {
      const h = geo.hoofdstad[land.idx];
      if (h == null || h < 0 || s.eigenaar[h] !== land.idx) continue;
      const H0 = geo.tegels[h];
      if (!this.inBeeld(H0.x, H0.y, Tw * 0.7)) continue;
      const cx = H0.x * U + ox, cy = H0.y * U + oy;
      // nationale vlag op een hoge mast voor het regeringsgebouw
      this.zetVlag(H0.x - Tw * 0.26, H0.y - Tw * 0.11, 2.8, 1.4, land.idx, h);
      // ambassadestraatje: de vlaggen van de bondgenoten langs de oostelijke straat
      if (z >= DREMPEL.ambassade - 0.5 && land.alignment && land.alignment !== 'zwevend') {
        let i = 0;
        for (const ander of s.landen) {
          if (i >= 6) break;
          if (ander.idx === land.idx || ander.alignment !== land.alignment) continue;
          this.zetVlag(H0.x + Tw * (0.19 + i * 0.052), H0.y + Tw * 0.078, 1.7, 0.75, ander.idx, h * 7 + i);
          i++;
        }
      }
      if (z < DREMPEL.macht - 0.5) continue;
      const aM = smooth(DREMPEL.macht - 0.5, DREMPEL.macht + 0.3, z);
      c.globalAlpha = aM;
      const buitenland = land.idx !== s.speler;
      // media-invloed van het blok van de speler: reclameborden en affiches in de blokkleur
      const media = buitenland ? (land.media?.[s.spelerBlok] ?? 0) : 0;
      if (media >= 12) {
        const nb = Math.min(BORDPLEK.length, 1 + Math.floor(media / 30));
        for (let i = 0; i < nb && this.n.borden < PLAFOND.borden; i++) { this.bord(c, cx + BORDPLEK[i][0] * T, cy + BORDPLEK[i][1] * T, blokKleur, i + h); this.n.borden++; }
        if (z >= DREMPEL.affiche) {
          // affiches op de stoeprand van de zuidwestelijke groenstrook, tussen de bomen door
          const na = Math.min(6, Math.floor(media / 10));
          c.fillStyle = blokKleur; c.beginPath();
          for (let i = 0; i < na && this.n.affiches < PLAFOND.affiches; i++) {
            const x = cx + (-0.17 - i * 0.055) * T, y = cy + 0.071 * T;
            c.rect(x - T * 0.008, y - T * 0.022, T * 0.016, T * 0.02); this.n.affiches++;
          }
          c.fill();
          c.fillStyle = 'rgba(255,255,255,0.75)'; c.beginPath();
          for (let i = 0; i < na; i++) stip(c, cx + (-0.17 - i * 0.055) * T, cy + 0.057 * T, T * 0.004);
          c.fill();
        }
      }
      const regime = land.regime;
      if (regime === 'eenpartijstaat' || regime === 'militair') {
        // grote banieren aan de gevel van het regeringsgebouw en langs de noordoostelijke straat
        const kleur = vl[land.idx]?.hoofd ?? '#c0392b', accent = regime === 'militair' ? '#5d6b4a' : '#a8323a';
        // de zuidgevel van het regeringsgebouw in detail.js: bij de eenpartijstaat vier verdiepingen hoog, bij het
        // militaire regime twee, dus de banieren hangen van de dakrand tot net boven de grond
        const top = -0.236, len = regime === 'militair' ? 0.032 : 0.064;
        const wapper = Math.sin(this.nu / 900 + h) * 0.003;
        // banieren alleen zolang het plafond het toelaat (drie aan de gevel, twee langs de straat)
        const banier = this.n.banieren + BANIER_X.length + TUSSEN_BOMEN.length <= PLAFOND.banieren;
        if (banier) {
          c.fillStyle = accent; c.beginPath();
          for (let i = 0; i < BANIER_X.length; i++) c.rect(cx + (BANIER_X[i] - 0.016) * T, cy + top * T, T * 0.032, T * len);
          c.fill();
          c.fillStyle = kleur; c.beginPath();
          for (let i = 0; i < BANIER_X.length; i++) {
            const x = cx + (BANIER_X[i] + wapper) * T, y = cy + top * T, w = T * 0.011;
            c.moveTo(x - w, y + T * 0.004); c.lineTo(x + w, y + T * 0.004); c.lineTo(x + w, y + T * (len - 0.004)); c.lineTo(x, y + T * (len - 0.012)); c.lineTo(x - w, y + T * (len - 0.004)); c.closePath();
          }
          c.fill();
          if (z >= 9) {
            c.fillStyle = vl[land.idx]?.tweede ?? '#f2f2ef'; c.beginPath();
            for (let i = 0; i < BANIER_X.length; i++) stip(c, cx + (BANIER_X[i] + wapper) * T, cy + (top + len * 0.4) * T, T * 0.007);
            c.fill();
          }
          this.n.banieren += BANIER_X.length;
        }
        // banierpalen langs de straat
        if (banier && z >= 7) {
          // banierpalen tussen de bomen van de noordoostelijke groenstrook
          const Hp = T * 0.11, py = cy - 0.072 * T;
          c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = Math.max(0.6, T * 0.004); c.beginPath();
          for (let i = 0; i < TUSSEN_BOMEN.length; i++) { const x = cx + TUSSEN_BOMEN[i] * T; c.moveTo(x, py); c.lineTo(x + Hp * SCHUIN, py + Hp * SCHUIN); }
          c.stroke();
          c.strokeStyle = '#d4d4cf'; c.beginPath();
          for (let i = 0; i < TUSSEN_BOMEN.length; i++) { const x = cx + TUSSEN_BOMEN[i] * T; c.moveTo(x, py); c.lineTo(x, py - Hp); }
          c.stroke();
          c.fillStyle = kleur; c.beginPath();
          for (let i = 0; i < TUSSEN_BOMEN.length; i++) { const x = cx + TUSSEN_BOMEN[i] * T, w = Math.sin(this.nu / 700 + i + h) * T * 0.003; c.rect(x + w, py - Hp, T * 0.018, T * 0.06); }
          c.fill();
          this.n.banieren += TUSSEN_BOMEN.length;
        }
        // bewakingscamera's rond het plein en bij het regeringsgebouw, de kop draait langzaam
        if (z >= DREMPEL.camera) {
          const Hc = T * 0.075;
          c.strokeStyle = '#4f5357'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
          for (let i = 0; i < CAMERA.length; i += 2) { const x = cx + CAMERA[i] * T, y = cy + CAMERA[i + 1] * T; c.moveTo(x, y); c.lineTo(x, y - Hc); }
          c.stroke();
          c.fillStyle = '#e6e7e3'; c.beginPath();
          for (let i = 0; i < CAMERA.length && this.n.cameras < PLAFOND.cameras; i += 2) {
            const x = cx + CAMERA[i] * T, y = cy + CAMERA[i + 1] * T;
            // de kop kijkt naar het plein en draait langzaam heen en weer
            const hk = Math.atan2(-CAMERA[i + 1], -CAMERA[i]) + Math.sin(this.nu / 3000 + i * 0.85) * 0.7;
            rechthoek(c, x + Math.cos(hk) * T * 0.008, y - Hc + Math.sin(hk) * T * 0.008, Math.cos(hk), Math.sin(hk), T * 0.012, T * 0.005);
            this.n.cameras++;
          }
          c.fill();
          if (this.nacht > 0.05) for (let i = 0; i < CAMERA.length; i += 2) this.zetLicht(cx + CAMERA[i] * T, cy + CAMERA[i + 1] * T - Hc, T * 0.01, ROOD, 0.9);
        }
      } else if (regime === 'democratie' && z >= 7) {
        // verkiezingsaffiches: meer naarmate de verkiezingen naderen
        const r = P.regimes?.[regime];
        const tot = r?.verkiezingen ? r.verkiezingen - (s.dag - (land.laatsteVerkiezing ?? 0)) : 999;
        const nA = 2 + (tot < 45 ? 4 : 0);
        const Hb = T * 0.018;
        c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath();
        for (let i = 0; i < nA; i++) { const x = cx + AFFICHE_X[i] * T, y = cy - 0.075 * T; c.rect(x - T * 0.014 + T * 0.006, y - Hb + T * 0.006, T * 0.028, T * 0.022); }
        c.fill();
        for (let i = 0; i < nA && this.n.affiches < PLAFOND.affiches; i++) {
          const x = cx + AFFICHE_X[i] * T, y = cy - 0.075 * T;
          c.fillStyle = '#7a6a52'; c.fillRect(x - T * 0.001, y - Hb, T * 0.002, Hb);
          c.fillStyle = PARTIJ[Math.floor(hash(land.idx, i, Math.floor(s.dag / 120)) * PARTIJ.length)];
          c.fillRect(x - T * 0.014, y - Hb - T * 0.022, T * 0.028, T * 0.022);
          if (z >= 11) { c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); stip(c, x, y - Hb - T * 0.013, T * 0.005); c.fill(); }
          this.n.affiches++;
        }
      }
      // het eigen geheime netwerk van de speler: onopvallende figuren in lange jassen bij het regeringsgebouw
      const netwerk = buitenland ? (land.netwerken?.[s.spelerBlok] ?? 0) : 0;
      if (netwerk >= 40 && z >= DREMPEL.jassen - 0.3) {
        c.globalAlpha = smooth(DREMPEL.jassen - 0.3, DREMPEL.jassen + 0.3, z);
        const nj = Math.min(PLAFOND.jassen - this.n.jassen, 2 + (netwerk >= 70 ? 1 : 0));
        for (let i = 0; i < nj; i++) {
          // ze slenteren een paar passen heen en weer langs de stoep, alsof ze wachten
          const loop = Math.sin(this.klok * 0.15 + i * 2.1 + h) * 0.018;
          const x = cx + (JASPLEK[i * 2] + loop) * T, y = cy + JASPLEK[i * 2 + 1] * T;
          const r = T * 0.011;
          c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(x + r * 0.7, y + r * 0.6, r * 1.1, r * 0.6, 0.5, 0, TAU); c.fill();
          c.fillStyle = JAS[(i + h) % JAS.length]; c.beginPath(); c.ellipse(x, y, r * 0.75, r * 1.25, 0, 0, TAU); c.fill();
          c.fillStyle = '#c99d78'; c.beginPath(); stip(c, x, y - r * 0.85, r * 0.42); c.fill();
          c.fillStyle = '#1e1f22'; c.beginPath(); c.ellipse(x, y - r * 1.0, r * 0.62, r * 0.32, 0, 0, TAU); c.fill();
          // een krant voor het gezicht, heel dichtbij
          if (z >= 13 && i === 0) { c.fillStyle = '#e9e5da'; c.fillRect(x - r * 0.6, y - r * 0.6, r * 1.2, r * 0.8); }
          this.n.jassen++;
        }
      }
      c.globalAlpha = 1;
    }
  }

  // Reclamebord op twee poten, het paneel in de blokkleur met een abstracte vorm (geen tekst).
  bord(c, x, y, kleur, zaad) {
    const T = this.T, z = this.zoom, w = T * 0.04, h = T * 0.022, poot = T * 0.025;
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x - w + poot * SCHUIN, y - h * 0.2 + poot * SCHUIN, w * 2, h * 0.6);
    c.strokeStyle = '#5d6166'; c.lineWidth = Math.max(0.5, T * 0.003); c.beginPath();
    c.moveTo(x - w * 0.6, y); c.lineTo(x - w * 0.6, y - poot); c.moveTo(x + w * 0.6, y); c.lineTo(x + w * 0.6, y - poot); c.stroke();
    c.fillStyle = '#e8e6df'; c.fillRect(x - w - T * 0.002, y - poot - h * 2 - T * 0.002, w * 2 + T * 0.004, h * 2 + T * 0.004);
    c.fillStyle = kleur; c.fillRect(x - w, y - poot - h * 2, w * 2, h * 2);
    if (z >= 9) {
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.beginPath();
      if (hash(zaad, 3) < 0.5) stip(c, x - w * 0.45, y - poot - h, h * 0.6);
      else { c.moveTo(x - w * 0.8, y - poot - h * 0.4); c.lineTo(x - w * 0.2, y - poot - h * 1.6); c.lineTo(x + w * 0.1, y - poot - h * 0.4); c.closePath(); }
      c.fill();
      c.fillRect(x, y - poot - h * 1.3, w * 0.75, h * 0.25);
      c.fillRect(x, y - poot - h * 0.85, w * 0.55, h * 0.25);
    }
    if (this.nacht > 0.05) this.zetLicht(x, y - poot - h, w * 1.4, KOEL, 0.6);
  }

  // ---------- vlaggen ----------

  tekenVlaggen(c, a, nu) {
    if (a <= 0 || !this.nVlag) return;
    const U = this.sc, ox = this.ox, oy = this.oy, b = this.vlag, n = this.nVlag;
    c.globalAlpha = a;
    // masten: schaduw naar het zuidoosten, dan de mast zelf, dan een knopje bovenop
    c.lineWidth = Math.max(0.6, 0.07 * U);
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.beginPath();
    for (let k = 0; k < n; k++) { const o = k * 6, x = b[o] * U + ox, y = b[o + 1] * U + oy, H = b[o + 2] * U; c.moveTo(x, y); c.lineTo(x + H * SCHUIN, y + H * SCHUIN); }
    c.stroke();
    c.strokeStyle = '#d6d7d3'; c.beginPath();
    for (let k = 0; k < n; k++) { const o = k * 6, x = b[o] * U + ox, y = b[o + 1] * U + oy, H = b[o + 2] * U; c.moveTo(x, y); c.lineTo(x, y - H); }
    c.stroke();
    if (this.zoom >= 10) {
      c.fillStyle = '#d9b43a'; c.beginPath();
      for (let k = 0; k < n; k++) { const o = k * 6; stip(c, b[o] * U + ox, b[o + 1] * U + oy - b[o + 2] * U, Math.max(0.5, 0.07 * U)); }
      c.fill();
    }
    for (let k = 0; k < n; k++) {
      const o = k * 6;
      this.tekenVlag(c, b[o + 4], b[o] * U + ox, b[o + 1] * U + oy - b[o + 2] * U, b[o + 3] * U, nu, b[o + 5]);
    }
    c.globalAlpha = 1;
  }

  // Een wapperende vlag aan een mast met de top op (x, y) en een doek van L pixels lang. Wind uit seizoen.js:
  // het doek waait de wind in, staat strak bij harde wind en hangt slap bij weinig wind. Andere lagen mogen dit
  // gebruiken (de mast tekenen ze dan zelf).
  tekenVlag(c, land, x, y, L, nu, zaad = 0) {
    if (L < 2.5) return;
    const hoek = this.wnd.hoek, kr = this.wnd.kracht;
    const cx = Math.cos(hoek), cy = Math.sin(hoek);
    const spiegel = cx < 0;
    const Hf = L * 0.62;
    const ext = L * (0.35 + 0.65 * Math.abs(cx)) * (0.6 + 0.4 * kr);
    if (L < 6) {
      // klein: één vlakje in de hoofdkleur
      c.fillStyle = vlagOntwerpen(this.state)[land]?.hoofd ?? '#cccccc';
      c.fillRect(spiegel ? x - ext : x, y, ext, Hf);
      return;
    }
    const sprite = this.vlagSprite(land, spiegel);
    if (!sprite) return;
    const K = L > 18 ? 6 : L > 9 ? 4 : 3, sw = VW / K;
    const t = nu * 0.001 * (3 + 6 * kr) + hash(zaad | 0, 9) * TAU;
    const amp = Hf * (0.05 + 0.09 * kr), zak = (1 - kr) * Hf * 0.45;
    for (let j = 0; j < K; j++) {
      const f0 = j / K;
      const golf = Math.sin(t - j * 1.1) * amp * (f0 + 0.5 / K);
      const dy = cy * 0.4 * L * f0 + golf + zak * f0 * f0;
      const dx = ext * f0;
      const bx = spiegel ? VW - (j + 1) * sw : j * sw;
      c.drawImage(sprite, bx, 0, sw, VH, spiegel ? x - dx - ext / K : x + dx, y + dy, ext / K + 0.4, Hf);
    }
  }

  // ---------- licht na de nacht ----------

  // Na de nachtlaag: zoeklichten van de wachttorens (zwaaiende bundels), lampen langs het hek, de overkapping,
  // hokjes, seinlichten en koplampen.
  tekenLichten(c, view, sc, nu) {
    const nacht = view.nacht ?? 0;
    if (nacht < 0.05 || !this.sprites) return;
    const sp = this.sprites;
    c.save();
    c.globalCompositeOperation = 'lighter';
    // zwaaiende bundels: vanaf de lamp op het dak over het niemandsland heen en weer
    const U = this.sc ?? sc;
    let nb = 0;
    for (let k = 0; k < this.nToren && nb < PLAFOND.bundels && sp.bundel; k++) {
      const b = k * TOREN, x = this.toren[b], y = this.toren[b + 1] - this.toren[b + 2] - 0.3 * U;
      const zw = this.toren[b + 3] + Math.sin(nu / 1000 * 0.45 + this.toren[b + 4] * 0.37) * 0.9;
      const len = 9 * U, br = 3.2 * U;
      c.globalAlpha = nacht * 0.55 * this.toren[b + 5];
      c.save();
      c.translate(x, y);
      // de bundel valt schuin naar beneden op de grond: kort in de verte, iets platter
      c.rotate(Math.atan2(Math.sin(zw) * 0.7 + 0.25, Math.cos(zw)));
      c.drawImage(sp.bundel, 0, -br / 2, len, br);
      c.restore();
      const gx = x + Math.cos(zw) * len * 0.9, gy = y + this.toren[b + 2] + Math.sin(zw) * len * 0.62;
      c.globalAlpha = nacht * 0.45 * this.toren[b + 5];
      if (sp.gloed[KOEL]) c.drawImage(sp.gloed[KOEL], gx - 1.6 * U, gy - 1.1 * U, 3.2 * U, 2.2 * U);
      nb++;
    }
    this.n.bundels = nb;
    const L = this.licht;
    for (let i = 0; i < this.nLicht; i++) {
      const o = i * LICHT, s = sp.gloed[L[o + 3]], r = L[o + 2];
      if (!s) continue;
      c.globalAlpha = nacht * L[o + 4];
      c.drawImage(s, L[o] - r, L[o + 1] - r, r * 2, r * 2);
    }
    c.restore();
  }

  // Wat er dit beeld getekend is (voor de test en om te meten).
  telling() { return { ...this.n, vlaggen: this.nVlag, lichten: this.nLicht, torens: this.nToren }; }

  statistiek() {
    let brokken = 0, stukken = 0;
    for (const e of this.brokken) if (e) { brokken++; stukken += e.n; }
    return { brokken, stukken, overgangen: this.overgangen.length, controleposten: this.controleposten.length, bezet: this.bezetLijst.length };
  }
}
