/* Mallang Stairs procedural audio manager (plain window global, no assets). */
(function (window) {
  'use strict';

  var STORAGE_KEY = 'mallang_stairs_audio_muted';
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  var master = null;
  var sfxBus = null;
  var loopBus = null;
  var muted = readMuted();
  var tapIndex = 0;
  var unlockBound = false;
  var feverLoop = null;

  var SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

  function readMuted() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function persistMuted() {
    try {
      window.localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch (err) {
      /* ignore storage errors */
    }
  }

  function ensureContext() {
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);

      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(master);

      loopBus = ctx.createGain();
      loopBus.gain.value = 0.4;
      loopBus.connect(master);
    }
    return ctx;
  }

  function bindUnlock() {
    if (unlockBound) return;
    unlockBound = true;
    ['pointerdown', 'touchstart', 'keydown', 'mousedown'].forEach(function (type) {
      window.addEventListener(type, unlockAudio, { passive: true, capture: true });
    });
  }

  function tone(opts) {
    var c = ensureContext();
    if (!c || !sfxBus) return null;
    var startAt = c.currentTime + (opts.startAt || 0);
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = opts.type || 'sine';
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(opts.volume || 0.2, startAt + (opts.attack || 0.01));
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      startAt + (opts.attack || 0.01) + (opts.decay || 0.12)
    );
    osc.frequency.setValueAtTime(opts.freq || 440, startAt);
    if (opts.freqTo && Math.abs(opts.freqTo - (opts.freq || 440)) > 0.001) {
      osc.frequency.exponentialRampToValueAtTime(opts.freqTo, startAt + (opts.slide || opts.decay || 0.12));
    }
    if (typeof opts.detune === 'number') {
      osc.detune.setValueAtTime(opts.detune, startAt);
    }
    osc.connect(gain);
    gain.connect(opts.bus || sfxBus);
    osc.start(startAt);
    osc.stop(startAt + (opts.attack || 0.01) + (opts.decay || 0.12) + 0.04);
    osc.onended = function () {
      try { osc.disconnect(); } catch (err) {}
      try { gain.disconnect(); } catch (err2) {}
    };
    return osc;
  }

  function noise(opts) {
    var c = ensureContext();
    if (!c || !sfxBus) return;
    var duration = Math.max(0.02, opts.duration || 0.1);
    var buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * duration)), c.sampleRate);
    var channel = buffer.getChannelData(0);
    for (var i = 0; i < channel.length; i += 1) {
      channel[i] = (Math.random() * 2 - 1) * (1 - i / channel.length);
    }
    var src = c.createBufferSource();
    var filter = c.createBiquadFilter();
    var gain = c.createGain();
    var startAt = c.currentTime + (opts.startAt || 0);
    src.buffer = buffer;
    filter.type = opts.filterType || 'bandpass';
    filter.frequency.value = opts.freq || 1200;
    gain.gain.setValueAtTime(opts.volume || 0.18, startAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(opts.bus || sfxBus);
    src.start(startAt);
    src.stop(startAt + duration + 0.02);
    src.onended = function () {
      try { src.disconnect(); } catch (err) {}
      try { filter.disconnect(); } catch (err2) {}
      try { gain.disconnect(); } catch (err3) {}
    };
  }

  function unlockAudio() {
    var c = ensureContext();
    if (!c) return Promise.resolve(false);
    if (c.state === 'suspended') {
      return c.resume().then(function () { return true; }).catch(function () { return false; });
    }
    return Promise.resolve(c.state === 'running');
  }

  function setMuted(nextMuted) {
    muted = !!nextMuted;
    if (master) {
      master.gain.cancelScheduledValues(0);
      master.gain.setValueAtTime(muted ? 0 : 1, ctx ? ctx.currentTime : 0);
    }
    persistMuted();
    return muted;
  }

  function toggleMuted() {
    return setMuted(!muted);
  }

  function isReady() {
    return !!ctx && ctx.state === 'running';
  }

  function playIfReady(fn) {
    if (!isReady() || muted) return false;
    fn();
    return true;
  }

  function stopFeverLoop() {
    if (!feverLoop) return;
    feverLoop.active = false;
    if (feverLoop.timer) {
      window.clearTimeout(feverLoop.timer);
      feverLoop.timer = 0;
    }
    if (feverLoop.padGain && ctx) {
      feverLoop.padGain.gain.cancelScheduledValues(ctx.currentTime);
      feverLoop.padGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    }
    if (feverLoop.lfo) {
      try { feverLoop.lfo.stop(ctx.currentTime + 0.12); } catch (err) {}
    }
    if (feverLoop.root) {
      try { feverLoop.root.stop(ctx.currentTime + 0.12); } catch (err2) {}
    }
    feverLoop = null;
  }

  function startFeverLoop() {
    var c = ensureContext();
    if (!c || muted || c.state !== 'running') return false;
    if (feverLoop && feverLoop.active) return true;

    var root = c.createOscillator();
    var lfo = c.createOscillator();
    var lfoGain = c.createGain();
    var padGain = c.createGain();
    var filter = c.createBiquadFilter();
    var startedAt = c.currentTime;

    root.type = 'sawtooth';
    root.frequency.setValueAtTime(196, startedAt);
    lfo.type = 'triangle';
    lfo.frequency.setValueAtTime(5.5, startedAt);
    lfoGain.gain.setValueAtTime(14, startedAt);
    padGain.gain.setValueAtTime(0.0001, startedAt);
    padGain.gain.linearRampToValueAtTime(0.045, startedAt + 0.15);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(920, startedAt);

    lfo.connect(lfoGain);
    lfoGain.connect(root.frequency);
    root.connect(filter);
    filter.connect(padGain);
    padGain.connect(loopBus);
    root.start(startedAt);
    lfo.start(startedAt);

    feverLoop = {
      active: true,
      root: root,
      lfo: lfo,
      padGain: padGain,
      timer: 0
    };

    (function pulseBeat() {
      if (!feverLoop || !feverLoop.active) return;
      var now = ctx.currentTime;
      tone({ freq: 784, freqTo: 700, type: 'square', volume: 0.08, attack: 0.003, decay: 0.06, bus: loopBus });
      noise({ freq: 1600, duration: 0.025, volume: 0.03, bus: loopBus });
      feverLoop.timer = window.setTimeout(pulseBeat, Math.max(120, 600 - ((now * 1000) % 40)));
    })();

    return true;
  }

  function tap() {
    return playIfReady(function () {
      var freq = SCALE[tapIndex % SCALE.length];
      tapIndex += 1;
      tone({ freq: freq, freqTo: freq * 1.02, type: 'triangle', volume: 0.15, attack: 0.004, decay: 0.07 });
      noise({ freq: 2400, duration: 0.018, volume: 0.018 });
    });
  }

  function perfect() {
    return playIfReady(function () {
      tone({ freq: 1046.5, type: 'triangle', volume: 0.22, attack: 0.005, decay: 0.12 });
      tone({ freq: 1318.51, type: 'sine', volume: 0.18, attack: 0.008, decay: 0.18, startAt: 0.045 });
      tone({ freq: 1567.98, type: 'sine', volume: 0.12, attack: 0.008, decay: 0.22, startAt: 0.09 });
    });
  }

  function booster(kind) {
    return playIfReady(function () {
      var variant = String(kind || '').toLowerCase();
      var root = 659.25;
      if (variant === 'stable') root = 523.25;
      else if (variant === 'combo') root = 783.99;
      else if (variant === 'fever') root = 880;

      tone({ freq: root, freqTo: root * 1.6, type: 'square', volume: 0.18, attack: 0.004, decay: 0.09 });
      tone({ freq: root * 1.5, type: 'triangle', volume: 0.14, attack: 0.004, decay: 0.12, startAt: 0.04 });
      noise({ freq: 2000, duration: 0.04, volume: 0.04, startAt: 0.01 });
    });
  }

  function fever(mode) {
    var value = typeof mode === 'string' ? mode.toLowerCase() : mode;
    if (value === false || value === 'stop' || value === 'end' || value === 'off') {
      stopFeverLoop();
      return true;
    }
    var started = playIfReady(function () {
      tone({ freq: 523.25, type: 'square', volume: 0.14, attack: 0.004, decay: 0.07 });
      tone({ freq: 783.99, type: 'square', volume: 0.13, attack: 0.004, decay: 0.09, startAt: 0.05 });
      tone({ freq: 1174.66, type: 'triangle', volume: 0.1, attack: 0.004, decay: 0.12, startAt: 0.10 });
      noise({ freq: 2600, duration: 0.05, volume: 0.03, startAt: 0.03 });
    });
    if (value === true || value === 'start' || value === 'loop' || value === 'on') {
      startFeverLoop();
    }
    return started;
  }

  function death() {
    stopFeverLoop();
    tapIndex = 0;
    return playIfReady(function () {
      tone({ freq: 392, freqTo: 110, slide: 0.42, type: 'sawtooth', volume: 0.18, attack: 0.005, decay: 0.42 });
      tone({ freq: 196, freqTo: 82, slide: 0.48, type: 'triangle', volume: 0.13, attack: 0.01, decay: 0.48, startAt: 0.03 });
      noise({ freq: 440, duration: 0.16, volume: 0.08, filterType: 'lowpass', startAt: 0.06 });
    });
  }

  function countdown(value) {
    var isGo = value === 0 || value === '0' || String(value || '').toLowerCase() === 'go';
    return playIfReady(function () {
      if (isGo) {
        tone({ freq: 659.25, type: 'square', volume: 0.18, attack: 0.003, decay: 0.10 });
        tone({ freq: 987.77, type: 'square', volume: 0.15, attack: 0.003, decay: 0.14, startAt: 0.07 });
        tone({ freq: 1318.51, type: 'triangle', volume: 0.12, attack: 0.004, decay: 0.18, startAt: 0.14 });
      } else {
        tone({ freq: 880, type: 'square', volume: 0.12, attack: 0.002, decay: 0.06 });
      }
    });
  }

  function overtake() {
    return playIfReady(function () {
      tone({ freq: 587.33, type: 'triangle', volume: 0.14, attack: 0.004, decay: 0.08 });
      tone({ freq: 783.99, type: 'triangle', volume: 0.14, attack: 0.004, decay: 0.10, startAt: 0.06 });
      tone({ freq: 1046.5, type: 'triangle', volume: 0.13, attack: 0.004, decay: 0.12, startAt: 0.12 });
      noise({ freq: 3000, duration: 0.03, volume: 0.02, startAt: 0.08 });
    });
  }

  function checkpoint() {
    return playIfReady(function () {
      tone({ freq: 523.25, type: 'sine', volume: 0.11, attack: 0.006, decay: 0.12 });
      tone({ freq: 659.25, type: 'sine', volume: 0.11, attack: 0.006, decay: 0.14, startAt: 0.07 });
      tone({ freq: 783.99, type: 'sine', volume: 0.11, attack: 0.006, decay: 0.18, startAt: 0.14 });
    });
  }

  function play(name, arg) {
    switch (name) {
      case 'tap': return tap();
      case 'perfect': return perfect();
      case 'booster': return booster(arg);
      case 'fever': return fever(arg);
      case 'death': return death();
      case 'countdown': return countdown(arg);
      case 'overtake': return overtake();
      case 'checkpoint': return checkpoint();
      default: return false;
    }
  }

  bindUnlock();

  window.MallangStairsAudio = {
    unlockAudio: unlockAudio,
    setMuted: setMuted,
    toggleMuted: toggleMuted,
    isMuted: function () { return muted; },
    isReady: isReady,
    tap: tap,
    perfect: perfect,
    booster: booster,
    fever: fever,
    startFever: function () { return fever('start'); },
    stopFever: stopFeverLoop,
    death: death,
    countdown: countdown,
    overtake: overtake,
    checkpoint: checkpoint,
    play: play
  };
})(window);
