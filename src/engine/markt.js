// De wereldmarkt (C18a, docs/c18-plan.md "c18a-groei"): grondstof kopen voor geld, steeds duurder naarmate je meer
// koopt, en een vol plafond is geen stil verlies meer: het overschot wordt vanzelf verkocht.
//
// Alles hangt aan state.instellingen.groei. Zonder dat veld doet deze module niets: de order 'markt' wordt geweigerd,
// het overschot gaat zoals vroeger verloren en marktAfdruk is leeg, zodat oude saves en replays exact gelijk blijven.
// Deterministisch: geen toeval, geen klok; itereren op index.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const groeiAan = (state) => !!state.instellingen?.groei;

// Alleen de bouwgrondstof (rol 'grondstof') is te koop; energie, voedsel en tech niet.
export function isMarktGrondstof(state, rid) {
  return state.pack.resIndex[rid]?.rol === 'grondstof';
}

// Prijs van één eenheid nu: markt_basis × (1 + druk). De druk stijgt met elke aankoop en zakt elke dag.
export function marktPrijs(state, c, rid) {
  const M = state.pack.model;
  return M.markt_basis * (1 + (c.marktDruk?.[rid] ?? 0));
}

// Wat n eenheden samen kosten: de prijs loopt tijdens de aankoop mee op (in stukjes kopen kost hetzelfde als ineens).
function kostVoor(state, c, rid, n) {
  const M = state.pack.model;
  const druk = c.marktDruk?.[rid] ?? 0;
  return Math.ceil(M.markt_basis * n * (1 + druk + n / (2 * M.markt_diepte)));
}

// Hoeveel er vandaag nog gekocht mag worden.
function vandaagOver(state, c) {
  const max = state.pack.model.markt_max_per_dag;
  return c.marktDag === state.dag ? Math.max(0, max - (c.marktVandaag ?? 0)) : max;
}

// Voor de interface (en de order): { kan, n, prijs (totaal in geld), per (eenheid), reden }. n wordt beperkt tot wat
// vandaag nog mag en wat in de opslag past.
export function marktStatus(state, c, rid, n = state.pack.model.markt_max_per_dag, opslagMax = null) {
  const geld = state.pack.rollen.geld;
  const uit = { kan: false, n: 0, prijs: 0, per: 0, reden: '' };
  if (!groeiAan(state)) { uit.reden = 'Er is hier geen markt.'; return uit; }
  if (!isMarktGrondstof(state, rid)) { uit.reden = 'Dit is niet te koop.'; return uit; }
  const over = vandaagOver(state, c);
  const cap = opslagMax ? opslagMax(rid) : Infinity;
  const ruimte = Math.floor(Math.max(0, cap - (c.voorraad[rid] ?? 0)));
  const k = Math.floor(clamp(+n || 0, 0, Math.min(over, ruimte)));
  uit.per = marktPrijs(state, c, rid);
  if (over <= 0) { uit.reden = 'Vandaag niets meer te koop.'; return uit; }
  if (ruimte <= 0) { uit.reden = 'Je opslag is vol.'; return uit; }
  if (k <= 0) { uit.reden = 'Kies een hoeveelheid.'; return uit; }
  uit.n = k;
  uit.prijs = kostVoor(state, c, rid, k);
  if ((c.voorraad[geld] ?? 0) < uit.prijs) { uit.reden = `Te weinig geld (${uit.prijs} nodig).`; return uit; }
  uit.kan = true;
  return uit;
}

// Order { type: 'markt', grondstof, hoeveel }: betaal geld, krijg de grondstof direct; daarna stijgt de druk.
export function voerMarktUit(state, landIdx, o, opslagMax) {
  const c = state.landen[landIdx];
  const rid = o.grondstof;
  const st = marktStatus(state, c, rid, o.hoeveel, (r) => opslagMax(state, c, r));
  if (!st.kan) return { ok: false, reden: st.reden };
  const M = state.pack.model;
  c.voorraad[state.pack.rollen.geld] -= st.prijs;
  c.voorraad[rid] = (c.voorraad[rid] ?? 0) + st.n;
  c.marktDruk ??= {};
  c.marktDruk[rid] = (c.marktDruk[rid] ?? 0) + st.n / M.markt_diepte;
  if (c.marktDag !== state.dag) { c.marktDag = state.dag; c.marktVandaag = 0; }
  c.marktVandaag += st.n;
  return { ok: true, n: st.n, prijs: st.prijs };
}

// Elke dag (één aanroep in de tick): de druk zakt met markt_herstel.
export function marktTick(state) {
  if (!groeiAan(state)) return;
  const herstel = state.pack.model.markt_herstel;
  for (let i = 0; i < state.landen.length; i++) {
    const d = state.landen[i].marktDruk;
    if (!d) continue;
    const ids = Object.keys(d);
    for (let j = 0; j < ids.length; j++) {
      d[ids[j]] *= 1 - herstel;
      if (d[ids[j]] < 1e-4) delete d[ids[j]];
    }
  }
}

// Begin van de economie van een land vandaag: de teller voor verkocht overschot op nul.
export function verkoopStart(state, c) {
  c.verkocht = {};
  c.verkoopGeld = 0;
  c.verkochtDag = state.dag;
}

// Vervangt de stille klem op de opslag: wat er boven het plafond uit komt, wordt verkocht tegen
// markt_verkoop × markt_basis per eenheid. Geeft de nieuwe voorraad; het geld telt mee in c.verkoopGeld.
export function verkoopOverschot(state, c, rid, nieuw, cap) {
  if (nieuw <= cap) return Math.max(0, nieuw);
  const over = nieuw - cap;
  const M = state.pack.model;
  c.verkocht[rid] = (c.verkocht[rid] ?? 0) + over;
  c.verkoopGeld += over * M.markt_verkoop * M.markt_basis;
  return cap;
}

// Voor de vingerafdruk: de marktdruk per land. Leeg zonder groei, zodat oude afdrukken gelijk blijven.
export function marktAfdruk(state) {
  if (!groeiAan(state)) return '';
  const delen = [];
  for (let i = 0; i < state.landen.length; i++) {
    const d = state.landen[i].marktDruk;
    if (!d) continue;
    const ids = Object.keys(d).sort();
    for (let j = 0; j < ids.length; j++) delen.push(`${i}:${ids[j]}:${d[ids[j]].toFixed(4)}`);
  }
  return `#g${delen.join(',')}`;
}
