// Media en strijdbereidheid. Media is het slagveld vóór het slagveld: wie de berichtgeving in een land
// beïnvloedt, trekt het naar zich toe en ondermijnt de bereidheid om te vechten. Een groot leger dat niet wil
// vechten is weinig waard; een land dat niet meer wil vechten, kan zonder oorlog worden ingelijfd.

import { nextRandom } from './rng.js';
import { log, blokVan, isOntgrendeld, kanBetalen, betaal, actieKosten, kostenInGeld } from './sim.js';
import { voorziening } from './samenleving.js';
import { regimeEffect } from './regimes.js';
import { partij, partijSterkte, oorlogenVan, buurlanden } from './leger.js';
import { communicatieStil } from './cyber.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function mediaCapaciteit(state, c) {
  if (communicatieStil(state, c)) return 0; // omroep plat door een cyberaanval
  return voorziening(state, c, 'informatiecontrole') + regimeEffect(state, c, 'informatiecontrole');
}

// Buitenlandse media-invloed die tegen dit land werkt: van blokken die niet de eigen partij zijn.
export function vijandigeMedia(state, c) {
  const eigen = partij(state, c);
  let som = 0;
  for (const [b, w] of Object.entries(c.media)) if (b !== eigen) som += w;
  return som;
}

export function mediaTick(state) {
  const M = state.pack.model;
  for (const c of state.landen) {
    c.factcheck = communicatieStil(state, c) ? 0 : Math.max(0, c.factcheck * 0.985);
    for (const [b, w] of Object.entries(c.media)) {
      if (w <= 0.05) { delete c.media[b]; continue; }
      if (!c.vast && c.loyaliteit[b] != null && b !== c.alignment) c.loyaliteit[b] = clamp(c.loyaliteit[b] + w * M.media_trek, 0, 100);
      c.media[b] = Math.max(0, w - (M.media_verval + c.weerbaarheid * 0.002 + c.factcheck * 0.01));
    }

    // Strijdbereidheid beweegt naar een doel dat opgebouwd is uit zichtbare factoren.
    const f = [];
    f.push(['Basis', M.moraal_basis]);
    const reg = regimeEffect(state, c, 'moraal');
    if (reg) f.push(['Regime', reg]);
    f.push(['Stabiliteit', (c.stab - 50) * 0.3]);
    if (c.controle > 1) f.push(['Informatiecontrole', c.controle * 0.1]);
    if (c.complot > 1) f.push(['Complotdenken', -c.complot * 0.3]);
    const vijandig = vijandigeMedia(state, c);
    if (vijandig > 1) f.push(['Buitenlandse media', -Math.min(40, vijandig * 0.4)]);
    const oorlogen = oorlogenVan(state, c);
    if (oorlogen.length) {
      const duur = Math.max(...oorlogen.map((o) => state.dag - o.start));
      f.push(['Oorlogsmoeheid', -Math.min(25, (duur / 15) * regimeEffect(state, c, 'oorlog_moeheid', 1))]);
      // Vijand op eigen grond: de bevolking schaart zich achter de vlag.
      const indringers = state.eenheden.some((u) => u.land !== c.idx && state.eigenaar[u.t] === c.idx && oorlogen.some((o) => [o.a, o.b].includes(partij(state, state.landen[u.land]))));
      if (indringers) f.push(['Vijand op eigen grond', 12]);
    }
    if (c.modifiers.some((m) => m.type === 'oorlogssteun' && m.tot > state.dag)) f.push(['Oorlogssteun', 15]);
    const mod = c.modifiers.filter((m) => m.type === 'moraal' && m.tot > state.dag).reduce((a, m) => a + m.waarde, 0);
    if (mod) f.push(['Propaganda', mod]);
    c.moraalFactoren = f;
    c.moraalDoel = clamp(f.reduce((a, [, v]) => a + v, 0), 0, 100);
    c.moraal = clamp(c.moraal + (c.moraalDoel - c.moraal) * M.moraal_snelheid, 0, 100);
  }
}

// Gevechtskracht schaalt met strijdbereidheid: tussen 50% en 150%.
export function moraalFactor(c) {
  return 0.5 + c.moraal / 100;
}

// ---------- media-acties ----------

export function mediaStatus(state, payerIdx, doelIdx, a) {
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  if (!isOntgrendeld(state, 'media')) return { ok: false, reden: 'Media komt vrij in een latere fase.' };
  if (!t) return { ok: false, reden: 'Kies een land.' };
  const eigen = a.type === 'verdediging' || a.type === 'propaganda';
  if (eigen && t !== payer) return { ok: false, reden: 'Dit doe je in je eigen land.' };
  if (!eigen && t === payer) return { ok: false, reden: 'Kies een ander land.' };
  if (!eigen && t.alignment === payer.blok) return { ok: false, reden: 'Dit land staat al aan jouw kant.' };
  if (a.vereist_omroep && mediaCapaciteit(state, payer) < 10) return { ok: false, reden: 'Vraagt een eigen omroep: bouw er een in het tabblad Volk.' };
  if (a.type === 'nepnieuws' && (t.media[payer.blok] ?? 0) < (a.vereist_media ?? 0)) return { ok: false, reden: `Vraagt eerst ${a.vereist_media} media-invloed in dit land (koop een mediabelang).` };
  const af = state.afkoeling[`${payer.blok}|${a.id}|${t.idx}`] ?? 0;
  if (af > state.dag) return { ok: false, reden: `Afkoeling: nog ${af - state.dag} dagen.` };
  if (!kanBetalen(payer, actieKosten(state, a, t))) return { ok: false, reden: 'Onvoldoende middelen.' };
  return { ok: true, ontdekkans: a.ontdekkans ? a.ontdekkans * (1 + t.factcheck / 50) * (1 - Math.min(0.5, payer.controle / 200)) : 0 };
}

export function voerMediaActieUit(state, payerIdx, doelIdx, id) {
  const a = state.pack.acties.media.find((x) => x.id === id);
  if (!a) return { ok: false, reden: 'Onbekende actie.' };
  const st = mediaStatus(state, payerIdx, doelIdx, a);
  if (!st.ok) return st;
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  const kosten = actieKosten(state, a, t);
  betaal(payer, kosten);
  state.afkoeling[`${blok}|${a.id}|${t.idx}`] = state.dag + (a.afkoeling ?? 30);
  const speler = payerIdx === state.speler;
  if (speler) state.balans.invloed += kostenInGeld(state, kosten) * 0.03;
  const weerstand = 1 + t.weerbaarheid / 30 + t.factcheck / 40;
  animatie(state, { soort: a.type, van: payer.idx, naar: t.idx });

  if (a.type === 'verdediging') {
    t.factcheck = Math.min(100, t.factcheck + (a.factcheck ?? 25));
    for (const b of Object.keys(t.media)) if (b !== blok) t.media[b] = Math.max(0, t.media[b] - (a.media_verlaging ?? 8));
    t.complot = clamp(t.complot - (a.complot_verlaging ?? 5), 0, 100);
    if (speler) log(state, 'Factcheckers aan het werk: buitenlandse invloed op je media neemt af.', 'goed');
    return { ok: true };
  }
  if (a.type === 'propaganda') {
    t.modifiers.push({ type: 'moraal', waarde: a.moraal ?? 12, tot: state.dag + (a.duur ?? 60) });
    t.controle = clamp(t.controle + (a.controle ?? 5), 0, 100);
    t.complot = clamp(t.complot + (a.complot ?? 2), 0, 100);
    if (speler) log(state, 'Propaganda: de steun voor de krijgsmacht stijgt.', 'info');
    return { ok: true };
  }
  if (a.type === 'belang') {
    t.media[blok] = Math.min(100, (t.media[blok] ?? 0) + (a.groei ?? 15) / weerstand);
    if (speler) log(state, `Je koopt je in in de media van ${t.naam}. Invloed: ${t.media[blok].toFixed(0)}.`, 'info');
    else if (t.alignment === state.spelerBlok) log(state, `${blokVan(state, blok).naam} koopt zich in in de media van ${t.naam}.`, 'slecht');
    return { ok: true };
  }
  // Nepnieuws: werkt sterker naarmate je al meer media-invloed hebt, zwakker tegen weerbare landen.
  const kracht = (0.5 + (t.media[blok] ?? 0) / 100) / weerstand;
  if (st.ontdekkans && nextRandom(state) < st.ontdekkans) {
    if (!t.vast) t.loyaliteit[blok] = clamp(t.loyaliteit[blok] + (a.ontdekt_loyaliteit ?? -8), 0, 100);
    t.media[blok] = Math.max(0, (t.media[blok] ?? 0) - 10);
    log(state, speler ? `Je nepnieuwscampagne in ${t.naam} is ontmaskerd.` : `Nepnieuws uit ${blokVan(state, blok).naam} in ${t.naam} is ontmaskerd.`, speler ? 'slecht' : 'goed', true);
    return { ok: true, ontdekt: true };
  }
  t.complot = clamp(t.complot + (a.complot ?? 8) * kracht, 0, 100);
  t.modifiers.push({ type: 'moraal', waarde: (a.moraal ?? -8) * kracht, tot: state.dag + (a.duur ?? 60) });
  const tb = t.alignment;
  if (!t.vast && tb && tb !== 'zwevend' && tb !== blok) t.loyaliteit[tb] = clamp(t.loyaliteit[tb] + (a.loyaliteit ?? -5) * kracht, 0, 100);
  if (speler) log(state, `Nepnieuws in ${t.naam}: wantrouwen stijgt, strijdbereidheid daalt.`, 'info');
  else if (t.idx === state.speler || t.alignment === state.spelerBlok) log(state, `Er circuleert nepnieuws in ${t.naam}. Herkomst onbekend.`, 'slecht', t.idx === state.speler);
  return { ok: true };
}

// ---------- overname zonder (of met dreiging van) oorlog ----------

export function overnameStatus(state, payerIdx, doelIdx, a) {
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  if (!isOntgrendeld(state, 'invloed')) return { ok: false, reden: 'Komt vrij in de fase Invloed kopen.' };
  if (!t || t === payer) return { ok: false, reden: 'Kies een ander land.' };
  if (a.type === 'ultimatum') {
    if (!isOntgrendeld(state, 'escalatie') || !state.instellingen.systemen.escalatie) return { ok: false, reden: 'Een ultimatum hoort bij de escalatieladder: vanaf de fase Beslissen.' };
    if (!buurlanden(state, payer).includes(t.idx)) return { ok: false, reden: 'Een ultimatum stel je alleen aan een buurland.' };
  }
  if (t.alignment === blok && t.blok === blok) return { ok: false, reden: 'Dit land hoort al bij je blok.' };
  if (state.blokken.some((b) => b.leider === t.idx)) return { ok: false, reden: 'Een blokleider geeft zich niet zomaar over.' };
  const af = state.afkoeling[`${blok}|${a.id}|${t.idx}`] ?? 0;
  if (af > state.dag) return { ok: false, reden: `Afkoeling: nog ${af - state.dag} dagen.` };
  if (!kanBetalen(payer, actieKosten(state, a, t))) return { ok: false, reden: 'Onvoldoende middelen.' };
  const v = a.vereist || {};
  const voorwaarden = [];
  if (a.type === 'aansluiting') {
    voorwaarden.push(['Loyaliteit aan jouw blok', t.loyaliteit[blok], v.loyaliteit ?? 65, '≥']);
    voorwaarden.push(['Jouw media-invloed', t.media[blok] ?? 0, v.media ?? 45, '≥']);
    voorwaarden.push(['Hun strijdbereidheid', t.moraal, v.moraal_max ?? 40, '≤']);
  } else {
    const overmacht = partijSterkte(state, partij(state, payer)) / (partijSterkte(state, partij(state, t)) + 5);
    voorwaarden.push(['Militaire overmacht', overmacht, v.overmacht ?? 2.5, '≥']);
    voorwaarden.push(['Hun strijdbereidheid', t.moraal, v.moraal_max ?? 55, '≤']);
  }
  const ok = voorwaarden.every(([, w, d, op]) => (op === '≥' ? w >= d : w <= d));
  return { ok: true, slaagt: ok, voorwaarden };
}

export function voerOvernameUit(state, payerIdx, doelIdx, id) {
  const a = state.pack.acties.overname.find((x) => x.id === id);
  if (!a) return { ok: false, reden: 'Onbekende actie.' };
  const st = overnameStatus(state, payerIdx, doelIdx, a);
  if (!st.ok) return st;
  const payer = state.landen[payerIdx];
  const t = state.landen[doelIdx];
  const blok = payer.blok;
  betaal(payer, actieKosten(state, a, t));
  state.afkoeling[`${blok}|${a.id}|${t.idx}`] = state.dag + (a.afkoeling ?? 90);
  animatie(state, { soort: a.type, van: payer.idx, naar: t.idx });
  const speler = payerIdx === state.speler;
  if (!st.slaagt) {
    // Weigering: de bevolking schaart zich achter de eigen regering.
    t.modifiers.push({ type: 'moraal', waarde: 10, tot: state.dag + 60 });
    blokVan(state, blok).spanning += a.type === 'ultimatum' ? 12 : 4;
    log(state, speler ? `${t.naam} wijst je ${a.naam.toLowerCase()} af en sluit de rijen.` : `${t.naam} wijst een ${a.naam.toLowerCase()} van ${blokVan(state, blok).naam} af.`, speler ? 'slecht' : 'info', true);
    return { ok: true, geweigerd: true };
  }
  sluitAan(state, t, blok);
  if (a.type === 'ultimatum') {
    for (const o of state.landen) if (!o.vast && o !== t && o.alignment !== blok) o.loyaliteit[blok] = clamp(o.loyaliteit[blok] - 3, 0, 100);
  }
  const naam = blokVan(state, blok).naam;
  log(state, a.type === 'ultimatum' ? `${t.naam} buigt voor het ultimatum en sluit zich aan bij ${naam}.` : `${t.naam} kiest zonder één schot voor ${naam}.`, blok === state.spelerBlok ? 'goed' : 'slecht', true);
  return { ok: true };
}

export function sluitAan(state, t, blok) {
  t.blok = blok;
  t.kern = false;
  for (const b of state.blokken) {
    t.loyaliteit[b.id] = b.id === blok ? 85 : 10;
    t.basis[b.id] = b.id === blok ? 70 : 20;
  }
  t.alignment = blok;
  t.effecten = [];
  state.oorlogen = state.oorlogen.filter((o) => o.a !== `land:${t.idx}` && o.b !== `land:${t.idx}`);
  state.grensVersie += 1;
}

// Visuele gebeurtenissen voor de kaart. Ze hebben geen invloed op de simulatie.
export function animatie(state, a) {
  state.animaties.push({ ...a, dag: state.dag });
  if (state.animaties.length > 50) state.animaties.shift();
}
