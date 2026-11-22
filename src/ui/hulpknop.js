// C18b: het vraagteken (docs/c18-plan.md, "c18b-hulpknop"). Een rond ? rechts op de kaart, boven de kaartknoppen.
// Grijs als het goed gaat, goud als je achter raakt, knipperend bij gevaar. Een tik geeft één kaartje: wat je doet,
// waarom, en wat het oplevert (uitgerekend door src/ui/hulpreken.js, in een Web Worker). Met "Doe het" sta je er meteen;
// de laatste tik (✓, de hefboom, de marktknop) doet de speler zelf. Hier gaat nooit een order uit, en het spel loopt door.
//
// Samenwerking: de wijzer verdwijnt zolang het kaartje open is (onderpaneel 'hulp'), krijgt de getoonde sleutel als
// afkoeling, en zwijgt over 'stil' en 'vol' zolang het ? oplicht. Doe het gebruikt wijzer.bouwDaar / voerUit en
// doelbalk.gaNaar (geen eigen navigatie). Gebeurtenis op window: 'hulp' { sleutel, soort, actie: 'open'|'doe'|'weg' }.

import * as onderpaneelStd from './onderpaneel.js';
import { kandidaten, schat, zetUitkomst, rangschik, kies as kiesSync, aftelling, potjeVan, TEKST as REKEN_TEKST, VOORUIT_DAGEN } from './hulpreken.js';
import { achterstand } from '../engine/bijsturing.js';
import { toestand } from './evenwicht.js';

// ---------- tijd (echte ms; dit is de interface, de engine blijft zonder klok) ----------
export const BUDGET_MS = 1200;            // de worker rekent zo lang; wat dan niet klaar is, krijgt de schatting
export const WACHT_MS = 250;              // zonder antwoord binnen deze tijd: eerst de schatting, met "Even rekenen…" (review: 250, zodat het kaartje er binnen 300 ms staat)
export const VOORUIT_ELKE_DAGEN = 10;     // zolang het ? oplicht, rekent de worker zo vaak op de achtergrond
export const VERS_DAGEN = 5;              // een antwoord tot zo oud toont het kaartje zonder te verversen
export const GEEN_WORKER_BUDGET_MS = 400; // zonder worker: zo lang op de hoofdthread ...
export const GEEN_WORKER_MAX = 3;         // ... en zoveel kandidaten
export const GEEN_WORKER_DAGEN = 30;      // ... en zo ver vooruit (review: één stap van 60 dagen kost soms al een seconde)
export const STAND_ELKE_MS = 1000;        // zo vaak kijkt de knop of hij moet oplichten
export const KLAAR_MS = 90000;            // een order binnen zoveel tijd na Doe het telt als "de stap gedaan"

export const TEKST = {
  knop: 'Hulp: wat is nu de beste stap?',
  doe: 'Doe het',
  ander: 'Andere stap',
  weg: 'Sluiten',
  oke: 'Oké',
  goedKop: 'Je staat er goed voor. Volgende kans:',
  achterKop: 'Zo kom je terug:',
  gevaarKop: 'Let op!',
  goedZo: 'Goed zo. Tik weer op ? voor de volgende stap.',
  replay: 'In een replay kijk je alleen.',
};

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const zonderPack = (s) => ({ ...s, pack: null, replay: null });

export function maakHulpknop(api) {
  const { ui } = api;
  const onderpaneel = api.onderpaneel ?? onderpaneelStd;
  const $ = (q) => document.querySelector(q);
  const wrap = $('#kaart-wrap');
  if (!wrap) return null;
  // De tijd komt uit requestAnimationFrame (dezelfde klok als map.js en de wijzer); het ? heeft geen eigen klok.
  let klokNu = 0;
  const nu = () => klokNu;

  let knop = $('#hulpknop');
  if (!knop) { knop = document.createElement('button'); knop.id = 'hulpknop'; wrap.append(knop); }
  knop.type = 'button';
  knop.className = 'hulpknop stand-grijs';
  knop.setAttribute('aria-label', TEKST.knop);
  knop.title = TEKST.knop;
  knop.innerHTML = '<span class="hk-teken" aria-hidden="true">?</span><span class="hk-stip" aria-hidden="true"></span>';

  const kaart = document.createElement('div');
  kaart.id = 'hulpkaart';
  kaart.className = 'hulpkaart';
  kaart.hidden = true;
  kaart.setAttribute('role', 'region');
  kaart.setAttribute('aria-label', 'Hulp');
  kaart.setAttribute('aria-live', 'polite');
  kaart.innerHTML = `<div class="hk-kop" hidden></div><div class="hk-wat"></div><div class="hk-waarom"></div><div class="hk-levert"></div>`
    + `<div class="hk-knoppen"><button type="button" class="hk-doe" data-hk="doe">${TEKST.doe}</button>`
    + `<button type="button" class="hk-ander" data-hk="ander">${TEKST.ander}</button>`
    + `<button type="button" class="hk-weg" data-hk="weg" aria-label="${TEKST.weg}" title="${TEKST.weg}">✕</button></div>`;
  wrap.append(kaart);

  const h = {
    state: null, stand: 'grijs', standTick: 0, plekTick: 0, fout: false,
    werker: null, werkerKapot: false, packVoor: null, volgId: 0, wacht: null,
    antwoord: null,          // { potje, dag, uitkomst, stap }
    achterDag: null,         // laatste dag waarop op de achtergrond is gerekend
    keuze: null,             // { lijst, i, ernst, aftelling, rekenen, getoond } op het open kaartje
    gedaan: null,            // { sleutel, soort, type, tot } na Doe het, voor de toast
    tikken: 0, laatsteTikken: [],
  };

  // ---------- de worker ----------
  function werker() {
    if (h.werker || h.werkerKapot || typeof Worker !== 'function') return h.werker;
    try {
      h.werker = new Worker(new URL('./hulpwerker.js', import.meta.url), { type: 'module' });
      h.werker.onmessage = (e) => ontvang(e.data);
      h.werker.onerror = (e) => { console.warn('hulpwerker', e?.message ?? e); h.werkerKapot = true; h.werker = null; if (h.wacht) { const w = h.wacht; h.wacht = null; w.klaar(null); } };
    } catch (e) {
      console.warn('hulpwerker', e);
      h.werkerKapot = true;
      h.werker = null;
    }
    return h.werker;
  }

  function ctxVan() {
    const m = api.wijzer?.geheugen?.mem;
    return { stilSinds: m?.stilSinds ?? null, volSinds: m?.volSinds ?? {}, bekekenGebied: api.gebieden?.huidig?.() ?? -1 };
  }

  // Vraag de worker om een keuze; klaar(antwoord of null) volgt zodra hij er is.
  function vraag(s, klaar) {
    const w = werker();
    if (!w) { klaar(null); return; }
    const potje = potjeVan(s);
    // Rekent de worker al (op de achtergrond) voor bijna dezelfde dag, dan wachten we op dat antwoord.
    if (h.wacht && h.wacht.potje === potje && s.dag >= h.wacht.dag && s.dag - h.wacht.dag <= VERS_DAGEN) {
      const vorige = h.wacht.klaar;
      h.wacht.klaar = (a) => { vorige(a); klaar(a); };
      return;
    }
    // Review: per potje, niet per pack. Het spel gebruikt hetzelfde pack voor een tweede potje (ander land, andere
    // seed); met alleen een packcheck kreeg de worker dat potje nooit en rekende het ? daarna steeds op de hoofdthread.
    if (h.packVoor !== potje) {
      const pad = ui.packs?.find((p) => p.pack === s.pack)?.item?.pad;
      if (!pad) { klaar(null); return; }
      w.postMessage({ soort: 'pack', potje, pad, instellingen: s.instellingen });
      h.packVoor = potje;
    }
    const id = ++h.volgId;
    if (h.wacht) h.wacht.klaar(null); // een oudere vraag is niet meer nodig
    h.wacht = { id, klaar, potje, dag: s.dag };
    try {
      w.postMessage({ soort: 'kies', id, potje, state: zonderPack(s), ctx: ctxVan(), budgetMs: BUDGET_MS, dagen: VOORUIT_DAGEN });
    } catch (e) {
      console.warn('hulpwerker', e);
      h.werkerKapot = true;
      h.wacht = null;
      klaar(null);
    }
  }

  function ontvang(m) {
    if (!m || !h.wacht || m.id !== h.wacht.id) return;
    const w = h.wacht;
    h.wacht = null;
    if (m.soort !== 'klaar') { console.warn('hulpwerker', m.tekst); w.klaar(null); return; }
    h.antwoord = { potje: w.potje, dag: m.dag, uitkomst: m.uitkomst, stap: m.stap, ms: m.ms };
    w.klaar(h.antwoord);
  }

  // Zonder worker: dezelfde keuze op de hoofdthread, korter.
  // Review: hier een echte klok. De klok van requestAnimationFrame staat stil zolang deze berekening de hoofdthread
  // bezet houdt, zodat het budget nooit ingreep (op de Mac tot ruim 4 s voor 3 stappen op dag 600).
  function rekenHier(s) {
    const klok = typeof performance === 'object' ? () => performance.now() : nu;
    const r = kiesSync(s, { klok, budgetMs: GEEN_WORKER_BUDGET_MS, max: GEEN_WORKER_MAX, dagen: GEEN_WORKER_DAGEN, ctx: ctxVan() });
    const uitkomst = {};
    for (const k of r?.kandidaten ?? []) uitkomst[k.sleutel] = { score: k.score, regel3: k.regel3, fout: k.fout ?? null, gerekend: !!k.gerekend };
    h.antwoord = { potje: potjeVan(s), dag: s.dag, uitkomst, stap: r?.stap?.sleutel ?? null };
    return h.antwoord;
  }

  // ---------- het kaartje ----------
  function lijstVoor(s, antwoord) {
    const ks = schat(kandidaten(s, { ...ctxVan(), lijst: toestand(s) }));
    if (antwoord && antwoord.potje === potjeVan(s)) zetUitkomst(ks, antwoord.uitkomst);
    return rangschik(ks).slice(0, 3);
  }

  function vul(keuze) {
    const k = keuze.lijst[keuze.i];
    const s = ui.state;
    const kop = kaart.querySelector('.hk-kop');
    const dringend = k && (k.soort === 'gevaar' || k.soort === 'tekort-rood');
    const kopTekst = h.stand === 'gevaar' ? TEKST.gevaarKop : h.stand === 'goud' ? TEKST.achterKop : dringend ? '' : TEKST.goedKop;
    kop.textContent = kopTekst;
    kop.hidden = !kopTekst;
    kaart.dataset.stand = h.stand;
    kaart.dataset.soort = k?.soort ?? '';
    kaart.querySelector('.hk-wat').textContent = k ? `${k.icoon ? `${k.icoon} ` : ''}${k.wat}` : '';
    kaart.querySelector('.hk-waarom').textContent = k?.waarom ?? '';
    let levert = !k ? '' : keuze.rekenen && !k.gerekend ? REKEN_TEKST.rekenen : k.regel3;
    if (keuze.aftelling && h.stand === 'gevaar') levert = `${keuze.aftelling} ${levert}`;
    kaart.querySelector('.hk-levert').textContent = levert;
    const doe = kaart.querySelector('.hk-doe');
    doe.textContent = k?.doe?.type === 'geen' ? TEKST.oke : TEKST.doe;
    doe.disabled = !k || !!s?.replay;
    doe.title = s?.replay ? TEKST.replay : '';
    kaart.querySelector('.hk-ander').hidden = keuze.lijst.length < 2;
    if (k) api.wijzer?.doorHulpGetoond?.(k.sleutel);
  }

  function open() {
    const s = ui.state;
    if (!s || s.uitkomst) return;
    const t0 = nu();
    const a = achterstand(s);
    const vers = h.antwoord && h.antwoord.potje === potjeVan(s) && s.dag >= h.antwoord.dag && s.dag - h.antwoord.dag <= VERS_DAGEN;
    const oud = h.antwoord && h.antwoord.potje === potjeVan(s) && s.dag >= h.antwoord.dag;
    const keuze = { lijst: lijstVoor(s, oud ? h.antwoord : null), i: 0, ernst: a.ernst, aftelling: aftelling(s, a), rekenen: !oud, getoond: false, t0 };
    h.keuze = keuze;
    onderpaneel.open('hulp', sluitStil);
    const toon = () => { if (h.keuze !== keuze || keuze.getoond) return; keuze.getoond = true; kaart.hidden = false; vul(keuze); keuze.msTotKaart = nu() - t0; };
    if (!keuze.lijst.length) { keuze.lijst = [{ sleutel: 'wacht', soort: 'wacht', wat: REKEN_TEKST.wacht, waarom: '', regel3: '', doe: { type: 'geen' } }]; }
    if (vers) { keuze.rekenen = false; toon(); }
    else {
      const eerst = keuze.lijst[0]?.sleutel;
      if (oud) toon(); // meteen het vorige antwoord; daarna stil verversen (alleen regel 3)
      const tijd = setTimeout(() => toon(), WACHT_MS);
      const klaar = (antw) => {
        clearTimeout(tijd);
        if (h.keuze !== keuze) return;
        if (!antw) antw = rekenHier(ui.state ?? s);
        const nieuw = lijstVoor(ui.state ?? s, antw);
        if (keuze.getoond && oud) {
          // Stil verversen: dezelfde stappen blijven staan, alleen regel 3 krijgt de nieuwe berekening.
          for (const k of keuze.lijst) { const n = nieuw.find((x) => x.sleutel === k.sleutel); if (n) { k.regel3 = n.regel3; k.gerekend = n.gerekend; } }
        } else keuze.lijst = nieuw.length ? nieuw : keuze.lijst;
        keuze.rekenen = false;
        keuze.veranderd = eerst !== keuze.lijst[0]?.sleutel;
        if (!keuze.getoond) toon(); else vul(keuze);
      };
      vraag(s, klaar);
    }
    meld('open');
  }

  function sluitStil() {
    kaart.hidden = true;
    h.keuze = null;
  }
  function sluit() {
    sluitStil();
    onderpaneel.sluit('hulp');
  }

  function meld(actie) {
    const k = h.keuze?.lijst[h.keuze.i];
    try { window.dispatchEvent(new CustomEvent('hulp', { detail: { sleutel: k?.sleutel ?? null, soort: k?.soort ?? null, actie } })); } catch { /* geen window */ }
  }

  // De knop die de speler zelf als laatste tikt, laten gloeien (en op de telefoon in beeld brengen).
  function gloei(q) {
    if (!q) return;
    const zoek = (n) => {
      const el = document.querySelector(q);
      if (el) {
        el.classList.add('hk-gloed');
        setTimeout(() => el.classList.remove('hk-gloed'), 6000);
        // Valt de knop buiten beeld (lang paneel, telefoon), schuif hem erin: de laatste tik moet je zien.
        const b = el.getBoundingClientRect();
        if (b.top < 0 || b.bottom > innerHeight || b.left < 0 || b.right > innerWidth) el.scrollIntoView({ block: 'center' });
      } else if (n > 0) requestAnimationFrame(() => zoek(n - 1));
    };
    requestAnimationFrame(() => zoek(20));
  }

  function doe() {
    const keuze = h.keuze;
    const k = keuze?.lijst[keuze.i];
    const s = ui.state;
    if (!k || !s || s.replay || s.uitkomst) return;
    meld('doe');
    sluit();
    const d = k.doe ?? {};
    h.gedaan = d.type === 'geen' ? null : { sleutel: k.sleutel, soort: k.soort, type: k.eerste?.type ?? k.order?.(s)?.type ?? null, tot: nu() + KLAAR_MS };
    if (d.type === 'bouw') {
      if (d.tegel >= 0) api.wijzer?.bouwDaar?.(d.gebouw, d.gebied, d.tegel);
      else if (api.doelbalk) api.doelbalk.gaNaar({ gebouw: d.gebouw, tab: 'economie', knop: `[data-actie="plaats"][data-id="${d.gebouw}"]` });
    } else if (d.type === 'markt') {
      api.evenwicht?.open(d.r);
      gloei('[data-ev="markt"]');
    } else if (d.type === 'land') {
      api.doelbalk?.gaNaar({ land: d.land, knop: d.knop });
      gloei(d.knop);
    } else if (d.type === 'knop') {
      api.doelbalk?.gaNaar({ tab: d.tab, knop: d.knop });
      gloei(d.knop);
    } else if (d.type === 'zoalsthuis') {
      api.wijzer?.voerUit?.({ actie: { type: 'zoalsthuis' }, gebied: d.gebied, tegel: d.tegel });
    }
    ui.dirty = true;
  }

  kaart.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hk]');
    if (!b || !h.keuze) return;
    if (b.dataset.hk === 'weg') { meld('weg'); sluit(); }
    else if (b.dataset.hk === 'ander') { h.keuze.i = (h.keuze.i + 1) % h.keuze.lijst.length; vul(h.keuze); }
    else if (b.dataset.hk === 'doe') doe();
  });
  knop.addEventListener('click', () => {
    h.tikken += 1;
    if (h.keuze) { meld('weg'); sluit(); return; }
    open();
  });

  // Na Doe het: lukt de laatste tik (een order van dezelfde soort), dan een kleine toast.
  window.addEventListener('order', (e) => {
    const g = h.gedaan;
    const d = e.detail;
    if (!g || !d?.ok || nu() > g.tot) return;
    if (g.type && d.order?.type !== g.type) return;
    h.gedaan = null;
    api.toast?.(TEKST.goedZo, 'goed');
  });

  // ---------- stand en plek ----------
  function zetStand(stand) {
    if (stand === h.stand) return;
    const was = h.stand;
    h.stand = stand;
    knop.classList.remove('stand-grijs', 'stand-goud', 'stand-gevaar');
    knop.classList.add(`stand-${stand}`);
    if (stand === 'gevaar' && was !== 'gevaar') {
      knop.classList.remove('knipper');
      void knop.offsetWidth; // de animatie opnieuw starten
      knop.classList.add('knipper');
    }
  }

  // Direct boven de kaartknoppen (+ − ⌂ ⤢), rechts uitgelijnd; schuift mee als de lade de kaartknoppen omhoog duwt.
  function plaats() {
    const kk = wrap.querySelector('.kaart-knoppen');
    if (!kk) return;
    const w = wrap.getBoundingClientRect();
    const r = kk.getBoundingClientRect();
    if (!r.height) return;
    const onder = Math.round(w.bottom - r.top + 8);
    const rechts = Math.round(w.right - r.right);
    if (knop.style.bottom !== `${onder}px`) knop.style.bottom = `${onder}px`;
    if (knop.style.right !== `${rechts}px`) knop.style.right = `${rechts}px`;
  }

  function stap(t) {
    const s = ui.state;
    if (s !== h.state) {
      h.state = s;
      h.antwoord = null;
      h.achterDag = null;
      h.gedaan = null;
      if (h.keuze) sluit();
      zetStand('grijs');
    }
    knop.hidden = !s || !!s.uitkomst || !!$('#spel')?.hidden;
    if (h.keuze && s?.uitkomst) sluit(); // review: het potje is voorbij, dan geen stap meer
    if (t - h.plekTick > 250) { h.plekTick = t; plaats(); }
    if (!s || knop.hidden) return;
    if (t - h.standTick < STAND_ELKE_MS) return;
    h.standTick = t;
    const e = achterstand(s).ernst;
    zetStand(e === 'gevaar' ? 'gevaar' : e === 'achter' ? 'goud' : 'grijs');
    // Licht het ? op, dan rekent de worker om de VOORUIT_ELKE_DAGEN dagen vooruit, zodat een tik meteen antwoord heeft.
    if (h.stand !== 'grijs' && !h.keuze && !h.wacht && !s.replay && (h.achterDag == null || s.dag - h.achterDag >= VOORUIT_ELKE_DAGEN || s.dag < h.achterDag)) {
      h.achterDag = s.dag;
      if (werker()) vraag(s, () => {});
    }
  }

  function lus(t) {
    requestAnimationFrame(lus);
    klokNu = t;
    if (h.fout) return;
    try { stap(t); } catch (err) { h.fout = true; console.error('hulpknop', err); }
  }
  requestAnimationFrame(lus);
  addEventListener('resize', () => plaats());
  window.addEventListener('bouwlade', () => requestAnimationFrame(plaats));

  api.wijzer?.zetHulp?.(() => h.stand !== 'grijs');

  const uit = { open, sluit, stand: () => h.stand, isOpen: () => !!h.keuze && !kaart.hidden, keuze: () => h.keuze, geheugen: h };
  window.machtsbalansHulp = uit; // voor de console en tools/kijk.mjs (zoals window.machtsbalans)
  return uit;
}
