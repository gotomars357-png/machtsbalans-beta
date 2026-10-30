// Eenvoudige lijngrafiek op canvas, scherp op retina.

export function tekenGrafiek(canvas, { xs, reeksen, yFormaat = (v) => v.toFixed(0), yMin = null, yMax = null }) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.floor(w * dpr)) { canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr); }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const pad = { l: 40, r: 40, t: 18, b: 18 };
  const n = xs.length;
  if (n < 2) {
    c.fillStyle = '#8496a9';
    c.font = '12px -apple-system, sans-serif';
    c.fillText('Grafiek vult zich zodra de tijd loopt.', pad.l, h / 2);
    return;
  }
  const x0 = xs[0], x1 = xs[n - 1];
  const px = (x) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);

  // Elke reeks mag een eigen as hebben (links of rechts).
  const assen = {};
  for (const r of reeksen) {
    const as = r.as ?? 'links';
    const a = (assen[as] ??= { min: Infinity, max: -Infinity, fmt: r.formaat ?? yFormaat });
    for (const v of r.waarden) { if (v < a.min) a.min = v; if (v > a.max) a.max = v; }
  }
  for (const a of Object.values(assen)) {
    if (yMin != null) a.min = yMin;
    if (yMax != null) a.max = yMax;
    if (a.max - a.min < Math.abs(a.max) * 0.02 + 1e-6) { const m = Math.abs(a.max) * 0.05 || 1; a.max += m; a.min -= m; }
    const marge = (a.max - a.min) * 0.08;
    a.max += marge;
    if (yMin == null) a.min -= marge;
  }
  const py = (a, v) => pad.t + (1 - (v - a.min) / (a.max - a.min)) * (h - pad.t - pad.b);

  c.strokeStyle = '#243243';
  c.lineWidth = 1;
  c.font = '10px ui-monospace, Menlo, monospace';
  for (let i = 0; i <= 3; i++) {
    const y = pad.t + (i / 3) * (h - pad.t - pad.b);
    c.beginPath(); c.moveTo(pad.l, y); c.lineTo(w - pad.r, y); c.stroke();
    for (const [naam, a] of Object.entries(assen)) {
      const v = a.max - (i / 3) * (a.max - a.min);
      c.fillStyle = '#8496a9';
      c.textAlign = naam === 'links' ? 'right' : 'left';
      c.fillText(a.fmt(v), naam === 'links' ? pad.l - 4 : w - pad.r + 4, y + 3);
    }
  }
  c.textAlign = 'left';
  c.fillStyle = '#8496a9';
  c.fillText(`dag ${x0}`, pad.l, h - 4);
  c.textAlign = 'right';
  c.fillText(`dag ${x1}`, w - pad.r, h - 4);

  let lx = pad.l;
  for (const r of reeksen) {
    const a = assen[r.as ?? 'links'];
    c.strokeStyle = r.kleur;
    c.lineWidth = r.dik ? 2.2 : 1.6;
    c.setLineDash(r.streep ? [4, 3] : []);
    c.beginPath();
    r.waarden.forEach((v, i) => { const x = px(xs[i]), y = py(a, v); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = r.kleur;
    c.textAlign = 'left';
    c.font = '11px -apple-system, sans-serif';
    c.fillText(r.label, lx, 11);
    lx += c.measureText(r.label).width + 14;
  }
}
