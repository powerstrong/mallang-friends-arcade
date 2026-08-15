/*
 * 말랑프렌즈 키우기 — WebAudio 합성 효과음 (P5)
 *
 * 다른 부스 게임과 같은 패턴: 출시 전 실제 사운드 자산으로 1:1 교체할 수 있도록
 * 소리마다 함수 하나. 파일 자산이 없어도 게임이 소리를 낸다.
 * 음소거는 localStorage 에 저장되고 HUD 의 🔊 버튼이 토글한다.
 */
(function () {
  'use strict';

  var MUTE_KEY = 'mallang-idle-mute';
  var ctx = null;
  var broken = false;   // 컨텍스트 생성이 한 번 실패하면 영구 비활성 — 매번 재시도하지 않는다
  var muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}

  /* 사운드는 게임 흐름의 곁가지다. 어떤 예외도 보상 지급·저장 흐름을 끊으면 안 되므로
   * 컨텍스트 생성과 재생 전체를 예외 격리한다(codex 리뷰). */
  function ac() {
    if (broken) return null;
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { broken = true; return null; }
        ctx = new AC();
      }
      if (ctx.state === 'closed') { broken = true; return null; }
      if (ctx.state === 'suspended') {
        var p = ctx.resume();
        if (p && p.catch) p.catch(function () {});
      }
      return ctx;
    } catch (e) {
      broken = true;
      return null;
    }
  }

  /* 공용 톤 — freq 에서 슬라이드하며 짧게 사그라드는 오실레이터. */
  function tone(freq, dur, opts) {
    if (muted) return;
    var c = ac();
    if (!c) return;
    opts = opts || {};
    var t0 = c.currentTime + (opts.delay || 0);
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, opts.slide), t0 + dur);
    var vol = opts.vol || 0.12;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /* 노이즈 버스트 — 타격감용. */
  function thud(dur, vol, filterFreq) {
    if (muted) return;
    var c = ac();
    if (!c) return;
    var frames = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, frames, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    var src = c.createBufferSource();
    src.buffer = buf;
    var filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 900;
    var gain = c.createGain();
    gain.gain.value = vol || 0.1;
    src.connect(filter).connect(gain).connect(c.destination);
    src.start();
  }

  var lastHit = 0;
  var SFX = {
    /* 타격 — 초당 수 회 울리므로 스로틀해서 따닥거림을 막는다 */
    hit: function () {
      var now = Date.now();
      if (now - lastHit < 90) return;
      lastHit = now;
      thud(0.06, 0.07, 1200);
    },
    kill:     function () { tone(660, 0.09, { type: 'square', vol: 0.05, slide: 990 }); },
    coin:     function () { tone(988, 0.07, { type: 'triangle', vol: 0.07 }); tone(1319, 0.09, { type: 'triangle', vol: 0.07, delay: 0.06 }); },
    upgrade:  function () { tone(523, 0.08, { type: 'triangle', vol: 0.1 }); tone(784, 0.12, { type: 'triangle', vol: 0.1, delay: 0.07 }); },
    relic:    function () { tone(880, 0.1, { vol: 0.09 }); tone(1109, 0.12, { vol: 0.09, delay: 0.08 }); tone(1319, 0.16, { vol: 0.09, delay: 0.16 }); },
    bossIn:   function () { tone(220, 0.25, { type: 'sawtooth', vol: 0.08, slide: 110 }); tone(220, 0.25, { type: 'sawtooth', vol: 0.08, slide: 110, delay: 0.28 }); },
    clear:    function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.16, { type: 'triangle', vol: 0.1, delay: i * 0.09 }); }); },
    fail:     function () { tone(330, 0.18, { type: 'sawtooth', vol: 0.07, slide: 208 }); tone(208, 0.28, { type: 'sawtooth', vol: 0.07, slide: 147, delay: 0.16 }); },
    unlock:   function () { [784, 988, 1175].forEach(function (f, i) { tone(f, 0.14, { vol: 0.09, delay: i * 0.07 }); }); },
    dungeon:  function () { [392, 523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.13, { type: 'triangle', vol: 0.09, delay: i * 0.07 }); }); },
    tap:      function () { tone(880, 0.04, { type: 'square', vol: 0.03 }); },
  };

  window.MallangIdleAudio = {
    play: function (name) {
      if (!SFX[name]) return;
      try { SFX[name](); } catch (e) { broken = true; }
    },
    isMuted: function () { return muted; },
    setMuted: function (m) {
      muted = !!m;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
    },
    /* 모바일은 첫 사용자 제스처 뒤에만 소리를 낼 수 있다 — 아무 입력에서 한 번 깨운다 */
    warm: function () { ac(); },
  };
})();
