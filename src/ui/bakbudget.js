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

export const BEELD_BUDGET = 1.5; // ms per beeld in rust
export const VLUCHT_BUDGET = 2.0; // ms per beeld tijdens een vlucht
export const MIN_STAP = 0.05; // een stap kost minstens zoveel van het budget, ook als de klok 0 meet

// beeld: de nu van het laatste beeld; over: wat er dit beeld nog te besteden is (ms); werkBezig: werk.js had het
// vorige beeld nog voorwerk (dan wacht kust, zodat werk voorgaat ook al tekent kust eerder).
export const budget = { beeld: NaN, over: BEELD_BUDGET, vlucht: false, werkBezig: false };

// Bij een nieuw beeld (een andere nu dan het vorige) het budget opnieuw vullen; binnen hetzelfde beeld niets doen.
// view: de kaartview waarvan de klok komt (zie echtNu).
export function begin(nu, vlucht = false, view = null) {
  if (view) klokView = view;
  if (nu === budget.beeld) return;
  budget.beeld = nu;
  budget.vlucht = !!vlucht;
  budget.over = vlucht ? VLUCHT_BUDGET : BEELD_BUDGET;
}

// Een gedane stap van ms milliseconden afboeken.
export function verbruik(ms) {
  budget.over -= Math.max(MIN_STAP, ms || 0);
}

export function heeftBudget() {
  return budget.over > 0;
}
