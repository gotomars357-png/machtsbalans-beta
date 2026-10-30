// Kern van de simulatie: deterministisch, tick-gebaseerd (1 tick = 1 in-game dag) en los van de weergave.
// Alles wat de speler doet loopt via orders, zodat een spel met dezelfde seed en orders exact herhaalbaar is.

import { nextRandom } from './rng.js';
import { aiTick, commandantenTick } from './ai.js';
import { eventsTick, schokkenTick, resolveEvent, schokModifiers } from './events.js';
import { ENGINE_VERSION } from './defaults.js';
import { bouwGeografie, tegelAfstand } from './geografie.js';
import {
  samenlevingTick, voorziening, woningCapaciteit, pandemieFactor, voerCampagneUit, voerNetwerkActieUit,
  voerComplotUit, voerValseVlagUit,
} from './samenleving.js';
import {
  legerTick, legerOnderhoud, oorlogenVan, train, beweegEenheden, verklaarOorlog, sluitVrede, partij,
} from './leger.js';
import { applyEffect } from './events.js';
import { regimeTick, regimeEffect, regimeVerwantschap, hervorm } from './regimes.js';
import { mediaTick, voerMediaActieUit, voerOvernameUit } from './media.js';
import { initContracten, contractenTick, voerContractUit, contractenAfdruk, aiContractenTick } from './contracten.js';
import { voerCyberUit, cyberTick } from './cyber.js';

export const MOEILIJKHEID = {
  makkelijk: { econ: 0.93, invloed: 0.6, oorlog: 0.2, naam: 'Makkelijk' },
  normaal: { econ: 1.0, invloed: 1.0, oorlog: 1, naam: 'Normaal' },
  moeilijk: { econ: 1.07, invloed: 1.5, oorlog: 1, naam: 'Moeilijk' },
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createGame(pack, settings = {}) {
  const s = {
    seed: 12345, moeilijkheid: 'normaal', onboarding: true, land: null,
    ...settings,
    systemen: { events: true, schokken: true, escalatie: true, contracten: true, ...(settings.systemen || {}) },
  };
  pack.gebouwIndex ??= Object.fromEntries(pack.gebouwen.map((g) => [g.id, g]));
  pack.resIndex ??= Object.fromEntries(pack.resources.map((r) => [r.id, r]));
  pack.geo ??= bouwGeografie(pack);
  pack.eenhedenIndex ??= Object.fromEntries(pack.eenheden.map((e) => [e.id, e]));

  const state = {
    pack, instellingen: s, dag: 0, rng: s.seed | 0,
    landen: [], blokken: [], speler: 0, spelerBlok: null,
    log: [], meldingen: [], orders: [], replay: null,
    pendingEvent: null, eventStatus: {}, eventKeten: [], schokken: [],
    geschiedenis: [], commandanten: [], volgendeCommandantId: 1,
    uitkomst: null, faseIdx: -1, ontgrendeld: new Set(), doelenGehaald: {}, overwinningTellers: {},
    afkoeling: {}, escalaties: [], provocaties: [],
    bezet: new Array(pack.geo.tegels.length).fill(null),
    eigenaar: Int16Array.from(pack.geo.tegels.map((t) => t.eig)),
    landTegels: pack.geo.landTegels.map((l) => [...l]),
    grensVersie: 0, animaties: [], kolonies: [], eenheden: [], volgendeEenheidId: 1, oorlogen: [], casusBelli: {}, wapenstilstand: {}, pandemie: null,
    balans: { investeren: 0, invloed: 0, reserve: 0 },
    wereldY: 0,
  };

  const stabStart = pack.resources.find((r) => r.id === pack.rollen.stabiliteit)?.start ?? 65;
  state.landen = pack.landen.map((l, idx) => {
    const voorraad = {};
    for (const r of pack.resources) {
      if (r.id === pack.rollen.stabiliteit) continue;
      voorraad[r.id] = r.start ?? 0;
    }
    voorraad[pack.rollen.geld] = l.kapitaal;
    const pers = pack.persoonlijkheden[l.persoonlijkheid];
    return {
      idx, id: l.id, naam: l.naam, blok: l.blok, kern: l.kern, persoonlijkheid: l.persoonlijkheid, leider: l.leider,
      L: l.bevolking, A: l.techFactor, gebouwen: {}, plaatsingen: [], effSom: {}, bouw: [], voorraad,
      stab: stabStart, stabDoel: stabStart,
      belasting: pers.ai?.belasting ?? pack.model.belasting_start,
      verdeling: pers.ai?.verdeling ?? pack.model.verdeling_start,
      loyaliteit: { ...l.loyaliteit }, basis: { ...l.loyaliteit },
      alignment: null, vast: false, Y: 0, Yhist: [], groei: 0, ratio: {}, netto: {}, inkomen: 0,
      effecten: [], afkoeling: {}, moeheid: {}, handel: [], vorderingen: [], modifiers: [], uitspelen: false,
      regime: l.regime, laatsteVerkiezing: -((idx * 97) % 400), revoluties: 0,
      media: {}, factcheck: 0, moraal: pack.model.moraal_basis, moraalDoel: pack.model.moraal_basis, moraalFactoren: [],
      training: [], complot: 0, controle: 0, weerbaarheid: 0, netwerken: {}, basisWoningen: l.bevolking * pack.model.basis_woningen,
    };
  });

  // Hoofdsteden en startgebouwen krijgen een vaste plek op de kaart.
  for (const c of state.landen) {
    const h = pack.geo.hoofdstad[c.idx];
    if (h >= 0) state.bezet[h] = { land: c.idx, hoofdstad: true };
    for (const [g, n] of Object.entries(pack.landen[c.idx].gebouwen)) {
      if (!pack.gebouwIndex[g]) continue;
      for (let i = 0; i < n; i++) plaats(state, c, g, kiesTegel(state, c, g));
    }
    herbereken(state, c);
  }

  const spelerIdx = state.landen.findIndex((l) => l.id === s.land);
  initContracten(state);
  state.speler = spelerIdx >= 0 ? spelerIdx : state.landen.findIndex((l, i) => pack.landen[i].speelbaar);
  const speler = state.landen[state.speler];
  state.spelerBlok = speler.blok;
  speler.belasting = pack.model.belasting_start;
  speler.verdeling = pack.model.verdeling_start;

  state.blokken = pack.blokken.map((b) => {
    const leider = b.id === state.spelerBlok
      ? speler
      : state.landen.find((l) => l.blok === b.id && l.kern) ?? state.landen.find((l) => l.blok === b.id);
    if (leider) leider.vast = true;
    return { id: b.id, naam: b.naam, kleur: b.kleur, spanning: 0, leider: leider ? leider.idx : -1, leden: 0, Y: 0, aandeel: 0 };
  });
  speler.vast = true;

  for (const c of state.landen) {
    c.Y = productie(state, c, {}, 1);
    c.alignment = bepaalAlignment(state, c);
  }
  faseTick(state, true);
  aggregeerBlokken(state);
  registreerGeschiedenis(state);
  return state;
}

// ---------- hulpfuncties die ook door de UI gebruikt worden ----------

export function isOntgrendeld(state, sleutel) {
  const genoemd = state.pack.verhaal.fasen.some((f) => (f.ontgrendelt || []).includes(sleutel));
  return !genoemd || state.ontgrendeld.has(sleutel);
}

export function opslagMax(state, c, resId) {
  const r = state.pack.resIndex[resId];
  if (!r || r.opslag_max == null) return Infinity;
  let cap = r.opslag_max;
  for (const g of state.pack.gebouwen) if (g.opslag_bonus) cap += g.opslag_bonus * (c.gebouwen[g.id] || 0);
  return cap;
}

export function kapitaalVoorraad(state, c) {
  let K = state.pack.model.kapitaal_basis;
  for (const g of state.pack.gebouwen) if (g.kapitaalvoorraad) K += g.kapitaalvoorraad * (c.effSom[g.id] || 0);
  return K;
}

export function bouwKosten(state, c, gebouwId) {
  const g = state.pack.gebouwIndex[gebouwId];
  const n = (c.gebouwen[gebouwId] || 0) + c.bouw.filter((b) => b.gebouw === gebouwId).length;
  const f = (1 + state.pack.model.kosten_schaal * n) * (1 - regimeEffect(state, c, 'bouw_korting'));
  const kosten = {};
  for (const [r, v] of Object.entries(g.kosten || {})) kosten[r] = Math.round(v * f);
  return kosten;
}

// ---------- plaatsing op de kaart ----------

// Knooppunten: de hoofdstad en gebouwen met 'knooppunt' (depots). Gebouwen ver van een knooppunt renderen minder.
export function knooppunten(state, c) {
  const n = [];
  const h = state.pack.geo.hoofdstad[c.idx];
  if (h >= 0) n.push(h);
  for (const p of c.plaatsingen) if (p.t >= 0 && state.pack.gebouwIndex[p.g].knooppunt) n.push(p.t);
  for (const k of state.kolonies) if (k.land === c.idx) n.push(k.t);
  return n;
}

export function afstandTotKnooppunt(state, c, t, nodes = knooppunten(state, c)) {
  let d = Infinity;
  for (const n of nodes) d = Math.min(d, tegelAfstand(state.pack.geo, n, t));
  return d;
}

export function rendement(state, c, gebouwId, t, nodes = knooppunten(state, c)) {
  if (t < 0) return 1;
  const g = state.pack.gebouwIndex[gebouwId];
  const M = state.pack.model;
  const bonus = g.terrein_bonus?.[state.pack.geo.tegels[t].terrein] ?? 1;
  if (g.knooppunt || !nodes.length) return bonus;
  const d = afstandTotKnooppunt(state, c, t, nodes);
  const r = d <= M.bereik ? 1 : Math.max(M.min_rendement, 1 - M.rendement_verlies * (d - M.bereik));
  return r * bonus;
}

export function herbereken(state, c) {
  const nodes = knooppunten(state, c);
  c.effSom = {};
  for (const p of c.plaatsingen) {
    p.eff = (p.uit ?? 0) > state.dag ? 0 : rendement(state, c, p.g, p.t, nodes); // uitgevallen door een cyberaanval
    c.effSom[p.g] = (c.effSom[p.g] || 0) + p.eff;
  }
}

export function tegelStatus(state, landIdx, gebouwId, t, nodes) {
  const geo = state.pack.geo;
  const g = state.pack.gebouwIndex[gebouwId];
  const tegel = geo.tegels[t];
  if (!tegel) return { ok: false, reden: 'Buiten de kaart.' };
  const eig = state.eigenaar[t];
  if (eig !== landIdx) return { ok: false, reden: eig === -1 ? 'Dit is water.' : eig === -2 ? 'Onbewoond land: sticht er eerst een kolonie met een kolonistenschip.' : 'Niet jouw grondgebied.' };
  if (state.bezet[t]) return { ok: false, reden: state.bezet[t].hoofdstad ? 'Hier ligt je hoofdstad.' : state.bezet[t].kolonie ? 'Hier ligt het centrum van een kolonie.' : 'Dit vakje is al bebouwd.' };
  if (g.terrein && !g.terrein.includes(tegel.terrein)) return { ok: false, reden: `${g.naam} vraagt ${g.terrein.join(' of ')}; dit is ${tegel.terrein}.` };
  if (nodes === false) return { ok: true };
  return { ok: true, rendement: rendement(state, state.landen[landIdx], gebouwId, t, nodes ?? knooppunten(state, state.landen[landIdx])) };
}

export function kiesTegel(state, c, gebouwId) {
  const geo = state.pack.geo;
  const h = geo.hoofdstad[c.idx];
  const nodes = knooppunten(state, c);
  let best = -1;
  let bestScore = -Infinity;
  for (const t of state.landTegels[c.idx]) {
    const st = tegelStatus(state, c.idx, gebouwId, t, nodes);
    if (!st.ok) continue;
    const score = st.rendement * 100 - (h >= 0 ? tegelAfstand(geo, h, t) * 0.3 : 0);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

export function vrijePlekken(state, c, gebouwId) {
  let n = 0;
  for (const t of state.landTegels[c.idx]) if (tegelStatus(state, c.idx, gebouwId, t, false).ok) n += 1;
  return n;
}

function plaats(state, c, gebouwId, t) {
  c.plaatsingen.push({ g: gebouwId, t, eff: 1 });
  c.gebouwen[gebouwId] = (c.gebouwen[gebouwId] || 0) + 1;
  if (t >= 0) state.bezet[t] = { land: c.idx, gebouw: gebouwId, bouw: false };
}

// Invloed op een grote economie kost meer: geldkosten schalen mee met de productie van het doelland.
export function actieKosten(state, h, t) {
  const f = Math.max(1, Math.sqrt((t?.Y ?? 0) / state.pack.model.prijs_referentie));
  const kosten = {};
  for (const [r, v] of Object.entries(h.kosten || {})) kosten[r] = r === state.pack.rollen.geld ? Math.round(v * f) : v;
  return kosten;
}

export function kanBetalen(c, kosten) {
  return Object.entries(kosten).every(([r, v]) => (c.voorraad[r] ?? 0) >= v);
}

export function betaal(c, kosten) {
  for (const [r, v] of Object.entries(kosten)) c.voorraad[r] -= v;
}

export function kostenInGeld(state, kosten) {
  // ruwe waardering om bestedingen te vergelijken
  let tot = 0;
  for (const [r, v] of Object.entries(kosten)) tot += r === state.pack.rollen.geld ? v : r === state.pack.rollen.tech ? v * 8 : v * 1.5;
  return tot;
}

export function blokVan(state, id) {
  return state.blokken.find((b) => b.id === id);
}

export function log(state, tekst, soort = 'info', melden = false) {
  const item = { dag: state.dag, tekst, soort };
  state.log.push(item);
  if (state.log.length > 400) state.log.shift();
  if (melden) state.meldingen.push(item);
}

// ---------- economie ----------

function econFactor(state, c) {
  return c.idx === state.speler ? 1 : MOEILIJKHEID[state.instellingen.moeilijkheid]?.econ ?? 1;
}

function blokBonus(state, c) {
  if (!c.alignment || c.alignment === 'zwevend') return 0;
  const b = blokVan(state, c.alignment);
  const M = state.pack.model;
  return Math.min(M.blok_bonus_max, M.blok_handelsbonus * Math.max(0, b.leden - 1));
}

function productie(state, c, ratio, modY) {
  const P = state.pack;
  const M = P.model;
  const K = kapitaalVoorraad(state, c);
  let f = 1;
  for (const r of P.resources) {
    const pf = r.tekort_effect?.productie_factor;
    if (pf == null || ratio[r.id] == null) continue;
    f *= pf + (1 - pf) * ratio[r.id];
  }
  const fStab = c.stab >= 50 ? 1 : 0.55 + (0.45 * c.stab) / 50;
  const samenleving = (1 + voorziening(state, c, 'productiviteit') + regimeEffect(state, c, 'productiviteit')) * (1 - c.complot * M.complot_productie) * pandemieFactor(state, c);
  return c.A * Math.pow(K, M.alpha) * Math.pow(c.L, M.beta) * f * fStab * samenleving * (1 + blokBonus(state, c)) * modY * econFactor(state, c);
}

function actieveModifier(c, type, dag) {
  let f = 1;
  let som = 0;
  c.modifiers = c.modifiers.filter((m) => m.tot > dag);
  for (const m of c.modifiers) {
    if (m.type !== type) continue;
    if (type === 'stabiliteit_doel') som += m.waarde;
    else f *= m.waarde;
  }
  return type === 'stabiliteit_doel' ? som : f;
}

function economieTick(state, c, schok) {
  const P = state.pack;
  const M = P.model;
  const R = P.rollen;
  const gross = {};
  const vraag = {};
  const prodMult = (r, g) => (schok.uitgezonderd[g.id] ? 1 : schok.productie[r] ?? 1);

  for (const g of P.gebouwen) {
    const n = c.gebouwen[g.id] || 0;
    if (!n) continue;
    const ne = c.effSom[g.id] || 0;
    for (const [r, v] of Object.entries(g.productie || {})) gross[r] = (gross[r] || 0) + ne * v * prodMult(r, g);
    for (const [r, v] of Object.entries(g.verbruik || {})) vraag[r] = (vraag[r] || 0) + n * v;
  }
  const eEcon = c.Y * M.energie_per_productie;
  const fEcon = c.L * M.voedsel_per_inwoner;
  vraag[R.energie] = (vraag[R.energie] || 0) + eEcon;
  vraag[R.voedsel] = (vraag[R.voedsel] || 0) + fEcon;

  const ratio = {};
  for (const r of P.resources) {
    if (r.id === R.geld || r.id === R.stabiliteit) continue;
    const d = vraag[r.id] || 0;
    ratio[r.id] = d <= 0 ? 1 : Math.min(1, ((c.voorraad[r.id] || 0) + (gross[r.id] || 0)) / d);
  }

  const prod = {};
  const verbruik = {};
  for (const g of P.gebouwen) {
    const n = c.gebouwen[g.id] || 0;
    if (!n) continue;
    const ne = c.effSom[g.id] || 0;
    let eff = 1;
    for (const r of Object.keys(g.verbruik || {})) eff = Math.min(eff, ratio[r]);
    for (const [r, v] of Object.entries(g.productie || {})) prod[r] = (prod[r] || 0) + ne * v * prodMult(r, g) * eff;
    for (const [r, v] of Object.entries(g.verbruik || {})) verbruik[r] = (verbruik[r] || 0) + n * v * eff;
  }
  verbruik[R.energie] = (verbruik[R.energie] || 0) + eEcon * ratio[R.energie];
  verbruik[R.voedsel] = (verbruik[R.voedsel] || 0) + fEcon * ratio[R.voedsel];

  for (const r of Object.keys(ratio)) {
    const netto = (prod[r] || 0) - (verbruik[r] || 0);
    c.netto[r] = netto;
    c.voorraad[r] = clamp((c.voorraad[r] || 0) + netto, 0, opslagMax(state, c, r));
  }
  c.ratio = ratio;
  c.vraag = vraag;

  // Productie: Y = A * K^alpha * L^beta, gedempt door tekorten en lage stabiliteit.
  const modY = actieveModifier(c, 'productie', state.dag) * schok.productie_factor;
  c.Y = productie(state, c, ratio, modY);
  c.Yhist.push(c.Y);
  if (c.Yhist.length > M.groei_venster + 1) c.Yhist.shift();

  // Geld
  const geld = R.geld;
  const belasting = c.Y * c.belasting * schok.inkomen_factor;
  const sociaal = belasting * c.verdeling;
  let handel = 0;
  c.handel = c.handel.filter((h) => h.tot > state.dag);
  let handelBonus = 1 + regimeEffect(state, c, 'handel_bonus');
  for (const g of P.gebouwen) if (g.handel_bonus) handelBonus += g.handel_bonus * (c.effSom[g.id] || 0);
  for (const h of c.handel) handel += h.perDag * schok.inkomen_factor * handelBonus;
  handel += (prod[geld] || 0) * schok.inkomen_factor;
  let leningen = 0;
  for (const v of c.vorderingen) {
    const schuldenaar = state.landen[v.van];
    schuldenaar.voorraad[geld] -= v.perDag;
    leningen += v.perDag;
    v.dagen -= 1;
  }
  c.vorderingen = c.vorderingen.filter((v) => v.dagen > 0);
  let onderhoud = 0;
  for (const g of P.gebouwen) onderhoud += (c.gebouwen[g.id] || 0) * (g.onderhoud ?? M.onderhoud_per_gebouw);
  onderhoud += legerOnderhoud(state, c);
  c.onderhoud = onderhoud;
  c.inkomen = belasting - sociaal + handel + leningen - onderhoud;
  c.voorraad[geld] += c.inkomen;
  if (c.voorraad[geld] < 0) c.voorraad[geld] *= 1 + M.rente;

  // Technologie: A_{t+1} = A_t * (1 + g * C_t / Y_t)
  const C = (prod[R.tech] || 0) * M.tech_waarde;
  c.A *= 1 + (M.g * C) / Math.max(c.Y, 1) + voorziening(state, c, 'tech_groei') + regimeEffect(state, c, 'tech_groei');
  if (c.A > 1) c.A *= 1 - M.tech_veroudering; // veroudering eet alleen voorsprong op
  c.techInvestering = C;

  // Stabiliteit: beweegt langzaam naar een doelwaarde.
  let doel = M.stab_basis + M.stab_verdeling * c.verdeling - M.stab_belasting * (c.belasting - M.belasting_neutraal);
  c.stabFactoren = [];
  for (const r of P.resources) {
    const se = r.tekort_effect?.stabiliteit;
    if (se == null || ratio[r.id] == null || ratio[r.id] >= 1) continue;
    const d = se * (1 - ratio[r.id]);
    doel += d;
    c.stabFactoren.push([`Tekort ${r.naam.toLowerCase()}`, d]);
  }
  c.groei = c.Yhist.length > M.groei_venster ? c.Y / c.Yhist[0] - 1 : 0;
  if (c.groei > M.groei_drempel) {
    const d = -Math.min(25, (c.groei - M.groei_drempel) * M.groei_straf);
    doel += d;
    c.stabFactoren.push(['Te snelle groei', d]);
  }
  if (c.voorraad[geld] < 0) {
    const d = -Math.min(20, -c.voorraad[geld] / Math.max(5, belasting));
    doel += d;
    c.stabFactoren.push(['Schuld', d]);
  }
  if (c.alignment && c.alignment !== 'zwevend') {
    const b = blokVan(state, c.alignment);
    const veilig = Math.min(6, b.leden * 0.5);
    doel += veilig - b.spanning * 0.15;
    if (b.spanning > 1) c.stabFactoren.push(['Spanning in blok', -b.spanning * 0.15]);
  }
  if (c.uitspelen) { doel -= 6; c.stabFactoren.push(['Speelt blokken uit', -6]); }
  const voorzieningen = voorziening(state, c, 'stabiliteit');
  if (voorzieningen) { doel += voorzieningen; c.stabFactoren.push(['Voorzieningen', voorzieningen]); }
  if (c.complot > 2) { const d = -c.complot * M.complot_stab; doel += d; c.stabFactoren.push(['Complotdenken', d]); }
  const oorlogen = oorlogenVan(state, c).length;
  if (oorlogen) { const d = -M.oorlog_moeheid * oorlogen * regimeEffect(state, c, 'oorlog_moeheid', 1); doel += d; c.stabFactoren.push(['Oorlog', d]); }
  const regimeStab = regimeEffect(state, c, 'stabiliteit');
  if (regimeStab) { doel += regimeStab; c.stabFactoren.push(['Regime', regimeStab]); }
  if (state.pandemie?.besmet[c.idx]) { doel -= 3; c.stabFactoren.push([state.pandemie.naam, -3]); }
  const mod = actieveModifier(c, 'stabiliteit_doel', state.dag);
  if (mod) { doel += mod; c.stabFactoren.push(['Gebeurtenissen', mod]); }
  c.stabDoel = clamp(doel, 0, 100);
  c.stab = clamp(c.stab + (c.stabDoel - c.stab) * M.stab_snelheid, 0, 100);

  // Bevolking groeit bij voedseloverschot en krimpt bij tekort.
  const rf = ratio[R.voedsel];
  const groei = rf >= 1 ? M.bevolkingsgroei + voorziening(state, c, 'bevolkingsgroei') : -5 * M.bevolkingsgroei * (1 - rf);
  const cap = woningCapaciteit(state, c);
  c.L = groei > 0 && c.L >= cap ? c.L : c.L * (1 + groei);
  if (c.L > cap * 1.02) c.L *= 0.999; // overbevolking loopt langzaam terug

  // Bouw afronden
  let klaar = false;
  for (const b of c.bouw) {
    if (b.klaar <= state.dag) {
      plaats(state, c, b.gebouw, b.tegel);
      klaar = true;
      if (c.idx === state.speler) log(state, `${P.gebouwIndex[b.gebouw].naam} is klaar.`, 'goed');
    }
  }
  c.bouw = c.bouw.filter((b) => b.klaar > state.dag);
  if (klaar) herbereken(state, c);

}

// ---------- loyaliteit en blokken ----------

function bepaalAlignment(state, c) {
  if (c.vast) return c.blok;
  let top = null;
  let best = -1;
  let tweede = -1;
  for (const b of state.blokken) {
    const l = c.loyaliteit[b.id];
    if (l > best) { tweede = best; best = l; top = b.id; } else if (l > tweede) tweede = l;
  }
  // Hysterese: aansluiten vraagt de drempel plus een kleine voorsprong, loslaten gebeurt pas ruim eronder.
  const drempel = state.pack.model.drempel_alignment;
  const huidig = c.alignment;
  if (huidig && huidig !== 'zwevend') {
    const l = c.loyaliteit[huidig];
    if (l >= drempel - 5 && l >= best - 3) return huidig;
  }
  return best >= drempel && best - tweede >= 3 ? top : 'zwevend';
}

function buren(state, c) {
  c.buren ??= state.pack.kaart.handelsroutes
    .filter(([a, b]) => a === c.id || b === c.id)
    .map(([a, b]) => state.landen.find((l) => l.id === (a === c.id ? b : a)))
    .filter(Boolean);
  return c.buren;
}

function loyaliteitTick(state) {
  const M = state.pack.model;
  for (const c of state.landen) {
    if (c.vast) { c.effecten = []; continue; }
    for (const b of state.blokken) {
      let l = c.loyaliteit[b.id];
      l += (c.basis[b.id] - l) * M.loyaliteit_verval;
      if (c.alignment === b.id) l += Math.min(0.1, M.blok_zwaartekracht * b.leden);
      l += regimeVerwantschap(state, c, b.id) * M.regime_affiniteit;
      for (const n of buren(state, c)) if (n.alignment === b.id) l += M.route_trek;
      c.loyaliteit[b.id] = l;
    }
    for (const b of Object.keys(c.moeheid)) c.moeheid[b] *= 0.97;
    for (const e of c.effecten) {
      c.loyaliteit[e.blok] += e.perDag;
      e.dagen -= 1;
    }
    c.effecten = c.effecten.filter((e) => e.dagen > 0);
    for (const b of state.blokken) c.loyaliteit[b.id] = clamp(c.loyaliteit[b.id], 0, 100);

    const sorted = state.blokken.map((b) => c.loyaliteit[b.id]).sort((a, b) => b - a);
    c.uitspelen = sorted.length > 1 && sorted[1] >= 40 && sorted[0] - sorted[1] < 8;

    const nieuw = bepaalAlignment(state, c);
    if (nieuw !== c.alignment) {
      const oud = c.alignment;
      c.alignment = nieuw;
      const naam = nieuw === 'zwevend' ? 'wordt weer zwevend' : `sluit zich aan bij ${blokVan(state, nieuw).naam}`;
      const soort = nieuw === state.spelerBlok ? 'goed' : oud === state.spelerBlok ? 'slecht' : 'info';
      log(state, `${c.naam} ${naam}.`, soort, true);
    }
  }
}

function aggregeerBlokken(state) {
  let wereld = 0;
  for (const b of state.blokken) { b.leden = 0; b.Y = 0; }
  for (const c of state.landen) {
    wereld += c.Y;
    if (c.alignment && c.alignment !== 'zwevend') {
      const b = blokVan(state, c.alignment);
      b.leden += 1;
      b.Y += c.Y;
    }
  }
  state.wereldY = wereld;
  for (const b of state.blokken) {
    b.aandeel = wereld > 0 ? b.Y / wereld : 0;
    b.spanning = Math.max(0, b.spanning - state.pack.model.spanning_verval);
    const leden = state.landen.filter((c) => c.alignment === b.id && !c.vast);
    b.cohesie = leden.length ? leden.reduce((s, c) => s + c.loyaliteit[b.id], 0) / leden.length : 100;
  }
}

// ---------- fasen, doelen en overwinning ----------

function faseTick(state, start = false) {
  const fasen = state.pack.verhaal.fasen;
  const onboarding = state.instellingen.onboarding;
  while (state.faseIdx + 1 < fasen.length && (!onboarding || fasen[state.faseIdx + 1].dag <= state.dag)) {
    state.faseIdx += 1;
    const f = fasen[state.faseIdx];
    for (const k of f.ontgrendelt || []) state.ontgrendeld.add(k);
    if (!start || state.faseIdx > 0) log(state, `Nieuwe fase: ${f.naam}. ${f.tekst ?? ''}`, 'fase', onboarding && !start);
  }
}

export function doelVoortgang(state, d) {
  const c = state.landen[state.speler];
  const v = d.voorwaarde || {};
  if (v.gebouw) return Math.min(1, (c.gebouwen[v.gebouw] || 0) / v.minimaal);
  if (v.productie_x) return Math.min(1, (c.Y / state.startY - 1) / (v.productie_x - 1));
  if (v.tech_factor) return Math.min(1, Math.max(0, (c.A - 1) / (v.tech_factor - 1)));
  if (v.resource) return Math.min(1, (c.voorraad[v.resource] || 0) / v.boven);
  if (v.aantal_landen) return Math.min(1, blokVan(state, state.spelerBlok).leden / v.aantal_landen);
  if (v.stabiliteit) return Math.min(1, c.stab / v.stabiliteit);
  return 0;
}

function doelenTick(state) {
  state.startY ??= state.landen[state.speler].Y;
  for (const d of state.pack.verhaal.doelen || []) {
    if (state.doelenGehaald[d.id]) continue;
    if (doelVoortgang(state, d) >= 1) {
      state.doelenGehaald[d.id] = state.dag;
      log(state, `Doel gehaald: ${d.tekst}`, 'goed', true);
    }
  }
}

function overwinningTick(state) {
  const V = state.pack.verhaal;
  const speler = state.landen[state.speler];
  if (speler.revoluties >= 2) {
    state.uitkomst = { spelerWint: false, reden: 'Regeringsval', tekst: 'Je land heeft twee revoluties doorgemaakt. Je bent de macht kwijt.', dag: state.dag };
    return;
  }
  for (const o of V.overwinning || []) {
    if (state.dag < (o.min_dag ?? 300)) continue;
    for (const b of state.blokken) {
      let gehaald = false;
      if (o.type === 'aandeel_productie') {
        const key = `${o.type}|${b.id}`;
        state.overwinningTellers[key] = b.aandeel >= o.drempel ? (state.overwinningTellers[key] || 0) + 1 : 0;
        gehaald = state.overwinningTellers[key] >= (o.duur_dagen ?? 1);
      } else if (o.type === 'aantal_landen') {
        gehaald = b.leden >= o.drempel;
      } else if (o.type === 'tech_factor') {
        gehaald = state.landen.some((c) => c.blok === b.id && c.kern && c.A >= o.drempel);
      }
      if (gehaald) {
        eindig(state, b.id, o.naam);
        return;
      }
    }
  }
  if (state.dag >= V.dag_limiet) {
    const top = [...state.blokken].sort((a, b) => b.aandeel - a.aandeel)[0];
    eindig(state, top.id, 'Grootste aandeel bij het einde van de tijdlijn');
  }
}

function eindig(state, blokId, reden) {
  const b = blokVan(state, blokId);
  const wint = blokId === state.spelerBlok;
  state.uitkomst = {
    spelerWint: wint, winnaar: blokId, reden, dag: state.dag,
    tekst: wint ? `${b.naam} heeft gewonnen: ${reden.toLowerCase()}.` : `${b.naam} heeft de machtsbalans naar zich toe getrokken: ${reden.toLowerCase()}.`,
  };
  log(state, state.uitkomst.tekst, wint ? 'goed' : 'slecht', true);
}

function registreerGeschiedenis(state) {
  const c = state.landen[state.speler];
  const aandelen = {};
  for (const b of state.blokken) aandelen[b.id] = b.aandeel;
  state.geschiedenis.push({ dag: state.dag, Y: c.Y, A: c.A, stab: c.stab, geld: c.voorraad[state.pack.rollen.geld], aandelen });
}

// ---------- de tick ----------

export function tick(state) {
  if (state.uitkomst || state.pendingEvent) return false;
  state.dag += 1;
  for (const u of state.eenheden) { u.px = u.x; u.py = u.y; }
  const schok = schokModifiers(state);
  const speler = state.landen[state.speler];
  const geldVoor = speler.voorraad[state.pack.rollen.geld];
  cyberTick(state);
  for (const c of state.landen) economieTick(state, c, schok);
  contractenTick(state);
  const inkomen = speler.voorraad[state.pack.rollen.geld] - geldVoor;
  samenlevingTick(state);
  mediaTick(state);
  regimeTick(state);
  loyaliteitTick(state);
  aggregeerBlokken(state);
  faseTick(state);
  aiTick(state);
  aiContractenTick(state);
  legerTick(state);
  commandantenTick(state);
  if (state.instellingen.systemen.schokken) schokkenTick(state);
  if (state.instellingen.systemen.events) eventsTick(state);
  doelenTick(state);
  overwinningTick(state);

  const bal = state.balans;
  bal.investeren *= 0.97; bal.invloed *= 0.97; bal.reserve *= 0.97;
  bal.reserve += Math.max(0, inkomen) * 0.03;
  if (state.dag % 5 === 0) {
    registreerGeschiedenis(state);
    if (state.geschiedenis.length > 1000) state.geschiedenis.splice(0, state.geschiedenis.length - 1000);
  }
  return true;
}

// Eén dag vooruit inclusief eventuele replay-orders die op deze dag gegeven zijn.
export function stapDag(state) {
  if (state.replay) voerReplayOrdersUit(state);
  return tick(state);
}

function voerReplayOrdersUit(state) {
  while (state.replay.length && state.replay[0].dag <= state.dag) {
    const o = state.replay.shift();
    const { dag, ...order } = o;
    applyOrder(state, order);
    state.orders.push(o);
  }
}

// ---------- orders ----------

export function issueOrder(state, order) {
  const res = applyOrder(state, order);
  if (res.ok) state.orders.push({ dag: state.dag, ...order });
  return res;
}

export function applyOrder(state, o) {
  // Afzender van de order; zonder `land` blijft het de speler, zodat oude replays en opslagen kloppen.
  const s = o.land ?? state.speler;
  if (!state.landen[s]) return { ok: false, reden: `Onbekend land '${o.land}'.` };
  switch (o.type) {
    case 'bouw': return bouw(state, s, o.gebouw, o.tegel);
    case 'beleid': return beleid(state, s, o);
    case 'hefboom': return voerHefboomUit(state, s, o.doel, o.actie);
    case 'escalatie': return voerEscalatieUit(state, s, o.doel, o.actie, o);
    case 'deescalatie': return deescaleer(state, s);
    case 'keuze': return resolveEvent(state, o.index, s);
    case 'commandant': return nieuweCommandant(state, s, o);
    case 'commandant_stop': return stopCommandant(state, s, o.id);
    case 'campagne': return voerCampagneUit(state, s, o.actie, applyEffect);
    case 'hervorming': return hervorm(state, s, o.naar);
    case 'media': return voerMediaActieUit(state, s, o.doel, o.actie);
    case 'overname': return voerOvernameUit(state, s, o.doel, o.actie);
    case 'netwerk': return voerNetwerkActieUit(state, s, o.doel, o.actie);
    case 'contract': return voerContractUit(state, s, o);
    case 'train': return train(state, s, o.eenheid);
    case 'beweeg': return beweegEenheden(state, s, o.eenheden, o.tegel);
    case 'vrede': {
      const i = state.oorlogen.findIndex((x) => [x.a, x.b].includes(o.met) && [x.a, x.b].includes(partij(state, state.landen[s])));
      return i < 0 ? { ok: false, reden: 'Geen oorlog met deze partij.' } : sluitVrede(state, s, i);
    }
    default: return { ok: false, reden: `Onbekende order '${o.type}'.` };
  }
}

export function bouw(state, landIdx, gebouwId, tegel = null) {
  const c = state.landen[landIdx];
  const g = state.pack.gebouwIndex[gebouwId];
  if (!g) return { ok: false, reden: 'Onbekend gebouw.' };
  if (!isOntgrendeld(state, gebouwId)) return { ok: false, reden: 'Nog niet beschikbaar in deze fase.' };
  if (c.bouw.length >= state.pack.model.max_bouw) return { ok: false, reden: `Maximaal ${state.pack.model.max_bouw} projecten tegelijk.` };
  const kosten = bouwKosten(state, c, gebouwId);
  if (!kanBetalen(c, kosten)) return { ok: false, reden: 'Onvoldoende middelen.' };
  const t = tegel == null ? kiesTegel(state, c, gebouwId) : tegel;
  if (t < 0) return { ok: false, reden: `Geen geschikte grond vrij voor ${g.naam.toLowerCase()}.` };
  const st = tegelStatus(state, landIdx, gebouwId, t);
  if (!st.ok) return st;
  betaal(c, kosten);
  c.bouw.push({ gebouw: gebouwId, tegel: t, start: state.dag, klaar: state.dag + (g.bouwtijd ?? 5) });
  state.bezet[t] = { land: landIdx, gebouw: gebouwId, bouw: true };
  if (landIdx === state.speler) state.balans.investeren += kostenInGeld(state, kosten) * 0.03;
  return { ok: true };
}

function beleid(state, landIdx, o) {
  const c = state.landen[landIdx];
  if (o.belasting != null) c.belasting = clamp(+o.belasting, 0.08, 0.4);
  if (o.verdeling != null) c.verdeling = clamp(+o.verdeling, 0, 0.4);
  return { ok: true };
}

export function hefboomStatus(state, payerIdx, doelIdx, h) {
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  if (!t || t === payer) return { ok: false, reden: 'Kies een ander land.' };
  if (t.vast) return { ok: false, reden: 'Kernland van een blok: niet over te halen.' };
  if (payerIdx === state.speler && !isOntgrendeld(state, 'invloed')) return { ok: false, reden: 'Invloed komt vrij in een latere fase.' };
  const af = t.afkoeling[`${h.id}|${blok}`] ?? 0;
  if (af > state.dag) return { ok: false, reden: `Afkoeling: nog ${af - state.dag} dagen.`, afkoeling: af - state.dag };
  if (!kanBetalen(payer, actieKosten(state, h, t))) return { ok: false, reden: 'Onvoldoende middelen.' };
  return { ok: true };
}

export function verwachteWinst(state, payerIdx, doelIdx, h) {
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  const pers = state.pack.persoonlijkheden[t.persoonlijkheid];
  const sens = pers.gevoeligheid?.[h.hefboom] ?? 1;
  const cur = t.loyaliteit[blok];
  const afnemend = clamp((105 - cur) / 70, 0.15, 1.2);
  const kern = t.kern && t.blok !== blok ? 0.35 : 1;
  const spanning = 1 - Math.min(0.5, blokVan(state, blok).spanning / 200);
  const uitspeel = t.uitspelen ? 1.2 : 1;
  const moeheid = 1 / (1 + state.pack.model.diplomatieke_moeheid * (t.moeheid[blok] || 0));
  const regime = t.regime === payer.regime ? 1 + state.pack.model.regime_hefboom : 1 - state.pack.model.regime_hefboom * 0.5;
  return h.loyaliteit * sens * afnemend * kern * spanning * uitspeel * moeheid * regime;
}

export function voerHefboomUit(state, payerIdx, doelIdx, actieId) {
  const h = state.pack.acties.hefbomen.find((x) => x.id === actieId);
  if (!h) return { ok: false, reden: 'Onbekende actie.' };
  const st = hefboomStatus(state, payerIdx, doelIdx, h);
  if (!st.ok) return st;
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  const R = state.pack.rollen;
  const winst = verwachteWinst(state, payerIdx, doelIdx, h);
  const kosten = actieKosten(state, h, t);
  betaal(payer, kosten);
  t.effecten.push({ blok, perDag: winst / (h.duur || 20), dagen: h.duur || 20 });
  for (const b of state.blokken) if (b.id !== blok) t.loyaliteit[b.id] = Math.max(0, t.loyaliteit[b.id] - winst * 0.15);
  t.afkoeling[`${h.id}|${blok}`] = state.dag + (h.afkoeling ?? 30);
  t.moeheid[blok] = (t.moeheid[blok] || 0) + 1;

  if (h.handel) {
    const tot = state.dag + h.handel.dagen;
    payer.handel.push({ met: t.idx, perDag: h.handel.inkomen_per_dag, tot });
    t.handel.push({ met: payer.idx, perDag: h.handel.inkomen_per_dag, tot });
  }
  if (h.lening) {
    t.voorraad[R.geld] += kosten[R.geld] ?? 0;
    const f = (kosten[R.geld] ?? 0) / Math.max(1, h.kosten?.[R.geld] ?? 1);
    payer.vorderingen.push({ van: t.idx, perDag: (h.lening.totaal * f) / h.lening.dagen, dagen: h.lening.dagen });
  }
  if (h.tech_overdracht) {
    t.A *= h.tech_overdracht;
    t.voorraad[R.tech] = (t.voorraad[R.tech] || 0) + (h.kosten?.[R.tech] ?? 0) * 0.5;
  }
  if (h.eigen_stabiliteit) payer.stab = clamp(payer.stab + h.eigen_stabiliteit, 0, 100);
  if (h.spanning) blokVan(state, blok).spanning += h.spanning;

  if (payerIdx === state.speler) {
    state.balans.invloed += kostenInGeld(state, kosten) * 0.03;
    log(state, `${h.naam} met ${t.naam}: loyaliteit +${winst.toFixed(1)} over ${h.duur} dagen.`, 'info');
  } else if (t.alignment === state.spelerBlok || t.loyaliteit[state.spelerBlok] > 40) {
    log(state, `${blokVan(state, blok).naam} sluit een ${h.naam.toLowerCase()} met ${t.naam}.`, 'slecht');
  }
  return { ok: true, winst };
}

export function escalatieStatus(state, payerIdx, doelIdx, e) {
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  if (!state.instellingen.systemen.escalatie) return { ok: false, reden: 'Escalatie staat uit in deze sessie.' };
  if (e.beschikbaar === false) return { ok: false, reden: 'Nog niet in dit prototype (vertical slice).' };
  if (payerIdx === state.speler && !isOntgrendeld(state, 'escalatie')) return { ok: false, reden: 'De escalatieladder opent in de fase Beslissen.' };
  if (!t || t === payer) return { ok: false, reden: 'Kies een ander land.' };
  if (t.alignment === blok) return { ok: false, reden: 'Dit land staat aan jouw kant.' };
  const af = state.afkoeling[`${blok}|${e.id}`] ?? 0;
  if (af > state.dag) return { ok: false, reden: `Afkoeling: nog ${af - state.dag} dagen.`, afkoeling: af - state.dag };
  if (!kanBetalen(payer, actieKosten(state, e, t))) return { ok: false, reden: 'Onvoldoende middelen.' };
  const sprong = e.trede > 1 && !state.escalaties.some((x) => x.blok === blok && x.doel === t.idx && x.trede === e.trede - 1 && state.dag - x.dag < 150);
  return { ok: true, sprong };
}

export function voerEscalatieUit(state, payerIdx, doelIdx, actieId, opties = {}) {
  const e = state.pack.acties.escalatie.find((x) => x.id === actieId);
  if (!e) return { ok: false, reden: 'Onbekende actie.' };
  const st = escalatieStatus(state, payerIdx, doelIdx, e);
  if (!st.ok) return st;
  if (e.type === 'oorlog') return verklaarOorlog(state, payerIdx, doelIdx, e, st);
  if (e.type === 'complot') return voerComplotUit(state, payerIdx, doelIdx, e, st);
  if (e.type === 'valse_vlag') return voerValseVlagUit(state, payerIdx, doelIdx, e, st);
  if (e.type === 'cyber') return voerCyberUit(state, payerIdx, doelIdx, e, opties);
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  const P = state.pack;
  const kosten = actieKosten(state, e, t);
  betaal(payer, kosten);
  const tol = (c) => P.persoonlijkheden[c.persoonlijkheid].druk_tolerantie ?? 1;

  const tb = t.alignment;
  if (tb && tb !== 'zwevend' && tb !== blok && e.doel_loyaliteit_blok) {
    if (!t.vast) t.effecten.push({ blok: tb, perDag: e.doel_loyaliteit_blok / tol(t) / 15, dagen: 15 });
  }
  if (!t.vast) t.loyaliteit[blok] = Math.max(0, t.loyaliteit[blok] - 3);
  t.stab = clamp(t.stab + (e.doel_stabiliteit || 0), 0, 100);

  const factor = st.sprong ? 2 : 1;
  for (const o of state.landen) {
    if (o === t || o.vast || o.alignment === blok) continue;
    o.loyaliteit[blok] = clamp(o.loyaliteit[blok] + ((e.derden_loyaliteit || 0) * factor) / tol(o), 0, 100);
  }
  let ontdekt = false;
  if (e.ontdekkans && nextRandom(state) < e.ontdekkans) {
    ontdekt = true;
    for (const o of state.landen) {
      if (o.vast) continue;
      o.loyaliteit[blok] = clamp(o.loyaliteit[blok] + (e.ontdekt_loyaliteit || 0) / tol(o), 0, 100);
    }
  }
  blokVan(state, blok).spanning += e.spanning || 0;
  if (tb && tb !== 'zwevend') {
    blokVan(state, tb).spanning += (e.spanning || 0) * 0.5;
    state.provocaties.push({ door: blok, tegen: tb, dag: state.dag, trede: e.trede });
  }
  state.afkoeling[`${blok}|${e.id}`] = state.dag + (e.afkoeling ?? 60);
  state.escalaties.push({ blok, doel: t.idx, trede: e.trede, dag: state.dag });

  const wie = payerIdx === state.speler ? 'Je zet' : `${blokVan(state, blok).naam} zet`;
  const soort = payerIdx === state.speler ? 'info' : 'slecht';
  log(state, `${wie} ${e.naam.toLowerCase()} in tegen ${t.naam}.${st.sprong ? ' Sprong op de ladder: dubbele politieke kosten.' : ''}`, soort, payerIdx !== state.speler);
  if (ontdekt) log(state, `De operatie tegen ${t.naam} is uitgekomen. Loyaliteit daalt overal.`, payerIdx === state.speler ? 'slecht' : 'goed', true);
  if (payerIdx === state.speler) state.balans.invloed += kostenInGeld(state, kosten) * 0.03;
  return { ok: true, ontdekt, sprong: st.sprong };
}

export function deescaleer(state, payerIdx) {
  const d = state.pack.acties.deescalatie;
  const payer = state.landen[payerIdx];
  const blok = payer.blok;
  const key = `${blok}|deescalatie`;
  if (!isOntgrendeld(state, 'escalatie')) return { ok: false, reden: 'De-escalatie hoort bij de fase Beslissen.' };
  if ((state.afkoeling[key] ?? 0) > state.dag) return { ok: false, reden: `Afkoeling: nog ${state.afkoeling[key] - state.dag} dagen.` };
  if (!kanBetalen(payer, d.kosten || {})) return { ok: false, reden: 'Onvoldoende middelen.' };
  betaal(payer, d.kosten || {});
  const b = blokVan(state, blok);
  const had = b.spanning;
  b.spanning = Math.max(0, b.spanning + d.spanning);
  if (had > 10) {
    for (const o of state.landen) if (!o.vast && o.alignment !== blok) o.loyaliteit[blok] = clamp(o.loyaliteit[blok] + d.zwevend_loyaliteit, 0, 100);
  }
  state.afkoeling[key] = state.dag + (d.afkoeling ?? 90);
  log(state, had > 10 ? 'De-escalatie: spanning daalt, zwevende landen waarderen het.' : 'De-escalatie: weinig spanning om af te bouwen.', 'info');
  return { ok: true };
}

function nieuweCommandant(state, s, o) {
  if (!isOntgrendeld(state, 'commandanten')) return { ok: false, reden: 'Commandanten komen vrij in een latere fase.' };
  const t = state.landen[o.doel];
  if (!t || t.vast || o.doel === s) return { ok: false, reden: 'Kies een zwevend of ander land.' };
  if (state.commandanten.some((c) => c.actief && c.doel === o.doel && (c.eigenaar ?? state.speler) === s)) return { ok: false, reden: 'Er werkt al een commandant aan dit land.' };
  const budget = Math.max(50, Math.round(+o.budget || 0));
  state.commandanten.push({
    id: state.volgendeCommandantId++, eigenaar: s, doel: o.doel, budget, besteed: 0, stijl: o.stijl === 'gedurfd' ? 'gedurfd' : 'zuinig',
    actief: true, rapport: [], start: state.dag,
  });
  log(state, `Commandant aangesteld voor ${t.naam} (budget ${budget}).`, 'info');
  return { ok: true };
}

function stopCommandant(state, s, id) {
  const c = state.commandanten.find((x) => x.id === id);
  if (!c || !c.actief) return { ok: false, reden: 'Geen actieve commandant.' };
  if ((c.eigenaar ?? state.speler) !== s) return { ok: false, reden: 'Deze commandant werkt voor een ander land.' };
  c.actief = false;
  c.rapport.push({ dag: state.dag, tekst: 'Teruggeroepen.' });
  return { ok: true };
}

// ---------- replays ----------

export function maakReplay(state) {
  return {
    formaat: 'machtsbalans-replay', engine: ENGINE_VERSION,
    pack: { id: state.pack.meta.id, versie: state.pack.meta.versie },
    instellingen: state.instellingen, orders: state.orders, einddag: state.dag,
    controle: vingerafdruk(state),
  };
}

// ---------- opslaan en laden ----------
// Een opslag is een replay tot vandaag: seed, instellingen en alle orders. Laden speelt die
// orders opnieuw af; door het determinisme komt exact dezelfde toestand terug.
export function maakOpslag(state) {
  return { ...maakReplay(state), formaat: 'machtsbalans-opslag', orders: state.orders.map((o) => ({ ...o })) };
}

export function laadOpslag(pack, opslag) {
  const state = createGame(pack, opslag.instellingen);
  state.replay = opslag.orders.map((o) => ({ ...o }));
  while (!state.uitkomst && state.dag < opslag.einddag) {
    const dag = state.dag;
    stapDag(state);
    // Een openstaande gebeurtenis zonder bijbehorende keuze-order: verder komen we niet.
    if (state.dag === dag && !(state.replay.length && state.replay[0].dag <= state.dag)) break;
  }
  // Orders die op de laatste dag na de tick gegeven zijn.
  voerReplayOrdersUit(state);
  const over = state.replay.length;
  state.replay = null;
  if (over) return { state, ok: false, reden: `${over} orders konden niet worden afgespeeld.` };
  if (vingerafdruk(state) !== opslag.controle) return { state, ok: false, reden: 'De geladen toestand wijkt af van de opslag (andere engine- of packversie?).' };
  return { state, ok: true };
}

export function vingerafdruk(state) {
  const parts = state.landen.map((c) => [c.moraal.toFixed(3), c.Y.toFixed(4), c.A.toFixed(6), c.stab.toFixed(4), c.alignment, Object.values(c.loyaliteit).map((v) => v.toFixed(3)).join(',')].join('|'));
  const leger = state.eenheden.map((u) => `${u.id}:${u.t}:${u.hp.toFixed(2)}`).join(',');
  const regimes = state.landen.map((c) => c.regime[0]).join('');
  const keten = state.eventKeten.length ? `#k${state.eventKeten.map((k) => `${k.id}@${k.dag}@${k.land}`).join(',')}` : '';
  return `${state.dag}#${state.rng}#${parts.join(';')}#${leger}#${state.oorlogen.length}#${regimes}#${state.kolonies.length}${contractenAfdruk(state)}${keten}`;
}
