// Natuur bij diep inzoomen (C8): wat er in bos, bergen en water beweegt, bovenop het gebakken terrein.
// - Water: watervallen waar een rivier steil zakt (witte val, schuim dat uitdijt, nevel die meedrijft, bij zon soms
//   een regenboog), stroomversnellingen met schuimkoppen en keien, bevers met hun dam, burcht en vijver in beken.
// - Wild: wilde zwijnen met biggen, vossen en konijnen aan bosranden en op open plekken, berggeiten op de rotsen,
//   roofvogels die boven de bergen cirkelen, reigers langs de oever en ooievaars in natte weiden (niet in de winter),
//   wolven met sporen in de sneeuw (alleen in de winter), vuurvliegjes boven het water op zomeravonden.
// - Bergleven: zigzagpaden naar hutten met rook uit de schoorsteen en een uitzichtpunt, wandelaars in de zomer,
//   per land hooguit één skigebied bij de hoofdstad (stoeltjeslift met draaiende stoeltjes, in de winter witte pistes
//   met skiërs) en een kabelbaan met twee gondels naar een hoge top.
// Herten, kuddes, eenden, meeuwen, vlinders en vallend blad horen bij leven.js en komen hier niet nog eens.
//
// Plaatsing hangt alleen af van de wereld (vaste hashes van vakje, rivierpunt en index, eenmalig in laad), niet van
// de toestand: na opslaan en laden staat alles weer op dezelfde plek. De klok (nu) stuurt alleen beweging. Alles staat
// op terrein dat klopt: nooit in zee of in een stad, dieren, hutten en beverburchten nooit op een boomkruin
// (TerreinLaag.boomvrij), bergpaden alleen zichtbaar buiten het bos, skistations op een eigen plein. Elk ding kent de
// vakjes waar het op staat of overheen loopt; komt op één daarvan een gebouw (state.bezet), dan verdwijnt het (een
// pad of piste alleen voor het stuk dat geraakt wordt; een skigebied wijkt uit naar een reserveplek). Deze module
// schrijft nooit in state.
// Plafonds per frame (PLAFOND), alleen wat in beeld is, en geen allocaties in de tekenlussen.

import { seizoen, weer, wind } from './seizoen.js';
import { BOOMGRENS, ALMGRENS, SNEEUW_VAST } from './terrein.js';

const TAU = Math.PI * 2;
function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);

// Geen document bij importeren: de canvasfabriek is pas nodig bij laad() en is te vervangen in tests.
let maakCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
export function zetCanvasFabriek(fn) { maakCanvas = fn; }

// Harde plafonds per frame.
export const PLAFOND = {
  watervallen: 12, versnellingen: 30, zwijnen: 30, vossen: 8, konijnen: 40, geiten: 30, roofvogels: 6, reigers: 12,
  ooievaars: 10, bevers: 6, wolven: 12, sporen: 20, vuurvliegjes: 80, skiers: 40, stoeltjes: 60, gondels: 4,
  wandelaars: 20, hutten: 12, paden: 16, liften: 4, uitzicht: 16,
};

// Dieren op de grond: soort, naam voor het plafond, lengte in wereldeenheden, snelheid (lussen per seconde).
const ZWIJN = 0, VOS = 1, KONIJN = 2, GEIT = 3, REIGER = 4, OOIEVAAR = 5;
const DIER_NAAM = ['zwijnen', 'vossen', 'konijnen', 'geiten', 'reigers', 'ooievaars'];
const DIER_LENGTE = [0.3, 0.28, 0.14, 0.3, 0.3, 0.32];
const DIER_V = [0.05, 0.08, 0.07, 0.025, 0, 0.03];
const JAS = ['#c0392b', '#2e86c1', '#f0b429', '#2f9e5b', '#8a4bb8', '#ecefe9'];
const REGENBOOG = ['rgba(230,70,60,0.2)', 'rgba(240,200,60,0.2)', 'rgba(80,190,90,0.2)', 'rgba(80,120,230,0.2)'];
const STREEP_VAL = [0.22, 0.16], STREEP_PAD = [0.32, 0.18], GEEN_STREEP = [];
// Silhouet van een roofvogel van boven (x vooruit, y opzij), in lengtes; punten 2, 3, 8 en 9 zijn de vleugelpunten.
const VLEUGEL = new Float32Array([0.26, 0, 0.05, -0.12, -0.06, -0.62, -0.2, -0.5, -0.14, -0.1, -0.42, -0.08, -0.42, 0.08, -0.14, 0.1, -0.2, 0.5, -0.06, 0.62, 0.05, 0.12]);
// Welke dieren in buf een laag krijgen: alle, groot of klein (zwijn en big), licht of donker (geit).
const ALLE = 0, GROOT = 1, KLEIN = 2, LICHT = 3, DONKER = 4;

// Lichtfase uit de klok, precies als tekenNacht in map.js (die zet view.nacht pas na deze laag).
function nachtOp(nu) {
  const licht = 0.5 + 0.5 * Math.cos(((nu / 1000) % 180) / 180 * TAU);
  return clamp((0.5 - licht) / 0.5, 0, 1);
}

const ellips = (c, x, y, rx, ry, a) => { c.moveTo(x + Math.cos(a) * rx, y + Math.sin(a) * rx); c.ellipse(x, y, rx, ry, a, 0, TAU); };
const rond = (c, x, y, r) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); };

export class NatuurLaag {
  constructor() {
    this.geo = null;
    this.n = {};
    for (const k of Object.keys(PLAFOND)) this.n[k] = 0;
    this.buf = new Float32Array(4 * 96); // posities van één soort in beeld: x, y, hoek, schaal
    this.liftNu = []; // per frame: per land de eerste skiplek zonder gebouw
    this.p3 = new Float32Array(4); // x, y, hoek (en bij langs(): het stuk van de lijn)
  }

  // ---------- plaatsing (eenmalig per wereld) ----------

  laad(view) {
    this.geo = view.geo;
    this.terrein = view.terreinLaag;
    this.basis = this.terrein?.basis ?? null;
    this.eigenaar = view.eigenaar;
    this.landen = view.state?.landen ?? [];
    const geo = this.geo, tl = this.terrein;
    this.dieren = []; this.roof = []; this.bevers = []; this.vlieg = []; this.wolven = []; this.snel = [];
    this.paden = []; this.hutten = []; this.liften = []; this.kabels = []; this.vallen = [];
    if (!geo || !tl || !this.basis || !this.eigenaar) return;
    // nevel: één zacht wit vlekje, bij watervallen honderden keren hergebruikt
    this.nevel = maakCanvas(32, 32);
    const nc = this.nevel.getContext('2d');
    const g = nc.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    nc.fillStyle = g; nc.fillRect(0, 0, 32, 32);
    // vuurvliegje: een geelgroen gloeipuntje
    this.gloei = maakCanvas(16, 16);
    const gc = this.gloei.getContext('2d');
    const g2 = gc.createRadialGradient(8, 8, 0, 8, 8, 8);
    g2.addColorStop(0, 'rgba(250,255,190,1)'); g2.addColorStop(0.3, 'rgba(210,250,120,0.7)'); g2.addColorStop(1, 'rgba(160,230,80,0)');
    gc.fillStyle = g2; gc.fillRect(0, 0, 16, 16);

    this.plaatsWater();
    this.plaatsWild();
    this.plaatsBergen();
  }

  // Hoogte op de schaal van de bergzones, precies zoals de gebakken grond (alleen bij het plaatsen).
  h(x, y) { return this.terrein.hoogte(x, y); }
  tegelVan(x, y) {
    const geo = this.geo;
    return clamp(Math.floor(y / geo.T), 0, geo.rij - 1) * geo.kol + clamp(Math.floor(x / geo.T), 0, geo.kol - 1);
  }
  zee(x, y) { return x < 0 || y < 0 || x >= 1000 || y >= 620 || this.eigenaar[Math.floor(y) * 1000 + Math.floor(x)] === -1; }
  nat(x, y, marge = 0.3) { return this.zee(x, y) || this.terrein.isRivier(x, y, marge) || this.terrein.isMeer(x, y); }
  bergmeerBij(x, y, m) { for (const b of this.terrein.bergmeren) if (Math.hypot(b.x - x, b.y - y) < b.r + m) return true; return false; }
  stad(x, y) { return this.terrein.vlaggen.stad[this.tegelVan(x, y)] === 1; }
  // Vrij voor een dier: droog, geen stad, geen boomkruin, rots of meertje. Gebouwen telt pas het tekenen (bebouwd).
  vrij(x, y, marge = 0.25) {
    const ti = this.tegelVan(x, y), v = this.terrein.vlaggen;
    if (v.stad[ti] || this.geo.tegels[ti].terrein === 'water') return false;
    return !this.nat(x, y, 0.35) && this.terrein.boomvrij(x, y, marge) && !this.bergmeerBij(x, y, 0.4);
  }
  // De vakjes onder een rij punten [x0, y0, x1, y1, ...], en onder een rechthoek (kleiner dan een vakje) rond een punt.
  tegelsVan(pts) {
    const uit = [];
    for (let q = 0; q < pts.length; q += 2) { const ti = this.tegelVan(pts[q], pts[q + 1]); if (!uit.includes(ti)) uit.push(ti); }
    return Int32Array.from(uit);
  }
  tegelsRond(x, y, rx, ry = rx) { return this.tegelsVan([x - rx, y - ry, x + rx, y - ry, x - rx, y + ry, x + rx, y + ry]); }
  // Staat er nu een gebouw op een van deze vakjes?
  bebouwd(tg) {
    const b = this.s.bezet;
    for (let i = 0; i < tg.length; i++) if (b[tg[i]]) return true;
    return false;
  }
  // Past een lus (zoals pos() hem loopt) helemaal op vrij terrein? Anders kleiner, of niet.
  pasLus(d) {
    for (let poging = 0; poging < 3; poging++) {
      let ok = true;
      for (let q = 0; q < 10 && ok; q++) {
        const u = (q / 10) * TAU;
        ok = this.vrij(d.x + d.R * Math.sin(u), d.y + d.R * 0.62 * Math.sin(2 * u + d.f), 0.15);
      }
      if (ok) return true;
      d.R *= 0.5;
    }
    return false;
  }

  plaatsWater() {
    const tl = this.terrein, geo = this.geo;
    // watervallen: van TerreinLaag (steilste rivierstukken), niet in de stad; de vakjes van val, kolk en nevel
    const stad = tl.vlaggen.stad;
    for (const v of tl.watervallen) {
      if (stad[this.tegelVan(v.x, v.y)]) continue;
      const co = Math.cos(v.hoek), si = Math.sin(v.hoek), w = v.br / 2 + 0.8, pts = [];
      for (const u of [-0.6, 1.1, 4]) for (const k of [-w, w]) pts.push(v.x + co * u - si * k, v.y + si * u + co * k);
      this.vallen.push({ ...v, tg: this.tegelsVan(pts) });
    }
    const rivieren = tl.rivieren;
    for (let ri = 0; ri < rivieren.length; ri++) {
      const rv = rivieren[ri], n = rv.br.length;
      if (rv.delta) continue;
      let laatsteSnel = -99, laatsteBever = -99, laatsteReiger = -99, laatsteVlieg = -99;
      for (let i = 2; i < n - 2; i++) {
        const x = rv.pts[i * 2], y = rv.pts[i * 2 + 1];
        if (this.zee(x, y) || tl.isMeer(x, y)) continue;
        const tx = rv.pts[(i + 1) * 2] - rv.pts[(i - 1) * 2], ty = rv.pts[(i + 1) * 2 + 1] - rv.pts[(i - 1) * 2 + 1], tlen = Math.hypot(tx, ty) || 1;
        const hoek = Math.atan2(ty, tx), nx = -ty / tlen, ny = tx / tlen, br = rv.br[i];
        const ti = this.tegelVan(x, y);
        if (stad[ti]) continue;
        const bijVal = this.vallen.some((v) => Math.hypot(v.x - x, v.y - y) < 5);
        // stroomversnelling: waar het water snel daalt, om de paar eenheden
        if (rv.snel[i] > 0.5 && rv.s[i] - laatsteSnel > 5 && !bijVal && hash(ri, i, 401) < 0.6) {
          this.snel.push({ x, y, hoek, br, zaad: hash(ri, i, 402), tg: this.tegelsRond(x, y, br / 2 + 0.8) });
          laatsteSnel = rv.s[i];
        }
        // bever: smalle beek bij het bos, vlak stuk; dam dwars, vijver erboven, burcht op de droge oever. Vijver en
        // burcht liggen niet over een boomkruin (anders lijkt het water of de takkenhoop boven op de boom te liggen).
        if (br < 2.1 && rv.snel[i] < 0.3 && rv.s[i] - laatsteBever > 30 && !bijVal && this.bevers.length < 6 && hash(ri, i, 403) < 0.08) {
          let bos = false;
          for (let dr = -1; dr <= 1 && !bos; dr++) for (let dk = -1; dk <= 1 && !bos; dk++) {
            const t = geo.tegels[clamp(Math.floor(y / geo.T) + dr, 0, geo.rij - 1) * geo.kol + clamp(Math.floor(x / geo.T) + dk, 0, geo.kol - 1)];
            if (t.terrein === 'bos') bos = true;
          }
          const kant = hash(ri, i, 404) < 0.5 ? 1 : -1, w = br * 0.5 + 0.2, co = Math.cos(hoek), si = Math.sin(hoek);
          const vx = x - co * 1.6, vy = y - si * 1.6, lx = vx + nx * kant * (br * 0.5 + 1.3), ly = vy + ny * kant * (br * 0.5 + 1.3);
          let ok = bos && !this.zee(lx, ly) && !this.stad(lx, ly) && !tl.isRivier(lx, ly, 0.05) && !tl.isMeer(lx, ly) && tl.boomvrij(lx, ly, 0.5);
          // rand van de vijver (een ellips van 1,7 bij w * 1,15) en de uiteinden van de dam
          const rand = [];
          for (let q = 0; q < 8; q++) { const a = (q / 8) * TAU, u = Math.cos(a) * 1.7, k = Math.sin(a) * w * 1.15; rand.push(vx + co * u - si * k, vy + si * u + co * k); }
          rand.push(x - nx * w, y - ny * w, x + nx * w, y + ny * w);
          for (let q = 0; q < rand.length && ok; q += 2) ok = tl.boomvrij(rand[q], rand[q + 1], 0.05) && !this.stad(rand[q], rand[q + 1]);
          if (ok) {
            rand.push(lx - 0.5, ly - 0.5, lx + 0.5, ly - 0.5, lx - 0.5, ly + 0.5, lx + 0.5, ly + 0.5);
            this.bevers.push({ x, y, hoek, br, vx, vy, lx, ly, tg: this.tegelsVan(rand), zaad: hash(ri, i, 405) });
            laatsteBever = rv.s[i];
          }
        }
        // reiger: staat op de oever in het ondiepe
        if (rv.s[i] - laatsteReiger > 18 && hash(ri, i, 406) < 0.1) {
          const kant = hash(ri, i, 407) < 0.5 ? 1 : -1, d = br * 0.5 + 0.1;
          const hx = x + nx * kant * d, hy = y + ny * kant * d;
          if (!this.zee(hx, hy) && tl.boomvrij(hx, hy, 0.2) && !this.stad(hx, hy)) {
            this.dieren.push({ s: REIGER, x: hx, y: hy, R: 0, v: 0, f: hash(ri, i, 408) * TAU, a: hoek + (kant > 0 ? -1 : 1) * (1.2 + hash(ri, i, 409)), tg: this.tegelsRond(hx, hy, 0.4), jong: 0, kl: 0, zaad: hash(ri, i, 410) });
            laatsteReiger = rv.s[i];
          }
        }
        // vuurvliegjes: boven de oever en het water, in groepjes
        if (rv.s[i] - laatsteVlieg > 14 && hash(ri, i, 411) < 0.22 && this.vlieg.length < 40) {
          const kant = hash(ri, i, 412) < 0.5 ? 1 : -1, d = br * 0.5 + 0.6;
          const fx = x + nx * kant * d, fy = y + ny * kant * d;
          if (!this.zee(fx, fy) && !this.stad(fx, fy)) {
            this.vlieg.push({ x: fx, y: fy, tg: this.tegelsRond(fx, fy, 1.7, 1.2), zaad: hash(ri, i, 413) });
            laatsteVlieg = rv.s[i];
          }
        }
      }
    }
    if (this.snel.length > 80) this.snel.length = 80;
    // moerassen: reigers bij de plassen, ooievaars in de natte wei, vuurvliegjes
    const v = this.terrein.vlaggen;
    for (const t of geo.tegels) {
      if (t.terrein === 'water' || v.stad[t.i]) continue;
      const nat = v.moeras[t.i] || this.terrein.rivierAfstand(t.x, t.y) < 6;
      if (!nat || (t.terrein !== 'vlakte' && t.terrein !== 'kust')) continue;
      if (hash(t.i, 421) < (v.moeras[t.i] ? 0.35 : 0.1)) {
        const x = t.x + (hash(t.i, 422) - 0.5) * geo.T * 0.7, y = t.y + (hash(t.i, 423) - 0.5) * geo.T * 0.7;
        if (!v.moeras[t.i] && this.terrein.rivierAfstand(x, y) > 6) continue;
        const d = { s: OOIEVAAR, x, y, R: 0.9, v: DIER_V[OOIEVAAR], f: hash(t.i, 424) * TAU, a: 0, tg: null, jong: 0, kl: 0, zaad: hash(t.i, 425) };
        if (this.pasLus(d)) { d.tg = this.lusTegels(d); this.dieren.push(d); }
      }
      if (v.moeras[t.i] && hash(t.i, 426) < 0.3) {
        const x = t.x + (hash(t.i, 427) - 0.5) * geo.T * 0.7, y = t.y + (hash(t.i, 428) - 0.5) * geo.T * 0.7;
        if (this.vrij(x, y, 0.2)) this.dieren.push({ s: REIGER, x, y, R: 0, v: 0, f: hash(t.i, 429) * TAU, a: hash(t.i, 430) * TAU, tg: this.tegelsRond(x, y, 0.4), jong: 0, kl: 0, zaad: hash(t.i, 431) });
        if (hash(t.i, 432) < 0.5 && this.vlieg.length < 40) this.vlieg.push({ x, y, tg: this.tegelsRond(x, y, 1.7, 1.2), zaad: hash(t.i, 433) });
      }
    }
  }

  // Vakjes onder de lus van een dier (zoals pos() hem loopt), met ruimte voor wie opzij loopt en voor het lijf.
  lusTegels(d) { return this.tegelsRond(d.x, d.y, d.R + 0.5, d.R * 0.62 + 0.5); }

  plaatsWild() {
    const geo = this.geo, v = this.terrein.vlaggen;
    let groepen = 0;
    for (const t of geo.tegels) {
      if (groepen >= 160) break;
      if (t.terrein === 'bos') {
        // zwijnen, vossen, konijnen: aan de bosrand en op open plekken (waar geen kroon staat)
        for (let q = 0; q < 3; q++) {
          if (hash(t.i, q, 441) > 0.3) continue;
          const x = t.x + (hash(t.i, q, 442) - 0.5) * geo.T * 1.3, y = t.y + (hash(t.i, q, 443) - 0.5) * geo.T * 1.3;
          if (!this.vrij(x, y, 0.3)) continue;
          const k = hash(t.i, q, 444), soort = k < 0.38 ? ZWIJN : k < 0.55 ? VOS : KONIJN;
          const aantal = soort === ZWIJN ? 3 + Math.floor(hash(t.i, q, 445) * 3) : soort === VOS ? 1 : 2 + Math.floor(hash(t.i, q, 445) * 3);
          const lus = { s: soort, x, y, R: soort === KONIJN ? 0.7 : 1.4, v: DIER_V[soort] * (0.8 + 0.4 * hash(t.i, q, 446)), f: hash(t.i, q, 447) * TAU, a: 0, tg: null, jong: 0, kl: 0, zaad: hash(t.i, q, 448) };
          if (!this.pasLus(lus)) continue;
          lus.tg = this.lusTegels(lus);
          groepen++;
          for (let m = 0; m < aantal; m++) {
            // de rest van de groep loopt achter de leider aan, met een klein verschil; bij zwijnen zijn dat biggen
            this.dieren.push({ ...lus, f: lus.f - m * 0.35 / Math.max(0.2, lus.R), jong: soort === ZWIJN && m > 0 ? 1 : 0, kl: m, zaad: hash(t.i, q * 7 + m, 449) });
          }
        }
      } else if (t.terrein === 'berg' && hash(t.i, 451) < 0.3) {
        // berggeiten: op de kale rotsen boven de boomgrens, in groepjes
        const x = t.x + (hash(t.i, 452) - 0.5) * geo.T * 0.7, y = t.y + (hash(t.i, 453) - 0.5) * geo.T * 0.7, hh = this.h(x, y);
        if (hh < BOOMGRENS + 0.05 || hh > SNEEUW_VAST || !this.vrij(x, y, 0.2)) continue;
        const lus = { s: GEIT, x, y, R: 0.7, v: DIER_V[GEIT], f: hash(t.i, 454) * TAU, a: 0, tg: null, jong: 0, kl: hash(t.i, 455) < 0.5 ? 0 : 1, zaad: hash(t.i, 456) };
        if (!this.pasLus(lus)) continue;
        lus.tg = this.lusTegels(lus);
        groepen++;
        const aantal = 3 + Math.floor(hash(t.i, 457) * 4);
        for (let m = 0; m < aantal; m++) this.dieren.push({ ...lus, f: lus.f - m * 0.6, jong: m > 0 && hash(t.i, m, 458) < 0.3 ? 1 : 0, zaad: hash(t.i, m, 459) });
      }
    }
    // roofvogels: boven de hogere bergen, hooguit tien per wereld
    for (const t of geo.tegels) {
      if (this.roof.length >= 10) break;
      if (t.terrein !== 'berg' || hash(t.i, 461) > 0.1 || this.h(t.x, t.y) < ALMGRENS - 0.1) continue;
      this.roof.push({ x: t.x, y: t.y, R: 3 + hash(t.i, 462) * 4, v: (0.12 + hash(t.i, 463) * 0.08) * (hash(t.i, 464) < 0.5 ? 1 : -1), f: hash(t.i, 465) * TAU, hoog: 2.2 + hash(t.i, 466) * 1.5 });
    }
    // wolven: roedels over open land bij bos of bergen (alleen in de winter te zien); hun spoor ligt in de sneeuw
    for (const t of geo.tegels) {
      if (this.wolven.length >= 6) break;
      if ((t.terrein !== 'vlakte' && t.terrein !== 'kust') || v.stad[t.i] || v.akker[t.i] || hash(t.i, 471) > 0.06) continue;
      let wild = false;
      for (let dr = -1; dr <= 1 && !wild; dr++) for (let dk = -1; dk <= 1 && !wild; dk++) {
        const k = t.k + dk, r = t.r + dr;
        if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij) continue;
        const nb = geo.tegels[r * geo.kol + k];
        if (nb.terrein === 'bos' || nb.terrein === 'berg') wild = true;
      }
      if (!wild) continue;
      const a = hash(t.i, 472) * TAU, L = 6 + hash(t.i, 473) * 6;
      const ax = t.x - Math.cos(a) * L / 2, ay = t.y - Math.sin(a) * L / 2, bx = t.x + Math.cos(a) * L / 2, by = t.y + Math.sin(a) * L / 2;
      let ok = true;
      const pts = [], nx = -Math.sin(a) * 0.45, ny = Math.cos(a) * 0.45;
      for (let q = 0; q <= 8 && ok; q++) {
        const x = ax + (bx - ax) * q / 8, y = ay + (by - ay) * q / 8;
        ok = this.vrij(x, y, 0.2);
        pts.push(x - nx, y - ny, x + nx, y + ny);
      }
      if (ok) this.wolven.push({ ax, ay, bx, by, L, n: 3 + Math.floor(hash(t.i, 474) * 2), tg: this.tegelsVan(pts), zaad: hash(t.i, 475) });
    }
  }

  plaatsBergen() {
    const geo = this.geo, tl = this.terrein, v = tl.vlaggen;
    const droogVrij = (x, y) => !this.nat(x, y, 0.4) && !v.stad[this.tegelVan(x, y)] && !this.bergmeerBij(x, y, 0.6);
    // zigzagpaden: vanaf de bergvoet de helling op, met haarspeldbochten, naar een hut of een uitzichtpunt
    for (const t of geo.tegels) {
      if (this.paden.length >= 16) break;
      if (!v.bergvoet[t.i] || v.stad[t.i] || hash(t.i, 481) > 0.22) continue;
      let x = t.x + (hash(t.i, 482) - 0.5) * geo.T * 0.5, y = t.y + (hash(t.i, 483) - 0.5) * geo.T * 0.5;
      if (!droogVrij(x, y)) continue;
      const pts = [x, y];
      let kant = hash(t.i, 484) < 0.5 ? 1 : -1, hh = tl.hoogte(x, y), ok = true;
      for (let seg = 0; seg < 16 && hh < ALMGRENS + 0.1; seg++) {
        const gx = tl.hoogte(x + 0.8, y) - tl.hoogte(x - 0.8, y), gy = tl.hoogte(x, y + 0.8) - tl.hoogte(x, y - 0.8);
        if (Math.hypot(gx, gy) < 1e-4) { ok = false; break; }
        const a = Math.atan2(gy, gx) + kant * (0.95 + 0.2 * hash(t.i, seg, 485)), l = 1.4 + hash(t.i, seg, 486) * 1.2;
        const nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l;
        if (!droogVrij(nx, ny)) { ok = false; break; }
        x = nx; y = ny; hh = tl.hoogte(x, y); kant = -kant;
        pts.push(x, y);
      }
      if (!ok && pts.length < 10) continue;
      if (hh < BOOMGRENS) continue;
      const uitzicht = hh > ALMGRENS + 0.05;
      // stukken door het bergbos lopen onder de kruinen door: die tekenen we niet (en wandelaars zijn er dan niet te zien)
      const vrij = new Uint8Array(pts.length / 2 - 1);
      for (let q = 0; q < vrij.length; q++) {
        const ax = pts[q * 2], ay = pts[q * 2 + 1], bx = pts[q * 2 + 2], by = pts[q * 2 + 3];
        vrij[q] = tl.boomvrij(ax, ay, 0.05, true) && tl.boomvrij(bx, by, 0.05, true) && tl.boomvrij((ax + bx) / 2, (ay + by) / 2, 0.05, true) ? 1 : 0;
      }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let q = 0; q < pts.length; q += 2) { x0 = Math.min(x0, pts[q]); x1 = Math.max(x1, pts[q]); y0 = Math.min(y0, pts[q + 1]); y1 = Math.max(y1, pts[q + 1]); }
      // per stuk de vakjes van begin, midden en eind: een nieuw gebouw haalt alleen het stuk weg waar het op staat
      const stukTg = new Int32Array(vrij.length * 3);
      for (let q = 0; q < vrij.length; q++) {
        const ax = pts[q * 2], ay = pts[q * 2 + 1], bx = pts[q * 2 + 2], by = pts[q * 2 + 3];
        stukTg[q * 3] = this.tegelVan(ax, ay); stukTg[q * 3 + 1] = this.tegelVan((ax + bx) / 2, (ay + by) / 2); stukTg[q * 3 + 2] = this.tegelVan(bx, by);
      }
      this.paden.push({ pts: Float32Array.from(pts), vrij, stukTg, eindTg: this.tegelsRond(x, y, 0.6), x0, x1, y0, y1, uitzicht, zaad: hash(t.i, 487), len: lengte(pts) });
      if (!uitzicht && hh < SNEEUW_VAST && tl.boomvrij(x, y, 0.6)) this.hutten.push({ x, y, h: hh, hoek: hash(t.i, 488) * Math.PI, tg: this.tegelsRond(x, y, 0.55), zaad: hash(t.i, 489) });
    }
    // een paar hutten op de alpenweiden
    for (const t of geo.tegels) {
      if (this.hutten.length >= 24) break;
      if (t.terrein !== 'berg' || hash(t.i, 491) > 0.06) continue;
      const x = t.x + (hash(t.i, 492) - 0.5) * geo.T * 0.6, y = t.y + (hash(t.i, 493) - 0.5) * geo.T * 0.6, hh = tl.hoogte(x, y);
      if (hh < BOOMGRENS || hh > ALMGRENS + 0.05 || !droogVrij(x, y) || !tl.boomvrij(x, y, 0.8)) continue;
      this.hutten.push({ x, y, h: hh, hoek: hash(t.i, 494) * Math.PI, tg: this.tegelsRond(x, y, 0.55), zaad: hash(t.i, 495) });
    }
    // skigebied: per land één, op een geschikte helling vlak bij de hoofdstad. De stations krijgen een plein
    // (plein()), zoals de pistes een gekapte baan door het bergbos zijn. Elk land krijgt tot drie plekken op
    // volgorde, zonder gedeelde vakjes; getekend wordt de eerste waar geen gebouw op staat (liftNu). De bergvakjes
    // vlak bij de hoofdstad worden juist het eerst bebouwd, dus met één plek verdween het skigebied vaak al vroeg.
    const landen = this.landen;
    let groepen = 0;
    for (let li = 0; li < geo.hoofdstad.length && groepen < PLAFOND.liften; li++) {
      const hi = geo.hoofdstad[li];
      if (hi == null || hi < 0 || !landen[li]) continue;
      const ht = geo.tegels[hi];
      const kand = geo.tegels.filter((t) => t.terrein === 'berg' && Math.hypot(t.x - ht.x, t.y - ht.y) < 110).sort((p, q) => Math.hypot(p.x - ht.x, p.y - ht.y) - Math.hypot(q.x - ht.x, q.y - ht.y) || p.i - q.i);
      const groep = [];
      for (let ki = 0; ki < Math.min(40, kand.length) && groep.length < 3; ki++) {
        const t = kand[ki];
        let lift = null;
        for (let q = 0; q < 3 && !lift; q++) {
          const bx = t.x + (hash(t.i, q, 501) - 0.5) * geo.T * 0.8, by = t.y + (hash(t.i, q, 502) - 0.5) * geo.T * 0.8, hb = this.h(bx, by);
          if (hb < BOOMGRENS - 0.3 || hb > BOOMGRENS + 0.05 || !droogVrij(bx, by)) continue;
          for (let r = 0; r < 8 && !lift; r++) {
            const a = (r / 8) * TAU + hash(t.i, q, 503) * 0.6;
            for (const L of [14, 10]) {
              const tx = bx + Math.cos(a) * L, ty = by + Math.sin(a) * L;
              if (this.h(tx, ty) < ALMGRENS - 0.02) continue;
              let ok = true, vorige = hb;
              for (let k = 1; k <= 7 && ok; k++) {
                const px = bx + (tx - bx) * k / 7, py = by + (ty - by) * k / 7, ph = this.h(px, py);
                ok = ph >= vorige - 0.02 && droogVrij(px, py);
                vorige = ph;
              }
              if (!ok) continue;
              lift = { bx, by, tx, ty, L, hb, ht: this.h(tx, ty), li, groep: groepen, tg: null, zaad: hash(t.i, q, 504), pistes: [] };
              break;
            }
          }
        }
        if (!lift) continue;
        // twee pistes naast de lift, met een paar flauwe bochten, van boven naar beneden
        const ux = (lift.tx - lift.bx) / lift.L, uy = (lift.ty - lift.by) / lift.L;
        // vakjes van de lift zelf (stations met hun plein, masten) en, apart, van elke piste: een gebouw op een piste
        // haalt alleen die piste weg
        const lijn = [];
        for (let k = 0; k <= 7; k++) { const px = lift.bx + ux * lift.L * k / 7, py = lift.by + uy * lift.L * k / 7; lijn.push(px - uy * 0.7, py + ux * 0.7, px + uy * 0.7, py - ux * 0.7); }
        for (const [sx, sy] of [[lift.bx, lift.by], [lift.tx, lift.ty]]) lijn.push(sx - 1, sy - 1, sx + 1, sy - 1, sx - 1, sy + 1, sx + 1, sy + 1);
        lift.tg = this.tegelsVan(lijn);
        for (const kant of [-1, 1]) {
          const pts = [];
          let ok = true;
          for (let k = 0; k <= 12 && ok; k++) {
            const p = 1 - k / 12, zij = kant * (1.6 + 0.5 * Math.sin(p * Math.PI)) + Math.sin(p * TAU * 1.5 + lift.zaad * 6) * 0.7 * Math.sin(p * Math.PI);
            const px = lift.bx + ux * lift.L * p - uy * zij, py = lift.by + uy * lift.L * p + ux * zij;
            ok = droogVrij(px, py);
            pts.push(px, py);
          }
          if (!ok) continue;
          const rand = [];
          for (const [x, y] of paren(metMiddens(pts))) rand.push(x - 0.7, y - 0.7, x + 0.7, y - 0.7, x - 0.7, y + 0.7, x + 0.7, y + 0.7);
          lift.pistes.push({ pts: Float32Array.from(pts), len: lengte(pts), kant, tg: this.tegelsVan(rand) });
        }
        // een reserveplek deelt geen vakje met een eerdere: één gebouw haalt dan nooit twee plekken tegelijk weg
        const alle = [...lift.tg, ...lift.pistes.flatMap((p) => [...p.tg])];
        if (groep.some((o) => [...o.tg, ...o.pistes.flatMap((p) => [...p.tg])].some((ti) => alle.includes(ti)))) continue;
        groep.push(lift);
      }
      if (!groep.length) continue;
      for (const l of groep) this.liften.push(l);
      groepen++;
    }
    // kabelbaan: van een dalstation (met een plein) naar een hoge top, hooguit twee per wereld. De kabel hangt in de
    // lucht: alleen een gebouw op een van de stations haalt hem weg.
    const toppen = geo.tegels.filter((t) => t.terrein === 'berg').sort((p, q) => q.hoogte - p.hoogte || p.i - q.i);
    for (let ki = 0; ki < Math.min(20, toppen.length) && this.kabels.length < 2; ki++) {
      const t = toppen[ki];
      if (this.kabels.some((k) => Math.hypot(k.bx - t.x, k.by - t.y) < 80)) continue;
      // de top: het hoogste punt van een klein rooster in het vakje
      let tx = t.x, ty = t.y, th = -1;
      for (let q = 0; q < 9; q++) { const x = t.x + ((q % 3) - 1) * 4, y = t.y + (Math.floor(q / 3) - 1) * 4, hh = this.h(x, y); if (hh > th && droogVrij(x, y)) { th = hh; tx = x; ty = y; } }
      if (th < ALMGRENS + 0.1) continue;
      for (let r = 0; r < 8; r++) {
        const a = (r / 8) * TAU + hash(t.i, 511) * 0.7, L = 16 + hash(t.i, r, 512) * 6;
        const ax = tx + Math.cos(a) * L, ay = ty + Math.sin(a) * L;
        if (this.h(ax, ay) > BOOMGRENS - 0.05 || !droogVrij(ax, ay)) continue;
        // de vakjes onder beide stations met hun plein (straal 1,25)
        const m = 1.3, tg = this.tegelsVan([ax - m, ay - m, ax + m, ay - m, ax - m, ay + m, ax + m, ay + m, tx - m, ty - m, tx + m, ty - m, tx - m, ty + m, tx + m, ty + m]);
        this.kabels.push({ ax, ay, bx: tx, by: ty, L, ha: this.h(ax, ay), hb: th, tg, zaad: hash(t.i, 513) });
        break;
      }
    }
  }

  // ---------- elke frame ----------

  teken(c, view, sc, nu, dt = 0, tempo = 0) {
    for (const k in this.n) this.n[k] = 0;
    const s = view.state;
    if (!s || !view.geo || !view.terreinLaag?.basis) return;
    // opnieuw plaatsen alleen bij een andere wereld; nieuwe gebouwen (state.bezet) worden elke frame overgeslagen
    if (this.geo !== view.geo || this.terrein !== view.terreinLaag || this.basis !== view.terreinLaag.basis || this.eigenaar !== view.eigenaar) this.laad(view);
    const z = view.zoom;
    if (z < 4.5) return;
    this.s = s;
    const [wx0, wy0] = view.naarWereld(0, 0), [wx1, wy1] = view.naarWereld(view.w, view.h);
    this.x0 = wx0 - 3; this.y0 = wy0 - 3; this.x1 = wx1 + 3; this.y1 = wy1 + 3;
    const dag = s.dag ?? 0;
    if (this.szDag !== dag) { this.sz = seizoen(dag); this.wnd = wind(dag); this.szDag = dag; }
    this.pal = this.terrein.palVoor(dag);
    // het weer op het midden van het beeld (een weerfront is veel groter dan het beeld), zoals leven.js
    this.wr = weer(dag, view.cx, view.cy);
    this.nacht = nachtOp(nu);
    this.z = z; this.pix = 1 / sc; this.t = nu / 1000;
    c.save();
    c.translate(view.w / 2 - view.cx * sc, view.h / 2 - view.cy * sc);
    c.scale(sc, sc);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const a = smooth(4.5, 5.5, z);
    c.globalAlpha = a;
    // grond: paden, pistes, sporen, water
    if (z >= 5.5) this.tekenPaden(c, smooth(5.5, 6.5, z));
    // per land de eerste skiplek zonder gebouw; los van het beeld gekozen, zodat de keuze niet verspringt bij schuiven
    this.liftNu.length = 0;
    for (let i = 0, gr = -1; i < this.liften.length; i++) {
      const l = this.liften[i];
      if (l.groep !== gr && !this.bebouwd(l.tg)) { this.liftNu.push(l); gr = l.groep; }
    }
    this.tekenPistes(c);
    if (z >= 9) this.tekenSporen(c);
    if (z >= 5) this.tekenVersnellingen(c);
    this.tekenVallen(c);
    if (z >= 7) this.tekenBevers(c);
    // dieren op de grond
    if (z >= 7.5) {
      c.globalAlpha = smooth(7.5, 8.5, z);
      this.tekenDieren(c);
      if (this.sz.winter > 0.25) this.tekenWolven(c);
    }
    // huizen en liften, dan wat erin of eraan beweegt
    c.globalAlpha = a;
    if (z >= 5.5) this.tekenHutten(c);
    if (z >= 7) this.tekenUitzicht(c);
    this.tekenLiften(c);
    if (z >= 8) this.tekenVuurvliegjes(c);
    this.tekenRoofvogels(c);
    c.restore();
  }

  zicht(x, y, m = 0) { return x > this.x0 - m && x < this.x1 + m && y > this.y0 - m && y < this.y1 + m; }

  // Is stuk q van pad p te zien: niet onder een boomkruin en geen gebouw op begin, midden of eind?
  stukOpen(p, q) {
    if (!p.vrij[q]) return false;
    const b = this.s.bezet, tg = p.stukTg;
    return !b[tg[q * 3]] && !b[tg[q * 3 + 1]] && !b[tg[q * 3 + 2]];
  }

  // Sneeuw op de grond op deze hoogte (laagland: hartje winter; bergen: boven de sneeuwgrens van het seizoen).
  sneeuwOp(hh) { return this.pal.A > 0.22 || hh > this.pal.lijn; }

  tekenPaden(c, a) {
    const pal = this.pal, ga = c.globalAlpha;
    let n = 0;
    c.beginPath();
    for (const p of this.paden) {
      if (n >= PLAFOND.paden) break;
      if (p.x1 < this.x0 || p.x0 > this.x1 || p.y1 < this.y0 || p.y0 > this.y1) continue;
      // alleen de stukken buiten het bos en niet over een gebouw: onder de kruinen loopt het pad uit het zicht
      let open = false, iets = false;
      for (let q = 0; q < p.vrij.length; q++) {
        if (!this.stukOpen(p, q)) { open = false; continue; }
        if (!open) { c.moveTo(p.pts[q * 2], p.pts[q * 2 + 1]); open = true; }
        c.lineTo(p.pts[q * 2 + 2], p.pts[q * 2 + 3]);
        iets = true;
      }
      if (iets) n++;
    }
    this.n.paden = n;
    if (!n) return;
    c.globalAlpha = ga * a * (pal.A > 0.3 ? 0.4 : 0.8);
    c.setLineDash(STREEP_PAD);
    c.strokeStyle = '#d6c49c';
    c.lineWidth = Math.max(0.1, 0.9 * this.pix);
    c.stroke();
    c.setLineDash(GEEN_STREEP);
    // wandelaars, alleen overdag buiten de winter en niet in de stromende regen; ze lopen heen en weer en zijn onder
    // de boomkruinen niet te zien
    if (this.z >= 8 && this.sz.winter < 0.3 && this.nacht < 0.5 && this.wr.regen < 0.45) {
      const buf = this.buf;
      let w = 0;
      for (const p of this.paden) {
        if (p.x1 < this.x0 || p.x0 > this.x1 || p.y1 < this.y0 || p.y0 > this.y1) continue;
        for (let k = 0; k < 2 && w < PLAFOND.wandelaars; k++) {
          const u = frac(this.t * 0.004 + p.zaad + k * 0.47), f = u < 0.5 ? u * 2 : 2 - u * 2;
          langs(p.pts, p.len * f, this.p3);
          if (!this.stukOpen(p, this.p3[3])) continue;
          buf[w * 4] = this.p3[0]; buf[w * 4 + 1] = this.p3[1]; buf[w * 4 + 2] = (p.zaad * 6 + k) % JAS.length; w++;
        }
      }
      this.n.wandelaars = w;
      c.globalAlpha = ga * smooth(8, 9, this.z);
      for (let k = 0; k < JAS.length; k++) {
        c.beginPath();
        let iets = false;
        for (let q = 0; q < w; q++) if (Math.floor(buf[q * 4 + 2]) === k) { rond(c, buf[q * 4], buf[q * 4 + 1], 0.07); iets = true; }
        if (iets) { c.fillStyle = JAS[k]; c.fill(); }
      }
      if (this.z >= 11) { c.beginPath(); for (let q = 0; q < w; q++) rond(c, buf[q * 4] - 0.02, buf[q * 4 + 1] - 0.03, 0.035); c.fillStyle = '#e8c8a0'; c.fill(); }
    }
    c.globalAlpha = ga;
  }

  tekenPistes(c) {
    if (!this.liftNu.length) return;
    const ga = c.globalAlpha;
    let n = 0;
    for (const l of this.liftNu) {
      if (n >= PLAFOND.liften) break;
      if (!this.zicht((l.bx + l.tx) / 2, (l.by + l.ty) / 2, l.L / 2 + 3)) continue;
      n++;
      const winter = this.sneeuwOp(l.hb + 0.05);
      c.beginPath();
      // zonder lift geen pistes; een gebouw op een piste haalt alleen die piste weg
      for (const p of l.pistes) { if (this.bebouwd(p.tg)) continue; c.moveTo(p.pts[0], p.pts[1]); for (let q = 2; q < p.pts.length; q += 2) c.lineTo(p.pts[q], p.pts[q + 1]); }
      if (winter) {
        c.strokeStyle = 'rgba(160,184,206,0.35)'; c.lineWidth = 1.35; c.stroke();
        c.strokeStyle = 'rgba(246,249,252,0.92)'; c.lineWidth = 1.15; c.stroke();
      } else {
        // buiten de winter: een gemaaide baan door het bos
        c.strokeStyle = 'rgba(150,170,96,0.45)'; c.lineWidth = 1.1; c.stroke();
      }
    }
    c.globalAlpha = ga;
  }

  tekenSporen(c) {
    if (!this.wolven.length || !(this.pal.A > 0.15 || this.sz.winter > 0.4)) return;
    let n = 0;
    c.beginPath();
    for (const w of this.wolven) {
      if (n >= PLAFOND.sporen) break;
      if (!this.zicht((w.ax + w.bx) / 2, (w.ay + w.by) / 2, w.L / 2) || this.bebouwd(w.tg)) continue;
      n++;
      const dx = (w.bx - w.ax) / w.L, dy = (w.by - w.ay) / w.L;
      for (let d = 0.2, k = 0; d < w.L; d += 0.3, k++) {
        const zij = (k % 2 ? 0.07 : -0.07) + Math.sin(d * 0.9 + w.zaad * 9) * 0.15;
        rond(c, w.ax + dx * d - dy * zij, w.ay + dy * d + dx * zij, 0.035);
      }
    }
    this.n.sporen = n;
    if (!n) return;
    c.fillStyle = 'rgba(112,128,146,0.55)';
    c.fill();
  }

  tekenVersnellingen(c) {
    if (!this.snel.length || this.pal.ijs > 0.6) return;
    const buf = this.buf;
    let n = 0;
    for (const r of this.snel) {
      if (n >= PLAFOND.versnellingen) break;
      if (!this.zicht(r.x, r.y, 2) || this.bebouwd(r.tg)) continue;
      buf[n * 4] = r.x; buf[n * 4 + 1] = r.y; buf[n * 4 + 2] = r.hoek; buf[n * 4 + 3] = r.br + r.zaad * 0.001; n++;
    }
    this.n.versnellingen = n;
    if (!n) return;
    // keien in de stroom
    c.beginPath();
    for (let q = 0; q < n; q++) {
      const x = buf[q * 4], y = buf[q * 4 + 1], h = buf[q * 4 + 2], br = Math.floor(buf[q * 4 + 3] * 10) / 10, z = frac(buf[q * 4 + 3] * 1000);
      const nx = -Math.sin(h), ny = Math.cos(h), d = (z - 0.5) * br * 0.6;
      rond(c, x + nx * d, y + ny * d, 0.12 + z * 0.1);
      rond(c, x + Math.cos(h) * 0.7 - nx * d * 0.6, y + Math.sin(h) * 0.7 - ny * d * 0.6, 0.09);
    }
    c.fillStyle = '#6c665c';
    c.fill();
    // schuimkoppen: v-vormen die stroomafwaarts schuiven
    c.beginPath();
    for (let q = 0; q < n; q++) {
      const x = buf[q * 4], y = buf[q * 4 + 1], h = buf[q * 4 + 2], br = Math.floor(buf[q * 4 + 3] * 10) / 10, z = frac(buf[q * 4 + 3] * 1000);
      const co = Math.cos(h), si = Math.sin(h), w = br * 0.32;
      for (let k = 0; k < 3; k++) {
        const u = -0.8 + k * 0.6 + frac(this.t * 0.9 + z + k * 0.33) * 0.6;
        const cx = x + co * u, cy = y + si * u;
        c.moveTo(cx - co * 0.25 - si * w, cy - si * 0.25 + co * w); c.lineTo(cx, cy); c.lineTo(cx - co * 0.25 + si * w, cy - si * 0.25 - co * w);
      }
    }
    c.strokeStyle = 'rgba(240,248,250,0.75)';
    c.lineWidth = Math.max(0.06, 0.7 * this.pix);
    c.stroke();
  }

  tekenVallen(c) {
    const ga = c.globalAlpha, z = this.z, t = this.t;
    let n = 0;
    for (const v of this.vallen) {
      if (n >= PLAFOND.watervallen) break;
      if (!this.zicht(v.x, v.y, 3) || this.bebouwd(v.tg)) continue;
      n++;
      const br = v.br, ijs = this.pal.ijs > 0.6;
      c.save();
      c.translate(v.x, v.y);
      c.rotate(v.hoek);
      // u langs de stroom, w dwars; de val begint bij u = -0,25 en eindigt bij u = 0,9
      // rotsen aan weerskanten
      c.beginPath();
      for (let kant = -1; kant <= 1; kant += 2) {
        const w0 = kant * (br / 2 + 0.05);
        c.moveTo(-0.6, w0); c.lineTo(-0.3, w0 + kant * 0.55); c.lineTo(0.3, w0 + kant * 0.7); c.lineTo(0.95, w0 + kant * 0.45); c.lineTo(1.1, w0); c.closePath();
      }
      c.fillStyle = '#5c544a'; c.fill();
      if (z >= 7) { c.beginPath(); for (let kant = -1; kant <= 1; kant += 2) { const w0 = kant * (br / 2 + 0.1); ellips(c, -0.2, w0 + kant * 0.25, 0.32, 0.16, 0.2); } c.fillStyle = '#8c8274'; c.fill(); }
      // het vallende water
      c.beginPath(); c.rect(-0.25, -br / 2, 1.15, br);
      c.fillStyle = ijs ? '#d8e8ee' : 'rgba(226,242,246,0.88)'; c.fill();
      // strepen die naar beneden schuiven
      c.beginPath();
      const strepen = Math.max(3, Math.round(br * 3));
      for (let k = 0; k < strepen; k++) { const w = -br / 2 + (k + 0.5) * (br / strepen); c.moveTo(-0.25, w); c.lineTo(0.9, w + (k % 2 ? 0.03 : -0.03)); }
      c.setLineDash(STREEP_VAL);
      c.lineDashOffset = ijs ? 0 : -t * 1.6;
      c.strokeStyle = ijs ? 'rgba(150,186,204,0.8)' : 'rgba(255,255,255,0.95)';
      c.lineWidth = Math.max(0.05, 0.5 * this.pix);
      c.stroke();
      c.setLineDash(GEEN_STREEP);
      c.lineDashOffset = 0;
      // de rand bovenaan
      c.beginPath(); c.moveTo(-0.25, -br / 2); c.lineTo(-0.25, br / 2);
      c.strokeStyle = ijs ? '#eef6f8' : 'rgba(206,232,238,0.95)'; c.lineWidth = 0.14; c.stroke();
      if (!ijs) {
        // schuim in de kolk: ringen die uitdijen en vervagen
        c.beginPath();
        for (let k = 0; k < 3; k++) { const f = frac(t * 0.45 + k / 3 + v.d * 50); ellips(c, 1.05 + f * 0.5, 0, 0.25 + f * 0.6, br * (0.35 + f * 0.4), 0); }
        c.strokeStyle = 'rgba(244,250,252,0.55)'; c.lineWidth = 0.08; c.stroke();
        c.beginPath(); ellips(c, 1.0, 0, 0.42, br * 0.42, 0); c.fillStyle = 'rgba(246,252,252,0.75)'; c.fill();
        // nevel die stroomafwaarts drijft
        if (z >= 6) {
          for (let k = 0; k < 4; k++) {
            const f = frac(t * 0.12 + k / 4 + v.kracht), r = 0.6 + f * 1.6;
            c.globalAlpha = ga * 0.32 * (1 - f) * (0.6 + 0.4 * v.kracht);
            c.drawImage(this.nevel, 1.0 + f * 2.4 - r, Math.sin(k * 2.1 + t * 0.3) * 0.4 - r, r * 2, r * 2);
          }
          c.globalAlpha = ga;
        }
        // stuifwater vlak bij de val
        if (z >= 11) {
          c.beginPath();
          for (let k = 0; k < 10; k++) { const f = frac(t * 1.3 + k * 0.618); rond(c, 0.95 + f * 0.8, (frac(k * 0.371 + Math.floor(t * 1.3 + k * 0.618) * 0.13) - 0.5) * br * 1.1, 0.03); }
          c.fillStyle = 'rgba(255,255,255,0.8)'; c.fill();
        }
        // regenboog in de nevel: zomer, overdag, ingezoomd, en alleen als de zon schijnt (weinig wolken, geen regen)
        if (z >= 10 && this.sz.zomer > 0.4 && this.nacht < 0.2 && v.kracht > 0.3 && this.wr.wolken < 0.45 && this.wr.regen < 0.05) {
          for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(1.6, 0, 1.3 - k * 0.08, -Math.PI * 0.5, Math.PI * 0.5); c.strokeStyle = REGENBOOG[k]; c.lineWidth = 0.08; c.stroke(); }
        }
      }
      c.restore();
    }
    this.n.watervallen = n;
  }

  tekenBevers(c) {
    if (!this.bevers.length) return;
    const ga = c.globalAlpha, ijs = this.pal.ijs > 0.6, t = this.t;
    let n = 0;
    for (const b of this.bevers) {
      if (n >= PLAFOND.bevers) break;
      if (!this.zicht(b.x, b.y, 4) || this.bebouwd(b.tg)) continue;
      n++;
      const co = Math.cos(b.hoek), si = Math.sin(b.hoek), nx = -si, ny = co, w = b.br * 0.5 + 0.2;
      // vijver achter de dam: stil, donkerder water
      c.beginPath(); ellips(c, b.vx, b.vy, 1.7, w * 1.15, b.hoek);
      c.fillStyle = ijs ? 'rgba(214,230,236,0.95)' : 'rgba(46,92,104,0.6)'; c.fill();
      // de dam: modder en takken dwars over de beek
      c.beginPath(); c.moveTo(b.x - nx * w, b.y - ny * w); c.lineTo(b.x + nx * w, b.y + ny * w);
      c.strokeStyle = '#5a4632'; c.lineWidth = 0.28; c.stroke();
      if (this.z >= 8.5) {
        c.beginPath();
        for (let k = 0; k < 9; k++) {
          const f = -1 + (k + 0.5) * (2 / 9), d = f * w, sk = (frac(k * 0.618 + b.zaad) - 0.5) * 0.6;
          c.moveTo(b.x + nx * d - co * 0.18 + si * sk * 0.2, b.y + ny * d - si * 0.18 - co * sk * 0.2);
          c.lineTo(b.x + nx * (d + sk * 0.3) + co * 0.18, b.y + ny * (d + sk * 0.3) + si * 0.18);
        }
        c.strokeStyle = '#7a5a38'; c.lineWidth = 0.06; c.stroke();
      }
      // de burcht: een hoop takken op de oever
      c.beginPath(); ellips(c, b.lx, b.ly, 0.5, 0.4, b.hoek);
      c.fillStyle = ijs || this.pal.A > 0.3 ? '#cfd6da' : '#654a30'; c.fill();
      if (this.z >= 10) {
        c.beginPath();
        for (let k = 0; k < 6; k++) { const a = k * 1.05 + b.zaad * 4; c.moveTo(b.lx + Math.cos(a) * 0.1, b.ly + Math.sin(a) * 0.1); c.lineTo(b.lx + Math.cos(a) * 0.45, b.ly + Math.sin(a) * 0.36); }
        c.strokeStyle = '#4a3420'; c.lineWidth = 0.04; c.stroke();
      }
      // de bever zelf zwemt rondjes in de vijver, met een kielzog
      if (!ijs && this.z >= 8.5) {
        const u = t * 0.18 + b.zaad * TAU, px = b.vx + Math.cos(b.hoek) * Math.sin(u) * 1.1 + nx * Math.sin(2 * u) * w * 0.5, py = b.vy + Math.sin(b.hoek) * Math.sin(u) * 1.1 + ny * Math.sin(2 * u) * w * 0.5;
        const dx = Math.cos(b.hoek) * Math.cos(u) * 1.1 + nx * Math.cos(2 * u) * w, dy = Math.sin(b.hoek) * Math.cos(u) * 1.1 + ny * Math.cos(2 * u) * w, a = Math.atan2(dy, dx);
        const ca = Math.cos(a), sa = Math.sin(a);
        c.beginPath();
        c.moveTo(px - ca * 0.15 - sa * 0.03, py - sa * 0.15 + ca * 0.03); c.lineTo(px - ca * 0.6 - sa * 0.25, py - sa * 0.6 + ca * 0.25);
        c.moveTo(px - ca * 0.15 + sa * 0.03, py - sa * 0.15 - ca * 0.03); c.lineTo(px - ca * 0.6 + sa * 0.25, py - sa * 0.6 - ca * 0.25);
        c.strokeStyle = 'rgba(220,236,240,0.55)'; c.lineWidth = 0.035; c.stroke();
        c.beginPath(); ellips(c, px - ca * 0.15, py - sa * 0.15, 0.07, 0.045, a); c.fillStyle = '#3a2a1c'; c.fill();
        c.beginPath(); ellips(c, px, py, 0.12, 0.07, a); c.fillStyle = '#5c3e24'; c.fill();
      }
    }
    this.n.bevers = n;
    c.globalAlpha = ga;
  }

  // Positie en kop van een dier op tijd t: een lus rond zijn plek, afwisselend lopen en even stilstaan (grazen).
  pos(d, t) {
    const s = t * d.v * TAU + d.f, u = s + 0.85 * Math.sin(s);
    const p = this.p3;
    if (d.R <= 0) { p[0] = d.x; p[1] = d.y; p[2] = d.a + Math.sin(t * 0.2 + d.f) * 0.4; return p; }
    p[0] = d.x + d.R * Math.sin(u); p[1] = d.y + d.R * 0.62 * Math.sin(2 * u + d.f);
    p[2] = Math.atan2(d.R * 1.24 * Math.cos(2 * u + d.f), d.R * Math.cos(u)) + (d.kl ? (frac(d.zaad * 7) - 0.5) * 0.5 : 0);
    return p;
  }

  tekenDieren(c) {
    const t = this.t, sz = this.sz, z = this.z, buf = this.buf;
    for (let soort = 0; soort < 6; soort++) {
      const naam = DIER_NAAM[soort], max = Math.min(PLAFOND[naam], 96);
      // ooievaars trekken in de winter weg; reigers blijven, maar niet op een bevroren water
      if (soort === OOIEVAAR && sz.winter > 0.35) continue;
      if (soort === REIGER && this.pal.ijs > 0.7) continue;
      let n = 0;
      for (const d of this.dieren) {
        if (d.s !== soort) continue;
        if (n >= max) break;
        if (!this.zicht(d.x, d.y, 2) || this.bebouwd(d.tg)) continue;
        if (soort === OOIEVAAR && sz.herfst > 0.4 && d.zaad < sz.herfst * 0.7) continue;
        const p = this.pos(d, t);
        // wie achter de leider aanloopt, loopt een stukje opzij
        const zij = d.kl ? (frac(d.zaad * 13) - 0.5) * 0.5 : 0;
        buf[n * 4] = p[0] - Math.sin(p[2]) * zij; buf[n * 4 + 1] = p[1] + Math.cos(p[2]) * zij; buf[n * 4 + 2] = p[2];
        buf[n * 4 + 3] = DIER_LENGTE[soort] * (d.jong ? 0.55 : 1) * (0.9 + 0.2 * d.zaad) * (d.kl === 1 && soort === GEIT ? -1 : 1);
        n++;
      }
      this.n[naam] = n;
      if (!n) continue;
      // schaduw onder alle dieren van deze soort
      c.beginPath();
      for (let q = 0; q < n; q++) { const L = Math.abs(buf[q * 4 + 3]); ellips(c, buf[q * 4] + L * 0.15, buf[q * 4 + 1] + L * 0.2, L * 0.55, L * 0.26, buf[q * 4 + 2]); }
      c.fillStyle = 'rgba(0,0,0,0.2)'; c.fill();
      if (soort === ZWIJN) {
        this.lijven(c, n, 0.5, 0.3, 0, '#3a2e26', GROOT);
        this.lijven(c, n, 0.5, 0.3, 0, '#8a6844', KLEIN);
        this.lijven(c, n, 0.2, 0.14, 0.42, '#2c221c', GROOT);
        this.lijven(c, n, 0.2, 0.14, 0.42, '#6e5236', KLEIN);
        if (z >= 11) {
          // strepen op de biggen
          c.beginPath();
          for (let q = 0; q < n; q++) {
            const L = buf[q * 4 + 3]; if (L > 0.25) continue;
            const x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], co = Math.cos(a), si = Math.sin(a);
            for (let w = -0.12; w < 0.2; w += 0.24) { c.moveTo(x - co * L * 0.35 - si * w * L, y - si * L * 0.35 + co * w * L); c.lineTo(x + co * L * 0.3 - si * w * L, y + si * L * 0.3 + co * w * L); }
          }
          c.strokeStyle = 'rgba(214,186,140,0.9)'; c.lineWidth = 0.012; c.stroke();
        }
      } else if (soort === VOS) {
        this.lijven(c, n, 0.28, 0.08, -0.5, '#b4561f'); // staart
        this.lijven(c, n, 0.06, 0.06, -0.78, '#f0e8dc'); // witte punt
        this.lijven(c, n, 0.42, 0.18, 0, '#c4642a');
        this.lijven(c, n, 0.15, 0.12, 0.45, '#cc7034');
        if (z >= 11) this.lijven(c, n, 0.05, 0.05, 0.62, '#2a1e18');
      } else if (soort === KONIJN) {
        this.lijven(c, n, 0.46, 0.36, 0, this.pal.A > 0.3 ? '#a8987e' : '#8f7a5e');
        this.lijven(c, n, 0.2, 0.18, 0.42, '#86704f');
        this.lijven(c, n, 0.12, 0.12, -0.48, '#f2efe6');
        if (z >= 11) this.lijven(c, n, 0.26, 0.05, 0.16, '#7a6446');
      } else if (soort === GEIT) {
        this.lijven(c, n, 0.48, 0.24, 0, '#e8e2d4', LICHT);
        this.lijven(c, n, 0.48, 0.24, 0, '#8a7560', DONKER);
        this.lijven(c, n, 0.16, 0.12, 0.44, '#d6cebe', LICHT);
        this.lijven(c, n, 0.16, 0.12, 0.44, '#6e5c48', DONKER);
        if (z >= 11) {
          c.beginPath();
          for (let q = 0; q < n; q++) {
            const L = Math.abs(buf[q * 4 + 3]), x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], co = Math.cos(a), si = Math.sin(a);
            for (let w = -1; w <= 1; w += 2) { c.moveTo(x + co * L * 0.5 - si * w * L * 0.06, y + si * L * 0.5 + co * w * L * 0.06); c.quadraticCurveTo(x + co * L * 0.42 - si * w * L * 0.16, y + si * L * 0.42 + co * w * L * 0.16, x + co * L * 0.3 - si * w * L * 0.14, y + si * L * 0.3 + co * w * L * 0.14); }
          }
          c.strokeStyle = '#4a4038'; c.lineWidth = 0.02; c.stroke();
        }
      } else if (soort === REIGER) {
        this.lijven(c, n, 0.36, 0.15, -0.05, '#8e959a');
        this.lijven(c, n, 0.2, 0.1, -0.15, '#5e666c');
        // hals in een s-bocht, kop met gele snavel
        c.beginPath();
        for (let q = 0; q < n; q++) {
          const L = buf[q * 4 + 3], x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], co = Math.cos(a), si = Math.sin(a);
          c.moveTo(x + co * L * 0.25, y + si * L * 0.25);
          c.quadraticCurveTo(x + co * L * 0.4 - si * L * 0.12, y + si * L * 0.4 + co * L * 0.12, x + co * L * 0.55, y + si * L * 0.55);
        }
        c.strokeStyle = '#c4cacd'; c.lineWidth = 0.035; c.stroke();
        this.lijven(c, n, 0.06, 0.05, 0.57, '#e6eaec');
        c.beginPath();
        for (let q = 0; q < n; q++) { const L = buf[q * 4 + 3], x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2]; c.moveTo(x + Math.cos(a) * L * 0.6, y + Math.sin(a) * L * 0.6); c.lineTo(x + Math.cos(a) * L * 0.82, y + Math.sin(a) * L * 0.82); }
        c.strokeStyle = '#d8b040'; c.lineWidth = 0.02; c.stroke();
      } else if (soort === OOIEVAAR) {
        this.lijven(c, n, 0.4, 0.17, -0.06, '#1e1e1e'); // zwarte slagpennen
        this.lijven(c, n, 0.32, 0.15, 0.04, '#f4f2ec');
        this.lijven(c, n, 0.07, 0.06, 0.45, '#f6f4ee');
        c.beginPath();
        for (let q = 0; q < n; q++) { const L = buf[q * 4 + 3], x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2]; c.moveTo(x + Math.cos(a) * L * 0.5, y + Math.sin(a) * L * 0.5); c.lineTo(x + Math.cos(a) * L * 0.78, y + Math.sin(a) * L * 0.78); }
        c.strokeStyle = '#d0402a'; c.lineWidth = 0.025; c.stroke();
      }
    }
  }

  // Ellipsen voor de dieren in buf: halve lengte rx en halve breedte ry (in lengtes), vooruit geschoven met `voor`.
  // `welk` kiest een deel: ALLE, GROOT of KLEIN (lengte boven of onder 0,25), LICHT of DONKER (teken van de lengte).
  lijven(c, n, rx, ry, voor, kleur, welk = ALLE) {
    const buf = this.buf;
    c.beginPath();
    let iets = false;
    for (let q = 0; q < n; q++) {
      const l = buf[q * 4 + 3];
      if ((welk === GROOT && l <= 0.25) || (welk === KLEIN && l > 0.25) || (welk === LICHT && l < 0) || (welk === DONKER && l > 0)) continue;
      const L = Math.abs(l), a = buf[q * 4 + 2];
      ellips(c, buf[q * 4] + Math.cos(a) * L * voor, buf[q * 4 + 1] + Math.sin(a) * L * voor, L * rx, L * ry, a);
      iets = true;
    }
    if (iets) { c.fillStyle = kleur; c.fill(); }
  }

  tekenWolven(c) {
    const buf = this.buf, t = this.t;
    let n = 0;
    for (const w of this.wolven) {
      if (!this.zicht((w.ax + w.bx) / 2, (w.ay + w.by) / 2, w.L / 2) || this.bebouwd(w.tg)) continue;
      // de roedel draaft heen en weer langs zijn spoor, achter elkaar
      for (let m = 0; m < w.n && n < PLAFOND.wolven; m++) {
        const u = frac(t * 0.01 + w.zaad - m * 0.012), f = u < 0.5 ? u * 2 : 2 - u * 2, terug = u >= 0.5;
        const d = clamp(f * w.L, 0, w.L), dx = (w.bx - w.ax) / w.L, dy = (w.by - w.ay) / w.L;
        const zij = Math.sin(d * 0.9 + w.zaad * 9) * 0.15 + (m % 2 ? 0.1 : -0.1);
        buf[n * 4] = w.ax + dx * d - dy * zij; buf[n * 4 + 1] = w.ay + dy * d + dx * zij;
        buf[n * 4 + 2] = Math.atan2(dy, dx) + (terug ? Math.PI : 0); buf[n * 4 + 3] = 0.38 * (0.9 + 0.1 * m);
        n++;
      }
    }
    this.n.wolven = n;
    if (!n) return;
    c.beginPath();
    for (let q = 0; q < n; q++) { const L = buf[q * 4 + 3]; ellips(c, buf[q * 4] + L * 0.12, buf[q * 4 + 1] + L * 0.16, L * 0.55, L * 0.22, buf[q * 4 + 2]); }
    c.fillStyle = 'rgba(40,52,70,0.2)'; c.fill();
    this.lijven(c, n, 0.22, 0.07, -0.55, '#6e6a64');
    this.lijven(c, n, 0.46, 0.18, 0, '#85817a');
    this.lijven(c, n, 0.3, 0.08, -0.05, '#5f5b55');
    this.lijven(c, n, 0.15, 0.11, 0.46, '#8e8a83');
  }

  tekenHutten(c) {
    if (!this.hutten.length) return;
    const t = this.t, koud = this.sz.koud, wnd = this.wnd;
    let n = 0, wit = 0;
    const buf = this.buf;
    for (const h of this.hutten) {
      if (n >= PLAFOND.hutten) break;
      if (!this.zicht(h.x, h.y, 1) || this.bebouwd(h.tg)) continue;
      // sneeuw op het dak als er op die hoogte sneeuw ligt (de sneeuwgrens zakt en stijgt met het seizoen): + 2
      const sneeuw = this.sneeuwOp(h.h);
      buf[n * 4] = h.x; buf[n * 4 + 1] = h.y; buf[n * 4 + 2] = h.hoek; buf[n * 4 + 3] = h.zaad + (sneeuw ? 2 : 0); n++;
      if (sneeuw) wit++;
    }
    this.n.hutten = n;
    if (!n) return;
    c.beginPath();
    for (let q = 0; q < n; q++) { const a = buf[q * 4 + 2]; ellips(c, buf[q * 4] + 0.12, buf[q * 4 + 1] + 0.15, 0.5, 0.36, a); }
    c.fillStyle = 'rgba(20,16,10,0.3)'; c.fill();
    if (wit < n) { this.daken(c, n, true, '#8a6644', false); this.daken(c, n, false, '#5c422c', false); }
    if (wit) { this.daken(c, n, true, '#f2f5f8', true); this.daken(c, n, false, '#c8d0d8', true); }
    // de schoorsteen
    if (this.z >= 9) { c.beginPath(); for (let q = 0; q < n; q++) c.rect(buf[q * 4] + 0.16, buf[q * 4 + 1] - 0.14, 0.09, 0.09); c.fillStyle = '#6a625a'; c.fill(); }
    // rook uit de schoorsteen als het koud is
    if (koud > 0.45 && this.z >= 7) {
      const wx = Math.cos(wnd.hoek), wy = Math.sin(wnd.hoek);
      c.beginPath();
      for (let q = 0; q < n; q++) {
        for (let k = 0; k < 3; k++) {
          const f = frac(t * 0.25 + k / 3 + buf[q * 4 + 3]), r = 0.08 + f * 0.22;
          rond(c, buf[q * 4] + 0.2 + wx * f * 1.4, buf[q * 4 + 1] - 0.1 + wy * f * 1.4 - f * 0.3, r);
        }
      }
      const rook = Math.round(28 * smooth(0.45, 0.7, koud));
      if (this.rookStap !== rook) { this.rookStap = rook; this.rookKleur = `rgba(214,214,212,${(rook / 100).toFixed(2)})`; }
      c.fillStyle = this.rookKleur; c.fill();
    }
  }

  // Uitzichtpunten bovenaan de paden: een plateautje met een hek (ook waar geen hut in beeld is).
  tekenUitzicht(c) {
    let n = 0;
    c.beginPath();
    for (const p of this.paden) {
      if (n >= PLAFOND.uitzicht) break;
      if (!p.uitzicht) continue;
      const L = p.pts.length, x = p.pts[L - 2], y = p.pts[L - 1];
      if (!this.zicht(x, y, 1) || this.bebouwd(p.eindTg)) continue;
      rond(c, x, y, 0.45); n++;
    }
    this.n.uitzicht = n;
    if (n) { c.fillStyle = '#b4ab9a'; c.fill(); c.strokeStyle = '#5a5248'; c.lineWidth = 0.05; c.stroke(); }
  }

  // Zadeldaken van de hutten in buf: eerst de helften die naar het noordwesten (het licht) kijken, dan de andere;
  // alleen de hutten met (sneeuw) of zonder sneeuw op het dak.
  daken(c, n, licht, kleur, sneeuw) {
    const buf = this.buf, hu = 0.42, hv = 0.3;
    c.beginPath();
    for (let q = 0; q < n; q++) {
      if ((buf[q * 4 + 3] >= 2) !== sneeuw) continue;
      const x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], co = Math.cos(a), si = Math.sin(a);
      const boven = (co - si > 0) === licht, w0 = boven ? -hv : 0, w1 = boven ? 0 : hv;
      c.moveTo(x - hu * co - w0 * si, y - hu * si + w0 * co); c.lineTo(x + hu * co - w0 * si, y + hu * si + w0 * co);
      c.lineTo(x + hu * co - w1 * si, y + hu * si + w1 * co); c.lineTo(x - hu * co - w1 * si, y - hu * si + w1 * co); c.closePath();
    }
    c.fillStyle = kleur; c.fill();
  }

  // Een plein onder een station: een open plek van grind (met sneeuw als die er op die hoogte ligt), zodat het station
  // niet boven op de boomkruinen van het bergbos staat.
  plein(c, x, y, hoek, r, hh) {
    c.beginPath(); ellips(c, x, y, r, r * 0.85, hoek);
    c.fillStyle = this.sneeuwOp(hh) ? '#e4e9ed' : '#a49c80'; c.fill();
  }

  // Een rechthoekig station (dal of top) dwars op de lijn u.
  station(c, x, y, ux, uy, lang, breed) {
    c.moveTo(x - ux * lang - uy * breed, y - uy * lang + ux * breed); c.lineTo(x + ux * lang - uy * breed, y + uy * lang + ux * breed);
    c.lineTo(x + ux * lang + uy * breed, y + uy * lang - ux * breed); c.lineTo(x - ux * lang + uy * breed, y - uy * lang - ux * breed); c.closePath();
  }

  tekenLiften(c) {
    if (!this.liftNu.length && !this.kabels.length) return;
    const t = this.t, z = this.z;
    let liften = 0, stoel = 0, gondel = 0, skiers = 0;
    for (const l of this.liftNu) {
      if (liften >= PLAFOND.liften) break;
      if (!this.zicht((l.bx + l.tx) / 2, (l.by + l.ty) / 2, l.L / 2 + 3)) continue;
      liften++;
      const ux = (l.tx - l.bx) / l.L, uy = (l.ty - l.by) / l.L, o = 0.2;
      // pleinen, masten en stations
      const hoek = Math.atan2(uy, ux);
      this.plein(c, l.bx, l.by, hoek, 1.0, l.hb);
      this.plein(c, l.tx, l.ty, hoek, 1.0, l.ht);
      c.beginPath();
      for (let d = 0; d <= l.L; d += 2.8) rond(c, l.bx + ux * d, l.by + uy * d, 0.09);
      c.fillStyle = '#5c6066'; c.fill();
      c.beginPath();
      this.station(c, l.bx, l.by, ux, uy, 0.5, 0.45);
      this.station(c, l.tx, l.ty, ux, uy, 0.5, 0.45);
      c.fillStyle = this.pal.A > 0.25 ? '#e4e8ec' : '#8a3a2e'; c.fill();
      // twee kabels
      c.beginPath();
      for (let g = -1; g <= 1; g += 2) { const w = g * o; c.moveTo(l.bx - uy * w, l.by + ux * w); c.lineTo(l.tx - uy * w, l.ty + ux * w); }
      c.strokeStyle = 'rgba(34,36,40,0.75)'; c.lineWidth = Math.max(0.03, 0.6 * this.pix); c.stroke();
      // stoeltjes: omhoog aan de ene kabel, omlaag aan de andere
      if (z >= 6.5) {
        const aantal = Math.min(Math.round(l.L * 2 / 1.2), PLAFOND.stoeltjes - stoel), buf = this.buf;
        let m = 0;
        for (let k = 0; k < aantal; k++) {
          const s = frac(t * 0.6 / (2 * l.L) + k / aantal), op = s < 0.5, p = op ? s * 2 : 2 - s * 2, w = op ? o : -o;
          buf[m * 4] = l.bx + ux * l.L * p - uy * w; buf[m * 4 + 1] = l.by + uy * l.L * p + ux * w; buf[m * 4 + 2] = frac(k * 0.618 + l.zaad); m++;
        }
        stoel += m;
        c.beginPath();
        for (let q = 0; q < m; q++) { const x = buf[q * 4], y = buf[q * 4 + 1]; c.moveTo(x - uy * 0.13, y + ux * 0.13); c.lineTo(x + uy * 0.13, y - ux * 0.13); }
        c.strokeStyle = '#2a2c30'; c.lineWidth = 0.07; c.stroke();
        if (z >= 9) {
          // mensen op een deel van de stoeltjes
          for (let k = 0; k < 3; k++) {
            c.beginPath();
            let iets = false;
            for (let q = 0; q < m; q++) if (buf[q * 4 + 2] < 0.6 && Math.floor(buf[q * 4 + 2] * 5) % 3 === k) { rond(c, buf[q * 4] - ux * 0.06, buf[q * 4 + 1] - uy * 0.06, 0.05); iets = true; }
            if (iets) { c.fillStyle = JAS[k]; c.fill(); }
          }
        }
      }
      // skiërs op de pistes in de winter: zigzag naar beneden
      if (z >= 8 && this.sneeuwOp(l.hb + 0.05) && this.nacht < 0.6) {
        const buf = this.buf;
        let m = 0;
        for (const p of l.pistes) {
          if (this.bebouwd(p.tg)) continue;
          for (let k = 0; k < 6 && skiers + m < PLAFOND.skiers; k++) {
            const f = frac(t * 0.025 + k / 6 + p.kant * 0.11 + l.zaad), d = f * p.len;
            langs(p.pts, d, this.p3);
            const a = this.p3[2], zig = Math.sin(f * 40 + k) * 0.32, dz = Math.cos(f * 40 + k);
            buf[m * 4] = this.p3[0] - Math.sin(a) * zig; buf[m * 4 + 1] = this.p3[1] + Math.cos(a) * zig; buf[m * 4 + 2] = a + dz * 0.7; buf[m * 4 + 3] = k % JAS.length; m++;
          }
        }
        skiers += m;
        c.beginPath();
        for (let q = 0; q < m; q++) {
          const x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], co = Math.cos(a), si = Math.sin(a);
          for (let w = -0.035; w < 0.05; w += 0.07) { c.moveTo(x - co * 0.13 - si * w, y - si * 0.13 + co * w); c.lineTo(x + co * 0.13 - si * w, y + si * 0.13 + co * w); }
        }
        c.strokeStyle = '#26282c'; c.lineWidth = 0.022; c.stroke();
        for (let k = 0; k < JAS.length; k++) {
          c.beginPath();
          let iets = false;
          for (let q = 0; q < m; q++) if (buf[q * 4 + 3] === k) { rond(c, buf[q * 4], buf[q * 4 + 1], 0.06); iets = true; }
          if (iets) { c.fillStyle = JAS[k]; c.fill(); }
        }
      }
    }
    // kabelbaan: twee kabels zonder tussenmasten, twee gondels die elkaar halverwege kruisen
    for (const k of this.kabels) {
      if (!this.zicht((k.ax + k.bx) / 2, (k.ay + k.by) / 2, k.L / 2 + 2) || this.bebouwd(k.tg)) continue;
      const ux = (k.bx - k.ax) / k.L, uy = (k.by - k.ay) / k.L, o = 0.3, hoek = Math.atan2(uy, ux);
      this.plein(c, k.ax, k.ay, hoek, 1.25, k.ha);
      this.plein(c, k.bx, k.by, hoek, 1.25, k.hb);
      c.beginPath();
      for (let g = -1; g <= 1; g += 2) { const w = g * o; c.moveTo(k.ax - uy * w, k.ay + ux * w); c.lineTo(k.bx - uy * w, k.by + ux * w); }
      c.strokeStyle = 'rgba(30,32,36,0.7)'; c.lineWidth = Math.max(0.035, 0.6 * this.pix); c.stroke();
      c.beginPath();
      this.station(c, k.ax, k.ay, ux, uy, 0.7, 0.6);
      this.station(c, k.bx, k.by, ux, uy, 0.7, 0.6);
      c.fillStyle = '#9a9ea4'; c.fill();
      if (z >= 6 && gondel + 2 <= PLAFOND.gondels) {
        // de ene gondel gaat omhoog terwijl de andere zakt; ze kruisen elkaar halverwege
        const p = 0.5 - 0.5 * Math.cos(t * TAU / 90 + k.zaad * TAU);
        c.beginPath();
        for (let g = 0; g < 2; g++) {
          const f = g ? 1 - p : p, w = g ? -o : o;
          this.station(c, k.ax + ux * k.L * f - uy * w, k.ay + uy * k.L * f + ux * w, ux, uy, 0.3, 0.2);
        }
        c.fillStyle = '#b8322a'; c.fill();
        if (z >= 10) {
          c.beginPath();
          for (let g = 0; g < 2; g++) {
            const f = g ? 1 - p : p, w = g ? -o : o, x = k.ax + ux * k.L * f - uy * w, y = k.ay + uy * k.L * f + ux * w;
            c.moveTo(x - ux * 0.22 - uy * 0.08, y - uy * 0.22 + ux * 0.08); c.lineTo(x + ux * 0.22 - uy * 0.08, y + uy * 0.22 + ux * 0.08);
          }
          c.strokeStyle = 'rgba(210,230,240,0.85)'; c.lineWidth = 0.06; c.stroke();
        }
        gondel += 2;
      }
    }
    this.n.liften = liften; this.n.stoeltjes = stoel; this.n.gondels = gondel; this.n.skiers = skiers;
  }

  tekenVuurvliegjes(c) {
    const sz = this.sz;
    const seizoen = sz.zomer + 0.5 * sz.lente;
    // in de regen vliegen ze niet
    if (!this.vlieg.length || this.nacht < 0.3 || seizoen < 0.4 || this.wr.regen > 0.3) return;
    const t = this.t, ga = c.globalAlpha;
    let n = 0;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const v of this.vlieg) {
      if (n >= PLAFOND.vuurvliegjes) break;
      if (!this.zicht(v.x, v.y, 2) || this.bebouwd(v.tg)) continue;
      for (let k = 0; k < 10 && n < PLAFOND.vuurvliegjes; k++) {
        const f = v.zaad * 50 + k * 1.7;
        const helder = Math.pow(Math.max(0, Math.sin(t * 2.2 + f * 3.1)), 4);
        if (helder < 0.05) continue;
        const x = v.x + Math.sin(t * 0.31 + f) * 1.2 + Math.sin(t * 0.83 + f * 2) * 0.3, y = v.y + Math.cos(t * 0.27 + f * 1.3) * 0.9;
        c.globalAlpha = ga * helder * smooth(0.3, 0.7, this.nacht) * Math.min(1, seizoen);
        c.drawImage(this.gloei, x - 0.16, y - 0.16, 0.32, 0.32);
        n++;
      }
    }
    c.restore();
    this.n.vuurvliegjes = n;
  }

  tekenRoofvogels(c) {
    if (!this.roof.length) return;
    const t = this.t, buf = this.buf;
    let n = 0;
    for (const r of this.roof) {
      if (n >= PLAFOND.roofvogels) break;
      if (!this.zicht(r.x, r.y, r.R + 4)) continue;
      const u = t * r.v + r.f;
      buf[n * 4] = r.x + Math.cos(u) * r.R; buf[n * 4 + 1] = r.y + Math.sin(u) * r.R; buf[n * 4 + 2] = u + (r.v > 0 ? Math.PI / 2 : -Math.PI / 2); buf[n * 4 + 3] = r.hoog;
      n++;
    }
    this.n.roofvogels = n;
    if (!n) return;
    // schaduw op de grond, naar het zuidoosten (hoe hoger, hoe verder)
    c.beginPath(); this.vleugels(c, n, 0.9, 1.1); c.fillStyle = 'rgba(0,0,0,0.14)'; c.fill();
    c.beginPath(); this.vleugels(c, n, 0, 0); c.fillStyle = '#5a4232'; c.fill();
    if (this.z >= 9) { c.beginPath(); for (let q = 0; q < n; q++) { const a = buf[q * 4 + 2]; rond(c, buf[q * 4] + Math.cos(a) * 0.2, buf[q * 4 + 1] + Math.sin(a) * 0.2, 0.06); } c.fillStyle = '#d8c8a0'; c.fill(); }
  }

  // Silhouetten van de roofvogels in buf, verschoven met (dx, dy) maal hun hoogte (voor de schaduw).
  vleugels(c, n, dx, dy) {
    const buf = this.buf, t = this.t;
    for (let q = 0; q < n; q++) {
      const x = buf[q * 4] + dx * buf[q * 4 + 3], y = buf[q * 4 + 1] + dy * buf[q * 4 + 3], a = buf[q * 4 + 2], co = Math.cos(a), si = Math.sin(a);
      // af en toe een paar vleugelslagen, verder zweven; het ritme hoort bij de vogel (zijn vlieghoogte is uniek), niet
      // bij zijn plek in buf, anders verspringt het als een andere vogel in of uit beeld komt
      const h = buf[q * 4 + 3] * 7;
      const slag = 1 - 0.18 * Math.max(0, Math.sin(t * 9 + h)) * (Math.sin(t * 0.3 + h * 2) > 0.8 ? 1 : 0);
      for (let k = 0; k < VLEUGEL.length; k += 2) {
        const p = k >> 1, vx = VLEUGEL[k], vy = VLEUGEL[k + 1] * (p === 2 || p === 3 || p === 8 || p === 9 ? slag : 1);
        const px = x + vx * co - vy * si, py = y + vx * si + vy * co;
        if (k) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.closePath();
    }
  }
}

// [x0, y0, x1, y1, ...] als paren [[x0, y0], [x1, y1], ...] (alleen bij het plaatsen).
function paren(pts) { const uit = []; for (let q = 0; q < pts.length; q += 2) uit.push([pts[q], pts[q + 1]]); return uit; }
// De punten van een polylijn plus de middens ertussen (een stuk kan net een hoek van een vakje raken).
function metMiddens(pts) {
  const uit = [pts[0], pts[1]];
  for (let q = 2; q < pts.length; q += 2) uit.push((pts[q - 2] + pts[q]) / 2, (pts[q - 1] + pts[q + 1]) / 2, pts[q], pts[q + 1]);
  return uit;
}
// Lengte van een polylijn [x0, y0, x1, y1, ...].
function lengte(pts) {
  let l = 0;
  for (let q = 2; q < pts.length; q += 2) l += Math.hypot(pts[q] - pts[q - 2], pts[q + 1] - pts[q - 1]);
  return l;
}
// Punt op afstand d langs een polylijn, met de richting en het stuk waar het op ligt: uit = [x, y, hoek, stuk].
function langs(pts, d, uit) {
  for (let q = 2; q < pts.length; q += 2) {
    const dx = pts[q] - pts[q - 2], dy = pts[q + 1] - pts[q - 1], l = Math.hypot(dx, dy);
    if (d <= l || q === pts.length - 2) {
      const f = l > 0 ? clamp(d / l, 0, 1) : 0;
      uit[0] = pts[q - 2] + dx * f; uit[1] = pts[q - 1] + dy * f; uit[2] = Math.atan2(dy, dx); uit[3] = q / 2 - 1;
      return uit;
    }
    d -= l;
  }
  uit[0] = pts[0]; uit[1] = pts[1]; uit[2] = 0; uit[3] = 0;
  return uit;
}
