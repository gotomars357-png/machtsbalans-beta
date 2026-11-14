// Kaartweergave met zoom en pan. Uitgezoomd is het een strategische kaart (blokken, routes, loyaliteit);
// ingezoomd zie je terrein, vakjes, gebouwen en het wegennet (wegennet.js) waarop het verkeer rijdt.
// Grenzen en vakjes komen uit src/engine/geografie.js, dus de kaart toont precies wat de bouwregels gebruiken.
// Eén klok: teken() bepaalt één keer per beeld `nu` en geeft die aan alle lagen.

import { tegelOp } from '../engine/geografie.js';
import { woningCapaciteit } from '../engine/samenleving.js';
import { tekenGebouwDetail } from './detail.js';
import { TerreinLaag } from './terrein.js';
import { zoekPad } from '../engine/leger.js';
import { tekenUitval, tekenCyberFlits, CYBER_KLEUR } from './cyber.js';
import { LevenLaag } from './leven.js';
import { InfraLaag } from './infra.js';
import { SfeerLaag } from './sfeer.js';
import { TroepenLaag } from './troepen.js';
import { NatuurLaag } from './natuur.js';
import { KustLaag } from './kust.js';
import { GrensLaag } from './grens.js';
import { StadLaag } from './stad.js';
import { ZeeLaag } from './zee.js';
import { WerkLaag } from './werk.js';
import { HemelLaag } from './hemel.js';
import { Wegennet, KLASSE, KNOOP, PROFIEL, verkeersTijd } from './wegennet.js';

// Vanaf deze zoom tekent de kaart vakjes als echte plekken: huizen, akkers, fabrieken, bomen.
const DIEP = 4;
// Vanaf MINI tekenen de gebouwen al als verkleinde tekening (met tot DIEP een klein merkje erop), zodat de middenzoom
// een stad laat zien in plaats van vakjes.
const MINI = 2.5;
// Gebouwen uit andere packs met een vergelijkbare functie hergebruiken een bestaande tekening.
const TEKENING_ALIAS = { olieveld: 'centrale', staalfabriek: 'industrie', landbouw: 'boerderij', zware_industrie: 'industrie', ruimtevaartcentrum: 'chipfabriek', spoor: 'opslag' };
// cybercentrum heeft een eigen tekening in detail.js.
// Pauze stopt het spel, niet het straatleven (net als dag en nacht). Op true staat de wereldklok stil zolang het spel
// stilstaat: verkeer, lichten en dagdeel lopen dan pas verder als het spel weer loopt.
export const PAUZE_STOPT_WERELD = false;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export class KaartView {
  constructor(canvas, wrap, opties) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.opties = opties;
    this.geselecteerd = -1;
    this.hover = -1;
    this.hoverTegel = -1;
    this.bouwModus = null;
    this.bouwStatus = null;
    this.zoom = 1;
    this.cx = 500;
    this.cy = 310;
    this.doel = null;
    this.animTijd = 0;
    this.handtekening = '';
    this.golven = [];
    this.routes = [];
    this.routeSig = '';
    this.gloed = null; // tutorial- of doelgloed: { t }
    this.lichtSprite = maakGloed();
    this.wolk = maakWolk();
    this.terreinLaag = new TerreinLaag();
    this.levenLaag = new LevenLaag();
    this.infraLaag = new InfraLaag();
    this.sfeerLaag = new SfeerLaag();
    this.troepenLaag = new TroepenLaag();
    this.natuurLaag = new NatuurLaag();
    this.kustLaag = new KustLaag();
    this.grensLaag = new GrensLaag();
    this.stadLaag = new StadLaag();
    this.zeeLaag = new ZeeLaag();
    this.werkLaag = new WerkLaag();
    this.hemelLaag = new HemelLaag();
    this.wegennet = new Wegennet();
    this.wegennetDebug = false; // tekent klassen, knopen en poorten van het net over alles heen
    this.bron = document.createElement('canvas');
    this.bron.width = 1000;
    this.bron.height = 620;

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      this.zoomRond(e.offsetX, e.offsetY, this.zoom * f);
    }, { passive: false });
    // Aanraken: één vinger schuift en tikt, twee vingers knijpen om te zoomen,
    // lang drukken werkt als rechtsklik (eenheden sturen, bouwen annuleren).
    this.vingers = new Map();
    this.knijp = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      this.vingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      clearTimeout(this.langDruk);
      if (this.vingers.size === 2) {
        this.sleep = null;
        const [mx, my] = this.vingerMidden();
        this.knijp = { afstand: this.vingerAfstand(), zoom: this.zoom, wereld: this.naarWereld(mx, my) };
        return;
      }
      if (this.vingers.size > 2) return;
      this.sleep = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, bewogen: false, gebied: e.shiftKey && !this.bouwModus, shift: e.shiftKey };
      if (e.pointerType === 'touch') {
        this.laatsteAanraking = Date.now();
        // Lang drukken: in bouwmodus annuleren; anders een selectievak dat je trekt door te slepen.
        // Laat je los zonder te slepen, dan werkt het als rechtsklik.
        this.langDruk = setTimeout(() => {
          if (!this.sleep || this.sleep.bewogen || this.vingers.size !== 1) return;
          if (this.bouwModus) { this.sleep = null; this.rechts(e); return; }
          this.sleep.gebied = true;
          this.sleep.lang = true;
          navigator.vibrate?.(15);
        }, 550);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.vingers.has(e.pointerId)) this.vingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.knijp) {
        if (this.vingers.size >= 2) {
          // Het punt onder je vingers blijft onder je vingers: knijpen zoomt, samen bewegen schuift.
          const [mx, my] = this.vingerMidden();
          const [wx, wy] = this.knijp.wereld;
          this.zoom = clamp(this.knijp.zoom * this.vingerAfstand() / this.knijp.afstand, 1, 14);
          const sc = this.schaal();
          this.cx = wx - (mx - this.w / 2) / sc;
          this.cy = wy - (my - this.h / 2) / sc;
          this.doel = null;
          this.begrens();
        }
        return;
      }
      if (this.sleep?.gebied) {
        const r = this.canvas.getBoundingClientRect();
        this.sleep.bewogen = Math.abs(e.clientX - this.sleep.x) + Math.abs(e.clientY - this.sleep.y) > 5;
        this.kader = { x0: this.sleep.x - r.left, y0: this.sleep.y - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top };
      } else if (this.sleep) {
        const dx = e.clientX - this.sleep.x, dy = e.clientY - this.sleep.y;
        if (Math.abs(dx) + Math.abs(dy) > 5 && !this.sleep.bewogen) {
          this.sleep.bewogen = true;
          // Schuiven met een vinger: de vaste tooltip hoort bij een plek die nu verschuift.
          if (e.pointerType === 'touch') this.opties.onHover(-1, -1);
        }
        if (this.sleep.bewogen) {
          const s = this.schaal();
          this.cx = this.sleep.cx - dx / s;
          this.cy = this.sleep.cy - dy / s;
          this.doel = null;
          this.begrens();
        }
      }
      // Op touch geen hover: de tooltip komt bij een tik en blijft staan tot de volgende.
      if (e.pointerType !== 'touch') this.beweeg(e);
    });
    const loslaten = (e) => {
      this.vingers.delete(e.pointerId);
      clearTimeout(this.langDruk);
      if (this.knijp) {
        // Na knijpen geen tik en geen schuiven met de overgebleven vinger.
        if (!this.vingers.size) this.knijp = null;
        this.sleep = null;
        return true;
      }
      return false;
    };
    canvas.addEventListener('pointercancel', (e) => { loslaten(e); this.sleep = null; this.kader = null; });
    canvas.addEventListener('pointerup', (e) => {
      if (loslaten(e)) return;
      const sl = this.sleep;
      this.sleep = null;
      if (sl?.gebied && sl.bewogen && this.kader) {
        const k = this.kader;
        const [ax, ay] = this.naarWereld(Math.min(k.x0, k.x1), Math.min(k.y0, k.y1));
        const [bx, by] = this.naarWereld(Math.max(k.x0, k.x1), Math.max(k.y0, k.y1));
        this.kader = null;
        this.opties.onGebied(ax, ay, bx, by, true);
        return;
      }
      this.kader = null;
      if (sl?.lang && !sl.bewogen) { this.rechts(e); return; }
      if (sl && !sl.bewogen) {
        this.klik(e, sl.shift);
        if (e.pointerType === 'touch') {
          // Opent de tik een contextpaneel, dan geen tooltip eroverheen.
          if (this.wrap.querySelector('.context:not([hidden])')) this.opties.onHover(-1, -1);
          else this.beweeg(e);
        }
      }
    });
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      this.hover = -1; this.hoverTegel = -1; this.opties.onHover(-1, -1); });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Op een touchscreen doet het lang-drukken dit al; niet dubbel uitvoeren.
      if (Date.now() - (this.laatsteAanraking ?? 0) < 1500) return;
      this.rechts(e);
    });
    new ResizeObserver(() => this.pasAan()).observe(wrap);
  }

  rechts(e) {
    if (this.bouwModus) { this.opties.onAnnuleer?.(); return; }
    const [wx, wy] = this.muisWereld(e);
    this.opties.onRechtsklik?.(tegelOp(this.geo, wx, wy));
  }

  vingerMidden() {
    const r = this.canvas.getBoundingClientRect();
    const [a, b] = [...this.vingers.values()];
    return [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
  }

  vingerAfstand() {
    const [a, b] = [...this.vingers.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  laad(state) {
    this.state = state;
    this.geo = state.pack.geo;
    const W = 1000, H = 620;
    const eigenaar = new Int16Array(W * H);
    const schaduw = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        eigenaar[i] = this.geo.eigenaarOp(x + 0.5, y + 0.5);
        schaduw[i] = this.geo.ruis(x * 0.05 + 100, y * 0.05 + 100);
      }
    }
    this.eigenaar = eigenaar;
    this.schaduw = schaduw;
    const som = state.landen.map(() => ({ x: 0, y: 0, n: 0 }));
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const e = eigenaar[y * W + x];
        if (e >= 0) { som[e].x += x; som[e].y += y; som[e].n += 1; }
      }
    }
    this.midden = som.map((s) => (s.n ? { x: s.x / s.n, y: s.y / s.n } : null));
    this.beeld = this.bron.getContext('2d').createImageData(W, H);
    this.handtekening = '';
    this.zoom = 1;
    this.cx = 500;
    this.cy = 310;
    this.doel = null;
    this.pasAan();
    const b = this.wereldBeeld();
    this.zoom = b.zoom;
    this.cx = b.x;
    this.begrens();
    this.terreinLaag.laad(this);
    this.wegennet.laad(this);
    this.levenLaag.laad(this);
    this.infraLaag.laad(this);
    this.sfeerLaag.laad(this);
    this.natuurLaag.laad(this);
    this.kustLaag.laad(this);
    this.grensLaag.laad(this);
    this.stadLaag.laad(this);
    this.zeeLaag.laad(this);
    this.werkLaag.laad(this);
    this.hemelLaag.laad(this);
    this.ligplek = null;
  }

  // Het overzichtsbeeld. Staand vult de brede kaart de hoogte, met je eigen land in beeld;
  // liggend past de hele wereld.
  wereldBeeld() {
    if (!this.w || this.h <= this.w) return { x: 500, y: 310, zoom: 1 };
    const zoom = clamp((this.h / 620) / (this.w / 1000), 1, 14);
    const halfW = this.w / 2 / (Math.min(this.w / 1000, this.h / 620) * zoom);
    const t = this.geo.tegels[this.geo.hoofdstad[this.state.speler]];
    return { x: clamp(t ? t.x : 500, halfW, 1000 - halfW), y: 310, zoom };
  }

  // Echte tijd in ms, voor werkbudgetten (het net bouwt in plakken); niet voor beweging of dagfase.
  tijdMs() { return performance.now(); }

  // De klok van dit beeld (ms), gezet door teken(). Zolang er nog geen beeld getekend is (ook in tests die een losse
  // tekenfunctie aanroepen op een kaartview zonder constructor) geldt de echte klok, net als vroeger.
  get nu() { return this._nu ?? performance.now(); }
  set nu(v) { this._nu = v; }
  // De echte tijd van dit beeld, voor de bediening (doelmarker, tutorialgloed): die loopt ook als de wereld stilstaat.
  get echtNu() { return this._echtNu ?? performance.now(); }
  set echtNu(v) { this._echtNu = v; }

  // De klok van dit beeld: echte tijd, of bij PAUZE_STOPT_WERELD een klok die op pauze stilstaat.
  klokVan(tempo) {
    const echt = performance.now();
    this.echtNu = echt;
    if (!PAUZE_STOPT_WERELD) return echt;
    if (this._echtVorig == null) this._wereldNu = echt;
    else if (tempo > 0) this._wereldNu += echt - this._echtVorig;
    this._echtVorig = echt;
    return this._wereldNu;
  }

  // ---------- camera ----------

  pasAan() {
    const r = this.wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.canvas.width = Math.floor(r.width * dpr);
    this.canvas.height = Math.floor(r.height * dpr);
    this.dpr = dpr;
    this.begrens();
  }

  schaal() { return Math.min(this.w / 1000, this.h / 620) * this.zoom; }
  naarScherm(x, y) { const s = this.schaal(); return [(x - this.cx) * s + this.w / 2, (y - this.cy) * s + this.h / 2]; }
  naarWereld(sx, sy) { const s = this.schaal(); return [(sx - this.w / 2) / s + this.cx, (sy - this.h / 2) / s + this.cy]; }

  begrens() {
    if (!this.w) return;
    const s = this.schaal();
    const halfW = this.w / 2 / s, halfH = this.h / 2 / s;
    this.cx = halfW >= 500 ? 500 : clamp(this.cx, halfW, 1000 - halfW);
    this.cy = halfH >= 310 ? 310 : clamp(this.cy, halfH, 620 - halfH);
  }

  zoomRond(sx, sy, nieuw) {
    const [wx, wy] = this.naarWereld(sx, sy);
    this.zoom = clamp(nieuw, 1, 14);
    const s = this.schaal();
    this.cx = wx - (sx - this.w / 2) / s;
    this.cy = wy - (sy - this.h / 2) / s;
    this.doel = null;
    this.begrens();
  }

  vliegNaar(x, y, zoom) { this.doel = { x, y, zoom }; }

  naarLand(idx, zoom = 3) {
    const h = this.geo.hoofdstad[idx];
    const t = this.geo.tegels[h];
    if (t) this.vliegNaar(t.x, t.y, zoom);
  }

  // ---------- invoer ----------

  muisWereld(e) {
    const r = this.canvas.getBoundingClientRect();
    return this.naarWereld(e.clientX - r.left, e.clientY - r.top);
  }

  landOp(wx, wy) {
    const x = Math.floor(wx), y = Math.floor(wy);
    if (!this.eigenaar || x < 0 || y < 0 || x >= 1000 || y >= 620) return -1;
    return this.effectief(x, y, this.eigenaar[y * 1000 + x]);
  }

  // Na verovering hoort een vakje bij een ander land dan de oorspronkelijke grens zegt.
  effectief(x, y, e) {
    const t = Math.floor(y / this.geo.T) * this.geo.kol + Math.floor(x / this.geo.T);
    const nu = this.state.eigenaar[t];
    return nu !== this.geo.tegels[t].eig && e >= 0 && nu >= 0 ? nu : e;
  }

  eenheidOp(wx, wy, alleenLand = null) {
    let best = null, bd = this.geo.T * 0.6;
    for (const u of this.state.eenheden) {
      if (alleenLand != null && u.land !== alleenLand) continue;
      this.eenheidWereld(u, 1);
      const d = Math.hypot(this.ewx - wx, this.ewy - wy);
      if (d < bd) { bd = d; best = u.id; }
    }
    return best;
  }

  beweeg(e) {
    const [wx, wy] = this.muisWereld(e);
    this.hover = this.landOp(wx, wy);
    this.hoverTegel = tegelOp(this.geo, wx, wy);
    this.hoverEenheid = this.eenheidOp(wx, wy);
    const r = this.wrap.getBoundingClientRect();
    this.opties.onHover(this.hover, this.hoverTegel, e.clientX - r.left, e.clientY - r.top);
  }

  klik(e, shift) {
    const [wx, wy] = this.muisWereld(e);
    const t = tegelOp(this.geo, wx, wy);
    if (this.bouwModus) { this.opties.onPlaats(t); return; }
    const eigen = this.eenheidOp(wx, wy, this.state.speler);
    if (eigen != null) { this.opties.onKlikEenheid(eigen, shift); return; }
    if (this.selectie?.size && !shift) { this.selectie.clear(); }
    const r = this.wrap.getBoundingClientRect();
    this.opties.onSelect(this.landOp(wx, wy), t, e.clientX - r.left, e.clientY - r.top);
  }

  // ---------- tekenen ----------

  // Woningcapaciteit per land, één keer per dag berekend (voor het bouwniveau van woonwijk en hoofdstad).
  woningenVan(land) {
    const s = this.state;
    if (this._woningDag !== s.dag || this._woningState !== s) { this._woningDag = s.dag; this._woningState = s; this._woningen = []; }
    return (this._woningen[land.idx] ??= woningCapaciteit(s, land));
  }

  kleurVan(c) {
    const s = this.state;
    if (c.alignment && c.alignment !== 'zwevend') return s.blokken.find((b) => b.id === c.alignment).kleur;
    return s.pack.zwevend.kleur;
  }

  tekenBasis() {
    const s = this.state;
    const W = 1000, H = 620;
    const d = this.beeld.data;
    const kleurTekst = s.landen.map((c) => this.kleurVan(c));
    const kleuren = kleurTekst.map(hex);
    const NEUTRAAL = [92, 104, 82];
    const kleurVan = (e) => (e === -2 ? NEUTRAAL : kleuren[e]);
    const tekstVan = (e) => (e === -2 ? 'neutraal' : kleurTekst[e]);
    const donker = [22, 30, 38];
    const zee = [16, 44, 66];
    const geo = this.geo;
    const eig = this.eigenaar.slice();
    for (const t of geo.tegels) {
      const nu = s.eigenaar[t.i];
      if (nu === t.eig || nu === -1) continue;
      // veroverd of gekoloniseerd vakje: alle landpixels binnen het vakje krijgen de nieuwe eigenaar
      for (let y = t.r * geo.T; y < Math.min(H, (t.r + 1) * geo.T); y++) {
        for (let x = t.k * geo.T; x < Math.min(W, (t.k + 1) * geo.T); x++) if (eig[y * W + x] !== -1) eig[y * W + x] = nu;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const e = eig[i];
        const p = i * 4;
        const sh = this.schaduw[i];
        if (e === -1) {
          const kust = (x > 0 && eig[i - 1] !== -1) || (x < W - 1 && eig[i + 1] !== -1) || (y > 0 && eig[i - W] !== -1) || (y < H - 1 && eig[i + W] !== -1);
          const f = 0.85 + sh * 0.3;
          d[p] = zee[0] * f + (kust ? 40 : 0);
          d[p + 1] = zee[1] * f + (kust ? 55 : 0);
          d[p + 2] = zee[2] * f + (kust ? 60 : 0);
          d[p + 3] = 255;
          continue;
        }
        const k = kleurVan(e);
        const mix = e === this.geselecteerd ? 0.78 : e === -2 ? 0.75 : 0.55;
        const f = 0.82 + sh * 0.3;
        let r = (donker[0] + (k[0] - donker[0]) * mix) * f;
        let g = (donker[1] + (k[1] - donker[1]) * mix) * f;
        let b = (donker[2] + (k[2] - donker[2]) * mix) * f;
        const rechts = x < W - 1 ? eig[i + 1] : e;
        const onder = y < H - 1 ? eig[i + W] : e;
        const links = x > 0 ? eig[i - 1] : e;
        const boven = y > 0 ? eig[i - W] : e;
        if ((rechts !== e && rechts !== -1) || (onder !== e && onder !== -1)) {
          const zelfdeBlok = (rechts !== -1 && rechts !== e && tekstVan(rechts) === tekstVan(e)) || (onder !== -1 && onder !== e && tekstVan(onder) === tekstVan(e));
          const f2 = zelfdeBlok ? 0.6 : 0.3;
          r *= f2; g *= f2; b *= f2;
        } else if (links === -1 || rechts === -1 || boven === -1 || onder === -1) {
          r = r * 0.7 + 70; g = g * 0.7 + 70; b = b * 0.7 + 60;
        }
        if (e === this.geselecteerd && (rechts !== e || onder !== e || links !== e || boven !== e)) { r = 255; g = 236; b = 180; }
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
      }
    }
    this.bron.getContext('2d').putImageData(this.beeld, 0, 0);
  }

  // Wordt elke frame aangeroepen; dt in seconden, tempo bepaalt hoe snel de vrachtwagens rijden.
  teken(dt = 0, tempo = 0, frac = 1) {
    const s = this.state;
    if (!s || !this.eigenaar || !this.w) return;
    const sig = s.landen.map((c) => c.alignment).join(',') + `|${this.geselecteerd}|${s.speler}|${s.grensVersie}`;
    if (sig !== this.handtekening) { this.tekenBasis(); this.handtekening = sig; }
    this.animTijd += dt * Math.min(tempo, 4);

    if (this.doel) {
      const k = 1 - Math.pow(0.002, dt);
      this.cx += (this.doel.x - this.cx) * k;
      this.cy += (this.doel.y - this.cy) * k;
      this.zoom += (this.doel.zoom - this.zoom) * k;
      if (Math.abs(this.doel.zoom - this.zoom) < 0.01 && Math.abs(this.doel.x - this.cx) < 0.5) this.doel = null;
      this.begrens();
    }

    const c = this.canvas.getContext('2d');
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#10283c';
    c.fillRect(0, 0, this.w, this.h);
    const sc = this.schaal();
    const [x0, y0] = this.naarScherm(0, 0);
    const nu = this.klokVan(tempo);
    this.nu = nu;
    // eerst de voorzieningen (station, vliegveld, havens), dan het net dat ze aansluit, dan de lagen
    if (this.infraLaag.voorbereid) this.infraLaag.voorbereid(this);
    else if (this.infraLaag.state) this.infraLaag.werkCache(this);
    this.wegennet.werk(this, 3);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.bron, x0, y0, 1000 * sc, 620 * sc);
    this.terreinLaag.teken(c, this, sc, nu);

    const detail = this.zoom >= 1.5;
    this.tekenTerrein(c, sc);
    if (this.bouwModus) this.tekenBouwRaster(c, sc);
    if (detail) this.tekenBebouwing(c, sc);
    this.tekenLeidingenOverzicht(c, sc);
    this.tekenWegen(c, sc);
    this.tekenSpoorOverzicht(c, sc);
    this.infraLaag.teken(c, this, sc, nu, dt, tempo);
    this.kustLaag.teken(c, this, sc, nu, dt, tempo);
    this.zeeLaag.teken(c, this, sc, nu, dt, tempo);
    this.tekenKoopvaardij(c, sc, nu);
    this.stadLaag.teken(c, this, sc, nu, dt, tempo);
    this.tekenGebouwen(c, sc, detail);
    this.grensLaag.teken(c, this, sc, nu, dt, tempo);
    this.levenLaag.teken(c, this, sc, nu, dt, tempo);
    this.werkLaag.teken(c, this, sc, nu, dt, tempo);
    this.natuurLaag.teken(c, this, sc, nu, dt, tempo);
    this.sfeerLaag.tekenGrond(c, this, sc, nu, frac);
    this.tekenEenheden(c, sc, detail, frac);
    this.infraLaag.tekenLucht(c, this, sc, nu);
    this.hemelLaag.teken(c, this, sc, nu, dt, tempo);
    this.tekenNacht(c, sc, nu);
    this.levenLaag.tekenLichten(c, this, sc, nu);
    this.grensLaag.tekenLichten(c, this, sc, nu);
    this.werkLaag.tekenLichten(c, this, sc, nu);
    this.infraLaag.tekenLichten(c, this, sc, nu);
    this.kustLaag.tekenLichten(c, this, sc, nu);
    this.stadLaag.tekenLichten(c, this, sc, nu);
    this.sfeerLaag.tekenLucht(c, this, sc, nu);
    this.hemelLaag.tekenNacht(c, this, sc, nu);
    this.tekenGolven(c, sc, nu);
    if (this.wegennetDebug) this.tekenNetDebug(c, sc);
    this.tekenStrategisch(c, sc);
    this.tekenMarkeringen(c);
  }

  eenheidPositie(u, frac) {
    this.eenheidWereld(u, frac);
    return this.naarScherm(this.ewx, this.ewy);
  }

  // Wereldplek waar een eenheid getekend en aangeklikt wordt (uitkomst in this.ewx, this.ewy). Een kleine vaste
  // spreiding houdt gestapelde eenheden zichtbaar. Een schip dat op een landtegel ligt (net gebouwd in de haven)
  // ligt op het water vóór de kade, niet bovenop de kade en het eigen schip van het havengebouw.
  eenheidWereld(u, frac) {
    const j = this.geo.T * 0.2;
    const ox = (((u.id * 7919) % 7) - 3) / 3 * j;
    const oy = (((u.id * 104729) % 7) - 3) / 3 * j;
    let ax = u.px + ox, ay = u.py + oy, bx = u.x + ox, by = u.y + oy;
    if (this.state.pack.eenhedenIndex[u.type]?.vaart) {
      // aan de ligplaats zonder spreiding: die ligt al per schip een eigen stukje langs de kust
      if (this.ligOpWater(u.px, u.py, u.id)) { ax = this.lwx; ay = this.lwy; }
      if (this.ligOpWater(u.x, u.y, u.id)) { bx = this.lwx; by = this.lwy; }
    }
    this.ewx = ax + (bx - ax) * frac;
    this.ewy = ay + (by - ay) * frac;
  }

  // Koers van een schip dat stil aan een ligplaats ligt: evenwijdig aan de kust (NaN als het niet aan een
  // ligplaats ligt). troepen.js gebruikt dit in plaats van een willekeurige richting.
  ligRichting(u) {
    if (u.x !== u.px || u.y !== u.py || (u.pad && u.pad.length)) return NaN;
    if (!this.state.pack.eenhedenIndex[u.type]?.vaart || !this.ligOpWater(u.x, u.y, u.id)) return NaN;
    return this.lwa;
  }

  // Ligt (x, y) op een landtegel, dan de ligplaats op zee ernaast in this.lwx, this.lwy (true); anders false.
  // Per tegel één keer uitgerekend: richting van de zeetegels eromheen, dan zo ver die kant op dat het
  // grondraster zee zegt. Schepen van verschillende ids liggen een stukje naast elkaar langs de kade.
  ligOpWater(x, y, id) {
    const geo = this.geo, s = this.state, T = geo.T;
    const k = Math.floor(x / T), r = Math.floor(y / T);
    if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) return false;
    const t = r * geo.kol + k;
    if (s.eigenaar[t] === -1) return false;
    const L = this.ligplek ??= new Float32Array(geo.tegels.length * 3).fill(NaN);
    if (Number.isNaN(L[t * 3])) {
      let vx = 0, vy = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
        const kk = k + dk, rr = r + dr;
        if ((dk || dr) && kk >= 0 && rr >= 0 && kk < geo.kol && rr < geo.rij && s.eigenaar[rr * geo.kol + kk] === -1) {
          const w = dk && dr ? 0.5 : 1; vx += dk * w; vy += dr * w;
        }
      }
      const l = Math.hypot(vx, vy), cx = (k + 0.5) * T, cy = (r + 0.5) * T;
      let gx = NaN, gy = NaN;
      if (l > 0.01) {
        vx /= l; vy /= l;
        // vrij van het havengebouw (dat reikt tot een halve tegel van het midden) en met water rondom de romp
        for (let q = 1.0; q <= 1.8; q += 0.1) {
          const px = cx + vx * q * T, py = cy + vy * q * T;
          if (this.zeeOp(px, py) && this.zeeOp(px - vx * 0.25 * T, py - vy * 0.25 * T) && this.zeeOp(px + vx * 0.25 * T, py + vy * 0.25 * T)) { gx = px; gy = py; break; }
        }
      }
      L[t * 3] = gx; L[t * 3 + 1] = gy; L[t * 3 + 2] = l > 0.01 ? Math.atan2(vy, vx) : 0;
    }
    const gx = L[t * 3];
    if (Number.isNaN(gx)) return false;
    // langs de kade (dwars op de waterrichting) een vaste plek per schip
    // langs de kust een vaste plek per schip; valt die op land, dan de middelste plek
    const a = L[t * 3 + 2], gy = L[t * 3 + 1], sx = -Math.sin(a), sy = Math.cos(a);
    const zij = ((id % 5) - 2) * 0.52 * T;
    const ok = zij === 0 || (this.zeeOp(gx + sx * zij, gy + sy * zij) && this.zeeOp(gx + sx * zij * 1.3, gy + sy * zij * 1.3));
    this.lwx = ok ? gx + sx * zij : gx;
    this.lwy = ok ? gy + sy * zij : gy;
    this.lwa = a + Math.PI / 2;
    return true;
  }

  zeeOp(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (!this.eigenaar || ix < 0 || iy < 0 || ix >= 1000 || iy >= 620) return true;
    return this.eigenaar[iy * 1000 + ix] === -1;
  }

  tekenEenheden(c, sc, detail, frac) {
    const s = this.state;
    const T = this.geo.T * sc;
    const straal = detail ? Math.max(5, T * 0.3) : 3.2;
    const posities = new Map();
    for (const u of s.eenheden) posities.set(u.id, this.eenheidPositie(u, frac));
    const nu = this.nu;
    // Ingezoomd worden de rondjes echte troepen (troepen.js); tussen zoom 6 en 7,5 vloeien ze in elkaar over.
    const diep = this.troepenLaag.mengsel(this.zoom);
    if (diep > 0) this.troepenLaag.teken(c, this, sc, nu, frac, posities, diep);
    // gevechtslijnen (diep ingezoomd nemen lichtspoorkogels en inslagen het over)
    if (detail && diep < 1) {
      c.lineWidth = 1.5;
      if (diep > 0) c.globalAlpha = 1 - diep;
      for (const u of s.eenheden) {
        if (!u.vecht || !posities.has(u.doelwit)) continue;
        const [ax, ay] = posities.get(u.id), [bx, by] = posities.get(u.doelwit);
        c.strokeStyle = `rgba(255,${120 + 80 * Math.sin(nu / 90 + u.id)},80,0.7)`;
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
        if (Math.sin(nu / 70 + u.id * 3) > 0.4) {
          c.fillStyle = 'rgba(255,190,90,0.85)';
          c.beginPath(); c.arc(bx + Math.sin(u.id) * T * 0.15, by + Math.cos(u.id) * T * 0.15, Math.max(2, T * 0.1), 0, Math.PI * 2); c.fill();
        }
      }
      if (diep > 0) c.globalAlpha = 1;
    }
    // route van geselecteerde eenheden
    c.setLineDash([4, 4]);
    c.strokeStyle = 'rgba(240,180,41,0.75)';
    c.lineWidth = 1.5;
    for (const u of s.eenheden) {
      if (!this.selectie?.has(u.id) || !u.pad.length) continue;
      const [sx0, sy0] = posities.get(u.id);
      c.beginPath(); c.moveTo(sx0, sy0);
      for (const t of u.pad) { const tg = this.geo.tegels[t]; const [x, y] = this.naarScherm(tg.x, tg.y); c.lineTo(x, y); }
      c.stroke();
    }
    c.setLineDash([]);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const marge = 20 + T * 0.3 * diep;
    for (let i = 0; i < s.eenheden.length; i++) {
      const u = s.eenheden[i];
      const [x, y] = posities.get(u.id);
      if (x < -marge || y < -marge || x > this.w + marge || y > this.h + marge) continue;
      const land = s.landen[u.land];
      const kleur = land.idx === s.speler ? '#f0b429' : this.kleurVan(land);
      const type = s.pack.eenhedenIndex[u.type];
      // echt: hoeveel van deze eenheid als troepen getekend is; ring en balk omsluiten dan de hele formatie
      const echt = diep > 0 ? diep * this.troepenLaag.getekend(i) : 0;
      const r = echt > 0 ? straal + (this.troepenLaag.omvang(u, T) - straal) * echt : straal;
      if (this.selectie?.has(u.id)) {
        c.strokeStyle = '#ffffff'; c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, r + 3, 0, Math.PI * 2); c.stroke();
      }
      if (echt < 1) {
        if (echt > 0) c.globalAlpha = 1 - echt;
        c.fillStyle = detail ? 'rgba(10,15,21,0.92)' : kleur;
        c.strokeStyle = detail ? kleur : 'rgba(5,10,15,0.9)';
        c.lineWidth = detail ? 2 : 1;
        c.beginPath(); c.arc(x, y, straal, 0, Math.PI * 2); c.fill(); c.stroke();
        if (detail) {
          c.font = `${Math.round(straal * 1.15)}px ${EMOJI}`;
          c.fillText(type.icoon ?? '●', x, y + 1);
        }
        if (echt > 0) c.globalAlpha = 1;
      }
      if (u.hp < type.hp && detail) {
        const w = r * 2 * (1 - 0.4 * echt), bx = x - w / 2;
        c.fillStyle = '#0c131b'; c.fillRect(bx, y - r - 5, w, 3);
        c.fillStyle = u.hp / type.hp > 0.5 ? '#5fd38d' : u.hp / type.hp > 0.25 ? '#f0b429' : '#f2706a';
        c.fillRect(bx, y - r - 5, w * Math.max(0, u.hp / type.hp), 3);
      }
      if (u.bezig && detail) {
        c.strokeStyle = '#f0b429'; c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, r + 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, u.bezig / 6)); c.stroke();
      }
    }
  }

  // ---------- levende wereld ----------

  // Dag en nacht: puur visueel, een cyclus van drie minuten. 's Nachts gaan de lichten aan in steden en fabrieken.
  tekenNacht(c, sc, nu) {
    const fase = (nu / 1000 % 180) / 180;
    const licht = 0.5 + 0.5 * Math.cos(fase * Math.PI * 2);
    const nacht = clamp((0.5 - licht) / 0.5, 0, 1);
    this.nacht = nacht;
    if (nacht <= 0.01) return;
    c.fillStyle = `rgba(4,8,26,${nacht * 0.45})`;
    c.fillRect(0, 0, this.w, this.h);
    const s = this.state;
    const T = this.geo.T * sc;
    c.save();
    c.globalCompositeOperation = 'lighter';
    // Ingezoomd geven lantaarns, koplampen en ramen het licht; de brede gloed wijkt dan, anders wordt de stad één witte vlek.
    const diepte = clamp((this.zoom - 4) / 4, 0, 1);
    const demp = 1 - 0.7 * diepte * diepte * (3 - 2 * diepte);
    const gloei = (t, schaal, sterkte) => {
      const tg = this.geo.tegels[t];
      if (!tg || !this.zichtbaar(tg, 2)) return;
      const [x, y] = this.naarScherm(tg.x, tg.y);
      const r = Math.max(3, T * schaal);
      c.globalAlpha = nacht * sterkte * demp;
      c.drawImage(this.lichtSprite, x - r, y - r, r * 2, r * 2);
    };
    for (const land of s.landen) {
      gloei(this.geo.hoofdstad[land.idx], 0.9 + land.L / 120, 0.9);
      for (const p of land.plaatsingen) {
        const g = s.pack.gebouwIndex[p.g];
        if (g.woningen) gloei(p.t, 0.7, 0.75);
        else if (g.kapitaalvoorraad || g.handel_bonus || g.categorie === 'maatschappij') gloei(p.t, 0.45, 0.5);
      }
    }
    for (const k of s.kolonies) gloei(k.t, 0.5, 0.6);
    c.restore();
  }

  // Koopvaardij tussen havens: puur decor, routes over water berekend met dezelfde padvinder als het leger.
  tekenKoopvaardij(c, sc, nu) {
    const s = this.state;
    const havens = [];
    for (const land of s.landen) for (const p of land.plaatsingen) if (s.pack.gebouwIndex[p.g].handel_bonus) havens.push(p.t);
    const sig = havens.join(',');
    if (sig !== this.routeSig) {
      this.routeSig = sig;
      this.routes = [];
      const water = (t) => {
        const tg = this.geo.tegels[t];
        for (let d = 1; d <= 2; d++) for (let dr = -d; dr <= d; dr++) for (let dk = -d; dk <= d; dk++) {
          const i = (tg.r + dr) * this.geo.kol + tg.k + dk;
          if (this.geo.tegels[i]?.terrein === 'water') return i;
        }
        return -1;
      };
      const punten = havens.map(water).filter((t) => t >= 0);
      for (let i = 0; i < punten.length && this.routes.length < 12; i++) {
        for (let j = i + 1; j < punten.length && this.routes.length < 12; j++) {
          if ((i * 7 + j * 3) % 3) continue;
          const pad = zoekPad(s, 0, punten[i], punten[j], { vaart: true });
          if (pad && pad.length > 4) this.routes.push([punten[i], ...pad]);
        }
      }
    }
    if (!this.routes.length) return;
    const T = this.geo.T * sc;
    this.routes.forEach((route, i) => {
      const n = route.length - 1;
      const f = ((nu / 1000) * 0.6 / n + i * 0.37) % 2;
      const pos = (f < 1 ? f : 2 - f) * n;
      const a = this.geo.tegels[route[Math.floor(pos)]], b = this.geo.tegels[route[Math.min(n, Math.floor(pos) + 1)]];
      const k = pos - Math.floor(pos);
      const [x, y] = this.naarScherm(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
      if (x < -20 || y < -20 || x > this.w + 20 || y > this.h + 20) return;
      const hoek = Math.atan2(b.y - a.y, b.x - a.x) + (f < 1 ? 0 : Math.PI);
      const l = Math.max(4, T * 0.35);
      c.save();
      c.translate(x, y);
      c.rotate(hoek);
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.beginPath(); c.moveTo(-l * 1.6, -l * 0.35); c.lineTo(-l * 0.5, 0); c.lineTo(-l * 1.6, l * 0.35); c.fill();
      c.fillStyle = '#e8e2d4';
      c.beginPath(); c.ellipse(0, 0, l * 0.55, l * 0.2, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = ['#c0392b', '#2e86c1', '#f0b429'][i % 3];
      c.fillRect(-l * 0.25, -l * 0.12, l * 0.35, l * 0.24);
      c.restore();
    });
  }

  // Mediagolven en diplomatieke acties: een boog van zender naar doel, met ringen bij aankomst.
  tekenGolven(c, sc, nu) {
    const s = this.state;
    for (const a of s.animaties.splice(0)) this.golven.push({ ...a, start: nu });
    this.golven = this.golven.filter((g) => nu - g.start < 2600);
    const kleuren = { nepnieuws: '#f2706a', belang: '#c38fff', verdediging: '#5fd38d', propaganda: '#f0b429', aansluiting: '#ffffff', ultimatum: '#ff9f43', cyber: CYBER_KLEUR };
    for (const g of this.golven) {
      const A = this.geo.tegels[this.geo.hoofdstad[g.van]], B = this.geo.tegels[this.geo.hoofdstad[g.naar]];
      if (!A || !B) continue;
      const kleur = kleuren[g.soort] ?? '#ffffff';
      const f = (nu - g.start) / 2600;
      const [ax, ay] = this.naarScherm(A.x, A.y);
      const [bx, by] = this.naarScherm(B.x, B.y);
      c.save();
      c.globalAlpha = 1 - Math.max(0, f - 0.7) / 0.3;
      if (g.van !== g.naar) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2 - Math.hypot(bx - ax, by - ay) * 0.25;
        c.strokeStyle = kleur;
        c.lineWidth = 2;
        c.setLineDash([6, 6]);
        c.lineDashOffset = -nu / 30;
        c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo(mx, my, bx, by); c.stroke();
        c.setLineDash([]);
        const k = Math.min(1, f * 1.6);
        const px = (1 - k) * (1 - k) * ax + 2 * (1 - k) * k * mx + k * k * bx;
        const py = (1 - k) * (1 - k) * ay + 2 * (1 - k) * k * my + k * k * by;
        c.fillStyle = kleur;
        c.beginPath(); c.arc(px, py, 4, 0, Math.PI * 2); c.fill();
      }
      if (f > 0.5 || g.van === g.naar) {
        const r = ((Math.max(0, f - 0.5) % 0.25) * 4);
        for (let i = 0; i < 3; i++) {
          c.strokeStyle = kleur;
          c.lineWidth = 2;
          c.globalAlpha = Math.max(0, 0.8 - (r + i * 0.3) % 1) * (1 - f);
          c.beginPath(); c.arc(bx, by, Math.max(1, 8 + ((r + i * 0.3) % 1) * 30), 0, Math.PI * 2); c.stroke();
        }
      }
      c.restore();
      // Cyber: storingsflits boven het getroffen gebouw (of de hoofdstad).
      if (g.soort === 'cyber' && f > 0.45) {
        const doel = g.tegel >= 0 ? this.geo.tegels[g.tegel] : B;
        const [fx, fy] = this.naarScherm(doel.x, doel.y);
        tekenCyberFlits(c, fx, fy, this.geo.T * sc, (f - 0.45) / 0.55, g.gelukt);
      }
    }
  }

  tekenMarkeringen(c) {
    this.tekenGloed(c);
    if (this.kader) {
      const k = this.kader;
      c.strokeStyle = '#f0b429'; c.lineWidth = 1;
      c.fillStyle = 'rgba(240,180,41,0.1)';
      c.fillRect(Math.min(k.x0, k.x1), Math.min(k.y0, k.y1), Math.abs(k.x1 - k.x0), Math.abs(k.y1 - k.y0));
      c.strokeRect(Math.min(k.x0, k.x1), Math.min(k.y0, k.y1), Math.abs(k.x1 - k.x0), Math.abs(k.y1 - k.y0));
    }
    const m = this.doelMarker;
    if (m) {
      const leeftijd = (this.echtNu - m.tijd) / 700;
      if (leeftijd > 1) { this.doelMarker = null; return; }
      const tg = this.geo.tegels[m.t];
      const [x, y] = this.naarScherm(tg.x, tg.y);
      c.strokeStyle = `rgba(240,180,41,${1 - leeftijd})`;
      c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 6 + leeftijd * 14, 0, Math.PI * 2); c.stroke();
    }
  }

  // Tutorialdoel: een pulserende ring met een pijl op een tegel. Ligt de tegel buiten beeld,
  // dan wijst een pijl aan de schermrand ernaartoe.
  tekenGloed(c) {
    const g = this.gloed;
    if (!g) return;
    const tg = this.geo.tegels[g.t];
    if (!tg) return;
    const nu = this.echtNu;
    const [x, y] = this.naarScherm(tg.x, tg.y);
    const binnen = x > 8 && y > 8 && x < this.w - 8 && y < this.h - 8;
    c.save();
    c.fillStyle = '#f0b429';
    if (!binnen) {
      const ex = clamp(x, 28, this.w - 28), ey = clamp(y, 28, this.h - 28);
      const hoek = Math.atan2(y - ey, x - ex);
      const w = 3 + Math.sin(nu / 180) * 3;
      c.translate(ex + Math.cos(hoek) * w, ey + Math.sin(hoek) * w);
      c.rotate(hoek);
      c.beginPath(); c.moveTo(12, 0); c.lineTo(-8, -9); c.lineTo(-4, 0); c.lineTo(-8, 9); c.closePath(); c.fill();
      c.restore();
      return;
    }
    const p = (nu % 1400) / 1400;
    const r = Math.max(10, this.geo.T * this.schaal() * 0.7);
    c.lineWidth = 3;
    c.strokeStyle = `rgba(240,180,41,${(0.9 - p * 0.8).toFixed(3)})`;
    c.beginPath(); c.arc(x, y, r + p * r * 1.2, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 2;
    c.strokeStyle = '#f0b429';
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    const h = r + 8 + Math.sin(nu / 220) * 4;
    c.beginPath(); c.moveTo(x, y - h); c.lineTo(x - 8, y - h - 14); c.lineTo(x + 8, y - h - 14); c.closePath(); c.fill();
    c.restore();
  }

  zichtbaar(t, marge = 1) {
    const [sx, sy] = this.naarScherm(t.x, t.y);
    const m = this.geo.T * this.schaal() * marge;
    return sx > -m && sy > -m && sx < this.w + m && sy < this.h + m;
  }

  tekenTerrein(c, sc) {
    if (this.zoom < 1.7) return;
    if (this.zoom >= DIEP) {
      this.terreinLaag.tekenKenmerken(c, this, sc, this.nu); return;
    }
    const a = clamp((this.zoom - 1.7) / 0.8, 0, 1) * (1 - this.terreinLaag.dekking(this.zoom));
    if (a <= 0) return;
    const T = this.geo.T * sc;
    c.save();
    c.globalAlpha = a;
    for (const t of this.geo.tegels) {
      if (t.terrein === 'water' || !this.zichtbaar(t)) continue;
      if (this.state.bezet[t.i]) continue;
      const [x, y] = this.naarScherm(t.x, t.y);
      if (t.terrein === 'berg') {
        c.fillStyle = 'rgba(210,205,195,0.55)';
        c.strokeStyle = 'rgba(30,30,30,0.35)';
        c.lineWidth = 1;
        for (const [dx, h] of [[-0.18, 0.34], [0.14, 0.26]]) {
          c.beginPath();
          c.moveTo(x + (dx - 0.18) * T, y + 0.22 * T);
          c.lineTo(x + dx * T, y + (0.22 - h * 1.4) * T);
          c.lineTo(x + (dx + 0.18) * T, y + 0.22 * T);
          c.closePath();
          c.fill();
          c.stroke();
        }
      } else if (t.terrein === 'bos') {
        c.fillStyle = 'rgba(28,70,40,0.75)';
        for (const [dx, dy, r] of [[-0.2, 0.05, 0.16], [0.15, -0.1, 0.18], [0.1, 0.2, 0.13]]) {
          c.beginPath();
          c.arc(x + dx * T, y + dy * T, r * T, 0, Math.PI * 2);
          c.fill();
        }
      } else if (t.terrein === 'kust') {
        c.strokeStyle = 'rgba(170,215,240,0.35)';
        c.lineWidth = Math.max(1, T * 0.05);
        c.beginPath();
        c.moveTo(x - 0.25 * T, y + 0.1 * T);
        c.quadraticCurveTo(x - 0.12 * T, y - 0.02 * T, x, y + 0.1 * T);
        c.quadraticCurveTo(x + 0.12 * T, y + 0.22 * T, x + 0.25 * T, y + 0.1 * T);
        c.stroke();
      }
    }
    c.restore();
  }

  tekenBouwRaster(c, sc) {
    const T = this.geo.T * sc;
    const s = this.state;
    for (const i of s.landTegels[s.speler]) {
      const t = this.geo.tegels[i];
      if (!this.zichtbaar(t)) continue;
      const [x, y] = this.naarScherm(t.x, t.y);
      const st = this.bouwStatus?.get(i);
      c.strokeStyle = 'rgba(255,255,255,0.12)';
      c.lineWidth = 1;
      c.strokeRect(x - T / 2, y - T / 2, T, T);
      if (st?.ok) {
        const r = st.rendement;
        c.fillStyle = r >= 0.99 ? 'rgba(95,211,141,0.32)' : r >= 0.7 ? 'rgba(240,180,41,0.32)' : 'rgba(242,112,106,0.28)';
        c.fillRect(x - T / 2 + 1, y - T / 2 + 1, T - 2, T - 2);
      }
    }
    const ht = this.geo.tegels[this.hoverTegel];
    if (ht) {
      const [x, y] = this.naarScherm(ht.x, ht.y);
      const ok = this.bouwStatus?.get(ht.i)?.ok;
      c.strokeStyle = ok ? '#ffffff' : '#f2706a';
      c.lineWidth = 2;
      c.strokeRect(x - T / 2, y - T / 2, T, T);
      if (ok) {
        const g = s.pack.gebouwIndex[this.bouwModus];
        c.globalAlpha = 0.7;
        c.font = `${Math.round(T * 0.6)}px ${EMOJI}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(g.icoon ?? '■', x, y + 1);
        c.globalAlpha = 1;
      }
    }
  }

  // Het wegennet. Op zoom 1,5 tot 4,4 als overzichtslijnen; daarna eenvoudig asfalt op de breedte uit PROFIEL, zolang
  // infra.js het wegdek nog niet zelf tekent (infraLaag.tekentWegdek). Elke lijn is een tak van het net: geen lijnen
  // meer van een gebouw naar een knooppunt, en geen vrachtblokjes (de vracht rijdt als echte ritten over het net).
  tekenWegen(c, sc) {
    const net = this.wegennet;
    if (!net?.klaar || !net.nT) return;
    const z = this.zoom, T = this.geo.T * sc;
    const wegdek = !!this.infraLaag.tekentWegdek;
    const op = smooth(3.6, 4.4, z);
    // C12 herstel: het net is als wegenkaart zichtbaar vanaf het overzicht (eerst stam- en hoofdwegen, dan straten)
    const lijnA = 1 - op;
    const asfaltA = wegdek ? 0 : op;
    if (lijnA <= 0.01 && asfaltA <= 0.01) return;
    const [wx0, wy0] = this.naarWereld(0, 0), [wx1, wy1] = this.naarWereld(this.w, this.h);
    const m = this.geo.T * 0.5, B = net.tBox, P = net.punten;
    const zicht = this._zicht ??= [];
    zicht.length = 0;
    for (let i = 0; i < net.nT; i++) if (B[i * 4 + 2] >= wx0 - m && B[i * 4] <= wx1 + m && B[i * 4 + 3] >= wy0 - m && B[i * 4 + 1] <= wy1 + m) zicht.push(i);
    let tunnel = false;
    const pad = (klasse) => {
      c.beginPath();
      let n = 0;
      for (const i of zicht) {
        if (net.tKlasse[i] !== klasse || (tunnel !== (net.tBouw[i] === 3))) continue;
        const p0 = net.tP0[i];
        for (let j = 0; j < net.tNP[i]; j++) {
          const [x, y] = this.naarScherm(P[(p0 + j) * 2], P[(p0 + j) * 2 + 1]);
          if (j) c.lineTo(x, y); else c.moveTo(x, y);
        }
        n++;
      }
      return n;
    };
    const VOLG = [KLASSE.ERF, KLASSE.STRAAT, KLASSE.HOOFD, KLASSE.STAM];
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (lijnA > 0.01) {
      // overzicht als wegenkaart: donkere rand en een heldere kern per klasse (stamweg oranje, hoofdweg geel, straat
      // licht). Kleine wegen komen pas op bij inzoomen, zodat het overzicht leesbaar blijft.
      const kern = ['#d9d0bb', '#f1ece0', '#f6d66b', '#f29a3a'];
      const opKomst = [smooth(2.4, 3, z), smooth(1.5, 2.1, z), smooth(1.3, 1.8, z), 1];
      for (const k of VOLG) {
        const ak = lijnA * opKomst[k];
        if (ak <= 0.02 || !pad(k)) continue;
        const b = Math.max([0.8, 1.1, 1.7, 2.4][k], PROFIEL[k].asfalt * T * 0.75);
        c.globalAlpha = ak;
        c.strokeStyle = 'rgba(16,18,22,0.9)'; c.lineWidth = b + 1.8; c.stroke();
        c.strokeStyle = kern[k]; c.lineWidth = b; c.stroke();
      }
      // tunnels: gestippeld, zonder rand (de weg ligt onder de grond)
      tunnel = true;
      c.setLineDash([3, 3]);
      for (const k of VOLG) {
        const ak = lijnA * opKomst[k] * 0.8;
        if (ak <= 0.02 || !pad(k)) continue;
        c.globalAlpha = ak; c.strokeStyle = kern[k]; c.lineWidth = Math.max(1, [0.8, 1.1, 1.7, 2.4][k] * 0.6); c.stroke();
      }
      c.setLineDash([]);
      tunnel = false;
      // bruggen: een lichte rand over het water
      c.globalAlpha = lijnA;
      c.beginPath();
      let nb = 0;
      for (const i of zicht) {
        const bw = net.tBouw[i];
        if (bw !== 1 && bw !== 2) continue;
        if (net.tKlasse[i] === KLASSE.ERF && z < 2.4) continue;
        const p0 = net.tP0[i];
        for (let j = 0; j < net.tNP[i]; j++) { const [x, y] = this.naarScherm(P[(p0 + j) * 2], P[(p0 + j) * 2 + 1]); if (j) c.lineTo(x, y); else c.moveTo(x, y); }
        nb++;
      }
      if (nb) { c.lineCap = 'butt'; c.strokeStyle = 'rgba(245,242,232,0.95)'; c.lineWidth = Math.max(4, 0.11 * T); c.stroke(); c.strokeStyle = 'rgba(16,18,22,0.9)'; c.lineWidth = Math.max(2.6, 0.075 * T); c.stroke(); c.strokeStyle = '#f6d66b'; c.lineWidth = Math.max(1.4, 0.045 * T); c.stroke(); c.lineCap = 'round'; }
    }
    if (asfaltA > 0.01) {
      c.globalAlpha = asfaltA;
      // opritten: beton, de kavel in
      if (z >= 4 && pad(KLASSE.OPRIT)) { c.lineCap = 'butt'; c.strokeStyle = '#8b877e'; c.lineWidth = PROFIEL[KLASSE.OPRIT].asfalt * T; c.stroke(); c.lineCap = 'round'; }
      for (const k of VOLG) {
        if (!pad(k)) continue;
        const b = PROFIEL[k].asfalt * T;
        if (k === KLASSE.STAM) { c.strokeStyle = 'rgba(150,150,120,0.55)'; c.lineWidth = b + 0.07 * T; c.stroke(); }
        c.strokeStyle = '#34363a'; c.lineWidth = b + Math.max(1, 0.012 * T); c.stroke();
        c.strokeStyle = '#4a4a47'; c.lineWidth = b; c.stroke();
        if (z >= 7 && k >= KLASSE.HOOFD) {
          c.setLineDash([0.06 * T, 0.08 * T]);
          c.strokeStyle = 'rgba(236,235,228,0.75)'; c.lineWidth = Math.max(0.6, 0.008 * T); c.stroke();
          c.setLineDash([]);
        }
      }
    }
    c.restore();
  }

  // Middenzoom (1,5 tot 4): bebouwde tegels krijgen een eigen grond (beton, getint naar wat er gemaakt wordt; de
  // hoofdstad licht), iets kleiner dan de tegel, zodat de straten op de tegelranden ertussen zichtbaar blijven. Zo
  // lees je een stad als stad, met het wegennet erdoorheen, in plaats van als een tapijt van vakjes.
  tekenBebouwing(c, sc) {
    const z = this.zoom;
    if (z >= MINI + 0.4) return;
    const a = smooth(1.5, 2, z) * (1 - smooth(MINI, MINI + 0.4, z));
    if (a <= 0.01) return;
    const s = this.state, P = s.pack, T = this.geo.T * sc, h = T * 0.45;
    const tint = this._grondTint ??= new Map();
    const grond = (g) => {
      let k = tint.get(g.id);
      if (!k) {
        const res = Object.keys(g.productie || {})[0];
        const rk = P.resIndex[res]?.kleur;
        const [r, gg, b] = rk && rk[0] === '#' && rk.length >= 7 ? hex(rk) : [128, 126, 118];
        const m = 0.22;
        k = `rgb(${Math.round(112 + (r - 112) * m)},${Math.round(110 + (gg - 110) * m)},${Math.round(104 + (b - 104) * m)})`;
        tint.set(g.id, k);
      }
      return k;
    };
    c.save();
    c.globalAlpha = a * 0.85;
    const vlak = (t, kleur) => {
      const tg = this.geo.tegels[t];
      if (!tg || !this.zichtbaar(tg)) return;
      const [x, y] = this.naarScherm(tg.x, tg.y);
      c.fillStyle = kleur;
      c.fillRect(x - h, y - h, h * 2, h * 2);
    };
    for (const land of s.landen) {
      vlak(this.geo.hoofdstad[land.idx], '#b9ae98');
      for (const p of land.plaatsingen) if (p.t >= 0) vlak(p.t, grond(P.gebouwIndex[p.g]));
      for (const b of land.bouw) vlak(b.tegel, '#8d8676');
    }
    c.restore();
  }

  // Spoorlijnen als op een kaart: een donkere lijn met witte streepjes, van het overzicht tot het echte spoor van
  // infra.js het overneemt.
  tekenSpoorOverzicht(c, sc) {
    const a = 1 - smooth(3.6, 4.4, this.zoom);
    const routes = this.infraLaag.routes;
    if (a <= 0.01 || !routes?.length) return;
    const T = this.geo.T * sc, w = Math.max(1.8, 0.04 * T);
    const [wx0, wy0] = this.naarWereld(0, 0), [wx1, wy1] = this.naarWereld(this.w, this.h);
    c.save();
    c.globalAlpha = a;
    c.lineCap = 'butt'; c.lineJoin = 'round';
    c.beginPath();
    for (const r of routes) {
      if (r.x1 < wx0 || r.x0 > wx1 || r.y1 < wy0 || r.y0 > wy1) continue;
      for (let i = 0; i < r.n; i++) { const [x, y] = this.naarScherm(r.x[i], r.y[i]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    }
    c.strokeStyle = 'rgba(16,18,22,0.92)'; c.lineWidth = w + 1.4; c.stroke();
    c.strokeStyle = '#3a3b40'; c.lineWidth = w; c.stroke();
    c.setLineDash([w * 2.4, w * 2.4]);
    c.strokeStyle = '#f2efe6'; c.lineWidth = w * 0.5; c.stroke();
    c.setLineDash([]);
    c.restore();
  }

  // Hoogspanningslijnen op de middenzoom: een dunne draad met een stipje per mast (dichterbij tekent infra.js de
  // echte masten).
  tekenLeidingenOverzicht(c, sc) {
    const z = this.zoom, a = smooth(2, 2.6, z) * (1 - smooth(4.2, 5, z));
    const lijnen = this.infraLaag.lijnen;
    if (a <= 0.01 || !lijnen?.length) return;
    const T = this.geo.T * sc, r = Math.max(1, 0.025 * T);
    const [wx0, wy0] = this.naarWereld(0, 0), [wx1, wy1] = this.naarWereld(this.w, this.h);
    c.save();
    c.globalAlpha = a * 0.8;
    c.strokeStyle = 'rgba(58,52,70,0.9)'; c.lineWidth = Math.max(0.8, 0.01 * T);
    c.fillStyle = 'rgba(40,36,50,0.95)';
    for (const ln of lijnen) {
      if (Math.max(ln.x0, ln.x1) < wx0 || Math.min(ln.x0, ln.x1) > wx1 || Math.max(ln.y0, ln.y1) < wy0 || Math.min(ln.y0, ln.y1) > wy1) continue;
      const M = ln.m, n = M.length / 2;
      c.beginPath();
      for (let i = 0; i < n; i++) { const [x, y] = this.naarScherm(M[i * 2], M[i * 2 + 1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
      c.stroke();
      for (let i = 0; i < n; i++) { const [x, y] = this.naarScherm(M[i * 2], M[i * 2 + 1]); c.fillRect(x - r, y - r, r * 2, r * 2); }
    }
    c.restore();
  }

  // Foutzoeken: klassen in kleur, knopen per soort, poorten met oprit en dock, haltes, zebra's en grensovergangen.
  tekenNetDebug(c, sc) {
    const net = this.wegennet;
    if (!net?.klaar) return;
    const T = this.geo.T * sc, P = net.punten;
    const KLEUR = ['#5fd38d', '#f2f5f8', '#f0a030', '#e8483c', '#45c8e8'];
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (let i = 0; i < net.nT; i++) {
      const p0 = net.tP0[i];
      const [ax, ay] = this.naarScherm(net.tBox[i * 4], net.tBox[i * 4 + 1]), [bx, by] = this.naarScherm(net.tBox[i * 4 + 2], net.tBox[i * 4 + 3]);
      if (bx < -20 || by < -20 || ax > this.w + 20 || ay > this.h + 20) continue;
      c.beginPath();
      for (let j = 0; j < net.tNP[i]; j++) { const [x, y] = this.naarScherm(P[(p0 + j) * 2], P[(p0 + j) * 2 + 1]); if (j) c.lineTo(x, y); else c.moveTo(x, y); }
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = Math.max(2.5, T * 0.05) + 2; c.stroke();
      c.strokeStyle = KLEUR[net.tKlasse[i]]; c.lineWidth = Math.max(2.5, T * 0.05);
      if (net.tBouw[i]) c.setLineDash([4, 3]);
      c.stroke(); c.setLineDash([]);
    }
    const r = Math.max(2.5, T * 0.04);
    for (let k = 0; k < net.nK; k++) {
      const [x, y] = this.naarScherm(net.kx[k], net.ky[k]);
      if (x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10) continue;
      const so = net.kSoort[k];
      c.fillStyle = so === KNOOP.LICHT ? '#ffe14a' : so === KNOOP.ROTONDE ? '#c38fff' : so === KNOOP.POORT ? '#45c8e8' : so === KNOOP.DOCK ? '#2f6dd0' : so === KNOOP.EIND ? '#ff2020' : '#ffffff';
      c.strokeStyle = '#000'; c.lineWidth = 1;
      c.beginPath();
      if (so === KNOOP.POORT || so === KNOOP.DOCK) c.rect(x - r, y - r, r * 2, r * 2); else c.arc(x, y, so === KNOOP.LICHT ? r * 1.6 : r, 0, Math.PI * 2);
      c.fill(); c.stroke();
    }
    c.fillStyle = '#ff40d0';
    for (const g of net.grensovergangen) { const [x, y] = this.naarScherm(g.x, g.y); c.beginPath(); c.moveTo(x, y - r * 3); c.lineTo(x + r * 3, y); c.lineTo(x, y + r * 3); c.lineTo(x - r * 3, y); c.closePath(); c.fill(); c.stroke(); }
    c.fillStyle = '#2ee0b0';
    for (const h of net.haltes) { const [x, y] = this.naarScherm(h.x, h.y); c.fillRect(x - r * 1.5, y - r * 1.5, r * 3, r * 3); }
    c.strokeStyle = '#ffffff'; c.lineWidth = Math.max(1, r * 0.6);
    for (const zb of net.zebras) { const [x, y] = this.naarScherm(zb.x, zb.y); c.beginPath(); c.arc(x, y, r * 0.8, 0, Math.PI * 2); c.stroke(); }
    c.restore();
  }

  tekenGebouwen(c, sc, detail) {
    const s = this.state;
    const P = s.pack;
    const T = this.geo.T * sc;
    const u = verkeersTijd(this.nu), tijd = this.nu / 1000;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const land of s.landen) {
      const rand = land.idx === s.speler ? '#f0b429' : this.kleurVan(land);
      // Hoofdstad
      const h = this.geo.tegels[this.geo.hoofdstad[land.idx]];
      if (h && this.zichtbaar(h)) {
        const [x, y] = this.naarScherm(h.x, h.y);
        if (this.zoom >= MINI) {
          tekenGebouwDetail(c, 'hoofdstad', x, y, T, { regime: land.regime, kleur: rand, tijd, seed: h.i, actief: true, nacht: this.nacht ?? 0, dag: s.dag, stab: land.stab, welvaart: land.Y / Math.max(1, s.wereldY / s.landen.length), oorlog: s.oorlogen.length > 0, L: land.L, capaciteit: this.woningenVan(land), basis: land.basisWoningen, ...this.kavelCtx(h.i, 'hoofdstad', u) });
          if (this.zoom < DIEP) this.merk(c, x, y, T, rand, '🏛');
        } else if (detail) {
          this.vakje(c, x, y, T, rand, 1);
          c.font = `${Math.round(this.vakjeMaat(T) * 1.25)}px ${EMOJI}`;
          c.fillText('🏛', x, y + 1);
        } else {
          c.fillStyle = rand;
          c.beginPath(); c.arc(x, y, Math.max(2.5, T * 0.22), 0, Math.PI * 2); c.fill();
        }
      }
      for (const k of s.kolonies) {
        if (k.land !== land.idx) continue;
        const kt = this.geo.tegels[k.t];
        if (!this.zichtbaar(kt)) continue;
        const [x, y] = this.naarScherm(kt.x, kt.y);
        if (this.zoom >= MINI) { tekenGebouwDetail(c, 'kolonie', x, y, T, { regime: land.regime, kleur: rand, seed: k.t, nacht: this.nacht ?? 0, dag: s.dag, tijd, ...this.kavelCtx(k.t, 'kolonie', u) }); if (this.zoom < DIEP) this.merk(c, x, y, T, rand, '🚩'); }
        else if (detail) { this.vakje(c, x, y, T, rand, 1); c.font = `${Math.round(this.vakjeMaat(T) * 1.2)}px ${EMOJI}`; c.fillText('🚩', x, y + 1); }
        else { c.fillStyle = rand; c.fillRect(x - 2, y - 2, 4, 4); }
      }
      for (const p of land.plaatsingen) {
        this.tekenGebouw(c, land, p.t, p.g, T, rand, detail, null, p.eff, p);
        if ((p.uit ?? 0) > s.dag && p.t >= 0 && this.zichtbaar(this.geo.tegels[p.t])) tekenUitval(c, ...this.naarScherm(this.geo.tegels[p.t].x, this.geo.tegels[p.t].y), Math.max(4, T), this.nu);
      }
      for (const b of land.bouw) this.tekenGebouw(c, land, b.tegel, b.gebouw, T, rand, detail, (s.dag - b.start) / Math.max(1, b.klaar - b.start), 1);
    }
  }

  // Wat een gebouw van zijn kavel weet: de omgeving uit het net, de stand van zijn dock, de verkeersklok en de echte
  // gebouw-id (de tekening kan een alias zijn).
  kavelCtx(t, gebouw, u) {
    return { omgeving: this.wegennet?.omgeving(t) ?? null, dock: this.levenLaag?.dockStand?.(t, u) ?? null, u, gebouw };
  }

  // Het merkje van een gebouw op de middenzoom: een rond schildje midden op de kavel, klein genoeg dat de grond, de
  // straten en het spoor eromheen zichtbaar blijven (vroeger een donker vak over bijna de hele tegel).
  vakje(c, x, y, T, rand, alpha) {
    const m = this.vakjeMaat(T);
    c.globalAlpha = alpha;
    c.fillStyle = 'rgba(10,15,21,0.8)';
    c.strokeStyle = rand;
    c.lineWidth = Math.max(1.2, m * 0.16);
    c.beginPath();
    c.arc(x, y, m, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.globalAlpha = 1;
  }

  vakjeMaat(T) { return clamp(T * 0.26, 6, 20); }

  // Klein merkje op een verkleinde tekening (MINI tot DIEP): wat er staat en van wie, verdwijnt bij verder inzoomen.
  merk(c, x, y, T, rand, icoon, voortgang = null) {
    const a = 1 - smooth(3.3, DIEP, this.zoom);
    if (a <= 0.02) return;
    const m = clamp(T * 0.15, 6, 12);
    c.globalAlpha = a;
    c.fillStyle = 'rgba(10,15,21,0.78)'; c.strokeStyle = rand; c.lineWidth = Math.max(1.2, m * 0.18);
    c.beginPath(); c.arc(x, y, m, 0, Math.PI * 2); c.fill(); c.stroke();
    c.font = `${Math.round(m * 1.25)}px ${EMOJI}`;
    c.fillText(icoon, x, y + 1);
    if (voortgang != null) {
      c.fillStyle = '#0c131b'; c.fillRect(x - m * 1.6, y + m + 2, m * 3.2, 3);
      c.fillStyle = '#f0b429'; c.fillRect(x - m * 1.6, y + m + 2, m * 3.2 * clamp(voortgang, 0, 1), 3);
    }
    c.globalAlpha = 1;
  }

  tekenGebouw(c, land, t, gebouwId, T, rand, detail, voortgang, eff, p) {
    const tegel = this.geo.tegels[t];
    if (!tegel || !this.zichtbaar(tegel)) return;
    const g = this.state.pack.gebouwIndex[gebouwId];
    const [x, y] = this.naarScherm(tegel.x, tegel.y);
    if (this.zoom >= MINI) {
      const soort = g.tekening ?? TEKENING_ALIAS[g.id] ?? g.id;
      const gelukt = tekenGebouwDetail(c, soort, x, y, T, {
        ...this.kavelCtx(t, g.id, verkeersTijd(this.nu)),
        regime: land.regime, kleur: rand, tijd: this.nu / 1000, seed: t,
        actief: voortgang == null && (eff ?? 1) > 0, voortgang: voortgang == null ? null : clamp(voortgang, 0, 1),
        eff: eff ?? 1, aantal: land.gebouwen[gebouwId] ?? 1, niveau: p?.niveau ?? null, L: land.L, capaciteit: this.woningenVan(land), basis: land.basisWoningen, uit: (p?.uit ?? 0) > this.state.dag, nacht: this.nacht ?? 0, dag: this.state.dag, stab: land.stab, welvaart: land.Y / Math.max(1, this.state.wereldY / this.state.landen.length),
      });
      if (gelukt) {
        if (this.zoom < DIEP) { this.merk(c, x, y, T, rand, g.icoon ?? '■', voortgang); return; }
        if (voortgang == null && eff < 0.95 && land.idx === this.state.speler) {
          c.font = `600 ${Math.max(9, Math.round(T * 0.13))}px -apple-system, sans-serif`;
          c.fillStyle = eff < 0.7 ? '#f2706a' : '#f0b429';
          c.fillText(`${Math.round(eff * 100)}%`, x, y - T * 0.42);
        }
        return;
      }
    }
    if (!detail) {
      const res = Object.keys(g.productie || {})[0];
      c.fillStyle = voortgang != null ? 'rgba(255,255,255,0.35)' : this.state.pack.resIndex[res]?.kleur ?? '#cfd8e3';
      c.fillRect(x - 1.3, y - 1.3, 2.6, 2.6);
      return;
    }
    if (voortgang != null) {
      c.setLineDash([T * 0.12, T * 0.1]);
      this.vakje(c, x, y, T, rand, 0.75);
      c.setLineDash([]);
      c.globalAlpha = 0.45;
      c.font = `${Math.round(this.vakjeMaat(T) * 1.1)}px ${EMOJI}`;
      c.fillText(g.icoon ?? '■', x, y + 1);
      c.globalAlpha = 1;
      c.fillStyle = '#0c131b';
      c.fillRect(x - T * 0.32, y + this.vakjeMaat(T) + 2, T * 0.64, Math.max(2, T * 0.07));
      c.fillStyle = '#f0b429';
      c.fillRect(x - T * 0.32, y + this.vakjeMaat(T) + 2, T * 0.64 * clamp(voortgang, 0, 1), Math.max(2, T * 0.07));
      return;
    }
    this.vakje(c, x, y, T, rand, 1);
    c.font = `${Math.round(this.vakjeMaat(T) * 1.2)}px ${EMOJI}`;
    c.fillText(g.icoon ?? '■', x, y + 1);
    if (eff < 0.95 && this.zoom >= 2.4 && land.idx === this.state.speler) {
      c.font = `600 ${Math.max(8, Math.round(T * 0.26))}px -apple-system, sans-serif`;
      c.fillStyle = eff < 0.7 ? '#f2706a' : '#f0b429';
      c.fillText(`${Math.round(eff * 100)}%`, x, y - this.vakjeMaat(T) - Math.max(5, T * 0.12));
    }
  }

  tekenStrategisch(c, sc) {
    const s = this.state;
    const kaart = s.pack.kaart;
    const { sx, sy } = this.geo.schaal;
    const strat = clamp(1.9 - this.zoom * 0.5, 0, 1);
    const idxVan = this.geo.idxVan;

    if (strat > 0) {
      c.save();
      c.globalAlpha = strat;
      c.lineWidth = 1.2;
      for (const [a, b] of kaart.handelsroutes) {
        const ia = idxVan[a], ib = idxVan[b];
        if (ia == null || ib == null || !this.midden[ia] || !this.midden[ib]) continue;
        const [ax, ay] = this.naarScherm(this.midden[ia].x, this.midden[ia].y);
        const [bx, by] = this.naarScherm(this.midden[ib].x, this.midden[ib].y);
        const zelfde = s.landen[ia].alignment === s.landen[ib].alignment && s.landen[ia].alignment !== 'zwevend';
        c.strokeStyle = zelfde ? this.kleurVan(s.landen[ia]) + 'cc' : 'rgba(220,230,240,0.22)';
        c.setLineDash(zelfde ? [] : [4, 4]);
        c.beginPath();
        c.moveTo(ax, ay);
        c.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 - 12 * this.zoom, bx, by);
        c.stroke();
      }
      c.setLineDash([]);
      c.restore();
    }

    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.font = 'italic 12px -apple-system, Segoe UI, sans-serif';
    c.fillStyle = 'rgba(150,190,220,0.5)';
    for (const z of kaart.zeeen || []) {
      const [x, y] = this.naarScherm(z.x * sx, z.y * sy);
      c.fillText(z.naam, x, y);
    }
    for (const kp of kaart.knelpunten) {
      const [x, y] = this.naarScherm(kp.x * sx, kp.y * sy);
      c.strokeStyle = '#f0b429';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x, y - 6); c.lineTo(x + 6, y); c.lineTo(x, y + 6); c.lineTo(x - 6, y); c.closePath();
      c.stroke();
      c.fillStyle = 'rgba(240,180,41,0.85)';
      c.font = '10px -apple-system, Segoe UI, sans-serif';
      c.fillText(kp.naam, x, y + 18);
    }

    for (const l of s.landen) {
      const m = this.midden[l.idx];
      if (!m) continue;
      let [x, y] = this.naarScherm(m.x, m.y);
      if (this.zoom >= 1.5) {
        // ingezoomd: label in de bovenste helft van de eigen hoofdstadtegel, niet op de tegel erboven
        const h = this.geo.tegels[this.geo.hoofdstad[l.idx]];
        if (h) [x, y] = this.naarScherm(h.x, h.y - this.geo.T * 0.32);
      }
      if (x < -80 || y < -20 || x > this.w + 80 || y > this.h + 20) continue;
      const leider = s.blokken.some((b) => b.leider === l.idx);
      const naam = (l.idx === s.speler ? '★ ' : leider ? '◆ ' : '') + l.naam + ` ${s.pack.regimes[l.regime]?.icoon ?? ''}`;
      c.font = `${l.idx === s.speler ? 700 : 600} 13px -apple-system, Segoe UI, sans-serif`;
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(5,10,15,0.8)';
      c.strokeText(naam, x, y);
      c.fillStyle = '#f2f5f8';
      c.fillText(naam, x, y);
      if (!l.vast && strat > 0.3) {
        const w = 44, bx0 = x - w / 2, by0 = y + 6;
        c.fillStyle = 'rgba(5,10,15,0.7)';
        c.fillRect(bx0 - 1, by0 - 1, w + 2, 5);
        let bx = bx0;
        const tot = s.blokken.reduce((a, b) => a + l.loyaliteit[b.id], 0) || 1;
        for (const b of s.blokken) {
          const bw = (l.loyaliteit[b.id] / tot) * w;
          c.fillStyle = b.kleur;
          c.fillRect(bx, by0, bw, 3);
          bx += bw;
        }
        if (l.uitspelen) {
          c.fillStyle = '#f0b429';
          c.font = '11px -apple-system, Segoe UI, sans-serif';
          c.fillText('⚖', x + w / 2 + 8, by0 + 4);
        }
      }
    }
  }
}

// Voorgerenderde sprites voor lichtgloed en wolken: veel sneller dan elke frame gradiënten maken.
function maakGloed() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,214,140,1)');
  g.addColorStop(0.35, 'rgba(255,180,90,0.45)');
  g.addColorStop(1, 'rgba(255,160,60,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return cv;
}

function maakWolk() {
  const cv = document.createElement('canvas');
  cv.width = 200;
  cv.height = 100;
  const c = cv.getContext('2d');
  for (const [x, y, r] of [[60, 55, 30], [95, 45, 38], [135, 55, 30], [80, 65, 26], [120, 68, 24]]) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  return cv;
}
