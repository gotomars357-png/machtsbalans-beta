// Kaartweergave met zoom en pan. Uitgezoomd is het een strategische kaart (blokken, routes, loyaliteit);
// ingezoomd zie je terrein, vakjes, gebouwen, wegen naar knooppunten en vrachtwagens die productie afvoeren.
// Grenzen en vakjes komen uit src/engine/geografie.js, dus de kaart toont precies wat de bouwregels gebruiken.

import { tegelOp } from '../engine/geografie.js';
import { woningCapaciteit } from '../engine/samenleving.js';
import { tekenGebouwDetail } from './detail.js';
import { TerreinLaag } from './terrein.js';
import { zoekPad } from '../engine/leger.js';
import { tekenUitval, tekenCyberFlits, CYBER_KLEUR } from './cyber.js';
import { LevenLaag } from './leven.js';

// Vanaf deze zoom tekent de kaart vakjes als echte plekken: huizen, akkers, fabrieken, bomen.
const DIEP = 4;
// Gebouwen uit andere packs met een vergelijkbare functie hergebruiken een bestaande tekening.
const TEKENING_ALIAS = { olieveld: 'centrale', staalfabriek: 'industrie', landbouw: 'boerderij', zware_industrie: 'industrie', ruimtevaartcentrum: 'chipfabriek', spoor: 'opslag' };
// cybercentrum heeft een eigen tekening in detail.js.

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
    this.levenLaag.laad(this);
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
      const d = Math.hypot(u.x - wx, u.y - wy);
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
    const nu = performance.now();
    c.imageSmoothingEnabled = true;
    c.drawImage(this.bron, x0, y0, 1000 * sc, 620 * sc);
    this.terreinLaag.teken(c, this, sc, nu);

    const detail = this.zoom >= 1.5;
    this.tekenTerrein(c, sc);
    if (this.bouwModus) this.tekenBouwRaster(c, sc);
    if (detail) this.tekenWegen(c, sc);
    this.tekenKoopvaardij(c, sc, nu);
    this.tekenGebouwen(c, sc, detail);
    this.levenLaag.teken(c, this, sc, nu, dt, tempo);
    this.tekenEenheden(c, sc, detail, frac);
    this.tekenNacht(c, sc, nu);
    this.levenLaag.tekenLichten(c, this, sc, nu);
    this.tekenWolken(c, sc, nu);
    this.tekenGolven(c, sc, nu);
    this.tekenStrategisch(c, sc);
    this.tekenMarkeringen(c);
  }

  eenheidPositie(u, frac) {
    // kleine vaste spreiding zodat gestapelde eenheden zichtbaar blijven
    const j = this.geo.T * 0.2;
    const ox = (((u.id * 7919) % 7) - 3) / 3 * j;
    const oy = (((u.id * 104729) % 7) - 3) / 3 * j;
    return this.naarScherm(u.px + (u.x - u.px) * frac + ox, u.py + (u.y - u.py) * frac + oy);
  }

  tekenEenheden(c, sc, detail, frac) {
    const s = this.state;
    const T = this.geo.T * sc;
    const straal = detail ? Math.max(5, T * 0.3) : 3.2;
    const posities = new Map();
    for (const u of s.eenheden) posities.set(u.id, this.eenheidPositie(u, frac));
    const nu = performance.now();
    // gevechtslijnen
    if (detail) {
      c.lineWidth = 1.5;
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
    for (const u of s.eenheden) {
      const [x, y] = posities.get(u.id);
      if (x < -20 || y < -20 || x > this.w + 20 || y > this.h + 20) continue;
      const land = s.landen[u.land];
      const kleur = land.idx === s.speler ? '#f0b429' : this.kleurVan(land);
      const type = s.pack.eenhedenIndex[u.type];
      if (this.selectie?.has(u.id)) {
        c.strokeStyle = '#ffffff'; c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, straal + 3, 0, Math.PI * 2); c.stroke();
      }
      c.fillStyle = detail ? 'rgba(10,15,21,0.92)' : kleur;
      c.strokeStyle = detail ? kleur : 'rgba(5,10,15,0.9)';
      c.lineWidth = detail ? 2 : 1;
      c.beginPath(); c.arc(x, y, straal, 0, Math.PI * 2); c.fill(); c.stroke();
      if (detail) {
        c.font = `${Math.round(straal * 1.15)}px ${EMOJI}`;
        c.fillText(type.icoon ?? '●', x, y + 1);
      }
      if (u.hp < type.hp && detail) {
        const w = straal * 2;
        c.fillStyle = '#0c131b'; c.fillRect(x - straal, y - straal - 5, w, 3);
        c.fillStyle = u.hp / type.hp > 0.5 ? '#5fd38d' : u.hp / type.hp > 0.25 ? '#f0b429' : '#f2706a';
        c.fillRect(x - straal, y - straal - 5, w * Math.max(0, u.hp / type.hp), 3);
      }
      if (u.bezig && detail) {
        c.strokeStyle = '#f0b429'; c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, straal + 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, u.bezig / 6)); c.stroke();
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

  tekenWolken(c, sc, nu) {
    const a = clamp(1 - (this.zoom - 1) / 2.2, 0, 1);
    if (a <= 0) return;
    for (let i = 0; i < 9; i++) {
      const x0 = ((i * 397) % 1000);
      const y0 = 40 + ((i * 263) % 540);
      const x = ((x0 + nu / 1000 * (4 + (i % 3))) % 1200) - 100;
      const [sx, sy] = this.naarScherm(x, y0);
      const w = (90 + (i % 4) * 30) * sc;
      c.globalAlpha = a * 0.18;
      c.drawImage(this.wolk, sx - w / 2 + 14 * sc, sy - w / 4 + 18 * sc, w, w / 2);
      c.globalAlpha = a * 0.55;
      c.filter = 'none';
      c.drawImage(this.wolk, sx - w / 2, sy - w / 4, w, w / 2);
    }
    c.globalAlpha = 1;
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
      const leeftijd = (performance.now() - m.tijd) / 700;
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
    const nu = performance.now();
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
      this.terreinLaag.tekenKenmerken(c, this, sc, performance.now()); return;
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

  knooppuntVoor(land, t) {
    // dichtstbijzijnde knooppunt (hoofdstad of depot) van dit land
    const geo = this.geo;
    const nodes = [geo.hoofdstad[land.idx], ...land.plaatsingen.filter((p) => p.t >= 0 && this.state.pack.gebouwIndex[p.g].knooppunt).map((p) => p.t)];
    let best = -1, bd = Infinity;
    const a = geo.tegels[t];
    for (const n of nodes) {
      const b = geo.tegels[n];
      if (!b || n === t) continue;
      const d = (a.k - b.k) ** 2 + (a.r - b.r) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  tekenWegen(c, sc) {
    const s = this.state;
    const P = s.pack;
    const T = this.geo.T * sc;
    const a = clamp((this.zoom - 1.5) / 0.6, 0, 1);
    c.save();
    c.lineCap = 'round';
    for (const land of s.landen) {
      const items = [...land.plaatsingen.map((p) => ({ t: p.t, g: p.g, klaar: true })), ...land.bouw.map((b) => ({ t: b.tegel, g: b.gebouw, klaar: false }))];
      for (const it of items) {
        if (it.t < 0) continue;
        const n = this.knooppuntVoor(land, it.t);
        if (n < 0) continue;
        const A = this.geo.tegels[it.t], B = this.geo.tegels[n];
        if (!this.zichtbaar(A, 6) && !this.zichtbaar(B, 6)) continue;
        const [ax, ay] = this.naarScherm(A.x, A.y);
        const [bx, by] = this.naarScherm(B.x, B.y);
        c.globalAlpha = a * (land.idx === s.speler ? 0.85 : 0.45);
        c.strokeStyle = '#0d0f12';
        c.lineWidth = Math.max(2, T * 0.16);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
        const diep = this.zoom >= DIEP;
        c.strokeStyle = diep ? '#4a4a47' : '#c9b48a';
        c.lineWidth = Math.max(1, T * (diep ? 0.11 : 0.08));
        c.setLineDash(it.klaar ? [] : [T * 0.2, T * 0.2]);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
        if (diep && it.klaar) {
          c.strokeStyle = '#d8c87a';
          c.lineWidth = Math.max(0.6, T * 0.01);
          c.setLineDash([T * 0.06, T * 0.06]);
          c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
        }
        c.setLineDash([]);
        // Vrachtwagens: rijden van gebouw naar knooppunt in de kleur van wat ze vervoeren.
        const g = P.gebouwIndex[it.g];
        const res = Object.keys(g.productie || {})[0];
        if (!it.klaar || !res || this.zoom < 2) continue;
        const lengte = Math.hypot(bx - ax, by - ay);
        if (lengte < T * 0.8) continue;
        const kleur = P.resIndex[res]?.kleur ?? '#ffffff';
        const fase = (it.t * 0.618) % 1;
        const snelheid = 0.35 * (T * 6 / lengte);
        for (let k = 0; k < 2; k++) {
          const f = (this.animTijd * snelheid + fase + k * 0.5) % 1;
          const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
          c.globalAlpha = a;
          c.fillStyle = '#0d0f12';
          c.fillRect(x - T * 0.13, y - T * 0.09, T * 0.26, T * 0.18);
          c.fillStyle = kleur;
          c.fillRect(x - T * 0.1, y - T * 0.06, T * 0.2, T * 0.12);
        }
      }
    }
    c.restore();
  }

  tekenGebouwen(c, sc, detail) {
    const s = this.state;
    const P = s.pack;
    const T = this.geo.T * sc;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const land of s.landen) {
      const rand = land.idx === s.speler ? '#f0b429' : this.kleurVan(land);
      // Hoofdstad
      const h = this.geo.tegels[this.geo.hoofdstad[land.idx]];
      if (h && this.zichtbaar(h)) {
        const [x, y] = this.naarScherm(h.x, h.y);
        if (this.zoom >= DIEP) {
          tekenGebouwDetail(c, 'hoofdstad', x, y, T, { regime: land.regime, kleur: rand, tijd: performance.now() / 1000, seed: h.i, actief: true, nacht: this.nacht ?? 0, stab: land.stab, welvaart: land.Y / Math.max(1, s.wereldY / s.landen.length), oorlog: s.oorlogen.length > 0, L: land.L, capaciteit: this.woningenVan(land), basis: land.basisWoningen });
        } else if (detail) {
          this.vakje(c, x, y, T, rand, 1);
          c.font = `${Math.round(T * 0.6)}px ${EMOJI}`;
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
        if (this.zoom >= DIEP) tekenGebouwDetail(c, 'kolonie', x, y, T, { regime: land.regime, kleur: rand, seed: k.t, nacht: this.nacht ?? 0, tijd: performance.now() / 1000 });
        else if (detail) { this.vakje(c, x, y, T, rand, 1); c.font = `${Math.round(T * 0.56)}px ${EMOJI}`; c.fillText('🚩', x, y + 1); }
        else { c.fillStyle = rand; c.fillRect(x - 2, y - 2, 4, 4); }
      }
      for (const p of land.plaatsingen) {
        this.tekenGebouw(c, land, p.t, p.g, T, rand, detail, null, p.eff, p);
        if ((p.uit ?? 0) > s.dag && p.t >= 0 && this.zichtbaar(this.geo.tegels[p.t])) tekenUitval(c, ...this.naarScherm(this.geo.tegels[p.t].x, this.geo.tegels[p.t].y), Math.max(4, T), performance.now());
      }
      for (const b of land.bouw) this.tekenGebouw(c, land, b.tegel, b.gebouw, T, rand, detail, (s.dag - b.start) / Math.max(1, b.klaar - b.start), 1);
    }
  }

  vakje(c, x, y, T, rand, alpha) {
    const m = T * 0.42;
    c.globalAlpha = alpha;
    c.fillStyle = 'rgba(10,15,21,0.82)';
    c.strokeStyle = rand;
    c.lineWidth = Math.max(1, T * 0.07);
    c.beginPath();
    c.roundRect(x - m, y - m, m * 2, m * 2, T * 0.12);
    c.fill();
    c.stroke();
    c.globalAlpha = 1;
  }

  tekenGebouw(c, land, t, gebouwId, T, rand, detail, voortgang, eff, p) {
    const tegel = this.geo.tegels[t];
    if (!tegel || !this.zichtbaar(tegel)) return;
    const g = this.state.pack.gebouwIndex[gebouwId];
    const [x, y] = this.naarScherm(tegel.x, tegel.y);
    if (this.zoom >= DIEP) {
      const soort = g.tekening ?? TEKENING_ALIAS[g.id] ?? g.id;
      const gelukt = tekenGebouwDetail(c, soort, x, y, T, {
        regime: land.regime, kleur: rand, tijd: performance.now() / 1000, seed: t,
        actief: voortgang == null && (eff ?? 1) > 0, voortgang: voortgang == null ? null : clamp(voortgang, 0, 1),
        eff: eff ?? 1, aantal: land.gebouwen[gebouwId] ?? 1, niveau: p?.niveau ?? null, L: land.L, capaciteit: this.woningenVan(land), basis: land.basisWoningen, uit: (p?.uit ?? 0) > this.state.dag, nacht: this.nacht ?? 0, stab: land.stab, welvaart: land.Y / Math.max(1, this.state.wereldY / this.state.landen.length),
      });
      if (gelukt) {
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
      c.font = `${Math.round(T * 0.52)}px ${EMOJI}`;
      c.fillText(g.icoon ?? '■', x, y + 1);
      c.globalAlpha = 1;
      c.fillStyle = '#0c131b';
      c.fillRect(x - T * 0.4, y + T * 0.32, T * 0.8, T * 0.1);
      c.fillStyle = '#f0b429';
      c.fillRect(x - T * 0.4, y + T * 0.32, T * 0.8 * clamp(voortgang, 0, 1), T * 0.1);
      return;
    }
    this.vakje(c, x, y, T, rand, 1);
    c.font = `${Math.round(T * 0.56)}px ${EMOJI}`;
    c.fillText(g.icoon ?? '■', x, y + 1);
    if (eff < 0.95 && this.zoom >= 2.4 && land.idx === this.state.speler) {
      c.font = `600 ${Math.max(8, Math.round(T * 0.26))}px -apple-system, sans-serif`;
      c.fillStyle = eff < 0.7 ? '#f2706a' : '#f0b429';
      c.fillText(`${Math.round(eff * 100)}%`, x, y - T * 0.55);
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
        // ingezoomd: label boven de hoofdstad, zodat het gebouwen niet bedekt
        const h = this.geo.tegels[this.geo.hoofdstad[l.idx]];
        if (h) [x, y] = this.naarScherm(h.x, h.y - this.geo.T * 0.9);
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
