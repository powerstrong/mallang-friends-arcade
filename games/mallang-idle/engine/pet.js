(function(root, factory) {
  var api = factory(typeof require === 'function' ? require('./calendar.js') : root.MallangIdleCalendar,
    typeof require === 'function' ? require('./balance.js') : root.MallangIdleBalance);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdlePet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Calendar, Bal) {
  'use strict';
  // Cooldowns are session input state; only the daily reward ledger is saved.
  function create() {
    var last = Object.create(null), B = Bal.BALANCE.pet;
    return {
      tap: function(s, id, now, busy) {
        var result = { animate:false, reward:0, limitReached:false };
        if (!Number.isFinite(now) || (s.party.indexOf(id) < 0 &&
            !(id === s.selectedCompanion && s.hatch.owned.indexOf(id) >= 0))) return result;
        var pet = s.pet || (s.pet = {day:'', count:0});
        var day = Calendar.dayKey(now), floor = s.calendar && s.calendar.lastDayKey || '';
        // Like Calendar.sync, a backward clock cannot open an earlier day again.
        if (day > pet.day && day >= floor) { pet.day = day; pet.count = 0; }
        if (last[id] !== undefined && now - last[id] < B.cooldownMs) return result;
        last[id] = now;
        if (day < pet.day || day < floor || pet.count >= B.dailyLimit) return result;
        pet.count++;
        s.friends.hearts += B.hearts;
        result.animate = !busy;
        result.reward = B.hearts;
        result.limitReached = pet.count === B.dailyLimit;
        return result;
      }
    };
  }
  return {create:create};
});
