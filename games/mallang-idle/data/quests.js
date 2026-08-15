/*
 * 말랑프렌즈 키우기 — 일일 과제 (P4)
 *
 * 순수 함수만 둔다. "오늘"이 언제인지(날짜 문자열)와 자정 스냅숏 관리는 호출자
 * (game.js)의 몫이다 — 엔진 계층은 시계를 읽지 않는다는 규칙(AGENT_PROTOCOL 2절).
 *
 * 진행도 = 누적 stats − 자정 스냅숏. stats 는 이미 엔진이 세고 있으므로
 * 과제 시스템이 전투에 새 카운터를 심을 필요가 없다.
 */
(function (root, factory) {
  var api = factory(
    typeof require === 'function' ? require('../engine/balance.js') : root.MallangIdleBalance
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleQuests = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Bal) {
  'use strict';

  var B = Bal.BALANCE;

  // metric = state.stats 의 키. 이름은 짧게 — 과제는 읽는 글이 아니라 채우는 게이지다.
  var QUESTS = [
    { id: 'kills',     metric: 'kills',     name: '몬스터 처치', emoji: '⚔️' },
    { id: 'upgrades',  metric: 'upgrades',  name: '강화',        emoji: '💪' },
    { id: 'bossTries', metric: 'bossTries', name: '보스 도전',   emoji: '👑' },
  ];

  function targetOf(q)  { return B.questTargets[q.id]; }
  function rewardOf(q)  { return B.questRewards[q.id]; }

  /* 새 날의 과제 상태. base = 그 시점의 누적 stats 스냅숏. */
  function freshDaily(dateStr, stats) {
    return {
      date: dateStr,
      base: {
        kills: stats.kills,
        upgrades: stats.upgrades,
        bossTries: stats.bossTries,
      },
      claimed: {},
    };
  }

  /* 오늘 진행량. 스냅숏이 없거나(구세이브) 누적이 되감겼거나 값이 오염됐으면 0. */
  function progressOf(q, stats, daily) {
    if (!daily || !daily.base) return 0;
    var p = stats[q.metric] - (daily.base[q.metric] || 0);
    if (!isFinite(p) || p <= 0) return 0;
    return Math.floor(p);
  }

  function isDone(q, stats, daily)    { return progressOf(q, stats, daily) >= targetOf(q); }
  function isClaimed(q, daily)        { return !!(daily && daily.claimed && daily.claimed[q.id]); }

  /* 보상 수령 — 성공하면 지급한 조각 수를 돌려준다. 중복 수령은 0. */
  function claim(q, state, daily) {
    if (!isDone(q, state.stats, daily) || isClaimed(q, daily)) return 0;
    if (!daily.claimed || typeof daily.claimed !== 'object') daily.claimed = {};
    daily.claimed[q.id] = true;
    var r = rewardOf(q);
    state.shards += r;
    return r;
  }

  function claimableCount(stats, daily) {
    var n = 0;
    for (var i = 0; i < QUESTS.length; i++) {
      if (isDone(QUESTS[i], stats, daily) && !isClaimed(QUESTS[i], daily)) n++;
    }
    return n;
  }

  return {
    QUESTS: QUESTS,
    targetOf: targetOf, rewardOf: rewardOf,
    freshDaily: freshDaily, progressOf: progressOf,
    isDone: isDone, isClaimed: isClaimed, claim: claim,
    claimableCount: claimableCount,
  };
});
