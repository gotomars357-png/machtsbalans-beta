// Controle van een genormaliseerd pack vóór de wereld start.
// Fouten blokkeren het starten; waarschuwingen laten zien wat de maker waarschijnlijk vergeten is.

import { ENGINE_VERSION, TOEGESTANE_LICENTIES, CLASSIFICATIES, VEREISTE_ROLLEN } from './defaults.js';
import { TERREINEN } from './geografie.js';

const EFFECT_SLEUTELS = ['productie_factor', 'duur_dagen', 'stabiliteit_doel', 'loyaliteit_zwevend', 'spanning', 'tech_factor', 'bevolking', 'complot', 'controle', 'oorlogssteun', 'quarantaine', 'netwerk_oprollen', 'moraal', 'factcheck', 'loyaliteit_blok', 'media', 'media_vreemd', 'eenheid'];
const VOORWAARDE_SLEUTELS = ['resource', 'onder', 'boven', 'duur_dagen', 'na_dag', 'voor_dag', 'kans_per_dag', 'spanning_boven', 'complot_boven', 'besmet', 'netwerk_boven', 'in_oorlog', 'moraal_onder', 'moraal_boven', 'controle_boven', 'regime', 'loyaliteit_boven', 'land', 'wereld_in_oorlog'];
const VEREIST_EXTRA = ['controle', 'moraal'];
const EVENT_SLEUTELS = ['id', 'titel', 'tekst', 'voorwaarde', 'keuzes', 'eenmalig', 'afkoeling', 'alleen_als_vervolg'];
const KEUZE_SLEUTELS = ['tekst', 'effect', 'vereist', 'vervolg'];
const OVERWINNING_TYPES = ['aandeel_productie', 'aantal_landen', 'tech_factor'];
const ESCALATIE_TYPES = ['complot', 'valse_vlag', 'oorlog', 'cyber'];

export function validatePack(p) {
  const fouten = [];
  const waarschuwingen = [];
  const m = p.meta;

  if (!m.id) fouten.push('pack.json mist een id.');
  if (!m.licentie) fouten.push('pack.json mist een licentie (verplicht).');
  else if (!TOEGESTANE_LICENTIES.includes(m.licentie)) waarschuwingen.push(`Licentie '${m.licentie}' staat niet op de lijst toegestane licenties (${TOEGESTANE_LICENTIES.join(', ')}).`);
  if (!m.classificatie) fouten.push('pack.json mist een inhoudsclassificatie (fictief, historisch of actueel).');
  else if (!CLASSIFICATIES.includes(m.classificatie)) fouten.push(`Onbekende classificatie '${m.classificatie}'.`);
  if (cmpVersie(m.engine_min, ENGINE_VERSION) > 0) fouten.push(`Pack vraagt engine ${m.engine_min}, deze engine is ${ENGINE_VERSION}.`);

  const resIds = new Set();
  for (const r of p.resources) {
    if (resIds.has(r.id)) fouten.push(`Resource '${r.id}' komt dubbel voor.`);
    resIds.add(r.id);
    // C16a: velden voor de evenwichtsbalk (alleen weergave, geen spelregel).
    if (r.waarschuw_dagen != null && !(typeof r.waarschuw_dagen === 'number' && r.waarschuw_dagen > 0)) fouten.push(`Resource '${r.id}': waarschuw_dagen moet een getal groter dan 0 zijn.`);
    if (r.vol_waarschuwing != null && typeof r.vol_waarschuwing !== 'boolean') fouten.push(`Resource '${r.id}': vol_waarschuwing moet true of false zijn.`);
    if (r.advies != null && typeof r.advies !== 'string') fouten.push(`Resource '${r.id}': advies moet een tekst zijn.`);
  }
  for (const rol of VEREISTE_ROLLEN) {
    if (!p.rollen[rol]) fouten.push(`Geen resource met rol '${rol}'. Elke wereld heeft ${VEREISTE_ROLLEN.join(', ')} nodig.`);
  }

  const geproduceerd = new Set();
  const gebIds = new Set();
  for (const g of p.gebouwen) {
    if (gebIds.has(g.id)) fouten.push(`Gebouw '${g.id}' komt dubbel voor.`);
    gebIds.add(g.id);
    for (const veld of ['kosten', 'productie', 'verbruik']) {
      for (const r of Object.keys(g[veld] || {})) {
        if (!resIds.has(r)) fouten.push(`Gebouw '${g.id}' verwijst in '${veld}' naar onbekende resource '${r}'.`);
      }
    }
    for (const r of Object.keys(g.productie || {})) geproduceerd.add(r);
    for (const t of [...(g.terrein || []), ...Object.keys(g.terrein_bonus || {})]) {
      if (!TERREINEN.includes(t)) fouten.push(`Gebouw '${g.id}' noemt onbekend terrein '${t}' (kies uit ${TERREINEN.join(', ')}).`);
    }
  }
  checkVerbouw(p, fouten);
  for (const r of p.resources) {
    if (r.rol === 'geld' || r.rol === 'stabiliteit') continue;
    if (!geproduceerd.has(r.id)) waarschuwingen.push(`Resource '${r.id}' wordt door geen enkel gebouw geproduceerd.`);
  }

  const blokIds = new Set(p.blokken.map((b) => b.id));
  if (p.blokken.length < 2) waarschuwingen.push('Minder dan twee blokken: er valt weinig te winnen.');
  const landIds = new Set();
  for (const l of p.landen) {
    if (landIds.has(l.id)) fouten.push(`Land '${l.id}' komt dubbel voor.`);
    landIds.add(l.id);
    if (l.blok && !blokIds.has(l.blok)) fouten.push(`Land '${l.id}' hoort bij onbekend blok '${l.blok}'.`);
    if (l.persoonlijkheidOpgegeven && !p.persoonlijkheden[l.persoonlijkheidOpgegeven]) {
      waarschuwingen.push(`Land '${l.id}': persoonlijkheid '${l.persoonlijkheidOpgegeven}' onbekend, 'voorzichtig' gebruikt.`);
    }
    if (l.regimeOpgegeven && !p.regimes[l.regimeOpgegeven]) waarschuwingen.push(`Land '${l.id}': regime '${l.regimeOpgegeven}' onbekend, '${l.regime}' gebruikt.`);
    for (const g of Object.keys(l.gebouwen)) {
      if (!gebIds.has(g)) fouten.push(`Land '${l.id}' start met onbekend gebouw '${g}'.`);
    }
  }
  if (!p.landen.some((l) => l.speelbaar)) fouten.push('Geen speelbaar land. Markeer minstens één kernland als speelbaar.');
  for (const b of p.blokken) {
    if (!p.landen.some((l) => l.blok === b.id)) waarschuwingen.push(`Blok '${b.id}' heeft geen landen.`);
  }

  const opKaart = new Set(p.kaart.regios.map((r) => r.land));
  for (const l of p.landen) if (!opKaart.has(l.id)) fouten.push(`Land '${l.id}' staat niet op de kaart.`);
  for (const r of p.kaart.regios) if (!landIds.has(r.land)) fouten.push(`Kaartregio verwijst naar onbekend land '${r.land}'.`);
  for (const [a, b] of p.kaart.handelsroutes) {
    if (!landIds.has(a) || !landIds.has(b)) waarschuwingen.push(`Handelsroute ${a}–${b} verwijst naar een onbekend land.`);
  }

  checkEvents(p, resIds, landIds, fouten, waarschuwingen);
  for (const s of p.schokken) {
    for (const r of Object.keys(s.effect?.productie || {})) {
      if (!resIds.has(r)) fouten.push(`Schok '${s.id}' verwijst naar onbekende resource '${r}'.`);
    }
  }
  for (const [id, r] of Object.entries(p.regimes)) {
    if (r.revolutie_naar && !p.regimes[r.revolutie_naar]) waarschuwingen.push(`Regime '${id}': revolutie naar onbekend regime '${r.revolutie_naar}'.`);
  }
  checkDoctrines(p, fouten);
  checkRivalen(p, fouten);
  checkKrant(p, waarschuwingen);
  for (const o of p.verhaal.overwinning || []) {
    if (!OVERWINNING_TYPES.includes(o.type)) fouten.push(`Onbekende overwinningsvoorwaarde '${o.type}'.`);
  }
  for (const h of p.acties.hefbomen) {
    for (const r of Object.keys(h.kosten || {})) if (!resIds.has(r)) fouten.push(`Actie '${h.id}' kost onbekende resource '${r}'.`);
  }
  for (const e of p.eenheden) {
    if (!gebIds.has(e.gebouw)) fouten.push(`Eenheid '${e.id}' wordt opgeleid in onbekend gebouw '${e.gebouw}'.`);
    for (const r of Object.keys(e.kosten || {})) if (!resIds.has(r)) fouten.push(`Eenheid '${e.id}' kost onbekende resource '${r}'.`);
    for (const v of ['hp', 'bereik', 'snelheid']) if (!(e[v] > 0)) fouten.push(`Eenheid '${e.id}' mist een positieve '${v}'.`);
    if (!(e.aanval >= 0)) fouten.push(`Eenheid '${e.id}' mist een aanval (0 mag, voor bijvoorbeeld kolonisten).`);
  }
  for (const a of [...p.acties.campagnes, ...p.acties.netwerken, ...p.acties.media, ...p.acties.overname]) {
    for (const r of Object.keys(a.kosten || {})) if (!resIds.has(r)) fouten.push(`Actie '${a.id}' kost onbekende resource '${r}'.`);
  }
  for (const h of p.acties.escalatie) {
    for (const r of Object.keys(h.kosten || {})) if (!resIds.has(r)) fouten.push(`Escalatie '${h.id}' kost onbekende resource '${r}'.`);
    if (h.type && !ESCALATIE_TYPES.includes(h.type)) fouten.push(`Escalatie '${h.id}' heeft onbekend type '${h.type}'.`);
    if (h.type === 'cyber' && h.beschikbaar !== false) {
      if (!h.varianten?.length) fouten.push(`Escalatie '${h.id}' (cyber) mist varianten.`);
      for (const v of h.varianten || []) {
        if (!v.id) fouten.push(`Escalatie '${h.id}': een variant mist een id.`);
        if (!(v.duur > 0)) fouten.push(`Escalatie '${h.id}': variant '${v.id}' mist een positieve duur.`);
        for (const r of Object.keys(v.kosten || {})) if (!resIds.has(r)) fouten.push(`Escalatie '${h.id}': variant '${v.id}' kost onbekende resource '${r}'.`);
      }
    }
  }

  checkBrandhaarden(p, resIds, gebIds, fouten, waarschuwingen);

  if (m.classificatie === 'actueel') {
    waarschuwingen.push('Dit pack gaat over actuele verhoudingen. Leiders zijn archetypen; uitkomsten zijn spel, geen voorspelling.');
  }
  return { fouten, waarschuwingen };
}

// Verbouwen en slopen (C15c): lengtes per niveau, geen negatieve waarden, en verbouwbaar is een ja/nee.
function checkVerbouw(p, fouten) {
  for (const g of p.gebouwen) {
    if (g.verbouwbaar != null && typeof g.verbouwbaar !== 'boolean') fouten.push(`Gebouw '${g.id}': verbouwbaar moet true of false zijn.`);
  }
  const V = p.model?.verbouw;
  if (V == null) return;
  const waar = 'model.verbouw';
  const max = V.niveau_max;
  if (!Number.isInteger(max) || max < 1) { fouten.push(`${waar}: niveau_max moet een geheel getal van minstens 1 zijn.`); return; }
  for (const [veld, lengte] of [['effect', max], ['verbruik', max], ['onderhoud', max], ['kosten', max - 1], ['bouwtijd', max - 1]]) {
    const lijst = V[veld];
    if (!Array.isArray(lijst) || lijst.length !== lengte) { fouten.push(`${waar}: '${veld}' moet een lijst van ${lengte} getallen zijn.`); continue; }
    if (lijst.some((x) => typeof x !== 'number' || !(x >= 0))) fouten.push(`${waar}: '${veld}' mag alleen getallen van 0 of hoger bevatten.`);
  }
  for (const veld of ['kosten_schaal', 'tijdens', 'sloop_terug', 'sloop_dagen', 'sloop_oorlog_afstand']) {
    if (typeof V[veld] !== 'number' || !(V[veld] >= 0)) fouten.push(`${waar}: '${veld}' moet een getal van 0 of hoger zijn.`);
  }
  if (V.sloop_terug > 1) fouten.push(`${waar}: sloop_terug ligt tussen 0 en 1.`);
  if (V.sloop_dagen < 1) fouten.push(`${waar}: sloop_dagen moet minstens 1 zijn.`);
  for (const [soort, s] of Object.entries(V.sloop_stabiliteit || {})) {
    if (typeof s?.waarde !== 'number' || typeof s?.dagen !== 'number' || !(s.dagen >= 0)) fouten.push(`${waar}: sloop_stabiliteit.${soort} vraagt een waarde en een aantal dagen.`);
  }
}

function checkEffect(waar, effect, resIds, waarschuwingen, fouten, p) {
  for (const k of Object.keys(effect)) {
    if (!resIds.has(k) && !EFFECT_SLEUTELS.includes(k)) waarschuwingen.push(`${waar}: onbekend effect '${k}' wordt genegeerd.`);
  }
  if (effect.eenheid != null && fouten && !p.eenheden.some((x) => x.id === effect.eenheid)) fouten.push(`${waar}: effect 'eenheid' noemt onbekende eenheid '${effect.eenheid}'.`);
}

// Gebeurtenissen en ketens: elk vervolg moet bestaan, en elke gebeurtenis moet minstens één keuze hebben die altijd kan.
function checkEvents(p, resIds, landIds, fouten, waarschuwingen) {
  const ids = new Set();
  const aangeroepen = new Set();
  for (const e of p.events) {
    if (!e.id) { fouten.push('Een event mist een id.'); continue; }
    if (ids.has(e.id)) fouten.push(`Event '${e.id}' komt dubbel voor.`);
    ids.add(e.id);
    for (const k of e.keuzes || []) if (k.vervolg?.event) aangeroepen.add(k.vervolg.event);
  }
  for (const e of p.events) {
    if (!e.id) continue;
    const waar = `Event '${e.id}'`;
    for (const k of Object.keys(e)) if (!EVENT_SLEUTELS.includes(k)) waarschuwingen.push(`${waar}: onbekend veld '${k}' wordt genegeerd.`);
    if (!e.titel) waarschuwingen.push(`${waar} heeft geen titel.`);
    if (!e.keuzes?.length) fouten.push(`${waar} heeft geen keuzes.`);
    const v = e.voorwaarde || {};
    for (const k of Object.keys(v)) if (!VOORWAARDE_SLEUTELS.includes(k)) waarschuwingen.push(`${waar}: onbekende voorwaarde '${k}'.`);
    if (v.resource && !resIds.has(v.resource)) fouten.push(`${waar} verwijst naar onbekende resource '${v.resource}'.`);
    if (v.regime != null && !p.regimes[v.regime]) fouten.push(`${waar}: voorwaarde 'regime' noemt onbekend regime '${v.regime}'.`);
    if (v.land != null && !landIds.has(v.land)) fouten.push(`${waar}: voorwaarde 'land' noemt onbekend land '${v.land}'.`);
    if (v.land != null && v.loyaliteit_boven == null) waarschuwingen.push(`${waar}: voorwaarde 'land' werkt alleen samen met 'loyaliteit_boven'.`);
    if (e.alleen_als_vervolg && !aangeroepen.has(e.id)) waarschuwingen.push(`${waar} komt alleen als vervolg, maar geen enkele keuze verwijst ernaar.`);
    if (e.alleen_als_vervolg && Object.keys(v).length) waarschuwingen.push(`${waar} komt alleen als vervolg: de voorwaarde wordt niet gebruikt.`);
    const keuzes = e.keuzes || [];
    // Een keuze kan geweigerd worden door een 'vereist' of een gratis eenheid (leger nog dicht).
    if (keuzes.length && keuzes.every((k) => (k.vereist && Object.keys(k.vereist).length) || k.effect?.eenheid != null)) {
      fouten.push(`${waar}: elke keuze heeft een 'vereist' of een gratis eenheid. Geef minstens één keuze die altijd kan, anders kan de speler vastlopen.`);
    }
    keuzes.forEach((k, i) => {
      const kw = `${waar}, keuze ${i + 1}`;
      if (!k.tekst) waarschuwingen.push(`${kw} heeft geen tekst.`);
      for (const s of Object.keys(k)) if (!KEUZE_SLEUTELS.includes(s)) waarschuwingen.push(`${kw}: onbekend veld '${s}' wordt genegeerd.`);
      checkEffect(kw, k.effect || {}, resIds, waarschuwingen, fouten, p);
      if (k.effect?.eenheid != null && legerDag(p, k.effect.eenheid) > (v.na_dag ?? 0)) {
        waarschuwingen.push(`${kw}: geeft een eenheid, maar het leger kan dan nog dicht zijn (vrij vanaf dag ${legerDag(p, k.effect.eenheid)}). De keuze wordt tot dan uitgegrijsd.`);
      }
      for (const [r, min] of Object.entries(k.vereist || {})) {
        if (!resIds.has(r) && !VEREIST_EXTRA.includes(r)) fouten.push(`${kw}: 'vereist' noemt onbekende waarde '${r}' (kies een resource, controle of moraal).`);
        if (typeof min !== 'number') fouten.push(`${kw}: 'vereist.${r}' moet een getal zijn.`);
      }
      if (k.vervolg != null) {
        if (!k.vervolg.event) fouten.push(`${kw}: 'vervolg' mist een 'event'.`);
        else if (!ids.has(k.vervolg.event)) fouten.push(`${kw}: vervolg verwijst naar onbekend event '${k.vervolg.event}'.`);
        else if (k.vervolg.event === e.id) waarschuwingen.push(`${kw}: vervolg verwijst naar zichzelf; dat kan eindeloos doorgaan.`);
        if (k.vervolg.na_dagen != null && !(k.vervolg.na_dagen >= 1)) fouten.push(`${kw}: 'vervolg.na_dagen' moet minstens 1 zijn.`);
      }
    });
  }
}

// Vanaf welke dag het leger en dit type eenheid vrij zijn (0 als geen fase ze noemt).
function legerDag(p, id) {
  let dag = 0;
  for (const f of p.verhaal?.fasen || []) if ((f.ontgrendelt || []).some((s) => s === 'leger' || s === id)) dag = Math.max(dag, f.dag ?? 0);
  return dag;
}

// Leiderdoctrines (C13): alleen de twaalf regimevelden, binnen vaste grenzen, en altijd een voordeel én een nadeel.
// Positief is goed, behalve bij complot_gevoeligheid en oorlog_moeheid (factoren): daar is negatief goed.
const DOCTRINE_GRENZEN = {
  productiviteit: 0.15, bouw_korting: 0.15, handel_bonus: 0.15, leger_korting: 0.15, tech_groei: 0.00002,
  weerbaarheid: 8, informatiecontrole: 10, informatiecontrole_max: 15, moraal: 8, stabiliteit: 5,
  complot_gevoeligheid: 0.3, oorlog_moeheid: 0.3,
};
const DOCTRINE_OMGEKEERD = ['complot_gevoeligheid', 'oorlog_moeheid'];
const ONTGRENDEL_SLEUTELS = ['start', 'potjes', 'winst_route', 'winst_zonder_oorlog', 'orders'];

// Effecten van een doctrine of rivaalles: bekende regimevelden, getallen, binnen de grenzen. Geeft terug of er een
// voordeel en een nadeel tussen zitten.
function checkEffecten(waar, effecten, grenzen, fouten) {
  let voordeel = false, nadeel = false;
  const eff = effecten && typeof effecten === 'object' ? effecten : {};
  for (const [k, v] of Object.entries(eff)) {
    if (!(k in grenzen)) { fouten.push(`${waar}: onbekend effectveld '${k}' (kies uit ${Object.keys(grenzen).join(', ')}).`); continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) { fouten.push(`${waar}: '${k}' is geen getal.`); continue; }
    if (Math.abs(v) > grenzen[k]) fouten.push(`${waar}: '${k}' = ${v} ligt buiten de grens van ${grenzen[k]}.`);
    const goed = DOCTRINE_OMGEKEERD.includes(k) ? v < 0 : v > 0;
    if (v !== 0) { if (goed) voordeel = true; else nadeel = true; }
  }
  return { voordeel, nadeel };
}

function checkDoctrines(p, fouten) {
  const lijst = p.doctrines;
  if (!Array.isArray(lijst)) { fouten.push('Doctrines moeten een lijst zijn.'); return; }
  const ids = new Set();
  let start = false;
  for (let i = 0; i < lijst.length; i++) {
    const d = lijst[i] || {};
    const waar = `Doctrine '${d.id ?? `#${i + 1}`}'`;
    if (!d.id) fouten.push(`Doctrine #${i + 1} mist een id.`);
    else if (ids.has(d.id)) fouten.push(`${waar} komt dubbel voor.`);
    ids.add(d.id);
    if (!d.naam) fouten.push(`${waar} mist een naam.`);
    const { voordeel, nadeel } = checkEffecten(waar, d.effecten, DOCTRINE_GRENZEN, fouten);
    if (!voordeel || !nadeel) fouten.push(`${waar} heeft niet zowel een voordeel als een nadeel (elke doctrine heeft een tegenzet).`);
    const o = d.ontgrendel && typeof d.ontgrendel === 'object' ? d.ontgrendel : {};
    for (const k of Object.keys(o)) if (!ONTGRENDEL_SLEUTELS.includes(k)) fouten.push(`${waar}: onbekende ontgrendelvoorwaarde '${k}' (kies uit ${ONTGRENDEL_SLEUTELS.join(', ')}).`);
    if (o.start === true) start = true;
    if (o.potjes != null && !(Number.isInteger(o.potjes) && o.potjes > 0)) fouten.push(`${waar}: 'potjes' moet een positief geheel getal zijn.`);
    if (o.winst_route != null && !OVERWINNING_TYPES.includes(o.winst_route)) fouten.push(`${waar}: winst_route '${o.winst_route}' is geen overwinningstype (kies uit ${OVERWINNING_TYPES.join(', ')}).`);
    if (o.orders != null && !(o.orders && typeof o.orders.type === 'string' && Number.isInteger(o.orders.minimaal) && o.orders.minimaal > 0)) fouten.push(`${waar}: 'orders' vraagt een type en een positief 'minimaal'.`);
  }
  if (lijst.length && !start) fouten.push('Geen enkele doctrine is vanaf het begin vrij (zet bij minstens één ontgrendel.start: true).');
}

// Rivaallessen (C14): de halve doctrinegrenzen, altijd een voordeel én een nadeel, en precies één 'na'-voorwaarde.
const RIVAAL_GRENZEN = Object.fromEntries(Object.entries(DOCTRINE_GRENZEN).map(([k, v]) => [k, v / 2]));
const RIVAAL_NA = ['winst_route', 'winst_oorlog', 'verlies'];
function checkRivalen(p, fouten) {
  const lijst = p.rivalen;
  if (!Array.isArray(lijst)) { fouten.push('Rivalen moeten een lijst zijn.'); return; }
  const ids = new Set();
  for (let i = 0; i < lijst.length; i++) {
    const r = lijst[i] || {};
    const waar = `Rivaalles '${r.id ?? `#${i + 1}`}'`;
    if (!r.id) fouten.push(`Rivaalles #${i + 1} mist een id.`);
    else if (ids.has(r.id)) fouten.push(`${waar} komt dubbel voor.`);
    ids.add(r.id);
    if (!r.naam) fouten.push(`${waar} mist een naam.`);
    const { voordeel, nadeel } = checkEffecten(waar, r.effecten, RIVAAL_GRENZEN, fouten);
    if (!voordeel || !nadeel) fouten.push(`${waar} heeft niet zowel een voordeel als een nadeel (elke les heeft een zwakke plek).`);
    const na = r.na && typeof r.na === 'object' ? Object.keys(r.na) : [];
    if (na.length !== 1 || !RIVAAL_NA.includes(na[0])) fouten.push(`${waar}: 'na' moet precies één van ${RIVAAL_NA.join(', ')} hebben.`);
    else if (na[0] === 'winst_route' && !OVERWINNING_TYPES.includes(r.na.winst_route)) fouten.push(`${waar}: winst_route '${r.na.winst_route}' is geen overwinningstype (kies uit ${OVERWINNING_TYPES.join(', ')}).`);
  }
}

// De Krant (C14): alleen waarschuwingen, de krant kan het spel nooit tegenhouden.
export const KRANT_SOORTEN = ['start', 'aansluiting', 'afvallig', 'aandeel', 'bijna', 'fase', 'oorlog', 'vrede', 'haard_opgelost', 'haard_uitgebarsten', 'verkiezing', 'hervorming', 'kolonie', 'einde_winst', 'einde_verlies'];
export const KRANT_PLAATSHOUDERS = ['land', 'blok', 'speler', 'spelerblok', 'leider', 'rivaal', 'rivaalland', 'fase', 'aandeel', 'haard', 'jaar'];
function checkKrant(p, waarschuwingen) {
  const koppen = p.krant?.koppen;
  if (!koppen || typeof koppen !== 'object') return;
  for (const [soort, v] of Object.entries(koppen)) {
    if (!KRANT_SOORTEN.includes(soort)) { waarschuwingen.push(`Krant: onbekende soort '${soort}' wordt niet gebruikt.`); continue; }
    for (const toon of ['goed', 'slecht', 'sub']) {
      for (const kop of Array.isArray(v?.[toon]) ? v[toon] : []) {
        if (typeof kop !== 'string') { waarschuwingen.push(`Krant '${soort}': een kop is geen tekst.`); continue; }
        if (kop.length > 80) waarschuwingen.push(`Krant '${soort}': kop langer dan 80 tekens: '${kop.slice(0, 40)}…'.`);
        for (const m of kop.matchAll(/\{([^}]*)\}/g)) {
          if (!KRANT_PLAATSHOUDERS.includes(m[1])) waarschuwingen.push(`Krant '${soort}': onbekende plaatshouder '{${m[1]}}'.`);
        }
      }
    }
  }
}

function cmpVersie(a = '0', b = '0') {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// Brandhaarden (events/brandhaarden.json): unieke soorten met een bekend anker, positieve groei en deadline,
// kosten in bekende resources, bestaande gebouwen en events, en geldige effecten.
const BRANDHAARD_ANKERS_EXTRA = ['hoofdstad'];
const BRANDHAARD_PICTOGRAMMEN = ['tandwiel', 'golf', 'bliksem', 'aar', 'huisje', 'zuil'];
const BRANDHAARD_VOORWAARDEN = ['na_dag', 'voor_dag', 'stabiliteit_onder', 'stabiliteit_boven', 'complot_boven', 'resource', 'onder', 'boven', 'in_oorlog', 'kans_per_dag'];
function checkBrandhaarden(p, resIds, gebIds, fouten, waarschuwingen) {
  const lijst = p.brandhaarden || [];
  if (!Array.isArray(lijst)) { fouten.push('brandhaarden.json moet een lijst van soorten zijn.'); return; }
  const ids = new Set();
  const eventIds = new Set((p.events || []).map((e) => e.id));
  for (const b of lijst) {
    if (!b.id) { fouten.push('Een brandhaard mist een id.'); continue; }
    const waar = `Brandhaard '${b.id}'`;
    if (ids.has(b.id)) fouten.push(`${waar} komt dubbel voor.`);
    ids.add(b.id);
    if (!b.naam) waarschuwingen.push(`${waar} heeft geen naam.`);
    if (!gebIds.has(b.anker) && !BRANDHAARD_ANKERS_EXTRA.includes(b.anker)) fouten.push(`${waar} heeft onbekend anker '${b.anker}' (kies een gebouw of 'hoofdstad').`);
    if (b.pictogram != null && !BRANDHAARD_PICTOGRAMMEN.includes(b.pictogram)) waarschuwingen.push(`${waar}: onbekend pictogram '${b.pictogram}' (kies uit ${BRANDHAARD_PICTOGRAMMEN.join(', ')}).`);
    if (!(b.groei_per_dag > 0)) fouten.push(`${waar} mist een positieve 'groei_per_dag'.`);
    if (!(b.deadline_dagen > 0)) fouten.push(`${waar} mist een positieve 'deadline_dagen'.`);
    const v = b.voorwaarde || {};
    for (const k of Object.keys(v)) if (!BRANDHAARD_VOORWAARDEN.includes(k)) waarschuwingen.push(`${waar}: onbekende voorwaarde '${k}'.`);
    if (v.resource && !resIds.has(v.resource)) fouten.push(`${waar}: voorwaarde verwijst naar onbekende resource '${v.resource}'.`);
    (b.trappen || []).forEach((t, i) => {
      if (!(t.vanaf > 0 && t.vanaf < 100)) fouten.push(`${waar}, trap ${i + 1}: 'vanaf' moet tussen 0 en 100 liggen.`);
      checkEffect(`${waar}, trap ${i + 1}`, t.effect || {}, resIds, waarschuwingen, fouten, p);
    });
    if (!b.acties?.length) fouten.push(`${waar} heeft geen acties.`);
    const actieIds = new Set();
    for (const a of b.acties || []) {
      const aw = `${waar}, actie '${a.id}'`;
      if (!a.id) fouten.push(`${waar}: een actie mist een id.`);
      if (actieIds.has(a.id)) fouten.push(`${aw} komt dubbel voor.`);
      actieIds.add(a.id);
      for (const r of Object.keys(a.kosten || {})) if (!resIds.has(r)) fouten.push(`${aw} kost onbekende resource '${r}'.`);
      if (a.vereist_gebouw != null && !gebIds.has(a.vereist_gebouw)) fouten.push(`${aw} vraagt onbekend gebouw '${a.vereist_gebouw}'.`);
      if (!(a.druk < 0)) fouten.push(`${aw} moet de druk verlagen ('druk' negatief).`);
      if (a.vertraging_dagen != null && !(Number.isInteger(a.vertraging_dagen) && a.vertraging_dagen >= 0 && a.vertraging_dagen <= 40 && a.vertraging_dagen < b.deadline_dagen)) fouten.push(`${aw}: 'vertraging_dagen' moet een geheel getal van 0 tot 40 zijn en kleiner dan 'deadline_dagen'.`);
      if (a === b.acties[b.acties.length - 1] && b.acties.every((x) => (x.vertraging_dagen ?? 0) > 0)) waarschuwingen.push(`${waar}: elke aanpak heeft vertraging; geef er minstens één die meteen werkt.`);
      checkEffect(aw, a.effect || {}, resIds, waarschuwingen, fouten, p);
    }
    if ((b.acties || []).length && b.acties.every((a) => a.vereist_gebouw)) waarschuwingen.push(`${waar}: elke actie vraagt een gebouw; geef er minstens één die altijd kan.`);
    const u = b.uitbarsting || {};
    if (u.event != null && !eventIds.has(u.event)) fouten.push(`${waar}: uitbarsting verwijst naar onbekend event '${u.event}'.`);
    checkEffect(`${waar}, uitbarsting`, u.effect || {}, resIds, waarschuwingen, fouten, p);
    checkEffect(`${waar}, opgelost`, b.opgelost?.effect || {}, resIds, waarschuwingen, fouten, p);
  }
}
