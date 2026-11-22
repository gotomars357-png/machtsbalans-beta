// C18c Meegroeiend: eerlijke tegenstand voor wie voor of achter staat (docs/c18-plan.md, sectie c18c).
//
// Twee delen:
// - achterstand(state): puur en alleen-lezen. Hoe staat de speler ervoor tegenover het beste AI-blok, hoeveel dagen
//   tot een verlies, en welke dreigingen er zijn. Werkt altijd, ook zonder meegroeiend (de ?-knop van c18b leest het).
// - bijsturingTick(state): alleen met instellingen.meegroeiend. Wie ver voorstaat (een AI-blok of de speler), wekt
//   wantrouwen bij de zwevende landen: zijn hefbomen en zijn aantrekkingskracht werken minder. Wie ver achter staat,
//   is het tegenwicht en krijgt iets meer gehoor. Na een zware klap volgt een wapenrust: de AI verklaart de speler
//   dan minder snel de oorlog. Alles is begrensd, beweegt langzaam en wordt gemeld.
//
// Determinisme: geen toeval, geen klok, itereren op index. Een factor verandert een effect of een drempel, nooit het
// aantal trekkingen van nextRandom.

import { partij, partijSterkte, oorlogenVan } from './leger.js';
import { log } from './sim.js';
import { DEFAULT_MODEL } from './defaults.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// De waarden staan in defaults.js (DEFAULT_MODEL.meegroeiend); een pack kan ze overschrijven in economy/model.json
// onder "meegroeiend", ook per moeilijkheid. Ontbreekt een waarde in het pack, dan geldt de standaard.
export const MEEGROEIEND_STANDAARD = DEFAULT_MODEL.meegroeiend;

// Eén waarde: eerst het niveau van de moeilijkheid in het pack, dan het pack, dan het niveau standaard, dan standaard.
export function mgWaarde(state, k) {
  const m = state.pack.model.meegroeiend ?? {};
  const niv = state.instellingen.moeilijkheid ?? 'normaal';
  return m[niv]?.[k] ?? m[k] ?? MEEGROEIEND_STANDAARD[niv]?.[k] ?? MEEGROEIEND_STANDAARD.normaal[k] ?? MEEGROEIEND_STANDAARD[k];
}

export const meegroeiendAan = (state) => state.instellingen.meegroeiend === true;

// ---------- voortgang en achterstand (puur) ----------

// Voortgang per winroute van één blok (1 = drempel gehaald), zoals tools/marcelbot.mjs.
export function voortgangVan(state, blokId) {
  const b = state.blokken.find((x) => x.id === blokId);
  const V = state.pack.verhaal.overwinning || [];
  const uit = {};
  for (let i = 0; i < V.length; i++) {
    const o = V[i];
    if (o.type === 'aandeel_productie') uit[o.type] = b.aandeel / o.drempel;
    else if (o.type === 'aantal_landen') uit[o.type] = b.leden / o.drempel;
    else if (o.type === 'tech_factor') {
      let A = 1;
      for (let j = 0; j < state.landen.length; j++) { const c = state.landen[j]; if (c.blok === blokId && c.kern && c.A > A) A = c.A; }
      uit[o.type] = (A - 1) / (o.drempel - 1);
    }
  }
  return uit;
}

function beste(v) {
  let route = null;
  let w = 0;
  for (const k of Object.keys(v)) if (route == null || v[k] > w) { route = k; w = v[k]; }
  return { route, voortgang: Math.max(0, w) };
}

// Per blok de beste route, de leider en de voorsprong op het op een na beste blok.
export function standen(state) {
  const lijst = state.blokken.map((b) => ({ blok: b.id, ...beste(voortgangVan(state, b.id)) }));
  let leider = null;
  let tweede = null;
  for (let i = 0; i < lijst.length; i++) {
    const x = lijst[i];
    if (!leider || x.voortgang > leider.voortgang) { tweede = leider; leider = x; } else if (!tweede || x.voortgang > tweede.voortgang) tweede = x;
  }
  return { lijst, leider, voorsprong: leider && tweede ? leider.voortgang - tweede.voortgang : 0 };
}

// Hoeveel dagen tot blok b een route haalt (null = niet te zeggen of niet voor het einde van de tijdlijn).
function dagenTot(state, blokId, route, p, trend) {
  const o = (state.pack.verhaal.overwinning || []).find((x) => x.type === route);
  if (!o) return null;
  const vanaf = Math.max(0, (o.min_dag ?? 300) - state.dag);
  if (route === 'aandeel_productie') {
    const teller = state.overwinningTellers[`${route}|${blokId}`] || 0;
    const duur = o.duur_dagen ?? 1;
    if (teller > 0) return Math.max(vanaf, duur - teller);
    if (p >= 1) return Math.max(vanaf, duur);
    if (!(trend > 0)) return null;
    return Math.max(vanaf, Math.ceil((1 - p) / trend) + duur);
  }
  if (p >= 1) return vanaf;
  if (!(trend > 0)) return null;
  return Math.max(vanaf, Math.ceil((1 - p) / trend));
}

// Voortgang uit een geschiedenisregel (vg wordt elke 5 dagen bewaard; oudere regels hebben alleen aandelen).
function vgUit(h, blokId) {
  return h?.vg?.[blokId] ?? null;
}

// Voortgang per dag over de laatste trend_dagen, per route (uit state.geschiedenis[].vg).
function trends(state, blokId, nu) {
  const g = state.geschiedenis;
  const T = mgWaarde(state, 'trend_dagen');
  let oud = null;
  for (let i = g.length - 1; i >= 0; i--) {
    if (state.dag - g[i].dag > T) break;
    if (vgUit(g[i], blokId)) oud = g[i];
  }
  const uit = {};
  if (!oud || oud.dag >= state.dag) return uit;
  const v = vgUit(oud, blokId);
  const routes = Object.keys(nu);
  for (let i = 0; i < routes.length; i++) uit[routes[i]] = (nu[routes[i]] - (v[i] ?? 0)) / (state.dag - oud.dag);
  return uit;
}

// Vaste volgorde van de routes in vg: die van verhaal.overwinning.
export function vgRij(state, blokId) {
  const v = voortgangVan(state, blokId);
  return Object.keys(v).map((k) => +v[k].toFixed(4));
}

export function achterstand(state) {
  const sb = state.spelerBlok;
  const c = state.landen[state.speler];
  const st = standen(state);
  const spelerSt = st.lijst.find((x) => x.blok === sb);
  let besteAI = null;
  for (let i = 0; i < st.lijst.length; i++) {
    const x = st.lijst[i];
    if (x.blok === sb) continue;
    if (!besteAI || x.voortgang > besteAI.voortgang) besteAI = x;
  }
  const verschil = besteAI ? besteAI.voortgang - spelerSt.voortgang : 0;

  // Dagen tot verlies: de vroegste route van een AI-blok (lopende teller, anders de trend).
  let dagenTotVerlies = null;
  let wie = null;
  const dreigingen = [];
  for (let i = 0; i < state.blokken.length; i++) {
    const b = state.blokken[i];
    if (b.id === sb) continue;
    const v = voortgangVan(state, b.id);
    const tr = trends(state, b.id, v);
    for (const route of Object.keys(v)) {
      const d = dagenTot(state, b.id, route, v[route], tr[route]);
      if (d == null) continue;
      // zeker: de drempel is al gehaald (een lopende teller of wachten op min_dag); anders is het een schatting uit de trend
      const zeker = v[route] >= 1 || (state.overwinningTellers[`${route}|${b.id}`] || 0) > 0;
      if (dagenTotVerlies == null || d < dagenTotVerlies) { dagenTotVerlies = d; wie = { blok: b.id, route, zeker }; }
    }
  }
  // Het einde van de tijdlijn telt ook: dan wint het grootste aandeel.
  const V = state.pack.verhaal;
  const rest = (V.dag_limiet ?? Infinity) - state.dag;
  if (isFinite(rest)) {
    let top = null;
    for (let i = 0; i < state.blokken.length; i++) if (!top || state.blokken[i].aandeel > top.aandeel) top = state.blokken[i];
    if (top && top.id !== sb && (dagenTotVerlies == null || rest < dagenTotVerlies)) { dagenTotVerlies = Math.max(0, rest); wie = { blok: top.id, route: 'dag_limiet', zeker: true }; }
  }
  const G = mgWaarde(state, 'gevaar_dagen');
  if (dagenTotVerlies != null && wie) dreigingen.push({ soort: 'winroute', blok: wie.blok, route: wie.route, dagen: dagenTotVerlies, zeker: wie.zeker, gevaar: dagenTotVerlies <= G });

  // Dreigingen thuis: onrust na een revolutie, een verloren oorlog, een belegerde hoofdstad.
  if ((c.revoluties ?? 0) >= 1 && c.stab < mgWaarde(state, 'gevaar_stab')) dreigingen.push({ soort: 'onrust', stab: c.stab, gevaar: true });
  const p = partij(state, c);
  const oorlogen = oorlogenVan(state, c);
  for (let i = 0; i < oorlogen.length; i++) {
    const o = oorlogen[i];
    const ander = o.a === p ? o.b : o.a;
    const verhouding = partijSterkte(state, p) / Math.max(1, partijSterkte(state, ander));
    if (verhouding < mgWaarde(state, 'gevaar_oorlog')) dreigingen.push({ soort: 'oorlog', tegen: ander, verhouding: +verhouding.toFixed(2), gevaar: true });
  }
  const h = state.pack.geo.hoofdstad[state.speler];
  for (let i = 0; i < state.eenheden.length; i++) {
    const u = state.eenheden[i];
    if (u.t !== h || u.land === state.speler) continue;
    if (oorlogen.some((o) => o.a === partij(state, state.landen[u.land]) || o.b === partij(state, state.landen[u.land]))) { dreigingen.push({ soort: 'beleg', door: u.land, gevaar: true }); break; }
  }

  // Ernst.
  let ernst = 'gelijk';
  if (dreigingen.some((d) => d.gevaar)) ernst = 'gevaar';
  else if (verschil >= mgWaarde(state, 'achter_drempel') && achterLang(state, sb, besteAI)) ernst = 'achter';
  else if (-verschil >= mgWaarde(state, 'achter_drempel')) ernst = 'voor';
  return {
    speler: { voortgang: +spelerSt.voortgang.toFixed(3), route: spelerSt.route },
    besteAI: besteAI ? { blok: besteAI.blok, voortgang: +besteAI.voortgang.toFixed(3), route: besteAI.route } : null,
    verschil: +verschil.toFixed(3), dagenTotVerlies, dreigingen, ernst,
  };
}

// Stond de beste AI de laatste achter_dagen steeds minstens achter_drempel voor? (uit de geschiedenis per 5 dagen)
function achterLang(state, sb, besteAI) {
  const D = mgWaarde(state, 'achter_dagen');
  const drempel = mgWaarde(state, 'achter_drempel');
  const g = state.geschiedenis;
  let gezien = 0;
  for (let i = g.length - 1; i >= 0 && state.dag - g[i].dag <= D; i--) {
    const vg = g[i].vg;
    if (!vg) return true; // oude geschiedenis zonder voortgang: dan alleen de stand van nu
    let ai = 0;
    for (const id of Object.keys(vg)) if (id !== sb) ai = Math.max(ai, ...vg[id]);
    if (ai - Math.max(0, ...vg[sb]) < drempel) return false;
    gezien++;
  }
  return gezien > 0 || D <= 0;
}

// ---------- bijsturing (alleen met meegroeiend) ----------

// De factor op de invloed van een blok (hefbomen en aantrekkingskracht), of op de oorlogszin tegen de speler.
export function bijsturingFactor(state, blokId, soort = 'invloed') {
  const b = state.bijsturing;
  if (!b) return 1;
  if (soort === 'invloed') return b.invloed[blokId] ?? 1;
  if (soort === 'oorlog') return b.rust && b.rust.tot > state.dag ? mgWaarde(state, 'rust_oorlog') : 1;
  return 1;
}

function blokNaam(state, id) {
  return state.blokken.find((b) => b.id === id)?.naam ?? id;
}

function procent(f) {
  const p = Math.round((f - 1) * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`;
}

// Tekst voor het overwinningspaneel en de krant (ook gebruikt door main.js).
export function bijsturingTekst(state, blokId) {
  const f = bijsturingFactor(state, blokId, 'invloed');
  const eigen = blokId === state.spelerBlok;
  if (f < 1) return eigen ? `Je buren worden nerveus: de zwevende landen houden afstand (${procent(f)} invloed)` : `de zwevende landen wantrouwen ${blokNaam(state, blokId)} (${procent(f)} invloed)`;
  if (f > 1) return eigen ? `De zwevende landen zoeken een tegenwicht: ze luisteren beter naar jou (${procent(f)} invloed)` : `de zwevende landen zoeken steun bij ${blokNaam(state, blokId)} (${procent(f)} invloed)`;
  return null;
}

export const LOG_MACHTSBALANS = 'Machtsbalans:'; // de krant herkent hieraan een kop (src/ui/krant.js)

export function bijsturingTick(state) {
  if (!meegroeiendAan(state)) return;
  const b = (state.bijsturing ??= { invloed: {}, rust: null, laatsteRust: null, gemeld: {}, tel: { spelerGeremd: 0, rusten: 0 } });
  if (!state.ontgrendeld.has('invloed')) { zwareKlap(state, b); return; }
  const st = standen(state);
  const stap = mgWaarde(state, 'stap_per_dag');
  const vanaf = mgWaarde(state, 'rem_vanaf');
  const remMin = mgWaarde(state, 'rem_min');
  const steunVanaf = mgWaarde(state, 'steun_vanaf');
  const steunMax = mgWaarde(state, 'steun_max');
  const helling = mgWaarde(state, 'steun_helling');
  const aan = mgWaarde(state, 'melding_aan');
  const uit = mgWaarde(state, 'melding_uit');
  for (let i = 0; i < st.lijst.length; i++) {
    const x = st.lijst[i];
    let doel = 1;
    const eigen = x.blok === state.spelerBlok;
    const drempel = eigen ? mgWaarde(state, 'speler_rem_vanaf') ?? vanaf : vanaf;
    if (x === st.leider && st.voorsprong > drempel) {
      const rem = eigen ? mgWaarde(state, 'speler_rem') : mgWaarde(state, 'leider_rem');
      doel = clamp(1 - rem * (st.voorsprong - drempel), remMin, 1);
    } else if (st.leider && st.leider.voortgang - x.voortgang > steunVanaf && (x.blok === state.spelerBlok || mgWaarde(state, 'steun_ai'))) {
      doel = clamp(1 + helling * (st.leider.voortgang - x.voortgang - steunVanaf), 1, Math.max(1, steunMax));
    }
    const oud = b.invloed[x.blok] ?? 1;
    const nieuw = +clamp(doel, oud - stap, oud + stap).toFixed(4);
    if (nieuw === 1) delete b.invloed[x.blok]; else b.invloed[x.blok] = nieuw;
    // Melden bij aanslaan en loslaten, nooit elke dag.
    const was = b.gemeld[x.blok] ?? 0; // -1 geremd, 1 gesteund, 0 niets
    let wordt = was;
    if (was === 0 && nieuw <= 1 - aan) wordt = -1;
    else if (was === 0 && nieuw >= 1 + aan) wordt = 1;
    else if (was !== 0 && Math.abs(nieuw - 1) <= uit) wordt = 0;
    if (wordt !== was) {
      if (wordt === 0) delete b.gemeld[x.blok]; else b.gemeld[x.blok] = wordt;
      meldWissel(state, x.blok, was, wordt);
    }
    if (x.blok === state.spelerBlok && nieuw < 1) b.tel.spelerGeremd++;
  }
  zwareKlap(state, b);
}

function meldWissel(state, blokId, was, wordt) {
  const eigen = blokId === state.spelerBlok;
  const naam = blokNaam(state, blokId);
  let tekst = null;
  let soort = 'info';
  if (wordt === -1) { tekst = eigen ? `${LOG_MACHTSBALANS} je buren worden nerveus. De zwevende landen houden afstand.` : `${LOG_MACHTSBALANS} de zwevende landen vinden ${naam} te machtig.`; soort = eigen ? 'slecht' : 'goed'; }
  else if (wordt === 1 && eigen) { tekst = `${LOG_MACHTSBALANS} de zwevende landen zoeken een tegenwicht. Ze luisteren beter naar jou.`; soort = 'goed'; }
  else if (wordt === 0 && was === -1) tekst = eigen ? `${LOG_MACHTSBALANS} de zwevende landen vertrouwen je weer.` : `${LOG_MACHTSBALANS} de zwevende landen vertrouwen ${naam} weer.`;
  if (!tekst) return; // steun voor een AI-blok en het loslaten van steun melden we niet
  log(state, tekst, soort, true);
}

// Een zware klap: gebied in je kern verloren, een revolutie of staatsgreep, of een kwart van je productie kwijt.
function zwareKlap(state, b) {
  const c = state.landen[state.speler];
  const k = (b.klap ??= { tegels: state.landTegels[state.speler].length, revoluties: c.revoluties ?? 0, regime: c.regime });
  let reden = null;
  const tegels = state.landTegels[state.speler].length;
  if (tegels < k.tegels) reden = 'het verlies van je gebied';
  else if ((c.revoluties ?? 0) > k.revoluties) reden = 'de revolutie';
  else if (c.regime !== k.regime && (c.revoluties ?? 0) === k.revoluties) reden = null; // een hervorming is geen klap
  else if (laatsteStaatsgreep(state)) reden = 'de staatsgreep';
  else {
    const D = mgWaarde(state, 'rust_y_dagen');
    let max = c.Y;
    const g = state.geschiedenis;
    for (let i = g.length - 1; i >= 0 && state.dag - g[i].dag <= D; i--) if (g[i].Y > max) max = g[i].Y;
    if (max > 0 && c.Y < max * (1 - mgWaarde(state, 'rust_y_verlies'))) reden = 'de zware economische klap';
  }
  k.tegels = tegels;
  k.revoluties = c.revoluties ?? 0;
  k.regime = c.regime;
  if (!reden) return;
  if (b.rust && b.rust.tot > state.dag) return;
  if (b.laatsteRust != null && state.dag - b.laatsteRust < mgWaarde(state, 'rust_interval')) return;
  // Niet als de speler voorstaat.
  const st = standen(state);
  if (st.leider?.blok === state.spelerBlok && st.voorsprong > 0) return;
  // De rivaal: de vijand in een lopende oorlog, anders het sterkste AI-blok.
  const p = partij(state, c);
  const oorlog = oorlogenVan(state, c)[0];
  let rivaal = oorlog ? (oorlog.a === p ? oorlog.b : oorlog.a) : null;
  if (!rivaal) {
    let top = null;
    for (let i = 0; i < st.lijst.length; i++) if (st.lijst[i].blok !== state.spelerBlok && (!top || st.lijst[i].voortgang > top.voortgang)) top = st.lijst[i];
    rivaal = top?.blok ?? null;
  }
  const rivaalNaam = rivaal?.startsWith('land:') ? state.landen[+rivaal.slice(5)].naam : blokNaam(state, rivaal);
  b.rust = { van: state.dag, tot: state.dag + mgWaarde(state, 'rust_dagen'), reden, rivaal };
  b.laatsteRust = state.dag;
  b.tel.rusten++;
  log(state, `${LOG_MACHTSBALANS} na ${reden} houdt ${rivaalNaam} zich even koest.`, 'goed', true);
}

// Een staatsgreep bij de speler staat vandaag in het logboek (regimes.js meldt hem zo).
function laatsteStaatsgreep(state) {
  for (let i = state.log.length - 1; i >= 0 && state.log[i].dag === state.dag; i--) if (state.log[i].tekst.startsWith('Staatsgreep: ')) return true;
  return false;
}

// Achtervoegsel voor de vingerafdruk: leeg zonder meegroeiend.
export function bijsturingAfdruk(state) {
  if (!meegroeiendAan(state) || !state.bijsturing) return '';
  const b = state.bijsturing;
  const f = Object.keys(b.invloed).sort().map((k) => `${k}=${b.invloed[k].toFixed(3)}`).join(',');
  return `#mg${f}${b.rust ? `@${b.rust.van}-${b.rust.tot}` : ''}`;
}

// ---------- voor de weergave (leest alleen) ----------

// Eén regel voor het overwinningspaneel: de actieve bijsturing, een wapenrust en een aftelling. null als er niets is.
export function machtsbalansRegel(state) {
  const delen = [];
  if (state.bijsturing) {
    const drempel = mgWaarde(state, 'melding_aan'); // kleine factoren (een paar procent) laten we weg
    for (let i = 0; i < state.blokken.length; i++) {
      const id = state.blokken[i].id;
      if (Math.abs(bijsturingFactor(state, id) - 1) < drempel) continue;
      const t = bijsturingTekst(state, id);
      if (t) delen.push(t);
    }
    const r = state.bijsturing.rust;
    if (r && r.tot > state.dag) delen.push(`wapenrust na ${r.reden}, nog ${r.tot - state.dag} dagen`);
  }
  const a = achterstand(state);
  const w = a.dreigingen.find((d) => d.soort === 'winroute');
  // Een lopende teller telt precies af. Een schatting uit de trend springt mee met de stand: die tonen we pas dichtbij
  // (binnen gevaar_dagen) en afgerond op 10 dagen, met "ongeveer".
  const G = mgWaarde(state, 'gevaar_dagen');
  let aftel = null;
  if (w && w.route !== 'dag_limiet' && w.zeker && w.dagen <= 2 * G) aftel = `${blokNaam(state, w.blok)} wint over ${w.dagen} dagen`;
  else if (w && w.route !== 'dag_limiet' && !w.zeker && w.dagen <= G) aftel = `${blokNaam(state, w.blok)} wint over ongeveer ${Math.max(10, Math.round(w.dagen / 10) * 10)} dagen`;
  if (!delen.length && !aftel) return null;
  const zin = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  return [delen.length ? `Machtsbalans: ${delen.join('; ')}.` : null, aftel ? `${zin(aftel)}.` : null].filter(Boolean).join(' ');
}

// Wat er sinds de vorige keer wisselde (aanslaan, loslaten, wapenrust), voor de gebeurtenis 'bijsturing' op window.
// geheugen is een leeg object dat de weergave bewaart.
export function bijsturingWissels(state, geheugen) {
  // Een nieuw of geladen potje: begin opnieuw, anders lijkt het verschil met het vorige potje een wissel.
  if (geheugen.state !== state) { geheugen.state = state; geheugen.gemeld = {}; geheugen.rustVan = null; }
  const b = state.bijsturing;
  if (!b) return [];
  const uit = [];
  const oud = geheugen.gemeld ?? {};
  for (let i = 0; i < state.blokken.length; i++) {
    const id = state.blokken[i].id;
    const nu = b.gemeld[id] ?? 0;
    if ((oud[id] ?? 0) !== nu) uit.push({ blok: id, factor: bijsturingFactor(state, id), reden: nu < 0 ? 'te machtig' : nu > 0 ? 'tegenwicht' : 'los' });
  }
  if (b.rust && b.rust.van !== geheugen.rustVan) uit.push({ blok: state.spelerBlok, factor: bijsturingFactor(state, state.spelerBlok, 'oorlog'), reden: 'wapenrust' });
  geheugen.gemeld = { ...b.gemeld };
  geheugen.rustVan = b.rust?.van ?? geheugen.rustVan ?? null;
  return uit;
}
