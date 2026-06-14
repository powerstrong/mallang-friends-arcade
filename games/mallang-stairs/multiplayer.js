/* multiplayer.js — 말랑 계단 레이스 느슨한 릴레이 멀티 (window 전역)
 *
 * 역할: MallangRelay 로 같은 방 참가자와 진행도/점수/생존을 공유한다.
 * 절대 하지 않는 것: 게임 판정. 입력/사망/점수는 100% 로컬 engine 이 결정하고,
 *   이 모듈은 "상대가 어디까지 갔나"를 표시하기 위한 스냅샷 송수신만 한다.
 *
 * 공유 시드: 방 코드(relay.code === GameBoot.code)를 그대로 시드 문자열로 쓴다.
 *   → 같은 방의 모두가 동일한 계단 패턴을 본다.
 *
 * 시작 동기화: 누구든 먼저 start 를 누르면 broadcastStart() 가 모두에게 전파되고,
 *   중복 start 는 무시(idempotent)되어 모든 클라가 같은 신호로 카운트다운을 시작한다.
 */
(function () {
  'use strict';

  var SNAPSHOT_INTERVAL_MS = 130; // ≈7.7Hz

  function create() {
    var boot = window.GameBoot || {};
    var hasRelay = !!(window.MallangRelay && boot.gameId);

    var state = {
      available: hasRelay,
      isMulti: false,
      myId: boot.playerId || 'me',
      myName: boot.name || '나',
      code: boot.code || null,
      remotes: {},          // id -> { id, name, step, score, combo, gaugeRatio, feverActive, alive }
      started: false,
    };

    var relay = null;
    var lastSendAt = 0;
    var cbs = { players: [], start: [], snapshot: [], change: [] };
    function fire(ev, arg) { cbs[ev].forEach(function (f) { try { f(arg); } catch (e) {} }); }

    function rosterName(id) {
      if (!relay) return id;
      var p = relay.players().find(function (r) { return r.playerId === id || r.id === id; });
      return (p && p.name) || id;
    }

    function handleMessage(msg) {
      var from = msg.from;
      var p = msg.payload || {};
      if (from === state.myId) return;
      if (p.t === 'start') {
        if (!state.started) { state.started = true; fire('start', p); }
        return;
      }
      if (p.t === 'snap') {
        var r = state.remotes[from] || { id: from, name: rosterName(from) };
        r.step = p.step; r.score = p.score; r.combo = p.combo;
        r.gaugeRatio = p.g; r.feverActive = !!p.fv; r.alive = p.alive !== false;
        r.name = r.name || rosterName(from);
        state.remotes[from] = r;
        fire('snapshot', r);
        fire('change');
      }
    }

    return {
      get available() { return state.available; },
      get isMulti() { return state.isMulti; },
      get myId() { return state.myId; },
      get code() { return state.code; },
      remotes: function () { return state.remotes; },
      seedString: function () { return state.code || 'solo'; },

      on: function (ev, cb) { if (cbs[ev]) cbs[ev].push(cb); return this; },

      // 특정 이벤트의 리스너를 모두 제거 (리트라이 시 누적 방지)
      off: function (ev) { if (cbs[ev]) cbs[ev] = []; return this; },

      // 방에 합류. 성공 시 공유 시드(code)가 준비된다.
      connect: function (characterId) {
        if (!state.available) return Promise.reject(new Error('relay 사용 불가'));
        // 재접속 시 started 플래그 초기화
        state.started = false;
        relay = window.MallangRelay.create({
          gameId: boot.gameId, name: state.myName, characterId: characterId,
        });
        relay.on('players', function (list) {
          state.myId = relay.playerId || state.myId;
          // 떠난 참가자 정리
          var ids = {};
          list.forEach(function (r) { ids[r.playerId || r.id] = true; });
          Object.keys(state.remotes).forEach(function (id) {
            if (!ids[id]) delete state.remotes[id];
          });
          fire('players', list);
          fire('change');
        });
        relay.on('message', handleMessage);
        return relay.ready.then(function () {
          state.isMulti = true;
          state.myId = relay.playerId || state.myId;
          state.code = relay.code || state.code;
          return { code: state.code, myId: state.myId };
        });
      },

      // 시작 신호 브로드캐스트 (모두가 같은 신호로 카운트다운 시작)
      broadcastStart: function () {
        if (!relay) return;
        state.started = true;
        relay.send({ t: 'start' });
      },

      // 진행 스냅샷 송신 (스로틀). force=true 면 즉시(사망/시작 등).
      sendSnapshot: function (s, force) {
        if (!relay) return;
        var now = (window.performance && performance.now) ? performance.now() : 0;
        if (!force && now - lastSendAt < SNAPSHOT_INTERVAL_MS) return;
        lastSendAt = now;
        relay.send({
          t: 'snap', step: s.pos, score: s.score, combo: s.combo,
          g: Math.round(s.gaugeRatio * 100) / 100, fv: s.feverActive, alive: !s.dead,
        });
      },

      leave: function () { if (relay) relay.leave(); },
    };
  }

  window.MallangStairsMP = { create: create };
})();
