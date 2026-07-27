/* 말랑 보드게임 타이머
 *
 * 기본 타이머 앱. 원형 다이얼을 탭하면 시작/일시정지/재개.
 * 기본 1분, 프리셋·±10초로 시간 변경. 마지막 5초는 "띠" 카운트다운,
 * 타임아웃 시 "삐-" 알람. 효과음은 Web Audio 로 합성(에셋·CDN 없음).
 */
(function () {
  'use strict';

  const DEFAULT_SEC = 60;
  const MIN_SEC = 10;
  const MAX_SEC = 99 * 60; // 99:00
  const RING_LEN = 691.15; // 2π·110

  // 상태: 'idle' | 'running' | 'paused' | 'done'
  let state = 'idle';
  let totalSec = DEFAULT_SEC; // 설정된 총 시간(초)
  let remainingMs = DEFAULT_SEC * 1000; // 남은 시간(ms)
  let endAt = 0; // running 중 종료 목표 시각(performance.now 기준)
  let rafId = 0;
  let lastBeepSec = -1; // 카운트다운 중복 방지
  let wakeLock = null;

  const dial = document.getElementById('dial');
  const timeText = document.getElementById('timeText');
  const hintText = document.getElementById('hintText');
  const ring = document.getElementById('ringProgress');
  const presetRow = document.getElementById('presetRow');
  const adjustRow = document.getElementById('adjustRow');
  const btnPause = document.getElementById('btnPause');
  const btnExit = document.getElementById('btnExit');

  // ── 사운드 (Web Audio 합성) ──────────────────────────────
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  // 짧은 삐 소리 하나. freq(Hz), dur(초), vol(0~1)
  function tone(freq, dur, vol) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    // 딸깍임 방지용 짧은 페이드 인/아웃
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.setValueAtTime(vol, t0 + Math.max(0.02, dur - 0.03));
    gain.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  const beepTick = () => tone(880, 0.12, 0.25); // 마지막 5초 "띠"
  const beepEnd = () => tone(1046.5, 0.9, 0.32); // 타임아웃 "삐-"

  // ── 표시 ────────────────────────────────────────────────
  function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  function render() {
    timeText.textContent = fmt(remainingMs);
    // 링: 남은 비율
    const ratio = totalSec > 0 ? Math.max(0, Math.min(1, remainingMs / (totalSec * 1000))) : 0;
    ring.style.strokeDashoffset = String(RING_LEN * (1 - ratio));

    const secsLeft = Math.ceil(remainingMs / 1000);
    const warning = state === 'running' && secsLeft <= 5 && secsLeft > 0;
    dial.classList.toggle('is-running', state === 'running' && !warning);
    dial.classList.toggle('is-warning', warning);
    dial.classList.toggle('is-paused', state === 'paused');
    dial.classList.toggle('is-done', state === 'done');

    if (state === 'idle') hintText.textContent = '탭하면 시작';
    else if (state === 'paused') hintText.textContent = '일시정지됨 · 탭하면 새로';
    else hintText.textContent = '탭하면 다시 시작'; // running · done

    // 일시정지 버튼: running/paused 일 때만 활성
    const canPause = state === 'running' || state === 'paused';
    btnPause.disabled = !canPause;
    btnPause.classList.toggle('is-paused', state === 'paused');
    btnPause.textContent = state === 'paused' ? '▶ 계속' : '⏸ 일시정지';

    // 시간 조정: 카운트다운이 도는 중(running)에는 잠금
    const locked = state === 'running';
    presetRow.querySelectorAll('.chip').forEach((c) => (c.disabled = locked));
    adjustRow.querySelectorAll('.round-btn').forEach((b) => (b.disabled = locked));
  }

  // ── 타이머 루프 ─────────────────────────────────────────
  function tick() {
    if (state !== 'running') return;
    remainingMs = endAt - performance.now();

    // 마지막 5초 카운트다운 비프
    const secsLeft = Math.ceil(remainingMs / 1000);
    if (secsLeft <= 5 && secsLeft >= 1 && secsLeft !== lastBeepSec) {
      lastBeepSec = secsLeft;
      beepTick();
    }

    if (remainingMs <= 0) {
      remainingMs = 0;
      finish();
      return;
    }
    render();
    rafId = requestAnimationFrame(tick);
  }

  // 다이얼 탭 = 항상 전체 시간부터 새로 시작(턴마다 한 번씩 탭).
  function restart() {
    cancelAnimationFrame(rafId);
    remainingMs = totalSec * 1000;
    state = 'running';
    lastBeepSec = -1;
    endAt = performance.now() + remainingMs;
    requestWakeLock();
    render();
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    if (state !== 'running') return;
    cancelAnimationFrame(rafId);
    remainingMs = Math.max(0, endAt - performance.now());
    state = 'paused';
    releaseWakeLock();
    render();
  }

  function resume() {
    endAt = performance.now() + remainingMs;
    state = 'running';
    requestWakeLock();
    render();
    rafId = requestAnimationFrame(tick);
  }

  function finish() {
    cancelAnimationFrame(rafId);
    state = 'done';
    remainingMs = 0;
    releaseWakeLock();
    beepEnd();
    if (navigator.vibrate) navigator.vibrate([120, 60, 120, 60, 240]);
    render();
  }

  function reset() {
    cancelAnimationFrame(rafId);
    state = 'idle';
    remainingMs = totalSec * 1000;
    lastBeepSec = -1;
    releaseWakeLock();
    render();
  }

  function setTotal(sec) {
    totalSec = Math.max(MIN_SEC, Math.min(MAX_SEC, sec));
    cancelAnimationFrame(rafId);
    state = 'idle';
    remainingMs = totalSec * 1000;
    releaseWakeLock();
    render();
  }

  // ── 화면 꺼짐 방지(가능한 경우만) ───────────────────────
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* 미지원/거부 — 무시 */ }
  }
  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state === 'running' && !wakeLock) requestWakeLock();
  });

  // ── 이벤트 ──────────────────────────────────────────────
  dial.addEventListener('click', () => {
    ensureAudio(); // 사용자 제스처에서 오디오 잠금 해제
    restart(); // idle·running·paused·done 어디서든 전체 시간부터 새로 시작
  });

  btnPause.addEventListener('click', () => {
    ensureAudio();
    if (state === 'running') pause();
    else if (state === 'paused') resume();
  });

  presetRow.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || chip.disabled) return;
    const sec = parseInt(chip.dataset.sec, 10);
    if (!Number.isFinite(sec)) return;
    presetRow.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    setTotal(sec);
  });

  adjustRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.round-btn');
    if (!btn || btn.disabled) return;
    const delta = parseInt(btn.dataset.delta, 10);
    if (!Number.isFinite(delta)) return;
    // 조정 시 프리셋 활성 표시는 일치하는 값만 유지
    setTotal(totalSec + delta);
    presetRow.querySelectorAll('.chip').forEach((c) =>
      c.classList.toggle('is-active', parseInt(c.dataset.sec, 10) === totalSec)
    );
  });

  // 스페이스바/엔터로도 시작·정지 (다이얼 포커스 시 브라우저 기본 동작)
  // 광장으로 돌아가기 — 실험실/광장에서 왔으면 월드로, 아니면 랜딩으로
  btnExit.addEventListener('click', () => {
    releaseWakeLock();
    const boot = window.GameBoot;
    const from = boot && boot.from;
    if (from === 'lab' || from === 'world') {
      const params = new URLSearchParams(window.location.search);
      const worldId = params.get('worldId');
      const out = new URLSearchParams();
      if (worldId) out.set('worldId', worldId);
      out.set('from', 'game');
      window.location.href = '/world/?' + out.toString();
    } else if (boot && typeof boot.exit === 'function') {
      boot.exit();
    } else {
      window.location.href = '/';
    }
  });

  // 초기 렌더
  reset();
})();
