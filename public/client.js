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
    lastStateAt: 0,
    base: null, baseKey: '', paths: null,
    view: { zoom: 1, cx: 0, cy: 0 },
    drag: null,
    overDismissed: false,
  };

  window.BW = G; // pratique pour déboguer depuis la console

  // ---------- Écrans ----------
  function show(id) {
    for (const s of ['menu', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id);
  }
  const playerName = () => ($('name').value.trim() || 'Joueur').slice(0, 16);
  try { $('name').value = localStorage.getItem('bw-name') || ''; } catch (e) {}
  $('name').addEventListener('change', () => { try { localStorage.setItem('bw-name', $('name').value); } catch (e) {} });
  const joinParam = new URLSearchParams(location.search).get('join');
  if (joinParam) $('joinCode').value = joinParam.toUpperCase();

  // ---------- Solo ----------
  $('btnSolo').onclick = () => startSolo(+$('botCount').value, $('botLevel').value);
  function startSolo(n, level) {
    G.lastSolo = { n, level };
    const players = [{ id: 'me', name: playerName(), bot: false }];
    for (let i = 1; i <= n; i++) players.push({ id: 'bot' + i, name: 'Bot ' + i, bot: level });
    const seed = Math.floor(Math.random() * 2 ** 31);
    G.mode = 'solo';
    setupGame(seed, players);
    G.state = E.createGame(G.map, players, seed ^ 0x5bd1e995);
    G.me = 0;
  }

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
    try { enterLobby(await post('create', { name: playerName() })); }
    catch (e) { $('menuError').textContent = location.protocol === 'file:' ? 'Le multijoueur nécessite le serveur (npm start).' : e.message; }
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
      setupGame(d.seed, d.players);
      G.me = d.players.findIndex(p => p.id === G.session.id);
    });
    es.addEventListener('state', (ev) => { G.state = JSON.parse(ev.data); G.lastStateAt = performance.now(); });
  }

  function renderLobby(info) {
    const isHost = info.host === G.session.id;
    $('hostControls').classList.toggle('hidden', !isHost);
    $('lobbyWait').classList.toggle('hidden', isHost);
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
    if (!G.state || G.state.winner != null) return;
    if (G.mode === 'solo') E.applyAction(G.state, G.map, G.me, action);
    else post('action', withSession({ action })).catch(() => {});
  }

  // ---------- Préparation de la partie ----------
  function setupGame(seed, players) {
    G.map = E.generateMap(seed);
    G.selected = -1; G.hover = -1; G.baseKey = ''; G.overDismissed = false;
    G.view = { zoom: 1, cx: G.map.w / 2, cy: G.map.h / 2 };
    buildPaths();
    $('overlay').classList.add('hidden');
    $('btnRestart').classList.toggle('hidden', G.mode !== 'solo');
    show('game');
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
        G.paths[id].fill.rect(x, y, x2 - x, 1);
        x = x2;
      }
    }
    for (const [x1, y1, x2, y2, a, b] of m.segments) {
      G.paths[a].outline.moveTo(x1, y1); G.paths[a].outline.lineTo(x2, y2);
      G.paths[b].outline.moveTo(x1, y1); G.paths[b].outline.lineTo(x2, y2);
    }
    // Bords de la carte
    for (let x = 0; x < m.w; x++) {
      const top = m.cells[x], bot = m.cells[(m.h - 1) * m.w + x];
      G.paths[top].outline.moveTo(x, 0); G.paths[top].outline.lineTo(x + 1, 0);
      G.paths[bot].outline.moveTo(x, m.h); G.paths[bot].outline.lineTo(x + 1, m.h);
    }
    for (let y = 0; y < m.h; y++) {
      const l = m.cells[y * m.w], r = m.cells[y * m.w + m.w - 1];
      G.paths[l].outline.moveTo(0, y); G.paths[l].outline.lineTo(0, y + 1);
      G.paths[r].outline.moveTo(m.w, y); G.paths[r].outline.lineTo(m.w, y + 1);
    }
  }

  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function terrColor(i, owner) {
    const v = ((i * 2654435761) >>> 0) % 1000 / 1000 * 0.16 - 0.08; // légère variation par territoire
    let c = owner >= 0 ? hexRgb(G.state.players[owner].color) : [190, 178, 150];
    if (owner >= 0) c = c.map(x => x * 0.78 + 255 * 0.22); // couleurs un peu adoucies
    return c.map(x => Math.max(0, Math.min(255, Math.round(x * (1 + v)))));
  }

  // Image de fond redessinée seulement quand les propriétaires changent
  const S = 8;
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
      const c = cols[m.cells[i]];
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    if (!G.base) G.base = document.createElement('canvas');
    G.base.width = m.w * S; G.base.height = m.h * S;
    const b = G.base.getContext('2d');
    b.imageSmoothingEnabled = false;
    b.drawImage(small, 0, 0, m.w * S, m.h * S);
    // Frontières : fines entre territoires, épaisses entre propriétaires
    const thin = new Path2D(), thick = new Path2D();
    for (const [x1, y1, x2, y2, a, c] of m.segments) {
      const p = st.territories[a].owner !== st.territories[c].owner ? thick : thin;
      p.moveTo(x1 * S, y1 * S); p.lineTo(x2 * S, y2 * S);
    }
    b.lineCap = 'round';
    b.strokeStyle = 'rgba(40,30,20,0.35)'; b.lineWidth = 1.2; b.stroke(thin);
    b.strokeStyle = 'rgba(25,20,15,0.85)'; b.lineWidth = 3; b.stroke(thick);
    b.strokeStyle = 'rgba(25,20,15,0.9)'; b.lineWidth = 4; b.strokeRect(0, 0, m.w * S, m.h * S);
  }

  // ---------- Vue ----------
  let DPR = 1;
  const BAR_TOP = 50, BAR_BOT = 84;
  function resize() {
    DPR = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * DPR;
    canvas.height = canvas.clientHeight * DPR;
  }
  window.addEventListener('resize', resize);

  function viewScale() {
    const m = G.map;
    const fit = Math.min(canvas.width / (m.w + 4), (canvas.height - (BAR_TOP + BAR_BOT + 10) * DPR) / (m.h + 4));
    return Math.max(fit, 1) * G.view.zoom;
  }
  function toScreen(x, y) {
    const s = viewScale();
    return [canvas.width / 2 + (x - G.view.cx) * s, canvas.height / 2 + (BAR_TOP - BAR_BOT) / 2 * DPR + (y - G.view.cy) * s];
  }
  function toMap(sx, sy) {
    const s = viewScale();
    return [(sx * DPR - canvas.width / 2) / s + G.view.cx, (sy * DPR - canvas.height / 2 - (BAR_TOP - BAR_BOT) / 2 * DPR) / s + G.view.cy];
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
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      G.drag = null;
      G.pinch = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), zoom: G.view.zoom };
      return;
    }
    const t = terrAt(e.offsetX, e.offsetY);
    const own = t >= 0 && G.state && G.state.territories[t].owner === G.me;
    G.drag = { x: e.offsetX, y: e.offsetY, button: e.button, from: e.button === 0 && own ? t : -1, moved: false, cx: G.view.cx, cy: G.view.cy };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!G.map) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (G.pinch && pointers.size >= 2) {
      const [p1, p2] = [...pointers.values()];
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      zoomAt(mx, my, G.pinch.zoom * Math.hypot(p1.x - p2.x, p1.y - p2.y) / G.pinch.dist);
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
    const t = terrAt(e.offsetX, e.offsetY);
    if (!d.moved) {
      if (d.button === 2) { G.selected = -1; return; }
      if (d.button === 0) onClick(t);
    } else if (d.from >= 0 && t >= 0 && t !== d.from) {
      sendTroops(d.from, t);
    }
  }
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('wheel', (e) => {
    if (!G.map) return;
    e.preventDefault();
    zoomAt(e.offsetX, e.offsetY, G.view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  // Empêche le zoom du navigateur (pincer, Ctrl+molette) pendant la partie : seules la carte zoome, les barres restent en place
  window.addEventListener('wheel', (e) => { if (e.ctrlKey && G.map) e.preventDefault(); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => { if (G.map) e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', (e) => { if (G.map && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => { // pas de zoom au double-tap
    const now = Date.now();
    if (G.map && now - lastTouchEnd < 350) e.preventDefault();
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

  // Territoires atteignables depuis `from` : les miens reliés + leurs voisins
  function reachable(from) {
    const st = G.state, m = G.map, out = new Set();
    if (from < 0 || st.territories[from].owner !== G.me) return out;
    const seen = new Set([from]), q = [from];
    for (let k = 0; k < q.length; k++) {
      for (const n of m.terr[q[k]].neighbors) {
        if (seen.has(n)) continue;
        seen.add(n); out.add(n);
        if (st.territories[n].owner === G.me) q.push(n);
      }
    }
    return out;
  }

  // Clic : sélectionner un de mes territoires, puis cliquer une cible (à moi ou ennemie) pour y envoyer des troupes
  function onClick(t) {
    if (t < 0) { G.selected = -1; return; }
    const st = G.state, sel = G.selected;
    if (t === sel) { G.selected = -1; return; }
    if (sel >= 0 && st.territories[sel].owner === G.me && reachable(sel).has(t)) {
      sendTroops(sel, t);
      G.selected = -1;
      return;
    }
    G.selected = t;
  }

  function sendTroops(from, to) {
    const t = G.state.territories[from];
    if (t.owner !== G.me) return;
    const n = G.pct >= 1 ? t.troops : Math.max(1, Math.round(t.troops * G.pct));
    if (n > 0) act({ type: 'send', from, to, n });
  }

  function buy(what) {
    if (G.selected < 0) return;
    const n = what === 'max' ? Math.floor(G.state.players[G.me].gold / E.CFG.SOLDIER_COST) : +what;
    act({ type: 'buy', t: G.selected, n });
  }

  document.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buy(b.dataset.buy));
  document.querySelectorAll('[data-pct]').forEach(b => b.onclick = () => setPct(+b.dataset.pct / 100));
  function setPct(p) {
    G.pct = p;
    document.querySelectorAll('[data-pct]').forEach(b => b.classList.toggle('active', +b.dataset.pct / 100 === p));
  }
  setPct(0.5);
  window.addEventListener('keydown', (e) => {
    if (!G.state || e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') G.selected = -1;
    if (e.key === 'b' || e.key === 'B') buy('max');
    if (['1', '2', '3', '4'].includes(e.key)) setPct(+e.key * 0.25);
  });

  function quit() {
    if (G.es) G.es.close();
    G.es = null; G.state = null; G.map = null; G.mode = null;
    $('overlay').classList.add('hidden');
    show('menu');
  }
  $('btnMenu').onclick = quit;

  // Boutons de la barre du haut : un 2e clic confirme (sauf si la partie est finie)
  function confirmable(btn, label, action) {
    let timer = null;
    btn.onclick = () => {
      const over = G.state && (G.state.winner != null || !G.state.players[G.me].alive);
      if (over || btn.classList.contains('confirm')) {
        clearTimeout(timer); btn.classList.remove('confirm'); btn.textContent = label;
        action();
        return;
      }
      btn.classList.add('confirm'); btn.textContent = 'Confirmer ?';
      timer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = label; }, 3000);
    };
  }
  confirmable($('btnQuit'), 'Quitter', quit);
  confirmable($('btnRestart'), 'Recommencer', () => startSolo(G.lastSolo.n, G.lastSolo.level));

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
    if (G.hover >= 0) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill(G.paths[G.hover].fill); }
    const sel = G.selected;
    if (sel >= 0) {
      for (const n of reachable(sel)) {
        ctx.fillStyle = st.territories[n].owner === G.me ? 'rgba(255,255,255,0.14)' : 'rgba(255,60,40,0.18)';
        ctx.fill(G.paths[n].fill);
      }
      ctx.lineWidth = 3 / s * DPR;
      ctx.strokeStyle = '#fff';
      ctx.stroke(G.paths[sel].outline);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const R = Math.max(9 * DPR, Math.min(20 * DPR, s * 1.5));
    const font = (px, w) => `${w || 600} ${Math.round(px)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // Flèche de glisser-déposer
    const d = G.drag;
    if (d && d.moved && d.from >= 0 && d.ex != null) {
      const [ax, ay] = toScreen(m.terr[d.from].lx, m.terr[d.from].ly);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3 * DPR; ctx.setLineDash([8 * DPR, 6 * DPR]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(d.ex * DPR, d.ey * DPR); ctx.stroke(); ctx.setLineDash([]);
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
      const isCap = t.owner >= 0 && st.players[t.owner].capital === i;
      if (isCap) { ctx.font = font(R * 1.1); ctx.fillStyle = '#ffd84a'; ctx.fillText('★', x, y - r - R * 0.45); }
      ctx.font = font(R * 0.75, 700); ctx.fillStyle = 'rgba(30,25,15,0.85)';
      ctx.fillText('+' + T.income, x, y + r + R * 0.55);
    });

    // Armées en mouvement
    const extra = G.mode === 'multi' ? Math.min(0.15, (performance.now() - G.lastStateAt) / 1000) : 0;
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

  function updateUI() {
    const st = G.state, m = G.map;
    if (!st || !m || G.me < 0) return;
    const me = st.players[G.me];
    let terr = 0, troops = 0;
    st.territories.forEach(t => { if (t.owner === G.me) { terr++; troops += t.troops; } });
    $('hudGold').textContent = Math.floor(me.gold);
    $('hudIncome').textContent = '+' + E.incomeOf(st, m, G.me) + '/s';
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

    // Barre du bas : sélection + achat
    const sel = G.selected;
    const own = sel >= 0 && st.territories[sel].owner === G.me;
    if (sel >= 0) {
      const t = st.territories[sel];
      const owner = t.owner >= 0 ? st.players[t.owner].name : 'Neutre';
      $('pName').textContent = m.terr[sel].name;
      $('pInfo').textContent = own ? `${t.troops} soldats · +${m.terr[sel].income} or/s · touche une cible` : `${owner} · ${t.troops} soldats · +${m.terr[sel].income} or/s`;
    } else {
      $('pName').textContent = 'Aucune sélection';
      $('pInfo').textContent = 'Clique sur un de tes territoires';
    }
    $('pCost').textContent = '(' + E.CFG.SOLDIER_COST + ' or)';
    const canBuy = own && me.gold >= E.CFG.SOLDIER_COST;
    document.querySelectorAll('[data-buy]').forEach(b => {
      b.disabled = !canBuy || (b.dataset.buy !== 'max' && me.gold < +b.dataset.buy * E.CFG.SOLDIER_COST);
    });

    // Fin de partie / élimination
    if (!G.overDismissed) {
      let title = null;
      if (st.winner != null) title = st.winner === G.me ? '🏆 Victoire !' : st.winner >= 0 ? `Défaite — ${st.players[st.winner].name} a gagné` : 'Match nul';
      else if (!me.alive) title = 'Tu as été éliminé…';
      if (title) { $('overTitle').textContent = title; $('overlay').classList.remove('hidden'); }
    }
  }
  $('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') { G.overDismissed = true; $('overlay').classList.add('hidden'); } });

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------- Boucle ----------
  let last = performance.now(), uiAcc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (G.mode === 'solo' && G.state) E.step(G.state, G.map, dt);
    draw();
    uiAcc += dt;
    if (uiAcc > 0.1) { uiAcc = 0; updateUI(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
