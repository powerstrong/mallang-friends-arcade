/* 말랑프렌즈 슥슥 — Phase A client.
 *
 * 흐름: setup(캐릭터/ready) → countdown → game(volunteering → lottery → drawing → roundEnd) × 5 → result
 * Phase B: canvas + stroke 동기화 추가.
 * Phase D: chat + 정답/근접 힌트 + 자리 일치 펄스.
 * Phase E: mobile 폴리시 + 채팅 오버레이.
 */

const CHAR_IMAGES = {
  'mochi-rabbit':    '/prototypes/jump-climber/assets/토끼 메인 이미지.png',
  'pudding-hamster': '/prototypes/jump-climber/assets/햄스터 메인 이미지.png',
  'peach-chick':     '/prototypes/jump-climber/assets/병아리 메인 이미지.png',
  'latte-puppy':     '/prototypes/jump-climber/assets/라떼 메인 이미지.png',
  'mint-kitten':     '/prototypes/jump-climber/assets/고양이 메인이미지.png',
};

const { code, name, playerId, isMultiplayer } = window.GameBoot;
const WORKER_URL = window.WORKER_URL;

let ws = null;
let selectedChar = 'mochi-rabbit';
let isReady = false;
let players = [];
let phase = 'waiting';
let currentRoundIdx = 0;
let totalRounds = 5;
let currentRound = null;   // { drawerId, keyword?(나만), syllableCount, ... }
let timerInterval = null;
let timerDeadlineAt = null;
let timerMode = 'normal';  // 'normal' | 'bonus'
let lotteryInterval = null;

/* ── DOM ─────────────────────────────────────────────── */
const setupScreen      = document.getElementById('setupScreen');
const gameScreen       = document.getElementById('gameScreen');
const resultScreen     = document.getElementById('resultScreen');
const bootStatus       = document.getElementById('bootStatus');
const waitingPlayers   = document.getElementById('waitingPlayers');
const readyBtn         = document.getElementById('readyBtn');
const roundProgress    = document.getElementById('roundProgress');
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
const roundEndPanel    = document.getElementById('roundEndPanel');
const roundEndKeyword  = document.getElementById('roundEndKeyword');
const roundEndReason   = document.getElementById('roundEndReason');
const roundEndDeltas   = document.getElementById('roundEndDeltas');
const rankingsList     = document.getElementById('rankingsList');
const exitBtn          = document.getElementById('exitBtn');

/* ── 화면 전환 ───────────────────────────────────────── */
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

/* ── Roster / 본인 라벨 ─────────────────────────────── */
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

/* ── 캐릭터 선택 ────────────────────────────────────── */
document.querySelectorAll('.character-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.character-card').forEach(c => c.classList.remove('is-selected'));
    card.classList.add('is-selected');
    selectedChar = card.dataset.character;
    sendIfOpen({ type: 'SS_SELECT_CHARACTER', characterId: selectedChar });
  });
});

/* ── Ready ──────────────────────────────────────────── */
readyBtn.addEventListener('click', () => {
  isReady = !isReady;
  readyBtn.textContent = isReady ? '취소' : 'Ready!';
  readyBtn.classList.toggle('is-ready', isReady);
  sendIfOpen({ type: 'SS_READY', ready: isReady });
});

/* ── Volunteer ──────────────────────────────────────── */
volunteerBtn.addEventListener('click', () => {
  volunteerBtn.disabled = true;
  volunteerBtn.textContent = '✋ 신청 완료';
  sendIfOpen({ type: 'SS_VOLUNTEER' });
});

/* ── Exit ──────────────────────────────────────────── */
exitBtn?.addEventListener('click', () => {
  window.location.href = `/?code=${encodeURIComponent(code || '')}`;
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

/* ── Volunteer 타이머 ───────────────────────────────── */
let volunteerCountdownInterval = null;
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

/* ── Drawing phase 표시 ─────────────────────────────── */
function renderDrawingPhase(round) {
  showScreen('game');
  showSubPanel('drawingPanel');
  const isMe = round.drawerId === playerId;
  const drawer = players.find(p => p.id === round.drawerId);
  drawerBanner.classList.toggle('is-me', isMe);
  drawerBanner.textContent = isMe
    ? `당신이 그릴 차례! 키워드: ${round.keyword || '?'}`
    : `${drawer ? drawer.name : '?'}님이 그리는 중…`;
  // 글자 수 슬롯.
  keywordSlot.innerHTML = '';
  for (let i = 0; i < round.syllableCount; i++) {
    const cell = document.createElement('span');
    cell.className = 'keyword-slot__cell';
    cell.textContent = '_';
    keywordSlot.appendChild(cell);
  }
}

/* ── Round end / Game end ───────────────────────────── */
function renderRoundEnd(msg) {
  showSubPanel('roundEndPanel');
  const reasonText = {
    timeout: '시간 종료',
    'drawer-disconnect': '출제자가 나갔어요',
    'all-correct': '모두 맞혔어요!',
    'insufficient-players': '인원이 부족했어요',
  }[msg.reason] || '라운드 종료';
  roundEndKeyword.textContent = msg.keyword ? `정답: ${msg.keyword}` : '정답 없음';
  roundEndReason.textContent = reasonText;
  roundEndDeltas.innerHTML = '';
  // 점수 정렬해서 표시.
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

/* ── WS ──────────────────────────────────────────── */
function sendIfOpen(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  if (!isMultiplayer) {
    setStatus('단일 플레이는 아직 지원하지 않아요.', 'is-error');
    return;
  }
  const url = WORKER_URL.replace(/^http/, 'ws') + `/api/rooms/${code}`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    setStatus('방에 합류 중…');
    ws.send(JSON.stringify({
      type: 'join_game',
      gameId: 'sseuk-sseuk',
      playerId,
      characterId: selectedChar,
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
      renderRoster();
      // 중간 합류 시 라운드 상태 즉시 복원.
      if (msg.round && phase !== 'waiting') {
        currentRound = msg.round;
        applyPhase();
      }
      break;
    case 'SS_PLAYER_UPDATE':
      players = msg.players;
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
        keyword: msg.keyword || null,   // 출제자에게만 옴
        syllableCount: msg.syllableCount,
      };
      showSubPanel('lotteryPanel');
      runLottery(msg.candidates, msg.drawerId, msg.lotteryMs || 2500);
      break;
    case 'SS_ROUND_START':
      phase = 'drawing';
      if (currentRound) {
        currentRound.drawerId = msg.drawerId;
        currentRound.syllableCount = msg.syllableCount;
      } else {
        currentRound = { drawerId: msg.drawerId, syllableCount: msg.syllableCount, keyword: null };
      }
      renderDrawingPhase(currentRound);
      startTimer(msg.timeLeftMs, 'normal');
      break;
    case 'SS_ROUND_END':
      phase = 'roundEnd';
      stopTimer();
      // 점수 최신화.
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

/* 중간 합류 시 현재 phase로 즉시 점프 */
function applyPhase() {
  showScreen('game');
  countdownOverlay.classList.add('is-hidden');
  roundProgress.textContent = `Round ${currentRoundIdx + 1} / ${totalRounds}`;
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
