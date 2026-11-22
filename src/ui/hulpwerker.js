// C18b: de Web Worker van het vraagteken. Een dunne laag om hulpreken.kies, zodat het vooruitrekenen (zes keer 60
// speeldagen) het spel niet laat haperen. De spelstand verandert hier nooit: de worker krijgt een kopie.
//
// Berichten:
//   → { soort: 'pack', potje, pad, instellingen }   één keer per potje: de worker laadt het pack zelf (packloader, via de
//                                            service worker ook offline) en zet met createGame de indexen erbij, zoals
//                                            het spel. Het pack van de hoofdthread kan niet mee: de kaart hangt er functies aan.
//   → { soort: 'kies', id, potje, state, ctx, budgetMs, dagen }   state zonder pack en zonder replay
//   ← { soort: 'klaar', id, dag, stap, uitkomst: {sleutel: {score, regel3, fout, gerekend}}, gerekend, geschat, ms }
//   ← { soort: 'fout', id, tekst }

import { kies } from './hulpreken.js';
import { loadPack } from '../engine/packloader.js';
import { createGame } from '../engine/sim.js';

const ROOT = new URL('../../', import.meta.url);
const readText = async (p) => {
  const r = await fetch(new URL(p, ROOT), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

let pack = null;
let potje = null;
let laden = Promise.resolve();
// Review: een pack per pad één keer laden. Een nieuw potje met hetzelfde pack (ander land of andere seed) krijgt
// hetzelfde pack, net als op de hoofdthread; de indexen op het pack hangen niet van de seed af.
const geladen = {};

self.onmessage = (e) => {
  const m = e.data ?? {};
  if (m.soort === 'pack') {
    potje = m.potje;
    pack = null;
    geladen[m.pad] ??= loadPack(m.pad, readText).then((res) => {
      if (!res.pack) throw new Error(res.rapport?.fouten?.[0] ?? 'Pack niet geladen.');
      createGame(res.pack, m.instellingen); // zet gebouwIndex, resIndex, geo en eenhedenIndex op het pack, zoals in het spel
      return res.pack;
    });
    laden = geladen[m.pad].then((p) => { if (potje === m.potje) pack = p; })
      .catch((err) => { delete geladen[m.pad]; console.warn('hulpwerker pack', err); });
    return;
  }
  if (m.soort !== 'kies') return;
  laden.then(() => beantwoord(m));
};

function beantwoord(m) {
  try {
    if (!pack || m.potje !== potje) throw new Error('Geen pack voor dit potje.');
    const s = m.state;
    s.pack = pack;
    s.replay = null;
    const t0 = performance.now();
    const r = kies(s, { klok: () => performance.now(), budgetMs: m.budgetMs, dagen: m.dagen, ctx: m.ctx });
    const uitkomst = {};
    for (const k of r?.kandidaten ?? []) uitkomst[k.sleutel] = { score: k.score, regel3: k.regel3, fout: k.fout ?? null, gerekend: !!k.gerekend };
    self.postMessage({ soort: 'klaar', id: m.id, dag: s.dag, stap: r?.stap?.sleutel ?? null, uitkomst, gerekend: r?.gerekend ?? 0, geschat: !!r?.geschat, ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ soort: 'fout', id: m.id, tekst: String(err?.message ?? err) });
  }
}
