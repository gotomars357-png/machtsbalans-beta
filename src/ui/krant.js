// De Krant (C14): een eigen krant per wereld die de grote momenten van je potje als kop brengt, plus het archief in
// het logboek en de kroniek voor het eindoverzicht en je Huis. Leest alleen; de engine weet hier niets van.
//
// De kern is puur en draait zonder browser (tools/krantest.mjs): krantFoto maakt een kleine momentopname,
// krantMomenten vergelijkt twee foto's, maakEditie kiest koppen uit pack.krant, kroniekUit maakt de kroniek.
// maakKrant voegt het uitgavebeleid en de weergave toe: een kaartje linksonder dat 8 s blijft staan en het spel
// nooit pauzeert, en een editie als venster na één tik.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

export const AANDEEL_GRENZEN = [0.25, 0.33, 0.40];
export const KRANT_BELEID = {
  minDagen: 45, // hooguit één editie per 45 speeldagen (behalve prio 4)
  verzamelDagen: 90, // twee of meer kleinere momenten: een editie na 90 speeldagen
  minEchteTijd: 20000, // minstens 20 s echte tijd tussen twee kaartjes, anders stil naar het archief
  startWacht: 20000, // de start-editie komt na de eerste tutorialstap of na 20 s
  kaartDuur: 8000, // zo lang staat een kaartje
  bijnaMarge: 0.05, // 'bijna': binnen 5 procentpunt van een overwinningsdrempel
};
// Begin van de logregels waarmee de engine momenten meldt. tools/krantest.mjs controleert dat ze nog in de bron staan.
export const LOG_VOORVOEGSELS = {
  haard_opgelost: 'Opgelost:', haard_uitgebarsten: 'Uitgebarsten:', verkiezing: 'Verkiezingen gewonnen',
  hervorming: 'Staatshervorming:', kolonie: 'Kolonie gesticht',
};
const OPSLAG_SLEUTEL = 'machtsbalans.krant';

// FNV-1a: vaste, snelle hash voor een deterministische sjabloonkeuze.
export function fnv(tekst) {
  let h = 2166136261;
  for (let i = 0; i < tekst.length; i++) { h ^= tekst.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function jaarVan(state) {
  return new Date(Date.UTC(state.pack.meta.tijd?.startjaar ?? 2026, 0, 1 + state.dag)).getUTCFullYear();
}

export function datumVan(state, dag) {
  const d = new Date(Date.UTC(state.pack.meta.tijd?.startjaar ?? 2026, 0, 1 + dag));
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ---------- foto en momenten (puur) ----------

export function krantFoto(state) {
  const sb = state.spelerBlok;
  const blok = state.blokken.find((b) => b.id === sb);
  const leden = new Int8Array(state.landen.length);
  for (let i = 0; i < state.landen.length; i++) leden[i] = state.landen[i].alignment === sb ? 1 : 0;
  const eigen = [sb, `land:${state.speler}`];
  let oorlogen = 0;
  for (let i = 0; i < state.oorlogen.length; i++) {
    const o = state.oorlogen[i];
    if (eigen.includes(o.a) || eigen.includes(o.b)) oorlogen += 1;
  }
  const haarden = [];
  for (let i = 0; i < (state.brandhaarden?.length ?? 0); i++) {
    const h = state.brandhaarden[i];
    if (h.land === state.speler) haarden.push(h.id);
  }
  const blokken = state.blokken.map((b) => {
    let tech = 0;
    for (let i = 0; i < state.landen.length; i++) {
      const c = state.landen[i];
      if (c.blok === b.id && c.kern && c.A > tech) tech = c.A;
    }
    return { id: b.id, aandeel: b.aandeel, leden: b.leden, tech };
  });
  return {
    dag: state.dag, faseIdx: state.faseIdx, aandeel: blok?.aandeel ?? 0, leden, oorlogen, haarden, blokken,
    logLen: state.log.length, logLaatste: state.log[state.log.length - 1] ?? null, uitkomst: !!state.uitkomst,
    // C18c Meegroeiend: welke blokken geremd zijn (-1) of steun krijgen (1), en het begin van een wapenrust.
    mg: state.bijsturing ? { gemeld: { ...state.bijsturing.gemeld }, rustVan: state.bijsturing.rust?.van ?? null, rivaal: state.bijsturing.rust?.rivaal ?? null } : null,
  };
}

// Logregels die na de vorige foto zijn bijgekomen. Het logboek houdt de laatste 400 regels: daarom zoeken we de
// laatste regel van de vorige foto terug in plaats van op lengte te tellen.
function nieuweLog(vorige, state) {
  if (!vorige) return [];
  const log = state.log;
  if (!vorige.logLaatste) return log.slice();
  const i = log.lastIndexOf(vorige.logLaatste);
  if (i >= 0) return log.slice(i + 1);
  return log.filter((l) => l.dag > vorige.dag);
}

// Wat er tussen twee foto's gebeurd is: [{ soort, prio, toon, data }]. `gemeld` onthoudt eenmalige momenten
// (aandeelgrenzen, bijna-overwinningen) over de hele partij.
export function krantMomenten(vorige, nu, state, gemeld = new Set()) {
  const uit = [];
  const zet = (soort, prio, toon, data = {}) => uit.push({ soort, prio, toon, data });
  if (!vorige) {
    if (nu.dag === 0) zet('start', 3, 'goed');
    return uit;
  }
  const P = state.pack;
  if (nu.faseIdx > vorige.faseIdx && nu.faseIdx > 0) zet('fase', 3, 'goed', { fase: P.verhaal.fasen[nu.faseIdx]?.naam ?? '' });
  for (let i = 0; i < nu.leden.length; i++) {
    if (i === state.speler || nu.leden[i] === vorige.leden[i]) continue;
    zet(nu.leden[i] ? 'aansluiting' : 'afvallig', 2, nu.leden[i] ? 'goed' : 'slecht', { land: state.landen[i].naam });
  }
  for (const g of AANDEEL_GRENZEN) {
    const k = `aandeel-${g}`;
    if (!gemeld.has(k) && vorige.aandeel < g && nu.aandeel >= g) { gemeld.add(k); zet('aandeel', 2, 'goed', { aandeel: `${Math.round(nu.aandeel * 100)}%` }); }
  }
  const V = P.verhaal.overwinning || [];
  for (let j = 0; j < V.length; j++) {
    const o = V[j];
    if (nu.dag < (o.min_dag ?? 300) - 30) continue;
    for (const b of nu.blokken) {
      // Eenmalig per blok: een blok dat twee drempels tegelijk nadert, haalt niet twee keer kort na elkaar de krant.
      const k = `bijna-${b.id}`;
      if (gemeld.has(k)) continue;
      const bijna = o.type === 'aandeel_productie' ? b.aandeel >= o.drempel - KRANT_BELEID.bijnaMarge
        : o.type === 'aantal_landen' ? b.leden >= o.drempel - 1
          : o.type === 'tech_factor' ? b.tech >= o.drempel * (1 - KRANT_BELEID.bijnaMarge) : false;
      if (!bijna) continue;
      gemeld.add(k);
      const eigen = b.id === state.spelerBlok;
      zet('bijna', 3, eigen ? 'goed' : 'slecht', { blok: state.blokken.find((x) => x.id === b.id)?.naam ?? b.id });
    }
  }
  // C18c: de machtsbalans slaat aan (alleen bij aanslaan, nooit elke dag; loslaten haalt de krant niet).
  if (nu.mg) {
    const was = vorige.mg?.gemeld ?? {};
    for (const b of state.blokken) {
      if ((nu.mg.gemeld[b.id] ?? 0) !== -1 || (was[b.id] ?? 0) === -1) continue;
      if (b.id === state.spelerBlok) zet('nerveus', 3, 'slecht', { blok: b.naam });
      else zet('te_machtig', 3, 'goed', { blok: b.naam });
    }
    if (nu.mg.rustVan != null && nu.mg.rustVan !== (vorige.mg?.rustVan ?? null)) {
      const r = nu.mg.rivaal;
      const naam = r?.startsWith('land:') ? state.landen[+r.slice(5)]?.naam : state.blokken.find((x) => x.id === r)?.naam;
      if (naam) zet('wapenrust', 3, 'goed', { blok: naam });
    }
  }
  if (nu.oorlogen > vorige.oorlogen) zet('oorlog', 3, 'slecht');
  else if (nu.oorlogen < vorige.oorlogen) zet('vrede', 2, 'goed');
  const log = nieuweLog(vorige, state);
  const weg = vorige.haarden.filter((id) => !nu.haarden.includes(id));
  if (weg.length) {
    for (const l of log) {
      if (l.tekst.startsWith(LOG_VOORVOEGSELS.haard_opgelost)) zet('haard_opgelost', 2, 'goed', { haard: haardNaam(l.tekst, LOG_VOORVOEGSELS.haard_opgelost) });
      else if (l.tekst.startsWith(LOG_VOORVOEGSELS.haard_uitgebarsten)) zet('haard_uitgebarsten', 3, 'slecht', { haard: haardNaam(l.tekst, LOG_VOORVOEGSELS.haard_uitgebarsten) });
    }
  }
  const speler = state.landen[state.speler];
  for (const l of log) {
    if (l.tekst.startsWith(LOG_VOORVOEGSELS.verkiezing)) zet('verkiezing', 2, 'goed');
    else if (l.tekst.startsWith(`${LOG_VOORVOEGSELS.hervorming} ${speler.naam}`)) zet('hervorming', 2, 'goed');
    else if (l.tekst.startsWith(LOG_VOORVOEGSELS.kolonie)) zet('kolonie', 2, 'goed');
  }
  if (nu.uitkomst && !vorige.uitkomst) zet(state.uitkomst?.spelerWint ? 'einde_winst' : 'einde_verlies', 4, state.uitkomst?.spelerWint ? 'goed' : 'slecht');
  return uit;
}

function haardNaam(tekst, voorvoegsel) {
  return tekst.slice(voorvoegsel.length).trim().split('.')[0];
}

// ---------- edities (puur) ----------

const PLAATSHOUDER = /\{([a-z]+)\}/g;
const kanVullen = (t, data) => [...t.matchAll(PLAATSHOUDER)].every((m) => data[m[1]] != null && data[m[1]] !== '');
export function vul(t, data) {
  return t.replace(PLAATSHOUDER, (_, k) => (data[k] != null ? String(data[k]) : ''));
}

// Vaste gegevens voor elke kop: wie je bent, je rivaal, het jaar.
export function basisData(state) {
  const c = state.landen[state.speler];
  const r = state.rivaal;
  const leider = r ? state.landen[r.leider] : null;
  return {
    speler: c?.naam, spelerblok: state.blokken.find((b) => b.id === state.spelerBlok)?.naam, leider: c?.leider,
    rivaal: leider?.leider, rivaalland: leider?.naam, jaar: jaarVan(state),
  };
}

function kies(lijst, sleutel) {
  return lijst.length ? lijst[fnv(sleutel) % lijst.length] : null;
}

function koppenVan(state, soort) {
  return state.pack.krant?.koppen?.[soort] ?? { goed: [], slecht: [], sub: [] };
}

const metRivaal = (t) => t.includes('{rivaal}') || t.includes('{rivaalland}');

// Een kop voor één moment. Sjabloonkeuze uit `${seed}-${dag}-${soort}-${n}`.
function kopVoor(state, m, n, data) {
  const k = koppenVan(state, m.soort);
  const eigen = (k[m.toon] ?? []).filter((t) => kanVullen(t, data));
  const lijst = eigen.length ? eigen : [...(k.goed ?? []), ...(k.slecht ?? [])].filter((t) => kanVullen(t, data));
  const t = kies(lijst, `${state.instellingen.seed}-${state.dag}-${m.soort}-${n}`);
  return t ? vul(t, data) : null;
}

function subVoor(state, soort, n, data, rivaal, al) {
  const k = koppenVan(state, soort);
  const lijst = (k.sub ?? []).filter((t) => metRivaal(t) === rivaal && kanVullen(t, data) && !al.includes(vul(t, data)));
  const t = kies(lijst, `${state.instellingen.seed}-${state.dag}-${soort}-${n}`);
  return t ? vul(t, data) : null;
}

// { dag, kop, subs (max 2), soorten, prio, toon } uit de verzamelde momenten. De teksten zijn al ingevuld
// (platte tekst); pas bij tonen gaan ze door esc().
export function maakEditie(state, momenten) {
  const lijst = [...momenten].sort((a, b) => b.prio - a.prio);
  const top = lijst[0];
  const basis = basisData(state);
  const data = { ...basis, ...top.data };
  const kop = kopVoor(state, top, 0, data) ?? (state.pack.krant?.naam ?? 'Nieuws');
  const subs = [];
  if (top.soort === 'start' && state.rivaal) {
    const les = state.pack.rivaalIndex?.[state.rivaal.les];
    const t = les?.kop && kanVullen(les.kop, data) ? vul(les.kop, data) : subVoor(state, 'start', 1, data, true, subs);
    if (t) subs.push(t);
  }
  for (let i = 1; i < lijst.length && subs.length < 2; i++) {
    const t = kopVoor(state, lijst[i], i, { ...basis, ...lijst[i].data });
    if (t && t !== kop && !subs.includes(t)) subs.push(t);
  }
  for (let n = 1; subs.length < 2 && n <= 3; n++) {
    const t = subVoor(state, top.soort, n + 10, data, false, subs);
    if (t) subs.push(t);
  }
  return { dag: state.dag, kop, subs: subs.slice(0, 2), soorten: lijst.map((m) => m.soort), prio: top.prio, toon: top.toon };
}

// ---------- kroniek (puur) ----------

const kort = (t) => (t.length > 80 ? `${t.slice(0, 79)}…` : t);

// De kroniek van een potje: de koppen van hooguit vier edities met de hoogste prio plus de eindkop, als
// [{ dag, tekst }] (platte tekst, max 80 tekens). Een leeg of onvolledig archief (geladen spel) vult aan met
// `aanvulling` (de hoogtepunten uit einde.js).
export function kroniekUit(archief, state, aanvulling = []) {
  const edities = archief?.edities ?? [];
  const vanaf = archief?.vanaf ?? 0;
  const isEinde = (e) => e.soorten?.[0] === 'einde_winst' || e.soorten?.[0] === 'einde_verlies';
  let eind = edities.find(isEinde);
  if (!eind && state?.uitkomst) {
    eind = maakEditie(state, [{ soort: state.uitkomst.spelerWint ? 'einde_winst' : 'einde_verlies', prio: 4, toon: state.uitkomst.spelerWint ? 'goed' : 'slecht', data: {} }]);
    eind.dag = state.uitkomst.dag ?? state.dag;
  }
  // Hoogste prio eerst; bij gelijke prio eerst elk soort moment één keer, zodat de kroniek niet alleen
  // uit de eerste jaren bestaat (twee keer 'onrust' verdringt anders een latere oorlog).
  const gesorteerd = edities.filter((e) => !isEinde(e)).map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.prio - a.e.prio || a.i - b.i);
  const rest = [];
  const soorten = [];
  const ondergrens = gesorteerd[Math.min(3, gesorteerd.length - 1)]?.e.prio ?? 0;
  for (const x of gesorteerd) {
    if (rest.length >= 4 || x.e.prio < ondergrens) break;
    const soort = x.e.soorten?.[0];
    if (soorten.includes(soort)) continue;
    soorten.push(soort);
    rest.push(x.e);
  }
  for (const x of gesorteerd) if (rest.length < 4 && !rest.includes(x.e)) rest.push(x.e);
  const regels = rest.map((e) => ({ dag: e.dag, tekst: kort(e.kop) }));
  if (vanaf > 0 || regels.length < 2) {
    for (const p of aanvulling) {
      if (regels.length >= 4) break;
      if (p.id === 'einde') continue;
      if (vanaf > 0 && p.dag >= vanaf && regels.length >= 2) continue;
      if (regels.some((r) => r.dag === p.dag)) continue;
      regels.push({ dag: p.dag, tekst: kort(p.tekst) });
    }
  }
  regels.sort((a, b) => a.dag - b.dag);
  if (eind) regels.push({ dag: eind.dag, tekst: kort(eind.kop), eind: true });
  return regels.slice(-5);
}

// ---------- uitgavebeleid en weergave ----------

function leesUit() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(OPSLAG_SLEUTEL) === 'uit'; } catch { return false; }
}
function schrijfUit(uit) {
  try { if (uit) localStorage.setItem(OPSLAG_SLEUTEL, 'uit'); else localStorage.removeItem(OPSLAG_SLEUTEL); } catch { /* geen opslag: alleen deze sessie */ }
}

// opties: { openModal, sluitModal, magTonen(): bool, startVrij(): bool, toonKaart(editie), verbergKaart(), markeer(n) }.
// Zonder toonKaart/verbergKaart/markeer gebruikt hij de DOM (#krant-kaart en de Log-tab). Zo draait het in node.
export function maakKrant(opties = {}) {
  const heeftDom = typeof document !== 'undefined';
  const k = {
    state: null, vorige: null, gemeld: new Set(), verzameld: [], archief: { vanaf: 0, edities: [] },
    laatsteEditieDag: -Infinity, laatsteKaart: -Infinity, resetNu: 0, wachtend: null, getoond: null, getoondOp: 0,
    ongelezen: 0, uit: leesUit(),
  };

  const domKaart = () => (heeftDom ? document.getElementById('krant-kaart') : null);
  const toonKaart = opties.toonKaart ?? ((e) => {
    const el = domKaart();
    if (!el) return;
    el.innerHTML = kaartHtml(e);
    el.hidden = false;
    el.classList.remove('kk-in');
    void el.offsetWidth; // animatie opnieuw starten
    el.classList.add('kk-in');
    // De kaart is zo hoog als de kop nodig heeft; de meldingen schuiven precies zo ver omhoog.
    document.documentElement.style.setProperty('--krant-h', `${Math.ceil(el.offsetHeight)}px`);
    el.onclick = (ev) => {
      if (ev.target.closest('[data-krant="sluit"]')) { verberg(); return; }
      if (ev.target.closest('[data-krant="uit"]')) { zetAan(false); verberg(); return; }
      verberg();
      openEditie(k.archief.edities.indexOf(e));
    };
    el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.onclick(ev); } };
  });
  const verbergKaart = opties.verbergKaart ?? (() => { const el = domKaart(); if (el) el.hidden = true; });
  const markeer = opties.markeer ?? ((n) => {
    if (!heeftDom) return;
    document.querySelector('#tabs [data-tab="log"]')?.classList.toggle('krant-nieuw', n > 0);
  });
  const magTonen = opties.magTonen ?? (() => true);
  const startVrij = opties.startVrij ?? (() => true);

  function verberg() {
    if (k.getoond) { k.getoond = null; verbergKaart(); }
  }

  function kaartHtml(e) {
    const s = k.state;
    return `<div class="kk-kop"><span class="kk-naam">${esc(s.pack.krant?.naam ?? '')}</span>
      <button type="button" class="kk-sluit" data-krant="sluit" aria-label="Sluiten">×</button></div>
      <div class="kk-datum">${esc(datumVan(s, e.dag))} · dag ${e.dag}</div>
      <div class="kk-titel ${e.toon === 'slecht' ? 'slecht' : ''}">${esc(e.kop)}</div>
      ${e.subs.map((t) => `<div class="kk-sub">${esc(t)}</div>`).join('')}
      <div class="kk-voet"><span>Tik om te lezen</span><button type="button" class="kk-uit" data-krant="uit">Niet meer tonen</button></div>`;
  }

  function editieHtml(e) {
    const s = k.state;
    return `<div class="krant-editie">
      <div class="ke-naam">${esc(s.pack.krant?.naam ?? '')}</div>
      <div class="ke-datum">${esc(datumVan(s, e.dag))} · dag ${e.dag}</div>
      <h2 class="ke-kop ${e.toon === 'slecht' ? 'slecht' : ''}">${esc(e.kop)}</h2>
      ${e.subs.map((t) => `<p class="ke-sub">${esc(t)}</p>`).join('')}
      <div class="keuzes"><button class="knop primair" data-krant="dicht">Verder spelen</button></div>
    </div>`;
  }

  function openEditie(i) {
    const e = k.archief.edities[i];
    if (!e || !opties.openModal) return;
    if (!e.gelezen) { e.gelezen = true; k.ongelezen = Math.max(0, k.ongelezen - 1); markeer(k.ongelezen); }
    opties.openModal(editieHtml(e), (el) => {
      const b = el.querySelector('[data-krant="dicht"]');
      if (b) b.onclick = () => opties.sluitModal?.();
    });
  }

  function stil(e) {
    if (!e.gelezen) { e.ongelezen = true; k.ongelezen += 1; markeer(k.ongelezen); }
  }

  function publiceer(e) {
    e.gelezen = false;
    k.archief.edities.push(e);
    if (k.wachtend) { stil(k.wachtend); k.wachtend = null; }
    k.wachtend = e;
  }

  // Probeert een wachtende editie als kaartje te tonen. Geeft true als dat lukte.
  function probeerTonen(nu) {
    const e = k.wachtend;
    if (!e) return false;
    const s = k.state;
    if (s.replayDoel || k.uit) { k.wachtend = null; stil(e); return false; }
    const start = e.soorten[0] === 'start';
    if (start && !(startVrij() || nu - k.resetNu >= KRANT_BELEID.startWacht)) return false;
    if (!magTonen()) {
      // Achter een venster of paneel: de start-editie wacht, een gewone editie wacht hooguit 30 speeldagen.
      if (!start && s.dag - e.dag > 30) { k.wachtend = null; stil(e); }
      return false;
    }
    k.wachtend = null;
    if (nu - k.laatsteKaart < KRANT_BELEID.minEchteTijd) { stil(e); return false; }
    k.laatsteKaart = nu;
    k.getoond = e;
    k.getoondOp = nu;
    e.gelezen = true;
    toonKaart(e, nu);
    return true;
  }

  function verwerk(nu) {
    const s = k.state;
    if (!k.verzameld.length) return;
    const prio = Math.max(...k.verzameld.map((m) => m.prio));
    const sinds = s.dag - k.laatsteEditieDag;
    const wil = prio >= 3 || (k.verzameld.length >= 2 && sinds >= KRANT_BELEID.verzamelDagen);
    if (!wil || (prio < 4 && sinds < KRANT_BELEID.minDagen)) return;
    const e = maakEditie(s, k.verzameld);
    k.verzameld = [];
    k.laatsteEditieDag = s.dag;
    publiceer(e);
  }

  function reset(state, nu = 0) {
    k.state = state;
    k.gemeld = new Set();
    k.verzameld = [];
    k.archief = { vanaf: state.dag, edities: [] };
    k.laatsteEditieDag = -Infinity;
    k.laatsteKaart = -Infinity;
    k.resetNu = nu;
    k.wachtend = null;
    k.ongelezen = 0;
    markeer(0);
    verberg();
    k.vorige = krantFoto(state);
    // Een nieuwe partij opent met de start-editie; een geladen spel begint zonder oude momenten.
    if (state.dag === 0) { k.verzameld = krantMomenten(null, k.vorige, state, k.gemeld); verwerk(nu); }
  }

  function tick(state, nu) {
    if (state !== k.state) reset(state, nu);
    if (k.getoond && nu - k.getoondOp >= KRANT_BELEID.kaartDuur) verberg();
    if (state.dag !== k.vorige.dag || (!!state.uitkomst && !k.vorige.uitkomst)) {
      const foto = krantFoto(state);
      const m = krantMomenten(k.vorige, foto, state, k.gemeld);
      k.vorige = foto;
      if (m.length) {
        k.verzameld.push(...m);
        // Blijft er lang veel liggen (45-dagenregel), houd dan alleen de zwaarste momenten.
        if (k.verzameld.length > 8) k.verzameld = k.verzameld.sort((a, b) => b.prio - a.prio).slice(0, 8);
      }
      verwerk(nu);
    }
    probeerTonen(nu);
  }

  function zetAan(aan) {
    k.uit = !aan;
    schrijfUit(k.uit);
  }

  // Het logboek wordt steeds opnieuw getekend zolang het open staat. Een stip blijft daarom nog even staan nadat
  // hij voor het eerst te zien was, anders verdwijnt hij al bij de volgende beurt van de beeldlus.
  // `nu` komt van de klok in main.js (één klok in de weergave).
  const STIP_DUUR = 6000;
  function gelezen(nu = 0) {
    for (const e of k.archief.edities) {
      e.gelezen = true;
      if (e.ongelezen) { e.gezienOp ??= nu; if (nu - e.gezienOp >= STIP_DUUR) e.ongelezen = false; }
    }
    k.ongelezen = 0;
    markeer(0);
  }

  function archiefHtml() {
    const s = k.state;
    if (!s) return '';
    const lijst = k.archief.edities.map((e, i) => ({ e, i })).reverse();
    return `<section class="blok krant-archief"><h3><span class="ka-naam">${esc(s.pack.krant?.naam ?? 'De krant')}</span><span class="zacht">${lijst.length} ${lijst.length === 1 ? 'editie' : 'edities'}</span></h3>
      ${k.uit ? '<p class="zacht ka-uit">Krantkaartjes staan uit. <button class="knop klein" data-actie="krant-aan">Weer tonen</button></p>' : ''}
      ${lijst.length ? lijst.map(({ e, i }) => `<button type="button" class="ka-editie${e.ongelezen ? ' ongelezen' : ''}" data-actie="krant-editie" data-id="${i}">
        <span class="d">dag ${e.dag}</span><span class="ka-tekst"><b>${esc(e.kop)}</b>${e.subs.length ? `<span class="zacht">${esc(e.subs.join(' · '))}</span>` : ''}</span></button>`).join('')
    : '<p class="zacht ka-leeg">Nog geen editie. De krant verschijnt bij de grote momenten van je potje.</p>'}
    </section>`;
  }

  return {
    tick, reset, archiefHtml, openEditie, zetAan, gelezen, verberg,
    archief: () => k.archief,
    staat: () => k, // voor tests
  };
}
