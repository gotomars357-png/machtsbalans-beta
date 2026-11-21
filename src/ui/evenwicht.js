// Evenwichtsbalk (C16a, docs/c16-plan.md "c16a-evenwicht"): per grondstof een chip met voorraad, trend, "nog x d" en een
// vulbalkje, links een meter met het ergste probleem, en een oplosser-kaartje dat van een tekort in twee tikken naar
// een gebouw brengt dat het oplost.
//
// Twee delen:
// 1. Rekenfuncties (toestand, uitsplitsing, oplossers, effectVan, ergste, bouwKaartData): puur, zonder DOM, zonder
//    toeval of klok, en ze veranderen niets aan de spelstand. Ze draaien ook headless (tools/evenwichttest.mjs).
//    bouwKaartData is de gedeelde bron voor de bouwkaarten van c16b (lade) en c16c (bouwlijst).
// 2. maakEvenwicht(api): de DOM-kant (chips, meter, kaartje, --topbalk-h). Geeft zelf geen orders: "Bouw" start
//    alleen de plaatsmodus via main.js (data-actie="oplos-bouw").

import * as sim from '../engine/sim.js';
import { actieveVerbouw } from '../engine/verbouw.js';
import * as onderpaneel from './onderpaneel.js';

export { actieveVerbouw }; // main.js telt projecten met dezelfde helper (afspraak 7)

// ---------- UI-constanten (geen spelregels: die staan in het pack of in defaults.js) ----------
export const WAARSCHUW_DAGEN_STANDAARD = 30; // oranje als een grondstof binnen zoveel dagen op is (pack: waarschuw_dagen)
export const AANBEVOLEN_MAX = 3; // zoveel oplossers op het kaartje
const GLIJ_DAGEN = 5; // "dagen tot leeg" rekent met het gemiddelde netto van de laatste 5 speldagen
const VOL_MARGE = 0.98; // opslag telt als vol vanaf 98%
const STAB_ROOD = 30;
const STAB_ORANJE = 40;
const PULS_MS = 600;
export const TERUGVAL = {
  tekort: 'Raakt dit op, dan kun je minder bouwen en loopt je land achter.',
  geld: 'Onder nul betaal je rente over je schuld en wordt je volk onrustig. Bouw dan even niets bij.',
  stab: 'Onder 30 dreigen onrust en de val van je regering.',
  vol: 'Je opslag is vol: wat er nog bij komt, gaat verloren.',
  vol_tip: 'Bouw extra opslag, iets dat dit verbruikt, of bouw voorlopig minder van wat het maakt.',
  geld_tip: 'Of verhoog de belasting in Economie, en bouw even niets bij.',
  stab_tip: 'Verlaag de belasting of verhoog de sociale verdeling in Economie.',
};
const NIVEAU_RANG = { rood: 3, oranje: 2, goud: 1, neutraal: 0 };

const rond = (v) => Math.round(v);
const komma = (v, d = 1) => v.toFixed(d).replace('.', ',');
// Trendgetal zoals in de balk: één decimaal onder de 10, anders heel.
export const getal = (n) => { const a = Math.abs(n); return a >= 10 ? String(rond(a)) : komma(a, 1); };
export const teken = (n) => (n > 0.05 ? '+' : n < -0.05 ? '−' : '±');

function spelerVan(s) { return s.landen[s.speler]; }

// ---------- glijdend gemiddelde (buiten de spelstand) ----------
// Per spelstand een geheugen: { dag, waarden: Map(resId -> [netto ...]) }. Alleen bij een nieuwe speldag komt er een
// meting bij, zodat een korte dip geen vals alarm geeft. De spelstand zelf wordt nooit aangeraakt.
const geheugen = new WeakMap();

function nettoNu(s, c, r) {
  const R = s.pack.rollen;
  if (r.id === R.geld) return c.inkomen ?? 0;
  if (r.id === R.stabiliteit) return ((c.stabDoel ?? c.stab) - c.stab) * (s.pack.model.stab_snelheid ?? 0.03);
  return c.netto?.[r.id] ?? 0;
}

function glijdend(s, c, r) {
  let g = geheugen.get(s);
  if (!g || s.dag < g.dag || g.speler !== s.speler) { g = { dag: -1, speler: s.speler, waarden: new Map() }; geheugen.set(s, g); }
  if (g.dag !== s.dag) {
    g.dag = s.dag;
    for (let i = 0; i < s.pack.resources.length; i++) {
      const x = s.pack.resources[i];
      const rij = g.waarden.get(x.id) ?? [];
      rij.push(nettoNu(s, c, x));
      while (rij.length > GLIJ_DAGEN) rij.shift();
      g.waarden.set(x.id, rij);
    }
  }
  const rij = g.waarden.get(r.id);
  if (!rij?.length) return nettoNu(s, c, r);
  let som = 0;
  for (let i = 0; i < rij.length; i++) som += rij[i];
  return som / rij.length;
}

// Wat gebouwen bruto maken en wat er gevraagd wordt (zoals economieTick, zonder schokken en zonder de rem van een
// tekort). Bij een tekort is c.netto rond nul (de voorraad is op); de echte balans is dan maakt − vraag.
function brutoBalans(s, c, rid) {
  const P = s.pack;
  let maakt = 0;
  for (let i = 0; i < P.gebouwen.length; i++) {
    const g = P.gebouwen[i];
    const v = g.productie?.[rid];
    if (v) maakt += (c.effSom?.[g.id] || 0) * v;
  }
  const vraag = c.vraag?.[rid] ?? 0;
  return { maakt, vraag, balans: maakt - vraag };
}

// ---------- toestand ----------

// Per ontgrendelde grondstof: voorraad, opslag, trend (per dag), dagen tot leeg en een niveau.
// Niveaus: rood (ratio < 1: de productie valt stil; kapitaal onder nul; stabiliteit onder 30), oranje (leeg binnen
// waarschuw_dagen), goud (opslag vol en de trend positief) en neutraal.
export function toestand(s) {
  const c = spelerVan(s);
  const P = s.pack;
  const R = P.rollen;
  const uit = [];
  for (let i = 0; i < P.resources.length; i++) {
    const r = P.resources[i];
    if (!sim.isOntgrendeld(s, r.id)) continue;
    const waarschuw = r.waarschuw_dagen ?? WAARSCHUW_DAGEN_STANDAARD;
    const item = { r: r.id, naam: r.naam, icoon: r.icoon ?? '', rol: r.rol, waarschuw, voorraad: 0, cap: Infinity, vulling: null, netto: 0, trend: 0, dagen: Infinity, ratio: 1, niveau: 'neutraal', kort: '' };
    if (r.id === R.stabiliteit) {
      item.voorraad = c.stab;
      item.doel = c.stabDoel ?? c.stab;
      item.cap = 100;
      item.vulling = c.stab / 100;
      item.netto = nettoNu(s, c, r);
      item.trend = item.netto;
      if (c.stab < STAB_ROOD) { item.niveau = 'rood'; item.kort = 'laag'; }
      else if (item.doel < STAB_ROOD || (c.stab < STAB_ORANJE && item.doel < c.stab)) { item.niveau = 'oranje'; item.kort = 'daalt'; }
    } else if (r.id === R.geld) {
      item.voorraad = c.voorraad[r.id] ?? 0;
      item.netto = c.inkomen ?? 0;
      item.trend = glijdend(s, c, r);
      if (item.trend < 0) item.dagen = Math.max(0, item.voorraad) / -item.trend;
      if (item.voorraad < 0) { item.niveau = 'rood'; item.kort = 'schuld'; }
      else if (item.trend < 0 && item.dagen < waarschuw) { item.niveau = 'oranje'; item.kort = `nog ${Math.max(1, rond(item.dagen))} d`; }
    } else {
      item.voorraad = c.voorraad[r.id] ?? 0;
      item.cap = sim.opslagMax(s, c, r.id);
      item.vulling = isFinite(item.cap) && item.cap > 0 ? Math.max(0, Math.min(1, item.voorraad / item.cap)) : null;
      item.ratio = c.ratio?.[r.id] ?? 1;
      item.netto = c.netto?.[r.id] ?? 0;
      item.trend = glijdend(s, c, r);
      if (item.ratio < 1) {
        item.niveau = 'rood';
        item.kort = 'op';
        item.trend = Math.min(item.trend, brutoBalans(s, c, r.id).balans); // de echte balans, niet de lege voorraad
        item.dagen = 0;
      } else {
        if (item.trend < 0) item.dagen = item.voorraad / -item.trend;
        if (item.trend < 0 && item.dagen < waarschuw) { item.niveau = 'oranje'; item.kort = `nog ${Math.max(1, rond(item.dagen))} d`; }
        else if (r.vol_waarschuwing !== false && isFinite(item.cap) && item.voorraad >= item.cap * VOL_MARGE && item.netto > 0) { item.niveau = 'goud'; item.kort = 'vol'; }
      }
    }
    uit.push(item);
  }
  return uit;
}

// Het ergste probleem (voor de meter): rood boven oranje boven goud; daarbinnen het snelst lege. Plus het aantal.
export function ergste(s, lijst = toestand(s)) {
  let best = null;
  let n = 0;
  for (const x of lijst) {
    if (x.niveau === 'neutraal') continue;
    n += 1;
    if (!best || NIVEAU_RANG[x.niveau] > NIVEAU_RANG[best.niveau] || (NIVEAU_RANG[x.niveau] === NIVEAU_RANG[best.niveau] && x.dagen < best.dagen)) best = x;
  }
  return { item: best, niveau: best?.niveau ?? 'neutraal', aantal: n };
}

// ---------- uitsplitsing ----------

// Waar een grondstof vandaan komt en waar hij heen gaat, per gebouw plus de vaste vraag. Plus wat er al in de bouw is.
export function uitsplitsing(s, rid) {
  const c = spelerVan(s);
  const P = s.pack;
  const M = P.model;
  const R = P.rollen;
  const maakt = [];
  const verbruikt = [];
  const inBouw = [];
  if (rid === R.geld) {
    const bel = (c.Y ?? 0) * (c.belasting ?? 0);
    maakt.push({ naam: 'Belasting', waarde: bel * (1 - (c.verdeling ?? 0)) });
    if ((c.onderhoud ?? 0) > 0) verbruikt.push({ naam: 'Onderhoud gebouwen en leger', waarde: c.onderhoud });
  }
  if (rid === R.stabiliteit) {
    for (const [naam, d] of c.stabFactoren || []) (d >= 0 ? maakt : verbruikt).push({ naam, waarde: Math.abs(d) });
  }
  for (let i = 0; i < P.gebouwen.length; i++) {
    const g = P.gebouwen[i];
    const n = c.gebouwen[g.id] || 0;
    const p = g.productie?.[rid];
    const v = g.verbruik?.[rid];
    if (n && p) maakt.push({ gebouw: g.id, naam: g.naam, icoon: g.icoon ?? '', n, waarde: (c.effSom?.[g.id] || 0) * p });
    if (n && v) verbruikt.push({ gebouw: g.id, naam: g.naam, icoon: g.icoon ?? '', n, waarde: (n + (c.extraVerbruik?.[g.id] ?? 0)) * v });
    if (rid === R.stabiliteit && n && g.stabiliteit > 0) maakt.push({ gebouw: g.id, naam: g.naam, icoon: g.icoon ?? '', n, waarde: (c.effSom?.[g.id] || 0) * g.stabiliteit, voorziening: true });
  }
  if (rid === R.energie) verbruikt.push({ naam: 'Productie van je land', waarde: (c.Y ?? 0) * (M.energie_per_productie ?? 0) });
  if (rid === R.voedsel) verbruikt.push({ naam: 'Inwoners', waarde: (c.L ?? 0) * (M.voedsel_per_inwoner ?? 0) });
  for (let i = 0; i < c.bouw.length; i++) {
    const b = c.bouw[i];
    const g = P.gebouwIndex[b.gebouw];
    if (!g) continue;
    const helpt = (g.productie?.[rid] ?? 0) > 0 || (rid === R.stabiliteit && g.stabiliteit > 0) || (rid === R.geld && ((g.productie?.[rid] ?? 0) > 0 || g.kapitaalvoorraad > 0));
    if (helpt) inBouw.push({ gebouw: g.id, naam: g.naam, icoon: g.icoon ?? '', klaar: b.klaar, over: Math.max(0, b.klaar - s.dag), tegel: b.tegel });
  }
  maakt.sort((a, b) => b.waarde - a.waarde);
  verbruikt.sort((a, b) => b.waarde - a.waarde);
  return { maakt, verbruikt, inBouw };
}

// ---------- effect van één gebouw ----------

// Rekensom, geen engineaanroep die iets wijzigt: productie maal rendement (van de tegel, of van de plek die Auto kiest)
// min verbruik, geremd zoals de engine bij een tekort aan een eigen invoer. Kapitaalvoorraad verhoogt de productie
// van je land (Y = A·K^α·L^β): dat geeft belasting erbij en vraagt meer energie. Onderhoud kost kapitaal.
// Geeft { per: { resId: delta per dag }, rendement, tegel, opslag: { resId: extra } }. In de interface staat er "±" bij.
export function effectVan(s, gebouwId, tegel = null) {
  const c = spelerVan(s);
  const P = s.pack;
  const M = P.model;
  const R = P.rollen;
  const g = P.gebouwIndex[gebouwId];
  const per = {};
  const opslag = {};
  if (!g) return { per, rendement: 0, tegel: -1, opslag };
  const t = tegel == null ? sim.kiesTegel(s, c, gebouwId) : tegel;
  let rend = 1;
  if (t >= 0) {
    const st = sim.tegelStatus(s, s.speler, gebouwId, t);
    rend = st.ok ? st.rendement ?? 1 : sim.rendement(s, c, gebouwId, t);
  }
  let eff = 1;
  for (const r of Object.keys(g.verbruik || {})) eff = Math.min(eff, c.ratio?.[r] ?? 1);
  const bij = (r, v) => { if (v) per[r] = (per[r] || 0) + v; };
  for (const [r, v] of Object.entries(g.productie || {})) bij(r, v * rend * eff);
  for (const [r, v] of Object.entries(g.verbruik || {})) bij(r, -v * eff);
  if (g.kapitaalvoorraad > 0) {
    const K = sim.kapitaalVoorraad(s, c);
    const dY = (c.Y ?? 0) * (M.alpha ?? 0.6) * (g.kapitaalvoorraad * rend) / Math.max(1, K);
    bij(R.geld, dY * (c.belasting ?? 0) * (1 - (c.verdeling ?? 0)));
    bij(R.energie, -dY * (M.energie_per_productie ?? 0));
  }
  bij(R.geld, -(g.onderhoud ?? M.onderhoud_per_gebouw ?? 0));
  if (g.opslag_bonus) for (const r of P.resources) if (r.opslag_max != null) opslag[r.id] = g.opslag_bonus;
  return { per, rendement: rend, tegel: t, opslag };
}

// ---------- kan ik dit bouwen? ----------

function faseVoor(s, id) {
  return s.pack.verhaal.fasen.find((f) => (f.ontgrendelt || []).includes(id)) ?? null;
}

// Eerste dag waarop een project vrijkomt (bouw of verbouwing).
function vrijOpDag(s, c) {
  let d = Infinity;
  for (let i = 0; i < c.bouw.length; i++) d = Math.min(d, c.bouw[i].klaar);
  for (let i = 0; i < c.plaatsingen.length; i++) { const v = c.plaatsingen[i].verbouw; if (v) d = Math.min(d, v.klaar ?? Infinity); }
  return d;
}

// Gedeelde bron voor elke bouwkaart (oplosser, lade van c16b, bouwlijst van c16c). Dezelfde volgorde van toetsen als
// sim.bouw, zodat kan precies samenvalt met wat de engine toestaat.
// { kan, reden, kostPerGrondstof: [{ r, icoon, nodig, heb, ok }], dagenSparen, effect, lostOp, projecten, max }
export function bouwKaartData(s, gebouwId, lijst = null) {
  const c = spelerVan(s);
  const P = s.pack;
  const g = P.gebouwIndex[gebouwId];
  const max = P.model.max_bouw;
  const projecten = c.bouw.length + actieveVerbouw(c);
  const uit = { kan: false, reden: '', kostPerGrondstof: [], dagenSparen: 0, effect: null, lostOp: [], projecten, max };
  if (!g) { uit.reden = 'Onbekend gebouw'; return uit; }
  const kosten = sim.bouwKosten(s, c, gebouwId);
  const trends = lijst ?? toestand(s);
  const trendVan = (r) => trends.find((x) => x.r === r)?.trend ?? (r === P.rollen.geld ? c.inkomen : c.netto?.[r]) ?? 0;
  let dagen = 0;
  for (const [r, nodig] of Object.entries(kosten)) {
    const heb = c.voorraad[r] ?? 0;
    const ok = heb >= nodig;
    uit.kostPerGrondstof.push({ r, icoon: P.resIndex[r]?.icoon ?? r, naam: P.resIndex[r]?.naam ?? r, nodig, heb, ok });
    if (!ok) {
      const erbij = trendVan(r);
      dagen = Math.max(dagen, erbij > 0 ? Math.ceil((nodig - heb) / erbij) : Infinity);
    }
  }
  uit.dagenSparen = dagen;
  const ontgrendeld = sim.isOntgrendeld(s, gebouwId);
  if (ontgrendeld) {
    uit.effect = effectVan(s, gebouwId);
    for (const x of trends) if ((x.niveau === 'rood' || x.niveau === 'oranje') && (uit.effect.per[x.r] ?? 0) > 0) uit.lostOp.push(x.r);
  }
  if (!ontgrendeld) {
    const f = faseVoor(s, gebouwId);
    uit.reden = `🔒 fase ${f?.naam ?? 'later'}`;
  } else if (projecten >= max) {
    const d = vrijOpDag(s, c);
    uit.reden = `${projecten}/${max} projecten bezig${isFinite(d) ? ` · vrij op dag ${d}` : ''}`;
  } else if (!sim.kanBetalen(c, kosten)) {
    const mist = uit.kostPerGrondstof.filter((k) => !k.ok).map((k) => `${rond(k.nodig - k.heb)} ${k.icoon}`).join(' ');
    uit.reden = `nog ${mist}${isFinite(dagen) ? ` · ±${Math.max(1, dagen)} d` : ' · komt niet binnen'}`;
  } else if (sim.vrijePlekken(s, c, gebouwId) <= 0) {
    uit.reden = 'Geen vrije grond';
  } else uit.kan = true;
  return uit;
}

// ---------- oplossers ----------

// Twee of drie gebouwen die het probleem van grondstof rid oplossen, de beste eerst. Elk met { gebouw, naam, icoon,
// voor, na, ...bouwKaartData }. Bij een tekort: wat het maakt (eerst wat het niet zelf verbruikt, dan wat je nu kunt
// bouwen, dan het meeste effect per prijs). Bij goud: opslag of een verbruiker. Bij kapitaal: de goedkoopste
// geldmaker. Bij stabiliteit: voorzieningen. Een oplosser die nu niet kan, blijft staan met zijn reden.
export function oplossers(s, rid, max = AANBEVOLEN_MAX, lijst = toestand(s)) {
  const P = s.pack;
  const R = P.rollen;
  const item = lijst.find((x) => x.r === rid);
  if (!item) return [];
  const vol = item.niveau === 'goud';
  const kandidaten = [];
  for (let i = 0; i < P.gebouwen.length; i++) {
    const g = P.gebouwen[i];
    let soort = null;
    if (rid === R.stabiliteit) { if (g.stabiliteit > 0) soort = 'stab'; }
    else if (rid === R.geld) { if ((g.productie?.[rid] ?? 0) > 0 || (g.kapitaalvoorraad > 0 && !g.knooppunt)) soort = 'geld'; }
    else if (vol) {
      if (g.opslag_bonus > 0) soort = 'opslag';
      else if ((g.verbruik?.[rid] ?? 0) > 0) soort = 'verbruiker';
    } else if ((g.productie?.[rid] ?? 0) > 0) soort = 'maakt';
    if (!soort) continue;
    const data = bouwKaartData(s, g.id, lijst);
    const per = data.effect?.per ?? effectVan(s, g.id).per;
    const delta = soort === 'opslag' ? g.opslag_bonus : soort === 'stab' ? g.stabiliteit : soort === 'verbruiker' ? -(per[rid] ?? 0) : per[rid] ?? 0;
    const prijs = sim.kostenInGeld(s, sim.bouwKosten(s, spelerVan(s), g.id)) || 1;
    const zelf = soort === 'maakt' && (g.verbruik?.[rid] ?? 0) > 0;
    kandidaten.push({
      gebouw: g.id, naam: g.naam, icoon: g.icoon ?? '', soort, delta, voor: item.trend, na: soort === 'maakt' || soort === 'geld' ? item.trend + (per[rid] ?? 0) : null,
      verbruiktZelf: zelf, slot: !sim.isOntgrendeld(s, g.id), score: delta / prijs, prijs, ...data,
    });
  }
  const volgorde = { opslag: 0, verbruiker: 1 };
  kandidaten.sort((a, b) => (a.verbruiktZelf - b.verbruiktZelf) || ((volgorde[a.soort] ?? 0) - (volgorde[b.soort] ?? 0))
    || (a.slot - b.slot) || (b.kan - a.kan) || (rid === R.geld ? a.prijs - b.prijs : b.score - a.score) // kapitaal: de goedkoopste
    || (a.gebouw < b.gebouw ? -1 : 1));
  return kandidaten.filter((k) => k.delta > 0).slice(0, max);
}

// De toestand in gewone taal: eerste regel van het kaartje.
export function toestandZin(s, item) {
  const P = s.pack;
  const R = P.rollen;
  const r = P.resIndex[item.r];
  const naam = r?.naam ?? item.r;
  const trend = `${teken(item.trend)}${getal(item.trend)} per dag`;
  if (item.r === R.stabiliteit) {
    const kern = `${naam} ${rond(item.voorraad)}, op weg naar ${rond(item.doel ?? item.voorraad)}.`;
    return `${kern} ${r?.advies ?? TERUGVAL.stab}`;
  }
  if (item.r === R.geld) {
    const kern = item.voorraad < 0 ? `${naam}: je staat ${rond(-item.voorraad)} in de min, ${trend}.` : `${naam}: ${trend}${isFinite(item.dagen) ? `, nog ${Math.max(1, rond(item.dagen))} dagen` : ''}.`;
    return `${kern} ${r?.advies ?? TERUGVAL.geld}`;
  }
  if (item.niveau === 'goud') return `${naam}: opslag vol (${rond(item.voorraad)}/${rond(item.cap)}), ${trend} gaat verloren. ${TERUGVAL.vol}`;
  const kern = item.niveau === 'rood' ? `${naam} is op: ${trend} tekort, je productie valt stil.`
    : `${naam}: ${trend}${isFinite(item.dagen) ? `, nog ${Math.max(1, rond(item.dagen))} dagen` : ''}.`;
  return `${kern} ${strafZin(r, item.niveau === 'rood')}`;
}

function strafZin(r, nu = false) {
  const te = r?.tekort_effect;
  const delen = [];
  if (te?.productie_factor != null) delen.push(`valt je productie terug tot ${rond(te.productie_factor * 100)}%`);
  if (te?.stabiliteit != null) delen.push(`kost het je tot ${rond(Math.abs(te.stabiliteit))} stabiliteit`);
  const straf = delen.length ? `${nu ? 'Nu' : 'Bij nul'} ${delen.join(' en ')}.` : '';
  const advies = r?.advies ?? '';
  return [straf, advies].filter(Boolean).join(' ') || TERUGVAL.tekort;
}

// ---------- DOM: chips, meter, kaartje en --topbalk-h ----------
// api uit main.js: { ui }. Geen orders: de knop "Bouw" heeft data-actie="oplos-bouw" en main.js start de plaatsmodus.

export function maakEvenwicht(api) {
  const { ui } = api;
  const $ = (q) => document.querySelector(q);
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const TELEFOON = window.matchMedia('(max-width: 600px)');
  const st = { open: null, anker: null, sleutel: '', lijst: [], waarnemer: null, meterHtml: '' };

  // --topbalk-h: de echte hoogte van de balk, inclusief de safe-area die hij als padding heeft (afspraak 1).
  function meetBalk() {
    const el = $('#topbalk');
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--topbalk-h', `${h}px`);
  }
  function koppel() {
    if (st.waarnemer) return;
    const el = $('#topbalk');
    if (!el) return;
    if (!$('#ev-meter')) {
      const m = document.createElement('button');
      m.id = 'ev-meter';
      m.className = 'ev-meter niv-neutraal';
      m.dataset.actie = 'evenwicht';
      m.dataset.id = 'meter';
      el.prepend(m);
    }
    st.waarnemer = typeof ResizeObserver === 'function' ? new ResizeObserver(meetBalk) : { disconnect() {} };
    st.waarnemer.observe?.(el);
    addEventListener('resize', meetBalk);
    meetBalk();
    koppelTempo();
    koppelKaartje();
    addEventListener('bouwfeedback', (e) => puls(e.detail?.gebouw));
  }

  // Telefoon: het tempo is één knop. Tik op de actieve stand en de andere verschijnen (de datum maakt plaats).
  function koppelTempo() {
    const t = $('#tempo');
    if (!t) return;
    t.addEventListener('click', (e) => {
      if (!TELEFOON.matches) return;
      const b = e.target.closest('[data-tempo]');
      if (!b) return;
      if (!t.classList.contains('open')) { if (b.classList.contains('actief')) t.classList.add('open'); return; }
      setTimeout(() => t.classList.remove('open'), 0);
    }, true);
    document.addEventListener('pointerdown', (e) => { if (t.classList.contains('open') && !e.target.closest('#tempo')) t.classList.remove('open'); }, true);
  }

  // Chips voor de balk (main.js zet er de credits en het menu achter). Werkt ook de meter bij.
  function render(s) {
    koppel();
    if (onderpaneel.huidig() === 'context' && $('#context')?.hidden) onderpaneel.sluit('context'); // nieuw potje
    const lijst = toestand(s);
    st.lijst = lijst;
    const P = s.pack;
    const chips = [];
    for (const x of lijst) {
      const r = P.resIndex[x.r];
      const nieuw = !ui.ontgrendeldGezien.has(x.r);
      if (nieuw) ui.ontgrendeldGezien.add(x.r);
      let w;
      let d;
      if (x.r === P.rollen.stabiliteit) {
        w = rond(x.voorraad);
        const op = (x.doel ?? x.voorraad) >= x.voorraad;
        d = `<span class="d ${op ? 'goed' : 'slecht'}">${op ? '↗' : '↘'} ${rond(x.doel ?? x.voorraad)}</span>`;
      } else {
        w = fmtW(x.voorraad);
        const n = x.trend;
        const cls = n > 0.05 ? 'goed' : n < -0.05 ? 'slecht' : 'zacht';
        d = `<span class="d ${cls}"><span class="ev-teken">${teken(n)}</span><span class="ev-pijl">${n > 0.05 ? '↑' : n < -0.05 ? '↓' : '·'}</span>${getal(n)}<span class="ev-pd">/d</span></span>`;
      }
      const tag = x.kort && x.r !== P.rollen.stabiliteit ? `<span class="ev-tag">${esc(x.kort)}</span>` : '';
      const vul = x.vulling != null && x.r !== P.rollen.stabiliteit ? `<span class="ev-vul"><i style="width:${(x.vulling * 100).toFixed(0)}%"></i></span>` : '';
      const titel = chipTitel(s, x, r);
      chips.push(`<button class="res niv-${x.niveau} ${x.niveau === 'rood' ? 'tekort' : ''} ${nieuw && s.dag > 0 ? 'nieuw' : ''} ${st.open === x.r ? 'ev-open' : ''}" data-actie="evenwicht" data-id="${esc(x.r)}" title="${esc(titel)}"><span class="ico">${r?.icoon ?? ''}</span><span class="w">${w}</span>${d}${tag}${vul}</button>`);
    }
    const e = ergste(s, lijst);
    const meter = $('#ev-meter');
    if (meter) {
      const mh = `<span class="ev-bol"></span><span class="ev-n">${e.aantal || ''}</span>`;
      const cls = `ev-meter niv-${e.niveau}${st.open === 'meter' ? ' ev-open' : ''}`;
      if (meter.className !== cls) meter.className = cls;
      if (st.meterHtml !== mh) { meter.innerHTML = mh; st.meterHtml = mh; }
      meter.title = e.item ? `${e.aantal} ${e.aantal === 1 ? 'probleem' : 'problemen'}. Ergste: ${e.item.naam} (${e.item.kort || e.niveau}). Tik voor de oplossing.` : 'Je land staat er goed voor.';
      meter.setAttribute('aria-label', meter.title);
    }
    if (st.open) vernieuwKaartje(s);
    return chips;
  }

  function fmtW(n) {
    if (!isFinite(n)) return '∞';
    const a = Math.abs(n);
    if (a >= 100000) return `${(n / 1000).toFixed(0)}k`;
    if (a >= 10000) return `${(n / 1000).toFixed(1)}k`;
    if (a >= 100) return n.toFixed(0);
    return n.toFixed(1);
  }

  function chipTitel(s, x, r) {
    const naam = r?.naam ?? x.r;
    if (x.r === s.pack.rollen.stabiliteit) return `${naam} ${x.voorraad.toFixed(1)}, doel ${(x.doel ?? x.voorraad).toFixed(1)}. Tik voor wat helpt.`;
    const cap = isFinite(x.cap) ? ` / ${rond(x.cap)}` : '';
    return `${naam}: ${rond(x.voorraad)}${cap}, ${teken(x.trend)}${getal(x.trend)} per dag${x.kort ? ` (${x.kort})` : ''}. Tik voor waar het vandaan komt en wat helpt.`;
  }

  // ----- het oplosser-kaartje -----

  function kaartEl() {
    let el = $('#oplosser');
    if (!el) {
      el = document.createElement('div');
      el.id = 'oplosser';
      el.className = 'oplosser';
      el.hidden = true;
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Oplossing voor een tekort');
      document.body.append(el);
    }
    return el;
  }

  function koppelKaartje() {
    const el = kaartEl();
    el.addEventListener('click', (e) => { if (e.target.closest('[data-ev="sluit"]')) sluit(); });
    // Desktop: buiten het kaartje tikken sluit het. Telefoon: niet, de kaart blijft gewoon te bedienen.
    document.addEventListener('pointerdown', (e) => {
      if (!st.open || TELEFOON.matches) return;
      if (e.target.closest('#oplosser') || e.target.closest('[data-actie="evenwicht"]')) return;
      sluit();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.open) sluit(); });
    // Telefoon: naar beneden vegen over de kop sluit het (zoals het contextpaneel).
    let veeg = null;
    el.addEventListener('pointerdown', (e) => {
      if (!TELEFOON.matches || e.target.closest('button') || !e.target.closest('.ev-kop')) return;
      veeg = { y: e.clientY, id: e.pointerId };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => { if (veeg && e.pointerId === veeg.id) el.style.transform = `translateY(${Math.max(0, e.clientY - veeg.y)}px)`; });
    const los = (e) => {
      if (!veeg || e.pointerId !== veeg.id) return;
      const dy = e.clientY - veeg.y;
      veeg = null;
      el.style.transform = '';
      if (dy > 60) sluit();
    };
    el.addEventListener('pointerup', los);
    el.addEventListener('pointercancel', los);
  }

  // Tik op een chip of de meter: open (of sluit als hij al open staat).
  function wissel(id, anker) {
    if (st.open === id) { sluit(); return; }
    open(id, anker);
  }

  function open(id, anker = null) {
    const s = ui.state;
    if (!s) return;
    koppel();
    st.open = id;
    st.anker = anker;
    st.sleutel = '';
    onderpaneel.open('oplosser', sluitStil);
    vernieuwKaartje(s, true);
    plaats();
  }

  function sluitStil() {
    st.open = null;
    st.anker = null;
    const el = $('#oplosser');
    if (el) el.hidden = true;
    for (const b of document.querySelectorAll('.ev-open')) b.classList.remove('ev-open');
  }

  function sluit() {
    if (!st.open) return;
    sluitStil();
    onderpaneel.sluit('oplosser');
  }

  // Opnieuw rekenen alleen bij een dagwissel of een nieuwe order (en bij openen).
  function vernieuwKaartje(s, dwing = false) {
    const c = spelerVan(s);
    const sleutel = `${st.open}|${s.dag}|${s.orders.length}|${c.bouw.length}|${s.speler}`;
    if (!dwing && sleutel === st.sleutel) return;
    st.sleutel = sleutel;
    const el = kaartEl();
    const html = kaartHtml(s);
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    el.hidden = false;
    for (const b of document.querySelectorAll('[data-actie="evenwicht"]')) b.classList.toggle('ev-open', b.dataset.id === st.open);
  }

  // Desktop: popover onder de chip. Telefoon: onderpaneel (CSS), zodat de kaart erboven zichtbaar blijft.
  function plaats() {
    const el = kaartEl();
    if (TELEFOON.matches) { el.style.left = el.style.top = ''; return; }
    const a = st.anker?.isConnected ? st.anker : document.querySelector(`[data-actie="evenwicht"][data-id="${st.open}"]`);
    const r = a?.getBoundingClientRect() ?? { left: 16, bottom: 56 };
    const w = 316;
    el.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - w - 8)))}px`;
    el.style.top = `${Math.round(r.bottom + 6)}px`;
  }

  function kaartHtml(s) {
    const P = s.pack;
    const R = P.rollen;
    const lijst = toestand(s);
    let item;
    if (st.open === 'meter') {
      item = ergste(s, lijst).item;
      if (!item) {
        return `<div class="ev-kop"><b>Je land staat er goed voor</b><button class="knop klein ev-sluit" data-ev="sluit" aria-label="Sluiten">×</button></div>
          <p class="ev-zin">Geen tekorten, geen schuld en geen volle opslag. Tik een grondstof aan om te zien waar hij vandaan komt.</p>`;
      }
    } else item = lijst.find((x) => x.r === st.open);
    if (!item) return '<div class="ev-kop"><b>Onbekend</b><button class="knop klein ev-sluit" data-ev="sluit" aria-label="Sluiten">×</button></div>';
    const r = P.resIndex[item.r];
    const u = uitsplitsing(s, item.r);
    const regel = (xs) => (xs.length ? xs.slice(0, 4).map((x) => `${esc(x.icoon ?? '')} ${esc(x.naam)}${x.n > 1 ? ` ×${x.n}` : ''} <b>${getal(x.waarde)}</b>`).join(' · ') : '<span class="zacht">niets</span>');
    let h = `<div class="ev-kop"><b>${esc(r?.icoon ?? '')} ${esc(r?.naam ?? item.r)}</b><span class="ev-label niv-${item.niveau}">${esc(labelVan(item))}</span><button class="knop klein ev-sluit" data-ev="sluit" aria-label="Sluiten">×</button></div>`;
    h += `<p class="ev-zin">${esc(toestandZin(s, item))}</p>`;
    h += `<div class="ev-stroom"><div><span class="zacht">Maakt:</span> ${regel(u.maakt)}</div><div><span class="zacht">${item.r === R.stabiliteit ? 'Drukt:' : 'Verbruikt:'}</span> ${regel(u.verbruikt)}</div></div>`;
    for (const b of u.inBouw) h += `<div class="ev-al">Er komt al een ${esc(b.naam)} aan (klaar over ${b.over} d)</div>`;
    const opl = oplossers(s, item.r, AANBEVOLEN_MAX, lijst);
    if (opl.length) {
      h += `<h4 class="ev-h">${item.niveau === 'goud' ? 'Zo verspil je minder' : item.niveau === 'neutraal' ? 'Meer hiervan' : 'Dit lost het op'}</h4>`;
      for (const o of opl) h += oplosserHtml(s, item, o);
    }
    const tip = item.r === R.geld ? TERUGVAL.geld_tip : item.r === R.stabiliteit ? TERUGVAL.stab_tip : item.niveau === 'goud' ? TERUGVAL.vol_tip : '';
    if (tip && (item.niveau !== 'neutraal' || !opl.length)) h += `<p class="ev-tip zacht">${esc(tip)}</p>`;
    return h;
  }

  function labelVan(item) {
    return { rood: item.kort || 'tekort', oranje: item.kort || 'let op', goud: 'vol', neutraal: 'in orde' }[item.niveau];
  }

  function oplosserHtml(s, item, o) {
    const P = s.pack;
    const icoon = P.resIndex[item.r]?.icoon ?? '';
    let effect;
    if (o.soort === 'opslag') effect = `opslag +${rond(o.delta)}`;
    else if (o.soort === 'stab') effect = `voorziening +${komma(o.delta)} stabiliteit`;
    else if (o.soort === 'verbruiker') effect = `verbruikt ±${getal(o.delta)} ${icoon}/d`;
    else effect = `van ${teken(o.voor)}${getal(o.voor)} naar ±${teken(o.na)}${getal(o.na)} ${icoon} per dag`;
    const kosten = o.kostPerGrondstof.map((k) => `<span class="ev-kost ${k.ok ? 'goed' : 'slecht'}">${rond(k.nodig)}${esc(k.icoon)}</span>`).join(' ');
    const knop = o.kan
      ? `<button class="knop klein primair ev-bouw" data-actie="oplos-bouw" data-id="${esc(o.gebouw)}">Bouw</button>`
      : `<span class="ev-reden">${esc(o.reden)}</span>`;
    return `<div class="ev-opl ${o.kan ? '' : 'ev-niet'}"><div class="ev-opl-kop"><span>${esc(o.icoon)} <b>${esc(o.naam)}</b></span>${knop}</div>
      <div class="ev-opl-sub"><span class="ev-eff">${esc(effect)}</span> · ${kosten}</div></div>`;
  }

  // Na een geslaagde bouw (gebeurtenis van c16b): de chip van wat het gebouw maakt licht 600 ms op.
  function puls(gebouwId) {
    const g = ui.state?.pack.gebouwIndex[gebouwId];
    if (!g) return;
    for (const r of Object.keys(g.productie || {})) {
      const b = document.querySelector(`#resources [data-actie="evenwicht"][data-id="${r}"]`);
      if (!b) continue;
      b.classList.remove('ev-puls');
      void b.offsetWidth;
      b.classList.add('ev-puls');
      setTimeout(() => b.classList.remove('ev-puls'), PULS_MS);
    }
  }

  return { render, wissel, open, sluit, isOpen: () => st.open, meetBalk };
}
