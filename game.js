import { SIZE, HZ, INTERVAL, GRACE, createGame, step, ghostsOf, scoreOf } from './engine.js';

const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let game = createGame(), state = 'ready', best = 0, sound = false, audio = null;
let accumulator = 0, lastFrame = 0, toastUntil = 0, particles = [], pulse = 0;
const inputs = new Map();
const keys = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
const storeKey = 'eight-seconds.best.v1';
try {
  const value = Number(localStorage.getItem(storeKey));
  best = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
} catch { $('storage-note').hidden = false; }
$('best').textContent = best.toLocaleString();

function clearInputs() {
  inputs.clear();
  document.querySelectorAll('.pressed').forEach(b => b.classList.remove('pressed'));
  swipe = null;
}
function setInput(id, direction) {
  inputs.delete(id);
  inputs.set(id, direction);
}
function direction() { return [...inputs.values()].at(-1) || null; }
function announce(message, seconds = 2) {
  $('toast').textContent = message;
  toastUntil = performance.now() + seconds * 1000;
}
function initAudio() {
  if (!sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch { sound = false; updateSound(); }
}
function beep(frequency, duration, type = 'sine', volume = .04) {
  if (!sound || !audio || audio.state !== 'running') return;
  try {
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } catch { /* Audio is optional: never interrupt the game. */ }
}
function updateSound() {
  $('sound').textContent = `サウンド ${sound ? 'ON' : 'OFF'}`;
  $('sound').setAttribute('aria-pressed', String(sound));
}
$('sound').addEventListener('click', () => { sound = !sound; initAudio(); updateSound(); beep(520, .12); });

function showOverlay(mode) {
  $('overlay').hidden = false;
  $('overlay').dataset.mode = mode;
  $('result').hidden = mode !== 'over';
  if (mode === 'paused') {
    $('overlay-tag').textContent = 'TAKE A BREATH';
    $('overlay-title').textContent = 'ひと休み。';
    $('overlay-copy').textContent = '時間も、過去の自分も、止まっています。';
    $('start').innerHTML = 'つづける <span>↗</span>';
    $('overlay-hint').textContent = 'Space / Esc でも再開できます';
  } else if (mode === 'over') {
    const score = scoreOf(game), record = score > best;
    if (record) {
      best = score;
      $('best').textContent = best.toLocaleString();
      try { localStorage.setItem(storeKey, String(best)); } catch { $('storage-note').hidden = false; }
    }
    $('overlay-tag').textContent = record ? 'NEW PERSONAL BEST' : 'YOUR PAST CAUGHT YOU';
    $('overlay-title').textContent = '過去の自分に、つかまった。';
    $('overlay-title').style.fontSize = 'clamp(18px, 3vw, 25px)';
    $('overlay-copy').textContent = record ? '自己ベスト更新。次は、もっと先へ。' : '次の一歩が、8秒後を変える。';
    $('result-score').textContent = score.toLocaleString();
    $('result-detail').textContent = `${(game.tick / HZ).toFixed(1)}秒 生存 / コイン ${game.collected}枚 / 敵 ${ghostsOf(game).length}体`;
    $('start').innerHTML = 'もう一度プレイ <span>↗</span>';
    $('overlay-hint').textContent = '同じ道に戻らず、大きく動いてみよう。';
  }
  $('start').focus({ preventScroll: true });
}
function start() {
  if (state === 'running') return;
  initAudio();
  if (state !== 'paused') { game = createGame(); particles = []; pulse = 0; }
  state = 'running'; clearInputs(); accumulator = 0; lastFrame = performance.now();
  $('overlay').hidden = true;
  $('overlay-title').style.fontSize = '';
  $('pause').disabled = false;
  $('pause').textContent = 'Ⅱ';
  $('pause').setAttribute('aria-label', '一時停止');
  toastUntil = 0;
  canvas.focus({ preventScroll: true });
  updateHud();
}
function pause() {
  if (state !== 'running') return;
  state = 'paused'; clearInputs(); accumulator = 0;
  $('pause').textContent = '▷';
  $('pause').setAttribute('aria-label', '再開');
  showOverlay('paused');
}
function togglePause() { if (state === 'running') pause(); else if (state === 'paused') start(); }
$('start').addEventListener('click', start);
$('pause').addEventListener('click', togglePause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', () => { pause(); clearInputs(); });
window.addEventListener('keydown', event => {
  if (keys[event.code]) {
    if (state !== 'running') return;
    event.preventDefault();
    if (!event.repeat) setInput(event.code, keys[event.code]);
  } else if (event.code === 'Escape' || event.code === 'Space') {
    // Let Space activate a focused native button instead of firing two actions.
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    if (!event.repeat) togglePause();
  }
});
window.addEventListener('keyup', event => { inputs.delete(event.code); });

document.querySelectorAll('[data-direction]').forEach(button => {
  button.addEventListener('pointerdown', event => {
    if (state !== 'running') return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    setInput(`pointer-${event.pointerId}`, button.dataset.direction);
    button.classList.add('pressed');
  });
  const release = event => { inputs.delete(`pointer-${event.pointerId}`); button.classList.remove('pressed'); };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
  button.addEventListener('keydown', event => {
    if (state === 'running' && (event.code === 'Space' || event.code === 'Enter')) {
      event.preventDefault();
      if (!event.repeat) setInput(`button-${button.dataset.direction}`, button.dataset.direction);
      button.classList.add('pressed');
    }
  });
  button.addEventListener('keyup', event => {
    if (event.code === 'Space' || event.code === 'Enter') { inputs.delete(`button-${button.dataset.direction}`); button.classList.remove('pressed'); }
  });
  button.addEventListener('blur', () => { inputs.delete(`button-${button.dataset.direction}`); button.classList.remove('pressed'); });
});
let swipe = null;
canvas.addEventListener('pointerdown', event => {
  if (state !== 'running' || swipe) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
canvas.addEventListener('pointermove', event => {
  if (!swipe || swipe.id !== event.pointerId || state !== 'running') return;
  const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
  if (Math.hypot(dx, dy) < 8) return;
  setInput('swipe', Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  swipe.x = event.clientX; swipe.y = event.clientY;
});
function endSwipe(event) { if (swipe?.id === event.pointerId) { swipe = null; inputs.delete('swipe'); } }
canvas.addEventListener('pointerup', endSwipe);
canvas.addEventListener('pointercancel', endSwipe);
canvas.addEventListener('lostpointercapture', endSwipe);

function updateHud() {
  $('score').textContent = String(scoreOf(game)).padStart(4, '0');
  $('time').textContent = (game.tick / HZ).toFixed(1);
  $('echoes').textContent = String(Math.floor(game.tick / INTERVAL)).padStart(2, '0');
  const left = INTERVAL - game.tick % INTERVAL;
  $('next').textContent = (left / HZ).toFixed(1);
  $('progress').style.transform = `scaleX(${left / INTERVAL})`;
  $('progress').style.background = left < HZ * 2 ? '#ff8a79' : '#bbf7a0';
}
function burst(point) {
  if (reducedMotion) return;
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI * 2 * i / 10;
    particles.push({ x: point.x, y: point.y, dx: Math.cos(angle) * 2.5, dy: Math.sin(angle) * 2.5, life: 1 });
  }
}
function tick() {
  step(game, direction());
  for (const event of game.events) {
    if (event === 'coin') { beep(880, .12); burst(game.player); }
    if (event === 'echo') { beep(220, .3, 'triangle'); announce(`ECHO ${String(Math.floor(game.tick / INTERVAL)).padStart(2, '0')} — 過去の自分が現れた`); pulse = 1; }
    if (event === 'death') {
      state = 'over'; clearInputs(); beep(110, .4, 'triangle', .07);
      $('pause').disabled = true; toastUntil = 0;
      showOverlay('over');
    }
  }
}
function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}
function trail(end, length, color) {
  const begin = Math.max(0, end - length);
  if (end < 1) return;
  ctx.beginPath();
  ctx.moveTo(game.history[begin].x, game.history[begin].y);
  for (let i = begin + 1; i <= end; i++) ctx.lineTo(game.history[i].x, game.history[i].y);
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
}
function draw(now, elapsed) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#171f1a'; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#344235';
  for (let x = 20; x < SIZE; x += 24) for (let y = 20; y < SIZE; y += 24) { ctx.beginPath(); ctx.arc(x, y, .75, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = '#334434'; ctx.lineWidth = 1;
  for (const [x, y, dx, dy] of [[12,12,1,1],[628,12,-1,1],[12,628,1,-1],[628,628,-1,-1]]) {
    ctx.beginPath(); ctx.moveTo(x, y + dy * 16); ctx.lineTo(x, y); ctx.lineTo(x + dx * 16, y); ctx.stroke();
  }
  for (const coin of game.coins) {
    const wave = reducedMotion || state !== 'running' ? 1 : 1 + Math.sin(now / 300 + coin.x) * .12;
    ctx.strokeStyle = '#f6d98224'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(coin.x, coin.y, 15 * wave, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#f6d982'; ctx.beginPath(); ctx.moveTo(coin.x, coin.y - 7); ctx.lineTo(coin.x + 5, coin.y); ctx.lineTo(coin.x, coin.y + 7); ctx.lineTo(coin.x - 5, coin.y); ctx.closePath(); ctx.fill();
  }
  const remaining = INTERVAL - game.tick % INTERVAL;
  if (remaining <= HZ * 1.5 && state === 'running') {
    const origin = game.history[0];
    ctx.setLineDash([3, 5]); ctx.strokeStyle = '#ff8a7988'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(origin.x, origin.y, 24, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffad9e'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText('NEXT ECHO', origin.x, origin.y - 34);
  }
  for (const ghost of ghostsOf(game)) {
    trail(ghost.age, 22, '#ff8a7935');
    ctx.globalAlpha = ghost.solid ? 1 : .35 + (ghost.age / GRACE) * .4;
    if (!ghost.solid) { ctx.strokeStyle = '#ff8a7980'; ctx.beginPath(); ctx.arc(ghost.x, ghost.y, 25 - 10 * ghost.age / GRACE, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = '#ff8a79'; ctx.fillStyle = '#50312b'; ctx.lineWidth = 2;
    roundedRect(ghost.x - 10, ghost.y - 10, 20, 20, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffb8a5'; ctx.fillRect(ghost.x - 4, ghost.y - 2, 2, 3); ctx.fillRect(ghost.x + 2, ghost.y - 2, 2, 3);
    ctx.globalAlpha = 1;
  }
  trail(game.tick, 28, '#bbf7a047');
  ctx.shadowColor = '#bbf7a0'; ctx.shadowBlur = reducedMotion ? 0 : 14;
  ctx.fillStyle = game.dead ? '#ff8a79' : '#bbf7a0';
  roundedRect(game.player.x - 10, game.player.y - 10, 20, 20, 5); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = '#28492b'; ctx.fillRect(game.player.x - 4, game.player.y - 2, 2, 3); ctx.fillRect(game.player.x + 2, game.player.y - 2, 2, 3);
  if (state === 'ready') {
    ctx.fillStyle = '#bbf7a0'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText('YOU', game.player.x, game.player.y - 23);
  }
  const delta = state === 'running' ? elapsed * 60 : 0;
  for (const particle of particles) {
    particle.x += particle.dx * delta; particle.y += particle.dy * delta; particle.life -= .035 * delta;
    ctx.globalAlpha = Math.max(0, particle.life); ctx.fillStyle = '#f6d982'; ctx.fillRect(particle.x, particle.y, 3, 3);
  }
  ctx.globalAlpha = 1; particles = particles.filter(p => p.life > 0);
  if (pulse > 0 && !reducedMotion) { ctx.strokeStyle = `rgba(255,138,121,${pulse * .5})`; ctx.lineWidth = 4; ctx.strokeRect(2, 2, SIZE - 4, SIZE - 4); pulse = Math.max(0, pulse - delta * .025); }
}
function resizeCanvas() {
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = Math.round(canvas.getBoundingClientRect().width * scale);
  if (pixels > 0) { canvas.width = pixels; canvas.height = pixels; ctx.setTransform(pixels / SIZE, 0, 0, pixels / SIZE, 0, 0); }
}
new ResizeObserver(resizeCanvas).observe(canvas);
function frame(now) {
  const elapsed = lastFrame ? (now - lastFrame) / 1000 : 0;
  lastFrame = now;
  // Suspend on long stalls instead of silently skipping history or killing offscreen.
  if (state === 'running' && elapsed > .5) pause();
  if (state === 'running') {
    accumulator += Math.min(elapsed, .25);
    while (accumulator >= 1 / HZ && state === 'running') { tick(); accumulator -= 1 / HZ; }
    updateHud();
  }
  $('toast').classList.toggle('visible', state === 'running' && now < toastUntil);
  draw(now, Math.min(elapsed, .05));
  requestAnimationFrame(frame);
}
resizeCanvas(); updateHud(); requestAnimationFrame(frame);
