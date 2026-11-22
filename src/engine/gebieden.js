// C17c: gebieden (thuis en elke kolonie) en de bouwwachtrij per gebied (docs/c17-plan.md, "c17c-gebieden").
//
// Een gebied is de hoofdstad of een koloniecentrum. Land dat bij de start onbewoond was, hoort bij het koloniecentrum
// dat het dichtst bij ligt; al het andere eigen land hoort bij thuis (ook een stuk kust dat dichter bij een kolonie
// ligt). Bij gelijke afstand wint het eerste in gebiedCentra. Deterministisch: geen DOM, geen klok, itereren op index.
//
// De wachtrij ("Bouw zoals thuis") is een order 'bouwrij' {gebied, items}. Elke dag start de engine het volgende
// item zodra er een projectplek vrij is en het te betalen valt, met dezelfde kosten en plekken als gewoon bouwen.
// Zonder wachtrij verandert er niets: c.bouwrij bestaat dan niet en de afdruk is leeg.

import { bouw, bouwKosten, kiesTegel, isOntgrendeld, log } from './sim.js';
import { actieveVerbouw } from './verbouw.js';
import { tegelAfstand } from './geografie.js';

// [hoofdstadtegel, ...koloniecentra in de volgorde van state.kolonies]. Een hoofdstad zonder tegel telt niet mee.
export function gebiedCentra(state, landIdx) {
  const uit = [];
  const h = state.pack.geo.hoofdstad[landIdx];
  if (h >= 0) uit.push(h);
  for (let i = 0; i < state.kolonies.length; i++) if (state.kolonies[i].land === landIdx) uit.push(state.kolonies[i].t);
  return uit;
}

// Welke tegels bij de start onbewoond waren (per kaart één keer opgezocht; de kaart verandert niet).
const onbewoondVan = new WeakMap();
function wasOnbewoond(geo, t) {
  let set = onbewoondVan.get(geo);
  if (!set) { set = new Set(geo.onbewoond ?? []); onbewoondVan.set(geo, set); }
  return set.has(t);
}

function dichtstbij(geo, centra, t) {
  // centra[0] is thuis (als er een hoofdstad is); vasteland hoort daar altijd bij.
  const metThuis = centra.length && geo.hoofdstad.includes(centra[0]);
  if (metThuis && (centra.length === 1 || !wasOnbewoond(geo, t))) return centra[0];
  let best = -1;
  let bd = Infinity;
  for (let i = metThuis ? 1 : 0; i < centra.length; i++) {
    const d = tegelAfstand(geo, centra[i], t);
    if (d < bd) { bd = d; best = centra[i]; }
  }
  return best;
}

// Het centrum van het gebied waar tegel t bij hoort (−1 als het land geen gebieden heeft).
export function gebiedVan(state, landIdx, t, centra = gebiedCentra(state, landIdx)) {
  if (t == null || t < 0 || !state.pack.geo.tegels[t]) return -1;
  return dichtstbij(state.pack.geo, centra, t);
}

// De eigen tegels van een gebied, in de volgorde van state.landTegels.
export function gebiedTegels(state, landIdx, centrum, centra = gebiedCentra(state, landIdx)) {
  const geo = state.pack.geo;
  const uit = [];
  const lijst = state.landTegels[landIdx];
  for (let i = 0; i < lijst.length; i++) if (dichtstbij(geo, centra, lijst[i]) === centrum) uit.push(lijst[i]);
  return uit;
}

// Mag dit gebouw in een wachtrij? Geen leger (snelle bewapening overzee) en geen knooppunt (het centrum is er al een).
export function magInRij(state, gebouwId) {
  const g = state.pack.gebouwIndex[gebouwId];
  return !!g && g.categorie !== 'leger' && !g.knooppunt;
}

const naamVan = (state, centrum) => {
  const k = state.kolonies.find((x) => x.t === centrum);
  return k ? k.naam : 'thuis';
};

// Order 'bouwrij': leg de wachtrij van een gebied vast. Een lege lijst stopt de rij.
export function voerBouwrijUit(state, landIdx, o) {
  const c = state.landen[landIdx];
  const M = state.pack.model;
  const gebied = +o.gebied;
  if (!gebiedCentra(state, landIdx).includes(gebied)) return { ok: false, reden: 'Dat gebied is niet (meer) van jou.' };
  if (!Array.isArray(o.items)) return { ok: false, reden: 'Geen lijst met gebouwen.' };
  const max = M.bouwrij_max ?? 8;
  if (o.items.length > max) return { ok: false, reden: `Hooguit ${max} gebouwen in de wachtrij.` };
  for (let i = 0; i < o.items.length; i++) {
    const id = o.items[i];
    const g = state.pack.gebouwIndex[id];
    if (!g) return { ok: false, reden: 'Onbekend gebouw in de wachtrij.' };
    if (!magInRij(state, id)) return { ok: false, reden: `${g.naam} kan niet in de wachtrij.` };
    if (!isOntgrendeld(state, id)) return { ok: false, reden: `${g.naam} is nog niet beschikbaar.` };
  }
  if (!o.items.length) {
    if (c.bouwrij) { delete c.bouwrij[gebied]; if (!Object.keys(c.bouwrij).length) delete c.bouwrij; }
    return { ok: true };
  }
  c.bouwrij ??= {};
  c.bouwrij[gebied] = { items: o.items.slice(), sinds: state.dag };
  return { ok: true };
}

// Na betalen blijft van elke grondstof minstens `buffer` van de voorraad van vóór betalen over.
export function binnenBuffer(c, kosten, buffer) {
  for (const [r, v] of Object.entries(kosten)) {
    const heb = c.voorraad[r] ?? 0;
    if (v > heb || heb - v < buffer * heb) return false;
  }
  return true;
}

// Eén keer per dag (in tick, na het afronden van bouwprojecten en na de orders van de speler).
export function bouwrijTick(state) {
  const M = state.pack.model;
  const buffer = M.bouwrij_buffer ?? 0.25;
  const wacht = M.bouwrij_wacht ?? 60;
  for (let li = 0; li < state.landen.length; li++) {
    const c = state.landen[li];
    if (!c.bouwrij) continue;
    const speler = li === state.speler;
    const centra = gebiedCentra(state, li);
    // Kolonie verloren (opstand): de rij van dat gebied vervalt.
    const sleutels = Object.keys(c.bouwrij);
    for (let i = 0; i < sleutels.length; i++) {
      if (centra.includes(+sleutels[i])) continue;
      delete c.bouwrij[sleutels[i]];
      if (speler) log(state, 'De wachtrij van een verloren kolonie is vervallen.', 'slecht', true);
    }
    for (let i = 0; i < centra.length; i++) {
      const g = centra[i];
      const rij = c.bouwrij[g];
      if (!rij) continue;
      const naam = naamVan(state, g);
      while (rij.items.length && c.bouw.length + actieveVerbouw(c) < M.max_bouw) {
        const id = rij.items[0];
        const gb = state.pack.gebouwIndex[id];
        const kosten = bouwKosten(state, c, id);
        if (!binnenBuffer(c, kosten, buffer)) {
          if (state.dag - rij.sinds <= wacht) break; // wachten op geld
          rij.items.shift();
          rij.sinds = state.dag;
          if (speler) log(state, `Wachtrij ${naam}: ${gb.naam} geschrapt, er was ${wacht} dagen geen geld voor.`, 'slecht', true);
          continue;
        }
        const t = kiesTegel(state, c, id, g);
        if (t < 0) {
          rij.items.shift();
          rij.sinds = state.dag; // review: het volgende item krijgt zijn eigen wachttijd
          if (speler) log(state, `Wachtrij ${naam}: geen plek meer voor ${gb.naam.toLowerCase()}, overgeslagen.`, 'slecht', true);
          continue;
        }
        const r = bouw(state, li, id, t);
        rij.items.shift();
        rij.sinds = state.dag;
        if (!r.ok) { if (speler) log(state, `Wachtrij ${naam}: ${gb.naam.toLowerCase()} lukte niet. ${r.reden}`, 'slecht', true); continue; }
        if (speler) log(state, `Wachtrij ${naam}: ${gb.naam.toLowerCase()} wordt gebouwd.`, 'goed', true);
      }
      if (!rij.items.length) {
        delete c.bouwrij[g];
        if (speler) log(state, `Wachtrij ${naam} is klaar.`, 'goed');
      }
    }
    if (!Object.keys(c.bouwrij).length) delete c.bouwrij;
  }
}

// Voor de vingerafdruk: leeg zolang geen enkel land een wachtrij heeft (oude opslagen en replays blijven gelijk).
export function bouwrijAfdruk(state) {
  let uit = '';
  for (let li = 0; li < state.landen.length; li++) {
    const r = state.landen[li].bouwrij;
    if (!r) continue;
    const sleutels = Object.keys(r);
    for (let i = 0; i < sleutels.length; i++) uit += `${li}:${sleutels[i]}:${r[sleutels[i]].sinds}:${r[sleutels[i]].items.join('+')},`;
  }
  return uit ? `#r${uit}` : '';
}
