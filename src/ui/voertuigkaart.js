// Voertuigkaart (C14a): tik op een auto of vrachtwagen die als voertuig getekend is (zoom >= 5), zie wat hij vervoert
// en waarheen, en volg hem. Leest alleen: de autobuffers van het laatst getekende beeld in leven.js en de ritten
// (ritten.js). Schepen en de vrachtblokjes op middenzoom doen niet mee.
// C15b: ook treinen (vanaf zoom 4, treinkaart.js), de stilstaande vrachtwagen bij een gebouw zonder aanvoer (soort
// 'stil') en het verkeer per gebouw (rittenBij, voor verkeerblok.js). Een knop met data-volg-rit (in het gebouwpaneel)
// opent de kaart op die sleutel en vliegt erheen.
//
// voertuigOp, voertuigPlek en voertuigInfo zijn puur (geen DOM), zodat tools/pingtest.mjs ze in node kan nalopen.
// De kaart zelf (div#voertuig met class "context voertuig") komt pas in de constructor, en alleen als er een document is.
// Eigen knoppen hebben GEEN data-actie (die slikt main.js in), maar eigen listeners.

import { ritStand, TOESTAND, MAAT } from './ritten.js';
import { AUTO } from './leven.js';
import { veer } from './camera.js';
import { tegelOp } from '../engine/geografie.js';
import { ZOOM_TREIN, treinOp, treinPlek, treinInfo } from './treinkaart.js';
import { puntOp } from './infra.js';
import { stilOp } from './straatstand.js';

// Vanaf deze zoom tekent leven.js personenauto's als voertuig (ZOOM_AUTO daar; leven.js exporteert hem niet).
export const ZOOM_AUTO = 5;
// Ids in de autobuffer: v (huidige ritset), 100000 + v (oude ritset); vanaf 300000 volgers en geparkeerde wagens
// zonder eigen rit: niet aan te tikken. Uitzondering (C15b): 500000 + v is de vrachtwagen die bij een stil gebouw
// geparkeerd staat (leven.js zetParkLijst), wel aan te tikken; vanaf 600000 de extra auto's van een bloeiend land.
const OUD = 100000, GEEN_RIT = 300000, STIL = 500000, BLOEI = 600000;
const VOLG_TAU = 0.12, VOLG_ZOOM = 6, VOLG_ZOOM_TREIN = 5;
const ROUTE_MAX = 400;
const ACCENT = '#f0b429';
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Afstand van (px, py) tot een gedraaide rechthoek met halve lengte l en halve breedte b (0 erbinnen).
function afstandTotDoos(px, py, x, y, hx, hy, l, b) {
  const dx = px - x, dy = py - y;
  const u = Math.abs(dx * hx + dy * hy) - l, w = Math.abs(-dx * hy + dy * hx) - b;
  return Math.hypot(Math.max(0, u), Math.max(0, w));
}

// Het voertuig onder een schermpunt van het laatst getekende beeld: { sleutel, oud, v, R } of null.
export function voertuigOp(L, view, sx, sy, touch) {
  if (!L || view.zoom < ZOOM_AUTO || !(L.zoom >= ZOOM_AUTO) || !L.nAuto) return null;
  const b = L.auto, ids = L.autoId, T = L.T, M = L.rit;
  let best = -1, bd = Infinity, bestC = 0, bestB = 0;
  for (let i = 0; i < L.nAuto; i++) {
    const id = ids[i];
    if (id >= GEEN_RIT && !(id >= STIL && id < BLOEI)) continue;
    const o = i * AUTO;
    if (b[o + 9] < 0.15) continue;
    const m = MAAT[b[o + 5]] ?? MAAT[0], hl = T * m[0], hb = T * m[1];
    const dc = Math.hypot(b[o] - sx, b[o + 1] - sy);
    if (dc > hl + 20) continue;
    const db = afstandTotDoos(sx, sy, b[o], b[o + 1], b[o + 2], b[o + 3], hl, hb);
    let ok;
    if (b[o + 10] >= TOESTAND.LAADT) ok = db <= 3; // laden, lossen, geparkeerd: alleen op de wagen zelf
    else {
      const r = Math.max(hl + 4, 10);
      ok = db <= 4 || dc <= (touch ? Math.min(r, 14) : r);
    }
    if (!ok || db + dc * 0.01 >= bd) continue;
    bd = db + dc * 0.01; best = i; bestC = dc; bestB = hb;
  }
  if (best < 0) return null;
  // de stilstaande vrachtwagen: alleen op de wagen zelf (db <= 3 hierboven), en dan wint hij ook binnen de kavel
  if (ids[best] >= STIL) {
    const R = M?.R, v = ids[best] - STIL;
    if (!R || v < 0 || v >= R.n) return null;
    return { sleutel: 'stil:' + R.info[v].sleutel, stil: true, oud: false, v, R };
  }
  // Binnen de kavel van een gebouw (meer dan 4 px van de rand) wint het gebouw, tenzij je echt op de wagen tikt.
  const s = view.state, geo = view.geo;
  const [wx, wy] = view.naarWereld(sx, sy);
  const t = tegelOp(geo, wx, wy);
  const bz = t >= 0 ? s?.bezet?.[t] : null;
  if (bz && (bz.gebouw || bz.hoofdstad || bz.kolonie) && bestC >= bestB) {
    const tg = geo.tegels[t], TT = geo.T, sc = view.schaal(), inzet = 0.12 * TT;
    const x0 = tg.k * TT + inzet, x1 = (tg.k + 1) * TT - inzet, y0 = tg.r * TT + inzet, y1 = (tg.r + 1) * TT - inzet;
    const binnen = Math.min(wx - x0, x1 - wx, wy - y0, y1 - wy) * sc;
    if (binnen > 4) return null;
  }
  const id = ids[best], oud = id >= OUD;
  const R = oud ? M?.oud : M?.R, v = oud ? id - OUD : id;
  if (!R || v < 0 || v >= R.n) return null;
  return { sleutel: R.info[v].sleutel, oud, v, R };
}

// Per ritset: sleutel -> voertuignummer.
const PER_SET = new WeakMap();
function nummerVan(R, sleutel) {
  if (!R) return -1;
  let m = PER_SET.get(R);
  if (!m) { m = new Map(); for (let v = 0; v < R.n; v++) m.set(R.info[v].sleutel, v); PER_SET.set(R, m); }
  return m.get(sleutel) ?? -1;
}

// Waar is het voertuig met deze sleutel nu? Tijdens het wisselen van ritset de set waarin hij te zien is.
// Vult uit (x, y, toestand, s, v, R, hx, hy, ...) of geeft null.
export function voertuigPlek(L, sleutel, uit = {}) {
  const M = L?.rit;
  if (!M?.R || sleutel == null) return null;
  let R = M.R, v = nummerVan(R, sleutel);
  if (M.oud) {
    const w = nummerVan(M.oud, sleutel), nu = L.nu ?? 0;
    if (w >= 0 && (v < 0 || M.wisselAlfa(v, nu, false) < 0.5) && M.wisselAlfa(w, nu, true) > 0.02) { R = M.oud; v = w; }
  }
  if (v < 0 || v >= R.n) return null;
  ritStand(R, v, L.u ?? 0, uit);
  uit.v = v; uit.R = R;
  return uit;
}

// ---------- wat staat er op de kaart ----------

function tegelVanRust(net, r) {
  if (!r) return -1;
  const P = net?.D?.poorten?.length ? net.D.poorten : net?.poorten;
  if (r.p != null) return P?.[r.p]?.t ?? -1;
  if (r.k != null) return net?.parkeerstroken?.[r.k]?.t ?? -1;
  return -1;
}
function tegelVanPoort(net, p) {
  const P = net?.D?.poorten?.length ? net.D.poorten : net?.poorten;
  return p != null && p >= 0 ? P?.[p]?.t ?? -1 : -1;
}
// De naam van een plek: het gebouw, de hoofdstad (landnaam), een kolonie, anders een woonwijk.
export function plekNaam(state, t) {
  if (t == null || t < 0) return 'woonwijk';
  const b = state.bezet?.[t];
  if (b?.gebouw) return state.pack.gebouwIndex[b.gebouw]?.naam ?? 'woonwijk';
  if (b?.hoofdstad) return state.landen[b.land]?.naam ?? 'woonwijk';
  if (b?.kolonie) { const k = (state.kolonies ?? []).find((x) => x.t === t); return k?.naam ?? 'kolonie'; }
  return 'woonwijk';
}

const TITEL = {
  goederen: 'Vrachtwagen', haven: 'Oplegger met containers', bus: 'Lijnbus', taxi: 'Taxi', vuil: 'Vuilniswagen',
  strooi: 'Strooiwagen', bestel: 'Bestelbus', konvooi: 'Legerkonvooi naar het front', boodschap: 'Boodschappen doen',
  zakelijk: 'Zakelijke rit',
};
const STAND = ['rijdt', 'wacht', 'laadt', 'lost', 'geparkeerd'];

// Puur: wat de kaart toont. doel = { R, v, s, toestand } (zoals voertuigPlek die vult).
export function voertuigInfo(view, doel) {
  const s = view.state, P = s.pack, net = view.wegennet, I = doel.R.info[doel.v];
  const benen = I.benen ?? [], sNu = doel.s ?? 0;
  // s komt als Float32 uit de ritset: vergelijk met wat speling, anders valt een wagen aan het dok net buiten zijn been
  const EPS = 1e-3, ts = doel.toestand ?? 0;
  let k = -1;
  for (let i = 0; i < benen.length; i++) if (benen[i].sStart <= sNu + EPS && sNu <= benen[i].sEind + EPS) { k = i; break; }
  // laden hoort bij het been dat hier begint
  if (ts === TOESTAND.LAADT && k >= 0 && k + 1 < benen.length && sNu >= benen[k + 1].sStart - EPS) k++;
  // het rustpunt waar hij nu is of het laatst was, en het been waarmee hij daar aankwam
  let rust = I.thuis, aank = -1;
  for (let i = 0; i < benen.length; i++) if (benen[i].sEind <= sNu + EPS) { rust = benen[i].naar; aank = i; }
  // lossen hoort bij het been dat net aankwam: dan gelden nog de lading, van en naar van dat been
  if (ts === TOESTAND.LOST && aank >= 0) k = aank;
  const vanR = k > 0 ? benen[k - 1].naar : k === 0 ? I.thuis : null;
  let van = k >= 0 ? plekNaam(s, tegelVanRust(net, vanR)) : null;
  let naar = k >= 0 ? plekNaam(s, tegelVanRust(net, benen[k].naar)) : null;
  const heen = k < 0 || k % 2 === 0;
  const resNaam = I.res ? (P.resIndex?.[I.res]?.naam ?? I.res) : null;
  let titel = TITEL[I.rit] ?? 'Voertuig', lading = null;
  const regels = [];
  const vracht = I.rit === 'goederen' || I.rit === 'haven' || I.rit === 'export';
  if (vracht && k < 0) {
    // tussen twee ritten: de vaste route
    van = plekNaam(s, tegelVanPoort(net, I.van));
    naar = plekNaam(s, tegelVanPoort(net, I.doel?.[0]));
  }
  switch (I.rit) {
    case 'goederen': lading = heen ? (resNaam ?? 'goederen') : 'leeg, terug'; break;
    case 'haven': lading = heen ? 'containers' : 'leeg, terug'; break;
    case 'export': {
      const partner = s.landen[I.partner]?.naam ?? 'het buitenland';
      titel = `Oplegger naar ${partner}`;
      lading = heen ? (resNaam ?? 'goederen') : 'leeg, terug';
      if (I.viaHaven) regels.push(['Route', 'via de haven']);
      break;
    }
    case 'hulp': titel = I.soort === 6 ? 'Ambulance' : 'Politiewagen'; regels.push(['Taak', 'op ronde']); break;
    case 'bestel': lading = 'pakketten'; break;
    case 'bus': regels.push(['Route', 'langs de haltes']); break;
    case 'vuil': regels.push(['Taak', 'haalt het afval op']); break;
    case 'strooi': regels.push(['Taak', 'strooit de wegen']); break;
    case 'woonwerk': titel = `Forens naar ${plekNaam(s, tegelVanPoort(net, I.doel?.[0]))}`; break;
    default: break;
  }
  if (lading) regels.unshift(['Lading', lading]);
  if (van && naar && van !== naar) { regels.push(['Van', van]); regels.push(['Naar', naar]); }
  else if (naar && I.rit !== 'bus' && I.rit !== 'vuil' && I.rit !== 'strooi') regels.push(['Naar', naar]);
  const toestand = doel.toestand ?? TOESTAND.RIJDT;
  let stand = STAND[toestand] ?? 'rijdt';
  if (toestand === TOESTAND.LAADT || toestand === TOESTAND.LOST) stand += ` bij ${plekNaam(s, tegelVanRust(net, rust))}`;
  const land = s.landen[I.land]?.naam ?? '';
  return { titel, regels, van, naar, lading, stand, land, rit: I.rit, been: k };
}

// ---------- C15b: de stilstaande vrachtwagen ----------

// De tegel van het stille gebouw bij rit v: eerst de poort waar hij vandaan komt, dan zijn doelen. -1 als er geen
// stilstaat. stil(t) is stilOp uit straatstand.js (of een nagebootste in de test).
function stilTegel(net, I, stil) {
  const t0 = tegelVanPoort(net, I.van);
  if (t0 >= 0 && stil(t0) != null) return t0;
  for (let k = 0; k < (I.doel?.length ?? 0); k++) { const t = tegelVanPoort(net, I.doel[k]); if (t >= 0 && stil(t) != null) return t; }
  return -1;
}

// Puur: wat de kaart toont over de stilstaande wagen v van ritset R, of null als het gebouw weer draait.
export function stilInfo(view, R, v, stil = stilOp) {
  const s = view.state, P = s.pack, I = R?.info?.[v];
  if (!I) return null;
  const t = stilTegel(view.wegennet, I, stil);
  if (t < 0) return null;
  const res = stil(t), b = s.bezet?.[t];
  const eigen = b ? b.land === s.speler : I.land === s.speler;
  const resNaam = (P.resIndex?.[res]?.naam ?? String(res)).toLowerCase();
  return { titel: 'Vrachtwagen', stand: 'staat stil', regels: [['Reden', eigen ? `geen aanvoer van ${resNaam}` : 'geen aanvoer'], ['Bij', plekNaam(s, t)]], t, land: s.landen[b?.land ?? I.land]?.naam ?? '' };
}

// Waar staat de stilstaande wagen met deze sleutel ('stil:' + ritsleutel)? Uit de geparkeerde wagens van de straatstand
// (leven.js straatVoor). Vult uit (x, y, hx, hy, v, R) of geeft null.
export function stilPlek(L, sleutel, uit = {}) {
  const R = L?.rit?.R;
  if (!R || typeof sleutel !== 'string' || !sleutel.startsWith('stil:') || typeof L.straatVoor !== 'function') return null;
  const v = nummerVan(R, sleutel.slice(5));
  if (v < 0) return null;
  const park = L.straatVoor(R)?.park ?? [];
  for (let i = 0; i < park.length; i++) {
    const p = park[i];
    if (p.v !== v) continue;
    uit.x = p.x; uit.y = p.y; uit.hx = p.hx; uit.hy = p.hy; uit.v = v; uit.R = R;
    return uit;
  }
  return null;
}

// De ritsleutel van de wagen die bij het stille gebouw op tegel t geparkeerd staat (zoals straatVerkeer hem kiest), of
// null.
export function stilWagenBij(L, t) {
  const R = L?.rit?.R, net = L?.net;
  if (!R || typeof L.straatVoor !== 'function') return null;
  const p = net?.D?.poortVanT?.[t] ?? -1;
  if (p < 0) return null;
  const park = L.straatVoor(R)?.park ?? [];
  for (let i = 0; i < park.length; i++) {
    const I = R.info[park[i].v];
    if (!I) continue;
    if (I.van === p) return I.sleutel;
    for (let k = 0; k < (I.doel?.length ?? 0); k++) if (I.doel[k] === p) return I.sleutel;
  }
  return null;
}

// ---------- C15b: het verkeer van één gebouw ----------

const VRACHT_RIT = { goederen: 1, haven: 1, export: 1 };
const TITEL_KORT = { export: 'Oplegger', woonwerk: 'Forens', hulp: 'Hulpdienst', boodschap: 'Auto', zakelijk: 'Auto' };
export const RITTEN_MAX = 5;

// Puur: wie bij de poort van tegel t vertrekt of aankomt. Geeft { lijst (hooguit RITTEN_MAX), totaal, vracht (aantal
// vrachtritten per dag) }; per wagen { sleutel, titel, richting ('vertrekt' of 'komt'), lading, ander, keer, rit }.
// Eerst goederen, haven en export, dan de rest, en dan op sleutel.
export function rittenBij(state, net, R, t) {
  const leeg = { lijst: [], totaal: 0, vracht: 0 };
  const p = net?.D?.poortVanT?.[t] ?? -1;
  if (!R || p < 0) return leeg;
  const P = state.pack, alle = [];
  let vracht = 0;
  for (let v = 0; v < R.n; v++) {
    const I = R.info[v];
    let richting = null;
    if (I.van === p) richting = 'vertrekt';
    else for (let k = 0; k < (I.doel?.length ?? 0); k++) if (I.doel[k] === p) { richting = 'komt'; break; }
    if (!richting) continue;
    const benen = I.benen ?? [];
    let keer = 0;
    for (let b = 0; b < benen.length; b++) {
      const q = benen[b].naar?.p;
      if (q == null) continue;
      if (richting === 'vertrekt' ? q !== I.van : q === p) keer++;
    }
    // een forens of boodschap parkeert soms bij een buurpoort of op een parkeerstrook: dan telt het doel zelf
    if (richting === 'komt' && !keer) for (let k = 0; k < (I.doel?.length ?? 0); k++) if (I.doel[k] === p) keer++;
    const resNaam = I.res ? (P.resIndex?.[I.res]?.naam ?? I.res).toLowerCase() : null;
    const lading = I.rit === 'haven' ? 'containers' : VRACHT_RIT[I.rit] ? resNaam ?? 'goederen' : null;
    const ander = plekNaam(state, tegelVanPoort(net, richting === 'vertrekt' ? I.doel?.[0] : I.van));
    const isVracht = !!VRACHT_RIT[I.rit];
    if (isVracht) vracht += keer;
    alle.push({ sleutel: I.sleutel, titel: TITEL_KORT[I.rit] ?? TITEL[I.rit] ?? 'Voertuig', richting, lading, ander, keer, rit: I.rit, vracht: isVracht });
  }
  alle.sort((a, b) => (b.vracht - a.vracht) || (a.sleutel < b.sleutel ? -1 : a.sleutel > b.sleutel ? 1 : 0));
  return { lijst: alle.slice(0, RITTEN_MAX), totaal: alle.length, vracht };
}

// ---------- de kaart in de DOM, de routelijn en het volgen ----------

export class VoertuigKaart {
  constructor(view) {
    this.sleutel = null;
    this.soort = 'weg';    // 'weg' (auto of vrachtwagen met een rit), 'trein' of 'stil' (stilstaande vrachtwagen)
    this.plek = {};        // hergebruikt per beeld
    this.heeftPlek = false;
    this.volgen = false;
    this.tik = { x: 0, y: 0 };
    this.tikR = 0;         // zoveel px rond de tik blijft vrij (bij het volgen: de ring om het voertuig)
    this.ringR = 14;       // straal van de laatst getekende ring (px)
    this.laatst = -1e9;
    this.einde = 0;        // tot wanneer de eindtekst staat (echte ms)
    this.eindTekst = '';
    this.stilT = -1;       // soort 'stil': de tegel van het stille gebouw
    this.dekking = 0;      // telefoon: zoveel px van het kaartvenster dekt het paneel af
    this.eindX = -1; this.eindY = -1; // schermplek van het doel van het huidige been (voor de plek van de kaart)
    this.el = null;
    this.view = view;
    // alleen in een echte pagina (tests bouwen een kaart met een nagebootst venster zonder DOM)
    if (typeof document === 'undefined' || typeof document.createElement !== 'function' || typeof view?.wrap?.appendChild !== 'function') return;
    const wrap = view.wrap;
    const el = document.createElement('div');
    el.id = 'voertuig';
    el.className = 'context voertuig';
    el.hidden = true;
    wrap.appendChild(el);
    this.el = el;
    el.addEventListener('click', (e) => {
      const b = e.target.closest?.('button');
      if (!b) return;
      if (b.classList.contains('vk-sluit')) this.sluit();
      else if (b.classList.contains('vk-volg')) this.startVolg(this.view);
      else if (b.classList.contains('vk-stop')) this.stopVolg();
      else if (b.classList.contains('vk-gebouw')) this.naarGebouw(this.view);
      this.laatst = -1e9;
    });
    // C15b: een Volg-knop in het gebouwpaneel (data-volg-rit, zonder data-actie). Op pointerdown en in de capture-fase:
    // bij het loslaten van de vinger is het paneel al dicht en komt de tik op de kaart terecht.
    document.addEventListener('pointerdown', (e) => {
      const b = e.target?.closest?.('[data-volg-rit]');
      if (!b || b.disabled) return;
      e.preventDefault();
      const ctx = document.querySelector('#context');
      if (ctx && !ctx.hidden) {
        // via main.js sluiten (sluitContext), zodat het paneel niet bij de volgende beurt terugkomt
        const knop = ctx.querySelector?.('[data-actie=sluit-context]');
        if (knop && typeof PointerEvent === 'function') knop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        ctx.hidden = true;
      }
      this.volgSleutel(b.dataset.volgRit, this.view);
    }, { capture: true });
    // #context en #voertuig sluiten elkaar uit: gaat #context open, dan gaat deze dicht.
    const ctx = document.getElementById('context');
    if (ctx) new MutationObserver(() => { if (!ctx.hidden && !el.hidden) this.sluit(); }).observe(ctx, { attributes: true, attributeFilter: ['hidden'] });
    // Slepen stopt het volgen (wiel, knijpen en dubbeltik niet).
    const vingers = new Map();
    let knijp = false;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target !== view.canvas) return;
      vingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (vingers.size > 1) knijp = true;
    });
    wrap.addEventListener('pointermove', (e) => {
      const v = vingers.get(e.pointerId);
      if (!v || !this.volgen || knijp || !e.buttons) return;
      if (Math.hypot(e.clientX - v.x, e.clientY - v.y) > 6) this.stopVolg();
    });
    const los = (e) => { vingers.delete(e.pointerId); if (!vingers.size) knijp = false; };
    wrap.addEventListener('pointerup', los);
    wrap.addEventListener('pointercancel', los);
    document.addEventListener('keydown', (e) => {
      if (el.hidden) return;
      if (e.key.startsWith('Arrow')) { if (this.volgen) this.stopVolg(); return; }
      if (e.key === 'Escape') { if (this.volgen) this.stopVolg(); else this.sluit(); }
    });
  }

  get open() { return !!this.el && !this.el.hidden && this.sleutel != null; }

  telefoon() { return typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches; }

  // Ligt op dit schermpunt een gebouw, hoofdstad, kolonie of station? (dan wint de trein alleen op de wagons zelf)
  gebouwOp(view, sx, sy) {
    const geo = view.geo, s = view.state;
    if (!geo || !s) return false;
    const [wx, wy] = view.naarWereld(sx, sy);
    const t = tegelOp(geo, wx, wy);
    if (t < 0) return false;
    const b = s.bezet?.[t];
    if (b && (b.gebouw || b.hoofdstad || b.kolonie)) return true;
    const S = view.infraLaag?.stations ?? [];
    for (let i = 0; i < S.length; i++) if (S[i].t === t) return true;
    return false;
  }

  // Een tik op de kaart (niet in bouwmodus): eerst een trein (zoom >= 4), dan een auto of vrachtwagen (zoom >= 5).
  // Opent de kaart op het voertuig, of sluit hem.
  klik(e, view, wx, wy) {
    void wx; void wy;
    if (view.zoom < ZOOM_TREIN) { this.sluit(); return false; }
    const r = view.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top, touch = e.pointerType === 'touch';
    const tr = treinOp(view.infraLaag, view, sx, sy, touch, (x, y) => this.gebouwOp(view, x, y));
    if (tr) { this.toon(tr.sleutel, sx, sy, 'trein'); return true; }
    const hit = voertuigOp(view.levenLaag, view, sx, sy, touch);
    if (!hit) { this.sluit(); return false; }
    this.toon(hit.sleutel, sx, sy, hit.stil ? 'stil' : 'weg');
    return true;
  }

  toon(sleutel, sx, sy, soort = 'weg') {
    if (sleutel !== this.sleutel) this.volgen = false;
    if (soort !== this.soort) this.plek = {};
    this.sleutel = sleutel;
    this.soort = soort;
    this.tik.x = sx; this.tik.y = sy;
    this.einde = 0;
    this.eindX = -1;
    this.laatst = -1e9;
    this.stilT = -1;
    if (soort === 'stil') {
      const p = stilPlek(this.view?.levenLaag, sleutel, this.plek);
      const info = p ? stilInfo(this.view, p.R, p.v) : null;
      this.stilT = info ? info.t : -1;
    }
    if (typeof document !== 'undefined') {
      const ctx = document.getElementById?.('context');
      if (ctx && !ctx.hidden && typeof PointerEvent === 'function') ctx.querySelector('[data-actie=sluit-context]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }
    // meteen tonen, en in het volgende beeld (na de eerste routelijn) nog eens op de goede plek zetten
    if (this.el) { this.el.hidden = false; this.werkBij(this.view, this.view?.echtNu ?? 0, true); this.laatst = -1e9; }
  }

  // C15b: de kaart openen op een sleutel uit het gebouwpaneel en erheen vliegen (naar zoom 6 of dieper). Een trein of
  // wagen wordt meteen gevolgd (ook vanaf zoom 1: volgStap wacht de vlucht af); bij een stilstaande wagen alleen vliegen.
  volgSleutel(sleutel, view = this.view) {
    if (typeof sleutel !== 'string' || !sleutel || !view) return;
    const soort = sleutel.startsWith('trein:') ? 'trein' : sleutel.startsWith('stil:') ? 'stil' : 'weg';
    const sx = (view.w ?? 0) / 2, sy = (view.h ?? 0) / 2;
    this.toon(sleutel, sx, sy, soort);
    const zoom = Math.max(view.zoom ?? 0, VOLG_ZOOM);
    if (soort === 'stil') {
      const p = this.plekVan(view);
      if (p) view.vliegNaar(p.x, p.y, zoom); else this.beeindig(view);
      return;
    }
    this.startVolg(view, zoom);
  }

  sluit() {
    this.sleutel = null;
    this.volgen = false;
    this.heeftPlek = false;
    this.einde = 0;
    if (this.el && !this.el.hidden) this.el.hidden = true;
  }

  // Waar is het voertuig van de kaart nu (per soort)? Vult this.plek of geeft null.
  plekVan(view) {
    if (this.soort === 'trein') return treinPlek(view.infraLaag, this.sleutel, this.plek);
    if (this.soort === 'stil') return this.stilT >= 0 && stilOp(this.stilT) == null ? null : stilPlek(view.levenLaag, this.sleutel, this.plek);
    return voertuigPlek(view.levenLaag, this.sleutel, this.plek);
  }

  startVolg(view, zoom = null) {
    if (this.soort === 'stil') return;
    const p = this.plekVan(view);
    if (!p) { this.beeindig(view); return; }
    this.volgen = true;
    view.vliegNaar(p.x, p.y, Math.max(view.zoom, zoom ?? (this.soort === 'trein' ? VOLG_ZOOM_TREIN : VOLG_ZOOM)));
  }

  stopVolg() { this.volgen = false; this.laatst = -1e9; }

  // Het gebouw van een stilstaande wagen openen (het gebouwpaneel van main.js, via onSelect).
  naarGebouw(view) {
    const t = this.stilT, tg = t >= 0 ? view?.geo?.tegels?.[t] : null;
    if (!tg) return;
    const [sx, sy] = typeof view.naarScherm === 'function' ? view.naarScherm(tg.x, tg.y) : [this.tik.x, this.tik.y];
    const land = typeof view.landOp === 'function' ? view.landOp(tg.x, tg.y) : view.state?.bezet?.[t]?.land ?? -1;
    view.opties?.onSelect?.(land, t, sx, sy);
  }

  // Het voertuig is weg: 'Rit beëindigd', 'Lijn opgeheven' of 'Draait weer', 3 s lang. Een stilstaande wagen die
  // verdwijnt terwijl het gebouw nog stilstaat (een ritwissel), sluit de kaart meteen.
  beeindig(view) {
    this.volgen = false;
    this.heeftPlek = false;
    if (this.soort === 'stil' && !(this.stilT >= 0 && stilOp(this.stilT) == null)) { this.sluit(); return; }
    this.eindTekst = this.soort === 'trein' ? 'Lijn opgeheven' : this.soort === 'stil' ? 'Draait weer' : 'Rit beëindigd';
    this.einde = (view?.echtNu ?? 0) + 3000;
    this.laatst = -1e9;
  }

  // Per beeld, na de camerastap van map.js: de camera veert naar het gevolgde voertuig.
  volgStap(view, dt) {
    if (!this.volgen || this.sleutel == null) return;
    if (view.zoom < (this.soort === 'trein' ? ZOOM_TREIN : ZOOM_AUTO) && !view.doel) { this.beeindig(view); return; }
    const p = this.plekVan(view);
    if (!p) { this.beeindig(view); return; }
    if (view.doel) return; // eerst de vlucht afmaken
    const tau = view.rustig ? 0 : VOLG_TAU;
    const dy = this.dekking > 0 ? this.dekking / 2 / view.schaal() : 0;
    view.cx = veer(view.cx, p.x, dt, tau);
    view.cy = veer(view.cy, p.y + dy, dt, tau);
    view.begrens();
  }

  // Na alle lagen: routelijn en ring, en de DOM 4 keer per seconde.
  teken(c, view, nu) {
    if (this.sleutel == null) return;
    if (this.einde) { if (nu > this.einde) this.sluit(); else this.werkBij(view, nu); return; }
    const p = this.plekVan(view);
    this.heeftPlek = !!p;
    if (!p) { this.beeindig(view); this.werkBij(view, nu); return; }
    if (this.soort === 'trein') { if (view.zoom >= ZOOM_TREIN) this.tekenTreinRoute(c, view, p); }
    else if (this.soort === 'stil') { if (view.zoom >= ZOOM_AUTO) this.ring(c, view, p.x, p.y, Math.max(14, view.geo.T * view.schaal() * MAAT[1][0] * 1.7)); }
    else if (view.zoom >= ZOOM_AUTO) this.tekenRoute(c, view, p);
    this.werkBij(view, nu);
  }

  // Zachte gouden ring om (wereld) x, y met straal r px.
  ring(c, view, x, y, r) {
    this.ringR = r;
    const sc = view.schaal(), sx = x * sc + view.w / 2 - view.cx * sc, sy = y * sc + view.h / 2 - view.cy * sc;
    c.save();
    c.globalAlpha = 0.18; c.fillStyle = ACCENT;
    c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.75; c.strokeStyle = ACCENT; c.lineWidth = 1.5;
    c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.stroke();
    c.restore();
  }

  // Trein: een gestippelde gouden lijn van de kop langs het spoor naar het einde in de rijrichting, een eindstip en
  // een ring om de trein.
  tekenTreinRoute(c, view, p) {
    const r = p.r, S = r.s, n = r.n;
    const sc = view.schaal(), ox = view.w / 2 - view.cx * sc, oy = view.h / 2 - view.cy * sc;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= p.kop) lo = m; else hi = m; }
    const kp = puntOp(r, p.kop, {});
    c.save();
    c.strokeStyle = ACCENT; c.lineWidth = 2; c.globalAlpha = 0.9;
    c.setLineDash([6, 5]);
    c.beginPath();
    c.moveTo(kp.px * sc + ox, kp.py * sc + oy);
    const tot = p.rich > 0 ? n - 1 : 0, van = p.rich > 0 ? hi : lo;
    const stap = Math.max(1, Math.ceil(Math.abs(tot - van) / ROUTE_MAX)) * (p.rich > 0 ? 1 : -1);
    for (let i = van; p.rich > 0 ? i < tot : i > tot; i += stap) c.lineTo(r.x[i] * sc + ox, r.y[i] * sc + oy);
    const ex = r.x[tot] * sc + ox, ey = r.y[tot] * sc + oy;
    c.lineTo(ex, ey);
    c.stroke();
    if (this.eindX < 0) { this.eindX = ex; this.eindY = ey; }
    c.setLineDash([]);
    c.fillStyle = ACCENT; c.globalAlpha = 1;
    c.beginPath(); c.arc(ex, ey, 4.5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#0d141c'; c.lineWidth = 1.5; c.stroke();
    c.restore();
    this.ring(c, view, p.x, p.y, Math.max(14, p.ltr * sc * 0.6));
  }

  tekenRoute(c, view, p) {
    const R = p.R, v = p.v, I = R.info[v], benen = I.benen ?? [];
    const sc = view.schaal(), ox = view.w / 2 - view.cx * sc, oy = view.h / 2 - view.cy * sc;
    const x = p.x * sc + ox, y = p.y * sc + oy;
    let k = -1;
    for (let i = 0; i < benen.length; i++) if (benen[i].sStart <= p.s && p.s <= benen[i].sEind) { k = i; break; }
    c.save();
    if (k >= 0) {
      const B = benen[k], pc = R.pc, a0 = R.p0[v], a1 = R.p0[v + 1] - 1;
      // indexbereik van het rest van dit been met binair zoeken
      let lo = a0, hi = a1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pc[m] <= p.s) lo = m; else hi = m; }
      const van = lo;
      lo = a0; hi = a1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pc[m] <= B.sEind) lo = m; else hi = m; }
      const tot = Math.min(a1, lo + 1);
      const stap = Math.max(1, Math.ceil((tot - van) / ROUTE_MAX));
      c.strokeStyle = ACCENT; c.lineWidth = 2; c.globalAlpha = 0.9;
      c.setLineDash([6, 5]);
      c.beginPath();
      c.moveTo(x, y);
      for (let i = van + 1; i < tot; i += stap) c.lineTo(R.px[i] * sc + ox, R.py[i] * sc + oy);
      const ex = R.px[tot] * sc + ox, ey = R.py[tot] * sc + oy;
      c.lineTo(ex, ey);
      c.stroke();
      if (this.eindX < 0) { this.eindX = ex; this.eindY = ey; }
      c.setLineDash([]);
      c.fillStyle = ACCENT; c.globalAlpha = 1;
      c.beginPath(); c.arc(ex, ey, 4.5, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#0d141c'; c.lineWidth = 1.5; c.stroke();
    }
    // zachte ring om het voertuig
    const m = MAAT[R.soort[v]] ?? MAAT[0], r = Math.max(14, view.geo.T * sc * m[0] * 1.7);
    this.ringR = r;
    c.globalAlpha = 0.18; c.fillStyle = ACCENT;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.75; c.strokeStyle = ACCENT; c.lineWidth = 1.5;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    c.restore();
  }

  // De kaart bijwerken, hooguit 4 keer per seconde en alleen bij gewijzigde html.
  werkBij(view, nu, nu1 = false) {
    const el = this.el;
    if (!el || el.hidden || this.sleutel == null) return;
    if (!nu1 && nu - this.laatst < 250) return;
    this.laatst = nu;
    let html;
    const sluitKnop = '<button type="button" class="knop klein vk-sluit" aria-label="Sluiten">×</button>';
    if (this.einde) {
      const kop = this.soort === 'trein' ? 'Trein' : this.soort === 'stil' ? 'Vrachtwagen' : 'Voertuig';
      html = `<div class="context-kop"><b>${kop}</b>${sluitKnop}</div><div class="vk-einde">${esc(this.eindTekst || 'Rit beëindigd')}</div>`;
    } else {
      const p = this.heeftPlek ? this.plek : this.plekVan(view);
      if (!p) return;
      const info = this.soort === 'trein' ? treinInfo(view, p) : this.soort === 'stil' ? stilInfo(view, p.R, p.v) : voertuigInfo(view, p);
      if (!info) return;
      const regels = info.regels.map(([a, b]) => `<div><span class="zacht">${esc(a)}</span> ${esc(b)}</div>`).join('');
      const knop = this.soort === 'stil' ? '<button type="button" class="knop klein primair vk-gebouw">Naar het gebouw</button>'
        : this.volgen ? '<button type="button" class="knop klein vk-stop">Stop volgen</button>' : '<button type="button" class="knop klein primair vk-volg">Volg</button>';
      html = `<div class="context-kop"><b>${esc(info.titel)}</b>${sluitKnop}</div>
<div class="vk-regels">${regels}<div><span class="zacht">Nu</span> ${esc(info.stand)}</div>${info.land ? `<div class="zacht vk-land">${esc(info.land)}</div>` : ''}</div>
<div class="vk-knoppen">${knop}</div>`;
    }
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    if (this.telefoon()) {
      el.style.left = el.style.top = '';
      const a = el.getBoundingClientRect(), b = view.wrap.getBoundingClientRect();
      this.dekking = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    } else {
      this.dekking = 0;
      const w = view.wrap.clientWidth, h = view.wrap.clientHeight, bw = el.offsetWidth || 300;
      // bij het volgen staat het voertuig in het midden: de kaart ernaast, buiten de ring
      if (this.volgen && this.heeftPlek && !this.einde) {
        const sc = view.schaal();
        this.tik.x = (this.plek.x - view.cx) * sc + view.w / 2; this.tik.y = (this.plek.y - view.cy) * sc + view.h / 2;
        this.tikR = this.ringR;
      } else this.tikR = 0;
      const tr = this.tikR;
      // naast de tik, aan de kant waar de route niet heen gaat (zodat de routelijn zichtbaar blijft)
      const links = this.eindX > this.tik.x && this.tik.x - tr - 16 - bw >= 8;
      const x = Math.max(8, Math.min(links ? this.tik.x - tr - 16 - bw : this.tik.x + tr + 16, w - bw - 16)), bh = el.offsetHeight;
      let y = this.tik.y - 40;
      // ligt het doel toch onder de kaart, dan erboven of eronder
      if (this.eindX >= x - 8 && this.eindX <= x + bw + 8 && this.eindY >= y - 8 && this.eindY <= y + bh + 8) y = this.eindY < this.tik.y ? this.tik.y + 24 : this.tik.y - 24 - bh;
      el.style.left = `${x}px`;
      el.style.top = `${Math.max(8, Math.min(y, h - bh - 8))}px`;
    }
  }
}
