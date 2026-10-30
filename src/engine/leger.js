// Leger: eenheden op de vakjeskaart, padvinden, gevecht, verovering, oorlog en vrede.
// Gevechten zijn bewust abstract: aanval, levenspunten, bereik en terrein. Geen echte wapensystemen of tactieken.

import { nextRandom } from './rng.js';
import {
  log, blokVan, isOntgrendeld, kanBetalen, betaal, actieKosten, kostenInGeld, bouw, herbereken,
  escalatieStatus, MOEILIJKHEID,
} from './sim.js';
import { regimeEffect } from './regimes.js';
import { moraalFactor } from './media.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const TERREIN_KOSTEN = { vlakte: 1, kust: 1, bos: 1.5, berg: 2.2 };
const TERREIN_DEKKING = { vlakte: 1, kust: 1, bos: 0.8, berg: 0.65 };

// Een partij is een blok, of een los zwevend land.
export function partij(state, c) {
  return c.alignment && c.alignment !== 'zwevend' ? c.alignment : `land:${c.idx}`;
}

export function partijNaam(state, p) {
  return p.startsWith('land:') ? state.landen[+p.slice(5)].naam : blokVan(state, p).naam;
}

function oorlogSleutels(state) {
  const set = new Set();
  for (const o of state.oorlogen) { set.add(`${o.a}|${o.b}`); set.add(`${o.b}|${o.a}`); }
  return set;
}

export function inOorlog(state, a, b) {
  if (a === b) return false;
  const pa = partij(state, a), pb = partij(state, b);
  if (pa === pb) return false;
  return state.oorlogen.some((o) => (o.a === pa && o.b === pb) || (o.a === pb && o.b === pa));
}

export function oorlogenVan(state, c) {
  const p = partij(state, c);
  return state.oorlogen.filter((o) => o.a === p || o.b === p);
}

export function eenheidType(state, id) {
  return state.pack.eenhedenIndex[id];
}

export function sterkte(state, landIdx) {
  let s = 0;
  for (const u of state.eenheden) if (u.land === landIdx) s += (u.hp / 100) * eenheidType(state, u.type).aanval;
  return s;
}

export function partijSterkte(state, p) {
  let s = 0;
  for (const c of state.landen) if (partij(state, c) === p) s += sterkte(state, c.idx);
  return s;
}

export function legerOnderhoud(state, c) {
  let s = 0;
  for (const u of state.eenheden) if (u.land === c.idx) s += eenheidType(state, u.type).onderhoud ?? 0.3;
  return s;
}

// ---------- verplaatsen ----------

// Schepen varen alleen over water, landeenheden lopen over land (ook onbewoond), drones mogen overal.
export function begaanbaar(state, landIdx, t, e = {}) {
  const tegel = state.pack.geo.tegels[t];
  if (!tegel) return false;
  const eig = state.eigenaar[t];
  if (e.vaart) return eig === -1;
  if (eig === -1) return !!e.vliegt;
  if (eig === -2) return true;
  if (eig === landIdx) return true;
  const a = state.landen[landIdx], b = state.landen[eig];
  if (a.alignment && a.alignment !== 'zwevend' && a.alignment === b.alignment) return true;
  return inOorlog(state, a, b);
}

function buurTegels(geo, t) {
  const tg = geo.tegels[t];
  const uit = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dk = -1; dk <= 1; dk++) {
      if (!dr && !dk) continue;
      const k = tg.k + dk, r = tg.r + dr;
      if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
      uit.push([r * geo.kol + k, dk && dr ? 1.414 : 1]);
    }
  }
  return uit;
}

function stapKosten(state, t, e = {}) {
  return e.vliegt || e.vaart ? 1 : TERREIN_KOSTEN[state.pack.geo.tegels[t].terrein] ?? 1;
}

// A* over de vakjes. Klein raster, dus een eenvoudige binaire heap is ruim genoeg.
export function zoekPad(state, landIdx, van, naar, e = {}) {
  const geo = state.pack.geo;
  if (van === naar) return [];
  if (!begaanbaar(state, landIdx, naar, e)) return null;
  const doel = geo.tegels[naar];
  const h = (t) => Math.hypot(geo.tegels[t].k - doel.k, geo.tegels[t].r - doel.r);
  const g = new Map([[van, 0]]);
  const vorig = new Map();
  const heap = [[h(van), van]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  let bezocht = 0;
  while (heap.length && bezocht < 4000) {
    const [, t] = pop();
    bezocht += 1;
    if (t === naar) {
      const pad = [];
      for (let x = naar; x !== van; x = vorig.get(x)) pad.push(x);
      return pad.reverse();
    }
    for (const [n, f] of buurTegels(geo, t)) {
      if (!begaanbaar(state, landIdx, n, e)) continue;
      const ng = g.get(t) + stapKosten(state, n, e) * f;
      if (ng < (g.get(n) ?? Infinity)) {
        g.set(n, ng);
        vorig.set(n, t);
        push([ng + h(n), n]);
      }
    }
  }
  return null;
}

export function beweegEenheden(state, landIdx, ids, naar) {
  let ok = 0;
  for (const id of ids) {
    const u = state.eenheden.find((x) => x.id === id);
    if (!u || u.land !== landIdx) continue;
    const type = eenheidType(state, u.type);
    let pad = zoekPad(state, landIdx, u.t, naar, type);
    if (!pad && type.vaart) {
      // Schip naar land gestuurd: vaar naar het dichtstbijzijnde stukje water ernaast.
      const geo = state.pack.geo;
      const doel = geo.tegels[naar];
      const kandidaten = geo.tegels.filter((t) => state.eigenaar[t.i] === -1 && Math.hypot(t.k - doel.k, t.r - doel.r) <= 3)
        .sort((a, b) => Math.hypot(a.k - doel.k, a.r - doel.r) - Math.hypot(b.k - doel.k, b.r - doel.r) || a.i - b.i);
      for (const k of kandidaten.slice(0, 6)) { pad = zoekPad(state, landIdx, u.t, k.i, type); if (pad) break; }
    }
    if (!pad) continue;
    u.pad = pad;
    u.voortgang = 0;
    ok += 1;
  }
  return ok ? { ok: true, aantal: ok } : { ok: false, reden: 'Geen begaanbare route. Landeenheden gaan door eigen gebied, bondgenoten, onbewoond land en landen waarmee je in oorlog bent; schepen alleen over water dat ze kunnen bereiken.' };
}

// ---------- trainen ----------

export function trainStatus(state, landIdx, typeId) {
  const c = state.landen[landIdx];
  const e = eenheidType(state, typeId);
  if (!e) return { ok: false, reden: 'Onbekende eenheid.' };
  if (!isOntgrendeld(state, 'leger')) return { ok: false, reden: 'Het leger komt vrij in een latere fase.' };
  if (!isOntgrendeld(state, e.id)) return { ok: false, reden: 'Nog niet beschikbaar in deze fase.' };
  if (!c.plaatsingen.some((p) => p.g === e.gebouw)) return { ok: false, reden: `Vraagt een ${state.pack.gebouwIndex[e.gebouw]?.naam.toLowerCase() ?? e.gebouw}.` };
  const aantal = state.eenheden.filter((u) => u.land === landIdx).length + c.training.length;
  if (aantal >= state.pack.model.max_eenheden) return { ok: false, reden: `Maximaal ${state.pack.model.max_eenheden} eenheden per land.` };
  if (c.training.length >= state.pack.model.max_training) return { ok: false, reden: `Maximaal ${state.pack.model.max_training} eenheden tegelijk in opleiding.` };
  if (!kanBetalen(c, eenheidKosten(state, c, e))) return { ok: false, reden: 'Onvoldoende middelen.' };
  return { ok: true };
}

export function eenheidKosten(state, c, e) {
  const korting = regimeEffect(state, c, 'leger_korting');
  const uit = {};
  for (const [r, v] of Object.entries(e.kosten || {})) uit[r] = Math.round(v * (1 - korting));
  return uit;
}

export function train(state, landIdx, typeId) {
  const st = trainStatus(state, landIdx, typeId);
  if (!st.ok) return st;
  const c = state.landen[landIdx];
  const e = eenheidType(state, typeId);
  const kosten = eenheidKosten(state, c, e);
  betaal(c, kosten);
  // Nieuwe eenheden verschijnen bij het gebouw met de kortste wachtrij.
  const gebouwen = c.plaatsingen.filter((p) => p.g === e.gebouw);
  const tegel = gebouwen[c.training.length % gebouwen.length].t;
  const start = Math.max(state.dag, ...c.training.map((x) => x.klaar));
  c.training.push({ type: typeId, tegel, klaar: start + (e.bouwtijd ?? 6) });
  if (landIdx === state.speler) state.balans.investeren += kostenInGeld(state, kosten) * 0.03;
  return { ok: true };
}

function spawn(state, c, typeId, t) {
  const e = eenheidType(state, typeId);
  const tg = state.pack.geo.tegels[t];
  state.eenheden.push({ id: state.volgendeEenheidId++, land: c.idx, type: typeId, t, x: tg.x, y: tg.y, px: tg.x, py: tg.y, hp: e.hp, pad: [], voortgang: 0, bezig: 0, vecht: false });
}

// ---------- verovering ----------

export function verover(state, t, nieuwIdx) {
  const geo = state.pack.geo;
  const oud = state.eigenaar[t];
  if (oud === nieuwIdx || oud < 0) return;
  const verliezer = state.landen[oud];
  const winnaar = state.landen[nieuwIdx];
  state.eigenaar[t] = nieuwIdx;
  state.landTegels[oud] = state.landTegels[oud].filter((x) => x !== t);
  state.landTegels[nieuwIdx].push(t);
  state.grensVersie += 1;

  const b = state.bezet[t];
  if (b?.kolonie) {
    const k = state.kolonies.find((x) => x.t === t);
    if (k) k.land = nieuwIdx;
    b.land = nieuwIdx;
  }
  if (b?.gebouw) {
    if (b.bouw) {
      verliezer.bouw = verliezer.bouw.filter((x) => x.tegel !== t);
      state.bezet[t] = null;
    } else {
      const i = verliezer.plaatsingen.findIndex((p) => p.t === t);
      if (i >= 0) {
        const [p] = verliezer.plaatsingen.splice(i, 1);
        verliezer.gebouwen[p.g] -= 1;
        winnaar.plaatsingen.push(p);
        winnaar.gebouwen[p.g] = (winnaar.gebouwen[p.g] || 0) + 1;
        state.bezet[t] = { land: nieuwIdx, gebouw: p.g, bouw: false };
      }
    }
  }
  // Bevolking verhuist mee met het grondgebied.
  const aandeel = 1 / Math.max(1, state.landTegels[oud].length + 1);
  const mensen = verliezer.L * aandeel;
  verliezer.L -= mensen;
  winnaar.L += mensen;
  herbereken(state, verliezer);
  herbereken(state, winnaar);
  if (t === geo.hoofdstad[oud]) capitulatie(state, verliezer, winnaar);
}

function capitulatie(state, verliezer, winnaar) {
  const geo = state.pack.geo;
  const h = geo.hoofdstad[verliezer.idx];
  // De hoofdstad gaat terug naar het land zelf; het land wordt wel een vazal van het winnende blok.
  state.eigenaar[h] = verliezer.idx;
  state.landTegels[winnaar.idx] = state.landTegels[winnaar.idx].filter((x) => x !== h);
  state.landTegels[verliezer.idx].push(h);
  state.bezet[h] = { land: verliezer.idx, hoofdstad: true };
  state.eenheden = state.eenheden.filter((u) => u.land !== verliezer.idx);

  if (verliezer.idx === state.speler) {
    state.uitkomst = { spelerWint: false, reden: 'Capitulatie', tekst: `${winnaar.naam} heeft je hoofdstad ingenomen. Je land capituleert.`, dag: state.dag };
    log(state, state.uitkomst.tekst, 'slecht', true);
    return;
  }
  const oudePartij = partij(state, verliezer);
  const nieuwBlok = winnaar.alignment && winnaar.alignment !== 'zwevend' ? winnaar.alignment : null;
  // Leidt het verslagen land een blok, dan neemt een ander kernland het over.
  for (const b of state.blokken) {
    if (b.leider !== verliezer.idx) continue;
    const opvolger = state.landen.find((l) => l.blok === b.id && l.kern && l !== verliezer);
    b.leider = opvolger ? opvolger.idx : -1;
    if (opvolger) opvolger.vast = true;
  }
  verliezer.vast = false;
  verliezer.kern = false;
  if (nieuwBlok) {
    for (const b of state.blokken) {
      verliezer.loyaliteit[b.id] = b.id === nieuwBlok ? 85 : 10;
      verliezer.basis[b.id] = b.id === nieuwBlok ? 70 : 20;
    }
    verliezer.blok = nieuwBlok;
  }
  verliezer.stab = clamp(verliezer.stab - 25, 5, 100);
  verliezer.effecten = [];
  state.oorlogen = state.oorlogen.filter((o) => o.a !== `land:${verliezer.idx}` && o.b !== `land:${verliezer.idx}`);
  log(state, `${verliezer.naam} capituleert voor ${winnaar.naam}${nieuwBlok ? ` en valt voortaan onder ${blokVan(state, nieuwBlok).naam}` : ''}.`, winnaar.idx === state.speler || nieuwBlok === state.spelerBlok ? 'goed' : 'slecht', true);
  if (oudePartij !== partij(state, verliezer)) state.grensVersie += 1;
}

// ---------- oorlog en vrede ----------

export function verklaarOorlog(state, payerIdx, doelIdx, e, st) {
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const pa = partij(state, payer), pb = partij(state, t);
  if (inOorlog(state, payer, t)) return { ok: false, reden: 'Je bent al in oorlog met deze partij.' };
  const bestand = state.wapenstilstand[[pa, pb].sort().join('|')] ?? -1;
  if (bestand > state.dag) return { ok: false, reden: `Wapenstilstand: nog ${bestand - state.dag} dagen.` };
  const kosten = actieKosten(state, e, t);
  betaal(payer, kosten);
  const casusBelli = (state.casusBelli[`${pa}|${pb}`] ?? -1) > state.dag;
  const steun = payer.modifiers.some((m) => m.type === 'oorlogssteun' && m.tot > state.dag);
  const stabKost = (e.eigen_stabiliteit ?? -10) * (casusBelli ? 0.5 : 1) * (steun ? 0.5 : 1);
  payer.stab = clamp(payer.stab + stabKost, 0, 100);
  const derden = (e.derden_loyaliteit ?? -6) * (casusBelli ? 0.2 : 1) * (st.sprong ? 2 : 1);
  for (const o of state.landen) {
    if (o.vast || o === t || partij(state, o) === pa) continue;
    const tol = state.pack.persoonlijkheden[o.persoonlijkheid].druk_tolerantie ?? 1;
    o.loyaliteit[payer.blok] = clamp(o.loyaliteit[payer.blok] + derden / tol, 0, 100);
  }
  blokVan(state, payer.blok).spanning += e.spanning ?? 30;
  if (!pb.startsWith('land:')) blokVan(state, pb).spanning += e.spanning ?? 30;
  state.oorlogen.push({ a: pa, b: pb, start: state.dag, aanvaller: pa });
  state.afkoeling[`${payer.blok}|${e.id}`] = state.dag + (e.afkoeling ?? 60);
  state.escalaties.push({ blok: payer.blok, doel: t.idx, trede: e.trede, dag: state.dag });
  const speler = payerIdx === state.speler || pb === state.spelerBlok || pb === `land:${state.speler}`;
  log(state, `${partijNaam(state, pa)} verklaart ${partijNaam(state, pb)} de oorlog.${casusBelli ? ' Met een casus belli: de wereld kijkt welwillender toe.' : ''}`, speler && payerIdx !== state.speler ? 'slecht' : 'info', true);
  if (payerIdx === state.speler) state.balans.invloed += kostenInGeld(state, kosten) * 0.03;
  return { ok: true };
}

export function vredeStatus(state, payerIdx, oorlog) {
  const payer = state.landen[payerIdx];
  const p = partij(state, payer);
  if (!oorlog || (oorlog.a !== p && oorlog.b !== p)) return { ok: false, reden: 'Geen oorlog met deze partij.' };
  const ander = oorlog.a === p ? oorlog.b : oorlog.a;
  const eigen = partijSterkte(state, p);
  const hun = partijSterkte(state, ander);
  const duur = state.dag - oorlog.start;
  const leider = ander.startsWith('land:') ? state.landen[+ander.slice(5)] : state.landen[blokVan(state, ander).leider];
  const aanvaard = hun <= eigen * 1.1 || duur > 150 || (leider && (leider.stab < 35 || leider.moraal < 30)) || oorlog.vredesaanbod;
  return aanvaard ? { ok: true, ander } : { ok: false, reden: `${partijNaam(state, ander)} weigert: ze denken nog te kunnen winnen.`, ander };
}

export function sluitVrede(state, payerIdx, oorlogIdx) {
  const o = state.oorlogen[oorlogIdx];
  const st = vredeStatus(state, payerIdx, o);
  if (!st.ok) return st;
  beeindig(state, o);
  return { ok: true };
}

function beeindig(state, o) {
  state.oorlogen = state.oorlogen.filter((x) => x !== o);
  state.wapenstilstand[[o.a, o.b].sort().join('|')] = state.dag + 180;
  // Troepen in gebied dat niet meer begaanbaar is, trekken zich terug naar hun hoofdstad.
  for (const u of state.eenheden) {
    if (begaanbaar(state, u.land, u.t, eenheidType(state, u.type))) continue;
    const h = state.pack.geo.hoofdstad[u.land];
    const tg = state.pack.geo.tegels[h];
    u.t = h; u.x = u.px = tg.x; u.y = u.py = tg.y; u.pad = []; u.voortgang = 0;
  }
  log(state, `Vrede tussen ${partijNaam(state, o.a)} en ${partijNaam(state, o.b)}.`, 'goed', true);
}

// ---------- dagelijkse tick ----------

export function legerTick(state) {
  const geo = state.pack.geo;
  const T = geo.T;
  const M = state.pack.model;

  // Opleiding afronden
  for (const c of state.landen) {
    if (!c.training.length) continue;
    const klaar = c.training.filter((x) => x.klaar <= state.dag);
    for (const k of klaar) {
      if (state.eigenaar[k.tegel] === c.idx) spawn(state, c, k.type, k.tegel);
      else spawn(state, c, k.type, geo.hoofdstad[c.idx]);
      if (c.idx === state.speler) log(state, `${eenheidType(state, k.type).naam} staat klaar.`, 'goed');
    }
    c.training = c.training.filter((x) => x.klaar > state.dag);
  }

  if (!state.eenheden.length) { aiLegerTick(state); return; }

  const oorlog = oorlogSleutels(state);
  const partijen = state.landen.map((c) => partij(state, c));
  const vijand = (a, b) => a !== b && oorlog.has(`${partijen[a]}|${partijen[b]}`);

  // Gevecht: iedereen kiest tegelijk een doel, daarna wordt de schade toegepast.
  const schade = new Map();
  for (const u of state.eenheden) {
    const e = eenheidType(state, u.type);
    if (!(e.aanval > 0)) { u.vecht = false; continue; }
    let best = null;
    let bd = Infinity;
    for (const v of state.eenheden) {
      if (!vijand(u.land, v.land)) continue;
      const d = Math.hypot(u.x - v.x, u.y - v.y) / T;
      if (d <= e.bereik + 0.5 && d < bd) { bd = d; best = v; }
    }
    u.vecht = !!best;
    u.doelwit = best ? best.id : null;
    if (!best) continue;
    const aanvaller = state.landen[u.land], verdediger = state.landen[best.land];
    const terrein = TERREIN_DEKKING[geo.tegels[best.t].terrein] ?? 1;
    const thuis = state.eigenaar[best.t] === best.land ? 0.9 : 1;
    const tech = Math.pow(aanvaller.A / verdediger.A, 0.5);
    const dmg = e.aanval * (u.hp / eenheidType(state, u.type).hp * 0.5 + 0.5) * (0.85 + 0.3 * nextRandom(state)) * tech * terrein * thuis * moraalFactor(aanvaller);
    schade.set(best.id, (schade.get(best.id) ?? 0) + dmg);
  }
  // Hoofdsteden verdedigen zich met een militie.
  for (const c of state.landen) {
    const h = geo.tegels[geo.hoofdstad[c.idx]];
    if (!h) continue;
    let best = null, bd = Infinity;
    for (const v of state.eenheden) {
      if (!vijand(c.idx, v.land)) continue;
      const d = Math.hypot(h.x - v.x, h.y - v.y) / T;
      if (d <= 1.6 && d < bd) { bd = d; best = v; }
    }
    if (best) schade.set(best.id, (schade.get(best.id) ?? 0) + 6 + c.weerbaarheid * 0.3);
  }
  for (const u of state.eenheden) {
    const d = schade.get(u.id);
    if (d) u.hp -= d;
    // Deserteurs: in oorlog met een bevolking die niet wil vechten, lopen de gelederen leeg.
    const c = state.landen[u.land];
    if (c.moraal < 20 && oorlog.size && state.oorlogen.some((o) => [o.a, o.b].includes(partijen[u.land]))) u.hp -= (20 - c.moraal) * 0.05;
  }
  const gesneuveld = state.eenheden.filter((u) => u.hp <= 0);
  if (gesneuveld.length) {
    for (const u of gesneuveld) {
      const c = state.landen[u.land];
      c.stab = clamp(c.stab - 0.4, 0, 100);
      c.verliezen = (c.verliezen ?? 0) + 1;
      if (u.land === state.speler) log(state, `${eenheidType(state, u.type).naam} verloren.`, 'slecht');
    }
    state.eenheden = state.eenheden.filter((u) => u.hp > 0);
  }

  // Bewegen: wie vecht, houdt stand.
  for (const u of state.eenheden) {
    u.px = u.x; u.py = u.y;
    const e = eenheidType(state, u.type);
    if (u.vecht || !u.pad.length) { if (!u.pad.length) u.voortgang = 0; continue; }
    let budget = e.snelheid;
    while (budget > 0 && u.pad.length) {
      const volgende = u.pad[0];
      if (!begaanbaar(state, u.land, volgende, e)) { u.pad = []; u.voortgang = 0; break; }
      const a = geo.tegels[u.t], b = geo.tegels[volgende];
      const kost = stapKosten(state, volgende, e) * (a.k !== b.k && a.r !== b.r ? 1.414 : 1);
      const nodig = kost - u.voortgang;
      if (budget >= nodig) { budget -= nodig; u.t = volgende; u.pad.shift(); u.voortgang = 0; }
      else { u.voortgang += budget; budget = 0; }
    }
    const a = geo.tegels[u.t];
    if (u.pad.length) {
      const b = geo.tegels[u.pad[0]];
      const kost = stapKosten(state, u.pad[0], e) * (a.k !== b.k && a.r !== b.r ? 1.414 : 1);
      const f = clamp(u.voortgang / kost, 0, 1);
      u.x = a.x + (b.x - a.x) * f;
      u.y = a.y + (b.y - a.y) * f;
    } else { u.x = a.x; u.y = a.y; }
  }

  // Veroveren: een eenheid die onbedreigd op vijandelijk gebied staat, neemt het over (met de vakjes eromheen).
  for (const u of state.eenheden) {
    const ut = eenheidType(state, u.type);
    if (ut.vliegt || ut.vaart || u.pad.length) { u.bezig = 0; continue; }
    const eig = state.eigenaar[u.t];
    if (eig < 0 || !vijand(u.land, eig)) { u.bezig = 0; continue; }
    const bedreigd = state.eenheden.some((v) => vijand(u.land, v.land) && Math.hypot(u.x - v.x, u.y - v.y) / T <= 1.6);
    if (bedreigd) { u.bezig = 0; continue; }
    u.bezig += 1;
    const isHoofdstad = u.t === geo.hoofdstad[eig];
    if (u.bezig < (isHoofdstad ? M.hoofdstad_beleg : M.verover_dagen)) continue;
    u.bezig = 0;
    const dekking = [u.t];
    if (!isHoofdstad) {
      for (const [n] of buurTegels(geo, u.t)) {
        if (state.eigenaar[n] === eig && n !== geo.hoofdstad[eig]) dekking.push(n);
      }
    }
    for (const t of dekking) verover(state, t, u.land);
    if (u.land === state.speler && !isHoofdstad) log(state, `Gebied in ${state.landen[eig].naam} veroverd.`, 'goed');
    if (eig === state.speler) log(state, `${state.landen[u.land].naam} verovert gebied van je.`, 'slecht', state.dag % 10 === 0);
  }

  // Kolonistenschepen die naast onbewoond land liggen, stichten daar een kolonie.
  for (const u of [...state.eenheden]) {
    if (!eenheidType(state, u.type).kolonist || u.pad.length) continue;
    const t = onbewoondBij(state, u, 1.7);
    if (t >= 0) stichtKolonie(state, u, t);
  }
  kolonieTick(state);
  aiLegerTick(state);
}

// ---------- kolonies ----------

function onbewoondBij(state, u, straal) {
  const geo = state.pack.geo;
  const hier = geo.tegels[u.t];
  let best = -1, bd = Infinity;
  for (const i of geo.onbewoond) {
    if (state.eigenaar[i] !== -2) continue;
    const t = geo.tegels[i];
    const d = Math.hypot(t.k - hier.k, t.r - hier.r);
    if (d <= straal && d < bd) { bd = d; best = i; }
  }
  return best;
}

export function stichtKolonie(state, u, t) {
  const geo = state.pack.geo;
  const c = state.landen[u.land];
  const centrum = geo.tegels[t];
  for (const i of geo.onbewoond) {
    const tg = geo.tegels[i];
    if (state.eigenaar[i] === -2 && Math.hypot(tg.k - centrum.k, tg.r - centrum.r) <= state.pack.model.kolonie_straal) claim(state, i, c.idx);
  }
  state.kolonies.push({ land: c.idx, t, dag: state.dag, naam: `Nieuw-${c.naam}` });
  state.bezet[t] = { land: c.idx, kolonie: true };
  state.eenheden = state.eenheden.filter((x) => x !== u);
  c.L += 1;
  herbereken(state, c);
  log(state, c.idx === state.speler ? 'Kolonie gesticht! Je kunt er nu bouwen; het centrum werkt als knooppunt.' : `${c.naam} sticht een overzeese kolonie.`, c.idx === state.speler ? 'goed' : 'info', true);
}

function claim(state, t, landIdx) {
  state.eigenaar[t] = landIdx;
  state.landTegels[landIdx].push(t);
  state.grensVersie += 1;
}

function kolonieTick(state) {
  const geo = state.pack.geo;
  const M = state.pack.model;
  for (const k of [...state.kolonies]) {
    const c = state.landen[k.land];
    const centrum = geo.tegels[k.t];
    // Groei: elke zoveel dagen één extra onbewoond vakje naast de kolonie.
    if ((state.dag - k.dag) % M.kolonie_groei === 0 && state.dag > k.dag) {
      let best = -1, bd = Infinity;
      for (const i of geo.onbewoond) {
        if (state.eigenaar[i] !== -2) continue;
        const t = geo.tegels[i];
        const grenst = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dk, dr]) => state.eigenaar[(t.r + dr) * geo.kol + t.k + dk] === k.land);
        const d = Math.hypot(t.k - centrum.k, t.r - centrum.r);
        if (grenst && d < bd) { bd = d; best = i; }
      }
      if (best >= 0) claim(state, best, k.land);
    }
    // Opstand: bij onrust thuis kan een kolonie zich losmaken.
    if (c.stab < 30 && nextRandom(state) < M.kolonie_opstand) {
      for (const i of geo.onbewoond) {
        if (state.eigenaar[i] !== k.land) continue;
        const b = state.bezet[i];
        if (b?.gebouw && !b.bouw) {
          const p = c.plaatsingen.findIndex((x) => x.t === i);
          if (p >= 0) { c.gebouwen[c.plaatsingen[p].g] -= 1; c.plaatsingen.splice(p, 1); }
        }
        if (b?.bouw) c.bouw = c.bouw.filter((x) => x.tegel !== i);
        state.bezet[i] = null;
        state.eigenaar[i] = -2;
        state.landTegels[k.land] = state.landTegels[k.land].filter((x) => x !== i);
      }
      state.kolonies = state.kolonies.filter((x) => x !== k);
      state.grensVersie += 1;
      herbereken(state, c);
      log(state, c.idx === state.speler ? `Opstand in ${k.naam}: de kolonie verklaart zich onafhankelijk en is verloren.` : `Een kolonie van ${c.naam} komt in opstand.`, c.idx === state.speler ? 'slecht' : 'info', true);
    }
  }
}

// ---------- AI ----------

function aiLegerTick(state) {
  if (!isOntgrendeld(state, 'leger')) return;
  for (const c of state.landen) {
    if (c.idx === state.speler || (state.dag + c.idx * 2) % 6 !== 0) continue;
    aiLegerLand(state, c);
  }
  if (state.dag % 10 === 0) aiOorlogsbeslissingen(state);
}

function aiLegerLand(state, c) {
  const P = state.pack;
  const R = P.rollen;
  const pers = P.persoonlijkheden[c.persoonlijkheid].ai || {};
  const oorlogen = oorlogenVan(state, c);
  const mult = MOEILIJKHEID[state.instellingen.moeilijkheid]?.invloed ?? 1;
  const gewenst = clamp((c.Y / 90) * (pers.leger ?? 1) * (0.6 + 0.4 * mult), 3, 24) * (oorlogen.length ? 1.6 : 1);
  const alle = state.eenheden.filter((u) => u.land === c.idx);
  const eigen = alle.filter((u) => !eenheidType(state, u.type).vaart);
  aiKolonisatie(state, c, alle, pers);

  // Productiegebouwen neerzetten
  const types = Object.values(P.eenhedenIndex).filter((e) => isOntgrendeld(state, e.id) && !e.vaart);
  if (eigen.length < gewenst) {
    for (const e of types) {
      if (c.plaatsingen.some((p) => p.g === e.gebouw) || c.bouw.some((b) => b.gebouw === e.gebouw)) continue;
      if (c.voorraad[R.geld] > (pers.reserve ?? 100) * 1.5) bouw(state, c.idx, e.gebouw);
      break;
    }
    const kandidaten = types.filter((e) => trainStatus(state, c.idx, e.id).ok);
    if (kandidaten.length && c.voorraad[R.geld] > (pers.reserve ?? 100) * (oorlogen.length ? 0.3 : 1)) {
      const keuze = kandidaten[Math.floor(nextRandom(state) * kandidaten.length)];
      train(state, c.idx, keuze.id);
    }
  }

  const vrij = eigen.filter((u) => !u.pad.length && !u.vecht);
  if (!vrij.length) return;
  const geo = P.geo;
  const h = geo.tegels[geo.hoofdstad[c.idx]];
  if (oorlogen.length) {
    // Indringers in eigen gebied eerst, anders het dichtstbijzijnde vijandelijke vakje.
    const p = partij(state, c);
    const indringer = state.eenheden.find((v) => inOorlog(state, c, state.landen[v.land]) && state.eigenaar[v.t] >= 0 && partij(state, state.landen[state.eigenaar[v.t]]) === p);
    let doel = indringer ? indringer.t : -1;
    if (doel < 0 && (pers.druk ?? 0.1) > 0.04 && sterkte(state, c.idx) > 0) {
      let bd = Infinity;
      for (const o of state.landen) {
        if (!inOorlog(state, c, o)) continue;
        for (const t of state.landTegels[o.idx]) {
          const tg = geo.tegels[t];
          const d = (tg.x - h.x) ** 2 + (tg.y - h.y) ** 2 + (t === geo.hoofdstad[o.idx] ? -2000 : 0);
          if (d < bd) { bd = d; doel = t; }
        }
      }
    }
    if (doel >= 0 && (indringer || vrij.length >= 3 || state.dag % 30 === 0)) beweegEenheden(state, c.idx, vrij.map((u) => u.id), doel);
  } else {
    // In vrede: verzamelen bij de hoofdstad.
    const ver = vrij.filter((u) => Math.hypot(u.x - h.x, u.y - h.y) / geo.T > 4);
    if (ver.length) beweegEenheden(state, c.idx, ver.map((u) => u.id), geo.hoofdstad[c.idx]);
  }
}

// Water naast een onbewoond vakje dat een schip vanaf 'van' echt kan bereiken (zelfde zoektocht als beweegEenheden).
function eilandBereikbaar(state, landIdx, van, eiland, type) {
  const geo = state.pack.geo;
  const doel = geo.tegels[eiland];
  const kandidaten = geo.tegels.filter((t) => state.eigenaar[t.i] === -1 && Math.hypot(t.k - doel.k, t.r - doel.r) <= 3)
    .sort((a, b) => Math.hypot(a.k - doel.k, a.r - doel.r) - Math.hypot(b.k - doel.k, b.r - doel.r) || a.i - b.i);
  for (const k of kandidaten.slice(0, 6)) if (zoekPad(state, landIdx, van, k.i, type)) return true;
  return false;
}

// De AI bouwt hooguit één haven, op een kust waar ze ook echt een vrij eiland vandaan kan bereiken.
function aiHavenBouwen(state, c, kolonist, pers) {
  const M = state.pack.model;
  const geo = state.pack.geo;
  const havenId = kolonist.gebouw;
  if (state.dag < M.ai_kolonie_start) return;
  if (c.plaatsingen.some((p) => p.g === havenId) || c.bouw.some((b) => b.gebouw === havenId)) return;
  if (c.voorraad[state.pack.rollen.geld] < (pers.reserve ?? 100) * 3 || nextRandom(state) >= 0.15) return;
  const vrij = geo.onbewoond.filter((i) => state.eigenaar[i] === -2);
  const afstand = (t) => Math.min(...vrij.map((i) => Math.hypot(geo.tegels[i].k - geo.tegels[t].k, geo.tegels[i].r - geo.tegels[t].r)));
  const kust = state.landTegels[c.idx].filter((t) => geo.tegels[t].terrein === 'kust' && !state.bezet[t])
    .map((t) => [t, afstand(t)]).sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, 6);
  for (const [t] of kust) {
    if (!vrij.some((i) => eilandBereikbaar(state, c.idx, t, i, kolonist))) continue;
    if (bouw(state, c.idx, havenId, t).ok) return;
  }
}

function aiKolonisatie(state, c, alle, pers) {
  const kolonist = Object.values(state.pack.eenhedenIndex).find((e) => e.kolonist);
  if (!kolonist || !state.pack.geo.onbewoond.some((i) => state.eigenaar[i] === -2)) return;
  if (state.kolonies.filter((k) => k.land === c.idx).length >= state.pack.model.ai_max_kolonies) return;
  aiHavenBouwen(state, c, kolonist, pers);
  const schepen = alle.filter((u) => u.type === kolonist.id);
  for (const u of schepen) {
    if (u.pad.length) continue;
    // Dichtstbijzijnd onbewoond land dat het schip kan bereiken.
    const geo = state.pack.geo;
    const hier = geo.tegels[u.t];
    const doelen = geo.onbewoond.filter((i) => state.eigenaar[i] === -2)
      .sort((a, b) => Math.hypot(geo.tegels[a].k - hier.k, geo.tegels[a].r - hier.r) - Math.hypot(geo.tegels[b].k - hier.k, geo.tegels[b].r - hier.r) || a - b);
    for (const d of doelen.slice(0, 4)) {
      if (beweegEenheden(state, c.idx, [u.id], d).ok) break;
    }
  }
  if (!schepen.length && !c.training.some((x) => x.type === kolonist.id) && c.voorraad[state.pack.rollen.geld] > (pers.reserve ?? 100) * 2 && nextRandom(state) < 0.06) {
    if (trainStatus(state, c.idx, kolonist.id).ok) train(state, c.idx, kolonist.id);
  }
}

export function buurlanden(state, c) {
  if (c.landBuren) return c.landBuren;
  const geo = state.pack.geo;
  const set = new Set();
  for (const t of geo.landTegels[c.idx]) {
    for (const [n] of buurTegels(geo, t)) {
      const e = geo.tegels[n].eig;
      if (e >= 0 && e !== c.idx) set.add(e);
    }
  }
  for (const [a, b] of state.pack.kaart.handelsroutes) {
    if (a === c.id) set.add(geo.idxVan[b]);
    if (b === c.id) set.add(geo.idxVan[a]);
  }
  c.landBuren = [...set].filter((x) => x != null).sort((x, y) => x - y);
  return c.landBuren;
}

export function aiOorlogsbeslissingen(state) {
  const P = state.pack;
  // Vrede: lange of verloren oorlogen tussen AI-partijen eindigen vanzelf; tegen de speler komt een aanbod.
  for (const o of [...state.oorlogen]) {
    const duur = state.dag - o.start;
    const sa = partijSterkte(state, o.a), sb = partijSterkte(state, o.b);
    const spelerErin = [o.a, o.b].includes(partij(state, state.landen[state.speler]));
    const leiderVan = (p) => (p.startsWith('land:') ? state.landen[+p.slice(5)] : state.landen[blokVan(state, p).leider]);
    const demoralisatie = [o.a, o.b].some((p) => (leiderVan(p)?.moraal ?? 50) < 25);
    const verliezend = (Math.min(sa, sb) < Math.max(sa, sb) * 0.4 && duur > 60) || (demoralisatie && duur > 40);
    if (!spelerErin && (duur > 220 || verliezend)) beeindig(state, o);
    else if (spelerErin && !o.vredesaanbod && (duur > 200 || verliezend)) {
      o.vredesaanbod = true;
      const ander = o.a === partij(state, state.landen[state.speler]) ? o.b : o.a;
      log(state, `${partijNaam(state, ander)} biedt vrede aan. Je vindt het aanbod in het tabblad Leger.`, 'info', true);
    }
  }

  if (!isOntgrendeld(state, 'escalatie') || !state.instellingen.systemen.escalatie) return;
  const oorlogActie = P.acties.escalatie.find((e) => e.type === 'oorlog' && e.beschikbaar !== false);
  if (!oorlogActie) return;
  for (const b of state.blokken) {
    if (b.id === state.spelerBlok || b.leider < 0) continue;
    const leider = state.landen[b.leider];
    const pers = P.persoonlijkheden[leider.persoonlijkheid].ai || {};
    if (oorlogenVan(state, leider).length || (pers.druk ?? 0.1) < 0.2 || b.spanning < 20 || leider.moraal < 45) continue;
    const eigen = partijSterkte(state, b.id);
    // Overmacht telt zwaarder naarmate de spanning oploopt: bij de hoogste spanning volstaat 1,3 keer zoveel als de buur.
    const spelerPartij = partij(state, state.landen[state.speler]);
    const M = P.model;
    const drempel = M.ai_oorlog_drempel - M.ai_oorlog_korting * Math.min(1, b.spanning / 60);
    // Doelen zijn alle buren van het hele blok, niet alleen van de leider (zo komt ook de speler in beeld).
    const buren = new Set();
    for (const m of state.landen) if (partij(state, m) === b.id) for (const n of buurlanden(state, m)) buren.add(n);
    // Ook een rivaal zonder gemeenschappelijke grens kan de oorlog krijgen (zeeoorlog), maar alleen bij oplopende spanning.
    if (b.spanning >= M.ai_oorlog_ver) {
      for (const t of state.landen) if (t.idx === state.speler || t.alignment === state.spelerBlok) buren.add(t.idx);
    }
    let doel = null;
    let best = 0;
    for (const n of [...buren].sort((x, y) => x - y)) {
      const t = state.landen[n];
      if (partij(state, t) === b.id) continue;
      const hun = partijSterkte(state, partij(state, t)) + 5;
      const verhouding = eigen / hun;
      // De speler en zijn blok zijn de rivaal van de AI-blokken: bij overmacht gaat de oorlog daarheen.
      const rivaal = partij(state, t) === spelerPartij;
      const score = verhouding * (rivaal ? 100 : 1) * (t.Y + 50);
      if (verhouding >= drempel && score > best) { best = score; doel = t; }
    }
    // Moeilijkheid schaalt de kans alleen als het doel de speler of zijn blok is (Makkelijk: zelden).
    const oorlogFactor = partij(state, doel ?? leider) === spelerPartij ? (MOEILIJKHEID[state.instellingen.moeilijkheid]?.oorlog ?? 1) : 1;
    if (!doel || nextRandom(state) > M.ai_oorlog_kans * oorlogFactor) continue;
    const st = escalatieStatus(state, leider.idx, doel.idx, oorlogActie);
    if (st.ok && !((state.wapenstilstand[[b.id, partij(state, doel)].sort().join('|')] ?? -1) > state.dag)) verklaarOorlog(state, leider.idx, doel.idx, oorlogActie, st);
  }
}
