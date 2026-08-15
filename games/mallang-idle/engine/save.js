/*
 * 말랑프렌즈 키우기 — 세이브 직렬화와 마이그레이션
 *
 * 필드는 매일 늘어난다. version + migrate 가 없으면 어제 만든 세이브가 오늘 깨진다.
 * 그래서 MVP 부터 넣는다(../BALANCE.md 7절).
 *
 * 엔진은 localStorage 를 직접 만지지 않는다 — 문자열 ↔ 상태 변환만 담당하고,
 * 저장 매체와 시계는 호출자(game.js)가 주입한다.
 */
(function (root, factory) {
  var api = factory(
    typeof require === 'function' ? require('./combat.js') : root.MallangIdleCombat,
    typeof require === 'function' ? require('./balance.js') : root.MallangIdleBalance
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleSave = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Combat, Bal) {
  'use strict';

  var CURRENT_VERSION = 3;
  var STORAGE_KEY = 'mallang-idle-save';

  /* 상태 → 저장 객체. 파생값(전투력·DPS)은 저장하지 않는다. 저장은 원본 데이터만
   * 담아야 나중에 서버로 옮길 때 그대로 올릴 수 있다(POST-v1). */
  function serialize(state, nowMs) {
    return {
      version: CURRENT_VERSION,
      lastSaveAt: nowMs,
      stage: state.stage,
      safeStage: state.safeStage,
      mobIndex: state.mobIndex,
      gold: state.gold,
      up: { atk: state.up.atk, aspd: state.up.aspd, gold: state.up.gold },
      party: Array.isArray(state.party) ? state.party.slice() : [],
      shards: state.shards,
      relics: {
        hammer: state.relics.hammer,
        barn: state.relics.barn,
        compass: state.relics.compass,
      },
      playtime: state.t,
      stats: {
        kills: state.stats.kills,
        bossTries: state.stats.bossTries,
        bossWins: state.stats.bossWins,
        bossFails: state.stats.bossFails,
        upgrades: state.stats.upgrades,
        goldEarned: state.stats.goldEarned,
      },
    };
  }

  /* 저장 객체 → 상태. 전투 진행 상황(교전 중인 적)은 복원하지 않고 전진 페이즈에서
   * 다시 시작한다 — 중간 상태를 저장하면 마이그레이션 표면만 넓어진다. */
  function deserialize(save) {
    var s = Combat.createState();
    if (!save) return s;
    var B = Bal.BALANCE;
    var maxLv = B.maxUpgradeLevel;

    s.stage = int(save.stage, 1, 1, Infinity);
    s.safeStage = int(save.safeStage, 0, 0, s.stage);
    s.mobIndex = int(save.mobIndex, 0, 0, B.mobsPerStage);
    s.gold = num(save.gold, 0, 0);
    s.t = num(save.playtime, 0, 0);
    if (save.up) {
      s.up.atk  = int(save.up.atk, 1, 1, maxLv);
      s.up.aspd = int(save.up.aspd, 1, 1, maxLv);
      s.up.gold = int(save.up.gold, 1, 1, maxLv);
    }
    if (save.stats) {
      for (var k in s.stats) {
        if (Object.prototype.hasOwnProperty.call(s.stats, k)) {
          s.stats[k] = num(save.stats[k], 0, 0);
        }
      }
    }
    // 편성은 문자열 배열만 받고, 해금·슬롯 규칙으로 다시 걸러낸다.
    if (Array.isArray(save.party)) {
      s.party = save.party.filter(function (id) { return typeof id === 'string'; });
    }
    Combat.sanitizeParty(s);
    // 유물 — 레벨은 정수·범위 강제. 모르는 유물 id 는 버린다.
    s.shards = num(save.shards, 0, 0);
    if (save.relics && typeof save.relics === 'object') {
      for (var rid in s.relics) {
        if (Object.prototype.hasOwnProperty.call(s.relics, rid)) {
          s.relics[rid] = int(save.relics[rid], 0, 0, B.maxRelicLevel);
        }
      }
    }
    return s;
  }

  /* 유한한 수인지만 보면 부족하다. 음수 레벨·분수 레벨·1e308 같은 값이 그대로 들어오면
   * DPS 와 오프라인 보상이 NaN/Infinity 로 번진다. 필드마다 범위와 정수성을 강제한다. */
  function num(v, fallback, min, max) {
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  }

  function int(v, fallback, min, max) {
    var n = num(v, fallback, min, max);
    n = Math.floor(n);
    if (!isFinite(n)) return fallback;
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  }

  /* 버전별 변환 함수. v1→v2 가 생기면 여기에 2 를 추가한다. 누적 적용되므로
   * 각 함수는 "바로 앞 버전에서 자기 버전으로" 만드는 일만 하면 된다. */
  var MIGRATIONS = {
    /* 1: version 필드가 없던 최초 세이브를 v1 으로 인정한다. 필드 구조가 같으므로
     * 변환할 것은 없지만, "변환 함수가 없으면 실패"라는 규칙을 지키기 위해
     * 명시적으로 등록해 둔다. */
    1: function (save) { return save; },

    /* 2: P2 편성 도입. v1 세이브에는 party 가 없다 — 기본 캐릭터 한 명으로 채운다.
     * 진행도(stage/gold/up)는 그대로 살린다. */
    2: function (save) {
      if (!Array.isArray(save.party)) {
        save.party = ['rabbit'];
      }
      return save;
    },

    /* 3: P3 유물 도입. 별조각·유물 레벨 필드를 0 으로 채운다. */
    3: function (save) {
      if (typeof save.shards !== 'number') save.shards = 0;
      if (!save.relics || typeof save.relics !== 'object') {
        save.relics = { hammer: 0, barn: 0, compass: 0 };
      }
      return save;
    },
  };

  /* 알 수 없는 상위 버전을 만나면 덮어쓰지 않는다 — 신버전에서 저장한 데이터를
   * 구버전 코드가 뭉개는 사고를 막는다. 호출자가 백업 후 초기화하도록 신호를 준다. */
  function migrateSave(save) {
    if (save == null) return { ok: true, save: null, note: 'empty' };
    // 배열·문자열·숫자 등 객체가 아닌 루트는 "빈 세이브"가 아니라 손상이다.
    if (typeof save !== 'object' || Array.isArray(save)) {
      return { ok: false, save: save, note: 'corrupt' };
    }

    /* 비정수·음수·비유한 version 은 신뢰할 수 없다. 그대로 두면 증가 루프가 끝나지 않는다.
     * undefined/null 은 "버전 표기가 없던 최초 세이브"로 보고 통과시킨다. */
    var hasVer = save.version !== undefined && save.version !== null;
    var raw = Number(save.version);
    if (hasVer && (typeof save.version !== 'number' || !isFinite(raw) || raw < 0 || Math.floor(raw) !== raw)) {
      return { ok: false, save: save, note: 'corrupt-version', version: save.version };
    }
    var v = isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
    if (v > CURRENT_VERSION) {
      return { ok: false, save: save, note: 'future-version', version: v };
    }

    var out = save;
    for (var target = v + 1; target <= CURRENT_VERSION; target++) {
      var fn = MIGRATIONS[target];
      // 버전은 올랐는데 변환 함수가 없으면 조용히 성공으로 위장하지 않는다.
      if (!fn) return { ok: false, save: save, note: 'migration-missing', version: target };
      out = fn(out);
      out.version = target;
    }
    if (v === CURRENT_VERSION) out.version = CURRENT_VERSION;
    return { ok: true, save: out, note: v === CURRENT_VERSION ? 'current' : 'migrated', from: v };
  }

  /* 문자열 → { ok, note, save, state }. 파싱 실패는 예외가 아니라 값으로 돌려준다.
   * **손상은 ok:false 다.** 예전에는 깨진 JSON 을 빈 세이브로 취급해 새 게임을 만들었고,
   * 다음 자동저장이 원본을 덮어써서 복구할 길이 사라졌다. */
  function load(text) {
    if (text == null || text === '') return { ok: true, note: 'empty', save: null, state: Combat.createState() };
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { ok: false, note: 'corrupt', save: null, state: null }; }
    var res = migrateSave(parsed);
    return { ok: res.ok, note: res.note, save: res.save, state: res.ok ? deserialize(res.save) : null };
  }

  function dump(state, nowMs) { return JSON.stringify(serialize(state, nowMs)); }

  return {
    CURRENT_VERSION: CURRENT_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    serialize: serialize,
    deserialize: deserialize,
    migrateSave: migrateSave,
    load: load,
    dump: dump,
  };
});
