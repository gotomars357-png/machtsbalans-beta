// Browserlaag: leest packs, toont het startscherm en tekent de simulatie. Alle spelregels zitten in src/engine.

import { loadPack } from '../engine/packloader.js';
import { ENGINE_VERSION } from '../engine/defaults.js';
import * as sim from '../engine/sim.js';
import { KaartView } from './map.js';
import { tekenGrafiek } from './chart.js';
import { woningCapaciteit, voorziening, campagneStatus, netwerkStatus } from '../engine/samenleving.js';
import * as leger from '../engine/leger.js';
import { hervormingStatus } from '../engine/regimes.js';
import { mediaStatus, overnameStatus, vijandigeMedia, mediaCapaciteit } from '../engine/media.js';
import { CONTRACT, contractenVan } from '../engine/contracten.js';
import { maakDoelen } from './doelen.js';
import { toonEindoverzicht, startSessie, kaartGeklikt, gezondSpelen } from './einde.js';
import { toonUitdaging } from './uitdaging.js';
import { extraEffectTekst, keuzeKnop } from './dilemma.js';
import { cyberBlok, cyberTrede } from './cyber.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 100000) return `${(n / 1000).toFixed(0)}k`;
  if (a >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (a >= 100) return n.toFixed(0);
  return n.toFixed(1);
};
const plus = (n, d = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}`;
const pct = (n, d = 0) => `${(n * 100).toFixed(d)}%`;

const readText = async (p) => {
  const r = await fetch(p, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

const ui = {
  packs: [], gekozenPack: null, gekozenLand: null,
  state: null, tempo: 0, vorigTempo: 1, kaart: null, tab: 'economie', sel: -1,
  selectie: new Set(), dirty: true, modal: null, eindGetoond: false, ontgrendeldGezien: new Set(), grafiekLen: -1,
};

// ---------- startscherm ----------

async function init() {
  $('#engine-versie').textContent = ENGINE_VERSION;
  let index = [];
  try {
    index = JSON.parse(await readText('packs/index.json'));
  } catch (e) {
    $('#pack-lijst').innerHTML = `<p class="slecht">Kon packs/index.json niet laden (${esc(e.message)}). Controleer je verbinding en laad de pagina opnieuw.</p>`;
    return;
  }
  for (const item of index) {
    const res = await loadPack(item.pad, readText);
    ui.packs.push({ item, ...res });
  }
  renderPacks();
  toonVerderKnop();
  toonUitdaging(ui.packs, startSpel);
  const eerste = ui.packs.find((p) => p.pack && !p.rapport.fouten.length);
  if (eerste) kiesPack(eerste);
}

function renderPacks() {
  $('#pack-lijst').innerHTML = ui.packs.map((p, i) => {
    const m = p.pack?.meta ?? { naam: p.item.id };
    const f = p.rapport.fouten.length, w = p.rapport.waarschuwingen.length;
    const status = f ? `<span class="slecht">✕ ${f} fout${f > 1 ? 'en' : ''}</span>` : w ? `<span style="color:var(--accent)">⚠ ${w}</span>` : '<span class="goed">✓ geldig</span>';
    return `<button class="pack ${ui.gekozenPack === p ? 'gekozen' : ''}" data-pack="${i}">
      <div class="titel"><span>${esc(m.naam)} <span class="pil">${esc(m.classificatie ?? '?')}</span></span>${status}</div>
      <p>${esc(m.beschrijving ?? '')}</p>
      <p class="zacht" style="font-size:11px">v${esc(m.versie ?? '?')} · ${esc(m.auteur ?? '')} · ${esc(m.licentie ?? 'geen licentie')}</p>
    </button>`;
  }).join('');
  for (const b of document.querySelectorAll('[data-pack]')) b.onclick = () => kiesPack(ui.packs[+b.dataset.pack]);
}

function kiesPack(p) {
  ui.gekozenPack = p;
  ui.gekozenLand = p.pack?.landen.find((l) => l.speelbaar)?.id ?? null;
  renderPacks();
  const r = p.rapport;
  const lijst = (items, cls) => (items.length ? `<ul>${items.map((x) => `<li class="${cls}">${esc(x)}</li>`).join('')}</ul>` : '');
  $('#pack-rapport').innerHTML = `
    <h2>Validatie</h2>
    ${r.fouten.length ? `<div class="fout">Dit pack kan niet starten:</div>${lijst(r.fouten, 'fout')}` : '<div class="goed">Klaar om te spelen.</div>'}
    ${lijst(r.waarschuwingen, 'waarsch')}
    ${r.info.length ? `<details><summary class="inf">Aangevuld met standaardwaarden (${r.info.length})</summary>${lijst(r.info, 'inf')}</details>` : ''}`;
  renderLanden();
}

function renderLanden() {
  const p = ui.gekozenPack?.pack;
  const ok = p && !ui.gekozenPack.rapport.fouten.length;
  $('#start-knop').disabled = !ok;
  if (!p) { $('#land-lijst').innerHTML = ''; return; }
  $('#land-lijst').innerHTML = p.landen.filter((l) => l.speelbaar).map((l) => {
    const b = p.blokken.find((x) => x.id === l.blok);
    const pers = p.persoonlijkheden[l.persoonlijkheid]?.naam ?? l.persoonlijkheid;
    return `<button class="land-kaart ${ui.gekozenLand === l.id ? 'gekozen' : ''}" data-land="${esc(l.id)}">
      <span class="kleur" style="background:${b?.kleur ?? '#777'}"></span>
      <span><b>${esc(l.naam)}</b> <span class="zacht">· ${esc(b?.naam ?? '')}</span>
      <p>${p.regimes[l.regime]?.icoon ?? ''} ${esc(p.regimes[l.regime]?.naam ?? '')} · ${esc(l.beschrijving || `Kernland, ${pers.toLowerCase()} buitenlandbeleid.`)} Bevolking ${l.bevolking} mln.</p></span>
    </button>`;
  }).join('');
  for (const b of document.querySelectorAll('[data-land]')) b.onclick = () => { ui.gekozenLand = b.dataset.land; renderLanden(); };
}

function leesInstellingen() {
  return {
    seed: +$('#opt-seed').value || 1,
    land: ui.gekozenLand,
    moeilijkheid: $('#opt-moeilijkheid').value,
    onboarding: $('#opt-onboarding').checked,
    systemen: { events: $('#opt-events').checked, schokken: $('#opt-schokken').checked, escalatie: $('#opt-escalatie').checked },
  };
}

$('#start-knop').onclick = () => startSpel(ui.gekozenPack.pack, leesInstellingen());

$('#replay-bestand').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const rep = JSON.parse(await f.text());
    if (rep.formaat === 'machtsbalans-opslag') { laadSpel(rep); e.target.value = ''; return; }
    if (rep.formaat !== 'machtsbalans-replay') throw new Error('Geen Machtsbalans-opslag of -replay.');
    const p = ui.packs.find((x) => x.pack?.meta.id === rep.pack.id);
    if (!p) throw new Error(`Pack '${rep.pack.id}' is niet geïnstalleerd.`);
    if (p.pack.meta.versie !== rep.pack.versie) toast(`Let op: replay gemaakt met pack-versie ${rep.pack.versie}, geïnstalleerd is ${p.pack.meta.versie}.`, 'slecht');
    startSpel(p.pack, rep.instellingen, rep);
  } catch (err) {
    toast(`Replay laden mislukt: ${err.message}`, 'slecht');
  }
  e.target.value = '';
};

// ---------- opslaan en laden ----------

const OPSLAG_SLEUTEL = 'machtsbalans-opslag';
const AUTO_SLEUTEL = 'machtsbalans-autosave';
const AUTO_INTERVAL = 30;

function leesOpslag(sleutel = OPSLAG_SLEUTEL) {
  try { return JSON.parse(localStorage.getItem(sleutel) ?? 'null'); } catch { return null; }
}

// Startscherm: één knop voor de handmatige opslag en één voor de automatische.
function toonVerderKnop() {
  if (!$('#auto-knop')) {
    const k = document.createElement('button');
    k.id = 'auto-knop';
    k.className = 'knop';
    k.hidden = true;
    k.onclick = () => { const o = leesOpslag(AUTO_SLEUTEL); if (o) laadSpel(o); };
    $('#verder-knop').after(k);
  }
  for (const [id, sleutel, label, uitleg] of [['#verder-knop', OPSLAG_SLEUTEL, 'Verder', 'Jouw opgeslagen spel'], ['#auto-knop', AUTO_SLEUTEL, 'Autosave', 'Automatisch opgeslagen, elke 30 dagen en bij terug naar het startscherm']]) {
    const o = leesOpslag(sleutel);
    const knop = $(id);
    const p = o && ui.packs.find((x) => x.pack?.meta.id === o.pack?.id);
    knop.hidden = !p;
    if (p) { knop.textContent = `${label} · dag ${o.einddag}`; knop.title = `${uitleg}: ${p.pack.meta.naam}, dag ${o.einddag}`; }
  }
  $('.start-acties').style.flexWrap = 'wrap';
}

$('#verder-knop').onclick = () => { const o = leesOpslag(); if (o) laadSpel(o); };

// Stil opslaan in een eigen plek, zodat de handmatige opslag blijft staan.
function autoOpslaan() {
  const s = ui.state;
  if (!s || s.replay) return;
  try { localStorage.setItem(AUTO_SLEUTEL, JSON.stringify(sim.maakOpslag(s))); } catch { /* geen opslag beschikbaar: spel gaat gewoon door */ }
}

function laadSpel(opslag) {
  const p = ui.packs.find((x) => x.pack?.meta.id === opslag.pack?.id);
  if (!p) { toast(`Laden mislukt: wereld '${opslag.pack?.id}' is niet geïnstalleerd.`, 'slecht'); return; }
  const res = sim.laadOpslag(p.pack, opslag);
  if (!res.ok) toast(`Let op: ${res.reden}`, 'slecht');
  startSpel(p.pack, opslag.instellingen, null, res.state);
  toast(`Spel geladen op dag ${res.state.dag}.`, 'goed');
}

function slaOp() {
  const s = ui.state;
  if (s.replay) { toast('Een replay kun je niet opslaan.', 'info'); return; }
  try {
    localStorage.setItem(OPSLAG_SLEUTEL, JSON.stringify(sim.maakOpslag(s)));
    toast(`Opgeslagen op dag ${s.dag}. Via Verder spelen op het startscherm ga je hier weer verder.`, 'goed');
  } catch {
    toast('Opslaan in de browser lukt niet. Download de opslag als bestand.', 'slecht');
  }
}

function downloadOpslag() {
  const s = ui.state;
  download(sim.maakOpslag(s), `machtsbalans-${s.pack.meta.id}-opslag-dag${s.dag}.json`);
}

// ---------- spel starten ----------

function startSpel(pack, inst, replay = null, geladen = null) {
  ui.state = geladen ?? sim.createGame(pack, inst);
  ui.autoDag = null; // nieuwe of geladen partij: de autosave-teller begint opnieuw
  startSessie();
  if (replay) {
    ui.state.replay = replay.orders.map((o) => ({ ...o }));
    ui.state.replayDoel = replay;
  }
  ui.sel = -1;
  ui.eindGetoond = false;
  ui.ontgrendeldGezien = new Set(pack.resources.filter((r) => sim.isOntgrendeld(ui.state, r.id)).map((r) => r.id));
  ui.grafiekLen = -1;
  for (const el of document.querySelectorAll('[data-zone]')) el._html = null;
  $('#start').hidden = true;
  $('#spel').hidden = false;
  if (!ui.kaart) {
    ui.kaart = new KaartView($('#kaart'), $('#kaart-wrap'), {
      onSelect: (idx, t, x, y) => klikOpKaart(idx, t, x, y),
      onHover: (idx, t, x, y) => toonTip(idx, t, x, y),
      onPlaats: (t) => plaatsOp(t),
      onAnnuleer: () => stopBouwModus(),
      onKlikEenheid: (id, erbij) => {
        if (!erbij) ui.selectie.clear();
        if (ui.selectie.has(id) && erbij) ui.selectie.delete(id); else ui.selectie.add(id);
        ui.dirty = true;
      },
      onGebied: (x0, y0, x1, y1, erbij) => {
        if (!erbij) ui.selectie.clear();
        for (const u of ui.state.eenheden) {
          if (u.land === ui.state.speler && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) ui.selectie.add(u.id);
        }
        ui.dirty = true;
        if (ui.selectie.size && ui.tab !== 'leger') zetTab('leger');
      },
      onRechtsklik: (t) => { if (ui.selectie.size) stuurEenheden(t); },
    });
  }
  ui.kaart.geselecteerd = -1;
  ui.context = null;
  ui.selectie = new Set();
  ui.kaart.selectie = ui.selectie;
  stopBouwModus();
  ui.kaart.laad(ui.state);
  renderLegenda();
  zetTab('economie');
  zetTempo(0);
  if (replay) {
    toast('Replay: je kijkt mee, orders zijn uitgeschakeld.', 'info');
    zetTempo(4);
  } else if (!geladen) {
    toonIntro();
  }
  ui.dirty = true;
  renderUI();
  startTutorial(pack, { replay, geladen });
  doelbalk.start({ geladen: !!geladen, replay: !!replay });
}

function renderLegenda() {
  const s = ui.state;
  $('#legenda').innerHTML = [...s.blokken.map((b) => `<span><i style="background:${b.kleur}"></i>${esc(b.naam)}${b.id === s.spelerBlok ? ' (jij)' : ''}</span>`),
    `<span><i style="background:${s.pack.zwevend.kleur}"></i>Zwevend</span>`, '<span>★ jouw land · ◆ blokleider · ⚖ speelt blokken uit</span>',
    '<span class="zacht">Inzoomen: ▲ berg · ● bos · ≈ kust · 🏛 hoofdstad · ⚔ in gevecht</span>'].join('');
}

// ---------- tijd ----------

function zetTempo(t) {
  if (t > 0) ui.vorigTempo = t;
  ui.tempo = t;
  for (const b of document.querySelectorAll('[data-tempo]')) b.classList.toggle('actief', +b.dataset.tempo === t);
}
for (const b of document.querySelectorAll('[data-tempo]')) b.onclick = () => zetTempo(+b.dataset.tempo);

let laatste = performance.now();
let acc = 0;
let laatsteUI = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - laatste) / 1000);
  laatste = now;
  const s = ui.state;
  if (s && ui.tempo > 0 && !ui.modal && !s.uitkomst) {
    acc += dt * ui.tempo;
    let n = 0;
    while (acc >= 1 && n < 20) {
      acc -= 1;
      n += 1;
      if (s.pendingEvent && !s.replay) { acc = 0; break; }
      if (!sim.stapDag(s) && s.replay && !s.replay.length) { zetTempo(0); break; }
      if (s.dag % AUTO_INTERVAL === 0 && ui.autoDag !== s.dag) { ui.autoDag = s.dag; autoOpslaan(); }
    }
    if (n) ui.dirty = true;
  }
  if (s) {
    try {
      ui.kaart?.teken(dt, ui.modal || s.uitkomst ? 0 : ui.tempo, ui.tempo > 0 && !ui.modal ? Math.min(1, acc) : 1);
    } catch (err) {
      // Een tekenfout mag de simulatie nooit stilzetten.
      if (!ui.tekenfout) { ui.tekenfout = true; console.error(err); }
    }
    if (s.pendingEvent && !s.replay && !ui.modal) toonEvent();
    if (s.uitkomst && !ui.eindGetoond && !ui.modal) toonEinde();
    for (const m of s.meldingen.splice(0)) toast(m.tekst, m.soort);
    tutorialTick(now);
    doelbalk.tick(now);
    if (ui.dirty && now - laatsteUI > 140) {
      renderUI();
      laatsteUI = now;
      ui.dirty = false;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener('keydown', (e) => {
  if (!ui.state || $('#spel').hidden || e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); if (!ui.modal) zetTempo(ui.tempo ? 0 : ui.vorigTempo); }
  if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code) && !ui.modal) zetTempo([1, 2, 4, 8][+e.code.slice(5) - 1]);
  if (e.code === 'Escape' && !ui.modal) {
    if (ui.context) sluitContext();
    else if (ui.bouwModus) stopBouwModus();
    else if (ui.selectie.size) { ui.selectie.clear(); ui.dirty = true; }
    else selecteer(-1);
  }
  if (e.code === 'KeyA' && !ui.modal) selecteerLeger();
  if (e.code === 'KeyH' && !ui.modal) ui.kaart.naarLand(ui.state.speler);
  if (e.code === 'KeyW' && !ui.modal) { const w = ui.kaart.wereldBeeld(); ui.kaart.vliegNaar(w.x, w.y, w.zoom); }
});

// ---------- orders ----------

function geef(order) {
  const s = ui.state;
  if (s.replay) { toast('Replay: alleen kijken.', 'info'); return { ok: false }; }
  if (s.uitkomst) { toast('Het spel is afgelopen.', 'info'); return { ok: false }; }
  const r = sim.issueOrder(s, order);
  if (!r.ok) toast(r.reden, 'slecht');
  ui.dirty = true;
  renderUI();
  return r;
}

document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-actie]');
  if (!b || b.disabled || !ui.state) return;
  e.preventDefault();
  const d = b.dataset;
  tutorialEvent('actie', { actie: d.actie, id: d.id });
  switch (d.actie) {
    case 'bouw': geef({ type: 'bouw', gebouw: d.id }); break;
    case 'plaats': if (ui.bouwModus === d.id) stopBouwModus(); else startBouwModus(d.id); break;
    case 'hefboom': geef({ type: 'hefboom', actie: d.id, doel: d.doel != null ? +d.doel : ui.sel }); break;
    case 'escalatie': geef({ type: 'escalatie', actie: d.id, doel: d.doel != null ? +d.doel : ui.sel }); break;
    case 'cyber': { const e = ui.state.pack.acties.escalatie.find((x) => x.type === 'cyber'); geef({ type: 'escalatie', actie: e.id, doel: +d.doel, variant: d.id, ...(d.tegel != null ? { tegel: +d.tegel } : {}) }); break; }
    case 'deescalatie': geef({ type: 'deescalatie' }); break;
    case 'selecteer': selecteer(+d.id); break;
    case 'cmdstop': geef({ type: 'commandant_stop', id: +d.id }); break;
    case 'cmdvoor': selecteer(+d.id); zetTab('commandanten'); $('#cmd-doel').value = d.id; break;
    case 'tab': zetTab(d.id); break;
    case 'campagne': geef({ type: 'campagne', actie: d.id }); break;
    case 'hervorming': geef({ type: 'hervorming', naar: d.id }); break;
    case 'media': geef({ type: 'media', actie: d.id, doel: +d.doel }); break;
    case 'overname': geef({ type: 'overname', actie: d.id, doel: +d.doel }); break;
    case 'sluit-context': sluitContext(); break;
    case 'contract': geef({ type: 'contract', actie: d.id, id: +d.doel }); break;
    case 'contract-aanbod': naKlik(() => toonContractAanbod(+d.doel)); break;
    case 'contracten': naKlik(toonContracten); break;
    case 'naar-tab': sluitContext(); if (d.doel != null) selecteer(+d.doel); zetTab(d.id); break;
    case 'netwerk': geef({ type: 'netwerk', actie: d.id, doel: d.doel != null ? +d.doel : ui.sel }); break;
    case 'train': geef({ type: 'train', eenheid: d.id }); break;
    case 'vrede': geef({ type: 'vrede', met: d.id }); break;
    case 'selecteer-leger': selecteerLeger(); break;
    case 'leger-thuis': stuurEenheden(ui.state.pack.geo.hoofdstad[ui.state.speler]); break;
  }
});

for (const id of ['belasting', 'verdeling']) {
  $(`#s-${id}`).oninput = (e) => {
    if (ui.state.replay) return;
    geef({ type: 'beleid', [id]: +e.target.value / 100 });
  };
}

$('#cmd-budget').oninput = (e) => { $('#cmd-budget-v').textContent = e.target.value; };
$('#cmd-knop').onclick = () => {
  const doel = +$('#cmd-doel').value;
  if (!($('#cmd-doel').value)) { toast('Kies eerst een doelland.', 'slecht'); return; }
  geef({ type: 'commandant', doel, budget: +$('#cmd-budget').value, stijl: $('#cmd-stijl').value });
};

function selecteer(idx) {
  if (idx < 0) idx = -1;
  ui.sel = idx;
  if (ui.kaart) ui.kaart.geselecteerd = idx;
  if (idx >= 0 && ui.tab !== 'invloed' && ui.tab !== 'commandanten') zetTab('invloed');
  ui.dirty = true;
  renderUI();
}

function zetTab(t) {
  ui.tab = t;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('actief', b.dataset.tab === t);
  for (const p of document.querySelectorAll('[data-paneel]')) p.hidden = p.dataset.paneel !== t;
  ui.grafiekLen = -1;
  ui.dirty = true;
  if (ui.state) renderUI();
}
for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => { zetTab(b.dataset.tab); tutorialEvent('tab', { tab: b.dataset.tab }); };

// ---------- leger besturen ----------

function selecteerLeger() {
  ui.selectie.clear();
  for (const u of ui.state.eenheden) if (u.land === ui.state.speler) ui.selectie.add(u.id);
  if (ui.selectie.size && ui.tab !== 'leger') zetTab('leger');
  ui.dirty = true;
}

function stuurEenheden(t) {
  const s = ui.state;
  const ids = [...ui.selectie].filter((id) => s.eenheden.some((u) => u.id === id && u.land === s.speler));
  if (!ids.length) return;
  const r = geef({ type: 'beweeg', eenheden: ids, tegel: t });
  if (r.ok) ui.kaart.doelMarker = { t, tijd: performance.now() };
}

// ---------- bouwen op de kaart ----------

function startBouwModus(id) {
  if (ui.state.replay) return;
  ui.bouwModus = id;
  ui.kaart.bouwModus = id;
  sluitContext(); // het contextpaneel zou anders de kaart (en het bouwdoel) bedekken
  $('#kaart-wrap').classList.add('bouwen');
  berekenBouwStatus();
  if (ui.kaart.zoom < 2.2) ui.kaart.naarLand(ui.state.speler, 3);
  // Op een telefoon staat het paneel onder de kaart: breng de kaart in beeld, anders tikt de speler in het niets.
  if (TELEFOON.matches) $('#kaart-wrap').scrollIntoView({ block: 'start' });
  ui.dirty = true;
  renderUI();
}

function stopBouwModus() {
  ui.bouwModus = null;
  if (ui.kaart) { ui.kaart.bouwModus = null; ui.kaart.bouwStatus = null; }
  $('#kaart-wrap').classList.remove('bouwen');
  $('#bouwbalk').hidden = true;
  ui.dirty = true;
}

function berekenBouwStatus() {
  const s = ui.state;
  const status = new Map();
  for (const t of s.landTegels[s.speler]) status.set(t, sim.tegelStatus(s, s.speler, ui.bouwModus, t));
  ui.kaart.bouwStatus = status;
  const c = speler();
  const g = s.pack.gebouwIndex[ui.bouwModus];
  const vrij = [...status.values()].filter((x) => x.ok).length;
  const kosten = sim.bouwKosten(s, c, g.id);
  $('#bouwbalk').hidden = false;
  schikBouwbalk();
  $('#bouwbalk').innerHTML = `<span class="groot">${g.icoon ?? ''}</span><span><b>${esc(g.naam)}</b> · ${kostenTekst(kosten)} · ${g.terrein ? `op ${g.terrein.join(' of ')}` : 'op elk land'}<br>
    <span class="zacht">${vrij} vrije plekken. Groen = vol rendement, oranje/rood = ver van hoofdstad of depot. Esc of rechtsklik om te stoppen.</span></span>`;
}

function plaatsOp(t) {
  if (!ui.bouwModus) return;
  const r = geef({ type: 'bouw', gebouw: ui.bouwModus, tegel: t });
  if (r.ok) {
    const c = speler();
    if (!sim.kanBetalen(c, sim.bouwKosten(ui.state, c, ui.bouwModus))) stopBouwModus();
    else berekenBouwStatus();
  }
}

for (const b of document.querySelectorAll('[data-kaart]')) {
  b.onclick = () => {
    const k = ui.kaart;
    if (!k) return;
    if (b.dataset.kaart === 'in') k.zoomRond(k.w / 2, k.h / 2, k.zoom * 1.5);
    if (b.dataset.kaart === 'uit') k.zoomRond(k.w / 2, k.h / 2, k.zoom / 1.5);
    if (b.dataset.kaart === 'thuis') k.naarLand(ui.state.speler);
    if (b.dataset.kaart === 'wereld') { const w = k.wereldBeeld(); k.vliegNaar(w.x, w.y, w.zoom); }
  };
}

// ---------- weergave ----------

function zet(zone, html) {
  const el = document.querySelector(`[data-zone="${zone}"]`);
  if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
}

function datumTekst(s) {
  const d = new Date(Date.UTC(s.pack.meta.tijd.startjaar ?? 2026, 0, 1 + s.dag));
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function speler() { return ui.state.landen[ui.state.speler]; }
function res(id) { return ui.state.pack.resIndex[id]; }
function blok(id) { return ui.state.blokken.find((b) => b.id === id); }
function blokNaam(id) { return id === 'zwevend' || !id ? 'Zwevend' : blok(id).naam; }
function blokKleur(id) { return id === 'zwevend' || !id ? ui.state.pack.zwevend.kleur : blok(id).kleur; }

function kostenTekst(kosten) {
  return Object.entries(kosten).map(([r, v]) => `${v}${res(r)?.icoon ?? r}`).join(' ');
}

function renderUI() {
  const s = ui.state;
  if (!s) return;
  renderTopbalk();
  if (ui.bouwModus) berekenBouwStatus();
  renderContext();
  renderTabs();
  if (ui.tab === 'economie') renderEconomie();
  if (ui.tab === 'invloed') renderInvloed();
  if (ui.tab === 'volk') renderVolk();
  if (ui.tab === 'leger') renderLeger();
  if (ui.tab === 'blokken') renderBlokken();
  if (ui.tab === 'commandanten') renderCommandanten();
  if (ui.tab === 'log') renderLog();
  const items = s.log.slice(-4).reverse();
  $('#ticker').innerHTML = items.map((l) => `<span class="t-${l.soort}">dag ${l.dag} · ${esc(l.tekst)}</span>`).join('');
  const schokken = s.schokken.map((x) => `${esc(x.naam)} (nog ${x.tot - s.dag} d)`);
  $('#schok-banner').hidden = !schokken.length;
  $('#schok-banner').innerHTML = schokken.join(' · ');
}

function renderTopbalk() {
  const s = ui.state;
  const c = speler();
  const fase = s.pack.verhaal.fasen[s.faseIdx];
  $('#datum').textContent = `${datumTekst(s)} · dag ${s.dag}`;
  $('#fase').textContent = (s.replay ? 'REPLAY · ' : '') + (fase?.naam ?? '');
  const P = s.pack;
  const chips = [];
  for (const r of P.resources) {
    if (!sim.isOntgrendeld(s, r.id)) continue;
    const nieuw = !ui.ontgrendeldGezien.has(r.id);
    if (nieuw) ui.ontgrendeldGezien.add(r.id);
    let w, d, cls = '', titel;
    if (r.id === P.rollen.stabiliteit) {
      w = c.stab.toFixed(0);
      const delta = c.stabDoel - c.stab;
      d = `<span class="d ${delta >= 0 ? 'goed' : 'slecht'}">${delta >= 0 ? '↗' : '↘'} ${c.stabDoel.toFixed(0)}</span>`;
      if (c.stab < 30) cls = 'tekort';
      titel = `Stabiliteit ${c.stab.toFixed(1)}, doel ${c.stabDoel.toFixed(1)}`;
    } else if (r.id === P.rollen.geld) {
      w = fmt(c.voorraad[r.id]);
      d = `<span class="d ${c.inkomen >= 0 ? 'goed' : 'slecht'}">${plus(c.inkomen)}/d</span>`;
      if (c.voorraad[r.id] < 0) cls = 'tekort';
      titel = `Kapitaal. Inkomen ${c.inkomen.toFixed(1)} per dag na onderhoud (${c.onderhoud?.toFixed(1) ?? 0}).`;
    } else {
      const cap = sim.opslagMax(s, c, r.id);
      w = fmt(c.voorraad[r.id] ?? 0);
      const n = c.netto[r.id] ?? 0;
      d = `<span class="d ${n >= 0 ? 'goed' : 'slecht'}">${plus(n)}</span>`;
      if ((c.ratio[r.id] ?? 1) < 1) cls = 'tekort';
      titel = `${r.naam}: ${fmt(c.voorraad[r.id] ?? 0)} / ${fmt(cap)}. Voorziening ${pct(c.ratio[r.id] ?? 1)}.`;
    }
    chips.push(`<div class="res ${cls} ${nieuw && s.dag > 0 ? 'nieuw' : ''}" title="${esc(titel)}"><span class="ico">${r.icoon ?? ''}</span><span class="w">${w}</span>${d}</div>`);
  }
  chips.push(creditsChip());
  const html = chips.join('') + `<button class="knop klein" id="menu-knop" title="Replay opslaan of stoppen">Menu</button>`;
  const el = $('#resources');
  if (el._html !== html) {
    el.innerHTML = html;
    el._html = html;
    $('#menu-knop').onclick = toonMenu;
  }
}

function renderTabs() {
  const s = ui.state;
  const slot = { invloed: !sim.isOntgrendeld(s, 'invloed'), commandanten: !sim.isOntgrendeld(s, 'commandanten'), leger: !sim.isOntgrendeld(s, 'leger') };
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('slot', !!slot[b.dataset.tab]);
}

function volgendeFase(s, sleutel) {
  return s.pack.verhaal.fasen.find((f) => (f.ontgrendelt || []).includes(sleutel));
}

// ----- economie -----

function renderEconomie() {
  const s = ui.state;
  const c = speler();
  const P = s.pack;
  const M = P.model;

  // Doelen en fase
  const doelen = P.verhaal.doelen || [];
  const fase = P.verhaal.fasen[s.faseIdx];
  const volgende = P.verhaal.fasen[s.faseIdx + 1];
  let dHtml = `<section class="blok"><h3>Fase: ${esc(fase?.naam ?? '')} ${volgende && s.instellingen.onboarding ? `<span class="pil">${esc(volgende.naam)} op dag ${volgende.dag}</span>` : ''}</h3>
    <div style="font-size:13px;color:#b9c6d4;margin-bottom:${doelen.length ? 8 : 0}px">${esc(fase?.tekst ?? '')}</div>`;
  const open = doelen.filter((d) => !s.doelenGehaald[d.id]).slice(0, 3);
  const klaar = doelen.filter((d) => s.doelenGehaald[d.id]).slice(-2);
  for (const d of [...klaar, ...open]) {
    const v = s.doelenGehaald[d.id] ? 1 : sim.doelVoortgang(s, d);
    dHtml += `<div class="doel ${s.doelenGehaald[d.id] ? 'klaar' : ''}"><span>${s.doelenGehaald[d.id] ? '✓' : '○'}</span><span>${esc(d.tekst)}</span>
      ${s.doelenGehaald[d.id] ? '' : `<div class="voortgang"><div style="width:${(Math.max(0, v) * 100).toFixed(0)}%"></div></div>`}</div>`;
  }
  zet('doelen', dHtml + '</section>');

  // Grafiek
  if (s.geschiedenis.length !== ui.grafiekLen) {
    ui.grafiekLen = s.geschiedenis.length;
    const g = s.geschiedenis;
    tekenGrafiek($('#grafiek-groei'), {
      xs: g.map((h) => h.dag),
      reeksen: [
        { label: 'Productie Y', kleur: '#f0b429', waarden: g.map((h) => h.Y), dik: true, formaat: (v) => fmt(v) },
        { label: 'Technologie A', kleur: '#8fb8ff', waarden: g.map((h) => h.A), as: 'rechts', formaat: (v) => v.toFixed(2) },
      ],
    });
  }
  const K = sim.kapitaalVoorraad(s, c);
  zet('kern', `<div class="kern-grid">
    <div><span class="l">Productie Y</span><span class="w">${fmt(c.Y)}</span></div>
    <div><span class="l">Groei 30 d</span><span class="w ${c.groei >= 0 ? 'goed' : 'slecht'}">${plus(c.groei * 100)}%</span></div>
    <div><span class="l">Technologie A</span><span class="w">${c.A.toFixed(3)}</span></div>
    <div><span class="l">Kapitaal K</span><span class="w">${fmt(K)}</span></div>
    <div><span class="l">Arbeid L</span><span class="w">${c.L.toFixed(1)}</span></div>
    <div><span class="l">Inkomen / dag</span><span class="w ${c.inkomen >= 0 ? 'goed' : 'slecht'}">${plus(c.inkomen)}</span></div>
  </div>`);

  // Balans
  const b = s.balans;
  const inv = b.investeren, inf = b.invloed, rest = Math.max(0, b.reserve - inv - inf);
  const tot = inv + inf + rest || 1;
  let advies = '';
  const geld = c.voorraad[P.rollen.geld];
  if (geld < 0) advies = 'Je staat rood: rente en onrust lopen op.';
  else if (sim.isOntgrendeld(s, 'invloed') && s.dag > (volgendeFase(s, 'invloed')?.dag ?? 0) + 60 && inf / tot < 0.05) advies = 'Je koopt geen invloed: andere blokken trekken de zwevende landen naar zich toe.';
  else if (rest / tot > 0.7 && geld > 600) advies = 'Veel reserve en weinig besteding: geld dat stilstaat rendeert niet.';
  else if (inv / tot > 0.85 && geld < 80) advies = 'Alles gaat naar groei. Houd een buffer aan voor schokken.';
  zet('balans', `<div class="tribar"><div style="width:${pct(inv / tot)};background:#f0b429"></div><div style="width:${pct(inf / tot)};background:#c38fff"></div><div style="width:${pct(rest / tot)};background:#4a6178"></div></div>
    <div class="tri-legenda"><span><i style="background:#f0b429"></i>Investeren ${pct(inv / tot)}</span><span><i style="background:#c38fff"></i>Invloed ${pct(inf / tot)}</span><span><i style="background:#4a6178"></i>Reserve ${pct(rest / tot)}</span></div>
    ${advies ? `<div class="advies">${esc(advies)}</div>` : ''}`);

  // Beleid
  for (const [id, v] of [['belasting', c.belasting], ['verdeling', c.verdeling]]) {
    const sl = $(`#s-${id}`);
    if (document.activeElement !== sl) sl.value = Math.round(v * 100);
    $(`#v-${id}`).textContent = pct(v);
  }
  const basis = [
    ['Basis', M.stab_basis],
    ['Sociale verdeling', M.stab_verdeling * c.verdeling],
    ['Belasting', -M.stab_belasting * (c.belasting - M.belasting_neutraal)],
    ...(c.stabFactoren || []),
  ];
  zet('stabiliteit', `<div class="factoren">
    <div><b>Stabiliteit ${c.stab.toFixed(0)} → doel ${c.stabDoel.toFixed(0)}</b><span class="zacht">onder 50 remt de groei</span></div>
    ${basis.filter(([, v]) => Math.abs(v) >= 0.05).map(([n, v]) => `<div><span class="zacht">${esc(n)}</span><span class="num ${v >= 0 ? 'goed' : 'slecht'}">${plus(v)}</span></div>`).join('')}
  </div>`);

  zet('gebouwen', gebouwLijst((g) => !g.categorie || g.categorie === 'economie'));

  // Voorraden
  const rijen = P.resources.filter((r) => r.id !== P.rollen.stabiliteit && r.id !== P.rollen.geld && sim.isOntgrendeld(s, r.id)).map((r) => {
    const cap = sim.opslagMax(s, c, r.id);
    const n = c.netto[r.id] ?? 0;
    const ratio = c.ratio[r.id] ?? 1;
    return `<tr><td>${r.icoon ?? ''} ${esc(r.naam)}</td><td class="r">${fmt(c.voorraad[r.id] ?? 0)} / ${fmt(cap)}</td>
      <td class="r ${n >= 0 ? 'goed' : 'slecht'}">${plus(n)}/d</td><td class="r ${ratio < 1 ? 'slecht' : 'zacht'}">${pct(ratio)}</td></tr>`;
  }).join('');
  zet('voorraden', `<table class="vr"><tr class="zacht"><td>Resource</td><td class="r">voorraad</td><td class="r">netto</td><td class="r">voorzien</td></tr>${rijen}</table>`);
}


// Bouwrijen voor één categorie gebouwen (economie, maatschappij of leger).
function gebouwLijst(filter) {
  const s = ui.state;
  const c = speler();
  const P = s.pack;
  const M = P.model;
  let gHtml = '';
  for (const g of P.gebouwen.filter(filter)) {
    const n = c.gebouwen[g.id] || 0;
    const inBouw = c.bouw.filter((x) => x.gebouw === g.id).length;
    if (!sim.isOntgrendeld(s, g.id)) {
      const f = volgendeFase(s, g.id);
      gHtml += `<div class="gebouw" style="opacity:.45"><div class="naam">${esc(g.naam)}</div><div class="sub">🔒 Komt vrij in fase ${esc(f?.naam ?? '')}${f ? ` (dag ${f.dag})` : ''}</div></div>`;
      continue;
    }
    const kosten = sim.bouwKosten(s, c, g.id);
    const vrij = sim.vrijePlekken(s, c, g.id);
    const kan = sim.kanBetalen(c, kosten) && c.bouw.length < M.max_bouw && vrij > 0;
    const reden = !vrij ? 'Geen geschikte grond vrij' : c.bouw.length >= M.max_bouw ? `Maximaal ${M.max_bouw} projecten tegelijk` : !sim.kanBetalen(c, kosten) ? 'Onvoldoende middelen' : '';
    const actief = ui.bouwModus === g.id;
    const eff = [
      ...Object.entries(g.productie || {}).map(([r, v]) => `<span class="goed">+${v}${res(r)?.icoon}</span>`),
      ...Object.entries(g.verbruik || {}).map(([r, v]) => `<span class="slecht">−${v}${res(r)?.icoon}</span>`),
      g.kapitaalvoorraad ? `<span class="goed">K+${g.kapitaalvoorraad}</span>` : '',
      g.opslag_bonus ? `<span class="info">opslag +${g.opslag_bonus}</span>` : '',
    ].filter(Boolean).join(' ');
    const terrein = g.terrein ? g.terrein.map((t) => `<span class="terrein-chip">${esc(t)}</span>`).join('') : '<span class="terrein-chip">elk land</span>';
    gHtml += `<div class="gebouw" title="${esc(g.beschrijving ?? '')}">
      <div class="naam">${g.icoon ?? ''} ${esc(g.naam)}<span class="n">${n}${inBouw ? ` +${inBouw}` : ''}</span></div>
      <span class="knoppen">
        <button class="knop klein ${actief ? 'actief' : ''}" data-actie="plaats" data-id="${esc(g.id)}" ${kan || actief ? '' : 'disabled'} title="${esc(reden || 'Kies zelf een vakje op de kaart')}">${actief ? 'Stop' : 'Plaats'} · ${kostenTekst(kosten)}</button>
        <button class="knop klein" data-actie="bouw" data-id="${esc(g.id)}" ${kan ? '' : 'disabled'} title="Automatisch op de beste vrije plek">Auto</button>
      </span>
      <div class="sub">${eff} · ${g.bouwtijd ?? 5} d<br>${terrein} <span class="${vrij ? 'zacht' : 'slecht'}">${vrij} vrij</span>${g.knooppunt ? ' <span class="info">knooppunt</span>' : ''}</div>
    </div>`;
  }
  const wachtrij = c.bouw.filter((x) => filter(P.gebouwIndex[x.gebouw]));
  if (wachtrij.length) {
    gHtml += `<div class="wachtrij">${wachtrij.map((x) => {
      const g = P.gebouwIndex[x.gebouw];
      const v = (s.dag - x.start) / Math.max(1, x.klaar - x.start);
      return `<div><span>${esc(g.naam)} · nog ${x.klaar - s.dag} d</span><div class="voortgang"><div style="width:${pct(v)}"></div></div></div>`;
    }).join('')}</div>`;
  }
  return gHtml;
}

// ----- contextpaneel op de kaart -----

function klikOpKaart(idx, t, x, y) {
  const s = ui.state;
  const b = s.bezet[t];
  kaartGeklikt();
  tutorialEvent('klik', { t, b });
  if (b && (ui.kaart.zoom >= 1.5 || b.hoofdstad)) {
    ui.context = { t, x, y };
    if (b.land !== s.speler) selecteer(b.land); else { ui.dirty = true; renderUI(); }
    return;
  }
  sluitContext();
  selecteer(idx);
}

function sluitContext() {
  ui.context = null;
  $('#context').hidden = true;
}

function moraalBlok(c, eigen) {
  const s = ui.state;
  const factoren = (c.moraalFactoren || []).filter(([, v]) => Math.abs(v) >= 0.5);
  return `<div style="font-size:12px;margin-top:6px">Strijdbereidheid <b class="${c.moraal < 35 ? 'slecht' : c.moraal > 65 ? 'goed' : ''}">${c.moraal.toFixed(0)}</b> → ${c.moraalDoel?.toFixed(0) ?? '–'}
    <span class="zacht">— bepaalt hoe hard het leger vecht (×${(0.5 + c.moraal / 100).toFixed(2)})${eigen ? '' : ' en of ze zich overgeven'}</span></div>
    ${meter(c.moraal / 100, c.moraal < 35 ? '#f2706a' : '#5fd38d', 1)}
    ${eigen ? `<div class="factoren" style="margin-top:4px">${factoren.map(([n, v]) => `<div><span class="zacht">${esc(n)}</span><span class="num ${v >= 0 ? 'goed' : 'slecht'}">${plus(v)}</span></div>`).join('')}</div>` : ''}`;
}

function mediaActies(t, typen) {
  const s = ui.state;
  return s.pack.acties.media.filter((a) => typen.includes(a.type)).map((a) => {
    const st = mediaStatus(s, s.speler, t.idx, a);
    return `<div class="actie"><div><b>${esc(a.naam)}</b></div>
      <button class="knop klein" data-actie="media" data-id="${esc(a.id)}" data-doel="${t.idx}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? '')}">${kostenTekst(sim.actieKosten(s, a, t))}</button>
      <div class="sub">${esc(a.beschrijving ?? '')}${st.ok && st.ontdekkans ? ` <span style="color:var(--accent)">${pct(Math.min(1, st.ontdekkans))} kans op ontmaskering.</span>` : ''}${st.ok ? '' : ` · <span class="slecht">${esc(st.reden)}</span>`}</div></div>`;
  }).join('');
}

function overnameBlok(t) {
  const s = ui.state;
  return s.pack.acties.overname.map((a) => {
    const st = overnameStatus(s, s.speler, t.idx, a);
    const vw = st.voorwaarden ? st.voorwaarden.map(([n, w, d, op]) => {
      const ok = op === '≥' ? w >= d : w <= d;
      return `<span class="${ok ? 'goed' : 'slecht'}">${esc(n)} ${typeof w === 'number' ? (n.includes('overmacht') ? w.toFixed(1) + '×' : w.toFixed(0)) : w} ${op} ${d}</span>`;
    }).join(' · ') : '';
    return `<div class="actie"><div><b>${esc(a.naam)}</b></div>
      <button class="knop klein ${st.slaagt ? 'actief' : ''}" data-actie="overname" data-id="${esc(a.id)}" data-doel="${t.idx}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? (st.slaagt ? 'Zal slagen' : 'Zal worden afgewezen'))}">${kostenTekst(sim.actieKosten(s, a, t))}</button>
      <div class="sub">${esc(a.beschrijving ?? '')}<br>${st.ok ? vw : `<span class="slecht">${esc(st.reden)}</span>`}</div></div>`;
  }).join('');
}

// Contextpaneel voor een gebouw van een ander land: handelen bij de bron.
function buitenlandsGebouw(land, g, b) {
  const s = ui.state;
  const P = s.pack;
  const doel = land.idx;
  const eigenLand = speler();
  let h = `<div style="font-size:12px;margin-top:6px">${esc(blokNaam(land.alignment))} · loyaliteit aan jou: <b>${land.loyaliteit[s.spelerBlok]?.toFixed(0) ?? '–'}</b></div>`;
  const knop = (soort, a, st, kosten) => `<button class="knop klein" data-actie="${soort}" data-id="${esc(a.id)}" data-doel="${doel}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? '')}">${kostenTekst(kosten)}</button>`;
  const regel = (soort, a, st, kosten, extra = '') => `<div class="actie"><div><b>${esc(a.naam)}</b></div>${knop(soort, a, st, kosten)}
    <div class="sub">${esc(a.beschrijving ?? '')}${extra}${st.ok ? '' : ` · <span class="slecht">${esc(st.reden)}</span>`}</div></div>`;
  const escalatie = (id) => {
    const a = P.acties.escalatie.find((x) => x.id === id && x.beschikbaar !== false);
    if (!a) return '';
    const st = sim.escalatieStatus(s, s.speler, doel, a);
    return regel('escalatie', a, st, sim.actieKosten(s, a, land), st.ok && a.ontdekkans ? ` <span style="color:var(--accent)">${pct(a.ontdekkans)} kans dat het uitkomt.</span>` : '');
  };
  if (b.bouw) {
    h += '<div class="zacht" style="font-size:12px;margin-top:6px">Nog in aanbouw: je kunt er pas iets mee als het af is.</div>';
  } else if (g.informatiecontrole || g.id === 'omroep') {
    // Inkopen bij de bron: mediabelang en nepnieuws direct vanaf hun omroep.
    h += `<h3 style="margin-top:10px">Hun media</h3>
      <div style="font-size:12px">Jouw media-invloed hier: <b>${(land.media[s.spelerBlok] ?? 0).toFixed(0)}</b>${Object.entries(land.media).filter(([bl, w]) => bl !== s.spelerBlok && w > 1).map(([bl, w]) => ` · <span style="color:${blokKleur(bl)}">${esc(blokNaam(bl))} ${w.toFixed(0)}</span>`).join('')}</div>
      <div style="font-size:12px">Hun factcheck <b class="${land.factcheck > 30 ? 'slecht' : ''}">${land.factcheck.toFixed(0)}</b> · informatiecontrole <b>${land.controle.toFixed(0)}</b> · strijdbereidheid <b>${land.moraal.toFixed(0)}</b> <span class="zacht">— hoe hoger factcheck en controle, hoe minder je nepnieuws aankomt</span></div>
      <div class="zacht" style="font-size:12px;margin:4px 0">Koop je in bij deze omroep of laat hem jouw verhaal brengen: hun strijdbereidheid en loyaliteit dalen.</div>
      ${mediaActies(land, ['belang', 'nepnieuws'])}${escalatie('informatiecampagne')}`;
  } else if (g.categorie === 'leger' || P.eenheden.some((e) => e.gebouw === g.id)) {
    // Inlichtingen: wat dit land met dit gebouw kan opleiden en wat er al staat.
    const typen = P.eenheden.filter((e) => e.gebouw === g.id);
    const eenheden = s.eenheden.filter((u) => u.land === doel);
    const inOorlog = leger.inOorlog(s, eigenLand, land);
    const wacht = land.training.filter((x) => P.eenhedenIndex[x.type]?.gebouw === g.id).length;
    const mijn = leger.sterkte(s, s.speler), hun = leger.sterkte(s, doel);
    const overmacht = hun > 0 ? mijn / hun : null;
    h += `<h3 style="margin-top:10px">Inlichtingen</h3>
      <div style="font-size:12px">Slagkracht ${esc(land.naam)} <b>${fmt(hun)}</b> tegenover jouw <b>${fmt(mijn)}</b>${overmacht != null ? ` <span class="${overmacht >= 3 ? 'goed' : overmacht < 1 ? 'slecht' : 'zacht'}">(${overmacht.toFixed(1)}× overmacht)</span>` : ' <span class="goed">(geen leger)</span>'}${wacht ? ` · <span style="color:var(--accent)">${wacht} in opleiding hier</span>` : ''}</div>
      <div class="kern-grid" style="margin:6px 0"><div><span class="l">Leger</span><span class="w">${eenheden.length}</span></div>
      ${typen.map((e) => `<div><span class="l">${e.icoon ?? ''} ${esc(e.naam)}</span><span class="w">${eenheden.filter((u) => u.type === e.id).length}</span></div>`).join('')}</div>
      ${moraalBlok(land, false)}
      <div style="font-size:12px;margin-top:6px">${inOorlog ? '<span class="slecht">Jullie zijn in oorlog.</span>' : 'Jullie zijn niet in oorlog.'}</div>
      <div style="display:flex;gap:6px;margin-top:6px"><button class="knop klein" data-actie="naar-tab" data-id="leger">Jouw leger</button></div>`;
  } else if (g.categorie === 'maatschappij') {
    // Samenleving: weerbaarheid en geheime netwerken.
    const eigenNet = land.netwerken[s.spelerBlok] ?? 0;
    h += `<h3 style="margin-top:10px">Samenleving</h3>
      <div style="font-size:12px">Stabiliteit ${land.stab.toFixed(0)} · weerbaarheid ${land.weerbaarheid.toFixed(0)} · complotdruk ${land.complot.toFixed(0)} · jouw netwerk <b>${eigenNet.toFixed(0)}</b></div>`;
    for (const a of P.acties.netwerken) {
      if (a.type === 'oprollen') continue;
      const st = netwerkStatus(s, s.speler, doel, a);
      h += regel('netwerk', a, st, sim.actieKosten(s, a, land), st.ok && st.ontdekkans ? ` <span style="color:var(--accent)">${pct(Math.min(1, st.ontdekkans))} kans dat het lekt.</span>` : '');
    }
    h += escalatie('complot_zaaien');
  } else {
    // Economie: handel aanbieden of de duimschroeven aandraaien.
    h += '<h3 style="margin-top:10px">Economie</h3>';
    if (g.handel_bonus) {
      const lopend = land.handel.filter((x) => x.tot > s.dag);
      const metJou = lopend.filter((x) => x.met === s.speler);
      h += `<div style="font-size:12px">Handelsbonus ${pct(g.handel_bonus)} op hun handelsinkomen · lopende akkoorden <b>${lopend.length}</b>${metJou.length ? ` · <span class="goed">met jou, nog ${Math.max(...metJou.map((x) => x.tot - s.dag))} d</span>` : ''}</div>`;
    }
    if (!land.vast) {
      const a = P.acties.hefbomen.find((x) => x.hefboom === 'handel');
      if (a) h += regel('hefboom', a, sim.hefboomStatus(s, s.speler, doel, a), sim.actieKosten(s, a, land));
    }
    h += escalatie('economische_druk');
  }
  if (!b.bouw && ui.context) h += cyberBlok(s, land, ui.context.t, g.naam, { esc, kostenTekst });
  h += contractBlok(land);
  h += `<div style="margin-top:8px"><button class="knop klein" data-actie="naar-tab" data-id="invloed" data-doel="${doel}">Alle opties voor ${esc(land.naam)}</button></div>`;
  return h;
}

function renderContext() {
  const s = ui.state;
  const el = $('#context');
  if (!ui.context) { el.hidden = true; return; }
  const t = ui.context.t;
  const b = s.bezet[t];
  if (!b) { sluitContext(); return; }
  const land = s.landen[b.land];
  const eigen = b.land === s.speler;
  const P = s.pack;
  let titel = '';
  let h = '';
  if (b.hoofdstad || b.kolonie) {
    const r = P.regimes[land.regime];
    titel = b.kolonie ? `🚩 ${esc(s.kolonies.find((k) => k.t === t)?.naam ?? 'Kolonie')}` : `🏛 ${esc(land.naam)}`;
    h += `<div class="zacht" style="font-size:12px">${r?.icoon ?? ''} ${esc(r?.naam ?? '')} · ${esc(blokNaam(land.alignment))} · ${esc(land.leider)}</div>`;
    h += `<div class="kern-grid" style="margin:6px 0"><div><span class="l">Productie</span><span class="w">${fmt(land.Y)}</span></div><div><span class="l">Stabiliteit</span><span class="w">${land.stab.toFixed(0)}</span></div><div><span class="l">Leger</span><span class="w">${s.eenheden.filter((u) => u.land === land.idx).length}</span></div></div>`;
    h += moraalBlok(land, eigen);
    if (eigen) {
      h += `<h3 style="margin-top:10px">Thuisfront</h3>${mediaActies(land, ['propaganda', 'verdediging'])}
        <div style="display:flex;gap:6px;margin-top:6px"><button class="knop klein" data-actie="naar-tab" data-id="volk">Regime en samenleving</button><button class="knop klein" data-actie="naar-tab" data-id="leger">Leger</button></div>`;
    } else {
      h += `<div style="font-size:12px;margin-top:6px">Jouw media-invloed hier: <b>${(land.media[s.spelerBlok] ?? 0).toFixed(0)}</b> · loyaliteit aan jou: <b>${land.loyaliteit[s.spelerBlok]?.toFixed(0)}</b></div>
        <h3 style="margin-top:10px">Media</h3>${mediaActies(land, ['belang', 'nepnieuws'])}
        <h3 style="margin-top:10px">Overname</h3>${overnameBlok(land)}
        ${contractBlok(land)}
        <div style="margin-top:6px"><button class="knop klein" data-actie="naar-tab" data-id="invloed" data-doel="${land.idx}">Alle opties in Invloed</button></div>`;
    }
  } else {
    const g = P.gebouwIndex[b.gebouw];
    const p = land.plaatsingen.find((x) => x.t === t);
    titel = `${g.icoon ?? ''} ${esc(g.naam)}`;
    h += `<div class="zacht" style="font-size:12px">${esc(land.naam)}${b.bouw ? ' · in aanbouw' : eigen ? ` · rendement ${pct(p?.eff ?? 1)}` : ''}</div>`;
    if (g.beschrijving) h += `<p style="font-size:12.5px;color:#b9c6d4;margin:6px 0">${esc(g.beschrijving)}</p>`;
    const prod = Object.entries(g.productie || {}).map(([r, v]) => `+${(v * (p?.eff ?? 1)).toFixed(1)} ${res(r)?.naam.toLowerCase()}`).join(', ');
    if (prod) h += `<div style="font-size:12px">${prod} per dag</div>`;
    if (eigen && !b.bouw && (g.informatiecontrole || g.id === 'omroep')) {
      // Het mediacentrum: verdedigen in eigen land, aanvallen in andere landen.
      const c = speler();
      h += `<h3 style="margin-top:10px">Verdedigen</h3>
        <div style="font-size:12px">Buitenlandse invloed op jouw media: <b class="${vijandigeMedia(s, c) > 20 ? 'slecht' : ''}">${vijandigeMedia(s, c).toFixed(0)}</b> · complotdruk ${c.complot.toFixed(0)} · factcheck ${c.factcheck.toFixed(0)}</div>
        ${mediaActies(c, ['verdediging', 'propaganda'])}
        <h3 style="margin-top:10px">Aanvallen</h3>
        <div class="zacht" style="font-size:12px;margin-bottom:4px">Koop je in in hun media en verspreid nepnieuws: hun strijdbereidheid en loyaliteit dalen.</div>`;
      const doelen = s.landen.filter((l) => l.idx !== s.speler && l.alignment !== s.spelerBlok)
        .sort((a, z) => (z.media[s.spelerBlok] ?? 0) - (a.media[s.spelerBlok] ?? 0) || z.Y - a.Y).slice(0, 7);
      const belang = P.acties.media.find((a) => a.type === 'belang');
      const nep = P.acties.media.find((a) => a.type === 'nepnieuws');
      h += doelen.map((l) => {
        const sb = mediaStatus(s, s.speler, l.idx, belang), sn = mediaStatus(s, s.speler, l.idx, nep);
        return `<div class="actie"><div><b>${esc(l.naam)}</b> <span class="zacht" style="font-size:11px">media ${(l.media[s.spelerBlok] ?? 0).toFixed(0)} · moraal ${l.moraal.toFixed(0)}</span></div>
          <span class="knoppen" style="grid-row:1;grid-column:2;display:flex;gap:4px">
            <button class="knop klein" style="grid-row:auto" data-actie="media" data-id="${belang.id}" data-doel="${l.idx}" ${sb.ok ? '' : 'disabled'} title="${esc(sb.reden ?? 'Mediabelang kopen')}">Belang</button>
            <button class="knop klein" style="grid-row:auto" data-actie="media" data-id="${nep.id}" data-doel="${l.idx}" ${sn.ok ? '' : 'disabled'} title="${esc(sn.reden ?? 'Nepnieuws verspreiden')}">Nepnieuws</button>
          </span></div>`;
      }).join('');
    } else if (eigen && !b.bouw && P.eenheden.some((e) => e.gebouw === g.id)) {
      h += `<h3 style="margin-top:10px">Opleiden</h3>`;
      for (const e of P.eenheden.filter((x) => x.gebouw === g.id)) {
        const st = leger.trainStatus(s, s.speler, e.id);
        h += `<div class="actie"><div><b>${e.icoon ?? ''} ${esc(e.naam)}</b></div>
          <button class="knop klein" data-actie="train" data-id="${esc(e.id)}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? '')}">${kostenTekst(leger.eenheidKosten(s, speler(), e))}</button>
          <div class="sub">${esc(e.beschrijving ?? '')}${st.ok ? '' : ` · <span class="slecht">${esc(st.reden)}</span>`}</div></div>`;
      }
      const wacht = speler().training.filter((x) => P.eenhedenIndex[x.type].gebouw === g.id);
      if (wacht.length) h += `<div class="wachtrij">${wacht.map((x) => `<div>${esc(P.eenhedenIndex[x.type].naam)} · nog ${Math.max(0, x.klaar - s.dag)} d</div>`).join('')}</div>`;
    } else if (!eigen) {
      h += buitenlandsGebouw(land, g, b);
    }
  }
  const html = `<div class="context-kop"><b>${titel}</b><button class="knop klein" data-actie="sluit-context">×</button></div>${h}`;
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
  el.hidden = false;
  if (TELEFOON.matches) {
    // Telefoon: uitschuifpaneel van onderen (opmaak in style.css). Schuif de kaart
    // zo dat de aangetikte plek boven het paneel zichtbaar blijft.
    el.style.left = el.style.top = '';
    if (!ui.context.geschoven) {
      ui.context.geschoven = true;
      const k = ui.kaart;
      const tikY = $('#kaart-wrap').getBoundingClientRect().top + ui.context.y;
      const ruimte = el.getBoundingClientRect().top - 48;
      if (k && tikY > ruimte) { k.cy += (tikY - ruimte) / k.schaal(); k.doel = null; k.begrens(); }
    }
    return;
  }
  const w = $('#kaart-wrap').clientWidth, hh = $('#kaart-wrap').clientHeight;
  el.style.left = `${Math.max(8, Math.min(ui.context.x + 16, w - 336))}px`;
  el.style.top = `${Math.max(8, Math.min(ui.context.y - 40, hh - el.offsetHeight - 8))}px`;
}

const TELEFOON = window.matchMedia('(max-width: 600px)');

// Uitschuifpaneel: naar beneden vegen over de kop sluit het.
{
  const el = $('#context');
  let veeg = null;
  el.addEventListener('pointerdown', (e) => {
    if (!TELEFOON.matches || e.target.closest('button') || !e.target.closest('.context-kop')) return;
    veeg = { y: e.clientY, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!veeg || e.pointerId !== veeg.id) return;
    el.style.transform = `translateY(${Math.max(0, e.clientY - veeg.y)}px)`;
  });
  const los = (e) => {
    if (!veeg || e.pointerId !== veeg.id) return;
    const dy = e.clientY - veeg.y;
    veeg = null;
    el.style.transform = '';
    if (dy > 60) sluitContext();
  };
  el.addEventListener('pointerup', los);
  el.addEventListener('pointercancel', los);
}

// ----- contracten (B17) -----
// Aanbieden, aanvaarden, afwijzen en verbreken. De orders staan in docs/contracten.md;
// de engine (contracten.js) controleert alles, het scherm toont alleen wat kan.

const CONTRACT_STATUS = { open: 'aangeboden', actief: 'loopt', afgerond: 'afgerond', verbroken: 'verbroken', verlopen: 'verlopen', afgewezen: 'afgewezen', ingetrokken: 'ingetrokken' };

function creditsChip() {
  const s = ui.state;
  const mijn = contractenVan(s, s.speler);
  const open = mijn.filter((k) => k.status === 'open' && k.b === s.speler).length;
  const loopt = mijn.filter((k) => k.status === 'actief').length;
  // "n nieuw" staat buiten .d, want die verdwijnt op de telefoon; met een aanbod schuift de knop daar naar voren.
  return `<button class="res knop-res ${open ? 'heeft-nieuw' : ''}" data-actie="contracten" title="Credits: spelpunten uit afgeronde contracten. Ze zijn niet te kopen of te verhandelen. Klik voor je contracten.">
    <span class="ico">🤝</span><span class="w">${Math.round(s.credits[s.speler] ?? 0)}</span><span class="d">${loopt} lopend</span>${open ? `<b class="nieuw-badge">${open} nieuw</b>` : ''}</button>`;
}

function contractTekst(k) {
  const s = ui.state;
  const wij = k.a === s.speler;
  const ander = s.landen[wij ? k.b : k.a];
  const stroomTekst = (x) => `${+x.per_dag.toFixed(1)} ${esc(res(x.res)?.naam.toLowerCase() ?? x.res)}/d`;
  let wat;
  if (k.soort === 'krediet') {
    const terug = k.b_geeft.per_dag * k.looptijd;
    wat = wij ? `Jij leent ${fmt(k.voorschot.bedrag)} uit aan ${esc(ander.naam)}, terug ${fmt(terug)} (${pct(k.rente)} rente)` : `${esc(ander.naam)} leent jou ${fmt(k.voorschot.bedrag)}, jij betaalt ${fmt(terug)} terug (${pct(k.rente)} rente)`;
  } else {
    const jijGeeft = wij ? k.a_geeft : k.b_geeft, jijKrijgt = wij ? k.b_geeft : k.a_geeft;
    wat = `Jij levert ${stroomTekst(jijGeeft)} aan ${esc(ander.naam)}, je krijgt ${stroomTekst(jijKrijgt)}`;
  }
  const wanneer = k.status === 'open' ? `nog ${Math.max(0, k.tot - s.dag)} d geldig` : k.status === 'actief' ? `nog ${Math.max(0, k.einde - s.dag)} van ${k.looptijd} d` : CONTRACT_STATUS[k.status];
  return { wat, wanneer, ander };
}

function contractKnoppen(k) {
  const s = ui.state;
  const knop = (actie, tekst, titel = '') => `<button class="knop klein" data-actie="contract" data-id="${actie}" data-doel="${k.id}" title="${esc(titel)}">${tekst}</button>`;
  if (k.status === 'open' && k.b === s.speler) return knop('aanvaard', 'Aanvaarden') + knop('wijs_af', 'Afwijzen');
  if (k.status === 'open' && k.a === s.speler) return knop('wijs_af', 'Intrekken');
  if (k.status === 'actief') return knop('verbreek', `Verbreken (−${k.boete})`, `Je verliest ${k.boete} credits, de ander krijgt er ${Math.round(k.boete / 2)}. Je betrouwbaarheid daalt.`);
  return '';
}

function contractRij(k, metLand) {
  const { wat, wanneer, ander } = contractTekst(k);
  return `<div class="actie contract-rij"><div><b>${metLand ? `${esc(ander.naam)} · ` : ''}${k.soort === 'krediet' ? 'Krediet' : 'Grondstoffen'}</b> <span class="pil">${esc(wanneer)}</span></div>
    <div class="sub">${wat}. Bij afronden ${(Math.round(k.waarde * (k.nieuwePartner ?? !ui.state.handelPartners[[k.a, k.b].sort((x, y) => x - y).join('-')] ? CONTRACT.nieuwe_partner : 1)))} credits elk.</div>
    <div class="knoppen" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${contractKnoppen(k)}</div></div>`;
}

// Blok in het paneel van een ander land.
function contractBlok(land) {
  const s = ui.state;
  const met = s.contracten.filter((k) => ['open', 'actief'].includes(k.status) && ((k.a === s.speler && k.b === land.idx) || (k.b === s.speler && k.a === land.idx)));
  const vol = contractenVan(s, s.speler).filter((k) => ['open', 'actief'].includes(k.status)).length >= CONTRACT.max_open;
  return `<h3 style="margin-top:10px">Handel <span class="uitleg" title="Contracten leveren credits op bij afronden. Verbreken kost credits en betrouwbaarheid.">ⓘ</span></h3>
    <div style="font-size:12px">Betrouwbaarheid ${esc(land.naam)}: <b>${s.betrouwbaarheid[land.idx]}</b> · die van jou: <b>${s.betrouwbaarheid[s.speler]}</b></div>
    ${met.map((k) => contractRij(k, false)).join('')}
    <div style="margin-top:6px"><button class="knop klein" data-actie="contract-aanbod" data-doel="${land.idx}" ${vol ? `disabled title="Maximaal ${CONTRACT.max_open} contracten tegelijk."` : ''}>Contract aanbieden</button></div>`;
}

// Knoppen reageren op pointerdown. Een venster dat dan meteen opent, vangt de klik die
// nog volgt (op een telefoon valt die op 'Annuleren'). Daarom pas openen na de klik.
function naKlik(fn) {
  const h = () => { clearTimeout(t); fn(); };
  document.addEventListener('click', h, { once: true });
  const t = setTimeout(() => document.removeEventListener('click', h), 800);
}

function metPauze(open) {
  const terug = ui.tempo;
  zetTempo(0);
  open(() => { sluitModal(); zetTempo(terug); });
}

function toonContracten() {
  metPauze((klaar) => {
    const s = ui.state;
    const mijn = contractenVan(s, s.speler).slice().reverse();
    const lopend = mijn.filter((k) => ['open', 'actief'].includes(k.status));
    const oud = mijn.filter((k) => !['open', 'actief'].includes(k.status)).slice(0, 8);
    const teken = () => `<h2>Handel</h2><div class="titel">Contracten en credits</div>
      <div class="kern-grid" style="margin:6px 0"><div><span class="l">Credits</span><span class="w">${Math.round(s.credits[s.speler] ?? 0)}</span></div><div><span class="l">Betrouwbaarheid</span><span class="w">${s.betrouwbaarheid[s.speler]}</span></div><div><span class="l">Lopend</span><span class="w">${lopend.length} / ${CONTRACT.max_open}</span></div></div>
      <p style="font-size:13px">Credits verdien je met afgeronde contracten. Ze zijn alleen spelpunten: niet te kopen of te verhandelen. Een nieuw contract bied je aan vanuit het paneel van een ander land op de kaart.</p>
      ${lopend.length ? lopend.map((k) => contractRij(k, true)).join('') : '<p class="zacht" style="font-size:13px">Nog geen lopende contracten of aanbiedingen.</p>'}
      ${oud.length ? `<h3 style="margin-top:12px">Eerder</h3>${oud.map((k) => { const t = contractTekst(k); return `<div class="sub" style="font-size:12px;padding:3px 0">${esc(t.ander.naam)} · ${k.soort} · ${esc(CONTRACT_STATUS[k.status])}</div>`; }).join('')}` : ''}
      <div class="keuzes"><button class="knop primair" id="c-sluit">Sluiten</button></div>`;
    openModal(teken(), (el) => {
      // Knoppen in de lijst werken via de algemene data-actie; daarna het overzicht verversen.
      const ververs = () => setTimeout(() => { el.innerHTML = teken(); el.querySelector('#c-sluit').onclick = sluit; }, 0);
      const sluit = () => { el.removeEventListener('click', ververs); klaar(); };
      el.querySelector('#c-sluit').onclick = sluit;
      el.addEventListener('click', ververs);
    });
  });
}

function toonContractAanbod(doel) {
  metPauze((klaar) => {
    const s = ui.state;
    const P = s.pack;
    const land = s.landen[doel];
    const handel = P.resources.filter((r) => r.id !== P.rollen.stabiliteit);
    const opties = (kies) => handel.map((r) => `<option value="${esc(r.id)}" ${r.id === kies ? 'selected' : ''}>${esc(r.icoon ?? '')} ${esc(r.naam)}</option>`).join('');
    const tekort = (c) => handel.filter((r) => r.id !== P.rollen.geld).sort((a, b) => (c.netto[a.id] ?? 0) - (c.netto[b.id] ?? 0))[0]?.id;
    const ik = speler();
    // Voorstel: geef wat je het meest over hebt, vraag waar je het minst van hebt.
    const geefStd = handel.filter((r) => r.id !== P.rollen.geld).sort((a, b) => (ik.netto[b.id] ?? 0) - (ik.netto[a.id] ?? 0))[0]?.id;
    const vraagStd = tekort(ik) === geefStd ? handel.find((r) => r.id !== geefStd)?.id : tekort(ik);
    openModal(`<h2>Contract aanbieden</h2><div class="titel">${esc(land.naam)}</div>
      <div class="contract-form">
        <label>Soort <select id="c-soort"><option value="grondstof">Grondstoffen ruilen</option><option value="krediet">Krediet verstrekken</option></select></label>
        <label>Looptijd (dagen) <input id="c-loop" type="number" min="${CONTRACT.loop_min}" max="${CONTRACT.loop_max}" step="10" value="90"></label>
        <div data-soort="grondstof" class="contract-paar">
          <label>Jij levert per dag <span><input id="c-geef-n" type="number" min="0.5" max="${CONTRACT.per_dag_max}" step="0.5" value="2"><select id="c-geef-r">${opties(geefStd)}</select></span></label>
          <label>Jij vraagt per dag <span><input id="c-vraag-n" type="number" min="0.5" max="${CONTRACT.per_dag_max}" step="0.5" value="2"><select id="c-vraag-r">${opties(vraagStd)}</select></span></label>
        </div>
        <div data-soort="krediet" class="contract-paar" hidden>
          <label>Bedrag <input id="c-bedrag" type="number" min="${CONTRACT.bedrag_min}" max="${CONTRACT.bedrag_max}" step="50" value="200"></label>
          <label>Rente (%) <input id="c-rente" type="number" min="0" max="${CONTRACT.rente_max * 100}" step="1" value="10"></label>
        </div>
      </div>
      <p class="zacht" id="c-uitleg" style="font-size:12px"></p>
      <p class="slecht" id="c-fout" style="font-size:13px" hidden></p>
      <div class="keuzes"><button class="knop primair" id="c-bied">Aanbieden</button><button class="knop" id="c-annuleer">Annuleren</button></div>`, (el) => {
      const $$ = (q) => el.querySelector(q);
      const order = () => {
        const soort = $$('#c-soort').value;
        const o = { type: 'contract', actie: 'aanbod', met: doel, soort, looptijd: +$$('#c-loop').value };
        if (soort === 'grondstof') { o.geef = { res: $$('#c-geef-r').value, per_dag: +$$('#c-geef-n').value }; o.vraag = { res: $$('#c-vraag-r').value, per_dag: +$$('#c-vraag-n').value }; } else { o.bedrag = +$$('#c-bedrag').value; o.rente = +$$('#c-rente').value / 100; }
        return o;
      };
      const ververs = () => {
        const soort = $$('#c-soort').value;
        for (const d of el.querySelectorAll('[data-soort]')) d.hidden = d.dataset.soort !== soort;
        $$('#c-loop').min = soort === 'krediet' ? CONTRACT.krediet_min : CONTRACT.loop_min;
        const o = order();
        $$('#c-uitleg').textContent = soort === 'krediet'
          ? `Je betaalt ${fmt(o.bedrag)} zodra ${land.naam} aanvaardt en krijgt ${fmt(o.bedrag * (1 + o.rente))} terug in ${o.looptijd} dagen.`
          : `${o.looptijd} dagen lang: jij levert ${o.geef.per_dag * o.looptijd} ${res(o.geef.res)?.naam.toLowerCase()}, je krijgt ${o.vraag.per_dag * o.looptijd} ${res(o.vraag.res)?.naam.toLowerCase()}.`
          + ` ${land.naam} heeft ${CONTRACT.aanbod_dagen} dagen om te beslissen. Wie ${CONTRACT.verzuim_dagen} dagen niet levert, breekt het contract.`;
      };
      // #modal-inhoud wordt hergebruikt: de luisteraar weer weghalen bij sluiten.
      el.addEventListener('input', ververs);
      const sluit = () => { el.removeEventListener('input', ververs); klaar(); };
      ververs();
      $$('#c-annuleer').onclick = sluit;
      $$('#c-bied').onclick = () => {
        const r = geef(order());
        if (!r.ok) { $$('#c-fout').textContent = r.reden ?? 'Dat kan nu niet.'; $$('#c-fout').hidden = false; return; }
        toast(`Aanbod verstuurd aan ${land.naam}.`, 'goed');
        sluit();
      };
    });
  });
}

// ----- volk -----

function meter(waarde, kleur, max = 100) {
  return `<div class="voortgang" style="height:6px"><div style="width:${clampPct(waarde / max)};background:${kleur}"></div></div>`;
}
function clampPct(v) { return `${Math.max(0, Math.min(100, v * 100)).toFixed(0)}%`; }

function regimeEffecten(r) {
  const namen = {
    productiviteit: ['productiviteit', (v) => `${plus(v * 100, 0)}%`], handel_bonus: ['handelsinkomen', (v) => `${plus(v * 100, 0)}%`],
    tech_groei: ['technologiegroei/jaar', (v) => `${plus(v * 36500, 1)}%`], oorlog_moeheid: ['oorlogsmoeheid', (v) => `×${v}`],
    complot_gevoeligheid: ['vatbaarheid voor complotten', (v) => `×${v}`], informatiecontrole_max: ['max. informatiecontrole', (v) => `${v}`],
    informatiecontrole: ['informatiecontrole', (v) => plus(v, 0)], bouw_korting: ['bouwkosten', (v) => `−${(v * 100).toFixed(0)}%`],
    weerbaarheid: ['weerbaarheid', (v) => plus(v, 0)], stabiliteit: ['stabiliteit', (v) => plus(v, 0)], leger_korting: ['legerkosten', (v) => `−${(v * 100).toFixed(0)}%`],
  };
  return Object.entries(r.effecten || {}).map(([k, v]) => {
    const [naam, f] = namen[k] ?? [k, (x) => x];
    const goed = ['oorlog_moeheid', 'complot_gevoeligheid'].includes(k) ? v < 1 : k === 'informatiecontrole_max' ? null : v > 0;
    return `<span class="${goed == null ? 'zacht' : goed ? 'goed' : 'slecht'}">${esc(naam)} ${f(v)}</span>`;
  }).join(' · ');
}

function renderVolk() {
  const s = ui.state;
  const c = speler();
  const P = s.pack;
  const r = P.regimes[c.regime];
  let rh = `<section class="blok"><h3>Regime <span class="uitleg" title="Je staatsvorm bepaalt sterke en zwakke punten, de bouwstijl op de kaart en de verwantschap met andere landen. Landen voelen zich aangetrokken tot blokken met een leider van hetzelfde regime.">ⓘ</span></h3>
    <div class="land-kop"><span class="naam" style="font-size:16px">${r.icoon ?? ''} ${esc(r.naam)}</span>${c.revoluties ? `<span class="pil">${c.revoluties} revolutie${c.revoluties > 1 ? 's' : ''}</span>` : ''}</div>
    <p style="font-size:12.5px;color:#b9c6d4;margin:4px 0">${esc(r.beschrijving ?? '')}</p>
    <div style="font-size:12px">${regimeEffecten(r)}</div>
    ${r.verkiezingen ? `<div class="advies">Volgende verkiezingen over ${Math.max(0, r.verkiezingen - (s.dag - (c.laatsteVerkiezing ?? 0)))} dagen. Onder ${r.verkiezing_drempel ?? 45} stabiliteit verlies je ze.</div>` : ''}
    ${r.staatsgreep ? '<div class="advies">Onder 30 stabiliteit dreigt een staatsgreep.</div>' : ''}
    <details style="margin-top:8px"><summary class="zacht" style="font-size:12px;cursor:pointer">Staatshervorming</summary>`;
  for (const [id, ander] of Object.entries(P.regimes)) {
    if (id === c.regime) continue;
    const st = hervormingStatus(s, s.speler, id);
    rh += `<div class="actie"><div><b>${ander.icoon ?? ''} ${esc(ander.naam)}</b></div>
      <button class="knop klein" data-actie="hervorming" data-id="${esc(id)}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? '')}">${P.model.hervorming.kosten}◈</button>
      <div class="sub">${regimeEffecten(ander)}${st.ok ? ` · kost ${P.model.hervorming.stabiliteit} stabiliteit` : ` · <span class="slecht">${esc(st.reden)}</span>`}</div></div>`;
  }
  zet('regime', rh + '</details></section>');
  const cap = woningCapaciteit(s, c);
  const p = s.pandemie;
  const vreemd = Object.entries(c.netwerken).filter(([b, w]) => b !== c.blok && w > 1);
  zet('volk', `<section class="blok"><h3>Samenleving</h3>
    <div class="kern-grid" style="margin:0 0 8px">
      <div><span class="l">Bevolking</span><span class="w ${c.L >= cap * 0.97 ? 'slecht' : ''}">${c.L.toFixed(1)} / ${cap.toFixed(0)}</span></div>
      <div><span class="l">Productiviteit</span><span class="w">+${pct(voorziening(s, c, 'productiviteit'), 1)}</span></div>
      <div><span class="l">Techgroei/jaar</span><span class="w">+${pct(voorziening(s, c, 'tech_groei') * 365, 1)}</span></div>
      <div><span class="l">Zorg</span><span class="w">${voorziening(s, c, 'zorg').toFixed(1)}</span></div>
      <div><span class="l">Voorzieningen</span><span class="w goed">+${voorziening(s, c, 'stabiliteit').toFixed(1)} stab</span></div>
      <div><span class="l">Weerbaarheid</span><span class="w">${c.weerbaarheid.toFixed(0)}</span></div>
    </div>
    ${c.L >= cap * 0.97 ? '<div class="advies">Je bevolking zit tegen het woningplafond. Bouw woonwijken om te groeien.</div>' : ''}
    <div style="font-size:12px;margin-top:8px">Informatiecontrole <b>${c.controle.toFixed(0)}</b> <span class="zacht">— grip op wat mensen te zien krijgen; boven 50 wekt het zelf argwaan</span></div>
    ${meter(c.controle / 100, '#c38fff', 1)}
    <div style="font-size:12px;margin-top:8px">Complotdruk <b class="${c.complot > 40 ? 'slecht' : ''}">${c.complot.toFixed(0)}</b> <span class="zacht">— wantrouwen en alternatieve verhalen; drukt stabiliteit en productiviteit</span></div>
    ${meter(c.complot / 100, '#f2706a', 1)}
    ${p ? `<div class="advies" style="margin-top:8px">🦠 ${esc(p.naam)}: ${p.besmet.filter(Boolean).length} landen besmet${p.besmet[c.idx] ? ', ook jouw land' : ''}. Nog ${p.tot - s.dag} dagen.</div>` : ''}
    ${vreemd.length ? `<div class="advies" style="margin-top:8px">${c.weerbaarheid >= 5 ? `Buitenlandse netwerken in je land: ${vreemd.map(([b, w]) => `${esc(blokNaam(b))} ${w.toFixed(0)}`).join(', ')}. Oprollen kan via het tabblad Invloed (klik je eigen land).` : 'Er zijn aanwijzingen voor buitenlandse netwerken. Met meer weerbaarheid zie je wie erachter zit.'}</div>` : ''}
  </section>`);

  let h = `<section class="blok"><h3>Campagnes in eigen land <span class="uitleg" title="Je bevolking sturen via media. Manipulatie werkt, maar als ze het doorzien, groeit het wantrouwen. Meer informatiecontrole maakt ontdekking minder waarschijnlijk.">ⓘ</span></h3>`;
  for (const a of P.acties.campagnes) {
    const st = campagneStatus(s, s.speler, a);
    h += `<div class="actie"><div><b>${esc(a.naam)}</b></div>
      <button class="knop klein" data-actie="campagne" data-id="${esc(a.id)}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? '')}">${kostenTekst(a.kosten || {})}</button>
      <div class="sub">${esc(a.beschrijving ?? '')} <span class="zacht">${esc(effectTekst(a.effect || {}))}</span>${st.ok && st.ontdekkans ? ` <span style="color:var(--accent)">${pct(st.ontdekkans)} kans dat het doorgeprikt wordt.</span>` : ''}${st.ok ? '' : ` · <span class="slecht">${esc(st.reden)}</span>`}</div></div>`;
  }
  zet('campagnes', h + '</section>');
  zet('thuisfront', `<section class="blok"><h3>Thuisfront en media <span class="uitleg" title="Strijdbereidheid bepaalt hoe hard je leger vecht. Buitenlandse media, complotten en een lange oorlog drukken haar; propaganda, informatiecontrole en een vijand op eigen grond tillen haar op. Klik je omroep op de kaart voor het mediacentrum.">ⓘ</span></h3>
    ${moraalBlok(c, true)}
    <div style="font-size:12px;margin-top:8px">Buitenlandse invloed op jouw media: <b class="${vijandigeMedia(s, c) > 20 ? 'slecht' : ''}">${vijandigeMedia(s, c).toFixed(0)}</b>${Object.entries(c.media).filter(([b]) => b !== c.blok).map(([b, w]) => ` · <span style="color:${blokKleur(b)}">${esc(blokNaam(b))} ${w.toFixed(0)}</span>`).join('')}</div>
    ${mediaActies(c, ['verdediging', 'propaganda'])}
    ${mediaCapaciteit(s, c) < 10 ? '<div class="advies">Zonder omroep kun je geen media-aanvallen doen. Bouw er een hieronder.</div>' : ''}
  </section>`);
  zet('gebouwen-volk', gebouwLijst((g) => g.categorie === 'maatschappij'));
}

// ----- leger -----

function renderLeger() {
  const s = ui.state;
  const c = speler();
  const P = s.pack;
  const eigen = s.eenheden.filter((u) => u.land === s.speler);
  const perType = {};
  for (const u of eigen) perType[u.type] = (perType[u.type] || 0) + 1;
  const oorlogen = leger.oorlogenVan(s, c);
  const mijn = leger.partij(s, c);
  let h = `<section class="blok"><h3>Oorlogen</h3>`;
  if (!oorlogen.length) h += `<p class="zacht" style="font-size:13px;margin:0">Je bent niet in oorlog. Een oorlog verklaar je via de escalatieladder (trede 5) bij een geselecteerd land${sim.isOntgrendeld(s, 'escalatie') ? '' : `, vanaf de fase ${esc(volgendeFase(s, 'escalatie')?.naam ?? 'Beslissen')}`}.</p>`;
  for (const o of oorlogen) {
    const ander = o.a === mijn ? o.b : o.a;
    const st = leger.vredeStatus(s, s.speler, o);
    h += `<div class="actie"><div><b>tegen ${esc(leger.partijNaam(s, ander))}</b> <span class="zacht" style="font-size:12px">sinds dag ${o.start}</span></div>
      <button class="knop klein ${o.vredesaanbod ? 'actief' : ''}" data-actie="vrede" data-id="${esc(ander)}">${o.vredesaanbod ? 'Vredesaanbod aannemen' : 'Vrede voorstellen'}</button>
      <div class="sub">Sterkte: jij ${leger.partijSterkte(s, mijn).toFixed(0)} · zij ${leger.partijSterkte(s, ander).toFixed(0)}${st.ok ? ' · <span class="goed">ze zouden vrede aannemen</span>' : ''}</div></div>`;
  }
  zet('oorlogen', h + '</section>');

  const sel = [...ui.selectie].filter((id) => eigen.some((u) => u.id === id)).length;
  h = `<section class="blok"><h3>Jouw leger <span class="num">${eigen.length}/${P.model.max_eenheden}</span></h3>
    <div style="font-size:13px">${Object.entries(perType).map(([t, n]) => `${leger.eenheidType(s, t).icoon} ${n}× ${esc(leger.eenheidType(s, t).naam.toLowerCase())}`).join(' · ') || '<span class="zacht">Nog geen eenheden.</span>'}</div>
    <div style="font-size:12px;margin:6px 0" class="zacht">${sel ? `<b style="color:var(--accent)">${sel} geselecteerd.</b> Rechtsklik op de kaart om ze te sturen.` : 'Klik een eenheid op de kaart (shift = erbij, shift+slepen = gebied), of selecteer alles met A. Rechtsklik = verplaatsen of aanvallen.'}</div>
    <div style="display:flex;gap:6px"><button class="knop klein" data-actie="selecteer-leger">Alles selecteren (A)</button><button class="knop klein" data-actie="leger-thuis" ${sel ? '' : 'disabled'}>Naar hoofdstad</button></div>
  </section>`;
  const mijnKolonies = s.kolonies.filter((k) => k.land === s.speler);
  const vrijLand = s.pack.geo.onbewoond.filter((i) => s.eigenaar[i] === -2).length;
  h += `<section class="blok"><h3>Kolonies</h3>
    ${mijnKolonies.length ? mijnKolonies.map((k) => `<div style="font-size:13px">🚩 ${esc(k.naam)} <span class="zacht">sinds dag ${k.dag}</span></div>`).join('') : '<p class="zacht" style="font-size:13px;margin:0">Nog geen kolonies.</p>'}
    <p class="zacht" style="font-size:12px;margin:6px 0 0">${vrijLand ? `Nog ${vrijLand} vakjes onbewoond land. Bouw een haven, leid een kolonistenschip op, selecteer het en rechtsklik op een onbewoond eiland.` : 'Al het onbewoonde land is verdeeld.'}</p></section>`;
  zet('leger-overzicht', h);

  h = `<section class="blok"><h3>Opleiden</h3>`;
  for (const e of P.eenheden) {
    const st = leger.trainStatus(s, s.speler, e.id);
    h += `<div class="actie"><div><b>${e.icoon ?? ''} ${esc(e.naam)}</b> <span class="zacht" style="font-size:12px">${e.bouwtijd} d</span></div>
      <button class="knop klein" data-actie="train" data-id="${esc(e.id)}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? '')}">${kostenTekst(e.kosten || {})}</button>
      <div class="sub">aanval ${e.aanval} · leven ${e.hp} · bereik ${e.bereik} · snelheid ${e.snelheid}${e.vliegt ? ' · vliegt' : ''} · ${esc(e.beschrijving ?? '')}${st.ok ? '' : ` · <span class="slecht">${esc(st.reden)}</span>`}</div></div>`;
  }
  if (c.training.length) {
    h += `<div class="wachtrij">${c.training.map((x) => `<div><span>${esc(leger.eenheidType(s, x.type).naam)} · nog ${Math.max(0, x.klaar - s.dag)} d</span></div>`).join('')}</div>`;
  }
  zet('training', h + '</section>');
  zet('gebouwen-leger', gebouwLijst((g) => g.categorie === 'leger'));
}

// ----- invloed -----

function loyaliteitBalken(l) {
  const s = ui.state;
  const drempel = s.pack.model.drempel_alignment;
  return s.blokken.map((b) => {
    const v = l.loyaliteit[b.id];
    const lopend = l.effecten.filter((e) => e.blok === b.id).reduce((a, e) => a + e.perDag * e.dagen, 0);
    return `<div class="lbar"><span>${esc(b.naam)}</span><div class="baan"><div style="width:${v}%;background:${b.kleur}"></div><span class="drempel" style="left:${drempel}%"></span></div>
      <span class="num">${v.toFixed(0)}${lopend > 0.5 ? `<span class="goed" style="font-size:10px"> +${lopend.toFixed(0)}</span>` : lopend < -0.5 ? `<span class="slecht" style="font-size:10px"> ${lopend.toFixed(0)}</span>` : ''}</span></div>`;
  }).join('');
}

function renderInvloed() {
  const s = ui.state;
  const P = s.pack;
  const t = s.landen[ui.sel];
  if (!t) {
    zet('land', `<section class="blok"><h3>Invloed</h3><p style="margin:0;font-size:13px;color:#b9c6d4">Klik op een land op de kaart om het te bekijken en te bewerken.
      Een land sluit zich aan bij het blok waarop het het hoogst scoort, zodra die loyaliteit boven ${P.model.drempel_alignment} komt.
      ${sim.isOntgrendeld(s, 'invloed') ? '' : `<br><br>🔒 Invloed kopen komt vrij in de fase ${esc(volgendeFase(s, 'invloed')?.naam ?? '')} (dag ${volgendeFase(s, 'invloed')?.dag ?? '?'}).`}</p></section>`);
  } else {
    const pers = P.persoonlijkheden[t.persoonlijkheid];
    const gevoelig = Object.entries(pers.gevoeligheid || {}).filter(([, v]) => v >= 1.2).map(([k]) => k);
    const ongevoelig = Object.entries(pers.gevoeligheid || {}).filter(([, v]) => v <= 0.75).map(([k]) => k);
    const isSpeler = t.idx === s.speler;
    let h = `<section class="blok">
      <div class="land-kop"><span class="naam">${isSpeler ? '★ ' : ''}${esc(t.naam)}</span>
        <span class="pil" style="border-color:${blokKleur(t.alignment)};color:${blokKleur(t.alignment)}">${esc(blokNaam(t.alignment))}</span></div>
      <div style="font-size:12px;color:var(--zacht);margin:4px 0 8px">${P.regimes[t.regime]?.icoon ?? ''} ${esc(P.regimes[t.regime]?.naam ?? '')}${t.regime === speler().regime && !isSpeler ? ' <span class="goed">(zelfde regime: invloed werkt beter)</span>' : ''} · ${esc(pers.naam)} · ${esc(t.leider)} · ${t.L.toFixed(0)} mln inwoners${t.uitspelen ? ' · <span style="color:var(--accent)">⚖ speelt blokken tegen elkaar uit</span>' : ''}</div>
      <div class="kern-grid" style="margin:0 0 8px">
        <div><span class="l">Productie</span><span class="w">${fmt(t.Y)}</span></div>
        <div><span class="l">Stabiliteit</span><span class="w">${t.stab.toFixed(0)}</span></div>
        <div><span class="l">Technologie</span><span class="w">${t.A.toFixed(2)}</span></div>
      </div>
      ${t.vast ? '' : loyaliteitBalken(t)}
      ${!t.vast && (gevoelig.length || ongevoelig.length) ? `<div style="font-size:12px;margin-top:6px">${gevoelig.length ? `Gevoelig voor <b>${gevoelig.join(', ')}</b>. ` : ''}${ongevoelig.length ? `<span class="zacht">Weinig gevoelig voor ${ongevoelig.join(', ')}.</span>` : ''}</div>` : ''}
      ${isSpeler ? '<p class="zacht" style="font-size:12px;margin:8px 0 0">Dit is je eigen land. Kies een ander land om invloed uit te oefenen.</p>' : ''}
      ${t.vast && !isSpeler ? `<p class="zacht" style="font-size:12px;margin:8px 0 0">Kernland en leider van ${esc(blokNaam(t.blok))}: niet over te halen, wel doelwit van druk.</p>` : ''}
    </section>`;

    if (!t.vast) {
      h += `<section class="blok"><h3>Hefbomen <button class="knop klein" data-actie="cmdvoor" data-id="${t.idx}" ${sim.isOntgrendeld(s, 'commandanten') ? '' : 'disabled'}>Delegeer aan commandant</button></h3>`;
      for (const a of P.acties.hefbomen) {
        const st = sim.hefboomStatus(s, s.speler, t.idx, a);
        const winst = sim.verwachteWinst(s, s.speler, t.idx, a);
        h += `<div class="actie"><div><b>${esc(a.naam)}</b> <span class="zacht" style="font-size:12px">${esc(a.hefboom)}</span></div>
          <button class="knop klein" data-actie="hefboom" data-id="${esc(a.id)}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? '')}">${kostenTekst(sim.actieKosten(s, a, t))}</button>
          <div class="sub">${esc(a.beschrijving ?? '')} ≈ <span class="goed">+${winst.toFixed(1)}</span> loyaliteit in ${a.duur} d${st.ok ? '' : ` · <span class="slecht">${esc(st.reden)}</span>`}</div></div>`;
      }
      h += '</section>';
    }

    if (!isSpeler) {
      h += `<section class="blok"><h3>Media en strijdbereidheid</h3>
        <div style="font-size:12px">Jouw media-invloed: <b>${(t.media[s.spelerBlok] ?? 0).toFixed(0)}</b>${Object.entries(t.media).filter(([b]) => b !== s.spelerBlok && t.media[b] > 1).map(([b, w]) => ` · <span style="color:${blokKleur(b)}">${esc(blokNaam(b))} ${w.toFixed(0)}</span>`).join('')}</div>
        ${moraalBlok(t, false)}
        ${mediaActies(t, ['belang', 'nepnieuws'])}
      </section>
      <section class="blok"><h3>Overname <span class="uitleg" title="Twee wegen zonder oorlog: een land dat je vertrouwt, jouw media volgt en niet meer wil vechten, sluit zich aan. Of: overweldigende militaire overmacht plus lage strijdbereidheid, en ze geven zich over.">ⓘ</span></h3>${overnameBlok(t)}</section>`;
    }

    // Geheime netwerken
    {
      const eigenNet = t.netwerken[s.spelerBlok] ?? 0;
      const vreemd = Object.entries(t.netwerken).filter(([b, w]) => b !== s.spelerBlok && w > 1);
      const zicht = isSpeler ? speler().weerbaarheid >= 5 : eigenNet >= 30;
      h += `<section class="blok"><h3>Geheime netwerken <span class="uitleg" title="Besloten genootschappen van invloedrijke mensen. Ze trekken een land langzaam naar een blok en maken chantage mogelijk. Weerbaarheid (politie, rechtspraak, onderwijs) slijt ze weg.">ⓘ</span></h3>
        <div style="font-size:12px;margin-bottom:6px">Complotdruk in ${esc(t.naam)}: <b class="${t.complot > 40 ? 'slecht' : ''}">${t.complot.toFixed(0)}</b> · weerbaarheid ${t.weerbaarheid.toFixed(0)}${!isSpeler ? ` · jouw netwerk: <b>${eigenNet.toFixed(0)}</b>` : ''}</div>
        ${vreemd.length ? `<div style="font-size:12px;margin-bottom:6px">${zicht ? vreemd.map(([b, w]) => `<span style="color:${blokKleur(b)}">${esc(blokNaam(b))}: ${w.toFixed(0)}</span>`).join(' · ') : '<span class="zacht">Er zijn aanwijzingen voor buitenlandse netwerken, maar je ziet te weinig.</span>'}</div>` : ''}`;
      for (const a of P.acties.netwerken) {
        if ((a.type === 'oprollen') !== isSpeler) continue;
        const st = netwerkStatus(s, s.speler, t.idx, a);
        h += `<div class="actie"><div><b>${esc(a.naam)}</b></div>
          <button class="knop klein" data-actie="netwerk" data-id="${esc(a.id)}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? '')}">${kostenTekst(sim.actieKosten(s, a, t))}</button>
          <div class="sub">${esc(a.beschrijving ?? '')}${st.ok && st.ontdekkans ? ` <span style="color:var(--accent)">${pct(Math.min(1, st.ontdekkans))} kans dat het lekt.</span>` : ''}${st.ok ? '' : ` · <span class="slecht">${esc(st.reden)}</span>`}</div></div>`;
      }
      h += '</section>';
    }

    if (!isSpeler) {
      const eigen = blok(s.spelerBlok);
      h += `<section class="blok ladder"><h3>Escalatieladder <span class="uitleg" title="Elke trede kost meer stabiliteit en loyaliteit bij derden. Een trede overslaan verdubbelt de politieke kosten.">ⓘ</span></h3>`;
      for (const e of P.acties.escalatie) {
        if (e.type === 'cyber' && e.beschikbaar !== false) { h += cyberTrede(s, t, e, { esc, kostenTekst }); continue; }
        const open = e.beschikbaar !== false;
        const st = open ? sim.escalatieStatus(s, s.speler, t.idx, e) : { ok: false, reden: 'Nog niet in dit prototype.' };
        const kans = e.ontdekkans ? `, ${pct(e.ontdekkans)} kans dat het uitkomt` : '';
        const cb = (s.casusBelli[`${s.spelerBlok}|${leger.partij(s, t)}`] ?? -1) > s.dag;
        const effect = !open ? '' : e.type === 'oorlog'
          ? (leger.inOorlog(s, speler(), t) ? '<span class="slecht">Je bent al in oorlog met deze partij.</span>' : `eigen stabiliteit ${e.eigen_stabiliteit}, derden ${e.derden_loyaliteit} loyaliteit${cb ? ' · <span class="goed">casus belli: veel lagere kosten</span>' : ''}`)
          : e.type === 'valse_vlag' ? `schuld bij ${esc(leger.partijNaam(s, leger.partij(s, t)))}: zij verliezen loyaliteit, jij krijgt een casus belli${kans}`
          : e.type === 'complot' ? `complotdruk +${e.complot} (minder bij weerbare landen)${kans}`
          : `doel −${Math.abs(e.doel_stabiliteit ?? 0)} stabiliteit, derden ${e.derden_loyaliteit ?? 0} loyaliteit${kans}`;
        h += `<div class="trede ${open ? '' : 'dicht'}"><span class="nr">${e.trede}</span><b>${esc(e.naam)}</b>
          ${open ? `<button class="knop klein" data-actie="escalatie" data-id="${esc(e.id)}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? '')}">${kostenTekst(sim.actieKosten(s, e, t))}</button>` : '<span class="pil">vertical slice</span>'}
          <span class="sub">${esc(e.beschrijving ?? '')} ${effect ? `<br>${effect}` : ''}${st.ok && st.sprong ? '<br><span style="color:var(--accent)">Sprong: dubbele politieke kosten.</span>' : ''}${open && !st.ok ? `<br><span class="slecht">${esc(st.reden)}</span>` : ''}</span></div>`;
      }
      const de = P.acties.deescalatie;
      const deAf = (s.afkoeling[`${s.spelerBlok}|deescalatie`] ?? 0) - s.dag;
      h += `<div class="trede"><span class="nr">↓</span><b>${esc(de.naam)}</b>
        <button class="knop klein" data-actie="deescalatie" ${sim.isOntgrendeld(s, 'escalatie') && deAf <= 0 ? '' : 'disabled'}>${kostenTekst(de.kosten)}</button>
        <span class="sub">Spanning in jouw blok: <b class="${eigen.spanning > 20 ? 'slecht' : ''}">${eigen.spanning.toFixed(0)}</b>. Verlaagt spanning; boven 10 waarderen zwevende landen het.${deAf > 0 ? ` Afkoeling ${deAf} d.` : ''}</span></div>`;
      h += '</section>';
    }
    zet('land', h);
  }

  const zw = s.landen.filter((l) => !l.vast).sort((a, b) => {
    const za = a.alignment === 'zwevend' ? 0 : 1, zb = b.alignment === 'zwevend' ? 0 : 1;
    return za - zb || b.Y - a.Y;
  });
  zet('zwevend', `<section class="blok"><h3>Landen in het spel</h3><div class="zw-lijst">${zw.map((l) => {
    const tot = s.blokken.reduce((a, b) => a + l.loyaliteit[b.id], 0) || 1;
    return `<div class="zw" data-actie="selecteer" data-id="${l.idx}" style="${l.idx === ui.sel ? 'background:#1b2836' : ''}">
      <span><b>${esc(l.naam)}</b> <span style="color:${blokKleur(l.alignment)};font-size:12px">${esc(blokNaam(l.alignment))}</span>${l.uitspelen ? ' ⚖' : ''}</span>
      <div class="mini">${s.blokken.map((b) => `<div style="width:${(l.loyaliteit[b.id] / tot) * 100}%;background:${b.kleur}"></div>`).join('')}</div></div>`;
  }).join('')}</div></section>`);
}

// ----- blokken -----

function renderBlokken() {
  const s = ui.state;
  const P = s.pack;
  zet('blokken', `<section class="blok"><h3>Blokken</h3>${s.blokken.map((b) => {
    const leden = s.landen.filter((l) => l.alignment === b.id).map((l) => l.naam);
    const leider = s.landen[b.leider];
    return `<div class="blok-rij"><span class="kleur" style="background:${b.kleur}"></span><b>${esc(b.naam)}${b.id === s.spelerBlok ? ' (jij)' : ''}</b><span class="num">${pct(b.aandeel)}</span>
      <div class="aandeel"><div style="width:${pct(b.aandeel)};height:100%;background:${b.kleur}"></div></div>
      <span class="sub">Leider ${esc(leider?.naam ?? '–')} · ${b.leden} landen · cohesie ${b.cohesie?.toFixed(0) ?? '–'} · spanning ${b.spanning.toFixed(0)}<br>${esc(leden.join(', '))}</span></div>`;
  }).join('')}
  <div class="blok-rij"><span class="kleur" style="background:${P.zwevend.kleur}"></span><b>Zwevend</b><span class="num">${s.landen.filter((l) => l.alignment === 'zwevend').length} landen</span>
    <span class="sub">${esc(s.landen.filter((l) => l.alignment === 'zwevend').map((l) => l.naam).join(', ') || '–')}</span></div></section>`);

  if (s.geschiedenis.length !== ui.grafiekLen) {
    ui.grafiekLen = s.geschiedenis.length;
    const g = s.geschiedenis;
    tekenGrafiek($('#grafiek-blokken'), {
      xs: g.map((h) => h.dag),
      reeksen: s.blokken.map((b) => ({ label: b.naam, kleur: b.kleur, waarden: g.map((h) => h.aandelen[b.id] * 100), dik: b.id === s.spelerBlok, formaat: (v) => `${v.toFixed(0)}%` })),
      yMin: 0,
    });
  }

  const V = P.verhaal;
  let h = '<section class="blok"><h3>Overwinning</h3>';
  for (const o of V.overwinning || []) {
    h += `<div style="font-size:13px;margin:6px 0 2px"><b>${esc(o.naam)}</b> <span class="zacht">${o.type === 'aandeel_productie' ? `${pct(o.drempel)} van de wereldproductie, ${o.duur_dagen ?? 1} dagen lang` : o.type === 'aantal_landen' ? `${o.drempel} landen in je blok` : `technologiefactor ${o.drempel} in een kernland`}${s.dag < (o.min_dag ?? 300) ? ` · telt vanaf dag ${o.min_dag ?? 300}` : ''}</span></div>`;
    for (const b of s.blokken) {
      let v = 0;
      if (o.type === 'aandeel_productie') v = b.aandeel / o.drempel;
      else if (o.type === 'aantal_landen') v = b.leden / o.drempel;
      else v = Math.max(...s.landen.filter((l) => l.blok === b.id && l.kern).map((l) => l.A), 0) / o.drempel;
      h += `<div class="lbar"><span>${esc(b.naam)}</span><div class="baan"><div style="width:${Math.min(100, v * 100)}%;background:${b.kleur}"></div></div><span class="num">${pct(Math.min(1, v))}</span></div>`;
    }
  }
  h += `<p class="zacht" style="font-size:12px;margin:8px 0 0">Einde van de tijdlijn op dag ${V.dag_limiet} (nog ${Math.max(0, V.dag_limiet - s.dag)} dagen). Dan wint het blok met het grootste aandeel.</p></section>`;
  zet('overwinning', h);
}

// ----- commandanten -----

function renderCommandanten() {
  const s = ui.state;
  const slot = !sim.isOntgrendeld(s, 'commandanten');
  zet('cmd-slot', slot ? `<p class="zacht" style="font-size:13px;margin:0 0 8px">🔒 Commandanten komen vrij in de fase ${esc(volgendeFase(s, 'commandanten')?.naam ?? '')} (dag ${volgendeFase(s, 'commandanten')?.dag ?? '?'}).</p>` : '');
  $('#cmd-knop').disabled = slot || !!s.replay;
  const bezet = new Set(s.commandanten.filter((k) => k.actief).map((k) => k.doel));
  const opties = s.landen.filter((l) => !l.vast && !bezet.has(l.idx));
  const sig = opties.map((l) => l.idx).join(',');
  const sel = $('#cmd-doel');
  if (sel._sig !== sig) {
    const huidig = sel.value;
    sel.innerHTML = opties.map((l) => `<option value="${l.idx}">${esc(l.naam)} (${esc(blokNaam(l.alignment))})</option>`).join('');
    if (opties.some((l) => String(l.idx) === huidig)) sel.value = huidig;
    else if (opties.some((l) => l.idx === ui.sel)) sel.value = String(ui.sel);
    sel._sig = sig;
  }
  const lijst = [...s.commandanten].reverse();
  zet('commandanten', lijst.length ? lijst.map((k) => {
    const t = s.landen[k.doel];
    return `<section class="blok cmd"><div class="land-kop"><b>${esc(t.naam)}</b><span class="pil">${k.actief ? 'actief' : 'klaar'} · ${k.stijl}</span></div>
      <div class="lbar" style="grid-template-columns:70px 1fr 70px"><span class="zacht">Budget</span><div class="baan"><div style="width:${pct(Math.min(1, k.besteed / k.budget))};background:#c38fff"></div></div><span class="num">${fmt(k.besteed)}/${fmt(k.budget)}</span></div>
      ${loyaliteitBalken(t)}
      <div class="rapport">${k.rapport.slice(-5).reverse().map((r) => `<span>dag ${r.dag} · ${esc(r.tekst)}</span>`).join('') || '<span>Eerste rapport volgt binnen enkele dagen.</span>'}</div>
      ${k.actief ? `<button class="knop klein" data-actie="cmdstop" data-id="${k.id}">Terugroepen</button>` : ''}</section>`;
  }).join('') : '<p class="zacht" style="font-size:13px">Nog geen commandanten. Een commandant bespaart aandacht: geef een doel en budget, hij doet de rest.</p>');
}

// ----- logboek -----

function renderLog() {
  const s = ui.state;
  zet('log', `<section class="blok">${s.log.slice(-200).reverse().map((l) => `<div class="log-item ${l.soort}"><span class="d">dag ${l.dag}</span><span class="t">${esc(l.tekst)}</span></div>`).join('')}</section>`);
}

// ---------- tooltip ----------

function toonTip(idx, t, x, y) {
  const tip = $('#kaart-tip');
  const s = ui.state;
  if (!s) { tip.hidden = true; return; }
  const tegel = s.pack.geo.tegels[t];
  const plaatsTip = (html) => {
    tip.innerHTML = html;
    tip.hidden = false;
    const w = $('#kaart-wrap').clientWidth;
    tip.style.left = `${Math.min(x + 14, w - 250)}px`;
    tip.style.top = `${y + 14}px`;
  };
  if (ui.bouwModus && tegel) {
    const st = ui.kaart.bouwStatus?.get(t) ?? sim.tegelStatus(s, s.speler, ui.bouwModus, t);
    const c = speler();
    const d = s.eigenaar[t] === s.speler ? sim.afstandTotKnooppunt(s, c, t) : null;
    plaatsTip(`<b>${esc(tegel.terrein)}</b>${d != null ? ` · ${d.toFixed(1)} vakjes van knooppunt` : ''}<br>${st.ok
      ? `<span class="goed">Bouwen kan.</span> Rendement <b>${pct(st.rendement)}</b>`
      : `<span class="slecht">${esc(st.reden)}</span>`}`);
    return;
  }
  const u = ui.kaart.hoverEenheid != null ? s.eenheden.find((x) => x.id === ui.kaart.hoverEenheid) : null;
  if (u) {
    const e = leger.eenheidType(s, u.type);
    const land = s.landen[u.land];
    plaatsTip(`<b>${e.icoon ?? ''} ${esc(e.naam)}</b> · ${esc(land.naam)}<br>Leven ${Math.max(0, u.hp).toFixed(0)}/${e.hp} · aanval ${e.aanval} · bereik ${e.bereik}${u.vecht ? '<br><span class="slecht">In gevecht</span>' : u.pad.length ? '<br><span class="zacht">Onderweg</span>' : u.bezig ? '<br><span style="color:var(--accent)">Neemt gebied in</span>' : ''}`);
    return;
  }
  const bezet = tegel && s.bezet[t];
  if (bezet && ui.kaart.zoom >= 1.5) {
    const land = s.landen[bezet.land];
    if (bezet.hoofdstad) { plaatsTip(`<b>🏛 Hoofdstad van ${esc(land.naam)}</b><br><span class="zacht">Knooppunt: gebouwen binnen ${s.pack.model.bereik} vakjes draaien op vol rendement.</span>`); return; }
    const g = s.pack.gebouwIndex[bezet.gebouw];
    const p = land.plaatsingen.find((x) => x.t === t);
    const prod = Object.entries(g.productie || {}).map(([r, v]) => `+${(v * (p?.eff ?? 1)).toFixed(1)} ${res(r)?.naam.toLowerCase()}`).join(', ');
    const uitnodiging = bezet.land !== s.speler && !bezet.bouw ? `<br><span style="color:var(--accent)">Klik voor ${g.informatiecontrole || g.id === 'omroep' ? 'media inkopen bij de bron' : s.pack.eenheden.some((e) => e.gebouw === g.id) ? 'inlichtingen' : 'acties'}</span>` : '';
    plaatsTip(`<b>${g.icoon ?? ''} ${esc(g.naam)}</b> · ${esc(land.naam)}<br>${bezet.bouw ? '<span class="zacht">In aanbouw</span>' : `Rendement ${pct(p?.eff ?? 1)}${prod ? `<br><span class="zacht">${prod} per dag</span>` : ''}`}${uitnodiging}`);
    return;
  }
  if (idx === -2) { plaatsTip('<b>Onbewoond land</b><br><span class="zacht">Stuur een kolonistenschip hierheen (tabblad Leger) om een kolonie te stichten.</span>'); return; }
  const kolonie = tegel && s.kolonies.find((k) => k.t === t);
  if (kolonie && ui.kaart.zoom >= 1.5) { plaatsTip(`<b>🚩 ${esc(kolonie.naam)}</b><br><span class="zacht">Kolonie van ${esc(s.landen[kolonie.land].naam)} sinds dag ${kolonie.dag}. Groeit vanzelf; komt in opstand bij onrust thuis.</span>`); return; }
  if (idx < 0) { tip.hidden = true; return; }
  const l = s.landen[idx];
  const top = s.blokken.map((b) => [b, l.loyaliteit[b.id]]).sort((a, b) => b[1] - a[1]);
  tip.innerHTML = `<b>${esc(l.naam)}</b> <span style="color:${blokKleur(l.alignment)}">${esc(blokNaam(l.alignment))}</span><br>
    <span class="zacht">Productie ${fmt(l.Y)} · stabiliteit ${l.stab.toFixed(0)} · tech ${l.A.toFixed(2)}</span>
    ${l.vast ? '' : `<br>${top.map(([b, v]) => `<span style="color:${b.kleur}">${esc(b.naam.split(' ').pop())} ${v.toFixed(0)}</span>`).join(' · ')}`}`;
  tip.hidden = false;
  const w = $('#kaart-wrap').clientWidth;
  tip.style.left = `${Math.min(x + 14, w - 250)}px`;
  tip.style.top = `${y + 14}px`;
}

// ---------- modals ----------

function openModal(html, bind) {
  ui.modal = true;
  $('#modal-inhoud').innerHTML = html;
  $('#modal').hidden = false;
  bind?.($('#modal-inhoud'));
}
function sluitModal() {
  ui.modal = null;
  $('#modal').hidden = true;
}

function effectTekst(effect) {
  const s = ui.state;
  const P = s.pack;
  const duur = effect.duur_dagen ? ` (${effect.duur_dagen} d)` : '';
  return Object.entries(effect).filter(([k]) => k !== 'duur_dagen').map(([k, v]) => {
    if (P.resIndex[k]) return `${v >= 0 ? '+' : '−'}${Math.abs(v)} ${P.resIndex[k].naam.toLowerCase()}`;
    if (k === 'productie_factor') return `productie ×${String(v).replace('.', ',')}${duur}`;
    if (k === 'stabiliteit_doel') return `stabiliteitsdoel ${plus(v, 0)}${duur}`;
    if (k === 'tech_factor') return `technologie ×${String(v).replace('.', ',')}`;
    if (k === 'bevolking') return `bevolking ${plus((v - 1) * 100, 0)}%`;
    if (k === 'spanning') return `spanning ${plus(v, 0)}`;
    if (k === 'loyaliteit_zwevend') return `loyaliteit zwevende landen ${plus(v, 0)}`;
    if (k === 'complot') return `complotdruk ${plus(v, 0)}`;
    if (k === 'controle') return `informatiecontrole ${plus(v, 0)}`;
    if (k === 'oorlogssteun') return `${v} dagen steun voor oorlog`;
    if (k === 'quarantaine') return `${v} dagen quarantaine`;
    if (k === 'netwerk_oprollen') return `buitenlandse netwerken −${v}`;
    return extraEffectTekst(s, k, v, duur);
  }).filter(Boolean).join(' · ');
}

function toonEvent() {
  const s = ui.state;
  const e = s.pack.events.find((x) => x.id === s.pendingEvent.id);
  const terug = ui.tempo || ui.vorigTempo;
  zetTempo(0);
  openModal(`<h2>${s.pendingEvent.vervolg ? 'Vervolg' : 'Gebeurtenis'} · dag ${s.dag}</h2><div class="titel">${esc(e.titel)}</div><p>${esc(e.tekst ?? '')}</p>
    <div class="keuzes">${e.keuzes.map((k, i) => keuzeKnop(s, k, i, esc, effectTekst)).join('')}</div>`,
  (el) => {
    for (const b of el.querySelectorAll('[data-keuze]')) {
      b.onclick = () => {
        sluitModal();
        geef({ type: 'keuze', index: +b.dataset.keuze });
        zetTempo(terug);
      };
    }
  });
}

function toonIntro() {
  const s = ui.state;
  const P = s.pack;
  const c = speler();
  const fase = P.verhaal.fasen[s.faseIdx];
  openModal(`<h2>${esc(P.meta.naam)} · ${esc(blokNaam(c.blok))}</h2><div class="titel">Je leidt ${esc(c.naam)}</div>
    <p>${esc(fase?.tekst ?? '')}</p>
    <p style="font-size:13px">Economie is de motor: energie voedt industrie, chips voeden technologie, technologie verhoogt productiviteit overal.
    Invloed en druk kosten geld en loyaliteit. Wie te vroeg escaleert, verliest van binnenuit.</p>
    <p style="font-size:13px"><b>Winnen:</b> ${(P.verhaal.overwinning || []).map((o) => esc(o.naam)).join(', ')}. <b>Verliezen:</b> een rivaal wint, of je regering valt.</p>
    <p style="font-size:13px"><b>Bouwen:</b> kies in het paneel Economie een gebouw en klik op <i>Plaats</i>. De kaart zoomt in op je land; groene vakjes geven vol rendement. Mijnen kunnen alleen op bergen, landbouw op vlaktes, havens aan de kust. Hoe verder van je hoofdstad of een depot, hoe minder een gebouw oplevert.</p>
    <p style="font-size:13px"><b>Samenleving en leger:</b> in het tabblad <i>Volk</i> bouw je woningen, scholen, zorg, orde en media, en stuur je je bevolking met campagnes. In <i>Leger</i> leid je eenheden op. Klik een eenheid (of druk A), rechtsklik op de kaart om te verplaatsen. Oorlog verklaar je via de escalatieladder, vanaf de fase Beslissen.</p>
    <p class="zacht" style="font-size:12px">Spatie = pauze · 1–4 = tempo · scrollen = zoomen · slepen = verschuiven · shift+slepen = eenheden selecteren · H = eigen land · W = wereld · Esc = annuleren.</p>
    <div class="keuzes"><button class="knop primair" id="begin">Begin op 1×</button></div>`, (el) => {
    el.querySelector('#begin').onclick = () => { sluitModal(); zetTempo(1); };
  });
}

function toonEinde() {
  ui.eindGetoond = true;
  zetTempo(0);
  toonEindoverzicht(ui.state, { openModal, sluitModal, naarStart, download, toast });
}

function toonMenu() {
  const terug = ui.tempo;
  zetTempo(0);
  openModal(`<h2>Menu</h2><div class="titel">${esc(ui.state.pack.meta.naam)}</div>
    <p style="font-size:13px">Opslaan bewaart je spel in deze browser; via <i>Verder spelen</i> op het startscherm ga je verder. Als bestand kun je het ook op een andere computer openen. Een replay bevat de pack-versie, de seed en al je orders. Daarmee speelt het spel exact opnieuw af.</p>
    <div class="keuzes">
      <button class="knop" id="m-opslaan" ${ui.state.replay ? 'disabled' : ''}>Opslaan</button>
      <button class="knop" id="m-opslag" ${ui.state.replay ? 'disabled' : ''}>Opslag downloaden</button>
      <button class="knop" id="m-replay">Replay downloaden</button>
      <button class="knop" id="m-start">Terug naar startscherm</button>
      <button class="knop primair" id="m-verder">Verder spelen</button>
    </div>`, (el) => {
    el.querySelector('#m-opslaan').onclick = slaOp;
    el.querySelector('#m-opslag').onclick = downloadOpslag;
    el.querySelector('#m-replay').onclick = downloadReplay;
    el.querySelector('#m-start').onclick = naarStart;
    el.querySelector('#m-verder').onclick = () => { sluitModal(); zetTempo(terug); };
  });
}

function downloadReplay() {
  const s = ui.state;
  download(s.replayDoel ?? sim.maakReplay(s), `machtsbalans-${s.pack.meta.id}-dag${s.dag}.json`);
}

function download(data, naam) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = naam;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function naarStart() {
  sluitModal();
  zetTempo(0);
  autoOpslaan();
  stopTutorial(false);
  ui.state = null;
  $('#spel').hidden = true;
  $('#start').hidden = false;
  toonVerderKnop();
}

// ---------- tutorial en tips (B5, B21) ----------
// Stappen en tips komen uit story/tutorial.json van het pack. Deze laag toont de balk, zet een gloed op het doel
// (tegel op de kaart of knop in de interface) en gaat verder zodra de controle klopt. De engine weet hier niets van.
// De tutorial is een reeks stappen, één keer per pack. Tips zijn losse kaarten op sleutelmomenten, elk één keer per pack.

const TUT_SLEUTEL = 'machtsbalans-tutorial';
const TIP_SLEUTEL = 'machtsbalans-tips';
const TIP_DUUR = 90000; // een tip die niemand opvolgt, verdwijnt na anderhalve minuut
const TIP_ADEM = 8000; // minimale rust tussen twee tips
const tipsGezien = new Set(); // ook zonder opslag komt een tip binnen één sessie niet terug

function onthouden(sleutel) {
  try { return (localStorage.getItem(sleutel) || '').split(',').filter(Boolean); } catch { return []; }
}

function onthoud(sleutel, id) {
  try {
    const l = onthouden(sleutel);
    if (!l.includes(id)) l.push(id);
    localStorage.setItem(sleutel, l.join(','));
  } catch { /* opslag niet beschikbaar: dan komt het de volgende keer terug */ }
}

const tutorialGedaan = (packId) => onthouden(TUT_SLEUTEL).includes(packId);
const tipGezien = (packId, id) => tipsGezien.has(`${packId}:${id}`) || onthouden(TIP_SLEUTEL).includes(`${packId}:${id}`);

function startTutorial(pack, { replay = null, geladen = null } = {}) {
  stopTutorial(false);
  sluitTip();
  ui.tips = null;
  const t = pack.tutorial;
  // Zonder "Fasen en onboarding" geen tutorial en geen tips; een replay krijgt ze nooit.
  if (!t || !ui.state?.instellingen?.onboarding || replay) return;
  const s = ui.state;
  // Tips kijken naar wat er vanaf nu gebeurt: fasen en dreigingen van vóór een geladen partij tellen niet.
  ui.tips = { lijst: t.tips || [], getoond: {}, startDag: s.dag, faseIdx: s.faseIdx, escalaties: s.escalaties.length, laatste: 0 };
  if (!t.stappen?.length || geladen || tutorialGedaan(pack.meta.id) || s.instellingen.tutorial === false) return;
  ui.tutorial = { stappen: t.stappen, idx: -1, klaarOp: 0, sinds: performance.now(), sleutel: '' };
  volgendeStap();
}

function stopTutorial(onthoudt = true) {
  if (ui.tutorial) {
    stapVerlaten();
    if (onthoudt) onthoud(TUT_SLEUTEL, ui.state.pack.meta.id);
  }
  ui.tutorial = null;
  verbergBalk();
}

function verbergBalk() {
  if (ui.tutorial || ui.tip) return;
  const el = $('#tutorial');
  el.hidden = true;
  el.classList.remove('klaar', 'tut-tip');
  schikBouwbalk();
}

// Op de telefoon staan tutorialbalk en bouwbalk allebei bovenaan de kaart: zet de bouwbalk onder de tutorial.
function schikBouwbalk() {
  const tut = $('#tutorial');
  $('#bouwbalk').style.top = TELEFOON.matches && !tut.hidden ? `${tut.offsetHeight + 16}px` : '';
}

function huidigeStap() {
  const tut = ui.tutorial;
  return tut ? tut.stappen[tut.idx] : null;
}

// Wat er nu in de balk staat: een tutorialstap of een tip. 'bron' houdt de voortgang bij (klaarOp, sinds, gebeurd).
function actieveKaart() {
  if (ui.tutorial) return { stap: huidigeStap(), bron: ui.tutorial };
  if (ui.tip) return { stap: ui.tip.stap, bron: ui.tip };
  return { stap: null, bron: null };
}

function stapVerlaten() {
  for (const el of document.querySelectorAll('.tut-gloed')) el.classList.remove('tut-gloed');
  for (const b of [ui.tutorial, ui.tip]) if (b) b.knop = null;
  if (ui.kaart) ui.kaart.gloed = null;
}

function volgendeStap() {
  const tut = ui.tutorial;
  if (!tut) return;
  stapVerlaten();
  tut.idx += 1;
  tut.klaarOp = 0;
  tut.sinds = performance.now();
  tut.startDag = ui.state.dag;
  tut.gebeurd = null;
  const stap = tut.stappen[tut.idx];
  if (!stap) {
    stopTutorial(true);
    toast('Tutorial afgerond. Veel succes.', 'goed');
    return;
  }
  if (stap.tab && ui.tab !== stap.tab) zetTab(stap.tab);
  if (stap.doel?.soort === 'tegel' && ui.context) sluitContext();
  if (ui.bouwModus) stopBouwModus(); // de vorige bouwstap is klaar; een nieuwe bouwstap begint vanuit het paneel
  $('#kaart-tip').hidden = true; // op een touchscreen blijft de tip van de vorige tik anders staan
  renderTutorial(true); // eerst de balk, dan de gloed: zo weet toonDoel hoeveel de balk van de kaart bedekt
  zetGloed(stap, tut);
}

// Zet de gloed op het doel van een stap: een tegel op de kaart of een knop in de interface.
function zetGloed(stap, bron) {
  const s = ui.state;
  const d = stap.doel;
  if (!d || !ui.kaart) return;
  if (d.soort === 'knop' && d.knop) {
    bron.knop = d.knop; // panelen worden opnieuw opgebouwd; herstelKnopGloed zet de gloed dan terug
    herstelKnopGloed(bron);
    return;
  }
  ui.kaart.gloed = { t: doelTegel(s, d, bron) };
  toonDoel(ui.kaart.gloed.t);
}

function herstelKnopGloed(bron) {
  if (!bron?.knop) return;
  const el = document.querySelector(bron.knop);
  if (el && !el.classList.contains('tut-gloed')) el.classList.add('tut-gloed');
}

function doelTegel(s, d, bron) {
  const c = speler();
  let land = c.idx;
  if (d.bij === 'buurland') {
    land = buurland(s);
    bron.doelLand = land;
    if (land < 0) land = c.idx;
  } else if (d.bij != null && d.bij !== 'hoofdstad') {
    land = s.landen.find((l) => l.id === d.bij)?.idx ?? c.idx;
  }
  if (d.soort === 'land') return s.pack.geo.hoofdstad[land];
  if (d.soort === 'gebouw') {
    for (const t of s.landTegels[land]) if (s.bezet[t]?.gebouw === d.gebouw) return t;
    return s.pack.geo.hoofdstad[land];
  }
  if (d.soort === 'tegel' && d.gebouw) {
    // Dezelfde keuze als de engine voor de AI: vol rendement, dicht bij de hoofdstad.
    const t = sim.kiesTegel(s, c, d.gebouw);
    return t >= 0 ? t : s.pack.geo.hoofdstad[land];
  }
  return s.pack.geo.hoofdstad[land];
}

// Een buurland voor de contracttip: dezelfde buren als de engine (grens of handelsroute), liefst uit het eigen blok,
// nooit een land waarmee je in oorlog bent.
function buurland(s) {
  const c = speler();
  const landen = leger.buurlanden(s, c).map((i) => s.landen[i]).filter((l) => l && !leger.inOorlog(s, c, l));
  landen.sort((a, b) => (b.blok === c.blok) - (a.blok === c.blok));
  return landen[0]?.idx ?? -1;
}

// Ligt het doel onder de tutorialbalk of buiten beeld, dan kan de speler het niet aanklikken (op de telefoon bedekt
// de balk de hele bovenkant van de kaart). Verschuif dan de camera zodat het doel in het vrije deel staat.
function toonDoel(t) {
  const k = ui.kaart;
  const tg = ui.state.pack.geo.tegels[t];
  if (!tg) return;
  const el = $('#tutorial');
  const cv = k.canvas.getBoundingClientRect();
  const r = el.hidden ? null : el.getBoundingClientRect();
  const balk = r && { l: r.left - cv.left, r: r.right - cv.left, b: r.bottom - cv.top };
  const m = 24;
  const slecht = (x, y) => (balk && x >= balk.l - m && x <= balk.r + m && y <= balk.b + m) || x < m || y < m || x > k.w - m || y > k.h - m;
  if (!slecht(...k.naarScherm(tg.x, tg.y))) return;
  // Waar komt de tegel bij een zoom te staan, met de kaartgrens (KaartView.begrens, wereld 1000×620) meegerekend?
  // Dicht bij een rand kan de camera niet ver genoeg opzij; dan helpt alleen verder inzoomen.
  const bedekt = balk && TELEFOON.matches ? balk.b : 0; // telefoon: balk over de volle breedte
  const plek = (zoom) => {
    const s = Math.min(k.w / 1000, k.h / 620) * zoom; // zoals KaartView.schaal()
    const halfW = k.w / 2 / s, halfH = k.h / 2 / s;
    const wil = { x: tg.x, y: tg.y - (bedekt / 2) / s };
    const cx = halfW >= 500 ? 500 : Math.min(Math.max(wil.x, halfW), 1000 - halfW);
    const cy = halfH >= 310 ? 310 : Math.min(Math.max(wil.y, halfH), 620 - halfH);
    return { wil, x: (tg.x - cx) * s + k.w / 2, y: (tg.y - cy) * s + k.h / 2 };
  };
  let zoom = Math.max(k.zoom, 3);
  while (zoom < 14 && slecht(plek(zoom).x, plek(zoom).y)) zoom = Math.min(14, zoom * 1.4);
  const p = plek(zoom);
  k.vliegNaar(p.wil.x, p.wil.y, zoom);
}

// Gebeurtenissen uit de interface die een stap of tip kunnen afronden: 'klik' (op de kaart), 'tab' (op een tabknop)
// en 'actie' (op een knop met data-actie, zoals 🤝 in de bovenbalk).
function tutorialEvent(soort, data = {}) {
  const { stap, bron } = actieveKaart();
  if (!stap || bron.klaarOp) return;
  const k = stap.klaar || {};
  if (k.ui !== soort) return;
  if (soort === 'klik') {
    if (k.doel === 'hoofdstad' && !(data.b?.hoofdstad && data.b.land === ui.state.speler)) return;
    if (k.doel === 'buurland' && !(data.b?.hoofdstad && data.b.land === bron.doelLand)) return;
  }
  if (soort === 'tab' && k.tab && data.tab !== k.tab) return;
  if (soort === 'actie' && k.actie && data.actie !== k.actie) return;
  bron.gebeurd = soort;
}

// Is de stap of tip klaar? 'ui'-controles komen via tutorialEvent; de rest volgt het voorwaarde-formaat van de doelen,
// met één verschil: een gebouw in aanbouw telt hier al mee, zodat de speler niet op de bouwtijd hoeft te wachten.
function stapKlaar(stap, bron) {
  const s = ui.state;
  const k = stap.klaar || {};
  if (k.of === 'aanbod_weg' && !s.contracten.some((x) => x.status === 'open' && x.b === s.speler)) return true;
  if (k.ui === 'dagen') return s.dag - bron.startDag >= (k.dagen ?? 1);
  if (k.ui) return bron.gebeurd === k.ui;
  if (k.gebouw) {
    const c = speler();
    const n = (c.gebouwen[k.gebouw] || 0) + c.bouw.filter((p) => p.gebouw === k.gebouw).length;
    return n >= (k.minimaal ?? 1);
  }
  return sim.doelVoortgang(s, { voorwaarde: k }) >= 1;
}

function tutorialTick(now) {
  if (!ui.state || ui.state.replay) return;
  if (ui.tutorial) { kaartTick(ui.tutorial, now); return; }
  if (ui.tip) { kaartTick(ui.tip, now); return; }
  tipsTick(now);
}

function kaartTick(bron, now) {
  const { stap } = actieveKaart();
  if (!stap) return;
  const tip = bron === ui.tip;
  if (ui.modal) bron.sinds = now; // de hint-teller loopt niet achter een venster
  if (ui.state.uitkomst) { stopTutorial(false); sluitTip(); return; }
  if (bron.klaarOp) {
    if (now - bron.klaarOp > 1400) { if (tip) sluitTip(); else volgendeStap(); }
    return;
  }
  // Ook achter een venster: een tip die vraagt om 🤝 te openen, is klaar zodra dat venster open is.
  if (stapKlaar(stap, bron)) {
    bron.klaarOp = now;
    stapVerlaten();
    if (stap.doel?.soort === 'tegel' && ui.bouwModus) stopBouwModus(); // de bouwstap is klaar: geen tweede gebouw per ongeluk
    renderTutorial(true);
    return;
  }
  if (ui.modal) return;
  if (tip && now - bron.sinds > TIP_DUUR) { sluitTip(); return; }
  if (tip) { const d = dringendeTip(); if (d) { sluitTip(); startTip(d); return; } } // een aanbod wacht niet op een andere tip
  // Is de gloedtegel intussen bebouwd (door een ander gebouw), kies dan een nieuwe plek.
  const g = ui.kaart?.gloed;
  if (g && stap.doel?.soort === 'tegel' && ui.state.bezet[g.t]) zetGloed(stap, bron);
  herstelKnopGloed(bron);
  renderTutorial(false);
}

// ----- tips op sleutelmomenten (B21) -----

// Het moment waarop een tip verschijnt, per 'wanneer.soort'. Alles wordt afgelezen uit de spelstand; niets wordt erin gezet.
function tipMoment(tip) {
  const s = ui.state;
  const T = ui.tips;
  const w = tip.wanneer || {};
  const mijn = (k) => k.a === s.speler || k.b === s.speler;
  switch (w.soort) {
    case 'contract_aanbod':
      // Wie al een contract heeft lopen of afgerond, kent de knop al.
      if (s.contracten.some((k) => mijn(k) && k.status !== 'open')) return false;
      return s.contracten.some((k) => k.status === 'open' && k.b === s.speler);
    case 'dagen':
      if (s.dag - T.startDag < (w.dagen ?? 60)) return false;
      if (w.zonder === 'contract' && (s.contracten.some(mijn) || T.getoond.contract_aanbod)) return false;
      return true;
    case 'fase':
      return s.faseIdx > T.faseIdx && s.pack.verhaal.fasen[s.faseIdx]?.id === w.fase;
    case 'dreiging': {
      const c = speler();
      const p = leger.partij(s, c);
      if (s.escalaties.slice(T.escalaties).some((x) => x.doel === s.speler && x.blok !== s.spelerBlok)) return true;
      return leger.oorlogenVan(s, c).some((o) => o.aanvaller !== p && o.start >= T.startDag);
    }
  }
  return false;
}

// Een tip met 'dringend' (een aanbod dat verloopt, een dreiging) mag een lopende tip vervangen.
function dringendeTip() {
  const T = ui.tips;
  if (!T) return null;
  const packId = ui.state.pack.meta.id;
  return T.lijst.find((tip) => tip.dringend && !tipGezien(packId, tip.id) && tipMoment(tip)) ?? null;
}

function tipsTick(now) {
  const T = ui.tips;
  if (!T || ui.modal || ui.state.uitkomst) return;
  const rust = T.laatste && now - T.laatste < TIP_ADEM;
  const packId = ui.state.pack.meta.id;
  for (const tip of T.lijst) {
    if ((rust && !tip.dringend) || tipGezien(packId, tip.id) || !tipMoment(tip)) continue;
    startTip(tip);
    return;
  }
}

function startTip(tip) {
  const packId = ui.state.pack.meta.id;
  tipsGezien.add(`${packId}:${tip.id}`);
  onthoud(TIP_SLEUTEL, `${packId}:${tip.id}`);
  if (tip.wanneer?.soort) ui.tips.getoond[tip.wanneer.soort] = true;
  ui.tip = { stap: tip, klaarOp: 0, sinds: performance.now(), startDag: ui.state.dag, gebeurd: null, sleutel: '', doelLand: -1, knop: null };
  renderTutorial(true);
  zetGloed(tip, ui.tip);
}

function sluitTip() {
  if (ui.tip) {
    stapVerlaten();
    if (ui.tips) ui.tips.laatste = performance.now();
  }
  ui.tip = null;
  verbergBalk();
}

function renderTutorial(forceer) {
  const { stap, bron } = actieveKaart();
  const el = $('#tutorial');
  if (!stap) { verbergBalk(); return; }
  const tip = bron === ui.tip;
  const hint = !bron.klaarOp && performance.now() - bron.sinds > 60000;
  const sleutel = `${tip ? 'tip' : bron.idx}|${stap.id}|${bron.klaarOp ? 1 : 0}|${hint ? 1 : 0}`;
  if (!forceer && sleutel === bron.sleutel) return;
  bron.sleutel = sleutel;
  el.hidden = false;
  el.classList.toggle('klaar', !!bron.klaarOp);
  el.classList.toggle('tut-tip', tip); // niet 'tip': die klasse is van de zweeftekst op de kaart (pointer-events: none)
  const kop = tip ? 'Tip' : `Stap ${bron.idx + 1} van ${bron.stappen.length}`;
  const knop = tip ? 'Begrepen ✓' : 'Overslaan ✕';
  el.innerHTML = `<div class="tut-kop"><span>${kop}</span><button class="knop klein" data-tut="stop" title="${tip ? 'Tip sluiten' : 'Tutorial sluiten'}">${knop}</button></div>
    <div class="tut-titel">${bron.klaarOp ? '✓ ' : ''}${esc(stap.titel)}</div>
    <div class="tut-tekst">${esc(stap.tekst || '')}</div>
    ${hint && stap.hint ? `<div class="tut-hint">Tip: ${esc(stap.hint)}</div>` : ''}`;
  schikBouwbalk();
  el.querySelector('[data-tut="stop"]').onclick = () => {
    if (tip) { sluitTip(); return; }
    stopTutorial(true);
    toast('Tutorial gesloten. Een nieuwe partij in dit pack start zonder tutorial.', 'info');
  };
}

// ---------- meldingen ----------

function toast(tekst, soort = 'info') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${soort}`;
  el.textContent = tekst;
  box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => el.remove(), soort === 'fase' ? 9000 : 5000);
}

// Doelbalk, bijna klaar en sessie-overzicht (src/ui/doelen.js): leest alleen, geeft geen orders.
const doelbalk = maakDoelen({ ui, zetTab, selecteer });

// Handig bij playtests en debuggen vanuit de console.
window.machtsbalans = { ui, sim };

// Installeerbare webapp: de service worker houdt het spel offline speelbaar.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // Een geïnstalleerde app die uit de achtergrond terugkomt laadt niet opnieuw; dan zelf naar een nieuwe build vragen.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('Service worker niet geregistreerd:', e));
}

gezondSpelen(toast, () => !!ui.state && !ui.state.replay);
init();
