/* NetClient — 전송 계층(transport) 위에서 멀티플레이 동기화를 관리.
 *  - sendPos(state): 내 캐릭터 상태를 sendInterval(기본 ~12Hz)로 throttle 송신
 *  - 수신: from을 신뢰 식별자로 사용, peer별 RemoteClock(서버ts→로컬 매핑) + RemotePlayer(보간)
 *  - sample(id, now): 해당 peer의 보간 위치
 * 내 캐릭터는 로컬 예측이므로 이 레이어를 거치지 않는다. (codex 리뷰 반영) */
(function (global) {
  function NetClient(transport, opts) {
    opts = opts || {};
    var self = this;
    this.transport = transport;
    this.now = opts.now || function () { return (global.performance ? performance.now() : Date.now()); };
    this.sendInterval = opts.sendInterval || 80; // ms (~12.5Hz)
    this.remoteOpts = opts.remoteOpts || {};
    this.peers = {};        // id -> { clock, remote, name }
    this._seq = 0;
    this._lastSend = -1e9;
    this.selfId = null;

    transport.on('message', function (m) { self._onMessage(m); });
    transport.on('players', function (list) { self._onPlayers(list); });
    this.ready = transport.ready.then(function () { self.selfId = transport.selfId; return self; });
  }

  NetClient.prototype._peer = function (id) {
    if (!this.peers[id]) {
      this.peers[id] = { clock: new RemoteClock(), remote: new RemotePlayer(this.remoteOpts), name: id };
    }
    return this.peers[id];
  };

  NetClient.prototype._onMessage = function (m) {
    // 방어: from은 문자열, ts/x/y/seq는 유한수만 (악성/깨진 payload가 clock·위치를 NaN으로 오염시키는 것 차단)
    if (!m || typeof m.from !== 'string') return;
    if (this.selfId != null && m.from === this.selfId) return; // 내 메시지 무시
    if (!isFinite(m.ts)) return;
    var p = m.payload;
    if (!p || p.type !== 'pos') return;
    if (!isFinite(p.x) || !isFinite(p.y)) return;
    var peer = this._peer(m.from);
    peer.clock.observe(m.ts, this.now());           // 서버ts → 로컬 시간 오프셋 학습
    peer.remote.push({
      seq: isFinite(p.seq) ? p.seq : null,
      t: peer.clock.toLocal(m.ts),
      x: p.x, y: p.y,
      vx: isFinite(p.vx) ? p.vx : 0,
      vy: isFinite(p.vy) ? p.vy : 0
    });
    if (p.name) peer.name = p.name;
  };

  NetClient.prototype._onPlayers = function (list) {
    var alive = {};
    // roster 키가 worker는 {id}, loopback은 {playerId} → 둘 다 수용 (안 하면 활성 peer를 삭제)
    (list || []).forEach(function (pl) {
      var id = (pl && pl.id != null) ? pl.id : (pl && pl.playerId);
      if (id != null) alive[id] = true;
    });
    for (var id in this.peers) {
      if (Object.prototype.hasOwnProperty.call(this.peers, id) && !alive[id] && id !== this.selfId) {
        delete this.peers[id]; // 이탈 플레이어 정리
      }
    }
  };

  NetClient.prototype.sendPos = function (state) {
    var t = this.now();
    if (t - this._lastSend < this.sendInterval) return false;
    this._lastSend = t;
    return this.transport.send({
      type: 'pos', seq: this._seq++,
      x: state.x, y: state.y, vx: state.vx || 0, vy: state.vy || 0,
      grounded: !!state.grounded, facing: state.facing || 1, name: state.name
    });
  };

  NetClient.prototype.sample = function (id, now) {
    var pr = this.peers[id];
    return pr ? pr.remote.sample(now != null ? now : this.now()) : null;
  };
  NetClient.prototype.firstPeerId = function () {
    for (var id in this.peers) { if (Object.prototype.hasOwnProperty.call(this.peers, id)) return id; }
    return null;
  };
  NetClient.prototype.peerCount = function () { return Object.keys(this.peers).length; };

  global.NetClient = NetClient;
})(window);
