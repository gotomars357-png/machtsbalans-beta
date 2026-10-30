// Dilemma-weergave: keuzes die je niet kunt betalen worden uitgegrijsd, keuzes met een nasleep krijgen een hint,
// en de nieuwe effecten (moraal, media, buren, eenheid) krijgen een leesbare tekst.

import { keuzeStatus } from '../engine/events.js';

const plus = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(0)}`;

// Tekst voor effecten die effectTekst in main.js niet kent; leeg als de sleutel onbekend is.
export function extraEffectTekst(state, k, v, duur) {
  if (k === 'moraal') return `strijdbereidheid ${plus(v)}${duur}`;
  if (k === 'factcheck') return `factcheckers ${plus(v)}`;
  if (k === 'loyaliteit_blok') return `loyaliteit buurlanden ${plus(v)}`;
  if (k === 'media') return `jouw media bij de buren ${plus(v)}`;
  if (k === 'media_vreemd') return `buitenlandse media bij jou ${plus(v)}`;
  if (k === 'eenheid') return `gratis ${(state.pack.eenhedenIndex[v]?.naam ?? v).toLowerCase()}`;
  return '';
}

// Eén keuzeknop. esc en effectTekst komen uit main.js, zodat de opmaak gelijk blijft.
export function keuzeKnop(state, k, i, esc, effectTekst) {
  const st = keuzeStatus(state, k, state.pendingEvent?.land ?? state.speler);
  const eff = effectTekst(k.effect || {});
  const nasleep = k.vervolg ? '<span class="nasleep">Dit heeft een nasleep.</span>' : '';
  const reden = st.ok ? '' : `<span class="reden">${esc(st.reden)}</span>`;
  return `<button class="keuze${st.ok ? '' : ' kan-niet'}" data-keuze="${i}"${st.ok ? '' : ' disabled'}>${esc(k.tekst)}`
    + `${eff ? `<span class="eff">${esc(eff)}</span>` : ''}${nasleep}${reden}</button>`;
}
