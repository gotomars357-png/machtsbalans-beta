// Je Huis (C13): leiderdoctrines kiezen vóór een potje en de rij generaties van al je potjes.
// De engine kent alleen instellingen.doctrine; vrijspelen, generaties en de keuze staan hier, in deze browser.
// Opslag in localStorage 'machtsbalans.huis'. Elke lees- en schrijfactie staat in try/catch: zonder opslag werkt
// alles, alleen zonder geheugen tussen sessies (binnen een sessie onthoudt een kopie in het werkgeheugen het wel).
// evalueerOntgrendeling en de tekstfuncties zijn puur, zodat tools/doctrinetest.mjs ze zonder browser kan testen.

import { datumSleutel } from './uitdaging.js';

const SLEUTEL = 'machtsbalans.huis';
const MAX = 60; // generaties en getelde potjes
const STROOK = 12; // generaties in de strook op het startscherm

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const getal = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');

// ---------- opslag ----------

let geheugen = null; // laatste bekende huis, voor als localStorage ontbreekt of weigert
let keuze; // gekozen doctrine-id op het startscherm (undefined = nog niet gekozen: laatsteKeuze geldt)

export function leegHuis() {
  return { versie: 1, ontgrendeld: [], generaties: [], geteld: [], laatsteKeuze: null, aantal: 0, rivalen: {} };
}

const tekst80 = (x) => (typeof x === 'string' ? x.slice(0, 80) : null);
// Kroniek van een generatie (C14): hooguit 5 regels { dag, tekst }, platte tekst van hooguit 80 tekens.
function netteKroniek(k) {
  if (!Array.isArray(k)) return undefined;
  return k.filter((r) => r && Number.isFinite(r.dag) && typeof r.tekst === 'string').slice(-5).map((r) => ({ dag: r.dag, tekst: tekst80(r.tekst), ...(r.eind ? { eind: true } : {}) }));
}
function netteRivaal(r) {
  if (!r || typeof r !== 'object' || typeof r.blok !== 'string') return undefined;
  return { blok: r.blok, les: typeof r.les === 'string' ? r.les : null, leiderNaam: tekst80(r.leiderNaam), landNaam: tekst80(r.landNaam) };
}
function netteRivalen(v) {
  const uit = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return uit;
  for (const [pack, r] of Object.entries(v)) {
    if (!r || typeof r !== 'object' || typeof r.blok !== 'string' || typeof r.les !== 'string') continue;
    uit[pack] = {
      blok: r.blok, les: r.les, keer: Number.isInteger(r.keer) && r.keer > 0 ? r.keer : 1,
      generatie: Number.isInteger(r.generatie) ? r.generatie : null, leiderNaam: tekst80(r.leiderNaam), landNaam: tekst80(r.landNaam), winst: !!r.winst,
    };
  }
  return uit;
}

function netjes(v) {
  if (!v || typeof v !== 'object' || v.versie !== 1) return null;
  const lijst = (x) => (Array.isArray(x) ? x : []);
  const h = {
    versie: 1,
    ontgrendeld: lijst(v.ontgrendeld).filter((x) => typeof x === 'string'),
    generaties: lijst(v.generaties).filter((g) => g && typeof g === 'object').slice(-MAX).map((g) => {
      const n = { ...g };
      const k = netteKroniek(g.kroniek);
      if (k) n.kroniek = k; else delete n.kroniek;
      const r = netteRivaal(g.rivaal);
      if (r) n.rivaal = r; else delete n.rivaal;
      return n;
    }),
    geteld: lijst(v.geteld).filter((x) => typeof x === 'string').slice(-MAX),
    laatsteKeuze: typeof v.laatsteKeuze === 'string' ? v.laatsteKeuze : null,
    rivalen: netteRivalen(v.rivalen),
  };
  h.aantal = Number.isInteger(v.aantal) && v.aantal >= h.generaties.length ? v.aantal : h.generaties.length;
  return h;
}

export function leesHuis() {
  try {
    const tekst = localStorage.getItem(SLEUTEL);
    if (tekst == null) return geheugen ? structuredClone(geheugen) : leegHuis();
    return netjes(JSON.parse(tekst)) ?? (geheugen ? structuredClone(geheugen) : leegHuis());
  } catch {
    return geheugen ? structuredClone(geheugen) : leegHuis();
  }
}

function bewaarHuis(h) {
  geheugen = structuredClone(h);
  try { localStorage.setItem(SLEUTEL, JSON.stringify(h)); return true; } catch { return false; }
}

// ---------- regels (puur) ----------

export function isVrij(huis, d) {
  if (!d) return false;
  return d.ontgrendel?.start === true || (huis?.ontgrendeld ?? []).includes(d.id);
}

// De voorwaarde om een doctrine vrij te spelen, in één zin.
export function voorwaardeTekst(d, pack) {
  const o = d?.ontgrendel ?? {};
  if (o.start) return 'Vanaf het begin vrij.';
  const delen = [];
  if (o.winst_zonder_oorlog) delen.push('Win een potje zonder oorlog');
  if (o.winst_route) {
    const route = (pack?.verhaal?.overwinning ?? []).find((v) => v.type === o.winst_route)?.naam;
    const standaard = { aandeel_productie: 'met economisch overwicht', aantal_landen: 'met een coalitie van landen', tech_factor: 'met een technologische voorsprong' }[o.winst_route] ?? 'langs een bepaalde route';
    delen.push(route ? `Win een potje via ${route.charAt(0).toLowerCase() + route.slice(1)}` : `Win een potje ${standaard}`);
  }
  if (o.orders) {
    const naam = { media: 'media-acties', netwerk: 'netwerkacties', hefboom: 'invloedsacties', bouw: 'bouwopdrachten', overname: 'overnames', train: 'eenheden', campagne: 'campagnes', contract: 'contracten' }[o.orders.type] ?? `acties van het type ${o.orders.type}`;
    delen.push(`Doe in één potje minstens ${o.orders.minimaal} ${naam}`);
  }
  if (o.potjes) delen.push(`Speel ${o.potjes} potjes uit`);
  return delen.length ? `${delen.join(' en ')}.` : 'Nog niet vrij te spelen.';
}

// Voordelen en nadelen in woorden en getallen: [{ veld, tekst, kort, goed }].
export function effectRegels(d) {
  const uit = [];
  for (const [k, v] of Object.entries(d?.effecten ?? {})) {
    if (!v) continue;
    const p = getal(Math.abs(v) * 100);
    const t = {
      productiviteit: v > 0 ? `+${p}% productiviteit` : `−${p}% productiviteit`,
      bouw_korting: v > 0 ? `bouwen ${p}% goedkoper` : `bouwen ${p}% duurder`,
      handel_bonus: v > 0 ? `+${p}% handel` : `−${p}% handel`,
      leger_korting: v > 0 ? `leger ${p}% goedkoper` : `leger ${p}% duurder`,
      tech_groei: `${v > 0 ? '+' : '−'}${getal(Math.abs(v) * 36500, 1)}% techgroei per jaar`,
      weerbaarheid: `${v > 0 ? '+' : '−'}${getal(Math.abs(v), 1)} weerbaarheid`,
      informatiecontrole: `${v > 0 ? '+' : '−'}${getal(Math.abs(v), 1)} informatiecontrole`,
      informatiecontrole_max: `max. informatiecontrole ${v > 0 ? '+' : '−'}${getal(Math.abs(v), 1)}`,
      moraal: `${v > 0 ? '+' : '−'}${getal(Math.abs(v), 1)} strijdbereidheid`,
      stabiliteit: `${v > 0 ? '+' : '−'}${getal(Math.abs(v), 1)} stabiliteit`,
      complot_gevoeligheid: v > 0 ? `${p}% vatbaarder voor complotten` : `${p}% minder vatbaar voor complotten`,
      oorlog_moeheid: v > 0 ? `${p}% sneller oorlogsmoe` : `${p}% minder snel oorlogsmoe`,
    }[k] ?? `${k} ${v}`;
    const goed = ['complot_gevoeligheid', 'oorlog_moeheid'].includes(k) ? v < 0 : v > 0;
    uit.push({ veld: k, tekst: t, goed });
  }
  // Voordelen eerst, dan nadelen.
  return [...uit.filter((r) => r.goed), ...uit.filter((r) => !r.goed)];
}

// 'De Handelsvorst (+12% handel, leger 10% duurder)'
export function doctrineKort(d) {
  if (!d) return 'Geen doctrine';
  const r = effectRegels(d);
  return r.length ? `${d.naam} (${r.map((x) => x.tekst).join(', ')})` : d.naam;
}

// Uniek id van een afgerond potje, zoals in einde.js, plus wereld en land.
export function potjeId(state, score) {
  const u = state.uitkomst ?? {};
  return `${state.pack.meta.id}-${state.landen[state.speler]?.id}-${state.instellingen.seed}-${u.dag ?? state.dag}-${state.orders.length}-${score.totaal}`;
}

// Wat het Huis van een afgerond potje wil weten (puur).
export function potjeUit(state, score) {
  const u = state.uitkomst ?? {};
  const route = (state.pack.verhaal?.overwinning ?? []).find((v) => v.naam === u.reden)?.type ?? null;
  const orders = {};
  for (let i = 0; i < state.orders.length; i++) {
    const o = state.orders[i];
    if (o.land != null && o.land !== state.speler) continue;
    orders[o.type] = (orders[o.type] ?? 0) + 1;
  }
  return {
    // Alleen een doctrine die het pack kent: een onbekende id speelde createGame ook zonder doctrine.
    id: potjeId(state, score), doctrine: state.pack.doctrineIndex?.[state.instellingen.doctrine] ? state.instellingen.doctrine : null,
    winst: !!u.spelerWint, route, reden: u.reden ?? null, zonderOorlog: !!score.zonderOorlog, orders,
  };
}

// Welke doctrines speelt dit potje vrij? Puur: `huis` is de toestand mét dit potje al in de generaties
// (zodat 'potjes' meetelt). Alle voorwaarden in één ontgrendel-object moeten gelden. Geeft de nieuwe ids.
export function evalueerOntgrendeling(pack, huis, potje) {
  const nieuw = [];
  const lijst = pack?.doctrines ?? [];
  const aantal = Math.max(huis?.aantal ?? 0, huis?.generaties?.length ?? 0);
  for (let i = 0; i < lijst.length; i++) {
    const d = lijst[i];
    if (isVrij(huis, d)) continue;
    const o = d.ontgrendel ?? {};
    const eisen = [];
    if (o.potjes != null) eisen.push(aantal >= o.potjes);
    if (o.winst_zonder_oorlog) eisen.push(!!potje?.winst && !!potje.zonderOorlog);
    if (o.winst_route) eisen.push(!!potje?.winst && potje.route === o.winst_route);
    if (o.orders) eisen.push((potje?.orders?.[o.orders.type] ?? 0) >= o.orders.minimaal);
    if (eisen.length && eisen.every(Boolean)) nieuw.push(d.id);
  }
  return nieuw;
}

// Na een echt potje (niet bij een replay): telt één keer per potje-id, voegt een generatie toe en speelt vrij.
// Geeft { nieuw: [doctrines], generatie: N, alGeteld } terug; bij een tweede keer hetzelfde potje dezelfde uitkomst.
export function registreerPotje(state, score, extra = {}) {
  if (!state?.uitkomst || state.replayDoel) return { nieuw: [], generatie: null, alGeteld: false };
  const pack = state.pack;
  const potje = potjeUit(state, score);
  const huis = leesHuis();
  const naarDoctrines = (ids) => (ids ?? []).map((id) => pack.doctrineIndex?.[id] ?? (pack.doctrines ?? []).find((d) => d.id === id)).filter(Boolean);
  if (huis.geteld.includes(potje.id)) {
    const g = huis.generaties.find((x) => x.id === potje.id);
    return { nieuw: naarDoctrines(g?.nieuw), generatie: g?.generatie ?? null, alGeteld: true };
  }
  huis.aantal += 1;
  const generatie = {
    id: potje.id, generatie: huis.aantal, doctrine: potje.doctrine, pack: pack.meta.id,
    land: state.landen[state.speler]?.id, landNaam: state.landen[state.speler]?.naam,
    winst: potje.winst, reden: potje.reden, score: score.totaal, dag: state.uitkomst.dag ?? state.dag,
    datum: datumSleutel(), nieuw: [], // lokale datum, zoals de uitdaging (UTC is in Nederland rond middernacht een dag eerder)
  };
  const kroniek = netteKroniek(extra.kroniek);
  if (kroniek?.length) generatie.kroniek = kroniek;
  const rivaal = extra.rivaal === undefined ? bepaalRivaal(state, score) : extra.rivaal;
  if (rivaal) {
    generatie.rivaal = netteRivaal(rivaal);
    // Het geheugen per wereld: wie jou onthoudt in het volgende potje. Hetzelfde blok opnieuw: 'voor de 2e keer'.
    if (rivaal.les) {
      const oud = huis.rivalen[pack.meta.id];
      huis.rivalen[pack.meta.id] = {
        blok: rivaal.blok, les: rivaal.les, keer: oud && oud.blok === rivaal.blok ? (oud.keer ?? 1) + 1 : 1, generatie: huis.aantal,
        leiderNaam: rivaal.leiderNaam, landNaam: rivaal.landNaam, winst: potje.winst,
      };
    }
  }
  huis.generaties.push(generatie);
  huis.generaties = huis.generaties.slice(-MAX);
  huis.geteld.push(potje.id);
  huis.geteld = huis.geteld.slice(-MAX);
  const nieuw = evalueerOntgrendeling(pack, huis, potje);
  generatie.nieuw = nieuw;
  for (const id of nieuw) if (!huis.ontgrendeld.includes(id)) huis.ontgrendeld.push(id);
  bewaarHuis(huis);
  return { nieuw: naarDoctrines(nieuw), generatie: huis.aantal, alGeteld: false };
}

// ---------- rivalen met geheugen (C14) ----------

// Wie onthoudt jou na dit potje, en welke les neemt hij mee? Puur. Winst: het blok met het grootste aandeel na het
// jouwe. Verlies: de winnaar, of bij regeringsval en capitulatie het grootste andere blok. De les is de eerste uit
// pack.rivalen waarvan 'na' past (winst met oorlog gaat voor de route). Geeft null als er geen rivaal te bepalen is.
export function bepaalRivaal(state, score) {
  const u = state?.uitkomst;
  if (!u) return null;
  const pack = state.pack;
  const winst = !!u.spelerWint;
  const anderen = (state.blokken ?? []).filter((b) => b.id !== state.spelerBlok && b.leider >= 0);
  if (!anderen.length) return null;
  const grootste = [...anderen].sort((a, b) => b.aandeel - a.aandeel)[0];
  const blok = winst ? grootste : (anderen.find((b) => b.id === u.winnaar) ?? grootste);
  // Winst aan het einde van de tijdlijn heeft geen eigen route: dat telt als economische winst.
  const route = (pack.verhaal?.overwinning ?? []).find((v) => v.naam === u.reden)?.type ?? (winst ? 'aandeel_productie' : null);
  const oorlog = !(score?.zonderOorlog ?? true);
  const les = (pack.rivalen ?? []).find((l) => {
    const na = l?.na ?? {};
    if (na.winst_oorlog) return winst && oorlog;
    if (na.winst_route) return winst && route === na.winst_route;
    if (na.verlies) return !winst;
    return false;
  });
  const leider = state.landen[blok.leider];
  return { blok: blok.id, les: les?.id ?? null, leiderNaam: leider?.leider ?? null, landNaam: leider?.naam ?? null, winst };
}

// De rivaal voor het volgende potje als instelling voor de engine: [{ blok, les }] of [] (geen geheugen, onbekend
// blok of onbekende les).
export function rivaalInstelling(pack) {
  if (!pack) return [];
  const r = leesHuis().rivalen?.[pack.meta?.id];
  if (!r || !pack.blokken?.some((b) => b.id === r.blok) || !pack.rivaalIndex?.[r.les]) return [];
  return [{ blok: r.blok, les: r.les }];
}

// ---------- keuze op het startscherm ----------

// De gekozen doctrine-id voor dit pack, of null. Alleen een vrijgespeelde doctrine die het pack kent.
export function gekozenDoctrine(pack) {
  if (!pack?.doctrines?.length) return null;
  const huis = leesHuis();
  const id = keuze !== undefined ? keuze : huis.laatsteKeuze;
  const d = id ? pack.doctrines.find((x) => x.id === id) : null;
  return d && isVrij(huis, d) ? d.id : null;
}

function kies(pack, id) {
  keuze = id;
  const huis = leesHuis();
  huis.laatsteKeuze = id;
  bewaarHuis(huis);
  toonHuis(pack);
}

// ---------- emblemen: kleine lijnvormen in eigen stijl (geen tekst, vlaggen of symbolen) ----------

const VORMEN = {
  // bouwkraan: mast, giek, kabel met last
  kraan: '<path d="M7 21V5M7 5h12M7 5l-3 3M7 9l4-4M17 5v6"/><rect x="15" y="11" width="4" height="3" rx=".5"/><path d="M4 21h7"/>',
  // vrachtschip op golven
  schip: '<path d="M3 15h18l-2.5 4h-13z"/><path d="M7 15v-4h6v4M9 11V7h3v4M15 15v-3h3"/><path d="M3 21c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0"/>',
  // zendmast met golven
  // vakwerkmast op een voet, met golven rond de top (kruisverbanden, zodat hij niet als een letter leest)
  mast: '<path d="M11 9h2l2.5 11h-7z"/><path d="M11 9l3.3 6M13 9l-3.3 6M9.7 15l5.8 5M14.3 15l-5.8 5M6.5 21h11"/><path d="M9 3.6a4.4 4.4 0 0 0 0 5.4M15 3.6a4.4 4.4 0 0 1 0 5.4M6.3 1.8a8 8 0 0 0 0 9M17.7 1.8a8 8 0 0 1 0 9"/>',
  // sleutel
  sleutel: '<circle cx="7.5" cy="12" r="4"/><path d="M11.5 12H21M17 12v3.5M20 12v2.5"/>',
  // effen schild met een middenrand
  schild: '<path d="M12 3l7 3v5c0 5-3.2 8.3-7 10-3.8-1.7-7-5-7-10V6z"/><path d="M12 6.5v11"/>',
  // laboratoriumkolf met bellen
  kolf: '<path d="M10 3h4M10.5 3v6L5 19a1.3 1.3 0 0 0 1.1 2h11.8a1.3 1.3 0 0 0 1.1-2l-5.5-10V3"/><path d="M7.5 15h9"/><circle cx="11" cy="18" r=".8"/><circle cx="14" cy="17" r=".6"/>',
  // geen doctrine: lege ring
  geen: '<circle cx="12" cy="12" r="7.5" stroke-dasharray="3 2.4"/>',
};

export function embleemSvg(naam, grootte = 28) {
  const v = VORMEN[naam] ?? VORMEN.geen;
  return `<svg class="embleem" viewBox="0 0 24 24" width="${grootte}" height="${grootte}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${v}</svg>`;
}

// ---------- startscherm ----------

const datumKort = (iso) => { const [j, m, d] = String(iso ?? '').split('-'); return d ? `${d}-${m}-${j}` : ''; };

let openGen = null; // id van de uitgeklapte generatie in de strook
let laatsteLand = null; // gekozen land op het startscherm (voor "geldt niet" in het dossier)

// Het rivaaldossier boven de generaties (C14): wie jou onthoudt, wat hij leerde, en hoe je hem aanpakt.
export function dossierHtml(pack, huis, landId) {
  const r = huis.rivalen?.[pack?.meta?.id];
  const les = r && pack.rivaalIndex?.[r.les];
  if (!les || !pack.blokken?.some((b) => b.id === r.blok)) return '';
  const vul = (t) => String(t ?? '').replace(/\{leider\}/g, r.leiderNaam ?? 'De leider').replace(/\{land\}/g, r.landNaam ?? 'zijn land');
  const regels = effectRegels(les);
  const sterk = regels.filter((x) => x.goed).map((x) => x.tekst);
  const zwak = regels.filter((x) => !x.goed).map((x) => x.tekst);
  const zelf = !!landId && pack.landen?.find((l) => l.id === landId)?.blok === r.blok;
  const keer = r.keer > 1 ? ` <span class="rd-keer">voor de ${r.keer}e keer</span>` : '';
  return `<div class="rivaal-dossier${zelf ? ' geldt-niet' : ''}">
      <div class="rd-kop"><b>Dossier: ${esc(les.naam)}</b>${keer}</div>
      <p class="rd-tekst">${esc(vul(les.tekst))}</p>
      ${sterk.length ? `<p class="rd-regel"><span class="zacht">Zijn sterke punt:</span> <span class="${zelf ? '' : 'slecht'}">${esc(sterk.join(', '))}</span></p>` : ''}
      ${zwak.length ? `<p class="rd-regel"><span class="zacht">Zijn zwakke plek:</span> <span class="${zelf ? '' : 'goed'}">${esc(zwak.join(', '))}</span></p>` : ''}
      ${les.tegenzet ? `<p class="rd-tegenzet">${esc(les.tegenzet)}</p>` : ''}
      ${zelf ? '<p class="rd-niet">Geldt niet: je speelt nu zelf in dit blok.</p>' : ''}
    </div>`;
}

// Het vinkje 'Rivalen onthouden je' op het startscherm (standaard aan; zonder vinkje, zoals in node, ook aan).
function rivalenAan() {
  const v = typeof document !== 'undefined' ? document.getElementById('opt-rivalen') : null;
  return !v || v.checked;
}

export function kroniekPaneel(g) {
  const k = Array.isArray(g?.kroniek) ? g.kroniek : [];
  const regels = k.length
    ? `<ol class="hk-regels">${k.map((r) => `<li class="${r.eind ? 'hk-eind' : ''}"><span class="num zacht">dag ${esc(r.dag)}</span><span>${esc(r.tekst)}</span></li>`).join('')}</ol>`
    : '<p class="zacht hk-leeg">Nog geen kroniek (gespeeld vóór de krant).</p>';
  const riv = g?.rivaal?.leiderNaam ? `<p class="hk-rivaal"><span class="zacht">Rivaal:</span> ${esc(g.rivaal.leiderNaam)} van ${esc(g.rivaal.landNaam ?? '?')}</p>` : '';
  return `<div class="hk-kop"><b>Generatie ${esc(g?.generatie ?? '')}</b> <span class="zacht">${esc(g?.landNaam ?? '')} · ${g?.winst ? 'gewonnen' : 'verloren'}${g?.reden ? ` · ${esc(g.reden)}` : ''}</span></div>${regels}${riv}`;
}

export function toonHuis(pack, landId = laatsteLand) {
  laatsteLand = landId;
  const el = typeof document !== 'undefined' ? document.getElementById('huis') : null;
  if (!el) return;
  const lijst = pack?.doctrines ?? [];
  if (!lijst.length) { el.hidden = true; el.innerHTML = ''; return; }
  const huis = leesHuis();
  const gekozen = gekozenDoctrine(pack);
  const vrij = lijst.filter((d) => isVrij(huis, d)).length;
  const pasVrij = huis.generaties.at(-1)?.nieuw ?? []; // in het laatste potje vrijgespeeld: krijgt een 'nieuw'-label
  const kaart = (d) => {
    const open = d ? isVrij(huis, d) : true;
    const id = d ? d.id : '';
    const aan = (d ? d.id : null) === gekozen;
    const regels = d ? effectRegels(d) : [];
    return `<button type="button" class="doctrine-kaart${aan ? ' gekozen' : ''}${open ? '' : ' dicht'}" data-doctrine="${esc(id)}" ${open ? '' : 'disabled'} aria-pressed="${aan}">
      <span class="dk-embleem">${embleemSvg(d ? d.embleem : 'geen')}</span>
      <span class="dk-tekst"><b>${esc(d ? d.naam : 'Geen doctrine')}${d && open && pasVrij.includes(d.id) ? ' <span class="dk-nieuw">nieuw</span>' : ''}</b>
        ${d ? `<span class="dk-regels">${regels.map((r) => `<span class="${r.goed ? 'goed' : 'slecht'}">${esc(r.tekst)}</span>`).join('')}</span>` : '<span class="dk-regels"><span class="zacht">Het spel zoals het is, zonder plus of min.</span></span>'}
        ${open ? '' : `<span class="dk-slot">${esc(voorwaardeTekst(d, pack))}</span>`}</span>
    </button>`;
  };
  const gens = huis.generaties.slice(-STROOK).reverse();
  const open = openGen != null ? gens.find((g) => g.id === openGen) : null;
  if (!open) openGen = null;
  const strook = gens.length
    ? `<ol class="huis-strook">${gens.map((g) => {
      const d = g.doctrine ? lijst.find((x) => x.id === g.doctrine) : null;
      return `<li class="${g.winst ? 'gewonnen' : 'verloren'}" role="button" tabindex="0" data-gen="${esc(g.id ?? '')}" aria-expanded="${openGen != null && g.id === openGen}" title="${esc(d?.naam ?? 'Geen doctrine')}${g.reden ? ` · ${esc(g.reden)}` : ''}">
        <span class="hs-embleem">${embleemSvg(d?.embleem ?? 'geen', 18)}</span>
        <span class="hs-land">${esc(g.landNaam ?? g.land ?? '?')}</span>
        <span class="hs-nr zacht num">${g.generatie ? `#${esc(g.generatie)}` : ''}</span>
        <span class="hs-uitslag">${g.winst ? 'gewonnen' : 'verloren'}</span>
        <span class="hs-score num">${esc(g.score ?? '')}</span>
        <span class="hs-datum zacht">${esc(datumKort(g.datum))}</span>
      </li>`;
    }).join('')}</ol>`
    : '<p class="zacht huis-leeg">Nog geen generaties. Elk afgerond potje komt hier als een nieuwe generatie van je huis.</p>';
  el.hidden = false;
  el.innerHTML = `<div class="huis-kop"><span>Je huis</span><span class="zacht">${huis.aantal} ${huis.aantal === 1 ? 'generatie' : 'generaties'} · ${vrij} van ${lijst.length} doctrines vrij</span></div>
    <p class="zacht huis-uitleg">Kies wat voor leider je dit potje bent. Elke doctrine maakt één route sterker en een andere zwakker. De rest speel je vrij door anders te spelen.</p>
    <div class="doctrine-rij">${kaart(null)}${lijst.map(kaart).join('')}</div>
    ${rivalenAan() ? dossierHtml(pack, huis, landId) : ''}
    <h3 class="huis-sub">Generaties</h3>
    ${strook}
    <div class="huis-kroniek" ${open ? '' : 'hidden'}>${open ? kroniekPaneel(open) : ''}</div>`;
  for (const b of el.querySelectorAll('[data-doctrine]')) {
    b.onclick = () => { if (!b.disabled) kies(pack, b.dataset.doctrine || null); };
  }
  for (const li of el.querySelectorAll('[data-gen]')) {
    const wissel = () => { openGen = openGen === li.dataset.gen ? null : li.dataset.gen; toonHuis(pack, landId); };
    li.onclick = wissel;
    li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wissel(); } };
  }
}
