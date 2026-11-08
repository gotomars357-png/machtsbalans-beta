// In de lucht (pakket E van detailronde C9): wat er boven de kaart vliegt, van bovenaf gezien, elk met een schaduw
// die naar het zuidoosten op de grond valt, verder weg naarmate het hoger vliegt.
// - Overdag: zwermen spreeuwen die in de herfstschemering als één wolk van vorm veranderen boven akkers en riet;
//   vliegers en kitesurfers bij stille, winderige stranden; paragliders die van de bergen af langzaam spiralen;
//   zweefvliegtuigen in de zomerthermiek met af en toe een sleepvliegtuig; parachutisten bij kazernes met koepels
//   die openklappen; een sproeivliegtuigje boven de akkers; postduiven boven de woonwijken; oude condensstrepen
//   die in de windrichting uitwaaieren (de vliegtuigen zelf tekent leven.js); bezorgdrones in welvarende
//   hoofdsteden; een reclameluchtschip zonder tekst boven de hoofdstad bij feest of welvaart.
// - In oorlog, alleen boven landen die in oorlog zijn (state.oorlogen, openbaar): straaljagers in formatie,
//   transporthelikopters met twee rotors, verkenningsdrones hoog in de lucht en 's nachts luchtafweer boven de
//   hoofdstad (troepen.js tekent het vuur bij de eenheden zelf, dit is het afweervuur boven de stad).
// - Na de nachtlaag (tekenNacht): knipperende navigatielichten van alles wat hier vliegt, en op heldere
//   winternachten een zacht poollicht van groene en paarse sluiers boven het hoge noorden, nooit over steden.
// Bewust niet: ganzen in V-vorm (leven.js tekent de trekvogels al zo), vliegers op de wei, de helikopter boven de
// hoofdstad, roofvogels en verkeersvliegtuigen (leven.js, natuur.js, infra.js).
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Plekken komen uit vaste hashes van vakje,
// volgnummer en dag; de klok (nu) stuurt alleen beweging. Geen Math.random, geen Date.
// Detail komt trapsgewijs op (zie DREMPEL): zoom 3-6 zwermen, strepen, jagers, luchtschip en zweefvliegers als
// grove vormen, 6-10 vliegers, paragliders, parachutes, drones en duiven, 10-14 lijnen, piloten, rotorbladen,
// pakketjes, cellen in de schermen en het kielzog van de kitesurfers.

import { seizoen, weer, wind } from './seizoen.js';

// ---------- gedeelde hulpjes (eigen kopie, zie inzoom-spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
// Driehoeksgolf 0 → 1 → 0: heen en weer.
const tri = (v) => 1 - Math.abs(1 - 2 * frac(v));
const TAU = Math.PI * 2;
// Schaduw per hoogte-eenheid: zon in het noordwesten, iets lager dan 45° (zoals de vliegtuigen van leven.js).
const SX = 0.75, SY = 1.0;
// Dezelfde dag-en-nachtcyclus als tekenNacht in map.js (die komt na deze laag, dus zelf uitrekenen).
const faseOp = (nu) => (nu / 1000 % 180) / 180;
function nachtOp(nu) { const licht = 0.5 + 0.5 * Math.cos(faseOp(nu) * TAU); return clamp((0.5 - licht) / 0.5, 0, 1); }

// Canvasfabriek: pas bij gebruik een canvas maken, zodat de module ook zonder document (in Node) laadt.
const standaardFabriek = (w, h) => (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h })
  : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : null);
let fabriek = standaardFabriek;
export function zetCanvasFabriek(fn) { fabriek = fn ?? standaardFabriek; }

// ---------- vaste waarden ----------

// Harde plafonds per beeld.
export const PLAFOND = {
  zwermen: 2, spreeuwen: 190, vliegers: 14, kiters: 6, paragliders: 9, zweefvliegers: 6, sleep: 1, parachutes: 12,
  dropvliegtuigen: 2, landingen: 2, banieren: 1, sproeiers: 2, duiven: 36, strepen: 5, bezorgdrones: 8, luchtschepen: 2,
  jagers: 8, transport: 4, verkenners: 3, afweer: 16, flak: 8, lichten: 72, poolstroken: 60,
};
// Vanaf welke zoom iets verschijnt (de kaart wordt 'diep' op zoom 4). Andere lagen mogen dit lezen.
export const DREMPEL = {
  streep: 2, jager: 3, zwerm: 3.2, luchtschip: 3.5, verkenner: 4, zweef: 4.5, paraglider: 5.5, sproeier: 5.5,
  transport: 5, parachute: 5.5, banier: 4.5, vlieger: 6.5, kiter: 7, duif: 7, drone: 7.5, lijnen: 10, piloot: 11, klein: 12,
};

// Kleuren. Fictief en zonder merken.
const VLIEGER = ['#d9443a', '#f0b429', '#2f7fc1', '#3aa76d', '#8a4fb8', '#ee7a2f', '#e8e4da'];
const SCHERM = ['#d9443a', '#2f7fc1', '#f0b429', '#3aa76d', '#ee7a2f', '#7a4fb8', '#1f9aa0'];
const LUCHTSCHIP = [['#e9e6dc', '#c9442f'], ['#dfe3e8', '#2f6d9a'], ['#efe8d2', '#3d7a4f'], ['#e6e2ea', '#d9a63a']];
const ROMP = '#f4f5f2', JAGER = '#7d858c', LEGER = '#5a6448', DRONE = '#3a3f45', DUIF = '#7f8894';

// Lichtsoorten in de lichtbuffer (index in de gloedsprites).
const ROOD = 0, GROEN = 1, WIT = 2, WARM = 3, ORANJE = 4;
const LICHTKLEUR = [[255, 60, 50], [70, 255, 110], [235, 242, 255], [255, 214, 140], [255, 150, 60]];
const LICHT = 5; // x, y (wereld), straal (wereld), soort, sterkte

// Silhouetten van bovenaf (neus naar +u, v opzij), in lengtes.
const JAGER_VORM = [1, 0, 0.55, 0.07, 0.08, 0.1, -0.32, 0.46, -0.44, 0.46, -0.36, 0.11, -0.55, 0.2, -0.64, 0.2, -0.6, 0, -0.64, -0.2, -0.55, -0.2, -0.36, -0.11, -0.44, -0.46, -0.32, -0.46, 0.08, -0.1, 0.55, -0.07];
const KLEIN_VORM = [0.5, 0, 0.42, 0.05, 0.12, 0.06, 0.1, 0.5, -0.02, 0.5, -0.04, 0.06, -0.38, 0.04, -0.4, 0.16, -0.48, 0.16, -0.47, 0, -0.48, -0.16, -0.4, -0.16, -0.38, -0.04, -0.04, -0.06, -0.02, -0.5, 0.1, -0.5, 0.12, -0.06, 0.42, -0.05];
const ZWEEF_VORM = [0.42, 0, 0.3, 0.035, 0.08, 0.035, 0.07, 0.9, 0.0, 0.9, -0.01, 0.035, -0.5, 0.02, -0.52, 0.14, -0.57, 0.14, -0.56, 0, -0.57, -0.14, -0.52, -0.14, -0.5, -0.02, -0.01, -0.035, 0.0, -0.9, 0.07, -0.9, 0.08, -0.035, 0.3, -0.035];
const VERKENNER_VORM = [0.42, 0, 0.36, 0.05, 0.05, 0.05, 0.03, 0.75, -0.04, 0.75, -0.06, 0.05, -0.4, 0.03, -0.5, 0.18, -0.55, 0.16, -0.48, 0, -0.55, -0.16, -0.5, -0.18, -0.4, -0.03, -0.06, -0.05, -0.04, -0.75, 0.03, -0.75, 0.05, -0.05, 0.36, -0.05];
// Opstelling van een formatie straaljagers (langs, opzij), in lengtes: een wig van vier.
const FORMATIE = [0, 0, -1.6, 1.5, -1.6, -1.5, -3.2, 3.0];
// Vaste lijstjes, zodat de tekenlussen niets aanmaken.
const VIN_VORM = [0.1, 0, -0.2, 0.36, -0.28, 0.36, -0.18, 0, -0.28, -0.36, -0.2, -0.36];
const JAGER_ZIJ = [0.55, 0, 0.08, 0.1, -0.32, 0.46, -0.44, 0.46, -0.36, 0.11, -0.6, 0];
const HOEKEN = [1, 1, 1, -1, -1, 1, -1, -1];
const LIJN4 = [-0.85, -0.4, 0.4, 0.85];
const DRIE = [-0.5, 0, 0.5];
const PAAR = [-1, 1];
const BUUR_K = [1, 1, 0, -1, -1, -1, 0, 1], BUUR_R = [0, 1, 1, 1, 0, -1, -1, -1];
const RING2 = [2, 0, 2, 1, 2, 2, 1, 2, 0, 2, -1, 2, -2, 2, -2, 1, -2, 0, -2, -1, -2, -2, -1, -2, 0, -2, 1, -2, 2, -2, 2, -1];
// waar in een buurvakje de landingsplek kan liggen (in vakjes), het midden eerst
const ZONE_OFF = [0, 0, 0.2, 0, -0.2, 0, 0, 0.2, 0, -0.2];

// Een veelhoek uit vaste punten, gedraaid naar (hx, hy) en geschaald met s, als subpad.
function vorm(c, x, y, hx, hy, s, P) {
  for (let k = 0; k < P.length; k += 2) {
    const px = x + (P[k] * hx - P[k + 1] * hy) * s, py = y + (P[k] * hy + P[k + 1] * hx) * s;
    if (k) c.lineTo(px, py); else c.moveTo(px, py);
  }
  c.closePath();
}
// Gedraaide rechthoek van (u0, v0) tot (u1, v1) in lokale coördinaten.
function blok(c, x, y, hx, hy, u0, v0, u1, v1) {
  c.moveTo(x + u0 * hx - v0 * hy, y + u0 * hy + v0 * hx);
  c.lineTo(x + u1 * hx - v0 * hy, y + u1 * hy + v0 * hx);
  c.lineTo(x + u1 * hx - v1 * hy, y + u1 * hy + v1 * hx);
  c.lineTo(x + u0 * hx - v1 * hy, y + u0 * hy + v1 * hx);
  c.closePath();
}
function stip(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
// Vogel als vleugel-V (voor een stroke); slag 0..1 bepaalt hoe ver de vleugels naar voren staan.
function vleugelV(c, x, y, hx, hy, s, slag) {
  const terug = s * (0.15 + 0.35 * slag);
  c.moveTo(x - hx * terug - hy * s, y - hy * terug + hx * s);
  c.lineTo(x, y);
  c.lineTo(x - hx * terug + hy * s, y - hy * terug - hx * s);
}
// Halve maan van een scherm (paraglider, kite): boog dwars op de vliegrichting, dikte d, breedte b, bolling k.
function schermVorm(c, x, y, hx, hy, b, d, k) {
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const v = (i / n - 0.5) * 2, u = k * (1 - v * v);
    const px = x + u * hx - v * b * hy, py = y + u * hy + v * b * hx;
    if (i) c.lineTo(px, py); else c.moveTo(px, py);
  }
  for (let i = n; i >= 0; i--) {
    const v = (i / n - 0.5) * 2, u = k * (1 - v * v) - d * (1 - 0.5 * v * v);
    c.lineTo(x + u * hx - v * b * hy, y + u * hy + v * b * hx);
  }
  c.closePath();
}

function bakGloed(cv, [r, g, b]) {
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(0.25, `rgba(${r},${g},${b},0.55)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = gr; c.fillRect(0, 0, 32, 32);
}
// Eén sluier van het poollicht: onderaan een scherpe groene rand, naar boven toe paars en vervagend.
function bakSluier(cv) {
  const c = cv.getContext('2d');
  const gr = c.createLinearGradient(0, 64, 0, 0);
  gr.addColorStop(0, 'rgba(60,255,140,0)'); gr.addColorStop(0.07, 'rgba(90,255,160,0.95)'); gr.addColorStop(0.3, 'rgba(70,230,150,0.55)');
  gr.addColorStop(0.62, 'rgba(140,90,240,0.32)'); gr.addColorStop(1, 'rgba(170,80,230,0)');
  c.fillStyle = gr; c.fillRect(0, 0, 8, 64);
  // zachte zijkanten, zodat naburige sluiers in elkaar overlopen
  const zij = c.createLinearGradient(0, 0, 8, 0);
  zij.addColorStop(0, 'rgba(0,0,0,1)'); zij.addColorStop(0.35, 'rgba(0,0,0,0)'); zij.addColorStop(0.65, 'rgba(0,0,0,0)'); zij.addColorStop(1, 'rgba(0,0,0,1)');
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = zij; c.fillRect(0, 0, 8, 64);
}

// Plekken kiezen: kandidaten op hash, met een minimale afstand en een maximum.
function kies(kand, afstand, max) {
  kand.sort((a, b) => a.h - b.h || a.t - b.t);
  const uit = [];
  for (const k of kand) {
    if (uit.length >= max) break;
    let vrij = true;
    for (let i = 0; i < uit.length && vrij; i++) if ((uit[i].x - k.x) ** 2 + (uit[i].y - k.y) ** 2 < afstand * afstand) vrij = false;
    if (vrij) uit.push(k);
  }
  return uit;
}
const segAfstand = (x, y, ax, ay, bx, by) => { const lx = bx - ax, ly = by - ay, ll = lx * lx + ly * ly || 1, t = clamp(((x - ax) * lx + (y - ay) * ly) / ll, 0, 1); return Math.hypot(ax + lx * t - x, ay + ly * t - y); };

export class HemelLaag {
  constructor() {
    this.state = null;
    this.geo = null;
    this.eigenaar = null;
    this.basis = null;
    this.n = {};
    this.licht = new Float32Array(PLAFOND.lichten * LICHT);
    this.nLicht = 0;
    // vaste vorm van een zwerm: per spreeuw een plek in de eenheidsschijf
    this.zwermU = new Float32Array(PLAFOND.spreeuwen);
    this.zwermV = new Float32Array(PLAFOND.spreeuwen);
    for (let k = 0; k < PLAFOND.spreeuwen; k++) {
      const a = hash(k, 11) * TAU, r = Math.pow(hash(k, 12), 0.62);
      this.zwermU[k] = Math.cos(a) * r; this.zwermV[k] = Math.sin(a) * r;
    }
    this.sprites = null;
    this.szDag = -1;
    this.dagSig = null;
    this.nul();
  }

  nul() {
    for (const k of Object.keys(PLAFOND)) this.n[k] = 0;
    this.nLicht = 0;
  }

  // Na het laden van een spel: de vaste plekken van deze wereld opnieuw kiezen.
  laad(view) {
    this.state = view.state;
    this.geo = view.geo;
    this.eigenaar = view.eigenaar;
    this.terrein = view.terreinLaag ?? null;
    this.basis = this.terrein?.basis ?? null;
    this.dagSig = null;
    this.wegSig = null;
    this.zwermPlekken = []; this.bergPlekken = []; this.thermiek = []; this.stranden = [];
    if (!this.geo || !this.eigenaar || !this.state) return;
    const geo = this.geo, Tw = geo.T, v = this.basis ? this.terrein.vlaggen : null;
    const nT = geo.tegels.length;
    // bij een stad: de vlag van terrein.js, anders binnen twee vakjes van een hoofdstad
    this.stad = new Uint8Array(nT);
    if (v) this.stad.set(v.stad);
    else for (const t of geo.tegels) for (const h of geo.hoofdstad) { const q = geo.tegels[h]; if (q && Math.max(Math.abs(q.k - t.k), Math.abs(q.r - t.r)) <= 2) this.stad[t.i] = 1; }
    const zwerm = [], berg = [], veld = [];
    this.strandVan = new Int16Array(nT).fill(-1);
    this.stranden = [];
    for (const t of geo.tegels) {
      if (t.terrein === 'water' || this.stad[t.i]) continue;
      const akker = v ? v.akker[t.i] : t.terrein === 'vlakte' && hash(t.i, 3) < 0.45;
      if (akker || (v && v.moeras[t.i])) zwerm.push({ t: t.i, x: t.x, y: t.y, h: hash(t.i, 401) });
      if (t.terrein === 'berg' && (t.hoogte ?? 0) > 0.55) berg.push({ t: t.i, x: t.x, y: t.y, h: hash(t.i, 402) });
      if (t.terrein === 'vlakte') veld.push({ t: t.i, x: t.x, y: t.y, h: hash(t.i, 403) });
      // stille stranden: kustvakjes waar leven.js geen parasols en zwemmers zet (zelfde hash als daar)
      if (t.terrein === 'kust' && hash(t.i, 175) >= 0.6) this.plaatsStrand(t);
    }
    this.zwermPlekken = kies(zwerm, 70, 8);
    this.bergPlekken = kies(berg, 46, 10);
    this.thermiek = kies(veld, 90, 6);
    // akkers voor het sproeivliegtuig: vast per wereld, elke dag een paar actief
    this.akkerVan = new Uint8Array(nT);
    if (v) for (let i = 0; i < nT; i++) this.akkerVan[i] = v.akker[i] && !this.stad[i] ? 1 : 0;
    // poollicht: welke stroken (om de acht eenheden langs de breedte) boven een stad hangen, per hoogte in het noorden
    this.poolStad = new Uint8Array(126 * 8);
    for (let s = 0; s < 126; s++) for (let r = 0; r < 8; r++) {
      const x = s * 8 + 4, y = 16 + r * 16;
      let stad = 0;
      for (let dy = -16; dy <= 16 && !stad; dy += 16) for (let dx = -16; dx <= 16 && !stad; dx += 16) { const t = this.tegelVan(x + dx, y + dy); if (this.stad[t]) stad = 1; }
      this.poolStad[s * 8 + r] = stad;
    }
    this.Tw = Tw;
  }

  tegelVan(x, y) {
    const geo = this.geo;
    return clamp(Math.floor(y / geo.T), 0, geo.rij - 1) * geo.kol + clamp(Math.floor(x / geo.T), 0, geo.kol - 1);
  }
  zee(x, y) { return x < 0 || y < 0 || x >= 1000 || y >= 620 || this.eigenaar[Math.floor(y) * 1000 + Math.floor(x)] === -1; }
  nat(x, y) { return this.zee(x, y) || (this.terrein?.basis ? this.terrein.isRivier(x, y, 0.3) || this.terrein.isMeer(x, y) : false); }

  // Een stil strand: twee plekken op het zand voor iemand met een vlieger, en een stuk zee voor een kitesurfer.
  plaatsStrand(t) {
    const geo = this.geo, Tw = geo.T;
    let wx = 0, wy = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
      const k = t.k + dk, r = t.r + dr;
      if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
      if (geo.tegels[r * geo.kol + k].terrein === 'water') { wx += dk; wy += dr; }
    }
    const l = Math.hypot(wx, wy);
    if (!l) return;
    wx /= l; wy /= l;
    const vrij = (x, y) => !this.nat(x, y) && !this.nat(x + wx * 0.8, y + wy * 0.8) && !this.nat(x - wx * 0.8, y - wy * 0.8) && (!this.terrein?.basis || this.terrein.boomvrij(x, y, 0.3));
    const pl = [];
    for (const zij of [-0.36, 0.36, -0.2, 0.2]) {
      if (pl.length >= 4) break;
      for (const af of [0.12, 0.0, -0.12]) {
        const x = t.x + wx * af * Tw - wy * zij * Tw, y = t.y + wy * af * Tw + wx * zij * Tw;
        if (vrij(x, y)) { pl.push(x, y); break; }
      }
    }
    // de kitesurfer vaart langs de kust heen en weer, ruim voorbij de branding en de zwemmers
    let kite = null;
    for (const af of [1.05, 1.25, 1.45]) {
      const bx = t.x + wx * af * Tw, by = t.y + wy * af * Tw;
      let ok = true;
      for (let s = -1; s <= 1 && ok; s += 0.25) for (const d of [-0.25, 0, 0.25]) if (!this.zee(bx - wy * s * 0.34 * Tw + wx * d * Tw, by + wx * s * 0.34 * Tw + wy * d * Tw)) { ok = false; break; }
      // niet waar leven.js zeilboten (kustwater) of vissers (open water) laat varen
      for (let s = -1.6; s <= 1.6 && ok; s += 0.4) for (const d of [-0.6, 0, 0.6]) {
        const ti = this.tegelVan(bx - wy * s * 0.34 * Tw + wx * d * Tw, by + wx * s * 0.34 * Tw + wy * d * Tw);
        if (geo.tegels[ti].terrein === 'water' && (hash(ti, 5) < 0.08 || hash(ti, 71) < 0.07)) { ok = false; break; }
      }
      if (ok) { kite = [bx, by]; break; }
    }
    if (pl.length < 2 && !kite) return;
    this.strandVan[t.i] = this.stranden.length;
    this.stranden.push({ t: t.i, x: t.x, y: t.y, wx, wy, pl: pl.slice(0, 4), kite, vrij: new Uint8Array(pl.length >> 1).fill(1) });
  }

  // Eens per dag (of na nieuwe gebouwen): kazernes, woonwijken, oorlogen en welvaart.
  werkDag(view) {
    const s = this.state;
    let np = 0;
    for (const l of s.landen) np += l.plaatsingen.length;
    // getallen vergelijken in plaats van elk beeld een nieuwe tekenreeks te bouwen
    const d = this.dagSig;
    if (d && d[0] === s.dag && d[1] === np && d[2] === s.oorlogen.length && d[3] === (s.grensVersie ?? 0)) return;
    this.dagSig = [s.dag, np, s.oorlogen.length, s.grensVersie ?? 0];
    const n = s.landen.length;
    const G = s.pack?.gebouwIndex ?? {};
    this.kazernes = [];
    this.wijken = [];
    this.havens = new Uint8Array(this.geo.tegels.length);
    for (const l of s.landen) for (const p of l.plaatsingen) {
      if (p.t < 0) continue;
      if (G[p.g]?.handel_bonus) this.havens[p.t] = 1;
      if (p.g === 'kazerne') this.kazernes.push({ t: p.t, land: l.idx, zone: this.landingsZone(p.t) });
      else if (p.g === 'woonwijk') this.wijken.push(p.t);
    }
    // per land: in oorlog, de hoofdstad van een vijand, welvaart
    const partij = (c) => (c.alignment && c.alignment !== 'zwevend' ? c.alignment : `land:${c.idx}`);
    this.oorlog = new Uint8Array(n);
    this.vijand = new Int16Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const p = partij(s.landen[i]);
      for (const o of s.oorlogen) {
        const q = o.a === p ? o.b : o.b === p ? o.a : null;
        if (q == null) continue;
        this.oorlog[i] = 1;
        // alleen een vijand met een hoofdstad op de kaart (anders valt er niets aan te vliegen)
        if (this.vijand[i] < 0) for (let j = 0; j < n; j++) { const hj = this.geo.hoofdstad[j]; if (j !== i && partij(s.landen[j]) === q && hj != null && hj >= 0) { this.vijand[i] = j; break; } }
      }
    }
    const gem = (s.wereldY ?? 0) / Math.max(1, n);
    this.welvaart = new Float32Array(n);
    for (let i = 0; i < n; i++) this.welvaart[i] = gem > 0 ? clamp(s.landen[i].Y / gem, 0, 3) : 1;
    // landingszones die nu bebouwd zijn vallen weg
    this.wegSig = null;
  }

  // Waar parachutisten bij een kazerne neerkomen: een open stuk land binnen twee vakjes (droog, geen gebouw, bos,
  // berg of stad, niet aan het water en vrij van boomkruinen).
  landingsZone(t) {
    const geo = this.geo, tg = geo.tegels[t], s = this.state, Tw = geo.T, v = this.basis ? this.terrein.vlaggen : null;
    const h0 = Math.floor(hash(t, 405) * 8);
    // per ring (eerst de acht buurvakjes, dan de ring daaromheen) eerst streng (open grasland zonder bomen in de
    // buurt), dan ruimer (ook een akker, minder marge tot de bomen)
    for (let pas = 0; pas < 4; pas++) for (let k = 0, n = pas < 2 ? 8 : 16; k < n; k++) {
      const a = (k + h0) % n, dk = pas < 2 ? BUUR_K[a] : RING2[a * 2], dr = pas < 2 ? BUUR_R[a] : RING2[a * 2 + 1];
      const kk = tg.k + dk, rr = tg.r + dr, streng = pas % 2 === 0;
      if (kk < 0 || rr < 0 || kk >= geo.kol || rr >= geo.rij) continue;
      const q = geo.tegels[rr * geo.kol + kk];
      // niet in het bos, op een berg of in de stad; streng ook niet op een akker (daar rijden de tractoren van leven.js)
      if (q.terrein === 'water' || q.terrein === 'bos' || q.terrein === 'berg' || s.bezet[q.i] || this.stad[q.i]) continue;
      if (v && streng && v.akker[q.i]) continue;
      for (let o = 0; o < 5; o++) {
        const x = q.x + ZONE_OFF[o * 2] * Tw, y = q.y + ZONE_OFF[o * 2 + 1] * Tw;
        if (v && !this.terrein.boomvrij(x, y, streng ? 1.2 : 0.5)) continue;
        let ok = true;
        for (let d = 0; d < 8 && ok; d++) { const h = d * TAU / 8; if (this.nat(x + Math.cos(h) * 0.3 * Tw, y + Math.sin(h) * 0.3 * Tw)) ok = false; }
        if (ok) return { t: q.i, x, y };
      }
    }
    return null;
  }

  // Bij nieuwe wegen of spoor: welke vliegerplekken en landingszones nog vrij liggen.
  werkVrij(view) {
    const inf = view.infraLaag, kust = view.kustLaag?.vrij ? view.kustLaag : null;
    // kust.js houdt een botsraster bij van pieren, jachthavens, boeien, windparken, havenboten en gebouwen: dat
    // raster is pas gevuld vanaf zijn eigen eerste drempel (zoom 3,6), dus pas daarna meetellen
    const kSig = kust && view.zoom >= 3.6 ? kust.sig : null;
    const sig = inf ? [inf.wegen, inf.routes, kSig] : null;
    if (this.wegSig && sig && this.wegSig[0] === sig[0] && this.wegSig[1] === sig[1] && this.wegSig[2] === sig[2]) return;
    if (this.wegSig && !sig && this.wegSig[2] === kSig) return;
    this.wegSig = sig ?? [null, null, kSig];
    const Tw = this.geo.T;
    const kustVrij = (x, y, r) => !kSig || kust.vrij(x, y, r, 15);
    for (const st of this.stranden) {
      st.kiteVrij = 1;
      if (!st.kite || !kSig) continue;
      const kx = -st.wy, ky = st.wx;
      for (let f = -1; f <= 1 && st.kiteVrij; f += 0.5) if (!kustVrij(st.kite[0] + kx * f * 0.3 * Tw, st.kite[1] + ky * f * 0.3 * Tw, 0.6)) st.kiteVrij = 0;
    }
    const opWeg = (x, y, r) => {
      if (!inf) return false;
      for (const w of inf.wegen ?? []) if (x > w.x0 - r - 1 && x < w.x1 + r + 1 && y > w.y0 - r - 1 && y < w.y1 + r + 1 && segAfstand(x, y, w.ax, w.ay, w.bx, w.by) < 0.1 * Tw + r) return true;
      for (const rt of inf.routes ?? []) for (let i = 0; i + 1 < rt.n; i++) if (segAfstand(x, y, rt.x[i], rt.y[i], rt.x[i + 1], rt.y[i + 1]) < 0.08 * Tw + r) return true;
      return false;
    };
    // een vliegerplek op een brug, vliegveld of ander bouwwerk van infra.js, of vlak bij een weg of spoor, valt weg
    for (const st of this.stranden) for (let i = 0; i < st.vrij.length; i++) { const x = st.pl[i * 2], y = st.pl[i * 2 + 1]; st.vrij[i] = opWeg(x, y, 0.3) || inf?.gereserveerd?.(this.tegelVan(x, y)) || inf?.opBouwwerk?.(x, y) || !kustVrij(x, y, 0.3) ? 0 : 1; }
    for (const k of this.kazernes) if (k.zone) k.zone.weg = opWeg(k.zone.x, k.zone.y, 0.32 * Tw) || !!inf?.gereserveerd?.(k.zone.t);
  }

  // ---------- per beeld ----------

  kader(view, sc) {
    const [wx0, wy0] = view.naarWereld(0, 0);
    const [wx1, wy1] = view.naarWereld(view.w, view.h);
    this.sc = sc;
    this.pix = 1 / sc;
    this.wx0 = wx0; this.wy0 = wy0; this.wx1 = wx1; this.wy1 = wy1;
  }
  inBeeld(wx, wy, m) { return wx > this.wx0 - m && wx < this.wx1 + m && wy > this.wy0 - m && wy < this.wy1 + m; }
  // Eigenaar van een wereldpunt zoals de kaart hem nu toont.
  landOp(x, y) {
    const t = this.tegelVan(x, y), e = this.state.eigenaar?.[t];
    return e != null && e >= 0 ? e : this.geo.tegels[t].eig;
  }
  zetLicht(x, y, r, soort, a) {
    if (this.nLicht >= PLAFOND.lichten || !this.inBeeld(x, y, r)) return;
    const o = this.nLicht++ * LICHT, b = this.licht;
    b[o] = x; b[o + 1] = y; b[o + 2] = r; b[o + 3] = soort; b[o + 4] = a;
  }

  sprite() {
    if (this.sprites) return this.sprites;
    const maak = (w, h, fn) => { const cv = fabriek(w, h); if (cv) fn(cv); return cv; };
    this.sprites = { gloed: LICHTKLEUR.map((k) => maak(32, 32, (cv) => bakGloed(cv, k))), sluier: maak(8, 64, bakSluier) };
    return this.sprites;
  }

  omgeving(view, nu) {
    const dag = this.state.dag ?? 0;
    if (this.szDag !== dag) { this.sz = seizoen(dag); this.wnd = wind(dag); this.szDag = dag; this.pool = weer(dag, 500, 70); }
    // het weer ter plekke verandert per dag en over afstanden van tientallen eenheden: niet elk beeld opnieuw
    const wk = Math.round(view.cx / 8) * 4096 + Math.round(view.cy / 8);
    if (this.wrDag !== dag || this.wrKey !== wk || !this.wr) { this.wr = weer(dag, view.cx, view.cy); this.wrDag = dag; this.wrKey = wk; }
    this.windX = Math.cos(this.wnd.hoek); this.windY = Math.sin(this.wnd.hoek);
    this.nacht = nachtOp(nu);
    this.dagA = 1 - smooth(0.2, 0.55, this.nacht);
    // buiten vliegen: niet bij regen, onweer of storm
    this.droog = this.wr.regen < 0.08 && this.wr.sneeuw < 0.08 && this.wr.onweer < 0.02;
    this.storm = this.wnd.kracht > 0.82;
  }

  // Na de eenheden en de vliegtuigen van infra.js, vóór de nacht: alles wat hier vliegt.
  teken(c, view, sc, nu, dt = 0, tempo = 0) {
    this.nul();
    const s = view.state;
    if (!s || !view.geo || !view.w || !view.eigenaar) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar || this.basis !== (view.terreinLaag?.basis ?? null)) this.laad(view);
    const z = view.zoom;
    this.zoom = z;
    if (z < DREMPEL.streep) return;
    this.werkDag(view);
    this.werkVrij(view);
    this.kader(view, sc);
    this.omgeving(view, nu);
    this.sprite();
    this.t = nu / 1000;
    c.save();
    c.translate(view.w / 2 - view.cx * sc, view.h / 2 - view.cy * sc);
    c.scale(sc, sc);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (z < 7.5) this.tekenStrepen(c);
    if (z >= DREMPEL.zwerm) this.tekenZwermen(c, nu);
    if (z >= DREMPEL.sproeier) this.tekenSproeiers(c);
    if (z >= DREMPEL.banier - 0.5) this.tekenBanier(c);
    if (z >= DREMPEL.vlieger - 0.5) this.tekenStranden(c);
    if (z >= DREMPEL.parachute - 0.5) this.tekenParachutes(c);
    if (z >= DREMPEL.duif - 0.5) this.tekenDuiven(c);
    if (z >= DREMPEL.drone - 0.5) this.tekenBezorging(c);
    if (z >= DREMPEL.paraglider - 0.3) this.tekenParagliders(c);
    if (z >= DREMPEL.zweef - 0.5) this.tekenZweefvliegers(c);
    if (z >= DREMPEL.luchtschip - 0.5) this.tekenLuchtschepen(c);
    if (z >= DREMPEL.jager - 0.5) this.tekenOorlog(c);
    c.restore();
    c.globalAlpha = 1;
    this.n.lichten = this.nLicht;
  }

  // ---------- oude condensstrepen ----------

  // Lange witte strepen van straaljagers die allang voorbij zijn: ze worden breder, vager en waaien met de wind mee.
  tekenStrepen(c) {
    const z = this.zoom, wr = this.wr;
    const a = smooth(DREMPEL.streep, DREMPEL.streep + 0.8, z) * (1 - smooth(6, 7.5, z)) * this.dagA * (1 - smooth(0.55, 0.85, wr.wolken)) * (wr.regen < 0.2 ? 1 : 0.3);
    if (a < 0.02) return;
    const t = this.t, wx = this.windX, wy = this.windY, pix = this.pix;
    let n = 0;
    for (let k = 0; k < PLAFOND.strepen; k++) {
      const P = 160 + 37 * k, ruw = t / P + hash(k, 411), u = frac(ruw), cyc = Math.floor(ruw), leeftijd = u * P;
      const qx = 120 + 760 * hash(k, cyc, 412), qy = 70 + 480 * hash(k, cyc, 413), h = hash(k, cyc, 414) * Math.PI;
      const hx = Math.cos(h), hy = Math.sin(h);
      const drift = leeftijd * 0.07, dx = wx * drift, dy = wy * drift;
      // het stuk van de streep in beeld (een lange lijn door de hele wereld)
      const mx = (this.wx0 + this.wx1) / 2, my = (this.wy0 + this.wy1) / 2, half = Math.hypot(this.wx1 - this.wx0, this.wy1 - this.wy0) * 0.6 + 10;
      const sm = (mx - qx - dx) * hx + (my - qy - dy) * hy;
      const d = Math.abs((mx - qx - dx) * -hy + (my - qy - dy) * hx);
      if (d > half) continue;
      const s0 = sm - half, s1 = sm + half;
      const sterk = a * smooth(0, 0.04, u) * Math.pow(1 - u, 1.3);
      if (sterk < 0.02) continue;
      const br = 0.35 + leeftijd * 0.022;
      n++;
      // schaduw: hoog boven de grond, dus ver naar het zuidoosten en heel zacht
      const so = 14;
      for (let laag = 0; laag < 4; laag++) {
        const schaduw = laag === 0;
        c.globalAlpha = schaduw ? sterk * 0.07 : laag === 1 ? sterk * 0.16 : laag === 2 ? sterk * 0.32 : sterk * 0.5 * (1 - smooth(0.2, 0.6, u));
        c.strokeStyle = schaduw ? '#000' : '#f6f8fb';
        c.lineWidth = Math.max(pix, schaduw ? br * 1.4 : laag === 1 ? br * 2.4 : laag === 2 ? br * 1.2 : br * 0.35);
        const ox = schaduw ? so * SX : 0, oy = schaduw ? so * SY : 0;
        c.beginPath();
        for (let i = 0; i <= 6; i++) {
          const sv = s0 + ((s1 - s0) * i) / 6;
          // de streep krult een beetje: verderop in de lucht waait hij net anders
          const kr = Math.sin(sv * 0.018 + k * 1.7 + cyc) * leeftijd * 0.012;
          const x = qx + dx + hx * sv - hy * kr + ox, y = qy + dy + hy * sv + hx * kr + oy;
          if (i) c.lineTo(x, y); else c.moveTo(x, y);
        }
        c.stroke();
      }
    }
    this.n.strepen = n;
    c.globalAlpha = 1;
  }

  // ---------- spreeuwen ----------

  // In de herfst en de vroege winter, in de avondschemering: één wolk spreeuwen die golft en van vorm verandert.
  tekenZwermen(c, nu) {
    const sz = this.sz, fase = faseOp(nu);
    const tijdVanJaar = sz.herfst > 0.3 || (sz.dagInJaar >= 300 || sz.dagInJaar <= 20);
    if (!tijdVanJaar || !this.droog) return;
    // avond: net voordat het donker wordt (de nacht begint bij fase 0,25)
    const avond = smooth(0.17, 0.21, fase) * (1 - smooth(0.31, 0.35, fase));
    const a = avond * smooth(DREMPEL.zwerm, DREMPEL.zwerm + 0.8, this.zoom);
    if (a < 0.02) return;
    const t = this.t, pix = this.pix, z = this.zoom, dag = this.state.dag ?? 0;
    let nz = 0, nb = 0;
    for (let p = 0; p < this.zwermPlekken.length && nz < PLAFOND.zwermen; p++) {
      const pl = this.zwermPlekken[p];
      if (hash(pl.t, dag, 421) > 0.7) continue;
      const zd = hash(pl.t, 422) * 50;
      const cx = pl.x + Math.sin(t * 0.05 + zd) * 3 + Math.sin(t * 0.13 + zd * 2) * 1.2, cy = pl.y + Math.cos(t * 0.043 + zd) * 2.2;
      if (!this.inBeeld(cx, cy, 12)) continue;
      nz++;
      const leden = Math.min(PLAFOND.spreeuwen - nb, 120 + Math.floor(hash(pl.t, 423) * 60));
      // de vorm: een uitgerekte wolk die draait, ademt en waar golven doorheen lopen
      const lang = 3.4 + 1.5 * Math.sin(t * 0.21 + zd), breed = 1.3 + 0.8 * Math.sin(t * 0.17 + zd * 1.3);
      const hoek = t * 0.07 + zd + 0.7 * Math.sin(t * 0.11 + zd), co = Math.cos(hoek), si = Math.sin(hoek);
      const knik = 0.55 * Math.sin(t * 0.29 + zd * 0.7);
      const hoog = 4;
      const s = Math.max(pix * 1.1, 0.05), U = this.zwermU, V = this.zwermV;
      // schaduw: zachte stipjes, een op de drie
      c.globalAlpha = a * 0.09;
      c.fillStyle = '#000';
      c.beginPath();
      for (let k = 0; k < leden; k += 3) {
        const u = U[k] + 0.22 * Math.sin(V[k] * 2.3 + t * 1.3), v = V[k] + knik * Math.sin(U[k] * 1.7 + t * 0.9) + 0.06 * Math.sin(t * 3 + k);
        c.rect(cx + (u * lang * co - v * breed * si) + hoog * SX, cy + (u * lang * si + v * breed * co) + hoog * SY, s * 1.8, s * 1.8);
      }
      c.fill();
      c.globalAlpha = a * 0.88;
      c.fillStyle = '#211d1b';
      c.beginPath();
      for (let k = 0; k < leden; k++) {
        const u = U[k] + 0.22 * Math.sin(V[k] * 2.3 + t * 1.3), v = V[k] + knik * Math.sin(U[k] * 1.7 + t * 0.9) + 0.06 * Math.sin(t * 3 + k);
        // dichtbij zie je de vleugels flitsen: smal of breed
        const slag = z >= 10 ? 0.45 + 0.55 * Math.abs(Math.sin(t * 14 + k * 1.37)) : 1;
        c.rect(cx + (u * lang * co - v * breed * si), cy + (u * lang * si + v * breed * co), s * (0.6 + slag), s * 0.8);
      }
      c.fill();
      nb += leden;
    }
    this.n.zwermen = nz;
    this.n.spreeuwen = nb;
    c.globalAlpha = 1;
  }

  // ---------- sproeivliegtuig ----------

  // Een geel vliegtuigje dat in banen laag over een akker scheert en een nevel achter zich laat.
  tekenSproeiers(c) {
    const sz = this.sz;
    if (!this.droog || this.wnd.kracht > 0.65 || sz.lente + sz.zomer < 0.45 || this.dagA < 0.05 || !this.basis) return;
    const geo = this.geo, Tw = geo.T, t = this.t, dag = this.state.dag ?? 0, z = this.zoom;
    const a = smooth(DREMPEL.sproeier, DREMPEL.sproeier + 0.6, z) * this.dagA;
    const k0 = Math.max(0, Math.floor(this.wx0 / Tw)), k1 = Math.min(geo.kol - 1, Math.floor(this.wx1 / Tw));
    const r0 = Math.max(0, Math.floor(this.wy0 / Tw)), r1 = Math.min(geo.rij - 1, Math.floor(this.wy1 / Tw));
    let n = 0;
    for (let r = r0; r <= r1 && n < PLAFOND.sproeiers; r++) for (let k = k0; k <= k1 && n < PLAFOND.sproeiers; k++) {
      const ti = r * geo.kol + k;
      if (!this.akkerVan[ti] || hash(ti, dag, 431) > 0.06 || this.state.bezet[ti]) continue;
      const tg = geo.tegels[ti];
      const hk = Math.floor(hash(ti, 432) * 2) * Math.PI / 2, hx = Math.cos(hk), hy = Math.sin(hk);
      const P = 9, ruw = t / P + hash(ti, 433), baan = Math.floor(ruw) % 4, u = frac(ruw);
      const rich = baan & 1 ? -1 : 1, langs = (u * 2 - 1) * 0.85 * Tw * rich, dwars = (baan - 1.5) * 0.18 * Tw;
      const x = tg.x + hx * langs - hy * dwars, y = tg.y + hy * langs + hx * dwars;
      if (!this.inBeeld(x, y, 3)) continue;
      n++;
      const fx = hx * rich, fy = hy * rich, L = 0.55, hoog = 0.5;
      // nevel achter het toestel, alleen boven de akker zelf
      const boven = Math.abs(langs) < 0.5 * Tw;
      if (boven) {
        c.globalAlpha = a * 0.22;
        c.strokeStyle = '#e6eedc';
        c.lineWidth = 0.45;
        c.beginPath(); c.moveTo(x - fx * 0.2, y - fy * 0.2); c.lineTo(x - fx * 2.4, y - fy * 2.4); c.stroke();
        c.globalAlpha = a * 0.12;
        c.lineWidth = 0.8;
        c.beginPath(); c.moveTo(x - fx * 1.4, y - fy * 1.4); c.lineTo(x - fx * 4, y - fy * 4); c.stroke();
      }
      c.globalAlpha = a * 0.2;
      c.fillStyle = '#000';
      c.beginPath(); vorm(c, x + hoog * SX, y + hoog * SY, fx, fy, L, KLEIN_VORM); c.fill();
      c.globalAlpha = a;
      c.fillStyle = '#e8b62a';
      c.beginPath(); vorm(c, x, y, fx, fy, L, KLEIN_VORM); c.fill();
      if (z >= DREMPEL.lijnen) {
        // de zuidoostkant van de vleugel in de schaduw en een kuipje
        c.fillStyle = 'rgba(0,0,0,0.16)';
        c.beginPath(); blok(c, x, y, fx, fy, -0.01 * L, 0.06 * L, 0.1 * L, 0.5 * L); c.fill();
        c.fillStyle = '#2f4152';
        c.beginPath(); stip(c, x + fx * 0.22 * L, y + fy * 0.22 * L, 0.05 * L); c.fill();
      }
      if (z >= DREMPEL.klein) {
        // propeller: een vage schijf voor de neus
        c.fillStyle = 'rgba(40,40,40,0.25)';
        c.beginPath(); blok(c, x, y, fx, fy, 0.5 * L, -0.16 * L, 0.53 * L, 0.16 * L); c.fill();
      }
    }
    this.n.sproeiers = n;
    c.globalAlpha = 1;
  }

  // ---------- stranden: vliegers en kitesurfers ----------

  tekenStranden(c) {
    const sz = this.sz, kr = this.wnd.kracht;
    if (!this.droog || this.storm || kr < 0.42 || sz.winter > 0.45 || this.dagA < 0.05) return;
    const geo = this.geo, Tw = geo.T, t = this.t, dag = this.state.dag ?? 0, z = this.zoom, pix = this.pix, bezet = this.state.bezet;
    const wx = this.windX, wy = this.windY;
    const aV = smooth(DREMPEL.vlieger - 0.5, DREMPEL.vlieger + 0.3, z) * this.dagA;
    const aK = smooth(DREMPEL.kiter - 0.5, DREMPEL.kiter + 0.3, z) * this.dagA;
    const k0 = Math.max(0, Math.floor(this.wx0 / Tw) - 1), k1 = Math.min(geo.kol - 1, Math.floor(this.wx1 / Tw) + 1);
    const r0 = Math.max(0, Math.floor(this.wy0 / Tw) - 1), r1 = Math.min(geo.rij - 1, Math.floor(this.wy1 / Tw) + 1);
    let nv = 0, nk = 0;
    for (let r = r0; r <= r1; r++) for (let k = k0; k <= k1; k++) {
      const ti = r * geo.kol + k, si = this.strandVan[ti];
      if (si < 0) continue;
      const st = this.stranden[si];
      if (hash(ti, dag, 441) > 0.55 || bezet[ti]) continue;
      // vliegers: iemand op het zand, de vlieger hoog met de wind mee
      for (let i = 0; i < st.vrij.length && nv < PLAFOND.vliegers; i++) {
        if (!st.vrij[i] || hash(ti, i, 442) > 0.75) continue;
        const px = st.pl[i * 2], py = st.pl[i * 2 + 1];
        if (!this.inBeeld(px, py, 5)) continue;
        nv++;
        this.vlieger(c, px, py, ti * 7 + i, aV, kr, t, z, pix);
      }
      // kitesurfer: heen en weer langs de kust, de kite schuin voor hem uit met de wind mee
      if (st.kite && st.kiteVrij !== 0 && nk < PLAFOND.kiters && z >= DREMPEL.kiter - 0.5 && hash(ti, dag, 443) < 0.6 && !this.havenBij(st.t)) {
        const P = 26 + 8 * hash(ti, 444), u = t / P + hash(ti, 445), heen = frac(u) < 0.5;
        const zij = (tri(u) - 0.5) * 2 * 0.3 * Tw;
        const kx0 = -st.wy, ky0 = st.wx;
        const bx = st.kite[0] + kx0 * zij, by = st.kite[1] + ky0 * zij;
        if (!this.inBeeld(bx, by, 4)) continue;
        nk++;
        this.kiter(c, bx, by, heen ? kx0 : -kx0, heen ? ky0 : -ky0, wx, wy, aK, ti, t, z, pix);
      }
    }
    this.n.vliegers = nv;
    this.n.kiters = nk;
    c.globalAlpha = 1;
  }

  // Op zomerdagen: een vliegtuigje dat langs de kust een effen banier achter zich aan sleept (zonder tekst).
  tekenBanier(c) {
    const sz = this.sz;
    if (sz.zomer < 0.4 || !this.droog || this.storm || this.dagA < 0.3 || !this.stranden.length) return;
    const geo = this.geo, Tw = geo.T, t = this.t, z = this.zoom, pix = this.pix, dag = this.state.dag ?? 0;
    const a = smooth(DREMPEL.banier - 0.5, DREMPEL.banier + 0.4, z) * smooth(0.3, 0.6, this.dagA);
    for (let i = 0; i < this.stranden.length && this.n.banieren < PLAFOND.banieren; i++) {
      const st = this.stranden[i];
      if (hash(st.t, dag, 601) > 0.1) continue;
      // langs de kust heen en terug, iets boven zee
      const P = 44, u = t / P + hash(st.t, 602), heen = frac(u) < 0.5, langs = (tri(u) - 0.5) * 80;
      const kx = -st.wy, ky = st.wx, fx = heen ? kx : -kx, fy = heen ? ky : -ky;
      const x = st.x + st.wx * 0.5 * Tw + kx * langs, y = st.y + st.wy * 0.5 * Tw + ky * langs;
      if (!this.inBeeld(x, y, 10)) continue;
      this.n.banieren++;
      const L = 0.7, hoog = 3, kleur = VLIEGER[Math.floor(hash(st.t, 603) * 5)];
      // de banier: een lange strook die golft in de luchtstroom, met een rand in een tweede kleur
      const b0 = 1.6, bl = 3.2, bh = 0.32;
      for (let laag = 0; laag < 2; laag++) {
        const ox = laag ? 0 : hoog * SX, oy = laag ? 0 : hoog * SY;
        c.globalAlpha = laag ? a : a * 0.14;
        c.fillStyle = laag ? kleur : '#000';
        c.beginPath();
        for (let k = 0; k <= 6; k++) { const d = b0 + (bl * k) / 6, gl = Math.sin(t * 7 - k * 1.1) * 0.05 * (k / 6); c[k ? 'lineTo' : 'moveTo'](x - fx * d - fy * (bh + gl) + ox, y - fy * d + fx * (bh + gl) + oy); }
        for (let k = 6; k >= 0; k--) { const d = b0 + (bl * k) / 6, gl = Math.sin(t * 7 - k * 1.1) * 0.05 * (k / 6); c.lineTo(x - fx * d - fy * (-bh + gl) + ox, y - fy * d + fx * (-bh + gl) + oy); }
        c.closePath();
        c.fill();
      }
      if (z >= DREMPEL.lijnen - 2) {
        c.fillStyle = '#f4f2ea';
        c.beginPath(); blok(c, x, y, fx, fy, -b0 - bl, -bh, -b0 - bl * 0.94, bh); c.fill();
        c.strokeStyle = 'rgba(40,40,40,0.45)'; c.lineWidth = Math.max(pix * 0.4, 0.01);
        c.beginPath(); c.moveTo(x - fx * 0.4, y - fy * 0.4); c.lineTo(x - fx * b0, y - fy * b0); c.stroke();
      }
      c.globalAlpha = a * 0.16;
      c.fillStyle = '#000';
      c.beginPath(); vorm(c, x + hoog * SX, y + hoog * SY, fx, fy, L, KLEIN_VORM); c.fill();
      c.globalAlpha = a;
      c.fillStyle = '#eef0ec';
      c.beginPath(); vorm(c, x, y, fx, fy, L, KLEIN_VORM); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.14)';
      c.beginPath(); blok(c, x, y, fx, fy, -0.02 * L, 0.06 * L, 0.1 * L, 0.5 * L); c.fill();
      c.fillStyle = kleur;
      c.beginPath(); blok(c, x, y, fx, fy, -0.48 * L, -0.16 * L, -0.38 * L, 0.16 * L); c.fill();
    }
    c.globalAlpha = 1;
  }

  havenBij(t) {
    // een haven is elk gebouw met handelsbonus (uit de pack, niet op naam)
    const geo = this.geo, tg = geo.tegels[t], hv = this.havens;
    if (!hv) return false;
    for (let dr = -2; dr <= 2; dr++) for (let dk = -2; dk <= 2; dk++) {
      const k = tg.k + dk, r = tg.r + dr;
      if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
      if (hv[r * geo.kol + k]) return true;
    }
    return false;
  }

  vlieger(c, px, py, zaad, a, kr, t, z, pix) {
    const wx = this.windX, wy = this.windY;
    const af = 1.5 + 0.9 * kr + 0.3 * hash(zaad, 446), zw = Math.sin(t * 0.8 + zaad) * 0.25 + Math.sin(t * 2.1 + zaad) * 0.06;
    const kx = px + wx * af - wy * zw, ky = py + wy * af + wx * zw, hoog = 1.6 + kr;
    const soort = Math.floor(hash(zaad, 447) * 3), kleur = VLIEGER[Math.floor(hash(zaad, 448) * VLIEGER.length)], s = 0.28;
    // touw
    c.globalAlpha = a * 0.55;
    c.strokeStyle = '#f4f2ea';
    c.lineWidth = Math.max(pix * 0.6, 0.012);
    c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + wx * af * 0.5, py + wy * af * 0.5 + 0.12, kx, ky); c.stroke();
    // schaduw van de vlieger op het zand
    c.globalAlpha = a * 0.18;
    c.fillStyle = '#000';
    c.beginPath(); this.vliegerVorm(c, kx + hoog * SX, ky + hoog * SY, wx, wy, s, soort); c.fill();
    c.globalAlpha = a;
    c.fillStyle = kleur;
    c.beginPath(); this.vliegerVorm(c, kx, ky, wx, wy, s, soort); c.fill();
    if (z >= DREMPEL.lijnen) {
      // de lijzijde in de schaduw, en een middenstok
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.beginPath(); blok(c, kx, ky, wx, wy, -s, 0, s * 0.6, s * 0.55); c.fill();
    }
    // staart met strikjes die kronkelt, tegen de wind in
    if (soort !== 2) {
      c.strokeStyle = soort ? '#f2f2ef' : kleur === '#e8e4da' ? '#d9443a' : '#e8e4da';
      c.lineWidth = Math.max(pix * 0.7, 0.025);
      c.beginPath();
      let x = kx - wx * s, y = ky - wy * s;
      c.moveTo(x, y);
      for (let j = 1; j <= 6; j++) {
        const kw = Math.sin(t * 6 + j * 1.2 + zaad) * 0.09 * Math.min(1, j / 2);
        x = kx - wx * (s + j * 0.17) - wy * kw; y = ky - wy * (s + j * 0.17) + wx * kw;
        c.lineTo(x, y);
      }
      c.stroke();
    }
    if (z >= DREMPEL.piloot) {
      // wie de vlieger vasthoudt: schouders en een hoofd
      c.fillStyle = 'rgba(0,0,0,0.2)';
      c.beginPath(); stip(c, px + 0.1, py + 0.13, 0.16); c.fill();
      c.fillStyle = VLIEGER[(Math.floor(hash(zaad, 449) * VLIEGER.length) + 2) % VLIEGER.length];
      c.beginPath(); stip(c, px, py, 0.16); c.fill();
      c.fillStyle = '#d9a982';
      c.beginPath(); stip(c, px - 0.015, py - 0.015, 0.085); c.fill();
    }
  }

  // Ruit, delta of matras, met de punt in de wind.
  vliegerVorm(c, x, y, hx, hy, s, soort) {
    if (soort === 0) { c.moveTo(x + hx * s, y + hy * s); c.lineTo(x - hy * s * 0.6, y + hx * s * 0.6); c.lineTo(x - hx * s * 0.9, y - hy * s * 0.9); c.lineTo(x + hy * s * 0.6, y - hx * s * 0.6); c.closePath(); }
    else if (soort === 1) { c.moveTo(x + hx * s, y + hy * s); c.lineTo(x - hx * s * 0.5 - hy * s * 1.1, y - hy * s * 0.5 + hx * s * 1.1); c.lineTo(x - hx * s * 0.25, y - hy * s * 0.25); c.lineTo(x - hx * s * 0.5 + hy * s * 1.1, y - hy * s * 0.5 - hx * s * 1.1); c.closePath(); }
    else schermVorm(c, x, y, hx, hy, s * 1.1, s * 0.45, s * 0.35);
  }

  kiter(c, bx, by, fx, fy, wx, wy, a, zaad, t, z, pix) {
    const kx = bx + wx * 2.2 + fx * 0.9, ky = by + wy * 2.2 + fy * 0.9, hoog = 2;
    const kleur = SCHERM[Math.floor(hash(zaad, 451) * SCHERM.length)];
    // kielzog: een witte streep achter de plank
    c.globalAlpha = a * 0.5;
    c.strokeStyle = '#f2f6f8';
    c.lineWidth = Math.max(pix, 0.1);
    c.beginPath(); c.moveTo(bx - fx * 0.25, by - fy * 0.25); c.lineTo(bx - fx * 1.6 + Math.sin(t * 2 + zaad) * 0.06, by - fy * 1.6); c.stroke();
    if (z >= DREMPEL.klein) {
      c.globalAlpha = a * 0.35;
      c.lineWidth = Math.max(pix * 0.6, 0.035);
      c.beginPath();
      for (let q = 0; q < 2; q++) { const k = PAAR[q]; c.moveTo(bx - fx * 0.2, by - fy * 0.2); c.lineTo(bx - fx * 0.9 - fy * k * 0.25, by - fy * 0.9 + fx * k * 0.25); }
      c.stroke();
    }
    // lijnen naar de kite
    c.globalAlpha = a * 0.5;
    c.strokeStyle = '#2a2a2a';
    c.lineWidth = Math.max(pix * 0.5, 0.01);
    c.beginPath(); c.moveTo(bx, by); c.lineTo(kx - wy * 0.5, ky + wx * 0.5); c.moveTo(bx, by); c.lineTo(kx + wy * 0.5, ky - wx * 0.5); c.stroke();
    // plank en surfer
    c.globalAlpha = a;
    c.fillStyle = '#f0f0ea';
    c.beginPath(); blok(c, bx, by, fx, fy, -0.3, -0.085, 0.3, 0.085); c.fill();
    c.fillStyle = '#20262c';
    c.beginPath(); stip(c, bx, by, 0.12); c.fill();
    // de kite: een boog, schaduw op het water
    const hx = wx, hy = wy;
    c.globalAlpha = a * 0.15;
    c.fillStyle = '#000';
    c.beginPath(); schermVorm(c, kx + hoog * SX, ky + hoog * SY, hx, hy, 0.55, 0.16, 0.2); c.fill();
    c.globalAlpha = a;
    c.fillStyle = kleur;
    c.beginPath(); schermVorm(c, kx, ky, hx, hy, 0.55, 0.16, 0.2); c.fill();
    if (z >= DREMPEL.lijnen) {
      c.strokeStyle = 'rgba(255,255,255,0.6)';
      c.lineWidth = Math.max(pix * 0.5, 0.025);
      c.beginPath(); for (let q = 0; q < 3; q++) { const v = DRIE[q], u = 0.2 * (1 - v * v); c.moveTo(kx + u * hx - v * 0.55 * hy, ky + u * hy + v * 0.55 * hx); c.lineTo(kx + (u - 0.16) * hx - v * 0.55 * hy, ky + (u - 0.16) * hy + v * 0.55 * hx); } c.stroke();
    }
  }

  // ---------- parachutisten bij kazernes ----------

  // Een transportvliegtuig gaat over, een stick springt eruit, de koepels klappen open en zakken naar de landingsplek.
  tekenParachutes(c) {
    if (!this.droog || this.storm || this.dagA < 0.05 || !this.kazernes.length) return;
    const t = this.t, z = this.zoom, pix = this.pix, dag = this.state.dag ?? 0, bezet = this.state.bezet;
    const a = smooth(DREMPEL.parachute - 0.5, DREMPEL.parachute + 0.4, z) * this.dagA;
    const wx = this.windX, wy = this.windY;
    let nz = 0, np = 0, nd = 0;
    for (let i = 0; i < this.kazernes.length && nz < PLAFOND.landingen; i++) {
      const kz = this.kazernes[i], zn = kz.zone;
      if (!zn || zn.weg || bezet[zn.t] || hash(kz.t, dag, 461) > 0.65) continue;
      if (!this.inBeeld(zn.x, zn.y, 10)) continue;
      nz++;
      // landingsplek: een ronde grasvlakte met een oranje ring (alleen dicht genoeg bij)
      c.globalAlpha = a * 0.8;
      c.strokeStyle = '#e8762b';
      c.lineWidth = 0.12;
      c.beginPath(); c.arc(zn.x, zn.y, 1.1, 0, TAU); c.stroke();
      c.fillStyle = 'rgba(232,118,43,0.85)';
      c.beginPath(); stip(c, zn.x, zn.y, 0.2); c.fill();
      if (z >= DREMPEL.lijnen) {
        c.fillStyle = 'rgba(0,0,0,0.12)';
        c.beginPath(); stip(c, zn.x + 0.05, zn.y + 0.06, 0.2); c.fill();
      }
      const P = 48, ruw = t / P + hash(kz.t, 462), u = frac(ruw);
      // het vliegtuig vliegt met de wind mee over de plek (ietsje ervoor, de springers drijven af naar de ring)
      const hx = wx, hy = wy, dx = zn.x - wx * 3.2, dy = zn.y - wy * 3.2;
      if (u < 0.32 && nd < PLAFOND.dropvliegtuigen) {
        nd++;
        const langs = (u / 0.32 - 0.5) * 70, x = dx + hx * langs, y = dy + hy * langs, hoog = 7, L = 1.3;
        c.globalAlpha = a * 0.16;
        c.fillStyle = '#000';
        c.beginPath(); vorm(c, x + hoog * SX, y + hoog * SY, hx, hy, L, KLEIN_VORM); c.fill();
        c.globalAlpha = a;
        c.fillStyle = LEGER;
        c.beginPath(); vorm(c, x, y, hx, hy, L, KLEIN_VORM); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.18)';
        c.beginPath(); blok(c, x, y, hx, hy, -0.02 * L, 0.06 * L, 0.1 * L, 0.5 * L); c.fill();
        if (z >= DREMPEL.lijnen) { c.fillStyle = '#3a3f36'; c.beginPath(); for (let q = 0; q < 2; q++) { const v = PAAR[q] * 0.26; stip(c, x + hx * 0.16 * L - hy * v * L, y + hy * 0.16 * L + hx * v * L, 0.05 * L); } c.fill(); }
        this.zetLicht(x + hy * 0.5 * L, y - hx * 0.5 * L, 0.2, ROOD, 0.6); this.zetLicht(x - hy * 0.5 * L, y + hx * 0.5 * L, 0.2, GROEN, 0.6);
      }
      // de springers: tussen 0,16 en 0,2 springen ze één voor één, vrije val, de koepel klapt open, ze zakken af
      const leden = 5;
      for (let j = 0; j < leden && np < PLAFOND.parachutes; j++) {
        const sp = 0.16 + j * 0.008, w = (u - sp) / 0.5;
        if (w < 0 || w > 1.08) continue;
        np++;
        const langs = (sp / 0.32 - 0.5) * 70;
        const ex = dx + hx * langs, ey = dy + hy * langs;
        const doelX = zn.x + (hash(kz.t, j, 463) - 0.5) * 1.4, doelY = zn.y + (hash(kz.t, j, 464) - 0.5) * 1.4;
        const f = smooth(0, 1, Math.min(1, w)), x = ex + (doelX - ex) * f + Math.sin(t * 0.7 + j) * 0.15 * (1 - f), y = ey + (doelY - ey) * f;
        const hoog = 7 * (1 - Math.min(1, w)), open = smooth(0.04, 0.09, w);
        const R = 0.48 * open;
        // schaduw van de koepel (of van de springer)
        c.globalAlpha = a * 0.18;
        c.fillStyle = '#000';
        c.beginPath(); stip(c, x + hoog * SX, y + hoog * SY, Math.max(0.1, R * 0.9)); c.fill();
        if (w > 1) {
          // geland: het doek ligt plat naast de springer
          c.globalAlpha = a * (1 - smooth(1.02, 1.08, w));
          c.fillStyle = j % 2 ? '#6f7a52' : '#8a7f5a';
          c.beginPath(); c.ellipse(x + wx * 0.5, y + wy * 0.5, 0.42, 0.16, Math.atan2(wy, wx), 0, TAU); c.fill();
          c.fillStyle = LEGER;
          c.beginPath(); stip(c, x, y, 0.12); c.fill();
          continue;
        }
        c.globalAlpha = a;
        if (open < 0.05) {
          c.fillStyle = '#2b2f26';
          c.beginPath(); stip(c, x, y, 0.1); c.fill();
          continue;
        }
        // de koepel van bovenaf: rond, licht aan de noordwestkant, met banen als de lijnen er zijn
        c.fillStyle = j % 2 ? '#6f7a52' : '#8a7f5a';
        c.beginPath(); stip(c, x, y, R); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.16)';
        c.beginPath(); stip(c, x - R * 0.25, y - R * 0.25, R * 0.55); c.fill();
        if (z >= DREMPEL.lijnen) {
          c.strokeStyle = 'rgba(0,0,0,0.25)';
          c.lineWidth = Math.max(pix * 0.5, 0.012);
          c.beginPath();
          for (let q = 0; q < 4; q++) { const h = q * Math.PI / 4; c.moveTo(x - Math.cos(h) * R, y - Math.sin(h) * R); c.lineTo(x + Math.cos(h) * R, y + Math.sin(h) * R); }
          c.stroke();
          c.fillStyle = '#3a3f36';
          c.beginPath(); stip(c, x, y, Math.max(R * 0.2, 0.09)); c.fill();
        }
      }
    }
    this.n.landingen = nz;
    this.n.parachutes = np;
    this.n.dropvliegtuigen = nd;
    c.globalAlpha = 1;
  }

  // ---------- postduiven ----------

  // Een koppel duiven dat rondjes draait boven een woonwijk, af en toe in een acht.
  tekenDuiven(c) {
    if (!this.droog || this.storm || this.dagA < 0.05 || !this.wijken.length) return;
    const geo = this.geo, Tw = geo.T, t = this.t, z = this.zoom, pix = this.pix, dag = this.state.dag ?? 0;
    const a = smooth(DREMPEL.duif - 0.5, DREMPEL.duif + 0.4, z) * this.dagA;
    let n = 0;
    for (let i = 0; i < this.wijken.length && n < PLAFOND.duiven; i++) {
      const ti = this.wijken[i];
      if (hash(ti, dag, 471) > 0.5) continue;
      const tg = geo.tegels[ti];
      const mx = tg.x + (hash(ti, 472) - 0.5) * 0.5 * Tw, my = tg.y + (hash(ti, 473) - 0.5) * 0.5 * Tw;
      if (!this.inBeeld(mx, my, 6)) continue;
      const leden = Math.min(PLAFOND.duiven - n, 10 + Math.floor(hash(ti, 474) * 6));
      const R = 2.2 + hash(ti, 475) * 0.8, w = 0.55 * (hash(ti, 476) < 0.5 ? 1 : -1), hoog = 1.5;
      const s = Math.max(pix * 1.4, 0.07);
      for (let laag = 0; laag < 2; laag++) {
        c.globalAlpha = laag ? a * 0.9 : a * 0.12;
        c.strokeStyle = laag ? DUIF : '#000';
        c.lineWidth = Math.max(pix * 0.9, s * 0.38);
        c.beginPath();
        for (let j = 0; j < leden; j++) {
          // een losse groep: elk een eigen plekje in de koppel en een eigen vleugelslag
          const g = t * w + j * 0.16 + Math.sin(t * 0.9 + j) * 0.05;
          const acht = Math.sin(t * 0.13 + ti) > 0.6 ? Math.sin(g) : 0;
          const x = mx + Math.cos(g) * R + (hash(j, 477) - 0.5) * 0.5, y = my + Math.sin(g) * R * (0.8 + 0.4 * acht) + (hash(j, 478) - 0.5) * 0.5;
          const hx = -Math.sin(g) * Math.sign(w), hy = Math.cos(g) * Math.sign(w);
          const sl = 0.5 + 0.5 * Math.sin(t * 16 + j * 2.1);
          if (laag) vleugelV(c, x, y, hx, hy, s, sl); else vleugelV(c, x + hoog * SX, y + hoog * SY, hx, hy, s, sl);
        }
        c.stroke();
      }
      if (z >= DREMPEL.klein) {
        // witte vleugelbanden
        c.globalAlpha = a * 0.7;
        c.fillStyle = '#e8ecef';
        c.beginPath();
        for (let j = 0; j < leden; j++) { const g = t * w + j * 0.16 + Math.sin(t * 0.9 + j) * 0.05, acht = Math.sin(t * 0.13 + ti) > 0.6 ? Math.sin(g) : 0; c.rect(mx + Math.cos(g) * R + (hash(j, 477) - 0.5) * 0.5 - s * 0.12, my + Math.sin(g) * R * (0.8 + 0.4 * acht) + (hash(j, 478) - 0.5) * 0.5 - s * 0.12, s * 0.24, s * 0.24); }
        c.fill();
      }
      n += leden;
    }
    this.n.duiven = n;
    c.globalAlpha = 1;
  }

  // ---------- bezorgdrones ----------

  // In welvarende hoofdsteden in vrede: drones die pakjes van een dak naar de huizen brengen en leeg terugvliegen.
  tekenBezorging(c) {
    if (this.storm || this.wr.onweer > 0.05) return;
    const s = this.state, geo = this.geo, Tw = geo.T, t = this.t, z = this.zoom, pix = this.pix;
    const a = smooth(DREMPEL.drone - 0.5, DREMPEL.drone + 0.4, z);
    let n = 0;
    for (let i = 0; i < s.landen.length && n < PLAFOND.bezorgdrones; i++) {
      if (this.oorlog[i] || this.welvaart[i] < 0.6) continue;
      const h = geo.hoofdstad[i];
      if (h == null || h < 0) continue;
      const tg = geo.tegels[h];
      if (!this.inBeeld(tg.x, tg.y, 1.6 * Tw)) continue;
      const hubX = tg.x + 0.32 * Tw, hubY = tg.y - 0.3 * Tw;
      const aantal = Math.min(PLAFOND.bezorgdrones - n, 2 + Math.floor(clamp(this.welvaart[i], 0.6, 2) * 3));
      for (let j = 0; j < aantal; j++) {
        const P = 16 + 6 * hash(i, j, 481), ruw = t / P + hash(i, j, 482), u = frac(ruw), cyc = Math.floor(ruw);
        // het adres ligt in de stad op het droge (niet in zee, een rivier of tussen de akkers); drie pogingen
        let hoek = 0, dX = 0, dY = 0, adres = false;
        for (let p = 0; p < 3 && !adres; p++) {
          hoek = hash(i, j * 31 + cyc, 483 + p * 7) * TAU;
          const af = (0.5 + hash(i, j * 31 + cyc, 484 + p * 7) * 0.9) * Tw;
          dX = tg.x + Math.cos(hoek) * af; dY = tg.y + Math.sin(hoek) * af;
          const ta = this.tegelVan(dX, dY), b = s.bezet[ta];
          adres = (ta === h || (!!b && b.land === i)) && !this.nat(dX, dY);
        }
        if (!adres) continue;
        // heen (0-0,4), zakken en afleveren (0,4-0,55), leeg terug (0,55-0,95), wachten op het dak
        let f, hoog, pakje;
        if (u < 0.4) { f = smooth(0, 0.4, u); hoog = 1.1; pakje = 1; }
        else if (u < 0.55) { f = 1; hoog = 1.1 - 0.75 * tri((u - 0.4) / 0.15); pakje = u < 0.475 ? 1 : 0; }
        else if (u < 0.95) { f = 1 - smooth(0.55, 0.95, u); hoog = 1.1; pakje = 0; }
        else { f = 0; hoog = 0.35; pakje = 0; }
        const x = hubX + (dX - hubX) * f, y = hubY + (dY - hubY) * f;
        if (!this.inBeeld(x, y, 2)) continue;
        n++;
        const ri = u < 0.4 ? hoek : hoek + Math.PI, hx = Math.cos(ri), hy = Math.sin(ri);
        this.drone(c, x, y, hx, hy, hoog, pakje, a, t + j, z, pix);
      }
    }
    this.n.bezorgdrones = n;
    c.globalAlpha = 1;
  }

  drone(c, x, y, hx, hy, hoog, pakje, a, fase, z, pix) {
    const arm = 0.18;
    c.globalAlpha = a * 0.2;
    c.fillStyle = '#000';
    c.beginPath(); stip(c, x + hoog * SX, y + hoog * SY, arm * 0.9); c.fill();
    c.globalAlpha = a;
    if (pakje) { c.fillStyle = '#b98a52'; c.beginPath(); c.rect(x - 0.07, y - 0.05, 0.14, 0.12); c.fill(); }
    c.strokeStyle = DRONE;
    c.lineWidth = Math.max(pix * 0.8, 0.022);
    c.beginPath();
    c.moveTo(x - (hx - hy) * arm * 0.7, y - (hy + hx) * arm * 0.7); c.lineTo(x + (hx - hy) * arm * 0.7, y + (hy + hx) * arm * 0.7);
    c.moveTo(x - (hx + hy) * arm * 0.7, y - (hy - hx) * arm * 0.7); c.lineTo(x + (hx + hy) * arm * 0.7, y + (hy - hx) * arm * 0.7);
    c.stroke();
    c.fillStyle = '#e9ecef';
    c.beginPath(); blok(c, x, y, hx, hy, -0.065, -0.05, 0.08, 0.05); c.fill();
    if (z >= DREMPEL.lijnen) {
      // rotorschijven: vaag, en dichtbij een draaiend blad
      c.fillStyle = 'rgba(40,44,50,0.22)';
      c.beginPath();
      for (let k = 0; k < 8; k += 2) { const p = HOEKEN[k], q = HOEKEN[k + 1]; stip(c, x + (hx * p - hy * q) * arm * 0.7, y + (hy * p + hx * q) * arm * 0.7, 0.07); }
      c.fill();
      if (z >= DREMPEL.klein) {
        c.strokeStyle = 'rgba(30,30,30,0.5)';
        c.lineWidth = Math.max(pix * 0.5, 0.012);
        c.beginPath();
        const r = fase * 40;
        for (let k = 0; k < 8; k += 2) { const p = HOEKEN[k], q = HOEKEN[k + 1], cx = x + (hx * p - hy * q) * arm * 0.7, cy = y + (hy * p + hx * q) * arm * 0.7; c.moveTo(cx - Math.cos(r) * 0.07, cy - Math.sin(r) * 0.07); c.lineTo(cx + Math.cos(r) * 0.07, cy + Math.sin(r) * 0.07); }
        c.stroke();
      }
    }
    this.zetLicht(x + hx * 0.05, y + hy * 0.05, 0.08, GROEN, 0.7);
    this.zetLicht(x - hx * 0.05, y - hy * 0.05, 0.08, ROOD, 0.7);
  }

  // ---------- paragliders ----------

  // Van de bergen af: schermen die langzaam rondjes draaien in de stijgwind en met de wind het dal in zakken.
  tekenParagliders(c) {
    if (!this.droog || this.wnd.kracht > 0.7 || this.dagA < 0.05 || this.wr.wolken > 0.85) return;
    const t = this.t, z = this.zoom, pix = this.pix, dag = this.state.dag ?? 0, wx = this.windX, wy = this.windY;
    const a = smooth(DREMPEL.paraglider - 0.3, DREMPEL.paraglider + 0.4, z) * this.dagA * (1 - 0.5 * this.sz.winter);
    let n = 0;
    for (let p = 0; p < this.bergPlekken.length && n < PLAFOND.paragliders; p++) {
      const b = this.bergPlekken[p];
      if (hash(b.t, dag, 491) > 0.7 || !this.inBeeld(b.x, b.y, 14)) continue;
      // ze landen op het droge: ligt het dal met de wind mee in het water, dan blijven ze dichter bij de berg
      const ver = !this.nat(b.x + wx * 9, b.y + wy * 9) ? 9 : !this.nat(b.x + wx * 5, b.y + wy * 5) ? 5 : 2;
      for (let j = 0; j < 3 && n < PLAFOND.paragliders; j++) {
        const P = 120 + 40 * hash(b.t, j, 492), u = frac(t / P + hash(b.t, j, 493));
        // spiraal rond een middelpunt dat van de berg met de wind mee het dal in drijft
        const mx = b.x + wx * u * ver - wy * Math.sin(u * 3 + j) * 1.5, my = b.y + wy * u * ver + wx * Math.sin(u * 3 + j) * 1.5;
        const rich = j % 2 ? 1 : -1, g = t * 0.32 * rich + j * 2.1, R = 0.9 + 0.3 * j;
        const x = mx + Math.cos(g) * R, y = my + Math.sin(g) * R * 0.85;
        if (!this.inBeeld(x, y, 3)) continue;
        const hoog = 1 + 4.5 * (1 - u), f = smooth(0, 0.04, u) * (1 - smooth(0.9, 0.98, u));
        if (f < 0.02) continue;
        n++;
        const hx = -Math.sin(g) * rich, hy = Math.cos(g) * rich * 0.85, l = Math.hypot(hx, hy);
        this.scherm(c, x, y, hx / l, hy / l, hoog, a * f, SCHERM[Math.floor(hash(b.t, j, 494) * SCHERM.length)], z, pix);
      }
    }
    this.n.paragliders = n;
    c.globalAlpha = 1;
  }

  scherm(c, x, y, hx, hy, hoog, a, kleur, z, pix) {
    const b = 0.5, d = 0.14, k = 0.14;
    c.globalAlpha = a * 0.16;
    c.fillStyle = '#000';
    c.beginPath(); schermVorm(c, x + hoog * SX, y + hoog * SY, hx, hy, b, d, k); c.fill();
    c.globalAlpha = a;
    // de piloot hangt net achter het scherm (we kijken recht naar beneden, hij hangt een stukje lager)
    const px = x - hx * 0.25, py = y - hy * 0.25;
    if (z >= DREMPEL.lijnen) {
      c.strokeStyle = 'rgba(40,40,40,0.45)';
      c.lineWidth = Math.max(pix * 0.4, 0.012);
      c.beginPath();
      for (let q = 0; q < 4; q++) { const v = LIJN4[q], u = k * (1 - v * v) - d * 0.5; c.moveTo(x + u * hx - v * b * hy, y + u * hy + v * b * hx); c.lineTo(px, py); }
      c.stroke();
    }
    c.fillStyle = kleur;
    c.beginPath(); schermVorm(c, x, y, hx, hy, b, d, k); c.fill();
    // licht van boven: de voorrand lichter, de cellen zichtbaar dichtbij
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath(); schermVorm(c, x + hx * 0.01, y + hy * 0.01, hx, hy, b * 0.96, d * 0.35, k); c.fill();
    if (z >= DREMPEL.klein) {
      c.strokeStyle = 'rgba(0,0,0,0.22)';
      c.lineWidth = Math.max(pix * 0.5, 0.012);
      c.beginPath();
      for (let i = 1; i < 8; i++) { const v = (i / 8 - 0.5) * 2, u = k * (1 - v * v); c.moveTo(x + u * hx - v * b * hy, y + u * hy + v * b * hx); c.lineTo(x + (u - d) * hx - v * b * hy, y + (u - d) * hy + v * b * hx); }
      c.stroke();
    }
    if (z >= DREMPEL.piloot) {
      c.fillStyle = '#2b3138';
      c.beginPath(); stip(c, px, py, 0.08); c.fill();
    }
  }

  // ---------- zweefvliegtuigen ----------

  // Op zomerdagen met stapelwolken: een paar zweefvliegers die samen in dezelfde bel omhoog draaien, en soms een
  // sleepvliegtuig met een zwever aan een lange lijn.
  tekenZweefvliegers(c) {
    const sz = this.sz, wr = this.wr;
    if (sz.zomer < 0.35 || !this.droog || this.dagA < 0.3 || wr.wolken > 0.75 || this.storm) return;
    const t = this.t, z = this.zoom, pix = this.pix, dag = this.state.dag ?? 0, wx = this.windX, wy = this.windY;
    const a = smooth(DREMPEL.zweef - 0.5, DREMPEL.zweef + 0.4, z) * smooth(0.3, 0.6, this.dagA) * smooth(0.35, 0.55, sz.zomer);
    let n = 0, ns = 0;
    for (let p = 0; p < this.thermiek.length && n < PLAFOND.zweefvliegers; p++) {
      const th = this.thermiek[p];
      if (hash(th.t, dag, 501) > 0.6) continue;
      // de bel drijft langzaam met de wind mee en lost na een tijd op
      const P = 200, u = frac(t / P + hash(th.t, 502));
      const mx = th.x + wx * (u - 0.5) * 20, my = th.y + wy * (u - 0.5) * 20;
      if (!this.inBeeld(mx, my, 16)) continue;
      const f = smooth(0, 0.08, u) * (1 - smooth(0.88, 1, u));
      for (let j = 0; j < 3 && n < PLAFOND.zweefvliegers; j++) {
        const g = t * 0.22 + j * 2.1, R = 2.2 + j * 0.5;
        const x = mx + Math.cos(g) * R, y = my + Math.sin(g) * R * 0.9, hoog = 5 + j * 1.2 + u * 2;
        n++;
        let hx = -Math.sin(g), hy = Math.cos(g) * 0.9; const l = Math.hypot(hx, hy); hx /= l; hy /= l;
        this.zwever(c, x, y, hx, hy, hoog, a * f, z, j);
      }
      // het sleepvliegtuig: alleen af en toe, over de bel heen naar boven
      const su = frac(t / 90 + hash(th.t, 503));
      if (ns < PLAFOND.sleep && su < 0.35) {
        const langs = (su / 0.35 - 0.5) * 60, hx = Math.cos(th.h * TAU), hy = Math.sin(th.h * TAU);
        const x = mx + hx * langs, y = my + hy * langs, hoog = 4;
        if (this.inBeeld(x, y, 6)) {
          ns++;
          const L = 0.9;
          c.globalAlpha = a * 0.16;
          c.fillStyle = '#000';
          c.beginPath(); vorm(c, x + hoog * SX, y + hoog * SY, hx, hy, L, KLEIN_VORM); c.fill();
          c.globalAlpha = a;
          c.fillStyle = '#e9e4d8';
          c.beginPath(); vorm(c, x, y, hx, hy, L, KLEIN_VORM); c.fill();
          c.fillStyle = '#c9442f';
          c.beginPath(); blok(c, x, y, hx, hy, -0.48 * L, -0.16 * L, -0.38 * L, 0.16 * L); c.fill();
          // sleeplijn en de zwever erachter
          const zx = x - hx * 3.2, zy = y - hy * 3.2;
          if (z >= DREMPEL.lijnen) { c.strokeStyle = 'rgba(40,40,40,0.4)'; c.lineWidth = Math.max(pix * 0.4, 0.008); c.beginPath(); c.moveTo(x - hx * 0.45 * L, y - hy * 0.45 * L); c.lineTo(zx + hx * 0.4, zy + hy * 0.4); c.stroke(); }
          this.zwever(c, zx, zy, hx, hy, hoog, a, z, 3);
        }
      }
    }
    this.n.zweefvliegers = n;
    this.n.sleep = ns;
    c.globalAlpha = 1;
  }

  zwever(c, x, y, hx, hy, hoog, a, z, j) {
    const L = 1.1;
    c.globalAlpha = a * 0.14;
    c.fillStyle = '#000';
    c.beginPath(); vorm(c, x + hoog * SX, y + hoog * SY, hx, hy, L, ZWEEF_VORM); c.fill();
    c.globalAlpha = a;
    c.fillStyle = ROMP;
    c.beginPath(); vorm(c, x, y, hx, hy, L, ZWEEF_VORM); c.fill();
    // de zuidoostkant van de vleugel iets donkerder; rode tippen; een kap van glas
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.beginPath(); blok(c, x, y, hx, hy, 0, 0.035 * L, 0.06 * L, 0.88 * L); c.fill();
    if (z >= DREMPEL.lijnen) {
      c.fillStyle = j % 2 ? '#c9442f' : '#e8762b';
      c.beginPath(); blok(c, x, y, hx, hy, 0, 0.78 * L, 0.07 * L, 0.9 * L); blok(c, x, y, hx, hy, 0, -0.9 * L, 0.07 * L, -0.78 * L); c.fill();
      c.fillStyle = '#4f6f88';
      c.beginPath(); blok(c, x, y, hx, hy, 0.14 * L, -0.025 * L, 0.29 * L, 0.025 * L); c.fill();
    }
  }

  // ---------- reclameluchtschip ----------

  // Boven een welvarende hoofdstad of rond de jaarwisseling: een luchtschip met gekleurde banen, zonder tekst.
  tekenLuchtschepen(c) {
    if (this.storm || this.wr.onweer > 0.05 || this.wr.regen > 0.4) return;
    const s = this.state, geo = this.geo, Tw = geo.T, t = this.t, z = this.zoom;
    const jd = this.sz.dagInJaar, feest = jd >= 360 || jd <= 1;
    const a = smooth(DREMPEL.luchtschip - 0.5, DREMPEL.luchtschip + 0.5, z);
    let n = 0;
    for (let i = 0; i < s.landen.length && n < PLAFOND.luchtschepen; i++) {
      if (this.oorlog[i] || !(this.welvaart[i] > 1.12 || feest)) continue;
      const h = geo.hoofdstad[i];
      if (h == null || h < 0) continue;
      const tg = geo.tegels[h];
      const g = t * 0.018 + hash(i, 511) * TAU, R = 1.8 * Tw;
      const x = tg.x + Math.cos(g) * R, y = tg.y + Math.sin(g) * R * 0.7;
      if (!this.inBeeld(x, y, 8)) continue;
      n++;
      let hx = -Math.sin(g), hy = Math.cos(g) * 0.7; const l = Math.hypot(hx, hy); hx /= l; hy /= l;
      const [romp, baan] = LUCHTSCHIP[Math.floor(hash(i, 512) * LUCHTSCHIP.length)];
      const L = 1.6, B = 0.42, hoog = 6, ri = Math.atan2(hy, hx);
      c.globalAlpha = a * 0.14;
      c.fillStyle = '#000';
      c.beginPath(); c.ellipse(x + hoog * SX, y + hoog * SY, L, B, ri, 0, TAU); c.fill();
      c.globalAlpha = a;
      // staartvinnen
      c.fillStyle = baan;
      c.beginPath();
      vorm(c, x - hx * L * 0.78, y - hy * L * 0.78, hx, hy, L, VIN_VORM);
      c.fill();
      c.fillStyle = romp;
      c.beginPath(); c.ellipse(x, y, L, B, ri, 0, TAU); c.fill();
      // banen over de romp en een licht vlak bovenop, de zuidoostkant in de schaduw
      c.fillStyle = baan;
      c.beginPath(); blok(c, x, y, hx, hy, -0.45 * L, -B * 0.96, -0.2 * L, B * 0.96); blok(c, x, y, hx, hy, 0.25 * L, -B * 0.85, 0.36 * L, B * 0.85); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.28)';
      c.beginPath(); c.ellipse(x - hy * B * 0.35 - 0.05, y + hx * B * 0.35 - 0.08, L * 0.8, B * 0.32, ri, 0, TAU); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.13)';
      c.beginPath(); c.ellipse(x + 0.08, y + 0.11, L * 0.92, B * 0.6, ri, 0, TAU); c.fill();
      if (z >= DREMPEL.lijnen) {
        // de gondel onder de buik steekt net uit, met twee motortjes
        c.fillStyle = '#4a4f55';
        c.beginPath(); blok(c, x + 0.03, y + 0.05, hx, hy, -0.12, -0.05, 0.16, 0.05); c.fill();
        if (z >= DREMPEL.klein) {
          c.fillStyle = 'rgba(40,40,40,0.3)';
          c.beginPath(); for (let q = 0; q < 2; q++) { const v = PAAR[q]; stip(c, x + hx * -0.05 - hy * v * B * 0.75, y + hy * -0.05 + hx * v * B * 0.75, 0.07); } c.fill();
        }
      }
      // 's nachts verlicht: de romp gloeit zacht, een rood licht aan de staart
      this.zetLicht(x, y, L * 1.1, WARM, 0.35);
      this.zetLicht(x - hx * L, y - hy * L, 0.2, ROOD, 0.8);
      this.zetLicht(x + hx * L, y + hy * L, 0.15, WIT, 0.6);
    }
    this.n.luchtschepen = n;
    c.globalAlpha = 1;
  }

  // ---------- oorlog in de lucht ----------

  tekenOorlog(c) {
    const s = this.state, geo = this.geo, Tw = geo.T, t = this.t, z = this.zoom, pix = this.pix;
    let nj = 0, nt = 0, nv = 0;
    for (let i = 0; i < s.landen.length; i++) {
      if (!this.oorlog[i]) continue;
      const h = geo.hoofdstad[i];
      if (h == null || h < 0) continue;
      const tg = geo.tegels[h];
      // 1. straaljagers in een wig: steeds een andere koers over de hoofdstad heen, alleen boven het eigen land
      if (z >= DREMPEL.jager - 0.5 && z < 11 && nj < PLAFOND.jagers) {
        const P = 34, ruw = t / P + hash(i, 521), u = frac(ruw), cyc = Math.floor(ruw);
        if (u < 0.5) {
          const hk = hash(i, cyc, 522) * TAU, hx = Math.cos(hk), hy = Math.sin(hk);
          const langs = (u / 0.5 - 0.5) * 260, dw = (hash(i, cyc, 523) - 0.5) * 3 * Tw;
          const lx = tg.x + hx * langs - hy * dw, ly = tg.y + hy * langs + hx * dw;
          const a = smooth(DREMPEL.jager - 0.5, DREMPEL.jager + 0.5, z) * (1 - smooth(9.5, 11, z));
          const L = 0.8, hoog = 8;
          for (let k = 0; k < FORMATIE.length && nj < PLAFOND.jagers; k += 2) {
            const x = lx + (hx * FORMATIE[k] - hy * FORMATIE[k + 1]) * L, y = ly + (hy * FORMATIE[k] + hx * FORMATIE[k + 1]) * L;
            if (!this.inBeeld(x, y, 10) || this.landOp(x, y) !== i) continue;
            nj++;
            c.globalAlpha = a * 0.14;
            c.fillStyle = '#000';
            c.beginPath(); vorm(c, x + hoog * SX, y + hoog * SY, hx, hy, L, JAGER_VORM); c.fill();
            c.globalAlpha = a;
            c.fillStyle = JAGER;
            c.beginPath(); vorm(c, x, y, hx, hy, L, JAGER_VORM); c.fill();
            c.fillStyle = 'rgba(0,0,0,0.16)';
            c.beginPath(); vorm(c, x, y, hx, hy, L, JAGER_ZIJ); c.fill();
            if (z >= DREMPEL.lijnen) { c.fillStyle = '#c9a54a'; c.beginPath(); blok(c, x, y, hx, hy, 0.38 * L, -0.03 * L, 0.6 * L, 0.03 * L); c.fill(); }
            // straalpijp: een warm puntje achter het toestel
            c.fillStyle = 'rgba(255,170,90,0.6)';
            c.beginPath(); stip(c, x - hx * 0.62 * L, y - hy * 0.62 * L, 0.06 * L); c.fill();
            this.zetLicht(x - hy * 0.45 * L - hx * 0.38 * L, y + hx * 0.45 * L - hy * 0.38 * L, 0.18, GROEN, 0.8);
            this.zetLicht(x + hy * 0.45 * L - hx * 0.38 * L, y - hx * 0.45 * L - hy * 0.38 * L, 0.18, ROOD, 0.8);
            if (frac(t * 1.1 + k * 0.13) < 0.08) this.zetLicht(x - hx * 0.6 * L, y - hy * 0.6 * L, 0.28, WIT, 1);
          }
        }
      }
      // 2. transporthelikopters: twee rotors, heen en weer tussen de hoofdstad en een kazerne (of naar de vijand)
      if (z >= DREMPEL.transport - 0.5 && nt < PLAFOND.transport) {
        let dX = tg.x, dY = tg.y;
        let kz = null;
        for (let q = 0; q < this.kazernes.length && !kz; q++) if (this.kazernes[q].land === i && this.kazernes[q].t !== h) kz = this.kazernes[q];
        if (kz) { const q = geo.tegels[kz.t]; dX = q.x; dY = q.y; }
        else if (this.vijand[i] >= 0) { const q = geo.tegels[geo.hoofdstad[this.vijand[i]]]; const l = Math.hypot(q.x - tg.x, q.y - tg.y) || 1; dX = tg.x + (q.x - tg.x) / l * 3 * Tw; dY = tg.y + (q.y - tg.y) / l * 3 * Tw; }
        // zonder kazerne en zonder bereikbare vijand vliegen ze niet (geen doel midden in zee)
        const a = smooth(DREMPEL.transport - 0.5, DREMPEL.transport + 0.4, z);
        for (let j = 0; j < 2 && nt < PLAFOND.transport && (dX !== tg.x || dY !== tg.y); j++) {
          const u = frac(t / 70 + hash(i, 531)), f = smooth(0, 1, tri(u)), naar = frac(u) < 0.5;
          const x = tg.x + (dX - tg.x) * f + (j ? 1.4 : 0) * (naar ? -1 : 1), y = tg.y + (dY - tg.y) * f + (j ? 0.9 : 0);
          if (!this.inBeeld(x, y, 3)) continue;
          nt++;
          let hx = dX - tg.x, hy = dY - tg.y; const l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l;
          if (!naar) { hx = -hx; hy = -hy; }
          this.transportHeli(c, x, y, hx, hy, a, t + j * 0.4, z, pix);
        }
      }
      // 3. verkenningsdrones: hoog en traag in een grote cirkel richting de vijand
      if (z >= DREMPEL.verkenner - 0.5 && z < 13 && nv < PLAFOND.verkenners) {
        let mx = tg.x, my = tg.y;
        if (this.vijand[i] >= 0) { const q = geo.tegels[geo.hoofdstad[this.vijand[i]]]; const l = Math.hypot(q.x - tg.x, q.y - tg.y) || 1; const d = Math.min(l * 0.35, 4 * Tw); mx += (q.x - tg.x) / l * d; my += (q.y - tg.y) / l * d; }
        const g = t * 0.06 + hash(i, 541) * TAU, R = 2.4 * Tw;
        const x = mx + Math.cos(g) * R, y = my + Math.sin(g) * R * 0.8;
        if (this.inBeeld(x, y, 14)) {
          nv++;
          let hx = -Math.sin(g), hy = Math.cos(g) * 0.8; const l = Math.hypot(hx, hy); hx /= l; hy /= l;
          const a = smooth(DREMPEL.verkenner - 0.5, DREMPEL.verkenner + 0.5, z) * (1 - smooth(11, 13, z)) * 0.85, L = 0.9, hoog = 11;
          c.globalAlpha = a * 0.1;
          c.fillStyle = '#000';
          c.beginPath(); vorm(c, x + hoog * SX, y + hoog * SY, hx, hy, L, VERKENNER_VORM); c.fill();
          c.globalAlpha = a;
          c.fillStyle = '#9aa1a6';
          c.beginPath(); vorm(c, x, y, hx, hy, L, VERKENNER_VORM); c.fill();
          if (z >= DREMPEL.lijnen) { c.fillStyle = '#5b6268'; c.beginPath(); stip(c, x + hx * 0.3 * L, y + hy * 0.3 * L, 0.06 * L); c.fill(); }
          if (frac(t * 0.7 + i * 0.3) < 0.06) this.zetLicht(x, y, 0.3, WIT, 1);
        }
      }
    }
    this.n.jagers = nj; this.n.transport = nt; this.n.verkenners = nv;
    c.globalAlpha = 1;
  }

  // Tandemrotor: lange romp, een rotor voor en een achter, schaduw op de grond.
  transportHeli(c, x, y, hx, hy, a, fase, z, pix) {
    const hoog = 1.6;
    c.globalAlpha = a * 0.2;
    c.fillStyle = '#000';
    c.beginPath(); blok(c, x + hoog * SX, y + hoog * SY, hx, hy, -0.42, -0.09, 0.42, 0.09); stip(c, x + hoog * SX + hx * 0.34, y + hoog * SY + hy * 0.34, 0.36); stip(c, x + hoog * SX - hx * 0.34, y + hoog * SY - hy * 0.34, 0.36); c.fill();
    c.globalAlpha = a;
    c.fillStyle = LEGER;
    c.beginPath(); blok(c, x, y, hx, hy, -0.42, -0.09, 0.42, 0.09); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.beginPath(); blok(c, x, y, hx, hy, -0.42, 0.02, 0.42, 0.09); c.fill();
    c.fillStyle = 'rgba(170,205,230,0.8)';
    c.beginPath(); blok(c, x, y, hx, hy, 0.36, -0.06, 0.42, 0.06); c.fill();
    // rotorschijven en bladen (de twee draaien tegen elkaar in)
    c.fillStyle = 'rgba(30,30,30,0.1)';
    c.beginPath(); stip(c, x + hx * 0.34, y + hy * 0.34, 0.36); stip(c, x - hx * 0.34, y - hy * 0.34, 0.36); c.fill();
    if (z >= DREMPEL.lijnen - 2) {
      c.strokeStyle = 'rgba(25,25,25,0.55)';
      c.lineWidth = Math.max(pix * 0.6, 0.02);
      c.beginPath();
      for (let q = 0; q < 2; q++) {
        const d = PAAR[q], k = 0.34 * d, cx = x + hx * k, cy = y + hy * k, r = fase * 22 * d;
        for (let b = 0; b < 3; b++) { const h = r + b * TAU / 3; c.moveTo(cx, cy); c.lineTo(cx + Math.cos(h) * 0.36, cy + Math.sin(h) * 0.36); }
      }
      c.stroke();
    }
    this.zetLicht(x, y, 0.3, ROOD, frac(fase * 0.9) < 0.15 ? 1 : 0.15);
  }

  // ---------- na de nachtlaag ----------

  // Navigatielichten, luchtafweer boven hoofdsteden in oorlog en het poollicht.
  tekenNacht(c, view, sc, nu) {
    const s = view.state;
    if (!s || !this.sprites || !this.geo || view.state !== this.state) return;
    const nacht = nachtOp(nu);
    this.n.afweer = 0; this.n.flak = 0; this.n.poolstroken = 0;
    if (nacht < 0.05 || view.zoom < DREMPEL.streep) return;
    c.save();
    c.translate(view.w / 2 - view.cx * sc, view.h / 2 - view.cy * sc);
    c.scale(sc, sc);
    c.globalCompositeOperation = 'lighter';
    this.tekenPoollicht(c, view, nacht, nu);
    this.tekenAfweer(c, view, nacht, nu);
    const sp = this.sprites.gloed, L = this.licht;
    for (let i = 0; i < this.nLicht; i++) {
      const o = i * LICHT, g = sp[L[o + 3]], r = L[o + 2];
      if (!g) continue;
      c.globalAlpha = nacht * L[o + 4];
      c.drawImage(g, L[o] - r, L[o + 1] - r, r * 2, r * 2);
    }
    c.restore();
  }

  // Groene en paarse sluiers die golven boven het hoge noorden, op heldere, koude nachten; nooit boven een stad.
  tekenPoollicht(c, view, nacht, nu) {
    const sz = this.sz, z = view.zoom, pool = this.pool;
    if (!sz || !pool || !this.sprites.sluier) return;
    const a = smooth(0.35, 0.75, nacht) * smooth(0.72, 0.88, sz.koud) * (1 - smooth(0.2, 0.42, pool.wolken)) * (1 - smooth(6.5, 9.5, z));
    if (a < 0.02 || this.wy0 > 150) return;
    const t = nu / 1000, sp = this.sprites.sluier;
    // breedte van een strook: om de acht eenheden, verder uitgezoomd grover (zo blijft het onder het plafond)
    const breed = this.wx1 - this.wx0, stap = Math.max(1, Math.ceil(breed / 8 / PLAFOND.poolstroken));
    const s0 = Math.max(0, Math.floor(this.wx0 / 8) - 1), s1 = Math.min(125, Math.ceil(this.wx1 / 8) + 1);
    let n = 0;
    for (let si = s0 - (s0 % stap); si <= s1 && n < PLAFOND.poolstroken; si += stap) {
      const x = si * 8 + 4;
      // de onderrand van de sluier: een lange golf die langzaam heen en weer schuift
      const y = 62 + 26 * Math.sin(x / 150 + t * 0.045) + 9 * Math.sin(x / 47 - t * 0.12) + 4 * Math.sin(x / 17 + t * 0.3);
      const r = clamp(Math.floor((y - 16) / 16 + 0.5), 0, 7);
      // de sluier reikt tot drie vakjes boven zijn onderrand: ook daar geen stad
      if (this.poolStad[si * 8 + r] || this.poolStad[si * 8 + Math.max(0, r - 1)] || this.poolStad[si * 8 + Math.max(0, r - 2)]) continue;
      const hoog = 34 + 16 * Math.sin(x / 63 + t * 0.2), golf = 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(x / 31 + t * 0.6), 2);
      // de randen van het gebied lopen zacht uit
      const rand = smooth(0, 60, x) * smooth(1000, 940, x);
      c.globalAlpha = a * 0.3 * golf * rand;
      const bw = 8 * stap * 1.7;
      c.drawImage(sp, x - bw / 2, y - hoog, bw, hoog);
      n++;
    }
    this.n.poolstroken = n;
  }

  // Luchtafweer boven een hoofdstad in oorlog: stromen lichtspoorkogels die schuin omhoog zwaaien, en hoog in de lucht
  // korte flitsen van ontploffende granaten.
  tekenAfweer(c, view, nacht, nu) {
    const s = this.state, geo = this.geo, Tw = geo.T, t = nu / 1000, z = view.zoom;
    if (!this.oorlog || z < DREMPEL.jager) return;
    const a = smooth(0.3, 0.7, nacht) * smooth(DREMPEL.jager, DREMPEL.jager + 1, z);
    if (a < 0.02) return;
    let ns = 0, nf = 0;
    c.lineCap = 'round';
    for (let i = 0; i < s.landen.length && ns < PLAFOND.afweer; i++) {
      if (!this.oorlog[i]) continue;
      const h = geo.hoofdstad[i];
      if (h == null || h < 0) continue;
      const tg = geo.tegels[h];
      if (!this.inBeeld(tg.x, tg.y - 6, 2.5 * Tw)) continue;
      // vier stukken rond de stad; ze vuren in vlagen
      c.strokeStyle = '#ffb35a';
      c.lineWidth = Math.max(this.pix ?? 0.1, 0.06);
      c.globalAlpha = a * 0.8;
      c.beginPath();
      for (let k = 0; k < 4 && ns < PLAFOND.afweer; k++) {
        const vlaag = Math.sin(t * 0.9 + k * 1.9 + i);
        if (vlaag < 0.1) continue;
        // de stukken staan op het land (aan de kust valt een stuk in zee weg)
        const gx = tg.x + Math.cos(k * 1.57 + 0.6) * 1.3 * Tw, gy = tg.y + Math.sin(k * 1.57 + 0.6) * 1.1 * Tw;
        if (this.nat(gx, gy)) continue;
        ns++;
        const hk = 0.35 * Math.sin(t * 0.7 + k * 2.3) + (k - 1.5) * 0.25, dx = Math.sin(hk) * 0.7, dy = -Math.cos(hk);
        // een stroom kogels: korte streepjes die omhoog (op het scherm: naar boven) wegvliegen
        for (let j = 0; j < 5; j++) {
          const d = frac(t * 1.6 + j / 5 + k * 0.17) * 9;
          c.moveTo(gx + dx * d, gy + dy * d); c.lineTo(gx + dx * (d + 0.7), gy + dy * (d + 0.7));
        }
      }
      c.stroke();
      // flitsen van granaten hoog boven de stad
      const sp = this.sprites.gloed[ORANJE];
      for (let k = 0; k < 4 && nf < PLAFOND.flak && sp; k++) {
        const P = 2.3 + k * 0.4, ruw = t / P + hash(i, k, 551), u = frac(ruw), cyc = Math.floor(ruw);
        if (u > 0.3) continue;
        nf++;
        const fx = tg.x + (hash(i, cyc * 7 + k, 552) - 0.5) * 3 * Tw, fy = tg.y - 4 - hash(i, cyc * 7 + k, 553) * 6;
        const r = 0.4 + u * 3;
        c.globalAlpha = a * (1 - u / 0.3) * 0.9;
        c.drawImage(sp, fx - r, fy - r, r * 2, r * 2);
      }
    }
    this.n.afweer = ns;
    this.n.flak = nf;
  }

  // Wat er dit beeld getekend is (voor de test en om te meten).
  telling() { return { ...this.n, lichten: this.nLicht }; }

  // Vaste plekken van deze wereld (voor de test en om te bekijken).
  plekken() {
    const uit = [];
    for (const p of this.zwermPlekken ?? []) uit.push({ soort: 'zwerm', x: p.x, y: p.y });
    for (const p of this.bergPlekken ?? []) uit.push({ soort: 'paraglider', x: p.x, y: p.y });
    for (const p of this.thermiek ?? []) uit.push({ soort: 'thermiek', x: p.x, y: p.y });
    for (const s of this.stranden ?? []) { for (let i = 0; i < s.pl.length; i += 2) uit.push({ soort: 'vlieger', x: s.pl[i], y: s.pl[i + 1], t: s.t }); if (s.kite) uit.push({ soort: 'kiter', x: s.kite[0], y: s.kite[1], t: s.t }); }
    for (const k of this.kazernes ?? []) if (k.zone) uit.push({ soort: 'landing', x: k.zone.x, y: k.zone.y, t: k.zone.t });
    return uit;
  }

  statistiek() {
    return { zwermen: this.zwermPlekken?.length ?? 0, bergen: this.bergPlekken?.length ?? 0, thermiek: this.thermiek?.length ?? 0, stranden: this.stranden?.length ?? 0, kazernes: this.kazernes?.length ?? 0, sprites: this.sprites ? this.sprites.gloed.length + 1 : 0 };
  }
}
