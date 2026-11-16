// C14b Oplevering: het moment dat een bouwplaats begint en af is, als kort feest op de kaart. Alleen weergave: de
// volger leest land.bouw[] en state.bezet[] en schrijft niets in de toestand.
//
// OpleveringVolger.volg(state, nu) vergelijkt per beeld de bouwplaatsen met het vorige beeld (lussen op index, zonder
// iets aan te maken zolang er niets verandert) en geeft gebeurtenissen:
//   bouwstart      een nieuw bouwitem;
//   oplevering     een bouwitem is weg en state.bezet[tegel] = { land, gebouw, bouw: false } (dezelfde regel als de
//                  opleverping in C14a);
//   bouw_verloren  een bouwitem is weg zonder dat gebouw (bijvoorbeeld door oorlog): geen feest.
// Een nieuw state-object (laden, nieuw spel, replay) of een sprong van meer dan 30 dagen ijkt opnieuw, zonder
// gebeurtenissen. opBouwGebeurtenis(fn) en laatsteBouwGebeurtenissen(n) zijn er voor latere koppelingen (krant,
// tijdlijn); dit bestand maakt zelf geen toasts, pings of randpijlen.
//
// teken(c, kaart) tekent de effecten op echte tijd (nu), hooguit MAX_EFFECTEN tegelijk; de speler gaat voor. Effecten
// van AI-landen alleen in beeld, vanaf ZOOM_AI, op halve sterkte en hooguit MAX_AI tegelijk. Geen tekst, geen emoji.

import { tekenAfbouw, kavelInfo } from './detail.js';

export const MAX_EFFECTEN = 6, MAX_AI = 2, ZOOM_AI = 3.6;
export const DUUR = { bouwstart: 900, oprit: 2600, oplevering: 2400 };
const GOUD = '#f0b429';
const DIEP = 4, MINI = 2.5;

const luisteraars = [];
const laatste = [];
// Abonneer op bouwgebeurtenissen; geeft een functie die het abonnement opzegt.
export function opBouwGebeurtenis(fn) {
  luisteraars.push(fn);
  return () => { const i = luisteraars.indexOf(fn); if (i >= 0) luisteraars.splice(i, 1); };
}
// De laatste n gebeurtenissen (oudste eerst).
export function laatsteBouwGebeurtenissen(n = 10) { return laatste.slice(Math.max(0, laatste.length - n)); }

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const glad = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const uitloop = (v) => 1 - (1 - clamp(v, 0, 1)) ** 3;
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export class OpleveringVolger {
  constructor() {
    this.state = null;
    this.dag = 0;
    this.ref = [];      // bouwitems van het vorige beeld (objecten, in volgorde land, index)
    this.items = new Map(); // sleutel → { land, tegel, gebouw }
    this.nieuw = [];    // gebeurtenissen die teken() nog moet toelaten
    this.effecten = [];
    this.starts = [];   // recente bouwstarts die nog op hun oprit wachten
  }

  // Opnieuw ijken: de huidige bouwplaatsen zijn de uitgangsstand, zonder gebeurtenissen.
  ijk(state) {
    this.state = state;
    this.dag = state.dag;
    this.ref.length = 0;
    this.items = new Map();
    this.nieuw.length = 0;
    this.effecten.length = 0;
    this.starts.length = 0;
    const L = state.landen;
    for (let i = 0; i < L.length; i++) {
      const b = L[i].bouw;
      for (let j = 0; j < b.length; j++) { this.ref.push(b[j]); this.items.set(`${i}:${b[j].tegel}:${b[j].gebouw}`, { land: i, tegel: b[j].tegel, gebouw: b[j].gebouw }); }
      const pl = L[i].plaatsingen;
      for (let j = 0; j < pl.length; j++) if (pl[j].verbouw) { this.ref.push(pl[j].verbouw); this.items.set(`${i}:${pl[j].t}:v`, { land: i, tegel: pl[j].t, gebouw: pl[j].g, naar: pl[j].verbouw.naar }); }
    }
  }

  volg(state, nu) {
    if (!state) return;
    if (state !== this.state || Math.abs(state.dag - this.dag) > 30) { this.ijk(state); return; }
    this.dag = state.dag;
    // snel pad: dezelfde items in dezelfde volgorde
    const L = state.landen, ref = this.ref;
    let k = 0, gelijk = true;
    for (let i = 0; i < L.length && gelijk; i++) {
      const b = L[i].bouw;
      for (let j = 0; j < b.length; j++, k++) if (ref[k] !== b[j]) { gelijk = false; break; }
      // C15c: lopende verbouwingen tellen mee (het verbouw-object op de plaatsing)
      const pl = L[i].plaatsingen;
      for (let j = 0; j < pl.length && gelijk; j++) if (pl[j].verbouw) { if (ref[k] !== pl[j].verbouw) gelijk = false; else k++; }
    }
    if (gelijk && k === ref.length) return;
    // er is iets veranderd: sleutels vergelijken
    const oud = this.items, nieuw = new Map();
    ref.length = 0;
    for (let i = 0; i < L.length; i++) {
      const b = L[i].bouw;
      for (let j = 0; j < b.length; j++) {
        ref.push(b[j]);
        const sl = `${i}:${b[j].tegel}:${b[j].gebouw}`;
        nieuw.set(sl, { land: i, tegel: b[j].tegel, gebouw: b[j].gebouw });
        if (!oud.has(sl)) this.meld('bouwstart', i, b[j].tegel, b[j].gebouw, state, nu);
      }
      const pl = L[i].plaatsingen;
      for (let j = 0; j < pl.length; j++) {
        if (!pl[j].verbouw) continue;
        ref.push(pl[j].verbouw);
        nieuw.set(`${i}:${pl[j].t}:v`, { land: i, tegel: pl[j].t, gebouw: pl[j].g, naar: pl[j].verbouw.naar });
      }
    }
    for (const [sl, it] of oud) {
      if (nieuw.has(sl)) continue;
      if (it.naar != null) {
        // C15c: een verbouwing is weg. Staat de plaatsing er nog op het nieuwe niveau, dan hetzelfde feest als een nieuwbouw.
        const p = state.landen[it.land]?.plaatsingen.find((x) => x.t === it.tegel);
        if (p && (p.niveau ?? 1) >= it.naar) this.meld('oplevering', it.land, it.tegel, it.gebouw, state, nu, true);
        continue;
      }
      const bz = state.bezet[it.tegel];
      const af = !!bz && bz.land === it.land && bz.gebouw === it.gebouw && bz.bouw === false;
      this.meld(af ? 'oplevering' : 'bouw_verloren', it.land, it.tegel, it.gebouw, state, nu);
    }
    this.items = nieuw;
  }

  meld(soort, land, tegel, gebouw, state, nu, verbouw = false) {
    const tg = state.pack.geo.tegels[tegel];
    const e = { soort, land, tegel, gebouw, dag: state.dag, wx: tg?.x ?? 0, wy: tg?.y ?? 0, nu };
    if (verbouw) e.verbouw = true;
    laatste.push(e);
    if (laatste.length > 50) laatste.shift();
    for (let i = 0; i < luisteraars.length; i++) { try { luisteraars[i](e); } catch (err) { /* een koppeling mag de kaart niet stilzetten */ } }
    if (soort !== 'bouw_verloren') this.nieuw.push({ ...e, speler: land === state.speler });
  }

  // Een effect toelaten: de speler gaat voor, AI-landen alleen in beeld en vanaf ZOOM_AI, hooguit MAX_AI tegelijk.
  laatToe(e, kaart) {
    const E = this.effecten;
    if (!e.speler) {
      if (kaart.zoom < ZOOM_AI) return;
      const tg = kaart.geo?.tegels[e.tegel];
      if (!tg || !kaart.zichtbaar(tg)) return;
      let ai = 0, oudste = -1;
      for (let i = 0; i < E.length; i++) if (!E[i].speler) { ai++; if (oudste < 0) oudste = i; }
      if (ai >= MAX_AI) E.splice(oudste, 1);
      else if (E.length >= MAX_EFFECTEN) return;
    } else if (E.length >= MAX_EFFECTEN) {
      let i = 0;
      while (i < E.length && E[i].speler) i++;
      E.splice(i < E.length ? i : 0, 1); // eerst het oudste AI-effect, anders het oudste van de speler
    }
    E.push(e);
  }

  // Schaal van het merkje op de middenzoom: 1 → 1,25 → 1 in 0,35 s na een oplevering op tegel t.
  popVan(t) {
    const E = this.effecten, nu = this.nuTeken ?? 0;
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (e.tegel !== t || e.soort !== 'oplevering') continue;
      const f = (nu - e.nu) / 350;
      return f >= 0 && f < 1 ? 1 + 0.25 * Math.sin(Math.PI * f) : 1;
    }
    return 1;
  }

  teken(c, kaart) {
    const nu = kaart.nu ?? 0, z = kaart.zoom, E = this.effecten;
    this.nuTeken = nu;
    // nieuwe gebeurtenissen toelaten (een oplevering vervangt een lopende bouwstart op dezelfde tegel)
    for (let i = 0; i < this.nieuw.length; i++) {
      const e = this.nieuw[i];
      e.nu = nu;
      if (e.soort === 'oplevering') { for (let j = E.length - 1; j >= 0; j--) if (E[j].tegel === e.tegel && E[j].soort !== 'oplevering') E.splice(j, 1); }
      if (e.soort === 'bouwstart') this.starts.push({ tegel: e.tegel, land: e.land, gebouw: e.gebouw, speler: e.speler, wx: e.wx, wy: e.wy, nu });
      this.laatToe(e, kaart);
    }
    this.nieuw.length = 0;
    // oprit-aanleg: verschijnt de omgeving (met poort) van een tegel die minder dan 5 s geleden begon
    const net = kaart.wegennet;
    for (let i = this.starts.length - 1; i >= 0; i--) {
      const st = this.starts[i];
      if (nu - st.nu > 5000) { this.starts.splice(i, 1); continue; }
      const o = net?.omgeving?.(st.tegel);
      if (!o) continue;
      this.starts.splice(i, 1);
      if (o.poort >= 0) this.laatToe({ soort: 'oprit', tegel: st.tegel, land: st.land, gebouw: st.gebouw, speler: st.speler, wx: st.wx, wy: st.wy, nu }, kaart);
    }
    // verlopen effecten weg
    for (let i = E.length - 1; i >= 0; i--) if (nu - E[i].nu > DUUR[E[i].soort]) E.splice(i, 1);
    if (!E.length) return;
    const geo = kaart.geo, sc = kaart.schaal(), T = geo.T * sc;
    c.save();
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (!e.speler && z < ZOOM_AI) continue;
      const tg = geo.tegels[e.tegel];
      if (!tg || !kaart.zichtbaar(tg, 3)) continue;
      const [x, y] = kaart.naarScherm(tg.x, tg.y);
      const kleur = e.speler ? GOUD : kaart.kleurVan(kaart.state.landen[e.land]);
      const sterkte = e.speler ? 1 : 0.5;
      const t = nu - e.nu;
      if (e.soort === 'bouwstart') this.tekenStart(c, kaart, e, x, y, T, t, kleur, sterkte);
      else if (e.soort === 'oprit') this.tekenOprit(c, kaart, e, x, y, T, t, sterkte);
      else this.tekenOplevering(c, kaart, e, x, y, T, t, kleur, sterkte);
    }
    c.restore();
    c.globalAlpha = 1;
  }

  // Het zichtvak van de kavel in schermpixels (of de tegel zonder kavel).
  zicht(kaart, e, x, y, T) {
    const o = kaart.wegennet?.omgeving?.(e.tegel);
    const g = kaart.state.pack.gebouwIndex[e.gebouw];
    if (o && g) { try { const k = kavelInfo(o, g.tekening ?? e.gebouw); return [x + k.zicht[0] * T, y + k.zicht[1] * T, x + k.zicht[2] * T, y + k.zicht[3] * T, o]; } catch (err) { /* geen kavel */ } }
    return [x - 0.4 * T, y - 0.4 * T, x + 0.4 * T, y + 0.4 * T, o];
  }

  ring(c, x, y, r, kleur, a, T) {
    if (a <= 0.01 || r <= 0) return;
    c.globalAlpha = a;
    c.strokeStyle = kleur;
    c.lineWidth = Math.max(1.5, T * 0.03);
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
  }

  stof(c, k, n, f, T, seed, sterkte) {
    if (f <= 0 || f >= 1) return;
    const [x0, y0, x1, y1] = k, w = x1 - x0, h = y1 - y0;
    c.fillStyle = 'rgb(190,178,150)';
    for (let i = 0; i < n; i++) {
      // punten langs de rand van het zichtvak, elk wolkje drijft iets naar buiten
      const q = (i + hash(seed, i) * 0.6) / n, p = q * 4, zijde = Math.floor(p) & 3, u = p - Math.floor(p);
      let px = zijde === 0 ? x0 + u * w : zijde === 1 ? x1 : zijde === 2 ? x1 - u * w : x0;
      let py = zijde === 0 ? y0 : zijde === 1 ? y0 + u * h : zijde === 2 ? y1 : y1 - u * h;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, d = Math.hypot(px - mx, py - my) || 1;
      px += ((px - mx) / d) * f * T * 0.05; py += ((py - my) / d) * f * T * 0.05 - f * T * 0.02;
      c.globalAlpha = 0.5 * (1 - f) * sterkte;
      c.beginPath(); c.arc(px, py, Math.max(0.6, (0.3 + 0.7 * f) * 0.06 * T * (0.7 + 0.6 * hash(seed, i + 9))), 0, Math.PI * 2); c.fill();
    }
  }

  tekenStart(c, kaart, e, x, y, T, t, kleur, sterkte) {
    const f = t / DUUR.bouwstart;
    if (kaart.zoom >= DIEP) this.stof(c, this.zicht(kaart, e, x, y, T), 8, f, T, e.tegel, sterkte);
    this.ring(c, x, y, (0.3 + 0.6 * uitloop(f)) * T, kleur, (1 - f) * 0.9 * sterkte, T);
  }

  tekenOprit(c, kaart, e, x, y, T, t, sterkte) {
    if (kaart.zoom < ZOOM_AI) return;
    const o = kaart.wegennet?.omgeving?.(e.tegel);
    if (!o || o.poort < 0) return;
    const groei = uitloop(t / 1600), a = t < 1600 ? 1 : 1 - clamp((t - 1600) / 1000, 0, 1);
    const ax = x + o.oprit[0] * T, ay = y + o.oprit[1] * T, bx = x + o.oprit[2] * T, by = y + o.oprit[3] * T;
    c.globalAlpha = 0.85 * a * sterkte;
    c.strokeStyle = 'rgb(235,235,225)';
    c.lineCap = 'butt';
    c.lineWidth = Math.max(1.5, T * 0.1);
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + (bx - ax) * groei, ay + (by - ay) * groei); c.stroke();
    c.lineCap = 'butt';
  }

  tekenOplevering(c, kaart, e, x, y, T, t, kleur, sterkte) {
    const z = kaart.zoom, s = t / 1000;
    if (z >= DIEP) {
      const k = this.zicht(kaart, e, x, y, T);
      if (s < 0.8) {
        c.globalAlpha = sterkte;
        const g = kaart.state.pack.gebouwIndex[e.gebouw];
        tekenAfbouw(c, x, y, T, { omgeving: k[4] ?? null, gebouw: e.gebouw, alias: g?.tekening, seed: e.tegel, tijd: (kaart.nu ?? 0) / 1000 }, s / 0.8);
      }
      this.stof(c, k, 10, (s - 0.2) / 1.2, T, e.tegel + 17, sterkte);
      if (s > 0.6 && s < 1.4) {
        // lichtglans: een diagonale witte band die over het gebouw strijkt, geknipt op het zichtvak
        const f = (s - 0.6) / 0.8, [x0, y0, x1, y1] = k, w = x1 - x0, h = y1 - y0;
        c.save();
        c.beginPath(); c.rect(x0, y0, w, h); c.clip();
        const mid = x0 - h + (w + 2 * h) * glad(0, 1, f), bb = Math.max(2, w * 0.16);
        c.globalAlpha = 0.35 * Math.sin(Math.PI * f) * sterkte;
        c.fillStyle = '#ffffff';
        c.beginPath(); c.moveTo(mid, y1); c.lineTo(mid + bb, y1); c.lineTo(mid + bb + h, y0); c.lineTo(mid + h, y0); c.closePath(); c.fill();
        c.restore();
      }
    }
    const f = s / 1.2;
    if (f < 1) this.ring(c, x, y, (0.4 + 1.4 * uitloop(f)) * T, kleur, (1 - f) * sterkte, T);
    if (z < MINI) { const f2 = (s - 0.3) / 1.2; if (f2 > 0 && f2 < 1) this.ring(c, x, y, (0.4 + 1.4 * uitloop(f2)) * T, kleur, (1 - f2) * 0.8 * sterkte, T); }
  }
}
