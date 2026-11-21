// C16d: leren van spelers. Een lokaal speelverslag, een kort pulskaartje, een afhaakvraag en een deelknop.
//
// Privacy (afspraak bij c16d):
// - Bijhouden staat standaard UIT. Bij de eerste start vraagt het startscherm het één keer ("Ja, bijhouden" / "Nee").
// - Alles blijft in localStorage op dit apparaat. Deze module doet geen fetch, geen beacon en geen ander verzoek.
//   Delen gebeurt alleen als de speler op "Deel mijn speelverslag" tikt en eerst de samenvatting heeft gezien.
// - Geen vrije tekst, geen coördinaten, geen schermmaten, geen user agent, geen apparaat-ID. In de kop staat alleen
//   apparaat: { smal, aanraak }. Getypte antwoorden van het eindscherm gaan alleen mee als het vinkje aan staat.
//
// Twee lagen:
// - maakLeerboek({ opslag, klok, dag, test }): het logboek zelf, zonder DOM (draait in node, zie tools/leertest.mjs).
//   Het leest de speltoestand (uitkomst, fase, tekorten via evenwicht.toestand) en schrijft er nooit in.
// - De browserlaag onderaan: luistert naar 'order', 'bouwfeedback' en 'bouwlade' op window (van c16b/c16c), naar invoer
//   en zichtbaarheid, en tekent het pulskaartje (#puls), het afhaakkaartje en het startschermblok (#leer-start).
//   main.js roept alleen haakjes van één regel aan: potje, tempo, tab, modal, afhaak, menuHtml/bindMenu en tut.
// De klok is Date.now (echte tijd, los van de tekenklok van de kaart); de engine ziet hier niets van.

import { ENGINE_VERSION } from '../engine/defaults.js';
import { toestand as evenwichtToestand } from './evenwicht.js';
import { plekInBeeld } from './bouwfeedback.js';
import * as onderpaneel from './onderpaneel.js';

// ---------- regels: drempels, chipteksten en sleutels op één plek ----------

export const LEER_REGELS = {
  sleutelLog: 'machtsbalans.leerlog',
  sleutelKeuze: 'machtsbalans.leren',
  sleutelSpeltest: 'machtsbalans.speltest',
  maxSessies: 3,
  maxRegels: 1500,
  maxTekens: 195000,      // samen onder 200 kB
  stil: 45,               // s zonder invoer bij een zichtbaar tabblad
  weigerVenster: 30,      // dezelfde weigering binnen zo veel s: weiger2
  zoekVenster: 20,        // zo veel tabwissels in zo veel s zonder order: zoek
  zoekTabs: 3,
  tekortRust: 30,         // tekort hooguit elke 30 s
  beleidRust: 2,          // een schuifregelaar geeft veel orders: één regel per 2 s
  pulsEerste: 600,        // eerste pulskaartje na 10 minuten speeltijd (of bij de eerste fasewissel)
  pulsTussen: 480,        // minstens 8 minuten tussen twee kaartjes
  pulsMax: 3,             // hooguit 3 keer per sessie
  pulsStopNaWeg: 2,       // na 2 keer wegklikken niet meer
  pulsDuur: 20,           // verdwijnt vanzelf na 20 s
  schrijfElke: 10,        // s tussen twee keer wegschrijven
  gezichten: [
    { id: 'blij', teken: '🙂', label: 'Goed' },
    { id: 'gaat', teken: '😐', label: 'Gaat wel' },
    { id: 'balen', teken: '🙁', label: 'Niet leuk' },
  ],
  chips: [
    { id: 'bouwen', tekst: 'Ik weet niet wat ik moet bouwen' },
    { id: 'traag', tekst: 'Te traag' },
    { id: 'druk', tekst: 'Te druk' },
    { id: 'leuk', tekst: 'Leuk zo' },
  ],
  stopRedenen: [
    { id: 'tijd', tekst: 'Tijd op' },
    { id: 'verveeld', tekst: 'Verveeld' },
    { id: 'snap', tekst: 'Snap het niet' },
    { id: 'klaar', tekst: 'Klaar voor nu' },
    { id: 'over', tekst: 'Overslaan' },
  ],
};

// ?leertest=1: alle wachttijden op 5 s, zodat kijk.mjs --leren alles in een minuut ziet.
const TEST_REGELS = { stil: 5, pulsEerste: 5, pulsTussen: 5, pulsDuur: 5 };
export const regelsVoor = (test) => (test ? { ...LEER_REGELS, ...TEST_REGELS } : LEER_REGELS);

// ---------- het formaat ----------
// Opslag (compact): { versie: 1, sessies: [ { kop, r: [redenen], g: [[t, d, s, ...waarden]] } ] }.
// Uitgepakt (leesLeerlog, deelbestand): { versie: 1, sessies: [ { kop, regels: [ { t, d, s, ... } ] } ] }.
// t = seconden sinds de start van de sessie, d = speldag, s = soort. De velden per soort staan hieronder.

export const SOORTEN = ['start', 'einde', 'weg', 'terug', 'order', 'weiger2', 'tempo', 'stil', 'tab', 'zoek', 'plaats', 'plaatsKlaar',
  'plaatsStop', 'lade', 'auto', 'tekort', 'eerste', 'tut', 'puls', 'pulsWeg', 'stopReden'];
const VELDEN = {
  start: ['geladen'], einde: ['wint'], weg: [], terug: [],
  order: ['o', 'ok', 'r', 'g', 'plek'], weiger2: ['o', 'r'],
  tempo: ['v'], stil: ['modus', 'v'], tab: ['tab'], zoek: [],
  plaats: ['g'], plaatsKlaar: ['g'], plaatsStop: ['g'], lade: ['stap', 'g', 'kib'], auto: ['g', 'kib'],
  tekort: ['rood', 'oranje'], eerste: ['wat'], tut: ['stap'],
  puls: ['gezicht', 'chip'], pulsWeg: ['hoe'], stopReden: ['reden', 'achteraf'],
};
const WAAR = new Set(['geladen', 'wint', 'ok', 'plek', 'kib', 'achteraf']);
const ESSENTIEEL = new Set(['start', 'einde', 'stopReden', 'puls', 'pulsWeg']);

// Een weigerreden zonder getallen: groeperen kan dan, en er lekt geen bedrag of nummer mee.
export const normaalReden = (r) => String(r ?? '').replace(/\d+([.,]\d+)?/g, '#').slice(0, 120);

function inpakken(sessie, t, d, soort, velden) {
  const v = VELDEN[soort];
  const a = [t, d, soort];
  if (!v) {
    if (velden && Object.keys(velden).length) a.push(velden);
    return a;
  }
  for (let i = 0; i < v.length; i++) {
    const k = v[i];
    let x = velden?.[k];
    if (x === undefined || x === null) { a.push(null); continue; }
    if (WAAR.has(k)) x = x ? 1 : 0;
    else if (k === 'r') {
      const tekst = normaalReden(x);
      let j = sessie.r.indexOf(tekst);
      if (j < 0) { j = sessie.r.length; sessie.r.push(tekst); }
      x = j;
    }
    a.push(x);
  }
  while (a.length > 3 && a[a.length - 1] === null) a.pop();
  return a;
}

function uitpakken(sessie) {
  const uit = [];
  for (let n = 0; n < sessie.g.length; n++) {
    const a = sessie.g[n];
    const r = { t: a[0], d: a[1], s: a[2] };
    const v = VELDEN[a[2]];
    if (!v) { if (a[3] && typeof a[3] === 'object') Object.assign(r, a[3]); uit.push(r); continue; }
    for (let i = 0; i < v.length; i++) {
      let x = a[3 + i];
      if (x === undefined || x === null) continue;
      const k = v[i];
      if (WAAR.has(k)) x = !!x;
      else if (k === 'r') x = sessie.r[x] ?? null;
      r[k] = x;
    }
    uit.push(r);
  }
  return uit;
}

// ---------- pulsregels (puur, getest in leertest) ----------

// p: { getoond, weg, speeltijd, laatst, faseGewisseld }; env: { modal, bouwModus, lade, tutorial, ander, uitkomst, actief }.
export function magPuls(p, env, R = LEER_REGELS) {
  if (!env.actief || env.modal || env.bouwModus || env.lade || env.tutorial || env.ander || env.uitkomst) return false;
  if (p.getoond >= R.pulsMax || p.weg >= R.pulsStopNaWeg) return false;
  if (p.getoond === 0) return p.speeltijd >= R.pulsEerste || !!p.faseGewisseld;
  return p.speeltijd - p.laatst >= R.pulsTussen;
}

// ---------- het logboek (zonder DOM) ----------

function standaardOpslag() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function maakLeerboek({ opslag = standaardOpslag(), klok = () => Date.now() / 1000, dag = () => 0, test = false } = {}) {
  const R = regelsVoor(test);
  const lees = (k) => { try { return opslag?.getItem(k) ?? null; } catch { return null; } };
  const zet = (k, v) => { try { opslag?.setItem(k, v); return true; } catch { return false; } };
  const weg = (k) => { try { opslag?.removeItem(k); } catch { /* niets */ } };

  let keuze = lees(R.sleutelKeuze); // 'ja' | 'nee' | null (nog niet gevraagd)
  let data = null;
  let sessie = null;
  let t0 = 0;
  let vuil = false;
  let laatsteSchrijf = 0;
  let p = nieuwPotje();

  function nieuwPotje() {
    return {
      tempo: 0, tab: 'economie', invoer: klok(), stilGemeld: false, vorigeTick: null, speeltijd: 0,
      fase: null, faseGewisseld: false, einde: false, eersteOrder: false, eersteBouw: false,
      weiger: {}, tabs: [], plaats: null, laatsteOrder: null, laatsteOrderT: -1e9, beleidT: -1e9,
      tekortSig: '|', tekortT: -1e9, getoond: 0, wegGeklikt: 0, laatst: 0, afhaakGevraagd: false, verborgen: false,
    };
  }

  function laad() {
    if (data) return data;
    try { data = JSON.parse(lees(R.sleutelLog) ?? 'null'); } catch { data = null; }
    if (!data || data.versie !== 1 || !Array.isArray(data.sessies)) data = { versie: 1, sessies: [] };
    return data;
  }

  function schrijf() {
    if (!data) return;
    let json = JSON.stringify(data);
    // Ringbuffer: past het niet, dan eerst de oudste sessie inkorten (de kopregel blijft), dan weg.
    while (json.length > R.maxTekens && data.sessies.length) {
      const oud = data.sessies[0];
      if (oud.g.length > 8) oud.g.splice(1, Math.ceil(oud.g.length / 4));
      else if (oud !== sessie) data.sessies.shift();
      else break;
      json = JSON.stringify(data);
    }
    zet(R.sleutelLog, json);
    vuil = false;
    laatsteSchrijf = klok();
  }

  function log(soort, velden = {}) {
    if (!sessie) return false;
    const nu = klok();
    if (sessie.g.length >= R.maxRegels) {
      // Vol: de oudste gewone regel valt weg, de start en de oordelen blijven.
      let i = 1;
      while (i < sessie.g.length && ESSENTIEEL.has(sessie.g[i][2])) i++;
      if (i < sessie.g.length) sessie.g.splice(i, 1); else if (!ESSENTIEEL.has(soort)) return false;
    }
    sessie.g.push(inpakken(sessie, Math.round(nu - t0), dag() ?? 0, soort, velden));
    vuil = true;
    if (ESSENTIEEL.has(soort) && soort !== 'start') schrijf();
    return true;
  }

  const boek = {
    R,
    keuze: () => keuze,
    aan: () => keuze === 'ja',
    actief: () => !!sessie,
    zetKeuze(ja) {
      keuze = ja ? 'ja' : 'nee';
      zet(R.sleutelKeuze, keuze);
      if (!ja) boek.wis();
    },

    // Een nieuw potje: nieuwe sessie met kop (alleen als bijhouden aan staat, en niet bij een replay).
    potje(state, { geladen = false, replay = false, apparaat = { smal: false, aanraak: false }, midden = false } = {}) {
      if (sessie && vuil) schrijf();
      sessie = null;
      p = nieuwPotje();
      if (keuze !== 'ja' || replay || !state) return false;
      laad();
      const kop = {
        versie: ENGINE_VERSION, pack: state.pack?.meta?.id ?? null, seed: state.instellingen?.seed ?? null,
        moeilijkheid: state.instellingen?.moeilijkheid ?? null,
        apparaat: { smal: !!apparaat.smal, aanraak: !!apparaat.aanraak }, geladen: !!geladen,
      };
      if (midden) kop.midden = true;
      sessie = { kop, r: [], g: [] };
      data.sessies.push(sessie);
      while (data.sessies.length > R.maxSessies) data.sessies.shift();
      t0 = klok();
      p.fase = state.faseIdx ?? 0;
      log('start', { geladen: !!geladen });
      schrijf();
      return true;
    },

    log,
    schrijf: () => { if (vuil) schrijf(); },

    invoer() { p.invoer = klok(); p.stilGemeld = false; },
    modal() { p.invoer = klok(); p.stilGemeld = false; }, // een nieuw venster start een nieuwe stilteperiode
    tempo(v) {
      if (v === p.tempo) return;
      p.tempo = v;
      log('tempo', { v });
    },
    tab(t) {
      if (t === p.tab) return;
      p.tab = t;
      log('tab', { tab: t });
      const nu = klok();
      p.tabs.push(nu);
      while (p.tabs.length && nu - p.tabs[0] > R.zoekVenster) p.tabs.shift();
      if (p.tabs.length >= R.zoekTabs) { log('zoek'); p.tabs = []; }
    },
    tut(stap) {
      // Review: dezelfde stap kan vaker afgaan (twee tikken voor de stap verder springt); één regel per stap.
      const s = stap == null ? null : String(stap).slice(0, 40);
      if (s === p.tutLaatst) return;
      p.tutLaatst = s;
      log('tut', { stap: s });
    },

    // 'order' van ordersignaal.js (c16b): { order, ok, reden }.
    order(d) {
      if (!sessie || !d) return;
      const o = d.order ?? {};
      const nu = klok();
      const ok = !!d.ok;
      p.tabs = [];
      p.laatsteOrder = o;
      p.laatsteOrderT = nu;
      if (o.type === 'beleid' && ok) {
        if (nu - p.beleidT < R.beleidRust) return;
        p.beleidT = nu;
      }
      const g = o.gebouw ?? o.eenheid ?? o.actie ?? null;
      log('order', { o: o.type ?? '?', ok, r: ok ? null : d.reden, g: g == null ? null : String(g).slice(0, 40), plek: o.tegel != null });
      if (!p.eersteOrder) { p.eersteOrder = true; log('eerste', { wat: 'order' }); }
      if (ok && o.type === 'bouw' && !p.eersteBouw) { p.eersteBouw = true; log('eerste', { wat: 'bouw' }); }
      if (!ok) {
        const k = `${o.type}|${normaalReden(d.reden)}`;
        if (p.weiger[k] != null && nu - p.weiger[k] <= R.weigerVenster) log('weiger2', { o: o.type, r: d.reden });
        p.weiger[k] = nu;
      }
      if (ok && o.type === 'bouw' && o.tegel != null && p.plaats) { p.plaats.klaar = true; log('plaatsKlaar', { g }); }
    },

    // 'bouwfeedback' (c16b/c16c): { gebouw, tegel, ... }. Zonder tegel in de order is het "Auto".
    bouwfeedback(d, inBeeld = () => null) {
      if (!sessie || !d) return;
      const o = p.laatsteOrder;
      if (!o || o.type !== 'bouw' || o.tegel != null) return;
      const kib = d.kaartInBeeld ?? inBeeld(d.tegel);
      log('auto', { g: d.gebouw ?? o.gebouw ?? null, kib: kib == null ? null : !!kib });
    },

    // 'bouwlade' (c16b): { stap: 'open'|'kies'|'verplaats'|'bevestig'|'annuleer'|'plaats'|'plaatsStop', gebouw, kaartInBeeld }.
    bouwlade(d) {
      if (!sessie || !d) return;
      const g = d.gebouw ?? null;
      if (d.stap === 'plaats') { p.plaats = { g, klaar: false }; log('plaats', { g }); return; }
      if (d.stap === 'plaatsStop' || d.stap === 'annuleer') {
        if (d.stap === 'annuleer') log('lade', { stap: d.stap, g, kib: d.kaartInBeeld });
        if (p.plaats && !p.plaats.klaar) log('plaatsStop', { g: g ?? p.plaats.g });
        p.plaats = null;
        return;
      }
      log('lade', { stap: String(d.stap ?? '?'), g, kib: d.kaartInBeeld });
    },

    weg() { if (!p.verborgen) { p.verborgen = true; log('weg'); } schrijf(); },
    terug() { if (p.verborgen) { p.verborgen = false; p.invoer = klok(); p.stilGemeld = false; log('terug'); } },

    // Elke seconde vanuit de browserlaag. Leest de toestand; geeft { puls: true } als het pulskaartje mag komen.
    tick(state, env) {
      if (!sessie || !state) return null;
      const nu = klok();
      const dt = p.vorigeTick == null ? 0 : Math.min(2, Math.max(0, nu - p.vorigeTick));
      p.vorigeTick = nu;
      if (env.actief) p.speeltijd += dt;
      boek.einde(state);
      if ((state.faseIdx ?? 0) !== p.fase) { p.faseGewisseld = true; p.fase = state.faseIdx ?? 0; }
      if (env.actief && !p.stilGemeld && nu - p.invoer >= R.stil) {
        p.stilGemeld = true;
        log('stil', { modus: env.modal ? 'modal' : env.tempo > 0 ? 'snel' : 'pauze', v: env.tempo ?? 0 });
      }
      if (nu - p.tekortT >= R.tekortRust) {
        const lijst = evenwichtToestand(state);
        const rood = [], oranje = [];
        for (let i = 0; i < lijst.length; i++) {
          if (lijst[i].niveau === 'rood') rood.push(lijst[i].r);
          else if (lijst[i].niveau === 'oranje') oranje.push(lijst[i].r);
        }
        const sig = rood.join(',') + '|' + oranje.join(',');
        if (sig !== p.tekortSig) {
          p.tekortSig = sig;
          p.tekortT = nu;
          log('tekort', { rood, oranje });
        }
      }
      if (vuil && nu - laatsteSchrijf >= R.schrijfElke) schrijf();
      return { puls: magPuls({ getoond: p.getoond, weg: p.wegGeklikt, speeltijd: p.speeltijd, laatst: p.laatst, faseGewisseld: p.faseGewisseld }, env, R) };
    },

    // Het potje is afgelopen: één keer 'einde' (vanuit de seconde-lus, en bij "Naar start" voor het geval dat sneller ging).
    einde(state) {
      if (!sessie || !state?.uitkomst || p.einde) return;
      p.einde = true;
      log('einde', { wint: !!state.uitkomst.spelerWint });
    },

    pulsGetoond() { p.getoond += 1; p.laatst = p.speeltijd; },
    pulsAntwoord(gezicht, chip = null) { log('puls', { gezicht, chip }); },
    pulsWeg(hoe) { if (hoe === 'weg') p.wegGeklikt += 1; log('pulsWeg', { hoe }); },
    pulsStand: () => ({ getoond: p.getoond, weg: p.wegGeklikt, speeltijd: p.speeltijd, laatst: p.laatst, faseGewisseld: p.faseGewisseld }),

    afhaakGevraagd: () => p.afhaakGevraagd,
    zetAfhaakGevraagd(v) { p.afhaakGevraagd = v; },
    stopReden(reden, achteraf = false) { log('stopReden', { reden, achteraf }); schrijf(); },

    // Stopte het vorige potje zonder einde en zonder antwoord? Dan stelt het startscherm de vraag achteraf.
    vorigeZonderEinde() {
      if (keuze !== 'ja') return false;
      const l = laad().sessies;
      const laatste = l[l.length - 1];
      if (!laatste || laatste === sessie || laatste.g.length < 3) return false;
      return !laatste.g.some((a) => a[2] === 'einde' || a[2] === 'stopReden');
    },
    stopRedenAchteraf(reden) {
      const l = laad().sessies;
      const laatste = l[l.length - 1];
      if (!laatste || laatste === sessie) return false;
      const a = laatste.g[laatste.g.length - 1] ?? [0, 0];
      laatste.g.push(inpakken(laatste, a[0], a[1], 'stopReden', { reden, achteraf: true }));
      schrijf();
      return true;
    },

    lees() {
      const l = laad().sessies;
      return { versie: 1, sessies: l.map((x) => ({ kop: { ...x.kop, apparaat: { ...x.kop.apparaat } }, regels: uitpakken(x) })) };
    },
    wis() {
      weg(R.sleutelLog);
      data = { versie: 1, sessies: [] };
      sessie = null;
      vuil = false;
    },
    grootte: () => (lees(R.sleutelLog) ?? '').length,
  };
  return boek;
}

// ---------- samenvatting en deelbestand (puur) ----------

export function leesSpeltestUit(opslag = standaardOpslag()) {
  try { const v = JSON.parse(opslag?.getItem(LEER_REGELS.sleutelSpeltest) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

// Een speltestrecord zonder de vrije tekstvakken (besteZet, onduidelijk). nogEens is een keuzerondje en blijft.
export function zonderTekst(r) {
  if (!r || typeof r !== 'object') return r;
  const a = r.antwoorden ?? {};
  return { ...r, antwoorden: { besteZet: '', onduidelijk: '', nogEens: a.nogEens ?? null } };
}

export function maakVerslag({ speltest = [], replay = null, leerlog = null, metTekst = false } = {}) {
  const v = { formaat: 'machtsbalans-speelverslag', versie: 1, speltest: metTekst ? speltest : speltest.map(zonderTekst) };
  if (replay) v.replay = replay;
  v.leerlog = leerlog ?? { versie: 1, sessies: [] };
  return v;
}

export function verslagNaam(pack, datum) {
  const schoon = String(pack ?? 'onbekend').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'onbekend';
  return `machtsbalans-speelverslag-${schoon}-${datum}.json`;
}

// "3 sessies, 52 minuten, 41 bouwacties, 6 keer geweigerd, je antwoorden: 🙂 😐. Er staan geen naam, ..."
export function samenvatting(leerlog, { speltest = [], metTekst = false } = {}) {
  const sessies = leerlog?.sessies ?? [];
  let sec = 0, bouw = 0, geweigerd = 0;
  const gezichten = [];
  for (const s of sessies) {
    const rg = s.regels ?? [];
    if (rg.length) sec += rg[rg.length - 1].t ?? 0;
    for (const r of rg) {
      if (r.s === 'order' && r.o === 'bouw' && r.ok) bouw++;
      if (r.s === 'order' && !r.ok) geweigerd++;
      if (r.s === 'puls' && r.gezicht) gezichten.push(LEER_REGELS.gezichten.find((g) => g.id === r.gezicht)?.teken ?? '');
    }
  }
  const min = Math.round(sec / 60);
  const delen = [
    `${sessies.length} ${sessies.length === 1 ? 'sessie' : 'sessies'}`,
    `${min} ${min === 1 ? 'minuut' : 'minuten'}`,
    `${bouw} ${bouw === 1 ? 'bouwactie' : 'bouwacties'}`,
    `${geweigerd} keer geweigerd`,
    `je antwoorden: ${gezichten.length ? gezichten.join(' ') : 'nog geen'}`,
  ];
  let zin = delen.join(', ') + '.';
  if (speltest.length) zin += ` Plus ${speltest.length} ${speltest.length === 1 ? 'verslag' : 'verslagen'} van het eindscherm.`;
  zin += metTekst
    ? ' Er staan geen naam en geen apparaatnummer in. Je getypte antwoorden van het eindscherm gaan wel mee.'
    : ' Er staan geen naam, geen apparaatnummer en geen getypte tekst in.';
  return zin;
}

// ---------- browserlaag ----------

const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined' && typeof document.getElementById === 'function';
const klok = () => Date.now() / 1000;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const testVlag = () => { try { return new URLSearchParams(window.location.search).get('leertest') === '1'; } catch { return false; } };

let boek = null;
let uiRef = null;
let pulsEl = null;
let pulsStaat = null; // { soort: 'puls'|'afhaak', sinds, gezicht }
let deelOpen = false;
let gestart = false;

// Zichtbaar ook als het element position: fixed heeft (dan is offsetParent altijd null), zoals op de telefoon.
const zichtbaar = (sel) => { const el = document.querySelector(sel); return !!el && !el.hidden && el.getClientRects().length > 0; };
const apparaat = () => ({
  smal: !!window.matchMedia?.('(max-width: 600px)').matches,
  aanraak: !!(window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window),
});

function omgeving() {
  const ui = uiRef;
  const s = ui?.state;
  const huidig = onderpaneel.huidig();
  return {
    actief: !!s && !document.getElementById('spel')?.hidden && document.visibilityState === 'visible',
    modal: !!ui?.modal,
    tempo: ui?.tempo ?? 0,
    bouwModus: !!ui?.bouwModus,
    lade: huidig === 'lade' || zichtbaar('#bouwlade'),
    tutorial: zichtbaar('#tutorial'),
    ander: !!huidig && huidig !== 'puls' && huidig !== 'afhaak',
    uitkomst: !!s?.uitkomst,
  };
}

export function startLeren() {
  if (!inBrowser || gestart) return boek;
  gestart = true;
  boek = maakLeerboek({ klok, dag: () => uiRef?.state?.dag ?? 0, test: testVlag() });
  pulsEl = document.getElementById('puls');
  const invoer = () => boek.invoer();
  for (const n of ['pointerdown', 'keydown', 'click']) document.addEventListener(n, invoer, { capture: true, passive: true });
  document.addEventListener('wheel', invoer, { capture: true, passive: true });
  window.addEventListener('order', (e) => { try { boek.order(e.detail); } catch (err) { console.warn('leren order', err); } });
  window.addEventListener('bouwfeedback', (e) => {
    try { boek.bouwfeedback(e.detail, (t) => (uiRef?.kaart && t != null ? plekInBeeld(uiRef.kaart, t) : null)); } catch (err) { console.warn('leren bouwfeedback', err); }
  });
  window.addEventListener('bouwlade', (e) => { try { boek.bouwlade(e.detail); } catch (err) { console.warn('leren bouwlade', err); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') boek.weg(); else boek.terug(); });
  window.addEventListener('pagehide', () => boek.weg());
  setInterval(tik, 1000);
  // Het startschermblok opnieuw tekenen zodra het startscherm weer verschijnt.
  const start = document.getElementById('start');
  if (start && typeof MutationObserver === 'function') {
    new MutationObserver(() => { if (!start.hidden) toonStart(); }).observe(start, { attributes: true, attributeFilter: ['hidden'] });
  }
  toonStart();
  return boek;
}

function tik() {
  try {
    const s = uiRef?.state;
    if (!s || !boek.actief()) { if (pulsStaat?.soort === 'puls') verbergPuls(null); return; }
    const env = omgeving();
    const r = boek.tick(s, env);
    const nu = klok();
    if (pulsStaat?.soort === 'puls') {
      const storing = env.modal || env.bouwModus || env.lade || env.tutorial || env.ander || env.uitkomst || !env.actief;
      if (storing) verbergPuls('onderbroken');
      else if (nu - pulsStaat.sinds >= boek.R.pulsDuur) verbergPuls('tijd');
    } else if (pulsStaat?.soort === 'afhaak') {
      // Speelt de speler toch verder, dan vervalt de vraag (en mag hij bij de volgende keer terug opnieuw komen).
      if (uiRef.tempo > 0 || env.modal) { verbergPuls(null); boek.zetAfhaakGevraagd(false); }
    } else if (r?.puls) toonPuls();
  } catch (err) { console.warn('leren tik', err); }
}

// Voor metingen (kijk.mjs --leren): één tik van de seconde-lus, zoals setInterval hem doet.
export function leerTik() { tik(); }

// ---------- haakjes voor main.js (elk één regel daar) ----------

export function potje(ui, { geladen = false, replay = false } = {}) {
  if (!boek) startLeren();
  uiRef = ui;
  verbergPuls(null);
  boek?.potje(ui.state, { geladen, replay, apparaat: apparaat() });
}
export function tempo(t) { boek?.tempo(t); }
export function tab(t) { boek?.tab(t); }
export function modal(open) { boek?.modal(open); if (open && pulsStaat?.soort === 'puls') verbergPuls('onderbroken'); }
export function tut(stap) { boek?.tut(stap); }
export function logLeer(soort, velden) { return boek?.log(soort, velden) ?? false; }
export function leesLeerlog() { return (boek ?? maakLeerboek()).lees(); }
export function wisLeerlog() { (boek ?? maakLeerboek()).wis(); }

// Bij "Terug naar startscherm": eerst "Waarom stop je nu?". Geeft true als het kaartje er staat (main.js stopt dan);
// een antwoord roept verder() opnieuw aan, en dan geeft deze functie false.
export function afhaak(state, verder) {
  boek?.einde(state);
  if (!boek?.actief() || !state || state.uitkomst || state.replay || boek.afhaakGevraagd() || !pulsEl) return false;
  boek.zetAfhaakGevraagd(true);
  verbergPuls(null);
  pulsStaat = { soort: 'afhaak', sinds: klok() };
  pulsEl.className = 'leer-kaart leer-afhaak';
  pulsEl.innerHTML = `<div class="leer-kop"><b>Waarom stop je nu?</b></div>
    <div class="leer-chips">${boek.R.stopRedenen.map((x) => `<button class="knop leer-chip${x.id === 'over' ? ' zacht' : ''}" data-stop="${x.id}">${esc(x.tekst)}</button>`).join('')}</div>`;
  for (const b of pulsEl.querySelectorAll('[data-stop]')) {
    b.onclick = () => {
      boek.stopReden(b.dataset.stop, false);
      verbergPuls(null);
      verder();
    };
  }
  pulsEl.hidden = false;
  onderpaneel.open('afhaak', () => verbergPuls(null));
  // Review: het menu is net dicht; staat het kaartje buiten beeld (laag venster, gescrolde pagina), dan lijkt de knop
  // "Terug naar startscherm" niets te doen. Dus het kaartje in beeld halen.
  try { pulsEl.scrollIntoView?.({ block: 'nearest' }); } catch { /* oude browser */ }
  return true;
}

export function menuHtml() {
  const aan = boek?.aan();
  return `<div class="leer-menu">
      <label class="check leer-schakel"><input type="checkbox" id="m-leren" ${aan ? 'checked' : ''}> Speelverslag bijhouden (blijft op dit apparaat)</label>
      <p class="zacht">Het spel noteert wat je doet, zoals bouwen, wachten en stoppen, zodat wij het spel beter kunnen maken. Er gaat niets weg: alleen jij kunt het delen, op het startscherm.</p>
      <button class="knop" id="m-leerwis">Wis mijn speelverslag</button>
    </div>`;
}
export function bindMenu(el) {
  const knop = el.querySelector('#m-leren');
  const wis = el.querySelector('#m-leerwis');
  if (!knop || !boek) return;
  knop.onchange = () => {
    boek.zetKeuze(knop.checked);
    if (knop.checked && uiRef?.state) boek.potje(uiRef.state, { replay: !!uiRef.state.replay, apparaat: apparaat(), midden: true });
    wis.textContent = knop.checked ? 'Wis mijn speelverslag' : 'Uit en gewist ✓';
  };
  wis.onclick = () => {
    boek.wis();
    if (boek.aan() && uiRef?.state) boek.potje(uiRef.state, { replay: !!uiRef.state.replay, apparaat: apparaat(), midden: true });
    wis.textContent = 'Gewist ✓';
  };
}

// ---------- pulskaartje ----------

function toonPuls() {
  if (!pulsEl) return;
  boek.pulsGetoond();
  pulsStaat = { soort: 'puls', sinds: klok(), gezicht: null };
  pulsEl.className = 'leer-kaart leer-puls';
  pulsEl.innerHTML = `<div class="leer-kop"><b>Hoe is het nu?</b><button class="knop leer-weg" data-puls="weg" aria-label="Wegklikken">✕</button></div>
    <div class="leer-gezichten">${boek.R.gezichten.map((g) => `<button class="knop leer-gezicht" data-gezicht="${g.id}" aria-label="${esc(g.label)}" title="${esc(g.label)}">${g.teken}</button>`).join('')}</div>
    <div class="leer-chips" hidden>${boek.R.chips.map((c) => `<button class="knop leer-chip" data-chip="${c.id}">${esc(c.tekst)}</button>`).join('')}</div>`;
  for (const b of pulsEl.querySelectorAll('[data-gezicht]')) {
    b.onclick = () => {
      pulsStaat.gezicht = b.dataset.gezicht;
      pulsStaat.sinds = klok(); // de speler is bezig: de 20 s beginnen opnieuw
      for (const x of pulsEl.querySelectorAll('[data-gezicht]')) x.classList.toggle('gekozen', x === b);
      pulsEl.querySelector('.leer-chips').hidden = false;
    };
  }
  for (const b of pulsEl.querySelectorAll('[data-chip]')) {
    b.onclick = () => {
      boek.pulsAntwoord(pulsStaat.gezicht, b.dataset.chip);
      pulsStaat.beantwoord = true;
      pulsEl.innerHTML = '<div class="leer-kop"><b>Dank je!</b></div>';
      setTimeout(() => { if (pulsStaat?.beantwoord) verbergPuls(null); }, 1200);
    };
  }
  pulsEl.querySelector('[data-puls="weg"]').onclick = () => verbergPuls('weg');
  pulsEl.hidden = false;
  onderpaneel.open('puls', () => verbergPuls('onderbroken'));
}

// Kaartje weg. hoe: 'weg' (✕), 'tijd' (20 s), 'onderbroken' (venster, bouwen) of null (niets loggen).
function verbergPuls(hoe) {
  const st = pulsStaat;
  pulsStaat = null;
  if (st?.soort === 'puls' && !st.beantwoord && hoe) {
    if (st.gezicht) boek.pulsAntwoord(st.gezicht, null); else boek.pulsWeg(hoe);
  }
  if (pulsEl) { pulsEl.hidden = true; pulsEl.innerHTML = ''; }
  if (st) onderpaneel.sluit(st.soort);
}

// ---------- startscherm ----------

const datumVandaag = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function toonStart() {
  const el = document.getElementById('leer-start');
  if (!el || !boek) return;
  const keuze = boek.keuze();
  let h = '';
  if (keuze == null) {
    h += `<div class="leer-kaart leer-vraag" role="group" aria-label="Speelverslag">
      <b>Speelverslag bijhouden op dit apparaat?</b>
      <p>Er gaat niets weg. Je kunt het later in het Menu uitzetten en wissen.</p>
      <div class="leer-rij"><button class="knop primair" data-leer="ja">Ja, bijhouden</button><button class="knop" data-leer="nee">Nee</button></div>
    </div>`;
  } else {
    if (boek.vorigeZonderEinde()) {
      h += `<div class="leer-kaart leer-achteraf"><b>Je vorige potje stopte zonder einde. Waarom stopte je toen?</b>
        <div class="leer-chips">${boek.R.stopRedenen.map((x) => `<button class="knop leer-chip" data-achteraf="${x.id}">${esc(x.tekst)}</button>`).join('')}</div></div>`;
    }
    const log = boek.lees();
    const speltest = leesSpeltestUit();
    if (log.sessies.length || speltest.length) {
      if (!deelOpen) h += '<button class="knop" data-leer="deel">Deel mijn speelverslag</button>';
      else {
        h += `<div class="leer-kaart leer-deel"><b>Dit staat in je speelverslag</b>
          <p class="leer-som" id="leer-som">${esc(samenvatting(log, { speltest }))}</p>
          <label class="check"><input type="checkbox" id="leer-tekst"> Ook mijn getypte antwoorden van het eindscherm meesturen</label>
          <div class="leer-rij">
            ${kanDelen() ? '<button class="knop primair" data-leer="delen">Delen</button>' : ''}
            <button class="knop${kanDelen() ? '' : ' primair'}" data-leer="download">Downloaden</button>
            <button class="knop" data-leer="sluit">Sluiten</button>
          </div>
          <p class="zacht">Het bestand gaat alleen naar wie jij het stuurt.</p>
        </div>`;
      }
    }
  }
  el.innerHTML = h;
  el.hidden = !h;
  const q = (s) => el.querySelector(s);
  q('[data-leer="ja"]')?.addEventListener('click', () => { boek.zetKeuze(true); toonStart(); });
  q('[data-leer="nee"]')?.addEventListener('click', () => { boek.zetKeuze(false); toonStart(); });
  q('[data-leer="deel"]')?.addEventListener('click', () => { deelOpen = true; toonStart(); });
  q('[data-leer="sluit"]')?.addEventListener('click', () => { deelOpen = false; toonStart(); });
  for (const b of el.querySelectorAll('[data-achteraf]')) b.addEventListener('click', () => { boek.stopRedenAchteraf(b.dataset.achteraf); toonStart(); });
  const tekst = q('#leer-tekst');
  if (tekst) tekst.onchange = () => { q('#leer-som').textContent = samenvatting(boek.lees(), { speltest: leesSpeltestUit(), metTekst: tekst.checked }); };
  q('[data-leer="delen"]')?.addEventListener('click', () => deelVerslag({ metTekst: !!tekst?.checked, delen: true }));
  q('[data-leer="download"]')?.addEventListener('click', () => deelVerslag({ metTekst: !!tekst?.checked, delen: false }));
}

function bestandVan(verslag) {
  const leer = verslag.leerlog?.sessies ?? [];
  const pack = leer[leer.length - 1]?.kop?.pack ?? verslag.speltest?.[verslag.speltest.length - 1]?.pack ?? 'onbekend';
  const naam = verslagNaam(pack, datumVandaag());
  const tekst = JSON.stringify(verslag, null, 1);
  return { naam, tekst };
}

function kanDelen() {
  try {
    if (typeof navigator.canShare !== 'function' || typeof File !== 'function') return false;
    return navigator.canShare({ files: [new File(['{}'], 'proef.json', { type: 'application/json' })] });
  } catch { return false; }
}

// Bouwt het bestand en geeft het aan het deelmenu van het apparaat (delen) of aan de browser (downloaden).
// Er gaat niets naar een server: delen en downloaden zijn handelingen van de speler zelf.
export async function deelVerslag({ metTekst = false, delen = false } = {}) {
  const verslag = maakVerslag({ speltest: leesSpeltestUit(), leerlog: leesLeerlog(), metTekst });
  const { naam, tekst } = bestandVan(verslag);
  if (delen && kanDelen()) {
    try {
      await navigator.share({ files: [new File([tekst], naam, { type: 'application/json' })], title: 'Speelverslag' });
      return 'gedeeld';
    } catch (e) {
      if (e?.name === 'AbortError') return 'afgebroken';
      // anders: terugval op downloaden
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([tekst], { type: 'application/json' }));
  a.download = naam;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'gedownload';
}

if (inBrowser) startLeren();
