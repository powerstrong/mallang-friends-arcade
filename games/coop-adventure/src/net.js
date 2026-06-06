/* 원격 플레이어 렌더링 레이어 (S3 더미 검증 → S4 DO 중계 연결)
 * codex 넷코드 리뷰 반영:
 *  - RemoteClock: 서버/송신자 타임스탬프를 로컬 scene 시간축으로 EWMA 매핑(클럭 도메인 분리)
 *  - push: seq + 단조 t 검사로 중복/역순 스냅 drop
 *  - sample: delay 기본 180ms, 외삽은 dt 정상범위 + 속도 clamp로 폭주 방지
 * 내 캐릭터는 로컬 예측(즉각). 이 레이어는 "상대"에만 쓰며 로컬 물리 판정엔 절대 쓰지 않는다. */
(function (global) {

  /* 서버 타임스탬프(ts) → 로컬 scene 시간 오프셋 추정 (EWMA) */
  function RemoteClock() {
    this.offset = 0;
    this.ready = false;
  }
  RemoteClock.prototype.observe = function (serverTs, localNow) {
    var sample = localNow - serverTs;
    this.offset = this.ready ? (this.offset * 0.9 + sample * 0.1) : sample;
    this.ready = true;
  };
  RemoteClock.prototype.toLocal = function (serverTs) {
    return serverTs + this.offset;
  };

  function RemotePlayer(opts) {
    opts = opts || {};
    this.delay = opts.delay || 180;        // 보간 지연(ms). 느슨한 협동=반응성보다 안정 우선
    this.maxExtrap = opts.maxExtrap || 90; // 외삽 허용 한계(ms)
    this.buf = [];                         // {t,x,y,vx?,vy?,seq?} (로컬 시간축, 오름차순)
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.lastSeq = -1;
    this.stale = false;                    // 외삽 한계 초과(상대 정보 끊김) → fade 처리용
  }

  RemotePlayer.prototype.reset = function (x, y) {
    this.buf.length = 0;
    this.lastSeq = -1;
    if (x != null) this.x = x;
    if (y != null) this.y = y;
  };

  RemotePlayer.prototype.push = function (snap) {
    if (snap.seq != null) {
      if (snap.seq <= this.lastSeq) return;  // 중복/역순 시퀀스 drop
      this.lastSeq = snap.seq;
    }
    var n = this.buf.length;
    if (n && snap.t <= this.buf[n - 1].t) return; // 단조 t 위반 drop
    this.buf.push(snap);
    if (this.buf.length > 60) this.buf.shift();
  };

  RemotePlayer.prototype.sample = function (now) {
    var buf = this.buf;
    this.stale = false;
    if (buf.length === 0) return { x: this.x, y: this.y };

    var rt = now - this.delay;
    var first = buf[0];
    var last = buf[buf.length - 1];

    if (rt <= first.t) { this.x = first.x; this.y = first.y; return { x: this.x, y: this.y }; }

    if (rt >= last.t) return this._extrapolate(rt, last);

    for (var i = 0; i < buf.length - 1; i++) {
      var a = buf[i], b = buf[i + 1];
      if (rt >= a.t && rt <= b.t) {
        var u = (b.t - a.t) > 0 ? (rt - a.t) / (b.t - a.t) : 0;
        this.x = a.x + (b.x - a.x) * u;
        this.y = a.y + (b.y - a.y) * u;
        return { x: this.x, y: this.y };
      }
    }
    return { x: this.x, y: this.y };
  };

  // 외삽: 최근 스냅 속도로 짧게 연장. dt 비정상/한계초과 시 마지막 위치 hold.
  RemotePlayer.prototype._extrapolate = function (rt, last) {
    var over = rt - last.t;
    if (over > this.maxExtrap) { this.stale = true; over = this.maxExtrap; }

    var vx, vy; // px/ms
    if (last.vx != null && last.vy != null) {
      vx = last.vx / 1000; vy = last.vy / 1000; // 스냅은 px/s
    } else if (this.buf.length >= 2) {
      var p = this.buf[this.buf.length - 2];
      var dt = last.t - p.t;
      if (dt < 50 || dt > 250) { this.x = last.x; this.y = last.y; return { x: this.x, y: this.y }; }
      vx = (last.x - p.x) / dt; vy = (last.y - p.y) / dt;
    } else {
      this.x = last.x; this.y = last.y; return { x: this.x, y: this.y };
    }

    vx = Math.max(-0.6, Math.min(0.6, vx)); // ±600 px/s
    vy = Math.max(-1.4, Math.min(1.4, vy)); // ±1400 px/s
    this.x = last.x + vx * over;
    this.y = last.y + vy * over;
    return { x: this.x, y: this.y };
  };

  /* DummyPeer — DO 없이 S3 검증용. 시간 함수로 "실제 위치"를 만들고
   * 지정 주기(10~15Hz)로만 스냅샷을 흘려보낸다(네트워크 흉내). vx/vy도 제공. */
  function DummyPeer(opts) {
    opts = opts || {};
    this.startX = opts.startX || 120;
    this.groundY = opts.groundY || 660;
    this.speed = opts.speed || 170;
    this.jumpEvery = opts.jumpEvery || 1400;
    this.jumpHeight = opts.jumpHeight || 90;
    this.stopX = opts.stopX || Infinity;
    this.t0 = opts.t0 || 0;
  }
  DummyPeer.prototype.truePos = function (now) {
    var t = (now - this.t0) / 1000;
    var raw = this.startX + this.speed * t;
    var x = Math.min(raw, this.stopX);
    var phase = ((now - this.t0) % this.jumpEvery) / this.jumpEvery;
    var up = Math.sin(phase * Math.PI);
    var y = this.groundY - this.jumpHeight * Math.max(0, up);
    return { x: x, y: y, vx: raw < this.stopX ? this.speed : 0, vy: 0 };
  };

  global.RemoteClock = RemoteClock;
  global.RemotePlayer = RemotePlayer;
  global.DummyPeer = DummyPeer;
})(window);
