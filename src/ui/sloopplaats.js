// Sloopplaats (C15c): kale grond met puinhopen, een bouwhek langs twee zijden en een gele graafmachine.
// Plaatsing komt uit een hash van de tegel, beweging uit de klok (tijd in ms); geen toeval, geen tekst.
// f (0..1) is hoe ver de sloop is: de puinhopen krimpen tot er bijna niets meer ligt.
// Onder 120 px per vakje alleen grond, puin en hek; vanaf 120 px wipt de arm van de graafmachine en stuift er wat stof.

const hash = (a, b) => {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

const GROND = '#7d6d58', GROND_DONKER = '#665844', PUIN = ['#8e8a83', '#a39f97', '#9b513d', '#86452f'];

export function tekenSloopplaats(c, x, y, s, f = 0, seed = 0, tijd = 0) {
  const h = s * 0.42;
  c.save();
  // kale grond met wat vlekken
  c.fillStyle = GROND;
  c.fillRect(x - h, y - h, h * 2, h * 2);
  c.fillStyle = GROND_DONKER;
  for (let i = 0; i < 6; i++) {
    const vx = x + (hash(seed, 40 + i) - 0.5) * h * 1.7, vy = y + (hash(seed, 50 + i) - 0.5) * h * 1.7;
    c.beginPath(); c.ellipse(vx, vy, s * 0.05, s * 0.03, hash(seed, 60 + i) * 3, 0, Math.PI * 2); c.fill();
  }
  // rupsbandsporen van de graafmachine, schuin over de grond (review: meer diepte op de bouwplaats)
  c.strokeStyle = 'rgba(60,48,36,0.35)';
  c.lineWidth = Math.max(0.8, s * 0.018);
  for (const d of [-0.035, 0.035]) {
    c.beginPath(); c.moveTo(x + h * 0.42 + d * s, y + h * 0.5); c.quadraticCurveTo(x, y + h * 0.1 + d * s, x - h * 0.55, y - h * 0.15 + d * s); c.stroke();
  }
  // afvalcontainer in de noordoosthoek, met ribben en een schaduw
  const cw = s * 0.2, ch = s * 0.1, cx0 = x + h * 0.82 - cw, cy0 = y - h * 0.82;
  c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(cx0 + s * 0.012, cy0 + s * 0.012, cw, ch);
  c.fillStyle = '#b4472e'; c.fillRect(cx0, cy0, cw, ch);
  c.fillStyle = '#8e3622';
  for (let i = 1; i < 5; i++) c.fillRect(cx0 + (cw * i) / 5 - s * 0.003, cy0, Math.max(0.6, s * 0.006), ch);
  c.fillStyle = '#9c968c'; c.fillRect(cx0 + s * 0.02, cy0 + s * 0.02, cw - s * 0.04, ch * 0.35);
  // puinhopen: 5 tot 9, grijs beton en baksteenrood, krimpend met de voortgang
  const n = 5 + Math.floor(hash(seed, 1) * 5);
  const krimp = 1 - 0.8 * Math.max(0, Math.min(1, f));
  for (let i = 0; i < n; i++) {
    const px = x + (hash(seed, 10 + i) - 0.55) * h * 1.25;
    const py = y + (hash(seed, 20 + i) - 0.45) * h * 1.25;
    const r = s * (0.07 + 0.07 * hash(seed, 30 + i)) * krimp;
    if (r < 0.6) continue;
    const kleur = PUIN[Math.floor(hash(seed, 70 + i) * PUIN.length)];
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.beginPath(); c.ellipse(px + r * 0.25, py + r * 0.5, r * 1.05, r * 0.32, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = kleur;
    c.beginPath();
    c.moveTo(px - r, py + r * 0.45);
    c.lineTo(px - r * 0.45, py - r * 0.5);
    c.lineTo(px + r * 0.2, py - r * 0.7);
    c.lineTo(px + r, py + r * 0.45);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.16)';
    c.beginPath(); c.moveTo(px - r * 0.45, py - r * 0.5); c.lineTo(px + r * 0.2, py - r * 0.7); c.lineTo(px, py); c.closePath(); c.fill();
    // schaduwzijde rechts, en losse brokken eromheen
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.beginPath(); c.moveTo(px + r * 0.2, py - r * 0.7); c.lineTo(px + r, py + r * 0.45); c.lineTo(px + r * 0.15, py + r * 0.45); c.closePath(); c.fill();
    if (s >= 60) {
      c.fillStyle = kleur;
      for (let k = 0; k < 3; k++) {
        const bx = px + (hash(seed * 7 + i, k) - 0.5) * r * 3, by = py + r * 0.5 + (hash(seed * 7 + i, k + 5) - 0.3) * r;
        c.fillRect(bx, by, Math.max(0.8, r * 0.18), Math.max(0.6, r * 0.12));
      }
    }
  }
  // bouwhek langs de noord- en westzijde: palen met een bovenregel
  c.strokeStyle = '#d9d3c5';
  c.lineWidth = Math.max(1, s * 0.012);
  c.beginPath();
  c.moveTo(x - h, y + h); c.lineTo(x - h, y - h); c.lineTo(x + h, y - h);
  c.stroke();
  c.fillStyle = '#e07b2a';
  const paal = Math.max(1.2, s * 0.018), stap = Math.max(4, s * 0.12);
  for (let d = 0; d <= h * 2 + 0.1; d += stap) {
    c.fillRect(x - h + d - paal / 2, y - h - paal / 2, paal, paal);
    c.fillRect(x - h - paal / 2, y - h + d - paal / 2, paal, paal);
  }
  // gele graafmachine in de zuidoosthoek
  const gx = x + h * 0.42, gy = y + h * 0.45, b = s * 0.11;
  const rups = '#2a2826', geel = '#e3b12c', geelDonker = '#b2861c';
  c.fillStyle = rups;
  c.fillRect(gx - b * 1.05, gy + b * 0.25, b * 2.1, b * 0.45);
  c.fillStyle = geel;
  c.fillRect(gx - b * 0.85, gy - b * 0.45, b * 1.7, b * 0.75);
  c.fillStyle = geelDonker;
  c.fillRect(gx + b * 0.05, gy - b * 0.95, b * 0.7, b * 0.55);
  c.fillStyle = 'rgba(170,210,235,0.85)';
  c.fillRect(gx + b * 0.15, gy - b * 0.85, b * 0.45, b * 0.32);
  // de arm: vast onder 120 px, daarboven wipt hij langzaam
  const groot = s >= 120;
  const hoek = -0.9 + (groot ? Math.sin(tijd / 650 + seed) * 0.28 : 0);
  const ax = gx - b * 0.6, ay = gy - b * 0.35;
  const ex = ax + Math.cos(Math.PI + hoek) * b * 1.5, ey = ay + Math.sin(Math.PI + hoek) * b * 1.5;
  const tx = ex - b * 0.2, ty = ey + b * 1.0;
  c.strokeStyle = geelDonker;
  c.lineWidth = Math.max(1.4, b * 0.22);
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(ax, ay); c.lineTo(ex, ey); c.lineTo(tx, ty); c.stroke();
  c.fillStyle = '#4a4640';
  c.beginPath(); c.moveTo(tx - b * 0.25, ty - b * 0.1); c.lineTo(tx + b * 0.2, ty); c.lineTo(tx - b * 0.1, ty + b * 0.3); c.closePath(); c.fill();
  // stofwolkjes (hooguit 3) bij de bak
  if (groot && f < 1) {
    for (let i = 0; i < 3; i++) {
      const fase = ((tijd / 1800 + i / 3 + hash(seed, 90)) % 1 + 1) % 1;
      const r = b * (0.25 + fase * 0.6);
      c.fillStyle = `rgba(205,192,170,${(0.45 * (1 - fase)).toFixed(3)})`;
      c.beginPath(); c.arc(tx + (i - 1) * b * 0.4, ty - fase * b * 1.2, r, 0, Math.PI * 2); c.fill();
    }
  }
  c.restore();
}

// Leeg kavel (na de sloop): braakliggende grond met grind en wat onkruid binnen de stoeprand van het net. o is
// wegennet.omgeving(t) (inzet per zijde, straatzijden, poort); zonder o vult het kavel de tegel op een vaste marge.
// Plaatsing uit een hash van de tegel; geen tekst, geen beweging.
const KAVEL_GROND = '#8b7f6c', KAVEL_GRIND = '#978c7a', STOEP = '#bdb8ad', BAND = '#d6d1c6';
export function tekenLeegKavel(c, x, y, s, o = null, seed = 0) {
  const I = o?.inzet ?? [0.08, 0.08, 0.08, 0.08];
  const x0 = x + (-0.5 + I[3]) * s, x1 = x + (0.5 - I[1]) * s, y0 = y + (-0.5 + I[0]) * s, y1 = y + (0.5 - I[2]) * s;
  const w = x1 - x0, h = y1 - y0;
  if (w <= 1 || h <= 1) return;
  c.save();
  // stoep langs de straatzijden: een strook binnen de kavelrand met een lichte band
  const st = Math.max(0.8, s * 0.035);
  c.fillStyle = KAVEL_GROND;
  c.fillRect(x0, y0, w, h);
  const straat = o?.straat ?? 0;
  c.fillStyle = STOEP;
  if (straat & 1) c.fillRect(x0, y0, w, st);
  if (straat & 4) c.fillRect(x0, y1 - st, w, st);
  if (straat & 2) c.fillRect(x1 - st, y0, st, h);
  if (straat & 8) c.fillRect(x0, y0, st, h);
  // grindvlakken en bandensporen van de sloop
  c.fillStyle = KAVEL_GRIND;
  for (let i = 0; i < 4; i++) {
    const px = x0 + st + (w - 2 * st) * (0.15 + 0.7 * hash(seed, 200 + i)), py = y0 + st + (h - 2 * st) * (0.15 + 0.7 * hash(seed, 210 + i));
    c.beginPath(); c.ellipse(px, py, s * (0.05 + 0.05 * hash(seed, 220 + i)), s * (0.03 + 0.03 * hash(seed, 230 + i)), hash(seed, 240 + i) * 3, 0, Math.PI * 2); c.fill();
  }
  if (s >= 30) {
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 26; i++) {
      const px = x0 + st + (w - 2 * st) * hash(seed, 300 + i), py = y0 + st + (h - 2 * st) * hash(seed, 330 + i);
      c.fillRect(px, py, Math.max(0.6, s * 0.008), Math.max(0.6, s * 0.008));
    }
    // onkruid: kleine groene pollen, vooral langs de randen
    for (let i = 0; i < 9; i++) {
      const rand = hash(seed, 400 + i) < 0.6;
      const u = hash(seed, 410 + i), v = rand ? (hash(seed, 420 + i) < 0.5 ? 0.06 : 0.94) : hash(seed, 420 + i);
      const [pu, pv] = hash(seed, 430 + i) < 0.5 ? [u, v] : [v, u];
      const px = x0 + st + (w - 2 * st) * pu, py = y0 + st + (h - 2 * st) * pv, r = s * (0.018 + 0.02 * hash(seed, 440 + i));
      c.fillStyle = hash(seed, 450 + i) < 0.5 ? '#6f8a45' : '#879a52';
      c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill();
    }
  }
  // de stoeprand zelf
  c.strokeStyle = BAND;
  c.lineWidth = Math.max(0.6, s * 0.01);
  c.beginPath();
  if (straat & 1) { c.moveTo(x0, y0 + st); c.lineTo(x1, y0 + st); }
  if (straat & 4) { c.moveTo(x0, y1 - st); c.lineTo(x1, y1 - st); }
  if (straat & 2) { c.moveTo(x1 - st, y0); c.lineTo(x1 - st, y1); }
  if (straat & 8) { c.moveTo(x0 + st, y0); c.lineTo(x0 + st, y1); }
  c.stroke();
  c.restore();
}
