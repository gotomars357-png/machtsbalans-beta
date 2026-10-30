// Gebeurtenissen (met keuzes voor de speler) en wereldwijde schokken, beide volledig uit het pack.

import { nextRandom } from './rng.js';
import { log, blokVan, isOntgrendeld } from './sim.js';
import { buurlanden } from './leger.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function resourceWaarde(state, c, id) {
  return id === state.pack.rollen.stabiliteit ? c.stab : c.voorraad[id] ?? 0;
}

// Waarde die een voorwaarde of 'vereist' kan toetsen: een resource, stabiliteit, controle of strijdbereidheid.
function meetwaarde(state, c, id) {
  if (id === 'controle') return c.controle;
  if (id === 'moraal') return c.moraal;
  return resourceWaarde(state, c, id);
}

// Ketens: een keuze kan een vervolg plannen. Is er een vervolg aan de beurt, dan gaat dat voor.
function ketenTick(state) {
  const k = state.eventKeten;
  for (let i = 0; i < k.length; i++) {
    if (k[i].dag > state.dag) continue;
    const [v] = k.splice(i, 1);
    const e = state.pack.events.find((x) => x.id === v.id);
    if (!e) return false;
    const st = (state.eventStatus[e.id] ??= { teller: 0, laatst: -Infinity, aantal: 0 });
    st.laatst = state.dag;
    st.aantal += 1;
    state.pendingEvent = { id: e.id, dag: state.dag, land: v.land, vervolg: true };
    log(state, `Gebeurtenis: ${e.titel}`, 'info');
    return true;
  }
  return false;
}

export function eventsTick(state) {
  if (state.pendingEvent) return;
  if (ketenTick(state)) return;
  const c = state.landen[state.speler];
  for (const e of state.pack.events) {
    if (e.alleen_als_vervolg) continue;
    const st = (state.eventStatus[e.id] ??= { teller: 0, laatst: -Infinity, aantal: 0 });
    const v = e.voorwaarde || {};
    let ok = true;
    if (v.na_dag != null && state.dag < v.na_dag) ok = false;
    if (v.voor_dag != null && state.dag > v.voor_dag) ok = false;
    if (v.spanning_boven != null && blokVan(state, state.spelerBlok).spanning <= v.spanning_boven) ok = false;
    if (v.complot_boven != null && c.complot <= v.complot_boven) ok = false;
    if (v.besmet != null && !!state.pandemie?.besmet[c.idx] !== v.besmet) ok = false;
    if (v.in_oorlog != null && state.oorlogen.some((o) => [o.a, o.b].includes(c.blok)) !== v.in_oorlog) ok = false;
    if (v.wereld_in_oorlog != null && (state.oorlogen.length > 0) !== v.wereld_in_oorlog) ok = false;
    if (v.moraal_onder != null && c.moraal >= v.moraal_onder) ok = false;
    if (v.moraal_boven != null && c.moraal <= v.moraal_boven) ok = false;
    if (v.controle_boven != null && c.controle <= v.controle_boven) ok = false;
    if (v.regime != null && c.regime !== v.regime) ok = false;
    if (v.loyaliteit_boven != null && !state.landen.some((o) => !o.vast && o.idx !== c.idx && (v.land == null || o.id === v.land)
      && o.alignment !== state.spelerBlok && (o.loyaliteit[state.spelerBlok] ?? 0) > v.loyaliteit_boven)) ok = false;
    if (v.netwerk_boven != null && !Object.entries(c.netwerken).some(([b, w]) => b !== c.blok && w > v.netwerk_boven)) ok = false;
    if (v.resource) {
      const w = resourceWaarde(state, c, v.resource);
      const cond = (v.onder == null || w < v.onder) && (v.boven == null || w > v.boven);
      st.teller = cond ? st.teller + 1 : 0;
      if (st.teller < (v.duur_dagen ?? 1)) ok = false;
    }
    if (e.eenmalig && st.aantal > 0) ok = false;
    if (state.dag - st.laatst < (e.afkoeling ?? 120)) ok = false;
    if (ok && v.kans_per_dag != null && nextRandom(state) >= v.kans_per_dag) ok = false;
    if (!ok) continue;
    st.laatst = state.dag;
    st.aantal += 1;
    st.teller = 0;
    state.pendingEvent = { id: e.id, dag: state.dag, land: state.speler };
    log(state, `Gebeurtenis: ${e.titel}`, 'info');
    return;
  }
}

export function resolveEvent(state, index, land = state.speler) {
  if (!state.pendingEvent) return { ok: false, reden: 'Geen open gebeurtenis.' };
  const eigenaar = state.pendingEvent.land ?? state.speler;
  if (land !== eigenaar) return { ok: false, reden: 'Deze gebeurtenis is van een ander land.' };
  const e = state.pack.events.find((x) => x.id === state.pendingEvent.id);
  const keuze = e?.keuzes?.[index];
  if (!keuze) return { ok: false, reden: 'Ongeldige keuze.' };
  const st = keuzeStatus(state, keuze, eigenaar);
  if (!st.ok) return st;
  applyEffect(state, state.landen[eigenaar], keuze.effect || {});
  log(state, `${e.titel}: ${keuze.tekst}.`, 'info');
  state.pendingEvent = null;
  if (keuze.vervolg) state.eventKeten.push({ id: keuze.vervolg.event, dag: state.dag + (keuze.vervolg.na_dagen ?? 30), land: eigenaar });
  return { ok: true };
}

// Kan dit land deze keuze maken? 'vereist' noemt minimumwaarden (resources, stabiliteit, controle, moraal).
export function keuzeStatus(state, keuze, land = state.speler) {
  const c = state.landen[land];
  for (const [id, min] of Object.entries(keuze.vereist || {})) {
    if (meetwaarde(state, c, id) >= min) continue;
    const naam = id === 'controle' ? 'informatiecontrole' : id === 'moraal' ? 'strijdbereidheid' : (state.pack.resIndex[id]?.naam ?? id).toLowerCase();
    return { ok: false, reden: `Vraagt minstens ${min} ${naam}.` };
  }
  // Een gratis eenheid kan pas als het leger en dat type eenheid zijn vrijgespeeld.
  const e = keuze.effect?.eenheid;
  if (e != null && !eenheidVrij(state, e)) return { ok: false, reden: 'Het leger komt vrij in een latere fase.' };
  return { ok: true };
}

export function applyEffect(state, c, effect) {
  const P = state.pack;
  const duur = effect.duur_dagen ?? 30;
  for (const [k, v] of Object.entries(effect)) {
    if (k === 'duur_dagen') continue;
    if (k === P.rollen.stabiliteit) c.stab = clamp(c.stab + v, 0, 100);
    else if (P.resIndex[k]) c.voorraad[k] = (c.voorraad[k] ?? 0) + v;
    else if (k === 'productie_factor') c.modifiers.push({ type: 'productie', waarde: v, tot: state.dag + duur });
    else if (k === 'stabiliteit_doel') c.modifiers.push({ type: 'stabiliteit_doel', waarde: v, tot: state.dag + duur });
    else if (k === 'tech_factor') c.A *= v;
    else if (k === 'bevolking') c.L *= v;
    else if (k === 'spanning') { const b = blokVan(state, c.blok); b.spanning = Math.max(0, b.spanning + v); }
    else if (k === 'complot') c.complot = clamp(c.complot + v, 0, 100);
    else if (k === 'controle') c.controle = clamp(c.controle + v, 0, 100);
    else if (k === 'oorlogssteun') c.modifiers.push({ type: 'oorlogssteun', waarde: 1, tot: state.dag + v });
    else if (k === 'quarantaine') c.modifiers.push({ type: 'quarantaine', waarde: 1, tot: state.dag + v });
    else if (k === 'netwerk_oprollen') { for (const b of Object.keys(c.netwerken)) if (b !== c.blok) c.netwerken[b] = Math.max(0, c.netwerken[b] - v); }
    else if (k === 'moraal') c.modifiers.push({ type: 'moraal', waarde: v, tot: state.dag + duur });
    else if (k === 'factcheck') c.factcheck = clamp(c.factcheck + v, 0, 100);
    else if (k === 'loyaliteit_blok') {
      // Het eigen blok bij alle buurlanden die nog niet vastliggen.
      for (const n of buurlanden(state, c)) {
        const o = state.landen[n];
        if (o.vast || o.loyaliteit[c.blok] == null) continue;
        o.loyaliteit[c.blok] = clamp(o.loyaliteit[c.blok] + v, 0, 100);
      }
    }
    else if (k === 'media') {
      // Eigen media-invloed in de buurlanden buiten het eigen blok.
      for (const n of buurlanden(state, c)) {
        const o = state.landen[n];
        if (o.alignment === c.blok) continue;
        o.media[c.blok] = clamp((o.media[c.blok] ?? 0) + v, 0, 100);
      }
    }
    else if (k === 'media_vreemd') {
      // Buitenlandse media-invloed in het eigen land, van de grootste rivaal.
      const r = grootsteRivaal(state, c);
      if (r) c.media[r] = clamp((c.media[r] ?? 0) + v, 0, 100);
    }
    else if (k === 'eenheid') {
      const e = state.pack.eenhedenIndex[v];
      if (!e || !eenheidVrij(state, v) || state.eenheden.filter((u) => u.land === c.idx).length + c.training.length >= state.pack.model.max_eenheden) continue;
      c.training.push({ type: v, tegel: state.pack.geo.hoofdstad[c.idx], klaar: state.dag + 1 });
    }
    else if (k === 'loyaliteit_zwevend') {
      for (const o of state.landen) {
        if (o.vast || o.alignment === state.spelerBlok) continue;
        o.loyaliteit[state.spelerBlok] = clamp(o.loyaliteit[state.spelerBlok] + v, 0, 100);
      }
    }
  }
  for (const r of P.resources) {
    if (r.opslag_max != null && c.voorraad[r.id] != null) c.voorraad[r.id] = Math.max(0, c.voorraad[r.id]);
  }
}

const eenheidVrij = (state, id) => isOntgrendeld(state, 'leger') && isOntgrendeld(state, id);

function grootsteRivaal(state, c) {
  let best = null;
  for (const b of state.blokken) if (b.id !== c.blok && (!best || b.aandeel > best.aandeel)) best = b;
  return best?.id;
}

export function schokkenTick(state) {
  state.schokken = state.schokken.filter((s) => {
    if (s.tot > state.dag) return true;
    log(state, `Voorbij: ${s.naam}.`, 'info', true);
    return false;
  });
  for (const s of state.pack.schokken) {
    if (s.type === 'pandemie' || state.schokken.some((a) => a.id === s.id)) continue;
    if (state.dag < (s.na_dag ?? 0)) continue;
    if (nextRandom(state) >= (s.kans_per_dag ?? 0)) continue;
    state.schokken.push({ id: s.id, naam: s.naam, tot: state.dag + (s.duur ?? 30), effect: s.effect || {} });
    log(state, `Schok: ${s.naam}. ${s.tekst ?? ''}`, 'slecht', true);
  }
}

export function schokModifiers(state) {
  const m = { productie: {}, uitgezonderd: {}, productie_factor: 1, inkomen_factor: 1 };
  for (const s of state.schokken) {
    for (const [r, v] of Object.entries(s.effect.productie || {})) {
      m.productie[r] = (m.productie[r] ?? 1) * v;
      for (const g of s.effect.uitgezonderd || []) m.uitgezonderd[g] = true;
    }
    if (s.effect.productie_factor) m.productie_factor *= s.effect.productie_factor;
    if (s.effect.inkomen_factor) m.inkomen_factor *= s.effect.inkomen_factor;
  }
  return m;
}
