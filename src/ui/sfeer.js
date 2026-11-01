// Sfeer en weer op de kaart (pakket E): licht, wolken, mist, regen, sneeuw, onweer en de kleur van de dag.
// Gestuurd door seizoen(), weer() en wind() uit seizoen.js en door dezelfde dag-en-nachtcyclus als tekenNacht in map.js,
// zodat sneeuw in de lucht, natte straten en wolkenschaduwen bij de rest van de kaart passen.
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Plaatsing en aantallen komen uit een vaste hash
// van tegel, cel, volgnummer en dag; de klok (nu) stuurt alleen beweging. Geen Math.random, geen Date.
//
// Twee aanroepen per beeld vanuit map.js:
//   tekenGrond  na gebouwen en leven, vóór de eenheden en de nacht: wolkenschaduw, mist, glinstering, kringen,
//               natte straten, hittetrilling en de kleur van de dag.
//   tekenLucht  na de lichten: hoge wolken, lage flarden, zonnestralen, deeltjes, regen, sneeuw, regenboog, bliksem.

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
export const PLAFOND = { wolken: 40, schaduwen: 30, mist: 44, flarden: 9, glinster: 56, kringen: 44, spatten: 36, glans: 24, trilling: 20, deeltjes: 54, reflecties: 24, halo: 24, plaskringen: 40, vlagen: 16, bliksem: 1 };

const DEKKING = 0.6; // hoogstens dit deel van de wolkencellen is bezet: ook een grijze dag houdt gaten
const GROOT = 110; // cel van de grote wolken (wereldeenheden)
const KLEIN = 30; // cel van de kleine stapelwolkjes die je pas diep ingezoomd ziet
const FLARD = 46; // cel van de lage flarden
const DEELTJE = 24; // cel van de zwevende deeltjes (blaadjes, bloesem, pluis, vuurvliegjes)
const VEL = 128; // zijde van de regen- en sneeuwvellen (px)
const ALIAS = { olieveld: 'centrale', staalfabriek: 'industrie', landbouw: 'boerderij', zware_industrie: 'industrie', ruimtevaartcentrum: 'chipfabriek', spoor: 'opslag' };
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
];
// Lantaarns van de levenslaag (straatcontract: om de 0,25 tegel langs de straat, om en om aan beide kanten op de stoep,
// rond het plein van de hoofdstad geen). Per tegel twee langs de oost-weststraat: [langs, kant].
const STOEP = 0.045;
const LAMPEN = [[-0.375, -1], [0.125, -1]];
const LAMPEN_HOOFD = [[-0.375, -1], [0.375, 1]];

// Dag en nacht: precies de formule van tekenNacht in map.js (cyclus van drie minuten, fase 0 = middag).
export function dagLicht(nu) {
  const fase = (nu / 1000 % 180) / 180;
  const licht = 0.5 + 0.5 * Math.cos(fase * TAU);
  return { fase, licht, nacht: clamp((0.5 - licht) / 0.5, 0, 1) };
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

// Een wolkvorm uit losse bollen: als schaduw (donker), mist (wit en plat) of flard (wit en rafelig).
function bolSprite(w, h, zaad, kleur, a, n) {
  const cv = maakCanvas(w, h), c = cv.getContext('2d'), r = rnd(zaad);
  for (let i = 0; i < n; i++) {
    const x = w * (0.22 + r() * 0.56), y = h * (0.3 + r() * 0.4), rr = h * (0.2 + r() * 0.28);
    zacht(c, x, y, rr, kleur, a);
  }
  return cv;
}

function bakSprites() {
  const S = {};
  S.schaduw = [0, 1, 2].map((i) => bolSprite(128, 64, 11 + i, '14,22,34', 0.55, 7));
  S.mist = [0, 1].map((i) => bolSprite(128, 48, 31 + i, '232,236,240', 0.5, 6));
  S.flard = [0, 1, 2].map((i) => bolSprite(192, 96, 51 + i, '246,248,250', 0.42, 9));
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
  // Glinster: een kruisje met een zachte kern; wit voor de middag, warm voor het gouden uur.
  const ster = (kleur) => {
    const cv = maakCanvas(16, 16), c = cv.getContext('2d');
    zacht(c, 8, 8, 4, kleur, 1);
    c.fillStyle = `rgba(${kleur},0.9)`;
    c.fillRect(7.5, 1, 1, 14); c.fillRect(1, 7.5, 14, 1);
    return cv;
  };
  S.glinster = ster('255,255,255');
  S.glinsterWarm = ster('255,206,130');
  S.vuurvlieg = (() => { const cv = maakCanvas(16, 16); zacht(cv.getContext('2d'), 8, 8, 8, '214,255,120', 1); return cv; })();
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
  // Vignet voor het miniatuurgevoel bij diep inzoomen.
  {
    const cv = maakCanvas(256, 256), c = cv.getContext('2d');
    const g = c.createRadialGradient(128, 128, 70, 128, 128, 182);
    g.addColorStop(0, 'rgba(8,12,20,0)'); g.addColorStop(1, 'rgba(8,12,20,0.85)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    S.vignet = cv;
  }
  // Zonnegloed (het licht komt uit het noordwesten) en zonnestralen die van daaruit over de kaart vallen.
  {
    const cv = maakCanvas(128, 128);
    zacht(cv.getContext('2d'), 64, 64, 64, '255,196,120', 1, 0);
    S.zon = cv;
  }
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

// ---------- de laag ----------

export class SfeerLaag {
  constructor() {
    this.state = null;
    this.geo = null;
    this.sprites = null;
    this.patronen = null;
    this.patroonCtx = null;
    this.vorigNu = -1;
    this.drift = { x: 0, y: 0 }; // hoe ver de wolken met de wind zijn meegedreven (wereldeenheden)
    this.glad = null; // gladgestreken weer op het midden van het beeld
    this.stemming = null; // publiek: wat andere lagen over licht en weer willen weten
    this.mistKans = new Float32Array(0);
    this.droog = new Uint8Array(0);
    this.water = new Uint8Array(0);
    this.straat = new Uint8Array(0);
    this.straatSig = null;
    this.woonSoort = new Map(); // gebouwId -> 1 als het als woonwijk getekend wordt (begrensd door het aantal gebouwsoorten)
    this.plasTegels = new Int32Array(PLAFOND.glans);
    this.plassen = new Float32Array(PLAFOND.glans * 3 * 4);
    this.gewicht = new Float32Array(DEELTJESOORTEN.length);
    this.nWater = 0; this.nLand = 0; this.nDroog = 0; this.zichtFactor = 1;
    this.tel = {};
    for (const k of Object.keys(PLAFOND)) this.tel[k] = 0;
  }

  // Na het laden van een spel: per tegel voorrekenen waar mist hangt en waar het land droog genoeg is om te trillen.
  laad(view) {
    this.state = view.state;
    this.geo = view.geo;
    this.eigenaar = view.eigenaar;
    this.glad = null;
    this.vorigNu = -1;
    this.straatSig = null;
    this.woonSoort.clear();
    const geo = this.geo, n = geo.tegels.length;
    this.mistKans = new Float32Array(n);
    this.droog = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.straat = new Uint8Array(n);
    for (const t of geo.tegels) {
      if (t.terrein === 'water') this.water[t.i] = 1;
      let som = 0, m = 0, land = 0, water = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
        if (!dr && !dk) continue;
        const k = t.k + dk, r = t.r + dr;
        if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
        const b = geo.tegels[r * geo.kol + k];
        if (b.terrein === 'water') water++; else { land++; som += b.hoogte; m++; }
      }
      if (t.terrein === 'water') this.mistKans[t.i] = land ? 0.8 : 0.3; // zeemist hangt vooral langs de kust
      else {
        // dal: lager dan de buren, of gewoon laag land; bergtoppen steken erboven uit
        const dal = m ? smooth(0.005, 0.05, som / m - t.hoogte) : 0;
        const laag = 1 - smooth(0.3, 0.5, t.hoogte);
        this.mistKans[t.i] = t.terrein === 'berg' ? 0 : clamp(0.75 * dal + 0.45 * laag + (water ? 0.15 : 0), 0, 1);
        this.droog[t.i] = (t.terrein === 'vlakte' && hash(t.i, 41) < 0.55) || t.terrein === 'kust' ? 1 : 0;
      }
    }
  }

  isWater(x, y) {
    const e = this.eigenaar;
    if (!e) return false;
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= 1000 || py >= 620) return true;
    return e[py * 1000 + px] === -1;
  }

  isWoonwijk(id) {
    let v = this.woonSoort.get(id);
    if (v === undefined) {
      const g = this.state.pack.gebouwIndex[id];
      v = g && (g.tekening ?? ALIAS[g.id] ?? g.id) === 'woonwijk' ? 1 : 0;
      this.woonSoort.set(id, v);
    }
    return v;
  }

  // Waar lopen straten? Hoofdsteden en woonwijken (het straatcontract uit de spec). Alleen herberekenen als er gebouwd
  // of gesloopt is: de handtekening is een getal over de tegels van alle woonwijken, dus ook een woonwijk die op
  // dezelfde tegel door iets anders vervangen wordt telt mee (een som van tegelnummers zag dat niet).
  werkStraten() {
    const s = this.state;
    let sig = s.landen.length | 0;
    for (let i = 0; i < s.landen.length; i++) {
      const pl = s.landen[i].plaatsingen;
      for (let j = 0; j < pl.length; j++) {
        const p = pl[j];
        if (p.t >= 0 && this.isWoonwijk(p.g)) sig = (Math.imul(sig, 31) + p.t + 1) | 0;
      }
    }
    if (sig === this.straatSig) return;
    this.straatSig = sig;
    this.straat.fill(0);
    for (const land of s.landen) {
      for (const p of land.plaatsingen) if (p.t >= 0 && this.isWoonwijk(p.g)) this.straat[p.t] = 1;
      const h = this.geo.hoofdstad[land.idx];
      if (h != null && h >= 0) this.straat[h] = 2;
    }
  }

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
    const { fase, licht, nacht } = dagLicht(nu);
    const avond = fase < 0.5;
    const gouden = smooth(0.46, 0.56, licht) * (1 - smooth(0.6, 0.76, licht));
    const blauw = smooth(0.26, 0.38, licht) * (1 - smooth(0.44, 0.54, licht));
    const ochtend = smooth(0.7, 0.78, fase) * (1 - smooth(0.9, 0.98, fase));
    const dag = smooth(0.42, 0.66, licht);
    // regenboog na een bui: gisteren nat, nu bijna droog, zon erbij; niet elke dag
    const boog = hash(s.dag, 91) < 0.65 ? dag * (1 - gouden * 0.5) * smooth(0.12, 0.35, gisteren.regen) * (1 - smooth(0.06, 0.2, g.regen)) * (1 - smooth(0.6, 0.95, g.wolken)) : 0;
    this.stemming = {
      dag: s.dag, dagF, seizoen: sz, wolken: g.wolken, regen: g.regen, sneeuw: g.sneeuw, onweer: g.onweer, mist: g.mist, nat: g.nat,
      windHoek: g.hoek, windKracht: g.kracht, licht, nacht, dagLicht: dag, gouden, blauw, ochtend, avond, regenboog: boog, flits: 0,
    };
    return this.stemming;
  }

  telNul() { for (const k in this.tel) this.tel[k] = 0; }
  telling() { return { ...this.tel }; }

  // ---------- grondniveau ----------

  tekenGrond(c, view, sc, nu, frac = 1) {
    const s = view.state;
    if (!s || !view.geo || !view.w) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar) this.laad(view);
    this.sprites ??= bakSprites();
    this.telNul();
    const st = this.bijwerken(view, nu, frac);
    this.kader(view, sc);
    const z = view.zoom;
    // in de bouwmodus moet het bouwraster leesbaar blijven: mist en lage flarden wijken dan grotendeels
    const rust = view.bouwModus ? 0.3 : 1;
    if (z >= 4) this.werkStraten();
    if (z >= 3) this.telZicht();
    c.save();
    if (z >= 2.4) this.tekenSchaduwen(c, st, smooth(2.4, 3.2, z), GROOT, 0, 0.17);
    if (z >= 4.5) this.tekenSchaduwen(c, st, smooth(4.5, 6, z), KLEIN, 1, 0.12);
    if (z >= 2.5) this.tekenMist(c, st, nu, smooth(2.5, 3.5, z) * rust);
    if (z >= 3) this.tekenGlinster(c, st, nu, smooth(3, 4, z));
    if (z >= 3 && st.windKracht > 0.45) this.tekenVlagen(c, st, nu, smooth(3, 4, z));
    if (z >= 4.5 && st.regen > 0.04) this.tekenKringen(c, st, nu, smooth(4.5, 5.5, z));
    if (z >= 5 && st.nat > 0.08) this.tekenNat(c, st, nu, smooth(5, 6, z));
    if (z >= 6) this.tekenTrilling(c, st, nu, smooth(6, 7, z));
    this.tekenKleur(c, st, z);
    c.restore();
  }

  // Wolkenschaduwen: zachte donkere vlekken die met de wind over het land trekken, dichter waar het bewolkt is.
  tekenSchaduwen(c, st, a, G, laag, sterkte) {
    if (a <= 0.01 || (laag && st.wolken < 0.04)) return;
    const S = this.sprites.schaduw, sc = this.sc, MAX = PLAFOND.schaduwen;
    const dx = this.drift.x * (laag ? 1.3 : 1), dy = this.drift.y * (laag ? 1.3 : 1);
    const i0 = Math.floor((this.wx0 - dx) / G) - 1, i1 = Math.floor((this.wx1 - dx) / G) + 1;
    const j0 = Math.floor((this.wy0 - dy) / G) - 1, j1 = Math.floor((this.wy1 - dy) / G) + 1;
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
        // de grote schaduwen liggen precies waar de hoge wolken ze op lage zoom werpen (14, 18 naar het zuidoosten)
        const b = G * (1.1 + hash(i, j, 5) * 0.7) * sc * (laag ? 1 : 0.8), h = b * 0.5;
        const x = (wx + (laag ? 0 : 14)) * sc + this.ox, y = (wy + (laag ? 0 : 18)) * sc + this.oy;
        if (x + b < 0 || y + h < 0 || x - b > this.w || y - h > this.h) continue;
        c.globalAlpha = a * sterkte * (0.5 + 0.5 * dicht) * (1 - 0.4 * st.nacht);
        c.drawImage(S[mod(i * 7 + j * 3, 3)], x - b / 2, y - h / 2, b, h);
        this.tel.schaduwen++;
      }
    }
  }

  // Mist: in dalen en boven water, vooral 's ochtends en in herfst en winter. Diep ingezoomd rafelt hij in slierten.
  tekenMist(c, st, nu, a) {
    const sz = st.seizoen;
    const sterkte = clamp(st.mist * (0.55 + 0.9 * st.ochtend) + st.ochtend * (0.18 + 0.4 * (sz.herfst + sz.winter)) * (1 - st.regen), 0, 1);
    if (sterkte * a < 0.03) return;
    const geo = this.geo, sc = this.sc, S = this.sprites.mist, MAX = PLAFOND.mist, M = this.mistKans;
    const per = this.T > 90 ? 2 : 1;
    // veel tegels in beeld: om de andere tegel een dubbel zo grote bank. Geteld zonder de afkapping aan de rand van
    // de wereld, anders springt de mist naar een ander patroon zodra je naar de rand schuift
    const stap = ((this.wx1 - this.wx0) / geo.T + 3) * ((this.wy1 - this.wy0) / geo.T + 3) > 140 ? 2 : 1;
    // verwacht aantal banken in beeld; zijn het er te veel, dan gelijkmatig uitdunnen en de overgebleven banken iets
    // groter maken, zodat de mist het hele beeld blijft vullen in plaats van alleen de bovenste rijen
    let som = 0;
    for (let r = this.rV0; r <= this.rV1; r++) for (let k = this.kV0; k <= this.kV1; k++) { const v = M[r * geo.kol + k]; if (v >= 0.2) som += v; }
    // banken die half in beeld steken tellen ook mee: het beeld groeit met een halve bank aan elke kant
    const b0 = geo.T * (per > 1 ? 1.4 : 2.2) * stap * sc;
    const rand = ((this.w + b0) * (this.h + b0 * 0.38)) / (this.w * this.h);
    const f = dun((som * this.zichtFactor * rand * 0.9 * per) / (stap * stap), MAX);
    const groei = Math.min(1.5, 1 / Math.sqrt(f));
    const b = b0 * groei, h = b * 0.38;
    // een brede bank van net buiten beeld steekt er een eind in: ruimere marge, en alleen banken in beeld tellen mee
    const m = stap + 1;
    const rA = Math.max(0, this.r0 - m), rB = Math.min(geo.rij - 1, this.r1 + m);
    const kA = Math.max(0, this.k0 - m), kB = Math.min(geo.kol - 1, this.k1 + m);
    const t = nu / 1000;
    c.globalCompositeOperation = 'source-over';
    for (let r = rA - (rA % stap); r <= rB; r += stap) {
      for (let k = kA - (kA % stap); k <= kB; k += stap) {
        const ti = r * geo.kol + k, kans = M[ti];
        if (kans < 0.2) continue;
        const tg = geo.tegels[ti];
        for (let j = 0; j < per; j++) {
          if (hash(ti, j, 61) > kans * 0.9 * f) continue;
          const zw = Math.sin(t * 0.07 + hash(ti, j, 62) * TAU) * 0.35 * geo.T;
          const wx = tg.x + (hash(ti, j, 63) - 0.5) * geo.T + zw, wy = tg.y + (hash(ti, j, 64) - 0.5) * geo.T * 0.8;
          const x = wx * sc + this.ox, y = wy * sc + this.oy;
          if (x + b / 2 < 0 || y + h / 2 < 0 || x - b / 2 > this.w || y - h / 2 > this.h) continue;
          if (this.tel.mist >= MAX) return;
          c.globalAlpha = a * sterkte * kans * (per > 1 ? 0.5 : 0.42) * (1 - 0.5 * st.nacht);
          c.drawImage(S[(ti + j) & 1], x - b / 2, y - h / 2, b, h);
          this.tel.mist++;
        }
      }
    }
  }

  // Zon op het water: twinkelende kruisjes, warm bij het gouden uur. Op winterochtenden glinstert de rijp op het land.
  tekenGlinster(c, st, nu, a) {
    const zon = st.dagLicht * (1 - 0.85 * st.wolken) * (1 - st.regen);
    const rijp = st.seizoen.koud > 0.72 && this.sc * this.geo.T > 150 ? st.ochtend * (1 - st.wolken * 0.7) : 0;
    if ((zon < 0.05 && rijp < 0.05) || a <= 0.01) return;
    const geo = this.geo, T = this.T, sc = this.sc, MAX = PLAFOND.glinster;
    const spr = st.gouden > 0.3 ? this.sprites.glinsterWarm : this.sprites.glinster;
    const per = T > 160 ? 3 : T > 70 ? 2 : 1;
    // ongeveer 32% van de plekjes twinkelt op een gegeven moment (sin > 0,55)
    const f = dun(((zon >= 0.05 ? this.nWater : 0) + (rijp * 0.6 >= 0.05 ? this.nLand : 0)) * this.zichtFactor * per * 0.32, MAX);
    const t = nu / 1000;
    c.globalCompositeOperation = 'lighter';
    for (let r = this.r0; r <= this.r1; r++) {
      for (let k = this.k0; k <= this.k1; k++) {
        const ti = r * geo.kol + k, tg = geo.tegels[ti];
        const water = tg.terrein === 'water';
        const sterk = water ? zon : rijp * 0.6;
        if (sterk < 0.05) continue;
        for (let j = 0; j < per; j++) {
          if (f < 1 && hash(ti, j, 26) > f) continue;
          const fl = Math.sin(t * (1.6 + hash(ti, j, 21) * 2.4) + hash(ti, j, 22) * TAU);
          if (fl < 0.55) continue;
          const wx = tg.x + (hash(ti, j, 23) - 0.5) * geo.T, wy = tg.y + (hash(ti, j, 24) - 0.5) * geo.T;
          const g = Math.max(3, T * (water ? 0.05 : 0.025)) * (0.7 + 0.6 * hash(ti, j, 25));
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

  // Kleur van de dag over het hele beeld: gouden en blauw uur, koeler winterlicht, grijs onder een dik wolkendek
  // en een lichte nevel op lage zoom die wegtrekt als je inzoomt. Alles zacht, zodat grenzen leesbaar blijven.
  tekenKleur(c, st, z) {
    const w = this.w, h = this.h, sz = st.seizoen;
    const grijs = clamp(st.wolken * 0.6 + st.regen * 0.5 + st.sneeuw * 0.3, 0, 1);
    if (grijs > 0.05) {
      c.globalCompositeOperation = 'saturation';
      c.globalAlpha = grijs * 0.28;
      c.fillStyle = '#808080';
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = grijs * 0.12;
      c.fillStyle = '#1c2533';
      c.fillRect(0, 0, w, h);
    }
    if (st.gouden > 0.02) {
      c.globalCompositeOperation = 'soft-light';
      c.globalAlpha = st.gouden * (1 - 0.6 * grijs) * 0.55;
      c.fillStyle = st.avond ? '#ff9a3c' : '#ffb27a';
      c.fillRect(0, 0, w, h);
      // de zon staat laag in het noordwesten
      c.globalCompositeOperation = 'lighter';
      const gloed = st.gouden * (1 - grijs) * 0.22;
      if (gloed > 0.004) {
        c.globalAlpha = gloed;
        const r = Math.max(w, h) * 0.9;
        c.drawImage(this.sprites.zon, -r * 0.55, -r * 0.55, r * 1.3, r * 1.3);
      }
    }
    if (st.blauw > 0.03) {
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = st.blauw * 0.14;
      c.fillStyle = '#2b4a8c';
      c.fillRect(0, 0, w, h);
    }
    if (sz.winter > 0.05) {
      c.globalCompositeOperation = 'soft-light';
      c.globalAlpha = sz.winter * 0.35;
      c.fillStyle = '#5a7fb0';
      c.fillRect(0, 0, w, h);
    }
    const nevel = 1 - smooth(1.2, 2.8, z);
    if (nevel > 0.08) {
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = nevel * (0.05 + 0.05 * st.mist);
      c.fillStyle = '#c8d6e4';
      c.fillRect(0, 0, w, h);
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  // ---------- in de lucht ----------

  tekenLucht(c, view, sc, nu) {
    const st = this.stemming;
    if (!st || !view.state || !this.sprites || !view.w) return;
    this.kader(view, sc);
    const z = view.zoom;
    c.save();
    if (z >= 4 && st.nacht > 0.1 && (st.nat > 0.1 || st.mist + st.ochtend * 0.3 > 0.15)) this.tekenNachtLicht(c, view, st);
    if (z < 3.4) this.tekenWolken(c, view, st, nu, 1 - smooth(1.2, 3.2, z));
    if (z < 2.6) this.tekenStreep(c, st, nu, 1 - smooth(1.8, 2.6, z));
    if (z >= 3 && st.gouden > 0.05) this.tekenStralen(c, st, smooth(3, 4.5, z));
    if (z >= 5) this.tekenFlarden(c, view, st, nu, smooth(5, 7, z) * (view.bouwModus ? 0.3 : 1));
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
    this.werkStraten();
    const geo = this.geo, T = this.T, sc = this.sc;
    const nat = clamp(st.nat * 1.5, 0, 1) * smooth(5, 6, view.zoom), mist = clamp(st.mist + st.ochtend * 0.3, 0, 1);
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
            c.globalAlpha = mist * st.nacht * 0.22;
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

  // Hoge wolken (vervangt tekenWolken van map.js): drijven met de wind, zo dicht als het weer is.
  // Regenwolken zijn grijs en slepen een gordijn achter zich aan. Hun schaduw valt naar het zuidoosten.
  tekenWolken(c, view, st, nu, a) {
    if (a <= 0.01) return;
    const wolk = view.wolk, sc = this.sc, G = GROOT, MAX = PLAFOND.wolken;
    if (!wolk) return;
    const dx = this.drift.x, dy = this.drift.y;
    const i0 = Math.floor((this.wx0 - dx) / G) - 1, i1 = Math.floor((this.wx1 - dx) / G) + 1;
    const j0 = Math.floor((this.wy0 - dy) / G) - 1, j1 = Math.floor((this.wy1 - dy) / G) + 1;
    // de grondschaduw neemt het over vanaf zoom 2,4 (zelfde cellen, zelfde plek)
    const eigenSchaduw = 1 - smooth(2.4, 3.2, view.zoom);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (this.tel.wolken >= MAX) return;
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
        const nat = ww.regen + ww.sneeuw;
        if (nat > 0.15) {
          c.globalAlpha = a * clamp(nat, 0, 1) * 0.5;
          c.drawImage(this.sprites.gordijn, x - b * 0.3 + 10 * sc, y, b * 0.6, b * 0.55);
        }
        c.globalAlpha = a * 0.24 * eigenSchaduw * (0.6 + 0.4 * dicht);
        c.drawImage(this.sprites.schaduw[mod(i * 7 + j * 3, 3)], x - b / 2 + 14 * sc, y - h / 2 + 18 * sc, b, h);
        c.globalAlpha = a * (0.38 + 0.2 * dicht) * (1 - 0.5 * st.nacht);
        c.drawImage(wolk, x - b / 2, y - h / 2, b, h);
        if (nat > 0.1 || ww.wolken > 0.85) {
          c.globalAlpha = a * clamp(nat * 1.2 + (ww.wolken - 0.85) * 2, 0, 0.6);
          c.drawImage(this.sprites.donker, x - b / 2, y - h / 2, b, h);
        }
        if (st.gouden > 0.05) {
          // onderkant van de wolk licht roze-oranje op bij zonsondergang
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = a * st.gouden * 0.18;
          c.drawImage(this.sprites.zon, x - b * 0.4, y - h * 0.2, b * 0.8, h * 0.8);
          c.globalCompositeOperation = 'source-over';
        }
        this.tel.wolken++;
      }
    }
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

  // Lage wolkenflarden die je bij diep inzoomen doorvliegt: ze liggen dichter bij de camera en schuiven dus
  // sneller dan de grond (parallax). In het midden van het beeld wijken ze, zodat de kaart leesbaar blijft.
  tekenFlarden(c, view, st, nu, a) {
    const dek = clamp(0.15 + st.wolken * 0.55 + st.mist * 0.6 + st.regen * 0.3, 0, 1) * a;
    if (dek < 0.03) return;
    const S = this.sprites.flard, G = FLARD, MAX = PLAFOND.flarden;
    const p = 1.25 + 0.15 * smooth(5, 12, view.zoom); // hoe veel dichter bij de camera
    const sc = this.sc * p, cx = view.cx, cy = view.cy, w = this.w, h = this.h;
    const dx = this.drift.x * 1.6, dy = this.drift.y * 1.6;
    const hw = w / 2 / sc, hh = h / 2 / sc;
    const i0 = Math.floor((cx - hw - dx) / G) - 1, i1 = Math.floor((cx + hw - dx) / G) + 1;
    const j0 = Math.floor((cy - hh - dy) / G) - 1, j1 = Math.floor((cy + hh - dy) / G) + 1;
    const diag = Math.hypot(w, h) / 2;
    c.globalCompositeOperation = 'source-over';
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (this.tel.flarden >= MAX) return;
        if (hash(i, j, 81) > 0.3 + 0.4 * dek) continue;
        const wx = (i + hash(i, j, 82)) * G + dx, wy = (j + hash(i, j, 83)) * G + dy;
        const x = (wx - cx) * sc + w / 2, y = (wy - cy) * sc + h / 2;
        const b = G * (0.9 + 0.8 * hash(i, j, 84)) * sc, hb = b / 2;
        if (x + b / 2 < 0 || y + hb / 2 < 0 || x - b / 2 > w || y - hb / 2 > h) continue;
        const rand = smooth(0.25, 0.75, Math.hypot(x - w / 2, y - h / 2) / diag);
        const al = dek * 0.3 * rand * (1 - 0.6 * st.nacht);
        if (al < 0.01) continue;
        c.globalAlpha = al;
        c.drawImage(S[mod(i * 5 + j * 11, 3)], x - b / 2, y - hb / 2, b, hb);
        this.tel.flarden++;
      }
    }
  }

  // Kleine dingen in de lucht, alleen heel diep ingezoomd: bloesemblaadjes in de lente, pluisjes en 's nachts
  // vuurvliegjes in de zomer, tuimelende blaadjes in de herfst. Ze waaien mee met de wind.
  tekenDeeltjes(c, st, nu, a) {
    const sz = st.seizoen, droog = 1 - smooth(0.05, 0.3, st.regen + st.sneeuw);
    const gew = this.gewicht;
    gew[0] = sz.bloei + sz.lente * 0.3; // bloesem
    gew[1] = sz.zomer * st.dagLicht; // pluis
    gew[2] = sz.herfst; // blad
    gew[3] = (sz.zomer + sz.lente * 0.4) * st.nacht; // vuurvlieg
    const t = nu / 1000, geo = this.geo, sc = this.sc, T = this.T, G = DEELTJE;
    const dx = this.drift.x * 0.8, dy = this.drift.y * 0.8;
    const i0 = Math.floor(this.wx0 / G), i1 = Math.floor(this.wx1 / G), j0 = Math.floor(this.wy0 / G), j1 = Math.floor(this.wy1 / G);
    const cellen = ((this.wx1 - this.wx0) / G + 1) * ((this.wy1 - this.wy0) / G + 1);
    for (let s = 0; s < DEELTJESOORTEN.length; s++) {
      const [soort, kleuren] = DEELTJESOORTEN[s], gewicht = gew[s];
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
              const z = (q * 4 + s) * 7 + kl;
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
                const g = Math.max(1, T * (soort === 'blad' ? 0.014 : 0.008));
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
