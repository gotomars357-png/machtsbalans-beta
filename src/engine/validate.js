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

  if (m.classificatie === 'actueel') {
    waarschuwingen.push('Dit pack gaat over actuele verhoudingen. Leiders zijn archetypen; uitkomsten zijn spel, geen voorspelling.');
  }
  return { fouten, waarschuwingen };
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

function cmpVersie(a = '0', b = '0') {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
