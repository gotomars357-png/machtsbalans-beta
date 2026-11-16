// Treinkaart (C15b): tik op een trein (zoom >= 4) en zie wat hij vervoert en waarheen, en volg hem. Puur: geen DOM,
// geen klok. Leest alleen de spoorlijnen van infra.js (routes, de treinen van het laatst getekende beeld in treinIn en
// de klok infra.u) en de toestand. De kaart zelf en het volgen zitten in VoertuigKaart (voertuigkaart.js).
//
// Een trein heeft een sleutel die een nieuwe layout van infra overleeft: begin- en eindtegel van zijn lijn en zijn
// nummer op die lijn. Verdwijnt de lijn, dan vindt treinRoute hem niet meer (de kaart zegt dan 'Lijn opgeheven').

import { treinStandVan, puntOp } from './infra.js';
import { plekNaam } from './voertuigkaart.js';

// Vanaf deze zoom zijn treinen aan te tikken (infra.js tekent ze vanaf 3,6 en vol vanaf 4,4).
export const ZOOM_TREIN = 4;
// Halve breedte van een wagon in tegelmaat, zoals tekenTreinen in infra.js hem tekent (B = 0.017 * T).
const WAGON_B = 0.017;
const PUNTEN = 7; // van staart tot kop

export const treinSleutel = (r, j) => `trein:${r.van}>${r.naar}:${j}`;

// De route bij een sleutel opnieuw zoeken (op index): { r, ri, j } of null.
export function treinRoute(infra, sleutel) {
  if (!infra?.routes || typeof sleutel !== 'string' || !sleutel.startsWith('trein:')) return null;
  const m = /^trein:(-?\d+)>(-?\d+):(\d+)$/.exec(sleutel);
  if (!m) return null;
  const van = +m[1], naar = +m[2], j = +m[3], R = infra.routes;
  for (let ri = 0; ri < R.length; ri++) {
    const r = R[ri];
    if (r.van === van && r.naar === naar && j < (r.treinen?.length ?? 0)) return { r, ri, j };
  }
  return null;
}

const TMP = {}, PT = {};

// Afstand van (px, py) tot het lijnstuk a-b.
function totStuk(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const f = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - dx * f, py - ay - dy * f);
}

// De trein onder een schermpunt van het laatst getekende beeld: { sleutel, ri, j } of null. gebouwOp(sx, sy) zegt of
// daar een gebouw, hoofdstad, kolonie of station ligt: dan wint de trein alleen op de wagons zelf.
export function treinOp(infra, view, sx, sy, touch, gebouwOp = null) {
  if (!infra || !(view?.zoom >= ZOOM_TREIN) || !(infra.zoom >= ZOOM_TREIN) || !infra.nTreinIn) return null;
  const sc = infra.sc, ox = infra.ox, oy = infra.oy, Tw = infra.geo.T, B = WAGON_B * infra.T;
  const marge = B + (touch ? 6 : 2);
  let best = null, bd = Infinity;
  for (let k = 0; k < infra.nTreinIn; k++) {
    const ri = infra.treinIn[k * 2], j = infra.treinIn[k * 2 + 1], r = infra.routes[ri];
    if (!r?.treinen?.[j]) continue;
    const st = treinStandVan(r, j, infra.u, Tw, TMP);
    // grof: het midden van de trein ligt verder dan zijn halve lengte plus de marge
    puntOp(r, st.kop - st.rich * st.ltr * 0.5, PT);
    if (Math.hypot(PT.px * sc + ox - sx, PT.py * sc + oy - sy) > st.ltr * sc * 0.5 + marge + 2) continue;
    let d = Infinity, vx = 0, vy = 0;
    for (let i = 0; i < PUNTEN; i++) {
      puntOp(r, st.staart + ((st.kop - st.staart) * i) / (PUNTEN - 1), PT);
      const x = PT.px * sc + ox, y = PT.py * sc + oy;
      if (i) d = Math.min(d, totStuk(sx, sy, vx, vy, x, y));
      vx = x; vy = y;
    }
    if (d >= marge || d >= bd) continue;
    best = { ri, j, r, d }; bd = d;
  }
  if (!best) return null;
  if (bd > B && gebouwOp && gebouwOp(sx, sy)) return null;
  return { sleutel: treinSleutel(best.r, best.j), ri: best.ri, j: best.j };
}

// Waar is de trein met deze sleutel nu? Vult uit: x, y (midden, wereld), kop, staart, rich, ltr, ri, j, r en toestand
// ('rijdt', 'station' aan het begin van de lijn, 'eind' aan het kopperron). Geeft null als de lijn weg is.
export function treinPlek(infra, sleutel, uit = {}) {
  const g = treinRoute(infra, sleutel);
  if (!g) return null;
  const { r, ri, j } = g;
  const st = treinStandVan(r, j, infra.u ?? 0, infra.geo.T, TMP);
  puntOp(r, st.kop - st.rich * st.ltr * 0.5, PT);
  uit.x = PT.px; uit.y = PT.py;
  uit.kop = st.kop; uit.staart = st.staart; uit.rich = st.rich; uit.ltr = st.ltr;
  uit.ri = ri; uit.j = j; uit.r = r;
  const t = st.tTrein;
  uit.toestand = t < st.wacht ? 'station' : t >= st.wacht + st.rit && t < 2 * st.wacht + st.rit ? 'eind' : 'rijdt';
  return uit;
}

const STAND = { rijdt: 'rijdt', station: 'staat op het station', eind: 'keert aan het kopperron' };

// Puur: wat de kaart toont over een trein (plek zoals treinPlek die vult).
export function treinInfo(view, plek) {
  const s = view.state, P = s.pack, r = plek.r;
  const landNaam = s.landen[r.land]?.naam ?? '';
  let van = r.station ? `Station ${landNaam}` : plekNaam(s, r.van);
  let naar = plekNaam(s, r.naar);
  if (plek.rich < 0) { const x = van; van = naar; naar = x; }
  let lading;
  if (r.goederen) {
    const g = P.gebouwIndex[s.bezet?.[r.naar]?.gebouw];
    const eerste = (o) => { for (const k in o ?? {}) if (o[k] > 0) return k; return null; };
    const res = plek.rich > 0 ? eerste(g?.verbruik) : eerste(g?.productie);
    const resNaam = res ? (P.resIndex?.[res]?.naam ?? res).toLowerCase() : null;
    lading = resNaam ?? (plek.rich > 0 ? 'goederen' : 'leeg, terug');
  } else lading = 'reizigers';
  const titel = r.goederen ? 'Goederentrein' : 'Personentrein';
  return { titel, van, naar, lading, regels: [['Lading', lading], ['Van', van], ['Naar', naar]], stand: STAND[plek.toestand] ?? 'rijdt', land: landNaam };
}
