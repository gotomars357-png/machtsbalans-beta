// C16: één onderpaneel tegelijk (context, oplosser, lade, puls, afhaak).
// Een nieuw paneel openen sluit het vorige via de callback die dat paneel bij openen opgaf.
// Zet document.body.dataset.onderpaneel, zodat CSS (krant, sessiekaart) kan wijken.

let huidigNaam = null;
let huidigSluit = null;

export function open(naam, bijSluiten = null) {
  if (huidigNaam && huidigNaam !== naam) {
    const vorige = huidigSluit;
    huidigNaam = null;
    huidigSluit = null;
    try { vorige?.(); } catch (e) { console.warn('onderpaneel sluiten', e); }
  }
  huidigNaam = naam;
  huidigSluit = bijSluiten;
  document.body.dataset.onderpaneel = naam;
}

// Meld dat paneel `naam` dicht is. Doet niets als een ander paneel intussen open staat.
export function sluit(naam) {
  if (huidigNaam !== naam) return;
  huidigNaam = null;
  huidigSluit = null;
  delete document.body.dataset.onderpaneel;
}

export function huidig() {
  return huidigNaam;
}
