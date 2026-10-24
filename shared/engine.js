// Moteur de jeu partagé : utilisé par le navigateur (solo) et le serveur (multi).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CFG = {
    MAP_W: 160,
    MAP_H: 100,
    TERRITORIES: 45,
    SOLDIER_COST: 5,
    CAPITAL_BONUS: 3,      // or/s en plus pour la capitale
    START_GOLD: 25,
    START_TROOPS: 12,
    DEF_BONUS: 1.2,        // multiplicateur des défenseurs
    ARMY_SPEED: 12,        // cases par seconde
    BOT_THINK: { easy: 2.6, normal: 1.6, hard: 0.9 },
  };

  const COLORS = ['#e6194b', '#3c7dd9', '#3cb44b', '#f58231', '#911eb4', '#16b5b5', '#d6c400', '#f032e6'];

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
    const W = opts.w || CFG.MAP_W, H = opts.h || CFG.MAP_H, N = opts.n || CFG.TERRITORIES;
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
    for (const { id, comp } of comps) if (comp !== bestComp[id]) for (const c of comp) cells[c] = -1;
    let pending = true;
    while (pending) {
      pending = false;
      const copy = cells.slice();
      for (let i = 0; i < W * H; i++) {
        if (copy[i] !== -1) continue;
        const x = i % W, y = (i / W) | 0;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
        let v = -1;
        for (const n of nb) if (n >= 0 && copy[n] !== -1) { v = copy[n]; break; }
        if (v === -1) pending = true; else cells[i] = v;
      }
    }

    // Réindexation (territoires vides éventuels supprimés)
    const remap = new Int16Array(T).fill(-1);
    let count = 0;
    for (let i = 0; i < W * H; i++) if (remap[cells[i]] === -1) remap[cells[i]] = count++;
    for (let i = 0; i < W * H; i++) cells[i] = remap[cells[i]];

    const used = new Set();
    const terr = [];
    for (let i = 0; i < count; i++) {
      terr.push({ id: i, name: makeName(r, used), size: 0, sx: 0, sy: 0, neighbors: new Set(), lx: 0, ly: 0, income: 1 + Math.floor(r() * 3) });
    }

    // Adjacence, segments de frontière, distance au bord
    const segments = []; // [x1,y1,x2,y2,a,b] (b = -1 pour le bord de la carte)
    const dist = new Int32Array(W * H).fill(-1);
    const queue = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, a = cells[i];
        const t = terr[a];
        t.size++; t.sx += x + 0.5; t.sy += y + 0.5;
        let border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
        if (x < W - 1) {
          const b = cells[i + 1];
          if (b !== a) { t.neighbors.add(b); terr[b].neighbors.add(a); segments.push([x + 1, y, x + 1, y + 1, a, b]); border = true; }
        }
        if (y < H - 1) {
          const b = cells[i + W];
          if (b !== a) { t.neighbors.add(b); terr[b].neighbors.add(a); segments.push([x, y + 1, x + 1, y + 1, a, b]); border = true; }
        }
        if (x > 0 && cells[i - 1] !== a) border = true;
        if (y > 0 && cells[i - W] !== a) border = true;
        if (border) { dist[i] = 0; queue.push(i); }
      }
    }
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k], x = c % W, y = (c / W) | 0;
      const nb = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
      for (const n of nb) if (n >= 0 && dist[n] === -1) { dist[n] = dist[c] + 1; queue.push(n); }
    }
    const bestD = new Array(count).fill(-1);
    for (let i = 0; i < W * H; i++) {
      const a = cells[i], t = terr[a];
      const cx = t.sx / t.size, cy = t.sy / t.size;
      const x = i % W + 0.5, y = ((i / W) | 0) + 0.5;
      const score = dist[i] * 4 - Math.hypot(x - cx, y - cy);
      if (bestD[a] === -1 || score > bestD[a]) { bestD[a] = score; t.lx = x; t.ly = y; }
    }

    for (const t of terr) {
      t.neighbors = Array.from(t.neighbors).sort((a, b) => a - b);
      delete t.sx; delete t.sy;
    }
    return { seed, w: W, h: H, cells, terr, segments };
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
  function createGame(map, players, seed) {
    const state = {
      time: 0, rng: seed | 0, incomeAcc: 0, nextArmy: 1, winner: null,
      territories: map.terr.map(() => ({ owner: -1, troops: 0 })),
      players: [], armies: [],
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
        gold: CFG.START_GOLD, alive: true, capital: caps[i], nextThink: 1 + srand(state),
      });
      state.territories[caps[i]].owner = i;
      state.territories[caps[i]].troops = CFG.START_TROOPS;
    });
    return state;
  }

  function incomeOf(state, map, pi) {
    let inc = 0;
    state.territories.forEach((t, i) => { if (t.owner === pi) inc += map.terr[i].income; });
    if (state.players[pi].capital != null && state.territories[state.players[pi].capital].owner === pi) inc += CFG.CAPITAL_BONUS;
    return inc;
  }

  function travelTime(map, a, b) {
    const A = map.terr[a], B = map.terr[b];
    return Math.hypot(A.lx - B.lx, A.ly - B.ly) / CFG.ARMY_SPEED + 0.3;
  }

  // Chemin le plus court de `from` vers `to` en ne traversant que des territoires du joueur.
  // Retourne la liste des étapes après `from` (la dernière est `to`), ou null.
  function findPath(state, map, pi, from, to) {
    if (from === to) return null;
    const prev = new Array(map.terr.length).fill(-1);
    prev[from] = from;
    const q = [from];
    for (let k = 0; k < q.length; k++) {
      const c = q[k];
      for (const n of map.terr[c].neighbors) {
        if (prev[n] !== -1) continue;
        prev[n] = c;
        if (n === to) {
          const path = [to];
          for (let x = c; x !== from; x = prev[x]) path.unshift(x);
          return path;
        }
        if (state.territories[n].owner === pi) q.push(n);
      }
    }
    return null;
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
      return true;
    }
    if (act.type === 'send') {
      const from = state.territories[act.from];
      if (!from || from.owner !== pi) return false;
      const path = findPath(state, map, pi, act.from, act.to);
      if (!path) return false;
      const n = Math.min(Math.floor(act.n) || 0, from.troops);
      if (n <= 0) return false;
      from.troops -= n;
      const first = path.shift();
      state.armies.push({ id: state.nextArmy++, owner: pi, from: act.from, to: first, path, n, t: 0, dur: travelTime(map, act.from, first) });
      return true;
    }
    return false;
  }

  function resolveArrival(state, a) {
    const t = state.territories[a.to];
    if (t.owner === a.owner) { t.troops += a.n; return; }
    const r = 0.85 + srand(state) * 0.3;
    const att = a.n * r, def = t.troops * CFG.DEF_BONUS;
    if (att > def) {
      const prev = t.owner;
      t.owner = a.owner;
      t.troops = Math.max(1, Math.round(att - def));
      if (prev >= 0 && state.players[prev].capital === a.to) state.players[prev].capital = null;
    } else {
      t.troops = Math.max(0, Math.round((def - att) / CFG.DEF_BONUS));
    }
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
    state.time += dt;
    state.incomeAcc += dt;
    while (state.incomeAcc >= 1) {
      state.incomeAcc -= 1;
      state.players.forEach((p, i) => { if (p.alive) p.gold += incomeOf(state, map, i); });
    }
    for (const a of state.armies) a.t += dt;
    armyClashes(state);
    const keep = [];
    for (const a of state.armies) {
      if (a.n <= 0) continue;
      if (a.t < a.dur) { keep.push(a); continue; }
      // Étape intermédiaire : on continue si le territoire nous appartient toujours
      if (a.path && a.path.length && state.territories[a.to].owner === a.owner) {
        a.from = a.to;
        a.to = a.path.shift();
        a.t = 0;
        a.dur = travelTime(map, a.from, a.to);
        keep.push(a);
      } else resolveArrival(state, a);
    }
    state.armies = keep;

    // Éliminations / victoire
    const has = new Array(state.players.length).fill(false);
    for (const t of state.territories) if (t.owner >= 0) has[t.owner] = true;
    for (const a of state.armies) has[a.owner] = true;
    state.players.forEach((p, i) => { if (p.alive && !has[i]) { p.alive = false; p.gold = 0; } });
    const alive = state.players.map((p, i) => (p.alive ? i : -1)).filter(i => i >= 0);
    if (alive.length === 1 && state.players.length > 1) state.winner = alive[0];
    else if (alive.length === 0) state.winner = -1;

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

    const incoming = {}; // troupes déjà envoyées par moi vers un territoire
    for (const a of state.armies) if (a.owner === pi) incoming[a.to] = (incoming[a.to] || 0) + a.n;

    // Joueur dominant : les bots normaux/difficiles le ciblent davantage
    const counts = new Array(state.players.length).fill(0);
    for (const t of T) if (t.owner >= 0) counts[t.owner]++;
    let leader = -1, lc = 0;
    counts.forEach((c, i) => { if (i !== pi && c > lc) { lc = c; leader = i; } });

    const frontier = [];
    const options = [];
    for (const i of mine) {
      const enemies = map.terr[i].neighbors.filter(n => T[n].owner !== pi);
      if (!enemies.length) continue;
      frontier.push(i);
      for (const n of enemies) {
        const def = T[n].troops;
        const need = Math.ceil(def * CFG.DEF_BONUS * margin) + 2 - (incoming[n] || 0);
        let score = map.terr[n].income * 3 - def * 0.25;
        if (T[n].owner === -1) score += 1;
        else if (T[n].owner === leader && level !== 'easy') score += 2;
        if (state.players[T[n].owner] && state.players[T[n].owner].capital === n) score += 3;
        options.push({ from: i, to: n, need, score });
      }
    }

    // 1. Attaques
    options.sort((a, b) => b.score - a.score);
    const used = new Set();
    let attacks = 0;
    const maxAttacks = level === 'hard' ? 3 : level === 'easy' ? 1 : 2;
    for (const o of options) {
      if (attacks >= maxAttacks) break;
      if (used.has(o.to) || o.need <= 0) continue;
      if (T[o.from].troops >= o.need) {
        applyAction(state, map, pi, { type: 'send', from: o.from, to: o.to, n: o.need });
        used.add(o.to);
        attacks++;
      }
    }

    // 2. Achats : compléter l'attaque la plus rentable, sinon défendre
    const affordable = Math.floor(p.gold / CFG.SOLDIER_COST);
    if (affordable > 0) {
      let target = null, bestVal = -Infinity;
      for (const o of options) {
        if (used.has(o.to)) continue;
        const deficit = o.need - T[o.from].troops;
        if (deficit <= 0 || deficit > affordable + 4) continue;
        const v = o.score - deficit * 0.3;
        if (v > bestVal) { bestVal = v; target = o; }
      }
      let threatT = -1, threat = 0;
      for (const i of frontier) {
        let enemy = 0;
        for (const n of map.terr[i].neighbors) if (T[n].owner >= 0 && T[n].owner !== pi) enemy = Math.max(enemy, T[n].troops);
        const th = enemy - T[i].troops * CFG.DEF_BONUS;
        if (th > threat) { threat = th; threatT = i; }
      }
      if (threatT >= 0 && (level !== 'easy') && threat > 3 && (!target || threat > 8)) {
        applyAction(state, map, pi, { type: 'buy', t: threatT, n: Math.min(affordable, Math.ceil(threat / CFG.DEF_BONUS) + 2) });
      } else if (target) {
        applyAction(state, map, pi, { type: 'buy', t: target.from, n: Math.min(affordable, target.need - T[target.from].troops) });
      } else if (frontier.length && affordable >= 3) {
        applyAction(state, map, pi, { type: 'buy', t: frontier[Math.floor(srand(state) * frontier.length)], n: affordable });
      }
    }

    // 3. Les territoires intérieurs envoient leurs troupes vers le front
    if (frontier.length) {
      const fd = new Array(T.length).fill(Infinity);
      const q = frontier.slice();
      for (const f of frontier) fd[f] = 0;
      for (let k = 0; k < q.length; k++) {
        for (const n of map.terr[q[k]].neighbors) if (T[n].owner === pi && fd[n] === Infinity) { fd[n] = fd[q[k]] + 1; q.push(n); }
      }
      for (const i of mine) {
        if (fd[i] === 0 || T[i].troops < 2) continue;
        let best = -1;
        for (const n of map.terr[i].neighbors) if (T[n].owner === pi && fd[n] < fd[i]) { best = n; break; }
        if (best >= 0) applyAction(state, map, pi, { type: 'send', from: i, to: best, n: T[i].troops });
      }
    }
  }

  return { CFG, COLORS, generateMap, createGame, applyAction, step, incomeOf, travelTime, findPath };
});
