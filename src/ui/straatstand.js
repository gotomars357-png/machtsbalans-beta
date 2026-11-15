// Straatstand (C13c): hoe het land ervoor staat, zoals je dat op straat moet kunnen zien. Een fabriek zonder energie
// staat stil, een bloeiend land krijgt drukkere straten, bij een blokkade staan de opleggers in de rij voor de grens
// en bij onrust gloeit de hoofdstad al op de middenzoom.
// Puur: geen DOM, geen klok, geen toeval. Leest de toestand en schrijft er nooit in. Eén momentopname per speldag,
// gedeeld door detail.js (stil dak, geen rook) en leven.js (merkjes, vracht, rij, puls); leven.js werkt hem bij aan
// het begin van elk beeld, map.js tekent de gebouwen in hetzelfde beeld eerder en leest dus die van het vorige beeld.

import { oorlogenVan } from '../engine/leger.js';
import { ritStand, plekPlaats, STAPPEN, DT, U0, TOESTAND } from './ritten.js';

// Alle drempels op één plek. stil_aan / stil_uit: hysterese op het minimum van de voorzieningsgraad (c.ratio) van wat
// een gebouw verbruikt; bloei_welvaart: welvaart zoals in levenDichtheid; onrust_stab: stabiliteit; blokkade_dagen:
// zo lang telt een economische druk als blokkade (tenzij de escalatie zelf een duur heeft).
export const DREMPELS = { stil_aan: 0.6, stil_uit: 0.8, bloei_welvaart: 1.15, onrust_stab: 35, blokkade_dagen: 60 };

// Per pack de verbruikte resources per gebouw (als lijst, zodat er per dag geen Object.keys nodig is) en de trede en
// duur van de economische druk.
const PACK = new WeakMap();
function packInfo(P) {
  let k = PACK.get(P);
  if (k) return k;
  const verbruik = {};
  for (let i = 0; i < (P.gebouwen ?? []).length; i++) {
    const g = P.gebouwen[i];
    const lijst = [];
    for (const r in g.verbruik ?? {}) if (g.verbruik[r] > 0) lijst.push(r);
    if (lijst.length) verbruik[g.id] = lijst;
  }
  const druk = (P.acties?.escalatie ?? []).find((e) => e.id === 'economische_druk') ?? null;
  k = { verbruik, drukTrede: druk ? druk.trede : null, drukDuur: druk && Number.isFinite(druk.duur) ? druk.duur : DREMPELS.blokkade_dagen };
  PACK.set(P, k);
  return k;
}

// Rekent de stand van één speldag uit. vorige: de stand van eerder (voor de hysterese), of null.
// Geeft { dag, stil: Map tegel → ontbrekende resource-id, land: [{ bloei, blokkade, onrust, oorlog, druk }] } plus
// dezelfde stille gebouwen als lijsten (stilT, stilRes, stilLand), zodat tekenaars op index kunnen lopen.
export function berekenStraatStand(state, vorige = null) {
  const P = state.pack, info = packInfo(P), dag = state.dag ?? 0;
  const stil = new Map(), stilT = [], stilRes = [], stilLand = [];
  const vorigStil = vorige?.stil ?? null;
  const landen = state.landen ?? [];
  const gemiddeld = (state.wereldY ?? 0) / Math.max(1, landen.length);
  const land = [];
  for (let li = 0; li < landen.length; li++) {
    const c = landen[li];
    const ratio = c.ratio ?? {};
    const pl = c.plaatsingen ?? [];
    for (let j = 0; j < pl.length; j++) {
      const p = pl[j];
      if (p.t == null || p.t < 0) continue;
      const lijst = info.verbruik[p.g];
      if (!lijst) continue;
      // uitgevallen (cyber) heeft een eigen tekening
      if ((p.uit ?? 0) > dag) continue;
      let min = 1, res = null;
      for (let k = 0; k < lijst.length; k++) {
        const v = ratio[lijst[k]];
        const r = typeof v === 'number' && Number.isFinite(v) ? v : 1;
        if (r < min) { min = r; res = lijst[k]; }
      }
      const was = vorigStil ? vorigStil.has(p.t) : false;
      if (was ? min <= DREMPELS.stil_uit : min < DREMPELS.stil_aan) {
        // het ontbrekende goed blijft hetzelfde zolang het gebouw stilstaat en dat goed nog tekortschiet
        const oud = was ? vorigStil.get(p.t) : null;
        const goed = oud != null && (ratio[oud] ?? 1) <= DREMPELS.stil_uit ? oud : res ?? lijst[0];
        stil.set(p.t, goed);
        stilT.push(p.t); stilRes.push(goed); stilLand.push(li);
      }
    }
    // welvaart: dezelfde definitie als in levenDichtheid (leven.js)
    const welvaart = gemiddeld > 0 ? Math.min(1.6, Math.max(0.4, c.Y / gemiddeld)) : 1;
    const oorlog = oorlogenVan(state, c).length > 0;
    let druk = false;
    if (info.drukTrede != null) {
      const esc = state.escalaties ?? [];
      for (let i = esc.length - 1; i >= 0; i--) {
        const e = esc[i];
        if (e.doel !== c.idx || e.trede !== info.drukTrede) continue;
        const oud = dag - e.dag;
        if (oud >= 0 && oud <= info.drukDuur) { druk = true; break; }
      }
    }
    land.push({
      bloei: welvaart > DREMPELS.bloei_welvaart && (c.groei ?? 0) > 0,
      blokkade: oorlog || druk,
      onrust: (c.stab ?? 100) < DREMPELS.onrust_stab,
      oorlog, druk, welvaart,
    });
  }
  return { dag, stil, stilT, stilRes, stilLand, land };
}

// ---------- de gedeelde momentopname ----------

let huidig = null, huidigState = null, rekenTeller = 0;

// Werk de momentopname bij: hooguit één keer per speldag, en opnieuw bij een andere toestand (nieuw of geladen spel).
export function bijwerken(state) {
  if (!state || !state.pack) return huidig;
  if (state === huidigState && huidig && huidig.dag === (state.dag ?? 0)) return huidig;
  const vorige = state === huidigState ? huidig : null;
  huidig = berekenStraatStand(state, vorige);
  huidigState = state;
  rekenTeller++;
  return huidig;
}

// Vergeet de momentopname (tests, en kijk.mjs na een --js die de economie verandert): het volgende bijwerken rekent
// opnieuw, zonder hysterese.
export function vergeet() { huidig = null; huidigState = null; }

// De ontbrekende resource-id van het gebouw op tegel t, of null als het draait.
export function stilOp(t) {
  if (!huidig) return null;
  const r = huidig.stil.get(t);
  return r === undefined ? null : r;
}

// { bloei, blokkade, onrust, oorlog, druk, welvaart } van land idx, of null.
export function landStand(idx) { return huidig?.land[idx] ?? null; }

// De hele momentopname (voor leven.js en de tests), of null.
export function straatStand() { return huidig; }

// Hoe vaak er gerekend is (voor de test: twee keer bijwerken op dezelfde dag rekent één keer).
export function rekenTelling() { return rekenTeller; }

// ---------- wat de stand met het wegverkeer doet (voor leven.js) ----------

// Hooguit zoveel opleggers per grensovergang in de rij bij een blokkade; zoveel extra personenauto's (als deel van
// wat er al rijdt) krijgt een bloeiend land, deels als volger in het verkeer en deels geparkeerd.
export const RIJ_MAX = 6;
export const BLOEI_EXTRA = 0.25;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const R_DOCK = 0, R_PLEK = 1; // soorten rustpunten in ritten.js
const F_ACHTER = 1; // vlag in R.pf: dit stuk van het dagpad wordt achteruit gereden

// Punt op het dagpad van voertuig v op afstand s: uit.x, y, hx, hy (rijrichting) en alpha. Zoals ritStand in
// ritten.js, maar voor een gegeven s in plaats van een tijd.
export function padPunt(R, v, s, uit) {
  const a0 = R.p0[v], a1 = R.p0[v + 1] - 1, pc = R.pc;
  if (a1 <= a0) { uit.x = R.px[a0]; uit.y = R.py[a0]; uit.hx = 1; uit.hy = 0; uit.alpha = R.pa[a0] / 255; return uit; }
  let lo = a0, hi = a1;
  if (s <= pc[lo]) hi = lo + 1;
  else if (s >= pc[a1]) { lo = a1 - 1; hi = a1; }
  else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pc[m] <= s) lo = m; else hi = m; }
  const d = pc[hi] - pc[lo], f = d > 1e-9 ? clamp((s - pc[lo]) / d, 0, 1) : 0;
  uit.x = R.px[lo] + (R.px[hi] - R.px[lo]) * f; uit.y = R.py[lo] + (R.py[hi] - R.py[lo]) * f;
  let q = lo, hx = R.px[hi] - R.px[lo], hy = R.py[hi] - R.py[lo];
  while (hx * hx + hy * hy < 1e-12 && q > a0) { q--; hx = R.px[q + 1] - R.px[q]; hy = R.py[q + 1] - R.py[q]; }
  if (R.pf[q] & F_ACHTER) { hx = -hx; hy = -hy; }
  const hl = Math.hypot(hx, hy) || 1;
  uit.hx = hx / hl; uit.hy = hy / hl;
  uit.alpha = (R.pa[lo] + (R.pa[hi] - R.pa[lo]) * f) / 255;
  return uit;
}

// Wat de straatstand (st, uit berekenStraatStand) met ritset R doet. Puur uit R, het net en st; laag levert alleen
// isWater en landVan. Geeft:
//   verborgen[v]  1: goederenvracht van of naar een stil gebouw, rijdt niet
//   park          per stil gebouw met een dock een geparkeerde vrachtwagen { x, y, hx, hy, soort, kleur, land, v, sleutel }
//   rij[v], rijS[v], rijPos  plek in de rij voor de douane (blokkade): rangnummer, s van die plek, x y hx hy alpha
//   boom[gi]      1: de slagboom van grensovergang gi blijft dicht (er staat een rij)
//   volger[v]     1: deze auto krijgt in een bloeiend land een volger
//   extra         extra geparkeerde auto's op vrije plekken langs de opritten van een bloeiend land (met een sleutel)
export function straatVerkeer(R, st, net, laag) {
  const N = R.n;
  const k = { st, net, verborgen: new Uint8Array(N), park: [], rij: new Int8Array(N).fill(-1), rijS: new Float32Array(N), rijPos: new Float32Array(N * 5),
    boom: new Uint8Array(net?.grensovergangen?.length ?? 0), volger: new Uint8Array(N), extra: [] };
  if (!st || !net?.D) return k;
  const S1 = STAPPEN + 1, T = R.T, pvT = net.D.poortVanT, nP = net.poorten.length, pos = {};
  // stille poorten (een gebouw over meer tegels heeft één poort)
  const stilP = new Uint8Array(nP);
  for (let i = 0; i < st.stilT.length; i++) { const p = pvT?.[st.stilT[i]] ?? -1; if (p >= 0 && p < nP) stilP[p] = 1; }
  const metPark = new Uint8Array(nP);
  const groep = [];
  for (let v = 0; v < N; v++) {
    const inf = R.info[v];
    if (inf.rit === 'goederen') {
      let p = inf.van >= 0 && stilP[inf.van] ? inf.van : -1, bijDoel = false;
      for (let j = 0; p < 0 && j < (inf.doel?.length ?? 0); j++) if (stilP[inf.doel[j]]) { p = inf.doel[j]; bijDoel = true; }
      if (p >= 0) {
        k.verborgen[v] = 1;
        if (!metPark[p]) {
          // thuis: waar hij om middernacht staat; bij het doel: waar hij daar lost of laadt
          let u = -1;
          if (!bijDoel) u = U0;
          else {
            for (let b = 0; b < inf.benen.length && u < 0; b++) {
              const been = inf.benen[b];
              if (been.naar?.soort !== R_DOCK || been.naar.p !== p) continue;
              for (let i = 0; i < STAPPEN; i++) {
                const z = R.Z[v * S1 + i];
                if ((z === TOESTAND.LAADT || z === TOESTAND.LOST) && Math.abs(R.S[v * S1 + i] - been.sEind) < 0.02 * T) { u = U0 + (i + 0.5) * DT; break; }
              }
            }
          }
          if (u >= 0) {
            ritStand(R, v, u, pos);
            k.park.push({ x: pos.x, y: pos.y, hx: pos.hx, hy: pos.hy, soort: R.soort[v], kleur: R.kleur[v], land: R.land[v], v, sleutel: v });
            metPark[p] = 1;
          }
        }
      }
    }
    if (inf.rit === 'export' && st.land[inf.land]?.blokkade && inf.stops) {
      let stop = null;
      for (let j = 0; j < inf.stops.length; j++) { const q = inf.stops[j]; if (q.soort === 1 && (!stop || q.s < stop.s)) stop = q; }
      if (stop) {
        let aan = -1;
        for (let i = 0; i < STAPPEN; i++) if (R.S[v * S1 + i] >= stop.s - 1e-3) { aan = i; break; }
        if (aan >= 0) (groep[stop.gi] ??= []).push([aan, v, stop.s]);
      }
    }
  }
  // de rij: wie het eerst bij de douane is, staat vooraan; elke volgende een opleggerlengte terug langs zijn weg
  const lengte = (2 * 0.1 + 0.045) * T;
  for (let gi = 0; gi < groep.length; gi++) {
    const L = groep[gi];
    if (!L) continue;
    L.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (gi < k.boom.length) k.boom[gi] = 1;
    // de rij is hooguit RIJ_MAX lang, en korter als een plek op een overweg zou vallen: wie daar of verder terug zou
    // staan, rekent als overloop (vervaagt vóór zijn plek, zoals de zevende)
    let max = RIJ_MAX;
    for (let i = 0; i < L.length; i++) {
      const [, v, s] = L[i], plek = Math.min(i, RIJ_MAX);
      k.rijS[v] = Math.max(0, s - plek * lengte);
      if (plek < max) {
        padPunt(R, v, k.rijS[v], pos);
        if (plek > 0 && laag.opOverweg?.(pos.x, pos.y)) max = plek; // de douane zelf ligt nooit op een overweg
      }
      k.rij[v] = plek < max ? plek : RIJ_MAX;
      if (plek < max) {
        const q = v * 5;
        k.rijPos[q] = pos.x; k.rijPos[q + 1] = pos.y; k.rijPos[q + 2] = pos.hx; k.rijPos[q + 3] = pos.hy; k.rijPos[q + 4] = pos.alpha;
      }
    }
  }
  // bloei: een kwart meer personenauto's, half als volger in het verkeer en half geparkeerd op vrije plekken langs de
  // opritten (zijn die er niet, dan ook als volger)
  let bloei = false;
  for (let i = 0; i < st.land.length; i++) if (st.land[i].bloei) bloei = true;
  if (bloei) {
    const nAuto = new Int32Array(st.land.length), bezet = new Set(), thuisP = new Uint8Array(nP), autos = [];
    const plek = (r) => { if (r && r.soort === R_PLEK) bezet.add(r.p * 4096 + r.j); };
    for (let v = 0; v < N; v++) {
      const inf = R.info[v], L = st.land[R.land[v]];
      plek(inf.thuis);
      if (inf.thuis?.soort === R_PLEK && inf.thuis.p >= 0 && inf.thuis.p < nP) thuisP[inf.thuis.p] = 1;
      for (let b = 0; b < inf.benen.length; b++) plek(inf.benen[b].naar);
      if (R.soort[v] !== 0 || !L?.bloei) continue;
      nAuto[R.land[v]]++;
      autos.push([hash(v, 93, R.land[v]), v, R.land[v]]);
    }
    // per land een kwart erbij (afgerond): de helft (naar boven) als volger, de rest geparkeerd
    const extraVan = (li) => Math.round(nAuto[li] * BLOEI_EXTRA), volgVan = (li) => Math.ceil(extraVan(li) / 2);
    autos.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const nVolg = new Int32Array(st.land.length);
    for (let i = 0; i < autos.length; i++) { const [, v, li] = autos[i]; if (nVolg[li] < volgVan(li)) { nVolg[li]++; k.volger[v] = 1; } }
    // vrije plekken langs de opritten waar al iemand thuis is (dus een droge oprit), per land in een vaste volgorde
    const kand = [];
    for (let p = 0; p < nP; p++) {
      if (!thuisP[p]) continue;
      const q = net.poorten[p], li = laag.landVan(q.t);
      if (li < 0 || !st.land[li]?.bloei) continue;
      for (let j = 0; j < q.parkeer.length / 3; j++) if (!bezet.has(p * 4096 + j)) kand.push([hash(p, j, 97), p, j, li]);
    }
    kand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const over = new Int32Array(st.land.length);
    for (let i = 0; i < st.land.length; i++) over[i] = extraVan(i) - volgVan(i);
    for (let i = 0; i < kand.length; i++) {
      const [, p, j, li] = kand[i];
      if (over[li] <= 0) continue;
      plekPlaats(net, p, j, T, pos);
      if (laag.isWater(pos.x, pos.y)) continue;
      over[li]--;
      k.extra.push({ x: pos.x, y: pos.y, hx: Math.cos(pos.hoek), hy: Math.sin(pos.hoek), soort: 0, kleur: Math.floor(hash(p, j, 98) * 8), land: li, sleutel: p * 4096 + j });
    }
    // geen vrije plek meer langs de opritten: de rest van het kwart rijdt dan als volger mee
    for (let i = 0; i < autos.length; i++) { const [, v, li] = autos[i]; if (over[li] > 0 && !k.volger[v]) { over[li]--; k.volger[v] = 1; } }
  }
  return k;
}

// ---------- invagen en uitvagen van de geparkeerde wagens (voor leven.js) ----------

// Hoe ver een wissel van de straatstand is (0 net gewisseld, 1 klaar), in een seconde van de klok nu (ms). Loopt de
// klok terug (een sprong in de tijd), dan is hij klaar.
export const vervaag = (nu, sinds) => { const d = nu - sinds; return d >= 0 ? clamp(d / 1000, 0, 1) : 1; };

// De geparkeerde wagens van de straatstand (lijst met .sleutel) met per wagen sinds wanneer hij er staat, en wie er
// sinds kort niet meer staat (weg, wegSinds). Een wagen die er al stond houdt zijn tijd, zodat een nieuwe speldag hem
// niet opnieuw laat invagen; zonder vorige (de eerste keer, of een nieuwe ritset) staat alles er meteen.
export function parkOvergang(lijst, vorig, nu) {
  const sinds = new Float64Array(lijst.length).fill(-1e9), weg = [], wegSinds = [];
  if (!vorig) return { lijst, sinds, weg, wegSinds };
  const was = new Map(), nieuw = new Set();
  for (let i = 0; i < vorig.lijst.length; i++) was.set(vorig.lijst[i].sleutel, vorig.sinds[i]);
  for (let i = 0; i < lijst.length; i++) { const s = lijst[i].sleutel; nieuw.add(s); sinds[i] = was.has(s) ? was.get(s) : nu; }
  for (let i = 0; i < vorig.lijst.length; i++) if (!nieuw.has(vorig.lijst[i].sleutel)) { weg.push(vorig.lijst[i]); wegSinds.push(nu); }
  for (let i = 0; i < vorig.weg.length; i++) {
    const p = vorig.weg[i];
    if (!nieuw.has(p.sleutel) && !was.has(p.sleutel) && vervaag(nu, vorig.wegSinds[i]) < 1) { weg.push(p); wegSinds.push(vorig.wegSinds[i]); }
  }
  return { lijst, sinds, weg, wegSinds };
}
