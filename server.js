// Serveur multijoueur sans dépendance : fichiers statiques + SSE (serveur → client) + POST (client → serveur).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Engine = require('./shared/engine.js');

const PORT = process.env.PORT || 3000;
const TICK = 0.1;
const MAX_PLAYERS = 8;
const rooms = new Map();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const base = p.startsWith('/shared/') ? __dirname : path.join(__dirname, 'public');
  const file = path.normalize(path.join(base, p));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function newCode() {
  let c;
  do c = Math.random().toString(36).slice(2, 7).toUpperCase(); while (rooms.has(c));
  return c;
}

function send(client, event, data) {
  client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room, event, data) {
  for (const c of room.clients) send(c, event, data);
}

function lobbyInfo(room) {
  return { code: room.code, host: room.host, opts: room.opts, players: room.players.map(p => ({ id: p.id, name: p.name, bot: p.bot })), started: !!room.game };
}

function startGame(room) {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const players = room.players.map(p => ({ id: p.id, name: p.name, bot: p.bot }));
  const opts = Engine.resolveOpts(room.opts, players.length);
  const map = Engine.generateMap(seed, opts);
  const state = Engine.createGame(map, players, seed ^ 0x5bd1e995, opts);
  room.game = { seed, map, state, opts };
  broadcast(room, 'start', { seed, players, opts });
  room.timer = setInterval(() => {
    Engine.step(state, map, TICK);
    broadcast(room, 'state', state);
    if (state.winner != null) { clearInterval(room.timer); room.timer = null; }
  }, TICK * 1000);
}

async function api(req, res, route) {
  const body = req.method === 'POST' ? await readBody(req) : {};
  const name = String(body.name || 'Joueur').slice(0, 16);

  if (route === 'create') {
    const code = newCode();
    const id = crypto.randomUUID(), token = crypto.randomUUID();
    const o = body.opts || {};
    const opts = { map: o.map, size: o.size, speed: o.speed, startGold: o.startGold, buildings: o.buildings, fog: o.fog };
    const room = { code, host: id, opts, players: [{ id, name, bot: false, token }], clients: [], game: null, timer: null, lastActive: Date.now() };
    rooms.set(code, room);
    return json(res, 200, { code, id, token });
  }

  const code = String(body.code || new URL(req.url, 'http://x').searchParams.get('code') || '').toUpperCase();
  const room = rooms.get(code);
  if (!room) return json(res, 404, { error: 'Partie introuvable' });
  room.lastActive = Date.now();
  const token = body.token || new URL(req.url, 'http://x').searchParams.get('token');
  const me = room.players.find(p => p.token && p.token === token);

  if (route === 'join') {
    if (room.game) return json(res, 400, { error: 'La partie a déjà commencé' });
    if (room.players.length >= MAX_PLAYERS) return json(res, 400, { error: 'Partie pleine' });
    const id = crypto.randomUUID(), tok = crypto.randomUUID();
    room.players.push({ id, name, bot: false, token: tok });
    broadcast(room, 'lobby', lobbyInfo(room));
    return json(res, 200, { code, id, token: tok });
  }

  if (route === 'events') {
    if (!me) return json(res, 403, { error: 'Jeton invalide' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const client = { res, id: me.id };
    room.clients.push(client);
    send(client, 'lobby', lobbyInfo(room));
    if (room.game) {
      send(client, 'start', { seed: room.game.seed, players: room.players.map(p => ({ id: p.id, name: p.name, bot: p.bot })), opts: room.game.opts });
      send(client, 'state', room.game.state);
    }
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); room.clients = room.clients.filter(c => c !== client); });
    return;
  }

  if (!me) return json(res, 403, { error: 'Jeton invalide' });

  if (route === 'addbot' || route === 'kick' || route === 'start') {
    if (me.id !== room.host) return json(res, 403, { error: "Seul l'hôte peut faire ça" });
    if (room.game) return json(res, 400, { error: 'Déjà commencée' });
    if (route === 'addbot') {
      if (room.players.length >= MAX_PLAYERS) return json(res, 400, { error: 'Partie pleine' });
      const level = ['easy', 'normal', 'hard'].includes(body.level) ? body.level : 'normal';
      const n = room.players.filter(p => p.bot).length + 1;
      room.players.push({ id: crypto.randomUUID(), name: `Bot ${n}`, bot: level });
    } else if (route === 'kick') {
      room.players = room.players.filter(p => p.id !== body.id || p.id === room.host);
    } else {
      if (room.players.length < 2) return json(res, 400, { error: 'Il faut au moins 2 joueurs' });
      startGame(room);
      return json(res, 200, { ok: true });
    }
    broadcast(room, 'lobby', lobbyInfo(room));
    return json(res, 200, { ok: true });
  }

  if (route === 'action') {
    if (!room.game) return json(res, 400, { error: 'Pas commencée' });
    const pi = room.players.indexOf(me);
    const ok = Engine.applyAction(room.game.state, room.game.map, pi, body.action);
    return json(res, 200, { ok });
  }

  json(res, 404, { error: 'Route inconnue' });
}

http.createServer((req, res) => {
  const m = req.url.match(/^\/api\/(\w+)/);
  if (m) api(req, res, m[1]).catch((e) => { console.error(e); json(res, 500, { error: 'Erreur serveur' }); });
  else serveStatic(req, res);
}).listen(PORT, () => console.log(`Battleworlds sur http://localhost:${PORT}`));

// Nettoyage des parties inactives
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.clients.length === 0 && now - room.lastActive > 10 * 60 * 1000) {
      if (room.timer) clearInterval(room.timer);
      rooms.delete(code);
    }
  }
}, 60 * 1000);
