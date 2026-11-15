// Levende kaart (C14a): gebeurtenissen krijgen een plek op de kaart. Een ping op de tegel (uitdijende ringen, dan een
// speld), een pijl aan de schermrand als hij buiten beeld ligt, en een tijdlijn met chips links in het kaartvenster.
// Daarnaast bezit LevendeKaart de voertuigkaart (voertuigkaart.js): tik op een auto of vrachtwagen en volg hem.
//
// De detectie (Pings.waarneem) is puur: hij leest de toestand, vergelijkt met een eigen momentopname en verandert de
// toestand nooit. Geen DOM bij het importeren: CSS en DOM komen pas in de constructor van LevendeKaart of in
// maakTijdlijn(), en alleen als er een document is. Zo draait tools/pingtest.mjs in node.
// Op het canvas staat geen tekst en geen emoji; teksten verschijnen alleen in de tijdlijn (tooltip of tikken).

import { pictogramVan, trapKleur, tekenPictogram } from './brandhaard.js';
import { brandhaardSoort } from '../engine/brandhaarden.js';
import { partij, inOorlog } from '../engine/leger.js';
import { VoertuigKaart } from './voertuigkaart.js';

// ---------- teksten en pictogrammen (UI-tekst, geen balans) ----------

export const PING_TEKST = {
  oplevering: (naam) => `${naam} opgeleverd`,
  brandhaard: (naam) => `Brandhaard: ${naam}`,
  brandhaardTrap: (naam) => `Brandhaard loopt op: ${naam}`,
  brandhaardOpgelost: (naam) => `Opgelost: ${naam}`,
  brandhaardUit: (naam) => `Uitgebarsten: ${naam}`,
  oorlog: (wie) => `Oorlog met ${wie}`,
  vrede: (wie) => `Vrede met ${wie}`,
  veroverd: (wie) => `Gebied veroverd op ${wie}`,
  verloren: (wie) => `Gebied verloren aan ${wie}`,
  verovering: (a, b) => `${a} verovert gebied van ${b}`,
  verlies: () => 'Eenheid verloren',
  kolonie: (naam) => `Kolonie gesticht: ${naam}`,
  kolonieAnder: (land) => `${land} sticht een kolonie`,
  rit: 'Rit beëindigd',
};
// Per soort: pictogram en de zoom waarop een tik ernaartoe vliegt.
export const PING_SOORT = {
  oplevering: { pict: 'huisje', zoom: 6 },
  brandhaard: { pict: 'zuil', zoom: 4 },
  oorlog: { pict: 'zwaarden', zoom: 3 },
  vrede: { pict: 'duif', zoom: 3 },
  verovering: { pict: 'vesting', zoom: 3 },
  verlies: { pict: 'schild', zoom: 4 },
  kolonie: { pict: 'vlag', zoom: 3 },
};
export const ERNST_KLEUR = { goed: '#5fd38d', slecht: '#e5484d', info: '#8fb8ff' };
const ERNST_RANG = { slecht: 0, goed: 1, info: 2 };
// Wat nooit door info of verlies verdrongen wordt.
const BESCHERMD = { oplevering: 1, oorlog: 1, vrede: 1 };

export const PING_MAX = 30;          // pings in de lijst
export const PER_DAG = 4;            // nieuwe pings per waarneming (per dag)
export const SPRONG = 30;            // meer dagen ineens: alleen een nieuwe momentopname
export const VERLIES_DAGEN = 10, VERLIES_TEGELS = 4;
export const ZELF_GEZIEN_MS = 30000, ZELF_GEZIEN_DAGEN = 60;
const RING_MS = 6000, RING_DUUR = 2400, VERVAAG_MS = 1000;
const OP_KAART = 6, PIJL_MAX = 5, PIJL_R = 15, PIJL_RAND = 28, PIJL_SAMEN = 36;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Minder beweging gevraagd? (eigen kopie; geenBeweging in brandhaard.js is niet geëxporteerd)
let stil = null;
function rustig() {
  if (stil == null) { try { stil = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { stil = false; } }
  return stil;
}

// Loopt er bij deze haard een aanpak die nog moet landen (h.wacht, veld uit C14d)? Dan is een hogere trap geen nieuws.
function lopendeAanpak(h) {
  const w = h.wacht;
  if (w == null) return false;
  if (Array.isArray(w)) return w.length > 0;
  return !!w;
}

// ---------- detectie ----------

export class Pings {
  constructor() {
    this.lijst = [];
    this.state = null;
    this.dag = -1;
    this.grensVersie = -1;
    this.volgId = 1;
    // momentopname
    this.bouw = [];        // [gebouw, tegel] van de speler
    this.haarden = [];     // { id, trap, tegel, soort, druk, deadline }
    this.oorlogen = [];    // sleutels a|b|start
    this.eigenaar = null;  // Int16Array
    this.eenheidId = [];   // eigen eenheden: id, en x, y in eenheidXY
    this.eenheidXY = [];
    this.kolonies = [];    // k.t
    this.versie = 0;       // telt bij elke wijziging van de lijst (voor de tijdlijn)
  }

  // Elke beeld aanroepen; werkt alleen als de dag of de grens veranderde.
  waarneem(state, echtMs = 0) {
    if (!state || !state.landen) return;
    if (state !== this.state) {
      this.state = state;
      if (this.lijst.length) { this.lijst.length = 0; this.versie++; }
      this.opname(state, true);
      return;
    }
    this.verouder(state.dag, echtMs);
    if (state.dag === this.dag && state.grensVersie === this.grensVersie) return;
    if (state.dag - this.dag > SPRONG || state.dag < this.dag) { this.opname(state, true); return; }
    const nieuw = [];
    this.zoekOplevering(state, nieuw);
    this.zoekBrandhaarden(state, nieuw);
    this.zoekOorlogen(state, nieuw);
    if (state.grensVersie !== this.grensVersie) this.zoekVerovering(state, nieuw);
    this.zoekKolonies(state, nieuw);
    this.zoekVerlies(state, nieuw, echtMs);
    // maak() geeft null voor een tegel buiten de kaart: die vallen weg vóór het sorteren
    let n = 0;
    for (let i = 0; i < nieuw.length; i++) if (nieuw[i]) nieuw[n++] = nieuw[i];
    nieuw.length = n;
    if (nieuw.length > PER_DAG) {
      // alleen de zwaarste: slecht, dan goed, dan info (bij gelijk de volgorde van vinden)
      for (let i = 0; i < nieuw.length; i++) nieuw[i]._i = i;
      nieuw.sort((a, b) => ERNST_RANG[a.ernst] - ERNST_RANG[b.ernst] || a._i - b._i);
      nieuw.length = PER_DAG;
    }
    for (let i = 0; i < nieuw.length; i++) this.voegToe(nieuw[i], state, echtMs);
    this.opname(state, state.grensVersie !== this.grensVersie);
  }

  // Vanzelf gezien na 30 s echte tijd of 60 speeldagen.
  verouder(dag, echtMs) {
    const L = this.lijst;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (p.gezienOp != null) continue;
      if (echtMs - p.geboren >= ZELF_GEZIEN_MS || dag - p.dag >= ZELF_GEZIEN_DAGEN) this.markeer(p, echtMs);
    }
  }

  markeer(p, echtMs) {
    if (p.gezienOp != null) return;
    p.gezienOp = echtMs;
    p.gezien = Math.max(p.gezien, 0.001);
    this.versie++;
  }

  // Een ping aanmaken (zonder hem toe te voegen).
  maak(state, soort, t, ernst, tekst, land, pict = null) {
    const geo = state.pack.geo;
    if (!(t >= 0 && t < geo.tegels.length)) return null;
    const tg = geo.tegels[t], S = PING_SOORT[soort];
    return { id: 0, soort, t, wx: tg.x, wy: tg.y, land, ernst, pict: pict ?? S.pict, tekst, dag: state.dag, geboren: 0, zichtMs: 0, gezien: 0, gezienOp: null, vliegZoom: S.zoom, aantal: 1, kleur: null };
  }

  voegToe(p, state, echtMs) {
    if (!p) return;
    p.id = this.volgId++;
    p.geboren = echtMs;
    p.dag = state.dag;
    const L = this.lijst;
    if (L.length >= PING_MAX) {
      // eerst de oudste info- of verliesping; oplevering, oorlog en vrede wijken nooit voor info of verlies
      let weg = -1;
      for (let i = 0; i < L.length; i++) if (L[i].ernst === 'info' || L[i].soort === 'verlies') { weg = i; break; }
      if (weg < 0) {
        if (p.ernst === 'info' || p.soort === 'verlies') return;
        for (let i = 0; i < L.length; i++) if (!BESCHERMD[L[i].soort]) { weg = i; break; }
        if (weg < 0) weg = 0;
      }
      L.splice(weg, 1);
    }
    L.push(p);
    this.versie++;
  }

  zoekOplevering(state, uit) {
    const c = state.landen[state.speler];
    if (!c) return;
    const B = this.bouw, nu = c.bouw;
    for (let i = 0; i < B.length; i += 2) {
      const g = B[i], t = B[i + 1];
      let nog = false;
      for (let j = 0; j < nu.length; j++) if (nu[j].gebouw === g && nu[j].tegel === t) { nog = true; break; }
      if (nog) continue;
      const b = state.bezet[t];
      if (!b || b.land !== state.speler || b.gebouw !== g || b.bouw !== false) continue;
      const naam = state.pack.gebouwIndex[g]?.naam ?? g;
      uit.push(this.maak(state, 'oplevering', t, 'goed', PING_TEKST.oplevering(naam), state.speler));
    }
  }

  zoekBrandhaarden(state, uit) {
    const lijst = state.brandhaarden ?? [], H = this.haarden;
    for (let i = 0; i < lijst.length; i++) {
      const h = lijst[i];
      if (h.land !== state.speler) continue;
      let oud = null;
      for (let j = 0; j < H.length; j++) if (H[j].id === h.id) { oud = H[j]; break; }
      const soort = brandhaardSoort(state, h.soort), naam = (soort?.naam ?? 'onrust').toLowerCase();
      if (!oud) {
        const p = this.maak(state, 'brandhaard', h.tegel, 'slecht', PING_TEKST.brandhaard(naam), h.land, pictogramVan(state, soort));
        if (p) { p.kleur = trapKleur(state, h); uit.push(p); }
      } else if (h.trap > oud.trap && !lopendeAanpak(h)) {
        const p = this.maak(state, 'brandhaard', h.tegel, 'slecht', PING_TEKST.brandhaardTrap(naam), h.land, pictogramVan(state, soort));
        if (p) { p.kleur = trapKleur(state, h); uit.push(p); }
      }
    }
    for (let j = 0; j < H.length; j++) {
      const o = H[j];
      let nog = false;
      for (let i = 0; i < lijst.length; i++) if (lijst[i].id === o.id) { nog = true; break; }
      if (nog) continue;
      const soort = brandhaardSoort(state, o.soort), naam = (soort?.naam ?? 'onrust').toLowerCase();
      // weg na de deadline of bij hoge druk: uitgebarsten; anders opgelost
      const uitgebarsten = state.dag >= o.deadline || o.druk >= 90;
      uit.push(this.maak(state, 'brandhaard', o.tegel, uitgebarsten ? 'slecht' : 'goed',
        uitgebarsten ? PING_TEKST.brandhaardUit(naam) : PING_TEKST.brandhaardOpgelost(naam), state.speler, pictogramVan(state, soort)));
    }
  }

  // Het eerste land (op index) van een partij, en zijn hoofdstadtegel.
  landVanPartij(state, p) {
    if (p.startsWith('land:')) return +p.slice(5);
    for (let i = 0; i < state.landen.length; i++) if (partij(state, state.landen[i]) === p) return i;
    return -1;
  }
  partijNaam(state, p) {
    if (p.startsWith('land:')) return state.landen[+p.slice(5)]?.naam ?? '?';
    const b = (state.blokken ?? []).find((x) => x.id === p);
    return b?.naam ?? p;
  }

  zoekOorlogen(state, uit) {
    const c = state.landen[state.speler];
    if (!c) return;
    const P = partij(state, c), O = state.oorlogen ?? [], oud = this.oorlogen;
    const sleutel = (o) => `${o.a}|${o.b}|${o.start}`;
    const geo = state.pack.geo;
    for (let i = 0; i < O.length; i++) {
      const o = O[i];
      if (o.a !== P && o.b !== P) continue;
      const k = sleutel(o);
      if (oud.indexOf(k) >= 0) continue;
      const ander = o.a === P ? o.b : o.a, li = this.landVanPartij(state, ander);
      if (li < 0) continue;
      uit.push(this.maak(state, 'oorlog', geo.hoofdstad[li], 'slecht', PING_TEKST.oorlog(this.partijNaam(state, ander)), li));
    }
    for (let j = 0; j < oud.length; j++) {
      const k = oud[j];
      let nog = false;
      for (let i = 0; i < O.length; i++) if (sleutel(O[i]) === k) { nog = true; break; }
      if (nog) continue;
      const [a, b] = k.split('|');
      if (a !== P && b !== P) continue;
      const ander = a === P ? b : a, li = this.landVanPartij(state, ander);
      if (li < 0) continue;
      uit.push(this.maak(state, 'vrede', geo.hoofdstad[li], 'goed', PING_TEKST.vrede(this.partijNaam(state, ander)), li));
    }
  }

  zoekVerovering(state, uit) {
    const E = state.eigenaar, oud = this.eigenaar;
    if (!E || !oud || oud.length !== E.length) return;
    const geo = state.pack.geo, sp = state.speler;
    // per paar (oud, nieuw): som van de plekken en het aantal, daarna de tegel die het dichtst bij het zwaartepunt ligt
    const paren = [];
    for (let t = 0; t < E.length; t++) {
      const a = oud[t], b = E[t];
      if (a === b || a < 0 || b < 0) continue;
      let p = null;
      for (let i = 0; i < paren.length; i++) if (paren[i].a === a && paren[i].b === b) { p = paren[i]; break; }
      if (!p) { p = { a, b, x: 0, y: 0, n: 0, best: -1, bd: Infinity }; paren.push(p); }
      p.x += geo.tegels[t].x; p.y += geo.tegels[t].y; p.n++;
    }
    if (!paren.length) return;
    for (let t = 0; t < E.length; t++) {
      const a = oud[t], b = E[t];
      if (a === b || a < 0 || b < 0) continue;
      for (let i = 0; i < paren.length; i++) {
        const p = paren[i];
        if (p.a !== a || p.b !== b) continue;
        const d = Math.hypot(geo.tegels[t].x - p.x / p.n, geo.tegels[t].y - p.y / p.n);
        if (d < p.bd) { p.bd = d; p.best = t; }
      }
    }
    const L = state.landen, spC = L[sp];
    for (let i = 0; i < paren.length; i++) {
      const p = paren[i], A = L[p.a], B = L[p.b];
      if (!A || !B) continue;
      if (p.b === sp) uit.push(this.maak(state, 'verovering', p.best, 'goed', PING_TEKST.veroverd(A.naam), p.b));
      else if (p.a === sp) uit.push(this.maak(state, 'verovering', p.best, 'slecht', PING_TEKST.verloren(B.naam), p.b));
      else if (spC && (inOorlog(state, spC, A) || inOorlog(state, spC, B))) uit.push(this.maak(state, 'verovering', p.best, 'info', PING_TEKST.verovering(B.naam, A.naam), p.b));
    }
  }

  zoekKolonies(state, uit) {
    const K = state.kolonies ?? [], oud = this.kolonies;
    for (let i = 0; i < K.length; i++) {
      const k = K[i];
      if (oud.indexOf(k.t) >= 0) continue;
      const eigen = k.land === state.speler;
      uit.push(this.maak(state, 'kolonie', k.t, eigen ? 'goed' : 'info', eigen ? PING_TEKST.kolonie(k.naam ?? '') : PING_TEKST.kolonieAnder(state.landen[k.land]?.naam ?? '?'), k.land));
    }
  }

  zoekVerlies(state, uit, echtMs) {
    const U = state.eenheden ?? [], ids = this.eenheidId, XY = this.eenheidXY, geo = state.pack.geo, T = geo.T, sp = state.speler;
    if (!ids.length) return;
    const nog = new Set();
    for (let i = 0; i < U.length; i++) if (U[i].land === sp) nog.add(U[i].id);
    for (let e = 0; e < ids.length; e++) {
      if (nog.has(ids[e])) continue;
      const x = XY[2 * e], y = XY[2 * e + 1];
      // stichtKolonie haalt de eenheid weg: geen verlies als er sinds de vorige opname (op tempo 8 kunnen dat een paar
      // dagen zijn) een eigen kolonie binnen 1 tegel bij kwam
      let kolonie = false;
      const K = state.kolonies ?? [];
      for (let i = 0; i < K.length && !kolonie; i++) {
        const k = K[i];
        if (k.land !== sp || (k.dag !== state.dag && this.kolonies.indexOf(k.t) >= 0)) continue;
        const tg = geo.tegels[k.t];
        if (tg && Math.hypot(tg.x - x, tg.y - y) <= T * 1.5) kolonie = true;
      }
      if (kolonie) continue;
      // samenvoegen met een verliesping in de buurt (lijst of nieuw van deze waarneming)
      let samen = null;
      for (const L of [uit, this.lijst]) {
        for (let i = L.length - 1; i >= 0 && !samen; i--) {
          const p = L[i];
          if (!p || p.soort !== 'verlies' || state.dag - p.dag > VERLIES_DAGEN) continue;
          if (Math.hypot(p.wx - x, p.wy - y) <= VERLIES_TEGELS * T) samen = p;
        }
        if (samen) break;
      }
      if (samen) { samen.aantal++; if (this.lijst.includes(samen)) this.versie++; continue; }
      const k = Math.floor(x / T), r = Math.floor(y / T);
      const t = r * geo.kol + k;
      const p = this.maak(state, 'verlies', t, 'slecht', PING_TEKST.verlies(), sp);
      if (p) { p.wx = x; p.wy = y; uit.push(p); }
    }
    void echtMs;
  }

  // Momentopname van wat de detectoren vergelijken.
  opname(state, grens) {
    this.dag = state.dag;
    const c = state.landen[state.speler];
    this.bouw.length = 0;
    if (c) for (let i = 0; i < c.bouw.length; i++) this.bouw.push(c.bouw[i].gebouw, c.bouw[i].tegel);
    this.haarden.length = 0;
    const H = state.brandhaarden ?? [];
    for (let i = 0; i < H.length; i++) {
      const h = H[i];
      if (h.land === state.speler) this.haarden.push({ id: h.id, trap: h.trap, tegel: h.tegel, soort: h.soort, druk: h.druk, deadline: h.deadline });
    }
    this.oorlogen.length = 0;
    const O = state.oorlogen ?? [];
    for (let i = 0; i < O.length; i++) this.oorlogen.push(`${O[i].a}|${O[i].b}|${O[i].start}`);
    if (grens || !this.eigenaar || this.eigenaar.length !== state.eigenaar.length) {
      if (!this.eigenaar || this.eigenaar.length !== state.eigenaar.length) this.eigenaar = new Int16Array(state.eigenaar.length);
      this.eigenaar.set(state.eigenaar);
    }
    this.grensVersie = state.grensVersie;
    this.eenheidId.length = 0; this.eenheidXY.length = 0;
    const U = state.eenheden ?? [];
    for (let i = 0; i < U.length; i++) if (U[i].land === state.speler) { this.eenheidId.push(U[i].id); this.eenheidXY.push(U[i].x, U[i].y); }
    this.kolonies.length = 0;
    const K = state.kolonies ?? [];
    for (let i = 0; i < K.length; i++) this.kolonies.push(K[i].t);
  }
}

// ---------- pictogrammen ----------

// Eigen vectorpictogrammen naast die van brandhaard.js; z is de halve breedte.
export function tekenPict(c, soort, x, y, z, kleur) {
  if (soort === 'huisje' || soort === 'zuil' || soort === 'bliksem' || soort === 'aar' || soort === 'golf' || soort === 'tandwiel') {
    tekenPictogram(c, soort, x, y, z, kleur); return;
  }
  c.fillStyle = kleur; c.strokeStyle = kleur;
  c.lineWidth = Math.max(1.2, z * 0.24); c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  if (soort === 'zwaarden') {
    for (const k of [-1, 1]) {
      c.moveTo(x - k * z * 0.85, y - z * 0.85); c.lineTo(x + k * z * 0.7, y + z * 0.7);
      c.moveTo(x + k * z * 0.35, y + z * 0.75); c.lineTo(x + k * z * 0.75, y + z * 0.35);
    }
    c.stroke();
  } else if (soort === 'duif') {
    c.ellipse(x - z * 0.1, y + z * 0.15, z * 0.7, z * 0.38, -0.25, 0, Math.PI * 2);
    c.moveTo(x - z * 0.2, y); c.lineTo(x + z * 0.45, y - z * 0.95); c.lineTo(x + z * 0.35, y + z * 0.05);
    c.moveTo(x + z * 0.5, y - z * 0.1); c.arc(x + z * 0.55, y - z * 0.1, z * 0.22, 0, Math.PI * 2);
    c.fill();
  } else if (soort === 'schild') {
    c.moveTo(x, y - z); c.lineTo(x + z * 0.85, y - z * 0.6); c.lineTo(x + z * 0.7, y + z * 0.25);
    c.quadraticCurveTo(x + z * 0.4, y + z * 0.75, x, y + z); c.quadraticCurveTo(x - z * 0.4, y + z * 0.75, x - z * 0.7, y + z * 0.25);
    c.lineTo(x - z * 0.85, y - z * 0.6); c.closePath(); c.fill();
  } else if (soort === 'vlag') {
    c.moveTo(x - z * 0.6, y + z); c.lineTo(x - z * 0.6, y - z);
    c.stroke();
    c.beginPath();
    c.moveTo(x - z * 0.6, y - z); c.lineTo(x + z * 0.85, y - z * 0.55); c.lineTo(x - z * 0.6, y - z * 0.1); c.closePath(); c.fill();
  } else {
    // vesting: toren met kantelen
    c.moveTo(x - z * 0.75, y + z); c.lineTo(x - z * 0.75, y - z * 0.75); c.lineTo(x - z * 0.4, y - z * 0.75); c.lineTo(x - z * 0.4, y - z * 0.45);
    c.lineTo(x - z * 0.15, y - z * 0.45); c.lineTo(x - z * 0.15, y - z * 0.75); c.lineTo(x + z * 0.15, y - z * 0.75); c.lineTo(x + z * 0.15, y - z * 0.45);
    c.lineTo(x + z * 0.4, y - z * 0.45); c.lineTo(x + z * 0.4, y - z * 0.75); c.lineTo(x + z * 0.75, y - z * 0.75); c.lineTo(x + z * 0.75, y + z);
    c.lineTo(x + z * 0.22, y + z); c.lineTo(x + z * 0.22, y + z * 0.35); c.lineTo(x - z * 0.22, y + z * 0.35); c.lineTo(x - z * 0.22, y + z);
    c.closePath(); c.fill();
  }
}

// Dezelfde pictogrammen als inline-SVG voor de chips (viewBox 24 x 24, kleur via currentColor).
const SVG_PAD = {
  huisje: '<path d="M2 12 12 3l10 9h-3v9h-5v-6h-4v6H5v-9z" fill="currentColor"/>',
  zuil: '<path d="M3 3h18v3.5H3zM2 18h20v3.5H2zM5.5 7.5h3v10h-3zM10.5 7.5h3v10h-3zM15.5 7.5h3v10h-3z" fill="currentColor"/>',
  bliksem: '<path d="M14 2 5 13.5h6L9 22l10-12.5h-6.5z" fill="currentColor"/>',
  aar: '<path d="M12 22V5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><ellipse cx="8.5" cy="8" rx="3.4" ry="1.7" transform="rotate(35 8.5 8)" fill="currentColor"/><ellipse cx="15.5" cy="8" rx="3.4" ry="1.7" transform="rotate(-35 15.5 8)" fill="currentColor"/><ellipse cx="8.5" cy="13" rx="3.4" ry="1.7" transform="rotate(35 8.5 13)" fill="currentColor"/><ellipse cx="15.5" cy="13" rx="3.4" ry="1.7" transform="rotate(-35 15.5 13)" fill="currentColor"/><ellipse cx="12" cy="3.2" rx="1.6" ry="2.6" fill="currentColor"/>',
  golf: '<path d="M2 9c3-4 5 4 8 0s5 4 8 0 3 0 4 0M2 16c3-4 5 4 8 0s5 4 8 0 3 0 4 0" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
  tandwiel: '<path fill="currentColor" fill-rule="evenodd" d="M10 2h4l.6 3 2.4 1.4 2.9-1 2 3.4-2.3 2v2.4l2.3 2-2 3.4-2.9-1-2.4 1.4-.6 3h-4l-.6-3L7 18.8l-2.9 1-2-3.4 2.3-2v-2.4l-2.3-2 2-3.4 2.9 1L9.4 5zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
  zwaarden: '<path d="M3 3l17 17M21 3 4 20M14 20l6-6M10 20l-6-6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
  duif: '<ellipse cx="10.5" cy="14" rx="8" ry="4.3" transform="rotate(-14 10.5 14)" fill="currentColor"/><path d="M9.5 12 16 2l-1 11z" fill="currentColor"/><circle cx="18.5" cy="10.5" r="2.6" fill="currentColor"/>',
  schild: '<path d="M12 2l9 4-1.6 9c-1 4-4.4 6-7.4 7-3-1-6.4-3-7.4-7L3 6z" fill="currentColor"/>',
  vlag: '<path d="M5 22V2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5 2l15 5-15 5z" fill="currentColor"/>',
  vesting: '<path d="M3 22V3h4v4h3V3h4v4h3V3h4v19h-6.5v-7h-5v7z" fill="currentColor"/>',
  meer: '<circle cx="5" cy="12" r="2.3" fill="currentColor"/><circle cx="12" cy="12" r="2.3" fill="currentColor"/><circle cx="19" cy="12" r="2.3" fill="currentColor"/>',
};
export const svgVan = (pict) => `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG_PAD[pict] ?? SVG_PAD.vlag}</svg>`;

// ---------- de laag op het canvas ----------

export class PingLaag {
  constructor() {
    this.treffers = [];   // { sx, sy, ping } van het laatst getekende beeld (pinnen en pijlen)
    this.nTreffer = 0;
    this.pijlen = [];     // werklijst randpijlen
    this.tegels = [];     // al getekende tegels in dit beeld
    this.vorigNu = null;
    this.tijdlijnVak = null; // { x, y, w, h } in schermpixels van het canvas, gezet door LevendeKaart
    this.legendaVak = null;  // idem voor de legenda linksonder (pijlen eronder zouden erachter verdwijnen)
  }

  treffer(sx, sy, ping) {
    let o = this.treffers[this.nTreffer];
    if (!o) { o = { sx: 0, sy: 0, ping: null }; this.treffers[this.nTreffer] = o; }
    o.sx = sx; o.sy = sy; o.ping = ping;
    this.nTreffer++;
  }

  teken(c, view, pings, nu) {
    this.nTreffer = 0;
    const L = pings.lijst;
    const dt = this.vorigNu == null ? 0 : clamp(nu - this.vorigNu, 0, 250);
    this.vorigNu = nu;
    if (!L.length) return;
    const geo = view.geo, sc = view.schaal(), T = geo.T * sc, w = view.w, h = view.h;
    const beweeg = !rustig();
    const drempel = view.zoom >= 1.5 ? 2000 : 4000;
    let nKaart = 0, nPijl = 0;
    this.tegels.length = 0;
    c.save();
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      const sx = (p.wx - view.cx) * sc + w / 2, sy = (p.wy - view.cy) * sc + h / 2;
      const inBeeld = sx >= 0 && sy >= 0 && sx <= w && sy <= h;
      // gezien: lang genoeg in beeld (op elke zoom)
      if (p.gezienOp == null && inBeeld) {
        p.zichtMs += dt;
        if (p.zichtMs >= drempel) pings.markeer(p, nu);
      }
      let a = 1;
      if (p.gezienOp != null) {
        p.gezien = clamp((nu - p.gezienOp) / VERVAAG_MS, 0.001, 1);
        a = 1 - p.gezien;
        if (a <= 0.01) continue;
      }
      if (inBeeld) {
        if (nKaart >= OP_KAART || this.tegels.indexOf(p.t) >= 0) continue;
        this.tegels.push(p.t);
        nKaart++;
        this.tekenPing(c, p, sx, sy, T, nu, a, beweeg);
        this.treffer(sx, sy, p);
      } else if (p.gezienOp == null && p.ernst !== 'info' && nPijl < 16) {
        let q = this.pijlen[nPijl];
        if (!q) { q = { x: 0, y: 0, ex: 0, ey: 0, ping: null, n: 0 }; this.pijlen[nPijl] = q; }
        q.x = sx; q.y = sy; q.ping = p; q.n = 1;
        nPijl++;
      }
    }
    if (nPijl) this.tekenPijlen(c, view, nPijl, nu, beweeg);
    c.restore();
  }

  tekenPing(c, p, x, y, T, nu, a, beweeg) {
    const kleur = ERNST_KLEUR[p.ernst];
    const leeftijd = nu - p.geboren;
    c.globalAlpha = a;
    if (p.soort !== 'oplevering' && p.gezienOp == null && leeftijd < RING_MS) {
      const r = Math.max(12, T * 0.5);
      c.strokeStyle = kleur;
      if (beweeg) {
        c.lineWidth = 2.5;
        for (let k = 0; k < 3; k++) {
          const f = (((leeftijd + k * RING_DUUR / 3) % RING_DUUR) + RING_DUUR) % RING_DUUR / RING_DUUR;
          c.globalAlpha = a * (1 - f) * 0.9;
          c.beginPath(); c.arc(x, y, r * (0.45 + 1.25 * f), 0, Math.PI * 2); c.stroke();
        }
      } else {
        c.lineWidth = 2;
        c.globalAlpha = a * 0.85;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.arc(x, y, r * 1.45, 0, Math.PI * 2); c.stroke();
      }
      c.globalAlpha = a;
    }
    // speld: rondje van 9 px op een steeltje, met het pictogram
    const py = y - 13;
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(x + 1, y + 1, 4, 1.8, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = kleur; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, py + 6); c.stroke();
    c.fillStyle = '#0d141c';
    c.beginPath(); c.arc(x, py, 10.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = kleur;
    c.beginPath(); c.arc(x, py, 9, 0, Math.PI * 2); c.fill();
    if (p.kleur) { c.strokeStyle = p.kleur; c.lineWidth = 1.5; c.beginPath(); c.arc(x, py, 9, 0, Math.PI * 2); c.stroke(); }
    tekenPict(c, p.pict, x, py, 5, '#0d141c');
    if (p.aantal > 1) this.stipjes(c, x, py + 15, Math.min(3, p.aantal), kleur);
    c.globalAlpha = 1;
  }

  stipjes(c, x, y, n, kleur) {
    c.fillStyle = kleur;
    for (let k = 0; k < n; k++) { c.beginPath(); c.arc(x + (k - (n - 1) / 2) * 5, y, 1.7, 0, Math.PI * 2); c.fill(); }
  }

  // Plek aan de rand: geklemd binnen 28 px, buiten de verboden zones (kaartknoppen, doelbalk, tijdlijn).
  randPlek(q, view) {
    const w = view.w, h = view.h, m = PIJL_RAND;
    const mx = w / 2, my = h / 2;
    // langs de lijn van het midden naar de ping tot de binnenrand
    const dx = q.x - mx, dy = q.y - my;
    const fx = dx ? (dx > 0 ? (w - m - mx) / dx : (m - mx) / dx) : Infinity;
    const fy = dy ? (dy > 0 ? (h - m - my) / dy : (m - my) / dy) : Infinity;
    const f = Math.min(fx, fy, 1);
    let ex = mx + dx * f, ey = my + dy * f;
    ex = clamp(ex, m, w - m); ey = clamp(ey, m, h - m);
    const R = PIJL_R;
    // boven: de doelbalk
    if (ey < 56 + R) ey = 56 + R;
    // rechtsonder: de kaartknoppen (60 x 190)
    if (ex > w - 60 - R && ey > h - 190 - R) {
      if ((ex - (w - 60 - R)) < (ey - (h - 190 - R))) ex = w - 60 - R; else ey = h - 190 - R;
    }
    // de legenda linksonder: erboven zetten, met ruimte voor de pijlpunt
    const G = this.legendaVak;
    if (G && G.h > 0 && ex < G.x + G.w + R && ey > G.y - R - 10) ey = G.y - R - 10;
    // de tijdlijnkolom
    const V = this.tijdlijnVak;
    if (V && V.h > 0 && ex < V.x + V.w + R && ey > V.y - R && ey < V.y + V.h + R) {
      const naarRechts = V.x + V.w + R - ex, naarOnder = V.y + V.h + R - ey;
      if (naarRechts < naarOnder) ex = V.x + V.w + R; else ey = V.y + V.h + R;
    }
    q.ex = clamp(ex, m, w - m); q.ey = clamp(ey, m, h - m);
  }

  tekenPijlen(c, view, n, nu, beweeg) {
    const P = this.pijlen;
    for (let i = 0; i < n; i++) this.randPlek(P[i], view);
    // samenvoegen: binnen 36 px wordt één pijl (de zwaarste blijft staan)
    for (let i = 0; i < n; i++) {
      const a = P[i];
      if (!a.n) continue;
      for (let j = i + 1; j < n; j++) {
        const b = P[j];
        if (!b.n || Math.hypot(a.ex - b.ex, a.ey - b.ey) >= PIJL_SAMEN) continue;
        if (ERNST_RANG[b.ping.ernst] < ERNST_RANG[a.ping.ernst]) { a.ping = b.ping; a.x = b.x; a.y = b.y; a.ex = b.ex; a.ey = b.ey; }
        a.n += b.n; b.n = 0;
      }
    }
    let getekend = 0;
    for (let i = 0; i < n && getekend < PIJL_MAX; i++) {
      const q = P[i];
      if (!q.n) continue;
      getekend++;
      const kleur = ERNST_KLEUR[q.ping.ernst];
      const hoek = Math.atan2(q.y - q.ey, q.x - q.ex);
      const wieg = beweeg ? Math.sin(nu / 180) * 2 : 0;
      const ex = q.ex, ey = q.ey;
      c.globalAlpha = 1;
      // pijlpunt buiten de cirkel, in de richting van de ping
      c.save();
      c.translate(ex, ey); c.rotate(hoek);
      c.fillStyle = kleur;
      c.beginPath(); c.moveTo(PIJL_R + 9 + wieg, 0); c.lineTo(PIJL_R - 1 + wieg, -7); c.lineTo(PIJL_R - 1 + wieg, 7); c.closePath(); c.fill();
      c.restore();
      c.fillStyle = 'rgba(13,20,28,0.92)';
      c.beginPath(); c.arc(ex, ey, PIJL_R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = kleur; c.lineWidth = 2;
      c.beginPath(); c.arc(ex, ey, PIJL_R - 1, 0, Math.PI * 2); c.stroke();
      tekenPict(c, q.ping.pict, ex, ey - (q.n > 1 ? 2 : 0), 7, kleur);
      if (q.n > 1) this.stipjes(c, ex, ey + 9, Math.min(3, q.n), kleur);
      this.treffer(ex, ey, q.ping);
    }
  }

  // De ping of pijl onder een schermpunt (22 px op touch, 14 px met de muis), of null.
  op(sx, sy, touch) {
    const r = touch ? 22 : 14;
    let best = null, bd = r;
    for (let i = 0; i < this.nTreffer; i++) {
      const o = this.treffers[i];
      // de speld staat boven de tegel: ook het rondje telt
      const d = Math.min(Math.hypot(o.sx - sx, o.sy - sy), Math.hypot(o.sx - sx, o.sy - 13 - sy));
      if (d < bd) { bd = d; best = o.ping; }
    }
    return best;
  }
}

// ---------- tijdlijn (DOM) ----------

let cssGeladen = false;
export function laadCss() {
  if (cssGeladen || typeof document === 'undefined') return;
  cssGeladen = true;
  if (document.querySelector('link[data-levend]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'css/levend.css'; l.dataset.levend = '1';
  document.head.appendChild(l);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function maakTijdlijn(wrap) {
  if (typeof document === 'undefined' || !wrap) return null;
  laadCss();
  const el = document.createElement('div');
  el.id = 'tijdlijn';
  el.hidden = true;
  const chips = document.createElement('div');
  chips.className = 'tl-chips';
  const uitleg = document.createElement('div');
  uitleg.className = 'tl-uitleg';
  uitleg.hidden = true;
  el.append(chips, uitleg);
  wrap.appendChild(el);
  const telefoon = typeof matchMedia === 'function' ? matchMedia('(max-width: 600px)') : null;
  const T = {
    el, chips, uitleg, top: 56, n: 0, maat: 36, meten: true, verborgen: true, uitlegTot: 0, versie: -1, tel: null,
    _vak: { x: 0, y: 0, w: 52, h: 0 }, _leg: { x: 0, y: 0, w: 0, h: 0 }, legMeten: true,
    werkBij(pings, view, nu) {
      const tel = !!telefoon?.matches;
      // de tutorial staat open: tijdlijn weg
      const tut = wrap.querySelector('.tutorial');
      const weg = !pings.lijst.length || (tut && !tut.hidden) || !!view.bouwModus;
      if (weg !== T.verborgen) { T.verborgen = weg; el.hidden = weg; T.meten = true; T.versie = -1; }
      if (weg) { T.n = 0; return; }
      if (T.meten) T.meet(tel);
      const max = tel ? 4 : 6, L = pings.lijst;
      if (T.versie === pings.versie && T.tel === tel) { if (T.uitlegTot && nu > T.uitlegTot) { uitleg.hidden = true; T.uitlegTot = 0; } return; }
      T.versie = pings.versie; T.tel = tel;
      let html = '';
      let n = 0;
      for (let i = L.length - 1; i >= 0 && n < max; i--, n++) {
        const p = L[i];
        html += `<button type="button" class="tl-chip ${p.ernst}${p.gezienOp == null ? ' ongezien' : ''}" data-ping="${p.id}" title="dag ${p.dag} · ${esc(p.tekst)}" aria-label="${esc(p.tekst)}">${svgVan(p.pict)}</button>`;
      }
      html += `<button type="button" class="tl-chip meer" data-meer="1" title="Alle meldingen in het logboek" aria-label="Logboek">${svgVan('meer')}</button>`;
      T.n = n + 1;
      T.maat = tel ? 44 : 36;
      if (chips._html !== html) { chips.innerHTML = html; chips._html = html; }
      if (T.uitlegTot && nu > T.uitlegTot) { uitleg.hidden = true; T.uitlegTot = 0; }
    },
    meet(tel) {
      T.meten = false;
      const r0 = wrap.getBoundingClientRect();
      let top = tel ? 52 : 56;
      const links = tel ? 8 : 12, rechts = links + 52;
      for (const s of ['.tutorial', '.bouwbalk', '.doelbalk']) {
        const e = wrap.querySelector(s);
        if (!e || e.hidden || e.offsetParent === null) continue;
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height || r.left - r0.left > rechts || r.right - r0.left < links) continue;
        top = Math.max(top, r.bottom - r0.top + 8);
      }
      T.top = top;
      el.style.top = `${Math.round(top)}px`;
    },
    // Het vak van de kolom in canvaspixels (voor de randpijlen).
    vak() {
      if (T.verborgen) return null;
      const v = T._vak;
      v.x = telefoon?.matches ? 8 : 12; v.y = T.top; v.h = T.n * (T.maat + 8);
      return v;
    },
    // Het vak van de legenda (alleen opnieuw meten als hij of het kaartvenster van maat verandert).
    legenda() {
      const g = T._leg;
      if (T.legMeten) {
        T.legMeten = false;
        const e = wrap.querySelector('#legenda'), r0 = wrap.getBoundingClientRect();
        const r = e && !e.hidden && e.offsetParent !== null ? e.getBoundingClientRect() : null;
        if (r && r.width && r.height) { g.x = r.left - r0.left; g.y = r.top - r0.top; g.w = r.width; g.h = r.height; } else g.h = 0;
      }
      return g.h > 0 ? g : null;
    },
    toonUitleg(knop, tekst, nu) {
      const r = knop.getBoundingClientRect(), r0 = el.getBoundingClientRect();
      uitleg.textContent = tekst;
      uitleg.style.top = `${Math.round(r.top - r0.top + r.height / 2)}px`;
      uitleg.hidden = false;
      T.uitlegTot = nu + 3000;
    },
  };
  // opnieuw meten als tutorial, bouwbalk of doelbalk verschijnt, verdwijnt of van maat verandert
  const opnieuw = () => { T.meten = true; T.legMeten = true; };
  const mo = new MutationObserver(opnieuw);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(opnieuw) : null;
  for (const s of ['.tutorial', '.bouwbalk', '.doelbalk']) {
    const e = wrap.querySelector(s);
    if (!e) continue;
    mo.observe(e, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    ro?.observe(e);
  }
  ro?.observe(wrap);
  const leg = wrap.querySelector('#legenda');
  if (leg) ro?.observe(leg);
  telefoon?.addEventListener?.('change', opnieuw);
  return T;
}

// ---------- samenbinden ----------

export class LevendeKaart {
  constructor(view) {
    this.pings = new Pings();
    this.laag = new PingLaag();
    this.tijdlijn = null;
    this.voertuig = new VoertuigKaart(view);
    if (typeof document !== 'undefined' && typeof document.createElement === 'function' && typeof view?.wrap?.appendChild === 'function') {
      laadCss();
      this.tijdlijn = maakTijdlijn(view.wrap);
      this.tijdlijn?.el.addEventListener('click', (e) => this.chipKlik(e, view));
    }
  }

  // Een ping aantikken: vliegen naar de tegel op de zoom van zijn soort en hem als gezien markeren.
  vlieg(p, view) {
    if (!p) return;
    view.vliegNaar(p.wx, p.wy, p.vliegZoom);
    this.pings.markeer(p, view.echtNu ?? 0);
  }

  chipKlik(e, view) {
    const b = e.target.closest?.('button');
    if (!b) return;
    if (b.dataset.meer) {
      const tab = document.querySelector('#tabs button[data-tab="log"]');
      tab?.click();
      // op de telefoon staat het logboek onder de kaart: erheen schuiven, anders lijkt de knop niets te doen
      if (tab && typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches) tab.scrollIntoView?.({ block: 'start', behavior: rustig() ? 'auto' : 'smooth' });
      return;
    }
    const id = +b.dataset.ping;
    const p = this.pings.lijst.find((x) => x.id === id);
    if (!p) return;
    this.vlieg(p, view);
    if (typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches) this.tijdlijn?.toonUitleg(b, p.tekst, view.echtNu ?? 0);
  }

  teken(c, view) {
    const nu = view.echtNu ?? 0;
    this.pings.waarneem(view.state, nu);
    if (this.tijdlijn) {
      this.tijdlijn.werkBij(this.pings, view, nu);
      this.laag.tijdlijnVak = this.tijdlijn.vak();
      this.laag.legendaVak = this.pings.lijst.length ? this.tijdlijn.legenda() : null;
    }
    this.laag.teken(c, view, this.pings, nu);
    this.voertuig.teken(c, view, nu);
  }

  volgStap(view, dt) { this.voertuig.volgStap(view, dt); }

  // Ping of randpijl onder de tik? (niet in bouwmodus)
  klikVoor(e, view) {
    if (view.bouwModus) return false;
    const r = view.canvas.getBoundingClientRect();
    const p = this.laag.op(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'touch');
    if (!p) return false;
    this.vlieg(p, view);
    return true;
  }

  // Auto of vrachtwagen onder de tik? Opent de voertuigkaart; een andere tik sluit hem.
  klikVoertuig(e, view, wx, wy) {
    if (view.bouwModus) return false;
    return this.voertuig.klik(e, view, wx, wy);
  }
}
