// Simulation uses integer ticks: replay stays exact regardless of display refresh rate.
export const SIZE = 640;
export const HZ = 60;
export const INTERVAL = 8 * HZ;
export const GRACE = 45;
export const RADIUS = 10;
const SPEED = 165 / HZ;
const MARGIN = 22;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = v => Math.max(MARGIN, Math.min(SIZE - MARGIN, v));
export function scoreOf(game) { return Math.floor(game.tick / HZ) * 10 + game.collected * 100; }
export function ghostAt(game, number) {
  const age = game.tick - number * INTERVAL;
  if (age < 0) return null;
  const point = game.history[age];
  return { ...point, number, age, solid: age >= GRACE };
}
export function ghostsOf(game) {
  return Array.from({ length: Math.floor(game.tick / INTERVAL) }, (_, i) => ghostAt(game, i + 1));
}
export function addCoin(game) {
  const threats = [game.player, ...ghostsOf(game), ...game.coins];
  // Bounded search also handles a crowded board or a degenerate RNG.
  let best = null, clearance = -1;
  for (let i = 0; i < 100; i++) {
    const p = { x: 42 + game.random() * (SIZE - 84), y: 42 + game.random() * (SIZE - 84) };
    const gap = Math.min(...threats.map(t => distance(p, t)));
    if (gap > clearance) { best = p; clearance = gap; }
    if (gap >= 76) break;
  }
  // Try a deterministic grid if randomness did not find a safe point.
  if (clearance < 38) {
    for (let x = 48; x < SIZE; x += 64) for (let y = 48; y < SIZE; y += 64) {
      const p = { x, y }, gap = Math.min(...threats.map(t => distance(p, t)));
      if (gap > clearance) { best = p; clearance = gap; }
    }
  }
  if (best && clearance >= 38) game.coins.push(best);
}
export function createGame(random = Math.random) {
  const player = { x: SIZE / 2, y: SIZE / 2 };
  const game = { tick: 0, player, history: [{ ...player }], coins: [], collected: 0, dead: false, random, events: [] };
  for (let i = 0; i < 5; i++) addCoin(game);
  return game;
}
export function step(game, direction = null) {
  game.events = [];
  if (game.dead) return;
  const vectors = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const [dx, dy] = vectors[direction] || [0, 0];
  game.player = { x: clamp(game.player.x + dx * SPEED), y: clamp(game.player.y + dy * SPEED) };
  game.tick++;
  game.history.push({ ...game.player });
  if (game.tick % INTERVAL === 0) game.events.push('echo');
  if (ghostsOf(game).some(g => g.solid && distance(g, game.player) <= RADIUS * 2)) {
    game.dead = true;
    game.events.push('death');
    return;
  }
  const remaining = game.coins.filter(c => distance(c, game.player) > RADIUS + 8);
  const count = game.coins.length - remaining.length;
  game.coins = remaining;
  if (count) { game.collected += count; game.events.push('coin'); }
  while (game.coins.length < 5) {
    const before = game.coins.length;
    addCoin(game);
    if (before === game.coins.length) break;
  }
}
