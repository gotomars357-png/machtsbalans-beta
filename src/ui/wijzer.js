// C17b: aanwijzingen (docs/c17-plan.md, "c17b-wijzer"). Af en toe wijst het spel één ding aan dat de balans herstelt,
// zegt waar het is en brengt je er met één tik heen, met de juiste actie klaar.
//
// Twee delen:
// 1. Puur (geen DOM, geen klok, geen toeval; draait in node, tools/wijzertest.mjs): kandidaten, kiesWijzer, bouwPlek
//    en bijhouden. Ze lezen de spelstand en veranderen hem nooit. De tijd (nuMs) komt van buiten, via ctx.
// 2. maakWijzer(api): het kaartje, "Ga erheen", wegtikken, het randpijltje en de schakelaar. Er gaat hier geen order
//    uit: bouwen loopt via de lade (✓) of de bouwbalk, "Bouw zoals thuis" via het paneel van gebieden.js.
//
// Rolverdeling: de doelbalk (doelen.js) is het lange doel, het oplosser-kaartje (evenwicht.js) de uitleg op verzoek, de
// wijzer het korte "nu even dit, daar". Wat de doelbalk al toont (zelfde id in `dekt`), slaat de wijzer over.

import * as sim from '../engine/sim.js';
import * as leger from '../engine/leger.js';
import { gebiedCentra, gebiedVan } from '../engine/gebieden.js';
import { tegelAfstand } from '../engine/geografie.js';
import { woningCapaciteit } from '../engine/samenleving.js';
import { toestand, oplossers, bouwKaartData, actieveVerbouw } from './evenwicht.js';
import { aanbevolen } from './bouwlade.js';
import { besteGebouw, brandhaardDoel } from './doelen.js';
import { gebiedNaam, gebiedenVan, zoalsThuis } from './gebieden.js';
import * as onderpaneel from './onderpaneel.js';

// ---------- getallen (echte tijd in ms, speltijd in dagen) ----------
export const AFKOEL_MS = 90000;        // tussen twee kaartjes minstens zo lang
export const HERHAAL_MS = 300000;      // hetzelfde onderwerp niet opnieuw binnen 300 s ...
export const HERHAAL_DAGEN = 60;       // ... en niet binnen 60 speeldagen
export const WEG_DAGEN = 150;          // weggetikt: zo lang niet terug (voor dit potje)
export const ZELF_WEG_MS = 12000;      // niet getikt: na 12 s vanzelf weg
export const STIL_DAGEN = 15;          // bouwers staan zo lang stil voor we iets zeggen
export const VOL_DAGEN = 10;           // opslag zo lang vol voor we iets zeggen
export const STIL_NA_START_MS = 10000; // eerste 10 s na start of hervatten: rust
export const KOLONIE_DAGEN = 10;       // een kolonie is pas na zoveel dagen "leeg"
export const KOLONIE_VRIJ = 3;         // en heeft dan minstens zoveel vrije plekken
export const DREIGING_AFSTAND = 3;     // vijandelijke eenheden binnen zoveel vakjes van eigen grond
export const OPSLAG_WEG = 'machtsbalans.wijzer';     // weggetikte onderwerpen, per pack en seed
export const OPSLAG_AAN = 'machtsbalans.wijzer-aan'; // de schakelaar "Aanwijzingen"
const SMAL = '(max-width: 600px)';
const GLOED_MS = 6000;
const NAAR_ZOOM = 3.5;

// ---------- teksten (kort en gewoon; elke zin heeft een terugval) ----------
export const TEKST = {
  knop: 'Ga erheen',
  waarom: 'Waarom?',
  weg: 'Wegtikken',
  schakelaar: 'Aanwijzingen (af en toe een tip waar je heen moet)',
  thuis: 'thuis',
  in: (naam) => `in ${naam}`,
  gebouw: 'gebouw',
  grondstof: 'grondstof',
  land: 'de vijand',
  rood: (res, g, waar) => `${res} is op: je productie valt stil. Bouw een ${g}, ${waar}.`,
  oranje: (res, n, g, waar) => `${res} raakt op over ${n} ${n === 1 ? 'dag' : 'dagen'}. Bouw een ${g}, ${waar}.`,
  vijand: (naam, richting) => `Troepen van ${naam} staan bij je grens${richting ? ` in het ${richting}` : ''}. Kijk in Leger wat je kunt doen.`,
  brandhaard: (titel) => `${titel}. Tik op de plek en kies wat je doet.`,
  kolonie: (naam) => `${naam} staat nog leeg. Bouw er zoals thuis.`,
  stilWonen: (g) => `Je bouwers staan stil. Een ${g} laat je bevolking groeien.`,
  stilGroei: (g) => `Je bouwers staan stil. Een ${g} laat je productie groeien.`,
  stilTekort: (g) => `Je bouwers staan stil. Een ${g} lost een tekort op.`,
  volOpslag: (res, g) => `Je opslag voor ${res} is vol: wat erbij komt, gaat verloren. Een ${g} geeft meer ruimte.`,
  volVerbruik: (res, g) => `Je opslag voor ${res} is vol: wat erbij komt, gaat verloren. Een ${g} gebruikt het.`,
};
const RICHTING = ['oosten', 'zuidoosten', 'zuiden', 'zuidwesten', 'westen', 'noordwesten', 'noorden', 'noordoosten'];
const ICOON = { tekort: '⚠', dreiging: '⚔', brandhaard: '🔥', kolonie: '🚩', stil: '🔨', vol: '📦' };

const spelerVan = (s) => s.landen[s.speler];
const rond = (v) => Math.round(v);
const geenGat = (t) => String(t ?? '').replace(/\b(undefined|NaN|null)\b/g, '').replace(/\s{2,}/g, ' ').trim();

// ---------- puur: plek en gebied ----------

// Waar bouw je dit gebouw het best? Per eigen gebied de plek die kiesTegel(…, gebied) kiest; het gebied met het hoogste
// rendement wint, bij gelijk het bekeken gebied, dan thuis. Zonder gebieden gewoon kiesTegel. → { gebied, tegel }
export function bouwPlek(s, gebouwId, bekeken = -1) {
  const c = spelerVan(s);
  const centra = gebiedCentra(s, s.speler);
  if (!centra.length) return { gebied: -1, tegel: sim.kiesTegel(s, c, gebouwId) };
  const volg = centra.includes(bekeken) ? [bekeken, ...centra.filter((g) => g !== bekeken)] : centra;
  let best = null;
  for (let i = 0; i < volg.length; i++) {
    const t = sim.kiesTegel(s, c, gebouwId, volg[i]);
    if (t < 0) continue;
    const r = sim.rendement(s, c, gebouwId, t);
    if (!best || r > best.r + 1e-9) best = { gebied: volg[i], tegel: t, r };
  }
  return best ? { gebied: best.gebied, tegel: best.tegel } : { gebied: -1, tegel: -1 };
}

function waarTekst(s, gebied) {
  if (gebied < 0 || gebied === s.pack.geo.hoofdstad[s.speler]) return TEKST.thuis;
  return TEKST.in(gebiedNaam(s, gebied));
}

function richtingVan(s, t) {
  const h = s.pack.geo.hoofdstad[s.speler];
  const a = s.pack.geo.tegels[h];
  const b = s.pack.geo.tegels[t];
  if (!a || !b) return '';
  const dx = b.x - a.x;
  const dy = b.y - a.y; // y loopt naar het zuiden
  if (!dx && !dy) return '';
  const hoek = Math.atan2(dy, dx);
  return RICHTING[((Math.round(hoek / (Math.PI / 4)) % 8) + 8) % 8];
}

// Iets wat al gebouwd wordt en grondstof r maakt: dan zeuren we niet over een tekort aan r.
function komtAl(s, r) {
  const c = spelerVan(s);
  for (let i = 0; i < c.bouw.length; i++) if ((s.pack.gebouwIndex[c.bouw[i].gebouw]?.productie?.[r] ?? 0) > 0) return true;
  return false;
}

function resNaam(s, r) { return s.pack.resIndex[r]?.naam ?? TEKST.grondstof; }
function gebouwNaam(s, id) { return s.pack.gebouwIndex[id]?.naam ?? TEKST.gebouw; }

// Een bouwkandidaat voor een gebouw dat je nu kunt neerzetten, of null.
function bouwKandidaat(s, ctx, gebouwId, velden) {
  if (!gebouwId || !bouwKaartData(s, gebouwId, ctx.lijst).kan) return null;
  const p = bouwPlek(s, gebouwId, ctx.bekekenGebied ?? -1);
  if (p.tegel < 0) return null;
  return { knop: TEKST.knop, gebied: p.gebied, tegel: p.tegel, actie: { type: 'bouw', gebouw: gebouwId }, ...velden(p) };
}

// ---------- puur: de kandidaten in volgorde van belang ----------

function tekortKandidaten(s, ctx, niveau) {
  const R = s.pack.rollen;
  const uit = [];
  for (let i = 0; i < ctx.lijst.length; i++) {
    const x = ctx.lijst[i];
    if (x.niveau !== niveau || x.r === R.geld || x.r === R.stabiliteit || komtAl(s, x.r)) continue;
    const o = oplossers(s, x.r, 1, ctx.lijst)[0];
    if (!o?.kan) continue;
    const icoon = x.icoon || ICOON.tekort;
    const k = bouwKandidaat(s, ctx, o.gebouw, (p) => ({
      sleutel: `tekort:${x.r}`, soort: niveau === 'rood' ? 'tekort-rood' : 'tekort', icoon, dekt: `tekort:${x.r}`,
      zin: niveau === 'rood' ? TEKST.rood(resNaam(s, x.r), gebouwNaam(s, o.gebouw), waarTekst(s, p.gebied))
        : TEKST.oranje(resNaam(s, x.r), Math.max(1, rond(isFinite(x.dagen) ? x.dagen : 1)), gebouwNaam(s, o.gebouw), waarTekst(s, p.gebied)),
      r: x.r, waarom: { type: 'oplosser', r: x.r },
    }));
    if (k) uit.push(k);
  }
  return uit;
}

function dreigingKandidaten(s) {
  const c = spelerVan(s);
  const geo = s.pack.geo;
  const eigen = s.landTegels[s.speler];
  const uit = [];
  const gezien = {};
  for (let i = 0; i < s.eenheden.length; i++) {
    const u = s.eenheden[i];
    if (u.land === s.speler || gezien[u.land] || !(u.t >= 0) || !leger.inOorlog(s, s.landen[u.land], c)) continue;
    let dicht = s.eigenaar[u.t] === s.speler;
    for (let j = 0; !dicht && j < eigen.length; j++) if (tegelAfstand(geo, eigen[j], u.t) <= DREIGING_AFSTAND) dicht = true;
    if (!dicht) continue;
    gezien[u.land] = true;
    uit.push({
      sleutel: `vijand:${u.land}`, soort: 'dreiging', icoon: ICOON.dreiging, dekt: null, knop: TEKST.knop,
      zin: TEKST.vijand(s.landen[u.land]?.naam ?? TEKST.land, richtingVan(s, u.t)),
      gebied: gebiedVan(s, s.speler, u.t), tegel: u.t, actie: { type: 'tab', tab: 'leger' },
    });
  }
  const h = brandhaardDoel(s);
  if (h?.naar?.tegel != null && h.naar.tegel >= 0) {
    uit.push({
      sleutel: h.id, soort: 'brandhaard', icoon: ICOON.brandhaard, dekt: h.id, knop: TEKST.knop,
      zin: TEKST.brandhaard(h.titel), gebied: gebiedVan(s, s.speler, h.naar.tegel), tegel: h.naar.tegel, actie: { type: 'kijk' },
    });
  }
  return uit;
}

function kolonieKandidaten(s) {
  const c = spelerVan(s);
  const uit = [];
  let lijst = null;
  for (let i = 0; i < s.kolonies.length; i++) {
    const k = s.kolonies[i];
    if (k.land !== s.speler || s.dag - (k.dag ?? 0) < KOLONIE_DAGEN || c.bouwrij?.[k.t]) continue;
    lijst ??= gebiedenVan(s);
    const g = lijst.find((x) => x.centrum === k.t);
    if (!g || g.gebouwen > 0 || g.vrij < KOLONIE_VRIJ || g.rij) continue;
    let inBouw = false;
    for (let j = 0; j < c.bouw.length; j++) if (gebiedVan(s, s.speler, c.bouw[j].tegel) === k.t) inBouw = true;
    if (inBouw || !zoalsThuis(s, k.t)?.items.length) continue;
    uit.push({
      sleutel: `kolonie:${k.t}`, soort: 'kolonie', icoon: ICOON.kolonie, dekt: null, knop: TEKST.knop,
      zin: TEKST.kolonie(k.naam ?? gebiedNaam(s, k.t)), gebied: k.t, tegel: k.t, actie: { type: 'zoalsthuis' },
    });
  }
  return uit;
}

function stilKandidaat(s, ctx) {
  const c = spelerVan(s);
  if (c.bouw.length + actieveVerbouw(c) > 0 || ctx.stilSinds == null || s.dag - ctx.stilSinds < STIL_DAGEN) return [];
  let id = null;
  let zin = null;
  let dekt = null;
  const adv = aanbevolen(s, ctx.lijst);
  if (adv && bouwKaartData(s, adv.gebouw, ctx.lijst).kan) { id = adv.gebouw; zin = TEKST.stilTekort; dekt = `tekort:${adv.r}`; }
  if (!id && c.L >= woningCapaciteit(s, c) * 0.97) {
    const g = besteGebouw(s, (x) => x.woningen > 0, (x) => x.woningen);
    if (g) { id = g.id; zin = TEKST.stilWonen; dekt = 'wonen'; }
  }
  if (!id) {
    const g = besteGebouw(s, (x) => x.kapitaalvoorraad > 0 && !x.knooppunt && !x.categorie, (x) => x.kapitaalvoorraad);
    if (g) { id = g.id; zin = TEKST.stilGroei; dekt = 'groei'; }
  }
  const k = id && bouwKandidaat(s, ctx, id, () => ({ sleutel: 'stil', soort: 'stil', icoon: ICOON.stil, dekt, zin: zin(gebouwNaam(s, id)) }));
  return k ? [k] : [];
}

function volKandidaten(s, ctx) {
  const uit = [];
  for (let i = 0; i < ctx.lijst.length; i++) {
    const x = ctx.lijst[i];
    const sinds = ctx.volSinds?.[x.r];
    if (x.niveau !== 'goud' || sinds == null || s.dag - sinds < VOL_DAGEN) continue;
    const o = oplossers(s, x.r, 1, ctx.lijst)[0];
    if (!o?.kan) continue;
    const res = resNaam(s, x.r).toLowerCase();
    const k = bouwKandidaat(s, ctx, o.gebouw, () => ({
      sleutel: `vol:${x.r}`, soort: 'vol', icoon: x.icoon || ICOON.vol, dekt: null, r: x.r, waarom: { type: 'oplosser', r: x.r },
      zin: (o.soort === 'opslag' ? TEKST.volOpslag : TEKST.volVerbruik)(res, gebouwNaam(s, o.gebouw)),
    }));
    if (k) uit.push(k);
  }
  return uit;
}

// Alle kandidaten in volgorde van belang: rood tekort, dreiging met een plek, oranje tekort, lege kolonie, stilstaande
// bouwers, volle opslag. mag(k) filtert (doelbalk, afkoelen, weggetikt); max stopt zodra er genoeg zijn (scheelt
// rekenwerk). ctx: { lijst?, bekekenGebied, stilSinds, volSinds }. Elke kandidaat:
// { sleutel, soort, icoon, zin, knop, dekt, gebied, tegel, actie: { type: 'bouw'|'zoalsthuis'|'tab'|'kijk', gebouw?, tab? }, waarom? }
export function kandidaten(s, ctx = {}, mag = () => true, max = Infinity) {
  if (!s || s.uitkomst) return [];
  const c = { ...ctx, lijst: ctx.lijst ?? toestand(s) };
  const stappen = [
    () => tekortKandidaten(s, c, 'rood'),
    () => dreigingKandidaten(s),
    () => tekortKandidaten(s, c, 'oranje'),
    () => kolonieKandidaten(s),
    () => stilKandidaat(s, c),
    () => volKandidaten(s, c),
  ];
  const uit = [];
  for (let i = 0; i < stappen.length && uit.length < max; i++) {
    const lijst = stappen[i]();
    for (let j = 0; j < lijst.length && uit.length < max; j++) {
      const k = lijst[j];
      k.zin = geenGat(k.zin);
      if (mag(k)) uit.push(k);
    }
  }
  return uit;
}

// Mag deze kandidaat nu? Niet wat de doelbalk al toont, niet weggetikt (WEG_DAGEN), niet kort na de vorige keer.
export function magTonen(s, k, ctx) {
  if (k.dekt && k.dekt === ctx.doelId) return false;
  const w = ctx.weg?.[k.sleutel];
  // Review: een dag ná vandaag komt uit een ander potje met dezelfde pack en seed (de seed staat standaard op 2026).
  if (w != null && w <= s.dag && s.dag - w < WEG_DAGEN) return false;
  const g = ctx.getoond?.[k.sleutel];
  if (g && ((ctx.nuMs ?? 0) - g.ms < HERHAAL_MS || s.dag - g.dag < HERHAAL_DAGEN)) return false;
  return true;
}

// Het ene kaartje dat nu getoond mag worden, of null. ctx: { doelId, weg: {sleutel: dag}, getoond: {sleutel: {dag, ms}},
// nuMs, laatsteMs, bekekenGebied, stilSinds, volSinds, lijst? }.
export function kiesWijzer(s, ctx = {}) {
  if (!s || s.uitkomst) return null;
  if (ctx.laatsteMs != null && (ctx.nuMs ?? 0) - ctx.laatsteMs < AFKOEL_MS) return null;
  return kandidaten(s, ctx, (k) => magTonen(s, k, ctx), 1)[0] ?? null;
}

// Houdt buiten de spelstand bij sinds wanneer de bouwers stilstaan en een opslag vol is (één keer per speldag).
// mem: { dag, stilSinds, volSinds: {r: dag} }. Een nieuw of geladen potje (dag terug) begint opnieuw.
export function bijhouden(s, mem, lijst = null) {
  if (!s) return mem;
  if (mem.dag != null && s.dag < mem.dag) { mem.dag = null; mem.stilSinds = null; mem.volSinds = {}; }
  if (mem.dag === s.dag) return mem;
  mem.dag = s.dag;
  mem.volSinds ??= {};
  const c = spelerVan(s);
  if (c.bouw.length + actieveVerbouw(c) > 0) mem.stilSinds = null;
  else mem.stilSinds ??= s.dag;
  const l = lijst ?? toestand(s);
  for (let i = 0; i < l.length; i++) {
    if (l[i].niveau === 'goud') mem.volSinds[l[i].r] ??= s.dag;
    else delete mem.volSinds[l[i].r];
  }
  return mem;
}

// ---------- DOM: het kaartje ----------
// api uit main.js: { ui, bouwlade, gebieden, evenwicht, doelbalk, startBouwModus, zetTab }. Geen orders.

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const lees = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const schrijf = (k, v) => { try { localStorage.setItem(k, v); } catch { /* privé venster */ } };

export function isAan() { return lees(OPSLAG_AAN) !== 'uit'; }

export function maakWijzer(api) {
  const { ui } = api;
  const $ = (q) => document.querySelector(q);
  const wrap = $('#kaart-wrap');
  if (!wrap) return null;
  const TELEFOON = window.matchMedia(SMAL);

  const el = document.createElement('div');
  el.id = 'wijzer';
  el.className = 'wijzer';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="wz-tekst"><span class="wz-ico" aria-hidden="true"></span><span class="wz-zin"></span></div>`
    + `<div class="wz-knoppen"><button type="button" class="wz-ga" data-wz="ga">${TEKST.knop}</button>`
    + `<button type="button" class="wz-waarom" data-wz="waarom">${TEKST.waarom}</button>`
    + `<button type="button" class="wz-weg" data-wz="weg" aria-label="${TEKST.weg}" title="${TEKST.weg}">✕</button></div>`;
  wrap.append(el);
  const pijl = document.createElement('div');
  pijl.className = 'wijzer-pijl';
  pijl.hidden = true;
  pijl.setAttribute('aria-hidden', 'true');
  pijl.textContent = '➤';
  wrap.append(pijl);

  const w = {
    aan: isAan(), state: null, mem: { dag: null, stilSinds: null, volSinds: {} },
    weg: {}, getoond: {}, laatsteMs: null, nu: 0, stilTot: 0, k: null, sinds: 0, tick: 0, fout: false, gloed: null, getoondTotaal: 0,
  };

  const potjeSleutel = (s) => `${s.pack.meta?.id ?? 'pack'}:${s.instellingen?.seed ?? 0}`;
  function leesWeg(s) {
    try { const alles = JSON.parse(lees(OPSLAG_WEG) || '{}'); return alles[potjeSleutel(s)] ?? {}; } catch { return {}; }
  }
  function bewaarWeg(s) {
    try {
      const alles = JSON.parse(lees(OPSLAG_WEG) || '{}');
      alles[potjeSleutel(s)] = w.weg;
      const sleutels = Object.keys(alles);
      while (sleutels.length > 12) delete alles[sleutels.shift()]; // niet eindeloos groeien
      schrijf(OPSLAG_WEG, JSON.stringify(alles));
    } catch { /* geen opslag */ }
  }

  function nieuwPotje(s, now) {
    w.state = s;
    w.mem = { dag: null, stilSinds: null, volSinds: {} };
    // Review: een vers potje (dag 0) begint zonder weggetikte onderwerpen, ook als een vorig potje dezelfde seed had.
    w.weg = s.dag > 0 ? leesWeg(s) : {};
    if (s.dag === 0) bewaarWeg(s);
    w.getoond = {};
    w.laatsteMs = null;
    w.stilTot = now + STIL_NA_START_MS;
    verberg();
  }

  // Wanneer het kaartje er niet mag zijn. Een open onderpaneel, de tutorial, een venster, plaatsen, gloed van de
  // doelbalk of tutorial, het pauzekaartje van c17a, een replay of het einde.
  function geblokkeerd(s) {
    return !s || s.replay || s.uitkomst || ui.tutorial || ui.tip || ui.modal || ui.bouwModus
      || onderpaneel.huidig() || api.gebieden?.open || $('#spel')?.hidden
      || document.body.classList.contains('bw-hervat-open') || !!document.querySelector('.db-gloed, .tut-gloed');
  }

  // Ligt de krant of de sessiekaart (vast onderin het scherm) over de plek van het kaartje? Dan wacht de wijzer.
  function bedekt() {
    const anderen = [...document.querySelectorAll('.krant-kaart, .sessiekaart')].filter((e) => e.getClientRects().length);
    if (!anderen.length) return false;
    const was = el.hidden;
    if (was) { el.style.visibility = 'hidden'; el.hidden = false; }
    const r = el.getBoundingClientRect();
    if (was) { el.hidden = true; el.style.visibility = ''; }
    return anderen.some((e) => { const b = e.getBoundingClientRect(); return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top; });
  }

  function toon(k, now) {
    const s = ui.state;
    w.k = k;
    w.sinds = now;
    w.laatsteMs = now;
    w.getoond[k.sleutel] = { dag: s.dag, ms: now };
    w.getoondTotaal += 1;
    el.querySelector('.wz-ico').textContent = k.icoon ?? '';
    el.querySelector('.wz-zin').textContent = k.zin;
    el.title = k.zin;
    el.querySelector('.wz-waarom').hidden = !k.waarom;
    el.dataset.soort = k.soort;
    el.hidden = false;
    plaatsPijl();
  }

  function verberg() {
    if (w.k) w.laatsteMs = w.nu; // het afkoelen telt vanaf het verdwijnen
    w.k = null;
    el.hidden = true;
    pijl.hidden = true;
  }

  // Het randpijltje: ligt de plek buiten beeld, dan wijst het aan de rand van de kaart die kant op.
  function plaatsPijl() {
    const k = w.k;
    const kaart = ui.kaart;
    const tg = k && ui.state?.pack.geo.tegels[k.tegel];
    if (!tg || !kaart?.w) { pijl.hidden = true; return; }
    const onder = Math.max(0, Math.min(kaart.zichtOnder || 0, kaart.h * 0.8));
    const [x, y] = kaart.naarScherm(tg.x, tg.y);
    const R = 24;
    const binnen = x >= R && y >= R && x <= kaart.w - R && y <= kaart.h - onder - R;
    if (binnen) { pijl.hidden = true; return; }
    const cx = kaart.w / 2;
    const cy = (kaart.h - onder) / 2;
    const dx = x - cx;
    const dy = y - cy;
    const f = Math.min(Math.abs(dx) > 0 ? (cx - R) / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? (cy - R) / Math.abs(dy) : Infinity);
    pijl.style.left = `${rond(cx + dx * f - 16)}px`;
    pijl.style.top = `${rond(cy + dy * f - 16)}px`;
    pijl.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    pijl.hidden = false;
  }

  function vlieg(t) {
    const s = ui.state;
    const tg = s?.pack.geo.tegels[t];
    const kaart = ui.kaart;
    if (!tg || !kaart) return;
    kaart.vliegNaar(tg.x, tg.y, Math.max(kaart.zoom ?? 1, NAAR_ZOOM));
  }

  function zetGloed(t) {
    if (!ui.kaart || !(t >= 0)) return;
    ui.kaart.gloed = { t };
    w.gloed = { t, tot: w.nu + GLOED_MS };
  }

  // Bouwen in gebied g op tegel t: op de telefoon de lade in plaatsmodus met het voorbeeld op de plek (de speler tikt
  // alleen nog ✓), op de desktop de bouwbalk en de camera naar de plek.
  function bouwDaar(id, gebied, t) {
    const s = ui.state;
    if (!s || s.replay || !s.pack.gebouwIndex[id]) return false;
    const lade = api.bouwlade;
    if (TELEFOON.matches && lade) {
      if (api.gebieden && gebied >= 0 && lade.stand !== 'plaats') api.gebieden.naarGebied(gebied, 'wissel');
      if (!lade.kies(id, gebied >= 0 ? { gebied } : {})) return false;
      if (gebied >= 0 && lade.stand === 'plaats' && lade.gebied !== gebied) lade.zetGebied(gebied);
      return true;
    }
    if (api.gebieden && gebied >= 0) api.gebieden.naarGebied(gebied, 'wissel');
    if (ui.bouwModus !== id) api.startBouwModus(id);
    vlieg(t);
    if (ui.kaart) ui.kaart.bouwKandidaat = t;
    zetGloed(t);
    ui.dirty = true;
    return true;
  }

  function voerUit(k) {
    const a = k.actie ?? {};
    if (a.type === 'bouw') return bouwDaar(a.gebouw, k.gebied, k.tegel);
    if (a.type === 'zoalsthuis') {
      if (!api.gebieden) return false;
      api.gebieden.naarGebied(k.gebied, 'wissel');
      return api.gebieden.openZoalsThuis(k.gebied);
    }
    if (a.type === 'tab' && a.tab && ui.tab !== a.tab) api.zetTab(a.tab);
    if (api.gebieden && k.gebied >= 0) api.gebieden.naarGebied(k.gebied, 'wissel');
    vlieg(k.tegel);
    zetGloed(k.tegel);
    return true;
  }

  // Ook voor de doelbalk op de telefoon: een tik op een bouwdoel gaat naar dezelfde plek, met het gebouw klaar.
  function gaNaar(naar) {
    const s = ui.state;
    if (!s || !naar?.gebouw) return false;
    const p = bouwPlek(s, naar.gebouw, api.gebieden?.huidig?.() ?? -1);
    if (p.tegel < 0) return false;
    verberg();
    return bouwDaar(naar.gebouw, p.gebied, p.tegel);
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-wz]');
    const k = w.k;
    if (!b || !k) return;
    const s = ui.state;
    if (b.dataset.wz === 'weg') {
      if (s) { w.weg[k.sleutel] = s.dag; bewaarWeg(s); }
      verberg();
    } else if (b.dataset.wz === 'ga') {
      verberg();
      voerUit(k);
    } else if (b.dataset.wz === 'waarom' && k.waarom?.r) {
      verberg();
      api.evenwicht?.open(k.waarom.r);
    }
  });

  function stap(now) {
    const s = ui.state;
    if (!s) { verberg(); return; }
    if (s !== w.state) nieuwPotje(s, now);
    if (w.gloed && now > w.gloed.tot) { if (ui.kaart?.gloed?.t === w.gloed.t && !ui.tutorial && !ui.tip) ui.kaart.gloed = null; w.gloed = null; }
    if (w.k) { if (geblokkeerd(s) || !w.aan || now - w.sinds > ZELF_WEG_MS || bedekt()) verberg(); return; }
    if (now - w.tick < 1000) return; // hooguit één keer per seconde echt rekenen
    w.tick = now;
    const lijst = toestand(s);
    bijhouden(s, w.mem, lijst); // ook als er niets getoond mag worden: "stil sinds" en "vol sinds" lopen door
    if (geblokkeerd(s) || !w.aan || now < w.stilTot || bedekt()) return;
    const k = kiesWijzer(s, {
      doelId: api.doelbalk?.huidig?.()?.id ?? null, weg: w.weg, getoond: w.getoond, nuMs: now, laatsteMs: w.laatsteMs,
      bekekenGebied: api.gebieden?.huidig?.() ?? -1, stilSinds: w.mem.stilSinds, volSinds: w.mem.volSinds, lijst,
    });
    if (k) toon(k, now);
  }

  // Een eigen lus (één keer per seconde rekenen, elk beeld het pijltje en de blokkades): frame() in main.js blijft gelijk.
  // De tijd komt uit requestAnimationFrame (zelfde klok als map.js); de wijzer heeft geen eigen klok.
  function lus(now) {
    requestAnimationFrame(lus);
    w.nu = now;
    if (w.fout) return;
    try {
      stap(now);
      if (w.k) plaatsPijl();
    } catch (err) {
      w.fout = true;
      verberg();
      console.error('wijzer', err);
    }
  }
  requestAnimationFrame(lus);

  window.addEventListener('hervat', () => { w.stilTot = w.nu + STIL_NA_START_MS; verberg(); });
  api.doelbalk?.zetBouwNaar?.((naar) => gaNaar(naar));

  // De schakelaar: in het spelmenu (menuHtml/bindMenu) en op het startscherm (#opt-wijzer).
  function zetAan(aan) {
    w.aan = !!aan;
    schrijf(OPSLAG_AAN, w.aan ? 'aan' : 'uit');
    const opt = $('#opt-wijzer');
    if (opt) opt.checked = w.aan;
    if (!w.aan) verberg();
  }
  const opt = $('#opt-wijzer');
  if (opt) { opt.checked = w.aan; opt.addEventListener('change', () => zetAan(opt.checked)); }
  const menuHtml = () => `<label class="check wz-schakel"><input type="checkbox" id="m-wijzer" ${w.aan ? 'checked' : ''}> ${esc(TEKST.schakelaar)}</label>`;
  const bindMenu = (root) => { const i = root.querySelector('#m-wijzer'); if (i) i.onchange = () => zetAan(i.checked); };

  return { gaNaar, zetAan, menuHtml, bindMenu, huidig: () => w.k, open: () => !el.hidden, geheugen: w };
}
