/* ════════════════════════════════════════════════════════
   말랑 타워 — 원탭 블록 쌓기 (클라이언트 전용 SOLO)
   좌우로 움직이는 말랑친구를 탭으로 떨어뜨려 아래 탑에 얹는다.
   어긋난 만큼 잘려 폭이 줄고, 딱 맞추면(perfect) 폭이 조금 되살아난다.
   순수 로직은 logic.js(TowerLogic)에 분리되어 tests/ 로 검증된다.
   ════════════════════════════════════════════════════════ */
'use strict';

var L = window.TowerLogic;
var boot = window.GameBoot || null;

/* ── 튜닝 값 ───────────────────────────────────────────── */
var BLOCK_H = 30;          // 블록 높이(px)
var MARGIN = 6;            // 이동 블록 좌우 여백
var PERFECT_TOL = 4;       // 이 이하로 어긋나면 '딱!'
var PERFECT_GROW = 10;     // 딱 맞출 때 되살아나는 폭
var BASE_GAP = 48;         // 바닥 블록이 화면 밑에서 뜨는 높이
var BASE_SPEED = 92, SPEED_INC = 7, SPEED_MAX = 260; // px/초
var GRAVITY = 2400;        // 잘린 조각 낙하 가속(px/초²)
var BEST_KEY = 'mallang-tower-best';

var FRIENDS = [
  { e: '🐥', c: '#ffe08a', s: '#eab63f' },
  { e: '🐶', c: '#c3e2ff', s: '#7fb1ea' },
  { e: '🐱', c: '#c9efe0', s: '#6cc6a4' },
  { e: '🐰', c: '#ffd6de', s: '#f095a8' },
  { e: '🐹', c: '#f6dcb2', s: '#dca866' }
];
var SKY = { day: ['#c7e8ff', '#eef8ff'], dusk: ['#9aa7dd', '#ffcf9e'], night: ['#232249', '#4a3f7e'] };

/* ── DOM ──────────────────────────────────────────────── */
var startScreen = document.getElementById('startScreen');
var playScreen = document.getElementById('playScreen');
var overScreen = document.getElementById('overScreen');
var canvas = document.getElementById('stage');
var ctx = canvas.getContext('2d');
var floorValue = document.getElementById('floorValue');
var bestValue = document.getElementById('bestValue');
var tapHint = document.getElementById('tapHint');
var btnSound = document.getElementById('btnSound');
var startBest = document.getElementById('startBest');
var finalScore = document.getElementById('finalScore');
var resultBest = document.getElementById('resultBest');
var resultCombo = document.getElementById('resultCombo');
var resultTitle = document.getElementById('resultTitle');
var resultEmoji = document.getElementById('resultEmoji');
var resultCopy = document.getElementById('resultCopy');

/* ── 상태 ─────────────────────────────────────────────── */
var W = 360, H = 480, dpr = 1;
var blocks = [];           // 쌓인 블록 [{x,w,friend}], index=층
var moving = null;         // { x, w, dir, friend } 현재 떨어뜨릴 블록
var movingActive = false;
var spawnW = 130;
var floors = 0, combo = 0, comboMax = 0, friendCursor = 0;
var best = readBest();
var playing = false, over = false;
var camY = 0, camTarget = 0;
var debris = [], particles = [], floaters = [];
var shake = 0, flash = 0;
var rafId = null, lastT = 0;

function readBest() { try { return Math.max(0, parseInt(localStorage.getItem(BEST_KEY), 10) || 0); } catch (e) { return 0; } }
function writeBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) {} }

/* ── 사운드(WebAudio 합성, 파일 없음) ─────────────────── */
var ac = null, master = null, soundOn = true;
function audio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    master = ac.createGain(); master.gain.value = .8; master.connect(ac.destination); }
  if (ac.state === 'suspended') { try { ac.resume(); } catch (e) {} }
  return ac;
}
function tone(f, at, dur, type, peak) {
  var o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'sine'; o.frequency.value = f;
  g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), at + .01);
  g.gain.exponentialRampToValueAtTime(.0001, at + dur); o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + .03);
}
var SFX = {
  land: [[300, 0, .07, 'triangle', .05], [200, .04, .09, 'triangle', .05]],
  perfect: [[660, 0, .06, 'sine', .06], [880, .06, .07, 'sine', .06], [1175, .14, .12, 'sine', .05]],
  over: [[330, 0, .16, 'sine', .06], [247, .15, .2, 'sine', .05], [175, .34, .3, 'sine', .05]]
};
function beep(k) {
  if (!soundOn) return; var c = audio(); if (!c) return;
  try { (SFX[k] || []).forEach(function (n) { tone(n[0], c.currentTime + .001 + n[1], n[2], n[3], n[4]); }); } catch (e) {}
}

/* ── 화면 전환 ────────────────────────────────────────── */
function showScreen(s) {
  [startScreen, playScreen, overScreen].forEach(function (x) { x.classList.remove('is-active'); });
  s.classList.add('is-active');
}

/* ── 캔버스 크기(고해상도 대응) ───────────────────────── */
function resize() {
  var r = canvas.getBoundingClientRect();
  W = Math.max(200, Math.round(r.width)); H = Math.max(240, Math.round(r.height));
  dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  spawnW = Math.round(Math.min(150, Math.max(92, W * 0.42)));
}

/* ── 좌표 변환: 층 L 블록의 화면상 아랫변 ─────────────── */
function screenBottom(level) { return H - BASE_GAP - level * BLOCK_H + camY; }
function camFor(topLevel) { return Math.max(0, topLevel * BLOCK_H - (0.38 * H - BASE_GAP)); }

/* ── 게임 시작 ────────────────────────────────────────── */
function startGame() {
  resize();
  blocks = []; debris = []; particles = []; floaters = [];
  floors = 0; combo = 0; comboMax = 0; friendCursor = 0;
  over = false; playing = true; shake = 0; flash = 0;
  var bx = Math.round((W - spawnW) / 2);
  blocks.push({ x: bx, w: spawnW, friend: FRIENDS[0] });   // 바닥 블록
  camY = camTarget = camFor(0);
  spawnMoving();
  updateHud();
  tapHint.classList.remove('is-hidden');
  showScreen(playScreen);
  if (soundOn) audio();
  lastT = 0;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function spawnMoving() {
  var top = blocks[blocks.length - 1];
  friendCursor += 1;
  var fromLeft = (blocks.length % 2 === 1);
  moving = {
    x: fromLeft ? MARGIN : (W - MARGIN - top.w),
    w: top.w,
    dir: fromLeft ? 1 : -1,
    friend: FRIENDS[friendCursor % FRIENDS.length]
  };
  movingActive = true;
}

/* ── 떨어뜨리기(탭) ───────────────────────────────────── */
function drop() {
  if (!playing || !movingActive) return;
  movingActive = false;
  tapHint.classList.add('is-hidden');
  var top = blocks[blocks.length - 1];
  var res = L.computeDrop(top, { x: moving.x, w: moving.w }, PERFECT_TOL);

  if (!res.hit) {
    // 완전히 빗나감 → 블록이 통째로 떨어지고 게임 오버.
    addDebris(moving.x, blocks.length, moving.w, moving.friend, moving.dir * 120);
    beep('over');
    return endGame();
  }

  var placed = { x: res.newBlock.x, w: res.newBlock.w, friend: moving.friend };
  if (res.perfect) {
    // 딱! — 폭을 조금 되살리고 중심 정렬. 콤보·연출 보상.
    var nw = L.grow(top.w, PERFECT_GROW, spawnW);
    var cx = top.x + top.w / 2;
    placed.x = Math.round(cx - nw / 2); placed.w = nw;
    combo += 1; comboMax = Math.max(comboMax, combo);
    var by = screenBottom(blocks.length) - BLOCK_H / 2;
    burst(placed.x + placed.w / 2, by, placed.friend.s, 14);
    floaters.push({ x: placed.x + placed.w / 2, y: by, text: combo >= 2 ? '딱! x' + combo : '딱!', life: 1, color: '#f4a63c' });
    flash = 0.5; shake = Math.min(10, 5 + combo);
    beep('perfect');
  } else {
    combo = 0;
    res.slices.forEach(function (sl) { addDebris(sl.x, blocks.length, sl.w, moving.friend, (sl.x < placed.x ? -1 : 1) * 60); });
    var dy = screenBottom(blocks.length) - BLOCK_H / 2;
    burst(placed.x + placed.w / 2, dy, placed.friend.s, 6);
    shake = 3;
    beep('land');
  }

  blocks.push(placed);
  floors = blocks.length - 1;
  updateHud();
  camTarget = camFor(floors);
  spawnMoving();
}

function addDebris(x, level, w, friend, vx) {
  debris.push({ x: x, y: screenBottom(level) - BLOCK_H, w: w, h: BLOCK_H, vx: vx, vy: -80, rot: 0, vr: (Math.random() - 0.5) * 6, friend: friend });
}
function burst(x, y, color, n) {
  for (var i = 0; i < n; i += 1) {
    var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160;
    particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 1, color: color, size: 3 + Math.random() * 3 });
  }
}

/* ── 게임 종료 ────────────────────────────────────────── */
function endGame() {
  playing = false; over = true;
  if (floors > best) { best = floors; writeBest(best); }
  finalScore.innerHTML = floors + '<small>층</small>';
  resultBest.textContent = best;
  resultCombo.textContent = comboMax;
  var rating = L.ratingForFloors(floors);
  resultEmoji.textContent = rating >= 3 ? '🏆' : rating >= 2 ? '🎉' : rating >= 1 ? '✨' : '💫';
  resultTitle.textContent = floors >= best && floors > 0 ? '신기록!' : rating >= 2 ? '멋진 탑이에요!' : '다시 도전!';
  resultCopy.textContent = rating >= 3 ? '하늘을 뚫었어요! 대단해요.'
    : rating >= 1 ? '딱 맞추면 폭이 되살아나요. 더 높이!' : '탭 타이밍만 맞추면 금방 올라가요.';
  showScreen(overScreen);
  if (boot) boot.submitResult({ score: floors, perfectMax: comboMax });
}

function updateHud() { floorValue.textContent = floors; bestValue.textContent = best; }

/* ── 루프 ─────────────────────────────────────────────── */
function loop(t) {
  if (!lastT) lastT = t;
  var dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
  update(dt);
  render();
  if (playing || debris.length || particles.length || flash > 0 || Math.abs(camY - camTarget) > 0.5) {
    rafId = requestAnimationFrame(loop);
  } else { rafId = requestAnimationFrame(loop); } // 결과 화면 뒤에서도 카메라 정지 상태 유지 렌더
}

function update(dt) {
  camY += (camTarget - camY) * Math.min(1, dt * 8);
  if (playing && movingActive && moving) {
    var sp = L.speedForFloor(floors, BASE_SPEED, SPEED_INC, SPEED_MAX);
    moving.x += moving.dir * sp * dt;
    var maxX = W - MARGIN - moving.w;
    if (moving.x <= MARGIN) { moving.x = MARGIN; moving.dir = 1; }
    else if (moving.x >= maxX) { moving.x = maxX; moving.dir = -1; }
  }
  for (var i = debris.length - 1; i >= 0; i -= 1) {
    var d = debris[i]; d.vy += GRAVITY * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
    if (d.y > H + 100) debris.splice(i, 1);
  }
  for (var j = particles.length - 1; j >= 0; j -= 1) {
    var p = particles[j]; p.vy += GRAVITY * 0.4 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.6;
    if (p.life <= 0) particles.splice(j, 1);
  }
  for (var k = floaters.length - 1; k >= 0; k -= 1) {
    var fl = floaters[k]; fl.y -= 34 * dt; fl.life -= dt * 1.3; if (fl.life <= 0) floaters.splice(k, 1);
  }
  if (shake > 0) shake = Math.max(0, shake - dt * 40);
  if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
}

/* ── 렌더 ─────────────────────────────────────────────── */
function lerpColor(a, b, t) {
  var ca = hex(a), cb = hex(b);
  return 'rgb(' + Math.round(ca[0] + (cb[0] - ca[0]) * t) + ',' + Math.round(ca[1] + (cb[1] - ca[1]) * t) + ',' + Math.round(ca[2] + (cb[2] - ca[2]) * t) + ')';
}
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

function drawSky() {
  var t = Math.min(1, floors / 36);
  var top, bot;
  if (t < 0.5) { var u = t / 0.5; top = lerpColor(SKY.day[0], SKY.dusk[0], u); bot = lerpColor(SKY.day[1], SKY.dusk[1], u); }
  else { var v = (t - 0.5) / 0.5; top = lerpColor(SKY.dusk[0], SKY.night[0], v); bot = lerpColor(SKY.dusk[1], SKY.night[1], v); }
  var g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 별 (높이 오를수록 진해짐)
  var starA = Math.max(0, Math.min(1, (t - 0.35) / 0.5));
  if (starA > 0) {
    ctx.save(); ctx.fillStyle = '#fff';
    for (var i = 0; i < 40; i += 1) {
      var sx = (i * 97.13 % W), sy = ((i * 53.7 % (H * 0.7)) + camY * 0.15) % (H * 0.8);
      ctx.globalAlpha = starA * (0.4 + (i % 3) * 0.2);
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.restore();
  }
  // 구름 (낮에만)
  var cloudA = (1 - t) * 0.85;
  if (cloudA > 0.02) {
    ctx.save(); ctx.globalAlpha = cloudA; ctx.fillStyle = '#ffffff';
    [[W * 0.2, 90], [W * 0.7, 160], [W * 0.45, 240]].forEach(function (c, idx) {
      var cy = (c[1] + camY * 0.4) % (H + 120) - 60;
      cloud(c[0] + (idx * 20), cy);
    });
    ctx.restore();
  }
}
function cloud(x, y) { ctx.beginPath(); ctx.ellipse(x, y, 34, 18, 0, 0, 7); ctx.ellipse(x + 26, y + 6, 26, 15, 0, 0, 7); ctx.ellipse(x - 24, y + 6, 24, 14, 0, 0, 7); ctx.fill(); }

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawBlock(x, bottom, w, friend, alpha, rot) {
  var y = bottom - BLOCK_H;
  ctx.save();
  if (rot) { ctx.translate(x + w / 2, y + BLOCK_H / 2); ctx.rotate(rot); ctx.translate(-(x + w / 2), -(y + BLOCK_H / 2)); }
  if (alpha != null) ctx.globalAlpha = alpha;
  roundRect(x, y, w, BLOCK_H, 8); ctx.fillStyle = friend.c; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = friend.s; ctx.stroke();
  // 윗면 하이라이트
  ctx.globalAlpha = (alpha == null ? 1 : alpha) * 0.5;
  roundRect(x + 3, y + 3, Math.max(0, w - 6), 7, 4); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.globalAlpha = (alpha == null ? 1 : alpha);
  // 얼굴(폭이 넉넉할 때만)
  if (w >= 26) {
    ctx.font = Math.min(BLOCK_H * 0.86, w * 0.5) + 'px -apple-system, "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(friend.e, x + w / 2, y + BLOCK_H / 2 + 1);
  }
  ctx.restore();
}

function render() {
  drawSky();
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  // 바닥 언덕(바닥 블록 아래)
  var baseB = screenBottom(0);
  if (baseB < H + 60) {
    ctx.fillStyle = 'rgba(120,102,216,.16)';
    roundRect(-40, baseB, W + 80, H, 40); ctx.fill();
  }

  // 쌓인 블록(화면 안만)
  var top = blocks.length - 1;
  for (var lvl = 0; lvl <= top; lvl += 1) {
    var b = blocks[lvl]; var sb = screenBottom(lvl);
    if (sb < -BLOCK_H || sb - BLOCK_H > H) continue;
    drawBlock(b.x, sb, b.w, b.friend, 1, 0);
  }

  // 조준 가이드 + 이동 블록
  if (playing && movingActive && moving) {
    var t = blocks[top]; var tb = screenBottom(top); var mb = screenBottom(top + 1);
    ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(58,47,87,.28)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(t.x, tb - BLOCK_H); ctx.lineTo(t.x, mb - BLOCK_H);
    ctx.moveTo(t.x + t.w, tb - BLOCK_H); ctx.lineTo(t.x + t.w, mb - BLOCK_H); ctx.stroke(); ctx.restore();
    drawBlock(moving.x, mb, moving.w, moving.friend, 1, 0);
  }

  debris.forEach(function (d) { drawBlock(d.x, d.y + BLOCK_H, d.w, d.friend, 0.95, d.rot); });

  particles.forEach(function (p) {
    ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
  });
  ctx.globalAlpha = 1;

  floaters.forEach(function (fl) {
    ctx.globalAlpha = Math.max(0, fl.life); ctx.fillStyle = fl.color;
    ctx.font = '900 22px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeText(fl.text, fl.x, fl.y); ctx.fillText(fl.text, fl.x, fl.y);
  });
  ctx.globalAlpha = 1;
  ctx.restore();

  if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }
}

/* ── 입력 ─────────────────────────────────────────────── */
function onTap(e) { if (playing && movingActive) { e.preventDefault(); drop(); } }
canvas.addEventListener('pointerdown', onTap);
tapHint.addEventListener('pointerdown', onTap);
document.addEventListener('keydown', function (e) {
  if (e.key === ' ' || e.key === 'Enter') {
    if (startScreen.classList.contains('is-active')) startGame();
    else if (overScreen.classList.contains('is-active')) startGame();
    else if (playing && movingActive) { e.preventDefault(); drop(); }
  }
});

/* ── 버튼 ─────────────────────────────────────────────── */
document.getElementById('btnStart').addEventListener('click', startGame);
document.getElementById('btnRestart').addEventListener('click', startGame);
document.getElementById('btnExit').addEventListener('click', function () { boot ? boot.exit() : (window.location.href = '/'); });
document.getElementById('btnExitOver').addEventListener('click', function () { boot ? boot.exit() : (window.location.href = '/'); });
btnSound.addEventListener('click', function () { soundOn = !soundOn; btnSound.textContent = soundOn ? '🔊' : '🔇'; if (soundOn) audio(); });

/* ── 초기 표시 ────────────────────────────────────────── */
function initHome() {
  if (best > 0) { startBest.textContent = '🏆 최고 ' + best + '층'; startBest.classList.remove('is-hidden'); }
  bestValue.textContent = best;
}
window.addEventListener('resize', function () { if (playing) resize(); });
initHome();

/* ── 디버그 훅(헤드리스 검증용, 일반 플레이에 영향 없음) ── */
window.__mallangTower = {
  start: startGame,
  drop: drop,
  getState: function () {
    var t = blocks[blocks.length - 1] || null;
    return { playing: playing, over: over, floors: floors, best: best, combo: combo, comboMax: comboMax,
      top: t ? { x: t.x, w: t.w } : null, moving: moving ? { x: moving.x, w: moving.w, dir: moving.dir, active: movingActive } : null, camY: camY };
  },
  debugAlign: function () { if (moving && blocks.length) moving.x = blocks[blocks.length - 1].x; },
  debugMiss: function () { if (moving) moving.x = -moving.w - 2; drop(); } // 보드 밖으로 완전히 빼 확실히 빗나감
};
