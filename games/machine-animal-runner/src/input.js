/* RunnerInput — 한 손가락 스티어링 입력
 * 부대를 좌우로 끄는 게 전부다. targetX(0..1 비율)를 들고 있고,
 * 씬은 매 프레임 이 비율을 레인 폭에 매핑해 부대 대장 위치를 lerp 추종시킨다.
 *   - 포인터(터치/마우스): 캔버스 위 위치 → 비율
 *   - 키보드(←/→, A/D): update(dt)에서 비율을 점진 이동(데스크톱 테스트용) */
(function (global) {
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function RunnerInput() {
    this.targetX = 0.5;
    this._active = false;
    this._keyL = false;
    this._keyR = false;
  }

  RunnerInput.prototype.attachKeyboard = function () {
    var self = this;
    window.addEventListener('keydown', function (e) {
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': self._keyL = true; e.preventDefault(); break;
        case 'ArrowRight': case 'KeyD': self._keyR = true; e.preventDefault(); break;
      }
    });
    window.addEventListener('keyup', function (e) {
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': self._keyL = false; break;
        case 'ArrowRight': case 'KeyD': self._keyR = false; break;
      }
    });
  };

  /* 캔버스 엘리먼트에 포인터 추적을 붙인다(씬 create에서 game.canvas 전달). */
  RunnerInput.prototype.attachPointer = function (canvas) {
    if (!canvas || this._pointerBound) return;
    this._pointerBound = true;
    var self = this;
    function setFrom(e) {
      var r = canvas.getBoundingClientRect();
      if (!r.width) return;
      self.targetX = clamp01((e.clientX - r.left) / r.width);
    }
    canvas.addEventListener('pointerdown', function (e) { self._active = true; setFrom(e); });
    window.addEventListener('pointermove', function (e) {
      if (self._active || e.pointerType === 'mouse') setFrom(e);
    });
    window.addEventListener('pointerup', function () { self._active = false; });
    window.addEventListener('pointercancel', function () { self._active = false; });
  };

  /* 키보드 이동 반영(프레임마다 호출). 포인터가 우선이지만 키도 같이 누적. */
  RunnerInput.prototype.update = function (dt) {
    var d = (this._keyR ? 1 : 0) - (this._keyL ? 1 : 0);
    if (d) this.targetX = clamp01(this.targetX + d * 1.1 * dt);
  };

  global.RunnerInput = RunnerInput;
})(window);
