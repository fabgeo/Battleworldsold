// Moteur de jeu partagé : utilisé par le navigateur (solo) et le serveur (multi).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./europe-map.js'));
  else root.Engine = factory(root.EUROPE_MAP);
})(typeof self !== 'undefined' ? self : this, function (EUROPE) {
  'use strict';

  const CFG = {
    SOLDIER_COST: 5,
    BASE_INCOME: 5,        // or/s pour chaque joueur, quoi qu'il possède
    CAPITAL_BONUS: 3,      // or/s en plus pour la capitale
    START_GOLD: 25,
    START_TROOPS: 12,
    DEF_BONUS: 1.2,        // multiplicateur de base des défenseurs
    ARMY_SPEED: 12,        // cases par seconde sur plaine
    FATIGUE: 0.05,         // perte par étape au-delà des étapes gratuites
    FREE_LEGS: 2,
    INCOME_EVERY: 4,       // secondes entre deux versements d'or (lent : laisse le temps de réfléchir)
    SEA_SLOW: 2,           // un passage maritime est 2 fois plus lent
    BARRACKS_EVERY: 3,     // secondes entre deux soldats produits par une caserne
    HISTORY_EVERY: 5,      // secondes entre deux points des statistiques
    BOT_THINK: { easy: 2.6, normal: 2.1, hard: 0.9 },
  };

  const TERRAIN = {
    plain: { name: 'Plaine', def: 1, speed: 1, income: 0 },
    forest: { name: 'Forêt', def: 1.25, speed: 0.7, income: 0 },
    mountain: { name: 'Montagne', def: 1.6, speed: 0.5, income: 0 },
    city: { name: 'Ville', def: 1.1, speed: 1, income: 2 },
  };

  const BUILDINGS = {
    fort: { name: 'Fort', cost: 35, desc: 'Défense ×1,5', letter: 'F' },
    mine: { name: 'Mine', cost: 25, desc: '+2 or par versement', letter: 'M' },
    barracks: { name: 'Caserne', cost: 45, desc: '+1 soldat / 3 s', letter: 'C' },
  };
  const BUILD_STEP = 0.35; // chaque bâtiment déjà construit par le joueur rend le suivant 35 % plus cher

  // Prix d'un bâtiment pour un joueur : bas pour les premiers, puis de plus en plus cher
  function buildCost(state, pi, kind) {
    const built = state.players[pi] ? state.players[pi].stats.built : 0;
    return Math.round(BUILDINGS[kind].cost * (1 + BUILD_STEP * built));
  }

  const SIZES = { small: 25, medium: 40, large: 60 }; // territoires de la carte aléatoire
  const COLORS = ['#e6194b', '#3c7dd9', '#3cb44b', '#f58231', '#911eb4', '#16b5b5', '#d6c400', '#f032e6'];

  // Réglages par défaut ("auto") complétés selon le nombre de joueurs
  function resolveOpts(opts, nPlayers) {
    opts = opts || {};
    const map = opts.map === 'europe' ? 'europe' : 'random';
    // Taille : petite / moyenne / grande, ou auto selon le nombre de joueurs
    const sizeKey = SIZES[opts.size] ? opts.size : nPlayers <= 3 ? 'small' : nPlayers <= 5 ? 'medium' : 'large';
    const size = SIZES[sizeKey];
    const speed = [0.75, 1, 1.5].includes(+opts.speed) ? +opts.speed : 1;
    const startGold = opts.startGold === 'auto' || opts.startGold == null || isNaN(+opts.startGold) ? CFG.START_GOLD : Math.max(0, Math.min(1000, +opts.startGold));
    return { map, sizeKey, size, speed, startGold, buildings: opts.buildings !== false };
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

  function generateMap(seed, opts) {
    opts = opts || {};
    if (opts.map === 'europe') return europeMap(seed, opts.sizeKey);
    const N = opts.size || 45;
    const H = Math.round(Math.sqrt(N * 355 / 1.6)), W = Math.round(H * 1.6);
    const r = mulberry(seed);

    // Germes espacés (échantillonnage par rejet)
    const minD = Math.sqrt((W * H) / N) * 0.75;
    const seeds = [];
    let tries = 0;
    while (seeds.length < N && tries < 20000) {
      tries++;
      const x = 2 + r() * (W - 4), y = 2 + r() * (H - 4);
      let ok = true;
      for (const s of seeds) if ((s.x - x) ** 2 + (s.y - y) ** 2 < minD * minD) { ok = false; break; }
      if (ok) seeds.push({ x, y });
    }

    // Voronoï avec déformation du domaine pour des frontières organiques
    const nx1 = valueNoise(r, W, H, 14), ny1 = valueNoise(r, W, H, 14);
    const nx2 = valueNoise(r, W, H, 5), ny2 = valueNoise(r, W, H, 5);
    const cells = new Int16Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const wx = x + nx1(x, y) * 6 + nx2(x, y) * 2;
        const wy = y + ny1(x, y) * 6 + ny2(x, y) * 2;
        let best = 0, bd = Infinity;
        for (let i = 0; i < seeds.length; i++) {
          const d = (seeds[i].x - wx) ** 2 + (seeds[i].y - wy) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        cells[y * W + x] = best;
      }
    }

    // Nettoyage : chaque territoire garde uniquement sa plus grande composante
    const T = seeds.length;
    const seen = new Uint8Array(W * H);
    const bestComp = new Array(T).fill(null);
    const comps = [];
    for (let i = 0; i < W * H; i++) {
      if (seen[i]) continue;
      const id = cells[i], comp = [i];
      seen[i] = 1;
      for (let k = 0; k < comp.length; k++) {
        const c = comp[k], x = c % W, y = (c / W) | 0;
        const nb = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
        for (const n of nb) if (n >= 0 && !seen[n] && cells[n] === id) { seen[n] = 1; comp.push(n); }
      }
      comps.push({ id, comp });
      if (!bestComp[id] || bestComp[id].length < comp.length) bestComp[id] = comp;
    }
    for (const { id, comp } of comps) if (comp !== bestComp[id]) for (const c of comp) cells[c] = -2;
    let pending = true;
    while (pending) {
      pending = false;
      const copy = cells.slice();
      for (let i = 0; i < W * H; i++) {
        if (copy[i] !== -2) continue;
        const x = i % W, y = (i / W) | 0;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
        let v = -2;
        for (const n of nb) if (n >= 0 && copy[n] !== -2) { v = copy[n]; break; }
        if (v === -2) pending = true; else cells[i] = v;
      }
    }

    // Réindexation (territoires vides éventuels supprimés)
    const remap = new Int16Array(T).fill(-1);
    let count = 0;
    for (let i = 0; i < W * H; i++) if (remap[cells[i]] === -1) remap[cells[i]] = count++;
    for (let i = 0; i < W * H; i++) cells[i] = remap[cells[i]];

    const used = new Set();
    const defs = [];
    for (let i = 0; i < count; i++) {
      const v = r();
      const terrain = v < 0.5 ? 'plain' : v < 0.75 ? 'forest' : v < 0.9 ? 'mountain' : 'city';
      defs.push({ name: makeName(r, used), income: 1 + Math.floor(r() * 3), terrain });
    }
    return buildMap(seed, W, H, cells, defs, []);
  }

  function europeMap(seed, sizeKey) {
    const d = EUROPE[sizeKey] || EUROPE.large;
    const cells = new Int16Array(d.w * d.h);
    let p = 0;
    for (let i = 0; i < d.rle.length; i += 2) { cells.fill(d.rle[i], p, p + d.rle[i + 1]); p += d.rle[i + 1]; }
    return buildMap(seed, d.w, d.h, cells, d.regions.map(r => ({ name: r.name, income: r.income, terrain: r.terrain, country: r.country })), d.seaLinks);
  }

  // Construit la carte à partir d'une grille (-1 = mer) et de la liste des territoires
  function buildMap(seed, W, H, cells, defs, seaLinks) {
    const count = defs.length;
    const terr = defs.map((d, i) => ({ id: i, name: d.name, country: d.country, income: d.income, terrain: d.terrain, size: 0, sx: 0, sy: 0, neighbors: new Set(), sea: [], lx: 0, ly: 0 }));

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
    return { seed, w: W, h: H, cells, terr, segments, crossing, seaLinks };
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
  function createGame(map, players, seed, opts) {
    opts = resolveOpts(opts, players.length);
    const state = {
      time: 0, rng: seed | 0, incomeAcc: 0, sec: 0, nextArmy: 1, winner: null, opts,
      territories: map.terr.map(() => ({ owner: -1, troops: 0, buildings: [] })),
      players: [], armies: [], history: [], bigBattle: null,
    };
    for (let i = 0; i < map.terr.length; i++) {
      state.territories[i].troops = 2 + map.terr[i].income * 2 + Math.floor(srand(state) * 4);
    }
    // Capitales le plus éloignées possible les unes des autres
    const caps = [];
    const dists = [];
    for (let i = 0; i < players.length; i++) {
      let pick;
      if (i === 0) pick = Math.floor(srand(state) * map.terr.length);
      else {
        let best = -1, bs = -1;
        for (let t = 0; t < map.terr.length; t++) {
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
        stats: { bought: 0, captures: 0, lost: 0, peakTerr: 1, capitals: 0, built: 0 },
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
      inc += map.terr[i].income + TERRAIN[map.terr[i].terrain].income;
      if (t.buildings.includes('mine')) inc += 2;
    });
    if (state.players[pi].capital != null && state.territories[state.players[pi].capital].owner === pi) inc += CFG.CAPITAL_BONUS;
    return inc;
  }

  // Multiplicateur de défense d'un territoire (terrain + fort)
  function defenseOf(state, map, i) {
    return CFG.DEF_BONUS * TERRAIN[map.terr[i].terrain].def * (state.territories[i].buildings.includes('fort') ? 1.5 : 1);
  }

  function crossingPoint(map, a, b) {
    return map.crossing[a < b ? a + '-' + b : b + '-' + a];
  }

  function isSea(map, a, b) {
    return map.terr[a].sea.includes(b);
  }

  // Durée d'une étape : moitié du trajet au rythme du terrain de départ, moitié au rythme de l'arrivée,
  // et 2 fois plus lent par la mer
  function travelTime(map, a, b) {
    const A = map.terr[a], B = map.terr[b], P = crossingPoint(map, a, b);
    const d1 = Math.hypot(A.lx - P[0], A.ly - P[1]), d2 = Math.hypot(P[0] - B.lx, P[1] - B.ly);
    const t = (d1 / TERRAIN[A.terrain].speed + d2 / TERRAIN[B.terrain].speed) / CFG.ARMY_SPEED;
    return t * (isSea(map, a, b) ? CFG.SEA_SLOW : 1) + 0.3;
  }

  // Position (en cases) d'une armée sur le trajet a -> frontière -> b, k entre 0 et 1 (temps écoulé)
  function legPos(map, a, b, k) {
    const A = map.terr[a], B = map.terr[b], P = crossingPoint(map, a, b);
    const d1 = Math.hypot(A.lx - P[0], A.ly - P[1]), d2 = Math.hypot(P[0] - B.lx, P[1] - B.ly);
    const t1 = d1 / TERRAIN[A.terrain].speed, t2 = d2 / TERRAIN[B.terrain].speed;
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
        let c = travelTime(map, u, v);
        const tv = state.territories[v];
        if (v !== to && tv.owner !== pi) c += 4 + tv.troops * defenseOf(state, map, v) * 0.5;
        if (cost[u] + c < cost[v]) { cost[v] = cost[u] + c; prev[v] = u; }
      }
    }
    const path = [];
    for (let x = to; x !== from; x = prev[x]) path.unshift(x);
    return path;
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
      // plusieurs bâtiments par territoire, mais un seul de chaque type
      if (!state.opts.buildings || !t || !b || t.owner !== pi || t.buildings.includes(act.kind)) return false;
      const cost = buildCost(state, pi, act.kind);
      if (p.gold < cost) return false;
      p.gold -= cost;
      t.buildings.push(act.kind);
      p.stats.built++;
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
      state.armies.push({ id: state.nextArmy++, owner: pi, from: act.from, to: first, path, n, t: 0, dur: travelTime(map, act.from, first), legs: 1 });
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
      t.troops = Math.max(1, Math.round(att - def));
      const me = state.players[a.owner];
      me.stats.captures++;
      if (prev >= 0) {
        const pp = state.players[prev];
        pp.stats.lost++;
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
      if (state.sec % CFG.BARRACKS_EVERY === 0) for (const t of state.territories) if (t.owner >= 0 && t.buildings.includes('barracks')) t.troops++;
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
      a.dur = travelTime(map, a.from, a.to);
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
      if (p.alive && !has[i]) { p.alive = false; p.gold = 0; p.stats.outAt = Math.round(state.time); }
    });
    const alive = state.players.map((p, i) => (p.alive ? i : -1)).filter(i => i >= 0);
    if (alive.length <= 1 && state.players.length > 1) {
      state.winner = alive.length ? alive[0] : -1;
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
    const mine = [];
    T.forEach((t, i) => { if (t.owner === pi) mine.push(i); });
    if (!mine.length) return;
    if (!p.atk) p.atk = { lead: 0, other: 0 }; // compteur d'attaques contre le premier / contre les autres joueurs

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
    const nearlyOut = (o) => counts[o] <= 2 && neutralsLeft < T.length * 0.3;

    const launch = (from, to, n) => {
      const owner = T[to].owner;
      if (!applyAction(state, map, pi, { type: 'send', from, to, n })) return false;
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
        need += Math.ceil(T[v].troops * defenseOf(state, map, v) * margin) + (k < path.length - 1 ? 1 : 0);
      });
      need = Math.ceil(need * Math.pow(1 + CFG.FATIGUE, Math.max(0, path.length - CFG.FREE_LEGS)));
      return { path, need: need - (incoming[to] || 0) };
    };

    const frontier = mine.filter(i => map.terr[i].neighbors.some(n => T[n].owner !== pi));
    const used = new Set();
    let attacks = 0;
    const maxAttacks = level === 'hard' ? 3 : level === 'easy' ? 1 : 2;
    let strike = null; // frappe sur le premier en préparation (on accumule des troupes à `from`)

    // 1. Frappes sur le premier (bots normaux et difficiles qui ne sont pas premiers)
    if (focus) {
      // distance (en étapes) de chaque territoire à mon empire
      const dist = new Array(T.length).fill(Infinity), q = [];
      for (const i of mine) { dist[i] = 0; q.push(i); }
      for (let k = 0; k < q.length; k++) for (const n of map.terr[q[k]].neighbors) if (dist[n] === Infinity) { dist[n] = dist[q[k]] + 1; q.push(n); }
      const targets = T.map((t, i) => i).filter(i => T[i].owner === first && dist[i] <= 6)
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
        let score = -c.need - dt[src] * 3 + map.terr[tg].income * 2;
        if (state.players[first].capital === tg) score += 15 + state.players[first].gold / 50;
        cands.push({ from: src, to: tg, need: c.need, score });
      }
      cands.sort((x, y) => y.score - x.score);
      for (const c of cands) {
        if (attacks >= maxAttacks) break;
        if (used.has(c.to)) continue;
        if (T[c.from].troops - 1 >= c.need && launch(c.from, c.to, c.need)) { used.add(c.to); attacks++; }
      }
      if (!attacks && cands.length) strike = cands.reduce((best, c) => (c.need - T[c.from].troops < best.need - T[best.from].troops ? c : best));
    }

    // 2. Autres attaques sur les voisins (neutres, autres joueurs) — en respectant le quota sur le premier
    const power = state.players.map((q, i) => counts[i] + troops[i] / 15 + (q.alive ? q.gold / 60 : 0));
    const options = [];
    for (const i of frontier) {
      if (strike && i === strike.from) continue; // on ne dégarnit pas la base de la frappe
      for (const n of map.terr[i].neighbors) {
        if (T[n].owner === pi) continue;
        const def = T[n].troops, o = T[n].owner;
        const need = Math.ceil(def * defenseOf(state, map, n) * margin) + 2 - (incoming[n] || 0);
        let score = map.terr[n].income * 3 + TERRAIN[map.terr[n].terrain].income * 2 - def * 0.25;
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
      if (T[o.from].troops - 1 >= o.need && launch(o.from, o.to, o.need)) { used.add(o.to); attacks++; }
    }

    // 3. Bâtiments : une mine à l'arrière quand on est riche, un fort sur la capitale menacée
    if (state.opts.buildings && level !== 'easy' && p.gold > buildCost(state, pi, 'mine') + 80 && srand(state) < 0.35) {
      const kind = srand(state) < 0.7 ? 'mine' : 'barracks';
      const interior = mine.filter(i => !T[i].buildings.includes(kind) && !frontier.includes(i));
      if (p.capital != null && T[p.capital].owner === pi && !T[p.capital].buildings.includes('fort') && frontier.includes(p.capital)) {
        applyAction(state, map, pi, { type: 'build', t: p.capital, kind: 'fort' });
      } else if (interior.length) {
        applyAction(state, map, pi, { type: 'build', t: interior[Math.floor(srand(state) * interior.length)], kind });
      }
    }

    // 4. Achats : défense si menace grave, sinon préparer la frappe sur le premier, sinon l'attaque la plus rentable
    const affordable = Math.floor(p.gold / CFG.SOLDIER_COST);
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
        applyAction(state, map, pi, { type: 'buy', t: threatT, n: Math.min(affordable, Math.ceil(threat / defenseOf(state, map, threatT)) + 2) });
      } else if (strike) {
        applyAction(state, map, pi, { type: 'buy', t: strike.from, n: affordable });
      } else if (target) {
        applyAction(state, map, pi, { type: 'buy', t: target.from, n: Math.min(affordable, target.need - (T[target.from].troops - 1)) });
      } else if (frontier.length && affordable >= 3) {
        applyAction(state, map, pi, { type: 'buy', t: frontier[Math.floor(srand(state) * frontier.length)], n: affordable });
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
      for (const i of mine) {
        if (fd[i] === 0 || fd[i] === Infinity || T[i].troops < 3) continue;
        // un territoire du front garde ses troupes s'il est menacé par un voisin
        if (frontier.includes(i) && map.terr[i].neighbors.some(n => T[n].owner >= 0 && T[n].owner !== pi && T[n].troops > T[i].troops)) continue;
        let best = -1;
        for (const n of map.terr[i].neighbors) if (T[n].owner === pi && fd[n] < fd[i]) { best = n; break; }
        if (best >= 0) applyAction(state, map, pi, { type: 'send', from: i, to: best, n: T[i].troops - 1 });
      }
    }
  }

  return { CFG, COLORS, TERRAIN, BUILDINGS, SIZES, buildCost, resolveOpts, generateMap, createGame, applyAction, step, incomeOf, defenseOf, travelTime, isSea, findPath, legPos, crossingPoint };
});
