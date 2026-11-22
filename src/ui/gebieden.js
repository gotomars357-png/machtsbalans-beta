// C17c: je kolonies weer bereiken en bouwen zoals thuis (docs/c17-plan.md, "c17c-gebieden").
//
// Twee delen:
// 1. Puur (geen DOM, draait in node): gebiedenVan, gebiedBij, gebiedNaam en zoalsThuis. Ze lezen de spelstand en
//    veranderen hem nooit.
// 2. maakGebieden(api): de gebiedenknop (⌂) met het lijstje, het onderpaneel 'zoalsthuis', naarGebied en huidig().
//    Een order ontstaat alleen bij "Zet in de wachtrij", via api.geef (geef() in main.js).

import * as sim from '../engine/sim.js';
import { gebiedCentra, gebiedVan, gebiedTegels, magInRij } from '../engine/gebieden.js';
import * as onderpaneel from './onderpaneel.js';

export const NAAR_ZOOM = 4;          // de camera vliegt naar een gebied op minstens deze zoom
export const VERRE_ZOOM = 2;         // verder uitgezoomd telt het laatst gekozen gebied, niet het midden van de camera
export const ICOON_THUIS = '⌂';
export const ICOON_KOLONIE = '🚩';

export const TEKST = {
  thuis: 'Thuis',
  gebouwen: (n) => `${n} ${n === 1 ? 'gebouw' : 'gebouwen'}`,
  vrij: (n) => `${n} vrij`,
  zoalsThuis: 'Bouw zoals thuis',
  zoalsThuisKort: 'Zoals thuis',
  inRij: 'Zet in de wachtrij',
  nietNu: 'Niet nu',
  kop: (naam) => `Bouw zoals thuis in ${naam}`,
  thuisStaan: (lijst) => `Thuis staan: ${lijst}.`,
  passen: (naam, n) => (n ? `In ${naam} ${n === 1 ? 'past nog 1 gebouw' : `passen nog ${n} gebouwen`}.` : `In ${naam} is geen vrij vakje meer.`),
  samen: (k) => `Samen: ${k}`,
  klaar: (d, max) => `Klaar in ongeveer ${d} dagen (${max} tegelijk), als er geld genoeg is.`,
  buffer: 'De wachtrij bouwt vanzelf verder en laat altijd een kwart van je voorraad over.',
  later: (n) => `Daarna ${n === 1 ? 'past er nog 1' : `passen er nog ${n}`}: tik dan opnieuw op Bouw zoals thuis.`,
  niets: 'Er is niets bij te bouwen: de kolonie lijkt al op thuis, of er is geen vrij vakje.',
  geenGrond: (naam, terrein) => `${naam}: geen ${terrein} vrij in deze kolonie`,
  vervangt: (n) => `Dit vervangt de wachtrij die er nu staat (${n} te gaan).`,
  gezet: (n, naam) => `${n} ${n === 1 ? 'gebouw' : 'gebouwen'} in de wachtrij voor ${naam}.`,
};

const spelerVan = (s) => s.landen[s.speler];

// De naam van een gebied: "Thuis" of de naam van de kolonie.
export function gebiedNaam(s, centrum) {
  const k = s.kolonies.find((x) => x.t === centrum && x.land === s.speler);
  return k ? k.naam : TEKST.thuis;
}

// Alle eigen gebieden: [{centrum, naam, thuis, gebouwen, vrij, rij}] (thuis eerst, dan de kolonies op volgorde).
export function gebiedenVan(s) {
  const c = spelerVan(s);
  const centra = gebiedCentra(s, s.speler);
  const uit = centra.map((t, i) => ({ centrum: t, naam: gebiedNaam(s, t), thuis: i === 0 && s.pack.geo.hoofdstad[s.speler] === t, gebouwen: 0, vrij: 0, rij: c.bouwrij?.[t]?.items.length ?? 0 }));
  if (!uit.length) return uit;
  const per = new Map(uit.map((g) => [g.centrum, g]));
  for (let i = 0; i < c.plaatsingen.length; i++) {
    const p = c.plaatsingen[i];
    const g = p.t >= 0 ? per.get(gebiedVan(s, s.speler, p.t, centra)) : uit[0];
    if (g) g.gebouwen += 1;
  }
  const lijst = s.landTegels[s.speler];
  for (let i = 0; i < lijst.length; i++) {
    if (s.bezet[lijst[i]]) continue;
    const g = per.get(gebiedVan(s, s.speler, lijst[i], centra));
    if (g) g.vrij += 1;
  }
  return uit;
}

// Het eigen gebied waarvan het centrum het dichtst bij wereldpunt (x, y) ligt (−1 zonder gebieden).
export function gebiedBij(s, x, y) {
  const centra = gebiedCentra(s, s.speler);
  const tg = s.pack.geo.tegels;
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < centra.length; i++) {
    const d = Math.hypot(tg[centra[i]].x - x, tg[centra[i]].y - y);
    if (d < bd) { bd = d; best = centra[i]; }
  }
  return best;
}

export function isKolonie(s, centrum) {
  return s.kolonies.some((k) => k.t === centrum && k.land === s.speler);
}

// Grootste-restmethode: verdeel n plekken over de gewichten (in volgorde; bij gelijke rest wint de eerste).
export function grootsteRest(gewichten, n) {
  const som = gewichten.reduce((a, b) => a + b, 0);
  if (!som || n <= 0) return gewichten.map(() => 0);
  const exact = gewichten.map((w) => (w * n) / som);
  const uit = exact.map((v) => Math.floor(v + 1e-9));
  let over = n - uit.reduce((a, b) => a + b, 0);
  const volg = exact.map((v, i) => [v - uit[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let j = 0; over > 0 && j < volg.length; j++, over--) uit[volg[j][1]] += 1;
  return uit;
}

const kostTekst = (s, kosten) => Object.entries(kosten).filter(([, v]) => v > 0).map(([r, v]) => `${Math.round(v)}${s.pack.resIndex[r]?.icoon ?? r}`).join(' ');

// "Bouw zoals thuis": de verhouding van wat thuis staat, geschaald naar de vrije plekken in de kolonie.
// → { centrum, naam, thuis: {id: n}, kolonie: {id: n}, passen, doel: {id: n}, erbij: [{gebouw, naam, icoon, aantal, kosten}],
//     items: [id, ...] (de volgorde voor de wachtrij, hoogstens bouwrij_max), later, kanNiet: [{gebouw, reden}],
//     totaal: {r: v}, totaalTekst, dagen, rij } of null als het geen eigen kolonie is.
export function zoalsThuis(s, centrum) {
  const c = spelerVan(s);
  const P = s.pack;
  const M = P.model;
  const centra = gebiedCentra(s, s.speler);
  const thuisC = P.geo.hoofdstad[s.speler];
  if (!isKolonie(s, centrum) || !centra.includes(centrum)) return null;
  const mag = (id) => magInRij(s, id) && sim.isOntgrendeld(s, id);
  const thuis = {};
  const kolonie = {};
  for (let i = 0; i < c.plaatsingen.length; i++) {
    const p = c.plaatsingen[i];
    if (!mag(p.g)) continue;
    const g = p.t >= 0 ? gebiedVan(s, s.speler, p.t, centra) : thuisC;
    if (g === thuisC) thuis[p.g] = (thuis[p.g] || 0) + 1;
    else if (g === centrum) kolonie[p.g] = (kolonie[p.g] || 0) + 1;
  }
  for (let i = 0; i < c.bouw.length; i++) {
    const b = c.bouw[i];
    if (mag(b.gebouw) && gebiedVan(s, s.speler, b.tegel, centra) === centrum) kolonie[b.gebouw] = (kolonie[b.gebouw] || 0) + 1;
  }
  const vrijeTegels = gebiedTegels(s, s.speler, centrum, centra).filter((t) => !s.bezet[t]);
  const passen = vrijeTegels.length;
  const past = (g, t) => !g.terrein || g.terrein.includes(P.geo.tegels[t].terrein);
  // Soorten die thuis staan, in packvolgorde; wat in de kolonie geen grond heeft, telt niet mee in de verhouding.
  const soorten = [];
  const kanNiet = [];
  for (let i = 0; i < P.gebouwen.length; i++) {
    const g = P.gebouwen[i];
    if (!thuis[g.id]) continue;
    if (vrijeTegels.some((t) => past(g, t)) || kolonie[g.id]) soorten.push(g);
    else if (passen) kanNiet.push({ gebouw: g.id, reden: TEKST.geenGrond(g.naam, (g.terrein ?? []).join(' of ')) });
  }
  const bestaand = soorten.reduce((a, g) => a + (kolonie[g.id] || 0), 0);
  const verdeling = grootsteRest(soorten.map((g) => thuis[g.id]), passen + bestaand);
  const doel = {};
  const wil = {};
  soorten.forEach((g, i) => { doel[g.id] = verdeling[i]; wil[g.id] = Math.max(0, verdeling[i] - (kolonie[g.id] || 0)); });
  // Meer gevraagd dan er vrij is (de kolonie heeft al te veel van iets): haal weg bij het grootste aantal.
  let teveel = Object.values(wil).reduce((a, b) => a + b, 0) - passen;
  while (teveel > 0) {
    let k = null;
    for (const g of soorten) if (wil[g.id] > 0 && (!k || wil[g.id] >= wil[k])) k = g.id;
    wil[k] -= 1; teveel -= 1;
  }
  // Volgorde voor de wachtrij: steeds de soort die het verst achterloopt, zodat de verhouding gelijk opgroeit. Lukt
  // dat niet op de echte grond, dan de soorten met de minste geschikte vakjes eerst.
  const volgorde = (lijst) => {
    const gedaan = {};
    const uit = [];
    for (;;) {
      let k = null;
      let kd = Infinity;
      for (const g of lijst) {
        const w = wil[g.id] || 0;
        const n = gedaan[g.id] || 0;
        if (n >= w) continue;
        const deel = n / w; // hoe ver deze soort al is; de laagste is aan de beurt (bij gelijk: de grootste soort)
        if (deel < kd - 1e-9 || (Math.abs(deel - kd) < 1e-9 && w > (wil[k.id] || 0))) { k = g; kd = deel; }
      }
      if (!k) break;
      uit.push(k.id);
      gedaan[k.id] = (gedaan[k.id] || 0) + 1;
    }
    return uit;
  };
  const krapFirst = () => {
    const krap = soorten.slice().sort((a, b) => vrijeTegels.filter((t) => past(a, t)).length - vrijeTegels.filter((t) => past(b, t)).length || P.gebouwen.indexOf(a) - P.gebouwen.indexOf(b));
    const uit = [];
    for (const g of krap) for (let n = 0; n < wil[g.id]; n++) uit.push(g.id);
    return uit;
  };
  // Precies zoals de wachtrij straks plaatst: kiesTegel met gebied, na elkaar, op een kopie van alleen 'bezet'.
  const plaatsNa = (lijst) => {
    const kopie = { ...s, bezet: s.bezet.slice() };
    const ok = [];
    const mis = [];
    for (const id of lijst) {
      const t = sim.kiesTegel(kopie, c, id, centrum);
      if (t < 0) { mis.push(id); continue; }
      kopie.bezet[t] = { land: s.speler, gebouw: id, bouw: true };
      ok.push(id);
    }
    return { ok, mis };
  };
  let plan = plaatsNa(volgorde(soorten));
  if (plan.mis.length) { const b = plaatsNa(krapFirst()); if (b.ok.length > plan.ok.length) plan = b; }
  for (const id of plan.mis) {
    if (kanNiet.some((k) => k.gebouw === id)) continue;
    const g = P.gebouwIndex[id];
    kanNiet.push({ gebouw: id, reden: TEKST.geenGrond(g.naam, (g.terrein ?? ['land']).join(' of ')) });
  }
  const alle = plan.ok;
  const max = M.bouwrij_max ?? 8;
  const items = alle.slice(0, max);
  // Kosten na elkaar (bouwKosten loopt op met elk gebouw van dezelfde soort), op een kopie van alleen de tellers.
  const kloon = { ...c, gebouwen: { ...c.gebouwen }, bouw: c.bouw.slice() };
  const totaal = {};
  const perSoort = {};
  for (const id of items) {
    const k = sim.bouwKosten(s, kloon, id);
    for (const [r, v] of Object.entries(k)) totaal[r] = (totaal[r] || 0) + v;
    (perSoort[id] ??= { aantal: 0, kosten: {} }).aantal += 1;
    for (const [r, v] of Object.entries(k)) perSoort[id].kosten[r] = (perSoort[id].kosten[r] || 0) + v;
    kloon.gebouwen[id] = (kloon.gebouwen[id] || 0) + 1;
  }
  // Dagen: met max_bouw projecten tegelijk, achter wat er nu loopt (zonder te wachten op geld).
  const plekken = [];
  for (let i = 0; i < M.max_bouw; i++) plekken.push(i < c.bouw.length ? Math.max(0, c.bouw[i].klaar - s.dag) : 0);
  for (const id of items) {
    let j = 0;
    for (let i = 1; i < plekken.length; i++) if (plekken[i] < plekken[j]) j = i;
    plekken[j] += P.gebouwIndex[id].bouwtijd ?? 5;
  }
  const erbij = soorten.filter((g) => perSoort[g.id]).map((g) => ({ gebouw: g.id, naam: g.naam, icoon: g.icoon ?? '', aantal: perSoort[g.id].aantal, kosten: perSoort[g.id].kosten }));
  return {
    centrum, naam: gebiedNaam(s, centrum), thuis, kolonie, passen, doel, erbij, items, alle, later: alle.length - items.length, kanNiet,
    totaal, totaalTekst: kostTekst(s, totaal), dagen: items.length ? Math.max(...plekken) : 0, rij: c.bouwrij?.[centrum]?.items.length ?? 0,
  };
}

// ---------- weergave (DOM) ----------

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function zoalsThuisHtml(s, z) {
  const P = s.pack;
  const thuisLijst = Object.keys(z.thuis).map((id) => `${z.thuis[id]}× ${P.gebouwIndex[id].naam}`).join(', ');
  let h = `<div class="zt-kop"><b>${esc(TEKST.kop(z.naam))}</b><button type="button" class="zt-dicht" data-zt="sluit" aria-label="Sluiten">✕</button></div>`;
  h += `<p class="zt-zin">${esc(TEKST.thuisStaan(thuisLijst || '—'))} ${esc(TEKST.passen(z.naam, z.passen))}</p>`;
  if (z.items.length) {
    h += `<ul class="zt-lijst">${z.erbij.map((e) => `<li><span class="zt-ico" aria-hidden="true">${e.icoon}</span><span class="zt-naam">${e.aantal}× ${esc(e.naam)}</span><span class="zt-kost">${esc(kostTekst(s, e.kosten))}</span></li>`).join('')}</ul>`;
    h += `<p class="zt-zin"><b>${esc(TEKST.samen(z.totaalTekst))}</b> · ${esc(TEKST.klaar(z.dagen, P.model.max_bouw))}</p>`;
    if (z.later > 0) h += `<p class="zt-zin zacht">${esc(TEKST.later(z.later))}</p>`;
  } else h += `<p class="zt-zin">${esc(TEKST.niets)}</p>`;
  if (z.kanNiet.length) h += `<p class="zt-zin zacht">${z.kanNiet.map((k) => esc(k.reden)).join(' · ')}</p>`;
  h += `<p class="zt-zin zacht">${esc(TEKST.buffer)}${z.rij ? ` ${esc(TEKST.vervangt(z.rij))}` : ''}</p>`;
  h += `<div class="zt-knoppen"><button type="button" class="knop zt-ja" data-zt="ja"${z.items.length && !s.replay ? '' : ' disabled'}>${esc(TEKST.inRij)}</button>`
    + `<button type="button" class="knop zt-nee" data-zt="sluit">${esc(TEKST.nietNu)}</button></div>`;
  return h;
}

// api uit main.js: { ui, bouwlade, geef, toast }.
export function maakGebieden(api) {
  const { ui } = api;
  const $ = (q) => document.querySelector(q);
  const wrap = $('#kaart-wrap');
  const knop = $('[data-kaart="thuis"]');
  const gb = { gekozen: -1, laatst: -1, open: false, paneel: -1 };
  if (!wrap || !knop) return null;

  const tel = document.createElement('span');
  tel.className = 'gb-tel';
  tel.setAttribute('aria-hidden', 'true');
  knop.append(tel);
  const lijst = document.createElement('div');
  lijst.id = 'gebieden-lijst';
  lijst.className = 'gebieden-lijst';
  lijst.hidden = true;
  lijst.setAttribute('role', 'menu');
  wrap.append(lijst);
  const paneel = document.createElement('div');
  paneel.id = 'zoalsthuis';
  paneel.className = 'zoalsthuis';
  paneel.hidden = true;
  document.body.append(paneel);

  const s = () => ui.state;
  const kolonies = () => { const st = s(); return st ? st.kolonies.filter((k) => k.land === st.speler).length : 0; };
  const meld = (centrum, bron) => window.dispatchEvent(new CustomEvent('gebied', { detail: { centrum, naam: gebiedNaam(s(), centrum), bron } }));

  // Het gebied dat je bekijkt: het centrum het dichtst bij het midden van het vrije deel van de kaart. Ver uitgezoomd
  // of tijdens een vlucht het laatst gekozen gebied (zo kiest de wereldkaart niet per ongeluk een kolonie).
  gb.huidig = () => {
    const st = s();
    const k = ui.kaart;
    if (!st) return -1;
    const centra = gebiedCentra(st, st.speler);
    if (!centra.length) return -1;
    const gekozen = centra.includes(gb.gekozen) ? gb.gekozen : centra[0];
    if (centra.length === 1 || !k || !k.w || k.doel || (k.zoom ?? 1) < VERRE_ZOOM) return gekozen;
    const onder = Math.max(0, Math.min(k.zichtOnder || 0, k.h * 0.8));
    const [x, y] = k.naarWereld(k.w / 2, (k.h - onder) / 2);
    return gebiedBij(st, x, y);
  };

  gb.naarGebied = (centrum, bron = 'wissel') => {
    const st = s();
    const k = ui.kaart;
    if (!st || !gebiedCentra(st, st.speler).includes(centrum)) return false;
    gb.gekozen = centrum;
    gb.sluitLijst();
    if (api.bouwlade?.stand === 'plaats') api.bouwlade.zetGebied(centrum); // het voorbeeld en de camera naar de beste plek daar
    else if (k) {
      const tg = st.pack.geo.tegels[centrum];
      k.vliegNaar(tg.x, tg.y, Math.max(k.zoom ?? 1, NAAR_ZOOM));
      api.bouwlade?.zetGebied?.(centrum);
    }
    if (gb.laatst !== centrum) { gb.laatst = centrum; meld(centrum, bron); }
    ui.dirty = true;
    return true;
  };

  // Desktop: zonder lade de camera naar het bekeken gebied (in plaats van altijd naar de hoofdstad).
  gb.vliegNaarHuidig = (zoom) => {
    const st = s();
    const k = ui.kaart;
    const c = gb.huidig();
    if (!st || !k || c < 0) return;
    const tg = st.pack.geo.tegels[c];
    k.vliegNaar(tg.x, tg.y, Math.max(k.zoom ?? 1, zoom));
  };

  function lijstHtml() {
    const st = s();
    const nu = gb.huidig();
    return gebiedenVan(st).map((g) => {
      const sub = [TEKST.gebouwen(g.gebouwen), g.thuis ? '' : TEKST.vrij(g.vrij), g.rij ? `wachtrij ${g.rij}` : ''].filter(Boolean).join(' · ');
      return `<div class="gb-rij${g.centrum === nu ? ' nu' : ''}">`
        + `<button type="button" class="gb-naar" data-gb="naar" data-id="${g.centrum}" role="menuitem"><span class="gb-ico" aria-hidden="true">${g.thuis ? ICOON_THUIS : ICOON_KOLONIE}</span>`
        + `<span class="gb-tekst"><b>${esc(g.naam)}</b><span class="zacht">${esc(sub)}</span></span></button>`
        + `${g.thuis || st.replay ? '' : `<button type="button" class="gb-zoals" data-gb="zoals" data-id="${g.centrum}" title="${TEKST.zoalsThuis}">${TEKST.zoalsThuisKort}</button>`}`
        + `</div>`;
    }).join('');
  }

  function plaatsLijst(bij) {
    const w = wrap.getBoundingClientRect();
    const r = (bij ?? knop).getBoundingClientRect();
    if (bij && bij !== knop) {
      // Vanuit de lade ("Bouwen in: …"): boven de lade, links uitgelijnd.
      lijst.style.right = '';
      lijst.style.left = `${Math.max(8, r.left - w.left)}px`;
      lijst.style.bottom = `${Math.max(8, w.bottom - r.top + 6)}px`;
    } else {
      lijst.style.left = '';
      lijst.style.right = `${Math.max(8, w.right - r.left + 6)}px`;
      lijst.style.bottom = `${Math.max(8, w.bottom - r.bottom)}px`;
    }
  }

  gb.openLijst = (bij = null) => {
    if (!s()) return;
    gb.html = lijstHtml();
    lijst.innerHTML = gb.html;
    lijst.hidden = false;
    gb.open = true;
    plaatsLijst(bij);
    knop.classList.add('open');
  };
  gb.sluitLijst = () => { lijst.hidden = true; gb.open = false; knop.classList.remove('open'); };

  // De ⌂-knop: zonder kolonies naar de hoofdstad (zoals altijd), met kolonies het lijstje.
  gb.wissel = (bij = knop) => {
    if (!kolonies()) { ui.kaart?.naarLand(s().speler); return; }
    if (gb.open) gb.sluitLijst(); else gb.openLijst(bij);
  };

  lijst.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gb]');
    if (!b) return;
    const id = +b.dataset.id;
    if (b.dataset.gb === 'naar') gb.naarGebied(id);
    if (b.dataset.gb === 'zoals') { gb.sluitLijst(); gb.naarGebied(id); gb.openZoalsThuis(id); }
  });
  // Ergens anders tikken sluit het lijstje (de knop zelf en de "Bouwen in"-regel wisselen het).
  document.addEventListener('pointerdown', (e) => {
    if (!gb.open || lijst.contains(e.target) || knop.contains(e.target) || e.target.closest?.('[data-lade="gebied"]')) return;
    gb.sluitLijst();
  }, true);

  // ---------- het onderpaneel "Bouw zoals thuis" ----------
  const sluitPaneel = () => { paneel.hidden = true; paneel.innerHTML = ''; gb.paneel = -1; };
  gb.openZoalsThuis = (centrum) => {
    const st = s();
    const z = st && zoalsThuis(st, centrum);
    if (!z) return false;
    gb.sluitLijst();
    onderpaneel.open('zoalsthuis', sluitPaneel);
    gb.paneel = centrum;
    gb.z = z;
    paneel.innerHTML = zoalsThuisHtml(st, z);
    paneel.hidden = false;
    return true;
  };
  gb.sluitZoalsThuis = () => { if (gb.paneel < 0) return; sluitPaneel(); onderpaneel.sluit('zoalsthuis'); };
  paneel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-zt]');
    if (!b || b.disabled) return;
    if (b.dataset.zt === 'sluit') { gb.sluitZoalsThuis(); return; }
    if (b.dataset.zt === 'ja') {
      const st = s();
      const z = zoalsThuis(st, gb.paneel); // opnieuw: de stand kan intussen veranderd zijn
      if (!z?.items.length) { gb.sluitZoalsThuis(); return; }
      const r = api.geef({ type: 'bouwrij', gebied: z.centrum, items: z.items }) ?? { ok: false };
      gb.sluitZoalsThuis();
      if (r.ok) api.toast?.(TEKST.gezet(z.items.length, z.naam), 'goed');
    }
  });

  // Getal op de knop, het lijstje bijwerken en 'gebied' {bron:'camera'} als je zelf naar een ander gebied schuift.
  gb.render = () => {
    const st = s();
    const n = st ? kolonies() : 0;
    const t = n ? String(n + 1) : '';
    if (tel.textContent !== t) tel.textContent = t;
    knop.title = n ? 'Gebieden: thuis en je kolonies' : 'Naar je eigen land (H)';
    knop.setAttribute('aria-label', n ? 'Gebieden' : 'Naar je eigen land');
    if (!st) return;
    if (!n && gb.open) gb.sluitLijst();
    if (gb.open) { const h = lijstHtml(); if (gb.html !== h) { gb.html = h; lijst.innerHTML = h; } }
    const nu = gb.huidig();
    if (nu >= 0 && nu !== gb.laatst) {
      const eerste = gb.laatst < 0;
      gb.laatst = nu;
      ui.dirty = true; // de regel "Bouwen in: …" in de lade
      if (!eerste) meld(nu, 'camera');
    }
  };
  setInterval(() => { try { gb.render(); } catch (e) { console.warn('gebieden', e); } }, 400);
  window.addEventListener('gebied', (e) => { if (e.detail?.bron === 'lade') gb.laatst = e.detail.centrum; });

  return gb;
}
