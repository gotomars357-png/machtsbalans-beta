// C18b: de rekenkant van het vraagteken (docs/c18-plan.md, "c18b-hulpknop"). Puur: geen DOM, geen toeval, en de
// spelstand verandert nooit (alles wat vooruitrekent, doet dat op een kloon). Draait in node (tools/hulpknoptest.mjs,
// tools/marcelbot.mjs --bot hulp), in de Web Worker (src/ui/hulpwerker.js) en als terugval op de hoofdthread.
//
// Drie stappen:
//   kandidaten(s, ctx)  hoogstens 8 stappen die nu kunnen, elk met een order: wat, waarom, en een voorlopige score
//                       (de volgorde van belang). Bronnen: de wijzer (tekort, rem, kolonie, stil, vol), de dreigingen
//                       uit achterstand (c18c) en kiesDoel, en de strategische stappen hieronder.
//   reken(s, k, opt)    speelt de stap 60 dagen vooruit op een kloon, met een speler die verder de hulp volgt (de
//                       Marcel-bot), en vergelijkt met dezelfde 60 dagen zonder de stap (de basislijn).
//   kies(s, opt)        rekent de beste kandidaten door binnen het budget en kiest de hoogste score.
//
// De tijd komt van buiten (opt.klok); zonder klok is er geen tijdslimiet, zodat de bot in node deterministisch blijft.

import * as sim from '../engine/sim.js';
import * as leger from '../engine/leger.js';
import { overnameStatus } from '../engine/media.js';
import { campagneStatus } from '../engine/samenleving.js';
import { achterstand } from '../engine/bijsturing.js';
import { brandhaardenVan, goedkoopsteActie } from '../engine/brandhaarden.js';
import { keuzeStatus } from '../engine/events.js';
import { actieveVerbouw } from '../engine/verbouw.js';
import { toestand, oplossers, bouwKaartData, ergste, marktOplosser, groeiNu } from './evenwicht.js';
import { aanbevolen } from './bouwlade.js';
import { kandidaten as wijzerKandidaten, bijhouden, bouwPlek } from './wijzer.js';
import { kiesDoel, bouwKans } from './doelen.js';

// ---------- getallen ----------
export const VOORUIT_DAGEN = 60;   // zo ver rekent het ? vooruit
export const MAX_KANDIDATEN = 8;   // zoveel stappen bekijkt het
export const MAX_REKEN = 6;        // zoveel daarvan rekent het door (de rest krijgt alleen de schatting)
export const HERHAAL_ELKE = 3;     // een stap die je blijft doen (hefboom), doet de rekenspeler zo vaak opnieuw
export const SPELER_ELKE = 3;      // de rekenspeler beslist om de zoveel dagen (zoals de Marcel-bot)
export const LAATSTE_DAG = 2400;   // vanaf hier kort de vooruitrekening in tot het einde (dag_limiet van het pack gaat voor)
// Wanneer een strategische stap telt (de gewoonte die in de meting wint, docs/c18-plan.md "Wat we vonden").
export const RESERVE_BASIS = 150;  // hefboom pas als er zoveel geld + 1×Y overblijft (zoals de gids-bot)
export const REM_NETTO = 3;        // grondstof per dag waaronder een producent loont
export const TECH_BASIS = 2;       // zoveel techgebouwen wil je minstens ...
export const TECH_PER_DAGEN = 200; // ... plus één per zoveel speeldagen
export const TECH_ACHTER = 0.15;  // loopt een rivaal zoveel voor in technologie (A), dan bouw je bij zonder plafond
// Voorlopige score per soort (de volgorde van belang, en de schatting als er geen tijd is om te rekenen).
export const VOORRANG = {
  gevaar: 100, 'tekort-rood': 95, aansluiting: 85, rem: 70, markt: 64, tech: 60, land: 55, tekort: 50,
  kolonie: 40, stil: 35, vol: 30, groei: 20, spaar: 5, wacht: 0,
};
// De score van een doorgerekende stap: voorrang + gewichten × wat de vooruitrekening laat zien.
export const GEWICHT = { voortgang: 400, groei: 100, gevaar: 40, uitstel: 15, schade: 20 };

// ---------- teksten (kort en gewoon: wat hoogstens 8 woorden, waarom hoogstens 12) ----------
export const TEKST = {
  bouw: (g, waar) => `Bouw een ${g} ${waar}`,
  thuis: 'thuis',
  in: (naam) => `in ${naam}`,
  rem: (res) => `Je groei staat stil: te weinig ${res}.`,
  remMarkt: (res) => `Koop ${res} op de wereldmarkt`,
  remMarktWaarom: (res) => `Te weinig ${res}, en bouwen kan nu niet.`,
  tech: (blok) => (blok ? `${blok} loopt uit op technologie.` : 'Technologie maakt alles wat je doet productiever.'),
  land: (naam) => `Haal ${naam} naar je blok`,
  landWaarom: (h, winst) => `Met een ${h.toLowerCase()}: loyaliteit +${winst}.`,
  landRace: (blok) => `${blok} haalt landen binnen. Wees ze voor.`,
  aansluiting: (naam) => `Sluit ${naam} aan bij je blok`,
  aansluitingWaarom: 'Alle voorwaarden zijn gehaald. Het kost geen oorlog.',
  vrede: (naam) => `Sluit vrede met ${naam}`,
  vredeWaarom: 'Je verliest deze oorlog. Ze nemen vrede nu aan.',
  train: (e) => `Train een ${e}`,
  trainWaarom: (naam) => `${naam} is sterker. Versterk je verdediging.`,
  campagne: (naam) => `Start de ${naam.toLowerCase()}`,
  campagneWaarom: 'Het volk is onrustig. Dit geeft rust.',
  belasting: 'Verlaag de belasting een stukje',
  belastingWaarom: 'Het volk is onrustig. Lagere belasting geeft rust.',
  groei: 'Je bouwers hebben ruimte. Dit laat je productie groeien.',
  spaar: (g, n) => `Spaar ${n} ${n === 1 ? 'dag' : 'dagen'} voor een ${g}`,
  spaarWaarom: (res) => `Dan komt er weer ${res} binnen.`,
  wacht: 'Je bouwers zijn druk bezig',
  wachtWaarom: (n) => `Over ${n} ${n === 1 ? 'dag' : 'dagen'} kan er weer iets bij.`,
  sparen: 'Even sparen', // review: er kan nu niets, en je bouwers zijn niet allemaal bezig
  sparenWaarom: 'Er kan nu niets bij. Kijk over een paar dagen weer.',
  komtEraan: (g) => `Je ${g} is in aanbouw`,
  komtEraanWaarom: (res) => `Daarna komt er meer ${res} binnen. Spaar tot dan.`,
  goed: 'Je staat er goed voor.',
  volgende: (wat) => `Volgende kans: ${wat.charAt(0).toLowerCase()}${wat.slice(1)}.`,
  over: (n) => `Over ${n} dagen:`,
  productie: (p) => `${p > 0 ? '+' : '−'}${Math.abs(p)}% productie`,
  perDag: (n, icoon) => `${n > 0 ? '+' : '−'}${Math.abs(n)} ${icoon} per dag`,
  loyaal: (naam, n) => `loyaliteit van ${naam} +${n}`,
  technologie: (p) => `technologie +${p}%`, // review: in procenten; "+0,01" zei een speler niets
  blokErbij: 'Je blok krijgt er direct een land bij.',
  blokOver: (n, naam) => `Over ${n} dagen hoort ${naam} bij je blok.`, // review: na een reeks hefbomen, niet direct
  wint: (blok, n, zeker) => `${blok} wint over ${zeker ? '' : 'ongeveer '}${n} dagen.`,
  // review: "Dit stelt dat uit" verwees naar niets als er geen aftelling op het kaartje stond; 60 is de rand van de rekening
  uitstel: (n, max) => `Daarmee win je ${n >= max ? 'minstens ' : ''}${n} dagen tijd.`,
  redt: 'Zonder deze stap verlies je binnen 60 dagen.',
  rekenen: 'Even rekenen…',
  verwacht: (t) => `Verwacht: ${t}`,
  meerGrondstof: (res) => `meer ${res}`,
  meerProductie: 'meer productie',
  meerLoyaliteit: 'meer steun voor je blok',
  minderGevaar: 'minder gevaar',
  meerTech: 'snellere technologie',
};

const rond = (v) => Math.round(v);
const spelerVan = (s) => s.landen[s.speler];
const projecten = (c) => c.bouw.length + actieveVerbouw(c);
const resNaam = (s, r) => (s.pack.resIndex[r]?.naam ?? 'grondstof').toLowerCase();
const gebouwNaam = (s, id) => s.pack.gebouwIndex[id]?.naam ?? 'gebouw';
const blokNaam = (s, id) => s.blokken.find((b) => b.id === id)?.naam ?? id;

function waarTekst(s, gebied) {
  if (gebied < 0 || gebied === s.pack.geo.hoofdstad[s.speler]) return TEKST.thuis;
  const k = s.kolonies.find((x) => x.t === gebied);
  return TEKST.in(k?.naam ?? s.landen[s.speler].naam);
}

// ---------- de rekenspeler: de Marcel-bot (ook tools/marcelbot.mjs gebruikt deze, zodat ze gelijk blijven) ----------

export function beantwoord(s) {
  const ev = s.pack.events.find((e) => e.id === s.pendingEvent.id);
  const i = ev.keuzes.findIndex((k) => keuzeStatus(s, k).ok);
  sim.issueOrder(s, { type: 'keuze', index: Math.max(0, i) });
}

// Brandhaarden zoals de AI: de goedkoopste aanpak op de drempel, als er geld is.
export function haarden(s) {
  const c = s.landen[s.speler];
  const P = s.pack;
  for (const h of brandhaardenVan(s, s.speler)) {
    if (h.wacht?.length || !(c.voorraad[P.rollen.geld] > 60)) continue;
    if (h.druk < P.model.brandhaard_ai_drempel) continue;
    const a = goedkoopsteActie(s, h);
    if (a) sim.issueOrder(s, { type: 'brandhaard', id: h.id, actie: a.id });
  }
}

// De beginner die de hulp volgt: doelbalk (bouwdoel dat nu kan), dan bouwlade.aanbevolen, dan het wijzerkaartje; bij
// een rem in de meter en niets te bouwen koopt hij grondstof als het kaartje dat aanbiedt. Geen invloed, media of oorlog.
export function maakVolger(opties = {}) {
  const mem = { dag: null, stilSinds: null, volSinds: {} };
  const tel = { doel: 0, aanbevolen: 0, wijzer: 0, markt: 0, niets: 0, beslisdagen: 0 };
  const markt = opties.markt !== false;
  function volger(s) {
    const c = s.landen[s.speler];
    const P = s.pack;
    if (s.pendingEvent) { beantwoord(s); return; }
    haarden(s);
    const lijst = toestand(s);
    bijhouden(s, mem, lijst);
    if (s.dag % SPELER_ELKE !== 0) return;
    if (projecten(c) >= P.model.max_bouw) return;
    tel.beslisdagen++;
    const bouw = (id, bron) => {
      if (!id || !bouwKaartData(s, id, lijst).kan) return false;
      const r = sim.issueOrder(s, { type: 'bouw', gebouw: id });
      if (r.ok) tel[bron]++;
      return r.ok;
    };
    const d = kiesDoel(s);
    if (d?.naar?.gebouw) { const k = bouwKans(s, P.gebouwIndex[d.naar.gebouw]); if (k.kan && !k.wacht && bouw(d.naar.gebouw, 'doel')) return; }
    const adv = aanbevolen(s, lijst);
    if (adv && bouw(adv.gebouw, 'aanbevolen')) return;
    const ks = wijzerKandidaten(s, { lijst, stilSinds: mem.stilSinds, volSinds: mem.volSinds }, () => true, 6);
    for (const k of ks) if (k.actie?.type === 'bouw' && bouw(k.actie.gebouw, 'wijzer')) return;
    if (markt) {
      const e = ergste(s, lijst);
      if (e.niveau === 'rem') {
        const m = oplossers(s, e.item.r, 3, lijst).find((o) => o.soort === 'markt' && o.kan);
        if (m && sim.issueOrder(s, m.actie).ok) { tel.markt++; return; }
      }
    }
    tel.niets++;
  }
  volger.tel = tel;
  volger.mem = mem;
  return volger;
}

// ---------- kandidaten ----------

// Een bouwstap op de beste plek, als het gebouw nu kan. velden: { sleutel, soort, wat?, waarom, verwacht, r? }.
function bouwStap(s, lijst, gebouwId, velden, bekeken = -1) {
  if (!gebouwId || !bouwKaartData(s, gebouwId, lijst).kan) return null;
  const p = bouwPlek(s, gebouwId, bekeken);
  if (p.tegel < 0) return null;
  const tegel = p.tegel;
  return {
    wat: TEKST.bouw(gebouwNaam(s, gebouwId), waarTekst(s, p.gebied)), ...velden,
    doe: { type: 'bouw', gebouw: gebouwId, gebied: p.gebied, tegel },
    order: () => ({ type: 'bouw', gebouw: gebouwId, tegel }),
  };
}

// De grondstofproducent met de meeste grondstof per prijs die nu een plek heeft (ook als hij nog niet te betalen is).
function besteProducent(s, rid) {
  const P = s.pack;
  const c = spelerVan(s);
  let best = null;
  for (let i = 0; i < P.gebouwen.length; i++) {
    const g = P.gebouwen[i];
    const o = g.productie?.[rid];
    if (!o || (g.verbruik?.[rid] ?? 0) > 0 || !sim.isOntgrendeld(s, g.id) || !sim.vrijePlekken(s, c, g.id)) continue;
    const sc = o / Math.max(1, sim.kostenInGeld(s, sim.bouwKosten(s, c, g.id)));
    if (!best || sc > best.sc) best = { id: g.id, sc };
  }
  return best?.id ?? null;
}

function komtAl(s, r) { return komtAan(s, r) != null; }
function komtAan(s, r) {
  const c = spelerVan(s);
  for (let i = 0; i < c.bouw.length; i++) if ((s.pack.gebouwIndex[c.bouw[i].gebouw]?.productie?.[r] ?? 0) > 0) return c.bouw[i].gebouw;
  return null;
}

// Remt de bouwgrondstof je groei? De meter zegt 'rem' (c18a), of: er komt minder dan REM_NETTO per dag binnen en je
// hebt te weinig voor het volgende groeigebouw.
function remGrondstof(s, lijst) {
  const P = s.pack;
  const R = P.rollen;
  const c = spelerVan(s);
  const rem = lijst.find((x) => x.niveau === 'rem' && x.rol === 'grondstof');
  if (rem) return rem.r;
  const r = R.grondstof;
  if (!r || !sim.isOntgrendeld(s, r)) return null;
  const kapG = P.gebouwen.filter((g) => g.kapitaalvoorraad > 0 && !g.categorie && !g.knooppunt).sort((a, b) => b.kapitaalvoorraad - a.kapitaalvoorraad)[0]?.id;
  const nodig = kapG ? sim.bouwKosten(s, c, kapG)[r] ?? 0 : 0;
  return (c.netto[r] ?? 0) < REM_NETTO && (c.voorraad[r] ?? 0) < nodig ? r : null;
}

function remStappen(s, lijst, uit) {
  const r = remGrondstof(s, lijst);
  if (!r || komtAl(s, r)) return;
  const res = resNaam(s, r);
  const icoon = s.pack.resIndex[r]?.icoon ?? '';
  const g = besteProducent(s, r);
  const k = g && bouwStap(s, lijst, g, { sleutel: `rem:${r}`, soort: 'rem', icoon, waarom: TEKST.rem(res), verwacht: TEKST.meerGrondstof(res), r });
  if (k) { uit.push(k); return; }
  // Bouwen kan nu niet: dan de markt (c18a), en anders sparen.
  const m = marktOplosser(s, r);
  if (m?.kan) {
    uit.push({
      sleutel: `markt:${r}`, soort: 'markt', icoon: '⚖', wat: TEKST.remMarkt(res), waarom: TEKST.remMarktWaarom(res), verwacht: TEKST.meerGrondstof(res), r,
      doe: { type: 'markt', r }, order: () => ({ ...m.actie }),
    });
    return;
  }
  if (g && projecten(spelerVan(s)) < s.pack.model.max_bouw) {
    const kans = bouwKans(s, s.pack.gebouwIndex[g]);
    if (kans.kan && kans.wacht > 0) {
      uit.push({ sleutel: `spaar:${g}`, soort: 'spaar', icoon: '⏳', wat: TEKST.spaar(gebouwNaam(s, g), kans.wacht), waarom: TEKST.spaarWaarom(res), verwacht: TEKST.meerGrondstof(res), r, doe: { type: 'bouw', gebouw: g, gebied: -1, tegel: -1 }, order: () => null });
    }
  }
}

// Technologie: houd het aantal techgebouwen bij (TECH_BASIS + dag/TECH_PER_DAGEN). Loopt een rivaal voor op technologie
// (zijn A ligt hoger, of hij gaat op de techroute af), dan zonder plafond, en daarna ook onderzoek (tech_groei).
function techVoorsprong(s) {
  let best = null;
  for (let i = 0; i < s.landen.length; i++) {
    const c = s.landen[i];
    if (!c.kern || c.blok === s.spelerBlok) continue;
    if (!best || c.A > best.A) best = { A: c.A, blok: c.blok };
  }
  return best;
}

function techStap(s, lijst, a, uit) {
  const P = s.pack;
  const tech = P.rollen.tech;
  const c = spelerVan(s);
  if (!tech || projecten(c) >= P.model.max_bouw) return;
  const doel = TECH_BASIS + s.dag / TECH_PER_DAGEN;
  const v = techVoorsprong(s);
  const rivaal = a.besteAI?.route === 'tech_factor' && a.ernst !== 'voor' ? a.besteAI.blok : v && v.A > c.A + TECH_ACHTER ? v.blok : null;
  let best = null;
  for (let ronde = 0; ronde < 2 && !best; ronde++) {
    if (ronde === 1 && !rivaal) break;
    for (let i = 0; i < P.gebouwen.length; i++) {
      const g = P.gebouwen[i];
      const maakt = (g.productie?.[tech] ?? 0) > 0;
      if (ronde === 0 ? !maakt : !(g.tech_groei > 0)) continue;
      if (!sim.isOntgrendeld(s, g.id) || (ronde === 0 && (c.gebouwen[g.id] || 0) >= doel && !rivaal)) continue;
      if (!bouwKaartData(s, g.id, lijst).kan) continue;
      const prijs = sim.kostenInGeld(s, sim.bouwKosten(s, c, g.id));
      if (!best || prijs < best.prijs) best = { id: g.id, prijs };
    }
  }
  if (!best) return;
  const k = bouwStap(s, lijst, best.id, { sleutel: `tech:${best.id}`, soort: 'tech', icoon: P.resIndex[tech]?.icoon ?? '◧', waarom: TEKST.tech(rivaal ? blokNaam(s, rivaal) : null), verwacht: TEKST.meerTech });
  if (k) uit.push(k);
}

// De beste hefboom op een land dat nog niet (stevig) bij je blok hoort, zoals de gids-bot. null als er niets kan.
function besteHefboom(s) {
  const P = s.pack;
  const R = P.rollen;
  const c = spelerVan(s);
  if (!sim.isOntgrendeld(s, 'invloed') || !(c.voorraad[R.geld] > RESERVE_BASIS + c.Y)) return null;
  let best = null;
  for (let i = 0; i < s.landen.length; i++) {
    const t = s.landen[i];
    if (t.vast || (t.alignment === s.spelerBlok && t.loyaliteit[s.spelerBlok] > 60)) continue;
    for (let j = 0; j < P.acties.hefbomen.length; j++) {
      const h = P.acties.hefbomen[j];
      if (!sim.hefboomStatus(s, s.speler, t.idx, h).ok) continue;
      const sc = (sim.verwachteWinst(s, s.speler, t.idx, h) / sim.kostenInGeld(s, sim.actieKosten(s, h, t))) * (t.Y + 20);
      if (!best || sc > best.sc) best = { sc, t, h };
    }
  }
  return best;
}

function landStap(s, a, uit) {
  const b = besteHefboom(s);
  if (!b) return;
  const { t, h } = b;
  const race = a.besteAI?.route === 'aantal_landen' && (a.ernst === 'achter' || a.ernst === 'gevaar');
  uit.push({
    sleutel: `land:${t.idx}`, soort: 'land', icoon: '🤝', wat: TEKST.land(t.naam),
    waarom: race ? TEKST.landRace(blokNaam(s, a.besteAI.blok)) : TEKST.landWaarom(h.naam, rond(sim.verwachteWinst(s, s.speler, t.idx, h))),
    verwacht: TEKST.meerLoyaliteit, herhaal: true, land: t.idx, voorrang: race ? VOORRANG.land + 25 : VOORRANG.land,
    doe: { type: 'land', land: t.idx, tab: 'invloed', knop: `[data-actie="hefboom"][data-id="${h.id}"]` },
    order: (k) => { const x = besteHefboom(k); return x ? { type: 'hefboom', doel: x.t.idx, actie: x.h.id } : null; },
    eerste: { type: 'hefboom', doel: t.idx, actie: h.id },
  });
}

function aansluitingStap(s, uit) {
  if (!sim.isOntgrendeld(s, 'invloed')) return;
  const P = s.pack;
  const acties = P.acties.overname || [];
  for (let j = 0; j < acties.length; j++) {
    const a = acties[j];
    if (a.type !== 'aansluiting') continue;
    for (let i = 0; i < s.landen.length; i++) {
      const st = overnameStatus(s, s.speler, i, a);
      if (!st.ok || !st.slaagt) continue;
      const t = s.landen[i];
      uit.push({
        sleutel: `aansluiting:${i}`, soort: 'aansluiting', icoon: '🤝', wat: TEKST.aansluiting(t.naam), waarom: TEKST.aansluitingWaarom, verwacht: TEKST.blokErbij, land: i,
        doe: { type: 'land', land: i, tab: 'invloed', knop: `[data-actie="overname"][data-id="${a.id}"][data-doel="${i}"]` },
        order: () => ({ type: 'overname', actie: a.id, doel: i }),
      });
      return;
    }
  }
}

// Bij gevaar thuis: vrede, de verdediging trainen, of rust in het land.
function gevaarStappen(s, a, uit) {
  const P = s.pack;
  const c = spelerVan(s);
  for (let i = 0; i < a.dreigingen.length; i++) {
    const d = a.dreigingen[i];
    if (!d.gevaar) continue;
    if (d.soort === 'oorlog' || d.soort === 'beleg') {
      const p = leger.partij(s, c);
      const oorlogen = leger.oorlogenVan(s, c);
      for (let j = 0; j < oorlogen.length; j++) {
        const o = oorlogen[j];
        const st = leger.vredeStatus(s, s.speler, o);
        if (!st.ok) continue;
        const ander = o.a === p ? o.b : o.a;
        uit.push({ sleutel: `vrede:${ander}`, soort: 'gevaar', icoon: '🕊', wat: TEKST.vrede(leger.partijNaam(s, ander)), waarom: TEKST.vredeWaarom, verwacht: TEKST.minderGevaar, doe: { type: 'knop', tab: 'leger', knop: `[data-actie="vrede"][data-id="${ander}"]` }, order: () => ({ type: 'vrede', met: ander }) });
      }
      let beste = null;
      for (let j = 0; j < P.eenheden.length; j++) {
        const e = P.eenheden[j];
        if (e.vaart || e.kolonist || !(e.aanval > 0) || !leger.trainStatus(s, s.speler, e.id).ok) continue;
        const w = e.aanval + (e.hp ?? 0) / 10;
        if (!beste || w > beste.w) beste = { e, w };
      }
      if (beste) {
        const naam = d.tegen ? leger.partijNaam(s, d.tegen) : s.landen[d.door]?.naam ?? '';
        uit.push({ sleutel: `train:${beste.e.id}`, soort: 'gevaar', icoon: '🪖', wat: TEKST.train(beste.e.naam.toLowerCase()), waarom: TEKST.trainWaarom(naam), verwacht: TEKST.minderGevaar, doe: { type: 'knop', tab: 'leger', knop: `[data-actie="train"][data-id="${beste.e.id}"]` }, order: () => ({ type: 'train', eenheid: beste.e.id }) });
      }
    } else if (d.soort === 'onrust') {
      const camp = (P.acties.campagnes || []).find((x) => ((x.effect?.stabiliteit ?? 0) > 0 || (x.effect?.stabiliteit_doel ?? 0) > 0) && campagneStatus(s, s.speler, x).ok);
      if (camp) uit.push({ sleutel: `campagne:${camp.id}`, soort: 'gevaar', icoon: '📣', wat: TEKST.campagne(camp.naam), waarom: TEKST.campagneWaarom, verwacht: TEKST.minderGevaar, doe: { type: 'knop', tab: 'volk', knop: `[data-actie="campagne"][data-id="${camp.id}"]` }, order: () => ({ type: 'campagne', actie: camp.id }) });
      else if (c.belasting > 0.12) uit.push({ sleutel: 'belasting', soort: 'gevaar', icoon: '⚖', wat: TEKST.belasting, waarom: TEKST.belastingWaarom, verwacht: TEKST.minderGevaar, doe: { type: 'knop', tab: 'economie', knop: '#s-belasting' }, order: () => ({ type: 'beleid', belasting: +(c.belasting - 0.04).toFixed(2) }) });
    }
  }
}

// Een dreiging uit de doelbalk met een knop die een order is (train, vrede, campagne, media). Anders niets.
function doelStap(s, uit) {
  const d = kiesDoel(s);
  if (!d || d.soort !== 'dreiging' || !d.naar?.knop) return;
  const m = /data-actie="(\w+)"\]\[data-id="([^"]+)"\](?:\[data-doel="(\d+)"\])?/.exec(d.naar.knop);
  if (!m) return;
  const [, actie, id, doel] = m;
  const order = actie === 'train' ? { type: 'train', eenheid: id } : actie === 'vrede' ? { type: 'vrede', met: id }
    : actie === 'campagne' ? { type: 'campagne', actie: id } : actie === 'media' && doel != null ? { type: 'media', actie: id, doel: +doel } : null;
  if (!order) return;
  uit.push({ sleutel: d.id, soort: 'gevaar', icoon: '⚠', wat: d.titel, waarom: String(d.waarom ?? '').split(' · ')[0], verwacht: TEKST.minderGevaar, doe: { type: 'knop', tab: d.naar.tab, knop: d.naar.knop }, order: () => ({ ...order }) });
}

// De wijzer: tekorten, rem, kolonie, stilstaande bouwers en volle opslag, als stap met een order.
function wijzerStappen(s, ctx, lijst, uit) {
  const ks = wijzerKandidaten(s, { ...ctx, lijst }, (k) => k.actie?.type === 'bouw' || k.actie?.type === 'zoalsthuis', 6);
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i];
    if (k.actie.type === 'bouw') {
      const g = k.actie.gebouw;
      const soort = k.soort === 'tekort-rood' ? 'tekort-rood' : k.soort;
      const res = k.r ? resNaam(s, k.r) : null;
      uit.push({
        sleutel: `wijzer:${k.sleutel}`, soort, icoon: k.icoon, wat: TEKST.bouw(gebouwNaam(s, g), waarTekst(s, k.gebied)), waarom: k.zin.split('. ')[0] + '.',
        verwacht: res ? TEKST.meerGrondstof(res) : TEKST.meerProductie, r: k.r,
        doe: { type: 'bouw', gebouw: g, gebied: k.gebied, tegel: k.tegel }, order: () => ({ type: 'bouw', gebouw: g, tegel: k.tegel }),
      });
    } else if (k.actie.type === 'zoalsthuis') {
      // "Bouw zoals thuis" zet een wachtrij (order bouwrij); de stap opent het paneel, de speler bevestigt daar.
      uit.push({ sleutel: `wijzer:${k.sleutel}`, soort: 'kolonie', icoon: k.icoon, wat: k.zin.split('. ')[1]?.replace(/\.$/, '') || k.zin, waarom: k.zin.split('. ')[0] + '.', verwacht: TEKST.meerProductie, doe: { type: 'zoalsthuis', gebied: k.gebied, tegel: k.tegel }, order: () => null, geenOrder: true });
    }
  }
}

function groeiStap(s, lijst, uit) {
  const v = groeiNu(s, spelerVan(s));
  const k = v && bouwStap(s, lijst, v.gebouw, { sleutel: `groei:${v.gebouw}`, soort: 'groei', icoon: '🏭', waarom: TEKST.groei, verwacht: TEKST.meerProductie });
  if (k) uit.push(k);
}

function wachtStap(s, uit, lijst) {
  const c = spelerVan(s);
  if (projecten(c) < s.pack.model.max_bouw) {
    // Remt een grondstof en komt de producent er al aan, zeg dat dan (zo weet je waarop je wacht).
    const r = lijst && remGrondstof(s, lijst);
    const g = r && komtAan(s, r);
    const wat = g ? TEKST.komtEraan(gebouwNaam(s, g)) : TEKST.sparen;
    const waarom = g ? TEKST.komtEraanWaarom(resNaam(s, r)) : TEKST.sparenWaarom;
    uit.push({ sleutel: 'wacht', soort: 'wacht', icoon: '⏳', wat, waarom, verwacht: TEKST.meerProductie, doe: { type: 'geen' }, order: () => null, geenOrder: true });
    return;
  }
  let n = Infinity;
  for (let i = 0; i < c.bouw.length; i++) n = Math.min(n, c.bouw[i].klaar - s.dag);
  n = isFinite(n) ? Math.max(1, n) : 1;
  uit.push({ sleutel: 'wacht', soort: 'wacht', icoon: '⏳', wat: TEKST.wacht, waarom: TEKST.wachtWaarom(n), verwacht: TEKST.meerProductie, doe: { type: 'geen' }, order: () => null, geenOrder: true });
}

// Alle stappen die nu kunnen, de belangrijkste eerst (hoogstens MAX_KANDIDATEN). ctx: { lijst?, stilSinds, volSinds,
// bekekenGebied, achterstand? }. Elke stap: { sleutel, soort, icoon, wat, waarom, verwacht, voorrang, herhaal?, land?,
// r?, doe: {type: 'bouw'|'markt'|'land'|'knop'|'zoalsthuis'|'geen', ...}, order(s) → order of null }.
export function kandidaten(s, ctx = {}) {
  if (!s || s.uitkomst) return [];
  const lijst = ctx.lijst ?? toestand(s);
  const a = ctx.achterstand ?? achterstand(s);
  const uit = [];
  gevaarStappen(s, a, uit);
  doelStap(s, uit);
  aansluitingStap(s, uit);
  remStappen(s, lijst, uit);
  techStap(s, lijst, a, uit);
  landStap(s, a, uit);
  wijzerStappen(s, ctx, lijst, uit);
  groeiStap(s, lijst, uit);
  // Review: ook als er niets kan, staat er een stap (eerst stond dan "Je bouwers zijn druk bezig", ook als ze stilstonden).
  if (projecten(spelerVan(s)) >= s.pack.model.max_bouw || !uit.length) wachtStap(s, uit, lijst);
  // Dubbel (zelfde gebouw of zelfde sleutel): de eerste wint.
  const gezien = {};
  const schoon = [];
  for (let i = 0; i < uit.length; i++) {
    const k = uit[i];
    const dub = k.doe?.type === 'bouw' && k.doe.gebouw ? `g:${k.doe.gebouw}` : k.sleutel;
    if (gezien[dub] || gezien[k.sleutel]) continue;
    gezien[dub] = true;
    gezien[k.sleutel] = true;
    k.voorrang ??= VOORRANG[k.soort] ?? 0;
    schoon.push(k);
  }
  schoon.sort((x, y) => y.voorrang - x.voorrang);
  return schoon.slice(0, MAX_KANDIDATEN);
}

// ---------- vooruitrekenen ----------

// Een kloon zonder pack (structuredClone), met het pack er weer aan en zonder replay.
export function kloon(s) {
  const k = structuredClone({ ...s, pack: null, replay: null });
  k.pack = s.pack;
  return k;
}

// Wat we na de vooruitrekening meten.
function meet(s, k) {
  const c = spelerVan(s);
  const a = achterstand(s);
  const verloren = !!(s.uitkomst && !s.uitkomst.spelerWint);
  return {
    Y: c.Y, A: c.A, stab: c.stab, verloren, gewonnen: !!s.uitkomst?.spelerWint, revoluties: c.revoluties ?? 0,
    gat: a.speler.voortgang - (a.besteAI?.voortgang ?? 0), dagenTotVerlies: a.dagenTotVerlies,
    netto: k?.r ? c.netto[k.r] ?? 0 : null, loyaal: k?.land != null ? s.landen[k.land].loyaliteit[s.spelerBlok] ?? 0 : null,
    blok: k?.land != null ? s.landen[k.land].alignment === s.spelerBlok : null,
  };
}

function speelDoor(k, dagen, stap) {
  const volger = maakVolger();
  const eind = k.dag + dagen;
  while (!k.uitkomst && k.dag < eind) {
    if (stap && !k.pendingEvent && k.dag % HERHAAL_ELKE === 0) { const o = stap.order(k); if (o) sim.issueOrder(k, o); }
    volger(k);
    sim.stapDag(k);
  }
}

export function dagenVooruit(s, dagen = VOORUIT_DAGEN) {
  const limiet = Math.min(LAATSTE_DAG, s.pack.verhaal?.dag_limiet ?? LAATSTE_DAG);
  return Math.max(1, Math.min(dagen, limiet - s.dag));
}

// De basislijn: dezelfde dagen zonder de stap. Eén keer per keuze.
export function basis(s, opt = {}) {
  const k = kloon(s);
  speelDoor(k, dagenVooruit(s, opt.dagen), null);
  return { k, dagen: dagenVooruit(s, opt.dagen) };
}

// Speel stap k vooruit en vergelijk met de basislijn. Geeft { ok, reden?, score, delta, regel3 } en verandert s niet.
export function reken(s, kand, opt = {}) {
  const dagen = dagenVooruit(s, opt.dagen);
  const b = opt.basis ?? basis(s, opt);
  const k = kloon(s);
  const o = kand.order(k);
  if (!o) return { ok: false, reden: 'Deze stap heeft geen order.' };
  const r = sim.applyOrder(k, o);
  if (!r.ok) return { ok: false, reden: r.reden ?? 'Kan nu niet.' };
  k.orders.push({ dag: k.dag, ...o });
  speelDoor(k, dagen, kand.herhaal ? kand : null);
  const m0 = meet(b.k, kand);
  const m1 = meet(k, kand);
  const delta = {
    dagen, Y: m0.Y > 0 ? (m1.Y - m0.Y) / m0.Y : 0, gat: m1.gat - m0.gat, A: m1.A - m0.A, Arel: m0.A > 0 ? (m1.A - m0.A) / m0.A : 0,
    netto: m1.netto != null ? m1.netto - m0.netto : null, loyaal: m1.loyaal != null ? m1.loyaal - m0.loyaal : null, blok: m1.blok && !m0.blok,
    gered: (m0.verloren && !m1.verloren) || m1.revoluties < m0.revoluties, schade: (!m0.verloren && m1.verloren) || m1.revoluties > m0.revoluties,
    uitstel: m0.dagenTotVerlies != null && m1.dagenTotVerlies != null ? Math.max(-dagen, Math.min(dagen, m1.dagenTotVerlies - m0.dagenTotVerlies)) : 0,
    dagenTotVerlies: m1.dagenTotVerlies,
  };
  const G = GEWICHT;
  let score = kand.voorrang + G.voortgang * delta.gat + G.groei * delta.Y + G.uitstel * (delta.uitstel / dagen);
  if (delta.gered) score += G.gevaar;
  if (delta.schade) score -= G.gevaar;
  if (delta.Y < -0.03 && delta.gat <= 0 && !delta.gered) score -= G.schade; // maakt het zichtbaar slechter
  return { ok: true, score, delta, regel3: regel3(s, kand, delta) };
}

// Regel 3 van het kaartje: wat het oplevert, in gewone woorden, uit de vooruitrekening.
export function regel3(s, k, d) {
  const delen = [];
  const p = rond(d.Y * 100);
  if (k.soort === 'aansluiting') delen.push(TEKST.blokErbij);
  else if (d.blok && k.land != null) delen.push(TEKST.blokOver(d.dagen, s.landen[k.land].naam));
  else {
    const stukken = [];
    if (k.land != null && d.loyaal != null && rond(d.loyaal) >= 1) stukken.push(TEKST.loyaal(s.landen[k.land].naam, rond(d.loyaal)));
    if (k.soort === 'tech' && rond((d.Arel ?? 0) * 100) >= 1) stukken.push(TEKST.technologie(rond(d.Arel * 100)));
    if (p >= 1) stukken.push(TEKST.productie(p)); // een daling noemen we niet: die komt vaak van toeval (een gebeurtenis), niet van de stap
    if (k.r && d.netto != null && Math.abs(d.netto) >= 0.5) stukken.push(TEKST.perDag(Math.abs(d.netto) >= 10 ? rond(d.netto) : +d.netto.toFixed(1), s.pack.resIndex[k.r]?.icoon ?? ''));
    if (stukken.length) delen.push(`${TEKST.over(d.dagen)} ${stukken.slice(0, 2).join(', ')}.`);
  }
  if (d.gered) delen.push(TEKST.redt);
  else if (d.uitstel >= 5) delen.push(TEKST.uitstel(rond(d.uitstel), d.dagen));
  return delen.length ? delen.join(' ').replace(/\s+/g, ' ').trim() : TEKST.verwacht(k.verwacht ?? TEKST.meerProductie);
}

// De aftelling als het ? 'gevaar' toont (zoals machtsbalansRegel: een lopende teller precies, een schatting afgerond).
export function aftelling(s, a) {
  const w = a.dreigingen.find((d) => d.soort === 'winroute' && d.route !== 'dag_limiet');
  if (!w || !w.gevaar) return null;
  return TEKST.wint(blokNaam(s, w.blok), w.zeker ? w.dagen : Math.max(10, Math.round(w.dagen / 10) * 10), w.zeker);
}

// ---------- kiezen ----------

// Kies de beste stap. opt: { klok: () => ms, budgetMs, dagen, max (MAX_REKEN), cache: { potje, dag, uitkomst: {sleutel: r} },
// vooruitElke (dagen dat een berekening geldig blijft), ctx }. Geeft { stap, andere: [hoogstens 2], ernst, aftelling,
// kandidaten, gerekend: aantal, geschat: bool }. De stap heeft { ...kandidaat, score, regel3, uitkomst? }.
export function kies(s, opt = {}) {
  if (!s || s.uitkomst) return null;
  const a = achterstand(s);
  const lijst = toestand(s);
  const ks = kandidaten(s, { ...(opt.ctx ?? {}), lijst, achterstand: a });
  const klok = opt.klok;
  const t0 = klok ? klok() : 0;
  const budget = opt.budgetMs ?? Infinity;
  const max = opt.max ?? MAX_REKEN;
  const cache = opt.cache;
  const elke = opt.vooruitElke ?? 0;
  const vers = cache && cache.potje === potjeVan(s) && s.dag >= cache.dag && s.dag - cache.dag < elke;
  if (cache && !vers) { cache.potje = potjeVan(s); cache.dag = s.dag; cache.uitkomst = {}; }
  let b = null;
  let gerekend = 0;
  let geschat = false;
  let duur = 0;
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i];
    k.score = k.voorrang;
    k.regel3 = TEKST.verwacht(k.verwacht ?? TEKST.meerProductie);
    if (k.geenOrder) continue;
    const oud = cache?.uitkomst?.[k.sleutel];
    if (oud) { toepas(k, oud); continue; }
    // Past de volgende berekening (even lang als de vorige) niet meer in het budget, dan blijft het bij de schatting.
    if (gerekend >= max || (klok && klok() - t0 + duur > budget)) { geschat = true; continue; }
    const t1 = klok ? klok() : 0;
    b ??= basis(s, opt);
    const r = reken(s, k, { ...opt, basis: b });
    if (klok) duur = klok() - t1;
    gerekend++;
    if (cache) cache.uitkomst[k.sleutel] = r.ok ? { score: r.score - k.voorrang, delta: r.delta, regel3: r.regel3 } : { fout: r.reden };
    toepas(k, r.ok ? { score: r.score - k.voorrang, delta: r.delta, regel3: r.regel3 } : { fout: r.reden });
  }
  const goed = rangschik(ks);
  const stap = goed[0] ?? null;
  return { stap, andere: goed.slice(1, 3), ernst: a.ernst, aftelling: aftelling(s, a), achterstand: a, kandidaten: ks, gerekend, geschat };
}

// De volgorde: wat niet kan valt af; een stap met een order gaat voor een stap zonder (sparen, wachten, het paneel van
// een kolonie); daarbinnen de hoogste score.
export function rangschik(ks) {
  const goed = ks.filter((k) => !k.fout);
  goed.sort((x, y) => (!!x.geenOrder - !!y.geenOrder) || (x.soort === 'spaar') - (y.soort === 'spaar') || (y.score - x.score));
  return goed;
}

// Zonder berekening: de score is de voorrang en regel 3 zegt wat je mag verwachten, zonder getal.
export function schat(ks) {
  for (let i = 0; i < ks.length; i++) { ks[i].score = ks[i].voorrang; ks[i].regel3 = TEKST.verwacht(ks[i].verwacht ?? TEKST.meerProductie); }
  return ks;
}

// Een uitkomst van de worker ({sleutel: {score, regel3, fout, gerekend}}) op kandidaten van de hoofdthread zetten.
export function zetUitkomst(ks, uitkomst) {
  for (let i = 0; i < ks.length; i++) {
    const u = uitkomst?.[ks[i].sleutel];
    if (!u) continue;
    if (u.fout) ks[i].fout = u.fout;
    else { ks[i].score = u.score; ks[i].regel3 = u.regel3; ks[i].gerekend = u.gerekend; }
  }
  return ks;
}

function toepas(k, r) {
  if (r.fout) { k.fout = r.fout; return; }
  k.score = k.voorrang + r.score;
  k.delta = r.delta;
  k.regel3 = r.regel3;
  k.gerekend = true;
}

export function potjeVan(s) {
  return `${s.pack.meta?.id ?? 'pack'}:${s.instellingen?.seed ?? 0}:${s.instellingen?.land ?? ''}`;
}

// Voor de bot: de order(s) van de gekozen stap (leeg als het een stap zonder order is).
export function kiesOrders(s, opt = {}) {
  const r = kies(s, opt);
  const k = r?.stap;
  if (!k || k.geenOrder) return [];
  const o = k.eerste ?? k.order(s);
  return o ? [o] : [];
}

// Hoe staat het ? erbij: 'grijs' (voor of gelijk), 'goud' (achter) of 'gevaar'.
export function stand(s) {
  const e = achterstand(s).ernst;
  return e === 'gevaar' ? 'gevaar' : e === 'achter' ? 'goud' : 'grijs';
}
