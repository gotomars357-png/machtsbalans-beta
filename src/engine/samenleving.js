// Samenleving en schaduwpolitiek: maatschappelijke voorzieningen, informatiecontrole, complotdenken,
// geheime netwerken, valse-vlagoperaties en een pandemie. Alles is abstract: kosten, kansen en gevolgen.

import { nextRandom } from './rng.js';
import {
  log, blokVan, isOntgrendeld, kanBetalen, betaal, actieKosten, kostenInGeld, escalatieStatus,
} from './sim.js';
import { partij } from './leger.js';
import { regimeEffect } from './regimes.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Som van een gebouweigenschap over alle afgebouwde gebouwen, gewogen met hun rendement.
export function voorziening(state, c, veld) {
  let som = 0;
  for (const g of state.pack.gebouwen) if (g[veld]) som += g[veld] * (c.effSom[g.id] || 0);
  return som;
}

export function woningCapaciteit(state, c) {
  return c.basisWoningen + voorziening(state, c, 'woningen');
}

function tol(state, c) {
  return state.pack.persoonlijkheden[c.persoonlijkheid].druk_tolerantie ?? 1;
}

function routeBuren(state, c) {
  c.buren ??= state.pack.kaart.handelsroutes
    .filter(([a, b]) => a === c.id || b === c.id)
    .map(([a, b]) => state.landen.find((l) => l.id === (a === c.id ? b : a)))
    .filter(Boolean);
  return c.buren;
}

// ---------- dagelijkse tick ----------

export function samenlevingTick(state) {
  const M = state.pack.model;
  const landen = state.landen;

  // Complotdenken verspreidt zich langs handelsroutes; eerst alle deltas, dan toepassen (volgorde-onafhankelijk).
  const delta = landen.map(() => 0);
  for (const c of landen) {
    for (const n of routeBuren(state, c)) {
      const verschil = n.complot - c.complot;
      if (verschil > 0) delta[c.idx] += verschil * M.complot_verspreiding * (1 - Math.min(0.8, c.weerbaarheid / 60)) * regimeEffect(state, c, 'complot_gevoeligheid', 1);
    }
  }

  for (const c of landen) {
    c.weerbaarheid = voorziening(state, c, 'weerbaarheid') + regimeEffect(state, c, 'weerbaarheid');
    // Informatiecontrole zakt terug naar wat je media-infrastructuur en je regime dragen.
    const basisControle = Math.min(regimeEffect(state, c, 'informatiecontrole_max', 90), voorziening(state, c, 'informatiecontrole') + regimeEffect(state, c, 'informatiecontrole'));
    c.controle += (basisControle - c.controle) * M.controle_snelheid;
    // Veel staatscontrole wekt zelf argwaan.
    const argwaan = c.controle > 50 ? (c.controle - 50) * 0.004 : 0;
    const besmet = state.pandemie?.besmet[c.idx] ? state.pandemie.effect.complot ?? 0 : 0;
    c.complot += delta[c.idx] + argwaan + besmet - (M.complot_verval + c.complot * 0.003 + c.weerbaarheid * 0.004);
    c.complot = clamp(c.complot, 0, 100);

    // Geheime netwerken trekken loyaliteit naar hun blok en slijten door weerbaarheid van het gastland.
    for (const [b, sterkte] of Object.entries(c.netwerken)) {
      if (sterkte <= 0) { delete c.netwerken[b]; continue; }
      if (!c.vast && c.loyaliteit[b] != null) c.loyaliteit[b] = clamp(c.loyaliteit[b] + sterkte * M.netwerk_trek, 0, 100);
      c.netwerken[b] = Math.max(0, sterkte - (M.netwerk_verval + c.weerbaarheid * 0.01));
    }
  }
  pandemieTick(state);
}

// ---------- pandemie ----------

function pandemieTick(state) {
  const p = state.pandemie;
  if (!p) {
    if (!state.instellingen.systemen.schokken) return;
    for (const s of state.pack.schokken) {
      if (s.type !== 'pandemie' || state.dag < (s.na_dag ?? 0)) continue;
      if (state.pandemieGehad?.includes(s.id)) continue;
      if (nextRandom(state) >= (s.kans_per_dag ?? 0)) continue;
      const bron = Math.floor(nextRandom(state) * state.landen.length);
      state.pandemie = { id: s.id, naam: s.naam, tot: state.dag + (s.duur ?? 120), besmetting: s.besmetting ?? 0.05, effect: s.effect || {}, besmet: state.landen.map((c) => c.idx === bron) };
      (state.pandemieGehad ??= []).push(s.id);
      log(state, `${s.naam} duikt op in ${state.landen[bron].naam}. ${s.tekst ?? ''}`, 'slecht', true);
      return;
    }
    return;
  }
  if (state.dag >= p.tot) {
    log(state, `${p.naam} is uitgedoofd.`, 'goed', true);
    state.pandemie = null;
    return;
  }
  const nieuw = [];
  for (const c of state.landen) {
    if (p.besmet[c.idx]) continue;
    for (const n of routeBuren(state, c)) {
      if (!p.besmet[n.idx]) continue;
      const q = quarantaine(state, c) || quarantaine(state, n) ? 0.15 : 1;
      if (nextRandom(state) < p.besmetting * q) { nieuw.push(c.idx); break; }
    }
  }
  for (const i of nieuw) {
    p.besmet[i] = true;
    if (i === state.speler) log(state, `${p.naam} heeft je land bereikt.`, 'slecht', true);
  }
  for (const c of state.landen) {
    if (!p.besmet[c.idx]) continue;
    const zorg = Math.min(0.8, voorziening(state, c, 'zorg') * 0.15);
    c.L *= 1 - (p.effect.sterfte ?? 0.0004) * (1 - zorg);
  }
}

export function quarantaine(state, c) {
  return c.modifiers.some((m) => m.type === 'quarantaine' && m.tot > state.dag);
}

export function pandemieFactor(state, c) {
  const p = state.pandemie;
  if (!p?.besmet[c.idx]) return 1;
  return p.effect.productie_factor ?? 0.85;
}

// ---------- binnenlandse campagnes ----------

export function campagneStatus(state, landIdx, a) {
  const c = state.landen[landIdx];
  if (!isOntgrendeld(state, 'media')) return { ok: false, reden: 'Mediacampagnes komen vrij in een latere fase.' };
  if ((a.vereist_controle ?? 0) > voorziening(state, c, 'informatiecontrole') + regimeEffect(state, c, 'informatiecontrole')) return { ok: false, reden: 'Vraagt een omroep of mediabedrijf.' };
  const af = c.afkoeling[`campagne|${a.id}`] ?? 0;
  if (af > state.dag) return { ok: false, reden: `Afkoeling: nog ${af - state.dag} dagen.` };
  if (!kanBetalen(c, a.kosten || {})) return { ok: false, reden: 'Onvoldoende middelen.' };
  return { ok: true, ontdekkans: ontdekkansCampagne(c, a) };
}

function ontdekkansCampagne(c, a) {
  return (a.ontdekkans ?? 0) * (1 - Math.min(0.7, c.controle / 150));
}

export function voerCampagneUit(state, landIdx, id, applyEffect) {
  const a = state.pack.acties.campagnes.find((x) => x.id === id);
  if (!a) return { ok: false, reden: 'Onbekende campagne.' };
  const st = campagneStatus(state, landIdx, a);
  if (!st.ok) return st;
  const c = state.landen[landIdx];
  betaal(c, a.kosten || {});
  applyEffect(state, c, a.effect || {});
  c.afkoeling[`campagne|${a.id}`] = state.dag + (a.afkoeling ?? 40);
  let ontdekt = false;
  if (st.ontdekkans && nextRandom(state) < st.ontdekkans) {
    ontdekt = true;
    applyEffect(state, c, a.ontdekt || {});
  }
  if (landIdx === state.speler) {
    state.balans.invloed += kostenInGeld(state, a.kosten || {}) * 0.03;
    log(state, ontdekt ? `${a.naam}: de manipulatie is doorgeprikt. Het wantrouwen groeit.` : `${a.naam} loopt.`, ontdekt ? 'slecht' : 'info', ontdekt);
  }
  return { ok: true, ontdekt };
}

// ---------- geheime netwerken ----------

export function netwerkStatus(state, payerIdx, doelIdx, a) {
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  if (!isOntgrendeld(state, 'netwerken')) return { ok: false, reden: 'Netwerken komen vrij in een latere fase.' };
  if (!t) return { ok: false, reden: 'Kies een land.' };
  if (a.type === 'oprollen') {
    if (t !== payer) return { ok: false, reden: 'Alleen in je eigen land.' };
    if (payer.weerbaarheid < (a.vereist_weerbaarheid ?? 0)) return { ok: false, reden: 'Vraagt meer orde en bestuur (politie, rechtspraak).' };
    if (!Object.keys(t.netwerken).some((b) => b !== blok)) return { ok: false, reden: 'Geen buitenlandse netwerken bekend.' };
  } else {
    if (t === payer) return { ok: false, reden: 'Kies een ander land.' };
    if (a.type === 'chantage' && (t.netwerken[blok] ?? 0) < (a.vereist_netwerk ?? 40)) return { ok: false, reden: `Vraagt een netwerk van minstens ${a.vereist_netwerk ?? 40}.` };
  }
  const af = state.afkoeling[`${blok}|${a.id}|${t.idx}`] ?? 0;
  if (af > state.dag) return { ok: false, reden: `Afkoeling: nog ${af - state.dag} dagen.` };
  if (!kanBetalen(payer, actieKosten(state, a, t))) return { ok: false, reden: 'Onvoldoende middelen.' };
  return { ok: true, ontdekkans: netwerkOntdekkans(state, payer, t, a) };
}

function netwerkOntdekkans(state, payer, t, a) {
  if (!a.ontdekkans) return 0;
  const sterkte = t.netwerken[payer.blok] ?? 0;
  return a.ontdekkans * (1.3 - sterkte / 100) * (1 + t.weerbaarheid / 40);
}

export function voerNetwerkActieUit(state, payerIdx, doelIdx, id) {
  const a = state.pack.acties.netwerken.find((x) => x.id === id);
  if (!a) return { ok: false, reden: 'Onbekende actie.' };
  const st = netwerkStatus(state, payerIdx, doelIdx, a);
  if (!st.ok) return st;
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  const kosten = actieKosten(state, a, t);
  betaal(payer, kosten);
  state.afkoeling[`${blok}|${a.id}|${t.idx}`] = state.dag + (a.afkoeling ?? 30);
  const speler = payerIdx === state.speler;
  if (speler) state.balans.invloed += kostenInGeld(state, kosten) * 0.03;

  if (a.type === 'oprollen') {
    for (const b of Object.keys(t.netwerken)) if (b !== blok) t.netwerken[b] = Math.max(0, t.netwerken[b] - (a.verlaging ?? 40));
    if (speler) log(state, 'Inlichtingendiensten rollen buitenlandse netwerken op.', 'goed');
    return { ok: true };
  }
  if (a.type === 'loge') {
    t.netwerken[blok] = Math.min(100, (t.netwerken[blok] ?? 0) + (a.groei ?? 20));
    if (speler) log(state, `Je netwerk in ${t.naam} groeit naar ${t.netwerken[blok].toFixed(0)}.`, 'info');
    return { ok: true };
  }
  // Chantage: snel resultaat, maar als het dossier lekt, is het netwerk weg en de schade groot.
  if (st.ontdekkans && nextRandom(state) < st.ontdekkans) {
    t.netwerken[blok] = 0;
    if (!t.vast) t.loyaliteit[blok] = clamp(t.loyaliteit[blok] + (a.ontdekt_loyaliteit ?? -20), 0, 100);
    t.complot = clamp(t.complot + (a.ontdekt_complot ?? 15), 0, 100);
    for (const o of state.landen) if (!o.vast && o !== t && o.alignment !== blok) o.loyaliteit[blok] = clamp(o.loyaliteit[blok] - 4 / tol(state, o), 0, 100);
    log(state, `Het dossier lekt in ${t.naam}. ${speler ? 'Je netwerk is opgerold en' : `Een netwerk van ${blokVan(state, blok).naam} is ontmaskerd;`} het schandaal raakt iedereen die erin zat.`, speler ? 'slecht' : 'goed', true);
    return { ok: true, ontdekt: true };
  }
  if (!t.vast) t.effecten.push({ blok, perDag: (a.loyaliteit ?? 18) / 10, dagen: 10 });
  t.stab = clamp(t.stab + (a.doel_stabiliteit ?? -4), 0, 100);
  if (speler) log(state, `De leiding van ${t.naam} buigt mee onder druk van je netwerk.`, 'info');
  return { ok: true };
}

// ---------- bijzondere escalaties: complot zaaien en valse vlag ----------

export function voerComplotUit(state, payerIdx, doelIdx, e, st) {
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  const kosten = actieKosten(state, e, t);
  betaal(payer, kosten);
  const weerstand = 1 + t.weerbaarheid / 20 + t.controle / 100;
  t.complot = clamp(t.complot + (e.complot ?? 25) / weerstand, 0, 100);
  t.stab = clamp(t.stab + (e.doel_stabiliteit ?? -4), 0, 100);
  const factor = st.sprong ? 2 : 1;
  for (const o of state.landen) {
    if (o === t || o.vast || o.alignment === blok) continue;
    o.loyaliteit[blok] = clamp(o.loyaliteit[blok] + ((e.derden_loyaliteit ?? -1) * factor) / tol(state, o), 0, 100);
  }
  let ontdekt = false;
  if (e.ontdekkans && nextRandom(state) < e.ontdekkans) {
    ontdekt = true;
    for (const o of state.landen) if (!o.vast) o.loyaliteit[blok] = clamp(o.loyaliteit[blok] + (e.ontdekt_loyaliteit ?? -6) / tol(state, o), 0, 100);
  }
  afronden(state, payerIdx, t, e, `zaait complottheorieën in ${t.naam}`, ontdekt, st);
  return { ok: true, ontdekt };
}

export function voerValseVlagUit(state, payerIdx, doelIdx, e, st) {
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  const beschuldigd = partij(state, t);
  const kosten = actieKosten(state, e, t);
  betaal(payer, kosten);
  const kans = (e.ontdekkans ?? 0.25) * (1 - Math.min(0.6, payer.controle / 150));
  const ontdekt = nextRandom(state) < kans;
  const naam = beschuldigd.startsWith('land:') ? t.naam : blokVan(state, beschuldigd).naam;
  if (ontdekt) {
    for (const o of state.landen) if (!o.vast && o.alignment !== blok) o.loyaliteit[blok] = clamp(o.loyaliteit[blok] + (e.ontdekt_loyaliteit ?? -12) / tol(state, o), 0, 100);
    payer.complot = clamp(payer.complot + (e.ontdekt_complot ?? 20), 0, 100);
    blokVan(state, blok).spanning += 15;
  } else {
    for (const o of state.landen) {
      if (o.vast || o.alignment === beschuldigd || o.idx === t.idx) continue;
      if (!beschuldigd.startsWith('land:') && o.loyaliteit[beschuldigd] != null) o.loyaliteit[beschuldigd] = clamp(o.loyaliteit[beschuldigd] + (e.beschuldigd_loyaliteit ?? -8), 0, 100);
    }
    payer.stab = clamp(payer.stab + (e.eigen_stabiliteit ?? 5), 0, 100);
    state.casusBelli[`${blok}|${beschuldigd}`] = state.dag + (e.casus_belli ?? 150);
  }
  afronden(state, payerIdx, t, e, ontdekt ? `ensceneert een incident en schuift het ${naam} in de schoenen, maar het komt uit` : `ensceneert een incident en schuift het ${naam} in de schoenen`, ontdekt, st, true);
  return { ok: true, ontdekt };
}

function afronden(state, payerIdx, t, e, tekst, ontdekt, st, geheim = false) {
  const payer = state.landen[payerIdx];
  const blok = payer.blok;
  blokVan(state, blok).spanning += e.spanning ?? 0;
  const tb = t.alignment;
  if (tb && tb !== 'zwevend' && tb !== blok) {
    blokVan(state, tb).spanning += (e.spanning ?? 0) * 0.5;
    state.provocaties.push({ door: blok, tegen: tb, dag: state.dag, trede: e.trede });
  }
  state.afkoeling[`${blok}|${e.id}`] = state.dag + (e.afkoeling ?? 60);
  state.escalaties.push({ blok, doel: t.idx, trede: e.trede, dag: state.dag });
  const speler = payerIdx === state.speler;
  if (speler) {
    state.balans.invloed += kostenInGeld(state, actieKosten(state, e, t)) * 0.03;
    log(state, `Je ${tekst}.${st.sprong ? ' Sprong op de ladder: dubbele politieke kosten.' : ''}${ontdekt ? ' Loyaliteit daalt overal.' : ''}`, ontdekt ? 'slecht' : 'info', ontdekt);
  } else if (!geheim || ontdekt) {
    log(state, `${blokVan(state, blok).naam} ${tekst}.`, ontdekt ? 'goed' : 'slecht', true);
  }
}

