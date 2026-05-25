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
const replayWrap       = document.getElementById('replayWrap');
const replayCanvas     = document.getElementById('replayCanvas');
const replayCtx        = replayCanvas ? replayCanvas.getContext('2d') : null;
const celebrateImg     = document.getElementById('celebrateImg');
const muteBtn          = document.getElementById('muteBtn');

/* ── Audio (window.SseukAudio from audio.js) ──────────── */
const Audio = window.SseukAudio || { unlockAudio: () => {}, setMuted: () => {}, isMuted: () => false, startBgm: () => {}, stopBgm: () => {}, SFX: { correct: () => {}, countdownTick: () => {}, countdownGo: () => {}, roundEnd: () => {}, hint: () => {}, click: () => {}, gameEnd: () => {} } };
function applyMuteBtn() {
  if (!muteBtn) return;
  const m = Audio.isMuted();
  muteBtn.textContent = m ? '🔇' : '🔊';
  muteBtn.classList.toggle('is-muted', m);
  muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
  muteBtn.setAttribute('aria-label', m ? '음소거 해제' : '음소거');
}
applyMuteBtn();
muteBtn?.addEventListener('click', () => {
  Audio.unlockAudio();
  Audio.setMuted(!Audio.isMuted());
  applyMuteBtn();
});
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

/* waiting/ready 단계에서 사용자에게 "왜 카운트다운이 안 도는지" 알려준다.
 * 서버 _handleSseukReady 는 connected≥2 + 모두 ready 일 때만 시작하므로,
 * 솔로 URL 입장이나 다른 사람을 기다리는 케이스를 명시적으로 안내. */
const SS_MIN_PLAYERS = 2;
function updateWaitingStatus() {
  if (phase !== 'waiting') return;
  const connected = players.filter(p => p.connected);
  const ready = connected.filter(p => p.ready);
  if (connected.length < SS_MIN_PLAYERS) {
    const need = SS_MIN_PLAYERS - connected.length;
    setStatus(`다른 ${need}명을 기다리는 중… (현재 ${connected.length}명)`, 'is-connected');
  } else if (ready.length < connected.length) {
    setStatus(`준비 ${ready.length}/${connected.length} — 모두 Ready 하면 시작해요`, 'is-connected');
  } else {
    setStatus('곧 시작합니다…', 'is-connected');
  }
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

function getPlayerCharId(id) {
  const p = players.find(x => x.id === id);
  return p ? p.characterId : null;
}
function makeCharAvatar(characterId, size = 22, extraClass = '') {
  // 알 수 없는 characterId 면 아예 element 를 만들지 않는다 — src='' 면 일부
  // 브라우저가 broken image 아이콘을 띄우거나 현재 문서를 재요청한다.
  const src = CHAR_IMAGES[characterId];
  if (!src) return null;
  const img = document.createElement('img');
  img.className = 'char-avatar' + (extraClass ? ' ' + extraClass : '');
  img.src = src;
  img.alt = '';
  img.width = size;
  img.height = size;
  img.loading = 'lazy';
  return img;
}
function appendCharAvatar(parent, characterId, size, extraClass) {
  const av = makeCharAvatar(characterId, size, extraClass);
  if (av) parent.appendChild(av);
}

/* ── Roster ─────────────────────────────────────────── */
function renderRoster() {
  waitingPlayers.innerHTML = '';
  // 대기 화면 칩은 현재 connected 인 사람만 — bootStatus 카운트와 일치 시켜
  // 끊긴 사람이 calp 처럼 남는 불일치(코덱스 MEDIUM) 제거.
  for (const p of players) {
    if (!p.connected) continue;
    const chip = document.createElement('span');
    chip.className = 'player-chip';
    if (p.id === playerId) chip.classList.add('is-me');
    if (p.ready) chip.classList.add('is-ready');
    appendCharAvatar(chip, p.characterId, 20);
    const nm = document.createElement('span');
    nm.textContent = p.name;
    chip.appendChild(nm);
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
  // 모바일 AudioContext 는 사용자 제스처에서 resume 해야 동작 — Ready 가 첫 기회.
  Audio.unlockAudio();
  Audio.SFX.click();
  isReady = !isReady;
  readyBtn.textContent = isReady ? '취소' : 'Ready!';
  readyBtn.classList.toggle('is-ready', isReady);
  sendIfOpen({ type: 'SS_READY', ready: isReady });
});
volunteerBtn.addEventListener('click', () => {
  Audio.unlockAudio();
  Audio.SFX.click();
  volunteerBtn.disabled = true;
  volunteerBtn.textContent = '✋ 신청 완료';
  sendIfOpen({ type: 'SS_VOLUNTEER' });
});
function leaveToRoom() {
  intentionalClose = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  try { ws?.close(); } catch {}
  Audio.stopBgm();
  // 광장에서 입장한 세션이면 광장으로 바로 복귀 (닉네임·캐릭터는 광장이 이미
  // localStorage 에 저장해두므로 from=game 으로 진입하면 picker 를 건너뛰고
  // 자동 입장). 직접 링크 등 그 외는 브랜드 랜딩으로 fallback.
  if (window.GameBoot && typeof window.GameBoot.exit === 'function') {
    window.GameBoot.exit();
    return;
  }
  window.location.href = '/';
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
  drawerBanner.innerHTML = '';
  appendCharAvatar(drawerBanner, drawer?.characterId, 32, 'drawer-banner__avatar');
  const text = document.createElement('span');
  text.className = 'drawer-banner__text';
  text.textContent = amIDrawer
    ? `당신이 그릴 차례! 키워드: ${round.keyword || '?'}`
    : `${drawer ? drawer.name : '?'}님이 그리는 중…`;
  drawerBanner.appendChild(text);

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
function appendChat({ text, name: nm, system, correct, drawer, side, isMe, playerId: pid }) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  if (system) div.classList.add('is-system');
  if (correct) div.classList.add('is-correct');
  if (drawer) div.classList.add('is-drawer');
  if (side) div.classList.add('is-side');
  if (nm && !system) {
    if (pid) appendCharAvatar(div, getPlayerCharId(pid), 18, 'chat-msg__avatar');
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

/* 정답 리플레이 — round-end 패널 안에서 allStrokes 를 1.5초 안에 빠르게
 * 재생한 뒤 완성된 그림 그대로 정지. 서버에 추가 페이로드 없이 클라가
 * 라운드 중 누적해둔 스트로크를 그대로 사용한다 (중간 합류자는 strokes 가
 * 비어 있어 replay 자체가 숨겨짐).
 *
 * 의도: 라운드 중간의 clear/undo 히스토리는 재현하지 않는다. "정답 그림이
 * 완성되는 과정"만 보여주는 게 목적이라 출제자가 지웠다 다시 그린 흔적은
 * 의미 없음. allStrokes 는 어차피 라운드 종료 시점의 최종 스트로크 집합.
 *
 * 성능: 매 RAF 마다 clear + 전체 재렌더는 worst-case (200 strokes × 500
 * points) 에서 모바일에 부담. 대신 delta 렌더 — 이전 프레임에서 그린
 * 위치(renderedStrokeIdx, renderedPointIdx) 부터 새 위치까지만 추가로
 * stroke 한다. progress 가 단조 증가하므로 clear 가 필요 없다. */
const REPLAY_DURATION_MS = 1500;
const REPLAY_SOURCE_DIM = 1000;       // drawCanvas 논리 좌표
let replayRafHandle = null;
function clearReplayCanvas() {
  if (!replayCtx) return;
  replayCtx.fillStyle = '#ffffff';
  replayCtx.fillRect(0, 0, replayCanvas.width, replayCanvas.height);
}
function playReplay(strokes) {
  if (!replayCtx || !replayWrap) return;
  if (replayRafHandle) { cancelAnimationFrame(replayRafHandle); replayRafHandle = null; }
  const valid = (strokes || []).filter(s => s && Array.isArray(s.points) && s.points.length > 0);
  const totalPoints = valid.reduce((acc, s) => acc + s.points.length, 0);
  if (totalPoints === 0) {
    replayWrap.classList.add('is-hidden');
    clearReplayCanvas();
    return;
  }
  replayWrap.classList.remove('is-hidden');
  clearReplayCanvas();
  const W = replayCanvas.width;
  const scale = W / REPLAY_SOURCE_DIM;
  replayCtx.lineCap = 'round';
  replayCtx.lineJoin = 'round';

  // Delta-render 상태: 다음으로 그릴 stroke·point 인덱스.
  let renderedStrokeIdx = 0;
  let renderedPointIdx = 0;

  function advanceTo(targetTotal) {
    let cumBefore = 0;
    // 이전 stroke들의 누적 카운트 — current stroke 시작점까지 합.
    for (let i = 0; i < renderedStrokeIdx; i++) cumBefore += valid[i].points.length;
    while (renderedStrokeIdx < valid.length) {
      const s = valid[renderedStrokeIdx];
      const pts = s.points;
      const reachInThis = targetTotal - cumBefore;
      if (reachInThis <= renderedPointIdx) return;
      const stopAt = Math.min(pts.length, reachInThis);
      const color = s.color || '#000';
      const thickness = Math.max(1, (s.thickness || 8) * scale);
      if (renderedPointIdx === 0 && stopAt === 1) {
        // dot — 단일 점은 fill arc 로. 작은 thickness 도 보이도록 max(1).
        const [x, y] = pts[0];
        replayCtx.fillStyle = color;
        replayCtx.beginPath();
        replayCtx.arc(x * scale, y * scale, Math.max(1, thickness / 2), 0, Math.PI * 2);
        replayCtx.fill();
        renderedPointIdx = 1;
      } else if (stopAt > renderedPointIdx) {
        // 새 세그먼트: 이전 마지막 점에서 이어 그리기 위해 max(0, idx-1) 부터 moveTo.
        const fromIdx = Math.max(0, renderedPointIdx - 1);
        replayCtx.strokeStyle = color;
        replayCtx.lineWidth = thickness;
        replayCtx.beginPath();
        replayCtx.moveTo(pts[fromIdx][0] * scale, pts[fromIdx][1] * scale);
        for (let i = Math.max(1, renderedPointIdx); i < stopAt; i++) {
          replayCtx.lineTo(pts[i][0] * scale, pts[i][1] * scale);
        }
        replayCtx.stroke();
        renderedPointIdx = stopAt;
      }
      if (renderedPointIdx >= pts.length) {
        cumBefore += pts.length;
        renderedStrokeIdx += 1;
        renderedPointIdx = 0;
      } else {
        // 아직 이번 stroke 미완 — 다음 RAF 에서 이어 그리기.
        return;
      }
    }
  }

  const startedAt = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / REPLAY_DURATION_MS);
    const showUpTo = Math.floor(progress * totalPoints);
    advanceTo(showUpTo);
    if (progress < 1) {
      replayRafHandle = requestAnimationFrame(tick);
    } else {
      // 마지막 점까지 확실히 그리기 (반올림 누락 방지).
      advanceTo(totalPoints);
      replayRafHandle = null;
    }
  };
  replayRafHandle = requestAnimationFrame(tick);
}

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
  // 다 맞춘 경우에만 폭죽 일러스트 한 번 튀어오르듯 표시. 같은 라운드 결과
  // 패널이 재사용되므로 is-hidden 토글 + 애니메이션 재시작 트릭 사용.
  if (celebrateImg) {
    if (msg.reason === 'all-correct') {
      celebrateImg.classList.remove('is-hidden');
      celebrateImg.classList.remove('pop-anim');
      void celebrateImg.offsetWidth;  // reflow → 애니메이션 재시작
      celebrateImg.classList.add('pop-anim');
    } else {
      celebrateImg.classList.add('is-hidden');
    }
  }
  // 정답 그림 리플레이 재생 (그릴 게 없으면 함수가 wrap을 숨김).
  playReplay(allStrokes);
  roundEndDeltas.innerHTML = '';
  const sorted = [...players].sort((a, b) => (msg.scores[b.id] || 0) - (msg.scores[a.id] || 0));
  for (const p of sorted) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.className = 'round-end-deltas__who';
    appendCharAvatar(left, p.characterId, 24, 'round-end-deltas__avatar');
    const nm = document.createElement('span');
    nm.textContent = (p.id === playerId ? `${p.name} (나)` : p.name);
    left.appendChild(nm);
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
    const num = document.createElement('span');
    num.className = 'rank-num';
    num.textContent = String(r.rank);
    li.appendChild(num);
    appendCharAvatar(li, r.characterId, 32, 'rank-avatar');
    const nm = document.createElement('span');
    nm.className = 'rank-name';
    nm.textContent = r.name + (r.id === playerId ? ' (나)' : '');
    li.appendChild(nm);
    const sc = document.createElement('span');
    sc.className = 'rank-score';
    sc.textContent = `${r.score}점`;
    li.appendChild(sc);
    rankingsList.appendChild(li);
  }
}

/* ── WS ─────────────────────────────────────────────── */
function sendIfOpen(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/* 자동 재접속 — 모바일 백그라운드 / 일시적 네트워크 단절에서 사용자가
 * 직접 광장으로 다녀오지 않아도 되도록. 서버측 _handleSseukJoinGame 가 같은
 * playerId 로 join_game 이 다시 오면 phase-aware 스냅샷을 돌려보내고
 * connected=true 로 표시하므로, 클라는 동일 url 로 다시 붙기만 하면 된다.
 * (단, 출제자가 끊긴 경우 서버가 즉시 'drawer-disconnect' 로 라운드 종료
 * 시키는 정책은 그대로 — 재접속이 빨리 돼도 그 라운드는 이미 끝나 있다.) */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS  = 8000;
const RECONNECT_MAX_ATTEMPTS = 10;
let reconnectTimer = null;
let reconnectAttempts = 0;
let intentionalClose = false;       // leaveToRoom 가 true 로 세팅 → 재접속 안 함.
let everJoined = false;             // 첫 SS_JOINED 도착 후 true. 그 전 실패는 단순 연결 오류.

function connect() {
  if (!isMultiplayer) { setStatus('단일 플레이는 아직 지원하지 않아요.', 'is-error'); return; }
  openSocket();
}

function openSocket() {
  const url = WORKER_URL.replace(/^http/, 'ws') + `/api/rooms/${code}`;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    setStatus(everJoined ? '재접속 중…' : '방에 합류 중…');
    ws.send(JSON.stringify({
      type: 'join_game',
      gameId: 'sseuk-sseuk',
      playerId,
    }));
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg && msg.type === 'SS_JOINED') {
      everJoined = true;
      reconnectAttempts = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    }
    handleMessage(msg);
  });

  ws.addEventListener('close', () => {
    if (intentionalClose) return;       // leaveToRoom 호출됨 — 재접속 금지.
    if (everJoined) {
      setStatus('연결이 끊겼어요. 재접속 중…', 'is-error');
      scheduleReconnect();
    } else {
      setStatus('연결이 끊겼어요.', 'is-error');
      scheduleReconnect();              // 첫 연결도 한두 번은 재시도.
    }
  });

  // error 이벤트는 close 가 뒤따라 와서 처리하므로 여기서는 status 만.
  ws.addEventListener('error', () => {
    if (!everJoined) setStatus('연결 오류가 발생했어요.', 'is-error');
  });
}

function scheduleReconnect() {
  if (intentionalClose) return;
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  if (reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
    setStatus('재접속 실패 — 새로고침해주세요.', 'is-error');
    return;
  }
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1), RECONNECT_MAX_MS);
  setStatus(`재접속 중… (${reconnectAttempts})`, 'is-error');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, delay);
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'SS_JOINED':
      players = msg.players;
      phase = msg.phase;
      currentRoundIdx = msg.currentRoundIdx || 0;
      totalRounds = msg.totalRounds || 5;
      {
        const me = players.find(p => p.id === playerId);
        if (me) { myCharacterId = me.characterId; applyMyCharacter(); }
      }
      renderRoster();
      updateWaitingStatus();
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
      updateWaitingStatus();
      break;
    case 'SS_COUNTDOWN':
      showScreen('game');
      countdownOverlay.classList.remove('is-hidden');
      countdownNumber.textContent = String(msg.seconds);
      Audio.SFX.countdownTick();
      if (msg.seconds <= 1) {
        Audio.startBgm();
        setTimeout(() => countdownOverlay.classList.add('is-hidden'), 800);
      }
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
        appendCharAvatar(chip, p.characterId, 20);
        const nm = document.createElement('span');
        nm.textContent = p.name;
        chip.appendChild(nm);
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
      Audio.SFX.countdownGo();
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
      Audio.SFX.hint();
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
        playerId: msg.playerId,
        system: !!msg.system,
        drawer: !!msg.drawer,
        side: !!msg.sideChannel,
        isMe,
      });
      break;
    }
    case 'SS_CORRECT':
      Audio.SFX.correct();
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
      Audio.SFX.roundEnd();
      stopTimer();
      for (const p of players) {
        if (msg.scores[p.id] !== undefined) p.score = msg.scores[p.id];
      }
      renderRoundEnd(msg);
      break;
    case 'SS_GAME_END':
      Audio.stopBgm();
      Audio.SFX.gameEnd();
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
    restoreSnapshotStrokes(currentRound);
    if (currentRound.timeLeftMs) startTimer(currentRound.timeLeftMs, 'normal');
  } else if (phase === 'volunteering' && currentRound?.volunteersDeadlineAt) {
    showSubPanel('volunteerPanel');
    startVolunteerCountdown(currentRound.volunteersDeadlineAt);
  } else if (phase === 'bonus' && currentRound) {
    renderDrawingPhase(currentRound);
    restoreSnapshotStrokes(currentRound);
    startTimer(currentRound.timeLeftMs || 0, 'bonus');
  }
}

/* SS_JOINED 스냅샷의 strokes 를 캔버스에 다시 그려넣는다. renderDrawingPhase
 * 가 캔버스를 한 번 비우므로, 그 이후에 호출해야 안전하다. */
function restoreSnapshotStrokes(round) {
  if (!round || !Array.isArray(round.strokes) || round.strokes.length === 0) return;
  allStrokes = round.strokes.slice();
  redrawAll();
}

connect();
