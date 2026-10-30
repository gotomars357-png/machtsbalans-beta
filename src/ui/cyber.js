// Weergave voor cyber (trede 3): knoppen met kans, ontdekking en kosten, en de storingsbeelden op de kaart.
// Leest alleen de toestand; aanvallen gaan als escalatie-order via issueOrder (zie main.js, data-actie="cyber").

import { cyberActie, cyberStatus, isUitgevallen, communicatieStil } from '../engine/cyber.js';

export const CYBER_KLEUR = '#3ef0d0';
const pctTekst = (v) => `${Math.round(v * 100)}%`;

// Eén regel per variant. `tegel` richt de aanval op één gebouw; `hulp` levert esc en kostenTekst uit main.js.
export function cyberRegels(s, doelIdx, tegel, hulp) {
  const e = cyberActie(s);
  if (!e) return '';
  const { esc, kostenTekst } = hulp;
  return e.varianten.map((v) => {
    const st = cyberStatus(s, s.speler, doelIdx, v.id, tegel);
    const kansen = `<span style="color:${CYBER_KLEUR}">kans ${pctTekst(st.kans ?? 0)}</span> · ontdekking ${pctTekst(st.ontdekkans ?? 0)}`;
    return `<div class="actie"><div><b>${esc(v.naam)}</b> <span class="zacht" style="font-size:11px">${v.duur} d</span></div>
      <button class="knop klein" data-actie="cyber" data-id="${esc(v.id)}" data-doel="${doelIdx}"${tegel != null ? ` data-tegel="${tegel}"` : ''} ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? `Kans ${pctTekst(st.kans)}, ontdekking ${pctTekst(st.ontdekkans)}`)}">${kostenTekst(st.kosten ?? {})}</button>
      <div class="sub">${esc(v.beschrijving ?? '')}<br>${kansen}${st.ok && st.sprong ? ' · <span style="color:var(--accent)">sprong: dubbele politieke kosten</span>' : ''}${st.ok ? '' : ` · <span class="slecht">${esc(st.reden)}</span>`}</div></div>`;
  }).join('');
}

// Blok voor het contextpaneel van een buitenlands gebouw: een gerichte aanval op precies dit gebouw.
export function cyberBlok(s, land, tegel, gebouwNaam, hulp) {
  if (!cyberActie(s)) return '';
  const { esc } = hulp;
  const p = land.plaatsingen.find((x) => x.t === tegel);
  const plat = p && isUitgevallen(s, p) ? `<div style="font-size:12px;color:${CYBER_KLEUR}">Dit gebouw ligt plat: nog ${p.uit - s.dag} dagen.</div>` : '';
  const verd = land.gebouwen && Object.entries(land.gebouwen).filter(([id, n]) => n && s.pack.gebouwIndex[id]?.cyberverdediging).reduce((a, [, n]) => a + n, 0);
  return `<h3 style="margin-top:10px">Cyberaanval</h3>${plat}
    <div class="zacht" style="font-size:12px;margin-bottom:4px">Gericht op ${esc(gebouwNaam.toLowerCase())}: legt het gebouw plat bovenop het effect van de variant. Weerbaarheid ${land.weerbaarheid.toFixed(0)}${verd ? ` · ${verd} cybercentrum` : ''}.</div>
    ${cyberRegels(s, land.idx, tegel, hulp)}`;
}

// Trede 3 op de escalatieladder in het tabblad Invloed: drie varianten, ongericht.
export function cyberTrede(s, t, e, hulp) {
  const { esc } = hulp;
  const stil = communicatieStil(s, t) ? ` · <span style="color:${CYBER_KLEUR}">omroep ligt stil</span>` : '';
  const plat = t.plaatsingen.filter((p) => isUitgevallen(s, p)).length;
  return `<div class="trede"><span class="nr">${e.trede}</span><b>${esc(e.naam)}</b><span></span>
    <span class="sub">${esc(e.beschrijving ?? '')}${plat ? `<br><span style="color:${CYBER_KLEUR}">${plat} gebouw${plat === 1 ? '' : 'en'} plat</span>` : ''}${stil}</span></div>
    <div class="cyber-varianten">${cyberRegels(s, t.idx, null, hulp)}</div>`;
}

// ---------- kaart ----------

// Uitgevallen gebouw: donker vlak met een knipperende storingsstreep.
export function tekenUitval(c, x, y, T, nu) {
  const m = T * 0.46;
  c.save();
  c.fillStyle = 'rgba(4,8,12,0.72)';
  c.fillRect(x - m, y - m, m * 2, m * 2);
  if (Math.floor(nu / 380) % 3 !== 0) {
    c.strokeStyle = CYBER_KLEUR;
    c.globalAlpha = 0.7;
    c.lineWidth = Math.max(1, T * 0.05);
    c.beginPath();
    c.moveTo(x - m * 0.6, y - m * 0.1); c.lineTo(x - m * 0.1, y - m * 0.1); c.lineTo(x + m * 0.05, y + m * 0.25); c.lineTo(x + m * 0.6, y + m * 0.25);
    c.stroke();
  }
  c.restore();
}

// Storingsflits bij een aanval: verspringende cyaan blokjes en een ring. f loopt van 0 tot 1.
export function tekenCyberFlits(c, x, y, T, f, gelukt) {
  const r = Math.max(10, T * 0.8);
  c.save();
  c.globalAlpha = Math.max(0, 1 - f);
  c.fillStyle = gelukt ? CYBER_KLEUR : '#8fa3b5';
  const stap = Math.floor(f * 24);
  for (let i = 0; i < 7; i++) {
    const h = ((stap * 31 + i * 17) % 13) / 13;
    const w = r * (0.3 + ((i * 7 + stap) % 5) / 6);
    c.fillRect(x - r + h * r, y - r + (i / 7) * r * 2, w, Math.max(1.5, r * 0.08));
  }
  c.strokeStyle = c.fillStyle;
  c.lineWidth = 2;
  c.beginPath(); c.arc(x, y, r * (0.6 + f), 0, Math.PI * 2); c.stroke();
  c.restore();
}
