/*
 * 말랑프렌즈 키우기 — 연출 이벤트 버퍼 (전투 화면 개편 단계 0)
 *
 * 왜 존재하는가 (../COMBAT_STAGE_OVERHAUL.md 5절):
 *   엔진(combat.js)은 사건을 "순간"에 확정한다. 몹이 0.2초 만에 죽고 0.6초 뒤 다음
 *   몹이 선다. 배속·복귀에서는 한 틱에 수십 개가 몰린다. 화면이 그걸 그대로 그리면
 *   볼 만한 리듬이 없다 — 이 게임이 밋밋했던 뿌리다.
 *
 *   그래서 표현 계층에 **자기 시계**를 준다. 이 버퍼는 엔진 사건을 받아 "각 사건이
 *   화면에서 차지할 최소 시간"만큼 늦춰 재생한다. 밀리면 재생 속도를 올려 따라잡고,
 *   폭주하면 즉시 몰아본다.
 *
 * 불변조건 — 이 두 개가 이 파일의 존재 이유다:
 *   1. **사건은 절대 유실되지 않는다.** pushed === dispatched 가 항상 성립한다.
 *      몰아보기(collapse)에서도 사건은 전부 전달된다 — "조용히" 전달될 뿐이다.
 *   2. **밸런스에 영향이 없다.** 골드·스테이지·저장은 엔진이 이미 확정한 값이 진실이다.
 *      이 버퍼는 "그 사건을 언제 어떻게 보여줄지"만 늦춘다.
 *
 * DOM 을 모른다 — 그래서 Node 에서 그대로 테스트된다(tests/queue.test.js).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleQueue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULTS = {
    /* 이만큼(초) 밀리기 전까지는 정속 재생 — 정상 플레이는 사실상 항상 여기 있다. */
    soft: 1.2,
    /* 가속 상한. 이보다 빠르게는 재생하지 않는다(눈이 못 따라간다). */
    maxRate: 10,
    /* 이 이상 밀리면 가속으로는 못 따라잡는다고 보고 즉시 몰아본다(초). */
    hardBacklog: 8,
    /* 대기 사건이 이만큼 쌓여도 즉시 몰아본다(개). */
    collapseAt: 48,
    /* 메모리 상한 — dev advance(3600) 같은 대량 투입에서 큐가 무한히 자라지 않게. */
    maxQueue: 4096,
  };

  function num(v) { return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0; }

  function create(opts) {
    opts = opts || {};
    var cfg = {};
    for (var k in DEFAULTS) cfg[k] = (opts[k] != null ? opts[k] : DEFAULTS[k]);

    /* 이 사건이 화면에서 차지할 최소 시간(초). 0 이면 "즉시 지나가는 사건"이다. */
    var durationOf = opts.duration || function () { return 0; };
    /* 실제 화면 반영. info.collapsed 면 "몰아보는 중" — 파티클 같은 사치는 건너뛰라는 신호. */
    var onEvent = opts.onEvent || function () {};
    /* 재생이 전부 끝나 idle 로 **전이되는 순간** 정확히 한 번 호출된다. 몰아보기로
     * 끝나도 온다 — collapsed 처치에서 합산만 하고 표시를 미룬 정보(골드 등)를
     * 여기서 플러시한다. 안 그러면 벽·보스에 머무는 동안 누적분이 영영 안 보인다. */
    var onIdle = opts.onIdle || null;

    var queue = [];          // 대기 중 { ev, d }
    var cur = null;          // 재생 중인 사건 (이미 onEvent 로 전달됨)
    var curLeft = 0;         // 재생 중 사건의 잔여 시간
    var pendingSec = 0;      // 대기 중 사건들의 시간 합 (매 프레임 재계산하지 않으려고 유지)
    var busy = false;        // busy → idle 전이 감지용 (onIdle 을 정확히 한 번만)
    var stats = { pushed: 0, dispatched: 0, collapsed: 0, maxBacklog: 0 };

    function maybeIdle() {
      var idleNow = (cur === null && queue.length === 0);
      if (busy && idleNow) { busy = false; if (onIdle) onIdle(); }
      else if (!idleNow) busy = true;
    }

    function backlog() { return pendingSec + curLeft; }

    /* 밀린 만큼 빨리 재생한다. soft 를 넘는 초과분에 비례해 선형으로 오르고 maxRate 에서 멈춘다. */
    function rate() {
      var b = backlog();
      if (b <= cfg.soft) return 1;
      return Math.min(cfg.maxRate, 1 + (b - cfg.soft) / cfg.soft);
    }

    function dispatch(item, collapsed) {
      stats.dispatched++;
      if (collapsed) stats.collapsed++;
      onEvent(item.ev, { collapsed: !!collapsed });
    }

    /* 몰아보기 — 대기 중인 것을 전부 즉시 전달한다. 유실은 없다(전달은 하고,
     * 받는 쪽이 collapsed 를 보고 연출 강도를 낮춘다). */
    function drainAll() {
      cur = null;
      curLeft = 0;
      /* 먼저 스냅숏을 뜨고 큐를 비운 뒤 전달한다. 순서가 반대면 두 가지가 깨진다:
       *   - 전달 도중 handler 가 다시 push 하면 그 사건까지 이번 몰아보기에 휩쓸린다
       *   - 반복 상한을 걸면 남은 사건이 조용히 버려진다 (실제로 이 테스트가 잡은 버그:
       *     상한 200 에 걸려 5000개 중 4800개가 유실됐다 — 불변조건 1 위반) */
      var items = queue.slice();
      queue.length = 0;
      pendingSec = 0;
      for (var i = 0; i < items.length; i++) dispatch(items[i], true);
      maybeIdle();   // 몰아보기로 끝났다 — 미뤄 둔 합산 정보를 지금 플러시할 기회
    }

    function push(events) {
      if (!events || !events.length) return;
      var added = 0;
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (!ev) continue;
        var d = num(durationOf(ev));
        queue.push({ ev: ev, d: d });
        pendingSec += d;
        stats.pushed++;
        added++;
      }
      if (!added) return;
      /* busy 는 여기서 세운다 — 아래 drainAll 이 같은 호출 안에서 큐를 비우는 경우
       * (메모리 상한)에도 busy→idle 전이가 성립해 onIdle 이 나가야 한다. */
      busy = true;
      if (backlog() > stats.maxBacklog) stats.maxBacklog = backlog();
      // 대량 투입 즉시 방어 — update 를 기다리지 않는다(메모리 상한).
      if (queue.length > cfg.maxQueue) drainAll();
    }

    function update(dt) {
      if (!(dt > 0)) return;

      // 가속으로 못 따라잡을 규모면 이번 프레임에 전부 몰아본다.
      if (queue.length >= cfg.collapseAt || backlog() > cfg.hardBacklog) { drainAll(); return; }

      var budget = dt * rate();
      var guard = 0;
      while (budget > 0 && guard++ < 10000) {
        if (cur === null) {
          if (!queue.length) break;
          cur = queue.shift();
          pendingSec -= cur.d;
          curLeft = cur.d;
          dispatch(cur, false);          // 화면 반영은 사건이 "시작"될 때
          if (curLeft <= 0) { cur = null; continue; }   // 0초 사건은 자리를 차지하지 않는다
        }
        if (curLeft <= budget) { budget -= curLeft; cur = null; curLeft = 0; }
        else { curLeft -= budget; budget = 0; }
      }
      if (pendingSec < 0) pendingSec = 0;   // 부동소수 누적 보정
      maybeIdle();
    }

    return {
      push: push,
      update: update,
      backlog: backlog,
      rate: rate,
      pending: function () { return queue.length + (cur ? 1 : 0); },
      /* 대기도 재생도 없는 상태 — 이때 화면은 엔진 현재값으로 스냅해도 안전하다.
       * 씬 렌더러가 "연출이 끝났으니 진실로 돌아가라"를 판단하는 신호. */
      idle: function () { return cur === null && queue.length === 0; },
      stats: function () {
        return { pushed: stats.pushed, dispatched: stats.dispatched,
                 collapsed: stats.collapsed, maxBacklog: stats.maxBacklog };
      },
      reset: function () {
        /* reset 은 조용히 버린다 — onIdle 을 부르지 않는다. 컷신 복귀 등에서 리셋 직후
         * 플러시가 터지면 스테일 표시가 새 장면 위에 얹힌다. */
        queue.length = 0; cur = null; curLeft = 0; pendingSec = 0; busy = false;
      },
      config: cfg,
    };
  }

  return { create: create, DEFAULTS: DEFAULTS };
});
