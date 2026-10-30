// Cyber: trede 3 van de escalatieladder. Een aanval op het stroomnet, de financiën of de communicatie van een
// ander land, eventueel gericht op één gebouw dat dan een tijd "uitgevallen" is.
// Tegenzet: weerbaarheid en cybercentra van het doelwit verlagen de kans van slagen en verhogen de ontdekkingskans.
// Komt een aanval uit, dan stijgt de spanning, daalt de loyaliteit en krijgt het doelwit een casus belli.

import { nextRandom } from './rng.js';
import {
  log, blokVan, isOntgrendeld, kanBetalen, betaal, actieKosten, kostenInGeld, herbereken, escalatieStatus, bouw, bouwKosten,
} from './sim.js';
import { voorziening } from './samenleving.js';
import { partij, partijNaam } from './leger.js';
import { animatie } from './media.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function cyberActie(state) {
  return state.pack.acties.escalatie.find((e) => e.type === 'cyber' && e.beschikbaar !== false) ?? null;
}

export function cyberVariant(e, id) {
  return e?.varianten?.find((v) => v.id === id) ?? null;
}

// Een uitgevallen gebouw produceert niets en telt niet mee voor voorzieningen tot de dag in `uit`.
export function isUitgevallen(state, p) {
  return (p.uit ?? 0) > state.dag;
}

// Omroep en media liggen stil: geen factcheck en geen eigen mediacampagnes.
export function communicatieStil(state, c) {
  return (c.cyberStil ?? 0) > state.dag;
}

export function cyberVerdediging(state, c) {
  return voorziening(state, c, 'cyberverdediging');
}

// Kansen zoals de UI ze vooraf toont: slagen en ontdekking.
export function cyberKansen(state, payer, t, e, v) {
  const weer = Math.max(0, t.weerbaarheid) / (e.weerbaarheid_schaal ?? 40);
  const verd = cyberVerdediging(state, t);
  const kans = clamp((e.kans ?? 0.8) / (1 + weer + verd * (e.verdediging ?? 0.5)), 0.05, 0.95);
  const ontdekkans = clamp((v.ontdekkans ?? 0.25) * (1 + weer * 0.5 + verd * (e.verdediging_ontdekking ?? 0.6)), 0, 0.95);
  return { kans, ontdekkans, verdediging: verd };
}

export function cyberKosten(state, e, v, t, gericht) {
  const kosten = actieKosten(state, v, t);
  if (!gericht) return kosten;
  const f = e.gericht?.kosten_factor ?? 1.3;
  for (const r of Object.keys(kosten)) kosten[r] = Math.round(kosten[r] * f);
  return kosten;
}

export function cyberStatus(state, payerIdx, doelIdx, variantId, tegel = null) {
  const e = cyberActie(state);
  if (!e) return { ok: false, reden: 'Cyber zit niet in deze wereld.' };
  const st = escalatieStatus(state, payerIdx, doelIdx, e);
  const v = cyberVariant(e, variantId) ?? e.varianten?.[0];
  if (!v) return { ok: false, reden: 'Onbekende cyberaanval.' };
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  if (!t || t === payer) return { ok: false, reden: 'Kies een ander land.' };
  const kansen = cyberKansen(state, payer, t, e, v);
  const kosten = cyberKosten(state, e, v, t, tegel != null);
  const basis = { variant: v, kosten, ...kansen };
  if (!st.ok) return { ...basis, ok: false, reden: st.reden };
  if (tegel != null) {
    const p = t.plaatsingen.find((x) => x.t === tegel);
    if (!p) return { ...basis, ok: false, reden: 'Kies een afgebouwd gebouw van dit land.' };
    if (isUitgevallen(state, p)) return { ...basis, ok: false, reden: `Ligt al plat: nog ${p.uit - state.dag} dagen.` };
  }
  if (!kanBetalen(payer, kosten)) return { ...basis, ok: false, reden: 'Onvoldoende middelen.' };
  return { ...basis, ok: true, sprong: st.sprong };
}

// Legt een gebouw plat tot een bepaalde dag. Geeft true als het gebouw daardoor is uitgevallen.
function legPlat(state, c, p, dagen) {
  p.uit = Math.max(p.uit ?? 0, state.dag + dagen);
  c.uitvalTot = Math.max(c.uitvalTot ?? 0, p.uit);
}

function pasVariantToe(state, t, e, v) {
  const P = state.pack;
  const R = P.rollen;
  const duur = v.duur ?? 20;
  if (v.id === 'stroomnet' || v.aandeel) {
    // Een deel van de energieproducenten valt uit, in vaste volgorde: deterministisch.
    const energie = t.plaatsingen.filter((p) => P.gebouwIndex[p.g]?.productie?.[R.energie] && !isUitgevallen(state, p));
    const n = Math.ceil(energie.length * (v.aandeel ?? 0.5));
    for (let i = 0; i < n; i++) legPlat(state, t, energie[i], duur);
    t.voorraad[R.energie] = (t.voorraad[R.energie] ?? 0) * (1 - (v.energie_voorraad ?? 0));
    if (v.doel_stabiliteit) t.stab = clamp(t.stab + v.doel_stabiliteit, 0, 100);
    return { tegel: energie[0]?.t ?? -1, aantal: n };
  }
  if (v.id === 'financien' || v.kapitaal) {
    const geld = Math.max(0, t.voorraad[R.geld] ?? 0);
    const verlies = Math.min(v.kapitaal_max ?? 300, geld * (v.kapitaal ?? 0.1));
    t.voorraad[R.geld] -= verlies;
    if (v.productie) t.modifiers.push({ type: 'productie', waarde: v.productie, tot: state.dag + duur });
    return { tegel: -1, verlies };
  }
  // Communicatie: omroep stil, factcheck weg, strijdbereidheid omlaag.
  t.cyberStil = Math.max(t.cyberStil ?? 0, state.dag + duur);
  t.factcheck = 0;
  if (v.moraal) t.modifiers.push({ type: 'moraal', waarde: v.moraal, tot: state.dag + duur });
  return { tegel: -1 };
}

const VARIANT_TEKST = {
  stroomnet: (r, d) => `${r.aantal} energiecentrale${r.aantal === 1 ? '' : 's'} ${d} dagen plat`,
  financien: (r, d) => `${Math.round(r.verlies)} kapitaal weg en ${d} dagen minder inkomen`,
  communicatie: (r, d) => `omroep ${d} dagen stil`,
};

export function voerCyberUit(state, payerIdx, doelIdx, e, opties = {}) {
  const tegel = opties.tegel ?? null;
  const st = cyberStatus(state, payerIdx, doelIdx, opties.variant, tegel);
  if (!st.ok) return st;
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  const v = st.variant;
  const P = state.pack;
  betaal(payer, st.kosten);
  const geslaagd = nextRandom(state) < st.kans;
  const ontdekt = nextRandom(state) < st.ontdekkans;
  const tol = (c) => P.persoonlijkheden[c.persoonlijkheid].druk_tolerantie ?? 1;

  let r = { tegel: -1 };
  if (geslaagd) {
    r = pasVariantToe(state, t, e, v);
    if (tegel != null) {
      legPlat(state, t, t.plaatsingen.find((x) => x.t === tegel), e.gericht?.duur ?? 30);
      r.tegel = tegel;
    }
    herbereken(state, t);
    t.cyberLaatst = state.dag;
  }
  blokVan(state, blok).spanning += e.spanning ?? 0;
  const pa = partij(state, payer), pt = partij(state, t);
  if (ontdekt) {
    t.cyberLaatst = state.dag;
    const factor = st.sprong ? 2 : 1;
    for (const o of state.landen) {
      if (o.vast || o.alignment === blok) continue;
      const d = (o === t ? (e.ontdekt_doel_loyaliteit ?? -10) : (e.ontdekt_loyaliteit ?? -6) + (e.derden_loyaliteit ?? 0) * factor) / tol(o);
      o.loyaliteit[blok] = clamp(o.loyaliteit[blok] + d, 0, 100);
    }
    blokVan(state, blok).spanning += e.ontdekt_spanning ?? 12;
    if (!pt.startsWith('land:')) {
      blokVan(state, pt).spanning += e.ontdekt_spanning ?? 12;
      state.provocaties.push({ door: blok, tegen: pt, dag: state.dag, trede: e.trede });
    }
    state.casusBelli[`${pt}|${pa}`] = state.dag + (e.casus_belli ?? 120);
  }
  state.afkoeling[`${blok}|${e.id}`] = state.dag + (e.afkoeling ?? 45);
  state.escalaties.push({ blok, doel: t.idx, trede: e.trede, dag: state.dag });
  animatie(state, { soort: 'cyber', van: payer.idx, naar: t.idx, tegel: r.tegel ?? -1, gelukt: geslaagd });

  // Berichten: de dader blijft onbekend tot de aanval uitkomt.
  const duur = v.duur ?? 20;
  const effect = geslaagd ? (VARIANT_TEKST[v.id]?.(r, duur) ?? 'storing') + (tegel != null ? `, en ${P.gebouwIndex[t.plaatsingen.find((x) => x.t === tegel).g].naam.toLowerCase()} ${e.gericht?.duur ?? 30} dagen uitgevallen` : '') : '';
  const speler = payerIdx === state.speler;
  if (speler) {
    state.balans.invloed += kostenInGeld(state, st.kosten) * 0.03;
    log(state, geslaagd ? `Cyberaanval op ${t.naam} (${v.naam.toLowerCase()}) geslaagd: ${effect}.` : `Cyberaanval op ${t.naam} (${v.naam.toLowerCase()}) afgeslagen.`, geslaagd ? 'goed' : 'slecht');
    if (ontdekt) log(state, `De cyberaanval op ${t.naam} is uitgekomen. Loyaliteit daalt en ${t.naam} heeft een casus belli tegen je.`, 'slecht', true);
  } else if (t.idx === state.speler) {
    const dader = ontdekt ? ` Daders: ${partijNaam(state, pa)}. Je hebt een casus belli.` : ' De daders zijn onbekend.';
    if (geslaagd) log(state, `Cyberaanval op je ${v.naam.toLowerCase()}: ${effect}.${dader}`, 'slecht', true);
    else if (ontdekt) log(state, `Een cyberaanval op je ${v.naam.toLowerCase()} is afgeslagen.${dader}`, 'goed', true);
  } else if (ontdekt && (t.alignment === state.spelerBlok || blok === state.spelerBlok)) {
    log(state, `${blokVan(state, blok).naam} pleegt een cyberaanval op ${t.naam}. Het komt uit.`, 'info', true);
  }
  return { ok: true, geslaagd, ontdekt };
}

// Dagelijks: uitgevallen gebouwen komen weer in bedrijf.
export function cyberTick(state) {
  for (const c of state.landen) {
    if (!c.uitvalTot) continue;
    let klaar = false;
    for (const p of c.plaatsingen) if (p.uit != null && p.uit <= state.dag) { delete p.uit; klaar = true; }
    if (klaar) herbereken(state, c);
    if (c.uitvalTot <= state.dag) c.uitvalTot = 0;
  }
}

// ---------- AI ----------

// Agressieve en opportunistische blokleiders vallen af en toe aan bij rivalen met hoge spanning (ook de speler).
export function aiCyber(state, leider, blok) {
  const e = cyberActie(state);
  if (!e || !isOntgrendeld(state, 'escalatie') || !state.instellingen.systemen.escalatie) return;
  const ai = state.pack.persoonlijkheden[leider.persoonlijkheid].ai || {};
  if (!(ai.cyber > 0) || nextRandom(state) >= ai.cyber) return;
  const R = state.pack.rollen;
  if (leider.voorraad[R.geld] < (ai.reserve ?? 100) * 1.5) return;
  const drempel = state.pack.model.ai_cyber_spanning ?? 15;
  // Wie de spanning opdrijft of dit blok provoceerde, komt eerst in beeld; daarna kernlanden en grote economieën.
  const score = (t) => blokVan(state, t.alignment).spanning
    + 10 * state.provocaties.filter((p) => p.door === t.alignment && p.tegen === blok.id && state.dag - p.dag < 100).length
    + (t.kern ? 5 : 0) + t.Y / 100;
  const doelen = state.landen.filter((t) => {
    const tb = t.alignment;
    if (t === leider || !tb || tb === 'zwevend' || tb === blok.id) return false;
    return Math.max(blok.spanning, blokVan(state, tb).spanning) >= drempel;
  }).map((t) => ({ t, s: score(t) })).sort((a, b) => b.s - a.s || a.t.idx - b.t.idx).map((x) => x.t);
  for (const t of doelen.slice(0, 3)) {
    const v = e.varianten[Math.floor(nextRandom(state) * e.varianten.length)];
    if (cyberStatus(state, leider.idx, t.idx, v.id).ok) { voerCyberUit(state, leider.idx, t.idx, e, { variant: v.id }); return; }
  }
}

// Een land dat is aangevallen, bouwt een cybercentrum als de persoonlijkheid dat wil.
export function aiCyberVerdediging(state, c) {
  if (c.cyberLaatst == null || state.dag - c.cyberLaatst > (state.pack.model.ai_cyber_geheugen ?? 200)) return;
  const g = state.pack.gebouwen.find((x) => x.cyberverdediging && isOntgrendeld(state, x.id));
  if (!g) return;
  const ai = state.pack.persoonlijkheden[c.persoonlijkheid].ai || {};
  const heeft = (c.gebouwen[g.id] || 0) + c.bouw.filter((b) => b.gebouw === g.id).length;
  if (heeft >= (ai.cyber_verdediging ?? 0) || c.bouw.length >= state.pack.model.max_bouw) return;
  const kosten = bouwKosten(state, c, g.id);
  if ((c.voorraad[state.pack.rollen.geld] - (kosten[state.pack.rollen.geld] ?? 0)) < (ai.reserve ?? 100)) return;
  if (kanBetalen(c, kosten)) bouw(state, c.idx, g.id);
}
