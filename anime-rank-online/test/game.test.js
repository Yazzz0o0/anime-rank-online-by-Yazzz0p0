'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../game');
const chars = require('../data/characters.json').filter((c) => c.stats);
const pool = chars.map((c) => c.id);
const byId = new Map(chars.map((c) => [c.id, c]));

function lobby(n) {
  const room = G.createRoom('TEST1', 'P0', n);
  for (let i = 1; i < n; i++) G.addPlayer(room, 'P' + i);
  room.players.forEach((p) => G.setReady(room, p.id, true));
  return room;
}
const ids = (room) => room.players.map((p) => p.id);

for (const n of [2, 3, 4]) {
  test(`mode ${n} joueurs : partie complète, règles respectées`, () => {
    for (let game = 0; game < 50; game++) {
      const room = lobby(n);
      assert.ok(G.canStart(room));
      G.start(room, pool);
      const seenBy = new Map(room.players.map((p) => [p.id, new Set()]));
      let guard = 0;
      while (room.status === 'playing' && guard++ < 100) {
        // persos de la manche : tous distincts entre joueurs
        const cur = room.players.map((p) => p.current);
        assert.strictEqual(new Set(cur).size, n, 'persos distincts dans la manche');
        for (const p of room.players) {
          // reroll aléatoire (jamais plus de 3 au total)
          while (p.rerolls > 0 && Math.random() < 0.6) {
            const before = p.current;
            G.reroll(room, p.id, pool);
            assert.notStrictEqual(p.current, before);
          }
        }
        // tous distincts même après rerolls ; jamais déjà vus par le même joueur
        const after = room.players.map((p) => p.current);
        assert.strictEqual(new Set(after).size, n);
        for (const p of room.players) {
          assert.ok(!Object.values(p.grid).includes(p.current));
          const dup = p.seen.length !== new Set(p.seen).size;
          assert.ok(!dup, 'aucun personnage reproposé');
        }
        // placement ; la manche n'avance que quand tous ont validé
        const round = room.round;
        room.players.forEach((p, i) => {
          const free = G.CATS.filter((c) => p.grid[c] === null);
          G.place(room, p.id, free[Math.floor(Math.random() * free.length)], pool);
          if (i < n - 1) assert.strictEqual(room.round, round, 'pas de manche suivante avant tous');
        });
      }
      assert.strictEqual(room.status, 'finished');
      for (const p of room.players) {
        assert.ok(Object.values(p.grid).every(Boolean));
        assert.strictEqual(new Set(Object.values(p.grid)).size, 5);
        assert.ok(p.rerolls >= 0 && p.rerolls <= 3);
      }
    }
  });
}

test('un reroll ne change que le personnage du joueur qui clique', () => {
  const room = lobby(2);
  G.start(room, pool);
  const [a, b] = room.players;
  const beforeA = a.current, beforeB = b.current;
  G.reroll(room, a.id, pool);
  assert.notStrictEqual(a.current, beforeA);
  assert.strictEqual(b.current, beforeB);
  assert.strictEqual(a.rerolls, 2);
  assert.strictEqual(b.rerolls, 3);
});

test('exactement 3 rerolls au départ, le 4e est refusé', () => {
  const room = lobby(2); G.start(room, pool);
  const p = room.players[0];
  assert.strictEqual(p.rerolls, 3);
  G.reroll(room, p.id, pool); G.reroll(room, p.id, pool); G.reroll(room, p.id, pool);
  assert.strictEqual(p.rerolls, 0);
  assert.throws(() => G.reroll(room, p.id, pool), G.GameError);
});

test('rerolls non renouvelés entre manches', () => {
  const room = lobby(2); G.start(room, pool);
  G.reroll(room, room.players[0].id, pool);
  room.players.forEach((p) => G.place(room, p.id, 'force', pool));
  assert.strictEqual(room.round, 2);
  assert.strictEqual(room.players[0].rerolls, 2);
});

test('placement définitif : double placement, case occupée, reroll après placement refusés', () => {
  const room = lobby(2); G.start(room, pool);
  const [a, b] = room.players;
  G.place(room, a.id, 'force', pool);
  assert.throws(() => G.place(room, a.id, 'speed', pool), G.GameError);
  assert.throws(() => G.reroll(room, a.id, pool), G.GameError);
  G.place(room, b.id, 'force', pool);
  assert.throws(() => G.place(room, a.id, 'force', pool), G.GameError, 'case occupée');
  assert.throws(() => G.place(room, a.id, 'nimporte', pool), G.GameError);
});

test('vue : les personnages placés par les adversaires et leur catégorie sont visibles', () => {
  const room = lobby(2); G.start(room, pool);
  const [a, b] = room.players;
  const cat = 'force';
  const placed = b.current;
  G.place(room, b.id, cat, pool);
  const v = G.viewFor(room, a.id, byId, () => true);
  const opponent = v.players.find((p) => p.id === b.id);
  assert.equal(opponent.grid[cat], placed);
  assert.equal(v.chars[placed].name, byId.get(placed).name);
  assert.equal(v.chars[b.current] && v.chars[b.current].name, undefined);
});

test('vue : le personnage non validé des autres reste privé', () => {
  const room = lobby(3); G.start(room, pool);
  const [a, b, c] = room.players;
  const v = G.viewFor(room, a.id, byId, () => true);
  assert.deepStrictEqual(Object.keys(v.chars), [a.current]);
  const json = JSON.stringify(v);
  assert.ok(!json.includes(b.current) && !json.includes(c.current) && !json.includes(b.token));
});

test('salon : complet, pseudo en double, mode, démarrage uniquement si prêts', () => {
  const room = G.createRoom('T', 'Host', 2);
  assert.throws(() => G.addPlayer(room, 'host'), G.GameError);
  G.addPlayer(room, 'B');
  assert.throws(() => G.addPlayer(room, 'C'), G.GameError);
  assert.throws(() => G.start(room, pool), G.GameError);
  G.setMode(room, room.hostId, 3);
  assert.throws(() => G.setMode(room, room.players[1].id, 4), G.GameError);
  assert.throws(() => G.setMode(room, room.hostId, 5), G.GameError);
});

test('base trop petite : démarrage refusé', () => {
  const room = lobby(4);
  assert.throws(() => G.start(room, pool.slice(0, 10)), G.GameError);
});


test('les statistiques et compétences sont cachées pendant la partie puis révélées à la fin', () => {
  const room = lobby(2); G.start(room, pool);
  const player = room.players[0];
  const live = G.viewFor(room, player.id, byId, () => true);
  const current = live.chars[player.current];
  assert.ok(current, 'personnage courant visible');
  assert.equal(current.stats, undefined);
  assert.equal(current.powers, undefined);
  assert.equal(current.description, undefined);
  while (room.status === 'playing') {
    for (const p of room.players) {
      const cat = G.CATS.find((candidate) => p.grid[candidate] === null);
      G.place(room, p.id, cat, pool);
    }
  }
  const finished = G.viewFor(room, player.id, byId, () => true);
  assert.equal(finished.status, 'finished');
  const placedId = player.grid.force;
  assert.ok(finished.chars[placedId].stats, 'les stats sont disponibles après la partie');
});

test('annuler une partie marque le salon comme annulé sans modifier les grilles', () => {
  const room = lobby(2);
  G.start(room, pool);
  const pid = room.players[0].id;
  const before = room.players.map((p) => ({ id: p.id, grid: { ...p.grid }, current: p.current }));
  G.cancel(room, pid);
  assert.equal(room.status, 'cancelled');
  assert.deepEqual(room.players.map((p) => ({ id: p.id, grid: { ...p.grid }, current: p.current })), before);
});

test('quitter une partie transfère l’hôte et termine proprement si moins de deux joueurs restent', () => {
  const room = lobby(3); G.start(room, pool);
  const [host, second, third] = room.players;
  G.leave(room, host.id, pool);
  assert.equal(room.players.length, 2);
  assert.equal(room.hostId, second.id);
  assert.equal(room.status, 'playing');
  G.leave(room, second.id, pool);
  assert.equal(room.players.length, 1);
  assert.equal(room.status, 'abandoned');
  assert.equal(room.players[0].current, null);
});
