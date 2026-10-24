'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const G = require('./game');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CHAR_FILE = path.join(DATA_DIR, 'characters.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Personnages (seuls ceux dont les 5 stats sont renseignées sont jouables) ----------
const isPlayable = (c) => c && G.CATS.every((k) => Number.isFinite(c.stats && c.stats[k]));
function loadCharacters() {
  const all = JSON.parse(fs.readFileSync(CHAR_FILE, 'utf8'));
  const playable = all.filter(isPlayable);
  return { all, byId: new Map(playable.map((c) => [c.id, c])), pool: playable.map((c) => c.id) };
}
let DB = loadCharacters();

// ---------- Salons + persistance (écriture atomique, différée) ----------
const rooms = new Map();
try {
  for (const r of JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'))) rooms.set(r.code, r);
} catch { /* premier démarrage */ }
let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const tmp = ROOMS_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify([...rooms.values()]));
      fs.renameSync(tmp, ROOMS_FILE);
    } catch (e) { console.error('Sauvegarde impossible :', e.message); }
  }, 300);
}
setInterval(() => { // nettoyage : salons inactifs depuis 7 jours
  const limit = Date.now() - 7 * 24 * 3600 * 1000;
  for (const [code, r] of rooms) if (r.updatedAt < limit && !(conns.get(code) && conns.get(code).size)) rooms.delete(code);
  saveSoon();
}, 3600 * 1000).unref();

const conns = new Map(); // code -> Map(playerId -> ws)
const isConnected = (code) => (pid) => !!(conns.get(code) && conns.get(code).has(pid));
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, action = null) {
  room.updatedAt = Date.now();
  saveSoon();
  const m = conns.get(room.code);
  if (!m) return;
  for (const [pid, ws] of m) {
    const clientAction = action && action.type === 'reroll' ? (action.pid === pid ? action : null) : action;
    send(ws, { t: 'state', state: G.viewFor(room, pid, DB.byId, isConnected(room.code)), action: clientAction });
  }
}
function attach(ws, room, player) {
  if (!conns.has(room.code)) conns.set(room.code, new Map());
  const old = conns.get(room.code).get(player.id);
  conns.get(room.code).set(player.id, ws);
  ws.ctx = { code: room.code, pid: player.id };
  if (old && old !== ws) { old.ctx = null; old.close(4000, 'Reconnecté ailleurs'); }
  send(ws, { t: 'session', code: room.code, token: player.token, pid: player.id });
}
function detach(ws) {
  if (!ws.ctx) return;
  const { code, pid } = ws.ctx;
  const m = conns.get(code);
  if (m && m.get(pid) === ws) { m.delete(pid); const r = rooms.get(code); if (r) broadcast(r); }
}

// ---------- Messages ----------
function handle(ws, m) {
  if (m.t === 'create') {
    const room = G.createRoom(newCode(), m.name, Number(m.mode), m.pfp);
    rooms.set(room.code, room);
    attach(ws, room, room.players[0]);
    return broadcast(room);
  }
  if (m.t === 'join' || m.t === 'resume') {
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) throw new G.GameError('Salon introuvable.');
    let player = m.token && room.players.find((p) => p.token === m.token);
    if (!player) {
      if (m.t === 'resume') throw new G.GameError('Session expirée.');
      player = G.addPlayer(room, m.name, m.pfp);
    }
    attach(ws, room, player);
    return broadcast(room);
  }
  if (!ws.ctx) throw new G.GameError('Rejoins un salon d\'abord.');
  const room = rooms.get(ws.ctx.code);
  if (!room) throw new G.GameError('Salon introuvable.');
  const pid = ws.ctx.pid;
  if (m.t === 'cancel') {
    G.cancel(room, pid);
    const connsForRoom = conns.get(room.code);
    if (connsForRoom) {
      for (const [playerId, playerWs] of connsForRoom) {
        send(playerWs, { t: 'cancelled', by: pid });
        playerWs.ctx = null;
      }
      conns.delete(room.code);
    }
    rooms.delete(room.code);
    saveSoon();
    return;
  }
  if (m.t === 'leave') {
    const connsForRoom = conns.get(room.code);
    if (connsForRoom && connsForRoom.get(pid) === ws) connsForRoom.delete(pid);
    ws.ctx = null;
    send(ws, { t: 'left' });
    G.leave(room, pid, DB.pool);
    if (!room.players.length) {
      rooms.delete(room.code);
      conns.delete(room.code);
      saveSoon();
      return;
    }
    return broadcast(room);
  }
  switch (m.t) {
    case 'profile': { const p = room.players.find(x => x.id === pid); if (p) { p.name = String(m.name || p.name).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0,20) || p.name; p.pfp = String(m.pfp || '').slice(0,3000000); } break; }
    case 'mode': G.setMode(room, pid, Number(m.mode)); break;
    case 'ready':
      G.setReady(room, pid, !!m.value);
      if (G.canStart(room)) G.start(room, DB.pool);
      break;
    case 'reroll': G.reroll(room, pid, DB.pool); broadcast(room, { type: 'reroll', pid }); return;
    case 'place': G.place(room, pid, String(m.cat), DB.pool); break;
    case 'replay': G.replay(room, pid); break;
    default: throw new G.GameError('Action inconnue.');
  }
  broadcast(room);
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.end('ok'); return; }
  if (url.pathname === '/api/characters') { // recherche par nom ou anime
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const out = DB.all.filter((c) => !q || `${c.name} ${c.anime}`.toLowerCase().includes(q)).slice(0, 100)
      .map((c) => ({ id: c.id, name: c.name, anime: c.anime, image: c.image, version: c.version }));
    // This public endpoint must never leak hidden powers or stats during a live match.
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(out));
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 4 * 1024 * 1024 });
wss.on('connection', (ws) => {
  ws.ctx = null; ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    try { handle(ws, m); } catch (e) {
      if (!(e instanceof G.GameError)) console.error(e);
      send(ws, { t: 'error', msg: e instanceof G.GameError ? e.message : 'Erreur serveur.', fatal: m.t === 'resume' });
    }
  });
  ws.on('close', () => detach(ws));
});
setInterval(() => wss.clients.forEach((ws) => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 30000).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur lancé : http://localhost:${PORT} — ${DB.pool.length} personnages jouables sur ${DB.all.length}`);
    const nets = os.networkInterfaces();
    for (const entries of Object.values(nets)) for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`Accès sur le même Wi-Fi/réseau : http://${net.address}:${PORT}`);
    }
    console.log("Les autres joueurs n'ont pas besoin du dossier du jeu : ils ouvrent simplement l’adresse du serveur dans leur navigateur.");
  });
}
module.exports = { server };
