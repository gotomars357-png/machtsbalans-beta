// Ritten: elk wegvoertuig rijdt een rit die uit de economie volgt, over het wegennet, en alles herhaalt zich elke dag
// van H = 180 s.
//
// Hoe het werkt (puur uit de toestand en het net, zonder geschiedenis):
//   1. Plan: uit plaatsingen, gebouwdefinities, resources (rol), contracten en oorlogen volgt per land een lijst
//      voertuigen. Elk voertuig heeft een thuis (dock, parkeerplek bij een oprit of plek op een parkeerstrook) en een
//      dagprogramma: ritten (benen) van rustpunt naar rustpunt, met vertrektijden, laad- en lostijden. Aantallen en
//      tijden staan in RITREGELS.
//   2. Dagpad: per voertuig één doorlopende lijn voor de hele dag over de rijlijnen van het net (rechts houden),
//      met bochten op de knopen, in- en uitparkeren, achteruit uit het dock en de stops (halte, douane).
//   3. Dienstregeling: een tijdstapsimulatie over één dag vanaf middernacht (u = 90), met afstand houden zonder
//      inhalen, één voertuig tegelijk op een kruisvlak, wachten voor rood, voor een dichte overweg en (bij afslaan)
//      voor een bezette zebra, en reserveringen op docks. Om middernacht staat iedereen thuis stil, dus de uitkomst
//      is precies periodiek.
//   4. ritStand(v, u) zoekt de stand op: plek op het dagpad per tijdstap, lineair ertussen, binair zoeken op het pad.
// Bouwen gaat in plakken (een generator); de uitkomst hangt niet af van de plakgrootte. Verandert de ritset, dan
// wisselt leven.js per voertuig alleen op een rustpunt (zie Ritten.wissel).
//
// Tijd: u is de verkeersklok van het net (0 = middag, 90 = middernacht). Intern rekent dit bestand met
// τ = (u − 90) mod H: seconden sinds middernacht. Fase f = u / H, dus de ochtendspits (fase 0,74 tot 0,86) is
// τ 43 tot 65 en de avondspits (fase 0,14 tot 0,26) τ 115 tot 137.

import { H, C, KLASSE, KNOOP, PROFIEL, OPRIT, ZONE, lichtStand, voetLicht } from './wegennet.js';
import { oorlogenVan } from '../engine/leger.js';
import { sneeuwDekVan } from './terrein.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

export const U0 = 90;                 // middernacht in u
export const DT = 0.25;               // tijdstap van de dienstregeling (s)
export const STAPPEN = Math.round(H / DT);
export const tauVan = (u) => ((((u - U0) % H) + H) % H);
export const TOESTAND = { RIJDT: 0, WACHT: 1, LAADT: 2, LOST: 3, GEPARKEERD: 4 };
// Voertuigsoorten (dezelfde nummers als de sprites in leven.js) en hun halve lengte en breedte in T.
export const VOERTUIG = { AUTO: 0, VRACHT: 1, BUS: 2, BESTEL: 3, TAXI: 4, POLITIE: 5, AMBU: 6, OPLEGGER: 7, VUIL: 8, SCHUIVER: 9, STROOI: 10, VEEG: 11 };
export const MAAT = [[0.05, 0.02], [0.08, 0.028], [0.1, 0.028], [0.064, 0.026], [0.05, 0.02], [0.052, 0.021], [0.066, 0.026],
  [0.1, 0.028], [0.078, 0.028], [0.074, 0.03], [0.07, 0.028], [0.05, 0.025]];
export const VRACHTSOORT = (s) => s === VOERTUIG.VRACHT || s === VOERTUIG.OPLEGGER;
const { AUTO, VRACHT, BUS, BESTEL, TAXI, POLITIE, AMBU, OPLEGGER, VUIL, STROOI } = VOERTUIG;

// Eén tabel voor aantallen en tijden. Tijden in τ (seconden na middernacht), duren in seconden.
//   rollen: welke goederen (resource-rol) een vrachtwagen krijgen; energie, geld en stabiliteit nooit.
//   ritmaat: hoeveel productie per dag één ronde waard is; rondes: hooguit zoveel per producent.
export const RITREGELS = {
  goederen: { voertuig: VRACHT, rollen: ['grondstof', 'voedsel', 'tech'], ritmaat: { grondstof: 2.5, voedsel: 3, tech: 0.5 }, rondes: 4, venster: [50, 110], laden: [6, 10], lossen: [5, 8], verbruikers: 2 },
  nacht: { gebouwen: ['mijn'], rondes: 1, venster: [6, 26] },                    // de mijn draait 's nachts door, minder
  haven: { voertuig: OPLEGGER, rondes: 2, venster: [56, 116], laden: [6, 10], lossen: [5, 8] },
  export: { voertuig: OPLEGGER, rondes: 2, venster: [40, 110], laden: [6, 10], lossen: [5, 8], douane: [2, 4], ver: 22, teVer: 50 },
  woonwerk: { voertuig: AUTO, heen: [44, 60], terug: [116, 130], perWerk: 1, perIndustrie: 2, ver: 1.6, deel: 0.5, centrum: 0 },
  zakelijk: { venster: [52, 128], verblijf: [4, 9], rondes: 4, deel: 0.5, max: 10, ruimte: 2, ver: 3 },
  boodschap: { voertuig: AUTO, venster: [56, 124], verblijf: [5, 12], rondes: 3, keus: 6, stad: 6, centrum: 2.5 },
  taxi: { voertuig: TAXI, aantal: 3, rondes: 4, venster: [40, 138], verblijf: [3, 5] },
  bus: { voertuig: BUS, halte: 3, venster: [42, 140], rust: 8, haltes: 5, ronde: 70 },
  bestel: { voertuig: BESTEL, rondes: 2, venster: [52, 118], lossen: [3, 5], perLand: 4, doelen: 2 },
  hulp: { politie: POLITIE, ambulance: AMBU, rondes: 2, venster: [48, 126], verblijf: [4, 8], onrustStab: 20, extra: 2 },
  vuil: { voertuig: VUIL, venster: [26, 34], stop: 2, stops: 3, straal: 2.5 },
  strooi: { voertuig: STROOI, drempel: 0.3, vensters: [[30, 44], [122, 136]] },
  konvooi: { voertuig: VRACHT, aantal: 3, rondes: 2, venster: [50, 126], tussen: 2.2 },
};

// Rijgedrag (T per s, T per s²).
const SNEL = [0.45, 0.6, 0.75, 1.0, 0.25];                 // per klasse; OPRIT apart
const BOCHT = 0.35, ACHTER = 0.18, PARK = 0.2, ACC = 0.8, REM = 0.8;
const SPELING = 0.012;                                     // ruimte bovenop wat net past (T)
const GAT = 0.035;                                         // bumper tot bumper bij stilstand (T)
// Stopplekken, in T voor de knoop (de neus van het voertuig): voor het licht, voor een kruising zonder licht, voor een
// poort waar iemand manoeuvreert (HOLD_DOOR: daar blijft ook de mond van de oprit vrij), en voor wie zelf de poort in
// wil (HOLD_IN: even ver als HOLD_DOOR, want wie achteruit van het dock komt, zwaait met zijn achterkant tot daar).
// VRIJ_*: zo ver moet de achterkant voorbij de knoop zijn voor hij vrijkomt; MOND: de halve oprit.
const HOLD_LICHT = 0.2, HOLD_KRUIS = 0.155, HOLD_DOOR = 0.17, HOLD_IN = 0.17, HOLD_POORT = 0.25, VRIJ_KRUIS = 0.075, VRIJ_POORT = 0.12, MOND = 0.06;
const SNEDE = 0.07;                                        // op kruisingen begint de bocht zoveel voor de knoop
// Een bocht midden in een tak is scherp als de richting over 0,24 T meer dan 60° draait (cos 60° = 0,5); hoekpunten
// binnen BOCHT_RAND T van een knoop horen bij die knoop. BOCHT_VRIJ: zo ver voor en na de bocht houdt een voertuig
// het bochtvlak (bovenop zijn halve lengte).
const BOCHT_SCHERP = 0.5, BOCHT_RAND = 0.15, BOCHT_VRIJ = 0.11;
const ERF_BAAN = 0.021, ERF_BAAN_LANG = 0.016;   // lange voertuigen dichter bij de as (de bocht de oprit in)
// Langs een parkeerstrook: de geparkeerde auto staat half op de stoep (STROOK_UIT voorbij de asfaltrand), en wie
// breder is dan een auto (BREED) schuift WIJK naar de as op om er langs te kunnen; de tegenligger past dan nog net.
const RECHT = 0.02;                                        // het rechte stukje bij het in- en uitparkeren langs de stoep
const STROOK_UIT = 0.007, BREED = 0.022, WIJK = 0.009, WIJK_AAN = 0.1, WIJK_EIND = 0.05;
const ERF_EIND = 0.1, ERF_AAN = 0.12;
const WACHT_LICHT = 4.5, WACHT_KRUIS = 1;                   // verwachte wachttijd bij het kiezen van een route (s)
const KOM = 1.4;                                           // zo ver vooruit kijkt een voertuig naar voorgangers (T)

// Soorten conflicten op het pad.
const C_LICHT = 0, C_KRUIS = 1, C_DOOR = 2, C_MAN = 3, C_OVERWEG = 4;
// Vlaggen per stuk van het dagpad.
const F_ACHTER = 1, F_KNIP = 2, F_LINKS = 4;
// In de standen per tijdstap staat naast TOESTAND ook 5: stilstaan bij een halte, de douane of een vuilnisstop
// (voor de buitenwereld is dat wachten; ritStand geeft er stop = 1 bij).
const Z_STOP = 5;
// Soorten rustpunten.
const R_DOCK = 0, R_PLEK = 1, R_STROOK = 2;

const sleutelVan = (g) => (g >= 0 ? 2 * g : 2 * ~g + 1);

// Parkeerplek j van poort p: x, y en hoek. De plekken van het net (parkeerVan in wegennet.js) beginnen 0,09 T van de
// tegelrand, zodat een auto in de eerste rij half op de stoep zou staan; hier liggen ze PLEK_IN dieper de kavel in,
// en een draaiende vrachtwagen in de mond van de oprit raakt ze niet.
export const PLEK_IN = 0.05;
export function plekPlaats(net, p, j, T, uit = {}) {
  const q = net.poorten[p], K = q.knoop, D = q.dock;
  let ex = net.kx[D] - net.kx[K], ey = net.ky[D] - net.ky[K];
  const el = Math.hypot(ex, ey) || 1;
  ex /= el; ey /= el;
  uit.x = q.parkeer[j * 3] + ex * PLEK_IN * T; uit.y = q.parkeer[j * 3 + 1] + ey * PLEK_IN * T; uit.hoek = q.parkeer[j * 3 + 2];
  return uit;
}
const LEEG_PAD = [];

// Voetgangers op zebra z: 0..1 hoe ver ze zijn, of -1 als er niemand oversteekt. Ze lopen alleen in de eerste
// 2,5 s van hun groen en niet elke cyclus. leven.js tekent ze met dezelfde functie.
export function zebraBezet(net, z, u) {
  const Z = net.zebras[z], K = Z.knoop;
  const li = net.kLicht[K];
  if (li < 0) return -1;
  const arm = net.armVan(K, Z.tak);
  if (arm < 0 || !voetLicht(net, K, arm, u)) return -1;
  const L = net.lichten[li], v = ((((u + L.fase0) % C) + C) % C);
  const g = L.groep[arm] ?? 0, b = g === 0 ? 8 : 0.5;
  const w = v - b;
  if (w < 0 || w >= 2.5) return -1;
  const cyc = Math.floor((u + L.fase0 - b) / C);
  if (hash(z, ((cyc % 12) + 12) % 12, 61) > 0.6) return -1;
  return w / 2.5;
}

// ---------- 1. plan ----------

// Per tegel de rol van wat er staat: gebouw-id, zone en het land.
function tegelInfo(state, net) {
  const P = state.pack, n = state.pack.geo.tegels.length;
  const geb = new Array(n).fill(null), land = new Int16Array(n).fill(-1);
  for (const L of state.landen) {
    for (const p of L.plaatsingen) {
      if (p.t < 0 || p.t >= n) continue;
      geb[p.t] = { p, def: P.gebouwIndex[p.g] };
      land[p.t] = L.idx;
    }
  }
  return { geb, land };
}

const zoneVan = (def) => def?.zone ?? ZONE[def?.tekening ?? def?.id] ?? ZONE[def?.id] ?? 'werk';
const isOpslag = (def) => def && (def.id === 'opslag' || def.tekening === 'opslag' || def.id === 'spoor');
const isHaven = (def) => def && (def.id === 'haven' || !!def.handel_bonus || zoneVan(def) === 'haven');

// Alle rustpunten: docks (per poort), plekken langs de oprit (per poort) en plekken op parkeerstroken.
function rustpunten(net, T) {
  const nP = net.poorten.length;
  const plek0 = new Int32Array(nP + 1);
  for (let p = 0; p < nP; p++) plek0[p + 1] = plek0[p] + net.poorten[p].parkeer.length / 3;
  const strook0 = new Int32Array(net.parkeerstroken.length + 1);
  for (let k = 0; k < net.parkeerstroken.length; k++) strook0[k + 1] = strook0[k] + net.parkeerstroken[k].plekken;
  return { nP, plek0, strook0, n: nP + plek0[nP] + strook0[net.parkeerstroken.length], T };
}
const dockId = (R, p) => p;
const plekId = (R, p, j) => R.nP + R.plek0[p] + j;
const strookId = (R, k, j) => R.nP + R.plek0[R.nP] + R.strook0[k] + j;

// Een generator: geeft af en toe de beurt terug (yield) zodat het plannen over frames verdeeld wordt.
function* plan(state, net, geo, M, nat = null, plak = PLAK) {
  const T = geo.T, P = state.pack, dag = state.dag ?? 0;
  let werk = 0;                                            // werkeenheden sinds de laatste yield
  const { geb } = tegelInfo(state, net);
  const R = rustpunten(net, T);
  const pvT = net.D.poortVanT;
  const poortOp = (t) => (t >= 0 && t < pvT.length ? pvT[t] : -1);
  const bezet = new Uint8Array(R.n);                       // rustpunt al thuis of werkplek van een voertuig
  const dockThuis = new Int32Array(R.nP).fill(-1);
  const voertuigen = [];
  const pt = (p) => net.poorten[p];
  const afst = (a, b) => Math.hypot(pt(a).x - pt(b).x, pt(a).y - pt(b).y);
  // over het net te bereiken (een eiland met een eigen net is een los deel: net.bereikbaar, als het net dat heeft)
  const bereik = (a, b) => {
    const ka = pt(a).knoop, kb = pt(b).knoop;
    if (a === b || ka === kb) return false;
    if (typeof net.bereikbaar === 'function' && !net.bereikbaar(ka, kb)) return false;
    werk += M.routes.has(ka * net.nK + kb) ? 1 : 150;
    return M.route(ka, kb).length > 0;
  };
  const zt = {};
  const reistijd = (a, b) => { werk += 150; return M.zoek(null, pt(a).knoop, null, pt(b).knoop, zt) ? zt.tijd : Infinity; };
  const rol = (res) => P.resIndex?.[res]?.rol;
  const wilRol = RITREGELS.goederen.rollen;
  const sneeuw = sneeuwDekVan(dag) > RITREGELS.strooi.drempel;
  const dock = (p) => ({ soort: R_DOCK, p, id: dockId(R, p) });
  // Een poort met zijn oprit of dock in het water (een kavel over een rivier) of een parkeerstrook op een brug of in
  // het water: daar parkeert niemand.
  const natP = new Uint8Array(R.nP), natPlek = new Uint8Array(R.n), natStrook = new Uint8Array(net.parkeerstroken.length);
  if (nat) {
    const o = {};
    for (let p = 0; p < R.nP; p++) {
      if ((p & 127) === 127) yield;
      const q = pt(p), K = q.knoop, D = q.dock;
      // (de hele oprit, ook het stuk vlak achter de stoep: daar ligt bij een kade het water het eerst)
      for (let f = 1; f <= 10 && !natP[p]; f++) if (nat(net.kx[K] + (net.kx[D] - net.kx[K]) * f / 10, net.ky[K] + (net.ky[D] - net.ky[K]) * f / 10)) natP[p] = 1;
      for (let j = 0; j < q.parkeer.length / 3; j++) { plekPlaats(net, p, j, T, o); if (natP[p] || nat(o.x, o.y)) natPlek[plekId(R, p, j)] = 1; }
    }
    for (let k = 0; k < net.parkeerstroken.length; k++) {
      const S = net.parkeerstroken[k];
      if (net.tBouw[S.tak] !== 0) { natStrook[k] = 1; continue; }
      for (const f of [0, 0.5, 1]) { net.punt(S.tak, S.s0 + (S.s1 - S.s0) * f, o); if (nat(o.x, o.y)) natStrook[k] = 1; }
    }
  } else for (let k = 0; k < net.parkeerstroken.length; k++) natStrook[k] = net.tBouw[net.parkeerstroken[k].tak] !== 0 ? 1 : 0;
  // Een plek langs de oprit: niet bij een poort waar een voertuig aan het dock woont (wie in- of uitparkeert, steekt
  // de oprit-as over, en daar staat dan de hele nacht een vrachtwagen).
  const vrijePlek = (p, zoekVan = 0) => {
    if (dockThuis[p] >= 0) return null;
    const n = pt(p).parkeer.length / 3;
    for (let q = 0; q < n; q++) { const j = (q + zoekVan) % n, id = plekId(R, p, j); if (!bezet[id] && !natPlek[id]) return { soort: R_PLEK, p, j, id }; }
    return null;
  };
  const neem = (r) => { if (r) bezet[r.id] = 1; return r; };
  // een vrije plek bij de dichtstbijzijnde andere poort van land li (hooguit 2 T verder): wie bij een fabriek met een
  // eigen vrachtwagen werkt, parkeert om de hoek
  const plekBij = (p, q, li) => {
    werk += net.poorten.length >> 4;
    let best = null, bd = 2 * T;
    for (let k = 0; k < net.poorten.length; k++) {
      if (k === p || net.poorten[k].land !== li || dockThuis[k] >= 0) continue;
      const d = afst(p, k);
      if (d >= bd) continue;
      const r = vrijePlek(k, q);
      if (r && bereik(p, k)) { best = r; bd = d; }
    }
    return best;
  };
  // de poort waar een rustpunt bij hoort (een parkeerstrook: de poort van de tegel ernaast)
  const poortVanRust = (r) => (r.soort === R_STROOK ? poortOp(net.parkeerstroken[r.k].t) : r.p);
  const nieuw = (v) => { voertuigen.push(v); return v; };
  const benen = [];
  const been = (naar, o = {}) => ({ naar, vertrek: o.vertrek ?? 0, uiterst: o.uiterst ?? 1e9, verblijf: o.verblijf ?? 0, lossen: o.lossen ?? 0, laden: o.laden ?? 0, via: o.via ?? null, ronde: o.ronde ?? 0 });
  void benen;

  for (const L of state.landen) {
    werk += 20;
    if (werk > plak) { werk = 0; yield; }
    const li = L.idx;
    // poorten van dit land per soort
    const per = { prod: [], verbr: {}, opslag: [], haven: [], woon: [], werk: [], dienst: [], hoofd: [], politie: [], zorg: [], leger: [] };
    const gezien = new Set();
    for (const pl of L.plaatsingen) {
      if (pl.t < 0) continue;
      const p = poortOp(pl.t);
      if (p < 0 || gezien.has(p) || natP[p]) continue;
      gezien.add(p);
      const def = P.gebouwIndex[pl.g];
      if (!def) continue;
      const z = zoneVan(def);
      for (const res in def.productie ?? {}) {
        const r = rol(res);
        if (wilRol.includes(r) && def.productie[res] > 0) per.prod.push({ p, res, rol: r, maat: def.productie[res] * (pl.niveau ?? 1), id: def.id });
      }
      for (const res in def.verbruik ?? {}) if (wilRol.includes(rol(res))) (per.verbr[res] ??= []).push(p);
      if (isOpslag(def)) per.opslag.push(p);
      if (isHaven(def)) per.haven.push(p);
      if (def.woningen > 0 || z === 'woon') per.woon.push(p);
      else if (z === 'dienst' || z === 'centrum' || z === 'voorziening') per.dienst.push(p);
      else per.werk.push({ p, industrie: z === 'werk' });
      if (def.id === 'politie') per.politie.push(p);
      if (def.id === 'ziekenhuis' || def.zorg) per.zorg.push(p);
      if (z === 'leger') per.leger.push(p);
    }
    const hs = geo.hoofdstad?.[li];
    const hp = hs != null && hs >= 0 ? poortOp(hs) : -1;
    if (hp >= 0 && !natP[hp] && !gezien.has(hp)) { gezien.add(hp); per.woon.push(hp); per.hoofd.push(hp); }
    else if (hp >= 0 && !natP[hp]) per.hoofd.push(hp);
    for (const k of state.kolonies ?? []) if (k.land === li) { const p = poortOp(k.t); if (p >= 0 && !natP[p] && !gezien.has(p)) { gezien.add(p); per.woon.push(p); } }
    // (een generator: elke routevraag kan wat kosten, dus tussendoor de beurt teruggeven)
    const dichtste = function* (van, lijst, max = 1) {
      const k = [...new Set(lijst)].filter((q) => q !== van && !natP[q]).map((q) => [afst(van, q), q]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const uit = [];
      for (let i = 0; i < k.length && uit.length < max && i < 8; i++) {
        if (werk > plak) { werk = 0; yield; }
        if (bereik(van, k[i][1])) uit.push(k[i][1]);
      }
      return uit;
    };

    // goederen: producent → dichtstbijzijnde verbruiker over het net, anders opslag; leeg terug
    const G = RITREGELS.goederen;
    for (const pr of per.prod) {
      if (werk > plak) { werk = 0; yield; }
      if (dockThuis[pr.p] >= 0) continue;
      let doel = pr.rol === 'voedsel' ? (yield* dichtste(pr.p, [...per.opslag, ...per.woon], G.verbruikers)) : (yield* dichtste(pr.p, per.verbr[pr.res] ?? [], G.verbruikers));
      if (!doel.length) doel = (yield* dichtste(pr.p, pr.rol === 'tech' ? [...per.opslag, ...per.haven] : per.opslag, 1));
      if (!doel.length) continue;
      const rondes = clamp(Math.round(pr.maat / (G.ritmaat[pr.rol] ?? 3)), 1, G.rondes);
      const v = nieuw({ sleutel: `g${pr.p}`, land: li, soort: VRACHT, kleur: Math.floor(hash(pr.p, 3) * 5), vracht: 1, thuis: dock(pr.p), benen: [], rit: 'goederen', res: pr.res, rol: pr.rol, van: pr.p, doel });
      dockThuis[pr.p] = voertuigen.length - 1;
      const [a, b] = G.venster, stap = (b - a) / rondes;
      for (let k = 0; k < rondes; k++) {
        const d = doel[k % doel.length], t0 = a + stap * (k + 0.15 + 0.6 * hash(pr.p, k, 5));
        v.benen.push(been(dock(d), { vertrek: t0, uiterst: t0 + 12, lossen: lijn(G.lossen, pr.p, k), laden: lijn(G.laden, pr.p, k + 9), ronde: 2 }));
        v.benen.push(been(dock(pr.p), {}));
      }
      if (RITREGELS.nacht.gebouwen.includes(pr.id)) {
        const [n0, n1] = RITREGELS.nacht.venster, t0 = n0 + (n1 - n0) * hash(pr.p, 77);
        v.benen.unshift(been(dock(pr.p), {}));
        v.benen.unshift(been(dock(doel[0]), { vertrek: t0, uiterst: t0 + 10, lossen: lijn(G.lossen, pr.p, 40), laden: lijn(G.laden, pr.p, 41), ronde: 2 }));
      }
    }
    // haven ↔ opslag
    const HV = RITREGELS.haven;
    for (const h of per.haven) {
      if (werk > plak) { werk = 0; yield; }
      if (dockThuis[h] >= 0) continue;
      const doel = (yield* dichtste(h, per.opslag, 1));
      if (!doel.length) continue;
      const v = nieuw({ sleutel: `h${h}`, land: li, soort: OPLEGGER, kleur: Math.floor(hash(h, 4) * 5), vracht: 1, thuis: dock(h), benen: [], rit: 'haven', van: h, doel });
      dockThuis[h] = voertuigen.length - 1;
      const [a, b] = HV.venster, stap = (b - a) / HV.rondes;
      for (let k = 0; k < HV.rondes; k++) {
        const t0 = a + stap * (k + 0.2 + 0.5 * hash(h, k, 6));
        v.benen.push(been(dock(doel[0]), { vertrek: t0, uiterst: t0 + 12, lossen: lijn(HV.lossen, h, k), laden: lijn(HV.laden, h, k + 3), ronde: 2 }));
        v.benen.push(been(dock(h), { lossen: lijn(HV.lossen, h, k + 5) }));
      }
    }
    // export: per actief contract, vanuit een producent (of opslag) van het goed naar het partnerland, of naar de
    // eigen haven als er geen weg is
    const EX = RITREGELS.export;
    for (const c of state.contracten ?? []) {
      if (werk > plak) { werk = 0; yield; }
      if (c.status !== 'actief') continue;
      for (const [kant, partner] of [[c.a_geeft, c.b], [c.b_geeft, c.a]]) {
        if (!kant || (kant === c.a_geeft ? c.a : c.b) !== li || !wilRol.includes(rol(kant.res))) continue;
        const B = state.landen[partner];
        if (!B) continue;
        const bron = [...per.prod.filter((x) => x.res === kant.res).map((x) => x.p), ...per.opslag].find((p) => dockThuis[p] < 0) ?? per.opslag.find((p) => dockThuis[p] < 0);
        if (bron == null) continue;
        // doelen in het partnerland: opslag, verbruikers, hoofdstad
        const doelen = [];
        for (const pl of B.plaatsingen) { const p = poortOp(pl.t); const def = P.gebouwIndex[pl.g]; if (p >= 0 && (isOpslag(def) || def?.verbruik?.[kant.res])) doelen.push(p); }
        const bh = geo.hoofdstad?.[partner];
        if (bh != null && bh >= 0 && poortOp(bh) >= 0) doelen.push(poortOp(bh));
        // het doel dat over de weg het snelst te halen is; te ver voor een dagrit: dan via de eigen haven
        let doel = [], reis = Infinity, viaHaven = 0;
        for (const d of (yield* dichtste(bron, [...new Set(doelen)], 4))) { if (werk > plak) { werk = 0; yield; } const t = reistijd(bron, d); if (t < reis) { reis = t; doel = [d]; } }
        if (!doel.length || reis > EX.teVer) { doel = (yield* dichtste(bron, per.haven, 1)); viaHaven = 1; reis = doel.length ? reistijd(bron, doel[0]) : Infinity; }
        if (!doel.length) continue;
        const v = nieuw({ sleutel: `x${c.id}:${kant.res}`, land: li, soort: OPLEGGER, kleur: Math.floor(hash(c.id, 7) * 5), vracht: 1, thuis: dock(bron), benen: [], rit: 'export', res: kant.res, rol: rol(kant.res), contract: c.id, van: bron, doel, viaHaven, partner });
        dockThuis[bron] = voertuigen.length - 1;
        const rondes = reis > EX.ver ? 1 : clamp(Math.round((kant.per_dag ?? 4) / 8), 1, EX.rondes);
        const [a, b] = EX.venster, stap = (b - a) / rondes;
        for (let k = 0; k < rondes; k++) {
          const t0 = a + stap * (k + 0.2 + 0.5 * hash(c.id, k, 8));
          v.benen.push(been(dock(doel[0]), { vertrek: t0, uiterst: t0 + 12, lossen: lijn(EX.lossen, c.id, k), laden: lijn(EX.laden, c.id, k + 4), ronde: 2 }));
          v.benen.push(been(dock(bron), {}));
        }
      }
    }
    // stadsbus: één lijn langs de haltes van het land, rust aan een dock van een dienst of voorziening
    const haltes = net.haltes.map((h, i) => [h, i]).filter(([h]) => h.land === li);
    if (haltes.length >= 2) {
      const vrij = (p) => dockThuis[p] < 0 && !isOpslag(geb[pt(p).t]?.def);
      const depot = per.dienst.find((p) => vrij(p) && !per.politie.includes(p) && !per.zorg.includes(p) && !per.hoofd.includes(p)) ?? [...per.dienst, ...per.hoofd].find(vrij);
      if (depot != null) {
        dockThuis[depot] = voertuigen.length;
        const v = nieuw({ sleutel: `l${li}`, land: li, soort: BUS, kleur: 17, vracht: 0, thuis: dock(depot), benen: [], rit: 'bus', van: depot, doel: [] });
        // haltes in de volgorde van de dichtstbijzijnde vanaf het depot
        const rest = haltes.slice(), volg = [];
        let x = pt(depot).x, y = pt(depot).y;
        while (rest.length && volg.length < RITREGELS.bus.haltes) {
          let bi2 = 0, bd = Infinity;
          for (let i = 0; i < rest.length; i++) { const d = Math.hypot(rest[i][0].x - x, rest[i][0].y - y); if (d < bd) { bd = d; bi2 = i; } }
          const [h] = rest.splice(bi2, 1);
          volg.push(h[0]); x = h[0].x; y = h[0].y;
        }
        v.lijn = volg;
        v.benen.push(been(dock(depot), { vertrek: RITREGELS.bus.venster[0] + 6 * hash(li, 51), uiterst: RITREGELS.bus.venster[0] + 20, via: volg.map((h) => ({ halte: h, duur: RITREGELS.bus.halte })), ronde: 1 }));
        v.lus = 1;
      }
    }
    // vuilniswagen: vroeg langs de woonstraten
    const VU = RITREGELS.vuil;
    const stroken = net.parkeerstroken.map((s, k) => [s, k]).filter(([s]) => s.land === li);
    if (stroken.length >= 2) {
      // (het depot: de vrije opslag of werkplaats het dichtst bij de hoofdstad, waar de meeste woonstraten zijn)
      const kand = [...per.opslag, ...per.werk.map((w) => w.p)].filter((p) => dockThuis[p] < 0), hk = per.hoofd[0];
      const basis = hk == null ? kand[0] : kand.reduce((b, p) => (b == null || afst(hk, p) < afst(hk, b) ? p : b), null);
      if (basis != null) {
        dockThuis[basis] = voertuigen.length;
        const v = nieuw({ sleutel: `v${li}`, land: li, soort: VUIL, kleur: 22, vracht: 0, thuis: dock(basis), benen: [], rit: 'vuil', van: basis, doel: [] });
        // een korte ronde: steeds de dichtstbijzijnde nog niet bezochte strook (vanaf het depot), niet het hele land door
        const o = {}, waar = stroken.map(([S]) => { net.punt(S.tak, (S.s0 + S.s1) / 2, o); return [o.x, o.y]; });
        const kx = net.kx[pt(basis).knoop], ky = net.ky[pt(basis).knoop];
        const ronde = [], over = stroken.map((_, k) => k);
        let x = kx, y = ky, x0 = 0, y0 = 0;
        while (ronde.length < VU.stops && over.length) {
          let bi = 0;
          for (let q = 1; q < over.length; q++) if (Math.hypot(waar[over[q]][0] - x, waar[over[q]][1] - y) < Math.hypot(waar[over[bi]][0] - x, waar[over[bi]][1] - y)) bi = q;
          const k = over.splice(bi, 1)[0];
          // (de eerste stop is de dichtstbijzijnde straat; de rest ligt daar in de buurt)
          if (ronde.length && Math.hypot(waar[k][0] - x0, waar[k][1] - y0) > VU.straal * T) break;
          if (!ronde.length) [x0, y0] = waar[k];
          ronde.push(stroken[k]); [x, y] = waar[k];
        }
        if (ronde.length < 2) { dockThuis[basis] = -1; voertuigen.pop(); }
        else {
        const via = ronde.map(([s]) => ({ strook: s, duur: VU.stop, beide: true }));
        const [a, b] = VU.venster;
        v.benen.push(been(dock(basis), { vertrek: a + (b - a) * hash(li, 61), uiterst: b + 10, via }));
        }
      }
    }
    // strooiwagen bij sneeuw: over HOOFD en STAM langs de haltes en grensovergangen
    if (sneeuw) {
      const basis = [...per.werk.map((w) => w.p), ...per.opslag].find((p) => dockThuis[p] < 0);
      if (basis != null && haltes.length) {
        dockThuis[basis] = voertuigen.length;
        const v = nieuw({ sleutel: `s${li}`, land: li, soort: STROOI, kleur: 23, vracht: 0, thuis: dock(basis), benen: [], rit: 'strooi', van: basis, doel: [] });
        for (const [a, b] of RITREGELS.strooi.vensters) {
          v.benen.push(been(dock(basis), { vertrek: a + (b - a) * hash(li, 71), uiterst: b + 10, via: haltes.slice(0, 4).map(([h]) => ({ halte: h, duur: 0 })) }));
        }
      }
    }
    // bestelbussen: opslag → woonwijk en winkels (diensten)
    const BE = RITREGELS.bestel;
    for (const o of per.opslag.slice(0, BE.perLand)) {
      if (werk > plak) { werk = 0; yield; }
      const thuis = vrijePlek(o);
      const doel = (yield* dichtste(o, [...per.woon, ...per.dienst], BE.doelen));
      if (!thuis || !doel.length) continue;
      neem(thuis);
      const v = nieuw({ sleutel: `b${o}`, land: li, soort: BESTEL, kleur: 18, vracht: 0, thuis, benen: [], rit: 'bestel', van: o, doel });
      const [a, b] = BE.venster, stap = (b - a) / BE.rondes;
      for (let k = 0; k < BE.rondes; k++) {
        const t0 = a + stap * (k + 0.2 + 0.5 * hash(o, k, 9));
        v.benen.push(been(dock(doel[k % doel.length]), { vertrek: t0, uiterst: t0 + 12, lossen: lijn(BE.lossen, o, k), ronde: 2 }));
        v.benen.push(been(thuis, {}));
      }
    }
    // konvooi: alleen in oorlog, van een legerpost met vrije plekken naar de dichtstbijzijnde andere legerpost of de
    // hoofdstad (vóór de forensen en boodschappers, zodat er plek is)
    const KV = RITREGELS.konvooi;
    if (oorlogenVan(state, L).length && per.leger.length) {
      const vrij = (p, n) => { for (let q = 0; q < n; q++) if (!vrijePlek(p, q)) return false; return true; };
      const k0 = per.leger.find((p) => !natP[p] && vrij(p, 1));
      const doelen = k0 == null ? [] : (yield* dichtste(k0, [...per.leger, ...per.hoofd].filter((p) => vrij(p, 1)), 3));
      const doelP = doelen[0];
      if (doelP != null) {
        for (let q = 0; q < KV.aantal; q++) {
          const thuis = vrijePlek(k0, q), naar = vrijePlek(doelP, q);
          if (!thuis || !naar) break;
          neem(thuis); neem(naar);
          const v = nieuw({ sleutel: `k${li}:${q}`, land: li, soort: KV.voertuig, kleur: 16, vracht: 1, konvooi: 1, thuis, benen: [], rit: 'konvooi', van: k0, doel: [doelP] });
          const [a, b] = KV.venster, stap = (b - a) / KV.rondes;
          for (let k = 0; k < KV.rondes; k++) {
            const t0 = a + stap * (k + 0.2) + q * KV.tussen;
            v.benen.push(been(naar, { vertrek: t0, uiterst: t0 + 25, verblijf: 8, ronde: 2 }));
            v.benen.push(been(thuis, { vertrek: t0 + stap * 0.45 }));
          }
        }
      }
    }
    // hulpdiensten: politie en ambulance rijden een paar keer uit; bij onrust patrouilleert er meer politie, in een
    // pandemie rijden er meer ambulances (vanuit de hoofdstad als er geen bureau of ziekenhuis is)
    const HU = RITREGELS.hulp;
    const onrust = (L.stab ?? 100) < HU.onrustStab, ziek = !!state.pandemie?.besmet?.[li];
    for (const [lijst, soort, kleur, s, extra] of [[per.politie, POLITIE, 20, 'p', onrust], [per.zorg, AMBU, 21, 'z', ziek]]) {
      if (werk > plak) { werk = 0; yield; }
      const p0 = lijst[0] ?? (extra ? per.hoofd[0] ?? per.dienst[0] : null);
      if (p0 == null) continue;
      // (een ambulance rijdt naar woningen; een land met haast geen woonwijken: dan ook naar de rest)
      // (niet naar een poort waar een vrachtwagen aan het dock woont: daar is geen plek langs de oprit)
      const vrij = (q) => q !== p0 && dockThuis[q] < 0;
      const woon = per.woon.filter(vrij);
      const doelen = soort === AMBU && woon.length >= 2 ? woon : [...per.woon, ...per.dienst, ...per.werk.map((w) => w.p)].filter(vrij);
      const aantal = extra ? 1 + HU.extra : 1, rondes = extra ? HU.rondes * 2 : HU.rondes;
      // (politie en ambulance uit hetzelfde gebouw rijden op eigen tijden)
      const zout = soort === AMBU ? 50 : 0;
      for (let q = 0; q < aantal; q++) {
        // (staat er bij het bureau een vrachtwagen aan het dock, dan parkeert de wagen om de hoek)
        const thuis = vrijePlek(p0, q) ?? plekBij(p0, q, li);
        if (!thuis) break;
        neem(thuis);
        const v = nieuw({ sleutel: `${s}${p0}${q ? ':' + q : ''}`, land: li, soort, kleur, vracht: 0, thuis, benen: [], rit: 'hulp', van: p0, doel: [] });
        const [a, b] = HU.venster, stap = (b - a) / rondes;
        for (let k = 0; k < rondes && doelen.length; k++) {
          const p = doelen[Math.floor(hash(p0, k + 7 * q + zout, 41) * doelen.length)];
          if (p === p0 || !bereik(p0, p)) continue;
          const naar = soort === AMBU && dockThuis[p] < 0 ? dock(p) : vrijePlek(p, k);
          if (!naar) continue;
          if (naar.soort === R_PLEK) neem(naar);
          const t0 = a + stap * (k + 0.2 + 0.6 * hash(p0, k + 7 * q + zout, 42));
          v.benen.push(been(naar, { vertrek: t0, uiterst: t0 + 12, verblijf: lijn(HU.verblijf, p0, k + 7 * q + zout), lossen: soort === AMBU ? 4 : 0, ronde: 2 }));
          v.benen.push(been(thuis, {}));
          v.doel.push(p);
        }
        // geen enkele rit gevonden: dan blijft de plek vrij
        if (!v.benen.length) { bezet[thuis.id] = 0; voertuigen.pop(); break; }
      }
    }
    // taxi's bij de hoofdstad
    const TX = RITREGELS.taxi;
    if (per.hoofd.length) {
      const hp0 = per.hoofd[0];
      const doelen = [...per.woon.filter((p) => p !== hp0), ...per.dienst];
      for (let q = 0; q < TX.aantal && doelen.length; q++) {
        if (werk > plak) { werk = 0; yield; }
        const thuis = vrijePlek(hp0, q);
        if (!thuis) break;
        neem(thuis);
        const v = nieuw({ sleutel: `t${li}:${q}`, land: li, soort: TAXI, kleur: 19, vracht: 0, thuis, benen: [], rit: 'taxi', van: hp0, doel: [] });
        const [a, b] = TX.venster, stap = (b - a) / TX.rondes;
        for (let k = 0; k < TX.rondes; k++) {
          const p = doelen[Math.floor(hash(li, q * 7 + k, 31) * doelen.length)];
          const plek = vrijePlek(p, k);
          if (!plek || !bereik(hp0, p)) continue;
          neem(plek);
          const t0 = a + stap * (k + 0.3 * hash(li, q, k));
          v.benen.push(been(plek, { vertrek: t0, uiterst: t0 + 15, verblijf: lijn(TX.verblijf, li, q * 5 + k) , ronde: 2 }));
          v.benen.push(been(thuis, {}));
          v.doel.push(p);
        }
      }
    }
    // thuisplekken in dit land: parkeerstroken, dan de plekken bij woonpoorten en de hoofdstad
    const thuizen = [];
    for (let k = 0; k < net.parkeerstroken.length; k++) {
      const S = net.parkeerstroken[k];
      if (S.land !== li || natStrook[k]) continue;
      for (let j = 0; j < S.plekken; j++) thuizen.push({ soort: R_STROOK, k, j, id: strookId(R, k, j), x: geo.tegels[S.t].x, y: geo.tegels[S.t].y });
    }
    for (const p of per.woon) { const n = pt(p).parkeer.length / 3; for (let j = 0; j < n; j++) if (!natPlek[plekId(R, p, j)]) thuizen.push({ soort: R_PLEK, p, j, id: plekId(R, p, j), x: pt(p).x, y: pt(p).y }); }
    // de dichtstbijzijnde vrije thuisplek die minstens WW.ver tegels van het werk ligt (wie aan de overkant woont,
    // loopt); is die er niet, dan de verste
    const vrijThuis = (x, y) => {
      werk += thuizen.length >> 4;
      let best = null, bd = Infinity, ver = null, vd = -1;
      for (const h of thuizen) {
        if (bezet[h.id]) continue;
        const d = Math.hypot(h.x - x, h.y - y);
        if (d >= RITREGELS.woonwerk.ver * T) { if (d < bd) { bd = d; best = h; } }
        else if (d > vd) { vd = d; ver = h; }
      }
      return best ?? (vd >= 0.9 * T ? ver : null);
    };
    // woon-werk: per werkplek een paar auto's, uit de dichtstbijzijnde thuisplekken
    const WW = RITREGELS.woonwerk;
    // de werkplekken in het centrum eerst (daar is overdag het meeste te doen), dan de rest
    const mid = per.hoofd.length ? pt(per.hoofd[0]) : null;
    const werkplekken = [...per.werk.map((w) => w), ...per.dienst.map((p) => ({ p, industrie: false }))]
      .map((w, i) => [mid && WW.centrum ? Math.hypot(pt(w.p).x - mid.x, pt(w.p).y - mid.y) : 0, i, w]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
    // hooguit WW.deel van de thuisplekken is van een forens; de rest rijdt overdag een boodschap
    const wMax = Math.ceil(thuizen.length * WW.deel);
    let wn = 0;
    for (const w of werkplekken) {
      if (werk > plak) { werk = 0; yield; }
      const aantal = w.industrie ? WW.perIndustrie : WW.perWerk;
      for (let q = 0; q < aantal && wn < wMax; q++) {
        const werk = vrijePlek(w.p, q) ?? plekBij(w.p, q, li);
        if (!werk) break;
        const thuis = vrijThuis(pt(w.p).x, pt(w.p).y);
        if (!thuis) break;
        neem(werk); neem(thuis);
        const h = hash(w.p, q, 11), [a0, a1] = WW.heen, [b0, b1] = WW.terug;
        const v = nieuw({ sleutel: `w${thuis.id}`, land: li, soort: AUTO, kleur: Math.floor(hash(thuis.id, 12) * 8), vracht: 0, thuis, benen: [], rit: 'woonwerk', van: poortVanRust(thuis), doel: [w.p] });
        v.benen.push(been(werk, { vertrek: a0 + (a1 - a0) * h, uiterst: a1 + 8 }));
        v.benen.push(been(thuis, { vertrek: b0 + (b1 - b0) * hash(w.p, q, 13) }));
        wn++;
      }
    }
    // boodschappen en afspraken overdag: wie thuis staat rijdt een paar keer naar een dienst, voorziening of bedrijf
    // in de buurt (een van de dichtstbijzijnde, om beurten)
    const BO = RITREGELS.boodschap;
    const bestemmingen = [...new Set([...per.dienst, ...per.hoofd, ...per.werk.map((w) => w.p)])];
    const centrum = per.hoofd.length ? pt(per.hoofd[0]) : null;
    const inStad = centrum ? bestemmingen.map((p) => [Math.hypot(pt(p).x - centrum.x, pt(p).y - centrum.y), p]).filter((x) => x[0] <= BO.centrum * T).sort((a, b) => a[0] - b[0] || a[1] - b[1]) : [];
    // geen parkeerplek vrij bij de bestemming: dan een vrij stuk parkeerstrook vlakbij (binnen 0,8 T)
    const vrijStrook = thuizen.filter((h) => h.soort === R_STROOK);
    const strookBij = (p, h) => {
      werk += vrijStrook.length >> 4;
      const q = pt(p);
      let best = null, bd = 0.8 * T;
      for (const r of vrijStrook) {
        if (r === h || bezet[r.id]) continue;
        const d = Math.hypot(r.x - q.x, r.y - q.y);
        if (d < bd) { bd = d; best = r; }
      }
      return best;
    };
    let bi = 0;
    for (const h of thuizen) {
      if (werk > plak) { werk = 0; yield; }
      if (bezet[h.id] || !bestemmingen.length) continue;
      werk += bestemmingen.length >> 3;
      const kand = bestemmingen.filter((p) => !(h.soort === R_PLEK && h.p === p)).map((p) => [Math.hypot(pt(p).x - h.x, pt(p).y - h.y), p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, BO.keus);
      // de tweede ronde gaat de stad in (wie binnen BO.stad tegels van het centrum woont): een bedrijf of dienst in het
      // centrum, om beurten
      const stad = centrum && Math.hypot(centrum.x - h.x, centrum.y - h.y) <= BO.stad * T ? inStad : [];
      const ritjes = [];
      for (let k = 0; k < BO.rondes; k++) {
        const lijst = k % 2 === 1 && stad.length ? stad : kand;
        for (let q = 0; q < lijst.length; q++) {
          const p = lijst[(bi + 2 * k + q) % lijst.length][1], pl = vrijePlek(p, bi + k) ?? strookBij(p, h);
          if (pl) { neem(pl); ritjes.push([p, pl]); break; }
        }
      }
      bi++;
      if (!ritjes.length) continue;
      neem(h);
      const v = nieuw({ sleutel: `o${h.id}`, land: li, soort: AUTO, kleur: Math.floor(hash(h.id, 22) * 8), vracht: 0, thuis: h, benen: [], rit: 'boodschap', van: poortVanRust(h), doel: ritjes.map(([p]) => p) });
      const [a, b] = BO.venster, stap = (b - a) / ritjes.length;
      ritjes.forEach(([, pl], k) => {
        const t0 = a + stap * (k + 0.1 + 0.5 * hash(h.id, k, 21));
        v.benen.push(been(pl, { vertrek: t0, uiterst: t0 + 15, verblijf: lijn(BO.verblijf, h.id, 23 + k), ronde: 2 }));
        v.benen.push(been(h, {}));
      });
    }
    // zakelijk verkeer: een bedrijf met ruimte heeft een dienstauto die overdag een paar keer naar een ander bedrijf
    // of een dienst in de buurt rijdt en 's avonds weer op zijn eigen plek staat
    // (alleen waar er naar verhouding weinig mensen wonen: een zakencentrum zonder woonwijken)
    const ZA = RITREGELS.zakelijk;
    const zMax = Math.min(ZA.max, Math.max(0, Math.ceil((per.werk.length - thuizen.length) * ZA.deel)));
    let zn = 0;
    for (const w of werkplekken) {
      if (werk > plak) { werk = 0; yield; }
      if (zn >= zMax) break;
      const n = pt(w.p).parkeer.length / 3;
      let vrij = 0;
      for (let j = 0; j < n; j++) if (!bezet[plekId(R, w.p, j)] && !natPlek[plekId(R, w.p, j)]) vrij++;
      if (vrij < ZA.ruimte || dockThuis[w.p] >= 0) continue;
      const thuis = vrijePlek(w.p, 0);
      if (!thuis) continue;
      werk += bestemmingen.length >> 3;
      const kand = bestemmingen.filter((p) => p !== w.p).map((p) => [Math.hypot(pt(p).x - pt(w.p).x, pt(p).y - pt(w.p).y), p]).filter((x) => x[0] <= ZA.ver * T).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, BO.keus);
      if (!kand.length) continue;
      neem(thuis);
      const ritjes = [];
      for (let k = 0; k < ZA.rondes; k++) {
        for (let q = 0; q < kand.length; q++) {
          const p = kand[(zn + 2 * k + q) % kand.length][1], pl = vrijePlek(p, zn + k) ?? strookBij(p, thuis);
          if (pl) { neem(pl); ritjes.push([p, pl]); break; }
        }
      }
      if (!ritjes.length) { bezet[thuis.id] = 0; continue; }
      const v = nieuw({ sleutel: `d${thuis.id}`, land: li, soort: (zn & 1) ? BESTEL : AUTO, kleur: (zn & 1) ? 18 : Math.floor(hash(thuis.id, 24) * 8), vracht: 0, thuis, benen: [], rit: 'zakelijk', van: w.p, doel: ritjes.map(([p]) => p) });
      const [a, b] = ZA.venster, stap = (b - a) / ritjes.length;
      ritjes.forEach(([, pl], k) => {
        const t0 = a + stap * (k + 0.1 + 0.5 * hash(thuis.id, k, 25));
        v.benen.push(been(pl, { vertrek: t0, uiterst: t0 + 15, verblijf: lijn(ZA.verblijf, thuis.id, 26 + k), ronde: 2 }));
        v.benen.push(been(thuis, {}));
      });
      zn++;
    }
    void wn;
  }
  return { voertuigen: voertuigen.filter((v) => v.benen.length), R };
}

// Een duur uit [a, b], vast per zaad.
function lijn([a, b], x, y) { return a + (b - a) * hash(x, y, 97); }
function tekstHash(s) { let h = 0; for (let i = 0; i < (s?.length ?? 0); i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }

// ---------- 2. dagpad ----------

// Werkgeheugen voor het pad van één voertuig.
class Pad {
  constructor() { this.leeg(); }
  leeg() {
    this.x = []; this.y = []; this.c = []; this.k = []; this.g = []; this.f = []; this.v = []; this.a = []; this.z = [];
    this.conf = []; this.stops = []; this.benen = [];
  }
  get n() { return this.x.length; }
  get s() { return this.n ? this.c[this.n - 1] : 0; }
  // Punt toevoegen; het stuk dat hier begint krijgt sleutel, σ en vlag van het lopende stuk.
  punt(x, y, v, a = 1) {
    const n = this.n;
    if (n) {
      const d = Math.hypot(x - this.x[n - 1], y - this.y[n - 1]);
      if (d < 1e-4) { this.v[n - 1] = Math.min(this.v[n - 1], v); this.a[n - 1] = a; return; }
      this.x.push(x); this.y.push(y); this.c.push(this.c[n - 1] + d);
      this.k.push(this.k[n - 1]); this.g.push(this.g[n - 1] + d); this.f.push(this.f[n - 1]);
      this.v.push(v); this.a.push(a); this.z.push(0);
      return;
    }
    this.x.push(x); this.y.push(y); this.c.push(0); this.k.push(-1); this.g.push(0); this.f.push(0); this.v.push(v); this.a.push(a); this.z.push(0);
  }
  // Het volgende stuk: sleutel (rijstrook of -1), σ op de strook bij het laatste punt, vlaggen.
  stuk(k, sig, f) { const n = this.n - 1; if (n < 0) return; this.k[n] = k; this.g[n] = sig; this.f[n] = f; }
  stil() { const n = this.n - 1; if (n >= 0) this.z[n] = 1; }
}

// De meetkunde van het net voor de paden.
class Meet {
  constructor(net, geo) {
    this.net = net; this.T = geo.T; this.o = {}; this.o2 = {}; this.routes = new Map(); this.zoekGeheugen = new Map(); this.breed = false; this.hb = 0;
    const n = net.nK;
    this.straat = new Uint8Array(n);       // aantal straatarmen
    this.opritten = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      for (let j = net.adj0[k]; j < net.adj0[k + 1]; j++) {
        const g = net.adj[j], i = g >= 0 ? g : ~g;
        if (net.tKlasse[i] === KLASSE.OPRIT) this.opritten[k]++; else this.straat[k]++;
      }
    }
    this.zebraOp = new Map();
    for (let z = 0; z < net.zebras.length; z++) this.zebraOp.set(net.zebras[z].knoop * 65536 + net.zebras[z].tak, z);
    this.overweg = [];
    // scherpe bochten midden in een tak (zie bochten): een eigen knoopnummer vanaf net.nK
    this.nBocht = 0; this.bochtVan = new Map();
    // per rijstrook de stukken (σ van, σ tot) langs een parkeerstrook
    this.strookOp = new Map();
    for (const S of net.parkeerstroken) {
      const g = S.kant > 0 ? S.tak : ~S.tak, L = net.tLen[S.tak], k = sleutelVan(g);
      (this.strookOp.get(k) ?? this.strookOp.set(k, []).get(k)).push(S.kant > 0 ? [S.s0, S.s1] : [L - S.s1, L - S.s0]);
    }
    // per knoop de straatarmen: naar de knoop toe (in) en eruit (uit), als sleutels van rijstroken
    this.in = []; this.uit = [];
    for (let k = 0; k < n; k++) {
      const a = [], b = [];
      for (let j = net.adj0[k]; j < net.adj0[k + 1]; j++) { const g = net.adj[j], i = g >= 0 ? g : ~g; if (net.tKlasse[i] === KLASSE.OPRIT) continue; b.push(sleutelVan(g)); a.push(sleutelVan(~g)); }
      this.in.push(a); this.uit.push(b);
    }
  }
  // Hoe ver voor het eind van gerichte tak g de neus moet kunnen stoppen (T): de stopplek van de knoop daar.
  stopAan(g) {
    const K = this.eind(g), s = this.soort(K);
    if (this.straat[K] <= 1) return HOLD_POORT;              // doodlopend: daar wordt gekeerd
    return s === C_LICHT ? HOLD_LICHT : s === C_KRUIS ? HOLD_KRUIS : s === C_DOOR ? HOLD_DOOR : 0;
  }
  // net.route met geheugen (dezelfde vraag komt vaak terug: eerst bij het plannen, dan bij het pad)
  route(a, b) {
    if (a === b) return LEEG_PAD;
    const k = a * this.net.nK + b;
    let r = this.routes.get(k);
    if (!r) { r = Array.from(this.net.route(a, b)); this.routes.set(k, r); }
    return r;
  }
  padLen(r) { let s = 0; for (let i = 0; i < r.length; i++) s += this.len(r[i]) / SNEL[Math.min(3, this.kl(r[i]))]; return s; }
  // De takken van knoop a naar knoop b (gNaar = null) of naar strook gNaar en die strook op, zonder te keren: nooit
  // meteen terug over de tak waar je vandaan komt (gVan, of een tak onderweg), behalve op een doodlopend eind. Een
  // eigen kortste-tijd-zoektocht over gerichte takken (net.route kent geen keerverbod); bij gelijke tijd wint de
  // laagste tak. null = onbereikbaar. uit.keer zegt of er op een doodlopend eind gekeerd wordt.
  zoek(gVan, a, gNaar, b, uit = null, lang = 0) {
    const sleutel = `${gVan ?? 'x'}|${a}|${gNaar ?? 'x'}|${b}|${lang}`;
    let r = this.zoekGeheugen.get(sleutel);
    if (r === undefined) { r = this.zoekNu(gVan, a, gNaar, b, lang); this.zoekGeheugen.set(sleutel, r); }
    if (uit) { uit.keer = r ? r.keer : 0; uit.tijd = r ? r.tijd : Infinity; }
    return r ? r.pad : null;
  }
  zoekNu(gVan, a, gNaar, b, lang) {
    const net = this.net, Z = this.Z ??= { d: new Float64Array(net.nT * 2), vorig: new Int32Array(net.nT * 2), merk: new Int32Array(net.nT * 2), gen: 0, hk: [], hd: [] };
    const gen = ++Z.gen, d = Z.d, vorig = Z.vorig, merk = Z.merk, hk = Z.hk, hd = Z.hd;
    hk.length = 0; hd.length = 0;
    const KEER = lang ? 90 : 6;                                // straftijd voor keren op een doodlopend eind (s); een bus rijdt liever om
    const duw = (k, kost, van) => {
      if (merk[k] === gen && d[k] <= kost) return;
      merk[k] = gen; d[k] = kost; vorig[k] = van;
      let i = hk.length; hk.push(k); hd.push(kost);
      while (i > 0) { const o = (i - 1) >> 1; if (hd[o] < kost || (hd[o] === kost && hk[o] < k)) break; hk[i] = hk[o]; hd[i] = hd[o]; i = o; }
      hk[i] = k; hd[i] = kost;
    };
    const trek = () => {
      const k = hk[0], n = hk.length - 1, lk = hk[n], ld = hd[n];
      hk.length = n; hd.length = n;
      if (n > 0) {
        let i = 0;
        for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && (hd[c + 1] < hd[c] || (hd[c + 1] === hd[c] && hk[c + 1] < hk[c]))) c++; if (ld < hd[c] || (ld === hd[c] && lk < hk[c])) break; hk[i] = hk[c]; hd[i] = hd[c]; i = c; }
        hk[i] = lk; hd[i] = ld;
      }
      return k;
    };
    // rijtijd over de strook plus de verwachte wachttijd op de knoop aan het eind (licht, kruising)
    const tijd = (k) => { const e = this.soort(this.eindK(k)); return net.tLen[k >> 1] / (SNEL[Math.min(3, net.tKlasse[k >> 1])] * this.T) + (e === C_LICHT ? WACHT_LICHT : e === C_KRUIS ? WACHT_KRUIS : 0); };
    const kNaar = gNaar != null ? sleutelVan(gNaar) : -1, kVan = gVan != null ? sleutelVan(gVan) : -1;
    // vanaf knoop K, aangekomen over strook kIn (of -1): alle stroken eruit, zonder te keren als het anders kan
    const verder = (K, kIn, kost, begin = false) => {
      const U = this.uit[K], terug = kIn >= 0 ? kIn ^ 1 : -1;
      let n = 0;
      for (let i = 0; i < U.length; i++) if (U[i] !== terug) { duw(U[i], kost + tijd(U[i]), begin ? -2 : kIn); n++; }
      if (!n && terug >= 0 && U.length) duw(terug, kost + tijd(terug) + KEER, begin ? -2 : kIn);
    };
    verder(a, kVan, 0, true);
    let eind = -1;
    while (hk.length) {
      const kost = hd[0], k = trek();
      if (d[k] < kost) continue;
      if (kNaar >= 0 ? k === kNaar : this.eindK(k) === b) { eind = k; break; }
      verder(this.eindK(k), k, kost);
    }
    if (eind < 0) return null;
    const pad = [];
    let keer = 0;
    for (let k = eind; ; k = vorig[k]) {
      pad.push(k & 1 ? ~(k >> 1) : k >> 1);
      const vg = vorig[k] === -2 ? kVan : vorig[k];
      if (vg >= 0 && vg === (k ^ 1)) keer = 1;
      if (vorig[k] === -2) break;
      if (pad.length > 4000) return null;
    }
    pad.reverse();
    return { pad, keer, tijd: d[eind] };
  }
  eindK(k) { const i = k >> 1; return k & 1 ? this.net.tA[i] : this.net.tB[i]; }
  len(g) { return this.net.tLen[g >= 0 ? g : ~g]; }
  kl(g) { return this.net.tKlasse[g >= 0 ? g : ~g]; }
  baan(g) { const k = this.kl(g); return (k === KLASSE.ERF ? this.erfBaan() : PROFIEL[k].baan) * this.T; }
  erfBaan() { return Math.max(ERF_BAAN, 0.96 * this.hb); }
  // Op een erf (één strook voor beide richtingen) gaat een voertuig tussen de knopen zo ver uit de as als het half
  // breed is (this.hb, gezet door bouwPad): twee tegenliggers passeren dan langs elkaar, de brede met de wielen in de
  // berm. Bij de knopen terug naar de rijlijn, zodat de bochten en opritten passen. 0 tot 1:
  erf(g, s) {
    if (this.kl(g) !== KLASSE.ERF || 0.96 * this.hb <= this.erfBaan()) return 0;
    const L = this.len(g), r0 = ERF_EIND * this.T, r = ERF_AAN * this.T, glad = (t) => t * t * (3 - 2 * t);
    return glad(clamp((s - r0) / r, 0, 1)) * glad(clamp((L - s - r0) / r, 0, 1));
  }
  begin(g) { const i = g >= 0 ? g : ~g; return g >= 0 ? this.net.tA[i] : this.net.tB[i]; }
  eind(g) { const i = g >= 0 ? g : ~g; return g >= 0 ? this.net.tB[i] : this.net.tA[i]; }
  // Punt op de rijlijn van gerichte tak g op σ, met richting.
  lijn(g, s, uit) {
    const net = this.net, L = this.len(g), e = Math.min(0.02 * this.T, L / 4);
    const a = net.punt(g, clamp(s - e, 0, L), this.o), ax = a.x, ay = a.y;
    const b = net.punt(g, clamp(s + e, 0, L), this.o2);
    let hx = b.x - ax, hy = b.y - ay; const hl = Math.hypot(hx, hy) || 1; hx /= hl; hy /= hl;
    net.punt(g, clamp(s, 0, L), this.o);
    // een breed voertuig (this.breed, gezet door bouwPad) schuift langs een parkeerstrook naar de as
    const off = this.baan(g) - (this.breed ? WIJK * this.T * this.wijk(g, s) : 0) + (this.hb ? (0.96 * this.hb - this.erfBaan()) * this.T * this.erf(g, s) : 0);
    uit.x = this.o.x - hy * off; uit.y = this.o.y + hx * off; uit.hx = hx; uit.hy = hy;
    return uit;
  }
  // Monsters van σa tot σb op de rijlijn van g: de hoekpunten van de tak en de randen.
  monsters(g, sa, sb) {
    const net = this.net, i = g >= 0 ? g : ~g, L = net.tLen[i], p0 = net.tP0[i], np = net.tNP[i];
    const uit = [sa];
    for (let j = 1; j + 1 < np; j++) {
      const s = g >= 0 ? net.cum[p0 + j] : L - net.cum[p0 + np - 1 - j];
      if (s > sa + 1e-3 && s < sb - 1e-3) uit.push(s);
    }
    if (net.tBouw[i] === 3) for (const s of [0.1 * this.T, L - 0.1 * this.T]) if (s > sa && s < sb) uit.push(s);
    uit.push(sb);
    return uit.sort((a, b) => a - b);
  }
  // Hoe ver een breed voertuig op σ van strook g naar de as opschuift (0 tot 1 maal WIJK), langs de parkeerstroken.
  wijk(g, s) {
    const L = this.strookOp.get(sleutelVan(g));
    if (!L) return 0;
    const r = WIJK_AAN * this.T, r0 = WIJK_EIND * this.T, len = this.len(g);
    const glad = (t) => t * t * (3 - 2 * t);
    let w = 0;
    for (const [a, b] of L) {
      const d = s < a - r ? a - r - s : s > b + r ? s - b - r : 0;
      const t = glad(clamp(1 - d / r, 0, 1));
      if (t > w) w = t;
    }
    // op de knopen terug op de rijlijn, zodat de bochten en de volgende tak aansluiten
    return w * glad(clamp(s / r0, 0, 1)) * glad(clamp((len - s) / r0, 0, 1));
  }
  // De scherpe bochten midden in tak i (σ vooruit langs de tak): waar de as over 0,24 T meer dan BOCHT_SCHERP draait.
  // Daar steekt de neus van wie de binnenbocht neemt in de andere rijbaan; het verkeer gaat er om beurten door
  // (een kruisvlak met één arm per richting, zie bouwPad). Hoekpunten vlak bij elkaar tellen als één bocht.
  bochten(i) {
    let L = this.bochtVan.get(i);
    if (L) return L;
    L = [];
    const net = this.net, T = this.T, p0 = net.tP0[i], np = net.tNP[i], len = net.tLen[i], a = {}, b = {};
    for (let j = 1; j + 1 < np; j++) {
      const s = net.cum[p0 + j];
      if (s < BOCHT_RAND * T || s > len - BOCHT_RAND * T) continue;
      net.punt(i, Math.max(0, s - 0.12 * T), a); const ax = a.x, ay = a.y;
      net.punt(i, s, b); const mx = b.x, my = b.y;
      net.punt(i, Math.min(len, s + 0.12 * T), a);
      let h1x = mx - ax, h1y = my - ay, h2x = a.x - mx, h2y = a.y - my;
      const l1 = Math.hypot(h1x, h1y) || 1, l2 = Math.hypot(h2x, h2y) || 1;
      h1x /= l1; h1y /= l1; h2x /= l2; h2y /= l2;
      if (h1x * h2x + h1y * h2y > BOCHT_SCHERP) continue;
      const vorige = L[L.length - 1];
      if (vorige && s - vorige.s1 < 0.25 * T) { vorige.s1 = s; continue; }
      L.push({ s0: s, s1: s, id: net.nK + this.nBocht++ });
    }
    this.bochtVan.set(i, L);
    return L;
  }
  tunnel(g, s) { const i = g >= 0 ? g : ~g; if (this.net.tBouw[i] !== 3) return 1; const L = this.net.tLen[i]; return 1 - clamp(Math.min(s, L - s) / (0.1 * this.T), 0, 1); }
  // Soort knoop voor het verkeer: licht, kruising (drie of meer straatarmen), poort (een oprit), of niets.
  soort(k) {
    if (this.net.kLicht[k] >= 0) return C_LICHT;
    if (this.straat[k] >= 3) return C_KRUIS;
    if (this.opritten[k] > 0) return C_DOOR;
    return -1;
  }
}

// Kwadratische bézier van a via c naar b, in m stappen (zonder het beginpunt).
function bezier(P, ax, ay, cx, cy, bx, by, m, v) {
  for (let i = 1; i <= m; i++) {
    const t = i / m, u = 1 - t;
    P.punt(u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by, v);
  }
}
function kubisch(P, ax, ay, c1x, c1y, c2x, c2y, bx, by, m, v) {
  for (let i = 1; i <= m; i++) {
    const t = i / m, u = 1 - t;
    P.punt(u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx, u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by, v);
  }
}
// Snijpunt van de lijnen p + t·h en q + w·k: t, of NaN als ze (bijna) evenwijdig zijn.
function snij(px, py, hx, hy, qx, qy, kx, ky) {
  const d = hx * ky - hy * kx;
  if (Math.abs(d) < 0.08) return NaN;
  return ((qx - px) * ky - (qy - py) * kx) / d;
}

// Het pad van één voertuig voor de hele dag. Geeft false als een been niet te rijden is.
function bouwPad(M, P, voertuig, rust, geo) {
  const net = M.net, T = M.T, L2 = MAAT[voertuig.soort][0] * T, o = {}, o2 = {};
  const vf = voertuig.soort === AUTO || voertuig.soort === TAXI ? 1 : voertuig.soort === POLITIE || voertuig.soort === AMBU ? 1.15 : voertuig.soort === STROOI || voertuig.soort === VUIL ? 0.6 : 0.85;
  const vk = (k) => (k === KLASSE.OPRIT ? SNEL[4] : SNEL[k]) * vf * T;
  const breed = MAAT[voertuig.soort][1] >= BREED;
  P.leeg();
  M.breed = false; M.hb = 0;
  // rustpunt: plek en richting, en de oprit-as
  const poortAs = (p) => {
    const q = net.poorten[p], K = q.knoop, D = q.dock;
    const kx = net.kx[K], ky = net.ky[K];
    let ex = net.kx[D] - kx, ey = net.ky[D] - ky; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    return { K, kx, ky, ex, ey, len: el };
  };
  const rustPose = (r) => {
    if (r.soort === R_DOCK) { const A = poortAs(r.p), d = OPRIT * T - L2 - 0.012 * T; return { x: A.kx + A.ex * d, y: A.ky + A.ey * d, hx: A.ex, hy: A.ey }; }
    if (r.soort === R_PLEK) { const q = plekPlaats(net, r.p, r.j, T); return { x: q.x, y: q.y, hx: Math.cos(q.hoek), hy: Math.sin(q.hoek) }; }
    const S = net.parkeerstroken[r.k], g = S.kant > 0 ? S.tak : ~S.tak, sig = strookSig(S, r.j);
    M.lijn(g, sig, o);
    const off = (PROFIEL[M.kl(g)].asfalt / 2 + STROOK_UIT) * T - M.baan(g);
    return { x: o.x - o.hy * off, y: o.y + o.hx * off, hx: o.hx, hy: o.hy, g, sig, off };
  };
  const strookSig = (S, j) => { const s = S.s0 + ((j + 0.5) * (S.s1 - S.s0)) / S.plekken; return S.kant > 0 ? s : net.tLen[S.tak] - s; };

  // lane-stuk van g van σa tot σb
  const rijstrook = (g, sa, sb) => {
    if (sb <= sa + 1e-4) return;
    const v = vk(M.kl(g)), ss = M.monsters(g, sa, sb);
    // breed voertuig langs een parkeerstrook: iets naar de as, met een paar extra monsters voor het in- en uitschuiven
    const sch = breed ? M.strookOp.get(sleutelVan(g)) : null;
    if (sch) {
      const r = WIJK_AAN * T, r0 = WIJK_EIND * T, L = M.len(g);
      for (const [a, b] of sch) for (const q of [a - 2 * r, a - 1.5 * r, a - r, b + r, b + 1.5 * r, b + 2 * r]) if (q > sa + 1e-3 && q < sb - 1e-3) ss.push(q);
      for (const q of [r0 / 2, r0, L - r0, L - r0 / 2]) if (q > sa + 1e-3 && q < sb - 1e-3) ss.push(q);
      ss.sort((x, y) => x - y);
    }
    // op een erf: monsters voor het opzij gaan na en voor de knopen
    if (M.erf(g, M.len(g) / 2) > 0) {
      const r0 = ERF_EIND * T, r = ERF_AAN * T, L = M.len(g);
      for (const q of [r0, r0 + r / 3, r0 + (2 * r) / 3, r0 + r, L - r0 - r, L - r0 - (2 * r) / 3, L - r0 - r / 3, L - r0]) if (q > sa + 1e-3 && q < sb - 1e-3) ss.push(q);
      ss.sort((x, y) => x - y);
    }
    M.lijn(g, ss[0], o); P.punt(o.x, o.y, v, M.tunnel(g, ss[0]));
    P.stuk(sleutelVan(g), sa, 0);
    for (let i = 1; i < ss.length; i++) { M.lijn(g, ss[i], o); P.punt(o.x, o.y, v, M.tunnel(g, ss[i])); }
    // grensovergangen en overwegen op dit stuk
    const i = g >= 0 ? g : ~g, len = net.tLen[i], sEind = P.s;
    const sVan = (sig) => sEind - (sb - sig);
    for (let gi = 0; gi < net.grensovergangen.length; gi++) {
      const G = net.grensovergangen[gi];
      if (G.tak !== i) continue;
      const sg = g >= 0 ? G.s : len - G.s;
      const stop = sg - 0.07 * T - L2;
      if (stop < sa || stop > sb) continue;
      P.stops.push({ s: sVan(stop), duur: lijn(RITREGELS.export.douane, gi, P.stops.length + voertuig.nr * 7), soort: 1, gi, sPas: sVan(Math.min(sb, sg + 0.1 * T + L2)) });
    }
    // scherpe bochten: om beurten (één richting tegelijk; achter elkaar aan in dezelfde richting mag)
    for (const B of M.bochten(i)) {
      const b0 = g >= 0 ? B.s0 : len - B.s1, b1 = g >= 0 ? B.s1 : len - B.s0;
      if (b1 < sa || b0 > sb) continue;
      M.lijn(g, Math.max(0, b0 - 0.12 * T), o2);
      P.conf.push({ soort: C_KRUIS, knoop: B.id, sHold: sVan(Math.max(sa, b0 - L2 - BOCHT_VRIJ * T)), sRel: sVan(Math.min(sb, b1 + L2 + BOCHT_VRIJ * T)), arm: -1, zebra: -1, uitKey: -1, uitVan: 0, uitStop: 0, draai: 0, inKey: sleutelVan(g), banen: null, strikt: 0,
        vak: g >= 0 ? 0 : 1, links: 0, hx: o2.hx, hy: o2.hy });
    }
    for (const ov of M.overweg) {
      if (ov.tak !== i) continue;
      const so = g >= 0 ? ov.s : len - ov.s, h = so - 0.1 * T - L2;
      if (h < sa || h > sb) continue;
      P.conf.push({ soort: C_OVERWEG, knoop: -1, sHold: sVan(h), sRel: sVan(Math.min(sb, so + 0.1 * T + L2)), ov, arm: -1, zebra: -1, uitKey: -1, uitVan: 0, uitStop: 0, inKey: -1, banen: null, strikt: 0 });
    }
  };
  // Bocht op knoop K van g1 naar g2 (lanes, met snede); geeft de σ op g2 waar het volgende rijstrookstuk begint.
  const bochtOp = (K, g1, g2, snede) => {
    const r1 = Math.min(snede, M.len(g1) * 0.3), r2 = Math.min(snede, M.len(g2) * 0.3);
    M.lijn(g1, M.len(g1) - r1, o); const ax = o.x, ay = o.y, h1x = o.hx, h1y = o.hy;
    M.lijn(g2, r2, o2); const bx = o2.x, by = o2.y, h2x = o2.hx, h2y = o2.hy;
    const dot = h1x * h2x + h1y * h2y, kr = h1x * h2y - h1y * h2x;
    const draai = dot < 0.87;
    const v = draai ? Math.min(BOCHT * T * vf, vk(M.kl(g2))) : Math.min(vk(M.kl(g1)), vk(M.kl(g2)));
    P.punt(ax, ay, v);
    const s0 = P.s;
    // σ van de bocht: op g2, eindigend op r2
    const tmp = P.n;
    if (dot < -0.9) {
      // keren: een halve cirkel over het asfalt
      const k = Math.max(0.06 * T, Math.hypot(bx - ax, by - ay) * 0.8);
      kubisch(P, ax, ay, ax + h1x * k, ay + h1y * k, bx - h2x * k, by - h2y * k, bx, by, 10, v);
    } else if (!draai || Math.abs(kr) < 0.08) {
      P.punt(bx, by, v);
    } else {
      const t = snij(ax, ay, h1x, h1y, bx, by, h2x, h2y);
      if (Number.isFinite(t) && t > 0) bezier(P, ax, ay, ax + h1x * t, ay + h1y * t, bx, by, 8, v);
      else kubisch(P, ax, ay, ax + h1x * 0.05 * T, ay + h1y * 0.05 * T, bx - h2x * 0.05 * T, by - h2y * 0.05 * T, bx, by, 8, v);
    }
    const lb = P.s - s0;
    // het bochtstuk hoort bij de strook van g2, met σ van r2 − lb tot r2
    const fl = draai ? (kr < 0 ? F_KNIP | F_LINKS : F_KNIP) : 0;
    if (tmp > 0) { P.k[tmp - 1] = sleutelVan(g2); P.g[tmp - 1] = r2 - lb; P.f[tmp - 1] = fl; for (let j = tmp; j < P.n; j++) { P.k[j] = sleutelVan(g2); P.g[j] = r2 - lb + (P.c[j] - s0); P.f[j] = fl; } }
    return { r2, draai, s0, sEind: P.s, links: draai && kr < -0.3 ? 1 : 0, h1x, h1y };
  };
  // conflict op een overgang tussen g1 en g2 op knoop K; sEindIn = s waar de strook van g1 eindigt (σ = len − r1)
  const overgang = (K, g1, g2, r1, sEindIn, b) => {
    const soort = M.soort(K), keer = b.dot < -0.9;
    if (soort < 0 && !keer) return;
    const s = soort < 0 || (soort === C_DOOR && keer) ? C_MAN : soort;
    const hold = s === C_LICHT ? HOLD_LICHT : s === C_KRUIS ? HOLD_KRUIS : s === C_DOOR ? HOLD_DOOR : HOLD_POORT;
    const vrij = s === C_DOOR ? MOND : s === C_MAN ? VRIJ_POORT : VRIJ_KRUIS;
    const c = { soort: s, knoop: K, sHold: sEindIn - (hold * T - r1) - L2, sRel: b.sEind + (vrij * T - b.r2) + L2, arm: -1, zebra: -1, uitKey: -1, uitVan: 0, uitStop: 0, draai: b.draai, inKey: sleutelVan(g1), banen: null, strikt: 0,
      // (een lange wagen die afslaat, zwaait met zijn achterkant over de andere helft: die heeft het vlak dan voor zich alleen)
      vak: Math.min(3, Math.max(0, M.in[K].indexOf(sleutelVan(g1)))), links: b.links || keer || (b.draai && L2 > 0.075 * T) ? 1 : 0, hx: b.h1x, hy: b.h1y };
    if (s === C_LICHT) {
      c.arm = net.armVan(K, g1);
      if (b.draai) c.zebra = M.zebraOp.get(K * 65536 + (g2 >= 0 ? g2 : ~g2)) ?? -1;
    }
    // er moet ruimte zijn op de strook erna (ook voor wie keert: anders blijft hij dwars op de weg staan)
    if (s === C_LICHT || s === C_KRUIS || s === C_MAN) { c.uitKey = sleutelVan(g2); c.uitVan = vrij * T; c.uitStop = M.stopAan(g2) * T; }
    P.conf.push(c);
  };
  // De rijstroken langs poortknoop K die een manoeuvre raakt, als paren (strook naar K toe, strook van K af): voor
  // wie de straat op g1 op rijdt (uit = true) of van gn af de oprit in draait. Ligt de oprit rechts van de
  // rijrichting, dan is dat alleen de eigen strook (bij inrijden: geen); ligt hij links, dan ook de tegenrichting.
  // null bij een kruising of een doodlopend eind: dan telt het hele vlak (zie zoneVrij).
  const banenBij = (A, g, uit) => {
    if (M.straat[A.K] !== 2 || M.soort(A.K) !== C_DOOR) return null;
    // de andere straatarm van K (weg van K)
    let ander = null;
    const U = M.uit[A.K];
    for (let i = 0; i < U.length; i++) { const h = U[i] & 1 ? ~(U[i] >> 1) : U[i] >> 1; if (h !== (uit ? g : ~g)) ander = h; }
    if (ander == null) return null;
    M.lijn(g, uit ? 0 : M.len(g), o2);
    // (op een erf delen beide richtingen één strook, en een vrachtwagen zwaait in de krappe bocht over de middenlijn:
    // dan zit de tegenrichting ook rechtsaf in de weg)
    const rechts = A.ex * -o2.hy + A.ey * o2.hx > 0 && M.kl(g) !== KLASSE.ERF && L2 < 0.075 * T;
    if (uit) {
      // eigen richting: komt aan over ~ander, rijdt weg over g; tegenrichting: komt aan over ~g, rijdt weg over ander
      const eigen = [sleutelVan(~ander), sleutelVan(g)];
      return rechts ? eigen : [...eigen, sleutelVan(~g), sleutelVan(ander)];
    }
    // inrijden vanaf g (komt aan op K): de tegenrichting komt aan over ~ander en rijdt weg over ~g
    return rechts ? [] : [sleutelVan(~ander), sleutelVan(~g)];
  };

  // vertrek uit rustpunt r (stilstaand) naar het begin van tak g1; geeft de σ op g1 waar de strook begint
  const uitRust = (r, g1) => {
    const pose = rustPose(r);
    if (r.soort === R_STROOK) {
      // invoegen: zijdelings terug naar de rijlijn over 0,15 T
      // eerst een stukje recht (zo staat hij evenwijdig aan de stoep), dan zijdelings naar de rijlijn
      const g = pose.g, s0 = pose.sig + RECHT * T, dl = 0.15 * T, m = 6;
      P.stuk(sleutelVan(g), pose.sig, F_KNIP | F_LINKS);
      M.lijn(g, s0, o); P.punt(o.x - o.hy * pose.off, o.y + o.hx * pose.off, PARK * T);
      for (let i = 1; i <= m; i++) {
        const t = i / m, sm = t * t * (3 - 2 * t);
        M.lijn(g, s0 + dl * t, o);
        const off = pose.off * (1 - sm);
        P.punt(o.x - o.hy * off, o.y + o.hx * off, PARK * T);
      }
      return { g, sig: s0 + dl };
    }
    const A = poortAs(r.p);
    // rijlijn van g1 bij de knoop
    M.lijn(g1, 0, o); const lx = o.x, ly = o.y, hx = o.hx, hy = o.hy;
    const rand = (PROFIEL[M.kl(g1)].asfalt / 2) * T;
    const s0 = P.s;
    if (r.soort === R_DOCK) {
      // achteruit de oprit uit, met een boog de rijbaan op (de neus wijst dan in de rijrichting), dan vooruit
      const tq = snij(A.kx, A.ky, A.ex, A.ey, lx, ly, hx, hy);
      const cx = Number.isFinite(tq) ? A.kx + A.ex * tq : lx, cy = Number.isFinite(tq) ? A.ky + A.ey * tq : ly;
      const dood = M.straat[A.K] <= 1;
      const rho = (dood ? 0.045 : 0.055) * T;
      // wachten tot de straat vrij is met de achterkant nog op de oprit
      const q = Math.min(OPRIT * T - L2 - 0.012 * T, Math.max(rand + L2 + 0.005 * T, (Number.isFinite(tq) ? tq : 0) + 0.09 * T));
      // het vlak voor de poort is van hem vanaf het dock tot hij op de rijbaan rijdt (zie de dienstregeling)
      const sHold = s0;
      P.stuk(-1, 0, F_ACHTER);
      P.punt(A.kx + A.ex * q, A.ky + A.ey * q, ACHTER * T);
      P.stuk(-1, 0, F_ACHTER);
      bezier(P, A.kx + A.ex * q, A.ky + A.ey * q, cx, cy, cx - hx * rho, cy - hy * rho, 8, ACHTER * T);
      P.stil();
      P.stuk(sleutelVan(g1), -rho, 0);
      P.punt(lx, ly, vk(M.kl(g1)) * 0.6);
      const sig = 0.001 * T;
      P.conf.push({ soort: C_MAN, knoop: A.K, sHold, sRel: P.s + MOND * T + L2, arm: -1, zebra: -1, uitKey: sleutelVan(g1), uitVan: MOND * T, uitStop: M.stopAan(g1) * T, inKey: -1, banen: banenBij(A, g1, true), strikt: 1 });
      return { g: g1, sig };
    }
    // plek: achteruit naar de oprit-as (dieper de kavel in), dan vooruit de oprit uit en de bocht de straat op
    // (niet dieper dan net voorbij het dock: daar begint de kavel)
    const along = (pose.x - A.kx) * A.ex + (pose.y - A.ky) * A.ey, diep = Math.min(along + 0.06 * T, A.len + 0.015 * T), mid = diep - 0.06 * T;
    const ax = A.kx + A.ex * mid, ay = A.ky + A.ey * mid, dx = A.kx + A.ex * diep, dy = A.ky + A.ey * diep;
    P.stuk(-1, 0, F_ACHTER);
    bezier(P, pose.x, pose.y, ax, ay, dx, dy, 6, PARK * T);
    P.stil();
    P.stuk(-1, 0, 0);
    const m = Math.max(rand, 0.06 * T);
    const sHold = s0;
    P.punt(A.kx + A.ex * m, A.ky + A.ey * m, PARK * T);
    // bocht naar de rijlijn van g1 op σ = SNEDE
    const r2 = Math.min(SNEDE * T, M.len(g1) * 0.3);
    M.lijn(g1, r2, o);
    const mx = A.kx + A.ex * m, my = A.ky + A.ey * m;
    const t = snij(mx, my, -A.ex, -A.ey, o.x, o.y, o.hx, o.hy);
    const sb = P.s, nb = P.n;
    if (Number.isFinite(t) && t > 0) bezier(P, mx, my, mx - A.ex * t, my - A.ey * t, o.x, o.y, 7, BOCHT * T * vf);
    else kubisch(P, mx, my, mx - A.ex * 0.05 * T, my - A.ey * 0.05 * T, o.x - o.hx * 0.05 * T, o.y - o.hy * 0.05 * T, o.x, o.y, 7, BOCHT * T * vf);
    const lb = P.s - sb;
    P.k[nb - 1] = sleutelVan(g1); P.f[nb - 1] = F_KNIP; P.g[nb - 1] = r2 - lb;
    for (let i = nb; i < P.n; i++) { P.k[i] = sleutelVan(g1); P.f[i] = F_KNIP; P.g[i] = r2 - lb + (P.c[i] - sb); }
    P.conf.push({ soort: C_MAN, knoop: A.K, sHold, sRel: P.s + Math.max(0, MOND * T - r2) + L2, arm: -1, zebra: -1, uitKey: sleutelVan(g1), uitVan: Math.max(r2, MOND * T), uitStop: M.stopAan(g1) * T, inKey: -1, banen: banenBij(A, g1, true), strikt: 0, plek: r.p });
    return { g: g1, sig: r2 };
  };
  // aankomst in rustpunt r vanaf de rijlijn van gn, die eindigt op knoop K; de strook loopt tot σ = sig0
  const inRust = (r, gn, sig) => {
    const pose = rustPose(r);
    if (r.soort === R_STROOK) {
      const dl = 0.15 * T, s1 = pose.sig - dl - RECHT * T;
      rijstrook(gn, sig, s1);
      const m = 6;
      for (let i = 1; i <= m; i++) {
        const t = i / m, sm = t * t * (3 - 2 * t);
        M.lijn(gn, s1 + dl * t, o);
        const off = pose.off * sm;
        P.punt(o.x - o.hy * off, o.y + o.hx * off, PARK * T);
      }
      M.lijn(gn, pose.sig, o); P.punt(o.x - o.hy * pose.off, o.y + o.hx * pose.off, PARK * T);
      // het laatste stuk rijlijn kreeg de sleutel van gn; de inparkeerbocht ook (wie erachter rijdt, remt mee)
      P.stil();
      return;
    }
    const A = poortAs(r.p);
    const r1 = Math.min(SNEDE * T, M.len(gn) * 0.3);
    const L = M.len(gn);
    rijstrook(gn, sig, L - r1);
    const sEindIn = P.s;
    M.lijn(gn, L - r1, o);
    const rand = (PROFIEL[M.kl(gn)].asfalt / 2) * T, m = Math.max(rand, 0.06 * T);
    const mx = A.kx + A.ex * m, my = A.ky + A.ey * m;
    const t = snij(o.x, o.y, o.hx, o.hy, mx, my, A.ex, A.ey);
    P.stuk(-1, 0, F_KNIP);
    if (Number.isFinite(t) && t > 0) bezier(P, o.x, o.y, o.x + o.hx * t, o.y + o.hy * t, mx, my, 7, BOCHT * T * vf);
    else kubisch(P, o.x, o.y, o.x + o.hx * 0.05 * T, o.y + o.hy * 0.05 * T, mx - A.ex * 0.05 * T, my - A.ey * 0.05 * T, mx, my, 7, BOCHT * T * vf);
    P.stuk(-1, 0, 0);
    const vo = vk(KLASSE.OPRIT);
    if (r.soort === R_DOCK) {
      P.punt(pose.x, pose.y, vo);
      P.conf.push({ soort: C_MAN, knoop: A.K, sHold: sEindIn - (HOLD_IN * T - r1) - L2, sRel: P.s - Math.max(0, (OPRIT * T - L2 - 0.012 * T) - (m + L2 + 0.02 * T)), arm: -1, zebra: -1, uitKey: -1, uitVan: 0, uitStop: 0, inKey: -1, banen: banenBij(A, gn, false), strikt: 0 });
    } else {
      const along = (pose.x - A.kx) * A.ex + (pose.y - A.ky) * A.ey;
      const a0 = Math.max(m, along - 0.06 * T);
      P.punt(A.kx + A.ex * a0, A.ky + A.ey * a0, PARK * T);
      bezier(P, A.kx + A.ex * a0, A.ky + A.ey * a0, A.kx + A.ex * along, A.ky + A.ey * along, pose.x, pose.y, 6, PARK * T);
      // wie een plek in wil en moet wachten tot het dock vrij is, wacht ver genoeg terug: wie daar staat, rijdt
      // achteruit de rijbaan op
      P.conf.push({ soort: C_MAN, knoop: A.K, sHold: sEindIn - (HOLD_POORT * T - r1) - L2, sRel: P.s - 0.001 * T, arm: -1, zebra: -1, uitKey: -1, uitVan: 0, uitStop: 0, inKey: -1, banen: banenBij(A, gn, false), strikt: 0, plek: r.p });
    }
    P.stil();
  };
  // Van rustpunt van naar rustpunt naar, langs de tussenpunten via (haltes, parkeerstroken). Een tussenpunt waar
  // alleen met een keerbocht te komen is, wordt overgeslagen.
  const rijBeen = (van, naar, via) => {
    // doelen: tussenpunten als (g, σ, duur), dan het rustpunt
    const tussen = [];
    for (const w of via ?? []) {
      if (w.halte) { const h = w.halte, g = h.kant > 0 ? h.tak : ~h.tak; tussen.push({ g, sig: h.kant > 0 ? h.s : net.tLen[h.tak] - h.s, duur: w.duur }); }
      else if (w.strook) { const S = w.strook, g = S.kant > 0 ? S.tak : ~S.tak, sm = (S.s0 + S.s1) / 2; tussen.push({ g, sig: S.kant > 0 ? sm : net.tLen[S.tak] - sm, duur: w.duur, beide: !!w.beide }); }
    }
    const doelPose = naar.soort === R_STROOK ? rustPose(naar) : null;
    const doelKnoop = naar.soort === R_STROOK ? -1 : net.poorten[naar.p].knoop;
    const zk = {};
    let g = null, sig = 0, a = van.soort === R_STROOK ? -1 : net.poorten[van.p].knoop;
    // van (g, σ) verder over de gerichte takken in lijst (lijst[0] begint waar g eindigt)
    const rijdoor = (lijst) => {
      for (const g2 of lijst) {
        const g1 = g, K = M.eind(g1);
        if (M.begin(g2) !== K) return false;
        const s = M.soort(K), keer = g2 === ~g1;
        const snede = s === C_LICHT || s === C_KRUIS || keer ? SNEDE * T : 0;
        const r1 = Math.min(snede, M.len(g1) * 0.3);
        if (M.len(g1) - r1 < sig) return false;
        rijstrook(g1, sig, M.len(g1) - r1);
        const sEindIn = P.s;
        const b = bochtOp(K, g1, g2, snede);
        b.dot = keer ? -1 : 0;
        overgang(K, g1, g2, r1, sEindIn, b);
        g = g2; sig = b.r2;
      }
      return true;
    };
    // de weg naar strook gd (tot σ sd) of naar knoop kb: de takken, of null. Vanuit een poort is de eerste tak vrij.
    const wegNaar = (gd, sd, kb) => {
      if (gd != null && g != null && gd === g && sd > sig + 0.05 * T) { zk.keer = 0; return LEEG_PAD; }
      return M.zoek(g, g != null ? M.eind(g) : a, gd, kb, zk, L2 > 0.1 * T ? 1 : 0);
    };
    // de eerste tak de poort uit: vertrekken, en dan de rest rijden
    const start = (lijst) => {
      if (g != null) return rijdoor(lijst);
      if (!lijst.length) return false;
      ({ g, sig } = uitRust(van, lijst[0]));
      return rijdoor(lijst.slice(1));
    };
    if (van.soort === R_STROOK) ({ g, sig } = uitRust(van, rustPose(van).g));
    for (let w of tussen) {
      let r = wegNaar(w.g, w.sig, -1);
      // (wie aan beide kanten mag stoppen, zoals de vuilniswagen, neemt de rijrichting die het snelst te halen is)
      if (w.beide) {
        const keer = !r || zk.keer, tijd = r === LEEG_PAD ? 0 : zk.tijd ?? 0;
        const g2 = ~w.g, s2 = M.len(w.g) - w.sig, r2 = wegNaar(g2, s2, -1);
        if (r2 && !zk.keer && (keer || (r2 === LEEG_PAD ? 0 : zk.tijd ?? 0) < tijd)) { r = r2; w = { ...w, g: g2, sig: s2 }; }
        else if (r) r = wegNaar(w.g, w.sig, -1);
      }
      if (!r) return false;
      if (zk.keer) continue;                                   // alleen met keren te halen: deze halte overslaan
      const nP = P.n, nC = P.conf.length, nS = P.stops.length, g0 = g, s0 = sig;
      if (!start(r) || w.sig <= sig) {
        if (g0 == null) return false;
        P.x.length = P.y.length = P.c.length = P.k.length = P.g.length = P.f.length = P.v.length = P.a.length = P.z.length = nP;
        P.conf.length = nC; P.stops.length = nS; g = g0; sig = s0;
        continue;
      }
      rijstrook(g, sig, w.sig); sig = w.sig;
      if (w.duur > 0) P.stops.push({ s: P.s, duur: w.duur, soort: 0, gi: -1, sPas: P.s });
    }
    // naar het rustpunt
    if (doelPose) {
      const r = wegNaar(doelPose.g, doelPose.sig - 0.2 * T, -1);
      if (!r || !start(r)) return false;
      if (doelPose.sig - (0.15 + RECHT) * T < sig + 0.01 * T) return false;
      inRust(naar, g, sig);
      return true;
    }
    if (g == null || M.eind(g) !== doelKnoop) {
      const r = wegNaar(null, 0, doelKnoop);
      if (!r || !r.length || !start(r)) return false;
    }
    if (M.eind(g) !== doelKnoop) return false;
    if (M.len(g) - Math.min(SNEDE * T, M.len(g) * 0.3) < sig) return false;
    inRust(naar, g, sig);
    return true;
  };

  // het hele dagprogramma
  const thuis = voertuig.thuis;
  const p0 = rustPose(thuis);
  P.punt(p0.x, p0.y, 0);
  let huidig = thuis;
  for (const b of voertuig.benen) {
    const sStart = P.s, nConf = P.conf.length, nStop = P.stops.length, nPunt = P.n;
    M.breed = breed; M.hb = MAAT[voertuig.soort][1];
    const ok = rijBeen(huidig, b.naar, b.via);
    M.breed = false; M.hb = 0;
    if (!ok) {
      // been niet te rijden: terugdraaien en de hele ronde overslaan
      P.x.length = P.y.length = P.c.length = P.k.length = P.g.length = P.f.length = P.v.length = P.a.length = P.z.length = nPunt;
      P.conf.length = nConf; P.stops.length = nStop;
      return false;
    }
    P.benen.push({ sStart, sEind: P.s, naar: b.naar, vertrek: b.vertrek, uiterst: b.uiterst, verblijf: b.verblijf, lossen: b.lossen, laden: b.laden, ronde: b.ronde, nConf, nStop });
    huidig = b.naar;
  }
  if (huidig.id !== thuis.id) return false;
  // remmen voor bochten, stilstand en keerpunten: v² ≤ v_volgende² + 2·REM·afstand
  // lim[j]: snelheid op stuk j (van punt j naar j + 1); cap[j]: hooguit zo snel langs punt j (0 bij stilstand)
  const n = P.n, b2 = 2 * REM * T;
  for (let i = 0; i + 2 < n; i++) if ((P.f[i] & F_ACHTER) !== (P.f[i + 1] & F_ACHTER)) P.z[i + 1] = 1;
  P.lim = new Float64Array(Math.max(1, n - 1)); P.cap = new Float64Array(n);
  for (let j = 0; j + 1 < n; j++) P.lim[j] = P.v[j + 1];
  for (let j = 0; j < n; j++) P.cap[j] = P.z[j] || j === 0 || j === n - 1 ? 0 : Math.min(P.lim[j - 1], P.lim[j]);
  for (let j = n - 2; j >= 0; j--) { const m = Math.sqrt(P.cap[j + 1] * P.cap[j + 1] + b2 * (P.c[j + 1] - P.c[j])); if (P.cap[j] > m) P.cap[j] = m; }
  // Het spoor van een overweg overgestoken zonder wachtpunt ervoor (in een bocht over een kruising naast de overweg, of
  // de oprit uit): dan alsnog wachten, 0,1 T voor het spoor, maar niet eerder dan waar hij het laatst stilstond.
  if (M.ovRaster?.size) {
    const T = geo.T, L2 = MAAT[voertuig.soort][0] * T;
    for (let j = 0; j + 1 < n; j++) {
      const l = M.ovRaster.get(Math.floor(P.y[j] / T) * 4096 + Math.floor(P.x[j] / T));
      if (!l) continue;
      for (const m of l) {
        const a = (P.x[j] - m.x) * -m.hy + (P.y[j] - m.y) * m.hx, b = (P.x[j + 1] - m.x) * -m.hy + (P.y[j + 1] - m.y) * m.hx;
        if ((a > 0 && b > 0) || (a < 0 && b < 0) || a === b) continue;
        const t = a / (a - b), cx = P.x[j] + (P.x[j + 1] - P.x[j]) * t, cy = P.y[j] + (P.y[j + 1] - P.y[j]) * t;
        if (Math.abs((cx - m.x) * m.hx + (cy - m.y) * m.hy) > OVERWEG_BREED * T) continue;
        const sc = P.c[j] + (P.c[j + 1] - P.c[j]) * t;
        if (P.conf.some((c) => c.soort === C_OVERWEG && c.ov.i === m.i && c.sHold <= sc && sc - c.sHold < 0.1 * T + L2 + 0.25 * T)) continue;
        let k = j;
        while (k > 0 && !P.z[k]) k--;
        const sHold = Math.max(sc - 0.1 * T - L2, P.c[k]);
        P.conf.push({ soort: C_OVERWEG, knoop: -1, sHold, sRel: sc + 0.1 * T + L2, ov: m, arm: -1, zebra: -1, uitKey: -1, uitVan: 0, uitStop: 0, inKey: -1, banen: null, strikt: 0 });
      }
    }
  }
  P.conf.sort((a, b) => a.sHold - b.sHold);
  return true;
}

// ---------- 3. dienstregeling ----------

// Een ritset bouwen, in plakken: yield na ongeveer `plak` werkeenheden.
const OVERWEG_MARGE = 2;              // seconden speling bij het oversteken van een overweg (wie optrekt of achter een ander rijdt)
const OVERWEG_BREED = 0.15;            // zo ver (in T) langs het spoor van het midden van een overweg telt het als oversteken
const PLAK = 300;                     // werkeenheden per plak (ongeveer een halve milliseconde)
export function* bouwRitten(state, net, geo, view, plak = PLAK, dbg = null) {
  const T = geo.T;
  const M = new Meet(net, geo);
  yield;
  const nat = view?.eigenaar && typeof net.waterFn === 'function' ? net.waterFn(view) : null;
  const { voertuigen, R } = yield* plan(state, net, geo, M, nat, plak);
  yield;
  const inf = view?.infraLaag;
  (inf?.overwegen ?? []).forEach((ov, i) => { if (ov && ov.tak != null && ov.tak >= 0 && ov.s != null) M.overweg.push({ tak: ov.tak, s: ov.s, dicht: ov.dicht, i }); });
  // Elke overweg ook als stuk spoor in een raster per tegel: wie er ergens anders overheen rijdt dan over de tak zelf
  // (door de bocht op een kruising vlak ernaast, of de oprit uit), wacht ook (zie bouwPad).
  M.ovRaster = new Map();
  for (const m of M.overweg) {
    const ov = inf.overwegen[m.i];
    m.x = ov.x; m.y = ov.y; m.hx = ov.hx; m.hy = ov.hy;
    const tx = Math.floor(ov.x / T), ty = Math.floor(ov.y / T);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const k = (ty + dy) * 4096 + tx + dx;
      let l = M.ovRaster.get(k);
      if (!l) M.ovRaster.set(k, (l = []));
      l.push(m);
    }
  }
  // paden
  const paden = [];
  const P = new Pad();
  let werk = 0;
  for (let i = 0; i < voertuigen.length; i++) {
    const v = voertuigen[i];
    v.nr = i;
    // ronden die niet te rijden zijn weglaten (een ronde is been + terugbeen)
    let ok = bouwPad(M, P, v, R, geo);
    if (!ok && v.benen.length > 1) {
      yield;
      const goed = [];
      for (let k = 0; k < v.benen.length; k += 2) {
        yield;
        const proef = { ...v, benen: [...goed, ...v.benen.slice(k, k + 2)] };
        if (bouwPad(M, P, proef, R, geo)) goed.push(...v.benen.slice(k, k + 2));
      }
      v.benen = goed;
      yield;
      ok = goed.length > 0 && bouwPad(M, P, v, R, geo);
    }
    if (ok && v.lus) {
      // de buslijn: zo lang dat een ronde in de rondetijd past (anders een halte minder), en dan zo vaak als in het
      // venster past
      const BU = RITREGELS.bus;
      const duurNu = () => P.s / (0.3 * T) + P.stops.length * (BU.halte + 1) + BU.rust;
      const B0 = v.benen[0];
      while (ok && duurNu() > BU.ronde && B0.via.length > 2) { yield; B0.via = B0.via.slice(0, -1); ok = bouwPad(M, P, v, R, geo); }
      if (ok) {
        yield;
        const duur = duurNu(), [a, b] = BU.venster, keer = clamp(Math.floor((b - a) / duur), 1, 8);
        v.benen = Array.from({ length: keer }, (_, k) => ({ ...B0, vertrek: B0.vertrek + k * duur, uiterst: B0.vertrek + k * duur + 15 }));
        ok = duur <= b - a && bouwPad(M, P, v, R, geo);
      }
    }
    if (ok) paden.push(pakPad(P, v));
    werk += P.n * 4;
    if (werk > plak) { werk = 0; yield; }
  }
  // simuleren; wie om middernacht niet thuis is, valt af en de dag gaat opnieuw
  const stat = { gepland: voertuigen.length, zonderPad: voertuigen.length - paden.length, afgevallen: 0, pogingen: 0, perRit: {} };
  let uit = null;
  for (let poging = 0; poging < 4; poging++) {
    const sim = simuleer(paden, net, M, T, plak, dbg);
    let r;
    for (;;) { r = sim.next(); if (r.done) break; yield; }
    uit = r.value; stat.pogingen++;
    if (!uit.mis.length) break;
    stat.afgevallen += uit.mis.length;
    for (const i of uit.mis) stat.perRit[paden[i].v.rit] = (stat.perRit[paden[i].v.rit] ?? 0) + 1;
    const weg = new Set(uit.mis);
    for (let i = paden.length - 1; i >= 0; i--) if (weg.has(i)) paden.splice(i, 1);
  }
  const R2 = yield* pakUit(paden, uit, net, T);
  R2.stat = stat;
  return R2;
}

// Het pad van één voertuig in vaste arrays.
function pakPad(P, v) {
  const n = P.n;
  const pad = {
    v, n, L2: MAAT[v.soort][0],
    x: Float32Array.from(P.x), y: Float32Array.from(P.y), c: Float64Array.from(P.c), k: Int32Array.from(P.k), g: Float64Array.from(P.g),
    f: Uint8Array.from(P.f), lim: P.lim, cap: P.cap, a: Uint8Array.from(P.a, (x) => Math.round(clamp(x, 0, 1) * 255)),
    conf: P.conf.map((c) => ({ ...c })), stops: P.stops.map((s) => ({ ...s })), benen: P.benen.map((b) => ({ ...b })),
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = pad.x[i], y = pad.y[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  pad.box = [x0, y0, x1, y1];
  // de stukken met dezelfde rijstrook achter elkaar (voor wie-voor-wie)
  const runs = [];
  for (let i = 0; i + 1 < n; i++) {
    const k = pad.k[i];
    if (k < 0) continue;
    const last = runs[runs.length - 1];
    if (last && last.k === k && Math.abs(last.s1 - pad.c[i]) < 1e-6) { last.s1 = pad.c[i + 1]; continue; }
    runs.push({ k, s0: pad.c[i], g0: pad.g[i], s1: pad.c[i + 1] });
  }
  pad.runs = runs;
  return pad;
}

// De dag doorrekenen. Uitkomst: per voertuig de plek s op zijn pad en de toestand per tijdstap, de bezetting van de
// docks en de doorgangen bij de slagbomen.
function* simuleer(paden, net, M, T, plak, dbg = null) {
  const N = paden.length, S1 = STAPPEN + 1;
  const POS = new Float32Array(N * S1), TS = new Uint8Array(N * S1);
  const nK = net.nK + M.nBocht;              // de scherpe bochten tellen als knopen (zie Meet.bochten)
  const excl = new Int32Array(nK).fill(-1), door = new Int16Array(nK), wil = new Int32Array(nK).fill(-1), wilT = new Float64Array(nK), wilOud = new Int32Array(nK).fill(-1);
  const WIL_MAX = 12;
  const wilAan = (K, v, tau) => { if (wil[K] < 0 && wilOud[K] !== v) { wil[K] = v; wilT[K] = tau; } };
  const nRes = net.poorten.length;
  const res = new Int32Array(nRes).fill(-1);
  // toestand per voertuig
  const s = new Float64Array(N), vel = new Float64Array(N), fase = new Uint8Array(N), been = new Int32Array(N);
  const seg = new Int32Array(N), run = new Int32Array(N), ci = new Int32Array(N), si = new Int32Array(N);
  const stopT = new Float64Array(N), aank = new Float64Array(N).fill(-1e9), wachtSinds = new Float64Array(N).fill(-1);
  const gr = paden.map((p) => new Uint8Array(p.conf.length));
  const dockIv = Array.from({ length: nRes }, () => []);
  const boomIv = Array.from({ length: net.grensovergangen.length }, () => []);
  const dockVan = new Int32Array(N).fill(-1), dockSinds = new Float64Array(N), dockLos = new Float64Array(N);
  const vanRes = new Int32Array(N).fill(-1);
  const dockStaat = new Int32Array(nRes).fill(-1);          // wie er nu aan het dock staat (de oprit-as is dan dicht)
  const pas = paden.map(() => []);
  const rede = new Int8Array(N), redeX = new Int32Array(N); // waarom staat een voertuig stil (voor tests)
  const ketting = new Int32Array(8);
  // thuis aan een dock: dat dock is van het voertuig zolang het er staat
  for (let v = 0; v < N; v++) {
    const th = paden[v].v.thuis;
    if (th.soort === R_DOCK) { res[th.p] = v; dockVan[v] = th.p; dockSinds[v] = 0; vanRes[v] = th.p; dockStaat[th.p] = v; }
  }
  // emmers per rijstrook: wie rijdt er nu, op welke σ
  const nKey = net.nT * 2;
  // het kruisvlak per knoop: hoeveel erin, en per arm (hooguit 4): aantal, uitgang, linksafslaanders en richting
  const vakN = new Int16Array(nK), vakTel = new Int8Array(nK * 4), vakUit = new Int32Array(nK * 4), vakLinks = new Int8Array(nK * 4), vakHx = new Float32Array(nK * 4), vakHy = new Float32Array(nK * 4);
  const doorL = new Int16Array(nKey);                      // per rijstrook: hoeveel voertuigen mogen langs de poort aan het eind
  const kop = new Int32Array(nKey).fill(-1), volg = new Int32Array(N), sig = new Float64Array(N), sleutel = new Int32Array(N).fill(-1);
  // σ bij het vullen van de emmers: wie deze stap al verder reed (misschien al op een andere strook), telt nog op zijn
  // oude plek (de emmers zijn van het begin van de stap)
  const sigE = new Float64Array(N);
  const gebruikt = new Int32Array(N);
  const b2 = 2 * REM * T, a = ACC * T, gat = GAT * T;
  let werk = 0;
  const vlimOp = (p, v) => {
    const j = seg[v], c1 = p.cap[j + 1];
    return Math.min(p.lim[j], Math.sqrt(c1 * c1 + b2 * Math.max(0, p.c[j + 1] - s[v])));
  };
  const zetSeg = (p, v) => { let j = seg[v]; while (j + 2 < p.n && p.c[j + 1] <= s[v]) j++; seg[v] = j; };
  const zetRun = (p, v) => {
    let r = run[v];
    while (r < p.runs.length && p.runs[r].s1 <= s[v]) r++;
    run[v] = r;
    if (r < p.runs.length && p.runs[r].s0 <= s[v] + 1e-9) { sleutel[v] = p.runs[r].k; sig[v] = p.runs[r].g0 + (s[v] - p.runs[r].s0); }
    else sleutel[v] = -1;
  };
  // tijd tot het licht van arm op knoop K rood wordt (vanaf u)
  const totRood = (K, arm, u) => { for (let d = 0; d <= C; d += 0.25) if (lichtStand(net, K, arm, u + d) === 0) return d; return C; };
  // Past v nog op de strook na het conflict, zonder met zijn achterkant op de knoop te blijven staan? Het vak loopt
  // van waar de achterkant vrij is (uitVan) tot de stopplek aan het eind van de strook, of tot de achterkant van
  // wie daar voorbij stilstaat. Wie in het vak is telt mee met zijn lengte; wie al voorbij de stopplek rijdt niet.
  const ruimte = (c, v) => {
    const key = c.uitKey;
    if (key < 0) return true;
    const g0 = net.tLen[key >> 1] - c.uitStop;
    let grens = g0, bezet = 0;
    for (let w = kop[key]; w >= 0; w = volg[w]) if (w !== v && vel[w] < 0.05 * T) { const r = sigE[w] - paden[w].L2 * T - gat; if (r < grens) grens = r; }
    for (let w = kop[key]; w >= 0; w = volg[w]) {
      if (w === v || vel[w] < 0.05 * T) continue;
      const l2 = paden[w].L2 * T;
      if (sigE[w] + l2 <= g0 + 0.01 * T && sigE[w] - l2 < grens) bezet += 2 * l2 + gat;
    }
    if (grens - c.uitVan - bezet >= (2 * paden[v].L2 + SPELING) * T) return true;
    // te lang voor dit vak (een bus in een kort straatje): dan mag hij erin zodra de strook leeg is
    if (g0 - c.uitVan < (2 * paden[v].L2 + SPELING) * T) { for (let w = kop[key]; w >= 0; w = volg[w]) if (w !== v) return false; return true; }
    return false;
  };
  // Is het vlak rond poortknoop K leeg (voor in- en uitparkeren)? Niemand voorbij de stopstreep op een arm naar K
  // toe, en niemand vlak na K op een arm eruit.
  // staat w stil voor dezelfde knoop K te wachten (dan rijdt hij het vlak niet in)?
  const wachtOp = (w, K) => {
    if (vel[w] >= 0.02 * T) return false;
    const cw = paden[w].conf;
    let c = ci[w];
    while (c < cw.length && gr[w][c]) c++;
    return c < cw.length && cw[c].knoop === K && cw[c].sHold - s[w] < 0.03 * T;
  };
  const zoneVrij = (K, v) => {
    const I = M.in[K], U = M.uit[K];
    for (let i = 0; i < I.length; i++) {
      const k = I[i], len = net.tLen[k >> 1];
      if (doorL[k] > 0) return false;
      for (let w = kop[k]; w >= 0; w = volg[w]) if (w !== v && sigE[w] + paden[w].L2 * T > len - HOLD_POORT * T && !wachtOp(w, K)) return false;
    }
    for (let i = 0; i < U.length; i++) {
      for (let w = kop[U[i]]; w >= 0; w = volg[w]) if (w !== v && sigE[w] - paden[w].L2 * T < (vel[w] < 0.02 * T ? 0.04 : VRIJ_POORT) * T) return false;
    }
    return true;
  };
  // Zijn de rijstroken die manoeuvre c raakt vrij (zie banenBij)? Niemand met toestemming om langs te rijden, niemand
  // voorbij de stopplek voor de poort (wie daar zelf op de poort wacht telt niet, behalve als de manoeuvre achteruit
  // de rijbaan op draait: strikt), en niemand met zijn achterkant nog in de mond van de oprit.
  const banenVrij = (c, v) => {
    const Bn = c.banen, K = c.knoop;
    if (!Bn) return zoneVrij(K, v);
    for (let i = 0; i < Bn.length; i += 2) {
      const ki = Bn[i], ku = Bn[i + 1], len = net.tLen[ki >> 1];
      if (doorL[ki] > 0) return false;
      for (let w = kop[ki]; w >= 0; w = volg[w]) if (w !== v && sigE[w] + paden[w].L2 * T > len - (HOLD_DOOR - 0.01) * T && ((c.strikt && i === 0) || !wachtOp(w, K))) return false;
      for (let w = kop[ku]; w >= 0; w = volg[w]) if (w !== v && sigE[w] - paden[w].L2 * T < (MOND - 0.008) * T) return false;
    }
    return true;
  };
  const dicht = (ov, u0, d) => {
    const D = ov.dicht;
    if (!D || !D.length) return false;
    for (let j = 0; j + 1 < D.length; j += 2) {
      const a0 = D[j], a1 = D[j + 1];
      // venster [a0, a1) binnen [0, H); botst het met [u0, u0 + d)?
      if ((a0 - H < u0 + d && a1 - H > u0) || (a0 < u0 + d && a1 > u0) || (a0 + H < u0 + d && a1 + H > u0)) return true;
    }
    return false;
  };
  // faal[v]: waarom de laatste aanvraag van v geweigerd is (voor tests en onderzoek):
  // 1 overweg dicht, 2 een ander wil eerst, 3 knoop bezet, 4 vlak niet vrij, 5 rood, 6 haalt groen niet, 7 zebra, 8 geen ruimte erna, 9 aan het dock
  // staat iemand (de oprit-as is dicht voor wie een plek in of uit wil)
  const faal = new Int8Array(N);
  // Eén voertuig tegelijk op een knoop (excl). Wie een poort alleen voorbijrijdt (C_DOOR) neemt de knoop niet, maar
  // telt mee in door[K]: zolang er iemand langsrijdt, begint er niemand aan in- of uitparkeren. Wie al lang op een
  // manoeuvre wacht, krijgt voorrang (wil).
  const geef = (c, v, u, tau, binnen = false) => {
    const K = c.knoop;
    if (c.soort === C_OVERWEG) {
      const est = Math.max(1.5, (c.sRel - s[v]) / Math.max(vel[v], 0.25 * T));
      if (dicht(c.ov, u, est + OVERWEG_MARGE)) { faal[v] = 1; return false; }
      return true;
    }
    if (excl[K] === v) return true;
    // wie door een licht of over een kruising wil maar steeds een in- of uitparkeerder voor zich krijgt, gaat na een
    // paar seconden voor (wil[K]): dan begint er niemand meer aan een manoeuvre op K tot hij er door is
    const langs = c.soort !== C_MAN;
    // (hooguit WIL_MAX s lang, en daarna niet meteen weer dezelfde: wie zelf vastzit, houdt de rest niet op)
    // (behalve als wie de knoop heeft voor een manoeuvre nog achter ons op dezelfde strook staat: die wacht op ons,
    // dus wij gaan eerst; anders wachten ze de hele dag op elkaar)
    if (excl[K] >= 0) {
      const w = excl[K];
      const achterOns = langs && w !== v && fase[w] === 1 && c.inKey >= 0 && sleutel[w] === c.inKey && sleutel[v] === c.inKey && sig[w] < sig[v] && vel[w] < 0.05 * T;
      if (!achterOns) { faal[v] = 3; if (langs) wilAan(K, v, tau); return false; }
    }
    if (c.soort === C_DOOR) { doorL[c.inKey]++; if (wil[K] === v) wil[K] = -1; return true; }
    if (c.soort === C_MAN) {
      const w = wil[K];
      if (w >= 0 && w !== v && fase[w] === 1) {
        if (tau - wilT[K] >= WIL_MAX) { wilOud[K] = w; wil[K] = -1; }
        else if (tau - wilT[K] >= 3) { faal[v] = 2; return false; }
      }
      if (c.plek >= 0 && dockStaat[c.plek] >= 0 && dockStaat[c.plek] !== v) { faal[v] = 9; return false; }
      if (vakN[K] > 0) { faal[v] = 3; return false; }
      if (!banenVrij(c, v)) { faal[v] = 4; return false; }
      if (!ruimte(c, v)) { faal[v] = 8; return false; }
      excl[K] = v;
      return true;
    }
    // (binnen: in dezelfde beweging weer over een kruising waar hij net door groen op kwam; het licht geldt dan niet)
    if (c.soort === C_LICHT && !binnen) {
      if (lichtStand(net, K, c.arm, u) !== 1) { faal[v] = 5; return false; }
      const d = Math.max(0, c.sHold - s[v]), vv = vel[v];
      const est = vv > 0.15 * T ? d / vv : Math.sqrt((2 * d) / a);
      if (est > totRood(K, c.arm, u) - 0.3) { faal[v] = 6; return false; }
      if (c.zebra >= 0 && zebraBezet(net, c.zebra, u) >= 0) { faal[v] = 7; return false; }
    }
    // het kruisvlak: leeg, of achter iemand aan van dezelfde arm naar dezelfde uitgang, of tegelijk met de overkant
    // als geen van beiden linksaf slaat
    if (vakN[K] > 0 && !binnen) {
      const o = K * 4;
      for (let q = 0; q < 4; q++) {
        if (!vakTel[o + q]) continue;
        if (q === c.vak) { if (vakUit[o + q] !== c.uitKey) { faal[v] = 3; return false; } continue; }
        if (c.links || vakLinks[o + q] || c.hx * vakHx[o + q] + c.hy * vakHy[o + q] > -0.7) { faal[v] = 3; return false; }
      }
    }
    if (!ruimte(c, v)) { faal[v] = 8; return false; }
    if (wil[K] === v) wil[K] = -1;
    { const o = K * 4 + c.vak; vakN[K]++; vakUit[o] = vakTel[o] ? vakUit[o] : c.uitKey; vakTel[o]++; vakLinks[o] += c.links; vakHx[o] = c.hx; vakHy[o] = c.hy; }
    return true;
  };
  // Conflict j van v loslaten. Een poortknoop komt pas vrij als v hem verderop niet nog eens vasthoudt (een keerlus).
  const laat = (p, v, j) => {
    const c = p.conf[j];
    gr[v][j] = 0;
    if (c.soort === C_OVERWEG) return;
    if (c.soort === C_DOOR) { if (doorL[c.inKey] > 0) doorL[c.inKey]--; return; }
    if (c.soort === C_LICHT || c.soort === C_KRUIS) {
      const o = c.knoop * 4 + c.vak;
      if (vakTel[o] > 0) { vakTel[o]--; vakN[c.knoop]--; vakLinks[o] -= c.links; }
      return;
    }
    if (excl[c.knoop] !== v) return;
    for (let q = ci[v]; q < p.conf.length && q < j + 6; q++) if (q !== j && gr[v][q] && p.conf[q].knoop === c.knoop && p.conf[q].soort === C_MAN) return;
    excl[c.knoop] = -1;
  };
  for (let n = 0; n < STAPPEN; n++) {
    const tau = n * DT, u = (tau + U0) % H;
    // emmers
    let nG = 0;
    for (let v = 0; v < N; v++) {
      POS[v * S1 + n] = s[v];
      if (fase[v] === 1) {
        const k = sleutel[v];
        if (k >= 0) { volg[v] = kop[k]; kop[k] = v; gebruikt[nG++] = k; sigE[v] = sig[v]; }
      }
    }
    for (let v = 0; v < N; v++) {
      const p = paden[v];
      if (fase[v] === 0) {
        // stil op een rustpunt; vertrekt hij?
        const B = p.benen[been[v]];
        let ts = TOESTAND.GEPARKEERD;
        const vorige = been[v] > 0 ? p.benen[been[v] - 1] : null;
        if (vorige && tau < aank[v] + (vorige.lossen || 0)) ts = TOESTAND.LOST;
        if (!B) { TS[v * S1 + n] = ts; continue; }
        const vroegst = Math.max(B.vertrek, aank[v] + (vorige?.verblijf ?? 0) + (vorige?.lossen ?? 0));
        if (B.laden > 0 && tau >= vroegst - B.laden) ts = TOESTAND.LAADT;
        TS[v * S1 + n] = ts;
        if (tau < vroegst) continue;
        if (tau > B.uiterst || tau > H - 12) {
          // te laat: deze ronde vervalt (alleen vanuit huis), of het voertuig blijft staan
          if (B.ronde && been[v] + B.ronde <= p.benen.length) {
            // de ronde begint en eindigt thuis: verder op het pad, op dezelfde plek (ritStand schuift niet tussen
            // twee standen in rust)
            been[v] += B.ronde;
            const nb = p.benen[been[v]], sN = nb ? nb.sStart : p.benen[been[v] - 1].sEind;
            s[v] = sN; zetSeg(p, v); zetRun(p, v);
            while (ci[v] < p.conf.length && p.conf[ci[v]].sRel <= sN) { if (gr[v][ci[v]]) laat(p, v, ci[v]); ci[v]++; }
            while (si[v] < p.stops.length && p.stops[si[v]].s < sN - 1e-6) si[v]++;
            continue;
          }
          if (tau > H - 12 && B.ronde) continue;
        }
        // het doeldock moet vrij zijn
        const doel = B.naar.soort === R_DOCK ? B.naar.p : -1;
        if (doel >= 0 && res[doel] >= 0 && res[doel] !== v) continue;
        // invoegen vanaf een parkeerstrook: de rijstrook moet vrij zijn
        if (p.runs.length) {
          let r = run[v];
          while (r < p.runs.length && p.runs[r].s1 <= s[v]) r++;
          const R0 = p.runs[r];
          // (de rijstrook begint pas na het rechte stuk uit de strook: kijk tot 0,3 T vooruit)
          if (R0 && R0.s0 <= s[v] + 0.3 * T && (vorige ? vorige.naar : p.v.thuis).soort === R_STROOK) {
            let vrij = true, rij = 0;
            const gHier = R0.g0 + Math.max(0, s[v] - R0.s0);   // waar hij op de rijstrook uitkomt
            for (let w = kop[R0.k]; w >= 0; w = volg[w]) {
              const d = sigE[w] - gHier;
              if (d > -0.6 * T && d < 0.3 * T) vrij = false;
              if (vel[w] < 0.02 * T && d > 0 && d < 0.8 * T) rij++;   // een rij vlak voor hem: niet invoegen
            }
            if (!vrij || rij >= 4) continue;
          }
        }
        // de conflicten op het rustpunt zelf (de poort uit) of er vlak na: die moeten nu allemaal te krijgen zijn,
        // anders blijft hij staan (en staat hij niet half op de rijbaan te wachten). Allemaal, niet alleen het eerste:
        // ligt er een overweg op de oprit vóór de manoeuvre, dan zou hij anders het dock vrijgeven zonder de poort te
        // hebben, en parkeert een ander dwars door hem heen.
        {
          let c = ci[v];
          while (c < p.conf.length && p.conf[c].sRel <= s[v]) c++;
          const c0 = c;
          let ok = true;
          for (; c < p.conf.length && c < c0 + 4; c++) {
            const cf = p.conf[c];
            if (!(cf.sHold <= s[v] + 0.03 * T && cf.sHold <= B.sEind)) break;
            if (!geef(cf, v, u, tau)) { ok = false; break; }
            gr[v][c] = 1;
          }
          if (!ok) { for (let j = c - 1; j >= c0; j--) if (gr[v][j]) laat(p, v, j); continue; }
          if (c > c0) ci[v] = c0;
        }
        // weg
        if (doel >= 0) res[doel] = v;
        if (dockVan[v] >= 0) { dockIv[dockVan[v]].push([dockSinds[v], tau, v, dockLos[v], B.laden || 0]); if (dockStaat[dockVan[v]] === v) dockStaat[dockVan[v]] = -1; dockVan[v] = -1; }
        fase[v] = 1; vel[v] = 0;
        TS[v * S1 + n] = TOESTAND.RIJDT;
        continue;
      }
      // rijdt
      const B = p.benen[been[v]];
      let sMax = B.sEind;
      const sv = s[v]; rede[v] = 0;
      // conflicten achter ons vrijgeven
      while (ci[v] < p.conf.length && p.conf[ci[v]].sRel <= sv) { if (gr[v][ci[v]]) laat(p, v, ci[v]); ci[v]++; }
      // het rustpunt waar we vandaan komen is vrij zodra we de oprit uit zijn
      // (behalve als hij er deze rit weer heen gaat: een rondje vanuit het eigen dock)
      if (vanRes[v] >= 0 && sv > B.sStart + 0.5 * T) { if (res[vanRes[v]] === v && !(B.naar.soort === R_DOCK && B.naar.p === vanRes[v])) res[vanRes[v]] = -1; vanRes[v] = -1; }
      // voorganger op dezelfde strook of op de stroken die we gaan rijden
      const L2 = p.L2 * T;
      let sVoor = Infinity, wVoor = -1;
      const r = run[v];
      for (let q = r; q < p.runs.length && q < r + 6; q++) {
        const R0 = p.runs[q];
        if (R0.s0 > sv + KOM * T) break;
        for (let w = kop[R0.k]; w >= 0; w = volg[w]) {
          if (w === v) continue;
          if (q === r && sleutel[v] === R0.k && sigE[w] <= sig[v]) continue;
          const dd = R0.s0 + (sigE[w] - R0.g0) - sv;
          if (dd <= 0) continue;
          const lim = sv + dd - L2 - paden[w].L2 * T - gat;
          if (lim < sVoor) { sVoor = lim; wVoor = w; }
        }
      }
      // conflicten vooruit: alleen wie vooraan staat vraagt een knoop aan (anders houdt hij hem bezet voor zijn
      // voorganger, die er dan nooit door kan)
      const rem = (vel[v] * vel[v]) / b2;
      // groen gekregen, maar door een voorganger nog niet bij de streep en nu springt het licht om: dan stopt hij
      // (en geeft wat hij verderop al had terug)
      for (let c = ci[v]; c < p.conf.length && p.conf[c].sHold <= sv + rem + KOM * T; c++) {
        const cf = p.conf[c];
        if (!gr[v][c] || cf.sHold < sv + rem + 0.002 * T) continue;
        // zo ook voor een overweg die dichtgaat voor hij er (achter een voorganger aan) overheen is
        if (cf.soort === C_OVERWEG) { if (!dicht(cf.ov, u, Math.max(1.5, (cf.sRel - sv) / Math.max(vel[v], 0.25 * T)) + OVERWEG_MARGE)) continue; }
        else if (cf.soort !== C_LICHT || lichtStand(net, cf.knoop, cf.arm, u) === 1) continue;
        for (let j = p.conf.length - 1; j >= c; j--) if (gr[v][j] && p.conf[j].sHold > sv) laat(p, v, j);
        break;
      }
      for (let c = ci[v]; c < p.conf.length; c++) {
        const cf = p.conf[c];
        if (cf.sHold > sv + rem + KOM * T) break;
        if (gr[v][c]) continue;
        if (cf.sHold > B.sEind) break;
        const d = cf.sHold - sv;
        // langs een poort: alleen als hij er helemaal voorbij kan (de mond van de oprit blijft vrij), tenzij de
        // volgende stopplek daar al voor ligt (een lang voertuig in een kort vak)
        let past = true;
        if (cf.soort === C_DOOR) {
          let grens = Math.min(cf.sRel, B.sEind);
          for (let j = c + 1; j < p.conf.length && j < c + 4; j++) { const cj = p.conf[j]; if (cj.soort !== C_DOOR) { if (!gr[v][j] && cj.sHold < grens) grens = cj.sHold; break; } }
          past = sVoor >= grens + 0.002 * T;
          // staat hij voor de poort te wachten tot er achter de mond plaats is, dan parkeert er intussen niemand voor
          // hem in of uit (anders schuift de ene na de andere ertussen)
          if (!past && d <= rem + vel[v] * DT + 0.03 * T) wilAan(cf.knoop, v, tau);
        }
        if (d <= rem + vel[v] * DT + 0.03 * T && sVoor >= cf.sHold - 0.005 * T && past) {
          // knopen die elkaar overlappen (de volgende stopstreep ligt voor het vrijgeven van deze) gaan in één keer;
          // een poort onderweg telt daarbij niet mee: daar rijdt hij gewoon langs
          let ok = geef(cf, v, u, tau), nn = 0;
          if (ok) {
            gr[v][c] = 1; ketting[nn++] = c;
            if (cf.soort !== C_DOOR) {
              let vorig = c;
              for (let j = c + 1; j < p.conf.length && nn < 4; j++) {
                const cj = p.conf[j];
                if (cj.sHold > B.sEind || p.conf[vorig].sRel <= cj.sHold) break;
                if (cj.soort === C_DOOR || gr[v][j]) continue;
                let binnen = false;
                // (ook wie in één beweging twee keer door hetzelfde kruis- of bochtvlak gaat, zoals bij keren vlak achter
                // een scherpe bocht: dan is hij niet zijn eigen tegenligger)
                for (let q = 0; q < nn; q++) if (p.conf[ketting[q]].knoop === cj.knoop && (p.conf[ketting[q]].soort === C_LICHT || p.conf[ketting[q]].soort === C_KRUIS)) binnen = true;
                if (!geef(cj, v, u, tau, binnen)) { ok = false; break; }
                gr[v][j] = 1; ketting[nn++] = j; vorig = j;
              }
            }
          }
          if (ok) continue;
          for (let q = nn - 1; q >= 0; q--) laat(p, v, ketting[q]);
        }
        if (cf.sHold < sMax) { sMax = cf.sHold; rede[v] = 10 + cf.soort; redeX[v] = cf.knoop; }
        break;
      }
      if (sVoor < sMax) { sMax = Math.max(sv, sVoor); rede[v] = 2; redeX[v] = wVoor; }
      // stops (halte, douane)
      let bijStop = 0;
      const st = p.stops[si[v]];
      if (st && st.s <= sMax + 1e-6) {
        if (stopT[v] > 0) {
          sMax = sv; stopT[v] -= DT; rede[v] = 3; bijStop = 1;
          if (stopT[v] <= 0) { stopT[v] = 0; si[v]++; if (st.gi >= 0) pas[v].push([st.gi, tau - 0.5, st.sPas]); }
        } else if (sv >= st.s - 1e-3) {
          stopT[v] = st.duur; sMax = sv; rede[v] = 3; bijStop = st.duur > 0 ? 1 : 0;
          if (st.duur <= 0) { si[v]++; stopT[v] = 0; }
        } else sMax = Math.min(sMax, st.s);
      }
      // snelheid
      const vl = vlimOp(p, v);
      const ruim = Math.max(0, sMax - sv);
      const vt = Math.min(vl, Math.sqrt(b2 * ruim));
      let nv = Math.min(vel[v] + a * DT, vt);
      if (nv < 0) nv = 0;
      let ns = Math.min(sv + nv * DT, sMax);
      if (ns < sv) ns = sv;
      vel[v] = (ns - sv) / DT;
      s[v] = ns;
      zetSeg(p, v); zetRun(p, v);
      if (vel[v] > 0.02 * T) wachtSinds[v] = -1;
      // langs een slagboom?
      if (pas[v].length) { const q = pas[v][pas[v].length - 1]; if (q.length === 3 && ns >= q[2]) { boomIv[q[0]].push([q[1], tau + DT]); q.push(1); } }
      TS[v * S1 + n] = vel[v] < 0.02 * T ? (bijStop ? Z_STOP : TOESTAND.WACHT) : TOESTAND.RIJDT;
      // aangekomen?
      if (ns >= B.sEind - 1e-6) {
        fase[v] = 0; vel[v] = 0; aank[v] = tau; been[v]++;
        // wat we nog vasthouden: loslaten
        while (ci[v] < p.conf.length && p.conf[ci[v]].sRel <= B.sEind + 1e-6) { if (gr[v][ci[v]]) laat(p, v, ci[v]); ci[v]++; }
        for (let j = ci[v]; j < p.conf.length && j < ci[v] + 8; j++) if (gr[v][j]) laat(p, v, j);
        wachtSinds[v] = -1;
        // (aangekomen aan het eind van deze stap: vanaf de volgende staat hij er)
        if (B.naar.soort === R_DOCK) { dockVan[v] = B.naar.p; dockSinds[v] = tau + DT; dockLos[v] = B.lossen || 0; vanRes[v] = B.naar.p; if (res[B.naar.p] !== v) res[B.naar.p] = v; dockStaat[B.naar.p] = v; }
        else vanRes[v] = -1;
      }
      werk += 3;
    }
    if (dbg) dbg(n, { s, vel, fase, rede, redeX, excl, wil, kop, volg, sig, sleutel, ci, gr, been, faal, wachtSinds, door, res, doorL, paden });
    for (let i = 0; i < nG; i++) kop[gebruikt[i]] = -1;
    werk += N >> 3;
    if (werk > plak) { werk = 0; yield; }
  }
  // de laatste stand en wie niet thuis is
  const mis = [];
  for (let v = 0; v < N; v++) {
    POS[v * S1 + STAPPEN] = s[v];
    TS[v * S1 + STAPPEN] = TS[v * S1 + STAPPEN - 1];
    const hier = been[v] > 0 ? paden[v].benen[been[v] - 1].naar : paden[v].v.thuis;
    // (wie in de laatste stap nog reed, staat om middernacht niet stil)
    if (fase[v] !== 0 || hier.id !== paden[v].v.thuis.id || hier.soort !== paden[v].v.thuis.soort || Math.abs(POS[v * S1 + STAPPEN - 1] - s[v]) > 1e-4 * T) mis.push(v);
    if (dockVan[v] >= 0) dockIv[dockVan[v]].push([dockSinds[v], H, v, dockLos[v], 0]);
  }
  return { POS, TS, dockIv, boomIv, mis, rede, redeX, excl, door, wil, s, gr };
}

// De uitkomst in vaste arrays: per voertuig het pad (punten), de standen per tijdstap en de soort.
function* pakUit(paden, sim, net, T) {
  const N = paden.length;
  let nP = 0;
  for (const p of paden) nP += p.n;
  const px = new Float32Array(nP), py = new Float32Array(nP), pc = new Float64Array(nP), pf = new Uint8Array(nP), pa = new Uint8Array(nP);
  const p0 = new Int32Array(N + 1), box = new Float32Array(N * 4);
  const soort = new Uint8Array(N), kleur = new Uint8Array(N), land = new Int16Array(N), vracht = new Uint8Array(N);
  const info = [];
  let o = 0;
  for (let v = 0; v < N; v++) {
    if ((v & 127) === 127) yield;
    const p = paden[v];
    p0[v] = o;
    px.set(p.x, o); py.set(p.y, o); pc.set(p.c, o); pf.set(p.f, o); pa.set(p.a, o);
    o += p.n;
    box.set(p.box, v * 4);
    soort[v] = p.v.soort; kleur[v] = p.v.kleur; land[v] = p.v.land; vracht[v] = p.v.vracht ? 1 : 0;
    info.push({ sleutel: p.v.sleutel, rit: p.v.rit, land: p.v.land, soort: p.v.soort, res: p.v.res ?? null, rol: p.v.rol ?? null, van: p.v.van, doel: p.v.doel, thuis: p.v.thuis, contract: p.v.contract ?? null, konvooi: !!p.v.konvooi, viaHaven: !!p.v.viaHaven, partner: p.v.partner ?? null, benen: p.benen.map((b) => ({ naar: b.naar, vertrek: b.vertrek, sStart: b.sStart, sEind: b.sEind, lossen: b.lossen, laden: b.laden })), stops: p.stops, conf: p.conf.map((c) => ({ soort: c.soort, knoop: c.knoop, sHold: c.sHold, sRel: c.sRel, arm: c.arm, zebra: c.zebra, draai: !!c.draai, ov: c.ov ? c.ov.i : -1 })) });
  }
  p0[N] = o;
  // docks: per poort de bezetting
  const dock = sim.dockIv.map((l) => l.map(([a, b, v, los, laad]) => ({ van: a, tot: b, v, los, laad, soort: soort[v] })).sort((x, y) => x.van - y.van));
  return { n: N, px, py, pc, pf, pa, p0, box, soort, kleur, land, vracht, info, S: sim.POS, Z: sim.TS, dock, boom: sim.boomIv, T };
}

// ---------- 4. opvragen ----------

// De stand van voertuig v op verkeerstijd u: uit.x, y, hoek, toestand, alpha (en hx, hy, knip, achter).
export function ritStand(R, v, u, uit) {
  const t = tauVan(u) / DT;
  let i = t | 0;
  if (i >= STAPPEN) i = STAPPEN - 1;
  const w = t - i, S1 = STAPPEN + 1, b = v * S1 + i, z0 = R.Z[b];
  // in rust (laden, lossen, geparkeerd) staat hij stil; een overgeslagen ronde verspringt alleen de plek op het pad
  const s = z0 >= TOESTAND.LAADT && z0 <= TOESTAND.GEPARKEERD ? R.S[b] : R.S[b] + (R.S[b + 1] - R.S[b]) * w;
  const a0 = R.p0[v], a1 = R.p0[v + 1] - 1, pc = R.pc;
  let lo = a0, hi = a1;
  if (s <= pc[lo]) hi = lo + 1;
  else {
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pc[m] <= s) lo = m; else hi = m; }
  }
  if (hi > a1) hi = a1;
  const d = pc[hi] - pc[lo];
  const f = d > 1e-9 ? (s - pc[lo]) / d : 0;
  const x0 = R.px[lo], y0 = R.py[lo], x1 = R.px[hi], y1 = R.py[hi];
  uit.x = x0 + (x1 - x0) * f; uit.y = y0 + (y1 - y0) * f;
  let hx = x1 - x0, hy = y1 - y0;
  if (d <= 1e-9) {
    // stil op een punt: de richting van het stuk ervoor
    const q = lo > a0 ? lo - 1 : lo;
    hx = R.px[q + 1] - R.px[q]; hy = R.py[q + 1] - R.py[q];
    if (R.pf[q] & F_ACHTER) { hx = -hx; hy = -hy; }
  } else if (R.pf[lo] & F_ACHTER) { hx = -hx; hy = -hy; }
  const hl = Math.hypot(hx, hy) || 1;
  uit.hx = hx / hl; uit.hy = hy / hl;
  uit.hoek = Math.atan2(uit.hy, uit.hx);
  const zz = R.Z[b];
  uit.toestand = zz === Z_STOP ? TOESTAND.WACHT : zz;
  uit.stop = zz === Z_STOP ? 1 : 0;
  uit.knip = R.pf[lo] & F_KNIP ? (R.pf[lo] & F_LINKS ? -1 : 1) : 0;
  uit.achter = R.pf[lo] & F_ACHTER ? 1 : 0;
  uit.alpha = (R.pa[lo] + (R.pa[hi] - R.pa[lo]) * f) / 255;
  uit.s = s;
  return uit;
}

// Hoe lang (s) voertuig v op u al in zijn huidige stand staat (hooguit max): voor wie bij een halte in- en uitstapt.
export function standSinds(R, v, u, max = 12) {
  const t = tauVan(u) / DT, S1 = STAPPEN + 1;
  let i = Math.min(STAPPEN - 1, t | 0);
  const z = R.Z[v * S1 + i], m = Math.round(max / DT);
  let k = 0;
  while (k < m && i - k - 1 >= 0 && R.Z[v * S1 + i - k - 1] === z) k++;
  return k * DT + (t - i) * DT;
}

// Docks: { bezet, soort 0 laden / 1 lossen, voortgang 0..1, voertuig } of null.
export function dockStand(R, net, t, u) {
  const p = net?.D?.poortVanT?.[t];
  if (p == null || p < 0 || !R) return null;
  const L = R.dock[p];
  if (!L || !L.length) return null;
  const tau = tauVan(u);
  for (const d of L) {
    if (tau < d.van || tau >= d.tot) continue;
    if (d.los > 0 && tau < d.van + d.los) return { bezet: 1, soort: 1, voortgang: clamp((tau - d.van) / d.los, 0, 1), voertuig: d.soort };
    if (d.laad > 0 && d.tot < H && tau >= d.tot - d.laad) return { bezet: 1, soort: 0, voortgang: clamp((tau - (d.tot - d.laad)) / d.laad, 0, 1), voertuig: d.soort };
    return { bezet: 1, soort: 0, voortgang: 0, voertuig: d.soort };
  }
  return null;
}

// Slagboom van grensovergang i: 0 dicht tot 1 open; open terwijl er een voertuig doorrijdt.
export function slagboom(R, i, u) {
  const L = R?.boom?.[i];
  if (!L || !L.length) return 0;
  const tau = tauVan(u);
  let best = 0;
  for (const [a, b] of L) {
    for (const k of [0, H, -H]) {
      const t = tau + k;
      if (t < a - 0.01 || t > b + 0.5) continue;
      best = Math.max(best, clamp((t - a) / 0.5, 0, 1) * clamp((b + 0.5 - t) / 0.5, 0, 1));
    }
  }
  return best;
}

// ---------- 5. beheer: bouwen in plakken en wisselen op rustpunten ----------

// Handtekening van wat de ritten bepaalt: net, gebouwen, contracten, oorlog en sneeuw.
export function ritSig(state, net) {
  let h = (net?.versie ?? 0) * 7919 + (state.landen?.length ?? 0);
  for (const L of state.landen) {
    for (const p of L.plaatsingen) h = (Math.imul(h, 31) + p.t * 131 + tekstHash(p.g) * 17 + (p.niveau ?? 1) * 7) | 0;
    h = (Math.imul(h, 37) + (oorlogenVan(state, L).length ? 1 : 0) + ((L.stab ?? 100) < RITREGELS.hulp.onrustStab ? 2 : 0) + (state.pandemie?.besmet?.[L.idx] ? 4 : 0)) | 0;
  }
  for (const c of state.contracten ?? []) if (c.status === 'actief') h = (Math.imul(h, 41) + (c.id | 0) * 13 + Math.round(c.a_geeft?.per_dag ?? 0) + Math.round(c.b_geeft?.per_dag ?? 0) * 3) | 0;
  for (const k of state.kolonies ?? []) h = (Math.imul(h, 43) + k.t) | 0;
  h = (Math.imul(h, 47) + (sneeuwDekVan(state.dag ?? 0) > RITREGELS.strooi.drempel ? 1 : 0)) | 0;
  return h;
}

export class Ritten {
  constructor() {
    this.R = null;          // de huidige ritset
    this.oud = null;        // de vorige, tot iedereen daarvan op een rustpunt is
    this.sig = null;
    this.taak = null;
    this.taakSig = null;
    this.wisselNu = 0;
    this.eindOud = null;    // per oud voertuig: tot wanneer (nu, ms) hij nog meedoet
    this.beginNieuw = null; // per nieuw voertuig: vanaf wanneer
    this.versie = 0;
  }
  // Werk per beeld: bijhouden of de ritset nog klopt en zo nodig verder bouwen, hooguit budgetMs lang (de klok komt
  // van de kaart: view.tijdMs; zonder klok één plak per beeld). De eerste ritset bouwt hij in één keer.
  werk(view, nu, budgetMs = 2) {
    const s = view.state, net = view.wegennet;
    if (!s || !net?.klaar || !view.geo) return;
    const sig = ritSig(s, net);
    if (sig === this.sig && !this.taak) return;
    if (sig !== this.taakSig) { this.taak = bouwRitten(s, net, view.geo, view, PLAK); this.taakSig = sig; }
    const eerste = !this.R;
    const klok = !eerste && typeof view.tijdMs === 'function' ? () => view.tijdMs() : null;
    const t0 = klok ? klok() : 0;
    for (;;) {
      const r = this.taak.next();
      if (r.done) { this.zet(r.value, nu); this.sig = sig; this.taak = null; return; }
      if (eerste) continue;
      if (!klok || klok() - t0 >= budgetMs) return;
    }
  }
  bouwNu(view) {
    const s = view.state, net = view.wegennet;
    if (!s || !net?.klaar) return;
    const sig = ritSig(s, net);
    const g = bouwRitten(s, net, view.geo, view);
    let r; do r = g.next(); while (!r.done);
    this.zet(r.value, 0);
    this.sig = sig; this.taak = null; this.taakSig = sig;
  }
  // Een nieuwe ritset aannemen. Wie in de oude set rijdt, rijdt door tot zijn volgende rustpunt en vervaagt daar;
  // wie nieuw is, verschijnt op zijn eerste rustpunt. Wie in beide sets op hetzelfde rustpunt staat, wisselt zonder
  // vervagen.
  zet(R, nu) {
    if (!this.R) { this.R = R; this.versie++; return; }
    const oud = this.R, u = ((nu / 1000) % H + H) % H, uit = {}, uit2 = {};
    const rustOver = (S, v) => {
      // seconden tot voertuig v (in set S) op een rustpunt staat
      const t0 = tauVan(u) / DT | 0, S1 = STAPPEN + 1;
      for (let k = 0; k <= STAPPEN; k++) {
        const i = (t0 + k) % STAPPEN, z = S.Z[v * S1 + i];
        if (z >= TOESTAND.LAADT && z !== Z_STOP) return k * DT;
      }
      return 0;
    };
    const per = new Map();
    for (let v = 0; v < R.n; v++) per.set(R.info[v].sleutel, v);
    this.eindOud = new Float64Array(oud.n);
    this.beginNieuw = new Float64Array(R.n);
    const gekoppeld = new Uint8Array(R.n);
    for (let v = 0; v < oud.n; v++) {
      const d = rustOver(oud, v);
      const w = per.get(oud.info[v].sleutel);
      if (w != null) {
        const ua = u + d;
        ritStand(oud, v, ua, uit); ritStand(R, w, ua, uit2);
        if (Math.hypot(uit.x - uit2.x, uit.y - uit2.y) < 0.02 * R.T && uit2.toestand >= TOESTAND.LAADT) {
          this.eindOud[v] = nu + d * 1000; this.beginNieuw[w] = nu + d * 1000; gekoppeld[w] = 1; continue;
        }
      }
      this.eindOud[v] = nu + d * 1000 + 1000;
    }
    for (let w = 0; w < R.n; w++) if (!gekoppeld[w]) this.beginNieuw[w] = nu + rustOver(R, w) * 1000 + 1000;
    this.oud = oud;
    this.koppel = gekoppeld;
    this.R = R;
    this.wisselNu = nu;
    this.versie++;
  }
  // Doorzichtigheid door het wisselen: voor een nieuw voertuig (oud = false) of een oud.
  wisselAlfa(v, nu, oud) {
    if (oud) {
      const e = this.eindOud?.[v] ?? 0;
      return clamp((e - nu) / 1000, 0, 1);
    }
    if (!this.beginNieuw) return 1;
    const b = this.beginNieuw[v];
    if (this.koppel?.[v]) return nu >= b ? 1 : 0;
    return clamp((nu - (b - 1000)) / 1000, 0, 1);
  }
  // Is het wisselen voorbij? Dan kan de oude set weg.
  ruim(nu) {
    if (!this.oud) return;
    let klaar = true;
    for (let v = 0; v < this.oud.n && klaar; v++) if (this.eindOud[v] > nu) klaar = false;
    if (klaar) { this.oud = null; this.eindOud = null; }
  }
}

// Voor tests: de onderdelen los.
export const _intern = { plan, bouwPad, Meet, Pad, pakPad, simuleer };
