/* MallangRelay — 릴레이(중계) 멀티플레이용 클라이언트 SDK.
 *
 * 서버는 같은 방(roomCode) + 같은 gameId 의 참가자끼리 메시지를 "그대로 중계"만 한다.
 * 게임 로직·점수·승패 판정은 전적으로 클라이언트에 있다. 기여자는 서버 코드를 한 줄도
 * 작성하지 않고 이 SDK 만으로 실시간 멀티플레이 게임을 만들 수 있다.
 * (서버 권위가 필요한 게임은 관리자와 상의 — docs/PREVIEW.md 참고.)
 *
 * 사용 예:
 *   <script src="/shared/config.js"></script>
 *   <script src="/shared/bootstrap.js"></script>
 *   <script src="/shared/relay.js"></script>
 *   <script>
 *     const relay = MallangRelay.create({ gameId: 'my-game', name: '토끼' });
 *     relay.on('players', list => renderPlayers(list));      // 참가자 목록 변경
 *     relay.on('message', ({ from, payload }) => apply(from, payload)); // 다른 참가자 메시지
 *     await relay.ready;            // 합류 완료
 *     console.log('내 id:', relay.playerId, '방코드:', relay.code);
 *     relay.send({ x: 10, y: 20 }); // 같은 방의 다른 참가자에게 전송
 *   </script>
 *
 * 방 코드 규칙:
 *   - URL 에 ?code=XXXX 가 있으면 그 방에 합류 (GameBoot.code).
 *   - 없으면 새 방을 만들고 relay.code 로 코드를 알려준다 → 친구에게 ?code=XXXX 공유.
 */
(function () {
  'use strict';

  function httpBase() {
    return window.WORKER_URL || window.location.origin;
  }
  function wsBase() {
    return httpBase().replace(/^http/, 'ws');
  }

  // 방 코드가 없으면 새로 생성. 있으면 그대로 사용.
  async function ensureCode(code) {
    if (code) return code;
    const res = await fetch(httpBase() + '/api/rooms', { method: 'POST' });
    if (!res.ok) throw new Error('방 생성 실패: HTTP ' + res.status);
    const data = await res.json();
    if (!data || !data.code) throw new Error('방 생성 응답에 code 가 없습니다.');
    return data.code;
  }

  function create(opts) {
    opts = opts || {};
    const boot = window.GameBoot || {};
    const gameId = opts.gameId || boot.gameId;
    if (!gameId) throw new Error('MallangRelay.create: gameId 가 필요합니다.');
    const name = String(opts.name || boot.name || '플레이어').slice(0, 32);
    const characterId = opts.characterId || null;
    let code = opts.code || boot.code || null;

    const listeners = { players: [], message: [], open: [], close: [], error: [], ready: [] };
    let ws = null;
    let roster = [];
    let closed = false;
    let resolveReady, rejectReady, readySettled = false;
    const ready = new Promise(function (res, rej) { resolveReady = res; rejectReady = rej; });
    function settleReject(err) { if (!readySettled) { readySettled = true; rejectReady(err); } }

    function emit(ev, arg) {
      (listeners[ev] || []).forEach(function (fn) { try { fn(arg); } catch (e) { /* ignore */ } });
    }

    const handle = {
      ready: ready,
      code: code,
      playerId: null,
      players: function () { return roster.slice(); },
      on: function (ev, cb) { if (listeners[ev]) listeners[ev].push(cb); return handle; },
      // 같은 방의 다른 참가자에게 payload 를 전송. echo:true 면 자신도 받음.
      send: function (payload, options) {
        if (!ws || ws.readyState !== 1) return false;
        let payloadText;
        try { payloadText = JSON.stringify(payload === undefined ? null : payload); } catch (e) { return false; }
        // 서버 캡(8192 바이트)과 동일 — 초과 시 서버가 어차피 드롭하므로 미리 막고 알린다.
        if (new TextEncoder().encode(payloadText).length > 8192) {
          emit('error', new Error('relay payload 가 8192바이트를 초과해 전송하지 않았습니다.'));
          return false;
        }
        ws.send(JSON.stringify({ type: 'relay', payload: payload, echo: !!(options && options.echo) }));
        return true;
      },
      leave: function () { closed = true; try { if (ws) ws.close(); } catch (e) { /* ignore */ } },
    };

    async function start() {
      try {
        code = await ensureCode(code);
        handle.code = code;
        const url = wsBase() + '/api/rooms/' + encodeURIComponent(code);
        ws = new WebSocket(url);

        ws.addEventListener('open', function () {
          ws.send(JSON.stringify({ type: 'join', name: name, playerId: boot.playerId || undefined }));
          emit('open');
        });

        ws.addEventListener('message', function (e) {
          let m;
          try { m = JSON.parse(e.data); } catch (err) { return; }
          if (m.type === 'welcome') {
            // 로비 합류 완료 → 릴레이 게임으로 합류 요청.
            handle.playerId = m.playerId;
            ws.send(JSON.stringify({
              type: 'join_game', gameId: gameId, mode: 'relay',
              playerId: m.playerId, name: name, characterId: characterId,
            }));
          } else if (m.type === 'relay_joined') {
            handle.playerId = m.playerId;
            roster = m.players || [];
            readySettled = true;
            emit('players', roster.slice());
            emit('ready', handle);
            resolveReady(handle);
          } else if (m.type === 'relay_presence') {
            roster = m.players || [];
            emit('players', roster.slice());
          } else if (m.type === 'relay') {
            emit('message', { from: m.from, payload: m.payload, ts: m.ts });
          } else if (m.type === 'error') {
            emit('error', new Error(m.message || '릴레이 오류'));
          }
        });

        ws.addEventListener('close', function () {
          settleReject(new Error('합류 전에 연결이 종료되었습니다.'));  // ready 미해결 시에만 reject
          if (!closed) emit('close');
        });
        ws.addEventListener('error', function () {
          const err = new Error('WebSocket 오류');
          settleReject(err);
          emit('error', err);
        });
      } catch (err) {
        settleReject(err);
        emit('error', err);
      }
    }

    start();
    return handle;
  }

  window.MallangRelay = { create: create };
})();
