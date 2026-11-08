// De straat (pakket A van de detailronde): de openbare ruimte tussen de gebouwen van steden en hoofdsteden.
// - Vrije vakjes in de stad worden een plein (bestrating in een patroon, fontein, een abstract monument of obelisk,
//   kiosk, bloembakken, bomen in boomspiegels, terrasjes in lente en zomer, in december een lichtjesmarkt met
//   kraampjes) of een stadspark (gazon, grindpaden, vijver met fonteintje en eenden, muziektent, perk, een laag
//   muurtje met soms een kat erop). Ligt er een weg of water door een vakje, dan krijgt elk vrij kwart iets kleins:
//   een buurtpleintje, een groen hoekje of een parkeerplaats.
// - Langs de wegen in de stad: geparkeerde auto's in vakken op de berm, bankjes, brievenbussen, fietsen tegen een
//   lantaarnpaal, paaltjes en voetgangerslichten bij de zebra's (in de maat met de verkeerslichten van infra.js),
//   plassen na regen.
// - De stoep (pakket B): een stoepstrook langs de stadswegen, voorbij het fietspad, en stoeptegels tegen de gevels
//   aan de stadsrand. Daarop straatbomen in boomspiegels, lantaarns, bankjes (overdag met iemand erop),
//   afvalbakken, fietsenrekken, paaltjes, brandkranen, bloembakken, deelfietsen en -steps, een abstract kunstwerk op
//   een hoek, reclamezuilen zonder tekst en laadpalen bij geparkeerde auto's. En verhaaltjes: een straatmuzikant
//   met publiek, kinderen die stoepkrijten, een bloemenstal, een ijscofiets, 's avonds een snackkar, duiven die
//   opvliegen voor een voorbijganger, een verhuizing, de postbode op de fiets en wachtenden bij de haltes van
//   infra.js (een deel ook nachtbushalte). In de vakjes: glazenwasser bij de kiosk, een hond die blaft naar een kat
//   in de boom, een zandkasteel en de wip op een speelplekje; pocketparkjes aan de stadsrand.
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
import { maakBasis, TerreinLaag, kenmerkenVoorTegel } from './terrein.js';

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
export const PLAFOND = { vakjes: 60, bouwplaatsen: 12, autos: 180, bankjes: 50, brievenbussen: 24, paaltjes: 80, voetlichten: 40, fietsen: 40, plassen: 60, fonteinen: 16, eenden: 18, mensen: 160, ijscokarren: 4, kraampjes: 40, katten: 6, mixers: 8, lichten: 300, bakken: 2, stoep: 240, randen: 48, verhalen: 24, duiven: 60, honden: 6 };
// Vanaf welke zoom iets verschijnt (4-6 grof, 8-10 middel, 12-14 klein).
export const DREMPEL = { grond: 4.5, bouwhek: 6, etalage: 6, rand: 6, auto: 7, fontein: 7.5, stoep: 8.5, mensen: 8.5, bank: 9, ijsco: 9, zitten: 10, voetlicht: 10.5, brievenbus: 10.5, paaltje: 10.5, stoepKlein: 10.5, duif: 11, klein: 12, verhaal: 12 };
const TREDE1 = 8, TREDE2 = 12; // detail in de gebakken vakjes: 0 grof, 1 middel (vanaf zoom 8), 2 fijn (vanaf 12)
const VAK_BAK = 1.2; // gebakken vakje: een tiende tegel marge rondom, zodat boomkruinen, schaduwen en de obelisk niet afgeknipt worden
const MAX_SPRITES = 64, MAX_BYTES = 40 * 1024 * 1024, MAX_P = 640;
const MAX_VAKJES = 600, MAX_BOUW = 60, MAX_AUTOS = 3000, MAX_MEUBEL = 900, MAX_PLAS = 900, MAX_FIETS = 500, MAX_PAAL = 600, MAX_VOET = 400, MAX_ETALAGE = 400, MAX_STOEP = 4000, MAX_RAND = 900;

const W = 1000, H = 620; // wereld in eenheden
const RC = 2, RW = W / RC, RH = H / RC; // botsraster: vakjes van 2 eenheden (zelfde maat als kust.js)
const INFRA = 1, GEBOUW = 4, BOUWP = 8, WATER = 16; // bits in het raster (WATER alleen als masker: komt uit natCel)
const KUST_BIT = 4; // wat kust.js in zijn raster als eigen bouwsel merkt

const LEEG = 0, HOOFD = 1, STAD = 2, OVERIG = 3, BOUW = 4;
const ALIAS = { olieveld: 'centrale', staalfabriek: 'industrie', landbouw: 'boerderij', zware_industrie: 'industrie', ruimtevaartcentrum: 'chipfabriek', spoor: 'opslag' };
const PLEIN = 1, PARK = 2, DEEL = 3; // soorten vakje
const Q_PLEIN = 1, Q_GROEN = 2, Q_PARKEER = 3, Q_SPEEL = 4; // soorten kwart
const KWART = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]; // NW, NO, ZW, ZO

// lichtsoorten (zelfde nummering als kust.js)
const WARM = 0, ROOD = 1, GROEN = 2, KOEL = 3, WIT = 4, AMBER = 5, ROZE = 6, BLAUW = 7;
const LICHTKLEUR = [[255, 200, 120], [255, 50, 40], [70, 255, 120], [235, 242, 255], [255, 250, 230], [255, 170, 40], [255, 90, 200], [80, 140, 255]];
const NEON = [ROOD, GROEN, KOEL, ROZE, BLAUW, AMBER]; // lichtreclame zonder tekst: alleen kleur
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
// speelplekje: zandbak, wip, glijbaantje, bankje voor de ouders, een boom en een lantaarn
const QS = { zand: [-0.17, 0.0, -0.01, 0.16], wip: [0.1, 0.08], glij: [0.12, -0.1], bank: [-0.13, -0.17], boom: [0.18, 0.18, 0.042], lamp: [-0.02, -0.2] };
const QP_KRIJT = [-0.12, -0.03]; // waar kinderen op het buurtpleintje stoepkrijten
// plein: straatmuzikant, de glazenwasser bij de kiosk en duiven op het open stuk ten oosten van het monument
const PL_MUZIEK = [-0.15, -0.22], PL_DUIF = [0.13, -0.2];
// Afstand van de vakken op de berm tot het midden van de weg (tegels): voorbij het looppad van leven.js (0,075) en
// vóór het fietspad van infra.js (vanaf 0,118), zodat voetgangers niet door de auto's lopen.
const BERM = 0.099;

// ---------- de stoep: straatmeubilair en verhaaltjes ----------

// Stoepstrook langs de stadswegen (tegels vanaf het wegmidden): voorbij het fietspad van infra.js (tot 0,142) en
// vóór zijn laanbomen (0,2); de voet van alles blijft tussen 0,152 en 0,192.
const STROOK = 0.172;
// Stoep langs de rand van een bebouwd vakje: een strook van 0,11 tegel op het vrije buurvakje, tegen de gevel aan.
const RAND_W = 0.11;
const ST = 8; // stoeplijst: x, y, langs x, langs y, achter x, achter y (van de looproute af), soort, zaad
const RS = 6; // randen: x0, y0, x1, y1, zijde, vakje
// soorten op de stoep; de verhaaltjes (V_) hebben mensen of dieren die bewegen
const S_BOOM = 0, S_BANK = 1, S_AFVAL = 2, S_REK = 3, S_PAAL = 4, S_KRAAN = 5, S_BAK = 6, S_DEEL = 7, S_KUNST = 8, S_ZUIL = 9, S_LAMP = 10, S_LAAD = 11;
const V_MUZIEK = 12, V_KRIJT = 13, V_BLOEM = 14, V_IJS = 15, V_SNACK = 16, V_DUIF = 17, V_VERHUIS = 18, V_POST = 19, V_HALTE = 20;
export const STOEP_NAAM = ['straatboom', 'bankje', 'afvalbak', 'fietsenrek', 'paaltjes', 'brandkraan', 'bloembak', 'deelfietsen', 'kunstwerk', 'reclamezuil', 'lantaarn', 'laadpaal', 'straatmuzikant', 'stoepkrijt', 'bloemenstal', 'ijscofiets', 'snackkar', 'duiven', 'verhuizing', 'postbode', 'bushalte'];
// klein spul komt pas later op (DREMPEL.stoepKlein), het andere meubilair met DREMPEL.stoep; bomen al met de stoeprand mee
const KLEIN = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1];
// Wat op de stoep komt uit één hash: veel bankjes, rekken en bakken, geregeld een verhaaltje. Een kunstwerk alleen
// op een hoek (bij de stadsingang of op de hoek van een gevel).
function kiesStoep(h, hoek) {
  if (hoek && h >= 0.5 && h < 0.7) return S_KUNST;
  if (h < 0.14) return S_BANK; if (h < 0.22) return S_AFVAL; if (h < 0.31) return S_REK; if (h < 0.39) return S_BAK;
  if (h < 0.44) return S_PAAL; if (h < 0.48) return S_KRAAN; if (h < 0.54) return S_DEEL; if (h < 0.58) return S_ZUIL;
  if (h < 0.62) return hoek ? S_KUNST : S_BANK;
  if (h < 0.66) return V_MUZIEK; if (h < 0.7) return V_KRIJT; if (h < 0.75) return V_BLOEM; if (h < 0.79) return V_IJS;
  if (h < 0.83) return V_SNACK; if (h < 0.88) return V_DUIF; if (h < 0.93) return V_VERHUIS; return -1;
}
// Kenmerken van terrein.js waar niets bovenop mag (zelfde nummering als daar): bomen, rotsen, riet, plassen,
// erven, stenen, helm en omgevallen stammen. Akkers (PERCEEL 6) houden het hele vakje vrij.
const HINDER = new Uint8Array(19); for (const k of [1, 2, 3, 9, 10, 11, 12, 13, 17]) HINDER[k] = 1;
const K_PERCEEL = 6, K_BOERDERIJ = 11, K_STAM = 17;
const DEELKLEUR = ['#2a9d8f', '#e07a2f']; // deelfietsen en -steps: een vlootkleur, geen merk
const ZUIL = ['#c8432f', '#2f6d9a', '#d9a63a', '#3d7a4f', '#8a4a7a', '#e8e2d0'];
const KRIJT = ['#f2a7c3', '#9ad0f0', '#f6e08a', '#a8e0a0', '#f4f2ea'];
const HOND = ['#8a5a36', '#2a2622', '#d9c3a0', '#6b6560'];

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
  } else if (soort === Q_SPEEL) {
    // speelplekje: gras met een zandbak, een wip en een glijbaantje; de kinderen komen per beeld
    gazon(g, qx - m, qy - m, qx + m, qy + m, b);
    const [z0, z1, z2, z3] = QS.zand, S = SCHUIN;
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(qx + z0 + 0.006, qy + z1 + 0.008, z2 - z0, z3 - z1);
    vlak(g, qx + z0, qy + z1, qx + z2, qy + z3, HOUT);
    vlak(g, qx + z0 + 0.008, qy + z1 + 0.008, qx + z2 - 0.008, qy + z3 - 0.008, b.sn ? '#eef1f3' : '#e2cf9a');
    if (b.trede >= 1 && !b.sn) { g.fillStyle = 'rgba(150,120,70,0.25)'; g.beginPath(); const r = rnd(zaad + 9); for (let i = 0; i < 9; i++) stip(g, qx + z0 + 0.015 + r() * (z2 - z0 - 0.03), qy + z1 + 0.015 + r() * (z3 - z1 - 0.03), 0.004 + r() * 0.004); g.fill(); }
    if (b.trede >= 1) { g.fillStyle = 'rgba(255,240,200,0.3)'; g.fillRect(qx + z0, qy + z1, z2 - z0, 0.003); }
    // wip: voet en plank (de kinderen erop wippen per beeld)
    const [wx, wy] = QS.wip;
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); rechthoek(g, qx + wx + 0.008, qy + wy + 0.01, 1, 0, 0.07, 0.008); g.fill();
    vlak(g, qx + wx - 0.008, qy + wy - 0.014, qx + wx + 0.008, qy + wy + 0.004, '#5a5d60');
    g.fillStyle = '#d9a63a'; g.beginPath(); rechthoek(g, qx + wx, qy + wy - 0.012, 1, 0, 0.07, 0.006); g.fill();
    g.fillStyle = '#c8432f'; for (const s of [-1, 1]) g.fillRect(qx + wx + s * 0.058 - 0.003, qy + wy - 0.024, 0.006, 0.01);
    // glijbaantje: trapje in het noorden, glijvlak naar het zuiden, schaduw naar het zuidoosten
    const [gx, gy] = QS.glij, gh = 0.05;
    g.fillStyle = 'rgba(0,0,0,0.24)'; g.beginPath(); g.moveTo(gx - 0.012, gy - 0.05); g.lineTo(gx + 0.012, gy - 0.05); g.lineTo(gx + 0.012 + gh * S, gy - 0.05 + gh * S); g.lineTo(gx + 0.016, gy + 0.06); g.lineTo(gx - 0.008, gy + 0.06); g.closePath(); g.fill();
    g.strokeStyle = '#8a8d90'; g.lineWidth = 0.004; g.beginPath(); for (const s of [-1, 1]) { g.moveTo(gx + s * 0.011, gy - 0.05); g.lineTo(gx + s * 0.011, gy - 0.05 - gh); } g.stroke();
    if (b.trede >= 1) { g.lineWidth = 0.0025; g.beginPath(); for (let k = 1; k < 5; k++) { g.moveTo(gx - 0.011, gy - 0.05 - (k * gh) / 5); g.lineTo(gx + 0.011, gy - 0.05 - (k * gh) / 5); } g.stroke(); }
    g.fillStyle = b.sn ? '#eef1f3' : '#d9a63a'; g.beginPath(); g.moveTo(gx - 0.012, gy - 0.05 - gh); g.lineTo(gx + 0.012, gy - 0.05 - gh); g.lineTo(gx + 0.012, gy + 0.055); g.lineTo(gx - 0.012, gy + 0.055); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,230,0.3)'; g.fillRect(gx - 0.012, gy - 0.05 - gh, 0.007, gh + 0.1);
    vlak(g, gx - 0.014, gy - 0.05 - gh - 0.006, gx + 0.014, gy - 0.05 - gh, '#c8432f');
    bankje(g, qx + QS.bank[0], qy + QS.bank[1], 1, 0);
    lantaarn(g, qx + QS.lamp[0], qy + QS.lamp[1]);
    boom(g, qx + QS.boom[0], qy + QS.boom[1], QS.boom[2], b, hash(zaad, 12));
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
    this.fig = new Float32Array(PLAFOND.mensen * 5); // figuren: x, y, kleding, huid, maat (scherm)
    this.zs = new Int32Array(PLAFOND.stoep); // zichtbare stoepdingen
    this.zr = new Int32Array(PLAFOND.randen); // zichtbare stoepstroken
    this.zbank = new Int32Array(PLAFOND.bankjes); this.zbus = new Int32Array(PLAFOND.brievenbussen); this.zpaal = new Int32Array(PLAFOND.paaltjes);
    this.gloed = null;
    this.leeg();
    this.nul();
  }

  leeg() {
    this.vakjes = []; this.bouwplaatsen = [];
    this.autos = new Float32Array(0); this.meubels = new Float32Array(0); this.plasplekken = new Float32Array(0); this.fietsen = new Float32Array(0);
    this.paaltjes = new Float32Array(0); this.voetlichten = new Float32Array(0); this.etalages = new Float32Array(0);
    this.stoep = new Float32Array(0); this.randen = new Float32Array(0);
    this.plekLijst = [];
  }

  nul() {
    this.n = { vakjes: 0, bouwplaatsen: 0, autos: 0, bankjes: 0, brievenbussen: 0, paaltjes: 0, voetlichten: 0, fietsen: 0, plassen: 0, fonteinen: 0, eenden: 0, mensen: 0, ijscokarren: 0, kraampjes: 0, katten: 0, mixers: 0, lichten: 0, stoep: 0, randen: 0, verhalen: 0, duiven: 0, honden: 0 };
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
    this.kiesStoepTegels(inf);
    this.kiesRanden();
    this.kiesStraat(inf);
    this.stoep = Float32Array.from(this.stoepBouw); this.randen = Float32Array.from(this.randBouw);
    this.stoepBouw = this.randBouw = null;
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
      // aan de bergvoet ligt puin van terrein.js: in de stad wordt daar gewoon overheen gebouwd
      if (eig == null || eig < 0 || (b.akker && b.akker[t]) || (b.moeras && b.moeras[t]) || (b.klif && b.klif[t]) || (b.duin && b.duin[t]) || (!stadT && b.bergvoet && b.bergvoet[t])) continue;
      // pocketparkje: een vrij vakje met precies één woonwijk of hoofdstad ernaast, aan de rand van de stad (de
      // andere helft van die vakjes krijgt een stoep tegen de gevel, zie kiesRanden)
      const pocket = !stadT && k === 2 && this.buurStad(tg) && hash(t, 204) < 0.5;
      if (!stadT && k < 3 && !pocket) continue;
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
      if (vrij === 4 && !glij && !pocket) soort = !vlieger && ((stadT && hash(t, 201) < 0.55) || hash(t, 201) < 0.3) ? PLEIN : PARK;
      if (soort === DEEL) for (let q = 0; q < 4; q++) {
        if (!kw[q]) continue;
        const h = hash(t, q, 202);
        kw[q] = wei ? Q_GROEN : pocket ? (h < 0.6 ? Q_GROEN : Q_SPEEL) : h < 0.4 ? Q_PLEIN : h < 0.62 ? Q_GROEN : h < 0.78 ? Q_SPEEL : Q_PARKEER;
      }
      const v = { t, x: tg.x, y: tg.y, soort, kw, zaad, monument: Math.floor(hash(t, 203) * 3), lampen: [], bomen: [], snoer: [], sl: `${t}|${soort}${kw.join('')}` };
      this.indeling(v);
      this.vakjes.push(v);
      for (let q = 0; q < 4; q++) if (soort === DEEL && kw[q]) this.merkRect(tg.x + (KWART[q][0] - 0.25) * Tw, tg.y + (KWART[q][1] - 0.25) * Tw, tg.x + (KWART[q][0] + 0.25) * Tw, tg.y + (KWART[q][1] + 0.25) * Tw, BOUWP);
      if (soort !== DEEL) this.merkRect(tg.x - Tw / 2, tg.y - Tw / 2, tg.x + Tw / 2, tg.y + Tw / 2, BOUWP);
      this.plek(soort === PLEIN ? 'plein' : soort === PARK ? 'park' : kw.includes(Q_PARKEER) ? 'parkeerplaats' : kw.includes(Q_PLEIN) ? 'buurtpleintje' : kw.includes(Q_SPEEL) ? 'speelplekje' : 'groen hoekje', tg.x, tg.y);
    }
  }

  // Grenst dit vakje (recht, niet schuin) aan een woonwijk of de hoofdstad?
  buurStad(tg) {
    const geo = this.geo;
    for (let z = 0; z < 4; z++) {
      const kk = tg.k + (z === 1 ? 1 : z === 3 ? -1 : 0), rr = tg.r + (z === 2 ? 1 : z === 0 ? -1 : 0);
      if (kk < 0 || rr < 0 || kk >= geo.kol || rr >= geo.rij) continue;
      const so = this.soort[rr * geo.kol + kk];
      if (so === STAD || so === HOOFD) return true;
    }
    return false;
  }

  // Vrije vakjes waar de stoep iets mag zetten: in of vlak naast de stad, vlak of kust, geen akker, moeras, klif,
  // duin of erf van terrein.js en werk.js, en niet waar leven.js een kudde, sleetjes, een vlieger of strandleven heeft.
  kiesStoepTegels(inf) {
    const s = this.state, geo = this.geo, n = geo.tegels.length, b = this.basis;
    if (!this.stoepT || this.stoepT.length !== n) this.stoepT = new Uint8Array(n);
    this.stoepGrid = new Uint8Array(RW * RH); // één ding per cel van 2x2 eenheden (stoep en stadsrand samen)
    this.stoepBouw = []; this.randBouw = [];
    for (let t = 0; t < n; t++) {
      const tg = geo.tegels[t], stadT = b.stad && b.stad[t];
      // in de stad zelf mag het ook aan de bosrand en op de akkerrand: de bomen en percelen blijven heel (terreinVrij)
      let ok = this.soort[t] === LEEG && this.nabij[t] >= 2 && (tg.terrein === 'vlakte' || tg.terrein === 'kust' || (stadT && tg.terrein === 'bos')) && s.eigenaar[t] != null && s.eigenaar[t] >= 0 && !(inf && inf.gereserveerd && inf.gereserveerd(t));
      if (ok && ((!stadT && b.akker && b.akker[t]) || (b.moeras && b.moeras[t]) || (b.klif && b.klif[t]) || (b.duin && b.duin[t]) || (!stadT && b.bergvoet && b.bergvoet[t]))) ok = false;
      if (ok) {
        const wei = (tg.terrein === 'vlakte' && hash(t, 3) >= 0.45 && hash(t, 61) < 0.6) || (tg.terrein === 'kust' && hash(t, 61) < 0.6);
        if (wei && (hash(t, 111) < 0.42 || hash(t, 134) < 0.35 || hash(t, 121) < 0.18)) ok = false;
        if (tg.terrein === 'kust' && !wei && hash(t, 175) < 0.6) ok = false;
      }
      // buiten de stad dezelfde randen als kiesVakjes: niet naast bos of berg (daar lopen het wild en de wolven van
      // natuur.js) en niet bij een rivier (reigers en ooievaars); natuur.js mijdt alleen de stadsvakjes zelf
      if (ok && !stadT) {
        for (let dr = -1; dr <= 1 && ok; dr++) for (let dk = -1; dk <= 1 && ok; dk++) {
          const kk = tg.k + dk, rr = tg.r + dr;
          if (kk < 0 || rr < 0 || kk >= geo.kol || rr >= geo.rij) continue;
          const tr = geo.tegels[rr * geo.kol + kk].terrein;
          if (tr === 'bos' || tr === 'berg') ok = false;
        }
        if (ok && this.tl.rivierAfstand(tg.x, tg.y) < 8) ok = false;
      }
      if (ok) { const f = kenmerkenVoorTegel(tg, b); for (let p = 0; p < f.length && ok; p += 6) if (f[p] === K_PERCEEL || f[p] === K_BOERDERIJ) ok = false; }
      this.stoepT[t] = ok ? 1 : 0;
    }
  }

  // Staat er op of vlak bij (x, y) een boom, rots, plas of stam van terrein.js (marge r)?
  terreinVrij(x, y, r) {
    const geo = this.geo;
    let t0 = -1, t1 = -1;
    for (let k = 0; k < 5; k++) {
      const t = this.tegel(x + (k === 1 ? r + 1.2 : k === 2 ? -r - 1.2 : 0), y + (k === 3 ? r + 1.2 : k === 4 ? -r - 1.2 : 0));
      if (t === t0 || t === t1) continue;
      if (k) t1 = t; else t0 = t;
      const tg = geo.tegels[t], f = kenmerkenVoorTegel(tg, this.basis);
      for (let p = 0; p < f.length; p += 6) {
        if (!HINDER[f[p]]) continue;
        const rr = f[p] === K_STAM ? f[p + 3] * 0.5 : f[p + 3];
        const dx = tg.x + f[p + 1] - x, dy = tg.y + f[p + 2] - y, m = rr + r + 0.4;
        if (dx * dx + dy * dy < m * m) return false;
      }
    }
    return true;
  }

  // Mag hier een stoepding staan (voet met straal r)? Stadsgrond, droog, geen gebouw, bouwplaats, plein of
  // kustbouwsel, niet tegen een landgrens (daar staan de hekken van grens.js), niets van terrein.js eronder, en
  // één ding per cel.
  stoepVrij(x, y, r) {
    const t = this.tegel(x, y);
    if (!this.stoepT[t] || this.natPunt(x, y, 1.3) || !this.vrijRect(x - r, y - r, x + r, y + r, GEBOUW | BOUWP | WATER)) return false;
    const e = this.eigenaar, px = Math.floor(x), py = Math.floor(y), o = e[py * W + px];
    for (let k = 0; k < 4; k++) {
      const qx = px + (k === 0 ? 3 : k === 1 ? -3 : 0), qy = py + (k === 2 ? 3 : k === 3 ? -3 : 0);
      if (qx < 0 || qy < 0 || qx >= W || qy >= H || e[qy * W + qx] !== o) return false;
    }
    if (!this.terreinVrij(x, y, r)) return false;
    const ci = clamp(Math.floor(y / RC), 0, RH - 1) * RW + clamp(Math.floor(x / RC), 0, RW - 1);
    if (this.stoepGrid[ci]) return false;
    this.stoepGrid[ci] = 1;
    return true;
  }

  // Stoep langs de rand van de stad: waar een vrij stadsvakje recht naast een woonwijk, de hoofdstad of (in de
  // hoofdstad) een ander gebouw ligt, komt tegen de gevel een strook stoeptegels met lantaarns, bomen in
  // boomspiegels, bankjes, rekken en af en toe een verhaaltje. Per kwart zijde, alleen waar het vrij is.
  kiesRanden() {
    const geo = this.geo, Tw = geo.T, n = geo.tegels.length, s = this.state, b = this.basis;
    const M = INFRA | GEBOUW | BOUWP | WATER, R = this.randBouw, L = this.stoepBouw;
    for (let t = 0; t < n && R.length < MAX_RAND * RS; t++) {
      if (!this.stoepT[t]) continue;
      const tg = geo.tegels[t], stadT = b.stad && b.stad[t];
      // een pocketparkje (kiesVakjes) houdt het vakje al bezet: dat zit in BOUWP
      for (let zijde = 0; zijde < 4; zijde++) {
        const kk = tg.k + (zijde === 1 ? 1 : zijde === 3 ? -1 : 0), rr = tg.r + (zijde === 2 ? 1 : zijde === 0 ? -1 : 0);
        if (kk < 0 || rr < 0 || kk >= geo.kol || rr >= geo.rij) continue;
        const nb = rr * geo.kol + kk, so = this.soort[nb];
        if (!(so === STAD || so === HOOFD || (so === OVERIG && (stadT || (b.stad && b.stad[nb])))) || s.eigenaar[nb] !== s.eigenaar[t]) continue;
        let mask = 0;
        for (let k = 0; k < 4; k++) {
          const u0 = -0.5 + k * 0.25, [x0, y0, x1, y1] = this.zijRect(tg, zijde, u0, u0 + 0.25, 0.5 - RAND_W, 0.5);
          if (!this.vrijRect(x0, y0, x1, y1, M) || !this.terreinVrij((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) / 2)) continue;
          // niet tegen een landgrens (daar staan de hekken van grens.js): het midden en de hoeken, met 2 eenheden marge
          const e = this.eigenaar, eigOk = (px, py) => { const o = e[clamp(Math.floor(py), 0, H - 1) * W + clamp(Math.floor(px), 0, W - 1)]; return o === s.eigenaar[t] || o === tg.eig; };
          if (!eigOk((x0 + x1) / 2, (y0 + y1) / 2) || !eigOk(x0 - 2, y0 - 2) || !eigOk(x1 + 2, y0 - 2) || !eigOk(x0 - 2, y1 + 2) || !eigOk(x1 + 2, y1 + 2)) continue;
          mask |= 1 << k;
        }
        if (!mask) continue;
        // aaneengesloten stukken als één strook
        for (let k = 0; k < 4; k++) {
          if (!(mask & (1 << k))) continue;
          let e = k;
          while (e + 1 < 4 && mask & (1 << (e + 1))) e++;
          const [x0, y0, x1, y1] = this.zijRect(tg, zijde, -0.5 + k * 0.25, -0.25 + e * 0.25, 0.5 - RAND_W, 0.5);
          R.push(x0, y0, x1, y1, zijde, t);
          this.merkRect(x0, y0, x1, y1, BOUWP);
          k = e;
        }
        // per vrij kwart twee dingen in de strook; om en om een lantaarn
        const lx = zijde === 0 || zijde === 2 ? 1 : 0, ly = 1 - lx, ax = zijde === 1 ? 1 : zijde === 3 ? -1 : 0, ay = zijde === 2 ? 1 : zijde === 0 ? -1 : 0;
        for (let m = 0; m < 8 && L.length < MAX_STOEP * ST; m++) {
          const k = m >> 1;
          if (!(mask & (1 << k))) continue;
          const u = -0.4375 + m * 0.125, [px, py] = zijPunt(zijde, u, 0.5 - RAND_W * 0.5), x = tg.x + px * Tw, y = tg.y + py * Tw;
          const zaad = (t * 131 + zijde * 8 + m) | 0, h = hash(zaad, 311);
          const hoek = m === 0 || m === 7, soort = m & 1 ? (h < 0.25 ? S_BOOM : kiesStoep(hash(zaad, 312), hoek)) : (k + zijde) % 2 === 0 && h < 0.75 ? S_LAMP : h < 0.3 ? S_BOOM : kiesStoep(hash(zaad, 312), hoek);
          if (soort < 0 || soort === V_VERHUIS) continue;
          const ci = clamp(Math.floor(y / RC), 0, RH - 1) * RW + clamp(Math.floor(x / RC), 0, RW - 1);
          if (this.stoepGrid[ci]) continue;
          this.stoepGrid[ci] = 1;
          L.push(x, y, lx, ly, ax, ay, soort, zaad);
        }
        this.plek('stadsrand', tg.x + ax * 0.45 * Tw, tg.y + ay * 0.45 * Tw);
      }
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
        else if (v.kw[q] === Q_SPEEL) v.lampen.push([qx + QS.lamp[0], qy + QS.lamp[1]]);
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
    const opAndereWeg = (i, x, y, af = 0.12) => {
      for (let j = 0; j < W.length; j++) {
        if (j === i) continue;
        const o = W[j];
        if (x < o.x0 - 4 || x > o.x1 + 4 || y < o.y0 - 4 || y > o.y1 + 4) continue;
        if (segAfstand(x, y, o.ax, o.ay, o.bx, o.by) < af * Tw) return true;
      }
      // spoor (de rails liggen niet in de wegenlijst)
      for (const r of inf.routes ?? []) for (let k = 0; k + 1 < r.n; k++) {
        const ax = r.x[k], ay = r.y[k], bx = r.x[k + 1], by = r.y[k + 1];
        if (x < Math.min(ax, bx) - 4 || x > Math.max(ax, bx) + 4 || y < Math.min(ay, by) - 4 || y > Math.max(ay, by) + 4) continue;
        if (segAfstand(x, y, ax, ay, bx, by) < af * Tw) return true;
      }
      return false;
    };
    const L = this.stoepBouw ?? (this.stoepBouw = []);
    const rb = [];
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
      // stoepstrook (vóór de berm: een verhuiswagen houdt daar zijn plek vrij). Tussen de laanbomen van infra.js
      // door; waar infra.js op deze weg geen bomen zet, plant deze laag ze zelf, in boomspiegels.
      rb.length = 0;
      for (const k of inf.kruisingen ?? []) if (k.a === i || k.b === i) rb.push((k.x - w.ax) * w.ux + (k.y - w.ay) * w.uy, 0.27 * Tw, 0);
      for (const o of inf.overwegen ?? []) if (segAfstand(o.x, o.y, w.ax, w.ay, w.bx, w.by) < 0.3 * Tw) rb.push((o.x - w.ax) * w.ux + (o.y - w.ay) * w.uy, 0.25 * Tw, 0);
      const halte = hash(w.zaad, 21) <= 0.35 && w.s1 - w.s0 >= 1.2 * Tw;
      if (halte) rb.push((w.s0 + w.s1) / 2, 0.07 * Tw, 1);
      if (w.len >= 2 * Tw) { const rnd0 = Math.min(0.45, (Tw * 0.42) / w.len), rijd = 1 - 2 * rnd0; for (let h = 1; h <= 2; h++) rb.push((rnd0 + (h / 3) * rijd) * w.len, 0.06 * Tw, 0); }
      const vrijB = (q, kant) => { for (let r = 0; r < rb.length; r += 3) if (Math.abs(q - rb[r]) < rb[r + 1] && (!rb[r + 2] || rb[r + 2] === kant)) return false; return true; };
      const eigenBomen = hash(w.zaad, 51) > 0.85, stap = eigenBomen ? 0.14 : 0.28, stadW = w.stadA || w.stadB;
      for (const kant of [-1, 1]) {
        for (let q = w.s0 + Tw * stap, j = 0; q <= w.s1 - Tw * 0.16 && L.length < MAX_STOEP * ST; q += Tw * stap, j++) {
          if (!vrijB(q, kant) || (inf.inTunnel && inf.inTunnel(w, q)) || (inf.opBrug && inf.opBrug(w, q))) continue;
          const x = w.ax + w.ux * q + nx * kant * STROOK * Tw, y = w.ay + w.uy * q + ny * kant * STROOK * Tw;
          if ((inf.opBouwwerk && inf.opBouwwerk(x, y)) || opAndereWeg(i, x, y, 0.22) || !this.stoepVrij(x, y, 0.03 * Tw)) continue;
          const zaad = (w.zaad * 53 + j * 2 + (kant > 0 ? 1 : 0)) | 0;
          let soort = eigenBomen && !(j & 1) ? S_BOOM : kiesStoep(hash(zaad, 301), stadW && Math.min(q - w.s0, w.s1 - q) < 0.6 * Tw);
          // afvalbakken en brandkranen zet infra.js al bij zijn lantaarns langs elke weg: hier iets anders
          if (soort === S_AFVAL) soort = S_REK; else if (soort === S_KRAAN) soort = S_BAK;
          if (soort === V_VERHUIS) {
            // de verhuiswagen staat op de berm ernaast: die moet vrij en droog zijn
            const bx = w.ax + w.ux * q + nx * kant * BERM * Tw, by = w.ay + w.uy * q + ny * kant * BERM * Tw;
            if (vrijQ(q - 0.05 * Tw, kant) && vrijQ(q + 0.05 * Tw, kant) && vrijQ(q, kant) && tegelOk(bx, by) && !this.natPunt(bx, by, 1.4) && !opAndereWeg(i, bx, by)) res.push(q, 0.09 * Tw, kant);
            else soort = S_BANK;
          }
          if (soort < 0) continue;
          L.push(x, y, w.ux, w.uy, nx * kant, ny * kant, soort, zaad);
        }
      }
      // bushalte van infra.js in de stad: wachtenden, 's nachts een enkele nachtbus met verlicht reclamevlak
      if (halte) {
        const q = (w.s0 + w.s1) / 2, x = w.ax + w.ux * q + nx * 0.105 * Tw, y = w.ay + w.uy * q + ny * 0.105 * Tw;
        if (this.stoepT[this.tegel(x, y)] && !this.natPunt(x, y, 1) && !(inf.inTunnel && inf.inTunnel(w, q)) && !(inf.opBrug && inf.opBrug(w, q)) && !(inf.opBouwwerk && inf.opBouwwerk(x, y))) L.push(x, y, w.ux, w.uy, nx, ny, V_HALTE, (w.zaad * 7 + 3) | 0);
      }
      // vakken op de berm
      for (const kant of [-1, 1]) {
        for (let q = w.s0 + Tw * 0.22, j = 0; q <= w.s1 - Tw * 0.22 && autos.length < MAX_AUTOS * 6; q += Tw * 0.075, j++) {
          if (!vrijQ(q, kant) || (inf.inTunnel && inf.inTunnel(w, q)) || (inf.opBrug && inf.opBrug(w, q))) continue;
          const x = w.ax + w.ux * q + nx * kant * BERM * Tw, y = w.ay + w.uy * q + ny * kant * BERM * Tw;
          if (!tegelOk(x, y) || this.natPunt(x, y, 1.4) || (inf.opBouwwerk && inf.opBouwwerk(x, y)) || opAndereWeg(i, x, y) || !vrijCel(x, y)) continue;
          const h = hash(w.zaad, j * 2 + (kant > 0 ? 1 : 0), 201), zaad = (w.zaad * 31 + j * 2 + (kant > 0 ? 1 : 0)) | 0;
          // rechts rijden: aan de rechterkant (kant +1) staat de neus in de rijrichting
          if (h < 0.56) {
            autos.push(x, y, w.ux * kant, w.uy * kant, Math.floor(hash(zaad, 203) * AUTOS.length), hash(zaad, 204) < 0.15 ? 1 : 0);
            // laadpaal op de grens met het volgende vak, voor de neus, met de kabel in de auto
            if (hash(zaad, 206) < 0.12 && L.length < MAX_STOEP * ST && this.stoepT[this.tegel(x, y)]) L.push(x + w.ux * kant * 0.0375 * Tw, y + w.uy * kant * 0.0375 * Tw, w.ux * kant, w.uy * kant, nx * kant, ny * kant, S_LAAD, zaad);
          } else if (h < 0.62 && meub.length < MAX_MEUBEL * 5) meub.push(x, y, w.ux, w.uy, 0);
          else if (h < 0.645 && meub.length < MAX_MEUBEL * 5) {
            meub.push(x, y, w.ux, w.uy, 1 + Math.floor(hash(zaad, 205) * BUS_KLEUR.length));
            // de postbode fietst over het fietspad en leegt de brievenbus
            if (stadW && hash(zaad, 207) < 0.6 && L.length < MAX_STOEP * ST) L.push(x, y, w.ux, w.uy, nx * kant, ny * kant, V_POST, zaad);
          } else if (h < 0.8 && plas.length < MAX_PLAS * 4) plas.push(x, y, w.ux, w.uy);
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
    if (z >= DREMPEL.rand - 0.5) { this.tekenRanden(c, smooth(DREMPEL.rand - 0.5, DREMPEL.rand + 0.3, z)); this.tekenStoep(c, nu); }
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

  // ---------- de stoep: stadsrand, straatmeubilair en verhaaltjes ----------

  // Stoeptegels langs de rand van de stad: een strook met een stoeprand aan de open kant; fijn ook de voegen.
  tekenRanden(c, a) {
    const R = this.randen, T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, Tw = this.geo.T, zi = this.zr;
    let n = 0;
    for (let i = 0; i < R.length && n < PLAFOND.randen; i += RS) if (this.inBeeld((R[i] + R[i + 2]) / 2, (R[i + 1] + R[i + 3]) / 2, Tw * 0.6)) zi[n++] = i;
    this.n.randen = n;
    if (!n) return;
    c.globalAlpha = a;
    c.fillStyle = STOEP; c.beginPath();
    for (let k = 0; k < n; k++) { const i = zi[k]; c.rect(R[i] * sc + ox, R[i + 1] * sc + oy, (R[i + 2] - R[i]) * sc, (R[i + 3] - R[i + 1]) * sc); }
    c.fill();
    // stoeprand aan de open kant (zijde 0 = noord: de gevel ligt boven, de open kant onder), met een schaduwlijntje
    const rand = (kleur, br, d) => {
      c.strokeStyle = kleur; c.lineWidth = br; c.beginPath();
      for (let k = 0; k < n; k++) {
        const i = zi[k], z = R[i + 4], x0 = R[i] * sc + ox, y0 = R[i + 1] * sc + oy, x1 = R[i + 2] * sc + ox, y1 = R[i + 3] * sc + oy;
        if (z === 0) { c.moveTo(x0, y1 + d); c.lineTo(x1, y1 + d); } else if (z === 2) { c.moveTo(x0, y0 - d); c.lineTo(x1, y0 - d); }
        else if (z === 1) { c.moveTo(x0 - d, y0); c.lineTo(x0 - d, y1); } else { c.moveTo(x1 + d, y0); c.lineTo(x1 + d, y1); }
      }
      c.stroke();
    };
    rand(RAND, Math.max(0.6, T * 0.008), 0);
    if (this.zoom >= 8) rand('rgba(25,25,24,0.3)', Math.max(0.4, T * 0.003), T * 0.005);
    if (this.zoom >= DREMPEL.klein) {
      // voegen van de stoeptegels
      c.strokeStyle = VOEG; c.lineWidth = Math.max(0.4, T * 0.0015); c.beginPath();
      for (let k = 0; k < n; k++) {
        const i = zi[k], z = R[i + 4], x0 = R[i] * sc + ox, y0 = R[i + 1] * sc + oy, x1 = R[i + 2] * sc + ox, y1 = R[i + 3] * sc + oy, d = T * 0.03;
        if (z === 0 || z === 2) { for (let x = x0 + d; x < x1; x += d) { c.moveTo(x, y0); c.lineTo(x, y1); } c.moveTo(x0, (y0 + y1) / 2); c.lineTo(x1, (y0 + y1) / 2); }
        else { for (let y = y0 + d; y < y1; y += d) { c.moveTo(x0, y); c.lineTo(x1, y); } c.moveTo((x0 + x1) / 2, y0); c.lineTo((x0 + x1) / 2, y1); }
      }
      c.stroke();
    }
    if (this.sn) {
      // een laagje sneeuw aan de open kant; het looppad tegen de gevel is geveegd
      c.fillStyle = this.sn === 2 ? 'rgba(238,242,244,0.75)' : 'rgba(238,242,244,0.45)'; c.beginPath();
      for (let k = 0; k < n; k++) {
        const i = zi[k], z = R[i + 4], x0 = R[i] * sc + ox, y0 = R[i + 1] * sc + oy, x1 = R[i + 2] * sc + ox, y1 = R[i + 3] * sc + oy, h = RAND_W * T * 0.45;
        if (z === 0) c.rect(x0, y1 - h, x1 - x0, h); else if (z === 2) c.rect(x0, y0, x1 - x0, h); else if (z === 1) c.rect(x0, y0, h, y1 - y0); else c.rect(x1 - h, y0, h, y1 - y0);
      }
      c.fill();
    }
    c.globalAlpha = 1;
  }

  // Alles op de stoep dat in beeld is, binnen het plafond; elke soort met zijn eigen drempel.
  tekenStoep(c, nu) {
    const L = this.stoep, sc = this.sc, ox = this.ox, oy = this.oy, Tw = this.geo.T, z = this.zoom, sz = this.sz;
    const aB = smooth(DREMPEL.rand - 0.5, DREMPEL.rand + 0.3, z), aG = smooth(DREMPEL.stoep - 0.5, DREMPEL.stoep + 0.3, z), aK = smooth(DREMPEL.stoepKlein - 0.5, DREMPEL.stoepKlein + 0.3, z);
    const groot = z >= DREMPEL.stoep - 0.5, klein = z >= DREMPEL.stoepKlein - 0.5;
    const dag = this.nacht < 0.5, droog = this.wr.regen < 0.3 && this.wr.sneeuw < 0.3;
    this.stand2 = { dag, droog, verhaal: z >= DREMPEL.verhaal - 0.5, zit: z >= DREMPEL.zitten && dag && droog, winter: sz.winter > 0.6, zomer: sz.zomer > 0.5 };
    const ZS = this.zs;
    let n = 0;
    for (let i = 0; i < L.length && n < PLAFOND.stoep; i += ST) {
      const soort = L[i + 6];
      if (soort !== S_BOOM && (KLEIN[soort] ? !klein : !groot)) continue;
      if (!this.inBeeld(L[i], L[i + 1], Tw * 0.15)) continue;
      ZS[n++] = i;
    }
    this.n.stoep = n;
    if (!n) return;
    // eerst wat plat op de grond ligt, dan wat staat, de bomen het laatst (hun kruin hangt over de stoep)
    for (let fase = 0; fase < 3; fase++) {
      for (let k = 0; k < n; k++) {
        const i = ZS[k], soort = L[i + 6];
        if ((soort === S_BOOM ? 2 : soort === V_KRIJT || soort === S_DEEL ? 0 : 1) !== fase) continue;
        c.globalAlpha = soort === S_BOOM ? aB : KLEIN[soort] ? aK : aG;
        this.stoepDing(c, soort, L[i] * sc + ox, L[i + 1] * sc + oy, L[i + 2], L[i + 3], L[i + 4], L[i + 5], L[i + 7], nu);
      }
    }
    c.globalAlpha = 1;
  }

  stoepDing(c, soort, x, y, ux, uy, nx, ny, zaad, nu) {
    switch (soort) {
      case S_BOOM: return this.straatboom(c, x, y, zaad);
      case S_BANK: return this.bank(c, x, y, ux, uy, nx, ny, zaad, nu);
      case S_AFVAL: return this.afvalbak(c, x, y);
      case S_REK: return this.fietsenrek(c, x, y, ux, uy, nx, ny, zaad);
      case S_PAAL: return this.paaltjesRij(c, x, y, ux, uy);
      case S_KRAAN: return this.brandkraan(c, x, y);
      case S_BAK: return this.bloembak(c, x, y, ux, uy, zaad);
      case S_DEEL: return this.deelvoertuigen(c, x, y, ux, uy, nx, ny, zaad);
      case S_KUNST: return this.kunstwerk(c, x, y, zaad);
      case S_ZUIL: return this.reclamezuil(c, x, y, zaad);
      case S_LAMP: return this.stoeplamp(c, x, y, nx, ny);
      case S_LAAD: return this.laadpaal(c, x, y, ux, uy, nx, ny, nu);
      case V_MUZIEK: return this.muzikant(c, x, y, ux, uy, nx, ny, zaad, nu);
      case V_KRIJT: return this.stoepkrijt(c, x, y, ux, uy, nx, ny, zaad, nu);
      case V_BLOEM: return this.bloemenstal(c, x, y, ux, uy, nx, ny, zaad, nu);
      case V_IJS: return this.ijscofiets(c, x, y, ux, uy, nx, ny, zaad, nu);
      case V_SNACK: return this.snackkar(c, x, y, ux, uy, nx, ny, zaad, nu);
      case V_DUIF: return this.duiven(c, x, y, ux, uy, nx, ny, 0.06, zaad, nu);
      case V_VERHUIS: return this.verhuizing(c, x, y, ux, uy, nx, ny, zaad, nu);
      case V_POST: return this.postbode(c, x, y, ux, uy, nx, ny, zaad, nu);
      case V_HALTE: return this.halteWacht(c, x, y, ux, uy, nx, ny, zaad, nu);
    }
  }

  schaduw(c, x, y, hx, hy, l, b, a = 0.25) { const T = this.T; c.fillStyle = `rgba(0,0,0,${a})`; c.beginPath(); rechthoek(c, x + T * 0.006, y + T * 0.008, hx, hy, l, b); c.fill(); }

  // Boom in een boomspiegel (rooster in de stoep), in de kleur van het seizoen.
  straatboom(c, x, y, zaad) {
    const T = this.T, b = this.bakStand, r = T * 0.03 * (0.85 + 0.3 * hash(zaad, 401));
    c.fillStyle = '#6a6050'; c.fillRect(x - T * 0.016, y - T * 0.012, T * 0.032, T * 0.024);
    if (this.zoom >= DREMPEL.klein) { c.strokeStyle = 'rgba(40,36,30,0.6)'; c.lineWidth = Math.max(0.4, T * 0.0015); c.strokeRect(x - T * 0.014, y - T * 0.01, T * 0.028, T * 0.02); }
    c.fillStyle = 'rgba(0,0,0,0.26)'; c.beginPath(); c.ellipse(x + r * 0.6, y + r * 0.9, r, r * 0.7, 0.6, 0, TAU); c.fill();
    c.strokeStyle = '#4a3a2c'; c.lineWidth = Math.max(0.6, r * 0.16); c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - r * 0.8); c.stroke();
    if (!b.kroon) {
      c.strokeStyle = '#6b5a4a'; c.lineWidth = Math.max(0.4, r * 0.07); c.beginPath();
      for (let t = 0; t < 5; t++) { const hk = -Math.PI / 2 + (t - 2) * 0.55; c.moveTo(x, y - r * 0.8); c.lineTo(x + Math.cos(hk) * r, y - r * 0.8 + Math.sin(hk) * r * 0.9); }
      c.stroke();
      if (b.sn) { c.fillStyle = 'rgba(244,246,248,0.75)'; c.beginPath(); c.ellipse(x - r * 0.15, y - r * 1.45, r * 0.4, r * 0.18, 0, 0, TAU); c.fill(); }
      return;
    }
    const h = hash(zaad, 402);
    c.fillStyle = b.kroon[1]; c.beginPath(); c.arc(x + r * 0.12, y - r, r, 0, TAU); c.fill();
    c.fillStyle = b.kroon[h < 0.5 ? 0 : 1]; c.beginPath(); c.arc(x - r * 0.06, y - r * 1.16, r * 0.88, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,215,0.2)'; c.beginPath(); c.arc(x - r * 0.32, y - r * 1.42, r * 0.45, 0, TAU); c.fill();
    if (b.bloei && h < 0.5) { c.fillStyle = '#f3c8d4'; c.beginPath(); for (let t = 0; t < 5; t++) stip(c, x + Math.cos(t * 2.4 + h * 9) * r * 0.55, y - r * 1.1 + Math.sin(t * 2.4 + h * 9) * r * 0.55, Math.max(0.5, r * 0.1)); c.fill(); }
  }

  // Bankje: zitting langs de stoep, rugleuning aan de achterkant; overdag zit er soms iemand.
  bank(c, x, y, ux, uy, nx, ny, zaad, nu) {
    const T = this.T, l = T * 0.022, b = T * 0.0065;
    this.schaduw(c, x, y, ux, uy, l * 1.05, b * 1.3);
    if (this.zoom >= 11) { c.fillStyle = '#2a2c2e'; for (const s of [-0.8, 0.8]) c.fillRect(x + ux * l * s - T * 0.002, y + uy * l * s - T * 0.001, T * 0.004, T * 0.004); }
    c.fillStyle = HOUT; c.beginPath(); rechthoek(c, x, y, ux, uy, l, b); c.fill();
    c.strokeStyle = HOUT_D; c.lineWidth = Math.max(0.5, T * 0.0035); c.beginPath();
    c.moveTo(x - ux * l + nx * b, y - uy * l + ny * b - T * 0.004); c.lineTo(x + ux * l + nx * b, y + uy * l + ny * b - T * 0.004); c.stroke();
    if (this.bakStand.sn) { c.fillStyle = 'rgba(244,246,248,0.8)'; c.beginPath(); rechthoek(c, x, y, ux, uy, l * 0.9, b * 0.6); c.fill(); return; }
    if (!this.stand2.zit) return;
    // wie er zit wisselt per paar minuten
    const f = frac(nu / 150000 + hash(zaad, 411)), aantal = f < 0.35 ? 0 : f < 0.8 ? 1 : 2;
    for (let j = 0; j < aantal; j++) {
      const u = (aantal === 1 ? (hash(zaad, 412) - 0.5) * 0.6 : j ? 0.45 : -0.45) * l;
      this.zetFig(x + ux * u, y + uy * u - T * 0.002, Math.floor(hash(zaad, j, 413) * KLEDING.length), Math.floor(hash(zaad, j, 414) * 3), 1);
    }
  }

  afvalbak(c, x, y) {
    const T = this.T, r = T * 0.0065;
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); stip(c, x + T * 0.004, y + T * 0.005, r * 1.1); c.fill();
    c.fillStyle = '#3d5a3a'; c.fillRect(x - r, y - r * 2.2, r * 2, r * 2.2);
    c.fillStyle = '#4f7048'; c.beginPath(); c.ellipse(x, y - r * 2.2, r, r * 0.5, 0, 0, TAU); c.fill();
    c.fillStyle = '#1e2a1c'; c.beginPath(); c.ellipse(x, y - r * 2.2, r * 0.55, r * 0.26, 0, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,220,0.18)'; c.fillRect(x - r, y - r * 2.2, r * 0.6, r * 2.2);
  }

  // Fietsenrek met een paar fietsen dwars op de stoep, in hun eigen kleur.
  fietsenrek(c, x, y, ux, uy, nx, ny, zaad) {
    const T = this.T, l = T * 0.03, n = 2 + Math.floor(hash(zaad, 421) * 4), wl = T * 0.011, wr = T * 0.0062, hk = Math.atan2(ny, nx);
    const U = (k) => (-0.8 + (1.6 * k) / Math.max(1, n - 1)) * l;
    c.strokeStyle = '#8a8d90'; c.lineWidth = Math.max(0.5, T * 0.002); c.beginPath(); c.moveTo(x - ux * l, y - uy * l); c.lineTo(x + ux * l, y + uy * l); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.beginPath();
    for (let k = 0; k < n; k++) { const px = x + ux * U(k) + T * 0.004, py = y + uy * U(k) + T * 0.005; c.moveTo(px - nx * wl, py - ny * wl); c.lineTo(px + nx * wl, py + ny * wl); }
    c.stroke();
    c.strokeStyle = '#2a2c30'; c.beginPath();
    for (let k = 0; k < n; k++) { const px = x + ux * U(k), py = y + uy * U(k); for (const s of [-1, 1]) { const cx = px + nx * wl * s, cy = py + ny * wl * s; c.moveTo(cx + wr, cy); c.ellipse(cx, cy, wr, wr * 0.5, hk, 0, TAU); } }
    c.stroke();
    c.lineWidth = Math.max(0.6, T * 0.0028);
    for (let k = 0; k < n; k++) {
      const px = x + ux * U(k), py = y + uy * U(k);
      c.strokeStyle = FIETS[Math.floor(hash(zaad, k, 422) * FIETS.length)]; c.beginPath();
      c.moveTo(px - nx * wl, py - ny * wl); c.lineTo(px, py - T * 0.004); c.lineTo(px + nx * wl, py + ny * wl);
      c.moveTo(px + nx * wl * 0.7, py + ny * wl * 0.7 - T * 0.006); c.lineTo(px + nx * wl * 0.4 + ux * T * 0.006, py + ny * wl * 0.4 + uy * T * 0.006 - T * 0.007);
      c.stroke();
    }
  }

  paaltjesRij(c, x, y, ux, uy) {
    const T = this.T, r = T * 0.004;
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); for (let k = -1; k <= 1; k++) stip(c, x + ux * k * T * 0.025 + T * 0.004, y + uy * k * T * 0.025 + T * 0.004, r); c.fill();
    c.fillStyle = PAAL; c.beginPath(); for (let k = -1; k <= 1; k++) stip(c, x + ux * k * T * 0.025, y + uy * k * T * 0.025 - T * 0.002, r); c.fill();
    if (this.zoom >= DREMPEL.klein) { c.fillStyle = '#e8e6de'; c.beginPath(); for (let k = -1; k <= 1; k++) stip(c, x + ux * k * T * 0.025, y + uy * k * T * 0.025 - T * 0.003, r * 0.45); c.fill(); }
  }

  brandkraan(c, x, y) {
    const T = this.T, r = T * 0.005;
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); stip(c, x + T * 0.004, y + T * 0.004, r); c.fill();
    c.fillStyle = '#b8322a'; c.fillRect(x - r * 0.8, y - r * 2, r * 1.6, r * 2);
    c.fillStyle = '#d8483a'; c.beginPath(); c.ellipse(x, y - r * 2, r, r * 0.6, 0, 0, TAU); c.fill();
    c.fillStyle = '#e8d8c8'; c.fillRect(x - r * 1.3, y - r * 1.4, r * 2.6, r * 0.5);
  }

  // Betonnen bloembak; de bloemen volgen het seizoen, in de winter groenblijvend of onder de sneeuw.
  bloembak(c, x, y, ux, uy, zaad) {
    const T = this.T, l = T * 0.022, b = T * 0.0095, B = this.bakStand;
    this.schaduw(c, x, y, ux, uy, l, b, 0.24);
    c.fillStyle = '#a9a39a'; c.beginPath(); rechthoek(c, x, y, ux, uy, l, b); c.fill();
    c.fillStyle = '#5b4a38'; c.beginPath(); rechthoek(c, x, y, ux, uy, l * 0.82, b * 0.6); c.fill();
    if (B.sn) { c.fillStyle = 'rgba(240,243,245,0.9)'; c.beginPath(); rechthoek(c, x, y - T * 0.002, ux, uy, l * 0.85, b * 0.7); c.fill(); return; }
    c.fillStyle = B.bloem ? '#4f7a3a' : '#3f5a3a'; c.beginPath(); for (let k = 0; k < 5; k++) stip(c, x + ux * (k - 2) * l * 0.38, y + uy * (k - 2) * l * 0.38 - T * 0.003, b * 0.55); c.fill();
    if (B.bloem && this.zoom >= 10) {
      const kl = B.bloem, o = Math.floor(hash(zaad, 431) * 4);
      for (let j = 0; j < kl.length; j++) { c.fillStyle = kl[(j + o) % kl.length]; c.beginPath(); for (let k = 0; k < 3; k++) { const u = (hash(zaad, j * 3 + k, 432) - 0.5) * 1.6 * l, w = (hash(zaad, j * 3 + k, 433) - 0.5) * b; stip(c, x + ux * u - uy * w, y + uy * u + ux * w - T * 0.004, Math.max(0.5, T * 0.0028)); } c.fill(); }
    }
  }

  // Deelfietsen of deelsteps in een vak met witte belijning, in één vlootkleur, schuin zoals ze achtergelaten worden.
  deelvoertuigen(c, x, y, ux, uy, nx, ny, zaad) {
    const T = this.T, step = hash(zaad, 441) < 0.4, kl = DEELKLEUR[step ? 1 : 0];
    if (this.zoom >= DREMPEL.klein) { c.strokeStyle = 'rgba(236,235,228,0.65)'; c.lineWidth = Math.max(0.4, T * 0.0015); c.beginPath(); rechthoek(c, x, y, ux, uy, T * 0.034, T * 0.014); c.stroke(); }
    const n = step ? 2 + Math.floor(hash(zaad, 442) * 2) : 3 + Math.floor(hash(zaad, 442) * 2), l = T * (step ? 0.009 : 0.011);
    for (let k = 0; k < n; k++) {
      const u = (-0.75 + (1.5 * k) / Math.max(1, n - 1)) * T * 0.028, px = x + ux * u, py = y + uy * u;
      const a = 0.5 + (hash(zaad, k, 443) - 0.5) * 0.5, dx = nx * Math.cos(a) + ux * Math.sin(a), dy = ny * Math.cos(a) + uy * Math.sin(a);
      c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = Math.max(0.5, T * 0.0022); c.beginPath(); c.moveTo(px - dx * l + T * 0.004, py - dy * l + T * 0.005); c.lineTo(px + dx * l + T * 0.004, py + dy * l + T * 0.005); c.stroke();
      if (step) {
        c.strokeStyle = '#2a2c30'; c.lineWidth = Math.max(0.6, T * 0.0035); c.beginPath(); c.moveTo(px - dx * l, py - dy * l); c.lineTo(px + dx * l, py + dy * l); c.stroke();
        c.strokeStyle = kl; c.lineWidth = Math.max(0.5, T * 0.0025); c.beginPath(); c.moveTo(px - dx * l * 0.8, py - dy * l * 0.8); c.lineTo(px + dx * l * 0.6, py + dy * l * 0.6); c.moveTo(px + dx * l, py + dy * l); c.lineTo(px + dx * l, py + dy * l - T * 0.012); c.stroke();
      } else {
        c.strokeStyle = '#2a2c30'; c.lineWidth = Math.max(0.5, T * 0.002); c.beginPath(); for (const s of [-1, 1]) { const cx = px + dx * l * s, cy = py + dy * l * s, r = T * 0.006; c.moveTo(cx + r, cy); c.ellipse(cx, cy, r, r * 0.5, Math.atan2(dy, dx), 0, TAU); } c.stroke();
        c.strokeStyle = kl; c.lineWidth = Math.max(0.6, T * 0.003); c.beginPath(); c.moveTo(px - dx * l, py - dy * l); c.lineTo(px, py - T * 0.004); c.lineTo(px + dx * l, py + dy * l); c.stroke();
        c.fillStyle = kl; c.fillRect(px + dx * l * 0.7 - T * 0.003, py + dy * l * 0.7 - T * 0.008, T * 0.006, T * 0.004);
      }
    }
  }

  // Abstract kunstwerk op een hoek bij de stadsingang: een staande boog, gekantelde blokken of een bol op een sokkel.
  kunstwerk(c, x, y, zaad) {
    const T = this.T, soort = Math.floor(hash(zaad, 451) * 3);
    c.fillStyle = 'rgba(0,0,0,0.26)'; c.fillRect(x - T * 0.01, y - T * 0.002, T * 0.032, T * 0.02);
    c.fillStyle = '#a8a092'; c.fillRect(x - T * 0.016, y - T * 0.012, T * 0.032, T * 0.022);
    c.fillStyle = '#bdb5a6'; c.fillRect(x - T * 0.016, y - T * 0.016, T * 0.032, T * 0.006);
    if (soort === 0) {
      const h = T * 0.05;
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = T * 0.006; c.beginPath(); c.moveTo(x - T * 0.012, y); c.quadraticCurveTo(x + h * SCHUIN, y + h * SCHUIN * 0.6, x + T * 0.012 + h * SCHUIN * 0.4, y + h * SCHUIN * 0.4); c.stroke();
      c.strokeStyle = '#8a4a2a'; c.beginPath(); c.moveTo(x - T * 0.012, y - T * 0.012); c.quadraticCurveTo(x, y - h * 1.6, x + T * 0.012, y - T * 0.012); c.stroke();
      c.strokeStyle = '#b8683a'; c.lineWidth = T * 0.0022; c.beginPath(); c.moveTo(x - T * 0.013, y - T * 0.014); c.quadraticCurveTo(x - T * 0.002, y - h * 1.6, x + T * 0.004, y - h * 0.75); c.stroke();
    } else if (soort === 1) {
      const kl = [['#2f6d9a', '#24557a'], ['#d9a63a', '#a87a24'], ['#c8432f', '#953224']];
      for (let k = 0; k < 3; k++) {
        const bx = x + (k - 1) * T * 0.004, by = y - T * 0.016 - k * T * 0.014, w = T * (0.022 - k * 0.004);
        c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(bx - w / 2 + T * 0.01, by + T * 0.008, w, w * 0.5);
        c.save(); c.translate(bx, by); c.rotate((k - 1) * 0.3);
        c.fillStyle = kl[k][1]; c.fillRect(-w / 2, -T * 0.012, w, T * 0.012);
        c.fillStyle = kl[k][0]; c.fillRect(-w / 2, -T * 0.012 - w * 0.4, w, w * 0.4);
        c.restore();
      }
    } else {
      const r = T * 0.014, cy = y - T * 0.016 - r;
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(x + r * 1.2, y + T * 0.004, r, r * 0.5, 0.6, 0, TAU); c.fill();
      c.fillStyle = '#9aa2a8'; c.beginPath(); c.arc(x, cy, r, 0, TAU); c.fill();
      c.fillStyle = '#6e767c'; c.beginPath(); c.arc(x + r * 0.2, cy + r * 0.2, r * 0.75, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.75)'; c.beginPath(); c.arc(x - r * 0.35, cy - r * 0.35, r * 0.28, 0, TAU); c.fill();
    }
    if (this.nacht > 0.05) this.zetLicht(x, y - T * 0.03, T * 0.035, WARM, 0.4);
  }

  // Reclamezuil zonder tekst: ronde zuil met kleurvlakken en een koepeltje; 's avonds van binnen verlicht.
  reclamezuil(c, x, y, zaad) {
    const T = this.T, r = T * 0.011, h = T * 0.05;
    c.fillStyle = 'rgba(0,0,0,0.26)'; c.beginPath(); c.moveTo(x - r, y); c.lineTo(x + r, y); c.lineTo(x + r + h * SCHUIN, y + h * SCHUIN * 0.8); c.lineTo(x - r + h * SCHUIN, y + h * SCHUIN * 0.8); c.closePath(); c.fill();
    c.fillStyle = '#3f5a4a'; c.fillRect(x - r, y - h, r * 2, h);
    for (let k = 0; k < 3; k++) { c.fillStyle = ZUIL[Math.floor(hash(zaad, k, 461) * ZUIL.length)]; c.fillRect(x - r * 0.9, y - h * (0.85 - k * 0.27), r * 1.8, h * 0.22); }
    if (this.zoom >= DREMPEL.klein) { c.fillStyle = 'rgba(255,255,255,0.55)'; for (let k = 0; k < 3; k++) c.fillRect(x - r * 0.6, y - h * (0.79 - k * 0.27), r * (0.4 + 0.7 * hash(zaad, k, 462)), h * 0.04); }
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x + r * 0.3, y - h, r * 0.7, h);
    c.fillStyle = 'rgba(255,255,230,0.2)'; c.fillRect(x - r, y - h, r * 0.45, h);
    c.fillStyle = this.bakStand.sn ? '#eef1f3' : '#2f4a3a'; c.beginPath(); c.ellipse(x, y - h, r * 1.25, r * 0.55, 0, 0, TAU); c.fill();
    c.beginPath(); c.arc(x, y - h - r * 0.2, r * 0.7, Math.PI, 0); c.fill();
    if (this.nacht > 0.05) { this.zetLicht(x, y - h * 0.5, T * 0.03, NEON[Math.floor(hash(zaad, 463) * NEON.length)], 0.5); this.zetLicht(x, y - h * 0.5, T * 0.014, WARM, 0.6); }
  }

  // Lantaarnpaal op de stoep langs de stadsrand, de arm naar de open kant; 's nachts een lichtplas.
  stoeplamp(c, x, y, nx, ny) {
    const T = this.T, H = T * LAMP_H, arm = T * 0.022;
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.5, T * 0.005); c.beginPath(); c.moveTo(x, y); c.lineTo(x + H * SCHUIN, y + H * SCHUIN); c.stroke();
    c.strokeStyle = PAAL; c.lineWidth = Math.max(0.6, T * 0.006); c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - H); c.lineTo(x - nx * arm, y - H - ny * arm); c.stroke();
    c.fillStyle = this.nacht > 0.3 ? '#fff2c4' : '#d8d6cc'; c.beginPath(); stip(c, x - nx * arm, y - H - ny * arm, Math.max(0.8, T * 0.007)); c.fill();
    if (this.nacht > 0.05) { this.zetLicht(x - nx * arm, y - H - ny * arm, Math.max(2, T * 0.03), WARM, 0.9); this.zetLicht(x - nx * arm * 1.6, y - ny * arm * 1.6, T * 0.085, WARM, 0.22); }
  }

  // Laadpaal voor de neus van een geparkeerde auto, met een kabel erin; het lampje knippert groen.
  laadpaal(c, x, y, ux, uy, nx, ny, nu) {
    const T = this.T, h = T * 0.016;
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.6, T * 0.005); c.beginPath(); c.moveTo(x, y); c.lineTo(x + h * SCHUIN, y + h * SCHUIN); c.stroke();
    c.fillStyle = '#e8e6de'; c.fillRect(x - T * 0.0035, y - h, T * 0.007, h);
    c.fillStyle = '#2f6d9a'; c.fillRect(x - T * 0.0035, y - h, T * 0.007, T * 0.004);
    const aan = frac(nu / 1600 + x * 0.01) < 0.6;
    c.fillStyle = aan ? '#4dff7a' : '#2a6a3a'; c.beginPath(); stip(c, x, y - h * 0.6, Math.max(0.5, T * 0.0018)); c.fill();
    c.strokeStyle = '#1d1f21'; c.lineWidth = Math.max(0.4, T * 0.0015); c.beginPath(); c.moveTo(x, y - h * 0.5); c.quadraticCurveTo(x - ux * T * 0.006 + nx * T * 0.004, y - uy * T * 0.006 + ny * T * 0.004 + T * 0.004, x - ux * T * 0.01, y - uy * T * 0.01 - T * 0.002); c.stroke();
    if (this.nacht > 0.05 && aan) this.zetLicht(x, y - h * 0.6, Math.max(1.2, T * 0.008), GROEN, 0.7);
  }

  // ---------- verhaaltjes op de stoep ----------

  verhaalTeller() { if (this.n.verhalen >= PLAFOND.verhalen) return false; this.n.verhalen++; return true; }

  // Straatmuzikant met een open koffer en een publiekje dat aanzwelt en weer wegloopt.
  muzikant(c, x, y, ux, uy, nx, ny, zaad, nu) {
    const T = this.T, st = this.stand2;
    if (!st.dag || !st.droog || this.kerst || this.zoom < DREMPEL.zitten - 0.5 || !this.verhaalTeller()) return;
    const kx = x - nx * T * 0.012 + ux * T * 0.008, ky = y - ny * T * 0.012 + uy * T * 0.008;
    this.schaduw(c, kx, ky, ux, uy, T * 0.009, T * 0.005, 0.2);
    c.fillStyle = '#2a2622'; c.beginPath(); rechthoek(c, kx, ky, ux, uy, T * 0.009, T * 0.005); c.fill();
    c.fillStyle = '#8a2a2a'; c.beginPath(); rechthoek(c, kx, ky, ux, uy, T * 0.007, T * 0.0035); c.fill();
    if (this.zoom >= 13) { c.fillStyle = '#e0c050'; c.beginPath(); for (let k = 0; k < 3; k++) stip(c, kx + ux * (k - 1) * T * 0.004, ky + uy * (k - 1) * T * 0.004, Math.max(0.4, T * 0.0012)); c.fill(); }
    const zw = Math.sin(nu / 320 + zaad) * T * 0.0015;
    this.zetFig(x + zw, y, Math.floor(hash(zaad, 471) * KLEDING.length), Math.floor(hash(zaad, 472) * 3), 1);
    // een gitaarvorm schuin voor de buik
    c.fillStyle = '#b07a3a'; c.beginPath(); c.ellipse(x + zw + T * 0.004, y - T * 0.003, T * 0.0045, T * 0.003, -0.6, 0, TAU); c.fill();
    c.strokeStyle = '#5a3a22'; c.lineWidth = Math.max(0.4, T * 0.0013); c.beginPath(); c.moveTo(x + zw + T * 0.004, y - T * 0.003); c.lineTo(x + zw - T * 0.006, y - T * 0.01); c.stroke();
    // publiek in een halve kring aan de kant van de looproute
    const n = Math.floor(tri(nu / 45000 + hash(zaad, 473)) * 5.5);
    for (let k = 0; k < n; k++) {
      const a = (k - (n - 1) / 2) * 0.55, d = T * 0.026, w = Math.sin(nu / 700 + k * 1.3) * T * 0.0008;
      this.zetFig(x - nx * Math.cos(a) * d + ux * Math.sin(a) * d * 1.4 + w, y - ny * Math.cos(a) * d + uy * Math.sin(a) * d * 1.4, Math.floor(hash(zaad, k, 474) * KLEDING.length), Math.floor(hash(zaad, k, 475) * 3), hash(zaad, k, 476) < 0.25 ? 0.7 : 1);
    }
  }

  // Stoepkrijt: kleurvlekjes, krabbels en soms een hinkelbaan; bij regen of sneeuw weggespoeld, en hartje winter krijt er niemand.
  stoepkrijt(c, x, y, ux, uy, nx, ny, zaad, nu) {
    const T = this.T, st = this.stand2;
    if (this.bakStand.sn || st.winter || this.plassen || this.wr.regen > 0.2 || this.zoom < DREMPEL.verhaal - 1.5) return;
    c.lineWidth = Math.max(0.5, T * 0.0025);
    for (let k = 0; k < KRIJT.length; k++) {
      c.strokeStyle = KRIJT[k]; c.beginPath();
      for (let j = 0; j < 2; j++) {
        const m = k * 2 + j, u = (hash(zaad, m, 481) - 0.5) * T * 0.06, w = (hash(zaad, m, 482) - 0.5) * T * 0.02, px = x + ux * u + nx * w, py = y + uy * u + ny * w, r = T * (0.004 + 0.005 * hash(zaad, m, 483));
        if (hash(zaad, m, 484) < 0.5) { c.moveTo(px + r, py); c.ellipse(px, py, r, r * 0.6, 0, 0, TAU); }
        else { c.moveTo(px - ux * r, py - uy * r); c.quadraticCurveTo(px + nx * r, py + ny * r, px + ux * r, py + uy * r); }
      }
      c.stroke();
    }
    if (hash(zaad, 485) < 0.5) {
      c.strokeStyle = 'rgba(244,242,234,0.8)'; c.lineWidth = Math.max(0.4, T * 0.0015); c.beginPath();
      for (let k = 0; k < 4; k++) rechthoek(c, x + ux * (k - 1.5) * T * 0.008 + nx * T * 0.012, y + uy * (k - 1.5) * T * 0.008 + ny * T * 0.012, ux, uy, T * 0.004, T * 0.004);
      c.stroke();
    }
    if (!st.dag || !st.droog || !st.verhaal || !this.verhaalTeller()) return;
    for (let k = 0; k < 2; k++) {
      const f = frac(nu / 9000 + hash(zaad, k, 486)), u = (hash(zaad, k, 487) - 0.5) * T * 0.05 + Math.sin(f * TAU) * T * 0.004;
      this.zetFig(x + ux * u, y + uy * u, Math.floor(hash(zaad, k, 488) * KLEDING.length), Math.floor(hash(zaad, k, 489) * 3), 0.62);
    }
  }

  // Bloemenstalletje: emmers vol bloemen onder een luifel, een verkoper erachter; 's winters en 's nachts dicht.
  bloemenstal(c, x, y, ux, uy, nx, ny, zaad, nu) {
    const T = this.T, st = this.stand2;
    if (!st.dag || st.winter) return;
    const l = T * 0.024, b = T * 0.012, kl = this.bakStand.bloem ?? BLOEM[0], o = Math.floor(hash(zaad, 491) * 4);
    this.schaduw(c, x, y, ux, uy, l, b, 0.26);
    c.fillStyle = '#7a5a3a'; c.beginPath(); rechthoek(c, x, y, ux, uy, l, b); c.fill();
    for (let k = 0; k < 6; k++) {
      const u = (-0.75 + 0.3 * k) * l, px = x + ux * u - nx * b * 0.3, py = y + uy * u - ny * b * 0.3;
      c.fillStyle = '#7d8187'; c.beginPath(); stip(c, px, py, T * 0.0042); c.fill();
      c.fillStyle = kl[(k + o) % kl.length]; c.beginPath(); stip(c, px, py - T * 0.003, T * 0.0036); c.fill();
    }
    c.fillStyle = '#3d7a4f'; c.beginPath(); rechthoek(c, x + nx * b * 0.7, y + ny * b * 0.7 - T * 0.012, ux, uy, l * 1.05, b * 0.45); c.fill();
    if (this.zoom >= 11) { c.fillStyle = 'rgba(244,242,234,0.7)'; c.beginPath(); for (let k = -2; k <= 2; k += 2) rechthoek(c, x + nx * b * 0.7 + ux * k * l * 0.3, y + ny * b * 0.7 + uy * k * l * 0.3 - T * 0.012, ux, uy, l * 0.15, b * 0.45); c.fill(); }
    if (!st.verhaal || !this.verhaalTeller()) return;
    this.zetFig(x + nx * b * 1.3, y + ny * b * 1.3, 3, Math.floor(hash(zaad, 492) * 3), 1);
    const f = frac(nu / 30000 + hash(zaad, 493));
    if (f < 0.55) this.zetFig(x - nx * T * 0.02 + ux * (f - 0.27) * T * 0.04, y - ny * T * 0.02 + uy * (f - 0.27) * T * 0.04, Math.floor(hash(zaad, 494) * KLEDING.length), Math.floor(hash(zaad, 495) * 3), 1);
  }

  // IJscofiets: bakfiets met koelbox en parasolletje; in de zomer met wie er een ijsje haalt.
  ijscofiets(c, x, y, ux, uy, nx, ny, zaad, nu) {
    const T = this.T, st = this.stand2;
    if (!st.dag || !st.droog || !st.zomer) return;
    const l = T * 0.018;
    this.schaduw(c, x, y, ux, uy, l * 1.2, T * 0.008, 0.26);
    c.strokeStyle = '#2a2c30'; c.lineWidth = Math.max(0.5, T * 0.002); c.beginPath();
    for (const s of [-1, 1]) { const cx = x + ux * l * s, cy = y + uy * l * s, r = T * 0.006; c.moveTo(cx + r, cy); c.ellipse(cx, cy, r, r * 0.5, Math.atan2(uy, ux), 0, TAU); }
    c.stroke();
    c.fillStyle = '#f2efe6'; c.beginPath(); rechthoek(c, x + ux * l * 0.45, y + uy * l * 0.45 - T * 0.006, ux, uy, l * 0.55, T * 0.009); c.fill();
    c.fillStyle = '#7ab8d8'; c.beginPath(); rechthoek(c, x + ux * l * 0.45, y + uy * l * 0.45 - T * 0.002, ux, uy, l * 0.55, T * 0.0025); c.fill();
    const px = x + ux * l * 0.45, py = y + uy * l * 0.45 - T * 0.035;
    c.strokeStyle = '#8a8d90'; c.lineWidth = Math.max(0.5, T * 0.0018); c.beginPath(); c.moveTo(px, py + T * 0.025); c.lineTo(px, py); c.stroke();
    c.fillStyle = '#f2b8c8'; c.beginPath(); c.arc(px, py, T * 0.017, 0, TAU); c.fill();
    c.fillStyle = '#f8f4ee'; c.beginPath(); for (let i = 0; i < 6; i += 2) { c.moveTo(px, py); c.arc(px, py, T * 0.017, (i * TAU) / 6, ((i + 1) * TAU) / 6); c.closePath(); } c.fill();
    if (!st.verhaal || !this.verhaalTeller()) return;
    this.zetFig(x - ux * l * 0.6 + nx * T * 0.004, y - uy * l * 0.6 + ny * T * 0.004, 2, Math.floor(hash(zaad, 501) * 3), 1);
    const n = Math.floor(tri(nu / 26000 + hash(zaad, 502)) * 3.5);
    for (let k = 0; k < n; k++) this.zetFig(x + ux * l * 0.45 - nx * T * (0.018 + k * 0.012), y + uy * l * 0.45 - ny * T * (0.018 + k * 0.012), Math.floor(hash(zaad, k, 503) * KLEDING.length), Math.floor(hash(zaad, k, 504) * 3), hash(zaad, k, 505) < 0.4 ? 0.7 : 1);
  }

  // Snackkar: staat er alleen 's avonds en 's nachts, met warm licht, dampende bakplaat en een paar late klanten.
  snackkar(c, x, y, ux, uy, nx, ny, zaad, nu) {
    const T = this.T;
    if (this.nacht < 0.45) return;
    const l = T * 0.026, b = T * 0.013;
    this.schaduw(c, x, y, ux, uy, l, b, 0.3);
    c.fillStyle = '#c8432f'; c.beginPath(); rechthoek(c, x, y, ux, uy, l, b); c.fill();
    c.fillStyle = '#e8e2d0'; c.beginPath(); rechthoek(c, x - nx * b * 0.55, y - ny * b * 0.55, ux, uy, l * 0.9, b * 0.35); c.fill();
    c.fillStyle = '#d9a63a'; c.beginPath(); rechthoek(c, x + nx * b * 0.9, y + ny * b * 0.9 - T * 0.014, ux, uy, l * 1.1, b * 0.45); c.fill();
    c.fillStyle = '#2a2c30'; c.beginPath(); for (const s of [-0.6, 0.6]) stip(c, x + ux * l * s - nx * b, y + uy * l * s - ny * b + T * 0.002, T * 0.004); c.fill();
    if (this.zoom >= 11) for (let k = 0; k < 3; k++) {
      const f = frac(nu / 2200 + k / 3 + hash(zaad, 511));
      c.fillStyle = `rgba(235,235,230,${(0.35 * (1 - f)).toFixed(2)})`; c.beginPath(); stip(c, x + ux * (k - 1) * T * 0.01 + Math.sin(f * 5 + k) * T * 0.003, y + uy * (k - 1) * T * 0.01 - T * 0.012 - f * T * 0.03, T * (0.004 + f * 0.006)); c.fill();
    }
    this.zetLicht(x, y - T * 0.015, T * 0.06, WARM, 0.7);
    this.zetLicht(x - nx * T * 0.02, y - ny * T * 0.02, T * 0.08, WARM, 0.25);
    if (this.zoom < DREMPEL.zitten - 0.5 || !this.verhaalTeller()) return;
    this.zetFig(x + nx * b * 1.4, y + ny * b * 1.4, 2, Math.floor(hash(zaad, 512) * 3), 1);
    const n = Math.floor(tri(nu / 33000 + hash(zaad, 513)) * 2.6);
    for (let k = 0; k < n; k++) this.zetFig(x - nx * T * 0.024 + ux * (k - 0.5) * T * 0.016, y - ny * T * 0.024 + uy * (k - 0.5) * T * 0.016, Math.floor(hash(zaad, k, 514) * KLEDING.length), Math.floor(hash(zaad, k, 515) * 3), 1);
  }

  // Duiven die pikken; loopt er iemand langs, dan fladderen ze op en strijken even verderop weer neer.
  // span is de halve breedte van de groep in tegels; (ux,uy) de looprichting, -n de kant van de loper.
  duiven(c, x, y, ux, uy, nx, ny, span, zaad, nu) {
    const T = this.T, st = this.stand2;
    if (!st.dag || this.zoom < DREMPEL.duif - 0.5 || this.n.duiven >= PLAFOND.duiven || !this.verhaalTeller()) return;
    const f = frac(nu / 22000 + hash(zaad, 521)), loopt = f < 0.6, dir = hash(zaad, 522) < 0.5 ? 1 : -1;
    const p = ((f / 0.6) * 2 - 1) * span * 1.8 * dir;
    if (loopt) { const stap = Math.sin(nu / 160) * T * 0.0008; this.zetFig(x + ux * p * T - nx * T * 0.016 + stap, y + uy * p * T - ny * T * 0.016, Math.floor(hash(zaad, 523) * KLEDING.length), Math.floor(hash(zaad, 524) * 3), 1); }
    const n = 5 + Math.floor(hash(zaad, 525) * 5), r = Math.max(0.7, T * 0.004);
    for (let k = 0; k < n && this.n.duiven < PLAFOND.duiven; k++) {
      this.n.duiven++;
      const u = (hash(zaad, k, 526) - 0.5) * 2 * span, w = (hash(zaad, k, 527) - 0.5) * T * 0.014;
      const d = loopt ? Math.abs(u - p) / span : 9, op = clamp(1.4 - d * 2.2, 0, 1);
      const weg = op * (u >= p ? 1 : -1) * T * 0.02, hoog = op * T * 0.03;
      const px = x + ux * (u * T + weg) + nx * w, py = y + uy * (u * T + weg) + ny * w, by = py - hoog;
      c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); stip(c, px + r * 0.5, py + r * 0.6, r * 0.9); c.fill();
      if (op > 0.15) {
        const vl = Math.sin(nu / 60 + k) * r * 1.6;
        c.strokeStyle = '#8a8f96'; c.lineWidth = Math.max(0.5, r * 0.7); c.beginPath(); c.moveTo(px - r * 2, by - vl); c.lineTo(px, by); c.lineTo(px + r * 2, by - vl); c.stroke();
      } else {
        const pik = Math.sin(nu / 140 + k * 2.1) > 0.7 ? r * 0.5 : 0;
        c.fillStyle = '#8a8f96'; c.beginPath(); c.ellipse(px, by, r * 1.2, r * 0.75, Math.atan2(uy, ux), 0, TAU); c.fill();
        c.fillStyle = '#5e646c'; c.beginPath(); stip(c, px + ux * r * 1.1, by + uy * r * 1.1 - r * 0.4 + pik, r * 0.55); c.fill();
      }
    }
  }

  // Verhuizing: een bestelbus op de berm met de achterdeuren open, dozen op de stoep en twee sjouwers.
  verhuizing(c, x, y, ux, uy, nx, ny, zaad, nu) {
    const T = this.T, st = this.stand2;
    const bx = x - nx * T * (STROOK - BERM), by = y - ny * T * (STROOK - BERM), l = T * 0.042, b = T * 0.015;
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); rechthoek(c, bx + T * 0.01, by + T * 0.012, ux, uy, l, b); c.fill();
    c.fillStyle = '#e8e6de'; c.beginPath(); rechthoek(c, bx, by, ux, uy, l, b); c.fill();
    c.fillStyle = '#d9a63a'; c.beginPath(); rechthoek(c, bx - ux * l * 0.15, by - uy * l * 0.15, ux, uy, l * 0.6, b * 0.2); c.fill();
    c.fillStyle = 'rgba(30,40,50,0.8)'; c.beginPath(); rechthoek(c, bx + ux * l * 0.82, by + uy * l * 0.82, ux, uy, l * 0.08, b * 0.85); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); rechthoek(c, bx - nx * b * 0.5, by - ny * b * 0.5, ux, uy, l * 0.8, b * 0.3); c.fill();
    if (!st.dag) return;
    if (this.zoom >= 11) {
      c.strokeStyle = '#c9c7bf'; c.lineWidth = Math.max(0.6, T * 0.0035); c.beginPath();
      for (const s of [-1, 1]) { c.moveTo(bx - ux * l + nx * b * s, by - uy * l + ny * b * s); c.lineTo(bx - ux * l * 1.3 + nx * b * s * 1.3, by - uy * l * 1.3 + ny * b * s * 1.3); }
      c.stroke();
    }
    const doos = (px, py, s) => { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(px - s + T * 0.004, py - s + T * 0.005, s * 2, s * 2); c.fillStyle = '#b8895a'; c.fillRect(px - s, py - s, s * 2, s * 2); c.fillStyle = '#d0a070'; c.fillRect(px - s, py - s, s * 2, s * 0.6); if (this.zoom >= 12) { c.fillStyle = 'rgba(80,60,40,0.5)'; c.fillRect(px - s * 0.15, py - s, s * 0.3, s * 2); } };
    const n = 3 + Math.floor(tri(nu / 60000 + hash(zaad, 531)) * 3);
    for (let k = 0; k < n; k++) { const u = ((k % 3) - 1) * T * 0.012, up = Math.floor(k / 3) * T * 0.008; doos(x - ux * T * 0.01 + ux * u, y - uy * T * 0.01 + uy * u - up, T * 0.0055); }
    if (!st.verhaal || !this.verhaalTeller()) return;
    const sx = x - ux * T * 0.01, sy = y - uy * T * 0.01, ex = bx - ux * l * 1.2, ey = by - uy * l * 1.2;
    for (let k = 0; k < 2; k++) {
      const f = tri(nu / 8000 + k * 0.5 + hash(zaad, 532)), px = sx + (ex - sx) * f, py = sy + (ey - sy) * f;
      this.zetFig(px, py, k ? 0 : 7, Math.floor(hash(zaad, k, 533) * 3), 1);
      if (frac(nu / 16000 + k * 0.5 + hash(zaad, 532) * 0.5) < 0.5) doos(px, py - T * 0.012, T * 0.0045);
    }
  }

  // Postbode: fietst over het fietspad naar de brievenbus, leegt hem en fietst door.
  postbode(c, x, y, ux, uy, nx, ny, zaad, nu) {
    const T = this.T, st = this.stand2;
    if (!st.dag || this.zoom < DREMPEL.duif || this.wr.sneeuw > 0.5) return;
    const f = frac(nu / 55000 + hash(zaad, 541));
    if (f > 0.85 || !this.verhaalTeller()) return;
    const dir = hash(zaad, 542) < 0.5 ? 1 : -1, fp = (0.13 - BERM) * T; // de bus staat op de berm, het fietspad ligt erachter
    let u, staat = false;
    if (f < 0.35) u = -(1 - f / 0.35) * T * 0.5 * dir; else if (f < 0.55) { u = T * 0.012 * dir; staat = true; } else u = ((f - 0.55) / 0.3) * T * 0.5 * dir;
    const fx = x + ux * u + nx * fp, fy = y + uy * u + ny * fp, hx = ux * dir, hy = uy * dir, l = T * 0.011;
    c.strokeStyle = '#2a2c30'; c.lineWidth = Math.max(0.5, T * 0.002); c.beginPath(); for (const s of [-1, 1]) { const cx = fx + hx * l * s, cy = fy + hy * l * s, r = T * 0.0062; c.moveTo(cx + r, cy); c.ellipse(cx, cy, r, r * 0.5, Math.atan2(hy, hx), 0, TAU); } c.stroke();
    c.strokeStyle = '#d9a63a'; c.lineWidth = Math.max(0.6, T * 0.003); c.beginPath(); c.moveTo(fx - hx * l, fy - hy * l); c.lineTo(fx, fy - T * 0.004); c.lineTo(fx + hx * l, fy + hy * l); c.stroke();
    c.fillStyle = '#c8432f'; c.beginPath(); rechthoek(c, fx - hx * l * 0.8, fy - hy * l * 0.8 - T * 0.003, hx, hy, T * 0.004, T * 0.005); c.fill();
    if (staat) this.zetFig(x + nx * T * 0.012, y + ny * T * 0.012, 0, Math.floor(hash(zaad, 543) * 3), 1);
    else this.zetFig(fx, fy - T * 0.004, 0, Math.floor(hash(zaad, 543) * 3), 1);
  }

  // Bushalte in de stad: overdag een paar wachtenden; de helft is ook nachtbushalte, met een verlicht reclamevlak
  // en 's nachts iemand die nog wacht.
  halteWacht(c, x, y, ux, uy, nx, ny, zaad, nu) {
    const T = this.T, st = this.stand2, nachtbus = hash(zaad, 551) < 0.5;
    if (this.nacht > 0.05 && nachtbus) this.zetLicht(x - ux * T * 0.026, y - uy * T * 0.026 - T * 0.008, T * 0.022, NEON[Math.floor(hash(zaad, 552) * NEON.length)], 0.6);
    if (this.zoom < DREMPEL.zitten - 0.5) return;
    const n = st.dag ? Math.floor(tri(nu / 40000 + hash(zaad, 553)) * 3.4) : nachtbus && this.nacht > 0.5 ? 1 : 0;
    if (!n || !this.verhaalTeller()) return;
    for (let k = 0; k < n; k++) {
      const u = -T * (0.042 + k * 0.012), w = Math.sin(nu / 900 + k) * T * 0.0008;
      this.zetFig(x + ux * u + w - nx * T * 0.016, y + uy * u - ny * T * 0.016, Math.floor(hash(zaad, k, 554) * KLEDING.length), Math.floor(hash(zaad, k, 555) * 3), 1);
    }
  }

  // ---------- verhaaltjes in de vakjes ----------

  // Glazenwasser op een ladder tegen de kiosk: de wisser gaat heen en weer, de emmer staat beneden.
  glazenwasser(c, x, y, nu, zaad) {
    const T = this.T, f = frac(nu / 90000 + hash(zaad, 561));
    if (f > 0.7 || !this.verhaalTeller()) return;
    const h = T * 0.05;
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = Math.max(0.5, T * 0.002); c.beginPath(); c.moveTo(x, y); c.lineTo(x + h * SCHUIN * 0.4, y + h * SCHUIN * 0.4); c.stroke();
    c.strokeStyle = '#b9bcc0'; c.lineWidth = Math.max(0.5, T * 0.0018); c.beginPath();
    for (const s of [-1, 1]) { c.moveTo(x + s * T * 0.004, y); c.lineTo(x + s * T * 0.003, y - h); }
    for (let k = 1; k < 6; k++) { c.moveTo(x - T * 0.004, y - (k * h) / 6); c.lineTo(x + T * 0.004, y - (k * h) / 6); }
    c.stroke();
    c.fillStyle = '#2f6d9a'; c.beginPath(); stip(c, x + T * 0.012, y + T * 0.002, T * 0.004); c.fill();
    c.fillStyle = 'rgba(240,248,252,0.8)'; c.beginPath(); stip(c, x + T * 0.012, y + T * 0.001, T * 0.0025); c.fill();
    const op = h * (0.45 + 0.1 * Math.sin(nu / 3000)), wis = Math.sin(nu / 380 + zaad) * T * 0.008;
    this.zetFig(x, y - op, 1, Math.floor(hash(zaad, 562) * 3), 1);
    c.strokeStyle = '#2a2c30'; c.lineWidth = Math.max(0.5, T * 0.0018); c.beginPath(); c.moveTo(x, y - op - T * 0.004); c.lineTo(x + wis, y - op - T * 0.014); c.moveTo(x + wis - T * 0.004, y - op - T * 0.014); c.lineTo(x + wis + T * 0.004, y - op - T * 0.014); c.stroke();
  }

  // In het park: een hond blaft naar een kat die in een boom is gevlucht; het baasje staat erbij met de riem.
  hondKat(c, X, Y, nu, zaad) {
    const T = this.T, [bx, by, br] = PK.bomen[6];
    if (this.n.honden >= PLAFOND.honden || !this.verhaalTeller()) return;
    this.n.honden++;
    const tx = X + bx * T, ty = Y + by * T, blaft = frac(nu / 60000 + hash(zaad, 571)) < 0.7;
    const kx = tx - br * T * 0.3, ky = ty - br * T * 1.2, kl = KAT[Math.floor(hash(zaad, 572) * KAT.length)];
    c.fillStyle = kl; c.beginPath(); c.ellipse(kx, ky, T * 0.005, T * 0.004, 0, 0, TAU); c.fill();
    c.beginPath(); stip(c, kx - T * 0.003, ky - T * 0.005, T * 0.0032); c.fill();
    c.beginPath(); c.moveTo(kx - T * 0.006, ky - T * 0.007); c.lineTo(kx - T * 0.005, ky - T * 0.011); c.lineTo(kx - T * 0.003, ky - T * 0.008); c.moveTo(kx - T * 0.001, ky - T * 0.008); c.lineTo(kx, ky - T * 0.011); c.lineTo(kx + T * 0.001, ky - T * 0.007); c.fill();
    c.strokeStyle = kl; c.lineWidth = Math.max(0.5, T * 0.0018); c.beginPath(); c.moveTo(kx + T * 0.004, ky); c.quadraticCurveTo(kx + T * 0.009, ky + T * 0.004, kx + T * 0.008 + Math.sin(nu / 300) * T * 0.003, ky + T * 0.011); c.stroke();
    const sp = blaft ? Math.max(0, Math.sin(nu / 160)) * T * 0.006 : 0;
    const hx = tx - T * 0.03, hy = ty + T * 0.012, hk = HOND[Math.floor(hash(zaad, 573) * HOND.length)];
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.ellipse(hx + T * 0.003, hy + T * 0.004, T * 0.009, T * 0.004, 0, 0, TAU); c.fill();
    c.fillStyle = hk; c.beginPath(); c.ellipse(hx, hy - sp * 0.5, T * 0.009, T * 0.0045, -0.2 - (sp / T) * 30, 0, TAU); c.fill();
    c.beginPath(); stip(c, hx + T * 0.009, hy - T * 0.003 - sp, T * 0.0045); c.fill();
    c.strokeStyle = hk; c.lineWidth = Math.max(0.5, T * 0.002); c.beginPath(); c.moveTo(hx - T * 0.008, hy - sp * 0.3); c.lineTo(hx - T * 0.012, hy - T * 0.006 - sp * 0.3 + Math.sin(nu / 90) * T * 0.002); c.stroke();
    if (blaft && frac(nu / 640) < 0.5) {
      // geblaf als kleine boogjes bij de snuit
      c.strokeStyle = 'rgba(250,250,250,0.7)'; c.lineWidth = Math.max(0.4, T * 0.0014); c.beginPath();
      for (let k = 1; k <= 2; k++) { const r = T * 0.004 * k, cx = hx + T * 0.012, cy = hy - T * 0.006 - sp; c.moveTo(cx + Math.cos(-1.1) * r, cy + Math.sin(-1.1) * r); c.arc(cx, cy, r, -1.1, 0.1); }
      c.stroke();
    }
    const ox = hx - T * 0.035, oy = hy + T * 0.006;
    c.strokeStyle = '#2a2622'; c.lineWidth = Math.max(0.4, T * 0.0012); c.beginPath(); c.moveTo(ox + T * 0.003, oy - T * 0.005); c.quadraticCurveTo((ox + hx) / 2, oy + T * 0.004, hx + T * 0.006, hy - T * 0.004 - sp); c.stroke();
    this.zetFig(ox, oy, Math.floor(hash(zaad, 574) * KLEDING.length), Math.floor(hash(zaad, 575) * 3), 1);
  }

  // Op het speelplekje: een kind bouwt een zandkasteel dat steeds hoger wordt en dan weer platgaat; twee
  // kinderen op de wip, een ouder op het bankje.
  speelplek(c, X, Y, nu, zaad) {
    const T = this.T, [z0, z1, z2, z3] = QS.zand;
    if (!this.verhaalTeller()) return;
    const zx = X + ((z0 + z2) / 2) * T + T * 0.02, zy = Y + ((z1 + z3) / 2) * T + T * 0.01;
    const fase = Math.floor(frac(nu / 48000 + hash(zaad, 581)) * 6);
    if (!this.bakStand.sn && fase < 5) {
      const w = T * (0.008 + Math.min(fase, 3) * 0.003), h = T * (0.004 + Math.min(fase, 3) * 0.003);
      c.fillStyle = '#b89a5c'; c.fillRect(zx - w, zy - h, w * 2, h);
      c.fillStyle = '#d8bf82'; c.fillRect(zx - w, zy - h - w * 0.4, w * 2, w * 0.4);
      if (fase >= 2) for (const s of fase >= 4 ? [-1, -0.33, 0.33, 1] : [-1, 1]) {
        const tx = zx + s * w * 0.85, th = T * 0.006;
        c.fillStyle = '#b89a5c'; c.fillRect(tx - T * 0.0025, zy - h - th, T * 0.005, th);
        c.fillStyle = '#e2cf9a'; c.beginPath(); stip(c, tx, zy - h - th, T * 0.0028); c.fill();
      }
    }
    c.fillStyle = hash(zaad, 582) < 0.5 ? '#c8432f' : '#2f6d9a'; c.beginPath(); stip(c, zx + T * 0.02, zy + T * 0.004, T * 0.0035); c.fill();
    const st = this.stand2 ?? { dag: this.nacht < 0.5 };
    if (!st.dag || this.wr.regen > 0.3) return;
    this.zetFig(zx - T * 0.016, zy + T * 0.006 + Math.sin(nu / 420) * T * 0.0006, Math.floor(hash(zaad, 583) * KLEDING.length), Math.floor(hash(zaad, 584) * 3), 0.62);
    const [wx, wy] = QS.wip, wip = Math.sin(nu / 700 + zaad) * T * 0.006;
    for (const s of [-1, 1]) this.zetFig(X + (wx + s * 0.058) * T, Y + (wy - 0.016) * T - wip * s, Math.floor(hash(zaad, s + 2, 585) * KLEDING.length), Math.floor(hash(zaad, s + 2, 586) * 3), 0.62);
    this.zetFig(X + QS.bank[0] * T, Y + (QS.bank[1] - 0.003) * T, Math.floor(hash(zaad, 587) * KLEDING.length), Math.floor(hash(zaad, 588) * 3), 1);
  }

  // ---------- leven op pleinen en in parken ----------

  tekenLeven(c, nu) {
    const Tw = this.geo.T, T = this.T, sc = this.sc, ox = this.ox, oy = this.oy, z = this.zoom, sz = this.sz;
    const dag = this.nacht < 0.6, droog = this.wr.regen < 0.3 && this.wr.sneeuw < 0.3;
    const fontein = z >= DREMPEL.fontein - 0.5 && !this.fonteinUit, aF = smooth(DREMPEL.fontein - 0.5, DREMPEL.fontein + 0.3, z);
    const mensen = z >= DREMPEL.mensen - 0.5, aM = smooth(DREMPEL.mensen - 0.5, DREMPEL.mensen + 0.3, z);
    const ijsco = z >= DREMPEL.ijsco - 0.5 && sz.zomer > 0.5 && dag && droog;
    const nachtLicht = this.nacht > 0.05, verhaal = z >= DREMPEL.verhaal - 0.5;
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
        if (verhaal) {
          c.globalAlpha = smooth(DREMPEL.verhaal - 0.5, DREMPEL.verhaal + 0.3, z);
          if (dag && droog && !this.kerst && hash(v.t, 211) < 0.7) this.muzikant(c, ...P(PL_MUZIEK[0], PL_MUZIEK[1]), 1, 0, 0, -1, (v.zaad * 3 + 1) | 0, nu);
          if (dag && droog && hash(v.t, 212) < 0.6) this.glazenwasser(c, ...P(PL.K[0] + 0.02, PL.K[1] + PL.K[2] * 0.8 + 0.006), nu, v.zaad); // tegen de voorgevel, niet op het dak
          if (dag) this.duiven(c, ...P(PL_DUIF[0], PL_DUIF[1]), 1, 0, 0, 1, 0.07, v.zaad + 7, nu);
        }
      } else if (v.soort === PARK) {
        const [vx, vy, vrx, vry] = PK.V;
        if (fontein && this.n.fonteinen < PLAFOND.fonteinen) { this.n.fonteinen++; c.globalAlpha = aF; this.fontein(c, X + vx * T, Y + vy * T, vry * T * 0.7, nu, v.zaad, 0); }
        if (z >= 8 && dag && !this.ijs && sz.winter < 0.5) { c.globalAlpha = smooth(8, 8.8, z); this.eenden(c, X + vx * T, Y + vy * T, vrx * T, vry * T, nu, v.zaad); }
        if (ijsco && this.n.ijscokarren < PLAFOND.ijscokarren) { const [x, y] = naastPad(PK.ijsco[0], PK.ijsco[1], PK.ijsco[2], 0.05); c.globalAlpha = aM; this.ijscokar(c, ...P(x, y), nu, v.zaad); }
        if (z >= DREMPEL.klein - 0.5 && hash(v.t, 41) < 0.7 && this.n.katten < PLAFOND.katten) { c.globalAlpha = smooth(DREMPEL.klein - 0.5, DREMPEL.klein + 0.3, z); this.kat(c, X, Y, nu, v.zaad); }
        if (verhaal && dag && hash(v.t, 213) < 0.6) { c.globalAlpha = smooth(DREMPEL.verhaal - 0.5, DREMPEL.verhaal + 0.3, z); this.hondKat(c, X, Y, nu, v.zaad); }
      } else {
        if (mensen && this.terras && dag && droog && !this.kerst) for (let q = 0; q < 4; q++) if (v.kw[q] === Q_PLEIN) this.gasten(v, QP.tafels, X + KWART[q][0] * T, Y + KWART[q][1] * T, nu, q + 1);
        if (verhaal) for (let q = 0; q < 4; q++) {
          const KX = X + KWART[q][0] * T, KY = Y + KWART[q][1] * T;
          c.globalAlpha = smooth(DREMPEL.verhaal - 0.5, DREMPEL.verhaal + 0.3, z);
          if (v.kw[q] === Q_SPEEL) this.speelplek(c, KX, KY, nu, v.zaad + q);
          else if (v.kw[q] === Q_PLEIN && hash(v.t, q, 214) < 0.45) this.stoepkrijt(c, KX + QP_KRIJT[0] * T, KY + QP_KRIJT[1] * T, 1, 0, 0, 1, (v.zaad * 5 + q) | 0, nu);
        }
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

  zetFig(x, y, kleding, huid, maat = 1) {
    if (this.nFig >= PLAFOND.mensen || !this.opScherm(x, y, 10)) return;
    const o = this.nFig++ * 5, f = this.fig;
    f[o] = x; f[o + 1] = y; f[o + 2] = kleding; f[o + 3] = huid; f[o + 4] = maat;
  }

  // Alle figuren in een paar vullingen: schaduw, lijf per kleur, hoofdjes per huidskleur.
  tekenFiguren(c) {
    const n = this.nFig, f = this.fig, T = this.T;
    this.n.mensen = n;
    if (!n) return;
    const r = Math.max(0.8, T * 0.0055), hr = Math.max(0.6, T * 0.0036);
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath();
    for (let i = 0; i < n; i++) { const m = f[i * 5 + 4]; stip(c, f[i * 5] + r * 0.6 * m, f[i * 5 + 1] + r * 0.7 * m, r * m); }
    c.fill();
    for (let kl = 0; kl < KLEDING.length; kl++) {
      c.fillStyle = KLEDING[kl]; c.beginPath();
      let iets = false;
      for (let i = 0; i < n; i++) if (f[i * 5 + 2] === kl) { iets = true; stip(c, f[i * 5], f[i * 5 + 1], r * f[i * 5 + 4]); }
      if (iets) c.fill();
    }
    for (let h = 0; h < HUID.length; h++) {
      c.fillStyle = HUID[h]; c.beginPath();
      let iets = false;
      for (let i = 0; i < n; i++) if (f[i * 5 + 3] === h) { iets = true; const m = f[i * 5 + 4]; stip(c, f[i * 5], f[i * 5 + 1] - r * 0.9 * m, hr * (0.4 + 0.6 * m)); }
      if (iets) c.fill();
    }
  }

  // Licht uit de etalages bij de stadsingang, op de stoep.
  zetEtalages() {
    const E = this.etalages, T = this.T, sc = this.sc, Tw = this.geo.T;
    for (let i = 0; i < E.length; i += 2) {
      if (!this.inBeeld(E[i], E[i + 1], Tw * 0.1)) continue;
      const x = E[i] * sc + this.ox, y = E[i + 1] * sc + this.oy;
      this.zetLicht(x, y, T * 0.07, WARM, 0.3);
      // lichtreclame zonder tekst: een gekleurde gloed boven sommige etalages
      const h = hash(Math.floor(E[i] * 7), Math.floor(E[i + 1] * 7), 221);
      if (h < 0.45 && this.zoom >= 7) this.zetLicht(x, y - T * 0.03, T * 0.025, NEON[Math.floor(h * 13) % NEON.length], 0.45);
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
      randen: this.randen.length / RS, stoep: this.stoep.length / ST, stoepPerSoort: this.stoepPerSoort(),
      speelplekjes: this.vakjes.reduce((t, v) => t + v.kw.filter((k) => k === Q_SPEEL).length, 0),
    };
  }

  // Aantal stoepdingen per soort, op naam (STOEP_NAAM).
  stoepPerSoort() {
    const uit = {};
    for (const nm of STOEP_NAAM) uit[nm] = 0;
    for (let i = 6; i < this.stoep.length; i += ST) uit[STOEP_NAAM[this.stoep[i]]]++;
    return uit;
  }

  // De stoepdingen zelf (wereld), alleen-lezen: [{x, y, nx, ny, soort}] voor tests.
  stoepLijst() {
    const L = this.stoep, uit = [];
    for (let i = 0; i < L.length; i += ST) uit.push({ x: L[i], y: L[i + 1], ux: L[i + 2], uy: L[i + 3], nx: L[i + 4], ny: L[i + 5], soort: STOEP_NAAM[L[i + 6]] });
    return uit;
  }

  // De stoepstroken langs de stadsrand (wereld), alleen-lezen: [{x0, y0, x1, y1, zijde}].
  randLijst() {
    const R = this.randen, uit = [];
    for (let i = 0; i < R.length; i += RS) uit.push({ x0: R[i], y0: R[i + 1], x1: R[i + 2], y1: R[i + 3], zijde: R[i + 4] });
    return uit;
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
