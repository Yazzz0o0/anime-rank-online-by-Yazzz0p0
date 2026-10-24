'use strict';
// Test bout en bout : vrai serveur HTTP/WebSocket, clients WebSocket distincts (Node >= 22 : WebSocket global).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-'));
fs.copyFileSync(path.join(__dirname, '../data/characters.json'), path.join(dir, 'characters.json'));
process.env.DATA_DIR = dir;
const { server } = require('../server');

class Client {
  constructor(url, name) { this.name = name; this.state = null; this.errors = []; this.token = null; this.url = url; }
  open() {
    return new Promise((res) => {
      this.ws = new WebSocket(this.url);
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'state') this.state = m.state;
        if (m.t === 'session') { this.token = m.token; this.code = m.code; }
        if (m.t === 'error') this.errors.push(m.msg);
        this.tick && this.tick();
      };
      this.ws.onopen = res;
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  until(pred) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout ' + this.name + ' ' + JSON.stringify(this.errors))), 4000);
      const check = () => { if (this.state && pred(this.state)) { clearTimeout(t); this.tick = null; res(this.state); } };
      this.tick = check; check();
    });
  }
}

let url;
test.before(() => new Promise((r) => server.listen(0, () => { url = `ws://localhost:${server.address().port}`; r(); })));
test.after(() => { server.close(); server.closeAllConnections && server.closeAllConnections(); setTimeout(() => process.exit(0), 100).unref(); });

for (const n of [2, 3, 4]) {
  test(`${n} clients distants jouent une partie complète`, async () => {
    const cs = [];
    for (let i = 0; i < n; i++) { const c = new Client(url, 'J' + i); await c.open(); cs.push(c); }
    cs[0].send({ t: 'create', name: 'J0', mode: n });
    await cs[0].until((s) => s.code);
    for (let i = 1; i < n; i++) { cs[i].send({ t: 'join', name: 'J' + i, code: cs[0].code.toLowerCase() }); await cs[i].until((s) => s.players.length === i + 1); }
    for (const c of cs) c.send({ t: 'ready', value: true });
    await Promise.all(cs.map((c) => c.until((s) => s.status === 'playing')));

    for (let round = 1; round <= 5; round++) {
      await Promise.all(cs.map((c) => c.until((s) => s.round === round && s.current)));
      const cur = cs.map((c) => c.state.current);
      assert.strictEqual(new Set(cur).size, n, 'personnages distincts');
      for (const c of cs) { // vie privée : seuls mes persos non validés / les placements publics
        const placed = new Set(c.state.players.flatMap((p) => Object.values(p.grid)).filter(Boolean));
        assert.ok(c.state.chars[c.state.current], 'je connais mon personnage');
        const extra = Object.keys(c.state.chars).filter((id) => !placed.has(id) && id !== c.state.current);
        assert.deepStrictEqual(extra, [], 'aucun personnage non validé d\'un autre joueur');
      }
      cs.forEach((c) => {
        const me = c.state.players.find((p) => p.isMe);
        const free = c.state.cats.filter((k) => !me.grid[k]);
        c.send({ t: 'place', cat: free[0] });
      });
    }
    await Promise.all(cs.map((c) => c.until((s) => s.status === 'finished')));
    for (const c of cs) assert.ok(c.state.players.every((p) => Object.values(p.grid).every(Boolean)));
    cs.forEach((c) => c.ws.close());
  });
}

test('reconnexion : la progression est conservée et les autres attendent', async () => {
  const a = new Client(url, 'A'), b = new Client(url, 'B');
  await a.open(); await b.open();
  a.send({ t: 'create', name: 'A', mode: 2 }); await a.until((s) => s.code);
  b.send({ t: 'join', name: 'B', code: a.code }); await b.until((s) => s.players.length === 2);
  a.send({ t: 'ready', value: true }); b.send({ t: 'ready', value: true });
  await a.until((s) => s.status === 'playing');
  a.send({ t: 'reroll' }); await a.until((s) => s.players[0].rerolls === 2);
  const card = a.state.current, token = a.token;
  a.ws.close();
  await b.until((s) => s.players.find((p) => !p.isMe && !p.connected));
  b.send({ t: 'place', cat: 'force' });
  await b.until((s) => s.players[0].placed);
  assert.strictEqual(b.state.round, 1, 'la manche attend le joueur déconnecté');
  const a2 = new Client(url, 'A2'); await a2.open();
  a2.send({ t: 'resume', code: a.code, token });
  const s = await a2.until((st) => st.me && st.players[0].isMe);
  assert.strictEqual(s.current, card); assert.strictEqual(s.players[0].rerolls, 2);
  a2.send({ t: 'reroll' }); await a2.until((st) => st.players[0].rerolls === 1);
  a2.send({ t: 'place', cat: 'force' }); await a2.until((st) => st.round === 2);
  const c = new Client(url, 'C'); await c.open();
  c.send({ t: 'resume', code: a.code, token: 'faux' });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(c.errors.length, 'faux jeton refusé');
  [a2, b, c].forEach((x) => x.ws.close());
});

test('triche : un client ne peut pas agir sans session ni rerolls illimités', async () => {
  const x = new Client(url, 'X'); await x.open();
  x.send({ t: 'reroll' }); x.send({ t: 'place', cat: 'force' });
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(x.errors.length, 2);
  x.ws.close();
});
