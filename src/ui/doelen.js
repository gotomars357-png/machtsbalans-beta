// Doelbalk, "bijna klaar" en sessie-overzicht (docs/beleving.md §2 haak 1-3, §3, §11 klus 1 en 3).
// Het spel laat nooit een leeg moment zien: bovenin de kaart staat altijd één volgend doel met voortgang en een korte
// reden, daaronder wat er binnenkort klaar is. Alles wordt afgelezen uit de spelstand; deze laag zet niets in de engine
// en geeft geen orders. De rekenkant (kiesDoel, bijnaKlaar, sessieBasis, sessieOverzicht) is puur en draait ook
// headless (tools/doelentest.mjs); maakDoelen is de DOM-kant.

import * as sim from '../engine/sim.js';
import * as leger from '../engine/leger.js';
import { woningCapaciteit, campagneStatus } from '../engine/samenleving.js';
import { mediaStatus, overnameStatus } from '../engine/media.js';

const KIES_INTERVAL = 3000; // zo vaak mag de balk naar een ander doel springen
const VERNIEUW = 700; // voortgang en "bijna klaar" vaker bijwerken
const GLOED_DUUR = 6000;
const SESSIE_DAGEN = 300; // 5 minuten op tempo 1×
const SESSIE_TOON = 8000;
const ONHAALBAAR = 4; // bij zo'n overmacht train je de achterstand niet meer weg
// Een dreiging die blijft hangen mag de balk niet dichtzetten: na RUST_NA dagen hetzelfde dreigingsdoel wisselt hij
// om de RUST_WISSEL dagen met het beste andere doel.
const RUST_NA = 30;
const RUST_WISSEL = 20;

const komma = (v, d = 1) => v.toFixed(d).replace('.', ',');
const rond = (v) => Math.round(v);

// ---------- hulpjes op de spelstand ----------

function speler(s) { return s.landen[s.speler]; }

function tabVan(g) {
  return g.categorie === 'maatschappij' ? 'volk' : g.categorie === 'leger' ? 'leger' : 'economie';
}

// Kan de speler dit gebouw nu of na wat sparen neerzetten? Sparen telt alleen als het tekort ook echt binnenkomt.
function bouwKans(s, g) {
  const c = speler(s);
  if (!g || !sim.isOntgrendeld(s, g.id)) return null;
  if (c.bouw.length >= s.pack.model.max_bouw) return null;
  if (sim.vrijePlekken(s, c, g.id) <= 0) return null;
  const kosten = sim.bouwKosten(s, c, g.id);
  let voortgang = 1;
  let wacht = 0;
  let mist = '';
  for (const [r, v] of Object.entries(kosten)) {
    const heb = c.voorraad[r] ?? 0;
    if (heb >= v) continue;
    const erbij = r === s.pack.rollen.geld ? c.inkomen : c.netto[r] ?? 0;
    if (!(erbij > 0)) return null; // komt niet binnen: dan is het geen doel dat je kunt halen
    voortgang = Math.min(voortgang, Math.max(0, heb) / v);
    const d = Math.ceil((v - heb) / erbij);
    if (d > wacht) { wacht = d; mist = `${rond(v - heb)}${s.pack.resIndex[r]?.icoon ?? ''}`; }
  }
  return { kosten, voortgang, wacht, mist };
}

// Een bouwdoel: de reden plus, als je nog moet sparen, hoe lang nog.
function bouwDoel(s, g, { id, titel, waarom, voortgang, soort = 'opbouwen' }) {
  const k = bouwKans(s, g);
  if (!k) return null;
  const spaar = k.wacht ? ` · nog ${k.mist} sparen (±${k.wacht} d)` : ' · klik om te plaatsen';
  return {
    id: id ?? `bouw:${g.id}`, soort, titel: titel ?? `Bouw: ${g.naam}`, waarom: waarom + spaar,
    voortgang: voortgang ?? k.voortgang, naar: { gebouw: g.id, tab: tabVan(g), knop: `[data-actie="plaats"][data-id="${g.id}"]` },
  };
}

// Goedkoopste gebouw dat aan een eigenschap voldoet en dat je kunt neerzetten.
function besteGebouw(s, filter, waarde = () => 1) {
  let best = null;
  let bs = -Infinity;
  for (const g of s.pack.gebouwen) {
    if (!filter(g) || !bouwKans(s, g)) continue;
    const prijs = sim.kostenInGeld(s, sim.bouwKosten(s, speler(s), g.id)) || 1;
    const score = waarde(g) / prijs;
    if (score > bs) { bs = score; best = g; }
  }
  return best;
}

const aantal = (c, id) => (c.gebouwen[id] || 0) + c.bouw.filter((b) => b.gebouw === id).length;
const heeftOf = (s, filter) => s.pack.gebouwen.some((g) => filter(g) && aantal(speler(s), g.id) > 0);

// Een eenheid die kan vechten en die je nu kunt opleiden.
function trainbareEenheid(s) {
  for (const e of s.pack.eenheden) {
    if (!(e.aanval > 0) || e.kolonist || e.vaart) continue;
    if (leger.trainStatus(s, s.speler, e.id).ok) return e;
  }
  return null;
}

// ---------- de doelen, in volgorde van voorrang ----------

function oorlogDoel(s) {
  const c = speler(s);
  const oorlogen = leger.oorlogenVan(s, c);
  if (!oorlogen.length) return null;
  const o = oorlogen[0];
  const mijn = leger.partij(s, c);
  const ander = o.a === mijn ? o.b : o.a;
  const naam = leger.partijNaam(s, ander);
  const jij = leger.partijSterkte(s, mijn), zij = leger.partijSterkte(s, ander);
  const sterkte = `Sterkte jij ${rond(jij)} · zij ${rond(zij)}`;
  const voortgang = jij / Math.max(1, jij + zij);
  const vrede = { tab: 'leger', knop: `[data-actie="vrede"][data-id="${ander}"]` };
  if (o.vredesaanbod || leger.vredeStatus(s, s.speler, o).ok) {
    return { id: `vrede:${ander}`, soort: 'dreiging', titel: `Sluit vrede met ${naam}`, waarom: `Ze nemen het aan. ${sterkte}`, voortgang, naar: vrede };
  }
  const e = trainbareEenheid(s);
  if (e) return { id: `oorlog-train:${ander}`, soort: 'dreiging', titel: `Train ${e.naam.toLowerCase()}: oorlog met ${naam}`, waarom: sterkte, voortgang, naar: { tab: 'leger', knop: `[data-actie="train"][data-id="${e.id}"]` } };
  // Vrede weigeren ze en trainen kan nu niet: wijs alleen naar iets wat wel kan (een kazerne), anders geen oorlogsdoel.
  const g = kazerneTeBouwen(s);
  return g ? bouwDoel(s, g, { id: `oorlog-bouw:${ander}`, soort: 'dreiging', titel: `Oorlog met ${naam}. Bouw: ${g.naam}`, waarom: sterkte }) : null;
}

// Het gebouw waarin je vechtende eenheden opleidt, als je er nog geen hebt.
function kazerneTeBouwen(s) {
  const e = s.pack.eenheden.find((x) => x.aanval > 0 && !x.vaart && !x.kolonist);
  const g = e && s.pack.gebouwIndex[e.gebouw];
  return g && aantal(speler(s), g.id) === 0 ? g : null;
}

function stabiliteitDoel(s) {
  const c = speler(s);
  if (c.stab >= 35) return null;
  return {
    id: 'stab', soort: 'dreiging', titel: `Stabiliteit ${rond(c.stab)}: verlaag de belasting`,
    waarom: 'Onder 30 dreigen onrust en val van je regering. Meer sociale verdeling helpt ook.',
    voortgang: c.stab / 50, naar: { tab: 'economie', knop: '#s-belasting' },
  };
}

function moraalDoel(s) {
  const c = speler(s);
  const oorlog = leger.oorlogenVan(s, c).length > 0;
  if (c.moraal >= 30 || !(oorlog || sim.isOntgrendeld(s, 'escalatie'))) return null;
  const a = (s.pack.acties.media || []).find((x) => x.type === 'propaganda');
  if (!a || !mediaStatus(s, s.speler, s.speler, a).ok) return null;
  return {
    id: 'moraal', soort: 'dreiging', titel: `Verhoog de strijdbereidheid: ${a.naam.toLowerCase()}`,
    waarom: `Strijdbereidheid ${rond(c.moraal)}: een moedeloos leger vecht half.`,
    voortgang: c.moraal / 50, naar: { tab: 'volk', knop: `[data-actie="media"][data-id="${a.id}"][data-doel="${s.speler}"]` },
  };
}

function complotDoel(s) {
  const c = speler(s);
  if (c.complot < 25) return null;
  const waarom = `Complotdruk ${rond(c.complot)} drukt je stabiliteit en productie.`;
  const voortgang = Math.max(0, 1 - c.complot / 100);
  const camp = (s.pack.acties.campagnes || []).find((a) => (a.effect?.complot ?? 0) < 0 && campagneStatus(s, s.speler, a).ok);
  if (camp) return { id: 'complot', soort: 'dreiging', titel: camp.naam, waarom, voortgang, naar: { tab: 'volk', knop: `[data-actie="campagne"][data-id="${camp.id}"]` } };
  const fc = (s.pack.acties.media || []).find((a) => a.type === 'verdediging' && mediaStatus(s, s.speler, s.speler, a).ok);
  if (fc) return { id: 'complot', soort: 'dreiging', titel: fc.naam, waarom, voortgang, naar: { tab: 'volk', knop: `[data-actie="media"][data-id="${fc.id}"][data-doel="${s.speler}"]` } };
  return null;
}

function pandemieDoel(s) {
  const p = s.pandemie;
  if (!p?.besmet?.[s.speler]) return null;
  if (s.pack.gebouwen.some((g) => g.zorg > 0 && speler(s).bouw.some((b) => b.gebouw === g.id))) return null; // er komt er al een aan
  const g = besteGebouw(s, (x) => x.zorg > 0);
  return g ? bouwDoel(s, g, { id: 'pandemie', soort: 'dreiging', waarom: `${p.naam} is in je land; zorg beperkt de schade` }) : null;
}

function schuldDoel(s) {
  const c = speler(s);
  if ((c.voorraad[s.pack.rollen.geld] ?? 0) >= 0) return null;
  return { id: 'schuld', soort: 'dreiging', titel: 'Je staat rood: verhoog de belasting', waarom: 'Rente en onrust lopen op. Bouw even niets bij.', voortgang: null, naar: { tab: 'economie', knop: '#s-belasting' } };
}

// Oorlog dreigt: een ander blok met spanning en een veel groter leger.
function dreigingDoel(s) {
  if (!sim.isOntgrendeld(s, 'escalatie') || !s.instellingen.systemen?.escalatie) return null;
  const c = speler(s);
  if (leger.oorlogenVan(s, c).length) return null;
  const mijn = leger.partijSterkte(s, leger.partij(s, c)) + 5;
  for (const b of s.blokken) {
    if (b.id === s.spelerBlok || b.leider < 0 || b.spanning < 20) continue;
    const verhouding = leger.partijSterkte(s, b.id) / mijn;
    if (verhouding < 1.5) continue;
    // Bij een enorme overmacht haal je ze niet in; dan beperk je met een leger vooral de schade.
    const waarom = `${b.naam} is ${komma(verhouding)}× zo sterk en de spanning loopt op.${verhouding > ONHAALBAAR ? ' Elke eenheid maakt een aanval duurder.' : ''}`;
    const e = trainbareEenheid(s);
    if (e) return { id: `dreiging:${b.id}`, soort: 'dreiging', titel: `Oorlog dreigt: train ${e.naam.toLowerCase()}`, waarom, voortgang: Math.min(1, 1 / verhouding), naar: { tab: 'leger', knop: `[data-actie="train"][data-id="${e.id}"]` } };
    const g = kazerneTeBouwen(s);
    if (g) return bouwDoel(s, g, { id: `dreiging:${b.id}`, soort: 'dreiging', titel: `Oorlog dreigt. Bouw: ${g.naam}`, waarom });
  }
  return null;
}

function overnameActie(s, type) {
  return (s.pack.acties.overname || []).find((a) => a.type === type);
}

// Hoe ver staat een land van een aansluiting of ultimatum? Gemiddelde over de voorwaarden.
function voorwaardenScore(vw) {
  let som = 0;
  for (const [, w, d, op] of vw) som += op === '≥' ? Math.min(1, Math.max(0, w) / d) : w <= d ? 1 : Math.max(0, d / w);
  return vw.length ? som / vw.length : 0;
}

function voorwaardenTekst(vw) {
  return vw.map(([naam, w, d, op]) => {
    const kort = naam.replace('Loyaliteit aan jouw blok', 'loyaliteit').replace('Jouw media-invloed', 'media').replace('Hun strijdbereidheid', 'strijdbereidheid').replace('Militaire overmacht', 'overmacht');
    const ok = op === '≥' ? w >= d : w <= d;
    const getal = (x) => (d < 10 ? komma(x) : String(rond(x)));
    return `${ok ? '✓' : '○'} ${kort} ${getal(w)}${op === '≥' ? `/${getal(d)}` : ` (max ${getal(d)})`}`;
  }).join(' · ');
}

// Het meest kansrijke land voor een vreedzame aansluiting; zwevende landen en buren gaan voor.
function besteAansluiting(s) {
  const a = overnameActie(s, 'aansluiting');
  if (!a) return null;
  const buren = leger.buurlanden(s, speler(s));
  let best = null;
  for (let i = 0; i < s.landen.length; i++) {
    const l = s.landen[i];
    if (i === s.speler || l.vast) continue;
    const st = overnameStatus(s, s.speler, i, a);
    if (!st.ok) continue;
    const score = voorwaardenScore(st.voorwaarden) + (l.alignment === 'zwevend' ? 0.04 : 0) + (buren.includes(i) ? 0.03 : 0);
    if (!best || score > best.score) best = { l, st, score, a };
  }
  return best;
}

function aansluitingKlaarDoel(s) {
  const b = besteAansluiting(s);
  if (!b?.st.slaagt) return null;
  return { id: `aansluiting-klaar:${b.l.id}`, soort: 'beslissen', titel: `Sluit ${b.l.naam} aan zonder oorlog`, waarom: 'Alle voorwaarden gehaald: open hun hoofdstad en kies Vreedzame aansluiting.', voortgang: 1, naar: { land: b.l.idx } };
}

function ultimatumDoel(s) {
  const a = overnameActie(s, 'ultimatum');
  if (!a) return null;
  const c = speler(s);
  for (const i of leger.buurlanden(s, c)) {
    const t = s.landen[i];
    if (!t || t.vast) continue;
    const st = overnameStatus(s, s.speler, i, a);
    if (st.ok && st.slaagt) return { id: `ultimatum:${t.id}`, soort: 'beslissen', titel: `Stel ${t.naam} een ultimatum`, waarom: `Je overmacht is groot genoeg: ${voorwaardenTekst(st.voorwaarden)}`, voortgang: 1, naar: { land: i } };
  }
  return null;
}

function aansluitingDoel(s) {
  const b = besteAansluiting(s);
  if (!b || b.st.slaagt) return null;
  return { id: `aansluiting:${b.l.id}`, soort: 'invloed', titel: `Haal ${b.l.naam} naar je blok`, waarom: voorwaardenTekst(b.st.voorwaarden), voortgang: voorwaardenScore(b.st.voorwaarden), naar: { land: b.l.idx } };
}

// Energie of voedsel raakt op: bouw iets dat het maakt (en het niet zelf verbruikt).
function tekortDoel(s) {
  const c = speler(s);
  const R = s.pack.rollen;
  for (const rol of ['energie', 'voedsel', 'grondstof']) {
    const r = R[rol];
    if (!r || !sim.isOntgrendeld(s, r)) continue;
    const netto = c.netto[r] ?? 0;
    const ratio = c.ratio[r] ?? 1;
    const dagen = netto < 0 ? (c.voorraad[r] ?? 0) / -netto : Infinity;
    if (ratio >= 1 && dagen >= (rol === 'grondstof' ? 25 : 40)) continue;
    const maakt = (g) => (g.productie?.[r] ?? 0) > 0 && !(g.verbruik?.[r] > 0);
    if (s.pack.gebouwen.some((g) => maakt(g) && c.bouw.some((b) => b.gebouw === g.id))) continue; // er komt er al een aan
    const g = besteGebouw(s, maakt, (x) => x.productie[r]);
    if (!g) continue;
    const res = s.pack.resIndex[r];
    const waarom = ratio < 1 ? `${res.naam} op: je productie valt stil` : `nog ${Math.max(1, rond(dagen))} dagen ${res.naam.toLowerCase()} op voorraad`;
    return bouwDoel(s, g, { id: `tekort:${r}`, soort: 'dreiging', waarom });
  }
  return null;
}

function woningDoel(s) {
  const c = speler(s);
  const cap = woningCapaciteit(s, c);
  if (c.L < cap * 0.97) return null;
  if (s.pack.gebouwen.some((g) => g.woningen > 0 && c.bouw.some((b) => b.gebouw === g.id))) return null;
  const g = besteGebouw(s, (x) => x.woningen > 0, (x) => x.woningen);
  return g ? bouwDoel(s, g, { id: 'wonen', waarom: `Je bevolking zit aan het plafond (${rond(c.L)}/${rond(cap)}): zonder woningen geen groei` }) : null;
}

// Doelen uit het pack (verhaal.doelen) die om een gebouw vragen.
function packBouwDoel(s) {
  for (const d of s.pack.verhaal.doelen || []) {
    if (s.doelenGehaald[d.id] || !d.voorwaarde?.gebouw) continue;
    const g = s.pack.gebouwIndex[d.voorwaarde.gebouw];
    if (g && aantal(speler(s), g.id) >= d.voorwaarde.minimaal) continue; // de laatste staat al in de steigers
    const v = sim.doelVoortgang(s, d);
    const doel = g && bouwDoel(s, g, { id: `pack:${d.id}`, titel: d.tekst, waarom: `${speler(s).gebouwen[g.id] || 0} van ${d.voorwaarde.minimaal}`, voortgang: v });
    if (doel) return doel;
  }
  return null;
}

// Versnellen: de eerste van elk soort gebouw dat de economie of je positie een duw geeft.
const VERSNELLERS = [
  { id: 'tech', filter: (s, g) => (g.productie?.[s.pack.rollen.tech] ?? 0) > 0, waarom: (s) => `${s.pack.resIndex[s.pack.rollen.tech]?.naam ?? 'Technologie'} laat je technologie groeien` },
  { id: 'school', filter: (s, g) => g.categorie === 'maatschappij' && (g.productiviteit > 0 || g.tech_groei > 0), waarom: () => 'Je arbeid wordt productiever en je land weerbaarder' },
  { id: 'omroep', filter: (s, g) => g.informatiecontrole > 0, waarom: () => 'Opent mediacampagnes en beschermt je eigen verhaal' },
  { id: 'haven', filter: (s, g) => g.handel_bonus > 0, waarom: () => 'Handel levert meer op, en schepen kunnen kolonies stichten' },
  { id: 'kazerne', filter: (s, g) => s.pack.eenheden.some((e) => e.gebouw === g.id && e.aanval > 0 && !e.vaart), waarom: () => 'Zonder leger ben je een makkelijk doelwit' },
];

function versnelDoel(s) {
  for (const v of VERSNELLERS) {
    const f = (g) => v.filter(s, g);
    if (heeftOf(s, f)) continue;
    const g = besteGebouw(s, f);
    if (g) return bouwDoel(s, g, { id: `versnel:${v.id}`, soort: 'versnellen', titel: `Bouw: ${g.naam} (je eerste)`, waarom: v.waarom(s) });
  }
  return null;
}

// Pack-doelen zonder gebouw: productie verdubbelen, technologie. Je haalt ze door te bouwen en te investeren.
function packOverigDoel(s) {
  for (const d of s.pack.verhaal.doelen || []) {
    if (s.doelenGehaald[d.id] || d.voorwaarde?.gebouw) continue;
    const v = d.voorwaarde || {};
    if (v.aantal_landen && !sim.isOntgrendeld(s, 'invloed')) continue;
    const tab = v.aantal_landen ? 'invloed' : 'economie';
    return { id: `pack:${d.id}`, soort: 'opbouwen', titel: d.tekst, waarom: v.productie_x ? 'Industrie, depots en chips laten je productie groeien' : v.tech_factor ? 'Chips en scholen laten je technologie groeien' : 'Doel van deze wereld', voortgang: Math.max(0, sim.doelVoortgang(s, d)), naar: { tab } };
  }
  return null;
}

// Groei: meer kapitaalvoorraad is meer productie (Y = A·K^α·L^β).
function groeiDoel(s) {
  const g = besteGebouw(s, (x) => x.kapitaalvoorraad > 0 && !x.knooppunt && !x.categorie, (x) => x.kapitaalvoorraad);
  return g ? bouwDoel(s, g, { id: 'groei', waarom: `Meer kapitaal in je land: +${g.kapitaalvoorraad} K, dus meer productie` }) : null;
}

// Laatste vangnet: de winroute waar je het dichtst bij bent. Er is altijd iets om naartoe te werken.
function winrouteDoel(s) {
  const b = s.blokken.find((x) => x.id === s.spelerBlok);
  let best = null;
  for (const o of s.pack.verhaal.overwinning || []) {
    let v = 0, titel = '', waarom = '';
    if (o.type === 'aandeel_productie') {
      v = b.aandeel / o.drempel;
      titel = `Groei naar ${rond(o.drempel * 100)}% van de wereldproductie`;
      waarom = `Nu ${rond(b.aandeel * 100)}% · winroute ${o.naam}`;
    } else if (o.type === 'aantal_landen') {
      if (!sim.isOntgrendeld(s, 'invloed')) continue;
      v = b.leden / o.drempel;
      titel = `Haal ${o.drempel} landen in je blok`;
      waarom = `Nu ${b.leden} · winroute ${o.naam}`;
    } else if (o.type === 'tech_factor') {
      const A = speler(s).A;
      v = (A - 1) / Math.max(0.01, o.drempel - 1);
      titel = `Breng je technologie naar ${komma(o.drempel)}`;
      waarom = `Nu ${komma(A, 2)} · winroute ${o.naam}`;
    } else continue;
    if (!best || v > best.voortgang) best = { id: `win:${o.type}`, soort: 'opbouwen', titel, waarom, voortgang: Math.max(0, Math.min(1, v)), naar: { tab: 'blokken' } };
  }
  return best;
}

// Volgorde: dreiging eerst, dan kansen die je nu kunt verzilveren, dan de fase van het spel.
const DREIGINGEN = [oorlogDoel, stabiliteitDoel, moraalDoel, complotDoel, pandemieDoel, schuldDoel, dreigingDoel];

export function kiesDoel(s, { zonderDreiging = false } = {}) {
  if (!s || s.uitkomst) return null;
  const invloed = sim.isOntgrendeld(s, 'invloed');
  const reeks = [
    ...(zonderDreiging ? [] : DREIGINGEN),
    aansluitingKlaarDoel, ultimatumDoel,
    tekortDoel, woningDoel,
    ...(invloed ? [aansluitingDoel, packBouwDoel, versnelDoel] : [packBouwDoel, versnelDoel]),
    packOverigDoel, groeiDoel, winrouteDoel,
  ];
  for (const f of reeks) {
    const d = f(s);
    if (d) return d;
  }
  return null;
}

// Kiest het doel en onthoudt (in geheugen, niet in de spelstand) hoe lang dezelfde dreiging al staat. Blijft een
// dreiging hangen, dan wisselt de balk met het beste kansdoel, zodat er altijd iets te doen blijft.
export function kiesMetRust(s, geheugen) {
  const d = kiesDoel(s);
  if (!d || d.soort !== 'dreiging') { geheugen.dreiging = null; return d; }
  if (geheugen.dreiging?.id !== d.id) geheugen.dreiging = { id: d.id, sinds: s.dag };
  const duur = s.dag - geheugen.dreiging.sinds;
  if (duur < RUST_NA || Math.floor((duur - RUST_NA) / RUST_WISSEL) % 2 === 1) return d;
  const ander = kiesDoel(s, { zonderDreiging: true });
  return ander ? { ...ander, waarom: `${ander.waarom} (let op: ${d.titel.toLowerCase()})` } : d;
}

// ---------- bijna klaar ----------

// Tot drie lopende dingen die binnenkort klaar zijn, met resterende dagen.
export function bijnaKlaar(s, max = 3) {
  if (!s) return [];
  const c = speler(s);
  const P = s.pack;
  const uit = [];
  for (const b of c.bouw) uit.push({ id: `bouw:${b.tegel}`, icoon: P.gebouwIndex[b.gebouw]?.icoon ?? '🏗', tekst: P.gebouwIndex[b.gebouw]?.naam ?? b.gebouw, dagen: b.klaar - s.dag, naar: { tegel: b.tegel } });
  for (let i = 0; i < c.training.length; i++) {
    const x = c.training[i];
    const e = leger.eenheidType(s, x.type);
    uit.push({ id: `train:${i}`, icoon: e?.icoon ?? '🪖', tekst: e?.naam ?? x.type, dagen: x.klaar - s.dag, naar: { tegel: x.tegel, tab: 'leger' } });
  }
  for (const k of s.contracten || []) {
    if (k.a !== s.speler && k.b !== s.speler) continue;
    const ander = s.landen[k.a === s.speler ? k.b : k.a]?.naam ?? '';
    if (k.status === 'actief') uit.push({ id: `contract:${k.id}`, icoon: '🤝', tekst: `Contract ${ander}`, dagen: k.einde - s.dag, naar: { knop: '[data-actie="contracten"]' } });
    else if (k.status === 'open' && k.b === s.speler) uit.push({ id: `aanbod:${k.id}`, icoon: '🤝', tekst: `Aanbod ${ander} verloopt`, dagen: k.tot - s.dag, naar: { knop: '[data-actie="contracten"]' } });
  }
  // Eenheden onderweg, gebundeld per bestemming. De dagen zijn een schatting: terrein kost meer of minder.
  const groepen = new Map();
  for (const u of s.eenheden) {
    if (u.land !== s.speler || !u.pad?.length) continue;
    const e = leger.eenheidType(s, u.type);
    const doel = u.pad[u.pad.length - 1];
    const dagen = Math.ceil(u.pad.length / Math.max(0.1, e?.snelheid ?? 1));
    const g = groepen.get(doel);
    if (g) { g.n += 1; g.dagen = Math.max(g.dagen, dagen); } else groepen.set(doel, { n: 1, dagen, e, doel, t: u.t });
  }
  for (const g of groepen.values()) {
    const tekst = g.n > 1 ? `${g.n} eenheden onderweg` : `${g.e?.naam ?? 'Eenheid'} onderweg`;
    uit.push({ id: `pad:${g.doel}`, icoon: g.e?.icoon ?? '➜', tekst, dagen: g.dagen, schatting: true, naar: { tegel: g.doel } });
  }
  return uit.filter((x) => x.dagen >= 0).sort((a, b) => a.dagen - b.dagen || (a.id < b.id ? -1 : 1)).slice(0, max);
}

// ---------- sessie-overzicht ----------

// Momentopname om groei tegen af te zetten. vanStart = de stand op dag 0 van deze partij (uit pack en geschiedenis).
export function sessieBasis(s, vanStart = false) {
  const c = speler(s);
  const blok = s.spelerBlok;
  const lid = (l) => l.alignment === blok;
  if (vanStart) {
    const pl = s.pack.landen[s.speler];
    let gebouwen = 0;
    for (const [g, n] of Object.entries(pl.gebouwen || {})) if (s.pack.gebouwIndex[g]) gebouwen += n;
    return {
      dag: 0, Y: s.geschiedenis[0]?.Y ?? c.Y, gebouwen, eenheden: 0, kolonies: 0,
      loyaliteit: s.pack.landen.map((l) => l.loyaliteit?.[blok] ?? 0),
      leden: null,
    };
  }
  let gebouwen = 0;
  for (const n of Object.values(c.gebouwen)) gebouwen += n;
  return {
    dag: s.dag, Y: c.Y, gebouwen, eenheden: s.eenheden.filter((u) => u.land === s.speler).length,
    kolonies: s.kolonies.filter((k) => k.land === s.speler).length,
    loyaliteit: s.landen.map((l) => l.loyaliteit[blok] ?? 0),
    leden: s.landen.filter(lid).length,
  };
}

// Wat er gegroeid is sinds de basis, als korte regels. Alleen wat er echt bij kwam.
export function sessieOverzicht(s, basis) {
  const nu = sessieBasis(s);
  const regels = [];
  const x = basis.Y > 0 ? nu.Y / basis.Y : 1;
  regels.push(`Productie ×${komma(x)}`);
  if (nu.gebouwen > basis.gebouwen) regels.push(`Gebouwen +${nu.gebouwen - basis.gebouwen}`);
  let beste = -1, winst = 0;
  for (let i = 0; i < s.landen.length; i++) {
    const l = s.landen[i];
    if (i === s.speler || l.vast) continue;
    const d = nu.loyaliteit[i] - (basis.loyaliteit[i] ?? nu.loyaliteit[i]);
    if (d > winst) { winst = d; beste = i; }
  }
  if (beste >= 0 && winst >= 1) regels.push(`${s.landen[beste].naam} loyaliteit +${rond(winst)}`);
  if (basis.leden != null && nu.leden > basis.leden) regels.push(`Blok +${nu.leden - basis.leden} land${nu.leden - basis.leden > 1 ? 'en' : ''}`);
  if (nu.eenheden > basis.eenheden) regels.push(`Eenheden +${nu.eenheden - basis.eenheden}`);
  if (nu.kolonies > basis.kolonies) regels.push(`Kolonies +${nu.kolonies - basis.kolonies}`);
  return regels;
}

// ---------- DOM: de balk, de klik en de sessiekaart ----------
// api komt uit main.js: { ui, zetTab, selecteer, toast }. Er gaan geen orders uit; alleen camera, tab en gloed.

export function maakDoelen(api) {
  const { ui } = api;
  const $ = (q) => document.querySelector(q);
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const st = { rust: {}, fout: false, doel: null, gekozen: 0, vernieuwd: 0, html: '', basis: null, volgendeKaart: SESSIE_DAGEN, gloed: null, knop: null, kaart: null };

  function start({ geladen = false, replay = false } = {}) {
    const s = ui.state;
    st.rust = {}; st.fout = false; st.doel = null; st.gekozen = 0; st.vernieuwd = 0; st.html = ''; st.gloed = null; st.knop = null;
    st.basis = sessieBasis(s);
    st.volgendeKaart = s.dag + SESSIE_DAGEN;
    $('#doelbalk').hidden = true;
    if (geladen && !replay && s.dag > 0) toonSessie(`Welkom terug op dag ${s.dag}`, 'Sinds de start van je partij', sessieOverzicht(s, sessieBasis(s, true)));
  }

  function verborgen(s) {
    return !s || s.replay || s.uitkomst || ui.tutorial || ui.tip || ui.modal;
  }

  // Een fout in de doelbalk mag het spel nooit stilzetten: dan verdwijnt alleen de balk.
  function tick(now) {
    if (st.fout) return;
    try { stap(now); } catch (err) {
      st.fout = true;
      const el = $('#doelbalk');
      if (el) el.hidden = true;
      console.error('doelbalk', err);
    }
  }

  function stap(now) {
    const s = ui.state;
    const el = $('#doelbalk');
    if (!el) return;
    plaatsSessie();
    if (verborgen(s)) { if (!el.hidden) el.hidden = true; return; }
    houdGloed(now);
    if (s.dag >= st.volgendeKaart) {
      toonSessie(`${s.dag - st.basis.dag} dagen verder`, `Dit groeide er sinds dag ${st.basis.dag}`, sessieOverzicht(s, st.basis));
      st.volgendeKaart = s.dag + SESSIE_DAGEN;
    }
    if (now - st.vernieuwd < VERNIEUW && !el.hidden) return;
    st.vernieuwd = now;
    const nieuw = kiesMetRust(s, st.rust);
    // Niet springen tussen doelen: een ander doel pas na een paar seconden. Meteen wisselen mag bij een nieuwe dreiging
    // en na een bouwdoel (dat verdwijnt zodra je het gebouw hebt geplaatst: de wissel is dan de bevestiging).
    const oud = st.doel;
    const wissel = !oud || !nieuw || nieuw.id === oud.id || now - st.gekozen > KIES_INTERVAL
      || (nieuw.soort === 'dreiging' && oud.soort !== 'dreiging') || oud.naar?.gebouw;
    if (wissel) {
      if (nieuw?.id !== oud?.id) st.gekozen = now;
      st.doel = nieuw;
    }
    render(el, s);
  }

  function render(el, s) {
    const d = st.doel;
    const bijna = bijnaKlaar(s);
    const kop = d ? { dreiging: 'Let op', beslissen: 'Nu mogelijk', invloed: 'Volgend doel', versnellen: 'Volgend doel', opbouwen: 'Volgend doel' }[d.soort] ?? 'Volgend doel' : '';
    const v = d?.voortgang == null ? null : Math.max(0, Math.min(1, d.voortgang));
    const html = (d ? `<button class="db-doel ${d.soort === 'dreiging' ? 'db-dreiging' : d.soort === 'beslissen' ? 'db-kans' : ''}" data-db="doel" title="${esc(`${d.titel}. ${d.waarom}`)}">
        <span class="db-kop">${kop}</span><span class="db-titel">${esc(d.titel)}</span>
        ${v == null ? '' : `<span class="db-balk"><span style="width:${(v * 100).toFixed(0)}%"></span></span><span class="db-pct">${(v * 100).toFixed(0)}%</span>`}
        <span class="db-waarom">${esc(d.waarom)}</span></button>` : '')
      + (bijna.length ? `<div class="db-bijna"><span class="db-kop">Bijna klaar</span>${bijna.map((b, i) => `<button data-db="bijna" data-i="${i}" title="${esc(b.tekst)}">${b.icoon} ${esc(b.tekst)} <b>${b.schatting ? '±' : ''}${b.dagen} d</b></button>`).join('')}</div>` : '');
    el.hidden = !html;
    if (html === st.html) return;
    st.html = html;
    el.innerHTML = html;
    const k = el.querySelector('[data-db="doel"]');
    if (k) k.onclick = () => gaNaar(st.doel?.naar);
    for (const b of el.querySelectorAll('[data-db="bijna"]')) b.onclick = () => gaNaar(bijna[+b.dataset.i]?.naar);
  }

  // Klik: open het juiste tabblad, vlieg naar het doel en zet de gloed van de tutorial erop.
  function gaNaar(naar) {
    const s = ui.state;
    if (!naar || !s || !ui.kaart) return;
    let t = -1;
    if (naar.gebouw) t = sim.kiesTegel(s, speler(s), naar.gebouw);
    if (naar.tegel != null) t = naar.tegel;
    if (naar.land != null) {
      t = s.pack.geo.hoofdstad[naar.land];
      api.selecteer(naar.land); // opent Invloed met dit land: daar staan de voorwaarden en de knoppen
    } else if (naar.tab && ui.tab !== naar.tab) api.zetTab(naar.tab);
    const tg = s.pack.geo.tegels[t];
    if (tg) {
      ui.kaart.vliegNaar(tg.x, tg.y, Math.max(ui.kaart.zoom, naar.land != null ? 2.5 : 3.5));
      ui.kaart.gloed = { t };
      st.gloed = { t, tot: performance.now() + GLOED_DUUR };
    }
    zetKnopGloed(naar.knop);
  }

  function zetKnopGloed(q) {
    for (const e of document.querySelectorAll('.db-gloed')) e.classList.remove('db-gloed', 'tut-gloed');
    st.knop = q ? { q, tot: performance.now() + GLOED_DUUR } : null;
    houdGloed(performance.now());
  }

  // Panelen worden opnieuw opgebouwd: zet de knopgloed terug tot de tijd om is; ruim de kaartgloed op als hij van ons is.
  function houdGloed(now) {
    if (st.knop) {
      const e = document.querySelector(st.knop.q);
      if (now > st.knop.tot) { if (e) e.classList.remove('db-gloed', 'tut-gloed'); st.knop = null; } else if (e && !e.classList.contains('db-gloed')) e.classList.add('db-gloed', 'tut-gloed');
    }
    if (st.gloed && now > st.gloed.tot) {
      if (ui.kaart?.gloed?.t === st.gloed.t && !ui.tutorial && !ui.tip) ui.kaart.gloed = null;
      st.gloed = null;
    }
  }

  // Een kaartje boven de meldingen: blijft 8 seconden, of tot je het wegklikt. Het spel loopt gewoon door.
  // Het staat los van #toasts, anders drukken de meldingen van dezelfde frame het meteen weg (daar blijven er maar 4).
  function toonSessie(titel, sub, regels) {
    if (!regels.length) return;
    st.kaart?.remove();
    const el = document.createElement('div');
    el.className = 'toast goed sessiekaart';
    st.kaart = el;
    el.innerHTML = `<div class="sk-kop"><b>${esc(titel)}</b><button class="knop klein" title="Sluiten">✕</button></div>
      <div class="zacht">${esc(sub)}</div><ul>${regels.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
    el.querySelector('button').onclick = () => el.remove();
    document.body.append(el);
    plaatsSessie();
    let tijd = setTimeout(() => el.remove(), SESSIE_TOON);
    el.onmouseenter = () => clearTimeout(tijd);
    el.onmouseleave = () => { tijd = setTimeout(() => el.remove(), 3000); };
  }

  // Net boven de stapel meldingen, die van onderaf groeit.
  function plaatsSessie() {
    const k = st.kaart;
    if (!k?.isConnected) return;
    const box = $('#toasts');
    const boven = box ? box.getBoundingClientRect().top : innerHeight - 76;
    k.style.bottom = `${Math.max(8, rond(innerHeight - boven + 6))}px`;
  }

  return { start, tick, gaNaar };
}
