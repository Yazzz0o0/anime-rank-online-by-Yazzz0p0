'use strict';
// Logique de jeu pure : aucune dépendance réseau. Le serveur est la seule autorité.
const crypto = require('crypto');

const CATS = ['force', 'speed', 'abilities', 'iq', 'durability'];
const ROUNDS = CATS.length;
const MAX_REROLLS = 3;
const MODES = [2, 3, 4];

class GameError extends Error {}

const rand = (n) => crypto.randomInt(n);
const pick = (arr) => arr[rand(arr.length)];
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);

function newPlayer(name, pfp = "") {
  return {
    id: crypto.randomUUID().slice(0, 8),
    token: crypto.randomUUID(),
    name,
    pfp: String(pfp || "").slice(0, 3000000),
    ready: false,
    grid: Object.fromEntries(CATS.map((c) => [c, null])),
    rerolls: MAX_REROLLS,
    seen: [],        // tout personnage déjà proposé à ce joueur (jamais reproposé)
    current: null,   // personnage proposé (privé)
    currentRevision: 0, // change uniquement quand CE joueur reçoit un nouveau personnage
    placed: false,
  };
}

function createRoom(code, hostName, mode, pfp = "") {
  if (!MODES.includes(mode)) throw new GameError('Mode invalide (2, 3 ou 4 joueurs).');
  const name = cleanName(hostName);
  if (!name) throw new GameError('Pseudo requis.');
  const host = newPlayer(name, pfp);
  return { code, mode, status: 'lobby', round: 0, hostId: host.id, players: [host], roundOffered: [], createdAt: Date.now(), updatedAt: Date.now() };
}

function addPlayer(room, rawName, pfp = "") {
  const name = cleanName(rawName);
  if (!name) throw new GameError('Pseudo requis.');
  if (room.status !== 'lobby') throw new GameError('La partie a déjà commencé.');
  if (room.players.length >= room.mode) throw new GameError('Salon complet.');
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new GameError('Ce pseudo est déjà pris dans le salon.');
  const p = newPlayer(name, pfp);
  room.players.push(p);
  return p;
}

const getPlayer = (room, id) => {
  const p = room.players.find((x) => x.id === id);
  if (!p) throw new GameError('Joueur inconnu.');
  return p;
};

function setMode(room, pid, mode) {
  if (room.status !== 'lobby') throw new GameError('Le mode ne peut plus changer.');
  if (room.hostId !== pid) throw new GameError("Seul l'hôte peut changer le mode.");
  if (!MODES.includes(mode)) throw new GameError('Mode invalide.');
  if (mode < room.players.length) throw new GameError('Il y a déjà plus de joueurs que ce mode.');
  room.mode = mode;
  room.players.forEach((p) => { p.ready = false; });
}

function setReady(room, pid, value) {
  if (room.status !== 'lobby') throw new GameError('La partie a déjà commencé.');
  getPlayer(room, pid).ready = !!value;
}

const canStart = (room) => room.status === 'lobby' && room.players.length === room.mode && room.players.every((p) => p.ready);

// Tire un personnage jamais vu par ce joueur et non proposé à un autre joueur durant cette manche.
function candidates(room, player, pool) {
  const seen = new Set(player.seen);
  const offered = new Set(room.roundOffered);
  return pool.filter((id) => !seen.has(id) && !offered.has(id));
}
function draw(room, player, pool) {
  const c = candidates(room, player, pool);
  if (!c.length) throw new GameError('Plus assez de personnages dans la base.');
  const id = pick(c);
  player.seen.push(id);
  room.roundOffered.push(id);
  player.currentRevision = (player.currentRevision || 0) + 1;
  return id;
}

function startRound(room, pool) {
  room.round += 1;
  room.roundOffered = [];
  for (const p of shuffle(room.players)) { p.placed = false; p.current = draw(room, p, pool); }
}

function minPool(mode) { return mode * (ROUNDS + MAX_REROLLS); }

function start(room, pool) {
  if (!canStart(room)) throw new GameError('Tous les joueurs doivent être présents et prêts.');
  if (pool.length < minPool(room.mode)) throw new GameError(`Base trop petite : ${minPool(room.mode)} personnages jouables minimum.`);
  room.status = 'playing';
  room.round = 0;
  startRound(room, pool);
}

function reroll(room, pid, pool) {
  if (room.status !== 'playing') throw new GameError('Aucune manche en cours.');
  const p = getPlayer(room, pid);
  if (p.placed || !p.current) throw new GameError('Placement déjà validé pour cette manche.');
  if (p.rerolls <= 0) throw new GameError('Plus de reroll.');
  if (!candidates(room, p, pool).length) throw new GameError('Plus de personnage disponible.');
  p.rerolls -= 1;
  p.current = draw(room, p, pool);
}

function place(room, pid, cat, pool) {
  if (room.status !== 'playing') throw new GameError('Aucune manche en cours.');
  const p = getPlayer(room, pid);
  if (!CATS.includes(cat)) throw new GameError('Catégorie invalide.');
  if (p.placed || !p.current) throw new GameError('Placement déjà validé pour cette manche.');
  if (p.grid[cat] !== null) throw new GameError('Cette case est déjà remplie.');
  if (Object.values(p.grid).includes(p.current)) throw new GameError('Personnage déjà placé.');
  p.grid[cat] = p.current;
  p.current = null;
  p.placed = true;
  if (room.players.every((x) => x.placed)) {
    if (room.round >= ROUNDS) room.status = 'finished';
    else startRound(room, pool);
  }
}

function replay(room, pid) {
  if (room.status !== 'finished' && room.status !== 'abandoned') throw new GameError('La partie n’est pas terminée.');
  if (room.hostId !== pid) throw new GameError("Seul l’hôte peut lancer une revanche.");
  room.status = 'lobby'; room.round = 0; room.roundOffered = [];
  for (const p of room.players) {
    p.ready = false; p.grid = Object.fromEntries(CATS.map((c) => [c, null]));
    p.rerolls = MAX_REROLLS; p.seen = []; p.current = null; p.currentRevision = 0; p.placed = false;
  }
  room.updatedAt = Date.now();
  return room;
}

function cancel(room, pid) {
  if (room.status !== 'lobby' && room.status !== 'playing') throw new GameError('Cette partie est déjà terminée.');
  getPlayer(room, pid);
  room.status = 'cancelled';
  room.updatedAt = Date.now();
  return room;
}

function leave(room, pid, pool) {
  const player = getPlayer(room, pid);
  room.players = room.players.filter((p) => p.id !== pid);
  if (room.hostId === pid && room.players.length) room.hostId = room.players[0].id;
  if (room.players.length < 2) {
    room.status = 'abandoned';
    room.players.forEach((p) => { p.current = null; p.placed = true; });
  } else if (room.status === 'playing' && room.players.every((p) => p.placed)) {
    if (room.round >= ROUNDS) room.status = 'finished';
    else startRound(room, pool);
  }
  room.updatedAt = Date.now();
  return player;
}

// Vue personnalisée : les statistiques restent exclusivement côté serveur pendant la partie.
function viewFor(room, pid, charsById, isConnected) {
  const ids = new Set();
  const me = getPlayer(room, pid);
  if (me.current) ids.add(me.current);
  const players = [me, ...room.players.filter((p) => p.id !== pid)].map((p) => {
    Object.values(p.grid).forEach((id) => id && ids.add(id));
    return { id: p.id, name: p.name, pfp: p.pfp || '', isMe: p.id === pid, ready: p.ready, connected: isConnected(p.id), rerolls: p.rerolls, placed: p.placed, grid: p.grid };
  });
  const chars = {};
  ids.forEach((id) => {
    if (!charsById.has(id)) return;
    const c = charsById.get(id);
    if (room.status === 'finished' || room.status === 'abandoned') chars[id] = c;
    else chars[id] = { id: c.id, name: c.name, anime: c.anime, image: c.image, version: c.version };
  });
  return { code: room.code, mode: room.mode, status: room.status, round: room.round, rounds: ROUNDS, hostId: room.hostId, me: pid, cats: CATS, maxRerolls: MAX_REROLLS, current: me.current, currentRevision: me.currentRevision || 0, players, chars };
}

module.exports = { CATS, ROUNDS, MAX_REROLLS, MODES, GameError, createRoom, addPlayer, setMode, setReady, canStart, start, reroll, place, cancel, replay, leave, viewFor, minPool };
