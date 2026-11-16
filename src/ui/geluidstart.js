// C15d Geluid in de browser: de enige plek die window en document aanraakt voor de geluidslaag. Haakt aan via één
// scriptregel in index.html (na main.js) en leest de rest van buitenaf: window.machtsbalans.ui, de bouwgebeurtenissen
// van oplevering.js en de toasts in #toasts. main.js, map.js, pings.js en oplevering.js blijven onaangeroerd.
import { maakGeluid, soortVanToast } from './geluid.js';
import { opBouwGebeurtenis } from './oplevering.js';

const geluid = maakGeluid();
window.machtsbalansGeluid = geluid; // handig bij playtests en debuggen vanuit de console

// Eigen beeldlus: de tijd komt uit de rAF-tijdstempel, niet uit een eigen klok.
const raf = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame.bind(window) : null;
if (raf) {
  const lus = (ts) => {
    try { geluid.tik(window.machtsbalans?.ui, ts); } catch { /* het geluid mag het spel nooit hinderen */ }
    raf(lus);
  };
  raf(lus);
}

try { geluid.knop(document.querySelector('.kaart-knoppen')); } catch { /* niets */ }

opBouwGebeurtenis((e) => { try { geluid.bouw(e); } catch { /* niets */ } });

const box = document.querySelector('#toasts');
if (box && typeof MutationObserver === 'function') {
  new MutationObserver((lijst) => {
    for (let i = 0; i < lijst.length; i++) {
      const nodes = lijst[i].addedNodes;
      for (let j = 0; j < nodes.length; j++) {
        const n = nodes[j];
        if (n.nodeType === 1 && n.classList?.contains('toast')) { try { geluid.melding(soortVanToast(n)); } catch { /* niets */ } }
      }
    }
  }).observe(box, { childList: true });
}
