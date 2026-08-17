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

  /* 노이즈 버퍼는 한 번 만들어 재사용한다 — 타격음이 초당 여러 번 울리는 게임에서
   * 매번 버퍼를 새로 만들면 GC 압력이 쌓인다(codex 리뷰). 감쇠는 gain 램프로 건다. */
  var noiseBuf = null;
  function getNoise(c) {
    if (noiseBuf) return noiseBuf;
    var frames = Math.floor(c.sampleRate * 0.12);
    noiseBuf = c.createBuffer(1, frames, c.sampleRate);
    var data = noiseBuf.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function thud(dur, vol, filterFreq, when, dest) {
    if (muted) return;
    var c = ac();
    if (!c) return;
    var t0 = when || c.currentTime;
    var src = c.createBufferSource();
    src.buffer = getNoise(c);
    var filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 900;
    var gain = c.createGain();
    gain.gain.setValueAtTime(vol || 0.1, t0);
    gain.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    src.connect(filter).connect(gain).connect(dest || c.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  var lastHit = 0, lastKill = 0;
  var SFX = {
    /* 타격 — 초당 수 회 울리므로 스로틀해서 따닥거림을 막는다 */
    hit: function () {
      var now = Date.now();
      if (now - lastHit < 90) return;
      lastHit = now;
      thud(0.06, 0.07, 1200);
    },
    kill:     function () {
      var now = Date.now();
      if (now - lastKill < 120) return;
      lastKill = now;
      tone(660, 0.09, { type: 'square', vol: 0.05, slide: 990 });
    },
    /* 스킬 발동 스팅 (단계 5) — 기본타(hit)·처치(kill)와 구분되는 밝은 상승음.
     * stage.js 가 매 9타 스킬 세트피스 접점에 물린다(안무와 동기). */
    skill:    function () { tone(523, 0.1, { type: 'triangle', vol: 0.09, slide: 784 }); tone(1047, 0.13, { type: 'triangle', vol: 0.07, delay: 0.05 }); },
    /* 분노 페이즈 진입 (단계 5) — 낮게 깔리는 긴장 스팅. 제한시간 임박 순간에 한 번. */
    rage:     function () { tone(147, 0.34, { type: 'sawtooth', vol: 0.09, slide: 110 }); tone(220, 0.3, { type: 'sawtooth', vol: 0.06, slide: 175, delay: 0.02 }); },
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

  /* ── 절차 생성 BGM ─────────────────────────────────────────
   * 챕터마다 무드가 다른 16스텝 루프. 오디오 클록 기준 룩어헤드 스케줄러라
   * 프레임 드랍에도 박자가 밀리지 않는다. 음량은 효과음 아래(0.045)로 깔린다.
   *
   * 표기: 패턴 숫자 = 스케일 인덱스(0=근음), null = 쉼표. o 는 옥타브 내림.
   * 각 무드는 [스케일(반음), bpm, 베이스 16스텝, 리드 16스텝, 햇 16스텝]. */
  var MOODS = {
    meadow: {  // 장조 펜타토닉 — 콩콩 뛰는 산책
      root: 262, bpm: 106, scale: [0, 2, 4, 7, 9],
      bass: [0, null, 0, null, 3, null, 3, null, 4, null, 4, null, 3, null, 1, null],
      lead: [0, 2, 4, null, 4, 3, 2, null, 1, 2, 3, null, 2, 1, 0, null],
      hat:  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    },
    gears: {   // 도리안 — 삐걱거리는 호기심
      root: 220, bpm: 96, scale: [0, 2, 3, 5, 7, 9, 10],
      bass: [0, null, null, 0, 5, null, null, 5, 3, null, null, 3, 4, null, 6, null],
      lead: [null, 0, null, 2, null, 4, null, 3, null, 5, null, 4, null, 2, 1, null],
      hat:  [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1],
    },
    machine: { // 단조 — 밀고 들어가는 전선
      root: 196, bpm: 120, scale: [0, 2, 3, 5, 7, 8, 10],
      bass: [0, 0, null, 0, null, 0, 3, null, 4, 4, null, 4, null, 3, 2, null],
      lead: [null, null, 4, null, 3, null, null, 2, null, null, 5, null, 4, null, 2, 0],
      hat:  [1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1],
    },
    garden: {  // 리디안 — 하늘 위의 바람
      root: 294, bpm: 92, scale: [0, 2, 4, 6, 7, 9, 11],
      bass: [0, null, null, null, 4, null, null, null, 3, null, null, null, 4, null, null, null],
      lead: [0, null, 2, null, 4, null, 6, null, 4, null, 2, null, 1, null, 2, null],
      hat:  [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    },
    boss: {    // 단조 오스티나토 — 25초의 긴장
      root: 175, bpm: 132, scale: [0, 2, 3, 5, 7, 8, 10],
      bass: [0, 0, 0, null, 0, 0, 3, null, 0, 0, 0, null, 4, null, 3, 2],
      lead: [7, null, null, 6, null, null, 5, null, 7, null, null, 6, null, 5, 4, null],
      hat:  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
    starsea: { // 에올리안 자장가 — 밤바다의 반짝임
      root: 247, bpm: 84, scale: [0, 2, 3, 5, 7, 8, 10],
      bass: [0, null, null, null, null, null, 3, null, 5, null, null, null, 4, null, null, null],
      lead: [7, null, 9, null, null, 7, null, 5, null, 7, null, 10, null, 9, null, 7],
      hat:  [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1],
    },
    moonfactory: { // 화성 단음계 — 절뚝이며 도는 라인
      root: 208, bpm: 108, scale: [0, 2, 3, 5, 7, 8, 11],
      bass: [0, null, 0, null, null, 0, null, 3, 2, null, 2, null, null, 4, 3, null],
      lead: [null, 4, null, null, 5, null, 4, null, null, 7, null, 5, null, null, 2, null],
      hat:  [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1],
    },
  };

  var bgm = { mood: null, timer: null, step: 0, nextAt: 0 };

  /* BGM 전용 마스터 게인 — 무드 전환 크로스페이드(정확히는 딥 전환)가 여기 걸린다.
   * 효과음은 이 버스를 타지 않으므로 전환 중에도 또렷하게 들린다. */
  var bgmGain = null;
  function bgmBus(c) {
    if (!bgmGain) {
      bgmGain = c.createGain();
      bgmGain.gain.value = 1;
      bgmGain.connect(c.destination);
    }
    return bgmGain;
  }

  function noteFreq(root, scale, idx) {
    var oct = Math.floor(idx / scale.length);
    var semi = scale[((idx % scale.length) + scale.length) % scale.length];
    return root * Math.pow(2, (semi + oct * 12) / 12);
  }

  function bgmVoice(c, freq, t0, dur, type, vol) {
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    osc.connect(gain).connect(bgmBus(c));
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function bgmTick() {
    if (muted || !bgm.mood || document.hidden) return;
    var c = ac();
    if (!c) return;
    var m = MOODS[bgm.mood];
    var stepDur = 60 / m.bpm / 4;
    /* 숨김 탭 복귀 — nextAt 이 과거로 밀려 있으면 밀린 스텝 수천 개를 한 틱에
     * 예약해 프리즈+소리 폭발이 난다(codex HIGH). 0.5초 이상 밀렸으면 재기준화. */
    if (bgm.nextAt < c.currentTime - 0.5) bgm.nextAt = c.currentTime + 0.05;
    // 룩어헤드 0.3초 — 타이머가 늦어도 오디오 클록 기준으로 정확히 찍힌다
    while (bgm.nextAt < c.currentTime + 0.3) {
      var t0 = Math.max(bgm.nextAt, c.currentTime + 0.01);
      var i = bgm.step % 16;
      var b = m.bass[i], l = m.lead[i];
      if (b != null) bgmVoice(c, noteFreq(m.root / 2, m.scale, b), t0, stepDur * 1.8, 'triangle', 0.05);
      if (l != null) bgmVoice(c, noteFreq(m.root, m.scale, l), t0, stepDur * 0.9, 'square', 0.022);
      if (m.hat[i]) thud(0.03, 0.014, 6000, t0, bgmBus(c));
      bgm.step++;
      bgm.nextAt += stepDur;
    }
  }

  function bgmSet(mood) {
    if (mood === bgm.mood) return;
    var had = bgm.mood;
    bgm.mood = mood || null;
    bgm.step = 0;
    var c = mood ? ac() : ctx;   // 끌 때도 살아 있는 컨텍스트가 있으면 페이드아웃에 쓴다
    bgm.nextAt = c ? c.currentTime + 0.05 : 0;
    /* 음소거 중에는 타이머를 만들지 않는다 — 음소거 해제(setMuted)가 되살린다 */
    if (bgm.mood && !bgm.timer && !muted) bgm.timer = setInterval(bgmTick, 120);
    if (!bgm.mood && bgm.timer) { clearInterval(bgm.timer); bgm.timer = null; }
    /* 무드 전환 크로스페이드(6차 백로그) — 이전 트랙의 꼬리를 0.12s 로 접고
     * 새 무드의 첫 마디를 0.3s 에 걸쳐 올린다. 예약된 옛 노트는 버스에서 잦아든다. */
    if (c && had && bgmGain) {
      var g = bgmGain.gain;
      var t = c.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(0.0001, t + 0.12);
      if (bgm.mood) {
        g.linearRampToValueAtTime(1, t + 0.42);
        bgm.nextAt = t + 0.14;   // 새 무드는 딥의 바닥을 지난 뒤 시작
      } else {
        g.linearRampToValueAtTime(1, t + 0.6);   // 다음 재생을 위해 복원해 둔다
      }
    }
  }

  window.MallangIdleAudio = {
    play: function (name) {
      if (!SFX[name]) return;
      try { SFX[name](); } catch (e) { broken = true; }
    },
    isMuted: function () { return muted; },
    setMuted: function (m) {
      muted = !!m;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
      /* 음소거 중에는 120ms 타이머도 세우지 않는다(6차 백로그) — 무드는 기억해 둔다 */
      if (muted && bgm.timer) { clearInterval(bgm.timer); bgm.timer = null; }
      if (!muted && bgm.mood) {
        if (!bgm.timer) bgm.timer = setInterval(bgmTick, 120);
        // 음소거 해제 — 밀린 스텝을 몰아서 찍지 않도록 클록을 리셋
        var c = ac();
        if (c) bgm.nextAt = c.currentTime + 0.05;
      }
    },
    /* BGM 무드 전환 — null 이면 정지. 같은 무드면 무시(루프 연속성 유지). */
    bgm: function (mood) { try { bgmSet(mood); } catch (e) { broken = true; } },
    bgmMood: function () { return bgm.mood; },
    /* 모바일은 첫 사용자 제스처 뒤에만 소리를 낼 수 있다 — 아무 입력에서 한 번 깨운다 */
    warm: function () { ac(); },
  };
})();
