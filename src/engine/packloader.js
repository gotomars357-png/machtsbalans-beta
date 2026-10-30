// Laadt een World Pack (map met JSON-bestanden) en vult ontbrekende delen aan met standaardwaarden.
// `readText(pad)` wordt door de host geleverd: fetch in de browser, fs in Node. Zo blijft de engine los van de omgeving.

import {
  DEFAULT_FILES, DEFAULT_MODEL, DEFAULT_RESOURCES, DEFAULT_GEBOUWEN, DEFAULT_PERSOONLIJKHEDEN,
  DEFAULT_ACTIES, DEFAULT_VERHAAL, DEFAULT_EENHEDEN, DEFAULT_REGIMES, ZWEVEND,
} from './defaults.js';
import { validatePack } from './validate.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

export async function loadPack(basePath, readText) {
  const info = [];
  const fouten = [];
  let meta;
  try {
    meta = JSON.parse(await readText(`${basePath}/pack.json`));
  } catch (e) {
    return { pack: null, rapport: { fouten: [`pack.json ontbreekt of is ongeldig: ${e.message}`], waarschuwingen: [], info } };
  }
  // Met een 'bestanden'-lijst laadt de engine alleen die bestanden; zonder lijst probeert hij de standaardpaden.
  const files = meta.bestanden ? { ...meta.bestanden } : { ...DEFAULT_FILES };
  const raw = {};
  // De tutorial is stil optioneel: een pack zonder tutorial krijgt daar geen melding over.
  const stil = new Set(['tutorial']);
  for (const key of Object.keys(DEFAULT_FILES)) {
    if (!(key in files) && !stil.has(key)) info.push(`Geen '${key}' in het pack: standaardwaarden gebruikt.`);
  }
  for (const [key, rel] of Object.entries(files)) {
    let text;
    try {
      text = await readText(`${basePath}/${rel}`);
    } catch {
      if (!stil.has(key)) info.push(`${rel} niet gevonden: standaardwaarden gebruikt voor '${key}'.`);
      continue;
    }
    try {
      raw[key] = JSON.parse(text);
    } catch (e) {
      fouten.push(`${rel} is geen geldige JSON: ${e.message}`);
    }
  }
  const pack = normalizePack(meta, raw, info);
  const rapport = validatePack(pack);
  rapport.fouten.unshift(...fouten);
  rapport.info = info;
  return { pack, rapport };
}

export function normalizePack(meta, raw, info = []) {
  const p = {};
  p.meta = {
    id: meta.id, naam: meta.naam ?? meta.id, versie: meta.versie ?? '0.0.0', auteur: meta.auteur ?? 'onbekend',
    licentie: meta.licentie, classificatie: meta.classificatie, engine_min: meta.engine_min ?? '0.0.0',
    beschrijving: meta.beschrijving ?? '', tijd: { startjaar: 2026, ...(meta.tijd || {}) },
  };
  p.model = { ...DEFAULT_MODEL, ...(raw.model || {}) };
  p.resources = raw.resources ?? clone(DEFAULT_RESOURCES);
  p.gebouwen = raw.gebouwen ?? clone(DEFAULT_GEBOUWEN);
  p.persoonlijkheden = { ...clone(DEFAULT_PERSOONLIJKHEDEN), ...(raw.persoonlijkheden || {}) };
  const acties = raw.acties || {};
  p.acties = {
    hefbomen: acties.hefbomen ?? clone(DEFAULT_ACTIES.hefbomen),
    escalatie: acties.escalatie ?? clone(DEFAULT_ACTIES.escalatie),
    deescalatie: acties.deescalatie ?? clone(DEFAULT_ACTIES.deescalatie),
    campagnes: acties.campagnes ?? clone(DEFAULT_ACTIES.campagnes),
    netwerken: acties.netwerken ?? clone(DEFAULT_ACTIES.netwerken),
    media: acties.media ?? clone(DEFAULT_ACTIES.media),
    overname: acties.overname ?? clone(DEFAULT_ACTIES.overname),
  };
  p.events = raw.events ?? [];
  p.schokken = raw.schokken ?? [];
  p.verhaal = { ...clone(DEFAULT_VERHAAL), ...(raw.verhaal || {}) };
  // Tutorial voor de eerste minuten (story/tutorial.json): alleen aanwezig als het pack stappen levert.
  const heeft = (k) => Array.isArray(raw.tutorial?.[k]) && raw.tutorial[k].length;
  p.tutorial = heeft('stappen') || heeft('tips') ? clone(raw.tutorial) : null;
  p.regimes = raw.regimes ?? clone(DEFAULT_REGIMES);

  p.rollen = {};
  for (const r of p.resources) {
    if (r.rol && !p.rollen[r.rol]) p.rollen[r.rol] = r.id;
  }

  // Kaart en landen: een maker kan beginnen met alleen een kaart. Landen en blokken worden dan afgeleid.
  const kaart = raw.kaart ? clone(raw.kaart) : null;
  let landen = raw.landen ? clone(raw.landen) : null;
  if (!landen) {
    const ids = [];
    for (const r of kaart?.regios || []) if (!ids.includes(r.land)) ids.push(r.land);
    landen = ids.map((id) => {
      const reg = kaart.regios.find((r) => r.land === id);
      return { id, naam: reg.naam ?? capitalize(id) };
    });
    if (landen.length) info.push('Geen landenbestand: landen afgeleid uit de kaart.');
  }
  let blokken = raw.blokken ? clone(raw.blokken) : null;
  if (!blokken) {
    const kleuren = ['#4c8ef7', '#e5534b', '#2bb5a0', '#c38fff', '#f0a33a'];
    const kernen = landen.filter((l) => l.kern);
    const basis = (kernen.length ? kernen : landen).slice(0, 3);
    blokken = basis.map((l, i) => ({ id: `blok_${l.id}`, naam: `Blok ${l.naam}`, kleur: kleuren[i % kleuren.length] }));
    basis.forEach((l, i) => { l.blok = blokken[i].id; l.kern = true; });
    if (blokken.length) info.push('Geen blokkenbestand: één blok per kernland aangemaakt.');
  }
  p.blokken = blokken;
  p.zwevend = { ...ZWEVEND };

  const startGebouwen = defaultStartGebouwen(p);
  const geldStart = p.resources.find((r) => r.id === p.rollen.geld)?.start ?? 300;
  const rolSleutels = (obj) => {
    if (!obj) return obj;
    const uit = {};
    for (const [k, v] of Object.entries(obj)) uit[k.startsWith('@') ? (p.rollen[k.slice(1)] ?? k) : k] = v;
    return uit;
  };
  p.eenheden = raw.eenheden ?? clone(DEFAULT_EENHEDEN);
  const metKosten = [...p.acties.hefbomen, ...p.acties.escalatie, ...p.acties.escalatie.flatMap((e) => e.varianten || []), p.acties.deescalatie, ...p.acties.campagnes, ...p.acties.netwerken, ...p.acties.media, ...p.acties.overname, ...p.eenheden];
  for (const a of metKosten) a.kosten = rolSleutels(a.kosten);

  p.landen = landen.map((l) => {
    const blok = l.blok && l.blok !== 'zwevend' ? l.blok : null;
    const loyaliteit = {};
    for (const b of blokken) {
      loyaliteit[b.id] = l.loyaliteit?.[b.id] ?? (blok === b.id ? (l.kern ? 90 : 60) : blok ? 15 : 35);
    }
    return {
      id: l.id, naam: l.naam ?? capitalize(l.id), blok, kern: !!l.kern && !!blok,
      speelbaar: l.speelbaar ?? (!!l.kern && !!blok),
      persoonlijkheid: p.persoonlijkheden[l.persoonlijkheid] ? l.persoonlijkheid : 'voorzichtig',
      persoonlijkheidOpgegeven: l.persoonlijkheid,
      regime: p.regimes[l.regime] ? l.regime : (p.regimes.democratie ? 'democratie' : Object.keys(p.regimes)[0]),
      regimeOpgegeven: l.regime,
      leider: l.leider ?? 'De Regering',
      bevolking: l.bevolking ?? 40,
      gebouwen: { ...(l.start?.gebouwen ?? startGebouwen) },
      kapitaal: l.start?.kapitaal ?? geldStart,
      techFactor: l.start?.tech_factor ?? 1,
      loyaliteit,
      beschrijving: l.beschrijving ?? '',
    };
  });

  p.kaart = kaart && kaart.regios?.length ? kaart : autoKaart(p.landen);
  p.kaart.breedte ??= 1000;
  p.kaart.hoogte ??= 620;
  p.kaart.zee ??= [];
  p.kaart.handelsroutes ??= [];
  p.kaart.knelpunten ??= [];
  return p;
}

function defaultStartGebouwen(p) {
  const res = {};
  const rolVan = (id) => p.resources.find((r) => r.id === id)?.rol;
  const pick = (pred) => p.gebouwen.find(pred)?.id;
  const energie = pick((g) => g.productie && Object.keys(g.productie).some((r) => rolVan(r) === 'energie'));
  const voedsel = pick((g) => g.productie && Object.keys(g.productie).some((r) => rolVan(r) === 'voedsel'));
  const grond = pick((g) => g.productie && Object.keys(g.productie).some((r) => rolVan(r) === 'grondstof'));
  const industrie = pick((g) => g.kapitaalvoorraad >= 30);
  for (const id of [energie, voedsel, grond, industrie]) if (id) res[id] = 2;
  return res;
}

function autoKaart(landen) {
  const n = Math.max(landen.length, 1);
  return {
    breedte: 1000, hoogte: 620, zee: [], handelsroutes: [], knelpunten: [],
    regios: landen.map((l, i) => ({
      land: l.id,
      x: 500 + Math.cos((i / n) * Math.PI * 2) * 300,
      y: 310 + Math.sin((i / n) * Math.PI * 2) * 200,
    })),
  };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
