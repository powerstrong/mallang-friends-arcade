/* multiplayer.js — 말랑 깜짝파티 느슨한 릴레이 멀티 (window 전역)
 *
 * mallang-stairs 규약 계승: MallangRelay 는 transport 만. 판정/점수/사망은 100% 로컬
 * 엔진이 결정하고, 이 모듈은 "친구가 몇 라운드에서 몇 목숨인가"의 스냅샷만 주고받는다.
 *
 * 공유 시드 = 방 코드(relay.code). 같은 방 전원이 동일한 미션 순서를 본다.
 * 시작 동기화: 누가 먼저 시작을 누르든 { t:'start' } 가 전파되고 중복은 무시된다.
 * 스냅샷에 name/char 를 실어 보내므로 로스터 이름 조회에 의존하지 않는다.
 */
(function () {
  'use strict';

  var SNAPSHOT_INTERVAL_MS = 400; // 라운드 단위 게임이라 낮은 빈도로 충분. 중요 이벤트는 force.
  // 직접 URL(/games/surprise-party/index.html) 진입은 GameBoot.gameId 가 null 이므로
  // 명시 폴백이 없으면 릴레이가 영영 안 켜진다 (codex 리뷰 Critical #1).
  var GAME_ID = 'surprise-party';

  function create() {
    var boot = window.GameBoot || {};
    var hasRelay = !!window.MallangRelay;

    var state = {
      available: hasRelay,
      isMulti: false,
      myId: boot.playerId || 'me',
      myName: boot.name || '',
      code: boot.code || null,
      remotes: {},   // id -> { id, name, char, runId, round, lives, score, alive }
      started: false,
      runId: null,
    };

    var relay = null;
    var lastSendAt = 0;
    var cbs = { players: [], start: [], snapshot: [], change: [] };
    function fire(ev, arg) { cbs[ev].forEach(function (f) { try { f(arg); } catch (e) {} }); }

    function handleMessage(msg) {
      var from = msg.from;
      var p = msg.payload || {};
      if (from === state.myId) return;
      if (p.t === 'start') {
        // runId 로 판(run)을 구분한다 — 늦은 합류자가 이전 판 신호/스냅샷과 섞이지 않게.
        if (!state.started || (p.runId && p.runId !== state.runId)) {
          state.started = true;
          state.runId = p.runId || state.runId;
          fire('start', p);
        }
        return;
      }
      if (p.t === 'snap') {
        var r = state.remotes[from] || { id: from };
        r.name = p.name || r.name || '친구';
        r.char = p.char || r.char || null;
        r.runId = p.runId || null;
        r.round = p.round | 0;
        r.lives = p.lives | 0;
        r.score = p.score | 0;
        r.alive = p.alive !== false;
        // 네트워크 끊김은 relay_presence 가 수십 초 늦을 수 있어(서버 TCP 타임아웃)
        // 스냅샷 신선도로도 생존을 판단할 수 있게 수신 시각을 남긴다.
        r.lastSeen = Date.now();
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
      get started() { return state.started; },
      get runId() { return state.runId; },
      remotes: function () { return state.remotes; },
      remoteList: function () {
        return Object.keys(state.remotes).map(function (id) { return state.remotes[id]; });
      },
      seedString: function () { return state.code || null; },

      on: function (ev, cb) { if (cbs[ev]) cbs[ev].push(cb); return this; },

      connect: function (name, characterId) {
        if (!state.available) return Promise.reject(new Error('relay 사용 불가'));
        state.myName = name || state.myName || '말랑이';
        state.started = false;
        relay = window.MallangRelay.create({
          gameId: boot.gameId || GAME_ID, name: state.myName, characterId: characterId || null,
        });
        relay.on('players', function (list) {
          state.myId = relay.playerId || state.myId;
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

      broadcastStart: function (runId) {
        if (!relay) return;
        state.started = true;
        state.runId = runId || null;
        relay.send({ t: 'start', runId: runId });
      },

      // s = { runId, round, lives, score, alive, name, char }
      sendSnapshot: function (s, force) {
        if (!relay) return;
        var now = (window.performance && performance.now) ? performance.now() : Date.now();
        if (!force && now - lastSendAt < SNAPSHOT_INTERVAL_MS) return;
        lastSendAt = now;
        relay.send({
          t: 'snap', runId: s.runId || null, round: s.round, lives: s.lives, score: s.score,
          alive: s.alive !== false, name: s.name, char: s.char,
        });
      },

      leave: function () { if (relay) relay.leave(); },
    };
  }

  window.SurprisePartyMP = { create: create };
})();
