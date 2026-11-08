// Leven in en op het water (pakket C van de detailronde). Op open zee: dolfijnen die in groepjes boven water springen,
// een walvis die af en toe bovenkomt en een fontein blaast (zeldzaam, ver uit de kust), scholen vissen als donkere
// wolkjes onder het oppervlak van ondiep water, kwallen in de zomer en zeevogels die op de scholen duiken.
// Onder water, door het water heen te zien: zandbanken met ribbels, zeegras, wier langs rotskusten, rotsen net onder
// het oppervlak met wit water erboven (en koraal, alleen als het pack een warme zee aanwijst). Op het strand krabben.
// Sport en recreatie: surfers en kitesurfers bij wind, zeilwedstrijdjes rond drie boeien voor de stad, roeiers en
// kanoërs op rivieren en meren, hengelaars op de oever en op steigertjes, waterfietsen en een zwemsteiger op meren
// bij de stad. In de winter op bevroren meren: schaatsers op hun baan, ijsvissers met tentje en wak, kinderen die
// glijden en een tentje met warme drank. Water reageert: kielzog achter alles wat vaart, spatten en kringen, een vis
// die opspringt, en regendruppels op zoet water (de zee doet sfeer.js al).
// Detail komt trapsgewijs op (DREMPEL): 4-6 zand, walvis, dolfijnen, scholen en wedstrijdzeilen; 8-10 boten,
// schaatsers, kites, kwallen, steigers; 12-14 hengels met dobber, kinderen op het ijs, krabben.
// Puur decor: leest de toestand en schrijft er nooit in. Plaatsing uit de kaart en vaste hashes; welke plekken vrij
// zijn volgt het botsraster van kust.js (wegen, bruggen, havens, gebouwen, de boten en zwemmers van leven.js en de
// kustdingen zelf) plus de rotsen, rollers en het rivierleven van natuur.js. De klok (nu) stuurt alleen beweging.
// Licht uit het noordwesten: schaduwen vallen naar het zuidoosten, wat hoog is staat schuin omhoog.

import { seizoen, weer, wind } from './seizoen.js';
import { maakBasis, TerreinLaag, seizoensStap, seizoenVanStap } from './terrein.js';
import { KustLaag } from './kust.js';

// ---------- gedeelde hulpjes (eigen kopie) ----------

function hash(a, b = 0, c = 0) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = (v) => v - Math.floor(v);
const tri = (v) => 1 - Math.abs(1 - 2 * frac(v));
const triRichting = (v) => (frac(v) < 0.5 ? 1 : -1);
const TAU = Math.PI * 2;
const SCHUIN = 0.566; // schaduwlengte per hoogte-eenheid (zelfde als kust.js en infra.js)

// Canvasfabriek: pas bij het bakken een canvas, nooit bij het importeren (zie zetCanvasFabriek).
const standaardFabriek = (w, h) => (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null);
let fabriek = standaardFabriek;
export function zetCanvasFabriek(fn) { fabriek = fn ?? standaardFabriek; }

// ---------- plafonds en drempels ----------

export const PLAFOND = {
  brokken: 28, klippen: 40, scholen: 24, vissen: 260, kwallen: 60, walvissen: 2, dolfijnen: 40, zeevogels: 14,
  boten: 48, kites: 8, boeien: 12, schaatsers: 60, ijsvissers: 10, kinderen: 18, tentjes: 4, steigers: 10,
  hengelaars: 20, zwemsteigers: 3, zwemmers: 14, krabben: 40, sprongen: 8, kringen: 70, bakken: 1,
};
export const DREMPEL = {
  zand: 4, walvis: 4.5, dolfijn: 5, school: 5.5, regatta: 5.5, witwater: 6.5, kite: 7.5, schaats: 7.5, ijsvis: 8,
  roei: 8, zeevogel: 8, steiger: 8.5, surf: 8.5, waterfiets: 9, zwemsteiger: 9, vis: 9.5, kwal: 9.5, hengel: 9.5,
  kring: 9, mens: 10, kind: 10.5, fijn: 12, krab: 13,
};
const MAX_BROKKEN = 30, MAX_BYTES = 40 * 1024 * 1024;

const W = 1000, H = 620; // wereld in eenheden
const RC = 2, RW = W / RC, RH = H / RC; // botsraster van kust.js: vakjes van 2 eenheden
const INFRA = 1, LEVEN = 2, KUST = 4, GEBOUW = 8, RAND = 16, ROTS = 32, NATUUR = 64, ZEE = 128;
const CH = 64; // brok onderwaterdetail: 64 x 64 eenheden

// boten: X, Y, hx, hy, soort, kleur, extra, vaart (0..1)
const BOOT = 8;
const ZEILER = 0, SKIFF = 1, KANO = 2, WATERFIETS = 3, SURFER = 4, KITER = 5;
const BOOT_MAAT = [[0.028, 0.011], [0.04, 0.0045], [0.022, 0.0052], [0.016, 0.011], [0.011, 0.0032], [0.0095, 0.003]];
const ROMP = ['#f4f2ec', '#f4f2ec', '#e9dfc7', '#24364e'];
const ZEIL = ['#fbf6e6', '#fbf6e6', '#d9443c', '#2f6fb0', '#f0b429'];
const KANO_K = ['#d9443c', '#f0b429', '#2f9e5b', '#2f6fb0'];
const FIETSBOOT = ['#f2f2ee', '#f0d34a', '#e86a3a', '#5aa0d8'];
const BORD = ['#f4f1e6', '#e8a33a', '#3a8fd0', '#d9443c'];
const KITE = ['#e8433a', '#f0b429', '#2fb0c9', '#8a4bb8', '#3fbf5a'];
const KLEDING = ['#c0392b', '#2e5d8a', '#e0a32a', '#2f7d4f', '#7a4b9a', '#3a3a3a', '#d8d4c8'];
const HUID = ['#e8c3a0', '#c99a72', '#8a5a3a'];
const TENT = ['#c0392b', '#2e6da4', '#e0a32a', '#2f7d4f'];
const KORAAL = ['rgba(232,120,128,0.5)', 'rgba(240,160,90,0.5)', 'rgba(176,130,210,0.45)', 'rgba(90,190,180,0.45)', 'rgba(240,210,120,0.45)'];
// dolfijnen: X, Y, hx, hy, hoogte (px), fase (0 onder, 1 lucht, 2 plons)
const DOLF = 6;
// zeevogels: X, Y, hx, hy, hoogte (px), staat (0 cirkelt, 1 duikt, 2 plons, 3 zit)
const VOGEL = 6;
// vaste rijtjes voor de tekenlussen (geen nieuwe arrays per beeld)
const KANTEN = [-1, 1], SPOREN = [-0.3, 0.3], PALEN = [-0.6, 0, 0.95], ROEIERS = [1, 2, 4], RIEMEN = [1, 2, 2];

function stip(c, x, y, r) {
  if (r < 1.2) { c.rect(x - r, y - r, r * 2, r * 2); return; }
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, TAU);
}
function ovaal(c, x, y, hx, hy, l, w) {
  const a = Math.atan2(hy, hx);
  c.moveTo(x + hx * l, y + hy * l);
  c.ellipse(x, y, Math.max(0.1, l), Math.max(0.1, w), a, 0, TAU);
}
function rechthoek(c, x, y, hx, hy, l, w) {
  const px = -hy * w, py = hx * w, lx = hx * l, ly = hy * l;
  c.moveTo(x + lx + px, y + ly + py);
  c.lineTo(x + lx - px, y + ly - py);
  c.lineTo(x - lx - px, y - ly - py);
  c.lineTo(x - lx + px, y - ly + py);
  c.closePath();
}
function ring(c, x, y, rx, ry) { c.moveTo(x + rx, y); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); }

function sdOp(sd, x, y) {
  const px = x < 0 ? 0 : x > W - 1 ? W - 1 : x | 0, py = y < 0 ? 0 : y > H - 1 ? H - 1 : y | 0;
  return sd[py * W + px];
}
// Richting van de kust af (zeewaarts): de helling van het afstandsveld.
function normaal(sd, x, y, uit) {
  const gx = sdOp(sd, x + 1.5, y) - sdOp(sd, x - 1.5, y), gy = sdOp(sd, x, y + 1.5) - sdOp(sd, x, y - 1.5);
  const l = Math.hypot(gx, gy);
  if (l < 1e-6) { uit[0] = 1; uit[1] = 0; return 0; }
  uit[0] = gx / l; uit[1] = gy / l;
  return l;
}

// Brokresolutie (pixels per eenheid) in machten van twee: onderwaterdetail is zacht, dus ruim onder schermscherpte.
const brokRes = (pxPerEenheid) => clamp(Math.pow(2, Math.round(Math.log2(Math.max(1, pxPerEenheid * 0.4)))), 2, 16);

// ---------- analyse van de kaart (eenmalig per wereld, onafhankelijk van de toestand) ----------

const wereldCache = new WeakMap();

function kiesVerspreid(kand, min, max) {
  kand.sort((p, q) => q.score - p.score || p.y - q.y || p.x - q.x);
  const uit = [], m2 = min * min;
  for (const k of kand) {
    if (uit.length >= max) break;
    let ok = true;
    for (let i = 0; i < uit.length && ok; i++) { const dx = uit[i].x - k.x, dy = uit[i].y - k.y; if (dx * dx + dy * dy < m2) ok = false; }
    if (ok) uit.push(k);
  }
  return uit;
}

function analyse(geo, b, tl) {
  const sd = b.sd, eig = b.eigenaar, Tw = geo.T, kol = geo.kol, rij = geo.rij, n2 = [0, 0];
  const vl = tl.vlaggen;
  const tegel = (x, y) => clamp(Math.floor(y / Tw), 0, rij - 1) * kol + clamp(Math.floor(x / Tw), 0, kol - 1);
  const zee = (x, y) => { const px = Math.floor(x), py = Math.floor(y); if (px < 0 || py < 0 || px >= W || py >= H) return true; return eig ? eig[py * W + px] === -1 : sdOp(sd, x, y) > 0; };
  const nat = (x, y, min) => zee(x, y) && sdOp(sd, x, y) >= min;
  const ringNat = (x, y, rx, ry, min, n = 12) => { for (let i = 0; i < n; i++) { const a = (i * TAU) / n; if (!nat(x + Math.cos(a) * rx, y + Math.sin(a) * ry, min)) return false; } return true; };
  const binnen = (x, y, m) => x > m && y > m && x < W - m && y < H - m;
  const stadBij = (x, y, d) => { for (let dr = -d; dr <= d; dr++) for (let dk = -d; dk <= d; dk++) { const k = Math.floor(x / Tw) + dk, r = Math.floor(y / Tw) + dr; if (k >= 0 && r >= 0 && k < kol && r < rij && vl.stad[r * kol + k]) return true; } return false; };

  // walvissen: diep water ver uit de kust, met ruimte om te zwemmen
  const wk = [];
  for (let y = 24; y < H - 24; y += 10) for (let x = 24; x < W - 24; x += 10) {
    const s = sdOp(sd, x, y);
    if (s < 16 || !ringNat(x, y, 9, 9, 11)) continue;
    wk.push({ x, y, score: s + 4 * hash(x, y, 1), zaad: (x * 31 + y * 7) | 0 });
  }
  const walvissen = kiesVerspreid(wk, 140, 5);
  // dolfijnen: een vaarronde in open water
  const dk = [];
  for (let y = 16; y < H - 16; y += 9) for (let x = 16; x < W - 16; x += 9) {
    const s = sdOp(sd, x, y);
    if (s < 5 || s > 28 || hash(x, y, 11) > 0.22) continue;
    const R = 3 + hash(x, y, 12) * 3;
    if (!ringNat(x, y, R + 1.2, R * 0.7 + 1.2, 2.5, 16) || !ringNat(x, y, Math.max(0.5, R - 1.2), Math.max(0.5, R * 0.7 - 1.2), 2.5, 12)) continue;
    dk.push({ x, y, R, score: hash(x, y, 13), zaad: (x * 13 + y * 101) | 0, n: 3 + Math.floor(hash(x, y, 14) * 4), dir: hash(x, y, 15) < 0.5 ? 1 : -1 });
  }
  const dolfijnen = kiesVerspreid(dk, 30, 80);
  // visscholen: ondiep, helder water; de zwerftocht blijft ondiep
  const sk = [];
  for (let y = 8; y < H - 8; y += 4) for (let x = 8; x < W - 8; x += 4) {
    const s = sdOp(sd, x, y);
    if (s < 0.9 || s > 3.8 || !zee(x, y) || hash(x, y, 21) > 0.2) continue;
    const R = 1 + hash(x, y, 22) * 1.6, f = hash(x, y, 23);
    let ok = true;
    // de twee golven hebben geen gemeenschappelijke periode: de zwerftocht vult het hele rechthoekje
    for (let q = 0; q < 25 && ok; q++) { const px = x + R * ((q % 5) / 2 - 1), py = y + R * 0.7 * (Math.floor(q / 5) / 2 - 1); const t = sdOp(sd, px, py); if (t < 0.6 || t > 5.5 || !zee(px, py)) ok = false; }
    if (ok) sk.push({ x, y, R, f, score: hash(x, y, 24), zaad: (x * 7 + y * 389) | 0 });
  }
  const scholen = kiesVerspreid(sk, 9, 240);
  // kwallen: een paar bij elkaar in middeldiep water
  const kk = [];
  for (let y = 10; y < H - 10; y += 6) for (let x = 10; x < W - 10; x += 6) {
    const s = sdOp(sd, x, y);
    if (s < 1.6 || s > 9 || hash(x, y, 31) > 0.13 || !ringNat(x, y, 2.2, 2.2, 0.8, 8)) continue;
    kk.push({ x, y, score: hash(x, y, 32), zaad: (x * 17 + y * 53) | 0 });
  }
  const kwallen = kiesVerspreid(kk, 10, 220);
  // rotsen net onder het oppervlak: voor kliffen en bergkusten (en heel af en toe los in ondiep water)
  const rk = [];
  for (let y = 4; y < H - 4; y += 3) for (let x = 4; x < W - 4; x += 3) {
    const px = x + (hash(x, y, 41) - 0.5) * 2, py = y + (hash(x, y, 42) - 0.5) * 2, s = sdOp(sd, px, py);
    if (s < 1.3 || s > 3.4 || !zee(px, py)) continue;
    normaal(sd, px, py, n2);
    const t = tegel(px - n2[0] * (s + 2), py - n2[1] * (s + 2)), tg = geo.tegels[t];
    const ruw = tg && tg.terrein !== 'water' && (vl.klif[t] || tg.terrein === 'berg');
    if (!(ruw ? hash(x, y, 43) < 0.4 : hash(x, y, 44) < 0.012)) continue;
    rk.push({ x: px, y: py, r: 0.35 + hash(x, y, 45) * 0.55, score: hash(x, y, 46), zaad: (x * 977 + y * 131) | 0 });
  }
  const klippen = kiesVerspreid(rk, 2.6, 500);
  // stranden: waterlijn voor zand met open zee ervoor (krabben op het zand, surfers in de branding)
  const st = [];
  for (let y = 6; y < H - 6; y += 3) for (let x = 6; x < W - 6; x += 3) {
    const px = x + (hash(x, y, 51) - 0.5) * 2, py = y + (hash(x, y, 52) - 0.5) * 2, s = sdOp(sd, px, py);
    if (s < -0.5 || s > 0.5 || normaal(sd, px, py, n2) < 0.1) continue;
    const nx = n2[0], ny = n2[1], wx = px - nx * s, wy = py - ny * s;
    const t = tegel(wx - nx * 2.5, wy - ny * 2.5), tg = geo.tegels[t];
    if (!tg || tg.terrein === 'water' || vl.klif[t] || !(vl.duin[t] || (tg.terrein === 'kust' && tg.hoogte < 0.5))) continue;
    if (sdOp(sd, wx + nx * 8, wy + ny * 8) < 4.5 || tl.rivierAfstand(wx - nx * 1.2, wy - ny * 1.2) < 1 || !binnen(wx, wy, 10)) continue;
    st.push({ x: wx, y: wy, nx, ny, score: hash(x, y, 53), zaad: (x * 211 + y * 17) | 0 });
  }
  const stranden = kiesVerspreid(st, 3.2, 1600);
  // zeilwedstrijdjes: een baan van drie boeien voor de stad
  const zk = [];
  for (let y = 20; y < H - 20; y += 6) for (let x = 20; x < W - 20; x += 6) {
    const s = sdOp(sd, x, y);
    if (s < 4 || s > 18 || !stadBij(x, y, 4) || !ringNat(x, y, 5.5, 5.5, 1.8, 12)) continue;
    zk.push({ x, y, score: hash(x, y, 61), zaad: (x * 41 + y * 3) | 0 });
  }
  const regattas = kiesVerspreid(zk, 18, 120);

  // rivieren: rustige smalle stukken voor roeiers en kano's, oevers voor hengelaars
  const banen = [], oevers = [];
  const R = tl.rivieren;
  for (let ri = 0; ri < R.length; ri++) {
    const rv = R[ri], m = rv.br.length, p = rv.pts;
    if (rv.delta || !rv.open || m < 6) continue;
    let a = -1;
    for (let i = 0; i <= m; i++) {
      const ok = i < m && rv.open[i] && rv.br[i] >= 1.15 && rv.br[i] < 2.3 && (rv.snel ? rv.snel[i] < 0.3 : true) && !tl.isMeer(p[i * 2], p[i * 2 + 1]);
      if (ok && a < 0) a = i;
      if (!ok && a >= 0) {
        // stukken van 14 tot 26 eenheden
        let s0 = rv.s[a];
        const eind = rv.s[i - 1];
        while (eind - s0 >= 14) {
          const L = Math.min(26, eind - s0), zaad = (ri * 733 + Math.floor(s0) * 3) | 0;
          if (hash(zaad, 1) < 0.45) banen.push({ ri, sa: s0 + 1, se: s0 + L - 1, zaad, score: hash(zaad, 2), x: 0, y: 0 });
          s0 += L + 6;
        }
        a = -1;
      }
    }
    // oevers om de paar eenheden
    let laatste = -99;
    for (let i = 2; i < m - 2; i++) {
      if (!rv.open[i] || rv.s[i] - laatste < 7 || hash(ri, i, 71) > 0.22) continue;
      const x = p[i * 2], y = p[i * 2 + 1], tx = p[(i + 1) * 2] - p[(i - 1) * 2], ty = p[(i + 1) * 2 + 1] - p[(i - 1) * 2 + 1], tl2 = Math.hypot(tx, ty) || 1;
      const kant = hash(ri, i, 72) < 0.5 ? 1 : -1, nx = (-ty / tl2) * kant, ny = (tx / tl2) * kant, hw = rv.br[i] / 2;
      const bx = x + nx * (hw + 0.5), by = y + ny * (hw + 0.5), d = tl.rivierAfstand(bx, by);
      const fx = bx - nx * (0.5 + hw * 0.7), fy = by - ny * (0.5 + hw * 0.7);
      if (d < 0.25 || d > 0.9 || zee(bx, by) || tl.isMeer(bx, by) || sdOp(sd, bx, by) > -1.5 || tl.rivierAfstand(fx, fy) > -0.15 || !tl.boomvrij(bx, by, 0.35)) continue;
      oevers.push({ x: bx, y: by, wx: -nx, wy: -ny, fx, fy, zaad: (ri * 97 + i) | 0, steiger: false, meer: -1 });
      laatste = rv.s[i];
    }
  }
  for (const bn of banen) { const rv = R[bn.ri]; let i = 0; while (i < rv.s.length - 1 && rv.s[i] < (bn.sa + bn.se) / 2) i++; bn.x = rv.pts[i * 2]; bn.y = rv.pts[i * 2 + 1]; }

  // meren: lussen (schaatsen in de winter, roeien in de zomer), plekken op het ijs, oevers, steigertjes
  const meren = [], lussen = [], ijsPlekken = [], zwemsteigers = [];
  const ML = b.water && b.water.meren ? b.water.meren : [];
  for (let mi = 0; mi < ML.length; mi++) {
    const m = ML[mi], r = m.r;
    if (r < 4) continue;
    const isM = (x, y) => tl.isMeer(x, y) && !zee(x, y);
    const binnenP = [];
    for (let y = m.y - r * 1.4; y <= m.y + r * 1.4; y += 2) for (let x = m.x - r * 1.4; x <= m.x + r * 1.4; x += 2) {
      if (!binnen(x, y, 6) || !isM(x, y) || !isM(x + 2, y) || !isM(x - 2, y) || !isM(x, y + 2) || !isM(x, y - 2)) continue;
      binnenP.push({ x, y, score: hash(Math.round(x * 3), Math.round(y * 3), mi) });
    }
    if (!binnenP.length) continue;
    const stad = stadBij(m.x, m.y, Math.ceil(r / Tw) + 1);
    const meer = { idx: mi, x: m.x, y: m.y, r, stad };
    meren.push(meer);
    // lussen: zo groot als past, hooguit drie per meer, niet over elkaar
    const ml = [];
    const kand = binnenP.slice().sort((p, q) => q.score - p.score || p.y - q.y || p.x - q.x);
    for (const rx0 of [7, 5.5, 4, 3, 2.2]) {
      if (rx0 > r * 0.55) continue;
      for (let k = 0; k < kand.length && ml.length < 3; k++) {
        const c = kand[k], hoek = hash(mi, k, 81) * Math.PI, rx = rx0, ry = rx0 * (0.55 + 0.2 * hash(mi, k, 82));
        if (ml.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < o.rx + rx + 1.5)) continue;
        const co = Math.cos(hoek), si = Math.sin(hoek);
        let ok = true;
        for (let q = 0; q < 16 && ok; q++) {
          const u = (q / 16) * TAU, ex = Math.cos(u) * (rx + 1.3), ey = Math.sin(u) * (ry + 1.3);
          if (!isM(c.x + ex * co - ey * si, c.y + ex * si + ey * co)) ok = false;
        }
        if (ok) ml.push({ x: c.x, y: c.y, rx, ry, hoek, meer: mi, stad, zaad: (mi * 1009 + k * 7) | 0, klein: rx0 <= 2.2 });
      }
    }
    lussen.push(...ml);
    // waterfietsen: kleine lussen op een meer bij de stad
    if (stad) {
      let nk = 0;
      for (let k = 0; k < kand.length && nk < 2; k++) {
        const c = kand[(k * 7) % kand.length], rx = 1.8, ry = 1.2;
        if (ml.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < o.rx + rx + 1)) continue;
        let ok = true;
        for (let q = 0; q < 12 && ok; q++) { const u = (q / 12) * TAU; if (!isM(c.x + Math.cos(u) * (rx + 1), c.y + Math.sin(u) * (ry + 1))) ok = false; }
        if (!ok) continue;
        lussen.push({ x: c.x, y: c.y, rx, ry, hoek: 0, meer: mi, stad, zaad: (mi * 503 + k) | 0, klein: true, fiets: true });
        ml.push({ x: c.x, y: c.y, rx });
        nk++;
      }
    }
    // plekken op het ijs: ijsvissers in het midden, kinderen en een tentje met warme drank aan de kant
    const vrijP = kand.filter((p) => !ml.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < o.rx + 1.6));
    const gekozen = kiesVerspreid(vrijP.map((p) => ({ ...p })), 3.2, 7);
    for (let k = 0; k < gekozen.length; k++) {
      const p = gekozen[k];
      // kant: hoe dicht bij de oever (een van acht richtingen op 3,5 eenheden is droog)
      let kantje = false, ox = 0, oy = 0;
      for (let q = 0; q < 8 && !kantje; q++) { const u = (q / 8) * TAU; if (!isM(p.x + Math.cos(u) * 3.6, p.y + Math.sin(u) * 3.6)) { kantje = true; ox = Math.cos(u); oy = Math.sin(u); } }
      ijsPlekken.push({ x: p.x, y: p.y, meer: mi, kant: kantje, ox, oy, zaad: (mi * 211 + k * 13) | 0 });
    }
    // zwemsteiger: aan een meer bij de stad, iets van de kant
    if (stad) {
      for (const p of vrijP) {
        if (gekozen.some((g) => Math.hypot(g.x - p.x, g.y - p.y) < 2.5)) continue;
        let ok = true;
        for (let q = 0; q < 8 && ok; q++) { const u = (q / 8) * TAU; if (!isM(p.x + Math.cos(u) * 1.8, p.y + Math.sin(u) * 1.8)) ok = false; }
        if (ok) { zwemsteigers.push({ x: p.x, y: p.y, meer: mi, zaad: (mi * 37 + 5) | 0 }); break; }
      }
    }
    // oevers rondom: van een binnenpunt naar buiten tot het droog is
    const mid = binnenP.reduce((a, p) => (Math.hypot(p.x - m.x, p.y - m.y) < Math.hypot(a.x - m.x, a.y - m.y) ? p : a), binnenP[0]);
    let nOever = 0;
    for (let q = 0; q < 20 && nOever < 4; q++) {
      if (hash(mi, q, 91) > 0.45) continue;
      const u = (q / 20) * TAU + hash(mi, 92) * 0.3, dx = Math.cos(u), dy = Math.sin(u);
      let d = 0;
      while (d < r * 2.5 && isM(mid.x + dx * d, mid.y + dy * d)) d += 0.25;
      if (d >= r * 2.5 || d < 2) continue;
      const ex = mid.x + dx * d, ey = mid.y + dy * d, bx = ex + dx * 0.5, by = ey + dy * 0.5;
      if (tl.isMeer(bx + dx * 0.4, by + dy * 0.4) || zee(bx, by) || sdOp(sd, bx, by) > -1.5 || tl.rivierAfstand(bx, by) < 0.4 || !tl.boomvrij(bx, by, 0.35)) continue;
      const steiger = hash(mi, q, 93) < 0.6;
      const L = steiger ? 1.5 : 0;
      if (steiger && (!isM(ex - dx * L, ey - dy * L) || !isM(ex - dx * 0.7, ey - dy * 0.7))) continue;
      const hx = ex - dx * L, hy = ey - dy * L; // waar de hengelaar zit (eind van de steiger, of de kant)
      const fx = hx - dx * 1, fy = hy - dy * 1;
      if (!isM(fx, fy)) continue;
      oevers.push({ x: steiger ? hx : bx, y: steiger ? hy : by, wx: -dx, wy: -dy, fx, fy, zaad: (mi * 571 + q) | 0, steiger, bx, by, meer: mi });
      nOever++;
    }
  }

  // brokken met ondiepe zee: alleen die worden gebakken
  const kolC = Math.ceil(W / CH), rijC = Math.ceil(H / CH), brok = new Uint8Array(kolC * rijC);
  for (let y = 1; y < H; y += 2) for (let x = 1; x < W; x += 2) { const s = sd[y * W + x]; if (s > 0.3 && s < 5) brok[Math.floor(y / CH) * kolC + Math.floor(x / CH)] = 1; }
  return { walvissen, dolfijnen, scholen, kwallen, klippen, stranden, regattas, banen, oevers, meren, lussen, ijsPlekken, zwemsteigers, brok, kolC, rijC };
}

// ---------- de laag ----------

export class ZeeLaag {
  constructor() {
    this.state = null; this.geo = null; this.eigenaar = null; this.basis = null; this.tl = null; this.wereld = null;
    this.sig = ''; this.versie = 0; this.klBron = null; this.eigenKust = null;
    this.raster = new Uint8Array(RW * RH);
    this.cache = new Map(); // brokken onderwaterdetail, LRU
    this.laatste = new Map(); // brok → laatst gebakken (welke maat ook): vervanger tijdens het zoomen
    this.bytes = 0; this.gebakken = 0; this.bakTeller = 0;
    this.n2 = [0, 0];
    this.boot = new Float32Array(PLAFOND.boten * BOOT);
    this.dolf = new Float32Array(PLAFOND.dolfijnen * DOLF);
    this.vogel = new Float32Array(PLAFOND.zeevogels * VOGEL);
    this.schoolXY = new Float32Array(PLAFOND.scholen * 5);
    this.kites = new Float32Array(PLAFOND.kites * 6);
    this.schaats = new Float32Array(PLAFOND.schaatsers * 6);
    this.krab = new Float32Array(PLAFOND.krabben * 5);
    this.warm = false;
    this.leeg();
    this.nul();
  }

  leeg() {
    this.walvissen = []; this.dolfijnen = []; this.scholen = []; this.kwallen = []; this.klippen = []; this.krabben = [];
    this.surfs = []; this.regattas = []; this.banen = []; this.oevers = []; this.lussen = []; this.ijsPlekken = []; this.zwemsteigers = [];
    this.plekLijst = [];
  }

  nul() {
    this.n = { brokken: 0, klippen: 0, scholen: 0, vissen: 0, kwallen: 0, walvissen: 0, dolfijnen: 0, zeevogels: 0, boten: 0, kites: 0, boeien: 0, schaatsers: 0, ijsvissers: 0, kinderen: 0, tentjes: 0, steigers: 0, hengelaars: 0, zwemsteigers: 0, zwemmers: 0, krabben: 0, sprongen: 0, kringen: 0, surfers: 0 };
    this.nBoot = 0; this.nDolf = 0; this.nVogel = 0; this.nKite = 0;
  }

  laad(view) {
    this.state = view.state;
    this.geo = view.geo;
    this.eigenaar = view.eigenaar;
    const vt = view.terreinLaag;
    this.basis = vt && vt.basis && vt.basis.geo === view.geo ? vt.basis : maakBasis(view.geo, view.eigenaar);
    this.tl = vt && vt.basis === this.basis ? vt : Object.assign(new TerreinLaag(), { basis: this.basis, geo: view.geo });
    this.wereld = wereldCache.get(this.basis) ?? null;
    if (!this.wereld) { this.wereld = analyse(view.geo, this.basis, this.tl); wereldCache.set(this.basis, this.wereld); }
    // koraal alleen als het pack een warme zee aanwijst (kaart.zeeen[].warm of kaart.warmeZee)
    const kaart = view.state?.pack?.kaart;
    this.warm = !!(kaart && (kaart.warmeZee || (kaart.zeeen || []).some((z) => z.warm)));
    this.sig = ''; this.klBron = null; this.inOorlog = null;
    this.leeg();
    this.cache.clear(); this.laatste.clear(); this.bytes = 0;
  }

  // ---------- opzoeken ----------

  isZee(x, y) {
    const e = this.eigenaar, px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= W || py >= H) return true;
    return e[py * W + px] === -1;
  }
  sd(x, y) { return sdOp(this.basis.sd, x, y); }

  merk(x, y, r, bit) {
    const g = this.raster, rr = (r + 1.42) * (r + 1.42);
    const c0 = Math.max(0, Math.floor((x - r) / RC)), c1 = Math.min(RW - 1, Math.floor((x + r) / RC));
    const r0 = Math.max(0, Math.floor((y - r) / RC)), r1 = Math.min(RH - 1, Math.floor((y + r) / RC));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const dx = cx * RC + 1 - x, dy = cy * RC + 1 - y; if (dx * dx + dy * dy <= rr) g[cy * RW + cx] |= bit; }
  }
  vrij(x, y, r, masker) {
    const g = this.raster, rr = (r + 1.42) * (r + 1.42);
    const c0 = Math.max(0, Math.floor((x - r) / RC)), c1 = Math.min(RW - 1, Math.floor((x + r) / RC));
    const r0 = Math.max(0, Math.floor((y - r) / RC)), r1 = Math.min(RH - 1, Math.floor((y + r) / RC));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const dx = cx * RC + 1 - x, dy = cy * RC + 1 - y; if (dx * dx + dy * dy <= rr && g[cy * RW + cx] & masker) return false; }
    return true;
  }
  // Oorlog: welke landen nu in oorlog zijn (zelfde regel als oorlogenVan in de engine: een blok of een los land).
  werkOorlog(s) {
    const L = s.landen, O = s.oorlogen ?? [];
    if (!this.inOorlog || this.inOorlog.length !== L.length) { this.inOorlog = new Uint8Array(L.length); this.losNaam = L.map((c) => `land:${c.idx}`); }
    const io = this.inOorlog;
    for (let i = 0; i < L.length; i++) {
      const c = L[i], p = c.alignment && c.alignment !== 'zwevend' ? c.alignment : this.losNaam[i];
      let w = 0;
      for (let j = 0; j < O.length && !w; j++) if (O[j].a === p || O[j].b === p) w = 1;
      io[i] = w;
    }
  }
  // Hoeveel van de recreatie er bij (x, y) doorgaat: in een land in oorlog bijna niets (geen wedstrijden, weinig vissers).
  vrede(x, y) {
    const Tw = this.geo.T, t = clamp(Math.floor(y / Tw), 0, this.geo.rij - 1) * this.geo.kol + clamp(Math.floor(x / Tw), 0, this.geo.kol - 1);
    const e = this.state.eigenaar ? this.state.eigenaar[t] : -1;
    return e >= 0 && this.inOorlog[e] ? 0.15 : 1;
  }

  plek(soort, x, y) { this.plekLijst.push({ soort, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }); }

  // Punt op een rivier op booglengte s: zet px, py, de stroomrichting fx, fy en de halve breedte hw.
  langs(rv, s) {
    const S = rv.s, n = S.length;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const d = S[hi] - S[lo] || 1, f = clamp((s - S[lo]) / d, 0, 1), p = rv.pts;
    const ax = p[lo * 2], ay = p[lo * 2 + 1], bx = p[hi * 2], by = p[hi * 2 + 1];
    this.px = ax + (bx - ax) * f; this.py = ay + (by - ay) * f;
    const l = Math.hypot(bx - ax, by - ay) || 1;
    this.fx = (bx - ax) / l; this.fy = (by - ay) / l;
    this.hw = (rv.br[lo] + (rv.br[hi] - rv.br[lo]) * f) / 2;
  }

  // Punt op een lus (gedraaide ellips) op hoek u: zet px, py en de looprichting fx, fy.
  opLus(L, u, extra = 0) {
    const co = Math.cos(L.hoek), si = Math.sin(L.hoek), cu = Math.cos(u), su = Math.sin(u);
    const ex = cu * (L.rx + extra), ey = su * (L.ry + extra);
    this.px = L.x + ex * co - ey * si; this.py = L.y + ex * si + ey * co;
    const dx = -su * L.rx, dy = cu * L.ry, tx = dx * co - dy * si, ty = dx * si + dy * co, l = Math.hypot(tx, ty) || 1;
    this.fx = tx / l; this.fy = ty / l;
  }

  // ---------- kiezen (alleen als de toestand iets verandert) ----------

  // Het botsraster komt van kust.js (die tekent eerder in hetzelfde beeld); zonder kustlaag een eigen.
  kustVan(view) {
    const kl = view.kustLaag;
    if (kl && kl.wereld && kl.state === view.state && kl.raster && kl.sig && kl.basis === this.basis) return kl;
    const e = (this.eigenKust ??= new KustLaag());
    if (e.state !== view.state || e.geo !== view.geo || e.eigenaar !== view.eigenaar || e.basis !== this.basis) e.laad(view);
    e.werkCache(view);
    return e;
  }

  werkCache(view) {
    const kl = this.kustVan(view), nl = view.natuurLaag;
    const sig = `${kl.sig}|${nl && nl.geo === view.geo ? `${nl.vallen?.length},${nl.snel?.length},${nl.bevers?.length},${nl.dieren?.length}` : '-'}`;
    if (sig === this.sig && kl === this.klBron) return;
    this.sig = sig; this.klBron = kl;
    this.kies(kl, nl && nl.geo === view.geo ? nl : null);
  }

  kies(kl, nl) {
    this.leeg();
    // nieuwe versie: de brokken worden opnieuw gebakken (één per beeld); tot dan blijft de vorige versie staan
    // (via laatste), zodat het onderwaterdetail niet knippert als er ergens gebouwd wordt
    this.versie++;
    const g = this.raster, A = this.wereld, R = this.tl.rivieren;
    if (kl.raster && kl.raster.length === g.length) g.set(kl.raster); else g.fill(0);
    // rotsen en rollers van de kust, het rivierleven van de natuurlaag
    const kr = kl.rotsen ?? [], ko = kl.rollers ?? [];
    for (let i = 0; i < kr.length; i += 6) this.merk(kr[i], kr[i + 1], kr[i + 2] + 0.6, ROTS);
    for (let i = 0; i < ko.length; i += 6) for (const d of [0.8, 3, 5.4]) this.merk(ko[i] + ko[i + 2] * d, ko[i + 1] + ko[i + 3] * d, ko[i + 5] * 0.9, RAND);
    if (nl) {
      for (const v of nl.vallen ?? []) this.merk(v.x, v.y, 3.5, NATUUR);
      for (const v of nl.snel ?? []) this.merk(v.x, v.y, v.br / 2 + 1.4, NATUUR);
      for (const v of nl.bevers ?? []) { this.merk(v.x, v.y, 2.6, NATUUR); this.merk(v.vx, v.vy, 2.2, NATUUR); this.merk(v.lx, v.ly, 1.2, NATUUR); }
      for (const v of nl.dieren ?? []) if (v.s === 4 || v.s === 5) this.merk(v.x, v.y, 1, NATUUR);
    }
    // zee
    for (const w of A.walvissen) if (this.vrij(w.x, w.y, 7, LEVEN | KUST | INFRA)) { this.walvissen.push(w); this.plek('walvis', w.x, w.y); }
    for (const r of A.regattas) {
      if (this.regattas.length >= 14 || this.regattas.some((o) => Math.hypot(o.x - r.x, o.y - r.y) < 50)) continue;
      let ok = true;
      for (let q = 0; q < 12 && ok; q++) { const u = (q / 12) * TAU; ok = this.vrij(r.x + Math.cos(u) * 4.2, r.y + Math.sin(u) * 4.2, 1, LEVEN | KUST | INFRA | RAND | ROTS | ZEE); }
      if (!ok || !this.vrij(r.x, r.y, 2, LEVEN | KUST | INFRA)) continue;
      this.regattas.push({ ...r, hoek: hash(r.zaad, 1) * TAU, n: 5 + Math.floor(hash(r.zaad, 2) * 4), ...this.stadAnker(r.x, r.y) });
      this.merk(r.x, r.y, 5.4, ZEE);
      this.plek('zeilwedstrijd', r.x, r.y);
    }
    for (const d of A.dolfijnen) {
      let ok = true;
      for (let q = 0; q < 12 && ok; q++) { const u = (q / 12) * TAU; ok = this.vrij(d.x + Math.cos(u) * d.R, d.y + Math.sin(u) * d.R * 0.7, 1, LEVEN | KUST | INFRA | ZEE); }
      if (ok) { this.dolfijnen.push(d); if (this.dolfijnen.length === 1) this.plek('dolfijnen', d.x + d.R, d.y); }
    }
    for (const s of A.stranden) {
      // surfspot: om de zoveel stranden, met ruimte langs de branding
      if (this.surfs.length < 40 && hash(s.zaad, 3) < 0.14) {
        const tx = -s.ny, ty = s.nx;
        let ok = true;
        for (const u of [-1.2, 1.5, 4.4]) for (const d of [1.2, 3, 5]) { const x = s.x + tx * u + s.nx * d, y = s.y + ty * u + s.ny * d; if (!this.isZee(x, y) || this.sd(x, y) < 0.5 || !this.vrij(x, y, 0.6, LEVEN | KUST | INFRA | ROTS | ZEE)) ok = false; }
        if (ok && !this.surfs.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < 22)) {
          this.surfs.push(s);
          this.merk(s.x + tx * 1.6 + s.nx * 3, s.y + ty * 1.6 + s.ny * 3, 3.4, ZEE);
          if (this.surfs.length === 1) this.plek('surfers', s.x + s.nx * 3, s.y + s.ny * 3);
          continue;
        }
      }
      // krabben: op het natte zand achter de waterlijn
      if (this.krabben.length < 600 && hash(s.zaad, 4) < 0.4) {
        const d = 0.7 + hash(s.zaad, 5) * 0.8, x = s.x - s.nx * d, y = s.y - s.ny * d;
        if (this.sd(x, y) < -2 || !this.vrij(x, y, 0.5, LEVEN | KUST | INFRA | GEBOUW | ZEE)) continue;
        // het hele stukje waar hij heen en weer scharrelt moet droog zand zijn
        let droog = true;
        for (let q = 0; q < 9 && droog; q++) {
          const u = ((q % 3) - 1) * 0.42, o = (Math.floor(q / 3) - 1) * 0.5, px = x - s.ny * u - s.nx * o, py = y + s.nx * u - s.ny * o;
          if (this.isZee(px, py) || this.sd(px, py) > -0.2 || this.tl.isZoetWater(px, py) || this.tl.rivierAfstand(px, py) < 0.3) droog = false;
        }
        if (!droog) continue;
        this.krabben.push({ x, y, hx: -s.ny, hy: s.nx, zaad: s.zaad });
        if (this.krabben.length === 1) this.plek('krabben', x, y);
      }
    }
    // rivieren en meren
    for (const bn of A.banen) {
      const rv = R[bn.ri];
      let ok = true;
      for (let s = bn.sa; s <= bn.se && ok; s += 1) { this.langs(rv, s); ok = this.vrij(this.px, this.py, Math.max(0.5, this.hw * 0.6), INFRA | KUST | GEBOUW | NATUUR | ZEE); }
      if (!ok) continue;
      this.banen.push({ ...bn, n: hash(bn.zaad, 6) < 0.4 ? 2 : 1 });
      for (let s = bn.sa; s <= bn.se; s += 2) { this.langs(rv, s); this.merk(this.px, this.py, this.hw + 0.3, ZEE); }
      if (this.banen.length === 1) this.plek('roeiers', bn.x, bn.y);
    }
    for (const L of A.lussen) {
      let ok = true;
      for (let q = 0; q < 16 && ok; q++) { this.opLus(L, (q / 16) * TAU, 0.6); ok = this.vrij(this.px, this.py, 0.6, INFRA | KUST | GEBOUW | NATUUR | ZEE); }
      if (!ok) continue;
      this.lussen.push(L);
      for (let q = 0; q < 16; q++) { this.opLus(L, (q / 16) * TAU, 0.4); this.merk(this.px, this.py, 0.8, ZEE); }
      if (this.lussen.length === 1) this.plek('meerlus', L.x, L.y);
      if (L.fiets && !this.plekLijst.some((p) => p.soort === 'waterfietsen')) this.plek('waterfietsen', L.x, L.y);
    }
    for (const p of A.ijsPlekken) {
      if (!this.vrij(p.x, p.y, 1.2, INFRA | KUST | GEBOUW | NATUUR | ZEE)) continue;
      this.ijsPlekken.push(p);
      this.merk(p.x, p.y, 1.4, ZEE);
      if (this.ijsPlekken.length === 1) this.plek('ijsplek', p.x, p.y);
    }
    for (const p of A.zwemsteigers) {
      if (!this.vrij(p.x, p.y, 1.6, INFRA | KUST | GEBOUW | NATUUR | ZEE)) continue;
      this.zwemsteigers.push(p);
      this.merk(p.x, p.y, 1.8, ZEE);
      this.plek('zwemsteiger', p.x, p.y);
    }
    for (const o of A.oevers) {
      if (!this.vrij(o.x, o.y, 0.6, INFRA | KUST | GEBOUW | NATUUR | LEVEN | ZEE) || !this.vrij(o.fx, o.fy, 0.4, INFRA | KUST | GEBOUW | NATUUR | ZEE)) continue;
      if (o.steiger && !this.vrij(o.bx, o.by, 0.5, INFRA | KUST | GEBOUW | NATUUR | ZEE)) continue;
      this.oevers.push(o);
      this.merk(o.x, o.y, 0.8, ZEE);
      if (o.steiger) this.merk((o.x + o.bx) / 2, (o.y + o.by) / 2, 0.9, ZEE);
      if (!this.plekLijst.some((p) => p.soort === (o.steiger ? 'steiger' : 'hengelaar'))) this.plek(o.steiger ? 'steiger' : 'hengelaar', o.x, o.y);
    }
    for (const k of A.klippen) {
      if (!this.vrij(k.x, k.y, k.r + 0.8, INFRA | KUST | LEVEN | RAND | ROTS | ZEE)) continue;
      this.klippen.push(k);
      this.merk(k.x, k.y, k.r + 0.5, ZEE);
      if (this.klippen.length === 1) this.plek('klip', k.x, k.y);
    }
    for (const s of A.scholen) if (this.vrij(s.x, s.y, s.R + 0.8, KUST | INFRA | RAND | ROTS)) { this.scholen.push(s); if (this.scholen.length === 1) this.plek('visschool', s.x, s.y); }
    for (const k of A.kwallen) if (this.vrij(k.x, k.y, 2, KUST | INFRA | RAND | ROTS)) { this.kwallen.push(k); if (this.kwallen.length === 1) this.plek('kwallen', k.x, k.y); }
  }

  // Het dichtstbijzijnde stadsvakje bij een wedstrijdbaan (wiens land de wedstrijd organiseert).
  stadAnker(x, y) {
    const geo = this.geo, Tw = geo.T, vl = this.tl.vlaggen, k0 = Math.floor(x / Tw), r0 = Math.floor(y / Tw);
    let best = 1e9, ax = x, ay = y;
    for (let dr = -4; dr <= 4; dr++) for (let dk = -4; dk <= 4; dk++) {
      const k = k0 + dk, r = r0 + dr;
      if (k < 0 || r < 0 || k >= geo.kol || r >= geo.rij || !vl.stad[r * geo.kol + k]) continue;
      const d = dk * dk + dr * dr;
      if (d < best) { best = d; ax = (k + 0.5) * Tw; ay = (r + 0.5) * Tw; }
    }
    return { ax, ay };
  }

  // ---------- per beeld ----------

  kader(view, sc) {
    const [wx0, wy0] = view.naarWereld(0, 0);
    const [wx1, wy1] = view.naarWereld(view.w, view.h);
    this.sc = sc;
    this.T = this.geo.T * sc;
    this.ox = view.w / 2 - view.cx * sc;
    this.oy = view.h / 2 - view.cy * sc;
    this.wx0 = wx0; this.wy0 = wy0; this.wx1 = wx1; this.wy1 = wy1;
    this.w = view.w; this.h = view.h;
    this.dpr = view.dpr || 1;
  }
  puntInBeeld(x, y, m) { return x >= this.wx0 - m && x <= this.wx1 + m && y >= this.wy0 - m && y <= this.wy1 + m; }

  // Na de kustlaag: eerst wat onder water ligt, dan wat erop drijft en vaart, dan de mensen, als laatste wat vliegt.
  teken(c, view, sc, nu, dt = 0, tempo = 0) {
    void dt; void tempo;
    this.nul();
    const s = view.state;
    if (!s || !view.geo || !view.w || !view.eigenaar) return;
    if (this.state !== s || this.geo !== view.geo || this.eigenaar !== view.eigenaar || (view.terreinLaag?.basis && view.terreinLaag.basis !== this.basis)) this.laad(view);
    const z = view.zoom;
    this.zoom = z;
    if (z < DREMPEL.zand - 0.4) return;
    this.werkCache(view);
    this.kader(view, sc);
    this.nu = nu;
    this.t = nu / 1000;
    this.dag = s.dag ?? 0;
    const sz = (this.sz = seizoen(this.dag));
    // bevroren meren: dezelfde regel als de gebakken grond in terrein.js (seizoensstap, smooth(0,86, 0,97, koud))
    this.ijs = smooth(0.86, 0.97, seizoenVanStap(seizoensStap(this.dag)).koud);
    this.bevroren = this.ijs > 0.6;
    this.wr = weer(this.dag, view.cx, view.cy);
    this.wd = wind(this.dag);
    this.wx = Math.cos(this.wd.hoek); this.wy = Math.sin(this.wd.hoek);
    this.nacht = view.nacht ?? 0;
    this.werkOorlog(s);
    // hoeveel mensen er buiten op en aan het water zijn: overdag, droog, niet bij onweer
    this.mens = (1 - smooth(0.3, 0.7, this.nacht)) * (1 - 0.6 * smooth(0.1, 0.6, this.wr.regen)) * (1 - this.wr.onweer);
    this.zomer = clamp(sz.zomer + 0.6 * sz.lente + 0.3 * sz.herfst, 0, 1) * (1 - this.ijs);
    this.bakTeller = 0;
    const a = smooth(DREMPEL.zand - 0.4, DREMPEL.zand + 0.4, z);
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    this.tekenOnder(c, a * 0.95);
    if (z > DREMPEL.witwater - 0.5) this.tekenKlippen(c, a * smooth(DREMPEL.witwater - 0.5, DREMPEL.witwater + 0.3, z));
    if (z > DREMPEL.school - 0.5) this.tekenScholen(c, a * smooth(DREMPEL.school - 0.5, DREMPEL.school + 0.4, z));
    if (z > DREMPEL.kwal - 0.5 && sz.zomer + 0.4 * sz.lente > 0.25) this.tekenKwallen(c, a * smooth(DREMPEL.kwal - 0.5, DREMPEL.kwal + 0.4, z));
    if (z > DREMPEL.walvis - 0.4) this.tekenWalvissen(c, a * smooth(DREMPEL.walvis - 0.4, DREMPEL.walvis + 0.4, z));
    if (z > DREMPEL.dolfijn - 0.5) this.tekenDolfijnen(c, a * smooth(DREMPEL.dolfijn - 0.5, DREMPEL.dolfijn + 0.4, z));
    if (z > DREMPEL.steiger - 0.5) this.tekenSteigers(c, a * smooth(DREMPEL.steiger - 0.5, DREMPEL.steiger + 0.3, z));
    if (z > DREMPEL.zwemsteiger - 0.5 && !this.bevroren && sz.koud < 0.6) this.tekenZwemsteigers(c, a * smooth(DREMPEL.zwemsteiger - 0.5, DREMPEL.zwemsteiger + 0.3, z));
    this.verzamelBoten();
    this.tekenBoten(c, a);
    if (this.bevroren && z > DREMPEL.schaats - 0.5) this.tekenIjs(c, a * smooth(DREMPEL.schaats - 0.5, DREMPEL.schaats + 0.4, z));
    if (z > DREMPEL.hengel - 0.5) this.tekenHengelaars(c, a * smooth(DREMPEL.hengel - 0.5, DREMPEL.hengel + 0.4, z));
    if (z > DREMPEL.krab - 0.5) this.tekenKrabben(c, smooth(DREMPEL.krab - 0.5, DREMPEL.krab + 0.4, z));
    if (z > DREMPEL.kring - 0.5) this.tekenKringen(c, smooth(DREMPEL.kring - 0.5, DREMPEL.kring + 0.5, z));
    this.tekenLucht(c, a);
    c.restore();
  }

  // ---------- onder water: gebakken brokken ----------

  tekenOnder(c, a) {
    const A = this.wereld, sc = this.sc, ox = this.ox, oy = this.oy;
    const k0 = Math.max(0, Math.floor(this.wx0 / CH)), k1 = Math.min(A.kolC - 1, Math.floor(this.wx1 / CH));
    const r0 = Math.max(0, Math.floor(this.wy0 / CH)), r1 = Math.min(A.rijC - 1, Math.floor(this.wy1 / CH));
    // alles wat in beeld is moet samen in de cache passen, anders bakt hij elk beeld weer weg wat hij net bakte
    let nZicht = 0;
    for (let r = r0; r <= r1; r++) for (let k = k0; k <= k1; k++) if (A.brok[r * A.kolC + k]) nZicht++;
    nZicht = Math.min(nZicht, PLAFOND.brokken);
    let R = brokRes(sc * this.dpr);
    while (R > 2 && nZicht * CH * CH * R * R * 4 > MAX_BYTES * 0.8) R /= 2;
    c.globalAlpha = a;
    let n = 0;
    for (let r = r0; r <= r1; r++) for (let k = k0; k <= k1; k++) {
      const bi = r * A.kolC + k;
      if (!A.brok[bi] || n >= PLAFOND.brokken) continue;
      const e = this.brok(bi, R);
      if (!e) continue;
      c.drawImage(e.cv, k * CH * sc + ox, r * CH * sc + oy, CH * sc, CH * sc);
      n++;
    }
    this.n.brokken = n;
  }

  brok(bi, R) {
    const A = this.wereld, k = bi % A.kolC, r = (bi - k) / A.kolC, sleutel = (this.versie * 256 + bi) * 32 + R;
    const oud = this.cache.get(sleutel);
    if (oud) { this.cache.delete(sleutel); this.cache.set(sleutel, oud); return oud; }
    if (this.bakTeller >= PLAFOND.bakken) return this.laatste.get(bi) ?? null;
    const P = CH * R, cv = fabriek(P, P);
    if (!cv) return null;
    this.bakTeller++;
    const g = cv.getContext('2d');
    this.bakBrok(g, k, r, R);
    const e = { cv, bytes: P * P * 4, bi };
    this.cache.set(sleutel, e);
    this.laatste.set(bi, e);
    this.bytes += e.bytes;
    this.gebakken++;
    for (const [s, x] of this.cache) {
      if (this.cache.size <= MAX_BROKKEN && this.bytes <= MAX_BYTES) break;
      if (x === e) continue;
      this.cache.delete(s);
      this.bytes -= x.bytes;
      if (this.laatste.get(x.bi) === x) this.laatste.delete(x.bi);
    }
    return e;
  }

  // Zandbanken met ribbels, velden zeegras, wier langs rotskusten, koraal (warme zee) en rotsen net onder water.
  // Alles zacht en doorschijnend: het water van terrein.js ligt er al onder, dit is wat je erdoorheen ziet.
  bakBrok(g, ck, cr, R) {
    const x0 = ck * CH, y0 = cr * CH, sd = this.basis.sd, Gs = 3, n2 = this.n2, ruis = this.geo.ruis, vl = this.tl.vlaggen, Tw = this.geo.T;
    g.setTransform(R, 0, 0, R, -x0 * R, -y0 * R);
    g.lineCap = 'round';
    const i0 = Math.floor((x0 - 6) / Gs), i1 = Math.floor((x0 + CH + 6) / Gs), j0 = Math.floor((y0 - 6) / Gs), j1 = Math.floor((y0 + CH + 6) / Gs);
    const VERBODEN = INFRA | KUST | RAND | ROTS;
    for (let laag = 0; laag < 4; laag++) {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = (i + hash(i, j, 301)) * Gs, py = (j + hash(i, j, 302)) * Gs;
        if (px < 2 || py < 2 || px > W - 2 || py > H - 2 || !this.isZee(px, py)) continue;
        const s = sdOp(sd, px, py);
        if (laag === 0 && s > 1.1 && s < 4.8 && hash(i, j, 303) < 0.42) {
          // zandbank: langgerekt evenwijdig aan de kust, lichter naar het ondiepe toe
          if (!this.vrij(px, py, 2, VERBODEN)) continue;
          normaal(sd, px, py, n2);
          const hk = Math.atan2(n2[1], n2[0]) + Math.PI / 2;
          // niet over de waterlijn: dwars op de kust hooguit tot vlak voor het strand, en beide punten in zee
          let rx = 1.5 + hash(i, j, 304) * 2.4;
          const ry = Math.min(rx * (0.3 + 0.2 * hash(i, j, 305)), s - 0.4), tx0 = -n2[1], ty0 = n2[0];
          while (rx > 1 && (sdOp(sd, px + tx0 * rx, py + ty0 * rx) < 0.5 || sdOp(sd, px - tx0 * rx, py - ty0 * rx) < 0.5)) rx *= 0.7;
          if (rx <= 1 || ry < 0.25) continue;
          const diep = 1 - (s - 1.1) / 3.7;
          for (let q = 0; q < 3; q++) {
            // het afstandsveld is per eenheid: een halve eenheid marge, en elke laag opnieuw gemeten
            const qx = px - 0.12 * q, qy = py - 0.12 * q, qr = Math.min(ry * (1 - q * 0.27), sdOp(sd, qx, qy) - 0.7);
            if (qr < 0.12) continue;
            g.fillStyle = `rgba(228,216,168,${(0.05 + 0.06 * diep).toFixed(3)})`;
            g.beginPath(); g.ellipse(qx, qy, rx * (1 - q * 0.27), qr, hk, 0, TAU); g.fill();
          }
          if (R >= 8) {
            // ribbels dwars op de stroming
            g.strokeStyle = `rgba(250,244,214,${(0.08 + 0.08 * diep).toFixed(3)})`; g.lineWidth = 0.07;
            const tx = Math.cos(hk), ty = Math.sin(hk);
            g.beginPath();
            for (let q = -2; q <= 2; q++) {
              const cx = px + tx * q * rx * 0.3, cy = py + ty * q * rx * 0.3, l = ry * (0.9 - Math.abs(q) * 0.15);
              g.moveTo(cx - n2[0] * l, cy - n2[1] * l); g.quadraticCurveTo(cx + tx * 0.15, cy + ty * 0.15, cx + n2[0] * l, cy + n2[1] * l);
            }
            g.stroke();
          }
        } else if (laag === 1 && s > 0.6 && s < 2.8 && ruis(px * 0.11 + 5, py * 0.11 + 9) > 0.62) {
          // zeegras: donkere plukken die met de stroom meebuigen; dicht bij de kant kleiner, zodat niets op het strand komt
          if (!this.vrij(px, py, 1.3, VERBODEN)) continue;
          const m = Math.min(1, (s - 0.3) / 1.6);
          g.fillStyle = 'rgba(28,60,42,0.2)'; g.beginPath(); g.ellipse(px, py, 1.2 * m, 0.8 * m, hash(i, j, 306) * 3, 0, TAU); g.fill();
          if (R >= 6) {
            g.strokeStyle = 'rgba(36,78,50,0.42)'; g.lineWidth = 0.09; g.beginPath();
            for (let q = 0; q < 7; q++) {
              const bx = px + (hash(i, j, 310 + q) - 0.5) * 2 * m, by = py + (hash(i, j, 320 + q) - 0.5) * 1.4 * m, l = (0.5 + hash(i, j, 330 + q) * 0.5) * m;
              g.moveTo(bx, by); g.quadraticCurveTo(bx + l * 0.5, by - l * 0.2, bx + l * 0.8, by + l * 0.3);
            }
            g.stroke();
          }
        } else if (laag === 2 && s > 0.75 && s < 2.2 && hash(i, j, 340) < 0.55) {
          // wier op de stenen voor een rotskust
          normaal(sd, px, py, n2);
          const t = clamp(Math.floor((py - n2[1] * (s + 2)) / Tw), 0, this.geo.rij - 1) * this.geo.kol + clamp(Math.floor((px - n2[0] * (s + 2)) / Tw), 0, this.geo.kol - 1);
          if (!vl.klif[t] || !this.vrij(px, py, 1, INFRA | KUST | RAND)) continue;
          g.fillStyle = 'rgba(86,78,38,0.32)'; g.beginPath();
          for (let q = 0; q < 4; q++) {
            const wx = px + (hash(i, j, 341 + q) - 0.5) * 0.8, wy = py + (hash(i, j, 345 + q) - 0.5) * 0.6;
            if (sdOp(sd, wx, wy) < 0.6) continue; // niet op de rots zelf
            g.moveTo(wx + 0.3, wy); g.ellipse(wx, wy, 0.3, 0.2, q, 0, TAU);
          }
          g.fill();
        } else if (laag === 3 && this.warm && s > 1.7 && s < 3.4 && hash(i, j, 350) < 0.35) {
          // koraal (alleen als het pack een warme zee aanwijst): bontgekleurde kussentjes met een lichte kern
          if (!this.vrij(px, py, 1.2, VERBODEN)) continue;
          for (let q = 0; q < 5; q++) {
            const bx = px + (hash(i, j, 351 + q) - 0.5) * 2, by = py + (hash(i, j, 356 + q) - 0.5) * 1.6, rr = 0.25 + hash(i, j, 361 + q) * 0.3;
            g.fillStyle = KORAAL[Math.floor(hash(i, j, 366 + q) * KORAAL.length)]; g.beginPath(); g.arc(bx, by, rr, 0, TAU); g.fill();
            g.fillStyle = 'rgba(255,240,230,0.25)'; g.beginPath(); g.arc(bx - rr * 0.3, by - rr * 0.3, rr * 0.4, 0, TAU); g.fill();
          }
        }
      }
    }
    // rotsen net onder het oppervlak: donker met een lichte noordwestkant
    for (const k of this.klippen) {
      if (k.x < x0 - 3 || k.y < y0 - 3 || k.x > x0 + CH + 3 || k.y > y0 + CH + 3) continue;
      const rr = k.r;
      g.fillStyle = 'rgba(30,36,38,0.5)'; g.beginPath(); g.ellipse(k.x, k.y, rr, rr * 0.75, hash(k.zaad, 1) * 3, 0, TAU); g.fill();
      g.fillStyle = 'rgba(70,78,74,0.45)'; g.beginPath(); g.ellipse(k.x - rr * 0.25, k.y - rr * 0.22, rr * 0.55, rr * 0.4, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(86,78,38,0.35)'; g.beginPath(); g.ellipse(k.x + rr * 0.3, k.y + rr * 0.3, rr * 0.5, rr * 0.3, 0.6, 0, TAU); g.fill();
    }
  }

  // ---------- wit water boven de klippen ----------

  tekenKlippen(c, a) {
    const L = this.klippen, sc = this.sc, ox = this.ox, oy = this.oy, t = this.t, T = this.T;
    let n = 0;
    c.globalAlpha = a * (0.6 + 0.4 * this.wd.kracht);
    c.strokeStyle = 'rgba(240,248,250,0.55)';
    c.lineWidth = Math.max(0.6, T * 0.004);
    c.beginPath();
    for (let i = 0; i < L.length && n < PLAFOND.klippen; i++) {
      const k = L[i];
      if (!this.puntInBeeld(k.x, k.y, 2)) continue;
      n++;
      const x = k.x * sc + ox, y = k.y * sc + oy, p = frac(t / 3.4 + hash(k.zaad, 2)), r = k.r * sc * (1.1 + 0.6 * p);
      ring(c, x, y, r, r * 0.72);
    }
    c.stroke();
    this.n.klippen = n;
    if (!n) return;
    // schuimkoppen die opkomen als er een golf over de rots gaat
    c.fillStyle = 'rgba(248,252,253,0.7)';
    c.beginPath();
    let m = 0;
    for (let i = 0; i < L.length && m < n; i++) {
      const k = L[i];
      if (!this.puntInBeeld(k.x, k.y, 2)) continue;
      m++;
      const p = frac(t / 3.4 + hash(k.zaad, 2));
      if (p > 0.35) continue;
      const x = k.x * sc + ox, y = k.y * sc + oy, f = 1 - p / 0.35;
      for (let q = 0; q < 3; q++) stip(c, x + (hash(k.zaad, q, 3) - 0.5) * k.r * sc * 1.4, y + (hash(k.zaad, q, 4) - 0.5) * k.r * sc, Math.max(0.6, k.r * sc * 0.28 * f));
    }
    c.fill();
  }

  // ---------- visscholen en kwallen (onder het oppervlak) ----------

  tekenScholen(c, a) {
    const L = this.scholen, sc = this.sc, ox = this.ox, oy = this.oy, t = this.t, T = this.T, z = this.zoom, B = this.schoolXY;
    let n = 0;
    for (let i = 0; i < L.length && n < PLAFOND.scholen; i++) {
      const s = L[i];
      if (!this.puntInBeeld(s.x, s.y, s.R + 2)) continue;
      const u = t * 0.045 + s.f * TAU, v = t * 0.031 + s.f * 4.1;
      const cx = s.x + s.R * Math.sin(u), cy = s.y + s.R * 0.7 * Math.sin(v);
      const dx = s.R * 0.045 * Math.cos(u), dy = s.R * 0.7 * 0.031 * Math.cos(v), l = Math.hypot(dx, dy) || 1;
      const o = n * 5;
      B[o] = cx; B[o + 1] = cy; B[o + 2] = dx / l; B[o + 3] = dy / l; B[o + 4] = s.zaad;
      n++;
    }
    this.n.scholen = n;
    if (!n) return;
    const los = z >= DREMPEL.vis;
    // het wolkje: een paar donkere vlekken die over elkaar schuiven en van vorm veranderen
    c.globalAlpha = a * (los ? 1 - smooth(DREMPEL.vis, DREMPEL.vis + 1.5, z) * 0.6 : 1);
    c.fillStyle = 'rgba(12,32,42,0.2)';
    c.beginPath();
    for (let j = 0; j < n; j++) {
      const o = j * 5, hx = B[o + 2], hy = B[o + 3], zd = B[o + 4];
      for (let k = 0; k < 4; k++) {
        const f = Math.sin(t * 0.5 + k * 1.7 + zd), g = Math.cos(t * 0.37 + k * 2.3 + zd);
        const along = (k - 1.5) * 0.45 + f * 0.25, opzij = g * 0.35;
        const x = (B[o] + hx * along - hy * opzij) * sc + ox, y = (B[o + 1] + hy * along + hx * opzij) * sc + oy;
        ovaal(c, x, y, hx, hy, sc * (0.7 + 0.25 * f), sc * (0.38 + 0.15 * g));
      }
    }
    c.fill();
    if (!los) return;
    // losse visjes: korte streepjes in de zwemrichting, af en toe flitst er een zilver op
    const vl = clamp((z - DREMPEL.vis) / 1.5, 0, 1);
    c.globalAlpha = a * vl;
    c.strokeStyle = 'rgba(14,34,44,0.6)';
    c.lineWidth = Math.max(0.6, T * 0.0035);
    c.beginPath();
    let nv = 0;
    const per = Math.min(16, Math.floor(PLAFOND.vissen / n));
    for (let j = 0; j < n; j++) {
      const o = j * 5, hx = B[o + 2], hy = B[o + 3], zd = B[o + 4];
      for (let k = 0; k < per; k++) {
        const h1 = hash(zd, k, 1), h2 = hash(zd, k, 2);
        const along = (h1 - 0.5) * 2.4 * (1 + 0.25 * Math.sin(t * 0.4 + k)), opzij = (h2 - 0.5) * 1.3 * (1 + 0.3 * Math.sin(t * 0.5 + k * 1.3));
        const zw = Math.sin(t * 3 + k) * 0.25;
        const x = (B[o] + hx * along - hy * opzij) * sc + ox, y = (B[o + 1] + hy * along + hx * opzij) * sc + oy, l = T * 0.006;
        const fx = hx - hy * zw, fy = hy + hx * zw;
        c.moveTo(x - fx * l, y - fy * l); c.lineTo(x + fx * l, y + fy * l);
        nv++;
      }
    }
    c.stroke();
    c.fillStyle = 'rgba(225,238,242,0.75)';
    c.beginPath();
    for (let j = 0; j < n; j++) {
      const o = j * 5, hx = B[o + 2], hy = B[o + 3], zd = B[o + 4];
      for (let k = 0; k < per; k++) {
        if (Math.sin(t * 1.7 + k * 2.1 + zd) < 0.94) continue;
        const along = (hash(zd, k, 1) - 0.5) * 2.4 * (1 + 0.25 * Math.sin(t * 0.4 + k)), opzij = (hash(zd, k, 2) - 0.5) * 1.3 * (1 + 0.3 * Math.sin(t * 0.5 + k * 1.3));
        stip(c, (B[o] + hx * along - hy * opzij) * sc + ox, (B[o + 1] + hy * along + hx * opzij) * sc + oy, Math.max(0.6, T * 0.0025));
      }
    }
    c.fill();
    this.n.vissen = nv;
  }

  tekenKwallen(c, a) {
    const L = this.kwallen, sc = this.sc, ox = this.ox, oy = this.oy, t = this.t, T = this.T, z = this.zoom, sz = this.sz;
    const kans = clamp(sz.zomer + 0.4 * sz.lente, 0, 1);
    let n = 0;
    c.globalAlpha = a;
    c.fillStyle = 'rgba(232,224,246,0.32)';
    c.beginPath();
    const r0 = Math.max(0.8, T * 0.006);
    for (let i = 0; i < L.length && n < PLAFOND.kwallen; i++) {
      const k = L[i];
      if (!this.puntInBeeld(k.x, k.y, 3) || hash(k.zaad, this.dag >> 3, 1) > kans) continue;
      for (let q = 0; q < 4 && n < PLAFOND.kwallen; q++) {
        const dx = (hash(k.zaad, q, 2) - 0.5) * 3 + this.wx * Math.sin(t * 0.02 + q) * 0.8, dy = (hash(k.zaad, q, 3) - 0.5) * 3 + this.wy * Math.sin(t * 0.02 + q) * 0.8;
        const x = (k.x + dx) * sc + ox, y = (k.y + dy) * sc + oy, r = r0 * (1 + 0.18 * Math.sin(t * 2.2 + q + k.zaad));
        stip(c, x, y, r);
        n++;
      }
    }
    c.fill();
    this.n.kwallen = n;
    if (!n || z < DREMPEL.fijn) return;
    // rand en tentakels, en bij sommige een paarse kern
    c.strokeStyle = 'rgba(248,246,255,0.45)';
    c.lineWidth = Math.max(0.5, T * 0.0012);
    c.beginPath();
    let m = 0;
    for (let i = 0; i < L.length && m < n; i++) {
      const k = L[i];
      if (!this.puntInBeeld(k.x, k.y, 3) || hash(k.zaad, this.dag >> 3, 1) > kans) continue;
      for (let q = 0; q < 4 && m < n; q++) {
        m++;
        const dx = (hash(k.zaad, q, 2) - 0.5) * 3 + this.wx * Math.sin(t * 0.02 + q) * 0.8, dy = (hash(k.zaad, q, 3) - 0.5) * 3 + this.wy * Math.sin(t * 0.02 + q) * 0.8;
        const x = (k.x + dx) * sc + ox, y = (k.y + dy) * sc + oy, r = r0 * (1 + 0.18 * Math.sin(t * 2.2 + q + k.zaad));
        c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU);
        for (let e = -1; e <= 1; e++) { c.moveTo(x + e * r * 0.5, y + r * 0.7); c.quadraticCurveTo(x + e * r * 0.5 + Math.sin(t * 2 + e) * r * 0.4, y + r * 1.4, x + e * r * 0.6, y + r * 2); }
      }
    }
    c.stroke();
  }

  // ---------- walvis en dolfijnen ----------

  tekenWalvissen(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, t = this.t;
    let n = 0;
    for (const w of this.walvissen) {
      if (n >= PLAFOND.walvissen || !this.puntInBeeld(w.x, w.y, 14)) continue;
      const P = 55 + hash(w.zaad, 1) * 35, tt = t + hash(w.zaad, 2) * P, cyc = Math.floor(tt / P), p = tt / P - cyc;
      if (p > 0.4) continue;
      // elke keer ergens anders in zijn stuk zee, met een eigen koers
      const hk = hash(w.zaad, cyc, 3) * TAU, hx = Math.cos(hk), hy = Math.sin(hk);
      const vooruit = (p / 0.34) * 3;
      const wx = w.x + (hash(w.zaad, cyc, 4) - 0.5) * 10 + hx * vooruit, wy = w.y + (hash(w.zaad, cyc, 5) - 0.5) * 10 + hy * vooruit;
      if (!this.puntInBeeld(wx, wy, 4)) continue;
      n++;
      const X = wx * sc + ox, Y = wy * sc + oy, L = T * 0.09;
      const boven = smooth(0, 0.04, p) * (1 - smooth(0.2, 0.25, p));
      const staart = p > 0.22 && p < 0.34 ? Math.sin((Math.PI * (p - 0.22)) / 0.12) : 0;
      c.globalAlpha = a;
      // spiegelgladde plek waar hij zwom
      c.fillStyle = `rgba(200,226,232,${(0.16 * (1 - smooth(0.25, 0.4, p))).toFixed(3)})`;
      c.beginPath(); ovaal(c, X - hx * L * 0.5, Y - hy * L * 0.5, hx, hy, L * 1.5, L * 0.6); c.fill();
      if (boven > 0.02) {
        // wit water rond de rug, dan de rug zelf: donker leigrijs met een natte glans aan de noordwestkant
        c.strokeStyle = 'rgba(240,248,250,0.55)'; c.lineWidth = Math.max(0.6, T * 0.003);
        c.beginPath(); ovaal(c, X, Y, hx, hy, L * (0.55 + 0.45 * boven) * 1.08, L * 0.24 * boven + 1); c.stroke();
        c.fillStyle = '#2e3a42'; c.beginPath(); ovaal(c, X, Y, hx, hy, L * (0.55 + 0.45 * boven), L * 0.22 * boven + 0.5); c.fill();
        c.fillStyle = 'rgba(220,235,240,0.28)'; c.beginPath(); ovaal(c, X - hx * L * 0.1 - L * 0.04, Y - hy * L * 0.1 - L * 0.06 * boven, hx, hy, L * 0.45 * boven + 0.3, L * 0.06 * boven + 0.3); c.fill();
        if (boven > 0.5) {
          const fx = X - hx * L * 0.55, fy = Y - hy * L * 0.55;
          c.fillStyle = '#26323a'; c.beginPath(); c.moveTo(fx + hx * L * 0.08, fy + hy * L * 0.08); c.lineTo(fx - hx * L * 0.06, fy - hy * L * 0.06 - L * 0.07); c.lineTo(fx - hx * L * 0.1, fy - hy * L * 0.1); c.closePath(); c.fill();
        }
      }
      // fontein: een zuil van nevel die opstijgt en met de wind wegwaait
      if (p > 0.03 && p < 0.17) {
        const f = (p - 0.03) / 0.14, bx = X + hx * L * 0.6, by = Y + hy * L * 0.6, Hs = T * 0.08 * Math.min(1, f * 3);
        c.fillStyle = `rgba(0,20,30,${(0.1 * (1 - f)).toFixed(3)})`;
        c.beginPath(); ovaal(c, bx + Hs * SCHUIN + this.wx * Hs * f, by + Hs * SCHUIN + this.wy * Hs * f, this.wx, this.wy, Hs * 0.4 + 1, Hs * 0.2 + 1); c.fill();
        c.fillStyle = `rgba(246,250,252,${(0.75 * (1 - f * 0.8)).toFixed(3)})`;
        c.beginPath();
        for (let q = 0; q < 6; q++) {
          const h = (q / 5) * Hs, drift = f * (q / 5) * T * 0.04;
          stip(c, bx + this.wx * drift, by - h + this.wy * drift * 0.5, Math.max(0.8, T * (0.006 + 0.006 * (q / 5)) * (0.6 + f)));
        }
        c.fill();
      }
      // staart die omhoog komt bij het duiken, met druppels
      if (staart > 0) {
        const sx = X - hx * L * 0.9, sy = Y - hy * L * 0.9, h = staart * T * 0.035, px = -hy, py = hx, b = L * 0.32;
        c.fillStyle = 'rgba(0,18,30,0.22)';
        c.beginPath(); c.moveTo(sx + h * SCHUIN, sy + h * SCHUIN); c.lineTo(sx + px * b + h * SCHUIN * 1.6, sy + py * b + h * SCHUIN * 1.6); c.lineTo(sx - px * b + h * SCHUIN * 1.6, sy - py * b + h * SCHUIN * 1.6); c.closePath(); c.fill();
        c.fillStyle = '#26323a';
        c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(sx + px * b * 0.3, sy + py * b * 0.3 - h, sx + px * b - hx * b * 0.3, sy + py * b - hy * b * 0.3 - h * 1.1);
        c.quadraticCurveTo(sx - hx * b * 0.15, sy - hy * b * 0.15 - h * 0.8, sx - px * b - hx * b * 0.3, sy - py * b - hy * b * 0.3 - h * 1.1);
        c.quadraticCurveTo(sx - px * b * 0.3, sy - py * b * 0.3 - h, sx, sy); c.fill();
        c.fillStyle = 'rgba(245,250,252,0.7)'; c.beginPath();
        for (let q = 0; q < 4; q++) stip(c, sx + px * b * (q / 1.5 - 1), sy + py * b * (q / 1.5 - 1) - h * (0.3 + 0.4 * frac(t * 2 + q * 0.3)), Math.max(0.6, T * 0.003));
        c.fill();
        c.strokeStyle = 'rgba(240,248,250,0.5)'; c.lineWidth = Math.max(0.6, T * 0.003); c.beginPath(); ovaal(c, sx, sy, hx, hy, b * 0.9, b * 0.45); c.stroke();
      }
    }
    this.n.walvissen = n;
  }

  tekenDolfijnen(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, t = this.t, z = this.zoom, B = this.dolf;
    let n = 0;
    for (const d of this.dolfijnen) {
      if (n >= PLAFOND.dolfijnen) break;
      if (!this.puntInBeeld(d.x, d.y, d.R + 2)) continue;
      const om = (1.3 / d.R) * d.dir, f0 = hash(d.zaad, 1) * TAU;
      for (let k = 0; k < d.n && n < PLAFOND.dolfijnen; k++) {
        const th = t * om + f0 - k * 0.16 * d.dir, lk = (hash(d.zaad, k, 2) - 0.5) * 0.9;
        const x = d.x + Math.cos(th) * (d.R + lk), y = d.y + Math.sin(th) * (d.R + lk) * 0.7;
        let hx = -Math.sin(th) * d.dir, hy = Math.cos(th) * 0.7 * d.dir;
        const hl = Math.hypot(hx, hy) || 1; hx /= hl; hy /= hl;
        const per = 3 + hash(d.zaad, k, 3) * 1.4, q = frac(t / per + hash(d.zaad, k, 4));
        const lucht = q < 0.32, plons = q >= 0.32 && q < 0.46;
        if (!lucht && !plons && z < DREMPEL.roei) continue; // onder water alleen dichtbij te zien
        const o = n * DOLF;
        B[o] = x * sc + ox; B[o + 1] = y * sc + oy; B[o + 2] = hx; B[o + 3] = hy;
        B[o + 4] = lucht ? Math.sin((Math.PI * q) / 0.32) * T * 0.03 : 0;
        B[o + 5] = lucht ? 1 : plons ? 2 + (q - 0.32) / 0.14 : 0;
        n++;
      }
    }
    this.n.dolfijnen = n;
    if (!n) return;
    const L = T * 0.024, Bw = T * 0.0062;
    c.globalAlpha = a;
    // onder water: vage donkere vormen
    c.fillStyle = 'rgba(28,50,62,0.28)';
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * DOLF; if (B[o + 5] === 0) ovaal(c, B[o], B[o + 1], B[o + 2], B[o + 3], L, Bw); }
    c.fill();
    // schaduw op het water onder de springers
    c.fillStyle = 'rgba(0,18,30,0.22)';
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * DOLF; if (B[o + 5] === 1) ovaal(c, B[o] + B[o + 4] * SCHUIN, B[o + 1] + B[o + 4] * SCHUIN, B[o + 2], B[o + 3], L * 0.9, Bw); }
    c.fill();
    // lijf: grijs, naar boven gekanteld als hij stijgt
    c.fillStyle = '#56636e';
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * DOLF; if (B[o + 5] === 1) ovaal(c, B[o], B[o + 1] - B[o + 4], B[o + 2], B[o + 3], L, Bw * 1.15); }
    c.fill();
    c.fillStyle = '#3c4852';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * DOLF;
      if (B[o + 5] !== 1) continue;
      const x = B[o], y = B[o + 1] - B[o + 4], hx = B[o + 2], hy = B[o + 3];
      // rugvin en staartvin
      c.moveTo(x - hx * L * 0.05 - hy * Bw * 0.2, y - hy * L * 0.05 + hx * Bw * 0.2 - Bw * 0.2); c.lineTo(x - hx * L * 0.35, y - hy * L * 0.35 - Bw * 1.6); c.lineTo(x - hx * L * 0.4, y - hy * L * 0.4); c.closePath();
      const sx = x - hx * L, sy = y - hy * L;
      c.moveTo(sx, sy); c.lineTo(sx - hx * Bw * 1.2 - hy * Bw * 1.5, sy - hy * Bw * 1.2 + hx * Bw * 1.5); c.lineTo(sx - hx * Bw * 1.2 + hy * Bw * 1.5, sy - hy * Bw * 1.2 - hx * Bw * 1.5); c.closePath();
    }
    c.fill();
    // natte glans op de rug (licht uit het noordwesten)
    if (z >= DREMPEL.roei) {
      c.fillStyle = 'rgba(235,242,246,0.4)';
      c.beginPath();
      for (let i = 0; i < n; i++) { const o = i * DOLF; if (B[o + 5] === 1) ovaal(c, B[o] + B[o + 2] * L * 0.15 - Bw * 0.3, B[o + 1] - B[o + 4] + B[o + 3] * L * 0.15 - Bw * 0.4, B[o + 2], B[o + 3], L * 0.45, Bw * 0.3); }
      c.fill();
    }
    // plons: kring en druppels waar hij erin dook
    c.fillStyle = 'rgba(248,252,253,0.8)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * DOLF;
      if (B[o + 5] < 2) continue;
      const f = B[o + 5] - 2, x = B[o] - B[o + 2] * L * 0.5, y = B[o + 1] - B[o + 3] * L * 0.5;
      for (let q = 0; q < 5; q++) { const u = (q / 5) * TAU + i; stip(c, x + Math.cos(u) * L * 0.5 * (0.4 + f), y + Math.sin(u) * L * 0.3 * (0.4 + f) - L * 0.5 * f * (1 - f) * 2, Math.max(0.6, T * 0.0035 * (1 - f * 0.6))); }
    }
    c.fill();
    c.strokeStyle = 'rgba(240,248,250,0.55)';
    c.lineWidth = Math.max(0.6, T * 0.0025);
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * DOLF; if (B[o + 5] < 2) continue; const f = B[o + 5] - 2; ring(c, B[o] - B[o + 2] * L * 0.5, B[o + 1] - B[o + 3] * L * 0.5, L * (0.3 + 0.8 * f), L * (0.2 + 0.5 * f)); }
    c.stroke();
  }

  // ---------- boten: wedstrijdzeilers, roeiers, kano's, waterfietsen, surfers ----------

  zetBoot(x, y, hx, hy, soort, kleur, extra, vaart) {
    if (this.nBoot >= PLAFOND.boten) return false;
    const sx = x * this.sc + this.ox, sy = y * this.sc + this.oy, m = this.T * 0.15;
    if (sx < -m || sy < -m || sx > this.w + m || sy > this.h + m) return true;
    const o = this.nBoot++ * BOOT, B = this.boot;
    B[o] = sx; B[o + 1] = sy; B[o + 2] = hx; B[o + 3] = hy; B[o + 4] = soort; B[o + 5] = kleur; B[o + 6] = extra; B[o + 7] = vaart;
    return true;
  }

  verzamelBoten() {
    const z = this.zoom, t = this.t, R = this.tl.rivieren;
    // zeilwedstrijd: rondjes om drie boeien, op een wedstrijddag met wind
    if (z > DREMPEL.regatta - 0.5 && this.zomer > 0.25 && this.wd.kracht > 0.15 && this.mens > 0.3) {
      for (const r of this.regattas) {
        if (!this.puntInBeeld(r.x, r.y, 6) || hash(this.dag, r.zaad, 7) > 0.6 || this.vrede(r.ax, r.ay) < 1) continue;
        const v = 0.5 + 0.5 * this.wd.kracht, P = 3 * 4 * Math.sqrt(3); // omtrek van de driehoek (straal 4)
        for (let k = 0; k < r.n; k++) {
          const u = frac((t * v - k * 0.9 - hash(r.zaad, k, 8) * 0.5) / P) * 3, zij = Math.floor(u), f = u - zij;
          const a0 = r.hoek + (zij * TAU) / 3, a1 = r.hoek + ((zij + 1) * TAU) / 3;
          const ax = r.x + Math.cos(a0) * 4, ay = r.y + Math.sin(a0) * 4, bx = r.x + Math.cos(a1) * 4, by = r.y + Math.sin(a1) * 4;
          const l = Math.hypot(bx - ax, by - ay) || 1, opzij = (hash(r.zaad, k, 9) - 0.5) * 0.8;
          this.zetBoot(ax + (bx - ax) * f - ((by - ay) / l) * opzij, ay + (by - ay) * f + ((bx - ax) / l) * opzij, (bx - ax) / l, (by - ay) / l, ZEILER, Math.floor(hash(r.zaad, k, 10) * 4), k, 1);
        }
      }
    }
    if (z > DREMPEL.roei - 0.5 && this.zomer > 0.2) {
      // roeiers en kano's op de rivier: heen en weer over hun stuk
      for (const bn of this.banen) {
        if (!this.puntInBeeld(bn.x, bn.y, 16)) continue;
        const rv = R[bn.ri], L = bn.se - bn.sa, vr = this.vrede(bn.x, bn.y);
        for (let k = 0; k < bn.n; k++) {
          if (hash(bn.zaad, k, this.dag) > this.mens * this.zomer * 1.3 * vr) continue;
          const kano = hash(bn.zaad, k, 11) < 0.5, v = kano ? 0.32 : 0.55, f = t * v / (2 * L) + hash(bn.zaad, k, 12);
          const s = bn.sa + L * tri(f), r = triRichting(f);
          this.langs(rv, s);
          const opzij = (hash(bn.zaad, k, 13) - 0.5) * this.hw * 0.5;
          const x = this.px - this.fy * opzij, y = this.py + this.fx * opzij;
          this.zetBoot(x, y, this.fx * r, this.fy * r, kano ? KANO : SKIFF, Math.floor(hash(bn.zaad, k, 14) * 4), kano ? 1 + (hash(bn.zaad, k, 15) < 0.3) : ROEIERS[Math.floor(hash(bn.zaad, k, 15) * 3)], 1);
        }
      }
      // op de meren: roeien en waterfietsen in een lus
      for (const L of this.lussen) {
        if (!this.puntInBeeld(L.x, L.y, L.rx + 2)) continue;
        if (L.fiets && (z < DREMPEL.waterfiets - 0.5 || this.sz.zomer < 0.3)) continue;
        const n = L.fiets ? 2 + (hash(L.zaad, 1) < 0.5) : L.klein ? 1 : 2, vr = this.vrede(L.x, L.y);
        for (let k = 0; k < n; k++) {
          if (hash(L.zaad, k, this.dag) > this.mens * this.zomer * 1.3 * vr) continue;
          const soort = L.fiets ? WATERFIETS : hash(L.zaad, k, 16) < 0.5 ? KANO : SKIFF;
          const v = soort === WATERFIETS ? 0.15 : soort === KANO ? 0.3 : 0.5, rich = hash(L.zaad, k, 17) < 0.5 ? 1 : -1;
          this.opLus(L, (t * v * rich) / ((L.rx + L.ry) / 2) + hash(L.zaad, k, 18) * TAU);
          this.zetBoot(this.px, this.py, this.fx * rich, this.fy * rich, soort, Math.floor(hash(L.zaad, k, 19) * 4), soort === SKIFF ? RIEMEN[Math.floor(hash(L.zaad, k, 20) * 3)] : 1 + (hash(L.zaad, k, 20) < 0.4), soort === WATERFIETS ? 0.4 : 1);
        }
      }
    }
    // surfers bij golven, kitesurfers bij harde wind
    if (z > DREMPEL.kite - 0.5 && this.wd.kracht > 0.3 && this.sz.koud < 0.85 && this.mens > 0.2) {
      const kite = this.wd.kracht > 0.5 && this.sz.koud < 0.9;
      for (const s of this.surfs) {
        if (!this.puntInBeeld(s.x, s.y, 10)) continue;
        const tx = -s.ny, ty = s.nx, vr = this.vrede(s.x - s.nx * 3, s.y - s.ny * 3);
        if (z > DREMPEL.surf - 0.5) {
          const ns = 2 + Math.floor(hash(s.zaad, 1) * 3);
          for (let k = 0; k < ns; k++) {
            if (hash(s.zaad, k, this.dag) > this.mens * vr) continue;
            const p = frac(t / (22 + hash(s.zaad, k, 2) * 8) + hash(s.zaad, k, 3)), basis = (k - 1) * 1.2;
            this.surfPos(s, basis, p + 0.004); const x2 = this.px, y2 = this.py;
            this.surfPos(s, basis, p);
            let hx = x2 - this.px, hy = y2 - this.py;
            const l = Math.hypot(hx, hy);
            if (l < 1e-5) { hx = -s.nx; hy = -s.ny; } else { hx /= l; hy /= l; }
            const staat = p < 0.45 || p > 0.82 ? 0 : p < 0.65 ? 1 : 2;
            this.zetBoot(this.px, this.py, staat === 1 ? -s.nx : hx, staat === 1 ? -s.ny : hy, SURFER, Math.floor(hash(s.zaad, k, 4) * 4), staat, staat === 2 ? 1 : staat === 0 ? 0.25 : 0);
            this.n.surfers++;
          }
        }
        if (kite && vr === 1) {
          const nk = 1 + (hash(s.zaad, 5) < 0.5);
          for (let k = 0; k < nk && this.nKite < PLAFOND.kites; k++) {
            const f = t / (34 + k * 9) + hash(s.zaad, k, 6), rich = triRichting(f);
            const u = -1 + 5.4 * tri(f), d = 3.4 + 0.9 * Math.sin(t * 0.13 + k);
            const x = s.x + tx * u + s.nx * d, y = s.y + ty * u + s.ny * d;
            if (!this.zetBoot(x, y, tx * rich, ty * rich, KITER, Math.floor(hash(s.zaad, k, 7) * 4), k, 1)) continue;
            // de kite hangt benedenwinds van de rijder, op hoogte, en zwaait langzaam heen en weer
            const zw = Math.sin(t * 0.45 + k * 2) * 1.3, kx = x + this.wx * 2.6 - this.wy * zw, ky = y + this.wy * 2.6 + this.wx * zw;
            const o = this.nKite++ * 6, K = this.kites;
            K[o] = x; K[o + 1] = y; K[o + 2] = kx; K[o + 3] = ky; K[o + 4] = Math.floor(hash(s.zaad, k, 8) * KITE.length); K[o + 5] = zw;
          }
        }
      }
    }
    this.n.boten = this.nBoot;
    this.n.kites = this.nKite;
  }

  // Surfer op fase q van zijn ronde: uitpeddelen, wachten op een golf, de golf nemen, terugpeddelen langs de kant.
  surfPos(s, basis, q) {
    const d = 1.3 + 3.3 * smooth(0, 0.45, q) - 3.3 * smooth(0.65, 0.82, q);
    const u = basis + 2.6 * smooth(0.65, 0.82, q) - 2.6 * smooth(0.82, 1, q);
    this.px = s.x - s.ny * u + s.nx * d; this.py = s.y + s.nx * u + s.ny * d;
  }

  tekenBoten(c, a) {
    const B = this.boot, n = this.nBoot, T = this.T, t = this.t, z = this.zoom;
    if (!n) { this.tekenBoeien(c, a); return; }
    c.globalAlpha = a;
    // kielzog: een waaier van schuim achter alles wat vaart
    c.fillStyle = 'rgba(232,244,250,0.26)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT, v = B[o + 7];
      if (v < 0.05) continue;
      const m = BOOT_MAAT[B[o + 4]], L = T * m[0], Bw = T * m[1] + 0.3, wl = L * (1.4 + 1.6 * v), ww = L * 0.75 + Bw;
      const hx = B[o + 2], hy = B[o + 3], sx = B[o] - hx * L * 0.7, sy = B[o + 1] - hy * L * 0.7;
      c.moveTo(sx - hy * Bw, sy + hx * Bw); c.lineTo(sx - hx * wl - hy * ww, sy - hy * wl + hx * ww); c.lineTo(sx - hx * wl + hy * ww, sy - hy * wl - hx * ww); c.lineTo(sx + hy * Bw, sy - hx * Bw); c.closePath();
    }
    c.fill();
    if (z >= DREMPEL.roei) {
      c.strokeStyle = 'rgba(246,250,252,0.5)';
      c.lineWidth = Math.max(0.5, T * 0.0025);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const o = i * BOOT, v = B[o + 7];
        if (v < 0.05) continue;
        const m = BOOT_MAAT[B[o + 4]], L = T * m[0], Bw = T * m[1], wl = L * (1.6 + 1.6 * v);
        const hx = B[o + 2], hy = B[o + 3], sx = B[o] + hx * L * 0.7, sy = B[o + 1] + hy * L * 0.7;
        for (let k = 1; k >= -1; k -= 2) {
          const ww = L * (0.85 + 0.08 * Math.sin(t * 3.8 + i + k)) + Bw;
          c.moveTo(sx - hy * k * Bw, sy + hx * k * Bw); c.lineTo(sx - hx * wl - hy * k * ww, sy - hy * wl + hx * k * ww);
        }
      }
      c.stroke();
    }
    // schaduw van de rompen (en de zeilen) naar het zuidoosten
    c.fillStyle = 'rgba(0,18,30,0.28)';
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * BOOT, m = BOOT_MAAT[B[o + 4]]; ovaal(c, B[o] + T * 0.004, B[o + 1] + T * 0.005, B[o + 2], B[o + 3], T * m[0], T * m[1]); }
    c.fill();
    c.fillStyle = 'rgba(0,18,30,0.14)';
    c.beginPath();
    for (let i = 0; i < n; i++) if (B[i * BOOT + 4] === ZEILER) this.zeil(c, i * BOOT, T * 0.018, T * 0.024);
    c.fill();
    // rompen per soort en kleur
    for (let soort = 0; soort <= KITER; soort++) {
      const kleuren = soort === ZEILER ? ROMP : soort === SKIFF ? ROMP : soort === KANO ? KANO_K : soort === WATERFIETS ? FIETSBOOT : BORD;
      for (let k = 0; k < 4; k++) {
        let open = false;
        for (let i = 0; i < n; i++) {
          const o = i * BOOT;
          if (B[o + 4] !== soort || B[o + 5] !== k) continue;
          if (!open) { c.beginPath(); open = true; }
          const m = BOOT_MAAT[soort];
          if (soort === WATERFIETS) rechthoek(c, B[o], B[o + 1], B[o + 2], B[o + 3], T * m[0], T * m[1]);
          else ovaal(c, B[o], B[o + 1], B[o + 2], B[o + 3], T * m[0], T * m[1]);
        }
        if (open) { c.fillStyle = soort === SKIFF ? (k < 2 ? '#e6dfcf' : '#d6c08a') : kleuren[k]; c.fill(); }
      }
    }
    if (z > DREMPEL.roei - 0.5) this.bootDetail(c, n);
    // zeilen: hellend naar de lijzijde, in wedstrijdkleuren
    for (let k = 0; k < 4; k++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * BOOT;
        if (B[o + 4] !== ZEILER || B[o + 5] !== k) continue;
        if (!open) { c.beginPath(); open = true; }
        this.zeil(c, o, 0, 0);
      }
      if (open) { c.fillStyle = ZEIL[k + 1]; c.fill(); }
    }
    c.strokeStyle = 'rgba(40,50,60,0.35)';
    c.lineWidth = Math.max(0.5, T * 0.0025);
    c.beginPath();
    for (let i = 0; i < n; i++) if (B[i * BOOT + 4] === ZEILER) this.zeil(c, i * BOOT, 0, 0);
    c.stroke();
    this.tekenBoeien(c, a);
  }

  // Zeil van een wedstrijdjol: zwaait naar de lijzijde en helt verder over naarmate het harder waait.
  zeil(c, o, dx, dy) {
    const B = this.boot, T = this.T, x = B[o] + dx, y = B[o + 1] + dy, hx = B[o + 2], hy = B[o + 3], kr = this.wd.kracht;
    const zk = hx * this.wy - hy * this.wx, kant = zk >= 0 ? 1 : -1, lx = -hy * kant, ly = hx * kant;
    const mx = x + hx * T * 0.008, my = y + hy * T * 0.008, top = T * (0.008 + 0.02 * kr), giek = T * (0.009 + 0.016 * kr);
    const ex = mx - hx * T * 0.03 + lx * giek, ey = my - hy * T * 0.03 + ly * giek;
    c.moveTo(mx, my);
    c.lineTo(mx + lx * top, my + ly * top - T * 0.012);
    c.quadraticCurveTo(mx - hx * T * 0.012 + lx * (top + giek) * 0.9, my - hy * T * 0.012 + ly * (top + giek) * 0.9 - T * 0.006, ex, ey);
    c.closePath();
  }

  // Wie er in de boot zit en wat de riemen en peddels doen (vanaf zoom 8).
  bootDetail(c, n) {
    const B = this.boot, T = this.T, t = this.t;
    const kop = Math.max(0.6, T * 0.0042);
    // riemen en peddels
    c.strokeStyle = 'rgba(70,52,34,0.85)';
    c.lineWidth = Math.max(0.5, T * 0.0018);
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT, s = B[o + 4], x = B[o], y = B[o + 1], hx = B[o + 2], hy = B[o + 3], px = -hy, py = hx;
      if (s === SKIFF) {
        const nr = B[o + 6], L = T * BOOT_MAAT[SKIFF][0], slag = Math.sin(t * 4.2 + i), rl = T * 0.024;
        for (let r = 0; r < nr; r++) {
          const u = nr === 1 ? 0 : (r / (nr - 1) - 0.5) * L * 1.1, bx = x + hx * u, by = y + hy * u;
          for (let k = -1; k <= 1; k += 2) { c.moveTo(bx, by); c.lineTo(bx + px * k * rl + hx * slag * rl * 0.5, by + py * k * rl + hy * slag * rl * 0.5); }
        }
      } else if (s === KANO) {
        const nr = B[o + 6], hoek = Math.sin(t * 3 + i) * 0.6, co = Math.cos(hoek), si = Math.sin(hoek), pl = T * 0.012;
        const qx = px * co + hx * si, qy = py * co + hy * si;
        for (let r = 0; r < nr; r++) { const u = nr === 1 ? 0 : (r - 0.5) * T * 0.014, bx = x + hx * u, by = y + hy * u; c.moveTo(bx - qx * pl, by - qy * pl); c.lineTo(bx + qx * pl, by + qy * pl); }
      }
    }
    c.stroke();
    // bladen van de peddels en spatjes waar riemen het water raken
    c.fillStyle = 'rgba(245,250,252,0.7)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT, s = B[o + 4];
      if (s !== SKIFF && s !== KANO) continue;
      const fase = s === SKIFF ? Math.sin(t * 4.2 + i) : Math.sin(t * 3 + i);
      if (fase > -0.6) continue;
      const x = B[o], y = B[o + 1], px = -B[o + 3], py = B[o + 2], d = s === SKIFF ? T * 0.024 : T * 0.012;
      stip(c, x + px * d, y + py * d, Math.max(0.5, T * 0.002)); stip(c, x - px * d, y - py * d, Math.max(0.5, T * 0.002));
    }
    c.fill();
    // kap van de waterfiets en het bruiswater achter de schoepen
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * BOOT; if (B[o + 4] === WATERFIETS) rechthoek(c, B[o] - B[o + 2] * T * 0.004 - T * 0.001, B[o + 1] - B[o + 3] * T * 0.004 - T * 0.001, B[o + 2], B[o + 3], T * 0.008, T * 0.008); }
    c.fill();
    // mensen: hoofden (en bij surfers en kiters het lijf)
    for (let h = 0; h < HUID.length; h++) {
      c.fillStyle = HUID[h];
      c.beginPath();
      let iets = false;
      for (let i = 0; i < n; i++) {
        const o = i * BOOT, s = B[o + 4];
        if ((B[o + 5] + B[o + 4] + B[o + 6]) % 3 !== h) continue;
        const x = B[o], y = B[o + 1], hx = B[o + 2], hy = B[o + 3];
        iets = true;
        if (s === SKIFF) { const nr = B[o + 6], L = T * BOOT_MAAT[SKIFF][0]; for (let r = 0; r < nr; r++) { const u = nr === 1 ? 0 : (r / (nr - 1) - 0.5) * L * 1.1; stip(c, x + hx * u, y + hy * u, kop); } }
        else if (s === KANO) { for (let r = 0; r < B[o + 6]; r++) { const u = B[o + 6] === 1 ? 0 : (r - 0.5) * T * 0.014; stip(c, x + hx * u, y + hy * u, kop); } }
        else if (s === WATERFIETS) { const px = -hy, py = hx; stip(c, x + px * T * 0.005, y + py * T * 0.005, kop); stip(c, x - px * T * 0.005, y - py * T * 0.005, kop); }
        else if (s === ZEILER) stip(c, x - hx * T * 0.018 - hy * T * 0.004, y - hy * T * 0.018 + hx * T * 0.004, kop * 0.9);
        else if (s === SURFER) { const st = B[o + 6]; stip(c, x + hx * T * (st === 0 ? 0.006 : 0.002), y + hy * T * (st === 0 ? 0.006 : 0.002) - (st === 2 ? T * 0.006 : 0), kop); }
        else stip(c, x, y - T * 0.006, kop);
      }
      if (iets) c.fill();
    }
    // wetsuits en zwemvesten
    c.fillStyle = '#20262c';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT, s = B[o + 4];
      if (s !== SURFER && s !== KITER) continue;
      const x = B[o], y = B[o + 1], hx = B[o + 2], hy = B[o + 3], st = B[o + 6];
      if (s === SURFER && st === 0) ovaal(c, x - hx * T * 0.002, y - hy * T * 0.002, hx, hy, T * 0.006, T * 0.0028);
      else { const px = -hy, py = hx; ovaal(c, x, y - (s === KITER || st === 2 ? T * 0.003 : 0), px, py, T * 0.004, T * 0.0026); }
    }
    c.fill();
    // spray van surfers die een golf nemen en kiters die vaart maken
    c.fillStyle = 'rgba(250,252,253,0.75)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * BOOT, s = B[o + 4];
      if (!((s === SURFER && B[o + 6] === 2) || s === KITER)) continue;
      const x = B[o] - B[o + 2] * T * 0.012, y = B[o + 1] - B[o + 3] * T * 0.012;
      for (let q = 0; q < 3; q++) stip(c, x + Math.sin(t * 9 + q * 2 + i) * T * 0.004, y + Math.cos(t * 7 + q) * T * 0.003, Math.max(0.5, T * 0.0025));
    }
    c.fill();
  }

  // Boeien van de wedstrijdbaan: geel, met een schaduw en een kringetje.
  tekenBoeien(c, a) {
    if (this.zoom < DREMPEL.roei - 0.5 || !(this.zomer > 0.25 && this.wd.kracht > 0.15 && this.mens > 0.3)) return;
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T;
    let n = 0;
    c.globalAlpha = a;
    for (const r of this.regattas) {
      if (!this.puntInBeeld(r.x, r.y, 6) || hash(this.dag, r.zaad, 7) > 0.6 || this.vrede(r.ax, r.ay) < 1) continue;
      for (let k = 0; k < 3 && n < PLAFOND.boeien; k++, n++) {
        const u = r.hoek + (k * TAU) / 3, x = (r.x + Math.cos(u) * 4) * sc + ox, y = (r.y + Math.sin(u) * 4) * sc + oy, rr = Math.max(0.8, T * 0.0045);
        c.fillStyle = 'rgba(0,18,30,0.25)'; c.beginPath(); stip(c, x + rr * 0.8, y + rr, rr); c.fill();
        c.fillStyle = '#f0c23a'; c.beginPath(); stip(c, x, y, rr); c.fill();
        c.fillStyle = 'rgba(255,255,240,0.6)'; c.beginPath(); stip(c, x - rr * 0.35, y - rr * 0.35, rr * 0.4); c.fill();
      }
    }
    this.n.boeien = n;
  }

  // ---------- steigers, zwemsteiger en hengelaars ----------

  tekenSteigers(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, z = this.zoom;
    let n = 0;
    c.globalAlpha = a;
    for (const o of this.oevers) {
      if (!o.steiger || n >= PLAFOND.steigers || !this.puntInBeeld(o.x, o.y, 3)) continue;
      n++;
      const ax = o.bx * sc + ox, ay = o.by * sc + oy, bx = o.x * sc + ox, by = o.y * sc + oy, mx = (ax + bx) / 2, my = (ay + by) / 2;
      const l = Math.hypot(bx - ax, by - ay) / 2, hx = o.wx, hy = o.wy, bw = T * 0.012, h = T * 0.004;
      c.fillStyle = 'rgba(0,18,30,0.3)'; c.beginPath(); rechthoek(c, mx + h * SCHUIN * 2, my + h * SCHUIN * 2, hx, hy, l, bw); c.fill();
      c.fillStyle = '#8a6a44'; c.beginPath(); rechthoek(c, mx, my, hx, hy, l, bw); c.fill();
      if (z > DREMPEL.fijn - 1) {
        // planken en palen
        c.strokeStyle = 'rgba(60,44,28,0.55)'; c.lineWidth = Math.max(0.4, T * 0.0008); c.beginPath();
        const np = Math.max(3, Math.floor(l / (T * 0.006)));
        for (let q = 1; q < np; q++) { const u = -l + (2 * l * q) / np, px = mx + hx * u, py = my + hy * u; c.moveTo(px - hy * bw, py + hx * bw); c.lineTo(px + hy * bw, py - hx * bw); }
        c.stroke();
        c.fillStyle = '#4e3a26'; c.beginPath();
        for (const u of PALEN) for (const k of KANTEN) stip(c, mx + hx * u * l - hy * k * bw, my + hy * u * l + hx * k * bw, Math.max(0.5, T * 0.002));
        c.fill();
        c.fillStyle = 'rgba(255,240,210,0.18)'; c.beginPath(); rechthoek(c, mx - hy * bw * 0.5, my + hx * bw * 0.5 - h * 0.3, hx, hy, l, bw * 0.35); c.fill();
      }
    }
    this.n.steigers = n;
  }

  tekenZwemsteigers(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, t = this.t, z = this.zoom;
    let n = 0, nz = 0;
    c.globalAlpha = a;
    for (const p of this.zwemsteigers) {
      if (n >= PLAFOND.zwemsteigers || !this.puntInBeeld(p.x, p.y, 3)) continue;
      n++;
      const x = p.x * sc + ox, y = p.y * sc + oy, s = T * 0.028, bob = Math.sin(t * 1.3 + p.zaad) * T * 0.0008;
      c.strokeStyle = 'rgba(240,248,250,0.45)'; c.lineWidth = Math.max(0.5, T * 0.002); c.beginPath(); c.rect(x - s * 1.08, y - s * 1.08 + bob, s * 2.16, s * 2.16); c.stroke();
      c.fillStyle = 'rgba(0,18,30,0.3)'; c.fillRect(x - s + T * 0.004, y - s + T * 0.005, s * 2, s * 2);
      c.fillStyle = '#9a7a52'; c.fillRect(x - s, y - s + bob, s * 2, s * 2);
      c.fillStyle = 'rgba(255,240,210,0.2)'; c.fillRect(x - s, y - s + bob, s * 2, s * 0.4);
      c.strokeStyle = 'rgba(60,44,28,0.5)'; c.lineWidth = Math.max(0.4, T * 0.0008); c.beginPath();
      for (let q = 1; q < 6; q++) { c.moveTo(x - s, y - s + (2 * s * q) / 6 + bob); c.lineTo(x + s, y - s + (2 * s * q) / 6 + bob); }
      c.stroke();
      // trapje aan de zuidkant
      c.strokeStyle = '#c8ccd0'; c.lineWidth = Math.max(0.5, T * 0.0012); c.beginPath(); c.moveTo(x - s * 0.2, y + s + bob); c.lineTo(x - s * 0.2, y + s * 1.25 + bob); c.moveTo(x + s * 0.2, y + s + bob); c.lineTo(x + s * 0.2, y + s * 1.25 + bob); c.stroke();
      if (z < DREMPEL.mens - 0.5 || this.mens * this.sz.zomer * this.vrede(p.x, p.y) < 0.15) continue;
      // iemand die er vanaf duikt (boog en plons), zwemmers eromheen, iemand die in de zon zit
      const pd = frac(t / 7 + hash(p.zaad, 1));
      const kop = Math.max(0.6, T * 0.0042);
      c.fillStyle = HUID[Math.floor(hash(p.zaad, 2) * 3)];
      c.beginPath();
      stip(c, x + s * 0.6, y - s * 0.5 + bob, kop);
      if (pd < 0.25) { const f = pd / 0.25; stip(c, x + s + f * s * 1.2, y - s * 0.2 - Math.sin(f * Math.PI) * T * 0.016, kop); }
      for (let q = 0; q < 3 && nz < PLAFOND.zwemmers; q++, nz++) { const u = t * 0.15 + q * 2.1 + p.zaad; stip(c, x + Math.cos(u) * s * 2.2, y + Math.sin(u) * s * 1.6, kop * 0.9); }
      c.fill();
      c.fillStyle = KLEDING[Math.floor(hash(p.zaad, 3) * KLEDING.length)]; c.beginPath(); stip(c, x + s * 0.6, y - s * 0.5 + kop * 1.6 + bob, kop * 1.1); c.fill();
      c.strokeStyle = 'rgba(240,248,252,0.55)'; c.lineWidth = Math.max(0.5, T * 0.0015); c.beginPath();
      for (let q = 0; q < 3; q++) { const u = t * 0.15 + q * 2.1 + p.zaad; ring(c, x + Math.cos(u) * s * 2.2, y + Math.sin(u) * s * 1.6, kop * 2.2, kop * 1.6); }
      if (pd >= 0.25 && pd < 0.55) { const f = (pd - 0.25) / 0.3; ring(c, x + s * 2.2, y - s * 0.2, kop * (1 + 5 * f), kop * (0.7 + 3.5 * f)); }
      c.stroke();
    }
    this.n.zwemsteigers = n; this.n.zwemmers = nz;
  }

  tekenHengelaars(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, t = this.t, z = this.zoom;
    let n = 0;
    c.globalAlpha = a;
    const kop = Math.max(0.6, T * 0.0045), fijn = z >= DREMPEL.fijn;
    for (const o of this.oevers) {
      if (n >= PLAFOND.hengelaars || !this.puntInBeeld(o.x, o.y, 3)) continue;
      // in de winter zit niemand aan de kant (op het ijs zitten de ijsvissers); 's nachts en bij regen minder
      if (this.ijs > 0.3 || hash(o.zaad, this.dag, 1) > this.mens * (0.55 + 0.4 * this.zomer) * this.vrede(o.x, o.y)) continue;
      n++;
      const x = o.x * sc + ox, y = o.y * sc + oy, hx = o.wx, hy = o.wy, px = -hy, py = hx;
      const cyc = frac(t / 14 + hash(o.zaad, 2)), beet = cyc > 0.82 && cyc < 0.9;
      const fx = o.fx * sc + ox, fy = o.fy * sc + oy, Hh = T * 0.02 * (beet ? 0.75 : 1);
      const tipx = x + hx * T * 0.028 + px * T * 0.004, tipy = y + hy * T * 0.028 + py * T * 0.004 - Hh;
      // schaduw van mens en hengel
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); stip(c, x + kop * 0.9, y + kop * 1.1, kop * 1.4); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = Math.max(0.4, T * 0.001); c.beginPath(); c.moveTo(x, y); c.lineTo(tipx + Hh * SCHUIN, tipy + Hh + Hh * SCHUIN); c.stroke();
      // parapluutje bij sommigen (vaker bij regen)
      if (hash(o.zaad, 3) < 0.25 + this.wr.regen) {
        c.fillStyle = '#3d5a3a'; c.beginPath(); stip(c, x - hx * T * 0.008 - T * 0.003, y - hy * T * 0.008 - T * 0.006, T * 0.016); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); stip(c, x - hx * T * 0.008 - T * 0.008, y - hy * T * 0.008 - T * 0.011, T * 0.007); c.fill();
      }
      // krukje, jas, hoofd met pet
      c.fillStyle = KLEDING[Math.floor(hash(o.zaad, 4) * KLEDING.length)]; c.beginPath(); ovaal(c, x, y, px, py, kop * 1.4, kop * 0.9); c.fill();
      c.fillStyle = HUID[Math.floor(hash(o.zaad, 5) * 3)]; c.beginPath(); stip(c, x + hx * kop * 0.4, y + hy * kop * 0.4 - kop * 0.5, kop); c.fill();
      if (fijn) { c.fillStyle = '#4a4a3a'; c.beginPath(); stip(c, x + hx * kop * 0.2, y + hy * kop * 0.2 - kop * 0.8, kop * 0.7); c.fill(); }
      // hengel (buigt bij een beet) en lijn naar de dobber
      c.strokeStyle = '#2a2a2a'; c.lineWidth = Math.max(0.5, T * 0.0013); c.beginPath(); c.moveTo(x + hx * kop, y + hy * kop - kop * 0.3);
      c.quadraticCurveTo(x + hx * T * 0.018, y + hy * T * 0.018 - Hh * (beet ? 1.05 : 0.8), tipx, tipy); c.stroke();
      if (fijn) {
        c.strokeStyle = 'rgba(230,230,230,0.5)'; c.lineWidth = Math.max(0.3, T * 0.0005); c.beginPath(); c.moveTo(tipx, tipy); c.quadraticCurveTo((tipx + fx) / 2, (tipy + fy) / 2 + Hh * 0.3, fx, fy); c.stroke();
        // dobber: rood met een wit kraagje, deint; bij een beet duikt hij onder en komt er een kring
        if (!beet) { c.fillStyle = '#d23a2a'; c.beginPath(); stip(c, fx, fy + Math.sin(t * 2 + o.zaad) * T * 0.0006, Math.max(0.6, T * 0.0018)); c.fill(); }
        c.strokeStyle = 'rgba(240,248,252,0.55)'; c.lineWidth = Math.max(0.4, T * 0.0008); c.beginPath(); const rk = T * (0.003 + (beet ? 0.012 * (cyc - 0.82) / 0.08 : 0.001)); ring(c, fx, fy, rk, rk * 0.7); c.stroke();
      }
    }
    this.n.hengelaars = n;
  }

  // ---------- het ijs: schaatsers, ijsvissers, kinderen, een tentje met warme drank ----------

  tekenIjs(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, t = this.t, z = this.zoom;
    const mens = this.mens, kop = Math.max(0.6, T * 0.0042);
    c.globalAlpha = a;
    // geschaatste banen: lichte krassen in het ijs
    c.strokeStyle = 'rgba(255,255,255,0.32)';
    c.lineWidth = Math.max(0.6, T * 0.004);
    c.beginPath();
    for (const L of this.lussen) {
      if (L.fiets || !this.puntInBeeld(L.x, L.y, L.rx + 2)) continue;
      for (const e of SPOREN) { c.moveTo(L.x * sc + ox + Math.cos(L.hoek) * (L.rx + e) * sc, L.y * sc + oy + Math.sin(L.hoek) * (L.rx + e) * sc); c.ellipse(L.x * sc + ox, L.y * sc + oy, (L.rx + e) * sc, (L.ry + e) * sc, L.hoek, 0, TAU); }
    }
    c.stroke();
    // schaatsers: lange halen, handen op de rug; ze zwaaien licht heen en weer bij elke slag
    let ns = 0;
    const B = this.schaats, SP = 6; // X, Y, hx, hy, kleding, slag
    for (const L of this.lussen) {
      if (L.fiets || !this.puntInBeeld(L.x, L.y, L.rx + 2)) continue;
      const aantal = L.klein ? 3 : 5 + Math.floor(hash(L.zaad, 3) * 5), vr = this.vrede(L.x, L.y);
      for (let k = 0; k < aantal && ns < PLAFOND.schaatsers; k++) {
        if (hash(L.zaad, k, this.dag) > mens * 1.2 * vr) continue;
        const v = 1 + hash(L.zaad, k, 4) * 0.7, rich = L.klein && hash(L.zaad, 5) < 0.5 ? -1 : 1;
        this.opLus(L, (t * v * rich) / ((L.rx + L.ry) / 2) + hash(L.zaad, k, 6) * TAU, (hash(L.zaad, k, 7) - 0.5) * 0.8);
        const slag = Math.sin(t * 2.4 * v + k), x = (this.px - this.fy * slag * 0.12) * sc + ox, y = (this.py + this.fx * slag * 0.12) * sc + oy;
        const o = ns * SP;
        B[o] = x; B[o + 1] = y; B[o + 2] = this.fx * rich; B[o + 3] = this.fy * rich; B[o + 4] = Math.floor(hash(L.zaad, k, 8) * KLEDING.length); B[o + 5] = slag;
        ns++;
      }
    }
    this.n.schaatsers = ns;
    if (ns) {
      c.fillStyle = 'rgba(40,60,80,0.22)';
      c.beginPath();
      for (let i = 0; i < ns; i++) { const o = i * SP; ovaal(c, B[o] + kop * 1.4, B[o + 1] + kop * 1.6, B[o + 2], B[o + 3], kop * 1.6, kop * 0.9); }
      c.fill();
      if (z >= DREMPEL.mens) {
        // benen: de ene haal links, de andere rechts
        c.strokeStyle = '#2a2a30'; c.lineWidth = Math.max(0.5, kop * 0.45); c.beginPath();
        for (let i = 0; i < ns; i++) { const o = i * SP, x = B[o], y = B[o + 1], hx = B[o + 2], hy = B[o + 3], s = B[o + 5]; for (const k of KANTEN) { const d = (0.6 + 0.6 * k * s) * kop; c.moveTo(x, y); c.lineTo(x - hx * kop * 1.4 - hy * k * d, y - hy * kop * 1.4 + hx * k * d); } }
        c.stroke();
      }
      for (let k = 0; k < KLEDING.length; k++) {
        let open = false;
        for (let i = 0; i < ns; i++) {
          const o = i * SP;
          if (B[o + 4] !== k) continue;
          if (!open) { c.beginPath(); open = true; }
          ovaal(c, B[o], B[o + 1], -B[o + 3], B[o + 2], kop * 1.25, kop * 0.75);
        }
        if (open) { c.fillStyle = KLEDING[k]; c.fill(); }
      }
      c.fillStyle = '#e8c3a0'; c.beginPath();
      for (let i = 0; i < ns; i++) { const o = i * SP; stip(c, B[o] + B[o + 2] * kop * 0.4, B[o + 1] + B[o + 3] * kop * 0.4 - kop * 0.3, kop * 0.75); }
      c.fill();
      if (z >= DREMPEL.fijn) {
        // mutsen
        c.fillStyle = '#b8322a'; c.beginPath();
        for (let i = 0; i < ns; i += 2) { const o = i * SP; stip(c, B[o] + B[o + 2] * kop * 0.3, B[o + 1] + B[o + 3] * kop * 0.3 - kop * 0.55, kop * 0.5); }
        c.fill();
      }
    }
    // ijsvissers, kinderen en het tentje
    let ni = 0, nk = 0, nt = 0;
    for (const p of this.ijsPlekken) {
      if (!this.puntInBeeld(p.x, p.y, 3)) continue;
      const mens = this.mens * this.vrede(p.x, p.y);
      const x = p.x * sc + ox, y = p.y * sc + oy, soort = p.kant ? (hash(p.zaad, 1) < 0.45 && nt < PLAFOND.tentjes ? 2 : 1) : 0;
      if (soort === 0 && z > DREMPEL.ijsvis - 0.5 && ni < PLAFOND.ijsvissers) {
        // tentje met een wak ernaast en iemand op een krukje met een korte hengel
        ni++;
        const s = T * 0.011, kl = TENT[Math.floor(hash(p.zaad, 2) * TENT.length)], wx = x + s * 2.2, wy = y + s * 0.6;
        c.fillStyle = 'rgba(40,60,80,0.25)'; c.beginPath(); c.moveTo(x - s, y + s); c.lineTo(x + s, y + s); c.lineTo(x + s + s * 1.4, y + s * 1.6); c.lineTo(x - s + s * 1.4, y + s * 1.6); c.closePath(); c.fill();
        c.fillStyle = kl; c.beginPath(); c.moveTo(x - s, y + s); c.lineTo(x, y - s * 0.9); c.lineTo(x + s, y + s); c.closePath(); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.moveTo(x, y - s * 0.9); c.lineTo(x + s, y + s); c.lineTo(x + s * 0.2, y + s); c.closePath(); c.fill();
        c.fillStyle = '#16303e'; c.beginPath(); ovaal(c, wx, wy, 1, 0, s * 0.5, s * 0.36); c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = Math.max(0.5, T * 0.0012); c.beginPath(); ovaal(c, wx, wy, 1, 0, s * 0.62, s * 0.46); c.stroke();
        if (z > DREMPEL.mens - 0.5 && hash(p.zaad, this.dag, 3) < mens) {
          c.fillStyle = KLEDING[Math.floor(hash(p.zaad, 4) * KLEDING.length)]; c.beginPath(); stip(c, wx + s * 0.4, wy - s * 0.9, kop * 1.2); c.fill();
          c.fillStyle = '#e8c3a0'; c.beginPath(); stip(c, wx + s * 0.4, wy - s * 0.9 - kop, kop * 0.75); c.fill();
          c.strokeStyle = '#2a2a2a'; c.lineWidth = Math.max(0.4, T * 0.001); c.beginPath(); c.moveTo(wx + s * 0.3, wy - s * 0.8); c.lineTo(wx, wy - s * 0.4); c.lineTo(wx, wy); c.stroke();
        }
      } else if (soort === 2 && z > DREMPEL.ijsvis - 0.5) {
        // tentje met warme drank: gestreepte luifel, een tafel, een pan die dampt, mensen eromheen
        nt++;
        const s = T * 0.018, hx = -p.ox, hy = -p.oy, px = -hy, py = hx;
        c.fillStyle = 'rgba(40,60,80,0.25)'; c.beginPath(); rechthoek(c, x + s * 0.5, y + s * 0.6, px, py, s, s * 0.6); c.fill();
        for (let q = 0; q < 4; q++) {
          const u = -s + (q + 0.5) * (s / 2);
          c.fillStyle = q % 2 ? '#f2ead8' : '#c8532e'; c.beginPath(); rechthoek(c, x + px * u, y + py * u - s * 0.3, px, py, s / 4, s * 0.55); c.fill();
        }
        c.fillStyle = 'rgba(0,0,0,0.18)'; c.beginPath(); rechthoek(c, x + hx * s * 0.3, y + hy * s * 0.3 - s * 0.05, px, py, s, s * 0.12); c.fill();
        c.fillStyle = '#7a5a3a'; c.beginPath(); rechthoek(c, x + hx * s * 0.75, y + hy * s * 0.75, px, py, s * 0.8, s * 0.18); c.fill();
        c.fillStyle = '#3a3a3a'; c.beginPath(); stip(c, x + hx * s * 0.75 - px * s * 0.4, y + hy * s * 0.75 - py * s * 0.4, s * 0.12); c.fill();
        // damp uit de pan, met de wind mee
        c.fillStyle = 'rgba(250,250,250,0.5)'; c.beginPath();
        for (let q = 0; q < 4; q++) { const f = frac(t * 0.4 + q * 0.25); stip(c, x + hx * s * 0.75 - px * s * 0.4 + this.wx * f * s * 1.2, y + hy * s * 0.75 - py * s * 0.4 - f * s * 1.4 + this.wy * f * s * 0.6, s * (0.08 + 0.18 * f)); }
        c.fill();
        if (z > DREMPEL.mens - 0.5) {
          const nm = Math.floor(2 + mens * 3);
          for (let q = 0; q < nm; q++) {
            const u = (q - (nm - 1) / 2) * s * 0.55 + Math.sin(t * 0.3 + q) * s * 0.06, mx = x + hx * s * 1.4 + px * u, my = y + hy * s * 1.4 + py * u;
            c.fillStyle = KLEDING[Math.floor(hash(p.zaad, q, 5) * KLEDING.length)]; c.beginPath(); stip(c, mx, my, kop * 1.2); c.fill();
            c.fillStyle = '#e8c3a0'; c.beginPath(); stip(c, mx - hx * kop * 0.3, my - hy * kop * 0.3 - kop * 0.5, kop * 0.75); c.fill();
          }
        }
      } else if (soort === 1 && z > DREMPEL.kind - 0.5 && nk < PLAFOND.kinderen) {
        // kinderen die een aanloop nemen en dan glijden, armen wijd
        const hx = -p.oy, hy = p.ox;
        for (let q = 0; q < 3 && nk < PLAFOND.kinderen; q++) {
          if (hash(p.zaad, q, this.dag) > mens) continue;
          nk++;
          const f = frac(t / (4 + q) + hash(p.zaad, q, 6)), glij = f > 0.45, u = (f < 0.45 ? f / 0.45 : 1 - (f - 0.45) / 0.55) * T * 0.05 - T * 0.025;
          const kx = x + hx * u + hy * q * T * 0.01, ky = y + hy * u - hx * q * T * 0.01;
          c.fillStyle = 'rgba(40,60,80,0.22)'; c.beginPath(); stip(c, kx + kop * 0.8, ky + kop, kop); c.fill();
          c.fillStyle = KLEDING[Math.floor(hash(p.zaad, q, 7) * KLEDING.length)]; c.beginPath(); stip(c, kx, ky, kop * 0.95); c.fill();
          if (glij) { c.strokeStyle = c.fillStyle; c.lineWidth = Math.max(0.4, kop * 0.4); c.beginPath(); c.moveTo(kx - hy * kop * 1.8, ky + hx * kop * 1.8); c.lineTo(kx + hy * kop * 1.8, ky - hx * kop * 1.8); c.stroke(); }
          c.fillStyle = '#e8c3a0'; c.beginPath(); stip(c, kx, ky - kop * 0.5, kop * 0.6); c.fill();
        }
      }
    }
    this.n.ijsvissers = ni; this.n.kinderen = nk; this.n.tentjes = nt;
  }

  // ---------- krabben op het strand ----------

  tekenKrabben(c, a) {
    if (this.sz.koud > 0.8 || this.wr.regen > 0.5) return;
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, t = this.t;
    const L = this.krabben, r = Math.max(0.6, T * 0.0045);
    let n = 0;
    c.globalAlpha = a;
    const B = this.krab, KP = 5; // X, Y, hx, hy, pootjes
    for (let i = 0; i < L.length && n < PLAFOND.krabben; i++) {
      const k = L[i];
      if (!this.puntInBeeld(k.x, k.y, 1)) continue;
      for (let q = 0; q < 2 && n < PLAFOND.krabben; q++) {
        // zijwaarts heen en weer, met stilstaan tussendoor
        const f = t / (6 + q * 2) + hash(k.zaad, q, 1), u = (smooth(0.1, 0.4, tri(f)) - 0.5) * 0.7, opzij = (hash(k.zaad, q, 2) - 0.5) * 0.8;
        const o = n * KP;
        B[o] = (k.x + k.hx * u - k.hy * opzij) * sc + ox; B[o + 1] = (k.y + k.hy * u + k.hx * opzij) * sc + oy; B[o + 2] = k.hx; B[o + 3] = k.hy;
        B[o + 4] = Math.sin(t * 14 + q + i) * (Math.abs(tri(f) - 0.25) < 0.12 || Math.abs(tri(f) - 0.75) < 0.12 ? 1 : 0);
        n++;
      }
    }
    this.n.krabben = n;
    if (!n) return;
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * KP; ovaal(c, B[o] + r * 0.5, B[o + 1] + r * 0.6, B[o + 2], B[o + 3], r * 1.1, r * 0.8); }
    c.fill();
    c.strokeStyle = '#8a3a1e'; c.lineWidth = Math.max(0.4, r * 0.3); c.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * KP, x = B[o], y = B[o + 1], hx = B[o + 2], hy = B[o + 3], px = -hy, py = hx, w = B[o + 4] * r * 0.3;
      for (let k = -1; k <= 1; k++) for (const z of KANTEN) { c.moveTo(x + hx * k * r * 0.5, y + hy * k * r * 0.5); c.lineTo(x + hx * (k * r * 0.7 + w) + px * z * r * 1.5, y + hy * (k * r * 0.7 + w) + py * z * r * 1.5); }
    }
    c.stroke();
    c.fillStyle = '#c8572e'; c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * KP; ovaal(c, B[o], B[o + 1], B[o + 2], B[o + 3], r, r * 0.72); }
    c.fill();
    c.fillStyle = '#d8683a'; c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * KP, px = -B[o + 3], py = B[o + 2]; stip(c, B[o] + B[o + 2] * r * 1.1 + px * r * 0.9, B[o + 1] + B[o + 3] * r * 1.1 + py * r * 0.9, r * 0.38); stip(c, B[o] - B[o + 2] * r * 1.1 + px * r * 0.9, B[o + 1] - B[o + 3] * r * 1.1 + py * r * 0.9, r * 0.38); }
    c.fill();
    c.fillStyle = 'rgba(255,230,200,0.35)'; c.beginPath();
    for (let i = 0; i < n; i++) { const o = i * KP; stip(c, B[o] - r * 0.3, B[o + 1] - r * 0.3, r * 0.3); }
    c.fill();
  }

  // ---------- kringen: een vis die opspringt, regen op zoet water ----------

  // Waar mag een kring: 1 ondiepe zee, 2 zoet water dat niet bevroren is, 0 nergens. Nooit onder een brug, haven,
  // aangemeerde boot of gebouw (een meer op een bebouwd vakje is drooggelegd, zie bakMaskerData in terrein.js).
  // Met meer = false telt een meer niet mee: daar tekent terrein.js zelf al kringen van vissen.
  natSoort(x, y, meer = true) {
    if (!this.vrij(x, y, 0.3, INFRA | KUST | LEVEN | GEBOUW)) return 0;
    if (this.isZee(x, y)) return this.sd(x, y) < 7 ? 1 : 0;
    const tl = this.tl;
    if (!tl.isZoetWater(x, y)) return 0;
    if (tl.isMeer(x, y)) return meer && !this.bevroren ? 2 : 0;
    return this.ijs > 0.85 ? 0 : 2;
  }

  tekenKringen(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, t = this.t;
    c.globalAlpha = a;
    // vis die opspringt: zilveren boogje, plons, kringen
    const G = 7, i0 = Math.floor(this.wx0 / G), i1 = Math.floor(this.wx1 / G), j0 = Math.floor(this.wy0 / G), j1 = Math.floor(this.wy1 / G);
    let ns = 0;
    c.strokeStyle = 'rgba(232,242,246,0.55)';
    c.lineWidth = Math.max(0.5, T * 0.0016);
    c.beginPath();
    const vis = this.vogel; // hergebruik voor de springers: X, Y, fase
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (ns >= PLAFOND.sprongen || hash(i, j, 501) > 0.12) continue;
      const p = frac(t / (8 + hash(i, j, 502) * 6) + hash(i, j, 503));
      if (p > 0.7) continue;
      const wx = (i + hash(i, j, 504)) * G, wy = (j + hash(i, j, 505)) * G;
      if (!this.natSoort(wx, wy, false)) continue;
      const x = wx * sc + ox, y = wy * sc + oy;
      for (let q = 0; q < 2; q++) { const f = clamp((p - 0.05 - q * 0.12) / 0.55, 0, 1); if (f > 0 && f < 1) ring(c, x, y, T * (0.004 + 0.03 * f), T * (0.003 + 0.02 * f)); }
      if (p < 0.08) { const o = ns * VOGEL; vis[o] = x; vis[o + 1] = y; vis[o + 2] = p / 0.08; vis[o + 3] = hash(i, j, 506) < 0.5 ? 1 : -1; }
      else vis[ns * VOGEL + 2] = -1;
      ns++;
    }
    c.stroke();
    if (ns) {
      c.strokeStyle = 'rgba(205,218,224,0.95)'; c.lineWidth = Math.max(0.6, T * 0.0035); c.beginPath();
      for (let k = 0; k < ns; k++) {
        const o = k * VOGEL, f = vis[o + 2];
        if (f < 0) continue;
        const d = vis[o + 3], x = vis[o] + d * (f - 0.5) * T * 0.02, y = vis[o + 1] - Math.sin(f * Math.PI) * T * 0.012;
        c.moveTo(x - d * T * 0.004, y + T * 0.002); c.lineTo(x + d * T * 0.004, y - T * 0.002);
      }
      c.stroke();
    }
    this.n.sprongen = ns;
    // regen op meren en rivieren (de zee doet sfeer.js al)
    const regen = this.wr.regen;
    if (regen < 0.06) return;
    const Gr = Math.max(1.4, 46 / sc), a0 = Math.floor(this.wx0 / Gr), a1 = Math.floor(this.wx1 / Gr), b0 = Math.floor(this.wy0 / Gr), b1 = Math.floor(this.wy1 / Gr);
    const kans = Math.min(0.9, regen * 1.2);
    let nk = 0;
    for (let em = 0; em < 2; em++) {
      c.strokeStyle = 'rgba(225,238,248,1)';
      c.globalAlpha = a * (em ? 0.25 : 0.5) * clamp(regen * 1.6, 0, 1);
      c.lineWidth = Math.max(0.5, T * 0.0018);
      c.beginPath();
      for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
        if (nk >= PLAFOND.kringen || hash(i, j, 511) > kans) continue;
        const ft = t / 1.1 + hash(i, j, 512), lf = ft - Math.floor(ft);
        if ((lf < 0.5 ? 0 : 1) !== em) continue;
        const cyc = Math.floor(ft), wx = (i + hash(i, j * 31 + cyc, 513)) * Gr, wy = (j + hash(i, j * 31 + cyc, 514)) * Gr;
        if (this.isZee(wx, wy) || this.natSoort(wx, wy) !== 2) continue;
        const r = T * (0.003 + 0.016 * lf);
        ring(c, wx * sc + ox, wy * sc + oy, r, r * 0.7);
        nk++;
      }
      c.stroke();
    }
    this.n.kringen = nk;
  }

  // ---------- in de lucht: zeevogels die duiken, kites ----------

  tekenLucht(c, a) {
    const sc = this.sc, ox = this.ox, oy = this.oy, T = this.T, t = this.t, z = this.zoom;
    // zeevogels boven de scholen: rondjes, dan pijlsnel het water in, plons, even dobberen en weer op
    let nv = 0;
    const V = this.vogel, S = this.schoolXY;
    if (z > DREMPEL.zeevogel - 0.5) {
      for (let j = 0; j < this.n.scholen && nv < PLAFOND.zeevogels; j++) {
        const o = j * 5, zd = S[o + 4];
        if (hash(zd, 7) > 0.45) continue;
        for (let k = 0; k < 2 && nv < PLAFOND.zeevogels; k++) {
          const p = frac(t / (9 + k * 2) + hash(zd, k, 8));
          const u = t * 0.9 * (k ? -1 : 1) + hash(zd, k, 9) * TAU, cx = S[o] + Math.cos(u) * 1.1, cy = S[o + 1] + Math.sin(u) * 0.8;
          let h, staat;
          if (p < 0.6) { h = 2.2; staat = 0; } else if (p < 0.68) { h = 2.2 * (1 - (p - 0.6) / 0.08); staat = 1; } else if (p < 0.78) { h = 0; staat = 2; } else { h = 2.2 * smooth(0.9, 1, p); staat = p < 0.9 ? 3 : 0; }
          const q = nv * VOGEL;
          V[q] = cx * sc + ox; V[q + 1] = cy * sc + oy; V[q + 2] = -Math.sin(u) * (k ? -1 : 1); V[q + 3] = Math.cos(u) * (k ? -1 : 1); V[q + 4] = h * sc; V[q + 5] = staat + (staat === 2 ? (p - 0.68) / 0.1 : 0);
          nv++;
        }
      }
    }
    this.n.zeevogels = nv;
    c.globalAlpha = a * smooth(DREMPEL.zeevogel - 0.5, DREMPEL.zeevogel + 0.4, z);
    if (nv) {
      const L = T * 0.012;
      c.fillStyle = 'rgba(0,18,30,0.18)'; c.beginPath();
      for (let i = 0; i < nv; i++) { const o = i * VOGEL, h = V[o + 4]; if (V[o + 5] < 2 || V[o + 5] >= 3) ovaal(c, V[o] + h * SCHUIN, V[o + 1] + h * SCHUIN, V[o + 2], V[o + 3], L * 0.8, L * 0.3); }
      c.fill();
      // vleugels: gestrekt bij het cirkelen, gevouwen bij de duik
      c.strokeStyle = '#f2f2ee'; c.lineWidth = Math.max(0.6, T * 0.0028); c.beginPath();
      for (let i = 0; i < nv; i++) {
        const o = i * VOGEL, st = V[o + 5];
        if (st >= 2 && st < 3) continue;
        const x = V[o], y = V[o + 1] - V[o + 4], hx = V[o + 2], hy = V[o + 3], px = -hy, py = hx;
        const span = st >= 1 && st < 2 ? L * 0.4 : st >= 3 ? L * 0.3 : L * 1.4, sl = st < 1 ? Math.sin(t * 6 + i) * L * 0.3 : 0;
        c.moveTo(x + px * span - hx * L * 0.3, y + py * span - hy * L * 0.3 - sl); c.quadraticCurveTo(x + px * span * 0.4, y + py * span * 0.4 - L * 0.2, x, y);
        c.quadraticCurveTo(x - px * span * 0.4, y - py * span * 0.4 - L * 0.2, x - px * span - hx * L * 0.3, y - py * span - hy * L * 0.3 - sl);
        c.moveTo(x - hx * L * 0.5, y - hy * L * 0.5); c.lineTo(x + hx * L * 0.6, y + hy * L * 0.6);
      }
      c.stroke();
      if (z > DREMPEL.fijn - 1) {
        c.fillStyle = '#26262a'; c.beginPath();
        for (let i = 0; i < nv; i++) { const o = i * VOGEL, st = V[o + 5]; if (st >= 1) continue; const x = V[o], y = V[o + 1] - V[o + 4], px = -V[o + 3], py = V[o + 2]; stip(c, x + px * L * 1.35, y + py * L * 1.35, Math.max(0.5, T * 0.0018)); stip(c, x - px * L * 1.35, y - py * L * 1.35, Math.max(0.5, T * 0.0018)); }
        c.fill();
      }
      // plons waar hij erin schiet
      c.fillStyle = 'rgba(250,252,253,0.8)'; c.beginPath();
      for (let i = 0; i < nv; i++) {
        const o = i * VOGEL, st = V[o + 5];
        if (st < 2 || st >= 3) continue;
        const f = st - 2;
        for (let q = 0; q < 4; q++) { const u = (q / 4) * TAU; stip(c, V[o] + Math.cos(u) * L * 0.5 * (0.3 + f), V[o + 1] + Math.sin(u) * L * 0.3 * (0.3 + f) - L * f * (1 - f) * 3, Math.max(0.5, T * 0.0025)); }
      }
      c.fill();
    }
    // kites van de kitesurfers: een gebogen scherm aan twee lijnen, schaduw op het water of het strand
    const K = this.kites, nk = this.nKite;
    if (!nk) return;
    c.globalAlpha = a * smooth(DREMPEL.kite - 0.5, DREMPEL.kite + 0.4, z);
    const hK = T * 0.13, span = T * 0.03;
    for (let i = 0; i < nk; i++) {
      const o = i * 6, rx = K[o] * sc + ox, ry = K[o + 1] * sc + oy, kx = K[o + 2] * sc + ox, ky = K[o + 3] * sc + oy - hK;
      const px = -this.wy, py = this.wx, kl = KITE[K[o + 4]];
      c.fillStyle = 'rgba(0,18,30,0.16)'; c.beginPath();
      const sx = kx + hK * SCHUIN, sy = ky + hK + hK * SCHUIN;
      c.moveTo(sx + px * span, sy + py * span); c.quadraticCurveTo(sx + this.wx * span * 0.6, sy + this.wy * span * 0.6, sx - px * span, sy - py * span); c.quadraticCurveTo(sx + this.wx * span * 0.2, sy + this.wy * span * 0.2, sx + px * span, sy + py * span); c.fill();
      c.strokeStyle = 'rgba(30,30,30,0.5)'; c.lineWidth = Math.max(0.3, T * 0.0005); c.beginPath(); c.moveTo(rx, ry - T * 0.006); c.lineTo(kx + px * span, ky + py * span); c.moveTo(rx, ry - T * 0.006); c.lineTo(kx - px * span, ky - py * span); c.stroke();
      c.fillStyle = kl; c.beginPath();
      c.moveTo(kx + px * span, ky + py * span); c.quadraticCurveTo(kx + this.wx * span * 0.7, ky + this.wy * span * 0.7 - span * 0.5, kx - px * span, ky - py * span);
      c.quadraticCurveTo(kx + this.wx * span * 0.25, ky + this.wy * span * 0.25 - span * 0.15, kx + px * span, ky + py * span); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath();
      c.moveTo(kx + px * span * 0.8, ky + py * span * 0.8); c.quadraticCurveTo(kx + this.wx * span * 0.6 - span * 0.1, ky + this.wy * span * 0.6 - span * 0.55, kx, ky - span * 0.3); c.lineTo(kx + px * span * 0.5, ky + py * span * 0.5); c.fill();
    }
  }

  // ---------- voor tests en andere lagen ----------

  telling() { return { ...this.n, sprites: this.cache.size }; }

  statistiek() {
    return {
      sprites: this.cache.size, bytes: this.bytes, gebakken: this.gebakken,
      walvissen: this.walvissen.length, dolfijnen: this.dolfijnen.length, scholen: this.scholen.length, kwallen: this.kwallen.length,
      klippen: this.klippen.length, krabben: this.krabben.length, surfs: this.surfs.length, regattas: this.regattas.length,
      banen: this.banen.length, lussen: this.lussen.length, ijsPlekken: this.ijsPlekken.length, zwemsteigers: this.zwemsteigers.length,
      oevers: this.oevers.length, steigers: this.oevers.filter((o) => o.steiger).length,
    };
  }

  // Waar alles ligt (wereldcoördinaten), alleen-lezen: om naartoe te zoomen of te testen.
  plekken() { return this.plekLijst; }
}
