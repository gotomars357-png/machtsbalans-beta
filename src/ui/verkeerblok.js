// Verkeer per gebouw (C15b): in het gebouwpaneel (renderContext in main.js) welke wagens bij dit gebouw vertrekken of
// aankomen, met per wagen een knop om hem te volgen, en bij een stil gebouw waarom het stilligt. Leest alleen: de
// ritset van leven.js (kaart.levenLaag.rit.R), het wegennet en de straatstand. Geen live stand in de html: die verandert
// alleen bij een nieuwe ritset of straatstand, zodat het paneel niet elke beurt opnieuw opgebouwd wordt.
//
// De Volg-knoppen hebben GEEN data-actie (main.js zou het paneel dan al bij pointerdown sluiten en de tik inslikken),
// maar data-volg-rit: VoertuigKaart (voertuigkaart.js) vangt die op.

import { rittenBij, stilWagenBij, RITTEN_MAX } from './voertuigkaart.js';
import { stilOp } from './straatstand.js';

const zin = (w, esc) => `<b>${esc(w.titel)}</b> ${w.richting}${w.lading ? ` met ${esc(w.lading)}` : ''} ${w.richting === 'komt' ? 'uit' : 'naar'} ${esc(w.ander)}${w.keer ? `, ${w.keer} keer per dag` : ''}`;

export function verkeerBlok(s, t, b, kaart, esc) {
  if (kaart) kaart.gebouwRitten = null;
  if (!b || !b.gebouw || b.bouw || b.sloop) return '';
  const L = kaart?.levenLaag, R = L?.rit?.R, net = kaart?.wegennet;
  if (!R || !net?.D) return '';
  const rb = rittenBij(s, net, R, t);
  if (b.land !== s.speler) {
    if (!rb.vracht) return '';
    return `<h3 style="margin-top:10px">Verkeer</h3><div class="zacht" style="font-size:12px">${rb.vracht} vrachtritten per dag</div>`;
  }
  let h = '';
  const stil = stilOp(t);
  if (stil != null) {
    const resNaam = (s.pack.resIndex?.[stil]?.naam ?? String(stil)).toLowerCase();
    const wagen = stilWagenBij(L, t);
    h += `<div class="actie"><div class="slecht">Staat stil: geen aanvoer van ${esc(resNaam)}</div>${wagen ? `<button class="knop klein" data-volg-rit="${esc('stil:' + wagen)}">Toon wagen</button>` : ''}</div>`;
  }
  for (let i = 0; i < rb.lijst.length; i++) {
    const w = rb.lijst[i];
    h += `<div class="actie"><div>${zin(w, esc)}</div><button class="knop klein" data-volg-rit="${esc(w.sleutel)}">Volg</button></div>`;
  }
  if (rb.totaal > RITTEN_MAX) h += `<div class="zacht" style="font-size:12px;padding-top:4px">en nog ${rb.totaal - RITTEN_MAX}</div>`;
  // [extra] voor de ringen om deze wagens op de kaart (pings.js), zolang het paneel open is
  if (kaart && rb.lijst.length) kaart.gebouwRitten = { t, sleutels: rb.lijst.map((w) => w.sleutel) };
  return h ? `<h3 style="margin-top:10px">Verkeer</h3>${h}` : '';
}
