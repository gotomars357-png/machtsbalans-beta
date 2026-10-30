// Regelgebaseerde AI: economie voor elk land, invloed voor blokleiders en gedelegeerde commandanten voor de speler.
// Persoonlijkheden uit het pack bepalen de gewichten; alle toeval loopt via de deterministische rng.

import { nextRandom } from './rng.js';
import { netwerkStatus, voerNetwerkActieUit, woningCapaciteit } from './samenleving.js';
import { mediaStatus, voerMediaActieUit, overnameStatus, voerOvernameUit, vijandigeMedia } from './media.js';
import { aiCyber, aiCyberVerdediging } from './cyber.js';
import {
  bouw, bouwKosten, actieKosten, isOntgrendeld, vrijePlekken, voerHefboomUit, hefboomStatus, verwachteWinst,
  voerEscalatieUit, escalatieStatus, deescaleer, MOEILIJKHEID, log, opslagMax, kostenInGeld,
} from './sim.js';

export function aiTick(state) {
  for (const c of state.landen) {
    if (c.idx === state.speler) continue;
    if ((state.dag + c.idx) % 5 === 0) { aiEconomie(state, c); aiCyberVerdediging(state, c); }
  }
  if (!isOntgrendeld(state, 'invloed')) return;
  for (const b of state.blokken) {
    if (b.id === state.spelerBlok || b.leider < 0) continue;
    const leider = state.landen[b.leider];
    if ((state.dag + leider.idx * 3) % 10 === 0) aiInvloed(state, leider, b);
  }
}

function persAi(state, c) {
  return state.pack.persoonlijkheden[c.persoonlijkheid].ai || {};
}

function producent(state, c, resId) {
  const P = state.pack;
  let best = null;
  let bestScore = -1;
  for (const g of P.gebouwen) {
    const out = g.productie?.[resId];
    if (!out || !isOntgrendeld(state, g.id) || !vrijePlekken(state, c, g.id)) continue;
    if (g.verbruik && Object.keys(g.verbruik).some((r) => c.ratio[r] < 1)) continue;
    const kost = kostenInGeld(state, bouwKosten(state, c, g.id));
    const score = out / Math.max(1, kost);
    if (score > bestScore) { bestScore = score; best = g.id; }
  }
  return best;
}

function aiEconomie(state, c) {
  const P = state.pack;
  const R = P.rollen;
  const ai = persAi(state, c);
  if (c.stab < 40) c.verdeling = Math.min(0.32, c.verdeling + 0.02);
  else if (c.stab > 66 && c.verdeling > (ai.verdeling ?? 0.1)) c.verdeling = Math.max(0, c.verdeling - 0.01);
  const fc = P.acties.media?.find((a) => a.type === 'verdediging');
  if (fc && vijandigeMedia(state, c) > 25 && c.voorraad[R.geld] > (ai.reserve ?? 100) && mediaStatus(state, c.idx, c.idx, fc).ok) voerMediaActieUit(state, c.idx, c.idx, fc.id);
  if (c.bouw.length >= P.model.max_bouw) return;

  const net = (r) => c.netto[r] ?? 0;
  const wachtrij = (pred) => c.bouw.some((b) => pred(P.gebouwIndex[b.gebouw]));
  const produceertIn = (r) => wachtrij((g) => g.productie?.[r]);
  let keuze = null;
  if ((net(R.voedsel) < 1.5 || c.ratio[R.voedsel] < 1) && !produceertIn(R.voedsel)) keuze = producent(state, c, R.voedsel);
  if (!keuze && (net(R.energie) < 3 || c.ratio[R.energie] < 1) && !produceertIn(R.energie)) keuze = producent(state, c, R.energie);
  if (!keuze) {
    for (const r of P.resources) {
      if (r.rol === 'grondstof' && net(r.id) < 1.5 && !produceertIn(r.id)) { keuze = producent(state, c, r.id); if (keuze) break; }
    }
  }
  if (!keuze) {
    const vol = P.resources.some((r) => c.voorraad[r.id] != null && c.voorraad[r.id] > 0.9 * opslagMax(state, c, r.id));
    const opslag = P.gebouwen.filter((g) => g.opslag_bonus && isOntgrendeld(state, g.id)).sort((a, b) => b.opslag_bonus - a.opslag_bonus)[0];
    if (vol && opslag && vrijePlekken(state, c, opslag.id)) keuze = opslag.id;
  }
  // Samenleving: woningen als de bevolking tegen het plafond zit, en af en toe een voorziening.
  const beschikbaar = (g) => isOntgrendeld(state, g.id) && vrijePlekken(state, c, g.id) && !c.bouw.some((b) => b.gebouw === g.id);
  if (!keuze && c.L >= woningCapaciteit(state, c) * 0.93) {
    const wonen = P.gebouwen.find((g) => g.woningen && beschikbaar(g));
    if (wonen) keuze = wonen.id;
  }
  if (!keuze && nextRandom(state) < 0.2) {
    const opties = P.gebouwen.filter((g) => g.categorie === 'maatschappij' && !g.woningen && beschikbaar(g));
    opties.sort((a, b) => (c.gebouwen[a.id] || 0) - (c.gebouwen[b.id] || 0) || a.id.localeCompare(b.id));
    if (opties.length) keuze = opties[0].id;
  }
  if (!keuze && nextRandom(state) < (ai.tech ?? 0.3)) keuze = producent(state, c, R.tech);
  if (!keuze) {
    let best = -1;
    for (const g of P.gebouwen) {
      if (!g.kapitaalvoorraad || !isOntgrendeld(state, g.id) || !vrijePlekken(state, c, g.id)) continue;
      if (g.kapitaalvoorraad > best) { best = g.kapitaalvoorraad; keuze = g.id; }
    }
  }
  if (!keuze) return;
  // Ontbreekt een bouwgrondstof, bouw dan eerst de producent daarvan.
  const tekort = Object.entries(bouwKosten(state, c, keuze)).find(([r, v]) => r !== R.geld && (c.voorraad[r] ?? 0) < v);
  if (tekort) {
    if (produceertIn(tekort[0])) return;
    keuze = producent(state, c, tekort[0]);
    if (!keuze) return;
  }
  const kosten = bouwKosten(state, c, keuze);
  // Blokleiders sparen vanaf de invloedfase een deel van hun geld voor het overhalen van landen.
  const isLeider = state.blokken.some((b) => b.leider === c.idx && b.id !== state.spelerBlok);
  const mult = MOEILIJKHEID[state.instellingen.moeilijkheid]?.invloed ?? 1;
  const invloedFase = state.pack.verhaal.fasen.find((f) => (f.ontgrendelt || []).includes('invloed'));
  const bijnaInvloed = isOntgrendeld(state, 'invloed') || (invloedFase && state.dag >= invloedFase.dag - 60);
  const spaar = isLeider && bijnaInvloed ? 1 + 5 * (ai.invloed ?? 0.3) * mult : 1;
  const reserve = (ai.reserve ?? 100) * spaar;
  if ((c.voorraad[R.geld] - (kosten[R.geld] || 0)) < reserve) return;
  bouw(state, c.idx, keuze);
}

function besteHefboom(state, payer, t, budget, criterium = 'efficient') {
  let best = null;
  let bestScore = -1;
  for (const h of state.pack.acties.hefbomen) {
    const st = hefboomStatus(state, payer.idx, t.idx, h);
    if (!st.ok) continue;
    const kost = kostenInGeld(state, actieKosten(state, h, t));
    if (kost > budget) continue;
    const winst = verwachteWinst(state, payer.idx, t.idx, h);
    const score = criterium === 'efficient' ? winst / Math.max(1, kost) : winst;
    if (score > bestScore) { bestScore = score; best = { h, winst, kost }; }
  }
  return best;
}

function aiInvloed(state, leider, blok) {
  const R = state.pack.rollen;
  const ai = persAi(state, leider);
  const mult = MOEILIJKHEID[state.instellingen.moeilijkheid]?.invloed ?? 1;
  const budget = (leider.voorraad[R.geld] - (ai.reserve ?? 100)) * (ai.invloed ?? 0.3) * mult;

  // Vergelding op provocaties tegen dit blok
  const recent = state.provocaties.filter((p) => p.tegen === blok.id && state.dag - p.dag < 20);
  if (recent.length && state.instellingen.systemen.escalatie) {
    const dader = recent[recent.length - 1].door;
    const doel = state.blokken.find((b) => b.id === dader)?.leider;
    const druk = state.pack.acties.escalatie.find((e) => e.trede === 1);
    if (doel != null && druk && escalatieStatus(state, leider.idx, doel, druk).ok && nextRandom(state) < 0.5 + (ai.druk ?? 0)) {
      voerEscalatieUit(state, leider.idx, doel, druk.id);
    }
  }

  let rest = budget;
  for (let ronde = 0; ronde < 2 && rest >= 40; ronde++) {
    let keuze = null;
    let bestScore = -1;
    for (const t of state.landen) {
      if (t.vast) continue;
      if (t.alignment === blok.id && t.loyaliteit[blok.id] >= 60) continue;
      const h = besteHefboom(state, leider, t, rest);
      if (!h) continue;
      const weging = t.alignment === 'zwevend' ? 1.3 : t.alignment === blok.id ? 0.9 : 1;
      const score = (t.Y + 20) * weging * (h.winst / Math.max(1, h.kost)) * (0.85 + 0.3 * nextRandom(state));
      if (score > bestScore) { bestScore = score; keuze = { t, h }; }
    }
    if (!keuze) break;
    voerHefboomUit(state, leider.idx, keuze.t.idx, keuze.h.h.id);
    rest -= keuze.h.kost;
  }

  if (isOntgrendeld(state, 'escalatie') && state.instellingen.systemen.escalatie && nextRandom(state) < (ai.druk ?? 0.1) * mult) {
    const doelen = state.landen.filter((t) => t.alignment === state.spelerBlok || (t.alignment === 'zwevend' && t.loyaliteit[state.spelerBlok] > 45));
    doelen.sort((a, b) => b.Y - a.Y);
    // Oorlog en valse vlaggen beslist de AI apart, op basis van legersterkte.
    const ladder = state.pack.acties.escalatie.filter((e) => e.beschikbaar !== false && e.type !== 'oorlog' && e.type !== 'valse_vlag' && e.type !== 'cyber').sort((a, b) => b.trede - a.trede);
    for (const t of doelen.slice(0, 3)) {
      const e = ladder.find((x) => escalatieStatus(state, leider.idx, t.idx, x).ok && (x.trede === 1 || blok.spanning > 15));
      if (e) { voerEscalatieUit(state, leider.idx, t.idx, e.id); break; }
    }
  }

  // Cyber beslist de AI apart: alleen agressieve en opportunistische leiders, bij hoge spanning.
  aiCyber(state, leider, blok);

  // Geheime netwerken: uitbouwen in betwiste landen en, als het netwerk sterk genoeg is, het dossier gebruiken.
  if (isOntgrendeld(state, 'netwerken') && nextRandom(state) < 0.12 + (ai.druk ?? 0.1) * 0.5) {
    const acties = state.pack.acties.netwerken;
    const chantage = acties.find((a) => a.type === 'chantage');
    const loge = acties.find((a) => a.type === 'loge');
    const doelen = state.landen.filter((t) => !t.vast && t.alignment !== blok.id).sort((a, b) => b.Y - a.Y).slice(0, 4);
    for (const t of doelen) {
      if (chantage && netwerkStatus(state, leider.idx, t.idx, chantage).ok && nextRandom(state) < 0.5) { voerNetwerkActieUit(state, leider.idx, t.idx, chantage.id); break; }
      if (loge && netwerkStatus(state, leider.idx, t.idx, loge).ok) { voerNetwerkActieUit(state, leider.idx, t.idx, loge.id); break; }
    }
  }

  // Media: inkopen in betwiste landen, nepnieuws bij rivalen, en aansluiten waar een land er rijp voor is.
  if (isOntgrendeld(state, 'media')) {
    const media = state.pack.acties.media;
    const belang = media.find((a) => a.type === 'belang');
    const nep = media.find((a) => a.type === 'nepnieuws');
    const doelen = state.landen.filter((t) => !t.vast && t.alignment !== blok.id).sort((a, b) => b.Y - a.Y || a.idx - b.idx).slice(0, 4);
    if (belang && nextRandom(state) < 0.25 + (ai.invloed ?? 0.3) * 0.4) {
      const t = doelen.find((x) => mediaStatus(state, leider.idx, x.idx, belang).ok);
      if (t) voerMediaActieUit(state, leider.idx, t.idx, belang.id);
    }
    if (nep && nextRandom(state) < 0.1 + (ai.druk ?? 0.1)) {
      const t = doelen.find((x) => mediaStatus(state, leider.idx, x.idx, nep).ok);
      if (t) voerMediaActieUit(state, leider.idx, t.idx, nep.id);
    }
  }
  for (const a of state.pack.acties.overname) {
    if (a.type === 'ultimatum' && (ai.druk ?? 0.1) < 0.2) continue;
    const t = state.landen.find((x) => { const st = overnameStatus(state, leider.idx, x.idx, a); return st.ok && st.slaagt; });
    if (t) { voerOvernameUit(state, leider.idx, t.idx, a.id); break; }
  }

  if (blok.spanning > 40 && leider.persoonlijkheid === 'voorzichtig') deescaleer(state, leider.idx);
}

export function commandantenTick(state) {
  for (const k of state.commandanten) {
    if (!k.actief || (state.dag - k.start) % 8 !== 1) continue;
    const speler = state.landen[k.eigenaar ?? state.speler];
    const blok = speler.idx === state.speler ? state.spelerBlok : speler.blok;
    const t = state.landen[k.doel];
    if (t.alignment === blok && t.loyaliteit[blok] >= 65) {
      k.actief = false;
      k.rapport.push({ dag: state.dag, tekst: `Missie geslaagd: ${t.naam} staat stevig aan onze kant.` });
      log(state, `Commandant: missie in ${t.naam} geslaagd.`, 'goed', true);
      continue;
    }
    const rest = k.budget - k.besteed;
    const opties = [];
    for (const h of state.pack.acties.hefbomen) {
      const kost = kostenInGeld(state, actieKosten(state, h, t));
      if (kost > rest || !hefboomStatus(state, speler.idx, t.idx, h).ok) continue;
      opties.push({ soort: 'hefboom', id: h.id, naam: h.naam, kost, winst: verwachteWinst(state, speler.idx, t.idx, h) });
    }
    if (k.stijl === 'gedurfd' && t.alignment !== 'zwevend' && t.alignment !== blok) {
      const druk = state.pack.acties.escalatie.find((e) => e.trede === 1);
      const kost = druk ? kostenInGeld(state, actieKosten(state, druk, t)) : Infinity;
      if (druk && kost <= rest && escalatieStatus(state, speler.idx, t.idx, druk).ok) {
        opties.push({ soort: 'escalatie', id: druk.id, naam: druk.naam, kost, winst: 9 });
      }
    }
    if (!opties.length) {
      const goedkoopste = Math.min(...state.pack.acties.hefbomen.map((h) => kostenInGeld(state, actieKosten(state, h, t))));
      if (goedkoopste > rest) {
        k.actief = false;
        k.rapport.push({ dag: state.dag, tekst: 'Budget op. Missie beëindigd.' });
        log(state, `Commandant voor ${t.naam}: budget op.`, 'info', true);
      } else if (!k.rapport.length || k.rapport[k.rapport.length - 1].tekst !== 'Wacht op afkoeling of middelen.') {
        k.rapport.push({ dag: state.dag, tekst: 'Wacht op afkoeling of middelen.' });
      }
      continue;
    }
    const score = (o) => (k.stijl === 'zuinig' ? o.winst / Math.max(1, o.kost) : o.winst);
    opties.sort((a, b) => score(b) - score(a));
    let keuze = opties[0];
    const foutkans = k.stijl === 'zuinig' ? 0.06 : 0.14;
    let fout = false;
    if (opties.length > 1 && nextRandom(state) < foutkans) {
      keuze = opties[1 + Math.floor(nextRandom(state) * (opties.length - 1))];
      fout = true;
    }
    const res = keuze.soort === 'hefboom'
      ? voerHefboomUit(state, speler.idx, t.idx, keuze.id)
      : voerEscalatieUit(state, speler.idx, t.idx, keuze.id);
    if (!res.ok) continue;
    k.besteed += keuze.kost;
    k.rapport.push({ dag: state.dag, tekst: `${keuze.naam} ingezet (${Math.round(keuze.kost)}).${fout ? ' Achteraf geen beste keuze.' : ''}` });
    if (k.rapport.length > 30) k.rapport.shift();
  }
}
