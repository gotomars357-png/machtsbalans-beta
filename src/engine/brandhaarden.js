// Brandhaarden (C13): crises op een plek op de kaart die groeien terwijl je iets anders doet.
// Een haard heeft een aftelling in speeldagen en twee of drie aanpakken. Haal je de druk naar nul, dan is hij opgelost;
// bereikt hij 100 of de deadline, dan barst hij uit. Dat kost iets, maar is nooit game over. Ook AI-landen krijgen ze.
// Alles komt uit packs/<pack>/events/brandhaarden.json; aan of uit met instellingen.systemen.brandhaarden.
// Deterministisch: landen op index, soorten in pack-volgorde, en nextRandom pas als alle vaste voorwaarden kloppen.

import { nextRandom } from './rng.js';
import { log, kanBetalen, betaal, herbereken } from './sim.js';
import { applyEffect } from './events.js';
import { oorlogenVan } from './leger.js';

const sleutel = (land, soort) => `${land}|${soort}`;

export function brandhaardSoort(state, id) {
  return (state.pack.brandhaarden || []).find((x) => x.id === id) ?? null;
}

export function brandhaardenVan(state, landIdx) {
  return (state.brandhaarden || []).filter((h) => h.land === landIdx);
}

export function brandhaardOp(state, t) {
  return (state.brandhaarden || []).find((h) => h.tegel === t) ?? null;
}

// Resterende speeldagen tot de uitbarsting.
export function dagenOver(state, h) {
  return Math.max(0, h.deadline - state.dag);
}

// Hoeveel trappen de huidige druk al raakt (0 = nog onder de eerste trap). Voor de kleur van de ring.
export function drukTrap(soort, druk) {
  let n = 0;
  for (const t of soort?.trappen || []) if (druk >= t.vanaf) n += 1;
  return n;
}

// De groei per dag zoals hij nu is: complotdenken versnelt, weerbaarheid remt (hooguit 60%).
export function groeiPerDag(state, h) {
  const soort = brandhaardSoort(state, h.soort);
  const c = state.landen[h.land];
  if (!soort || !c) return 0;
  return soort.groei_per_dag * (1 + c.complot / 100) * (1 - Math.min(0.6, Math.max(0, c.weerbaarheid) / 100));
}

// Het ankergebouw van een haard (de plaatsing op zijn tegel), of null bij de hoofdstad.
function ankerPlaatsing(c, h) {
  for (let i = 0; i < c.plaatsingen.length; i++) if (c.plaatsingen[i].t === h.tegel) return c.plaatsingen[i];
  return null;
}

// Legt het ankergebouw stil zoals een cyberaanval: cyberTick zet het daarna vanzelf weer aan.
function legAnkerStil(state, c, h, dagen) {
  if (!(dagen > 0)) return false;
  const p = ankerPlaatsing(c, h);
  if (!p) return false;
  p.uit = Math.max(p.uit ?? 0, state.dag + dagen);
  c.uitvalTot = Math.max(c.uitvalTot ?? 0, p.uit);
  herbereken(state, c);
  return true;
}

// Staat het anker er nog (niet veroverd of gesloopt)?
function ankerBestaat(state, h) {
  const b = state.bezet[h.tegel];
  return !!b && b.land === h.land && !b.bouw;
}

export function ankerNaam(state, h) {
  const soort = brandhaardSoort(state, h.soort);
  if (!soort || soort.anker === 'hoofdstad') return 'de hoofdstad';
  return (state.pack.gebouwIndex[soort.anker]?.naam ?? soort.anker).toLowerCase();
}

// Lopende vertraagde aanpakken van een haard (voor paneel en ring): [{dag, druk, actie}], eerst de vroegste.
export function lopendeAanpak(h) {
  return h?.wacht?.length ? h.wacht : [];
}

// ---------- orders ----------

export function brandhaardStatus(state, landIdx, id, actieId) {
  const h = (state.brandhaarden || []).find((x) => x.id === id);
  if (!h) return { ok: false, reden: 'Deze brandhaard is al voorbij.' };
  if (h.land !== landIdx) return { ok: false, reden: 'Deze brandhaard is van een ander land.' };
  const soort = brandhaardSoort(state, h.soort);
  const a = soort?.acties?.find((x) => x.id === actieId);
  if (!a) return { ok: false, reden: 'Onbekende aanpak.' };
  if (h.gebruikt.includes(a.id)) return { ok: false, reden: 'Dit heb je al gedaan.' };
  const c = state.landen[landIdx];
  if (a.vereist_gebouw && !((c.gebouwen[a.vereist_gebouw] || 0) > 0)) {
    return { ok: false, reden: `Vraagt een ${(state.pack.gebouwIndex[a.vereist_gebouw]?.naam ?? a.vereist_gebouw).toLowerCase()}.` };
  }
  if (!kanBetalen(c, a.kosten || {})) return { ok: false, reden: 'Onvoldoende middelen.' };
  return { ok: true };
}

export function voerBrandhaardActieUit(state, landIdx, id, actieId) {
  const st = brandhaardStatus(state, landIdx, id, actieId);
  if (!st.ok) return st;
  const i = state.brandhaarden.findIndex((x) => x.id === id);
  const h = state.brandhaarden[i];
  const soort = brandhaardSoort(state, h.soort);
  const a = soort.acties.find((x) => x.id === actieId);
  const c = state.landen[landIdx];
  betaal(c, a.kosten || {});
  // Een aanpak met vertraging (praten, C14): je betaalt nu en het overige effect gaat meteen in, maar de druk zakt pas op
  // de effectdag. Wie vroeg begint, is er vóór de eerste trap; wie laat begint, niet.
  const v = a.vertraging_dagen ?? 0;
  if (v > 0) (h.wacht ??= []).push({ dag: state.dag + v, druk: a.druk ?? 0, actie: a.id });
  else h.druk += a.druk ?? 0;
  applyEffect(state, c, a.effect || {});
  h.gebruikt.push(a.id);
  if (landIdx === state.speler) log(state, `${soort.naam}: ${a.naam.toLowerCase()}.`, 'info');
  if (h.druk <= 0) losOp(state, i);
  return { ok: true };
}

// De goedkoopste aanpak (in geld, bij gelijkspel de eerste in het pack). Met alleenUitvoerbaar alleen wat nu kan,
// met opties.direct alleen aanpakken zonder vertraging.
export function goedkoopsteActie(state, h, alleenUitvoerbaar = true, opties = {}) {
  const soort = brandhaardSoort(state, h.soort);
  const geld = state.pack.rollen.geld;
  let best = null;
  for (const a of soort?.acties || []) {
    if (h.gebruikt.includes(a.id)) continue;
    if (opties.direct && (a.vertraging_dagen ?? 0) > 0) continue;
    if (alleenUitvoerbaar && !brandhaardStatus(state, h.land, h.id, a.id).ok) continue;
    if (!best || (a.kosten?.[geld] ?? 0) < (best.kosten?.[geld] ?? 0)) best = a;
  }
  return best;
}

// ---------- afloop ----------

function losOp(state, i) {
  const [h] = state.brandhaarden.splice(i, 1);
  const soort = brandhaardSoort(state, h.soort);
  const c = state.landen[h.land];
  applyEffect(state, c, soort.opgelost?.effect || {});
  state.brandhaardLaatst[sleutel(h.land, '*')] = state.dag;
  if (h.land === state.speler) log(state, `Opgelost: ${soort.naam.toLowerCase()}.`, 'goed', true);
}

function barstUit(state, i) {
  const [h] = state.brandhaarden.splice(i, 1);
  const soort = brandhaardSoort(state, h.soort);
  const c = state.landen[h.land];
  const u = soort.uitbarsting || {};
  applyEffect(state, c, u.effect || {});
  legAnkerStil(state, c, h, u.gebouw_uit_dagen);
  const eigen = h.land === state.speler;
  if (eigen && u.event && state.instellingen.systemen.events && state.pack.events.some((e) => e.id === u.event)) state.eventKeten.push({ id: u.event, dag: state.dag + 1, land: c.idx });
  state.brandhaardLaatst[sleutel(h.land, '*')] = state.dag;
  log(state, eigen ? `Uitgebarsten: ${soort.naam.toLowerCase()}. ${u.tekst ?? ''}`.trim() : `Onrust bij ${c.naam}: ${soort.naam.toLowerCase()}.`, eigen ? 'slecht' : 'info', eigen);
}

// ---------- de dag ----------

export function brandhaardenTick(state) {
  const lijst = state.brandhaarden;
  const P = state.pack;
  const M = P.model;

  // 1. Bestaande haarden groeien, raken trappen, barsten uit of zijn opgelost.
  for (let i = 0; i < lijst.length;) {
    const h = lijst[i];
    const soort = brandhaardSoort(state, h.soort);
    const c = state.landen[h.land];
    if (!soort || !c || !ankerBestaat(state, h)) { lijst.splice(i, 1); continue; } // anker veroverd of weg: de haard dooft
    // Vertraagde aanpakken die vandaag (of eerder) ingaan, op index in volgorde van aanpak.
    if (h.wacht?.length) {
      for (let w = 0; w < h.wacht.length;) {
        if (h.wacht[w].dag <= state.dag) { h.druk += h.wacht[w].druk; h.wacht.splice(w, 1); } else w++;
      }
    }
    if (h.druk <= 0) { losOp(state, i); continue; }
    h.druk += groeiPerDag(state, h);
    const trappen = soort.trappen || [];
    while (h.trap < trappen.length && h.druk >= trappen[h.trap].vanaf) {
      const t = trappen[h.trap];
      applyEffect(state, c, t.effect || {});
      legAnkerStil(state, c, h, t.gebouw_uit_dagen);
      // Loopt er al overleg, dan is een hogere trap geen nieuw alarm: de speler heeft al gekozen.
      if (h.land === state.speler && t.tekst) log(state, `${soort.naam}: ${t.tekst}`, h.wacht?.length ? 'info' : 'slecht', true);
      h.trap += 1;
    }
    if (h.druk >= 100 || state.dag >= h.deadline) { barstUit(state, i); continue; }
    i++;
  }

  // 2. AI-landen pakken een haard aan zodra hij oploopt en er geld boven de reserve is. Geen toeval.
  for (let i = 0; i < lijst.length;) {
    const h = lijst[i];
    const c = state.landen[h.land];
    if (h.land !== state.speler && h.druk >= M.brandhaard_ai_drempel && !h.wacht?.length) { // loopt er overleg, dan wacht hij
      const reserve = P.persoonlijkheden[c.persoonlijkheid]?.ai?.reserve ?? 100;
      const geld = c.voorraad[P.rollen.geld];
      // Op de AI-drempel is praten te laat: eerst een aanpak die meteen werkt, als het geld daarna boven de reserve blijft.
      const d = goedkoopsteActie(state, h, true, { direct: true });
      const a = d && geld > reserve + (d.kosten?.[P.rollen.geld] ?? 0) ? d : geld > reserve ? goedkoopsteActie(state, h) : null;
      if (a) {
        voerBrandhaardActieUit(state, c.idx, h.id, a.id);
        if (lijst[i] !== h) continue; // opgelost en verwijderd
      }
    }
    i++;
  }

  // 3. Nieuwe haarden: per land en per soort, eerst de vaste voorwaarden, dan pas het toeval.
  const soorten = P.brandhaarden || [];
  if (!soorten.length) return;
  for (let li = 0; li < state.landen.length; li++) {
    const c = state.landen[li];
    let actief = 0;
    for (let i = 0; i < lijst.length; i++) if (lijst[i].land === li) actief += 1;
    if (actief >= M.brandhaard_max_per_land) continue;
    const speler = li === state.speler;
    if (speler && (state.pendingEvent || state.dag - laatsteEvent(state) <= 3)) continue;
    const stil = speler ? stilteFactor(state, c, actief) : 1;
    for (let si = 0; si < soorten.length; si++) {
      const soort = soorten[si];
      if (state.dag - (state.brandhaardLaatst[sleutel(li, soort.id)] ?? -Infinity) < M.brandhaard_afkoeling) continue;
      const plekken = ankerPlekken(state, c, soort);
      if (!plekken.length || !voorwaardeKlopt(state, c, soort.voorwaarde || {})) continue;
      // Een soort zonder kans (0 of niet ingevuld) ontstaat nooit, ook niet na een lange stilte (0 × Infinity is NaN).
      const kans = soort.voorwaarde?.kans_per_dag ?? 0;
      if (nextRandom(state) >= (kans > 0 ? kans * stil : 0)) continue;
      const tegel = plekken.length > 1 ? plekken[Math.min(plekken.length - 1, Math.floor(nextRandom(state) * plekken.length))] : plekken[0];
      nieuw(state, li, soort, tegel);
      break; // hooguit één nieuwe haard per land per dag
    }
  }
}

function nieuw(state, landIdx, soort, tegel) {
  const h = { id: state.volgendeBrandhaardId++, soort: soort.id, land: landIdx, tegel, start: state.dag, druk: 10, trap: 0, deadline: state.dag + soort.deadline_dagen, gebruikt: [] };
  state.brandhaarden.push(h);
  state.brandhaardLaatst[sleutel(landIdx, soort.id)] = state.dag;
  if (landIdx === state.speler) log(state, `Brandhaard: ${soort.naam.toLowerCase()} (nog ${soort.deadline_dagen} dagen).`, 'slecht', true);
  return h;
}

// Plekken waar deze soort kan ontstaan: geplaatste, werkende gebouwen van het anker zonder lopende haard, of de hoofdstad.
function ankerPlekken(state, c, soort) {
  const vrij = (t) => !state.brandhaarden.some((h) => h.tegel === t);
  if (soort.anker === 'hoofdstad') {
    const t = state.pack.geo.hoofdstad[c.idx];
    return t >= 0 && state.bezet[t]?.land === c.idx && vrij(t) ? [t] : [];
  }
  const uit = [];
  for (let i = 0; i < c.plaatsingen.length; i++) {
    const p = c.plaatsingen[i];
    if (p.g !== soort.anker || p.t < 0 || (p.uit ?? 0) > state.dag || state.bezet[p.t]?.land !== c.idx || !vrij(p.t)) continue;
    uit.push(p.t);
  }
  return uit;
}

function voorwaardeKlopt(state, c, v) {
  if (v.na_dag != null && state.dag < v.na_dag) return false;
  if (v.voor_dag != null && state.dag > v.voor_dag) return false;
  if (v.stabiliteit_onder != null && c.stab >= v.stabiliteit_onder) return false;
  if (v.stabiliteit_boven != null && c.stab <= v.stabiliteit_boven) return false;
  if (v.complot_boven != null && c.complot <= v.complot_boven) return false;
  if (v.in_oorlog != null && (oorlogenVan(state, c).length > 0) !== v.in_oorlog) return false;
  if (v.resource) {
    const w = v.resource === state.pack.rollen.stabiliteit ? c.stab : c.voorraad[v.resource] ?? 0;
    if (v.onder != null && w >= v.onder) return false;
    if (v.boven != null && w <= v.boven) return false;
  }
  return true;
}

function laatsteEvent(state) {
  let m = -Infinity;
  for (const st of Object.values(state.eventStatus)) if (st.laatst > m) m = st.laatst;
  return m;
}

// Stille stukken vullen: is er bij de speler lang niets gebeurd (geen haard, gebeurtenis of oorlog), dan loopt de kans
// na brandhaard_stilte dagen snel op, en na anderhalf keer zo lang komt er zeker een (de eerste soort die kan).
function stilteFactor(state, c, actief) {
  const S = state.pack.model.brandhaard_stilte;
  if (!(S > 0) || actief > 0 || oorlogenVan(state, c).length) return 1;
  const laatst = Math.max(laatsteEvent(state), state.brandhaardLaatst[sleutel(c.idx, '*')] ?? 0);
  const stil = state.dag - laatst;
  if (stil >= S * 1.5) return Infinity;
  return stil > S ? 1 + (stil - S) / 5 : 1;
}

// ---------- alleen voor tests en foto's ----------

export function maakBrandhaard(state, landIdx, soortId, tegel) {
  const soort = brandhaardSoort(state, soortId);
  if (!soort) return null;
  const c = state.landen[landIdx];
  const t = tegel ?? ankerPlekken(state, c, soort)[0];
  if (t == null) return null;
  return nieuw(state, landIdx, soort, t);
}

export function brandhaardenAfdruk(state) {
  const l = state.brandhaarden;
  return l?.length ? `#bh${l.map((h) => `${h.id}@${h.druk.toFixed(2)}${h.wacht?.length ? `w${h.wacht.map((w) => w.dag).join('.')}` : ''}`).join(',')}` : '';
}
