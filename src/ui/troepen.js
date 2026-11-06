// Troepen op de kaart (pakket A van detailronde C8): ingezoomd worden de rondjes met een emoji echte troepen.
// Infanterie als groepje soldaten (in colonne, liggend in een linie of in een kamp met tentjes en een kampvuur),
// pantser als tanks met een draaiende koepel, artillerie met houwitsers, bemanning en een munitietruck, drones die
// rond hun positie cirkelen, en fregatten en vrachtschepen met boeggolf en kielzog. Gevechten krijgen
// lichtspoorkogels, mondingsvuur, granaten in een boog en inslagen met vuurbal, puin en schroeiplekken.
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Aantallen, opstelling en vuurritme volgen uit
// u.id, de levenspunten en vaste hashes; de klok (nu) stuurt alleen beweging. Geen Math.random, geen Date.
// Licht uit het noordwesten zoals de andere lagen: schaduwen vallen naar het zuidoosten; hoge dingen (vlaggenstok,
// antenne, granaten in de lucht, drones) staan omhoog getekend met hun schaduw schuin naar het zuidoosten.
// Detail komt trapsgewijs op (zie DREMPEL): onder zoom 6 blijft het rondje, tot 7,5 vloeien ze in elkaar over.

import { seizoen, weer, wind } from './seizoen.js';

// ---------- gedeelde hulpjes (eigen kopie, zie inzoom-spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
const tri = (v) => 1 - Math.abs(1 - 2 * frac(v));
const TAU = Math.PI * 2;
const SCHUIN = 0.566; // schaduwlengte per hoogte-eenheid, zon op ~45° in het noordwesten (zoals infra.js)
const ZON = Math.SQRT1_2; // richting naar de zon is (-ZON, -ZON)

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
export function zetCanvasFabriek(fn) { fabriek = fn ?? standaardFabriek; SPRITES = null; }

// ---------- vaste waarden ----------

// Vanaf welke zoom iets verschijnt. van-tot: het rondje vloeit over in troepen; middel: geweren, rugzakken,
// luiken, zandzakken; fijn: rupsbandschakels, rotorbladen, antennes, helmglans; klein: camouflagevlekken, scheerlijnen.
export const DREMPEL = { van: 6, tot: 7.5, middel: 8.5, fijn: 10.5, klein: 12.5 };
// Harde plafonds per beeld, zodat een groot gevecht nooit de framerate opeet.
export const PLAFOND = {
  eenheden: 40, soldaten: 420, tanks: 80, kanonnen: 48, wagens: 48, drones: 60, schepen: 12, burgers: 48,
  tenten: 60, zandzakken: 160, kisten: 96, netten: 24, vuren: 48,
  kogels: 160, granaten: 48, flitsen: 160, knallen: 48, puin: 240, rook: 220, stof: 160, ringen: 40,
  kraters: 72, sporen: 80, kielzog: 12, lichten: 160, vlaggen: 40,
};
const TELLERS = Object.keys(PLAFOND);

// Soorten troepen (uit de eigenschappen van het eenheidstype, zodat ook andere packs werken).
const INF = 0, TANK = 1, ART = 2, DRONE = 3, FREGAT = 4, VRACHT = 5;
// Straal van de formatie in tegels, voor de selectiering en de levensbalk.
const OMVANG = [0.2, 0.26, 0.25, 0.22, 0.27, 0.23];
// Houdingen van een soldaat.
const STAAN = 0, LOPEN = 1, LIGGEN = 2, KNIELEN = 3, ZITTEN = 4;
// Staat van een eenheid.
const KAMP = 0, COLONNE = 1, LINIE = 2;
// Wagens.
const TRUCK = 0, JEEP = 1, STATION = 2;
// Vuur: kampvuur met stenen of een brand op een beschadigd voertuig.
const KAMPVUUR = 0, BRAND = 1;
// Tinten van rook en stof (index in de puf-sprites).
const DONKER = 0, STOF = 1, MODDER = 2, WIT = 3, KRUIT = 4;
const PUF_KLEUR = [[58, 54, 50], [196, 176, 140], [92, 72, 50], [236, 238, 241], [178, 178, 172]];

// Wapens: periode (s) en spreiding, looplengte, straal van de inslag, boog (0 = vlak schot), vluchtduur (deel
// van de cyclus), grootte van het mondingsvuur en hoe hard de rookring uitdijt. Allemaal in tegels.
const WAPEN = {
  tank: { P: 3.1, Pv: 1.7, loop: 0.135, R: 0.05, boog: 0, vlucht: 0.05, flits: 0.022, ring: 0.16 },
  art: { P: 4.6, Pv: 2.2, loop: 0.124, R: 0.085, boog: 0.32, vlucht: 0.42, flits: 0.034, ring: 0.22 },
  schip: { P: 3.7, Pv: 1.5, loop: 0.072, R: 0.065, boog: 0.18, vlucht: 0.3, flits: 0.02, ring: 0.12 },
};

// Stride van de buffers (getallen per item).
const SOL = 8; // x, y, hx, hy, houding, land, fase, -
const TNK = 10; // x, y, hx, hy, koepel x, koepel y, land, terugslag, schakelfase (-1 stil), commandant
const KAN = 9; // x, y, hx, hy, open, terugslag, land, net, zaad
const WAG = 7; // x, y, hx, hy, land, soort, zaad
const DRN = 9; // grond x, grond y, hx, hy, hoogte, land, alfa, rotorfase, wimpel
const SCH = 12; // x, y, hx, hy, soort, land, vaart, kanon x, kanon y, terugslag, heli, zaad
const PUF = 5; // x, y, r, alfa, tint
const VLG = 5; // x, y, land, zaad, speler
const LICHT = 5; // x, y, r, alfa, soort (0 flits, 1 vuur)

// Afmetingen in tegels.
const TL = 0.066, TW = 0.04; // halve lengte en breedte van een tankromp
const FL_L = 0.25, FL_B = 0.042; // fregat
const VR_L = 0.21, VR_B = 0.05; // vrachtschip
// Romp van een fregat (langs, dwars) als deel van halve lengte en breedte; de andere kant is het spiegelbeeld.
const FREGAT_VORM = [1, 0, 0.8, 0.55, 0.45, 0.95, -0.1, 1, -0.85, 0.94, -1, 0.78];
const VRACHT_VORM = [1, 0, 0.86, 0.6, 0.6, 0.97, -0.75, 1, -0.95, 0.9, -1, 0.7];
const CONTAINER = ['#b8442f', '#2f6d9a', '#d9a63a', '#3d7a4f', '#7a7d80', '#8a4a7a', '#c8c2b4', '#d46a2a'];
const KLEDING = ['#c0392b', '#2e86c1', '#f0b429', '#ecefe9', '#34495e', '#2f9e5b'];
const GOUD = '#f0b429';

export function soortVan(type) {
  if (!type) return INF;
  if (type.vaart) return type.kolonist ? VRACHT : FREGAT;
  if (type.vliegt) return DRONE;
  const id = String(type.id ?? '');
  if (/pantser|tank/.test(id)) return TANK;
  if (/artill|houwitser|kanon/.test(id) || (type.bereik ?? 1) >= 3) return ART;
  return INF;
}
export const SOORTEN = ['infanterie', 'pantser', 'artillerie', 'drones', 'fregat', 'vrachtschip'];
// Hoeveel er van iets staat, uit het deel van de levenspunten dat over is (0..1).
export const aantalSoldaten = (g) => 6 + Math.round(6 * clamp(g, 0, 1));
export const aantalTanks = (g) => 2 + Math.round(2 * clamp(g, 0, 1));
export const aantalKanonnen = (g) => (g > 0.5 ? 3 : 2);
export const aantalDrones = (g) => 3 + Math.round(2 * clamp(g, 0, 1));
// 0 onder zoom 6 (alleen het rondje), 1 vanaf 7,5 (alleen troepen), daartussen vloeien ze in elkaar over.
export function troepenMengsel(zoom) { return smooth(DREMPEL.van, DREMPEL.tot, zoom); }

// ---------- kleuren ----------

function rgb(h) {
  if (typeof h !== 'string' || h[0] !== '#') return [128, 128, 128];
  if (h.length === 4) return [parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), parseInt(h[3] + h[3], 16)];
  return [parseInt(h.slice(1, 3), 16) || 0, parseInt(h.slice(3, 5), 16) || 0, parseInt(h.slice(5, 7), 16) || 0];
}
const meng = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (k, f = 1) => `rgb(${Math.round(clamp(k[0] * f, 0, 255))},${Math.round(clamp(k[1] * f, 0, 255))},${Math.round(clamp(k[2] * f, 0, 255))})`;

// Camouflage met een tint van het land; in hartje winter witte overjassen en witgekalkte voertuigen.
function maakPalet(kleur, winter, speler) {
  const k = rgb(kleur);
  const uniform = winter ? meng([220, 224, 220], k, 0.12) : meng([100, 110, 72], k, 0.22);
  const voertuig = winter ? meng([192, 198, 190], k, 0.2) : meng([90, 98, 63], k, 0.26);
  const tent = winter ? meng([226, 229, 227], k, 0.08) : meng([108, 110, 76], k, 0.16);
  const grijs = meng([122, 130, 137], k, 0.1);
  return {
    sleutel: `${kleur}|${winter}|${speler}`,
    lijf: css(uniform), helm: css(uniform, winter ? 0.9 : 0.76), rugzak: css(uniform, winter ? 0.82 : 0.66),
    vlek: winter ? 'rgba(150,160,162,0.45)' : css(uniform, 0.58),
    romp: css(voertuig), koepel: css(voertuig, 1.08), rompD: css(voertuig, 0.62), huif: css(meng(voertuig, [140, 138, 104], 0.45)),
    tentL: css(tent, 1.1), tentD: css(tent, 0.74),
    drone: css(meng([70, 74, 78], k, 0.25)),
    dek: css(grijs, 1.14), opbouw: css(grijs, 1.26), romp2: css(grijs, 0.72),
    vlag: speler ? GOUD : (typeof kleur === 'string' ? kleur : '#999999'),
  };
}

// ---------- tekenhulpjes ----------

// Punt in het vlak van een eenheid: a langs de kop (hx, hy), b dwars daarop (naar (-hy, hx)).
function naar(c, x, y, hx, hy, a, b) { c.moveTo(x + hx * a - hy * b, y + hy * a + hx * b); }
function lijnNaar(c, x, y, hx, hy, a, b) { c.lineTo(x + hx * a - hy * b, y + hy * a + hx * b); }
// Gedraaide rechthoek rond (x, y), lang 2l langs (hx, hy), breed 2w. Voegt toe aan het open pad.
function rechthoek(c, x, y, hx, hy, l, w) {
  const px = -hy * w, py = hx * w, lx = hx * l, ly = hy * l;
  c.moveTo(x + lx + px, y + ly + py);
  c.lineTo(x + lx - px, y + ly - py);
  c.lineTo(x - lx - px, y - ly - py);
  c.lineTo(x - lx + px, y - ly + py);
  c.closePath();
}
// Gedraaid vak van a0 tot a1 langs de kop en b0 tot b1 dwars.
function vak(c, x, y, hx, hy, a0, a1, b0, b1) {
  naar(c, x, y, hx, hy, a0, b0); lijnNaar(c, x, y, hx, hy, a1, b0);
  lijnNaar(c, x, y, hx, hy, a1, b1); lijnNaar(c, x, y, hx, hy, a0, b1); c.closePath();
}
// Een stip: klein een vierkantje (sneller en net zo goed zichtbaar), anders een cirkel.
function stip(c, x, y, r) {
  if (r < 1.2) { c.rect(x - r, y - r, r * 2, r * 2); return; }
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, TAU);
}
// Gedraaide ovaal (lengte langs de kop).
function ovaal(c, x, y, hx, hy, l, w) {
  if (l < 1.2) { c.rect(x - l, y - l, l * 2, l * 2); return; }
  c.moveTo(x + hx * l, y + hy * l);
  c.ellipse(x, y, l, w, Math.atan2(hy, hx), 0, TAU);
}
// Tankromp: rechthoek met afgeschuinde voorhoeken (de glacisplaat).
function romp(c, x, y, hx, hy, l, w, af) {
  naar(c, x, y, hx, hy, l, w - af); lijnNaar(c, x, y, hx, hy, l - af, w); lijnNaar(c, x, y, hx, hy, -l, w);
  lijnNaar(c, x, y, hx, hy, -l, -w); lijnNaar(c, x, y, hx, hy, l - af, -w); lijnNaar(c, x, y, hx, hy, l, af - w);
  c.closePath();
}
// Scheepsromp uit een vorm (punten langs, dwars van boeg naar spiegel), gespiegeld over de lengteas.
function scheepsvorm(c, x, y, hx, hy, L, B, v, f = 1) {
  naar(c, x, y, hx, hy, v[0] * L * f, 0);
  for (let i = 2; i < v.length; i += 2) lijnNaar(c, x, y, hx, hy, v[i] * L * f, v[i + 1] * B * f);
  for (let i = v.length - 2; i >= 2; i -= 2) lijnNaar(c, x, y, hx, hy, v[i] * L * f, -v[i + 1] * B * f);
  c.closePath();
}

// ---------- sprites (vaste set, dus de cache groeit niet) ----------

function radiaal(n, stops) {
  const cv = fabriek(n, n);
  if (!cv) return null;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  for (const [p, k] of stops) g.addColorStop(p, k);
  c.fillStyle = g;
  c.fillRect(0, 0, n, n);
  return cv;
}

// Camouflagenet van bovenaf: grillige rand, vlekken in drie tinten, een fijn maaswerk en de schaduw naar het
// zuidoosten (het net draait niet mee, dus de schaduw mag erin gebakken zijn).
function netSprite(v) {
  const N = 96, cv = fabriek(N, N);
  if (!cv) return null;
  const c = cv.getContext('2d');
  const r = rnd(4100 + v * 17);
  const punten = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU, rr = N * 0.33 * (0.8 + 0.32 * r());
    punten.push(N / 2 + Math.cos(a) * rr, N / 2 + Math.sin(a) * rr * 0.9);
  }
  const vorm = (dx, dy) => {
    c.beginPath(); c.moveTo(punten[0] + dx, punten[1] + dy);
    for (let i = 2; i < punten.length; i += 2) c.lineTo(punten[i] + dx, punten[i + 1] + dy);
    c.closePath();
  };
  c.fillStyle = 'rgba(0,0,0,0.3)'; vorm(5, 6); c.fill();
  c.fillStyle = '#4c5734'; vorm(0, 0); c.fill();
  c.save(); vorm(0, 0); c.clip();
  const vlek = ['#67653f', '#384428', '#7a6b48', '#59633b'];
  for (let i = 0; i < 16; i++) {
    c.fillStyle = vlek[i % 4];
    c.beginPath(); c.ellipse(N * (0.15 + 0.7 * r()), N * (0.15 + 0.7 * r()), N * (0.05 + 0.07 * r()), N * (0.03 + 0.05 * r()), r() * 3, 0, TAU); c.fill();
  }
  c.strokeStyle = 'rgba(25,30,18,0.28)'; c.lineWidth = 0.8;
  c.beginPath();
  for (let i = -N; i < N * 2; i += 6) { c.moveTo(i, 0); c.lineTo(i + N, N); c.moveTo(i + N, 0); c.lineTo(i, N); }
  c.stroke();
  // plukjes groen en het licht uit het noordwesten
  c.fillStyle = 'rgba(160,172,108,0.4)';
  for (let i = 0; i < 26; i++) { c.beginPath(); c.arc(N * (0.15 + 0.7 * r()), N * (0.15 + 0.7 * r()), 1.3 + r() * 1.5, 0, TAU); c.fill(); }
  const g = c.createLinearGradient(N * 0.15, N * 0.15, N * 0.85, N * 0.85);
  g.addColorStop(0, 'rgba(255,255,230,0.2)'); g.addColorStop(0.5, 'rgba(255,255,230,0)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
  c.fillStyle = g; c.fillRect(0, 0, N, N);
  c.restore();
  c.strokeStyle = 'rgba(30,36,20,0.45)'; c.lineWidth = 1; vorm(0, 0); c.stroke();
  return cv;
}

// Eén vaste set sprites voor de hele module (rook en stof in vijf tinten, gloed, vuurbal, drie netten).
let SPRITES = null;
function sprites() {
  if (SPRITES) return SPRITES;
  const puf = PUF_KLEUR.map(([r, g, b]) => radiaal(32, [[0, `rgba(${r},${g},${b},0.85)`], [0.55, `rgba(${r},${g},${b},0.45)`], [1, `rgba(${r},${g},${b},0)`]]));
  SPRITES = {
    puf,
    gloed: radiaal(64, [[0, 'rgba(255,190,110,1)'], [0.35, 'rgba(255,150,60,0.4)'], [1, 'rgba(255,120,40,0)']]),
    vuurbal: radiaal(64, [[0, 'rgba(255,250,225,1)'], [0.22, 'rgba(255,212,100,0.95)'], [0.5, 'rgba(238,112,34,0.85)'], [0.78, 'rgba(120,42,20,0.45)'], [1, 'rgba(60,30,20,0)']]),
    net: [netSprite(0), netSprite(1), netSprite(2)],
  };
  return SPRITES;
}

// ---------- de laag ----------

export class TroepenLaag {
  constructor() {
    this.n = {};
    for (const k of TELLERS) this.n[k] = 0;
    this.sol = new Float32Array(PLAFOND.soldaten * SOL);
    this.burger = new Float32Array(PLAFOND.burgers * 3);
    this.tank = new Float32Array(PLAFOND.tanks * TNK);
    this.kanon = new Float32Array(PLAFOND.kanonnen * KAN);
    this.wagen = new Float32Array(PLAFOND.wagens * WAG);
    this.drone = new Float32Array(PLAFOND.drones * DRN);
    this.schip = new Float32Array(PLAFOND.schepen * SCH);
    this.tent = new Float32Array(PLAFOND.tenten * 5);
    this.zak = new Float32Array(PLAFOND.zandzakken * 4);
    this.kist = new Float32Array(PLAFOND.kisten * 5);
    this.net = new Float32Array(PLAFOND.netten * 4);
    this.vuur = new Float32Array(PLAFOND.vuren * 5);
    this.kogel = new Float32Array(PLAFOND.kogels * 5);
    this.granaat = new Float32Array(PLAFOND.granaten * 4);
    this.flits = new Float32Array(PLAFOND.flitsen * 5);
    this.knal = new Float32Array(PLAFOND.knallen * 5);
    this.puin = new Float32Array(PLAFOND.puin * 3);
    this.rook = new Float32Array(PLAFOND.rook * PUF);
    this.stof = new Float32Array(PLAFOND.stof * PUF);
    this.ring = new Float32Array(PLAFOND.ringen * 4);
    this.krater = new Float32Array(PLAFOND.kraters * 4);
    this.spoor = new Float32Array(PLAFOND.sporen * 7);
    this.kiel = new Float32Array(PLAFOND.kielzog * 7);
    this.licht = new Float32Array(PLAFOND.lichten * LICHT);
    this.vlag = new Float32Array(PLAFOND.vlaggen * VLG);
    // welke eenheden (index in state.eenheden) dit beeld als troepen getekend zijn
    this.vol = new Uint8Array(64);
    // kleuren per land, alleen opnieuw bij een andere landkleur, ander seizoen of andere speler
    this.paletten = [];
    this.inGebruik = new Uint8Array(64);
    this.paletBeeld = new Int32Array(64).fill(-1);
    this.beeldNr = 0;
    this.soortCache = {};
    this.sprites = null;
    this.state = null;
    this.mix = 0;
    this.szDag = -1;
  }

  // ---------- publiek ----------

  mengsel(zoom) { return troepenMengsel(zoom); }
  // Straal van de formatie in px (voor de selectiering en de levensbalk in map.js).
  omvang(u, T) { return OMVANG[this.soort(u)] * T; }
  // 1 als eenheid i (index in state.eenheden) dit beeld als troepen getekend is, anders 0 (dan tekent de kaart het rondje).
  getekend(i) { return i < this.vol.length ? this.vol[i] : 0; }
  telling() { const t = {}; for (const k of TELLERS) t[k] = this.n[k]; return t; }

  soort(u) {
    const id = u.type;
    let s = this.soortCache[id];
    if (s === undefined) { s = soortVan(this.state?.pack?.eenhedenIndex?.[id]); this.soortCache[id] = s; }
    return s;
  }

  // ---------- per beeld ----------

  // Tekent alle troepen in beeld. posities: Map van u.id naar [sx, sy] (zoals tekenEenheden die maakt); mix 0..1.
  teken(c, view, sc, nu, frac, posities, mix) {
    for (let i = 0; i < TELLERS.length; i++) this.n[TELLERS[i]] = 0;
    const s = view.state;
    const E = s?.eenheden;
    if (E && this.vol.length < E.length) this.vol = new Uint8Array(E.length * 2);
    this.vol.fill(0);
    if (!s || !view.geo || !(mix > 0) || !E) return;
    if (this.state?.pack !== s.pack) this.soortCache = {};
    this.state = s;
    this.view = view;
    this.kader(view, sc);
    this.omgeving(view);
    this.mix = mix;
    this.t = nu / 1000;
    this.frac = frac;
    if (s.landen.length > this.inGebruik.length) { this.inGebruik = new Uint8Array(s.landen.length); this.paletBeeld = new Int32Array(s.landen.length).fill(-1); }
    this.inGebruik.fill(0);
    this.beeldNr++;
    if (!this.sprites) this.sprites = sprites();
    // kies wat in detail getekend wordt: eerst je eigen troepen, dan de rest, tot het plafond. Een eenheid krijgt
    // alleen detail als haar soldaten, tanks, kanonnen, drones of schip nog in de buffers passen; anders blijft ze
    // een rondje (de kaart verbergt het rondje van elke eenheid die hier als getekend staat).
    const m = this.T * 0.45;
    let sol = PLAFOND.soldaten, tnk = PLAFOND.tanks, kan = PLAFOND.kanonnen, drn = PLAFOND.drones, sch = PLAFOND.schepen;
    for (let ronde = 0; ronde < 2; ronde++) {
      for (let i = 0; i < E.length && this.n.eenheden < PLAFOND.eenheden; i++) {
        const u = E[i];
        if ((u.land === s.speler) !== (ronde === 0)) continue;
        const p = posities.get(u.id);
        if (!p || !this.opScherm(p[0], p[1], m)) continue;
        const type = s.pack.eenhedenIndex[u.type];
        if (!type) continue;
        const soort = this.soort(u), g = clamp(u.hp / (type.hp || 1), 0, 1);
        if (soort === INF) { const k = aantalSoldaten(g); if (sol < k) continue; sol -= k; }
        else if (soort === TANK) { const k = aantalTanks(g); if (tnk < k) continue; tnk -= k; }
        else if (soort === ART) { const k = aantalKanonnen(g); if (kan < k || sol < 3 * k) continue; kan -= k; sol -= 3 * k; }
        else if (soort === DRONE) { const k = aantalDrones(g); if (drn < k || sol < 1) continue; drn -= k; sol -= 1; }
        else { if (sch < 1) continue; sch -= 1; }
        this.vol[i] = 1;
        this.n.eenheden++;
      }
    }
    for (let i = 0; i < E.length; i++) {
      const u = E[i];
      const p = posities.get(u.id);
      if (!p) continue;
      if (this.vol[i]) this.bouw(u, p[0], p[1], posities, true);
      // zonder detail (buiten beeld of boven het plafond) alleen het vuur dat door het beeld gaat
      else if (u.vecht && this.schotInBeeld(p, posities.get(u.doelwit))) this.bouw(u, p[0], p[1], posities, false);
    }
    c.save();
    this.tekenAlles(c);
    c.restore();
  }

  kader(view, sc) {
    this.sc = sc;
    this.T = view.geo.T * sc;
    this.ox = view.w / 2 - view.cx * sc;
    this.oy = view.h / 2 - view.cy * sc;
    this.w = view.w; this.h = view.h;
    const z = view.zoom;
    this.middel = z >= DREMPEL.middel;
    this.fijn = z >= DREMPEL.fijn;
    this.klein = z >= DREMPEL.klein;
  }

  // Seizoen, weer en wind van vandaag, op het midden van het beeld (een weerfront is veel groter dan het beeld).
  omgeving(view) {
    const dag = this.state.dag ?? 0;
    if (this.szDag !== dag) { this.sz = seizoen(dag); this.wnd = wind(dag); this.szDag = dag; }
    const w = weer(dag, view.cx, view.cy);
    this.winter = this.sz.sneeuw > 0.35;
    this.modder = w.regen > 0.25 && !this.winter;
    // droog land stuift: in de zomer flink, in het voor- en najaar een beetje
    this.stuif = this.modder ? 0 : this.winter ? 0.8 : clamp(0.35 + this.sz.zomer * 0.8 + this.sz.lente * 0.2, 0, 1);
    this.windX = Math.cos(this.wnd.hoek); this.windY = Math.sin(this.wnd.hoek);
    this.windK = this.wnd.kracht;
    this.vlagRichting = this.windX >= 0 ? 1 : -1;
    this.nacht = view.nacht ?? 0;
  }

  opScherm(x, y, m) { return x > -m && y > -m && x < this.w + m && y < this.h + m; }
  // Loopt vuur van p naar doel q door het beeld? Een granaat in een boog komt tot een derde van de afstand boven de
  // lijn uit; inslag, puin en kraters liggen tot ongeveer een kwart tegel rond het doel.
  schotInBeeld(p, q) {
    if (!q) return false;
    const m = this.T * 0.3, boog = 0.35 * Math.hypot(q[0] - p[0], q[1] - p[1]);
    return Math.max(p[0], q[0]) > -m && Math.min(p[0], q[0]) < this.w + m && Math.max(p[1], q[1]) > -m && Math.min(p[1], q[1]) - boog < this.h + m;
  }

  // Zee of zoet water onder een schermpunt (zee uit het grondraster van de kaart, zoet water uit de terreinlaag).
  isWater(sx, sy, zoet = true) {
    const wx = (sx - this.ox) / this.sc, wy = (sy - this.oy) / this.sc;
    const ix = Math.floor(wx), iy = Math.floor(wy);
    if (ix < 0 || iy < 0 || ix >= 1000 || iy >= 620) return true;
    const e = this.view.eigenaar;
    if (e && e[iy * 1000 + ix] === -1) return true;
    if (!zoet) return false;
    const tl = this.view.terreinLaag;
    return !!(tl && tl.isZoetWater && tl.isZoetWater(wx, wy));
  }

  // Houdt een onderdeel van een landeenheid uit zee en rivier: valt (x, y) in het water, dan schuift het naar het
  // anker toe. Een colonne mag een rivier oversteken, dus onderweg telt alleen zee. Uitkomst in this.qx, this.qy
  // (geen nieuwe array per soldaat).
  opLand(x, y) {
    this.qx = x; this.qy = y;
    const zoet = this.zoetTelt;
    if (!this.landTroep || this.ankerNat || !this.isWater(x, y, zoet)) return;
    const ax = this.ankX, ay = this.ankY;
    for (let k = 0; k < 2; k++) {
      const f = k ? 0.2 : 0.55, nx = ax + (x - ax) * f, ny = ay + (y - ay) * f;
      if (!this.isWater(nx, ny, zoet)) { this.qx = nx; this.qy = ny; return; }
    }
    this.qx = ax; this.qy = ay;
  }

  palet(land) {
    if (this.paletBeeld[land] === this.beeldNr) return this.paletten[land];
    const s = this.state, c = s.landen[land];
    if (!c) return null;
    this.paletBeeld[land] = this.beeldNr;
    const kleur = this.view.kleurVan ? this.view.kleurVan(c) : '#888888';
    const speler = land === s.speler;
    const sleutel = `${kleur}|${this.winter}|${speler}`;
    let p = this.paletten[land];
    if (!p || p.sleutel !== sleutel) { p = maakPalet(kleur, this.winter, speler); this.paletten[land] = p; }
    this.inGebruik[land] = 1;
    return p;
  }

  // ---------- opbouw per eenheid ----------

  bouw(u, x, y, posities, vol) {
    const s = this.state;
    const type = s.pack.eenhedenIndex[u.type];
    if (!type) return;
    const soort = this.soort(u);
    const gezond = clamp(u.hp / (type.hp || 1), 0, 1);
    const dx = u.x - u.px, dy = u.y - u.py, d = Math.hypot(dx, dy);
    const beweegt = d > 0.01;
    this.rijdt = beweegt && this.frac < 1;
    this.dagAfstand = d * this.sc;
    // koers: de beweging, anders de volgende stap, anders naar het doel, anders een vaste richting
    let hx, hy;
    const doel = u.vecht && u.doelwit != null ? posities.get(u.doelwit) : null;
    if (beweegt) { hx = dx / d; hy = dy / d; }
    else {
      const pad = u.pad;
      const tg = pad && pad.length ? this.view.geo.tegels[pad[0]] : null;
      const ex = tg ? tg.x - u.x : 0, ey = tg ? tg.y - u.y : 0, ed = Math.hypot(ex, ey);
      if (ed > 0.01) { hx = ex / ed; hy = ey / ed; }
      else if (doel && Math.hypot(doel[0] - x, doel[1] - y) > 0.5) { const q = Math.hypot(doel[0] - x, doel[1] - y); hx = (doel[0] - x) / q; hy = (doel[1] - y) / q; }
      else {
        // een schip aan een ligplaats in de haven ligt evenwijdig aan de kust
        const lr = this.view.ligRichting ? this.view.ligRichting(u) : NaN;
        const a = Number.isNaN(lr) ? hash(u.id, 7) * TAU : lr;
        hx = Math.cos(a); hy = Math.sin(a);
      }
    }
    let ax = hx, ay = hy;
    if (doel) { const q = Math.hypot(doel[0] - x, doel[1] - y); if (q > 0.5) { ax = (doel[0] - x) / q; ay = (doel[1] - y) / q; } }
    const staat = u.vecht ? LINIE : (beweegt || (u.pad && u.pad.length)) ? COLONNE : KAMP;
    // anker: de plek van de eenheid zonder de vaste spreiding van de kaart, op haar tegel of tussen twee tegels.
    // Daar staat een landeenheid op land en een schip op water; onderdelen die verkeerd vallen schuiven ernaartoe.
    this.ankX = (u.px + (u.x - u.px) * this.frac) * this.sc + this.ox;
    this.ankY = (u.py + (u.y - u.py) * this.frac) * this.sc + this.oy;
    this.landTroep = soort === INF || soort === TANK || soort === ART;
    this.zoetTelt = staat !== COLONNE;
    this.ankerNat = this.landTroep && this.isWater(this.ankX, this.ankY, this.zoetTelt);
    if (soort >= FREGAT && !this.isWater(x, y)) {
      // schip met zijn midden op de kust: naar het water toe (in de haven ligt ook het anker op land; dan blijft hij)
      const kx = x + (this.ankX - x) * 0.5, ky = y + (this.ankY - y) * 0.5;
      if (this.isWater(kx, ky)) { x = kx; y = ky; } else if (this.isWater(this.ankX, this.ankY)) { x = this.ankX; y = this.ankY; }
    }
    // op een bebouwd vakje (gebouw, hoofdstad, kolonie) slaat niemand zijn tent op: daar treedt de groep aan
    this.bebouwd = staat === KAMP && !!s.bezet?.[u.t];
    if (vol) this.palet(u.land);
    if (soort === INF) this.bouwInfanterie(u, x, y, hx, hy, ax, ay, staat, gezond, doel, vol);
    else if (soort === TANK) this.bouwPantser(u, x, y, hx, hy, ax, ay, staat, gezond, doel, vol);
    else if (soort === ART) this.bouwArtillerie(u, x, y, hx, hy, ax, ay, staat, gezond, doel, vol);
    else if (soort === DRONE) this.bouwDrones(u, x, y, hx, hy, ax, ay, staat, gezond, doel, vol);
    else this.bouwSchip(u, x, y, hx, hy, ax, ay, staat, gezond, doel, vol, soort);
  }

  // ---------- infanterie ----------

  bouwInfanterie(u, x, y, hx, hy, ax, ay, staat, gezond, doel, vol) {
    const T = this.T, t = this.t, id = u.id, land = u.land;
    const n = aantalSoldaten(gezond);
    if (!vol) { for (let i = 0; i < n; i += 2) this.geweerVuur(u, i, x, y, ax, ay, doel, false); return; }
    if (staat === COLONNE || this.bebouwd) {
      // twee rijen achter elkaar; de linker- en rechterrij stappen om en om (op een bebouwd vakje staan ze aangetreden)
      const m = n - 1, rijen = Math.ceil(m / 2), loop = this.rijdt;
      for (let i = 0; i < m; i++) {
        const r = i >> 1, f = i & 1;
        const fase = t * 2.3 * TAU + f * Math.PI + hash(id, i, 2) * 0.8;
        const a = ((rijen - 1) / 2 - r) * 0.036 * T + (loop ? Math.sin(fase) * 0.0022 * T : 0) + (hash(id, i, 3) - 0.5) * 0.005 * T;
        const b = (f - 0.5) * 0.034 * T + (hash(id, i, 1) - 0.5) * 0.006 * T;
        this.zetSoldaat(x + hx * a - hy * b, y + hy * a + hx * b, hx, hy, loop ? LOPEN : STAAN, land, fase);
      }
      // de vaandeldrager loopt voorop
      const a0 = ((rijen - 1) / 2) * 0.036 * T + 0.03 * T;
      this.zetSoldaat(x + hx * a0, y + hy * a0, hx, hy, loop ? LOPEN : STAAN, land, t * 2.3 * TAU + 0.5);
      this.zetVlag(x + hx * a0 + hy * 0.008 * T, y + hy * a0 - hx * 0.008 * T, u);
      return;
    }
    if (staat === LINIE) {
      // voorste rij ligt, achterste rij knielt; allemaal met de neus naar het doel
      const kol = Math.ceil(n / 2);
      for (let i = 0; i < n; i++) {
        const rang = i & 1, k = i >> 1;
        const b = (k - (kol - 1) / 2) * 0.042 * T + (rang ? 0.021 * T : 0);
        const a = (rang ? -0.036 * T : 0) + (hash(id, i, 5) - 0.5) * 0.01 * T;
        this.opLand(x + ax * a - ay * b, y + ay * a + ax * b);
        const sx = this.qx, sy = this.qy;
        this.zetSoldaat(sx, sy, ax, ay, rang ? KNIELEN : LIGGEN, land, 0);
        const mond = (rang ? 0.03 : 0.036) * T;
        this.geweerVuur(u, i, sx + ax * mond, sy + ay * mond, ax, ay, doel, true);
      }
      this.zetVlag(x - ax * 0.075 * T, y - ay * 0.075 * T, u);
      this.schade(x - ax * 0.05 * T, y - ay * 0.05 * T, gezond, id, 0.7);
      return;
    }
    // kamp: kampvuur in het midden, tentjes eromheen, zandzakken aan de voorkant, wachtposten erachter
    const a0 = hash(id, 9) * TAU;
    this.zetVuur(x, y, 0.0095 * T, id, KAMPVUUR);
    const nT = n > 8 ? 3 : 2;
    for (let k = 0; k < nT; k++) {
      const ang = a0 + (k * TAU) / nT + (hash(id, k, 10) - 0.5) * 0.5;
      const cx = x + Math.cos(ang) * 0.105 * T, cy = y + Math.sin(ang) * 0.095 * T;
      if (this.isWater(cx, cy)) continue;
      this.zetTent(cx, cy, -Math.sin(ang), Math.cos(ang), land);
      // munitiekist naast de tent
      if (this.middel && hash(id, k, 11) < 0.7) {
        const kx = cx + Math.cos(ang) * 0.035 * T - Math.sin(ang) * 0.03 * T, ky = cy + Math.sin(ang) * 0.035 * T + Math.cos(ang) * 0.03 * T;
        this.zetKist(kx, ky, Math.cos(ang), Math.sin(ang), hash(id, k, 12) < 0.5 ? 0 : 1);
      }
    }
    if (this.middel) {
      const kop = Math.atan2(hy, hx);
      for (let j = 0; j < 9; j++) {
        const ang = kop + (j - 4) * 0.19, zx = x + Math.cos(ang) * 0.172 * T, zy = y + Math.sin(ang) * 0.172 * T;
        if (!this.isWater(zx, zy)) this.zetZak(zx, zy, -Math.sin(ang), Math.cos(ang));
      }
      // een jeep aan de rand van het kamp
      if (hash(id, 13) < 0.6) {
        const jx = x - hx * 0.16 * T - hy * 0.07 * T, jy = y - hy * 0.16 * T + hx * 0.07 * T;
        if (!this.isWater(jx, jy)) this.zetWagen(jx, jy, -hy, hx, land, JEEP, id);
      }
    }
    let i = 0;
    // drie zitten rond het vuur, met het gezicht naar de vlammen
    for (let j = 0; j < 3 && i < n; j++, i++) {
      const ang = a0 + 0.9 + (j * TAU) / 3;
      this.zetSoldaat(x + Math.cos(ang) * 0.034 * T, y + Math.sin(ang) * 0.034 * T, -Math.cos(ang), -Math.sin(ang), ZITTEN, land, 0);
    }
    // twee wachtposten achter de zandzakken kijken rond
    for (let j = 0; j < 2 && i < n; j++, i++) {
      const zij = j ? 1 : -1, kijk = Math.atan2(hy, hx) + 0.45 * Math.sin(t * 0.35 + j * 2.1 + id);
      this.zetSoldaat(x + hx * 0.145 * T - hy * zij * 0.055 * T, y + hy * 0.145 * T + hx * zij * 0.055 * T, Math.cos(kijk), Math.sin(kijk), STAAN, land, 0);
    }
    // de rest loopt rustig rondjes tussen de tenten
    for (let j = 0; i < n; j++, i++) {
      const w = (0.16 + 0.12 * hash(id, j, 14)) * (hash(id, j, 15) < 0.5 ? 1 : -1);
      const ang = t * w + hash(id, j, 16) * TAU, rr = (0.06 + 0.018 * Math.sin(t * 0.31 + j)) * T, sg = w > 0 ? 1 : -1;
      this.zetSoldaat(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.9, -Math.sin(ang) * sg, Math.cos(ang) * sg, LOPEN, land, t * 1.5 * TAU + j * 1.7);
    }
    this.zetVlag(x + hy * 0.052 * T - hx * 0.03 * T, y - hx * 0.052 * T - hy * 0.03 * T, u);
  }

  // Geweervuur van één schutter: mondingsvuur, af en toe een lichtspoorkogel en een stofwolkje bij het doel.
  geweerVuur(u, i, mx, my, ax, ay, doel, vol) {
    const T = this.T;
    const P = 0.75 + hash(u.id, i, 6) * 0.9;
    const v = this.t / P + hash(u.id, i, 7), cyc = Math.floor(v), ph = v - cyc;
    if (vol && ph < 0.07) { this.zetFlits(mx, my, ax, ay, 0.0065 * T); this.zetLicht(mx, my, 0.06 * T, 0.45, 0); }
    if (!doel || hash(u.id, i, cyc) > 0.55) return;
    const tx = doel[0] + (hash(u.id, i, cyc * 2 + 11) - 0.5) * 0.16 * T, ty = doel[1] + (hash(u.id, i, cyc * 2 + 12) - 0.5) * 0.12 * T;
    const dx = tx - mx, dy = ty - my, d = Math.hypot(dx, dy) || 1;
    const vlucht = clamp(d / (3.2 * T), 0.08, 0.35);
    if (ph < vlucht) {
      const f = ph / vlucht, len = Math.min(0.06 * T, d * f + 0.004 * T);
      this.zetKogel(mx + dx * f, my + dy * f, -(dx / d) * len, -(dy / d) * len, 0);
    } else if (ph < vlucht + 0.12 && this.middel && this.opScherm(tx, ty, 0)) {
      const f = (ph - vlucht) / 0.12;
      this.zetPuf(this.stof, 'stof', tx, ty - f * 0.01 * T, (0.008 + f * 0.012) * T, 0.45 * (1 - f), this.winter ? WIT : STOF);
    }
  }

  // ---------- pantser ----------

  bouwPantser(u, x, y, hx, hy, ax, ay, staat, gezond, doel, vol) {
    const T = this.T, t = this.t, id = u.id;
    const n = aantalTanks(gezond);
    for (let k = 0; k < n; k++) {
      let px, py, rx, ry;
      if (staat === COLONNE) {
        // verspringende colonne over de breedte van de weg
        const a = ((n - 1) / 2 - k) * 0.125 * T, b = (k & 1 ? -1 : 1) * 0.034 * T;
        px = x + hx * a - hy * b; py = y + hy * a + hx * b; rx = hx; ry = hy;
      } else if (staat === LINIE) {
        const b = (k - (n - 1) / 2) * 0.13 * T, a = (k & 1 ? -0.035 : 0.01) * T;
        px = x + ax * a - ay * b; py = y + ay * a + ax * b; rx = ax; ry = ay;
      } else {
        // stilstaand: een ruit met de neuzen naar buiten (rondom verdediging)
        const ang = Math.atan2(hy, hx) + (k * TAU) / n;
        rx = Math.cos(ang); ry = Math.sin(ang);
        px = x + rx * 0.1 * T; py = y + ry * 0.1 * T;
      }
      this.opLand(px, py); px = this.qx; py = this.qy;
      // koepel: naar het doel, anders langzaam rondkijkend rond de rijrichting
      let kx, ky;
      if (doel) {
        const q = Math.hypot(doel[0] - px, doel[1] - py) || 1;
        kx = (doel[0] - px) / q; ky = (doel[1] - py) / q;
      } else {
        const ka = Math.atan2(ry, rx) + (staat === KAMP ? 0.55 * Math.sin(t * 0.22 + hash(id, k, 20) * TAU) : 0.12 * Math.sin(t * 0.4 + k));
        kx = Math.cos(ka); ky = Math.sin(ka);
      }
      const tcx = px - rx * 0.01 * T, tcy = py - ry * 0.01 * T;
      const terug = staat === LINIE ? this.kanonVuur(u, k, tcx, tcy, kx, ky, doel, vol, WAPEN.tank) : 0;
      if (!vol) continue;
      this.zetTank(px, py, rx, ry, kx, ky, u.land, terug, this.rijdt ? t * 2.2 : -1, staat === KAMP && hash(id, k, 23) < 0.6 ? 1 : 0);
      if (this.rijdt) this.rijsporen(px, py, rx, ry, id * 5 + k);
      if (k === 0) this.zetVlag(tcx - kx * 0.026 * T + ky * 0.016 * T, tcy - ky * 0.026 * T - kx * 0.016 * T, u);
      if (k === 0 || (k === 1 && gezond < 0.45)) this.schade(px - rx * 0.035 * T, py - ry * 0.035 * T, gezond, id * 3 + k, 1);
    }
  }

  // Rupssporen, stof (droog), modder (regen) of stuifsneeuw (winter) en een beetje uitlaatgas achter een rijdend voertuig.
  rijsporen(px, py, rx, ry, zaad) {
    const T = this.T, t = this.t;
    const ax = px - rx * TL * T, ay = py - ry * TL * T;
    this.zetSpoor(ax, ay, rx, ry, clamp(this.dagAfstand * this.frac + 0.2 * T, 0.2 * T, 0.9 * T), (TW - 0.0105) * T);
    if (this.modder) {
      for (let j = 0; j < 3; j++) {
        const f = frac(t * 1.7 + j / 3 + hash(zaad, j)), zij = j & 1 ? 1 : -1;
        const sx = ax - rx * f * 0.06 * T - ry * zij * (0.03 + f * 0.02) * T, sy = ay - ry * f * 0.06 * T + rx * zij * (0.03 + f * 0.02) * T;
        this.zetPuf(this.stof, 'stof', sx, sy, (0.007 + f * 0.01) * T, 0.6 * (1 - f), MODDER);
      }
    } else if (this.stuif > 0) {
      for (let j = 0; j < 3; j++) {
        const f = frac(t * 0.9 + j / 3 + hash(zaad, j));
        const sx = ax - rx * (0.02 + f * 0.2) * T + this.windX * f * 0.07 * T + (hash(zaad, j, 2) - 0.5) * 0.05 * T;
        const sy = ay - ry * (0.02 + f * 0.2) * T + this.windY * f * 0.07 * T + (hash(zaad, j, 3) - 0.5) * 0.05 * T;
        this.zetPuf(this.stof, 'stof', sx, sy, (0.022 + f * 0.055) * T, (1 - f) * 0.42 * this.stuif, this.winter ? WIT : STOF);
      }
    }
    if (this.middel) {
      const f = frac(t * 1.6 + hash(zaad, 9));
      this.zetPuf(this.rook, 'rook', ax - rx * f * 0.04 * T + this.windX * f * 0.02 * T, ay - ry * f * 0.04 * T - f * 0.025 * T, (0.006 + f * 0.012) * T, 0.32 * (1 - f), DONKER);
    }
  }

  // Kanonvuur (tank, houwitser, scheepskanon): mondingsvlam, rookring, granaat (vlak of in een boog), inslag en
  // schroeiplekken van de vorige schoten. Geeft de terugslag van de loop terug (0..1).
  kanonVuur(u, k, px, py, kx, ky, doel, vol, W) {
    const T = this.T;
    const P = W.P + hash(u.id, k, 21) * W.Pv;
    const v = this.t / P + hash(u.id, k, 22), cyc = Math.floor(v), ph = v - cyc;
    const mx = px + kx * W.loop * T, my = py + ky * W.loop * T;
    if (vol) {
      if (ph < 0.06) { this.zetFlits(mx, my, kx, ky, W.flits * T); this.zetLicht(mx, my, W.flits * 7 * T, 1, 0); }
      if (ph < 0.45) this.zetRing(mx + kx * 0.01 * T, my + ky * 0.01 * T, (0.012 + ph * W.ring) * T, 0.5 * (1 - ph / 0.45));
      if (ph < 0.7) {
        const f = ph / 0.7;
        this.zetPuf(this.rook, 'rook', mx + kx * 0.02 * T + this.windX * f * 0.08 * T, my + ky * 0.02 * T + this.windY * f * 0.05 * T - f * 0.04 * T, (0.016 + f * 0.05) * T * (W.R / 0.06), 0.42 * (1 - f), KRUIT);
      }
    }
    if (doel) {
      const tx = doel[0] + (hash(u.id, k, cyc * 2 + 31) - 0.5) * 0.18 * T, ty = doel[1] + (hash(u.id, k, cyc * 2 + 32) - 0.5) * 0.14 * T;
      const dx = tx - mx, dy = ty - my, d = Math.hypot(dx, dy) || 1;
      if (ph < W.vlucht) {
        const f = ph / W.vlucht;
        if (W.boog > 0) {
          // in een boog: hoogte naar boven getekend, de staart volgt de richting op het scherm
          const H = W.boog * d, h = 4 * H * f * (1 - f), f2 = Math.min(1, f + 0.03), h2 = 4 * H * f2 * (1 - f2);
          const gx = mx + dx * f, gy = my + dy * f - h;
          let vx = mx + dx * f2 - gx, vy = my + dy * f2 - h2 - gy;
          const vq = Math.hypot(vx, vy) || 1; vx /= vq; vy /= vq;
          this.zetGranaat(gx, gy, vx, vy);
        } else {
          const len = Math.min(0.12 * T, d * f + 0.01 * T);
          this.zetKogel(mx + dx * f, my + dy * f, -(dx / d) * len, -(dy / d) * len, 1);
        }
      } else if (ph < W.vlucht + 0.3) {
        this.zetKnal(tx, ty, (ph - W.vlucht) / 0.3, W.R * T, u.id * 31 + k * 7 + cyc, this.isWater(tx, ty));
      }
      // schroeiplekken: het laatste schot en de twee daarvoor, steeds vager
      if (this.middel) {
        for (let j = 0; j <= 2; j++) {
          if (j === 0 && ph < W.vlucht + 0.05) continue;
          const c2 = cyc - j, ox = doel[0] + (hash(u.id, k, c2 * 2 + 31) - 0.5) * 0.18 * T, oy = doel[1] + (hash(u.id, k, c2 * 2 + 32) - 0.5) * 0.14 * T;
          const leeftijd = (j + ph - W.vlucht) / 2.6;
          if (leeftijd < 0 || leeftijd >= 1 || !this.opScherm(ox, oy, W.R * T) || this.isWater(ox, oy)) continue;
          this.zetKrater(ox, oy, W.R * T * 0.75, 0.55 * (1 - leeftijd));
        }
      }
    }
    return ph < 0.15 ? 1 - ph / 0.15 : 0;
  }

  // ---------- artillerie ----------

  bouwArtillerie(u, x, y, hx, hy, ax, ay, staat, gezond, doel, vol) {
    const T = this.T, t = this.t, id = u.id, land = u.land;
    const nG = aantalKanonnen(gezond), bemanning = gezond > 0.35 ? 3 : 2;
    if (staat === COLONNE) {
      if (!vol) return;
      // de munitietruck rijdt voorop, de houwitsers hangen met dichte poten aan de haak
      this.opLand(x + hx * 0.17 * T, y + hy * 0.17 * T);
      const tx = this.qx, ty = this.qy;
      this.zetWagen(tx, ty, hx, hy, land, TRUCK, id);
      if (this.rijdt) this.rijsporen(tx, ty, hx, hy, id * 5);
      for (let k = 0; k < nG; k++) {
        const a = 0.06 * T - k * 0.12 * T;
        this.opLand(x + hx * a, y + hy * a);
        const gx = this.qx, gy = this.qy;
        this.zetKanon(gx, gy, -hx, -hy, 0, 0, land, 0, id * 3 + k);
        this.zetSoldaat(gx - hy * 0.045 * T, gy + hx * 0.045 * T, hx, hy, this.rijdt ? LOPEN : STAAN, land, t * 2.3 * TAU + k);
      }
      this.zetVlag(tx - hx * 0.02 * T + hy * 0.016 * T, ty - hy * 0.02 * T - hx * 0.016 * T, u);
      return;
    }
    const fx = staat === LINIE ? ax : hx, fy = staat === LINIE ? ay : hy;
    for (let k = 0; k < nG; k++) {
      const b = (k - (nG - 1) / 2) * 0.12 * T;
      this.opLand(x + fx * 0.02 * T - fy * b, y + fy * 0.02 * T + fx * b);
      const gx = this.qx, gy = this.qy;
      const terug = staat === LINIE ? this.kanonVuur(u, k, gx, gy, fx, fy, doel, vol, WAPEN.art) : 0;
      if (!vol) continue;
      this.zetKanon(gx, gy, fx, fy, 1, terug, land, staat === KAMP && !this.bebouwd ? 1 : 0, id * 3 + k);
      // bemanning: twee knielen achter het stuk; de lader haalt granaten bij de kisten
      if (staat === LINIE) {
        for (let j = 0; j < bemanning; j++) {
          let a, bb, pose = KNIELEN;
          if (j < 2) { a = -0.036; bb = j ? 0.03 : -0.03; }
          else { const f = tri(t * 0.42 + hash(id, k, 24)); a = -0.022 - f * 0.04; bb = 0.012 + f * 0.04; pose = LOPEN; }
          this.zetSoldaat(gx + fx * a * T - fy * bb * T, gy + fy * a * T + fx * bb * T, fx, fy, pose, land, t * 2.2 * TAU + j);
        }
        // stof dat opwaait bij het schot
        if (terug > 0.4) {
          for (let j = 0; j < 4; j++) {
            const ang = (j / 4) * TAU + hash(id, k, j), f = 1 - terug;
            this.zetPuf(this.stof, 'stof', gx + Math.cos(ang) * (0.03 + f * 0.05) * T, gy + Math.sin(ang) * (0.025 + f * 0.04) * T, (0.018 + f * 0.03) * T, 0.38 * terug * Math.max(this.stuif, 0.4), this.winter ? WIT : STOF);
          }
        }
      } else {
        // in rust: de bemanning zit naast het net
        for (let j = 0; j < bemanning - 1; j++) {
          const bb = (j ? 0.05 : -0.05) * T;
          this.zetSoldaat(gx - fx * 0.07 * T - fy * bb, gy - fy * 0.07 * T + fx * bb, fx, fy, ZITTEN, land, 0);
        }
      }
      if (this.middel) {
        const kx = gx - fx * 0.065 * T - fy * 0.05 * T, ky = gy - fy * 0.065 * T + fx * 0.05 * T;
        this.zetKist(kx, ky, fx, fy, 0);
        this.zetKist(kx - fx * 0.015 * T, ky - fy * 0.015 * T, fx, fy, 0);
      }
      if (k === 0) this.schade(gx - fx * 0.02 * T, gy - fy * 0.02 * T, gezond, id * 3, 0.8);
    }
    if (!vol) return;
    // de munitietruck staat dwars erachter
    const tx = x - fx * 0.17 * T - fy * 0.05 * T, ty = y - fy * 0.17 * T + fx * 0.05 * T;
    if (!this.isWater(tx, ty)) this.zetWagen(tx, ty, -fy, fx, land, TRUCK, id);
    this.zetVlag(tx + fy * 0.03 * T, ty - fx * 0.03 * T, u);
  }

  // ---------- drones ----------

  bouwDrones(u, x, y, hx, hy, ax, ay, staat, gezond, doel, vol) {
    const T = this.T, t = this.t, id = u.id, land = u.land;
    const n = aantalDrones(gezond);
    // aanval: telkens duikt één drone op het doel
    let kd = -1, ph = 0, cyc = 0, tx = 0, ty = 0;
    if (staat === LINIE && doel) {
      const P = 3.4 + hash(id, 41) * 1.4, v = t / P + hash(id, 42);
      cyc = Math.floor(v); ph = v - cyc; kd = ((cyc % n) + n) % n;
      tx = doel[0] + (hash(id, cyc, 43) - 0.5) * 0.14 * T; ty = doel[1] + (hash(id, cyc, 44) - 0.5) * 0.1 * T;
      const water = this.isWater(tx, ty);
      if (ph >= 0.3 && ph < 0.62) this.zetKnal(tx, ty, (ph - 0.3) / 0.32, 0.04 * T, id * 13 + cyc, water);
      if (this.middel) {
        // kraters van de laatste inslagen, die over twee aanvallen gelijkmatig vervagen
        for (let j = 0; j <= 2; j++) {
          const leeftijd = (j + ph - 0.32) / 2;
          if (leeftijd < 0 || leeftijd >= 1) continue;
          const c2 = cyc - j, ox = doel[0] + (hash(id, c2, 43) - 0.5) * 0.14 * T, oy = doel[1] + (hash(id, c2, 44) - 0.5) * 0.1 * T;
          if (!this.isWater(ox, oy)) this.zetKrater(ox, oy, 0.03 * T, 0.5 * (1 - leeftijd));
        }
      }
    }
    if (!vol) return;
    // grondstation: busje met schotel; alleen op land en niet onderweg
    const sx = x - hx * 0.05 * T, sy = y - hy * 0.05 * T;
    if (staat !== COLONNE && !this.isWater(sx, sy)) {
      this.zetWagen(sx, sy, hx, hy, land, STATION, id);
      this.zetSoldaat(sx - hy * 0.035 * T, sy + hx * 0.035 * T, hx, hy, ZITTEN, land, 0);
      this.zetVlag(sx - hx * 0.025 * T + hy * 0.012 * T, sy - hy * 0.025 * T - hx * 0.012 * T, u);
    }
    for (let k = 0; k < n; k++) {
      let gx, gy, dhx, dhy, alfa = 1;
      let h = (0.085 + 0.03 * hash(id, k, 45)) * T + 0.008 * T * Math.sin(t * 1.7 + k * 1.3);
      if (staat === COLONNE) {
        // onderweg in een V
        const a = 0.06 * T - Math.abs(k - (n - 1) / 2) * 0.055 * T, b = (k - (n - 1) / 2) * 0.065 * T;
        gx = x + hx * a - hy * b; gy = y + hy * a + hx * b; dhx = hx; dhy = hy;
      } else {
        const r = (0.09 + 0.08 * hash(id, k, 46)) * T, w = (0.45 + 0.5 * hash(id, k, 47)) * (hash(id, k, 48) < 0.5 ? 1 : -1);
        const ang = t * w + hash(id, k, 49) * TAU, sg = w > 0 ? 1 : -1;
        gx = x + Math.cos(ang) * r; gy = y + Math.sin(ang) * r * 0.85;
        dhx = -Math.sin(ang) * sg; dhy = Math.cos(ang) * sg * 0.85;
        const q = Math.hypot(dhx, dhy) || 1; dhx /= q; dhy /= q;
      }
      if (k === kd) {
        if (ph < 0.3) {
          // duikvlucht: naar het doel en naar de grond
          const f = smooth(0, 1, ph / 0.3), ddx = tx - gx, ddy = ty - gy, q = Math.hypot(ddx, ddy) || 1;
          gx += ddx * f; gy += ddy * f; h *= 1 - f; dhx = ddx / q; dhy = ddy / q;
        } else if (ph < 0.62) alfa = 0;
        else alfa = (ph - 0.62) / 0.38;
      }
      if (alfa > 0) this.zetDrone(gx, gy, dhx, dhy, h, land, alfa, t * 45 + k * 1.7, k === 0 ? 1 : 0);
      if (k === 1 && alfa > 0) this.schade(gx, gy - h, gezond, id * 3 + 1, 0.45);
    }
  }

  // ---------- schepen ----------

  bouwSchip(u, x, y, hx, hy, ax, ay, staat, gezond, doel, vol, soort) {
    const T = this.T, t = this.t, id = u.id;
    const fregat = soort === FREGAT, L = (fregat ? FL_L : VR_L) * T, B = (fregat ? FL_B : VR_B) * T;
    const gunX = x + hx * 0.62 * L, gunY = y + hy * 0.62 * L;
    let kx = hx, ky = hy;
    if (doel) { const q = Math.hypot(doel[0] - gunX, doel[1] - gunY) || 1; kx = (doel[0] - gunX) / q; ky = (doel[1] - gunY) / q; }
    const terug = fregat && staat === LINIE ? this.kanonVuur(u, 0, gunX, gunY, kx, ky, doel, vol, WAPEN.schip) : 0;
    if (!vol) return;
    const vaart = this.rijdt ? 1 : staat === COLONNE ? 0.35 : 0;
    this.zetSchip(x, y, hx, hy, soort, u.land, vaart, kx, ky, terug, fregat && hash(id, 31) < 0.65 ? (staat === LINIE ? 2 : 1) : 0, id);
    this.zetKiel(x - hx * L, y - hy * L, hx, hy, L, B, vaart);
    // mensen aan dek van het vrachtschip lopen langs de reling
    if (!fregat && this.middel) {
      for (let j = 0; j < 5; j++) {
        const a = (tri(t * 0.035 + hash(id, j, 32)) * 1.3 - 0.75) * L, b = (j & 1 ? 0.72 : -0.72) * B;
        this.zetBurger(x + hx * a - hy * b, y + hy * a + hx * b, j);
      }
    }
    const ma = fregat ? 0.1 * L : -0.82 * L;
    this.zetVlag(x + hx * ma, y + hy * ma, u);
    this.schade(x - hx * 0.1 * L, y - hy * 0.1 * L, gezond, id, 1.2);
  }

  // Rook en vuur op een beschadigde eenheid: hoe minder levenspunten, hoe meer rook; onder een derde brandt het.
  schade(px, py, gezond, zaad, groot) {
    if (gezond > 0.7) return;
    const T = this.T, t = this.t, ernst = (0.7 - gezond) / 0.7;
    const puffen = 2 + Math.round(ernst * 5);
    for (let j = 0; j < puffen; j++) {
      const f = frac(t * 0.26 + j / puffen + hash(zaad, j, 61));
      const sx = px + this.windX * f * 0.22 * T * groot + Math.sin(f * 5 + zaad) * 0.01 * T;
      const sy = py - f * 0.3 * T * groot + this.windY * f * 0.1 * T;
      this.zetPuf(this.rook, 'rook', sx, sy, (0.012 + f * 0.05) * T * groot, (1 - f) * (0.32 + 0.38 * ernst), ernst > 0.35 ? DONKER : KRUIT);
    }
    if (ernst > 0.45) { this.zetVuur(px, py, (0.005 + 0.007 * ernst) * T * groot, zaad, BRAND); }
  }

  // ---------- buffers vullen (elk met zijn eigen plafond) ----------

  zetSoldaat(x, y, hx, hy, pose, land, fase) {
    if (this.n.soldaten >= PLAFOND.soldaten) return;
    this.opLand(x, y); x = this.qx; y = this.qy;
    const o = this.n.soldaten++ * SOL, b = this.sol;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = pose; b[o + 5] = land; b[o + 6] = fase;
  }
  zetBurger(x, y, k) {
    if (this.n.burgers >= PLAFOND.burgers) return;
    const o = this.n.burgers++ * 3;
    this.burger[o] = x; this.burger[o + 1] = y; this.burger[o + 2] = k % KLEDING.length;
  }
  zetTank(x, y, hx, hy, kx, ky, land, terug, fase, cmd) {
    if (this.n.tanks >= PLAFOND.tanks) return;
    const o = this.n.tanks++ * TNK, b = this.tank;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = kx; b[o + 5] = ky; b[o + 6] = land; b[o + 7] = terug; b[o + 8] = fase; b[o + 9] = cmd;
  }
  zetKanon(x, y, hx, hy, open, terug, land, net, zaad) {
    if (this.n.kanonnen >= PLAFOND.kanonnen) return;
    const o = this.n.kanonnen++ * KAN, b = this.kanon;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = open; b[o + 5] = terug; b[o + 6] = land; b[o + 7] = net; b[o + 8] = zaad;
    if (net && this.n.netten < PLAFOND.netten) {
      const q = this.n.netten++ * 4;
      this.net[q] = x + hx * 0.025 * this.T; this.net[q + 1] = y + hy * 0.025 * this.T; this.net[q + 2] = 0.085 * this.T; this.net[q + 3] = zaad % 3;
    }
  }
  zetWagen(x, y, hx, hy, land, soort, zaad) {
    if (this.n.wagens >= PLAFOND.wagens) return;
    const o = this.n.wagens++ * WAG, b = this.wagen;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = land; b[o + 5] = soort; b[o + 6] = zaad;
  }
  zetDrone(x, y, hx, hy, h, land, alfa, fase, wimpel) {
    if (this.n.drones >= PLAFOND.drones) return;
    const o = this.n.drones++ * DRN, b = this.drone;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = h; b[o + 5] = land; b[o + 6] = alfa; b[o + 7] = fase; b[o + 8] = wimpel;
  }
  zetSchip(x, y, hx, hy, soort, land, vaart, kx, ky, terug, heli, zaad) {
    if (this.n.schepen >= PLAFOND.schepen) return;
    const o = this.n.schepen++ * SCH, b = this.schip;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = soort; b[o + 5] = land; b[o + 6] = vaart;
    b[o + 7] = kx; b[o + 8] = ky; b[o + 9] = terug; b[o + 10] = heli; b[o + 11] = zaad;
  }
  zetTent(x, y, hx, hy, land) {
    if (this.n.tenten >= PLAFOND.tenten) return;
    const o = this.n.tenten++ * 5, b = this.tent;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = land;
  }
  zetZak(x, y, hx, hy) {
    if (this.n.zandzakken >= PLAFOND.zandzakken) return;
    const o = this.n.zandzakken++ * 4;
    this.zak[o] = x; this.zak[o + 1] = y; this.zak[o + 2] = hx; this.zak[o + 3] = hy;
  }
  zetKist(x, y, hx, hy, soort) {
    if (this.n.kisten >= PLAFOND.kisten) return;
    this.opLand(x, y); x = this.qx; y = this.qy;
    const o = this.n.kisten++ * 5, b = this.kist;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = soort;
  }
  zetVuur(x, y, r, zaad, soort) {
    if (this.n.vuren >= PLAFOND.vuren) return;
    this.opLand(x, y); x = this.qx; y = this.qy;
    const o = this.n.vuren++ * 5, b = this.vuur;
    b[o] = x; b[o + 1] = y; b[o + 2] = r; b[o + 3] = zaad; b[o + 4] = soort;
    this.zetLicht(x, y, r * (soort === KAMPVUUR ? 9 : 7), soort === KAMPVUUR ? 0.85 : 0.7, 1);
    // een sliertje rook boven het kampvuur
    if (soort === KAMPVUUR && this.middel) {
      const f = frac(this.t * 0.3 + hash(zaad, 71));
      this.zetPuf(this.rook, 'rook', x + this.windX * f * 0.06 * this.T, y - f * 0.09 * this.T, (0.006 + f * 0.016) * this.T, 0.3 * (1 - f), KRUIT);
    }
  }
  zetKogel(x, y, dx, dy, soort) {
    if (this.n.kogels >= PLAFOND.kogels || !this.opScherm(x, y, Math.abs(dx) + Math.abs(dy) + 2)) return;
    const o = this.n.kogels++ * 5, b = this.kogel;
    b[o] = x; b[o + 1] = y; b[o + 2] = dx; b[o + 3] = dy; b[o + 4] = soort;
  }
  zetGranaat(x, y, vx, vy) {
    if (this.n.granaten >= PLAFOND.granaten || !this.opScherm(x, y, 0.05 * this.T)) return;
    const o = this.n.granaten++ * 4, b = this.granaat;
    b[o] = x; b[o + 1] = y; b[o + 2] = vx; b[o + 3] = vy;
  }
  zetFlits(x, y, hx, hy, r) {
    if (this.n.flitsen >= PLAFOND.flitsen || !this.opScherm(x, y, r * 3)) return;
    const o = this.n.flitsen++ * 5, b = this.flits;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = r;
  }
  // Inslag: vuurbal of waterzuil, met puin en rook die opstijgt. age 0..1.
  zetKnal(x, y, age, R, zaad, water) {
    if (this.n.knallen >= PLAFOND.knallen || !this.opScherm(x, y, R * 3)) return;
    const o = this.n.knallen++ * 5, b = this.knal, T = this.T;
    b[o] = x; b[o + 1] = y; b[o + 2] = age; b[o + 3] = R; b[o + 4] = water ? 1 : 0;
    if (water) {
      // waterzuil: wit schuim dat omhoog spat en weer zakt
      const f = tri(Math.min(1, age) * 0.5);
      this.zetPuf(this.rook, 'rook', x, y - f * R * 0.9, R * (0.35 + 0.5 * age), 0.75 * (1 - age), WIT);
      this.zetPuf(this.rook, 'rook', x + R * 0.25, y - f * R * 0.5, R * (0.25 + 0.4 * age), 0.55 * (1 - age), WIT);
    } else {
      if (age < 0.6 && this.middel) {
        const f = age / 0.6;
        for (let j = 0; j < 7 && this.n.puin < PLAFOND.puin; j++) {
          const a = hash(zaad, j, 81) * TAU, d = R * (0.6 + 0.9 * hash(zaad, j, 82)) * f, lift = 4 * f * (1 - f) * R * (0.6 + 0.6 * hash(zaad, j, 83));
          const q = this.n.puin++ * 3;
          this.puin[q] = x + Math.cos(a) * d; this.puin[q + 1] = y + Math.sin(a) * d * 0.7 - lift; this.puin[q + 2] = Math.max(0.6, 0.0055 * T);
        }
      }
      for (let j = 0; j < 2; j++) {
        const f = clamp(age * 1.15 - j * 0.15, 0, 1);
        if (f <= 0) continue;
        this.zetPuf(this.rook, 'rook', x + this.windX * f * R * 0.8 + (j - 0.5) * R * 0.5, y - f * R * 1.4, R * (0.45 + 0.8 * f), 0.6 * (1 - f), DONKER);
      }
    }
    if (age < 0.35) this.zetLicht(x, y, R * 3.4, 1 - age / 0.35, 0);
  }
  zetPuf(buf, teller, x, y, r, a, tint) {
    if (a <= 0.01 || this.n[teller] >= PLAFOND[teller] || !this.opScherm(x, y, r)) return;
    const o = this.n[teller]++ * PUF;
    buf[o] = x; buf[o + 1] = y; buf[o + 2] = r; buf[o + 3] = a; buf[o + 4] = tint;
  }
  zetRing(x, y, r, a) {
    if (this.n.ringen >= PLAFOND.ringen || a <= 0.01 || !this.opScherm(x, y, r)) return;
    const o = this.n.ringen++ * 4;
    this.ring[o] = x; this.ring[o + 1] = y; this.ring[o + 2] = r; this.ring[o + 3] = a;
  }
  zetKrater(x, y, r, a) {
    if (this.n.kraters >= PLAFOND.kraters || a <= 0.02 || !this.opScherm(x, y, r)) return;
    const o = this.n.kraters++ * 4;
    this.krater[o] = x; this.krater[o + 1] = y; this.krater[o + 2] = r; this.krater[o + 3] = a;
  }
  zetSpoor(x, y, hx, hy, L, spoorwijdte) {
    if (this.n.sporen >= PLAFOND.sporen) return;
    const o = this.n.sporen++ * 7, b = this.spoor;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = L; b[o + 5] = spoorwijdte; b[o + 6] = 0;
  }
  zetKiel(x, y, hx, hy, L, B, vaart) {
    if (this.n.kielzog >= PLAFOND.kielzog) return;
    const o = this.n.kielzog++ * 7, b = this.kiel;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = L; b[o + 5] = B; b[o + 6] = vaart;
  }
  zetLicht(x, y, r, a, soort) {
    if (this.n.lichten >= PLAFOND.lichten || !this.opScherm(x, y, r)) return;
    const o = this.n.lichten++ * LICHT, b = this.licht;
    b[o] = x; b[o + 1] = y; b[o + 2] = r; b[o + 3] = a; b[o + 4] = soort;
  }
  zetVlag(x, y, u) {
    if (this.n.vlaggen >= PLAFOND.vlaggen) return;
    this.opLand(x, y); x = this.qx; y = this.qy;
    const o = this.n.vlaggen++ * VLG, b = this.vlag;
    b[o] = x; b[o + 1] = y; b[o + 2] = u.land; b[o + 3] = u.id; b[o + 4] = u.land === this.state.speler ? 1 : 0;
  }

  // ---------- tekenen ----------

  tekenAlles(c) {
    c.globalAlpha = this.mix;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const n = this.n;
    if (n.kraters) this.tekenKraters(c);
    if (n.sporen) this.tekenSporen(c);
    if (n.kielzog) this.tekenKielzog(c);
    if (n.stof) this.tekenPuffen(c, this.stof, n.stof);
    this.tekenSchaduwen(c);
    if (n.schepen) this.tekenSchepen(c);
    if (n.zandzakken) this.tekenZakken(c);
    if (n.tenten) this.tekenTenten(c);
    if (n.kisten) this.tekenKisten(c);
    if (n.wagens) this.tekenWagens(c);
    if (n.kanonnen) this.tekenKanonnen(c);
    if (n.netten) this.tekenNetten(c);
    if (n.tanks) this.tekenTanks(c);
    if (n.vuren) this.tekenVuren(c);
    if (n.soldaten) this.tekenSoldaten(c);
    if (n.burgers) this.tekenBurgers(c);
    if (n.drones) this.tekenDrones(c);
    if (n.rook) this.tekenPuffen(c, this.rook, n.rook);
    if (n.ringen) this.tekenRingen(c);
    if (n.knallen || n.puin) this.tekenKnallen(c);
    if (n.kogels || n.granaten) this.tekenKogels(c);
    if (n.flitsen) this.tekenFlitsen(c);
    if (n.vlaggen) this.tekenVlaggen(c);
    if (n.lichten) this.tekenLichten(c);
  }

  // Schroeiplekken en kraters in drie vervagingsbanden (één pad per band in plaats van één per krater).
  tekenKraters(c) {
    const b = this.krater, n = this.n.kraters, mix = this.mix;
    for (let band = 0; band < 3; band++) {
      const lo = band === 0 ? 0.36 : band === 1 ? 0.2 : 0, hi = band === 0 ? 2 : band === 1 ? 0.36 : 0.2;
      let open = false;
      for (let i = 0; i < n; i++) {
        const a = b[i * 4 + 3];
        if (a < lo || a >= hi) continue;
        if (!open) { c.beginPath(); open = true; }
        const r = b[i * 4 + 2];
        c.moveTo(b[i * 4] + r, b[i * 4 + 1]);
        c.ellipse(b[i * 4], b[i * 4 + 1], r, r * 0.72, 0, 0, TAU);
      }
      if (!open) continue;
      c.globalAlpha = mix * (band === 0 ? 0.5 : band === 1 ? 0.3 : 0.15);
      c.fillStyle = '#2b2219';
      c.fill();
      // donkere kern met een lichte rand aan de zonkant (de kuil vangt licht aan de overkant)
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a = b[i * 4 + 3];
        if (a < lo || a >= hi) continue;
        const r = b[i * 4 + 2] * 0.45;
        c.moveTo(b[i * 4] + r, b[i * 4 + 1]);
        c.ellipse(b[i * 4], b[i * 4 + 1], r, r * 0.7, 0, 0, TAU);
      }
      c.fillStyle = '#120e0a';
      c.fill();
    }
    c.globalAlpha = mix;
  }

  // Rupssporen: twee banen achter elk voertuig, in drie stukken die steeds vager worden.
  tekenSporen(c) {
    const b = this.spoor, n = this.n.sporen, T = this.T, mix = this.mix;
    c.strokeStyle = this.winter ? '#6b665e' : this.modder ? '#3a2c1e' : '#5a4c38';
    c.lineWidth = Math.max(0.8, 0.017 * T);
    c.lineCap = 'butt';
    const sterk = this.winter ? 0.55 : this.modder ? 0.5 : 0.32;
    for (let band = 0; band < 3; band++) {
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * 7, x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3], L = b[o + 4], w = b[o + 5];
        const a0 = -(band / 3) * L, a1 = -((band + 1) / 3) * L;
        for (let z = -1; z <= 1; z += 2) { naar(c, x, y, hx, hy, a0, z * w); lijnNaar(c, x, y, hx, hy, a1, z * w); }
      }
      c.globalAlpha = mix * sterk * (1 - band * 0.33);
      c.stroke();
    }
    // schakelafdrukken in de sporen
    if (this.fijn) {
      c.lineWidth = Math.max(0.5, 0.003 * T);
      c.strokeStyle = 'rgba(0,0,0,0.35)';
      c.globalAlpha = mix * sterk;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * 7, x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3], L = b[o + 4] * 0.5, w = b[o + 5];
        for (let a = 0.01 * T; a < L; a += 0.016 * T) {
          for (let z = -1; z <= 1; z += 2) { naar(c, x, y, hx, hy, -a, z * w - 0.008 * T); lijnNaar(c, x, y, hx, hy, -a, z * w + 0.008 * T); }
        }
      }
      c.stroke();
    }
    c.lineCap = 'round';
    c.globalAlpha = mix;
  }

  // Kielzog (twee schuine golven en een schuimstreep) en boeggolf; stilliggend alleen een rimpelring.
  tekenKielzog(c) {
    const b = this.kiel, n = this.n.kielzog, T = this.T, t = this.t, mix = this.mix;
    c.strokeStyle = '#eef6fa';
    for (let i = 0; i < n; i++) {
      const o = i * 7, x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3], L = b[o + 4], B = b[o + 5], v = b[o + 6];
      if (v <= 0) {
        const mx = x + hx * L, my = y + hy * L;
        c.globalAlpha = mix * (0.16 + 0.08 * Math.sin(t * 1.3 + i));
        c.lineWidth = Math.max(0.6, 0.003 * T);
        c.beginPath(); ovaal(c, mx, my, hx, hy, L * 1.12, B * 1.6); c.stroke();
        continue;
      }
      const Lw = (0.28 + 0.4 * v) * T;
      c.lineWidth = Math.max(0.8, 0.0055 * T);
      for (let band = 0; band < 3; band++) {
        c.globalAlpha = mix * v * (0.55 - band * 0.17);
        c.beginPath();
        for (let z = -1; z <= 1; z += 2) {
          // golven van Kelvin: ongeveer 19° naar buiten
          const a0 = -(band / 3) * Lw, a1 = -((band + 1) / 3) * Lw;
          naar(c, x, y, hx, hy, a0, z * (B * 0.7 - a0 * 0.34)); lijnNaar(c, x, y, hx, hy, a1, z * (B * 0.7 - a1 * 0.34));
        }
        c.stroke();
      }
      // schuim in het midden, dat achter het schip uitwaaiert
      c.globalAlpha = mix * v * 0.5;
      c.fillStyle = '#e8f2f6';
      c.beginPath();
      for (let j = 0; j < 7; j++) {
        const a = -(0.012 + j * 0.04) * T, wob = Math.sin(t * 3 + j * 1.9 + i) * 0.006 * T;
        stip(c, x + hx * a - hy * wob, y + hy * a + hx * wob, (0.008 + j * 0.0035) * T);
      }
      c.fill();
      // boeggolf
      const bx = x + hx * 2 * L, by = y + hy * 2 * L;
      c.globalAlpha = mix * v * 0.75;
      c.lineWidth = Math.max(0.8, 0.005 * T);
      c.beginPath();
      for (let z = -1; z <= 1; z += 2) { naar(c, bx, by, hx, hy, 0.006 * T, 0); lijnNaar(c, bx, by, hx, hy, -0.3 * L, z * (B + 0.012 * T)); }
      c.stroke();
    }
    c.globalAlpha = mix;
  }

  tekenPuffen(c, buf, n) {
    const spr = this.sprites?.puf;
    if (!spr) return;
    const mix = this.mix;
    for (let i = 0; i < n; i++) {
      const o = i * PUF, r = buf[o + 2], img = spr[buf[o + 4]];
      if (!img) continue;
      c.globalAlpha = mix * buf[o + 3];
      c.drawImage(img, buf[o] - r, buf[o + 1] - r, r * 2, r * 2);
    }
    c.globalAlpha = mix;
  }

  // Alle schaduwen in één pad: overlappende schaduwen worden niet dubbel zo donker, net als echt.
  tekenSchaduwen(c) {
    const T = this.T, n = this.n;
    if (!(n.soldaten || n.tenten || n.tanks || n.kanonnen || n.wagens || n.kisten || n.zandzakken || n.drones || n.vlaggen)) return;
    c.fillStyle = 'rgba(0,0,0,0.26)';
    c.beginPath();
    const S = this.sol, ds = 0.0075 * T;
    for (let i = 0; i < n.soldaten; i++) {
      const o = i * SOL;
      if (S[o + 4] === LIGGEN) ovaal(c, S[o] + ds * 0.6, S[o + 1] + ds * 0.7, S[o + 2], S[o + 3], 0.02 * T, 0.009 * T);
      else stip(c, S[o] + ds, S[o + 1] + ds * 1.1, (S[o + 4] === ZITTEN ? 0.009 : 0.0115) * T);
    }
    const P = this.tent;
    for (let i = 0; i < n.tenten; i++) { const o = i * 5; rechthoek(c, P[o] + 0.012 * T, P[o + 1] + 0.013 * T, P[o + 2], P[o + 3], 0.033 * T, 0.023 * T); }
    const Z = this.zak;
    for (let i = 0; i < n.zandzakken; i++) { const o = i * 4; ovaal(c, Z[o] + 0.004 * T, Z[o + 1] + 0.005 * T, Z[o + 2], Z[o + 3], 0.011 * T, 0.007 * T); }
    const K = this.kist;
    for (let i = 0; i < n.kisten; i++) { const o = i * 5; rechthoek(c, K[o] + 0.005 * T, K[o + 1] + 0.006 * T, K[o + 2], K[o + 3], 0.008 * T, 0.0055 * T); }
    const B = this.tank;
    for (let i = 0; i < n.tanks; i++) { const o = i * TNK; rechthoek(c, B[o] + 0.016 * T, B[o + 1] + 0.018 * T, B[o + 2], B[o + 3], TL * T * 1.02, TW * T * 1.02); }
    const G = this.kanon;
    for (let i = 0; i < n.kanonnen; i++) {
      const o = i * KAN, x = G[o] + 0.008 * T, y = G[o + 1] + 0.009 * T;
      rechthoek(c, x, y, G[o + 2], G[o + 3], 0.016 * T, 0.03 * T);
      rechthoek(c, x + G[o + 2] * 0.06 * T, y + G[o + 3] * 0.06 * T, G[o + 2], G[o + 3], 0.05 * T, 0.005 * T);
    }
    const W = this.wagen;
    for (let i = 0; i < n.wagens; i++) {
      const o = i * WAG, s = W[o + 5], l = s === TRUCK ? 0.056 : s === JEEP ? 0.03 : 0.042, w = s === TRUCK ? 0.022 : s === JEEP ? 0.015 : 0.02;
      rechthoek(c, W[o] + 0.013 * T, W[o + 1] + 0.015 * T, W[o + 2], W[o + 3], l * T, w * T);
    }
    c.fill();
    // drones hangen hoog: hun schaduw ligt verder weg en is zachter
    if (n.drones) {
      c.fillStyle = 'rgba(0,0,0,0.16)';
      c.beginPath();
      const D = this.drone, arm = 0.016 * T;
      for (let i = 0; i < n.drones; i++) {
        const o = i * DRN;
        if (D[o + 6] < 0.5) continue;
        const sx = D[o] + D[o + 4] * SCHUIN, sy = D[o + 1] + D[o + 4] * SCHUIN, hx = D[o + 2], hy = D[o + 3];
        stip(c, sx, sy, 0.008 * T);
        for (let k = 0; k < 4; k++) {
          const a = k < 2 ? arm : -arm, bb = k & 1 ? arm : -arm;
          stip(c, sx + hx * a - hy * bb, sy + hy * a + hx * bb, 0.0085 * T);
        }
      }
      c.fill();
    }
    // vlaggenstokken
    if (n.vlaggen) {
      const V = this.vlag, H = this.stokHoogte();
      c.strokeStyle = 'rgba(0,0,0,0.24)';
      c.lineWidth = Math.max(0.8, 0.004 * T);
      c.beginPath();
      for (let i = 0; i < n.vlaggen; i++) { const o = i * VLG; c.moveTo(V[o], V[o + 1]); c.lineTo(V[o] + H * SCHUIN, V[o + 1] + H * SCHUIN); }
      c.stroke();
    }
  }

  stokHoogte() { return Math.max(11, 0.075 * this.T); }

  tekenSchepen(c) {
    const b = this.schip, T = this.T, t = this.t, mix = this.mix;
    for (let i = 0; i < this.n.schepen; i++) {
      const o = i * SCH, x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3], soort = b[o + 4], p = this.paletten[b[o + 5]];
      if (!p) continue;
      const fregat = soort === FREGAT, L = (fregat ? FL_L : VR_L) * T, B = (fregat ? FL_B : VR_B) * T, vorm = fregat ? FREGAT_VORM : VRACHT_VORM;
      const lit = ZON * (hy - hx) > 0 ? 1 : -1; // welke zijkant naar de zon kijkt
      // schaduw op het water
      c.fillStyle = 'rgba(0,10,20,0.3)';
      c.beginPath(); scheepsvorm(c, x + 0.012 * T, y + 0.014 * T, hx, hy, L, B, vorm); c.fill();
      // romp: donkere zijkant, dan het dek iets smaller
      c.fillStyle = fregat ? p.romp2 : '#6e3428';
      c.beginPath(); scheepsvorm(c, x, y, hx, hy, L, B, vorm); c.fill();
      c.fillStyle = fregat ? p.dek : '#8c8a80';
      c.beginPath(); scheepsvorm(c, x, y, hx, hy, L, B, vorm, 0.9); c.fill();
      // licht langs de zonkant van het dek
      c.strokeStyle = 'rgba(255,255,255,0.28)';
      c.lineWidth = Math.max(0.6, 0.003 * T);
      c.beginPath(); naar(c, x, y, hx, hy, 0.75 * L, lit * 0.5 * B); lijnNaar(c, x, y, hx, hy, 0.3 * L, lit * 0.88 * B); lijnNaar(c, x, y, hx, hy, -0.85 * L, lit * 0.84 * B); c.stroke();
      if (fregat) this.tekenFregat(c, x, y, hx, hy, L, B, p, b[o + 7], b[o + 8], b[o + 9], b[o + 10], b[o + 11], lit);
      else this.tekenVracht(c, x, y, hx, hy, L, B, b[o + 11]);
    }
    c.globalAlpha = mix;
  }

  tekenFregat(c, x, y, hx, hy, L, B, p, kx, ky, terug, heli, zaad, lit) {
    const T = this.T, t = this.t;
    // opbouw midscheeps met eigen schaduw (hij is hoger dan het dek)
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); vak(c, x + 0.016 * T, y + 0.018 * T, hx, hy, -0.25 * L, 0.3 * L, -0.72 * B, 0.72 * B); c.fill();
    c.fillStyle = p.opbouw;
    c.beginPath(); vak(c, x, y, hx, hy, -0.25 * L, 0.3 * L, -0.72 * B, 0.72 * B); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.16)';
    c.beginPath(); vak(c, x, y, hx, hy, -0.25 * L, 0.3 * L, -lit * 0.72 * B, -lit * 0.3 * B); c.fill();
    // brugramen, schoorsteen en de radar die ronddraait
    if (this.middel) {
      c.fillStyle = '#26323c';
      c.beginPath(); vak(c, x, y, hx, hy, 0.25 * L, 0.29 * L, -0.6 * B, 0.6 * B); c.fill();
    }
    c.fillStyle = '#3a3f45';
    c.beginPath(); ovaal(c, x - hx * 0.1 * L, y - hy * 0.1 * L, hx, hy, 0.06 * L, 0.3 * B); c.fill();
    const mx = x + hx * 0.1 * L, my = y + hy * 0.1 * L, ra = t * 2.4 + zaad;
    c.fillStyle = '#d9dde0';
    c.beginPath(); stip(c, mx, my, 0.22 * B); c.fill();
    c.strokeStyle = '#2a2e33';
    c.lineWidth = Math.max(0.8, 0.005 * T);
    c.beginPath(); c.moveTo(mx - Math.cos(ra) * 0.5 * B, my - Math.sin(ra) * 0.5 * B); c.lineTo(mx + Math.cos(ra) * 0.5 * B, my + Math.sin(ra) * 0.5 * B); c.stroke();
    // lanceercellen op het voordek
    if (this.fijn) {
      c.fillStyle = '#5c646c';
      c.beginPath(); vak(c, x, y, hx, hy, 0.34 * L, 0.48 * L, -0.42 * B, 0.42 * B); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = Math.max(0.5, 0.0018 * T);
      c.beginPath();
      for (let j = 1; j < 4; j++) { naar(c, x, y, hx, hy, (0.34 + j * 0.035) * L, -0.42 * B); lijnNaar(c, x, y, hx, hy, (0.34 + j * 0.035) * L, 0.42 * B); }
      naar(c, x, y, hx, hy, 0.34 * L, 0); lijnNaar(c, x, y, hx, hy, 0.48 * L, 0);
      c.stroke();
    }
    // geschutskoepel voorop, de loop naar het doel
    const gx = x + hx * 0.62 * L, gy = y + hy * 0.62 * L, len = 0.03 * T * (1 - 0.3 * terug);
    c.fillStyle = '#353a40';
    c.beginPath(); rechthoek(c, gx + kx * (0.012 * T + len), gy + ky * (0.012 * T + len), kx, ky, len, 0.0035 * T); c.fill();
    c.fillStyle = p.opbouw;
    c.beginPath(); stip(c, gx, gy, 0.42 * B); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath(); stip(c, gx - 0.1 * B, gy - 0.1 * B, 0.18 * B); c.fill();
    // helidek achterop: een ring zonder letters, eventueel met een heli erop
    const dx = x - hx * 0.66 * L, dy = y - hy * 0.66 * L;
    c.strokeStyle = 'rgba(240,240,232,0.7)';
    c.lineWidth = Math.max(0.6, 0.0025 * T);
    c.beginPath(); c.moveTo(dx + 0.62 * B, dy); c.arc(dx, dy, 0.62 * B, 0, TAU); c.stroke();
    if (heli && this.middel) {
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.beginPath(); ovaal(c, dx + 0.006 * T, dy + 0.007 * T, hx, hy, 0.022 * T, 0.008 * T); c.fill();
      c.fillStyle = p.drone;
      c.beginPath(); ovaal(c, dx, dy, hx, hy, 0.02 * T, 0.0075 * T); rechthoek(c, dx - hx * 0.03 * T, dy - hy * 0.03 * T, hx, hy, 0.014 * T, 0.002 * T); c.fill();
      c.fillStyle = 'rgba(160,200,225,0.8)';
      c.beginPath(); stip(c, dx + hx * 0.013 * T, dy + hy * 0.013 * T, 0.004 * T); c.fill();
      const rr = t * (heli === 2 ? 14 : 0.3) + zaad; // warmdraaien tijdens een gevecht
      c.strokeStyle = 'rgba(30,30,30,0.6)';
      c.lineWidth = Math.max(0.5, 0.0022 * T);
      c.beginPath();
      for (let k = 0; k < 2; k++) { const ex = Math.cos(rr + k * Math.PI / 2) * 0.03 * T, ey = Math.sin(rr + k * Math.PI / 2) * 0.03 * T; c.moveTo(dx - ex, dy - ey); c.lineTo(dx + ex, dy + ey); }
      c.stroke();
    }
    // reddingsvlotten langs de reling
    if (this.klein) {
      c.fillStyle = '#eceae2';
      c.beginPath();
      for (let j = 0; j < 3; j++) for (let z = -1; z <= 1; z += 2) rechthoek(c, x + hx * (0.05 - j * 0.09) * L - hy * z * 0.85 * B, y + hy * (0.05 - j * 0.09) * L + hx * z * 0.85 * B, hx, hy, 0.007 * T, 0.003 * T);
      c.fill();
    }
  }

  tekenVracht(c, x, y, hx, hy, L, B, zaad) {
    const T = this.T;
    // containers en kisten in rijen
    for (let r = 0; r < 4; r++) {
      for (let z = -1; z <= 1; z += 2) {
        const a = (0.5 - r * 0.25) * L, k = CONTAINER[Math.floor(hash(zaad, r * 2 + (z > 0 ? 1 : 0), 91) * CONTAINER.length)];
        c.fillStyle = k;
        c.beginPath(); vak(c, x, y, hx, hy, a - 0.105 * L, a + 0.105 * L, z * 0.06 * B, z * 0.7 * B); c.fill();
      }
    }
    if (this.middel) {
      // ribbels op de containers en licht aan de zonkant
      c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = Math.max(0.5, 0.0018 * T);
      c.beginPath();
      for (let r = 0; r < 4; r++) { const a = (0.5 - r * 0.25) * L; for (let j = -2; j <= 2; j++) { naar(c, x, y, hx, hy, a + j * 0.04 * L, -0.7 * B); lijnNaar(c, x, y, hx, hy, a + j * 0.04 * L, 0.7 * B); } }
      c.stroke();
    }
    // brug achterop: wit met een rij ramen, schoorsteen erachter
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); vak(c, x + 0.014 * T, y + 0.016 * T, hx, hy, -0.86 * L, -0.6 * L, -0.8 * B, 0.8 * B); c.fill();
    c.fillStyle = '#e8e6df';
    c.beginPath(); vak(c, x, y, hx, hy, -0.86 * L, -0.6 * L, -0.8 * B, 0.8 * B); c.fill();
    c.fillStyle = '#26323c';
    c.beginPath(); vak(c, x, y, hx, hy, -0.63 * L, -0.6 * L, -0.7 * B, 0.7 * B); c.fill();
    c.fillStyle = '#3a3f45';
    c.beginPath(); stip(c, x - hx * 0.78 * L, y - hy * 0.78 * L, 0.25 * B); c.fill();
    // reddingsboten in het oranje
    if (this.fijn) {
      c.fillStyle = '#e8762a';
      c.beginPath();
      for (let z = -1; z <= 1; z += 2) rechthoek(c, x - hx * 0.72 * L - hy * z * 0.95 * B, y - hy * 0.72 * L + hx * z * 0.95 * B, hx, hy, 0.012 * T, 0.004 * T);
      c.fill();
    }
  }

  tekenZakken(c) {
    const Z = this.zak, n = this.n.zandzakken, T = this.T;
    c.fillStyle = this.winter ? '#c9c2ae' : '#a89470';
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * 4; ovaal(c, Z[o], Z[o + 1], Z[o + 2], Z[o + 3], 0.011 * T, 0.0068 * T); }
    c.fill();
    c.fillStyle = this.winter ? 'rgba(250,252,255,0.75)' : 'rgba(255,248,225,0.25)';
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * 4; ovaal(c, Z[o] - 0.0025 * T, Z[o + 1] - 0.0025 * T, Z[o + 2], Z[o + 3], 0.0075 * T, 0.0038 * T); }
    c.fill();
    if (this.fijn) {
      c.strokeStyle = 'rgba(70,58,38,0.45)';
      c.lineWidth = Math.max(0.5, 0.0016 * T);
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * 4; ovaal(c, Z[o], Z[o + 1], Z[o + 2], Z[o + 3], 0.011 * T, 0.0068 * T); }
      c.stroke();
    }
  }

  // Tentjes: de helft die naar de zon kijkt is licht, de andere helft donker; nok, deur en scheerlijnen.
  tekenTenten(c) {
    const P = this.tent, n = this.n.tenten, T = this.T, l = 0.033 * T, w = 0.023 * T;
    for (let land = 0; land < this.inGebruik.length; land++) {
      if (!this.inGebruik[land]) continue;
      const p = this.paletten[land];
      for (let licht = 0; licht < 2; licht++) {
        let open = false;
        for (let i = 0; i < n; i++) {
          const o = i * 5;
          if (P[o + 4] !== land) continue;
          if (!open) { c.beginPath(); open = true; }
          const zon = ZON * (P[o + 3] - P[o + 2]) > 0 ? 1 : -1, kant = licht ? zon : -zon;
          vak(c, P[o], P[o + 1], P[o + 2], P[o + 3], -l, l, 0, kant * w);
        }
        if (open) { c.fillStyle = licht ? p.tentL : p.tentD; c.fill(); }
      }
    }
    c.strokeStyle = 'rgba(30,28,20,0.35)';
    c.lineWidth = Math.max(0.6, 0.0025 * T);
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * 5; naar(c, P[o], P[o + 1], P[o + 2], P[o + 3], -l, 0); lijnNaar(c, P[o], P[o + 1], P[o + 2], P[o + 3], l, 0); }
    c.stroke();
    if (this.fijn) {
      c.fillStyle = 'rgba(25,22,16,0.6)';
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * 5; vak(c, P[o], P[o + 1], P[o + 2], P[o + 3], l - 0.007 * T, l, -0.006 * T, 0.006 * T); }
      c.fill();
    }
    if (this.klein) {
      c.strokeStyle = 'rgba(60,52,40,0.5)';
      c.lineWidth = Math.max(0.5, 0.0012 * T);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * 5, x = P[o], y = P[o + 1], hx = P[o + 2], hy = P[o + 3];
        for (let k = 0; k < 4; k++) {
          const sa = k & 1 ? 1 : -1, sb = k & 2 ? 1 : -1;
          naar(c, x, y, hx, hy, sa * l * 0.8, sb * w); lijnNaar(c, x, y, hx, hy, sa * (l + 0.01 * T), sb * (w + 0.012 * T));
        }
      }
      c.stroke();
    }
  }

  tekenKisten(c) {
    const K = this.kist, n = this.n.kisten, T = this.T;
    for (let soort = 0; soort < 2; soort++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * 5;
        if (K[o + 4] !== soort) continue;
        if (!open) { c.beginPath(); open = true; }
        rechthoek(c, K[o], K[o + 1], K[o + 2], K[o + 3], 0.008 * T, 0.0055 * T);
      }
      if (open) { c.fillStyle = soort ? '#8a6a40' : '#56573a'; c.fill(); }
    }
    if (this.fijn) {
      c.strokeStyle = 'rgba(255,250,220,0.3)';
      c.lineWidth = Math.max(0.5, 0.0015 * T);
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * 5; naar(c, K[o], K[o + 1], K[o + 2], K[o + 3], -0.007 * T, -0.0045 * T); lijnNaar(c, K[o], K[o + 1], K[o + 2], K[o + 3], 0.007 * T, -0.0045 * T); }
      c.stroke();
    }
  }

  // Munitietruck (cabine en huif), jeep en grondstation met schotel.
  tekenWagens(c) {
    const W = this.wagen, n = this.n.wagens, T = this.T;
    const L = (s) => (s === TRUCK ? 0.056 : s === JEEP ? 0.03 : 0.042) * T, B = (s) => (s === TRUCK ? 0.022 : s === JEEP ? 0.015 : 0.02) * T;
    if (this.fijn) {
      c.fillStyle = '#1f1e1b';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * WAG, s = W[o + 5], l = L(s), w = B(s);
        for (let k = 0; k < (s === TRUCK ? 3 : 2); k++) {
          const a = s === TRUCK ? (0.7 - k * 0.65) * l : (k ? -0.6 : 0.6) * l;
          for (let z = -1; z <= 1; z += 2) rechthoek(c, W[o] + W[o + 2] * a - W[o + 3] * z * w, W[o + 1] + W[o + 3] * a + W[o + 2] * z * w, W[o + 2], W[o + 3], 0.0075 * T, 0.003 * T);
        }
      }
      c.fill();
    }
    for (let land = 0; land < this.inGebruik.length; land++) {
      if (!this.inGebruik[land]) continue;
      const p = this.paletten[land];
      // cabines en jeeps
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * WAG;
        if (W[o + 4] !== land) continue;
        if (!open) { c.beginPath(); open = true; }
        const s = W[o + 5], l = L(s), w = B(s);
        if (s === TRUCK) vak(c, W[o], W[o + 1], W[o + 2], W[o + 3], 0.46 * l, l, -0.9 * w, 0.9 * w);
        else rechthoek(c, W[o], W[o + 1], W[o + 2], W[o + 3], l, w);
      }
      if (open) { c.fillStyle = p.romp; c.fill(); }
      // huif van de truck
      open = false;
      for (let i = 0; i < n; i++) {
        const o = i * WAG;
        if (W[o + 4] !== land || W[o + 5] !== TRUCK) continue;
        if (!open) { c.beginPath(); open = true; }
        const l = L(TRUCK), w = B(TRUCK);
        vak(c, W[o], W[o + 1], W[o + 2], W[o + 3], -l, 0.4 * l, -w, w);
      }
      if (open) { c.fillStyle = p.huif; c.fill(); }
    }
    // licht en schaduw op de zijkanten, voorruit, jeepstoelen en de schotel van het grondstation
    c.fillStyle = 'rgba(255,255,235,0.16)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * WAG, s = W[o + 5], l = L(s), w = B(s), zon = ZON * (W[o + 3] - W[o + 2]) > 0 ? 1 : -1;
      vak(c, W[o], W[o + 1], W[o + 2], W[o + 3], -l, l, zon * w * 0.55, zon * w);
    }
    c.fill();
    if (this.middel) {
      c.fillStyle = '#28333c';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * WAG, s = W[o + 5], l = L(s), w = B(s);
        if (s === JEEP) { vak(c, W[o], W[o + 1], W[o + 2], W[o + 3], 0.2 * l, 0.32 * l, -0.85 * w, 0.85 * w); stip(c, W[o] - W[o + 2] * 0.25 * l, W[o + 1] - W[o + 3] * 0.25 * l, 0.35 * w); }
        else vak(c, W[o], W[o + 1], W[o + 2], W[o + 3], 0.8 * l, 0.92 * l, -0.78 * w, 0.78 * w);
      }
      c.fill();
    }
    let station = false;
    for (let i = 0; i < n; i++) if (W[i * WAG + 5] === STATION) { station = true; break; }
    if (station) {
      c.fillStyle = '#dfe2e0';
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * WAG; if (W[o + 5] === STATION) stip(c, W[o] - W[o + 2] * 0.012 * T, W[o + 1] - W[o + 3] * 0.012 * T, 0.013 * T); }
      c.fill();
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * WAG; if (W[o + 5] === STATION) stip(c, W[o] - W[o + 2] * 0.012 * T + 0.003 * T, W[o + 1] - W[o + 3] * 0.012 * T + 0.003 * T, 0.006 * T); }
      c.fill();
    }
    if (this.fijn) {
      // spanten van de huif
      c.strokeStyle = 'rgba(0,0,0,0.2)';
      c.lineWidth = Math.max(0.5, 0.0018 * T);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * WAG;
        if (W[o + 5] !== TRUCK) continue;
        const l = L(TRUCK), w = B(TRUCK);
        for (let j = 1; j < 4; j++) { const a = -l + (j / 4) * 1.4 * l; naar(c, W[o], W[o + 1], W[o + 2], W[o + 3], a, -w); lijnNaar(c, W[o], W[o + 1], W[o + 2], W[o + 3], a, w); }
      }
      c.stroke();
    }
  }

  // Houwitsers: wielen, poten (gespreid als ze opgesteld staan), affuit met schild en een lange loop met terugslag.
  tekenKanonnen(c) {
    const G = this.kanon, n = this.n.kanonnen, T = this.T;
    c.fillStyle = '#22211d';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * KAN;
      for (let z = -1; z <= 1; z += 2) rechthoek(c, G[o] - G[o + 3] * z * 0.026 * T, G[o + 1] + G[o + 2] * z * 0.026 * T, G[o + 2], G[o + 3], 0.012 * T, 0.0055 * T);
    }
    c.fill();
    for (let land = 0; land < this.inGebruik.length; land++) {
      if (!this.inGebruik[land]) continue;
      const p = this.paletten[land];
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * KAN;
        if (G[o + 6] !== land) continue;
        if (!open) { c.beginPath(); open = true; }
        const x = G[o], y = G[o + 1], hx = G[o + 2], hy = G[o + 3], sp = G[o + 4];
        for (let z = -1; z <= 1; z += 2) { naar(c, x, y, hx, hy, -0.004 * T, z * 0.008 * T); lijnNaar(c, x, y, hx, hy, -0.075 * T, z * (0.004 + 0.034 * sp) * T); }
      }
      if (!open) continue;
      c.strokeStyle = p.rompD;
      c.lineWidth = Math.max(0.8, 0.0075 * T);
      c.stroke();
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * KAN;
        if (G[o + 6] !== land) continue;
        rechthoek(c, G[o], G[o + 1], G[o + 2], G[o + 3], 0.012 * T, 0.02 * T);
        rechthoek(c, G[o] + G[o + 2] * 0.014 * T, G[o + 1] + G[o + 3] * 0.014 * T, G[o + 2], G[o + 3], 0.0035 * T, 0.028 * T);
      }
      c.fillStyle = p.romp;
      c.fill();
    }
    // lopen (met terugslag) en mondingsremmen
    c.fillStyle = '#31352a';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * KAN, hx = G[o + 2], hy = G[o + 3], len = 0.056 * T, a = 0.012 * T + len - G[o + 5] * 0.028 * T;
      rechthoek(c, G[o] + hx * a, G[o + 1] + hy * a, hx, hy, len, 0.0042 * T);
      if (this.fijn) rechthoek(c, G[o] + hx * (a + len), G[o + 1] + hy * (a + len), hx, hy, 0.006 * T, 0.0068 * T);
    }
    c.fill();
    // schoppen aan het eind van de gespreide poten, glans op het schild
    if (this.fijn) {
      c.fillStyle = '#22211d';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * KAN, sp = G[o + 4];
        if (sp < 0.5) continue;
        for (let z = -1; z <= 1; z += 2) { const a = -0.077 * T, bb = z * 0.038 * T; rechthoek(c, G[o] + G[o + 2] * a - G[o + 3] * bb, G[o + 1] + G[o + 3] * a + G[o + 2] * bb, G[o + 2], G[o + 3], 0.004 * T, 0.008 * T); }
      }
      c.fill();
      c.fillStyle = 'rgba(255,255,230,0.2)';
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * KAN; vak(c, G[o], G[o + 1], G[o + 2], G[o + 3], 0.0125 * T, 0.0175 * T, -0.026 * T, 0.026 * T); }
      c.fill();
    }
  }

  tekenNetten(c) {
    const N = this.net, n = this.n.netten, spr = this.sprites?.net;
    if (!spr) return;
    for (let i = 0; i < n; i++) {
      const o = i * 4, r = N[o + 2], img = spr[N[o + 3]];
      if (img) c.drawImage(img, N[o] - r, N[o + 1] - r, r * 2, r * 2);
    }
    // sneeuw op het net in de winter
    if (this.winter) {
      c.fillStyle = 'rgba(245,248,250,0.55)';
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * 4; ovaal(c, N[o] - N[o + 2] * 0.12, N[o + 1] - N[o + 2] * 0.12, 1, 0, N[o + 2] * 0.45, N[o + 2] * 0.3); }
      c.fill();
    }
  }

  // Tanks: rupsbanden, romp met licht en schaduw op de zijkanten, loop, koepel met glans, luik en antenne.
  tekenTanks(c) {
    const B = this.tank, n = this.n.tanks, T = this.T, l = TL * T, w = TW * T, rb = 0.0105 * T;
    c.fillStyle = '#2a2925';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * TNK, x = B[o], y = B[o + 1], hx = B[o + 2], hy = B[o + 3];
      for (let z = -1; z <= 1; z += 2) rechthoek(c, x - hy * z * (w - rb), y + hx * z * (w - rb), hx, hy, l + 0.004 * T, rb);
    }
    c.fill();
    if (this.fijn) {
      // schakels die meelopen als de tank rijdt
      c.strokeStyle = 'rgba(90,88,80,0.6)';
      c.lineWidth = Math.max(0.5, 0.0022 * T);
      c.beginPath();
      const stap = (2 * l) / 9;
      for (let i = 0; i < n; i++) {
        const o = i * TNK, x = B[o], y = B[o + 1], hx = B[o + 2], hy = B[o + 3], f = B[o + 8] >= 0 ? frac(B[o + 8]) : 0;
        for (let j = 0; j < 9; j++) {
          const a = -l + (j + f) * stap;
          for (let z = -1; z <= 1; z += 2) { naar(c, x, y, hx, hy, a, z * (w - 2 * rb)); lijnNaar(c, x, y, hx, hy, a, z * w); }
        }
      }
      c.stroke();
    }
    for (let land = 0; land < this.inGebruik.length; land++) {
      if (!this.inGebruik[land]) continue;
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * TNK;
        if (B[o + 6] !== land) continue;
        if (!open) { c.beginPath(); open = true; }
        romp(c, B[o], B[o + 1], B[o + 2], B[o + 3], l * 0.94, w * 0.68, 0.016 * T);
      }
      if (!open) continue;
      c.fillStyle = this.paletten[land].romp;
      c.fill();
      c.strokeStyle = 'rgba(18,20,14,0.5)';
      c.lineWidth = Math.max(0.5, 0.0025 * T);
      c.stroke();
    }
    // de zijkant die naar de zon kijkt licht, de andere donker
    for (let licht = 0; licht < 2; licht++) {
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * TNK, hx = B[o + 2], hy = B[o + 3], zon = ZON * (hy - hx) > 0 ? 1 : -1, kant = licht ? zon : -zon;
        vak(c, B[o], B[o + 1], hx, hy, -l * 0.94, l * 0.78, kant * w * 0.42, kant * w * 0.68);
      }
      c.fillStyle = licht ? 'rgba(255,255,235,0.17)' : 'rgba(0,0,0,0.2)';
      c.fill();
    }
    // motordek achterop
    if (this.middel) {
      c.fillStyle = 'rgba(0,0,0,0.2)';
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * TNK; vak(c, B[o], B[o + 1], B[o + 2], B[o + 3], -l * 0.92, -l * 0.5, -w * 0.5, w * 0.5); }
      c.fill();
      if (this.fijn) {
        c.strokeStyle = 'rgba(0,0,0,0.3)';
        c.lineWidth = Math.max(0.5, 0.0015 * T);
        c.beginPath();
        for (let i = 0; i < n; i++) { const o = i * TNK; for (let j = 1; j < 5; j++) { const a = -l * 0.92 + j * l * 0.084; naar(c, B[o], B[o + 1], B[o + 2], B[o + 3], a, -w * 0.45); lijnNaar(c, B[o], B[o + 1], B[o + 2], B[o + 3], a, w * 0.45); } }
        c.stroke();
      }
    }
    if (this.winter) {
      c.fillStyle = 'rgba(246,248,250,0.7)';
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * TNK; vak(c, B[o], B[o + 1], B[o + 2], B[o + 3], -l * 0.9, -l * 0.6, -w * 0.4, w * 0.2); }
      c.fill();
    }
    // lopen met terugslag
    c.fillStyle = '#31352a';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * TNK, tcx = B[o] - B[o + 2] * 0.01 * T, tcy = B[o + 1] - B[o + 3] * 0.01 * T, kx = B[o + 4], ky = B[o + 5];
      const len = 0.05 * T, a = 0.03 * T + len - B[o + 7] * 0.02 * T;
      rechthoek(c, tcx + kx * a, tcy + ky * a, kx, ky, len, 0.0046 * T);
      if (this.fijn) rechthoek(c, tcx + kx * (a + len), tcy + ky * (a + len), kx, ky, 0.006 * T, 0.0072 * T);
    }
    c.fill();
    // koepels per land
    for (let land = 0; land < this.inGebruik.length; land++) {
      if (!this.inGebruik[land]) continue;
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * TNK;
        if (B[o + 6] !== land) continue;
        if (!open) { c.beginPath(); open = true; }
        ovaal(c, B[o] - B[o + 2] * 0.01 * T, B[o + 1] - B[o + 3] * 0.01 * T, B[o + 4], B[o + 5], 0.035 * T, 0.028 * T);
      }
      if (!open) continue;
      c.fillStyle = this.paletten[land].koepel;
      c.fill();
      c.strokeStyle = 'rgba(18,20,14,0.55)';
      c.lineWidth = Math.max(0.5, 0.0025 * T);
      c.stroke();
    }
    c.fillStyle = 'rgba(255,255,240,0.14)';
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * TNK; stip(c, B[o] - B[o + 2] * 0.01 * T - 0.009 * T, B[o + 1] - B[o + 3] * 0.01 * T - 0.009 * T, 0.013 * T); }
    c.fill();
    if (this.winter) {
      c.fillStyle = 'rgba(246,248,250,0.6)';
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * TNK; stip(c, B[o] - B[o + 2] * 0.01 * T - 0.006 * T, B[o + 1] - B[o + 3] * 0.01 * T - 0.006 * T, 0.009 * T); }
      c.fill();
    }
    if (this.middel) {
      // luik van de commandant; ingezoomd kijkt hij er in rust uit
      c.fillStyle = '#23251d';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * TNK, kx = B[o + 4], ky = B[o + 5], tcx = B[o] - B[o + 2] * 0.01 * T, tcy = B[o + 1] - B[o + 3] * 0.01 * T;
        stip(c, tcx - kx * 0.008 * T - ky * 0.011 * T, tcy - ky * 0.008 * T + kx * 0.011 * T, 0.0068 * T);
      }
      c.fill();
      if (this.fijn) {
        for (let land = 0; land < this.inGebruik.length; land++) {
          if (!this.inGebruik[land]) continue;
          let open = false;
          for (let i = 0; i < n; i++) {
            const o = i * TNK;
            if (B[o + 6] !== land || !B[o + 9]) continue;
            if (!open) { c.beginPath(); open = true; }
            const kx = B[o + 4], ky = B[o + 5], tcx = B[o] - B[o + 2] * 0.01 * T, tcy = B[o + 1] - B[o + 3] * 0.01 * T;
            stip(c, tcx - kx * 0.008 * T - ky * 0.011 * T, tcy - ky * 0.008 * T + kx * 0.011 * T, 0.0055 * T);
          }
          if (open) { c.fillStyle = this.paletten[land].helm; c.fill(); }
        }
        // antenne: een sprietje omhoog dat zacht meewiegt
        c.strokeStyle = 'rgba(20,20,18,0.75)';
        c.lineWidth = Math.max(0.5, 0.0014 * T);
        c.beginPath();
        for (let i = 0; i < n; i++) {
          const o = i * TNK, kx = B[o + 4], ky = B[o + 5], tcx = B[o] - B[o + 2] * 0.01 * T, tcy = B[o + 1] - B[o + 3] * 0.01 * T;
          const ax = tcx - kx * 0.026 * T + ky * 0.016 * T, ay = tcy - ky * 0.026 * T - kx * 0.016 * T, zw = Math.sin(this.t * 2.3 + i) * 0.006 * T;
          c.moveTo(ax, ay); c.quadraticCurveTo(ax + zw * 0.4, ay - 0.025 * T, ax + zw, ay - 0.05 * T);
        }
        c.stroke();
      }
    }
  }

  // Kampvuur (stenen, blokken en vlammen) en branden op beschadigde voertuigen.
  tekenVuren(c) {
    const V = this.vuur, n = this.n.vuren, T = this.T, t = this.t;
    if (this.middel) {
      c.fillStyle = '#8a8680';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * 5;
        if (V[o + 4] !== KAMPVUUR) continue;
        for (let j = 0; j < 7; j++) { const a = (j / 7) * TAU; stip(c, V[o] + Math.cos(a) * V[o + 2] * 1.35, V[o + 1] + Math.sin(a) * V[o + 2] * 1.15, 0.0034 * T); }
      }
      c.fill();
    }
    if (this.fijn) {
      c.strokeStyle = '#4a3322';
      c.lineWidth = Math.max(0.6, 0.0035 * T);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * 5;
        if (V[o + 4] !== KAMPVUUR) continue;
        const r = V[o + 2];
        c.moveTo(V[o] - r, V[o + 1] - r * 0.5); c.lineTo(V[o] + r, V[o + 1] + r * 0.5);
        c.moveTo(V[o] - r, V[o + 1] + r * 0.5); c.lineTo(V[o] + r, V[o + 1] - r * 0.5);
      }
      c.stroke();
    }
    for (let laag = 0; laag < 2; laag++) {
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * 5, z = V[o + 3], r = V[o + 2] * (laag ? 0.55 : 1);
        const k = 1 + 0.22 * Math.sin(t * 13 + z) + 0.14 * Math.sin(t * 21 + z * 2.3);
        // vlammen likken omhoog
        ovaal(c, V[o], V[o + 1] - r * 0.45 * k, 0, -1, r * 1.15 * k, r * 0.72);
      }
      c.fillStyle = laag ? 'rgba(255,226,120,0.95)' : 'rgba(255,118,32,0.88)';
      c.fill();
    }
  }

  // Soldaten: schaduw staat al in de schaduwlaag; laarzen, lijf, rugzak, geweer, helm, glans en camouflagevlekken.
  tekenSoldaten(c) {
    const S = this.sol, n = this.n.soldaten, T = this.T;
    if (this.middel) {
      // laarzen van wie loopt: om en om voor en achter het lijf
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * SOL;
        if (S[o + 4] !== LOPEN) continue;
        if (!open) { c.beginPath(); open = true; }
        const x = S[o], y = S[o + 1], hx = S[o + 2], hy = S[o + 3], st = Math.sin(S[o + 6]) * 0.009 * T;
        stip(c, x + hx * st - hy * 0.0055 * T, y + hy * st + hx * 0.0055 * T, 0.0042 * T);
        stip(c, x - hx * st + hy * 0.0055 * T, y - hy * st - hx * 0.0055 * T, 0.0042 * T);
      }
      if (open) { c.fillStyle = '#2a2620'; c.fill(); }
    }
    for (let land = 0; land < this.inGebruik.length; land++) {
      if (!this.inGebruik[land]) continue;
      const p = this.paletten[land];
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * SOL;
        if (S[o + 5] !== land) continue;
        if (!open) { c.beginPath(); open = true; }
        const x = S[o], y = S[o + 1], hx = S[o + 2], hy = S[o + 3], pose = S[o + 4];
        if (pose === LIGGEN) ovaal(c, x - hx * 0.004 * T, y - hy * 0.004 * T, hx, hy, 0.019 * T, 0.0085 * T);
        else if (pose === ZITTEN) stip(c, x, y, 0.0105 * T);
        else ovaal(c, x - hx * (pose === KNIELEN ? 0.004 : 0) * T, y - hy * (pose === KNIELEN ? 0.004 : 0) * T, -hy, hx, (pose === KNIELEN ? 0.0125 : 0.014) * T, 0.0088 * T);
      }
      if (!open) continue;
      c.fillStyle = p.lijf;
      c.fill();
      if (this.middel) {
        c.beginPath();
        for (let i = 0; i < n; i++) {
          const o = i * SOL;
          if (S[o + 5] !== land || S[o + 4] === ZITTEN) continue;
          const x = S[o], y = S[o + 1], hx = S[o + 2], hy = S[o + 3];
          if (S[o + 4] === LIGGEN) vak(c, x, y, hx, hy, -0.012 * T, 0.001 * T, -0.0048 * T, 0.0048 * T);
          else vak(c, x, y, hx, hy, -0.0115 * T, -0.0035 * T, -0.0068 * T, 0.0068 * T);
        }
        c.fillStyle = p.rugzak;
        c.fill();
      }
    }
    if (this.middel) {
      c.strokeStyle = '#23221e';
      c.lineWidth = Math.max(0.6, 0.0028 * T);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * SOL, x = S[o], y = S[o + 1], hx = S[o + 2], hy = S[o + 3], pose = S[o + 4];
        if (pose === LOPEN) { naar(c, x, y, hx, hy, -0.007 * T, 0.011 * T); lijnNaar(c, x, y, hx, hy, 0.008 * T, -0.01 * T); }
        else if (pose === LIGGEN) { naar(c, x, y, hx, hy, 0.01 * T, -0.003 * T); lijnNaar(c, x, y, hx, hy, 0.036 * T, -0.003 * T); }
        else if (pose === KNIELEN || pose === STAAN) { naar(c, x, y, hx, hy, 0.003 * T, -0.006 * T); lijnNaar(c, x, y, hx, hy, (pose === KNIELEN ? 0.03 : 0.022) * T, -0.005 * T); }
      }
      c.stroke();
    }
    for (let land = 0; land < this.inGebruik.length; land++) {
      if (!this.inGebruik[land]) continue;
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * SOL;
        if (S[o + 5] !== land) continue;
        if (!open) { c.beginPath(); open = true; }
        const pose = S[o + 4], a = pose === LIGGEN ? 0.014 : pose === ZITTEN ? 0.003 : 0.001;
        stip(c, S[o] + S[o + 2] * a * T, S[o + 1] + S[o + 3] * a * T, 0.0078 * T);
      }
      if (open) { c.fillStyle = this.paletten[land].helm; c.fill(); }
    }
    if (this.fijn) {
      c.fillStyle = 'rgba(255,255,240,0.24)';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * SOL, pose = S[o + 4], a = pose === LIGGEN ? 0.014 : pose === ZITTEN ? 0.003 : 0.001;
        stip(c, S[o] + S[o + 2] * a * T - 0.0026 * T, S[o + 1] + S[o + 3] * a * T - 0.0026 * T, 0.0032 * T);
      }
      c.fill();
    }
    if (this.klein) {
      for (let land = 0; land < this.inGebruik.length; land++) {
        if (!this.inGebruik[land]) continue;
        let open = false;
        for (let i = 0; i < n; i++) {
          const o = i * SOL;
          if (S[o + 5] !== land || S[o + 4] === ZITTEN) continue;
          if (!open) { c.beginPath(); open = true; }
          const x = S[o], y = S[o + 1], hx = S[o + 2], hy = S[o + 3];
          if (S[o + 4] === LIGGEN) { stip(c, x - hx * 0.014 * T + hy * 0.003 * T, y - hy * 0.014 * T - hx * 0.003 * T, 0.0028 * T); stip(c, x + hx * 0.004 * T - hy * 0.004 * T, y + hy * 0.004 * T + hx * 0.004 * T, 0.0026 * T); }
          else { stip(c, x - hy * 0.009 * T, y + hx * 0.009 * T, 0.0028 * T); stip(c, x + hy * 0.008 * T - hx * 0.002 * T, y - hx * 0.008 * T - hy * 0.002 * T, 0.0025 * T); }
        }
        if (open) { c.fillStyle = this.paletten[land].vlek; c.fill(); }
      }
    }
  }

  tekenBurgers(c) {
    const P = this.burger, n = this.n.burgers, T = this.T;
    for (let k = 0; k < KLEDING.length; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        if (P[i * 3 + 2] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        stip(c, P[i * 3], P[i * 3 + 1], 0.009 * T);
      }
      if (open) { c.fillStyle = KLEDING[k]; c.fill(); }
    }
    c.fillStyle = '#e0b48c';
    c.beginPath();
    for (let i = 0; i < n; i++) stip(c, P[i * 3] - 0.001 * T, P[i * 3 + 1] - 0.001 * T, 0.0048 * T);
    c.fill();
  }

  // Drones (quadcopters): armen, romp, draaiende rotorschijven en knipperende navigatielichten. Een drone die na
  // een duikvlucht terugkomt, vervaagt in; die tekenen we apart met zijn eigen doorzichtigheid.
  tekenDrones(c) {
    const D = this.drone, n = this.n.drones, mix = this.mix;
    this.droneGroep(c, 0, n, true);
    for (let i = 0; i < n; i++) {
      const a = D[i * DRN + 6];
      if (a >= 0.999) continue;
      c.globalAlpha = mix * a;
      this.droneGroep(c, i, i + 1, false);
    }
    c.globalAlpha = mix;
  }

  droneGroep(c, van, tot, alleenVol) {
    const D = this.drone, T = this.T, arm = 0.016 * T, rr = 0.0098 * T;
    const neem = (i) => (alleenVol ? D[i * DRN + 6] >= 0.999 : true);
    c.strokeStyle = '#2a2c2e';
    c.lineWidth = Math.max(0.6, 0.0034 * T);
    c.beginPath();
    for (let i = van; i < tot; i++) {
      if (!neem(i)) continue;
      const o = i * DRN, x = D[o], y = D[o + 1] - D[o + 4], hx = D[o + 2], hy = D[o + 3];
      naar(c, x, y, hx, hy, arm, arm); lijnNaar(c, x, y, hx, hy, -arm, -arm);
      naar(c, x, y, hx, hy, arm, -arm); lijnNaar(c, x, y, hx, hy, -arm, arm);
    }
    c.stroke();
    for (let land = 0; land < this.inGebruik.length; land++) {
      if (!this.inGebruik[land]) continue;
      let open = false;
      for (let i = van; i < tot; i++) {
        if (!neem(i) || D[i * DRN + 5] !== land) continue;
        if (!open) { c.beginPath(); open = true; }
        const o = i * DRN;
        rechthoek(c, D[o], D[o + 1] - D[o + 4], D[o + 2], D[o + 3], 0.009 * T, 0.0058 * T);
      }
      if (open) { c.fillStyle = this.paletten[land].drone; c.fill(); }
    }
    c.fillStyle = 'rgba(214,220,226,0.34)';
    c.beginPath();
    for (let i = van; i < tot; i++) {
      if (!neem(i)) continue;
      const o = i * DRN, x = D[o], y = D[o + 1] - D[o + 4], hx = D[o + 2], hy = D[o + 3];
      for (let k = 0; k < 4; k++) { const a = k < 2 ? arm : -arm, b = k & 1 ? arm : -arm; stip(c, x + hx * a - hy * b, y + hy * a + hx * b, rr); }
    }
    c.fill();
    if (this.fijn) {
      // rotorbladen: elke rotor draait de andere kant op dan zijn buurman
      c.strokeStyle = 'rgba(25,25,25,0.55)';
      c.lineWidth = Math.max(0.5, 0.0016 * T);
      c.beginPath();
      for (let i = van; i < tot; i++) {
        if (!neem(i)) continue;
        const o = i * DRN, x = D[o], y = D[o + 1] - D[o + 4], hx = D[o + 2], hy = D[o + 3];
        for (let k = 0; k < 4; k++) {
          const a = k < 2 ? arm : -arm, b = k & 1 ? arm : -arm, cx = x + hx * a - hy * b, cy = y + hy * a + hx * b;
          const r = D[o + 7] * ((k === 0 || k === 3) ? 1 : -1) + k;
          const ex = Math.cos(r) * rr, ey = Math.sin(r) * rr;
          c.moveTo(cx - ex, cy - ey); c.lineTo(cx + ex, cy + ey);
        }
      }
      c.stroke();
      // navigatielichten: rood links, groen rechts, knipperend
      for (let kleur = 0; kleur < 2; kleur++) {
        c.beginPath();
        for (let i = van; i < tot; i++) {
          if (!neem(i)) continue;
          const o = i * DRN;
          if (Math.sin(this.t * 6 + i * 1.3) < -0.2) continue;
          const x = D[o], y = D[o + 1] - D[o + 4], hx = D[o + 2], hy = D[o + 3], b = kleur ? -arm : arm;
          stip(c, x + hx * arm - hy * b, y + hy * arm + hx * b, Math.max(0.6, 0.0022 * T));
        }
        c.fillStyle = kleur ? '#5dff8a' : '#ff4a3a';
        c.fill();
      }
    }
    if (this.klein) {
      c.fillStyle = '#121416';
      c.beginPath();
      for (let i = van; i < tot; i++) { if (!neem(i)) continue; const o = i * DRN; stip(c, D[o] + D[o + 2] * 0.01 * T, D[o + 1] - D[o + 4] + D[o + 3] * 0.01 * T, 0.0028 * T); }
      c.fill();
    }
    // wimpel achter de leidende drone, in de landkleur (goud voor jou)
    for (let i = van; i < tot; i++) {
      const o = i * DRN;
      if (!neem(i) || !D[o + 8]) continue;
      const p = this.paletten[D[o + 5]];
      if (!p) continue;
      const x = D[o] - D[o + 2] * 0.01 * T, y = D[o + 1] - D[o + 4] - D[o + 3] * 0.01 * T, hx = D[o + 2], hy = D[o + 3];
      const lw = Math.max(6, 0.04 * T), zw = Math.sin(this.t * 7 + i) * 0.25;
      c.fillStyle = p.vlag;
      c.beginPath();
      naar(c, x, y, hx, hy, 0, -0.005 * T); lijnNaar(c, x, y, hx, hy, -lw, zw * lw * 0.4); lijnNaar(c, x, y, hx, hy, 0, 0.005 * T); c.closePath();
      c.fill();
      c.strokeStyle = p.vlag === GOUD ? 'rgba(255,248,225,0.9)' : 'rgba(20,20,20,0.5)';
      c.lineWidth = Math.max(0.5, 0.0015 * T);
      c.stroke();
    }
  }

  tekenRingen(c) {
    const R = this.ring, n = this.n.ringen, T = this.T, mix = this.mix;
    c.strokeStyle = '#cfcfc9';
    c.lineWidth = Math.max(1, 0.009 * T);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      c.globalAlpha = mix * R[o + 3];
      c.beginPath(); c.moveTo(R[o] + R[o + 2], R[o + 1]); c.arc(R[o], R[o + 1], R[o + 2], 0, TAU); c.stroke();
    }
    c.globalAlpha = mix;
  }

  // Vuurballen met puin dat wegvliegt; op het water een witte ring van spatten.
  tekenKnallen(c) {
    const K = this.knal, n = this.n.knallen, P = this.puin, T = this.T, mix = this.mix, vb = this.sprites?.vuurbal;
    if (this.n.puin) {
      c.fillStyle = '#2a231c';
      c.beginPath();
      for (let i = 0; i < this.n.puin; i++) stip(c, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      c.fill();
    }
    for (let i = 0; i < n; i++) {
      const o = i * 5, age = K[o + 2], R = K[o + 3];
      if (K[o + 4]) {
        c.globalAlpha = mix * 0.8 * (1 - age);
        c.strokeStyle = '#f1f7fb';
        c.lineWidth = Math.max(0.8, 0.005 * T);
        c.beginPath();
        const r = R * (0.35 + 1.1 * age);
        c.moveTo(K[o] + r, K[o + 1]); c.ellipse(K[o], K[o + 1], r, r * 0.7, 0, 0, TAU);
        c.stroke();
      } else if (age < 0.4 && vb) {
        const f = age / 0.4, r = R * (0.45 + 0.85 * f);
        c.globalAlpha = mix * (1 - 0.75 * f);
        c.drawImage(vb, K[o] - r, K[o + 1] - r * 1.1, r * 2, r * 2);
      }
    }
    c.globalAlpha = mix;
  }

  // Lichtspoorkogels (dun, warm geel), granaatsporen (dikker, oranje) en granaten in een boog met een staartje.
  tekenKogels(c) {
    const B = this.kogel, n = this.n.kogels, G = this.granaat, T = this.T;
    for (let soort = 0; soort < 2; soort++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * 5;
        if (B[o + 4] !== soort) continue;
        if (!open) { c.beginPath(); open = true; }
        c.moveTo(B[o], B[o + 1]); c.lineTo(B[o] + B[o + 2], B[o + 1] + B[o + 3]);
      }
      if (!open) continue;
      c.strokeStyle = soort ? '#ffb45c' : '#ffdc8c';
      c.lineWidth = Math.max(soort ? 1.1 : 0.7, (soort ? 0.0065 : 0.003) * T);
      c.stroke();
    }
    if (this.n.granaten) {
      c.strokeStyle = 'rgba(255,226,170,0.55)';
      c.lineWidth = Math.max(0.8, 0.004 * T);
      c.beginPath();
      for (let i = 0; i < this.n.granaten; i++) { const o = i * 4; c.moveTo(G[o], G[o + 1]); c.lineTo(G[o] - G[o + 2] * 0.035 * T, G[o + 1] - G[o + 3] * 0.035 * T); }
      c.stroke();
      c.fillStyle = '#fff2cc';
      c.beginPath();
      for (let i = 0; i < this.n.granaten; i++) stip(c, G[i * 4], G[i * 4 + 1], Math.max(1, 0.0048 * T));
      c.fill();
    }
  }

  // Mondingsvuur: een oranje tong in de schietrichting met een witgele kern; grote stukken ook opzij (mondingsrem).
  tekenFlitsen(c) {
    const F = this.flits, n = this.n.flitsen, T = this.T;
    c.fillStyle = '#ff9a2e';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * 5, x = F[o], y = F[o + 1], hx = F[o + 2], hy = F[o + 3], r = F[o + 4];
      ovaal(c, x + hx * r * 0.7, y + hy * r * 0.7, hx, hy, r * 1.5, r * 0.75);
      if (r > 0.018 * T) for (let z = -1; z <= 1; z += 2) ovaal(c, x - hy * z * r * 0.6, y + hx * z * r * 0.6, -hy * z, hx * z, r * 0.7, r * 0.36);
    }
    c.fill();
    c.fillStyle = '#fff5c8';
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * 5; stip(c, F[o] + F[o + 2] * F[o + 4] * 0.4, F[o + 1] + F[o + 3] * F[o + 4] * 0.4, F[o + 4] * 0.55); }
    c.fill();
  }

  // Herkenningsteken: een wimpel aan een stok in de landkleur (goud voor jou), die met de wind meewappert.
  tekenVlaggen(c) {
    const V = this.vlag, n = this.n.vlaggen, T = this.T, t = this.t;
    const H = this.stokHoogte(), fl = Math.max(7, 0.042 * T), fh = Math.max(4.5, 0.026 * T);
    const dir = this.vlagRichting, slap = (1 - this.windK) * 0.6;
    c.strokeStyle = '#2e2b27';
    c.lineWidth = Math.max(0.8, 0.0042 * T);
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * VLG; c.moveTo(V[o], V[o + 1]); c.lineTo(V[o], V[o + 1] - H); }
    c.stroke();
    for (let speler = 0; speler < 2; speler++) {
      for (let land = 0; land < this.inGebruik.length; land++) {
        if (!this.inGebruik[land]) continue;
        let open = false;
        for (let i = 0; i < n; i++) {
          const o = i * VLG;
          if (V[o + 2] !== land || V[o + 4] !== speler) continue;
          if (!open) { c.beginPath(); open = true; }
          const x = V[o], top = V[o + 1] - H, zaad = V[o + 3];
          const golf = Math.sin(t * (4 + 3 * this.windK) + zaad) * fh * 0.2;
          const tx = x + dir * fl * (1 - slap * 0.45 + 0.06 * Math.sin(t * 3.1 + zaad)), ty = top + fh * 0.5 + slap * fh * 1.1 + golf;
          c.moveTo(x, top);
          c.quadraticCurveTo(x + dir * fl * 0.5, top + golf * 0.6 + slap * fh * 0.4, tx, ty);
          c.lineTo(x, top + fh);
          c.closePath();
        }
        if (!open) continue;
        c.fillStyle = this.paletten[land].vlag;
        c.fill();
        c.strokeStyle = speler ? '#fff6dc' : 'rgba(18,18,18,0.6)';
        c.lineWidth = Math.max(0.7, 0.0022 * T);
        c.stroke();
      }
    }
    // knop op de stok: goud voor jou
    for (let speler = 0; speler < 2; speler++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * VLG;
        if (V[o + 4] !== speler) continue;
        if (!open) { c.beginPath(); open = true; }
        stip(c, V[o], V[o + 1] - H, Math.max(1.1, 0.004 * T));
      }
      if (open) { c.fillStyle = speler ? GOUD : '#bfc3c6'; c.fill(); }
    }
  }

  // Lichtgloed met 'lighter'. 's Nachts lichten mondingsvuur en inslagen de omgeving op: groter en feller, zodat
  // ze na de nachtlaag (die alles daarna nog donkerder maakt) als een kort lichtschijnsel overblijven.
  tekenLichten(c) {
    const L = this.licht, n = this.n.lichten, spr = this.sprites?.gloed, mix = this.mix, nacht = this.nacht;
    if (!spr) return;
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const o = i * LICHT, vuur = L[o + 4] === 1;
      const a = L[o + 3] * (vuur ? 0.06 + 1.1 * nacht : 0.32 + 0.95 * nacht);
      if (a < 0.01) continue;
      const r = L[o + 2] * (1 + 0.8 * nacht);
      c.globalAlpha = Math.min(1, a) * mix;
      c.drawImage(spr, L[o] - r, L[o + 1] - r, r * 2, r * 2);
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = mix;
  }
}
