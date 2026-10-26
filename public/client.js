(function () {
  'use strict';
  const E = window.Engine;
  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  const G = {
    mode: null,          // 'solo' | 'multi'
    map: null, state: null, me: -1,
    session: null,       // { code, id, token }
    es: null,
    selected: -1, hover: -1, pct: 0.5,
    paused: false, buildOpen: false,
    lastStateAt: 0,
    base: null, baseKey: '', paths: null,
    view: { zoom: 1, cx: 0, cy: 0 },
    drag: null, pinch: null,
    overDismissed: false, overShown: false, finalShown: false,
    lastSolo: null,
  };
  window.BW = G; // pratique pour déboguer depuis la console
  if (window.BW_VERSION) { const cr = document.querySelector('.credits'); if (cr) cr.textContent += ' — version ' + window.BW_VERSION; }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  // ---------- Écrans ----------
  function show(id) {
    for (const s of ['menu', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id);
  }
  const playerName = () => ($('name').value.trim() || 'Joueur').slice(0, 16);
  $('name').value = store.get('bw-name') || '';
  $('name').addEventListener('change', () => store.set('bw-name', $('name').value));
  const joinParam = new URLSearchParams(location.search).get('join');
  if (joinParam) $('joinCode').value = joinParam.toUpperCase();

  // ---------- Réglages ----------
  const OPT_IDS = { map: 'optMap', size: 'optSize', speed: 'optSpeed', startGold: 'optGold', buildings: 'optBuild' };
  const OPT_DEFAULT = { map: 'random', size: 'auto', speed: '1', startGold: 'auto', buildings: 'on' };
  function loadOpts() {
    let saved = {};
    try { saved = JSON.parse(store.get('bw-opts') || '{}') || {}; } catch (e) {}
    for (const k in OPT_IDS) $(OPT_IDS[k]).value = saved[k] != null ? saved[k] : OPT_DEFAULT[k];
    for (const k in OPT_IDS) if (!$(OPT_IDS[k]).value) $(OPT_IDS[k]).value = OPT_DEFAULT[k];
    syncOpts();
  }
  function readOpts() {
    const o = {};
    for (const k in OPT_IDS) o[k] = $(OPT_IDS[k]).value;
    return o;
  }
  function optsForEngine() {
    const o = readOpts();
    return { map: o.map, size: o.size, speed: +o.speed, startGold: o.startGold, buildings: o.buildings === 'on' };
  }
  // Nombre de territoires selon la carte et la taille
  const territoryCount = (map, sizeKey) => E.territoryCount(map, sizeKey);
  // Liste des cartes dans le menu (générée depuis le moteur)
  $('optMap').innerHTML = E.MAP_LIST.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  function describeOpts(o) {
    const found = E.MAP_LIST.find(m => m.id === o.map);
    const parts = [!found || found.id === 'random' ? 'Carte aléatoire' : found.name];
    parts.push(o.size && o.size !== 'auto' ? { small: 'petite', medium: 'moyenne', large: 'grande' }[o.size] : 'taille auto');
    if (o.speed != null && +o.speed !== 1) parts.push(+o.speed < 1 ? 'lente' : 'rapide');
    if (o.startGold != null && o.startGold !== 'auto') parts.push(o.startGold + ' or au départ');
    if (o.buildings === false || o.buildings === 'off') parts.push('sans bâtiments');
    return parts.join(' · ');
  }
  function syncOpts() {
    const o = readOpts();
    const players = 1 + (+$('botCount').value || 3);
    const key = o.size === 'auto' ? E.resolveOpts({ size: 'auto' }, players).sizeKey : o.size;
    $('sizeHint').textContent = `${territoryCount(o.map, key)} territoires` + (o.size === 'auto' ? ` (auto pour ${players} joueurs)` : '');
    const extra = [];
    if (+o.speed !== 1) extra.push(+o.speed < 1 ? 'lente' : 'rapide');
    if (o.startGold !== 'auto') extra.push(o.startGold + ' or');
    if (o.buildings === 'off') extra.push('sans bâtiments');
    $('settingsSummary').textContent = extra.join(' · ');
    store.set('bw-opts', JSON.stringify(readOpts()));
  }
  for (const k in OPT_IDS) $(OPT_IDS[k]).addEventListener('change', syncOpts);
  $('botCount').addEventListener('change', syncOpts);
  $('btnResetOpts').onclick = () => { for (const k in OPT_IDS) $(OPT_IDS[k]).value = OPT_DEFAULT[k]; syncOpts(); };
  loadOpts();

  // ---------- Solo ----------
  $('btnSolo').onclick = () => startSolo(+$('botCount').value, $('botLevel').value, optsForEngine());
  function startSolo(n, level, opts) {
    G.lastSolo = { n, level, opts };
    const players = [{ id: 'me', name: playerName(), bot: false }];
    for (let i = 1; i <= n; i++) players.push({ id: 'bot' + i, name: 'Bot ' + i, bot: level });
    const seed = Math.floor(Math.random() * 2 ** 31);
    const resolved = E.resolveOpts(opts, players.length);
    G.mode = 'solo';
    setupGame(seed, resolved);
    G.me = 0;
    // Le joueur choisit son territoire de départ : on affiche la carte neutre, la partie commence au premier clic
    G.state = E.createGame(G.map, players, seed ^ 0x5bd1e995, resolved);
    G.state.territories.forEach(t => { t.owner = -1; });
    G.state.players.forEach(pl => { pl.capital = null; });
    G.state.capitals = [];
    G.choosing = { players, seed: seed ^ 0x5bd1e995, opts: resolved };
    $('chooseBanner').classList.remove('hidden');
  }
  function chooseStart(t) {
    const c = G.choosing;
    G.choosing = null;
    $('chooseBanner').classList.add('hidden');
    G.state = E.createGame(G.map, c.players, c.seed, c.opts, t);
    G.selected = -1;
  }
  $('btnRandomStart').onclick = () => { if (G.choosing) chooseStart(-1); };

  // ---------- Multi ----------
  async function post(route, body) {
    let r;
    try { r = await fetch('/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) { throw new Error('Serveur injoignable : le multijoueur nécessite le serveur (npm start).'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Erreur');
    return data;
  }
  function withSession(body) { return Object.assign({ code: G.session.code, token: G.session.token }, body); }

  $('btnCreate').onclick = async () => {
    try { enterLobby(await post('create', { name: playerName(), opts: optsForEngine() })); }
    catch (e) { $('menuError').textContent = e.message; }
  };
  $('btnJoin').onclick = async () => {
    try { enterLobby(await post('join', { name: playerName(), code: $('joinCode').value.trim().toUpperCase() })); }
    catch (e) { $('menuError').textContent = e.message; }
  };
  $('btnAddBot').onclick = () => post('addbot', withSession({ level: $('lobbyBotLevel').value })).catch(e => $('lobbyError').textContent = e.message);
  $('btnStart').onclick = () => post('start', withSession({})).catch(e => $('lobbyError').textContent = e.message);

  function enterLobby(sess) {
    G.mode = 'multi';
    G.session = sess;
    show('lobby');
    $('lobbyCode').textContent = sess.code;
    const es = new EventSource(`/api/events?code=${sess.code}&token=${sess.token}`);
    G.es = es;
    es.addEventListener('lobby', (ev) => renderLobby(JSON.parse(ev.data)));
    es.addEventListener('start', (ev) => {
      const d = JSON.parse(ev.data);
      if (G.map && G.map.seed === d.seed) return;
      setupGame(d.seed, d.opts);
      G.me = d.players.findIndex(p => p.id === G.session.id);
    });
    es.addEventListener('state', (ev) => { G.state = JSON.parse(ev.data); G.lastStateAt = performance.now(); });
  }

  function renderLobby(info) {
    const isHost = info.host === G.session.id;
    $('hostControls').classList.toggle('hidden', !isHost);
    $('lobbyWait').classList.toggle('hidden', isHost);
    $('lobbyOpts').textContent = 'Réglages : ' + describeOpts(info.opts || {});
    const ul = $('lobbyPlayers');
    ul.innerHTML = '';
    info.players.forEach((p, i) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = E.COLORS[i % E.COLORS.length];
      li.appendChild(dot);
      const label = { easy: 'facile', normal: 'normal', hard: 'difficile' }[p.bot];
      li.appendChild(document.createTextNode(p.name + (p.bot ? ` (bot ${label})` : '') + (p.id === info.host ? ' 👑' : '') + (p.id === G.session.id ? ' (toi)' : '')));
      if (isHost && p.id !== info.host) {
        const b = document.createElement('button');
        b.textContent = 'Retirer';
        b.onclick = () => post('kick', withSession({ id: p.id }));
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
  }

  function act(action) {
    if (!G.state || G.state.winner != null || G.paused || G.choosing) return;
    if (G.mode === 'solo') E.applyAction(G.state, G.map, G.me, action);
    else post('action', withSession({ action })).catch(() => {});
  }

  // ---------- Préparation de la partie ----------
  function setupGame(seed, opts) {
    G.choosing = null;
    G.autoPick = -1;
    $('toasts').innerHTML = '';
    $('chooseBanner').classList.add('hidden');
    G.map = E.generateMap(seed, opts);
    G.selected = -1; G.hover = -1; G.baseKey = ''; G.overDismissed = false; G.overShown = false; G.finalShown = false;
    G.paused = false; setBuildOpen(false);
    G.view = { zoom: 1, cx: G.map.w / 2, cy: G.map.h / 2 };
    buildPaths();
    $('overlay').classList.add('hidden');
    $('pauseOverlay').classList.add('hidden');
    $('btnRestart').classList.toggle('hidden', G.mode !== 'solo');
    $('btnPause').classList.toggle('hidden', G.mode !== 'solo');
    $('btnBuild').classList.toggle('hidden', !opts.buildings);
    show('game');
    if (G.immersive) setImmersive(true); // redemande le plein écran du navigateur (possible si lancé par un clic)
    resize();
  }

  // Path2D par territoire : remplissage (par lignes) et contour
  function buildPaths() {
    const m = G.map;
    G.paths = m.terr.map(() => ({ fill: new Path2D(), outline: new Path2D() }));
    for (let y = 0; y < m.h; y++) {
      let x = 0;
      while (x < m.w) {
        const id = m.cells[y * m.w + x];
        let x2 = x;
        while (x2 < m.w && m.cells[y * m.w + x2] === id) x2++;
        if (id >= 0) G.paths[id].fill.rect(x, y, x2 - x, 1);
        x = x2;
      }
    }
    for (const [x1, y1, x2, y2, a, b] of m.segments) {
      G.paths[a].outline.moveTo(x1, y1); G.paths[a].outline.lineTo(x2, y2);
      if (b >= 0) { G.paths[b].outline.moveTo(x1, y1); G.paths[b].outline.lineTo(x2, y2); }
    }
    // Bords de la carte
    const edge = (id, x1, y1, x2, y2) => { if (id >= 0) { G.paths[id].outline.moveTo(x1, y1); G.paths[id].outline.lineTo(x2, y2); } };
    for (let x = 0; x < m.w; x++) { edge(m.cells[x], x, 0, x + 1, 0); edge(m.cells[(m.h - 1) * m.w + x], x, m.h, x + 1, m.h); }
    for (let y = 0; y < m.h; y++) { edge(m.cells[y * m.w], 0, y, 0, y + 1); edge(m.cells[y * m.w + m.w - 1], m.w, y, m.w, y + 1); }
  }

  const NEUTRAL = { plain: [196, 184, 150], forest: [150, 165, 120], mountain: [168, 156, 140], city: [196, 176, 168] };
  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function terrColor(i, owner) {
    const v = ((i * 2654435761) >>> 0) % 1000 / 1000 * 0.12 - 0.06; // légère variation par territoire
    const c = owner >= 0 ? hexRgb(G.state.players[owner].color).map(x => x * 0.78 + 255 * 0.22) : NEUTRAL[G.map.terr[i].terrain];
    return c.map(x => Math.max(0, Math.min(255, Math.round(x * (1 + v)))));
  }

  // Petits motifs de terrain (arbres, montagnes, maisons) dessinés sur le fond
  function drawTerrainGlyphs(b) {
    const m = G.map, step = 6;
    for (let y = 2; y < m.h - 1; y += step) {
      for (let x = 2 + ((y / step) % 2) * 3; x < m.w - 1; x += step) {
        const i = y * m.w + x, id = m.cells[i];
        if (id < 0) continue;
        const ter = m.terr[id].terrain;
        if (ter === 'plain') continue;
        if (m.cells[i - 1] !== id || m.cells[i + 1] !== id || m.cells[i - m.w] !== id || m.cells[i + m.w] !== id) continue;
        if (Math.hypot(x + 0.5 - m.terr[id].lx, y + 0.5 - m.terr[id].ly) < 4) continue; // pas sous l'étiquette
        const px = (x + 0.5) * S, py = (y + 0.5) * S;
        b.beginPath();
        if (ter === 'forest') {
          b.fillStyle = 'rgba(25,60,25,0.38)';
          b.moveTo(px, py - 6); b.lineTo(px + 5, py + 4); b.lineTo(px - 5, py + 4); b.closePath(); b.fill();
        } else if (ter === 'mountain') {
          b.strokeStyle = 'rgba(55,40,25,0.5)'; b.lineWidth = 1.6;
          b.moveTo(px - 7, py + 4); b.lineTo(px - 2, py - 4); b.lineTo(px + 2, py + 1); b.lineTo(px + 4, py - 2); b.lineTo(px + 8, py + 4); b.stroke();
        } else if (ter === 'city') {
          b.fillStyle = 'rgba(50,45,60,0.4)';
          b.fillRect(px - 5, py - 2, 4, 6); b.fillRect(px, py - 5, 4, 9); b.fillRect(px + 5, py, 3, 4);
        }
      }
    }
  }

  // Image de fond redessinée seulement quand les propriétaires changent
  const S = 8;
  const SEA = [44, 74, 107], FOREIGN = [92, 96, 100]; // mer, terre hors jeu (pays voisins)
  function rebuildBase() {
    const m = G.map, st = G.state;
    const key = st.territories.map(t => t.owner).join(',');
    if (key === G.baseKey) return;
    G.baseKey = key;
    const small = document.createElement('canvas');
    small.width = m.w; small.height = m.h;
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(m.w, m.h);
    const cols = m.terr.map((_, i) => terrColor(i, st.territories[i].owner));
    for (let i = 0; i < m.w * m.h; i++) {
      const c = m.cells[i] >= 0 ? cols[m.cells[i]] : m.cells[i] === -2 ? FOREIGN : SEA;
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    if (!G.base) G.base = document.createElement('canvas');
    G.base.width = m.w * S; G.base.height = m.h * S;
    const b = G.base.getContext('2d');
    b.imageSmoothingEnabled = false;
    b.drawImage(small, 0, 0, m.w * S, m.h * S);
    drawTerrainGlyphs(b);
    // Frontières : fines entre territoires, épaisses entre propriétaires, côtes
    const thin = new Path2D(), thick = new Path2D(), coast = new Path2D();
    for (const [x1, y1, x2, y2, a, c] of m.segments) {
      const p = c < 0 ? coast : st.territories[a].owner !== st.territories[c].owner ? thick : thin;
      p.moveTo(x1 * S, y1 * S); p.lineTo(x2 * S, y2 * S);
    }
    b.lineCap = 'round';
    b.strokeStyle = 'rgba(40,30,20,0.35)'; b.lineWidth = 1.2; b.stroke(thin);
    b.strokeStyle = 'rgba(15,30,50,0.8)'; b.lineWidth = 2; b.stroke(coast);
    b.strokeStyle = 'rgba(25,20,15,0.85)'; b.lineWidth = 3; b.stroke(thick);
    // Zones riches : contour doré en pointillés
    if (st.rich) {
      const rich = new Path2D();
      for (const [x1, y1, x2, y2, a, c] of m.segments) if (!!st.rich[a] !== (c >= 0 && !!st.rich[c])) { rich.moveTo(x1 * S, y1 * S); rich.lineTo(x2 * S, y2 * S); }
      b.setLineDash([7, 5]); b.strokeStyle = '#ffd84a'; b.lineWidth = 3; b.stroke(rich); b.setLineDash([]);
    }
    // Passages maritimes
    b.strokeStyle = 'rgba(220,235,255,0.55)'; b.lineWidth = 2; b.setLineDash([6, 6]);
    for (const [a, c] of m.seaLinks) {
      const P = E.crossingPoint(m, a, c);
      b.beginPath(); b.moveTo(m.terr[a].lx * S, m.terr[a].ly * S); b.lineTo(P[0] * S, P[1] * S); b.lineTo(m.terr[c].lx * S, m.terr[c].ly * S); b.stroke();
    }
    b.setLineDash([]);
    b.strokeStyle = 'rgba(25,20,15,0.9)'; b.lineWidth = 4; b.strokeRect(0, 0, m.w * S, m.h * S);
  }

  // ---------- Vue ----------
  let DPR = 1;
  // Marges (px CSS) laissées libres par les barres autour de la carte
  let inset = { t: 50, b: 84, l: 0, r: 0 };
  function measureInsets() {
    if (!G.immersive) { inset = { t: $('topbar').offsetHeight || 50, b: $('bottombar').offsetHeight || 84, l: 0, r: 0 }; return; }
    const bb = $('bottombar').getBoundingClientRect();
    // horizontal : boutons en colonne à gauche, achat/envoi en colonne à droite
    if (bb.height > bb.width) inset = { t: 0, b: 0, l: document.querySelector('.tb-actions').getBoundingClientRect().right + 4, r: window.innerWidth - bb.left };
    else inset = { t: 40, b: window.innerHeight - bb.top, l: 0, r: 0 };
  }
  function resize() {
    DPR = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * DPR);
    canvas.height = Math.round(canvas.clientHeight * DPR);
    measureInsets();
  }
  window.addEventListener('resize', resize);
  // Sur téléphone (surtout iPhone en mode « écran d'accueil »), l'événement de rotation arrive parfois
  // avant que la page ait sa nouvelle taille : on remesure aussi un peu après.
  const resizeSoon = () => { resize(); setTimeout(resize, 150); setTimeout(resize, 500); };
  window.addEventListener('orientationchange', resizeSoon);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeSoon);

  function viewScale() {
    const m = G.map;
    const w = canvas.width - (inset.l + inset.r) * DPR, h = canvas.height - (inset.t + inset.b + 6) * DPR;
    const fit = Math.min(w / (m.w + 2), h / (m.h + 2));
    return Math.max(fit, 1) * G.view.zoom;
  }
  function center() {
    return [(inset.l * DPR + canvas.width - inset.r * DPR) / 2, (inset.t * DPR + canvas.height - inset.b * DPR) / 2];
  }
  function toScreen(x, y) {
    const s = viewScale(), [cx, cy] = center();
    return [cx + (x - G.view.cx) * s, cy + (y - G.view.cy) * s];
  }
  function toMap(sx, sy) {
    const s = viewScale(), [cx, cy] = center();
    return [(sx * DPR - cx) / s + G.view.cx, (sy * DPR - cy) / s + G.view.cy];
  }

  // Plein écran : vrai plein écran du navigateur quand il est disponible + disposition immersive
  function setImmersive(on) {
    G.immersive = on;
    $('game').classList.toggle('immersive', on);
    $('btnFull').querySelector('.ico').textContent = on ? '⤡' : '⤢';
    $('btnFull').querySelector('.lbl').textContent = on ? 'Quitter le plein écran' : 'Plein écran';
    store.set('bw-immersive', on ? '1' : '');
    const el = document.documentElement;
    try {
      if (on && !document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } catch (e) {}
    requestAnimationFrame(resize);
  }
  $('btnFull').onclick = () => setImmersive(!G.immersive);
  G.immersive = store.get('bw-immersive') === '1';
  $('game').classList.toggle('immersive', G.immersive);
  document.addEventListener('fullscreenchange', () => requestAnimationFrame(resize));
  // Au doigt, les petits territoires sont durs à viser : on prend le rond de troupes le plus proche (rayon 28 px)
  // (le territoire sous le doigt reste prioritaire : sa distance compte pour moitié)
  function terrAtTouch(sx, sy) {
    const under = terrAt(sx, sy);
    let best = under, bd = Infinity;
    G.map.terr.forEach((T, i) => {
      const [x, y] = toScreen(T.lx, T.ly);
      let d = Math.hypot(x / DPR - sx, y / DPR - sy);
      if (i === under) d *= 0.5;
      if (d <= 28 && d < bd) { bd = d; best = i; }
    });
    return best;
  }
  const pick = (e) => (e.pointerType === 'touch' ? terrAtTouch(e.offsetX, e.offsetY) : terrAt(e.offsetX, e.offsetY));
  G.debug = { toScreen: (x, y) => toScreen(x, y).map(v => v / DPR), terrAtTouch };
  // Le point (px CSS) est-il sur le rond du nombre de soldats du territoire t (avec une marge pour le doigt) ?
  function onLabel(t, sx, sy) {
    const [x, y] = toScreen(G.map.terr[t].lx, G.map.terr[t].ly);
    const r = Math.max(9, Math.min(20, viewScale() * 1.5 / DPR)) + 10;
    return Math.hypot(x / DPR - sx, y / DPR - sy) <= r;
  }
  function terrAt(sx, sy) {
    const [x, y] = toMap(sx, sy);
    const m = G.map;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return -1;
    return m.cells[Math.floor(y) * m.w + Math.floor(x)];
  }

  // ---------- Entrées ----------
  // Pointeurs actifs (souris / doigts) : 1 = clic ou glisser, 2 = pincer pour zoomer
  const pointers = new Map();
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!G.map) return;
    setBuildOpen(false);
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      G.drag = null;
      G.pinch = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), zoom: G.view.zoom };
      return;
    }
    const t = pick(e);
    const own = t >= 0 && G.state && G.state.territories[t].owner === G.me;
    // Glisser pour envoyer des troupes seulement depuis le rond du nombre de soldats, ou depuis le territoire
    // déjà sélectionné ; ailleurs, glisser déplace la carte
    const fromLabel = own && (t === G.selected || onLabel(t, e.offsetX, e.offsetY));
    G.drag = { x: e.offsetX, y: e.offsetY, button: e.button, from: e.button === 0 && fromLabel ? t : -1, moved: false, cx: G.view.cx, cy: G.view.cy };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!G.map) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (G.pinch && pointers.size >= 2) {
      const [p1, p2] = [...pointers.values()];
      zoomAt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, G.pinch.zoom * Math.hypot(p1.x - p2.x, p1.y - p2.y) / G.pinch.dist);
      return;
    }
    if (e.pointerType === 'mouse') G.hover = terrAt(e.offsetX, e.offsetY);
    const d = G.drag;
    if (!d) return;
    if (Math.hypot(e.offsetX - d.x, e.offsetY - d.y) > 8) d.moved = true;
    d.ex = e.offsetX; d.ey = e.offsetY;
    if (d.moved && d.from < 0) {
      const s = viewScale() / DPR;
      G.view.cx = d.cx - (e.offsetX - d.x) / s;
      G.view.cy = d.cy - (e.offsetY - d.y) / s;
      clampView();
    }
  });
  function pointerEnd(e) {
    pointers.delete(e.pointerId);
    if (G.pinch) { if (pointers.size === 0) G.pinch = null; return; }
    const d = G.drag;
    G.drag = null;
    if (!d || !G.state || e.type === 'pointercancel') return;
    const t = pick(e);
    if (!d.moved) {
      if (G.choosing) { if (d.button === 0 && t >= 0) chooseStart(t); return; }
      if (d.button === 2) { onRightClick(t); return; }
      if (d.button === 0) onClick(t, e.pointerType === 'mouse');
    } else if (d.from >= 0 && t >= 0 && t !== d.from) {
      sendTroops(d.from, t);
    }
  }
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') G.hover = -1; });
  canvas.addEventListener('wheel', (e) => {
    if (!G.map) return;
    e.preventDefault();
    zoomAt(e.offsetX, e.offsetY, G.view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  // Empêche le zoom du navigateur (pincer, Ctrl+molette) pendant la partie : seule la carte zoome, les barres restent en place
  window.addEventListener('wheel', (e) => { if (e.ctrlKey && G.map) e.preventDefault(); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => { if (G.map) e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', (e) => { if (G.map && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => { // pas de zoom au double-tap sur la carte
    const now = Date.now();
    if (G.map && now - lastTouchEnd < 350 && e.target === canvas) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  function zoomAt(sx, sy, zoom) {
    const [mx, my] = toMap(sx, sy);
    G.view.zoom = Math.max(1, Math.min(6, zoom));
    const [nx, ny] = toMap(sx, sy);
    G.view.cx += mx - nx; G.view.cy += my - ny;
    clampView();
  }
  function clampView() {
    G.view.cx = Math.max(0, Math.min(G.map.w, G.view.cx));
    G.view.cy = Math.max(0, Math.min(G.map.h, G.view.cy));
  }

  // Clic : sélectionner un de mes territoires, puis cliquer une cible pour y envoyer des troupes.
  // À la souris : clic gauche = attaquer (sur un de mes territoires, il le sélectionne), clic droit = renforcer
  // un de mes territoires. Au doigt, toucher n'importe quelle cible envoie les troupes (attaque ou renfort).
  function onClick(t, mouse) {
    if (G.autoPick >= 0) { pickAutoTarget(t); return; }
    if (t < 0) { G.selected = -1; return; }
    const st = G.state, sel = G.selected;
    if (t === sel) { G.selected = -1; return; }
    const ownSel = sel >= 0 && st.territories[sel].owner === G.me;
    if (ownSel && !(mouse && st.territories[t].owner === G.me)) {
      sendTroops(sel, t);
      G.selected = -1;
      return;
    }
    G.selected = t;
  }
  // ---------- Envois automatiques ----------
  // Bouton « Auto » (ou touche R) sur un de mes territoires, puis toucher un autre de mes territoires :
  // ses soldats y partiront tout seuls toutes les 2 s. Sur un territoire qui a déjà une route : l'arrête.
  function toggleAuto(useHover) {
    const t = actionTarget(useHover);
    if (t < 0 || !G.state || G.state.territories[t].owner !== G.me) return;
    if (G.state.territories[t].auto >= 0) { act({ type: 'auto', from: t, to: -1 }); toast('Envoi automatique arrêté', 'info'); G.selected = -1; return; }
    G.autoPick = t;
    G.selected = t;
    toast('Touche le territoire qui recevra les renforts', 'info');
  }
  function pickAutoTarget(t) {
    const from = G.autoPick;
    G.autoPick = -1;
    document.querySelectorAll('#toasts .toast.info').forEach(el => el.remove()); // la consigne n'est plus utile
    G.selected = -1;
    if (t < 0 || t === from) return;
    if (G.state.territories[t].owner !== G.me) { toast('Choisis un de tes territoires', 'warn'); return; }
    act({ type: 'auto', from, to: t });
    toast(`Renforts automatiques : ${G.map.terr[from].name} → ${G.map.terr[t].name}`, 'good');
  }
  $('btnAuto').onclick = () => { if (G.autoPick >= 0) { G.autoPick = -1; G.selected = -1; } else toggleAuto(false); };
  // petit message en haut de l'écran, disparaît tout seul
  function toast(text, kind) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = text;
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => el.remove(), 4000);
  }

  function onRightClick(t) {
    if (G.autoPick >= 0) { pickAutoTarget(t); return; }
    const st = G.state, sel = G.selected;
    if (sel >= 0 && t >= 0 && t !== sel && st.territories[sel].owner === G.me && st.territories[t].owner === G.me) sendTroops(sel, t);
    G.selected = -1;
  }

  function sendCount(from) {
    const avail = G.state.territories[from].troops - 1; // il reste toujours 1 soldat
    if (avail <= 0) return 0;
    return G.pct >= 1 ? avail : Math.max(1, Math.round(avail * G.pct));
  }
  function sendTroops(from, to) {
    if (G.state.territories[from].owner !== G.me) return;
    const n = sendCount(from);
    if (n > 0) act({ type: 'send', from, to, n });
  }

  // Territoire visé par un achat/une construction : la sélection, ou à défaut (clavier) le territoire sous la souris
  function actionTarget(useHover) {
    if (G.selected >= 0) return G.selected;
    if (useHover && G.hover >= 0 && G.state.territories[G.hover].owner === G.me) return G.hover;
    return -1;
  }
  function buy(what, useHover) {
    const t = actionTarget(useHover);
    if (t < 0) return;
    const n = what === 'max' ? Math.floor(G.state.players[G.me].gold / E.CFG.SOLDIER_COST) : +what;
    act({ type: 'buy', t, n });
    G.selected = -1; // après une action, la sélection s'enlève (évite d'envoyer des troupes au clic suivant)
  }
  function build(kind, useHover) {
    const t = actionTarget(useHover);
    if (t < 0) return;
    act({ type: 'build', t, kind });
    setBuildOpen(false);
    G.selected = -1;
  }

  document.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buy(b.dataset.buy));
  document.querySelectorAll('[data-pct]').forEach(b => b.onclick = () => setPct(+b.dataset.pct / 100));
  function setPct(p) {
    G.pct = p;
    document.querySelectorAll('[data-pct]').forEach(b => b.classList.toggle('active', +b.dataset.pct / 100 === p));
  }
  setPct(0.5);

  // Bâtiments
  function setBuildOpen(open) {
    G.buildOpen = open;
    $('buildMenu').classList.toggle('hidden', !open);
    $('btnBuild').classList.toggle('active', open);
  }
  $('btnBuild').onclick = () => setBuildOpen(!G.buildOpen);
  document.querySelectorAll('[data-build]').forEach(b => {
    b.onclick = () => build(b.dataset.build);
  });

  // ---------- Raccourcis clavier (modifiables, mémorisés dans le navigateur) ----------
  // Une touche = { key, code } : on reconnaît la lettre tapée (key) ou la touche physique (code),
  // pour que les chiffres du haut du clavier marchent aussi en AZERTY sans Maj.
  const KEY_ACTIONS = [
    { group: 'Envoi de troupes' },
    { id: 'pct25', label: 'Envoyer 25 %', def: { key: '1', code: 'Digit1' }, run: () => setPct(0.25) },
    { id: 'pct50', label: 'Envoyer 50 %', def: { key: '2', code: 'Digit2' }, run: () => setPct(0.5) },
    { id: 'pct75', label: 'Envoyer 75 %', def: { key: '3', code: 'Digit3' }, run: () => setPct(0.75) },
    { id: 'pct100', label: 'Envoyer 100 %', def: { key: '4', code: 'Digit4' }, run: () => setPct(1) },
    { group: 'Achat de soldats' },
    { id: 'buy1', label: 'Acheter +1', def: { key: 'a', code: '' }, run: () => buy(1, true) },
    { id: 'buy5', label: 'Acheter +5', def: { key: 'z', code: '' }, run: () => buy(5, true) },
    { id: 'buy10', label: 'Acheter +10', def: { key: 'e', code: '' }, run: () => buy(10, true) },
    { id: 'buyMax', label: 'Acheter le maximum', def: { key: 'b', code: '' }, run: () => buy('max', true) },
    { group: 'Bâtiments' },
    { id: 'buildFort', label: 'Construire un Fort', def: { key: 'f', code: '' }, run: () => build('fort', true) },
    { id: 'buildMine', label: 'Construire une Mine', def: { key: 'm', code: '' }, run: () => build('mine', true) },
    { id: 'buildBarracks', label: 'Construire une Caserne', def: { key: 'c', code: '' }, run: () => build('barracks', true) },
    { group: 'Envois automatiques' },
    { id: 'auto', label: 'Route auto (puis clic sur la cible)', def: { key: 'r', code: '' }, run: () => toggleAuto(true) },
    { group: 'Divers' },
    { id: 'capital', label: 'Sélectionner ma capitale', def: { key: 'h', code: '' }, run: selectCapital },
    { id: 'deselect', label: 'Désélectionner', def: { key: 'Escape', code: 'Escape' }, run: () => { G.selected = -1; G.autoPick = -1; setBuildOpen(false); } },
    { id: 'pause', label: 'Pause (solo)', def: { key: 'p', code: '' }, run: () => { if (G.mode === 'solo') setPaused(!G.paused); } },
  ];
  let keys = {};
  function loadKeys() {
    let saved = {};
    try { saved = JSON.parse(store.get('bw-keys') || '{}') || {}; } catch (e) {}
    keys = {};
    for (const a of KEY_ACTIONS) if (a.id) keys[a.id] = saved[a.id] !== undefined ? saved[a.id] : a.def;
  }
  loadKeys();
  const keyLabel = (k) => {
    if (!k || !k.key) return '—';
    const names = { ' ': 'Espace', Escape: 'Échap', Enter: 'Entrée', Tab: 'Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
    return names[k.key] || (k.key.length === 1 ? k.key.toUpperCase() : k.key);
  };
  const matches = (k, e) => k && k.key && (e.key.toLowerCase() === k.key.toLowerCase() || (k.code && e.code === k.code));

  function selectCapital() {
    const c = G.state.players[G.me].capital;
    if (c != null && G.state.territories[c].owner === G.me) G.selected = c;
  }

  let waitingFor = null; // action en cours de modification
  function renderKeys() {
    $('keysTable').innerHTML = KEY_ACTIONS.map(a => a.group
      ? `<tr class="group"><td colspan="2">${a.group}</td></tr>`
      : `<tr><td>${a.label}</td><td><button data-key="${a.id}" class="${waitingFor === a.id ? 'waiting' : ''}">${waitingFor === a.id ? 'Appuie…' : keyLabel(keys[a.id])}</button></td></tr>`).join('');
    document.querySelectorAll('[data-key]').forEach(b => b.onclick = () => { waitingFor = b.dataset.key; renderKeys(); });
  }
  let pausedByKeys = false; // la fenêtre a mis la partie en pause : on la relance en la fermant
  function openKeys(open) {
    waitingFor = null;
    $('keysOverlay').classList.toggle('hidden', !open);
    if (open) {
      pausedByKeys = !!(G.state && G.mode === 'solo' && !G.paused && G.state.winner == null);
      if (pausedByKeys) setPaused(true);
      renderKeys();
    } else if (pausedByKeys) { pausedByKeys = false; setPaused(false); }
  }
  $('btnKeys').onclick = () => openKeys(true);
  $('btnKeysMenu').onclick = () => openKeys(true);
  $('btnKeysClose').onclick = () => openKeys(false);
  $('btnKeysReset').onclick = () => { store.set('bw-keys', '{}'); loadKeys(); waitingFor = null; renderKeys(); };

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    // modification d'une touche
    if (waitingFor) {
      e.preventDefault();
      const k = e.key === 'Backspace' || e.key === 'Delete' ? { key: '', code: '' } : { key: e.key, code: e.code };
      // une touche ne sert qu'à une action : on la retire des autres
      if (k.key) for (const id in keys) if (id !== waitingFor && matches(keys[id], e)) keys[id] = { key: '', code: '' };
      keys[waitingFor] = k;
      store.set('bw-keys', JSON.stringify(keys));
      waitingFor = null;
      renderKeys();
      return;
    }
    if (!$('keysOverlay').classList.contains('hidden')) { if (e.key === 'Escape') openKeys(false); return; }
    if (!G.state || e.ctrlKey || e.metaKey || e.altKey) return;
    for (const a of KEY_ACTIONS) if (a.id && matches(keys[a.id], e)) { e.preventDefault(); a.run(); return; }
  });

  // Pause (solo)
  function setPaused(p) {
    if (G.state && G.state.winner != null) p = false;
    G.paused = p;
    $('pauseOverlay').classList.toggle('hidden', !p);
  }
  $('btnPause').onclick = () => setPaused(!G.paused);
  $('btnResume').onclick = () => setPaused(false);

  function quit() {
    if (G.es) G.es.close();
    G.es = null; G.state = null; G.map = null; G.mode = null; G.paused = false;
    $('overlay').classList.add('hidden');
    $('pauseOverlay').classList.add('hidden');
    show('menu');
  }
  $('btnMenu').onclick = quit;
  $('btnAgain').onclick = () => startSolo(G.lastSolo.n, G.lastSolo.level, G.lastSolo.opts);
  $('btnWatch').onclick = () => { G.overDismissed = true; $('overlay').classList.add('hidden'); };

  // Boutons de la barre du haut : un 2e clic confirme (sauf si la partie est finie)
  function confirmable(btn, action) {
    let timer = null;
    const lbl = btn.querySelector('.lbl'), ico = btn.querySelector('.ico');
    const label = lbl.textContent, icon = ico.textContent;
    const reset = () => { btn.classList.remove('confirm'); lbl.textContent = label; ico.textContent = icon; };
    btn.onclick = () => {
      const over = G.state && (G.state.winner != null || !G.state.players[G.me].alive);
      if (over || btn.classList.contains('confirm')) { clearTimeout(timer); reset(); action(); return; }
      btn.classList.add('confirm'); lbl.textContent = 'Confirmer ?'; ico.textContent = '?';
      timer = setTimeout(reset, 3000);
    };
  }
  confirmable($('btnQuit'), quit);
  confirmable($('btnRestart'), () => startSolo(G.lastSolo.n, G.lastSolo.level, G.lastSolo.opts));

  // ---------- Rendu ----------
  function draw() {
    const st = G.state, m = G.map;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1d2228';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!st || !m) return;
    rebuildBase();

    const s = viewScale();
    const [ox, oy] = toScreen(0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(G.base, ox, oy, m.w * s, m.h * s);

    // Surbrillances (coordonnées carte)
    ctx.setTransform(s, 0, 0, s, ox, oy);
    if (G.hover >= 0) { ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill(G.paths[G.hover].fill); }
    const sel = G.selected;
    if (sel >= 0) {
      ctx.lineWidth = 3 / s * DPR;
      ctx.strokeStyle = '#fff';
      ctx.stroke(G.paths[sel].outline);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const R = Math.max(9 * DPR, Math.min(20 * DPR, s * 1.5));
    const font = (px, w) => `${w || 600} ${Math.round(px)}px system-ui, sans-serif`;
    // Routes d'envoi automatique : flèche courbe en pointillés vers le territoire qui reçoit les renforts
    st.territories.forEach((t, i) => {
      if (!(t.auto >= 0) || t.owner < 0) return;
      const [x1, y1] = toScreen(m.terr[i].lx, m.terr[i].ly), [x2, y2] = toScreen(m.terr[t.auto].lx, m.terr[t.auto].ly);
      const mx = (x1 + x2) / 2 - (y2 - y1) * 0.18, my = (y1 + y2) / 2 + (x2 - x1) * 0.18;
      ctx.lineCap = 'round';
      for (const [w, col] of [[5 * DPR, 'rgba(10,12,16,0.6)'], [2.5 * DPR, st.players[t.owner].color]]) {
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash([9 * DPR, 7 * DPR]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
      }
      ctx.setLineDash([]);
      const ang = Math.atan2(y2 - my, x2 - mx), ah = R * 0.9, tx = x2 - Math.cos(ang) * R * 1.1, ty = y2 - Math.sin(ang) * R * 1.1;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - Math.cos(ang - 0.5) * ah, ty - Math.sin(ang - 0.5) * ah); ctx.lineTo(tx - Math.cos(ang + 0.5) * ah, ty - Math.sin(ang + 0.5) * ah); ctx.closePath();
      ctx.fillStyle = st.players[t.owner].color; ctx.fill(); ctx.lineWidth = 1.5 * DPR; ctx.strokeStyle = 'rgba(10,12,16,0.8)'; ctx.stroke();
    });
    // territoire de départ d'une route en cours de création
    if (G.autoPick >= 0) {
      const [x, y] = toScreen(m.terr[G.autoPick].lx, m.terr[G.autoPick].ly);
      ctx.beginPath(); ctx.arc(x, y, R * 1.7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5 * DPR; ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // Aperçu du trajet depuis la sélection vers la cible survolée (souris) ou glissée
    const route = (from, to) => {
      const path = E.findPath(st, m, G.me, from, to);
      if (!path) return;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2.5 * DPR; ctx.setLineDash([7 * DPR, 6 * DPR]);
      ctx.beginPath(); ctx.moveTo(...toScreen(m.terr[from].lx, m.terr[from].ly));
      let prev = from;
      for (const w of path) {
        const P = E.crossingPoint(m, prev, w);
        ctx.lineTo(...toScreen(P[0], P[1])); ctx.lineTo(...toScreen(m.terr[w].lx, m.terr[w].ly));
        prev = w;
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    if (sel >= 0 && st.territories[sel].owner === G.me && G.hover >= 0 && G.hover !== sel) route(sel, G.hover);
    const d = G.drag;
    if (d && d.moved && d.from >= 0 && d.ex != null) {
      const t = terrAt(d.ex, d.ey);
      if (t >= 0 && t !== d.from) route(d.from, t);
      else {
        const [ax, ay] = toScreen(m.terr[d.from].lx, m.terr[d.from].ly);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3 * DPR; ctx.setLineDash([8 * DPR, 6 * DPR]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(d.ex * DPR, d.ey * DPR); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // Étiquettes de territoire
    st.territories.forEach((t, i) => {
      const T = m.terr[i];
      const [x, y] = toScreen(T.lx, T.ly);
      const col = t.owner >= 0 ? st.players[t.owner].color : '#7d735f';
      const txt = String(t.troops);
      const r = R + Math.max(0, txt.length - 2) * R * 0.3;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 2 * DPR; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = font(R * 1.0);
      ctx.fillText(txt, x, y + 1);
      const caps = st.capitals || st.players.map(pl => pl.capital);
      if (caps.includes(i)) drawStar(x, y - r - R * 0.35, R * 0.62);
      ctx.font = font(R * 0.75, 700);
      const inc = E.terrIncome(st, m, i);
      if (st.rich && st.rich[i]) { // zone riche : revenu en or sur fond sombre
        const w = ctx.measureText('+' + inc).width + R * 0.5;
        ctx.fillStyle = 'rgba(40,30,10,0.85)'; ctx.fillRect(x - w / 2, y + r + R * 0.12, w, R * 0.86);
        ctx.fillStyle = '#ffd84a';
      } else ctx.fillStyle = 'rgba(30,25,15,0.85)';
      ctx.fillText('+' + inc, x, y + r + R * 0.55);
      // un badge par type de bâtiment (avec le nombre s'il y en a plusieurs), empilés à droite de l'étiquette
      // couleur par type : Fort gris pierre, Mine or, Caserne rouge (visible pour tous les joueurs)
      Object.keys(E.BUILDINGS).filter(k => t.buildings.includes(k)).forEach((k, j) => {
        const n = E.countOf(t, k), txt = E.BUILDINGS[k].letter + (n > 1 ? n : '');
        const bh = R * 0.95, bw = bh * (txt.length > 1 ? 1.55 : 1.05), bx = x + r + bw * 0.55, by = y - r * 0.7 + j * (bh + 2 * DPR);
        ctx.fillStyle = BADGE[k]; ctx.strokeStyle = 'rgba(15,15,15,0.85)'; ctx.lineWidth = 1.5 * DPR;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, 3 * DPR) : ctx.rect(bx - bw / 2, by - bh / 2, bw, bh); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#16191d'; ctx.font = font(R * 0.72, 800);
        ctx.fillText(txt, bx, by + 1);
      });
    });

    // Armées en mouvement
    const extra = G.mode === 'multi' ? Math.min(0.15, (performance.now() - G.lastStateAt) / 1000) * st.opts.speed : 0;
    for (const a of st.armies) {
      const k = Math.min(1, (a.t + extra) / a.dur);
      const [x, y] = toScreen(...E.legPos(m, a.from, a.to, k));
      if (a.owner === G.me) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2 * DPR; ctx.setLineDash([5 * DPR, 5 * DPR]);
        ctx.beginPath(); ctx.moveTo(x, y);
        // Reste du trajet : frontière de l'étape en cours (si pas encore franchie), puis chaque étape suivante
        let prev = a.from;
        for (const w of [a.to].concat(a.path || [])) {
          const P = E.crossingPoint(m, prev, w);
          if (w !== a.to || k < 0.5) ctx.lineTo(...toScreen(P[0], P[1]));
          ctx.lineTo(...toScreen(m.terr[w].lx, m.terr[w].ly));
          prev = w;
        }
        ctx.stroke(); ctx.setLineDash([]);
      }
      const r = R * 0.75;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = st.players[a.owner].color; ctx.fill();
      ctx.lineWidth = 2 * DPR; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = font(R * 0.8);
      ctx.fillText(String(a.n), x, y + 1);
    }
  }

  const BADGE = { fort: '#b9c3cc', mine: '#ffd84a', barracks: '#ff8f7f' };

  // Étoile des capitales : jaune avec un contour sombre, lisible sur toutes les couleurs
  function drawStar(cx, cy, rad) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? rad * 0.45 : rad;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffd84a'; ctx.fill();
    ctx.lineWidth = 1.5 * DPR; ctx.strokeStyle = 'rgba(20,15,5,0.9)'; ctx.stroke();
  }

  // Infos d'un territoire : terrain, défense et nombre de soldats nécessaire pour le prendre
  function territoryInfo(i) {
    const st = G.state, m = G.map, t = st.territories[i], T = m.terr[i];
    const owner = t.owner >= 0 ? st.players[t.owner].name : 'Neutre';
    const inc = E.terrIncome(st, m, i);
    const ter = E.TERRAIN[T.terrain].name + (st.rich && st.rich[i] ? ' · zone riche' : '') + (st.capitals && st.capitals.includes(i) ? ' · capitale' : '');
    const bld = t.buildings.length ? ' · ' + Object.keys(E.BUILDINGS).filter(k => t.buildings.includes(k))
      .map(k => E.BUILDINGS[k].name + (E.countOf(t, k) > 1 ? ' ×' + E.countOf(t, k) : '')).join(', ') : '';
    if (t.owner === G.me) return `${ter}${bld} · ${t.troops} soldats · +${inc} or`;
    const def = E.defenseOf(st, m, i);
    const need = Math.ceil(t.troops * def / 0.85) + 1;
    return `${owner} · ${ter}${bld} · ${t.troops} soldats · défense ×${def.toFixed(1).replace('.', ',')} → ~${need} pour le prendre`;
  }

  function updateUI() {
    const st = G.state, m = G.map;
    if (!st || !m || G.me < 0) return;
    const me = st.players[G.me];
    let terr = 0, troops = 0;
    st.territories.forEach(t => { if (t.owner === G.me) { terr++; troops += t.troops; } });
    $('hudGold').textContent = Math.floor(me.gold);
    $('hudIncome').textContent = '+' + E.incomeOf(st, m, G.me) + '/' + E.CFG.INCOME_EVERY + 's';
    $('hudTerr').textContent = terr + '/' + m.terr.length;
    $('hudTroops').textContent = troops;

    // Classement
    const counts = st.players.map(() => 0);
    st.territories.forEach(t => { if (t.owner >= 0) counts[t.owner]++; });
    const order = st.players.map((p, i) => i).sort((a, b) => counts[b] - counts[a]);
    $('scoreboard').innerHTML = order.map(i => {
      const p = st.players[i];
      return `<div class="${p.alive ? '' : 'dead'}"><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}${i === G.me ? ' (toi)' : ''}<span class="n">${counts[i]}</span></div>`;
    }).join('');

    // Barre du bas : sélection (ou cible survolée) + achat
    const sel = G.selected;
    const own = sel >= 0 && st.territories[sel].owner === G.me;
    const info = own && G.hover >= 0 && G.hover !== sel ? G.hover : sel;
    if (info >= 0) {
      $('pName').textContent = (info !== sel ? '→ ' : '') + m.terr[info].name;
      const hint = window.matchMedia('(hover: hover)').matches ? ' · gauche : attaquer, droit : renforcer' : ' · touche une cible';
      $('pInfo').textContent = territoryInfo(info) + (info === sel && own ? hint : '');
    } else {
      $('pName').textContent = 'Aucune sélection';
      $('pInfo').textContent = 'Clique sur un de tes territoires';
    }
    $('pCost').textContent = '(' + E.CFG.SOLDIER_COST + ' or)';
    const canBuy = own && me.gold >= E.CFG.SOLDIER_COST;
    document.querySelectorAll('[data-buy]').forEach(b => {
      b.disabled = !canBuy || (b.dataset.buy !== 'max' && me.gold < +b.dataset.buy * E.CFG.SOLDIER_COST);
    });
    const room = (k) => own ? E.maxBuildings(st, sel, k) - E.countOf(st.territories[sel], k) : 0;
    const canBuild = own && Object.keys(E.BUILDINGS).some(k => room(k) > 0);
    $('btnBuild').disabled = !canBuild;
    if (!canBuild && G.buildOpen) setBuildOpen(false);
    document.querySelectorAll('[data-build]').forEach(b => {
      const k = b.dataset.build, cost = E.buildCost(st, G.me, k);
      const max = own ? E.maxBuildings(st, sel, k) : 1, n = own ? E.countOf(st.territories[sel], k) : 0;
      b.disabled = !canBuild || room(k) <= 0 || me.gold < cost;
      b.querySelector('i').textContent = room(k) <= 0 ? (max > 1 ? `Maximum (${n}/${max})` : 'Déjà construit') : cost + ' or' + (max > 1 ? ` · ${n}/${max}` : '');
    });

    // Envoi automatique : bouton selon l'état
    const autoBtn = $('btnAuto');
    autoBtn.disabled = !own && G.autoPick < 0;
    autoBtn.classList.toggle('active', G.autoPick >= 0);
    autoBtn.textContent = G.autoPick >= 0 ? 'Annuler' : own && st.territories[sel].auto >= 0 ? 'Stop auto' : 'Auto';
    if (G.autoPick >= 0) { $('pName').textContent = 'Route automatique'; $('pInfo').textContent = 'Touche le territoire qui recevra les renforts'; }

    // Fin de partie / élimination
    if (st.winner != null && !G.finalShown) showEnd(true);
    else if (!me.alive && !G.overShown && !G.overDismissed) showEnd(false);
  }

  // ---------- Fin de partie : statistiques ----------
  function fmtTime(sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ' min ' + String(sec % 60).padStart(2, '0'); }
  function showEnd(over) {
    const st = G.state, m = G.map;
    G.overShown = true;
    if (over) G.finalShown = true;
    setPaused(false);
    const me = st.players[G.me];
    $('overTitle').textContent = over ? (st.winner === G.me ? 'Victoire !' : st.winner >= 0 ? `Défaite. ${st.players[st.winner].name} a gagné` : 'Match nul') : 'Tu as été éliminé';
    $('overSub').textContent = over ? 'Durée de la partie : ' + fmtTime(st.time) : `Éliminé après ${fmtTime(me.stats.outAt || st.time)}. La partie continue entre les autres joueurs.`;
    $('btnWatch').classList.toggle('hidden', over);
    $('btnAgain').classList.toggle('hidden', G.mode !== 'solo');
    const rows = st.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.stats.peakTerr - a.p.stats.peakTerr);
    $('statsTable').innerHTML = '<tr><th>Joueur</th><th>Terr. max</th><th>Captures</th><th>Perdus</th><th>Soldats achetés</th><th>Capitales prises</th>' + (st.opts.buildings ? '<th>Bâtiments</th>' : '') + '</tr>' +
      rows.map(({ p, i }) => `<tr class="${st.winner === i ? 'win' : ''}"><td><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}${i === G.me ? ' (toi)' : ''}</td><td>${p.stats.peakTerr}</td><td>${p.stats.captures}</td><td>${p.stats.lost}</td><td>${p.stats.bought}</td><td>${p.stats.capitals}</td>${st.opts.buildings ? `<td>${p.stats.built}</td>` : ''}</tr>`).join('');
    const bb = st.bigBattle;
    $('bigBattle').textContent = bb ? `Plus grande bataille : ${st.players[bb.attacker].name} (${bb.att}) contre ${bb.defender >= 0 ? st.players[bb.defender].name : 'des neutres'} (${bb.def}) à ${m.terr[bb.where].name}, à ${fmtTime(bb.time)}.` : '';
    $('overlay').classList.remove('hidden');
    requestAnimationFrame(drawChart);
  }

  // Graphique : territoires possédés au fil du temps, une ligne par joueur, nom en bout de ligne
  const chart = { pad: { l: 30, r: 78, t: 8, b: 22 } };
  function drawChart() {
    const st = G.state, c = $('statsChart');
    if (!st) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    c.width = W * dpr; c.height = H * dpr;
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    const hist = st.history, n = hist.length, P = chart.pad;
    let maxY = 1;
    for (const row of hist) for (const v of row) maxY = Math.max(maxY, v);
    maxY = Math.ceil(maxY / 5) * 5;
    const tMax = Math.max(1, st.time);
    const tOf = (k) => Math.min(tMax, k * E.CFG.HISTORY_EVERY);
    const tx = (k) => P.l + (k === n - 1 ? tMax : tOf(k)) / tMax * (W - P.l - P.r);
    const ty = (v) => H - P.b - v / maxY * (H - P.t - P.b);
    chart.tx = tx; chart.n = n; chart.W = W;
    // grille et axes (discrets)
    x.font = '11px system-ui, sans-serif'; x.fillStyle = '#9aa5b1'; x.strokeStyle = 'rgba(255,255,255,0.08)'; x.lineWidth = 1;
    x.textAlign = 'right'; x.textBaseline = 'middle';
    for (let v = 0; v <= maxY; v += maxY / 5) { x.beginPath(); x.moveTo(P.l, ty(v)); x.lineTo(W - P.r, ty(v)); x.stroke(); x.fillText(String(Math.round(v)), P.l - 6, ty(v)); }
    x.textAlign = 'center'; x.textBaseline = 'top';
    const minutes = Math.floor(tMax / 60);
    const stepMin = Math.max(1, Math.ceil(minutes / 6));
    for (let mi = 0; mi <= minutes; mi += stepMin) x.fillText(mi + ' min', P.l + mi * 60 / tMax * (W - P.l - P.r), H - P.b + 6);
    // lignes
    const ends = [];
    st.players.forEach((p, i) => {
      x.strokeStyle = p.color; x.lineWidth = 2; x.lineJoin = 'round';
      x.beginPath();
      hist.forEach((row, k) => { const px = tx(k), py = ty(row[i] || 0); if (k === 0) x.moveTo(px, py); else x.lineTo(px, py); });
      x.stroke();
      ends.push({ i, y: ty(hist[n - 1][i] || 0), name: p.name });
    });
    // étiquettes directes en bout de ligne, écartées pour ne pas se chevaucher
    ends.sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
    // si ça déborde en bas, on remonte la pile
    const bottom = H - 6;
    if (ends.length && ends[ends.length - 1].y > bottom) {
      ends[ends.length - 1].y = bottom;
      for (let k = ends.length - 2; k >= 0; k--) if (ends[k + 1].y - ends[k].y < 13) ends[k].y = ends[k + 1].y - 13;
    }
    x.textAlign = 'left'; x.textBaseline = 'middle'; x.font = '11px system-ui, sans-serif';
    for (const e of ends) {
      x.fillStyle = st.players[e.i].color; x.fillRect(W - P.r + 4, e.y - 1, 8, 2);
      x.fillStyle = '#eef1f4'; x.fillText(e.name.length > 9 ? e.name.slice(0, 8) + '…' : e.name, W - P.r + 15, e.y);
    }
    // repère de survol
    if (chart.hoverK != null && chart.hoverK < n) {
      const px = tx(chart.hoverK);
      x.strokeStyle = 'rgba(255,255,255,0.4)'; x.beginPath(); x.moveTo(px, P.t); x.lineTo(px, H - P.b); x.stroke();
      st.players.forEach((p, i) => { x.beginPath(); x.arc(px, ty(hist[chart.hoverK][i] || 0), 4, 0, Math.PI * 2); x.fillStyle = p.color; x.fill(); x.strokeStyle = '#2a3038'; x.lineWidth = 2; x.stroke(); });
    }
  }
  function chartHover(e) {
    const st = G.state;
    if (!st || chart.tx == null) return;
    const rect = $('statsChart').getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let best = 0, bd = Infinity;
    for (let k = 0; k < chart.n; k++) { const d = Math.abs(chart.tx(k) - mx); if (d < bd) { bd = d; best = k; } }
    chart.hoverK = best;
    drawChart();
    const tip = $('chartTip');
    const tSec = best === chart.n - 1 ? st.time : best * E.CFG.HISTORY_EVERY;
    const rows = st.players.map((p, i) => ({ p, v: st.history[best][i] || 0 })).sort((a, b) => b.v - a.v);
    tip.innerHTML = `<div><b>${fmtTime(tSec)}</b></div>` + rows.map(r => `<div><span class="sw" style="background:${r.p.color}"></span>${escapeHtml(r.p.name)}<span style="margin-left:auto;padding-left:10px">${r.v}</span></div>`).join('');
    tip.classList.remove('hidden');
    const px = chart.tx(best);
    tip.style.left = Math.max(0, Math.min(px + 12, chart.W - tip.offsetWidth)) + 'px';
    tip.style.top = '24px';
  }
  $('statsChart').addEventListener('pointermove', chartHover);
  $('statsChart').addEventListener('pointerdown', chartHover);
  $('statsChart').addEventListener('pointerleave', () => { chart.hoverK = null; $('chartTip').classList.add('hidden'); drawChart(); });
  window.addEventListener('resize', () => { if (!$('overlay').classList.contains('hidden')) drawChart(); });

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------- Boucle ----------
  let last = performance.now(), uiAcc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (G.mode === 'solo' && G.state && !G.paused && !G.choosing) E.step(G.state, G.map, dt);
    // filet de sécurité : si la taille affichée a changé (rotation), on redimensionne
    if (G.map && (Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)) !== canvas.width || Math.round(canvas.clientHeight * (window.devicePixelRatio || 1)) !== canvas.height)) resize();
    draw();
    uiAcc += dt;
    if (uiAcc > 0.1) { uiAcc = 0; updateUI(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
