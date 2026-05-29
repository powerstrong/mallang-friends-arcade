/* ════════════════════════════════════════════════════════
   말랑 두더지 잡기 — 클라이언트 전용 미니게임 템플릿
   ────────────────────────────────────────────────────────
   이 파일을 복사해서 자신만의 게임을 만들 수 있습니다.
   "✏️" 주석이 달린 곳이 주요 수정 포인트입니다.
   외부 라이브러리·CDN 없이 순수 JavaScript로 작성되었습니다.
   ════════════════════════════════════════════════════════ */

'use strict';

/* ──────────────────────────────────────────
   1. 게임 설정값 (✏️ 자유롭게 바꾸세요)
   ────────────────────────────────────────── */
const CONFIG = {
  // 게임 제한 시간 (초)
  GAME_DURATION: 30,

  // 두더지 구멍 개수 (3×3 그리드)
  HOLE_COUNT: 9,

  // 두더지가 올라와 있는 시간 범위 (밀리초)
  MOLE_MIN_MS: 600,
  MOLE_MAX_MS: 1400,

  // 두더지가 올라오는 간격 (밀리초) — 짧을수록 난이도 상승
  SPAWN_INTERVAL_MS: 900,

  // 두더지를 잡으면 얻는 점수
  SCORE_PER_HIT: 10,

  // ✏️ 두더지 이모지 — 다른 이모지로 바꿔 게임 테마를 변경하세요
  MOLE_EMOJI: '🐹',
  HOLE_EMOJI: '🕳️',
};

/* ──────────────────────────────────────────
   2. DOM 요소 참조
   ────────────────────────────────────────── */
const startScreen  = document.getElementById('startScreen');
const playScreen   = document.getElementById('playScreen');
const overScreen   = document.getElementById('overScreen');
const arena        = document.getElementById('arena');
const scoreDisplay = document.getElementById('scoreDisplay');
const timerDisplay = document.getElementById('timerDisplay');
const finalScore   = document.getElementById('finalScore');

const btnStart    = document.getElementById('btnStart');
const btnExit     = document.getElementById('btnExit');
const btnRestart  = document.getElementById('btnRestart');
const btnExitOver = document.getElementById('btnExitOver');

/* ──────────────────────────────────────────
   3. 게임 상태 변수
   ────────────────────────────────────────── */
let score       = 0;
let timeLeft    = CONFIG.GAME_DURATION;
let isPlaying   = false;

// ✏️ 타이머 ID들 — 게임 종료 시 clearInterval/clearTimeout으로 정리됩니다
let countdownId  = null;  // 1초마다 타이머 감소
let spawnId      = null;  // 두더지 등장 간격
let moleTimeouts = [];    // 각 두더지가 숨는 타이머

/* ──────────────────────────────────────────
   4. 화면 전환 헬퍼
   ────────────────────────────────────────── */
function showScreen(screen) {
  // 모든 화면을 숨기고 지정한 화면만 표시
  [startScreen, playScreen, overScreen].forEach(s => s.classList.remove('is-active'));
  screen.classList.add('is-active');
}

/* ──────────────────────────────────────────
   5. 두더지 구멍(hole) 생성
   ── 아레나 크기에 맞춰 그리드로 배치합니다.
   ✏️ HOLE_COUNT나 그리드 분할 방식을 바꿔 레이아웃을 조정하세요.
   ────────────────────────────────────────── */
function buildHoles() {
  arena.innerHTML = '';

  // 3×3 그리드 계산
  const cols = 3;
  const rows = Math.ceil(CONFIG.HOLE_COUNT / cols);

  // 백분율 단위로 균등 배치 (구멍 크기 절반을 translate로 중앙 정렬)
  for (let i = 0; i < CONFIG.HOLE_COUNT; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);

    const left = ((col + 0.5) / cols * 100).toFixed(1) + '%';
    const top  = ((row + 0.5) / rows * 100).toFixed(1) + '%';

    const hole = document.createElement('div');
    hole.className = 'hole';
    hole.dataset.index = i;
    hole.textContent = CONFIG.HOLE_EMOJI;
    hole.style.left      = left;
    hole.style.top       = top;
    hole.style.transform = 'translate(-50%, -50%)';

    // ✏️ 클릭·탭 이벤트 — 두더지를 잡는 동작
    hole.addEventListener('pointerdown', onHoleHit);

    arena.appendChild(hole);
  }
}

/* ──────────────────────────────────────────
   6. 두더지 올리기 / 내리기
   ────────────────────────────────────────── */
function getHoles() {
  return Array.from(arena.querySelectorAll('.hole'));
}

function popUpMole() {
  if (!isPlaying) return;

  const holes = getHoles().filter(h => !h.classList.contains('is-up'));
  if (holes.length === 0) return;

  // 랜덤 구멍 선택
  const hole = holes[Math.floor(Math.random() * holes.length)];
  hole.textContent = CONFIG.MOLE_EMOJI;
  hole.classList.add('is-up');

  // ✏️ 올라와 있는 시간 범위 — MOLE_MIN_MS / MOLE_MAX_MS 로 조정하세요
  const upMs = CONFIG.MOLE_MIN_MS +
    Math.random() * (CONFIG.MOLE_MAX_MS - CONFIG.MOLE_MIN_MS);

  const tid = setTimeout(() => {
    hideMole(hole);
  }, upMs);

  moleTimeouts.push(tid);
}

function hideMole(hole) {
  hole.classList.remove('is-up');
  hole.classList.remove('is-hit');
  hole.textContent = CONFIG.HOLE_EMOJI;
}

/* ──────────────────────────────────────────
   7. 두더지 클릭·탭 처리
   ✏️ 점수 계산 방식을 여기서 바꾸세요.
   ────────────────────────────────────────── */
function onHoleHit(event) {
  const hole = event.currentTarget;
  if (!isPlaying)              return;
  if (!hole.classList.contains('is-up'))  return; // 올라오지 않은 구멍 무시

  // 잡기 성공
  hole.classList.remove('is-up');
  hole.classList.add('is-hit');
  hole.textContent = '✨';

  // ✏️ 여기서 점수를 더합니다 — 속도·연속 타격 보너스를 추가해도 좋아요
  score += CONFIG.SCORE_PER_HIT;
  updateScoreDisplay();

  // 짧은 피드백 후 구멍 원상복구
  setTimeout(() => hideMole(hole), 200);
}

/* ──────────────────────────────────────────
   8. HUD 업데이트
   ────────────────────────────────────────── */
function updateScoreDisplay() {
  scoreDisplay.textContent = score;
}

function updateTimerDisplay() {
  timerDisplay.textContent = timeLeft;
  // 남은 시간이 5초 이하면 빨간색으로 강조
  timerDisplay.style.color = timeLeft <= 5 ? '#ff6b6b' : '';
}

/* ──────────────────────────────────────────
   9. 게임 시작
   ────────────────────────────────────────── */
function startGame() {
  // 상태 초기화
  score    = 0;
  timeLeft = CONFIG.GAME_DURATION;
  isPlaying = true;
  moleTimeouts = [];

  updateScoreDisplay();
  updateTimerDisplay();
  buildHoles();
  showScreen(playScreen);

  // 카운트다운 타이머 (1초 간격)
  countdownId = setInterval(() => {
    timeLeft -= 1;
    updateTimerDisplay();
    if (timeLeft <= 0) endGame();
  }, 1000);

  // ✏️ 두더지 등장 간격 — SPAWN_INTERVAL_MS 로 조정하세요
  spawnId = setInterval(popUpMole, CONFIG.SPAWN_INTERVAL_MS);

  // 게임 시작 직후 첫 두더지 즉시 등장
  popUpMole();
}

/* ──────────────────────────────────────────
   10. 게임 종료
   ────────────────────────────────────────── */
function endGame() {
  isPlaying = false;

  // 모든 타이머 정리
  clearInterval(countdownId);
  clearInterval(spawnId);
  moleTimeouts.forEach(t => clearTimeout(t));
  moleTimeouts = [];

  // 남아 있는 두더지 숨기기
  getHoles().forEach(h => hideMole(h));

  // 최종 점수 표시
  finalScore.textContent = score;
  showScreen(overScreen);

  // ✏️ GameBoot.submitResult() — 점수를 아케이드에 기록합니다.
  //    결과 객체에 원하는 필드를 추가해도 됩니다.
  if (window.GameBoot) {
    window.GameBoot.submitResult({ score });
  }
}

/* ──────────────────────────────────────────
   11. 버튼 이벤트 연결
   ────────────────────────────────────────── */

// 시작 화면 → 게임 시작
btnStart.addEventListener('click', startGame);

// 시작 화면 → 광장으로 (bootstrap.js 의 exit() 호출)
btnExit.addEventListener('click', () => {
  if (window.GameBoot) window.GameBoot.exit();
  else window.location.href = '/';
});

// 게임 오버 화면 → 다시 하기
btnRestart.addEventListener('click', startGame);

// 게임 오버 화면 → 광장으로
btnExitOver.addEventListener('click', () => {
  if (window.GameBoot) window.GameBoot.exit();
  else window.location.href = '/';
});

/* ──────────────────────────────────────────
   12. 키보드 지원 (선택)
   ✏️ 키보드 단축키를 추가하거나 변경하세요.
   ────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    // 시작 화면에서 Enter/Space → 게임 시작
    if (startScreen.classList.contains('is-active')) {
      startGame();
    }
    // 게임 오버 화면에서 Enter/Space → 다시 하기
    if (overScreen.classList.contains('is-active')) {
      startGame();
    }
  }
});
