// Eén gedeeld werkbudget per beeld voor het voorwerk van de gebakken lagen (C14d): terrein, werk en kust.
// terrein.js tekent als eerste en heeft voorrang; werk en kust doen alleen voorwerk met wat er dan over is (eerst werk,
// dan kust). Alle metingen gaan met de echte klok: die van de kaartview (view.tijdMs, map.js: "voor werkbudgetten"; één
// klok, zie samenhangtest), en onder kijk.mjs diens __kijkEcht, want kijk vervangt de klok door een nepklok die binnen een
// beeld stilstaat, en daarmee zou elk budget oneindig lijken. Zonder view (losse tests) meet de klok 0 en houdt
// MIN_STAP het voorwerk begrensd.

let klokView = null;
export function echtNu() {
  if (typeof globalThis.__kijkEcht === 'function') return globalThis.__kijkEcht();
  return typeof klokView?.tijdMs === 'function' ? klokView.tijdMs() : 0;
}

export const BEELD_BUDGET = 1.5; // ms per beeld in rust (zonder meting van de beeldtijd)
export const VLUCHT_BUDGET = 2.0; // ms per beeld tijdens een vlucht (zonder meting)
export const MIN_STAP = 0.05; // een stap kost minstens zoveel van het budget, ook als de klok 0 meet

// C15a: aanpasbaar budget. Met een gemeten beeldtijd (zetBeeldTijd, aan het eind van map.teken) is het budget wat er
// van het doel overblijft na het gewone tekenen: over = clamp(DOEL - tekenKosten, MIN_OVER, MAX). tekenKosten is een
// glijdend gemiddelde (alfa KOST_ALFA) van de beeldtijd min wat er dat beeld gebakken is. Zonder meting (klok 0, zoals
// in node) gelden de vaste BEELD_BUDGET en VLUCHT_BUDGET.
export const DOEL_RUST = 4.0, DOEL_VLUCHT = 6.0;
export const MAX_RUST = 2.5, MAX_VLUCHT = 3.5;
export const MIN_OVER = 0.4;
export const KOST_ALFA = 0.3;

// beeld: de nu van het laatste beeld; over: wat er dit beeld nog te besteden is (ms); werkBezig: werk.js had het
// vorige beeld nog voorwerk (dan wacht kust, zodat werk voorgaat ook al tekent kust eerder); besteed: wat er sinds
// de vorige zetBeeldTijd echt gebakken is (ms); tekenKosten: NaN zolang er geen meting is.
export const budget = { beeld: NaN, over: BEELD_BUDGET, gegeven: BEELD_BUDGET, vlucht: false, werkBezig: false, besteed: 0, tekenKosten: NaN };

const klem = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Wat er bij een nieuw beeld te besteden is.
export function budgetVoor(vlucht) {
  if (!Number.isFinite(budget.tekenKosten)) return vlucht ? VLUCHT_BUDGET : BEELD_BUDGET;
  return klem((vlucht ? DOEL_VLUCHT : DOEL_RUST) - budget.tekenKosten, MIN_OVER, vlucht ? MAX_VLUCHT : MAX_RUST);
}

// Bij een nieuw beeld (een andere nu dan het vorige) het budget opnieuw vullen; binnen hetzelfde beeld niets doen.
// view: de kaartview waarvan de klok komt (zie echtNu).
export function begin(nu, vlucht = false, view = null) {
  if (view) klokView = view;
  if (nu === budget.beeld) return;
  budget.beeld = nu;
  budget.vlucht = !!vlucht;
  budget.over = budget.gegeven = budgetVoor(vlucht);
}

// Een gedane stap van ms milliseconden afboeken.
export function verbruik(ms) {
  budget.over -= Math.max(MIN_STAP, ms || 0);
  if (ms > 0) budget.besteed += ms;
}

export function heeftBudget() {
  return budget.over > 0;
}

// De beeldtijd van het beeld dat net af is (map.teken, gemeten met echtNu). Zonder klok (0 of minder) niets.
export function zetBeeldTijd(ms) {
  const bak = budget.besteed;
  budget.besteed = 0;
  if (!(ms > 0)) return;
  const k = Math.max(0, ms - bak);
  budget.tekenKosten = Number.isFinite(budget.tekenKosten) ? budget.tekenKosten + KOST_ALFA * (k - budget.tekenKosten) : k;
}

// Voor het meetblok (kijk.mjs --lagen) en de tests.
// over: wat dit beeld te besteden kreeg; rest: wat er nu nog over is.
export function budgetStand() { return { tekenKosten: budget.tekenKosten, over: budget.gegeven, rest: budget.over }; }
export function vergeetBudget() { budget.tekenKosten = NaN; budget.besteed = 0; budget.beeld = NaN; budget.over = budget.gegeven = BEELD_BUDGET; }
