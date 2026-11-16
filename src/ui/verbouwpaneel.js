// Verbouwen en slopen in het contextpaneel (C15c). Alleen HTML-tekst: de knoppen geven via main.js de orders
// {type:'verbouw', tegel} en {type:'sloop', tegel}. Slopen vraagt een tweede tik (bevestig = de tegel die wacht).
// Alle getallen komen uit de engine (verbouwStatus, sloopStatus) en model.verbouw, zodat paneel en spel gelijk lopen.

import { verbouwStatus, sloopStatus, niveauVan, isVerbouwbaar, verbouwModel } from '../engine/verbouw.js';

const ESC = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dagen = (n) => `${n} ${n === 1 ? 'dag' : 'dagen'}`;
const procent = (f) => `${f >= 0 ? '+' : ''}${Math.round(f * 100)}%`;

function eigenMeter(waarde, kleur) {
  return `<div class="voortgang" style="height:6px"><div style="width:${Math.max(0, Math.min(100, waarde)).toFixed(0)}%;background:${kleur}"></div></div>`;
}

export function niveauBolletjes(niveau, max) {
  let h = '';
  for (let i = 1; i <= max; i++) h += `<span class="${i <= niveau ? 'aan' : ''}"></span>`;
  return `<div class="niveau-bolletjes" aria-label="Niveau ${niveau} van ${max}">${h}<b>Niveau ${niveau} van ${max}</b></div>`;
}

function opbrengstTekst(state, opbrengst) {
  const geld = state.pack.rollen.geld;
  const delen = Object.entries(opbrengst).sort(([a], [b]) => (a === geld ? -1 : b === geld ? 1 : 0))
    .map(([r, v]) => `+${v} ${(state.pack.resIndex[r]?.naam ?? r).toLowerCase()}`);
  return delen.length ? `${delen.join(', ')} terug` : 'niets terug';
}

// Het blok onder een eigen, afgebouwd gebouw: niveau, Verbouwen met kosten en terugverdientijd, en Slopen.
export function verbouwBlok(state, t, { esc = ESC, kostenTekst, bevestig = null, meter = eigenMeter } = {}) {
  const V = verbouwModel(state);
  if (!V || !state.instellingen.systemen?.verbouw) return '';
  const c = state.landen[state.speler];
  const p = c.plaatsingen.find((x) => x.t === t);
  if (!p) return '';
  const g = state.pack.gebouwIndex[p.g];
  const niveau = niveauVan(p);
  const kosten = kostenTekst ?? ((k) => Object.entries(k).map(([r, v]) => `${v} ${r}`).join(' '));
  let h = `<h3 style="margin-top:10px">Verbouwen</h3>`;
  if (isVerbouwbaar(g)) h += niveauBolletjes(niveau, V.niveau_max);
  if (p.verbouw) {
    const n = Math.max(0, p.verbouw.klaar - state.dag);
    const voortgang = (state.dag - p.verbouw.start) / Math.max(1, p.verbouw.klaar - p.verbouw.start);
    h += `<div style="font-size:12px;margin:4px 0">Verbouwing naar niveau ${p.verbouw.naar}, nog ${dagen(n)}. Draait zolang op halve kracht.</div>${meter(voortgang * 100, 'var(--accent)')}`;
  } else if (!isVerbouwbaar(g)) {
    h += `<div class="zacht" style="font-size:12px">${esc(g.naam)} kun je niet verbouwen.</div>`;
  } else {
    const st = verbouwStatus(state, state.speler, t);
    if (st.max) {
      h += `<div class="zacht" style="font-size:12px">Hoogste niveau bereikt.</div>`;
    } else if (st.naar) {
      const effect = V.effect[st.naar - 1] / V.effect[niveau - 1] - 1;
      const verbruik = V.verbruik[st.naar - 1] / V.verbruik[niveau - 1] - 1;
      const sub = [`${procent(effect)} effect`];
      if (g.verbruik) sub.push(`${procent(verbruik)} verbruik`);
      sub.push(`${dagen(st.dagen)}, draait zolang op halve kracht`);
      if (st.terug != null) sub.push(`terugverdiend in ongeveer ${dagen(st.terug)}`);
      h += `<div class="actie"><div><b>Naar niveau ${st.naar}</b></div>
        <button class="knop klein" data-actie="verbouw" data-tegel="${t}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? `Verbouwen naar niveau ${st.naar}`)}">Verbouwen · ${kosten(st.kosten)}</button>
        <div class="sub">${esc(sub.join(' · '))}${st.ok ? '' : ` · <span class="slecht">${esc(st.reden)}</span>`}</div></div>`;
    } else {
      h += `<div class="zacht" style="font-size:12px">${esc(st.reden)}</div>`;
    }
  }
  const ss = sloopStatus(state, state.speler, t);
  const wacht = ss.ok && bevestig === t;
  const waarschuwing = ss.stabiliteit ? ` · <span class="slecht">kost stabiliteit (${ss.stabiliteit.waarde} voor ${dagen(ss.stabiliteit.dagen)})</span>` : '';
  h += `<div class="actie"><div><b>Slopen</b></div>
    <button class="knop klein sloop${wacht ? ' bevestig' : ''}" data-actie="sloop" data-tegel="${t}" ${ss.ok ? '' : 'disabled'} title="${esc(ss.reden ?? 'Slopen')}">${wacht ? 'Zeker? Tik nogmaals' : `Slopen · ${esc(opbrengstTekst(state, ss.opbrengst ?? {}))}`}</button>
    <div class="sub">${ss.reden && !ss.ok ? `<span class="slecht">${esc(ss.reden)}</span>` : `Na ${dagen(ss.dagen ?? V.sloop_dagen)} is de grond weer vrij${waarschuwing}`}</div></div>`;
  return h;
}

// Het paneel van een sloopplaats.
export function sloopplaatsBlok(state, t) {
  const b = state.bezet[t];
  if (!b?.sloop) return '';
  const n = Math.max(0, b.klaar - state.dag);
  const g = state.pack.gebouwIndex[b.sloop];
  return `<div style="font-size:12.5px;margin:6px 0">Sloopplaats, nog ${dagen(n)}, daarna vrij om te bouwen.</div>`
    + `<div class="zacht" style="font-size:12px">Hier stond ${ESC((g?.naam ?? 'een gebouw').toLowerCase())} van ${ESC(state.landen[b.land]?.naam ?? '')}.</div>`;
}
