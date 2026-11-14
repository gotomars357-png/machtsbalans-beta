// C12: tekeningen die bij de kavels horen. Varianten van opslag, industrie, centrale en mijn (buren van dezelfde soort
// verschillen), soorten die de omgeving vraagt (stadsboerderij, zagerij, compacte centrale, distributiecentrum, haven
// met de kade langs het echte water) en eigen tekeningen voor olieveld, staalfabriek, spoor en ruimtevaartcentrum.
//
// Alleen detail.js importeert dit bestand. De tekenhulpen komen als H binnen (geen kringverwijzing); ze worden pas bij
// het tekenen gebruikt. Elke tekening tekent in het vak (x, y, s) van het gebouw, zoals de tekeningen in detail.js:
// eerst een vlak-vullende grond (die op een kavel wegvalt), dan de massa's. Geen tekst, cijfers, vlaggen of merken.
// Geen toevalsgenerator: alle plaatsing volgt uit hash(B.seed, …).

export function maakTekeningen(H) {
  const { B, rect, rond, pand, silo, boom, lijn, hash, tint, levend, raamVast, rails, spoorwagons, steenhoop, lopendeBand, hoogspanningsmast, kolenBunker, L } = H;
  const CONTAINERS = H.CONTAINERS, AKKER = H.AKKER, GLAS = H.GLAS;
  const gras = () => H.kleuren().GRAS, grasLicht = () => H.kleuren().GRAS_LICHT, heg = () => H.kleuren().HEG;

  // ---------- kleine bouwstenen ----------

  // Schoorsteen met lange schaduw en rook (per beeld).
  function schoorsteen(c, x, y, s, r = 0.022, kleur = '#5a4f46') {
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = s * r * 1.1;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + s * r * 5, y + s * r * 3); c.stroke();
    c.fillStyle = kleur; rond(c, x, y, s * r);
    c.fillStyle = '#2a2420'; rond(c, x, y, s * r * 0.55);
    if (B.lod >= 1) { c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = lijn(s, 0.002); c.beginPath(); c.arc(x, y, s * r * 0.8, Math.PI, Math.PI * 1.6); c.stroke(); }
    levend(L.ROOK, x, y, s * 0.8);
  }

  // Ronde tank met dak en een ring, met een betonnen bak eromheen als er meer staan.
  function tank(c, x, y, r, kleur = '#d8dadc') {
    c.fillStyle = 'rgba(0,0,0,0.28)'; rond(c, x + r * 0.4, y + r * 0.32, r);
    c.fillStyle = tint(kleur, 0.82); rond(c, x, y, r);
    c.fillStyle = kleur; rond(c, x - r * 0.08, y - r * 0.08, r * 0.86);
    if (B.lod >= 1) {
      c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = lijn(B.S, 0.0025);
      c.beginPath(); c.arc(x - r * 0.08, y - r * 0.08, r * 0.55, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#8c9094'; rond(c, x - r * 0.08, y - r * 0.08, Math.max(0.5, r * 0.1));
    }
  }

  // Pijpleiding als dubbele lijn met schaduw.
  function leiding(c, pts, s, dik = 0.006, kleur = '#8c949c') {
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = lijn(s, dik * 1.4);
    c.beginPath(); c.moveTo(pts[0] + s * 0.004, pts[1] + s * 0.004); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i] + s * 0.004, pts[i + 1] + s * 0.004); c.stroke();
    c.strokeStyle = kleur; c.lineWidth = lijn(s, dik);
    c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.stroke();
  }

  // Plat dak met een rij lichtstraten (de ramen ervan branden 's nachts).
  function lichtstraten(c, x, top, w, d, n, s) {
    if (B.lod < 1) return;
    for (let i = 0; i < n; i++) {
      const lx = x + (w * (i + 0.5)) / n - s * 0.008;
      rect(c, lx, top + d * 0.12, s * 0.016, d * 0.76, '#a9bcc6');
      if (B.lod >= 2) { c.strokeStyle = 'rgba(40,50,60,0.3)'; c.lineWidth = lijn(s, 0.0015); c.beginPath(); c.moveTo(lx + s * 0.008, top + d * 0.12); c.lineTo(lx + s * 0.008, top + d * 0.88); c.stroke(); }
    }
  }

  // Koelcellen van een gascentrale: een blok met ronde ventilatoren.
  function koelcellen(c, x, y, w, d, n, s) {
    rect(c, x + s * 0.006, y + s * 0.005, w, d, 'rgba(0,0,0,0.28)');
    rect(c, x, y, w, d, '#9ea3a8');
    const r = Math.min(w / n, d) * 0.36;
    for (let i = 0; i < n; i++) {
      const fx = x + (w * (i + 0.5)) / n, fy = y + d / 2;
      c.fillStyle = '#5f6468'; rond(c, fx, fy, r);
      c.fillStyle = '#3d4246'; rond(c, fx, fy, r * 0.7);
      if (B.lod >= 1) { c.fillStyle = '#7d8388'; rond(c, fx, fy, r * 0.18); }
      levend(L.STOOM, fx, fy, r * 1.4);
    }
  }

  // Grote koeltoren (zoals de centrale van detail.js, maar los aan te roepen).
  function koeltoren(c, tx, ty, R, s, i = 0) {
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath(); c.ellipse(tx + R * 0.4, ty + R * 0.3, R, R * 0.95, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#b9bcc0'; rond(c, tx, ty, R);
    c.fillStyle = '#d3d5d8'; rond(c, tx - R * 0.06, ty - R * 0.06, R * 0.9);
    c.fillStyle = '#9a9da1'; rond(c, tx, ty, R * 0.72);
    c.fillStyle = '#5f6468'; rond(c, tx + R * 0.04, ty + R * 0.04, R * 0.6);
    if (B.lod >= 1) { c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = lijn(s, 0.003); c.beginPath(); c.arc(tx, ty, R * 0.84, 0, Math.PI * 2); c.stroke(); levend(L.KNIPPER, tx + R * 0.7, ty - R * 0.7, s, 0, i); }
    if (B.lod >= 2) { c.fillStyle = '#4f6f7a'; rond(c, tx + R * 0.05, ty + R * 0.05, R * 0.42); }
    levend(L.STOOM, tx, ty, R * 2.2);
  }

  // Een stapel stammen met kopse kanten (liggend = oost-west).
  function stammen(c, x, y, w, h, s) {
    rect(c, x + s * 0.006, y + s * 0.006, w, h, 'rgba(0,0,0,0.25)');
    rect(c, x, y, w, h, '#7a5a38');
    if (B.lod >= 1) {
      c.fillStyle = '#c8a46e';
      const r = Math.min(h / 6, s * 0.011);
      for (let j = 0; j < Math.floor(h / (r * 2.2)); j++) rond(c, x + r * 1.2, y + r * 1.2 + j * r * 2.2, r);
      c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = lijn(s, 0.0015);
      c.beginPath(); for (let j = 1; j < 3; j++) { c.moveTo(x + r * 2.6, y + (h * j) / 3); c.lineTo(x + w, y + (h * j) / 3); } c.stroke();
    }
  }

  // Planken op latten.
  function planken(c, x, y, w, h, s) {
    rect(c, x + s * 0.004, y + s * 0.004, w, h, 'rgba(0,0,0,0.25)');
    rect(c, x, y, w, h, '#d7b98a');
    if (B.lod >= 1) { c.strokeStyle = 'rgba(120,85,45,0.45)'; c.lineWidth = lijn(s, 0.0015); c.beginPath(); for (let j = 1; j < 4; j++) { c.moveTo(x, y + (h * j) / 4); c.lineTo(x + w, y + (h * j) / 4); } c.stroke(); }
  }

  // Jaknikker op een grindplaats met een hekje: voet, balk met kop en contragewicht (van boven, met schaduw).
  function jaknikker(c, x, y, s, i) {
    const r = s * 0.065;
    rect(c, x - r * 1.1, y - r * 0.8, r * 2.2, r * 1.6, '#b9ae94');
    if (B.lod >= 1) { c.strokeStyle = 'rgba(90,90,90,0.55)'; c.lineWidth = lijn(s, 0.0015); c.strokeRect(x - r * 1.1, y - r * 0.8, r * 2.2, r * 1.6); }
    c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = lijn(s, 0.014);
    c.beginPath(); c.moveTo(x - r * 0.75 + s * 0.008, y + s * 0.007); c.lineTo(x + r * 0.85 + s * 0.008, y + s * 0.007); c.stroke();
    rect(c, x - r * 0.12, y - r * 0.35, r * 0.24, r * 0.7, '#5a5e62'); // bok
    c.strokeStyle = '#3e4246'; c.lineWidth = lijn(s, 0.012);
    c.beginPath(); c.moveTo(x - r * 0.75, y); c.lineTo(x + r * 0.8, y); c.stroke();
    c.fillStyle = '#3e4246'; c.beginPath(); c.moveTo(x + r * 0.7, y - r * 0.3); c.quadraticCurveTo(x + r * 1.05, y, x + r * 0.7, y + r * 0.3); c.closePath(); c.fill(); // kop
    rect(c, x - r * 0.95, y - r * 0.32, r * 0.42, r * 0.64, i % 2 ? '#b0392b' : '#d7a020'); // contragewicht
    c.fillStyle = '#2a2826'; rond(c, x + r * 0.95, y + r * 0.55, s * 0.007); // bronkop
  }

  // Rechthoek in het assenstelsel van zijde z van het vak: q langs de zijde (-0,5..0,5), d diepte vanaf de rand.
  function zijRect(c, x, y, s, z, q0, q1, d0, d1, kleur) {
    let rx, ry, rw, rh;
    if (z === 0) { rx = x + q0 * s; ry = y - s / 2 + d0 * s; rw = (q1 - q0) * s; rh = (d1 - d0) * s; }
    else if (z === 2) { rx = x + q0 * s; ry = y + s / 2 - d1 * s; rw = (q1 - q0) * s; rh = (d1 - d0) * s; }
    else if (z === 1) { rx = x + s / 2 - d1 * s; ry = y + q0 * s; rw = (d1 - d0) * s; rh = (q1 - q0) * s; }
    else { rx = x - s / 2 + d0 * s; ry = y + q0 * s; rw = (d1 - d0) * s; rh = (q1 - q0) * s; }
    if (kleur) rect(c, rx, ry, rw, rh, kleur);
    return [rx, ry, rw, rh];
  }
  const zijPunt = (x, y, s, z, q, d) => (z === 0 ? [x + q * s, y - s / 2 + d * s] : z === 2 ? [x + q * s, y + s / 2 - d * s] : z === 1 ? [x + s / 2 - d * s, y + q * s] : [x - s / 2 + d * s, y + q * s]);

  // Aan welke zijde van het vak ligt het water? Uit de natte cellen van de omgeving, gewogen naar hun richting.
  function waterZijde(o) {
    if (!o) return 2;
    let sx = 0, sy = 0;
    const wm = o.waterMasker;
    if (wm) for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) if (wm[j * 8 + i]) { sx += i - 3.5; sy += j - 3.5; }
    if (sx === 0 && sy === 0) { for (let z = 0; z < 4; z++) if ((o.water >> z) & 1) return z; return 2; }
    return Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 1 : 3) : sy > 0 ? 2 : 0;
  }

  // ---------- varianten ----------

  const opslag1 = (c, x, y, s, st) => {
    // één lange hal met docks aan de voorkant en een containerplein erachter
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8a857c');
    const hx = x - s * 0.44, hy = y - s * 0.06 + 2 * s * 0.017, hw = s * 0.88, hd = s * 0.3;
    const top = pand(c, hx, hy, hw, hd, 2, '#9aa1a8', '#b3b8bc', { units: 0, geenRamen: true });
    lichtstraten(c, hx, top, hw, hd, 6, s);
    if (lod >= 1) for (let i = 0; i < 8; i++) rect(c, hx + hw * (0.05 + i * 0.118), hy + hd - s * 0.018, hw * 0.07, s * 0.016, '#2e2a26');
    for (let i = 0; i < 3 + n; i++) for (let j = 0; j < 2; j++) {
      const cx = x - s * 0.42 + i * s * 0.14, cy = y - s * 0.42 + j * s * 0.085, kl = CONTAINERS[Math.floor(hash(B.seed, i, j + 60) * CONTAINERS.length)];
      if (cx > x + s * 0.32) continue;
      rect(c, cx + s * 0.006, cy + s * 0.006, s * 0.12, s * 0.06, 'rgba(0,0,0,0.3)');
      rect(c, cx, cy, s * 0.12, s * 0.06, kl);
      if (lod >= 1) { c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = lijn(s, 0.0015); c.beginPath(); for (let k = 1; k < 6; k++) { c.moveTo(cx + (s * 0.12 * k) / 6, cy); c.lineTo(cx + (s * 0.12 * k) / 6, cy + s * 0.06); } c.stroke(); }
    }
    // portaalkraan over het containerplein
    pand(c, x + s * 0.3, y + s * 0.3 + 2 * s * 0.017, s * 0.14, s * 0.1, 2, st.daken[0], st.muur, { schuin: !st.plat && !st.blokken, raamAfstand: 0.03 });
    if (lod >= 1) { rect(c, x + s * 0.36, y - s * 0.46, s * 0.025, s * 0.2, '#c9961e'); rect(c, x - s * 0.44, y - s * 0.46, s * 0.025, s * 0.2, '#c9961e'); rect(c, x - s * 0.44, y - s * 0.37, s * 0.825, s * 0.02, '#e0b020'); }
  };

  const opslag2 = (c, x, y, s, st) => {
    // tankopslag: tanks in een betonnen bak, leidingen naar een laadstation en een klein kantoor
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8a857c');
    rect(c, x - s * 0.45, y - s * 0.45, s * 0.9, s * 0.56, '#77736b');
    rect(c, x - s * 0.43, y - s * 0.43, s * 0.86, s * 0.52, '#9b978d');
    const plekken = [[-0.27, -0.27], [0.0, -0.27], [0.27, -0.27], [-0.27, -0.03], [0.0, -0.03], [0.27, -0.03]];
    const aantal = 3 + n;
    for (let i = 0; i < aantal; i++) { const [dx, dy] = plekken[i]; tank(c, x + dx * s, y + dy * s, s * 0.1, i % 3 === 1 ? '#e2e4e6' : '#d0d4d7'); }
    if (lod >= 1) leiding(c, [x - s * 0.27, y + s * 0.07, x - s * 0.27, y + s * 0.18, x + s * 0.2, y + s * 0.18], s, 0.007);
    pand(c, x + s * 0.2, y + s * 0.16 + 2 * s * 0.017, s * 0.22, s * 0.1, 2, st.daken[0], st.muur, { schuin: !st.plat && !st.blokken, raamAfstand: 0.04 });
    // laadstation met luifel
    rect(c, x - s * 0.36, y + s * 0.24, s * 0.4, s * 0.12, '#6b6e70');
    rect(c, x - s * 0.36, y + s * 0.24, s * 0.4, s * 0.03, '#b3b8bc');
    if (lod >= 1) for (let i = 0; i < 3; i++) { c.fillStyle = '#d7a020'; rond(c, x - s * (0.3 - i * 0.13), y + s * 0.31, s * 0.008); }
  };

  const industrie1 = (c, x, y, s, st) => {
    // twee hallen naast elkaar met een rolbrug over het buitenterrein en een stapel staalrollen
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8a857c');
    const top1 = pand(c, x - s * 0.44, y - s * 0.42 + 3 * s * 0.017, s * 0.4, s * 0.38, 3, '#6f7880', '#8d949a', { units: 0, raamAfstand: 0.05 });
    lichtstraten(c, x - s * 0.44, top1, s * 0.4, s * 0.38, 4, s);
    const top2 = pand(c, x + s * 0.0, y - s * 0.42 + 2 * s * 0.017, s * 0.26, s * 0.38, 2, '#7d6f62', '#9a8d80', { units: 0, raamAfstand: 0.05 });
    if (lod >= 1) for (let i = 0; i < 5; i++) rect(c, x + s * 0.0, top2 + s * (0.03 + i * 0.07), s * 0.26, s * 0.012, 'rgba(255,255,255,0.12)');
    // buitenterrein met rolbrug
    const bx = x + s * 0.3, by = y - s * 0.42;
    rect(c, bx, by, s * 0.15, s * 0.38, '#7a766e');
    for (let i = 0; i < 4 + n; i++) { const ry = by + s * (0.05 + i * 0.055); c.fillStyle = '#5d6166'; rond(c, bx + s * 0.05, ry, s * 0.018); rond(c, bx + s * 0.1, ry, s * 0.018); c.fillStyle = '#8b9096'; rond(c, bx + s * 0.05, ry, s * 0.008); rond(c, bx + s * 0.1, ry, s * 0.008); }
    if (lod >= 1) { rect(c, bx - s * 0.01, by + s * 0.12, s * 0.17, s * 0.016, '#e0b020'); rect(c, bx - s * 0.01, by + s * 0.11, s * 0.012, s * 0.036, '#c9961e'); rect(c, bx + s * 0.148, by + s * 0.11, s * 0.012, s * 0.036, '#c9961e'); }
    schoorsteen(c, x - s * 0.1, y + s * 0.1, s, 0.02);
    // kantoor en fietsenstalling aan de voorkant
    pand(c, x - s * 0.44, y + s * 0.18 + 3 * s * 0.017, s * 0.3, s * 0.12, 3, st.daken[0], st.muur, { schuin: !st.plat && !st.blokken, raamAfstand: 0.025 });
    rect(c, x + s * 0.05, y + s * 0.2, s * 0.36, s * 0.14, '#6f6b63');
    if (lod >= 1) for (let i = 0; i < 4; i++) { const hx = x + s * (0.08 + i * 0.085); rect(c, hx, y + s * 0.23, s * 0.06, s * 0.08, i % 2 ? '#8a7f70' : '#9a8f80'); }
    if (n >= 3) rails(c, x - s * 0.5, x + s * 0.5, y + s * 0.44, s);
  };

  const industrie2 = (c, x, y, s, st) => {
    // chemische fabriek: een pijpenbrug, procestorens, een fakkel en opslagtanks
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8a857c');
    // pijpenbrug van west naar oost
    rect(c, x - s * 0.44, y - s * 0.06, s * 0.88, s * 0.05, '#6d7072');
    if (lod >= 1) { c.strokeStyle = '#a6acb1'; c.lineWidth = lijn(s, 0.004); c.beginPath(); for (let k = 0; k < 4; k++) { const py = y - s * 0.052 + k * s * 0.012; c.moveTo(x - s * 0.44, py); c.lineTo(x + s * 0.44, py); } c.stroke(); }
    // procestorens (hoog, ronde koppen) ten noorden van de brug
    const torens = [[-0.32, -0.26, 0.05], [-0.18, -0.3, 0.04], [-0.06, -0.24, 0.055], [0.08, -0.31, 0.035]];
    for (let i = 0; i < 2 + n; i++) { const [dx, dy, r] = torens[i]; tank(c, x + dx * s, y + dy * s, r * s, '#c8ccd0'); if (lod >= 1) levend(L.STOOM, x + dx * s, y + dy * s, s * 0.08); }
    pand(c, x + s * 0.18, y - s * 0.42 + 2 * s * 0.017, s * 0.26, s * 0.24, 2, '#8c949c', '#a0a6ab', { units: 0, raamAfstand: 0.05 });
    // tanks ten zuiden van de brug, in een bak
    rect(c, x - s * 0.44, y + s * 0.06, s * 0.5, s * 0.22, '#77736b');
    rect(c, x - s * 0.43, y + s * 0.07, s * 0.48, s * 0.2, '#9b978d');
    for (let i = 0; i < 3; i++) tank(c, x - s * (0.34 - i * 0.15), y + s * 0.17, s * 0.065, '#e2e4e6');
    // fakkel
    const fx = x + s * 0.36, fy = y + s * 0.14;
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = s * 0.012; c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + s * 0.12, fy + s * 0.07); c.stroke();
    c.fillStyle = '#6d7174'; rond(c, fx, fy, s * 0.012);
    levend(L.VUUR, fx, fy);
    levend(L.KNIPPER, fx + s * 0.02, fy - s * 0.02, s, 0, 2);
    pand(c, x + s * 0.12, y + s * 0.3 + 2 * s * 0.017, s * 0.3, s * 0.1, 2, st.daken[0], st.muur, { schuin: !st.plat && !st.blokken, raamAfstand: 0.04 });
  };

  const centrale1 = (c, x, y, s, st) => {
    // gascentrale: twee turbinehallen, een slanke schoorsteen, koelcellen en een schakelstation
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8f8b82');
    for (let i = 0; i < 1 + (n >= 2 ? 1 : 0); i++) {
      const hx = x - s * 0.44, hy = y - s * 0.42 + i * s * 0.2 + 3 * s * 0.017;
      const top = pand(c, hx, hy, s * 0.46, s * 0.15, 3, '#6f747a', st.muur, { units: 0, raamAfstand: 0.04 });
      if (lod >= 1) rect(c, hx + s * 0.02, top + s * 0.03, s * 0.42, s * 0.012, 'rgba(255,255,255,0.15)');
    }
    koelcellen(c, x + s * 0.08, y - s * 0.42, s * 0.36, s * 0.1, 4, s);
    if (n >= 3) koelcellen(c, x + s * 0.08, y - s * 0.28, s * 0.36, s * 0.1, 4, s);
    schoorsteen(c, x + s * 0.18, y + s * 0.02, s, 0.026, '#a59a90');
    if (n >= 2) schoorsteen(c, x + s * 0.3, y + s * 0.02, s, 0.022, '#a59a90');
    // schakelstation in het zuiden
    const zx = x - s * 0.44, zy = y + s * 0.2, zw = s * 0.5, zh = s * 0.2;
    rect(c, zx, zy, zw, zh, '#a8a294');
    if (lod >= 1) {
      c.strokeStyle = '#d0d3d6'; c.lineWidth = lijn(s, 0.003);
      c.beginPath();
      for (let i = 0; i <= 5; i++) { c.moveTo(zx + (zw * i) / 5, zy); c.lineTo(zx + (zw * i) / 5, zy + zh); }
      c.moveTo(zx, zy + zh / 2); c.lineTo(zx + zw, zy + zh / 2);
      c.stroke();
      for (let i = 0; i < 4; i++) rect(c, zx + zw * (0.08 + i * 0.23), zy + zh * 0.2, s * 0.035, s * 0.035, '#5f6a72');
    }
    hoogspanningsmast(c, x + s * 0.36, y + s * 0.42, s * 0.12);
    // gasleiding van de rand naar de hallen
    if (lod >= 1) leiding(c, [x + s * 0.48, y - s * 0.12, x + s * 0.04, y - s * 0.12, x + s * 0.04, y - s * 0.2], s, 0.008, '#d7a020');
  };

  const centrale2 = (c, x, y, s, st) => {
    // één grote koeltoren, een hoog ketelhuis met kolenbunker en band
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8f8b82');
    koeltoren(c, x + s * 0.2, y - s * 0.2, s * (0.2 + 0.02 * (n - 1)), s, 0);
    const top = pand(c, x - s * 0.44, y - s * 0.3 + 5 * s * 0.017, s * 0.26, s * 0.22, 5, '#6a6f75', st.muur, { units: 0, raamAfstand: 0.035 });
    if (lod >= 1) rect(c, x - s * 0.44, top, s * 0.26, s * 0.03, '#565b60');
    schoorsteen(c, x - s * 0.08, y - s * 0.38, s, 0.026, '#a59a90');
    kolenBunker(c, x - s * 0.32, y + s * 0.2, s);
    lopendeBand(c, x - s * 0.32, y + s * 0.16, x - s * 0.32, y - s * 0.02);
    if (n >= 2) koeltoren(c, x + s * 0.3, y + s * 0.18, s * 0.13, s, 1);
    pand(c, x - s * 0.18, y + s * 0.26 + 2 * s * 0.017, s * 0.28, s * 0.12, 2, '#7d858c', '#9a958c', { raamAfstand: 0.04 });
    hoogspanningsmast(c, x + s * 0.1, y + s * 0.47, s * 0.12);
  };

  const mijn1 = (c, x, y, s, st) => {
    // schachtmijn: schachttoren, ophaalgebouw, stort (piramide) en een laadspoor
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, H.AARDE);
    // stort in het noordoosten: een kegel van gruis van bovenaf, lichte flank naar het licht, met regengeulen
    const px = x + s * 0.22, py = y - s * 0.2, r = s * (0.15 + 0.015 * n);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(px + r * 0.28, py + r * 0.22, r * 1.04, r * 0.98, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#5c5246'; rond(c, px, py, r);
    c.fillStyle = '#76695a'; c.beginPath(); c.moveTo(px, py); c.arc(px, py, r, Math.PI * 0.75, Math.PI * 1.75); c.closePath(); c.fill();
    c.fillStyle = '#685c4e'; c.beginPath(); c.moveTo(px, py); c.arc(px, py, r, Math.PI * 1.75, Math.PI * 2.05); c.closePath(); c.fill();
    if (lod >= 1) {
      c.strokeStyle = 'rgba(40,32,24,0.22)'; c.lineWidth = lijn(s, 0.002);
      c.beginPath();
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + hash(B.seed, i, 71) * 0.4; c.moveTo(px + Math.cos(a) * r * 0.18, py + Math.sin(a) * r * 0.18); c.lineTo(px + Math.cos(a) * r * 0.95, py + Math.sin(a) * r * 0.95); }
      c.stroke();
    }
    c.fillStyle = '#8a7c69'; rond(c, px - r * 0.04, py - r * 0.04, r * 0.13);
    // schachttoren: hoog vierkant met twee wielen
    const tx = x - s * 0.18, ty = y - s * 0.16;
    const top = pand(c, tx - s * 0.06, ty - s * 0.06 + 6 * s * 0.017, s * 0.12, s * 0.12, 6, '#7a4a38', '#9a6a52', { units: 0, raamAfstand: 0.03 });
    if (lod >= 1) { c.fillStyle = '#3a3836'; rond(c, tx - s * 0.025, top + s * 0.06, s * 0.022); rond(c, tx + s * 0.025, top + s * 0.06, s * 0.022); c.fillStyle = '#8b9096'; rond(c, tx - s * 0.025, top + s * 0.06, s * 0.008); rond(c, tx + s * 0.025, top + s * 0.06, s * 0.008); }
    levend(L.SCHACHT ?? L.KNIPPER, tx, top + s * 0.06, s * 0.02, 0, 0);
    pand(c, x - s * 0.44, y + s * 0.02 + 2 * s * 0.017, s * 0.24, s * 0.14, 2, st.daken[0], st.muur, { schuin: !st.plat && !st.blokken, raamAfstand: 0.05 });
    if (lod >= 1) lopendeBand(c, tx + s * 0.06, ty, px - r * 0.3, py + r * 0.2);
    // laadspoor met wagens
    rails(c, x - s * 0.5, x + s * 0.5, y + s * 0.3, s);
    spoorwagons(c, x - s * 0.3, y + s * 0.3, 3 + (n >= 2 ? 2 : 0), '#5a4a3a', '#2e2a26');
    if (lod >= 1) rect(c, x - s * 0.44, y + s * 0.36, s * 0.3, s * 0.06, '#6e6152');
  };

  const mijn2 = (c, x, y, s, st) => {
    // steengroeve: rechthoekige getrapte put, breker en stapels gebroken steen
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#9a9182');
    const ringen = 3 + lod;
    for (let i = 0; i < ringen; i++) {
      const f = i / ringen, w = s * (0.62 - f * 0.4), h = s * (0.46 - f * 0.3);
      c.fillStyle = tint('#b0a796', 1 - f * 0.45);
      c.fillRect(x - s * 0.12 - w / 2, y - s * 0.12 - h / 2, w, h);
      if (lod >= 1) { c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(x - s * 0.12 - w / 2, y - s * 0.12 + h / 2 - s * 0.008, w, s * 0.008); }
    }
    c.fillStyle = '#4b6b70'; c.fillRect(x - s * 0.17, y - s * 0.15, s * 0.1, s * 0.06);
    // breker met band naar de stapels
    pand(c, x + s * 0.22, y - s * 0.38 + 3 * s * 0.017, s * 0.18, s * 0.14, 3, '#8a8f94', '#a39e94', { units: 0, raamAfstand: 0.05 });
    for (let i = 0; i < 2 + (n >= 2 ? 1 : 0); i++) steenhoop(c, x + s * (0.22 + (i % 2) * 0.13), y + s * (0.06 + Math.floor(i / 2) * 0.14), s * 0.05);
    if (lod >= 1) lopendeBand(c, x + s * 0.3, y - s * 0.2, x + s * 0.24, y + s * 0.02);
    levend(L.VOERTUIG, x - s * 0.12, y - s * 0.12, s * 0.22, s * 0.16, 0);
    pand(c, x - s * 0.44, y + s * 0.3 + 2 * s * 0.017, s * 0.2, s * 0.1, 2, st.daken[0], st.muur, { schuin: !st.plat && !st.blokken, raamAfstand: 0.05 });
  };

  // ---------- soorten uit de omgeving ----------

  const stadsboerderij = (c, x, y, s, st) => {
    // in de kern: kassen, moestuinbakken, een schuur met winkeltje en een kippenren
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, grasLicht());
    // twee kassen in het noorden
    for (let i = 0; i < 1 + (n >= 2 ? 1 : 0); i++) {
      const kx = x - s * 0.44 + i * s * 0.46, ky = y - s * 0.44, kw = s * 0.42, kh = s * 0.26;
      rect(c, kx + s * 0.006, ky + s * 0.006, kw, kh, 'rgba(0,0,0,0.22)');
      rect(c, kx, ky, kw, kh, '#c7dde0');
      if (lod >= 1) {
        c.strokeStyle = 'rgba(90,120,125,0.55)'; c.lineWidth = lijn(s, 0.002);
        c.beginPath(); for (let k = 1; k < 8; k++) { c.moveTo(kx + (kw * k) / 8, ky); c.lineTo(kx + (kw * k) / 8, ky + kh); } c.moveTo(kx, ky + kh / 2); c.lineTo(kx + kw, ky + kh / 2); c.stroke();
        c.fillStyle = 'rgba(110,150,80,0.35)'; for (let k = 0; k < 8; k++) c.fillRect(kx + (kw * k) / 8 + s * 0.006, ky + s * 0.01, kw / 8 - s * 0.012, kh - s * 0.02);
      }
      raamVast(kx, ky, kw, kh);
    }
    // moestuinbakken
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const bx = x - s * 0.44 + i * s * 0.11, by = y - s * 0.12 + j * s * 0.13;
      rect(c, bx, by, s * 0.09, s * 0.1, '#7d5f3f');
      rect(c, bx + s * 0.008, by + s * 0.008, s * 0.074, s * 0.084, AKKER[(i + j * 2) % AKKER.length]);
      if (lod >= 1) { c.fillStyle = 'rgba(40,80,30,0.35)'; for (let k = 0; k < 3; k++) rond(c, bx + s * (0.02 + k * 0.025), by + s * 0.05, s * 0.008); }
    }
    // schuur met winkeltje en luifel in de kleur van het regime
    pand(c, x + s * 0.06, y - s * 0.1 + 2 * s * 0.017, s * 0.34, s * 0.18, 2, '#8a4a38', '#c9b9a0', { schuin: true, raamAfstand: 0.05 });
    rect(c, x + s * 0.08, y + s * 0.1, s * 0.3, s * 0.025, st.accent);
    // kippenren met een paar kippen
    rect(c, x + s * 0.1, y + s * 0.2, s * 0.3, s * 0.2, '#b9a47e');
    if (lod >= 1) {
      c.strokeStyle = '#6d7174'; c.lineWidth = lijn(s, 0.0015); c.strokeRect(x + s * 0.1, y + s * 0.2, s * 0.3, s * 0.2);
      c.fillStyle = '#f2efe6'; for (let i = 0; i < 5; i++) rond(c, x + s * (0.13 + 0.24 * hash(B.seed, i, 501)), y + s * (0.23 + 0.14 * hash(B.seed, i, 502)), s * 0.006);
    }
    for (let i = 0; i < 3; i++) boom(c, x - s * (0.4 - i * 0.14), y + s * 0.38, s * 0.035);
  };

  const zagerij = (c, x, y, s) => {
    // zonder bos: een houtzagerij met stammenplein, zaaghal, planken en een zaagselhoop
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8e8370');
    for (let k = 0; k < 2 + n; k++) stammen(c, x - s * 0.44, y - s * 0.42 + k * s * 0.1, s * 0.34, s * 0.075, s);
    // zaaghal: lang dak, open zijde naar het plein
    const top = pand(c, x - s * 0.04, y - s * 0.42 + 2 * s * 0.017, s * 0.46, s * 0.22, 2, '#7d878c', '#a0896a', { units: 0, raamAfstand: 0.06 });
    if (lod >= 1) for (let i = 1; i < 6; i++) rect(c, x - s * 0.04 + (s * 0.46 * i) / 6, top, s * 0.004, s * 0.22, 'rgba(0,0,0,0.15)');
    lopendeBand(c, x - s * 0.1, y - s * 0.3, x - s * 0.04, y - s * 0.3);
    schoorsteen(c, x + s * 0.36, y - s * 0.12, s, 0.014);
    // plankenstapels en zaagsel
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) planken(c, x - s * 0.04 + i * s * 0.15, y + s * (0.0 + j * 0.1), s * 0.12, s * 0.07, s);
    c.fillStyle = '#c9a46c'; rond(c, x - s * 0.3, y + s * 0.2, s * 0.08);
    c.fillStyle = '#d9b884'; rond(c, x - s * 0.32, y + s * 0.18, s * 0.05);
    pand(c, x + s * 0.12, y + s * 0.26 + 2 * s * 0.017, s * 0.28, s * 0.12, 2, '#6f5a48', '#b59e80', { schuin: true, raamAfstand: 0.05 });
  };

  const compacteCentrale = (c, x, y, s, st) => {
    // in de kern: één dicht blok met een slanke schoorsteen, koelcellen op het dak en een ingepakt schakelstation
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8f8b82');
    const hx = x - s * 0.4, hy = y - s * 0.38 + 4 * s * 0.017, hw = s * 0.6, hd = s * 0.42;
    const top = pand(c, hx, hy, hw, hd, 4, '#6a6f75', st.muur, { units: 0, raamAfstand: 0.035 });
    koelcellen(c, hx + s * 0.04, top + s * 0.04, hw - s * 0.08, s * 0.1, 4, s);
    if (n >= 2) koelcellen(c, hx + s * 0.04, top + s * 0.17, hw - s * 0.08, s * 0.1, 4, s);
    if (lod >= 1) rect(c, hx, top + hd - s * 0.04, hw, s * 0.012, st.accent);
    schoorsteen(c, x + s * 0.32, y - s * 0.3, s, 0.024, '#b0a69c');
    // schakelstation achter een groene wand
    rect(c, x + s * 0.24, y - s * 0.05, s * 0.2, s * 0.32, '#a8a294');
    if (lod >= 1) { for (let i = 0; i < 3; i++) rect(c, x + s * 0.28, y + s * (0.0 + i * 0.09), s * 0.04, s * 0.04, '#5f6a72'); rect(c, x + s * 0.22, y - s * 0.05, s * 0.02, s * 0.32, heg()); }
    for (let i = 0; i < 4; i++) boom(c, x - s * (0.38 - i * 0.18), y + s * 0.4, s * 0.03);
  };

  const distributiecentrum = (c, x, y, s) => {
    // een haven zonder water: een grote vlakke hal met een rij docks en een trailerplein
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8a857c');
    const hx = x - s * 0.44, hy = y - s * 0.44 + 2 * s * 0.017, hw = s * 0.88, hd = s * 0.46;
    const top = pand(c, hx, hy, hw, hd, 2, '#a7adb2', '#bfc3c6', { units: 0, geenRamen: true });
    lichtstraten(c, hx, top, hw, hd, 8, s);
    if (lod >= 1) { c.fillStyle = '#7f868c'; for (let i = 0; i < 6; i++) rect(c, hx + hw * (0.08 + i * 0.15), top + hd * 0.45, s * 0.03, s * 0.03, '#7f868c'); }
    // docks aan de zuidgevel
    const dy = hy + hd;
    for (let i = 0; i < 10; i++) {
      const dx = hx + hw * (0.03 + i * 0.096);
      rect(c, dx, dy - s * 0.02, hw * 0.06, s * 0.018, '#2e2a26');
      if (lod >= 1) rect(c, dx, dy, hw * 0.06, s * 0.012, '#d7a020');
    }
    // trailerplein met lege vakken en een paar losse opleggers
    rect(c, x - s * 0.44, y + s * 0.1, s * 0.88, s * 0.32, '#6a6862');
    if (lod >= 1) {
      c.strokeStyle = 'rgba(240,240,232,0.6)'; c.lineWidth = lijn(s, 0.002);
      c.beginPath(); for (let i = 0; i <= 10; i++) { const vx = x - s * 0.42 + i * s * 0.084; c.moveTo(vx, y + s * 0.12); c.lineTo(vx, y + s * 0.25); c.moveTo(vx, y + s * 0.28); c.lineTo(vx, y + s * 0.41); } c.stroke();
    }
    for (let i = 0; i < 3 + n; i++) {
      const k = Math.floor(hash(B.seed, i, 520) * 10), rij = hash(B.seed, i, 521) < 0.5 ? 0 : 1;
      const tx = x - s * 0.42 + k * s * 0.084 + s * 0.012, ty = y + s * (0.13 + rij * 0.16);
      rect(c, tx + s * 0.004, ty + s * 0.004, s * 0.06, s * 0.11, 'rgba(0,0,0,0.28)');
      rect(c, tx, ty, s * 0.06, s * 0.11, i % 3 === 0 ? '#d9d6cc' : i % 3 === 1 ? '#c8ccd0' : '#b9b4a6');
    }
  };

  const havenKade = (c, x, y, s, st) => {
    // haven aan het echte water: de kade ligt langs de zijde van het vak die naar het water kijkt, met kranen,
    // containerstapels en een loods aan de landkant
    const lod = B.lod, n = B.niveau, z = waterZijde(B.omg);
    rect(c, x - s / 2, y - s / 2, s, s, '#77726a');
    // kade: betonstrook met rails en bolders
    zijRect(c, x, y, s, z, -0.5, 0.5, 0, 0.12, '#b0aca2');
    if (lod >= 1) {
      c.fillStyle = '#2e2a26';
      for (let i = 0; i < 10; i++) { const [bx, by] = zijPunt(x, y, s, z, -0.45 + i * 0.1, 0.012); rond(c, bx, by, s * 0.006); }
      for (const d of [0.05, 0.09]) { const [rx, ry, rw, rh] = zijRect(c, x, y, s, z, -0.5, 0.5, d - 0.002, d + 0.002, null); rect(c, rx, ry, rw, rh, '#9aa0a6'); }
    }
    // kranen op de kade, de arm zwaait boven het water (levend)
    for (let i = 0; i < 1 + (n >= 2 ? 1 : 0); i++) {
      const [kx, ky] = zijPunt(x, y, s, z, -0.22 + i * 0.4, 0.07);
      rect(c, kx - s * 0.04 + s * 0.008, ky - s * 0.04 + s * 0.008, s * 0.08, s * 0.08, 'rgba(0,0,0,0.3)');
      rect(c, kx - s * 0.04, ky - s * 0.04, s * 0.08, s * 0.08, '#c9961e');
      rect(c, kx - s * 0.026, ky - s * 0.026, s * 0.052, s * 0.052, '#e0b020');
      levend(L.KRAAN, kx, ky, s * 0.26, 0, i);
    }
    // containerstapels
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2 + (lod >= 1 ? 1 : 0); j++) {
      const [r0, r1, r2, r3] = zijRect(c, x, y, s, z, -0.44 + i * 0.15, -0.44 + i * 0.15 + 0.13, 0.16 + j * 0.09, 0.16 + j * 0.09 + 0.065, null);
      rect(c, r0 + s * 0.006, r1 + s * 0.006, r2, r3, 'rgba(0,0,0,0.3)');
      rect(c, r0, r1, r2, r3, CONTAINERS[Math.floor(hash(B.seed, i, j + 530) * CONTAINERS.length)]);
    }
    // loods aan de landkant
    const [lx, ly, lw, lh] = zijRect(c, x, y, s, z, -0.44, 0.44, 0.48, 0.74, null);
    const top = pand(c, lx, ly + 2 * s * 0.017, lw, lh, 2, '#8c949c', '#a0a6ab', { units: 0, raamAfstand: 0.06 });
    lichtstraten(c, lx, top, lw, lh, z === 0 || z === 2 ? 6 : 3, s);
    void st;
  };

  // ---------- eigen tekeningen ----------

  const olieveld = (c, x, y, s) => {
    // jaknikkers op grindplaatsen langs een zandweg, leidingen naar een verzamelstation met tanks en een fakkel
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#9b9481');
    // zandwegen: een hoofdweg west-oost en takken naar de plaatsen
    rect(c, x - s * 0.5, y - s * 0.035, s, s * 0.05, '#b2a78c');
    rect(c, x - s * 0.06, y - s * 0.5, s * 0.05, s * 0.5, '#b2a78c');
    const plekken = [[-0.3, -0.3], [0.2, -0.32], [-0.3, 0.2], [0.2, -0.14], [-0.16, -0.16], [0.36, -0.3], [-0.38, 0.38], [-0.14, 0.36]];
    const aantal = 4 + 2 * (n - 1);
    const vx = x + s * 0.22, vy = y + s * 0.24;
    if (lod >= 1) for (let i = 0; i < aantal; i++) { const [dx, dy] = plekken[i]; leiding(c, [x + dx * s + s * 0.06, y + dy * s + s * 0.04, x + dx * s + s * 0.06, y + s * 0.03, vx - s * 0.12, y + s * 0.03, vx - s * 0.12, vy], s, 0.005, '#6d7174'); }
    for (let i = 0; i < aantal; i++) { const [dx, dy] = plekken[i]; jaknikker(c, x + dx * s, y + dy * s, s, i); }
    // verzamelstation: betonplaat, drie tanks in een bak, een pomphuis en een fakkel
    rect(c, x + s * 0.02, y + s * 0.08, s * 0.46, s * 0.4, '#8a857c');
    rect(c, x + s * 0.06, y + s * 0.11, s * 0.4, s * 0.17, '#77736b');
    for (let i = 0; i < 3; i++) tank(c, x + s * (0.12 + i * 0.14), y + s * 0.195, s * 0.065, '#d0d4d7');
    pand(c, x + s * 0.06, y + s * 0.34 + 2 * s * 0.017, s * 0.2, s * 0.1, 2, '#7d858c', '#9a958c', { raamAfstand: 0.04 });
    const fx = x + s * 0.4, fy = y + s * 0.4;
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = s * 0.012; c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + s * 0.12, fy + s * 0.07); c.stroke();
    c.fillStyle = '#6d7174'; rond(c, fx, fy, s * 0.012);
    levend(L.VUUR, fx, fy);
    levend(L.KNIPPER, fx + s * 0.015, fy - s * 0.015, s, 0, 2);
  };

  const staalfabriek = (c, x, y, s, st) => {
    // hoogoven met windverhitters, een lange walserij, ertshopen en een slakkenberg
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#857d72');
    // ertshopen (roodbruin) en kolen in het noorden
    for (let i = 0; i < 3; i++) {
      const hx = x - s * (0.36 - i * 0.16), hy = y - s * 0.38;
      c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.ellipse(hx + s * 0.01, hy + s * 0.01, s * 0.07, s * 0.045, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = i === 2 ? '#3a3632' : '#8a4a32'; c.beginPath(); c.ellipse(hx, hy, s * 0.07, s * 0.045, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = i === 2 ? '#4c4842' : '#a45e40'; c.beginPath(); c.ellipse(hx - s * 0.015, hy - s * 0.01, s * 0.035, s * 0.02, 0, 0, Math.PI * 2); c.fill();
    }
    // hoogoven: hoge ronde toren met een kraag, drie windverhitters ernaast
    const ox = x + s * 0.22, oy = y - s * 0.22;
    for (let i = 0; i < 3; i++) silo(c, ox + s * (0.08 + i * 0.07) - s * 0.07, oy + s * 0.13, s * 0.03);
    c.fillStyle = 'rgba(0,0,0,0.3)'; rond(c, ox + s * 0.04, oy + s * 0.03, s * 0.09);
    c.fillStyle = '#5c5048'; rond(c, ox, oy, s * 0.09);
    c.fillStyle = '#7a6a5e'; rond(c, ox - s * 0.01, oy - s * 0.01, s * 0.065);
    c.fillStyle = '#3a302a'; rond(c, ox, oy, s * 0.03);
    if (lod >= 1) { c.strokeStyle = '#a89888'; c.lineWidth = lijn(s, 0.004); c.beginPath(); c.arc(ox, oy, s * 0.078, 0, Math.PI * 2); c.stroke(); }
    levend(L.ROOK, ox, oy, s * 0.9);
    levend(L.VUUR, ox + s * 0.07, oy + s * 0.06);
    lopendeBand(c, x - s * 0.04, y - s * 0.36, ox - s * 0.06, oy - s * 0.03);
    // walserij: lang en smal, van west naar oost
    const top = pand(c, x - s * 0.44, y + s * 0.0 + 3 * s * 0.017, s * 0.88, s * 0.16, 3, '#6d6660', '#8d857c', { units: 0, raamAfstand: 0.06 });
    if (lod >= 1) for (let i = 1; i < 10; i++) rect(c, x - s * 0.44 + (s * 0.88 * i) / 10, top, s * 0.004, s * 0.16, 'rgba(0,0,0,0.14)');
    schoorsteen(c, x - s * 0.3, y - s * 0.12, s, 0.022);
    if (n >= 2) schoorsteen(c, x - s * 0.2, y - s * 0.12, s, 0.02);
    // slakkenberg en staalrollen
    c.fillStyle = '#5a5650'; rond(c, x - s * 0.34, y + s * 0.34, s * 0.09);
    c.fillStyle = '#6e6a63'; rond(c, x - s * 0.36, y + s * 0.32, s * 0.055);
    for (let i = 0; i < 5; i++) { const rx = x + s * (0.02 + i * 0.07), ry = y + s * 0.32; c.fillStyle = '#5d6166'; rond(c, rx, ry, s * 0.022); c.fillStyle = '#8b9096'; rond(c, rx, ry, s * 0.01); }
    rails(c, x - s * 0.2, x + s * 0.5, y + s * 0.44, s);
    pand(c, x + s * 0.22, y + s * 0.22 + 2 * s * 0.017, s * 0.2, s * 0.06, 2, st.daken[0], st.muur, { raamAfstand: 0.03 });
  };

  const spoor = (c, x, y, s) => {
    // rangeerterrein: bundel sporen met wagons, een seinhuis en een laadperron met een portaalkraan
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, '#8a8274');
    const sporen = 4 + (n >= 2 ? 1 : 0);
    for (let i = 0; i < sporen; i++) {
      const ry = y - s * 0.36 + i * s * 0.11;
      rect(c, x - s * 0.5, ry - s * 0.02, s, s * 0.04, '#9a8f7e');
      rails(c, x - s * 0.5, x + s * 0.5, ry, s);
      const vol = hash(B.seed, i, 540);
      if (vol < 0.75) {
        const k = 2 + Math.floor(hash(B.seed, i, 541) * 5), x0 = x - s * 0.45 + hash(B.seed, i, 542) * s * (0.9 - k * 0.1);
        const kl = ['#5a4a3a', '#4a5560', '#7a3a2e', '#2f4a5e'][i % 4], lading = i % 3 === 0 ? '#2e2a26' : i % 3 === 1 ? null : '#c0b8a0';
        if (i % 4 === 3) for (let j = 0; j < k; j++) { const cx = x0 + j * s * 0.1; rect(c, cx + s * 0.004, ry - s * 0.016, s * 0.09, s * 0.036, 'rgba(0,0,0,0.3)'); rect(c, cx, ry - s * 0.02, s * 0.09, s * 0.036, CONTAINERS[Math.floor(hash(B.seed, i * 9 + j, 543) * CONTAINERS.length)]); }
        else spoorwagons(c, x0, ry, k, kl, lading);
      }
    }
    // wissels aan de westkant
    if (lod >= 1) { c.strokeStyle = '#9aa0a6'; c.lineWidth = lijn(s, 0.003); c.beginPath(); for (let i = 0; i < sporen - 1; i++) { const ry = y - s * 0.36 + i * s * 0.11; c.moveTo(x - s * 0.5, ry + s * 0.11); c.lineTo(x - s * 0.36, ry); } c.stroke(); }
    // laadperron met portaalkraan en seinhuis
    const py = y - s * 0.36 + sporen * s * 0.11 - s * 0.02;
    rect(c, x - s * 0.44, py, s * 0.6, s * 0.08, '#b3ad9f');
    if (lod >= 1) { rect(c, x - s * 0.3, py - s * 0.14, s * 0.02, s * 0.22, '#c9961e'); rect(c, x + s * 0.0, py - s * 0.14, s * 0.02, s * 0.22, '#c9961e'); rect(c, x - s * 0.3, py - s * 0.08, s * 0.32, s * 0.02, '#e0b020'); }
    pand(c, x + s * 0.24, py + 3 * s * 0.017 - s * 0.02, s * 0.16, s * 0.1, 3, '#7a4a38', '#c9b9a0', { schuin: true, raamAfstand: 0.03 });
    levend(L.KNIPPER, x + s * 0.44, y - s * 0.42, s, 0, 3);
  };

  const ruimtevaartcentrum = (c, x, y, s, st) => {
    // lanceerplatform met een raket in de toren, een vlammengoot, een hoge assemblagehal, bolvormige tanks en
    // een controlegebouw; brede betonbanen tussen hal en platform
    const lod = B.lod, n = B.niveau;
    rect(c, x - s / 2, y - s / 2, s, s, grasLicht());
    // betonbaan van de hal naar het platform
    rect(c, x - s * 0.0, y - s * 0.1, s * 0.12, s * 0.5, '#b8b2a4');
    if (lod >= 1) { c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = lijn(s, 0.002); c.beginPath(); c.moveTo(x + s * 0.04, y - s * 0.1); c.lineTo(x + s * 0.04, y + s * 0.4); c.moveTo(x + s * 0.08, y - s * 0.1); c.lineTo(x + s * 0.08, y + s * 0.4); c.stroke(); }
    // platform: achthoekige betonplaat met een vlammengoot
    const px = x + s * 0.06, py = y - s * 0.22, r = s * 0.22;
    c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; c.lineTo(px + Math.cos(a) * r + s * 0.008, py + Math.sin(a) * r + s * 0.008); } c.closePath(); c.fill();
    c.fillStyle = '#c9c3b5'; c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; c.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r); } c.closePath(); c.fill();
    rect(c, px - s * 0.025, py, s * 0.05, r, '#5a544c');
    if (lod >= 1) rect(c, px - s * 0.015, py + s * 0.02, s * 0.03, r - s * 0.03, '#2e2a26');
    // toren met raket
    rect(c, px + s * 0.055, py - s * 0.08, s * 0.06, s * 0.16, '#b0392b');
    if (lod >= 1) { c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = lijn(s, 0.0015); c.beginPath(); for (let k = 1; k < 5; k++) { c.moveTo(px + s * 0.055, py - s * 0.08 + k * s * 0.032); c.lineTo(px + s * 0.115, py - s * 0.08 + k * s * 0.032); } c.stroke(); }
    c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = s * 0.03; c.beginPath(); c.moveTo(px, py); c.lineTo(px + s * 0.16, py + s * 0.1); c.stroke();
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; rect(c, px + Math.cos(a) * s * 0.042 - s * 0.009, py + Math.sin(a) * s * 0.042 - s * 0.009, s * 0.018, s * 0.018, '#c8ccd0'); }
    c.fillStyle = '#d9dcdf'; rond(c, px, py, s * 0.042);
    c.fillStyle = '#f4f5f6'; rond(c, px - s * 0.008, py - s * 0.008, s * 0.03);
    c.fillStyle = '#2e3236'; rond(c, px, py, s * 0.01);
    levend(L.KNIPPER, px + s * 0.065, py - s * 0.06, s, 0, 1);
    // bolvormige tanks
    for (let i = 0; i < 2; i++) tank(c, x - s * (0.36 - i * 0.16), y - s * 0.36, s * 0.07, '#eceef0');
    // assemblagehal: hoog en groot, met een grote deur naar de baan
    const top = pand(c, x - s * 0.44, y - s * 0.12 + 6 * s * 0.017, s * 0.38, s * 0.34, 6, '#d9dbdd', '#c9ccd0', { units: 0, geenRamen: true });
    if (lod >= 1) { rect(c, x - s * 0.44, top + s * 0.02, s * 0.38, s * 0.02, st.accent); rect(c, x - s * 0.08, y - s * 0.02, s * 0.03, s * 0.2, '#5f6468'); }
    // controlegebouw en schotelantenne
    pand(c, x + s * 0.12, y + s * 0.18 + 2 * s * 0.017, s * 0.3, s * 0.14, 2, '#8c949c', '#b3b8bc', { raamAfstand: 0.035 });
    c.fillStyle = 'rgba(0,0,0,0.25)'; rond(c, x + s * 0.34, y + s * 0.03, s * 0.05);
    c.fillStyle = '#eceef0'; rond(c, x + s * 0.32, y + s * 0.01, s * 0.05);
    c.fillStyle = '#c8ccd0'; rond(c, x + s * 0.32, y + s * 0.01, s * 0.03);
    if (n >= 2) for (let i = 0; i < 3; i++) boom(c, x + s * (0.2 + i * 0.1), y + s * 0.42, s * 0.025);
  };

  return {
    varianten: { opslag: [opslag1, opslag2], industrie: [industrie1, industrie2], centrale: [centrale1, centrale2], mijn: [mijn1, mijn2] },
    soorten: { stadsboerderij, zagerij, compacteCentrale, distributiecentrum, havenKade, olieveld, staalfabriek, spoor, ruimtevaartcentrum },
    waterZijde,
  };
}
