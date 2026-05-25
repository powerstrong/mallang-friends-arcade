/* 말랑프렌즈 슥슥 — Phase 0 client skeleton.
 *
 * 목적:
 *   1) WebSocket 연결 + join_game(gameId='sseuk-sseuk') 송신
 *   2) SS_JOINED 수신 시 "연결됨" 상태로 전환 + roster 표시
 *
 * Phase A 이후: 캐릭터 선택, Ready, 라운드 루프, 캔버스, 채팅, 정답 판정 추가.
 */

const { code, name, playerId, isMultiplayer } = window.GameBoot;
const WORKER_URL = window.WORKER_URL;

const bootStatus     = document.getElementById('bootStatus');
const waitingPlayers = document.getElementById('waitingPlayers');

let ws = null;

function setStatus(text, modifier) {
  bootStatus.textContent = text;
  bootStatus.classList.remove('is-connected', 'is-error');
  if (modifier) bootStatus.classList.add(modifier);
}

function renderRoster(players) {
  waitingPlayers.innerHTML = '';
  for (const p of players || []) {
    const chip = document.createElement('span');
    chip.className = 'player-chip';
    if (p.id === playerId) chip.classList.add('is-me');
    chip.textContent = p.id === playerId ? `${p.name} (나)` : p.name;
    waitingPlayers.appendChild(chip);
  }
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
    }));
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    switch (msg.type) {
      case 'SS_JOINED':
        setStatus(`연결됨 — phase: ${msg.phase}`, 'is-connected');
        renderRoster(msg.players);
        break;
      case 'SS_PLAYER_UPDATE':
        renderRoster(msg.players);
        break;
      case 'error':
        setStatus(`오류: ${msg.message || '알 수 없음'}`, 'is-error');
        break;
    }
  });

  ws.addEventListener('close', () => setStatus('연결이 끊겼어요.', 'is-error'));
  ws.addEventListener('error', () => setStatus('연결 오류가 발생했어요.', 'is-error'));
}

connect();
