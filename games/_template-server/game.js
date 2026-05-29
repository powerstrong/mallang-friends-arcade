/* ══════════════════════════════════════════════════════════════
   서버 권위형 게임 클라이언트 — "선착순 버튼" 레퍼런스 구현
   gameId: 'example-first-button'  (worker/src/games/example_server_game.js)

   ✏️ AI 수정 포인트:
     - GAME_ID : 새 서버 게임의 id 로 바꾸세요 (gameModules.js 에 등록된 것과 일치해야 함).
     - handleModEvent() : 새 서버 이벤트를 여기에 추가하세요.
     - UI 함수(render*) : 화면 표현을 원하는 대로 바꾸세요.

   핵심 원칙(바꾸지 마세요):
     - 승자 판정은 서버가 한다. 클라이언트는 절대 직접 winner 를 결정하지 않는다.
     - 서버로 보내는 메시지: { type:'mod', payload: {...} } 형식만 사용.
     - 서버에서 오는 mod 이벤트: handleModEvent() 에서 event 필드로 분기.
   ══════════════════════════════════════════════════════════════ */

/* ── 설정 ────────────────────────────────────────────────────
   ✏️ AI 수정 포인트: 이 게임의 서버 모듈 id.
   worker/src/gameModules.js 에 등록된 id 와 반드시 일치해야 합니다. */
const GAME_ID = 'example-first-button';

/* ── 상태 변수 ─────────────────────────────────────────────── */
// GameBoot: /shared/bootstrap.js 가 제공. URL 파라미터(code/name/playerId 등) 파싱.
const { name, playerId: bootPlayerId } = window.GameBoot;
const WORKER_URL = window.WORKER_URL; // /shared/config.js 가 결정한 API 워커 주소

let ws = null;              // WebSocket 인스턴스
let myPlayerId = null;      // 서버가 발급한 내 playerId (welcome 이벤트에서 수신)
let roomCode = null;        // 이 세션의 방 코드
let armed = false;          // 서버가 관리하는 라운드 무장 상태(로컬 미러)
let winner = null;          // 가장 최근 라운드 승자 id (로컬 미러)
let roster = [];            // 현재 참가자 목록: [{id, name}, ...]
let joinedGame = false;     // join_game 메시지 전송 여부

/* ── DOM 참조 ───────────────────────────────────────────────── */
const lobbyScreen   = document.getElementById('lobbyScreen');
const playScreen    = document.getElementById('playScreen');
const resultScreen  = document.getElementById('resultScreen');
const roomCodeEl    = document.getElementById('roomCode');
const playerListEl  = document.getElementById('playerList');
const statusMsgEl   = document.getElementById('statusMsg');
const btnArm        = document.getElementById('btnArm');
const claimBtn      = document.getElementById('claimBtn');
const winnerDisplay = document.getElementById('winnerDisplay');

/* ── 화면 전환 ──────────────────────────────────────────────── */
function showScreen(id) {
  [lobbyScreen, playScreen, resultScreen].forEach(s => s.classList.remove('is-active'));
  document.getElementById(id).classList.add('is-active');
}

/* ── WebSocket 연결 ──────────────────────────────────────────
   프로토콜:
     1. URL 파라미터 ?code= 있으면 기존 방에 참가 (WS 직접 연결).
     2. 없으면 POST /api/rooms 로 방 생성 후 연결.
   두 경우 모두 연결 후 handshake:
     클라 → {type:'join', name, playerId?}
     서버 → {type:'welcome', playerId, ...}
     클라 → {type:'join_game', gameId, name, playerId}
     서버(모듈) → {type:'mod', event:'joined', ...}
   ─────────────────────────────────────────────────────────── */
async function init() {
  // URL에 ?code= 가 있으면 기존 방, 없으면 새 방 생성
  const params = new URLSearchParams(window.location.search);
  const existingCode = params.get('code');

  if (existingCode) {
    roomCode = existingCode;
    connect();
  } else {
    // 새 방 생성 — POST /api/rooms → { code }
    try {
      const res = await fetch(`${WORKER_URL}/api/rooms`, { method: 'POST' });
      const data = await res.json();
      roomCode = data.code;
      connect();
    } catch (err) {
      setStatus('방 생성 실패. 새로고침 해주세요.');
    }
  }
}

function connect() {
  setStatus('서버에 연결 중...');
  roomCodeEl.textContent = roomCode || '...';

  // HTTP(S) → WS(S) 변환
  const wsUrl = WORKER_URL.replace(/^http/, 'ws') + '/api/rooms/' + roomCode;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setStatus('핸드셰이크 중...');
    // 1단계: join — 방 입장 핸드셰이크
    send({ type: 'join', name: name || '익명', playerId: bootPlayerId || undefined });
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = () => {
    setStatus('연결이 끊겼습니다. 새로고침 해주세요.');
    btnArm.disabled = true;
    claimBtn.disabled = true;
  };

  ws.onerror = () => {
    setStatus('연결 오류가 발생했습니다.');
  };
}

/* ── 메시지 디스패처 ─────────────────────────────────────────
   서버에서 오는 메시지 타입:
     'welcome'  — 핸드셰이크 완료, playerId 발급
     'mod'      — 서버 게임 모듈이 보내는 이벤트 (event 필드로 세부 분기)
   ─────────────────────────────────────────────────────────── */
function handleMessage(msg) {
  if (msg.type === 'welcome') {
    onWelcome(msg);
    return;
  }
  // 서버 게임 모듈이 보내는 mod 이벤트
  if (msg.type === 'mod') {
    handleModEvent(msg);
  }
}

/* welcome — 서버가 playerId 발급. 이후 join_game 전송 */
function onWelcome(msg) {
  myPlayerId = msg.playerId;
  joinedGame = false;

  // 2단계: join_game — 게임 모듈 라우팅 요청
  // gameId 가 SERVER_GAME_MODULES 에 등록돼 있으면 모듈로 라우팅됨
  send({
    type: 'join_game',
    gameId: GAME_ID,
    name: name || '익명',
    playerId: myPlayerId,
  });
}

/* ── 서버 모듈 이벤트 핸들러 ─────────────────────────────────
   ✏️ AI 수정 포인트: 새 서버 게임의 이벤트를 case 로 추가하세요.
   example-first-button 모듈의 이벤트:
     joined  — 내가 방에 합류 (현재 armed/winner 상태 포함)
     roster  — 참가자 목록 변경
     armed   — 라운드 무장 완료 (탭 가능 상태)
     winner  — 서버가 결정한 승자 발표 (클라이언트에서 조작 불가)
   ─────────────────────────────────────────────────────────── */
function handleModEvent(msg) {
  switch (msg.event) {
    case 'joined':
      // 내가 모듈 세션에 합류 — 현재 게임 상태 동기화
      joinedGame = true;
      armed = msg.armed;
      winner = msg.winner;
      renderLobby();
      // 이미 armed 상태라면 바로 플레이 화면으로
      if (armed) {
        showScreen('playScreen');
        claimBtn.disabled = false;
      } else {
        showScreen('lobbyScreen');
      }
      setStatus('연결됨');
      btnArm.disabled = false;
      break;

    case 'roster':
      // 참가자 입퇴장 — 서버가 roster 전체를 보냄
      roster = msg.roster || [];
      renderRoster();
      break;

    case 'armed':
      // 라운드 무장 — 서버가 상태를 변경했음을 브로드캐스트
      // 클라이언트는 이 이벤트를 받은 후에야 claim 버튼을 활성화
      armed = true;
      winner = null;
      claimBtn.disabled = false;
      showScreen('playScreen');
      setStatus('라운드 시작! 탭하세요!');
      break;

    case 'winner':
      // 서버가 승자를 결정해서 알림 — 클라이언트는 결과를 표시할 뿐
      armed = false;
      winner = msg.winnerId;
      claimBtn.disabled = true;
      renderWinner(msg.winnerId, msg.winnerName);
      showScreen('resultScreen');
      break;

    default:
      // ✏️ AI 수정 포인트: 새 이벤트 타입을 여기에 추가하세요
      break;
  }
}

/* ── UI 렌더링 ───────────────────────────────────────────────
   ✏️ AI 수정 포인트: renderRoster / renderWinner 를 원하는 대로 바꾸세요. */

function renderLobby() {
  if (roomCode) roomCodeEl.textContent = roomCode;
  renderRoster();
}

function renderRoster() {
  playerListEl.innerHTML = '';
  roster.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name;
    // 나 자신은 시각적으로 구분
    if (p.id === myPlayerId) li.classList.add('is-me');
    playerListEl.appendChild(li);
  });
}

function renderWinner(winnerId, winnerName) {
  const isMe = winnerId === myPlayerId;
  winnerDisplay.textContent = isMe
    ? `🏆 내가 이겼습니다! (${escHtml(winnerName)})`
    : `🥈 ${escHtml(winnerName)} 님이 이겼습니다`;
  winnerDisplay.classList.toggle('is-winner', isMe);

  // 결과 제출 — bootstrap.js 의 submitResult 로 점수 저장
  // ✏️ AI 수정 포인트: 점수 계산 로직을 바꾸세요
  window.GameBoot.submitResult({ won: isMe, score: isMe ? 1 : 0 });
}

/* ── 서버로 메시지 전송 ──────────────────────────────────────
   규칙: payload 8192바이트 이하, 초당 40메시지 이하. */
function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

/* mod 메시지 — 게임 모듈로 전달되는 유일한 클라이언트→서버 채널
   ✏️ AI 수정 포인트: payload 필드를 새 게임의 액션에 맞게 바꾸세요. */
function sendMod(payload) {
  send({ type: 'mod', payload });
}

/* ── 상태 메시지 헬퍼 ─────────────────────────────────────── */
function setStatus(msg) {
  if (statusMsgEl) statusMsgEl.textContent = msg;
}

/* ── XSS 방지 ────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── 버튼 이벤트 연결 ─────────────────────────────────────── */

// "라운드 시작(Arm)" — 서버에 arm 요청. 서버가 상태를 변경하고 armed 이벤트를 브로드캐스트.
// 클라이언트가 직접 armed = true 하지 않고, 서버 응답(event:'armed')을 기다림.
btnArm.addEventListener('click', () => {
  if (!joinedGame) return;
  sendMod({ action: 'arm' });
  setStatus('라운드 시작 요청 중...');
  btnArm.disabled = true; // 서버 응답 전까지 비활성화
});

// "탭!(Claim)" — 선착순 요청. 서버가 가장 먼저 도착한 claim 만 승자로 인정.
// 클라이언트는 버튼을 눌렀을 뿐 — 서버가 winner 이벤트를 돌려보내야 승자 확정.
claimBtn.addEventListener('click', () => {
  if (!armed) return; // 서버가 armed 이벤트를 보내기 전에는 무시
  sendMod({ action: 'claim' });
  claimBtn.disabled = true; // 중복 전송 방지 (서버에서 winner 판정 후 화면 전환됨)
  setStatus('탭 전송 완료 — 서버 판정 대기 중...');
});

// "다음 라운드" — 로비로 복귀, 다시 arm 가능
document.getElementById('btnNextRound').addEventListener('click', () => {
  armed = false;
  winner = null;
  btnArm.disabled = false;
  claimBtn.disabled = true;
  setStatus('다음 라운드를 시작할 수 있습니다.');
  showScreen('lobbyScreen');
});

// "광장으로" 버튼들 — GameBoot.exit() 가 적절한 URL 로 복귀
document.getElementById('btnExit').addEventListener('click', () => window.GameBoot.exit());
document.getElementById('btnExitResult').addEventListener('click', () => window.GameBoot.exit());

/* ── 초기화 ─────────────────────────────────────────────────
   claimBtn 은 서버가 armed 이벤트를 보낼 때까지 비활성화 상태 유지.
   ─────────────────────────────────────────────────────────── */
claimBtn.disabled = true;
btnArm.disabled = true; // joinedGame 전까지 비활성화
init();
