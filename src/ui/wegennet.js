// Wegennet: één echt wegennet voor de hele kaart, de enige bron voor asfalt, verkeer, kavels en akkers.
//
// Hoe het ontstaat (vaste volgorde, puur uit de toestand, zonder geschiedenis):
//   1. Per land een stadsrooster op de hoofdstad: lijnen op beide randen van de hoofdstadtegel en verder om de twee
//      tegels. Een randstuk van dat rooster wordt straat als er een bebouwde of gereserveerde tegel van het land aan
//      ligt. Losse stukken van de stad worden aan de hoofdstad geknoopt.
//   2. Voorzieningen (station, vliegveld, havens, depots) en losse gebouwen krijgen een weg vanaf het midden van een
//      van hun zijden naar het net van de hoofdstad: zoeken over een rooster van tegelhoeken en randmiddens, schuin
//      alleen door vrije droge tegels, met kosten voor terrein, helling, water (bruggen van hooguit twee tegels) en
//      bochten. Wat al ligt kost × 0,35, zodat er een stam met takken groeit en geen ster.
//   3. Stamwegen tussen de hoofdsteden van elk paar uit de handelsroutes (zonder handelsroutes: buren); waar een
//      stamweg een grens kruist ligt een grensovergang.
//   4. De wegen van de hoofdstad naar station, vliegveld, havens, mijnen en grensovergangen worden HOOFD.
//   5. Elke bebouwde of gereserveerde tegel krijgt een poort op de zijde met de hoogste klasse, met een oprit 0,28 T
//      de kavel in en een dock aan het eind. Doodlopende stukken voorbij de laatste poort gaan weg.
//   6. Het rooster wordt samengevat tot knopen en takken (polylijnen met afgeronde hoeken), met lichten, rotondes,
//      zebra's, haltes en parkeerstroken.
// Bouwen gebeurt in plakken (werk met een budget); de uitkomst hangt niet af van het budget. Tot een nieuwe bouw klaar
// is, blijft het vorige net staan.
//
// Contract (bevroren na stap 1: velden toevoegen mag, wijzigen of weghalen niet); eenheden zijn wereldeenheden (T = 16),
// PROFIEL staat in T. Schrijver: dit bestand; alle andere lagen lezen alleen.

export const H = 180, C = 15;
// u: de enige verkeersklok, periodiek in H seconden.
export const verkeersTijd = (nu) => (((nu / 1000) % H) + H) % H;
export const KLASSE = { ERF: 0, STRAAT: 1, HOOFD: 2, STAM: 3, OPRIT: 4 };
export const PROFIEL = [                                          // asfalt = breedte, baan = rijlijn vanaf de as
  { asfalt: 0.07, baan: 0, stoep: 0, inzet: 0.045 },             // ERF: één strook voor beide richtingen
  { asfalt: 0.12, baan: 0.03, stoep: 0.025, inzet: 0.085 },      // STRAAT
  { asfalt: 0.14, baan: 0.035, stoep: 0.025, inzet: 0.095 },     // HOOFD
  { asfalt: 0.16, baan: 0.04, stoep: 0, inzet: 0.08 },           // STAM (berm)
  { asfalt: 0.10, baan: 0, stoep: 0, inzet: 0 },                 // OPRIT: 0.28 T de kavel in, dock aan het eind
];
export const KNOOP = { KRUIS: 0, LICHT: 1, ROTONDE: 2, POORT: 3, DOCK: 4, EIND: 5 };
export const ZIJDE = { N: 0, O: 1, Z: 2, W: 3 };
export const GROND = { VRIJ: 0, WEG: 1, STOEP: 2, KAVEL: 3, OPRIT: 4, RAND: 5 };
export const ROTONDE_STRAAL = 0.12;
export const ZONE = {
  hoofdstad: 'centrum', woonwijk: 'woon', kolonie: 'woon',
  school: 'dienst', universiteit: 'dienst', ziekenhuis: 'dienst', politie: 'dienst', rechtbank: 'dienst', omroep: 'dienst',
  kazerne: 'leger', wapenfabriek: 'leger', dronebasis: 'leger', cybercentrum: 'leger',
  centrale: 'energie', zonnepark: 'energie', olieveld: 'energie', mijn: 'delf',
  boerderij: 'land', landbouw: 'land', houtkap: 'land',
  industrie: 'werk', zware_industrie: 'werk', staalfabriek: 'werk', chipfabriek: 'werk', ruimtevaartcentrum: 'werk',
  opslag: 'logistiek', spoor: 'logistiek', haven: 'haven',
}; // voorzieningen (station, vliegveld, haven, depot): 'voorziening'; het pack-veld `zone` gaat voor

// Lengte van de oprit en de cyclus van de verkeerslichten.
export const OPRIT = 0.28;
const GROEP = [[0, 6, 7], [7.5, 13.5, 14.5]]; // per groep: begin groen, begin oranje, begin rood (in s binnen C)

// Verkeerslicht: 0 rood, 1 groen, 2 oranje. arm = volgnummer in net.lichten[i].armen (zie net.armVan). Een knoop
// zonder licht is altijd groen. Voetgangers die over arm a oversteken hebben groen tijdens de roodtijd van a, met 1 s
// marge aan beide kanten (voetLicht).
export function lichtStand(net, knoop, arm, u) {
  const li = net.kLicht ? net.kLicht[knoop] : -1;
  if (li == null || li < 0) return 1;
  const L = net.lichten[li];
  const g = L.groep[arm] ?? 0;
  const v = ((((u + L.fase0) % C) + C) % C);
  const [g0, o0, r0] = GROEP[g];
  if (g === 0) return v < o0 ? 1 : v < r0 ? 2 : 0;
  return v >= g0 && v < o0 ? 1 : v >= o0 && v < r0 ? 2 : 0;
}
// Voetgangerslicht over arm a: 1 groen, 0 rood.
export function voetLicht(net, knoop, arm, u) {
  const li = net.kLicht ? net.kLicht[knoop] : -1;
  if (li == null || li < 0) return 1;
  const L = net.lichten[li];
  const g = L.groep[arm] ?? 0;
  const v = ((((u + L.fase0) % C) + C) % C);
  // rood voor het verkeer van groep 0: [7, 15); van groep 1: [14.5, 15) ∪ [0, 7.5)
  if (g === 0) return v >= 8 && v < 14 ? 1 : 0;
  return (v >= 0.5 && v < 6.5) ? 1 : 0;
}

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const SNELHEID = [0.55, 0.75, 1.0, 1.3, 0.3]; // relatieve snelheid per klasse, voor route()
const TERREIN = { vlakte: 1, kust: 1.2, bos: 1.5, berg: 1.8, water: 1.3 };
const DRAAI = [0, 0.3, 0.9, 3, Infinity]; // bochtkosten per 45° verschil in richting
const DX8 = [1, 1, 0, -1, -1, -1, 0, 1], DY8 = [0, 1, 1, 1, 0, -1, -1, -1]; // O ZO Z ZW W NW N NO
const BUUR8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]; // N NO O ZO Z ZW W NW
const NAAD = { woon: 0, centrum: 0, dienst: 0, werk: 1, logistiek: 1, energie: 1, delf: 1, land: 2, leger: 3, haven: 4, voorziening: 4 };
const INZET = { naad: 0, haag: 0.03, rand: 0.04, water: 0.02 };
const PARKEER = { woon: 4, centrum: 6, dienst: 6, werk: 4, voorziening: 4, haven: 2, logistiek: 2, energie: 2, delf: 2, leger: 2, land: 2 };
const POORTSOORT = { woon: 'woon', centrum: 'dienst', dienst: 'dienst', voorziening: 'voorziening', haven: 'voorziening' };
const HALTE = { hoofdstad: 1, woonwijk: 1, school: 1, ziekenhuis: 1 };
const LOKAAL = 0, STAMZOEK = 1;

// Steekt de weg van (ax, ay) naar (bx, by) het water over op de natte strook tussen fractie f0 en f1? Dan loopt het
// water aan beide kanten van de weg door. Een rivier mag schuin onder de brug door: aan elke kant wordt binnen een
// venster langs de weg gezocht (een weg die langs een oever schampt of door de hoek van een meer loopt, heeft maar
// aan één kant water).
export function steektOver(water, ax, ay, bx, by, f0, f1, T) {
  const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
  const f = (f0 + f1) / 2, mx = ax + dx * f, my = ay + dy * f;
  const kant = (s) => {
    const px = -uy * s * 0.22 * T, py = ux * s * 0.22 * T;
    for (let q = 0; q <= 8; q++) { const a = (q & 1 ? -1 : 1) * ((q + 1) >> 1) * 0.07 * T; if (water(mx + px + ux * a, my + py + uy * a)) return true; }
    return false;
  };
  return kant(1) && kant(-1);
}

// ---------- het rooster (vast per wereld) ----------
// Knopen: tegelhoeken, middens van horizontale randen, middens van verticale randen. Kanten: halve tegelranden,
// diagonalen door droge tegels en rechte oversteken over water (bruggen) van hooguit twee tegels.

function* maakRooster(geo, water, hoogteOp) {
  const { kol, rij } = geo, T = geo.T;
  const NC = (kol + 1) * (rij + 1), NH = kol * (rij + 1), NV = (kol + 1) * rij, N = NC + NH + NV;
  const nx = new Float32Array(N), ny = new Float32Array(N);
  for (let r = 0; r <= rij; r++) for (let k = 0; k <= kol; k++) { const i = r * (kol + 1) + k; nx[i] = k * T; ny[i] = r * T; }
  for (let r = 0; r <= rij; r++) for (let k = 0; k < kol; k++) { const i = NC + r * kol + k; nx[i] = (k + 0.5) * T; ny[i] = r * T; }
  for (let r = 0; r < rij; r++) for (let k = 0; k <= kol; k++) { const i = NC + NH + r * (kol + 1) + k; nx[i] = k * T; ny[i] = (r + 0.5) * T; }
  const hoek = (k, r) => r * (kol + 1) + k, hMid = (k, r) => NC + r * kol + k, vMid = (k, r) => NC + NH + r * (kol + 1) + k;
  const maxE = 2 * NH + 2 * NV + 2 * kol * rij + NH + NV + 4000;
  const eA = new Int32Array(maxE), eB = new Int32Array(maxE), eLen = new Float32Array(maxE), eDir = new Uint8Array(maxE);
  const eSoort = new Uint8Array(maxE), eT1 = new Int32Array(maxE).fill(-1), eT2 = new Int32Array(maxE).fill(-1);
  const eNat = new Uint8Array(maxE), eBouw = new Uint8Array(maxE), eKost = new Float32Array(maxE);
  const schamp = new Uint8Array(maxE); // natte halve rand die het water niet oversteekt maar een oever of vijverhoek schampt
  const eLijn = new Int32Array(maxE).fill(-1); // halve rand: lijnnummer (rij-lijn r, of kolom-lijn k + 10000)
  let nE = 0;
  const tegel = (k, r) => (k < 0 || r < 0 || k >= kol || r >= rij ? -1 : r * kol + k);
  const terreinF = (t) => (t < 0 ? 1.3 : TERREIN[geo.tegels[t].terrein] ?? 1);
  const natVan = (ax, ay, bx, by, n) => {
    let nat = 0;
    for (let i = 0; i <= n; i++) { const w = water(ax + (bx - ax) * i / n, ay + (by - ay) * i / n); if (w) nat |= w === 1 ? 1 : 2; }
    return nat;
  };
  const voegToe = (a, b, dir, soort, t1, t2, lijn) => {
    const e = nE++;
    eA[e] = a; eB[e] = b; eDir[e] = dir; eSoort[e] = soort; eT1[e] = t1; eT2[e] = t2; eLijn[e] = lijn;
    eLen[e] = Math.hypot(nx[b] - nx[a], ny[b] - ny[a]);
    return e;
  };
  // halve randen
  const halfH = new Int32Array(NH * 2), halfV = new Int32Array(NV * 2);
  for (let r = 0; r <= rij; r++) for (let k = 0; k < kol; k++) {
    const m = hMid(k, r), t1 = tegel(k, r - 1), t2 = tegel(k, r);
    halfH[(r * kol + k) * 2] = voegToe(hoek(k, r), m, 0, 0, t1, t2, r);
    halfH[(r * kol + k) * 2 + 1] = voegToe(m, hoek(k + 1, r), 0, 0, t1, t2, r);
  }
  for (let r = 0; r < rij; r++) for (let k = 0; k <= kol; k++) {
    const m = vMid(k, r), t1 = tegel(k - 1, r), t2 = tegel(k, r);
    halfV[(r * (kol + 1) + k) * 2] = voegToe(hoek(k, r), m, 2, 0, t1, t2, 10000 + k);
    halfV[(r * (kol + 1) + k) * 2 + 1] = voegToe(m, hoek(k, r + 1), 2, 0, t1, t2, 10000 + k);
  }
  const nHalf = nE;
  yield;
  // natte halve randen zijn alleen als brug te gebruiken: zee 2, zoet 1
  for (let e = 0; e < nHalf; e++) { eNat[e] = natVan(nx[eA[e]], ny[eA[e]], nx[eB[e]], ny[eB[e]], 10); if (eNat[e]) eBouw[e] = eNat[e] & 1 ? 2 : 1; if (e % 1500 === 1499) yield; }
  // diagonalen door droge tegels
  const diag = new Int32Array(kol * rij * 2).fill(-1);
  for (let r = 0; r < rij; r++) for (let k = 0; k < kol; k++) {
    const t = r * kol + k;
    if (t % 400 === 399) yield;
    if (geo.tegels[t].terrein === 'water') continue;
    if (!natVan(k * T, r * T, (k + 1) * T, (r + 1) * T, 16)) diag[t * 2] = voegToe(hoek(k, r), hoek(k + 1, r + 1), 1, 1, t, -1, -1);
    if (!natVan((k + 1) * T, r * T, k * T, (r + 1) * T, 16)) diag[t * 2 + 1] = voegToe(hoek(k + 1, r), hoek(k, r + 1), 3, 1, t, -1, -1);
  }
  // rechte oversteken over water: een maximale reeks natte halve randen tussen twee droge, hooguit twee tegels lang
  const dekVan = [];
  const oversteek = (reeks, dir) => {
    let i = 0;
    while (i < reeks.length) {
      if (!eNat[reeks[i]]) { i++; continue; }
      let j = i, nat = 0;
      while (j < reeks.length && eNat[reeks[j]]) { nat |= eNat[reeks[j]]; j++; }
      // alleen een echte oversteek: midden boven het water ligt aan beide kanten van de brug water (een brug die
      // langs een oever of in de lengte over een beek loopt, is er geen)
      const a = i > 0 && j < reeks.length ? eA[reeks[i]] : -1, b = a >= 0 ? eB[reeks[j - 1]] : -1;
      let dwars = false;
      if (a >= 0 && j - i <= 4) {
        // het echte natte stuk opzoeken (de randen zijn een halve tegel lang, het water vaak veel smaller) en midden
        // daarin loodrecht kijken; twee losse plassen achter elkaar zijn geen oversteek
        const M = 16 * (j - i);
        let eerste = -1, laatste = -1, stroken = 0, vorig = false;
        for (let q = 0; q <= M; q++) {
          const nat = water(nx[a] + (nx[b] - nx[a]) * q / M, ny[a] + (ny[b] - ny[a]) * q / M) !== 0;
          if (nat) { if (!vorig) stroken++; if (eerste < 0) eerste = q; laatste = q; }
          vorig = nat;
        }
        if (eerste >= 0 && stroken === 1) dwars = steektOver(water, nx[a], ny[a], nx[b], ny[b], eerste / M, laatste / M, T);
      }
      if (!dwars) for (let q = i; q < j; q++) schamp[reeks[q]] = 1;
      else {
        const e = voegToe(a, b, dir, 2, -1, -1, -1);
        eNat[e] = nat; eBouw[e] = nat & 1 ? 2 : 1;
        dekVan[e] = reeks.slice(i, j); // de halve randen die deze brug overspant
        eKost[e] = eLen[e] / T + (nat & 1 ? 10 : 4);
      }
      i = j;
    }
  };
  for (let r = 0; r <= rij; r++) { const reeks = []; for (let k = 0; k < kol; k++) reeks.push(halfH[(r * kol + k) * 2], halfH[(r * kol + k) * 2 + 1]); oversteek(reeks, 0); }
  for (let k = 0; k <= kol; k++) { const reeks = []; for (let r = 0; r < rij; r++) reeks.push(halfV[(r * (kol + 1) + k) * 2], halfV[(r * (kol + 1) + k) * 2 + 1]); oversteek(reeks, 2); }
  yield;
  // vaste kosten: terrein, helling, tunnels
  const hN = new Float32Array(N);
  for (let n = 0; n < N; n++) hN[n] = hoogteOp(nx[n], ny[n]);
  yield;
  for (let e = 0; e < nE; e++) {
    if (e % 4000 === 3999) yield;
    if (eSoort[e] === 2) continue;
    const t1 = eT1[e], t2 = eT2[e];
    let f;
    if (eSoort[e] === 1) f = terreinF(t1);
    else f = t1 < 0 ? terreinF(t2) : t2 < 0 ? terreinF(t1) : (terreinF(t1) + terreinF(t2)) / 2;
    const berg = eSoort[e] === 1 ? geo.tegels[t1].terrein === 'berg' : t1 >= 0 && t2 >= 0 && geo.tegels[t1].terrein === 'berg' && geo.tegels[t2].terrein === 'berg';
    if (berg && !eNat[e]) eBouw[e] = 3;
    eKost[e] = (eLen[e] / T) * f + 6 * Math.abs(hN[eA[e]] - hN[eB[e]]) + (eNat[e] ? (eNat[e] & 1 ? 10 : 4) + (schamp[e] ? 8 : 0) : 0);
  }
  yield;
  // knoop → kanten (CSR)
  const graad = new Int32Array(N + 1);
  for (let e = 0; e < nE; e++) { graad[eA[e] + 1]++; graad[eB[e] + 1]++; }
  for (let n = 0; n < N; n++) graad[n + 1] += graad[n];
  const nKant = new Int32Array(graad[N]), vul = graad.slice(0, N);
  for (let e = 0; e < nE; e++) { nKant[vul[eA[e]]++] = e; nKant[vul[eB[e]]++] = e; }
  return { kol, rij, T, NC, NH, NV, N, nx, ny, hN, nE, nHalf, eA, eB, eLen, eDir, eSoort, eT1, eT2, eNat, eBouw, eKost, eLijn, schamp, halfH, halfV, diag, dekVan, k0: graad, kant: nKant, hoek, hMid, vMid };
}

// Halve randen en midden van zijde z (N O Z W) van tegel t.
export function zijdeVan(R, t, z) {
  const k = t % R.kol, r = (t / R.kol) | 0;
  if (z === 0) return { mid: R.hMid(k, r), e0: R.halfH[(r * R.kol + k) * 2], e1: R.halfH[(r * R.kol + k) * 2 + 1] };
  if (z === 2) return { mid: R.hMid(k, r + 1), e0: R.halfH[((r + 1) * R.kol + k) * 2], e1: R.halfH[((r + 1) * R.kol + k) * 2 + 1] };
  if (z === 3) return { mid: R.vMid(k, r), e0: R.halfV[(r * (R.kol + 1) + k) * 2], e1: R.halfV[(r * (R.kol + 1) + k) * 2 + 1] };
  return { mid: R.vMid(k + 1, r), e0: R.halfV[(r * (R.kol + 1) + k + 1) * 2], e1: R.halfV[(r * (R.kol + 1) + k + 1) * 2 + 1] };
}
const ZN = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // buitenwaartse normaal per zijde

// ---------- het net ----------

export class Wegennet {
  constructor() {
    this.versie = 0;
    this.klaar = false;
    this.leeg();
    this.rooster = null;
    this.bouwer = null;
    this.bouwSig = '';
    this.sig = '';
    this.debug = null;
  }

  leeg() {
    this.nK = 0; this.kx = new Float32Array(0); this.ky = new Float32Array(0); this.kSoort = new Uint8Array(0); this.kLand = new Int16Array(0); this.kLicht = new Int16Array(0);
    this.nT = 0; this.tA = new Int32Array(0); this.tB = new Int32Array(0); this.tKlasse = new Uint8Array(0); this.tLand = new Int16Array(0); this.tLen = new Float32Array(0);
    this.tP0 = new Int32Array(0); this.tNP = new Uint16Array(0); this.tZaad = new Uint32Array(0); this.tBouw = new Uint8Array(0); this.tBox = new Float32Array(0);
    this.punten = new Float32Array(0); this.cum = new Float32Array(0); this.adj0 = new Int32Array(1); this.adj = new Int32Array(0);
    this.lichten = []; this.poorten = []; this.haltes = []; this.parkeerstroken = []; this.zebras = []; this.grensovergangen = [];
    this.D = null; this._omg = []; this._wegen = null; this.kDeel = new Int32Array(0); this.nDelen = 0;
  }

  // Na het laden van een spel: alles opnieuw. Het rooster hangt alleen van de wereld af (water, terrein, hoogte).
  laad(view) {
    this.versie = 0; this.klaar = false; this.leeg();
    this.bouwer = null; this.bouwSig = ''; this.sig = '';
    this.geo = view.geo;
    this.rooster = null;
    this.zoetBron = view.terreinLaag?.basis ? view.terreinLaag : null;
  }

  // ---- invoer ----

  // Water op een punt: 0 droog, 1 zee, 2 zoet (rivier of meer).
  waterFn(view) {
    const eig = view.eigenaar, tl = view.terreinLaag?.basis ? view.terreinLaag : null, geo = view.geo;
    if (!eig) {
      // zonder pixelraster (testnet): water per tegel
      return (x, y) => { const k = Math.floor(x / geo.T), r = Math.floor(y / geo.T); if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) return 1; return geo.tegels[r * geo.kol + k].terrein === 'water' ? 1 : 0; };
    }
    return (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= 1000 || iy >= 620) return 1;
      if (eig[iy * 1000 + ix] === -1) return 1;
      return tl && tl.isZoetWater(x, y) ? 2 : 0;
    };
  }

  hoogteFn(geo) {
    const t = geo.tegels;
    return (x, y) => {
      const u = Math.min(geo.kol - 1.001, Math.max(0, x / geo.T - 0.5)), v = Math.min(geo.rij - 1.001, Math.max(0, y / geo.T - 0.5));
      const k = Math.floor(u), r = Math.floor(v), fu = u - k, fv = v - r, i = r * geo.kol + k;
      const a = t[i].hoogte + (t[i + 1].hoogte - t[i].hoogte) * fu;
      const c = t[i + geo.kol].hoogte + (t[i + geo.kol + 1].hoogte - t[i + geo.kol].hoogte) * fu;
      return a + (c - a) * fv;
    };
  }

  // Eigenaar van een punt zoals de kaart hem tekent (grens uit het pixelraster, na verovering de nieuwe eigenaar).
  eigFn(view, eigenaar) {
    const geo = view.geo, ras = view.eigenaar;
    if (!ras) return (x, y) => { const k = Math.floor(x / geo.T), r = Math.floor(y / geo.T); if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) return -1; return eigenaar[r * geo.kol + k]; };
    return (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= 1000 || iy >= 620) return -1;
      const e = ras[iy * 1000 + ix];
      if (e === -1) return -1;
      const t = Math.floor(y / geo.T) * geo.kol + Math.floor(x / geo.T);
      const nu = eigenaar[t];
      return nu !== geo.tegels[t].eig && e >= 0 && nu >= 0 ? nu : e;
    };
  }

  // Handtekening van alles waar het net van afhangt; goedkoop genoeg voor elk beeld.
  sigVan(view) {
    const s = view.state, n = view.geo.tegels.length, inf = view.infraLaag;
    const ids = this._ids ??= new Map();
    let h = 7, g = 11;
    for (let t = 0; t < n; t++) {
      const b = s.bezet[t];
      let v = 0;
      if (b) {
        let id = 0;
        if (b.gebouw) { id = ids.get(b.gebouw); if (id === undefined) { id = ids.size + 1; ids.set(b.gebouw, id); } }
        v = (b.land + 2) * 977 + (b.hoofdstad ? 1 : b.kolonie ? 2 : id * 3 + 5);
      }
      h = (Math.imul(h, 31) + v) | 0;
      g = (Math.imul(g, 31) + s.eigenaar[t] + 3) | 0;
      if (inf?.res && inf.res[t]) g = (Math.imul(g, 17) + inf.res[t] * 41 + (inf.resLand?.[t] ?? 0)) | 0;
    }
    let vv = 0;
    for (const v of inf?.vliegvelden ?? []) vv = (Math.imul(vv, 31) + v.a * 7 + v.b) | 0;
    return `${h}|${g}|${vv}|${s.grensVersie ?? 0}|${view.terreinLaag?.basis ? 1 : 0}|${s.landen.length}`;
  }

  // Werkt binnen het budget (ms) aan het net; geeft true als het net af is en bij de toestand past.
  werk(view, budgetMs = 3) {
    if (!view.state || !view.geo) return false;
    if (view.geo !== this.geo) this.laad(view);
    const sig = this.sigVan(view);
    if (sig === this.sig && this.klaar && !this.bouwer) return true;
    if (!this.bouwer || sig !== this.bouwSig) {
      // het rooster hangt van de terreinlaag af (rivieren): opnieuw zodra die er is
      const zoet = view.terreinLaag?.basis ? view.terreinLaag : null;
      if (!this.rooster || zoet !== this.zoetBron) { this.zoetBron = zoet; this.rooster = null; }
      this.bouwSig = sig;
      this.bouwer = this.bouw(view);
    }
    const klok = typeof view.tijdMs === 'function' ? () => view.tijdMs() : null;
    const t0 = klok ? klok() : 0;
    for (;;) {
      const r = this.bouwer.next();
      if (r.done) { this.bouwer = null; this.zet(r.value); this.sig = this.bouwSig; return true; }
      if (budgetMs <= 0 || (klok && klok() - t0 >= budgetMs)) return false;
      if (!klok && budgetMs < Infinity) return false; // zonder klok: één plak per aanroep
    }
  }

  // Bouwt het net in één keer (tests).
  bouwNu(view) { this.bouwer = null; this.sig = ''; while (!this.werk(view, Infinity)); return this; }

  // ---- de bouw (generator: elke yield is een plak) ----

  *bouw(view) {
    const geo = view.geo, s = view.state, P = s.pack, T = geo.T, kol = geo.kol, rij = geo.rij, n = geo.tegels.length;
    if (!this.rooster) { this.rooster = yield* maakRooster(geo, this.waterFn(view), this.hoogteFn(geo)); yield; }
    const R = this.rooster, N = R.N, E = R.nE;
    const { eA, eB, eLen, eDir, eSoort, eT1, eT2, eKost, eLijn, nx, ny } = R;
    // momentopname van de toestand
    const eigenaar = Int16Array.from(s.eigenaar, (v) => v ?? -1);
    const eigOp = this.eigFn(view, eigenaar);
    const inf = view.infraLaag;
    const blk = new Uint8Array(n), blkLand = new Int16Array(n).fill(-1), groep = new Int32Array(n).fill(-1);
    const zoneT = new Array(n).fill(''), gebT = new Array(n).fill('');
    const zoneVan = (id) => P.gebouwIndex?.[id]?.zone ?? ZONE[id] ?? (P.gebouwIndex?.[id]?.woningen ? 'woon' : 'werk');
    for (let t = 0; t < n; t++) {
      const b = s.bezet[t];
      if (b) {
        blk[t] = 1; blkLand[t] = b.land;
        if (b.hoofdstad) { zoneT[t] = 'centrum'; gebT[t] = 'hoofdstad'; } else if (b.kolonie) { zoneT[t] = 'woon'; gebT[t] = 'kolonie'; } else { zoneT[t] = zoneVan(b.gebouw); gebT[t] = b.gebouw ?? ''; }
      } else if (inf?.res && inf.res[t] && (inf.resLand?.[t] ?? -1) >= 0) {
        blk[t] = 2; blkLand[t] = inf.resLand[t]; zoneT[t] = 'voorziening';
        gebT[t] = ['', 'station', 'vliegveld', 'haven', 'depot'][inf.res[t]] ?? 'voorziening';
      }
    }
    for (const v of inf?.vliegvelden ?? []) if (blk[v.a] && blk[v.b]) { groep[v.a] = v.a; groep[v.b] = v.a; }
    const landen = s.landen.length;
    const levend = (L) => { const h = geo.hoofdstad[L]; return h != null && h >= 0 && eigenaar[h] === L; };

    // per bouw: eigenaar per knoop en kant, net, union-find
    const nEig = new Int16Array(N);
    for (let i = 0; i < N; i++) nEig[i] = eigOp(nx[i] + 0.01, ny[i] + 0.01);
    const eEig = new Int16Array(E);
    for (let e = 0; e < E; e++) eEig[e] = eigOp((nx[eA[e]] + nx[eB[e]]) / 2 + 0.01, (ny[eA[e]] + ny[eB[e]]) / 2 + 0.01);
    yield;
    const netK = new Int8Array(E).fill(-1);
    const uf = new Int32Array(N); for (let i = 0; i < N; i++) uf[i] = i;
    const vind = (a) => { while (uf[a] !== a) { uf[a] = uf[uf[a]]; a = uf[a]; } return a; };
    const verbind = (a, b) => { a = vind(a); b = vind(b); if (a !== b) { if (a < b) uf[b] = a; else uf[a] = b; } };
    const diagGebruikt = new Int32Array(n).fill(-1);

    // steden: 8-samenhangende groepen bebouwde tegels van één land (zonder vliegvelden); die met de hoofdstad, of
    // met minstens drie tegels, krijgen een rooster
    const stad = new Int32Array(n).fill(-1), stadsdeel = new Uint8Array(n).fill(3);
    const anker = new Int32Array(landen * 2).fill(-1);
    let nStad = 0;
    {
      const gezien = new Uint8Array(n), stapel = [];
      for (let t = 0; t < n; t++) {
        if (!blk[t] || gezien[t] || groep[t] >= 0) continue;
        const L = blkLand[t], leden = [];
        gezien[t] = 1; stapel.push(t);
        while (stapel.length) {
          const u = stapel.pop(); leden.push(u);
          const k = u % kol, r = (u / kol) | 0;
          for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) {
            const kk = k + dk, rr = r + dr;
            if ((!dk && !dr) || kk < 0 || rr < 0 || kk >= kol || rr >= rij) continue;
            const w = rr * kol + kk;
            if (blk[w] && !gezien[w] && blkLand[w] === L && groep[w] < 0) { gezien[w] = 1; stapel.push(w); }
          }
        }
        const h = L >= 0 ? geo.hoofdstad[L] : -1;
        const metHoofdstad = h >= 0 && leden.includes(h) && levend(L);
        if (!metHoofdstad && leden.length < 3) continue;
        const id = nStad++;
        for (const u of leden) stad[u] = id;
        if (L >= 0 && anker[L * 2] < 0) { const a = metHoofdstad ? h : Math.min(...leden); anker[L * 2] = a % kol; anker[L * 2 + 1] = (a / kol) | 0; }
        if (metHoofdstad) { anker[L * 2] = h % kol; anker[L * 2 + 1] = (h / kol) | 0; }
      }
    }
    yield;
    // rasterlijnen per land: lijnen op beide randen van de ankertegel, verder om de twee tegels
    const isLijn = (a, k) => (k <= a ? (a - k) % 2 === 0 : (k - a - 1) % 2 === 0);
    const rasterLijn = (L, e) => {
      const l = eLijn[e];
      if (l < 0 || L < 0 || anker[L * 2] < 0) return false;
      return l >= 10000 ? isLijn(anker[L * 2], l - 10000) : isLijn(anker[L * 2 + 1], l);
    };
    // stadsdeel: 0 kern (hoofdstad en de acht tegels eromheen), 1 wijk, 2 rand (aan de buitenkant), 3 buiten
    for (let t = 0; t < n; t++) {
      if (stad[t] < 0) continue;
      const k = t % kol, r = (t / kol) | 0, L = blkLand[t], h = geo.hoofdstad[L];
      if (h >= 0 && levend(L) && Math.max(Math.abs(h % kol - k), Math.abs(((h / kol) | 0) - r)) <= 1) { stadsdeel[t] = 0; continue; }
      let rand = false;
      for (const [dk, dr] of ZN) { const kk = k + dk, rr = r + dr; if (kk < 0 || rr < 0 || kk >= kol || rr >= rij || !blk[rr * kol + kk]) rand = true; }
      stadsdeel[t] = rand ? 2 : 1;
    }
    // stadsnabij: tegels met een stadstegel in de 8-buurt (geen schuine wegen)
    const stadsnabij = new Uint8Array(n);
    for (let t = 0; t < n; t++) {
      if (stad[t] < 0 && !blk[t]) continue;
      const k = t % kol, r = (t / kol) | 0;
      for (let dr = -1; dr <= 1; dr++) for (let dk = -1; dk <= 1; dk++) { const kk = k + dk, rr = r + dr; if (kk >= 0 && rr >= 0 && kk < kol && rr < rij) stadsnabij[rr * kol + kk] = 1; }
    }

    // ---- kosten en zoeken ----
    // een stadsstraat langs een woon-, centrum- of diensttegel: daar hoort geen doorgaand verkeer
    const WOONZIJDE = { woon: 1, centrum: 1, dienst: 1 };
    const woonKant = (e) => (eT1[e] >= 0 && stad[eT1[e]] >= 0 && WOONZIJDE[zoneT[eT1[e]]] === 1) || (eT2[e] >= 0 && stad[eT2[e]] >= 0 && WOONZIJDE[zoneT[eT2[e]]] === 1);
    // los: een gebouw dat alleen via een binnenrand droog bereikbaar is mag die rand als steeg gebruiken
    let los = false;
    // natBij: een tegel die alleen over water bereikbaar is (een depot op een kustpunt, een gebouw in een vijver)
    // mag de natte randen van zichzelf en zijn buren als korte brug gebruiken
    let natBij = -1;
    const bijNat = (t) => t >= 0 && Math.abs(t % kol - natBij % kol) <= 1 && Math.abs(((t / kol) | 0) - ((natBij / kol) | 0)) <= 1;
    const verboden = (e) => {
      const so = eSoort[e];
      if (so === 1) { const t = eT1[e]; return !!blk[t] || stadsnabij[t] === 1 || (diagGebruikt[t] >= 0 && diagGebruikt[t] !== e); }
      if (so === 2) return false;
      if (R.eNat[e]) return !(natBij >= 0 && (bijNat(eT1[e]) || bijNat(eT2[e])));
      const t1 = eT1[e], t2 = eT2[e];
      if (t1 >= 0 && t2 >= 0 && blk[t1] && blk[t2]) {
        if (groep[t1] >= 0 && groep[t1] === groep[t2]) return true;
        if (!los && blkLand[t1] === blkLand[t2] && !rasterLijn(blkLand[t1], e)) return true;
      }
      return false;
    };
    const dist = new Float64Array(N), prevE = new Int32Array(N), prevD = new Int8Array(N), stamp = new Int32Array(N);
    let gen = 0;
    const HT = new Int32Array(E * 4 + 16), HK = new Float64Array(E * 4 + 16);
    let hn = 0;
    const push = (t, k) => {
      if (hn >= HT.length) return;
      let i = hn++;
      while (i > 0) { const p = (i - 1) >> 1; if (HK[p] < k || (HK[p] === k && HT[p] <= t)) break; HT[i] = HT[p]; HK[i] = HK[p]; i = p; }
      HT[i] = t; HK[i] = k;
    };
    const pop = () => {
      const t = HT[0]; hn--;
      const lt = HT[hn], lk = HK[hn];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hn) break;
        if (c + 1 < hn && (HK[c + 1] < HK[c] || (HK[c + 1] === HK[c] && HT[c + 1] < HT[c]))) c++;
        if (HK[c] > lk || (HK[c] === lk && HT[c] >= lt)) break;
        HT[i] = HT[c]; HK[i] = HK[c]; i = c;
      }
      HT[i] = lt; HK[i] = lk;
      return t;
    };
    // bronnen: [knoop, beginkosten]*; doel(knoop) → bool; geeft de eindknoop of -1
    const zoek = (bronnen, doel, land, modus, landB = -1, max = 1e9) => {
      gen++; hn = 0;
      for (let i = 0; i < bronnen.length; i += 2) {
        const b = bronnen[i];
        if (stamp[b] === gen && dist[b] <= bronnen[i + 1]) continue;
        stamp[b] = gen; dist[b] = bronnen[i + 1]; prevE[b] = -1; prevD[b] = -1; push(b, bronnen[i + 1]);
      }
      while (hn) {
        const k0 = HK[0], u = pop();
        if (k0 > dist[u] || k0 > max) continue;
        if (doel(u)) return u;
        const pd = prevD[u];
        for (let j = R.k0[u]; j < R.k0[u + 1]; j++) {
          const e = R.kant[j];
          if (e === prevE[u]) continue;
          const vooruit = eA[e] === u, v = vooruit ? eB[e] : eA[e];
          const d = vooruit ? eDir[e] : (eDir[e] + 4) & 7;
          let c;
          if (netK[e] >= 0) {
            c = eKost[e] * 0.35;
            // een stamweg door de stad volgt een as die er al ligt en mijdt woonstraten
            if (modus === STAMZOEK) { if (netK[e] >= KLASSE.HOOFD) c *= 0.6; else if (woonKant(e)) c *= 2; }
          } else {
            if (verboden(e)) continue;
            c = eKost[e];
            const o = eEig[e], lenT = eLen[e] / T;
            const grens = nEig[eA[e]] !== nEig[eB[e]];
            if (modus === LOKAAL) { if (o !== land) c += 1.5 * lenT; if (grens) c += 40; }
            else { if (o !== land && o !== landB) c += 1 * lenT; if (grens) c += 15; }
            if (eSoort[e] === 0 && ((eT1[e] >= 0 && stad[eT1[e]] >= 0) || (eT2[e] >= 0 && stad[eT2[e]] >= 0)) && !rasterLijn(blkLand[stad[eT1[e]] >= 0 ? eT1[e] : eT2[e]], e)) c += 3;
          }
          if (pd >= 0) { let df = Math.abs(d - pd); if (df > 4) df = 8 - df; c += DRAAI[df]; }
          const nd = dist[u] + c;
          if (stamp[v] !== gen || nd < dist[v]) { stamp[v] = gen; dist[v] = nd; prevE[v] = e; prevD[v] = d; push(v, nd); }
        }
      }
      return -1;
    };
    // een kant ligt in de stad als een aangrenzende tegel stad is; een oversteek (zonder tegels) als een eindpunt aan stad grenst
    const stadBijKnoop = (u) => {
      const x = nx[u] / T, y = ny[u] / T;
      for (const [dx, dy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        const k = Math.floor(x + dx * 0.98), r = Math.floor(y + dy * 0.98);
        if (k >= 0 && r >= 0 && k < kol && r < rij && stad[r * kol + k] >= 0) return true;
      }
      return false;
    };
    const stadVanKant = (e) => (eT1[e] >= 0 && stad[eT1[e]] >= 0) || (eT2[e] >= 0 && stad[eT2[e]] >= 0) || (eSoort[e] === 2 && (stadBijKnoop(eA[e]) || stadBijKnoop(eB[e])));
    // knopen waar al een weg ligt, en zijmiddens van gebouwen op een ander eiland die nog nergens op aansluiten
    const inNet = new Uint8Array(N), losWortel = new Uint8Array(N);
    const leg = (e, k) => {
      inNet[eA[e]] = 1; inNet[eB[e]] = 1;
      if (netK[e] < k) netK[e] = k;
      if (eSoort[e] === 1) diagGebruikt[eT1[e]] = e;
      verbind(eA[e], eB[e]);
    };
    const legPad = (eind, klasse, modus) => {
      const pad = [];
      for (let u = eind; prevE[u] >= 0;) { const e = prevE[u]; pad.push(e); u = eA[e] === u ? eB[e] : eA[e]; }
      for (const e of pad) {
        let k = klasse;
        if (modus === STAMZOEK && stadVanKant(e)) k = KLASSE.HOOFD;
        leg(e, k);
      }
      return pad;
    };
    // knopen van een tegelzijde die al in het net liggen
    const zijdeK = (t, z) => { const zd = zijdeVan(R, t, z); return Math.max(netK[zd.e0], netK[zd.e1]); };
    const hoofdKnoop = new Int32Array(landen).fill(-1);
    for (let L = 0; L < landen; L++) if (levend(L)) hoofdKnoop[L] = zijdeVan(R, geo.hoofdstad[L], 0).mid;

    // ---- 1. stadsroosters ----
    const WERKBLOK = { werk: 1, logistiek: 1, energie: 1, delf: 1 };
    // Steekt de zijde z van tegel t het water netjes over? Beide hoeken droog, één natte strook van hooguit 0,6 T, en
    // midden in die strook water aan beide kanten van de weg (een beek die eronderdoor loopt, geen oever).
    const waterOp = this.waterFn(view), brugMemo = new Map();
    const brugOk = (t, z) => {
      const zd = zijdeVan(R, t, z), sleutel = zd.mid;
      if (brugMemo.has(sleutel)) return brugMemo.get(sleutel);
      const a = eA[zd.e0], b = eB[zd.e1], ax = nx[a], ay = ny[a], bx = nx[b], by = ny[b];
      const M = 32;
      let eerste = -1, laatste = -1, stroken = 0, vorigNat = false;
      for (let i = 0; i <= M; i++) {
        const nat = waterOp(ax + (bx - ax) * i / M, ay + (by - ay) * i / M) !== 0;
        if (nat) { if (!vorigNat) stroken++; if (eerste < 0) eerste = i; laatste = i; }
        vorigNat = nat;
      }
      let ok = eerste > 0 && laatste < M && stroken === 1 && (laatste - eerste + 1) / M <= 0.6;
      if (ok) ok = steektOver(waterOp, ax, ay, bx, by, eerste / M, laatste / M, T);
      // en de halve randen zelf schampen geen oever (zelfde maat als de bruggen buiten de stad)
      if (ok && ((R.eNat[zd.e0] && R.schamp[zd.e0]) || (R.eNat[zd.e1] && R.schamp[zd.e1]))) ok = false;
      brugMemo.set(sleutel, ok);
      return ok;
    };
    const overgeslagen = [], natOvergeslagen = [];
    for (let L = 0; L < landen; L++) {
      const h = levend(L) ? geo.hoofdstad[L] : -1;
      for (let t = 0; t < n; t++) {
        if (stad[t] < 0 || blkLand[t] !== L) continue;
        const hfd = h === t;
        for (let z = 0; z < 4; z++) {
          const zd = zijdeVan(R, t, z);
          // grotere bedrijfsblokken: een rasterstraat tussen twee werktegels mag wegvallen
          const [dk, dr] = ZN[z], kk = t % kol + dk, rr = ((t / kol) | 0) + dr, w = kk >= 0 && rr >= 0 && kk < kol && rr < rij ? rr * kol + kk : -1;
          const blok = w >= 0 && !hfd && w !== h && blkLand[w] === L && WERKBLOK[zoneT[t]] && WERKBLOK[zoneT[w]] && hash(Math.min(t, w), Math.max(t, w), 41) < 0.35;
          for (const e of [zd.e0, zd.e1]) {
            if (!rasterLijn(L, e)) continue;
            // een rasterlijn tussen twee tegels van één vliegveld blijft dicht
            if (eT1[e] >= 0 && eT2[e] >= 0 && groep[eT1[e]] >= 0 && groep[eT1[e]] === groep[eT2[e]]) continue;
            if (blok) { overgeslagen.push(t, z); continue; }
            // over een beek of vijver in de stad: de rasterstraat loopt alleen als brug door waar hij het water echt
            // oversteekt (niet over zee, niet langs een oever of door een hoek van een meer); de hoofdstad houdt zijn
            // vier zijden altijd
            if (R.eNat[e] & 1) continue;
            if (R.eNat[e] && !hfd && !brugOk(t, z)) { natOvergeslagen.push(t, e); continue; }
            leg(e, hfd ? KLASSE.HOOFD : KLASSE.STRAAT);
          }
        }
      }
      // een tegel zonder enige straatzijde krijgt zijn weggevallen rasterstraten terug
      for (let i = 0; i < overgeslagen.length; i += 2) {
        const t = overgeslagen[i];
        let heeft = false;
        for (let z = 0; z < 4; z++) if (zijdeK(t, z) >= 0) heeft = true;
        if (heeft) continue;
        for (let j = i; j < overgeslagen.length; j += 2) if (overgeslagen[j] === t) { const zd = zijdeVan(R, t, overgeslagen[j + 1]); for (const e of [zd.e0, zd.e1]) { if ((R.eNat[e] & 1) || !rasterLijn(L, e)) continue; if (R.eNat[e] && R.schamp[e]) natOvergeslagen.push(t, e); else leg(e, KLASSE.STRAAT); } }
      }
      overgeslagen.length = 0;
      // en een tegel die dan nog geen straat heeft (rondom beekjes) krijgt er één natte halve rasterstraat bij, als
      // brug: de goedkoopste (het minst water, liefst een echte oversteek); één halve rand is genoeg voor een poort
      for (let i = 0; i < natOvergeslagen.length; i += 2) {
        const t = natOvergeslagen[i];
        let heeft = false;
        for (let z = 0; z < 4; z++) if (zijdeK(t, z) >= 0) heeft = true;
        if (heeft) continue;
        let beste = -1;
        for (let j = i; j < natOvergeslagen.length; j += 2) if (natOvergeslagen[j] === t) { const e = natOvergeslagen[j + 1]; if (beste < 0 || eKost[e] < eKost[beste] || (eKost[e] === eKost[beste] && e < beste)) beste = e; }
        if (beste >= 0) leg(beste, KLASSE.STRAAT);
      }
      natOvergeslagen.length = 0;
      // losse stukken van de stad aan de hoofdstad (of het eerste stadsstuk) knopen
      let wortel = hoofdKnoop[L];
      for (let t = 0; t < n; t++) {
        if (stad[t] < 0 || blkLand[t] !== L) continue;
        const bronnen = [];
        for (let z = 0; z < 4; z++) { const zd = zijdeVan(R, t, z); if (netK[zd.e0] >= 0 || netK[zd.e1] >= 0) bronnen.push(zd.mid, 0); }
        if (!bronnen.length) continue;
        if (wortel < 0) { wortel = bronnen[0]; continue; }
        if (vind(bronnen[0]) === vind(wortel)) continue;
        const w = vind(wortel);
        let eind = zoek(bronnen, (u) => vind(u) === w, L, LOKAAL);
        // ingesloten door beekjes en kavels: dan mag het over een binnenrand of een korte brug
        if (eind < 0) { los = true; natBij = t; eind = zoek(bronnen, (u) => vind(u) === w, L, LOKAAL); los = false; natBij = -1; }
        if (eind >= 0) legPad(eind, KLASSE.STRAAT, LOKAAL);
        yield;
      }
      if (hoofdKnoop[L] < 0 && wortel >= 0) hoofdKnoop[L] = wortel;
    }
    yield;

    // ---- 2. voorzieningen en losse gebouwen ----
    const tePoorten = [];
    const voorziening = (t) => blk[t] === 2;
    for (let L = 0; L < landen; L++) {
      const wortel = hoofdKnoop[L];
      // eerst de voorzieningen (station, vliegveld, havens, depots), dan de rest, elk op tegelvolgorde
      const lijst = [];
      for (let t = 0; t < n; t++) if (blk[t] && blkLand[t] === L && voorziening(t)) lijst.push(t);
      for (let t = 0; t < n; t++) if (blk[t] && blkLand[t] === L && !voorziening(t)) lijst.push(t);
      for (const t of lijst) {
        if (groep[t] >= 0 && groep[t] !== t) continue; // vliegveld: één poort, op de eerste tegel
        if (wortel < 0) continue;
        // al aangesloten: een zijde met straat die bij het net van de hoofdstad hoort
        let heeft = false;
        for (let z = 0; z < 4; z++) if (zijdeK(t, z) >= 0 && vind(zijdeVan(R, t, z).mid) === vind(wortel)) heeft = true;
        if (heeft) continue;
        const bronnen = [];
        for (let z = 0; z < 4; z++) {
          const zd = zijdeVan(R, t, z);
          if (R.eNat[zd.e0] && R.eNat[zd.e1]) continue;
          // niet aan de kant van de andere vliegveldtegel
          const [dk, dr] = ZN[z], k = t % kol + dk, r = ((t / kol) | 0) + dr, w = k >= 0 && r >= 0 && k < kol && r < rij ? r * kol + k : -1;
          if (w >= 0 && groep[t] >= 0 && groep[w] === groep[t]) continue;
          bronnen.push(zd.mid, hash(t, z, 3) * 0.05);
        }
        const w = vind(wortel);
        const klasse = stad[t] >= 0 ? KLASSE.STRAAT : voorziening(t) && gebT[t] !== 'depot' ? KLASSE.HOOFD : KLASSE.ERF;
        let eind = zoek(bronnen, (u) => vind(u) === w, L, LOKAAL);
        if (eind < 0) { los = true; eind = zoek(bronnen, (u) => vind(u) === w, L, LOKAAL); los = false; }
        if (eind < 0) {
          natBij = t; los = true;
          const alle = [];
          for (let z = 0; z < 4; z++) alle.push(zijdeVan(R, t, z).mid, hash(t, z, 3) * 0.05);
          eind = zoek(alle, (u) => vind(u) === w, L, LOKAAL);
          natBij = -1; los = false;
        }
        if (eind >= 0) legPad(eind, klasse, LOKAAL);
        else {
          // geen weg naar de hoofdstad (een ander eiland zonder brug): aansluiten op wat daar al ligt, zodat de
          // gebouwen op dat eiland samen één los net vormen in plaats van elk een oprit naar nergens
          natBij = t; los = true;
          const alle = [];
          for (let z = 0; z < 4; z++) alle.push(zijdeVan(R, t, z).mid, hash(t, z, 3) * 0.05);
          eind = zoek(alle, (u) => inNet[u] === 1 || losWortel[u] === 1, L, LOKAAL);
          natBij = -1; los = false;
          if (eind >= 0) legPad(eind, klasse === KLASSE.HOOFD ? KLASSE.STRAAT : klasse, LOKAAL);
          else for (let z = 0; z < 4; z++) { const zd = zijdeVan(R, t, z); if (!(R.eNat[zd.e0] && R.eNat[zd.e1])) losWortel[zd.mid] = 1; }
        }
        yield;
      }
    }

    // ---- 3. stamwegen ----
    const paren = [];
    const idxVan = geo.idxVan ?? {};
    const routes = P.kaart?.handelsroutes ?? [];
    if (routes.length) {
      for (const [a, b] of routes) { const ia = idxVan[a], ib = idxVan[b]; if (ia != null && ib != null && ia !== ib) paren.push([ia, ib]); }
    } else {
      const buur = new Set();
      for (let t = 0; t < n; t++) {
        const a = eigenaar[t]; if (a < 0) continue;
        const k = t % kol, r = (t / kol) | 0;
        for (const [dk, dr] of [[1, 0], [0, 1]]) {
          const kk = k + dk, rr = r + dr; if (kk >= kol || rr >= rij) continue;
          const b = eigenaar[rr * kol + kk];
          if (b >= 0 && b !== a) buur.add(Math.min(a, b) * 1000 + Math.max(a, b));
        }
      }
      for (const v of [...buur].sort((x, y) => x - y)) paren.push([Math.floor(v / 1000), v % 1000]);
      // geen buren: een boom over de hoofdsteden, kortste afstand eerst
      if (!paren.length) {
        // eilanden: droge tegels die via een zijde aan elkaar liggen
        const eiland = new Int32Array(n).fill(-1);
        for (let t0 = 0, id = 0; t0 < n; t0++) {
          if (eiland[t0] >= 0 || geo.tegels[t0].terrein === 'water') continue;
          const rij0 = [t0]; eiland[t0] = id;
          while (rij0.length) {
            const t = rij0.pop(), k = t % kol, r = (t / kol) | 0;
            for (const [dk, dr] of ZN) { const kk = k + dk, rr = r + dr, w = rr * kol + kk; if (kk >= 0 && rr >= 0 && kk < kol && rr < rij && eiland[w] < 0 && geo.tegels[w].terrein !== 'water') { eiland[w] = id; rij0.push(w); } }
          }
          id++;
        }
        const kand = [];
        for (let a = 0; a < landen; a++) for (let b = a + 1; b < landen; b++) {
          const ha = geo.hoofdstad[a], hb = geo.hoofdstad[b];
          if (ha == null || hb == null || ha < 0 || hb < 0 || eiland[ha] !== eiland[hb]) continue;
          kand.push([Math.hypot(ha % kol - hb % kol, ((ha / kol) | 0) - ((hb / kol) | 0)), a, b]);
        }
        kand.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
        const ouder = Array.from({ length: landen }, (_, i) => i);
        const wortelL = (i) => { while (ouder[i] !== i) i = ouder[i] = ouder[ouder[i]]; return i; };
        for (const [, a, b] of kand) { const ra = wortelL(a), rb = wortelL(b); if (ra !== rb) { ouder[ra] = rb; paren.push([a, b]); } }
      }
    }
    const stamPaden = [], stamPogingen = [];
    for (const [a, b] of paren) {
      if (!levend(a) || !levend(b)) continue;
      const ha = geo.hoofdstad[a], hb = geo.hoofdstad[b];
      const bronnen = []; for (let z = 0; z < 4; z++) bronnen.push(zijdeVan(R, ha, z).mid, 0);
      const doelen = new Set(); for (let z = 0; z < 4; z++) doelen.add(zijdeVan(R, hb, z).mid);
      const eind = zoek(bronnen, (u) => doelen.has(u), a, STAMZOEK, b);
      if (eind >= 0) stamPaden.push({ a, b, pad: legPad(eind, KLASSE.STAM, STAMZOEK) });
      stamPogingen.push({ a, b, gelukt: eind >= 0 });
      yield;
    }

    // De zijde waar de poort van tegel t komt (-1 = geen): gebruikt voor de hoofdwegen (stap 4) en de poorten (stap 5),
    // zodat de hoofdweg naar een station, vliegveld of haven uitkomt op de zijde waar de poort echt komt.
    const poortZijde = (t) => {
      let beste = -1, bk = -2;
      const start = Math.floor(hash(t, 77) * 4);
      for (let i = 0; i < 4; i++) {
        const z = (start + i) & 3;
        const [dk, dr] = ZN[z], k = t % kol + dk, r = ((t / kol) | 0) + dr, w = k >= 0 && r >= 0 && k < kol && r < rij ? r * kol + k : -1;
        if (w >= 0 && groep[t] >= 0 && groep[w] === groep[t]) continue;
        const zd = zijdeVan(R, t, z);
        if (R.eNat[zd.e0] && R.eNat[zd.e1] && netK[zd.e0] < 0 && netK[zd.e1] < 0) continue;
        // eerst een zijde die echt aan het net van het eigen land vastzit, dan de hoogste klasse
        const kz = Math.max(netK[zd.e0], netK[zd.e1]);
        const wortel = blkLand[t] >= 0 ? hoofdKnoop[blkLand[t]] : -1;
        const vast = kz >= 0 && wortel >= 0 && vind(zd.mid) === vind(wortel) ? 10 : 0;
        // een doorgaande straat (beide helften) gaat voor een stompje tussen twee gebouwen
        const door = netK[zd.e0] >= 0 && netK[zd.e1] >= 0 ? 4 : 0;
        if (kz + vast + door > bk) { bk = kz + vast + door; beste = z; }
      }
      return beste;
    };

    // ---- 4. hoofdwegen van de hoofdstad naar voorzieningen, mijnen en grensovergangen ----
    // Een boom van doorgaande assen, geen bundel van kortste paden: elk doel (verste eerst) zoekt over wat er ligt de
    // dichtstbijzijnde weg die al HOOFD of STAM is en vastzit aan de hoofdstad. Bestaande hoofdwegen kosten weinig,
    // straten langs woon-, centrum- en diensttegels veel, en elke afslag kost iets: zo blijft de hoofdweg één rechte as
    // en worden woonstraten geen doorgaande route.
    const hoofdNet = new Uint8Array(N); // knopen op het HOOFD/STAM-net van een hoofdstad
    const zoekNet = (bron, doel) => {
      gen++; hn = 0;
      stamp[bron] = gen; dist[bron] = 0; prevE[bron] = -1; prevD[bron] = -1; push(bron, 0);
      while (hn) {
        const k0 = HK[0], u = pop();
        if (k0 > dist[u]) continue;
        if (doel(u)) return u;
        const pd = prevD[u];
        for (let j = R.k0[u]; j < R.k0[u + 1]; j++) {
          const e = R.kant[j];
          if (netK[e] < 0 || e === prevE[u]) continue;
          const vooruit = eA[e] === u, v = vooruit ? eB[e] : eA[e];
          const d = vooruit ? eDir[e] : (eDir[e] + 4) & 7;
          let c = eLen[e] / T / SNELHEID[netK[e]];
          if (netK[e] >= KLASSE.HOOFD) c *= 0.3;
          else if (woonKant(e)) c *= 2.2;
          if (pd >= 0) { let df = Math.abs(d - pd); if (df > 4) df = 8 - df; c += DRAAI[df] * 0.6; }
          const nd = dist[u] + c;
          if (stamp[v] !== gen || nd < dist[v]) { stamp[v] = gen; dist[v] = nd; prevE[v] = e; prevD[v] = d; push(v, nd); }
        }
      }
      return -1;
    };
    // het HOOFD/STAM-net dat aan knoop w vastzit (over takken van klasse HOOFD of hoger)
    const markeerHoofd = (w) => {
      const st = [w]; hoofdNet[w] = 1;
      while (st.length) {
        const u = st.pop();
        for (let j = R.k0[u]; j < R.k0[u + 1]; j++) {
          const e = R.kant[j];
          if (netK[e] < KLASSE.HOOFD || netK[e] === KLASSE.OPRIT) continue;
          const v = eA[e] === u ? eB[e] : eA[e];
          if (!hoofdNet[v]) { hoofdNet[v] = 1; st.push(v); }
        }
      }
    };
    // grensknopen van de stamwegen
    const grensKnoop = [];
    const hoofdDoelen = []; // tegels die een hoofdweg naar de as krijgen (alle landen, op bouwvolgorde)
    for (const sp of stamPaden) for (const e of sp.pad) if (nEig[eA[e]] !== nEig[eB[e]] && nEig[eA[e]] >= 0 && nEig[eB[e]] >= 0) grensKnoop.push(nEig[eA[e]], eA[e], nEig[eB[e]], eB[e]);
    for (let L = 0; L < landen; L++) {
      if (hoofdKnoop[L] < 0 || !levend(L)) continue;
      markeerHoofd(hoofdKnoop[L]);
      const doelen = [];
      for (let t = 0; t < n; t++) {
        if (!blk[t] || blkLand[t] !== L) continue;
        // een mijn in de stad krijgt geen eigen hoofdweg: het verkeer neemt de straat naar de as; een station,
        // vliegveld of haven (ook het havengebouw) houdt altijd zijn hoofdweg naar de as (daar komt het vrachtverkeer)
        const buiten = stad[t] < 0 || gebT[t] === 'station' || gebT[t] === 'vliegveld' || gebT[t] === 'haven';
        if (voorziening(t) && gebT[t] !== 'depot' && (groep[t] < 0 || groep[t] === t) && buiten) doelen.push(t);
        else if (zoneT[t] === 'delf' && buiten) doelen.push(t);
        else if (zoneT[t] === 'haven' && !voorziening(t)) doelen.push(t);
      }
      const knopen = [];
      for (const t of doelen) hoofdDoelen.push(t);
      for (const t of doelen) { const z = poortZijde(t); if (z < 0) continue; const zd = zijdeVan(R, t, z); if (netK[zd.e0] >= 0 || netK[zd.e1] >= 0) knopen.push(zd.mid); }
      for (let i = 0; i < grensKnoop.length; i += 2) if (grensKnoop[i] === L) knopen.push(grensKnoop[i + 1]);
      // verste eerst (vaste volgorde bij gelijke afstand): de lange as ligt er, de rest takt erop aan
      const hx = nx[hoofdKnoop[L]], hy = ny[hoofdKnoop[L]];
      const volg = knopen.map((kn) => [Math.hypot(nx[kn] - hx, ny[kn] - hy), kn]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      for (const [, kn] of volg) {
        if (hoofdNet[kn]) continue;
        const eind = zoekNet(kn, (u) => hoofdNet[u] === 1);
        if (eind < 0) continue;
        for (let u = eind; prevE[u] >= 0;) { const e = prevE[u]; if (netK[e] < KLASSE.HOOFD) netK[e] = KLASSE.HOOFD; u = eA[e] === u ? eB[e] : eA[e]; }
        markeerHoofd(eind);
      }
      yield;
    }

    // ---- 5. poorten ----
    const poortZ = new Int8Array(n).fill(-1);
    const beschermd = new Uint16Array(N); // aantal poorten op deze knoop
    for (let t = 0; t < n; t++) {
      if (!blk[t]) continue;
      if (groep[t] >= 0 && groep[t] !== t) continue;
      const beste = poortZijde(t);
      if (beste < 0) continue;
      poortZ[t] = beste;
      beschermd[zijdeVan(R, t, beste).mid]++;
    }
    yield;

    // ---- 6. doodlopende stukken weghalen ----
    // Een brug (oversteek) over halve randen die zelf al in het net liggen, is dezelfde weg twee keer: de randen
    // houden de hoogste klasse, de dubbele brug verdwijnt. Ligt maar een deel van de randen erin, dan worden het
    // allemaal randen (zelfde lijn, zelfde brug), anders liepen er twee wegen naast elkaar uit één knoop.
    for (let e = R.nHalf; e < E; e++) {
      if (eSoort[e] !== 2 || netK[e] < 0) continue;
      const dek = R.dekVan[e] ?? [];
      if (!dek.length || dek.every((h) => netK[h] < 0)) continue;
      for (const h of dek) if (netK[h] < netK[e]) netK[h] = netK[e];
      netK[e] = -1;
    }
    const deg = new Int32Array(N);
    for (let e = 0; e < E; e++) if (netK[e] >= 0) { deg[eA[e]]++; deg[eB[e]]++; }
    const snoei = (rij1) => {
      while (rij1.length) {
        const u = rij1.pop();
        if (deg[u] !== 1 || beschermd[u]) continue;
        for (let j = R.k0[u]; j < R.k0[u + 1]; j++) {
          const e = R.kant[j];
          if (netK[e] < 0) continue;
          netK[e] = -1; deg[u]--;
          const v = eA[e] === u ? eB[e] : eA[e];
          deg[v]--;
          if (deg[v] === 1 && !beschermd[v]) rij1.push(v);
          break;
        }
      }
    };
    {
      const rij1 = [];
      for (let u = 0; u < N; u++) if (deg[u] === 1 && !beschermd[u]) rij1.push(u);
      snoei(rij1);
    }
    // Een poort aan het eind van een stompje, terwijl de tegel ook aan een doorgaande straat ligt: de poort gaat naar
    // die straat en het stompje verdwijnt (geen straatje tussen twee gebouwen voor een poort die het niet nodig heeft).
    for (let t = 0; t < n; t++) {
      const z0 = poortZ[t];
      if (z0 < 0) continue;
      const oud = zijdeVan(R, t, z0).mid;
      if (deg[oud] !== 1) continue;
      let beste = -1, bk = -1;
      for (let z = 0; z < 4; z++) {
        if (z === z0) continue;
        const [dk, dr] = ZN[z], k = t % kol + dk, r = ((t / kol) | 0) + dr, w = k >= 0 && r >= 0 && k < kol && r < rij ? r * kol + k : -1;
        if (w >= 0 && groep[t] >= 0 && groep[w] === groep[t]) continue;
        const zd = zijdeVan(R, t, z);
        if (netK[zd.e0] < 0 || netK[zd.e1] < 0 || netK[zd.e0] === KLASSE.STAM || deg[zd.mid] < 2) continue;
        const kz = Math.max(netK[zd.e0], netK[zd.e1]);
        if (kz > bk) { bk = kz; beste = z; }
      }
      if (beste < 0) continue;
      poortZ[t] = beste;
      beschermd[zijdeVan(R, t, beste).mid]++;
      if (--beschermd[oud] === 0) snoei([oud]);
    }
    // De poort van een station, vliegveld, haven of mijn kan na het snoeien en verhuizen een halve tegel naast zijn
    // hoofdweg liggen (het stompje waar de hoofdweg op uitkwam is weg): de hoofdweg loopt door tot de poort zelf.
    {
      const aanHoofd = (u) => { for (let j = R.k0[u]; j < R.k0[u + 1]; j++) { const k = netK[R.kant[j]]; if (k === KLASSE.HOOFD || k === KLASSE.STAM) return true; } return false; };
      for (const t of hoofdDoelen) {
        if (poortZ[t] < 0) continue;
        const kn = zijdeVan(R, t, poortZ[t]).mid;
        if (aanHoofd(kn)) continue;
        const eind = zoekNet(kn, (u) => hoofdNet[u] === 1 && aanHoofd(u));
        if (eind < 0) continue;
        for (let u = eind; prevE[u] >= 0;) { const e = prevE[u]; if (netK[e] < KLASSE.HOOFD) netK[e] = KLASSE.HOOFD; u = eA[e] === u ? eB[e] : eA[e]; }
        markeerHoofd(eind);
      }
    }
    // Wat dan nog doodloopt op een poort in de stad (de enige toegang tot een kavel) is geen straat maar een smalle
    // erfweg: hooguit één tegel lang, van de laatste kruising tot de poort.
    for (let u = 0; u < N; u++) {
      if (!beschermd[u] || deg[u] !== 1) continue;
      const keten = [];
      let w = u, vorige = -1, lengte = 0, ok = false;
      for (let stap = 0; stap < 8; stap++) {
        let e = -1;
        for (let j = R.k0[w]; j < R.k0[w + 1]; j++) { const f = R.kant[j]; if (netK[f] >= 0 && f !== vorige) { e = f; break; } }
        if (e < 0 || netK[e] !== KLASSE.STRAAT || !stadVanKant(e)) break;
        keten.push(e); lengte += eLen[e]; vorige = e;
        w = eA[e] === w ? eB[e] : eA[e];
        if (lengte > 1.01 * T) break;
        if (deg[w] >= 3) { ok = true; break; }
        if (deg[w] !== 2) break;
      }
      if (ok) for (const e of keten) netK[e] = KLASSE.ERF;
    }
    // ---- 7. samenvatten tot knopen en takken ----
    const D = yield* this.vat(view, { R, netK, deg, beschermd, poortZ, blk, blkLand, groep, stad, stadsdeel, stadsnabij, zoneT, gebT, eigOp, eigenaar, nEig, levend, water: this.waterFn(view) });
    yield;
    D.stamwegen = stamPogingen;
    D.stamParen = paren.length;
    yield* this.verrijk(view, D);
    return D;
  }

  // Rooster → knopen en takken.
  *vat(view, b) {
    const geo = view.geo, T = geo.T, kol = geo.kol, rij = geo.rij, n = geo.tegels.length;
    const { R, netK, deg, beschermd, poortZ, blk, stadsnabij, eigOp } = b;
    const { eA, eB, eSoort, eBouw, nx, ny, N, nE: E } = R;
    // eindknopen: graad ≠ 2, poorten, of een wissel van klasse of bouwsoort
    const kIdx = new Int32Array(N).fill(-1);
    const kx = [], ky = [], kSoort = [], kRooster = [];
    const kantenVan = (u) => { const r = []; for (let j = R.k0[u]; j < R.k0[u + 1]; j++) { const e = R.kant[j]; if (netK[e] >= 0) r.push(e); } return r; };
    const maakKnoop = (u, soort) => { kIdx[u] = kx.length; kx.push(nx[u]); ky.push(ny[u]); kSoort.push(soort); kRooster.push(u); return kIdx[u]; };
    for (let u = 0; u < N; u++) {
      if (!deg[u]) { if (beschermd[u]) maakKnoop(u, KNOOP.POORT); continue; }
      if (beschermd[u]) { maakKnoop(u, KNOOP.POORT); continue; }
      if (deg[u] !== 2) { maakKnoop(u, deg[u] === 1 ? KNOOP.EIND : KNOOP.KRUIS); continue; }
      const [e1, e2] = kantenVan(u);
      if (netK[e1] !== netK[e2] || eBouw[e1] !== eBouw[e2]) maakKnoop(u, KNOOP.KRUIS);
    }
    // takken langs de kettingen
    const gedaan = new Uint8Array(E);
    const takken = [];
    const volg = (start, e0) => {
      const knopen = [start], kanten = [];
      let u = start, e = e0;
      for (;;) {
        gedaan[e] = 1; kanten.push(e);
        const v = eA[e] === u ? eB[e] : eA[e];
        knopen.push(v);
        if (kIdx[v] >= 0) break;
        let volgende = -1;
        for (let j = R.k0[v]; j < R.k0[v + 1]; j++) { const f = R.kant[j]; if (netK[f] >= 0 && f !== e) { volgende = f; break; } }
        if (volgende < 0 || gedaan[volgende]) { if (kIdx[v] < 0) maakKnoop(v, KNOOP.KRUIS); break; }
        u = v; e = volgende;
      }
      takken.push({ knopen, kanten, klasse: netK[e0], bouw: eBouw[e0] });
    };
    for (let i = 0; i < kx.length; i++) {
      const u = kRooster[i];
      for (let j = R.k0[u]; j < R.k0[u + 1]; j++) { const e = R.kant[j]; if (netK[e] >= 0 && !gedaan[e]) volg(u, e); }
    }
    // ringen zonder eindknoop
    for (let e = 0; e < E; e++) if (netK[e] >= 0 && !gedaan[e]) { maakKnoop(eA[e], KNOOP.KRUIS); volg(eA[e], e); }
    yield;

    // opritten: van de poort loodrecht de kavel in, met het dock aan het eind
    const poortVanT = new Int32Array(n).fill(-1);
    const poorten = [];
    const opritTak = [];
    for (let t = 0; t < n; t++) {
      if (poortZ[t] < 0) continue;
      const z = poortZ[t], zd = zijdeVan(R, t, z), pk = kIdx[zd.mid];
      const [ox, oy] = ZN[z], x = nx[zd.mid], y = ny[zd.mid];
      const dx = x - ox * OPRIT * T, dy = y - oy * OPRIT * T;
      const dk = kx.length; kx.push(dx); ky.push(dy); kSoort.push(KNOOP.DOCK); kRooster.push(-1);
      if (deg[zd.mid] === 0) kSoort[pk] = KNOOP.EIND;
      opritTak.push({ t, a: pk, b: dk, x, y, dx, dy, z });
    }

    // knoopsoort eind/kruis opnieuw na de opritten (een poort zonder weg is een eind)
    const nK = kx.length;
    const D = {
      nK, kx: Float32Array.from(kx), ky: Float32Array.from(ky), kSoort: Uint8Array.from(kSoort), kLand: new Int16Array(nK), kLicht: new Int16Array(nK).fill(-1),
      kRooster: Int32Array.from(kRooster), kIdx,
    };
    for (let i = 0; i < nK; i++) D.kLand[i] = eigOp(D.kx[i] + 0.01, D.ky[i] + 0.01);
    // polylijnen met afgeronde hoeken
    const nT = takken.length + opritTak.length;
    const tA = new Int32Array(nT), tB = new Int32Array(nT), tKlasse = new Uint8Array(nT), tLand = new Int16Array(nT), tLen = new Float32Array(nT);
    const tP0 = new Int32Array(nT), tNP = new Uint16Array(nT), tZaad = new Uint32Array(nT), tBouw = new Uint8Array(nT), tBox = new Float32Array(nT * 4);
    const px = [], py = [], pc = [];
    const kantTak = new Int32Array(E).fill(-1);
    const hoekBlok = (u) => {
      // is roosterknoop u een hoek of rand van een bebouwde tegel of ligt hij bij de stad? dan een krappe bocht
      const x = nx[u], y = ny[u];
      for (const [ddx, ddy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        const k = Math.floor(x / T + ddx * 0.5), r = Math.floor(y / T + ddy * 0.5);
        if (k < 0 || r < 0 || k >= kol || r >= rij) continue;
        const t = r * kol + k;
        if (blk[t] || stadsnabij[t]) return true;
      }
      return false;
    };
    const lijnPunten = (knopen) => {
      // alleen de punten waar de richting verandert
      const v = [knopen[0]];
      for (let i = 1; i < knopen.length - 1; i++) {
        const a = v[v.length - 1], m = knopen[i], c = knopen[i + 1];
        const ax = nx[m] - nx[a], ay = ny[m] - ny[a], bx = nx[c] - nx[m], by = ny[c] - ny[m];
        if (Math.abs(ax * by - ay * bx) > 1e-6 * (Math.abs(ax) + Math.abs(ay)) * (Math.abs(bx) + Math.abs(by))) v.push(m);
      }
      v.push(knopen[knopen.length - 1]);
      return v;
    };
    const schrijf = (i, xs, ys, a, bb, klasse, bouw) => {
      tA[i] = a; tB[i] = bb; tKlasse[i] = klasse; tBouw[i] = bouw;
      tP0[i] = px.length; tNP[i] = xs.length;
      let s = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let j = 0; j < xs.length; j++) {
        if (j) s += Math.hypot(xs[j] - xs[j - 1], ys[j] - ys[j - 1]);
        px.push(xs[j]); py.push(ys[j]); pc.push(s);
        if (xs[j] < x0) x0 = xs[j]; if (xs[j] > x1) x1 = xs[j]; if (ys[j] < y0) y0 = ys[j]; if (ys[j] > y1) y1 = ys[j];
      }
      tLen[i] = s; tBox[i * 4] = x0; tBox[i * 4 + 1] = y0; tBox[i * 4 + 2] = x1; tBox[i * 4 + 3] = y1;
      // zaad uit de ligging (niet uit knoopnummers): een nieuw gebouw elders verandert het zaad van deze tak niet
      const l = xs.length - 1, ha = Math.round(xs[0] * 4) * 7919 + Math.round(ys[0] * 4), hb = Math.round(xs[l] * 4) * 7919 + Math.round(ys[l] * 4);
      tZaad[i] = Math.floor(hash(Math.min(ha, hb), Math.max(ha, hb), klasse + 1) * 4294967296) >>> 0;
    };
    for (let i = 0; i < takken.length; i++) {
      const tk = takken[i];
      for (const e of tk.kanten) kantTak[e] = i;
      const v = lijnPunten(tk.knopen);
      const xs = [nx[v[0]]], ys = [ny[v[0]]];
      for (let j = 1; j < v.length - 1; j++) {
        const a = v[j - 1], m = v[j], c = v[j + 1];
        let d1x = nx[m] - nx[a], d1y = ny[m] - ny[a], d2x = nx[c] - nx[m], d2y = ny[c] - ny[m];
        const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
        d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
        const th = Math.acos(clamp(d1x * d2x + d1y * d2y, -1, 1));
        let r = (hoekBlok(m) ? 0.06 : 0.15 + 0.1 * hash(m, 5)) * T;
        let Lt = r * Math.tan(th / 2);
        const maxL = Math.min(l1, l2) * 0.5;
        if (Lt > maxL) { Lt = maxL; r = Lt / Math.tan(th / 2); }
        if (th < 1e-3 || Lt < 1e-3) { xs.push(nx[m]); ys.push(ny[m]); continue; }
        const sx = nx[m] - d1x * Lt, sy = ny[m] - d1y * Lt;
        const kr = d1x * d2y - d1y * d2x > 0 ? 1 : -1;
        const cx = sx - d1y * kr * r, cy = sy + d1x * kr * r;
        const a0 = Math.atan2(sy - cy, sx - cx), stappen = Math.max(2, Math.ceil(th / (Math.PI / 10)));
        for (let q = 0; q <= stappen; q++) { const a1 = a0 + kr * th * (q / stappen); xs.push(cx + Math.cos(a1) * r); ys.push(cy + Math.sin(a1) * r); }
      }
      xs.push(nx[v[v.length - 1]]); ys.push(ny[v[v.length - 1]]);
      schrijf(i, xs, ys, kIdx[tk.knopen[0]], kIdx[tk.knopen[tk.knopen.length - 1]], tk.klasse, tk.bouw);
    }
    for (let j = 0; j < opritTak.length; j++) {
      const o = opritTak[j], i = takken.length + j;
      // een oprit over water is een steiger: zee 2, zoet 1
      let nat = 0;
      for (let q = 0; q <= 6; q++) { const w = b.water(o.x + (o.dx - o.x) * q / 6, o.y + (o.dy - o.y) * q / 6); if (w) nat |= w === 1 ? 1 : 2; }
      schrijf(i, [o.x, o.dx], [o.y, o.dy], o.a, o.b, KLASSE.OPRIT, nat & 1 ? 2 : nat ? 1 : 0);
      o.tak = i;
    }
    D.nT = nT; Object.assign(D, { tA, tB, tKlasse, tLand, tLen, tP0, tNP, tZaad, tBouw, tBox });
    D.punten = new Float32Array(px.length * 2);
    for (let j = 0; j < px.length; j++) { D.punten[j * 2] = px[j]; D.punten[j * 2 + 1] = py[j]; }
    D.cum = Float32Array.from(pc);
    D.kantTak = kantTak;
    // land van een tak: de eigenaar halverwege
    for (let i = 0; i < nT; i++) {
      const h = tLen[i] / 2, p0 = tP0[i];
      let j = 0; while (j < tNP[i] - 2 && D.cum[p0 + j + 1] < h) j++;
      const ax = D.punten[(p0 + j) * 2], ay = D.punten[(p0 + j) * 2 + 1], bx = D.punten[(p0 + j + 1) * 2], by = D.punten[(p0 + j + 1) * 2 + 1];
      const sl = D.cum[p0 + j + 1] - D.cum[p0 + j] || 1, f = clamp((h - D.cum[p0 + j]) / sl, 0, 1);
      tLand[i] = eigOp(ax + (bx - ax) * f + 0.01, ay + (by - ay) * f + 0.01);
    }
    // CSR: gerichte takken uit elke knoop
    const adj0 = new Int32Array(nK + 1);
    for (let i = 0; i < nT; i++) { adj0[tA[i] + 1]++; adj0[tB[i] + 1]++; }
    for (let k = 0; k < nK; k++) adj0[k + 1] += adj0[k];
    const adj = new Int32Array(adj0[nK]), vul = adj0.slice(0, nK);
    for (let i = 0; i < nT; i++) { adj[vul[tA[i]]++] = i; adj[vul[tB[i]]++] = ~i; }
    D.adj0 = adj0; D.adj = adj;
    D.opritTak = opritTak;
    Object.assign(D, b);
    return D;
  }

  // Lichten, rotondes, zebra's, haltes, parkeerstroken, grensovergangen, poorten en de tabellen per tegel.
  *verrijk(view, D) {
    const geo = view.geo, T = geo.T, kol = geo.kol, rij = geo.rij, n = geo.tegels.length;
    const { R, netK, blk, blkLand, stad, zoneT, gebT, eigOp } = D;
    // per tegel: klasse per zijde, schuine weg, berm; een brug die langs een tegelzijde over een beek loopt telt als
    // straat aan die zijde (de halve randen eronder zijn nat en liggen zelf niet in het net)
    const dekK = new Int8Array(R.nHalf).fill(-1);
    for (let e = R.nHalf; e < R.nE; e++) if (R.eSoort[e] === 2 && netK[e] >= 0) for (const h of R.dekVan[e] ?? []) dekK[h] = Math.max(dekK[h], netK[e]);
    const zijKant = (h) => (netK[h] >= 0 ? netK[h] : dekK[h]);
    const zijK = new Int8Array(n * 4).fill(-1), binnen = new Int8Array(n).fill(-1), berm = new Uint8Array(n);
    for (let t = 0; t < n; t++) {
      for (let z = 0; z < 4; z++) { const zd = zijdeVan(R, t, z); zijK[t * 4 + z] = Math.max(zijKant(zd.e0), zijKant(zd.e1)); if (zijK[t * 4 + z] === KLASSE.STAM) berm[t] = 1; }
      for (const e of [R.diag[t * 2], R.diag[t * 2 + 1]]) if (e >= 0 && netK[e] >= 0) { binnen[t] = Math.max(binnen[t], netK[e]); if (netK[e] === KLASSE.STAM) berm[t] = 1; }
    }
    // oversteken over water lopen ook door tegels
    for (let e = R.nHalf; e < R.nE; e++) {
      if (R.eSoort[e] !== 2 || netK[e] < 0) continue;
      const ax = R.nx[R.eA[e]], ay = R.ny[R.eA[e]], bx = R.nx[R.eB[e]], by = R.ny[R.eB[e]];
      for (let q = 0.25; q < 1; q += 0.25) {
        const x = ax + (bx - ax) * q, y = ay + (by - ay) * q;
        for (const [ox, oy] of [[0.3, 0.3], [-0.3, -0.3]]) {
          const k = Math.floor(x / T + ox * 0.01), r = Math.floor(y / T + oy * 0.01);
          if (k >= 0 && r >= 0 && k < kol && r < rij) binnen[r * kol + k] = Math.max(binnen[r * kol + k], netK[e]);
        }
      }
    }
    D.zijK = zijK; D.binnen = binnen; D.berm = berm;
    yield;

    // knopen: lichten in de stad, rotondes erbuiten
    const sporenK = view.infraLaag?.routes ?? [];
    const spoorBijPunt = (x, y, d) => {
      const d2 = d * d;
      for (const r of sporenK) {
        if (!r?.x || x < r.x0 - d || x > r.x1 + d || y < r.y0 - d || y > r.y1 + d) continue;
        for (let j = 0; j + 1 < r.n; j++) {
          const ax = r.x[j], ay = r.y[j], dx = r.x[j + 1] - ax, dy = r.y[j + 1] - ay, l2 = dx * dx + dy * dy;
          const f = l2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
          const ex = ax + dx * f - x, ey = ay + dy * f - y;
          if (ex * ex + ey * ey < d2) return true;
        }
      }
      return false;
    };
    const armen = (k) => { const r = []; for (let j = D.adj0[k]; j < D.adj0[k + 1]; j++) { const g = D.adj[j]; const i = g >= 0 ? g : ~g; if (D.tKlasse[i] !== KLASSE.OPRIT) r.push(g); } return r; };
    const inStad = (x, y) => stadBijD(D, geo, x, y);
    const naarKnoop = (g) => (g >= 0 ? ~g : g >= -0x7fffffff ? ~g : g); // gerichte tak naar de knoop toe (omgekeerde van uitgaand)
    D.lichten = [];
    for (let k = 0; k < D.nK; k++) {
      if (D.kSoort[k] !== KNOOP.KRUIS) continue;
      const a = armen(k);
      if (a.length < 3) continue;
      const hoog = a.filter((g) => D.tKlasse[g >= 0 ? g : ~g] >= KLASSE.HOOFD).length;
      if (inStad(D.kx[k], D.ky[k])) {
        if (hoog < 2) continue;
        // groep: armen langs de as van de belangrijkste arm samen
        let beste = a[0];
        for (const g of a) if (D.tKlasse[g >= 0 ? g : ~g] > D.tKlasse[beste >= 0 ? beste : ~beste]) beste = g;
        // richting van uitgaande arm g vanaf de knoop (g < 0: de tak loopt van B naar A, dus vanaf zijn eind meten)
        const hoekVan = (g) => {
          const o = {}, i = g >= 0 ? g : ~g, d = Math.min(0.05 * T, D.tLen[i] / 2);
          this.puntIn(D, i, g >= 0 ? d : D.tLen[i] - d, o);
          return Math.atan2(o.y - D.ky[k], o.x - D.kx[k]);
        };
        // groep 0: de belangrijkste arm en de arm er recht tegenover (als die er is); de rest kruist en heeft groep 1
        const as = hoekVan(beste);
        const groep = new Uint8Array(a.length).fill(1);
        let tegen = -1, tc = -0.5;
        for (let i = 0; i < a.length; i++) {
          if (a[i] === beste) { groep[i] = 0; continue; }
          const c = Math.cos(hoekVan(a[i]) - as);
          if (c < tc) { tc = c; tegen = i; }
        }
        if (tegen >= 0) groep[tegen] = 0;
        D.kLicht[k] = D.lichten.length;
        D.kSoort[k] = KNOOP.LICHT;
        D.lichten.push({ knoop: k, fase0: Math.floor(hash(k, 31) * C * 4) / 4, armen: Int32Array.from(a, naarKnoop), groep });
      } else if (hoog >= 2 && a.every((g) => D.tLen[g >= 0 ? g : ~g] >= 0.4 * T) && !spoorBijPunt(D.kx[k], D.ky[k], 0.6 * T)) {
        // (geen rotonde waar een spoor door de cirkel of de inritten zou lopen: dan blijft het een gewone kruising)
        // buiten de bebouwing: waar twee of meer hoofd- of stamwegen samenkomen ligt een rotonde (kruising of
        // aftakking), mits elke arm lang genoeg is om de cirkel en de inrit te dragen
        D.kSoort[k] = KNOOP.ROTONDE;
      }
    }
    // zebra's bij de lichten, net voor het kruisvlak
    D.zebras = [];
    for (const L of D.lichten) {
      for (const gIn of L.armen) {
        const i = gIn >= 0 ? gIn : ~gIn;
        const d = 0.1 * T + PROFIEL[KLASSE.HOOFD].asfalt * T * 0.5;
        if (D.tLen[i] < d * 2.2) continue;
        // gIn wijst naar de knoop: bij gIn ≥ 0 is B de knoop
        const s = gIn >= 0 ? D.tLen[i] - d : d;
        const o = {}; this.puntIn(D, i, s, o);
        D.zebras.push({ tak: i, s, x: o.x, y: o.y, knoop: L.knoop });
      }
    }
    yield;
    // poorten
    D.poorten = [];
    D.poortVanT = new Int32Array(n).fill(-1);
    for (const o of D.opritTak) {
      const t = o.t, zone = zoneT[t] || 'werk';
      const park = this.parkeerVan(zone, o.z, t);
      const wp = new Float32Array(park.length);
      const cx = geo.tegels[t].x, cy = geo.tegels[t].y;
      for (let j = 0; j < park.length; j += 3) { wp[j] = cx + park[j] * T; wp[j + 1] = cy + park[j + 1] * T; wp[j + 2] = park[j + 2]; }
      const idx = D.poorten.length;
      D.poorten.push({ t, zijde: o.z, x: o.x, y: o.y, knoop: o.a, dock: o.b, oprit: o.tak, parkeer: wp, soort: POORTSOORT[zone] ?? 'werk', land: blkLand[t] });
      D.poortVanT[t] = idx;
      if (D.groep[t] >= 0) for (let w = 0; w < n; w++) if (D.groep[w] === D.groep[t]) D.poortVanT[w] = idx;
    }
    yield;
    // haltes op HOOFD langs woonwijk, hoofdstad, station, school en ziekenhuis
    D.haltes = [];
    const takMetHalte = new Set();
    for (let t = 0; t < n; t++) {
      if (!blk[t] || !(HALTE[gebT[t]] || gebT[t] === 'station')) continue;
      for (let z = 0; z < 4; z++) {
        if (zijK[t * 4 + z] < KLASSE.HOOFD) continue;
        const zd = zijdeVan(R, t, z);
        const e = netK[zd.e1] >= KLASSE.HOOFD ? zd.e1 : zd.e0, i = D.kantTak[e];
        if (i < 0 || takMetHalte.has(i)) continue;
        const mx = (R.nx[R.eA[e]] + R.nx[R.eB[e]]) / 2, my = (R.ny[R.eA[e]] + R.ny[R.eB[e]]) / 2;
        const s = this.projecteer(D, i, mx, my);
        if (s < 0.15 * T || s > D.tLen[i] - 0.15 * T) continue;
        const o = {}; this.puntIn(D, i, s, o);
        const kant = this.kantVan(D, i, s, geo.tegels[t].x, geo.tegels[t].y);
        takMetHalte.add(i);
        D.haltes.push({ tak: i, s, x: o.x, y: o.y, kant, land: blkLand[t], t });
        break;
      }
    }
    // parkeerstroken langs straten naast woon- en centrumtegels, buiten de poort en de hoeken
    D.parkeerstroken = [];
    for (let t = 0; t < n; t++) {
      if (!blk[t] || (zoneT[t] !== 'woon' && zoneT[t] !== 'centrum')) continue;
      for (let z = 0; z < 4; z++) {
        const kz = zijK[t * 4 + z];
        if (kz !== KLASSE.STRAAT && kz !== KLASSE.HOOFD) continue;
        const zd = zijdeVan(R, t, z);
        for (const e of [zd.e0, zd.e1]) {
          const i = D.kantTak[e];
          if (i < 0 || netK[e] < KLASSE.STRAAT) continue;
          // van 0,1 T vanaf de hoek tot 0,1 T voor het midden (daar ligt de poort)
          const ax = R.nx[R.eA[e]], ay = R.ny[R.eA[e]], bx = R.nx[R.eB[e]], by = R.ny[R.eB[e]];
          const mid = R.eA[e] === zd.mid ? 0 : 1; // welk eind is het randmidden
          const f0 = mid === 0 ? 0.2 : 0.2, f1 = 0.8;
          let s0 = this.projecteer(D, i, ax + (bx - ax) * f0, ay + (by - ay) * f0), s1 = this.projecteer(D, i, ax + (bx - ax) * f1, ay + (by - ay) * f1);
          if (s0 > s1) [s0, s1] = [s1, s0];
          const plekken = Math.floor((s1 - s0) / (0.16 * T));
          if (plekken < 1) continue;
          D.parkeerstroken.push({ tak: i, s0, s1, kant: this.kantVan(D, i, (s0 + s1) / 2, geo.tegels[t].x, geo.tegels[t].y), plekken, t, land: blkLand[t] });
        }
      }
    }
    yield;
    // grensovergangen: waar een stam- of hoofdweg van het ene land in het andere komt (één per grens)
    D.grensovergangen = [];
    // spoorlijnen van infra (invoer, zoals station en havens): ligt punt s van tak i binnen 0,4 T van een spoor?
    const sporen = view.infraLaag?.routes ?? [], ps = {};
    const spoorBij = (i, s) => {
      this.puntIn(D, i, s, ps);
      const r2 = (0.4 * T) ** 2;
      for (const r of sporen) {
        if (!r?.x || ps.x < r.x0 - 0.4 * T || ps.x > r.x1 + 0.4 * T || ps.y < r.y0 - 0.4 * T || ps.y > r.y1 + 0.4 * T) continue;
        for (let j = 0; j + 1 < r.n; j++) {
          const ax = r.x[j], ay = r.y[j], dx = r.x[j + 1] - ax, dy = r.y[j + 1] - ay, l2 = dx * dx + dy * dy;
          const f = l2 > 0 ? clamp(((ps.x - ax) * dx + (ps.y - ay) * dy) / l2, 0, 1) : 0;
          const ex = ax + dx * f - ps.x, ey = ay + dy * f - ps.y;
          if (ex * ex + ey * ey < r2) return true;
        }
      }
      return false;
    };
    const gezien = new Set();
    // eerst de stamwegen, dan pas hoofdwegen die toevallig een grens kruisen
    for (const kl of [KLASSE.STAM, KLASSE.HOOFD]) for (let i = 0; i < D.nT; i++) {
      if (D.tKlasse[i] !== kl) continue;
      const len = D.tLen[i], stap = 0.05 * T;
      const o = {};
      this.puntIn(D, i, 0, o);
      let vorig = eigOp(o.x + 0.01, o.y + 0.01), sv = 0;
      for (let s = stap; s <= len + 1e-6; s += stap) {
        const ss = Math.min(s, len);
        this.puntIn(D, i, ss, o);
        const e = eigOp(o.x + 0.01, o.y + 0.01);
        if (e !== vorig && e >= 0 && vorig >= 0) {
          // precies op de grens: halveren
          let lo = sv, hi = ss;
          for (let q = 0; q < 12; q++) { const m = (lo + hi) / 2; this.puntIn(D, i, m, o); if (eigOp(o.x + 0.01, o.y + 0.01) === vorig) lo = m; else hi = m; }
          const sleutel = Math.min(vorig, e) * 1000 + Math.max(vorig, e);
          if (!gezien.has(sleutel)) {
            gezien.add(sleutel);
            // niet op het kruisvlak: een weg die langs de grens loopt wisselt pas van land op de kruising, en daar
            // horen geen slagboom en douanestop
            const marge = Math.min(0.35 * T, len / 2);
            let sg = clamp((lo + hi) / 2, marge, len - marge);
            // en niet op een overweg: schuif langs de tak naar de dichtstbijzijnde plek op 0,4 T van het spoor
            if (spoorBij(i, sg)) {
              for (let d = 0.1 * T; d <= len; d += 0.1 * T) {
                if (sg - d >= marge && !spoorBij(i, sg - d)) { sg -= d; break; }
                if (sg + d <= len - marge && !spoorBij(i, sg + d)) { sg += d; break; }
              }
            }
            this.puntIn(D, i, sg, o);
            D.grensovergangen.push({ tak: i, s: sg, x: o.x, y: o.y, van: vorig, naar: e });
          }
        }
        if (e >= 0) { vorig = e; sv = ss; }
      }
    }
    yield;
    // varianten: buren van hetzelfde gebouw verschillen (gulzig op tegelvolgorde; N en W zijn al gekozen)
    const variant = new Int8Array(n).fill(-1);
    for (let t = 0; t < n; t++) {
      if (!blk[t]) continue;
      const k = t % kol, r = (t / kol) | 0, verboden = new Set();
      for (const [dk, dr] of ZN) { const kk = k + dk, rr = r + dr; if (kk < 0 || rr < 0 || kk >= kol || rr >= rij) continue; const w = rr * kol + kk; if (variant[w] >= 0 && gebT[w] === gebT[t]) verboden.add(variant[w]); }
      const v0 = Math.floor(hash(t, 91) * 3);
      for (let q = 0; q < 3; q++) { const v = (v0 + q) % 3; if (!verboden.has(v)) { variant[t] = v; break; } }
      if (variant[t] < 0) variant[t] = v0;
    }
    D.variant = variant;
    yield;
    // tegel → takken in de buurt (voor grondOp)
    const lijst = Array.from({ length: n }, () => []);
    for (let i = 0; i < D.nT; i++) {
      const m = 0.25 * T;
      const k0 = Math.max(0, Math.floor((D.tBox[i * 4] - m) / T)), k1 = Math.min(kol - 1, Math.floor((D.tBox[i * 4 + 2] + m) / T));
      const r0 = Math.max(0, Math.floor((D.tBox[i * 4 + 1] - m) / T)), r1 = Math.min(rij - 1, Math.floor((D.tBox[i * 4 + 3] + m) / T));
      if ((k1 - k0 + 1) * (r1 - r0 + 1) <= 9) { for (let r = r0; r <= r1; r++) for (let k = k0; k <= k1; k++) lijst[r * kol + k].push(i); continue; }
      // lange tak: per stuk
      for (let j = 0; j + 1 < D.tNP[i]; j++) {
        const p = D.tP0[i] + j, ax = D.punten[p * 2], ay = D.punten[p * 2 + 1], bx = D.punten[p * 2 + 2], by = D.punten[p * 2 + 3];
        const a0 = Math.max(0, Math.floor((Math.min(ax, bx) - m) / T)), a1 = Math.min(kol - 1, Math.floor((Math.max(ax, bx) + m) / T));
        const b0 = Math.max(0, Math.floor((Math.min(ay, by) - m) / T)), b1 = Math.min(rij - 1, Math.floor((Math.max(ay, by) + m) / T));
        for (let r = b0; r <= b1; r++) for (let k = a0; k <= a1; k++) { const l = lijst[r * kol + k]; if (l[l.length - 1] !== i) l.push(i); }
      }
    }
    const tt0 = new Int32Array(n + 1);
    for (let t = 0; t < n; t++) tt0[t + 1] = tt0[t] + lijst[t].length;
    const tt = new Int32Array(tt0[n]);
    for (let t = 0; t < n; t++) tt.set(lijst[t], tt0[t]);
    D.tegelTak0 = tt0; D.tegelTak = tt;
  }

  // Parkeerplekken langs de oprit, in T vanaf het tegelmidden: x, y, hoek per plek.
  parkeerVan(zone, z, t) {
    const aantal = PARKEER[zone] ?? 2;
    const [ox, oy] = ZN[z], px = -oy, py = ox; // langs de rand
    const uit = [];
    const rijen = [0.09, 0.16, 0.23];
    for (let i = 0; i < aantal && i < 6; i++) {
      const along = rijen[i >> 1], kant = i & 1 ? -1 : 1;
      const x = ox * (0.5 - along) + px * kant * 0.12, y = oy * (0.5 - along) + py * kant * 0.12;
      uit.push(x, y, Math.atan2(py * kant, px * kant));
    }
    return Float32Array.from(uit);
  }

  // Nieuwe bouw klaar: overnemen.
  zet(D) {
    this.D = D;
    for (const k of ['nK', 'kx', 'ky', 'kSoort', 'kLand', 'kLicht', 'nT', 'tA', 'tB', 'tKlasse', 'tLand', 'tLen', 'tP0', 'tNP', 'tZaad', 'tBouw', 'tBox', 'punten', 'cum', 'adj0', 'adj', 'lichten', 'poorten', 'haltes', 'parkeerstroken', 'zebras', 'grensovergangen']) this[k] = D[k];
    this._omg = [];
    this._wegen = null;
    this._water = D.water;
    this.versie++;
    this.klaar = true;
    const n = D.blk.length;
    this._zoek = { dist: new Float64Array(this.nK), prev: new Int32Array(this.nK), stamp: new Int32Array(this.nK), gen: 0, HT: new Int32Array(this.nT * 4 + 16), HK: new Float64Array(this.nT * 4 + 16) };
    void n;
    this.kDeel = this.delen();
  }

  // Samenhangende delen van het net (een eiland met eigen wegen is een eigen deel): kDeel[k] is het volgnummer van
  // het deel van knoop k. Door een dock rijdt route() niet heen, dus een dock verbindt geen delen; een dock krijgt
  // het deel van zijn buren, of -2 als die in verschillende delen liggen (dan beslist route() zelf).
  delen() {
    const nK = this.nK, deel = new Int32Array(nK).fill(-1), rij = new Int32Array(nK);
    let nd = 0;
    for (let s = 0; s < nK; s++) {
      if (deel[s] >= 0 || this.kSoort[s] === KNOOP.DOCK) continue;
      let kop = 0, staart = 0; rij[staart++] = s; deel[s] = nd;
      while (kop < staart) {
        const u = rij[kop++];
        for (let j = this.adj0[u]; j < this.adj0[u + 1]; j++) {
          const g = this.adj[j], i = g >= 0 ? g : ~g, v = this.tA[i] === u ? this.tB[i] : this.tA[i];
          if (deel[v] >= 0 || this.kSoort[v] === KNOOP.DOCK) continue;
          deel[v] = nd; rij[staart++] = v;
        }
      }
      nd++;
    }
    for (let k = 0; k < nK; k++) {
      if (this.kSoort[k] !== KNOOP.DOCK) continue;
      let d = -1;
      for (let j = this.adj0[k]; j < this.adj0[k + 1]; j++) {
        const g = this.adj[j], i = g >= 0 ? g : ~g, v = this.tA[i] === k ? this.tB[i] : this.tA[i], dv = this.kSoort[v] === KNOOP.DOCK ? -2 : deel[v];
        d = d === -1 ? dv : d === dv ? d : -2;
      }
      deel[k] = d === -1 ? nd++ : d; // een los dock is een deel op zich
    }
    this.nDelen = nd;
    return deel;
  }

  // Kan een voertuig over de weg van knoop a naar knoop b? Waar voor a === b (je bent er al).
  bereikbaar(a, b) {
    if (!this.D || a < 0 || b < 0 || a >= this.nK || b >= this.nK) return false;
    if (a === b) return true;
    const da = this.kDeel[a], db = this.kDeel[b];
    if (da >= 0 && db >= 0) return da === db;
    return this.route(a, b).length > 0;
  }

  // ---- lezen ----

  poortVan(t) { const D = this.D; if (!D || t < 0 || t >= D.poortVanT.length) return null; const i = D.poortVanT[t]; return i >= 0 ? this.poorten[i] : null; }

  // Volgnummer van gerichte tak g (naar de knoop toe, of eruit) in lichten[...].armen, of -1.
  armVan(knoop, g) {
    const li = this.kLicht[knoop];
    if (li < 0) return -1;
    const L = this.lichten[li], i = g >= 0 ? g : ~g;
    for (let a = 0; a < L.armen.length; a++) { const h = L.armen[a]; if ((h >= 0 ? h : ~h) === i) return a; }
    return -1;
  }

  // Punt op tak i (ongericht, s vanaf A).
  puntIn(D, i, s, uit) {
    const p0 = D.tP0[i], np = D.tNP[i], cum = D.cum, P = D.punten;
    s = clamp(s, 0, D.tLen[i]);
    let lo = 0, hi = np - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[p0 + m] <= s) lo = m; else hi = m; }
    const ax = P[(p0 + lo) * 2], ay = P[(p0 + lo) * 2 + 1], bx = P[(p0 + hi) * 2], by = P[(p0 + hi) * 2 + 1];
    const sl = cum[p0 + hi] - cum[p0 + lo];
    const f = sl > 1e-9 ? (s - cum[p0 + lo]) / sl : 0;
    uit.x = ax + (bx - ax) * f; uit.y = ay + (by - ay) * f; uit.hoek = Math.atan2(by - ay, bx - ax);
    return uit;
  }

  // uit.x, uit.y, uit.hoek op gerichte tak g op afstand s vanaf het begin van g.
  punt(g, s, uit) {
    if (!this.D) return uit;
    if (g >= 0) return this.puntIn(this.D, g, s, uit);
    const i = ~g;
    this.puntIn(this.D, i, this.tLen[i] - s, uit);
    uit.hoek += Math.PI;
    if (uit.hoek > Math.PI) uit.hoek -= TAU;
    return uit;
  }

  // Afstand langs tak i van het punt dat (x, y) het dichtst nadert.
  projecteer(D, i, x, y) {
    const p0 = D.tP0[i], np = D.tNP[i], P = D.punten;
    let bd = Infinity, bs = 0;
    for (let j = 0; j + 1 < np; j++) {
      const ax = P[(p0 + j) * 2], ay = P[(p0 + j) * 2 + 1], bx = P[(p0 + j) * 2 + 2], by = P[(p0 + j) * 2 + 3];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const f = l2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
      const d = Math.hypot(ax + dx * f - x, ay + dy * f - y);
      if (d < bd) { bd = d; bs = D.cum[p0 + j] + Math.sqrt(l2) * f; }
    }
    return bs;
  }

  // Aan welke kant van tak i (richting A→B) ligt (x, y): +1 rechts, -1 links.
  kantVan(D, i, s, x, y) {
    const o = {}; this.puntIn(D, i, s, o);
    const hx = Math.cos(o.hoek), hy = Math.sin(o.hoek);
    return hx * (y - o.y) - hy * (x - o.x) > 0 ? 1 : -1;
  }

  // Snelste route van knoop a naar knoop b als gerichte takken; leeg als hij er niet is. route(a, a) is ook leeg: je
  // bent er al (bereikbaar(a, a) is waar). Tussen twee delen van het net (een eiland) wordt niet eens gezocht.
  route(a, b) {
    if (!this.D || a < 0 || b < 0 || a >= this.nK || b >= this.nK) return new Int32Array(0);
    if (a === b) return new Int32Array(0);
    { const da = this.kDeel[a], db = this.kDeel[b]; if (da >= 0 && db >= 0 && da !== db) return new Int32Array(0); }
    const Z = this._zoek, dist = Z.dist, prev = Z.prev, stamp = Z.stamp, HT = Z.HT, HK = Z.HK;
    const gen = ++Z.gen;
    const kx = this.kx, ky = this.ky, bx = kx[b], by = ky[b], vmax = SNELHEID[KLASSE.STAM];
    let hn = 0;
    const push = (t, k) => {
      if (hn >= HT.length) return;
      let i = hn++;
      while (i > 0) { const p = (i - 1) >> 1; if (HK[p] < k || (HK[p] === k && HT[p] <= t)) break; HT[i] = HT[p]; HK[i] = HK[p]; i = p; }
      HT[i] = t; HK[i] = k;
    };
    const pop = () => {
      const t = HT[0]; hn--;
      const lt = HT[hn], lk = HK[hn];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hn) break;
        if (c + 1 < hn && (HK[c + 1] < HK[c] || (HK[c + 1] === HK[c] && HT[c + 1] < HT[c]))) c++;
        if (HK[c] > lk || (HK[c] === lk && HT[c] >= lt)) break;
        HT[i] = HT[c]; HK[i] = HK[c]; i = c;
      }
      HT[i] = lt; HK[i] = lk;
      return t;
    };
    const h = (k) => Math.hypot(kx[k] - bx, ky[k] - by) / vmax;
    stamp[a] = gen; dist[a] = 0; prev[a] = 0x7fffffff; push(a, h(a));
    let gevonden = false;
    while (hn) {
      const f = HK[0], u = pop();
      if (f - h(u) > dist[u] + 1e-9) continue;
      if (u === b) { gevonden = true; break; }
      for (let j = this.adj0[u]; j < this.adj0[u + 1]; j++) {
        const g = this.adj[j], i = g >= 0 ? g : ~g;
        const v = g >= 0 ? this.tB[i] : this.tA[i];
        // door een dock rijd je niet heen, en een oprit alleen naar het doel of vanaf het begin
        if (this.kSoort[v] === KNOOP.DOCK && v !== b) continue;
        const nd = dist[u] + this.tLen[i] / SNELHEID[this.tKlasse[i]];
        if (stamp[v] !== gen || nd < dist[v] - 1e-9) { stamp[v] = gen; dist[v] = nd; prev[v] = g; push(v, nd + h(v)); }
      }
    }
    if (!gevonden) return new Int32Array(0);
    const pad = [];
    for (let u = b; u !== a;) { const g = prev[u]; pad.push(g); const i = g >= 0 ? g : ~g; u = g >= 0 ? this.tA[i] : this.tB[i]; }
    pad.reverse();
    return Int32Array.from(pad);
  }

  // De bocht van gerichte tak gIn naar gUit op hun gedeelde knoop, op zijdelingse afstand off (rechts positief, in
  // wereldeenheden) van de as: uit.cx, uit.cy, uit.r, uit.a0, uit.a1 (radialen, a0 → a1 in rijrichting), uit.len.
  // Dezelfde boog voor de asfaltrand (off = ± halve breedte) en de rijlijn (off = baan). Rechtdoor: r = 0, len = 0.
  bocht(gIn, gUit, off, uit) {
    const o1 = {}, o2 = {};
    const iIn = gIn >= 0 ? gIn : ~gIn, iUit = gUit >= 0 ? gUit : ~gUit;
    this.punt(gIn, this.tLen[iIn], o1); // eind van gIn: knoop, richting de knoop in
    this.punt(gUit, 0, o2);
    const d1x = Math.cos(o1.hoek), d1y = Math.sin(o1.hoek), d2x = Math.cos(o2.hoek), d2y = Math.sin(o2.hoek);
    const kruis = d1x * d2y - d1y * d2x, dot = clamp(d1x * d2x + d1y * d2y, -1, 1);
    const th = Math.acos(dot);
    const T = this.geo?.T ?? 16;
    const k = Math.max(this.tKlasse[iIn] === KLASSE.OPRIT ? 0 : this.tKlasse[iIn], this.tKlasse[iUit] === KLASSE.OPRIT ? 0 : this.tKlasse[iUit]);
    const Rc = (PROFIEL[k].asfalt / 2 + 0.06) * T;
    if (th < 1e-3) { uit.cx = o1.x; uit.cy = o1.y; uit.r = 0; uit.a0 = 0; uit.a1 = 0; uit.len = 0; return uit; }
    if (th > Math.PI - 1e-3) {
      // keren: een halve cirkel om het eind
      const r = Math.max(0.02 * T, Math.abs(off));
      uit.cx = o1.x; uit.cy = o1.y; uit.r = r;
      const a = Math.atan2(d1x, -d1y);
      uit.a0 = off >= 0 ? a : a + Math.PI; uit.a1 = uit.a0 + (off >= 0 ? -Math.PI : Math.PI); uit.len = Math.PI * r;
      return uit;
    }
    const links = kruis < 0; // schermcoördinaten (y omlaag): kruis > 0 is rechtsaf
    // de baan rechts (off > 0) ligt bij een bocht naar rechts aan de binnenkant
    const r = Math.max(0.01 * T, links ? Rc + off : Rc - off);
    // offsetlijnen snijden
    const n1x = -d1y, n1y = d1x, n2x = -d2y, n2y = d2x; // rechternormaal (schermcoördinaten)
    const p1x = o1.x + n1x * off, p1y = o1.y + n1y * off, p2x = o2.x + n2x * off, p2y = o2.y + n2y * off;
    const den = d1x * d2y - d1y * d2x;
    const tt = ((p2x - p1x) * d2y - (p2y - p1y) * d2x) / den;
    const Px = p1x + d1x * tt, Py = p1y + d1y * tt;
    const Lt = r * Math.tan(th / 2);
    const sx = Px - d1x * Lt, sy = Py - d1y * Lt, ex = Px + d2x * Lt, ey = Py + d2y * Lt;
    const zx = links ? -n1x : n1x, zy = links ? -n1y : n1y; // naar het middelpunt
    uit.cx = sx + zx * r; uit.cy = sy + zy * r; uit.r = r;
    uit.a0 = Math.atan2(sy - uit.cy, sx - uit.cx); uit.a1 = Math.atan2(ey - uit.cy, ex - uit.cx);
    // a1 in de draairichting van a0
    if (links) { while (uit.a1 > uit.a0) uit.a1 -= TAU; } else { while (uit.a1 < uit.a0) uit.a1 += TAU; }
    uit.len = r * th;
    return uit;
  }

  // Omgeving van een bebouwde of gereserveerde tegel (zie het contract), of null.
  omgeving(t) {
    const D = this.D;
    if (!D || t < 0 || t >= D.blk.length || !D.blk[t]) return null;
    let o = this._omg[t];
    if (o) return o;
    const geo = this.geo, T = geo.T, kol = geo.kol, rij = geo.rij, k = t % kol, r = (t / kol) | 0, tg = geo.tegels[t];
    const { zijK, zoneT, gebT, blk, stadsdeel, R } = D;
    const zone = zoneT[t] || 'werk';
    // watermasker 8×8
    const wf = this._water;
    const wm = new Uint8Array(64);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) wm[j * 8 + i] = wf ? wf(k * T + (i + 0.5) * T / 8, r * T + (j + 0.5) * T / 8) : 0;
    const buren = new Array(8);
    for (let i = 0; i < 8; i++) {
      const [dk, dr] = BUUR8[i], kk = k + dk, rr = r + dr;
      if (kk < 0 || rr < 0 || kk >= kol || rr >= rij) { buren[i] = '~'; continue; }
      const w = rr * kol + kk;
      buren[i] = blk[w] ? (zoneT[w] || 'werk') : geo.tegels[w].terrein === 'water' ? '~' : '';
    }
    let straat = 0, naad = 0, haag = 0, rand = 0, wat = 0, bos = 0;
    const klasse = new Int8Array(4).fill(-1), inzet = new Float32Array(4);
    for (let z = 0; z < 4; z++) {
      const bit = 1 << z, kz = zijK[t * 4 + z];
      // water aan deze zijde: de rand van het masker aan die kant is voor de helft of meer nat
      let nat = 0;
      for (let i = 0; i < 8; i++) {
        const c = z === 0 ? wm[i] : z === 2 ? wm[56 + i] : z === 3 ? wm[i * 8] : wm[i * 8 + 7];
        if (c) nat++;
      }
      const buur = buren[z * 2];
      const [dk, dr] = ZN[z], kk = k + dk, rr = r + dr, w = kk >= 0 && rr >= 0 && kk < kol && rr < rij ? rr * kol + kk : -1;
      if (w >= 0 && !blk[w] && geo.tegels[w].terrein === 'bos') bos |= bit;
      if (kz >= 0 && kz !== KLASSE.OPRIT) { straat |= bit; klasse[z] = kz; inzet[z] = PROFIEL[kz].inzet; }
      else if (nat >= 4 || buur === '~') { wat |= bit; inzet[z] = INZET.water; }
      else if (buur && buur !== '~') {
        if (NAAD[buur] === NAAD[zone] && NAAD[zone] != null) { naad |= bit; inzet[z] = INZET.naad; } else { haag |= bit; inzet[z] = INZET.haag; }
      } else { rand |= bit; inzet[z] = INZET.rand; }
    }
    const p = this.poortVan(t);
    const poort = p ? p.zijde : -1;
    const poortKlasse = poort >= 0 ? zijK[t * 4 + poort] : -1;
    const oprit = new Float32Array(4);
    let parkeer = new Float32Array(0);
    if (p) {
      const [ox, oy] = ZN[poort];
      oprit[0] = ox * 0.5; oprit[1] = oy * 0.5; oprit[2] = ox * (0.5 - OPRIT); oprit[3] = oy * (0.5 - OPRIT);
      parkeer = this.parkeerVan(zone, poort, t);
    }
    // helling en laagste buur
    let hmax = 0, laag = -1, hl = tg.hoogte;
    for (let z = 0; z < 4; z++) {
      const [dk, dr] = ZN[z], kk = k + dk, rr = r + dr;
      if (kk < 0 || rr < 0 || kk >= kol || rr >= rij) continue;
      const h = geo.tegels[rr * kol + kk].hoogte;
      if (geo.tegels[rr * kol + kk].terrein === 'water') continue;
      hmax = Math.max(hmax, Math.abs(h - tg.hoogte));
      if (h < hl) { hl = h; laag = z; }
    }
    const helling = clamp(hmax * 8, 0, 1);
    if (laag < 0) laag = 2;
    const variant = D.variant[t];
    let wsig = 0; for (let i = 0; i < 64; i++) wsig = (Math.imul(wsig, 3) + wm[i]) | 0;
    const sleutel = `${zone}${stadsdeel[t]}s${straat}n${naad}h${haag}r${rand}w${wat}b${bos}k${klasse.join('')}p${poort}${poortKlasse}m${(wsig >>> 0).toString(36)}g${Math.round(helling * 4)}l${laag}${tg.terrein[0]}v${variant}`;
    o = {
      t, zone, stadsdeel: stadsdeel[t], straat, naad, haag, rand, water: wat, bos, klasse, inzet, poort, poortKlasse, oprit, parkeer,
      waterMasker: wm, helling, laag, terrein: tg.terrein, hoogte: tg.hoogte, buren, variant, sleutel, gebouw: gebT[t],
    };
    this._omg[t] = o;
    return o;
  }

  // Wat ligt er op een wereldpunt: GROND.*
  grondOp(wx, wy) {
    const D = this.D;
    if (!D) return GROND.VRIJ;
    const geo = this.geo, T = geo.T;
    const k = Math.floor(wx / T), r = Math.floor(wy / T);
    if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) return GROND.VRIJ;
    const t = r * geo.kol + k;
    let stoep = false;
    for (let j = D.tegelTak0[t]; j < D.tegelTak0[t + 1]; j++) {
      const i = D.tegelTak[j], kl = D.tKlasse[i], pr = PROFIEL[kl];
      const d = this.afstandTak(D, i, wx, wy);
      if (kl === KLASSE.OPRIT) { if (d <= pr.asfalt * T / 2) return GROND.OPRIT; continue; }
      if (d <= pr.asfalt * T / 2) return GROND.WEG;
      if (d <= (pr.asfalt / 2 + pr.stoep) * T) stoep = true;
    }
    if (stoep) return GROND.STOEP;
    if (!D.blk[t]) return GROND.VRIJ;
    const o = this.omgeving(t);
    const fx = wx / T - k, fy = wy / T - r;
    if (o && (fy < o.inzet[0] || fx > 1 - o.inzet[1] || fy > 1 - o.inzet[2] || fx < o.inzet[3])) return GROND.RAND;
    return GROND.KAVEL;
  }

  afstandTak(D, i, x, y) {
    const b = D.tBox, m = 0.3 * this.geo.T;
    if (x < b[i * 4] - m || x > b[i * 4 + 2] + m || y < b[i * 4 + 1] - m || y > b[i * 4 + 3] + m) return Infinity;
    const p0 = D.tP0[i], np = D.tNP[i], P = D.punten;
    let bd = Infinity;
    for (let j = 0; j + 1 < np; j++) {
      const ax = P[(p0 + j) * 2], ay = P[(p0 + j) * 2 + 1], dx = P[(p0 + j) * 2 + 2] - ax, dy = P[(p0 + j) * 2 + 3] - ay, l2 = dx * dx + dy * dy;
      const f = l2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
      const d = Math.hypot(ax + dx * f - x, ay + dy * f - y);
      if (d < bd) bd = d;
    }
    return bd;
  }

  // bit 0-3 straat aan N/O/Z/W, bit 4 weg door het tegelbinnenste, bit 5 berm (stamweg langs of door de tegel).
  wegBits(t) {
    const D = this.D;
    if (!D || t < 0 || t >= D.berm.length) return 0;
    let b = 0;
    for (let z = 0; z < 4; z++) if (D.zijK[t * 4 + z] >= 0) b |= 1 << z;
    if (D.binnen[t] >= 0) b |= 16;
    if (D.berm[t]) b |= 32;
    return b;
  }

  // Hoek van de belangrijkste weg in of langs t (radialen), of NaN.
  wegHoek(t) {
    const D = this.D;
    if (!D || t < 0 || t >= D.berm.length) return NaN;
    let bk = -1, h = NaN;
    for (let z = 0; z < 4; z++) { const k = D.zijK[t * 4 + z]; if (k > bk) { bk = k; h = z === 0 || z === 2 ? 0 : Math.PI / 2; } }
    const R = D.R;
    for (const [e, a] of [[R.diag[t * 2], Math.PI / 4], [R.diag[t * 2 + 1], -Math.PI / 4]]) if (e >= 0 && D.netK[e] > bk) { bk = D.netK[e]; h = a; }
    return h;
  }

  // Rechte stukken voor oude lezers (infra, hemel, kust, werk, stad): elke tak in stukken tussen zijn hoekpunten.
  wegen() {
    if (this._wegen) return this._wegen;
    const D = this.D, uit = [];
    if (!D) return uit;
    const T = this.geo.T, P = D.punten;
    const stadOp = (x, y) => this.stadBij(x, y);
    for (let i = 0; i < D.nT; i++) {
      if (D.tKlasse[i] === KLASSE.OPRIT) continue;
      const p0 = D.tP0[i], np = D.tNP[i];
      // samenvoegen tot rechte stukken: punten die (bijna) op één lijn liggen
      let a = 0;
      for (let j = 1; j < np; j++) {
        const ax = P[(p0 + a) * 2], ay = P[(p0 + a) * 2 + 1], bx = P[(p0 + j) * 2], by = P[(p0 + j) * 2 + 1];
        let recht = true;
        if (j + 1 < np) {
          const cx = P[(p0 + j + 1) * 2], cy = P[(p0 + j + 1) * 2 + 1];
          const ux = bx - ax, uy = by - ay, vx = cx - bx, vy = cy - by;
          recht = Math.abs(ux * vy - uy * vx) <= 0.02 * Math.hypot(ux, uy) * Math.hypot(vx, vy) && ux * vx + uy * vy > 0;
        }
        if (recht && j + 1 < np) continue;
        const len = Math.hypot(bx - ax, by - ay);
        if (len > 1e-6) {
          uit.push({ ax, ay, bx, by, len, ux: (bx - ax) / len, uy: (by - ay) / len, s0: 0, s1: len, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by), land: D.tLand[i], zaad: D.tZaad[i] | 0, klasse: D.tKlasse[i], tak: i, stadA: stadOp(ax, ay), stadB: stadOp(bx, by), brug: null });
        }
        a = j;
      }
    }
    this._wegen = uit;
    return uit;
  }

  // Ligt een wereldpunt in of tegen de stad?
  stadBij(x, y) { return this.D ? stadBijD(this.D, this.geo, x, y) : false; }
}

// Ligt een punt in de stad: een van de tegels binnen 0,3 T is een stadstegel.
function stadBijD(D, geo, x, y) {
  const T = geo.T;
  for (const [ox, oy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    const k = Math.floor(x / T + ox), r = Math.floor(y / T + oy);
    if (k >= 0 && r >= 0 && k < geo.kol && r < geo.rij && D.stad[r * geo.kol + k] >= 0) return true;
  }
  return false;
}

// Een klein raster met lichten, poorten en zebra's, voor tests van andere pakketten: één land met een hoofdstad in
// het midden, een stadje van 5 × 5 tegels eromheen en een paar losse boerderijen.
export function testnet(kol = 12, rij = 10) {
  const T = 16, tegels = [];
  for (let r = 0; r < rij; r++) for (let k = 0; k < kol; k++) tegels.push({ i: tegels.length, k, r, x: (k + 0.5) * T, y: (r + 0.5) * T, eig: 0, terrein: 'vlakte', hoogte: 0.3 + 0.01 * ((k * 7 + r * 3) % 5) });
  const hk = Math.floor(kol / 2), hr = Math.floor(rij / 2), h = hr * kol + hk;
  const bezet = new Array(kol * rij).fill(null);
  bezet[h] = { land: 0, hoofdstad: true };
  const soorten = ['woonwijk', 'industrie', 'school', 'woonwijk', 'opslag', 'ziekenhuis', 'woonwijk', 'mijn'];
  const plaatsingen = [];
  let i = 0;
  for (let r = hr - 2; r <= hr + 2; r++) for (let k = hk - 2; k <= hk + 2; k++) {
    if (r < 0 || k < 0 || r >= rij || k >= kol) continue;
    const t = r * kol + k;
    if (t === h || (Math.abs(r - hr) === 2 && Math.abs(k - hk) === 2)) continue;
    const g = soorten[i++ % soorten.length];
    bezet[t] = { land: 0, gebouw: g, bouw: false };
    plaatsingen.push({ g, t, eff: 1 });
  }
  for (const [k, r] of [[1, 1], [kol - 2, rij - 2], [1, rij - 2]]) {
    if (k < 0 || r < 0 || k >= kol || r >= rij) continue;
    const t = r * kol + k;
    if (bezet[t]) continue;
    bezet[t] = { land: 0, gebouw: 'boerderij', bouw: false };
    plaatsingen.push({ g: 'boerderij', t, eff: 1 });
  }
  const geo = { T, kol, rij, tegels, hoofdstad: [h], idxVan: { test: 0 } };
  const state = { landen: [{ idx: 0, plaatsingen, bouw: [] }], eigenaar: new Array(kol * rij).fill(0), bezet, kolonies: [], grensVersie: 0, pack: { gebouwIndex: {}, kaart: { handelsroutes: [] } } };
  const view = { geo, state, eigenaar: null, terreinLaag: null, infraLaag: null };
  const net = new Wegennet();
  net.laad(view);
  net.bouwNu(view);
  return net;
}
