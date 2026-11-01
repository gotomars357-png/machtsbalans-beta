// Leven op de kaart (P2 van docs/inzoom-spec.md): auto's op de wegen, voetgangers op de stoepen, boten bij de havens,
// zwermen vogels, protesten bij onrust, stakingen bij fabrieken en rook waar gevochten wordt.
// Puur decor: deze laag leest de toestand en schrijft er nooit in. Elke positie is f(zaad, klok), dus er zijn
// geen deeltjeslijsten die groeien. Plaatsing en aantallen komen uit een vaste hash van tegel en volgnummer;
// de tijd stuurt alleen de beweging. Geen Math.random en geen nextRandom.

import { woningCapaciteit } from '../engine/samenleving.js';
import { oorlogenVan } from '../engine/leger.js';

// ---------- gedeelde hulpjes (eigen kopie, zie spec §0) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
// Driehoeksgolf 0 → 1 → 0: heen en weer lopen.
const tri = (v) => 1 - Math.abs(1 - 2 * frac(v));
const TAU = Math.PI * 2;

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
export const PLAFOND = { autos: 120, mensen: 400, boten: 30, vogels: 60, rook: 20, stoom: 10, lichten: 300 };

const AUTO_KLEUREN = ['#d9d9d4', '#f1efe8', '#2a2c30', '#a8322d', '#2f5d8a', '#d9a63a', '#3d6b48', '#7a5236'];
// Eenpartijstaat en militair regime: grijs en olijf, geen vrolijke lak.
const AUTO_GEDEMPT = ['#6e6f6b', '#8a8b85', '#5d6b4a', '#4a4d4f', '#9a978c', '#55603f', '#7b7a70', '#3c3f3a'];
const TRUCK = 16; // kleurindex van legertrucks
const TRUCK_KLEUR = '#5d6b4a';
const KLEDING = ['#c0392b', '#2e86c1', '#f0b429', '#ecefe9', '#34495e', '#2f9e5b'];
const HUID = ['#f1c9a5', '#c68e5d', '#7d5136'];
const SPANDOEK = ['#d9443c', '#f2f2ef'];
const GEDEMPT_REGIME = { eenpartijstaat: true, militair: true };

// Mensen per tegel bij volle bezetting; de hoofdstad is drukker dan een gewone wijk.
const MENSEN_PER_TEGEL = { hoofdstad: 15, woonwijk: 10, kolonie: 6 };
const AUTO_SNELHEID = 1.2; // tegels per seconde
const STOEP = 0.045; // afstand van de stoep tot het hart van de straat, in tegels (straatcontract)
const BAAN = 0.03; // rijstrook naast het hart van de weg, in tegels

// Soort plek per tegel, voor wie er rondloopt.
const LEEG = 0, HOOFD = 1, WOON = 2, KOLONIE = 3, FABRIEK = 4, HAVEN = 5, OVERIG = 6;
// Gebouwen uit andere packs die als fabriek of mijn getekend worden (zelfde lijst als TEKENING_ALIAS in map.js).
const ALIAS = { olieveld: 'centrale', staalfabriek: 'industrie', landbouw: 'boerderij', zware_industrie: 'industrie', ruimtevaartcentrum: 'chipfabriek', spoor: 'opslag' };

// Stride van de buffers (getallen per item).
const WEG = 9; // ax, ay, bx, by, lengte, land, zaad, ux, uy
const AUTO = 6; // sx, sy, hx, hy, kleur, soort (0 auto, 1 truck)
const MENS = 4; // sx, sy, kleding, huid
const BOOT = 6; // sx, sy, hx, hy, soort (0 aangemeerd, 1 varend, 2 zeilboot), romp (0 wit, 1 hout)
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
  return {
    bezetting,
    welvaart,
    oorlog: oorlogenVan(state, c).length > 0,
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
        this.soort[p.t] = tek === 'woonwijk' ? WOON : tek === 'industrie' || tek === 'mijn' ? FABRIEK : g.handel_bonus ? HAVEN : OVERIG;
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
    const s = view.state;
    if (!s || !view.geo || !view.w) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar) this.laad(view);
    this.werkCache(view);
    this.kader(view, sc);
    const z = view.zoom;
    this.zoom = z;
    this.nGevecht = 0;
    this.nachtVorig = view.nacht ?? 0;
    c.save();
    if (z >= 4) { this.verzamelBoten(view, nu); this.tekenBoten(c); }
    if (z >= 3.5) { this.verzamelAutos(); this.tekenAutos(c, smooth(3.5, 4.5, z)); }
    if (z >= 4) this.tekenMenigte(c, nu);
    if (z >= 2) { this.verzamelGevechten(); this.tekenRook(c, nu, smooth(2, 3, z)); }
    if (z >= 2.5 && z <= 11) this.tekenVogels(c, nu, smooth(2.5, 3.5, z) * (1 - smooth(9, 11, z)));
    c.restore();
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

  verzamelAutos() {
    const s = this.state, W = this.wegen, Tw = this.geo.T, sc = this.sc;
    const marge = Tw;
    const nachtKans = 1 - 0.4 * this.nachtVorig;
    const buf = this.auto, MAX = PLAFOND.autos;
    let n = 0;
    // Alleen auto's die echt in beeld rijden tellen mee voor het plafond.
    const mx0 = -20, my0 = -20, mx1 = this.w + 20, my1 = this.h + 20;
    const zet = (wx, wy, hx, hy, kleur, soort) => {
      const x = wx * sc + this.ox, y = wy * sc + this.oy;
      if (x < mx0 || y < my0 || x > mx1 || y > my1) return;
      const o = n * AUTO;
      buf[o] = x; buf[o + 1] = y;
      buf[o + 2] = hx; buf[o + 3] = hy; buf[o + 4] = kleur; buf[o + 5] = soort;
      n++;
    };
    for (let w = 0; w < this.nWegen && n < MAX; w++) {
      const o = w * WEG;
      const ax = W[o], ay = W[o + 1], bx = W[o + 2], by = W[o + 3];
      if ((ax > bx ? ax : bx) < this.wx0 - marge || (ax < bx ? ax : bx) > this.wx1 + marge) continue;
      if ((ay > by ? ay : by) < this.wy0 - marge || (ay < by ? ay : by) > this.wy1 + marge) continue;
      const len = W[o + 4], zaad = W[o + 6] | 0, ux = W[o + 7], uy = W[o + 8];
      const d = levenDichtheid(s, W[o + 5]);
      // Niet over de gebouwen aan de uiteinden rijden: de auto 'verdwijnt' in de garage.
      const rand = Math.min(0.45, (Tw * 0.42) / len), rijd = 1 - 2 * rand;
      const konvooi = d.oorlog && len >= 1.5 * Tw;
      const totaal = clamp(Math.round((len / Tw) * 2 * d.autoFactor), 0, 4);
      const autos = konvooi ? Math.round(totaal * 0.65) : totaal;
      for (let i = 0; i < autos && n < MAX; i++) {
        if (hash(zaad, i, 13) > nachtKans) continue;
        const v = AUTO_SNELHEID * Tw * (0.85 + 0.3 * hash(zaad, i, 5));
        const baan = i & 1 ? -1 : 1;
        let f = frac(this.klok * v / len + hash(zaad, i));
        if (baan < 0) f = 1 - f;
        const p = rand + f * rijd;
        // Rechts rijden: de strook ligt rechts van de rijrichting.
        zet(ax + (bx - ax) * p - baan * uy * BAAN * Tw, ay + (by - ay) * p + baan * ux * BAAN * Tw,
          ux * baan, uy * baan, (d.gedempt ? 8 : 0) + Math.floor(hash(zaad, i, 3) * 8), 0);
      }
      if (konvooi) {
        // Oorlog: een konvooi van drie olijfgroene trucks met vaste tussenruimte.
        const baan = hash(zaad, 7) < 0.5 ? 1 : -1;
        const f0 = frac(this.klok * AUTO_SNELHEID * Tw * 0.75 / len + hash(zaad, 99));
        const stap = (0.25 * Tw) / (len * rijd);
        for (let j = 0; j < 3 && n < MAX; j++) {
          let f = frac(f0 - j * stap);
          if (baan < 0) f = 1 - f;
          const p = rand + f * rijd;
          zet(ax + (bx - ax) * p - baan * uy * BAAN * Tw, ay + (by - ay) * p + baan * ux * BAAN * Tw, ux * baan, uy * baan, TRUCK, 1);
        }
      }
    }
    this.nAuto = n;
  }

  tekenAutos(c, a) {
    const n = this.nAuto, b = this.auto, T = this.T;
    if (!n || a <= 0) return;
    c.globalAlpha = a;
    const L = T * 0.05, B = T * 0.0275; // halve lengte en breedte van een auto (0.10 x 0.055 tegel)
    const TL = T * 0.08, TB = T * 0.035; // truck (0.16 x 0.07 tegel)
    // schaduw
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * AUTO, truck = b[o + 5] === 1;
      rechthoek(c, b[o] + T * 0.01, b[o + 1] + T * 0.014, b[o + 2], b[o + 3], truck ? TL : L, truck ? TB : B);
    }
    c.fill();
    // carrosserie, één pad per kleur
    for (let k = 0; k <= TRUCK; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * AUTO;
        if (b[o + 4] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        if (k === TRUCK) rechthoek(c, b[o], b[o + 1], b[o + 2], b[o + 3], TL, TB);
        else rechthoek(c, b[o], b[o + 1], b[o + 2], b[o + 3], L, B);
      }
      if (open) { c.fillStyle = k === TRUCK ? TRUCK_KLEUR : k < 8 ? AUTO_KLEUREN[k] : AUTO_GEDEMPT[k - 8]; c.fill(); }
    }
    // dak (auto) en laadbak met zeil (truck)
    c.fillStyle = 'rgba(0,0,0,0.24)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * AUTO, hx = b[o + 2], hy = b[o + 3];
      if (b[o + 5] === 1) rechthoek(c, b[o] - hx * T * 0.022, b[o + 1] - hy * T * 0.022, hx, hy, T * 0.055, T * 0.03);
      else rechthoek(c, b[o] - hx * T * 0.006, b[o + 1] - hy * T * 0.006, hx, hy, T * 0.024, T * 0.021);
    }
    c.fill();
    // voorruit, alleen als een auto groot genoeg is om hem te zien
    if (L * 2 >= 9) {
      c.fillStyle = 'rgba(190,215,235,0.75)';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * AUTO;
        if (b[o + 5] === 1) continue;
        rechthoek(c, b[o] + b[o + 2] * T * 0.024, b[o + 1] + b[o + 3] * T * 0.024, b[o + 2], b[o + 3], T * 0.006, T * 0.02);
      }
      c.fill();
    }
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
            const aantal = Math.round((soort === HOOFD ? MENSEN_PER_TEGEL.hoofdstad : MENSEN_PER_TEGEL.woonwijk) * d.mensenFactor * nachtFactor);
            for (let i = 0; i < aantal && this.nMens < MAX; i++) {
              const h = hash(t, i, 1);
              const snel = 0.05 + 0.03 * hash(t, i, 2);
              const pos = tri(this.klok * snel + hash(t, i, 3));
              const stap = (Math.floor(this.klok * 4 + h * 4) % 2) * bob;
              const kant = hash(t, i, 4) < 0.5 ? -1 : 1;
              let a, langs;
              if (soort === HOOFD) {
                // In de hoofdstad staat het regeringsgebouw op de kruising: lopen op de vier armen.
                const arm = Math.floor(h * 4);
                langs = (arm & 1 ? -1 : 1) * (0.24 + pos * 0.25);
                a = arm < 2 ? 0 : 1;
              } else {
                langs = (pos - 0.5) * 0.96;
                a = h < 0.5 ? 0 : 1;
              }
              const dwars = kant * STOEP;
              const kl = Math.floor(hash(t, i, 6) * 6), hu = Math.floor(hash(t, i, 7) * 3);
              if (a === 0) this.zetMens(x + langs * Tw, y + dwars * Tw + stap, kl, hu);
              else this.zetMens(x + dwars * Tw + stap, y + langs * Tw, kl, hu);
            }
          } else if (soort === KOLONIE) {
            // Kolonie: rondlopen over het ringpad.
            const aantal = Math.round(MENSEN_PER_TEGEL.kolonie * d.mensenFactor * nachtFactor);
            for (let i = 0; i < aantal && this.nMens < MAX; i++) {
              const richting = hash(t, i, 2) < 0.5 ? -1 : 1;
              const hoek = this.klok * (0.04 + 0.03 * hash(t, i, 3)) * TAU * richting + hash(t, i, 1) * TAU;
              const straal = (0.38 + (hash(t, i, 4) - 0.5) * 0.03) * Tw;
              this.zetMens(x + Math.cos(hoek) * straal, y + Math.sin(hoek) * straal, Math.floor(hash(t, i, 6) * 6), Math.floor(hash(t, i, 7) * 3));
            }
          } else if (!(soort === FABRIEK && d.staking)) {
            // Andere gebouwen: 2 tot 4 mensen bij de ingang aan de onderkant.
            const ingang = x + (hash(t, 8) - 0.5) * 0.4 * Tw;
            const aantal = 2 + Math.floor(hash(t, 9) * 3);
            const kans = Math.min(1, d.mensenFactor) * nachtFactor;
            for (let i = 0; i < aantal && this.nMens < MAX; i++) {
              if (hash(t, i, 11) > kans) continue;
              const pos = tri(this.klok * (0.07 + 0.04 * hash(t, i, 2)) + hash(t, i, 3));
              this.zetMens(ingang + (pos - 0.5) * 0.14 * Tw, y + (0.455 + (hash(t, i, 4) - 0.5) * 0.03) * Tw, Math.floor(hash(t, i, 6) * 6), Math.floor(hash(t, i, 7) * 3));
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
        const aantal = Math.min(3, Math.round((len / Tw) * 0.8 * d.mensenFactor * nachtFactor));
        const rand = Math.min(0.45, (Tw * 0.45) / len), loop = 1 - 2 * rand;
        for (let i = 0; i < aantal && this.nMens < MAX; i++) {
          const p = rand + loop * tri(this.klok * (0.9 + 0.4 * hash(zaad, i, 31)) * 0.12 * Tw / len + hash(zaad, i, 32));
          const kant = (hash(zaad, i, 33) < 0.5 ? -1 : 1) * 0.075 * Tw;
          const stap = (Math.floor(this.klok * 4 + hash(zaad, i, 34) * 4) % 2) * bob;
          const x = ax + (bx - ax) * p - uy * (kant + stap), y = ay + (by - ay) * p + ux * (kant + stap);
          this.zetMens(x, y, Math.floor(hash(zaad, i, 36) * 6), Math.floor(hash(zaad, i, 37) * 3));
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
    if (nStraat) this.tekenMensen(c, 0, nStraat, straatAlpha);
    if (this.nMens > nStraat) {
      this.tekenMensen(c, nStraat, this.nMens, protestAlpha);
      this.tekenSpandoeken(c, protestAlpha);
    }
    if (this.vaten || this.busjes) this.tekenOnrust(c, nu, protestAlpha);
  }

  // Eén persoon in de buffer; wie buiten beeld loopt telt niet mee voor het plafond.
  zetMens(wx, wy, kleding, huid) {
    const x = wx * this.sc + this.ox, y = wy * this.sc + this.oy;
    if (x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10) return;
    const o = this.nMens++ * MENS, b = this.mens;
    b[o] = x; b[o + 1] = y; b[o + 2] = kleding; b[o + 3] = huid;
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
    c.globalAlpha = a;
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath();
    for (let i = van; i < tot; i++) stip(c, b[i * MENS] + T * 0.004, b[i * MENS + 1] + T * 0.005, r);
    c.fill();
    for (let k = 0; k < KLEDING.length; k++) {
      let open = false;
      for (let i = van; i < tot; i++) {
        const o = i * MENS;
        if (b[o + 2] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        stip(c, b[o], b[o + 1], r);
      }
      if (open) { c.fillStyle = KLEDING[k]; c.fill(); }
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
    c.globalAlpha = 1;
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
    this.nBoot = n;
  }

  tekenBoten(c) {
    const n = this.nBoot, b = this.boot, T = this.T;
    if (!n) return;
    const L = T * 0.06, B = T * 0.025; // romp 0.12 x 0.05 tegel
    // kielzog: een waaier van schuim die achter elke varende boot breder en vager wordt
    c.fillStyle = 'rgba(232,244,250,0.28)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT;
      if (b[o + 4] === 0) continue;
      const hx = b[o + 2], hy = b[o + 3];
      const sx = b[o] - hx * L * 0.7, sy = b[o + 1] - hy * L * 0.7;
      c.moveTo(sx - hy * B, sy + hx * B);
      c.lineTo(sx - hx * T * 0.13 - hy * T * 0.05, sy - hy * T * 0.13 + hx * T * 0.05);
      c.lineTo(sx - hx * T * 0.13 + hy * T * 0.05, sy - hy * T * 0.13 - hx * T * 0.05);
      c.lineTo(sx + hy * B, sy - hx * B);
      c.closePath();
    }
    c.fill();
    // schaduw op het water
    c.fillStyle = 'rgba(0,18,30,0.3)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT;
      const hoek = Math.atan2(b[o + 3], b[o + 2]);
      c.moveTo(b[o] + T * 0.008 + Math.cos(hoek) * L, b[o + 1] + T * 0.01 + Math.sin(hoek) * L);
      c.ellipse(b[o] + T * 0.008, b[o + 1] + T * 0.01, L, B, hoek, 0, TAU);
    }
    c.fill();
    for (let k = 0; k < 2; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * BOOT;
        if (b[o + 5] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        const hoek = Math.atan2(b[o + 3], b[o + 2]);
        c.moveTo(b[o] + Math.cos(hoek) * L, b[o + 1] + Math.sin(hoek) * L);
        c.ellipse(b[o], b[o + 1], L, B, hoek, 0, TAU);
      }
      if (open) { c.fillStyle = k ? '#8a5a34' : '#eef0ee'; c.fill(); }
    }
    // stuurhut of kajuit
    c.fillStyle = 'rgba(45,55,65,0.6)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT;
      if (b[o + 4] === 2) continue;
      rechthoek(c, b[o] - b[o + 2] * T * 0.012, b[o + 1] - b[o + 3] * T * 0.012, b[o + 2], b[o + 3], T * 0.016, T * 0.013);
    }
    c.fill();
    // zeilen: een roomwitte driehoek die naar één kant bolt
    c.fillStyle = '#fbf6e6';
    c.strokeStyle = 'rgba(40,50,60,0.35)';
    c.lineWidth = Math.max(0.5, T * 0.004);
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT;
      if (b[o + 4] !== 2) continue;
      const x = b[o], y = b[o + 1], hx = b[o + 2], hy = b[o + 3];
      c.moveTo(x + hx * T * 0.04, y + hy * T * 0.04);
      c.lineTo(x - hx * T * 0.045 - hy * T * 0.05, y - hy * T * 0.045 + hx * T * 0.05);
      c.lineTo(x - hx * T * 0.045, y - hy * T * 0.045);
      c.closePath();
    }
    c.fill();
    c.stroke();
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
  tekenRook(c, nu, a) {
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
    for (let licht = 0; licht < 2; licht++) {
      for (let band = 0; band < 3; band++) {
        let open = false;
        for (let i = 0; i < n; i++) {
          const o = i * ROOK;
          const isLicht = b[o + 3] < 0;
          if (isLicht !== (licht === 1)) continue;
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
        if (open) { c.fillStyle = licht ? `rgba(228,228,226,${BANDEN[band] * 0.7})` : `rgba(72,68,64,${BANDEN[band]})`; c.fill(); }
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

  // ---------- lichten (na de nachtlaag) ----------

  // Straatlantaarns, koplampen en achterlichten, en een toplicht op elke boot. Gebruikt de auto's en boten
  // die teken() deze frame al heeft verzameld.
  tekenLichten(c, view, sc, nu) {
    this.nLicht = 0;
    const nacht = view.nacht ?? 0;
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
        const l = b[o + 5] === 1 ? T * 0.08 : T * 0.05, w = T * 0.018;
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
          const l = b[o + 5] === 1 ? T * 0.08 : T * 0.05;
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
        const l = b[o + 5] === 1 ? T * 0.08 : T * 0.05;
        c.drawImage(this.roodSprite, b[o] - hx * l - rr, b[o + 1] - hy * l - rr, rr * 2, rr * 2);
        n++;
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
    c.restore();
    this.nLicht = n;
    void nu;
  }

  // Wat er deze frame getekend is (voor de test en om te meten).
  telling() {
    return { autos: this.nAuto, mensen: this.nMens, boten: this.nBoot, vogels: this.nVogel, rook: this.nGevecht ?? 0, stoom: this.nStoom, lichten: this.nLicht };
  }
}
