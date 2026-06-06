/* 전송 계층 추상화 — NetClient가 의존하는 공통 인터페이스:
 *   transport.ready : Promise<transport>
 *   transport.selfId: 내 식별자 (ready 이후)
 *   transport.send(payload)
 *   transport.on('message', cb)  // cb({from, payload, ts})  ts=서버/버스 타임스탬프
 *   transport.on('players', cb)  // cb([{playerId,name},...])
 *
 * 두 구현:
 *   - LoopbackTransport : DO 없이 in-page 2클라 검증용(지연·지터 시뮬). 혼자 검증 가능.
 *   - RelayTransport    : shared/relay.js(MallangRelay) 래핑(프로덕션). worker+2클라 통합테스트 필요. */
(function (global) {

  // ===== Loopback (로컬 검증용) =====
  function LoopbackBus(opts) {
    opts = opts || {};
    this.endpoints = [];
    this.latency = opts.latency != null ? opts.latency : 80; // 편도 지연(ms)
    this.jitter = opts.jitter != null ? opts.jitter : 40;
    this.t0 = (global.performance ? performance.now() : Date.now());
  }
  LoopbackBus.prototype.now = function () { // 서버(버스) 시계
    return (global.performance ? performance.now() : Date.now()) - this.t0;
  };
  LoopbackBus.prototype.register = function (ep) { this.endpoints.push(ep); this._broadcastPlayers(); };
  LoopbackBus.prototype.unregister = function (ep) {
    var i = this.endpoints.indexOf(ep);
    if (i >= 0) this.endpoints.splice(i, 1);
    this._broadcastPlayers();
  };
  LoopbackBus.prototype._players = function () {
    return this.endpoints.map(function (e) { return { playerId: e.id, name: e.name }; });
  };
  LoopbackBus.prototype._broadcastPlayers = function () {
    var ps = this._players();
    this.endpoints.forEach(function (e) { e._emit('players', ps.slice()); });
  };
  LoopbackBus.prototype.publish = function (from, payload, echo) {
    var ts = this.now();
    var lat = Math.max(0, this.latency + (Math.random() * 2 - 1) * this.jitter);
    this.endpoints.forEach(function (e) {
      if (e.id === from && !echo) return;
      setTimeout(function () { e._emit('message', { from: from, payload: payload, ts: ts }); }, lat);
    });
  };

  function LoopbackTransport(bus, id, name) {
    this.bus = bus; this.id = id; this.selfId = id; this.name = name || id;
    this._l = { message: [], players: [] };
    this.ready = Promise.resolve(this);
    bus.register(this);
  }
  LoopbackTransport.prototype.on = function (ev, cb) { if (this._l[ev]) this._l[ev].push(cb); return this; };
  LoopbackTransport.prototype._emit = function (ev, arg) {
    (this._l[ev] || []).forEach(function (fn) { try { fn(arg); } catch (e) { /* ignore */ } });
  };
  LoopbackTransport.prototype.send = function (payload) { this.bus.publish(this.id, payload, false); return true; };
  LoopbackTransport.prototype.serverNow = function () { return this.bus.now(); };
  LoopbackTransport.prototype.leave = function () { this.bus.unregister(this); };

  // ===== Relay (프로덕션: MallangRelay 래핑) =====
  function RelayTransport(opts) {
    var self = this;
    this._l = { message: [], players: [] };
    this.selfId = null;
    var relay = global.MallangRelay.create(opts || {});
    this._relay = relay;
    this.ready = relay.ready.then(function () { self.selfId = relay.playerId; return self; });
    relay.on('message', function (m) { self._emit('message', m); }); // {from,payload,ts}
    relay.on('players', function (list) { self._emit('players', list); });
  }
  RelayTransport.prototype.on = function (ev, cb) { if (this._l[ev]) this._l[ev].push(cb); return this; };
  RelayTransport.prototype._emit = function (ev, arg) {
    (this._l[ev] || []).forEach(function (fn) { try { fn(arg); } catch (e) { /* ignore */ } });
  };
  RelayTransport.prototype.send = function (payload) { return this._relay.send(payload); };
  RelayTransport.prototype.leave = function () { this._relay.leave(); };

  global.LoopbackBus = LoopbackBus;
  global.LoopbackTransport = LoopbackTransport;
  global.RelayTransport = RelayTransport;
})(window);
