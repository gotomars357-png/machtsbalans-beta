// Eindoverzicht: score met opbouw, hoogtepunten, productiegrafiek, jouw beste zet, speltestvragen en de dagelijkse uitdaging.
// De afleidingen (hoogtepunten, beste zet, speltestrecord) zijn pure functies van de eindtoestand; alleen
// toonEindoverzicht en de sessiemeting raken de browser. De engine wordt hier alleen gelezen.

import { maakReplay } from '../engine/sim.js';
import { tekenGrafiek } from './chart.js';
import { berekenScore } from './score.js';
import { bewaarResultaat, deelTekst, kopieer, datumTekst, vernieuwUitdaging } from './uitdaging.js';

const SPELTEST_SLEUTEL = 'machtsbalans.speltest';
const UUR = 3600;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
const pct = (n) => `${(n * 100).toFixed(0)}%`;
const klein = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const vanSpeler = (state, o) => o.land == null || o.land === state.speler;

// ---------- sessie: echte tijd, gemeten in de browser ----------

const sessie = { start: null, eersteKlik: null, speeltijd: 0, laatste: null, uurGemeld: false };
const nu = () => performance.now();

export function startSessie() { sessie.start = nu(); sessie.eersteKlik = null; }
export function kaartGeklikt() { if (sessie.start != null && sessie.eersteKlik == null) sessie.eersteKlik = nu(); }
const seconden = (tot) => (sessie.start == null || tot == null ? null : Math.round((tot - sessie.start) / 100) / 10);

// Gezond spelen (beleving §9): na een uur echte speeltijd één rustige melding per sessie.
export function gezondSpelen(toast, actief) {
  setInterval(() => {
    const t = nu();
    const telt = actief() && document.visibilityState === 'visible';
    if (telt && sessie.laatste != null) sessie.speeltijd += Math.min(60, (t - sessie.laatste) / 1000);
    sessie.laatste = telt ? t : null;
    if (!sessie.uurGemeld && sessie.speeltijd >= UUR) {
      sessie.uurGemeld = true;
      toast('Je speelt al een uur. Opslaan kan altijd via het menu.', 'info');
    }
  }, 15000);
}

// ---------- hoogtepunten ----------

function actieNaam(state, lijst, id) { return state.pack.acties[lijst]?.find((a) => a.id === id)?.naam ?? id; }

// Korte, leesbare beschrijving van een order van de speler.
export function orderTekst(state, o) {
  const P = state.pack;
  const land = (i) => state.landen[i]?.naam ?? '?';
  const metDoel = (naam) => (o.doel != null ? `${naam} in ${land(o.doel)}` : naam);
  switch (o.type) {
    case 'bouw': return `${P.gebouwIndex?.[o.gebouw]?.naam ?? o.gebouw} gebouwd`;
    case 'hefboom': return metDoel(actieNaam(state, 'hefbomen', o.actie));
    case 'media': return metDoel(actieNaam(state, 'media', o.actie));
    case 'overname': return metDoel(actieNaam(state, 'overname', o.actie));
    case 'netwerk': return metDoel(actieNaam(state, 'netwerken', o.actie));
    case 'escalatie': return `${actieNaam(state, 'escalatie', o.actie)} tegen ${land(o.doel)}`;
    case 'campagne': return `Campagne: ${actieNaam(state, 'campagnes', o.actie).toLowerCase()}`;
    case 'hervorming': return `Staatshervorming naar ${P.regimes?.[o.naar]?.naam?.toLowerCase() ?? o.naar}`;
    case 'contract': return 'Een handelscontract';
    case 'train': return `${P.eenhedenIndex?.[o.eenheid]?.naam ?? 'Eenheid'} opgeleid`;
    case 'beleid': return 'Belasting of verdeling bijgesteld';
    case 'deescalatie': return 'De-escalatie';
    default: return o.type;
  }
}

// 5 tot 8 momenten uit orders en logboek, op volgorde van dag. Het logboek bewaart de laatste 400 regels;
// orders zijn volledig, dus de vroege mijlpalen komen uit de orders.
export function hoogtepunten(state) {
  const P = state.pack;
  const blokNaam = state.blokken.find((b) => b.id === state.spelerBlok)?.naam ?? '';
  const speler = state.landen[state.speler];
  const gevonden = new Map();
  const zet = (id, prio, dag, tekst) => { if (!gevonden.has(id)) gevonden.set(id, { id, prio, dag, tekst }); };

  for (let i = 0; i < state.orders.length; i++) {
    const o = state.orders[i];
    if (!vanSpeler(state, o)) continue;
    if (o.type === 'bouw') {
      zet('eerste-bouw', 2, o.dag, `Eerste bouwopdracht: ${klein(orderTekst(state, o).replace(/ gebouwd$/, ''))}`);
      if (P.gebouwIndex?.[o.gebouw]?.categorie === 'leger') zet('kazerne', 5, o.dag, `Eerste ${P.gebouwIndex[o.gebouw].naam.toLowerCase()} gebouwd`);
    }
    if (o.type === 'hefboom') zet('invloed', 4, o.dag, `Eerste invloed: ${klein(orderTekst(state, o))}`);
    if (o.type === 'media') zet('media', 3, o.dag, `Eerste mediazet: ${klein(orderTekst(state, o))}`);
    if (o.type === 'train') zet('leger', 3, o.dag, `Eerste eenheid: ${klein(orderTekst(state, o))}`);
  }
  for (let i = 0; i < state.log.length; i++) {
    const { dag, tekst, soort } = state.log[i];
    if (blokNaam && soort === 'goed' && (tekst.includes(`sluit zich aan bij ${blokNaam}`) || tekst.includes(`zonder één schot voor ${blokNaam}`))) zet('aansluiting', 9, dag, tekst);
    else if (tekst.includes('verklaart') && tekst.includes('de oorlog') && ((blokNaam && tekst.includes(blokNaam)) || tekst.includes(speler.naam))) zet('oorlog', 9, dag, tekst.split('.')[0] + '.');
    else if (tekst.startsWith('Kolonie gesticht')) zet('kolonie', 8, dag, 'Kolonie gesticht overzee');
    else if (tekst.startsWith('Verkiezingen gewonnen')) zet('verkiezing', 7, dag, 'Verkiezingen gewonnen: nieuw mandaat');
    else if (tekst.includes('ontmaskerd') && tekst.includes('epnieuws')) zet('nepnieuws', 7, dag, tekst);
    else if (tekst.startsWith(`Staatshervorming: ${speler.naam}`)) zet('hervorming', 6, dag, tekst);
    else if (tekst.includes('capituleert')) zet('capitulatie', 8, dag, tekst);
    else if (soort === 'fase' && tekst.startsWith('Nieuwe fase:')) zet(`fase-${dag}`, 1, dag, tekst.split('.')[0]);
  }
  let lijst = [...gevonden.values()].sort((a, b) => b.prio - a.prio || a.dag - b.dag).slice(0, 7);
  if (state.uitkomst) lijst.push({ id: 'einde', prio: 10, dag: state.uitkomst.dag, tekst: state.uitkomst.spelerWint ? `Overwinning: ${state.uitkomst.reden.toLowerCase()}` : `Nederlaag: ${state.uitkomst.reden.toLowerCase()}` });
  return lijst.sort((a, b) => a.dag - b.dag || a.prio - b.prio).map(({ dag, tekst, id }) => ({ dag, tekst, id }));
}

// ---------- jouw beste zet ----------

const ZET_GEWICHT = { overname: 9, hefboom: 8, media: 7, netwerk: 7, contract: 6, escalatie: 6, campagne: 5, hervorming: 5, bouw: 3, train: 2 };

// Grootste stijging van het blokaandeel binnen ongeveer 30 dagen, met de zwaarste order kort daarvoor of tijdens.
export function besteZet(state) {
  const g = state.geschiedenis;
  const W = 6; // geschiedenis is per 5 dagen: 6 stappen = 30 dagen
  const a = (i) => g[i]?.aandelen?.[state.spelerBlok] ?? 0;
  let best = null;
  for (let i = 0; i + 1 < g.length; i++) {
    const j = Math.min(g.length - 1, i + W);
    const d = a(j) - a(i);
    if (!best || d > best.d) best = { d, i, j };
  }
  if (!best || best.d < 0.005) return null;
  const van = g[best.i].dag, tot = g[best.j].dag;
  let order = null;
  for (let k = 0; k < state.orders.length; k++) {
    const o = state.orders[k];
    if (!vanSpeler(state, o) || o.dag < van - 60 || o.dag > tot || !ZET_GEWICHT[o.type]) continue;
    if (!order || ZET_GEWICHT[o.type] > ZET_GEWICHT[order.type]) order = o;
  }
  return { vanDag: van, totDag: tot, van: a(best.i), tot: a(best.j), order, tekst: order ? orderTekst(state, order) : null };
}

export function ordersPerType(state) {
  const n = {};
  for (let i = 0; i < state.orders.length; i++) { const o = state.orders[i]; if (vanSpeler(state, o)) n[o.type] = (n[o.type] ?? 0) + 1; }
  return n;
}

// ---------- speltestrecord (blueprint §10) ----------
// Vast formaat; de analyse leest dit uit localStorage 'machtsbalans.speltest' of uit een gedownload testverslag.

export function maakSpeltestRecord(state, { score, opgeslagen, sessieSeconden = null, eersteKaartklikSeconden = null, antwoorden = {} }) {
  const u = state.uitkomst ?? {};
  return {
    versie: 1,
    opgeslagen,
    pack: state.pack.meta.id,
    land: state.landen[state.speler].id,
    seed: state.instellingen.seed,
    moeilijkheid: state.instellingen.moeilijkheid,
    dag: state.dag,
    spelerWint: !!u.spelerWint,
    reden: u.reden ?? null,
    score,
    sessieSeconden,
    ordersPerType: ordersPerType(state),
    eersteKaartklikSeconden,
    antwoorden: { besteZet: antwoorden.besteZet ?? '', onduidelijk: antwoorden.onduidelijk ?? '', nogEens: antwoorden.nogEens ?? null },
  };
}

export function leesSpeltest() {
  try { const v = JSON.parse(localStorage.getItem(SPELTEST_SLEUTEL) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

// Voegt toe, of vervangt het record met dezelfde `opgeslagen`-tijd (nogmaals Opslaan in hetzelfde scherm).
function bewaarSpeltest(record) {
  const lijst = leesSpeltest();
  const i = lijst.findIndex((r) => r.opgeslagen === record.opgeslagen);
  if (i >= 0) lijst[i] = record; else lijst.push(record);
  try { localStorage.setItem(SPELTEST_SLEUTEL, JSON.stringify(lijst)); return true; } catch { return false; }
}

// ---------- het scherm ----------

// ctx: { openModal, sluitModal, naarStart, download, toast } uit main.js.
export function toonEindoverzicht(state, ctx) {
  const u = state.uitkomst;
  const c = state.landen[state.speler];
  const b = state.blokken.find((x) => x.id === state.spelerBlok);
  const score = berekenScore(state);
  const punten = hoogtepunten(state);
  const zet = besteZet(state);
  const replay = !!state.replayDoel;
  const sessieSeconden = seconden(nu());
  const eersteKlik = seconden(sessie.eersteKlik);
  const startY = state.geschiedenis[0]?.Y ?? c.Y;
  const datum = !replay && state.instellingen.uitdaging;
  let top = null;
  if (datum) {
    top = bewaarResultaat(datum, { id: `${state.instellingen.seed}-${u.dag}-${state.orders.length}-${score.totaal}`, score: score.totaal, dag: u.dag, spelerWint: !!u.spelerWint, zonderOorlog: score.zonderOorlog, opgeslagen: new Date().toISOString() });
  }
  const mijnId = datum ? `${state.instellingen.seed}-${u.dag}-${state.orders.length}-${score.totaal}` : null;

  const zetHtml = zet
    ? `<p>Tussen dag ${zet.vanDag} en ${zet.totDag} steeg het aandeel van ${esc(b.naam)} van ${pct(zet.van)} naar ${pct(zet.tot)}.${zet.tekst ? ` Jouw zet toen: <b>${esc(zet.tekst)}</b>.` : ''}</p>`
    : '<p class="zacht">Geen duidelijke sprong in je aandeel. Probeer volgende keer eerder invloed te kopen.</p>';

  ctx.openModal(`<div class="einde">
    <h2>${u.spelerWint ? 'Overwinning' : 'Nederlaag'} · dag ${u.dag}</h2><div class="titel">${esc(u.reden)}</div><p>${esc(u.tekst)}</p>
    <div class="einde-score">
      <div class="einde-totaal"><span class="zacht">Score</span><b class="num">${score.totaal}</b>${score.spelerWint && score.zonderOorlog ? '<span class="goed">zonder oorlog</span>' : ''}</div>
      <div class="einde-opbouw">${score.regels.map((r) => `<span>${esc(r.label)}</span><span class="num">${r.waarde >= 0 ? '+' : '−'}${Math.abs(r.waarde)}</span>`).join('')}</div>
    </div>
    ${datum ? `<div class="einde-uitdaging">
      <div class="uitdaging-kop"><span>Uitdaging ${datumTekst(datum)}</span><button class="knop klein" id="e-deel">Deel</button></div>
      <ol class="einde-top">${top.map((r) => `<li class="${r.id === mijnId ? 'jij' : ''}"><span class="num">${r.score}</span> <span class="zacht">${r.spelerWint ? 'gewonnen' : 'verloren'} op dag ${r.dag}${r.spelerWint && r.zonderOorlog ? ', zonder oorlog' : ''}</span></li>`).join('')}</ol>
      <p class="zacht">Jouw beste scores van deze dag, alleen in deze browser.</p>
    </div>` : ''}
    <h3>Hoogtepunten</h3>
    <ol class="einde-tijdlijn">${punten.map((p) => `<li><span class="num">dag ${p.dag}</span><span>${esc(p.tekst)}</span></li>`).join('')}</ol>
    <h3>Productie en aandeel</h3>
    <canvas class="einde-grafiek" id="e-grafiek"></canvas>
    <div class="einde-zet"><b>Jouw beste zet</b>${zetHtml}</div>
    <div class="eind-stats">
      <span class="zacht">Productie</span><span class="num">${fmt(startY)} → ${fmt(c.Y)} (×${(c.Y / (startY || 1)).toFixed(1)})</span>
      <span class="zacht">Aandeel blok</span><span class="num">${pct(b.aandeel)}</span>
      <span class="zacht">Landen in blok</span><span class="num">${b.leden}</span>
      <span class="zacht">Orders</span><span class="num">${state.orders.length}</span>
    </div>
    ${replay ? '' : `<details class="einde-speltest" open>
      <summary>Speltest: drie korte vragen (mag je overslaan)</summary>
      <label>Wat was je beste zet?<textarea id="st-zet" rows="2" maxlength="600"></textarea></label>
      <label>Wat was onduidelijk?<textarea id="st-onduidelijk" rows="2" maxlength="600"></textarea></label>
      <div class="st-nogeens"><span>Zou je nog een keer spelen?</span>
        ${['ja', 'misschien', 'nee'].map((v) => `<label><input type="radio" name="st-nogeens" value="${v}"> ${v}</label>`).join('')}
      </div>
      <div class="st-knoppen"><button class="knop" id="st-opslaan">Opslaan</button><button class="knop" id="st-download">Testverslag downloaden</button></div>
    </details>`}
    <div class="keuzes">
      <button class="knop" id="e-replay">Replay downloaden</button>
      <button class="knop" id="e-kijk">Kaart bekijken</button>
      <button class="knop primair" id="e-start">Naar start</button>
    </div></div>`, (el) => {
    const q = (s) => el.querySelector(s);
    const opgeslagen = new Date().toISOString();
    const record = () => maakSpeltestRecord(state, {
      score: score.totaal, opgeslagen, sessieSeconden, eersteKaartklikSeconden: eersteKlik,
      antwoorden: {
        besteZet: q('#st-zet').value.trim(),
        onduidelijk: q('#st-onduidelijk').value.trim(),
        nogEens: q('input[name="st-nogeens"]:checked')?.value ?? null,
      },
    });
    let bewaard = false;
    q('#e-replay').onclick = () => ctx.download(state.replayDoel ?? maakReplay(state), `machtsbalans-${state.pack.meta.id}-dag${state.dag}.json`);
    q('#e-kijk').onclick = ctx.sluitModal;
    q('#e-start').onclick = () => { ctx.naarStart(); vernieuwUitdaging(); };
    if (datum) {
      q('#e-deel').onclick = async () => {
        const tekst = deelTekst(datum, { spelerWint: u.spelerWint, dag: u.dag, score: score.totaal, zonderOorlog: score.zonderOorlog });
        ctx.toast((await kopieer(tekst)) ? 'Gekopieerd. Plak het waar je wilt.' : `Kopiëren lukte niet: ${tekst}`, 'info');
      };
    }
    if (!replay) {
      q('#st-opslaan').onclick = () => {
        bewaard = bewaarSpeltest(record());
        ctx.toast(bewaard ? 'Bedankt! Je antwoorden zijn bewaard in deze browser.' : 'Bewaren lukt niet in deze browser. Download het testverslag.', bewaard ? 'goed' : 'slecht');
        if (bewaard) q('#st-opslaan').textContent = 'Opgeslagen ✓';
      };
      // Het verslag bevat alle bewaarde records; is dit potje nog niet bewaard, dan gaat het wel mee in het bestand.
      q('#st-download').onclick = () => {
        const lijst = leesSpeltest();
        if (!lijst.some((r) => r.opgeslagen === opgeslagen)) lijst.push(record());
        ctx.download({ speltest: lijst, replay: maakReplay(state) }, `machtsbalans-testverslag-${state.pack.meta.id}-dag${state.dag}.json`);
      };
    }
    requestAnimationFrame(() => {
      const g = state.geschiedenis;
      tekenGrafiek(q('#e-grafiek'), {
        xs: g.map((h) => h.dag),
        reeksen: [
          { label: 'Productie', kleur: '#f0b429', dik: true, waarden: g.map((h) => h.Y), formaat: (v) => fmt(v) },
          { label: `Aandeel ${b.naam}`, kleur: '#7fb2ff', as: 'rechts', waarden: g.map((h) => (h.aandelen?.[state.spelerBlok] ?? 0) * 100), formaat: (v) => `${v.toFixed(0)}%` },
        ],
      });
    });
  });
}
