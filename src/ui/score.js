// Score van een afgelopen partij: een pure functie van de eindtoestand, zonder DOM of opslag.
//
// Winst:   1000 voor de overwinning
//        + 4000 × snelheid        (snelheid = dagen over tot de tijdlimiet / tijdlimiet; dag 0 = 1, de limiet = 0)
//        + 1000 × aandeel         (aandeel van jouw blok aan het einde, 0..1)
//        × 2 zonder oorlog        (jouw blok heeft nooit in oorlog gestaan)
// Verlies: een deelscore, altijd onder een snelle winst:
//          1000 × aandeel + 300 × (gehaalde dagen / tijdlimiet)
// Daarna × moeilijkheid (makkelijk 0,8 · normaal 1 · moeilijk 1,25) en afgerond.

export const SCORE = {
  winst: 1000, snelheid: 4000, aandeel: 1000, zonderOorlog: 2,
  verliesAandeel: 1000, verliesDagen: 300,
  moeilijkheid: { makkelijk: 0.8, normaal: 1, moeilijk: 1.25 },
};

const limietVan = (state) => state.pack.verhaal?.dag_limiet ?? 2400;

// Heeft het blok van de speler ooit in oorlog gestaan? Kijkt naar oorlogsverklaringen (escalaties), lopende oorlogen,
// capitulatie en het logboek; de toestand zelf bewaart afgelopen oorlogen niet apart.
export function oorlogGevoerd(state) {
  const sb = state.spelerBlok;
  const speler = state.landen[state.speler];
  const tredes = new Set((state.pack.acties?.escalatie ?? []).filter((e) => e.type === 'oorlog').map((e) => e.trede));
  const kant = (idx) => { const c = state.landen[idx]; return !!c && (idx === state.speler || c.blok === sb || c.alignment === sb); };
  for (let i = 0; i < state.escalaties.length; i++) {
    const e = state.escalaties[i];
    if (tredes.has(e.trede) && (e.blok === sb || kant(e.doel))) return true;
  }
  const eigen = [sb, `land:${state.speler}`];
  for (let i = 0; i < state.oorlogen.length; i++) {
    const o = state.oorlogen[i];
    if (eigen.includes(o.a) || eigen.includes(o.b)) return true;
  }
  if (state.uitkomst?.reden === 'Capitulatie') return true;
  const blokNaam = state.blokken.find((b) => b.id === sb)?.naam;
  for (let i = 0; i < state.log.length; i++) {
    const t = state.log[i].tekst;
    if (t.includes('de oorlog') && t.includes('verklaart') && ((blokNaam && t.includes(blokNaam)) || t.includes(speler.naam))) return true;
  }
  return false;
}

// Geeft { totaal, regels: [{ label, waarde }], zonderOorlog, spelerWint }. Regels tonen de opbouw in het eindoverzicht.
export function berekenScore(state) {
  const u = state.uitkomst ?? { spelerWint: false, dag: state.dag };
  const dag = u.dag ?? state.dag;
  const limiet = limietVan(state);
  const aandeel = Math.max(0, Math.min(1, state.blokken.find((b) => b.id === state.spelerBlok)?.aandeel ?? 0));
  const zonderOorlog = !oorlogGevoerd(state);
  const factor = SCORE.moeilijkheid[state.instellingen?.moeilijkheid] ?? 1;
  const regels = [];
  let som = 0;
  const regel = (label, waarde) => { const w = Math.round(waarde); regels.push({ label, waarde: w }); som += w; };
  if (u.spelerWint) {
    regel('Overwinning', SCORE.winst);
    regel(`Snelheid (dag ${dag} van ${limiet})`, SCORE.snelheid * Math.max(0, (limiet - dag) / limiet));
    regel(`Aandeel blok ${(aandeel * 100).toFixed(0)}%`, SCORE.aandeel * aandeel);
    if (zonderOorlog) { const voor = som; som *= SCORE.zonderOorlog; regels.push({ label: 'Zonder oorlog: × 2', waarde: Math.round(som - voor) }); }
  } else {
    regel(`Aandeel blok ${(aandeel * 100).toFixed(0)}%`, SCORE.verliesAandeel * aandeel);
    regel(`Volgehouden tot dag ${dag}`, SCORE.verliesDagen * Math.min(1, dag / limiet));
  }
  if (factor !== 1) {
    const voor = som;
    som *= factor;
    regels.push({ label: `Moeilijkheid × ${String(factor).replace('.', ',')}`, waarde: Math.round(som - voor) });
  }
  return { totaal: Math.round(som), regels, zonderOorlog, spelerWint: !!u.spelerWint };
}
