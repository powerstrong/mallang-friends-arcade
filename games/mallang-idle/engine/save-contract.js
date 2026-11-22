(function(root, factory) {
  var api = factory(
    typeof require === "function" ? require("./save.js") : root.MallangIdleSave,
    typeof require === "function" ? require("./balance.js") : root.MallangIdleBalance
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MallangIdleSaveContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(Save, Bal) {
  "use strict";
  function validate(payload, context) {
    var nodes = 0;
    function walk(v, depth) {
      if (++nodes > 1e4 || depth > 12) throw Error("structure");
      if (typeof v === "number" && (!isFinite(v) || v < 0)) throw Error("number");
      if (typeof v === "string" && v.length > 512) throw Error("string");
      if (Array.isArray(v) && v.length > 500) throw Error("array");
      if (v && typeof v === "object") Object.keys(v).forEach(function(k) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") throw Error("key");
        walk(v[k], depth + 1);
      });
    }
    try {
      let integer = function(v, min, max) {
        if (!Number.isSafeInteger(v) || v < min || v > max) throw Error("range");
      };
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw Error("payload");
      walk(payload, 0);
      if (new TextEncoder().encode(JSON.stringify(payload)).length > Bal.BALANCE.save.maxBytes) throw Error("size");
      var result = Save.migrateSave(payload, context);
      if (!result.ok) return result;
      var p = result.save;
      if (!Number.isInteger(p.stage) || p.stage < 1 || p.stage > Bal.BALANCE.maxStage || !Number.isInteger(p.safeStage) || p.safeStage > p.stage || typeof p.gold !== "number" || !p.up || !p.stats || !Array.isArray(p.party)) throw Error("fields");
      Object.keys(p.up).forEach(function(k) {
        if (!["atk", "aspd", "gold"].includes(k) || !Number.isInteger(p.up[k]) || p.up[k] < 1 || p.up[k] > Bal.BALANCE.maxUpgradeLevel) throw Error("level");
      });
      if (["atk", "aspd", "gold"].some(function(k) {
        return !p.up[k];
      })) throw Error("up");
      var B = Bal.BALANCE, ids = Object.keys(B.characters);
      integer(p.safeStage, 0, B.maxStage);
      integer(p.mobIndex, 0, B.mobsPerStage);
      if (typeof p.farmMode !== "boolean" || !p.progress) throw Error("progress");
      integer(p.progress.maxClearedStage, p.safeStage, B.maxStage);
      ["lastSaveAt", "offlineThroughAt", "playtime", "shards"].forEach(function(k) {
        if (typeof p[k] !== "number") throw Error("timestamp");
      });
      if (!p.relics || !p.friends || !p.friends.levels || !p.hatch) throw Error("growth");
      Object.keys(B.relics).forEach(function(k) {
        integer(p.relics[k], 0, k === "hourglass" ? B.hourglass.maxLevel : B.maxRelicLevel);
      });
      ids.forEach(function(k) {
        integer(p.friends.levels[k], 1, B.friends.maxLevel);
      });
      integer(p.friends.hearts, 0, 1e15);
      integer(p.friends.rewardedThrough, 0, B.maxStage);
      integer(p.hatch.rngState, 0, 4294967295);
      integer(p.hatch.count, 0, 1e15);
      if (typeof p.hatch.firstGiftClaimed !== "boolean" || !Array.isArray(p.hatch.owned) || p.hatch.owned.length > 6 || new Set(p.hatch.owned).size !== p.hatch.owned.length || p.hatch.count < p.hatch.owned.length) throw Error("hatch");
      var companionIds = ["acorn", "jelly", "cloud", "mouse", "fairy", "star"];
      if (p.hatch.owned.some(function(k) {
        return companionIds.indexOf(k) < 0;
      }) || p.selectedCompanion !== null && p.hatch.owned.indexOf(p.selectedCompanion) < 0) throw Error("companion");
      if (p.party.length > B.slotUnlocks.length || new Set(p.party).size !== p.party.length || p.party.some(function(k) {
        return !B.characters[k] || p.stage < B.characters[k].unlockStage;
      })) throw Error("party");
      if (p.dungeon) {
        integer(p.dungeon.charges, 0, B.calendar.maxCharges);
        integer(p.dungeon.rechargeAt, 0, Number.MAX_SAFE_INTEGER);
        integer(p.dungeon.best, 0, B.dungeonMaxBosses);
      }
      if (p.attendance) {
        integer(p.attendance.count, 0, B.calendar.attendanceDays);
      }
      if (p.daily) {
        if (!p.daily.base || !p.daily.claimed || Array.isArray(p.daily.claimed)) throw Error("daily");
        ["kills", "upgrades", "bossTries"].forEach(function(k) {
          integer(p.daily.base[k], 0, Number.MAX_SAFE_INTEGER);
          if (p.daily.targets) integer(p.daily.targets[k], 1, B.questTargets[k]);
        });
      }
      ["kills","bossTries","bossWins","bossFails","upgrades","goldEarned"].forEach(function(k) {
        if(typeof p.stats[k] !== "number" || !Number.isFinite(p.stats[k])) throw Error("stats");
        if(k !== "goldEarned" && !Number.isSafeInteger(p.stats[k])) throw Error("stats-counter");
      });
      function validDay(k) {return k === "" || /^\d{4}-\d{2}-\d{2}$/.test(k);}
      if(p.calendar && !validDay(p.calendar.lastDayKey)) throw Error("calendar");
      if(p.attendance && !validDay(p.attendance.lastDayKey)) throw Error("attendance");
      if(p.daily && (!validDay(p.daily.dayKey || p.daily.date) || Object.values(p.daily.claimed).some(function(v){return typeof v!=="boolean";}))) throw Error("daily-date");
      if(!p.preferences || p.preferences.numberFormat !== "ko" || !Array.isArray(p.tutorialSeen)) throw Error("preferences");
      var s = Save.deserialize(p);
      var Combat = typeof require === "function" ? require("./combat.js") : globalThis.MallangIdleCombat;
      if (!isFinite(Combat.dps(s)) || !isFinite(Combat.mobHp(s.stage)) || !isFinite(Combat.goldPerSec(s, s.stage))) throw Error("overflow");
      return { ok: true, save: p };
    } catch (e) {
      return { ok: false, note: e.message };
    }
  }
  var REASONS = ["최고 돌파층", "친구 성장", "산책 도감", "강화 횟수", "처치 수", "산책 시간"];
  function score(p) {
    return [
      p.progress && p.progress.maxClearedStage || p.safeStage || 0,
      Object.values(p.friends && p.friends.levels || {}).reduce(function(a, b) {
        return a + b;
      }, 0),
      new Set(p.hatch && p.hatch.owned || []).size,
      p.stats && p.stats.upgrades || 0,
      p.stats && p.stats.kills || 0,
      p.playtime || 0
    ];
  }
  function compare(a, b) {
    var x = score(a), y = score(b);
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return { order: x[i] > y[i] ? 1 : -1, reason: REASONS[i] };
    return { order: 0, reason: "같은 산책" };
  }
  return { validate, compare };
});
