// C16b: het ordersignaal (docs/c16-plan.md, afspraak 4). geef() in main.js roept na elke issueOrder precies één keer
// meldOrder(order, r) aan. Dat stuurt twee gebeurtenissen op window:
//   'order'        { order, ok, reden }                          voor elke order
//   'bouwfeedback' { gebouw, tegel, kosten, effect, klaarDag, order } alleen bij een geslaagde 'bouw'
//   'bouwlade'     { stap, gebouw, kaartInBeeld }                 lade en plaatsmodus (meldBouwlade)
// c16a (chip licht op), c16c (toast en label) en c16d (speelverslag) luisteren alleen; niemand haakt verder in geef().
// Deze module leest de toestand en verandert hem nooit (geen orders, geen schrijven naar state).

import * as sim from '../engine/sim.js';
import { effectVan } from './evenwicht.js';

let bron = () => null;

// main.js geeft één keer door waar de spelstand staat.
export function zetBron(fn) { bron = typeof fn === 'function' ? fn : () => null; }

// De gegevens voor 'bouwfeedback', uit de laatste c.bouw-regel van dat gebouw (de engine koos de tegel bij Auto).
export function bouwGegevens(s, order) {
  const c = s?.landen?.[order.land ?? s.speler];
  const g = s?.pack?.gebouwIndex?.[order.gebouw];
  if (!c || !g) return null;
  let i = c.bouw.length - 1;
  while (i >= 0 && !(c.bouw[i].gebouw === g.id && (order.tegel == null || c.bouw[i].tegel === order.tegel))) i--;
  const regel = i >= 0 ? c.bouw[i] : null;
  const tegel = regel?.tegel ?? order.tegel ?? -1;
  // De kosten zoals ze vóór deze order waren: bouwKosten telt het nieuwe project al mee, dus zonder die regel.
  const zonder = i >= 0 ? { ...c, bouw: c.bouw.filter((_, j) => j !== i) } : c;
  const kosten = sim.bouwKosten(s, zonder, g.id);
  const effect = effectVan(s, g.id, tegel >= 0 ? tegel : null).per;
  return { gebouw: g.id, tegel, kosten, effect, klaarDag: regel?.klaar ?? s.dag + (g.bouwtijd ?? 5), order };
}

function stuur(venster, naam, detail) {
  if (!venster?.dispatchEvent) return;
  const E = venster.CustomEvent ?? globalThis.CustomEvent;
  venster.dispatchEvent(new E(naam, { detail }));
}

// De lade en de plaatsmodus melden zichzelf (afspraak 5): { stap: 'open'|'kies'|'verplaats'|'bevestig'|'annuleer'|
// 'plaats'|'plaatsStop', gebouw, kaartInBeeld }. c16d luistert hiernaar.
export function meldBouwlade(detail, venster = typeof window !== 'undefined' ? window : null) {
  try { stuur(venster, 'bouwlade', detail); } catch (e) { console.warn('ordersignaal', e); }
}

export function meldOrder(order, r, { state = bron(), venster = typeof window !== 'undefined' ? window : null } = {}) {
  const ok = !!r?.ok;
  try {
    stuur(venster, 'order', { order, ok, reden: ok ? null : r?.reden ?? null });
    if (ok && order?.type === 'bouw' && state) {
      const d = bouwGegevens(state, order);
      if (d) stuur(venster, 'bouwfeedback', d);
    }
  } catch (e) { console.warn('ordersignaal', e); }
}
