// Sfeer en weer op de kaart (pakket E): licht, wolken, mist, regen, sneeuw, onweer, maan, rijp, smog en de kleur van de dag.
// Gestuurd door seizoen(), weer() en wind() uit seizoen.js en door dezelfde dag-en-nachtcyclus als tekenNacht in map.js,
// zodat sneeuw in de lucht, natte straten en wolkenschaduwen bij de rest van de kaart passen.
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Plaatsing en aantallen komen uit een vaste hash
// van tegel, cel, volgnummer en dag; de klok (nu) stuurt alleen beweging. Geen Math.random, geen Date.
//
// Twee aanroepen per beeld vanuit map.js:
//   tekenGrond  na gebouwen en leven, vóór de eenheden en de nacht: rijp, wolkenschaduw, mist, smog, glinstering,
//               kringen, natte straten, hittetrilling, stofhoosjes, stuifsneeuw, pollen en de kleur van de dag.
//   tekenLucht  na de lichten: stadsgloed bij nacht, hoge wolken, zonnestralen, maanlicht op het water, lage flarden,
//               deeltjes, regen, sneeuw, regenboog, bliksem.
//
// Vlakken: wolkenschaduw, mist en smog gaan eerst met volle dekking in een klein eigen canvas (een kwart van het scherm)
// en dat gaat daarna één keer met de gewenste sterkte over het beeld. Overlappende vormen tellen zo niet op tot donkere
// of witte klodders: twee wolkenschaduwen over elkaar zijn even donker als één, net als in het echt.

import { seizoen, weer, wind } from './seizoen.js';

// ---------- gedeelde hulpjes (eigen kopie, zie inzoom-spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// altijd 0..m, ook voor negatieve v: de wolkencellen schuiven met de wind mee en krijgen na een tijdje negatieve
// nummers, en (-5) % 3 is in JavaScript -2 (dan valt de sprite weg en breekt het hele beeld)
const mod = (v, m) => v - Math.floor(v / m) * m;
const TAU = Math.PI * 2;

// Gelijkmatig uitdunnen: verwacht een laag meer dan driekwart van zijn plafond, dan valt op hash een vaste fractie
// weg, verspreid over het hele beeld. Zonder dit vult het plafond alleen de bovenkant, want de lussen lopen rij voor
// rij van boven naar onder. Op hash, dus stabiel van beeld tot beeld; bij schuiven wisselen alleen de randgevallen.
function dun(verwacht, max) { const doel = max * 0.75; return verwacht > doel ? doel / verwacht : 1; }

// Reeks pseudo-random getallen uit één zaad (mulberry32, dezelfde als in detail.js), alleen voor het bakken van sprites.
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
let maakCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
export function zetCanvasFabriek(fn) { maakCanvas = fn; }

// ---------- vaste waarden ----------

// Harde plafonds per beeld: een natte, mistige stad op zoom 14 mag nooit de framerate opeten.
export const PLAFOND = {
  wolken: 40, schaduwen: 30, mist: 40, flarden: 8, glinster: 56, kringen: 44, spatten: 36, glans: 24, trilling: 20, deeltjes: 54,
  reflecties: 24, halo: 24, plaskringen: 40, vlagen: 16, bliksem: 1,
  vlakken: 4, smog: 48, rijp: 40, maanpad: 40, stadslicht: 150, snoeren: 400, hoosjes: 3, stuif: 48, pollen: 10,
};
// Mengmodi die de videokaart per pixel de ondergrond laten teruglezen: op een trage laptop kost één zo'n vlak over het
// hele scherm meer dan alle andere sfeerlagen samen. Deze laag gebruikt ze niet (sfeertest controleert dat).
export const DURE_MODI = ['saturation', 'soft-light', 'overlay', 'hard-light', 'color', 'hue', 'luminosity', 'color-dodge', 'color-burn', 'difference', 'exclusion', 'darken', 'lighten'];

const DEKKING = 0.6; // hoogstens dit deel van de wolkencellen is bezet: ook een grijze dag houdt gaten
const GROOT = 110; // cel van de grote wolken (wereldeenheden)
const KLEIN = 30; // cel van de kleine stapelwolkjes die je pas diep ingezoomd ziet
const DEELTJE = 24; // cel van de zwevende deeltjes (blaadjes, bloesem, pluis, pollen, vuurvliegjes)
const VEL = 128; // zijde van de regen- en sneeuwvellen (px)
const VLAK = 4; // vlakken op een kwart van de schermresolutie: schaduw, mist en smog zijn toch zacht
const RIJP = 6; // rijpkaart: 6×6 cellen per tegel, fijn genoeg voor kust en rivieroevers
const MAAND = 29.53; // dagen van nieuwe maan tot nieuwe maan
const MAAN_BEGIN = 8; // zo is het in de eerste speelweek al volle maan
const MAX_LICHT = 640; // lichtkernen voor de stadsgloed (bij elke bouw opnieuw geteld)
const ALIAS = { olieveld: 'centrale', staalfabriek: 'industrie', landbouw: 'boerderij', zware_industrie: 'industrie', ruimtevaartcentrum: 'chipfabriek', spoor: 'opslag' };
// Hoe vuil de lucht boven een gebouw wordt, per tekening; een pack kan per gebouw een eigen 'vervuiling' meegeven.
const VERVUILING = { centrale: 1, industrie: 0.8, mijn: 0.6, wapenfabriek: 0.6, chipfabriek: 0.25 };
// Lage flarden in drie lagen op verschillende hoogte: [zoom waarop je erdoorheen vliegt, celmaat in wereldeenheden].
const FLARDLAGEN = [[9, 26], [15, 18], [22, 13]];
const BOOG = ['#ff5a4a', '#ff9f3a', '#ffe14a', '#6fe06a', '#4aa8ff', '#7a6aff', '#c46aff'];
// Lagen van regen en sneeuw: [schaal, snelheid px/s, sprite, alpha]; vaste lijsten, zodat er per beeld niets wordt aangemaakt.
const REGENLAGEN = [[0.7, 520, 0, 0.22], [1.05, 820, 1, 0.26], [1.6, 1250, 0, 0.3]];
const SNEEUWLAGEN = [[0.6, 32, 0, 0.35], [0.95, 55, 1, 0.45], [1.45, 85, 1, 0.55]];
const STREEPLIJN = [[2.6, 0.12], [1, 0.4]];
const SCHICHTLIJN = [[7, 0.18], [1.6, 0.95]];
// Zwevende deeltjes per soort: naam en kleuren (het gewicht hangt van seizoen en licht af en wordt per beeld berekend).
const DEELTJESOORTEN = [
  ['bloesem', ['#f8d7e2', '#ffffff', '#f2b8cb']],
  ['pluis', ['#fffbea', '#f4efd8']],
  ['blad', ['#d9822b', '#b5481f', '#e2b13c', '#8a5a2b']],
  ['vuurvlieg', null],
  ['pollen', ['#f1dc6e', '#e2c64a']],
];
// Lantaarns van de levenslaag (straatcontract: om de 0,25 tegel langs de straat, om en om aan beide kanten op de stoep,
// rond het plein van de hoofdstad geen). Per tegel twee langs de oost-weststraat: [langs, kant].
const STOEP = 0.045;
const LAMPEN = [[-0.375, -1], [0.125, -1]];
const LAMPEN_HOOFD = [[-0.375, -1], [0.375, 1]];
const GEEN = [];
// De schaduw van iets hoogs valt naar het zuidoosten, zoals bij de gebouwen in detail.js (0,75 opzij, 0,5 omlaag).
const SCHADUW_HOEK = Math.atan2(0.5, 0.75);

// Dag en nacht: precies de formule van tekenNacht in map.js (cyclus van drie minuten, fase 0 = middag).
export function dagLicht(nu) {
  const fase = (nu / 1000 % 180) / 180;
  const licht = 0.5 + 0.5 * Math.cos(fase * TAU);
  return { fase, licht, nacht: clamp((0.5 - licht) / 0.5, 0, 1) };
}

// Stand van de maan op een speldag: fase 0 is nieuwe maan, 0,5 volle maan; licht is het verlichte deel (0..1).
export function maanStand(dagF = 0) {
  const fase = mod((dagF + MAAN_BEGIN) / MAAND, 1);
  return { fase, licht: 0.5 - 0.5 * Math.cos(fase * TAU) };
}

// ---------- sprites (één keer gebakken, daarna alleen drawImage) ----------

function zacht(c, x, y, r, kleur, a0, a1 = 0) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${kleur},${a0})`);
  g.addColorStop(0.55, `rgba(${kleur},${a0 * 0.55})`);
  g.addColorStop(1, `rgba(${kleur},${a1})`);
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}

// Een bol met een vlakke kern en een zachte rand: volle dekking tot k van de straal. Overlappende bollen tellen zo niet
// op tot een donkere kern (zoals bij zacht()), de vorm heeft overal dezelfde dekking.
function kern(c, x, y, r, kleur, a = 1, k = 0.6) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${kleur},${a})`);
  g.addColorStop(k, `rgba(${kleur},${a})`);
  g.addColorStop(1, `rgba(${kleur},0)`);
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}

// Een wolkvorm uit losse bollen: als schaduw (donker), mist (wit en plat) of flard (wit en rafelig).
function bolSprite(w, h, zaad, kleur, a, n) {
  const cv = maakCanvas(w, h), c = cv.getContext('2d'), r = rnd(zaad);
  for (let i = 0; i < n; i++) {
    const x = w * (0.22 + r() * 0.56), y = h * (0.3 + r() * 0.4), rr = h * (0.2 + r() * 0.28);
    zacht(c, x, y, rr, kleur, a);
  }
  return cv;
}

// Een vorm met vlakke kern uit bollen langs een as, in het midden het dikst (een wolk of een mistbank). plat rekt de
// bollen uit in de lengte; elke bol blijft binnen het canvas, anders krijgt de vorm een rechte rand.
function vormSprite(w, h, zaad, kleur, n, plat, k) {
  const cv = maakCanvas(w, h), c = cv.getContext('2d'), r = rnd(zaad);
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n, dik = Math.pow(Math.sin(Math.PI * f), 0.6);
    const x = w * (0.18 + 0.64 * f + (r() - 0.5) * 0.08), y = h * (0.5 + (r() - 0.5) * 0.12);
    const rr = Math.min(h * (0.15 + 0.2 * dik + r() * 0.06), y - 1, h - y - 1, (x - 1) / plat, (w - x - 1) / plat);
    c.save(); c.translate(x, y); c.scale(plat, 1);
    kern(c, 0, 0, rr, kleur, 1, k);
    c.restore();
  }
  return cv;
}

// Een lage wolkenflard: dunne, lange slierten naast elkaar, half doorzichtig.
function slierSprite(w, h, zaad, kleur) {
  const cv = maakCanvas(w, h), c = cv.getContext('2d'), r = rnd(zaad);
  for (let i = 0; i < 7; i++) {
    const d = h * (0.12 + r() * 0.12), l = w * (0.14 + r() * 0.2);
    const x = l + r() * (w - 2 * l), y = d + 1 + r() * (h - 2 * d - 2);
    c.save(); c.translate(x, y); c.scale(l / d, 1);
    zacht(c, 0, 0, d, kleur, 0.16 + r() * 0.12);
    c.restore();
  }
  return cv;
}

// Een stad bij nacht van boven: zachte gloed in het midden, snoeren van puntjes langs de uitvalswegen en wijken
// die naar buiten uitdunnen, met hier en daar een koelere lamp.
function stadSprite(zaad) {
  const N = 96, m = N / 2, cv = maakCanvas(N, N), c = cv.getContext('2d'), r = rnd(zaad);
  zacht(c, m, m, m * 0.62, '255,170,90', 0.3);
  const stip = (x, y, s, kleur) => { c.fillStyle = kleur; c.fillRect(x - s / 2, y - s / 2, s, s); };
  for (let k = 0; k < 5; k++) {
    const h = r() * TAU;
    for (let s = 7; s < m - 3; s += 2.5 + r() * 2.5) {
      const a = h + Math.sin(s * 0.09 + k) * 0.18;
      stip(m + Math.cos(a) * s, m + Math.sin(a) * s, 1.1 + r() * 0.6, `rgba(255,${(186 + r() * 30) | 0},${(104 + r() * 40) | 0},${(0.9 - 0.6 * s / m).toFixed(2)})`);
    }
  }
  for (let i = 0; i < 150; i++) {
    const a = r() * TAU, d = (m - 4) * Math.pow(r(), 0.75), x = m + Math.cos(a) * d, y = m + Math.sin(a) * d;
    const al = (1 - 0.75 * d / m).toFixed(2);
    stip(x, y, 0.8 + r() * 1.1, r() < 0.12 ? `rgba(214,228,255,${al})` : `rgba(255,${(178 + r() * 40) | 0},${(98 + r() * 50) | 0},${al})`);
  }
  return cv;
}

function bakSprites() {
  const S = {};
  // wolkenschaduw op de grond, mistbanken en smog: vlakke kern met zachte rand, voor de vlakken
  S.vorm = [0, 1, 2].map((i) => vormSprite(192, 96, 211 + i, '12,20,36', 7, 1.35, 0.62));
  S.mist = [0, 1].map((i) => vormSprite(256, 48, 231 + i, '236,240,245', 6, 2.8, 0.4));
  S.smog = (() => { const cv = maakCanvas(64, 64); kern(cv.getContext('2d'), 32, 32, 31, '158,132,96', 1, 0.4); return cv; })();
  S.flard = [0, 1, 2].map((i) => slierSprite(256, 48, 251 + i, '246,248,250'));
  // Windvlaag op het water: een plek waar het oppervlak donker rimpelt, met korte lichte streepjes erin.
  {
    const cv = maakCanvas(128, 48), c = cv.getContext('2d'), r = rnd(87);
    zacht(c, 64, 24, 24, '10,30,52', 0.35);
    c.save(); c.scale(2.4, 1); zacht(c, 26.7, 24, 20, '10,30,52', 0.25); c.restore();
    c.strokeStyle = 'rgba(220,235,245,0.55)'; c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < 16; i++) { const x = 24 + r() * 80, y = 12 + r() * 24, l = 4 + r() * 9; c.moveTo(x, y); c.lineTo(x + l, y); }
    c.stroke();
    S.vlaag = cv;
  }
  // Donkere regenwolk: een grijze laag over de gewone wolk van map.js.
  S.donker = bolSprite(200, 100, 71, '96,104,118', 0.75, 6);
  // Regengordijn onder een bui (alleen op lage zoom): schuine strepen die naar onderen vervagen.
  {
    const cv = maakCanvas(64, 128), c = cv.getContext('2d'), r = rnd(81);
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(150,165,185,0.55)'); g.addColorStop(1, 'rgba(150,165,185,0)');
    c.strokeStyle = g; c.lineWidth = 1.2;
    c.beginPath();
    for (let i = 0; i < 18; i++) { const x = r() * 56 + 4; c.moveTo(x, r() * 20); c.lineTo(x - 10, 100 + r() * 28); }
    c.stroke();
    S.gordijn = cv;
  }
  // Glinster: een kruisje met een zachte kern; wit voor de middag en de maan, warm voor het gouden uur.
  const ster = (kleur) => {
    const cv = maakCanvas(16, 16), c = cv.getContext('2d');
    zacht(c, 8, 8, 4, kleur, 1);
    c.fillStyle = `rgba(${kleur},0.9)`;
    c.fillRect(7.5, 1, 1, 14); c.fillRect(1, 7.5, 14, 1);
    return cv;
  };
  S.glinster = ster('255,255,255');
  S.glinsterWarm = ster('255,206,130');
  S.glinsterMaan = ster('214,226,255');
  const bol = (n, kleur, a) => { const cv = maakCanvas(n, n); zacht(cv.getContext('2d'), n / 2, n / 2, n / 2, kleur, a); return cv; };
  S.vuurvlieg = bol(16, '214,255,120', 1);
  S.stof = bol(32, '200,172,128', 0.75);
  S.vlek = bol(32, '16,20,26', 0.85);
  S.pollenwolk = bol(64, '232,216,118', 0.6);
  // Regenvel: verticale strepen die naadloos herhalen; bij het tekenen gedraaid naar de wind.
  S.regen = [0, 1].map((v) => {
    const cv = maakCanvas(VEL, VEL), c = cv.getContext('2d'), r = rnd(91 + v);
    c.strokeStyle = 'rgba(214,226,242,0.85)'; c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < 20; i++) {
      const x = Math.floor(r() * VEL) + 0.5, y = r() * VEL, l = 7 + r() * 13;
      c.moveTo(x, y); c.lineTo(x, y + l);
      if (y + l > VEL) { c.moveTo(x, y - VEL); c.lineTo(x, y + l - VEL); }
    }
    c.stroke();
    return cv;
  });
  // Sneeuwvel: vlokken van verschillende grootte met een zachte rand, ook naadloos.
  S.sneeuw = [0, 1].map((v) => {
    const cv = maakCanvas(VEL, VEL), c = cv.getContext('2d'), r = rnd(101 + v);
    for (let i = 0; i < 16; i++) {
      const x = r() * VEL, y = r() * VEL, rr = 0.8 + r() * (v ? 2.2 : 1.2);
      for (const [dx, dy] of [[0, 0], [VEL, 0], [-VEL, 0], [0, VEL], [0, -VEL]]) zacht(c, x + dx, y + dy, rr * 1.6, '255,255,255', 0.95, 0);
    }
    return cv;
  });
  // Rijp van dichtbij: losse witte korreltjes op het gras over een heel lichte waas; past naadloos per tegel.
  {
    const N = 128, cv = maakCanvas(N, N), c = cv.getContext('2d'), r = rnd(141);
    c.fillStyle = 'rgba(236,243,250,0.16)'; c.fillRect(0, 0, N, N);
    for (let i = 0; i < 420; i++) {
      const x = r() * N, y = r() * N, s = 0.6 + r() * 1.3;
      c.fillStyle = `rgba(248,252,255,${(0.45 + r() * 0.5).toFixed(2)})`;
      c.fillRect(x, y, s, s * (0.5 + r()));
    }
    S.rijpKorrel = cv;
  }
  // Stadslicht bij nacht en de warme kleurcorrectie die een wit opgetelde stadskern weer goudgeel maakt.
  S.stadslicht = [0, 1, 2].map((i) => stadSprite(161 + i));
  {
    const cv = maakCanvas(64, 64), c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,178,100,1)'); g.addColorStop(0.5, 'rgba(255,206,150,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    S.warmte = cv;
  }
  // Vignet voor het miniatuurgevoel bij diep inzoomen.
  {
    const cv = maakCanvas(256, 256), c = cv.getContext('2d');
    const g = c.createRadialGradient(128, 128, 70, 128, 128, 182);
    g.addColorStop(0, 'rgba(8,12,20,0)'); g.addColorStop(1, 'rgba(8,12,20,0.85)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    S.vignet = cv;
  }
  // Zonnegloed (het licht komt uit het noordwesten) en zonnestralen die van daaruit over de kaart vallen.
  S.zon = bol(128, '255,196,120', 1);
  {
    const cv = maakCanvas(256, 256), c = cv.getContext('2d'), r = rnd(121);
    for (let i = 0; i < 9; i++) {
      const a = 0.12 + r() * 1.3, b = a + 0.03 + r() * 0.07;
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 256);
      g.addColorStop(0, 'rgba(255,226,170,0.6)'); g.addColorStop(1, 'rgba(255,226,170,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 256, a, b); c.closePath(); c.fill();
    }
    S.stralen = cv;
  }
  return S;
}

// Kleur van de dag opgeteld in één vlak per mengmodus. maal: per kanaal vermenigvuldigen (K[0..2]); waas: gewone
// laag eroverheen, als voorvermenigvuldigde kleur plus dekking (K[3..6]). Zo wordt het hooguit twee vlakken.
function maal(K, r, g, b, a) {
  if (a <= 0) return;
  K[0] *= 1 - a * (1 - r / 255); K[1] *= 1 - a * (1 - g / 255); K[2] *= 1 - a * (1 - b / 255);
}
function waas(K, r, g, b, a) {
  if (a <= 0) return;
  K[3] = (r / 255) * a + K[3] * (1 - a); K[4] = (g / 255) * a + K[4] * (1 - a); K[5] = (b / 255) * a + K[5] * (1 - a);
  K[6] = a + K[6] * (1 - a);
}

// ---------- de laag ----------

export class SfeerLaag {
  constructor() {
    this.state = null;
    this.geo = null;
    this.sprites = null;
    this.patronen = null;
    this.patroonCtx = null;
    this.vorigNu = -1;
    this.vorigLz = null;
    this.zoomVaart = 0; // hoe snel er nu in- of uitgezoomd wordt (verandering van ln zoom per seconde, gladgestreken)
    this.maan = null; // stand van de maan voor de nacht die nu op de kaart is (zie bijwerken)
    this.drift = { x: 0, y: 0 }; // hoe ver de wolken met de wind zijn meegedreven (wereldeenheden)
    this.glad = null; // gladgestreken weer op het midden van het beeld
    this.stemming = null; // publiek: wat andere lagen over licht en weer willen weten
    this.vlakken = [null, null, null]; // schaduw, mist, smog
    this.mistKans = new Float32Array(0);
    this.mistX = new Float32Array(0); this.mistY = new Float32Array(0); this.mistHoek = new Float32Array(0);
    this.open = new Float32Array(0); // gras en akker (1), kust, bos en berg minder, water en stad niet: voor rijp en dauw
    this.droog = new Uint8Array(0);
    this.water = new Uint8Array(0);
    this.straat = new Uint8Array(0);
    this.bebouwd = new Uint8Array(0);
    this.vuil = new Float32Array(0); this.vuilBron = new Float32Array(0); this.vuilMax = 0;
    this.rijpBasis = new Float32Array(0); this.volRijp = new Uint8Array(0);
    this.rijpKaart = null; this.rijpBeeld = null; this.rijpVies = true;
    this.waterBron = undefined;
    this.bouwSig = null;
    this.soortInfo = new Map(); // gebouwId -> { nr, woon, licht, vuil, knoop } (begrensd door het aantal gebouwsoorten)
    this.snoer = new Float32Array(PLAFOND.snoeren * 4); this.nSnoer = 0;
    this.lichtPunt = new Float32Array(MAX_LICHT * 5); this.nLicht = 0;
    this.snoerStreep = [0.01, 6];
    this.wolkBuf = new Float32Array(PLAFOND.wolken * 7);
    this.plasTegels = new Int32Array(PLAFOND.glans);
    this.plassen = new Float32Array(PLAFOND.glans * 3 * 4);
    this.gewicht = new Float32Array(DEELTJESOORTEN.length);
    this.kleur = new Float32Array(7);
    this.kleurSleutel = [-1, -1]; this.kleurStr = ['', ''];
    this.nWater = 0; this.nLand = 0; this.nDroog = 0; this.zichtFactor = 1;
    this.tel = {};
    for (const k of Object.keys(PLAFOND)) this.tel[k] = 0;
  }

  // Na het laden van een spel: per tegel voorrekenen waar mist hangt, waar rijp kan liggen en waar het land droog is.
  laad(view) {
    this.state = view.state;
    this.geo = view.geo;
    this.eigenaar = view.eigenaar;
    this.glad = null;
    this.vorigNu = -1;
    this.vorigLz = null;
    this.zoomVaart = 0;
    this.maan = null;
    this.bouwSig = null;
    this.soortInfo.clear();
    const geo = this.geo, n = geo.tegels.length;
    this.droog = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.straat = new Uint8Array(n);
    this.bebouwd = new Uint8Array(n);
    this.vuil = new Float32Array(n);
    this.vuilBron = new Float32Array(n);
    this.vuilMax = 0;
    for (const t of geo.tegels) {
      if (t.terrein === 'water') this.water[t.i] = 1;
      else this.droog[t.i] = (t.terrein === 'vlakte' && hash(t.i, 41) < 0.55) || t.terrein === 'kust' ? 1 : 0;
    }
    this.waterBron = undefined;
    this.werkWater(view);
  }

  // Mist en rijp hangen af van het water: rivieren en meren uit de terreinlaag (als die er is), zee en kust uit de
  // tegels. Opnieuw zodra de terreinlaag zijn water (later) heeft uitgerekend.
  werkWater(view) {
    const tl = view.terreinLaag, basis = tl && tl.basis ? tl.basis : null;
    if (basis === this.waterBron) return;
    this.waterBron = basis;
    const geo = this.geo, n = geo.tegels.length, T = geo.T;
    const M = (this.mistKans = new Float32Array(n));
    const MX = (this.mistX = new Float32Array(n)), MY = (this.mistY = new Float32Array(n)), MH = (this.mistHoek = new Float32Array(n));
    const open = (this.open = new Float32Array(n));
    // rivieren: per tegel het rivierpunt het dichtst bij het midden en de richting van de rivier daar
    const rivD = new Float32Array(n).fill(Infinity);
    if (basis) {
      const rivs = tl.rivieren;
      for (let ri = 0; ri < rivs.length; ri++) {
        const p = rivs[ri].pts;
        for (let i = 0; i + 1 < p.length; i += 2) {
          const k = Math.floor(p[i] / T), r = Math.floor(p[i + 1] / T);
          if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
          const ti = r * geo.kol + k, tg = geo.tegels[ti];
          const d = (p[i] - tg.x) ** 2 + (p[i + 1] - tg.y) ** 2;
          if (d >= rivD[ti]) continue;
          rivD[ti] = d;
          const a = Math.max(0, i - 4), b = Math.min(p.length - 2, i + 4);
          MX[ti] = p[i]; MY[ti] = p[i + 1]; MH[ti] = Math.atan2(p[b + 1] - p[a + 1], p[b] - p[a]);
        }
      }
    }
    const meren = basis ? tl.meren : GEEN;
    for (const t of geo.tegels) {
      const ti = t.i;
      let kans = 0, mx = t.x, my = t.y, hoek = NaN;
      let wx = 0, wy = 0, nw = 0, som = 0, m = 0, hoger = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
        if (!dr && !dk) continue;
        const k = t.k + dk, r = t.r + dr;
        if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
        const b = geo.tegels[r * geo.kol + k];
        if (b.terrein === 'water') { wx += dk; wy += dr; nw++; } else { som += b.hoogte; m++; if (b.hoogte > t.hoogte + 0.015) hoger++; }
      }
      // open zee blijft helder: de kustmist hoort bij de landtegels langs het water
      if (t.terrein !== 'water') {
        if (nw) {
          // een smalle strook op de echte kustlijn, evenwijdig eraan: vanaf het midden van de tegel naar het water toe
          // tot de eerste waterpixel
          const l = Math.hypot(wx, wy) || 1, ux = wx / l, uy = wy / l;
          let f = 0.45;
          for (let q = 1; q <= 10; q++) if (this.isWater(t.x + ux * T * q * 0.1, t.y + uy * T * q * 0.1)) { f = q * 0.1; break; }
          kans = 0.5; mx = t.x + ux * T * f; my = t.y + uy * T * f; hoek = Math.atan2(uy, ux) + Math.PI / 2;
        }
        // dal: lager dan (bijna) alle buren; gewoon laag land is geen dal
        if (t.terrein !== 'berg' && m >= 5 && hoger >= m - 1) {
          const dal = smooth(0.025, 0.08, som / m - t.hoogte) * 0.65;
          if (dal > kans) { kans = dal; mx = t.x; my = t.y; hoek = NaN; }
        }
        // boven rivieren en meren het dichtst, als lint langs de rivier
        if (rivD[ti] < T * T * 0.5) { const rk = t.terrein === 'berg' ? 0.5 : 0.85; if (rk > kans) { kans = rk; mx = MX[ti]; my = MY[ti]; hoek = MH[ti]; } }
        for (let i = 0; i < meren.length; i++) {
          const mr = meren[i], d = Math.hypot(t.x - mr.x, t.y - mr.y);
          if (d < mr.r + T * 0.4 && kans < 0.85) { kans = 0.85; const f = Math.min(1, mr.r / Math.max(d, 1e-6)) * 0.6; mx = mr.x + (t.x - mr.x) * f; my = mr.y + (t.y - mr.y) * f; hoek = NaN; }
        }
        kans *= 1 - 0.6 * smooth(0.6, 0.8, t.hoogte);
        open[ti] = t.terrein === 'vlakte' ? 1 : t.terrein === 'kust' ? 0.85 : t.terrein === 'berg' || t.terrein === 'bos' ? 0.45 : 0;
      }
      M[ti] = kans; MX[ti] = mx; MY[ti] = my; MH[ti] = hoek;
    }
    // rijpkaart: 6×6 cellen per tegel, nul boven zee, meren en rivieren en vlak langs de oever (de kust en de rivieren
    // zijn zo preciezer dan een hele tegel, en een rivier krijgt geen witte rand over het water)
    const R = RIJP, KW = geo.kol * R, KH = geo.rij * R, cel = T / R;
    const rb = (this.rijpBasis = new Float32Array(KW * KH));
    const vol = (this.volRijp = new Uint8Array(n).fill(1));
    for (let sy = 0; sy < KH; sy++) {
      for (let sx = 0; sx < KW; sx++) {
        const x = (sx + 0.5) * cel, y = (sy + 0.5) * cel, ti = Math.floor(sy / R) * geo.kol + Math.floor(sx / R);
        let e = open[ti];
        if (e > 0 && (this.isWater(x, y) || (basis && (tl.isZoetWater(x, y) || tl.rivierAfstand(x, y) < cel * 0.6)))) e = 0;
        rb[sy * KW + sx] = e;
        if (e < 0.8) vol[ti] = 0;
      }
    }
    this.rijpVies = true;
  }

  isWater(x, y) {
    const e = this.eigenaar;
    if (!e) return false;
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= 1000 || py >= 620) return true;
    return e[py * 1000 + px] === -1;
  }

  // Wat een gebouwsoort voor de sfeer betekent (een keer per soort uitgezocht).
  info(id) {
    let v = this.soortInfo.get(id);
    if (!v) {
      const g = this.state.pack.gebouwIndex[id];
      const tek = g ? g.tekening ?? ALIAS[g.id] ?? g.id : '';
      v = {
        nr: this.soortInfo.size + 1,
        woon: tek === 'woonwijk' ? 1 : 0,
        // zoals tekenNacht in map.js: woonwijken gloeien, economie en maatschappij een beetje
        licht: g && g.woningen ? 1 : g && (g.kapitaalvoorraad || g.handel_bonus || g.categorie === 'maatschappij') ? 2 : 0,
        vuil: g ? g.vervuiling ?? VERVUILING[tek] ?? 0 : 0,
        knoop: g && g.knooppunt ? 1 : 0,
      };
      this.soortInfo.set(id, v);
    }
    return v;
  }

  isWoonwijk(id) { return this.info(id).woon; }

  // Waar staat wat? Straten (hoofdsteden en woonwijken, het straatcontract uit de spec), bebouwde tegels, vuile lucht,
  // lichtsnoeren langs de wegen en lichtkernen. Alleen herberekenen als er gebouwd of gesloopt is: de handtekening telt
  // tegel én soort van elke plaatsing mee, dus ook een woonwijk die op dezelfde tegel door iets anders vervangen wordt.
  werkBebouwing() {
    const s = this.state;
    let sig = s.landen.length | 0;
    for (let i = 0; i < s.landen.length; i++) {
      const pl = s.landen[i].plaatsingen;
      for (let j = 0; j < pl.length; j++) { const p = pl[j]; sig = (Math.imul(sig, 31) + (p.t + 2) * 131 + this.info(p.g).nr) | 0; }
    }
    const ko = s.kolonies || GEEN;
    for (let i = 0; i < ko.length; i++) sig = (Math.imul(sig, 31) + ko[i].t + 3) | 0;
    if (sig === this.bouwSig) return;
    this.bouwSig = sig;
    const geo = this.geo, St = this.straat, B = this.bebouwd, bron = this.vuilBron, V = this.vuil, P = this.lichtPunt, SN = this.snoer;
    St.fill(0); B.fill(0); bron.fill(0);
    let nL = 0, nS = 0;
    const licht = (t, r, soort, idx) => {
      if (nL >= MAX_LICHT) return;
      const tg = geo.tegels[t];
      P[nL * 5] = tg.x; P[nL * 5 + 1] = tg.y; P[nL * 5 + 2] = r; P[nL * 5 + 3] = soort; P[nL * 5 + 4] = idx; nL++;
    };
    // de lichtkernen op volgorde van belang: bij het plafond vallen dan alleen de kleine lichtjes weg
    for (const land of s.landen) {
      const h = geo.hoofdstad[land.idx];
      if (h != null && h >= 0) { St[h] = 2; B[h] = 1; licht(h, 0, 0, land.idx); }
    }
    for (const land of s.landen) {
      for (const p of land.plaatsingen) {
        if (p.t < 0) continue;
        const inf = this.info(p.g);
        B[p.t] = 1;
        if (inf.woon && St[p.t] !== 2) St[p.t] = 1;
        if (inf.licht === 1) licht(p.t, 1.15, 1, land.idx);
      }
    }
    for (const k of ko) { if (k.t >= 0) { B[k.t] = 1; licht(k.t, 0.8, 3, 0); } }
    // Meer kleine lichtjes of snoeren dan er plek is? Dan gelijkmatig uitdunnen op de hash van de tegel. Zonder dit vult
    // het plafond zich land voor land en blijven juist de laatste landen in de lijst helemaal zonder lichtsnoeren.
    let n2 = 0, nW = 0;
    for (const land of s.landen) for (const p of land.plaatsingen) if (p.t >= 0) { nW++; if (this.info(p.g).licht === 2) n2++; }
    const f2 = n2 ? Math.min(1, ((MAX_LICHT - nL) * 0.95) / n2) : 1, fS = nW ? Math.min(1, (PLAFOND.snoeren * 0.95) / nW) : 1;
    for (const land of s.landen) {
      // vuile lucht: hoe meer zware industrie een land heeft, hoe vuiler de lucht boven elke fabriek
      let tot = 0;
      for (const id in land.gebouwen) tot += (land.gebouwen[id] || 0) * this.info(id).vuil;
      const lf = smooth(1.5, 12, tot);
      // wegen van elk gebouw naar het dichtstbijzijnde knooppunt, zoals tekenWegen en knooppuntVoor in map.js
      const h = geo.hoofdstad[land.idx], knopen = h != null && h >= 0 ? [h] : [];
      for (const p of land.plaatsingen) if (p.t >= 0 && this.info(p.g).knoop) knopen.push(p.t);
      for (const p of land.plaatsingen) {
        if (p.t < 0) continue;
        const inf = this.info(p.g);
        if (inf.vuil) bron[p.t] += inf.vuil * lf;
        if (inf.licht === 2 && (f2 >= 1 || hash(p.t, 227) < f2)) licht(p.t, 0.7, 2, land.idx);
        if (nS >= PLAFOND.snoeren || (fS < 1 && hash(p.t, 229) >= fS)) continue;
        const a = geo.tegels[p.t];
        let best = -1, bd = Infinity;
        for (let i = 0; i < knopen.length; i++) {
          const n = knopen[i], b = geo.tegels[n];
          if (!b || n === p.t) continue;
          const d = (a.k - b.k) ** 2 + (a.r - b.r) ** 2;
          if (d < bd) { bd = d; best = n; }
        }
        if (best < 0) continue;
        const b = geo.tegels[best];
        SN[nS * 4] = a.x; SN[nS * 4 + 1] = a.y; SN[nS * 4 + 2] = b.x; SN[nS * 4 + 3] = b.y; nS++;
      }
    }
    this.nLicht = nL; this.nSnoer = nS;
    // de vuile lucht waait twee tegels uit; boven bos is de lucht schoner
    let vmax = 0;
    for (const t of geo.tegels) {
      let v = 0, bos = 0, nb = 0;
      for (let dr = -2; dr <= 2; dr++) for (let dk = -2; dk <= 2; dk++) {
        const k = t.k + dk, r = t.r + dr;
        if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
        const bi = r * geo.kol + k, d = Math.max(Math.abs(dk), Math.abs(dr));
        v += bron[bi] * (d === 0 ? 0.55 : d === 1 ? 0.32 : 0.12);
        if (d === 1) { nb++; if (geo.tegels[bi].terrein === 'bos') bos++; }
      }
      v = Math.min(1, v * (1 - 0.5 * (nb ? bos / nb : 0)));
      V[t.i] = v;
      if (v > vmax) vmax = v;
    }
    this.vuilMax = vmax;
    this.rijpVies = true;
  }

  // Publiek voor andere lagen: hoe vuil de lucht boven een tegel is (0..1) en hoe vaak er mist hangt (0..1).
  vervuilingOp(ti) { return this.vuil[ti] || 0; }
  mistKansOp(ti) { return this.mistKans[ti] || 0; }

  // Hoeveel water-, land- en droge tegels zijn er in beeld? Voor het uitdunnen tegen de plafonds. Gerekend over de tegels
  // die het beeld raken, maal het deel daarvan dat echt in beeld valt (de randtegels steken half buiten beeld).
  telZicht() {
    const geo = this.geo, W = this.water, D = this.droog, St = this.straat;
    let w = 0, l = 0, d = 0;
    for (let r = this.rV0; r <= this.rV1; r++) {
      for (let k = this.kV0; k <= this.kV1; k++) {
        const ti = r * geo.kol + k;
        if (W[ti]) w++; else { l++; if (D[ti] && !St[ti]) d++; }
      }
    }
    this.nWater = w; this.nLand = l; this.nDroog = d;
    const n = (this.kV1 - this.kV0 + 1) * (this.rV1 - this.rV0 + 1);
    const bw = Math.min(this.wx1, geo.kol * geo.T) - Math.max(this.wx0, 0), bh = Math.min(this.wy1, geo.rij * geo.T) - Math.max(this.wy0, 0);
    this.zichtFactor = n > 0 ? clamp((bw * bh) / (geo.T * geo.T * n), 0, 1) : 1;
  }

  inBeeld(x, y, r) { return x + r >= 0 && y + r >= 0 && x - r <= this.w && y - r <= this.h; }

  // Zichtbaar deel van de wereld, in tegels met een marge.
  kader(view, sc) {
    const geo = this.geo;
    this.sc = sc;
    this.T = geo.T * sc;
    this.w = view.w; this.h = view.h;
    this.dpr = view.dpr || 1;
    this.ox = view.w / 2 - view.cx * sc;
    this.oy = view.h / 2 - view.cy * sc;
    this.wx0 = view.cx - view.w / 2 / sc; this.wx1 = view.cx + view.w / 2 / sc;
    this.wy0 = view.cy - view.h / 2 / sc; this.wy1 = view.cy + view.h / 2 / sc;
    // tegels die het beeld raken, en met een marge van één tegel voor wat er net buiten begint
    this.kV0 = clamp(Math.floor(this.wx0 / geo.T), 0, geo.kol - 1); this.kV1 = clamp(Math.floor(this.wx1 / geo.T), 0, geo.kol - 1);
    this.rV0 = clamp(Math.floor(this.wy0 / geo.T), 0, geo.rij - 1); this.rV1 = clamp(Math.floor(this.wy1 / geo.T), 0, geo.rij - 1);
    this.k0 = Math.max(0, this.kV0 - 1); this.k1 = Math.min(geo.kol - 1, this.kV1 + 1);
    this.r0 = Math.max(0, this.rV0 - 1); this.r1 = Math.min(geo.rij - 1, this.rV1 + 1);
  }

  // Het weer van dit moment, gladgestreken zodat een nieuwe speldag niet ineens een andere lucht geeft.
  bijwerken(view, nu, frac) {
    const s = view.state;
    const dt = this.vorigNu < 0 ? 0 : clamp((nu - this.vorigNu) / 1000, 0, 0.1);
    this.vorigNu = nu;
    const dagF = s.dag + clamp(frac, 0, 0.999);
    const sz = seizoen(s.dag);
    const wd = wind(dagF);
    const w = weer(dagF, view.cx, view.cy);
    const gisteren = weer(dagF - 1, view.cx, view.cy);
    const doel = {
      wolken: w.wolken, regen: w.regen, sneeuw: w.sneeuw, onweer: w.onweer, mist: w.mist,
      nat: Math.max(w.regen, gisteren.regen * 0.6, w.sneeuw * 0.3),
      hoek: wd.hoek, kracht: wd.kracht,
    };
    if (!this.glad || !dt) { if (!this.glad) this.glad = { ...doel }; }
    else {
      const k = 1 - Math.exp(-dt * 1.2);
      for (const key in doel) this.glad[key] += (doel[key] - this.glad[key]) * k;
    }
    const g = this.glad;
    // wolken drijven mee met de wind; de snelheid is in wereldeenheden per seconde
    const v = 0.6 + 2.2 * g.kracht;
    this.drift.x += Math.cos(g.hoek) * v * dt;
    this.drift.y += Math.sin(g.hoek) * v * dt;
    // hoe hard er gezoomd wordt: daarvan hangen de lage flarden af (je vliegt erdoorheen)
    const lz = Math.log(Math.max(1, view.zoom || 1));
    if (dt > 0 && this.vorigLz !== null) {
      const vz = Math.min(4, Math.abs(lz - this.vorigLz) / dt);
      this.zoomVaart += (vz - this.zoomVaart) * (1 - Math.exp(-dt * 4));
    }
    this.vorigLz = lz;
    const { fase, licht, nacht } = dagLicht(nu);
    const avond = fase < 0.5;
    const gouden = smooth(0.46, 0.56, licht) * (1 - smooth(0.6, 0.76, licht));
    const laagZon = smooth(0.5, 0.56, licht) * (1 - smooth(0.62, 0.8, licht));
    const blauw = smooth(0.26, 0.38, licht) * (1 - smooth(0.44, 0.54, licht));
    const ochtend = smooth(0.7, 0.78, fase) * (1 - smooth(0.9, 0.98, fase));
    const dag = smooth(0.42, 0.66, licht);
    // mist trekt op in de tweede helft van de nacht, is het dichtst bij zonsopgang en is laat in de ochtend weg
    const mistTijd = smooth(0.55, 0.78, fase) * (1 - smooth(0.9, 0.99, fase));
    // rijp op koude, heldere nachten tot in de ochtend (onder sneeuw zie je hem niet); dauw op lente- en zomerochtenden
    const koudF = smooth(0.42, 0.66, sz.koud) * (1 - smooth(0.45, 0.85, sz.sneeuw));
    const helder = (1 - 0.85 * g.wolken) * (1 - smooth(0.05, 0.3, g.regen + g.sneeuw));
    const rijp = koudF * smooth(0.3, 0.55, fase) * (1 - smooth(0.88, 0.97, fase)) * helder;
    const dauw = (sz.lente + 0.8 * sz.zomer) * (1 - koudF) * smooth(0.74, 0.8, fase) * (1 - smooth(0.88, 0.95, fase)) * helder;
    // De maan staat een hele nacht stil. Een nacht op de kaart duurt anderhalve minuut en daarin gaan (bij tempo 1 tot 8)
    // 90 tot 720 speldagen voorbij: met de stand van elke speldag zou de nacht om de paar seconden van volle naar nieuwe
    // maan en terug flakkeren. De stand van de speldag waarop de nacht begint, blijft staan tot het weer dag is.
    if (!this.maan || nacht <= 0) this.maan = maanStand(dagF);
    const maan = this.maan;
    // regenboog na een bui: gisteren nat, nu bijna droog, zon erbij; niet elke dag
    const boog = hash(s.dag, 91) < 0.65 ? dag * (1 - gouden * 0.5) * smooth(0.12, 0.35, gisteren.regen) * (1 - smooth(0.06, 0.2, g.regen)) * (1 - smooth(0.6, 0.95, g.wolken)) : 0;
    this.stemming = {
      dag: s.dag, dagF, seizoen: sz, wolken: g.wolken, regen: g.regen, sneeuw: g.sneeuw, onweer: g.onweer, mist: g.mist, nat: g.nat,
      windHoek: g.hoek, windKracht: g.kracht, fase, licht, nacht, dagLicht: dag, gouden, laagZon, blauw, ochtend, avond, regenboog: boog, flits: 0,
      maan: maan.licht, maanFase: maan.fase, maanLicht: maan.licht * (1 - 0.85 * g.wolken), mistTijd, rijp, dauw, doorvlucht: this.zoomVaart,
    };
    return this.stemming;
  }

  telNul() { for (const k in this.tel) this.tel[k] = 0; }
  telling() { return { ...this.tel }; }

  // ---------- vlakken ----------

  // Een leeg vlak (canvas op een kwart van de schermresolutie) om vormen met volle dekking in te tekenen; de
  // transformatie staat zo dat er in schermpixels getekend wordt. Elke vorm meldt met bijVlak waar hij ligt, zodat
  // eindVlak alleen dat stuk over het beeld legt (mist en smog liggen vaak maar op een deel van het scherm).
  beginVlak(nr) {
    const bw = Math.ceil(this.w / VLAK) + 1, bh = Math.ceil(this.h / VLAK) + 1;
    let v = this.vlakken[nr];
    if (!v || v.w !== bw || v.h !== bh) {
      const cv = maakCanvas(bw, bh);
      v = this.vlakken[nr] = { cv, c: cv.getContext('2d'), w: bw, h: bh };
    }
    const bc = v.c;
    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.globalAlpha = 1;
    bc.globalCompositeOperation = 'source-over';
    bc.clearRect(0, 0, bw, bh);
    bc.setTransform(1 / VLAK, 0, 0, 1 / VLAK, 0, 0);
    v.x0 = v.y0 = Infinity; v.x1 = v.y1 = -Infinity;
    return bc;
  }

  // Een vorm in het vlak rond (x, y) in schermpixels, met r minstens de halve breedte en hoogte (ook gedraaid).
  bijVlak(nr, x, y, r) {
    const v = this.vlakken[nr];
    if (x - r < v.x0) v.x0 = x - r;
    if (y - r < v.y0) v.y0 = y - r;
    if (x + r > v.x1) v.x1 = x + r;
    if (y + r > v.y1) v.y1 = y + r;
  }

  // Het vlak in één keer over het beeld, met dekking A (gewoon mengen: goedkoop).
  eindVlak(c, nr, A) {
    const v = this.vlakken[nr];
    // alleen het stuk waar iets getekend is, met een lege pixel marge (het bijmengen aan de rand blijft dan gelijk)
    const x0 = clamp(Math.floor(v.x0 / VLAK) - 1, 0, v.w), y0 = clamp(Math.floor(v.y0 / VLAK) - 1, 0, v.h);
    const x1 = clamp(Math.ceil(v.x1 / VLAK) + 1, 0, v.w), y1 = clamp(Math.ceil(v.y1 / VLAK) + 1, 0, v.h);
    if (x1 <= x0 || y1 <= y0) return;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = A;
    c.drawImage(v.cv, x0, y0, x1 - x0, y1 - y0, x0 * VLAK, y0 * VLAK, (x1 - x0) * VLAK, (y1 - y0) * VLAK);
    this.tel.vlakken++;
  }

  // ---------- grondniveau ----------

  tekenGrond(c, view, sc, nu, frac = 1) {
    const s = view.state;
    if (!s || !view.geo || !view.w) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar) this.laad(view);
    else this.werkWater(view);
    this.sprites ??= bakSprites();
    this.telNul();
    const st = this.bijwerken(view, nu, frac);
    this.kader(view, sc);
    const z = view.zoom;
    // in de bouwmodus moet het bouwraster leesbaar blijven: mist, smog en lage flarden wijken dan grotendeels
    const rust = view.bouwModus ? 0.3 : 1;
    this.werkBebouwing();
    if (z >= 2.5) this.telZicht(); // de mist (vanaf 2,5) dunt ook uit met zichtFactor: anders rekent hij met die van een vorig beeld
    c.save();
    if (z >= 2.8) this.tekenRijp(c, st, z);
    if (z >= 2.4) this.tekenSchaduwen(c, st, z);
    if (z >= 2.5) this.tekenMist(c, st, nu, smooth(2.5, 3.5, z) * rust);
    if (z >= 2.6 && z < 9) this.tekenSmog(c, st, smooth(2.6, 3.4, z) * (1 - smooth(6.5, 9, z)) * rust);
    if (z >= 3) this.tekenGlinster(c, st, nu, smooth(3, 4, z));
    if (z >= 3 && st.windKracht > 0.45) this.tekenVlagen(c, st, nu, smooth(3, 4, z));
    if (z >= 4.5 && st.regen > 0.04) this.tekenKringen(c, st, nu, smooth(4.5, 5.5, z));
    if (z >= 5 && st.nat > 0.08) this.tekenNat(c, st, nu, smooth(5, 6, z));
    if (z >= 6) this.tekenTrilling(c, st, nu, smooth(6, 7, z));
    if (z >= 6) this.tekenHoosjes(c, st, nu, smooth(6, 7, z));
    if (z >= 5) this.tekenStuif(c, st, nu, smooth(5, 6.5, z));
    if (z >= 4.5 && z < 10) this.tekenPollen(c, st, nu, smooth(4.5, 5.5, z) * (1 - smooth(8, 10, z)));
    this.tekenKleur(c, st, z);
    c.restore();
  }

  // Rijp: op koude, heldere ochtenden een witte waas over gras en akkers (niet in de stad, niet op het water), die
  // rond het middaguur wegsmelt. Diep ingezoomd losse korreltjes, per tegel op een eigen moment weggesmolten.
  tekenRijp(c, st, z) {
    const r = st.rijp;
    if (r < 0.02 || !this.rijpBasis.length) return;
    const geo = this.geo, sc = this.sc;
    const glans = r * 0.24 * smooth(2.8, 3.6, z) * (1 - 0.55 * smooth(8, 12, z));
    if (glans > 0.006) {
      if (this.rijpVies) this.bouwRijpKaart();
      const R = RIJP, cel = geo.T / R, KW = geo.kol * R, KH = geo.rij * R;
      const sx0 = clamp(Math.floor(this.wx0 / cel) - 1, 0, KW - 1), sx1 = clamp(Math.ceil(this.wx1 / cel) + 1, sx0 + 1, KW);
      const sy0 = clamp(Math.floor(this.wy0 / cel) - 1, 0, KH - 1), sy1 = clamp(Math.ceil(this.wy1 / cel) + 1, sy0 + 1, KH);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = glans;
      c.drawImage(this.rijpKaart, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 * cel * sc + this.ox, sy0 * cel * sc + this.oy, (sx1 - sx0) * cel * sc, (sy1 - sy0) * cel * sc);
      this.tel.rijp++;
    }
    if (z < 8.5) return;
    const korrel = r * 0.8 * smooth(8.5, 10, z), T = this.T, spr = this.sprites.rijpKorrel;
    if (korrel < 0.02) return;
    c.globalCompositeOperation = 'source-over'; // ook als de waas hierboven te zwak was om te tekenen
    for (let rr = this.rV0; rr <= this.rV1; rr++) {
      for (let k = this.kV0; k <= this.kV1; k++) {
        const ti = rr * geo.kol + k;
        if (!this.volRijp[ti] || this.bebouwd[ti]) continue;
        // smelten: in de ochtend (fase 0,86 tot 0,98) per tegel op een eigen moment
        const m0 = 0.86 + 0.09 * hash(ti, 171);
        const smelt = st.fase > 0.6 ? 1 - smooth(m0, m0 + 0.03, st.fase) : 1;
        if (smelt < 0.03) continue;
        const tg = geo.tegels[ti], x = (tg.x - geo.T / 2) * sc + this.ox, y = (tg.y - geo.T / 2) * sc + this.oy;
        if (x > this.w || y > this.h || x + T < 0 || y + T < 0) continue;
        if (this.tel.rijp >= PLAFOND.rijp) return;
        c.globalAlpha = korrel * smelt;
        c.drawImage(spr, x, y, T, T);
        this.tel.rijp++;
      }
    }
  }

  // De rijpkaart opnieuw vullen (na laden en na bouwen): wit, met als dekking waar rijp kan liggen.
  bouwRijpKaart() {
    const geo = this.geo, R = RIJP, KW = geo.kol * R, KH = geo.rij * R;
    if (!this.rijpKaart || this.rijpKaart.width !== KW || this.rijpKaart.height !== KH) {
      this.rijpKaart = maakCanvas(KW, KH);
      this.rijpCtx = this.rijpKaart.getContext('2d');
      this.rijpBeeld = this.rijpCtx.createImageData(KW, KH);
    }
    const d = this.rijpBeeld.data, rb = this.rijpBasis, St = this.straat, B = this.bebouwd;
    for (let sy = 0; sy < KH; sy++) {
      for (let sx = 0; sx < KW; sx++) {
        const i = sy * KW + sx, ti = Math.floor(sy / R) * geo.kol + Math.floor(sx / R);
        const e = rb[i] * (St[ti] ? 0 : B[ti] ? 0.2 : 1);
        d[i * 4] = 238; d[i * 4 + 1] = 244; d[i * 4 + 2] = 251; d[i * 4 + 3] = (e * 255) | 0;
      }
    }
    this.rijpCtx.putImageData(this.rijpBeeld, 0, 0);
    this.rijpVies = false;
  }

  // Wolkenschaduwen: losse, scherp begrensde maar zachte schaduwen die met de wind over het land trekken, het
  // duidelijkst bij half bewolkt. Bij een dicht wolkendek is er geen zon meer om schaduw te werpen: dan dempt
  // tekenKleur het licht gelijkmatig. Bij laagstaande zon rekken de schaduwen uit tot lange banden naar het zuidoosten.
  tekenSchaduwen(c, st, z) {
    const half = smooth(0.05, 0.28, st.wolken) * (1 - smooth(0.6, 0.86, st.wolken));
    const zon = 1 - st.nacht + st.nacht * st.maanLicht * 0.4; // 's nachts alleen bij volle maan een vage schaduw
    const A = 0.18 * half * zon * smooth(2.4, 3.2, z) * (1 - 0.5 * st.regen);
    if (A < 0.006) return;
    const bc = this.beginVlak(0), voor = this.tel.schaduwen;
    const k = 1.5 * st.laagZon;
    // diep ingezoomd is een grote wolkenschaduw breder dan het beeld: dan wordt hij een zachte demping en tekenen de
    // kleine stapelwolkjes de losse schaduwen
    this.schaduwLaag(bc, st, GROOT, 0, 1 - 0.6 * smooth(6, 10, z), k);
    if (z >= 4.5) this.schaduwLaag(bc, st, KLEIN, 1, smooth(4.5, 6, z), k);
    if (this.tel.schaduwen > voor) this.eindVlak(c, 0, A);
  }

  schaduwLaag(bc, st, G, laag, dek, k) {
    const S = this.sprites.vorm, sc = this.sc, MAX = PLAFOND.schaduwen, V = 1 / VLAK;
    const dx = this.drift.x * (laag ? 1.3 : 1), dy = this.drift.y * (laag ? 1.3 : 1);
    // een uitgerekte schaduw valt verder naar het zuidoosten: dan ook cellen verder naar het noordwesten bekijken
    const extra = k * G;
    const i0 = Math.floor((this.wx0 - dx - extra) / G) - 1, i1 = Math.floor((this.wx1 - dx) / G) + 1;
    const j0 = Math.floor((this.wy0 - dy - extra) / G) - 1, j1 = Math.floor((this.wy1 - dy) / G) + 1;
    const a = 1 + k / 2, b2 = k / 2;
    bc.globalAlpha = dek;
    if (k <= 0.02) bc.setTransform(V, 0, 0, V, 0, 0);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (this.tel.schaduwen >= MAX) return;
        const p = hash(i, j, 77 + laag);
        if (p > DEKKING) continue;
        // het plaatselijke weer kan de bewolking alleen verlagen: wat hier al afvalt, hoeft weer() niet te vragen
        if (p > (laag ? st.wolken * 0.4 : Math.max(st.wolken, 0.12) * DEKKING)) continue;
        const wx = (i + hash(i, j, 3)) * G + dx, wy = (j + hash(i, j, 4)) * G + dy;
        const dicht = weer(st.dagF, wx, wy).wolken * st.wolken;
        // zelfde regel als tekenWolken, zodat elke hoge wolk zijn eigen schaduw heeft
        if (p > (laag ? dicht * 0.4 : Math.max(dicht, 0.12) * DEKKING)) continue;
        // de grote schaduwen liggen waar de hoge wolken ze op lage zoom werpen (14, 18 naar het zuidoosten)
        const b = G * (1.1 + hash(i, j, 5) * 0.7) * sc * (laag ? 1 : 0.8), h = b * 0.5;
        const ver = k * G * 0.3;
        const x = (wx + (laag ? 0 : 14) + ver) * sc + this.ox, y = (wy + (laag ? 0 : 18) + ver) * sc + this.oy;
        const rr = (b / 2) * (1 + k);
        if (x + rr < 0 || y + rr < 0 || x - rr > this.w || y - rr > this.h) continue;
        const spr = S[mod(i * 7 + j * 3, 3)];
        if (k > 0.02) {
          // uitrekken langs de lijn noordwest-zuidoost (symmetrische matrix: de vorm draait niet)
          bc.setTransform(V * a, V * b2, V * b2, V * a, x * V, y * V);
          bc.drawImage(spr, -b / 2, -h / 2, b, h);
        } else bc.drawImage(spr, x - b / 2, y - h / 2, b, h);
        this.bijVlak(0, x, y, rr);
        this.tel.schaduwen++;
      }
    }
  }

  // Mist: alleen boven rivieren, meren en langs de kust en in dalen, vooral 's ochtends, in dunne banken langs het
  // water. Niet boven de stad (daar is het warmer) en niet over het open land. In een vlak, zodat banken die over
  // elkaar vallen niet optellen tot een witte waas.
  tekenMist(c, st, nu, a) {
    const sz = st.seizoen;
    const seizoensKans = clamp(0.3 + 0.7 * (sz.herfst + 0.8 * sz.winter + 0.35 * sz.lente), 0, 1);
    const sterkte = clamp(st.mistTijd * seizoensKans + st.mist * (0.2 + 0.6 * st.mistTijd), 0, 1) * (1 - st.regen) * (1 - 0.55 * smooth(0.45, 0.95, st.windKracht));
    const A = a * sterkte * 0.25 * (1 - 0.45 * st.nacht);
    if (A < 0.008) return;
    const geo = this.geo, sc = this.sc, S = this.sprites.mist, MAX = PLAFOND.mist, M = this.mistKans, St = this.straat, B = this.bebouwd;
    const per = this.T > 90 ? 2 : 1;
    // veel tegels in beeld: om de andere tegel een dubbel zo lange bank. Geteld zonder de afkapping aan de rand van
    // de wereld, anders springt de mist naar een ander patroon zodra je naar de rand schuift
    const stap = ((this.wx1 - this.wx0) / geo.T + 3) * ((this.wy1 - this.wy0) / geo.T + 3) > 140 ? 2 : 1;
    const kansOp = (ti) => M[ti] * (St[ti] ? 0 : B[ti] ? 0.5 : 1);
    // verwacht aantal banken in beeld; zijn het er te veel, dan gelijkmatig uitdunnen en de overgebleven banken iets
    // langer maken, zodat de mist bij het water blijft in plaats van alleen in de bovenste rijen
    let som = 0;
    for (let r = this.rV0; r <= this.rV1; r++) for (let k = this.kV0; k <= this.kV1; k++) { const v = kansOp(r * geo.kol + k); if (v >= 0.2) som += v; }
    const b0 = geo.T * (per > 1 ? 1.25 : 1.8) * stap * sc;
    const rand = ((this.w + b0) * (this.h + b0 * 0.25)) / (this.w * this.h);
    const f = dun((som * this.zichtFactor * rand * 0.9 * per) / (stap * stap), MAX);
    const groei = Math.min(1.4, 1 / Math.sqrt(f));
    const b = b0 * groei, h = b * 0.2;
    // een lange bank van net buiten beeld steekt er een eind in: ruimere marge, en alleen banken in beeld tellen mee
    const m = stap + 1;
    const rA = Math.max(0, this.r0 - m), rB = Math.min(geo.rij - 1, this.r1 + m);
    const kA = Math.max(0, this.k0 - m), kB = Math.min(geo.kol - 1, this.k1 + m);
    const t = nu / 1000, V = 1 / VLAK;
    let bc = null;
    for (let r = rA - (rA % stap); r <= rB; r += stap) {
      for (let k = kA - (kA % stap); k <= kB; k += stap) {
        const ti = r * geo.kol + k, kans = kansOp(ti);
        if (kans < 0.2) continue;
        let hoek = this.mistHoek[ti];
        if (hoek !== hoek) hoek = st.windHoek; // NaN: in dalen en boven meren met de wind mee
        for (let j = 0; j < per; j++) {
          if (hash(ti, j, 61) > kans * 0.9 * f) continue;
          const hj = hoek + (hash(ti, j, 65) - 0.5) * 0.3, cs = Math.cos(hj), sn = Math.sin(hj);
          // langzaam heen en weer langs de bank; de tweede bank ligt verderop langs het water
          const langs = Math.sin(t * 0.06 + hash(ti, j, 62) * TAU) * 0.25 * geo.T + (j - (per - 1) / 2) * 0.7 * geo.T;
          const dwars = (hash(ti, j, 64) - 0.5) * 0.18 * geo.T;
          const wx = this.mistX[ti] + cs * langs - sn * dwars, wy = this.mistY[ti] + sn * langs + cs * dwars;
          const x = wx * sc + this.ox, y = wy * sc + this.oy;
          if (x + b / 2 < 0 || y + b / 2 < 0 || x - b / 2 > this.w || y - b / 2 > this.h) continue;
          if (this.tel.mist >= MAX) { if (bc) this.eindVlak(c, 1, A); return; }
          if (!bc) bc = this.beginVlak(1);
          bc.globalAlpha = Math.min(1, 0.35 + 0.75 * kans);
          bc.setTransform(V * cs, V * sn, -V * sn, V * cs, x * V, y * V);
          bc.drawImage(S[(ti + j) & 1], -b / 2, -h / 2, b, h);
          this.bijVlak(1, x, y, b * 0.52); // gedraaid: de hoek van de rechthoek ligt iets verder dan b / 2
          this.tel.mist++;
        }
      }
    }
    if (bc) this.eindVlak(c, 1, A);
  }

  // Smog: een bruinige waas boven landen met veel industrie, mijnen en centrales, met de wind meegetrokken. Regen
  // spoelt hem weg, wind blaast hem uit elkaar, op een windstille winterochtend blijft hij hangen. Boven bos is de
  // lucht schoner. Zichtbaar van zoom 3 tot 8; diep ingezoomd zit je eronder.
  tekenSmog(c, st, a) {
    if (this.vuilMax < 0.05 || a <= 0.01) return;
    const A = a * 0.2 * (1 - 0.7 * st.regen) * (1 - 0.45 * st.windKracht) * (1 + 0.35 * st.seizoen.winter * st.ochtend) * (1 - 0.5 * st.nacht);
    if (A < 0.006) return;
    const geo = this.geo, T = this.T, sc = this.sc, S = this.sprites.smog, Vu = this.vuil, MAX = PLAFOND.smog;
    const stap = T < 75 ? 2 : 1, m = 2 + stap;
    const wdx = Math.cos(st.windHoek) * st.windKracht * 0.7 * geo.T, wdy = Math.sin(st.windHoek) * st.windKracht * 0.7 * geo.T;
    const rA = Math.max(0, this.rV0 - m), rB = Math.min(geo.rij - 1, this.rV1 + m);
    const kA = Math.max(0, this.kV0 - m), kB = Math.min(geo.kol - 1, this.kV1 + m);
    let n = 0;
    for (let r = rA - (rA % stap); r <= rB; r += stap) for (let k = kA - (kA % stap); k <= kB; k += stap) if (Vu[r * geo.kol + k] >= 0.1) n++;
    if (!n) return;
    const f = dun(n, MAX), b = T * 2.4 * stap * Math.min(1.4, 1 / Math.sqrt(f));
    const bc = this.beginVlak(2);
    for (let r = rA - (rA % stap); r <= rB; r += stap) {
      for (let k = kA - (kA % stap); k <= kB; k += stap) {
        const ti = r * geo.kol + k, v = Vu[ti];
        if (v < 0.1 || (f < 1 && hash(ti, 92) > f)) continue;
        const tg = geo.tegels[ti];
        const x = (tg.x + wdx + (hash(ti, 91) - 0.5) * geo.T * 0.4) * sc + this.ox, y = (tg.y + wdy + (hash(ti, 93) - 0.5) * geo.T * 0.4) * sc + this.oy;
        if (x + b / 2 < 0 || y + b / 2 < 0 || x - b / 2 > this.w || y - b / 2 > this.h) continue;
        if (this.tel.smog >= MAX) break;
        bc.globalAlpha = Math.min(1, v * 1.25);
        bc.drawImage(S, x - b / 2, y - b / 2, b, b);
        this.bijVlak(2, x, y, b / 2);
        this.tel.smog++;
      }
    }
    if (this.tel.smog) this.eindVlak(c, 2, A);
  }

  // Zon op het water: twinkelende kruisjes, warm bij het gouden uur. Op koude ochtenden glinstert de rijp op het land,
  // op lente- en zomerochtenden de dauw (alleen diep ingezoomd, op gras en akker).
  tekenGlinster(c, st, nu, a) {
    const zon = st.dagLicht * (1 - 0.85 * st.wolken) * (1 - st.regen);
    const land = this.T > 110 ? Math.max(st.rijp * smooth(0.76, 0.82, st.fase), st.dauw) * 0.7 : 0;
    if ((zon < 0.05 && land < 0.05) || a <= 0.01) return;
    const geo = this.geo, T = this.T, sc = this.sc, MAX = PLAFOND.glinster, O = this.open, B = this.bebouwd;
    const spr = st.gouden > 0.3 ? this.sprites.glinsterWarm : this.sprites.glinster;
    const per = T > 160 ? 3 : T > 70 ? 2 : 1;
    // ongeveer 32% van de plekjes twinkelt op een gegeven moment (sin > 0,55)
    const f = dun(((zon >= 0.05 ? this.nWater : 0) + (land >= 0.05 ? this.nLand : 0)) * this.zichtFactor * per * 0.32, MAX);
    const t = nu / 1000;
    c.globalCompositeOperation = 'lighter';
    for (let r = this.r0; r <= this.r1; r++) {
      for (let k = this.k0; k <= this.k1; k++) {
        const ti = r * geo.kol + k, tg = geo.tegels[ti];
        const water = tg.terrein === 'water';
        const sterk = water ? zon : B[ti] ? 0 : land * O[ti];
        if (sterk < 0.05) continue;
        for (let j = 0; j < per; j++) {
          if (f < 1 && hash(ti, j, 26) > f) continue;
          const fl = Math.sin(t * (1.6 + hash(ti, j, 21) * 2.4) + hash(ti, j, 22) * TAU);
          if (fl < 0.55) continue;
          const wx = tg.x + (hash(ti, j, 23) - 0.5) * geo.T, wy = tg.y + (hash(ti, j, 24) - 0.5) * geo.T;
          const g = Math.max(3, T * (water ? 0.05 : 0.02)) * (0.7 + 0.6 * hash(ti, j, 25));
          const x = wx * sc + this.ox, y = wy * sc + this.oy;
          if (!this.inBeeld(x, y, g) || this.isWater(wx, wy) !== water) continue;
          if (this.tel.glinster >= MAX) { c.globalCompositeOperation = 'source-over'; return; }
          c.globalAlpha = a * sterk * Math.pow((fl - 0.55) / 0.45, 2) * (water ? 0.9 : 0.6);
          c.drawImage(spr, x - g / 2, y - g / 2, g, g);
          this.tel.glinster++;
        }
      }
    }
    c.globalCompositeOperation = 'source-over';
  }

  // Windvlagen: bij harde wind schieten donkere rimpelplekken over het water, in de windrichting.
  tekenVlagen(c, st, nu, a) {
    const sterk = smooth(0.45, 0.85, st.windKracht) * a;
    if (sterk < 0.03) return;
    const sc = this.sc, G = 40, d = this.dpr, spr = this.sprites.vlaag, t = nu / 1000;
    const dx = this.drift.x * 2.5, dy = this.drift.y * 2.5;
    const cs = Math.cos(st.windHoek), sn = Math.sin(st.windHoek);
    const i0 = Math.floor((this.wx0 - dx) / G) - 1, i1 = Math.floor((this.wx1 - dx) / G) + 1;
    const j0 = Math.floor((this.wy0 - dy) / G) - 1, j1 = Math.floor((this.wy1 - dy) / G) + 1;
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (this.tel.vlagen >= PLAFOND.vlagen) break;
        if (hash(i, j, 141) > 0.45) continue;
        const wx = (i + hash(i, j, 142)) * G + dx, wy = (j + hash(i, j, 143)) * G + dy;
        if (!this.isWater(wx, wy)) continue;
        // een vlaag komt op en gaat liggen
        const leef = Math.sin(t * 0.35 + hash(i, j, 144) * TAU);
        if (leef < 0.1) continue;
        const x = wx * sc + this.ox, y = wy * sc + this.oy, b = G * 0.9 * sc, h = b * 0.38;
        if (x + b < 0 || y + b < 0 || x - b > this.w || y - b > this.h) continue;
        c.globalAlpha = sterk * (leef - 0.1) * 0.5;
        c.setTransform(cs * d, sn * d, -sn * d, cs * d, x * d, y * d);
        c.drawImage(spr, -b / 2, -h / 2, b, h);
        this.tel.vlagen++; n++;
      }
    }
    if (n) c.setTransform(d, 0, 0, d, 0, 0);
  }

  // Regen op het water: kringen die uitdijen en vervagen; diep ingezoomd ook spatjes op het land.
  tekenKringen(c, st, nu, a) {
    if (a <= 0.01) return;
    const geo = this.geo, T = this.T, sc = this.sc;
    const per = T > 150 ? 4 : T > 80 ? 2 : 1;
    const t = nu / 1000, W = this.water;
    const kansK = Math.min(1, st.regen * (per > 1 ? 1.4 : 0.6));
    const drempel = kansK * dun(this.nWater * this.zichtFactor * per * kansK, PLAFOND.kringen);
    c.lineWidth = Math.max(0.6, T * 0.004);
    // drie emmers op leeftijd, elk met één pad en één stroke
    for (let emmer = 0; emmer < 3; emmer++) {
      c.beginPath();
      let n = 0;
      for (let r = this.r0; r <= this.r1; r++) {
        for (let k = this.k0; k <= this.k1; k++) {
          const ti = r * geo.kol + k;
          if (!W[ti]) continue;
          const tg = geo.tegels[ti];
          for (let j = 0; j < per; j++) {
            if (hash(ti, j, 31) > drempel) continue;
            const ft = t / 1.1 + hash(ti, j, 32);
            const leeftijd = ft - Math.floor(ft);
            if (Math.min(2, Math.floor(leeftijd * 3)) !== emmer) continue;
            const cyc = Math.floor(ft);
            const wx = tg.x + (hash(ti, j * 31 + cyc, 33) - 0.5) * geo.T, wy = tg.y + (hash(ti, j * 31 + cyc, 34) - 0.5) * geo.T;
            const x = wx * sc + this.ox, y = wy * sc + this.oy, rr = Math.max(1, T * (0.012 + 0.05 * leeftijd));
            if (!this.inBeeld(x, y, rr) || !this.isWater(wx, wy)) continue;
            if (this.tel.kringen >= PLAFOND.kringen) break;
            c.moveTo(x + rr, y); c.arc(x, y, rr, 0, TAU);
            n++; this.tel.kringen++;
          }
        }
      }
      if (!n) continue;
      c.strokeStyle = 'rgba(225,238,248,1)';
      c.globalAlpha = a * (0.55 - emmer * 0.17) * clamp(st.regen * 1.6, 0, 1);
      c.stroke();
    }
    // spatjes op het land (zoom 7+): korte kroontjes van licht
    if (T < 110) return;
    // de helft van de spatjes is op een gegeven moment zichtbaar (f ≤ 0,5)
    const kansS = Math.min(1, st.regen * 1.5);
    const drempelS = kansS * dun(this.nLand * this.zichtFactor * 3 * kansS * 0.5, PLAFOND.spatten);
    c.beginPath();
    for (let r = this.r0; r <= this.r1; r++) {
      for (let k = this.k0; k <= this.k1; k++) {
        const ti = r * geo.kol + k;
        if (W[ti]) continue;
        const tg = geo.tegels[ti];
        for (let j = 0; j < 3; j++) {
          if (hash(ti, j, 35) > drempelS) continue;
          const ft = t / 0.45 + hash(ti, j, 36), cyc = Math.floor(ft), f = ft - cyc;
          if (f > 0.5) continue;
          const wx = tg.x + (hash(ti, j * 17 + cyc, 37) - 0.5) * geo.T, wy = tg.y + (hash(ti, j * 17 + cyc, 38) - 0.5) * geo.T;
          const x = wx * sc + this.ox, y = wy * sc + this.oy, rr = T * (0.006 + 0.012 * f);
          // langs de kust valt een deel van een landtegel in het water: daar maakt de regen kringen, geen spatjes
          if (!this.inBeeld(x, y, rr) || this.isWater(wx, wy)) continue;
          if (this.tel.spatten >= PLAFOND.spatten) break;
          c.moveTo(x + rr, y); c.arc(x, y, rr, 0, TAU);
          this.tel.spatten++;
        }
      }
    }
    if (this.tel.spatten) { c.strokeStyle = 'rgba(235,242,250,1)'; c.globalAlpha = a * 0.45; c.stroke(); }
  }

  // Natte straten: een lichte glans langs het straatkruis en plassen op vaste plekken.
  tekenNat(c, st, nu, a) {
    const geo = this.geo, T = this.T, sc = this.sc;
    const nat = clamp(st.nat * 1.4, 0, 1) * a * (1 - 0.5 * st.seizoen.sneeuw);
    if (nat < 0.03) return;
    c.beginPath();
    const plas = this.plasTegels;
    let nt = 0;
    for (let r = this.r0; r <= this.r1; r++) {
      for (let k = this.k0; k <= this.k1; k++) {
        const ti = r * geo.kol + k;
        if (!this.straat[ti] || this.tel.glans >= PLAFOND.glans) continue;
        const tg = geo.tegels[ti], x = tg.x * sc + this.ox, y = tg.y * sc + this.oy, h = T * 0.5;
        if (x + h < 0 || y + h < 0 || x - h > this.w || y - h > this.h) continue;
        c.moveTo(x - h, y - T * 0.012); c.lineTo(x + h, y - T * 0.012);
        c.moveTo(x - T * 0.012, y - h); c.lineTo(x - T * 0.012, y + h);
        plas[nt++] = ti;
        this.tel.glans++;
      }
    }
    if (!nt) return;
    c.globalCompositeOperation = 'screen';
    c.strokeStyle = 'rgba(170,190,215,1)';
    c.lineWidth = Math.max(1, T * 0.022);
    c.globalAlpha = nat * 0.35;
    c.stroke();
    // plassen: platte ellipsen op de straat met een lichte rand; diep ingezoomd tikt de regen er kringetjes in
    const P = this.plassen;
    let np = 0;
    c.beginPath();
    for (let pi = 0; pi < nt; pi++) {
      const ti = plas[pi], tg = geo.tegels[ti];
      for (let j = 0; j < 3; j++) {
        const op = hash(ti, j, 51) < 0.5, d = (hash(ti, j, 52) - 0.5) * 0.9;
        const x = (tg.x + (op ? d : 0.02 * (j - 1)) * geo.T) * sc + this.ox, y = (tg.y + (op ? 0.02 * (j - 1) : d) * geo.T) * sc + this.oy;
        const rx = T * (0.02 + 0.025 * hash(ti, j, 53)) * (op ? 1.6 : 0.7), ry = T * (0.02 + 0.02 * hash(ti, j, 54)) * (op ? 0.7 : 1.6);
        c.moveTo(x + rx, y); c.ellipse(x, y, rx, ry, 0, 0, TAU);
        if (np < P.length / 4) { P[np * 4] = x; P[np * 4 + 1] = y; P[np * 4 + 2] = Math.min(rx, ry); P[np * 4 + 3] = ti * 3 + j; np++; }
      }
    }
    c.fillStyle = 'rgba(150,176,206,1)';
    c.globalAlpha = nat * 0.4;
    c.fill();
    c.strokeStyle = 'rgba(225,235,245,1)';
    c.lineWidth = Math.max(0.6, T * 0.003);
    c.globalAlpha = nat * 0.3;
    c.stroke();
    if (T > 140 && st.regen > 0.08) {
      const t = nu / 1000;
      c.beginPath();
      for (let i = 0; i < np && this.tel.plaskringen < PLAFOND.plaskringen; i++) {
        const ft = t / 0.8 + hash(P[i * 4 + 3], 58), f = ft - Math.floor(ft);
        const rr = P[i * 4 + 2] * (0.2 + 0.8 * f);
        c.moveTo(P[i * 4] + rr, P[i * 4 + 1]); c.arc(P[i * 4], P[i * 4 + 1], rr, 0, TAU);
        this.tel.plaskringen++;
      }
      c.globalAlpha = nat * 0.35;
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  }

  // Hittetrilling: golvende lichte lijntjes die boven droog land in de zomer opstijgen.
  tekenTrilling(c, st, nu, a) {
    const sterk = st.seizoen.zomer * st.dagLicht * (1 - st.wolken) * (1 - st.regen) * a;
    if (sterk < 0.05) return;
    const geo = this.geo, T = this.T, sc = this.sc, t = nu / 1000;
    // this.straat is bijgewerkt in tekenGrond (ook op droge dagen), dus boven de straten trilt het niet
    const l = T * 0.32, lw = geo.T * 0.32;
    const f = dun((this.nDroog * this.zichtFactor * (this.w + 2 * l)) / this.w, PLAFOND.trilling);
    c.beginPath();
    for (let r = this.r0; r <= this.r1; r++) {
      for (let k = this.k0; k <= this.k1; k++) {
        const ti = r * geo.kol + k;
        if (!this.droog[ti] || this.straat[ti]) continue;
        if (f < 1 && hash(ti, 73) > f) continue;
        const tg = geo.tegels[ti];
        const op = mod(t * 0.12 + hash(ti, 71), 1);
        const wx = tg.x + (hash(ti, 72) - 0.5) * geo.T * 0.6, wy = tg.y + (0.3 - op * 0.6) * geo.T;
        const x = wx * sc + this.ox, y = wy * sc + this.oy;
        // alleen in beeld, en langs de kust niet met een uiteinde boven het water
        if (!this.inBeeld(x, y, l) || this.isWater(wx - lw, wy) || this.isWater(wx + lw, wy)) continue;
        if (this.tel.trilling >= PLAFOND.trilling) break;
        const g = T * 0.012 * Math.sin(t * 6 + ti);
        c.moveTo(x - l, y);
        c.quadraticCurveTo(x - l / 2, y - g - T * 0.01, x, y);
        c.quadraticCurveTo(x + l / 2, y + g + T * 0.01, x + l, y);
        this.tel.trilling++;
      }
    }
    if (!this.tel.trilling) return;
    c.strokeStyle = 'rgba(255,248,226,1)';
    c.lineWidth = Math.max(0.8, T * 0.006);
    c.globalAlpha = sterk * 0.16;
    c.stroke();
  }

  // Stofhoosjes: op een hete zomermiddag draait er hier en daar een stofzuiltje over een droge vlakte. Het trekt een
  // eindje met de wind mee, zwiept, en zakt weer in. De zuil staat rechtop (op de kaart naar boven) en werpt een smalle
  // schaduw naar het zuidoosten, zoals de gebouwen.
  tekenHoosjes(c, st, nu, a) {
    const kans = st.seizoen.zomer * smooth(0.55, 0.8, st.licht) * (1 - smooth(0.25, 0.5, st.wolken)) * (1 - smooth(0.02, 0.1, st.nat)) * (1 - smooth(0.7, 0.95, st.windKracht)) * a;
    if (kans < 0.05 || !this.nDroog) return;
    const geo = this.geo, T = this.T, sc = this.sc, t = nu / 1000, P = 14, D = this.droog, B = this.bebouwd;
    // alleen boven onbebouwde, droge vlakte; gemiddeld een stuk of twee in beeld bij vol zomerweer
    let n = 0;
    for (let r = this.rV0; r <= this.rV1; r++) for (let k = this.kV0; k <= this.kV1; k++) { const ti = r * geo.kol + k; if (D[ti] && !B[ti] && geo.tegels[ti].terrein === 'vlakte') n++; }
    if (!n) return;
    const f = Math.min(0.6, (2.2 * kans) / Math.max(1, n * this.zichtFactor));
    const cs = Math.cos(st.windHoek), sn = Math.sin(st.windHoek), v = geo.T * 0.7 * (0.5 + st.windKracht);
    for (let r = this.rV0; r <= this.rV1; r++) {
      for (let k = this.kV0; k <= this.kV1; k++) {
        const ti = r * geo.kol + k, tg = geo.tegels[ti];
        if (!D[ti] || B[ti] || tg.terrein !== 'vlakte') continue;
        const ft = t / P + hash(ti, 161), cyc = Math.floor(ft), fl = ft - cyc;
        if (hash(ti, cyc, 162) > f) continue;
        const wx = tg.x + (hash(ti, cyc, 163) - 0.5) * geo.T * 0.6 + cs * fl * v + Math.sin(t * 1.3 + ti) * geo.T * 0.04;
        const wy = tg.y + (hash(ti, cyc, 164) - 0.5) * geo.T * 0.6 + sn * fl * v;
        const x = wx * sc + this.ox, y = wy * sc + this.oy;
        if (!this.inBeeld(x, y - T * 0.2, T * 0.4) || this.isWater(wx, wy)) continue;
        if (this.tel.hoosjes >= PLAFOND.hoosjes) return;
        this.tekenHoos(c, x, y, T, t, Math.pow(Math.sin(Math.PI * fl), 0.6) * kans, ti);
        this.tel.hoosjes++;
      }
    }
  }

  tekenHoos(c, x, y, T, t, leef, zaad) {
    const S = this.sprites, d = this.dpr, rb = T * 0.05, H = T * 0.32 * (0.7 + 0.3 * leef);
    c.globalCompositeOperation = 'source-over';
    // schaduw van de zuil op de grond, naar het zuidoosten
    const cs = Math.cos(SCHADUW_HOEK), sn = Math.sin(SCHADUW_HOEK);
    c.globalAlpha = 0.16 * leef;
    c.setTransform(cs * d, sn * d, -sn * d, cs * d, x * d, y * d);
    c.drawImage(S.vlek, 0, -rb * 0.8, H * 0.9, rb * 1.6);
    c.setTransform(d, 0, 0, d, 0, 0);
    // stofwolk aan de voet
    c.globalAlpha = 0.45 * leef;
    c.drawImage(S.stof, x - rb * 2.2, y - rb * 1.1, rb * 4.4, rb * 2.2);
    // de zuil: naar boven breder en ijler, en hij zwiept
    for (let i = 1; i <= 4; i++) {
      const f = i / 4, yy = y - H * f, br = rb * (0.8 + 1.6 * f), xx = x + Math.sin(t * 2.6 + zaad + f * 2.2) * rb * 1.2 * f;
      c.globalAlpha = leef * (0.42 - 0.07 * i);
      c.drawImage(S.stof, xx - br, yy - br * 0.7, br * 2, br * 1.4);
    }
    // de wervel: twee bogen om de voet en halverwege, die snel ronddraaien
    const a0 = t * 7 + zaad, y2 = y - H * 0.45, rx2 = rb * 2.2, ry2 = rb * 0.7;
    c.strokeStyle = 'rgba(232,212,170,1)';
    c.lineWidth = Math.max(0.6, T * 0.004);
    c.globalAlpha = 0.5 * leef;
    c.beginPath();
    c.ellipse(x, y - rb * 0.3, rb * 1.7, rb * 0.6, 0, a0, a0 + 2.2);
    c.moveTo(x + rx2 * Math.cos(a0 + 3), y2 + ry2 * Math.sin(a0 + 3));
    c.ellipse(x, y2, rx2, ry2, 0, a0 + 3, a0 + 4.8);
    c.stroke();
  }

  // Stuifsneeuw: bij harde wind in de winter jaagt de sneeuw in lage, snelle slierten over het open land.
  tekenStuif(c, st, nu, a) {
    const sterk = smooth(0.35, 0.7, st.seizoen.sneeuw) * smooth(0.55, 0.9, st.windKracht) * (1 - st.regen) * a;
    if (sterk < 0.04) return;
    const geo = this.geo, T = this.T, sc = this.sc, t = nu / 1000, W = this.water, St = this.straat, B = this.bebouwd;
    const cs = Math.cos(st.windHoek), sn = Math.sin(st.windHoek), P = 1.6;
    const per = T > 150 ? 3 : 2;
    const f = dun(this.nLand * this.zichtFactor * per * 0.8, PLAFOND.stuif);
    const L0 = T * (0.6 + 0.6 * st.windKracht);
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(246,250,255,1)';
    // drie emmers op levensfase (zelfde truc als de kringen): één pad per emmer
    for (let e = 0; e < 3; e++) {
      c.beginPath();
      let n = 0;
      for (let r = this.rV0; r <= this.rV1; r++) {
        for (let k = this.kV0; k <= this.kV1; k++) {
          const ti = r * geo.kol + k;
          if (W[ti] || St[ti] || B[ti] || geo.tegels[ti].terrein === 'bos') continue;
          const tg = geo.tegels[ti];
          for (let j = 0; j < per; j++) {
            if (hash(ti, j, 181) > f * 0.8) continue;
            const ft = t / P + hash(ti, j, 182), cyc = Math.floor(ft), fl = ft - cyc;
            if (Math.min(2, Math.floor(fl * 3)) !== e) continue;
            const reis = (fl - 0.5) * geo.T * 0.9;
            const wx = tg.x + (hash(ti, j * 13 + cyc, 183) - 0.5) * geo.T + cs * reis, wy = tg.y + (hash(ti, j * 13 + cyc, 184) - 0.5) * geo.T + sn * reis;
            const x = wx * sc + this.ox, y = wy * sc + this.oy, l = L0 * (0.14 + 0.16 * hash(ti, j, 185)) / 2;
            if (!this.inBeeld(x, y, l) || this.isWater(wx, wy)) continue;
            if (this.tel.stuif >= PLAFOND.stuif) break;
            const g = l * 0.12 * Math.sin(t * 9 + ti + j);
            c.moveTo(x - cs * l, y - sn * l);
            c.quadraticCurveTo(x - sn * g, y + cs * g, x + cs * l, y + sn * l);
            n++; this.tel.stuif++;
          }
        }
      }
      if (!n) continue;
      const al = sterk * (e === 1 ? 1 : 0.55);
      c.lineWidth = Math.max(1.5, T * 0.03); c.globalAlpha = al * 0.14; c.stroke();
      c.lineWidth = Math.max(0.7, T * 0.008); c.globalAlpha = al * 0.45; c.stroke();
    }
  }

  // Pollen: op winderige voorjaarsdagen waaien er gele wolkjes stuifmeel van de bossen af (zoom 4,5 tot 10).
  tekenPollen(c, st, nu, a) {
    const sterk = st.seizoen.lente * smooth(0.35, 0.75, st.windKracht) * st.dagLicht * (1 - smooth(0.02, 0.15, st.regen + st.nat * 0.5)) * a;
    if (sterk < 0.04) return;
    const geo = this.geo, T = this.T, sc = this.sc, t = nu / 1000, spr = this.sprites.pollenwolk;
    const cs = Math.cos(st.windHoek), sn = Math.sin(st.windHoek);
    c.globalCompositeOperation = 'source-over';
    for (let r = this.rV0; r <= this.rV1; r++) {
      for (let k = this.kV0; k <= this.kV1; k++) {
        const ti = r * geo.kol + k, tg = geo.tegels[ti];
        if (tg.terrein !== 'bos' || hash(ti, 191) > 0.35) continue;
        const ft = t / 11 + hash(ti, 192), cyc = Math.floor(ft), fl = ft - cyc;
        if (hash(ti, cyc, 193) > 0.6) continue;
        const reis = fl * geo.T * 1.4;
        const wx = tg.x + (hash(ti, cyc, 194) - 0.5) * geo.T * 0.6 + cs * reis, wy = tg.y + (hash(ti, cyc, 195) - 0.5) * geo.T * 0.6 + sn * reis;
        const g = T * (0.5 + 0.9 * fl), x = wx * sc + this.ox, y = wy * sc + this.oy;
        if (!this.inBeeld(x, y, g / 2)) continue;
        if (this.tel.pollen >= PLAFOND.pollen) return;
        c.globalAlpha = sterk * 0.16 * Math.sin(Math.PI * fl);
        c.drawImage(spr, x - g / 2, y - g * 0.35, g, g * 0.7);
        this.tel.pollen++;
      }
    }
  }

  // Kleur van de dag over het hele beeld: grijs onder een dik wolkendek, gouden en blauw uur, koeler winterlicht, een
  // lichte nevel op lage zoom en een donkerder nacht bij nieuwe maan. Alles in hooguit twee goedkope vlakken (zie maal
  // en waas), en zacht, zodat grenzen leesbaar blijven. Bij volle maan lichten de velden zilverig op.
  tekenKleur(c, st, z) {
    const w = this.w, h = this.h, sz = st.seizoen, K = this.kleur;
    K[0] = K[1] = K[2] = 1; K[3] = K[4] = K[5] = K[6] = 0;
    const grijs = clamp(st.wolken * 0.6 + st.regen * 0.5 + st.sneeuw * 0.3, 0, 1);
    // een dicht wolkendek dempt het licht gelijkmatig (losse schaduwen zijn er dan niet meer, zie tekenSchaduwen)
    const dicht = smooth(0.6, 0.92, st.wolken) * (1 - 0.6 * st.nacht);
    maal(K, 185, 193, 204, grijs * 0.28 + dicht * 0.24);
    waas(K, 125, 133, 145, grijs * 0.09);
    if (st.gouden > 0.02) {
      const g = st.gouden * (1 - 0.6 * grijs) * 0.5;
      if (st.avond) maal(K, 255, 176, 112, g); else maal(K, 255, 200, 150, g);
    }
    if (st.blauw > 0.03) waas(K, 43, 74, 140, st.blauw * 0.12);
    // winterlicht: liever te subtiel dan te sterk (het spel begint op 1 januari)
    if (sz.winter > 0.05) maal(K, 211, 222, 236, sz.winter * 0.3);
    const nevel = 1 - smooth(1.2, 2.8, z);
    if (nevel > 0.08) waas(K, 200, 214, 228, nevel * (0.035 + 0.035 * st.mist));
    if (st.nacht > 0.01) waas(K, 2, 4, 12, st.nacht * (1 - st.maan) * 0.16);
    if (K[0] < 0.996 || K[1] < 0.996 || K[2] < 0.996) {
      c.globalCompositeOperation = 'multiply';
      c.globalAlpha = 1;
      c.fillStyle = this.kleurTekst(0, K[0], K[1], K[2]);
      c.fillRect(0, 0, w, h);
    }
    if (K[6] > 0.004) {
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = K[6];
      c.fillStyle = this.kleurTekst(1, K[3] / K[6], K[4] / K[6], K[5] / K[6]);
      c.fillRect(0, 0, w, h);
    }
    // volle maan: een zilverig lichtere nacht (het nachtvlak van map.js komt hier nog overheen)
    const lift = st.nacht * st.maanLicht * 0.55;
    if (lift > 0.01) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = lift;
      c.fillStyle = '#18233a';
      c.fillRect(0, 0, w, h);
    }
    if (st.gouden > 0.02) {
      // de zon staat laag in het noordwesten
      const gloed = st.gouden * (1 - grijs) * 0.22;
      if (gloed > 0.004) {
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = gloed;
        const r = Math.max(w, h) * 0.9;
        c.drawImage(this.sprites.zon, -r * 0.55, -r * 0.55, r * 1.3, r * 1.3);
      }
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  // Een kleur (kanalen 0..1) als #rrggbb; alleen een nieuwe tekst als de kleur echt verandert.
  kleurTekst(slot, r, g, b) {
    const s = (clamp(Math.round(r * 255), 0, 255) << 16) | (clamp(Math.round(g * 255), 0, 255) << 8) | clamp(Math.round(b * 255), 0, 255);
    if (s !== this.kleurSleutel[slot]) { this.kleurSleutel[slot] = s; this.kleurStr[slot] = '#' + (0x1000000 + s).toString(16).slice(1); }
    return this.kleurStr[slot];
  }

  // ---------- in de lucht ----------

  tekenLucht(c, view, sc, nu) {
    const st = this.stemming;
    if (!st || !view.state || !this.sprites || !view.w) return;
    this.kader(view, sc);
    const z = view.zoom;
    c.save();
    if (z >= 4 && st.nacht > 0.1 && (st.nat > 0.1 || st.mist + st.mistTijd * 0.3 > 0.15)) this.tekenNachtLicht(c, view, st);
    if (st.nacht > 0.03 && z < 7.5) this.tekenStadsgloed(c, st, z);
    if (z < 3.4) this.tekenWolken(c, view, st, nu, 1 - smooth(1.2, 3.2, z));
    if (z < 2.6) this.tekenStreep(c, st, nu, 1 - smooth(1.8, 2.6, z));
    if (z >= 3 && st.gouden > 0.05) this.tekenStralen(c, st, smooth(3, 4.5, z));
    if (st.nacht > 0.05) this.tekenMaanpad(c, st, nu);
    if (z >= 4) this.tekenFlarden(c, view, st, nu, smooth(4, 5.5, z) * (view.bouwModus ? 0.3 : 1));
    if (z >= 8.5) this.tekenDeeltjes(c, st, nu, smooth(8.5, 10.5, z));
    if (z >= 2.4 && st.regen > 0.03) this.tekenRegen(c, st, nu, smooth(2.4, 4, z));
    if (z >= 2.4 && st.sneeuw > 0.03) this.tekenSneeuw(c, st, nu, smooth(2.4, 4, z), z);
    if (st.regenboog > 0.02) this.tekenRegenboog(c, st, nu, smooth(1.5, 4, z));
    if (st.onweer > 0.01) this.tekenBliksem(c, st, nu, z);
    // volle-schermlagen kosten de videokaart een heel beeld aan vulwerk: niet tekenen als ze toch onzichtbaar zijn
    const vignet = 0.2 * smooth(5, 9, z);
    if (vignet > 0.004) {
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = vignet;
      c.drawImage(this.sprites.vignet, -this.w * 0.08, -this.h * 0.08, this.w * 1.16, this.h * 1.16);
    }
    c.restore();
  }

  // Nachtlicht in nat en mistig weer: lantaarns weerspiegelen als lange, smalle vegen op de natte straat,
  // en in de mist krijgt elke wijk een wazige lichtkoepel.
  tekenNachtLicht(c, view, st) {
    const spr = view.lichtSprite;
    if (!spr) return;
    this.werkBebouwing();
    const geo = this.geo, T = this.T, sc = this.sc;
    const nat = clamp(st.nat * 1.5, 0, 1) * smooth(5, 6, view.zoom), mist = clamp(st.mist + st.mistTijd * 0.3, 0, 1);
    const b = T * 0.05, l = T * 0.2;
    c.globalCompositeOperation = 'lighter';
    for (let r = this.r0; r <= this.r1; r++) {
      for (let k = this.k0; k <= this.k1; k++) {
        const ti = r * geo.kol + k;
        if (!this.straat[ti]) continue;
        const tg = geo.tegels[ti], cx = tg.x * sc + this.ox, cy = tg.y * sc + this.oy;
        if (mist > 0.15 && this.tel.halo < PLAFOND.halo) {
          const bh = T * (this.straat[ti] === 2 ? 2.2 : 1.6);
          if (this.inBeeld(cx, cy, bh / 2)) {
            c.globalAlpha = mist * st.nacht * 0.16;
            c.drawImage(spr, cx - bh / 2, cy - bh / 2, bh, bh);
            this.tel.halo++;
          }
        }
        if (nat < 0.05) continue;
        // de veeg begint onder een echte lantaarn van de levenslaag en loopt naar de kijker toe over de natte stoep en straat
        c.globalAlpha = nat * st.nacht * 0.45;
        const lampen = this.straat[ti] === 2 ? LAMPEN_HOOFD : LAMPEN;
        for (let j = 0; j < lampen.length; j++) {
          const x = cx + lampen[j][0] * T, y = cy + lampen[j][1] * STOEP * T;
          if (!this.inBeeld(x, y + l / 2, l)) continue;
          if (this.tel.reflecties >= PLAFOND.reflecties) break;
          c.drawImage(spr, x - b / 2, y - l * 0.15, b, l);
          this.tel.reflecties++;
        }
      }
    }
    c.globalCompositeOperation = 'source-over';
  }

  // Steden bij nacht op lage zoom, zoals op een satellietfoto: snoeren van licht langs de wegen, gespikkelde
  // lichtkernen die naar buiten uitwaaieren en een warme kleurcorrectie. De brede gloed van tekenNacht telt in een
  // stadskern op tot wit; vermenigvuldigen met warm goud maakt daar weer natriumlicht van, zonder de kern te dimmen.
  tekenStadsgloed(c, st, z) {
    const n = st.nacht * (1 - smooth(4, 5.5, z)), warm = st.nacht * (1 - smooth(5.5, 7.5, z));
    if (n < 0.03 && warm < 0.03) return;
    const geo = this.geo, T = this.T, sc = this.sc, s = this.state, P = this.lichtPunt, MAX = PLAFOND.stadslicht;
    c.globalCompositeOperation = 'lighter';
    const sn = n * smooth(1.5, 2.1, z);
    if (sn > 0.03 && this.nSnoer) {
      const S = this.snoer;
      let k = 0;
      c.beginPath();
      for (let i = 0; i < this.nSnoer; i++) {
        const ax = S[i * 4] * sc + this.ox, ay = S[i * 4 + 1] * sc + this.oy, bx = S[i * 4 + 2] * sc + this.ox, by = S[i * 4 + 3] * sc + this.oy;
        if (Math.max(ax, bx) < 0 || Math.max(ay, by) < 0 || Math.min(ax, bx) > this.w || Math.min(ay, by) > this.h) continue;
        c.moveTo(ax, ay); c.lineTo(bx, by); k++;
      }
      if (k) {
        this.snoerStreep[1] = Math.max(3, T * 0.16);
        c.setLineDash(this.snoerStreep);
        c.lineCap = 'round';
        c.lineWidth = Math.max(1.2, T * 0.05);
        c.strokeStyle = 'rgba(255,178,96,1)';
        c.globalAlpha = sn * 0.4;
        c.stroke();
        c.setLineDash(GEEN);
        this.tel.snoeren += k;
      }
    }
    // lichtkernen: tel eerst wat er in beeld is. Hoofdsteden en woonwijken krijgen twee passen (gloed en warme kleur) en
    // die tweede pas moet altijd nog passen, anders blijven de steden achteraan de lijst wit. Zijn er meer steden dan
    // de helft van het plafond, dan vallen er woonwijken weg; wat overblijft gaat naar de kleine lichtjes. Allebei
    // gelijkmatig uitgedund, met wat speling (0,85): de hash geeft nooit precies het verwachte aantal.
    let klein = 0, hoofd = 0, woon = 0, rest = 0;
    for (let i = 0; i < this.nLicht; i++) {
      const R = Math.max(3, (P[i * 5 + 3] === 0 ? 1.6 : P[i * 5 + 2]) * T), x = P[i * 5] * sc + this.ox, y = P[i * 5 + 1] * sc + this.oy;
      if (!this.inBeeld(x, y, R)) continue;
      const soort = P[i * 5 + 3];
      if (soort === 2) klein++; else if (soort === 3) rest++; else if (soort === 1) woon++; else hoofd++;
    }
    const half = MAX >> 1, woonRuimte = Math.max(0, half - hoofd), fW = woon > woonRuimte ? (0.85 * woonRuimte) / woon : 1;
    const warmN = hoofd + Math.min(woon, woonRuimte), reserve = warm >= 0.03 ? Math.min(warmN, half) : 0;
    const ruimte = Math.max(0, MAX - reserve - warmN - rest), f = klein ? clamp((0.85 * ruimte) / klein, 0, 1) : 1;
    let nKlein = 0;
    for (let pas = 0; pas < 2; pas++) {
      const sterk = pas ? warm : n;
      if (sterk < 0.03) continue;
      const grens = pas ? MAX : MAX - reserve;
      let nWoon = 0;
      c.globalCompositeOperation = pas ? 'multiply' : 'lighter';
      for (let i = 0; i < this.nLicht; i++) {
        const soort = P[i * 5 + 3];
        if (pas && (soort === 2 || soort === 3)) continue;
        // uitdunnen en de vorm op de tegel, niet op de plek in de lijst: die schuift bij elk nieuw gebouw ergens op de
        // kaart, en dan zouden alle lichtjes erachter van vorm wisselen of aan- en uitspringen
        const ti = Math.floor(P[i * 5 + 1] / geo.T) * geo.kol + Math.floor(P[i * 5] / geo.T);
        if (soort === 2 && ((f < 1 && hash(ti, 211) > f) || nKlein >= ruimte)) continue;
        if (soort === 1 && ((fW < 1 && hash(ti, 213) > fW) || nWoon >= woonRuimte)) continue;
        // hoofdstad: dezelfde straal als de gloed van tekenNacht (groeit met de bevolking)
        let r = P[i * 5 + 2];
        if (soort === 0) { const land = s.landen[P[i * 5 + 4]]; r = 0.9 + (land ? land.L : 0) / 120; }
        const R = Math.max(3, T * (pas ? (soort === 0 ? 0.85 : 0.6) * (soort === 0 ? r : 1) : soort === 0 ? 1.3 * r : r));
        const x = P[i * 5] * sc + this.ox, y = P[i * 5 + 1] * sc + this.oy;
        if (!this.inBeeld(x, y, R)) continue;
        if (this.tel.stadslicht >= grens) break;
        if (soort === 2) nKlein++; else if (soort === 1) nWoon++;
        c.globalAlpha = sterk * (pas ? (soort === 0 ? 0.75 : 0.5) : soort === 0 ? 0.55 : soort === 1 ? 0.45 : 0.35);
        c.drawImage(pas ? this.sprites.warmte : this.sprites.stadslicht[ti % 3], x - R, y - R, R * 2, R * 2);
        this.tel.stadslicht++;
      }
    }
    c.globalCompositeOperation = 'source-over';
  }

  // Hoge wolken (vervangt tekenWolken van map.js): drijven met de wind, zo dicht als het weer is.
  // Regenwolken zijn grijs en slepen een gordijn achter zich aan. Hun schaduw valt naar het zuidoosten, eerst allemaal
  // samen in een vlak (twee wolken over elkaar geven geen dubbel zo donkere vlek) en dan de wolken erbovenop. Onder een
  // dicht wolkendek is er geen zon voor schaduw: dan dempt tekenKleur het licht gelijkmatig.
  tekenWolken(c, view, st, nu, a) {
    if (a <= 0.01) return;
    const wolk = view.wolk, sc = this.sc, G = GROOT, MAX = PLAFOND.wolken, B = this.wolkBuf;
    if (!wolk) return;
    const dx = this.drift.x, dy = this.drift.y;
    const i0 = Math.floor((this.wx0 - dx) / G) - 1, i1 = Math.floor((this.wx1 - dx) / G) + 1;
    const j0 = Math.floor((this.wy0 - dy) / G) - 1, j1 = Math.floor((this.wy1 - dy) / G) + 1;
    let n = 0;
    for (let j = j0; j <= j1 && n < MAX; j++) {
      for (let i = i0; i <= i1 && n < MAX; i++) {
        const p = hash(i, j, 77);
        // het plaatselijke weer kan de bewolking alleen verlagen: wat hier al afvalt, hoeft weer() niet te vragen
        if (p > Math.max(st.wolken, 0.12) * DEKKING) continue;
        const wx = (i + hash(i, j, 3)) * G + dx, wy = (j + hash(i, j, 4)) * G + dy;
        const ww = weer(st.dagF, wx, wy);
        const dicht = ww.wolken * st.wolken;
        // ook op een heldere dag een paar mooiweerwolkjes
        const toon = Math.max(dicht, 0.12);
        if (p > toon * DEKKING) continue;
        const b = G * (1.1 + hash(i, j, 5) * 0.7) * sc * 0.8, h = b / 2;
        const x = wx * sc + this.ox, y = wy * sc + this.oy;
        if (x + b < -20 * sc || y + h < -20 * sc || x - b > this.w || y - h > this.h) continue;
        const q = n * 7;
        B[q] = x; B[q + 1] = y; B[q + 2] = b; B[q + 3] = dicht; B[q + 4] = ww.regen + ww.sneeuw; B[q + 5] = ww.wolken; B[q + 6] = mod(i * 7 + j * 3, 3);
        n++;
      }
    }
    if (!n) return;
    // de grondschaduw neemt het over vanaf zoom 2,4 (zelfde cellen, zelfde plek)
    const As = a * 0.2 * (1 - smooth(2.4, 3.2, view.zoom)) * (1 - 0.85 * smooth(0.6, 0.9, st.wolken)) * (1 - 0.7 * st.nacht);
    if (As > 0.006) {
      const bc = this.beginVlak(0), S = this.sprites.vorm;
      for (let k = 0; k < n; k++) {
        const q = k * 7, b = B[q + 2], h = b / 2;
        bc.globalAlpha = 0.6 + 0.4 * B[q + 3];
        bc.drawImage(S[B[q + 6]], B[q] - b / 2 + 14 * sc, B[q + 1] - h / 2 + 18 * sc, b, h);
        this.bijVlak(0, B[q] + 14 * sc, B[q + 1] + 18 * sc, b / 2);
      }
      this.eindVlak(c, 0, As);
    }
    // 's nachts zijn de wolken donker, bij nieuwe maan nog donkerder
    const nachtDemp = 1 - st.nacht * (0.45 + 0.3 * (1 - st.maan));
    for (let k = 0; k < n; k++) {
      const q = k * 7, x = B[q], y = B[q + 1], b = B[q + 2], h = b / 2, dicht = B[q + 3], nat = B[q + 4], dek = B[q + 5];
      if (nat > 0.15) {
        c.globalAlpha = a * clamp(nat, 0, 1) * 0.5;
        c.drawImage(this.sprites.gordijn, x - b * 0.3 + 10 * sc, y, b * 0.6, b * 0.55);
      }
      c.globalAlpha = a * (0.38 + 0.2 * dicht) * nachtDemp;
      c.drawImage(wolk, x - b / 2, y - h / 2, b, h);
      if (nat > 0.1 || dek > 0.85) {
        c.globalAlpha = a * clamp(nat * 1.2 + (dek - 0.85) * 2, 0, 0.6);
        c.drawImage(this.sprites.donker, x - b / 2, y - h / 2, b, h);
      }
      if (st.gouden > 0.05) {
        // onderkant van de wolk licht roze-oranje op bij zonsondergang
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = a * st.gouden * 0.18;
        c.drawImage(this.sprites.zon, x - b * 0.4, y - h * 0.2, b * 0.8, h * 0.8);
        c.globalCompositeOperation = 'source-over';
      }
    }
    this.tel.wolken += n;
  }

  // Een vliegtuigstreep hoog over de kaart op heldere dagen: groeit, waait uit en verdwijnt.
  tekenStreep(c, st, nu, a) {
    const helder = st.dagLicht * (1 - st.wolken) * a;
    if (helder < 0.05) return;
    const cyc = Math.floor(nu / 45000), f = (nu / 45000) - cyc;
    if (hash(cyc, st.dag, 5) > 0.7) return;
    const sc = this.sc;
    const y0 = 60 + hash(cyc, 1) * 500, y1 = 60 + hash(cyc, 2) * 500;
    const groei = Math.min(1, f * 1.6), weg = smooth(0.6, 1, f);
    const ax = -50, bx = 1050, kop = ax + (bx - ax) * groei, staart = ax + (bx - ax) * weg * groei;
    const yy = (x) => y0 + (y1 - y0) * (x - ax) / (bx - ax);
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = 'rgba(255,255,255,1)';
    c.lineCap = 'round';
    for (const [lw, al] of STREEPLIJN) {
      c.lineWidth = lw * Math.max(1, sc * 0.8);
      c.globalAlpha = helder * al * (1 - weg);
      c.beginPath();
      c.moveTo(staart * sc + this.ox, yy(staart) * sc + this.oy);
      c.lineTo(kop * sc + this.ox, yy(kop) * sc + this.oy);
      c.stroke();
    }
    if (groei < 1) {
      c.globalAlpha = helder * 0.8;
      c.fillStyle = '#ffffff';
      c.fillRect(kop * sc + this.ox - 1, yy(kop) * sc + this.oy - 1, 2, 2);
    }
  }

  // Zonnestralen bij het gouden uur: lichtbanen die schuin vanuit het noordwesten over de kaart vallen.
  tekenStralen(c, st, a) {
    const sterk = st.gouden * (1 - st.regen) * (0.35 + 0.65 * smooth(0.15, 0.6, st.wolken)) * a;
    if (sterk < 0.03) return;
    const r = Math.hypot(this.w, this.h) * 1.15;
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = sterk * 0.13;
    c.drawImage(this.sprites.stralen, -this.w * 0.1, -this.h * 0.1, r, r);
    c.globalCompositeOperation = 'source-over';
  }

  // Maanlicht op het water: een glinsterend pad van de kijker (het midden van het beeld) naar de maan, die in de loop
  // van de nacht van oost via zuid naar west trekt. Het pad hoort bij de kijker, zoals echte glinstering: de
  // fonkjes zelf duren een fractie van een seconde en springen naar een nieuw plekje in het pad.
  tekenMaanpad(c, st, nu) {
    const m = st.maanLicht * st.nacht;
    if (m < 0.05) return;
    const w = this.w, h = this.h, t = nu / 1000, sc = this.sc, spr = this.sprites.glinsterMaan, MAX = PLAFOND.maanpad;
    const hoek = -0.25 + clamp((st.fase - 0.25) / 0.5, 0, 1) * (Math.PI + 0.5);
    const ux = Math.cos(hoek), uy = Math.sin(hoek), L = Math.max(w, h) * 0.55, B = Math.min(w, h);
    const mx = w / 2 + ux * L * 0.25, my = h / 2 + uy * L * 0.25;
    const g0 = clamp(this.T * 0.035, 2.5, 8);
    c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < MAX * 2; k++) {
      if (this.tel.maanpad >= MAX) break;
      const ft = t * 1.7 + hash(k, 201), cyc = Math.floor(ft), fl = ft - cyc;
      const s = hash(k, cyc, 202) * 2 - 1;
      const breed = B * (0.02 + 0.035 * (s + 1));
      const l = (hash(k, cyc, 203) + hash(k, cyc, 204) - 1) * breed;
      const x = mx + ux * s * L * 0.75 - uy * l, y = my + uy * s * L * 0.75 + ux * l;
      if (x < -8 || y < -8 || x > w + 8 || y > h + 8) continue;
      if (!this.isWater((x - this.ox) / sc, (y - this.oy) / sc)) continue;
      const fon = Math.sin(Math.PI * fl), g = g0 * (0.6 + 0.8 * hash(k, cyc, 205));
      c.globalAlpha = m * fon * fon * (1 - 0.6 * Math.abs(s));
      c.drawImage(spr, x - g / 2, y - g / 2, g, g);
      this.tel.maanpad++;
    }
    c.globalCompositeOperation = 'source-over';
  }

  // Lage wolkenflarden die je bij het inzoomen doorvliegt: dunne slierten in drie lagen op verschillende hoogte. Hoe
  // dichter bij de camera, hoe sneller ze groeien en naar de rand wegschuiven (parallax), tot je erdoorheen bent.
  // Vooral tijdens het zoomen en aan de randen van het beeld; samen nooit meer dan een tiende van het scherm.
  tekenFlarden(c, view, st, nu, a) {
    const weerDek = clamp(0.1 + st.wolken * 0.5 + st.mist * 0.4 + st.regen * 0.2, 0, 1);
    const vlieg = 0.22 + 0.78 * smooth(0.12, 0.9, this.zoomVaart);
    const dek = weerDek * vlieg * a * (1 - 0.6 * st.nacht);
    if (dek < 0.03) return;
    const S = this.sprites.flard, MAX = PLAFOND.flarden, z = view.zoom, w = this.w, h = this.h, d = this.dpr;
    const cx = view.cx, cy = view.cy, diag = Math.hypot(w, h) / 2;
    const cs = Math.cos(st.windHoek), sn = Math.sin(st.windHoek);
    let budget = 0.1 * w * h, n = 0;
    c.globalCompositeOperation = 'source-over';
    for (let L = 0; L < FLARDLAGEN.length && n < MAX; L++) {
      const Zc = FLARDLAGEN[L][0], G = FLARDLAGEN[L][1];
      if (z >= Zc * 0.85) continue; // daar ben je al doorheen
      const p = Zc / (Zc - z);
      const zicht = smooth(1.3, 1.75, p) * (1 - smooth(2.6, 3.8, p));
      if (zicht < 0.02) continue;
      const sc = this.sc * p, dx = this.drift.x * (1.4 + 0.3 * L), dy = this.drift.y * (1.4 + 0.3 * L);
      const hw = w / 2 / sc, hh = h / 2 / sc;
      const i0 = Math.floor((cx - hw - dx) / G) - 1, i1 = Math.floor((cx + hw - dx) / G) + 1;
      const j0 = Math.floor((cy - hh - dy) / G) - 1, j1 = Math.floor((cy + hh - dy) / G) + 1;
      for (let j = j0; j <= j1 && n < MAX; j++) {
        for (let i = i0; i <= i1 && n < MAX; i++) {
          if (hash(i, j, 81 + L * 7) > 0.22 + 0.3 * weerDek) continue;
          const wx = (i + hash(i, j, 82 + L * 7)) * G + dx, wy = (j + hash(i, j, 83 + L * 7)) * G + dy;
          const x = (wx - cx) * sc + w / 2, y = (wy - cy) * sc + h / 2;
          const len = G * (0.9 + 0.7 * hash(i, j, 84 + L * 7)) * sc, dik = len * 0.16, hl = len / 2;
          if (x + hl < 0 || y + hl < 0 || x - hl > w || y - hl > h) continue;
          // in het midden van het beeld wijken ze, zodat de kaart leesbaar blijft
          const rand = smooth(0.32, 0.85, Math.hypot(x - w / 2, y - h / 2) / diag);
          const al = dek * zicht * 0.5 * rand;
          if (al < 0.012) continue;
          // wat er van de flard echt in beeld valt (de sliert vult ongeveer de helft van zijn rechthoek)
          const ex = Math.min(w, x + hl) - Math.max(0, x - hl), ey = Math.min(h, y + hl) - Math.max(0, y - hl);
          const opp = len * dik * 0.55 * clamp((ex * ey) / (len * len), 0, 1);
          if (opp > budget) continue;
          budget -= opp;
          c.globalAlpha = al;
          c.setTransform(cs * d, sn * d, -sn * d, cs * d, x * d, y * d);
          c.drawImage(S[mod(i * 5 + j * 11 + L, 3)], -hl, -dik / 2, len, dik);
          this.tel.flarden++; n++;
        }
      }
    }
    if (n) c.setTransform(d, 0, 0, d, 0, 0);
  }

  // Kleine dingen in de lucht, alleen heel diep ingezoomd: bloesemblaadjes en pollen in de lente, pluisjes en
  // 's nachts vuurvliegjes in de zomer, tuimelende blaadjes in de herfst. Ze waaien mee met de wind.
  tekenDeeltjes(c, st, nu, a) {
    const sz = st.seizoen, droog = 1 - smooth(0.05, 0.3, st.regen + st.sneeuw);
    const gew = this.gewicht, NS = DEELTJESOORTEN.length;
    gew[0] = sz.bloei + sz.lente * 0.3; // bloesem
    gew[1] = sz.zomer * st.dagLicht; // pluis
    gew[2] = sz.herfst; // blad
    gew[3] = (sz.zomer + sz.lente * 0.4) * st.nacht; // vuurvlieg
    gew[4] = sz.lente * (0.3 + 0.5 * st.windKracht) * st.dagLicht; // pollen
    const t = nu / 1000, sc = this.sc, T = this.T, G = DEELTJE;
    const dx = this.drift.x * 0.8, dy = this.drift.y * 0.8;
    const i0 = Math.floor(this.wx0 / G), i1 = Math.floor(this.wx1 / G), j0 = Math.floor(this.wy0 / G), j1 = Math.floor(this.wy1 / G);
    const cellen = ((this.wx1 - this.wx0) / G + 1) * ((this.wy1 - this.wy0) / G + 1);
    for (let s = 0; s < NS; s++) {
      const soort = DEELTJESOORTEN[s][0], kleuren = DEELTJESOORTEN[s][1], gewicht = gew[s];
      const dicht = gewicht * droog * a;
      if (dicht < 0.05) continue;
      const vuur = soort === 'vuurvlieg';
      if (vuur) c.globalCompositeOperation = 'lighter';
      const groepen = kleuren ? kleuren.length : 1;
      // kans per plekje zo dat het plafond gemiddeld niet bereikt wordt: dan blijven alle kleuren en het hele beeld gevuld
      // (aantal cellen uit de echte breedte en hoogte van het beeld, niet uit afgeronde celnummers: die wisselen bij
      // schuiven en dan zou het aantal deeltjes ineens halveren of verdubbelen)
      const kans = dicht * Math.min(0.75, (PLAFOND.deeltjes * 0.7) / Math.max(1, cellen * 3 * groepen));
      for (let kl = 0; kl < groepen; kl++) {
        c.beginPath();
        let n = 0;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            for (let q = 0; q < 3; q++) {
              if (this.tel.deeltjes >= PLAFOND.deeltjes) break;
              const z = (q * NS + s) * 7 + kl;
              if (hash(i, j, 400 + z) > kans) continue;
              // binnen de eigen cel meedrijven en aan de rand terugkomen: zo blijft het veld overal even dicht
              const bx = mod(hash(i, j, 500 + z) * G + dx * (0.7 + hash(i, j, 600 + z) * 0.6) + Math.sin(t * 0.9 + z) * 1.2, G);
              const by = mod(hash(i, j, 700 + z) * G + dy * (0.7 + hash(i, j, 800 + z) * 0.6) + Math.cos(t * 0.7 + z) * 1.2, G);
              const wx = i * G + bx, wy = j * G + by;
              if (vuur && (this.isWater(wx, wy) || hash(i, j, z) > 0.6)) continue;
              const x = wx * sc + this.ox, y = wy * sc + this.oy;
              if (x < -4 || y < -4 || x > this.w + 4 || y > this.h + 4) continue;
              if (vuur) {
                const knip = Math.sin(t * (1.5 + hash(i, j, 900 + z)) + z * 1.7);
                if (knip < 0.3) continue;
                const g = Math.max(4, T * 0.03);
                c.globalAlpha = dicht * (knip - 0.3) / 0.7;
                c.drawImage(this.sprites.vuurvlieg, x - g / 2, y - g / 2, g, g);
              } else {
                const g = Math.max(1, T * (soort === 'blad' ? 0.014 : soort === 'pollen' ? 0.005 : 0.008));
                const tuimel = soort === 'blad' ? 0.25 + 0.75 * Math.abs(Math.cos(t * 2.3 + z * 1.3 + i)) : 1;
                c.rect(x - g * tuimel, y - g * 0.6, g * 2 * tuimel, g * 1.2);
              }
              n++; this.tel.deeltjes++;
            }
          }
        }
        if (!vuur && n) { c.fillStyle = kleuren[kl]; c.globalAlpha = Math.min(1, dicht * 1.2) * (1 - 0.6 * st.nacht); c.fill(); }
      }
      if (vuur) c.globalCompositeOperation = 'source-over';
    }
  }

  patroon(c, spr) {
    if (this.patroonCtx !== c) { this.patronen = new Map(); this.patroonCtx = c; }
    let p = this.patronen.get(spr);
    if (!p) { p = c.createPattern(spr, 'repeat'); this.patronen.set(spr, p); }
    return p;
  }

  // Een herhalend vel (regen of sneeuw) over het hele scherm, gedraaid naar de valrichting en verschoven met de tijd.
  vel(c, spr, hoek, schaal, ox, oy, alpha) {
    const d = this.dpr, cs = Math.cos(hoek) * schaal * d, sn = Math.sin(hoek) * schaal * d;
    const R = Math.hypot(this.w, this.h) / 2 / schaal + VEL;
    c.globalAlpha = alpha;
    c.setTransform(cs, sn, -sn, cs, this.w / 2 * d, this.h / 2 * d);
    c.translate(mod(ox, VEL), mod(oy, VEL));
    c.fillStyle = this.patroon(c, spr);
    c.fillRect(-R - VEL, -R - VEL, 2 * R + 2 * VEL, 2 * R + 2 * VEL);
    c.setTransform(d, 0, 0, d, 0, 0);
  }

  // Regen: drie lagen schuine strepen, de dichtste het grootst en het snelst; de wind trekt ze scheef.
  tekenRegen(c, st, nu, a) {
    const t = nu / 1000, sterk = clamp(st.regen * 1.3, 0, 1) * a;
    if (sterk < 0.01) return; // net boven zoom 2,4 is a nog 0: geen drie onzichtbare vellen over het hele scherm
    const scheef = Math.cos(st.windHoek) * st.windKracht * 0.7;
    const hoek = Math.atan2(1, scheef) - Math.PI / 2;
    c.globalCompositeOperation = 'source-over';
    const lagen = REGENLAGEN;
    for (let l = 0; l < lagen.length; l++) {
      if (l === 2 && st.regen < 0.35) break;
      const [s, v, spr, al] = lagen[l];
      this.vel(c, this.sprites.regen[spr], hoek, s, l * 37, (t * v) / s + l * 51, sterk * al);
    }
  }

  // Sneeuw: vlokken in drie lagen die langzaam vallen en heen en weer dwarrelen. Diep ingezoomd groter.
  tekenSneeuw(c, st, nu, a, z) {
    const t = nu / 1000, sterk = clamp(st.sneeuw * 1.2, 0, 1) * a;
    if (sterk < 0.01) return;
    const scheef = Math.cos(st.windHoek) * st.windKracht * 0.5;
    const hoek = Math.atan2(1, scheef) - Math.PI / 2;
    const groei = 0.8 + 0.6 * smooth(4, 14, z);
    c.globalCompositeOperation = 'source-over';
    const lagen = SNEEUWLAGEN;
    for (let l = 0; l < lagen.length; l++) {
      if (l === 2 && st.sneeuw < 0.3) break;
      const [s, v, spr, al] = lagen[l];
      const dw = Math.sin(t * (0.6 + l * 0.25) + l * 2.1) * 14;
      this.vel(c, this.sprites.sneeuw[spr], hoek, s * groei, dw + l * 41, (t * v) / s + l * 23, sterk * al);
    }
  }

  // Regenboog na een bui: een zachte boog in de hoek van het beeld, met de zon in de rug (die staat in het noordwesten).
  tekenRegenboog(c, st, nu, a) {
    const al = st.regenboog * a;
    if (al < 0.02) return;
    const w = this.w, h = this.h, R = Math.max(w, h) * 0.75, x = w * 0.78, y = h * 1.18;
    const dik = R * 0.014;
    c.globalCompositeOperation = 'screen';
    c.lineWidth = dik * 1.3;
    for (let i = 0; i < BOOG.length; i++) {
      c.strokeStyle = BOOG[i];
      c.globalAlpha = al * 0.16;
      c.beginPath();
      c.arc(x, y, R - i * dik, Math.PI * 1.08, Math.PI * 1.72);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  }

  // Onweer: af en toe een bliksemschicht en een korte flits die het beeld oplicht. Diep ingezoomd zit je
  // onder de wolken en zie je alleen de flits.
  tekenBliksem(c, st, nu) {
    const P = 4.5, ft = nu / 1000 / P, cyc = Math.floor(ft), f = (ft - cyc) * P;
    if (hash(cyc, st.dag, 13) > st.onweer * 1.6 + 0.1 || f > 0.5) return;
    const flits = f < 0.07 ? 1 : f < 0.13 ? 0.25 : f < 0.21 ? 0.75 : Math.max(0, 0.75 - (f - 0.21) * 2.6);
    st.flits = flits * st.onweer;
    if (flits < 0.02) return; // de staart van de flits: geen onzichtbaar vlak over het hele scherm
    const w = this.w, h = this.h;
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = clamp(flits * (0.12 + 0.25 * st.onweer), 0, 0.35);
    c.fillStyle = '#c8d6ff';
    c.fillRect(0, 0, w, h);
    if (this.sc * this.geo.T < 60 && f < 0.24) {
      // een gekartelde schicht van boven naar een vaste plek, met een gloed eromheen
      let x = w * (0.15 + hash(cyc, 3) * 0.7), y = 0;
      const eind = h * (0.35 + hash(cyc, 4) * 0.4);
      c.beginPath(); c.moveTo(x, y);
      for (let i = 1; i <= 8; i++) { x += (hash(cyc, i, 5) - 0.5) * w * 0.06; y = (eind * i) / 8; c.lineTo(x, y); }
      c.strokeStyle = '#eef3ff'; c.lineCap = 'round';
      for (const [lw, al] of SCHICHTLIJN) { c.lineWidth = lw; c.globalAlpha = al * flits; c.stroke(); }
      this.tel.bliksem = 1;
    }
    c.globalCompositeOperation = 'source-over';
  }
}
