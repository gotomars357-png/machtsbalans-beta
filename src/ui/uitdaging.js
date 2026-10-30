// Dagelijkse uitdaging: elke dag dezelfde wereld, hetzelfde land en dezelfde seed voor iedereen.
// De datum komt uit de browser (de engine kent geen Date); alles daarna is deterministisch.
// Persoonlijke beste scores staan alleen in deze browser, er is geen online ranglijst.

const PACK_ID = 'drie-zeeen';
const BEST_SLEUTEL = 'machtsbalans.uitdagingen';
const TOP = 10;
const MOEILIJKHEDEN = ['makkelijk', 'normaal', 'moeilijk'];
export const UITDAGING_DOEL = 'Win zo snel mogelijk; zonder oorlog telt dubbel.';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const twee = (n) => String(n).padStart(2, '0');

// Datum als sleutel (2026-10-30) en zoals de speler hem leest (30-10-2026).
export function datumSleutel(d = new Date()) { return `${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}`; }
export function datumTekst(sleutel) { const [j, m, d] = sleutel.split('-'); return `${d}-${m}-${j}`; }

// jaar*10000 + maand*100 + dag, door een vaste 32-bits mixer: naburige dagen geven totaal andere seeds.
export function uitdagingSeed(sleutel) {
  const [j, m, d] = sleutel.split('-').map(Number);
  let h = (j * 10000 + m * 100 + d) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 2147483646) + 1;
}

// Instellingen voor de uitdaging van een datum: land en moeilijkheid volgen uit de seed. Fasen aan, tutorial uit.
export function uitdagingInstellingen(pack, sleutel) {
  const seed = uitdagingSeed(sleutel);
  const landen = pack.landen.filter((l) => l.speelbaar);
  return {
    seed,
    land: landen[seed % landen.length].id,
    moeilijkheid: MOEILIJKHEDEN[(seed >>> 8) % MOEILIJKHEDEN.length],
    onboarding: true,
    tutorial: false,
    systemen: { events: true, schokken: true, escalatie: true },
    uitdaging: sleutel,
  };
}

// ---------- persoonlijke beste scores ----------

export function leesBeste() {
  try { const v = JSON.parse(localStorage.getItem(BEST_SLEUTEL) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

// Voegt een resultaat toe aan de top 10 van die datum (pure functie op het bewaarde object).
export function voegToe(alle, sleutel, item) {
  const lijst = [...(alle[sleutel] ?? [])];
  if (!lijst.some((x) => x.id === item.id)) lijst.push(item);
  lijst.sort((a, b) => b.score - a.score || a.dag - b.dag);
  return { ...alle, [sleutel]: lijst.slice(0, TOP) };
}

// Bewaart een resultaat en geeft de top 10 van die datum terug. `item.id` voorkomt dubbel tellen van hetzelfde potje.
export function bewaarResultaat(sleutel, item) {
  const nieuw = voegToe(leesBeste(), sleutel, item);
  try { localStorage.setItem(BEST_SLEUTEL, JSON.stringify(nieuw)); } catch { /* geen opslag: de score telt alleen nu */ }
  return nieuw[sleutel];
}

export function deelTekst(sleutel, { spelerWint, dag, score, zonderOorlog }) {
  return `Machtsbalans, uitdaging ${datumTekst(sleutel)}: ${spelerWint ? 'gewonnen' : 'verloren'} op dag ${dag}, score ${score}${spelerWint && zonderOorlog ? ', zonder oorlog' : ''}`;
}

export async function kopieer(tekst) {
  try { await navigator.clipboard.writeText(tekst); return true; } catch { /* oudere browser of geen toestemming */ }
  try {
    const t = document.createElement('textarea');
    t.value = tekst;
    t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.append(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}

// ---------- kaart op het startscherm ----------

let bron = null; // { packs, start } van de laatste aanroep, zodat het eindoverzicht de kaart kan verversen

export function toonUitdaging(packs, start) {
  bron = { packs, start };
  vernieuwUitdaging();
}

export function vernieuwUitdaging() {
  const el = document.getElementById('uitdaging');
  if (!el || !bron) return;
  const p = bron.packs.find((x) => x.pack?.meta.id === PACK_ID && !x.rapport.fouten.length);
  if (!p) { el.hidden = true; return; }
  const sleutel = datumSleutel();
  const inst = uitdagingInstellingen(p.pack, sleutel);
  const land = p.pack.landen.find((l) => l.id === inst.land);
  const beste = leesBeste()[sleutel] ?? [];
  const naamM = { makkelijk: 'Makkelijk', normaal: 'Normaal', moeilijk: 'Moeilijk' }[inst.moeilijkheid];
  el.hidden = false;
  el.innerHTML = `<div class="uitdaging-kop"><span>Uitdaging van vandaag</span><span class="num">${datumTekst(sleutel)}</span></div>
    <p><b>${esc(land?.naam ?? inst.land)}</b> in ${esc(p.pack.meta.naam)} · ${naamM}</p>
    <p class="zacht">${UITDAGING_DOEL} Iedereen speelt vandaag dezelfde wereld.</p>
    ${beste.length ? `<p class="zacht">Jouw beste vandaag: <b class="num">${beste[0].score}</b> (${beste.length} ${beste.length === 1 ? 'poging' : 'pogingen'})</p>` : ''}
    <button class="knop primair" id="uitdaging-knop">Speel de uitdaging</button>`;
  el.querySelector('#uitdaging-knop').onclick = () => bron.start(p.pack, uitdagingInstellingen(p.pack, datumSleutel()));
}
