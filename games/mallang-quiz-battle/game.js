/* ── 상수 ──────────────────────────────────────────── */
const CHAR_IMAGES = {
  'mochi-rabbit':    '/games/jump-climber/assets/토끼 메인 이미지.png',
  'pudding-hamster': '/games/jump-climber/assets/햄스터 메인 이미지.png',
  'peach-chick':     '/games/jump-climber/assets/병아리 메인 이미지.png',
  'latte-puppy':     '/games/jump-climber/assets/라떼 메인 이미지.png',
  'mint-kitten':     '/games/jump-climber/assets/고양이 메인이미지.png',
};

// 캐릭터 반응 포즈 (점프 클라이머 자산 재활용)
const CHAR_POSES = {
  'mochi-rabbit': {
    idle: CHAR_IMAGES['mochi-rabbit'],
    jump: '/games/jump-climber/assets/토끼 점프 위로.png',
    fall: '/games/jump-climber/assets/토끼 추락.png',
  },
  'pudding-hamster': {
    idle: CHAR_IMAGES['pudding-hamster'],
    jump: '/games/jump-climber/assets/햄스터 점프 위로.png',
    fall: '/games/jump-climber/assets/햄스터 추락.png',
  },
  'peach-chick': {
    idle: CHAR_IMAGES['peach-chick'],
    jump: '/games/jump-climber/assets/병아리 점프.png',
    fall: '/games/jump-climber/assets/병아리 추락.png',
  },
  'latte-puppy': {
    idle: CHAR_IMAGES['latte-puppy'],
    jump: '/games/jump-climber/assets/라떼 점프 위로.png',
    fall: '/games/jump-climber/assets/라떼 추락.png',
  },
  'mint-kitten': {
    idle: CHAR_IMAGES['mint-kitten'],
    jump: '/games/jump-climber/assets/고양이 점프 위로.png',
    fall: '/games/jump-climber/assets/고양이 추락.png',
  },
};

function getPoses(characterId) {
  return CHAR_POSES[characterId] || CHAR_POSES['mochi-rabbit'];
}

const PLAYER_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
];

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

/* ── 상태 ──────────────────────────────────────────── */
const { code, name, playerId, isMultiplayer } = window.GameBoot;
const WORKER_URL = window.WORKER_URL;

let ws;
let players = [];
let selectedChar = 'mochi-rabbit';
let isReady = false;
let currentQuestion = null;
let submittedIds = new Set();
let myAnswer = null;
let timerInterval = null;
let chatVisible = false;
let chatHideTimer = null;
let answerHistory = {};
let reconnectCount = 0;
let gameEnded = false;
let comboCount = 0;
let wasFirstSubmit = false;
let hintUsedThisQuestion = false;

/* ── DOM 참조 ──────────────────────────────────────── */
const setupScreen       = document.getElementById('setupScreen');
const gameScreen        = document.getElementById('gameScreen');
const resultScreen      = document.getElementById('resultScreen');
const readyBtn          = document.getElementById('readyBtn');
const scoreBar          = document.getElementById('scoreBar');
const questionProgress  = document.getElementById('questionProgress');
const timerDisplay      = document.getElementById('timerDisplay');
const countdownOverlay  = document.getElementById('countdownOverlay');
const countdownNumber   = document.getElementById('countdownNumber');
const questionText      = document.getElementById('questionText');
const optionGrid        = document.getElementById('optionGrid');
const revealPanel       = document.getElementById('revealPanel');
const revealResult      = document.getElementById('revealResult');
const revealExplanation = document.getElementById('revealExplanation');
const waitingPlayers    = document.getElementById('waitingPlayers');
const rankingsList      = document.getElementById('rankingsList');
const winnerChar        = document.getElementById('winnerChar');
const winnerName        = document.getElementById('winnerName');
const winnerScore       = document.getElementById('winnerScore');
const chatOverlay       = document.getElementById('chatOverlay');
const chatMessages      = document.getElementById('chatMessages');
const chatToggle        = document.getElementById('chatToggle');
const chatInputWrap     = document.getElementById('chatInputWrap');
const chatInput         = document.getElementById('chatInput');
const chatSend          = document.getElementById('chatSend');
const hintBtn           = document.getElementById('hintBtn');

/* ── 캐릭터 선택 ────────────────────────────────────── */
document.querySelectorAll('.character-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.character-card').forEach(c => c.classList.remove('is-selected'));
    card.classList.add('is-selected');
    selectedChar = card.dataset.character;
    sendIfOpen({ type: 'QUIZ_SELECT_CHARACTER', characterId: selectedChar });
  });
});

/* ── Ready 버튼 ─────────────────────────────────────── */
readyBtn.addEventListener('click', () => {
  isReady = !isReady;
  readyBtn.textContent = isReady ? '취소' : 'Ready!';
  readyBtn.classList.toggle('is-ready', isReady);
  sendIfOpen({ type: 'QUIZ_READY', ready: isReady });
});

/* ── 힌트 버튼 ──────────────────────────────────────── */
hintBtn.addEventListener('click', () => {
  if (!currentQuestion) return;
  if (hintUsedThisQuestion) return;
  if (myAnswer !== null) return;
  hintBtn.disabled = true;
  sendIfOpen({
    type: 'QUIZ_HINT',
    questionIndex: currentQuestion.questionIndex,
  });
});

/* ── WebSocket 연결 ──────────────────────────────────── */
function connect() {
  const wsUrl = WORKER_URL.replace(/^http/, 'ws') + '/api/rooms/' + code;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    reconnectCount = 0;
    ws.send(JSON.stringify({
      type: 'join_game',
      gameId: 'mallang-quiz-battle',
      playerId,
      characterId: selectedChar,
    }));
  };

  ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = (e) => {
    if (gameEnded || e.code === 1000) return;
    reconnectCount++;
    if (reconnectCount > 5) return;
    setTimeout(connect, Math.min(reconnectCount * 2000, 10000));
  };
}

function sendIfOpen(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

/* ── 메시지 디스패처 ─────────────────────────────────── */
function handleMessage(msg) {
  switch (msg.type) {
    case 'QUIZ_JOINED':        onJoined(msg);       break;
    case 'QUIZ_PLAYER_UPDATE': onPlayerUpdate(msg); break;
    case 'QUIZ_COUNTDOWN':     onCountdown(msg);    break;
    case 'QUIZ_QUESTION':      onQuestion(msg);     break;
    case 'QUIZ_SUBMITTED':     onSubmitted(msg);    break;
    case 'QUIZ_HINT_RESULT':   onHintResult(msg);   break;
    case 'QUIZ_REVEAL':        onReveal(msg);       break;
    case 'QUIZ_END':           onEnd(msg);          break;
    case 'new_record':         onNewRecord(msg);    break;
    case 'chat':               onChat(msg);         break;
  }
}

function onNewRecord(msg) {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:10000',
    'display:flex;align-items:center;justify-content:center',
    'background:rgba(0,0,0,0.55);backdrop-filter:blur(4px)',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'background:linear-gradient(135deg,#ffde2e,#ffb800)',
    'padding:32px 36px;border-radius:24px;text-align:center',
    'box-shadow:0 20px 48px rgba(0,0,0,0.28)',
    'font-family:"Noto Sans KR",sans-serif',
    'animation:_nr_pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
  ].join(';');

  card.innerHTML = `
    <style>@keyframes _nr_pop{from{transform:scale(0.7);opacity:0}to{transform:scale(1);opacity:1}}</style>
    <div style="font-size:3.2rem;line-height:1">🏆</div>
    <div style="margin-top:10px;font-size:1.25rem;font-weight:800;color:#4e3400">이번 주 신기록!</div>
    <div style="margin:10px 0;font-size:2.6rem;font-weight:900;color:#182338">${msg.score}<span style="font-size:1.1rem">점</span></div>
    ${msg.previousBest != null ? `<div style="font-size:0.88rem;color:rgba(78,52,0,0.72);font-weight:600">이전 기록: ${msg.previousBest}점</div>` : ''}
    <div style="margin-top:14px;display:inline-block;background:#fff;padding:6px 18px;border-radius:12px;font-weight:800;color:#d97706">${msg.rank}위 달성!</div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.style.transition = 'opacity 0.4s';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 400);
  }, 3000);
}

/* ── 메시지 핸들러 ────────────────────────────────────── */
function onJoined(msg) {
  players = msg.players || [];
  answerHistory = {};
  comboCount = 0;
  wasFirstSubmit = false;
  renderSetupPlayers();
  renderScoreBar();
}

function onPlayerUpdate(msg) {
  players = msg.players || [];
  renderSetupPlayers();
  renderScoreBar();
}

function onCountdown(msg) {
  showScreen('game');
  countdownOverlay.classList.remove('is-hidden');

  // 숫자마다 pop 애니메이션 재실행
  countdownNumber.style.animation = 'none';
  countdownNumber.offsetWidth; // force reflow
  countdownNumber.textContent = msg.seconds;
  countdownNumber.style.animation = 'pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';

  questionText.textContent = '';
  optionGrid.innerHTML = '';
  revealPanel.classList.add('is-hidden');
  timerDisplay.textContent = '';
  questionProgress.textContent = '';
  hintBtn.disabled = true;
  hintBtn.classList.remove('is-used');
}

function onQuestion(msg) {
  currentQuestion = msg;
  myAnswer = null;
  wasFirstSubmit = false;
  hintUsedThisQuestion = false;
  submittedIds = new Set();

  countdownOverlay.classList.add('is-hidden');
  revealPanel.classList.add('is-hidden');

  // 힌트 버튼 초기화
  hintBtn.disabled = false;
  hintBtn.classList.remove('is-used');
  hintBtn.firstChild.textContent = '💡 힌트 ';

  questionProgress.textContent = `Q ${msg.questionIndex + 1} / ${msg.total}`;
  questionText.textContent = msg.question;

  optionGrid.innerHTML = '';
  msg.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.type = 'button';
    btn.innerHTML =
      `<span class="option-label">${OPTION_LABELS[i]}</span>` +
      `<span class="option-text">${escHtml(opt)}</span>`;
    btn.addEventListener('click', (e) => {
      addRipple(btn, e);
      submitAnswer(i);
    });
    optionGrid.appendChild(btn);
  });

  updateSubmittedIndicators();
  startTimer(msg.timeLimit);
}

function onSubmitted(msg) {
  submittedIds.add(msg.playerId);
  updateSubmittedIndicators();
}

function onHintResult(msg) {
  if (!currentQuestion || msg.questionIndex !== currentQuestion.questionIndex) return;
  hintUsedThisQuestion = true;
  hintBtn.disabled = true;
  hintBtn.classList.add('is-used');
  hintBtn.firstChild.textContent = '💡 사용됨 ';

  const btns = [...optionGrid.querySelectorAll('.option-btn')];
  (msg.eliminated || []).forEach(i => {
    if (btns[i]) {
      btns[i].classList.add('is-eliminated');
      btns[i].disabled = true;
    }
  });
}

function onReveal(msg) {
  stopTimer();

  // 점수 변화량 계산 (업데이트 전)
  const myBefore = players.find(p => p.id === playerId);
  const prevScore = myBefore ? (myBefore.score || 0) : 0;

  // 점수 + 답변 기록 업데이트
  players = players.map(p => {
    const entry = msg.scores.find(s => s.id === p.id);
    return entry ? { ...p, score: entry.score } : p;
  });

  const qIdx = currentQuestion ? currentQuestion.questionIndex : -1;
  if (qIdx >= 0) {
    players.forEach(p => {
      if (!answerHistory[p.id]) answerHistory[p.id] = {};
      const submitted = msg.submissions ? msg.submissions[p.id] : undefined;
      answerHistory[p.id][qIdx] = submitted !== undefined
        ? submitted === msg.correctIndex
        : null;
    });
  }

  renderScoreBar();

  // 새로 공개된 O/X 셀에 stamp 애니메이션
  if (qIdx >= 0) {
    scoreBar.querySelectorAll('tr[data-player-id]').forEach(tr => {
      const qCells = tr.querySelectorAll('.st-q');
      const cell = qCells[qIdx];
      if (cell && (cell.classList.contains('st-correct') || cell.classList.contains('st-wrong'))) {
        cell.classList.add('stamp');
      }
    });
  }

  // 캐릭터 반응 (점프/추락/시간초과)
  players.forEach(p => {
    const sub = msg.submissions ? msg.submissions[p.id] : undefined;
    if (sub === undefined) playCharReaction(p.id, 'timeout');
    else if (sub === msg.correctIndex) playCharReaction(p.id, 'correct');
    else playCharReaction(p.id, 'wrong');
  });

  // 내 점수 상승 float
  const myAfter = players.find(p => p.id === playerId);
  const newScore = myAfter ? (myAfter.score || 0) : 0;
  const delta = newScore - prevScore;
  if (delta > 0) floatScore(delta);

  // 정답/오답 버튼 표시
  const btns = [...optionGrid.querySelectorAll('.option-btn')];
  btns.forEach((btn, i) => {
    btn.disabled = true;
    if (i === msg.correctIndex) btn.classList.add('is-correct');
    else if (i === myAnswer)    btn.classList.add('is-wrong');
  });

  const timedOut = myAnswer === null;
  const correct  = myAnswer === msg.correctIndex;

  const myUsedHint = Array.isArray(msg.hintUsedIds) && msg.hintUsedIds.includes(playerId);
  revealResult.textContent = timedOut ? '⏱ 시간 초과' : correct ? '🎉 정답!' : '❌ 오답';
  revealResult.className   = 'reveal-result ' + (correct ? 'is-correct' : 'is-wrong');
  if (myUsedHint && correct) {
    const tag = document.createElement('span');
    tag.className = 'reveal-hint-tag';
    tag.textContent = '💡 힌트 사용 (-40)';
    revealResult.appendChild(tag);
  }
  revealExplanation.textContent = msg.explanation;
  revealPanel.classList.remove('is-hidden');

  // 이펙트
  if (correct) {
    comboCount++;
    flashScreen('correct');
    spawnConfetti(40, 1500);
    if (wasFirstSubmit) showFirstBadge();
    if (comboCount >= 2) showComboBanner(comboCount);
  } else {
    comboCount = 0;
    if (!timedOut) flashScreen('wrong');
  }
}

function onEnd(msg) {
  stopTimer();
  gameEnded = true;
  const winner = msg.rankings[0];

  winnerChar.src = CHAR_IMAGES[winner.characterId] || '';
  winnerChar.alt = winner.name;
  winnerName.textContent = winner.name;
  winnerScore.textContent = winner.score + '점';

  rankingsList.innerHTML = '';
  msg.rankings.forEach(r => {
    const li = document.createElement('li');
    li.className = 'ranking-item';
    const color = PLAYER_COLORS[r.colorIndex % PLAYER_COLORS.length];
    li.innerHTML =
      `<span class="ranking-rank">${r.rank}</span>` +
      `<img class="ranking-char" src="${CHAR_IMAGES[r.characterId] || ''}" alt="${escHtml(r.name)}" />` +
      `<span class="ranking-name" style="color:${color}">${escHtml(r.name)}</span>` +
      `<span class="ranking-score">${r.score}점</span>`;
    rankingsList.appendChild(li);
  });

  showScreen('result');
  spawnConfetti(120, 4000);
}

function onChat(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  const color = PLAYER_COLORS[msg.colorIndex % PLAYER_COLORS.length];
  div.innerHTML =
    `<span class="chat-name" style="color:${color}">${escHtml(msg.name)}</span> ${escHtml(msg.text)}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  showChatBriefly();
}

/* ── 답 제출 ─────────────────────────────────────────── */
function submitAnswer(index) {
  if (myAnswer !== null) return;
  wasFirstSubmit = submittedIds.size === 0;
  myAnswer = index;

  // 답 제출 후에는 힌트 사용 불가
  hintBtn.disabled = true;

  [...optionGrid.querySelectorAll('.option-btn')].forEach((btn, i) => {
    btn.disabled = true;
    if (i === index) btn.classList.add('is-selected');
  });

  sendIfOpen({
    type: 'QUIZ_ANSWER',
    questionIndex: currentQuestion.questionIndex,
    answerIndex: index,
  });
}

/* ── 타이머 ──────────────────────────────────────────── */
function startTimer(seconds) {
  stopTimer();
  let remaining = seconds;
  timerDisplay.textContent = remaining;
  timerDisplay.className = 'timer-display';

  timerInterval = setInterval(() => {
    remaining -= 1;
    timerDisplay.textContent = Math.max(0, remaining);
    if (remaining <= 5) timerDisplay.classList.add('is-urgent');
    if (remaining <= 0) stopTimer();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

/* ══════════════════════════════════════════════════════
   이펙트
   ══════════════════════════════════════════════════════ */

/* confetti ─ canvas 파티클 */
function spawnConfetti(count = 60, duration = 2000) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999;';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const colors = ['#7c3aed','#f59e0b','#ef4444','#22c55e','#3b82f6','#ec4899','#14b8a6','#f97316'];
  const particles = Array.from({ length: count }, () => ({
    x:    Math.random() * canvas.width,
    y:    -10 - Math.random() * 80,
    vx:   (Math.random() - 0.5) * 4,
    vy:   2 + Math.random() * 4,
    r:    4 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot:  Math.random() * Math.PI * 2,
    rotV: (Math.random() - 0.5) * 0.15,
    rect: Math.random() > 0.4,
  }));

  const start = performance.now();
  function draw(now) {
    const t = now - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fadeStart = duration * 0.65;
    const alpha = t > fadeStart ? Math.max(0, 1 - (t - fadeStart) / (duration - fadeStart)) : 1;

    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.rot += p.rotV;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.rect) ctx.fillRect(-p.r, -p.r * 0.4, p.r * 2, p.r * 0.8);
      else { ctx.beginPath(); ctx.arc(0, 0, p.r * 0.7, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }

    if (t < duration) requestAnimationFrame(draw);
    else canvas.remove();
  }
  requestAnimationFrame(draw);
}

/* 화면 flash + 오답 시 shake */
function flashScreen(type) {
  const el = document.createElement('div');
  el.className = 'fx-flash fx-' + type;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());

  if (type === 'wrong') {
    const panel = document.querySelector('.quiz-panel');
    if (panel) {
      panel.classList.remove('is-shaking');
      panel.offsetWidth; // force reflow
      panel.classList.add('is-shaking');
      panel.addEventListener('animationend', () => panel.classList.remove('is-shaking'), { once: true });
    }
  }
}

/* 연속 정답 배너 */
function showComboBanner(count) {
  const flames = count >= 4 ? '🔥🔥🔥' : count === 3 ? '🔥🔥' : '🔥';
  const el = document.createElement('div');
  el.className = 'combo-banner';
  el.textContent = `${flames} ${count}연속 정답!`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

/* 1등 정답 뱃지 */
function showFirstBadge() {
  const el = document.createElement('div');
  el.className = 'first-badge';
  el.textContent = '⚡ 1등 정답!';
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

/* 점수 상승 float */
function floatScore(delta) {
  let x = window.innerWidth / 2;
  let y = scoreBar.getBoundingClientRect().bottom || 100;

  const myRow = scoreBar.querySelector(`tr[data-player-id="${playerId}"]`);
  if (myRow) {
    const cell = myRow.querySelector('.st-score');
    if (cell) {
      const r = cell.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
  }

  const el = document.createElement('div');
  el.className = 'score-float';
  el.textContent = '+' + delta;
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

/* 캐릭터 반응 — 점수표 행의 캐릭터 이미지 교체 + 애니메이션 + 이모트 */
function playCharReaction(playerId, type) {
  const tr = scoreBar.querySelector(`tr[data-player-id="${playerId}"]`);
  if (!tr) return;
  const img = tr.querySelector('.st-char');
  const p = players.find(x => x.id === playerId);
  if (!img || !p) return;
  const poses = getPoses(p.characterId);

  img.classList.remove('is-jump', 'is-fall');
  // reflow → 애니메이션 재실행
  // eslint-disable-next-line no-unused-expressions
  img.offsetWidth;

  if (type === 'correct') {
    img.src = poses.jump;
    img.classList.add('is-jump');
    spawnCharEmote(tr, EMOTE_IMG.correct, 'correct');
    setTimeout(() => {
      img.src = poses.idle;
      img.classList.remove('is-jump');
    }, 750);
  } else if (type === 'wrong') {
    img.src = poses.fall;
    img.classList.add('is-fall');
    spawnCharEmote(tr, EMOTE_IMG.wrong, 'wrong');
    setTimeout(() => {
      img.src = poses.idle;
      img.classList.remove('is-fall');
    }, 700);
  } else {
    // timeout: 포즈 유지 + 졸린 이모트
    spawnCharEmote(tr, EMOTE_IMG.timeout, 'timeout');
  }
}

const EMOTE_IMG = {
  correct: './assets/emote_sparkle.png',
  wrong:   './assets/emote_drop.png',
  timeout: './assets/emote_zzz.png',
};

function spawnCharEmote(tr, src, type) {
  const wrap = tr.querySelector('.st-char-wrap');
  if (!wrap) return;
  const r = wrap.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'fx-char-emote fx-' + type;
  const im = document.createElement('img');
  im.src = src;
  im.alt = '';
  el.appendChild(im);
  el.style.left = (r.left + r.width / 2) + 'px';
  el.style.top  = (r.top - 6) + 'px';
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

/* 버튼 ripple */
function addRipple(btn, e) {
  const rect = btn.getBoundingClientRect();
  const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left;
  const y = (e.clientY ?? rect.top  + rect.height / 2) - rect.top;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.left = x + 'px';
  ripple.style.top  = y + 'px';
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

/* ── 렌더링 ──────────────────────────────────────────── */
function renderSetupPlayers() {
  waitingPlayers.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'waiting-player' + (p.ready ? ' is-ready' : '');
    const color = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
    div.innerHTML =
      `<img class="waiting-char" src="${CHAR_IMAGES[p.characterId] || ''}" alt="${escHtml(p.name)}" />` +
      `<span class="waiting-name" style="color:${color}">${escHtml(p.name)}</span>` +
      `<span class="waiting-status">${p.ready ? '✅' : '⏳'}</span>`;
    waitingPlayers.appendChild(div);
  });
}

function renderScoreBar() {
  scoreBar.innerHTML = '';
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const total  = (currentQuestion && currentQuestion.total) || 10;
  const curIdx = currentQuestion ? currentQuestion.questionIndex : -1;

  const table = document.createElement('table');
  table.className = 'score-table';

  // 헤더
  const hRow = document.createElement('tr');
  hRow.appendChild(Object.assign(document.createElement('th'), { className: 'st-name' }));
  for (let i = 0; i < total; i++) {
    const th = document.createElement('th');
    th.className = 'st-q' + (i === curIdx ? ' st-current' : '');
    th.textContent = i + 1;
    hRow.appendChild(th);
  }
  hRow.appendChild(Object.assign(document.createElement('th'), { className: 'st-score', textContent: '점수' }));
  table.appendChild(hRow);

  // 플레이어 행
  sorted.forEach(p => {
    const color = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
    const tr = document.createElement('tr');
    tr.dataset.playerId = p.id;

    const nameTd = document.createElement('td');
    nameTd.className = 'st-name';
    const poses = getPoses(p.characterId);
    nameTd.innerHTML =
      `<span class="st-name-inner">` +
        `<span class="st-char-wrap">` +
          `<img class="st-char" src="${poses.idle}" alt="" />` +
        `</span>` +
        `<span class="st-player-name" style="color:${color}">${escHtml(p.name)}</span>` +
      `</span>`;
    tr.appendChild(nameTd);

    const history = answerHistory[p.id] || {};
    for (let i = 0; i < total; i++) {
      const td = document.createElement('td');
      td.className = 'st-q' + (i === curIdx ? ' st-current' : '');
      if (i in history) {
        const ok = history[i];
        td.textContent = ok === null ? '—' : ok ? 'O' : 'X';
        td.classList.add(ok === null ? 'st-timeout' : ok ? 'st-correct' : 'st-wrong');
      } else if (i === curIdx) {
        td.textContent = submittedIds.has(p.id) ? '✓' : '·';
        td.classList.add(submittedIds.has(p.id) ? 'st-submitted' : 'st-pending');
      }
      tr.appendChild(td);
    }

    const scoreTd = document.createElement('td');
    scoreTd.className = 'st-score';
    scoreTd.textContent = p.score;
    tr.appendChild(scoreTd);

    table.appendChild(tr);
  });

  scoreBar.appendChild(table);
}

function updateSubmittedIndicators() {
  const curIdx = currentQuestion ? currentQuestion.questionIndex : -1;
  if (curIdx < 0) return;
  scoreBar.querySelectorAll('tr[data-player-id]').forEach(tr => {
    const pid = tr.dataset.playerId;
    if (answerHistory[pid] && curIdx in answerHistory[pid]) return;
    const cells = tr.querySelectorAll('.st-q');
    const cell  = cells[curIdx];
    if (!cell) return;
    const submitted = submittedIds.has(pid);
    cell.textContent = submitted ? '✓' : '·';
    cell.className = 'st-q st-current ' + (submitted ? 'st-submitted' : 'st-pending');
  });
}

/* ── 화면 전환 ───────────────────────────────────────── */
function showScreen(name) {
  setupScreen.classList.remove('is-active');
  gameScreen.classList.remove('is-active');
  resultScreen.classList.remove('is-active');
  if (name === 'setup')  setupScreen.classList.add('is-active');
  if (name === 'game')   gameScreen.classList.add('is-active');
  if (name === 'result') resultScreen.classList.add('is-active');
}

/* ── 채팅 ────────────────────────────────────────────── */
chatToggle.addEventListener('click', () => {
  chatVisible = !chatVisible;
  chatInputWrap.classList.toggle('is-visible', chatVisible);
  chatOverlay.classList.toggle('is-hidden', false);
  if (chatVisible) {
    chatInput.focus();
    clearTimeout(chatHideTimer);
  } else {
    chatOverlay.classList.add('is-hidden');
  }
});

chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
chatSend.addEventListener('click', sendChat);

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  sendIfOpen({ type: 'chat', text });
  chatInput.value = '';
}

function showChatBriefly() {
  chatOverlay.classList.remove('is-hidden');
  clearTimeout(chatHideTimer);
  if (!chatVisible) {
    chatHideTimer = setTimeout(() => {
      if (!chatVisible) chatOverlay.classList.add('is-hidden');
    }, 3500);
  }
}

/* ── 광장으로 돌아가기 ─────────────────────────────────── */
document.getElementById('exitBtn').addEventListener('click', () => {
  window.GameBoot.exit();
});

/* ── 유틸 ────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── 초기화 ──────────────────────────────────────────── */
if (code) {
  connect();
} else {
  document.querySelector('.setup-copy').textContent =
    '방 코드 없이 실행 중입니다. 광장에서 입장해 주세요.';
  readyBtn.disabled = true;
}
