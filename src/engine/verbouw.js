// Verbouwen en slopen (C15c): een afgebouwd gebouw gaat in twee stappen naar niveau 3, of wordt afgebroken.
// Verbouwen kost geld en tijd; zolang de steigers staan draait het gebouw op halve kracht. Daarna produceert het meer,
// maar het verbruikt en kost ook meer. Slopen geeft een deel van het geld terug, kost bij woningen en voorzieningen
// stabiliteit en kan niet als er een vijandelijk leger in de buurt staat. De sloopplaats is een paar dagen bezet.
// Alle getallen staan in model.verbouw (defaults.js). Deterministisch: geen toeval, lussen op index.
// Velden op een plaatsing: niveau (alleen als hoger dan 1) en verbouw = { naar, start, klaar }.
// Per land: sloop = [{ tegel, gebouw, klaar }]; op de kaart state.bezet[t] = { land, sloop, klaar } (zonder 'gebouw').
// Daarna: state.kavels = [{ tegel, gebouw }], een leeg kavel voor de kaart (zie zetKavel).

import {
  log, kanBetalen, betaal, herbereken, kostenInGeld, opslagMax, kapitaalVoorraad,
} from './sim.js';
import { regimeEffect } from './regimes.js';
import { brandhaardOp } from './brandhaarden.js';
import { inOorlog } from './leger.js';
import { tegelAfstand } from './geografie.js';

export function niveauVan(p) {
  return p?.niveau ?? 1;
}

export function verbouwModel(state) {
  return state.pack.model.verbouw ?? null;
}

export function isVerbouwbaar(g) {
  return !!g && (g.verbouwbaar ?? !(g.knooppunt || g.categorie === 'leger'));
}

// Aantal lopende verbouwingen van een land: die tellen mee voor het maximum aantal projecten tegelijk.
export function actieveVerbouw(c) {
  let n = 0;
  for (let i = 0; i < c.plaatsingen.length; i++) if (c.plaatsingen[i].verbouw) n += 1;
  return n;
}

function plaatsingIndex(c, t) {
  for (let i = 0; i < c.plaatsingen.length; i++) if (c.plaatsingen[i].t === t) return i;
  return -1;
}

// Verbouwstappen die het land al eerder zette (of nu zet) op andere gebouwen van dezelfde soort.
function eerdereStappen(c, p) {
  let n = 0;
  for (let i = 0; i < c.plaatsingen.length; i++) {
    const q = c.plaatsingen[i];
    if (q === p || q.g !== p.g) continue;
    n += niveauVan(q) - 1 + (q.verbouw ? 1 : 0);
  }
  return n;
}

export function verbouwKosten(state, c, p) {
  const V = verbouwModel(state);
  const g = state.pack.gebouwIndex[p.g];
  const f = V.kosten[niveauVan(p) - 1] * (1 + V.kosten_schaal * eerdereStappen(c, p)) * (1 - regimeEffect(state, c, 'bouw_korting'));
  const kosten = {};
  for (const [r, v] of Object.entries(g.kosten || {})) kosten[r] = Math.round(v * f);
  return kosten;
}

export function verbouwDagen(state, g, niveau) {
  const V = verbouwModel(state);
  return Math.max(1, Math.round((g.bouwtijd ?? 5) * V.bouwtijd[niveau - 1]));
}

// Ruwe waarde in geld per dag van één eenheid van een resource (dezelfde weging als kostenInGeld).
function prijs(state, r) {
  return kostenInGeld(state, { [r]: 1 });
}

// Wat het gebouw bij effectfactor f per dag opbrengt, in geld: productie, en kapitaalvoorraad via de belasting.
function brutoWaarde(state, c, p, g, f) {
  const basis = p.eff / effectNu(state, p); // rendement van de plek, zonder niveau of halve kracht
  let w = 0;
  for (const [r, v] of Object.entries(g.productie || {})) w += v * basis * f * prijs(state, r);
  if (g.kapitaalvoorraad) {
    const K = kapitaalVoorraad(state, c);
    w += (c.Y || 0) * c.belasting * state.pack.model.alpha * (g.kapitaalvoorraad * basis * f) / Math.max(1, K);
  }
  return w;
}

// De factor waarmee p.eff nu al vermenigvuldigd is (niveau en eventueel halve kracht).
function effectNu(state, p) {
  const V = verbouwModel(state);
  return (V.effect[niveauVan(p) - 1] || 1) * (p.verbouw ? V.tijdens : 1) || 1;
}

// Terugverdientijd in dagen van een stap naar `naar`: (kosten + verloren halve kracht) / (extra opbrengst - extra
// verbruik - extra onderhoud). null als het gebouw er in geld niets mee verdient (bijvoorbeeld een school).
export function terugverdientijd(state, c, p, kosten, naar) {
  const V = verbouwModel(state);
  const M = state.pack.model;
  const g = state.pack.gebouwIndex[p.g];
  const van = niveauVan(p);
  if ((p.uit ?? 0) > state.dag) return null;
  const nu = brutoWaarde(state, c, p, g, V.effect[van - 1]);
  const straks = brutoWaarde(state, c, p, g, V.effect[naar - 1]);
  let extraVerbruik = 0;
  for (const [r, v] of Object.entries(g.verbruik || {})) extraVerbruik += (V.verbruik[naar - 1] - V.verbruik[van - 1]) * v * prijs(state, r);
  const extraOnderhoud = (V.onderhoud[naar - 1] - V.onderhoud[van - 1]) * (g.onderhoud ?? M.onderhoud_per_gebouw);
  const netto = straks - nu - extraVerbruik - extraOnderhoud;
  if (!(netto > 0.01)) return null;
  const verlies = nu * (1 - V.tijdens) * verbouwDagen(state, g, van);
  const dagen = Math.ceil((kostenInGeld(state, kosten) + verlies) / netto);
  // Pas na jaren terug (review: industrie 2→3 gaf 7757 dagen) is in een potje geen terugverdientijd: dan geen getal.
  return dagen > 999 ? null : dagen;
}

// Waarom een tegel niet verbouwd of gesloopt kan worden, of de plaatsing als het wel kan.
function eigenPlaatsing(state, c, t) {
  if (!(t >= 0) || !state.pack.geo.tegels[t]) return { reden: 'Kies een afgebouwd gebouw van jezelf.' };
  const b = state.bezet[t];
  if (b?.sloop) return { reden: 'Hier wordt gesloopt.' };
  if (b?.hoofdstad) return { reden: 'De hoofdstad kun je niet verbouwen of slopen.' };
  if (b?.kolonie) return { reden: 'Het centrum van een kolonie kun je niet verbouwen of slopen.' };
  if (b?.bouw) return { reden: 'Dit gebouw is nog in aanbouw.' };
  if (state.eigenaar[t] !== c.idx) return { reden: 'Niet jouw grondgebied.' };
  const i = plaatsingIndex(c, t);
  if (i < 0) return { reden: 'Kies een afgebouwd gebouw van jezelf.' };
  return { i, p: c.plaatsingen[i] };
}

export function verbouwStatus(state, landIdx, t) {
  const c = state.landen[landIdx];
  const V = verbouwModel(state);
  if (!c || !V) return { ok: false, reden: 'Verbouwen zit niet in deze wereld.' };
  if (!state.instellingen.systemen?.verbouw) return { ok: false, reden: 'Verbouwen en slopen staan uit in deze sessie.' };
  const e = eigenPlaatsing(state, c, t);
  if (!e.p) return { ok: false, reden: e.reden };
  const p = e.p;
  const g = state.pack.gebouwIndex[p.g];
  if (!isVerbouwbaar(g)) return { ok: false, reden: `${g.naam} kun je niet verbouwen.` };
  const niveau = niveauVan(p);
  if (p.verbouw) return { ok: false, reden: `Wordt al verbouwd: nog ${Math.max(0, p.verbouw.klaar - state.dag)} dagen.`, niveau, bezig: true };
  if (niveau >= V.niveau_max) return { ok: false, reden: 'Al op het hoogste niveau.', niveau, max: true };
  const naar = niveau + 1;
  const kosten = verbouwKosten(state, c, p);
  const dagen = verbouwDagen(state, g, niveau);
  const terug = terugverdientijd(state, c, p, kosten, naar);
  const basis = { niveau, naar, kosten, dagen, terug };
  const max = state.pack.model.max_bouw;
  if (c.bouw.length + actieveVerbouw(c) >= max) return { ...basis, ok: false, reden: `Maximaal ${max} projecten tegelijk.` };
  if (!kanBetalen(c, kosten)) return { ...basis, ok: false, reden: 'Onvoldoende middelen.' };
  return { ...basis, ok: true };
}

export function voerVerbouwUit(state, landIdx, t) {
  const st = verbouwStatus(state, landIdx, t);
  if (!st.ok) return st;
  const c = state.landen[landIdx];
  const p = c.plaatsingen[plaatsingIndex(c, t)];
  betaal(c, st.kosten);
  p.verbouw = { naar: st.naar, start: state.dag, klaar: state.dag + st.dagen };
  herbereken(state, c);
  if (landIdx === state.speler) state.balans.investeren += kostenInGeld(state, st.kosten) * 0.03;
  return { ok: true, naar: st.naar, dagen: st.dagen };
}

// Dagelijks per land (vanuit economieTick): verbouwingen die vandaag klaar zijn. Geeft true als er iets klaar is.
export function verbouwTick(state, c) {
  let klaar = false;
  for (let i = 0; i < c.plaatsingen.length; i++) {
    const p = c.plaatsingen[i];
    if (!p.verbouw || p.verbouw.klaar > state.dag) continue;
    p.niveau = p.verbouw.naar;
    delete p.verbouw;
    klaar = true;
    if (c.idx === state.speler) log(state, `${state.pack.gebouwIndex[p.g].naam} verbouwd tot niveau ${p.niveau}.`, 'goed', true);
  }
  return klaar;
}

// Wat slopen oplevert: een deel van alles wat er ooit in het gebouw is gestoken (bouw plus verbouwstappen).
export function sloopOpbrengst(state, c, p) {
  const V = verbouwModel(state);
  const g = state.pack.gebouwIndex[p.g];
  let som = 1;
  for (let n = 1; n < niveauVan(p); n++) som += V.kosten[n - 1];
  const terug = {};
  for (const [r, v] of Object.entries(g.kosten || {})) {
    const x = Math.round(V.sloop_terug * v * som);
    if (x > 0) terug[r] = x;
  }
  return terug;
}

export function sloopStabiliteit(state, g) {
  const S = verbouwModel(state)?.sloop_stabiliteit || {};
  if (g.woningen) return S.woningen ?? null;
  if (g.categorie === 'maatschappij') return S.maatschappij ?? null;
  return null;
}

// Staat er een eenheid van een land waarmee c in oorlog is binnen de sloopafstand van tegel t?
function onderVuur(state, c, t, afstand) {
  const geo = state.pack.geo;
  for (let i = 0; i < state.eenheden.length; i++) {
    const u = state.eenheden[i];
    if (u.land === c.idx || !inOorlog(state, c, state.landen[u.land])) continue;
    if (tegelAfstand(geo, u.t, t) <= afstand) return true;
  }
  return false;
}

export function sloopStatus(state, landIdx, t) {
  const c = state.landen[landIdx];
  const V = verbouwModel(state);
  if (!c || !V) return { ok: false, reden: 'Slopen zit niet in deze wereld.' };
  if (!state.instellingen.systemen?.verbouw) return { ok: false, reden: 'Verbouwen en slopen staan uit in deze sessie.' };
  const e = eigenPlaatsing(state, c, t);
  if (!e.p) return { ok: false, reden: e.reden };
  const p = e.p;
  const g = state.pack.gebouwIndex[p.g];
  const basis = { opbrengst: sloopOpbrengst(state, c, p), stabiliteit: sloopStabiliteit(state, g), dagen: V.sloop_dagen };
  if (p.verbouw) return { ...basis, ok: false, reden: 'Maak eerst de verbouwing af.' };
  if (brandhaardOp(state, t)) return { ...basis, ok: false, reden: 'Hier woedt een brandhaard: pak die eerst aan.' };
  if (onderVuur(state, c, t, V.sloop_oorlog_afstand)) return { ...basis, ok: false, reden: 'Niet slopen onder vuur.' };
  return { ...basis, ok: true };
}

export function voerSloopUit(state, landIdx, t) {
  const st = sloopStatus(state, landIdx, t);
  if (!st.ok) return st;
  const c = state.landen[landIdx];
  const i = plaatsingIndex(c, t);
  const [p] = c.plaatsingen.splice(i, 1);
  const g = state.pack.gebouwIndex[p.g];
  c.gebouwen[p.g] -= 1;
  for (const [r, v] of Object.entries(st.opbrengst)) {
    const nu = c.voorraad[r] ?? 0;
    c.voorraad[r] = Math.min(nu + v, Math.max(nu, opslagMax(state, c, r)));
  }
  const klaar = state.dag + st.dagen;
  state.bezet[t] = { land: landIdx, sloop: p.g, klaar };
  (c.sloop ??= []).push({ tegel: t, gebouw: p.g, klaar });
  if (st.stabiliteit) c.modifiers.push({ type: 'stabiliteit_doel', waarde: st.stabiliteit.waarde, tot: state.dag + st.stabiliteit.dagen });
  herbereken(state, c);
  if (landIdx === state.speler) {
    const geld = state.pack.rollen.geld;
    const delen = Object.entries(st.opbrengst).map(([r, v]) => `${v} ${r === geld ? 'kapitaal' : (state.pack.resIndex[r]?.naam ?? r).toLowerCase()}`);
    log(state, `${g.naam} gesloopt${delen.length ? `: ${delen.join(' en ')} terug` : ''}.`, 'info', true);
  }
  return { ok: true, opbrengst: st.opbrengst };
}

// Snelle check vóór sloopOpruim, zodat een potje zonder sloop geen extra werk doet.
export function heeftSloop(state) {
  for (let i = 0; i < state.landen.length; i++) if (state.landen[i].sloop?.length) return true;
  return false;
}

// Dagelijks na de landenlus: sloopplaatsen die klaar zijn worden weer vrije grond. Over alle landen, ook
// gecapituleerde of landen zonder grond, en ongeacht wie het vakje nu bezit (een veroverde sloopplaats ook).
export function sloopOpruim(state) {
  for (let i = 0; i < state.landen.length; i++) {
    const c = state.landen[i];
    const lijst = c.sloop ?? [];
    if (!lijst.length) continue;
    let weg = false;
    for (let j = 0; j < lijst.length; j++) {
      const s = lijst[j];
      if (s.klaar > state.dag) continue;
      if (state.bezet[s.tegel]?.sloop) { state.bezet[s.tegel] = null; zetKavel(state, s.tegel, s.gebouw); }
      weg = true;
    }
    if (weg) c.sloop = lijst.filter((s) => s.klaar > state.dag);
  }
}

// Een opgeruimde sloopplaats blijft een leeg stadskavel: state.kavels = [{ tegel, gebouw }] (gebouw = wat er stond).
// Alleen voor de kaart: het wegennet houdt het vakje in de stad (zelfde straten en aansluitingen) en tekent er een
// braakliggend kavel. Voor de spelregels is het vakje gewoon vrij (bezet[t] = null), dus bouwen mag er weer; zolang er
// iets op staat telt bezet[t] en negeert de kaart het kavel. Bestaat pas na de eerste sloop, dus een potje zonder sloop
// (en de vingerafdruk) verandert niet. Komt via de replay vanzelf terug na laden.
function zetKavel(state, t, gebouw) {
  const lijst = state.kavels ??= [];
  for (let i = 0; i < lijst.length; i++) if (lijst[i].tegel === t) { lijst[i].gebouw = gebouw; return; }
  lijst.push({ tegel: t, gebouw });
}

// Achtervoegsel voor de vingerafdruk: leeg als er nooit verbouwd of gesloopt is.
export function verbouwAfdruk(state) {
  let sN = 0, vL = 0, sL = 0;
  for (let i = 0; i < state.landen.length; i++) {
    const c = state.landen[i];
    for (let j = 0; j < c.plaatsingen.length; j++) {
      const p = c.plaatsingen[j];
      sN += (p.niveau ?? 1) - 1;
      if (p.verbouw) vL += 1;
    }
    sL += (c.sloop ?? []).length;
  }
  return sN + vL + sL > 0 ? `#v${sN}-${vL}-${sL}` : '';
}
