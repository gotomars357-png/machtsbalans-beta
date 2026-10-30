// Standaardwaarden voor onderdelen die een World Pack weglaat.
// Een pack hoeft alleen te bevatten wat het anders wil; de rest komt hiervandaan.

export const ENGINE_VERSION = '0.1.0';

export const DEFAULT_FILES = {
  kaart: 'map/kaart.json',
  resources: 'economy/resources.json',
  gebouwen: 'economy/gebouwen.json',
  model: 'economy/model.json',
  schokken: 'economy/schokken.json',
  landen: 'actors/landen.json',
  blokken: 'actors/blokken.json',
  persoonlijkheden: 'actors/persoonlijkheden.json',
  acties: 'actions/acties.json',
  events: 'events/events.json',
  verhaal: 'story/verhaal.json',
  tutorial: 'story/tutorial.json',
  eenheden: 'military/eenheden.json',
  regimes: 'actors/regimes.json',
};

export const TOEGESTANE_LICENTIES = ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0', 'MIT'];
export const CLASSIFICATIES = ['fictief', 'historisch', 'actueel'];
export const VEREISTE_ROLLEN = ['energie', 'voedsel', 'geld', 'tech', 'stabiliteit'];

export const DEFAULT_MODEL = {
  alpha: 0.6,                 // exponent kapitaal in Y = A * K^alpha * L^beta
  beta: 0.4,                  // exponent arbeid
  g: 0.006,                   // groeiparameter technologiefactor (per dag)
  tech_waarde: 10,            // kapitaalwaarde van één eenheid tech-output
  tech_veroudering: 0.0001,   // dagelijkse slijtage van A zonder investering
  kapitaal_basis: 160,
  belasting_start: 0.22,
  belasting_neutraal: 0.2,
  verdeling_start: 0.1,
  energie_per_productie: 0.07,
  voedsel_per_inwoner: 0.15,
  bevolkingsgroei: 0.0004,
  stab_basis: 58,
  stab_verdeling: 70,
  stab_belasting: 90,
  stab_snelheid: 0.03,
  groei_venster: 30,
  groei_drempel: 0.08,
  groei_straf: 80,
  rente: 0.001,
  kosten_schaal: 0.2,
  prijs_referentie: 120,
  onderhoud_per_gebouw: 0.5,
  max_bouw: 2,
  bereik: 5,                  // vakjes rond hoofdstad of depot met vol rendement
  rendement_verlies: 0.1,     // rendementsverlies per vakje verder weg
  min_rendement: 0.4,
  loyaliteit_verval: 0.01,
  diplomatieke_moeheid: 0.4,
  blok_zwaartekracht: 0.012,
  route_trek: 0.008,
  drempel_alignment: 50,
  blok_handelsbonus: 0.012,
  blok_bonus_max: 0.12,
  spanning_verval: 0.05,
  basis_woningen: 1.05,       // woonruimte zonder woonwijken, als factor van de startbevolking
  complot_verspreiding: 0.004,
  complot_verval: 0.03,
  complot_stab: 0.15,
  complot_productie: 0.0015,
  controle_snelheid: 0.02,
  netwerk_trek: 0.002,
  netwerk_verval: 0.02,
  max_training: 3,
  max_eenheden: 40,
  oorlog_moeheid: 4,
  verover_dagen: 2,
  hoofdstad_beleg: 6,
  regime_affiniteit: 0.012,   // dagelijkse trek naar een blok met een leider van hetzelfde regime
  regime_hefboom: 0.15,       // invloed werkt beter bij hetzelfde regime, slechter bij een ander
  revolutie_drempel: 6,
  hervorming: { kosten: 300, stabiliteit: 20, complot: 10, afkoeling: 600 },
  kolonie_straal: 2.2,        // vakjes die een nieuwe kolonie direct claimt
  kolonie_groei: 20,          // elke zoveel dagen groeit een kolonie met één vakje
  ai_kolonie_start: 300,      // vanaf deze dag bouwt de AI een haven om te koloniseren
  ai_max_kolonies: 2,         // meer overzeese kolonies dan dit probeert de AI niet
  ai_oorlog_drempel: 1.8,     // zoveel keer sterker dan het doel moet een AI-blok zijn om oorlog te verklaren
  ai_oorlog_korting: 0.5,     // hoeveel die eis zakt bij de hoogste spanning (spanning 60 of meer)
  ai_oorlog_ver: 80,          // vanaf deze spanning komt ook een rivaal zonder gemeenschappelijke grens in beeld
  ai_oorlog_kans: 0.025,       // kans per beslismoment (elke 10 dagen) dat een AI-blok met overmacht ook echt verklaart
  ai_cyber_spanning: 15,      // vanaf deze spanning (eigen of rivaliserend blok) overweegt een AI-blok een cyberaanval
  ai_cyber_geheugen: 200,     // zo lang (dagen) onthoudt een land een cyberaanval en wil het een cybercentrum
  kolonie_opstand: 0.003,     // dagelijkse kans op opstand als de stabiliteit thuis laag is
  media_trek: 0.002,          // dagelijkse loyaliteitstrek per punt buitenlandse media-invloed
  media_verval: 0.03,
  moraal_basis: 50,           // strijdbereidheid zonder bijzondere factoren
  moraal_snelheid: 0.04,
};

export const DEFAULT_REGIMES = {
  democratie: { naam: 'Liberale democratie', icoon: '🗳', bouwstijl: 'democratie', revolutie_naar: 'militair', verkiezingen: 600,
    effecten: { productiviteit: 0.06, handel_bonus: 0.25, tech_groei: 0.00004, oorlog_moeheid: 1.5, complot_gevoeligheid: 1.3, informatiecontrole_max: 45, moraal: -5 },
    beschrijving: 'Vrije markt en vrije pers: meer handel en innovatie. Oorlog is impopulair, de pers laat geruchten vrij circuleren en elke 600 dagen zijn er verkiezingen.' },
  eenpartijstaat: { naam: 'Communistische eenpartijstaat', icoon: '⭐', bouwstijl: 'eenpartijstaat', revolutie_naar: 'democratie',
    effecten: { productiviteit: -0.03, bouw_korting: 0.2, informatiecontrole: 25, weerbaarheid: 6, tech_groei: -0.00002, handel_bonus: -0.15, moraal: 5 },
    beschrijving: 'Planeconomie: 20% goedkoper bouwen en veel grip op informatie, maar minder innovatie en handel.' },
  theocratie: { naam: 'Theocratie', icoon: '🕯', bouwstijl: 'theocratie', revolutie_naar: 'militair',
    effecten: { stabiliteit: 5, weerbaarheid: 8, informatiecontrole: 15, oorlog_moeheid: 0.5, tech_groei: -0.00004, handel_bonus: -0.1, moraal: 12 },
    beschrijving: 'Religieus gezag: stabiel, weerbaar en met brede steun voor oorlog, maar trage technologische vooruitgang en minder handel.' },
  militair: { naam: 'Militair bewind', icoon: '🎖', bouwstijl: 'militair', revolutie_naar: 'democratie', staatsgreep: 0.004,
    effecten: { leger_korting: 0.3, informatiecontrole: 20, stabiliteit: -4, productiviteit: -0.03, oorlog_moeheid: 0.7, moraal: 6 },
    beschrijving: 'Een leger dat 30% goedkoper is en harde controle. Bij onrust ligt een staatsgreep op de loer.' },
  monarchie: { naam: 'Constitutionele monarchie', icoon: '👑', bouwstijl: 'monarchie', revolutie_naar: 'democratie',
    effecten: { stabiliteit: 3, handel_bonus: 0.1, productiviteit: 0.02 },
    beschrijving: 'Gematigd en stabiel: kleine voordelen overal, geen grote zwaktes.' },
};

export const DEFAULT_RESOURCES = [
  { id: 'energie', naam: 'Energie', rol: 'energie', icoon: '⚡', kleur: '#f2c14e', start: 120, opslag_max: 500,
    tekort_effect: { stabiliteit: -20, productie_factor: 0.35 } },
  { id: 'grondstoffen', naam: 'Grondstoffen', rol: 'grondstof', icoon: '⛏', kleur: '#b08968', start: 150, opslag_max: 500,
    tekort_effect: { stabiliteit: -4 } },
  { id: 'voedsel', naam: 'Voedsel', rol: 'voedsel', icoon: '🌾', kleur: '#7fb77e', start: 120, opslag_max: 500,
    tekort_effect: { stabiliteit: -30, productie_factor: 0.8 } },
  { id: 'kapitaal', naam: 'Kapitaal', rol: 'geld', icoon: '◈', kleur: '#e8d7a5', start: 300, opslag_max: null },
  { id: 'chips', naam: 'Chips & AI', rol: 'tech', icoon: '◧', kleur: '#8fb8ff', start: 0, opslag_max: 300 },
  { id: 'stabiliteit', naam: 'Stabiliteit', rol: 'stabiliteit', icoon: '⚖', kleur: '#d6a2e8', start: 65 },
];

export const DEFAULT_GEBOUWEN = [
  { id: 'centrale', naam: 'Centrale', icoon: '⚡', terrein: ['vlakte', 'bos', 'kust'], kosten: { kapitaal: 95, grondstoffen: 25 }, bouwtijd: 8,
    productie: { energie: 12 }, verbruik: { grondstoffen: 1 } },
  { id: 'zonnepark', naam: 'Zonnepark', icoon: '☀', terrein: ['vlakte'], kosten: { kapitaal: 175, grondstoffen: 15 }, bouwtijd: 12,
    productie: { energie: 8 } },
  { id: 'mijn', naam: 'Mijn', icoon: '⛏', terrein: ['berg'], kosten: { kapitaal: 70 }, bouwtijd: 6,
    productie: { grondstoffen: 6 }, verbruik: { energie: 1.5 } },
  { id: 'houtkap', naam: 'Houtkap', icoon: '🪓', terrein: ['bos'], kosten: { kapitaal: 55 }, bouwtijd: 5,
    productie: { grondstoffen: 3.5 } },
  { id: 'boerderij', naam: 'Landbouw', icoon: '🌾', terrein: ['vlakte'], kosten: { kapitaal: 55 }, bouwtijd: 5,
    productie: { voedsel: 8 }, verbruik: { energie: 0.5 } },
  { id: 'industrie', naam: 'Industrie', icoon: '🏭', terrein: ['vlakte', 'kust', 'bos'], kosten: { kapitaal: 110, grondstoffen: 30 }, bouwtijd: 10,
    kapitaalvoorraad: 40, verbruik: { energie: 2, grondstoffen: 0.5 } },
  { id: 'chipfabriek', naam: 'Chipfabriek', icoon: '💠', terrein: ['vlakte', 'kust'], kosten: { kapitaal: 255, grondstoffen: 65 }, bouwtijd: 16,
    productie: { chips: 1.2 }, verbruik: { energie: 4, grondstoffen: 1.5 } },
  { id: 'haven', naam: 'Haven', icoon: '⚓', terrein: ['kust'], kosten: { kapitaal: 140, grondstoffen: 25 }, bouwtijd: 10,
    productie: { kapitaal: 2 }, verbruik: { energie: 1 }, handel_bonus: 0.3, opslag_bonus: 100 },
  { id: 'opslag', naam: 'Depot & wegen', icoon: '📦', knooppunt: true, kosten: { kapitaal: 80, grondstoffen: 15 }, bouwtijd: 6,
    opslag_bonus: 300, kapitaalvoorraad: 10 },
  // Maatschappij
  { id: 'woonwijk', naam: 'Woonwijk', icoon: '🏘', categorie: 'maatschappij', terrein: ['vlakte', 'kust', 'bos'], kosten: { kapitaal: 60, grondstoffen: 15 }, bouwtijd: 6,
    woningen: 12, verbruik: { energie: 0.5 }, beschrijving: 'Woonruimte voor 12 mln mensen. Zonder woningen groeit je bevolking niet.' },
  { id: 'school', naam: 'Scholen', icoon: '🏫', categorie: 'maatschappij', terrein: ['vlakte', 'kust'], kosten: { kapitaal: 90 }, bouwtijd: 8,
    tech_groei: 0.00004, productiviteit: 0.015, weerbaarheid: 3, onderhoud: 1, beschrijving: 'Hogere productiviteit en langzaam meer technologie. Ook wat weerbaarder tegen desinformatie.' },
  { id: 'universiteit', naam: 'Universiteit', icoon: '🎓', categorie: 'maatschappij', terrein: ['vlakte', 'kust'], kosten: { kapitaal: 220, grondstoffen: 30 }, bouwtijd: 16,
    tech_groei: 0.00012, productiviteit: 0.02, weerbaarheid: 4, onderhoud: 2.5, beschrijving: 'Onderzoek: de sterkste technologiegroei buiten chips.' },
  { id: 'ziekenhuis', naam: 'Ziekenhuis', icoon: '🏥', categorie: 'maatschappij', terrein: ['vlakte', 'kust', 'bos'], kosten: { kapitaal: 140, grondstoffen: 20 }, bouwtijd: 10,
    stabiliteit: 3, bevolkingsgroei: 0.0002, zorg: 1, onderhoud: 1.5, beschrijving: 'Stabiliteit, bevolkingsgroei en minder slachtoffers bij een pandemie.' },
  { id: 'politie', naam: 'Politiebureau', icoon: '🚓', categorie: 'maatschappij', kosten: { kapitaal: 80 }, bouwtijd: 6,
    stabiliteit: 2, weerbaarheid: 4, onderhoud: 1, beschrijving: 'Orde. Remt buitenlandse netwerken en verdedigt de hoofdstad mee.' },
  { id: 'rechtbank', naam: 'Rechtspraak & bestuur', icoon: '⚖', categorie: 'maatschappij', kosten: { kapitaal: 120, grondstoffen: 10 }, bouwtijd: 8,
    stabiliteit: 2.5, weerbaarheid: 3, onderhoud: 1.2, beschrijving: 'Vertrouwen in instituties. Complotdenken dooft sneller uit.' },
  { id: 'omroep', naam: 'Omroep & media', icoon: '📡', categorie: 'maatschappij', kosten: { kapitaal: 110, grondstoffen: 10 }, bouwtijd: 8,
    informatiecontrole: 15, verbruik: { energie: 1 }, onderhoud: 1, beschrijving: 'Informatiecontrole: nodig voor binnenlandse campagnes. Te veel controle wekt argwaan.' },
  // Leger
  { id: 'kazerne', naam: 'Kazerne', icoon: '⛺', categorie: 'leger', terrein: ['vlakte', 'kust', 'bos'], kosten: { kapitaal: 100, grondstoffen: 20 }, bouwtijd: 8,
    onderhoud: 0.8, beschrijving: 'Leidt infanterie op.' },
  { id: 'wapenfabriek', naam: 'Wapenfabriek', icoon: '🔧', categorie: 'leger', terrein: ['vlakte', 'kust'], kosten: { kapitaal: 200, grondstoffen: 60 }, bouwtijd: 14,
    verbruik: { energie: 3, grondstoffen: 1 }, onderhoud: 1.5, beschrijving: 'Bouwt pantser en artillerie.' },
  { id: 'dronebasis', naam: 'Dronebasis', icoon: '🛰', categorie: 'leger', terrein: ['vlakte', 'kust'], kosten: { kapitaal: 180, grondstoffen: 20, chips: 10 }, bouwtijd: 12,
    verbruik: { energie: 2 }, onderhoud: 1.5, beschrijving: 'Drones: snel, vliegen over water en terrein. Kosten chips.' },
  { id: 'cybercentrum', naam: 'Cybercentrum', icoon: '🖥', categorie: 'leger', terrein: ['vlakte', 'kust'], kosten: { kapitaal: 150, chips: 6 }, bouwtijd: 10,
    cyberverdediging: 1, verbruik: { energie: 1 }, onderhoud: 1.2, beschrijving: 'Digitale verdediging: cyberaanvallen op je land slagen minder vaak en komen vaker uit.' },
];

export const DEFAULT_EENHEDEN = [
  { id: 'infanterie', naam: 'Infanterie', icoon: '🪖', gebouw: 'kazerne', kosten: { '@geld': 45 }, bouwtijd: 6,
    hp: 100, aanval: 10, bereik: 1, snelheid: 0.6, onderhoud: 0.3, beschrijving: 'Goedkoop en taai in bos en bergen.' },
  { id: 'pantser', naam: 'Pantser', icoon: '🛡', gebouw: 'wapenfabriek', kosten: { '@geld': 120, '@grondstof': 30 }, bouwtijd: 10,
    hp: 220, aanval: 20, bereik: 1, snelheid: 0.9, onderhoud: 0.8, beschrijving: 'Sterk en snel op vlak terrein.' },
  { id: 'artillerie', naam: 'Artillerie', icoon: '💥', gebouw: 'wapenfabriek', kosten: { '@geld': 110, '@grondstof': 25 }, bouwtijd: 10,
    hp: 70, aanval: 24, bereik: 3, snelheid: 0.45, onderhoud: 0.6, beschrijving: 'Groot bereik, kwetsbaar van dichtbij.' },
  { id: 'drone', naam: 'Drones', icoon: '🛸', gebouw: 'dronebasis', kosten: { '@geld': 70, '@tech': 6 }, bouwtijd: 8, vliegt: true,
    hp: 50, aanval: 14, bereik: 2, snelheid: 1.6, onderhoud: 0.5, beschrijving: 'Snel en vliegend, maar kan geen gebied innemen.' },
  { id: 'kolonistenschip', naam: 'Kolonistenschip', icoon: '⛵', gebouw: 'haven', kosten: { '@geld': 150, '@voedsel': 40 }, bouwtijd: 10, vaart: true, kolonist: true,
    hp: 60, aanval: 0, bereik: 1, snelheid: 1.2, onderhoud: 0.4, beschrijving: 'Stuur het naar een onbewoond eiland om er een kolonie te stichten.' },
  { id: 'fregat', naam: 'Fregat', icoon: '🚢', gebouw: 'haven', kosten: { '@geld': 160, '@grondstof': 40 }, bouwtijd: 12, vaart: true,
    hp: 160, aanval: 16, bereik: 2, snelheid: 1.4, onderhoud: 0.7, beschrijving: 'Oorlogsschip: beschermt kolonies en beschiet kusten.' },
];

export const DEFAULT_PERSOONLIJKHEDEN = {
  voorzichtig: { naam: 'Voorzichtig', gevoeligheid: { handel: 1.1, kapitaal: 1.0, technologie: 1.0, veiligheid: 1.3, invloed: 0.8 },
    druk_tolerantie: 1.2, ai: { reserve: 160, invloed: 0.35, tech: 0.3, druk: 0.05, belasting: 0.2, verdeling: 0.14, leger: 1.0, cyber: 0, cyber_verdediging: 2 } },
  agressief: { naam: 'Agressief', gevoeligheid: { handel: 0.8, kapitaal: 0.9, technologie: 1.1, veiligheid: 1.4, invloed: 0.7 },
    druk_tolerantie: 0.8, ai: { reserve: 80, invloed: 0.5, tech: 0.35, druk: 0.35, belasting: 0.24, verdeling: 0.08, leger: 1.5, cyber: 0.12, cyber_verdediging: 1 } },
  opportunistisch: { naam: 'Opportunistisch', gevoeligheid: { handel: 1.3, kapitaal: 1.4, technologie: 1.1, veiligheid: 0.8, invloed: 0.9 },
    druk_tolerantie: 1.0, ai: { reserve: 100, invloed: 0.45, tech: 0.3, druk: 0.15, belasting: 0.22, verdeling: 0.1, leger: 0.8, cyber: 0.08, cyber_verdediging: 1 } },
  isolationistisch: { naam: 'Isolationistisch', gevoeligheid: { handel: 0.7, kapitaal: 0.7, technologie: 0.8, veiligheid: 0.6, invloed: 0.5 },
    druk_tolerantie: 1.4, ai: { reserve: 200, invloed: 0.15, tech: 0.25, druk: 0.05, belasting: 0.2, verdeling: 0.12, leger: 1.2, cyber: 0, cyber_verdediging: 2 } },
};

// Kosten met '@rol' verwijzen naar de resource met die rol, zodat de standaardacties in elke wereld werken.
export const DEFAULT_ACTIES = {
  hefbomen: [
    { id: 'handelsakkoord', naam: 'Handelsakkoord', hefboom: 'handel', kosten: { '@geld': 80 }, loyaliteit: 6, duur: 30,
      afkoeling: 60, handel: { inkomen_per_dag: 0.8, dagen: 180 },
      beschrijving: 'Markttoegang en tariefverlaging. Levert beide landen inkomen op.' },
    { id: 'lening', naam: 'Lening', hefboom: 'kapitaal', kosten: { '@geld': 200 }, loyaliteit: 9, duur: 20,
      afkoeling: 90, lening: { totaal: 230, dagen: 150 },
      beschrijving: 'Kapitaal nu, terugbetaling met rente later. Kost je reserve.' },
    { id: 'technologiedeal', naam: 'Technologiedeal', hefboom: 'technologie', kosten: { '@tech': 25 }, loyaliteit: 8, duur: 25,
      afkoeling: 75, tech_overdracht: 1.005,
      beschrijving: 'Chips en AI-capaciteit delen. Versnelt hun technologie.' },
    { id: 'veiligheidsgarantie', naam: 'Veiligheidsgarantie', hefboom: 'veiligheid', kosten: { '@geld': 130 }, loyaliteit: 10, duur: 30,
      afkoeling: 120, eigen_stabiliteit: -2, spanning: 3,
      beschrijving: 'Garanties en aanwezigheid. Sterk, maar verhoogt spanning.' },
    { id: 'cultuur', naam: 'Cultuur & diplomatie', hefboom: 'invloed', kosten: { '@geld': 40 }, loyaliteit: 3, duur: 40,
      afkoeling: 40, beschrijving: 'Goedkoop en traag. Steun in internationale organisaties.' },
  ],
  escalatie: [
    { trede: 1, id: 'economische_druk', naam: 'Economische druk', kosten: { '@geld': 70 }, beschikbaar: true,
      doel_loyaliteit_blok: -12, doel_stabiliteit: -6, derden_loyaliteit: -1.5, spanning: 8, afkoeling: 50,
      beschrijving: 'Tarieven en exportbeperkingen. Goedkoop, omkeerbaar, werkt traag.' },
    { trede: 2, id: 'informatiecampagne', naam: 'Informatie & invloed', kosten: { '@geld': 100, '@tech': 10 }, beschikbaar: true,
      doel_loyaliteit_blok: -10, doel_stabiliteit: -12, derden_loyaliteit: -2, spanning: 12, afkoeling: 70,
      ontdekkans: 0.3, ontdekt_loyaliteit: -7,
      beschrijving: 'Campagnes en steun aan oppositie. Kan uitkomen.' },
    { trede: 2, id: 'complot_zaaien', naam: 'Complottheorie zaaien', type: 'complot', kosten: { '@geld': 90, '@tech': 5 }, beschikbaar: true,
      complot: 25, doel_stabiliteit: -4, derden_loyaliteit: -1, spanning: 8, afkoeling: 60, ontdekkans: 0.2, ontdekt_loyaliteit: -6,
      beschrijving: 'Wantrouwen aanwakkeren. Verspreidt zich langs handelsroutes, ook terug naar jou.' },
    // Cyber (trede 3): kans van slagen en ontdekking dalen of stijgen met de weerbaarheid en cybercentra van het doelwit.
    // Elke variant heeft eigen kosten, duur en ontdekkingskans. Gericht op één gebouw kost meer en legt dat gebouw plat.
    { trede: 3, id: 'cyber', naam: 'Cyberaanval', type: 'cyber', beschikbaar: true,
      kans: 0.8, weerbaarheid_schaal: 40, verdediging: 0.5, verdediging_ontdekking: 0.6,
      spanning: 4, afkoeling: 45, derden_loyaliteit: -1.5,
      ontdekt_loyaliteit: -6, ontdekt_doel_loyaliteit: -10, ontdekt_spanning: 8, casus_belli: 120,
      gericht: { kosten_factor: 1.3, duur: 30 },
      varianten: [
        { id: 'stroomnet', naam: 'Stroomnet', kosten: { '@geld': 110, '@tech': 8 }, duur: 15, ontdekkans: 0.25,
          aandeel: 0.35, energie_voorraad: 0.5, doel_stabiliteit: -3,
          beschrijving: 'Een derde van hun centrales valt uit en hun energievoorraad lekt weg.' },
        { id: 'financien', naam: 'Financiën', kosten: { '@geld': 130, '@tech': 10 }, duur: 25, ontdekkans: 0.3,
          kapitaal: 0.08, kapitaal_max: 200, productie: 0.95,
          beschrijving: 'Banken en betalingsverkeer liggen plat: kapitaal weg en minder inkomen.' },
        { id: 'communicatie', naam: 'Communicatie', kosten: { '@geld': 90, '@tech': 6 }, duur: 25, ontdekkans: 0.2,
          moraal: -6,
          beschrijving: 'Hun omroep valt stil: geen factcheck en geen eigen mediacampagnes. Strijdbereidheid daalt wat.' },
      ],
      beschrijving: 'Aanval op stroomnet, financiën of communicatie, of gericht op één gebouw. Komt het uit, dan krijgt het doelwit een casus belli.' },
    { trede: 4, id: 'valse_vlag', naam: 'Valse-vlagoperatie', type: 'valse_vlag', kosten: { '@geld': 160 }, beschikbaar: true,
      beschuldigd_loyaliteit: -8, eigen_stabiliteit: 5, casus_belli: 150, spanning: 10, afkoeling: 120, ontdekkans: 0.25,
      ontdekt_loyaliteit: -12, ontdekt_complot: 20,
      beschrijving: 'Een incident ensceneren en dit land de schuld geven. Levert een casus belli op. Komt het uit, dan is de schade groot.' },
    { trede: 5, id: 'oorlog', naam: 'Oorlog verklaren', type: 'oorlog', kosten: { '@geld': 150 }, beschikbaar: true,
      eigen_stabiliteit: -10, derden_loyaliteit: -6, spanning: 30, afkoeling: 60,
      beschrijving: 'Je leger mag hun grondgebied in. Kost stabiliteit en loyaliteit bij derden, minder met een casus belli.' },
    { trede: 6, id: 'afschrikking', naam: 'Strategische afschrikking', beschikbaar: false, beschrijving: 'Plafond van de ladder. Gebruik betekent verlies voor iedereen.' },
  ],
  deescalatie: { naam: 'De-escalatie', kosten: { '@geld': 50 }, spanning: -15, zwevend_loyaliteit: 3, afkoeling: 90 },
  campagnes: [
    { id: 'feelgood', naam: 'Feelgood-campagne', kosten: { '@geld': 60 }, afkoeling: 40, vereist_controle: 10,
      effect: { stabiliteit: 3, controle: 6 }, beschrijving: 'Successen breed uitmeten. Klein, veilig effect.' },
    { id: 'afleiding', naam: 'Brood en spelen', kosten: { '@geld': 90 }, afkoeling: 60, vereist_controle: 10,
      effect: { stabiliteit_doel: 6, duur_dagen: 40, controle: 8, complot: 3 }, ontdekkans: 0.15, ontdekt: { complot: 12, stabiliteit: -6 },
      beschrijving: 'De aandacht verleggen naar vermaak en schandaaltjes. Werkt, tot mensen het doorzien.' },
    { id: 'zondebok', naam: 'Zondebok aanwijzen', kosten: { '@geld': 110 }, afkoeling: 90, vereist_controle: 15,
      effect: { stabiliteit: 6, oorlogssteun: 90, complot: 4, spanning: 8 }, ontdekkans: 0.2, ontdekt: { complot: 15, stabiliteit: -8 },
      beschrijving: 'Een buitenlandse vijand de schuld geven. Maakt een oorlog 90 dagen lang veel goedkoper in stabiliteit.' },
    { id: 'ontkrachten', naam: 'Complotten ontkrachten', kosten: { '@geld': 80 }, afkoeling: 40,
      effect: { complot: -15 }, beschrijving: 'Feiten, voorlichting en transparantie. Werkt ook zonder omroep.' },
  ],
  media: [
    { id: 'mediabelang', naam: 'Mediabelang kopen', type: 'belang', kosten: { '@geld': 140 }, vereist_omroep: true, groei: 20, afkoeling: 30,
      beschrijving: 'Aandelen in hun omroepen en kranten. Trekt het land langzaam naar je toe en maakt nepnieuws sterker.' },
    { id: 'nepnieuws', naam: 'Nepnieuws verspreiden', type: 'nepnieuws', kosten: { '@geld': 80, '@tech': 4 }, vereist_omroep: true, vereist_media: 10,
      complot: 8, moraal: -8, loyaliteit: -5, duur: 60, afkoeling: 25, ontdekkans: 0.15, ontdekt_loyaliteit: -8,
      beschrijving: 'Wantrouwen zaaien en de strijdbereidheid ondermijnen. Hoe meer media-invloed, hoe harder het aankomt.' },
    { id: 'factcheck', naam: 'Factcheckers en voorlichting', type: 'verdediging', kosten: { '@geld': 70 }, factcheck: 25, media_verlaging: 8, complot_verlaging: 5, afkoeling: 40,
      beschrijving: 'Verdediging tegen nepnieuws: buitenlandse media-invloed slijt sneller, complotten minder.' },
    { id: 'propaganda', naam: 'Steun voor de troepen', type: 'propaganda', kosten: { '@geld': 90 }, vereist_omroep: true, moraal: 12, duur: 60, controle: 5, complot: 2, afkoeling: 45,
      beschrijving: 'De bevolking achter de krijgsmacht krijgen: +12 strijdbereidheid gedurende 60 dagen.' },
  ],
  overname: [
    { id: 'aansluiting', naam: 'Vreedzame aansluiting', type: 'aansluiting', kosten: { '@geld': 200 }, afkoeling: 90,
      vereist: { loyaliteit: 65, media: 45, moraal_max: 40 },
      beschrijving: 'Win zonder oorlog: een land dat je vertrouwt, jouw media volgt en niet meer wil vechten, sluit zich aan.' },
    { id: 'ultimatum', naam: 'Ultimatum stellen', type: 'ultimatum', kosten: { '@geld': 100 }, afkoeling: 120,
      vereist: { overmacht: 3, moraal_max: 45 },
      beschrijving: 'Overmacht plus een bevolking die niet wil vechten: ze geven zich over. Wijzen ze het af, dan stijgen spanning en hun strijdbereidheid.' },
  ],
  netwerken: [
    { id: 'loge', naam: 'Netwerk uitbouwen', type: 'loge', kosten: { '@geld': 120 }, afkoeling: 30, groei: 20,
      beschrijving: 'Een besloten genootschap van invloedrijke mensen. Trekt het land langzaam naar je blok.' },
    { id: 'chantage', naam: 'Dossier gebruiken', type: 'chantage', kosten: { '@geld': 150 }, afkoeling: 90, vereist_netwerk: 40,
      loyaliteit: 18, doel_stabiliteit: -4, ontdekkans: 0.3, ontdekt_loyaliteit: -20, ontdekt_complot: 15,
      beschrijving: 'Druk via compromitterende dossiers. Snel en krachtig, maar als het lekt, is het netwerk weg.' },
    { id: 'oprollen', naam: 'Netwerken oprollen', type: 'oprollen', kosten: { '@geld': 100 }, afkoeling: 60, vereist_weerbaarheid: 6, verlaging: 40,
      beschrijving: 'Buitenlandse netwerken in je eigen land opsporen en ontmantelen.' },
  ],
};

export const DEFAULT_VERHAAL = {
  fasen: [
    { id: 'opbouwen', naam: 'Opbouwen', dag: 0, ontgrendelt: [], tekst: 'Bouw je economie op.' },
    { id: 'invloed', naam: 'Invloed kopen', dag: 300, ontgrendelt: ['invloed', 'commandanten', 'netwerken', 'cybercentrum'], tekst: 'Blokken worden actief.' },
    { id: 'beslissen', naam: 'Beslissen', dag: 900, ontgrendelt: ['escalatie'], tekst: 'De escalatieladder gaat open.' },
  ],
  doelen: [],
  overwinning: [
    { type: 'aandeel_productie', naam: 'Economisch overwicht', drempel: 0.45, duur_dagen: 30, min_dag: 300 },
  ],
  dag_limiet: 2400,
};

export const ZWEVEND = { id: 'zwevend', naam: 'Zwevend', kleur: '#7d8590' };
