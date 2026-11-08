// Leven op de kaart (P2 van docs/inzoom-spec.md): auto's op de wegen, voetgangers op de stoepen, boten bij de havens,
// zwermen vogels, protesten bij onrust, stakingen bij fabrieken en rook waar gevochten wordt.
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Elke positie is f(zaad, klok), dus er zijn
// geen deeltjeslijsten die groeien. Plaatsing en aantallen komen uit een vaste hash van tegel en volgnummer;
// de tijd stuurt alleen de beweging. Geen Math.random en geen nextRandom.
// Leven plus: fietsers, joggers, hondenuitlaters en kinderwagens; bussen met haltes, bestelbusjes, taxi's en
// hulpdiensten; tractoren, maaidorsers en kuddes op het platteland; vissers, veerboten en zeilboten die met de
// wind meehellen; vliegtuigen, een helikopter, luchtballonnen en trekvogels; bouwkranen, marktkraampjes,
// spelende kinderen, duiven en eenden; paraplu's, sneeuwpoppen, sleetjes en vuurwerk. Seizoen, weer en wind komen
// uit seizoen.js, zodat dit bij de andere lagen past. Detail komt trapsgewijs op: zoom 4-6 de grote dingen,
// 7-9 de mensen en dieren, 10 en hoger de kleine dingen (riemen, vlinders, blaadjes, duiven).

import { woningCapaciteit } from '../engine/samenleving.js';
import { oorlogenVan } from '../engine/leger.js';
import { seizoen, weer, wind } from './seizoen.js';
import { STOP, ZEBRA, DREMPEL as DREMPEL_INFRA } from './infra.js';

// ---------- gedeelde hulpjes (eigen kopie, zie spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
// Driehoeksgolf 0 → 1 → 0: heen en weer lopen.
const tri = (v) => 1 - Math.abs(1 - 2 * frac(v));
const TAU = Math.PI * 2;
// Richting van een driehoeksgolf: +1 op de heenweg, -1 op de terugweg.
const triRichting = (v) => (frac(v) < 0.5 ? 1 : -1);

// Positie op een busroute met n haltes op gelijke afstand: rijden, d stilstaan, rijden. u en uitkomst 0..1.
function haltePos(u, n, d) {
  const tau = (1 - n * d) / (n + 1);
  let t = u;
  for (let i = 0; i <= n; i++) {
    if (t < tau) return (i + t / tau) / (n + 1);
    t -= tau;
    if (i < n) { if (t < d) return (i + 1) / (n + 1); t -= d; }
  }
  return 1;
}

// Reeks pseudo-random getallen uit één zaad (mulberry32, dezelfde als in detail.js).
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

// Harde plafonds per frame, zodat een drukke wereld nooit de framerate opeet.
export const PLAFOND = {
  autos: 140, mensen: 400, boten: 40, vogels: 60, rook: 20, stoom: 10, lichten: 360,
  // leven plus
  bussen: 12, hulpdiensten: 12, haltes: 24, fietsers: 60, joggers: 30, honden: 30, kinderwagens: 20, kinderen: 60, sleetjes: 12,
  paraplus: 120, machines: 16, balen: 48, dieren: 160, parasols: 30, zwemmers: 20, vliegers: 6, sneeuwpoppen: 16, vlinders: 30, bladeren: 50, eenden: 30,
  netten: 10, meeuwen: 24, kranen: 10, kraampjes: 12, duiven: 40, vliegtuigen: 3, helikopters: 2, ballonnen: 4, trekvogels: 48, vuurwerk: 8,
  // verkeer dat klopt: vrachtwagens met oplegger, vuilniswagens, sneeuwschuivers en strooiwagens, veegwagens,
  // overstekers bij de zebra en groepjes die even blijven staan praten
  opleggers: 12, vuilniswagens: 4, strooiers: 6, veegwagens: 3, overstekers: 40, groepjes: 16,
};
// Tellers die elke frame op nul gaan (alles behalve de oude zeven, die eigen velden hebben).
const PLUS = Object.keys(PLAFOND).slice(7);

const AUTO_KLEUREN = ['#d9d9d4', '#f1efe8', '#2a2c30', '#a8322d', '#2f5d8a', '#d9a63a', '#3d6b48', '#7a5236'];
// Eenpartijstaat en militair regime: grijs en olijf, geen vrolijke lak.
const AUTO_GEDEMPT = ['#6e6f6b', '#8a8b85', '#5d6b4a', '#4a4d4f', '#9a978c', '#55603f', '#7b7a70', '#3c3f3a'];
const TRUCK = 16; // kleurindex van legertrucks
const TRUCK_KLEUR = '#5d6b4a';
const KLEDING = ['#c0392b', '#2e86c1', '#f0b429', '#ecefe9', '#34495e', '#2f9e5b'];
const HUID = ['#f1c9a5', '#c68e5d', '#7d5136'];
const SPANDOEK = ['#d9443c', '#f2f2ef'];
const GEDEMPT_REGIME = { eenpartijstaat: true, militair: true };
// Voertuigen naast auto (0) en truck (1): bus, bestelbus, taxi, politie, ambulance. Kleurindex en halve maten in tegels.
const BUS = 17, BESTEL = 18, TAXI = 19, POLITIE = 20, AMBU = 21, VUILKLEUR = 22, WINTERKLEUR = 23, VEEGKLEUR = 24, LAATSTE_KLEUR = 24;
const KLEUR_VOERTUIG = { 17: '#2f7d6d', 18: '#e8e6df', 19: '#f2c230', 20: '#f4f5f7', 21: '#f6f3e8', 22: '#3d7a4f', 23: '#e07a1f', 24: '#ecebe4' };
// Soorten in de autobuffer naast 0-6: vrachtwagen met oplegger, vuilniswagen, sneeuwschuiver, strooiwagen, veegwagen.
const OPLEGGER = 7, VUIL = 8, SCHUIVER = 9, STROOI = 10, VEEG = 11;
const MAAT = [[0.05, 0.0275], [0.08, 0.035], [0.115, 0.034], [0.064, 0.031], [0.05, 0.0275], [0.052, 0.028], [0.066, 0.031],
  [0.112, 0.034], [0.078, 0.034], [0.074, 0.036], [0.07, 0.034], [0.05, 0.03]];
const OPLEGGER_KLEUR = ['#d8d6cf', '#b8442f', '#2f6d9a', '#7a7d80', '#3d7a4f']; // laadbak: wit, of een containerkleur
// Kleding per seizoen: jassen in de winter (donkerder en warmer), mutsen in vrolijke kleuren, tassen.
const JAS = ['#6e2a26', '#2b3d55', '#6b5a3a', '#3a3d40', '#23303e', '#3d5a3a'];
const MUTS = ['#c0392b', '#f0b429', '#2e86c1', '#ecefe9', '#8a4bb8', '#2f9e5b'];
const TAS = ['#5a3b26', '#1f2124', '#b8442f', '#d9c9a8'];
const HAAR = ['#2a2018', '#5a3b22', '#b08a4a', '#8a8580'];
const BROEK = '#2b2d33';
// Halve romp per boot: aangemeerd, varend, zeilboot, visser, veerboot.
const BOOT_MAAT = [[0.06, 0.025], [0.06, 0.025], [0.055, 0.022], [0.065, 0.024], [0.12, 0.042]];
// Sportkleding voor joggers en kinderen (index 6-9 naast KLEDING).
const KLEDING_ALLES = [...KLEDING, '#ff5fa2', '#3fd0c9', '#c6f03a', '#ff8a1f'];
const SCHERMEN = ['#22252a', '#c0392b', '#2b4a7a', '#f0b429'];
const VACHT = ['#8a5a34', '#2a2522', '#e3d3b0'];
const WAGEN = ['#2b3a55', '#7a2e3b', '#3d5a45', '#d9d4c8'];
const TRACTOR = ['#3d7a3a', '#b8322a', '#2f5c9a', '#d98a1f'];
const DORSER = ['#3d7a3a', '#c9a227', '#b8322a'];
// Dieren: zwartbonte koe, bruine koe, schaap, bruin paard, donker paard, herdershond, hert. Lijf (halve lengte, halve breedte).
const DIER_KLEUR = ['#f1eee6', '#8b5a36', '#ece8dc', '#7b4a28', '#2f2622', '#2a2522', '#9a6a3c'];
const DIER_KOP = ['#2a2522', '#5e3b22', '#2a2622', '#5a3519', '#1d1714', '#f1eee6', '#6e4826'];
const DIER_MAAT = [[0.013, 0.0068], [0.013, 0.0068], [0.0075, 0.0052], [0.014, 0.0055], [0.014, 0.0055], [0.007, 0.0035], [0.011, 0.0045]];
const VLIEGER = ['#e0453a', '#f0b429', '#3a7bd5', '#2f9e5b'];
const VLINDER = ['#f5e663', '#ffffff', '#f29b38', '#8fc0ff'];
const BLAD = ['#d9822b', '#b8462a', '#e8b23a', '#8a5a2a'];
const KRAAM = [['#d9443c', '#f2efe6'], ['#2f6fb0', '#f2efe6'], ['#2f8a4c', '#f2e7b8'], ['#e09a2a', '#7a3b22']];
const BALLON = [['#e0453a', '#f0b429'], ['#3a7bd5', '#f2f2ef'], ['#2f9e5b', '#f0d24a'], ['#8a4bb8', '#f29b38']];
const VUURWERK = [[255, 90, 80], [255, 210, 90], [120, 200, 255], [150, 255, 140], [255, 140, 230]];
// Wat er op een tegel ligt, vast per wereld (zelfde regel als de akkers in terrein.js).
const GEEN = 0, AKKER = 1, WEI = 2, KUSTWATER = 3;

// Mensen per tegel bij volle bezetting; de hoofdstad is drukker dan een gewone wijk.
const MENSEN_PER_TEGEL = { hoofdstad: 15, woonwijk: 10, kolonie: 6 };
const AUTO_SNELHEID = 1.2; // tegels per seconde
const STOEP = 0.045; // afstand van de stoep tot het hart van de straat, in tegels (straatcontract)
const BAAN = 0.03; // rijstrook naast het hart van de weg, in tegels
// Wachtrij voor het licht (zie stroom): hoogstens zoveel stopstrepen per rijrichting en zoveel auto's terug in de tijd.
const MAX_STOP = 3, MAXJ = 80;
// Vanaf deze tegelmaat in pixels (zoom 10,5 in het standaardbeeld) krijgen voertuigen lampen, spiegels en wissers.
const DETAIL_T = 220;

// Soort plek per tegel, voor wie er rondloopt.
const LEEG = 0, HOOFD = 1, WOON = 2, KOLONIE = 3, FABRIEK = 4, HAVEN = 5, OVERIG = 6, SCHOOL = 7;
// Gebouwen uit andere packs die als fabriek of mijn getekend worden (zelfde lijst als TEKENING_ALIAS in map.js).
const ALIAS = { olieveld: 'centrale', staalfabriek: 'industrie', landbouw: 'boerderij', zware_industrie: 'industrie', ruimtevaartcentrum: 'chipfabriek', spoor: 'opslag' };

// Stride van de buffers (getallen per item).
const WEG = 9; // ax, ay, bx, by, lengte, land, zaad, ux, uy
// sx, sy, hx, hy, kleur, soort (0 auto, 1 truck, 2 bus, 3 bestel, 4 taxi, 5 politie, 6 ambulance, 7-11 zie OPLEGGER),
// rem (0..1), knipperlicht (-1 links, 0 niet, 1 rechts), eigen fase (0..1, voor wissers en sneeuw op het dak)
const AUTO = 9;
// sx, sy, kleding, huid, paraplu (0 geen, anders kleur + 1), hx, hy (looprichting; 0, 0 is stilstaan), fase (0..1),
// houding (0 lopen, 1 staan, 2 staan en praten met de handen)
const MENS = 9;
const BOOT = 6; // sx, sy, hx, hy, soort (0 aangemeerd, 1 varend, 2 zeilboot, 3 visser, 4 veerboot), romp (0 wit, 1 hout)
const FIG = 10; // sx, sy, hx, hy, soort, kleding, huid, paraplu, fase, stil (1: de hond snuffelt en het baasje wacht)
// Figuren op straat en in het park, met elk een eigen plafond.
const FIGUUR = ['fietsers', 'joggers', 'honden', 'kinderwagens', 'kinderen', 'sleetjes'];
const FIETS = 0, JOGGER = 1, HOND = 2, KINDERWAGEN = 3, KIND = 4, SLEE = 5;
const DIER = 6; // sx, sy, hx, hy, soort, fase
// sx, sy, hx, hy, soort (0 tractor, 1 maaidorser), kleur, dan het akkervak: midden sx en sy, co, si, baan, u, richting
const MACH = 13;
const ANKER = 5; // wx, wy, soort, zaad, hoek
const ROOK = 4; // sx, sy, zaad, schaal

// ---------- dichtheid per land ----------

// Hoe druk en hoe gespannen het in een land is. Puur; per dag gecachet.
const dichtCache = new WeakMap();
export function levenDichtheid(state, idx) {
  let k = dichtCache.get(state);
  if (!k || k.dag !== state.dag) { k = { dag: state.dag, lijst: [] }; dichtCache.set(state, k); }
  return k.lijst[idx] ?? (k.lijst[idx] = berekenDichtheid(state, idx));
}

function berekenDichtheid(state, idx) {
  const c = state.landen[idx];
  const bezetting = clamp(c.L / Math.max(1, woningCapaciteit(state, c)), 0.3, 1.5);
  const gemiddeld = state.wereldY / Math.max(1, state.landen.length);
  const welvaart = gemiddeld > 0 ? clamp(c.Y / gemiddeld, 0.4, 1.6) : 1;
  const ziek = !!state.pandemie?.besmet?.[idx];
  // Een overwinning in de afgelopen tien dagen: het logboek meldt "X capituleert voor <dit land>." (of
  // "... <dit land> en valt ..."). Achter de naam moet een punt of spatie staan, anders telt "Noord" ook voor "Noordland".
  let zege = false;
  const log = state.log ?? [];
  const sleutel = ' capituleert voor ' + c.naam;
  for (let i = log.length - 1; i >= 0 && i >= log.length - 80; i--) {
    const e = log[i];
    if (!e || e.dag < state.dag - 10) break;
    const p = typeof e.tekst === 'string' ? e.tekst.indexOf(sleutel) : -1;
    const na = p >= 0 ? e.tekst[p + sleutel.length] : '';
    if (na === '.' || na === ' ') { zege = true; break; }
  }
  const jaarDag = ((state.dag % 365) + 365) % 365;
  const oorlog = oorlogenVan(state, c).length > 0;
  return {
    stab: c.stab,
    // groeiende wijken: de woningen raken vol, dus er wordt gebouwd
    groeit: bezetting > 0.95 || c.bouw.length > 0,
    // vuurwerk rond nieuwjaar bij een tevreden land, of na een gewonnen oorlog
    feest: (c.stab >= 65 && !oorlog && (jaarDag >= 362 || jaarDag <= 1)) || zege,
    zege,
    bezetting,
    welvaart,
    oorlog,
    protest: clamp((35 - c.stab) / 35, 0, 1),
    onrust: c.stab < 20,
    staking: c.stab < 25,
    ziek,
    politie: (c.gebouwen.politie ?? 0) > 0,
    gedempt: !!GEDEMPT_REGIME[c.regime],
    mensenFactor: bezetting * (0.6 + 0.4 * welvaart) * (ziek ? 0.25 : 1),
    autoFactor: welvaart * (ziek ? 0.4 : 1),
  };
}

// ---------- tekenhulpjes ----------

// Gedraaide rechthoek rond (x, y), lang 2l in de rijrichting (hx, hy), breed 2w. Voegt toe aan het open pad.
function rechthoek(c, x, y, hx, hy, l, w) {
  const px = -hy * w, py = hx * w, lx = hx * l, ly = hy * l;
  c.moveTo(x + lx + px, y + ly + py);
  c.lineTo(x + lx - px, y + ly - py);
  c.lineTo(x - lx - px, y - ly - py);
  c.lineTo(x - lx + px, y - ly + py);
  c.closePath();
}

// Een stip: onder 3 px een vierkantje (sneller en net zo goed zichtbaar), anders een cirkel.
function stip(c, x, y, r) {
  if (r < 1.5) { c.rect(x - r, y - r, r * 2, r * 2); return; }
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, TAU);
}

// Gedraaide rechthoek in (u, v)-coördinaten: u langs (co, si), v dwars daarop. Voor akkerbanen.
function vak(c, cx, cy, co, si, u0, u1, v0, v1) {
  c.moveTo(cx + u0 * co - v0 * si, cy + u0 * si + v0 * co);
  c.lineTo(cx + u1 * co - v0 * si, cy + u1 * si + v0 * co);
  c.lineTo(cx + u1 * co - v1 * si, cy + u1 * si + v1 * co);
  c.lineTo(cx + u0 * co - v1 * si, cy + u0 * si + v1 * co);
  c.closePath();
}

// Gedraaide ovaal (lengte langs de kop), met een vierkantje als hij te klein is om te tekenen.
function ovaal(c, x, y, hx, hy, l, w) {
  if (l < 1.2) { c.rect(x - l, y - l, l * 2, l * 2); return; }
  c.moveTo(x + hx * l, y + hy * l);
  c.ellipse(x, y, l, w, Math.atan2(hy, hx), 0, TAU);
}

// Een vogeltje als "v" in de vliegrichting; slag 0..1 is de vleugelslag.
function vlucht(c, x, y, hx, hy, w, slag) {
  const terug = w * (0.35 + 0.35 * (1 - slag)), breed = w * (0.7 + 0.3 * slag);
  c.moveTo(x - hx * terug - hy * breed, y - hy * terug + hx * breed);
  c.lineTo(x, y);
  c.lineTo(x - hx * terug + hy * breed, y - hy * terug - hx * breed);
}

// Verkeersvliegtuig van bovenaf (lengte L): romp, gepijlde vleugels en staartvlakken. Voegt toe aan het open pad.
function vliegtuig(c, x, y, hx, hy, L) {
  rechthoek(c, x, y, hx, hy, L * 0.5, L * 0.055);
  // vleugel en staartvlak als vierhoek: voorkant wortel, voorkant tip, achterkant tip, achterkant wortel
  for (let v = 0; v < 2; v++) {
    const q = VLIEG_VORM[v];
    for (let k = -1; k <= 1; k += 2) {
      for (let j = 0; j < 4; j++) {
        const a = q[j * 2] * L, b = q[j * 2 + 1] * L * k;
        if (j === 0) c.moveTo(x + hx * a - hy * b, y + hy * a + hx * b);
        else c.lineTo(x + hx * a - hy * b, y + hy * a + hx * b);
      }
      c.closePath();
    }
  }
}
// wortels op de rand van de romp, zodat overlappende delen met tegengestelde draairichting geen gat geven
const VLIEG_VORM = [[0.1, 0.05, -0.14, 0.5, -0.22, 0.5, -0.12, 0.05], [-0.36, 0.05, -0.47, 0.18, -0.52, 0.18, -0.46, 0.05]];

// Marktkraam van bovenaf: gestreept zeil met licht uit het noordwesten, schaduw naar het zuidoosten en
// koopwaar die onder de voorrand uitsteekt. Vaste set van vier, dus de cache groeit niet.
function kraamSprite([a, b]) {
  const cv = maakCanvas(48, 40);
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(0,0,0,0.28)';
  c.fillRect(8, 9, 38, 28);
  for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? b : a; c.fillRect(4 + i * 6, 4, 6, 26); }
  // nok van het zeil: de zuidkant ligt in de schaduw
  c.fillStyle = 'rgba(0,0,0,0.16)';
  c.fillRect(4, 17, 36, 13);
  const gr = c.createLinearGradient(4, 4, 40, 30);
  gr.addColorStop(0, 'rgba(255,255,255,0.28)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gr;
  c.fillRect(4, 4, 36, 26);
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.fillRect(4, 29, 36, 2);
  // koopwaar op de toonbank: appels, sinaasappels, kool, brood
  const waar = ['#c0392b', '#e8892a', '#6ea33a', '#d8b06a'];
  for (let i = 0; i < 8; i++) { c.fillStyle = waar[i % 4]; c.beginPath(); c.arc(7 + i * 4.4, 33.5, 2, 0, TAU); c.fill(); }
  return cv;
}

// Luchtballon van bovenaf: gestreepte bol met hoogtelicht linksboven en een rand in de schaduw rechtsonder.
function ballonSprite([a, b]) {
  const cv = maakCanvas(64, 64);
  const c = cv.getContext('2d');
  c.save();
  c.beginPath(); c.arc(32, 32, 28, 0, TAU); c.clip();
  c.fillStyle = a; c.fillRect(0, 0, 64, 64);
  c.fillStyle = b;
  // banen van de ballon: van de top naar beneden lopen ze als partjes uit elkaar
  for (let i = 0; i < 8; i += 2) {
    c.beginPath(); c.moveTo(32, 32);
    c.arc(32, 32, 30, (i / 8) * TAU, ((i + 1) / 8) * TAU);
    c.closePath(); c.fill();
  }
  const gr = c.createRadialGradient(22, 21, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  gr.addColorStop(1, 'rgba(0,0,0,0.35)');
  c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
  c.restore();
  c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1;
  c.beginPath(); c.arc(32, 32, 28, 0, TAU); c.stroke();
  // top van de ballon (het ventiel) en de mand die er net onder uitkomt
  c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.arc(30, 30, 3, 0, TAU); c.fill();
  return cv;
}

function gloedSprite(r, g, b) {
  const cv = maakCanvas(32, 32);
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gr.addColorStop(0.4, `rgba(${r},${g},${b},0.4)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = gr;
  c.fillRect(0, 0, 32, 32);
  return cv;
}

// ---------- de laag ----------

export class LevenLaag {
  constructor() {
    // Eigen klok: loopt met de echte tijd zolang het spel loopt (niet versneld door het tempo), staat stil op pauze.
    this.klok = 0;
    this.state = null;
    this.geo = null;
    this.cacheSig = '';
    this.wegen = new Float32Array(0);
    this.nWegen = 0;
    this.ankers = new Float32Array(0);
    this.nAnkers = 0;
    this.zeil = new Int32Array(0);
    this.zeilXY = new Float32Array(0);
    this.zwermen = new Float32Array(0);
    this.soort = new Uint8Array(0);
    this.tegelLand = new Int16Array(0);
    // Werkbuffers, één keer gemaakt en elke frame hergebruikt.
    this.auto = new Float32Array(PLAFOND.autos * AUTO);
    this.mens = new Float32Array(PLAFOND.mensen * MENS);
    this.boot = new Float32Array(PLAFOND.boten * BOOT);
    this.rook = new Float32Array((PLAFOND.rook + PLAFOND.stoom + 4) * ROOK);
    this.vogel = new Float32Array(PLAFOND.vogels * 7);
    this.spandoek = new Float32Array(80 * 3);
    this.vecht = new Int32Array(512);
    this.merk = new Uint8Array(0);
    this.nAuto = this.nMens = this.nBoot = this.nRook = this.nStoom = this.nVogel = this.nSpandoek = 0;
    this.nLicht = 0;
    this.nGevecht = 0;
    this.zoom = 0;
    this.roodSprite = null;
    // leven plus: vaste buffers met een plafond, elke frame opnieuw gevuld
    this.n = {};
    for (const k of PLUS) this.n[k] = 0;
    this.grond = new Uint8Array(0);
    this.visXY = new Float32Array(0);
    this.veer = new Float32Array(0);
    this.halte = new Float32Array(PLAFOND.haltes * 4);
    this.fig = new Float32Array(FIGUUR.reduce((s, k) => s + PLAFOND[k], 0) * FIG);
    this.nFig = 0;
    this.kraam = new Float32Array(PLAFOND.kraampjes * 3);
    this.plein = new Float32Array(4 * 3);
    this.nPlein = 0;
    this.bal = new Float32Array(8 * 2);
    this.nBal = 0;
    this.duifZit = new Float32Array(PLAFOND.duiven * 3);
    this.duifVlieg = new Float32Array(PLAFOND.duiven * 3);
    this.dier = new Float32Array(PLAFOND.dieren * DIER);
    this.mach = new Float32Array(PLAFOND.machines * MACH);
    this.baal = new Float32Array(PLAFOND.balen * 2);
    this.meeuw = new Float32Array(PLAFOND.meeuwen * 5);
    this.net = new Float32Array(PLAFOND.netten * 4);
    this.kraan = new Float32Array(PLAFOND.kranen * 4);
    this.vliegerBuf = new Float32Array(PLAFOND.vliegers * 6);
    this.popBuf = new Float32Array(PLAFOND.sneeuwpoppen * 2);
    this.eendBuf = new Float32Array(PLAFOND.eenden * 5);
    this.trekBuf = new Float32Array(PLAFOND.trekvogels * 5);
    this.nPop = this.nVlieger = this.nEend = this.nStrand = this.nZwem = 0;
    this.strandBuf = new Float32Array(PLAFOND.parasols * 4);
    this.zwemBuf = new Float32Array(PLAFOND.zwemmers * 3);
    this.vlieg = new Float32Array(PLAFOND.vliegtuigen * 4);
    this.heli = new Float32Array(PLAFOND.helikopters * 2);
    this.klein = new Float32Array((PLAFOND.vlinders + PLAFOND.bladeren) * 4);
    this.nKlein = 0;
    this.sz = seizoen(0);
    this.wnd = wind(0);
    this.szDag = -1;
    this.kraamSprites = null;
    this.ballonSprites = null;
    this.vuurSprites = null;
    this.blauwSprite = null;
    // verkeer dat klopt: de weg die verzamelAutos nu afloopt, de koppeling met de wegen van de infralaag en de
    // vaste werkbuffers van de wachtrij voor het licht
    this.wg = { ax: 0, ay: 0, ux: 0, uy: 0, zaad: 0, tunnel: false, werk: false, q0: 0, q1: 0, kant: 1 };
    this.inf = null; this.infW = null; this.koppelSig = ''; this.infraIdx = new Int32Array(0);
    this.stS = new Float64Array(MAX_STOP); this.stP = new Float64Array(MAX_STOP); this.stO = new Float64Array(MAX_STOP); this.stG = new Float64Array(MAX_STOP);
    this.sT0 = new Float64Array(MAXJ); this.sEx = new Uint8Array(MAXJ); this.sPre = new Int32Array(MAXJ + 1);
    this.sAr = new Float64Array(MAX_STOP * MAXJ); this.sDe = new Float64Array(MAX_STOP * MAXJ); this.sAs = new Float64Array(MAX_STOP * MAXJ);
    this.sLp = new Float64Array(MAX_STOP * MAXJ); this.sSl = new Float64Array(MAX_STOP * MAXJ); this.sSt = new Uint8Array(MAX_STOP * MAXJ);
    this.nWacht = 0; this.nu = 0; this.dNu = 0; this.dNuKlok = -1;
    this.traag = [0, 1].map(() => ({ aan: false, soort: 0, kleur: 0, plafond: 'bussen', fase: 0, pos: 0, t0: 0, rem: 0, knip: 0, lang: 0 }));
  }

  // Na het laden van een spel: vaste dingen voorrekenen (kustwater, zeilplekken, vogelzwermen).
  laad(view) {
    this.state = view.state;
    this.geo = view.geo;
    this.eigenaar = view.eigenaar;
    this.cacheSig = '';
    const geo = this.geo;
    const n = geo.tegels.length;
    this.soort = new Uint8Array(n);
    this.tegelLand = new Int16Array(n).fill(-1);
    this.merk = new Uint8Array(n);
    // Water dat aan land grenst: daar varen de zeilboten.
    const zeil = [];
    for (const t of geo.tegels) {
      if (t.terrein !== 'water' || !this.aanLand(t)) continue;
      if (hash(t.i, 5) < 0.08) zeil.push(t.i);
    }
    this.zeil = Int32Array.from(zeil);
    // Middelpunt van de vaarronde: een stukje van de kust af, en een straal waarbij romp en zeil op water blijven.
    this.zeilXY = new Float32Array(zeil.length * 3);
    for (let i = 0; i < zeil.length; i++) {
      const t = geo.tegels[zeil[i]];
      let vx = 0, vy = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
        const b = geo.tegels[(t.r + dr) * geo.kol + t.k + dk];
        if (b && b.terrein !== 'water' && Math.abs(b.k - t.k) <= 1) { vx -= dk; vy -= dr; }
      }
      const vl = Math.hypot(vx, vy) || 1;
      let x = t.x + (vx / vl) * 0.25 * geo.T, y = t.y + (vy / vl) * 0.25 * geo.T;
      if (!this.isWater(x, y)) { x = t.x; y = t.y; }
      let r = 0.3;
      while (r > 0.08 && !this.ringIsWater(x, y, (r + 0.1) * geo.T, (r * 0.6 + 0.1) * geo.T)) r -= 0.04;
      this.zeilXY[i * 3] = x; this.zeilXY[i * 3 + 1] = y; this.zeilXY[i * 3 + 2] = r > 0.08 ? r : 0;
    }
    // Vogelzwermen boven land: middelpunt, straal, leden, frequenties en fasen.
    const land = geo.tegels.filter((t) => t.terrein !== 'water');
    const Z = 24;
    this.zwermen = new Float32Array(Z * 9);
    for (let z = 0; z < Z && land.length; z++) {
      const r = rnd(z * 7919 + 101);
      const t = land[Math.floor(r() * land.length)];
      const o = z * 9;
      this.zwermen[o] = t.x;
      this.zwermen[o + 1] = t.y;
      this.zwermen[o + 2] = 20 + r() * 40; // straal in wereldeenheden
      this.zwermen[o + 3] = 5 + Math.floor(r() * 5); // leden
      this.zwermen[o + 4] = (0.05 + r() * 0.05) * (r() < 0.5 ? -1 : 1); // hoeksnelheid x
      this.zwermen[o + 5] = 0.6 + r() * 0.9; // verhouding y/x (lissajous)
      this.zwermen[o + 6] = r() * TAU;
      this.zwermen[o + 7] = r() * TAU;
      this.zwermen[o + 8] = t.terrein === 'kust' || r() < 0.2 ? 1 : 0; // meeuwen (wit) of kraaien (donker)
    }
    this.laadPlus();
  }

  // Akkers, weides, kustwater, visgronden en veerroutes: vast per wereld.
  laadPlus() {
    const geo = this.geo, T = geo.T, n = geo.tegels.length;
    this.grond = new Uint8Array(n);
    const kust = [], vis = [];
    for (const t of geo.tegels) {
      if (t.terrein === 'water') {
        if (this.aanLand(t)) { this.grond[t.i] = KUSTWATER; kust.push(t); }
        else if (hash(t.i, 71) < 0.07 && this.landBinnen(t, 3) && vis.length < 40 * 3) {
          // visgrond: open water niet ver uit de kust, met een vaarronde die op water blijft
          let r = 0.45;
          while (r > 0.15 && !this.ringIsWater(t.x, t.y, (r + 0.12) * T, (r * 0.7 + 0.12) * T)) r -= 0.06;
          if (r > 0.15) vis.push(t.x, t.y, r);
        }
        continue;
      }
      if (t.eig < 0) continue;
      // zelfde akkerregel als terrein.js, zodat de tractor op een akker rijdt
      if (t.terrein === 'vlakte' && hash(t.i, 3) < 0.45) this.grond[t.i] = AKKER;
      else if ((t.terrein === 'vlakte' || t.terrein === 'kust') && hash(t.i, 61) < 0.6) this.grond[t.i] = WEI;
    }
    this.visXY = Float32Array.from(vis);
    // Veerboten: tussen twee stukken kust met open water ertussen, 4 tot 10 tegels uit elkaar. Open water is
    // water dat niet aan land grenst: zo steekt de veerboot over en vaart hij niet evenwijdig langs één kust.
    const veer = [];
    const openWater = (x, y) => {
      const k = Math.floor(x / T), r = Math.floor(y / T);
      if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) return false;
      const t = geo.tegels[r * geo.kol + k];
      return t.terrein === 'water' && this.grond[t.i] !== KUSTWATER;
    };
    for (let i = 0; i < kust.length && veer.length < 10 * 4; i++) {
      const a = kust[i];
      if (hash(a.i, 73) > 0.06) continue;
      let beste = null, bOpen = 0, bd = 0;
      for (let j = 0; j < kust.length; j++) {
        const b = kust[j];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d < 4 * T || d > 10 * T) continue;
        let nat = true, open = 0;
        for (let s = 1; s < 24 && nat; s++) {
          const x = a.x + ((b.x - a.x) * s) / 24, y = a.y + ((b.y - a.y) * s) / 24;
          if (!this.isWater(x, y)) nat = false;
          else if (openWater(x, y)) open++;
        }
        // minstens een derde van de oversteek over open water; de meeste open zee wint, daarna de langste
        if (nat && open >= 8 && (open > bOpen || (open === bOpen && d > bd))) { beste = b; bOpen = open; bd = d; }
      }
      if (beste) veer.push(a.x, a.y, beste.x, beste.y);
    }
    this.veer = Float32Array.from(veer);
  }

  // Ligt er land binnen d tegels?
  landBinnen(t, d) {
    const geo = this.geo;
    for (let dr = -d; dr <= d; dr++) for (let dk = -d; dk <= d; dk++) {
      const k = t.k + dk, r = t.r + dr;
      if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
      if (geo.tegels[r * geo.kol + k].terrein !== 'water') return true;
    }
    return false;
  }

  aanLand(t) {
    const geo = this.geo;
    for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
      const k = t.k + dk, r = t.r + dr;
      if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
      if (geo.tegels[r * geo.kol + k].terrein !== 'water') return true;
    }
    return false;
  }

  isWater(x, y) {
    const e = this.eigenaar;
    if (!e) return true;
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= 1000 || py >= 620) return true;
    return e[py * 1000 + px] === -1;
  }

  ringIsWater(cx, cy, rx, ry) {
    for (let i = 0; i < 8; i++) if (!this.isWater(cx + Math.cos(i * TAU / 8) * rx, cy + Math.sin(i * TAU / 8) * ry)) return false;
    return true;
  }

  ringOpLand(cx, cy, rx, ry) {
    for (let i = 0; i < 8; i++) if (this.isWater(cx + Math.cos(i * TAU / 8) * rx, cy + Math.sin(i * TAU / 8) * ry)) return false;
    return true;
  }

  // Wegen, plekken en havenboten herberekenen als er gebouwd, gesloopt of veroverd is.
  werkCache(view) {
    const s = this.state;
    let nP = 0, nB = 0, somT = 0;
    for (let i = 0; i < s.landen.length; i++) {
      const l = s.landen[i];
      nP += l.plaatsingen.length;
      nB += l.bouw.length;
      for (let j = 0; j < l.plaatsingen.length; j++) somT += l.plaatsingen[j].t;
    }
    const sig = `${s.grensVersie}|${nP}|${nB}|${s.landen.length}|${s.kolonies.length}|${somT}`;
    if (sig === this.cacheSig) return;
    this.cacheSig = sig;
    const geo = this.geo;
    const P = s.pack;
    const T = geo.T;
    // Wegen: precies dezelfde lijnen als tekenWegen in map.js (gebouw naar dichtstbijzijnde knooppunt).
    const wegen = [];
    for (const land of s.landen) {
      for (const p of land.plaatsingen) {
        if (p.t < 0) continue;
        const n = view.knooppuntVoor(land, p.t);
        if (n < 0) continue;
        const A = geo.tegels[p.t], B = geo.tegels[n];
        const len = Math.hypot(B.x - A.x, B.y - A.y);
        if (len < T) continue; // te kort om op te rijden
        wegen.push(A.x, A.y, B.x, B.y, len, land.idx, p.t * 4099 + n, (B.x - A.x) / len, (B.y - A.y) / len);
      }
    }
    this.wegen = Float32Array.from(wegen);
    this.nWegen = wegen.length / WEG;
    // Wat staat er op elke tegel?
    this.soort.fill(LEEG);
    this.tegelLand.fill(-1);
    const ankers = [];
    for (const land of s.landen) {
      for (const p of land.plaatsingen) {
        if (p.t < 0) continue;
        const g = P.gebouwIndex[p.g];
        const tek = g.tekening ?? ALIAS[g.id] ?? g.id;
        this.soort[p.t] = tek === 'woonwijk' ? WOON : tek === 'industrie' || tek === 'mijn' ? FABRIEK : g.handel_bonus ? HAVEN : tek === 'school' ? SCHOOL : OVERIG;
        this.tegelLand[p.t] = land.idx;
        if (g.handel_bonus) this.havenBoten(p.t, ankers);
      }
    }
    for (const k of s.kolonies) { this.soort[k.t] = KOLONIE; this.tegelLand[k.t] = k.land; }
    for (const land of s.landen) {
      const h = geo.hoofdstad[land.idx];
      if (h != null && h >= 0) { this.soort[h] = HOOFD; this.tegelLand[h] = land.idx; }
    }
    this.ankers = Float32Array.from(ankers);
    this.nAnkers = ankers.length / ANKER;
  }

  // 1 tot 3 boten per haven op het aangrenzende water: de helft ligt aan de kade, de rest vaart rondjes.
  havenBoten(h, uit) {
    const geo = this.geo, T = geo.T;
    const H = geo.tegels[h];
    const water = [];
    for (let d = 1; d <= 2 && !water.length; d++) {
      for (let dr = -d; dr <= d; dr++) for (let dk = -d; dk <= d; dk++) {
        const k = H.k + dk, r = H.r + dr;
        if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
        const t = geo.tegels[r * geo.kol + k];
        if (t.terrein === 'water' && water.length < 3) water.push(t);
      }
    }
    if (!water.length) return;
    const aantal = 1 + Math.floor(hash(h, 1) * 3);
    for (let j = 0; j < aantal; j++) {
      const w = water[j % water.length];
      const zaad = hash(h, j, 3);
      const dx = H.x - w.x, dy = H.y - w.y, d = Math.hypot(dx, dy) || 1;
      if (hash(h, j, 2) < 0.5) {
        // Aangemeerd: richting de kade geschoven, evenwijdig aan de kust; schuif terug tot hij op water ligt.
        const zij = ((j % 3) - 1) * 0.18 * T;
        let f = 0.3;
        let x = 0, y = 0;
        for (; f >= 0; f -= 0.05) {
          x = w.x + (dx / d) * f * T - (dy / d) * zij;
          y = w.y + (dy / d) * f * T + (dx / d) * zij;
          if (this.isWater(x, y)) break;
        }
        uit.push(x, y, 0, zaad, Math.atan2(dx, -dy));
      } else {
        let r = 0.3;
        while (r > 0.12 && !this.ringIsWater(w.x, w.y, r * T, r * T)) r -= 0.06;
        uit.push(w.x, w.y, 1, zaad, r);
      }
    }
  }

  // ---------- per frame ----------

  // Tussen de gebouwen en de eenheden: alles wat beweegt.
  teken(c, view, sc, nu, dt = 0, tempo = 0) {
    if (tempo > 0) this.klok += dt;
    this.nAuto = this.nMens = this.nBoot = this.nRook = this.nStoom = this.nVogel = this.nSpandoek = 0;
    this.nFig = this.nKlein = this.nHalte = this.nPlein = this.nBal = 0;
    for (let i = 0; i < PLUS.length; i++) this.n[PLUS[i]] = 0;
    const s = view.state;
    if (!s || !view.geo || !view.w) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar) this.laad(view);
    this.werkCache(view);
    this.kader(view, sc);
    this.omgeving(view);
    const z = view.zoom;
    this.zoom = z;
    this.nGevecht = 0;
    this.nachtVorig = view.nacht ?? 0;
    // de lichten van infra.js en stad.js lopen op nu; de auto's op de eigen klok: het verschil zet ze gelijk. In de
    // pauze staat de klok stil en blijft het verschil staan, anders verspringen wachtende auto's zodra een licht
    // omslaat terwijl al het andere stilstaat (na de pauze zet het verschil zich opnieuw gelijk)
    this.nu = nu;
    if (tempo > 0 || this.dNuKlok !== this.klok) { this.dNu = nu - this.klok * 1000; this.dNuKlok = this.klok; }
    this.nWacht = 0; this.nPraat = 0;
    c.save();
    if (z >= 4) { this.verzamelBoten(view, nu); this.tekenNetten(c, nu); this.tekenBoten(c, nu); }
    if (z >= 4) this.tekenPlatteland(c, nu);
    if (z >= 3.5) { this.verzamelTunnels(view); this.koppelInfra(view); this.verzamelAutos(); this.tekenHaltes(c); this.tekenAutos(c, smooth(3.5, 4.5, z), nu); }
    if (z >= 4) this.tekenMenigte(c, nu);
    if (z >= 4) this.tekenKranen(c, nu);
    if (z >= 2) { this.verzamelGevechten(); this.tekenRook(c, nu, smooth(2, 3, z), z); }
    if (z >= 2.5 && z <= 11) this.tekenVogels(c, nu, smooth(2.5, 3.5, z) * (1 - smooth(9, 11, z)));
    if (z >= 4) this.tekenMeeuwen(c, nu);
    if (this.nKlein) this.tekenKlein(c, nu);
    if (z >= 2.5) this.tekenLucht(c, nu);
    c.restore();
  }

  // Seizoen, weer en wind van vandaag, op het midden van het beeld (een weerfront is veel groter dan het beeld).
  omgeving(view) {
    const dag = this.state.dag ?? 0;
    if (this.szDag !== dag) { this.sz = seizoen(dag); this.wnd = wind(dag); this.szDag = dag; }
    const w = weer(dag, view.cx, view.cy);
    this.wr = w;
    // bij regen blijven mensen binnen; wie toch buiten is, heeft vaak een paraplu
    this.buiten = clamp(1 - 0.6 * w.regen - 0.45 * w.sneeuw - 0.3 * w.onweer, 0.25, 1);
    this.schermKans = smooth(0.12, 0.45, w.regen + 0.5 * w.sneeuw);
    this.nat = w.regen + w.sneeuw;
    // sneeuw op de rijbaan, precies zoals tekenWegdetail in infra.js hem legt (daar ruimt de sneeuwschuiver)
    this.wegSneeuw = clamp(Math.max(w.sneeuw * 1.8, (this.sz.sneeuw - 0.6) * 2.5), 0, 1);
    this.windX = Math.cos(this.wnd.hoek);
    this.windY = Math.sin(this.wnd.hoek);
  }

  // Wereldpunt in beeld (met marge in wereldeenheden)?
  inBeeld(wx, wy, m) { return wx > this.wx0 - m && wx < this.wx1 + m && wy > this.wy0 - m && wy < this.wy1 + m; }

  // Eigenaar van een tegel voor de dichtheid: de huidige eigenaar, anders de vaste.
  landVan(t) {
    const e = this.state.eigenaar?.[t];
    return e != null && e >= 0 ? e : this.geo.tegels[t].eig;
  }

  // Zichtbaar deel van de wereld en de tegels daarin (met een tegel marge). Nooit alle tegels aflopen.
  kader(view, sc) {
    const geo = this.geo;
    const [wx0, wy0] = view.naarWereld(0, 0);
    const [wx1, wy1] = view.naarWereld(view.w, view.h);
    this.sc = sc;
    this.T = geo.T * sc;
    this.ox = view.w / 2 - view.cx * sc;
    this.oy = view.h / 2 - view.cy * sc;
    this.wx0 = wx0; this.wy0 = wy0; this.wx1 = wx1; this.wy1 = wy1;
    this.w = view.w; this.h = view.h;
    this.k0 = Math.max(0, Math.floor(wx0 / geo.T) - 1);
    this.k1 = Math.min(geo.kol - 1, Math.floor(wx1 / geo.T) + 1);
    this.r0 = Math.max(0, Math.floor(wy0 / geo.T) - 1);
    this.r1 = Math.min(geo.rij - 1, Math.floor(wy1 / geo.T) + 1);
  }

  // ---------- auto's ----------

  // Tunnels uit de infralaag, per weg (dezelfde sleutel: gebouw * 4099 + knooppunt). Daar rijdt niets over
  // de berg: de auto zit in de tunnel en is even uit beeld.
  verzamelTunnels(view) {
    const t = this.tunnels ??= [];
    let n = 0;
    const W = view.infraLaag?.wegen;
    if (W) for (let i = 0; i < W.length; i++) if (W[i].tunnel) { t[n++] = W[i].zaad; t[n++] = W[i].tunnel; }
    t.length = n;
  }

  heeftTunnel(zaad) {
    const t = this.tunnels;
    if (t) for (let i = 0; i < t.length; i += 2) if (t[i] === zaad) return true;
    return false;
  }

  inTunnel(zaad, q) {
    const t = this.tunnels;
    for (let i = 0; i < t.length; i += 2) {
      if (t[i] !== zaad) continue;
      const r = t[i + 1];
      for (let j = 0; j < r.length; j += 2) if (q > r[j] - 0.3 && q < r[j + 1] + 0.3) return true;
    }
    return false;
  }

  // Welke weg van de infralaag hoort bij elke weg hier (zelfde zaad: gebouw * 4099 + knooppunt)? Daar staan de
  // stopstrepen, zebra's en het wegwerk. Alleen opnieuw zoeken als een van beide wegenlijsten verandert.
  koppelInfra(view) {
    const inf = view.infraLaag ?? null, IW = inf?.wegen ?? null;
    if (inf === this.inf && IW === this.infW && this.koppelSig === this.cacheSig && this.infraIdx.length === this.nWegen) return;
    this.inf = inf; this.infW = IW; this.koppelSig = this.cacheSig;
    const k = (this.infraIdx = new Int32Array(this.nWegen).fill(-1));
    if (!IW) return;
    for (let w = 0; w < this.nWegen; w++) {
      const z = this.wegen[w * WEG + 6];
      for (let i = 0; i < IW.length; i++) if (IW[i].zaad === z) { k[w] = i; break; }
    }
  }

  // Eén voertuig in de buffer (schermcoördinaten), met de weg die verzamelAutos nu afloopt: niets in een tunnel, en
  // langs wegwerk slingeren. Wie buiten beeld rijdt telt niet mee voor het plafond.
  zetAuto(wx, wy, hx, hy, kleur, soort, rem = 0, knip = 0, fase = 0) {
    if (this.nAuto >= PLAFOND.autos) return;
    const Tw = this.geo.T, wg = this.wg;
    const q = (wx - wg.ax) * wg.ux + (wy - wg.ay) * wg.uy;
    if (wg.tunnel && this.inTunnel(wg.zaad, q)) return;
    if (wg.werk) {
      // wie op de half afgesloten strook rijdt, slingert naar het midden; de tegenligger wijkt wat uit
      const b = this.bult(q);
      if (b > 0) {
        const baan = hx * wg.ux + hy * wg.uy > 0 ? 1 : -1, nx = -wg.uy * baan, ny = wg.ux * baan;
        const sch = (baan === wg.kant ? -0.85 : 0.4) * BAAN * Tw, d = 0.06 * Tw;
        wx += nx * sch * b; wy += ny * sch * b;
        // schuin in de bocht: de helling van het slingeren in de rijrichting
        const hel = ((this.bult(q + baan * d) - b) * sch) / d;
        hx += nx * hel; hy += ny * hel;
        const l = Math.hypot(hx, hy); hx /= l; hy /= l;
      }
    }
    const x = wx * this.sc + this.ox, y = wy * this.sc + this.oy;
    if (x < -20 || y < -20 || x > this.w + 20 || y > this.h + 20) return;
    const o = this.nAuto++ * AUTO, b = this.auto;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = kleur; b[o + 5] = soort;
    b[o + 6] = rem; b[o + 7] = knip; b[o + 8] = fase;
  }

  // 0..1: hoe ver een auto op afstand q (vanaf A) voor het wegwerk opzij moet.
  bult(q) {
    const Tw = this.geo.T, wg = this.wg;
    return smooth(wg.q0 - 0.3 * Tw, wg.q0 - 0.04 * Tw, q) * (1 - smooth(wg.q1 + 0.04 * Tw, wg.q1 + 0.3 * Tw, q));
  }

  verzamelAutos() {
    const s = this.state, W = this.wegen, Tw = this.geo.T, sc = this.sc;
    const marge = Tw;
    const nachtKans = 1 - 0.4 * this.nachtVorig;
    const MAX = PLAFOND.autos;
    const IW = this.infW, inf = this.inf, dag = s.dag ?? 0, wg = this.wg;
    this.nAuto = 0;
    this.nWacht = 0; this.nSpoor = 0; this.nVuil = 0;
    const mx0 = -20, my0 = -20, mx1 = this.w + 20, my1 = this.h + 20;
    // sneeuw op de weg (dan rijden er schuivers en strooiers), ochtend (vuilniswagens), dag (veegwagens)
    const sneeuw = this.sz.sneeuw > 0.3 || this.wr.sneeuw > 0.25;
    const dagFase = frac(this.nu / 180000), ochtend = dagFase > 0.68 && dagFase < 0.95;
    for (let w = 0; w < this.nWegen && this.nAuto < MAX; w++) {
      const o = w * WEG;
      const ax = W[o], ay = W[o + 1], bx = W[o + 2], by = W[o + 3];
      if ((ax > bx ? ax : bx) < this.wx0 - marge || (ax < bx ? ax : bx) > this.wx1 + marge) continue;
      if ((ay > by ? ay : by) < this.wy0 - marge || (ay < by ? ay : by) > this.wy1 + marge) continue;
      const len = W[o + 4], zaad = W[o + 6] | 0, ux = W[o + 7], uy = W[o + 8];
      const iw = IW ? this.infraIdx[w] : -1, iweg = iw >= 0 ? IW[iw] : null;
      wg.ax = ax; wg.ay = ay; wg.ux = ux; wg.uy = uy; wg.zaad = zaad; wg.tunnel = this.heeftTunnel(zaad);
      wg.werk = !!iweg && inf.werkOp(iweg, dag);
      if (wg.werk) { wg.q0 = inf.werk0; wg.q1 = inf.werk1; wg.kant = inf.werkKant; }
      const d = levenDichtheid(s, W[o + 5]);
      // Niet over de gebouwen aan de uiteinden rijden: de auto 'verdwijnt' in de garage.
      const rand = Math.min(0.45, (Tw * 0.42) / len), rijd = 1 - 2 * rand;
      const konvooi = d.oorlog && len >= 1.5 * Tw;
      const totaal = clamp(Math.round((len / Tw) * 2 * d.autoFactor), 0, 4);
      const autos = konvooi ? Math.round(totaal * 0.65) : totaal;
      // Trage voertuigen per rijstrook (de stadsbus, een werkwagen) eerst kiezen: de stroom blijft erachter.
      const tr0 = this.traag[0], tr1 = this.traag[1];
      tr0.aan = tr1.aan = false;
      // Stadsbus op lange wegen: rijdt, stopt bij twee haltes, rijdt door.
      if (len >= 2 * Tw && this.n.bussen < PLAFOND.bussen && hash(zaad, 71) < 0.25 + 0.3 * Math.min(1, d.welvaart) && !d.ziek) {
        const baan = hash(zaad, 73) < 0.5 ? 1 : -1;
        this.traagKies(baan, 2, d.gedempt ? 9 : BUS, AUTO_SNELHEID * Tw * 0.7, 2, 0.14, hash(zaad, 72), hash(zaad, 74), 'bussen', len, rand, rijd);
        // de haltes zelf: een abri op de berm aan de kant waar de bus stopt
        for (let hI = 1; hI <= 2 && this.nHalte < PLAFOND.haltes; hI++) {
          const hp = rand + (hI / 3) * rijd, kant = baan * 0.085 * Tw;
          const x = (ax + (bx - ax) * hp - uy * kant) * sc + this.ox, y = (ay + (by - ay) * hp + ux * kant) * sc + this.oy;
          if (x < mx0 || y < my0 || x > mx1 || y > my1) continue;
          const o = this.nHalte++ * 4;
          this.halte[o] = x; this.halte[o + 1] = y; this.halte[o + 2] = ux; this.halte[o + 3] = uy;
        }
      }
      // Werkverkeer: langzaam, met een zwaailicht, en het laat een spoor na.
      this.werkverkeer(zaad, len, rand, rijd, d, sneeuw, ochtend);
      // Rijstroken met een stopstreep (verkeerslicht of zebra) rijden als een stroom die voor rood wacht; de andere
      // rijden vrij rond zoals altijd. vrij: 0 beide stroken vrij, 1 of -1 alleen die, 2 geen.
      const stops = iweg ? iweg.stops : null;
      let vrij = 0;
      if (stops && (autos > 0 || tr0.aan || tr1.aan)) {
        const heen = this.stroom(len, rand, zaad, 1, stops, autos ? Math.max(0.3, Math.ceil(autos / 2)) : 0, d, nachtKans);
        const terug = this.stroom(len, rand, zaad, -1, stops, autos ? Math.max(0.5, Math.floor(autos / 2)) : 0, d, nachtKans);
        vrij = heen && terug ? 2 : heen ? -1 : terug ? 1 : 0;
      }
      for (let i = 0; i < autos && this.nAuto < MAX && vrij !== 2; i++) {
        if (hash(zaad, i, 13) > nachtKans) continue;
        const baan = i & 1 ? -1 : 1;
        if (vrij && baan !== vrij) continue;
        const v = AUTO_SNELHEID * Tw * (0.85 + 0.3 * hash(zaad, i, 5));
        let f = frac(this.klok * v / len + hash(zaad, i));
        if (baan < 0) f = 1 - f;
        const p = rand + f * rijd;
        // Een deel van het verkeer is een taxi (welvarend, niet in een gedempt regime), een bestelbus of op lange
        // wegen een vrachtwagen met oplegger.
        const r = hash(zaad, i, 17);
        let kleur = (d.gedempt ? 8 : 0) + Math.floor(hash(zaad, i, 3) * 8), soort = 0;
        if (r < 0.1 && d.welvaart > 0.7 && !d.gedempt) { soort = 4; kleur = TAXI; }
        else if (r < 0.24) { soort = 3; if (hash(zaad, i, 18) < 0.7) kleur = BESTEL; }
        else if (r < 0.31 && len >= 1.6 * Tw && this.n.opleggers < PLAFOND.opleggers) soort = OPLEGGER;
        // vlak voor het eind slaat een deel af, de garage in: knipperlicht aan die kant
        const rest = baan > 0 ? 1 - f : f;
        const knip = rest < 0.14 && hash(zaad, i, 19) < 0.45 ? (hash(zaad, i, 20) < 0.5 ? -1 : 1) : 0;
        // Rechts rijden: de strook ligt rechts van de rijrichting.
        const voor = this.nAuto;
        this.zetAuto(ax + (bx - ax) * p - baan * uy * BAAN * Tw, ay + (by - ay) * p + baan * ux * BAAN * Tw, ux * baan, uy * baan, kleur, soort, 0, knip, hash(zaad, i, 21));
        if (soort === OPLEGGER && this.nAuto > voor) this.n.opleggers++;
      }
      // de trage voertuigen op hun plek (achter de rij voor het licht als ze die inhaalden)
      for (let k = 0; k < 2 && this.nAuto < MAX; k++) {
        const tr = this.traag[k];
        if (!tr.aan) continue;
        const baan = k ? -1 : 1, p = baan > 0 ? tr.pos : len - tr.pos, voor = this.nAuto;
        this.zetAuto(ax + ux * p - baan * uy * BAAN * Tw, ay + uy * p + baan * ux * BAAN * Tw, ux * baan, uy * baan, tr.kleur, tr.soort, tr.rem, tr.knip, tr.fase);
        if (this.nAuto > voor) this.n[tr.plafond]++;
      }
      // Bij onrust, oorlog of ziekte: politie en ambulances, sneller dan het gewone verkeer en door rood.
      if ((d.oorlog || d.onrust || d.protest > 0.4 || d.ziek) && this.nAuto < MAX && this.n.hulpdiensten < PLAFOND.hulpdiensten && hash(zaad, 81) < (d.oorlog || d.ziek ? 0.45 : 0.3)) {
        const amb = (d.oorlog || d.ziek) && hash(zaad, 82) < 0.55;
        const baan = hash(zaad, 83) < 0.5 ? 1 : -1;
        let f = frac(this.klok * AUTO_SNELHEID * Tw * 1.7 / len + hash(zaad, 84));
        if (baan < 0) f = 1 - f;
        const p = rand + f * rijd;
        const voor = this.nAuto;
        this.zetAuto(ax + (bx - ax) * p - baan * uy * BAAN * Tw, ay + (by - ay) * p + baan * ux * BAAN * Tw, ux * baan, uy * baan, amb ? AMBU : POLITIE, amb ? 6 : 5, 0, 0, hash(zaad, 85));
        if (this.nAuto > voor) this.n.hulpdiensten++;
      }
      if (konvooi) {
        // Oorlog: een konvooi van drie olijfgroene trucks met vaste tussenruimte.
        const baan = hash(zaad, 7) < 0.5 ? 1 : -1;
        const f0 = frac(this.klok * AUTO_SNELHEID * Tw * 0.75 / len + hash(zaad, 99));
        const stap = (0.25 * Tw) / (len * rijd);
        for (let j = 0; j < 3 && this.nAuto < MAX; j++) {
          let f = frac(f0 - j * stap);
          if (baan < 0) f = 1 - f;
          const p = rand + f * rijd;
          this.zetAuto(ax + (bx - ax) * p - baan * uy * BAAN * Tw, ay + (by - ay) * p + baan * ux * BAAN * Tw, ux * baan, uy * baan, TRUCK, 1, 0, 0, hash(zaad, j, 98));
        }
      }
    }
  }

  // Een rijstrook met stopstrepen (verkeerslicht of zebra, zie w.stops in infra.js): een stroom auto's die elk op een
  // vast moment uit de garage komen (volgnummer · tussenpoos plus een vaste schommeling). Wie bij oranje of rood
  // aankomt, remt af en sluit achteraan de rij; bij groen trekken ze een voor een op. Alles volgt uit zaad en klok:
  // hoe lang een auto wacht, hangt alleen af van het licht en van de auto's die in dezelfde lichtcyclus voor hem
  // aankwamen, dus dezelfde klok geeft altijd dezelfde rij. Geeft false als deze richting geen stopstreep heeft.
  stroom(len, rand, zaad, baan, stops, nBaan, d, nachtKans) {
    const Tw = this.geo.T, t = this.klok, dNu = this.dNu, wg = this.wg;
    const S = this.stS, SP = this.stP, SO = this.stO, SG = this.stG;
    // stops in de rijrichting, als plek van het midden van de auto wanneer zijn neus bij de streep is
    const sB = rand * len, sE = len - rand * len, hl = 0.055 * Tw;
    let nS = 0, Pm = 0;
    for (let i = 0; i < stops.length && nS < MAX_STOP; i += STOP) {
      if (stops[i + 1] !== baan) continue;
      const sc = (baan > 0 ? stops[i] : len - stops[i]) - hl;
      if (sc < sB + 0.02 * Tw || sc > sE - 0.02 * Tw) continue;
      let k = nS++;
      while (k > 0 && S[k - 1] > sc) { S[k] = S[k - 1]; SP[k] = SP[k - 1]; SO[k] = SO[k - 1]; SG[k] = SG[k - 1]; k--; }
      S[k] = sc; SP[k] = stops[i + 2]; SO[k] = stops[i + 3]; SG[k] = stops[i + 4];
      if (stops[i + 2] / 1000 > Pm) Pm = stops[i + 2] / 1000;
    }
    if (!nS) return false;
    const v = AUTO_SNELHEID * Tw * (0.9 + 0.2 * hash(zaad, baan + 2, 5));
    const D = (sE - sB) / v;
    const tus = Math.max(2.2, D / Math.max(0.3, nBaan)), dl = clamp(0.3 * tus, 0.15, 0.6);
    const tau = 0.8, gap = 0.15 * Tw;
    // genoeg auto's terug in de tijd dat elke rij van nu compleet is (een lichtcyclus per stop, ruim genomen)
    const jHi = Math.floor(t / tus);
    let jLo = Math.floor((t - D - nS * (2 * Pm + 2) - 2) / tus) - 1;
    if (jHi - jLo + 1 > MAXJ) jLo = jHi - MAXJ + 1;
    const nJ = jHi - jLo + 1;
    const T0 = this.sT0, EX = this.sEx, PRE = this.sPre, AR = this.sAr, DE = this.sDe, AS = this.sAs, LP = this.sLp, SL = this.sSl, ST = this.sSt;
    PRE[0] = 0;
    for (let k = 0; k < nJ; k++) {
      const j = jLo + k;
      T0[k] = (j + 0.6 * hash(zaad, j, 40 + baan)) * tus;
      EX[k] = nBaan > 0 && hash(zaad, j, 43 + baan) <= nachtKans ? 1 : 0;
      PRE[k + 1] = PRE[k] + EX[k];
    }
    // 1. per stop: aankomst bij de streep, vertrek en de plek in de rij
    for (let i = 0; i < nS; i++) {
      const sc = S[i], Pms = SP[i], P = Pms / 1000, o = SO[i], g = SG[i], b = i * MAXJ;
      let p1 = 0, p2 = 0, vorige = -1;
      for (let k = 0; k < nJ; k++) {
        if (!EX[k]) continue;
        const a = i === 0 ? T0[k] + (sc - sB) / v : DE[b - MAXJ + k] + (sc - S[i - 1]) / v;
        AR[b + k] = a;
        // het licht bij aankomst, in dezelfde fase als infra.js en stad.js het tekenen (klok in ms plus het verschil met nu)
        const f = frac((a * 1000 + dNu) / Pms + o), rood = f >= g;
        const gS = rood ? a + (1 - f) * P : a - f * P, W0 = rood ? a - (f - g) * P : gS - (1 - g) * P;
        // wie sinds het begin van dit rood aankwam gaat voor; wie de streep al over is, houdt niemand meer op
        while (p1 < k && (!EX[p1] || AR[b + p1] < W0)) p1++;
        if (p2 < p1) p2 = p1;
        while (p2 < k && (!EX[p2] || DE[b + p2] <= a)) p2++;
        const c = PRE[k] - PRE[p1];
        const dep = rood ? gS + c * dl : Math.max(a, gS + c * dl);
        if (dep - a <= 0.05) { ST[b + k] = 0; DE[b + k] = a; vorige = k; continue; }
        let sl = sc - (PRE[k] - PRE[p2]) * gap;
        // staat de auto voor hem er nog, dan sluit hij daar achter aan
        if (vorige >= 0 && ST[b + vorige] && LP[b + vorige] + tau > a - (sc - sl) / v && sl > SL[b + vorige] - gap) sl = SL[b + vorige] - gap;
        const as = a - (sc - sl) / v, lp = Math.max(dep - (sc - sl) / v, as + tau / 2);
        ST[b + k] = 1; AS[b + k] = as; LP[b + k] = lp; SL[b + k] = sl;
        DE[b + k] = lp + tau / 2 + (sc - sl) / v;
        vorige = k;
      }
    }
    // 2. waar elke auto nu is: vrij rijden, afremmen naar zijn plek in de rij, wachten, optrekken, doorrijden
    // van voor naar achter: wie zijn voorganger inhaalt (een rij die tot over de vorige stopstreep terugloopt), blijft
    // er op een autolengte achter staan
    // het trage voertuig van deze strook staat in de rij tussen wie voor en na hem de weg op kwam
    const tr = this.traag[baan > 0 ? 0 : 1];
    let kop = Infinity, kopRem = 0, trKlaar = !tr.aan;
    for (let k = 0; k < nJ && this.nAuto < PLAFOND.autos; k++) {
      if (!trKlaar && EX[k] && T0[k] > tr.t0) {
        trKlaar = true;
        if (tr.pos > kop - gap - tr.lang) { tr.pos = kop - gap - tr.lang; tr.rem = kopRem ? 0.9 : 0; }
        kop = tr.pos - tr.lang; kopRem = tr.rem;
      }
      if (!EX[k] || T0[k] > t) continue;
      let pT = T0[k], pS = sB, pos = 0, klaar = false, rem = 0;
      for (let i = 0; i < nS && !klaar; i++) {
        const ki = i * MAXJ + k;
        if (!ST[ki]) continue;
        const as = AS[ki], lp = LP[ki], sl = SL[ki];
        klaar = true;
        if (t < as - tau / 2) pos = pS + v * (t - pT);
        else if (t < as + tau / 2) { const u = (t - as + tau / 2) / tau; pos = sl - v * tau * 0.5 * (1 - u) * (1 - u); rem = 1; }
        else if (t < lp) { pos = sl; rem = 1; }
        else if (t < lp + tau) { const u = (t - lp) / tau; pos = sl + v * tau * 0.5 * u * u; }
        else { pT = lp + tau / 2; pS = sl; klaar = false; }
      }
      if (!klaar) pos = pS + v * (t - pT);
      if (pos > kop - gap) { pos = kop - gap; rem = kopRem; }
      kop = pos; kopRem = rem;
      if (pos < sB || pos > sE) continue;
      const j = jLo + k, r = hash(zaad, j, 17 + baan);
      let kleur = (d.gedempt ? 8 : 0) + Math.floor(hash(zaad, j, 4 + baan) * 8), soort = 0;
      if (r < 0.1 && d.welvaart > 0.7 && !d.gedempt) { soort = 4; kleur = TAXI; }
      else if (r < 0.24) { soort = 3; if (hash(zaad, j, 18) < 0.7) kleur = BESTEL; }
      const knip = sE - pos < 0.3 * Tw && hash(zaad, j, 19 + baan) < 0.45 ? (hash(zaad, j, 22) < 0.5 ? -1 : 1) : 0;
      const p = baan > 0 ? pos : len - pos, voor = this.nAuto;
      this.zetAuto(wg.ax + wg.ux * p - baan * wg.uy * BAAN * Tw, wg.ay + wg.uy * p + baan * wg.ux * BAAN * Tw, wg.ux * baan, wg.uy * baan, kleur, soort, rem, knip, hash(zaad, j, 21));
      if (rem && this.nAuto > voor) this.nWacht++;
    }
    if (!trKlaar && tr.pos > kop - gap - tr.lang) { tr.pos = kop - gap - tr.lang; tr.rem = kopRem ? 0.9 : 0; }
    return true;
  }

  // Werkverkeer op de weg van verzamelAutos: 's ochtends de vuilniswagen (stopt om de paar huizen; dan staan er twee
  // man met een kliko naast), bij sneeuw de sneeuwschuiver of de strooiwagen (oranje, met zwaailicht) en overdag bij
  // droog weer een veegwagen. Langzaam en vast per weg; het spoor dat ze nalaten tekent tekenAutos.
  werkverkeer(zaad, len, rand, rijd, d, sneeuw, ochtend) {
    if (d.oorlog || d.ziek) return;
    const V = AUTO_SNELHEID * this.geo.T;
    // werkverkeer
    if (ochtend && hash(zaad, 151) < 0.3) this.werkwagen(zaad, len, rand, rijd, VUIL, d.gedempt ? 13 : VUILKLEUR, V * 0.35, 4, 0.12, 151, 'vuilniswagens');
    if (sneeuw && hash(zaad, 152) < 0.35) this.werkwagen(zaad, len, rand, rijd, this.wegSneeuw > 0.15 && hash(zaad, 154) < 0.5 ? SCHUIVER : STROOI, WINTERKLEUR, V * 0.5, 0, 0, 152, 'strooiers');
    else if (!sneeuw && this.nachtVorig < 0.35 && this.nat < 0.5 && hash(zaad, 153) < 0.18) this.werkwagen(zaad, len, rand, rijd, VEEG, VEEGKLEUR, V * 0.25, 0, 0, 153, 'veegwagens');
  }

  werkwagen(zaad, len, rand, rijd, soort, kleur, v, stops, dw, kh, plafond) {
    this.traagKies(hash(zaad, kh, 1) < 0.5 ? 1 : -1, soort, kleur, v, stops, dw, hash(zaad, kh, 2), hash(zaad, kh, 3), plafond, len, rand, rijd);
  }

  // Een traag voertuig op een rijstrook (hoogstens een per strook): rijdt in een vaste ronde van de garage naar de
  // overkant met stops (bus bij de haltes, vuilniswagen bij de huizen). pos is de afstand in de rijrichting, t0 het
  // moment dat hij aan deze ronde begon; wie daarna de weg op kwam, rijdt erachter (zie stroom).
  traagKies(baan, soort, kleur, v, stops, dw, u0, fase, plafond, len, rand, rijd) {
    const tr = this.traag[baan > 0 ? 0 : 1];
    if (tr.aan || this.n[plafond] >= PLAFOND[plafond]) return;
    const P = (len * rijd) / v / (1 - stops * dw), u = frac(this.klok / P + u0);
    const f = stops ? haltePos(u, stops, dw) : u, staat = stops > 0 && haltePos(u + 0.002, stops, dw) === f;
    tr.aan = true; tr.soort = soort; tr.kleur = kleur; tr.plafond = plafond; tr.fase = fase;
    tr.pos = (rand + f * rijd) * len; tr.t0 = this.klok - u * P;
    // bij de halte: remlicht aan en (de bus) het knipperlicht naar de stoep
    tr.rem = staat ? 1 : 0; tr.knip = staat && soort === 2 ? 1 : 0;
    tr.lang = (MAAT[soort][0] - 0.05) * this.geo.T;
  }

  tekenAutos(c, a, nu = 0) {
    const n = this.nAuto, b = this.auto, T = this.T;
    this.zwaai = false;
    if (!n || a <= 0) return;
    c.globalAlpha = a;
    if (T >= 120) this.tekenSporen(c);
    // schaduw naar het zuidoosten (licht uit het noordwesten)
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * AUTO, m = MAAT[b[o + 5]];
      rechthoek(c, b[o] + T * 0.01, b[o + 1] + T * 0.014, b[o + 2], b[o + 3], T * m[0], T * m[1]);
    }
    c.fill();
    // carrosserie, één pad per kleur
    for (let k = 0; k <= LAATSTE_KLEUR; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * AUTO;
        if (b[o + 4] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        const m = MAAT[b[o + 5]];
        rechthoek(c, b[o], b[o + 1], b[o + 2], b[o + 3], T * m[0], T * m[1]);
      }
      if (open) { c.fillStyle = k === TRUCK ? TRUCK_KLEUR : k < 8 ? AUTO_KLEUREN[k] : k < 16 ? AUTO_GEDEMPT[k - 8] : KLEUR_VOERTUIG[k]; c.fill(); }
    }
    if (this.n.opleggers || this.werkwagens()) this.tekenOpbouw(c, nu);
    // dak (auto), laadbak met zeil (truck), cabine (bestelbus); de bus krijgt een licht dak
    c.fillStyle = 'rgba(0,0,0,0.24)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * AUTO, hx = b[o + 2], hy = b[o + 3], s = b[o + 5];
      if (s === 1) rechthoek(c, b[o] - hx * T * 0.022, b[o + 1] - hy * T * 0.022, hx, hy, T * 0.055, T * 0.03);
      else if (s === 3) rechthoek(c, b[o] + hx * T * 0.042, b[o + 1] + hy * T * 0.042, hx, hy, T * 0.012, T * 0.026);
      else if (s !== 2 && s < OPLEGGER) rechthoek(c, b[o] - hx * T * 0.006, b[o + 1] - hy * T * 0.006, hx, hy, T * 0.024, T * 0.021);
    }
    c.fill();
    if (T * 0.1 >= 9) {
      // bus: lichte dakrand en ramen langs beide zijden en voorop
      c.fillStyle = 'rgba(255,255,255,0.2)';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * AUTO;
        if (b[o + 5] === 2) rechthoek(c, b[o], b[o + 1], b[o + 2], b[o + 3], T * 0.1, T * 0.022);
      }
      c.fill();
      c.fillStyle = 'rgba(30,45,60,0.75)';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * AUTO, hx = b[o + 2], hy = b[o + 3];
        if (b[o + 5] !== 2) continue;
        rechthoek(c, b[o] + hy * T * 0.028, b[o + 1] - hx * T * 0.028, hx, hy, T * 0.09, T * 0.004);
        rechthoek(c, b[o] - hy * T * 0.028, b[o + 1] + hx * T * 0.028, hx, hy, T * 0.09, T * 0.004);
        rechthoek(c, b[o] + hx * T * 0.108, b[o + 1] + hy * T * 0.108, hx, hy, T * 0.004, T * 0.026);
      }
      c.fill();
      // strepen: blauw dwars over de politieauto, rood in de lengte over de ambulance; taxibord op het dak
      for (let k = 0; k < 3; k++) {
        let open = false;
        for (let i = 0; i < n; i++) {
          const o = i * AUTO, s = b[o + 5], hx = b[o + 2], hy = b[o + 3];
          if (s !== (k === 0 ? 5 : k === 1 ? 6 : 4)) continue;
          if (!open) { c.beginPath(); open = true; }
          if (k === 0) rechthoek(c, b[o] + hx * T * 0.012, b[o + 1] + hy * T * 0.012, hx, hy, T * 0.008, T * 0.029);
          else if (k === 1) rechthoek(c, b[o], b[o + 1], hx, hy, T * 0.06, T * 0.006);
          else rechthoek(c, b[o] - hx * T * 0.004, b[o + 1] - hy * T * 0.004, hx, hy, T * 0.005, T * 0.012);
        }
        if (open) { c.fillStyle = k === 0 ? '#2d5fb8' : k === 1 ? '#c8322b' : '#fff6c8'; c.fill(); }
      }
      // voorruit
      c.fillStyle = 'rgba(190,215,235,0.75)';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * AUTO, s = b[o + 5];
        if (s === 1 || s === 2) continue;
        const f = s === 3 ? 0.058 : s === 6 ? 0.056 : s >= OPLEGGER ? MAAT[s][0] - 0.01 : 0.024;
        rechthoek(c, b[o] + b[o + 2] * T * f, b[o + 1] + b[o + 3] * T * f, b[o + 2], b[o + 3], T * 0.006, T * 0.02);
      }
      c.fill();
    }
    if (T >= DETAIL_T) this.autoDetail(c, nu);
    // zwaailichten: blauw en rood om en om op 2,5 Hz (de ambulance alleen blauw)
    for (let kleur = 0; kleur < 2; kleur++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * AUTO, s = b[o + 5];
        if (s !== 5 && s !== 6) continue;
        this.zwaai = true;
        const aan = (Math.floor(nu / 200) + i) & 1;
        if (kleur === 0 ? !aan : aan || s === 6) continue;
        if (!open) { c.beginPath(); open = true; }
        const zij = kleur ? -1 : 1;
        stip(c, b[o] - b[o + 3] * zij * T * 0.01, b[o + 1] + b[o + 2] * zij * T * 0.01, Math.max(1, T * 0.008));
      }
      if (open) { c.fillStyle = kleur ? '#ff4a3a' : '#4d8dff'; c.fill(); }
    }
    c.globalAlpha = 1;
  }

  // ---------- voertuigdetail ----------

  // Hoeveel werkwagens (vuilniswagen, schuiver of strooier, veegwagen) er deze frame rijden.
  werkwagens() { return this.n.vuilniswagens + this.n.strooiers + this.n.veegwagens; }

  // Eén pad in één kleur voor alle voertuigen waarvoor vorm(o, soort, i) iets toevoegt (en dan true geeft).
  autoPas(c, kleur, vorm, lijn = false) {
    const n = this.nAuto, b = this.auto;
    let k = 0;
    c.beginPath();
    for (let i = 0; i < n; i++) if (vorm(i * AUTO, b[i * AUTO + 5], i)) k++;
    if (!k) return;
    if (lijn) { c.strokeStyle = kleur; c.stroke(); } else { c.fillStyle = kleur; c.fill(); }
  }

  // Rechthoek en stip op een plek in het voertuig: f tegels naar voren, z tegels naar rechts (de stoepkant).
  rt(c, o, f, z, l, w) {
    const b = this.auto, T = this.T, hx = b[o + 2], hy = b[o + 3];
    rechthoek(c, b[o] + (hx * f - hy * z) * T, b[o + 1] + (hy * f + hx * z) * T, hx, hy, l * T, w * T);
    return true;
  }
  st(c, o, f, z, r) {
    const b = this.auto, T = this.T, hx = b[o + 2], hy = b[o + 3];
    stip(c, b[o] + (hx * f - hy * z) * T, b[o + 1] + (hy * f + hx * z) * T, Math.max(0.6, r * T));
    return true;
  }

  // Wat voertuigen op de weg achterlaten: een geschoven baan met een richel sneeuw achter de sneeuwschuiver, zout
  // achter de strooiwagen, een natte baan achter de veegwagen en opspattend water achter alles wat rijdt in de regen.
  tekenSporen(c) {
    const T = this.T, regen = this.wr.regen > 0.25 && T >= 150, klok = Math.floor(this.klok * 6);
    if (!regen && !this.werkwagens()) return;
    if (this.n.strooiers) {
      // de geschoven baan en de richel zie je alleen zo sterk als er sneeuw op de weg ligt
      const ga = c.globalAlpha;
      c.globalAlpha = ga * clamp(this.wegSneeuw * 1.25, 0, 1);
      this.autoPas(c, 'rgba(72,75,80,0.6)', (o, s) => s === SCHUIVER && this.rt(c, o, -MAAT[s][0] - 0.19, 0, 0.19, 0.034));
      this.autoPas(c, 'rgba(250,252,255,0.92)', (o, s) => s === SCHUIVER && this.rt(c, o, -MAAT[s][0] - 0.17, 0.04, 0.18, 0.006));
      c.globalAlpha = ga;
      this.autoPas(c, 'rgba(214,206,190,0.9)', (o, s) => {
        if (s !== STROOI) return false;
        for (let k = 0; k < 14; k++) this.st(c, o, -0.076 - 0.02 * k - 0.012 * hash(k, klok, 1), (hash(k, klok, 2) - 0.5) * (0.016 + 0.004 * k), 0.0028);
        return true;
      });
    }
    if (this.n.veegwagens) this.autoPas(c, 'rgba(35,42,50,0.25)', (o, s) => s === VEEG && this.rt(c, o, -0.05 - 0.16, 0, 0.16, 0.03));
    if (regen) {
      const b = this.auto;
      this.autoPas(c, 'rgba(225,230,236,0.2)', (o, s) => {
        if (b[o + 6]) return false;
        const l = MAAT[s][0] + 0.018, w = MAAT[s][1] - 0.008;
        this.st(c, o, -l, w, 0.014); this.st(c, o, -l, -w, 0.014); this.st(c, o, -l - 0.016, 0, 0.012);
        return true;
      });
    }
  }

  // Opbouw van de vrachtwagen met oplegger en de werkwagens, plus het oranje zwaailicht van de werkwagens.
  tekenOpbouw(c, nu) {
    const b = this.auto, T = this.T, fijn = T >= 150;
    if (this.n.opleggers) {
      for (let k = 0; k < OPLEGGER_KLEUR.length; k++) this.autoPas(c, OPLEGGER_KLEUR[k], (o, s) => s === OPLEGGER && Math.floor(b[o + 8] * OPLEGGER_KLEUR.length) === k && this.rt(c, o, -0.02, 0, 0.09, 0.035));
      this.autoPas(c, 'rgba(0,0,0,0.32)', (o, s) => {
        if (s !== OPLEGGER) return false;
        this.rt(c, o, 0.071, 0, 0.002, 0.03);
        if (fijn) for (let j = 0; j < 8; j++) this.rt(c, o, -0.096 + 0.022 * j, 0, 0.0012, 0.035);
        return true;
      });
    }
    if (!this.werkwagens()) return;
    // vuilniswagen: witte cabine voorop, donkere pers achterop, ribben op de bak
    this.autoPas(c, '#e9e7df', (o, s) => s === VUIL && this.rt(c, o, 0.062, 0, 0.016, 0.034));
    this.autoPas(c, '#2a332d', (o, s) => {
      if (s !== VUIL) return false;
      this.rt(c, o, -0.068, 0, 0.01, 0.033);
      if (fijn) for (let j = 0; j < 4; j++) this.rt(c, o, -0.042 + 0.022 * j, 0, 0.0014, 0.034);
      return true;
    });
    // sneeuwschuiver: schuin blad voorop dat de sneeuw naar de stoepkant duwt; strooiwagen: bak met zout en strooischijf
    this.autoPas(c, '#8d9298', (o, s) => {
      if (s !== SCHUIVER) return false;
      const hx = b[o + 2], hy = b[o + 3], x = b[o], y = b[o + 1];
      const p = (f, z, eerst) => { const px = x + (hx * f - hy * z) * T, py = y + (hy * f + hx * z) * T; if (eerst) c.moveTo(px, py); else c.lineTo(px, py); };
      p(0.094, -0.046, true); p(0.078, 0.048); p(0.07, 0.048); p(0.086, -0.046); c.closePath();
      return true;
    });
    this.autoPas(c, '#6b5a46', (o, s) => s === STROOI && this.rt(c, o, -0.018, 0, 0.042, 0.028));
    this.autoPas(c, '#d8d0c0', (o, s) => s === STROOI && this.rt(c, o, -0.018, 0, 0.034, 0.02));
    this.autoPas(c, '#2b2d30', (o, s) => (s === STROOI ? this.st(c, o, -0.074, 0, 0.008) : s === SCHUIVER ? this.rt(c, o, -0.02, 0, 0.04, 0.028) : false));
    // veegwagen: twee gele borstels voorop die ronddraaien
    if (this.n.veegwagens) {
      this.autoPas(c, '#d1a93a', (o, s) => s === VEEG && this.st(c, o, 0.046, 0.03, 0.013) && this.st(c, o, 0.046, -0.03, 0.013));
      if (fijn) {
        c.lineWidth = Math.max(0.6, T * 0.002);
        this.autoPas(c, 'rgba(90,70,20,0.85)', (o, s) => {
          if (s !== VEEG) return false;
          const hx = b[o + 2], hy = b[o + 3];
          for (let z = -1; z <= 1; z += 2) {
            const mx = b[o] + (hx * 0.046 - hy * 0.03 * z) * T, my = b[o + 1] + (hy * 0.046 + hx * 0.03 * z) * T;
            const a = (nu / 90) * z, r = 0.012 * T, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
            c.moveTo(mx - ca, my - sa); c.lineTo(mx + ca, my + sa); c.moveTo(mx + sa, my - ca); c.lineTo(mx - sa, my + ca);
          }
          return true;
        }, true);
      }
    }
    // oranje zwaailicht op de cabine, om en om links en rechts
    this.autoPas(c, '#ffb020', (o, s) => s >= VUIL && this.st(c, o, MAAT[s][0] - 0.03, (Math.floor(nu / 260 + b[o + 8] * 4) & 1 ? 1 : -1) * 0.016, 0.006));
  }

  // Dichtbij: achter- en remlichten, koplampen, knipperlichten, spiegels, ruitenwissers in de regen, sneeuw op het dak,
  // de lichtbalk van politie en ambulance met een flits, en bij een stilstaande vuilniswagen twee man met een kliko.
  autoDetail(c, nu) {
    const b = this.auto, T = this.T;
    const lv = (s) => MAAT[s][0], wv = (s) => MAAT[s][1];
    const ruit = (s) => (s === 3 ? 0.05 : s === 6 ? 0.048 : s === 2 ? 0.104 : s >= OPLEGGER ? MAAT[s][0] - 0.012 : 0.018);
    this.autoPas(c, '#7e1a16', (o, s) => !b[o + 6] && this.rt(c, o, 0.002 - lv(s), wv(s) - 0.006, 0.002, 0.005) && this.rt(c, o, 0.002 - lv(s), 0.006 - wv(s), 0.002, 0.005));
    this.autoPas(c, '#ff3a2c', (o, s) => b[o + 6] > 0 && this.rt(c, o, 0.003 - lv(s), wv(s) - 0.006, 0.003, 0.007) && this.rt(c, o, 0.003 - lv(s), 0.006 - wv(s), 0.003, 0.007));
    this.autoPas(c, '#f4f0d8', (o, s) => this.rt(c, o, lv(s) - 0.002, wv(s) - 0.007, 0.002, 0.006) && this.rt(c, o, lv(s) - 0.002, 0.007 - wv(s), 0.002, 0.006));
    this.autoPas(c, '#ffae1a', (o, s) => {
      const k = b[o + 7];
      if (!k || !(Math.floor(nu / 380 + b[o + 8] * 3) & 1)) return false;
      const z = k * (wv(s) - 0.004);
      return this.rt(c, o, lv(s) - 0.003, z, 0.003, 0.004) && this.rt(c, o, 0.003 - lv(s), z, 0.003, 0.004);
    });
    this.autoPas(c, 'rgba(25,27,30,0.9)', (o, s) => (s === 0 || s >= 3) && s <= 6 && this.rt(c, o, ruit(s), wv(s) + 0.004, 0.003, 0.004) && this.rt(c, o, ruit(s), -wv(s) - 0.004, 0.003, 0.004));
    if (this.wr.regen > 0.15) {
      c.lineWidth = Math.max(0.6, T * 0.0018);
      this.autoPas(c, 'rgba(15,15,18,0.85)', (o, s) => {
        if (s === 1) return false;
        const hx = b[o + 2], hy = b[o + 3], f = ruit(s) - 0.005;
        const a = 0.7 + 0.7 * Math.sin(nu / 250 + b[o + 8] * TAU), ca = Math.cos(a) * 0.016, sa = Math.sin(a) * 0.009;
        for (let k = 0; k < 2; k++) {
          const z = -0.016 + 0.018 * k;
          c.moveTo(b[o] + (hx * f - hy * z) * T, b[o + 1] + (hy * f + hx * z) * T);
          c.lineTo(b[o] + (hx * (f + sa) - hy * (z + ca)) * T, b[o + 1] + (hy * (f + sa) + hx * (z + ca)) * T);
        }
        return true;
      }, true);
    }
    if (this.sz.sneeuw > 0.3 || this.wr.sneeuw > 0.3) {
      this.autoPas(c, 'rgba(246,248,251,0.92)', (o, s) => {
        if (b[o + 8] < 0.2 || s === SCHUIVER || s === STROOI) return false;
        if (s === 1 || s === OPLEGGER) return this.rt(c, o, -0.02, 0, 0.07, 0.028);
        if (s === 2) return this.rt(c, o, 0, 0, 0.09, 0.02);
        if (s === 3) return this.rt(c, o, -0.012, 0, 0.04, 0.024);
        if (s >= VUIL) return this.rt(c, o, -0.012, 0, 0.04, 0.026);
        return this.rt(c, o, -0.006, 0, 0.02, 0.017);
      });
    }
    // lichtbalk: donkere balk, de helft die aan is licht op; bij elke flits een gloed over het dak
    if (this.zwaaiDetail()) {
      this.autoPas(c, '#2b2f36', (o, s) => (s === 5 || s === 6) && this.rt(c, o, 0.004, 0, 0.004, 0.021));
      this.autoPas(c, '#8fbaff', (o, s, i) => (s === 5 || s === 6) && ((Math.floor(nu / 200) + i) & 1) === 1 && this.rt(c, o, 0.004, -0.011, 0.004, 0.009));
      this.autoPas(c, '#ff6a5a', (o, s, i) => s === 5 && ((Math.floor(nu / 200) + i) & 1) === 0 && this.rt(c, o, 0.004, 0.011, 0.004, 0.009));
      this.autoPas(c, 'rgba(110,160,255,0.16)', (o, s, i) => (s === 5 || s === 6) && ((Math.floor(nu / 200) + i) & 1) === 1 && this.st(c, o, 0.004, 0, 0.07));
    }
    // vuilniswagen bij een stop: twee man in oranje hesjes en een groene kliko aan de stoepkant
    if (this.n.vuilniswagens) {
      const man = (o, s) => s === VUIL && b[o + 6] === 1; // 0,9: wacht in de rij voor het licht
      this.autoPas(c, '#2f5c3a', (o, s) => man(o, s) && this.rt(c, o, 0.03 - lv(s) + 0.02 * Math.sin(this.klok * 2), wv(s) + 0.03, 0.007, 0.007));
      this.autoPas(c, '#ff7a1a', (o, s) => man(o, s) && this.st(c, o, -lv(s) - 0.014, wv(s) + 0.012, 0.009) && this.st(c, o, 0.012 - lv(s), wv(s) + 0.026, 0.009));
      this.autoPas(c, '#f2f2ee', (o, s) => man(o, s) && this.st(c, o, -lv(s) - 0.014, wv(s) + 0.011, 0.0048) && this.st(c, o, 0.012 - lv(s), wv(s) + 0.025, 0.0048));
    }
  }

  zwaaiDetail() {
    const b = this.auto;
    for (let i = 0; i < this.nAuto; i++) { const s = b[i * AUTO + 5]; if (s === 5 || s === 6) return true; }
    return false;
  }

  // Bushaltes: een abri met een glazen dak en een paaltje met het bord.
  tekenHaltes(c) {
    const n = this.nHalte, b = this.halte, T = this.T;
    if (!n || this.zoom < 6) return;
    c.globalAlpha = smooth(6, 7, this.zoom);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    for (let i = 0; i < n; i++) rechthoek(c, b[i * 4] + T * 0.006, b[i * 4 + 1] + T * 0.008, b[i * 4 + 2], b[i * 4 + 3], T * 0.02, T * 0.008);
    c.fill();
    c.fillStyle = 'rgba(170,205,225,0.85)';
    c.beginPath();
    for (let i = 0; i < n; i++) rechthoek(c, b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3], T * 0.02, T * 0.008);
    c.fill();
    c.fillStyle = '#2f7d6d';
    c.beginPath();
    for (let i = 0; i < n; i++) stip(c, b[i * 4] + b[i * 4 + 2] * T * 0.03, b[i * 4 + 1] + b[i * 4 + 3] * T * 0.03, Math.max(0.8, T * 0.005));
    c.fill();
    c.globalAlpha = 1;
  }

  // ---------- mensen ----------

  // Voetgangers op het straatcontract, mensen bij de ingang van gebouwen, en bij onrust protest en stakingen.
  tekenMenigte(c, nu) {
    const s = this.state, geo = this.geo;
    const straatAlpha = smooth(6.5, 8, this.zoom);
    const protestAlpha = smooth(4, 5, this.zoom);
    const nachtFactor = 1 - 0.6 * this.nachtVorig;
    const MAX = PLAFOND.mensen;
    this.nMens = 0;
    const Tw = geo.T;
    const bob = 0.004 * Tw;
    // 1. gewone voetgangers (vanaf zoom 6.5)
    if (straatAlpha > 0) {
      for (let r = this.r0; r <= this.r1 && this.nMens < MAX; r++) {
        for (let k = this.k0; k <= this.k1 && this.nMens < MAX; k++) {
          const t = r * geo.kol + k;
          const soort = this.soort[t];
          if (soort === LEEG) continue;
          const land = this.tegelLand[t];
          if (land < 0) continue;
          const d = levenDichtheid(s, land);
          const tg = geo.tegels[t];
          const x = tg.x, y = tg.y;
          if (soort === HOOFD || soort === WOON) {
            this.straatFiguren(t, soort, x, y, d, nachtFactor);
            if (soort === HOOFD) this.markt(t, x, y, d);
            const aantal = Math.round((soort === HOOFD ? MENSEN_PER_TEGEL.hoofdstad : MENSEN_PER_TEGEL.woonwijk) * d.mensenFactor * nachtFactor * this.buiten);
            for (let i = 0; i < aantal && this.nMens < MAX; i++) {
              const h = hash(t, i, 1);
              const snel = 0.05 + 0.03 * hash(t, i, 2);
              const v = this.klok * snel + hash(t, i, 3), pos = tri(v);
              let rich = triRichting(v);
              const stap = (Math.floor(this.klok * 4 + h * 4) % 2) * bob;
              const kant = hash(t, i, 4) < 0.5 ? -1 : 1;
              let a, langs;
              if (soort === HOOFD) {
                // In de hoofdstad staat het regeringsgebouw op de kruising: lopen op de vier armen.
                const arm = Math.floor(h * 4);
                langs = (arm & 1 ? -1 : 1) * (0.24 + pos * 0.25);
                if (arm & 1) rich = -rich;
                a = arm < 2 ? 0 : 1;
              } else {
                langs = (pos - 0.5) * 0.96;
                a = h < 0.5 ? 0 : 1;
              }
              const dwars = kant * STOEP;
              const kl = Math.floor(hash(t, i, 6) * 6), hu = Math.floor(hash(t, i, 7) * 3);
              const sch = this.paraplu(t, i);
              if (a === 0) this.zetMens(x + langs * Tw, y + dwars * Tw + stap, kl, hu, sch, rich, 0, h);
              else this.zetMens(x + dwars * Tw + stap, y + langs * Tw, kl, hu, sch, 0, rich, h);
            }
            // groepjes die op de stoep blijven staan praten, overdag en als het droog is: in de hoofdstad twee, in een
            // woonwijk soms een
            if (this.zoom >= 9 && this.nachtVorig < 0.4 && this.nat < 0.4 && d.protest < 0.3 && !d.ziek && !d.oorlog) {
              const nG = soort === HOOFD ? 2 : hash(t, 131) < 0.6 * Math.min(1, d.mensenFactor + 0.3) ? 1 : 0;
              for (let g = 0; g < nG && this.n.groepjes < PLAFOND.groepjes; g++) if (this.groepje(t, x, y, soort === HOOFD, g)) this.n.groepjes++;
            }
          } else if (soort === KOLONIE) {
            // Kolonie: rondlopen over het ringpad.
            const aantal = Math.round(MENSEN_PER_TEGEL.kolonie * d.mensenFactor * nachtFactor);
            for (let i = 0; i < aantal && this.nMens < MAX; i++) {
              const richting = hash(t, i, 2) < 0.5 ? -1 : 1;
              const hoek = this.klok * (0.04 + 0.03 * hash(t, i, 3)) * TAU * richting + hash(t, i, 1) * TAU;
              const straal = (0.38 + (hash(t, i, 4) - 0.5) * 0.03) * Tw;
              this.zetMens(x + Math.cos(hoek) * straal, y + Math.sin(hoek) * straal, Math.floor(hash(t, i, 6) * 6), Math.floor(hash(t, i, 7) * 3), 0, -Math.sin(hoek) * richting, Math.cos(hoek) * richting, hash(t, i, 5));
            }
          } else if (!(soort === FABRIEK && d.staking)) {
            if (soort === SCHOOL) this.schoolplein(t, x, y, d);
            // Andere gebouwen: 2 tot 4 mensen bij de ingang aan de onderkant.
            const ingang = x + (hash(t, 8) - 0.5) * 0.4 * Tw;
            const aantal = 2 + Math.floor(hash(t, 9) * 3);
            const kans = Math.min(1, d.mensenFactor) * nachtFactor;
            for (let i = 0; i < aantal && this.nMens < MAX; i++) {
              if (hash(t, i, 11) > kans) continue;
              const v = this.klok * (0.07 + 0.04 * hash(t, i, 2)) + hash(t, i, 3), pos = tri(v);
              this.zetMens(ingang + (pos - 0.5) * 0.14 * Tw, y + (0.455 + (hash(t, i, 4) - 0.5) * 0.03) * Tw, Math.floor(hash(t, i, 6) * 6), Math.floor(hash(t, i, 7) * 3), 0, triRichting(v), 0, hash(t, i, 5));
            }
          }
        }
      }
      // Wandelaars langs de wegen tussen de gebouwen, op de berm naast het asfalt. Zo leeft het hele wegennet,
      // niet alleen de woonwijken. Telt mee voor hetzelfde plafond.
      const W = this.wegen;
      for (let w = 0; w < this.nWegen && this.nMens < MAX; w++) {
        const o = w * WEG;
        const ax = W[o], ay = W[o + 1], bx = W[o + 2], by = W[o + 3];
        if ((ax > bx ? ax : bx) < this.wx0 - Tw || (ax < bx ? ax : bx) > this.wx1 + Tw) continue;
        if ((ay > by ? ay : by) < this.wy0 - Tw || (ay < by ? ay : by) > this.wy1 + Tw) continue;
        const len = W[o + 4], zaad = W[o + 6] | 0, ux = W[o + 7], uy = W[o + 8];
        const d = levenDichtheid(s, W[o + 5]);
        const aantal = Math.min(3, Math.round((len / Tw) * 0.8 * d.mensenFactor * nachtFactor * this.buiten));
        const rand = Math.min(0.45, (Tw * 0.45) / len), loop = 1 - 2 * rand;
        const tun = this.heeftTunnel(zaad);
        for (let i = 0; i < aantal && this.nMens < MAX; i++) {
          const v = this.klok * (0.9 + 0.4 * hash(zaad, i, 31)) * 0.12 * Tw / len + hash(zaad, i, 32), p = rand + loop * tri(v), rich = triRichting(v);
          if (tun && this.inTunnel(zaad, p * len)) continue;
          const kant = (hash(zaad, i, 33) < 0.5 ? -1 : 1) * 0.075 * Tw;
          const stap = (Math.floor(this.klok * 4 + hash(zaad, i, 34) * 4) % 2) * bob;
          const x = ax + (bx - ax) * p - uy * (kant + stap), y = ay + (by - ay) * p + ux * (kant + stap);
          this.zetMens(x, y, Math.floor(hash(zaad, i, 36) * 6), Math.floor(hash(zaad, i, 37) * 3), this.paraplu(zaad, i + 50), ux * rich, uy * rich, hash(zaad, i, 35));
        }
        // oversteken bij de zebra's van de infralaag, als het voetgangerslicht groen is
        const iw = this.infW ? this.infraIdx[w] : -1;
        if (iw >= 0 && this.infW[iw].zebras && this.zoom >= DREMPEL_INFRA.zebra - 0.5) this.oversteken(this.infW[iw].zebras, zaad, ax, ay, ux, uy, d, nachtFactor);
        // een fietser op de berm, niet als het hard regent of sneeuw ligt
        if (hash(zaad, 91) < 0.55 * d.mensenFactor * nachtFactor * (1 - 0.8 * this.nat) * (1 - 0.7 * this.sz.sneeuw)) {
          const r = frac(this.klok * 0.35 * Tw / len + hash(zaad, 92));
          const baan = hash(zaad, 93) < 0.5 ? 1 : -1;
          const p = rand + loop * (baan > 0 ? r : 1 - r), kant = baan * 0.058 * Tw;
          if (!(tun && this.inTunnel(zaad, p * len))) this.zetFig(ax + (bx - ax) * p - uy * kant, ay + (by - ay) * p + ux * kant, ux * baan, uy * baan, FIETS, Math.floor(hash(zaad, 94) * 10), Math.floor(hash(zaad, 95) * 3), 0, 0);
        }
      }
    }
    const nStraat = this.nMens;
    // 2. protest bij de hoofdstad en stakingen bij fabrieken (al vanaf zoom 4: dit is informatie, geen decor)
    this.nSpandoek = 0;
    this.vaten = 0;
    this.busjes = 0;
    if (protestAlpha > 0) {
      for (let r = this.r0; r <= this.r1 && this.nMens < MAX; r++) {
        for (let k = this.k0; k <= this.k1 && this.nMens < MAX; k++) {
          const t = r * geo.kol + k;
          const soort = this.soort[t];
          if (soort !== HOOFD && soort !== FABRIEK) continue;
          const land = this.tegelLand[t];
          if (land < 0) continue;
          const d = levenDichtheid(s, land);
          const tg = geo.tegels[t];
          if (soort === HOOFD && d.protest > 0) this.protest(t, tg.x, tg.y + 0.22 * Tw, d, nu);
          else if (soort === FABRIEK && d.staking) this.staking(t, tg.x + (hash(t, 8) - 0.5) * 0.4 * Tw, tg.y + 0.43 * Tw, nu);
        }
      }
    }
    if (straatAlpha > 0) { this.tekenKraampjes(c, straatAlpha); this.tekenDuiven(c, nu); }
    if (nStraat) this.tekenMensen(c, 0, nStraat, straatAlpha);
    if (this.nFig) this.tekenFiguren(c, straatAlpha);
    if (this.n.paraplus) this.tekenSchermen(c, straatAlpha);
    if (this.nMens > nStraat) {
      this.tekenMensen(c, nStraat, this.nMens, protestAlpha);
      this.tekenSpandoeken(c, protestAlpha);
    }
    if (this.vaten || this.busjes) this.tekenOnrust(c, nu, protestAlpha);
  }

  // Eén persoon in de buffer; wie buiten beeld loopt telt niet mee voor het plafond. Het plafond geldt hier
  // zelf, zodat ook wie buiten de tellende lussen om wordt gezet (de kopers op de markt) de buffer niet overloopt.
  // hx, hy: looprichting (0, 0 staat stil), fase: eigen pas en armzwaai, houding: 0 lopen, 1 staan, 2 praten.
  zetMens(wx, wy, kleding, huid, scherm = 0, hx = 0, hy = 0, fase = 0, houding = 0) {
    if (this.nMens >= PLAFOND.mensen) return false;
    const x = wx * this.sc + this.ox, y = wy * this.sc + this.oy;
    if (x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10) return false;
    const o = this.nMens++ * MENS, b = this.mens;
    if (scherm && this.n.paraplus < PLAFOND.paraplus) this.n.paraplus++; else scherm = 0;
    b[o] = x; b[o + 1] = y; b[o + 2] = kleding; b[o + 3] = huid; b[o + 4] = scherm;
    b[o + 5] = hx; b[o + 6] = hy; b[o + 7] = fase; b[o + 8] = houding;
    return true;
  }

  // Twee of drie mensen die op de stoep in een kringetje staan te praten; om beurten praat er een met zijn handen.
  groepje(t, x, y, hoofd, g = 0) {
    const Tw = this.geo.T, arm = (hash(t, g, 132) < 0.5 ? 0 : 1) ^ g, kant = hash(t, g, 133) < 0.5 ? -1 : 1;
    // niet op de kruising van het straatkruis (daar loopt de andere straat), en in de hoofdstad niet op het plein
    const langs = (hash(t, g, 134) < 0.5 ? -1 : 1) * (hoofd ? 0.3 + 0.15 * hash(t, g, 135) : 0.12 + 0.26 * hash(t, g, 135)) * Tw;
    const dwars = kant * (STOEP + 0.004) * Tw;
    const mx = arm === 0 ? x + langs : x + dwars, my = arm === 0 ? y + dwars : y + langs;
    const m = 2 + (hash(t, g, 136) < 0.5 ? 1 : 0), prater = Math.floor(this.klok / 3.5 + hash(t, g, 137) * m) % m;
    let gezet = false;
    for (let i = 0; i < m; i++) {
      const a = hash(t, g, 138) * TAU + (i / m) * TAU, ca = Math.cos(a), sa = Math.sin(a), r = 0.011 * Tw, j = i + g * 4;
      if (this.zetMens(mx + ca * r, my + sa * r, Math.floor(hash(t, j, 139) * 6), Math.floor(hash(t, j, 140) * 3), 0, -ca, -sa, hash(t, j, 141), i === prater ? 2 : 1)) { gezet = true; this.nPraat++; }
    }
    return gezet;
  }

  // Oversteken bij de zebra's van een weg (w.zebras uit infra.js): in het venster waarin het voetgangerslicht groen
  // is, lopen ze over; vlak daarvoor wachten ze aan de stoeprand. Een deel van de kruispunten krijgt ook een fietser.
  oversteken(Z, zaad, ax, ay, ux, uy, d, nachtFactor) {
    const Tw = this.geo.T, tijd = this.klok * 1000 + this.dNu;
    const kans = Math.min(1, d.mensenFactor) * nachtFactor * this.buiten;
    for (let i = 0; i < Z.length && this.n.overstekers < PLAFOND.overstekers; i += ZEBRA) {
      const q = Z[i], P = Z[i + 1], van = Z[i + 3], tot = Z[i + 4], f = frac(tijd / P + Z[i + 2]), duur = tot - van;
      const m = Math.round(0.6 + 2.6 * kans * hash(zaad, i, 161));
      for (let j = 0; j < m && this.n.overstekers < PLAFOND.overstekers; j++) {
        const kant = hash(zaad, i * 8 + j, 162) < 0.5 ? 1 : -1, wacht = 0.2 * hash(zaad, i * 8 + j, 163);
        const u = (f - van) / duur * 1.3 - wacht, langs = q + (hash(zaad, i * 8 + j, 164) - 0.5) * 0.028 * Tw;
        let dw, hx = 0, hy = 0, houding = 1;
        if (f >= van && f < tot && u >= 0 && u <= 1) { dw = kant * (-0.075 + 0.15 * u); hx = -uy * kant; hy = ux * kant; houding = 0; }
        else if (f < van && f > van - 0.3 * duur - 0.08) { dw = -kant * 0.08; hx = -uy * kant; hy = ux * kant; }
        else continue;
        if (this.zetMens(ax + ux * langs - uy * dw * Tw, ay + uy * langs + ux * dw * Tw, Math.floor(hash(zaad, i * 8 + j, 165) * 6), Math.floor(hash(zaad, i * 8 + j, 166) * 3), this.paraplu(zaad, i * 8 + j + 200), houding ? 0 : hx, houding ? 0 : hy, hash(zaad, i * 8 + j, 167), houding ? 1 : 0)) this.n.overstekers++;
      }
      // soms een fietser die sneller oversteekt, in hetzelfde groen
      if (hash(zaad, i, 168) < 0.3 && f >= van && f < tot && this.nat < 0.6) {
        const u = ((f - van) / duur) * 1.8, kant = hash(zaad, i, 169) < 0.5 ? 1 : -1;
        if (u <= 1) {
          const dw = kant * (-0.075 + 0.15 * u), l = q + 0.02 * Tw * kant;
          this.zetFig(ax + ux * l - uy * dw * Tw, ay + uy * l + ux * dw * Tw, -uy * kant, ux * kant, FIETS, Math.floor(hash(zaad, i, 170) * 10), Math.floor(hash(zaad, i, 171) * 3), 0, 0);
        }
      }
    }
  }

  // Paraplu bij regen of natte sneeuw: 0 voor geen, anders de kleur + 1. Vast per persoon.
  paraplu(a, i) {
    if (this.schermKans <= 0 || hash(a, i, 97) >= this.schermKans) return 0;
    return 1 + Math.floor(hash(a, i, 98) * SCHERMEN.length);
  }

  // Figuur op straat of in het park, met een eigen plafond per soort; buiten beeld telt niet mee.
  zetFig(wx, wy, hx, hy, soort, kleding, huid, scherm, fase, stil = 0) {
    const naam = FIGUUR[soort];
    if (this.n[naam] >= PLAFOND[naam]) return;
    const x = wx * this.sc + this.ox, y = wy * this.sc + this.oy;
    if (x < -12 || y < -12 || x > this.w + 12 || y > this.h + 12) return;
    this.n[naam]++;
    if (scherm && this.n.paraplus < PLAFOND.paraplus) this.n.paraplus++; else scherm = 0;
    const o = this.nFig++ * FIG, b = this.fig;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = soort; b[o + 5] = kleding; b[o + 6] = huid; b[o + 7] = scherm; b[o + 8] = fase; b[o + 9] = stil;
  }

  // Fietsers op de rijbaan, joggers, hondenuitlaters en kinderwagens op de stoep van het straatkruis.
  straatFiguren(t, soort, x, y, d, nachtFactor) {
    const Tw = this.geo.T, klok = this.klok, nat = this.nat, dag = this.nachtVorig < 0.4;
    const f = d.mensenFactor * nachtFactor;
    const hoofd = soort === HOOFD;
    // positie langs een arm van het kruis; in de hoofdstad niet over het regeringsplein
    const langsVan = (pos, i) => (hoofd ? (hash(t, i, 59) < 0.5 ? -1 : 1) * (0.2 + pos * 0.28) : (pos - 0.5) * 0.96);
    const zet = (langs, dwars, richting, arm, sk, kl, hu, sch, fase, stil = 0) => {
      if (arm === 0) this.zetFig(x + langs * Tw, y + dwars * Tw, richting, 0, sk, kl, hu, sch, fase, stil);
      else this.zetFig(x + dwars * Tw, y + langs * Tw, 0, richting, sk, kl, hu, sch, fase, stil);
    };
    // fietsers rijden rechts op de rijbaan, minder bij regen en als er sneeuw ligt
    const nF = Math.round((hoofd ? 4 : 3) * f * (1 - 0.75 * nat) * (1 - 0.7 * this.sz.sneeuw));
    for (let i = 0; i < nF; i++) {
      const arm = hash(t, i, 51) < 0.5 ? 0 : 1, richting = hash(t, i, 52) < 0.5 ? 1 : -1;
      const pos = frac(klok * 0.12 * (0.8 + 0.4 * hash(t, i, 54)) + hash(t, i, 53));
      const langs = hoofd ? richting * (pos * 0.5 - 0.25) * 1.9 : richting * (pos - 0.5) * 0.96;
      if (hoofd && Math.abs(langs) < 0.17) continue; // over het plein lopen ze aan de hand
      // rechts van de rijrichting: op de horizontale arm naar het zuiden, op de verticale naar het westen
      zet(langs, (arm === 0 ? richting : -richting) * 0.016, richting, arm, FIETS, Math.floor(hash(t, i, 55) * 10), Math.floor(hash(t, i, 56) * 3), 0, 0);
    }
    // joggers: snel heen en weer, vooral 's ochtends en 's avonds en niet in de regen
    const nJ = Math.round(1.6 * f * (1 - 0.9 * nat));
    for (let i = 0; i < nJ; i++) {
      const v = klok * 0.1 * (0.8 + 0.4 * hash(t, i, 61)) + hash(t, i, 62);
      const arm = hash(t, i, 63) < 0.5 ? 0 : 1, kant = hash(t, i, 64) < 0.5 ? -1 : 1;
      zet(langsVan(tri(v), i), kant * STOEP, triRichting(v), arm, JOGGER, 6 + Math.floor(hash(t, i, 65) * 4), Math.floor(hash(t, i, 66) * 3), 0, hash(t, i, 67));
    }
    // hondenuitlaters: langzaam, de hond loopt voorop en snuffelt heen en weer
    const nH = Math.round(1.6 * f * (1 - 0.5 * nat));
    for (let i = 0; i < nH; i++) {
      // om de paar seconden blijft de hond staan snuffelen: dan staat de tijd voor het tweetal even stil
      const P = 7 + 5 * hash(t, i, 78), ph = klok / P + hash(t, i, 79), k = Math.floor(ph), r = ph - k;
      const v = (k * 0.7 + Math.min(r, 0.7)) * P * 0.03 * (0.8 + 0.4 * hash(t, i, 71)) + hash(t, i, 72);
      const arm = hash(t, i, 73) < 0.5 ? 0 : 1, kant = hash(t, i, 74) < 0.5 ? -1 : 1;
      zet(langsVan(tri(v), i + 20), kant * STOEP, triRichting(v), arm, HOND, Math.floor(hash(t, i, 75) * 6), Math.floor(hash(t, i, 76) * 3), this.paraplu(t, i + 30), hash(t, i, 77), r > 0.7 ? 1 : 0);
    }
    // kinderwagens: overdag
    const nK = dag ? Math.round(1.1 * f * (1 - 0.6 * nat)) : 0;
    for (let i = 0; i < nK; i++) {
      const v = klok * 0.025 * (0.8 + 0.4 * hash(t, i, 81)) + hash(t, i, 82);
      const arm = hash(t, i, 83) < 0.5 ? 0 : 1, kant = hash(t, i, 84) < 0.5 ? -1 : 1;
      zet(langsVan(tri(v), i + 40), kant * STOEP, triRichting(v), arm, KINDERWAGEN, Math.floor(hash(t, i, 85) * 6), Math.floor(hash(t, i, 86) * 3), this.paraplu(t, i + 40), Math.floor(hash(t, i, 87) * 4));
    }
  }

  // Marktkraampjes op het regeringsplein, overdag en als het rustig is; met wat kopers ertussen.
  markt(t, x, y, d) {
    if (this.nPlein < 4) { const o = this.nPlein++ * 3; this.plein[o] = x; this.plein[o + 1] = y; this.plein[o + 2] = t; }
    if (this.nachtVorig > 0.35 || d.ziek || d.protest > 0.45 || this.zoom < 6) return;
    const Tw = this.geo.T, kans = Math.min(1, 0.45 + 0.45 * d.welvaart) * (d.oorlog ? 0.5 : 1) * (0.4 + 0.6 * this.buiten);
    for (let i = 0; i < 8 && this.n.kraampjes < PLAFOND.kraampjes; i++) {
      if (hash(t, i, 101) > kans) continue;
      const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1, buiten = i & 4;
      const kx = x + sx * (buiten ? 0.115 : 0.07) * Tw, ky = y + sy * (buiten ? 0.06 : 0.105) * Tw;
      const px = kx * this.sc + this.ox, py = ky * this.sc + this.oy;
      if (px < -20 || py < -20 || px > this.w + 20 || py > this.h + 20) continue;
      const o = this.n.kraampjes++ * 3;
      this.kraam[o] = px; this.kraam[o + 1] = py; this.kraam[o + 2] = Math.floor(hash(t, i, 102) * KRAAM.length);
      // kopers voor de toonbank (de zuidkant van de kraam) die van kraam naar kraam slenteren
      for (let j = 0; j < 2; j++) {
        const pos = tri(this.klok * 0.04 + hash(t, i * 4 + j, 103));
        this.zetMens(kx + (pos - 0.5) * 0.05 * Tw, ky + (0.024 + 0.01 * j) * Tw, Math.floor(hash(t, i * 4 + j, 104) * 6), Math.floor(hash(t, i * 4 + j, 105) * 3), this.paraplu(t, i * 4 + j + 70));
      }
    }
  }

  // Kinderen op het sportveld van de school: op schooldagen overdag, in golven (de pauzes), met een bal.
  schoolplein(t, x, y, d) {
    const s = this.state;
    if (this.nachtVorig > 0.35 || d.ziek || ((s.dag % 7) + 7) % 7 >= 5) return;
    const Tw = this.geo.T, klok = this.klok;
    const pauze = 0.5 + 0.5 * Math.sin((klok * TAU) / 70 + hash(t, 111) * TAU);
    const cx = x + 0.25 * Tw, cy = y + 0.19 * Tw;
    const N = Math.round(14 * Math.min(1.2, d.mensenFactor) * this.buiten);
    for (let i = 0; i < N; i++) {
      if (hash(t, i, 112) > pauze) continue;
      const w1 = 0.25 + 0.35 * hash(t, i, 113), w2 = 0.2 + 0.3 * hash(t, i, 114), p1 = hash(t, i, 115) * TAU, p2 = hash(t, i, 116) * TAU;
      const kx = cx + 0.14 * Math.sin(klok * w1 + p1) * Tw, ky = cy + 0.18 * Math.sin(klok * w2 + p2) * Tw;
      let hx = 0.14 * w1 * Math.cos(klok * w1 + p1), hy = 0.18 * w2 * Math.cos(klok * w2 + p2);
      const l = Math.hypot(hx, hy) || 1;
      this.zetFig(kx, ky, hx / l, hy / l, KIND, 6 + Math.floor(hash(t, i, 117) * 4), Math.floor(hash(t, i, 118) * 3), 0, hash(t, i, 119));
    }
    if (pauze > 0.3 && this.nBal < 8) {
      const o = this.nBal++ * 2;
      this.bal[o] = (cx + 0.12 * Math.sin(klok * 0.9 + t) * Tw) * this.sc + this.ox;
      this.bal[o + 1] = (cy + 0.15 * Math.sin(klok * 0.7 + t * 2) * Tw) * this.sc + this.oy;
    }
  }

  tekenKraampjes(c, a) {
    const n = this.n.kraampjes, b = this.kraam, T = this.T;
    if (!n) return;
    this.kraamSprites ??= KRAAM.map(kraamSprite);
    c.globalAlpha = a * smooth(6, 7, this.zoom);
    const w = T * 0.05, h = w * (40 / 48);
    for (let i = 0; i < n; i++) c.drawImage(this.kraamSprites[b[i * 3 + 2]], b[i * 3] - w / 2, b[i * 3 + 1] - h / 2, w, h);
    c.globalAlpha = 1;
  }

  // Duiven op het plein: pikken in groepjes en vliegen af en toe samen op (vanaf zoom 10).
  tekenDuiven(c, nu) {
    if (this.zoom < 10 || !this.nPlein || this.nachtVorig > 0.5) return;
    const Tw = this.geo.T, T = this.T, sc = this.sc, klok = this.klok, a = smooth(10, 11, this.zoom);
    let n = 0;
    const zit = this.duifZit, vlieg = this.duifVlieg;
    let nZ = 0, nV = 0;
    for (let p = 0; p < this.nPlein && n < PLAFOND.duiven; p++) {
      const x = this.plein[p * 3], y = this.plein[p * 3 + 1], t = this.plein[p * 3 + 2];
      const d = levenDichtheid(this.state, this.tegelLand[t]);
      if (d.protest > 0.3) continue;
      const fase = frac(klok / 25 + hash(t, 121));
      const op = fase > 0.88 ? (fase - 0.88) / 0.12 : 0; // het laatste stukje van elke 25 s vliegen ze op
      for (let i = 0; i < 14 && n < PLAFOND.duiven; i++) {
        const hoek = hash(t, i, 122) * TAU, r = (0.04 + 0.08 * hash(t, i, 123)) * Tw;
        let wx = x + Math.cos(hoek) * r, wy = y + Math.sin(hoek) * r * 0.8;
        if (op > 0) { wx += Math.cos(hoek) * op * 0.4 * Tw; wy += Math.sin(hoek) * op * 0.4 * Tw - op * 0.1 * Tw; }
        else { wx += Math.sin(klok * 0.4 + i) * 0.006 * Tw; }
        const sx = wx * sc + this.ox, sy = wy * sc + this.oy;
        if (sx < -5 || sy < -5 || sx > this.w + 5 || sy > this.h + 5) continue;
        n++;
        if (op > 0) { vlieg[nV * 3] = sx; vlieg[nV * 3 + 1] = sy; vlieg[nV * 3 + 2] = hoek; nV++; }
        else { zit[nZ * 3] = sx; zit[nZ * 3 + 1] = sy; zit[nZ * 3 + 2] = Math.sin(nu / 150 + i * 1.7) > 0.6 ? 1 : 0; nZ++; }
      }
    }
    this.n.duiven = n;
    if (!n) return;
    c.globalAlpha = a;
    const r = Math.max(0.8, T * 0.0045);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    for (let i = 0; i < nZ; i++) stip(c, zit[i * 3] + r * 0.5, zit[i * 3 + 1] + r * 0.7, r);
    c.fill();
    c.fillStyle = '#8d9097';
    c.beginPath();
    for (let i = 0; i < nZ; i++) stip(c, zit[i * 3], zit[i * 3 + 1], r);
    c.fill();
    // kopjes: wie pikt, heeft het kopje naar beneden
    c.fillStyle = '#4c5058';
    c.beginPath();
    for (let i = 0; i < nZ; i++) stip(c, zit[i * 3] + r * 0.7, zit[i * 3 + 1] + (zit[i * 3 + 2] ? r * 0.6 : -r * 0.3), r * 0.55);
    c.fill();
    if (nV) {
      c.strokeStyle = '#9aa0a8'; c.lineWidth = Math.max(0.8, T * 0.003); c.lineCap = 'round';
      c.beginPath();
      for (let i = 0; i < nV; i++) {
        const hx = Math.cos(vlieg[i * 3 + 2]), hy = Math.sin(vlieg[i * 3 + 2]);
        vlucht(c, vlieg[i * 3], vlieg[i * 3 + 1], hx, hy, T * 0.01, 0.5 + 0.5 * Math.sin(nu / 50 + i));
      }
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // Fietsers, joggers, honden met baasje, kinderwagens, kinderen en sleetjes, gebundeld per kleur.
  tekenFiguren(c, a) {
    const n = this.nFig, b = this.fig, T = this.T;
    if (!n || a <= 0) return;
    c.globalAlpha = a;
    const r = T * 0.011, rk = T * 0.008, rh = T * 0.006;
    // waar staat het voorwerp naast de figuur (hond voorop, wagen voorop, slee achter)? Schrijft naar vx, vy
    // (geen nieuw array per figuur per laag); false als de figuur niets bij zich heeft.
    let vx = 0, vy = 0;
    const voorwerp = (o) => {
      const s = b[o + 4], hx = b[o + 2], hy = b[o + 3];
      if (s === HOND) { const zw = Math.sin(this.klok * 3 + b[o + 8] * 20) * T * 0.008; vx = b[o] + hx * T * 0.032 - hy * zw; vy = b[o + 1] + hy * T * 0.032 + hx * zw; return true; }
      if (s === KINDERWAGEN) { vx = b[o] + hx * T * 0.022; vy = b[o + 1] + hy * T * 0.022; return true; }
      if (s === SLEE) { vx = b[o] - hx * T * 0.02; vy = b[o + 1] - hy * T * 0.02; return true; }
      return false;
    };
    // schaduw
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * FIG, s = b[o + 4], x = b[o] + T * 0.004, y = b[o + 1] + T * 0.005;
      stip(c, x, y, s === KIND || s === SLEE ? rk : r);
      if (s === FIETS) rechthoek(c, x, y, b[o + 2], b[o + 3], T * 0.017, T * 0.003);
      if (voorwerp(o)) rechthoek(c, vx + T * 0.004, vy + T * 0.005, b[o + 2], b[o + 3], T * (s === HOND ? 0.011 : 0.012), T * 0.006);
    }
    c.fill();
    // fietsen: van bovenaf een streep (de wielen) met het stuur dwars voorop
    c.strokeStyle = '#26282b';
    c.lineWidth = Math.max(0.6, T * 0.0035);
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * FIG;
      if (b[o + 4] !== FIETS) continue;
      const x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3];
      c.moveTo(x - hx * T * 0.017, y - hy * T * 0.017); c.lineTo(x + hx * T * 0.017, y + hy * T * 0.017);
      const sx = x + hx * T * 0.011, sy = y + hy * T * 0.011;
      c.moveTo(sx - hy * T * 0.007, sy + hx * T * 0.007); c.lineTo(sx + hy * T * 0.007, sy - hx * T * 0.007);
    }
    c.stroke();
    // riem en sleetouw, alleen dichtbij
    if (T >= 180) {
      c.strokeStyle = 'rgba(40,30,25,0.7)';
      c.lineWidth = Math.max(0.5, T * 0.0018);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * FIG, s = b[o + 4];
        if (s !== HOND && s !== SLEE) continue;
        voorwerp(o);
        c.moveTo(b[o], b[o + 1]); c.lineTo(vx, vy);
      }
      c.stroke();
    }
    // honden (drie vachtkleuren), kinderwagens (vier kleuren) en sleeën (rood)
    for (let k = 0; k < 8; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * FIG, s = b[o + 4];
        const kleur = s === HOND ? Math.floor(b[o + 8] * 3) : s === KINDERWAGEN ? 3 + b[o + 8] : s === SLEE ? 7 : -1;
        if (kleur !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        voorwerp(o);
        if (s === HOND) {
          // snuffelen: de kop gaat omlaag en schuift heen en weer langs de grond
          const sn = b[o + 9] ? Math.sin(this.klok * 11 + b[o + 8] * 9) * T * 0.004 : 0, kv = b[o + 9] ? 0.014 : 0.011;
          ovaal(c, vx, vy, b[o + 2], b[o + 3], T * 0.01, T * 0.0055);
          stip(c, vx + b[o + 2] * T * kv - b[o + 3] * sn, vy + b[o + 3] * T * kv + b[o + 2] * sn, T * (b[o + 9] ? 0.004 : 0.0045));
        }
        else rechthoek(c, vx, vy, b[o + 2], b[o + 3], T * 0.012, T * (s === SLEE ? 0.006 : 0.008));
      }
      if (open) { c.fillStyle = k < 3 ? VACHT[k] : k < 7 ? WAGEN[k - 3] : '#b8322a'; c.fill(); }
    }
    // kap van de kinderwagen
    if (T >= 150) {
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * FIG;
        if (b[o + 4] !== KINDERWAGEN) continue;
        voorwerp(o);
        rechthoek(c, vx + b[o + 2] * T * 0.006, vy + b[o + 3] * T * 0.006, b[o + 2], b[o + 3], T * 0.006, T * 0.008);
      }
      c.fill();
    }
    // lichamen per kleur (joggers en kinderen in sportkleuren), dan de hoofdjes
    const bob = T * 0.003;
    for (let k = 0; k < KLEDING_ALLES.length; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * FIG;
        if (b[o + 5] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        const s = b[o + 4];
        const op = s === JOGGER || s === KIND ? (Math.floor(this.klok * 7 + b[o + 8] * 7) & 1) * bob : 0;
        stip(c, b[o] - b[o + 3] * op, b[o + 1] + b[o + 2] * op, s === KIND || s === SLEE ? rk : r);
      }
      if (open) { c.fillStyle = KLEDING_ALLES[k]; c.fill(); }
    }
    if (rh >= 0.9) {
      for (let k = 0; k < HUID.length; k++) {
        let open = false;
        for (let i = 0; i < n; i++) {
          const o = i * FIG;
          if (b[o + 6] !== k) continue;
          if (!open) { c.beginPath(); open = true; }
          const s = b[o + 4];
          stip(c, b[o], b[o + 1] - r * 0.15, s === KIND || s === SLEE ? rh * 0.8 : rh);
        }
        if (open) { c.fillStyle = HUID[k]; c.fill(); }
      }
    }
    // de bal op het schoolplein
    if (this.nBal) {
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.beginPath();
      for (let i = 0; i < this.nBal; i++) stip(c, this.bal[i * 2] + T * 0.003, this.bal[i * 2 + 1] + T * 0.004, Math.max(0.8, T * 0.004));
      c.fill();
      c.fillStyle = '#f7f7f2';
      c.beginPath();
      for (let i = 0; i < this.nBal; i++) stip(c, this.bal[i * 2], this.bal[i * 2 + 1], Math.max(0.8, T * 0.004));
      c.fill();
    }
    c.globalAlpha = 1;
  }

  // Paraplu's boven de voetgangers: schaduw, doek per kleur, hoogtelicht linksboven en baleinen dichtbij.
  tekenSchermen(c, a) {
    const T = this.T, R = T * 0.018;
    const elk = (fn) => {
      for (let i = 0; i < this.nMens; i++) { const o = i * MENS; if (this.mens[o + 4]) fn(this.mens[o], this.mens[o + 1], this.mens[o + 4] - 1); }
      for (let i = 0; i < this.nFig; i++) { const o = i * FIG; if (this.fig[o + 7]) fn(this.fig[o], this.fig[o + 1], this.fig[o + 7] - 1); }
    };
    c.globalAlpha = a;
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.beginPath(); elk((x, y) => stip(c, x + T * 0.007, y + T * 0.009, R)); c.fill();
    for (let k = 0; k < SCHERMEN.length; k++) {
      c.fillStyle = SCHERMEN[k];
      c.beginPath(); elk((x, y, s) => { if (s === k) stip(c, x, y - T * 0.004, R); }); c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath(); elk((x, y) => stip(c, x - R * 0.35, y - T * 0.004 - R * 0.35, R * 0.4)); c.fill();
    if (T >= 160) {
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = Math.max(0.5, T * 0.0015);
      c.beginPath();
      elk((x, y) => { const yy = y - T * 0.004; c.moveTo(x - R, yy); c.lineTo(x + R, yy); c.moveTo(x, yy - R); c.lineTo(x, yy + R); });
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // Een menigte in een schijf voor het regeringsgebouw, met spandoeken; bij zware onrust brandende vaten en politie.
  protest(t, mx, my, d, nu) {
    const MAX = PLAFOND.mensen;
    const Tw = this.geo.T;
    const menigte = Math.round(8 + 32 * d.protest);
    const R = 0.18 * Tw;
    for (let i = 0; i < menigte && this.nMens < MAX; i++) {
      const hoek = hash(t, i, 21) * TAU;
      const rr = Math.sqrt(hash(t, i, 22)) * R;
      const zwaai = Math.sin(nu / 600 + i) * 0.012 * Tw;
      const x = mx + Math.cos(hoek) * rr + zwaai, y = my + Math.sin(hoek) * rr * 0.8;
      this.zetMens(x, y, Math.floor(hash(t, i, 23) * 6), Math.floor(hash(t, i, 24) * 3));
      if (i % 6 === 0 && this.nSpandoek < 80) {
        const o = this.nSpandoek++ * 3;
        this.spandoek[o] = x * this.sc + this.ox;
        this.spandoek[o + 1] = y * this.sc + this.oy;
        this.spandoek[o + 2] = hash(t, i, 25) < 0.6 ? 0 : 1;
      }
    }
    if (d.onrust) {
      this.vatenX = mx; this.vatenY = my; this.vatenT = t;
      this.vaten = 2 + Math.floor(hash(t, 31) * 2);
      this.busjes = d.politie ? 2 : 0;
    }
  }

  // Staking: een groepje van 4 tot 6 mensen bij het hek, met één spandoek.
  staking(t, x, y, nu) {
    const MAX = PLAFOND.mensen;
    const Tw = this.geo.T;
    const groep = 4 + Math.floor(hash(t, 41) * 3);
    for (let i = 0; i < groep && this.nMens < MAX; i++) {
      const gx = x + (i - (groep - 1) / 2) * 0.035 * Tw + Math.sin(nu / 700 + i) * 0.006 * Tw;
      const gy = y + (hash(t, i, 42) - 0.5) * 0.04 * Tw;
      this.zetMens(gx, gy, Math.floor(hash(t, i, 43) * 6), Math.floor(hash(t, i, 44) * 3));
      if (i === 1 && this.nSpandoek < 80) {
        const o = this.nSpandoek++ * 3;
        this.spandoek[o] = gx * this.sc + this.ox;
        this.spandoek[o + 1] = gy * this.sc + this.oy;
        this.spandoek[o + 2] = 0;
      }
    }
  }

  tekenMensen(c, van, tot, a) {
    if (a <= 0) return;
    const b = this.mens, T = this.T;
    const r = T * 0.011, rh = T * 0.006; // lichaam 0.022 tegel, hoofd 0.012 tegel
    // dichtbij (vanaf zoom 12): benen en armen die meebewegen, jassen en mutsen in de winter, blote armen in de zomer,
    // tassen en haar
    const fijn = T >= 250, winter = this.sz.koud > 0.5, zomer = this.sz.zomer > 0.5 && !winter;
    c.globalAlpha = a;
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath();
    for (let i = van; i < tot; i++) stip(c, b[i * MENS] + T * 0.004, b[i * MENS + 1] + T * 0.005, r);
    c.fill();
    if (fijn) this.ledematen(c, van, tot, zomer, winter);
    for (let k = 0; k < KLEDING.length; k++) {
      let open = false;
      for (let i = van; i < tot; i++) {
        const o = i * MENS;
        if (b[o + 2] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        stip(c, b[o], b[o + 1], fijn && winter ? r * 1.12 : r);
      }
      if (open) { c.fillStyle = fijn && winter ? JAS[k] : KLEDING[k]; c.fill(); }
    }
    // per persoon één keer uitrekenen welke tas en wat op het hoofd (vast per persoon, uit zijn fase): 0 niets,
    // anders kleur + 1; muts in de winter (zeven op de tien), anders haar
    const nT = TAS.length, nM = MUTS.length, nH = HAAR.length;
    if (fijn) {
      const TK = (this.tasKl ??= new Uint8Array(PLAFOND.mensen)), HK = (this.hoofdKl ??= new Uint8Array(PLAFOND.mensen));
      for (let i = van; i < tot; i++) {
        const fa = b[i * MENS + 7];
        TK[i] = frac(fa * 7) < 0.3 ? 1 + Math.floor(frac(fa * 11) * nT) : 0;
        // onder de paraplu zie je het hoofd niet
        HK[i] = b[i * MENS + 4] ? 0 : winter && frac(fa * 3) < 0.7 ? 1 + Math.floor(frac(fa * 5) * nM) : 1 + nM + Math.floor(frac(fa * 13) * nH);
      }
      // tas aan de rechterhand
      for (let k = 1; k <= nT; k++) {
        let open = false;
        for (let i = van; i < tot; i++) {
          if (TK[i] !== k) continue;
          const o = i * MENS;
          if (!open) { c.beginPath(); open = true; }
          const l = Math.hypot(b[o + 5], b[o + 6]), ex = l ? b[o + 5] / l : 1, ey = l ? b[o + 6] / l : 0;
          rechthoek(c, b[o] - ey * r * 1.25, b[o + 1] + ex * r * 1.25, ex, ey, r * 0.42, r * 0.22);
        }
        if (open) { c.fillStyle = TAS[k - 1]; c.fill(); }
      }
    }
    // hoofdjes pas als ze groot genoeg zijn om te onderscheiden
    if (rh >= 0.9) {
      for (let k = 0; k < HUID.length; k++) {
        let open = false;
        for (let i = van; i < tot; i++) {
          const o = i * MENS;
          if (b[o + 3] !== k) continue;
          if (!open) { c.beginPath(); open = true; }
          stip(c, b[o], b[o + 1] - r * 0.15, rh);
        }
        if (open) { c.fillStyle = HUID[k]; c.fill(); }
      }
    }
    if (fijn) {
      // muts, of haar op de achterkant van het hoofd
      const HK = this.hoofdKl;
      for (let k = 1; k <= nM + nH; k++) {
        let open = false;
        const muts = k <= nM;
        for (let i = van; i < tot; i++) {
          if (HK[i] !== k) continue;
          const o = i * MENS, hx = b[o + 5], hy = b[o + 6];
          if (!open) { c.beginPath(); open = true; }
          stip(c, b[o] - hx * rh * 0.3, b[o + 1] - r * 0.15 - hy * rh * 0.3, rh * (muts ? 0.9 : 0.75));
        }
        if (open) { c.fillStyle = muts ? MUTS[k - 1] : HAAR[k - 1 - nM]; c.fill(); }
      }
    }
    c.globalAlpha = 1;
  }

  // Benen (donker, stappend in de looprichting) en armen die tegengesteld meezwaaien; wie praat, beweegt zijn handen.
  // Armen in de kleur van de kleding, in de zomer bloot (huidskleur).
  ledematen(c, van, tot, zomer, winter) {
    const b = this.mens, T = this.T, r = T * 0.011, klok = this.klok;
    c.lineCap = 'round';
    c.lineWidth = Math.max(0.8, T * 0.0042);
    c.strokeStyle = BROEK;
    c.beginPath();
    for (let i = van; i < tot; i++) {
      const o = i * MENS, hx = b[o + 5], hy = b[o + 6];
      if (b[o + 8] || (!hx && !hy)) continue;
      const sw = Math.sin(klok * 9 + b[o + 7] * TAU) * r * 0.95, x = b[o], y = b[o + 1];
      for (let z = -1; z <= 1; z += 2) {
        const bx = x - hy * z * r * 0.4, by = y + hx * z * r * 0.4;
        c.moveTo(bx, by); c.lineTo(bx + hx * sw * z, by + hy * sw * z);
      }
    }
    c.stroke();
    c.lineWidth = Math.max(0.7, T * 0.0034);
    const n = zomer ? HUID.length : KLEDING.length;
    for (let k = 0; k < n; k++) {
      let open = false;
      for (let i = van; i < tot; i++) {
        const o = i * MENS;
        if ((zomer ? b[o + 3] : b[o + 2]) !== k) continue;
        const hx = b[o + 5], hy = b[o + 6], houding = b[o + 8];
        if (houding === 1 || (!hx && !hy && !houding)) continue;
        if (!open) { c.beginPath(); open = true; }
        const x = b[o], y = b[o + 1];
        const sw = houding === 2 ? 0 : Math.sin(klok * 9 + b[o + 7] * TAU) * r * 0.8;
        for (let z = -1; z <= 1; z += 2) {
          const sx = x - hy * z * r * 0.95, sy = y + hx * z * r * 0.95;
          // praten: handen afwisselend naar voren, lopen: tegengesteld aan het been aan dezelfde kant
          const v = houding === 2 ? r * (0.4 + 0.6 * tri(klok * 1.3 + b[o + 7] + (z > 0 ? 0.5 : 0))) : -sw * z;
          c.moveTo(sx, sy); c.lineTo(sx + hx * v - hy * z * r * 0.25, sy + hy * v + hx * z * r * 0.25);
        }
      }
      if (open) { c.strokeStyle = zomer ? HUID[k] : winter ? JAS[k] : KLEDING[k]; c.stroke(); }
    }
    c.lineCap = 'butt';
  }

  tekenSpandoeken(c, a) {
    const n = this.nSpandoek, b = this.spandoek, T = this.T;
    if (!n) return;
    c.globalAlpha = a;
    const stok = T * 0.05, w = T * 0.07, h = T * 0.025;
    c.strokeStyle = '#3a2f25';
    c.lineWidth = Math.max(0.6, T * 0.005);
    c.beginPath();
    for (let i = 0; i < n; i++) { c.moveTo(b[i * 3], b[i * 3 + 1]); c.lineTo(b[i * 3], b[i * 3 + 1] - stok); }
    c.stroke();
    for (let k = 0; k < 2; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        if (b[i * 3 + 2] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        c.rect(b[i * 3] - w / 2, b[i * 3 + 1] - stok - h, w, h);
      }
      if (open) { c.fillStyle = SPANDOEK[k]; c.fill(); }
    }
    c.globalAlpha = 1;
  }

  // Brandende vaten met rook en politiebusjes met zwaailicht aan de rand van de menigte.
  tekenOnrust(c, nu, a) {
    const T = this.T, sc = this.sc, t = this.vatenT;
    const mx = this.vatenX * sc + this.ox, my = this.vatenY * sc + this.oy;
    c.globalAlpha = a;
    for (let i = 0; i < this.vaten; i++) {
      const hoek = hash(t, i, 32) * TAU;
      const x = mx + Math.cos(hoek) * T * 0.21, y = my + Math.sin(hoek) * T * 0.17;
      c.fillStyle = '#2b2622';
      c.beginPath(); c.arc(x, y, T * 0.016, 0, TAU); c.fill();
      c.fillStyle = `rgba(255,150,40,${0.6 + 0.3 * Math.sin(nu / 90 + i)})`;
      c.beginPath(); c.arc(x, y - T * 0.006, T * (0.014 + 0.004 * Math.sin(nu / 70 + i * 2)), 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,230,120,0.85)';
      c.beginPath(); c.arc(x, y - T * 0.008, T * 0.006, 0, TAU); c.fill();
      if (this.nRook < PLAFOND.rook) this.zetRook(x, y - T * 0.01, t * 13 + i, 0.45);
    }
    for (let i = 0; i < this.busjes; i++) {
      const x = mx + (i ? 1 : -1) * T * 0.24, y = my + T * 0.02 * (i ? -1 : 1);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.beginPath(); rechthoek(c, x + T * 0.01, y + T * 0.012, 0, 1, T * 0.06, T * 0.03); c.fill();
      c.fillStyle = '#f2f4f6';
      c.beginPath(); rechthoek(c, x, y, 0, 1, T * 0.06, T * 0.03); c.fill();
      c.fillStyle = '#3b5b8c';
      c.beginPath(); rechthoek(c, x, y + T * 0.01, 0, 1, T * 0.012, T * 0.03); c.fill();
      // zwaailicht op 2 Hz, de twee busjes om en om
      if ((Math.floor(nu / 250) + i) % 2 === 0) {
        c.fillStyle = '#4d8dff';
        c.beginPath(); c.arc(x, y - T * 0.02, Math.max(1.2, T * 0.01), 0, TAU); c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  // ---------- boten ----------

  verzamelBoten(view, nu) {
    const A = this.ankers, Tw = this.geo.T, T = this.T, sc = this.sc, b = this.boot, MAX = PLAFOND.boten;
    const m = Tw;
    const tijd = nu / 1000;
    let n = 0;
    this.nStoom = 0;
    for (let i = 0; i < this.nAnkers && n < MAX; i++) {
      const o = i * ANKER;
      const wx = A[o], wy = A[o + 1];
      if (wx < this.wx0 - m || wx > this.wx1 + m || wy < this.wy0 - m || wy > this.wy1 + m) continue;
      const zaad = A[o + 3];
      const q = n * BOOT;
      if (A[o + 2] === 0) {
        // aangemeerd: dobbert zachtjes op en neer
        const hoek = A[o + 4];
        b[q] = wx * sc + this.ox;
        b[q + 1] = wy * sc + this.oy + Math.sin(tijd * 1.4 + zaad * 40) * 0.01 * T;
        b[q + 2] = Math.cos(hoek); b[q + 3] = Math.sin(hoek);
        b[q + 4] = 0;
        // stoom uit de schoorsteen zolang het dag is
        if (this.nachtVorig < 0.5 && this.zoom >= 5 && this.nStoom < PLAFOND.stoom) {
          this.nStoom++;
          this.zetRook(b[q] - b[q + 2] * T * 0.015, b[q + 1] - b[q + 3] * T * 0.015, Math.floor(zaad * 1000), 0.22, true);
        }
      } else {
        // rondjes van 25 seconden met een kielzog
        const r = A[o + 4] * Tw;
        const richting = zaad < 0.5 ? 1 : -1;
        const hoek = (tijd * TAU) / 25 * richting + zaad * TAU;
        b[q] = (wx + Math.cos(hoek) * r) * sc + this.ox;
        b[q + 1] = (wy + Math.sin(hoek) * r) * sc + this.oy;
        b[q + 2] = -Math.sin(hoek) * richting; b[q + 3] = Math.cos(hoek) * richting;
        b[q + 4] = 1;
      }
      b[q + 5] = hash(Math.floor(zaad * 1e6), 1) < 0.5 ? 0 : 1;
      n++;
    }
    // zeilboten op kustwater
    for (let i = 0; i < this.zeil.length && n < MAX; i++) {
      const zx = this.zeilXY[i * 3], zy = this.zeilXY[i * 3 + 1];
      if (!this.zeilXY[i * 3 + 2] || zx < this.wx0 - m || zx > this.wx1 + m || zy < this.wy0 - m || zy > this.wy1 + m) continue;
      const rx = this.zeilXY[i * 3 + 2] * Tw, ry = rx * 0.6;
      const h = hash(this.zeil[i], 6);
      const richting = h < 0.5 ? 1 : -1;
      const hoek = (tijd * TAU) / 45 * richting + h * TAU;
      const dx = -Math.sin(hoek) * rx * richting, dy = Math.cos(hoek) * ry * richting, dl = Math.hypot(dx, dy) || 1;
      const q = n * BOOT;
      b[q] = (zx + Math.cos(hoek) * rx) * sc + this.ox;
      b[q + 1] = (zy + Math.sin(hoek) * ry) * sc + this.oy;
      b[q + 2] = dx / dl; b[q + 3] = dy / dl;
      b[q + 4] = 2; b[q + 5] = h < 0.25 || h > 0.75 ? 1 : 0;
      n++;
    }
    // vissersboten op hun visgrond: langzaam rondjes met het net erachter en meeuwen eromheen
    const V = this.visXY;
    for (let i = 0; i < V.length / 3 && n < MAX; i++) {
      const vx = V[i * 3], vy = V[i * 3 + 1], r = V[i * 3 + 2] * Tw;
      if (!this.inBeeld(vx, vy, m)) continue;
      const h = hash(i, 131);
      if (this.nachtVorig > 0.7 && h < 0.5) continue; // 's nachts ligt de helft in de haven
      const richting = h < 0.5 ? 1 : -1;
      const hoek = (tijd * TAU) / 80 * richting + h * TAU;
      const dx = -Math.sin(hoek) * r * richting, dy = Math.cos(hoek) * r * 0.7 * richting, dl = Math.hypot(dx, dy) || 1;
      const q = n * BOOT;
      b[q] = (vx + Math.cos(hoek) * r) * sc + this.ox;
      b[q + 1] = (vy + Math.sin(hoek) * r * 0.7) * sc + this.oy;
      b[q + 2] = dx / dl; b[q + 3] = dy / dl;
      b[q + 4] = 3; b[q + 5] = hash(i, 132) < 0.5 ? 0 : 1;
      if (this.n.netten < PLAFOND.netten) {
        const o = this.n.netten++ * 4;
        this.net[o] = b[q]; this.net[o + 1] = b[q + 1]; this.net[o + 2] = b[q + 2]; this.net[o + 3] = b[q + 3];
      }
      for (let j = 0; j < 3 && this.zoom >= 5; j++) {
        const a = tijd * (0.9 + 0.2 * j) * richting + j * 2.1;
        this.zetMeeuw(b[q] - b[q + 2] * T * 0.12 + Math.cos(a) * T * 0.07, b[q + 1] - b[q + 3] * T * 0.12 + Math.sin(a) * T * 0.05, -Math.sin(a) * richting, Math.cos(a) * richting, nu / 110 + j);
      }
      n++;
    }
    // veerboten: heen en weer over het water, aan beide kanten zes seconden aanleggen
    const F = this.veer;
    for (let i = 0; i < F.length / 4 && n < MAX; i++) {
      const ax = F[i * 4], ay = F[i * 4 + 1], bx = F[i * 4 + 2], by = F[i * 4 + 3];
      if (Math.max(ax, bx) < this.wx0 - m || Math.min(ax, bx) > this.wx1 + m || Math.max(ay, by) < this.wy0 - m || Math.min(ay, by) > this.wy1 + m) continue;
      const len = Math.hypot(bx - ax, by - ay), varen = len / (0.3 * Tw), liggen = 6, P = 2 * (varen + liggen);
      const u = frac(tijd / P + hash(i, 141)) * P;
      let f, dir = 1, stil = 0;
      if (u < liggen) { f = 0; stil = 1; }
      else if (u < liggen + varen) f = smooth(0, 1, (u - liggen) / varen);
      else if (u < 2 * liggen + varen) { f = 1; dir = -1; stil = 1; }
      else { f = 1 - smooth(0, 1, (u - 2 * liggen - varen) / varen); dir = -1; }
      const p = 0.08 + f * 0.84;
      const q = n * BOOT;
      b[q] = (ax + (bx - ax) * p) * sc + this.ox;
      b[q + 1] = (ay + (by - ay) * p) * sc + this.oy + (stil ? Math.sin(tijd * 1.2 + i) * 0.006 * T : 0);
      b[q + 2] = ((bx - ax) / len) * dir; b[q + 3] = ((by - ay) / len) * dir;
      b[q + 4] = 4; b[q + 5] = stil;
      n++;
    }
    this.nBoot = n;
  }

  zetMeeuw(x, y, hx, hy, fase) {
    if (this.n.meeuwen >= PLAFOND.meeuwen || x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10) return;
    const o = this.n.meeuwen++ * 5;
    this.meeuw[o] = x; this.meeuw[o + 1] = y; this.meeuw[o + 2] = hx; this.meeuw[o + 3] = hy; this.meeuw[o + 4] = 0.55 + 0.45 * Math.sin(fase);
  }

  // Meeuwen achter de ploeg en boven de vissersboten: witte "v"'s met een schaduw op de grond of het water.
  tekenMeeuwen(c) {
    const n = this.n.meeuwen, b = this.meeuw, T = this.T;
    if (!n) return;
    const w = Math.max(2, T * 0.012);
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.lineWidth = Math.max(0.8, w * 0.2);
    for (let k = 0; k < 2; k++) {
      c.strokeStyle = k ? 'rgba(250,250,246,0.95)' : 'rgba(0,0,0,0.16)';
      const dx = k ? 0 : T * 0.03, dy = k ? 0 : T * 0.04;
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * 5; vlucht(c, b[o] + dx, b[o + 1] + dy, b[o + 2], b[o + 3], w, b[o + 4]); }
      c.stroke();
    }
  }

  // Sleepnetten achter de vissersboten: twee lijnen naar de netmond met oranje drijvers, de zak erachter.
  tekenNetten(c) {
    const n = this.n.netten, b = this.net, T = this.T;
    if (!n || this.zoom < 5) return;
    c.globalAlpha = smooth(5, 6, this.zoom);
    // de twee hoeken van de netmond (links en rechts), naar lx, ly, rx, ry: geen arrays per net
    let lx = 0, ly = 0, rx = 0, ry = 0;
    const mond = (o) => {
      const hx = b[o + 2], hy = b[o + 3], sx = b[o] - hx * T * 0.06, sy = b[o + 1] - hy * T * 0.06;
      lx = sx - hx * T * 0.1 + hy * T * 0.04; ly = sy - hy * T * 0.1 - hx * T * 0.04;
      rx = sx - hx * T * 0.1 - hy * T * 0.04; ry = sy - hy * T * 0.1 + hx * T * 0.04;
    };
    c.fillStyle = 'rgba(40,60,55,0.2)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      mond(o);
      c.moveTo(lx, ly);
      c.quadraticCurveTo(b[o] - b[o + 2] * T * 0.24, b[o + 1] - b[o + 3] * T * 0.24, rx, ry);
      c.closePath();
    }
    c.fill();
    c.strokeStyle = 'rgba(35,35,35,0.5)';
    c.lineWidth = Math.max(0.5, T * 0.0018);
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * 4, sx = b[o] - b[o + 2] * T * 0.06, sy = b[o + 1] - b[o + 3] * T * 0.06;
      mond(o);
      c.moveTo(sx, sy); c.lineTo(lx, ly); c.moveTo(sx, sy); c.lineTo(rx, ry);
    }
    c.stroke();
    c.fillStyle = '#f07a2a';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      mond(i * 4);
      for (let j = 0; j <= 4; j++) stip(c, lx + ((rx - lx) * j) / 4, ly + ((ry - ly) * j) / 4, Math.max(0.8, T * 0.0045));
    }
    c.fill();
    c.globalAlpha = 1;
  }

  tekenBoten(c, nu = 0) {
    const n = this.nBoot, b = this.boot, T = this.T;
    if (!n) return;
    const vaart = (o) => b[o + 4] !== 0 && !(b[o + 4] === 4 && b[o + 5] === 1);
    // kielzog: een waaier van schuim die achter elke varende boot breder en vager wordt, met schuimranden
    c.fillStyle = 'rgba(232,244,250,0.28)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT;
      if (!vaart(o)) continue;
      const m = BOOT_MAAT[b[o + 4]], L = T * m[0], B = T * m[1], wl = L * 2.2, ww = L * 0.85;
      const hx = b[o + 2], hy = b[o + 3];
      const sx = b[o] - hx * L * 0.7, sy = b[o + 1] - hy * L * 0.7;
      c.moveTo(sx - hy * B, sy + hx * B);
      c.lineTo(sx - hx * wl - hy * ww, sy - hy * wl + hx * ww);
      c.lineTo(sx - hx * wl + hy * ww, sy - hy * wl - hx * ww);
      c.lineTo(sx + hy * B, sy - hx * B);
      c.closePath();
    }
    c.fill();
    if (T >= 90) {
      c.strokeStyle = 'rgba(246,250,252,0.5)';
      c.lineWidth = Math.max(0.6, T * 0.004);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * BOOT;
        if (!vaart(o)) continue;
        const m = BOOT_MAAT[b[o + 4]], L = T * m[0], B = T * m[1], wl = L * 2.4;
        const hx = b[o + 2], hy = b[o + 3], sx = b[o] + hx * L * 0.6, sy = b[o + 1] + hy * L * 0.6;
        for (let k = 1; k >= -1; k -= 2) {
          const ww = L * (0.95 + 0.08 * Math.sin(nu / 260 + i + k));
          c.moveTo(sx - hy * k * B * 0.8, sy + hx * k * B * 0.8);
          c.lineTo(sx - hx * wl - hy * k * ww, sy - hy * wl + hx * k * ww);
        }
      }
      c.stroke();
    }
    const wx = this.windX, wy = this.windY, kr = this.wnd.kracht;
    // waar het zeil staat: het zwaait naar de lijzijde en helt verder over naarmate het harder waait
    const zeil = (o, dx, dy) => {
      const x = b[o] + dx, y = b[o + 1] + dy, hx = b[o + 2], hy = b[o + 3];
      const z = hx * wy - hy * wx, kant = z >= 0 ? 1 : -1, lx = -hy * kant, ly = hx * kant;
      const mx = x + hx * T * 0.012, my = y + hy * T * 0.012;
      const top = T * (0.012 + 0.03 * kr), giek = T * (0.014 + 0.026 * kr);
      const ex = mx - hx * T * 0.05 + lx * giek, ey = my - hy * T * 0.05 + ly * giek;
      c.moveTo(mx, my);
      c.lineTo(mx + lx * top, my + ly * top);
      c.quadraticCurveTo(mx - hx * T * 0.02 + lx * (top + giek) * 0.9, my - hy * T * 0.02 + ly * (top + giek) * 0.9, ex, ey);
      c.closePath();
    };
    // schaduw op het water (romp en zeil)
    c.fillStyle = 'rgba(0,18,30,0.3)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT, s = b[o + 4], m = BOOT_MAAT[s];
      if (s === 4) rechthoek(c, b[o] + T * 0.01, b[o + 1] + T * 0.013, b[o + 2], b[o + 3], T * m[0], T * m[1]);
      else ovaal(c, b[o] + T * 0.008, b[o + 1] + T * 0.01, b[o + 2], b[o + 3], T * m[0], T * m[1]);
    }
    c.fill();
    c.fillStyle = 'rgba(0,18,30,0.15)';
    c.beginPath();
    for (let i = 0; i < n; i++) if (b[i * BOOT + 4] === 2) zeil(i * BOOT, T * 0.03, T * 0.04);
    c.fill();
    // rompen: wit, hout, en de vissers in blauw of rood
    for (let k = 0; k < 4; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * BOOT, s = b[o + 4];
        const kleur = s === 4 ? 0 : s === 3 ? 2 + b[o + 5] : b[o + 5];
        if (kleur !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        const m = BOOT_MAAT[s];
        if (s === 4) rechthoek(c, b[o], b[o + 1], b[o + 2], b[o + 3], T * m[0], T * m[1]);
        else ovaal(c, b[o], b[o + 1], b[o + 2], b[o + 3], T * m[0], T * m[1]);
      }
      if (open) { c.fillStyle = k === 0 ? '#eef0ee' : k === 1 ? '#8a5a34' : k === 2 ? '#2f5d8a' : '#a8322d'; c.fill(); }
    }
    // stuurhut of kajuit; op de veerboot het autodek
    c.fillStyle = 'rgba(45,55,65,0.6)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT, s = b[o + 4];
      if (s === 2) continue;
      if (s === 4) rechthoek(c, b[o] - b[o + 2] * T * 0.012, b[o + 1] - b[o + 3] * T * 0.012, b[o + 2], b[o + 3], T * 0.09, T * 0.03);
      else if (s === 3) rechthoek(c, b[o] + b[o + 2] * T * 0.018, b[o + 1] + b[o + 3] * T * 0.018, b[o + 2], b[o + 3], T * 0.014, T * 0.014);
      else rechthoek(c, b[o] - b[o + 2] * T * 0.012, b[o + 1] - b[o + 3] * T * 0.012, b[o + 2], b[o + 3], T * 0.016, T * 0.013);
    }
    c.fill();
    if (T >= 110) this.veerDetail(c, n);
    // giek en mast van de vissers
    c.strokeStyle = 'rgba(30,30,30,0.6)';
    c.lineWidth = Math.max(0.5, T * 0.003);
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT;
      if (b[o + 4] !== 3) continue;
      c.moveTo(b[o] + b[o + 2] * T * 0.01, b[o + 1] + b[o + 3] * T * 0.01);
      c.lineTo(b[o] - b[o + 2] * T * 0.07, b[o + 1] - b[o + 3] * T * 0.07);
    }
    c.stroke();
    // zeilen: roomwit, soms rood of blauw, hellend naar de lijzijde
    for (let k = 0; k < 3; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * BOOT;
        if (b[o + 4] !== 2 || (i % 5 === 0 ? 1 + (i % 2) : 0) !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        zeil(o, 0, 0);
      }
      if (open) { c.fillStyle = k === 0 ? '#fbf6e6' : k === 1 ? '#d9443c' : '#2f6fb0'; c.fill(); }
    }
    c.strokeStyle = 'rgba(40,50,60,0.35)';
    c.lineWidth = Math.max(0.5, T * 0.004);
    c.beginPath();
    for (let i = 0; i < n; i++) if (b[i * BOOT + 4] === 2) zeil(i * BOOT, 0, 0);
    c.stroke();
  }

  // De veerboot van dichtbij: brug voorop, schoorsteen, en auto's in twee rijen op het dek.
  veerDetail(c, n) {
    const b = this.boot, T = this.T;
    let veer = false;
    for (let i = 0; i < n && !veer; i++) if (b[i * BOOT + 4] === 4) veer = true;
    if (!veer) return;
    for (let k = 0; k < 4; k++) {
      c.fillStyle = AUTO_KLEUREN[[0, 3, 4, 5][k]];
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * BOOT;
        if (b[o + 4] !== 4) continue;
        const hx = b[o + 2], hy = b[o + 3];
        for (let j = 0; j < 8; j++) {
          if ((j + i) % 4 !== k) continue;
          const langs = (-0.075 + (j >> 1) * 0.035) * T, dwars = (j & 1 ? 1 : -1) * 0.014 * T;
          rechthoek(c, b[o] + hx * langs - hy * dwars, b[o + 1] + hy * langs + hx * dwars, hx, hy, T * 0.011, T * 0.006);
        }
      }
      c.fill();
    }
    c.fillStyle = '#f4f5f2';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT;
      if (b[o + 4] === 4) rechthoek(c, b[o] + b[o + 2] * T * 0.09, b[o + 1] + b[o + 3] * T * 0.09, b[o + 2], b[o + 3], T * 0.018, T * 0.036);
    }
    c.fill();
    c.fillStyle = '#c8322b';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT;
      if (b[o + 4] === 4) stip(c, b[o] + b[o + 2] * T * 0.09, b[o + 1] + b[o + 3] * T * 0.09, T * 0.008);
    }
    c.fill();
  }

  // ---------- rook en vuur ----------

  zetRook(sx, sy, zaad, schaal, licht = false) {
    if (this.nRook >= this.rook.length / ROOK) return;
    const o = this.nRook++ * ROOK;
    this.rook[o] = sx; this.rook[o + 1] = sy; this.rook[o + 2] = zaad; this.rook[o + 3] = licht ? -schaal : schaal;
  }

  // Tegels waar gevochten wordt: één keer per frame uit state.eenheden (alleen lezen), zonder Map per eenheid.
  verzamelGevechten() {
    const s = this.state, geo = this.geo, merk = this.merk, v = this.vecht;
    let nV = 0;
    for (let i = 0; i < s.eenheden.length && nV < v.length; i++) {
      const u = s.eenheden[i];
      if (!u.vecht || u.t == null || u.t < 0 || merk[u.t]) continue;
      merk[u.t] = 1;
      v[nV++] = u.t;
    }
    for (let i = 0; i < nV; i++) merk[v[i]] = 0;
    let kolommen = 0;
    const Tw = geo.T, sc = this.sc;
    for (let i = 0; i < nV && kolommen < PLAFOND.rook; i++) {
      const t = v[i], tg = geo.tegels[t];
      // één kolom op de tegel zelf en één op een buurtegel (binnen één tegel)
      for (let j = 0; j < 2 && kolommen < PLAFOND.rook; j++) {
        const dk = j ? Math.floor(hash(t, 51) * 3) - 1 : 0, dr = j ? Math.floor(hash(t, 52) * 3) - 1 : 0;
        const wx = tg.x + (dk + (hash(t, j, 53) - 0.5) * 0.6) * Tw;
        const wy = tg.y + (dr + (hash(t, j, 54) - 0.5) * 0.6) * Tw;
        if (wx < this.wx0 - Tw || wx > this.wx1 + Tw || wy < this.wy0 - Tw || wy > this.wy1 + Tw * 2) continue;
        this.zetRook(wx * sc + this.ox, wy * sc + this.oy, t * 3 + j, 1);
        kolommen++;
      }
    }
    this.nGevecht = kolommen;
  }

  // Grijze wolkjes die opstijgen en uitwaaieren (eigen kopie van rook() uit detail.js), gebundeld in drie
  // dichtheidsbanden per kleur; onder de oorlogsrook een flakkerend oranje vuur.
  tekenRook(c, nu, a, z = 0) {
    const n = this.nRook, b = this.rook, T = this.T;
    if (!n || a <= 0) return;
    const tijd = nu / 1000;
    c.globalAlpha = a;
    // vuur aan de voet van de oorlogsrook
    if (this.nGevecht) {
      c.fillStyle = `rgba(255,140,40,${0.6 + 0.3 * Math.sin(nu / 90)})`;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * ROOK;
        if (b[o + 3] !== 1) continue;
        stip(c, b[o], b[o + 1], T * 0.045 * (1 + 0.25 * Math.sin(nu / 80 + b[o + 2])));
      }
      c.fill();
      c.fillStyle = 'rgba(255,225,120,0.85)';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * ROOK;
        if (b[o + 3] !== 1) continue;
        stip(c, b[o], b[o + 1], T * 0.02 * (1 + 0.3 * Math.sin(nu / 60 + b[o + 2] * 3)));
      }
      c.fill();
    }
    const BANDEN = [0.5, 0.32, 0.14];
    // diep ingezoomd tekent de troepenlaag eigen rook en vuur per eenheid; de oorlogskolommen wijken dan
    // terug, anders liggen er donkere vlekken over de stad
    const oorlogA = 1 - 0.65 * smooth(6, 7.5, z);
    // soort 0: donkere rook, 1: lichte rook (stoom), 2: oorlogsrook
    for (let soort = 0; soort < 3; soort++) {
      const licht = soort === 1;
      for (let band = 0; band < 3; band++) {
        let open = false;
        for (let i = 0; i < n; i++) {
          const o = i * ROOK;
          const s = b[o + 3] < 0 ? 1 : b[o + 3] === 1 ? 2 : 0;
          if (s !== soort) continue;
          const schaal = Math.abs(b[o + 3]), zaad = b[o + 2];
          const pufjes = schaal >= 1 ? 6 : 4;
          for (let p = 0; p < pufjes; p++) {
            const f = frac(tijd * (licht ? 0.35 : 0.22) + p / pufjes + frac(zaad * 0.618));
            if (Math.min(2, Math.floor(f * 3)) !== band) continue;
            if (!open) { c.beginPath(); open = true; }
            const x = b[o] + (f * 0.22 + Math.sin(f * 4 + zaad) * 0.03) * T * schaal;
            const y = b[o + 1] - f * 0.9 * T * schaal;
            stip(c, x, y, T * schaal * (0.04 + f * 0.12));
          }
        }
        if (open) { c.fillStyle = licht ? `rgba(228,228,226,${BANDEN[band] * 0.7})` : `rgba(72,68,64,${BANDEN[band] * (soort === 2 ? oorlogA : 1)})`; c.fill(); }
      }
    }
    c.globalAlpha = 1;
  }

  // ---------- vogels ----------

  tekenVogels(c, nu, a) {
    if (a <= 0) return;
    const Z = this.zwermen, sc = this.sc, b = this.vogel, MAX = PLAFOND.vogels;
    const tijd = nu / 1000;
    let n = 0;
    const span = Math.max(2.5, 0.55 * sc);
    for (let z = 0; z < Z.length / 9 && n < MAX; z++) {
      const o = z * 9;
      const cx = Z[o], cy = Z[o + 1], R = Z[o + 2];
      // hele zwerm overslaan als zijn bereik buiten beeld valt
      if (cx + R + 10 < this.wx0 || cx - R - 10 > this.wx1 || cy + R + 10 < this.wy0 || cy - R - 10 > this.wy1) continue;
      const w1 = Z[o + 4], w2 = w1 * Z[o + 5];
      const lx = cx + R * Math.sin(tijd * w1 + Z[o + 6]);
      const ly = cy + R * 0.7 * Math.sin(tijd * w2 + Z[o + 7]);
      let hx = R * w1 * Math.cos(tijd * w1 + Z[o + 6]), hy = R * 0.7 * w2 * Math.cos(tijd * w2 + Z[o + 7]);
      const hl = Math.hypot(hx, hy) || 1;
      hx /= hl; hy /= hl;
      const leden = Z[o + 3];
      for (let j = 0; j < leden && n < MAX; j++) {
        // losse V-formatie achter de leider, met een eigen schommeling
        const rij = (j + 1) >> 1, kant = j & 1 ? 1 : -1;
        const terug = rij * 1.7 + Math.sin(tijd * 1.1 + j * 1.7 + z) * 0.4;
        const opzij = j ? kant * (rij * 1.5 + Math.sin(tijd * 0.9 + j * 2.3) * 0.4) : 0;
        const wx = lx - hx * terug - hy * opzij, wy = ly - hy * terug + hx * opzij;
        const q = n * 7;
        b[q] = wx * sc + this.ox; b[q + 1] = wy * sc + this.oy; b[q + 2] = hx; b[q + 3] = hy;
        b[q + 4] = Math.sin(nu / 120 + j + z * 3); b[q + 5] = Z[o + 8]; b[q + 6] = span;
        n++;
      }
    }
    this.nVogel = n;
    if (!n) return;
    // Elke vogel is een kleine "v" die met de vleugelslag smaller en breder wordt; soort -1 = alle vogels.
    const vleugels = (dx, dy, soort) => {
      for (let i = 0; i < n; i++) {
        const q = i * 7;
        if (soort >= 0 && b[q + 5] !== soort) continue;
        const x = b[q] + dx, y = b[q + 1] + dy, hx = b[q + 2], hy = b[q + 3], w = b[q + 6];
        const slag = 0.55 + 0.45 * b[q + 4];
        const terug = w * (0.35 + 0.35 * (1 - slag)), breed = w * (0.7 + 0.3 * slag);
        c.moveTo(x - hx * terug - hy * breed, y - hy * terug + hx * breed);
        c.lineTo(x, y);
        c.lineTo(x - hx * terug + hy * breed, y - hy * terug - hx * breed);
      }
    };
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = Math.max(1, span * 0.16);
    // schaduw op de grond
    c.globalAlpha = a * 0.15;
    c.strokeStyle = '#000';
    c.beginPath(); vleugels(8, 10, -1); c.stroke();
    c.globalAlpha = a;
    for (let k = 0; k < 2; k++) {
      c.strokeStyle = k ? 'rgba(246,246,240,0.95)' : 'rgba(26,28,30,0.85)';
      c.beginPath(); vleugels(0, 0, k); c.stroke();
    }
    c.globalAlpha = 1;
  }

  // ---------- platteland: tractoren, maaidorsers, kuddes, vliegers, sneeuwpoppen, eenden ----------

  // Eén keer over de zichtbare tegels; elke soort leven heeft zijn eigen voorwaarde en zoomdrempel.
  tekenPlatteland(c, nu) {
    const s = this.state, geo = this.geo, Tw = geo.T, z = this.zoom, sz = this.sz;
    const dag = this.nachtVorig < 0.5;
    // lente: ploegen; eind zomer: oogsten; in de herfst wordt de stoppel weer omgeploegd
    const ploeg = clamp(sz.lente * 1.2 + sz.herfst * 0.6 * (1 - sz.oogst), 0, 1), oogst = sz.oogst;
    const werk = dag ? Math.max(ploeg, oogst) * (this.wr.regen < 0.5 ? 1 : 0.3) : 0;
    const sneeuw = sz.sneeuw > 0.25;
    const vliegerWeer = z >= 7 && this.wnd.kracht > 0.5 && this.nat < 0.1 && sz.winter < 0.5 && dag;
    const vlinderWeer = z >= 10.5 && sz.lente + sz.zomer > 0.4 && this.nat < 0.1 && dag;
    const bladWeer = z >= 10.5 && sz.herfst > 0.3;
    const strandWeer = z >= 7 && sz.zomer > 0.5 && this.nat < 0.05 && this.wr.wolken < 0.7 && dag;
    this.nPop = this.nVlieger = this.nEend = this.nStrand = this.nZwem = 0;
    for (let r = this.r0; r <= this.r1; r++) {
      for (let k = this.k0; k <= this.k1; k++) {
        const t = r * geo.kol + k, g = this.grond[t], soort = this.soort[t], tg = geo.tegels[t];
        if (soort === HOOFD || soort === WOON) {
          // sneeuwpop op de hoek van het kruis (in de hoofdstad op een hoek van het plein)
          if (sneeuw && z >= 7.5 && hash(t, 151) < 0.7) {
            const f = soort === HOOFD ? 0.125 : 0.075;
            this.zetPop(tg.x + (hash(t, 152) < 0.5 ? -f : f) * Tw, tg.y + (hash(t, 153) < 0.5 ? -f : f) * Tw);
          }
          if (bladWeer) for (let i = 0; i < 5; i++) this.zetBlad(t, i, tg);
          if (vlinderWeer && hash(t, 154) < 0.6) this.zetVlinder(t, 0, tg);
          continue;
        }
        if (g === KUSTWATER) { if (z >= 9 && sz.koud < 0.85 && hash(t, 141) < 0.3) this.eenden(t, tg); continue; }
        if (soort !== LEEG || g === GEEN) {
          if (soort === LEEG && tg.terrein === 'bos') {
            if (bladWeer) for (let i = 0; i < 3; i++) this.zetBlad(t, i, tg);
            if (z >= 8 && this.nachtVorig < 0.7 && hash(t, 171) < 0.3) this.herten(t, tg);
          } else if (soort === LEEG && tg.terrein === 'kust' && strandWeer && hash(t, 175) < 0.6) this.strand(t, tg);
          continue;
        }
        const land = this.landVan(t);
        if (land < 0) continue;
        if (g === AKKER) { if (werk > 0 && hash(t, 101) < 0.5 * werk) this.machine(t, tg, ploeg >= oogst); continue; }
        // weide
        const d = levenDichtheid(s, land);
        if (hash(t, 111) < 0.42) this.kudde(t, tg, d);
        if (vliegerWeer && hash(t, 121) < 0.18) this.vlieger(t, tg);
        if (sneeuw && z >= 7.5 && hash(t, 131) < 0.3) this.zetPop(tg.x + (hash(t, 132) - 0.5) * 0.5 * Tw, tg.y + (hash(t, 133) - 0.5) * 0.5 * Tw);
        if (sneeuw && dag && z >= 7 && hash(t, 134) < 0.35) this.sleetjes(t, tg);
        if (vlinderWeer) for (let i = 0; i < 3; i++) this.zetVlinder(t, i, tg);
      }
    }
    this.tekenAkkerwerk(c, nu, smooth(4, 5, z));
    this.tekenDieren(c, smooth(4.5, 5.5, z));
    this.tekenEenden(c);
    this.tekenStrand(c, nu);
    this.tekenPoppen(c);
    this.tekenVliegers(c, nu);
  }

  // Een groepje herten aan de bosrand dat graast en af en toe een paar passen zet.
  herten(t, tg) {
    const Tw = this.geo.T, klok = this.klok;
    if (!this.inBeeld(tg.x, tg.y, Tw * 0.5)) return;
    const N = 2 + Math.floor(hash(t, 172) * 3);
    const cx = tg.x + (hash(t, 173) - 0.5) * 0.5 * Tw, cy = tg.y + (hash(t, 174) - 0.5) * 0.5 * Tw;
    for (let i = 0; i < N; i++) {
      const stap = Math.floor(klok / 12 + hash(t, i, 176) * 5) * 0.7; // springt per twaalf seconden naar een nieuwe plek
      const wx = cx + Math.sin(stap + i) * 0.05 * Tw + (i - N / 2) * 0.03 * Tw, wy = cy + Math.cos(stap * 1.3 + i) * 0.04 * Tw;
      const hoek = hash(t, i, 177) * TAU + stap;
      this.zetDier(wx, wy, Math.cos(hoek), Math.sin(hoek), 6, hash(t, i, 178));
    }
  }

  // Strand op een zomerse dag: parasols met handdoeken, mensen die zonnen, en zwemmers in het water ervoor.
  strand(t, tg) {
    const geo = this.geo, Tw = geo.T, sc = this.sc;
    if (!this.inBeeld(tg.x, tg.y, Tw * 0.6)) return;
    // richting van het water: het gemiddelde van de natte buren
    let wx = 0, wy = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
      const k = tg.k + dk, r = tg.r + dr;
      if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
      if (geo.tegels[r * geo.kol + k].terrein === 'water') { wx += dk; wy += dr; }
    }
    const l = Math.hypot(wx, wy);
    if (!l) return;
    wx /= l; wy /= l;
    for (let i = 0; i < 5 && this.nStrand < PLAFOND.parasols; i++) {
      if (hash(t, i, 179) > 0.7) continue;
      const zij = (i - 2) * 0.13 * Tw, af = (0.22 + 0.08 * hash(t, i, 180)) * Tw;
      const px = tg.x + wx * af - wy * zij, py = tg.y + wy * af + wx * zij;
      if (this.isWater(px, py)) continue;
      const o = this.nStrand++ * 4, b = this.strandBuf;
      b[o] = px * sc + this.ox; b[o + 1] = py * sc + this.oy; b[o + 2] = Math.floor(hash(t, i, 181) * KRAAM.length); b[o + 3] = Math.floor(hash(t, i, 182) * KLEDING.length);
    }
    this.n.parasols = this.nStrand;
    for (let i = 0; i < 3 && this.nZwem < PLAFOND.zwemmers; i++) {
      const zij = (i - 1) * 0.15 * Tw + Math.sin(this.klok * 0.2 + i) * 0.03 * Tw, af = (0.6 + 0.1 * hash(t, i, 183)) * Tw;
      const px = tg.x + wx * af - wy * zij, py = tg.y + wy * af + wx * zij;
      if (!this.isWater(px, py)) continue;
      const o = this.nZwem++ * 3, b = this.zwemBuf;
      b[o] = px * sc + this.ox; b[o + 1] = py * sc + this.oy; b[o + 2] = Math.floor(hash(t, i, 184) * HUID.length);
    }
    this.n.zwemmers = this.nZwem;
  }

  tekenStrand(c, nu) {
    const T = this.T;
    if (!this.nStrand && !this.nZwem) return;
    c.globalAlpha = smooth(7, 8, this.zoom);
    const b = this.strandBuf, n = this.nStrand, R = T * 0.022;
    // handdoek met iemand die erop ligt te zonnen, dan de parasol er schuin boven
    for (let k = 0; k < KLEDING.length; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        if (b[i * 4 + 3] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        c.rect(b[i * 4] + R * 0.6, b[i * 4 + 1] - R * 0.2, R * 0.55, R * 1.2);
      }
      if (open) { c.fillStyle = KLEDING[k]; c.fill(); }
    }
    c.fillStyle = HUID[0];
    c.beginPath();
    for (let i = 0; i < n; i++) { stip(c, b[i * 4] + R * 0.87, b[i * 4 + 1] + R * 0.05, R * 0.18); rechthoek(c, b[i * 4] + R * 0.87, b[i * 4 + 1] + R * 0.55, 0, 1, R * 0.35, R * 0.13); }
    c.fill();
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.beginPath();
    for (let i = 0; i < n; i++) stip(c, b[i * 4] + R * 0.5, b[i * 4 + 1] + R * 0.65, R);
    c.fill();
    for (let k = 0; k < KRAAM.length; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        if (b[i * 4 + 2] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        stip(c, b[i * 4], b[i * 4 + 1], R);
      }
      if (open) { c.fillStyle = KRAAM[k][0]; c.fill(); }
    }
    // banen in de tweede kleur en hoogtelicht linksboven
    if (T >= 140) {
      for (let k = 0; k < KRAAM.length; k++) {
        let open = false;
        for (let i = 0; i < n; i++) {
          if (b[i * 4 + 2] !== k) continue;
          if (!open) { c.beginPath(); open = true; }
          const x = b[i * 4], y = b[i * 4 + 1];
          for (let j = 0; j < 4; j++) { c.moveTo(x, y); c.arc(x, y, R, (j / 4) * TAU, (j / 4 + 0.125) * TAU); c.closePath(); }
        }
        if (open) { c.fillStyle = KRAAM[k][1]; c.fill(); }
      }
    }
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.beginPath();
    for (let i = 0; i < n; i++) stip(c, b[i * 4] - R * 0.35, b[i * 4 + 1] - R * 0.35, R * 0.4);
    c.fill();
    // zwemmers: alleen het hoofd boven water, met een kringetje eromheen
    const z = this.zwemBuf, m = this.nZwem;
    if (m) {
      c.strokeStyle = 'rgba(240,248,252,0.55)'; c.lineWidth = Math.max(0.5, T * 0.0018);
      c.beginPath();
      for (let i = 0; i < m; i++) { const r = T * (0.012 + 0.004 * Math.sin(nu / 400 + i)); c.moveTo(z[i * 3] + r, z[i * 3 + 1]); c.arc(z[i * 3], z[i * 3 + 1], r, 0, TAU); }
      c.stroke();
      for (let k = 0; k < HUID.length; k++) {
        let open = false;
        for (let i = 0; i < m; i++) {
          if (z[i * 3 + 2] !== k) continue;
          if (!open) { c.beginPath(); open = true; }
          stip(c, z[i * 3], z[i * 3 + 1], T * 0.0055);
        }
        if (open) { c.fillStyle = HUID[k]; c.fill(); }
      }
    }
    c.globalAlpha = 1;
  }

  // Tractor of maaidorser die baan voor baan over een akker werkt, langs de richting van de percelen.
  machine(t, tg, ploegen) {
    if (this.n.machines >= PLAFOND.machines) return;
    const Tw = this.geo.T, sc = this.sc;
    if (!this.inBeeld(tg.x, tg.y, Tw * 0.5)) return;
    // dezelfde draaiing als het akkerrooster in terrein.js, zodat de voren met de percelen meelopen
    const hoek = hash(tg.eig, 9) * Math.PI, co = Math.cos(hoek), si = Math.sin(hoek);
    const H = 0.27 * Tw, nL = 6, lw = (2 * H) / nL;
    const u = frac(this.klok / 150 + hash(t, 102));
    const li = Math.min(nL - 1, Math.floor(u * nL)), fl = u * nL - li, dir = li & 1 ? -1 : 1;
    const uPos = dir > 0 ? -H + fl * 2 * H : H - fl * 2 * H, vPos = -H + (li + 0.5) * lw;
    const wx = tg.x + uPos * co - vPos * si, wy = tg.y + uPos * si + vPos * co;
    const o = this.n.machines++ * MACH, b = this.mach;
    const soort = ploegen ? 0 : 1;
    b[o] = wx * sc + this.ox; b[o + 1] = wy * sc + this.oy; b[o + 2] = co * dir; b[o + 3] = si * dir;
    b[o + 4] = soort; b[o + 5] = soort ? 4 + Math.floor(hash(t, 103) * DORSER.length) : Math.floor(hash(t, 103) * TRACTOR.length);
    b[o + 6] = tg.x * sc + this.ox; b[o + 7] = tg.y * sc + this.oy; b[o + 8] = co; b[o + 9] = si;
    b[o + 10] = li; b[o + 11] = uPos; b[o + 12] = dir;
    // strobalen op de geoogste banen, meeuwen achter de ploeg in het voorjaar
    if (soort === 1) {
      for (let j = 0; j < li && this.n.balen < PLAFOND.balen; j++) {
        for (let q = 0; q < 2 && this.n.balen < PLAFOND.balen; q++) {
          const bu = (q ? 0.45 : -0.4 + 0.2 * hash(t, j, 104)) * H, bv = -H + (j + 0.5) * lw;
          const p = this.n.balen++ * 2;
          this.baal[p] = (tg.x + bu * co - bv * si) * sc + this.ox; this.baal[p + 1] = (tg.y + bu * si + bv * co) * sc + this.oy;
        }
      }
    } else if (this.sz.lente > 0.3 && this.zoom >= 5.5) {
      const T = this.T;
      for (let j = 0; j < 3; j++) {
        const a = this.klok * (1.1 + 0.3 * j) + j * 2;
        this.zetMeeuw(b[o] - b[o + 2] * T * 0.08 + Math.cos(a) * T * 0.035, b[o + 1] - b[o + 3] * T * 0.08 + Math.sin(a) * T * 0.03, -Math.sin(a), Math.cos(a), this.klok * 9 + j);
      }
    }
  }

  tekenAkkerwerk(c, nu, a) {
    const n = this.n.machines, b = this.mach, T = this.T, sc = this.sc;
    if (!n || a <= 0) return;
    c.globalAlpha = a;
    const H = 0.27 * this.geo.T * sc, lw = (2 * H) / 6;
    // het bewerkte deel: donkere voren (ploegen) of lichte stoppel (oogst), baan voor baan groeiend
    for (let soort = 0; soort < 2; soort++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * MACH;
        if (b[o + 4] !== soort) continue;
        if (!open) { c.beginPath(); open = true; }
        const cx = b[o + 6], cy = b[o + 7], co = b[o + 8], si = b[o + 9], li = b[o + 10], u = b[o + 11] * sc, dir = b[o + 12];
        if (li > 0) vak(c, cx, cy, co, si, -H, H, -H, -H + li * lw);
        const start = dir > 0 ? -H : H;
        vak(c, cx, cy, co, si, Math.min(start, u), Math.max(start, u), -H + li * lw, -H + (li + 1) * lw);
      }
      if (open) { c.fillStyle = soort ? 'rgba(226,210,150,0.6)' : 'rgba(78,59,40,0.55)'; c.fill(); }
    }
    // voren dichtbij: twee lijntjes per afgewerkte baan
    if (T >= 150) {
      c.strokeStyle = 'rgba(40,28,18,0.35)';
      c.lineWidth = Math.max(0.5, T * 0.0018);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * MACH;
        if (b[o + 4] !== 0) continue;
        const cx = b[o + 6], cy = b[o + 7], co = b[o + 8], si = b[o + 9], li = b[o + 10];
        for (let j = 0; j < li * 2; j++) {
          const v = -H + (j + 0.5) * (lw / 2);
          c.moveTo(cx - H * co - v * si, cy - H * si + v * co); c.lineTo(cx + H * co - v * si, cy + H * si + v * co);
        }
      }
      c.stroke();
    }
    // strobalen: rond, met schaduw en een lichte bovenkant
    const nB = this.n.balen;
    if (nB && T >= 110) {
      const r = T * 0.012;
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.beginPath();
      for (let i = 0; i < nB; i++) stip(c, this.baal[i * 2] + r * 0.4, this.baal[i * 2 + 1] + r * 0.55, r);
      c.fill();
      c.fillStyle = '#d6b85a';
      c.beginPath();
      for (let i = 0; i < nB; i++) stip(c, this.baal[i * 2], this.baal[i * 2 + 1], r);
      c.fill();
      c.fillStyle = 'rgba(255,245,200,0.45)';
      c.beginPath();
      for (let i = 0; i < nB; i++) stip(c, this.baal[i * 2] - r * 0.3, this.baal[i * 2 + 1] - r * 0.3, r * 0.45);
      c.fill();
    }
    // stof achter de maaidorser
    c.fillStyle = 'rgba(214,194,140,0.28)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * MACH;
      if (b[o + 4] !== 1) continue;
      for (let p = 0; p < 3; p++) {
        const f = frac(nu / 1400 + p / 3 + i * 0.37);
        stip(c, b[o] - b[o + 2] * T * (0.05 + f * 0.08) + this.windX * f * T * 0.04, b[o + 1] - b[o + 3] * T * (0.05 + f * 0.08) + this.windY * f * T * 0.04, T * (0.012 + f * 0.025));
      }
    }
    c.fill();
    // schaduw van machine en ploeg
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * MACH, x = b[o] + T * 0.008, y = b[o + 1] + T * 0.011, hx = b[o + 2], hy = b[o + 3];
      if (b[o + 4] === 0) { rechthoek(c, x, y, hx, hy, T * 0.024, T * 0.015); rechthoek(c, x - hx * T * 0.042, y - hy * T * 0.042, hx, hy, T * 0.007, T * 0.028); }
      else { rechthoek(c, x, y, hx, hy, T * 0.034, T * 0.022); rechthoek(c, x + hx * T * 0.045, y + hy * T * 0.045, hx, hy, T * 0.008, T * 0.055); }
    }
    c.fill();
    // ploeg (grijs) en maaibord (donker) voor of achter de machine
    c.fillStyle = '#5f6468';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * MACH, x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3];
      if (b[o + 4] === 0) rechthoek(c, x - hx * T * 0.042, y - hy * T * 0.042, hx, hy, T * 0.006, T * 0.026);
      else rechthoek(c, x + hx * T * 0.045, y + hy * T * 0.045, hx, hy, T * 0.008, T * 0.055);
    }
    c.fill();
    // wielen (alleen te zien als de machine groot genoeg is)
    if (T >= 100) {
      c.fillStyle = '#1e1e1e';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * MACH, x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3], dorser = b[o + 4] === 1;
        const achter = dorser ? -0.02 : -0.012, voor = dorser ? 0.022 : 0.02, za = dorser ? 0.022 : 0.016, zv = dorser ? 0.022 : 0.013;
        for (let k = -1; k <= 1; k += 2) {
          rechthoek(c, x + hx * T * achter - hy * k * T * za, y + hy * T * achter + hx * k * T * za, hx, hy, T * (dorser ? 0.007 : 0.009), T * 0.005);
          rechthoek(c, x + hx * T * voor - hy * k * T * zv, y + hy * T * voor + hx * k * T * zv, hx, hy, T * (dorser ? 0.009 : 0.006), T * (dorser ? 0.005 : 0.004));
        }
      }
      c.fill();
    }
    // carrosserie per kleur
    for (let k = 0; k < TRACTOR.length + DORSER.length; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * MACH;
        if (b[o + 5] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        if (b[o + 4] === 0) rechthoek(c, b[o], b[o + 1], b[o + 2], b[o + 3], T * 0.024, T * 0.013);
        else rechthoek(c, b[o], b[o + 1], b[o + 2], b[o + 3], T * 0.034, T * 0.02);
      }
      if (open) { c.fillStyle = k < TRACTOR.length ? TRACTOR[k] : DORSER[k - TRACTOR.length]; c.fill(); }
    }
    // cabine: licht dak (het noordwesten vangt het licht) en een glazen voorkant
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * MACH, x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3];
      if (b[o + 4] === 0) rechthoek(c, x - hx * T * 0.008, y - hy * T * 0.008, hx, hy, T * 0.01, T * 0.011);
      else rechthoek(c, x + hx * T * 0.02, y + hy * T * 0.02, hx, hy, T * 0.01, T * 0.012);
    }
    c.fill();
    if (T >= 120) {
      c.fillStyle = 'rgba(160,195,220,0.8)';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * MACH, f = b[o + 4] === 0 ? 0.003 : 0.031;
        rechthoek(c, b[o] + b[o + 2] * T * f, b[o + 1] + b[o + 3] * T * f, b[o + 2], b[o + 3], T * 0.002, T * 0.01);
      }
      c.fill();
      // de afvoerbuis van de maaidorser steekt opzij uit
      c.strokeStyle = '#9a8a2a'; c.lineWidth = Math.max(0.6, T * 0.004);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * MACH;
        if (b[o + 4] !== 1) continue;
        const x = b[o] - b[o + 2] * T * 0.01, y = b[o + 1] - b[o + 3] * T * 0.01;
        c.moveTo(x, y); c.lineTo(x - b[o + 3] * T * 0.045 - b[o + 2] * T * 0.01, y + b[o + 2] * T * 0.045 - b[o + 3] * T * 0.01);
      }
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // Een kudde koeien, schapen of paarden die heel langzaam over de wei trekt; 's winters staan koeien en paarden op stal.
  kudde(t, tg, d) {
    const Tw = this.geo.T, klok = this.klok, sz = this.sz;
    if (!this.inBeeld(tg.x, tg.y, Tw * 0.6)) return;
    const hk = hash(t, 112);
    const soort = hk < 0.45 ? (hash(t, 114) < 0.6 ? 0 : 1) : hk < 0.8 ? 2 : hash(t, 114) < 0.6 ? 3 : 4;
    if (sz.koud > 0.8 && soort !== 2 && hash(t, 113) > 0.3) return;
    const veel = 0.7 + 0.3 * Math.min(1.3, d.welvaart);
    const N = Math.round((soort < 2 ? 4 + hash(t, 115) * 5 : soort === 2 ? 6 + hash(t, 115) * 7 : 2 + hash(t, 115) * 4) * veel);
    const spreid = (soort === 2 ? 0.11 : soort < 2 ? 0.15 : 0.18) * Tw;
    const loop = this.nachtVorig > 0.6 ? 0 : 1; // 's nachts liggen ze stil
    const cx = tg.x + 0.14 * Tw * Math.sin(klok * 0.004 + hash(t, 116) * TAU), cy = tg.y + 0.14 * Tw * Math.cos(klok * 0.0033 + hash(t, 117) * TAU);
    for (let i = 0; i < N; i++) {
      const a = hash(t, i, 118) * TAU, rr = Math.sqrt(hash(t, i, 119)) * spreid;
      const wx = cx + Math.cos(a) * rr + 0.02 * Tw * Math.sin(klok * 0.05 * (0.5 + hash(t, i, 120)) + i * 1.3) * loop;
      const wy = cy + Math.sin(a) * rr * 0.8 + 0.02 * Tw * Math.cos(klok * 0.043 + i) * loop;
      const hoek = hash(t, i, 121) * TAU + 0.7 * Math.sin(klok * 0.012 + i) * loop;
      this.zetDier(wx, wy, Math.cos(hoek), Math.sin(hoek), soort, hash(t, i, 122));
    }
    // een herdershond die om de schapen heen draaft (alleen als zijn hele rondje op het land ligt)
    if (soort === 2 && this.zoom >= 8 && hash(t, 123) < 0.5 && this.ringOpLand(cx, cy, spreid * 1.3, spreid * 1.05)) {
      const a = klok * 0.25 * loop + hash(t, 124) * TAU;
      this.zetDier(cx + Math.cos(a) * spreid * 1.3, cy + Math.sin(a) * spreid * 1.05, -Math.sin(a), Math.cos(a), 5, 0);
    }
  }

  // Een dier op het land; een wei op een kusttegel loopt tot aan de waterlijn, dus wie in zee zou staan valt weg.
  zetDier(wx, wy, hx, hy, soort, fase) {
    if (this.n.dieren >= PLAFOND.dieren) return;
    const x = wx * this.sc + this.ox, y = wy * this.sc + this.oy;
    if (x < -8 || y < -8 || x > this.w + 8 || y > this.h + 8 || this.isWater(wx, wy)) return;
    const o = this.n.dieren++ * DIER, b = this.dier;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = soort; b[o + 5] = fase;
  }

  tekenDieren(c, a) {
    const n = this.n.dieren, b = this.dier, T = this.T;
    if (!n || a <= 0) return;
    c.globalAlpha = a;
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * DIER, m = DIER_MAAT[b[o + 4]];
      ovaal(c, b[o] + T * 0.004, b[o + 1] + T * 0.006, b[o + 2], b[o + 3], T * m[0], T * m[1]);
    }
    c.fill();
    for (let k = 0; k < DIER_KLEUR.length; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * DIER;
        if (b[o + 4] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        const m = DIER_MAAT[k];
        ovaal(c, b[o], b[o + 1], b[o + 2], b[o + 3], T * m[0], T * m[1]);
      }
      if (open) { c.fillStyle = DIER_KLEUR[k]; c.fill(); }
    }
    // vlekken op de zwartbonte koeien
    if (T >= 140) {
      c.fillStyle = '#26221f';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * DIER;
        if (b[o + 4] !== 0) continue;
        const hx = b[o + 2], hy = b[o + 3], f = b[o + 5];
        stip(c, b[o] - hx * T * 0.004 - hy * T * 0.002 * (f - 0.5), b[o + 1] - hy * T * 0.004 + hx * T * 0.002, T * 0.0045);
        stip(c, b[o] + hx * T * 0.006 + hy * T * 0.002, b[o + 1] + hy * T * 0.006 - hx * T * 0.002 * f, T * 0.0035);
      }
      c.fill();
    }
    // koppen: wie graast, heeft de kop omlaag (iets naar voren)
    if (T >= 90) {
      for (let k = 0; k < DIER_KOP.length; k++) {
        let open = false;
        for (let i = 0; i < n; i++) {
          const o = i * DIER;
          if (b[o + 4] !== k) continue;
          if (!open) { c.beginPath(); open = true; }
          const m = DIER_MAAT[k], gr = 0.9 + 0.15 * Math.sin(this.klok * 0.8 + b[o + 5] * 20);
          stip(c, b[o] + b[o + 2] * T * m[0] * gr, b[o + 1] + b[o + 3] * T * m[0] * gr, T * m[1] * 0.62);
        }
        if (open) { c.fillStyle = DIER_KOP[k]; c.fill(); }
      }
    }
    // hoogtelicht op de rug (licht uit het noordwesten)
    if (T >= 200) {
      c.fillStyle = 'rgba(255,255,255,0.22)';
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * DIER, m = DIER_MAAT[b[o + 4]]; stip(c, b[o] - T * m[1] * 0.35, b[o + 1] - T * m[1] * 0.4, T * m[1] * 0.45); }
      c.fill();
    }
    c.globalAlpha = 1;
  }

  // Iemand op de wei met een vlieger die met de wind mee de lucht in staat; de staart kronkelt.
  vlieger(t, tg) {
    if (this.nVlieger >= PLAFOND.vliegers) return;
    const Tw = this.geo.T, sc = this.sc, kr = this.wnd.kracht, klok = this.klok;
    const px = tg.x + (hash(t, 125) - 0.5) * 0.4 * Tw, py = tg.y + (hash(t, 126) - 0.5) * 0.4 * Tw;
    if (this.isWater(px, py)) return; // wie de vlieger vasthoudt, staat op het land
    const af = (0.12 + 0.06 * kr) * Tw, zw = Math.sin(klok * 0.9 + t) * 0.02 * Tw;
    const kx = px + this.windX * af - this.windY * zw, ky = py + this.windY * af + this.windX * zw;
    const x = px * sc + this.ox, y = py * sc + this.oy;
    if (x < -40 || y < -40 || x > this.w + 40 || y > this.h + 40) return;
    const o = this.nVlieger++ * 6, b = this.vliegerBuf;
    b[o] = x; b[o + 1] = y; b[o + 2] = kx * sc + this.ox; b[o + 3] = ky * sc + this.oy; b[o + 4] = Math.floor(hash(t, 127) * VLIEGER.length); b[o + 5] = t;
    this.n.vliegers = this.nVlieger;
  }

  tekenVliegers(c, nu) {
    const n = this.nVlieger, b = this.vliegerBuf, T = this.T;
    if (!n) return;
    c.globalAlpha = smooth(7, 8, this.zoom);
    const wx = this.windX, wy = this.windY, kl = T * 0.018;
    // touw van de hand naar de vlieger
    c.strokeStyle = 'rgba(250,250,245,0.6)'; c.lineWidth = Math.max(0.5, T * 0.0012);
    c.beginPath();
    for (let i = 0; i < n; i++) { c.moveTo(b[i * 6], b[i * 6 + 1]); c.lineTo(b[i * 6 + 2], b[i * 6 + 3]); }
    c.stroke();
    // schaduw van de vlieger: hij hangt hoog, dus de schaduw ligt een eind naar het zuidoosten
    const ruit = (x, y) => { c.moveTo(x + wx * kl, y + wy * kl); c.lineTo(x - wy * kl * 0.6, y + wx * kl * 0.6); c.lineTo(x - wx * kl * 0.8, y - wy * kl * 0.8); c.lineTo(x + wy * kl * 0.6, y - wx * kl * 0.6); c.closePath(); };
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.beginPath();
    for (let i = 0; i < n; i++) ruit(b[i * 6 + 2] + T * 0.05, b[i * 6 + 3] + T * 0.065);
    c.fill();
    for (let k = 0; k < VLIEGER.length; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        if (b[i * 6 + 4] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        ruit(b[i * 6 + 2], b[i * 6 + 3]);
      }
      if (open) { c.fillStyle = VLIEGER[k]; c.fill(); }
    }
    // kronkelende staart tegen de wind in
    c.strokeStyle = '#f2f2ef'; c.lineWidth = Math.max(0.5, T * 0.002);
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const x = b[i * 6 + 2] - wx * kl * 0.8, y = b[i * 6 + 3] - wy * kl * 0.8;
      c.moveTo(x, y);
      for (let j = 1; j <= 4; j++) {
        const zw = Math.sin(nu / 160 + j * 1.3 + b[i * 6 + 5]) * T * 0.006;
        c.lineTo(x - wx * j * T * 0.009 - wy * zw, y - wy * j * T * 0.009 + wx * zw);
      }
    }
    c.stroke();
    // wie de vlieger vasthoudt
    c.fillStyle = '#34495e';
    c.beginPath();
    for (let i = 0; i < n; i++) stip(c, b[i * 6], b[i * 6 + 1], T * 0.011);
    c.fill();
    c.fillStyle = HUID[1];
    c.beginPath();
    for (let i = 0; i < n; i++) stip(c, b[i * 6], b[i * 6 + 1] - T * 0.002, T * 0.006);
    c.fill();
    c.globalAlpha = 1;
  }

  // Twee kinderen die met de slee van een helling glijden en hem weer omhoog trekken.
  sleetjes(t, tg) {
    const Tw = this.geo.T;
    const bx = tg.x + (hash(t, 135) - 0.5) * 0.3 * Tw, by = tg.y + (hash(t, 136) - 0.5) * 0.3 * Tw;
    // de hele glijbaan (beide uiteinden, beide kinderen) moet op het land liggen
    for (let s = -1; s <= 1; s += 2) for (let k = -1; k <= 1; k += 2) {
      if (this.isWater(bx + (s * 0.09 - k * 0.032) * Tw, by + (s * 0.12 + k * 0.024) * Tw)) return;
    }
    for (let j = 0; j < 2; j++) {
      const v = this.klok / 9 + hash(t, j, 137);
      const pos = tri(v), dir = triRichting(v);
      const zij = (j - 0.5) * 0.08 * Tw;
      this.zetFig(bx + (pos - 0.5) * 0.18 * Tw - 0.8 * zij, by + (pos - 0.5) * 0.24 * Tw + 0.6 * zij, 0.6 * dir, 0.8 * dir, SLEE, 6 + Math.floor(hash(t, j, 138) * 4), Math.floor(hash(t, j, 139) * 3), 0, 0);
    }
  }

  zetPop(wx, wy) {
    if (this.nPop >= PLAFOND.sneeuwpoppen) return;
    const x = wx * this.sc + this.ox, y = wy * this.sc + this.oy;
    if (x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10 || this.isWater(wx, wy)) return;
    this.popBuf[this.nPop * 2] = x; this.popBuf[this.nPop * 2 + 1] = y;
    this.n.sneeuwpoppen = ++this.nPop;
  }

  // Sneeuwpop van bovenaf: drie bollen op elkaar (de bovenste het dichtst bij het licht), wortel, hoed en armpjes.
  tekenPoppen(c) {
    const n = this.nPop, b = this.popBuf, T = this.T;
    if (!n) return;
    c.globalAlpha = smooth(7.5, 8.5, this.zoom);
    const r = T * 0.013;
    c.fillStyle = 'rgba(40,50,70,0.3)';
    c.beginPath();
    for (let i = 0; i < n; i++) stip(c, b[i * 2] + r * 0.9, b[i * 2 + 1] + r * 1.2, r);
    c.fill();
    c.fillStyle = '#c9d3df';
    c.beginPath();
    for (let i = 0; i < n; i++) stip(c, b[i * 2] + r * 0.12, b[i * 2 + 1] + r * 0.12, r);
    c.fill();
    c.fillStyle = '#fbfcff';
    c.beginPath();
    for (let i = 0; i < n; i++) { const x = b[i * 2], y = b[i * 2 + 1]; stip(c, x - r * 0.05, y - r * 0.05, r * 0.9); stip(c, x - r * 0.3, y - r * 0.35, r * 0.62); stip(c, x - r * 0.5, y - r * 0.6, r * 0.4); }
    c.fill();
    if (T >= 160) {
      c.fillStyle = '#e8762a';
      c.beginPath();
      for (let i = 0; i < n; i++) stip(c, b[i * 2] - r * 0.22, b[i * 2 + 1] - r * 0.5, Math.max(0.6, r * 0.13));
      c.fill();
      c.fillStyle = '#26282b';
      c.beginPath();
      for (let i = 0; i < n; i++) stip(c, b[i * 2] - r * 0.55, b[i * 2 + 1] - r * 0.68, r * 0.28);
      c.fill();
      c.strokeStyle = '#5a3f2a'; c.lineWidth = Math.max(0.5, T * 0.0015);
      c.beginPath();
      for (let i = 0; i < n; i++) { const x = b[i * 2] - r * 0.3, y = b[i * 2 + 1] - r * 0.35; c.moveTo(x - r * 0.6, y - r * 0.3); c.lineTo(x - r * 1.3, y - r * 0.6); c.moveTo(x + r * 0.6, y + r * 0.1); c.lineTo(x + r * 1.3, y - r * 0.2); }
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // Een moedereend met een rijtje kuikens die een rondje zwemmen langs de kust.
  eenden(t, tg) {
    const Tw = this.geo.T, sc = this.sc;
    const richting = hash(t, 142) < 0.5 ? 1 : -1, R = 0.1 * Tw;
    const kuikens = 2 + Math.floor(hash(t, 143) * 3);
    for (let j = 0; j <= kuikens && this.nEend < PLAFOND.eenden; j++) {
      const a = (this.klok * TAU) / 55 * richting + hash(t, 144) * TAU - j * 0.32 * richting;
      const x = (tg.x + Math.cos(a) * R) * sc + this.ox, y = (tg.y + Math.sin(a) * R * 0.7) * sc + this.oy;
      if (x < -6 || y < -6 || x > this.w + 6 || y > this.h + 6 || !this.isWater(tg.x + Math.cos(a) * R, tg.y + Math.sin(a) * R * 0.7)) continue;
      const o = this.nEend++ * 5, b = this.eendBuf;
      b[o] = x; b[o + 1] = y; b[o + 2] = -Math.sin(a) * richting; b[o + 3] = Math.cos(a) * richting * 0.7; b[o + 4] = j ? 1 : 0;
    }
    this.n.eenden = this.nEend;
  }

  tekenEenden(c) {
    const n = this.nEend, b = this.eendBuf, T = this.T;
    if (!n) return;
    c.globalAlpha = smooth(9, 10, this.zoom);
    // rimpeltje achter elke eend
    c.strokeStyle = 'rgba(235,245,250,0.4)'; c.lineWidth = Math.max(0.5, T * 0.0015);
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * 5, l = Math.hypot(b[o + 2], b[o + 3]) || 1, hx = b[o + 2] / l, hy = b[o + 3] / l, w = T * (b[o + 4] ? 0.006 : 0.011);
      c.moveTo(b[o] - hx * w * 2 - hy * w, b[o + 1] - hy * w * 2 + hx * w); c.lineTo(b[o] - hx * w * 0.6, b[o + 1] - hy * w * 0.6); c.lineTo(b[o] - hx * w * 2 + hy * w, b[o + 1] - hy * w * 2 - hx * w);
    }
    c.stroke();
    for (let k = 0; k < 3; k++) {
      c.fillStyle = k === 0 ? '#7a5a3a' : k === 1 ? '#d9c070' : '#2e6b45';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * 5, l = Math.hypot(b[o + 2], b[o + 3]) || 1, hx = b[o + 2] / l, hy = b[o + 3] / l, kuiken = b[o + 4] === 1;
        if (k === 0 && !kuiken) ovaal(c, b[o], b[o + 1], hx, hy, T * 0.009, T * 0.005);
        else if (k === 1 && kuiken) stip(c, b[o], b[o + 1], T * 0.0035);
        else if (k === 2 && !kuiken) stip(c, b[o] + hx * T * 0.008, b[o + 1] + hy * T * 0.008, T * 0.0032);
      }
      c.fill();
    }
    c.globalAlpha = 1;
  }

  // Vlinders boven de wei en in de tuinen, blaadjes die in de herfst met de wind meedwarrelen (vanaf zoom 10,5).
  zetVlinder(t, i, tg) {
    if (this.n.vlinders >= PLAFOND.vlinders) return;
    const Tw = this.geo.T, k = this.klok;
    const wx = tg.x + (hash(t, i, 155) - 0.5) * 0.7 * Tw + Math.sin(k * 0.6 + i * 2 + t) * 0.05 * Tw;
    const wy = tg.y + (hash(t, i, 156) - 0.5) * 0.7 * Tw + Math.sin(k * 0.83 + i * 3 + t) * 0.04 * Tw;
    if (this.zetKlein(wx, wy, 0, Math.floor(hash(t, i, 157) * VLINDER.length), hash(t, i, 158))) this.n.vlinders++;
  }

  zetBlad(t, i, tg) {
    if (this.n.bladeren >= PLAFOND.bladeren) return;
    const Tw = this.geo.T;
    const f = frac(this.klok / 7 + hash(t, i, 159));
    if (f > 0.85) return; // even op de grond, dan waait het volgende blad
    const zw = Math.sin(f * 9 + i) * 0.015 * Tw, af = f * 0.12 * Tw;
    const wx = tg.x + (hash(t, i, 160) - 0.5) * 0.8 * Tw + this.windX * af - this.windY * zw;
    const wy = tg.y + (hash(t, i, 161) - 0.5) * 0.8 * Tw + this.windY * af + this.windX * zw;
    if (this.zetKlein(wx, wy, 1, Math.floor(hash(t, i, 162) * BLAD.length), f)) this.n.bladeren++;
  }

  zetKlein(wx, wy, soort, kleur, fase) {
    const x = wx * this.sc + this.ox, y = wy * this.sc + this.oy;
    if (x < -4 || y < -4 || x > this.w + 4 || y > this.h + 4) return false;
    const o = this.nKlein++ * 4, b = this.klein;
    b[o] = x; b[o + 1] = y; b[o + 2] = soort * 8 + kleur; b[o + 3] = fase;
    return true;
  }

  tekenKlein(c, nu) {
    const n = this.nKlein, b = this.klein, T = this.T;
    c.globalAlpha = smooth(10.5, 11.5, this.zoom);
    const r = Math.max(0.7, T * 0.0035);
    for (let k = 0; k < 8 + BLAD.length; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (b[o + 2] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        if (k < 8) {
          // twee vleugeltjes die open en dicht gaan
          const slag = Math.abs(Math.sin(nu / 70 + b[o + 3] * 40)) * r * 1.1;
          stip(c, b[o] - slag, b[o + 1], r); stip(c, b[o] + slag, b[o + 1], r);
        } else {
          const a = b[o + 3] * 12, hx = Math.cos(a), hy = Math.sin(a);
          rechthoek(c, b[o], b[o + 1], hx, hy, r * 1.3, r * 0.6);
        }
      }
      if (open) { c.fillStyle = k < 8 ? VLINDER[k] : BLAD[k - 8]; c.fill(); }
    }
    c.globalAlpha = 1;
  }

  // ---------- bouwkranen ----------

  // Torenkranen op bouwplaatsen en in groeiende wijken: de giek zwaait langzaam rond en de last gaat heen en weer.
  tekenKranen(c) {
    const s = this.state, geo = this.geo, Tw = geo.T, sc = this.sc, T = this.T, b = this.kraan;
    let n = 0;
    const zet = (t, wx, wy) => {
      if (n >= PLAFOND.kranen) return;
      const x = wx * sc + this.ox, y = wy * sc + this.oy, m = T * 0.6;
      if (x < -m || y < -m || x > this.w + m || y > this.h + m) return;
      b[n * 4] = x; b[n * 4 + 1] = y; b[n * 4 + 2] = hash(t, 163) * TAU + 0.8 * Math.sin(this.klok * 0.045 + hash(t, 164) * 9); b[n * 4 + 3] = t;
      n++;
    };
    for (let i = 0; i < s.landen.length; i++) {
      const bouw = s.landen[i].bouw;
      for (let j = 0; j < bouw.length; j++) {
        const t = bouw[j].tegel;
        if (t == null || t < 0) continue;
        const tg = geo.tegels[t];
        zet(t, tg.x + 0.22 * Tw, tg.y + 0.18 * Tw);
      }
    }
    for (let r = this.r0; r <= this.r1; r++) {
      for (let k = this.k0; k <= this.k1; k++) {
        const t = r * geo.kol + k, soort = this.soort[t];
        if (soort !== WOON && soort !== HOOFD) continue;
        const land = this.tegelLand[t];
        if (land < 0 || !levenDichtheid(s, land).groeit || hash(t, 165) > (soort === HOOFD ? 0.5 : 0.35)) continue;
        const tg = geo.tegels[t];
        zet(t, tg.x + (soort === HOOFD ? 0.3 : hash(t, 166) < 0.5 ? -0.27 : 0.27) * Tw, tg.y + (soort === HOOFD ? 0.3 : hash(t, 167) < 0.5 ? -0.27 : 0.27) * Tw);
      }
    }
    this.n.kranen = n;
    if (!n) return;
    // de kraan komt geleidelijk op, net als de rest van de laag (geen plotselinge sprong bij zoom 4)
    c.globalAlpha = smooth(4, 5, this.zoom);
    const Lj = T * 0.42, Lc = T * 0.12, W = T * 0.011, sx = T * 0.18, sy = T * 0.24;
    const giek = (x, y, a, dx, dy) => {
      const hx = Math.cos(a), hy = Math.sin(a), mid = (Lj - Lc) / 2;
      rechthoek(c, x + dx + hx * mid, y + dy + hy * mid, hx, hy, (Lj + Lc) / 2, W);
    };
    // waar de last aan de haak hangt, naar lx, ly
    let lx = 0, ly = 0;
    const last = (i) => {
      const a = b[i * 4 + 2], f = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(this.klok * 0.06 + b[i * 4 + 3]));
      lx = b[i * 4] + Math.cos(a) * Lj * f; ly = b[i * 4 + 1] + Math.sin(a) * Lj * f;
    };
    // schaduwen: de mast als lange streep naar het zuidoosten, de giek hoog erboven, de last halverwege
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      giek(b[i * 4], b[i * 4 + 1], b[i * 4 + 2], sx, sy);
      last(i);
      c.rect(lx + sx * 0.5 - T * 0.012, ly + sy * 0.5 - T * 0.008, T * 0.024, T * 0.016);
    }
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.18)';
    c.lineWidth = Math.max(1, T * 0.012);
    c.beginPath();
    for (let i = 0; i < n; i++) { c.moveTo(b[i * 4], b[i * 4 + 1]); c.lineTo(b[i * 4] + sx, b[i * 4 + 1] + sy); }
    c.stroke();
    // voet van beton
    c.fillStyle = '#9a9a94';
    c.beginPath();
    for (let i = 0; i < n; i++) c.rect(b[i * 4] - T * 0.02, b[i * 4 + 1] - T * 0.02, T * 0.04, T * 0.04);
    c.fill();
    // de last aan de haak: staal of een pallet stenen
    for (let k = 0; k < 2; k++) {
      c.fillStyle = k ? '#b07a52' : '#6a7480';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        if ((b[i * 4 + 3] & 1) !== k) continue;
        last(i);
        c.rect(lx - T * 0.012, ly - T * 0.008, T * 0.024, T * 0.016);
      }
      c.fill();
    }
    // tegengewicht en giek in kraangeel, met vakwerk als je dichtbij bent
    c.fillStyle = '#e8b830';
    c.beginPath();
    for (let i = 0; i < n; i++) giek(b[i * 4], b[i * 4 + 1], b[i * 4 + 2], 0, 0);
    c.fill();
    c.fillStyle = '#7d7d76';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a = b[i * 4 + 2];
      rechthoek(c, b[i * 4] - Math.cos(a) * Lc * 0.8, b[i * 4 + 1] - Math.sin(a) * Lc * 0.8, Math.cos(a), Math.sin(a), T * 0.02, W * 1.6);
    }
    c.fill();
    if (T >= 140) {
      c.strokeStyle = 'rgba(80,60,10,0.55)';
      c.lineWidth = Math.max(0.5, T * 0.0015);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a = b[i * 4 + 2], hx = Math.cos(a), hy = Math.sin(a), x = b[i * 4], y = b[i * 4 + 1];
        const stappen = 14;
        c.moveTo(x - hy * W, y + hx * W);
        for (let j = 1; j <= stappen; j++) {
          const f = (Lj * j) / stappen, k = j & 1 ? -1 : 1;
          c.lineTo(x + hx * f - hy * W * k, y + hy * f + hx * W * k);
        }
      }
      c.stroke();
      // kabel van de loopkat naar de last
      c.fillStyle = '#333';
      c.beginPath();
      for (let i = 0; i < n; i++) { last(i); c.rect(lx - T * 0.004, ly - T * 0.004, T * 0.008, T * 0.008); }
      c.fill();
    }
    // cabine bij de mast, met glas dat het licht vangt
    c.fillStyle = '#3a4a5a';
    c.beginPath();
    for (let i = 0; i < n; i++) c.rect(b[i * 4] - T * 0.009, b[i * 4 + 1] - T * 0.009, T * 0.018, T * 0.018);
    c.fill();
    c.fillStyle = 'rgba(200,225,240,0.6)';
    c.beginPath();
    for (let i = 0; i < n; i++) c.rect(b[i * 4] - T * 0.009, b[i * 4 + 1] - T * 0.009, T * 0.009, T * 0.009);
    c.fill();
    c.globalAlpha = 1;
  }

  // ---------- lucht: ballonnen, helikopter, trekvogels, vliegtuigen ----------

  tekenLucht(c, nu) {
    const tijd = nu / 1000, z = this.zoom, sz = this.sz, T = this.T, sc = this.sc, Tw = this.geo.T, s = this.state;
    const dag = s.dag ?? 0;
    // 1. luchtballonnen op rustige, droge zomerdagen
    if (z >= 3.5 && z <= 13 && sz.zomer > 0.35 && this.wnd.kracht < 0.55 && this.nat < 0.05 && this.wr.wolken < 0.65 && this.nachtVorig < 0.3) {
      this.ballonSprites ??= BALLON.map(ballonSprite);
      const a = smooth(3.5, 4.5, z) * (1 - smooth(11, 13, z));
      const R = 1.8 * sc;
      for (let j = 0; j < PLAFOND.ballonnen; j++) {
        const wx = 150 + 700 * hash(j, dag, 171) + this.windX * (frac(tijd / 900 + hash(j, 172)) - 0.5) * 160;
        const wy = 100 + 420 * hash(j, dag, 173) + this.windY * (frac(tijd / 900 + hash(j, 172)) - 0.5) * 160 + Math.sin(tijd * 0.3 + j) * 0.3;
        if (!this.inBeeld(wx, wy, 14)) continue;
        const x = wx * sc + this.ox, y = wy * sc + this.oy;
        this.n.ballonnen++;
        c.globalAlpha = a * 0.18;
        c.fillStyle = '#000';
        c.beginPath(); c.ellipse(x + 8 * sc, y + 11 * sc, R * 0.9, R * 0.8, 0, 0, TAU); c.fill();
        c.globalAlpha = a;
        // de mand hangt net zichtbaar onder de ballon (we kijken een klein beetje schuin)
        c.fillStyle = '#6a4a2a';
        c.fillRect(x - R * 0.12, y + R * 0.9, R * 0.24, R * 0.2);
        c.drawImage(this.ballonSprites[j % BALLON.length], x - R, y - R, R * 2, R * 2);
      }
      c.globalAlpha = 1;
    }
    // 2. helikopter boven de hoofdstad: politie bij onrust, legergroen in oorlog, anders een traumaheli
    if (z >= 4.5) {
      const geo = this.geo, hb = this.heli;
      for (let i = 0; i < s.landen.length && this.n.helikopters < PLAFOND.helikopters; i++) {
        const h = geo.hoofdstad[i];
        if (h == null || h < 0) continue;
        const tg = geo.tegels[h];
        if (!this.inBeeld(tg.x, tg.y, 2 * Tw)) continue;
        const d = levenDichtheid(s, i);
        if (!(d.oorlog || d.onrust || hash(i, dag, 181) < 0.4)) continue;
        const a = (tijd * TAU) / 38 + hash(i, 182) * TAU, R = 1.1 * Tw;
        const wx = tg.x + Math.cos(a) * R, wy = tg.y + Math.sin(a) * R * 0.8;
        const x = wx * sc + this.ox, y = wy * sc + this.oy;
        if (x < -T || y < -T || x > this.w + T || y > this.h + T) continue;
        let hx = -Math.sin(a), hy = Math.cos(a) * 0.8;
        const l = Math.hypot(hx, hy); hx /= l; hy /= l;
        const o = this.n.helikopters++ * 2;
        hb[o] = x; hb[o + 1] = y;
        this.tekenHeli(c, x, y, hx, hy, d.oorlog ? 0 : d.onrust ? 1 : 2, nu, smooth(4.5, 5.5, z));
      }
    }
    // 3. trekvogels in V-formatie: in de herfst naar het zuidwesten, in het voorjaar terug
    if (z >= 3 && z <= 10 && (sz.herfst > 0.35 || sz.lente > 0.55) && this.nachtVorig < 0.5) {
      const herfst = sz.herfst > 0.35, dx = herfst ? -0.8 : 0.8, dy = herfst ? 0.6 : -0.6;
      const b = this.trekBuf;
      let n = 0;
      for (let f = 0; f < 2; f++) {
        const u = frac(tijd / 140 + hash(f, 183));
        const cyc = Math.floor(tijd / 140 + hash(f, 183));
        const sx = 500 + (hash(f, cyc, 184) - 0.5) * 600 - dx * 520, sy = 310 + (hash(f, cyc, 185) - 0.5) * 300 - dy * 520;
        const lx = sx + dx * u * 1040, ly = sy + dy * u * 1040;
        if (!this.inBeeld(lx, ly, 30)) continue;
        const leden = 13 + Math.floor(hash(f, cyc, 186) * 5);
        for (let j = 0; j < leden && n < PLAFOND.trekvogels; j++) {
          const rij = (j + 1) >> 1, kant = j & 1 ? 1 : -1;
          const terug = rij * 2.2 + Math.sin(tijd * 0.8 + j) * 0.25, opzij = j ? kant * rij * 1.7 : 0;
          const wx = lx - dx * terug - dy * opzij, wy = ly - dy * terug + dx * opzij;
          b[n * 5] = wx * sc + this.ox; b[n * 5 + 1] = wy * sc + this.oy; b[n * 5 + 2] = dx; b[n * 5 + 3] = dy; b[n * 5 + 4] = 0.55 + 0.45 * Math.sin(nu / 230 + j * 0.7);
          n++;
        }
      }
      this.n.trekvogels = n;
      if (n) {
        const a = smooth(3, 4, z) * (1 - smooth(8.5, 10, z)), span = Math.max(2.5, 0.75 * sc);
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.lineWidth = Math.max(1, span * 0.16);
        for (let k = 0; k < 2; k++) {
          c.globalAlpha = k ? a : a * 0.13;
          c.strokeStyle = k ? 'rgba(52,48,44,0.9)' : '#000';
          const ox = k ? 0 : 6 * sc, oy = k ? 0 : 8 * sc;
          c.beginPath();
          for (let i = 0; i < n; i++) vlucht(c, b[i * 5] + ox, b[i * 5 + 1] + oy, b[i * 5 + 2], b[i * 5 + 3], span, b[i * 5 + 4]);
          c.stroke();
        }
        c.globalAlpha = 1;
      }
    }
    // 4. vliegtuigen hoog in de lucht met condensstrepen en een schaduw ver op de grond
    if (z <= 11) {
      const a = smooth(2.5, 3.2, z) * (1 - smooth(9, 11, z));
      const L = 0.24 * Tw * sc, vb = this.vlieg;
      for (let j = 0; j < PLAFOND.vliegtuigen; j++) {
        const P = 55 + 13 * j, ruw = tijd / P + hash(j, 191), u = frac(ruw), cyc = Math.floor(ruw);
        const hoek = hash(j, cyc, 194) * TAU, hx = Math.cos(hoek), hy = Math.sin(hoek);
        const wx = 150 + 700 * hash(j, cyc, 192) + hx * (u * 1600 - 800), wy = 100 + 420 * hash(j, cyc, 193) + hy * (u * 1600 - 800);
        if (!this.inBeeld(wx - hx * 60, wy - hy * 60, 90)) continue;
        const x = wx * sc + this.ox, y = wy * sc + this.oy;
        const o = this.n.vliegtuigen++ * 4;
        vb[o] = x; vb[o + 1] = y; vb[o + 2] = hx; vb[o + 3] = hy;
        // condensstreep: twee lijnen die achter het toestel samenvloeien, verwaaien en vervagen
        c.lineCap = 'round';
        for (let seg = 0; seg < 4; seg++) {
          c.globalAlpha = a * (0.42 - seg * 0.1);
          c.strokeStyle = '#f6f8fa';
          c.lineWidth = Math.max(0.8, (0.35 + seg * 0.35) * sc);
          const d0 = (0.4 + seg * 22) * sc, d1 = (0.4 + (seg + 1) * 22) * sc, drift0 = seg * 1.4 * sc, drift1 = (seg + 1) * 1.4 * sc;
          c.beginPath();
          // twee strepen (k = -1 en 1) die verderop samenvloeien tot één (k = 0)
          for (let k = seg < 2 ? -1 : 0, eind = seg < 2 ? 1 : 0; k <= eind; k += 2) {
            const zx = -hy * k * L * 0.18, zy = hx * k * L * 0.18;
            c.moveTo(x - hx * d0 + zx + this.windX * drift0, y - hy * d0 + zy + this.windY * drift0);
            c.lineTo(x - hx * d1 + zx * (seg < 1 ? 1 : 0.4) + this.windX * drift1, y - hy * d1 + zy * (seg < 1 ? 1 : 0.4) + this.windY * drift1);
          }
          c.stroke();
        }
        c.globalAlpha = a * 0.16;
        c.fillStyle = '#000';
        c.beginPath(); vliegtuig(c, x + 14 * sc, y + 19 * sc, hx, hy, L); c.fill();
        c.globalAlpha = a;
        c.fillStyle = '#f2f4f7';
        c.beginPath(); vliegtuig(c, x, y, hx, hy, L); c.fill();
        // de zuidoostkant van de romp in de schaduw
        c.fillStyle = 'rgba(0,0,0,0.12)';
        c.beginPath(); rechthoek(c, x + hy * L * 0.02, y - hx * L * 0.02 + L * 0.015, hx, hy, L * 0.45, L * 0.025); c.fill();
      }
      c.globalAlpha = 1;
    }
  }

  // Helikopter van bovenaf: romp, staartboom, draaiende rotor met een vage schijf, en een schaduw eronder.
  tekenHeli(c, x, y, hx, hy, soort, nu, a) {
    const T = this.T;
    const vorm = (dx, dy) => {
      ovaal(c, x + dx, y + dy, hx, hy, T * 0.03, T * 0.014);
      rechthoek(c, x + dx - hx * T * 0.045, y + dy - hy * T * 0.045, hx, hy, T * 0.022, T * 0.003);
      rechthoek(c, x + dx - hx * T * 0.066, y + dy - hy * T * 0.066, hx, hy, T * 0.003, T * 0.01);
    };
    c.globalAlpha = a * 0.2;
    c.fillStyle = '#000';
    c.beginPath(); vorm(T * 0.14, T * 0.18); stip(c, x + T * 0.14, y + T * 0.18, T * 0.05); c.fill();
    c.globalAlpha = a;
    c.fillStyle = soort === 0 ? '#5d6b4a' : soort === 1 ? '#2d4f8a' : '#c8322b';
    c.beginPath(); vorm(0, 0); c.fill();
    c.fillStyle = soort === 1 ? '#f2f4f6' : 'rgba(255,255,255,0.25)';
    c.beginPath(); stip(c, x - T * 0.006, y - T * 0.006, T * 0.008); c.fill();
    c.fillStyle = 'rgba(170,205,230,0.85)';
    c.beginPath(); stip(c, x + hx * T * 0.02, y + hy * T * 0.02, T * 0.007); c.fill();
    c.fillStyle = 'rgba(30,30,30,0.12)';
    c.beginPath(); stip(c, x, y, T * 0.05); c.fill();
    const r = nu / 35;
    c.strokeStyle = 'rgba(25,25,25,0.6)';
    c.lineWidth = Math.max(0.6, T * 0.003);
    c.beginPath();
    for (let k = 0; k < 2; k++) {
      const bx = Math.cos(r + k * Math.PI / 2) * T * 0.05, by = Math.sin(r + k * Math.PI / 2) * T * 0.05;
      c.moveTo(x - bx, y - by); c.lineTo(x + bx, y + by);
    }
    c.stroke();
    c.globalAlpha = 1;
  }

  // Vuurwerk boven de hoofdstad: pijlen die opstijgen en uiteenspatten in een ring van vonken die uitzakt.
  tekenVuurwerk(c, view, sc, nu, nacht) {
    const s = this.state, geo = this.geo, Tw = geo.T, T = this.T, tijd = nu / 1000;
    let n = 0;
    for (let i = 0; i < s.landen.length && n < PLAFOND.vuurwerk; i++) {
      const h = geo.hoofdstad[i];
      if (h == null || h < 0) continue;
      const tg = geo.tegels[h];
      if (!this.inBeeld(tg.x, tg.y, 3 * Tw) || !levenDichtheid(s, i).feest) continue;
      if (!this.vuurSprites) this.vuurSprites = VUURWERK.map(([r, g, b]) => gloedSprite(r, g, b));
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let j = 0; j < 6 && n < PLAFOND.vuurwerk; j++) {
        const P = 2.6 + 0.37 * j, ruw = tijd / P + hash(h, j, 201), u = frac(ruw), cyc = Math.floor(ruw);
        if (u > 0.8) continue;
        const uu = u / 0.8;
        const bx = tg.x + (hash(h, cyc * 7 + j, 202) - 0.5) * 1.6 * Tw, by = tg.y - (0.3 + 0.5 * hash(h, cyc * 7 + j, 203)) * Tw;
        const sprite = this.vuurSprites[Math.floor(hash(h, cyc * 7 + j, 204) * VUURWERK.length)];
        n++;
        if (uu < 0.25) {
          // de pijl stijgt op vanaf het plein
          const f = uu / 0.25, x = (bx + (tg.x - bx) * (1 - f) * 0.3) * sc + this.ox, y = (tg.y + (by - tg.y) * f) * sc + this.oy;
          c.globalAlpha = 0.9;
          const r = Math.max(2, T * 0.025);
          c.drawImage(this.vuurSprites[1], x - r, y - r, r * 2, r * 2);
          continue;
        }
        const e = (uu - 0.25) / 0.75, R = Tw * 0.45 * (1 - (1 - e) * (1 - e) * (1 - e));
        c.globalAlpha = Math.pow(1 - e, 1.5) * (0.35 + 0.65 * nacht);
        const r = Math.max(2, T * 0.03 * (1 - e * 0.5));
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * TAU + hash(h, cyc, j) * TAU;
          const x = (bx + Math.cos(a) * R) * sc + this.ox, y = (by + Math.sin(a) * R * 0.9 + e * e * 0.25 * Tw) * sc + this.oy;
          c.drawImage(sprite, x - r, y - r, r * 2, r * 2);
        }
        if (e < 0.15) {
          const r2 = T * 0.12 * (1 - e / 0.15);
          c.drawImage(sprite, bx * sc + this.ox - r2, by * sc + this.oy - r2, r2 * 2, r2 * 2);
        }
      }
      c.restore();
    }
    this.n.vuurwerk = n;
    void view;
  }

  // ---------- lichten (na de nachtlaag) ----------

  // Straatlantaarns, koplampen en achterlichten, en een toplicht op elke boot. Gebruikt de auto's en boten
  // die teken() deze frame al heeft verzameld.
  tekenLichten(c, view, sc, nu) {
    this.nLicht = 0;
    const nacht = view.nacht ?? 0;
    // vuurwerk ook overdag (dan minder fel); het komt na de nachtlaag zodat het 's nachts echt straalt
    if (this.state && this.geo && view.zoom >= 2) this.tekenVuurwerk(c, view, sc, nu, nacht);
    if (nacht < 0.05 || !this.state || !view.lichtSprite) return;
    const geo = this.geo, T = this.T, sprite = view.lichtSprite, MAX = PLAFOND.lichten;
    let n = 0;
    c.save();
    c.globalCompositeOperation = 'lighter';
    // straatlantaarns om de 0.25 tegel langs het straatcontract, om en om aan beide kanten
    if (view.zoom >= 4) {
      c.globalAlpha = nacht * 0.7 * smooth(4, 5, view.zoom);
      const r = Math.max(2, T * 0.05);
      for (let rr = this.r0; rr <= this.r1 && n < MAX; rr++) {
        for (let k = this.k0; k <= this.k1 && n < MAX; k++) {
          const t = rr * geo.kol + k;
          const soort = this.soort[t];
          if (soort !== HOOFD && soort !== WOON) continue;
          const tg = geo.tegels[t];
          const x = tg.x * sc + this.ox, y = tg.y * sc + this.oy;
          for (let a = 0; a < 2; a++) {
            for (let j = 0; j < 4 && n < MAX; j++) {
              const langs = (-0.375 + j * 0.25) * T;
              if (soort === HOOFD && Math.abs(langs) < 0.2 * T) continue;
              const dwars = (j & 1 ? 1 : -1) * STOEP * T;
              const lx = a ? x + dwars : x + langs, ly = a ? y + langs : y + dwars;
              if (lx < -r || ly < -r || lx > this.w + r || ly > this.h + r) continue;
              c.drawImage(sprite, lx - r, ly - r, r * 2, r * 2);
              n++;
            }
          }
        }
      }
    }
    // koplampen (warm wit) vooraan, achterlichten (rood) achteraan
    const nA = this.nAuto, b = this.auto;
    if (nA && n < MAX) {
      const autoA = smooth(3.5, 4.5, view.zoom);
      c.globalAlpha = nacht * autoA;
      const r = Math.max(1.5, T * 0.028);
      for (let i = 0; i < nA && n + 2 <= MAX; i++) {
        const o = i * AUTO, hx = b[o + 2], hy = b[o + 3];
        const l = T * MAAT[b[o + 5]][0], w = T * 0.018;
        const fx = b[o] + hx * l, fy = b[o + 1] + hy * l;
        c.drawImage(sprite, fx - hy * w - r, fy + hx * w - r, r * 2, r * 2);
        c.drawImage(sprite, fx + hy * w - r, fy - hx * w - r, r * 2, r * 2);
        n += 2;
      }
      // lichtbundels voor de auto's uit, alleen dichtbij
      if (T >= 120) {
        c.globalAlpha = nacht * autoA * 0.12;
        c.fillStyle = '#ffe2a8';
        c.beginPath();
        for (let i = 0; i < nA; i++) {
          const o = i * AUTO, hx = b[o + 2], hy = b[o + 3];
          const l = T * MAAT[b[o + 5]][0];
          const fx = b[o] + hx * l, fy = b[o + 1] + hy * l;
          c.moveTo(fx - hy * T * 0.02, fy + hx * T * 0.02);
          c.lineTo(fx + hx * T * 0.16 - hy * T * 0.05, fy + hy * T * 0.16 + hx * T * 0.05);
          c.lineTo(fx + hx * T * 0.16 + hy * T * 0.05, fy + hy * T * 0.16 - hx * T * 0.05);
          c.lineTo(fx + hy * T * 0.02, fy - hx * T * 0.02);
          c.closePath();
        }
        c.fill();
      }
      this.roodSprite ??= gloedSprite(255, 40, 30);
      c.globalAlpha = nacht * autoA * 0.9;
      const rr = Math.max(1.2, T * 0.018);
      for (let i = 0; i < nA && n < MAX; i++) {
        const o = i * AUTO, hx = b[o + 2], hy = b[o + 3];
        const l = T * MAAT[b[o + 5]][0], q = b[o + 6] > 0 ? rr * 1.7 : rr; // remlicht: groter en feller
        c.drawImage(this.roodSprite, b[o] - hx * l - q, b[o + 1] - hy * l - q, q * 2, q * 2);
        n++;
      }
      // natte weg: elke lamp spiegelt als een lange streep naar beneden in het asfalt
      if (this.wr.regen > 0.2 && T >= 120) {
        c.globalAlpha = nacht * autoA * 0.35 * smooth(0.2, 0.5, this.wr.regen);
        const r = Math.max(2, T * 0.03);
        for (let i = 0; i < nA && n + 2 <= MAX; i++) {
          const o = i * AUTO, hx = b[o + 2], hy = b[o + 3], l = T * MAAT[b[o + 5]][0];
          c.drawImage(sprite, b[o] + hx * l - r * 0.2, b[o + 1] + hy * l, r * 0.4, r * 2.4);
          c.drawImage(this.roodSprite, b[o] - hx * l - r * 0.15, b[o + 1] - hy * l, r * 0.3, r * 1.8);
          n += 2;
        }
      }
      // knipperlichten en de oranje zwaailichten van de werkwagens
      this.amberSprite ??= gloedSprite(255, 170, 40);
      c.globalAlpha = nacht * autoA;
      const ra = Math.max(1.5, T * 0.022);
      for (let i = 0; i < nA && n < MAX; i++) {
        const o = i * AUTO, s = b[o + 5], k = b[o + 7], hx = b[o + 2], hy = b[o + 3];
        if (k && Math.floor(nu / 380 + b[o + 8] * 3) & 1) {
          const l = T * MAAT[s][0], w = T * MAAT[s][1] * k;
          c.drawImage(this.amberSprite, b[o] + hx * l - hy * w - ra, b[o + 1] + hy * l + hx * w - ra, ra * 2, ra * 2);
          n++;
        } else if (s >= VUIL && Math.floor(nu / 260 + b[o + 8] * 4) & 1) {
          c.drawImage(this.amberSprite, b[o] - ra * 2, b[o + 1] - ra * 2, ra * 4, ra * 4);
          n++;
        }
      }
    }
    // toplicht op elke boot
    const nB = this.nBoot, bb = this.boot;
    if (nB && n < MAX) {
      c.globalAlpha = nacht;
      const r = Math.max(1.5, T * 0.025);
      for (let i = 0; i < nB && n < MAX; i++) {
        c.drawImage(sprite, bb[i * BOOT] - r, bb[i * BOOT + 1] - r, r * 2, r * 2);
        n++;
      }
    }
    // zwaailichten van politie en ambulance: een blauwe gloed die meeknippert
    if (this.zwaai && nA && n < MAX) {
      this.blauwSprite ??= gloedSprite(70, 130, 255);
      c.globalAlpha = nacht * smooth(3.5, 4.5, view.zoom);
      const r = Math.max(3, T * 0.07);
      for (let i = 0; i < nA && n < MAX; i++) {
        const o = i * AUTO;
        if ((b[o + 5] !== 5 && b[o + 5] !== 6) || !((Math.floor(nu / 200) + i) & 1)) continue;
        c.drawImage(this.blauwSprite, b[o] - r, b[o + 1] - r, r * 2, r * 2);
        n++;
      }
    }
    // rood waarschuwingslicht op de punt van elke kraan, rustig knipperend
    const nK = this.n.kranen;
    if (nK && n < MAX && Math.floor(nu / 700) % 2 === 0) {
      this.roodSprite ??= gloedSprite(255, 40, 30);
      c.globalAlpha = nacht * smooth(4, 5, view.zoom);
      const r = Math.max(2, T * 0.03), Lj = T * 0.42;
      for (let i = 0; i < nK && n < MAX; i++) {
        const a = this.kraan[i * 4 + 2];
        c.drawImage(this.roodSprite, this.kraan[i * 4] + Math.cos(a) * Lj - r, this.kraan[i * 4 + 1] + Math.sin(a) * Lj - r, r * 2, r * 2);
        n++;
      }
    }
    // vliegtuigen: rood links, groen rechts en een witte flits; de helikopter een rood zwaailicht
    const nV = this.n.vliegtuigen;
    if (nV && n < MAX) {
      this.roodSprite ??= gloedSprite(255, 40, 30);
      this.groenSprite ??= gloedSprite(60, 255, 120);
      // dezelfde vervaging als het toestel zelf, zodat de lampjes niet zonder vliegtuig in de lucht hangen
      c.globalAlpha = nacht * smooth(2.5, 3.2, view.zoom) * (1 - smooth(9, 11, view.zoom));
      const L = 0.24 * geo.T * sc, r = Math.max(2, L * 0.12);
      for (let i = 0; i < nV && n + 3 <= MAX; i++) {
        const o = i * 4, x = this.vlieg[o], y = this.vlieg[o + 1], hx = this.vlieg[o + 2], hy = this.vlieg[o + 3];
        const lx = x - hx * L * 0.18 + hy * L * 0.5, ly = y - hy * L * 0.18 - hx * L * 0.5;
        const rx = x - hx * L * 0.18 - hy * L * 0.5, ry = y - hy * L * 0.18 + hx * L * 0.5;
        c.drawImage(this.roodSprite, lx - r, ly - r, r * 2, r * 2);
        c.drawImage(this.groenSprite, rx - r, ry - r, r * 2, r * 2);
        n += 2;
        if (frac(nu / 1300 + i * 0.3) < 0.08) { c.drawImage(sprite, x - r * 1.5, y - r * 1.5, r * 3, r * 3); n++; }
      }
    }
    for (let i = 0; i < this.n.helikopters && n < MAX; i++) {
      if (Math.floor(nu / 500 + i) % 2) continue;
      this.roodSprite ??= gloedSprite(255, 40, 30);
      c.globalAlpha = nacht * smooth(4.5, 5.5, view.zoom); // vervaagt mee met de helikopter
      const r = Math.max(2, T * 0.03);
      c.drawImage(this.roodSprite, this.heli[i * 2] - r, this.heli[i * 2 + 1] - r, r * 2, r * 2);
      n++;
    }
    c.restore();
    this.nLicht = n;
  }

  // Wat er deze frame getekend is (voor de test en om te meten).
  telling() {
    const t = { autos: this.nAuto, mensen: this.nMens, boten: this.nBoot, vogels: this.nVogel, rook: this.nGevecht ?? 0, stoom: this.nStoom, lichten: this.nLicht };
    for (const k of PLUS) t[k] = this.n[k];
    t.haltes = this.nHalte;
    t.wachtend = this.nWacht;
    t.praters = this.nPraat ?? 0;
    return t;
  }
}
