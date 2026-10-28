// Génère shared/maps-extra.js : cartes France, Italie, Méditerranée et Monde (3 tailles chacune).
// Usage : node tools/build-maps.js <dossier des données>
// Le dossier doit contenir (voir README, section « Cartes ») :
//   countries-50m.json, countries-110m.json (world-atlas, Natural Earth — domaine public)
//   topojson-client.js (topojson-client, dist)
//   codes.json, fr.json (i18n-iso-countries : codes et noms de pays en français)
//   france-regions.geojson, france-departements.geojson (france-geojson, Admin Express IGN — Licence Ouverte)
//   italie-regions.geojson, italie-provinces.geojson (openpolis/geojson-italy, ISTAT — CC BY 4.0)
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
if (!SRC) { console.error('Usage : node tools/build-maps.js <dossier des données>'); process.exit(1); }
const topojson = require(path.resolve(SRC, 'topojson-client.js'));
const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));

const MIN_PIECE = 8; // morceaux plus petits (en cases) : fusionnés avec un voisin ou supprimés

// ---------- Noms de pays en français ----------
const CODES = readJSON('codes.json'), FR = readJSON('fr.json').countries;
const NUM2A2 = {};
for (const [a2, , num] of CODES) NUM2A2[num] = a2;
const SHORT = {
  "États-Unis d'Amérique": 'États-Unis', 'République unie de Tanzanie': 'Tanzanie', 'République démocratique du Congo': 'RD Congo',
  'Fédération de Russie': 'Russie', 'Royaume-Uni de Grande-Bretagne et d\'Irlande du Nord': 'Royaume-Uni', 'République de Corée': 'Corée du Sud',
  'République populaire démocratique de Corée': 'Corée du Nord', "République islamique d'Iran": 'Iran', 'République arabe syrienne': 'Syrie',
  'République démocratique populaire lao': 'Laos', 'Viet Nam': 'Viêt Nam', 'République de Moldavie': 'Moldavie', 'Bolivie (État plurinational de)': 'Bolivie',
  'Venezuela (République bolivarienne du)': 'Venezuela', 'République centrafricaine': 'Centrafrique', 'Émirats arabes unis': 'Émirats',
  'République dominicaine': 'Rép. dominicaine', 'Bosnie-Herzégovine': 'Bosnie', 'Macédoine du Nord': 'Macédoine', 'Papouasie-Nouvelle-Guinée': 'Papouasie',
  'Guinée équatoriale': 'Guinée équat.', 'Tchéquie': 'Tchéquie', 'Palestine, État de': 'Palestine',
};
function countryName(f) {
  const special = { 'N. Cyprus': 'Chypre du Nord', Somaliland: 'Somaliland', Kosovo: 'Kosovo' };
  if (special[f.properties.name]) return special[f.properties.name];
  let n = FR[NUM2A2[f.id]];
  if (Array.isArray(n)) n = n.slice().sort((a, b) => a.length - b.length)[0];
  if (!n) n = f.properties.name;
  n = n.replace(/\s*\(.*\)$/, '');
  return SHORT[n] || n;
}

// ---------- Rasterisation ----------
// features : [{ name, group, geom (GeoJSON) }]
function rasterize(features, cfg) {
  const { lon0, lon1, lat0, lat1, H, latRef } = cfg;
  const KX = Math.cos(latRef * Math.PI / 180);
  const STEP = (lat1 - lat0) / H;
  const W = Math.round((lon1 - lon0) * KX / STEP);
  const polys = [];
  features.forEach((f, fi) => {
    const g = f.geom;
    const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings0 of list) {
      // anneaux rendus continus (pas de saut de 360° à l'antiméridien)
      const rings = rings0.map(r => { const out = []; let prev = null; for (let [x, y] of r) { if (prev !== null) { while (x - prev > 180) x -= 360; while (x - prev < -180) x += 360; } out.push([x, y]); prev = x; } return out; });
      const bb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const r of rings) for (const [x, y] of r) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
      polys.push({ fi, rings, bb });
    }
  });
  const inside = (rings, x, y) => {
    let c = false;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const lonOf = (x) => lon0 + (x + 0.5) * STEP / KX;
  const latOf = (y) => lat1 - (y + 0.5) * STEP;
  const grid = new Int32Array(W * H).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lat = latOf(y), lon = lonOf(x);
    for (const p of polys) {
      if (lat < p.bb[1] || lat > p.bb[3]) continue;
      let hit = false;
      for (const L of cfg.wrap ? [lon, lon + 360, lon - 360] : [lon]) {
        if (L < p.bb[0] || L > p.bb[2]) continue;
        if (inside(p.rings, L, lat)) { hit = true; break; }
      }
      if (hit) { grid[y * W + x] = p.fi; break; }
    }
  }
  const toCell = (lon, lat) => [Math.floor((lon - lon0) * KX / STEP), Math.floor((lat1 - lat) / STEP)];
  return { W, H, grid, toCell, lonOf, latOf, cellDeg: STEP };
}

// ---------- Outils de grille ----------
function makeGridTools(W, H) {
  const nbs = (i) => { const x = i % W, y = (i / W) | 0, o = []; if (x > 0) o.push(i - 1); if (x < W - 1) o.push(i + 1); if (y > 0) o.push(i - W); if (y < H - 1) o.push(i + W); return o; };
  const components = (arr) => {
    const comp = new Int32Array(W * H).fill(-1), list = [];
    for (let i = 0; i < W * H; i++) {
      if (arr[i] < 0 || comp[i] >= 0) continue;
      const id = list.length, cells = [i];
      comp[i] = id;
      for (let k = 0; k < cells.length; k++) for (const n of nbs(cells[k])) if (comp[n] < 0 && arr[n] === arr[i]) { comp[n] = id; cells.push(n); }
      list.push({ key: arr[i], cells });
    }
    return list;
  };
  return { nbs, components };
}

// ---------- Construction d'une variante ----------
// cfg : { desired, minFactor, maxSplit, seaLink, longLink, mountains, forests, cities, radiusDeg }
function buildVariant(R, features, cfg) {
  const { W, H } = R;
  const { nbs, components } = makeGridTools(W, H);
  const grid = R.grid.slice();
  // 1. petits morceaux : fusion avec le voisin le plus en contact, sinon suppression (îlots)
  for (let pass = 0; pass < 3; pass++) {
    for (const p of components(grid)) {
      if (p.cells.length >= MIN_PIECE) continue;
      const touch = {};
      for (const c of p.cells) for (const n of nbs(c)) if (grid[n] >= 0 && grid[n] !== p.key) touch[grid[n]] = (touch[grid[n]] || 0) + 1;
      const best = Object.keys(touch).sort((a, b) => touch[b] - touch[a])[0];
      for (const c of p.cells) grid[c] = best !== undefined ? +best : -1;
    }
  }
  // 2. unités : chaque morceau d'un seul tenant
  let terrs = components(grid).map(p => ({ members: [p.key], main: p.key, cells: p.cells, part: null }));
  // « taille » d'un territoire : sa surface, pondérée par la carte (cfg.weight) pour que les régions
  // denses (Europe…) aient plus de territoires que les immensités vides (Sibérie, Grand Nord canadien…)
  const sz = (t) => t.cells.length * (cfg.weight ? cfg.weight(features[t.main]) : 1);
  const total = terrs.reduce((a, t) => a + sz(t), 0);
  const T = total / cfg.desired;
  // morceaux secondaires d'une même entité (îles) : on note la partie principale pour les nommer
  const biggestOf = {};
  for (const t of terrs) if (!biggestOf[t.main] || biggestOf[t.main].cells.length < t.cells.length) biggestOf[t.main] = t;
  for (const t of terrs) if (biggestOf[t.main] !== t) t.islandOf = biggestOf[t.main];

  // 3. découpage des très grands territoires (k-moyennes)
  const split = [];
  for (const t of terrs) {
    const k = Math.min(cfg.maxSplit || 6, Math.round(sz(t) / T));
    if (sz(t) < 1.9 * T || k < 2) { split.push(t); continue; }
    const pts = t.cells.map(c => [c % W, (c / W) | 0]);
    const seeds = [pts[Math.floor(pts.length / 2)]];
    while (seeds.length < k) {
      let best = null, bd = -1;
      for (const q of pts) { let d = Infinity; for (const s of seeds) d = Math.min(d, (q[0] - s[0]) ** 2 + (q[1] - s[1]) ** 2); if (d > bd) { bd = d; best = q; } }
      seeds.push(best);
    }
    const assign = new Int32Array(pts.length);
    for (let it = 0; it < 12; it++) {
      pts.forEach((q, i) => { let b = 0, bd2 = Infinity; seeds.forEach((s, j) => { const d = (q[0] - s[0]) ** 2 + (q[1] - s[1]) ** 2; if (d < bd2) { bd2 = d; b = j; } }); assign[i] = b; });
      const sum = seeds.map(() => [0, 0, 0]);
      pts.forEach((q, i) => { sum[assign[i]][0] += q[0]; sum[assign[i]][1] += q[1]; sum[assign[i]][2]++; });
      sum.forEach((s, j) => { if (s[2]) seeds[j] = [s[0] / s[2], s[1] / s[2]]; });
    }
    const parts = seeds.map(() => []);
    t.cells.forEach((c, i) => parts[assign[i]].push(c));
    for (const cells of parts) if (cells.length) split.push({ members: t.members.slice(), main: t.main, cells, part: { of: t.cells } , islandOf: t.islandOf });
  }
  terrs = split;
  // un morceau découpé non connexe : on garde la plus grande partie, le reste rejoint un voisin
  const label = new Int32Array(W * H).fill(-1);
  const relabel = () => { label.fill(-1); terrs.forEach((t, i) => { for (const c of t.cells) label[c] = i; }); };
  relabel();
  for (let pass = 0; pass < 2; pass++) {
    const comps = components(label), best = {};
    for (const p of comps) if (!best[p.key] || best[p.key].cells.length < p.cells.length) best[p.key] = p;
    for (const p of comps) {
      if (best[p.key] === p) continue;
      const touch = {};
      for (const c of p.cells) for (const n of nbs(c)) if (label[n] >= 0 && label[n] !== p.key) touch[label[n]] = (touch[label[n]] || 0) + 1;
      const to = Object.keys(touch).sort((a, b) => touch[b] - touch[a])[0];
      for (const c of p.cells) label[c] = to !== undefined ? +to : -1;
    }
    terrs.forEach(t => { t.cells = []; });
    for (let i = 0; i < W * H; i++) if (label[i] >= 0) terrs[label[i]].cells.push(i);
    terrs = terrs.filter(t => t.cells.length);
    relabel();
  }

  // 4. fusion des petits territoires avec un voisin (de préférence du même groupe : région, pays…)
  const groupOf = (t) => features[t.main].group;
  for (;;) {
    relabel();
    const adj = terrs.map(() => new Set());
    for (let i = 0; i < W * H; i++) if (label[i] >= 0) for (const n of nbs(i)) if (label[n] >= 0 && label[n] !== label[i]) adj[label[i]].add(label[n]);
    const tooMany = terrs.length > cfg.desired * 1.06;
    let pick = -1;
    terrs.forEach((t, i) => {
      if (!adj[i].size) return;
      if (sz(t) < cfg.minFactor * T || tooMany) if (pick < 0 || sz(t) < sz(terrs[pick])) pick = i;
    });
    if (pick < 0) {
      // îlots trop petits et sans voisin terrestre (îles arctiques…) : retirés, la carte les ignore
      const lone = cfg.dropIsland ? terrs.findIndex((t, i) => !adj[i].size && sz(t) < cfg.minFactor * T && cfg.dropIsland(features[t.main])) : -1;
      if (lone >= 0) { terrs.splice(lone, 1); continue; }
      // petites îles sans voisin terrestre : regroupées avec le territoire proche du même groupe (archipels)
      if (!cfg.islandMerge) break;
      const cen = terrs.map(u => { let sx = 0, sy = 0; for (const c of u.cells) { sx += c % W; sy += (c / W) | 0; } return [sx / u.cells.length, sy / u.cells.length]; });
      let best = null;
      terrs.forEach((u, i) => {
        if (adj[i].size || sz(u) >= cfg.minFactor * T || !cfg.islandMerge.names.includes(features[u.main].name)) return;
        terrs.forEach((v, j) => {
          if (j === i || groupOf(v) !== groupOf(u)) return;
          const d = Math.hypot(cen[i][0] - cen[j][0], cen[i][1] - cen[j][1]);
          if (d <= cfg.islandMerge.dist && (!best || d < best.d)) best = { d, i, j };
        });
      });
      if (!best) break;
      const isl = terrs[best.i], dst = terrs[best.j];
      if (isl.cells.length > dst.cells.length) { dst.main = isl.main; dst.part = isl.part; dst.islandOf = isl.islandOf; }
      dst.members = [...new Set(dst.members.concat(isl.members))];
      dst.cells = dst.cells.concat(isl.cells);
      terrs.splice(best.i, 1);
      continue;
    }
    const t = terrs[pick];
    const cands = [...adj[pick]];
    const same = cands.filter(j => groupOf(terrs[j]) != null && groupOf(terrs[j]) === groupOf(t));
    const pool = same.length ? same : cands;
    const into = pool.sort((a, b) => sz(terrs[a]) - sz(terrs[b]))[0];
    const dst = terrs[into];
    // la cible garde son nom si elle est plus grande ; sinon elle prend celui du territoire absorbé
    if (t.cells.length > dst.cells.length) { dst.main = t.main; dst.part = t.part; dst.islandOf = t.islandOf; }
    dst.members = [...new Set(dst.members.concat(t.members))];
    dst.cells = dst.cells.concat(t.cells);
    terrs.splice(pick, 1);
  }
  relabel();

  // 5. passages maritimes (proches), puis liaisons plus longues pour les îles isolées
  // « mer » = case vide qui n'est pas une terre étrangère (les pays voisins hors jeu bloquent les passages)
  const sea = (n) => label[n] < 0 && !(cfg.foreign && cfg.foreign[n]);
  const landAdj = new Set();
  for (let i = 0; i < W * H; i++) if (label[i] >= 0) for (const n of nbs(i)) if (label[n] >= 0 && label[n] !== label[i]) landAdj.add(Math.min(label[i], label[n]) + '-' + Math.max(label[i], label[n]));
  const links = new Set();
  for (let i = 0; i < W * H; i++) {
    if (label[i] < 0 || !nbs(i).some(sea)) continue;
    const dist = new Map([[i, 0]]), q = [i];
    for (let k = 0; k < q.length; k++) {
      const c = q[k], d = dist.get(c);
      if (d >= cfg.seaLink) continue;
      for (const n of nbs(c)) {
        if (dist.has(n)) continue;
        dist.set(n, d + 1);
        if (sea(n)) q.push(n);
        else if (label[n] >= 0 && label[n] !== label[i] && d >= 1) links.add(Math.min(label[n], label[i]) + '-' + Math.max(label[n], label[i]));
      }
    }
  }
  let seaLinks = [...links].filter(k => !landAdj.has(k)).map(k => k.split('-').map(Number));
  // passages imposés par la carte (deux points [lon, lat] : le territoire le plus proche de chacun)
  const terrAt = (lon, lat) => {
    const [x0, y0] = R.toCell(lon, lat);
    for (let rad = 0; rad < 8; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && label[y * W + x] >= 0) return label[y * W + x];
    }
    return -1;
  };
  for (const [[lo1, la1], [lo2, la2]] of cfg.extraLinks || []) {
    const a = terrAt(lo1, la1), b = terrAt(lo2, la2);
    if (a >= 0 && b >= 0 && a !== b && !seaLinks.some(([u, v]) => u === Math.min(a, b) && v === Math.max(a, b))) seaLinks.push([Math.min(a, b), Math.max(a, b)]);
  }
  const coast = terrs.map((t, i) => t.cells.filter(c => nbs(c).some(sea)).map(c => [c % W, (c / W) | 0]));
  for (let guard = 0; guard < 50; guard++) {
    const adj = terrs.map(() => []);
    for (const k of landAdj) { const [a, b] = k.split('-').map(Number); adj[a].push(b); adj[b].push(a); }
    for (const [a, b] of seaLinks) { adj[a].push(b); adj[b].push(a); }
    const comp = new Int32Array(terrs.length).fill(-1), sizes = [];
    terrs.forEach((t, i) => {
      if (comp[i] >= 0) return;
      const id = sizes.length, q = [i]; comp[i] = id; let s = 0;
      for (let k = 0; k < q.length; k++) { s += terrs[q[k]].cells.length; for (const n of adj[q[k]]) if (comp[n] < 0) { comp[n] = id; q.push(n); } }
      sizes.push(s);
    });
    if (sizes.length <= 1) break;
    const mainC = sizes.indexOf(Math.max(...sizes));
    // le plus proche couple (autre composante, composante principale)
    let best = null;
    terrs.forEach((t, i) => {
      if (comp[i] === mainC) return;
      terrs.forEach((u, j) => {
        if (comp[j] !== mainC) return;
        for (const p of coast[i]) for (const q of coast[j]) {
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (!best || d < best.d) best = { d, a: i, b: j };
        }
      });
    });
    if (!best || best.d > cfg.longLink) break;
    seaLinks.push([Math.min(best.a, best.b), Math.max(best.a, best.b)]);
  }
  // territoires toujours isolés : supprimés
  {
    const adj = terrs.map(() => []);
    for (const k of landAdj) { const [a, b] = k.split('-').map(Number); adj[a].push(b); adj[b].push(a); }
    for (const [a, b] of seaLinks) { adj[a].push(b); adj[b].push(a); }
    const seen = new Array(terrs.length).fill(false);
    let start = 0;
    terrs.forEach((t, i) => { if (t.cells.length > terrs[start].cells.length) start = i; });
    const q = [start]; seen[start] = true;
    for (let k = 0; k < q.length; k++) for (const n of adj[q[k]]) if (!seen[n]) { seen[n] = true; q.push(n); }
    const idx = [];
    let n = 0;
    terrs.forEach((t, i) => { idx[i] = seen[i] ? n++ : -1; });
    const lost = terrs.filter((t, i) => !seen[i]).map(t => features[t.main].name);
    if (lost.length) console.log('    isolés supprimés :', lost.join(', '));
    seaLinks = seaLinks.filter(([a, b]) => seen[a] && seen[b]).map(([a, b]) => [idx[a], idx[b]]);
    terrs = terrs.filter((t, i) => seen[i]);
    relabel();
  }

  // 6. noms, terrain, revenu
  const used = new Set();
  const dirs = (dx, dy) => {
    const ns = dy < -0.3 ? 'Nord' : dy > 0.3 ? 'Sud' : '', ew = dx > 0.3 ? 'Est' : dx < -0.3 ? 'Ouest' : '';
    return ns && ew ? ns + '-' + ew : ns || ew || 'Centre';
  };
  const centroid = (cells) => { let sx = 0, sy = 0; for (const c of cells) { sx += c % W; sy += (c / W) | 0; } return [sx / cells.length, sy / cells.length]; };
  const groupCount = {};
  features.forEach(f => { if (f.group != null) groupCount[f.group] = (groupCount[f.group] || 0) + 1; });
  const near = (cells, pts, radCells) => {
    const P = pts.map(([lon, lat]) => R.toCell(lon, lat));
    let n = 0;
    for (const c of cells) { const x = c % W, y = (c / W) | 0; if (P.some(([px, py]) => (x - px) ** 2 + (y - py) ** 2 <= radCells * radCells)) n++; }
    return n / cells.length;
  };
  const contains = (cells, pts) => { const set = new Set(cells); return pts.some(([lon, lat]) => { const [x, y] = R.toCell(lon, lat); return x >= 0 && y >= 0 && x < W && y < H && set.has(y * W + x); }); };
  const radCells = (cfg.radiusDeg || 0.6) / R.cellDeg;
  const regions = terrs.map(t => {
    const f = features[t.main];
    let name = f.name;
    const g = f.group;
    if (t.members.length > 1 && g != null && t.members.every(m => features[m].group === g) && t.members.length === groupCount[g]) name = g; // toute une région
    else if (t.part) { const [cx, cy] = centroid(t.cells), [px, py] = centroid(t.part.of); const span = Math.sqrt(t.part.of.length) / 1.6; name = name + ' ' + dirs((cx - px) / span, (cy - py) / span); }
    else if (t.islandOf && t.islandOf !== t) { const [cx, cy] = centroid(t.cells), [px, py] = centroid(t.islandOf.cells); const span = Math.sqrt(t.islandOf.cells.length); name = name + ' ' + dirs((cx - px) / span, (cy - py) / span); }
    if ((t.part || (t.islandOf && t.islandOf !== t)) && cfg.places) {
      // un vrai nom de lieu (île, région) si un point connu se trouve dans le territoire
      const set = new Set(t.cells), [cx, cy] = centroid(t.cells);
      const hit = cfg.places.map(([pn, lon, lat]) => { const [x, y] = R.toCell(lon, lat); return { pn, ok: set.has(y * W + x), d: (x - cx) ** 2 + (y - cy) ** 2 }; })
        .filter(h => h.ok && !used.has(h.pn)).sort((a, b) => a.d - b.d)[0];
      if (hit) name = hit.pn;
    }
    let n2 = name, k = 2;
    while (used.has(n2)) n2 = name + ' ' + k++;
    used.add(n2);
    let terrain = 'plain';
    if (contains(t.cells, cfg.cities || []) && t.cells.length < 2.2 * T) terrain = 'city';
    else if (near(t.cells, cfg.mountains || [], radCells) >= 0.2) terrain = 'mountain';
    else if (near(t.cells, cfg.forests || [], radCells * 1.3) >= 0.25) terrain = 'forest';
    const income = sz(t) < 0.6 * T ? 1 : sz(t) < 1.4 * T ? 2 : 3;
    // zone à bonus (continent, région…) : donnée par la carte, d'après le territoire principal ou la position
    const [zx, zy] = centroid(t.cells);
    const zone = cfg.zone ? cfg.zone(f, R.lonOf(zx), R.latOf(zy)) : f.group != null ? f.group : null;
    return zone ? { name: n2, terrain, income, zone } : { name: n2, terrain, income };
  });
  const final = new Int16Array(W * H).fill(-1);
  terrs.forEach((t, i) => { for (const c of t.cells) final[c] = i; });
  if (cfg.foreign) for (let i = 0; i < W * H; i++) if (final[i] < 0 && cfg.foreign[i]) final[i] = -2; // terre hors jeu
  const rle = [];
  for (let i = 0; i < W * H;) { let j = i; while (j < W * H && final[j] === final[i]) j++; rle.push(final[i], j - i); i = j; }
  console.log(`    ${regions.length} territoires, ${seaLinks.length} passages maritimes, grille ${W}x${H}, terrains`, regions.reduce((a, r) => (a[r.terrain] = (a[r.terrain] || 0) + 1, a), {}));
  return { w: W, h: H, rle, regions, seaLinks };
}

// ---------- Sources ----------
const geojson = (f) => readJSON(f).features;
const world110 = (() => { const t = readJSON('countries-110m.json'); return topojson.feature(t, t.objects.countries).features; })();
const world50 = (() => { const t = readJSON('countries-50m.json'); return topojson.feature(t, t.objects.countries).features; })();
const pointIn = (geom, lon, lat) => {
  const list = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return list.some(rings => { let c = false; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c; } return c; });
};
const centerOf = (geom) => {
  const list = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let best = null, bn = 0;
  for (const rings of list) if (rings[0].length > bn) { bn = rings[0].length; best = rings[0]; }
  let sx = 0, sy = 0; for (const [x, y] of best) { sx += x; sy += y; } return [sx / best.length, sy / best.length];
};

// Masque des terres émergées (tous les pays) sur la grille d'une carte : les terres hors jeu s'affichent en gris
function landMask(box) {
  const R = rasterize(world50.map(f => ({ name: '', geom: f.geometry })), box);
  return Uint8Array.from(R.grid, v => (v >= 0 ? 1 : 0));
}

// ---------- Cartes ----------
const MAPS = {};

// France : régions (petite), départements regroupés (moyenne), départements (grande)
{
  const regs = geojson('france-regions.geojson');
  const deps = geojson('france-departements.geojson').map(f => {
    const [lon, lat] = centerOf(f.geometry);
    const r = regs.find(g => pointIn(g.geometry, lon, lat)) || regs.slice().sort((a, b) => { const ca = centerOf(a.geometry), cb = centerOf(b.geometry); return Math.hypot(ca[0] - lon, ca[1] - lat) - Math.hypot(cb[0] - lon, cb[1] - lat); })[0];
    return { name: f.properties.nom, group: r.properties.nom, geom: f.geometry };
  });
  const box = { lon0: -5.3, lon1: 9.8, lat0: 41.2, lat1: 51.2, H: 150, latRef: 46.5 };
  const terrain = {
    mountains: [[6.6, 45.9], [6.4, 45.2], [6.6, 44.4], [7.1, 44.1], [-0.6, 42.95], [0.6, 42.75], [2.0, 42.55], [2.8, 45.4], [3.0, 44.8], [2.6, 45.0], [5.9, 46.6], [7.0, 48.0], [9.05, 42.15]],
    forests: [[-0.8, 44.2], [-0.9, 44.6], [1.9, 47.5], [6.8, 48.3], [4.7, 49.8], [4.0, 47.2]],
    cities: [[2.35, 48.86], [4.84, 45.76], [5.37, 43.3], [1.44, 43.6], [7.26, 43.7], [-1.55, 47.22], [7.75, 48.58], [3.88, 43.61], [-0.58, 44.84], [3.06, 50.63], [-1.68, 48.11]],
    radiusDeg: 0.6, seaLink: 4, longLink: 40, foreign: landMask(box),
    places: [['Corse', 9.1, 42.1], ['Bretagne', -3, 48.2], ['Normandie', 0, 49]],
  };
  const FR_MACRO = { 'Hauts-de-France': 'Nord', Normandie: 'Nord', 'Île-de-France': 'Nord', 'Grand Est': 'Est', 'Bourgogne-Franche-Comté': 'Est',
    Bretagne: 'Ouest', 'Pays de la Loire': 'Ouest', 'Centre-Val de Loire': 'Ouest', 'Nouvelle-Aquitaine': 'Sud-Ouest', Occitanie: 'Sud-Ouest',
    'Auvergne-Rhône-Alpes': 'Sud-Est', "Provence-Alpes-Côte d'Azur": 'Sud-Est', Corse: 'Sud-Est' };
  console.log('France');
  const Rr = rasterize(regs.map(f => ({ name: f.properties.nom, group: null, geom: f.geometry })), box);
  const Rd = rasterize(deps, box);
  MAPS.france = {
    small: buildVariant(Rr, regs.map(f => ({ name: f.properties.nom })), { ...terrain, desired: 13, minFactor: 0, zone: (f) => FR_MACRO[f.name] }),
    medium: buildVariant(Rd, deps, { ...terrain, desired: 40, minFactor: 0.45 }),
    large: buildVariant(Rd, deps, { ...terrain, desired: 94, minFactor: 0.15 }),
  };
}

// Italie : régions (petite), provinces regroupées (moyenne), provinces (grande)
{
  const regs = geojson('italie-regions.geojson').map(f => ({ name: f.properties.reg_name, group: null, geom: f.geometry }));
  const provs = geojson('italie-provinces.geojson').map(f => ({ name: f.properties.prov_name, group: f.properties.reg_name, geom: f.geometry }));
  const box = { lon0: 6.5, lon1: 18.6, lat0: 36.5, lat1: 47.2, H: 150, latRef: 42 };
  const terrain = {
    mountains: [[7.3, 45.8], [8.5, 46.2], [10.0, 46.3], [11.3, 46.5], [12.3, 46.5], [13.0, 46.3], [10.0, 44.3], [11.5, 43.9], [12.8, 43.2], [13.6, 42.4], [14.2, 41.8], [15.4, 40.6], [16.0, 39.8], [9.3, 40.0], [15.0, 37.75]],
    forests: [[16.5, 39.3], [11.8, 43.8], [15.9, 41.8], [11.2, 46.1]],
    cities: [[12.5, 41.9], [9.19, 45.46], [14.27, 40.85], [7.69, 45.07], [13.36, 38.12], [8.93, 44.41], [11.34, 44.49], [11.25, 43.77], [16.87, 41.12], [12.33, 45.44], [15.09, 37.5]],
    radiusDeg: 0.45, seaLink: 4, longLink: 40, foreign: landMask(box),
    places: [['Sardaigne', 9, 40.1], ['Sicile', 14.1, 37.5], ['Elbe', 10.25, 42.78]],
  };
  const IT_FR = { Piemonte: 'Piémont', "Valle d'Aosta/Vallée d'Aoste": "Vallée d'Aoste", Liguria: 'Ligurie', Lombardia: 'Lombardie',
    'Trentino-Alto Adige/Südtirol': 'Trentin-Haut-Adige', Veneto: 'Vénétie', 'Friuli-Venezia Giulia': 'Frioul', 'Emilia-Romagna': 'Émilie-Romagne',
    Marche: 'Marches', Toscana: 'Toscane', Umbria: 'Ombrie', Lazio: 'Latium', Campania: 'Campanie', Abruzzo: 'Abruzzes', Molise: 'Molise',
    Puglia: 'Pouilles', Basilicata: 'Basilicate', Calabria: 'Calabre', Sicilia: 'Sicile', Sardegna: 'Sardaigne' };
  const IT_MACRO = (r) => ({ Piemonte: 'Nord-Ouest', "Valle d'Aosta/Vallée d'Aoste": 'Nord-Ouest', Liguria: 'Nord-Ouest', Lombardia: 'Nord-Ouest',
    'Trentino-Alto Adige/Südtirol': 'Nord-Est', Veneto: 'Nord-Est', 'Friuli-Venezia Giulia': 'Nord-Est', 'Emilia-Romagna': 'Nord-Est',
    Toscana: 'Centre', Umbria: 'Centre', Marche: 'Centre', Lazio: 'Centre', Sicilia: 'Îles', Sardegna: 'Îles' })[r] || 'Sud';
  console.log('Italie');
  const Rr = rasterize(regs, box), Rp = rasterize(provs, box);
  MAPS.italy = {
    small: buildVariant(Rr, regs, { ...terrain, desired: 20, minFactor: 0, zone: (f) => IT_MACRO(f.name) }),
    medium: buildVariant(Rp, provs, { ...terrain, desired: 45, minFactor: 0.45, zone: (f) => IT_MACRO(f.group) }),
    large: buildVariant(Rp, provs, { ...terrain, desired: 100, minFactor: 0.15, zone: (f) => IT_FR[f.group] }),
  };
}

// Méditerranée : pays du pourtour (les grands découpés)
{
  const keep = ['Portugal', 'Spain', 'France', 'Monaco', 'Andorra', 'Italy', 'San Marino', 'Vatican', 'Malta', 'Switzerland', 'Slovenia', 'Croatia', 'Bosnia and Herz.', 'Montenegro', 'Serbia', 'Kosovo', 'Albania', 'Macedonia', 'North Macedonia', 'Greece', 'Bulgaria', 'Turkey', 'Cyprus', 'N. Cyprus', 'Syria', 'Lebanon', 'Israel', 'Palestine', 'Jordan', 'Egypt', 'Libya', 'Tunisia', 'Algeria', 'Morocco', 'W. Sahara', 'Romania', 'Hungary', 'Austria', 'Iraq', 'Saudi Arabia'];
  const feats = world50.filter(f => keep.includes(f.properties.name)).map(f => ({ name: countryName(f), group: null, en: f.properties.name, geom: f.geometry }));
  const MED_ZONE = {};
  for (const [z, list] of Object.entries({
    'Ibérie': ['Portugal', 'Spain', 'Andorra'], 'France et Alpes': ['France', 'Monaco', 'Switzerland'], 'Italie': ['Italy', 'San Marino', 'Vatican', 'Malta'],
    'Europe centrale': ['Austria', 'Hungary', 'Slovenia', 'Romania'],
    'Balkans': ['Croatia', 'Bosnia and Herz.', 'Montenegro', 'Serbia', 'Kosovo', 'Albania', 'Macedonia', 'North Macedonia', 'Greece', 'Bulgaria'],
    'Anatolie': ['Turkey', 'Cyprus', 'N. Cyprus'], 'Levant': ['Syria', 'Lebanon', 'Israel', 'Palestine', 'Jordan', 'Iraq', 'Saudi Arabia'],
    'Égypte et Libye': ['Egypt', 'Libya'], 'Maroc': ['Morocco', 'W. Sahara'], 'Algérie et Tunisie': ['Algeria', 'Tunisia'],
  })) for (const c of list) MED_ZONE[c] = z;
  const box = { lon0: -10, lon1: 37, lat0: 29, lat1: 46.5, H: 120, latRef: 38 };
  const terrain = {
    mountains: [[-5, 32], [-7.5, 31], [-1, 34], [4.3, 36.4], [0.5, 42.7], [-3.3, 37.1], [7, 45.5], [10, 46.2], [13.5, 42.3], [15.5, 40.5], [18, 43.5], [19.5, 42.5], [21.3, 39.8], [24, 42], [33, 37], [36, 38], [36, 34], [9.3, 40], [9.1, 42.2]],
    forests: [[20, 44], [-0.8, 44.2], [16.5, 39.3]],
    cities: [[-3.7, 40.42], [2.17, 41.39], [-9.14, 38.72], [5.37, 43.3], [12.5, 41.9], [14.27, 40.85], [23.73, 37.98], [28.97, 41.01], [32.85, 39.93], [27.14, 38.42], [31.24, 30.04], [29.92, 31.2], [10.18, 36.8], [3.06, 36.75], [-7.59, 33.57], [35.5, 33.89], [36.29, 33.51], [34.78, 32.08], [13.19, 32.89], [20.46, 44.8], [23.32, 42.7]],
    radiusDeg: 1, seaLink: 4, longLink: 25, foreign: landMask(box),
    places: [['Corse', 9.1, 42.1], ['Sardaigne', 9, 40.1], ['Sicile', 14.1, 37.5], ['Crète', 24.9, 35.25], ['Baléares', 2.9, 39.6], ['Chypre', 33.2, 35],
      ['Andalousie', -4.6, 37.5], ['Catalogne', 1.8, 41.8], ['Castille', -4, 41.2], ['Galice', -7.9, 42.8], ['Aragon', -0.8, 41.5], ['Valence', -0.6, 39.3],
      ['Provence', 6, 43.8], ['Occitanie', 2, 43.6], ['Aquitaine', -0.6, 44.6], ['Rhône-Alpes', 5.5, 45.4], ['Toscane', 11.2, 43.4], ['Lombardie', 9.7, 45.6],
      ['Pouilles', 16.4, 40.9], ['Calabre', 16.3, 39.1], ['Latium', 12.8, 41.9], ['Kabylie', 4.3, 36.6], ['Oranie', -0.6, 35.3], ['Sahara algérien', 3, 30],
      ['Hauts Plateaux', 3, 34.8], ['Rif', -4.5, 35], ['Haut Atlas', -6, 31.5], ['Tripolitaine', 13.5, 32.3], ['Cyrénaïque', 21.5, 32.3], ['Fezzan', 14, 29.5],
      ['Delta du Nil', 31, 30.8], ['Sinaï', 33.8, 29.8], ['Désert Libyque', 27, 29.5], ['Thrace', 27, 41.3], ['Anatolie', 32.8, 39.5], ['Égée', 28, 38.5],
      ['Pont', 36.5, 41], ['Cilicie', 35.5, 37.2], ['Cappadoce', 35, 38.7], ['Transylvanie', 24.5, 46.2], ['Valachie', 25.5, 44.5]],
  };
  console.log('Méditerranée');
  const R = rasterize(feats, box);
  MAPS.med = {
    small: buildVariant(R, feats, { ...terrain, desired: 30, minFactor: 0.4, maxSplit: 5, zone: (f) => MED_ZONE[f.en] }),
    medium: buildVariant(R, feats, { ...terrain, desired: 50, minFactor: 0.35, maxSplit: 6, zone: (f) => MED_ZONE[f.en] }),
    large: buildVariant(R, feats, { ...terrain, desired: 75, minFactor: 0.3, maxSplit: 8, zone: (f) => MED_ZONE[f.en] }),
  };
}

// Monde : pays (les petits voisins regroupés par continent, les très grands découpés)
{
  const continent = ([lon, lat]) => {
    if (lon < -30) return lat > 13 ? 'Amérique du Nord' : 'Amérique du Sud';
    if (lat < -10 && lon > 110) return 'Océanie';
    if (lon > -20 && lon < 52 && lat < 36 && !(lon > 34 && lat > 12)) return 'Afrique';
    if (lon < 40 && lat > 35) return 'Europe';
    return 'Asie';
  };
  const feats = world110.filter(f => !['Antarctica', 'Fr. S. Antarctic Lands'].includes(f.properties.name))
    .map(f => ({ name: countryName(f), group: continent(centerOf(f.geometry)), geom: f.geometry }));
  const box = { lon0: -180, lon1: 180, lat0: -56, lat1: 76, H: 120, latRef: 0, wrap: true };
  const terrain = {
    mountains: [[85, 28], [80, 32], [90, 33], [76, 36], [-70, -20], [-72, -35], [-75, -10], [-77, 0], [-110, 40], [-115, 50], [-120, 60], [9, 46], [44, 42.5], [-5, 32], [70, 38], [100, 28], [135, 36], [-105, 25], [38, 9], [30, -28]],
    forests: [[-60, -5], [-70, -5], [22, 0], [15, 2], [100, 60], [80, 60], [130, 60], [60, 60], [-100, 55], [-80, 52], [113, 0], [102, 2], [18, 63], [27, 62]],
    cities: [[-74, 40.7], [-118.2, 34], [-99.1, 19.4], [-46.6, -23.5], [-58.4, -34.6], [-0.1, 51.5], [2.35, 48.86], [37.6, 55.75], [31.24, 30.04], [3.4, 6.45], [72.9, 19.1], [77.2, 28.6], [116.4, 39.9], [121.5, 31.2], [139.7, 35.7], [127, 37.5], [151.2, -33.9], [28.97, 41.01], [28, -26.2], [106.8, -6.2], [100.5, 13.75], [51.4, 35.7], [67, 24.9], [-77, -12], [-74.1, 4.7], [-87.6, 41.9], [-79.4, 43.7]],
    radiusDeg: 4, seaLink: 3, longLink: 18,
    // traversées de l'Atlantique, présentes sur toutes les tailles de carte :
    // route du nord (Canada ↔ Groenland ↔ Islande ↔ Royaume-Uni), Terre-Neuve ↔ Irlande, États-Unis ↔ Péninsule ibérique,
    // et Atlantique Sud : Nordeste (Brésil) ↔ Sénégal (sinon l'Amérique du Sud est un cul-de-sac trop facile à tenir)
    extraLinks: [
      [[-68, 60], [-45, 64]], [[-35, 66], [-19, 65]], [[-18, 64.5], [-2, 54]],
      [[-58, 49], [-8, 53]], [[-75, 38], [-8, 40]],
      [[-38, -8], [-15, 14.5]],
    ],
    // densité de territoires : plus dans les régions peuplées, moins dans les immensités vides
    weight: (f) => ({ Russie: 0.45, Canada: 0.5, Groenland: 0.3, Australie: 0.5, Kazakhstan: 0.6, Mongolie: 0.5, Algérie: 0.6, Libye: 0.6,
      'Arabie saoudite': 0.7, Chine: 1.1, Inde: 1.6, 'États-Unis': 1.6 })[f.name] || { Europe: 3, Afrique: 1, Asie: 1.3, 'Amérique du Nord': 1.6, 'Amérique du Sud': 1.4, Océanie: 1.4 }[f.group] || 1,
    // îles d'un archipel regroupées si elles sont petites
    islandMerge: { dist: 22, names: ['Indonésie', 'Philippines', 'Malaisie', 'Papouasie', 'Timor oriental', 'Brunéi Darussalam', 'Îles Salomon', 'Vanuatu', 'Fidji', 'Nouvelle-Calédonie'] },
    dropIsland: (f) => ['Canada', 'Russie'].includes(f.name),
    places: [['Alaska', -150, 64], ['Sibérie', 100, 62], ['Extrême-Orient russe', 135, 58], ['Oural', 60, 58], ['Kamtchatka', 160, 57], ['Moscovie', 40, 55],
      ['Québec', -72, 52], ['Ontario', -85, 50], ['Colombie-Britannique', -125, 55], ['Prairies', -105, 53], ['Grand Nord canadien', -100, 66], ['Terre-Neuve', -57, 49],
      ['Texas', -99, 31], ['Californie', -120, 37], ['Floride', -82, 28], ['Grands Lacs', -87, 43], ['Nouvelle-Angleterre', -71, 43], ['Rocheuses', -108, 42], ['Grandes Plaines', -98, 40],
      ['Amazonie', -63, -5], ['Nordeste', -40, -8], ['Sud du Brésil', -50, -26], ['Patagonie', -69, -45], ['Pampa', -62, -34],
      ['Mandchourie', 126, 45], ['Tibet', 88, 32], ['Xinjiang', 85, 41], ['Chine du Sud', 112, 24], ['Chine du Nord', 115, 38], ['Mongolie-Intérieure', 112, 43],
      ['Sumatra', 101, 0], ['Bornéo', 114, 1], ['Java', 110, -7.5], ['Nouvelle-Guinée', 140, -5], ['Célèbes', 121, -2], ['Hokkaido', 143, 43.5], ['Kyushu', 131, 32.5],
      ['Luçon', 121, 16], ['Mindanao', 125, 7.5], ['Queensland', 145, -22], ['Australie-Occidentale', 122, -25], ['Nouvelle-Galles du Sud', 147, -32], ['Territoire du Nord', 133, -19],
      ['Groenland', -42, 72], ['Sahara', 5, 25], ['Sahel', 0, 15], ['Kazakhstan Est', 78, 48], ['Deccan', 77, 17], ['Gange', 82, 26], ['Sibérie du Sud', 90, 53], ['Yakoutie', 125, 63]],
  };
  // régions à bonus : les continents, comme au Risk (la Russie à part, l'Asie coupée en deux car très grande),
  // d'après le pays principal du territoire et sa position
  const worldZone = (f, lon, lat) => {
    if (f.name === 'Russie') return 'Russie';
    if (lon < -30) return lat > 12 || (lon < -78 && lat > 7) ? 'Amérique du Nord' : 'Amérique du Sud';
    if ((lon > 110 && lat < -10) || (lon > 94 && lat < 7) || (lon > 117 && lat < 20)) return 'Indonésie et Océanie';
    if (lon > -20 && lon < 52 && lat < 36 && !(lon > 34 && lat > 12)) return 'Afrique';
    if (lat > 35 && lon < 40 && f.name !== 'Turquie') return 'Europe';
    if (lon < 75 && lat < 45) return 'Moyen-Orient';
    return 'Asie';
  };
  console.log('Monde');
  const R = rasterize(feats, box);
  MAPS.world = {
    small: buildVariant(R, feats, { ...terrain, desired: 60, minFactor: 0.45, maxSplit: 6, zone: worldZone }),
    medium: buildVariant(R, feats, { ...terrain, desired: 90, minFactor: 0.4, maxSplit: 8, zone: worldZone }),
    large: buildVariant(R, feats, { ...terrain, desired: 122, minFactor: 0.3, maxSplit: 10, zone: worldZone }),
  };
}

const out = path.join(__dirname, '..', 'shared', 'maps-extra.js');
fs.writeFileSync(out, `// Généré par tools/build-maps.js — ne pas modifier à la main.
// Sources : Natural Earth (world-atlas, domaine public) ; France : Admin Express IGN via france-geojson (Licence Ouverte Etalab) ;
// Italie : ISTAT via openpolis/geojson-italy (CC BY 4.0).
(function (root) {
  const data = ${JSON.stringify(MAPS)};
  if (typeof module === 'object' && module.exports) module.exports = data; else root.EXTRA_MAPS = data;
})(typeof self !== 'undefined' ? self : this);
`);
console.log('Écrit :', out, Math.round(fs.statSync(out).size / 1024) + ' Ko');
