/* GameBoot — common bootstrap contract for all game prototypes.
 *
 * Load this before game.js to get a standard interface for:
 *   - reading session params (code, name, gameId, type)
 *   - submitting results (PARTY_ASYNC stubs to sessionStorage for now)
 *   - navigating back after a round ends
 *
 * Usage:
 *   <script src="/shared/bootstrap.js"></script>
 *   // then in game.js:
 *   const { code, name, isMultiplayer } = window.GameBoot;
 *   window.GameBoot.submitResult({ score: 42, duration: 30 });
 *   window.GameBoot.exit();
 */

window.GameBoot = (function () {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code')   || null;
  const name   = params.get('name')   || null;
  const gameId = params.get('gameId') || null;
  const playerId = params.get('playerId') || null;
  const characterId = params.get('characterId') || null;

  const registry = window.GAME_REGISTRY || [];
  const gameMeta = registry.find(g => g.id === gameId) || null;
  const gameType = gameMeta ? gameMeta.type : 'SOLO';

  // 'world' when the game was launched from the world lounge (= round trip
  // back through /world on exit). Useful for the result screen to drop
  // the "한 판 더" affordance — world lobbies don't support instant restart.
  const from = params.get('from') || null;

  // true when launched from a multiplayer lobby
  const isMultiplayer = !!code;

  function submitResult(result) {
    // Persists result to sessionStorage so a results screen can read it.
    // Future: POST to worker for PARTY_ASYNC leaderboard once that API exists.
    const entry = {
      gameId,
      code,
      name,
      type: gameType,
      timestamp: Date.now(),
      ...result,
    };
    try {
      const stored = JSON.parse(sessionStorage.getItem('lastGameResult') || 'null');
      const history = JSON.parse(sessionStorage.getItem('gameHistory') || '[]');
      history.push(entry);
      sessionStorage.setItem('lastGameResult', JSON.stringify(entry));
      sessionStorage.setItem('gameHistory', JSON.stringify(history.slice(-20)));
    } catch {
      /* storage unavailable — ignore */
    }
  }

  function exit() {
    // World-launched games carry from=world&worldId=... so we return players
    // to the lounge they came from. Also tag from=game so the world client
    // triggers a random spawn + landing effect instead of placing the player
    // at the fixed SPAWN_POINT.
    if (from === 'world' || from === 'lab') {
      const worldId = params.get('worldId');
      const out = new URLSearchParams();
      if (worldId) out.set('worldId', worldId);
      out.set('from', 'game');
      window.location.href = '/world/?' + out.toString();
      return;
    }
    // Solo / direct-link sessions fall back to the brand landing page.
    window.location.href = '/';
  }

  // ── 브라우저 뒤로가기 = "광장으로" 버튼과 동일 동작 ──────────────────────────
  // 문제: 게임 중 브라우저 뒤로가기를 그대로 두면 목적지(광장) 페이지가 bfcache
  // 에서 복원되면서, 이미 닫힌 WebSocket 을 문 채 되살아난다. 그 결과 광장에
  // 유령 캐릭터(중복 세션)가 남고 연결이 반쯤 끊긴 상태가 된다.
  // 해결: 뒤로가기를 가로채 exit() 로 라우팅한다. 그러면 "광장으로" 버튼과
  // 똑같이 실제 네비게이션(from=game)이 일어나 현재 페이지가 언로드되며 소켓이
  // 깔끔히 닫히고, 광장은 bfcache 가 아니라 새 로드로 auto-rejoin 한다.
  let exiting = false;
  function guardedExit() {
    if (exiting) return;
    exiting = true;
    exit();
  }
  try {
    // 센티넬 히스토리 항목을 하나 쌓아, 첫 뒤로가기가 이전 페이지로 곧장
    // 넘어가지 않고 이 페이지에 머문 채 popstate 를 발생시키도록 한다.
    history.pushState({ __mfaGameGuard: true }, '');
    window.addEventListener('popstate', guardedExit);
  } catch { /* history 미지원 — 무시 */ }
  // 게임 페이지 자체가 bfcache 에서 복원되면(광장→앞으로가기 등) 소켓이 이미
  // 죽어 있으므로 새로고침으로 깨끗한 상태를 다시 만든다.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) window.location.reload();
  });

  return { code, name, gameId, gameType, playerId, characterId, isMultiplayer, from, submitResult, exit };
})();
