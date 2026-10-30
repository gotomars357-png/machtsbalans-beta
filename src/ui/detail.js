// Gedetailleerde weergave voor diep inzoomen: alles in code getekend, top-down, in de bouwstijl van het regime.
// Elke functie tekent binnen één vakje met middelpunt (x, y) en zijde s (in schermpixels).

const STIJL = {
  democratie: { daken: ['#b5563b', '#7c8a99', '#4f6d8f', '#a8623a', '#8b6f5a'], muur: '#ddd5c6', accent: '#4c8ef7' },
  eenpartijstaat: { daken: ['#6d6f73', '#7b7d80', '#86888a'], muur: '#b0b0aa', accent: '#d9443c', blokken: true },
  theocratie: { daken: ['#eadfc4', '#dccca6', '#e4d6b4'], muur: '#f0e8d4', accent: '#8a63b8', plat: true },
  militair: { daken: ['#5d6b4a', '#6b6b5a', '#73715c'], muur: '#8f8f78', accent: '#c2a14a' },
  monarchie: { daken: ['#9c3b2f', '#7d2f2a', '#a8463a'], muur: '#e6dbc8', accent: '#d4af37' },
};

export function stijlVan(regime) {
  return STIJL[regime] ?? STIJL.democratie;
}

// Deterministische pseudo-random per vakje, zodat elk vakje er altijd hetzelfde uitziet.
function rnd(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rect(c, x, y, w, h, kleur) {
  c.fillStyle = kleur;
  c.fillRect(x, y, w, h);
}

function huis(c, x, y, w, h, st, r) {
  const dak = st.daken[Math.floor(r() * st.daken.length)];
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(x + w * 0.12, y + h * 0.12, w, h);
  rect(c, x, y, w, h, dak);
  if (!st.plat) {
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = Math.max(0.5, w * 0.06);
    c.beginPath();
    if (w >= h) { c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); } else { c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); }
    c.stroke();
  } else {
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    c.lineWidth = 0.6;
    c.strokeRect(x + w * 0.15, y + h * 0.15, w * 0.7, h * 0.7);
  }
}

function blok(c, x, y, w, h, st) {
  // plattenbau: lange rechthoek met raampjes
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(x + 2, y + 2, w, h);
  rect(c, x, y, w, h, st.daken[0]);
  c.fillStyle = 'rgba(255,255,220,0.35)';
  const n = Math.max(2, Math.floor(w / 5));
  for (let i = 0; i < n; i++) c.fillRect(x + (i + 0.3) * (w / n), y + h * 0.35, w / n * 0.4, h * 0.3);
}

function koepel(c, x, y, r, kleur) {
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath(); c.arc(x + r * 0.2, y + r * 0.2, r, 0, Math.PI * 2); c.fill();
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, kleur);
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
}

function boom(c, x, y, r) {
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath(); c.arc(x + r * 0.3, y + r * 0.3, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#2d5a32';
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#3f7a43';
  c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.55, 0, Math.PI * 2); c.fill();
}

function rook(c, x, y, s, tijd, seed) {
  for (let i = 0; i < 4; i++) {
    const f = (tijd * 0.35 + i / 4 + (seed % 7) / 7) % 1;
    c.fillStyle = `rgba(200,200,200,${0.45 * (1 - f)})`;
    c.beginPath();
    c.arc(x + f * s * 0.15, y - f * s * 0.55, s * (0.04 + f * 0.09), 0, Math.PI * 2);
    c.fill();
  }
}

function hek(c, x, y, s, kleur) {
  c.strokeStyle = kleur;
  c.lineWidth = Math.max(0.8, s * 0.02);
  c.setLineDash([s * 0.04, s * 0.03]);
  c.strokeRect(x - s * 0.44, y - s * 0.44, s * 0.88, s * 0.88);
  c.setLineDash([]);
}

function vlag(c, x, y, s, kleur) {
  c.strokeStyle = '#ddd';
  c.lineWidth = Math.max(0.8, s * 0.02);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - s * 0.3); c.stroke();
  c.fillStyle = kleur;
  c.fillRect(x, y - s * 0.3, s * 0.16, s * 0.1);
}

function stadswijk(c, x, y, s, st, r, dichtheid) {
  // straten
  c.fillStyle = 'rgba(60,60,58,0.85)';
  c.fillRect(x - s * 0.5, y - s * 0.03, s, s * 0.06);
  c.fillRect(x - s * 0.03, y - s * 0.5, s * 0.06, s);
  const kwart = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [kx, ky] of kwart) {
    const cx = x + kx * s * 0.25, cy = y + ky * s * 0.25;
    if (st.blokken) {
      blok(c, cx - s * 0.2, cy - s * 0.17, s * 0.4, s * 0.12, st);
      blok(c, cx - s * 0.2, cy + s * 0.04, s * 0.4, s * 0.12, st);
      continue;
    }
    const n = dichtheid;
    for (let i = 0; i < n; i++) {
      const w = s * (0.09 + r() * 0.05), h = s * (0.08 + r() * 0.05);
      huis(c, cx - s * 0.19 + r() * s * 0.25, cy - s * 0.19 + r() * s * 0.25, w, h, st, r);
    }
    if (st.plat && r() < 0.25) koepel(c, cx, cy, s * 0.05, st.accent);
  }
}

// ---------- gebouwen ----------

const TEKEN = {
  hoofdstad(c, x, y, s, st, r, ctx) {
    stadswijk(c, x, y, s, st, r, 3);
    const m = s * 0.16;
    if (ctx.regime === 'theocratie') {
      rect(c, x - m * 1.5, y - m * 1.5, m * 3, m * 3, '#e4d6b4');
      koepel(c, x, y, m, st.accent);
    } else if (ctx.regime === 'eenpartijstaat') {
      rect(c, x - m, y - m, m * 2, m * 2, '#8a8a86');
      rect(c, x - m * 0.5, y - m * 0.5, m, m, '#a2a29d');
      ster(c, x, y, m * 0.45, st.accent);
    } else if (ctx.regime === 'militair') {
      ster(c, x, y, m * 1.3, '#6b6b55');
      ster(c, x, y, m * 0.8, '#8f8f73');
      vlag(c, x, y, s, st.accent);
    } else if (ctx.regime === 'monarchie') {
      rect(c, x - m * 1.2, y - m * 0.8, m * 2.4, m * 1.6, st.muur);
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) koepel(c, x + dx * m * 1.2, y + dy * m * 0.8, m * 0.35, st.daken[0]);
      vlag(c, x, y - m * 0.5, s, st.accent);
    } else {
      rect(c, x - m * 1.3, y - m * 0.7, m * 2.6, m * 1.4, st.muur);
      c.fillStyle = 'rgba(0,0,0,0.2)';
      for (let i = 0; i < 6; i++) c.fillRect(x - m * 1.2 + i * m * 0.44, y + m * 0.4, m * 0.12, m * 0.25);
      koepel(c, x, y - m * 0.1, m * 0.55, '#8fa9c9');
    }
  },
  woonwijk(c, x, y, s, st, r) { stadswijk(c, x, y, s, st, r, 2); },
  kolonie(c, x, y, s, st, r, ctx) {
    c.strokeStyle = '#8a6a43';
    c.lineWidth = Math.max(1, s * 0.03);
    c.beginPath(); c.arc(x, y, s * 0.38, 0, Math.PI * 2); c.stroke();
    for (let i = 0; i < 4; i++) huis(c, x - s * 0.25 + r() * s * 0.4, y - s * 0.2 + r() * s * 0.35, s * 0.1, s * 0.08, st, r);
    vlag(c, x, y, s, ctx.kleur);
  },
  boerderij(c, x, y, s, st, r) {
    const kleuren = ['#c9b458', '#7fa65a', '#a8874f', '#d2c06a', '#6e9450'];
    const n = 5;
    for (let i = 0; i < n; i++) rect(c, x - s * 0.46, y - s * 0.46 + i * s * 0.92 / n, s * 0.92, s * 0.92 / n - 1, kleuren[(i + Math.floor(r() * 5)) % kleuren.length]);
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    c.lineWidth = 0.6;
    for (let i = 0; i < 10; i++) { const xx = x - s * 0.46 + i * s * 0.092; c.beginPath(); c.moveTo(xx, y - s * 0.46); c.lineTo(xx, y + s * 0.46); c.stroke(); }
    huis(c, x + s * 0.18, y + s * 0.18, s * 0.16, s * 0.12, { daken: ['#9c3b2f'] }, r);
  },
  mijn(c, x, y, s) {
    for (let i = 3; i > 0; i--) {
      c.fillStyle = ['#3b3632', '#5a524a', '#7a7066'][i - 1];
      c.beginPath(); c.ellipse(x, y, s * 0.13 * i, s * 0.1 * i, 0, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = '#c9b48a';
    c.lineWidth = Math.max(1, s * 0.025);
    c.beginPath(); c.moveTo(x + s * 0.2, y - s * 0.35); c.lineTo(x + s * 0.3, y - s * 0.1); c.lineTo(x + s * 0.4, y - s * 0.35); c.closePath(); c.stroke();
    rect(c, x - s * 0.42, y + s * 0.28, s * 0.25, s * 0.12, '#8a6a43');
  },
  houtkap(c, x, y, s, st, r) {
    for (let i = 0; i < 5; i++) boom(c, x - s * 0.35 + r() * s * 0.7, y - s * 0.35 + r() * s * 0.3, s * 0.09);
    for (let i = 0; i < 4; i++) { c.fillStyle = '#8a6a43'; c.beginPath(); c.arc(x - s * 0.3 + i * s * 0.18, y + s * 0.2, s * 0.035, 0, Math.PI * 2); c.fill(); }
    for (let i = 0; i < 3; i++) rect(c, x - s * 0.2, y + s * 0.3 + i * s * 0.04, s * 0.4, s * 0.03, i % 2 ? '#a67c52' : '#8a6a43');
  },
  centrale(c, x, y, s, st, r, ctx) {
    rect(c, x - s * 0.4, y - s * 0.05, s * 0.45, s * 0.35, '#8f9399');
    c.fillStyle = '#c7c9cc';
    c.beginPath(); c.arc(x + s * 0.2, y - s * 0.12, s * 0.2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#9a9da1';
    c.beginPath(); c.arc(x + s * 0.2, y - s * 0.12, s * 0.13, 0, Math.PI * 2); c.fill();
    if (ctx.actief) rook(c, x + s * 0.2, y - s * 0.15, s, ctx.tijd, ctx.seed);
  },
  zonnepark(c, x, y, s) {
    for (let rij = 0; rij < 4; rij++) {
      for (let k = 0; k < 3; k++) {
        rect(c, x - s * 0.42 + k * s * 0.29, y - s * 0.42 + rij * s * 0.22, s * 0.26, s * 0.17, '#2e4f7a');
        c.strokeStyle = 'rgba(160,200,255,0.5)';
        c.lineWidth = 0.6;
        c.strokeRect(x - s * 0.42 + k * s * 0.29, y - s * 0.42 + rij * s * 0.22, s * 0.26, s * 0.17);
      }
    }
  },
  industrie(c, x, y, s, st, r, ctx) {
    rect(c, x - s * 0.42, y - s * 0.25, s * 0.84, s * 0.55, '#7d6f62');
    c.fillStyle = '#9a8a7a';
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      c.moveTo(x - s * 0.42 + i * s * 0.168, y + s * 0.3);
      c.lineTo(x - s * 0.42 + i * s * 0.168, y - s * 0.25);
      c.lineTo(x - s * 0.42 + (i + 1) * s * 0.168, y + s * 0.3);
      c.fill();
    }
    for (const dx of [0.25, 0.36]) {
      rect(c, x + s * dx, y - s * 0.42, s * 0.06, s * 0.2, '#5a4f46');
      if (ctx.actief) rook(c, x + s * (dx + 0.03), y - s * 0.42, s, ctx.tijd, ctx.seed + dx * 10);
    }
  },
  chipfabriek(c, x, y, s) {
    rect(c, x - s * 0.4, y - s * 0.3, s * 0.8, s * 0.55, '#e9eef2');
    rect(c, x - s * 0.4, y - s * 0.05, s * 0.8, s * 0.06, '#4c8ef7');
    c.fillStyle = 'rgba(80,120,170,0.4)';
    for (let i = 0; i < 6; i++) c.fillRect(x - s * 0.35 + i * s * 0.12, y - s * 0.25, s * 0.06, s * 0.12);
    rect(c, x - s * 0.4, y + s * 0.3, s * 0.8, s * 0.12, '#55595e');
  },
  haven(c, x, y, s, st, r) {
    rect(c, x - s * 0.45, y - s * 0.45, s * 0.9, s * 0.9, '#6b665e');
    for (let i = 0; i < 3; i++) rect(c, x - s * 0.4 + i * s * 0.3, y + s * 0.1, s * 0.06, s * 0.38, '#8a7a62');
    const kleuren = ['#c0392b', '#2e86c1', '#f0b429', '#27ae60'];
    for (let i = 0; i < 6; i++) rect(c, x - s * 0.38 + (i % 3) * s * 0.14, y - s * 0.35 + Math.floor(i / 3) * s * 0.1, s * 0.12, s * 0.07, kleuren[Math.floor(r() * 4)]);
    c.strokeStyle = '#f0b429';
    c.lineWidth = Math.max(1, s * 0.03);
    c.beginPath(); c.moveTo(x + s * 0.2, y + s * 0.3); c.lineTo(x + s * 0.2, y - s * 0.3); c.lineTo(x + s * 0.4, y - s * 0.3); c.stroke();
  },
  opslag(c, x, y, s) {
    for (let i = 0; i < 2; i++) {
      rect(c, x - s * 0.4, y - s * 0.38 + i * s * 0.3, s * 0.6, s * 0.22, '#8c949c');
      c.strokeStyle = 'rgba(0,0,0,0.2)';
      c.lineWidth = 0.6;
      for (let k = 1; k < 5; k++) { c.beginPath(); c.moveTo(x - s * 0.4 + k * s * 0.12, y - s * 0.38 + i * s * 0.3); c.lineTo(x - s * 0.4 + k * s * 0.12, y - s * 0.16 + i * s * 0.3); c.stroke(); }
    }
    for (let i = 0; i < 4; i++) rect(c, x + s * 0.25, y - s * 0.35 + i * s * 0.12, s * 0.12, s * 0.09, '#a67c52');
    rect(c, x - s * 0.3, y + s * 0.3, s * 0.2, s * 0.1, '#c9b48a');
  },
  school(c, x, y, s, st, r) {
    rect(c, x - s * 0.4, y - s * 0.4, s * 0.5, s * 0.2, '#d9a441');
    rect(c, x - s * 0.4, y - s * 0.2, s * 0.2, s * 0.4, '#d9a441');
    rect(c, x + s * 0.05, y, s * 0.38, s * 0.38, '#5f9e53');
    c.strokeStyle = '#fff';
    c.lineWidth = 0.7;
    c.strokeRect(x + s * 0.1, y + s * 0.05, s * 0.28, s * 0.28);
  },
  universiteit(c, x, y, s, st) {
    rect(c, x - s * 0.42, y - s * 0.3, s * 0.84, s * 0.2, st.muur);
    rect(c, x - s * 0.42, y - s * 0.1, s * 0.2, s * 0.45, st.muur);
    rect(c, x + s * 0.22, y - s * 0.1, s * 0.2, s * 0.45, st.muur);
    rect(c, x - s * 0.2, y, s * 0.4, s * 0.35, '#5f9e53');
    koepel(c, x, y - s * 0.2, s * 0.1, '#8fa9c9');
  },
  ziekenhuis(c, x, y, s) {
    rect(c, x - s * 0.38, y - s * 0.32, s * 0.76, s * 0.64, '#f2f2f2');
    rect(c, x - s * 0.05, y - s * 0.2, s * 0.1, s * 0.4, '#d9443c');
    rect(c, x - s * 0.2, y - s * 0.05, s * 0.4, s * 0.1, '#d9443c');
  },
  politie(c, x, y, s) {
    rect(c, x - s * 0.36, y - s * 0.28, s * 0.72, s * 0.5, '#3b5b8c');
    rect(c, x - s * 0.1, y - s * 0.36, s * 0.2, s * 0.08, '#e8eef6');
    for (let i = 0; i < 2; i++) { rect(c, x - s * 0.3 + i * s * 0.3, y + s * 0.3, s * 0.22, s * 0.1, '#e8eef6'); rect(c, x - s * 0.3 + i * s * 0.3, y + s * 0.3, s * 0.22, s * 0.03, '#3b5b8c'); }
  },
  rechtbank(c, x, y, s, st) {
    rect(c, x - s * 0.4, y - s * 0.3, s * 0.8, s * 0.6, st.muur);
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 6; i++) c.fillRect(x - s * 0.35 + i * s * 0.13, y - s * 0.22, s * 0.04, s * 0.44);
    c.fillStyle = '#b8ad97';
    c.beginPath(); c.moveTo(x - s * 0.42, y - s * 0.3); c.lineTo(x, y - s * 0.45); c.lineTo(x + s * 0.42, y - s * 0.3); c.fill();
  },
  omroep(c, x, y, s, st, r, ctx) {
    rect(c, x - s * 0.4, y, s * 0.5, s * 0.36, '#6c7a89');
    c.strokeStyle = '#c7ccd1';
    c.lineWidth = Math.max(1, s * 0.025);
    c.beginPath(); c.moveTo(x + s * 0.25, y + s * 0.35); c.lineTo(x + s * 0.25, y - s * 0.42); c.stroke();
    c.beginPath(); c.moveTo(x + s * 0.15, y + s * 0.35); c.lineTo(x + s * 0.25, y - s * 0.1); c.lineTo(x + s * 0.35, y + s * 0.35); c.stroke();
    if (Math.floor(ctx.tijd * 2) % 2 === 0) { c.fillStyle = '#ff4d4d'; c.beginPath(); c.arc(x + s * 0.25, y - s * 0.42, s * 0.03, 0, Math.PI * 2); c.fill(); }
  },
  kazerne(c, x, y, s, st, r, ctx) {
    hek(c, x, y, s, '#8a8a73');
    for (let i = 0; i < 3; i++) rect(c, x - s * 0.36, y - s * 0.34 + i * s * 0.2, s * 0.45, s * 0.12, '#6b6b55');
    rect(c, x + s * 0.15, y - s * 0.1, s * 0.25, s * 0.4, '#a39a7a');
    vlag(c, x + s * 0.3, y - s * 0.15, s, ctx.kleur);
  },
  wapenfabriek(c, x, y, s, st, r, ctx) {
    hek(c, x, y, s, '#6d6d6d');
    rect(c, x - s * 0.38, y - s * 0.3, s * 0.6, s * 0.5, '#4f4a45');
    rect(c, x + s * 0.25, y - s * 0.4, s * 0.07, s * 0.25, '#3a3632');
    if (ctx.actief) rook(c, x + s * 0.28, y - s * 0.4, s, ctx.tijd, ctx.seed);
    for (let i = 0; i < 3; i++) rect(c, x - s * 0.3 + i * s * 0.18, y + s * 0.27, s * 0.13, s * 0.1, '#5d6b4a');
  },
  dronebasis(c, x, y, s) {
    rect(c, x - s * 0.45, y - s * 0.08, s * 0.9, s * 0.16, '#3d3f42');
    c.strokeStyle = '#f0f0f0';
    c.setLineDash([s * 0.06, s * 0.05]);
    c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(x - s * 0.42, y); c.lineTo(x + s * 0.42, y); c.stroke();
    c.setLineDash([]);
    rect(c, x - s * 0.3, y - s * 0.4, s * 0.35, s * 0.22, '#7c858e');
    rect(c, x + s * 0.1, y + s * 0.18, s * 0.3, s * 0.2, '#7c858e');
  },
  cybercentrum(c, x, y, s, st, r, ctx) {
    // Laag datacentrum met serverrijen en een schotel; de lampjes knipperen als het in bedrijf is.
    rect(c, x - s * 0.42, y - s * 0.3, s * 0.84, s * 0.6, '#2b3138');
    for (let i = 0; i < 4; i++) {
      rect(c, x - s * 0.36 + i * s * 0.19, y - s * 0.24, s * 0.12, s * 0.48, '#3c4650');
      if (ctx.actief !== false && Math.floor(ctx.tijd * 3 + i) % 2 === 0) rect(c, x - s * 0.33 + i * s * 0.19, y - s * 0.2, s * 0.05, s * 0.04, '#3ef0d0');
    }
    c.strokeStyle = '#c7ccd1';
    c.lineWidth = Math.max(1, s * 0.025);
    c.beginPath(); c.arc(x + s * 0.3, y + s * 0.36, s * 0.08, Math.PI, 0); c.stroke();
  },
};

function ster(c, x, y, r, kleur) {
  c.fillStyle = kleur;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

// Tekent een gebouw in detail. Geeft false terug als er geen detailtekening is (dan valt de kaart terug op het icoon).
export function tekenGebouwDetail(c, soort, x, y, s, ctx) {
  const f = TEKEN[soort] ?? TEKEN[ctx.alias];
  if (!f) return false;
  const st = stijlVan(ctx.regime);
  const r = rnd(ctx.seed * 7919 + 13);
  c.save();
  c.beginPath();
  c.rect(x - s / 2, y - s / 2, s, s);
  c.clip();
  if (ctx.voortgang != null) c.globalAlpha = 0.35 + 0.65 * ctx.voortgang;
  f(c, x, y, s, st, r, ctx);
  c.restore();
  if (ctx.voortgang != null) {
    c.strokeStyle = '#f0b429';
    c.setLineDash([s * 0.06, s * 0.05]);
    c.lineWidth = Math.max(1, s * 0.025);
    c.strokeRect(x - s * 0.46, y - s * 0.46, s * 0.92, s * 0.92);
    c.setLineDash([]);
    rect(c, x - s * 0.4, y + s * 0.38, s * 0.8, s * 0.06, '#0c131b');
    rect(c, x - s * 0.4, y + s * 0.38, s * 0.8 * ctx.voortgang, s * 0.06, '#f0b429');
  }
  // dunne rand in de kleur van de eigenaar
  c.strokeStyle = ctx.kleur;
  c.globalAlpha = 0.55;
  c.lineWidth = Math.max(1, s * 0.02);
  c.strokeRect(x - s / 2 + 1, y - s / 2 + 1, s - 2, s - 2);
  c.globalAlpha = 1;
  return true;
}

// Landschap op een onbebouwd vakje.
export function tekenTerreinDetail(c, terrein, x, y, s, seed) {
  const r = rnd(seed * 104729 + 7);
  if (terrein === 'bos') {
    for (let i = 0; i < 7; i++) boom(c, x - s * 0.4 + r() * s * 0.8, y - s * 0.4 + r() * s * 0.8, s * (0.07 + r() * 0.05));
  } else if (terrein === 'berg') {
    for (let i = 0; i < 3; i++) {
      const bx = x - s * 0.3 + r() * s * 0.6, by = y - s * 0.15 + r() * s * 0.4, h = s * (0.25 + r() * 0.15);
      c.fillStyle = '#6f6a62';
      c.beginPath(); c.moveTo(bx - h * 0.7, by + h * 0.3); c.lineTo(bx, by - h); c.lineTo(bx + h * 0.7, by + h * 0.3); c.fill();
      c.fillStyle = '#8c867c';
      c.beginPath(); c.moveTo(bx, by - h); c.lineTo(bx + h * 0.7, by + h * 0.3); c.lineTo(bx + h * 0.15, by + h * 0.3); c.fill();
      c.fillStyle = '#f2f2ef';
      c.beginPath(); c.moveTo(bx - h * 0.2, by - h * 0.55); c.lineTo(bx, by - h); c.lineTo(bx + h * 0.2, by - h * 0.55); c.fill();
    }
  } else if (terrein === 'vlakte') {
    c.strokeStyle = 'rgba(150,190,110,0.35)';
    c.lineWidth = Math.max(0.6, s * 0.012);
    for (let i = 0; i < 10; i++) {
      const gx = x - s * 0.45 + r() * s * 0.9, gy = y - s * 0.45 + r() * s * 0.9;
      c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + s * 0.02, gy - s * 0.05); c.stroke();
    }
    if (r() < 0.3) boom(c, x - s * 0.3 + r() * s * 0.6, y - s * 0.3 + r() * s * 0.6, s * 0.07);
  } else if (terrein === 'kust') {
    c.strokeStyle = 'rgba(170,215,240,0.5)';
    c.lineWidth = Math.max(0.8, s * 0.015);
    for (let i = 0; i < 2; i++) {
      const wy = y - s * 0.15 + i * s * 0.3;
      c.beginPath(); c.moveTo(x - s * 0.35, wy); c.quadraticCurveTo(x - s * 0.18, wy - s * 0.06, x, wy); c.quadraticCurveTo(x + s * 0.18, wy + s * 0.06, x + s * 0.35, wy); c.stroke();
    }
  }
}
