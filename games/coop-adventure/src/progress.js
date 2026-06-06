/* ProgressStore — 진도 저장 (S7: localStorage / S9에서 D1 동기화 추가)
 * 설계(DESIGN.md): 기기 고정 익명 ID + "개인 단위" 진도. 캐릭터 이름조합 키 금지.
 *   - playerId(): 기기 고정 익명 ID (없으면 생성)
 *   - get(): { maxStage, stars:{ [stageId]: 0..3 } }
 *   - recordClear(stageId, stageIndex, stars): 별 최고치 갱신 + 다음 스테이지 해금
 * 협동 시(추후): 둘 중 높은 maxStage까지 선택 가능, 클리어 시 둘 다 갱신. */
(function (global) {
  var PID_KEY = 'coop:pid';
  var PROG_KEY = 'coop:progress:v1';

  function rid() {
    return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }
  function getPlayerId() {
    var id = null;
    try { id = localStorage.getItem(PID_KEY); } catch (e) { /* ignore */ }
    if (!id) { id = rid(); try { localStorage.setItem(PID_KEY, id); } catch (e) { /* ignore */ } }
    return id;
  }
  function load() {
    try {
      var raw = localStorage.getItem(PROG_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          return { maxStage: o.maxStage || 1, stars: (o.stars && typeof o.stars === 'object') ? o.stars : {} };
        }
      }
    } catch (e) { /* ignore */ }
    return { maxStage: 1, stars: {} };
  }
  function save(p) {
    try { localStorage.setItem(PROG_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }

  global.ProgressStore = {
    playerId: getPlayerId,
    get: load,
    starsFor: function (stageId) { return load().stars[stageId] || 0; },
    isUnlocked: function (stageIndex) { return stageIndex <= load().maxStage; },
    recordClear: function (stageId, stageIndex, stars) {
      var p = load();
      p.stars[stageId] = Math.max(p.stars[stageId] || 0, stars);
      p.maxStage = Math.max(p.maxStage || 1, stageIndex + 1); // 다음 스테이지 해금
      save(p);
      return p;
    },
    reset: function () { save({ maxStage: 1, stars: {} }); }
  };
})(window);
