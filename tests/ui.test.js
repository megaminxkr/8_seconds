// Run the real UI controller against a minimal DOM and a controllable clock.
// This covers lifecycle/input races that the pure simulation tests cannot cover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as engine from '../engine.js';

const source = readFileSync(new URL('../game.js', import.meta.url), 'utf8').replace(/^import .*?;\n/, '');
function setup({ storageFails = false } = {}) {
  class Element {
    constructor(id) { this.id = id; this.listeners = {}; this.style = {}; this.dataset = {}; this.hidden = false; this.attributes = {}; this.textContent = ''; this.classes = new Set(); this.classList = { add: x => this.classes.add(x), remove: x => this.classes.delete(x), toggle: (x, enabled) => enabled ? this.classes.add(x) : this.classes.delete(x) }; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    emit(type, props = {}) { const event = { target: this, preventDefault() {}, ...props }; for (const listener of this.listeners[type] || []) listener(event); }
    focus() {} setPointerCapture() {} setAttribute(k, v) { this.attributes[k] = v; }
    getBoundingClientRect() { return { width: 360 }; }
    getContext() { return new Proxy({}, { get: () => () => {} }); }
  }
  class Button extends Element {}
  const ids = [...readFileSync(new URL('../index.html', import.meta.url), 'utf8').matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const elements = Object.fromEntries(ids.map(id => [id, ['start', 'pause', 'sound'].includes(id) ? new Button(id) : new Element(id)]));
  elements['storage-note'].hidden = true;
  const buttons = ['up','down','left','right'].map(d => { const b = new Button(d); b.dataset.direction = d; return b; });
  const document = new Element('document');
  document.getElementById = id => elements[id];
  document.querySelectorAll = selector => selector === '[data-direction]' ? buttons : buttons.filter(b => b.classes.has('pressed'));
  const window = new Element('window'); window.devicePixelRatio = 2;
  let now = 1000; const stored = new Map();
  const sandbox = { ...engine, document, window, HTMLButtonElement: Button, performance: { now: () => now }, matchMedia: () => ({ matches: false }), ResizeObserver: class { observe() {} }, requestAnimationFrame() {}, localStorage: { getItem: k => { if (storageFails) throw Error('blocked'); return stored.get(k) ?? null; }, setItem: (k, v) => { if (storageFails) throw Error('blocked'); stored.set(k, v); } } };
  const context = vm.createContext(sandbox); vm.runInContext(source, context);
  return { elements, document, window, buttons, stored, read: code => vm.runInContext(code, context), emit: (type, data) => window.emit(type, data), start: () => elements.start.emit('click'), frames(n) { for (let i = 0; i < n; i++) { now += 1000 / 60; sandbox.now = now; vm.runInContext('frame(now)', context); } }, stall(ms) { now += ms; sandbox.now = now; vm.runInContext('frame(now)', context); } };
}

test('pause freezes simulation, resume keeps score, and blur clears held keys', () => {
  const ui = setup(); ui.start(); ui.emit('keydown', { code: 'ArrowRight' }); ui.frames(60);
  assert.ok(ui.read('game.player.x') > 450);
  ui.emit('keydown', { code: 'Escape' }); const tick = ui.read('game.tick'); ui.frames(600);
  assert.equal(ui.read('game.tick'), tick); assert.equal(ui.read('state'), 'paused');
  ui.start(); assert.equal(ui.read('inputs.size'), 0); ui.frames(30); assert.ok(ui.read('game.tick') > tick);
  ui.emit('keydown', { code: 'KeyW' }); ui.window.emit('blur'); assert.equal(ui.read('state'), 'paused'); assert.equal(ui.read('inputs.size'), 0);
});
test('last key wins without diagonal motion, releasing it restores other held key', () => {
  const ui = setup(); ui.start(); ui.emit('keydown', { code: 'ArrowRight' }); ui.emit('keydown', { code: 'ArrowUp' }); ui.frames(30);
  assert.equal(ui.read('game.player.x'), 320); assert.ok(ui.read('game.player.y') < 320);
  ui.emit('keyup', { code: 'ArrowUp' }); const y = ui.read('game.player.y'); ui.frames(30);
  assert.ok(ui.read('game.player.x') > 320); assert.equal(ui.read('game.player.y'), y);
});
test('pointer cancellation and swipe release stop movement', () => {
  const ui = setup(); ui.start(); const right = ui.buttons.find(b => b.dataset.direction === 'right');
  right.emit('pointerdown', { pointerId: 1 }); ui.frames(20); right.emit('pointercancel', { pointerId: 1 });
  const x = ui.read('game.player.x'); ui.frames(20); assert.equal(ui.read('game.player.x'), x);
  ui.elements.game.emit('pointerdown', { pointerId: 2, clientX: 100, clientY: 100 });
  ui.elements.game.emit('pointermove', { pointerId: 2, clientX: 100, clientY: 130 }); ui.frames(20);
  assert.ok(ui.read('game.player.y') > 320); ui.elements.game.emit('pointerup', { pointerId: 2 }); assert.equal(ui.read('inputs.size'), 0);
});
test('game over stores best, replay resets run while retaining record', () => {
  const ui = setup(); ui.start(); ui.frames(530);
  assert.equal(ui.read('state'), 'over'); assert.equal(ui.read('game.tick'), 525);
  assert.equal(ui.elements['result-score'].textContent, '80'); assert.equal(ui.stored.get('eight-seconds.best.v1'), '80');
  ui.start(); assert.equal(ui.read('game.tick'), 0); assert.equal(ui.read('game.collected'), 0); assert.equal(ui.read('best'), 80); assert.equal(ui.elements.overlay.hidden, true);
});
test('blocked browser storage never prevents gameplay or the result screen', () => {
  const ui = setup({ storageFails: true }); assert.equal(ui.elements['storage-note'].hidden, false);
  ui.start(); ui.frames(530); assert.equal(ui.read('state'), 'over'); assert.equal(ui.read('best'), 80);
});
test('long frame stalls and hidden tabs automatically pause without advancing', () => {
  const ui = setup(); ui.start(); ui.frames(20); const tick = ui.read('game.tick'); ui.stall(1000);
  assert.equal(ui.read('state'), 'paused'); assert.equal(ui.read('game.tick'), tick);
  ui.start(); ui.document.hidden = true; ui.document.emit('visibilitychange'); assert.equal(ui.read('state'), 'paused');
});
test('Space on native buttons does not also trigger the global pause shortcut', () => {
  const ui = setup(); ui.start(); ui.emit('keydown', { code: 'Space', target: ui.elements.sound }); assert.equal(ui.read('state'), 'running');
  ui.emit('keydown', { code: 'Space', target: ui.elements.game }); assert.equal(ui.read('state'), 'paused');
});
