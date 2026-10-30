// Geografie van een wereld: grenzen, vakjes en terrein, afgeleid uit de zaadpunten in de kaart van het pack.
// Engine en weergave gebruiken dezelfde functies, zodat wat je ziet ook is wat de bouwregels toepassen.
// Alles hangt alleen af van het pack (niet van de seed van het spel), dus replays blijven gelijk.

import { hashString } from './rng.js';

export const WERELD_B = 1000;
export const WERELD_H = 620;
export const TEGEL = 16;
export const TERREINEN = ['vlakte', 'bos', 'berg', 'kust'];

export function maakRuis(seed) {
  const hash = (x, y) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const glad = (t) => t * t * (3 - 2 * t);
  const waarde = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = glad(x - xi), yf = glad(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x, y) => waarde(x, y) * 0.55 + waarde(x * 2.1 + 17, y * 2.1 + 9) * 0.3 + waarde(x * 4.3 + 3, y * 4.3 + 41) * 0.15;
}

export function bouwGeografie(pack) {
  const kaart = pack.kaart;
  const sx = WERELD_B / kaart.breedte;
  const sy = WERELD_H / kaart.hoogte;
  const ruis = maakRuis(hashString(pack.meta.id));
  const idxVan = Object.fromEntries(pack.landen.map((l, i) => [l.id, i]));
  const zaden = [
    ...kaart.regios.filter((r) => idxVan[r.land] != null).map((r) => ({ x: r.x * sx, y: r.y * sy, w: r.gewicht ?? 1, eig: idxVan[r.land] })),
    ...kaart.zee.map((z) => ({ x: z.x * sx, y: z.y * sy, w: z.gewicht ?? 1, eig: -1 })),
  ];
  // Onbewoonde eilanden: land zonder eigenaar in open water, te koloniseren.
  const eilanden = (kaart.eilanden || []).map((z) => ({ x: z.x * sx, y: z.y * sy, r: (z.straal ?? 30) * Math.min(sx, sy) }));

  // Eigenaar van een punt: gewogen Voronoi op een met ruis verschoven positie, met zee langs de randen.
  const eigenaarOp = (x, y) => {
    const px = x + (ruis(x * 0.011, y * 0.011) - 0.5) * 70;
    const py = y + (ruis(x * 0.011 + 50, y * 0.011 + 50) - 0.5) * 70;
    let best = Infinity, eig = -1, landAfstand = Infinity;
    for (const z of zaden) {
      const dx = px - z.x, dy = py - z.y;
      const d = Math.sqrt(dx * dx + dy * dy) / z.w;
      if (d < best) { best = d; eig = z.eig; }
      if (z.eig !== -1 && d < landAfstand) landAfstand = d;
    }
    const kustRuis = ruis(x * 0.02 + 9, y * 0.02 + 3);
    const rand = Math.min(x, y, WERELD_B - 1 - x, WERELD_H - 1 - y) + (kustRuis - 0.5) * 90;
    if (rand < 34 || landAfstand * (0.8 + 0.4 * kustRuis) > 128) eig = -1;
    if (eig === -1) {
      for (const e of eilanden) if (Math.hypot(px - e.x, py - e.y) < e.r * (0.8 + 0.4 * kustRuis)) return -2;
    }
    return eig;
  };

  const drempel = { berg: 0.67, bos: 0.56, ...(kaart.terrein || {}) };
  const kol = Math.ceil(WERELD_B / TEGEL);
  const rij = Math.ceil(WERELD_H / TEGEL);
  const tegels = [];
  for (let r = 0; r < rij; r++) {
    for (let k = 0; k < kol; k++) {
      const x = k * TEGEL + TEGEL / 2;
      const y = r * TEGEL + TEGEL / 2;
      const eig = eigenaarOp(x, y);
      const hoogte = ruis(x * 0.009 + 300, y * 0.009 + 300);
      const vocht = ruis(x * 0.013 + 700, y * 0.013 + 700);
      const terrein = eig === -1 ? 'water' : hoogte > drempel.berg ? 'berg' : vocht > drempel.bos ? 'bos' : 'vlakte';
      tegels.push({ i: tegels.length, k, r, x, y, eig, terrein, hoogte });
    }
  }
  const buur = (t, dk, dr) => {
    const k = t.k + dk, r = t.r + dr;
    return k < 0 || r < 0 || k >= kol || r >= rij ? null : tegels[r * kol + k];
  };
  for (const t of tegels) {
    if (t.eig === -1 || t.terrein === 'berg') continue;
    const n = [buur(t, 1, 0), buur(t, -1, 0), buur(t, 0, 1), buur(t, 0, -1)];
    if (n.some((b) => b && b.eig === -1)) t.terrein = 'kust';
  }

  const landTegels = pack.landen.map(() => []);
  for (const t of tegels) if (t.eig >= 0) landTegels[t.eig].push(t.i);

  // Elk land krijgt minstens wat bergen, zodat niemand zonder mijnen start.
  for (const lijst of landTegels) {
    const bergen = lijst.filter((i) => tegels[i].terrein === 'berg').length;
    if (bergen >= 3) continue;
    const kandidaten = lijst.filter((i) => tegels[i].terrein !== 'berg' && tegels[i].terrein !== 'kust').sort((a, b) => tegels[b].hoogte - tegels[a].hoogte || a - b);
    for (const i of kandidaten.slice(0, 3 - bergen)) tegels[i].terrein = 'berg';
  }

  // Hoofdstad: het vakje bij het eerste zaadpunt van het land.
  const hoofdstad = pack.landen.map((l, idx) => {
    const reg = kaart.regios.find((r) => r.land === l.id);
    const lijst = landTegels[idx];
    if (!reg || !lijst.length) return lijst[0] ?? -1;
    const hx = reg.x * sx, hy = reg.y * sy;
    let best = -1, bd = Infinity;
    for (const i of lijst) {
      const t = tegels[i];
      const d = (t.x - hx) ** 2 + (t.y - hy) ** 2 + (t.terrein === 'berg' ? 400 : 0);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  });

  const onbewoond = tegels.filter((t) => t.eig === -2).map((t) => t.i);
  return { B: WERELD_B, H: WERELD_H, T: TEGEL, kol, rij, tegels, landTegels, onbewoond, hoofdstad, eigenaarOp, ruis, idxVan, schaal: { sx, sy } };
}

export function tegelOp(geo, x, y) {
  const k = Math.floor(x / geo.T), r = Math.floor(y / geo.T);
  if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) return -1;
  return r * geo.kol + k;
}

export function tegelAfstand(geo, a, b) {
  const ta = geo.tegels[a], tb = geo.tegels[b];
  return Math.hypot(ta.k - tb.k, ta.r - tb.r);
}
