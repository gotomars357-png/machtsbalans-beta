// Regimes: elk land heeft een staatsvorm met eigen sterke en zwakke punten, een eigen bouwstijl
// en eigen gebeurtenissen (verkiezingen, staatsgrepen, revoluties). Effecten komen uit het pack.

import { nextRandom } from './rng.js';
import { log, kanBetalen, betaal } from './sim.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function regimeVan(state, c) {
  return state.pack.regimes[c.regime];
}

export function regimeEffect(state, c, veld, standaard = 0) {
  return regimeVan(state, c)?.effecten?.[veld] ?? standaard;
}

// Landen voelen zich aangetrokken tot blokken die door een land met hetzelfde regime worden geleid.
export function regimeVerwantschap(state, c, blokId) {
  const b = state.blokken.find((x) => x.id === blokId);
  if (!b || b.leider < 0) return 0;
  return state.landen[b.leider].regime === c.regime ? 1 : 0;
}

export function regimeTick(state) {
  const M = state.pack.model;
  for (const c of state.landen) {
    const r = regimeVan(state, c);
    if (!r) continue;

    if (r.verkiezingen && state.dag - (c.laatsteVerkiezing ?? 0) >= r.verkiezingen) {
      c.laatsteVerkiezing = state.dag;
      if (c.stab >= (r.verkiezing_drempel ?? 45)) {
        c.stab = clamp(c.stab + 3, 0, 100);
        if (c.idx === state.speler) log(state, 'Verkiezingen gewonnen: je regering krijgt een nieuw mandaat.', 'goed', true);
      } else {
        // De oppositie wint: lagere belasting, meer verdeling, en een frisse start voor de stabiliteit.
        c.belasting = clamp(c.belasting - 0.03, 0.08, 0.4);
        c.verdeling = clamp(c.verdeling + 0.06, 0, 0.4);
        c.stab = clamp(c.stab + 8, 0, 100);
        for (const o of state.oorlogen) if ([o.a, o.b].includes(c.blok) || [o.a, o.b].includes(`land:${c.idx}`)) o.vredesaanbod = true;
        log(state, c.idx === state.speler
          ? 'Verkiezingen verloren. De nieuwe coalitie verlaagt de belasting, verhoogt de uitgaven en wil vrede.'
          : `Machtswissel na verkiezingen in ${c.naam}.`, c.idx === state.speler ? 'slecht' : 'info', c.idx === state.speler);
      }
    }

    if (r.staatsgreep && c.stab < 30 && nextRandom(state) < r.staatsgreep) {
      c.stab = clamp(c.stab + 12, 0, 100);
      c.controle = clamp(c.controle + 20, 0, 100);
      c.complot = clamp(c.complot + 8, 0, 100);
      if (!c.vast) for (const b of Object.keys(c.loyaliteit)) c.loyaliteit[b] = (c.loyaliteit[b] + c.basis[b]) / 2;
      log(state, c.idx === state.speler ? 'Staatsgreep: een junta van officieren grijpt de macht binnen je regime. De orde keert terug, het vertrouwen niet.' : `Staatsgreep in ${c.naam}.`, c.idx === state.speler ? 'slecht' : 'info', true);
    }

    if (c.stab < (M.revolutie_drempel ?? 6)) revolutie(state, c);
  }
}

export function revolutie(state, c) {
  const oud = regimeVan(state, c);
  const naar = state.pack.regimes[oud?.revolutie_naar] ? oud.revolutie_naar : Object.keys(state.pack.regimes).find((k) => k !== c.regime);
  c.regime = naar;
  c.stab = 38;
  c.complot = Math.max(0, c.complot - 20);
  c.controle = Math.max(0, c.controle - 20);
  c.revoluties = (c.revoluties ?? 0) + 1;
  c.laatsteVerkiezing = state.dag;
  if (!c.vast) for (const b of Object.keys(c.loyaliteit)) c.loyaliteit[b] = (c.loyaliteit[b] + c.basis[b]) / 2;
  const nieuw = regimeVan(state, c);
  log(state, c.idx === state.speler
    ? `Revolutie! Je regime is gevallen. ${c.naam} is nu een ${nieuw.naam.toLowerCase()}.`
    : `Revolutie in ${c.naam}: voortaan een ${nieuw.naam.toLowerCase()}.`, c.idx === state.speler ? 'slecht' : 'info', true);
}

export function hervormingStatus(state, landIdx, naar) {
  const c = state.landen[landIdx];
  const h = state.pack.model.hervorming;
  if (!state.pack.regimes[naar]) return { ok: false, reden: 'Onbekend regime.' };
  if (naar === c.regime) return { ok: false, reden: 'Dit is al je regime.' };
  const af = c.afkoeling.hervorming ?? 0;
  if (af > state.dag) return { ok: false, reden: `Je samenleving is nog niet klaar voor een nieuwe omwenteling: nog ${af - state.dag} dagen.` };
  const kosten = { [state.pack.rollen.geld]: h.kosten };
  if (!kanBetalen(c, kosten)) return { ok: false, reden: 'Onvoldoende middelen.' };
  if (c.stab < h.stabiliteit + 10) return { ok: false, reden: `Vraagt minstens ${h.stabiliteit + 10} stabiliteit: een hervorming kost er ${h.stabiliteit}.` };
  return { ok: true, kosten };
}

export function hervorm(state, landIdx, naar) {
  const st = hervormingStatus(state, landIdx, naar);
  if (!st.ok) return st;
  const c = state.landen[landIdx];
  const h = state.pack.model.hervorming;
  betaal(c, st.kosten);
  c.regime = naar;
  c.stab = clamp(c.stab - h.stabiliteit, 0, 100);
  c.complot = clamp(c.complot + h.complot, 0, 100);
  c.afkoeling.hervorming = state.dag + h.afkoeling;
  c.laatsteVerkiezing = state.dag;
  log(state, `Staatshervorming: ${c.naam} is nu een ${regimeVan(state, c).naam.toLowerCase()}.`, 'info', true);
  return { ok: true };
}
