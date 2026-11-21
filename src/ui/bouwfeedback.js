// C16c: eerlijke bouwkaart en zichtbare terugkoppeling na bouwen.
//
// Twee delen:
// - Puur (geen DOM, draait in node): bouwKaartGegevens(s, gebouwId) en effectNaBouwen(). Ze lezen de toestand en
//   veranderen hem nooit. Beide rekenen via evenwicht.js (c16a): bouwKaartData en effectVan zijn de gedeelde bron.
// - DOM en kaart: maakBouwfeedback(ui, {toast}) luistert naar 'bouwfeedback' en 'order' op window (verstuurd door
//   ordersignaal.js van c16b) en toont dan een toast met speldje, een zwevend label boven de tegel en (desktop, Auto)
//   een korte camerasprong. Deze module geeft nooit een order en schrijft nooit in de speltoestand.

import * as sim from '../engine/sim.js';
import { bouwKaartData as evenwichtKaart, effectVan } from './evenwicht.js';

export const LABEL_MS = 1400;           // zo lang zweeft het label boven de tegel
export const LABEL_STIJG = 22;          // zo veel px stijgt het label in die tijd
export const ORANJE_DAGEN = 30;         // een grondstof die binnen zo veel dagen op is, telt als (oranje) tekort
export const NAAR_PLEK_ZOOM = 5;        // zoom bij "breng me naar de plek"
const RAND = 40;                        // zo ver van de rand telt een tegel nog als "in beeld"
const MAX_EFFECT = 3;

export const TEKST = {
  gestart: (naam, d) => `${naam} gestart, klaar over ${d} d`,
  mist: (stukken, d) => `nog ${stukken}${d != null ? ` · ±${d} d` : ' · sparen lukt nu niet'}`,
  projecten: (max) => `Maximaal ${max} projecten tegelijk`,
  grond: 'Geen geschikte grond vrij',
  slot: 'Komt vrij in een latere fase',
};

// ---------- puur ----------

function speler(s) { return s.landen[s.speler]; }

// Netto per dag van een grondstof (kapitaal: het inkomen na onderhoud).
export function nettoPerDag(s, c, r) {
  if (r === s.pack.rollen.geld) return c.inkomen ?? 0;
  return c.netto?.[r] ?? 0;
}

// Effect als lijst [{r, nu, delta, na}] uit het object per {r: delta} van evenwicht.effectVan. Volgorde: productie,
// verbruik, dan de rest (belasting en energie door kapitaal, onderhoud). Verwaarloosbare deltas vallen weg.
export function effectLijst(s, gebouwId, per) {
  const c = speler(s);
  const g = s.pack.gebouwIndex[gebouwId];
  if (!g || !per) return [];
  const volgorde = [...Object.keys(g.productie || {}), ...Object.keys(g.verbruik || {}), ...Object.keys(per)];
  const gezien = {};
  const uit = [];
  for (let i = 0; i < volgorde.length; i++) {
    const r = volgorde[i];
    if (gezien[r] || !(r in per) || Math.abs(per[r]) < 1e-9) continue;
    gezien[r] = true;
    const nu = nettoPerDag(s, c, r);
    uit.push({ r, nu, delta: per[r], na: nu + per[r] });
  }
  return uit;
}

// Wat het gebouw per dag verandert: [{r, nu, delta, na}]. Eén rekensom met de evenwichtsbalk (evenwicht.effectVan).
export function effectNaBouwen(s, gebouwId, tegel = null) {
  if (!s.pack.gebouwIndex[gebouwId]) return [];
  return effectLijst(s, gebouwId, effectVan(s, gebouwId, tegel).per);
}

// Is grondstof r nu een tekort? 'rood' (niet genoeg voorzien) of 'oranje' (op binnen ORANJE_DAGEN), anders null.
export function tekortVan(s, c, r) {
  if (r === s.pack.rollen.geld) return (c.voorraad[r] ?? 0) < 0 ? 'rood' : null;
  if ((c.ratio?.[r] ?? 1) < 1) return 'rood';
  const n = c.netto?.[r] ?? 0;
  if (n < 0 && (c.voorraad[r] ?? 0) / -n < ORANJE_DAGEN) return 'oranje';
  return null;
}

// De bouwkaart van één gebouw: evenwicht.bouwKaartData (c16a, dezelfde toetsen als de engine) plus wat de bouwlijst
// nodig heeft: effect als lijst {r, nu, delta, na}, het aantal vrije plekken en het gebouw. Het oorspronkelijke
// effectobject blijft als effectPer beschikbaar.
export function bouwKaartGegevens(s, gebouwId, lijst = null) {
  const d = evenwichtKaart(s, gebouwId, lijst);
  const c = speler(s);
  const g = s.pack.gebouwIndex[gebouwId];
  return { ...d, effectPer: d.effect, effect: effectLijst(s, gebouwId, d.effect?.per), vrij: g ? sim.vrijePlekken(s, c, gebouwId) : 0, gebouw: g };
}

// "nog 20 ⛏ · ±6 d" (of null als alles betaalbaar is).
export function mistTekst(s, data) {
  const stukken = data.kostPerGrondstof.filter((k) => !k.ok).map((k) => `${Math.ceil(k.nodig - k.heb)} ${s.pack.resIndex[k.r]?.icoon ?? k.r}`);
  if (!stukken.length) return null;
  return TEKST.mist(stukken.join(' '), isFinite(data.dagenSparen) ? data.dagenSparen : null);
}

const getal = (v) => (Math.abs(v) >= 10 ? Math.round(Math.abs(v)).toString() : Math.abs(v).toFixed(1).replace(/\.0$/, ''));
const teken = (v) => (v >= 0 ? '+' : '−');
export const metTeken = (v) => `${teken(v)}${getal(v)}`;

// "⚡ −3 → ±+9 /d" per grondstof (hooguit MAX_EFFECT).
// Een regel die je niet ziet veranderen (bijv. ◈ +24 → ±+24 door een klein onderhoud) laten we weg.
export const zichtbaarEffect = (e) => metTeken(e.nu) !== metTeken(e.na);
export function naBouwenStukken(s, effect) {
  return effect.filter(zichtbaarEffect).slice(0, MAX_EFFECT).map((e) => ({ r: e.r, tekst: `${s.pack.resIndex[e.r]?.icoon ?? e.r} ${metTeken(e.nu)} → ±${metTeken(e.na)} /d`, goed: e.delta >= 0 }));
}

// Het effect uit de gebeurtenis van c16b in één vorm: [{r, delta}]. Accepteert een lijst ({r, delta} of {r, na, nu}) of
// een object {r: delta}; anders null.
export function normaliseerEffect(effect) {
  if (!effect) return null;
  if (Array.isArray(effect)) {
    const uit = [];
    for (const e of effect) {
      if (!e || !e.r) continue;
      const d = e.delta ?? (e.na != null && e.nu != null ? e.na - e.nu : e.per_dag ?? e.waarde);
      if (typeof d === 'number' && isFinite(d)) uit.push({ r: e.r, delta: d });
    }
    return uit.length ? uit : null;
  }
  if (typeof effect === 'object') {
    const uit = [];
    for (const [r, d] of Object.entries(effect)) if (typeof d === 'number' && isFinite(d)) uit.push({ r, delta: d });
    return uit.length ? uit : null;
  }
  return null;
}

// "+12⚡ · 5 d": het grootste positieve effect, of anders het eerste.
export function labelTekst(s, effect, dagen) {
  const E = normaliseerEffect(effect) ?? [];
  let best = null;
  for (const e of E) if (e.delta > 0 && (!best || e.delta > best.delta)) best = e;
  if (!best) best = E[0] ?? null;
  const ico = best ? (s.pack.resIndex[best.r]?.icoon ?? best.r) : '';
  return best ? `${metTeken(best.delta)}${ico} · ${dagen} d` : `${dagen} d`;
}

// Gegevens voor de terugkoppeling uit de gebeurtenis; vult tegel en klaarDag aan uit de laatste c.bouw-regel.
export function feedbackGegevens(s, d) {
  const c = speler(s);
  const g = s.pack.gebouwIndex[d?.gebouw];
  if (!g) return null;
  let regel = null;
  for (let i = c.bouw.length - 1; i >= 0; i--) {
    const b = c.bouw[i];
    if (b.gebouw === g.id && (d.tegel == null || b.tegel === d.tegel)) { regel = b; break; }
  }
  const tegel = d.tegel ?? regel?.tegel ?? -1;
  const klaarDag = d.klaarDag ?? regel?.klaar ?? s.dag + (g.bouwtijd ?? 5);
  const dagen = Math.max(0, klaarDag - s.dag);
  const effect = normaliseerEffect(d.effect) ?? effectNaBouwen(s, g.id, tegel >= 0 ? tegel : null).map((e) => ({ r: e.r, delta: e.delta }));
  return { g, tegel, dagen, effect, toast: TEKST.gestart(g.naam, dagen), label: labelTekst(s, effect, dagen) };
}

// ---------- camera ----------

// Zoveel px van de onderkant van het kaartvenster is bedekt (de lade van c16b of een ander onderpaneel).
export function zichtOnder(kaart) {
  if (typeof document === 'undefined' || !kaart?.canvas?.getBoundingClientRect) return 0;
  const cv = kaart.canvas.getBoundingClientRect();
  let onder = 0;
  for (const sel of ['#bouwlade', '#plaatsbalk']) {
    const el = document.querySelector(sel);
    if (!el || el.hidden || el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (!r.height || r.bottom < cv.top || r.top > cv.bottom) continue;
    onder = Math.max(onder, cv.bottom - Math.max(cv.top, r.top));
  }
  return Math.max(0, Math.min(onder, kaart.h * 0.8));
}

// Staat de tegel in het vrije deel van het kaartvenster?
export function plekInBeeld(kaart, tegel, onder = zichtOnder(kaart)) {
  const tg = kaart?.geo?.tegels?.[tegel];
  if (!tg) return false;
  const [x, y] = kaart.naarScherm(tg.x, tg.y);
  return x >= RAND && y >= RAND && x <= kaart.w - RAND && y <= kaart.h - onder - RAND;
}

// Vlieg naar de bouwplek, met de tegel midden in het vrije deel (boven een lade). Bij minder beweging maakt
// KaartView.vliegNaar er zelf een korte sprong van (this.rustig).
export function vliegNaarPlek(kaart, tegel, zoom = null) {
  const tg = kaart?.geo?.tegels?.[tegel];
  if (!tg) return false;
  const z = Math.max(kaart.zoom ?? 1, zoom ?? NAAR_PLEK_ZOOM);
  // KaartView.vliegNaar houdt sinds c16b zelf rekening met de lade (kaart.zichtOnder); dan hier niet nog eens.
  const onder = typeof kaart.zichtOnder === 'number' ? 0 : zichtOnder(kaart);
  const sc = Math.min(kaart.w / 1000, kaart.h / 620) * z; // zoals KaartView.schaal()
  kaart.vliegNaar(tg.x, tg.y + (sc > 0 ? onder / 2 / sc : 0), z);
  return true;
}

// ---------- zwevende labels (canvas) ----------

// Één aanroep per beeld vanuit map.js, direct na tekenBouwVoorbeeld. Kost niets zonder labels.
export function tekenLabels(c, kaart, nu) {
  const L = kaart.bouwLabels;
  if (!L || !L.length) return;
  let n = 0;
  for (let i = 0; i < L.length; i++) if (nu - L[i].geboren < LABEL_MS) L[n++] = L[i];
  L.length = n;
  if (!n) return;
  c.save();
  c.font = '600 13px system-ui, -apple-system, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const l = L[i];
    const f = Math.max(0, (nu - l.geboren) / LABEL_MS);
    const [x, y0] = kaart.naarScherm(l.wx, l.wy);
    const y = y0 - 26 - f * LABEL_STIJG;
    if (x < -80 || y < -30 || x > kaart.w + 80 || y > kaart.h + 30) continue;
    c.globalAlpha = f < 0.7 ? 1 : Math.max(0, 1 - (f - 0.7) / 0.3);
    const b = c.measureText(l.tekst).width + 16;
    c.fillStyle = 'rgba(13,20,28,0.92)';
    c.strokeStyle = '#5fd38d';
    c.lineWidth = 1.5;
    c.beginPath();
    if (c.roundRect) c.roundRect(x - b / 2, y - 12, b, 24, 12); else c.rect(x - b / 2, y - 12, b, 24);
    c.fill(); c.stroke();
    c.fillStyle = '#e8f6ee';
    c.fillText(l.tekst, x, y + 0.5);
  }
  c.restore();
}

// ---------- samenbinden (DOM) ----------

function minderBeweging(kaart) {
  if (kaart && typeof kaart.rustig === 'boolean') return kaart.rustig;
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
function telefoon() {
  try { return typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches; } catch { return false; }
}

// Koppelt de terugkoppeling aan window. venster en nu zijn er voor de test (node).
export function maakBouwfeedback(ui, { toast, venster = typeof window !== 'undefined' ? window : null, nu = () => ui.kaart?.echtNu ?? 0 } = {}) { // de klok van de kaart (map.js), geen eigen klok
  if (!venster?.addEventListener) return null;
  const fb = { laatsteOrder: null, getoond: 0 };

  fb.toon = (d) => {
    const s = ui.state;
    const kaart = ui.kaart;
    if (!s || !d) return null;
    const v = feedbackGegevens(s, d);
    if (!v) return null;
    const tg = v.tegel >= 0 ? s.pack.geo.tegels[v.tegel] : null;
    const ping = tg ? { id: 0, soort: 'bouw', t: v.tegel, wx: tg.x, wy: tg.y, pict: 'huisje', vliegZoom: Math.max(kaart?.zoom ?? 1, NAAR_PLEK_ZOOM), gezien: 0, gezienOp: null } : null;
    toast?.(v.toast, 'goed', ping);
    const rustig = minderBeweging(kaart);
    if (kaart && tg && !rustig) {
      (kaart.bouwLabels ??= []).push({ wx: tg.x, wy: tg.y, tekst: v.label, geboren: nu() });
    }
    // Desktop, Auto: de speler koos de plek niet zelf; laat hem zien waar het gebouw komt.
    const order = d.order ?? fb.laatsteOrder;
    const auto = !!order && order.type === 'bouw' && order.tegel == null;
    if (kaart && tg && auto && !telefoon() && !plekInBeeld(kaart, v.tegel)) vliegNaarPlek(kaart, v.tegel);
    fb.getoond++;
    return v;
  };

  venster.addEventListener('order', (e) => { fb.laatsteOrder = e.detail?.order ?? null; });
  venster.addEventListener('bouwfeedback', (e) => { try { fb.toon(e.detail); } catch (err) { console.warn('bouwfeedback', err); } });

  // Tik op een lopend project (data-plek="<tegel>", in de bouwlijst en straks in de lade): de camera naar de plek.
  const doc = venster.document;
  const naarPlek = (e) => {
    const el = e.target?.closest?.('[data-plek]');
    if (!el || !ui.kaart || !ui.state) return false;
    const t = +el.dataset.plek;
    if (!(t >= 0)) return false;
    vliegNaarPlek(ui.kaart, t);
    if (telefoon() && doc.body?.dataset?.onderpaneel !== 'lade') doc.querySelector?.('#kaart-wrap')?.scrollIntoView?.({ block: 'start', behavior: minderBeweging(ui.kaart) ? 'auto' : 'smooth' });
    return true;
  };
  doc?.addEventListener?.('click', naarPlek);
  // Ook met het toetsenbord (de regel heeft role="button" en tabindex): Enter of spatie.
  doc?.addEventListener?.('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && naarPlek(e)) e.preventDefault?.();
  });
  return fb;
}
