/* ════════════════════════════════════════════════════════
   말랑프렌즈 물감대소동 — game.js

   릴레이(서버 무권위) 실시간 영역 칠하기 배틀.
   - 위치만 10Hz 로 브로드캐스트, 칠하기는 각 클라이언트가 경로를 따라 재현
   - 시작/최종집계는 호스트(roster 첫 번째 인게임 참가자)가 브로드캐스트
   - 아이템 클레임은 DO 중계 직렬화 특성을 이용해 "첫 수신 = 주인"

   메시지 프로토콜은 DESIGN.md 참고.
   ════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────
     상수
     ────────────────────────────────────────────── */
  const GAME_ID       = 'paint-panic';
  const GRID_W        = 22;
  const GRID_H        = 28;
  const CELL          = 20;                 // 논리 px (캔버스 440×560)
  const ROUND_MS      = 60000;
  const COUNTDOWN_MS  = 3000;
  const SPEED         = 7.0;                // 셀/초
  const BOOST_SPEED   = 1.6;                // 부스트 배속
  const BOOST_MS      = 3200;
  const BRUSH_R       = 1.25;               // 기본 붓 반경(셀)
  const BOOST_BRUSH_R = 1.9;
  const BOMB_R        = 2.6;                // 물감폭탄 반경
  const POS_SEND_MS   = 100;                // 위치 브로드캐스트 주기 (10Hz)
  const ITEM_FIRST_MS = 6000;
  const ITEM_EVERY_MS = 8000;
  const PICKUP_DIST   = 1.15;
  const MAX_PLAYERS   = 6;

  const PALETTE = ['#ff5e7e', '#38bdf8', '#4ade80', '#fbbf24', '#a78bfa', '#fb923c'];
  const SPAWNS = [
    [3, 3], [GRID_W - 4, GRID_H - 4], [GRID_W - 4, 3],
    [3, GRID_H - 4], [GRID_W / 2, 3], [GRID_W / 2, GRID_H - 4],
  ];
  const MEDALS = ['🥇', '🥈', '🥉'];

  /* ──────────────────────────────────────────────
     DOM
     ────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const lobbyScreen = $('lobbyScreen'), playScreen = $('playScreen'), overScreen = $('overScreen');
  const roomCodeEl = $('roomCode'), playerListEl = $('playerList'), ongoingHint = $('ongoingHint');
  const nameInput = $('nameInput'), charPicker = $('charPicker');
  const btnStart = $('btnStart'), btnExit = $('btnExit');
  const timerDisplay = $('timerDisplay'), territoryBar = $('territoryBar');
  const canvas = $('arena'), countOverlay = $('countOverlay');
  const resultTitle = $('resultTitle'), finalScore = $('finalScore'), finalRanking = $('finalRanking');
  const btnRestart = $('btnRestart'), btnExitOver = $('btnExitOver');
  const ctx = canvas.getContext('2d');

  /* ──────────────────────────────────────────────
     상태
     ────────────────────────────────────────────── */
  let relay = null;
  let phase = 'lobby';            // lobby | countdown | playing | over
  let meta = {};                  // playerId → { charId, name } (char 메시지로 공유된 선택)
  let knownIds = new Set();       // char 재송신 판단용

  let grid = new Uint8Array(GRID_W * GRID_H);  // 0=빈칸, slot+1=주인
  let gp = [];                    // 이번 판 참가자 [{id,name,charId,slot,color,x,y,netX,netY,boostUntil,isMe}]
  let gpById = {};
  let items = [];                 // [{idx,type,x,y,spawnAt,claimedBy}]
  let particles = [];
  let pendingClaims = {};

  let countStart = 0, playStart = 0, roundDurationMs = ROUND_MS;
  let lastPosSend = 0, lastFrame = 0, lastBarUpdate = 0;
  let resultApplied = false, finishCalled = false, resultFallbackTimer = null;
  let rafId = null;

  let myCharId = null, myName = '';
  let pointerTarget = null;       // {x,y} 그리드 좌표
  const keys = {};

  /* ──────────────────────────────────────────────
     유틸
     ────────────────────────────────────────────── */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function showScreen(el) {
    [lobbyScreen, playScreen, overScreen].forEach((s) => s.classList.remove('is-active'));
    el.classList.add('is-active');
  }

  function charById(worldId) {
    const list = window.CHARACTERS || [];
    return list.find((c) => c.worldId === worldId) || list[0] || null;
  }

  /* ──────────────────────────────────────────────
     사운드 — WebAudio 합성 (에셋 없음)
     ────────────────────────────────────────────── */
  let audioCtx = null;
  function beep(freq, durMs, type, gain, slideTo) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + durMs / 1000);
      g.gain.setValueAtTime(gain || 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + durMs / 1000);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + durMs / 1000 + 0.02);
    } catch (e) { /* 오디오 미지원 무시 */ }
  }
  const sfx = {
    count: () => beep(660, 120, 'square', 0.08),
    go:    () => beep(880, 350, 'square', 0.1, 1320),
    boost: () => beep(440, 280, 'sawtooth', 0.09, 1100),
    bomb:  () => beep(180, 420, 'triangle', 0.16, 50),
    end:   () => { beep(523, 160, 'sine', 0.1); setTimeout(() => beep(659, 160, 'sine', 0.1), 170); setTimeout(() => beep(784, 320, 'sine', 0.12), 340); },
  };

  /* ──────────────────────────────────────────────
     캐릭터 초상화 프리로드
     ────────────────────────────────────────────── */
  const portraits = {};
  (window.CHARACTERS || []).forEach((c) => {
    const img = new Image();
    img.src = c.portrait;
    portraits[c.worldId] = img;
  });

  /* ──────────────────────────────────────────────
     로비 — 별명 + 캐릭터 선택
     ────────────────────────────────────────────── */
  function loadPrefs() {
    let savedName = '', savedChar = '';
    try {
      savedName = localStorage.getItem('pp_name') || '';
      savedChar = localStorage.getItem('pp_char') || '';
    } catch (e) { /* storage 막힌 환경 무시 */ }
    myName = (window.GameBoot.name || savedName || '플레이어').slice(0, 10);
    const list = window.CHARACTERS || [];
    myCharId = list.some((c) => c.worldId === savedChar)
      ? savedChar
      : (list.length ? list[Math.floor(Math.random() * list.length)].worldId : null);
    nameInput.value = myName;
  }

  function renderCharPicker() {
    charPicker.innerHTML = '';
    (window.CHARACTERS || []).forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'char-pick' + (c.worldId === myCharId ? ' is-selected' : '');
      btn.style.backgroundImage = `url("${c.portrait}")`;
      btn.title = c.label;
      btn.addEventListener('click', () => {
        myCharId = c.worldId;
        try { localStorage.setItem('pp_char', myCharId); } catch (e) { /* ignore */ }
        renderCharPicker();
        broadcastMeta();
      });
      charPicker.appendChild(btn);
    });
  }

  let metaSendTimer = null;
  function broadcastMeta() {
    if (!relay || !relay.playerId) return;
    meta[relay.playerId] = { charId: myCharId, name: myName };
    renderPlayerList(relay.players());
    clearTimeout(metaSendTimer);
    metaSendTimer = setTimeout(() => {
      relay.send({ type: 'char', charId: myCharId, name: myName });
    }, 150);
  }

  let nameTimer = null;
  nameInput.addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      const v = nameInput.value.trim().slice(0, 10);
      if (!v) return;
      myName = v;
      try { localStorage.setItem('pp_name', myName); } catch (e) { /* ignore */ }
      broadcastMeta();
    }, 400);
  });

  /* ──────────────────────────────────────────────
     로비 — 참가자 목록 & 시작 버튼
     ────────────────────────────────────────────── */
  function displayInfo(p) {
    const m = meta[p.id] || {};
    const charId = m.charId || p.characterId || null;
    const name = m.name || p.name || '플레이어';
    return { charId, name };
  }

  function renderPlayerList(players) {
    playerListEl.innerHTML = '';
    if (!players || players.length === 0) {
      const li = document.createElement('li');
      li.textContent = '아직 참가자가 없어요...';
      li.style.opacity = '0.5';
      li.style.padding = '8px';
      playerListEl.appendChild(li);
      return;
    }
    players.forEach((p, i) => {
      const isMe = relay && p.id === relay.playerId;
      const info = displayInfo(p);
      const li = document.createElement('li');
      li.className = 'player-list__item' + (isMe ? ' is-me' : '');

      const dot = document.createElement('span');
      dot.className = 'player-list__dot';
      dot.style.backgroundColor = PALETTE[i % PALETTE.length];
      const c = charById(info.charId);
      if (c) dot.style.backgroundImage = `url("${c.portrait}")`;

      const nameEl = document.createElement('span');
      nameEl.textContent = info.name + (isMe ? ' (나)' : '') + (i === 0 ? ' 👑' : '');

      li.appendChild(dot);
      li.appendChild(nameEl);
      playerListEl.appendChild(li);
    });
    updateStartButton(players);
  }

  function isHost(players) {
    return relay && players.length > 0 && players[0].id === relay.playerId;
  }

  function updateStartButton(players) {
    if (!relay || !relay.playerId) { btnStart.disabled = true; return; }
    if (isHost(players)) {
      btnStart.disabled = false;
      btnStart.textContent = players.length === 1 ? '혼자 연습하기' : '시작!';
    } else {
      btnStart.disabled = true;
      btnStart.textContent = '방장(👑)이 시작해요';
    }
  }

  /* ──────────────────────────────────────────────
     라운드 시작 — 호스트가 start 브로드캐스트, 전원이 같은 메시지로 셋업
     ────────────────────────────────────────────── */
  btnStart.addEventListener('click', () => {
    if (!relay || phase === 'countdown' || phase === 'playing') return;
    const players = relay.players();
    if (!isHost(players)) return;
    const roster = players.slice(0, MAX_PLAYERS).map((p) => {
      const info = displayInfo(p);
      return { id: p.id, name: info.name, charId: info.charId };
    });
    const seed = (Math.random() * 0xffffffff) >>> 0;
    relay.send({ type: 'start', seed, durationMs: ROUND_MS, roster }, { echo: true });
  });

  function setupRound(msg) {
    const roster = Array.isArray(msg.roster) ? msg.roster.slice(0, MAX_PLAYERS) : [];
    const meIncluded = relay && roster.some((r) => r.id === relay.playerId);
    if (!meIncluded) {
      // 진행 중 입장한 참가자 — 다음 판부터 합류
      ongoingHint.hidden = false;
      return;
    }
    ongoingHint.hidden = true;

    grid = new Uint8Array(GRID_W * GRID_H);
    particles = [];
    pendingClaims = {};
    resultApplied = false;
    finishCalled = false;
    clearTimeout(resultFallbackTimer);
    roundDurationMs = typeof msg.durationMs === 'number' ? msg.durationMs : ROUND_MS;

    gp = roster.map((r, i) => ({
      id: r.id,
      name: String(r.name || '플레이어').slice(0, 10),
      charId: r.charId || null,
      slot: i,
      color: PALETTE[i % PALETTE.length],
      x: SPAWNS[i % SPAWNS.length][0],
      y: SPAWNS[i % SPAWNS.length][1],
      netX: SPAWNS[i % SPAWNS.length][0],
      netY: SPAWNS[i % SPAWNS.length][1],
      boostUntil: 0,
      isMe: relay && r.id === relay.playerId,
    }));
    gpById = {};
    gp.forEach((p) => { gpById[p.id] = p; });

    // 시드 기반 아이템 스케줄 — 모든 클라이언트가 동일하게 계산
    const rng = mulberry32(msg.seed >>> 0);
    items = [];
    let idx = 0;
    for (let t = ITEM_FIRST_MS; t < roundDurationMs - 4000; t += ITEM_EVERY_MS) {
      items.push({
        idx: idx++,
        type: rng() < 0.5 ? 'bomb' : 'boost',
        x: 2.5 + rng() * (GRID_W - 5),
        y: 2.5 + rng() * (GRID_H - 5),
        spawnAt: t,
        claimedBy: null,
      });
    }

    // 각자 스폰 주변을 살짝 칠하고 시작 (첫 화면이 허전하지 않게)
    gp.forEach((p) => stampCircle(p.x, p.y, BRUSH_R, p.slot));

    pointerTarget = null;
    phase = 'countdown';
    countStart = performance.now();
    countOverlay.hidden = false;
    timerDisplay.textContent = Math.ceil(roundDurationMs / 1000);
    timerDisplay.classList.remove('is-urgent');
    showScreen(playScreen);
    resizeCanvas();
    if (!rafId) { lastFrame = performance.now(); rafId = requestAnimationFrame(frame); }
  }

  /* ──────────────────────────────────────────────
     페인트 그리드
     ────────────────────────────────────────────── */
  function stampCircle(cx, cy, r, slot) {
    const v = slot + 1;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(GRID_W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(GRID_H - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const dx = gx + 0.5 - cx, dy = gy + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) grid[gy * GRID_W + gx] = v;
      }
    }
  }

  function paintAlong(p, fromX, fromY, toX, toY) {
    const r = p.boostUntil > performance.now() ? BOOST_BRUSH_R : BRUSH_R;
    const dx = toX - fromX, dy = toY - fromY;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 0.35));
    for (let i = 1; i <= steps; i++) {
      stampCircle(fromX + (dx * i) / steps, fromY + (dy * i) / steps, r, p.slot);
    }
  }

  function countCells() {
    const counts = {};
    gp.forEach((p) => { counts[p.id] = 0; });
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === 0) continue;
      const p = gp[grid[i] - 1];
      if (p) counts[p.id] += 1;
    }
    return counts;
  }

  /* ──────────────────────────────────────────────
     입력 — 포인터 드래그 / 키보드
     ────────────────────────────────────────────── */
  function canvasToGrid(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * GRID_W,
      y: ((e.clientY - rect.top) / rect.height) * GRID_H,
    };
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointerTarget = canvasToGrid(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointerTarget) pointerTarget = canvasToGrid(e);
  });
  canvas.addEventListener('pointerup', () => { pointerTarget = null; });
  canvas.addEventListener('pointercancel', () => { pointerTarget = null; });

  window.addEventListener('keydown', (e) => {
    if (e.target === nameInput) return;
    keys[e.key.toLowerCase()] = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  function inputVector(me) {
    let dx = 0, dy = 0;
    if (keys.arrowleft || keys.a) dx -= 1;
    if (keys.arrowright || keys.d) dx += 1;
    if (keys.arrowup || keys.w) dy -= 1;
    if (keys.arrowdown || keys.s) dy += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      return { x: dx / len, y: dy / len };
    }
    if (pointerTarget) {
      const tx = pointerTarget.x - me.x, ty = pointerTarget.y - me.y;
      const len = Math.hypot(tx, ty);
      if (len > 0.3) return { x: tx / len, y: ty / len };
    }
    return null;
  }

  /* ──────────────────────────────────────────────
     메인 루프
     ────────────────────────────────────────────── */
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    if (phase === 'countdown') {
      const left = COUNTDOWN_MS - (now - countStart);
      if (left <= 0) {
        phase = 'playing';
        playStart = now;
        countOverlay.hidden = true;
        sfx.go();
      } else {
        const n = Math.ceil(left / 1000);
        if (countOverlay.textContent !== String(n)) {
          countOverlay.textContent = String(n);
          sfx.count();
        }
      }
    }

    if (phase === 'playing') {
      const elapsed = now - playStart;
      updateTimer(elapsed);
      const me = gp.find((p) => p.isMe);

      if (me) {
        // 내 이동 + 칠하기
        const dir = inputVector(me);
        if (dir) {
          const spd = SPEED * (me.boostUntil > now ? BOOST_SPEED : 1);
          const nx = Math.max(0.5, Math.min(GRID_W - 0.5, me.x + dir.x * spd * dt));
          const ny = Math.max(0.5, Math.min(GRID_H - 0.5, me.y + dir.y * spd * dt));
          paintAlong(me, me.x, me.y, nx, ny);
          me.x = nx; me.y = ny;
        }
        // 위치 브로드캐스트 (10Hz)
        if (now - lastPosSend >= POS_SEND_MS) {
          lastPosSend = now;
          relay.send({ type: 'p', x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100 });
        }
        // 아이템 줍기 — 클레임 메시지 송신 (첫 수신자가 주인)
        items.forEach((it) => {
          if (it.claimedBy || pendingClaims[it.idx] || elapsed < it.spawnAt) return;
          if (Math.hypot(me.x - it.x, me.y - it.y) <= PICKUP_DIST) {
            pendingClaims[it.idx] = true;
            relay.send({ type: 'item', idx: it.idx }, { echo: true });
          }
        });
      }

      // 원격 플레이어 보간 + 경로 칠하기
      gp.forEach((p) => {
        if (p.isMe) return;
        const dx = p.netX - p.x, dy = p.netY - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.02) {
          const spd = SPEED * (p.boostUntil > now ? BOOST_SPEED : 1) * 1.35; // 따라잡기 여유
          const step = Math.min(dist, spd * dt);
          const nx = p.x + (dx / dist) * step, ny = p.y + (dy / dist) * step;
          paintAlong(p, p.x, p.y, nx, ny);
          p.x = nx; p.y = ny;
        }
      });

      if (now - lastBarUpdate > 400) {
        lastBarUpdate = now;
        renderTerritoryBar();
      }
      if (elapsed >= roundDurationMs) finishRound();
    }

    // 파티클
    particles = particles.filter((pt) => {
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vy += 14 * dt; pt.life -= dt;
      return pt.life > 0;
    });

    render(now);
  }

  function updateTimer(elapsed) {
    const left = Math.max(0, Math.ceil((roundDurationMs - elapsed) / 1000));
    timerDisplay.textContent = String(left);
    timerDisplay.classList.toggle('is-urgent', left <= 5);
  }

  /* ──────────────────────────────────────────────
     렌더링
     ────────────────────────────────────────────── */
  function resizeCanvas() {
    const wrap = canvas.parentElement;
    const availW = wrap.clientWidth || 400;
    const availH = wrap.clientHeight || 520;
    const scale = Math.min(availW / (GRID_W * CELL), availH / (GRID_H * CELL));
    const cssW = Math.floor(GRID_W * CELL * scale);
    const cssH = Math.floor(GRID_H * CELL * scale);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
  }
  window.addEventListener('resize', () => {
    if (playScreen.classList.contains('is-active')) resizeCanvas();
  });

  function render(now) {
    if (!playScreen.classList.contains('is-active')) return;
    const w = canvas.width, h = canvas.height;
    const sx = w / GRID_W, sy = h / GRID_H;
    ctx.clearRect(0, 0, w, h);

    // 바닥
    ctx.fillStyle = '#f5f1e8';
    ctx.fillRect(0, 0, w, h);

    // 칠해진 칸
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const v = grid[gy * GRID_W + gx];
        if (v === 0) continue;
        const p = gp[v - 1];
        if (!p) continue;
        ctx.fillStyle = p.color;
        ctx.fillRect(gx * sx, gy * sy, sx + 0.5, sy + 0.5);
      }
    }

    // 은은한 격자
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 1; gx < GRID_W; gx++) { ctx.moveTo(gx * sx, 0); ctx.lineTo(gx * sx, h); }
    for (let gy = 1; gy < GRID_H; gy++) { ctx.moveTo(0, gy * sy); ctx.lineTo(w, gy * sy); }
    ctx.stroke();

    // 아이템
    const elapsed = phase === 'playing' ? now - playStart : -1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    items.forEach((it) => {
      if (it.claimedBy || elapsed < it.spawnAt) return;
      const bob = Math.sin(now / 250 + it.idx) * 0.12;
      ctx.font = `${sx * 1.4}px sans-serif`;
      ctx.fillText(it.type === 'bomb' ? '💣' : '⚡', it.x * sx, (it.y + bob) * sy);
    });

    // 파티클
    particles.forEach((pt) => {
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life * 2));
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x * sx, pt.y * sy, sx * 0.18, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // 플레이어
    gp.forEach((p) => {
      const px = p.x * sx, py = p.y * sy;
      const r = sx * 0.95;
      const boosted = p.boostUntil > now;

      if (boosted) {
        ctx.beginPath();
        ctx.arc(px, py, r * 1.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 160, 0.45)';
        ctx.fill();
      }
      // 색 버블
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.lineWidth = Math.max(2, sx * 0.14);
      ctx.strokeStyle = p.isMe ? '#ffffff' : 'rgba(255,255,255,0.75)';
      ctx.stroke();
      // 초상화
      const img = portraits[p.charId];
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, r * 0.82, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, px - r * 0.82, py - r * 0.78, r * 1.64, r * 1.64);
        ctx.restore();
      }
      // 이름표
      ctx.font = `bold ${Math.max(10, sx * 0.55)}px sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.fillStyle = '#fff';
      ctx.strokeText(p.name, px, py - r - sy * 0.35);
      ctx.fillText(p.name, px, py - r - sy * 0.35);
    });
  }

  function renderTerritoryBar() {
    const counts = countCells();
    const total = GRID_W * GRID_H;
    territoryBar.innerHTML = '';
    gp.forEach((p) => {
      const pct = (counts[p.id] / total) * 100;
      const seg = document.createElement('div');
      seg.className = 'territory-bar__seg';
      seg.style.width = pct + '%';
      seg.style.background = p.color;
      if (pct > 9) seg.textContent = Math.round(pct) + '%';
      territoryBar.appendChild(seg);
    });
  }

  /* ──────────────────────────────────────────────
     라운드 종료 & 결과
     ────────────────────────────────────────────── */
  function finishRound() {
    if (finishCalled) return;
    finishCalled = true;
    phase = 'over';

    // 호스트(로스터 중 인게임 첫 참가자)가 자신의 그리드 기준으로 최종 집계 브로드캐스트
    const ingameRoster = relay.players().filter((p) => gpById[p.id]);
    const amHost = ingameRoster.length > 0 && ingameRoster[0].id === relay.playerId;
    if (amHost) {
      relay.send({ type: 'result', counts: countCells() }, { echo: true });
    }
    // 호스트 메시지가 안 오면 로컬 집계로 폴백
    resultFallbackTimer = setTimeout(() => applyResult(countCells()), 2500);
  }

  function applyResult(counts) {
    if (resultApplied) return;
    resultApplied = true;
    phase = 'over';
    clearTimeout(resultFallbackTimer);
    sfx.end();

    const total = GRID_W * GRID_H;
    const ranking = gp
      .map((p) => ({ p, cells: counts[p.id] || 0 }))
      .sort((a, b) => b.cells - a.cells);

    const mine = ranking.find((r) => r.p.isMe);
    const myPct = mine ? (mine.cells / total) * 100 : 0;
    finalScore.textContent = myPct.toFixed(1) + '%';
    resultTitle.textContent = (ranking[0] && ranking[0].p.isMe) ? '🏆 우승!' : '결과 발표! 🎉';

    finalRanking.innerHTML = '';
    ranking.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = 'final-ranking__item';

      const medal = document.createElement('span');
      medal.className = 'final-ranking__medal';
      medal.textContent = MEDALS[i] || (i + 1) + '.';

      const dot = document.createElement('span');
      dot.className = 'final-ranking__dot';
      dot.style.background = r.p.color;

      const name = document.createElement('span');
      name.className = 'final-ranking__name';
      name.textContent = r.p.name + (r.p.isMe ? ' (나)' : '');

      const score = document.createElement('span');
      score.className = 'final-ranking__score';
      score.textContent = ((r.cells / total) * 100).toFixed(1) + '%';

      li.appendChild(medal);
      li.appendChild(dot);
      li.appendChild(name);
      li.appendChild(score);
      finalRanking.appendChild(li);
    });

    window.GameBoot.submitResult({ score: Math.round(myPct) });
    showScreen(overScreen);
  }

  /* ──────────────────────────────────────────────
     릴레이 연결 & 메시지 라우팅
     ────────────────────────────────────────────── */
  function applyItemClaim(from, idx) {
    const it = items.find((i) => i.idx === idx);
    if (!it || it.claimedBy) return;   // 이미 주인 있음 — 늦은 클레임 무시
    const p = gpById[from];
    if (!p) return;
    it.claimedBy = from;
    if (it.type === 'bomb') {
      stampCircle(it.x, it.y, BOMB_R, p.slot);
      sfx.bomb();
      for (let i = 0; i < 18; i++) {
        const a = (Math.PI * 2 * i) / 18;
        const v = 4 + Math.random() * 5;
        particles.push({ x: it.x, y: it.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, life: 0.5 + Math.random() * 0.3, color: p.color });
      }
    } else {
      p.boostUntil = performance.now() + BOOST_MS;
      sfx.boost();
    }
  }

  function onRelayMessage(msg) {
    const pl = msg.payload;
    if (!pl || typeof pl.type !== 'string') return;

    switch (pl.type) {
      case 'char':
        meta[msg.from] = {
          charId: typeof pl.charId === 'string' ? pl.charId : null,
          name: typeof pl.name === 'string' ? pl.name.slice(0, 10) : null,
        };
        if (lobbyScreen.classList.contains('is-active')) renderPlayerList(relay.players());
        break;

      case 'start':
        if (phase === 'countdown' || phase === 'playing') break; // 진행 중 중복 start 무시
        setupRound(pl);
        break;

      case 'p': {
        const p = gpById[msg.from];
        if (!p || p.isMe) {
          // 내가 모르는 라운드가 진행 중 (진행 중 입장) → 로비 힌트
          if (!p && phase === 'lobby') ongoingHint.hidden = false;
          break;
        }
        if (typeof pl.x === 'number' && typeof pl.y === 'number') {
          p.netX = Math.max(0.5, Math.min(GRID_W - 0.5, pl.x));
          p.netY = Math.max(0.5, Math.min(GRID_H - 0.5, pl.y));
        }
        break;
      }

      case 'item':
        if (typeof pl.idx === 'number') applyItemClaim(msg.from, pl.idx);
        break;

      case 'result':
        if (pl.counts && typeof pl.counts === 'object' && gp.length > 0) {
          ongoingHint.hidden = true;
          applyResult(pl.counts);
        }
        break;
    }
  }

  function initRelay() {
    relay = MallangRelay.create({ gameId: GAME_ID, name: myName, characterId: myCharId });

    relay.ready.then(() => {
      roomCodeEl.textContent = relay.code || '????';
      knownIds = new Set(relay.players().map((p) => p.id));
      broadcastMeta();
      renderPlayerList(relay.players());
    }).catch((err) => {
      roomCodeEl.textContent = '연결 실패';
      console.error('[relay] 연결 오류:', err);
    });

    relay.on('players', (players) => {
      // 새로 들어온 참가자에게 내 캐릭터/별명 다시 알려주기
      const ids = new Set(players.map((p) => p.id));
      let hasNew = false;
      ids.forEach((id) => { if (!knownIds.has(id)) hasNew = true; });
      knownIds = ids;
      if (hasNew && relay.playerId) broadcastMeta();

      if (lobbyScreen.classList.contains('is-active')) renderPlayerList(players);
    });

    relay.on('message', onRelayMessage);
    relay.on('close', () => {
      if (phase === 'lobby') roomCodeEl.textContent = '연결 끊김 😢';
    });
    relay.on('error', (err) => console.error('[relay] 오류:', err));
  }

  /* ──────────────────────────────────────────────
     화면 전환 버튼
     ────────────────────────────────────────────── */
  function backToLobby() {
    phase = 'lobby';
    countOverlay.hidden = true;
    showScreen(lobbyScreen);
    if (relay) renderPlayerList(relay.players());
  }

  btnRestart.addEventListener('click', backToLobby);
  btnExit.addEventListener('click', () => {
    if (relay) relay.leave();
    window.GameBoot.exit();
  });
  btnExitOver.addEventListener('click', () => {
    if (relay) relay.leave();
    window.GameBoot.exit();
  });

  /* ──────────────────────────────────────────────
     진입점
     ────────────────────────────────────────────── */
  loadPrefs();
  renderCharPicker();
  initRelay();

})();
