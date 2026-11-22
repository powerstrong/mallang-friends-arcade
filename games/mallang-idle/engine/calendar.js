(function(root, factory) {
  var api = factory(typeof require === "function" ? require("./balance.js") : root.MallangIdleBalance, typeof require === "function" ? require("../data/quests.js") : root.MallangIdleQuests);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MallangIdleCalendar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(Bal, Quests) {
  "use strict";
  var B = Bal.BALANCE, DAY = 864e5;
  function dayIndex(now) {
    return Math.floor((now + B.calendar.kstOffsetHours * 36e5) / DAY);
  }
  function dayKey(now) {
    var z = dayIndex(now) + 719468, era = Math.floor(z / 146097), doe = z - era * 146097, yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365), y = yoe + era * 400, doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153), d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp + (mp < 10 ? 3 : -9);
    y += m <= 2 ? 1 : 0;
    return String(y).padStart(4, "0") + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  function rule(now) {
    var weekday = ((dayIndex(now) + 4) % 7 + 7) % 7;
    return B.calendar.weekdayRules[weekday];
  }
  function normalizeDate(text) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text || "");
    return m ? m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0") : null;
  }
  function sync(s, now) {
    var key = dayKey(now), changed = false;
    if (!s.calendar) s.calendar = { lastDayKey: "" };
    if (!s.attendance) s.attendance = { count: 0, lastDayKey: "" };
    if (!s.achievementClaimed) s.achievementClaimed = {};
    if (!s.calendar.lastDayKey || key > s.calendar.lastDayKey) {
      s.calendar.lastDayKey = key;
      s.daily = Quests.freshDaily(key, s.stats, s.safeStage);
      changed = true;
    }
    if (!s.daily) s.daily = Quests.freshDaily(s.calendar.lastDayKey, s.stats, s.safeStage);
    if (s.stage >= B.friends.unlockStage && key > s.attendance.lastDayKey && key >= s.calendar.lastDayKey) {
      s.attendance.count = Math.min(B.calendar.attendanceDays, s.attendance.count + 1);
      s.attendance.lastDayKey = key;
      s.friends.hearts += B.calendar.attendanceHearts;
      changed = true;
    }
    if (!s.dungeon && s.stage >= B.dungeonUnlockStage) {
      s.dungeon = { charges: B.calendar.maxCharges, rechargeAt: now, best: 0 };
      changed = true;
    }
    if (s.dungeon) {
      if (!Number.isInteger(s.dungeon.charges)) {
        s.dungeon.charges = Math.max(0, B.calendar.maxCharges - (s.dungeon.runs || 0));
        s.dungeon.rechargeAt = now;
        changed = true;
      }
      if (s.dungeon.charges >= B.calendar.maxCharges) {
        s.dungeon.rechargeAt = Math.max(s.dungeon.rechargeAt, now);
      } else if (now >= s.dungeon.rechargeAt) {
        var n = Math.min(B.calendar.maxCharges - s.dungeon.charges, Math.floor((now - s.dungeon.rechargeAt) / (B.calendar.rechargeHours * 36e5)));
        if (n > 0) {
          s.dungeon.charges += n;
          s.dungeon.rechargeAt = s.dungeon.charges === B.calendar.maxCharges ? now : s.dungeon.rechargeAt + n * B.calendar.rechargeHours * 36e5;
          changed = true;
        }
      }
    }
    return changed;
  }
  function consume(s, now) {
    sync(s, now);
    if (s.stage < B.dungeonUnlockStage || !s.dungeon || s.dungeon.charges <= 0) return false;
    if (s.dungeon.charges === B.calendar.maxCharges) s.dungeon.rechargeAt = now;
    s.dungeon.charges--;
    return true;
  }
  function rechargeSeconds(s, now) {
    return !s.dungeon || s.dungeon.charges === B.calendar.maxCharges ? 0 : Math.max(0, (s.dungeon.rechargeAt + B.calendar.rechargeHours * 36e5 - now) / 1e3);
  }
  function migrate(p, now) {
    var savedKey = dayKey(p.lastSaveAt || now), old = normalizeDate(p.daily && (p.daily.dayKey || p.daily.date));
    var key = old && old > savedKey ? old : savedKey;
    if (p.daily && old !== savedKey) key = key > dayKey(now) ? key : dayKey(now);
    p.calendar = { lastDayKey: key };
    p.attendance = { count: 0, lastDayKey: "" };
    p.achievementClaimed = {};
    if (p.daily) {
      p.daily.dayKey = key;
      p.daily.date = key;
      p.daily.targets = Quests.targetsFor(p.safeStage || 0);
    }
    if (p.dungeon) {
      p.dungeon = { charges: Math.max(0, B.calendar.maxCharges - (p.dungeon.runs || 0)), rechargeAt: now, best: p.dungeon.best || 0 };
    }
    return p;
  }
  function hydrate(s, p) {
    var c = p.calendar || {}, a = p.attendance || {}, d = p.dungeon;
    s.calendar = { lastDayKey: normalizeDate(c.lastDayKey) || "" };
    s.attendance = { count: Math.min(B.calendar.attendanceDays, Math.max(0, Math.floor(a.count || 0))), lastDayKey: normalizeDate(a.lastDayKey) || "" };
    s.achievementClaimed = {};
    Object.keys(p.achievementClaimed || {}).forEach(function(k) {
      if (p.achievementClaimed[k] === true) s.achievementClaimed[k] = true;
    });
    if (d && Number.isInteger(d.charges)) s.dungeon = { charges: Math.min(B.calendar.maxCharges, Math.max(0, d.charges)), rechargeAt: Math.max(0, Number(d.rechargeAt) || 0), best: Math.max(0, Math.floor(d.best || 0)) };
    if (s.daily) {
      s.daily.dayKey = p.daily.dayKey || p.daily.date;
      if (p.daily.targets) s.daily.targets = { kills: Math.max(1, Math.floor(p.daily.targets.kills || B.questTargets.kills)), upgrades: Math.max(1, Math.floor(p.daily.targets.upgrades || B.questTargets.upgrades)), bossTries: Math.max(1, Math.floor(p.daily.targets.bossTries || B.questTargets.bossTries)) };
    }
  }
  return { dayKey, rule, sync, consume, rechargeSeconds, migrate, hydrate };
});
