// Génère shared/europe-map.js à partir des frontières réelles (Natural Earth via world-atlas).
// Usage : npm i --no-save world-atlas@2 topojson-client@3 && node tools/build-europe.js
const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');
const world = require('world-atlas/countries-50m.json');

const LON0 = -10.5, LON1 = 40, LAT0 = 35.5, LAT1 = 70.2;
const H = 150;
const KX = Math.cos(52 * Math.PI / 180);
const STEP = (LAT1 - LAT0) / H;               // degrés de latitude par case
const W = Math.round((LON1 - LON0) * KX / STEP);
const MIN_PIECE = 10;       // morceaux plus petits : supprimés (îlots) ou fusionnés
const SEA_LINK = 6;         // distance max (cases) d'un passage maritime

const FR = {
  Albania: 'Albanie', Andorra: 'Andorre', Austria: 'Autriche', Belarus: 'Biélorussie', Belgium: 'Belgique',
  'Bosnia and Herz.': 'Bosnie', Bulgaria: 'Bulgarie', Croatia: 'Croatie', Czechia: 'Tchéquie', Denmark: 'Danemark',
  Estonia: 'Estonie', Finland: 'Finlande', France: 'France', Germany: 'Allemagne', Greece: 'Grèce', Hungary: 'Hongrie',
  Ireland: 'Irlande', Italy: 'Italie', Kosovo: 'Kosovo', Latvia: 'Lettonie', Liechtenstein: 'Liechtenstein',
  Lithuania: 'Lituanie', Luxembourg: 'Luxembourg', Macedonia: 'Macédoine', 'North Macedonia': 'Macédoine', Malta: 'Malte',
  Moldova: 'Moldavie', Monaco: 'Monaco', Montenegro: 'Monténégro', Netherlands: 'Pays-Bas', Norway: 'Norvège',
  Poland: 'Pologne', Portugal: 'Portugal', Romania: 'Roumanie', Russia: 'Russie', 'San Marino': 'Saint-Marin',
  Serbia: 'Serbie', Slovakia: 'Slovaquie', Slovenia: 'Slovénie', Spain: 'Espagne', Sweden: 'Suède',
  Switzerland: 'Suisse', Ukraine: 'Ukraine', 'United Kingdom': 'Royaume-Uni', Vatican: 'Vatican', Turkey: 'Turquie',
};

// Noms de régions connues (lon, lat, pays) : une région prend le nom du point qu'elle contient
const PLACES = [
  ['Bretagne', -3, 48.1, 'France'], ['Normandie', 0.3, 49.1, 'France'], ['Île-de-France', 2.4, 48.8, 'France'], ['Alsace-Lorraine', 6.5, 48.6, 'France'],
  ['Aquitaine', -0.6, 44.6, 'France'], ['Provence', 6, 43.8, 'France'], ['Auvergne', 3, 45.6, 'France'], ['Corse', 9.1, 42.1, 'France'], ['Bourgogne', 4.6, 47.2, 'France'],
  ['Galice', -7.9, 42.8, 'Spain'], ['Catalogne', 1.8, 41.8, 'Spain'], ['Castille', -4, 41.2, 'Spain'], ['Andalousie', -4.6, 37.5, 'Spain'], ['Aragon', -0.8, 41.5, 'Spain'], ['Baléares', 2.9, 39.6, 'Spain'], ['Estrémadure', -6.1, 39.2, 'Spain'], ['Valence', -0.6, 39.3, 'Spain'],
  ['Lombardie', 9.7, 45.6, 'Italy'], ['Toscane', 11.2, 43.4, 'Italy'], ['Latium', 12.8, 41.9, 'Italy'], ['Pouilles', 16.4, 40.9, 'Italy'], ['Sicile', 14.1, 37.5, 'Italy'], ['Sardaigne', 9, 40.1, 'Italy'], ['Vénétie', 11.9, 45.6, 'Italy'], ['Calabre', 16.3, 39.1, 'Italy'],
  ['Bavière', 11.5, 48.8, 'Germany'], ['Saxe', 13.2, 51.1, 'Germany'], ['Rhénanie', 7.2, 50.6, 'Germany'], ['Basse-Saxe', 9.5, 52.7, 'Germany'], ['Brandebourg', 13.4, 52.5, 'Germany'], ['Bade', 8.6, 48.4, 'Germany'], ['Holstein', 9.8, 54.1, 'Germany'], ['Poméranie', 13, 53.8, 'Germany'],
  ['Écosse', -4.2, 57, 'United Kingdom'], ['Angleterre', -1.5, 52.5, 'United Kingdom'], ['Londres', -0.1, 51.5, 'United Kingdom'], ['Pays de Galles', -3.7, 52.3, 'United Kingdom'], ['Irlande du Nord', -6.7, 54.6, 'United Kingdom'],
  ['Laponie', 25, 67.5, 'Finland'], ['Carélie', 29.5, 62.5, 'Finland'], ['Helsinki', 25, 60.4, 'Finland'], ['Ostrobotnie', 24.5, 64, 'Finland'],
  ['Norrland', 18, 65.5, 'Sweden'], ['Svealand', 16, 59.8, 'Sweden'], ['Götaland', 14, 57.3, 'Sweden'], ['Jämtland', 15, 63, 'Sweden'],
  ['Finnmark', 25, 69.8, 'Norway'], ['Nordland', 15, 67, 'Norway'], ['Trøndelag', 11, 63.5, 'Norway'], ['Vestland', 6.5, 61, 'Norway'], ['Østlandet', 10.5, 60, 'Norway'],
  ['Mazovie', 21, 52.2, 'Poland'], ['Silésie', 18, 50.6, 'Poland'], ['Poméranie (PL)', 17.5, 54, 'Poland'], ['Grande-Pologne', 16.8, 52.3, 'Poland'], ['Petite-Pologne', 21.5, 50.2, 'Poland'],
  ['Moscou', 37.6, 55.7, 'Russia'], ['Saint-Pétersbourg', 30.3, 59.9, 'Russia'], ['Kaliningrad', 21, 54.7, 'Russia'], ['Carélie russe', 33, 63.5, 'Russia'], ['Kola', 35, 68, 'Russia'], ['Smolensk', 32.5, 54.8, 'Russia'], ['Voronej', 39.2, 51.7, 'Russia'], ['Rostov', 39.7, 47.5, 'Russia'], ['Novgorod', 31.3, 58.5, 'Russia'], ['Vologda', 39.5, 60, 'Russia'], ['Arkhangelsk', 39, 64, 'Russia'], ['Koursk', 36.2, 51.7, 'Russia'], ['Briansk', 34, 53.2, 'Russia'], ['Pskov', 29, 57.3, 'Russia'], ['Tver', 35.5, 57, 'Russia'],
  ['Crimée', 34.1, 45.2, 'Russia'], ['Mourmansk', 33, 68.9, 'Russia'], ['Petrozavodsk', 34.4, 61.8, 'Russia'], ['Laponie', 26, 68.5, 'Finland'],
  ['Kiev', 30.5, 50.4, 'Ukraine'], ['Galicie', 24, 49.5, 'Ukraine'], ['Crimée', 34.1, 45.2, 'Ukraine'], ['Donbass', 38, 48.3, 'Ukraine'], ['Kharkiv', 36.2, 49.9, 'Ukraine'], ['Odessa', 30.5, 46.8, 'Ukraine'], ['Volhynie', 25.5, 51, 'Ukraine'],
  ['Thrace', 28.5, 41.3, 'Turkey'], ['Anatolie', 32.8, 39.5, 'Turkey'], ['Égée', 28, 38.5, 'Turkey'], ['Pont', 36.5, 41, 'Turkey'], ['Cilicie', 35.5, 37.2, 'Turkey'], ['Cappadoce', 35, 38.7, 'Turkey'],
  ['Crète', 24.9, 35.3, 'Greece'], ['Macédoine grecque', 22.5, 40.6, 'Greece'], ['Attique', 23.2, 38.3, 'Greece'],
  ['Transylvanie', 24.5, 46.5, 'Romania'], ['Valachie', 25.5, 44.5, 'Romania'], ['Moldavie roumaine', 27, 47, 'Romania'],
  ['Minsk', 27.5, 53.9, 'Belarus'], ['Polésie', 27, 52.1, 'Belarus'], ['Vitebsk', 29, 55.2, 'Belarus'],
  ['Jutland', 9.2, 56.2, 'Denmark'], ['Seeland', 11.9, 55.5, 'Denmark'],
  ['Nord du Portugal', -8, 41.3, 'Portugal'], ['Sud du Portugal', -8, 38.3, 'Portugal'],
];

// ----- Rasterisation -----
const feats = topojson.feature(world, world.objects.countries).features.filter(f => FR[f.properties.name]);
function bboxOf(rings) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
  return b;
}
const polys = [];
for (const f of feats) {
  const g = f.geometry;
  const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (let rings of list) {
    // La Russie traverse l'antiméridien : on « déroule » les longitudes pour que le test point-dans-polygone reste juste
    rings = rings.map(r => r.map(([x, y]) => [x < -150 ? x + 360 : x, y]));
    polys.push({ name: f.properties.name, rings, bb: bboxOf(rings) });
  }
}
function inside(rings, x, y) {
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const countryNames = feats.map(f => f.properties.name);
const country = new Int16Array(W * H).fill(-1);
const lonOf = (x) => LON0 + (x + 0.5) * STEP / KX;
const latOf = (y) => LAT1 - (y + 0.5) * STEP;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const lon = lonOf(x), lat = latOf(y);
  for (const p of polys) {
    if (lon < p.bb[0] || lon > p.bb[2] || lat < p.bb[1] || lat > p.bb[3]) continue;
    if (inside(p.rings, lon, lat)) { country[y * W + x] = countryNames.indexOf(p.name); break; }
  }
}
const toCell = (lon, lat) => [Math.floor((lon - LON0) * KX / STEP), Math.floor((LAT1 - lat) / STEP)];

// ----- Morceaux (composantes connexes par pays) -----
function nbs(i) {
  const x = i % W, y = (i / W) | 0, out = [];
  if (x > 0) out.push(i - 1); if (x < W - 1) out.push(i + 1); if (y > 0) out.push(i - W); if (y < H - 1) out.push(i + W);
  return out;
}
function components(arr) {
  const comp = new Int32Array(W * H).fill(-1), list = [];
  for (let i = 0; i < W * H; i++) {
    if (arr[i] < 0 || comp[i] >= 0) continue;
    const id = list.length, cells = [i];
    comp[i] = id;
    for (let k = 0; k < cells.length; k++) for (const n of nbs(cells[k])) if (comp[n] < 0 && arr[n] === arr[i]) { comp[n] = id; cells.push(n); }
    list.push({ key: arr[i], cells });
  }
  return { comp, list };
}
// Petits morceaux : fusion avec le voisin terrestre le plus en contact, sinon suppression (îlot)
for (let pass = 0; pass < 3; pass++) {
  const { list } = components(country);
  for (const p of list) {
    if (p.cells.length >= MIN_PIECE) continue;
    const touch = {};
    for (const c of p.cells) for (const n of nbs(c)) if (country[n] >= 0 && country[n] !== p.key) touch[country[n]] = (touch[country[n]] || 0) + 1;
    const best = Object.keys(touch).sort((a, b) => touch[b] - touch[a])[0];
    for (const c of p.cells) country[c] = best !== undefined ? +best : -1;
  }
}

// Construit une variante de la carte : TARGET = taille visée d'une région (en cases), MAX_SPLIT = découpage max par morceau
function buildVariant(TARGET, MAX_SPLIT) {
  // ----- Découpage des grands morceaux en régions -----
  const region = new Int32Array(W * H).fill(-1);
  const regions = []; // { country, cells }
  {
    const { list } = components(country);
    for (const p of list) {
      const k = Math.max(1, Math.min(MAX_SPLIT, Math.round(p.cells.length / TARGET)));
      if (k === 1) { const id = regions.length; regions.push({ country: p.key, cells: p.cells }); for (const c of p.cells) region[c] = id; continue; }
      // germes : échantillonnage du point le plus éloigné, puis quelques itérations de k-moyennes
      const pts = p.cells.map(c => [c % W, (c / W) | 0]);
      const seeds = [pts[Math.floor(pts.length / 2)]];
      while (seeds.length < k) {
        let best = null, bd = -1;
        for (const q of pts) { let d = Infinity; for (const s of seeds) d = Math.min(d, (q[0] - s[0]) ** 2 + (q[1] - s[1]) ** 2); if (d > bd) { bd = d; best = q; } }
        seeds.push(best);
      }
      let assign = new Int32Array(pts.length);
      for (let it = 0; it < 12; it++) {
        pts.forEach((q, i) => { let b = 0, bd2 = Infinity; seeds.forEach((s, j) => { const d = (q[0] - s[0]) ** 2 + (q[1] - s[1]) ** 2; if (d < bd2) { bd2 = d; b = j; } }); assign[i] = b; });
        const sum = seeds.map(() => [0, 0, 0]);
        pts.forEach((q, i) => { sum[assign[i]][0] += q[0]; sum[assign[i]][1] += q[1]; sum[assign[i]][2]++; });
        sum.forEach((s, j) => { if (s[2]) seeds[j] = [s[0] / s[2], s[1] / s[2]]; });
      }
      const base = regions.length;
      for (let j = 0; j < k; j++) regions.push({ country: p.key, cells: [] });
      p.cells.forEach((c, i) => { region[c] = base + assign[i]; regions[base + assign[i]].cells.push(c); });
    }
    // une région découpée en plusieurs morceaux : on garde le plus grand, le reste rejoint un voisin
    for (let pass = 0; pass < 3; pass++) {
      const { list } = components(region);
      const biggest = {};
      for (const p of list) if (!biggest[p.key] || biggest[p.key].cells.length < p.cells.length) biggest[p.key] = p;
      for (const p of list) {
        if (biggest[p.key] === p) continue;
        const touch = {};
        for (const c of p.cells) for (const n of nbs(c)) if (region[n] >= 0 && region[n] !== p.key) touch[region[n]] = (touch[region[n]] || 0) + 1;
        const best = Object.keys(touch).sort((a, b) => touch[b] - touch[a])[0];
        for (const c of p.cells) region[c] = best !== undefined ? +best : -1;
      }
    }
  }
  // Réindexation des régions non vides
  const remap = new Map();
  const final = new Int16Array(W * H).fill(-1);
  const regs = [];
  for (let i = 0; i < W * H; i++) {
    const r = region[i];
    if (r < 0) continue;
    if (!remap.has(r)) { remap.set(r, regs.length); regs.push({ country: regions[r].country, cells: [] }); }
    final[i] = remap.get(r);
    regs[remap.get(r)].cells.push(i);
  }

  // ----- Passages maritimes -----
  const links = new Set();
  for (let i = 0; i < W * H; i++) {
    if (final[i] < 0) continue;
    // BFS dans la mer depuis les côtes
    const isCoast = nbs(i).some(n => final[n] < 0);
    if (!isCoast) continue;
    const dist = new Map([[i, 0]]), q = [i];
    for (let k = 0; k < q.length; k++) {
      const c = q[k], d = dist.get(c);
      if (d >= SEA_LINK) continue;
      for (const n of nbs(c)) {
        if (dist.has(n)) continue;
        dist.set(n, d + 1);
        if (final[n] < 0) q.push(n);
        else if (final[n] !== final[i] && d >= 1) { const a = Math.min(final[n], final[i]), b = Math.max(final[n], final[i]); links.add(a + '-' + b); }
      }
    }
  }
  // on retire les passages entre régions déjà voisines par la terre
  const landAdj = new Set();
  for (let i = 0; i < W * H; i++) if (final[i] >= 0) for (const n of nbs(i)) if (final[n] >= 0 && final[n] !== final[i]) landAdj.add(Math.min(final[i], final[n]) + '-' + Math.max(final[i], final[n]));
  const seaLinks = [...links].filter(k => !landAdj.has(k)).map(k => k.split('-').map(Number));

  // Composante principale du graphe : les régions isolées disparaissent
  {
    const adj = regs.map(() => []);
    for (const k of [...landAdj, ...seaLinks.map(l => l.join('-'))]) { const [a, b] = k.split('-').map(Number); adj[a].push(b); adj[b].push(a); }
    const seen = new Array(regs.length).fill(false), q = [regs.findIndex(r => countryNames[r.country] === 'Germany')];
    seen[q[0]] = true;
    for (let k = 0; k < q.length; k++) for (const n of adj[q[k]]) if (!seen[n]) { seen[n] = true; q.push(n); }
    const lost = regs.map((r, i) => (seen[i] ? null : countryNames[r.country] + ' (' + r.cells.length + ')')).filter(Boolean);
    if (lost.length) console.log('Régions isolées supprimées :', lost.join(', '));
    // Réindexation sans les régions isolées
    const idx = [];
    let n = 0;
    regs.forEach((r, i) => { idx[i] = seen[i] ? n++ : -1; });
    for (let i = 0; i < W * H; i++) if (final[i] >= 0) final[i] = idx[final[i]];
    const kept = regs.filter((r, i) => seen[i]);
    regs.length = 0; regs.push(...kept);
    const sl = seaLinks.filter(([a, b]) => seen[a] && seen[b]).map(([a, b]) => [idx[a], idx[b]]);
    seaLinks.length = 0; seaLinks.push(...sl);
  }

  // ----- Noms, terrain, revenu -----
  const MOUNTAINS = [[8, 46.6], [10.5, 46.8], [13, 47.2], [7, 45.8], [0.5, 42.7], [-1, 42.9], [25, 45.6], [23, 47.7], [20, 42.6], [19.3, 42.8], [22.5, 42], [7.5, 61.5], [15, 67], [12, 63], [18, 43.5], [14.5, 46.3], [-4, 40.4], [-3.5, 37.1], [12.5, 42.5], [43, 43], [33, 37], [36, 38.5], [24, 40.9], [21.5, 39.6]];
  const CITIES = [[2.35, 48.85], [-0.12, 51.5], [13.4, 52.5], [-3.7, 40.4], [12.5, 41.9], [37.6, 55.75], [28.97, 41.01], [16.37, 48.2], [21, 52.23], [19.04, 47.5], [26.1, 44.43], [23.73, 37.98], [4.9, 52.37], [4.35, 50.85], [30.52, 50.45], [30.3, 59.94], [-9.14, 38.72], [18.07, 59.33], [10.75, 59.91], [12.57, 55.68], [24.94, 60.17], [14.42, 50.08], [9.19, 45.46], [2.17, 41.39], [11.58, 48.14], [-2.24, 53.48], [27.56, 53.9], [20.46, 44.8]];
  const FORESTS = ['Finland', 'Sweden', 'Belarus', 'Estonia', 'Latvia', 'Lithuania', 'Russia', 'Slovakia'];
  const dirs = (dx, dy) => {
    const ns = dy < -0.33 ? 'Nord' : dy > 0.33 ? 'Sud' : '', ew = dx > 0.33 ? 'Est' : dx < -0.33 ? 'Ouest' : '';
    return ns && ew ? ns + '-' + ew : ns || ew || 'Centre';
  };
  const used = new Set();
  const countByCountry = {};
  regs.forEach(r => { countByCountry[r.country] = (countByCountry[r.country] || 0) + 1; });
  const out = regs.map((r, i) => {
    const cn = countryNames[r.country];
    let sx = 0, sy = 0;
    for (const c of r.cells) { sx += c % W; sy += (c / W) | 0; }
    const cx = sx / r.cells.length, cy = sy / r.cells.length;
    let name = FR[cn];
    if (countByCountry[r.country] > 1) {
      const place = PLACES.filter(p => p[3] === cn).map(p => { const [x, y] = toCell(p[1], p[2]); return { n: p[0], ok: final[y * W + x] === i, d: (x - cx) ** 2 + (y - cy) ** 2 }; })
        .filter(p => p.ok && !used.has(p.n)).sort((a, b) => a.d - b.d)[0];
      if (place) name = place.n;
      else {
        // direction par rapport au centre du pays
        let px = 0, py = 0, pn = 0;
        regs.forEach(o => { if (o.country === r.country) for (const c of o.cells) { px += c % W; py += (c / W) | 0; pn++; } });
        const span = Math.sqrt(pn) / 1.5;
        name = FR[cn] + ' ' + dirs((cx - px / pn) / span, (cy - py / pn) / span);
      }
    }
    let n2 = name, k = 2;
    while (used.has(n2)) n2 = name + ' ' + k++;
    used.add(n2);
    const hasCell = (pts) => pts.some(([lon, lat]) => { const [x, y] = toCell(lon, lat); return x >= 0 && y >= 0 && x < W && y < H && final[y * W + x] === i; });
    const mountainShare = (cells) => {
    const pts = MOUNTAINS.map(([lon, lat]) => toCell(lon, lat));
    let n = 0;
    for (const c of cells) { const x = c % W, y = (c / W) | 0; if (pts.some(([px, py]) => (x - px) ** 2 + (y - py) ** 2 <= 36)) n++; }
    return n / cells.length;
  };
  const nearPt = (pts, rad) => pts.some(([lon, lat]) => { const [x, y] = toCell(lon, lat); return r.cells.some(c => ((c % W) - x) ** 2 + (((c / W) | 0) - y) ** 2 <= rad * rad); });
    let terrain = 'plain';
    if (hasCell(CITIES) && r.cells.length < 330) terrain = 'city'; // un pays entier n'est pas « une ville »
    else if (mountainShare(r.cells) >= 0.2) terrain = 'mountain'; // au moins 20 % de la région près d'un massif
    else if (FORESTS.includes(cn)) terrain = 'forest';
    const income = r.cells.length < 100 ? 1 : r.cells.length < 250 ? 2 : 3;
    return { name: n2, country: FR[cn], terrain, income };
  });

  // Encodage RLE de la grille
  const rle = [];
  for (let i = 0; i < W * H;) { let j = i; while (j < W * H && final[j] === final[i]) j++; rle.push(final[i], j - i); i = j; }
  const data = { w: W, h: H, rle, regions: out, seaLinks };
  console.log(`[${TARGET}] ${out.length} régions, ${seaLinks.length} passages maritimes, terrains`, out.reduce((a, r) => (a[r.terrain] = (a[r.terrain] || 0) + 1, a), {}));
  return data;
}

// Trois tailles : petite (surtout des pays entiers), moyenne, grande (régions)
const variants = { small: buildVariant(2000, 2), medium: buildVariant(270, 5), large: buildVariant(190, 6) };
const file = path.join(__dirname, '..', 'shared', 'europe-map.js');
fs.writeFileSync(file, `// Généré par tools/build-europe.js (frontières : Natural Earth via world-atlas) — ne pas modifier à la main.
(function (root) {
  const data = ${JSON.stringify(variants)};
  if (typeof module === 'object' && module.exports) module.exports = data; else root.EUROPE_MAP = data;
})(typeof self !== 'undefined' ? self : this);
`);
