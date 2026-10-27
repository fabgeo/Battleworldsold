// Moteur de jeu partagé : utilisé par le navigateur (solo) et le serveur (multi).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./europe-map.js'), require('./maps-extra.js'));
  else root.Engine = factory(root.EUROPE_MAP, root.EXTRA_MAPS);
})(typeof self !== 'undefined' ? self : this, function (EUROPE, EXTRA) {
  'use strict';

  const CFG = {
    SOLDIER_COST: 4,
    BASE_INCOME: 5,        // or/s pour chaque joueur, quoi qu'il possède
    CAPITAL_BONUS: 5,      // or en plus par versement pour la case d'une capitale (pour celui qui la tient)
    TERR_BONUS: 1,         // or en plus par versement pour chaque territoire, en plus de son revenu propre
    MINE_GOLD: 4,          // or en plus par versement pour chaque mine
    KILL_GOLD: 100,        // or minimum gagné en éliminant un joueur
    START_GOLD: 25,
    START_TROOPS: 12,
    DEF_BONUS: 1.2,        // multiplicateur de base des défenseurs
    ARMY_SPEED: 12,        // cases par seconde sur plaine
    FATIGUE: 0.05,         // perte par étape au-delà des étapes gratuites
    FREE_LEGS: 2,
    INCOME_EVERY: 4,       // secondes entre deux versements d'or (lent : laisse le temps de réfléchir)
    SEA_SLOW: 2,           // un passage maritime est 2 fois plus lent
    OWN_TERRAIN_SLOW: 0.4, // sur ses territoires, le ralentissement du terrain est réduit à 40 % (montagne : 0,8 au lieu de 0,5)
    BARRACKS_EVERY: 3,     // secondes entre deux soldats produits par une caserne
    HISTORY_EVERY: 5,      // secondes entre deux points des statistiques
    BOT_THINK: { easy: 2.6, normal: 2.1, hard: 0.9 },
  };

  const TERRAIN = {
    plain: { name: 'Plaine', def: 1, speed: 1, income: 0 },
    forest: { name: 'Forêt', def: 1.25, speed: 0.7, income: 0 },
    mountain: { name: 'Montagne', def: 1.6, speed: 0.5, income: 1 }, // mines de montagne : un peu plus d'or
    city: { name: 'Ville', def: 1.1, speed: 1, income: 2 },
  };

  const BUILDINGS = {
    fort: { name: 'Fort', cost: 30, desc: '+50 % de défense', letter: 'F' },
    mine: { name: 'Mine', cost: 35, desc: '+4 or par versement', letter: 'M' },
    barracks: { name: 'Caserne', cost: 45, desc: '+1 soldat / 3 s', letter: 'C' },
  };
  const BUILD_STEP = 0.15; // chaque bâtiment d'un type acheté rend le suivant du même type 15 % plus cher

  // Prix d'un bâtiment pour un joueur : +15 % par bâtiment de ce type déjà acheté (les autres types ne bougent pas)
  function buildCost(state, pi, kind) {
    const p = state.players[pi];
    const n = p && p.stats.builtKind ? p.stats.builtKind[kind] || 0 : 0;
    return Math.round(BUILDINGS[kind].cost * Math.pow(1 + BUILD_STEP, n));
  }

  // Nombre de bâtiments d'un type sur un territoire, et maximum autorisé :
  // 1 de chaque type, sauf dans une capitale (★) : 3 de chaque, mais 2 forts au plus
  const countOf = (t, kind) => t.buildings.reduce((n, k) => n + (k === kind), 0);
  function maxBuildings(state, ti, kind) {
    const isCap = (state.capitals || []).includes(ti);
    if (kind === 'fort') return isCap ? 2 : 1;
    return isCap ? 4 : 2;
  }
  // Or rapporté par un territoire à chaque versement : base + terrain + mines + capitale
  function terrIncome(state, map, i) {
    const t = state.territories[i];
    return map.terr[i].income + CFG.TERR_BONUS + TERRAIN[map.terr[i].terrain].income + CFG.MINE_GOLD * countOf(t, 'mine')
      + ((state.capitals || []).includes(i) ? CFG.CAPITAL_BONUS : 0);
  }
  // Joueur qui tient toute une région (-1 sinon)
  function zoneOwner(state, map, z) {
    const list = map.zones[z].terr, o = state.territories[list[0]].owner;
    if (o < 0) return -1;
    for (const i of list) if (state.territories[i].owner !== o) return -1;
    return o;
  }

  // Régions à bonus (comme au Risk) : continents, régions… données par la carte.
  // Plus une région est grande et a de points d'entrée à défendre, plus elle rapporte.
  const EUROPE_ZONES = {
    'Scandinavie': ['Norvège', 'Suède', 'Finlande', 'Danemark'], 'Îles Britanniques': ['Royaume-Uni', 'Irlande'],
    'Pays baltes': ['Estonie', 'Lettonie', 'Lituanie', 'Biélorussie'], 'Russie': ['Russie'], 'Ukraine et Moldavie': ['Ukraine', 'Moldavie'],
    "Europe de l'Ouest": ['France', 'Belgique', 'Pays-Bas', 'Suisse'], 'Europe centrale': ['Allemagne', 'Pologne', 'Tchéquie', 'Slovaquie', 'Autriche', 'Hongrie'],
    'Ibérie': ['Espagne', 'Portugal'], 'Italie': ['Italie', 'Slovénie'],
    'Balkans': ['Croatie', 'Serbie', 'Bosnie', 'Monténégro', 'Kosovo', 'Albanie', 'Macédoine', 'Grèce', 'Bulgarie', 'Roumanie'], 'Anatolie': ['Turquie'],
  };
  const COUNTRY_ZONE = {};
  for (const [z, list] of Object.entries(EUROPE_ZONES)) for (const c of list) COUNTRY_ZONE[c] = z;
  function buildZones(terr, defs) {
    const key = defs.map(d => d.zone || COUNTRY_ZONE[d.country] || 'Autres terres');
    const names = [...new Set(key)];
    const zoneOf = key.map(k => names.indexOf(k));
    // une région d'un seul territoire rejoint sa plus petite voisine
    for (;;) {
      const size = names.map((_, z) => zoneOf.filter(v => v === z).length);
      const lone = zoneOf.findIndex((z, i) => size[z] === 1 && !defs[i].zoneBonus);
      if (lone < 0) break;
      const cands = terr[lone].neighbors.map(v => zoneOf[v]).filter(z => z !== zoneOf[lone]);
      if (!cands.length) break;
      // la voisine avec qui il partage le plus de frontières (à égalité, la plus petite)
      const links = (z) => cands.filter(c => c === z).length;
      zoneOf[lone] = cands.sort((a, b) => links(b) - links(a) || size[a] - size[b])[0];
    }
    const zones = [];
    names.forEach((name, z) => {
      const list = zoneOf.map((v, i) => (v === z ? i : -1)).filter(i => i >= 0);
      if (!list.length) return;
      const entries = list.filter(i => terr[i].neighbors.some(v => zoneOf[v] !== z)).length;
      for (const i of list) terr[i].zone = zones.length;
      const fixed = Math.max(0, ...list.map(i => defs[i].zoneBonus || 0)); // bonus imposé par la carte (île du Cercle)
      zones.push({ name, terr: list, entries, bonus: fixed || Math.max(1, Math.round((list.length + 1.5 * entries) / 3)) });
    });
    return zones;
  }

  const SIZES = { small: 25, medium: 40, large: 60 }; // ordre de grandeur du nombre de territoires par taille
  const MAP_LIST = [
    { id: 'random', name: 'Aléatoire' }, { id: 'europe', name: 'Europe' }, { id: 'france', name: 'France' },
    { id: 'italy', name: 'Italie' }, { id: 'med', name: 'Méditerranée' }, { id: 'world', name: 'Monde' }, { id: 'circle', name: 'Cercle' },
  ];
  const COLORS = ['#e6194b', '#3c7dd9', '#3cb44b', '#f58231', '#911eb4', '#16b5b5', '#d6c400', '#f032e6'];

  // Réglages par défaut ("auto") complétés selon le nombre de joueurs
  function resolveOpts(opts, nPlayers) {
    opts = opts || {};
    const map = MAP_LIST.some(m => m.id === opts.map) ? opts.map : 'random';
    // Taille : petite / moyenne / grande, ou auto selon le nombre de joueurs
    const sizeKey = SIZES[opts.size] ? opts.size : nPlayers <= 3 ? 'small' : nPlayers <= 5 ? 'medium' : 'large';
    const size = SIZES[sizeKey];
    const speed = [0.75, 1, 1.5].includes(+opts.speed) ? +opts.speed : 1;
    const startGold = opts.startGold === 'auto' || opts.startGold == null || isNaN(+opts.startGold) ? CFG.START_GOLD : Math.max(0, Math.min(1000, +opts.startGold));
    return { map, sizeKey, size, speed, startGold, buildings: opts.buildings !== false, fog: !!opts.fog, domination: 0.75 };
  }

  // ---------- RNG déterministe ----------
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // RNG stocké dans l'état (sérialisable)
  function srand(state) {
    state.rng = (state.rng + 0x6D2B79F5) | 0;
    let t = state.rng;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---------- Génération de carte ----------
  const SYL = ['ar', 'bel', 'cor', 'dan', 'el', 'fran', 'gal', 'hel', 'ist', 'kar', 'lor', 'mar', 'nor', 'os', 'pol', 'ros', 'sax', 'tal', 'ven', 'wal', 'ber', 'mon', 'lit', 'sil', 'bra', 'tur', 'ga', 'lu', 'via', 'dor'];
  const END = ['ia', 'ie', 'and', 'onia', 'heim', 'burg', 'ovie', 'ark', 'ie', 'ine', 'avia', 'ence'];

  function makeName(r, used) {
    for (let k = 0; k < 50; k++) {
      let n = SYL[Math.floor(r() * SYL.length)];
      if (r() < 0.4) n += SYL[Math.floor(r() * SYL.length)];
      n += END[Math.floor(r() * END.length)];
      n = n[0].toUpperCase() + n.slice(1);
      if (!used.has(n)) { used.add(n); return n; }
    }
    return 'Terre ' + used.size;
  }

  function valueNoise(r, w, h, step) {
    const gw = Math.ceil(w / step) + 2, gh = Math.ceil(h / step) + 2;
    const g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
    return function (x, y) {
      const fx = x / step, fy = y / step;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1];
      const c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    };
  }

  // Carte jouée : celle choisie, ou une des cartes au hasard (« Aléatoire »), tirée d'après la graine
  // (identique pour tous les joueurs d'une partie en ligne)
  function mapIdOf(seed, id) {
    if (MAP_LIST.some(m => m.id === id && m.id !== 'random')) return id;
    const real = MAP_LIST.filter(m => m.id !== 'random');
    return real[Math.floor(mulberry(seed ^ 0x2545f491)() * real.length)].id;
  }
  function generateMap(seed, opts) {
    opts = opts || {};
    const id = mapIdOf(seed, opts.map);
    const map = id === 'circle' ? circleMap(seed, opts.sizeKey) : dataMap(seed, mapData(id, opts.sizeKey));
    map.id = id;
    map.name = MAP_LIST.find(m => m.id === id).name;
    return map;
  }

  // ---------- Carte « Cercle » ----------
  // Un anneau de terre entre la mer extérieure et un lac central ; au milieu du lac, une île très riche
  // reliée à l'anneau par 4 passages (nord, est, sud, ouest). Pas de départ sur l'île.
  const CIRCLE = {
    small: { W: 110, layers: [9, 12], island: 1, bonus: 6 },
    medium: { W: 140, layers: [10, 12, 14], island: 4, bonus: 9 },
    large: { W: 170, layers: [14, 18, 22], island: 4, bonus: 12 },
  };
  function circleMap(seed, sizeKey) {
    const P = CIRCLE[sizeKey] || CIRCLE.medium;
    const W = P.W, H = P.W, C = W / 2, r = mulberry(seed);
    const R0 = 0.27, R1 = 0.52, R2 = 0.95; // île, bord intérieur de l'anneau, côte extérieure (en fraction du rayon)
    const nx = valueNoise(r, W, H, 12), ny = valueNoise(r, W, H, 12), nc = valueNoise(r, W, H, 9);
    const L = P.layers.length, offs = P.layers.map(() => r()), base = [];
    let next = 0;
    for (const n of P.layers) { base.push(next); next += n; }
    const islandBase = next;
    const cells = new Int16Array(W * H).fill(-1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const wx = x + nx(x, y) * 4, wy = y + ny(x, y) * 4;
      const dx = (wx - C) / C, dy = (wy - C) / C, rad = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      const coast = nc(x, y) * 0.03;
      let id = -1;
      if (rad <= R2 + coast && rad >= R1 + coast) {
        const l = Math.min(L - 1, Math.floor((rad - R1 - coast) / (R2 - R1) * L));
        const n = P.layers[l];
        id = base[l] + (Math.floor(((ang / (2 * Math.PI) + 1 + offs[l]) % 1) * n) % n);
      } else if (rad <= R0 + coast) {
        // île : un territoire (petite carte) ou 4 quartiers centrés sur les points cardinaux
        id = P.island === 1 ? islandBase : islandBase + Math.floor(((ang + Math.PI / 4) / (2 * Math.PI) + 1) * 4) % 4;
      }
      cells[y * W + x] = id;
    }
    // chaque territoire garde son plus grand morceau ; les miettes rejoignent un voisin (ou la mer)
    const T = islandBase + P.island, seen = new Uint8Array(W * H), best = new Array(T).fill(null), comps = [];
    const nbs = (c) => { const x = c % W; return [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c + W < W * H ? c + W : -1]; };
    for (let i = 0; i < W * H; i++) {
      if (seen[i] || cells[i] < 0) continue;
      const id = cells[i], comp = [i];
      seen[i] = 1;
      for (let k = 0; k < comp.length; k++) for (const n of nbs(comp[k])) if (n >= 0 && !seen[n] && cells[n] === id) { seen[n] = 1; comp.push(n); }
      comps.push({ id, comp });
      if (!best[id] || best[id].length < comp.length) best[id] = comp;
    }
    for (const { id, comp } of comps) {
      if (comp === best[id]) continue;
      let to = -1;
      for (const c of comp) for (const n of nbs(c)) if (n >= 0 && cells[n] >= 0 && cells[n] !== id) to = cells[n];
      for (const c of comp) cells[c] = to;
    }
    const remap = new Int16Array(T).fill(-1);
    let count = 0;
    for (let i = 0; i < W * H; i++) if (cells[i] >= 0 && remap[cells[i]] === -1) remap[cells[i]] = count++;
    for (let i = 0; i < W * H; i++) if (cells[i] >= 0) cells[i] = remap[cells[i]];

    // territoires : terrain, revenu, région (quart de l'anneau ou île)
    const used = new Set(), defs = new Array(count);
    const quarter = (ang) => ['Est', 'Sud', 'Ouest', 'Nord'][Math.floor(((ang + Math.PI / 4) / (2 * Math.PI) + 1) * 4) % 4];
    const sum = new Array(count).fill(0).map(() => [0, 0, 0]);
    for (let i = 0; i < W * H; i++) if (cells[i] >= 0) { const s = sum[cells[i]]; s[0] += i % W; s[1] += (i / W) | 0; s[2]++; }
    for (let old = 0; old < T; old++) {
      const id = remap[old];
      if (id < 0) continue;
      const [sx, sy, n] = sum[id], ang = Math.atan2(sy / n - C, sx / n - C);
      if (old >= islandBase) {
        defs[id] = { name: P.island === 1 ? 'Île centrale' : 'Île — ' + quarter(ang), income: 3, terrain: 'city', zone: 'Île centrale',
          zoneBonus: P.bonus, noCapital: true, extraTroops: 8 };
      } else {
        const v = r();
        const terrain = v < 0.5 ? 'plain' : v < 0.75 ? 'forest' : v < 0.9 ? 'mountain' : 'city';
        const zone = { Nord: 'Terres du Nord', Sud: 'Terres du Sud', Est: "Terres de l'Est", Ouest: "Terres de l'Ouest" }[quarter(ang)];
        defs[id] = { name: makeName(r, used), income: 1 + Math.floor(r() * 3), terrain, zone };
      }
    }
    // 4 passages de l'île vers l'anneau, aux points cardinaux
    const seaLinks = [];
    for (const ang of [-Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
      const at = (rad) => { const x = Math.round(C + Math.cos(ang) * rad * C), y = Math.round(C + Math.sin(ang) * rad * C); return cells[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))]; };
      let isl = -1, ring = -1;
      for (let k = R0; k > 0 && isl < 0; k -= 0.01) isl = at(k);
      for (let k = R1; k < R2 && ring < 0; k += 0.01) ring = at(k);
      if (isl >= 0 && ring >= 0 && !seaLinks.some(([a, c]) => a === isl && c === ring)) seaLinks.push([isl, ring]);
    }
    return buildMap(seed, W, H, cells, defs, seaLinks);
  }

  // Cartes réelles pré-calculées (grille en RLE, -1 = mer, -2 = terre hors jeu)
  function mapData(map, sizeKey) {
    const set = map === 'europe' ? EUROPE : EXTRA && EXTRA[map];
    return set ? set[sizeKey] || set.large : null;
  }
  // Nombre de territoires d'une carte pour une taille (pour l'affichage des réglages ; null : carte tirée au hasard)
  function territoryCount(map, sizeKey) {
    if (map === 'circle') { const P = CIRCLE[sizeKey] || CIRCLE.medium; return P.layers.reduce((a, n) => a + n, 0) + P.island; }
    const d = mapData(map, sizeKey);
    return d ? d.regions.length : null;
  }
  function dataMap(seed, d) {
    const cells = new Int16Array(d.w * d.h);
    let p = 0;
    for (let i = 0; i < d.rle.length; i += 2) { cells.fill(d.rle[i], p, p + d.rle[i + 1]); p += d.rle[i + 1]; }
    return buildMap(seed, d.w, d.h, cells, d.regions.map(r => ({ name: r.name, income: r.income, terrain: r.terrain, country: r.country, zone: r.zone })), d.seaLinks);
  }

  // Construit la carte à partir d'une grille (-1 = mer) et de la liste des territoires
  function buildMap(seed, W, H, cells, defs, seaLinks) {
    const count = defs.length;
    const terr = defs.map((d, i) => ({ id: i, name: d.name, country: d.country, income: d.income, terrain: d.terrain, size: 0, sx: 0, sy: 0, neighbors: new Set(), sea: [], lx: 0, ly: 0,
      noCapital: !!d.noCapital, extraTroops: d.extraTroops || 0 }));

    // Adjacence, segments de frontière (b = -1 : côte), distance au bord
    const segments = [];
    const dist = new Int32Array(W * H).fill(-1);
    const queue = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, a = cells[i];
        if (a < 0) {
          if (x < W - 1 && cells[i + 1] >= 0) segments.push([x + 1, y, x + 1, y + 1, cells[i + 1], -1]);
          if (y < H - 1 && cells[i + W] >= 0) segments.push([x, y + 1, x + 1, y + 1, cells[i + W], -1]);
          continue;
        }
        const t = terr[a];
        t.size++; t.sx += x + 0.5; t.sy += y + 0.5;
        let border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
        if (x < W - 1) {
          const b = cells[i + 1];
          if (b !== a) {
            border = true;
            if (b >= 0) { t.neighbors.add(b); terr[b].neighbors.add(a); }
            segments.push([x + 1, y, x + 1, y + 1, a, b]);
          }
        }
        if (y < H - 1) {
          const b = cells[i + W];
          if (b !== a) {
            border = true;
            if (b >= 0) { t.neighbors.add(b); terr[b].neighbors.add(a); }
            segments.push([x, y + 1, x + 1, y + 1, a, b]);
          }
        }
        if (x > 0 && cells[i - 1] !== a) border = true;
        if (y > 0 && cells[i - W] !== a) border = true;
        if (border) { dist[i] = 0; queue.push(i); }
      }
    }
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k], x = c % W, y = (c / W) | 0;
      const nb = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
      for (const n of nb) if (n >= 0 && cells[n] >= 0 && dist[n] === -1) { dist[n] = dist[c] + 1; queue.push(n); }
    }
    const bestD = new Array(count).fill(-Infinity);
    for (let i = 0; i < W * H; i++) {
      const a = cells[i];
      if (a < 0) continue;
      const t = terr[a];
      const cx = t.sx / t.size, cy = t.sy / t.size;
      const x = i % W + 0.5, y = ((i / W) | 0) + 0.5;
      const score = dist[i] * 4 - Math.hypot(x - cx, y - cy);
      if (score > bestD[a]) { bestD[a] = score; t.lx = x; t.ly = y; }
    }
    for (const [a, b] of seaLinks) {
      terr[a].neighbors.add(b); terr[b].neighbors.add(a);
      terr[a].sea.push(b); terr[b].sea.push(a);
    }
    for (const t of terr) {
      t.neighbors = Array.from(t.neighbors).sort((a, b) => a - b);
      delete t.sx; delete t.sy;
    }

    // Point de passage sur la frontière commune de chaque paire de voisins :
    // les troupes passent par là, sans traverser un autre territoire
    const crossing = {};
    const bestC = {};
    const outside = (x0, y0, x1, y1, a, b) => { // nombre de points du segment hors des territoires a et b
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
      let bad = 0;
      for (let i = 1; i < n; i++) {
        const x = Math.min(W - 1, Math.floor(x0 + (x1 - x0) * i / n)), y = Math.min(H - 1, Math.floor(y0 + (y1 - y0) * i / n));
        const c = cells[y * W + x];
        if (c !== a && c !== b) bad++;
      }
      return bad;
    };
    for (const [x1, y1, x2, y2, a, b] of segments) {
      if (b < 0) continue;
      const k = a < b ? a + '-' + b : b + '-' + a;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const A = terr[a], B = terr[b];
      const len = Math.hypot(A.lx - mx, A.ly - my) + Math.hypot(B.lx - mx, B.ly - my);
      const score = len + 100 * (outside(A.lx, A.ly, mx, my, a, b) + outside(mx, my, B.lx, B.ly, a, b));
      if (bestC[k] === undefined || score < bestC[k]) { bestC[k] = score; crossing[k] = [mx, my]; }
    }
    // Passages maritimes : milieu entre les deux côtes les plus proches
    for (const [a, b] of seaLinks) {
      const k = a < b ? a + '-' + b : b + '-' + a;
      if (crossing[k]) continue;
      const coast = (id) => {
        const out = [];
        for (const s of segments) if (s[4] === id && s[5] === -1) out.push([(s[0] + s[2]) / 2, (s[1] + s[3]) / 2]);
        return out;
      };
      const ca = coast(a), cb = coast(b);
      let best = null, bd = Infinity;
      for (const p of ca) for (const q of cb) { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < bd) { bd = d; best = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; } }
      crossing[k] = best || [(terr[a].lx + terr[b].lx) / 2, (terr[a].ly + terr[b].ly) / 2];
    }
    const zones = buildZones(terr, defs);
    return { seed, w: W, h: H, cells, terr, segments, crossing, seaLinks, zones };
  }

  // Distances en sauts dans le graphe
  function graphDist(map, from) {
    const d = new Array(map.terr.length).fill(Infinity);
    d[from] = 0;
    const q = [from];
    for (let k = 0; k < q.length; k++) for (const n of map.terr[q[k]].neighbors) if (d[n] === Infinity) { d[n] = d[q[k]] + 1; q.push(n); }
    return d;
  }

  // ---------- Partie ----------
  // players: [{ id, name, bot: false | 'easy'|'normal'|'hard' }]
  // start : territoire de départ choisi par le joueur 0 (facultatif)
  function createGame(map, players, seed, opts, start) {
    opts = resolveOpts(opts, players.length);
    const state = {
      time: 0, rng: seed | 0, incomeAcc: 0, sec: 0, nextArmy: 1, winner: null, opts,
      territories: map.terr.map(() => ({ owner: -1, troops: 0, buildings: [], auto: -1 })), // auto : envoi automatique vers ce territoire
      players: [], armies: [], history: [], bigBattle: null,
    };
    for (let i = 0; i < map.terr.length; i++) {
      state.territories[i].troops = 2 + map.terr[i].income * 2 + map.terr[i].extraTroops + Math.floor(srand(state) * 4);
    }
    // Capitales le plus éloignées possible les unes des autres (jamais sur un territoire interdit, comme l'île du Cercle)
    const caps = [];
    const dists = [];
    const allowed = map.terr.filter(t => !t.noCapital).map(t => t.id);
    for (let i = 0; i < players.length; i++) {
      let pick;
      if (i === 0) {
        pick = allowed[Math.floor(srand(state) * allowed.length)];
        if (start >= 0 && start < map.terr.length && !map.terr[start].noCapital) pick = start;
      }
      else {
        let best = -1, bs = -1;
        for (const t of allowed) {
          if (caps.includes(t)) continue;
          let m = Infinity;
          for (const d of dists) m = Math.min(m, d[t]);
          const s = m + srand(state) * 0.5;
          if (s > bs) { bs = s; best = t; }
        }
        pick = best;
      }
      caps.push(pick);
      dists.push(graphDist(map, pick));
    }
    players.forEach((p, i) => {
      state.players.push({
        id: p.id, name: p.name, bot: p.bot || false, color: COLORS[i % COLORS.length],
        gold: opts.startGold, alive: true, capital: caps[i], nextThink: 1 + srand(state),
        stats: { bought: 0, captures: 0, lost: 0, peakTerr: 1, capitals: 0, built: 0, builtKind: {} },
      });
      state.territories[caps[i]].owner = i;
      state.territories[caps[i]].troops = CFG.START_TROOPS;
    });
    state.capitals = caps.slice(); // capitales de départ (étoile affichée en permanence)
    recordHistory(state);
    return state;
  }

  function recordHistory(state) {
    const counts = state.players.map(() => 0);
    for (const t of state.territories) if (t.owner >= 0) counts[t.owner]++;
    state.history.push(counts);
  }

  function incomeOf(state, map, pi) {
    let inc = CFG.BASE_INCOME;
    state.territories.forEach((t, i) => {
      if (t.owner !== pi) return;
      inc += terrIncome(state, map, i);
    });
    map.zones.forEach((z, k) => { if (zoneOwner(state, map, k) === pi) inc += z.bonus; });
    return inc;
  }

  // Multiplicateur de défense d'un territoire (terrain + fort)
  function defenseOf(state, map, i) {
    return CFG.DEF_BONUS * TERRAIN[map.terr[i].terrain].def * (1 + 0.5 * countOf(state.territories[i], 'fort'));
  }

  function crossingPoint(map, a, b) {
    return map.crossing[a < b ? a + '-' + b : b + '-' + a];
  }

  function isSea(map, a, b) {
    return map.terr[a].sea.includes(b);
  }

  // Vitesse sur un territoire : chez soi (routes connues), forêt et montagne ralentissent beaucoup moins
  function speedOn(map, i, state, pi) {
    const s = TERRAIN[map.terr[i].terrain].speed;
    return state && state.territories[i].owner === pi ? 1 - (1 - s) * CFG.OWN_TERRAIN_SLOW : s;
  }
  // Durée d'une étape : moitié du trajet au rythme du terrain de départ, moitié au rythme de l'arrivée,
  // et 2 fois plus lent par la mer. Avec state et pi : moins ralenti sur ses propres territoires.
  function travelTime(map, a, b, state, pi) {
    const A = map.terr[a], B = map.terr[b], P = crossingPoint(map, a, b);
    const d1 = Math.hypot(A.lx - P[0], A.ly - P[1]), d2 = Math.hypot(P[0] - B.lx, P[1] - B.ly);
    const t = (d1 / speedOn(map, a, state, pi) + d2 / speedOn(map, b, state, pi)) / CFG.ARMY_SPEED;
    return t * (isSea(map, a, b) ? CFG.SEA_SLOW : 1) + 0.3;
  }

  // Position (en cases) d'une armée sur le trajet a -> frontière -> b, k entre 0 et 1 (temps écoulé)
  function legPos(map, a, b, k, state, pi) {
    const A = map.terr[a], B = map.terr[b], P = crossingPoint(map, a, b);
    const d1 = Math.hypot(A.lx - P[0], A.ly - P[1]), d2 = Math.hypot(P[0] - B.lx, P[1] - B.ly);
    const t1 = d1 / speedOn(map, a, state, pi), t2 = d2 / speedOn(map, b, state, pi);
    const t = k * (t1 + t2);
    if (t <= t1) { const f = t1 ? t / t1 : 0; return [A.lx + (P[0] - A.lx) * f, A.ly + (P[1] - A.ly) * f]; }
    const f = t2 ? (t - t1) / t2 : 1;
    return [P[0] + (B.lx - P[0]) * f, P[1] + (B.ly - P[1]) * f];
  }

  // Chemin le plus rapide de `from` vers `to`. Traverser un territoire qui n'est pas à soi
  // coûte plus cher (il faudra l'attaquer), donc on l'évite quand un détour raisonnable existe.
  // Retourne la liste des étapes après `from` (la dernière est `to`), ou null.
  function findPath(state, map, pi, from, to) {
    if (from === to || to < 0 || to >= map.terr.length) return null;
    const N = map.terr.length;
    const cost = new Array(N).fill(Infinity), prev = new Array(N).fill(-1), done = new Array(N).fill(false);
    cost[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < N; i++) if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
      if (u < 0) return null;
      if (u === to) break;
      done[u] = true;
      for (const v of map.terr[u].neighbors) {
        if (done[v]) continue;
        let c = travelTime(map, u, v, state, pi);
        const tv = state.territories[v];
        if (v !== to && tv.owner !== pi) c += 4 + tv.troops * defenseOf(state, map, v) * 0.5;
        if (cost[u] + c < cost[v]) { cost[v] = cost[u] + c; prev[v] = u; }
      }
    }
    const path = [];
    for (let x = to; x !== from; x = prev[x]) path.unshift(x);
    return path;
  }

  // Chemin entièrement dans mes territoires (pour les envois automatiques)
  function ownPath(state, map, pi, from, to) {
    const prev = new Map([[from, -1]]), q = [from];
    for (let k = 0; k < q.length; k++) for (const n of map.terr[q[k]].neighbors) {
      if (prev.has(n) || state.territories[n].owner !== pi) continue;
      prev.set(n, q[k]);
      if (n === to) return true;
      q.push(n);
    }
    return false;
  }

  // Retourne true si l'action est valide et appliquée
  function applyAction(state, map, pi, act) {
    if (state.winner != null || !act) return false;
    const p = state.players[pi];
    if (!p || !p.alive) return false;
    if (act.type === 'buy') {
      const t = state.territories[act.t];
      if (!t || t.owner !== pi) return false;
      const n = Math.min(Math.floor(act.n) || 0, Math.floor(p.gold / CFG.SOLDIER_COST));
      if (n <= 0) return false;
      p.gold -= n * CFG.SOLDIER_COST;
      t.troops += n;
      p.stats.bought += n;
      return true;
    }
    if (act.type === 'build') {
      const t = state.territories[act.t], b = BUILDINGS[act.kind];
      if (!state.opts.buildings || !t || !b || t.owner !== pi || countOf(t, act.kind) >= maxBuildings(state, act.t, act.kind)) return false;
      const cost = buildCost(state, pi, act.kind);
      if (p.gold < cost) return false;
      p.gold -= cost;
      t.buildings.push(act.kind);
      p.stats.built++;
      p.stats.builtKind[act.kind] = (p.stats.builtKind[act.kind] || 0) + 1;
      return true;
    }
    if (act.type === 'auto') {
      // Envoi automatique : les soldats de `from` partent régulièrement vers `to` (un de mes territoires) ; to = -1 l'arrête
      const from = state.territories[act.from];
      if (!from || from.owner !== pi) return false;
      if (act.to === -1 || act.to == null) { from.auto = -1; return true; }
      const to = state.territories[act.to];
      if (!to || to.owner !== pi || act.to === act.from || !ownPath(state, map, pi, act.from, act.to)) return false;
      from.auto = act.to;
      return true;
    }
    if (act.type === 'send') {
      const from = state.territories[act.from];
      if (!from || from.owner !== pi) return false;
      const path = findPath(state, map, pi, act.from, act.to);
      if (!path) return false;
      const n = Math.min(Math.floor(act.n) || 0, from.troops - 1); // il reste toujours 1 soldat
      if (n <= 0) return false;
      from.troops -= n;
      const first = path.shift();
      state.armies.push({ id: state.nextArmy++, owner: pi, from: act.from, to: first, path, n, t: 0, dur: travelTime(map, act.from, first, state, pi), legs: 1 });
      return true;
    }
    return false;
  }

  // Combat à l'arrivée sur un territoire. Retourne true si l'armée y est maîtresse ensuite.
  function resolveArrival(state, map, a) {
    const t = state.territories[a.to];
    if (t.owner === a.owner) { t.troops += a.n; return true; }
    const r = 0.85 + srand(state) * 0.3;
    const att = a.n * r, def = t.troops * defenseOf(state, map, a.to);
    const size = a.n + t.troops;
    if (!state.bigBattle || size > state.bigBattle.size) {
      state.bigBattle = { size, where: a.to, attacker: a.owner, defender: t.owner, att: a.n, def: t.troops, time: Math.round(state.time) };
    }
    if (att > def) {
      const prev = t.owner;
      t.owner = a.owner;
      t.auto = -1;
      t.troops = Math.max(1, Math.round(att - def));
      const me = state.players[a.owner];
      me.stats.captures++;
      if (prev >= 0) {
        const pp = state.players[prev];
        pp.stats.lost++;
        pp.lastHitBy = a.owner; // pour lui donner l'or restant si ce joueur est éliminé
        // Capitale prise : le vaincu perd la moitié de son or, le vainqueur la récupère
        if (pp.capital === a.to) {
          const half = Math.floor(pp.gold / 2);
          pp.gold -= half;
          me.gold += half;
          pp.capital = null;
          me.stats.capitals++;
        }
      }
      return true;
    }
    t.troops = Math.max(0, Math.round((def - att) / defenseOf(state, map, a.to)));
    return false;
  }

  // Deux armées ennemies sur le même chemin en sens inverse se battent quand elles se croisent
  function armyClashes(state) {
    const A = state.armies;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (a.n <= 0) continue;
      for (let j = i + 1; j < A.length && a.n > 0; j++) {
        const b = A[j];
        if (b.n <= 0 || a.owner === b.owner || a.from !== b.to || a.to !== b.from) continue;
        if (a.t / a.dur + b.t / b.dur < 1) continue;
        const r = 0.9 + srand(state) * 0.2;
        const ea = a.n * r;
        if (ea > b.n) { a.n = Math.max(1, Math.round((ea - b.n) / r)); b.n = 0; }
        else if (ea < b.n) { b.n = Math.max(1, Math.round(b.n - ea)); a.n = 0; }
        else { a.n = 0; b.n = 0; }
      }
    }
  }

  function step(state, map, dt) {
    if (state.winner != null) return;
    dt *= state.opts.speed;
    state.time += dt;
    state.incomeAcc += dt;
    while (state.incomeAcc >= 1) {
      state.incomeAcc -= 1;
      state.sec++;
      if (state.sec % CFG.INCOME_EVERY === 0) state.players.forEach((p, i) => { if (p.alive) p.gold += incomeOf(state, map, i); });
      if (state.sec % CFG.BARRACKS_EVERY === 0) for (const t of state.territories) if (t.owner >= 0) t.troops += countOf(t, 'barracks');
      // envois automatiques toutes les 2 s (la route s'arrête si un des deux territoires change de main ou si le chemin est coupé)
      if (state.sec % 2 === 0) state.territories.forEach((t, i) => {
        if (t.auto < 0) return;
        const dst = state.territories[t.auto];
        if (t.owner < 0 || dst.owner !== t.owner || !ownPath(state, map, t.owner, i, t.auto)) { t.auto = -1; return; }
        if (t.troops >= 3) applyAction(state, map, t.owner, { type: 'send', from: i, to: t.auto, n: t.troops - 1 });
      });
      if (state.sec % CFG.HISTORY_EVERY === 0) recordHistory(state);
    }

    for (const a of state.armies) a.t += dt;
    armyClashes(state);
    const keep = [];
    for (const a of state.armies) {
      if (a.n <= 0) continue;
      if (a.t < a.dur) { keep.push(a); continue; }
      if (!a.path || !a.path.length) { resolveArrival(state, map, a); continue; }
      // Étape intermédiaire : chez soi on passe, sinon on attaque. Si on gagne, on laisse 1 soldat et on continue.
      const here = state.territories[a.to];
      if (here.owner !== a.owner) {
        if (!resolveArrival(state, map, a)) continue;
        if (here.troops < 2) continue;
        a.n = here.troops - 1;
        here.troops = 1;
      }
      a.legs++;
      if (a.legs > CFG.FREE_LEGS) a.n = Math.max(1, Math.round(a.n * (1 - CFG.FATIGUE)));
      a.from = a.to;
      a.to = a.path.shift();
      a.t = 0;
      a.dur = travelTime(map, a.from, a.to, state, a.owner);
      keep.push(a);
    }
    state.armies = keep;

    // Éliminations / victoire / statistiques
    const has = new Array(state.players.length).fill(false);
    const counts = new Array(state.players.length).fill(0);
    for (const t of state.territories) if (t.owner >= 0) { has[t.owner] = true; counts[t.owner]++; }
    for (const a of state.armies) has[a.owner] = true;
    state.players.forEach((p, i) => {
      if (counts[i] > p.stats.peakTerr) p.stats.peakTerr = counts[i];
      if (p.alive && !has[i]) {
        // éliminé : celui qui lui a pris son dernier territoire récupère tout son or restant (au moins 100)
        const killer = p.lastHitBy != null ? state.players[p.lastHitBy] : null;
        if (killer && killer.alive && p.lastHitBy !== i) { const prize = Math.max(CFG.KILL_GOLD, p.gold); killer.gold += prize; p.stats.goldLostAtEnd = Math.round(prize); }
        p.alive = false; p.gold = 0; p.stats.outAt = Math.round(state.time);
      }
    });
    const alive = state.players.map((p, i) => (p.alive ? i : -1)).filter(i => i >= 0);
    // Victoire par domination : contrôler 75 % des territoires
    const dom = counts.findIndex(c => c >= Math.ceil(state.territories.length * (state.opts.domination || 1)));
    if (dom >= 0 && state.players.length > 1) {
      state.winner = dom;
      state.winBy = 'domination';
      recordHistory(state);
    } else if (alive.length <= 1 && state.players.length > 1) {
      state.winner = alive.length ? alive[0] : -1;
      state.winBy = 'elimination';
      recordHistory(state);
    }

    // Bots
    state.players.forEach((p, i) => {
      if (!p.bot || !p.alive) return;
      p.nextThink -= dt;
      if (p.nextThink <= 0) {
        p.nextThink = (CFG.BOT_THINK[p.bot] || 1.6) * (0.8 + srand(state) * 0.4);
        botThink(state, map, i);
      }
    });
  }

  // ---------- IA ----------
  function botThink(state, map, pi) {
    const p = state.players[pi];
    const T = state.territories;
    const level = p.bot;
    const margin = level === 'hard' ? 1.25 : level === 'easy' ? 1.6 : 1.4;
    // face à une grosse pile, la marge de sécurité baisse : sinon deux voisins s'observent sans fin et accumulent des centaines de soldats
    // (et contre le premier, quand on le cible : on prend plus de risques pour l'arrêter)
    const marginOf = (def, owner) => (def >= 30 || (owner === first && focus) ? Math.min(margin, 1.12) : margin);
    const mine = [];
    T.forEach((t, i) => { if (t.owner === pi) mine.push(i); });
    // or de base d'une case (hors terrain et mines) : revenu propre + capitale
    const baseInc = (i) => map.terr[i].income + ((state.capitals || []).includes(i) ? CFG.CAPITAL_BONUS : 0);
    // intérêt d'une case pour les régions : compléter la sienne, casser celle d'un adversaire
    const zoneHeld = map.zones.map((z, k) => zoneOwner(state, map, k));
    const zoneMine = map.zones.map(z => z.terr.filter(i => T[i].owner === pi).length);
    const zoneVal = (i) => {
      const k = map.terr[i].zone, z = map.zones[k];
      if (T[i].owner === pi) return zoneHeld[k] === pi ? z.bonus : 0;
      let v = zoneMine[k] + 1 === z.terr.length ? z.bonus * 2.5 // dernière case qui manque
        : z.bonus * 1.2 * (zoneMine[k] + 1) / z.terr.length;
      if (zoneHeld[k] >= 0) v += z.bonus * 1.5; // casser le bonus d'un adversaire
      return v;
    };
    if (!mine.length) return;
    if (!p.atk) p.atk = { lead: 0, other: 0 }; // compteur d'attaques contre le premier / contre les autres joueurs
    // Comme un humain qui clique : un nombre limité d'actions (envoi, achat, construction) à chaque réflexion
    let budget = { easy: 1, normal: 2, hard: 3 }[level] || 2;
    const doAct = (act) => {
      if (budget <= 0) return false;
      const ok = applyAction(state, map, pi, act);
      if (ok) budget--;
      return ok;
    };

    const incoming = {}; // troupes déjà envoyées par moi vers un territoire
    for (const a of state.armies) if (a.owner === pi) {
      const dest = a.path && a.path.length ? a.path[a.path.length - 1] : a.to;
      incoming[dest] = (incoming[dest] || 0) + a.n;
    }

    // Le « premier » : celui qui a le plus de territoires (départage : soldats). Pour gagner, il faut
    // l'empêcher de gagner : tant que le bot n'est pas lui-même premier, au moins 70 % de ses attaques
    // contre des joueurs visent le premier, même s'il n'est pas voisin (attaque à travers la carte).
    const counts = state.players.map(() => 0), troops = state.players.map(() => 0);
    T.forEach(t => { if (t.owner >= 0) { counts[t.owner]++; troops[t.owner] += t.troops; } });
    let first = -1;
    state.players.forEach((q, i) => {
      if (!q.alive) return;
      if (first < 0 || counts[i] > counts[first] || (counts[i] === counts[first] && troops[i] > troops[first])) first = i;
    });
    const iLead = first === pi;
    // le premier doit avoir une vraie avance (sinon, quand tout le monde est au coude à coude, la partie tournerait en rond)
    let second = 0;
    counts.forEach((c, i) => { if (i !== first && state.players[i].alive) second = Math.max(second, c); });
    const clearLead = first >= 0 && counts[first] >= second + 2;
    const focus = level !== 'easy' && !iLead && clearLead;
    const QUOTA = 0.7;
    const leadShare = (extraLead, extraOther) => (p.atk.lead + extraLead) / Math.max(1, p.atk.lead + p.atk.other + extraLead + extraOther);
    const neutralsLeft = T.filter(t => t.owner === -1).length;
    // un joueur réduit à 1-2 territoires une fois la carte partagée : l'achever fait avancer la partie
    // (3 territoires au plus face à un empire 4 fois plus grand, après avoir perdu du terrain ou passé le début de partie) :
    // on l'achève, où qu'il soit
    const nearlyOut = (o) => o >= 0 && o !== pi && state.players[o].alive && counts[o] <= 3 && counts[pi] >= 4 * counts[o]
      && (state.players[o].stats.peakTerr > counts[o] || state.time > 240);

    const launch = (from, to, n) => {
      const owner = T[to].owner;
      if (!doAct({ type: 'send', from, to, n })) return false;
      if (owner === first) p.atk.lead++; else if (owner >= 0 && !nearlyOut(owner)) p.atk.other++;
      return true;
    };
    // Troupes nécessaires pour aller de `from` à `to` en prenant tout ce qui n'est pas à moi sur le chemin
    const costOf = (from, to) => {
      const path = findPath(state, map, pi, from, to);
      if (!path) return null;
      let need = 2;
      path.forEach((v, k) => {
        if (T[v].owner === pi) return;
        need += Math.ceil(T[v].troops * defenseOf(state, map, v) * marginOf(T[v].troops, T[v].owner)) + (k < path.length - 1 ? 1 : 0);
      });
      need = Math.ceil(need * Math.pow(1 + CFG.FATIGUE, Math.max(0, path.length - CFG.FREE_LEGS)));
      return { path, need: need - (incoming[to] || 0) };
    };

    const frontier = mine.filter(i => map.terr[i].neighbors.some(n => T[n].owner !== pi));

    // ---- Défense ----
    // Armées ennemies en route : la première de mes cases sur leur chemin est menacée
    const hostile = new Array(T.length).fill(0);
    for (const a of state.armies) {
      if (a.owner === pi) continue;
      for (const v of [a.to].concat(a.path || [])) if (T[v].owner === pi) { hostile[v] += a.n; break; }
    }
    // Soldats à garder sur place quand une attaque arrive (le terrain et les forts comptent dans la défense)
    // Garnison permanente de la capitale : grossit avec le temps et face à un voisin fort
    const capitalGarrison = () => {
      const c = p.capital;
      if (level === 'easy' || c == null || T[c].owner !== pi) return 0;
      let enemy = 0;
      for (const n of map.terr[c].neighbors) if (T[n].owner >= 0 && T[n].owner !== pi) enemy = Math.max(enemy, T[n].troops);
      return Math.min(40, Math.max(Math.ceil(6 + state.time / 40), Math.ceil(enemy * 1.1 / defenseOf(state, map, c))));
    };
    const garrison = capitalGarrison();
    const keepOf = (i) => {
      if (level === 'easy') return 0;
      const vsAttack = hostile[i] ? Math.ceil(hostile[i] * 1.15 / defenseOf(state, map, i)) : 0;
      return i === p.capital ? Math.max(vsAttack, garrison) : vsAttack;
    };
    const spare = (i) => T[i].troops - 1 - keepOf(i); // soldats disponibles pour attaquer ou renforcer ailleurs
    if (level !== 'easy') {
      // valeur d'un territoire : capitale, ville, montagne, revenu
      const value = (i) => (p.capital === i ? 20 : 0) + baseInc(i) * 2 + zoneVal(i) * 2 + TERRAIN[map.terr[i].terrain].income * 3 + (map.terr[i].terrain === 'mountain' ? 3 : 0);
      const attacked = mine.filter(i => hostile[i] > 0)
        .map(i => ({ i, deficit: Math.ceil(hostile[i] * 1.15 / defenseOf(state, map, i)) + 1 - T[i].troops }))
        .filter(x => x.deficit > 0)
        .sort((x, y) => value(y.i) - value(x.i));
      // capitale sous sa garnison (sans attaque en cours) : on la regarnit aussi, après les urgences
      if (garrison && p.capital != null && !attacked.some(x => x.i === p.capital) && T[p.capital].troops < garrison * 0.8) {
        attacked.push({ i: p.capital, deficit: garrison - T[p.capital].troops });
      }
      for (const { i, deficit } of attacked) {
        let need = deficit;
        // 1. acheter des défenseurs sur place
        const can = Math.min(need, Math.floor(p.gold / CFG.SOLDIER_COST));
        if (can > 0 && doAct({ type: 'buy', t: i, n: can })) need -= can;
        // 2. renforts depuis mes territoires voisins qui ont des soldats en trop
        for (const n of map.terr[i].neighbors) {
          if (need <= 0) break;
          if (T[n].owner !== pi || hostile[n] > 0) continue;
          const give = Math.min(need, spare(n));
          if (give > 0 && doAct({ type: 'send', from: n, to: i, n: give })) need -= give;
        }
      }
    }
    const used = new Set();
    let attacks = 0;
    // on garde toujours une action pour acheter quand il y a de l'or en caisse (sinon l'or s'accumule sans servir)
    // (avec une seule action, le bot facile alterne : un tour il achète, le suivant il attaque)
    p.flip = !p.flip;
    const keepBuy = p.gold >= 30 && (budget > 1 || p.flip) ? 1 : 0;
    const maxAttacks = Math.max(0, Math.min(level === 'hard' ? 3 : level === 'easy' ? 1 : 2, budget - keepBuy));
    let strike = null; // frappe en préparation (on accumule des troupes à `from`)

    // distance (en étapes) de chaque territoire à mon empire
    const dist = new Array(T.length).fill(Infinity);
    {
      const q = [];
      for (const i of mine) { dist[i] = 0; q.push(i); }
      for (let k = 0; k < q.length; k++) for (const n of map.terr[q[k]].neighbors) if (dist[n] === Infinity) { dist[n] = dist[q[k]] + 1; q.push(n); }
    }
    // Frappes à distance sur les territoires choisis : depuis mon territoire le plus proche, en prenant ce qui est sur le chemin
    const strikeOn = (isTarget, maxD, bonus) => {
      const targets = T.map((t, i) => i).filter(i => isTarget(i) && dist[i] <= maxD)
        .sort((x, y) => dist[x] - dist[y] || T[x].troops - T[y].troops).slice(0, 8);
      const cands = [];
      for (const tg of targets) {
        // source : le territoire le plus proche de la cible, à égalité celui qui a le plus de soldats
        const dt = new Array(T.length).fill(Infinity), qq = [tg];
        dt[tg] = 0;
        for (let k = 0; k < qq.length; k++) for (const n of map.terr[qq[k]].neighbors) if (dt[n] === Infinity) { dt[n] = dt[qq[k]] + 1; qq.push(n); }
        let src = -1;
        for (const i of mine) if (src < 0 || dt[i] < dt[src] || (dt[i] === dt[src] && T[i].troops > T[src].troops)) src = i;
        const c = costOf(src, tg);
        if (!c || c.need <= 0) continue;
        const o = T[tg].owner;
        let score = -c.need - dt[src] * 3 + baseInc(tg) * 2 + zoneVal(tg) * 2 + bonus;
        if (o >= 0 && state.players[o].capital === tg) score += 15 + state.players[o].gold / 50;
        cands.push({ from: src, to: tg, need: c.need, score });
      }
      cands.sort((x, y) => y.score - x.score);
      let done = 0;
      for (const c of cands) {
        if (attacks >= maxAttacks) break;
        if (used.has(c.to)) continue;
        if (spare(c.from) >= c.need && launch(c.from, c.to, c.need)) { used.add(c.to); attacks++; done++; }
      }
      if (!done && cands.length && !strike) strike = cands.reduce((best, c) => (c.need - T[c.from].troops < best.need - T[best.from].troops ? c : best));
    };

    // 0. Achever un joueur presque éliminé : il ne traîne pas en vie (et son or revient au vainqueur)
    if (state.players.some((q, i) => nearlyOut(i))) strikeOn(i => nearlyOut(T[i].owner), level === 'easy' ? 4 : 8, 10);

    // 1. Frappes sur le premier (bots normaux et difficiles qui ne sont pas premiers)
    if (focus) strikeOn(i => T[i].owner === first, 6, 0);

    const bigMin = Math.max(25, 10 + state.time / 30); // au-delà, une pile de soldats « dort » trop
    // 2. Autres attaques sur les voisins (neutres, autres joueurs) — en respectant le quota sur le premier
    const power = state.players.map((q, i) => counts[i] + troops[i] / 15 + (q.alive ? q.gold / 60 : 0));
    const options = [];
    for (const i of frontier) {
      if (strike && i === strike.from) continue; // on ne dégarnit pas la base de la frappe
      for (const n of map.terr[i].neighbors) {
        if (T[n].owner === pi) continue;
        const def = T[n].troops, o = T[n].owner;
        const need = Math.ceil(def * defenseOf(state, map, n) * marginOf(def, o)) + 2 - (incoming[n] || 0);
        let score = baseInc(n) * 3 + zoneVal(n) * 1.5 + TERRAIN[map.terr[n].terrain].income * 2 - def * 0.25;
        if (level === 'easy') score += o === -1 ? 1 : 0;
        else if (o === -1) score += neutralsLeft > T.length * 0.3 ? 2 : 0;
        else if (iLead) score += 3 * (1 - power[o] / Math.max(1, power[pi])); // premier : achever les plus faibles
        else if (nearlyOut(o)) score += 6;
        else if (!focus) score += 3 * (1 - power[o] / Math.max(1, power[first]));
        else if (o === first) score += 8;
        else if (leadShare(0, 1) < QUOTA) continue; // quota : pas d'attaque sur un autre que le premier
        else score -= 4;
        if (o >= 0 && state.players[o].capital === n) score += 3 + state.players[o].gold / 100;
        options.push({ from: i, to: n, need, score });
      }
    }
    options.sort((x, y) => y.score - x.score);
    for (const o of options) {
      if (attacks >= maxAttacks) break;
      if (used.has(o.to) || o.need <= 0) continue;
      const owner = T[o.to].owner;
      if (focus && owner >= 0 && owner !== first && !nearlyOut(owner) && leadShare(0, 1) < QUOTA) continue;
      // une grosse pile avance avec l'attaque au lieu de n'envoyer que le minimum
      const sp = spare(o.from), n = sp >= bigMin ? Math.max(o.need, Math.floor(sp * 0.6)) : o.need;
      if (sp >= o.need && launch(o.from, o.to, n)) { used.add(o.to); attacks++; }
    }

    // 2b. Grosses piles qui dorment : si un territoire a beaucoup de soldats sans cible voisine à sa portée,
    //     il frappe plus loin (contourne la pile d'en face) ; à défaut il attaque la pile voisine dès qu'il la dépasse
    const piles = mine.filter(i => spare(i) >= bigMin && !(strike && strike.from === i)).sort((x, y) => T[y].troops - T[x].troops);
    for (const src of piles.slice(0, 2)) {
      if (budget <= 0) break;
      const d = new Array(T.length).fill(Infinity), q = [src];
      d[src] = 0;
      for (let k = 0; k < q.length; k++) for (const n of map.terr[q[k]].neighbors) if (d[n] === Infinity && d[q[k]] < 5) { d[n] = d[q[k]] + 1; q.push(n); }
      let best = null;
      for (const tg of q) {
        if (T[tg].owner === pi || used.has(tg)) continue;
        const o = T[tg].owner;
        if (focus && o >= 0 && o !== first && !nearlyOut(o) && leadShare(0, 1) < QUOTA) continue;
        const c = costOf(src, tg);
        if (!c || c.need <= 0 || c.need > spare(src)) continue;
        let score = baseInc(tg) * 3 + zoneVal(tg) * 1.5 + TERRAIN[map.terr[tg].terrain].income * 2 - c.need * 0.05 - d[tg] * 2;
        if (o >= 0 && o === first && !iLead) score += 6;
        if (o >= 0 && state.players[o].capital === tg) score += 6 + state.players[o].gold / 100;
        if (!best || score > best.score) best = { tg, c, score };
      }
      if (!best) continue;
      // on envoie de quoi prendre la cible avec de la marge, la pile ne reste pas plantée là
      const n = Math.min(spare(src), Math.max(best.c.need, Math.ceil(spare(src) * 0.6)));
      if (launch(src, best.tg, n)) used.add(best.tg);
    }

    // 3. Bâtiments : uniquement avec l'or en trop, pour s'améliorer
    //    mine à l'arrière (surtout la capitale, surtout en début de partie), caserne près du front ou sur la base
    //    de frappe, fort sur un territoire de valeur menacé. Le bot épargne pour le meilleur choix quand rien ne presse.
    const underAttack = mine.some(i => hostile[i] > 0);
    let plan = null; // bâtiment visé : { t, kind, cost, score }
    // limites : forts selon la taille de l'empire, et un nombre total de bâtiments raisonnable
    let myForts = 0, myBuildings = 0;
    for (const i of mine) { myForts += countOf(T[i], 'fort'); myBuildings += T[i].buildings.length; }
    const fortCap = Math.max(1, Math.floor(mine.length / 6)), buildCap = 1 + Math.floor(mine.length * 0.5);
    const late = state.time > 900; // après 15 min, on n'épargne plus pour bâtir (sauf casernes)
    // Or « en trop » = ce qui reste une fois le front et la capitale correctement défendus
    let defenseGold = 0;
    for (const i of frontier) {
      let enemy = 0;
      for (const n of map.terr[i].neighbors) if (T[n].owner >= 0 && T[n].owner !== pi) enemy = Math.max(enemy, T[n].troops);
      const want = (p.capital === i ? 1.3 : 0.8) * enemy; // la capitale doit tenir face au plus gros voisin
      defenseGold += Math.max(0, Math.ceil(want / defenseOf(state, map, i)) - T[i].troops) * CFG.SOLDIER_COST;
    }
    const firstBuild = { easy: 200, normal: 150, hard: 120 }[level] || 150; // pas de bâtiment en tout début de partie
    const canInvest = state.time >= firstBuild && state.time - (p.lastBuild || -99) >= 45;
    if (state.opts.buildings && !underAttack && canInvest && myBuildings < buildCap) {
      const nearFront = new Set(frontier);
      for (const f of frontier) for (const n of map.terr[f].neighbors) if (T[n].owner === pi) nearFront.add(n);
      const early = Math.max(0, 1 - state.time / 900); // les mines rapportent plus si on les construit tôt
      for (const i of mine) {
        let enemy = 0;
        for (const n of map.terr[i].neighbors) if (T[n].owner >= 0 && T[n].owner !== pi) enemy = Math.max(enemy, T[n].troops);
        const isCap = p.capital === i, front = frontier.includes(i);
        const val = (isCap ? 6 : 0) + baseInc(i) + TERRAIN[map.terr[i].terrain].income * 2 + (map.terr[i].terrain === 'mountain' ? 2 : 0);
        for (const kind of Object.keys(BUILDINGS)) {
          if (countOf(T[i], kind) >= maxBuildings(state, i, kind)) continue;
          let score = 0;
          if (kind === 'mine') score = (front ? 1 : 5) + (isCap ? 4 : 0) + 4 * early;
          else if (kind === 'barracks') score = (nearFront.has(i) ? 4 : 1) + (isCap ? 2 : 0) + (strike && strike.from === i ? 3 : 0);
          else if (front && myForts < fortCap && (isCap || TERRAIN[map.terr[i].terrain].income > 0 || map.terr[i].terrain === 'mountain')
            && enemy > 0.8 * T[i].troops * defenseOf(state, map, i)) score = val / 2 + Math.min(3, 2 * enemy / Math.max(1, T[i].troops * defenseOf(state, map, i)));
          if (level === 'easy' && kind === 'fort') score = 0;
          if (late && kind !== 'barracks') score = 0; // fin de partie : place à l'offensive
          const cost = buildCost(state, pi, kind);
          const s2 = score * 30 / cost;
          if (score >= 3 && (!plan || s2 > plan.score)) plan = { t: i, kind, cost, score: s2 };
        }
      }
      // construire si l'or en trop suffit (une petite réserve reste pour les soldats)
      const reserve = { easy: 25, normal: 15, hard: 10 }[level] || 15;
      if (plan && p.gold >= plan.cost + reserve + defenseGold && doAct({ type: 'build', t: plan.t, kind: plan.kind })) { plan = null; p.lastBuild = state.time; }
    }
    // or réservé au bâtiment visé quand rien ne presse (pas de frappe en préparation)
    const saving = plan && !strike && !late && defenseGold === 0 ? plan.cost : 0;

    // 4. Achats : défense si menace grave, sinon préparer la frappe sur le premier, sinon l'attaque la plus rentable
    const affordable = Math.floor(p.gold / CFG.SOLDIER_COST);
    const freeGold = Math.max(0, Math.floor((p.gold - saving) / CFG.SOLDIER_COST)); // soldats achetables sans toucher à l'épargne
    if (affordable > 0) {
      let threatT = -1, threat = 0;
      for (const i of frontier) {
        let enemy = 0;
        for (const n of map.terr[i].neighbors) if (T[n].owner >= 0 && T[n].owner !== pi) enemy = Math.max(enemy, T[n].troops);
        const th = enemy - T[i].troops * defenseOf(state, map, i);
        if (th > threat) { threat = th; threatT = i; }
      }
      let target = null, bestVal = -Infinity;
      for (const o of options) {
        if (used.has(o.to)) continue;
        const deficit = o.need - (T[o.from].troops - 1);
        if (deficit <= 0 || deficit > affordable + 4) continue;
        const v = o.score - deficit * 0.3;
        if (v > bestVal) { bestVal = v; target = o; }
      }
      if (threatT >= 0 && level !== 'easy' && threat > (strike ? 12 : 3) && (!target || threat > 8)) {
        doAct({ type: 'buy', t: threatT, n: Math.min(affordable, Math.ceil(threat / defenseOf(state, map, threatT)) + 2) });
      } else if (strike) {
        doAct({ type: 'buy', t: strike.from, n: affordable });
      } else if (target && freeGold > 0) {
        doAct({ type: 'buy', t: target.from, n: Math.min(freeGold, target.need - (T[target.from].troops - 1)) });
      } else if (frontier.length && freeGold >= 3) {
        doAct({ type: 'buy', t: frontier[Math.floor(srand(state) * frontier.length)], n: freeGold });
      }
      // l'or restant (au-delà de l'épargne pour un bâtiment) ne dort pas : il part en soldats sur le front
      const left = Math.floor((p.gold - saving) / CFG.SOLDIER_COST);
      if (left >= 8 && frontier.length) {
        // sur la case du front la plus faible face à ses voisins (pas sur une pile déjà énorme)
        let spot = strike ? strike.from : -1, worst = Infinity;
        if (spot < 0) for (const i of frontier) {
          let enemy = 1;
          for (const n of map.terr[i].neighbors) if (T[n].owner !== pi) enemy = Math.max(enemy, T[n].troops);
          const ratio = T[i].troops * defenseOf(state, map, i) / enemy;
          if (ratio < worst) { worst = ratio; spot = i; }
        }
        doAct({ type: 'buy', t: spot, n: left });
      }
    }

    // 5. Les territoires intérieurs envoient leurs troupes vers le front (vers la base de frappe s'il y en a une,
    //    sinon de préférence vers le front face au premier)
    if (frontier.length) {
      const goals = strike ? [strike.from] : (() => {
        const facing = frontier.filter(i => map.terr[i].neighbors.some(n => T[n].owner === first));
        return focus && facing.length ? facing : frontier;
      })();
      const fd = new Array(T.length).fill(Infinity);
      const q = goals.slice();
      for (const f of goals) fd[f] = 0;
      for (let k = 0; k < q.length; k++) {
        for (const n of map.terr[q[k]].neighbors) if (T[n].owner === pi && fd[n] === Infinity) { fd[n] = fd[q[k]] + 1; q.push(n); }
      }
      for (const i of mine.slice().sort((x, y) => T[y].troops - T[x].troops)) {
        if (budget <= 0) break;
        if (fd[i] === 0 || fd[i] === Infinity || T[i].troops < 3) continue;
        // un territoire du front garde ses troupes s'il est menacé par un voisin
        if (frontier.includes(i) && map.terr[i].neighbors.some(n => T[n].owner >= 0 && T[n].owner !== pi && T[n].troops > T[i].troops)) continue;
        let best = -1;
        for (const n of map.terr[i].neighbors) if (T[n].owner === pi && fd[n] < fd[i]) { best = n; break; }
        if (best >= 0 && spare(i) >= 2) doAct({ type: 'send', from: i, to: best, n: spare(i) });
      }
    }
  }

  return { CFG, COLORS, TERRAIN, BUILDINGS, SIZES, MAP_LIST, territoryCount, buildCost, maxBuildings, countOf, terrIncome, zoneOwner, resolveOpts, generateMap, createGame, applyAction, step, incomeOf, defenseOf, travelTime, isSea, findPath, legPos, crossingPoint };
});
