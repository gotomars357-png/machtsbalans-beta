// Handelscontracten tussen landen (spelers of bots) en credits. Zie docs/competitie.md §4.
// Alles loopt via orders (`contract`) en de dagtick, dus het blijft deterministisch en zit in de replay.
// Credits zijn alleen spelpunten: ze worden verdiend door contracten en zijn niet te kopen of te verhandelen.

import { log } from './sim.js';

export const CONTRACT = {
  max_open: 3,            // open + lopende contracten per land
  aanbod_dagen: 10,       // zo lang blijft een aanbod staan
  verzuim_dagen: 5,       // zoveel dagen achter elkaar niet leveren = contractbreuk
  loop_min: 30, loop_max: 180, krediet_min: 60,
  per_dag_max: 50,
  bedrag_min: 50, bedrag_max: 2000,
  rente_max: 0.5,
  credit_factor: 0.1,     // credits = factor × geldwaarde van de kleinste kant
  nieuwe_partner: 1.5,    // bonus bij een eerste contract met deze partner
  boete_aandeel: 0.5,     // boete = aandeel van de contractwaarde in credits
  boete_min: 5,
  wantrouwen: 0.5,        // boete +50% per eerdere breuk
  betrouwbaarheid_straf: 15,
};

export function initContracten(state) {
  state.contracten = [];
  state.volgendeContractId = 1;
  state.credits = state.landen.map(() => 0);
  state.betrouwbaarheid = state.landen.map(() => 100);
  state.breuken = state.landen.map(() => 0);
  state.handelPartners = {};
}

const sleutel = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const waardeRes = (state, res, hoeveel) => {
  const R = state.pack.rollen;
  return res === R.geld ? hoeveel : res === R.tech ? hoeveel * 8 : hoeveel * 1.5;
};

export function contractenVan(state, land) {
  return state.contracten.filter((k) => k.a === land || k.b === land);
}
const telActief = (state, land) => contractenVan(state, land).filter((k) => k.status === 'open' || k.status === 'actief').length;

function stroom(state, x, naam) {
  const res = state.pack.resIndex[x?.res];
  if (!res || res.id === state.pack.rollen.stabiliteit) return { fout: `Onbekende of niet-verhandelbare grondstof (${naam}).` };
  const per = +x.per_dag;
  if (!(per > 0) || per > CONTRACT.per_dag_max) return { fout: `Hoeveelheid per dag moet tussen 0 en ${CONTRACT.per_dag_max} liggen (${naam}).` };
  return { res: res.id, per_dag: per };
}

export function voerContractUit(state, s, o) {
  switch (o.actie) {
    case 'aanbod': return doeAanbod(state, s, o);
    case 'aanvaard': return aanvaard(state, s, o.id);
    case 'wijs_af': return trekIn(state, s, o.id);
    case 'verbreek': return verbreek(state, s, o.id, 'verbroken');
    default: return { ok: false, reden: `Onbekende contractactie '${o.actie}'.` };
  }
}

function doeAanbod(state, a, o) {
  const b = o.met;
  if (!Number.isInteger(b) || !state.landen[b] || b === a) return { ok: false, reden: 'Kies een ander land als partner.' };
  if (!['grondstof', 'krediet'].includes(o.soort)) return { ok: false, reden: 'Onbekend contractsoort.' };
  if (telActief(state, a) >= CONTRACT.max_open || telActief(state, b) >= CONTRACT.max_open) return { ok: false, reden: `Maximaal ${CONTRACT.max_open} contracten per land tegelijk.` };
  const looptijd = Math.round(+o.looptijd);
  const min = o.soort === 'krediet' ? CONTRACT.krediet_min : CONTRACT.loop_min;
  if (!(looptijd >= min && looptijd <= CONTRACT.loop_max)) return { ok: false, reden: `Looptijd tussen ${min} en ${CONTRACT.loop_max} dagen.` };
  const geld = state.pack.rollen.geld;
  const k = { id: state.volgendeContractId, soort: o.soort, a, b, status: 'open', aangeboden: state.dag, tot: state.dag + CONTRACT.aanbod_dagen, looptijd, a_geeft: null, b_geeft: null, voorschot: null, verzuim: { a: 0, b: 0 }, geleverd: 0 };
  let totA;
  let totB;
  if (o.soort === 'grondstof') {
    const ga = stroom(state, o.geef, 'geef');
    if (ga.fout) return { ok: false, reden: ga.fout };
    const gb = stroom(state, o.vraag, 'vraag');
    if (gb.fout) return { ok: false, reden: gb.fout };
    if (ga.res === gb.res) return { ok: false, reden: 'Ruil twee verschillende grondstoffen.' };
    k.a_geeft = ga; k.b_geeft = gb;
    totA = waardeRes(state, ga.res, ga.per_dag * looptijd);
    totB = waardeRes(state, gb.res, gb.per_dag * looptijd);
  } else {
    const bedrag = Math.round(+o.bedrag);
    const rente = +o.rente;
    if (!(bedrag >= CONTRACT.bedrag_min && bedrag <= CONTRACT.bedrag_max)) return { ok: false, reden: `Bedrag tussen ${CONTRACT.bedrag_min} en ${CONTRACT.bedrag_max}.` };
    if (!(rente >= 0 && rente <= CONTRACT.rente_max)) return { ok: false, reden: `Rente tussen 0 en ${CONTRACT.rente_max}.` };
    if ((state.landen[a].voorraad[geld] || 0) < bedrag) return { ok: false, reden: 'Onvoldoende middelen voor deze lening.' };
    k.voorschot = { res: geld, bedrag };
    k.b_geeft = { res: geld, per_dag: (bedrag * (1 + rente)) / looptijd };
    k.rente = rente;
    totA = bedrag;
    totB = bedrag * (1 + rente);
  }
  k.waarde = Math.max(1, Math.round(Math.min(totA, totB) * CONTRACT.credit_factor));
  const wie = state.landen[a].naam;
  // Elke eerdere breuk van de aanbieder maakt de boete hoger; de aanvaarder ziet hem vooraf.
  k.boete = Math.max(CONTRACT.boete_min, Math.round(k.waarde * CONTRACT.boete_aandeel * (1 + CONTRACT.wantrouwen * state.breuken[a])));
  state.contracten.push(k);
  state.volgendeContractId += 1;
  if (!o.stil) log(state, `${wie} biedt ${state.landen[b].naam} een ${o.soort === 'krediet' ? 'kredietlijn' : 'grondstoffencontract'} aan (${looptijd} dagen).`, 'info', a === state.speler || b === state.speler);
  return { ok: true, id: k.id };
}

const vind = (state, id) => state.contracten.find((k) => k.id === id);

function aanvaard(state, s, id) {
  const k = vind(state, id);
  if (!k || k.status !== 'open') return { ok: false, reden: 'Geen open aanbod met dit nummer.' };
  if (k.b !== s) return { ok: false, reden: 'Dit aanbod is niet aan jou gericht.' };
  if (state.dag > k.tot) { k.status = 'verlopen'; return { ok: false, reden: 'Dit aanbod is verlopen.' }; }
  if (telActief(state, s) > CONTRACT.max_open) return { ok: false, reden: `Maximaal ${CONTRACT.max_open} contracten per land tegelijk.` };
  if (k.voorschot) {
    const van = state.landen[k.a];
    if ((van.voorraad[k.voorschot.res] || 0) < k.voorschot.bedrag) return { ok: false, reden: 'De aanbieder kan de lening niet meer betalen.' };
    van.voorraad[k.voorschot.res] -= k.voorschot.bedrag;
    state.landen[k.b].voorraad[k.voorschot.res] = (state.landen[k.b].voorraad[k.voorschot.res] || 0) + k.voorschot.bedrag;
  }
  const sl = sleutel(k.a, k.b);
  k.nieuwePartner = !state.handelPartners[sl];
  k.status = 'actief';
  k.start = state.dag;
  k.einde = state.dag + k.looptijd;
  log(state, `Contract tussen ${state.landen[k.a].naam} en ${state.landen[k.b].naam} gaat in (${k.looptijd} dagen).`, 'goed', k.a === state.speler || k.b === state.speler);
  return { ok: true };
}

function trekIn(state, s, id) {
  const k = vind(state, id);
  if (!k || k.status !== 'open') return { ok: false, reden: 'Geen open aanbod met dit nummer.' };
  if (k.a !== s && k.b !== s) return { ok: false, reden: 'Dit aanbod gaat je niet aan.' };
  k.status = k.a === s ? 'ingetrokken' : 'afgewezen';
  return { ok: true };
}

function verbreek(state, s, id, status) {
  const k = vind(state, id);
  if (!k || k.status !== 'actief') return { ok: false, reden: 'Geen lopend contract met dit nummer.' };
  if (k.a !== s && k.b !== s) return { ok: false, reden: 'Dit contract gaat je niet aan.' };
  const ander = k.a === s ? k.b : k.a;
  // De boete is bij het aanbod vastgelegd; de breker verliest hem, de ander krijgt de helft.
  state.credits[s] -= k.boete;
  state.credits[ander] += Math.round(k.boete / 2);
  state.breuken[s] += 1;
  state.betrouwbaarheid[s] = Math.max(0, state.betrouwbaarheid[s] - CONTRACT.betrouwbaarheid_straf);
  k.status = status;
  k.gebroken_door = s;
  log(state, `${state.landen[s].naam} verbreekt het contract met ${state.landen[ander].naam}. Straf: ${k.boete} credits.`, s === state.speler ? 'slecht' : 'info', s === state.speler || ander === state.speler);
  return { ok: true };
}

function lever(state, k, van, naar, x, wie) {
  if (!x) return;
  const v = state.landen[van];
  if ((v.voorraad[x.res] || 0) >= x.per_dag) {
    v.voorraad[x.res] -= x.per_dag;
    state.landen[naar].voorraad[x.res] = (state.landen[naar].voorraad[x.res] || 0) + x.per_dag;
    k.verzuim[wie] = 0;
  } else {
    k.verzuim[wie] += 1;
  }
}

export function contractenTick(state) {
  if (!state.contracten.length) return;
  for (const k of state.contracten) {
    if (k.status === 'open') {
      if (state.dag > k.tot) k.status = 'verlopen';
      continue;
    }
    if (k.status !== 'actief') continue;
    lever(state, k, k.a, k.b, k.a_geeft, 'a');
    lever(state, k, k.b, k.a, k.b_geeft, 'b');
    // Wie te lang niet levert, breekt het contract.
    const schuldig = k.verzuim.a >= CONTRACT.verzuim_dagen ? k.a : k.verzuim.b >= CONTRACT.verzuim_dagen ? k.b : -1;
    if (schuldig >= 0) { verbreek(state, schuldig, k.id, 'verbroken'); continue; }
    if (state.dag >= k.einde) {
      k.status = 'afgerond';
      const bonus = k.nieuwePartner ? CONTRACT.nieuwe_partner : 1;
      const credits = Math.round(k.waarde * bonus);
      state.credits[k.a] += credits;
      state.credits[k.b] += credits;
      state.handelPartners[sleutel(k.a, k.b)] = true;
      log(state, `Contract ${state.landen[k.a].naam} – ${state.landen[k.b].naam} loopt af: elk ${credits} credits.`, 'goed', k.a === state.speler || k.b === state.speler);
    }
  }
}

// Voor de vingerafdruk: leeg zolang er niets is gebeurd, zodat bestaande opslagen blijven kloppen.
export function contractenAfdruk(state) {
  if (!state.contracten.length) return '';
  return `#k:${state.contracten.map((k) => `${k.id}${k.status[0]}`).join('')}:${state.credits.join(',')}:${state.betrouwbaarheid.join(',')}`;
}

// ---------- AI: contracten aanbieden en beantwoorden ----------
// Regelgebaseerd en zonder toeval (geen rng): wie wanneer aanbiedt volgt uit dag en landnummer, dus de uitkomst
// blijft deterministisch en een replay rekent hetzelfde. Orders van de AI gaan niet in het orderlogboek, net als
// de andere AI-acties; de replay herberekent ze.

export const AI_CONTRACT = {
  interval: 15,           // dagen tussen twee aanbiedingen van één AI-land
  looptijd: 60,
  per_dag: 4,             // hoeveelheid die de AI aanbiedt
  marge: 1.1,             // wat de AI vraagt boven de waarde van wat ze geeft
  min_voorraad_dagen: 20, // de AI belooft alleen wat ze minstens zoveel dagen kan leveren
  min_betrouwbaarheid: 40,
  max_rente: 0.25,
  tekort_voorraad: 100,   // onder deze voorraad heeft een land "tekort"
};

function opOorlog(state, a, b) {
  const pa = a.alignment && a.alignment !== 'zwevend' ? a.alignment : `land:${a.idx}`;
  const pb = b.alignment && b.alignment !== 'zwevend' ? b.alignment : `land:${b.idx}`;
  return state.oorlogen.some((o) => (o.a === pa && o.b === pb) || (o.a === pb && o.b === pa));
}

const verhandelbaar = (state) => state.pack.resources.map((r) => r.id).filter((id) => id !== state.pack.rollen.stabiliteit);

function overschot(c, res) {
  return (c.netto[res] ?? 0) > 2 && (c.voorraad[res] ?? 0) > AI_CONTRACT.tekort_voorraad * 1.5;
}
function tekort(c, res) {
  return (c.netto[res] ?? 0) < 1 || (c.voorraad[res] ?? 0) < AI_CONTRACT.tekort_voorraad;
}

// Beoordeelt een open aanbod aan een AI-land. Geeft true bij aanvaarden.
function beoordeel(state, k) {
  const c = state.landen[k.b];
  const a = state.landen[k.a];
  const A = AI_CONTRACT;
  if (opOorlog(state, a, c)) return false;
  if (state.betrouwbaarheid[k.a] < A.min_betrouwbaarheid) return false;
  if (k.boete < k.waarde * CONTRACT.boete_aandeel * 0.5) return false;
  const geld = state.pack.rollen.geld;
  if (k.soort === 'krediet') {
    // Lenen doet de AI alleen als ze geld nodig heeft en de aflossing makkelijk kan dragen.
    if (k.rente > A.max_rente) return false;
    if ((c.voorraad[geld] ?? 0) > A.tekort_voorraad * 1.5) return false;
    return c.inkomen > k.b_geeft.per_dag * 2;
  }
  // Grondstoffen: de AI moet kunnen leveren, iets nodig hebben, en niet te veel betalen.
  const geef = k.b_geeft;
  const krijg = k.a_geeft;
  if ((c.voorraad[geef.res] ?? 0) < geef.per_dag * A.min_voorraad_dagen) return false;
  if (!tekort(c, krijg.res)) return false;
  if (!(waardeRes(state, geef.res, geef.per_dag) <= waardeRes(state, krijg.res, krijg.per_dag) * A.marge)) return false;
  // Wat ze kwijt raakt mag haar eigen tekort niet verergeren.
  return !tekort(c, geef.res);
}

// Plaatst een aanbod van c aan een partner. Een AI-partner die het toch zou weigeren, krijgt het niet eens:
// zo loopt de lijst niet vol met afwijzingen. Geeft true als het aanbod staat.
function plaats(state, c, partner, geef, vraag) {
  const A = AI_CONTRACT;
  const uit = voerContractUit(state, c.idx, { actie: 'aanbod', met: partner.idx, soort: 'grondstof', looptijd: A.looptijd, geef, vraag, stil: true });
  if (!uit.ok) return false;
  const k = state.contracten[state.contracten.length - 1];
  if (partner.idx !== state.speler && !beoordeel(state, k)) {
    state.contracten.pop();
    state.volgendeContractId -= 1;
    return false;
  }
  log(state, `${c.naam} biedt ${partner.naam} een grondstoffencontract aan (${A.looptijd} dagen).`, 'info', partner.idx === state.speler);
  return true;
}

const zonderContract = (state, c, p) => !state.contracten.some((k) => (k.status === 'open' || k.status === 'actief') && ((k.a === c.idx && k.b === p.idx) || (k.a === p.idx && k.b === c.idx)));

// De AI geeft weg wat ze te veel heeft aan een land dat er tekort aan heeft.
function biedOverschot(state, c) {
  const A = AI_CONTRACT;
  const res = verhandelbaar(state);
  const geld = state.pack.rollen.geld;
  const geef = res.find((r) => r !== geld && overschot(c, r));
  if (!geef) return false;
  const kandidaten = state.landen
    .filter((p) => p.idx !== c.idx && !opOorlog(state, c, p) && telActief(state, p.idx) < CONTRACT.max_open && zonderContract(state, c, p))
    .filter((p) => tekort(p, geef))
    .sort((x, y) => (y.alignment === c.alignment) - (x.alignment === c.alignment) || x.idx - y.idx);
  const partner = kandidaten[0];
  if (!partner) return false;
  // Vraag liever een grondstof waaraan de AI zelf tekort heeft; anders geld tegen een eerlijke prijs.
  const wil = res.find((r) => r !== geef && r !== geld && tekort(c, r) && (partner.voorraad[r] ?? 0) > A.tekort_voorraad * 1.5);
  const vraag = wil
    ? { res: wil, per_dag: Math.max(1, Math.round((waardeRes(state, geef, A.per_dag) * A.marge) / waardeRes(state, wil, 1))) }
    : { res: geld, per_dag: Math.max(1, Math.round(waardeRes(state, geef, A.per_dag) * A.marge)) };
  return plaats(state, c, partner, { res: geef, per_dag: A.per_dag }, vraag);
}

// B20: heeft de AI zelf tekort en heeft een ander land (ook de speler) daar overschot van, dan vraagt ze erom
// en betaalt met haar overschot, of anders met geld tegen een eerlijke prijs.
function biedTekort(state, c) {
  const A = AI_CONTRACT;
  const res = verhandelbaar(state);
  const geld = state.pack.rollen.geld;
  for (const nodig of res.filter((r) => r !== geld && tekort(c, r))) {
    const kandidaten = state.landen
      .filter((p) => p.idx !== c.idx && !opOorlog(state, c, p) && telActief(state, p.idx) < CONTRACT.max_open && zonderContract(state, c, p))
      .filter((p) => (p.voorraad[nodig] ?? 0) > A.tekort_voorraad * 1.5)
      .sort((x, y) => (y.alignment === c.alignment) - (x.alignment === c.alignment) || x.idx - y.idx);
    // Betalen met een eigen overschot dat de partner niet al in overvloed heeft; anders met geld.
    const betaal = res.find((r) => r !== nodig && r !== geld && overschot(c, r));
    for (const partner of kandidaten) {
      const ruil = betaal && tekort(partner, betaal) ? betaal : geld;
      const per_dag = Math.max(1, Math.round((waardeRes(state, nodig, A.per_dag) * A.marge) / waardeRes(state, ruil, 1)));
      if ((c.voorraad[ruil] ?? 0) < per_dag * A.min_voorraad_dagen) continue;
      if (plaats(state, c, partner, { res: ruil, per_dag }, { res: nodig, per_dag: A.per_dag })) return true;
    }
  }
  return false;
}

function bied(state, c) {
  if (telActief(state, c.idx) >= 2) return;
  if (!biedOverschot(state, c)) biedTekort(state, c);
}

export function aiContractenTick(state) {
  if (!state.instellingen.systemen.contracten) return;
  // Eerst beantwoorden (de dag nadat het aanbod is gedaan), dan eventueel zelf aanbieden.
  for (const k of state.contracten) {
    if (k.status !== 'open' || k.b === state.speler || state.dag <= k.aangeboden) continue;
    voerContractUit(state, k.b, { actie: beoordeel(state, k) ? 'aanvaard' : 'wijs_af', id: k.id });
  }
  for (const c of state.landen) {
    if (c.idx === state.speler) continue;
    if ((state.dag + c.idx * 3) % AI_CONTRACT.interval === 0) bied(state, c);
  }
}
