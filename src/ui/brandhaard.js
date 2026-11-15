// Brandhaarden in beeld (C13): een ring op de ankertegel en het blok in het contextpaneel.
// De ring: de buitenboog is de resterende tijd (met de klok mee vanaf boven), de dikte van de binnenring de druk.
// Kleur per trap (geel, oranje, rood). Hij pulseert, sneller als er minder dan 15 dagen over zijn. Eigen haarden zijn
// altijd zichtbaar, die van andere landen vanaf zoom 2 of als dat land geselecteerd is. Leest alleen de toestand;
// een aanpak gaat als order 'brandhaard' via main.js (data-actie="brandhaard").

import {
  brandhaardOp, brandhaardSoort, brandhaardStatus, dagenOver, drukTrap, groeiPerDag, ankerNaam,
} from '../engine/brandhaarden.js';
import { tegelAfstand } from '../engine/geografie.js';

export const TRAP_KLEUR = ['#f0b429', '#f08c29', '#e5484d'];
const MAX_PER_BEELD = 30;
const DIEP = 4; // vanaf deze zoom staat het pictogram boven de ring, zodat het gebouw zelf zichtbaar blijft

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const min = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`;

let stilStaan = null;
function geenBeweging() {
  if (stilStaan == null) {
    try { stilStaan = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { stilStaan = false; }
  }
  return stilStaan;
}

export function trapKleur(state, h) {
  const n = drukTrap(brandhaardSoort(state, h.soort), h.druk);
  return TRAP_KLEUR[Math.min(TRAP_KLEUR.length - 1, n)];
}

// Welk pictogram: uit het pack, anders afgeleid van het anker.
export function pictogramVan(state, soort) {
  if (soort?.pictogram) return soort.pictogram;
  if (!soort || soort.anker === 'hoofdstad') return 'zuil';
  const g = state.pack.gebouwIndex[soort.anker];
  const R = state.pack.rollen;
  if (g?.woningen) return 'huisje';
  if (g?.productie?.[R.energie]) return 'bliksem';
  if (g?.productie?.[R.voedsel]) return 'aar';
  if (/haven/.test(soort.anker)) return 'golf';
  return 'tandwiel';
}

export class BrandhaardLaag {
  teken(c, view, sc, nu) {
    const s = view.state;
    const lijst = s?.brandhaarden;
    if (!lijst?.length) return;
    const geo = view.geo;
    const T = geo.T * sc;
    const r = Math.max(10, T * 0.45);
    const tijd = view.echtNu ?? nu;
    const beweeg = !geenBeweging();
    let n = 0;
    // Eerst de eigen haarden, dan die van de buren.
    for (let ronde = 0; ronde < 2 && n < MAX_PER_BEELD; ronde++) {
      for (let i = 0; i < lijst.length && n < MAX_PER_BEELD; i++) {
        const h = lijst[i];
        const eigen = h.land === s.speler;
        if (eigen !== (ronde === 0)) continue;
        if (!eigen && view.zoom < 2 && view.geselecteerd !== h.land) continue;
        const tg = geo.tegels[h.tegel];
        if (!tg) continue;
        const [x, y] = view.naarScherm(tg.x, tg.y);
        if (x < -r * 3 || y < -r * 3 || x > view.w + r * 3 || y > view.h + r * 3) continue;
        this.ring(c, s, h, x, y, eigen ? r : r * 0.85, view.zoom, tijd, beweeg, eigen);
        n++;
      }
    }
  }

  ring(c, s, h, x, y, r, zoom, tijd, beweeg, eigen) {
    const soort = brandhaardSoort(s, h.soort);
    if (!soort) return;
    const kleur = trapKleur(s, h);
    const dagen = dagenOver(s, h);
    const totaal = Math.max(1, h.deadline - h.start);
    const over = Math.max(0, Math.min(1, dagen / totaal));
    const druk = Math.max(0, Math.min(100, h.druk));
    const diep = zoom >= DIEP;
    const lw = Math.max(2.5, r * 0.13);
    c.save();
    c.globalAlpha = eigen ? 1 : 0.8;
    // Puls: een golf die naar buiten loopt, sneller als de tijd dringt.
    if (beweeg) {
      const periode = dagen < 15 ? 650 : 1500;
      const p = (tijd % periode) / periode;
      c.strokeStyle = kleur;
      c.globalAlpha = (eigen ? 0.55 : 0.4) * (1 - p);
      c.lineWidth = lw * 0.8;
      c.beginPath(); c.arc(x, y, r + lw + p * r * 0.7, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = eigen ? 1 : 0.8;
    }
    // Ondergrond: op het overzicht een donkere schijf, ingezoomd alleen een donkere rand zodat het gebouw zichtbaar blijft.
    if (!diep) {
      c.fillStyle = 'rgba(12,18,26,0.72)';
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    // Het spoor voor de verstreken tijd: op het overzicht stevig, ingezoomd lichter zodat het geen zware zwarte band
    // over de straten wordt.
    c.strokeStyle = diep ? 'rgba(8,12,18,0.34)' : 'rgba(8,12,18,0.7)';
    c.lineWidth = diep ? lw + 1 : lw + 2;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    // Buitenboog: resterende dagen, met de klok mee vanaf boven.
    c.strokeStyle = kleur;
    c.lineWidth = lw;
    c.lineCap = 'round';
    c.beginPath(); c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * over); c.stroke();
    c.lineCap = 'butt';
    // Binnenring: hoe dikker, hoe hoger de druk.
    const ri = r * (diep ? 0.84 : 0.74);
    const dik = 1 + (druk / 100) * r * (diep ? 0.16 : 0.26);
    c.globalAlpha = (eigen ? 1 : 0.8) * (diep ? 0.55 : 0.85);
    c.lineWidth = dik;
    c.beginPath(); c.arc(x, y, ri, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = eigen ? 1 : 0.8;
    // Pictogram: op het overzicht in het midden, ingezoomd in een plaatje rechts naast de ring (boven staat de naam
    // van een hoofdstad), zodat het gebouw zelf zichtbaar blijft.
    const pict = pictogramVan(s, soort);
    if (diep) {
      const br = Math.max(9, r * 0.24);
      const bx = x + r + br * 0.7;
      c.fillStyle = 'rgba(12,18,26,0.88)';
      c.beginPath(); c.arc(bx, y, br, 0, Math.PI * 2); c.fill();
      c.strokeStyle = kleur; c.lineWidth = 2;
      c.beginPath(); c.arc(bx, y, br, 0, Math.PI * 2); c.stroke();
      tekenPictogram(c, pict, bx, y, br * 0.62, kleur);
    } else {
      tekenPictogram(c, pict, x, y, Math.max(4.5, r * 0.42), kleur);
    }
    c.restore();
  }
}

// Kleine vectorpictogrammen zonder tekst; z is de halve breedte.
export function tekenPictogram(c, soort, x, y, z, kleur) {
  c.fillStyle = kleur;
  c.strokeStyle = kleur;
  c.lineWidth = Math.max(1.2, z * 0.22);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.beginPath();
  if (soort === 'tandwiel') {
    const tanden = 8;
    for (let i = 0; i < tanden * 2; i++) {
      const a = (i / (tanden * 2)) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? z * 0.72 : z;
      const a1 = a - Math.PI / (tanden * 2) * 0.55, a2 = a + Math.PI / (tanden * 2) * 0.55;
      if (i === 0) c.moveTo(x + Math.cos(a1) * rr, y + Math.sin(a1) * rr); else c.lineTo(x + Math.cos(a1) * rr, y + Math.sin(a1) * rr);
      c.lineTo(x + Math.cos(a2) * rr, y + Math.sin(a2) * rr);
    }
    c.closePath();
    c.moveTo(x + z * 0.32, y);
    c.arc(x, y, z * 0.32, 0, Math.PI * 2, true);
    c.fill('evenodd');
  } else if (soort === 'golf') {
    for (const dy of [-0.32, 0.32]) {
      c.moveTo(x - z, y + dy * z);
      c.bezierCurveTo(x - z * 0.5, y + (dy - 0.45) * z, x - z * 0.2, y + (dy + 0.45) * z, x + z * 0.15, y + dy * z);
      c.bezierCurveTo(x + z * 0.45, y + (dy - 0.45) * z, x + z * 0.75, y + (dy + 0.45) * z, x + z, y + dy * z);
    }
    c.lineWidth = Math.max(1.4, z * 0.26);
    c.stroke();
  } else if (soort === 'bliksem') {
    c.moveTo(x + z * 0.2, y - z);
    c.lineTo(x - z * 0.55, y + z * 0.12);
    c.lineTo(x - z * 0.02, y + z * 0.12);
    c.lineTo(x - z * 0.25, y + z);
    c.lineTo(x + z * 0.6, y - z * 0.2);
    c.lineTo(x + z * 0.05, y - z * 0.2);
    c.closePath();
    c.fill();
  } else if (soort === 'aar') {
    c.moveTo(x, y + z); c.lineTo(x, y - z * 0.8);
    c.stroke();
    for (let i = 0; i < 3; i++) {
      const yy = y - z * 0.55 + i * z * 0.42;
      for (const kant of [-1, 1]) {
        c.beginPath();
        c.ellipse(x + kant * z * 0.3, yy, z * 0.3, z * 0.14, kant * -0.6, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.beginPath();
    c.ellipse(x, y - z * 0.88, z * 0.14, z * 0.26, 0, 0, Math.PI * 2);
    c.fill();
  } else if (soort === 'huisje') {
    c.moveTo(x - z, y - z * 0.05);
    c.lineTo(x, y - z * 0.95);
    c.lineTo(x + z, y - z * 0.05);
    c.lineTo(x + z * 0.72, y - z * 0.05);
    c.lineTo(x + z * 0.72, y + z * 0.85);
    c.lineTo(x + z * 0.18, y + z * 0.85);
    c.lineTo(x + z * 0.18, y + z * 0.3);
    c.lineTo(x - z * 0.18, y + z * 0.3);
    c.lineTo(x - z * 0.18, y + z * 0.85);
    c.lineTo(x - z * 0.72, y + z * 0.85);
    c.lineTo(x - z * 0.72, y - z * 0.05);
    c.closePath();
    c.fill();
  } else {
    // zuil: kapiteel, schacht met cannelures, voet
    c.rect(x - z * 0.85, y - z * 0.95, z * 1.7, z * 0.3);
    c.rect(x - z * 0.95, y + z * 0.65, z * 1.9, z * 0.3);
    for (const dx of [-0.5, -0.12, 0.26]) c.rect(x + dx * z, y - z * 0.6, z * 0.24, z * 1.25);
    c.fill();
  }
}

// ---------- klikken ----------

// De haard bij een geklikte tegel. Met straal 0 alleen precies die tegel (elke haard); met een straal (uitgezoomd)
// alleen eigen haarden, want buitenlandse ringen zijn daar niet zichtbaar. De dichtstbijzijnde wint.
export function brandhaardBij(state, t, straal = 0) {
  const lijst = state?.brandhaarden;
  if (!lijst?.length || t == null || t < 0) return null;
  if (!(straal > 0)) return brandhaardOp(state, t);
  let best = null, bd = Infinity;
  for (let i = 0; i < lijst.length; i++) {
    const h = lijst[i];
    if (h.land !== state.speler) continue;
    const d = tegelAfstand(state.pack.geo, h.tegel, t);
    if (d <= straal && d < bd) { bd = d; best = h; }
  }
  return best;
}

// ---------- contextpaneel ----------

function kostenTekst(state, kosten) {
  const delen = Object.entries(kosten || {}).map(([r, v]) => `${v} ${(state.pack.resIndex[r]?.naam ?? r).toLowerCase()}`);
  return delen.length ? delen.join(' + ') : 'gratis';
}

export function effectTekst(state, effect) {
  const P = state.pack;
  const duur = effect.duur_dagen ? ` (${effect.duur_dagen} d)` : '';
  const delen = [];
  for (const [k, v] of Object.entries(effect || {})) {
    if (k === 'duur_dagen') continue;
    if (k === P.rollen.stabiliteit) delen.push(`stabiliteit ${min(v)}`);
    else if (P.resIndex[k]) delen.push(`${min(v)} ${P.resIndex[k].naam.toLowerCase()}`);
    else if (k === 'stabiliteit_doel') delen.push(`stabiliteit ${min(v)} per dag${duur}`);
    else if (k === 'productie_factor') delen.push(`productie ${min(Math.round((v - 1) * 100))}%${duur}`);
    else if (k === 'complot') delen.push(`complotdenken ${min(v)}`);
    else if (k === 'controle') delen.push(`informatiecontrole ${min(v)}`);
  }
  return delen.join(', ');
}

// Wat de haard sneller of trager laat groeien.
function versnellers(state, h) {
  const c = state.landen[h.land];
  const delen = [];
  if (c.complot >= 5) delen.push(`complotdenken ${c.complot.toFixed(0)} versnelt (+${c.complot.toFixed(0)}%)`);
  const w = Math.min(60, Math.max(0, c.weerbaarheid));
  if (w < 15) delen.push('lage weerbaarheid remt nauwelijks');
  else delen.push(`weerbaarheid remt (−${w.toFixed(0)}%)`);
  return delen.join(' · ');
}

// HTML voor het contextpaneel van tegel t; leeg als daar geen haard is.
export function brandhaardBlok(state, t) {
  const h = brandhaardOp(state, t);
  if (!h) return '';
  const soort = brandhaardSoort(state, h.soort);
  if (!soort) return '';
  const kleur = trapKleur(state, h);
  const dagen = dagenOver(state, h);
  if (h.land !== state.speler) {
    const waar = soort.anker === 'hoofdstad' ? 'in de hoofdstad' : `bij ${ankerNaam(state, h)}`;
    return `<div class="bh-blok bh-vreemd" style="--bh:${kleur}" title="${esc(soort.naam)}"><span class="bh-stip"></span>Onrust ${esc(waar)}: nog ${dagen} ${dagen === 1 ? 'dag' : 'dagen'}</div>`;
  }
  const druk = Math.max(0, Math.min(100, h.druk));
  const trappen = (soort.trappen || []).map((x) => `<i style="left:${x.vanaf}%"></i>`).join('');
  const u = soort.uitbarsting || {};
  const uitEff = [effectTekst(state, u.effect || {}), u.gebouw_uit_dagen > 0 ? `${ankerNaam(state, h)} ${u.gebouw_uit_dagen} dagen stil` : ''].filter(Boolean).join(', ');
  const acties = (soort.acties || []).map((a) => {
    const st = brandhaardStatus(state, state.speler, h.id, a.id);
    const eff = [`druk ${min(a.druk)}`, effectTekst(state, a.effect || {})].filter(Boolean).join(', ');
    return `<div class="actie bh-actie${st.ok ? '' : ' kan-niet'}"><div><b>${esc(a.naam)}</b></div>
      <button class="knop klein" data-actie="brandhaard" data-doel="${h.id}" data-id="${esc(a.id)}" ${st.ok ? '' : 'disabled'} title="${esc(st.reden ?? a.tekst ?? '')}">${esc(kostenTekst(state, a.kosten))}</button>
      <div class="sub">${esc(a.tekst ?? '')} <span class="bh-eff">${esc(eff)}</span>${st.ok ? '' : ` <span class="reden">${esc(st.reden)}</span>`}</div></div>`;
  }).join('');
  return `<div class="bh-blok" style="--bh:${kleur}">
    <div class="bh-kop"><span class="bh-stip"></span><b>${esc(soort.naam)}</b><span class="bh-dagen${dagen < 15 ? ' dringend' : ''}">nog ${dagen} ${dagen === 1 ? 'dag' : 'dagen'}</span></div>
    <p class="bh-tekst">${esc(soort.tekst ?? '')}</p>
    <div class="bh-meter" title="Druk ${druk.toFixed(0)} van 100"><span style="width:${druk.toFixed(1)}%"></span>${trappen}</div>
    <div class="bh-regel">Druk <b>${druk.toFixed(0)}</b>/100, ${groeiPerDag(state, h).toFixed(1).replace('.', ',')} per dag · ${esc(versnellers(state, h))}</div>
    <div class="bh-regel zacht">Bij 100 of na de aftelling barst hij uit: ${esc(uitEff)}.</div>
    ${acties}
  </div>`;
}
