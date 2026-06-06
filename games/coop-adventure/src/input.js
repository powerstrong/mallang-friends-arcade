/* CoopInput — 통합 입력 추상화 (키보드 + 가상패드)
 * 게임 루프는 매 프레임 state(left/right/jumpHeld)를 폴링하고,
 * 점프는 consumeJump()로 엣지(눌림) 1회를 소비한다 → 점프 버퍼와 결합.
 * 멀티터치: 버튼별 pointerId 추적으로 이동+점프 동시 입력 보장. */
(function (global) {
  function CoopInput() {
    this.left = false;
    this.right = false;
    this.jumpHeld = false;
    this._jumpQueued = false;
    this._keyDown = {};
    this._padPointer = { left: null, right: null, jump: null };
  }

  CoopInput.prototype.consumeJump = function () {
    if (this._jumpQueued) { this._jumpQueued = false; return true; }
    return false;
  };
  CoopInput.prototype._pressJump = function () { this._jumpQueued = true; this.jumpHeld = true; };
  CoopInput.prototype._releaseJump = function () { this.jumpHeld = false; };

  CoopInput.prototype.attachKeyboard = function () {
    var self = this;
    window.addEventListener('keydown', function (e) {
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': self.left = true; break;
        case 'ArrowRight': case 'KeyD': self.right = true; break;
        case 'Space': case 'ArrowUp': case 'KeyW':
          if (!self._keyDown[e.code]) self._pressJump();
          self._keyDown[e.code] = true;
          e.preventDefault();
          break;
      }
    });
    window.addEventListener('keyup', function (e) {
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': self.left = false; break;
        case 'ArrowRight': case 'KeyD': self.right = false; break;
        case 'Space': case 'ArrowUp': case 'KeyW':
          self._keyDown[e.code] = false; self._releaseJump(); break;
      }
    });
  };

  /* action: 'left' | 'right' | 'jump' */
  CoopInput.prototype.attachButton = function (el, action) {
    if (!el) return;
    var self = this;
    el.style.touchAction = 'none';

    var press = function (e) {
      e.preventDefault();
      if (self._padPointer[action] !== null) return;       // 이미 그 버튼이 눌림
      self._padPointer[action] = e.pointerId;
      if (action === 'jump') self._pressJump();
      else self[action] = true;
      el.classList.add('is-pressed');
    };
    var release = function (e) {
      if (self._padPointer[action] !== e.pointerId) return; // 다른 손가락
      self._padPointer[action] = null;
      if (action === 'jump') self._releaseJump();
      else self[action] = false;
      el.classList.remove('is-pressed');
    };

    el.addEventListener('pointerdown', press);
    // 손가락이 버튼 밖에서 떼져도 해제되도록 window에서 받음
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  };

  global.CoopInput = CoopInput;
})(window);
