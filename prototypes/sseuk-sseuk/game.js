/* 말랑프렌즈 슥슥 — Phase B + C + D 통합.
 *
 * Phase B: 캔버스 1000x1000 + 도구바 + 스트로크 broadcast/apply.
 * Phase C: 시간 힌트 슬롯 채우기 (글자 수 / 한 글자 공개).
 * Phase D: 채팅 입력(SS_GUESS) + 정답/근접 판정 결과 렌더링 + 자리 일치 펄스.
 *
 * Phase E: 채팅 오버레이 페이드아웃 / 입력 바 포커스 확장 / 모바일 풀스크린 등.
 */

const CHAR_IMAGES = {
  'mochi-rabbit':    '/prototypes/jump-climber/assets/토끼 메인 이미지.png',
  'pudding-hamster': '/prototypes/jump-climber/assets/햄스터 메인 이미지.png',
  'peach-chick':     '/prototypes/jump-climber/assets/병아리 메인 이미지.png',
  'latte-puppy':     '/prototypes/jump-climber/assets/라떼 메인 이미지.png',
  'mint-kitten':     '/prototypes/jump-climber/assets/고양이 메인이미지.png',
};
const CHAR_LABELS = {
  'mochi-rabbit':    '모찌 토끼',
  'pudding-hamster': '푸딩 햄스터',
  'peach-chick':     '피치 병아리',
  'latte-puppy':     '라떼 강아지',
  'mint-kitten':     '민트 고양이',
};

const { code, name, playerId, isMultiplayer } = window.GameBoot;
const WORKER_URL = window.WORKER_URL;

let ws = null;
let myCharacterId = null;
let isReady = false;
let players = [];
let phase = 'waiting';
let currentRoundIdx = 0;
let totalRounds = 5;
let currentRound = null;
let amIDrawer = false;
let iGuessedCorrect = false;
let timerInterval = null;
let timerDeadlineAt = null;
let timerMode = 'normal';
let lotteryInterval = null;
let volunteerCountdownInterval = null;

/* ── DOM ─────────────────────────────────────────────── */
const setupScreen      = document.getElementById('setupScreen');
const gameScreen       = document.getElementById('gameScreen');
const resultScreen     = document.getElementById('resultScreen');
const bootStatus       = document.getElementById('bootStatus');
const waitingPlayers   = document.getElementById('waitingPlayers');
const readyBtn         = document.getElementById('readyBtn');
const myCharacterImg   = document.getElementById('myCharacterImg');
const myCharacterName  = document.getElementById('myCharacterName');
const gameExitBtn      = document.getElementById('gameExitBtn');
const roundProgress    = document.getElementById('roundProgress');
const roundDifficulty  = document.getElementById('roundDifficulty');
const timerDisplay     = document.getElementById('timerDisplay');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNumber  = document.getElementById('countdownNumber');
const volunteerPanel   = document.getElementById('volunteerPanel');
const volunteerBtn     = document.getElementById('volunteerBtn');
const volunteerList    = document.getElementById('volunteerList');
const volunteerTimer   = document.getElementById('volunteerTimer');
const lotteryPanel     = document.getElementById('lotteryPanel');
const lotteryRoulette  = document.getElementById('lotteryRoulette');
const drawingPanel     = document.getElementById('drawingPanel');
const drawerBanner     = document.getElementById('drawerBanner');
const keywordSlot      = document.getElementById('keywordSlot');
const drawCanvas       = document.getElementById('drawCanvas');
const canvasToolbar    = document.getElementById('canvasToolbar');
const undoBtn          = document.getElementById('undoBtn');
const clearBtn         = document.getElementById('clearBtn');
const chatMessages     = document.getElementById('chatMessages');
const chatForm         = document.getElementById('chatForm');
const chatInput        = document.getElementById('chatInput');
const chatSend         = document.getElementById('chatSend');
const roundEndPanel    = document.getElementById('roundEndPanel');
const roundEndKeyword  = document.getElementById('roundEndKeyword');
const roundEndReason   = document.getElementById('roundEndReason');
const roundEndDeltas   = document.getElementById('roundEndDeltas');
const rankingsList     = document.getElementById('rankingsList');
const exitBtn          = document.getElementById('exitBtn');

/* ── Screen helpers ─────────────────────────────────── */
function showScreen(which) {
  for (const s of [setupScreen, gameScreen, resultScreen]) s.classList.remove('is-active');
  ({ setup: setupScreen, game: gameScreen, result: resultScreen })[which].classList.add('is-active');
}
function showSubPanel(which) {
  for (const p of [volunteerPanel, lotteryPanel, drawingPanel, roundEndPanel]) p.classList.add('is-hidden');
  if (which) document.getElementById(which).classList.remove('is-hidden');
}
function setStatus(text, modifier) {
  bootStatus.textContent = text;
  bootStatus.classList.remove('is-connected', 'is-error');
  if (modifier) bootStatus.classList.add(modifier);
}

const DIFFICULTY_META = {
  easy:   { stars: '★',   label: '쉬움',   className: 'is-easy'   },
  medium: { stars: '★★',  label: '중간',   className: 'is-medium' },
  hard:   { stars: '★★★', label: '어려움', className: 'is-hard'   },
};
function renderDifficultyBadge(difficulty) {
  roundDifficulty.classList.remove('is-easy', 'is-medium', 'is-hard');
  const meta = DIFFICULTY_META[difficulty];
  if (!meta) { roundDifficulty.textContent = ''; return; }
  roundDifficulty.textContent = `${meta.stars} ${meta.label}`;
  roundDifficulty.classList.add(meta.className);
}

/* ── Roster ─────────────────────────────────────────── */
function renderRoster() {
  waitingPlayers.innerHTML = '';
  for (const p of players) {
    const chip = document.createElement('span');
    chip.className = 'player-chip';
    if (p.id === playerId) chip.classList.add('is-me');
    if (p.ready) chip.classList.add('is-ready');
    chip.textContent = p.name;
    waitingPlayers.appendChild(chip);
  }
}
function applyMyCharacter() {
  if (!myCharacterId) return;
  myCharacterImg.src = CHAR_IMAGES[myCharacterId] || '';
  myCharacterImg.alt = CHAR_LABELS[myCharacterId] || '';
  myCharacterName.textContent = CHAR_LABELS[myCharacterId] || myCharacterId;
}

/* ── Ready / Volunteer / Exit ───────────────────────── */
readyBtn.addEventListener('click', () => {
  isReady = !isReady;
  readyBtn.textContent = isReady ? '취소' : 'Ready!';
  readyBtn.classList.toggle('is-ready', isReady);
  sendIfOpen({ type: 'SS_READY', ready: isReady });
});
volunteerBtn.addEventListener('click', () => {
  volunteerBtn.disabled = true;
  volunteerBtn.textContent = '✋ 신청 완료';
  sendIfOpen({ type: 'SS_VOLUNTEER' });
});
function leaveToRoom() {
  try { ws?.close(); } catch {}
  window.location.href = `/?code=${encodeURIComponent(code || '')}`;
}
exitBtn?.addEventListener('click', leaveToRoom);
gameExitBtn?.addEventListener('click', () => {
  if (confirm('정말 방으로 돌아갈까요? 진행 중인 라운드에서 빠지게 됩니다.')) leaveToRoom();
});

/* ── Timer ─────────────────────────────────────────── */
function startTimer(durationMs, mode = 'normal') {
  stopTimer();
  timerMode = mode;
  timerDeadlineAt = Date.now() + Math.max(0, durationMs);
  timerDisplay.classList.toggle('is-bonus', mode === 'bonus');
  updateTimer();
  timerInterval = setInterval(updateTimer, 250);
}
function updateTimer() {
  if (timerDeadlineAt === null) return;
  const remaining = Math.max(0, timerDeadlineAt - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  timerDisplay.textContent = timerMode === 'bonus' ? `+${seconds}s` : `${seconds}s`;
  if (remaining <= 0) stopTimer();
}
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerDeadlineAt = null;
}

function startVolunteerCountdown(deadlineAt) {
  if (volunteerCountdownInterval) clearInterval(volunteerCountdownInterval);
  const tick = () => {
    const left = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
    volunteerTimer.textContent = `남은 시간 ${left}s`;
    if (left <= 0) { clearInterval(volunteerCountdownInterval); volunteerCountdownInterval = null; }
  };
  tick();
  volunteerCountdownInterval = setInterval(tick, 250);
}

/* ── Lottery 연출 ───────────────────────────────────── */
function runLottery(candidates, finalDrawerId, durationMs) {
  if (lotteryInterval) clearInterval(lotteryInterval);
  lotteryRoulette.classList.remove('is-stopped');
  const pool = candidates && candidates.length > 0
    ? candidates.map(id => players.find(p => p.id === id)).filter(Boolean)
    : players.filter(p => p.connected);
  if (pool.length === 0) return;
  let idx = 0;
  lotteryInterval = setInterval(() => {
    lotteryRoulette.textContent = pool[idx % pool.length].name;
    idx++;
  }, 90);
  setTimeout(() => {
    if (lotteryInterval) { clearInterval(lotteryInterval); lotteryInterval = null; }
    const winner = players.find(p => p.id === finalDrawerId);
    lotteryRoulette.textContent = winner ? `🎉 ${winner.name}!` : '🎉';
    lotteryRoulette.classList.add('is-stopped');
  }, Math.max(300, durationMs - 200));
}

/* ── Keyword slot ───────────────────────────────────── */
let slotCells = [];
function renderKeywordSlot(round) {
  keywordSlot.innerHTML = '';
  slotCells = [];
  const n = round.syllableCount || 0;
  if (n === 0) {
    // 글자 수 미공개 — 20초 SS_HINT_REVEAL kind='length' 도착 시 채워짐.
    const placeholder = document.createElement('span');
    placeholder.className = 'keyword-slot__placeholder';
    placeholder.textContent = '글자 수는 잠시 후 공개';
    keywordSlot.appendChild(placeholder);
    return;
  }
  const drawerKeywordChars = (amIDrawer && round.keyword) ? [...round.keyword] : null;
  for (let i = 0; i < n; i++) {
    const cell = document.createElement('span');
    cell.className = 'keyword-slot__cell';
    cell.textContent = drawerKeywordChars ? drawerKeywordChars[i] : '_';
    if (drawerKeywordChars) cell.classList.add('is-revealed-letter');
    keywordSlot.appendChild(cell);
    slotCells.push(cell);
  }
}
function revealLengthHint(count) {
  if (amIDrawer) return;            // 출제자는 이미 슬롯 보유
  if (slotCells.length > 0) return; // 이미 렌더됨
  if (!currentRound) return;
  currentRound.syllableCount = count;
  renderKeywordSlot(currentRound);
}
function revealLetterHint(position, value) {
  if (amIDrawer) return;
  const c = slotCells[position];
  if (!c) return;
  c.textContent = value;
  c.classList.add('is-revealed-letter');
}
function pulseMatchedSlots(positions) {
  if (amIDrawer) return;
  for (const pos of positions) {
    const c = slotCells[pos];
    if (!c) continue;
    c.classList.remove('is-pulse');
    void c.offsetWidth; // restart animation
    c.classList.add('is-pulse');
    setTimeout(() => c.classList.remove('is-pulse'), 700);
  }
}

/* ── Canvas (Phase B) ───────────────────────────────── */
const ctx = drawCanvas.getContext('2d');
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
let currentColor = '#000000';
let currentThickness = 8;
let isDrawing = false;
let currentStroke = null;        // { points, color, thickness }
let allStrokes = [];             // 라운드별로 보관 (clear/undo/round 종료 시 초기화)

function clearCanvasVisual() {
  ctx.clearRect(0, 0, 1000, 1000);
}
function drawStrokeOnCtx(s) {
  if (!s.points || s.points.length === 0) return;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.thickness;
  ctx.beginPath();
  ctx.moveTo(s.points[0][0], s.points[0][1]);
  for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0], s.points[i][1]);
  // 단일 점도 보이도록 dot 처리.
  if (s.points.length === 1) {
    const [x, y] = s.points[0];
    ctx.arc(x, y, s.thickness / 2, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
  } else {
    ctx.stroke();
  }
}
function redrawAll() {
  clearCanvasVisual();
  for (const s of allStrokes) drawStrokeOnCtx(s);
}

function canvasToLogical(e) {
  const rect = drawCanvas.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches && e.touches[0]) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
  else { clientX = e.clientX; clientY = e.clientY; }
  const x = ((clientX - rect.left) / rect.width) * 1000;
  const y = ((clientY - rect.top) / rect.height) * 1000;
  return [Math.round(x), Math.round(y)];
}

function startStroke(e) {
  if (!amIDrawer) return;
  if (phase !== 'drawing' && phase !== 'bonus') return;
  e.preventDefault();
  isDrawing = true;
  currentStroke = { points: [canvasToLogical(e)], color: currentColor, thickness: currentThickness };
  // 즉시 dot 한 점 찍어두기.
  drawStrokeOnCtx(currentStroke);
}
function moveStroke(e) {
  if (!isDrawing || !currentStroke) return;
  e.preventDefault();
  const pt = canvasToLogical(e);
  currentStroke.points.push(pt);
  // 점진 렌더 — 마지막 두 점 잇기.
  const pts = currentStroke.points;
  ctx.strokeStyle = currentStroke.color;
  ctx.lineWidth = currentStroke.thickness;
  ctx.beginPath();
  ctx.moveTo(pts[pts.length - 2][0], pts[pts.length - 2][1]);
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  ctx.stroke();
}
function endStroke(e) {
  if (!isDrawing) return;
  if (e) e.preventDefault();
  isDrawing = false;
  if (!currentStroke) return;
  allStrokes.push(currentStroke);
  sendIfOpen({
    type: 'SS_STROKE_ADD',
    points: currentStroke.points,
    color: currentStroke.color,
    thickness: currentStroke.thickness,
  });
  currentStroke = null;
}

drawCanvas.addEventListener('pointerdown', startStroke);
drawCanvas.addEventListener('pointermove', moveStroke);
drawCanvas.addEventListener('pointerup', endStroke);
drawCanvas.addEventListener('pointercancel', endStroke);
drawCanvas.addEventListener('pointerleave', endStroke);

/* Toolbar */
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    currentColor = btn.dataset.color;
  });
});
document.querySelectorAll('.thick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.thick-btn').forEach(b => b.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    currentThickness = Number(btn.dataset.thickness) || 8;
  });
});
undoBtn?.addEventListener('click', () => {
  if (!amIDrawer) return;
  if (allStrokes.length === 0) return;
  allStrokes.pop();
  redrawAll();
  sendIfOpen({ type: 'SS_STROKE_UNDO' });
});
clearBtn?.addEventListener('click', () => {
  if (!amIDrawer) return;
  allStrokes = [];
  clearCanvasVisual();
  sendIfOpen({ type: 'SS_CANVAS_CLEAR' });
});

function applyIncomingStroke(msg) {
  if (msg.kind === 'add' && msg.stroke) {
    allStrokes.push(msg.stroke);
    drawStrokeOnCtx(msg.stroke);
  } else if (msg.kind === 'clear') {
    allStrokes = [];
    clearCanvasVisual();
  } else if (msg.kind === 'undo') {
    if (allStrokes.length > 0) allStrokes.pop();
    redrawAll();
  }
}

/* ── Drawing phase 진입 ─────────────────────────────── */
function renderDrawingPhase(round) {
  showScreen('game');
  showSubPanel('drawingPanel');
  amIDrawer = round.drawerId === playerId;
  iGuessedCorrect = false;

  const drawer = players.find(p => p.id === round.drawerId);
  drawerBanner.classList.toggle('is-me', amIDrawer);
  drawerBanner.textContent = amIDrawer
    ? `당신이 그릴 차례! 키워드: ${round.keyword || '?'}`
    : `${drawer ? drawer.name : '?'}님이 그리는 중…`;

  renderKeywordSlot(round);

  // 캔버스 초기화 + 도구바 출제자만.
  allStrokes = [];
  clearCanvasVisual();
  canvasToolbar.classList.toggle('is-hidden', !amIDrawer);
  drawCanvas.style.cursor = amIDrawer ? 'crosshair' : 'not-allowed';

  // 채팅: 출제자도 자유 입력 (치팅 허용). 정답자는 사이드 채널만.
  chatInput.disabled = false;
  chatSend.disabled = false;
  chatInput.placeholder = amIDrawer ? '아무 말이나… (정답 단어도 OK)' : '추측을 입력…';
}

/* ── Chat ──────────────────────────────────────────── */
function appendChat({ text, name: nm, system, correct, drawer, side, isMe }) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  if (system) div.classList.add('is-system');
  if (correct) div.classList.add('is-correct');
  if (drawer) div.classList.add('is-drawer');
  if (side) div.classList.add('is-side');
  if (nm && !system) {
    const span = document.createElement('span');
    span.className = 'chat-msg__name';
    if (isMe) span.classList.add('is-me');
    span.textContent = nm;
    div.appendChild(span);
  }
  const t = document.createElement('span');
  t.textContent = text;
  div.appendChild(t);
  chatMessages.appendChild(div);
  // Auto-scroll to bottom.
  chatMessages.scrollTop = chatMessages.scrollHeight;
  // 최근 N줄만 유지.
  while (chatMessages.children.length > 50) chatMessages.removeChild(chatMessages.firstChild);
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  if (phase !== 'drawing' && phase !== 'bonus') return;
  sendIfOpen({ type: 'SS_GUESS', text });
  chatInput.value = '';
});

/* ── Round end / Game end ───────────────────────────── */
function renderRoundEnd(msg) {
  showSubPanel('roundEndPanel');
  const reasonText = {
    timeout: '시간 종료',
    'bonus-timeout': '보너스 시간 종료',
    'drawer-disconnect': '출제자가 나갔어요',
    'all-correct': '모두 맞혔어요!',
    'insufficient-players': '인원이 부족했어요',
  }[msg.reason] || '라운드 종료';
  roundEndKeyword.textContent = msg.keyword ? `정답: ${msg.keyword}` : '정답 없음';
  roundEndReason.textContent = reasonText;
  roundEndDeltas.innerHTML = '';
  const sorted = [...players].sort((a, b) => (msg.scores[b.id] || 0) - (msg.scores[a.id] || 0));
  for (const p of sorted) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = (p.id === playerId ? `${p.name} (나)` : p.name);
    const right = document.createElement('span');
    const delta = msg.perPlayerDelta[p.id] || 0;
    const total = msg.scores[p.id] || 0;
    right.innerHTML = `<span class="delta-gain">+${delta}</span> · ${total}`;
    li.appendChild(left);
    li.appendChild(right);
    roundEndDeltas.appendChild(li);
  }
}

function renderGameEnd(rankings) {
  showScreen('result');
  rankingsList.innerHTML = '';
  for (const r of rankings) {
    const li = document.createElement('li');
    if (r.id === playerId) li.classList.add('is-me');
    li.innerHTML = `<span class="rank-num">${r.rank}</span><span class="rank-name">${r.name}${r.id === playerId ? ' (나)' : ''}</span><span class="rank-score">${r.score}점</span>`;
    rankingsList.appendChild(li);
  }
}

/* ── WS ─────────────────────────────────────────────── */
function sendIfOpen(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  if (!isMultiplayer) { setStatus('단일 플레이는 아직 지원하지 않아요.', 'is-error'); return; }
  const url = WORKER_URL.replace(/^http/, 'ws') + `/api/rooms/${code}`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    setStatus('방에 합류 중…');
    ws.send(JSON.stringify({
      type: 'join_game',
      gameId: 'sseuk-sseuk',
      playerId,
    }));
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  });

  ws.addEventListener('close', () => setStatus('연결이 끊겼어요.', 'is-error'));
  ws.addEventListener('error', () => setStatus('연결 오류가 발생했어요.', 'is-error'));
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'SS_JOINED':
      setStatus(`연결됨 — phase: ${msg.phase}`, 'is-connected');
      players = msg.players;
      phase = msg.phase;
      currentRoundIdx = msg.currentRoundIdx || 0;
      totalRounds = msg.totalRounds || 5;
      {
        const me = players.find(p => p.id === playerId);
        if (me) { myCharacterId = me.characterId; applyMyCharacter(); }
      }
      renderRoster();
      if (msg.round && phase !== 'waiting') {
        currentRound = msg.round;
        applyPhase();
      }
      break;
    case 'SS_PLAYER_UPDATE':
      players = msg.players;
      {
        const me = players.find(p => p.id === playerId);
        if (me && me.characterId !== myCharacterId) { myCharacterId = me.characterId; applyMyCharacter(); }
      }
      renderRoster();
      break;
    case 'SS_COUNTDOWN':
      showScreen('game');
      countdownOverlay.classList.remove('is-hidden');
      countdownNumber.textContent = String(msg.seconds);
      if (msg.seconds <= 1) setTimeout(() => countdownOverlay.classList.add('is-hidden'), 800);
      break;
    case 'SS_VOLUNTEER_OPEN':
      showScreen('game');
      countdownOverlay.classList.add('is-hidden');
      phase = 'volunteering';
      currentRoundIdx = msg.roundIdx;
      totalRounds = msg.totalRounds;
      roundProgress.textContent = `Round ${msg.roundIdx + 1} / ${msg.totalRounds}`;
      renderDifficultyBadge(msg.difficulty);
      timerDisplay.textContent = '';
      showSubPanel('volunteerPanel');
      volunteerBtn.disabled = false;
      volunteerBtn.textContent = '✋ 그리고 싶어요!';
      volunteerList.innerHTML = '';
      startVolunteerCountdown(msg.deadlineAt);
      break;
    case 'SS_VOLUNTEER_UPDATE': {
      volunteerList.innerHTML = '';
      for (const id of msg.volunteers) {
        const p = players.find(x => x.id === id);
        if (!p) continue;
        const chip = document.createElement('span');
        chip.className = 'player-chip';
        if (p.id === playerId) chip.classList.add('is-me');
        chip.textContent = p.name;
        volunteerList.appendChild(chip);
      }
      break;
    }
    case 'SS_DRAWER_SELECTED':
      phase = 'lottery';
      currentRound = {
        drawerId: msg.drawerId,
        keyword: msg.keyword || null,
        syllableCount: msg.syllableCount,
        difficulty: msg.difficulty || null,
      };
      renderDifficultyBadge(msg.difficulty);
      showSubPanel('lotteryPanel');
      runLottery(msg.candidates, msg.drawerId, msg.lotteryMs || 2500);
      break;
    case 'SS_ROUND_START':
      phase = 'drawing';
      // 채팅창 초기화 (라운드별).
      chatMessages.innerHTML = '';
      if (currentRound) {
        currentRound.drawerId = msg.drawerId;
        currentRound.syllableCount = msg.syllableCount;
        if (msg.difficulty) currentRound.difficulty = msg.difficulty;
      } else {
        currentRound = { drawerId: msg.drawerId, syllableCount: msg.syllableCount, keyword: null, difficulty: msg.difficulty || null };
      }
      renderDifficultyBadge(currentRound.difficulty);
      renderDrawingPhase(currentRound);
      startTimer(msg.timeLeftMs, 'normal');
      break;
    case 'SS_STROKE_APPLIED':
      // 출제자가 아니면 캔버스에 반영. 출제자도 clear/undo는 본인이 누른 경우 이미 처리됐으니 무시 가능.
      if (!amIDrawer) applyIncomingStroke(msg);
      break;
    case 'SS_HINT_REVEAL':
      if (msg.kind === 'length') revealLengthHint(msg.value);
      else if (msg.kind === 'letter') revealLetterHint(msg.position, msg.value);
      break;
    case 'SS_HINT_FEEDBACK':
      pulseMatchedSlots(msg.matchedPositions || []);
      break;
    case 'SS_CHAT': {
      const isMe = msg.playerId === playerId;
      appendChat({
        text: msg.text,
        name: msg.name,
        system: !!msg.system,
        drawer: !!msg.drawer,
        side: !!msg.sideChannel,
        isMe,
      });
      break;
    }
    case 'SS_CORRECT':
      if (msg.playerId === playerId) {
        iGuessedCorrect = true;
        // 본인이 맞히면 입력은 그대로 둬도 됨 (사이드 채널로 전송됨).
      }
      // 시스템 메시지로 정답 알림.
      appendChat({
        text: `🎉 ${msg.name}님 정답 (${msg.rank}등)`,
        system: true, correct: true,
      });
      break;
    case 'SS_BONUS_START':
      phase = 'bonus';
      startTimer(msg.bonusMs || 10000, 'bonus');
      break;
    case 'SS_ROUND_END':
      phase = 'roundEnd';
      stopTimer();
      for (const p of players) {
        if (msg.scores[p.id] !== undefined) p.score = msg.scores[p.id];
      }
      renderRoundEnd(msg);
      break;
    case 'SS_GAME_END':
      stopTimer();
      renderGameEnd(msg.rankings);
      break;
    case 'error':
      setStatus(`오류: ${msg.message || '알 수 없음'}`, 'is-error');
      break;
  }
}

function applyPhase() {
  showScreen('game');
  countdownOverlay.classList.add('is-hidden');
  roundProgress.textContent = `Round ${currentRoundIdx + 1} / ${totalRounds}`;
  renderDifficultyBadge(currentRound?.difficulty);
  if (phase === 'drawing' && currentRound) {
    renderDrawingPhase(currentRound);
    if (currentRound.timeLeftMs) startTimer(currentRound.timeLeftMs, 'normal');
  } else if (phase === 'volunteering' && currentRound?.volunteersDeadlineAt) {
    showSubPanel('volunteerPanel');
    startVolunteerCountdown(currentRound.volunteersDeadlineAt);
  } else if (phase === 'bonus' && currentRound) {
    renderDrawingPhase(currentRound);
    startTimer(currentRound.timeLeftMs || 0, 'bonus');
  }
}

connect();
