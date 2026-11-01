// Seizoen, weer en wind voor de kaart: één bron voor alle weergavelagen (terrein, leven, gebouwen, sfeer),
// zodat sneeuw op de akkers, paraplu's op straat en regenstrepen in de lucht bij elkaar passen.
// Puur decor en puur een functie van de speldag en de plek: geen Math.random, geen klok, geen toestand.
// Dag 0 is 1 januari; een jaar telt 365 dagen.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function hash3(a, b, c) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// Gladde ruis in drie dimensies (waarde-ruis met smoothstep), uitkomst 0..1.
function ruis3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const h = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v),
    l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v),
    w,
  );
}

// Gewichten per seizoen (samen ongeveer 1) plus handige afgeleiden. Winter piekt half januari, zomer half juli.
export function seizoen(dag = 0) {
  const d = ((Math.floor(dag) % 365) + 365) % 365;
  const hoek = ((d - 15) / 365) * TAU; // 0 = half januari
  const koud = 0.5 + 0.5 * Math.cos(hoek); // 1 midden in de winter, 0 midden in de zomer
  const groei = Math.sin(hoek); // + voorjaar, - najaar
  const winter = smooth(0.62, 0.9, koud);
  const zomer = smooth(0.62, 0.9, 1 - koud);
  const rest = Math.max(0, 1 - winter - zomer);
  const lente = rest * smooth(-0.2, 0.2, groei);
  const herfst = rest - lente;
  return {
    dagInJaar: d,
    maand: Math.min(11, Math.floor(d / 30.42)),
    winter, lente, zomer, herfst,
    koud, // 0..1, voor sneeuwgrens en kale bomen
    sneeuw: smooth(0.75, 0.97, koud), // hoeveel sneeuw er op vlak land ligt (alleen hartje winter)
    bloei: lente * smooth(0.0, 0.6, groei), // bloesem en bloemen
    blad: herfst, // herfstkleuren
    oogst: smooth(0.5, 0.85, 1 - koud) * smooth(0.05, 0.45, -groei), // rijp graan, eind zomer
  };
}

// Weer op een plek (wereldcoördinaten, kaart 1000x620) op een speldag. Fronten trekken langzaam over de kaart.
export function weer(dag = 0, wx = 500, wy = 310) {
  const sz = seizoen(dag);
  const w = wind(dag);
  const t = dag / 3;
  const ox = -Math.cos(w.hoek) * dag * 6, oy = -Math.sin(w.hoek) * dag * 6;
  const front = ruis3((wx + ox) / 260, (wy + oy) / 260, t);
  const fijn = ruis3((wx + ox) / 90, (wy + oy) / 90, t * 1.7 + 11);
  const vocht = 0.68 * front + 0.32 * fijn + 0.08 * (sz.herfst + sz.winter) - 0.1 * sz.zomer;
  const wolken = smooth(0.42, 0.72, vocht);
  const regen = smooth(0.6, 0.8, vocht);
  const sneeuwt = regen * smooth(0.7, 0.9, sz.koud);
  const onweer = regen * sz.zomer * smooth(0.82, 0.92, vocht);
  const mist = smooth(0.55, 0.8, ruis3(wx / 140, wy / 140, t * 0.6 + 37)) * (0.35 + 0.65 * (sz.herfst + sz.winter)) * (1 - regen);
  return { wolken, regen: regen - sneeuwt, sneeuw: sneeuwt, onweer, mist };
}

// Windrichting (radialen, waar de wind naartoe waait) en kracht 0..1. Draait langzaam van dag tot dag.
export function wind(dag = 0) {
  const hoek = 0.35 + (ruis3(dag / 9, 3.1, 7.7) - 0.5) * 2.6; // overwegend uit het westen, naar het oosten
  const kracht = 0.25 + 0.75 * ruis3(dag / 4, 9.3, 1.9);
  return { hoek, kracht };
}
