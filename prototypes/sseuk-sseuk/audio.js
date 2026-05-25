/* 말랑프렌즈 슥슥 — Web Audio 사운드 매니저.
 *
 * 외부 음원 파일 없이 OscillatorNode 합성만 사용한다. 페이로드 0, 어떤
 * 디바이스에서도 즉시 재생. 모바일은 사용자 첫 인터랙션 전까지 AudioContext
 * 가 suspended 상태라, Ready 버튼 클릭 같은 첫 제스처에서 unlockAudio() 를
 * 호출해 resume 시켜야 한다.
 *
 * 노출 API (window.SseukAudio):
 *   - unlockAudio()       : 첫 사용자 인터랙션에서 호출, AudioContext resume.
 *   - setMuted(boolean)   : 마스터 mute. localStorage 에 저장.
 *   - isMuted()           : 현재 mute 상태.
 *   - startBgm()          : 배경음악 시작 (이미 재생 중이면 무시).
 *   - stopBgm()           : 배경음악 중지 + 예약된 노드 취소.
 *   - SFX.{correct, countdownTick, countdownGo, roundEnd, hint, click, gameEnd}() :
 *                            게임 이벤트별 짧은 효과음.
 *
 * BGM 설계: C–Am–F–G 4코드 루프, 각 코드 4초, 한 사이클 16초. 사인파 3음
 * + 부드러운 어택/릴리즈로 게임 플레이를 방해하지 않는 backdrop pad.
 *
 * SFX 설계: 짧은 burst (0.05~0.3s). attack/decay 곡선과 freq 만 조절. 너무
 * 자주 울리는 hint/stroke 류는 볼륨을 낮춰 들리지 않을 정도까지.
 */

(function () {
  const STORAGE_KEY = 'sseuk_audio_muted';

  let ctx = null;
  let masterGain = null;
  let bgmGain = null;
  let sfxGain = null;
  let bgmScheduledNodes = [];
  let bgmLoopTimer = null;
  let muted = false;

  try {
    muted = localStorage.getItem(STORAGE_KEY) === '1';
  } catch { /* ignore — localStorage disabled */ }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : 1.0;
    masterGain.connect(ctx.destination);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = 0.10;          // BGM 낮은 톤, 음성 가리지 않게.
    bgmGain.connect(masterGain);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.50;
    sfxGain.connect(masterGain);
    return ctx;
  }

  function unlockAudio() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') {
      c.resume().catch(() => { /* 모바일은 사용자 제스처가 필요 — 다음에 재시도 */ });
    }
  }

  function setMuted(m) {
    muted = !!m;
    if (masterGain) masterGain.gain.value = muted ? 0 : 1.0;
    try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch {}
  }
  function isMuted() { return muted; }

  function tone({ freq = 440, type = 'sine', volume = 0.3, attack = 0.005, decay = 0.15, startAt = 0 }) {
    // ctx.state !== 'running' 가드를 두지 않는다 — unlockAudio.resume() 가
    // async 라서 첫 click SFX 가 무음으로 떨어지는 문제가 있었다 (코덱스 #3).
    // suspended 상태에서도 스케줄은 가능하고, resume 이 완료되면 큐된 노드가
    // 재생된다.
    if (!ctx) return;
    const t = ctx.currentTime + startAt;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(t);
    osc.stop(t + attack + decay + 0.02);
  }

  /* 글리스(주파수 미끄러짐) — 정답·게임종료 같은 화려한 컷에 사용. */
  function gliss({ from, to, duration = 0.2, type = 'triangle', volume = 0.3, startAt = 0 }) {
    if (!ctx) return;
    const t = ctx.currentTime + startAt;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  const SFX = {
    /* 정답 ! — 짧은 상승 2음 ding-ding. */
    correct() {
      tone({ freq: 880,  volume: 0.45, decay: 0.18 });
      tone({ freq: 1320, volume: 0.40, decay: 0.22, startAt: 0.09 });
    },
    /* 카운트다운 3-2-1 한 박. */
    countdownTick() {
      tone({ freq: 880, type: 'square', volume: 0.30, decay: 0.08 });
    },
    /* 라운드 시작 신호. */
    countdownGo() {
      tone({ freq: 660, type: 'triangle', volume: 0.40, decay: 0.18 });
      tone({ freq: 990, type: 'triangle', volume: 0.35, decay: 0.22, startAt: 0.10 });
    },
    /* 라운드 종료 — 부드러운 하강 2음. */
    roundEnd() {
      tone({ freq: 523, volume: 0.35, decay: 0.20 });
      tone({ freq: 392, volume: 0.30, decay: 0.25, startAt: 0.12 });
    },
    /* 힌트 공개 — 살짝 ping. 자주 울리지 않으니 적당 볼륨. */
    hint() {
      tone({ freq: 1568, volume: 0.25, decay: 0.06 });
    },
    /* 버튼 클릭. */
    click() {
      tone({ freq: 600, type: 'square', volume: 0.15, decay: 0.04 });
    },
    /* 게임 종료 — 화려한 finale gliss + 화음. */
    gameEnd() {
      gliss({ from: 440, to: 1100, duration: 0.45, volume: 0.4 });
      tone({ freq: 523, volume: 0.30, decay: 0.5, startAt: 0.45 });
      tone({ freq: 659, volume: 0.28, decay: 0.5, startAt: 0.5 });
      tone({ freq: 784, volume: 0.26, decay: 0.6, startAt: 0.55 });
    },
  };

  /* BGM — C·Am·F·G 4코드 패드 루프. 한 사이클 16초. */
  const BGM_CHORDS = [
    [261.63, 329.63, 392.00],  // C major
    [220.00, 261.63, 329.63],  // A minor
    [174.61, 220.00, 261.63],  // F major
    [196.00, 246.94, 293.66],  // G major
  ];
  const BGM_CHORD_S = 4.0;

  // 다음 사이클이 시작되어야 할 ctx 시각. self-scheduling chain 의 기준.
  let nextCycleAt = 0;
  // 현재 사이클(즉 곧 끝날 예약)의 OscillatorNode 만 stop 용으로 보관.
  // 새 사이클을 스케줄할 때 이전 배열은 GC 되도록 통째로 교체 — 코덱스 #1
  // (필터 가비지 누적) 해결.
  function scheduleBgmCycle(startTime) {
    const fresh = [];
    let when = startTime;
    for (const chord of BGM_CHORDS) {
      for (const freq of chord) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(0.05, when + 0.4);
        g.gain.setValueAtTime(0.05, when + BGM_CHORD_S - 0.6);
        g.gain.linearRampToValueAtTime(0, when + BGM_CHORD_S);
        osc.connect(g);
        g.connect(bgmGain);
        osc.start(when);
        osc.stop(when + BGM_CHORD_S + 0.05);
        // 끝나면 disconnect — 메모리 회수 신호.
        osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch {} };
        fresh.push(osc);
      }
      when += BGM_CHORD_S;
    }
    bgmScheduledNodes = fresh;
    nextCycleAt = when;
  }

  function startBgm() {
    const c = ensureCtx();
    if (!c) return;
    if (bgmLoopTimer) return;       // 이미 재생 중
    if (c.state !== 'running') return; // unlockAudio 가 아직 안 됨
    scheduleBgmCycle(c.currentTime + 0.1);
    // self-scheduling chain — 다음 사이클 시작 ~200ms 전에 깨워서 ctx 시각 기준
    // 으로 정확히 nextCycleAt 에 이어붙임 (코덱스 #2: setInterval 드리프트 해결).
    const tickNext = () => {
      if (!ctx) return;
      scheduleBgmCycle(nextCycleAt);
      const leadMs = Math.max(50, (nextCycleAt - ctx.currentTime - 0.2) * 1000);
      bgmLoopTimer = setTimeout(tickNext, leadMs);
    };
    const firstLeadMs = Math.max(50, (nextCycleAt - c.currentTime - 0.2) * 1000);
    bgmLoopTimer = setTimeout(tickNext, firstLeadMs);
  }

  function stopBgm() {
    if (bgmLoopTimer) { clearTimeout(bgmLoopTimer); bgmLoopTimer = null; }
    for (const n of bgmScheduledNodes) {
      try { n.stop(); } catch {}
    }
    bgmScheduledNodes = [];
    nextCycleAt = 0;
  }

  window.SseukAudio = {
    unlockAudio,
    setMuted,
    isMuted,
    startBgm,
    stopBgm,
    SFX,
  };
})();
