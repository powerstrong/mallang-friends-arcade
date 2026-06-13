/* MARCoop — 2인 협동 연결·프로토콜 (M5)
 *
 * 서버 권위는 worker/src/games/machine_animal_runner.js 가 가진다:
 * 보스 HP·phase, 새장 소비, 하이파이브 판정, 인정 amount/power 클램프.
 * 클라(이 모듈)는 ① 방 생성/합류 ② 이벤트 송신(스로틀) ③ 서버 이벤트를 콜백으로
 * 씬에 전달만 한다. 솔로 경로는 이 모듈이 active=false 면 일절 건드리지 않는다.
 *
 * 합류 시퀀스(템플릿 규약): POST /api/rooms → ws /api/rooms/:code
 *   → {type:'join'} → welcome → {type:'join_game', gameId, mode:'module'}
 *   → 서버 모듈 onJoin → {type:'mod', event:'joined', seat}
 *
 * 메시지 예산: pos 5Hz + dps 4Hz ≈ 9msg/s (서버 rate limit 40/s 의 1/4). */
(function (global) {
  var GAME_ID = 'machine-animal-runner';
  var POS_INTERVAL = 200;   // ms (5Hz)
  var DPS_INTERVAL = 250;   // ms (4Hz) — dt 를 적산해서 보낸다(상한 0.3s 는 서버가 집행)

  var coop = {
    active: false,        // 협동 모드인가(연결 시도 순간부터 true)
    started: false,       // 서버 'start' 수신 후
    seat: null,           // 'L' | 'R'
    you: null,
    roomCode: null,
    stage: 1,
    startTs: 0,
    bossHp: 0, bossMax: 0,
    lobbySeats: {},
    on: {},               // 씬이 끼우는 이벤트 핸들러: on.lobby/start/highfive/gate/pos/boss/hp/cage/revive/win/lose/partnerLeft/reset/full/error
  };

  var ws = null;
  var lastPosSent = 0;
  var dpsAcc = 0, lastDpsSent = 0;

  function emit(name, arg) {
    try { if (coop.on[name]) coop.on[name](arg); } catch (e) { /* 씬 콜백 오류 격리 */ }
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }
  function sendMod(payload) { send({ type: 'mod', payload: payload }); }

  function base() { return window.WORKER_URL || window.location.origin; }

  /* code 없으면 방 생성. name 은 로비 표시용. */
  coop.connect = function (code, name) {
    coop.active = true;
    var p = code
      ? Promise.resolve(code)
      : fetch(base() + '/api/rooms', { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function (d) { return d.code; });
    p.then(function (roomCode) {
      coop.roomCode = roomCode;
      var url = base().replace(/^http/, 'ws') + '/api/rooms/' + encodeURIComponent(roomCode);
      ws = new WebSocket(url);
      ws.onopen = function () { send({ type: 'join', name: name || '말랑친구' }); };
      ws.onmessage = function (e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        handle(msg);
      };
      ws.onclose = function () { if (coop.active) emit('reset', 'closed'); };
      ws.onerror = function () { emit('error', 'ws'); };
    }).catch(function () { emit('error', 'room'); });
  };

  function handle(msg) {
    if (msg.type === 'welcome') {
      send({ type: 'join_game', gameId: GAME_ID, mode: 'module' });
      return;
    }
    if (msg.type !== 'mod') return;
    switch (msg.event) {
      case 'joined':
        coop.you = msg.you; coop.seat = msg.seat; coop.stage = msg.stage || 1;
        emit('joined', msg); break;
      case 'full': emit('full'); break;
      case 'lobby':
        coop.stage = msg.stage; coop.lobbySeats = msg.seats || {};
        emit('lobby', msg); break;
      case 'start':
        coop.started = true; coop.stage = msg.stage; coop.startTs = msg.ts;
        emit('start', msg); break;
      case 'highfive': emit('highfive', msg); break;
      case 'gate': if (msg.seat !== coop.seat) emit('gate', msg); break;
      case 'pos': if (msg.seat !== coop.seat) emit('pos', msg); break;
      case 'boss': coop.bossHp = msg.hp; coop.bossMax = msg.max; emit('boss', msg); break;
      case 'hp': coop.bossHp = msg.hp; emit('hp', msg); break;
      case 'cage': emit('cage', msg); break;
      case 'revive': emit('revive', msg); break;
      case 'win': emit('win', msg); break;
      case 'lose': emit('lose', msg); break;
      case 'partner_left': emit('partnerLeft', msg); break;
      case 'reset': emit('reset', msg.reason); break;
    }
  }

  // ── 송신 API (씬에서 호출) ─────────────────────────────────────────────
  coop.sendStage = function (stage) { sendMod({ a: 'lobby', stage: stage }); };
  coop.sendReady = function () { sendMod({ a: 'ready' }); };
  coop.sendGate = function (seq, amount, power) {
    sendMod({ a: 'gate', seq: seq, amount: amount, power: power });
  };
  /* x 는 자기 레인 내 비율(0..1) */
  coop.sendPos = function (x, amount, tier) {
    var t = Date.now();
    if (t - lastPosSent < POS_INTERVAL) return;
    lastPosSent = t;
    sendMod({ a: 'pos', x: x, amount: amount, tier: tier });
  };
  coop.sendBossEnter = function () { sendMod({ a: 'boss_enter' }); };
  /* 매 프레임 호출 — dt 적산 후 4Hz 로 송신. 서버가 dt≤0.3 클램프하므로 그 이하로 끊는다. */
  coop.sendDps = function (amount, power, dt) {
    dpsAcc += dt;
    var t = Date.now();
    if (t - lastDpsSent < DPS_INTERVAL) return;
    lastDpsSent = t;
    var send_dt = Math.min(0.3, dpsAcc);
    dpsAcc = 0;
    sendMod({ a: 'dps', amount: amount, power: power, dt: send_dt });
  };
  coop.sendWipe = function (x) { sendMod({ a: 'wipe', x: x }); };
  coop.sendCageHit = function () { sendMod({ a: 'cage_hit' }); };

  coop.disconnect = function () {
    coop.active = false; coop.started = false; coop.seat = null;
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  };

  global.MARCoop = coop;
})(window);
