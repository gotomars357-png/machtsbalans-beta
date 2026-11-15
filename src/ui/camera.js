// Filmische camera: zacht zoomen, nalopen na slepen en vliegen in een boog. Pure rekensommen zonder DOM, zodat
// tools/cameratest.mjs ze in node kan nalopen; map.js roept ze per beeld aan met de dt van dat beeld.
// Wereld: 0..1000 bij 0..620. De schaal (schermpixels per wereldeenheid) is dezelfde als KaartView.schaal().

export const WERELD_B = 1000;
export const WERELD_H = 620;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 14;
// Tijdconstante van het wielzoomen in seconden: na 0,09 s is tweederde van de stap gezet.
export const ZOOM_TAU = 0.09;
// Nalopen: de snelheid neemt per seconde af met deze factor; onder STIL px/s staat de camera stil.
// 0,002 (niet 0,0025): zo staat een veeg van 1000 px/s binnen 0,8 s stil (1000 * 0,002^t < 8 bij t > 0,777 s).
export const GLIJ_DEMPING = 0.002;
export const GLIJ_STIL = 8;
// Een vlucht duurt hooguit zo lang; met minder beweging (prefers-reduced-motion) altijd KORT, zonder boog.
export const VLUCHT_MAX = 1.6;
export const VLUCHT_KORT = 0.25;
// De treden van dubbelklik en dubbeltik: van overzicht via land en stad naar de straat.
export const VERDIEPINGEN = [1.5, 2.5, 4, 6, 9, 14];
// Pijltjes schuiven per seconde dit deel van de schermbreedte.
export const PIJL_SNELHEID = 0.4;
// Een korte tik op een pijltje schuift minstens zo lang (ms), zodat hij ook werkt als hij korter is dan een beeld.
export const PIJL_TIK = 120;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (u) => u * u * (3 - 2 * u);

// Dezelfde formule als KaartView.schaal().
export function schaalBij(w, h, zoom) { return Math.min(w / WERELD_B, h / WERELD_H) * zoom; }

// Veer naar een doel, onafhankelijk van de beeldsnelheid. tau 0 (of kleiner) springt direct.
export function veer(huidig, doel, dt, tau) {
  if (!(tau > 0)) return doel;
  return huidig + (doel - huidig) * (1 - Math.exp(-dt / tau));
}

// Het middelpunt dat binnen de wereld blijft bij deze zoom, zoals KaartView.begrens().
export function begrensPunt(x, y, zoom, w, h) {
  const s = schaalBij(w, h, zoom);
  const halfW = w / 2 / s, halfH = h / 2 / s;
  return {
    x: halfW >= WERELD_B / 2 ? WERELD_B / 2 : clamp(x, halfW, WERELD_B - halfW),
    y: halfH >= WERELD_H / 2 ? WERELD_H / 2 : clamp(y, halfH, WERELD_H - halfH),
  };
}

// Het middelpunt waarbij wereldpunt (wx, wy) van het anker op schermpunt (sx, sy) ligt, zoals zoomRond().
export function ankerMidden(anker, zoom, w, h) {
  const s = schaalBij(w, h, zoom);
  return { x: anker.wx - (anker.sx - w / 2) / s, y: anker.wy - (anker.sy - h / 2) / s };
}

// Een vlucht van {x, y, zoom} naar {x, y, zoom}. Geeft { duur, boog, op(t) }; op(t) geeft {x, y, zoom} en op(duur)
// is exact het doel. Kort over het scherm: geen boog, de zoom blijft tussen start en doel. Ver weg (meer dan
// anderhalf scherm): de camera gaat halverwege eerst uit, zodat je ziet waar je heen gaat, en dan weer in.
export function vluchtPlan(van, naar, w, h, opties = {}) {
  const z0 = clamp(van.zoom, ZOOM_MIN, ZOOM_MAX), z1 = clamp(naar.zoom, ZOOM_MIN, ZOOM_MAX);
  const dx = naar.x - van.x, dy = naar.y - van.y;
  const zMin = Math.min(z0, z1);
  const afstandSchermen = w > 0 && h > 0 ? Math.hypot(dx, dy) * schaalBij(w, h, zMin) / Math.max(w, h) : 0;
  const kort = !!opties.kort;
  const duur = kort ? VLUCHT_KORT : Math.min(VLUCHT_MAX, 0.45 + 0.25 * Math.log2(afstandSchermen + 1));
  const boog = !kort && afstandSchermen > 1.5;
  const l0 = Math.log(z0), l1 = Math.log(z1), lLaag = Math.log(Math.max(ZOOM_MIN, zMin * 0.6));
  const doel = { x: naar.x, y: naar.y, zoom: z1 };
  const op = (t) => {
    if (!(t < duur)) return { x: doel.x, y: doel.y, zoom: doel.zoom };
    const u = t > 0 ? t / duur : 0;
    const s = smoothstep(u);
    let l = l0 + (l1 - l0) * s;
    if (boog) { const m = Math.sin(Math.PI * u); l = l * (1 - m) + lLaag * m; }
    return { x: van.x + dx * s, y: van.y + dy * s, zoom: clamp(Math.exp(l), ZOOM_MIN, ZOOM_MAX) };
  };
  return { duur, boog, afstandSchermen, op };
}

// Nalopen na loslaten: snelheid in schermpixels per seconde, gedempt over dt seconden. null = stil.
export function nalopen(vx, vy, dt) {
  const f = Math.pow(GLIJ_DEMPING, dt);
  vx *= f; vy *= f;
  return Math.hypot(vx, vy) < GLIJ_STIL ? null : { vx, vy };
}

// De snelheid van een veeg uit de punten { t (ms), x, y } van de laatste 80 ms. null als er te weinig is, of als de
// vinger (muis) vóór het loslaten al langer dan STIL_GEHOUDEN ms stillag: dan wilde je stoppen, niet gooien.
export const STIL_GEHOUDEN = 50;
export function veegSnelheid(punten, nu, venster = 80) {
  if (!punten.length || nu - punten[punten.length - 1].t > STIL_GEHOUDEN) return null;
  let a = -1;
  for (let i = 0; i < punten.length; i++) if (nu - punten[i].t <= venster) { a = i; break; }
  if (a < 0) return null;
  const p = punten[a], q = punten[punten.length - 1];
  const dt = (q.t - p.t) / 1000;
  if (dt < 0.008) return null;
  return { vx: (q.x - p.x) / dt, vy: (q.y - p.y) / dt };
}

// De volgende trede boven de huidige zoom; met terug de trede eronder (en onder de laagste: het overzicht).
export function volgendeVerdieping(zoom, terug = false) {
  const eps = 0.01;
  if (terug) {
    for (let i = VERDIEPINGEN.length - 1; i >= 0; i--) if (VERDIEPINGEN[i] < zoom - eps) return VERDIEPINGEN[i];
    return ZOOM_MIN;
  }
  for (let i = 0; i < VERDIEPINGEN.length; i++) if (VERDIEPINGEN[i] > zoom + eps) return VERDIEPINGEN[i];
  return ZOOM_MAX;
}
