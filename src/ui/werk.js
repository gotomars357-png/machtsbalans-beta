// Het land aan het werk (pakket D van de detailronde): buiten de steden laat het platteland zien dat de economie
// draait. Op de akkers van terrein.js gaat het werk het jaar rond: in de vroege lente ploegen tractoren verse voren
// met meeuwen erachter, daarna zaaien ze; in een droge zomer staan er haspels die waterbogen over het gewas
// sproeien; na de oogst liggen er stoppels en zwaden, rijdt een balenpers en blijven ronde of rechthoekige
// strobalen liggen; op de wei liggen wit ingepakte kuilbalen; mesthopen dampen in de kou; 's winters is het stil en
// schuift een enkele tractor de sneeuw van een erfweg. Fruit en tuinbouw: plukkers met ladders en kisten in de
// boomgaarden, bijenkasten bij de bloesem, druivenplukkers in de wijngaard, kassen die de lucht weerspiegelen en
// 's nachts oranje gloeien, bloembollenvelden in kleurige banen in de lente. Bos: kaalslag met stronken en
// sporen, stapels stammen met een houtvrachtwagen, bosarbeiders, herplant in rijen en een zagerij bij landen met
// houtkap. Delfstoffen: een dagbouwgroeve met getrapte wanden, dumpers en een graafmachine naast elke mijn, en
// jaknikkers die op en neer knikken rond olievelden. Op de erven: kleine windmotoren, hooibergen, kippen, een
// waakhond, en een melkwagen, graanwagen of bestelbus die over de erfweg komt.
// Detail komt trapsgewijs op (zie DREMPEL): 4-6 groeven, kaalslag, voren, bollenbanen en kassen; 6-10 machines,
// balen, wagens, molens en hooibergen; 10-14 mensen, hekken, kisten, kippen, de hond en de bijen.
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Waar iets ligt volgt uit de kaart, de percelen
// en boerderijen van terrein.js, de gebouwen en vaste hashes; de klok stuurt alleen beweging. Geen Math.random,
// geen Date. Licht uit het noordwesten: schaduwen vallen naar het zuidoosten, hoge dingen staan recht omhoog.
// Botst niet met andere lagen: de tractoren, maaidorsers, kuddes en herten van leven.js houden hun vakjes (zelfde
// hashes), wegen, spoor, havens en gebouwen blijven vrij (een botsraster zoals in kust.js), grensstroken blijven
// voor grens.js, en paden, hutten en liften van natuur.js worden ontweken.

import { seizoen, weer, wind } from './seizoen.js';
import { maakBasis, TerreinLaag, kenmerkenVoorTegel, KENMERK, perceelHoek } from './terrein.js';

// ---------- gedeelde hulpjes (eigen kopie, zie inzoom-spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
const tri = (v) => 1 - Math.abs(1 - 2 * frac(v));
const TAU = Math.PI * 2;
// Hoek van a naar b over de kortste kant, deel w (0..1) van de weg.
const wrapHoek = (a) => (frac(a / TAU + 0.5) - 0.5) * TAU;
const hoekNaar = (a, b, w) => a + wrapHoek(b - a) * w;
const S = 0.566; // schaduwlengte per hoogte-eenheid (zon op ~45° in het noordwesten, zelfde als infra.js en kust.js)

// Canvasfabriek: in de browser een echt canvas, in tests een nep. Raakt document pas aan als er gebakken wordt.
const standaardFabriek = (w, h) => (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null);
let fabriek = standaardFabriek;
export function zetCanvasFabriek(fn) { fabriek = fn ?? standaardFabriek; }

// ---------- plafonds en drempels ----------

// Hooguit zoveel per beeld (wat in beeld is); de wereldlijsten zelf zijn ook begrensd (MAX_*).
export const PLAFOND = {
  velden: 140, machines: 48, balen: 260, meeuwen: 48, sproeiers: 8, bollen: 30, kassen: 40, plukkers: 48, kisten: 60, bijenkasten: 40,
  mesthopen: 20, vogelverschrikkers: 12, hekken: 24, erven: 40, lanen: 24, kippen: 120, honden: 16, hooibergen: 16, molens: 16,
  wagens: 10, schuivers: 4, kaalslagen: 16, stronken: 220, boompjes: 260, stapels: 20, zagerijen: 4, groeven: 6, dumpers: 12,
  graafmachines: 6, jaknikkers: 24, lichten: 220, bakken: 2,
};
// Vanaf welke zoom iets verschijnt.
export const DREMPEL = { grof: 4, kas: 4.5, jaknik: 4.5, stapel: 5.5, machine: 5.5, wagen: 6, baal: 6.5, mest: 7, sproei: 7, meeuw: 7, molen: 7.5, hooi: 7.5, stronk: 7, schrik: 9, voren: 9, mens: 10, bij: 10, hek: 10.5, hond: 11, klein: 12, kleinst: 13 };
const MAX_VELDEN = 2600, MAX_ERVEN = 420, MAX_KAAL = 140, MAX_GROEF = 32, MAX_JAK = 72, MAX_ZAAG = 12;
const MAX_SPRITES = 24, MAX_BYTES = 24 * 1024 * 1024, MAX_P = 48;

const W = 1000, H = 620;
const RC = 2, RW = W / RC, RH = H / RC; // botsraster: vakjes van 2 eenheden
const INFRA = 1, GEBOUW = 2, WERK = 4, GRENS = 8, NATUUR = 16;
const ALLES = INFRA | GEBOUW | WERK | GRENS | NATUUR;

// percelen en kenmerken uit terrein.js (zelfde nummering)
const PERCEEL = 6, BOERDERIJ = 11, BAAL = 14, BERGMEER = 16, STAP = 6;
const GRAAN = 0, GROEN = 1, PLOEG = 2, KOOLZAAD = 3, WEI = 4, BOOMGAARD = 5, WIJN = 6, KAS = 7, MAIS = 8, BRAAK = 9;
const HAAGRAND = 0;

// rollen van een perceel (bits)
const R_PLOEG = 1, R_ZAAI = 2, R_SPROEI = 4, R_BALEN = 8, R_KUIL = 16, R_MEST = 32, R_BOL = 64, R_PLUK = 128, R_DRUIF = 256, R_KAS = 512, R_SCHRIK = 1024, R_HEK = 2048, R_STOPPEL = 4096, R_BIJ = 8192;

// voertuigen: soort, aanbouw en lading
const TREKKER = 0, VRACHT = 1, BESTEL = 2, DUMPER = 3, SMALSPOOR = 4, MAAIER = 5;
const A_GEEN = 0, A_PLOEG = 1, A_ZAAI = 2, A_PERS = 3, A_SCHUIF = 4, A_KISTEN = 5, A_MAAI = 6, A_WAGEN = 7, A_MAAIBALK = 8;
const L_GEEN = 0, L_MELK = 1, L_GRAAN = 2, L_HOUT = 3, L_GROND = 4, L_BALEN = 5;
const VW = 11; // x, y, hx, hy, soort, kleur, aanbouw, lading, schaal, dekking (0..1), hoe vol (0..1)
const TREKKER_KLEUR = ['#3d7a3a', '#b8322a', '#2f5c9a', '#d98a1f'];
const WAGEN_KLEUR = ['#e8e6df', '#2f5d8a', '#7a2a24', '#d9d4c4'];
const DUMPER_KLEUR = '#d9a41f';
const MAAIER_KLEUR = ['#3f8a3a', '#c8402e'];
const KLEUREN = [...TREKKER_KLEUR, ...WAGEN_KLEUR, DUMPER_KLEUR, ...MAAIER_KLEUR];
const K_MAAIER = TREKKER_KLEUR.length + WAGEN_KLEUR.length + 1; // eerste kleur van de maaidorsers in KLEUREN

// Samenhang (C11): een speldag duurt op tempo 1 één seconde, de lichtcyclus drie minuten. Werk op het land loopt
// daarom op een doorlopende dag (dagF: de speldag plus het deel dat er al van verstreken is) en rijdt in eenheden
// per dag. Machines komen over een vaste route van het erf of van de weg en gaan daarlangs terug; wat op de akker
// verandert, verandert achter de machine. Tussen dag en nacht en tussen seizoenen gaat alles geleidelijk.
const RIJ = 5; // rijsnelheid over erf, veldweg en land, eenheden per speldag (een auto van leven.js rijdt op tempo 1 zo'n 19)
const V_PLOEG = 1.1, V_ZAAI = 1.5, V_MAAI = 1.0, V_PERS = 1.4, V_RAAP = 1.8, V_KUIL = 1.3; // werksnelheid op de akker
const MAX_DUUR = { ploeg: 28, zaai: 14, maai: 8, pers: 8, raap: 8, kuil: 6 }; // grote percelen gaan sneller
const BRON_GEEN = 0, BRON_ERF = 1, BRON_WEG = 2;
// taken op een perceel (de soort machine en wat er achter hem verandert)
const T_PLOEG = 1, T_ZAAI = 2, T_MAAI = 3, T_PERS = 4, T_RAAP = 5, T_KMAAI = 6, T_KPERS = 7, T_KRAAP = 8, T_BRENG = 9, T_PLUK = 10, T_DRUIF = 11;
// wat een perceel bij een nieuwe keuze houdt als het precies zo blijft liggen (kiesRoutes)
const VAST_VELD = ['lx', 'ly', 'px', 'py', 'e0x', 'e0y', 'x0x', 'x0y', 'pkx', 'pky', 'pkhx', 'pkhy', 'pax', 'pay', 'route', 'rn', 'rlen', 'bron', 'taken', 'metPers'];
const TAAK = 5; // per taak in v.taken: soort, begin van het werk (dag in het jaar), duur, rijtijd heen, rijtijd terug (dagen)
// Plek van de geparkeerde trekker op het erf en de uitgang naar het noorden (erfcoördinaten u langs co, v dwars).
const ERF_P = [0.55, -1.25], ERF_N = [0.55, -2.15];
// het kippenhok in de hoek van het erf, naast de moestuin
const ERF_HOK = [-2.0, 1.3];
// Lichtfase uit de klok, precies als tekenNacht in map.js; 0 is midden op de dag, 0,5 middernacht.
const faseOp = (nu) => ((nu / 1000) % 180) / 180;
const BOL_KLEUR = ['#d8322a', '#f2c94c', '#f08cb4', '#8a4fb0', '#f4f1ea', '#ef7d2a'];
const KLEDING = ['#c0392b', '#2e86c1', '#f0b429', '#ecefe9', '#34495e', '#2f9e5b', '#e07a2a'];
const KIP_KLEUR = ['#f2efe6', '#a8643a', '#2a2622'];
const HOND_KLEUR = ['#5a3e2a', '#1f1c1a', '#c9a46a'];
const KAST_KLEUR = ['#e8d27a', '#6f9fc0', '#e6e2d6', '#c8664a'];
const JAK_KLEUR = ['#c8a03a', '#3f5f7a', '#8a3a2a'];
const AK = ['', '#5f6468', '#4f6f8a', '#c8402e', '#e08a1a', '#8a6a48', '#d9b020', '#7a6448', '#6a6e72']; // aanbouw: ploeg, zaaimachine, pers, schuif, kistenwagen, maaibord, balenwagen, maaibalk
const LK = ['', '#cfd3d6', '#d9b84a', '#7a5a3a', '#8a7058', '#d6b85a']; // lading: melk, graan, hout, grond, balen
const BAAL_KLEUR = ['#d6b85a', '#dcc06a', '#eef0ea', '#dfe8dc']; // rond stro, pak stro, kuil wit, kuil licht

// lichtsoorten
const WARM = 0, ORANJE = 1, AMBER = 2, WIT = 3;
const LICHTKLEUR = [[255, 200, 120], [255, 140, 50], [255, 170, 40], [240, 246, 255]];
const LICHT = 5; // x, y, r (wereld), soort, sterkte

function stip(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
// Rechthoek met halve lengte l langs (hx, hy) en halve breedte w.
function rechthoek(c, x, y, hx, hy, l, w) {
  const px = -hy * w, py = hx * w, lx = hx * l, ly = hy * l;
  c.moveTo(x + lx + px, y + ly + py); c.lineTo(x + lx - px, y + ly - py); c.lineTo(x - lx - px, y - ly - py); c.lineTo(x - lx + px, y - ly + py); c.closePath();
}

// Lengte van een polylijn [x0, y0, x1, y1, ...] (de eerste n punten).
function padLengte(pts, n = pts.length / 2) {
  let l = 0;
  for (let i = 1; i < n; i++) l += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  return l;
}

// Maat van gebakken bitmaps in stappen van een kwart octaaf (pixels per wereldeenheid).
const emmer = (px) => Math.min(MAX_P, Math.max(2, Math.pow(2, Math.round(Math.log2(Math.max(1, px)) * 4) / 4)));

function bakGloed(cv, [r, g, b]) {
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gr.addColorStop(0.35, `rgba(${r},${g},${b},0.45)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = gr;
  c.fillRect(0, 0, 32, 32);
}

// ---------- bakken (wereldeenheden, oorsprong in het midden van de bitmap) ----------

// Grillige rand van een groeve: straal per hoek, vast per zaad.
function groefRand(o, a) { return o.r * (1 + 0.1 * Math.sin(3 * a + o.z1) + 0.06 * Math.sin(5 * a + o.z2)); }
function groefVorm(g, o, s, dx, dy) {
  g.beginPath();
  for (let i = 0; i <= 28; i++) { const a = (i / 28) * TAU, r = groefRand(o, a) * s; const x = Math.cos(a) * r + dx, y = Math.sin(a) * r * 0.86 + dy; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.closePath();
}

// Dagbouwgroeve: opgeworpen rand, vier trappen omlaag (wanden aan de noordwestkant in de schaduw, aan de
// zuidoostkant in de zon), een bodem met een plas, een helling van de rand naar de bodem en twee storthopen.
function bakGroeve(g, o, b) {
  const sn = b.sn;
  const bank = sn ? '#dfe3e4' : o.steen ? '#b3ab9e' : '#b09a7c', licht = sn ? '#eef1f2' : o.steen ? '#d2cbbf' : '#cdb898', donker = o.steen ? '#655f58' : '#6f5d4a';
  groefVorm(g, o, 1.16, 0.15, 0.15); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fill();
  groefVorm(g, o, 1.12, 0, 0); g.fillStyle = sn ? 'rgba(230,234,236,0.8)' : 'rgba(150,132,104,0.7)'; g.fill();
  for (let i = 0; i < 4; i++) {
    const s = 1 - i * 0.22, d = i * 0.08 * o.r;
    groefVorm(g, o, s, d * 0.3, d * 0.3); g.fillStyle = donker; g.fill();
    groefVorm(g, o, s * 0.97, d * 0.3 + 0.2, d * 0.3 + 0.2); g.fillStyle = licht; g.fill();
    groefVorm(g, o, s * 0.86, d * 0.3 + 0.12, d * 0.3 + 0.12); g.fillStyle = bank; g.fill();
  }
  // bodem met plas en bandensporen
  const fx = 0.24 * o.r * 0.3 + 0.12, fy = fx;
  g.fillStyle = sn ? '#c9d6dc' : '#5f7d84';
  g.beginPath(); g.ellipse(fx - o.r * 0.06, fy + o.r * 0.03, o.r * 0.12, o.r * 0.07, 0.4, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(70,58,44,0.35)'; g.lineWidth = 0.08; g.beginPath();
  g.arc(fx + 0.1, fy, o.r * 0.2, 0.3, 2.6); g.stroke();
  // helling: van de rand (kant van de mijn) spiralend naar de bodem
  g.strokeStyle = 'rgba(80,66,50,0.5)'; g.lineWidth = 0.95; g.beginPath();
  for (let k = 0; k <= 12; k++) { const p = k / 12, a = o.hoek + p * 1.3, r = groefRand(o, a) * (1.02 - p * 0.72); const x = Math.cos(a) * r + p * 0.25, y = Math.sin(a) * r * 0.86 + p * 0.25; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  g.strokeStyle = sn ? '#e9ecee' : '#c6b190'; g.lineWidth = 0.7; g.stroke();
  // storthopen buiten de rand: licht aan de noordwestkant
  for (let k = 0; k < 2; k++) {
    const a = o.hoek + 2.2 + k * 1.1, r = o.r * 1.32, x = Math.cos(a) * r, y = Math.sin(a) * r * 0.9, rr = o.r * (0.16 + 0.05 * k);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(x + rr * 0.35, y + rr * 0.35, rr, rr * 0.8, 0, 0, TAU); g.fill();
    g.fillStyle = sn ? '#e4e8ea' : k ? '#9a9286' : '#c2a878'; g.beginPath(); g.ellipse(x, y, rr, rr * 0.8, 0, 0, TAU); g.fill();
    g.fillStyle = sn ? '#f6f8f9' : k ? '#b8b0a4' : '#dcc596'; g.beginPath(); g.ellipse(x - rr * 0.3, y - rr * 0.28, rr * 0.5, rr * 0.38, 0, 0, TAU); g.fill();
  }
}

// Zagerij: erf, loods met open zijde, stapels stammen, gezaagde planken en een berg zaagsel. Gedraaid langs hoek.
function bakZagerij(g, o, b) {
  const sn = b.sn, co = Math.cos(o.hoek), si = Math.sin(o.hoek);
  g.save(); g.transform(co, si, -si, co, 0, 0);
  g.fillStyle = sn ? 'rgba(226,230,232,0.9)' : 'rgba(156,136,104,0.75)'; g.fillRect(-3, -1.9, 6, 3.8);
  // loods: schaduw, dak in twee vlakken (de noordwestkant licht), nok en open zijde
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-2.6 + 0.45, -1.5 + 0.5, 3.2, 1.5);
  const lichtBoven = co - si > 0;
  g.fillStyle = sn ? '#eef1f3' : lichtBoven ? '#9aa0a2' : '#6d7274'; g.fillRect(-2.6, -1.5, 3.2, 0.75);
  g.fillStyle = sn ? '#d3d8dc' : lichtBoven ? '#6d7274' : '#9aa0a2'; g.fillRect(-2.6, -0.75, 3.2, 0.75);
  g.strokeStyle = 'rgba(40,40,40,0.5)'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(-2.6, -0.75); g.lineTo(0.6, -0.75); g.stroke();
  g.fillStyle = '#3a3026'; g.fillRect(0.6, -1.4, 0.12, 1.3);
  // stammen: drie stapels met kopse kanten
  for (let k = 0; k < 3; k++) {
    const x = -2.5 + k * 1.0, y = 0.55;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 0.15, y + 0.15, 0.8, 1.0);
    g.fillStyle = '#6e5236'; g.fillRect(x, y, 0.8, 1.0);
    g.fillStyle = sn ? '#f2f4f5' : '#8a6a48'; g.fillRect(x, y, 0.8, 0.22);
    g.fillStyle = '#c9a982';
    for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(x + 0.12 + j * 0.19, y + 0.95, 0.09, 0, TAU); g.fill(); }
  }
  // planken
  for (let k = 0; k < 2; k++) {
    const x = 1.1 + k * 0.85, y = -1.3;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 0.12, y + 0.12, 0.6, 1.4);
    g.fillStyle = sn ? '#eef0f1' : '#e1c99a'; g.fillRect(x, y, 0.6, 1.4);
    g.strokeStyle = 'rgba(120,90,50,0.6)'; g.lineWidth = 0.03; g.beginPath();
    for (let j = 1; j < 5; j++) { g.moveTo(x + j * 0.12, y); g.lineTo(x + j * 0.12, y + 1.4); }
    g.stroke();
  }
  // zaagsel
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.ellipse(1.95, 0.95, 0.6, 0.45, 0, 0, TAU); g.fill();
  g.fillStyle = sn ? '#e8ebec' : '#e3cf98'; g.beginPath(); g.ellipse(1.8, 0.8, 0.6, 0.45, 0, 0, TAU); g.fill();
  g.fillStyle = sn ? '#f7f9fa' : '#f0e2b8'; g.beginPath(); g.ellipse(1.65, 0.68, 0.28, 0.2, 0, 0, TAU); g.fill();
  g.restore();
}

// ---------- de laag ----------

export class WerkLaag {
  constructor() {
    this.klok = 0; // eigen klok: loopt alleen als het spel loopt (machines, wagens)
    this.state = null;
    this.geo = null;
    this.eigenaar = null;
    this.basis = null;
    this.tl = null;
    this.sig = '';
    this.raster = new Uint8Array(RW * RH);
    this.leeg();
    this.cache = new Map();
    this.laatste = new Map();
    this.bytes = 0;
    this.gebakken = 0;
    this.bakTeller = 0;
    this.licht = new Float32Array(PLAFOND.lichten * LICHT);
    this.vw = new Float32Array(PLAFOND.machines * VW); // machines, wagens, dumpers samen
    this.baal = new Float32Array(PLAFOND.balen * 4); // x, y, soort, hoek
    this.mens = new Float32Array(PLAFOND.plukkers * 4); // x, y, kleur, buk
    this.meeuw = new Float32Array(PLAFOND.meeuwen * 4); // x, y, hoogte, slag
    this.gloed = null;
    this.nul();
  }

  leeg() {
    this.velden = []; this.erven = []; this.kaal = []; this.zagerijen = []; this.groeven = []; this.jaknikkers = []; this.plekLijst = [];
    this.zoekKaart = false; // de zoekkaart voor routes over het land hoort bij deze wereld
  }

  nul() {
    this.n = {};
    for (const k of Object.keys(PLAFOND)) this.n[k] = 0;
    this.nLicht = 0; this.nVw = 0; this.nBaal = 0; this.nMens = 0; this.nMeeuw = 0; this.nSproei = 0; this.nSchrik = 0; this.nSchuif = 0; this.nGraaf = 0;
    if (this.zicht) this.zicht.length = 0;
    if (this.zichtErf) this.zichtErf.length = 0;
  }

  laad(view) {
    this.state = view.state;
    this.geo = view.geo;
    this.eigenaar = view.eigenaar;
    const vt = view.terreinLaag;
    this.basis = vt && vt.basis && vt.basis.geo === view.geo ? vt.basis : maakBasis(view.geo, view.eigenaar);
    this.tl = vt && vt.basis === this.basis ? vt : Object.assign(new TerreinLaag(), { basis: this.basis, geo: view.geo });
    this.sig = '';
    this.leeg();
    this.cache.clear();
    this.laatste.clear();
    this.bytes = 0;
    this.vorigPlan = null; // routes en werkplannen van de vorige keuze (alleen binnen deze toestand)
  }

  // ---------- opzoeken ----------

  zee(x, y) {
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= W || py >= H) return true;
    return this.eigenaar[py * W + px] === -1;
  }
  // Droog op (x, y) en in een ring met straal r: geen zee, rivier of meer.
  droog(x, y, r) {
    const tl = this.tl;
    for (let i = 0; i <= 8; i++) {
      const px = i ? x + Math.cos(i * 0.785) * r : x, py = i ? y + Math.sin(i * 0.785) * r : y;
      if (this.zee(px, py) || tl.rivierAfstand(px, py) < 0.7 || tl.isMeer(px, py)) return false;
    }
    return true;
  }
  tegel(x, y) { const geo = this.geo, Tw = geo.T; return clamp(Math.floor(y / Tw), 0, geo.rij - 1) * geo.kol + clamp(Math.floor(x / Tw), 0, geo.kol - 1); }

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
  // Raakt een gedraaide rechthoek iets uit het masker? Monsters om de 1,5 eenheid.
  vrijVlak(x, y, ux, uy, hu, hv, masker) {
    const nu = Math.max(1, Math.ceil(hu / 0.75)), nv = Math.max(1, Math.ceil(hv / 0.75));
    for (let i = -nu; i <= nu; i++) for (let j = -nv; j <= nv; j++) {
      const u = (i / nu) * hu, v = (j / nv) * hv;
      if (!this.vrij(x + u * ux - v * uy, y + u * uy + v * ux, 0.1, masker)) return false;
    }
    return true;
  }

  // Tegels waar leven.js tractoren, kuddes of herten zet (dezelfde hashes): daar komt van deze laag niets.
  levenAkker(t) { const tg = this.geo.tegels[t]; return tg.terrein === 'vlakte' && tg.eig >= 0 && hash(t, 3) < 0.45 && hash(t, 101) < 0.5; }
  levenKudde(t) { const tg = this.geo.tegels[t]; return tg.eig >= 0 && !(tg.terrein === 'vlakte' && hash(t, 3) < 0.45) && (tg.terrein === 'vlakte' || tg.terrein === 'kust') && hash(t, 61) < 0.6 && hash(t, 111) < 0.42; }
  levenHert(t) { const tg = this.geo.tegels[t]; return tg.terrein === 'bos' && hash(t, 171) < 0.3; }

  // ---------- kiezen (alleen als de toestand iets verandert) ----------

  werkCache(view) {
    const s = this.state;
    let nP = 0, somT = 0;
    for (let i = 0; i < s.landen.length; i++) {
      const l = s.landen[i];
      nP += l.plaatsingen.length + (l.bouw?.length ?? 0) * 1000;
      for (let j = 0; j < l.plaatsingen.length; j++) somT += l.plaatsingen[j].t;
      for (let j = 0; j < (l.bouw?.length ?? 0); j++) somT += l.bouw[j].tegel * 7;
    }
    const inf = view.infraLaag, net = view.wegennet?.versie > 0 ? view.wegennet : null;
    const sig = `${s.grensVersie}|${nP}|${somT}|${s.landen.length}|${inf ? inf.sig : '-'}|${net?.versie ?? '-'}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.net = net && typeof net.wegen === 'function' ? net : null;
    this.kies(inf, view.natuurLaag);
  }

  kies(inf, nat) {
    this.leeg();
    this.bouwSoorten();
    this.raster.fill(0);
    this.merkInfra(inf);
    this.merkGebouwen(inf);
    this.merkGrens();
    this.merkNatuur(nat);
    this.kiesGroeven();
    this.kiesJaknikkers();
    this.kiesZagerijen();
    this.kiesErven();
    this.kiesVelden();
    this.kiesRoutes();
    this.kiesErfritten();
    this.kiesBos();
  }

  bouwSoorten() {
    const s = this.state, P = s.pack, geo = this.geo, n = geo.tegels.length;
    if (!this.soort || this.soort.length !== n) this.soort = new Uint8Array(n);
    this.soort.fill(0);
    this.mijnen = []; this.olie = []; this.houtkap = new Int16Array(s.landen.length); this.houtkapTegels = [];
    for (const land of s.landen) {
      for (const p of land.plaatsingen) {
        if (p.t < 0) continue;
        const g = P.gebouwIndex[p.g], tek = g.tekening ?? g.id;
        this.soort[p.t] = 1;
        if (tek === 'mijn' || g.id === 'mijn') this.mijnen.push({ t: p.t, land: land.idx });
        if (g.id === 'olieveld') this.olie.push({ t: p.t, land: land.idx });
        if (g.id === 'houtkap') { this.houtkap[land.idx]++; this.houtkapTegels.push({ t: p.t, land: land.idx }); }
      }
      for (const b of land.bouw ?? []) if (b.tegel >= 0) this.soort[b.tegel] = 1;
      const h = geo.hoofdstad[land.idx];
      if (h != null && h >= 0) this.soort[h] = 1;
    }
  }

  // Wegen en spoor van infra.js, en de wegen die map.js van elk gebouw naar zijn knooppunt tekent.
  merkInfra(inf) {
    const geo = this.geo, Tw = geo.T, s = this.state, P = s.pack;
    if (inf) {
      for (const w of inf.wegen ?? []) this.merkLijn(w.ax, w.ay, w.bx, w.by, 0.11 * Tw, INFRA);
      for (const r of inf.routes ?? []) for (let i = 0; i + 1 < r.n; i++) this.merkLijn(r.x[i], r.y[i], r.x[i + 1], r.y[i + 1], 0.1 * Tw, INFRA);
      for (const p of inf.pijpen ?? []) this.merkLijn(p.ax, p.ay, p.bx, p.by, 0.06 * Tw, INFRA);
      const v = inf.brugVlakken ? inf.brugVlakken() : null;
      if (v) for (let i = 0; i < v.n; i++) { const o = i * 5, d = v.data; this.merkLijn(d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4] + 1, INFRA); }
      for (const h of inf.havens ?? []) this.merk(h.x, h.y, 0.7 * Tw, INFRA);
    }
    this.kaartWegen = [];
    this.alleWegen = [];
    for (const w of inf?.wegen ?? []) this.alleWegen.push(w.ax, w.ay, w.bx, w.by);
    // C12: is er een wegennet, dan is dat de enige bron: elk stuk met zijn eigen breedte plus berm, en geen
    // sterlijnen van elk gebouw naar een knooppunt meer
    if (this.net) {
      const PROF = [0.07, 0.12, 0.14, 0.16, 0.1];
      for (const w of this.net.wegen()) {
        const half = ((PROF[w.klasse] ?? 0.14) / 2 + 0.05) * Tw;
        this.merkLijn(w.ax, w.ay, w.bx, w.by, half, INFRA);
        this.kaartWegen.push(w.ax, w.ay, w.bx, w.by);
        this.alleWegen.push(w.ax, w.ay, w.bx, w.by);
      }
      return;
    }
    for (const land of s.landen) {
      const knoop = [geo.hoofdstad[land.idx]];
      for (const p of land.plaatsingen) if (p.t >= 0 && P.gebouwIndex[p.g].knooppunt) knoop.push(p.t);
      const items = [];
      for (const p of land.plaatsingen) items.push(p.t);
      for (const b of land.bouw ?? []) items.push(b.tegel);
      for (const t of items) {
        if (t == null || t < 0) continue;
        const a = geo.tegels[t];
        let best = -1, bd = Infinity;
        for (const n of knoop) { const b = geo.tegels[n]; if (!b || n === t) continue; const d = (a.k - b.k) ** 2 + (a.r - b.r) ** 2; if (d < bd) { bd = d; best = n; } }
        if (best < 0) continue;
        const b = geo.tegels[best];
        this.kaartWegen.push(a.x, a.y, b.x, b.y);
        this.alleWegen.push(a.x, a.y, b.x, b.y);
        this.merkLijn(a.x, a.y, b.x, b.y, 0.1 * Tw, INFRA);
      }
    }
  }

  merkGebouwen(inf) {
    const s = this.state, geo = this.geo, Tw = geo.T, g = this.raster;
    for (let t = 0; t < geo.tegels.length; t++) {
      if (!s.bezet[t] && !(inf && inf.gereserveerd && inf.gereserveerd(t)) && !this.soort[t]) continue;
      const tg = geo.tegels[t];
      const c0 = Math.max(0, Math.floor((tg.x - Tw / 2) / RC)), c1 = Math.min(RW - 1, Math.floor((tg.x + Tw / 2 - 0.01) / RC));
      const r0 = Math.max(0, Math.floor((tg.y - Tw / 2) / RC)), r1 = Math.min(RH - 1, Math.floor((tg.y + Tw / 2 - 0.01) / RC));
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) g[cy * RW + cx] |= GEBOUW;
    }
    // stad: de woonwijken en hoofdsteden uit terrein.js houden we ook vrij
    const stad = this.tl.vlaggen?.stad;
    if (stad) for (let t = 0; t < geo.tegels.length; t++) {
      if (!stad[t]) continue;
      const tg = geo.tegels[t];
      this.merk(tg.x, tg.y, Tw * 0.3, GEBOUW);
    }
  }

  // Een strook langs elke landgrens blijft voor grens.js (hekken, posten, loopgraven).
  merkGrens() {
    const e = this.eigenaar, g = this.raster;
    const op = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : e[y * W + x]);
    for (let cy = 0; cy < RH; cy++) for (let cx = 0; cx < RW; cx++) {
      const x = cx * RC + 1, y = cy * RC + 1, a = op(x, y);
      if (a < 0) continue;
      for (let k = 0; k < 4; k++) {
        const b = op(x + (k === 0 ? 4 : k === 1 ? -4 : 0), y + (k === 2 ? 4 : k === 3 ? -4 : 0));
        if (b >= 0 && b !== a) { g[cy * RW + cx] |= GRENS; break; }
      }
    }
  }

  // Bergpaden, hutten en skigebieden van natuur.js.
  merkNatuur(nat) {
    if (!nat) return;
    const Tw = this.geo.T;
    for (const p of nat.paden ?? []) for (let i = 0; i + 3 < p.pts.length; i += 2) this.merkLijn(p.pts[i], p.pts[i + 1], p.pts[i + 2], p.pts[i + 3], 0.8, NATUUR);
    for (const h of nat.hutten ?? []) this.merk(h.x, h.y, 1.4, NATUUR);
    for (const l of nat.liften ?? []) {
      const tg = [...(l.tg ?? []), ...(l.pistes ?? []).flatMap((p) => [...(p.tg ?? [])])];
      for (const t of tg) { const tt = this.geo.tegels[t]; if (tt) this.merk(tt.x, tt.y, Tw * 0.55, NATUUR); }
    }
  }

  plek(soort, x, y) { this.plekLijst.push({ soort, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, t: this.tegel(x, y) }); }

  // Vrij land voor iets met straal r: droog, niet op een gebouw, weg, grens of ander werk.
  landVrij(x, y, r, masker = ALLES) { return x > r && y > r && x < W - r && y < H - r && this.vrij(x, y, r, masker) && this.droog(x, y, r); }

  // Naast elke mijn een dagbouwgroeve op een vrij buurvakje, de helling naar de mijn toe.
  kiesGroeven() {
    const geo = this.geo, Tw = geo.T, s = this.state;
    for (const m of this.mijnen) {
      if (this.groeven.length >= MAX_GROEF) break;
      const mt = geo.tegels[m.t];
      const kand = [];
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
        if (!dr && !dk) continue;
        const k = mt.k + dk, r = mt.r + dr;
        if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
        const t = r * geo.kol + k, tg = geo.tegels[t];
        if (tg.terrein === 'water' || tg.eig < 0 || s.bezet[t] || this.soort[t]) continue;
        kand.push([hash(t, m.t, 701) - (tg.terrein === 'berg' ? 0.5 : 0), t]);
      }
      kand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let gevonden = null;
      for (const [, t] of kand) {
        const tg = geo.tegels[t];
        for (const r of [0.27 * Tw, 0.21 * Tw]) {
          for (let q = 0; q < 5 && !gevonden; q++) {
            const x = tg.x + [0, 0.12, -0.12, 0, 0][q] * Tw, y = tg.y + [0, 0, 0, 0.12, -0.12][q] * Tw;
            if (!this.landVrij(x, y, r + 1.2) || !this.tl.boomvrij(x, y, r * 0.45, true)) continue;
            gevonden = { x, y, r, t };
          }
          if (gevonden) break;
        }
        if (gevonden) break;
      }
      if (!gevonden) continue;
      const { x, y, r, t } = gevonden, tg = geo.tegels[t];
      const hoek = Math.atan2(mt.y - y, mt.x - x);
      this.merk(x, y, r * 1.45, WERK);
      this.groeven.push({ x, y, r, hoek, z: hash(t, 702), z1: hash(t, 703) * TAU, z2: hash(t, 704) * TAU, steen: tg.terrein === 'berg', land: m.land, t });
      this.plek('groeve', x, y);
    }
  }

  // Jaknikkers rond elk olieveld: één tot drie op vrij land in de buurvakjes.
  kiesJaknikkers() {
    const geo = this.geo, Tw = geo.T, s = this.state;
    for (const o of this.olie) {
      const ot = geo.tegels[o.t];
      let n = 0;
      for (let q = 0; q < 8 && n < 3 && this.jaknikkers.length < MAX_JAK; q++) {
        const dk = [1, -1, 0, 0, 1, -1, 1, -1][q], dr = [0, 0, 1, -1, 1, 1, -1, -1][q];
        const k = ot.k + dk, r = ot.r + dr;
        if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
        const t = r * geo.kol + k, tg = geo.tegels[t];
        if (tg.terrein === 'water' || tg.terrein === 'berg' || tg.eig < 0 || s.bezet[t] || this.soort[t] || hash(t, o.t, 711) > 0.55) continue;
        const x = tg.x + (hash(t, 712) - 0.5) * 0.5 * Tw, y = tg.y + (hash(t, 713) - 0.5) * 0.5 * Tw;
        if (!this.landVrij(x, y, 1.6) || !this.tl.boomvrij(x, y, 1.0)) continue;
        this.merk(x, y, 1.8, WERK);
        this.jaknikkers.push({ x, y, hoek: hash(t, 714) * Math.PI, z: hash(t, 715), kleur: Math.floor(hash(t, 716) * JAK_KLEUR.length) });
        this.plek('jaknikker', x, y);
        n++;
      }
    }
  }

  // Een zagerij per land met houtkap: aan de bosrand, zo dicht mogelijk bij een houtkapgebouw.
  kiesZagerijen() {
    const geo = this.geo, Tw = geo.T, s = this.state;
    const gedaan = new Uint8Array(s.landen.length);
    for (const h of this.houtkapTegels) {
      if (gedaan[h.land] || this.zagerijen.length >= MAX_ZAAG) continue;
      const ht = geo.tegels[h.t];
      let best = null, bd = Infinity;
      for (let dr = -3; dr <= 3; dr++) for (let dk = -3; dk <= 3; dk++) {
        const k = ht.k + dk, r = ht.r + dr;
        if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
        const t = r * geo.kol + k, tg = geo.tegels[t];
        if (tg.eig !== h.land || tg.terrein === 'water' || tg.terrein === 'bos' || tg.terrein === 'berg' || s.bezet[t] || this.soort[t]) continue;
        let bos = false;
        for (let q = 0; q < 4; q++) { const kk = k + [1, -1, 0, 0][q], rr = r + [0, 0, 1, -1][q]; if (kk >= 0 && rr >= 0 && kk < geo.kol && rr < geo.rij && geo.tegels[rr * geo.kol + kk].terrein === 'bos') bos = true; }
        if (!bos) continue;
        const d = dk * dk + dr * dr + hash(t, 721) * 0.5;
        if (d >= bd) continue;
        const x = tg.x + (hash(t, 722) - 0.5) * 0.3 * Tw, y = tg.y + (hash(t, 723) - 0.5) * 0.3 * Tw;
        if (!this.landVrij(x, y, 3.6) || !this.tl.boomvrij(x, y, 3.0)) continue;
        bd = d; best = { x, y, t };
      }
      if (!best) continue;
      gedaan[h.land] = 1;
      this.merk(best.x, best.y, 4, WERK);
      this.zagerijen.push({ x: best.x, y: best.y, hoek: hash(best.t, 724) * Math.PI, z: hash(best.t, 725), land: h.land });
      this.plek('zagerij', best.x, best.y);
    }
  }

  // Boerderijen uit terrein.js: erfweg naar de dichtste weg, hooiberg, windmotor, kippen en hond.
  kiesErven() {
    const geo = this.geo, Tw = geo.T, s = this.state, b = this.basis;
    for (let t = 0; t < geo.tegels.length && this.erven.length < MAX_ERVEN; t++) {
      if (!b.akker[t] || s.bezet[t] || this.soort[t]) continue;
      const tg = geo.tegels[t], f = kenmerkenVoorTegel(tg, b);
      for (let p = 0; p < f.length; p += STAP) {
        if (f[p] !== BOERDERIJ) continue;
        const x = tg.x + f[p + 1], y = tg.y + f[p + 2], hoek = f[p + 5], co = Math.cos(hoek), si = Math.sin(hoek);
        if (!this.vrijVlak(x, y, co, si, 2.4, 1.9, INFRA | GEBOUW | GRENS | WERK | NATUUR)) continue;
        const op = (u, v) => [x + u * co - v * si, y + u * si + v * co];
        const e = { x, y, co, si, t, z: hash(t, 731), hooi: null, laan: null, molen: hash(t, 732) < 0.4, kippen: hash(t, 733) < 0.8 ? 3 + Math.floor(hash(t, 734) * 5) : 0, hond: hash(t, 735) < 0.6, lamp: hash(t, 736) < 0.75, schuif: false, velden: [], rit: -1, ritSoort: 0, schuifAan: false };
        e.px = x + ERF_P[0] * co - ERF_P[1] * si; e.py = y + ERF_P[0] * si + ERF_P[1] * co;
        e.hondKleur = Math.floor(hash(t, 737) * HOND_KLEUR.length);
        // hooiberg net buiten het erf, niet onder een boomkruin
        if (hash(t, 738) < 0.65) {
          for (const [u, v] of [[0.9, 2.65], [-0.9, -2.65], [0.2, -2.7], [-0.4, 2.7]]) {
            const [hx, hy] = op(u, v);
            if (!this.landVrij(hx, hy, 1.0) || !this.tl.boomvrij(hx, hy, 0.9, true)) continue;
            e.hooi = { x: hx, y: hy, dak: hash(t, 739) < 0.5 ? 0 : 1 };
            this.merk(hx, hy, 1.1, WERK);
            break;
          }
        }
        // erfweg: recht naar een weg in de buurt (de dichtste die past, tot 60 eenheden ver), over droog en vrij land,
        // niet onder bomen; hij sluit aan op de rand van de weg, zodat wagens van de weg af het erf op rijden
        const kw = this.alleWegen, kand = this.laanKand ?? (this.laanKand = []);
        kand.length = 0;
        for (let i = 0; i < kw.length; i += 4) {
          const ax = kw[i], ay = kw[i + 1], bx = kw[i + 2], by = kw[i + 3];
          if (x < Math.min(ax, bx) - 60 || x > Math.max(ax, bx) + 60 || y < Math.min(ay, by) - 60 || y > Math.max(ay, by) + 60) continue;
          const lx = bx - ax, ly = by - ay, ll = lx * lx + ly * ly || 1;
          // het dichtste punt, en anders punten ernaast: de weg buiten de bebouwing telt, niet het stuk tussen de huizen
          const u0 = clamp(((x - ax) * lx + (y - ay) * ly) / ll, 0.1, 0.9);
          for (let j = 0; j < 5; j++) {
            const u = clamp(u0 + (j === 0 ? 0 : (j & 1 ? 1 : -1) * Math.ceil(j / 2) * 0.12), 0.06, 0.94), qx = ax + lx * u, qy = ay + ly * u, d = Math.hypot(qx - x, qy - y);
            if (d >= 60 || d <= 4.5) continue;
            const tq = this.tegel(qx, qy);
            if (s.bezet[tq] || this.soort[tq] || !this.vrij(qx, qy, 1.2, GEBOUW)) continue;
            const wl = Math.sqrt(ll);
            kand.push([d, qx, qy, lx / wl, ly / wl]);
            break;
          }
        }
        kand.sort((p1, p2) => p1[0] - p2[0] || p1[1] - p2[1]);
        for (let ki = 0; ki < kand.length && ki < 6 && !e.laan; ki++) {
          const [d, qx, qy, rx, ry] = kand[ki], dx = (qx - x) / d, dy = (qy - y) / d;
          const ax = x + dx * 2.2, ay = y + dy * 2.2, bx = qx - dx * 1.9, by = qy - dy * 1.9, len = Math.hypot(bx - ax, by - ay);
          let ok = len > 1.5 && !s.bezet[this.tegel(bx, by)] && !this.soort[this.tegel(bx, by)];
          const nk = Math.ceil(len);
          for (let k = 0; ok && k <= nk; k++) {
            const px = ax + (bx - ax) * (k / nk), py = ay + (by - ay) * (k / nk), eind = (nk - k) * (len / nk) < 3.5;
            if (!this.droog(px, py, 0.6) || !this.tl.boomvrij(px, py, 0.45, true)) ok = false;
            else if (eind) { const tt = this.tegel(px, py); if (s.bezet[tt] || this.soort[tt] || !this.vrij(px, py, 0.4, GRENS | NATUUR)) ok = false; }
            else if (!this.vrij(px, py, 0.4, INFRA | GEBOUW | GRENS | NATUUR)) ok = false;
          }
          if (!ok) continue;
          e.laan = { ax, ay, bx, by, len, dx, dy, qx, qy, rx, ry };
          e.schuif = hash(t, 740) < 0.4;
          this.merkLijn(ax, ay, bx, by, 0.6, WERK);
          this.plek('erfweg', (ax + bx) / 2, (ay + by) / 2);
        }
        // geen weg in de buurt: dan een doodlopende veldweg van het erf het land in (vier richtingen proberen)
        for (let r = 0; r < 4 && !e.laan; r++) {
          const hk = (r + Math.floor(hash(t, 743) * 4)) & 3, dx = hk & 1 ? -si : co, dy = hk & 1 ? co : si, tk = hk & 2 ? -1 : 1;
          const len = 6 + hash(t, 744 + r) * 6, ax = x + dx * tk * 2.4, ay = y + dy * tk * 2.4, bx = ax + dx * tk * len, by = ay + dy * tk * len;
          let ok = true;
          for (let k = 0; ok && k <= Math.ceil(len); k++) {
            const px = ax + (bx - ax) * (k / Math.ceil(len)), py = ay + (by - ay) * (k / Math.ceil(len)), tt = this.tegel(px, py);
            if (s.bezet[tt] || this.soort[tt] || !this.droog(px, py, 0.6) || !this.tl.boomvrij(px, py, 0.45, true) || !this.vrij(px, py, 0.45, INFRA | GEBOUW | GRENS | NATUUR | WERK)) ok = false;
          }
          if (!ok) continue;
          e.laan = { ax, ay, bx, by, len, dx: dx * tk, dy: dy * tk, dood: true };
          e.schuif = hash(t, 740) < 0.4;
          this.merkLijn(ax, ay, bx, by, 0.6, WERK);
          this.plek('veldweg', (ax + bx) / 2, (ay + by) / 2);
        }
        this.merk(x, y, 2.6, WERK);
        this.erven.push(e);
        this.plek('erf', x, y);
      }
    }
  }

  // Percelen uit terrein.js met hun werk door het jaar. Alleen waar leven.js niets zet en waar geen weg, gebouw of
  // grens doorheen loopt.
  kiesVelden() {
    const geo = this.geo, Tw = geo.T, s = this.state, b = this.basis;
    for (let t = 0; t < geo.tegels.length && this.velden.length < MAX_VELDEN; t++) {
      const tg = geo.tegels[t];
      if (tg.terrein === 'water' || tg.terrein === 'berg' || tg.eig < 0 || s.bezet[t] || this.soort[t]) continue;
      let akkerBuur = false;
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) { const k = tg.k + dk, r = tg.r + dr; if (k >= 0 && r >= 0 && k < geo.kol && r < geo.rij && b.akker[r * geo.kol + k]) akkerBuur = true; }
      if (!akkerBuur) continue;
      const f = kenmerkenVoorTegel(tg, b);
      for (let p = 0, q = 0; p < f.length; p += STAP, q++) {
        if (f[p] !== PERCEEL) continue;
        // de hoek van het perceel: langs een weg die van de weg (C12), anders het akkerrooster van het land
        const hoek = perceelHoek(tg, f, p), co = Math.cos(hoek), si = Math.sin(hoek);
        const x = tg.x + f[p + 1], y = tg.y + f[p + 2], hu = f[p + 3], hv = f[p + 5], code = f[p + 4];
        const soort = code & 15, dwars = (code & 16) !== 0, rand = (code >> 5) & 7;
        const h = hash(t, q, 501), h2 = hash(t, q, 502);
        let rol = 0, balen = false;
        if (soort === GRAAN) {
          rol |= R_STOPPEL;
          for (let k = 0; k < f.length; k += STAP) if (f[k] === BAAL && Math.abs((f[k + 1] + tg.x - x) * co + (f[k + 2] + tg.y - y) * si) < hu && Math.abs(-(f[k + 1] + tg.x - x) * si + (f[k + 2] + tg.y - y) * co) < hv) balen = true;
          // de balen van terrein.js op dit graan neemt deze laag over (terrein.js laat ze dan weg): de pers maakt ze
          // achter de maaidorser en een trekker met een wagen haalt ze weer op
          if (balen || h < 0.35) rol |= R_BALEN;
          if (h2 < 0.2) rol |= R_SCHRIK;
        } else if (soort === WEI) {
          if (h < 0.42) rol |= R_KUIL;
          if (rand !== HAAGRAND && h2 < 0.6) rol |= R_HEK;
        } else if (soort === PLOEG) {
          if (h < 0.75) rol |= R_PLOEG;
          if (h2 < 0.3) rol |= R_MEST;
        } else if (soort === GROEN) {
          if (tg.hoogte < 0.52 && h < 0.34) rol |= R_BOL;
          else if (h < 0.65) rol |= R_ZAAI;
          if (h2 < 0.3) rol |= R_SPROEI; else if (h2 < 0.42) rol |= R_SCHRIK;
        } else if (soort === MAIS) {
          if (h < 0.55) rol |= R_ZAAI;
          if (h2 < 0.38) rol |= R_SPROEI;
        } else if (soort === KOOLZAAD) {
          if (h < 0.35) rol |= R_BIJ;
        } else if (soort === BRAAK) {
          if (tg.hoogte < 0.52 && h < 0.45) rol |= R_BOL;
          if (h2 < 0.3) rol |= R_MEST;
        } else if (soort === BOOMGAARD) {
          if (h < 0.8) rol |= R_PLUK;
          if (h2 < 0.55) rol |= R_BIJ;
        } else if (soort === WIJN) {
          if (h < 0.75) rol |= R_DRUIF;
        } else if (soort === KAS) rol |= R_KAS;
        if (!rol) continue;
        // niet onder de tractoren, kuddes en herten van leven.js, en niet over wegen, gebouwen of grenzen
        let vrijLeven = !this.levenKudde(t);
        for (let dr = -1; dr <= 1 && vrijLeven; dr++) for (let dk = -1; dk <= 1 && vrijLeven; dk++) {
          const k = tg.k + dk, r = tg.r + dr;
          if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
          const n = r * geo.kol + k;
          if (!this.levenAkker(n)) continue;
          const nt = geo.tegels[n], m = 0.29 * Tw;
          for (let a = -1; a <= 1 && vrijLeven; a++) for (let c2 = -1; c2 <= 1 && vrijLeven; c2++) {
            const px = x + a * hu * co - c2 * hv * si, py = y + a * hu * si + c2 * hv * co;
            if (Math.abs(px - nt.x) < m && Math.abs(py - nt.y) < m) vrijLeven = false;
          }
        }
        // een kas hoort bij terrein.js en ligt er hoe dan ook; loopt er een weg of gebouw overheen, dan glanzen en
        // gloeien alleen de ruiten die vrij liggen (anders zou het glas over de weg heen schijnen)
        let ruit = null;
        if (!vrijLeven || !this.vrijVlak(x, y, co, si, hu, hv, INFRA | GEBOUW | GRENS | WERK | NATUUR)) {
          if (soort !== KAS || !vrijLeven) continue;
          const np = Math.max(1, Math.floor((2 * hu) / 0.6));
          ruit = new Uint8Array(np);
          let vrij = 0;
          for (let i = 0; i < np; i++) {
            const u0 = -hu + i * 0.6, u1 = Math.min(hu, u0 + 0.6), um = (u0 + u1) / 2;
            if (this.vrijVlak(x + um * co, y + um * si, co, si, (u1 - u0) / 2, hv, INFRA | GEBOUW)) { ruit[i] = 1; vrij++; }
          }
          if (!vrij) continue;
          rol = R_KAS;
        }
        // rijrichting zoals de gewasrijen in terrein.js
        const lx = dwars ? -si : co, ly = dwars ? co : si, L = dwars ? hv : hu, B = dwars ? hu : hv;
        // een even aantal banen: de machine eindigt aan de kant waar hij begon, bij de route naar huis
        // (op een kort perceel smallere banen, zodat de bocht aan de kopakker binnen de rand blijft)
        let nL = Math.max(2, Math.floor((2 * B) / 1.05), Math.ceil(B / Math.max(0.15, L - 0.46)));
        nL += nL & 1;
        const bw = (2 * B) / nL, r = bw / 2, Lp = Math.max(0.1, L - r - 0.36), pre = Math.min(r + 0.26, Math.max(0, L - Lp - 0.05));
        const v = { x, y, co, si, hu, hv, lx, ly, px: -ly, py: lx, olx: lx, oly: ly, L, B, nL, bw, r, Lp, pre, padLen: nL * 2 * Lp + (nL - 1) * Math.PI * r + 2 * pre, soort, rol, h, h2, h3: hash(t, q, 503), id: t * 64 + q, t, ruit, balen, taken: null, route: null, rn: 0, rlen: 0, bron: BRON_GEEN, erf: null, akt: new Int8Array(4), nAkt: 0, wDag: -1, droogHier: false };
        this.velden.push(v);
        if (rol & ~(R_KAS | R_HEK)) this.merk(x, y, Math.min(hu, hv), WERK);
        const naam = rol & R_BOL ? 'bollen' : rol & R_BALEN ? 'balen' : rol & R_KUIL ? 'kuilbalen' : rol & R_PLOEG ? 'ploegen' : rol & R_SPROEI ? 'sproeier' : rol & R_PLUK ? 'boomgaard' : rol & R_DRUIF ? 'wijngaard' : rol & R_KAS ? 'kas' : rol & R_MEST ? 'mest' : rol & R_ZAAI ? 'zaaien' : rol & R_HEK ? 'hek' : 'veld';
        this.plek(naam, x, y);
      }
    }
  }

  // ---------- routes en werkplan (samenhang: machines komen ergens vandaan en gaan ergens heen) ----------

  // Is de rechte lijn van (ax, ay) naar (bx, by) te berijden: droog, geen gebouw, grens of bebouwde tegel?
  rijdbaar(ax, ay, bx, by, masker = GEBOUW | GRENS, bomen = false) {
    const l = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(l / 0.8));
    for (let j = 0; j <= k; j++) {
      const x = ax + ((bx - ax) * j) / k, y = ay + ((by - ay) * j) / k;
      if (!this.droog(x, y, 0.35) || !this.vrij(x, y, 0.15, masker) || (bomen && !this.tl.boomvrij(x, y, 0.2))) return false;
    }
    return true;
  }
  // Verbinding van a naar b: recht ([]), of met één hoek langs de richting van het perceel ([hx, hy]), of geen (null).
  verbind(v, ax, ay, bx, by) {
    if (this.rijdbaar(ax, ay, bx, by)) return [];
    const dx = bx - ax, dy = by - ay;
    for (let k = 0; k < 2; k++) {
      const ux = k ? -v.oly : v.olx, uy = k ? v.olx : v.oly, t = dx * ux + dy * uy, hx = ax + ux * t, hy = ay + uy * t;
      if (Math.abs(t) > 0.5 && this.rijdbaar(ax, ay, hx, hy) && this.rijdbaar(hx, hy, bx, by)) return [hx, hy];
    }
    return null;
  }
  rijdbaarPad(pts, van = 0) {
    for (let i = van + 2; i + 1 < pts.length; i += 2) if (!this.rijdbaar(pts[i - 2], pts[i - 1], pts[i], pts[i + 1])) return false;
    return true;
  }
  // Van de parkeerplek op het erf naar de rand van het erf aan de kant van (tx, ty): eerst naar het noorden de
  // uitgang uit, dan om de gebouwen heen langs een hoek van het erf (erfcoördinaten zoals in terrein.js).
  erfUit(e, tx, ty, pts) {
    const op = (u, w) => pts.push(e.x + u * e.co - w * e.si, e.y + u * e.si + w * e.co);
    const du = (tx - e.x) * e.co + (ty - e.y) * e.si, dw = -(tx - e.x) * e.si + (ty - e.y) * e.co;
    op(ERF_P[0], ERF_P[1]); op(ERF_N[0], ERF_N[1]);
    if (dw > -2.0) { const k = du >= 0 ? 1 : -1; op(2.8 * k, -2.15); if (dw > 2.2) op(2.8 * k, 2.25); }
    return pts;
  }
  // Draai de banen zo dat de machine begint en eindigt in de hoek naar (hx, hy); zet het begin (e0) en het eind (x0).
  richt(v, hx, hy) {
    const dx = hx - v.x, dy = hy - v.y, lx = v.olx, ly = v.oly, px = -ly, py = lx;
    const ss = dx * lx + dy * ly < 0 ? 1 : -1, qs = dx * px + dy * py < 0 ? 1 : -1;
    v.lx = lx * ss; v.ly = ly * ss; v.px = px * qs; v.py = py * qs;
    this.baan(v, 0); v.e0x = this.mx; v.e0y = this.my;
    this.baan(v, 1); v.x0x = this.mx; v.x0y = this.my;
  }
  // Parkeerplek op het perceel voor de taken waarbij de machine blijft staan (haspel, plukwagen, druivenwagen).
  parkeer(v) {
    if (v.rol & R_PLUK) {
      const nR = Math.max(1, Math.floor((2 * v.hv - 0.9) / 1.25)), rij = Math.floor(v.h * nR), w = -v.hv + 0.6 + rij * 1.25 + 0.62;
      const u = clamp(v.hu - 1.75, -0.6 * v.hu, 0.6 * v.hu), ww = clamp(w, -0.7 * v.hv, 0.7 * v.hv); // ook in een kleine boomgaard op het perceel
      v.pkx = v.x + v.co * u - v.si * ww; v.pky = v.y + v.si * u + v.co * ww; v.pkhx = v.co; v.pkhy = v.si;
    } else if (v.rol & R_DRUIF) {
      const s0 = clamp(v.L - 0.6, -0.6 * v.L, 0.6 * v.L), q0 = clamp(-v.B + 0.9, -0.6 * v.B, 0.6 * v.B);
      v.pkx = v.x + v.lx * s0 + v.px * q0; v.pky = v.y + v.ly * s0 + v.py * q0; v.pkhx = -v.lx; v.pkhy = -v.ly;
    } else {
      // naast de haspel van de sproeier, aan de kopakker
      const j = Math.floor(v.h * v.nL), q = -v.B + (j + 0.5) * v.bw;
      const s0 = clamp(v.L - 1.25, -0.6 * v.L, 0.6 * v.L);
      v.pkx = v.x + v.lx * s0 + v.px * q; v.pky = v.y + v.ly * s0 + v.py * q; v.pkhx = v.lx; v.pkhy = v.ly;
    }
  }

  // Het werkplan van een perceel: per taak de soort, de dag waarop het werk begint en hoe lang het duurt (dagen).
  // De rijtijden heen en terug komen er na de route bij (kiesRoutes).
  plan(v) {
    const T = [], len = v.padLen, rol = v.rol;
    const zet = (soort, st, duur) => T.push(soort, st, duur, 0, 0);
    if (rol & R_PLOEG) zet(T_PLOEG, 48 + Math.floor(v.h * 50), Math.min(MAX_DUUR.ploeg, len / V_PLOEG));
    if (rol & R_ZAAI) zet(T_ZAAI, 100 + Math.floor(v.h2 * 36), Math.min(MAX_DUUR.zaai, len / V_ZAAI));
    if (rol & R_STOPPEL) {
      const st = 205 + Math.floor(v.h * 36), dM = Math.min(MAX_DUUR.maai, len / V_MAAI);
      zet(T_MAAI, st, dM);
      if (rol & R_BALEN) {
        const dP = Math.min(MAX_DUUR.pers, len / V_PERS), sP = st + dM + 1.5;
        zet(T_PERS, sP, dP);
        zet(T_RAAP, sP + dP + 5, Math.min(MAX_DUUR.raap, len / V_RAAP));
      }
    }
    if (rol & R_KUIL) {
      const st = 140 + Math.floor(v.h * 34), dM = Math.min(MAX_DUUR.kuil, len / V_KUIL), dP = Math.min(MAX_DUUR.pers, len / V_PERS), sP = st + dM + 1.5;
      zet(T_KMAAI, st, dM);
      zet(T_KPERS, sP, dP);
      zet(T_KRAAP, sP + dP + 12, Math.min(MAX_DUUR.raap, len / V_RAAP));
    }
    if (rol & R_SPROEI) { zet(T_BRENG, 150, 0.8); zet(T_BRENG, 246, 0.8); } // even stilstaan: de haspel afkoppelen of aanhaken
    if (rol & R_PLUK) zet(T_PLUK, 222, 50);
    if (rol & R_DRUIF) zet(T_DRUIF, 255, 37);
    return Float32Array.from(T);
  }

  // Waar komen de machines van een perceel vandaan? Van het dichtste erf (de trekker staat daar geparkeerd en rijdt
  // het erf af, eventueel over de veldweg), anders van de dichtste weg (hij draait van de weg af het land op), en
  // pas als er niets in de buurt is vaagt hij in aan de kopakker.
  kiesRoutes() {
    const wegen = this.alleWegen ?? [], kand = [];
    const park = (v) => {
      if (!(v.rol & (R_PLUK | R_DRUIF | R_SPROEI))) return;
      this.parkeer(v);
      // aankomstrichting op de parkeerplek (van de kopakker af): daar draait hij bij aankomst en vertrek geleidelijk
      const ax = v.pkx - v.e0x, ay = v.pky - v.e0y, al = Math.hypot(ax, ay);
      v.pax = al > 0.05 ? ax / al : v.pkhx; v.pay = al > 0.05 ? ay / al : v.pkhy;
    };
    // Een perceel dat bij een nieuwe keuze (een nieuw gebouw ergens) precies zo blijft liggen, houdt zijn route en
    // werkplan: een machine die al onderweg is, springt of verdwijnt dan niet. Alleen als de route nog vrij is.
    const oud = this.vorigPlan, ervenT = this.ervenT ?? (this.ervenT = new Map());
    ervenT.clear();
    for (const e of this.erven) ervenT.set(e.t, e);
    for (const v of this.velden) {
      v.vast = false;
      const c = oud && oud.get(v.id);
      if (c && c.x === v.x && c.y === v.y && c.rol === v.rol && c.olx === v.olx && c.oly === v.oly) {
        const e = c.erfT >= 0 ? ervenT.get(c.erfT) : null;
        if ((c.erfT < 0 || (e && e.x === c.ex && e.y === c.ey)) && this.nogVrij(c)) {
          for (let i = 0; i < VAST_VELD.length; i++) v[VAST_VELD[i]] = c[VAST_VELD[i]];
          v.erf = e; v.vast = true;
          if (e) e.velden.push(v);
          continue;
        }
      }
      v.taken = this.plan(v);
      if (!v.taken.length) continue;
      let keus = null, keusLen = Infinity, bron = BRON_GEEN, erf = null;
      kand.length = 0;
      for (const e of this.erven) { const d = Math.hypot(e.x - v.x, e.y - v.y); if (d < 45) kand.push([d, e]); }
      kand.sort((a, b) => a[0] - b[0] || a[1].t - b[1].t);
      for (let i = 0; i < kand.length && i < 3 && !keus; i++) {
        const e = kand[i][1];
        this.richt(v, e.px, e.py);
        const pts = this.erfUit(e, v.e0x, v.e0y, []);
        let goed = null;
        if (this.rijdbaarPad(pts, 2)) { const n = pts.length, via = this.verbind(v, pts[n - 2], pts[n - 1], v.e0x, v.e0y); if (via) goed = pts.concat(via, [v.e0x, v.e0y]); }
        if (e.laan && e.laan.dood) {
          // over de doodlopende veldweg, als die korter is of de rechte weg geblokkeerd
          const l = e.laan, via = this.erfUit(e, l.ax, l.ay, []), om = this.verbind(v, l.bx, l.by, v.e0x, v.e0y);
          if (om) { via.push(l.ax, l.ay, l.bx, l.by, ...om, v.e0x, v.e0y); if (!goed || padLengte(via) < padLengte(goed)) goed = via; }
        }
        if (goed) { keus = goed; keusLen = padLengte(goed); bron = BRON_ERF; erf = e; }
      }
      // de dichtste wegen: langs elk wegstuk een afrit zoeken waar de machine recht het land op kan (niet tussen de
      // huizen door); hij rijdt eerst een stuk over de weg en draait dan het land op
      kand.length = 0;
      for (let i = 0; i + 3 < wegen.length; i += 4) {
        const ax = wegen[i], ay = wegen[i + 1], bx = wegen[i + 2], by = wegen[i + 3];
        if (v.x < Math.min(ax, bx) - 46 || v.x > Math.max(ax, bx) + 46 || v.y < Math.min(ay, by) - 46 || v.y > Math.max(ay, by) + 46) continue;
        const lx = bx - ax, ly = by - ay, ll = lx * lx + ly * ly || 1, u = clamp(((v.x - ax) * lx + (v.y - ay) * ly) / ll, 0, 1);
        const d = Math.hypot(ax + lx * u - v.x, ay + ly * u - v.y);
        if (d < 45) kand.push([d, i, u]);
      }
      kand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let wq = null;
      for (let i = 0; i < kand.length && i < 6 && !wq; i++) {
        const w0 = kand[i][1], ax = wegen[w0], ay = wegen[w0 + 1], bx = wegen[w0 + 2], by = wegen[w0 + 3], wl = Math.hypot(bx - ax, by - ay);
        if (wl < 1) continue;
        const rx = (bx - ax) / wl, ry = (by - ay) / wl;
        for (let j = 0; j < 15; j++) {
          const u = kand[i][2] + ((j === 0 ? 0 : (j & 1 ? 1 : -1) * Math.ceil(j / 2)) * 3) / wl;
          if (u < 0.02 || u > 0.98) continue;
          const qx = ax + (bx - ax) * u, qy = ay + (by - ay) * u;
          this.richt(v, qx, qy);
          const dx = v.e0x - qx, dy = v.e0y - qy, d = Math.hypot(dx, dy);
          if (d < 2.5 || d > 46) continue;
          const sx = qx + (dx / d) * 1.7, sy = qy + (dy / d) * 1.7;
          // de afrit zelf (van de wegrand het land op) mag niet door een huis aan de weg gaan
          if (!this.rijdbaar(qx + (dx / d) * 0.2, qy + (dy / d) * 0.2, sx, sy)) continue;
          const om = this.verbind(v, sx, sy, v.e0x, v.e0y);
          if (!om) continue;
          if (keus && keusLen < (d - 1.7) * 1.6 + 6) { wq = 'erf'; break; } // het erf is niet veel verder: dan van het erf
          // een stuk weg ervoor (over de weg aanrijden), aan de kant waar de weg langer doorloopt, binnen dit wegstuk
          const k = u * wl > (1 - u) * wl ? -1 : 1, ruimte = Math.min(5, k < 0 ? u * wl : (1 - u) * wl);
          if (ruimte < 2) continue;
          const aanx = qx + rx * k * ruimte, aany = qy + ry * k * ruimte;
          keus = [aanx, aany, qx, qy, sx, sy, ...om, v.e0x, v.e0y]; keusLen = d; bron = BRON_WEG; erf = null; wq = [qx, qy];
          break;
        }
      }
      // geen rechte weg of weg met één hoek: dan over het land zoeken, om huizen, water, bomen en grenzen heen
      let gezocht = false;
      if (!keus) { const z = this.zoekRoute(v); if (z) { keus = z; bron = this.zBron; erf = this.zErf; gezocht = true; } }
      // de banen definitief richten op waar de machine vandaan komt (een gezochte route heeft dat al gedaan)
      if (gezocht) { /* al gericht */ }
      else if (bron === BRON_ERF) this.richt(v, erf.px, erf.py);
      else if (bron === BRON_WEG) this.richt(v, keus[2], keus[3]);
      else this.richt(v, v.x - v.olx, v.y - v.oly);
      park(v);
      if (!keus) {
        // geen erf of weg te bereiken: dan rijdt hij van het land ernaast de kopakker op (en vaagt daar in en uit)
        keus = [v.e0x, v.e0y];
        for (let k = 0; k < 4; k++) {
          const ux = k & 1 ? -v.px : -v.lx, uy = k & 1 ? -v.py : -v.ly, sg = k & 2 ? -1 : 1, ax = v.e0x + ux * sg * 4, ay = v.e0y + uy * sg * 4;
          if (sg < 0 && !(k & 1)) continue; // niet dwars over het eigen perceel
          if (this.rijdbaar(ax, ay, v.e0x, v.e0y)) { keus = [ax, ay, v.e0x, v.e0y]; break; }
        }
      }
      else {
        keus[keus.length - 2] = v.e0x; keus[keus.length - 1] = v.e0y;
        // het laatste stuk recht in de rijrichting van de eerste baan: zo rijdt hij in één lijn de kopakker op
        const n = keus.length, ax = v.e0x - v.lx * 1.2, ay = v.e0y - v.ly * 1.2, px = keus[n - 4], py = keus[n - 3];
        if (n >= 4 && Math.hypot(px - ax, py - ay) > 0.8 && Math.hypot(px - v.e0x, py - v.e0y) > 1.2 && this.rijdbaar(px, py, ax, ay) && this.rijdbaar(ax, ay, v.e0x, v.e0y)) keus.splice(n - 2, 0, ax, ay);
      }
      v.route = Float32Array.from(keus); v.rn = keus.length / 2; v.rlen = padLengte(keus); v.bron = bron; v.erf = erf;
      if (erf) erf.velden.push(v);
      // rijtijden heen en terug (dagen): over de route en het stuk over het perceel naar het werk of de parkeerplek
      const T = v.taken, langs = Math.hypot(v.x0x - v.e0x, v.x0y - v.e0y);
      // op de weg rijdt hij altijd vlotter dan aan het werk (anders haalt de graanwagen de terugrijdende maaidorser in)
      let rij = RIJ;
      for (let o = 0; o < T.length; o += TAAK) if (T[o] <= T_KRAAP && T[o + 2] > 0) rij = Math.max(rij, (1.3 * v.padLen) / T[o + 2]);
      const RIJ_V = rij;
      for (let o = 0; o < T.length; o += TAAK) {
        const baanWerk = T[o] <= T_KRAAP, pk = baanWerk ? 0 : Math.hypot(v.pkx - v.e0x, v.pky - v.e0y), terugPk = baanWerk ? langs : pk;
        const kort = v.rlen < 0.5; // geen aanloop: dan langzaam invagen op de plek
        T[o + 3] = kort ? 0.6 + pk / RIJ_V : (v.rlen + pk) / RIJ_V;
        T[o + 4] = kort ? 0.6 + terugPk / RIJ_V : (v.rlen + terugPk) / RIJ_V;
      }
    }
    this.plannen();
    const nieuw = new Map();
    for (const v of this.velden) {
      if (!v.taken || !v.taken.length || !v.route) continue;
      const c = { x: v.x, y: v.y, rol: v.rol, olx: v.olx, oly: v.oly, erfT: v.erf ? v.erf.t : -1, ex: v.erf ? v.erf.x : 0, ey: v.erf ? v.erf.y : 0 };
      for (let i = 0; i < VAST_VELD.length; i++) c[VAST_VELD[i]] = v[VAST_VELD[i]];
      // welke stukken van de route nu vrij te berijden zijn: die moeten dat bij een volgende keuze nog steeds zijn
      const vrij = new Uint8Array(v.rn);
      for (let i = 1; i < v.rn; i++) vrij[i] = this.rijdbaar(v.route[2 * i - 2], v.route[2 * i - 1], v.route[2 * i], v.route[2 * i + 1]) ? 1 : 0;
      c.vrij = vrij;
      nieuw.set(v.id, c);
    }
    this.vorigPlan = nieuw;
  }

  // Is de onthouden route van een perceel nog te berijden? Elk stuk dat vrij was, moet nog vrij zijn (een nieuw
  // gebouw of een verschoven grens erop: dan opnieuw kiezen).
  nogVrij(c) {
    const R = c.route;
    for (let i = 1; i < c.rn; i++) if (c.vrij[i] && !this.rijdbaar(R[2 * i - 2], R[2 * i - 1], R[2 * i], R[2 * i + 1])) return false;
    return true;
  }

  // Hoe lang (dagen) de graanwagen achter de maaidorser aan rijdt: genoeg afstand dat hij in de bocht aan de
  // kopakker niet op de maaidorser rijdt, en op een kort perceel minstens een baan achter (anders komt hij de
  // maaidorser tegemoet die aan de tweede baan terugkomt). Op een perceel met smalle banen (een klein stukje land) is er geen
  // graanwagen: daar zou hij naast de maaidorser door hem heen rijden (0). Zo ook op een klein perceel (de kavels langs een
  // weg zijn vaak maar vier eenheden breed): daar haalt hij de maaidorser in de keerbocht in.
  naloop(v, duur) { return v.bw < 0.85 || Math.min(v.hu, v.hv) < 2.4 ? 0 : (Math.max(1.8, Math.PI * v.r + 1.0, Math.min(2 * v.L + 0.5, 6)) * duur) / Math.max(1, v.padLen); }

  // Het werkplan zonder botsingen: op een perceel begint een taak pas als de machine van de vorige weer thuis is,
  // en de trekkers van één erf rijden nooit tegelijk over hun gedeelde erfweg en route (de volgende wacht een
  // paar dagen). Wie langer dan 25 dagen zou moeten wachten, gaat toch op de geplande dag.
  plannen() {
    const ritten = [], bezet = [], rel = [];
    const eind = (v, o) => { const T = v.taken; return T[o + 1] + T[o + 2] + T[o + 4] + (T[o] === T_MAAI ? this.naloop(v, T[o + 2]) : 0); };
    const groep = (lijst, metErf) => {
      ritten.length = 0; bezet.length = 0;
      for (const v of lijst) {
        v.vrijNa = -Infinity;
        for (let o = 0; o < v.taken.length; o += TAAK) {
          if (!v.vast) ritten.push([v.taken[o + 1], v, o]);
          else if (metErf && v.taken[o]) bezet.push(v.taken[o + 1] - v.taken[o + 3], v.taken[o + 1], v.taken[o + 1] + v.taken[o + 2], eind(v, o));
        }
      }
      ritten.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id || a[2] - b[2]);
      for (const [, v, o] of ritten) {
        const T = v.taken, tH = T[o + 3], st0 = Math.max(T[o + 1], v.vrijNa + tH + 0.3);
        let st = st0;
        if (metErf) {
          // de eerste dag (in stappen van een kwart dag, hooguit 25 dagen later) waarop de rit niemand van het erf
          // onderweg tegenkomt; is er geen, dan de dag met de kortste overlap (een erf met heel veel percelen)
          let beste = st0, minder = Infinity;
          // alleen de stukken die in het venster van 25 dagen kunnen vallen
          const nl = T[o] === T_MAAI ? this.naloop(v, T[o + 2]) : 0, lo = st0 - tH - 0.3, hi = st0 + 25 + T[o + 2] + T[o + 4] + nl + 0.3;
          rel.length = 0;
          for (let i = 0; i < bezet.length; i += 2) if (bezet[i + 1] > lo && bezet[i] < hi) rel.push(bezet[i], bezet[i + 1]);
          for (let stap = 0; stap <= 100 && minder > 0; stap++) {
            const s0 = st0 + stap * 0.25, h0 = s0 - tH, t0 = s0 + T[o + 2], t1 = t0 + T[o + 4] + nl;
            if (t1 > 362) break; // binnen het jaar klaar
            let over = 0;
            for (let i = 0; i < rel.length; i += 2) {
              const a = rel[i] - 0.3, b = rel[i + 1] + 0.3;
              over += Math.max(0, Math.min(b, s0) - Math.max(a, h0)) + Math.max(0, Math.min(b, t1) - Math.max(a, t0));
            }
            if (over < minder) { minder = over; beste = s0; }
          }
          if (minder > 0) this.nWacht = (this.nWacht ?? 0) + 1;
          st = beste;
          T[o + 1] = st;
          bezet.push(st - tH, st, st + T[o + 2], eind(v, o));
        } else T[o + 1] = st;
        v.vrijNa = eind(v, o);
      }
    };
    for (const e of this.erven) if (e.velden.length) groep(e.velden, true);
    const los = this.losVelden ?? (this.losVelden = []);
    for (const v of this.velden) if (v.taken && v.taken.length && !v.erf) { los.length = 0; los.push(v); groep(los, false); }
    // wat niet meer binnen het jaar af komt, vervalt (soort 0: nooit actief). Valt het ophalen van de balen weg,
    // dan ook het persen: er blijven geen balen liggen tot de jaarwisseling. Zwaden alleen als er een pers komt.
    for (const v of this.velden) {
      const T = v.taken;
      if (!T || !T.length || v.vast) continue;
      const weg = (o) => { T[o] = 0; T[o + 1] = 1e4; };
      for (let o = 0; o < T.length; o += TAAK) if (T[o] && eind(v, o) > 363) weg(o);
      for (let o = 0; o < T.length; o += TAAK) if (T[o] === T_PERS || T[o] === T_KPERS) {
        let raap = false;
        for (let q = 0; q < T.length; q += TAAK) if (T[q] === (T[o] === T_PERS ? T_RAAP : T_KRAAP)) raap = true;
        if (!raap) weg(o);
      }
      v.metPers = false;
      for (let o = 0; o < T.length; o += TAAK) if (T[o] === T_PERS || T[o] === T_KPERS) v.metPers = true;
    }
  }

  // Een route over het land van een erf of een weg naar de kopakker van v, als er geen rechte weg is: breedte-eerst
  // zoeken over het botsraster (vakjes van 2 eenheden, tot 64 eenheden ver), om gebouwen, grenzen, water, bomen,
  // stenen en de gebouwen van de erven heen; daarna rechtgetrokken waar dat vrij kan. Geeft de punten van de route
  // (van de bron naar de kopakker) en zet zBron en zErf, of null.
  zoekRoute(v) {
    const N = RW * RH;
    if (!this.zoekKaart) this.maakZoekKaart();
    const doelErf = this.zoekErf, doelWeg = this.zoekWeg;
    // richt eerst op het dichtste doel (dat bepaalt de hoek waar hij het perceel op rijdt)
    let bx = v.x - v.olx, by = v.y - v.oly, bd = Infinity;
    for (const e of this.erven) { if (!e.uitN) continue; const d = Math.hypot(e.uitN[0] - v.x, e.uitN[1] - v.y); if (d < bd) { bd = d; bx = e.uitN[0]; by = e.uitN[1]; } }
    const W4 = this.alleWegen;
    for (let i = 0; i + 3 < W4.length; i += 4) {
      const ax = W4[i], ay = W4[i + 1], lx = W4[i + 2] - ax, ly = W4[i + 3] - ay, ll = lx * lx + ly * ly || 1, u = clamp(((v.x - ax) * lx + (v.y - ay) * ly) / ll, 0, 1);
      const d = Math.hypot(ax + lx * u - v.x, ay + ly * u - v.y);
      if (d < bd) { bd = d; bx = ax + lx * u; by = ay + ly * u; }
    }
    if (bd > 64) return null;
    this.richt(v, bx, by);
    const pas = this.zoekPas, nr = ++this.zoekNr, stempel = this.zoekStempel, van = this.zoekVan, rij = this.zoekRij;
    const sx = clamp(Math.floor(v.e0x / RC), 0, RW - 1), sy = clamp(Math.floor(v.e0y / RC), 0, RH - 1), start = sy * RW + sx;
    let kop = 0, staart = 0, doel = -1;
    rij[staart++] = start; stempel[start] = nr; van[start] = -1;
    while (kop < staart && doel < 0) {
      const c = rij[kop++], cx = c % RW, cy = (c - cx) / RW;
      for (let k = 0; k < 8 && doel < 0; k++) {
        const dx = k < 4 ? (k & 1 ? 0 : k - 1) : (k & 1 ? 1 : -1), dy = k < 4 ? (k & 1 ? k - 2 : 0) : (k & 2 ? 1 : -1);
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= RW || ny >= RH || Math.abs(nx - sx) > 32 || Math.abs(ny - sy) > 32) continue;
        const n = ny * RW + nx;
        if (stempel[n] === nr) continue;
        // een erfuitgang, of een stuk weg buiten de bebouwing (niet tussen de huizen door het land op)
        if (doelErf[n] >= 0 || (doelWeg[n] >= 0 && !(this.raster[n] & GEBOUW))) { stempel[n] = nr; van[n] = c; doel = n; break; }
        if (!this.pasOp(n)) continue;
        if (dx && dy && (!this.pasOp(cy * RW + nx) || !this.pasOp(ny * RW + cx))) continue; // schuin alleen als beide buren vrij zijn
        stempel[n] = nr; van[n] = c; rij[staart++] = n;
      }
    }
    if (doel < 0) return null;
    // de vakjes van het doel terug naar de kopakker
    const cel = this.zoekPad ?? (this.zoekPad = []);
    cel.length = 0;
    for (let c = van[doel]; c >= 0 && c !== start; c = van[c]) cel.push((c % RW) * RC + RC / 2, Math.floor(c / RW) * RC + RC / 2);
    cel.push(v.e0x, v.e0y);
    const pts = [];
    if (doelErf[doel] >= 0) {
      const e = this.erven[doelErf[doel]];
      pts.push(e.px, e.py, e.uitN[0], e.uitN[1]);
      this.zBron = BRON_ERF; this.zErf = e;
    } else {
      // van de weg af: een stukje over de weg aanrijden (binnen het wegstuk) en dan het land op
      const i = doelWeg[doel], ax = W4[i], ay = W4[i + 1], lx = W4[i + 2] - ax, ly = W4[i + 3] - ay, wl = Math.hypot(lx, ly) || 1;
      const ox = (doel % RW) * RC + RC / 2, oy = Math.floor(doel / RW) * RC + RC / 2, u = clamp(((ox - ax) * lx + (oy - ay) * ly) / (wl * wl), 0, 1);
      const qx = ax + lx * u, qy = ay + ly * u, k = u > 0.5 ? -1 : 1, ruimte = Math.min(5, k < 0 ? u * wl : (1 - u) * wl);
      if (ruimte < 2) return null;
      pts.push(qx + (lx / wl) * k * ruimte, qy + (ly / wl) * k * ruimte, qx, qy);
      this.zBron = BRON_WEG; this.zErf = null;
    }
    // rechttrekken: vanaf het laatste punt steeds naar het verste vakje dat in een rechte lijn vrij te berijden is
    let cx = pts[pts.length - 2], cy = pts[pts.length - 1], i = 0;
    const m = cel.length / 2;
    while (i < m) {
      let j = m - 1;
      while (j > i && !this.zoekVrij(cx, cy, cel[j * 2], cel[j * 2 + 1])) j--;
      cx = cel[j * 2]; cy = cel[j * 2 + 1]; pts.push(cx, cy); i = j + 1;
      if (pts.length > 56) return null; // te bochtig: past niet in het ritpad
    }
    return pts;
  }
  // Waar de zoektocht naartoe mag: de uitgang van elk erf en de vakjes langs de wegen; de gebouwen van de erven
  // zelf zijn dicht (eromheen rijden).
  maakZoekKaart() {
    const N = RW * RH;
    this.zoekKaart = true;
    if (!this.zoekPas) { this.zoekPas = new Int8Array(N); this.zoekStempel = new Int32Array(N); this.zoekVan = new Int32Array(N); this.zoekRij = new Int32Array(N); this.zoekErf = new Int16Array(N); this.zoekWeg = new Int32Array(N); this.zoekNr = 0; }
    if (!this.zoekTegel || this.zoekTegel.length !== this.geo.tegels.length) this.zoekTegel = new Uint8Array(this.geo.tegels.length);
    this.zoekPas.fill(0); this.zoekErf.fill(-1); this.zoekWeg.fill(-1); this.zoekTegel.fill(0);
    const W4 = this.alleWegen;
    for (let i = 0; i + 3 < W4.length; i += 4) {
      const ax = W4[i], ay = W4[i + 1], bx = W4[i + 2], by = W4[i + 3], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.5));
      for (let j = 0; j <= k; j++) {
        const x = ax + ((bx - ax) * j) / k, y = ay + ((by - ay) * j) / k, cx = Math.floor(x / RC), cy = Math.floor(y / RC);
        if (cx >= 0 && cy >= 0 && cx < RW && cy < RH && this.zoekWeg[cy * RW + cx] < 0) this.zoekWeg[cy * RW + cx] = i;
      }
    }
    for (let ei = 0; ei < this.erven.length; ei++) {
      const e = this.erven[ei];
      e.uitN = [e.x + ERF_N[0] * e.co - ERF_N[1] * e.si, e.y + ERF_N[0] * e.si + ERF_N[1] * e.co];
      // de buitenkant van de uitgang (een halve eenheid verder naar het noorden) is het doel; het erf zelf is dicht
      const ux = e.uitN[0] + e.si * 0.9, uy = e.uitN[1] - e.co * 0.9;
      for (let cy = Math.max(0, Math.floor((e.y - 4) / RC)); cy <= Math.min(RH - 1, Math.floor((e.y + 4) / RC)); cy++)
        for (let cx = Math.max(0, Math.floor((e.x - 4) / RC)); cx <= Math.min(RW - 1, Math.floor((e.x + 4) / RC)); cx++) {
          const x = cx * RC + 1 - e.x, y = cy * RC + 1 - e.y, u = x * e.co + y * e.si, w = -x * e.si + y * e.co;
          if (Math.abs(u) < 3.0 && w > -1.9 && w < 2.8) this.zoekPas[cy * RW + cx] = 2;
        }
      const c = clamp(Math.floor(uy / RC), 0, RH - 1) * RW + clamp(Math.floor(ux / RC), 0, RW - 1);
      if (this.zoekPas[c] !== 2) this.zoekErf[c] = ei;
    }
  }
  // Is vakje c te berijden (droog, geen gebouw of grens, geen boom, steen, plas of boerderij)? Onthouden per vakje.
  // Bomen en stenen worden per tegel in één keer op de zoekkaart gezet (met de buurtegels: ze steken over de rand).
  pasOp(c) {
    const p = this.zoekPas[c];
    if (p) return p === 1;
    const x = (c % RW) * RC + RC / 2, y = Math.floor(c / RW) * RC + RC / 2, geo = this.geo, Tw = geo.T;
    const tk = clamp(Math.floor(x / Tw), 0, geo.kol - 1), tr = clamp(Math.floor(y / Tw), 0, geo.rij - 1);
    for (let r = Math.max(0, tr - 1); r <= Math.min(geo.rij - 1, tr + 1); r++) for (let k = Math.max(0, tk - 1); k <= Math.min(geo.kol - 1, tk + 1); k++) this.zoekBomen(r * geo.kol + k);
    const ok = !this.zoekPas[c] && !(this.raster[c] & (GEBOUW | GRENS)) && this.droog(x, y, 0.6);
    this.zoekPas[c] = ok ? 1 : 2;
    return ok;
  }
  // Zet de bomen, stenen, plassen en boerderijen van tegel t als dichte vakjes op de zoekkaart (zoals boomvrij in
  // terrein.js met 0,3 marge, maar één keer per tegel).
  zoekBomen(t) {
    if (this.zoekTegel[t]) return;
    this.zoekTegel[t] = 1;
    const b = this.tl?.basis;
    if (!b) return;
    const K = KENMERK, tg = this.geo.tegels[t], f = kenmerkenVoorTegel(tg, b), pas = this.zoekPas;
    for (let p = 0; p < f.length; p += STAP) {
      const ty = f[p];
      const straal = ty === K.BOOM || ty === K.LOSBOOM || ty === K.ROTS || ty === K.STEEN ? f[p + 3] : ty === BERGMEER ? f[p + 3] + 0.4 : ty === K.PLAS ? f[p + 3] + 0.2 : ty === BOERDERIJ ? 2.8 : -1;
      if (straal < 0) continue;
      const x = tg.x + f[p + 1], y = tg.y + f[p + 2], rr = straal + 0.3;
      const c0 = Math.max(0, Math.floor((x - rr - 1) / RC)), c1 = Math.min(RW - 1, Math.floor((x + rr + 1) / RC));
      const r0 = Math.max(0, Math.floor((y - rr - 1) / RC)), r1 = Math.min(RH - 1, Math.floor((y + rr + 1) / RC));
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const dx = cx * RC + RC / 2 - x, dy = cy * RC + RC / 2 - y, c = cy * RW + cx;
        if (dx * dx + dy * dy < rr * rr && this.zoekErf[c] < 0) pas[c] = 2;
      }
    }
  }
  // Is de rechte lijn over de zoekkaart vrij (elke 0,8 eenheid een vakje dat te berijden is)?
  zoekVrij(ax, ay, bx, by) {
    const l = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(l / 0.8));
    for (let j = 0; j <= k; j++) {
      const x = ax + ((bx - ax) * j) / k, y = ay + ((by - ay) * j) / k, cx = Math.floor(x / RC), cy = Math.floor(y / RC);
      if (cx < 0 || cy < 0 || cx >= RW || cy >= RH || !this.pasOp(cy * RW + cx)) return false;
    }
    return true;
  }

  // Ritten van en naar de erven: de wagen komt over de weg aanrijden, slaat de erfweg in, staat even op het erf en
  // rijdt de weg weer op. De sneeuwschuiver rijdt van de parkeerplek over het erf en de erfweg en terug.
  kiesErfritten() {
    for (const e of this.erven) {
      e.kleur = Math.floor(e.z * 4);
      const l = e.laan;
      if (!l) continue;
      const sp = this.erfUit(e, l.ax, l.ay, []);
      sp.push(l.ax, l.ay, l.bx, l.by);
      e.spad = Float32Array.from(sp); e.spadN = sp.length / 2; e.spadLen = padLengte(sp);
      if (l.dood || l.qx === undefined) continue;
      const r0x = l.qx - l.rx * 6, r0y = l.qy - l.ry * 6, r1x = l.qx + l.rx * 6, r1y = l.qy + l.ry * 6;
      const heen = [r0x, r0y, l.qx, l.qy, l.bx, l.by, l.ax, l.ay], uit = [l.ax, l.ay, l.bx, l.by, l.qx, l.qy, r1x, r1y];
      e.rin = Float32Array.from(heen); e.rinLen = padLengte(heen); e.ruit = Float32Array.from(uit); e.ruitLen = padLengte(uit);
      // de rit (klok in tellen, 3 eenheden per tel): aanrijden, 30 tellen op het erf, wegrijden, en een tijd niets
      e.tIn = e.rinLen / 3; e.tStop = 30; e.tUit = e.ruitLen / 3;
      e.P = Math.max(70 + e.z * 70, e.tIn + e.tStop + e.tUit + 25);
    }
  }

  // Punt op afstand d langs een polylijn (pts, n punten) in this.qx, this.qy.
  padXY(pts, n, d) {
    for (let i = 1; i < n; i++) {
      const ax = pts[i * 2 - 2], ay = pts[i * 2 - 1], bx = pts[i * 2], by = pts[i * 2 + 1], l = Math.hypot(bx - ax, by - ay);
      if (d <= l || i === n - 1) { const f = l > 0 ? clamp(d / l, 0, 1) : 0; this.qx = ax + (bx - ax) * f; this.qy = ay + (by - ay) * f; return; }
      d -= l;
    }
    this.qx = pts[0]; this.qy = pts[1];
  }
  // Stand op afstand d langs een polylijn van lengte L, in mx, my, mhx, mhy. Bij elke hoek draait de richting
  // geleidelijk van het ene stuk naar het volgende (over 0,6 eenheid ervoor en erna, of minder bij korte stukken),
  // ook bij een haarspeldbocht; aan het begin en het eind draait hij helemaal naar (h0x, h0y) en (h1x, h1y), zodat
  // hij precies aansluit op de stand ervoor en erna (0, 0: geen eis).
  langsPad(pts, n, L, d, h0x, h0y, h1x, h1y) {
    const D = 0.6;
    d = clamp(d, 0, L);
    let i = 1, rest = d, l = 0;
    for (; i < n; i++) { l = Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]); if (rest <= l || i >= n - 1) break; rest -= l; }
    if (n < 2) { this.mx = pts[0]; this.my = pts[1]; this.mhx = h1x || h0x || 1; this.mhy = h1y || h0y; return; }
    i = Math.min(i, n - 1);
    const ax = pts[i * 2 - 2], ay = pts[i * 2 - 1], bx = pts[i * 2], by = pts[i * 2 + 1], f = l > 0 ? clamp(rest / l, 0, 1) : 0;
    const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
    let hoek = this.segHoek(pts, n, i);
    if (i < n - 1 && l - rest < D) {
      const l2 = Math.hypot(pts[i * 2 + 2] - bx, pts[i * 2 + 3] - by), Dk = Math.min(D, l / 2, l2 / 2);
      if (Dk > 1e-4 && l - rest < Dk) hoek = hoekNaar(hoek, this.segHoek(pts, n, i + 1), smooth(-Dk, Dk, rest - l));
    } else if (i > 1 && rest < D) {
      const l0 = Math.hypot(ax - pts[i * 2 - 4], ay - pts[i * 2 - 3]), Dk = Math.min(D, l / 2, l0 / 2);
      if (Dk > 1e-4 && rest < Dk) hoek = hoekNaar(this.segHoek(pts, n, i - 1), hoek, smooth(-Dk, Dk, rest));
    }
    // (een vaste draai ten opzichte van het eerste of laatste stuk, die geleidelijk bijkomt: zo klapt hij ook bij een
    // tegengestelde richting niet om)
    const B = Math.min(1.4, L * 0.45);
    if ((h1x || h1y) && d > L - B) hoek += wrapHoek(Math.atan2(h1y, h1x) - this.segHoek(pts, n, n - 1)) * smooth(L - B, L, d);
    if ((h0x || h0y) && d < B) hoek += wrapHoek(Math.atan2(h0y, h0x) - this.segHoek(pts, n, 1)) * (1 - smooth(0, B, d));
    this.mx = x; this.my = y; this.mhx = Math.cos(hoek); this.mhy = Math.sin(hoek);
  }
  // Richting (hoek) van stuk i van een polylijn; een stuk zonder lengte neemt de richting van een buurstuk.
  segHoek(pts, n, i) {
    for (let k = 0; k < n; k++) {
      const j = k & 1 ? i + ((k + 1) >> 1) : i - (k >> 1);
      if (j < 1 || j > n - 1) continue;
      const dx = pts[j * 2] - pts[j * 2 - 2], dy = pts[j * 2 + 1] - pts[j * 2 - 1];
      if (dx * dx + dy * dy > 1e-8) return Math.atan2(dy, dx);
    }
    return 0;
  }

  // Waar is de machine van taak k op perceel v op dag dj (doorlopend)? 0: nergens. Anders staat de stand in mx, my,
  // mhx, mhy, de dekking in ma en het deel van het werk (0..1) in mw; 1 heen, 2 aan het werk, 3 terug.
  rit(v, k, dj) {
    const T = v.taken, o = k * TAAK, soort = T[o], st = T[o + 1], duur = T[o + 2], tH = T[o + 3], tT = T[o + 4];
    const t = dj - st;
    if (t < -tH || t >= duur + tT) return 0;
    const baanWerk = soort <= T_KRAAP, pad = this.ritPad ?? (this.ritPad = new Float32Array(64));
    this.ma = 1; this.mw = 0; this.mturn = 0; this.mdb = Infinity;
    if (t >= 0 && t < duur) {
      this.mw = t / duur;
      if (baanWerk) this.baan(v, this.mw);
      else {
        // geparkeerd: bij aankomst draait hij van de aankomstrichting naar zijn stand, bij vertrek naar de terugweg
        const tw = Math.min(0.4, duur * 0.3), a0 = Math.atan2(v.pay, v.pax), a1 = Math.atan2(v.pkhy, v.pkhx), a2 = Math.atan2(-v.pay, -v.pax);
        const h = t < duur - tw ? hoekNaar(a0, a1, smooth(0, tw, t)) : hoekNaar(a1, a2, smooth(duur - tw, duur, t));
        this.mx = v.pkx; this.my = v.pky; this.mhx = Math.cos(h); this.mhy = Math.sin(h); this.li = -1;
      }
      return 2;
    }
    const R = v.route, rn = v.rn;
    let n = 0;
    if (t < 0) {
      // heen: van de bron over de route naar het begin van het werk (of door naar de parkeerplek)
      for (let i = 0; i < rn; i++) { pad[n * 2] = R[i * 2]; pad[n * 2 + 1] = R[i * 2 + 1]; n++; }
      if (!baanWerk) { pad[n * 2] = v.pkx; pad[n * 2 + 1] = v.pky; n++; }
      const L = padLengte(pad, n), f = (t + tH) / tH, d = f * L;
      if (baanWerk) this.langsPad(pad, n, L, d, 0, 0, v.lx, v.ly); else this.langsPad(pad, n, L, d, 0, 0, v.pax, v.pay);
      // invagen over de eerste anderhalve eenheid: bij de weg, op het land ernaast, of voor de schuur op het erf
      // (daar vaagt de geparkeerde trekker tegelijk uit)
      this.mdb = d;
      this.ma = v.rlen >= 0.5 ? smooth(0, 1.5, d) : smooth(0, 1, f);
      this.li = -1;
      return 1;
    }
    // terug: langs de kopakker naar het begin, en de route terug naar de bron
    pad[0] = baanWerk ? v.x0x : v.pkx; pad[1] = baanWerk ? v.x0y : v.pky; n = 1;
    for (let i = rn - 1; i >= 0; i--) { pad[n * 2] = R[i * 2]; pad[n * 2 + 1] = R[i * 2 + 1]; n++; }
    const L = padLengte(pad, n), f = (t - duur) / tT, d = f * L;
    if (baanWerk) this.langsPad(pad, n, L, d, -v.lx, -v.ly, 0, 0); else this.langsPad(pad, n, L, d, -v.pax, -v.pay, 0, 0);
    this.mdb = L - d;
    this.ma = v.rlen >= 0.5 ? smooth(0, 1.5, L - d) : 1 - smooth(0, 1, f);
    this.li = -1;
    return 3;
  }

  // Dekking van de trekker die thuis op het erf staat: 1 als er geen op pad is; elke trekker van het erf die op pad
  // is vaagt voor de schuur in terwijl de geparkeerde uitvaagt (en omgekeerd bij thuiskomst), zodat er nooit een
  // trekker op het erf verschijnt of verdwijnt.
  erfThuis(e, dj) {
    let thuis = 1;
    for (const v of e.velden) {
      const T = v.taken;
      for (let o = 0, k = 0; o < T.length; o += TAAK, k++) {
        // bij het maaien rijdt de trekker met de graanwagen van het erf (de maaidorser heeft een eigen plek in de schuur)
        const dl = T[o] === T_MAAI ? this.naloop(v, T[o + 2]) : 0, t = dj - dl - T[o + 1];
        if (T[o] === T_MAAI && !dl) continue;
        if (t < -T[o + 3] || t >= T[o + 2] + T[o + 4]) continue;
        if (this.rit(v, k, dj - dl)) thuis *= 1 - smooth(0, 1.5, this.mdb);
      }
    }
    return thuis;
  }

  // Kaalslag of herplant op een open plek aan de bosrand, met een stapel stammen aan de rand van de plek.
  kiesBos() {
    const geo = this.geo, Tw = geo.T, s = this.state, tl = this.tl;
    for (let t = 0; t < geo.tegels.length && this.kaal.length < MAX_KAAL; t++) {
      const tg = geo.tegels[t];
      if (tg.terrein !== 'bos' || tg.eig < 0 || s.bezet[t] || this.soort[t] || this.levenHert(t)) continue;
      if (hash(t, 601) >= (this.houtkap[tg.eig] ? 0.45 : 0.16)) continue;
      let best = null, bo = 0.72;
      for (let q = 0; q < 16; q++) {
        const x = tg.x + ((q & 3) - 1.5) * (Tw / 4.4), y = tg.y + ((q >> 2) - 1.5) * (Tw / 4.4);
        const o = tl.openPlek(x, y);
        if (o <= bo || tl.gewicht(x, y).bos < 0.5 || !this.landVrij(x, y, 2.8)) continue;
        bo = o; best = [x, y];
      }
      if (!best) continue;
      const [x, y] = best, r = 1.9 + hash(t, 602) * 0.6, herplant = hash(t, 603) < 0.35;
      const a = hash(t, 604) * TAU;
      const k = { x, y, r, herplant, z: hash(t, 605), hoek: a, sx: x + Math.cos(a) * (r - 0.4), sy: y + Math.sin(a) * (r - 0.4), truck: !herplant && hash(t, 606) < 0.65, t };
      this.merk(x, y, r + 0.6, WERK);
      this.kaal.push(k);
      this.plek(herplant ? 'herplant' : 'kaalslag', x, y);
    }
  }

  // ---------- tekenen ----------

  kader(view, sc) {
    const [wx0, wy0] = view.naarWereld(0, 0);
    const [wx1, wy1] = view.naarWereld(view.w, view.h);
    this.sc = sc;
    this.ox = view.w / 2 - view.cx * sc;
    this.oy = view.h / 2 - view.cy * sc;
    this.wx0 = wx0; this.wy0 = wy0; this.wx1 = wx1; this.wy1 = wy1;
    this.dpr = view.dpr || 1;
    this.P = emmer(sc * this.dpr);
    this.px = 1 / sc; // één schermpixel in wereldeenheden
  }
  inBeeld(x, y, m) { return x >= this.wx0 - m && x <= this.wx1 + m && y >= this.wy0 - m && y <= this.wy1 + m; }

  zetLicht(x, y, r, soort, a) {
    if (this.nLicht >= PLAFOND.lichten || !this.inBeeld(x, y, r)) return;
    const o = this.nLicht++ * LICHT, b = this.licht;
    b[o] = x; b[o + 1] = y; b[o + 2] = r; b[o + 3] = soort; b[o + 4] = a;
  }

  haal(sleutel) {
    const e = this.cache.get(sleutel);
    if (e) { this.cache.delete(sleutel); this.cache.set(sleutel, e); }
    return e;
  }
  // Bak een bitmap van bw x bh wereldeenheden op P pixels per eenheid (LRU, hooguit PLAFOND.bakken per beeld).
  bak(sleutel, basis, bw, bh, fn, obj) {
    const oud = this.haal(sleutel);
    if (oud) return oud;
    if (this.bakTeller >= PLAFOND.bakken) return this.laatste.get(basis) ?? null;
    const P = this.P, Wp = Math.max(2, Math.ceil(bw * P)), Hp = Math.max(2, Math.ceil(bh * P));
    const cv = fabriek(Wp, Hp);
    if (!cv) return null;
    this.bakTeller++;
    const g = cv.getContext('2d');
    g.setTransform(P, 0, 0, P, Wp / 2, Hp / 2);
    fn(g, obj, { sn: this.sn });
    const e = { cv, bw, bh, bytes: Wp * Hp * 4, basis };
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

  // C12: alleen op gebakken grond (terrein knipt het canvas tot de gebakken brokken; niets gebakken: niets tekenen)
  teken(c, view, sc, nu, dt = 0, tempo = 0) {
    const klem = view?.terreinLaag?.klemOpGebakken?.(c) ?? 1;
    if (!klem) { if (tempo > 0) this.klok += dt; this.nul(); return; }
    try { return this.tekenOpGrond(c, view, sc, nu, dt, tempo); } finally { if (klem === 2) c.restore(); }
  }
  tekenOpGrond(c, view, sc, nu, dt = 0, tempo = 0) {
    if (tempo > 0) this.klok += dt;
    this.beeldNr = (this.beeldNr ?? 0) + 1;
    this.nul();
    const s = view.state;
    if (!s || !view.geo || !view.w || !view.eigenaar) return;
    // doorlopende dag: de speldag plus het deel dat sinds de laatste dagwissel verstreken is (een dag is een tel op
    // tempo 1). Machines op het land bewegen hiermee, zodat ze stilstaan bij pauze en niet springen bij een nieuwe dag.
    // sinds: de tijd sinds de dagwissel (zoals de teller in main.js, met het restje van dit beeld). dagFrac is wat we
    // tonen: bij een gewone dagwissel loopt die gewoon door (eventueel even onder 0) en haalt sinds dan geleidelijk in,
    // zodat er ook geen sprong is als de eerste dag na het laden korter duurde dan de laag dacht. Bij een grotere
    // sprong in de dagen (laden, terugspoelen) begint alles opnieuw op 0.
    const stap = tempo > 0 ? dt * tempo : 0;
    if (s.dag !== this.dagNr) {
      const door = s.dag === this.dagNr + 1;
      this.sinds = door ? clamp((this.sinds ?? 0) + stap - 1, 0, 0.3) : 0;
      this.dagFrac = door ? clamp((this.dagFrac ?? 0) + stap - 1, -1, 0.995) : 0;
      this.dagNr = s.dag;
    } else if (stap > 0) {
      this.sinds = Math.min(0.995, (this.sinds ?? 0) + stap);
      this.dagFrac = Math.min(0.995, this.dagFrac + stap + (this.sinds - this.dagFrac) * (1 - Math.exp(-dt * 2)));
    }
    this.dj = (((s.dag + (this.dagFrac ?? 0)) % 365) + 365) % 365;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar || (view.terreinLaag?.basis && view.terreinLaag.basis !== this.basis)) this.laad(view);
    const z = view.zoom;
    this.zoom = z;
    if (z < DREMPEL.grof - 0.4) { this.vervaag = 0; return; }
    this.werkCache(view);
    this.kader(view, sc);
    this.sz = seizoen(s.dag);
    this.dag = this.sz.dagInJaar;
    this.wr = weer(s.dag, view.cx, view.cy);
    this.wd = wind(s.dag);
    this.sn = this.sz.sneeuw > 0.25 ? 1 : 0;
    this.nacht = view.nacht ?? 0;
    this.licht0 = this.nacht < 0.55; // werktijd: overdag
    this.dagMens = 1 - smooth(0.42, 0.6, this.nacht); // mensen op het land gaan bij het donker naar huis
    this.droogWeer = this.wr.regen < 0.05 && this.wr.wolken < 0.6;
    this.nat = this.wr.regen > 0.45;
    this.nu = nu;
    this.cxv = view.cx; this.cyv = view.cy;
    this.bakTeller = 0;
    this.gloed ??= LICHTKLEUR.map((k) => { const cv = fabriek(32, 32); if (cv) bakGloed(cv, k); return cv; });
    const a = smooth(3.6, 4.4, z);
    this.vervaag = a;
    c.save();
    c.transform(sc, 0, 0, sc, this.ox, this.oy);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    // elke stap begint met de dekking van de laag: sommige stappen laten een eigen (lagere) dekking achter
    c.globalAlpha = a;
    this.tekenGroeven(c, z);
    c.globalAlpha = a;
    this.tekenVelden(c, z, a);
    c.globalAlpha = a;
    this.tekenBos(c, z, a);
    c.globalAlpha = a;
    this.tekenErven(c, z, a);
    if (z >= DREMPEL.baal - 0.5) this.tekenBalen(c, a * smooth(DREMPEL.baal - 0.5, DREMPEL.baal + 0.3, z));
    if (z >= DREMPEL.machine - 0.5) this.tekenVoertuigen(c, a * smooth(DREMPEL.machine - 0.5, DREMPEL.machine + 0.3, z), z);
    if (z >= DREMPEL.jaknik - 0.5) this.tekenJaknikkers(c, a * smooth(DREMPEL.jaknik - 0.5, DREMPEL.jaknik + 0.3, z), z);
    if (z >= DREMPEL.mens - 0.5) this.tekenMensen(c, a * smooth(DREMPEL.mens - 0.5, DREMPEL.mens + 0.3, z) * this.dagMens);
    c.globalAlpha = a;
    this.tekenHoog(c, z, a);
    c.restore();
    this.n.lichten = this.nLicht;
  }

  // ---------- voertuigen, balen, mensen en meeuwen verzamelen ----------

  zetVoertuig(x, y, hx, hy, soort, kleur, aanbouw = A_GEEN, lading = L_GEEN, schaal = 1, dekking = 1, vol = 1) {
    if (dekking < 0.03 || this.nVw >= PLAFOND.machines || !this.inBeeld(x, y, 2)) return;
    const o = this.nVw++ * VW, b = this.vw;
    b[o] = x; b[o + 1] = y; b[o + 2] = hx; b[o + 3] = hy; b[o + 4] = soort; b[o + 5] = kleur; b[o + 6] = aanbouw; b[o + 7] = lading; b[o + 8] = schaal; b[o + 9] = dekking; b[o + 10] = vol;
  }
  zetBaal(x, y, soort, hoek) {
    if (this.nBaal >= PLAFOND.balen || !this.inBeeld(x, y, 0.5)) return;
    const o = this.nBaal++ * 4; this.baal[o] = x; this.baal[o + 1] = y; this.baal[o + 2] = soort; this.baal[o + 3] = hoek;
  }
  zetMens(x, y, kleur, buk) {
    if (this.nMens >= PLAFOND.plukkers || !this.inBeeld(x, y, 0.3)) return;
    const o = this.nMens++ * 4; this.mens[o] = x; this.mens[o + 1] = y; this.mens[o + 2] = kleur; this.mens[o + 3] = buk;
  }
  zetMeeuw(x, y, hoogte, slag) {
    if (this.nMeeuw >= PLAFOND.meeuwen || !this.inBeeld(x, y, 1)) return;
    const o = this.nMeeuw++ * 4; this.meeuw[o] = x; this.meeuw[o + 1] = y; this.meeuw[o + 2] = hoogte; this.meeuw[o + 3] = slag;
  }

  // Een machine die baan voor baan over het perceel gaat; fase 0..1 over het hele pad. Het pad begint met een
  // aanloop op de kopakker, keert aan het eind van elke baan in een halve cirkel naar de volgende (geen sprong
  // opzij) en eindigt met een uitloop naar de hoek waar hij begon (het aantal banen is even).
  // Zet mx, my (plek), mhx, mhy (richting), li (baan), ms (plek langs de baan), mdir en mturn (0, of 0..1 in de bocht).
  baan(v, fase) {
    const Lp = v.Lp, r = v.r, pre = v.pre, seg = 2 * Lp + Math.PI * r;
    let d = clamp(fase, 0, 1) * v.padLen, li = 0, s, q, hs, hq, turn = 0;
    if (d < pre) { s = -Lp - pre + d; q = -v.B + 0.5 * v.bw; hs = 1; hq = 0; }
    else {
      d -= pre;
      li = Math.min(v.nL - 1, Math.floor(d / seg));
      const w = d - li * seg, dir = li & 1 ? -1 : 1;
      if (w < 2 * Lp || li === v.nL - 1) { s = dir * (-Lp + w); q = -v.B + (li + 0.5) * v.bw; hs = dir; hq = 0; }
      else {
        const f = Math.min(1, (w - 2 * Lp) / (Math.PI * r)), a = Math.PI * f;
        s = dir * (Lp + r * Math.sin(a)); q = -v.B + (li + 1) * v.bw - r * Math.cos(a);
        hs = dir * Math.cos(a); hq = Math.sin(a); turn = Math.max(1e-4, f);
      }
    }
    const dir = li & 1 ? -1 : 1;
    this.mx = v.x + v.lx * s + v.px * q; this.my = v.y + v.ly * s + v.py * q;
    this.mhx = v.lx * hs + v.px * hq; this.mhy = v.ly * hs + v.py * hq; this.li = li; this.ms = s; this.mdir = dir; this.mturn = turn;
  }
  vak(c, v, s0, s1, q0, q1) {
    const x = v.x, y = v.y, lx = v.lx, ly = v.ly, px = v.px, py = v.py;
    c.moveTo(x + lx * s0 + px * q0, y + ly * s0 + py * q0); c.lineTo(x + lx * s1 + px * q0, y + ly * s1 + py * q0);
    c.lineTo(x + lx * s1 + px * q1, y + ly * s1 + py * q1); c.lineTo(x + lx * s0 + px * q1, y + ly * s0 + py * q1); c.closePath();
  }
  // Het bewerkte deel: afgewerkte banen plus het stuk van de huidige baan achter de machine (in de bocht is de baan af).
  gewerkt(c, v) {
    const w = (2 * v.B) / v.nL, klaar = this.li + (this.mturn > 0 ? 1 : 0);
    if (klaar > 0) this.vak(c, v, -v.L, v.L, -v.B, -v.B + klaar * w);
    if (this.mturn > 0 || this.li >= v.nL) return;
    const st = this.mdir > 0 ? -v.L : v.L, ms = clamp(this.ms, -v.L, v.L);
    this.vak(c, v, Math.min(st, ms), Math.max(st, ms), -v.B + this.li * w, -v.B + (this.li + 1) * w);
  }
  // Lijnen langs de rijen over het hele perceel (of tot de machine: tot = aantal afgewerkte banen).
  rijen(c, v, tussen, tot = v.nL) {
    const w = (2 * v.B) / v.nL, q1 = -v.B + tot * w;
    for (let q = -v.B + tussen / 2; q < q1 && q < v.B; q += tussen) {
      c.moveTo(v.x + v.lx * -v.L + v.px * q, v.y + v.ly * -v.L + v.py * q);
      c.lineTo(v.x + v.lx * v.L + v.px * q, v.y + v.ly * v.L + v.py * q);
    }
  }

  // Waar staat elk perceel nu? Zet de vlaggen in v.f (bits), de fase van het werk in v.fase en de taken waarvan de
  // machine onderweg of aan het werk is in v.akt (v.nAkt). Alles volgt het werkplan op de doorlopende dag dj: wat
  // achter de machine verandert (voren, stoppel, zwaden, balen) groeit mee met waar hij is.
  stand(v) {
    const d = this.dag, dj = this.dj, T = v.taken;
    let f = 0;
    v.fase = -1; v.nAkt = 0; v.zwad = v.nL;
    let gemaaid = false;
    if (T) for (let o = 0, k = 0; o < T.length; o += TAAK, k++) {
      const soort = T[o], st = T[o + 1], duur = T[o + 2], t = dj - st;
      // onderweg of aan het werk (de graanwagen rijdt nog even na de maaidorser)
      if (t >= -T[o + 3] && t < duur + T[o + 4] + (soort === T_MAAI ? this.naloop(v, duur) + 0.05 : 0) && v.nAkt < 4) v.akt[v.nAkt++] = k;
      const bezig = t >= 0 && t < duur, klaar = t >= duur;
      switch (soort) {
        case T_PLOEG: if (bezig) { f |= 1; v.fase = t / duur; } else if (klaar && d < 140) f |= 2; break;
        case T_ZAAI: if (bezig) { f |= 4; v.fase = t / duur; } else if (klaar && t < duur + 24) f |= 8; break;
        case T_MAAI:
          if (bezig) {
            f |= 262144; v.fase = t / duur;
            if (v.metPers) { this.baan(v, v.fase); f |= 32; v.zwad = this.li + (this.mturn > 0 ? 1 : 0); }
          } else if (klaar) { gemaaid = true; if (d < 292) f |= 16; }
          break;
        case T_KMAAI:
          if (bezig) { if (v.metPers) { this.baan(v, t / duur); f |= 32; v.zwad = this.li + (this.mturn > 0 ? 1 : 0); } } else if (klaar) gemaaid = true;
          break;
        case T_PERS: case T_KPERS:
          // de zwaden liggen van het maaien tot de pers ze oppakt (ook als de pers een paar dagen moet wachten)
          if (t < 0) { if (gemaaid) f |= 32; }
          else if (bezig) { f |= 64; v.fase = t / duur; } else if (klaar) f |= 128;
          break;
        case T_RAAP: case T_KRAAP:
          if (bezig) { f &= ~128; f |= 524288; v.fase = t / duur; } else if (klaar) f &= ~128;
          break;
        case T_PLUK: if (bezig) { f |= 4096; v.plukT = t; v.plukD = duur; } break;
        case T_DRUIF: if (bezig) { f |= 16384; v.plukT = t; v.plukD = duur; } break;
      }
    }
    if (v.rol & R_SPROEI) {
      // de haspel staat er van de eerste brengrit (aankomst) tot de tweede
      let o1 = -1, o2 = -1;
      for (let o = 0; o < T.length; o += TAAK) if (T[o] === T_BRENG) { if (o1 < 0) o1 = o; o2 = o; }
      if (o1 >= 0 && dj >= T[o1 + 1] && dj < T[o2 + 1]) f |= 256;
    }
    if ((v.rol & R_MEST) && (d >= 300 || d < 76)) f |= 512;
    if (v.rol & R_BOL) { if (d >= 88 && d < 136) f |= 1024; else if (d >= 136 && d < 152) f |= 2048; }
    if ((v.rol & R_BIJ) && d >= (v.soort === KOOLZAAD ? 100 : 86) && d < 150) f |= 8192;
    if ((v.rol & R_SCHRIK) && d >= 75 && d < 266) f |= 32768;
    if ((v.rol & R_HEK) && this.zoom >= DREMPEL.hek - 0.5) f |= 65536;
    if (v.rol & R_KAS) f |= 131072;
    v.f = f;
    return f;
  }

  // De machine van taak k op perceel v: zet hem in de voertuigbuffer, met koplampen in het donker.
  machine(v, k, z) {
    const T = v.taken, o = k * TAAK, soort = T[o], dj = this.dj;
    let r = this.rit(v, k, dj);
    const kl = v.erf ? v.erf.kleur : Math.floor(v.h2 * TREKKER_KLEUR.length);
    if (r) {
      const x = this.mx, y = this.my, hx = this.mhx, hy = this.mhy, dk = this.ma, w = this.mw;
      let sv = TREKKER, kleur = kl, ab = A_GEEN, lad = L_GEEN, sch = 1, vol = 1;
      if (soort === T_PLOEG) ab = A_PLOEG;
      else if (soort === T_ZAAI) ab = A_ZAAI;
      else if (soort === T_MAAI) { sv = MAAIER; kleur = K_MAAIER + (v.h3 < 0.5 ? 0 : 1); ab = A_MAAI; }
      else if (soort === T_KMAAI) ab = A_MAAIBALK;
      else if (soort === T_PERS || soort === T_KPERS) ab = A_PERS;
      else if (soort === T_RAAP || soort === T_KRAAP) { ab = A_WAGEN; lad = L_BALEN; vol = r === 1 ? 0 : r === 2 ? w : 1; }
      else if (soort === T_BRENG) ab = A_WAGEN;
      else if (soort === T_PLUK) ab = A_KISTEN;
      else if (soort === T_DRUIF) { sv = SMALSPOOR; kleur = Math.floor(v.h3 * 4); ab = A_KISTEN; sch = 0.8; }
      this.zetVoertuig(x, y, hx, hy, sv, kleur, ab, lad, sch, dk, vol);
      if (this.nacht > 0.3) this.zetLicht(x + hx * 0.7, y + hy * 0.7, 1.0, WARM, 0.7 * dk);
      // meeuwen achter de ploeg: ze komen van ver aanvliegen en gaan bij het donker weg
      if (soort === T_PLOEG && r === 2 && z >= DREMPEL.meeuw) {
        const kom = this.dagMens * smooth(0, 0.04, w) * (1 - smooth(0.96, 1, w));
        if (kom > 0.02) for (let j = 0; j < 5; j++) {
          const nu = this.nu, ww = nu / 900 * (1 + j * 0.13) + j * 1.7, ach = 0.9 + j * 0.35, ver = (1 - kom) * 8;
          this.zetMeeuw(x - hx * ach + Math.cos(ww) * 0.5 + Math.cos(j * 2.4) * ver, y - hy * ach + Math.sin(ww) * 0.4 + Math.sin(j * 2.4) * ver, 0.6 + 0.4 * Math.sin(ww * 0.7 + j) + ver * 0.3, nu / 140 + j);
        }
      }
    }
    // de graanwagen rijdt een stukje achter de maaidorser en neemt het graan mee
    if (soort === T_MAAI && v.bw >= 0.85) {
      const dd = this.naloop(v, T[o + 2]);
      const r2 = this.rit(v, k, dj - dd);
      if (r2) this.zetVoertuig(this.mx, this.my, this.mhx, this.mhy, TREKKER, kl, A_WAGEN, L_GRAAN, 1, this.ma, r2 === 1 ? 0 : r2 === 2 ? Math.min(1, this.mw * 1.5) : 1);
    }
  }

  // Een plukker van perceel v loopt bij het begin van de pluk van de wagen naar zijn plek (tx, ty) en aan het eind
  // terug; in de wagen is hij niet te zien (false). Plek in this.lx, this.ly; this.lw is 1 als hij op zijn plek is.
  lopen(v, tx, ty, i) {
    // lopen gaat met 1,5 eenheid per dag (op tempo 1 ongeveer zo snel als de wandelaars van leven.js), één voor één
    const t = v.plukT, D = v.plukD, uit = 0.2 + i * 0.25, tl = Math.max(0.2, Math.hypot(tx - v.pkx, ty - v.pky) / 1.5);
    const w = clamp(Math.min(t - uit, D - uit - t) / tl, 0, 1);
    if (w <= 0) return false;
    this.lx = v.pkx + (tx - v.pkx) * w; this.ly = v.pky + (ty - v.pky) * w; this.lw = w;
    return true;
  }

  tekenVelden(c, z, a) {
    const L = this.velden, zicht = this.zicht ?? (this.zicht = []);
    zicht.length = 0;
    for (let i = 0; i < L.length; i++) {
      const v = L[i];
      // ruim genoeg dat een machine onderweg naar het perceel niet verdwijnt als het perceel zelf buiten beeld is
      if (!this.inBeeld(v.x, v.y, v.L + v.B + 4 + v.rlen)) continue;
      if (this.stand(v) === 0 && !v.nAkt) continue;
      if (zicht.length >= PLAFOND.velden) break;
      zicht.push(v);
    }
    this.n.velden = zicht.length;
    if (!zicht.length) return;
    const fijn = z >= DREMPEL.voren;
    // 1. grond: verse voren, gezaaid land, stoppel, natte waaier van de sproeier
    c.beginPath(); let iets = false;
    for (const v of zicht) {
      if (v.f & 1) { this.baan(v, v.fase); this.gewerkt(c, v); iets = true; } else if (v.f & 2) { this.vak(c, v, -v.L, v.L, -v.B, v.B); iets = true; }
    }
    if (iets) { c.fillStyle = 'rgba(74,54,36,0.5)'; c.fill(); }
    c.beginPath(); iets = false;
    for (const v of zicht) {
      if (v.f & 4) { this.baan(v, v.fase); this.gewerkt(c, v); iets = true; } else if (v.f & 8) { this.vak(c, v, -v.L, v.L, -v.B, v.B); iets = true; }
    }
    if (iets) { c.fillStyle = 'rgba(112,92,64,0.32)'; c.fill(); }
    if (z >= DREMPEL.voren) {
      c.beginPath(); iets = false;
      for (const v of zicht) {
        if (v.f & 16) { this.rijen(c, v, 0.42); iets = true; } else if (v.f & 262144) { this.baan(v, v.fase); this.rijen(c, v, 0.42, this.li + (this.mturn > 0 ? 1 : 0)); iets = true; }
      }
      if (iets) { c.strokeStyle = 'rgba(240,226,170,0.42)'; c.lineWidth = 0.1; c.stroke(); }
    }
    if (fijn) {
      // voren: twee lijntjes per baan, glanzend aan de noordwestkant
      c.beginPath(); iets = false;
      for (const v of zicht) {
        if (v.f & 1) { this.baan(v, v.fase); this.rijen(c, v, 0.26, this.li); iets = true; } else if (v.f & 2) { this.rijen(c, v, 0.26); iets = true; }
      }
      if (iets) { c.strokeStyle = 'rgba(40,26,16,0.4)'; c.lineWidth = 0.07; c.stroke(); }
      c.beginPath(); iets = false;
      for (const v of zicht) if (v.f & 8) { this.rijen(c, v, 0.32); iets = true; }
      if (iets) { c.strokeStyle = 'rgba(170,150,110,0.35)'; c.lineWidth = 0.06; c.stroke(); }
    }
    // zwaden: lange rillen van gemaaid gewas, de pers raapt ze op
    c.beginPath(); iets = false;
    let kleurZwad = 'rgba(196,164,84,0.9)';
    for (const v of zicht) {
      if (!(v.f & (32 | 64))) continue;
      const w = (2 * v.B) / v.nL;
      let van = 0;
      if (v.f & 64) { this.baan(v, v.fase); van = this.li + 1; const q = -v.B + (this.li + 0.5) * w, eind = this.mdir > 0 ? v.L - 0.3 : -v.L + 0.3; c.moveTo(v.x + v.lx * this.ms + v.px * q, v.y + v.ly * this.ms + v.py * q); c.lineTo(v.x + v.lx * eind + v.px * q, v.y + v.ly * eind + v.py * q); }
      for (let j = van, tot = v.f & 64 ? v.nL : v.zwad; j < tot; j++) { const q = -v.B + (j + 0.5) * w; c.moveTo(v.x + v.lx * (-v.L + 0.3) + v.px * q, v.y + v.ly * (-v.L + 0.3) + v.py * q); c.lineTo(v.x + v.lx * (v.L - 0.3) + v.px * q, v.y + v.ly * (v.L - 0.3) + v.py * q); }
      if (v.rol & R_KUIL) kleurZwad = 'rgba(132,150,72,0.9)';
      iets = true;
    }
    if (iets) { c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = 0.42; c.stroke(); c.strokeStyle = kleurZwad; c.lineWidth = 0.34; c.stroke(); }
    // 2. bloembollen in banen
    let nBol = 0;
    for (const v of zicht) if (v.f & (1024 | 2048)) nBol++;
    this.n.bollen = nBol;
    if (nBol) {
      for (let k = 0; k < BOL_KLEUR.length; k++) {
        c.beginPath(); iets = false;
        for (const v of zicht) {
          if (!(v.f & 1024)) continue;
          const nb = Math.max(3, Math.round(v.B * 1.9)), w = (2 * v.B) / nb;
          for (let j = 0; j < nb; j++) if (Math.floor(hash(v.id, j, 41) * BOL_KLEUR.length) === k) { this.vak(c, v, -v.L + 0.15, v.L - 0.15, -v.B + j * w + 0.08, -v.B + (j + 1) * w - 0.08); iets = true; }
        }
        if (iets) { c.fillStyle = BOL_KLEUR[k]; c.fill(); }
      }
      c.beginPath(); iets = false;
      for (const v of zicht) {
        if (v.f & 2048) { this.rijen(c, v, 0.55); iets = true; }
        else if ((v.f & 1024) && fijn) { const nb = Math.max(3, Math.round(v.B * 1.9)), w = (2 * v.B) / nb; for (let j = 0; j <= nb; j++) { const q = -v.B + j * w; c.moveTo(v.x - v.lx * v.L + v.px * q, v.y - v.ly * v.L + v.py * q); c.lineTo(v.x + v.lx * v.L + v.px * q, v.y + v.ly * v.L + v.py * q); } iets = true; }
      }
      if (iets) { c.strokeStyle = 'rgba(70,110,50,0.75)'; c.lineWidth = 0.16; c.stroke(); }
      if (z >= DREMPEL.klein) {
        // losse bloemkopjes die het licht vangen
        c.beginPath(); iets = false;
        for (const v of zicht) {
          if (!(v.f & 1024)) continue;
          for (let k = 0; k < 40; k++) { const s = (hash(v.id, k, 42) - 0.5) * 2 * (v.L - 0.3), q = (hash(v.id, k, 43) - 0.5) * 2 * (v.B - 0.2); stip(c, v.x + v.lx * s + v.px * q - 0.03, v.y + v.ly * s + v.py * q - 0.03, 0.05); }
          iets = true;
        }
        if (iets) { c.fillStyle = 'rgba(255,255,240,0.5)'; c.fill(); }
      }
    }
    // 3. kassen: ruiten die de lucht weerspiegelen (verschuift als je de kaart beweegt)
    if (z >= DREMPEL.kas - 0.4) {
      const lucht = this.wr.wolken > 0.6 ? 'rgba(206,214,222,' : 'rgba(226,240,252,';
      c.beginPath(); iets = false;
      let nK = 0;
      for (const v of zicht) {
        if (!(v.f & 131072) || nK >= PLAFOND.kassen) continue;
        nK++;
        const np = Math.max(1, Math.floor((2 * v.hu) / 0.6)), sch = this.cxv * 0.013 + this.cyv * 0.009;
        for (let i = 0; i < np; i++) {
          if ((v.ruit && !v.ruit[i]) || tri(i * 0.137 + sch + v.h) < 0.68) continue;
          const u0 = -v.hu + i * 0.6, u1 = Math.min(v.hu, u0 + 0.6);
          const x = v.x, y = v.y, co = v.co, si = v.si, hv = v.hv;
          c.moveTo(x + u0 * co + hv * si, y + u0 * si - hv * co); c.lineTo(x + u1 * co + hv * si, y + u1 * si - hv * co);
          c.lineTo(x + u1 * co - hv * si, y + u1 * si + hv * co); c.lineTo(x + u0 * co - hv * si, y + u0 * si + hv * co); c.closePath();
          iets = true;
        }
      }
      this.n.kassen = nK;
      if (iets) { c.fillStyle = lucht + (0.34 * (1 - this.nacht)).toFixed(3) + ')'; c.fill(); }
    }
    // 4. hekken met een klaphek, mesthopen
    if (z >= DREMPEL.hek - 0.5) {
      const ah = smooth(DREMPEL.hek - 0.5, DREMPEL.hek + 0.3, z);
      c.globalAlpha = a * ah;
      const hek = this.selHek ?? (this.selHek = []);
      hek.length = 0;
      for (const v of zicht) if ((v.f & 65536) && hek.length < PLAFOND.hekken) hek.push(v);
      const nH = hek.length;
      if (nH) {
        c.beginPath();
        for (const v of hek) this.hekPad(c, v, 0.12, 0.14);
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.05; c.stroke();
        c.beginPath();
        for (const v of hek) this.hekPad(c, v, 0, 0);
        c.strokeStyle = '#8a6a48'; c.lineWidth = 0.05; c.stroke();
        c.beginPath();
        for (const v of hek) this.palen(c, v);
        c.fillStyle = '#5a4430'; c.fill();
        // het klaphek: zwaait af en toe open
        c.beginPath();
        for (const v of hek) {
          const open = smooth(0.7, 0.8, frac(this.nu / 23000 + v.h)) * (1 - smooth(0.9, 1, frac(this.nu / 23000 + v.h)));
          const x0 = v.x + v.co * 1 + v.si * (v.hv - 0.3), y0 = v.y + v.si * 1 - v.co * (v.hv - 0.3), hk = Math.atan2(v.si, v.co) + Math.PI + open * 1.3;
          c.moveTo(x0, y0); c.lineTo(x0 + Math.cos(hk), y0 + Math.sin(hk));
        }
        c.strokeStyle = '#b8a07a'; c.lineWidth = 0.08; c.stroke();
      }
      this.n.hekken = nH;
      c.globalAlpha = a;
    }
    if (z >= DREMPEL.mest - 0.5) { this.tekenMest(c, zicht, z, a * smooth(DREMPEL.mest - 0.5, DREMPEL.mest + 0.3, z)); c.globalAlpha = a; }
    // 5. machines, balen, plukkers, bijenkasten, vogelverschrikkers en sproeiers (verzamelen en tekenen)
    this.veldWerk(c, zicht, z, a);
  }

  // Rondom binnen de perceelrand, met een opening van een meter voor het klaphek aan de -v-kant.
  hekPad(c, v, dx, dy) {
    const hu = v.hu - 0.3, hv = v.hv - 0.3, co = v.co, si = v.si, x = v.x + dx, y = v.y + dy;
    c.moveTo(x + hv * si, y - hv * co);
    c.lineTo(x - hu * co + hv * si, y - hu * si - hv * co); c.lineTo(x - hu * co - hv * si, y - hu * si + hv * co);
    c.lineTo(x + hu * co - hv * si, y + hu * si + hv * co); c.lineTo(x + hu * co + hv * si, y + hu * si - hv * co);
    c.lineTo(x + co + hv * si, y + si - hv * co);
  }
  palen(c, v) {
    const i = 0.3, hu = v.hu - i, hv = v.hv - i, co = v.co, si = v.si;
    const per = 2 * (hu + hv) * 2, n = Math.min(24, Math.floor(per / 1.2));
    for (let k = 0; k < n; k++) {
      let s = (k / n) * per, u, w;
      if (s < 2 * hu) { u = -hu + s; w = -hv; } else if ((s -= 2 * hu) < 2 * hv) { u = hu; w = -hv + s; } else if ((s -= 2 * hv) < 2 * hu) { u = hu - s; w = hv; } else { s -= 2 * hu; u = -hu; w = hv - s; }
      if (w === -hv && u > 0 && u < 1) continue;
      c.rect(v.x + u * co - w * si - 0.06, v.y + u * si + w * co - 0.06, 0.12, 0.12);
    }
  }

  tekenMest(c, zicht, z, a) {
    const mest = this.selMest ?? (this.selMest = []);
    mest.length = 0;
    for (const v of zicht) if ((v.f & 512) && mest.length < PLAFOND.mesthopen) mest.push(v);
    const n = mest.length;
    const hoop = (v, dx, dy, r) => { const x = v.x + v.co * (v.hu - 1.1) - v.si * (v.hv - 0.9) + dx, y = v.y + v.si * (v.hu - 1.1) + v.co * (v.hv - 0.9) + dy; c.moveTo(x + r, y); c.ellipse(x, y, r, r * 0.7, 0.3, 0, TAU); };
    c.globalAlpha = a;
    if (!n) return;
    c.beginPath();
    for (const v of mest) hoop(v, 0.16, 0.2, 0.75);
    this.n.mesthopen = n;
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
    c.beginPath(); for (const v of mest) hoop(v, 0, 0, 0.75);
    c.fillStyle = '#4a3626'; c.fill();
    c.beginPath(); for (const v of mest) hoop(v, -0.18, -0.15, 0.4);
    c.fillStyle = this.sn ? '#eef1f3' : '#6e5238'; c.fill();
    if (z >= DREMPEL.klein && !this.sn) {
      c.beginPath();
      for (const v of mest) for (let k = 0; k < 6; k++) { const x = v.x + v.co * (v.hu - 1.1) - v.si * (v.hv - 0.9) + (hash(v.id, k, 51) - 0.5) * 1.1, y = v.y + v.si * (v.hu - 1.1) + v.co * (v.hv - 0.9) + (hash(v.id, k, 52) - 0.5) * 0.7; c.moveTo(x, y); c.lineTo(x + 0.14, y + 0.04); }
      c.strokeStyle = '#b59a5a'; c.lineWidth = 0.035; c.stroke();
    }
    // damp in de kou: zachte pluimen die opstijgen
    if (z >= DREMPEL.voren && this.sz.koud > 0.5) {
      c.beginPath();
      for (const v of mest) {
        const x = v.x + v.co * (v.hu - 1.1) - v.si * (v.hv - 0.9), y = v.y + v.si * (v.hu - 1.1) + v.co * (v.hv - 0.9);
        for (let k = 0; k < 3; k++) { const f = frac(this.nu / 3800 + k / 3 + v.h); stip(c, x + this.wx * f * 0.8, y - 0.3 - f * 1.1, 0.18 + f * 0.3); }
      }
      c.fillStyle = 'rgba(240,240,236,0.18)'; c.fill();
    }
  }

  get wx() { return Math.cos(this.wd.hoek) * this.wd.kracht; }

  veldWerk(c, zicht, z, a) {
    const nu = this.nu, dagLicht = this.licht0;
    let nSproei = 0, nSchrik = 0, nKast = 0, nKist = 0;
    const sproei = this.sproei ?? (this.sproei = new Float32Array(PLAFOND.sproeiers * 6));
    const schrik = this.schrik ?? (this.schrik = new Float32Array(PLAFOND.vogelverschrikkers * 3));
    const kast = this.kast ?? (this.kast = new Float32Array(PLAFOND.bijenkasten * 3));
    const kist = this.kist ?? (this.kist = new Float32Array(PLAFOND.kisten * 4));
    for (const v of zicht) {
      const f = v.f;
      // machines van het werkplan: onderweg van of naar het erf of de weg, of aan het werk op het land
      for (let m = 0; m < v.nAkt; m++) this.machine(v, v.akt[m], z);
      // verse voren een paar dagen na het ploegen: meeuwen die erop zitten te pikken
      if ((f & 2) && z >= DREMPEL.meeuw && dagLicht && this.dag < 120) for (let j = 0; j < 4; j++) {
        const s = (hash(v.id, j, 61) - 0.5) * 1.6 * v.L, q = (hash(v.id, j, 62) - 0.5) * 1.6 * v.B;
        this.zetMeeuw(v.x + v.lx * s + v.px * q, v.y + v.ly * s + v.py * q, 0, -1);
      }
      // balen: de pers raapt de zwaden op en laat balen achter; daarna blijven ze liggen
      // de wagen die ze ophaalt neemt ze baan voor baan mee (bit 524288)
      if (f & (64 | 128 | 524288)) {
        const kuil = (v.rol & R_KUIL) !== 0, soort = kuil ? (v.h2 < 0.7 ? 2 : 3) : v.h2 < 0.5 ? 1 : 0, raap = (f & 524288) !== 0;
        let tot = v.nL, tot2 = v.L, van = 0;
        if (f & (64 | 524288)) {
          this.baan(v, v.fase);
          const li = this.li + (this.mturn > 0 ? 1 : 0);
          if (raap) { van = li; tot = v.nL - 1; tot2 = this.mturn > 0 ? -v.L * 2 : this.ms * this.mdir; } else { tot = li; tot2 = this.mturn > 0 ? -v.L * 2 : this.ms * this.mdir; }
        }
        if (z >= DREMPEL.baal - 0.5) {
          const w = (2 * v.B) / v.nL, hk = Math.atan2(v.ly, v.lx);
          for (let j = van; j <= tot && j < v.nL; j++) {
            const q = -v.B + (j + 0.5) * w, rd = j & 1 ? -1 : 1;
            for (let k = 0; k < 8; k++) {
              const s0 = -v.L + 0.9 + k * 1.75 + (hash(v.id, j * 8 + k, 63) - 0.5) * 0.5;
              if (s0 > v.L - 0.5) break;
              if (raap) { if (j === van) { const sd = s0 * rd; if (sd < tot2 + 0.6) continue; } } else if (j === tot) { const sd = s0 * rd; if (sd > tot2 - 0.9) continue; }
              this.zetBaal(v.x + v.lx * s0 + v.px * q, v.y + v.ly * s0 + v.py * q, soort, hk + (hash(v.id, k, 64) - 0.5) * 0.4);
            }
          }
        }
      }
      // sproeier: haspel aan de kopakker, slang langs de baan, kanon dat heen en weer zwaait
      // De haspel staat van het brengen tot het ophalen op de kopakker; het kanon rolt langzaam in en wordt daarna
      // droog weer uitgereden (een doorlopende beweging, zonder sprong). Water alleen op droge dagen.
      if ((f & 256) && nSproei < PLAFOND.sproeiers && z >= DREMPEL.sproei - 0.5) {
        const j = Math.floor(v.h * v.nL), q = -v.B + (j + 0.5) * ((2 * v.B) / v.nL);
        const p = frac(this.klok / 900 + v.h3), u = p < 0.92 ? 1 - p / 0.92 : (p - 0.92) / 0.08;
        if (v.wDag !== this.dagNr) { v.wDag = this.dagNr; v.droogHier = this.droogWeer && hash(Math.floor(this.dag / 2), v.id, 9) < 0.65; }
        const nat = p < 0.92 && v.droogHier ? 1 : 0;
        const s = v.L - 1.0 - (1 - u) * (1.5 * v.L - 1.0), hk = Math.atan2(-v.ly, -v.lx) + Math.sin(nu / 2600 + v.h * 6) * 1.1 * nat;
        const o = nSproei++ * 6;
        sproei[o] = v.x + v.lx * s + v.px * q; sproei[o + 1] = v.y + v.ly * s + v.py * q; sproei[o + 2] = hk;
        sproei[o + 3] = v.x + v.lx * (v.L - 0.45) + v.px * q; sproei[o + 4] = v.y + v.ly * (v.L - 0.45) + v.py * q; sproei[o + 5] = nat ? Math.min(3.6, v.B * 1.5 + 0.8) : 0;
      }
      // vogelverschrikker
      if ((f & 32768) && nSchrik < PLAFOND.vogelverschrikkers && z >= DREMPEL.schrik - 0.5) {
        const o = nSchrik++ * 3, s = (v.h3 - 0.5) * v.L, q = (v.h - 0.5) * v.B;
        schrik[o] = v.x + v.lx * s + v.px * q; schrik[o + 1] = v.y + v.ly * s + v.py * q; schrik[o + 2] = v.h2;
      }
      // boomgaard: plukkers tussen de bomen, kisten aan het eind van de rij, een tractor met kistenwagen
      if (f & 4096) {
        const nR = Math.max(1, Math.floor((2 * v.hv - 0.9) / 1.25)), rij = Math.floor(v.h * nR), w = -v.hv + 0.6 + rij * 1.25 + 0.62;
        const nB = Math.max(1, Math.floor((2 * v.hu - 0.9) / 1.25));
        // plukkers en kisten pas verzamelen als ze ook getekend worden: anders vullen ze op zoom 4 het plafond.
        // De plukkers stappen uit de plukwagen en lopen naar hun boom; aan het eind lopen ze terug en stappen in.
        if (z >= DREMPEL.mens - 0.5) for (let i = 0; i < Math.min(4, nB); i++) {
          const u = -v.hu + 0.6 + ((i * 2 + Math.floor(v.h2 * 3)) % nB) * 1.25, buk = Math.sin(nu / 700 + i * 2.1);
          const tx = v.x + u * v.co - (w - 0.05) * v.si, ty = v.y + u * v.si + (w - 0.05) * v.co;
          if (this.lopen(v, tx, ty, i)) this.zetMens(this.lx, this.ly, (v.id + i) % KLEDING.length, this.lw < 1 ? 0 : buk);
        }
        // de kisten worden een voor een uitgeladen en aan het eind weer een voor een ingeladen
        const nK = clamp(Math.floor(Math.min(v.plukT - 0.3, v.plukD - 0.3 - v.plukT) / 0.12), 0, 6);
        if (z >= DREMPEL.mens - 1) for (let k = 0; k < nK && nKist < PLAFOND.kisten; k++) {
          const o = nKist++ * 4, u = v.hu - 0.25 - (k % 3) * 0.36, ww = w + (k < 3 ? -0.2 : 0.2);
          kist[o] = v.x + u * v.co - ww * v.si; kist[o + 1] = v.y + u * v.si + ww * v.co; kist[o + 2] = Math.atan2(v.si, v.co); kist[o + 3] = hash(v.id, 7) < 0.5 ? 0 : 1;
        }
      }
      // wijngaard: plukkers langs de rijen met een smalspoortrekker en druivenbakken
      if (f & 16384) {
        const nR = Math.max(1, Math.floor((2 * v.B) / 0.9));
        if (z >= DREMPEL.mens - 0.5) for (let i = 0; i < 4; i++) {
          const q = -v.B + 0.9 * (1 + ((i + Math.floor(v.h * nR)) % nR)), s = -v.L + 0.4 + tri(this.klok / 140 + i * 0.27) * (2 * v.L - 0.8);
          if (this.lopen(v, v.x + v.lx * s + v.px * q, v.y + v.ly * s + v.py * q, i)) this.zetMens(this.lx, this.ly, (v.id + i * 3) % KLEDING.length, this.lw < 1 ? 0 : Math.sin(nu / 800 + i));
        }
      }
      // bijenkasten aan de rand van de boomgaard of het koolzaad
      if ((f & 8192) && z >= DREMPEL.bij - 0.5) {
        const n = 4 + Math.floor(v.h * 3);
        for (let k = 0; k < n && nKast < PLAFOND.bijenkasten; k++) {
          const u = -v.hu + 0.5 + k * 0.48, w = -v.hv + 0.3;
          if (u > v.hu - 0.3) break;
          const o = nKast++ * 3;
          kast[o] = v.x + u * v.co - w * v.si; kast[o + 1] = v.y + u * v.si + w * v.co; kast[o + 2] = (k + Math.floor(v.h2 * 4)) % KAST_KLEUR.length;
        }
      }
    }
    this.n.sproeiers = nSproei; this.n.vogelverschrikkers = nSchrik; this.n.bijenkasten = nKast; this.n.kisten = nKist;
    this.nSproei = nSproei; this.nSchrik = nSchrik;
    // natte waaier onder de sproeier en de haspel met slang (de waterboog zelf komt bij de hoge dingen)
    if (nSproei) {
      c.beginPath();
      for (let i = 0; i < nSproei; i++) { const o = i * 6, x = sproei[o], y = sproei[o + 1], hk = sproei[o + 2], R = sproei[o + 5]; if (R <= 0) continue; c.moveTo(x, y); c.arc(x, y, R, hk - 0.5, hk + 0.5); c.closePath(); }
      c.fillStyle = 'rgba(30,50,40,0.13)'; c.fill();
      c.beginPath();
      for (let i = 0; i < nSproei; i++) { const o = i * 6; c.moveTo(sproei[o], sproei[o + 1]); c.lineTo(sproei[o + 3], sproei[o + 4]); }
      c.strokeStyle = 'rgba(40,40,40,0.75)'; c.lineWidth = 0.08; c.stroke();
      c.beginPath();
      for (let i = 0; i < nSproei; i++) { const o = i * 6; stip(c, sproei[o + 3] + 0.1, sproei[o + 4] + 0.12, 0.42); }
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
      c.beginPath();
      for (let i = 0; i < nSproei; i++) { const o = i * 6; stip(c, sproei[o + 3], sproei[o + 4], 0.4); }
      c.fillStyle = '#2f6d9a'; c.fill();
      c.beginPath();
      for (let i = 0; i < nSproei; i++) { const o = i * 6; stip(c, sproei[o + 3] - 0.08, sproei[o + 4] - 0.08, 0.18); stip(c, sproei[o], sproei[o + 1], 0.16); }
      c.fillStyle = '#c9ced2'; c.fill();
    }
    // kisten met appels of peren
    if (nKist && z >= DREMPEL.mens - 1) {
      c.beginPath();
      for (let i = 0; i < nKist; i++) { const o = i * 4; rechthoek(c, kist[o] + 0.07, kist[o + 1] + 0.09, Math.cos(kist[o + 2]), Math.sin(kist[o + 2]), 0.16, 0.16); }
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
      c.beginPath();
      for (let i = 0; i < nKist; i++) { const o = i * 4; rechthoek(c, kist[o], kist[o + 1], Math.cos(kist[o + 2]), Math.sin(kist[o + 2]), 0.16, 0.16); }
      c.fillStyle = '#a07a4a'; c.fill();
      if (z >= DREMPEL.klein) for (let s = 0; s < 2; s++) {
        c.beginPath();
        for (let i = 0; i < nKist; i++) { const o = i * 4; if (kist[o + 3] !== s) continue; for (let k = 0; k < 4; k++) stip(c, kist[o] + ((k & 1) - 0.5) * 0.14, kist[o + 1] + ((k >> 1) - 0.5) * 0.14, 0.055); }
        c.fillStyle = s ? '#d9b83a' : '#c0392b'; c.fill();
      }
    }
    // bijenkasten: schaduw, kast, licht deksel; dichtbij een paar bijen
    if (nKast) {
      c.beginPath(); for (let i = 0; i < nKast; i++) { const o = i * 3; c.rect(kast[o] - 0.1, kast[o + 1] - 0.06, 0.26, 0.2); }
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
      for (let k = 0; k < KAST_KLEUR.length; k++) {
        c.beginPath(); let iets = false;
        for (let i = 0; i < nKast; i++) { const o = i * 3; if (kast[o + 2] === k) { c.rect(kast[o] - 0.13, kast[o + 1] - 0.1, 0.26, 0.2); iets = true; } }
        if (iets) { c.fillStyle = KAST_KLEUR[k]; c.fill(); }
      }
      c.beginPath(); for (let i = 0; i < nKast; i++) { const o = i * 3; c.rect(kast[o] - 0.13, kast[o + 1] - 0.1, 0.26, 0.06); }
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fill();
      if (z >= DREMPEL.kleinst && dagLicht) {
        c.beginPath();
        for (let i = 0; i < nKast; i++) { const o = i * 3; for (let k = 0; k < 3; k++) { const w = nu / 260 * (1 + k * 0.3) + i + k * 2; c.rect(kast[o] + Math.cos(w) * 0.35, kast[o + 1] - 0.2 + Math.sin(w * 1.3) * 0.25, 0.03, 0.03); } }
        c.fillStyle = '#3a2e10'; c.fill();
      }
    }
  }

  tekenBalen(c, a) {
    const n = this.nBaal, b = this.baal;
    if (!n) return;
    this.n.balen = n;
    c.globalAlpha = a;
    const vorm = (i, dx, dy, k) => {
      const o = i * 4, x = b[o] + dx, y = b[o + 1] + dy;
      if (b[o + 2] === 1) rechthoek(c, x, y, Math.cos(b[o + 3]), Math.sin(b[o + 3]), 0.3 * k, 0.17 * k);
      else stip(c, x, y, 0.27 * k);
    };
    c.beginPath(); for (let i = 0; i < n; i++) vorm(i, 0.12, 0.15, 1);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
    for (let s = 0; s < 4; s++) {
      c.beginPath(); let iets = false;
      for (let i = 0; i < n; i++) if (b[i * 4 + 2] === s) { vorm(i, 0, 0, 1); iets = true; }
      if (iets) { c.fillStyle = BAAL_KLEUR[s]; c.fill(); }
    }
    c.beginPath(); for (let i = 0; i < n; i++) vorm(i, -0.07, -0.07, 0.45);
    c.fillStyle = 'rgba(255,250,225,0.5)'; c.fill();
    if (this.zoom >= DREMPEL.klein) {
      // touwtjes over de pakken en de omwikkeling van de kuilbalen
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * 4, x = b[o], y = b[o + 1], co = Math.cos(b[o + 3]), si = Math.sin(b[o + 3]);
        if (b[o + 2] === 1) for (const u of [-0.12, 0.12]) { c.moveTo(x + co * u + si * 0.17, y + si * u - co * 0.17); c.lineTo(x + co * u - si * 0.17, y + si * u + co * 0.17); }
        else { c.moveTo(x + 0.18, y); c.arc(x, y, 0.18, 0, TAU); }
      }
      c.strokeStyle = 'rgba(110,90,50,0.45)'; c.lineWidth = 0.025; c.stroke();
    }
  }

  // Voertuigen in een paar gebundelde lagen: schaduw, aanbouw, wielen, carrosserie per kleur, cabine, lading.
  // Voertuigen die in- of uitvagen (bij de weg) komen in een eigen dekkingsniveau: de buffer wordt per niveau
  // gegroepeerd en elk niveau gaat met een eigen globalAlpha door dezelfde gebundelde lagen.
  tekenVoertuigen(c, a, z) {
    const n = this.nVw, b = this.vw;
    if (!n) return;
    // acht niveaus: een voertuig vaagt in kleine stapjes in en uit (alleen niveaus met voertuigen kosten tijd)
    const NV = 8, t = this.vwTmp ?? (this.vwTmp = new Float32Array(b.length)), g = this.vwGrens ?? (this.vwGrens = new Int32Array(NV + 2));
    let m = 0;
    for (let L = NV; L >= 1; L--) {
      g[NV - L] = m;
      for (let i = 0; i < n; i++) {
        const o = i * VW, d = b[o + 9], niv = d >= 0.97 ? NV : Math.max(1, Math.ceil(d * NV));
        if (niv !== L) continue;
        for (let k = 0; k < VW; k++) t[m * VW + k] = b[o + k];
        m++;
      }
    }
    g[NV] = m;
    for (let k = 0, e = m * VW; k < e; k++) b[k] = t[k]; // zonder subarray: geen nieuw object per beeld
    for (let L = NV; L >= 1; L--) { const i0 = g[NV - L], i1 = g[NV + 1 - L]; if (i1 > i0) this.tekenVoertuigDeel(c, (a * L) / NV, z, i0, i1); }
    this.n.machines = n;
  }
  tekenVoertuigDeel(c, a, z, i0, i1) {
    const b = this.vw;
    c.globalAlpha = a;
    // maten per soort: halve lengte, halve breedte van de romp
    const romp = (o, k, dx, dy) => {
      const s = b[o + 4], sch = b[o + 8] * k, x = b[o] + dx, y = b[o + 1] + dy, hx = b[o + 2], hy = b[o + 3];
      if (s === TREKKER || s === SMALSPOOR) rechthoek(c, x, y, hx, hy, 0.36 * sch, (s === SMALSPOOR ? 0.15 : 0.2) * sch);
      else if (s === DUMPER) rechthoek(c, x, y, hx, hy, 0.5 * sch, 0.27 * sch);
      else if (s === BESTEL) rechthoek(c, x, y, hx, hy, 0.4 * sch, 0.19 * sch);
      else if (s === MAAIER) rechthoek(c, x, y, hx, hy, 0.5 * sch, 0.32 * sch);
      else rechthoek(c, x, y, hx, hy, 0.72 * sch, 0.24 * sch);
    };
    const aanbouw = (o, dx, dy) => {
      const x = b[o] + dx, y = b[o + 1] + dy, hx = b[o + 2], hy = b[o + 3], sch = b[o + 8], s = b[o + 6];
      if (s === A_PLOEG) rechthoek(c, x - hx * 0.62 * sch, y - hy * 0.62 * sch, hx, hy, 0.22 * sch, 0.32 * sch);
      else if (s === A_ZAAI) rechthoek(c, x - hx * 0.6 * sch, y - hy * 0.6 * sch, hx, hy, 0.16 * sch, 0.52 * sch);
      else if (s === A_PERS) rechthoek(c, x - hx * 0.82 * sch - hy * 0.12, y - hy * 0.82 * sch + hx * 0.12, hx, hy, 0.36 * sch, 0.24 * sch);
      else if (s === A_SCHUIF) rechthoek(c, x + hx * 0.5 * sch, y + hy * 0.5 * sch, hx, hy, 0.06 * sch, 0.42 * sch);
      else if (s === A_KISTEN) rechthoek(c, x - hx * 0.9 * sch, y - hy * 0.9 * sch, hx, hy, 0.42 * sch, 0.26 * sch);
      else if (s === A_MAAI) rechthoek(c, x + hx * 0.62 * sch, y + hy * 0.62 * sch, hx, hy, 0.12 * sch, 0.62 * sch);
      else if (s === A_WAGEN) rechthoek(c, x - hx * 0.95 * sch, y - hy * 0.95 * sch, hx, hy, 0.45 * sch, 0.26 * sch);
      else if (s === A_MAAIBALK) rechthoek(c, x + hx * 0.1 * sch - hy * 0.55 * sch, y + hy * 0.1 * sch + hx * 0.55 * sch, hx, hy, 0.05 * sch, 0.35 * sch);
    };
    c.beginPath();
    for (let i = i0; i < i1; i++) { const o = i * VW; romp(o, 1, 0.12, 0.16); aanbouw(o, 0.1, 0.13); }
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
    // aanbouw per soort
    for (let s = 1; s < AK.length; s++) {
      c.beginPath(); let iets = false;
      for (let i = i0; i < i1; i++) { const o = i * VW; if (b[o + 6] === s) { aanbouw(o, 0, 0); iets = true; } }
      if (iets) { c.fillStyle = AK[s]; c.fill(); }
    }
    // wielen
    if (z >= DREMPEL.wagen + 1) {
      c.beginPath();
      for (let i = i0; i < i1; i++) {
        const o = i * VW, x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3], s = b[o + 4], sch = b[o + 8];
        const lang = s === VRACHT ? 0.5 : s === DUMPER || s === MAAIER ? 0.32 : 0.2, br = s === VRACHT || s === DUMPER ? 0.27 : s === MAAIER ? 0.3 : s === SMALSPOOR ? 0.17 : 0.22;
        for (const k of [-1, 1]) for (const u of [-lang, lang * 0.9]) {
          const groot = (s === TREKKER || s === SMALSPOOR) && u < 0;
          rechthoek(c, x + hx * u * sch - hy * k * br * sch, y + hy * u * sch + hx * k * br * sch, hx, hy, (groot ? 0.13 : 0.08) * sch, 0.05 * sch);
        }
      }
      c.fillStyle = '#1e1e1e'; c.fill();
    }
    // carrosserie per kleur
    for (let k = 0; k < KLEUREN.length; k++) {
      c.beginPath(); let iets = false;
      for (let i = i0; i < i1; i++) {
        const o = i * VW;
        if (b[o + 5] !== k) continue;
        const s = b[o + 4], sch = b[o + 8], x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3];
        if (s === VRACHT) rechthoek(c, x + hx * 0.52 * sch, y + hy * 0.52 * sch, hx, hy, 0.2 * sch, 0.24 * sch); // cabine
        else romp(o, 1, 0, 0);
        iets = true;
      }
      if (iets) { c.fillStyle = KLEUREN[k]; c.fill(); }
    }
    // laadbak en lading van vrachtwagens en dumpers

    for (let l = 1; l < LK.length; l++) {
      c.beginPath(); let iets = false;
      for (let i = i0; i < i1; i++) {
        const o = i * VW;
        if (b[o + 7] !== l) continue;
        const sch = b[o + 8], x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3];
        const vol = b[o + 10];
        if (vol < 0.05) continue;
        if (b[o + 4] === DUMPER) rechthoek(c, x - hx * 0.12 * sch, y - hy * 0.12 * sch, hx, hy, 0.3 * sch, 0.22 * sch);
        else if (b[o + 6] === A_WAGEN) rechthoek(c, x - hx * (0.95 + 0.4 * (1 - vol)) * sch, y - hy * (0.95 + 0.4 * (1 - vol)) * sch, hx, hy, 0.4 * sch * vol, 0.21 * sch); // balen of graan op de wagen
        else if (l === L_HOUT) rechthoek(c, x - hx * (0.2 + 0.5 * (1 - vol)) * sch, y - hy * (0.2 + 0.5 * (1 - vol)) * sch, hx, hy, 0.5 * sch * vol, 0.22 * sch);
        else rechthoek(c, x - hx * 0.2 * sch, y - hy * 0.2 * sch, hx, hy, 0.5 * sch, l === L_MELK ? 0.2 * sch : 0.22 * sch);
        iets = true;
      }
      if (iets) { c.fillStyle = LK[l]; c.fill(); }
    }
    // licht van boven: dak van de cabine, glans op de tank, kopse kanten van de stammen
    c.beginPath();
    for (let i = i0; i < i1; i++) {
      const o = i * VW, s = b[o + 4], sch = b[o + 8], x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3];
      if (s === TREKKER || s === SMALSPOOR) rechthoek(c, x - hx * 0.06 * sch, y - hy * 0.06 * sch, hx, hy, 0.13 * sch, 0.14 * sch);
      else if (s === VRACHT) rechthoek(c, x + hx * 0.55 * sch - 0.03, y + hy * 0.55 * sch - 0.03, hx, hy, 0.13 * sch, 0.18 * sch);
      else if (s === BESTEL) rechthoek(c, x - 0.03, y - 0.03, hx, hy, 0.3 * sch, 0.12 * sch);
      if (b[o + 7] === L_MELK) rechthoek(c, x - hx * 0.2 * sch - hy * 0.08, y - hy * 0.2 * sch + hx * -0.08, hx, hy, 0.46 * sch, 0.05 * sch);
    }
    c.fillStyle = 'rgba(255,255,255,0.42)'; c.fill();
    if (z >= DREMPEL.mens - 1) {
      c.beginPath(); let iets = false;
      for (let i = i0; i < i1; i++) {
        const o = i * VW;
        if (b[o + 7] !== L_HOUT || b[o + 10] < 0.3) continue;
        const sch = b[o + 8], x = b[o] - b[o + 2] * 0.68 * sch, y = b[o + 1] - b[o + 3] * 0.68 * sch;
        for (let k = 0; k < 3; k++) stip(c, x - b[o + 3] * (k - 1) * 0.14, y + b[o + 2] * (k - 1) * 0.14, 0.07);
        iets = true;
      }
      if (iets) { c.fillStyle = '#c9a77a'; c.fill(); }
      // ruitjes
      c.beginPath();
      for (let i = i0; i < i1; i++) {
        const o = i * VW, s = b[o + 4], sch = b[o + 8], x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3];
        const u = s === VRACHT ? 0.7 : s === BESTEL ? 0.33 : s === DUMPER ? 0.4 : 0.08;
        rechthoek(c, x + hx * u * sch, y + hy * u * sch, hx, hy, 0.03 * sch, (s === TREKKER || s === SMALSPOOR ? 0.12 : 0.17) * sch);
      }
      c.fillStyle = 'rgba(150,190,215,0.85)'; c.fill();
    }
  }

  tekenMensen(c, a) {
    const n = this.nMens, b = this.mens;
    if (!n) return;
    c.globalAlpha = a;
    c.beginPath(); for (let i = 0; i < n; i++) stip(c, b[i * 4] + 0.06, b[i * 4 + 1] + 0.08, 0.1);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
    for (let k = 0; k < KLEDING.length; k++) {
      c.beginPath(); let iets = false;
      for (let i = 0; i < n; i++) if (b[i * 4 + 2] === k) { stip(c, b[i * 4], b[i * 4 + 1], 0.1); iets = true; }
      if (iets) { c.fillStyle = KLEDING[k]; c.fill(); }
    }
    c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 4; stip(c, b[o] - 0.02 + b[o + 3] * 0.03, b[o + 1] - 0.05, 0.055); }
    c.fillStyle = '#d9a982'; c.fill();
    this.n.plukkers = n;
  }

  // ---------- groeven en jaknikkers ----------

  tekenGroeven(c, z) {
    const L = this.groeven;
    let n = 0, nD = 0, nG = 0;
    for (const g of L) {
      if (!this.inBeeld(g.x, g.y, g.r * 1.6)) continue;
      if (n >= PLAFOND.groeven) break;
      n++;
      const bw = g.r * 3;
      const e = this.bak(`g:${Math.round(g.z * 1e6)}:${this.P}:${this.sn}`, `g:${Math.round(g.z * 1e6)}`, bw, bw, bakGroeve, g);
      if (e) c.drawImage(e.cv, g.x - e.bw / 2, g.y - e.bh / 2, e.bw, e.bh);
      // dumpers over de helling: beladen omhoog, leeg omlaag; de graafmachine op de bodem
      if (z >= DREMPEL.machine - 0.5) { // de groeve werkt dag en nacht door, onder de lampen
        for (let i = 0; i < 2 && nD < PLAFOND.dumpers; i++) {
          const f = tri(this.klok / 46 + i * 0.5 + g.z), p = f, ah = g.hoek + p * 1.3, r = groefRand(g, ah) * (1.02 - p * 0.72) + (1 - p) * 0.0;
          const x = g.x + Math.cos(ah) * r + p * 0.25, y = g.y + Math.sin(ah) * r * 0.86 + p * 0.25;
          const terug = frac(this.klok / 46 + i * 0.5 + g.z) < 0.5; // eerste helft: omlaag
          const th = ah + (terug ? 1.57 : -1.57);
          this.zetVoertuig(x, y, Math.cos(th), Math.sin(th), DUMPER, 8, A_GEEN, terug ? L_GEEN : L_GROND, 0.9);
          nD++;
        }
        if (nG < PLAFOND.graafmachines) { nG++; this.graaf = this.graaf ?? new Float32Array(PLAFOND.graafmachines * 3); const o = (nG - 1) * 3; this.graaf[o] = g.x + 0.25 + Math.cos(g.hoek + 2.4) * g.r * 0.12; this.graaf[o + 1] = g.y + 0.25 + Math.sin(g.hoek + 2.4) * g.r * 0.1; this.graaf[o + 2] = g.hoek + 1.3 + Math.sin(this.klok / 5 + g.z * 9) * 1.1; }
      }
      if (this.nacht > 0.3) { this.zetLicht(g.x - g.r * 0.9, g.y - g.r * 0.6, g.r * 0.9, WIT, 0.7); this.zetLicht(g.x + g.r * 0.8, g.y + g.r * 0.3, g.r * 0.7, WIT, 0.6); }
    }
    this.n.groeven = n; this.n.dumpers = nD; this.n.graafmachines = nG; this.nGraaf = nG;
    if (nG) {
      // graafmachine: rupsen, draaiend bovenhuis, arm met bak
      const b = this.graaf;
      c.beginPath(); for (let i = 0; i < nG; i++) { const o = i * 3; rechthoek(c, b[o] + 0.15, b[o + 1] + 0.2, 1, 0, 0.42, 0.32); }
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
      c.beginPath(); for (let i = 0; i < nG; i++) { const o = i * 3; rechthoek(c, b[o], b[o + 1] - 0.22, 1, 0, 0.42, 0.08); rechthoek(c, b[o], b[o + 1] + 0.22, 1, 0, 0.42, 0.08); }
      c.fillStyle = '#2a2a28'; c.fill();
      c.beginPath(); for (let i = 0; i < nG; i++) { const o = i * 3; rechthoek(c, b[o], b[o + 1], Math.cos(b[o + 2]), Math.sin(b[o + 2]), 0.28, 0.24); }
      c.fillStyle = DUMPER_KLEUR; c.fill();
      c.beginPath(); for (let i = 0; i < nG; i++) { const o = i * 3, hx = Math.cos(b[o + 2]), hy = Math.sin(b[o + 2]); c.moveTo(b[o] + hx * 0.2, b[o + 1] + hy * 0.2); c.lineTo(b[o] + hx * 1.15, b[o + 1] + hy * 1.15 - 0.35); }
      c.strokeStyle = '#c99418'; c.lineWidth = 0.13; c.stroke();
      c.beginPath(); for (let i = 0; i < nG; i++) { const o = i * 3, hx = Math.cos(b[o + 2]), hy = Math.sin(b[o + 2]); rechthoek(c, b[o] + hx * 1.22, b[o + 1] + hy * 1.22 - 0.3, hx, hy, 0.1, 0.13); rechthoek(c, b[o] + hx * 0.08 - 0.03, b[o + 1] + hy * 0.08 - 0.03, hx, hy, 0.1, 0.13); }
      c.fillStyle = '#3a3630'; c.fill();
    }
  }

  tekenJaknikkers(c, a, z) {
    const L = this.jaknikkers, buf = this.jak ?? (this.jak = new Float32Array(PLAFOND.jaknikkers * 5));
    let n = 0;
    for (const j of L) {
      if (n >= PLAFOND.jaknikkers) break;
      if (!this.inBeeld(j.x, j.y, 3)) continue;
      const o = n++ * 5;
      buf[o] = j.x; buf[o + 1] = j.y; buf[o + 2] = j.hoek; buf[o + 3] = Math.sin(this.nu / 1100 + j.z * TAU); buf[o + 4] = j.kleur;
    }
    this.n.jaknikkers = n;
    if (!n) return;
    c.globalAlpha = a;
    // jp(o, s, h, schaduw): punt op de as van jaknikker o op afstand s en hoogte h (of de schaduw daarvan)
    const hx = (o) => Math.cos(buf[o + 2]), hy = (o) => Math.sin(buf[o + 2]);
    // betonplaat
    c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 5; rechthoek(c, buf[o], buf[o + 1], hx(o), hy(o), 0.95, 0.42); }
    c.fillStyle = '#a9a59b'; c.fill();
    // schaduw van bok en balk op de grond
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * 5, d = buf[o + 3] * 0.32;
      this.jp(o, 0, 0, 1); c.moveTo(this.jx, this.jy); this.jp(o, 0, 1.0, 1); c.lineTo(this.jx, this.jy);
      this.jp(o, 0.78, 1.0 + d, 1); c.moveTo(this.jx, this.jy); this.jp(o, -0.65, 1.0 - d, 1); c.lineTo(this.jx, this.jy);
    }
    c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 0.14; c.stroke();
    // motorkast en contragewicht
    c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 5; rechthoek(c, buf[o] - hx(o) * 0.7, buf[o + 1] - hy(o) * 0.7 - 0.12, hx(o), hy(o), 0.2, 0.18); }
    c.fillStyle = '#4a4e52'; c.fill();
    // bok: twee poten naar het draaipunt
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * 5, ux = hx(o), uy = hy(o);
      this.jp(o, 0, 1.0, 0);
      c.moveTo(buf[o] - uy * 0.25 - ux * 0.2, buf[o + 1] + ux * 0.25 - uy * 0.2); c.lineTo(this.jx, this.jy);
      c.moveTo(buf[o] + uy * 0.25 - ux * 0.2, buf[o + 1] - ux * 0.25 - uy * 0.2); c.lineTo(this.jx, this.jy);
    }
    c.strokeStyle = '#5a5e62'; c.lineWidth = 0.08; c.stroke();
    // poleerstang van de paardenkop naar de put
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * 5, d = buf[o + 3] * 0.32; this.jp(o, 0.86, 1.0 + d - 0.12, 0); c.moveTo(this.jx, this.jy); this.jp(o, 0.86, 0, 0); c.lineTo(this.jx, this.jy); }
    c.strokeStyle = '#d8d8d2'; c.lineWidth = 0.04; c.stroke();
    // balk per kleur, paardenkop donker
    for (let k = 0; k < JAK_KLEUR.length; k++) {
      c.beginPath(); let iets = false;
      for (let i = 0; i < n; i++) {
        const o = i * 5;
        if (buf[o + 4] !== k) continue;
        const d = buf[o + 3] * 0.32;
        this.jp(o, -0.65, 1.0 - d, 0); c.moveTo(this.jx, this.jy); this.jp(o, 0.78, 1.0 + d, 0); c.lineTo(this.jx, this.jy);
        iets = true;
      }
      if (iets) { c.strokeStyle = JAK_KLEUR[k]; c.lineWidth = 0.15; c.stroke(); }
    }
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * 5, d = buf[o + 3] * 0.32; this.jp(o, 0.84, 1.0 + d - 0.05, 0); rechthoek(c, this.jx, this.jy, hx(o), hy(o), 0.1, 0.09); }
    c.fillStyle = '#2e2e2c'; c.fill();
    if (z >= DREMPEL.mens) {
      c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 5; this.jp(o, 0.86, 0, 0); c.rect(this.jx + 0.07, this.jy - 0.05, 0.1, 0.1); }
      c.fillStyle = '#b8322a'; c.fill();
    }
  }

  jp(o, s, hgt, schaduw) {
    const b = this.jak, hx = Math.cos(b[o + 2]), hy = Math.sin(b[o + 2]);
    this.jx = b[o] + hx * s + (schaduw ? hgt * S : 0);
    this.jy = b[o + 1] + hy * s + (schaduw ? hgt * S : -hgt);
  }

  // ---------- bos ----------

  tekenBos(c, z, a) {
    let nK = 0, nSt = 0, nB = 0, nStap = 0, nZ = 0;
    const zicht = this.zichtBos ?? (this.zichtBos = []);
    zicht.length = 0;
    for (const k of this.kaal) { if (this.inBeeld(k.x, k.y, k.r + 3) && nK < PLAFOND.kaalslagen) { zicht.push(k); nK++; } }
    this.n.kaalslagen = nK;
    if (nK) {
      // kale grond met naalden en houtsnippers, sporen van de uitrijmachine
      c.beginPath(); for (const k of zicht) if (!k.herplant) { c.moveTo(k.x + k.r, k.y); c.ellipse(k.x, k.y, k.r, k.r * 0.85, k.hoek, 0, TAU); }
      c.fillStyle = this.sn ? 'rgba(236,240,242,0.5)' : 'rgba(128,104,72,0.38)'; c.fill();
      if (z >= DREMPEL.stronk + 1) {
        c.beginPath();
        for (const k of zicht) if (!k.herplant) for (const z2 of [-0.25, 0.25]) { c.moveTo(k.x + Math.cos(k.hoek + 0.3) * k.r * 1.6 - Math.sin(k.hoek) * z2, k.y + Math.sin(k.hoek + 0.3) * k.r * 1.6 + Math.cos(k.hoek) * z2); c.quadraticCurveTo(k.x - Math.sin(k.hoek) * z2, k.y + Math.cos(k.hoek) * z2, k.sx - Math.sin(k.hoek) * z2, k.sy + Math.cos(k.hoek) * z2); }
        c.strokeStyle = 'rgba(70,52,36,0.4)'; c.lineWidth = 0.13; c.stroke();
      }
      if (z >= DREMPEL.stronk - 0.5) {
        // stronken: donkere rand, licht vers zaagvlak; takkenhopen
        const st = this.stronk ?? (this.stronk = new Float32Array(PLAFOND.stronken * 2));
        for (const k of zicht) if (!k.herplant) for (let i = 0; i < 14 && nSt < PLAFOND.stronken; i++) {
          const r = Math.sqrt(hash(k.t, i, 81)) * (k.r - 0.25), w = hash(k.t, i, 82) * TAU, o = nSt++ * 2;
          st[o] = k.x + Math.cos(w) * r; st[o + 1] = k.y + Math.sin(w) * r * 0.85;
        }
        if (nSt) {
          c.beginPath(); for (let i = 0; i < nSt; i++) stip(c, st[i * 2] + 0.06, st[i * 2 + 1] + 0.08, 0.15);
          c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
          c.beginPath(); for (let i = 0; i < nSt; i++) stip(c, st[i * 2], st[i * 2 + 1], 0.15);
          c.fillStyle = '#5e4632'; c.fill();
          c.beginPath(); for (let i = 0; i < nSt; i++) stip(c, st[i * 2] - 0.02, st[i * 2 + 1] - 0.02, 0.1);
          c.fillStyle = this.sn ? '#f2f4f5' : '#d6b88a'; c.fill();
        }
        if (z >= DREMPEL.voren) {
          c.beginPath();
          for (const k of zicht) if (!k.herplant) for (let i = 0; i < 5; i++) {
            const w = hash(k.t, i, 83) * TAU, r = hash(k.t, i, 84) * k.r * 0.8, x = k.x + Math.cos(w) * r, y = k.y + Math.sin(w) * r * 0.8;
            for (let j = 0; j < 4; j++) { const d = hash(k.t, i * 4 + j, 85) * TAU; c.moveTo(x, y); c.lineTo(x + Math.cos(d) * 0.4, y + Math.sin(d) * 0.3); }
          }
          c.strokeStyle = this.sn ? 'rgba(120,100,80,0.5)' : 'rgba(100,78,50,0.65)'; c.lineWidth = 0.05; c.stroke();
        }
        // herplant: jonge boompjes in rijen, dichtbij met een witte boombeschermer
        const bp = this.boompje ?? (this.boompje = new Float32Array(PLAFOND.boompjes * 2));
        for (const k of zicht) {
          if (!k.herplant) continue;
          const co = Math.cos(k.hoek), si = Math.sin(k.hoek);
          for (let u = -k.r; u <= k.r && nB < PLAFOND.boompjes; u += 0.7) for (let v = -k.r; v <= k.r && nB < PLAFOND.boompjes; v += 0.7) {
            if (u * u + v * v > k.r * k.r * 0.85) continue;
            const o = nB++ * 2; bp[o] = k.x + u * co - v * si; bp[o + 1] = k.y + u * si + v * co;
          }
        }
        if (nB) {
          c.beginPath(); for (let i = 0; i < nB; i++) stip(c, bp[i * 2] + 0.06, bp[i * 2 + 1] + 0.08, 0.13);
          c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
          c.beginPath(); for (let i = 0; i < nB; i++) stip(c, bp[i * 2], bp[i * 2 + 1], 0.14);
          c.fillStyle = this.sn ? '#c8d4cc' : '#3f6b3a'; c.fill();
          c.beginPath(); for (let i = 0; i < nB; i++) stip(c, bp[i * 2] - 0.04, bp[i * 2 + 1] - 0.04, 0.06);
          c.fillStyle = this.sn ? '#f4f6f7' : '#6f9a50'; c.fill();
          if (z >= DREMPEL.hond) { c.beginPath(); for (let i = 0; i < nB; i++) c.rect(bp[i * 2] + 0.1, bp[i * 2 + 1] - 0.05, 0.05, 0.1); c.fillStyle = '#e6e2d6'; c.fill(); }
        }
      }
      // stapels stammen langs de rand van de kaalslag, de houtvrachtwagen ernaast
      if (z >= DREMPEL.stapel - 0.5) {
        c.globalAlpha = a * smooth(DREMPEL.stapel - 0.5, DREMPEL.stapel + 0.3, z);
        const stapel = (k, dx, dy, l, w) => { const hx = -Math.sin(k.hoek), hy = Math.cos(k.hoek); rechthoek(c, k.sx + dx, k.sy + dy, hx, hy, l, w); };
        c.beginPath(); for (const k of zicht) { if (k.herplant) continue; stapel(k, 0.2, 0.26, 1.1, 0.36); nStap++; }
        if (nStap) {
          c.fillStyle = 'rgba(0,0,0,0.32)'; c.fill();
          c.beginPath(); for (const k of zicht) if (!k.herplant) stapel(k, 0, 0, 1.1, 0.36);
          c.fillStyle = '#6e5236'; c.fill();
          c.beginPath(); for (const k of zicht) if (!k.herplant) stapel(k, -0.04, -0.06, 1.1, 0.14);
          c.fillStyle = this.sn ? '#eef1f3' : '#8f7050'; c.fill();
          if (z >= DREMPEL.voren) {
            c.beginPath();
            for (const k of zicht) {
              if (k.herplant) continue;
              const hx = -Math.sin(k.hoek), hy = Math.cos(k.hoek), ex = k.sx + hx * 1.1, ey = k.sy + hy * 1.1;
              for (let j = 0; j < 4; j++) stip(c, ex + Math.cos(k.hoek) * (j - 1.5) * 0.17, ey + Math.sin(k.hoek) * (j - 1.5) * 0.17, 0.085);
            }
            c.fillStyle = '#d2b07e'; c.fill();
          }
          for (const k of zicht) {
            if (k.herplant || !k.truck) continue;
            // de vrachtwagen wordt geladen (de lading groeit stam voor stam) en staat 's nachts stil bij de stapel
            const hx = -Math.sin(k.hoek), hy = Math.cos(k.hoek), ux = Math.cos(k.hoek), uy = Math.sin(k.hoek);
            const vol = clamp(Math.floor(tri(this.klok / 400 + k.z) * 6) / 5, 0, 1);
            this.zetVoertuig(k.sx + ux * 0.95, k.sy + uy * 0.95, hx, hy, VRACHT, 4 + Math.floor(k.z * 3), A_GEEN, L_HOUT, 1, 1, vol);
          }
        }
        c.globalAlpha = a;
      }
      // bosarbeiders bij de stronken, met zaagsel dat opspat
      if (z >= DREMPEL.mens - 0.5 && this.dagMens > 0.02) for (const k of zicht) {
        if (k.herplant) continue;
        for (let i = 0; i < 2; i++) {
          const w = hash(k.t, i, 86) * TAU + Math.sin(this.klok / 30 + i) * 0.4, r = k.r * 0.55;
          this.zetMens(k.x + Math.cos(w) * r, k.y + Math.sin(w) * r * 0.85, 6, Math.sin(this.nu / 300 + i));
        }
      }
    }
    // zagerij
    for (const zg of this.zagerijen) {
      if (nZ >= PLAFOND.zagerijen || !this.inBeeld(zg.x, zg.y, 5)) continue;
      nZ++;
      const e = this.bak(`z:${Math.round(zg.z * 1e6)}:${this.P}:${this.sn}`, `z:${Math.round(zg.z * 1e6)}`, 7, 7, bakZagerij, zg);
      if (e) c.drawImage(e.cv, zg.x - e.bw / 2, zg.y - e.bh / 2, e.bw, e.bh);
      if (this.nacht > 0.3) this.zetLicht(zg.x, zg.y, 2.2, WARM, 0.8);
      if (z >= DREMPEL.mens - 0.5 && this.dagMens > 0.02) {
        const co = Math.cos(zg.hoek), si = Math.sin(zg.hoek), f = tri(this.klok / 50 + zg.z);
        this.zetMens(zg.x + co * (-1.5 + f * 2.5) - si * 0.3, zg.y + si * (-1.5 + f * 2.5) + co * 0.3, 2, 0);
      }
    }
    this.n.zagerijen = nZ; this.n.stronken = nSt; this.n.boompjes = nB; this.n.stapels = nStap;
  }

  // ---------- erven ----------

  tekenErven(c, z, a) {
    const zicht = this.zichtErf ?? (this.zichtErf = []);
    zicht.length = 0;
    for (const e of this.erven) { if (zicht.length < PLAFOND.erven && this.inBeeld(e.x, e.y, e.laan ? e.laan.len + 5 : 5)) zicht.push(e); }
    this.n.erven = zicht.length;
    if (!zicht.length) return;
    const nu = this.nu;
    // erfwegen: zandweg met twee karrensporen; in de winter besneeuwd, waar geschoven met walletjes sneeuw
    if (z >= DREMPEL.wagen - 0.8) {
      c.globalAlpha = a * smooth(DREMPEL.wagen - 0.8, DREMPEL.wagen, z);
      const lanen = this.selLaan ?? (this.selLaan = []);
      lanen.length = 0;
      for (const e of zicht) if (e.laan && lanen.length < PLAFOND.lanen) lanen.push(e);
      const nL = lanen.length;
      this.n.lanen = nL;
      if (nL) {
        c.beginPath();
        for (const e of lanen) { c.moveTo(e.laan.ax, e.laan.ay); c.lineTo(e.laan.bx, e.laan.by); }
        c.strokeStyle = this.sn ? 'rgba(232,236,238,0.95)' : 'rgba(132,110,78,0.9)'; c.lineWidth = 0.8; c.stroke();
        c.beginPath();
        for (const e of lanen) if (!this.sn || e.schuif) { c.moveTo(e.laan.ax, e.laan.ay); c.lineTo(e.laan.bx, e.laan.by); }
        c.strokeStyle = this.sn ? 'rgba(140,128,110,0.85)' : 'rgba(182,162,122,0.85)'; c.lineWidth = this.sn ? 0.6 : 0.36; c.stroke();
        if (z >= DREMPEL.hek) {
          c.beginPath();
          for (const e of lanen) for (const k of [-0.2, 0.2]) { const l = e.laan; c.moveTo(l.ax - l.dy * k, l.ay + l.dx * k); c.lineTo(l.bx - l.dy * k, l.by + l.dx * k); }
          c.strokeStyle = this.sn ? 'rgba(90,80,70,0.35)' : 'rgba(96,76,52,0.45)'; c.lineWidth = 0.07; c.stroke();
        }
      }
      c.globalAlpha = a;
    }
    // Wagens over de weg naar het erf en terug, de sneeuwschuiver en de trekker die op het erf geparkeerd staat.
    // Alles rijdt over een vast pad: een wagen vaagt in en uit op de weg, nooit midden op de erfweg of het erf.
    if (z >= DREMPEL.machine - 0.5) {
      let nW = 0, nS = 0;
      for (const e of zicht) {
        const l = e.laan;
        // sneeuwschuiver: gaat alleen aan of uit als hij op zijn parkeerplek staat
        let schuift = false;
        if (l && e.schuif && e.spad) {
          const P = (e.spadLen * 2) / 1.5 + 8, p = this.klok / P + e.z, f = tri(p);
          const wil = this.sz.sneeuw > 0.3;
          // omzetten mag als hij thuis staat, of als het erf het vorige beeld niet in beeld was (dan zag niemand het)
          if (wil !== e.schuifAan && (f * e.spadLen < 0.2 || e.beeld !== this.beeldNr - 1)) e.schuifAan = wil;
          e.beeld = this.beeldNr;
          if (e.schuifAan && nS < PLAFOND.schuivers) {
            this.langsPad(e.spad, e.spadN, e.spadLen, f * e.spadLen, 0, 0, 0, 0);
            const x = this.mx, y = this.my, terug = frac(p) >= 0.5, hx = terug ? -this.mhx : this.mhx, hy = terug ? -this.mhy : this.mhy;
            this.zetVoertuig(x, y, hx, hy, TREKKER, e.kleur, A_SCHUIF);
            this.schuif = this.schuif ?? new Float32Array(PLAFOND.schuivers * 4);
            const o = nS++ * 4; this.schuif[o] = x; this.schuif[o + 1] = y; this.schuif[o + 2] = hx; this.schuif[o + 3] = hy;
            if (nu % 900 < 450) this.zetLicht(x - hx * 0.1, y - hy * 0.1 - 0.3, 0.6, AMBER, 1);
            if (this.nacht > 0.3) this.zetLicht(x + hx * 0.9, y + hy * 0.9, 1.1, WARM, 0.8);
            schuift = true;
          }
        }
        // de trekker van het erf staat thuis zolang hij niet op het land is of sneeuw schuift
        if (!schuift && (e.velden.length || e.schuif)) this.zetVoertuig(e.px, e.py, e.si, -e.co, TREKKER, e.kleur, A_GEEN, L_GEEN, 1, this.erfThuis(e, this.dj));
        // een wagen van buiten (melk, graan, bestelling): de weg af, de erfweg op, even stilstaan, en terug de weg op
        if (!e.rin || nW >= PLAFOND.wagens) continue;
        const ronde = this.klok / e.P + e.z, t = frac(ronde) * e.P, id = Math.floor(ronde);
        if (t >= e.tIn + e.tStop + e.tUit) continue;
        if (e.rit !== id) { e.rit = id; const h = hash(e.t, id, 741); e.ritSoort = this.sz.oogst > 0.2 && h < 0.6 ? 2 : hash(e.t, id, 742) < 0.65 ? 1 : 0; }
        let dk = 1;
        if (t < e.tIn) { const d = t * 3; this.langsPad(e.rin, 4, e.rinLen, d, 0, 0, 0, 0); dk = smooth(0, 1.5, d); }
        else if (t < e.tIn + e.tStop) {
          // op het erf: keren voor de terugweg
          this.langsPad(e.rin, 4, e.rinLen, e.rinLen, 0, 0, 0, 0);
          const g = smooth(0.35, 0.75, (t - e.tIn) / e.tStop), h0 = Math.atan2(this.mhy, this.mhx) + Math.PI * g;
          this.mhx = Math.cos(h0); this.mhy = Math.sin(h0);
        } else { const d = (t - e.tIn - e.tStop) * 3; this.langsPad(e.ruit, 4, e.ruitLen, d, 0, 0, 0, 0); dk = smooth(0, 1.5, e.ruitLen - d); }
        const x = this.mx, y = this.my, hx = this.mhx, hy = this.mhy;
        if (e.ritSoort === 2) this.zetVoertuig(x, y, hx, hy, VRACHT, 6, A_GEEN, L_GRAAN, 1, dk);
        else if (e.ritSoort === 1) this.zetVoertuig(x, y, hx, hy, VRACHT, 4, A_GEEN, L_MELK, 1, dk);
        else this.zetVoertuig(x, y, hx, hy, BESTEL, 4 + Math.floor(e.z * 4), A_GEEN, L_GEEN, 1, dk);
        if (this.nacht > 0.3) this.zetLicht(x + hx * 0.9, y + hy * 0.9, 1.0, WARM, 0.7 * dk);
        nW++;
      }
      this.n.wagens = nW; this.n.schuivers = nS; this.nSchuif = nS;
    }
    // erflamp
    if (this.nacht > 0.3 && z >= DREMPEL.wagen) for (const e of zicht) if (e.lamp) this.zetLicht(e.x - e.co * 0.5 + e.si * 1.25, e.y - e.si * 0.5 - e.co * 1.25, 1.2, WARM, 0.75);
    // hooibergen: schaduw, hooi, palen, kap (lichte noordwestkant)
    if (z >= DREMPEL.hooi - 0.5) {
      c.globalAlpha = a * smooth(DREMPEL.hooi - 0.5, DREMPEL.hooi + 0.3, z);
      const hooi = this.selHooi ?? (this.selHooi = []);
      hooi.length = 0;
      for (const e of zicht) if (e.hooi && hooi.length < PLAFOND.hooibergen) hooi.push(e);
      const n = hooi.length;
      const H = 1.5;
      c.beginPath();
      for (const e of hooi) { rechthoek(c, e.hooi.x + H * S, e.hooi.y + H * S, e.co, e.si, 0.65, 0.65); rechthoek(c, e.hooi.x + 0.2, e.hooi.y + 0.25, e.co, e.si, 0.55, 0.55); }
      this.n.hooibergen = n;
      if (n) {
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
        c.beginPath(); for (const e of hooi) rechthoek(c, e.hooi.x, e.hooi.y, e.co, e.si, 0.5, 0.5);
        c.fillStyle = this.sz.zomer + this.sz.herfst > 0.4 ? '#d8be6a' : '#b9a060'; c.fill();
        c.beginPath();
        for (const e of hooi) for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const x = e.hooi.x + (u * e.co - v * e.si) * 0.58, y = e.hooi.y + (u * e.si + v * e.co) * 0.58; c.moveTo(x, y); c.lineTo(x, y - H); }
        c.strokeStyle = '#4a3a2a'; c.lineWidth = 0.08; c.stroke();
        for (let k = 0; k < 2; k++) {
          c.beginPath();
          for (const e of hooi) {
            // piramidekap in vier driehoeken; de twee naar het noordwesten gekeerde zijn licht
            const x = e.hooi.x, y = e.hooi.y - H, r = 0.7;
            for (let q = 0; q < 4; q++) {
              const a0 = Math.atan2(e.si, e.co) + (q * Math.PI) / 2 + Math.PI / 4, a1 = a0 + Math.PI / 2, mid = (a0 + a1) / 2;
              const licht = Math.cos(mid) * -0.7071 + Math.sin(mid) * -0.7071 > 0;
              if ((k === 1) !== licht) continue;
              c.moveTo(x, y - 0.35); c.lineTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r); c.lineTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r); c.closePath();
            }
          }
          const dak = this.sn ? ['#d5dadd', '#eef1f3'] : ['#6e5a36', '#9a8256'];
          c.fillStyle = dak[k]; c.fill();
        }
      }
      c.globalAlpha = a;
    }
    // kippen op het erf: scharrelen en pikken
    if (z >= DREMPEL.klein - 0.5) {
      c.globalAlpha = a * smooth(DREMPEL.klein - 0.5, DREMPEL.klein + 0.3, z);
      const kp = this.kip ?? (this.kip = new Float32Array(PLAFOND.kippen * 4));
      let n = 0;
      for (const e of zicht) {
        if (this.nacht > 0.6 || this.sz.sneeuw > 0.6) break;
        for (let i = 0; i < e.kippen && n < PLAFOND.kippen; i++) {
          const g = i < 3 ? [0.4, 1.35] : [-2.0, 0.35], w = nu / 9000 * (0.6 + hash(e.t, i, 91)) + hash(e.t, i, 92) * TAU;
          const u = g[0] + Math.cos(w) * 0.45 + (hash(e.t, i, 93) - 0.5) * 0.4, v = g[1] + Math.sin(w * 1.3) * 0.25;
          const o = n++ * 4;
          kp[o] = e.x + u * e.co - v * e.si; kp[o + 1] = e.y + u * e.si + v * e.co; kp[o + 2] = Math.floor(hash(e.t, i, 94) * 3); kp[o + 3] = w + Math.PI / 2;
        }
      }
      this.n.kippen = n;
      if (n) {
        c.beginPath(); for (let i = 0; i < n; i++) stip(c, kp[i * 4] + 0.04, kp[i * 4 + 1] + 0.05, 0.075);
        c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
        for (let k = 0; k < 3; k++) {
          c.beginPath(); let iets = false;
          for (let i = 0; i < n; i++) if (kp[i * 4 + 2] === k) { const o = i * 4, pik = Math.max(0, Math.sin(nu / 260 + i * 1.7)) * 0.04; stip(c, kp[o], kp[o + 1], 0.075); stip(c, kp[o] + Math.cos(kp[o + 3]) * (0.08 + pik), kp[o + 1] + Math.sin(kp[o + 3]) * (0.08 + pik), 0.04); iets = true; }
          if (iets) { c.fillStyle = KIP_KLEUR[k]; c.fill(); }
        }
        if (z >= DREMPEL.kleinst) {
          c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 4, pik = Math.max(0, Math.sin(nu / 260 + i * 1.7)) * 0.04; stip(c, kp[o] + Math.cos(kp[o + 3]) * (0.1 + pik), kp[o + 1] + Math.sin(kp[o + 3]) * (0.1 + pik) - 0.03, 0.018); }
          c.fillStyle = '#d8322a'; c.fill();
        }
      }
      c.globalAlpha = a;
    }
    // waakhond: ligt bij het huis, staat af en toe op voor een rondje, kwispelt
    if (z >= DREMPEL.hond - 0.5) {
      c.globalAlpha = a * smooth(DREMPEL.hond - 0.5, DREMPEL.hond + 0.3, z);
      let n = 0;
      const hd = this.hond ?? (this.hond = new Float32Array(PLAFOND.honden * 4));
      for (const e of zicht) {
        if (!e.hond || n >= PLAFOND.honden) continue;
        const f = frac(nu / 31000 + e.z), loop = f > 0.75 ? (f - 0.75) / 0.25 : 0, w = loop * TAU;
        const u = -2.05 + (loop ? Math.sin(w) * 0.7 : 0), v = -0.55 + (loop ? 1 - Math.cos(w) : 0) * 0.5;
        const o = n++ * 4;
        hd[o] = e.x + u * e.co - v * e.si; hd[o + 1] = e.y + u * e.si + v * e.co; hd[o + 2] = loop ? Math.atan2(e.si * Math.cos(w) + e.co * Math.sin(w), e.co * Math.cos(w) - e.si * Math.sin(w)) : Math.atan2(e.si, e.co) + Math.PI / 2; hd[o + 3] = e.hondKleur;
      }
      this.n.honden = n;
      if (n) {
        c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 4; rechthoek(c, hd[o] + 0.05, hd[o + 1] + 0.07, Math.cos(hd[o + 2]), Math.sin(hd[o + 2]), 0.2, 0.08); }
        c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
        for (let k = 0; k < HOND_KLEUR.length; k++) {
          c.beginPath(); let iets = false;
          for (let i = 0; i < n; i++) {
            const o = i * 4; if (hd[o + 3] !== k) continue;
            const hx = Math.cos(hd[o + 2]), hy = Math.sin(hd[o + 2]);
            rechthoek(c, hd[o], hd[o + 1], hx, hy, 0.18, 0.075); stip(c, hd[o] + hx * 0.22, hd[o + 1] + hy * 0.22, 0.07); iets = true;
          }
          if (iets) { c.fillStyle = HOND_KLEUR[k]; c.fill(); }
        }
        c.beginPath();
        for (let i = 0; i < n; i++) { const o = i * 4, hx = Math.cos(hd[o + 2]), hy = Math.sin(hd[o + 2]), kw = Math.sin(nu / 120 + i) * 0.5; c.moveTo(hd[o] - hx * 0.17, hd[o + 1] - hy * 0.17); c.lineTo(hd[o] - (hx * Math.cos(kw) - hy * Math.sin(kw)) * 0.32, hd[o + 1] - (hy * Math.cos(kw) + hx * Math.sin(kw)) * 0.32); }
        c.strokeStyle = '#3a2a1a'; c.lineWidth = 0.035; c.stroke();
      }
      c.globalAlpha = a;
    }
  }

  // ---------- hoge dingen: windmotoren, waterbogen, vogelverschrikkers, meeuwen, sneeuwpluim ----------

  tekenHoog(c, z, a) {
    const nu = this.nu;
    // vogelverschrikkers: paal, jas met scheve armen, hoed, wapperende lap
    if (this.nSchrik) {
      const b = this.schrik, n = this.nSchrik, wx = Math.cos(this.wd.hoek), wy = Math.sin(this.wd.hoek);
      c.globalAlpha = a * smooth(DREMPEL.schrik - 0.5, DREMPEL.schrik + 0.3, z);
      c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 3; c.moveTo(b[o], b[o + 1]); c.lineTo(b[o] + 1.2 * S, b[o + 1] + 1.2 * S); }
      c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 0.14; c.stroke();
      c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 3; c.moveTo(b[o], b[o + 1]); c.lineTo(b[o], b[o + 1] - 0.9); c.moveTo(b[o] - 0.38, b[o + 1] - 0.62); c.lineTo(b[o], b[o + 1] - 0.82); c.lineTo(b[o] + 0.36, b[o + 1] - 0.68); }
      c.strokeStyle = '#5a4430'; c.lineWidth = 0.07; c.stroke();
      c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 3; rechthoek(c, b[o], b[o + 1] - 0.68, 0, 1, 0.16, 0.12); }
      c.fillStyle = '#6a4a6a'; c.fill();
      c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 3; c.moveTo(b[o] + 0.17, b[o + 1] - 1.0); c.ellipse(b[o], b[o + 1] - 1.0, 0.17, 0.1, 0, 0, TAU); }
      c.fillStyle = '#c9a95a'; c.fill();
      c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 3, f = Math.sin(nu / 180 + b[o + 2] * 9) * 0.08; c.moveTo(b[o] + 0.36, b[o + 1] - 0.68); c.lineTo(b[o] + 0.36 + wx * 0.25 + f, b[o + 1] - 0.68 + wy * 0.25 - f); }
      c.strokeStyle = '#b8322a'; c.lineWidth = 0.06; c.stroke();
      c.globalAlpha = a;
    }
    // windmotoren op de erven: vakwerktoren, rad dat met de wind draait, staartvaan
    if (z >= DREMPEL.molen - 0.5) {
      c.globalAlpha = a * smooth(DREMPEL.molen - 0.5, DREMPEL.molen + 0.3, z);
      const zicht = this.zichtErf ?? [];
      const mb = this.molenBuf ?? (this.molenBuf = new Float32Array(PLAFOND.molens * 2));
      let n = 0;
      for (const e of zicht) if (e.molen && n < PLAFOND.molens) { const o = n++ * 2; mb[o] = e.x + 0.45 * e.co + 1.35 * e.si; mb[o + 1] = e.y + 0.45 * e.si - 1.35 * e.co; }
      this.n.molens = n;
      if (n) {
        const Hm = 2.4, r = 0.62, rot = (nu / 1000) * (1.5 + 5 * this.wd.kracht), wh = this.wd.hoek, ex = Math.cos(wh), ey = Math.sin(wh);
        c.beginPath();
        for (let i = 0; i < n; i++) { const x = mb[i * 2], y = mb[i * 2 + 1]; c.moveTo(x - 0.25, y); c.lineTo(x + Hm * S, y + Hm * S); c.moveTo(x + 0.25, y); c.lineTo(x + Hm * S, y + Hm * S); c.moveTo(x + Hm * S + r * 0.8, y + Hm * S); c.ellipse(x + Hm * S, y + Hm * S, r * 0.8, r * 0.5, wh, 0, TAU); }
        c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 0.07; c.stroke();
        c.beginPath();
        for (let i = 0; i < n; i++) {
          const x = mb[i * 2], y = mb[i * 2 + 1];
          c.moveTo(x - 0.28, y); c.lineTo(x - 0.04, y - Hm); c.moveTo(x + 0.28, y); c.lineTo(x + 0.04, y - Hm);
          if (z >= DREMPEL.mens) for (let k = 1; k < 4; k++) { const hh = (k / 4) * Hm, w = 0.28 - 0.24 * (k / 4); c.moveTo(x - w, y - hh); c.lineTo(x + w, y - hh + Hm / 4); }
          // staartvaan van de wind af
          c.moveTo(x, y - Hm); c.lineTo(x - ex * 0.9, y - Hm - ey * 0.5);
        }
        c.strokeStyle = '#6a6e70'; c.lineWidth = 0.05; c.stroke();
        // het rad: een ring met schoepen, dwars op de wind (een platte ellips)
        c.beginPath();
        for (let i = 0; i < n; i++) {
          const x = mb[i * 2] + ex * 0.12, y = mb[i * 2 + 1] - Hm + ey * 0.06, ka = Math.abs(Math.sin(wh)) * 0.75 + 0.25;
          for (let k = 0; k < 12; k++) { const w = rot + (k * TAU) / 12, dx = -ey * Math.cos(w) * r * ka - ex * 0.0, dy = ex * Math.cos(w) * r * ka * 0.5 - Math.sin(w) * r; c.moveTo(x, y); c.lineTo(x + dx, y + dy); }
        }
        c.strokeStyle = '#c9ced2'; c.lineWidth = 0.05; c.stroke();
        c.beginPath();
        for (let i = 0; i < n; i++) { const x = mb[i * 2] + ex * 0.12, y = mb[i * 2 + 1] - Hm + ey * 0.06; c.moveTo(x - ex * 0.9 - ey * 0.08, y - ey * 0.5); c.lineTo(x - ex * 0.9 + ey * 0.08, y - ey * 0.5 - 0.22); }
        c.strokeStyle = '#b8322a'; c.lineWidth = 0.12; c.stroke();
      }
      c.globalAlpha = a;
    }
    // waterbogen van de sproeiers: druppels langs een boog, schaduw op het gewas, nevel aan het eind
    if (this.nSproei && z >= DREMPEL.sproei) {
      const b = this.sproei, n = this.nSproei;
      c.globalAlpha = a * smooth(DREMPEL.sproei, DREMPEL.sproei + 0.5, z);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * 6, x = b[o], y = b[o + 1], hk = b[o + 2], R = b[o + 5], dx = Math.cos(hk), dy = Math.sin(hk);
        c.moveTo(x, y - 0.4);
        for (let k = 1; k <= 8; k++) { const s = k / 8, h = 0.4 + 4 * 1.0 * s * (1 - s); c.lineTo(x + dx * R * s, y + dy * R * s - h); }
      }
      c.strokeStyle = 'rgba(225,240,250,0.65)'; c.lineWidth = 0.07; c.stroke();
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * 6, x = b[o], y = b[o + 1], hk = b[o + 2], R = b[o + 5], dx = Math.cos(hk), dy = Math.sin(hk);
        for (let k = 0; k < 6; k++) { const f = frac(nu / 500 + k / 6), s = 0.4 + f * 0.6, sp = (hash(i, k, 71) - 0.5) * 0.5; stip(c, x + dx * R * s - dy * sp, y + dy * R * s + dx * sp - 4 * s * (1 - s), 0.05 + f * 0.05); }
        stip(c, x + dx * R, y + dy * R - 0.05, 0.45);
      }
      c.fillStyle = 'rgba(235,245,252,0.35)'; c.fill();
      c.globalAlpha = a;
    }
    // sneeuwpluim voor de schuiver
    if (this.nSchuif && z >= DREMPEL.schrik) {
      const b = this.schuif;
      c.globalAlpha = a;
      c.beginPath();
      for (let i = 0; i < this.nSchuif; i++) { const o = i * 4; for (let k = 0; k < 5; k++) { const f = frac(nu / 400 + k / 5); stip(c, b[o] + b[o + 2] * 0.6 - b[o + 3] * (0.4 + f * 0.6), b[o + 1] + b[o + 3] * 0.6 + b[o + 2] * (0.4 + f * 0.6) - f * 0.3, 0.06 + f * 0.1); } }
      c.fillStyle = 'rgba(250,252,255,0.75)'; c.fill();
    }
    // meeuwen: in de lucht met slaande vleugels (schaduw eronder), of pikkend op de voren
    if (this.nMeeuw) {
      const b = this.meeuw, n = this.nMeeuw;
      c.globalAlpha = a * smooth(DREMPEL.meeuw - 0.5, DREMPEL.meeuw + 0.3, z);
      c.beginPath(); for (let i = 0; i < n; i++) { const o = i * 4; stip(c, b[o] + b[o + 2] * S, b[o + 1] + b[o + 2] * S, 0.07); }
      c.fillStyle = 'rgba(0,0,0,0.22)'; c.fill();
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * 4, x = b[o], y = b[o + 1] - b[o + 2];
        if (b[o + 3] < 0) { stip(c, x, y, 0.07); continue; }
        const sl = Math.sin(b[o + 3]) * 0.12;
        c.moveTo(x - 0.22, y - sl); c.quadraticCurveTo(x - 0.08, y - 0.05, x, y); c.quadraticCurveTo(x + 0.08, y - 0.05, x + 0.22, y - sl);
      }
      c.strokeStyle = '#f4f2ec'; c.lineWidth = 0.06; c.stroke();
      c.fillStyle = '#f4f2ec'; c.fill();
      this.n.meeuwen = n;
      c.globalAlpha = a;
    }
  }

  // Na de nachtlaag: kassen die oranje gloeien, erflampen, lampen van de groeven en de zagerij, zwaailicht.
  tekenLichten(c, view, sc, nu) {
    const nacht = view.nacht ?? 0, k = nacht * (this.vervaag ?? 0);
    if (!this.gloed || (k < 0.05 && !this.nSchuif)) return;
    c.save();
    c.transform(sc, 0, 0, sc, this.ox, this.oy);
    c.globalCompositeOperation = 'lighter';
    // kassen: het glas zelf gloeit, met een oranje waas erboven
    if (k >= 0.05 && this.zicht) {
      c.globalAlpha = k * 0.55;
      c.beginPath(); let nK = 0;
      for (const v of this.zicht) {
        if (!(v.f & 131072) || nK >= PLAFOND.kassen) continue;
        nK++;
        if (!v.ruit) { rechthoek(c, v.x, v.y, v.co, v.si, v.hu, v.hv); continue; }
        for (let i = 0; i < v.ruit.length; i++) {
          if (!v.ruit[i]) continue;
          const u0 = -v.hu + i * 0.6, u1 = Math.min(v.hu, u0 + 0.6), um = (u0 + u1) / 2;
          rechthoek(c, v.x + um * v.co, v.y + um * v.si, v.co, v.si, (u1 - u0) / 2, v.hv);
        }
      }
      if (nK) {
        c.fillStyle = 'rgb(255,150,60)'; c.fill();
        const sp = this.gloed[ORANJE];
        let m = 0;
        if (sp) for (const v of this.zicht) if ((v.f & 131072) && m++ < PLAFOND.kassen) { const r = Math.max(v.hu, v.hv) * 1.6; c.globalAlpha = k * 0.5; c.drawImage(sp, v.x - r, v.y - r, r * 2, r * 2); }
      }
    }
    const b = this.licht;
    for (let i = 0; i < this.nLicht; i++) {
      const o = i * LICHT, soort = b[o + 3], r = b[o + 2];
      const sprite = soort === WARM && view.lichtSprite ? view.lichtSprite : this.gloed[soort];
      if (!sprite) continue;
      c.globalAlpha = Math.min(1, (soort === AMBER ? Math.max(k, 0.5 * (this.vervaag ?? 1)) : k) * b[o + 4]);
      c.drawImage(sprite, b[o] - r, b[o + 1] - r, r * 2, r * 2);
    }
    c.restore();
  }

  // ---------- voor tests en andere lagen ----------

  telling() { return { ...this.n, sprites: this.cache.size }; }

  statistiek() {
    let rollen = {};
    for (const v of this.velden) for (const [naam, bit] of [['ploegen', R_PLOEG], ['zaaien', R_ZAAI], ['sproeiers', R_SPROEI], ['balen', R_BALEN], ['kuil', R_KUIL], ['mest', R_MEST], ['bollen', R_BOL], ['pluk', R_PLUK], ['druif', R_DRUIF], ['kassen', R_KAS], ['schrik', R_SCHRIK], ['hekken', R_HEK], ['stoppel', R_STOPPEL], ['bijen', R_BIJ]]) if (v.rol & bit) rollen[naam] = (rollen[naam] ?? 0) + 1;
    return {
      sprites: this.cache.size, bytes: this.bytes, gebakken: this.gebakken,
      velden: this.velden.length, erven: this.erven.length, lanen: this.erven.filter((e) => e.laan).length, hooibergen: this.erven.filter((e) => e.hooi).length,
      molens: this.erven.filter((e) => e.molen).length, kaalslagen: this.kaal.filter((k) => !k.herplant).length, herplant: this.kaal.filter((k) => k.herplant).length,
      zagerijen: this.zagerijen.length, groeven: this.groeven.length, jaknikkers: this.jaknikkers.length, ...rollen,
    };
  }

  // Waar alles ligt (wereldcoördinaten), alleen-lezen: om naartoe te zoomen of te testen.
  plekken() { return this.plekLijst; }
}
