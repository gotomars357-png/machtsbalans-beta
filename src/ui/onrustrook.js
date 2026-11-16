// C15a rook bij onrust: boven de hoofdstad van een land met lage stabiliteit (straatstand.js: onrust = stab < 35)
// hangen een tot drie rookpluimen, ook bij rivalen. Ver uitgezoomd lichte as met een dunne donkere kern, dichterbij
// donkere rook met een flakkerend vuurtje aan de voet; 's nachts oranje aangelicht. Puur decor zonder DOM: leest de
// toestand, schrijft er nooit in. Plaatsing uit een vaste hash, beweging uit de klok (nu); geen tekst, niet aan te
// tikken. Hooguit MAX_PLUIMEN pluimen in beeld.

import { DREMPELS, landStand } from './straatstand.js';
import { wind } from './seizoen.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const frac = (v) => v - Math.floor(v);
const TAU = Math.PI * 2;
function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// brandhaard.js heeft geen eigen rookkleur: dit is de donkere rook (dezelfde familie als de schoorsteen- en
// oorlogsrook in leven.js, rgb(72,68,64), net iets dieper).
export const ROOK_DONKER = [64, 60, 56];
export const AS_LICHT = [205, 200, 192];
export const MAX_PLUIMEN = 12;
export const PUFJES = 7;
const BANDEN = [0.55, 0.38, 0.18];
const ZOOM_R = 1.4, ZOOM_A = 0.3; // review: zachte rand om elk pufje (straal en alfa van de zoom)

// De stand per land komt uit de gedeelde momentopname van straatstand.js; tests kunnen hem vervangen.
let laagStand = landStand;
export function zetStandBron(f) { laagStand = f || landStand; }

// Het laatst getekende aantal pluimen per land (index = land), zodat bijvoorbeeld geluid erop kan aansluiten.
export const pluimenPerLand = [];

// Eigen kopie van de geenBeweging-check uit brandhaard.js (prefers-reduced-motion).
let stilStaan = null;
function geenBeweging() {
  if (stilStaan == null) {
    try { stilStaan = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { stilStaan = false; }
  }
  return stilStaan;
}
// Voor de tests: de beweging-check opnieuw laten lezen.
export function vergeetBeweging() { stilStaan = null; }

// 0 (net onrust) .. 1 (stabiliteit 0).
export function ernstVan(stab) { return clamp((DREMPELS.onrust_stab - (stab ?? 100)) / DREMPELS.onrust_stab, 0, 1); }

export function aantalPluimen(ernst) { return ernst < 0.2 ? 0 : ernst < 0.5 ? 1 : ernst < 0.75 ? 2 : 3; }

// De pluimen in kader { x0, y0, x1, y1 } (wereldcoördinaten), plus 2 tegels marge: [{ land, k, x, y, ernst, zaad }].
// De speler eerst, dan op ernst; per land voet 0 het dichtst bij de hoofdstad. Hooguit max pluimen in totaal.
export function pluimenVoor(state, geo, standVan, kader, max = MAX_PLUIMEN) {
  const uit = [];
  if (!state || !geo || !geo.hoofdstad) return uit;
  const Tw = geo.T, m = 2 * Tw;
  const kand = [];
  for (let i = 0; i < state.landen.length; i++) {
    const L = standVan(i);
    if (!L || !L.onrust) continue;
    const h = geo.hoofdstad[i];
    if (h == null || h < 0) continue;
    const tg = geo.tegels[h];
    if (!tg || tg.x < kader.x0 - m || tg.x > kader.x1 + m || tg.y < kader.y0 - m || tg.y > kader.y1 + m) continue;
    const ernst = ernstVan(state.landen[i].stab);
    const n = aantalPluimen(ernst);
    if (n) kand.push({ i, h, tg, ernst, n, speler: i === state.speler ? 1 : 0 });
  }
  kand.sort((a, b) => b.speler - a.speler || b.ernst - a.ernst || a.i - b.i);
  for (let j = 0; j < kand.length && uit.length < max; j++) {
    const { i, h, tg, ernst, n } = kand[j];
    const voeten = [];
    for (let k = 0; k < n; k++) {
      const dx = (hash(h, k, 1) - 0.5) * 0.7 * Tw, dy = (hash(h, k, 2) - 0.5) * 0.5 * Tw;
      voeten.push({ dx, dy, d: dx * dx + dy * dy, zaad: hash(h, k, 3) * 10 });
    }
    voeten.sort((a, b) => a.d - b.d);
    for (let k = 0; k < n && uit.length < max; k++) {
      const v = voeten[k];
      uit.push({ land: i, k, x: tg.x + v.dx, y: tg.y + v.dy, ernst, zaad: v.zaad });
    }
  }
  return uit;
}

// Hoe zichtbaar de rook op zoom z is: 1 tot zoom 4, 0,7 vanaf 5 (daar is het protest al te zien), 0,5 bij 8, weg bij 11.
export function zoomAlfa(z) {
  if (z < 4) return 1;
  if (z < 5) return 1 - 0.3 * (z - 4);
  if (z < 6) return 0.7;
  if (z < 8) return 0.7 - 0.1 * (z - 6);
  if (z < 9) return 0.5;
  if (z < 11) return 0.5 * (1 - (z - 9) / 2);
  return 0;
}

const kleur = (a, b, t) => `${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)}`;

// Tekent de rook. laag: de levenslaag (state, geo, sc, ox, oy, T, wx0..wy1, nachtVorig) na kader().
export function tekenOnrustRook(c, laag, nu, z) {
  pluimenPerLand.length = 0;
  const za = zoomAlfa(z);
  const s = laag.state, geo = laag.geo;
  if (za <= 0.01 || !s || !geo) return 0;
  const lijst = pluimenVoor(s, geo, laagStand, { x0: laag.wx0, y0: laag.wy0, x1: laag.wx1, y1: laag.wy1 });
  if (!lijst.length) return 0;
  const stil = geenBeweging();
  const sc = laag.sc, ox = laag.ox, oy = laag.oy;
  const H = clamp(1.3 * laag.T, 30, 150);
  const wd = wind(s.dag ?? 0), wxr = Math.cos(wd.hoek) * wd.kracht;
  const tijd = nu / 1000;
  const mDonker = smooth(2.5, 3.5, z); // 0 lichte as, 1 donkere rook
  const rgb = kleur(AS_LICHT, ROOK_DONKER, mDonker), kern = ROOK_DONKER.join(',');
  const nacht = smooth(0.3, 0.5, laag.nachtVorig ?? 0);
  const vuur = z >= 2.5 ? smooth(2.5, 2.9, z) : 0;
  const oudA = c.globalAlpha;
  for (let j = 0; j < lijst.length; j++) {
    const p = lijst[j];
    pluimenPerLand[p.land] = (pluimenPerLand[p.land] ?? 0) + 1;
    const vx = p.x * sc + ox, vy = p.y * sc + oy;
    const sterk = za * (0.7 + 0.3 * p.ernst);
    // vuurtje aan de voet
    if (vuur > 0) {
      const fl = stil ? 1 : 1 + 0.25 * Math.sin(nu / 90 + p.zaad);
      c.globalAlpha = oudA * vuur * za;
      c.fillStyle = `rgba(255,140,40,${stil ? 0.75 : 0.6 + 0.3 * Math.sin(nu / 90 + p.zaad)})`;
      c.beginPath(); c.arc(vx, vy, H * 0.06 * fl, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,225,120,0.85)';
      c.beginPath(); c.arc(vx, vy, H * 0.028 * fl, 0, TAU); c.fill();
    }
    c.globalAlpha = oudA;
    for (let band = 0; band < 3; band++) {
      // review: eerst een brede, zwakke zoom om de pufjes (zachte rand zonder verloop), dan het lijf; elk één pad
      let open = false;
      for (let laag = 0; laag < 2; laag++) {
        const rk = laag === 0 ? ZOOM_R : 1;
        c.beginPath();
        for (let q = 0; q < PUFJES; q++) {
          const f = stil ? (q + 0.5) / PUFJES : frac(tijd * 0.18 + q / PUFJES + frac(p.zaad * 0.618));
          if (Math.min(2, Math.floor(f * 3)) !== band) continue;
          const x = vx + wxr * f * 0.6 * H + Math.sin(f * 4 + p.zaad) * 0.05 * H, y = vy - f * H;
          const r = H * (0.07 + 0.16 * f) * rk;
          c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU);
          open = true;
        }
        if (!open) break;
        const al = BANDEN[band] * sterk * (laag === 0 ? ZOOM_A : 1);
        c.fillStyle = `rgba(${rgb},${al.toFixed(3)})`;
        c.fill();
      }
      if (!open) continue;
      const a = BANDEN[band] * sterk;
      if (band === 0 && nacht > 0) { c.fillStyle = `rgba(255,140,60,${(0.25 * nacht * za).toFixed(3)})`; c.fill(); }
      // dunne donkere kern in de lichte as (ver uitgezoomd)
      if (mDonker < 1) {
        c.beginPath();
        for (let q = 0; q < PUFJES; q++) {
          const f = stil ? (q + 0.5) / PUFJES : frac(tijd * 0.18 + q / PUFJES + frac(p.zaad * 0.618));
          if (Math.min(2, Math.floor(f * 3)) !== band) continue;
          const x = vx + wxr * f * 0.6 * H + Math.sin(f * 4 + p.zaad) * 0.05 * H, y = vy - f * H;
          const r = H * (0.07 + 0.16 * f) * 0.38;
          c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU);
        }
        c.fillStyle = `rgba(${kern},${(a * 0.55 * (1 - mDonker)).toFixed(3)})`;
        c.fill();
      }
    }
  }
  c.globalAlpha = oudA;
  return lijst.length;
}
