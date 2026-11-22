// C17a: je spel blijft bewaard en staat op pauze als je de app sluit (docs/c17-plan.md, sectie c17a-bewaren).
// Bewaart stil bij verbergen (visibilitychange, pagehide, freeze), elke STIL_ELKE_DAGEN speeldagen en kort na een
// geslaagde order. Bij opnieuw openen sta je meteen in je potje, op pauze, met een kaartje "Je was op dag N".
// Deze module geeft nooit orders en raakt de spelregels niet: hij leest de stand en schrijft alleen naar localStorage.
//
// Gebeurtenissen op window (afspraak 4): 'bewaard' {dag, reden} en 'hervat' {dag, bron: 'opstart'|'terug'}.

export const STIL_ELKE_DAGEN = 5; // stil bewaren elke 5 speeldagen (was 30)
export const NA_ORDER_MS = 2000; // na een geslaagde order hooguit één keer per 2 s bewaren
// Bij het ontwerp bedoeld als "laadmelding pas na 150 ms". Laden blokkeert de pagina, dus een melding die later komt
// wordt nooit getekend. De melding staat er daarom meteen; dit getal is alleen nog de grens in bewaartest.
export const LAADMELDING_NA_MS = 150;

export const AUTO_SLEUTEL = 'machtsbalans-autosave'; // de spelopslag, zelfde vorm als vóór C17
export const HERVAT_SLEUTEL = 'machtsbalans-hervat'; // klein: camera, tabblad, tempo en of je hier verder gaat

// ---------- puur (draait ook in node) ----------

// Moet er nu bewaard worden? Geeft de reden terug of null.
// laatst: { dag, ms, orderMs } van de vorige keer; nu: { reden, ms }.
export function moetBewaren(s, laatst, nu) {
  if (!s || s.replay || s.uitkomst) return null;
  const reden = nu?.reden ?? 'interval';
  if (reden === 'order') {
    const vorige = laatst?.orderMs ?? -Infinity;
    return (nu?.ms ?? 0) - vorige >= NA_ORDER_MS ? 'order' : null;
  }
  return reden;
}

// Het tempo om naar terug te gaan: wat er liep, anders het laatste tempo boven 0, anders 1×.
function terugTempo(ui) {
  if (ui?.tempo > 0) return ui.tempo;
  if (ui?.vorigTempo > 0) return ui.vorigTempo;
  return 1;
}

// Het kleine meta-object naast de opslag.
export function hervatMeta(s, ui) {
  const k = ui?.kaart;
  // Vliegt de camera nog, dan telt waar hij heen gaat.
  const bron = k?.doel ? { x: k.doel.x, y: k.doel.y, zoom: k.doel.zoom ?? k.zoom } : k ? { x: k.cx, y: k.cy, zoom: k.zoom } : null;
  return {
    dag: s.dag,
    pack: s.pack?.meta?.id ?? null,
    seed: s.instellingen?.seed ?? null,
    camera: bron && isFinite(bron.x) && isFinite(bron.y) && isFinite(bron.zoom) ? { x: bron.x, y: bron.y, zoom: bron.zoom } : null,
    tab: ui?.tab ?? 'economie',
    tempo: terugTempo(ui),
    actief: true,
  };
}

// Horen opslag en meta bij elkaar, en is het pack er nog?
export function kanHervatten(opslag, meta, packs = []) {
  if (!meta || meta.actief !== true || !opslag || opslag.formaat !== 'machtsbalans-opslag') return false;
  const id = opslag.pack?.id;
  if (!id || meta.pack !== id) return false;
  if ((meta.seed ?? null) !== (opslag.instellingen?.seed ?? null)) return false;
  if (meta.dag !== opslag.einddag) return false;
  if (!Array.isArray(opslag.orders)) return false;
  return packs.some((p) => (p?.pack ?? p)?.meta?.id === id && !(p?.rapport?.fouten?.length));
}

// ---------- DOM-kant ----------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ctx: { ui, sim, laadSpel, zetTempo, zetTab, toast, naarStart } uit main.js. Voor bewaartest zijn venster, doc,
// opslag, klok, wacht en stopWacht in te vullen (een nep-localStorage en een EventTarget als document).
export function maakBewaren(ctx) {
  const { ui, sim } = ctx;
  const venster = ctx.venster ?? (typeof window !== 'undefined' ? window : null);
  const doc = ctx.doc ?? (typeof document !== 'undefined' ? document : null);
  const opslag = 'opslag' in ctx ? ctx.opslag : (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();
  const klok = ctx.klok ?? (() => Date.now());
  const wacht = ctx.wacht ?? ((fn, ms) => setTimeout(fn, ms));
  const stopWacht = ctx.stopWacht ?? ((id) => clearTimeout(id));
  const zetTempo = ctx.zetTempo ?? ((t) => { ui.tempo = t; });

  let laatst = { dag: -1, ms: -Infinity, orderMs: -Infinity };
  let orderWacht = null;
  let pauzeBijTerug = false;
  let kaartje = null;
  let kaartjeTimer = null;
  let laadEl = null;
  let tempoTerug = 1;

  const lees = (sleutel) => { try { return JSON.parse(opslag?.getItem(sleutel) ?? 'null'); } catch { return null; } };
  const schrijf = (sleutel, waarde) => { try { opslag?.setItem(sleutel, JSON.stringify(waarde)); return true; } catch { return false; } };
  const stuur = (naam, detail) => {
    try { const E = venster?.CustomEvent ?? globalThis.CustomEvent; if (E && venster?.dispatchEvent) venster.dispatchEvent(new E(naam, { detail })); } catch { /* alleen een signaal */ }
  };
  const inSpel = () => !!ui.state && !(doc?.getElementById?.('spel')?.hidden);

  // Na het einde van een potje blijft de laatste opslag staan, maar de volgende opstart begint op het startscherm.
  function zetActief(aan) {
    const m = lees(HERVAT_SLEUTEL);
    if (!m || m.actief === aan) return;
    schrijf(HERVAT_SLEUTEL, { ...m, actief: aan });
  }

  function bewaar(reden = 'interval') {
    const s = ui.state;
    if (s?.uitkomst && !s.replay) { zetActief(false); return false; }
    const nu = klok();
    const r = moetBewaren(s, laatst, { reden, ms: nu });
    if (!r || !opslag) return false; // review: zonder opslag (privé-venster) niets melden als 'bewaard'
    let tekst;
    try { tekst = JSON.stringify(sim.maakOpslag(s)); } catch { return false; }
    try { opslag?.setItem(AUTO_SLEUTEL, tekst); } catch { return false; } // vol of geen opslag: het spel gaat gewoon door
    schrijf(HERVAT_SLEUTEL, hervatMeta(s, ui));
    laatst = { dag: s.dag, ms: nu, orderMs: r === 'order' ? nu : laatst.orderMs };
    stuur('bewaard', { dag: s.dag, reden: r });
    return true;
  }

  // Naar het startscherm via het menu: de volgende opstart begint daar weer (Verder en Autosave blijven).
  function stopHervat() {
    zetActief(false);
    verbergKaartje();
    pauzeBijTerug = false;
  }

  // ---- verbergen en terugkomen ----

  function verberg() {
    if (!inSpel()) return;
    if (orderWacht != null) { stopWacht(orderWacht); orderWacht = null; }
    if (ui.state.replay) { if (ui.tempo > 0) zetTempo(0); return; } // een replay wordt nooit bewaard of hervat
    tempoTerug = terugTempo(ui);
    const meta = hervatMeta(ui.state, ui); // vóór de pauze: dan weet de meta welk tempo er liep
    if (ui.tempo > 0) zetTempo(0);
    if (bewaar('verborgen')) schrijf(HERVAT_SLEUTEL, meta);
    pauzeBijTerug = !ui.state.uitkomst;
  }

  function terug() {
    if (!pauzeBijTerug || !inSpel()) return;
    pauzeBijTerug = false;
    toonKaartje(tempoTerug);
    stuur('hervat', { dag: ui.state.dag, bron: 'terug' });
  }

  if (doc?.addEventListener) {
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') verberg(); else terug(); });
    doc.addEventListener('freeze', verberg);
  }
  if (venster?.addEventListener) {
    venster.addEventListener('pagehide', verberg);
    venster.addEventListener('pageshow', (e) => { if (e?.persisted) terug(); });
    // Na een geslaagde order kort daarna stil bewaren, en het pauzekaartje mag weg.
    venster.addEventListener('order', (e) => {
      if (!e?.detail?.ok || !ui.state || ui.state.replay) return;
      verbergKaartje();
      const over = NA_ORDER_MS - (klok() - laatst.orderMs);
      if (over <= 0) bewaar('order');
      else if (orderWacht == null) orderWacht = wacht(() => { orderWacht = null; bewaar('order'); }, over);
    });
  }

  // ---- het pauzekaartje ----

  function verbergKaartje() {
    if (kaartjeTimer != null) { clearInterval(kaartjeTimer); kaartjeTimer = null; }
    if (kaartje) { kaartje.remove(); kaartje = null; }
    doc?.body?.classList?.remove('bw-hervat-open');
  }

  function toonKaartje(tempo) {
    verbergKaartje();
    const wrap = doc?.getElementById?.('kaart-wrap');
    if (!wrap || !doc.createElement || !ui.state) return;
    const el = doc.createElement('div');
    el.id = 'bw-kaartje';
    el.className = 'bw-kaartje';
    el.setAttribute('role', 'status');
    el.innerHTML = `<button type="button" class="bw-verder" data-bewaren="verder"><span class="bw-ico" aria-hidden="true">▶</span>`
      + `<span><b>Je was op dag ${esc(ui.state.dag)}.</b> Tik om verder te spelen.</span></button>`
      + `<button type="button" class="bw-start" data-bewaren="start">Of ga naar het startscherm</button>`;
    el.querySelector('.bw-verder').addEventListener('click', () => { verbergKaartje(); zetTempo(tempo > 0 ? tempo : 1); });
    el.querySelector('.bw-start').addEventListener('click', () => { verbergKaartje(); ctx.naarStart?.(); });
    wrap.append(el);
    kaartje = el;
    doc.body?.classList?.add('bw-hervat-open'); // css: de sessiekaart "Welkom terug" wacht tot je verder speelt
    // Weg zodra het spel weer loopt, langs welke weg ook (tempoknop, toets, kaartje).
    kaartjeTimer = setInterval(() => { if (!ui.state || ui.tempo > 0 || ui.state.replay) verbergKaartje(); }, 400);
  }

  // ---- laadmelding en hervatten bij opstart ----

  function toonLaadmelding(dag) {
    if (!doc?.createElement || !doc.body) return;
    if (!laadEl) {
      laadEl = doc.createElement('div');
      laadEl.id = 'bw-laden';
      laadEl.className = 'bw-laden';
      laadEl.setAttribute('role', 'status');
      doc.body.append(laadEl);
    }
    laadEl.innerHTML = `<div class="bw-laden-kaart"><span class="bw-draai" aria-hidden="true"></span><b>Je spel wordt geladen…</b>`
      + `${dag != null ? `<span class="zacht">dag ${esc(dag)}</span>` : ''}</div>`;
  }
  function verbergLaadmelding() { if (laadEl) { laadEl.remove(); laadEl = null; } }

  // Al bij het laden van de pagina (de packs komen nog): staat er een potje klaar, dan meteen de laadmelding,
  // zodat het startscherm niet even opflitst.
  const klaar = lees(HERVAT_SLEUTEL);
  let vroegeMelding = null;
  if (klaar?.actief === true) {
    toonLaadmelding(klaar.dag);
    // Lukt het laden van de packs niet (geen verbinding), dan blijft de melding niet eeuwig staan.
    vroegeMelding = wacht(() => { vroegeMelding = null; verbergLaadmelding(); }, 20000);
  }

  function zetTerug(meta) {
    if (meta.tab && ctx.zetTab) { try { ctx.zetTab(meta.tab); } catch { /* onbekend tabblad: blijf op economie */ } }
    const k = ui.kaart;
    const c = meta.camera;
    if (k && c && isFinite(c.x) && isFinite(c.y) && isFinite(c.zoom)) {
      k.doel = null; k.glij = null; k.zoomDoel = null;
      k.zoom = Math.max(1, Math.min(14, c.zoom));
      k.cx = c.x; k.cy = c.y;
      k.begrens?.();
    }
    zetTempo(0);
    // Wat het opnieuw afspelen aan meldingen opleverde is oud nieuws (het logboek en de krant hebben het nog).
    if (Array.isArray(ui.state?.meldingen)) ui.state.meldingen.length = 0;
    ui.dirty = true;
  }

  // Geeft true als er een potje klaarstond en het laden begonnen is (init stopt dan niet met het startscherm).
  function hervatBijOpstart({ direct = false } = {}) {
    if (vroegeMelding != null) { stopWacht(vroegeMelding); vroegeMelding = null; }
    const meta = lees(HERVAT_SLEUTEL);
    const o = lees(AUTO_SLEUTEL);
    if (!kanHervatten(o, meta, ui.packs)) { verbergLaadmelding(); return false; }
    toonLaadmelding(o.einddag);
    const laad = () => {
      let gelukt = false;
      try {
        gelukt = ctx.laadSpel(o, { stil: true, meta }) !== false && !!ui.state;
        if (gelukt) {
          zetTerug(meta);
          laatst = { dag: ui.state.dag, ms: klok(), orderMs: -Infinity };
          toonKaartje(meta.tempo);
          stuur('hervat', { dag: ui.state.dag, bron: 'opstart' });
        }
      } catch (e) {
        console.warn('hervatten', e);
        gelukt = false;
      }
      verbergLaadmelding();
      if (!gelukt) {
        zetActief(false);
        ctx.toast?.('Je vorige potje kon niet worden geladen. Kies Autosave of begin opnieuw.', 'slecht');
      }
    };
    // Eerst de melding laten tekenen, dan pas laden (laden blokkeert de pagina even).
    if (direct) laad();
    else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => wacht(laad, 0));
    else wacht(laad, 0);
    return true;
  }

  return {
    bewaar, stopHervat, hervatBijOpstart, verberg, terug,
    kaartjeOpen: () => !!kaartje,
    laatst: () => ({ ...laatst }),
  };
}
