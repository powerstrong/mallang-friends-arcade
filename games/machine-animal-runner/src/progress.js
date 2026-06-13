/* MARProgress — 진도 저장 + 숨김 어시스트 카운터 (M2, coop-adventure progress.js 패턴)
 *
 * 진도: maxStage(해금된 최고 스테이지 1-base). 클리어 시 다음 스테이지 해금.
 * 어시스트(DESIGN.md, UI 비표시): 같은 스테이지 "연속" 전멸 횟수.
 *   tier1(+3 시작부대) → tier2(+6) → tier3+(+6 & 첫 피격 보호막·보스탄 −10%·장벽 잔여 −20%)
 *   클리어하면 그 스테이지 카운터 리셋. +9 같은 머릿수 증가는 금지(시작이 사수상한을 넘으면 긴장 훼손).
 * localStorage 실패는 전부 조용히 무시(시크릿 모드 등) — 게임은 항상 동작. */
(function (global) {
  var KEY = 'mar:progress:v1';

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          var p = {
            maxStage: o.maxStage || 1,
            fails: (o.fails && typeof o.fails === 'object') ? o.fails : {},
            cleared: (o.cleared && typeof o.cleared === 'object') ? o.cleared : {},
            character: typeof o.character === 'string' ? o.character : 'chick'
          };
          // 마이그레이션(codex P1): cleared 없이 maxStage 만 있는 구세이브는
          // 1..maxStage-1 을 클리어로 인정해야 캐릭터 해금이 퇴행하지 않는다.
          if (!o.cleared && p.maxStage > 1) {
            for (var si = 1; si < p.maxStage; si++) p.cleared[si] = true;
          }
          return p;
        }
      }
    } catch (e) { /* ignore */ }
    return { maxStage: 1, fails: {}, cleared: {}, character: 'chick' };
  }
  function save(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }

  global.MARProgress = {
    get: load,
    isUnlocked: function (stageNo) { return stageNo <= load().maxStage; },
    maxStage: function () { return load().maxStage; },
    /* 클리어: 다음 스테이지 해금 + 클리어 기록(캐릭터 해금용) + 어시스트 리셋 */
    recordClear: function (stageNo, totalStages) {
      var p = load();
      p.maxStage = Math.max(p.maxStage, Math.min(stageNo + 1, totalStages));
      p.cleared[stageNo] = true;
      p.fails[stageNo] = 0;
      save(p);
      return p;
    },
    clearedStages: function () { return load().cleared; },
    /* 선택 캐릭터 저장/복원 */
    character: function () { return load().character; },
    setCharacter: function (id) {
      var p = load();
      p.character = id;
      save(p);
    },
    recordFail: function (stageNo) {
      var p = load();
      p.fails[stageNo] = (p.fails[stageNo] || 0) + 1;
      save(p);
      return p.fails[stageNo];
    },
    /* 어시스트 단계 0~3 (3에서 상한) */
    assistTier: function (stageNo) {
      return Math.min(3, load().fails[stageNo] || 0);
    },
    reset: function () { save({ maxStage: 1, fails: {}, cleared: {}, character: 'chick' }); }
  };
})(window);
