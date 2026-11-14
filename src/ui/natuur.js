// Natuur bij diep inzoomen (C8): wat er in bos, bergen en water beweegt, bovenop het gebakken terrein.
// - Water: watervallen waar een rivier steil zakt (witte val, schuim dat uitdijt, nevel die meedrijft, bij zon soms
//   geen regenboog: die lag van bovenaf als verf op de grond), stroomversnellingen met schuimkoppen en keien, bevers met hun dam, burcht en vijver in beken.
// - Wild: wilde zwijnen met biggen, vossen en konijnen aan bosranden en op open plekken, berggeiten op de rotsen,
//   roofvogels die boven de bergen cirkelen, reigers langs de oever en ooievaars in natte weiden (niet in de winter),
//   wolven met sporen in de sneeuw (alleen in de winter), vuurvliegjes boven het water op zomeravonden.
// - Bergleven: zigzagpaden naar hutten met rook uit de schoorsteen en een uitzichtpunt, wandelaars in de zomer,
//   per land hooguit één skigebied bij de hoofdstad (stoeltjeslift met draaiende stoeltjes, in de winter witte pistes
//   met skiërs) en een kabelbaan met twee gondels naar een hoge top.
// - Dichtbij (zoom 9-14, C10): na een regenbui plassen en modder op de kale akkers, met kringen als het nog regent en
//   mussen die er overdag in badderen; in de lente een moeder met kuikens op de sloot; kikkers die van de kant in de
//   sloot of de plas springen en als twee oogjes terugzwemmen; libellen die boven het water stilhangen en wegschieten;
//   bijen en hommels boven de bloemenplekken van terrein.js; aan de bosrand een dode boom met overdag een kloppende
//   specht en 's nachts een uil met oplichtende ogen; eekhoorns die over omgevallen stammen rennen; egels die 's avonds
//   door het gras scharrelen; vleermuizen in de schemering; spinnenwebben vol dauw in de heggen op herfstochtenden.
//   De reiger vangt af en toe een vis. Wat op de grond staat ontwijkt ook wegen, gebouwen, werk en grensstroken van
//   werk.js (zijn botsraster) en de vakjes waar leven.js tractoren, kuddes en herten zet.
// Herten, kuddes, eenden, meeuwen, vlinders en vallend blad horen bij leven.js en komen hier niet nog eens (de moeder
// met kuikens hier zwemt op de sloten, die van leven.js langs de kust).
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
import { BOOMGRENS, ALMGRENS, SNEEUW_VAST, KENMERK, GEWAS, RAND, perceelHoek, bloemenPlek, kenmerkenVoorTegel } from './terrein.js';

const TAU = Math.PI * 2;
// Pistes liggen alleen op een helling: elk punt minstens zo steil (hoogteverschil per eenheid), van boven naar
// beneden per stap hooguit een bultje bergop, en onderaan duidelijk lager dan bovenaan. Puur; h(x, y) is de hoogte.
export const PISTE_HELLING = 0.015, PISTE_BULT = 0.15, PISTE_VAL = 0.2;
// Een zigzagpad begint pas waar het minstens zo steil is (zelfde maat als hellingOp).
export const PAD_HELLING = 0.02;
export const hellingOp = (h, x, y) => Math.hypot(h(x + 0.8, y) - h(x - 0.8, y), h(x, y + 0.8) - h(x, y - 0.8)) / 1.6;
export function pisteOpHelling(h, pts) {
  if (pts.length < 12) return false;
  let vorige = Infinity;
  for (let q = 0; q < pts.length; q += 2) {
    const ph = h(pts[q], pts[q + 1]);
    if (ph > vorige + PISTE_BULT || hellingOp(h, pts[q], pts[q + 1]) < PISTE_HELLING) return false;
    vorige = ph;
  }
  return h(pts[0], pts[1]) - h(pts[pts.length - 2], pts[pts.length - 1]) >= PISTE_VAL;
}
// De voet van een piste inkorten: onderaan geen vlak stuk en geen stuk dat weer bergop loopt.
export function pisteVoet(h, pts) {
  while (pts.length > 12) {
    const n = pts.length, x = pts[n - 2], y = pts[n - 1];
    if (hellingOp(h, x, y) >= PISTE_HELLING && h(x, y) < h(pts[n - 4], pts[n - 3])) break;
    pts.length -= 2;
  }
  return pts;
}
function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
const tri = (v) => 1 - Math.abs(2 * frac(v) - 1); // 0 → 1 → 0, doorlopend

// Geen document bij importeren: de canvasfabriek is pas nodig bij laad() en is te vervangen in tests.
let maakCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
export function zetCanvasFabriek(fn) { maakCanvas = fn; }

// Harde plafonds per frame.
export const PLAFOND = {
  watervallen: 12, versnellingen: 30, zwijnen: 30, vossen: 8, konijnen: 40, geiten: 30, roofvogels: 6, reigers: 12,
  ooievaars: 10, bevers: 6, wolven: 12, sporen: 20, vuurvliegjes: 80, skiers: 40, stoeltjes: 60, gondels: 4,
  wandelaars: 20, hutten: 12, paden: 16, liften: 4, uitzicht: 16,
  // dichtbij (zoom 9-14)
  plassen: 40, mussen: 24, kuikens: 28, kikkers: 16, libellen: 16, bijen: 40, dodeBomen: 16, spechten: 6, uilen: 6,
  eekhoorns: 10, egels: 10, vleermuizen: 24, webben: 24, vissen: 12,
};

// Hoeveel dingen van dichtbij per soort hooguit in de wereld (een vangnet; de plaatsing zelf blijft er ruim onder, zodat
// het zuiden van de kaart net zo veel krijgt als het noorden).
const MAX_DICHTBIJ = 4000;

// Vanaf welke zoom iets van dichtbij te zien is.
export const DREMPEL = { plas: 9, vleermuis: 9.5, kuiken: 10, uil: 10, dodeBoom: 8, specht: 10.5, libel: 10.5, egel: 10.5, kikker: 11, eekhoorn: 11, mus: 11, bij: 11.5, web: 12 };

// Dieren op de grond: soort, naam voor het plafond, lengte in wereldeenheden, snelheid (lussen per seconde).
const ZWIJN = 0, VOS = 1, KONIJN = 2, GEIT = 3, REIGER = 4, OOIEVAAR = 5;
const DIER_NAAM = ['zwijnen', 'vossen', 'konijnen', 'geiten', 'reigers', 'ooievaars'];
const DIER_LENGTE = [0.3, 0.28, 0.14, 0.3, 0.3, 0.32];
const DIER_V = [0.05, 0.08, 0.07, 0.025, 0, 0.03];
const JAS = ['#c0392b', '#2e86c1', '#f0b429', '#2f9e5b', '#8a4bb8', '#ecefe9'];
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

// Fase van de dag uit dezelfde klok: 0 is midden op de dag, 0,5 middernacht; tussen 0,66 en 0,92 is het ochtend.
const faseOp = (nu) => ((nu / 1000) % 180) / 180;
const ochtendOp = (nu) => { const f = faseOp(nu); return smooth(0.64, 0.7, f) * (1 - smooth(0.88, 0.94, f)); };

// Vakjes waar leven.js tractoren, kuddes en herten zet (dezelfde hashes als daar en in werk.js).
const levenAkker = (t) => t.terrein === 'vlakte' && t.eig >= 0 && hash(t.i, 3) < 0.45 && hash(t.i, 101) < 0.5;
const levenKudde = (t) => t.eig >= 0 && !(t.terrein === 'vlakte' && hash(t.i, 3) < 0.45) && (t.terrein === 'vlakte' || t.terrein === 'kust') && hash(t.i, 61) < 0.6 && hash(t.i, 111) < 0.42;
const levenHert = (t) => t.terrein === 'bos' && hash(t.i, 171) < 0.3;
// Botsraster van werk.js: wegen en spoor (1), gebouwen en stad (2), werk op het land (4) en grensstroken (8).
const BOTS = 1 | 2 | 4 | 8;

// Ruimtelijk register: per cel van 32 eenheden welke dingen erin liggen, zodat elk frame alleen het beeld telt.
const RC = 32, RK = Math.ceil(1000 / RC), RR = Math.ceil(620 / RC);
function maakRooster(lijst) {
  const start = new Int32Array(RK * RR + 1), idx = new Int32Array(lijst.length);
  const cel = (d) => clamp(Math.floor(d.y / RC), 0, RR - 1) * RK + clamp(Math.floor(d.x / RC), 0, RK - 1);
  for (const d of lijst) start[cel(d) + 1]++;
  for (let i = 0; i < RK * RR; i++) start[i + 1] += start[i];
  const vul = start.slice(0, RK * RR);
  lijst.forEach((d, i) => { idx[vul[cel(d)]++] = i; });
  return { start, idx };
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
    this.zi = new Int32Array(512); // indexen van de dingen van dichtbij die in beeld zijn
    this.zaadBuf = new Float32Array(96); // per dier in buf: zijn zaad (voor het ritme van de reiger)
    this.vistBuf = new Uint8Array(96); // per dier in buf: 1 als de snavel van de reiger in het water uitvalt
    this.leegDichtbij();
  }

  leegDichtbij() {
    this.plasjes = []; this.kuikens = []; this.kikkers = []; this.libellen = []; this.bijen = []; this.dodeBomen = [];
    this.eekhoorns = []; this.egels = []; this.vleer = []; this.webben = []; this.rs = {};
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
    this.leegDichtbij();
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
    this.plaatsDichtbij();
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
      // C12: haarspeldbochten alleen op de helling; het vlakke begin aan de bergvoet gaat eraf (anders lag er een 'M'
      // van paden op vlak gras)
      const hp = (px, py) => tl.hoogte(px, py);
      let eerst = 0;
      while (eerst + 2 < pts.length && hellingOp(hp, pts[eerst], pts[eerst + 1]) < PAD_HELLING) eerst += 2;
      if (eerst) pts.splice(0, eerst);
      if (pts.length < 8) continue;
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
          // alleen op de helling: de vlakke voet gaat eraf, en wat overblijft daalt overal en is steil genoeg
          const hh = (x, y) => this.h(x, y);
          pisteVoet(hh, pts);
          if (!pisteOpHelling(hh, pts)) continue;
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

  // Dichtbij: plassen op kale akkers, sloten met kuikens, kikkers en libellen, plassen in het moeras, bloemenplekken
  // met bijen, dode bomen aan de bosrand, eekhoorns op omgevallen stammen, egels in het gras, vleermuizen en
  // spinnenwebben in de heggen. Alles uit de kenmerken van terrein.js en vaste hashes, eenmalig per wereld.
  plaatsDichtbij() {
    const geo = this.geo, tl = this.terrein, b = this.basis, v = tl.vlaggen, K = KENMERK;
    // water of stad (ook als een ding over de rand van zijn eigen tegel steekt)
    const water = (x, y) => this.zee(x, y) || tl.isRivier(x, y, 0.15) || tl.isMeer(x, y) || v.stad[this.tegelVan(x, y)];
    // kale akker waar leven.js geen tractor laat rijden
    const kaal = (x, y) => { const tt = geo.tegels[this.tegelVan(x, y)]; return v.akker[tt.i] && !levenAkker(tt) && !water(x, y); };
    // een lijnstuk langs een perceelrand (u langs, w dwars in het akkerrooster) met monsters voor de botstoets
    const stuk = (px, py, co, si, u0, u1, w) => {
      const ax = px + u0 * co - w * si, ay = py + u0 * si + w * co, bx = px + u1 * co - w * si, by = py + u1 * si + w * co;
      const pts = [];
      for (let q = 0; q <= 4; q++) pts.push(ax + (bx - ax) * q / 4, ay + (by - ay) * q / 4);
      return { ax, ay, bx, by, pts };
    };
    for (const t of geo.tegels) {
      if (t.terrein === 'water' || v.stad[t.i]) continue;
      const f = kenmerkenVoorTegel(t, b);
      const open = (t.terrein === 'vlakte' || t.terrein === 'kust') && !v.akker[t.i];
      let bosBuur = false;
      for (let dr = -1; dr <= 1 && !bosBuur; dr++) for (let dk = -1; dk <= 1 && !bosBuur; dk++) {
        const k = t.k + dk, r = t.r + dr;
        if (k >= 0 && r >= 0 && k < geo.kol && r < geo.rij && geo.tegels[r * geo.kol + k].terrein === 'bos') bosBuur = true;
      }
      for (let p = 0; p < f.length; p += K.STAP) {
        const ty = f[p], z = hash(t.i, p, 900);
        const h = ty === K.PERCEEL ? perceelHoek(t, f, p) : perceelHoek(t), co = Math.cos(h), si = Math.sin(h);
        if (ty === K.PERCEEL) {
          const soort = f[p + 4] & 15, rand = (f[p + 4] >> 5) & 7, px = t.x + f[p + 1], py = t.y + f[p + 2], hu = f[p + 3], hv = f[p + 5];
          // plassen op kale grond (geploegd, braak, net ingezaaid of maïs): pas zichtbaar na een bui
          if ((soort === GEWAS.PLOEG || soort === GEWAS.BRAAK || soort === GEWAS.GROEN || soort === GEWAS.MAIS) && !levenAkker(t) && hash(t.i, p, 901) < 0.4 && this.plasjes.length < MAX_DICHTBIJ) {
            const n = 1 + Math.floor(hash(t.i, p, 902) * 3);
            for (let k = 0; k < n; k++) {
              const u = (hash(t.i, p * 5 + k, 903) - 0.5) * 2 * (hu - 0.8), w = (hash(t.i, p * 5 + k, 904) - 0.5) * 2 * (hv - 0.7);
              if (hu < 1 || hv < 0.9) break;
              const x = px + u * co - w * si, y = py + u * si + w * co, rx = 0.35 + hash(t.i, p * 5 + k, 905) * 0.45;
              if (!kaal(x, y)) continue;
              this.plasjes.push({ x, y, rx, ry: rx * (0.5 + 0.2 * hash(t.i, p * 5 + k, 906)), h: h + (hash(t.i, p * 5 + k, 907) - 0.5) * 0.8, zaad: hash(t.i, p * 5 + k, 908), mus: hash(t.i, p * 5 + k, 909) < 0.3, tg: this.tegelsRond(x, y, rx + 0.3), wr: rx + 0.2 });
            }
          }
          if (rand === RAND.SLOOT) {
            // een moeder met kuikens zwemt heen en weer langs de lange kant van de sloot
            const lang = hu >= hv;
            if (hash(t.i, p, 911) < 0.22 && this.kuikens.length < MAX_DICHTBIJ) {
              const s = lang ? stuk(px, py, co, si, -hu + 0.6, hu - 0.6, -(hv + 0.1)) : stuk(px, py, -si, co, -hv + 0.6, hv - 0.6, hu + 0.1);
              let ok = true;
              for (let q = 0; q < s.pts.length && ok; q += 2) ok = !water(s.pts[q], s.pts[q + 1]) && tl.boomvrij(s.pts[q], s.pts[q + 1], 0.1, true); // niet onder een kruin
              const L = Math.hypot(s.bx - s.ax, s.by - s.ay);
              if (ok && L > 2) this.kuikens.push({ x: (s.ax + s.bx) / 2, y: (s.ay + s.by) / 2, ax: s.ax, ay: s.ay, bx: s.bx, by: s.by, L, zaad: z, tg: this.tegelsVan(s.pts), wp: Float32Array.from(s.pts) });
            }
            // een kikker op de kant, met de sloot voor zich
            if (hash(t.i, p, 912) < 0.3 && this.kikkers.length < MAX_DICHTBIJ) {
              const u = (hash(t.i, p, 913) - 0.5) * 2 * (hu - 0.5), w = hv + 0.1 + 0.3;
              const x = px + u * co - w * si, y = py + u * si + w * co;
              if (!water(x, y) && tl.boomvrij(x, y, 0.1, true)) this.kikkers.push({ x, y, dx: si, dy: -co, sprong: 0.3, zaad: z, tg: this.tegelsRond(x, y, 0.45), wr: 0.3 });
            }
            // libellen boven de sloot
            if (hash(t.i, p, 914) < 0.1 && this.libellen.length < MAX_DICHTBIJ) {
              const s = stuk(px, py, co, si, -hu * 0.8, hu * 0.8, hv + 0.1);
              if (!water(s.ax, s.ay) && !water(s.bx, s.by)) this.libellen.push({ x: (s.ax + s.bx) / 2, y: (s.ay + s.by) / 2, ux: co, uy: si, L: hu * 0.8, w: 0.35, zaad: z, tg: this.tegelsVan(s.pts) });
            }
          } else if (rand === RAND.HAAGRAND && hash(t.i, p, 915) < 0.22 && this.webben.length < MAX_DICHTBIJ) {
            // spinnenweb in de heg (de heg ligt 0,1 buiten het perceel)
            const langs = hash(t.i, p, 916) < 0.6, kant = hash(t.i, p, 917) < 0.5 ? -1 : 1, s = hash(t.i, p, 918) - 0.5;
            const u = langs ? s * 2 * hu : kant * (hu + 0.1), w = langs ? kant * (hv + 0.1) : s * 2 * hv;
            const x = px + u * co - w * si, y = py + u * si + w * co;
            if (!water(x, y) && tl.boomvrij(x, y, 0.4, true)) this.webben.push({ x, y, r: 0.28 + hash(t.i, p, 919) * 0.14, a: hash(t.i, p, 920) * TAU, zaad: z, tg: this.tegelsRond(x, y, 0.45), wr: 0.2 });
          }
        } else if (ty === K.PLAS) {
          // moerasplas: [x, y, r, zaad, hoek], een ellips van r bij 0,62 r
          const px = t.x + f[p + 1], py = t.y + f[p + 2], r = f[p + 3], hk = f[p + 5], ch = Math.cos(hk), sh = Math.sin(hk);
          if (hash(t.i, p, 921) < 0.6 && this.kikkers.length < MAX_DICHTBIJ) {
            const a = hash(t.i, p, 922) * TAU, u = Math.cos(a) * (r + 0.3), w = Math.sin(a) * (r * 0.62 + 0.3);
            const x = px + u * ch - w * sh, y = py + u * sh + w * ch, l = Math.hypot(px - x, py - y) || 1;
            if (!water(x, y) && tl.boomvrij(x, y, 0.1, true)) this.kikkers.push({ x, y, dx: (px - x) / l, dy: (py - y) / l, sprong: Math.min(0.6, l * 0.55), zaad: z, tg: this.tegelsRond(x, y, 0.5), wr: 0.3 });
          }
          if (hash(t.i, p, 923) < 0.5 && !water(px, py) && this.libellen.length < MAX_DICHTBIJ) this.libellen.push({ x: px, y: py, ux: ch, uy: sh, L: r * 0.8, w: r * 0.5, zaad: z, tg: this.tegelsRond(px, py, r + 0.3) });
        } else if (ty === K.STAM && t.terrein === 'bos' && !levenHert(t) && hash(t.i, p, 931) < 0.9 && this.eekhoorns.length < MAX_DICHTBIJ) {
          const x = t.x + f[p + 1], y = t.y + f[p + 2], l = f[p + 3], ex = Math.cos(f[p + 4]) * l * 0.42, ey = Math.sin(f[p + 4]) * l * 0.42;
          // een stam kan half onder de kruinen liggen; de eekhoorn tekent boven de bomen, dus alleen een stam in het open
          if (!tl.boomvrij(x, y, 0.15, true) || !tl.boomvrij(x + ex, y + ey, 0.15, true) || !tl.boomvrij(x - ex, y - ey, 0.15, true)) continue;
          this.eekhoorns.push({ x, y, l, co: Math.cos(f[p + 4]), si: Math.sin(f[p + 4]), zaad: z, tg: this.tegelsRond(x, y, l / 2 + 0.3), wr: l / 2 });
        } else if (ty === K.OPENPLEK && t.terrein === 'bos' && !levenHert(t) && hash(t.i, p, 932) < 0.2 && this.dodeBomen.length < MAX_DICHTBIJ) {
          const x = t.x + f[p + 1], y = t.y + f[p + 2];
          if (this.vrij(x, y, 0.6)) this.dodeBoom(x, y, z);
        }
      }
      if (open && !v.moeras[t.i]) {
        // bijen boven de bloemenplek van terrein.js
        const bp = bloemenPlek(t, b);
        if (bp && hash(t.i, 941) < 0.7 && this.bijen.length < MAX_DICHTBIJ) this.bijen.push({ x: bp.x, y: bp.y, r: bp.r, zaad: hash(t.i, 942), tg: this.tegelsRond(bp.x, bp.y, bp.r + 0.4) });
        // dode boom aan de bosrand
        if (bosBuur && !levenKudde(t) && hash(t.i, 943) < 0.32 && this.dodeBomen.length < MAX_DICHTBIJ) {
          for (let q = 0; q < 6; q++) {
            const x = t.x + (hash(t.i, q, 944) - 0.5) * geo.T * 0.8, y = t.y + (hash(t.i, q, 945) - 0.5) * geo.T * 0.8, wB = tl.gewicht(x, y).bos;
            if (wB < 0.12 || wB > 0.45 || !this.vrij(x, y, 0.6)) continue;
            this.dodeBoom(x, y, hash(t.i, q, 946));
            break;
          }
        }
        // egels: 's avonds een rondje door het gras, liefst bij bos of heg
        if (!levenKudde(t) && hash(t.i, 951) < (bosBuur ? 0.2 : 0.08) && this.egels.length < MAX_DICHTBIJ) {
          const x = t.x + (hash(t.i, 952) - 0.5) * geo.T * 0.6, y = t.y + (hash(t.i, 953) - 0.5) * geo.T * 0.6;
          const d = { x, y, R: 0.9, v: 0.022, f: hash(t.i, 954) * TAU, a: 0, tg: null, jong: 0, kl: 0, zaad: hash(t.i, 955), wr: 1.4 };
          if (this.vrij(x, y, 0.3) && this.pasLus(d)) { d.tg = this.lusTegels(d); this.egels.push(d); }
        }
      }
      // vleermuizen: in de schemering boven de bosrand en het water
      if ((bosBuur || tl.rivierAfstand(t.x, t.y) < 4) && t.terrein !== 'berg' && hash(t.i, 961) < 0.06 && this.vleer.length < MAX_DICHTBIJ) {
        const x = t.x + (hash(t.i, 962) - 0.5) * geo.T * 0.5, y = t.y + (hash(t.i, 963) - 0.5) * geo.T * 0.5, R = 1.4 + hash(t.i, 964) * 1.2;
        if (!water(x, y) && !this.zee(x + R, y) && !this.zee(x - R, y)) this.vleer.push({ x, y, R, n: 2 + Math.floor(hash(t.i, 965) * 3), zaad: hash(t.i, 966), tg: this.tegelsRond(x, y, R + 0.6) });
      }
    }
    for (const d of this.dieren) if (d.s === REIGER) this.vist(d);
    for (const k of ['plasjes', 'kuikens', 'kikkers', 'libellen', 'bijen', 'dodeBomen', 'eekhoorns', 'egels', 'vleer', 'webben']) this.rs[k] = maakRooster(this[k]);
  }

  // Een dode boom: kale stam met twee takken en een lange schaduw naar het zuidoosten (die vakjes horen er ook bij).
  dodeBoom(x, y, zaad) {
    this.dodeBomen.push({ x, y, zaad, a: zaad * TAU, tg: this.tegelsVan([x - 0.7, y - 0.7, x + 0.7, y - 0.7, x - 0.7, y + 0.7, x + 0.7, y + 0.7, x + 1.4, y + 1.6]), wr: 0.7 });
  }

  // ---------- elke frame ----------

  // C12: alleen op gebakken grond (terrein knipt het canvas tot de gebakken brokken; niets gebakken: niets tekenen)
  teken(c, view, sc, nu, dt = 0, tempo = 0) {
    const klem = view?.terreinLaag?.klemOpGebakken?.(c) ?? 1;
    if (!klem) { for (const k in this.n) this.n[k] = 0; return; }
    try { return this.tekenOpGrond(c, view, sc, nu, dt, tempo); } finally { if (klem === 2) c.restore(); }
  }
  tekenOpGrond(c, view, sc, nu, dt = 0, tempo = 0) {
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
    // dichtbij: het botsraster van werk.js (dat eerder tekent), de natheid na regen en het uur van de dag
    const wl = view.werkLaag;
    this.dj = wl && Number.isFinite(wl.dj) && wl.dj - this.sz.dagInJaar >= -1 && wl.dj - this.sz.dagInJaar < 1 ? wl.dj : this.sz.dagInJaar;
    this.werk = wl && typeof wl.vrij === 'function' ? wl : null; this.werkSig = wl?.sig ?? 0;
    this.natheid = z >= DREMPEL.plas ? this.natheidOp(dag, view.cx, view.cy) : 0;
    this.ochtend = ochtendOp(nu);
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
    if (z >= DREMPEL.plas) { c.globalAlpha = a * smooth(DREMPEL.plas, DREMPEL.plas + 1, z); this.tekenPlasjes(c); c.globalAlpha = a; }
    if (z >= 5) this.tekenVersnellingen(c);
    this.tekenVallen(c);
    if (z >= 7) this.tekenBevers(c);
    // dieren op de grond
    if (z >= 7.5) {
      c.globalAlpha = smooth(7.5, 8.5, z);
      this.tekenDieren(c);
      if (this.sz.winter > 0.18) { const gw = c.globalAlpha; c.globalAlpha = gw * smooth(0.18, 0.32, this.sz.winter); this.tekenWolven(c); c.globalAlpha = gw; } // wolven vagen met de winter in en uit
    }
    // kleine dieren van dichtbij, elk vanaf zijn eigen zoom
    const dicht = (k) => { c.globalAlpha = a * smooth(DREMPEL[k], DREMPEL[k] + 0.8, z); };
    if (z >= DREMPEL.kuiken) { dicht('kuiken'); this.tekenKuikens(c); }
    if (z >= DREMPEL.egel) { dicht('egel'); this.tekenEgels(c); }
    if (z >= DREMPEL.kikker) { dicht('kikker'); this.tekenKikkers(c); }
    if (z >= DREMPEL.eekhoorn) { dicht('eekhoorn'); this.tekenEekhoorns(c); }
    if (z >= DREMPEL.web) { dicht('web'); this.tekenWebben(c); }
    if (z >= DREMPEL.dodeBoom) { c.globalAlpha = a; this.tekenDodeBomen(c); }
    // huizen en liften, dan wat erin of eraan beweegt
    c.globalAlpha = a;
    if (z >= 5.5) this.tekenHutten(c);
    if (z >= 7) this.tekenUitzicht(c);
    this.tekenLiften(c);
    if (z >= 8) this.tekenVuurvliegjes(c);
    if (z >= DREMPEL.libel) { dicht('libel'); this.tekenLibellen(c); }
    if (z >= DREMPEL.bij) { dicht('bij'); this.tekenBijen(c); }
    if (z >= DREMPEL.vleermuis) { dicht('vleermuis'); this.tekenVleermuizen(c); }
    c.globalAlpha = a;
    this.tekenRoofvogels(c);
    c.restore();
  }

  // 1 binnen de dagen [a, b] van het jaar, met een overgang van vier dagen op de doorlopende dag (geen sprong)
  venster(a, b) { const d = this.dj ?? this.sz.dagInJaar; return smooth(a - 2, a + 2, d) * (1 - smooth(b - 2, b + 2, d)); }

  zicht(x, y, m = 0) { return x > this.x0 - m && x < this.x1 + m && y > this.y0 - m && y < this.y1 + m; }

  // ---------- dichtbij: tekenen ----------

  // Botst een ding met een weg, gebouw, werk of grensstrook van werk.js? Eén keer per stand van zijn botsraster.
  vrijWerk(d) {
    const w = this.werk;
    if (!w) return true;
    if (d.ws !== this.werkSig) {
      d.ws = this.werkSig;
      let ok = true;
      const p = d.wp;
      if (p) for (let q = 0; q < p.length && ok; q += 2) ok = w.vrij(p[q], p[q + 1], 0.3, BOTS);
      else ok = w.vrij(d.x, d.y, d.wr ?? 0.4, BOTS);
      d.wv = ok;
    }
    return d.wv;
  }

  // Indexen (in this.zi) van de dingen uit lijst `naam` die in beeld zijn, zonder gebouw en zonder botsing; vaste
  // volgorde per cel. Geeft het aantal terug.
  verzamel(naam, marge) {
    const lijst = this[naam], rs = this.rs[naam], zi = this.zi;
    if (!lijst.length) return 0;
    let n = 0;
    const c0 = clamp(Math.floor((this.x0 - marge) / RC), 0, RK - 1), c1 = clamp(Math.floor((this.x1 + marge) / RC), 0, RK - 1);
    const r0 = clamp(Math.floor((this.y0 - marge) / RC), 0, RR - 1), r1 = clamp(Math.floor((this.y1 + marge) / RC), 0, RR - 1);
    for (let r = r0; r <= r1; r++) for (let k = c0; k <= c1; k++) {
      const cel = r * RK + k;
      for (let j = rs.start[cel]; j < rs.start[cel + 1] && n < zi.length; j++) {
        const d = lijst[rs.idx[j]];
        if (!this.zicht(d.x, d.y, marge) || this.bebouwd(d.tg) || !this.vrijWerk(d)) continue;
        zi[n++] = rs.idx[j];
      }
    }
    return n;
  }

  // Na een bui: hoe nat de akkers nog zijn (vandaag, gisteren en eergisteren), op het midden van het beeld.
  natheidOp(dag, x, y) {
    const k = (dag * 128 + Math.round(x / 8)) * 128 + Math.round(y / 8); // een getal: geen nieuwe tekst per frame
    if (this.natSleutel !== k) {
      this.natSleutel = k;
      this.natWaarde = Math.max(weer(dag, x, y).regen, 0.75 * weer(dag - 1, x, y).regen, 0.45 * weer(dag - 2, x, y).regen);
    }
    return this.natWaarde;
  }

  // Plassen en modder op de kale akkers na regen; kringen zolang het regent; bevroren in de vorst.
  tekenPlasjes(c) {
    const nat = this.natheid;
    if (nat < 0.15 || this.pal.A > 0.3) return;
    const n = this.verzamel('plasjes', 1);
    const ijs = this.pal.ijs > 0.6, t = this.t, groot = 0.6 + 0.6 * smooth(0.15, 0.7, nat), buf = this.buf;
    let m = 0;
    for (let q = 0; q < n && m < PLAFOND.plassen; q++) {
      const d = this.plasjes[this.zi[q]];
      if (d.zaad * 0.5 > nat - 0.15) continue; // na een flinke bui meer plassen
      buf[m * 4] = this.zi[q]; m++;
    }
    this.n.plassen = m;
    if (!m) return;
    const L = this.plasjes;
    c.beginPath();
    for (let q = 0; q < m; q++) { const d = L[buf[q * 4]]; ellips(c, d.x + 0.05, d.y + 0.06, d.rx * groot + 0.22, d.ry * groot + 0.18, d.h); }
    c.fillStyle = 'rgba(78,58,36,0.5)'; c.fill();
    c.beginPath();
    for (let q = 0; q < m; q++) { const d = L[buf[q * 4]]; ellips(c, d.x, d.y, d.rx * groot, d.ry * groot, d.h); }
    c.fillStyle = ijs ? '#dde6ec' : 'rgba(128,150,160,0.9)'; c.fill();
    // de lucht spiegelt aan de noordwestkant, de zuidoostrand is donkerder
    c.beginPath();
    for (let q = 0; q < m; q++) { const d = L[buf[q * 4]]; ellips(c, d.x + d.rx * groot * 0.18, d.y + d.ry * groot * 0.2, d.rx * groot * 0.7, d.ry * groot * 0.6, d.h); }
    c.fillStyle = ijs ? 'rgba(190,206,216,0.6)' : 'rgba(84,104,112,0.5)'; c.fill();
    c.beginPath();
    for (let q = 0; q < m; q++) { const d = L[buf[q * 4]], x = d.x - d.rx * groot * 0.35, y = d.y - d.ry * groot * 0.35; c.moveTo(x - d.rx * groot * 0.3, y + 0.02); c.quadraticCurveTo(x, y - d.ry * groot * 0.25, x + d.rx * groot * 0.35, y - 0.02); }
    c.strokeStyle = 'rgba(236,244,246,0.75)'; c.lineWidth = Math.max(0.03, 0.6 * this.pix); c.stroke();
    if (!ijs && this.wr.regen > 0.12 && this.z >= 10) {
      c.beginPath();
      for (let q = 0; q < m; q++) {
        const d = L[buf[q * 4]];
        for (let k = 0; k < 3; k++) {
          const f = frac(t * 0.9 + k * 0.37 + d.zaad * 5), a = (d.zaad * 17 + k * 2.3 + Math.floor(t * 0.9 + k * 0.37 + d.zaad * 5) * 1.7) % TAU, rr = Math.sqrt(frac(a * 0.37)) * 0.6;
          const x = d.x + Math.cos(a) * d.rx * groot * rr, y = d.y + Math.sin(a) * d.ry * groot * rr;
          ellips(c, x, y, 0.03 + f * 0.14, (0.03 + f * 0.14) * 0.7, 0);
        }
      }
      c.strokeStyle = 'rgba(232,242,246,0.55)'; c.lineWidth = Math.max(0.02, 0.5 * this.pix); c.stroke();
    }
    // mussen die in een plas badderen: een paar op de rand die rondhuppen, één in het water die spat
    if (this.z >= DREMPEL.mus && !ijs && this.nacht < 0.4 && this.wr.regen < 0.3) {
      const ga = c.globalAlpha;
      c.globalAlpha = ga * (1 - smooth(0.2, 0.4, this.nacht)) * (1 - smooth(0.2, 0.3, this.wr.regen));
      this.tekenMussen(c, m, groot);
      c.globalAlpha = ga;
    }
  }

  tekenMussen(c, m, groot) {
    const L = this.plasjes, buf = this.buf, t = this.t, vogels = this.mussenBuf ?? (this.mussenBuf = new Float32Array(PLAFOND.mussen * 4));
    let n = 0;
    for (let q = 0; q < m && n + 4 <= PLAFOND.mussen; q++) {
      const d = L[buf[q * 4]];
      if (!d.mus) continue;
      for (let k = 0; k < 4; k++) {
        const o = n * 4;
        if (k === 0) { // in het water
          vogels[o] = d.x + Math.sin(t * 0.7 + d.zaad * 9) * d.rx * groot * 0.25; vogels[o + 1] = d.y; vogels[o + 2] = d.h + Math.sin(t * 0.5) * 0.6; vogels[o + 3] = 1;
        } else { // huppen over de rand, om de 0,6 tel een sprongetje
          const sprong = Math.floor(t / 0.6 + k * 0.37 + d.zaad * 3), f = frac(t / 0.6 + k * 0.37 + d.zaad * 3);
          const a = d.zaad * TAU + k * 2.1 + sprong * 0.5 + f * 0.5 * smooth(0, 0.3, f), rr = 1.25 + 0.15 * Math.sin(sprong * 1.7 + k);
          vogels[o] = d.x + Math.cos(a) * d.rx * groot * rr; vogels[o + 1] = d.y + Math.sin(a) * d.ry * groot * rr - 0.06 * Math.sin(Math.PI * smooth(0, 0.3, f));
          vogels[o + 2] = a + Math.PI / 2 + Math.sin(sprong * 2.3) * 0.8; vogels[o + 3] = 0;
        }
        n++;
      }
    }
    this.n.mussen = n;
    if (!n) return;
    c.beginPath(); for (let q = 0; q < n; q++) ellips(c, vogels[q * 4] + 0.03, vogels[q * 4 + 1] + 0.04, 0.06, 0.035, vogels[q * 4 + 2]); c.fillStyle = 'rgba(0,0,0,0.2)'; c.fill();
    c.beginPath(); for (let q = 0; q < n; q++) ellips(c, vogels[q * 4], vogels[q * 4 + 1], 0.06, 0.035, vogels[q * 4 + 2]); c.fillStyle = '#8a6a48'; c.fill();
    c.beginPath(); for (let q = 0; q < n; q++) { const a = vogels[q * 4 + 2]; rond(c, vogels[q * 4] + Math.cos(a) * 0.05, vogels[q * 4 + 1] + Math.sin(a) * 0.05, 0.026); } c.fillStyle = '#5e4e40'; c.fill();
    c.beginPath(); for (let q = 0; q < n; q++) { const a = vogels[q * 4 + 2]; ellips(c, vogels[q * 4] - Math.cos(a) * 0.005 - 0.008, vogels[q * 4 + 1] - Math.sin(a) * 0.005 - 0.01, 0.03, 0.014, a); } c.fillStyle = '#c8b494'; c.fill();
    // spatten rond de badderaar, en zijn vleugels die op en neer gaan
    c.beginPath();
    for (let q = 0; q < n; q++) {
      if (vogels[q * 4 + 3] !== 1) continue;
      const x = vogels[q * 4], y = vogels[q * 4 + 1], a = vogels[q * 4 + 2], s = 0.5 + 0.5 * Math.sin(t * 22 + q);
      c.moveTo(x - Math.sin(a) * 0.03, y + Math.cos(a) * 0.03); c.lineTo(x - Math.sin(a) * (0.06 + 0.05 * s) - Math.cos(a) * 0.02, y + Math.cos(a) * (0.06 + 0.05 * s) - Math.sin(a) * 0.02);
      c.moveTo(x + Math.sin(a) * 0.03, y - Math.cos(a) * 0.03); c.lineTo(x + Math.sin(a) * (0.06 + 0.05 * s) - Math.cos(a) * 0.02, y - Math.cos(a) * (0.06 + 0.05 * s) - Math.sin(a) * 0.02);
    }
    c.strokeStyle = '#6e5038'; c.lineWidth = 0.022; c.stroke();
    c.beginPath();
    for (let q = 0; q < n; q++) {
      if (vogels[q * 4 + 3] !== 1) continue;
      for (let k = 0; k < 6; k++) { const f = frac(t * 2.2 + k / 6), a = k * 1.05 + q, r = 0.06 + f * 0.16; rond(c, vogels[q * 4] + Math.cos(a) * r, vogels[q * 4 + 1] + Math.sin(a) * r * 0.8 - Math.sin(f * Math.PI) * 0.05, 0.012 * (1 - f) + 0.004); }
    }
    c.fillStyle = 'rgba(232,244,250,0.85)'; c.fill();
  }

  // Een moeder met haar kuikens op de sloot, in de lente: heen en weer langs de kant, de kuikens in een rijtje erachter.
  tekenKuikens(c) {
    const sz = this.sz, d0 = sz.dagInJaar;
    const k = this.venster(95, 175) * (1 - smooth(0.5, 0.7, this.nacht)) * (1 - smooth(0.2, 0.4, this.pal.ijs)); if (k < 0.02) return; c.globalAlpha *= k; // zacht in en uit (seizoen, dagdeel, weer) in plaats van een harde grens
    // de sloot is tot 9 lang: ook wie aan het eind zwemt, telt mee
    const n = this.verzamel('kuikens', 4.6), t = this.t, buf = this.buf;
    let m = 0;
    for (let q = 0; q < n; q++) {
      const d = this.kuikens[this.zi[q]], aantal = 3 + Math.floor(d.zaad * 4);
      if (m + aantal + 1 > PLAFOND.kuikens) break;
      const u = t * 0.6 / (2 * d.L) + d.zaad, dx = (d.bx - d.ax) / d.L, dy = (d.by - d.ay) / d.L;
      for (let k = 0; k <= aantal; k++) {
        // elk kuiken zwemt dezelfde baan heen en weer, iets later dan wie voor hem zwemt: bij het keren volgen ze
        // de moeder om in plaats van te verspringen
        const uk = u - (k ? k * 0.15 + 0.06 : 0) / (2 * d.L), kop = frac(uk) < 0.5 ? 1 : -1, s = tri(uk) * d.L, zij = k ? Math.sin(t * 2 + k * 1.3) * 0.03 : 0;
        buf[m * 4] = d.ax + dx * s - dy * zij; buf[m * 4 + 1] = d.ay + dy * s + dx * zij; buf[m * 4 + 2] = Math.atan2(dy * kop, dx * kop); buf[m * 4 + 3] = k ? 1 : 0;
        m++;
      }
    }
    this.n.kuikens = m;
    if (!m) return;
    c.beginPath();
    for (let q = 0; q < m; q++) {
      const x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], ca = Math.cos(a), sa = Math.sin(a), w = buf[q * 4 + 3] ? 0.03 : 0.06;
      c.moveTo(x - ca * w * 2.2 - sa * w, y - sa * w * 2.2 + ca * w); c.lineTo(x - ca * w * 0.6, y - sa * w * 0.6); c.lineTo(x - ca * w * 2.2 + sa * w, y - sa * w * 2.2 - ca * w);
    }
    c.strokeStyle = 'rgba(232,244,248,0.5)'; c.lineWidth = Math.max(0.015, 0.4 * this.pix); c.stroke();
    c.beginPath(); for (let q = 0; q < m; q++) if (!buf[q * 4 + 3]) ellips(c, buf[q * 4], buf[q * 4 + 1], 0.09, 0.05, buf[q * 4 + 2]); c.fillStyle = '#7a5a3a'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) if (!buf[q * 4 + 3]) { const a = buf[q * 4 + 2]; rond(c, buf[q * 4] + Math.cos(a) * 0.08, buf[q * 4 + 1] + Math.sin(a) * 0.08, 0.032); } c.fillStyle = '#2e6b45'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) if (buf[q * 4 + 3]) rond(c, buf[q * 4], buf[q * 4 + 1], 0.032); c.fillStyle = '#d9c070'; c.fill();
    if (this.z >= 12) { c.beginPath(); for (let q = 0; q < m; q++) if (buf[q * 4 + 3]) { const a = buf[q * 4 + 2]; rond(c, buf[q * 4] + Math.cos(a) * 0.022, buf[q * 4 + 1] + Math.sin(a) * 0.022, 0.016); } c.fillStyle = '#8a6a30'; c.fill(); }
  }

  // Kikkers: zitten op de kant, springen in een boogje het water in (een kring), zwemmen als twee oogjes terug.
  tekenKikkers(c) {
    const d0 = this.sz.dagInJaar;
    const k = this.venster(75, 275) * (1 - smooth(0.75, 0.95, this.nacht)) * (1 - smooth(0.2, 0.4, this.pal.ijs)); if (k < 0.02) return; c.globalAlpha *= k; // zacht in en uit (seizoen, dagdeel, weer) in plaats van een harde grens
    const n = this.verzamel('kikkers', 1), t = this.t, buf = this.buf;
    let m = 0, kring = 0;
    const kr = this.kringBuf ?? (this.kringBuf = new Float32Array(PLAFOND.kikkers * 3));
    for (let q = 0; q < n && m + kring < PLAFOND.kikkers; q++) { // wie net in het water dook (een kring) telt ook mee
      const d = this.kikkers[this.zi[q]], P = 10 + d.zaad * 6, ph = (t + d.zaad * 40) % P, wx = d.x + d.dx * d.sprong, wy = d.y + d.dy * d.sprong;
      const a = Math.atan2(d.dy, d.dx);
      let x = d.x, y = d.y, soort = 0, hoog = 0;
      if (ph < P - 4) { /* zit stil, af en toe een draai */ }
      else if (ph < P - 3.6) { const f = (ph - (P - 4)) / 0.4; x = d.x + (wx - d.x) * f; y = d.y + (wy - d.y) * f; hoog = Math.sin(f * Math.PI); }
      else {
        // in het water: eerst alleen een kring, dan zwemt hij als twee oogjes terug naar de kant
        const f = (ph - (P - 3.6)) / 3.6;
        if (f < 0.3) { kr[kring * 3] = wx; kr[kring * 3 + 1] = wy; kr[kring * 3 + 2] = f / 0.3; kring++; continue; }
        const g = smooth(0.3, 1, f);
        x = wx + (d.x - wx) * g; y = wy + (d.y - wy) * g; soort = g < 0.97 ? 1 : 0; // terug tot op zijn plek op de kant
      }
      buf[m * 4] = x; buf[m * 4 + 1] = y; buf[m * 4 + 2] = soort ? a + Math.PI : a + Math.sin(t * 0.3 + d.zaad * 9) * 0.3; buf[m * 4 + 3] = soort + hoog * 0.5;
      m++;
    }
    this.n.kikkers = m + kring; this.n.kringen = kring;
    if (kring) {
      c.beginPath();
      for (let q = 0; q < kring; q++) { const r = 0.05 + kr[q * 3 + 2] * 0.25; ellips(c, kr[q * 3], kr[q * 3 + 1], r, r * 0.7, 0); }
      c.strokeStyle = 'rgba(232,242,244,0.6)'; c.lineWidth = Math.max(0.015, 0.4 * this.pix); c.stroke();
    }
    if (!m) return;
    // schaduw (bij een sprong verder weg), lijf, lichte rugstreep en ogen
    c.beginPath(); for (let q = 0; q < m; q++) { const h = buf[q * 4 + 3] % 1; if (buf[q * 4 + 3] < 1) ellips(c, buf[q * 4] + 0.02 + h * 0.12, buf[q * 4 + 1] + 0.025 + h * 0.14, 0.07, 0.05, buf[q * 4 + 2]); } c.fillStyle = 'rgba(0,0,0,0.2)'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) { const s = 1 + (buf[q * 4 + 3] % 1) * 0.5; if (buf[q * 4 + 3] < 1) ellips(c, buf[q * 4], buf[q * 4 + 1], 0.075 * s, 0.055 * s, buf[q * 4 + 2]); } c.fillStyle = '#5a8a3a'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) if (buf[q * 4 + 3] < 1) ellips(c, buf[q * 4] - 0.01, buf[q * 4 + 1] - 0.012, 0.045, 0.014, buf[q * 4 + 2]); c.fillStyle = '#9cc46a'; c.fill();
    c.beginPath();
    for (let q = 0; q < m; q++) {
      const x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], ca = Math.cos(a), sa = Math.sin(a);
      for (let k = -1; k <= 1; k += 2) rond(c, x + ca * 0.05 - sa * k * 0.028, y + sa * 0.05 + ca * k * 0.028, 0.016);
    }
    c.fillStyle = '#d8c060'; c.fill();
    // wie zwemt, laat een v-tje in het water achter
    c.beginPath();
    for (let q = 0; q < m; q++) {
      if (buf[q * 4 + 3] < 1) continue;
      const x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], ca = Math.cos(a), sa = Math.sin(a);
      c.moveTo(x - ca * 0.15 - sa * 0.06, y - sa * 0.15 + ca * 0.06); c.lineTo(x - ca * 0.02, y - sa * 0.02); c.lineTo(x - ca * 0.15 + sa * 0.06, y - sa * 0.15 - ca * 0.06);
    }
    c.strokeStyle = 'rgba(232,242,244,0.5)'; c.lineWidth = Math.max(0.012, 0.35 * this.pix); c.stroke();
  }

  // Doel van een libel bij sprong k: een vast punt boven zijn sloot of plas.
  libelDoel(d, k, uit) {
    const u = (hash(Math.floor(d.zaad * 1e6), k, 991) * 2 - 1) * d.L, w = (hash(Math.floor(d.zaad * 1e6), k, 992) * 2 - 1) * d.w;
    uit[0] = d.x + d.ux * u - d.uy * w; uit[1] = d.y + d.uy * u + d.ux * w;
    return uit;
  }

  // Libellen: hangen stil boven het water, schieten dan in een flits naar een ander punt (zomer, overdag, droog).
  tekenLibellen(c) {
    const d0 = this.sz.dagInJaar;
    const k = this.venster(130, 260) * (1 - smooth(0.25, 0.45, this.nacht)) * (1 - smooth(0.1, 0.2, this.wr.regen)); if (k < 0.02) return; c.globalAlpha *= k; // zacht in en uit (seizoen, dagdeel, weer) in plaats van een harde grens
    const n = this.verzamel('libellen', 4.4), t = this.t, buf = this.buf, a3 = this.p3, b3 = this.libelP ?? (this.libelP = new Float32Array(2));
    let m = 0;
    for (let q = 0; q < n && m < PLAFOND.libellen; q++) {
      const d = this.libellen[this.zi[q]], s = t / 1.7 + d.zaad * 10, k = Math.floor(s), f = smooth(0, 0.18, s - k);
      this.libelDoel(d, k - 1, a3); this.libelDoel(d, k, b3);
      const x = a3[0] + (b3[0] - a3[0]) * f + Math.sin(t * 31 + q) * 0.012, y = a3[1] + (b3[1] - a3[1]) * f + Math.cos(t * 27 + q) * 0.012;
      buf[m * 4] = x; buf[m * 4 + 1] = y; buf[m * 4 + 2] = Math.atan2(b3[1] - a3[1], b3[0] - a3[0]) + Math.sin(t * 0.7 + q) * 0.2; buf[m * 4 + 3] = Math.floor(d.zaad * 3);
      m++;
    }
    this.n.libellen = m;
    if (!m) return;
    // schaduw op het water, vleugels, en het lijf in blauw, rood of groen
    c.beginPath();
    for (let q = 0; q < m; q++) { const a = buf[q * 4 + 2]; c.moveTo(buf[q * 4] + 0.25 - Math.cos(a) * 0.1, buf[q * 4 + 1] + 0.3 - Math.sin(a) * 0.1); c.lineTo(buf[q * 4] + 0.25 + Math.cos(a) * 0.1, buf[q * 4 + 1] + 0.3 + Math.sin(a) * 0.1); }
    c.strokeStyle = 'rgba(0,0,0,0.15)'; c.lineWidth = 0.03; c.stroke();
    c.beginPath();
    for (let q = 0; q < m; q++) {
      const x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], ca = Math.cos(a), sa = Math.sin(a), tril = 0.85 + 0.15 * Math.sin(t * 40 + q * 2);
      for (const v of [0.04, -0.005]) { const vx = x + ca * v, vy = y + sa * v; c.moveTo(vx - sa * 0.11 * tril, vy + ca * 0.11 * tril); c.lineTo(vx + sa * 0.11 * tril, vy - ca * 0.11 * tril); }
    }
    c.strokeStyle = 'rgba(226,238,246,0.7)'; c.lineWidth = 0.035; c.stroke();
    for (let kl = 0; kl < 3; kl++) {
      c.beginPath();
      let iets = false;
      for (let q = 0; q < m; q++) {
        if (buf[q * 4 + 3] !== kl) continue;
        const x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2];
        c.moveTo(x + Math.cos(a) * 0.07, y + Math.sin(a) * 0.07); c.lineTo(x - Math.cos(a) * 0.13, y - Math.sin(a) * 0.13); iets = true;
      }
      if (iets) { c.strokeStyle = ['#2a7ab8', '#c43a2a', '#3a9a5a'][kl]; c.lineWidth = 0.025; c.stroke(); }
    }
  }

  // Bijen en hommels boven de bloemenplekken: zwermen rond, blijven even op een bloem hangen (lente en zomer, overdag).
  tekenBijen(c) {
    const sz = this.sz, d0 = sz.dagInJaar;
    const k = this.venster(80, 270) * (1 - smooth(0.12, 0.28, sz.winter)) * (1 - smooth(0.2, 0.4, this.nacht)) * (1 - smooth(0.15, 0.25, this.wr.regen)); if (k < 0.02) return; c.globalAlpha *= k; // zacht in en uit (seizoen, dagdeel, weer) in plaats van een harde grens
    const n = this.verzamel('bijen', 2), t = this.t, buf = this.buf;
    let m = 0;
    for (let q = 0; q < n && m + 5 <= PLAFOND.bijen; q++) {
      const d = this.bijen[this.zi[q]];
      for (let k = 0; k < 5; k++) {
        // trage zwerftocht over de plek, met een snel zigzagje erdoor; op een bloem staat het zigzagje stil
        const z = d.zaad * 9 + k * 2.1, rust = smooth(0.55, 0.8, Math.sin(t * 0.45 + z)), tril = 1 - rust;
        const x = d.x + Math.sin(t * (0.21 + k * 0.03) + z) * d.r * 0.75 + Math.sin(t * 3.1 + z * 2) * 0.12 * tril;
        const y = d.y + Math.cos(t * (0.17 + k * 0.025) + z * 1.3) * d.r * 0.6 + Math.sin(t * 3.7 + z) * 0.09 * tril;
        buf[m * 4] = x; buf[m * 4 + 1] = y; buf[m * 4 + 2] = t * 0.9 + z; buf[m * 4 + 3] = (k === 0 ? 1 : 0) + rust * 0.5;
        m++;
      }
    }
    this.n.bijen = m;
    if (!m) return;
    c.beginPath(); for (let q = 0; q < m; q++) { const h = 0.12 * (1 - (buf[q * 4 + 3] % 1) * 1.6); rond(c, buf[q * 4] + h, buf[q * 4 + 1] + h * 1.15, buf[q * 4 + 3] >= 1 ? 0.035 : 0.022); } c.fillStyle = 'rgba(0,0,0,0.16)'; c.fill();
    // vleugels: twee doorschijnende vlekjes die snel flikkeren
    c.beginPath();
    for (let q = 0; q < m; q++) { const x = buf[q * 4], y = buf[q * 4 + 1], s = buf[q * 4 + 3] >= 1 ? 1.4 : 1, f = Math.sin(t * 60 + q * 1.7) > 0 ? 1 : 0.6; ellips(c, x - 0.02 * s, y - 0.03 * s * f, 0.03 * s, 0.018 * s, -0.6); ellips(c, x + 0.02 * s, y - 0.03 * s * f, 0.03 * s, 0.018 * s, 0.6); }
    c.fillStyle = 'rgba(238,246,252,0.65)'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) if (buf[q * 4 + 3] < 1) ellips(c, buf[q * 4], buf[q * 4 + 1], 0.035, 0.022, buf[q * 4 + 2]); c.fillStyle = '#d8a020'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) if (buf[q * 4 + 3] >= 1) ellips(c, buf[q * 4], buf[q * 4 + 1], 0.052, 0.036, buf[q * 4 + 2]); c.fillStyle = '#2a2218'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) if (buf[q * 4 + 3] >= 1) { const a = buf[q * 4 + 2]; ellips(c, buf[q * 4] + Math.cos(a) * 0.008, buf[q * 4 + 1] + Math.sin(a) * 0.008, 0.016, 0.034, a); } c.fillStyle = '#f0c030'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) if (buf[q * 4 + 3] < 1) { const a = buf[q * 4 + 2]; ellips(c, buf[q * 4] - Math.cos(a) * 0.01, buf[q * 4 + 1] - Math.sin(a) * 0.01, 0.008, 0.02, a); } c.fillStyle = '#2a2016'; c.fill();
  }

  // Dode bomen aan de bosrand: zilvergrijze stam met kale takken. Overdag klopt er een specht op, 's nachts zit er een
  // uil bovenop met ogen die oplichten.
  tekenDodeBomen(c) {
    const n = this.verzamel('dodeBomen', 2), t = this.t, z = this.z, L = this.dodeBomen, buf = this.buf;
    let m = 0;
    for (let q = 0; q < n && m < PLAFOND.dodeBomen; q++) { buf[m * 4] = this.zi[q]; m++; }
    this.n.dodeBomen = m;
    if (!m) return;
    const ga = c.globalAlpha;
    c.globalAlpha = ga * smooth(DREMPEL.dodeBoom, DREMPEL.dodeBoom + 1, z);
    c.beginPath(); for (let q = 0; q < m; q++) { const d = L[buf[q * 4]]; c.moveTo(d.x + 0.1, d.y + 0.1); c.lineTo(d.x + 1.3, d.y + 1.5); } c.strokeStyle = 'rgba(10,14,8,0.25)'; c.lineWidth = 0.2; c.stroke();
    c.beginPath();
    for (let q = 0; q < m; q++) {
      const d = L[buf[q * 4]];
      for (let k = 0; k < 3; k++) { const a = d.a + k * 2.2, l = 0.55 + 0.3 * frac(d.zaad * 7 + k * 0.3); c.moveTo(d.x, d.y); c.quadraticCurveTo(d.x + Math.cos(a + 0.3) * l * 0.6, d.y + Math.sin(a + 0.3) * l * 0.6, d.x + Math.cos(a) * l, d.y + Math.sin(a) * l); }
    }
    c.strokeStyle = '#776f64'; c.lineWidth = Math.max(0.05, 0.6 * this.pix); c.stroke();
    c.beginPath(); for (let q = 0; q < m; q++) { const d = L[buf[q * 4]]; rond(c, d.x, d.y, 0.2); } c.fillStyle = '#8a8378'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) { const d = L[buf[q * 4]]; rond(c, d.x - 0.06, d.y - 0.07, 0.1); } c.fillStyle = '#b8b2a6'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) { const d = L[buf[q * 4]]; rond(c, d.x + 0.02, d.y + 0.02, 0.06); } c.fillStyle = '#4a443c'; c.fill();
    c.globalAlpha = ga;
    // de specht hangt aan de westkant van de stam en klopt in roffels; houtsplinters vallen weg
    if (z >= DREMPEL.specht && this.nacht < 0.45) {
      let s = 0;
      c.globalAlpha = ga * smooth(DREMPEL.specht, DREMPEL.specht + 0.8, z) * (1 - smooth(0.25, 0.45, this.nacht)); // invloeien, net als de andere dieren
      c.beginPath();
      for (let q = 0; q < m && s < PLAFOND.spechten; q++, s++) { const d = L[buf[q * 4]], k = this.klop(d); ellips(c, d.x - 0.27 - k, d.y + 0.02, 0.1, 0.045, 0); }
      c.fillStyle = '#1e1e22'; c.fill();
      c.beginPath(); for (let q = 0; q < s; q++) { const d = L[buf[q * 4]], k = this.klop(d); ellips(c, d.x - 0.3 - k, d.y - 0.012, 0.04, 0.018, 0); ellips(c, d.x - 0.3 - k, d.y + 0.05, 0.04, 0.016, 0); } c.fillStyle = '#f0eee6'; c.fill();
      c.beginPath(); for (let q = 0; q < s; q++) { const d = L[buf[q * 4]], k = this.klop(d); rond(c, d.x - 0.36 - k, d.y + 0.02, 0.018); rond(c, d.x - 0.19 - k * 1.6, d.y + 0.015, 0.016); } c.fillStyle = '#c8302a'; c.fill();
      c.beginPath();
      for (let q = 0; q < s; q++) {
        const d = L[buf[q * 4]], roffel = frac(t / 5 + d.zaad) < 0.3;
        if (!roffel) continue;
        for (let k = 0; k < 3; k++) { const f = frac(t * 1.8 + k / 3), a = 2.4 + k * 0.5; rond(c, d.x - 0.2 + Math.cos(a) * f * 0.35, d.y + Math.sin(a) * f * 0.2 + f * f * 0.3, 0.012); }
      }
      c.fillStyle = '#c8b48c'; c.fill();
      this.n.spechten = s;
      c.globalAlpha = ga;
    }
    // de uil zit bovenop; zijn ogen lichten op en knipperen af en toe, de kop draait langzaam
    if (z >= DREMPEL.uil && this.nacht > 0.45) {
      let u = 0;
      const gu = ga * smooth(DREMPEL.uil, DREMPEL.uil + 0.8, z) * smooth(0.45, 0.65, this.nacht);
      c.globalAlpha = gu;
      c.beginPath(); for (let q = 0; q < m && u < PLAFOND.uilen; q++, u++) { const d = L[buf[q * 4]]; rond(c, d.x + 0.03, d.y - 0.02, 0.13); } c.fillStyle = '#8a6e52'; c.fill();
      c.beginPath(); for (let q = 0; q < u; q++) { const d = L[buf[q * 4]], dr = Math.sin(t * 0.4 + d.zaad * 9) * 0.025; ellips(c, d.x + 0.03 + dr, d.y + 0.01, 0.085, 0.07, 0); } c.fillStyle = '#d2bc98'; c.fill();
      c.beginPath(); for (let q = 0; q < u; q++) { const d = L[buf[q * 4]]; rond(c, d.x - 0.03, d.y - 0.08, 0.05); } c.fillStyle = '#a88a68'; c.fill();
      const ogen = this.ogenBuf ?? (this.ogenBuf = new Float32Array(PLAFOND.uilen * 2));
      let o = 0;
      c.beginPath();
      for (let q = 0; q < u; q++) {
        const d = L[buf[q * 4]];
        if (frac(t / 6 + d.zaad * 3) < 0.03) continue; // knipper
        const dr = Math.sin(t * 0.4 + d.zaad * 9) * 0.025;
        for (let k = -1; k <= 1; k += 2) rond(c, d.x + 0.03 + dr + k * 0.035, d.y + 0.005, 0.022);
        ogen[o * 2] = d.x + 0.03 + dr; ogen[o * 2 + 1] = d.y + 0.005; o++;
      }
      c.fillStyle = '#ffd84a'; c.fill();
      if (o) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = gu * 0.7 * smooth(0.55, 0.8, this.nacht);
        for (let q = 0; q < o; q++) c.drawImage(this.gloei, ogen[q * 2] - 0.14, ogen[q * 2 + 1] - 0.1, 0.28, 0.2);
        c.restore();
      }
      this.n.uilen = u;
      c.globalAlpha = ga;
    }
  }

  // Valt de snavel van deze reiger in het water uit (zee, rivier, meer of een moerasplas)? Eén keer per reiger uitgerekend:
  // een reiger die met zijn kop naar het land staat, prikt in het gras en vangt geen vis.
  vist(d) {
    if (d.vist === undefined) { // eenmalig bij het plaatsen (plaatsDichtbij), daarna alleen opzoeken
      const L = DIER_LENGTE[REIGER] * 1.1, x = d.x + Math.cos(d.a) * L, y = d.y + Math.sin(d.a) * L, tl = this.terrein;
      let nat = this.zee(x, y) || tl.rivierAfstand(x, y) < 0 || tl.isMeer(x, y);
      const t = this.geo.tegels[this.tegelVan(x, y)];
      if (!nat && t && this.terrein.vlaggen.moeras[t.i]) {
        const f = kenmerkenVoorTegel(t, this.basis);
        for (let p = 0; p < f.length && !nat; p += KENMERK.STAP) {
          if (f[p] !== KENMERK.PLAS) continue;
          const h = f[p + 5], dx = x - t.x - f[p + 1], dy = y - t.y - f[p + 2], u = (dx * Math.cos(h) + dy * Math.sin(h)) / f[p + 3], v = (dy * Math.cos(h) - dx * Math.sin(h)) / (f[p + 3] * 0.62);
          nat = u * u + v * v < 1;
        }
      }
      d.vist = nat ? 1 : 0;
    }
    return d.vist;
  }

  // Hoe ver de kop van de specht naar de stam schiet: roffels van 1,5 tel om de 5 tel.
  klop(d) { return frac(this.t / 5 + d.zaad) < 0.3 ? Math.max(0, Math.sin(this.t * TAU * 9)) * 0.03 : 0; }

  // Eekhoorns op omgevallen stammen: rennen naar het eind, gaan rechtop zitten, rennen terug (overdag).
  tekenEekhoorns(c) {
    const k = 1 - smooth(0.25, 0.45, this.nacht); if (k < 0.02) return; c.globalAlpha *= k; // zacht in en uit (seizoen, dagdeel, weer) in plaats van een harde grens
    const n = this.verzamel('eekhoorns', 2), t = this.t, buf = this.buf;
    let m = 0;
    for (let q = 0; q < n && m < PLAFOND.eekhoorns; q++) {
      const d = this.eekhoorns[this.zi[q]], s = frac(t / 7 + d.zaad), Lh = d.l * 0.38;
      let u, kop, zit = 0;
      if (s < 0.35) { u = -Lh + 2 * Lh * smooth(0, 0.35, s); kop = 1; }
      else if (s < 0.5) { u = Lh; kop = 1; zit = 1; }
      else if (s < 0.85) { u = Lh - 2 * Lh * smooth(0.5, 0.85, s); kop = -1; }
      else { u = -Lh; kop = -1; zit = 1; }
      buf[m * 4] = d.x + d.co * u; buf[m * 4 + 1] = d.y + d.si * u - 0.04; buf[m * 4 + 2] = Math.atan2(d.si * kop, d.co * kop); buf[m * 4 + 3] = zit;
      m++;
    }
    this.n.eekhoorns = m;
    if (!m) return;
    c.beginPath(); for (let q = 0; q < m; q++) ellips(c, buf[q * 4] + 0.05, buf[q * 4 + 1] + 0.07, 0.11, 0.05, buf[q * 4 + 2]); c.fillStyle = 'rgba(0,0,0,0.22)'; c.fill();
    // staart: plat achter het lijf als hij rent, opgekruld over de rug als hij zit
    c.beginPath();
    for (let q = 0; q < m; q++) {
      const x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], ca = Math.cos(a), sa = Math.sin(a), zit = buf[q * 4 + 3];
      if (zit) ellips(c, x - ca * 0.03, y - sa * 0.03 - 0.02, 0.06, 0.045, a); else ellips(c, x - ca * 0.12, y - sa * 0.12, 0.075, 0.035, a + Math.sin(t * 9 + q) * 0.2);
    }
    c.fillStyle = '#b8622c'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) { const s = buf[q * 4 + 3] ? 0.75 : 1; ellips(c, buf[q * 4], buf[q * 4 + 1], 0.065 * s, 0.035, buf[q * 4 + 2]); } c.fillStyle = '#a4522a'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) { const a = buf[q * 4 + 2]; rond(c, buf[q * 4] + Math.cos(a) * 0.06, buf[q * 4 + 1] + Math.sin(a) * 0.06, 0.026); } c.fillStyle = '#8e4624'; c.fill();
    if (this.z >= 12) { c.beginPath(); for (let q = 0; q < m; q++) { const a = buf[q * 4 + 2]; ellips(c, buf[q * 4] + Math.cos(a) * 0.01, buf[q * 4 + 1] + Math.sin(a) * 0.01, 0.03, 0.014, a); } c.fillStyle = '#e8d8c0'; c.fill(); }
  }

  // Egels: 's avonds en 's nachts (lente tot herfst) een langzaam rondje door het gras, met stekels en een snuitje.
  tekenEgels(c) {
    const d0 = this.sz.dagInJaar;
    const k = this.venster(90, 300) * smooth(0.2, 0.4, this.nacht); if (k < 0.02) return; c.globalAlpha *= k; // zacht in en uit (seizoen, dagdeel, weer) in plaats van een harde grens
    const n = this.verzamel('egels', 2), t = this.t, buf = this.buf;
    let m = 0;
    for (let q = 0; q < n && m < PLAFOND.egels; q++) {
      const p = this.pos(this.egels[this.zi[q]], t);
      buf[m * 4] = p[0]; buf[m * 4 + 1] = p[1]; buf[m * 4 + 2] = p[2]; m++;
    }
    this.n.egels = m;
    if (!m) return;
    c.beginPath(); for (let q = 0; q < m; q++) ellips(c, buf[q * 4] + 0.04, buf[q * 4 + 1] + 0.05, 0.13, 0.09, buf[q * 4 + 2]); c.fillStyle = 'rgba(0,0,0,0.22)'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) { const a = buf[q * 4 + 2]; ellips(c, buf[q * 4] + Math.cos(a) * 0.1, buf[q * 4 + 1] + Math.sin(a) * 0.1, 0.045, 0.032, a); } c.fillStyle = '#c4a47e'; c.fill();
    c.beginPath(); for (let q = 0; q < m; q++) ellips(c, buf[q * 4], buf[q * 4 + 1], 0.12, 0.085, buf[q * 4 + 2]); c.fillStyle = '#5a4634'; c.fill();
    if (this.z >= 12) {
      c.beginPath();
      for (let q = 0; q < m; q++) {
        const x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2];
        for (let k = 0; k < 9; k++) { const b2 = a + Math.PI + (k - 4) * 0.33, ca = Math.cos(b2), sa = Math.sin(b2); c.moveTo(x + ca * 0.03, y + sa * 0.025); c.lineTo(x + ca * 0.13, y + sa * 0.095); }
      }
      c.strokeStyle = '#a08a6a'; c.lineWidth = 0.012; c.stroke();
    }
    c.beginPath(); for (let q = 0; q < m; q++) { const a = buf[q * 4 + 2]; rond(c, buf[q * 4] + Math.cos(a) * 0.145, buf[q * 4 + 1] + Math.sin(a) * 0.145, 0.012); } c.fillStyle = '#1a1410'; c.fill();
  }

  // Vleermuizen in de schemering: kleine fladderende silhouetten in snelle, grillige lussen.
  tekenVleermuizen(c) {
    const d0 = this.sz.dagInJaar, schemer = smooth(0.2, 0.35, this.nacht) * (1 - smooth(0.8, 0.95, this.nacht)) * this.venster(100, 290) * (1 - smooth(0.25, 0.35, this.wr.regen));
    if (schemer < 0.02) return;
    const n = this.verzamel('vleer', 3), t = this.t, buf = this.buf;
    let m = 0;
    for (let q = 0; q < n && m < PLAFOND.vleermuizen; q++) {
      const d = this.vleer[this.zi[q]];
      for (let k = 0; k < d.n && m < PLAFOND.vleermuizen; k++) {
        const z = d.zaad * 9 + k * 2.1, w1 = 1.3 * (1 + k * 0.2), w2 = 1.8 * (1 + k * 0.15);
        buf[m * 4] = d.x + Math.sin(t * w1 + z) * d.R + Math.sin(t * 5.3 + k) * 0.3;
        buf[m * 4 + 1] = d.y + Math.sin(t * w2 + z * 1.3) * d.R * 0.7 + Math.cos(t * 4.1 + k) * 0.25;
        buf[m * 4 + 2] = Math.atan2(Math.cos(t * w2 + z * 1.3) * d.R * 0.7 * w2 - Math.sin(t * 4.1 + k) * 1.0, Math.cos(t * w1 + z) * d.R * w1 + Math.cos(t * 5.3 + k) * 1.6);
        buf[m * 4 + 3] = Math.sin(t * 19 + k * 2 + z);
        m++;
      }
    }
    this.n.vleermuizen = m;
    if (!m) return;
    const ga = c.globalAlpha;
    c.globalAlpha = ga * schemer;
    c.beginPath();
    for (let q = 0; q < m; q++) {
      const x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], ca = Math.cos(a), sa = Math.sin(a), s = 0.11, op = buf[q * 4 + 3] * 0.06;
      // vleugels dwars op de vliegrichting, de punten naar achteren en op en neer
      c.moveTo(x - sa * s - ca * (0.04 + op), y + ca * s - sa * (0.04 + op));
      c.quadraticCurveTo(x - sa * s * 0.4 + ca * 0.02, y + ca * s * 0.4 + sa * 0.02, x, y);
      c.quadraticCurveTo(x + sa * s * 0.4 + ca * 0.02, y - ca * s * 0.4 + sa * 0.02, x + sa * s - ca * (0.04 + op), y - ca * s - sa * (0.04 + op));
    }
    c.strokeStyle = '#2a2430'; c.lineWidth = Math.max(0.035, 0.9 * this.pix); c.stroke();
    c.globalAlpha = ga;
  }

  // Spinnenwebben in de heggen op herfstochtenden, met dauwdruppels die schitteren.
  tekenWebben(c) {
    const d0 = this.sz.dagInJaar, ochtend = this.ochtend;
    const k = this.venster(235, 320) * (1 - smooth(0.25, 0.35, this.wr.regen));
    if (ochtend * k < 0.02) return;
    c.globalAlpha *= k;
    const n = this.verzamel('webben', 1), t = this.t, L = this.webben, buf = this.buf;
    let m = 0;
    for (let q = 0; q < n && m < PLAFOND.webben; q++) { buf[m * 4] = this.zi[q]; m++; }
    this.n.webben = m;
    if (!m) return;
    const ga = c.globalAlpha;
    c.globalAlpha = ga * ochtend;
    c.beginPath();
    for (let q = 0; q < m; q++) {
      const d = L[buf[q * 4]];
      for (let k = 0; k < 8; k++) { const a = d.a + k * 0.785; c.moveTo(d.x, d.y); c.lineTo(d.x + Math.cos(a) * d.r, d.y + Math.sin(a) * d.r * 0.85); }
      for (let ring = 1; ring <= 3; ring++) {
        const rr = d.r * ring / 3.4;
        for (let k = 0; k <= 8; k++) { const a = d.a + k * 0.785, x = d.x + Math.cos(a) * rr, y = d.y + Math.sin(a) * rr * 0.85; if (k) c.lineTo(x, y); else c.moveTo(x, y); }
      }
    }
    c.strokeStyle = 'rgba(236,240,246,0.6)'; c.lineWidth = Math.max(0.008, 0.45 * this.pix); c.stroke();
    c.beginPath();
    for (let q = 0; q < m; q++) {
      const d = L[buf[q * 4]];
      for (let k = 0; k < 10; k++) {
        if (Math.sin(t * 2.5 + k * 1.7 + d.zaad * 9) < 0.2) continue;
        const a = d.a + k * 0.785 + 0.39 * (k % 2), rr = d.r * (0.3 + 0.65 * frac(k * 0.618 + d.zaad));
        rond(c, d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr * 0.85, 0.016);
      }
    }
    c.fillStyle = 'rgba(255,255,255,0.95)'; c.fill();
    c.globalAlpha = ga;
  }

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
        // (geen regenboog in de nevel meer, C12: van bovenaf lag hij als geverfde bogen op de grond)
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
        this.zaadBuf[n] = d.zaad; this.vistBuf[n] = soort === REIGER ? this.vist(d) : 0;
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
        // hals in een s-bocht, kop met gele snavel; om de 12 tel schiet de hals naar voren en soms komt er een vis mee
        const uit = this.zaadBuf, zb = this.uitvalBuf ?? (this.uitvalBuf = new Float32Array(96));
        for (let q = 0; q < n; q++) {
          const ph = frac(t / 12 + uit[q] * 7);
          zb[q] = z >= 10 ? smooth(0, 0.04, ph) * (1 - smooth(0.1, 0.2, ph)) * 0.32 : 0;
          uit[q] = ph + (hash(Math.floor(t / 12 + uit[q] * 7), Math.floor(uit[q] * 1e5), 981) < 0.55 ? 0 : 2); // >= 2: mis
        }
        c.beginPath();
        for (let q = 0; q < n; q++) {
          const L = buf[q * 4 + 3], x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], co = Math.cos(a), si = Math.sin(a), e = zb[q];
          c.moveTo(x + co * L * 0.25, y + si * L * 0.25);
          c.quadraticCurveTo(x + co * L * (0.4 + e * 0.6) - si * L * 0.12 * (1 - e * 2.5), y + si * L * (0.4 + e * 0.6) + co * L * 0.12 * (1 - e * 2.5), x + co * L * (0.55 + e), y + si * L * (0.55 + e));
        }
        c.strokeStyle = '#c4cacd'; c.lineWidth = 0.035; c.stroke();
        c.beginPath();
        for (let q = 0; q < n; q++) { const L = buf[q * 4 + 3], a = buf[q * 4 + 2], e = zb[q]; ellips(c, buf[q * 4] + Math.cos(a) * L * (0.57 + e), buf[q * 4 + 1] + Math.sin(a) * L * (0.57 + e), L * 0.06, L * 0.05, a); }
        c.fillStyle = '#e6eaec'; c.fill();
        c.beginPath();
        for (let q = 0; q < n; q++) { const L = buf[q * 4 + 3], x = buf[q * 4], y = buf[q * 4 + 1], a = buf[q * 4 + 2], e = zb[q]; c.moveTo(x + Math.cos(a) * L * (0.6 + e), y + Math.sin(a) * L * (0.6 + e)); c.lineTo(x + Math.cos(a) * L * (0.82 + e), y + Math.sin(a) * L * (0.82 + e)); }
        c.strokeStyle = '#d8b040'; c.lineWidth = 0.02; c.stroke();
        if (z >= 10) {
          // kringen waar de snavel het water raakte, en een spartelend visje dwars in de snavel tot hij is doorgeslikt
          c.beginPath();
          let k = 0;
          for (let q = 0; q < n; q++) {
            const ph = uit[q] % 2;
            if (!this.vistBuf[q] || ph < 0.04 || ph > 0.3) continue; // op het droge: geen kringen
            const L = buf[q * 4 + 3], a = buf[q * 4 + 2], r = 0.04 + (ph - 0.04) * 1.4, x = buf[q * 4] + Math.cos(a) * L * 1.1, y = buf[q * 4 + 1] + Math.sin(a) * L * 1.1;
            ellips(c, x, y, r, r * 0.7, 0); k++;
          }
          if (k) { c.strokeStyle = 'rgba(232,242,246,0.55)'; c.lineWidth = Math.max(0.012, 0.4 * this.pix); c.stroke(); }
          c.beginPath();
          k = 0;
          for (let q = 0; q < n; q++) {
            const ph = uit[q];
            if (!this.vistBuf[q] || ph < 0.06 || ph > 0.32) continue; // alleen bij een vangst (een misser heeft ph >= 2), in het water
            const L = buf[q * 4 + 3], a = buf[q * 4 + 2], e = zb[q], spartel = Math.sin(t * 24 + q) * 0.35;
            ellips(c, buf[q * 4] + Math.cos(a) * L * (0.8 + e), buf[q * 4 + 1] + Math.sin(a) * L * (0.8 + e), 0.05, 0.016, a + Math.PI / 2 + spartel);
            k++;
          }
          if (k) { c.fillStyle = '#b8c4c8'; c.fill(); this.n.vissen = k; }
        }
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
            // boven stapt hij van de lift en beneden gaat hij weer de lift in: daar (en alleen daar) is hij even weg
            if (f < 0.03 || f > 0.97) continue;
            langs(p.pts, d, this.p3);
            const a = this.p3[2], zig = Math.sin(f * 40 + k) * 0.32, dz = Math.cos(f * 40 + k);
            buf[m * 4] = this.p3[0] - Math.sin(a) * zig; buf[m * 4 + 1] = this.p3[1] + Math.cos(a) * zig; buf[m * 4 + 2] = a + dz * 0.7; buf[m * 4 + 3] = k % JAS.length; m++;
          }
        }
        skiers += m;
        const gs = c.globalAlpha;
        c.globalAlpha = gs * (1 - smooth(0.42, 0.6, this.nacht)); // bij het donker gaan ze naar huis (vervagen)
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
        c.globalAlpha = gs;
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
