// C15d Geluid: een eerste procedurele geluidslaag met Web Audio. Geen samples en geen bibliotheken: alles is synthese en
// zelfgemaakte ruis. Alleen weergave: deze module leest de toestand (ui.state, ui.kaart) en schrijft er niets in.
//
// Bij het importeren raakt dit bestand niets van window, document, localStorage of AudioContext aan, zodat het in node
// te testen is (tools/geluidtest.mjs). De pure functies (leesInstelling, mixOmgeving, meetBeeld, klankPlan,
// klankVoorPing, magPingKlinken, soortVanToast) staan los; maakGeluid() bouwt de levende laag:
//   tik(ui, nu)        elk beeld (vanuit src/ui/geluidstart.js); om de 250 ms meet het wat er in beeld is en zet het de mix
//   bouw(e)            een bouwgebeurtenis uit oplevering.js (bouwstart, oplevering)
//   melding(soort)     een nieuwe toast; pings gaan voor (een toast vlak na een pinggeluid blijft stil)
//   speel(id, opties)  een losse klank uit klankPlan
//   instellingen(), zet(deel), knop(wrap), stand()
// Er bestaat geen AudioContext vóór het eerste echte gebaar (isTrusted) en nooit onder kijk.mjs (__kijkEcht). Op iOS telt
// pointerdown niet als gebaar: resume() gebeurt pas in touchend, pointerup (geen muis), click of keydown.
// Geen performance.now, geen Date en geen Math.random: de tijd komt uit tik(nu) of ctx.currentTime, het toeval uit een
// eigen xorshift32.

import { tegelOp } from '../engine/geografie.js';
import { weer, wind } from './seizoen.js';

export const SLEUTEL = 'machtsbalans.geluid';
export const STANDAARD = Object.freeze({ aan: true, volume: 0.6, omgeving: 0.8, interface: 0.7, gebeurtenis: 0.9 });
const DELEN = ['volume', 'omgeving', 'interface', 'gebeurtenis'];

export const MAX_STEMMEN = 12, MAX_TIK_STEMMEN = 10, MAX_VASTE_NODES = 35;
export const MIX_MS = 250, PING_BUITEN_MS = 20000, PING_VOOR_MELDING_MS = 1500, OPLEVERING_KORT_MS = 10000;
export const MELDING_OUD_MS = 2000;
const ZOOM_AI = 3.6;

// Basisniveaus van de vaste lussen (de mix geeft 0..1, dit maakt de lussen onderling in balans).
const NIVEAU = { zee: 0.9, wind: 0.45, regen: 0.22, stad: 0.55, verkeer: 0.5, wereld: 0.22 };

const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const klem = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const glad = (a, b, v) => { const t = klem((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// xorshift32: het eigen toeval van de geluidslaag (getal in 0..1).
export function maakXor(zaad = 0x9E3779B9) {
  let s = (zaad >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const hashTekst = (t) => { let h = 2166136261; const s = String(t ?? ''); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// ---------- 2 instellingen ----------
export function leesInstelling(tekst) {
  let ruw = null;
  try { ruw = tekst ? JSON.parse(tekst) : null; } catch { ruw = null; }
  return klemInstelling(ruw && typeof ruw === 'object' ? ruw : {});
}
function klemInstelling(ruw) {
  const uit = { aan: typeof ruw.aan === 'boolean' ? ruw.aan : STANDAARD.aan };
  for (let i = 0; i < DELEN.length; i++) {
    const k = DELEN[i], v = ruw[k];
    uit[k] = typeof v === 'number' && Number.isFinite(v) ? klem(v) : STANDAARD[k];
  }
  return uit;
}

// ---------- 3 omgevingsmix ----------
export const KANALEN = ['zee', 'wind', 'stad', 'verkeer', 'wereld', 'vogels', 'krekels', 'regen', 'gevecht'];
// beeld = { zoom, zee, land, stad, zeePan, stadPan, verkeer, natuurDag, natuurNacht, nacht, regen, wind, gevecht, gevechtPan }
// stand = { pauze, verborgen, gestart }
export function mixOmgeving(beeld, inst, stand, uit = {}) {
  const b = beeld || {};
  const h = glad(1, 6, fin(b.zoom));
  const nacht = klem(fin(b.nacht)), regen = klem(fin(b.regen)), kracht = klem(fin(b.wind));
  uit.helder = h;
  // Wind: op lage zoom de hoofdklank naast de wereldtoon (hooguit 0,25), inzoomend zachter dan zee en stad. De plan-
  // formule min(0,12 + 0,13(1-h) + 0,25k, 0,25 + 0,2h) liet de wind bij harde wind met de zoom stijgen; dat botst met de
  // eis dat de wind van zoom 1 naar 6 daalt. Daarom een menging van twee eindpunten die bij elke windkracht daalt.
  uit.wind = (0.15 + 0.10 * kracht) * (1 - h) + (0.10 + 0.12 * kracht) * h;
  uit.wereld = 0.30 * (1 - h);
  uit.zee = klem(fin(b.zee)) * (0.30 + 0.70 * h);
  uit.stad = klem(fin(b.stad)) * (0.15 + 0.85 * h) * (1 - 0.45 * nacht);
  uit.verkeer = klem(fin(b.verkeer)) * h * (1 - 0.6 * nacht);
  uit.vogels = klem(fin(b.natuurDag)) * h * (1 - nacht) * (1 - 0.7 * regen);
  uit.krekels = klem(fin(b.natuurNacht)) * h * nacht;
  uit.regen = regen * (0.5 + 0.5 * h);
  uit.gevecht = Math.min(1, klem(fin(b.gevecht), 0, 99)) * (0.35 + 0.65 * h);
  // Begrenzen: de som van de kwadraten blijft <= 1. De deler hangt alleen van het beeld af, niet van de zoom (de stijgende
  // kanalen op volle zoom plus het maximum van wind en wereldtoon, 0,25² + 0,30²), zodat inzoomen elk kanaal nooit zachter
  // maakt doordat een ander kanaal harder wordt. Delen door de wortel van de som op de zoom zelf deed dat wel.
  const s1 = klem(fin(b.stad)) * (1 - 0.45 * nacht), v1 = klem(fin(b.verkeer)) * (1 - 0.6 * nacht), z1 = klem(fin(b.zee));
  const vo1 = klem(fin(b.natuurDag)) * (1 - nacht) * (1 - 0.7 * regen), kr1 = klem(fin(b.natuurNacht)) * nacht;
  const g1 = Math.min(1, klem(fin(b.gevecht), 0, 99));
  const som = z1 * z1 + s1 * s1 + v1 * v1 + vo1 * vo1 + kr1 * kr1 + regen * regen + g1 * g1 + 0.25 * 0.25 + 0.30 * 0.30;
  if (som > 1) { const d = Math.sqrt(som); for (let i = 0; i < KANALEN.length; i++) uit[KANALEN[i]] /= d; }
  const st = stand || {};
  if (st.verborgen || !st.gestart || (inst && inst.aan === false)) {
    for (let i = 0; i < KANALEN.length; i++) uit[KANALEN[i]] = 0;
  } else if (st.pauze) {
    for (let i = 0; i < KANALEN.length; i++) uit[KANALEN[i]] *= 0.55;
    uit.gevecht = 0;
  }
  uit.zeePan = klem(fin(b.zeePan), -1, 1);
  uit.stadPan = klem(fin(b.stadPan), -1, 1);
  uit.gevechtPan = klem(fin(b.gevechtPan), -1, 1);
  return uit;
}

// ---------- 4 wat er in beeld is ----------
const RASTER_X = 8, RASTER_Y = 5;
// Bebouwing per tegel: hoofdstad 1, de buren 0,6, elke plaatsing +0,5 (hooguit 1), kolonies 0,5. Alleen opnieuw bij een
// nieuwe state of dag.
function bouwBebouwd(state, cache) {
  const geo = state.pack.geo, n = geo.tegels.length;
  if (!cache.bebouwd || cache.bebouwd.length !== n) cache.bebouwd = new Float32Array(n);
  const b = cache.bebouwd;
  b.fill(0);
  const L = state.landen;
  for (let i = 0; i < L.length; i++) {
    const hi = geo.hoofdstad[i];
    if (hi >= 0) {
      const tg = geo.tegels[hi];
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
        const j = tegelOp(geo, tg.x + dk * geo.T, tg.y + dr * geo.T);
        if (j >= 0 && b[j] < 0.6) b[j] = 0.6;
      }
      b[hi] = 1;
    }
    const P = L[i].plaatsingen || [];
    for (let k = 0; k < P.length; k++) { const t = P[k].t; if (t >= 0 && t < n) b[t] = Math.min(1, b[t] + 0.5); }
  }
  // De stad op de kaart is groter dan haar tegels (straten en blokken eromheen): elke bebouwde tegel geeft zijn
  // buren een derde van zijn waarde (in een tweede array, zodat de volgorde van de tegels niet uitmaakt).
  if (!cache.rand || cache.rand.length !== n) cache.rand = new Float32Array(n);
  const r = cache.rand;
  r.fill(0);
  for (let t = 0; t < n; t++) {
    const v = b[t] / 3;
    if (v <= 0) continue;
    const tg = geo.tegels[t];
    for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
      if (!dr && !dk) continue;
      const j = tegelOp(geo, tg.x + dk * geo.T, tg.y + dr * geo.T);
      if (j >= 0 && r[j] < v) r[j] = v;
    }
  }
  for (let t = 0; t < n; t++) if (r[t] > b[t]) b[t] = r[t];
  const K = state.kolonies || [];
  for (let k = 0; k < K.length; k++) { const t = K[k].t; if (t >= 0 && t < n && b[t] < 0.5) b[t] = 0.5; }
  cache.state = state;
  cache.dag = state.dag;
}

export function meetBeeld(kaart, state, cache = {}) {
  const b = cache.beeld || (cache.beeld = {});
  b.zoom = fin(kaart?.zoom); b.zee = 0; b.land = 0; b.stad = 0; b.zeePan = 0; b.stadPan = 0; b.verkeer = 0;
  b.natuurDag = 0; b.natuurNacht = 0; b.nacht = klem(fin(kaart?.nacht)); b.regen = 0; b.wind = 0; b.gevecht = 0; b.gevechtPan = 0;
  if (!kaart || !state?.pack?.geo || typeof kaart.naarWereld !== 'function') return b;
  if (cache.state !== state || cache.dag !== state.dag || !cache.bebouwd) bouwBebouwd(state, cache);
  const geo = state.pack.geo, bb = cache.bebouwd;
  const w = fin(kaart.w) || 1, h = fin(kaart.h) || 1;
  let tel = 0, zee = 0, land = 0, stad = 0, zeeX = 0, stadX = 0;
  for (let j = 0; j < RASTER_Y; j++) {
    for (let i = 0; i < RASTER_X; i++) {
      const sx = ((i + 0.5) / RASTER_X) * w, sy = ((j + 0.5) / RASTER_Y) * h;
      const p = kaart.naarWereld(sx, sy), wx = p[0], wy = p[1];
      if (!(wx >= 0 && wx <= 1000 && wy >= 0 && wy <= 620)) continue;
      tel++;
      const pan = ((i + 0.5) / RASTER_X) * 2 - 1;
      if (kaart.zeeOp(wx, wy)) { zee++; zeeX += pan; continue; }
      land++;
      const t = tegelOp(geo, wx, wy);
      const v = t >= 0 ? bb[t] : 0;
      stad += v; stadX += pan * v;
    }
  }
  if (tel > 0) {
    b.zee = zee / tel; b.land = land / tel; b.stad = stad / tel;
    b.zeePan = zee ? zeeX / zee : 0; b.stadPan = stad > 0 ? stadX / stad : 0;
  }
  if (b.zoom >= 2.5) {
    b.stad = Math.max(b.stad, Math.min(1, fin(kaart.stadLaag?.nZv) / 40));
    b.verkeer = Math.min(1, fin(kaart.levenLaag?.nAuto) / 25 + fin(kaart.levenLaag?.nBoot) / 40);
  } else b.verkeer = 0.25 * b.stad;
  b.natuurDag = b.natuurNacht = b.land * (1 - Math.min(1, b.stad));
  const dag = fin(state.dag);
  b.regen = klem(fin(weer(dag, fin(kaart.cx), fin(kaart.cy)).regen));
  b.wind = klem(fin(wind(dag).kracht));
  // gevecht: eenheden die vechten en in beeld staan
  const U = state.eenheden || [];
  if (typeof kaart.eenheidPositie === 'function') {
    let n = 0, x = 0;
    for (let i = 0; i < U.length; i++) {
      const u = U[i];
      if (!u.vecht) continue;
      let p = null;
      try { p = kaart.eenheidPositie(u, 1); } catch { p = null; }
      if (!p || !(p[0] >= 0 && p[0] <= w && p[1] >= 0 && p[1] <= h)) continue;
      n++; x += p[0];
    }
    if (n) { b.gevecht = n / 6; b.gevechtPan = (x / n / w) * 2 - 1; }
  }
  return b;
}

// ---------- 5 klankplannen ----------
// Een stem: { t, duur, vorm sine|triangle|sawtooth|square|ruis, f0, f1, gain, filter?: { type, f, q }, attack? }
const V = (t, duur, vorm, f0, f1, gain, filter, attack) => {
  const s = { t, duur, vorm, f0, f1: f1 ?? f0, gain };
  if (filter) s.filter = filter;
  if (attack) s.attack = attack;
  return s;
};
const F = (type, f, q = 0.7) => ({ type, f, q });
export const KLANKEN = ['tik', 'weiger', 'slecht', 'goed', 'fase', 'oplevering', 'bouwstart', 'ping_oorlog', 'ping_vrede',
  'ping_verovering', 'ping_verlies', 'ping_brandhaard', 'ping_kolonie', 'inslag', 'tsjilp', 'krekel'];
const OPLEVER_TONEN = [523.25, 659.25, 783.99, 1046.5];
const TRANSPOSITIE = [1, 9 / 8, 4 / 3];

export function klankPlan(id, variant, rnd = 0.5, categorie = '') {
  const r = klem(fin(rnd));
  let plan;
  switch (id) {
    case 'tik': {
      const p = 0.96 + 0.08 * r;
      if (variant === 'bouw' || variant === 'plaats') plan = [V(0, 0.07, 'sine', 520 * p, 430 * p, 0.18)];
      else if (variant === 'tab' || variant === 'tempo') plan = [V(0, 0.025, 'sine', 2100 * p, 2100 * p, 0.12)];
      else if (variant === 'sluit') plan = [V(0, 0.05, 'sine', 900 * p, 600 * p, 0.16)];
      else plan = [V(0, 0.004, 'ruis', 3000, 3000, 0.25, F('highpass', 3000)), V(0, 0.035, 'sine', 1650 * p, 1400 * p, 0.18)];
      break;
    }
    case 'weiger':
      plan = [V(0, 0.09, 'triangle', 330, 330, 0.2, F('lowpass', 1200)), V(0.09, 0.09, 'triangle', 247, 247, 0.2, F('lowpass', 1200))];
      break;
    case 'slecht':
      plan = [V(0, 0.5, 'sine', 196, 196, 0.2, F('lowpass', 900), 0.06), V(0, 0.5, 'sine', 233, 233, 0.16, F('lowpass', 900), 0.06)];
      break;
    case 'goed':
      plan = [V(0, 0.12, 'triangle', 784, 784, 0.15), V(0.12, 0.12, 'triangle', 1175, 1175, 0.13)];
      break;
    case 'fase': {
      const T = [262, 330, 392, 523];
      plan = T.map((f, i) => V(i * 0.06, 1.4 - i * 0.06, 'triangle', f, f, 0.09, null, 0.02));
      break;
    }
    case 'oplevering': {
      const k = Math.min(2, Math.floor(r * 3));
      const om = hashTekst(categorie) % 4;
      const tonen = [];
      for (let i = 0; i < 4; i++) tonen.push(OPLEVER_TONEN[(i + om) % 4] * TRANSPOSITIE[k]);
      const boven = V(0.27, 0.93, 'sine', tonen[0] * 2.76, tonen[0] * 2.76, 0.05, null, 0.01);
      if (variant === 'kort') { plan = [V(0, 0.9, 'sine', boven.f0, boven.f0, 0.05, null, 0.01)]; break; }
      const g = variant === 'ai' ? 0.35 : 1;
      plan = tonen.map((f, i) => V(i * 0.09, 1.2 - i * 0.09, 'triangle', f, f, 0.12 * g, null, 0.008));
      if (variant !== 'ai') plan.push(boven);
      break;
    }
    case 'bouwstart':
      plan = [V(0, 0.006, 'ruis', 1800, 1800, 0.35, F('bandpass', 1800, 4)), V(0.14, 0.006, 'ruis', 1800, 1800, 0.35, F('bandpass', 1800, 4))];
      break;
    case 'ping_oorlog':
      plan = [98, 147, 185].map((f) => V(0, 1.6, 'sawtooth', f, f, 0.06, F('lowpass', 700), 0.04));
      plan.push(V(0, 0.4, 'sine', 70, 38, 0.35));
      break;
    case 'ping_vrede':
      plan = [V(0, 1.8, 'sine', 392, 392, 0.12, null, 0.08), V(0, 1.8, 'sine', 587, 587, 0.09, null, 0.12)];
      break;
    case 'ping_verovering':
      plan = [523, 659, 784, 1047].map((f, i) => V(i * 0.08, 0.5, 'triangle', f, f, 0.11));
      break;
    case 'ping_verlies':
      plan = [V(0, 0.3, 'triangle', 440, 440, 0.14), V(0.3, 0.3, 'triangle', 370, 370, 0.14)];
      break;
    case 'ping_brandhaard':
      plan = [V(0, 0.9, 'sine', 466, 466, 0.11, null, 0.02), V(0, 0.9, 'sine', 494, 494, 0.11, null, 0.02)];
      break;
    case 'ping_kolonie':
      plan = [V(0, 0.3, 'triangle', 659, 659, 0.13), V(0.15, 0.35, 'triangle', 988, 988, 0.11)];
      break;
    case 'inslag':
      plan = [V(0, 0.45, 'sine', 64, 30, 0.4), V(0, 0.12, 'ruis', 400, 400, 0.3, F('lowpass', 400))];
      break;
    case 'tsjilp': {
      const x = maakXor(Math.floor(r * 4294967295) ^ 0x5bd1e995);
      const n = 2 + Math.min(2, Math.floor(r * 3));
      plan = [];
      let t = 0;
      for (let i = 0; i < n; i++) {
        const duur = 0.06 + 0.06 * x();
        plan.push(V(t, duur, 'sine', 2600, 4200, 0.5, null, 0.006));
        t += duur + 0.04 + 0.08 * x();
      }
      break;
    }
    case 'krekel': {
      plan = [];
      for (let i = 0; i < 4; i++) plan.push(V(i * 0.036, 0.018, 'sine', 4300, 4300, 0.4, null, 0.003));
      break;
    }
    default:
      return [];
  }
  if (variant === 'info') for (let i = 0; i < plan.length; i++) plan[i].gain *= 0.5;
  return plan;
}

// Welke klank hoort bij een ping (of null: een oplevering klinkt al via de bouwgebeurtenis).
export function klankVoorPing(p) {
  if (!p) return null;
  switch (p.soort) {
    case 'oorlog': return { id: 'ping_oorlog', variant: null };
    case 'vrede': return { id: 'ping_vrede', variant: null };
    case 'verovering': return { id: p.ernst === 'slecht' ? 'ping_verlies' : 'ping_verovering', variant: null };
    case 'verlies': return { id: 'ping_verlies', variant: null };
    case 'brandhaard': return { id: 'ping_brandhaard', variant: null };
    case 'kolonie': return { id: 'ping_kolonie', variant: null };
    default: return null;
  }
}

// Gaat een ping de speler aan? Pings voor het land van de speler, of waarin de speler de andere partij is (velden
// ander, a of b als de ping die heeft), klinken altijd. pings.js maakt goed- en slecht-pings alleen voor wat de speler
// raakt (een eigen oorlog heeft p.land = de vijand, met ernst slecht); 'info' is buitenland.
// Geeft 'eigen', 'info' (buitenland, zacht) of null (stil: buitenland binnen 20 s na het vorige buitenlandse geluid).
export function magPingKlinken(p, speler, nu, laatsteBuiten) {
  if (!p) return null;
  const eigen = p.land === speler || p.ander === speler || p.a === speler || p.b === speler || p.ernst === 'goed' || p.ernst === 'slecht';
  if (eigen) return 'eigen';
  if (laatsteBuiten != null && Number.isFinite(laatsteBuiten) && nu - laatsteBuiten < PING_BUITEN_MS) return null;
  return 'info';
}

const ERNST_RANG = { slecht: 0, goed: 1, info: 2 };
const pingRang = (p) => (p.soort === 'oorlog' ? -1 : 0) + (ERNST_RANG[p.ernst] ?? 3);

// De soort van een toast: data-soort (C15b), anders de TWEEDE klasse (de eerste is 'toast'), nooit de laatste.
export function soortVanToast(el) {
  if (!el) return 'info';
  const ds = el.dataset?.soort;
  if (ds) return ds;
  const cl = el.classList;
  if (cl && cl.length > 1) return cl[1] ?? (typeof cl.item === 'function' ? cl.item(1) : 'info');
  const delen = String(el.className ?? '').trim().split(/\s+/);
  return delen[1] || 'info';
}

// ---------- 6-11 de levende laag ----------
export function maakGeluid({ venster = globalThis, doc = globalThis.document, opslag, AudioCtx } = {}) {
  if (AudioCtx === undefined) AudioCtx = venster?.AudioContext ?? venster?.webkitAudioContext;
  if (opslag === undefined) { opslag = null; if (doc) { try { opslag = venster.localStorage ?? null; } catch { opslag = null; } } }
  const later = (fn, ms) => { try { return venster?.setTimeout ? venster.setTimeout(fn, ms) : null; } catch { return null; } };
  const wisLater = (id) => { try { if (id != null) venster?.clearTimeout?.(id); } catch { /* niets */ } };
  const rnd = maakXor(0x9E3779B9);

  let inst = { ...STANDAARD };
  try { inst = leesInstelling(opslag?.getItem?.(SLEUTEL) ?? null); } catch { inst = { ...STANDAARD }; }
  const bewaar = () => { try { opslag?.setItem?.(SLEUTEL, JSON.stringify(inst)); } catch { /* geblokkeerde opslag: in het geheugen */ } };

  let ctx = null, graaf = null, actief = 0, klok = 0, laatsteUi = null;
  let laatsteTikTijd = -1, laatsteGebTijd = -1, laatsteGebRang = 0;
  let laatsteMix = -1e12, vogelOp = 0, krekelOp = 0, inslagOp = 0;
  let pingState = null, pingLijst = null, laatsteId = 0, laatstePing = -1e12, laatsteBuiten = null;
  let laatsteOplevering = -1e12;
  const wachtrij = [];
  const cache = {};
  const mix = {};
  let uitTimer = null;

  const verborgen = () => doc?.visibilityState === 'hidden';

  // ----- 6 audiograaf -----
  function ruisBuffer(sec) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * sec));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    return buf;
  }
  function bouwGraaf() {
    const c = ctx, nu = c.currentTime;
    const g = { nodes: 0 };
    const tel = (n) => { g.nodes++; return n; };
    const gain = (v = 0) => { const n = tel(c.createGain()); n.gain.value = v; return n; };
    const filt = (type, f, q = 0.7) => { const n = tel(c.createBiquadFilter()); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    const osc = (type, f) => { const n = tel(c.createOscillator()); n.type = type; n.frequency.value = f; return n; };
    const pan = () => (typeof c.createStereoPanner === 'function' ? tel(c.createStereoPanner()) : null);
    const lus = (buf, offset) => { const n = tel(c.createBufferSource()); n.buffer = buf; n.loop = true; n.start(nu, offset); return n; };

    const comp = tel(c.createDynamicsCompressor());
    comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    comp.connect(c.destination);
    g.master = gain(0); g.master.connect(comp);
    g.kanaal = { omgeving: gain(inst.omgeving), interface: gain(inst.interface), gebeurtenis: gain(inst.gebeurtenis) };
    g.kanaal.omgeving.connect(g.master); g.kanaal.interface.connect(g.master); g.kanaal.gebeurtenis.connect(g.master);
    const om = g.kanaal.omgeving;
    // drie ruisbuffers met lengtes die geen veelvoud van elkaar zijn
    g.buf = [ruisBuffer(5.3), ruisBuffer(7.1), ruisBuffer(9.7)];
    const naar = (a, ...rest) => { let x = a; for (const b of rest) { if (!b) continue; x.connect(b); x = b; } return x; };
    // zee: lowpass 320+680*helder, golf-LFO 0,09 Hz (diepte 0,35 van het doel), panner
    {
      const src = lus(g.buf[0], 0), lp = filt('lowpass', 320), gn = gain(0), p = pan();
      const lfo = osc('sine', 0.09), diepte = gain(0);
      naar(src, lp, gn, p, om); lfo.connect(diepte); diepte.connect(gn.gain); lfo.start(nu);
      g.zee = { src, lp, gain: gn, pan: p, diepte, rate: 0.013, fase: 0.0 };
    }
    // wind: bandpass 500 q0,8, LFO 0,05 Hz ±250 Hz op de frequentie; regen deelt de bron (highpass 2500)
    {
      const src = lus(g.buf[1], 0), bp = filt('bandpass', 500, 0.8), gn = gain(0);
      const lfo = osc('sine', 0.05), diepte = gain(250);
      naar(src, bp, gn, om); lfo.connect(diepte); diepte.connect(bp.frequency); lfo.start(nu);
      const hp = filt('highpass', 2500), rg = gain(0);
      naar(src, hp, rg, om);
      g.wind = { src, gain: gn, rate: 0.021, fase: 1.7 };
      g.regen = { gain: rg };
    }
    // stad: lowpass 180+220*helder plus bandpass 1400 q1,2 op 0,15, panner
    {
      const src = lus(g.buf[2], 0), lp = filt('lowpass', 180), bp = filt('bandpass', 1400, 1.2), bg = gain(0.15), gn = gain(0), p = pan();
      naar(src, lp, gn); naar(src, bp, bg, gn); naar(gn, p, om);
      g.stad = { src, lp, gain: gn, pan: p, rate: 0.017, fase: 3.1 };
    }
    // verkeer: lowpass 220, gain-LFO 0,23 Hz (zelfde buffer als zee, andere plek)
    {
      const src = lus(g.buf[0], 2.65), lp = filt('lowpass', 220), gn = gain(0);
      const lfo = osc('sine', 0.23), diepte = gain(0);
      naar(src, lp, gn, om); lfo.connect(diepte); diepte.connect(gn.gain); lfo.start(nu);
      g.verkeer = { src, gain: gn, diepte, rate: 0.027, fase: 4.4 };
    }
    // wereld: twee sines van 55 en 82,5 Hz door een zwevende lowpass van 300 Hz (LFO 0,03 Hz ±80 Hz)
    {
      const a = osc('sine', 55), b = osc('sine', 82.5), lp = filt('lowpass', 300), gn = gain(0);
      const lfo = osc('sine', 0.03), diepte = gain(80);
      a.connect(lp); b.connect(lp); naar(lp, gn, om); lfo.connect(diepte); diepte.connect(lp.frequency);
      a.start(nu); b.start(nu); lfo.start(nu);
      g.wereld = { gain: gn };
    }
    return g;
  }

  function maakContext() {
    if (ctx || !AudioCtx) return ctx;
    try { if (venster?.navigator?.audioSession) venster.navigator.audioSession.type = 'ambient'; } catch { /* niets */ }
    try { ctx = new AudioCtx({ latencyHint: 'interactive' }); } catch { ctx = null; return null; }
    try { graaf = bouwGraaf(); } catch { graaf = null; }
    return ctx;
  }
  function wek() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    try { const p = ctx.resume(); p?.catch?.(() => {}); } catch { /* niets */ }
    try {
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start(0);
      s.onended = () => { try { s.disconnect(); } catch { /* niets */ } };
    } catch { /* niets */ }
    if (graaf) zetMaster(inst.volume, 0.8);
  }
  function zetMaster(doel, tau) {
    if (!ctx || !graaf) return;
    try { graaf.master.gain.setTargetAtTime(doel, ctx.currentTime, tau); } catch { /* niets */ }
  }

  // ----- 8 ontgrendelen -----
  const magGebaar = (e) => !!e && e.isTrusted === true && typeof venster?.__kijkEcht !== 'function' && !!AudioCtx;
  function gebaar(e) {
    if (!magGebaar(e) || !inst.aan) return;
    const had = !!ctx;
    if (e.type === 'pointerdown') {
      maakContext();
      if (e.pointerType === 'mouse') wek();
      if (had) interfaceTik(e);
      return;
    }
    if (e.type === 'pointerup' && e.pointerType === 'mouse') return;
    maakContext();
    wek();
  }
  function interfaceTik(e) {
    const t = e.target?.closest?.('button, [data-actie], [data-tempo], [data-tab], [data-kaart], [data-ping], select, input[type=checkbox]');
    if (!t) return;
    const ds = t.dataset || {};
    if (t.disabled || t.getAttribute?.('aria-disabled') === 'true') { speel('weiger', { gain: 0.5 }); return; }
    const variant = ds.actie ?? (ds.tempo != null ? 'tempo' : ds.tab != null ? 'tab' : null);
    speel('tik', { variant });
  }

  // ----- 9 verborgen, pauze en uit -----
  function zichtWissel() {
    if (!ctx) return;
    if (verborgen()) {
      zetMaster(0, 0.05);
      wisLater(uitTimer);
      uitTimer = later(() => { if (verborgen() && ctx?.state === 'running') { try { ctx.suspend()?.catch?.(() => {}); } catch { /* niets */ } } }, 150);
    } else if (inst.aan) {
      try { ctx.resume()?.catch?.(() => {}); } catch { /* niets */ }
      zetMaster(inst.volume, 0.8);
    }
  }
  function uitzetten() {
    if (!ctx) return;
    zetMaster(0, 0.05);
    wisLater(uitTimer);
    uitTimer = later(() => { if (!inst.aan && ctx?.state === 'running') { try { ctx.suspend()?.catch?.(() => {}); } catch { /* niets */ } } }, 150);
  }
  function aanzetten(e) {
    if (e) { if (magGebaar(e)) { maakContext(); wek(); } }
    else if (ctx) { try { ctx.resume()?.catch?.(() => {}); } catch { /* niets */ } }
    if (ctx) zetMaster(inst.volume, 0.8);
  }

  // ----- 7 losse stemmen -----
  function speel(id, opt = {}) {
    if (!ctx || !graaf || ctx.state !== 'running' || !inst.aan) return false;
    const kanaal = opt.kanaal ?? (id === 'tik' || id === 'weiger' ? 'interface' : id === 'tsjilp' || id === 'krekel' ? 'omgeving' : 'gebeurtenis');
    const nu = ctx.currentTime;
    if (kanaal === 'interface') {
      if (laatsteTikTijd >= 0 && nu - laatsteTikTijd < 0.04) return false;
    } else if (kanaal === 'gebeurtenis') {
      const rang = id === 'ping_oorlog' ? 3 : opt.variant === 'info' ? 0 : 1;
      if (laatsteGebTijd >= 0 && nu - laatsteGebTijd < 0.6 && rang <= laatsteGebRang) return false;
    }
    const plan = klankPlan(id, opt.variant ?? null, rnd(), opt.categorie ?? '');
    if (!plan.length) return false;
    const grens = kanaal === 'interface' ? MAX_TIK_STEMMEN : MAX_STEMMEN;
    if (actief + plan.length > grens) return false;
    if (kanaal === 'interface') laatsteTikTijd = nu;
    else if (kanaal === 'gebeurtenis') { laatsteGebTijd = nu; laatsteGebRang = id === 'ping_oorlog' ? 3 : opt.variant === 'info' ? 0 : 1; }
    const schaal = fin(opt.gain ?? 1) || 0;
    const uit = graaf.kanaal[kanaal] ?? graaf.kanaal.gebeurtenis;
    for (let i = 0; i < plan.length; i++) stem(plan[i], nu + 0.005, schaal, uit);
    return true;
  }
  function stem(s, t0, schaal, uit) {
    const c = ctx;
    let bron;
    const start = t0 + s.t, eind = start + s.duur;
    if (s.vorm === 'ruis') {
      bron = c.createBufferSource();
      const buf = graaf.buf[Math.floor(rnd() * 3) % 3];
      bron.buffer = buf;
    } else {
      bron = c.createOscillator();
      bron.type = s.vorm;
      bron.frequency.setValueAtTime(s.f0, start);
      if (s.f1 !== s.f0) bron.frequency.exponentialRampToValueAtTime(Math.max(1, s.f1), eind);
    }
    let f = null;
    if (s.filter) { f = c.createBiquadFilter(); f.type = s.filter.type; f.frequency.value = s.filter.f; f.Q.value = s.filter.q ?? 0.7; }
    const env = c.createGain();
    const piek = Math.max(0.0002, s.gain * schaal), att = Math.min(s.attack ?? 0.005, s.duur * 0.5);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(piek, start + att);
    env.gain.exponentialRampToValueAtTime(0.0001, eind);
    if (f) { bron.connect(f); f.connect(env); } else bron.connect(env);
    env.connect(uit);
    actief++;
    bron.onended = () => {
      actief = Math.max(0, actief - 1);
      try { bron.disconnect(); f?.disconnect(); env.disconnect(); } catch { /* niets */ }
    };
    if (s.vorm === 'ruis') bron.start(start, rnd() * 4); else bron.start(start);
    bron.stop(eind + 0.03);
  }

  // ----- 10 gebeurtenissen -----
  function volgPings(ui) {
    const lijst = ui?.kaart?.levend?.pings?.lijst, st = ui?.state;
    if (!lijst || !st) return;
    if (st !== pingState || lijst !== pingLijst) {
      pingState = st; pingLijst = lijst; laatsteId = 0;
      for (let i = 0; i < lijst.length; i++) if (lijst[i].id > laatsteId) laatsteId = lijst[i].id;
      return;
    }
    let nieuw = null, max = laatsteId;
    for (let i = 0; i < lijst.length; i++) {
      const p = lijst[i];
      if (!(p.id > laatsteId)) continue;
      if (p.id > max) max = p.id;
      (nieuw || (nieuw = [])).push(p);
    }
    laatsteId = max;
    if (!nieuw) return;
    nieuw.sort((a, b) => pingRang(a) - pingRang(b) || a.id - b.id);
    let n = 0;
    for (let i = 0; i < nieuw.length && n < 2; i++) {
      const p = nieuw[i], k = klankVoorPing(p);
      if (!k) continue;
      const mag = magPingKlinken(p, st.speler, klok, laatsteBuiten);
      if (!mag) continue;
      n++;
      const ok = speel(k.id, { variant: mag === 'info' ? 'info' : k.variant });
      if (ok || !ctx) { laatstePing = klok; if (mag === 'info') laatsteBuiten = klok; }
    }
  }
  function verwerkMeldingen() {
    for (let i = 0; i < wachtrij.length; i++) {
      const m = wachtrij[i];
      if (klok - m.t < 100) continue;
      wachtrij.splice(i--, 1);
      // Een melding die al lang wacht (de beeldlus stond stil, bijvoorbeeld bij een verborgen tabblad) klinkt niet alsnog.
      if (klok - m.t > MELDING_OUD_MS) continue;
      if (laatstePing >= m.t - PING_VOOR_MELDING_MS) continue;
      if (m.soort === 'slecht') speel('slecht');
      else if (m.soort === 'goed') speel('goed');
      else if (m.soort === 'fase') speel('fase');
    }
  }
  function melding(soort) {
    if (wachtrij.length >= 6) wachtrij.shift();
    wachtrij.push({ soort: String(soort ?? 'info'), t: klok });
  }
  function bouw(e) {
    const ui = laatsteUi, st = ui?.state;
    if (!e || !st) return false;
    const eigen = e.land === st.speler;
    if (e.soort === 'bouwstart') return eigen ? speel('bouwstart') : false;
    if (e.soort !== 'oplevering') return false;
    if (eigen) {
      const kort = klok - laatsteOplevering < OPLEVERING_KORT_MS;
      laatsteOplevering = klok;
      return speel('oplevering', { variant: kort ? 'kort' : null, categorie: e.gebouw });
    }
    const k = ui.kaart;
    if (!k || !(k.zoom >= ZOOM_AI)) return false;
    const tg = st.pack?.geo?.tegels?.[e.tegel];
    if (!tg || (typeof k.zichtbaar === 'function' && !k.zichtbaar(tg))) return false;
    return speel('oplevering', { variant: 'ai', categorie: e.gebouw });
  }

  // ----- mix toepassen -----
  function zetDoel(param, doel, nu, tau = 0.6) { try { param.setTargetAtTime(doel, nu, tau); } catch { /* niets */ } }
  function pasMixToe(ui) {
    const st = ui?.state;
    const beeld = st && ui.kaart ? meetBeeld(ui.kaart, st, cache) : null;
    const stand = { pauze: !!ui && (ui.tempo === 0 || !!ui.modal || !!st?.uitkomst), verborgen: verborgen(), gestart: ctx.state === 'running' };
    mixOmgeving(beeld || {}, inst, stand, mix);
    if (!beeld) for (let i = 0; i < KANALEN.length; i++) mix[KANALEN[i]] = 0;
    if (!graaf) return mix;
    const nu = ctx.currentTime, g = graaf;
    zetDoel(g.zee.gain.gain, mix.zee * NIVEAU.zee, nu);
    if (g.zee.diepte) zetDoel(g.zee.diepte.gain, mix.zee * NIVEAU.zee * 0.35, nu);
    zetDoel(g.zee.lp.frequency, 320 + 680 * mix.helder, nu);
    zetDoel(g.wind.gain.gain, mix.wind * NIVEAU.wind, nu);
    zetDoel(g.regen.gain.gain, mix.regen * NIVEAU.regen, nu);
    zetDoel(g.stad.gain.gain, mix.stad * NIVEAU.stad, nu);
    zetDoel(g.stad.lp.frequency, 180 + 220 * mix.helder, nu);
    zetDoel(g.verkeer.gain.gain, mix.verkeer * NIVEAU.verkeer, nu);
    zetDoel(g.verkeer.diepte.gain, mix.verkeer * NIVEAU.verkeer * 0.4, nu);
    zetDoel(g.wereld.gain.gain, mix.wereld * NIVEAU.wereld, nu);
    if (g.zee.pan) zetDoel(g.zee.pan.pan, mix.zeePan * 0.6, nu);
    if (g.stad.pan) zetDoel(g.stad.pan.pan, mix.stadPan * 0.6, nu);
    // de afspeelsnelheid van elke lus zweeft langzaam (±3 %, 0,01..0,03 Hz), zodat je geen herhaling hoort
    const lussen = [g.zee, g.wind, g.stad, g.verkeer];
    for (let i = 0; i < lussen.length; i++) {
      const l = lussen[i];
      zetDoel(l.src.playbackRate, 1 + 0.03 * Math.sin(2 * Math.PI * l.rate * nu + l.fase), nu, 1.5);
    }
    if (inst.aan && !stand.verborgen) zetMaster(inst.volume, 0.8);
    return mix;
  }
  function omgevingsStemmen(pauze) {
    if (!ctx || ctx.state !== 'running') return;
    if (mix.vogels > 0.1 && klok >= vogelOp) {
      speel('tsjilp', { kanaal: 'omgeving', gain: 0.08 * mix.vogels / 0.5 });
      vogelOp = klok + 1500 + 4500 * rnd();
    }
    if (mix.krekels > 0.1 && klok >= krekelOp) {
      speel('krekel', { kanaal: 'omgeving', gain: 0.05 * mix.krekels / 0.4 });
      krekelOp = klok + 700 + 1800 * rnd();
    }
    if (mix.gevecht > 0.05 && !pauze && klok >= inslagOp) {
      speel('inslag', { kanaal: 'omgeving', gain: 0.6 * Math.min(1, mix.gevecht * 2) });
      inslagOp = klok + 1000 * Math.min(2.5, 0.6 / mix.gevecht) * (0.7 + 0.6 * rnd());
    }
  }

  function tik(ui, nu) {
    klok = fin(nu);
    laatsteUi = ui ?? null;
    volgPings(ui);
    verwerkMeldingen();
    if (!ctx) return;
    if (klok - laatsteMix < MIX_MS) return;
    laatsteMix = klok;
    if (ctx.state !== 'running') return;
    pasMixToe(ui);
    omgevingsStemmen(!!ui && (ui.tempo === 0 || !!ui.modal || !!ui.state?.uitkomst));
  }

  // ----- 11 knop en paneel -----
  let knopEl = null, paneel = null, paneelTimer = null, langTimer = null, lang = false;
  const SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9.2h3.6L12.5 5v14l-4.9-4.2H4z" fill="currentColor"/>'
    + '<path class="geluid-golf" d="M15.6 8.8a4.4 4.4 0 0 1 0 6.4M18.2 6.3a8 8 0 0 1 0 11.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    + '<path class="geluid-streep" d="M3.5 3.5l17 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  function knopStand() {
    if (!knopEl) return;
    knopEl.classList.toggle('uit', !inst.aan);
    knopEl.setAttribute('aria-pressed', inst.aan ? 'true' : 'false');
    knopEl.title = inst.aan ? 'Geluid uit (lang indrukken: instellingen)' : 'Geluid aan';
    if (paneel) {
      const c = paneel.querySelector('input[data-geluid-deel="aan"]');
      if (c) c.checked = inst.aan;
      for (let i = 0; i < DELEN.length; i++) {
        const r = paneel.querySelector(`input[data-geluid-deel="${DELEN[i]}"]`);
        if (r && doc?.activeElement !== r) r.value = String(Math.round(inst[DELEN[i]] * 100));
      }
    }
  }
  function sluitPaneel() { wisLater(paneelTimer); paneelTimer = null; if (paneel) paneel.hidden = true; }
  function houdOpen() { wisLater(paneelTimer); paneelTimer = later(sluitPaneel, 5000); }
  function openPaneel() {
    if (!doc || !knopEl) return;
    if (!paneel) {
      paneel = doc.createElement('div');
      paneel.className = 'geluid-paneel';
      paneel.setAttribute('role', 'group');
      paneel.setAttribute('aria-label', 'Geluid');
      const rij = (k, naam) => `<label class="geluid-rij"><span>${naam}</span><input type="range" min="0" max="100" step="1" data-geluid-deel="${k}"></label>`;
      paneel.innerHTML = '<label class="geluid-rij geluid-check"><input type="checkbox" data-geluid-deel="aan"><span>Geluid aan</span></label>'
        + rij('volume', 'Volume') + rij('omgeving', 'Omgeving') + rij('interface', 'Interface') + rij('gebeurtenis', 'Gebeurtenissen')
        + '<p class="geluid-hint">Op een iPhone met de stilknop aan hoor je niets.</p>';
      paneel.addEventListener('input', (e) => {
        const k = e.target?.dataset?.geluidDeel;
        if (!k || k === 'aan') return;
        zet({ [k]: (+e.target.value || 0) / 100 });
        houdOpen();
      });
      paneel.addEventListener('change', (e) => {
        if (e.target?.dataset?.geluidDeel !== 'aan') return;
        const aan = !!e.target.checked;
        if (aan !== inst.aan) { zet({ aan }); if (aan) aanzetten(e); }
        houdOpen();
      });
      paneel.addEventListener('pointerdown', houdOpen, { passive: true });
      const plek = knopEl.parentElement?.parentElement ?? knopEl.parentElement;
      plek?.appendChild(paneel);
    }
    paneel.hidden = false;
    knopStand();
    houdOpen();
  }
  function knop(wrap) {
    if (!doc || !wrap || knopEl) return knopEl;
    knopEl = doc.createElement('button');
    knopEl.type = 'button';
    knopEl.className = 'geluid-knop';
    knopEl.setAttribute('data-geluid', '');
    knopEl.setAttribute('aria-label', 'Geluid');
    knopEl.innerHTML = SVG;
    wrap.prepend ? wrap.prepend(knopEl) : wrap.insertBefore(knopEl, wrap.firstChild);
    knopEl.addEventListener('pointerdown', () => {
      lang = false; wisLater(langTimer);
      langTimer = later(() => { lang = true; openPaneel(); }, 500);
    }, { passive: true });
    const stopLang = () => { wisLater(langTimer); langTimer = null; };
    knopEl.addEventListener('pointerup', stopLang, { passive: true });
    knopEl.addEventListener('pointercancel', stopLang, { passive: true });
    knopEl.addEventListener('pointerleave', stopLang, { passive: true });
    knopEl.addEventListener('contextmenu', (e) => e.preventDefault());
    knopEl.addEventListener('click', (e) => {
      stopLang();
      if (lang) { lang = false; return; }
      const aan = !inst.aan;
      zet({ aan });
      if (aan) { aanzetten(e); openPaneel(); } else sluitPaneel();
    });
    knopStand();
    return knopEl;
  }

  // ----- instellingen -----
  function zet(deel = {}) {
    const oud = inst.aan;
    inst = klemInstelling({ ...inst, ...deel });
    bewaar();
    if (ctx && graaf) {
      const nu = ctx.currentTime;
      zetDoel(graaf.kanaal.omgeving.gain, inst.omgeving, nu, 0.05);
      zetDoel(graaf.kanaal.interface.gain, inst.interface, nu, 0.05);
      zetDoel(graaf.kanaal.gebeurtenis.gain, inst.gebeurtenis, nu, 0.05);
      if (inst.aan && oud) zetMaster(inst.volume, 0.05);
    }
    if (oud !== inst.aan) { if (!inst.aan) uitzetten(); else aanzetten(null); }
    knopStand();
    return { ...inst };
  }
  function stand() {
    if (!AudioCtx) return 'geen';
    if (!inst.aan) return 'uit';
    if (!ctx) return 'wacht';
    return ctx.state;
  }

  // listeners (alleen met een document)
  if (doc && typeof doc.addEventListener === 'function') {
    const opt = { capture: true, passive: true };
    for (const t of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) doc.addEventListener(t, gebaar, opt);
    doc.addEventListener('visibilitychange', zichtWissel);
    doc.addEventListener('pointerdown', (e) => {
      if (!paneel || paneel.hidden) return;
      const t = e.target;
      if (paneel.contains?.(t) || knopEl?.contains?.(t)) return;
      sluitPaneel();
    }, opt);
  }

  return {
    tik, bouw, melding, speel, knop, zet, stand,
    instellingen: () => ({ ...inst }),
    // voor de test en de console
    context: () => ctx,
    vasteNodes: () => graaf?.nodes ?? 0,
    stemmen: () => actief,
    mix: () => ({ ...mix }),
    openPaneel,
  };
}
