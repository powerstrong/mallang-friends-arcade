/* ════════════════════════════════════════════════════════
   실시간 탭 대결 — game.js
   MallangRelay SDK를 사용하는 실시간 멀티플레이 템플릿.

   동작 흐름:
   1. relay 연결 → 방 코드 표시 → 참가자 대기
   2. 각자 "시작" 버튼 → 본인 15초 타이머 시작
      → 탭할 때마다 relay.send 로 내 점수 브로드캐스트
   3. 타이머 종료 → 결과 화면 → GameBoot.submitResult

   ✏️ 여기를 바꾸세요: GAME_ID, ROUND_SECONDS, 탭 버튼 로직 등
   ════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────
     ✏️ 게임 상수 — 이 게임을 복사해 새 게임을 만들 때 반드시 변경하세요
     ────────────────────────────────────────────────────── */
  // ✏️ 복사 후 새 game-id 로 바꾸고 games/registry.js의 id와 일치시키세요.
  //    ('_' 로 시작하는 id 는 릴레이 서버가 거부하므로 유효한 데모 id 를 기본값으로 둠)
  const GAME_ID = 'realtime-demo';
  const ROUND_SECONDS = 15;             // ✏️ 라운드 시간(초)
  const AVATARS = ['🐰', '🐱', '🐹', '🐸', '🦊', '🐻', '🐼', '🐨']; // ✏️ 참가자 아바타 풀

  /* ──────────────────────────────────────────────────────
     DOM 참조
     ────────────────────────────────────────────────────── */
  const lobbyScreen   = document.getElementById('lobbyScreen');
  const playScreen    = document.getElementById('playScreen');
  const overScreen    = document.getElementById('overScreen');

  const roomCodeEl    = document.getElementById('roomCode');
  const playerListEl  = document.getElementById('playerList');
  const btnStart      = document.getElementById('btnStart');
  const btnExit       = document.getElementById('btnExit');

  const myTapDisplay  = document.getElementById('myTapDisplay');
  const timerDisplay  = document.getElementById('timerDisplay');
  const scoreboardEl  = document.getElementById('scoreboard');
  const tapBtn        = document.getElementById('tapBtn');

  const finalScoreEl  = document.getElementById('finalScore');
  const finalRanking  = document.getElementById('finalRanking');
  const resultTitle   = document.getElementById('resultTitle');
  const btnRestart    = document.getElementById('btnRestart');
  const btnExitOver   = document.getElementById('btnExitOver');

  /* ──────────────────────────────────────────────────────
     게임 상태
     ────────────────────────────────────────────────────── */
  let myTaps   = 0;         // 내 탭 수
  let scores   = {};        // { playerId: { name, taps, avatar } }
  let timerId  = null;      // 카운트다운 타이머 ID
  let timeLeft = ROUND_SECONDS;
  let playing  = false;
  let relay    = null;

  /* ──────────────────────────────────────────────────────
     화면 전환 헬퍼
     ────────────────────────────────────────────────────── */
  function showScreen(el) {
    [lobbyScreen, playScreen, overScreen].forEach(s => s.classList.remove('is-active'));
    el.classList.add('is-active');
  }

  /* ──────────────────────────────────────────────────────
     참가자 아바타 — 순서 기반 배정 (id 해시 대신 단순화)
     ────────────────────────────────────────────────────── */
  function avatarFor(playerId) {
    // 같은 세션 내에서 id가 변하지 않으므로 index로 배정
    const keys = Object.keys(scores);
    const idx  = keys.indexOf(playerId);
    return AVATARS[(idx < 0 ? 0 : idx) % AVATARS.length];
  }

  /* ──────────────────────────────────────────────────────
     참가자 목록 렌더 (로비 화면)
     ────────────────────────────────────────────────────── */
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
    players.forEach(function (p, i) {
      const li = document.createElement('li');
      li.className = 'player-list__item' + (relay && p.id === relay.playerId ? ' is-me' : '');

      const avatar = document.createElement('span');
      avatar.className = 'player-list__avatar';
      avatar.textContent = AVATARS[i % AVATARS.length];

      const nameEl = document.createElement('span');
      nameEl.textContent = p.name + (relay && p.id === relay.playerId ? ' (나)' : '');

      li.appendChild(avatar);
      li.appendChild(nameEl);
      playerListEl.appendChild(li);
    });
  }

  /* ──────────────────────────────────────────────────────
     점수판 렌더 (플레이 화면) — 내림차순 정렬
     ────────────────────────────────────────────────────── */
  function renderScoreboard() {
    const entries = Object.values(scores).sort(function (a, b) { return b.taps - a.taps; });
    scoreboardEl.innerHTML = '';
    entries.forEach(function (entry, i) {
      const li = document.createElement('li');
      li.className = 'scoreboard-list__item' + (entry.id === relay.playerId ? ' is-me' : '');

      const rank  = document.createElement('span');
      rank.className = 'scoreboard-list__rank';
      rank.textContent = '#' + (i + 1);

      const name  = document.createElement('span');
      name.className = 'scoreboard-list__name';
      name.textContent = entry.name + (entry.id === relay.playerId ? ' (나)' : '');

      const score = document.createElement('span');
      score.className = 'scoreboard-list__score';
      score.textContent = entry.taps;

      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(score);
      scoreboardEl.appendChild(li);
    });
  }

  /* ──────────────────────────────────────────────────────
     최종 순위 렌더 (결과 화면)
     ────────────────────────────────────────────────────── */
  const MEDALS = ['🥇', '🥈', '🥉'];

  function renderFinalRanking() {
    const entries = Object.values(scores).sort(function (a, b) { return b.taps - a.taps; });
    finalRanking.innerHTML = '';
    entries.forEach(function (entry, i) {
      const li = document.createElement('li');
      li.className = 'final-ranking__item';

      const medal = document.createElement('span');
      medal.className = 'final-ranking__medal';
      medal.textContent = MEDALS[i] || (i + 1) + '.';

      const name = document.createElement('span');
      name.className = 'final-ranking__name';
      name.textContent = entry.name;

      const score = document.createElement('span');
      score.className = 'final-ranking__score';
      score.textContent = entry.taps + '탭';

      li.appendChild(medal);
      li.appendChild(name);
      li.appendChild(score);
      finalRanking.appendChild(li);
    });

    // 1위 결정 (동점이면 첫 번째)
    if (entries.length > 0) {
      const winner = entries[0];
      if (winner.id === relay.playerId) {
        resultTitle.textContent = '🏆 우승!';
      } else {
        resultTitle.textContent = '결과 발표! 🎉';
      }
    }
  }

  /* ──────────────────────────────────────────────────────
     카운트다운 타이머
     ────────────────────────────────────────────────────── */
  function startTimer() {
    timeLeft = ROUND_SECONDS;
    timerDisplay.textContent = timeLeft;
    timerDisplay.classList.remove('is-urgent');

    // ✏️ 확장 포인트: 동기 시작 구현
    // 현재는 각자 "시작" 버튼을 누를 때 독립적으로 타이머를 시작합니다.
    // 동기화된 시작을 원한다면:
    //   1. 호스트(첫 참가자)가 START 메시지를 relay.send({type:'start', startAt: Date.now() + 3000})
    //   2. 모든 참가자가 relay.on('message') 에서 startAt 을 받아 setTimeout으로 동시 시작
    // 이렇게 하면 모든 참가자가 같은 시간에 게임을 시작할 수 있습니다.

    timerId = setInterval(function () {
      timeLeft -= 1;
      timerDisplay.textContent = timeLeft;

      if (timeLeft <= 5) {
        timerDisplay.classList.add('is-urgent');
      }

      if (timeLeft <= 0) {
        clearInterval(timerId);
        timerId = null;
        endGame();
      }
    }, 1000);
  }

  /* ──────────────────────────────────────────────────────
     탭 처리 — 탭 시 내 점수를 브로드캐스트
     ────────────────────────────────────────────────────── */
  function onTap() {
    if (!playing) return;

    myTaps += 1;
    myTapDisplay.textContent = myTaps;

    // 내 scores 항목도 즉시 갱신
    if (relay && relay.playerId && scores[relay.playerId]) {
      scores[relay.playerId].taps = myTaps;
    }
    renderScoreboard();

    // 탭 애니메이션 피드백
    tapBtn.classList.remove('tapped');
    // reflow를 강제해 같은 클래스를 연속 추가할 때도 애니메이션이 트리거되도록 함
    void tapBtn.offsetWidth;
    tapBtn.classList.add('tapped');

    // ✏️ relay.send: 내 탭 수를 방 전체에 브로드캐스트
    // payload는 8192바이트 이하 / 초당 40메시지 제한에 주의
    if (relay) {
      relay.send({ type: 'score', taps: myTaps });
    }
  }

  /* ──────────────────────────────────────────────────────
     게임 종료
     ────────────────────────────────────────────────────── */
  function endGame() {
    playing = false;
    tapBtn.disabled = true;

    finalScoreEl.textContent = myTaps;
    renderFinalRanking();

    // GameBoot에 결과 제출
    // ✏️ submitResult에 추가 필드를 넣어도 됩니다 (예: duration, accuracy)
    window.GameBoot.submitResult({ score: myTaps });

    showScreen(overScreen);
  }

  /* ──────────────────────────────────────────────────────
     게임 시작
     ────────────────────────────────────────────────────── */
  function startGame() {
    myTaps  = 0;
    playing = true;

    myTapDisplay.textContent = '0';
    timerDisplay.textContent = ROUND_SECONDS;
    timerDisplay.classList.remove('is-urgent');
    tapBtn.disabled = false;
    tapBtn.classList.remove('tapped');

    // 내 점수 초기화
    if (relay && relay.playerId && scores[relay.playerId]) {
      scores[relay.playerId].taps = 0;
    }
    renderScoreboard();

    showScreen(playScreen);
    startTimer();
  }

  /* ──────────────────────────────────────────────────────
     MallangRelay 초기화
     ────────────────────────────────────────────────────── */
  function initRelay() {
    // ✏️ create 옵션:
    //   gameId: 릴레이 방을 구분하는 식별자 (registry의 id와 일치 권장)
    //   name: 표시 이름 (GameBoot.name이 없으면 기본값 사용)
    relay = MallangRelay.create({
      gameId: GAME_ID,
      name:   window.GameBoot.name || '플레이어',
    });

    // 합류 완료 → 방 코드 표시 & 시작 버튼 활성화
    relay.ready.then(function () {
      roomCodeEl.textContent = relay.code || '????';

      // 내 항목 scores에 초기 등록
      scores[relay.playerId] = {
        id:   relay.playerId,
        name: window.GameBoot.name || '플레이어',
        taps: 0,
      };

      btnStart.disabled = false;
      renderPlayerList(relay.players());
    }).catch(function (err) {
      roomCodeEl.textContent = '연결 실패';
      console.error('[relay] 연결 오류:', err);
    });

    // 참가자 목록 변경 (presence)
    relay.on('players', function (players) {
      renderPlayerList(players);

      // 새 참가자가 들어오면 scores에 등록 (없는 경우)
      players.forEach(function (p) {
        if (!scores[p.id]) {
          scores[p.id] = { id: p.id, name: p.name, taps: 0 };
        }
      });

      // 나간 참가자 제거
      const activeIds = players.map(function (p) { return p.id; });
      Object.keys(scores).forEach(function (id) {
        if (!activeIds.includes(id)) {
          delete scores[id];
        }
      });

      if (playing) renderScoreboard();
    });

    // 다른 참가자의 메시지 수신
    relay.on('message', function (msg) {
      const payload = msg.payload;
      if (!payload || payload.type !== 'score') return;

      // ✏️ 확장 포인트: 다른 type의 메시지도 여기서 분기 처리할 수 있습니다
      // 예: payload.type === 'start' 이면 동기화 시작 로직 실행

      if (!scores[msg.from]) {
        scores[msg.from] = { id: msg.from, name: '?', taps: 0 };
      }
      scores[msg.from].taps = payload.taps;

      if (playing) renderScoreboard();
    });

    relay.on('error', function (err) {
      console.error('[relay] 오류:', err);
    });
  }

  /* ──────────────────────────────────────────────────────
     이벤트 연결
     ────────────────────────────────────────────────────── */
  // 시작 버튼
  btnStart.addEventListener('click', startGame);

  // 광장으로 (로비)
  btnExit.addEventListener('click', function () {
    if (relay) relay.leave();
    window.GameBoot.exit();
  });

  // 광장으로 (게임 오버)
  btnExitOver.addEventListener('click', function () {
    if (relay) relay.leave();
    window.GameBoot.exit();
  });

  // 다시 하기
  btnRestart.addEventListener('click', function () {
    if (timerId) clearInterval(timerId);
    scores = {};
    showScreen(lobbyScreen);
    // relay는 유지 — 같은 방에서 재대기
    if (relay) {
      scores[relay.playerId] = {
        id:   relay.playerId,
        name: window.GameBoot.name || '플레이어',
        taps: 0,
      };
      renderPlayerList(relay.players());
    }
    btnStart.disabled = false;
  });

  // 탭 버튼 — 클릭 & 터치 모두 지원
  // touch 이벤트를 click 대신 직접 처리해 지연(300ms) 없이 즉시 반응
  tapBtn.addEventListener('click', onTap);
  // ✏️ 터치 디바이스에서 더 빠른 반응을 원하면 아래 touchstart를 활성화하고
  // click 리스너를 제거하세요. 단, 스크롤과 충돌할 수 있으니 주의하세요.
  // tapBtn.addEventListener('touchstart', function (e) { e.preventDefault(); onTap(); }, { passive: false });

  /* ──────────────────────────────────────────────────────
     앱 진입점
     ────────────────────────────────────────────────────── */
  initRelay();

})();
