/* MARSfx — WebAudio 프로시저럴 SFX (M1 기본 4종: 게이트/진화/보스경고/클리어)
 * 에셋 파일 없이 오실레이터 신스로 합성 — 장난감 톤(짧고 동글동글한 소리).
 * AudioContext는 첫 사용자 제스처에서 init() 해야 한다(브라우저 자동재생 정책).
 * 모든 play는 init 전·실패 시 조용히 무시(게임 로직에 영향 없음). */
(function (global) {
  var ctx = null;
  var master = null;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }

  /* 단일 톤: freq에서 freqTo로 글라이드, dur초, type 파형. at은 ctx 기준 시작 시각. */
  function tone(at, freq, freqTo, dur, type, vol) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, at);
    if (freqTo && freqTo !== freq) o.frequency.exponentialRampToValueAtTime(freqTo, at + dur);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol || 0.25, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g); g.connect(master);
    o.start(at); o.stop(at + dur + 0.02);
  }

  var sounds = {
    /* 게이트 통과: 통통 튀는 업-치프 (긍정 피드백) */
    gate: function (t) {
      tone(t, 520, 780, 0.09, 'triangle', 0.22);
      tone(t + 0.07, 660, 990, 0.10, 'triangle', 0.20);
    },
    /* 진화: 반짝이 아르페지오 (도-미-솔-도) */
    evolve: function (t) {
      var notes = [523, 659, 784, 1047];
      for (var i = 0; i < notes.length; i++)
        tone(t + i * 0.07, notes[i], notes[i], 0.16, 'triangle', 0.20);
      tone(t + 0.30, 1568, 2093, 0.22, 'sine', 0.10); // 마무리 스파클
    },
    /* 보스 경고: 낮은 두-톤 경적 (무섭지 않게 부드러운 사각파) */
    bossWarn: function (t) {
      tone(t, 220, 220, 0.12, 'square', 0.10);
      tone(t + 0.14, 175, 175, 0.14, 'square', 0.10);
    },
    /* 클리어: 짧은 팡파레 (솔-도-미-솔↑ + 화음) */
    clear: function (t) {
      var seq = [392, 523, 659, 784];
      for (var i = 0; i < seq.length; i++)
        tone(t + i * 0.11, seq[i], seq[i], 0.18, 'triangle', 0.22);
      tone(t + 0.46, 523, 523, 0.5, 'sine', 0.12);
      tone(t + 0.46, 659, 659, 0.5, 'sine', 0.12);
      tone(t + 0.46, 784, 784, 0.5, 'sine', 0.12);
    }
  };

  function play(name) {
    if (!ctx || !sounds[name]) return;
    // 모바일 백그라운드 복귀 등으로 suspended 면 재개 시도(이번 소리는 건너뜀)
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} return; }
    if (ctx.state !== 'running') return;
    try { sounds[name](ctx.currentTime); } catch (e) { /* 무시 */ }
  }

  global.MARSfx = { init: init, play: play };
})(window);
