// C16b: bouwen op de telefoon terwijl de kaart in beeld blijft (docs/c16-plan.md, "c16b-bouwlade").
//
// Drie delen:
// 1. Puur (geen DOM, draait in node): ladeKaarten, aanbevolen, startPlek, plaatsStatus en ladeKosten. Ze lezen de
//    spelstand en veranderen hem nooit. De bouwkaart komt uit evenwicht.bouwKaartData (dezelfde toetsen als de engine).
// 2. maakBesturing(api): de standen dicht, half en plaats, zonder DOM. Geeft alleen een order bij ✓ (via api.geef,
//    dat is geef() in main.js), nooit in replay.
// 3. maakBouwlade(api): de weergave (knop, lade, plaatsbalk, ruimtehouder, ingeklapte legenda) en het vegen.
// Op een breed scherm (> 600 px) doet de lade niets: daar blijven de bouwlijst en #bouwbalk.

import * as sim from '../engine/sim.js';
import { bouwKaartData, oplossers, ergste, toestand, effectVan, getal, teken, actieveVerbouw, AANBEVOLEN_MAX } from './evenwicht.js';
import { meldBouwlade } from './ordersignaal.js';
import * as onderpaneel from './onderpaneel.js';
import { gebiedVan, gebiedCentra } from '../engine/gebieden.js'; // C17c: bouwen in het gebied dat je bekijkt
import { gebiedNaam, isKolonie, TEKST as GEBIED_TEKST } from './gebieden.js';
import { plekInBeeld } from './bouwfeedback.js';

// ---------- weergavegetallen (geen spelregels) ----------
export const LADE_H = 220;            // de half open lade is hoogstens zo hoog (zonder safe-area)
export const PLAATSBALK_H = 72;       // de plaatsbalk in plaatsmodus
export const VOORBEELD_ZOOM = 7;      // de camera zoomt bij het kiezen minstens zo ver in (plan: ≥ 3,6; op 390 px breed is 7 nodig om het voorbeeld te zien)
export const ORANJE_RENDEMENT = 0.85; // onder dit rendement is een vakje oranje
export const VEEG_DICHT = 60;         // zo ver omlaag vegen sluit de lade
export const SMAL = '(max-width: 600px)';
export const OPSLAG_SLEUTEL = 'machtsbalans.lade';
export const TABS = [
  { id: 'economie', naam: 'Economie' },
  { id: 'maatschappij', naam: 'Voorzieningen' },
  { id: 'leger', naam: 'Leger' },
];

export const TEKST = {
  heb: (voorraad, n, max) => `Je hebt ${voorraad} · ${n}/${max} projecten`,
  aanbevolen: 'Aanbevolen',
  lost: (naam) => `lost ${naam} op`,
  kiesVakje: 'Tik een vakje van je land',
  geenPlek: 'Geen geschikte plek vrij',
  vol: 'rendement 100%',
  rendement: (p, waarom) => `rendement ${p}%${waarom ? ` · ${waarom}` : ''}`,
  ver: 'ver van hoofdstad of depot',
  grond: 'minder geschikte grond',
  goedeGrond: 'goede grond',
  bouwenIn: 'Bouwen in:',                            // C17c
  geenPlekIn: (naam) => `Geen plek meer in ${naam}`,
  wachtrij: (naam, n) => `Wachtrij ${naam}: ${n} te gaan`,
};

// ---------- puur ----------

function spelerVan(s) { return s.landen[s.speler]; }
const rond = (v) => Math.round(v);

export function tabVan(g) {
  return g?.categorie === 'maatschappij' ? 'maatschappij' : g?.categorie === 'leger' ? 'leger' : 'economie';
}

// Het gebouw dat het ergste tekort (rood of oranje) oplost, uit evenwicht.oplossers. Zonder tekort: null.
// Voorkeur: een oplosser die je nu kunt bouwen, anders de beste die al vrij is.
export function aanbevolen(s, lijst = toestand(s)) {
  const e = ergste(s, lijst);
  if (!e.item || (e.niveau !== 'rood' && e.niveau !== 'oranje')) return null;
  const opl = oplossers(s, e.item.r, AANBEVOLEN_MAX, lijst);
  const k = opl.find((o) => o.kan) ?? opl.find((o) => !o.slot) ?? null;
  if (!k) return null;
  return { gebouw: k.gebouw, r: e.item.r, niveau: e.niveau, zin: TEKST.lost(`${e.item.icoon ? `${e.item.icoon} ` : ''}${e.niveau === 'rood' ? 'tekort' : 'krapte'}`) };
}

// Het hoofdeffect per dag als korte tekst: "± +10,8 ⚡/d". Eerst wat het gebouw maakt, anders de grootste verandering.
export function effectKort(s, gebouwId, tegel = null) {
  const g = s.pack.gebouwIndex[gebouwId];
  if (!g) return '';
  const per = effectVan(s, gebouwId, tegel).per;
  let r = null;
  for (const k of Object.keys(g.productie || {})) if ((per[k] ?? 0) > 0 && (!r || per[k] > per[r])) r = k;
  if (!r) for (const k of Object.keys(per)) if (!r || Math.abs(per[k]) > Math.abs(per[r])) r = k;
  if (!r || Math.abs(per[r]) < 0.05) return '';
  return `± ${teken(per[r])}${getal(per[r])} ${s.pack.resIndex[r]?.icoon ?? r}/d`;
}

// Alle kaarten voor de strook van een tab: eerst "Aanbevolen" (ook uit een andere tab), dan wat je kunt bouwen, dan de
// gedimde kaarten (met reden), tot slot wat nog op slot zit. Elke kaart is evenwicht.bouwKaartData plus weergave.
export function ladeKaarten(s, tab = 'economie', lijst = toestand(s)) {
  const P = s.pack;
  const adv = aanbevolen(s, lijst);
  const kaart = (g, isAdv) => {
    const d = bouwKaartData(s, g.id, lijst);
    return {
      id: g.id, naam: g.naam, icoon: g.icoon ?? '', tab: tabVan(g), kan: d.kan, reden: d.kan ? '' : d.reden,
      kostPerGrondstof: d.kostPerGrondstof, lostOp: d.lostOp, slot: !sim.isOntgrendeld(s, g.id),
      aanbevolen: !!isAdv, advies: isAdv ? adv.zin : '', effect: d.kan || isAdv ? effectKort(s, g.id) : '', bouwtijd: g.bouwtijd ?? 5,
    };
  };
  const uit = [];
  if (adv) uit.push(kaart(P.gebouwIndex[adv.gebouw], true));
  const kan = [], niet = [], slot = [];
  for (let i = 0; i < P.gebouwen.length; i++) {
    const g = P.gebouwen[i];
    if (tabVan(g) !== tab || g.id === adv?.gebouw) continue;
    const k = kaart(g, false);
    (k.slot ? slot : k.kan ? kan : niet).push(k);
  }
  return uit.concat(kan, niet, slot);
}

// "Je hebt 210◈ 40⛏ · 1/2 projecten": de grondstoffen waarmee gebouwd wordt.
export function ladeKosten(s) {
  const c = spelerVan(s);
  const P = s.pack;
  const nodig = {};
  for (let i = 0; i < P.gebouwen.length; i++) for (const r of Object.keys(P.gebouwen[i].kosten || {})) nodig[r] = true;
  const delen = [];
  for (let i = 0; i < P.resources.length; i++) {
    const r = P.resources[i];
    if (!nodig[r.id] || !sim.isOntgrendeld(s, r.id)) continue;
    delen.push(`${rond(c.voorraad[r.id] ?? 0)}${r.icoon ?? r.id}`);
  }
  const d = bouwKaartData(s, P.gebouwen[0]?.id);
  return { tekst: TEKST.heb(delen.join(' '), d.projecten, d.max), projecten: d.projecten, max: d.max };
}

// De beste plek: zonder gebied precies de tegel die een bouw-order zonder tegel zou kiezen; met gebied (C17c) de beste
// plek in dat gebied (−1 als daar niets vrij is).
export function startPlek(s, gebouwId, gebied = null) {
  // Review: een gebied dat niet (meer) van jou is (kolonie verloren in opstand) telt als 'geen gebied'.
  const g = gebied == null || gebied < 0 || !gebiedCentra(s, s.speler).includes(gebied) ? null : gebied;
  return sim.kiesTegel(s, spelerVan(s), gebouwId, g);
}

// C17c: de kaart "Bouw zoals thuis" vooraan in de strook als je een kolonie bekijkt.
export function zoalsThuisKaartHtml(s, centrum) {
  return `<button class="bl-kaart bl-zoals" data-actie="zoalsthuis" data-id="${centrum}"${s.replay ? ' disabled' : ''}>`
    + `<span class="bl-ico" aria-hidden="true">🏘</span><span class="bl-naam">${GEBIED_TEKST.zoalsThuis}</span>`
    + `<span class="bl-regel">Dezelfde verhouding als thuis in ${String(gebiedNaam(s, centrum)).replace(/[&<>"]/g, '')}</span></button>`;
}

// Wat de plaatsbalk over een vakje zegt: { ok, niveau: 'groen'|'oranje'|'rood', zin, rendement, effect }.
// Rood: de reden van de engine (tegelStatus of bouwKaartData). Oranje: het rendement en waarom. Het effect van het
// vakje ("± +10,8 ⚡/d") staat alleen hier.
export function plaatsStatus(s, gebouwId, tegel) {
  const g = s.pack.gebouwIndex[gebouwId];
  if (!g) return { ok: false, niveau: 'rood', zin: 'Onbekend gebouw', rendement: 0, effect: '' };
  const d = bouwKaartData(s, gebouwId);
  if (!d.kan) return { ok: false, niveau: 'rood', zin: d.reden || TEKST.geenPlek, rendement: 0, effect: '' };
  if (tegel == null || tegel < 0) return { ok: false, niveau: 'rood', zin: TEKST.kiesVakje, rendement: 0, effect: '' };
  const st = sim.tegelStatus(s, s.speler, gebouwId, tegel);
  if (!st.ok) return { ok: false, niveau: 'rood', zin: String(st.reden ?? TEKST.geenPlek).replace(/\.$/, ''), rendement: 0, effect: '' };
  const rend = st.rendement ?? 1;
  const bonus = g.terrein_bonus?.[s.pack.geo.tegels[tegel]?.terrein] ?? 1;
  const effect = effectKort(s, gebouwId, tegel);
  const p = rond(rend * 100);
  let waarom = '';
  if (bonus < 1) waarom = TEKST.grond;
  else if (rend < bonus - 1e-9) waarom = TEKST.ver;
  else if (bonus > 1) waarom = TEKST.goedeGrond;
  const niveau = rend < ORANJE_RENDEMENT ? 'oranje' : 'groen';
  const zin = [p === 100 && !waarom ? TEKST.vol : TEKST.rendement(p, waarom), effect].filter(Boolean).join(' · ');
  return { ok: true, niveau, zin, rendement: rend, effect };
}

// ---------- besturing (geen DOM) ----------
// api: { state(), kaart(), geef(order), startBouwModus(id), stopBouwModus(), bouwModus(), meetOnder(stand),
//        kaartInBeeld(), opslag?: { lees(), schrijf(tab) }, onderpaneel?: { open, sluit }, teken?(), meld?(detail) }

export function maakBesturing(api) {
  const op = api.onderpaneel ?? onderpaneel;
  const meld = api.meld ?? meldBouwlade;
  const b = { stand: 'dicht', tab: 'economie', gebouw: null, tegel: -1, status: null, bezig: false, gebied: null, keuze: null, melding: '' };
  try { const t = api.opslag?.lees?.(); if (TABS.some((x) => x.id === t)) b.tab = t; } catch { /* geen opslag */ }

  const stuur = (stap, extra = {}) => meld({ stap, gebouw: b.gebouw, kaartInBeeld: !!api.kaartInBeeld?.(), ...extra });
  const zetOnder = () => { const k = api.kaart?.(); if (k) k.zichtOnder = b.stand === 'dicht' ? 0 : api.meetOnder?.(b.stand) ?? (b.stand === 'plaats' ? PLAATSBALK_H : LADE_H); };
  const herteken = () => { zetOnder(); api.teken?.(); };

  // Een ander onderpaneel gaat open: de lade gaat dicht (en de plaatsmodus stopt).
  const doorAnderGesloten = () => { if (b.stand === 'dicht') return; b.sluiten = true; if (api.bouwModus?.()) api.stopBouwModus(); b.sluiten = false; b.stand = 'dicht'; b.gebouw = null; b.tegel = -1; herteken(); };

  b.open = () => {
    const s = api.state?.();
    if (!s) return false;
    const was = b.stand;
    if (was === 'dicht') op.open('lade', doorAnderGesloten);
    b.stand = 'half';
    herteken();
    if (was === 'dicht') stuur('open');
    return true;
  };

  b.zetTab = (tab) => {
    if (!TABS.some((x) => x.id === tab)) return;
    b.tab = tab;
    try { api.opslag?.schrijf?.(tab); } catch { /* geen opslag */ }
    api.teken?.();
  };

  // C17c: het gebied dat je bekijkt (api.gebied, uit gebieden.js); zonder gebieden null (dan zoals vroeger).
  const bekeken = () => { const g = api.gebied?.(); return g == null || g < 0 ? null : g; };
  b.gebiedNu = () => (b.stand === 'plaats' && b.gebied != null ? b.gebied : bekeken());
  const meldGebied = (centrum) => { const s = api.state?.(); if (s) api.meldGebied?.({ centrum, naam: gebiedNaam(s, centrum), bron: 'lade' }); };

  // Kaart in de lade gekozen (of Plaats/Auto in het paneel): plaatsmodus met het voorbeeld op de beste plek.
  // opties.gebied: bouw in dat gebied in plaats van het bekeken gebied.
  b.kies = (id, opties = {}) => {
    const s = api.state?.();
    if (!s || !s.pack.gebouwIndex[id]) return false;
    // Review: in replay start main.js geen bouwmodus; zonder deze regel bleef de plaatsbalk staan en deed ✗ niets.
    if (s.replay) return false;
    if (b.stand === 'dicht') op.open('lade', doorAnderGesloten);
    b.keuze = opties.gebied ?? null;
    b.bezig = true;
    if (api.bouwModus?.() !== id) api.startBouwModus(id); // main.js roept daarna plaatsGestart aan
    b.bezig = false;
    if (b.stand !== 'plaats') b.plaatsGestart(id);
    stuur('kies');
    return true;
  };
  b.auto = (id) => b.kies(id); // op de telefoon eerst het voorbeeld, dan ✓

  // Vanuit startBouwModus (main.js), ook als het oplosser-kaartje de plaatsmodus start.
  b.plaatsGestart = (id) => {
    const s = api.state?.();
    if (!s) return;
    if (b.stand === 'dicht') op.open('lade', doorAnderGesloten);
    b.stand = 'plaats';
    b.gebouw = id;
    b.melding = '';
    b.gebied = b.keuze ?? bekeken();
    b.keuze = null;
    zetOnder();
    b.naarPlek(startPlek(s, id, b.gebied), true);
  };

  // C17c: een ander gebied gekozen (gebiedenlijstje). In plaatsmodus het voorbeeld naar de beste plek daar.
  b.zetGebied = (centrum) => {
    const s = api.state?.();
    if (!s) return;
    b.gebied = centrum;
    b.melding = '';
    if (b.stand !== 'plaats') { herteken(); return; }
    const t = startPlek(s, b.gebouw, centrum);
    b.naarPlek(t, true);
    // Review: geen plek voor dit gebouw daar: vlieg toch naar het gebied, de plaatsbalk zegt "Geen plek meer in …".
    const k = api.kaart?.();
    const tg = s.pack.geo.tegels[centrum];
    if (t < 0 && k && tg) k.vliegNaar(tg.x, tg.y, Math.max(k.zoom ?? 1, VOORBEELD_ZOOM));
  };

  // Zet het voorbeeld op tegel t (en vlieg erheen als dat gevraagd is).
  b.naarPlek = (t, vlieg) => {
    const s = api.state?.();
    const k = api.kaart?.();
    b.tegel = t;
    b.status = s ? plaatsStatus(s, b.gebouw, t) : null;
    if (k) {
      k.zetKandidaat?.(t);
      const tg = s?.pack.geo.tegels[t];
      if (vlieg && tg) k.vliegNaar(tg.x, tg.y, Math.max(k.zoom ?? 1, VOORBEELD_ZOOM));
    }
    herteken();
  };

  // Eerste tik op een ander vakje (map.js onKandidaat).
  b.verplaats = (t) => {
    if (b.stand !== 'plaats') return;
    // C17c: een vakje in een ander eigen gebied aangetikt: het gebied wisselt mee.
    const s = api.state?.();
    if (s && b.gebied != null && t >= 0 && s.eigenaar[t] === s.speler) {
      const g = gebiedVan(s, s.speler, t);
      if (g >= 0 && g !== b.gebied) { b.gebied = g; meldGebied(g); }
    }
    b.naarPlek(t, false);
    stuur('verplaats');
  };

  // ✓ (of een tweede tik op hetzelfde vakje). Alleen hier ontstaat een order, nooit in replay.
  b.bevestig = (t = b.tegel) => {
    const s = api.state?.();
    if (!s || b.stand !== 'plaats' || !b.gebouw) return { ok: false };
    if (t !== b.tegel) b.naarPlek(t, false);
    if (s.replay || s.uitkomst || !(b.tegel >= 0) || !plaatsStatus(s, b.gebouw, b.tegel).ok) { api.teken?.(); return { ok: false }; }
    const id = b.gebouw;
    const r = api.geef({ type: 'bouw', gebouw: id, tegel: b.tegel }) ?? { ok: false };
    stuur('bevestig', { ok: !!r.ok });
    if (!r.ok) { b.naarPlek(b.tegel, false); return r; }
    // Nog een kunnen betalen en een project vrij: blijf plaatsen, met het voorbeeld op de volgende beste plek in
    // hetzelfde gebied (C17c). De camera vliegt alleen als die plek buiten beeld ligt, en nooit naar een ander gebied.
    if (bouwKaartData(s, id).kan) {
      const t = startPlek(s, id, b.gebied);
      if (t < 0 && b.gebied != null) { b.melding = TEKST.geenPlekIn(gebiedNaam(s, b.gebied)); api.stopBouwModus(); }
      else b.naarPlek(t, !(api.inBeeld?.(t) ?? false));
    } else api.stopBouwModus(); // terug naar de half open lade, met het nieuwe project bovenaan
    return r;
  };

  // ✗ of lang drukken: stop met plaatsen, terug naar de half open lade. De camera blijft staan.
  b.annuleer = () => {
    if (b.stand !== 'plaats') return;
    if (api.bouwModus?.()) api.stopBouwModus(); // main.js roept plaatsGestopt aan
    else b.plaatsGestopt(); // review: geen bouwmodus (meer) actief, dan toch terug naar half open
    stuur('annuleer');
  };

  // Vanuit stopBouwModus (main.js).
  b.plaatsGestopt = () => {
    if (b.stand !== 'plaats' || b.sluiten) return;
    b.stand = 'half';
    b.tegel = -1;
    b.status = null;
    herteken();
  };

  // Naar beneden vegen of ✕: de lade gaat dicht (en de plaatsmodus stopt). De camera blijft staan.
  b.sluit = () => {
    if (b.stand === 'dicht') return;
    const was = b.stand;
    b.sluiten = true;
    if (api.bouwModus?.()) api.stopBouwModus();
    b.sluiten = false;
    b.stand = 'dicht';
    b.tegel = -1;
    b.melding = '';
    herteken();
    op.sluit('lade');
    stuur('annuleer', { dicht: true, vanuit: was });
    b.gebouw = null;
  };

  b.wissel = () => (b.stand === 'dicht' ? b.open() : b.sluit());
  return b;
}

// ---------- weergave (DOM) ----------

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function kaartHtml(s, k) {
  const kosten = k.kostPerGrondstof.map((x) => `<span class="${x.ok ? 'ok' : 'mist'}">${x.nodig}${esc(x.icoon)}</span>`).join(' ');
  const regel = k.kan ? (k.aanbevolen && k.advies ? k.advies : k.effect) : k.reden;
  return `<button class="bl-kaart${k.aanbevolen ? ' aanbevolen' : ''}${k.kan ? '' : ' gedimd'}" data-actie="plaats" data-id="${esc(k.id)}"${k.kan ? '' : ' disabled'}>`
    + `${k.aanbevolen ? `<span class="bl-tag">${TEKST.aanbevolen}</span>` : ''}`
    + `<span class="bl-ico" aria-hidden="true">${k.icoon}</span><span class="bl-naam">${esc(k.naam)}</span>`
    + `<span class="bl-kost">${kosten || '<span class="ok">gratis</span>'} <span class="zacht">· ${k.bouwtijd} d</span></span>`
    + `${regel ? `<span class="bl-regel${k.kan ? '' : ' reden'}">${esc(regel)}</span>` : ''}`
    + `${k.kan && k.aanbevolen && k.effect ? `<span class="bl-regel">${esc(k.effect)}</span>` : ''}`
    + `</button>`;
}

// api uit main.js: { ui, geef, startBouwModus, stopBouwModus }.
export function maakBouwlade(api) {
  const { ui } = api;
  const $ = (q) => document.querySelector(q);
  const TELEFOON = window.matchMedia(SMAL);
  const wrap = $('#kaart-wrap');
  const knop = $('#bouw-knop');
  const lade = $('#bouwlade');
  if (!wrap || !knop || !lade) return null;

  // Ruimtehouder: zolang de kaart vast over het scherm ligt, houdt hij zijn plek in de pagina (scrollY verspringt niet).
  const ruimte = document.createElement('div');
  ruimte.id = 'kaart-ruimte';
  wrap.before(ruimte);
  // De legenda klapt op de telefoon in tot een (i)-knopje naast Bouwen.
  const legKnop = document.createElement('button');
  legKnop.id = 'legenda-knop';
  legKnop.type = 'button';
  legKnop.setAttribute('aria-label', 'Legenda');
  legKnop.textContent = 'i';
  wrap.append(legKnop);
  legKnop.addEventListener('click', () => { const l = $('#legenda'); l?.classList.toggle('open'); legKnop.classList.toggle('open', !!l?.classList.contains('open')); });

  const opslag = {
    lees: () => { try { return localStorage.getItem(OPSLAG_SLEUTEL); } catch { return null; } },
    schrijf: (t) => { try { localStorage.setItem(OPSLAG_SLEUTEL, t); } catch { /* privé venster */ } },
  };
  let vorigeHtml = '';
  const teken = () => render(ui.state);
  const kaartInBeeld = () => { const r = wrap.getBoundingClientRect(); return r.height > 0 && Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) >= r.height * 0.5; };
  const b = maakBesturing({
    state: () => ui.state,
    kaart: () => ui.kaart,
    geef: api.geef,
    startBouwModus: api.startBouwModus,
    stopBouwModus: api.stopBouwModus,
    bouwModus: () => ui.bouwModus,
    opslag,
    teken,
    meetOnder: (stand) => { zetVast(stand); return lade.hidden ? 0 : lade.getBoundingClientRect().height; },
    kaartInBeeld,
    gebied: () => api.gebied?.() ?? null, // C17c
    meldGebied: (detail) => window.dispatchEvent(new CustomEvent('gebied', { detail })),
    inBeeld: (t) => !!ui.kaart && plekInBeeld(ui.kaart, t),
  });

  // De kaart ligt vast tussen de bovenbalk en de onderrand zolang de lade open is (body[data-onderpaneel="lade"]).
  function zetVast(stand) {
    const open = stand !== 'dicht';
    if (open && !wrap.classList.contains('lade-vast')) {
      ruimte.style.height = `${wrap.offsetHeight}px`;
      wrap.classList.add('lade-vast');
      document.body.classList.add('lade-open');
      ui.kaart?.pasAan?.();
    } else if (!open && wrap.classList.contains('lade-vast')) {
      wrap.classList.remove('lade-vast');
      document.body.classList.remove('lade-open');
      ruimte.style.height = '';
      ui.kaart?.pasAan?.();
    }
    lade.hidden = !open;
    lade.dataset.stand = stand;
    knop.hidden = open || !!ui.state?.replay;
    if (!open) { lade.innerHTML = ''; vorigeHtml = ''; } // leeg: de tutorial wijst dan naar de knop in het paneel
    else vulLade(stand);
    const h = open ? lade.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty('--lade-h', `${h}px`);
  }

  function vulLade(stand) {
    const s = ui.state;
    if (!s) return;
    let html;
    if (stand === 'plaats') {
      const g = s.pack.gebouwIndex[b.gebouw];
      const st = (b.status = plaatsStatus(s, b.gebouw, b.tegel)); // elke keer opnieuw: voorraden en projecten veranderen
      if (b.tegel < 0 && b.gebied != null && st.zin === TEKST.kiesVakje && gebiedCentra(s, s.speler).length > 1) st.zin = TEKST.geenPlekIn(gebiedNaam(s, b.gebied)); // C17c
      const kosten = g ? Object.entries(sim.bouwKosten(s, s.landen[s.speler], g.id)).map(([r, v]) => `${v}${esc(s.pack.resIndex[r]?.icoon ?? r)}`).join(' ') : '';
      html = `<div class="pb-balk"><button type="button" class="pb-nee" data-lade="annuleer" aria-label="Stop met plaatsen">✗</button>`
        + `<div class="pb-midden"><span class="pb-ico" aria-hidden="true">${g?.icoon ?? ''}</span><span class="pb-tekst"><b>${esc(g?.naam ?? '')}</b> <span class="zacht">${kosten}</span>`
        + `<span class="pb-status ${st.niveau}">${esc(st.zin)}</span></span></div>`
        + `<button type="button" class="pb-ja" data-lade="bevestig" aria-label="Bouw hier"${st.ok && !s.replay ? '' : ' disabled'}>✓</button></div>`;
    } else {
      const k = ladeKosten(s);
      const c = s.landen[s.speler];
      const projecten = c.bouw.slice().reverse().map((x) => {
        const g = s.pack.gebouwIndex[x.gebouw];
        return `<button type="button" class="bl-project" data-plek="${x.tegel}" title="Naar de bouwplek">${g?.icoon ?? ''} ${esc(g?.naam ?? '')} · ${Math.max(0, x.klaar - s.dag)} d</button>`;
      }).join('');
      // C17c: met kolonies "Bouwen in: …", de wachtrijen en vooraan "Bouw zoals thuis" als je een kolonie bekijkt.
      const meer = gebiedCentra(s, s.speler).length > 1;
      const g = meer ? b.gebiedNu() : null;
      const gebiedKnop = g != null ? `<button type="button" class="bl-project bl-gebied" data-lade="gebied" aria-label="Kies waar je bouwt">${TEKST.bouwenIn} <b>${esc(gebiedNaam(s, g))}</b> ▾</button>` : '';
      const rijen = Object.keys(c.bouwrij ?? {}).map((k) => `<span class="bl-rij">${esc(TEKST.wachtrij(gebiedNaam(s, +k), c.bouwrij[k].items.length))}`
        + `<button type="button" class="bl-rij-stop" data-lade="rij-stop" data-gebied="${k}" aria-label="Stop de wachtrij"${s.replay ? ' disabled' : ''}>✕</button></span>`).join('');
      const melding = b.melding ? `<span class="bl-melding">${esc(b.melding)}</span>` : '';
      const kaarten = (g != null && isKolonie(s, g) && b.tab !== 'leger' ? zoalsThuisKaartHtml(s, g) : '') + ladeKaarten(s, b.tab).map((x) => kaartHtml(s, x)).join('');
      html = `<div class="bl-greep" aria-hidden="true"></div>`
        + `<div class="bl-kop" role="tablist">${TABS.map((t) => `<button type="button" role="tab" class="bl-tab${t.id === b.tab ? ' actief' : ''}" data-lade-tab="${t.id}" aria-selected="${t.id === b.tab}">${t.naam}</button>`).join('')}`
        + `<button type="button" class="bl-dicht" data-lade="sluit" aria-label="Lade sluiten">✕</button></div>`
        + `<div class="bl-regel-rij">${gebiedKnop}${melding}<span class="bl-heb">${esc(k.tekst)}</span>${projecten}${rijen}</div>`
        + `<div class="bl-strook">${kaarten}</div>`;
    }
    if (html !== vorigeHtml) {
      const strook = lade.querySelector('.bl-strook');
      const x = strook?.scrollLeft ?? 0;
      lade.innerHTML = html;
      vorigeHtml = html;
      const nieuw = lade.querySelector('.bl-strook');
      if (nieuw && x) nieuw.scrollLeft = x;
    }
  }

  function render(s) {
    if (!s) return;
    const c = s.landen[s.speler];
    const n = c.bouw.length + actieveVerbouw(c); // zoals de engine telt (afspraak 7)
    const tel = n ? `${n}/${s.pack.model.max_bouw}` : '';
    const telEl = knop.querySelector('.bk-tel');
    if (telEl && telEl.textContent !== tel) telEl.textContent = tel;
    knop.hidden = b.stand !== 'dicht' || !!s.replay; // review: in replay valt er niets te bouwen
    // Review: draait het scherm naar liggend (> 600 px), dan ook de vaste kaart, de ruimtehouder en de lade-inhoud
    // opruimen; anders stonden die bij terugdraaien nog als spook over de pagina tot de volgende renderUI.
    if (!TELEFOON.matches) { if (b.stand !== 'dicht') b.sluit(); if (wrap.classList.contains('lade-vast') || !lade.hidden) zetVast('dicht'); return; }
    zetVast(b.stand);
    if (ui.kaart && b.stand !== 'dicht') ui.kaart.zichtOnder = lade.getBoundingClientRect().height;
  }

  knop.addEventListener('click', () => { if (ui.state) b.open(); });
  lade.addEventListener('click', (e) => {
    const t = e.target.closest('[data-lade-tab]');
    if (t) { b.zetTab(t.dataset.ladeTab); return; }
    const a = e.target.closest('[data-lade]');
    if (!a || a.disabled) return;
    if (a.dataset.lade === 'annuleer') b.annuleer();
    if (a.dataset.lade === 'bevestig') b.bevestig();
    if (a.dataset.lade === 'sluit') b.sluit();
    if (a.dataset.lade === 'gebied') api.openGebieden?.(a); // C17c: hetzelfde lijstje als de ⌂-knop
    if (a.dataset.lade === 'rij-stop') api.geef({ type: 'bouwrij', gebied: +a.dataset.gebied, items: [] });
  });

  // Naar beneden vegen over de greep, de kop of de plaatsbalk sluit de lade (patroon van het contextpaneel).
  let veeg = null;
  lade.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.bl-strook, .pb-ja, .pb-nee, .bl-project, .bl-regel-rij')) return;
    veeg = { y: e.clientY, id: e.pointerId, dy: 0 };
  });
  lade.addEventListener('pointermove', (e) => {
    if (!veeg || e.pointerId !== veeg.id) return;
    veeg.dy = e.clientY - veeg.y;
    if (veeg.dy > 8) { try { lade.setPointerCapture(e.pointerId); } catch { /* al los */ } lade.style.transform = `translateY(${Math.max(0, veeg.dy)}px)`; }
  });
  const los = (e) => {
    if (!veeg || e.pointerId !== veeg.id) return;
    const dy = veeg.dy;
    veeg = null;
    lade.style.transform = '';
    if (dy > VEEG_DICHT) b.sluit();
  };
  lade.addEventListener('pointerup', los);
  lade.addEventListener('pointercancel', los);
  TELEFOON.addEventListener?.('change', () => { if (!TELEFOON.matches) b.sluit(); });

  b.render = render;
  b.kaartInBeeld = kaartInBeeld;
  return b;
}
