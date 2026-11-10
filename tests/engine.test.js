import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, ghostAt, ghostsOf, scoreOf, INTERVAL, GRACE, HZ, distance } from '../engine.js';
function random(seed = 123456) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function advance(g, ticks, direction) { for (let i = 0; i < ticks; i++) step(g, typeof direction === 'function' ? direction(i) : direction); }

test('new game has five separated coins and starts with zero score', () => {
  const g = createGame(random());
  assert.equal(g.coins.length, 5); assert.equal(scoreOf(g), 0); assert.equal(g.history.length, 1);
  for (const c of g.coins) { assert.ok(distance(c, g.player) >= 76); assert.ok(c.x >= 42 && c.x <= 598); }
  for (let i = 0; i < g.coins.length; i++) for (let j = i + 1; j < g.coins.length; j++) assert.ok(distance(g.coins[i], g.coins[j]) >= 76);
});
test('movement is cardinal, consistent, and clamped inside the arena', () => {
  const g = createGame(random()); step(g, 'up'); assert.equal(g.player.x, 320); assert.equal(g.player.y, 317.25);
  advance(g, 150, 'right'); assert.equal(g.player.x, 618); assert.equal(g.player.y, 317.25);
  advance(g, 150, 'up'); assert.equal(g.player.y, 22);
});
test('first echo spawns exactly at eight seconds and replays recorded positions', () => {
  const g = createGame(random());
  advance(g, INTERVAL - 1, i => i < 100 ? 'right' : 'down');
  assert.equal(ghostsOf(g).length, 0); step(g, 'left');
  assert.equal(ghostsOf(g).length, 1); assert.equal(ghostAt(g, 1).x, 320); assert.equal(ghostAt(g, 1).solid, false);
  advance(g, 60, 'left');
  assert.equal(ghostAt(g, 1).x, g.history[60].x); assert.equal(ghostAt(g, 1).y, g.history[60].y); assert.equal(ghostAt(g, 1).solid, true);
});
test('stationary player survives spawn grace, then collision ends the run', () => {
  const g = createGame(random()); advance(g, INTERVAL + GRACE - 1);
  assert.equal(g.dead, false); step(g); assert.equal(g.dead, true); assert.ok(g.events.includes('death'));
  const tick = g.tick; step(g, 'right'); assert.equal(g.tick, tick);
});
test('coins score once, replenish, and survival contributes ten points per second', () => {
  const g = createGame(random()); g.coins = [{ ...g.player }]; step(g);
  assert.equal(g.collected, 1); assert.equal(scoreOf(g), 100); assert.equal(g.coins.length, 5);
  advance(g, HZ - 1); assert.equal(g.collected, 1); assert.equal(scoreOf(g), 110);
});
test('multiple echoes preserve independent 8-second delays over a long run', () => {
  const g = createGame(random());
  // Perimeter route has a period different from eight seconds.
  const directions = ['down', 'left', 'up', 'right'];
  advance(g, 24 * HZ, i => i < 108 ? 'up' : i < 216 ? 'right' : directions[Math.floor((i - 216) / 217) % 4]);
  assert.equal(g.dead, false); assert.equal(ghostsOf(g).length, 3);
  for (let n = 1; n <= 3; n++) {
    const echo = ghostAt(g, n), expected = g.history[g.tick - n * INTERVAL];
    assert.equal(echo.x, expected.x); assert.equal(echo.y, expected.y);
  }
});
test('degenerate RNG cannot hang coin placement or overlap starting coins', () => {
  const g = createGame(() => .5); assert.equal(g.coins.length, 5);
  for (const c of g.coins) assert.ok(distance(c, g.player) >= 38);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) assert.ok(distance(g.coins[i], g.coins[j]) >= 38);
});
test('restarts have independent history, score, and coin arrays', () => {
  const a = createGame(random()), b = createGame(random()); step(a, 'left');
  assert.equal(b.tick, 0); assert.equal(b.player.x, 320); assert.notEqual(a.history, b.history); assert.notEqual(a.coins, b.coins);
});
