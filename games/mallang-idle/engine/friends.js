(function(root, factory) {
  var api = factory(typeof require === "function" ? require("./balance.js") : root.MallangIdleBalance, typeof require === "function" ? require("../data/characters.js") : root.MallangIdleCharacters, typeof require === "function" ? require("./rng.js") : root.MallangIdleRng, typeof require === "function" ? require("../data/companions.js") : root.MallangIdleCompanions);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MallangIdleFriends = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(Bal, Chars, Rng, Companions) {
  "use strict";
  var B = Bal.BALANCE;
  function initialFriends() {
    var levels = {};
    Chars.CHARACTERS.forEach(function(c) {
      levels[c.id] = 1;
    });
    return { levels, hearts: 0, rewardedThrough: 0 };
  }
  function initialHatch(seed) {
    return { rngState: (seed === void 0 ? 1 : seed) >>> 0, count: 0, owned: [], firstGiftClaimed: false };
  }
  function stableSeed(p) {
    var up = p.up || {}, stats = p.stats || {};
    var text = JSON.stringify([p.safeStage, up.atk, up.aspd, up.gold, stats.kills, stats.bossTries, stats.bossWins, stats.bossFails, stats.upgrades, stats.goldEarned, p.lastSaveAt]), h = 2166136261;
    for (var i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function level(s, id) {
    return s.friends && s.friends.levels[id] || 1;
  }
  function stars(lv) {
    return B.friends.starLevels.filter(function(n) {
      return lv >= n;
    }).length;
  }
  function multiplier(s, id) {
    var lv = level(s, id);
    return Math.min(B.friends.maxMultiplier, 1 + B.friends.perLevel * (lv - 1) + B.friends.perStar * stars(lv));
  }
  function cost(s, id) {
    return B.friends.costBase + Math.floor((level(s, id) - 1) / B.friends.costStep);
  }
  function grow(s, id) {
    var c = Chars.byId(id);
    if (!c || s.stage < B.friends.unlockStage || s.stage < c.unlockStage || level(s, id) >= B.friends.maxLevel || !(s.friends.hearts >= cost(s, id))) return false;
    var price = cost(s, id);
    s.friends.hearts -= price;
    s.friends.levels[id] = level(s, id) + 1;
    return true;
  }
  function rewardClear(s, stage) {
    if (!s.friends) s.friends = initialFriends();
    if (stage <= s.friends.rewardedThrough) return 0;
    var n = (stage - s.friends.rewardedThrough) * B.friends.heartPerClear;
    s.friends.hearts += n;
    s.friends.rewardedThrough = stage;
    return n;
  }
  function giftReady(s) {
    return s.safeStage >= B.hatch.giftStage && !s.hatch.firstGiftClaimed;
  }
  function open(s) {
    var gift = giftReady(s);
    if (!gift && (s.stage < B.hatch.unlockStage || !(s.friends.hearts >= B.hatch.cost))) return null;
    var candidates = Companions.filter(function(c) {
      return s.hatch.owned.indexOf(c.id) === -1;
    });
    if (!candidates.length) candidates = Companions;
    var rng = Rng.restore(s.hatch.rngState), pick = candidates[rng.int(candidates.length)], duplicate = s.hatch.owned.indexOf(pick.id) !== -1;
    if (gift) s.hatch.firstGiftClaimed = true;
    else s.friends.hearts -= B.hatch.cost;
    if (duplicate) s.friends.hearts += B.hatch.refund;
    else s.hatch.owned.push(pick.id);
    s.hatch.rngState = rng.state();
    s.hatch.count++;
    return { id: pick.id, name: pick.name, duplicate, gift };
  }
  function select(s, id) {
    if (s.hatch.owned.indexOf(id) < 0) return false;
    s.selectedCompanion = id;
    return true;
  }
  function hydrate(s, p) {
    var f = p.friends || {}, h = p.hatch || {};
    s.friends = initialFriends();
    s.hatch = initialHatch(h.rngState === void 0 ? stableSeed(p) : h.rngState);
    function number(v, max) {
      return Math.min(max, Math.max(0, Math.floor(Number(v) || 0)));
    }
    s.friends.hearts = number(f.hearts, 1e15);
    s.friends.rewardedThrough = number(f.rewardedThrough, B.maxStage);
    Object.keys(s.friends.levels).forEach(function(id) {
      s.friends.levels[id] = Math.max(1, number(f.levels && f.levels[id], B.friends.maxLevel));
    });
    s.hatch.count = number(h.count, 1e15);
    s.hatch.firstGiftClaimed = h.firstGiftClaimed === true;
    s.hatch.owned = Companions.filter(function(c) {
      return Array.isArray(h.owned) && h.owned.indexOf(c.id) !== -1;
    }).map(function(c) {
      return c.id;
    });
    s.selectedCompanion = s.hatch.owned.indexOf(p.selectedCompanion) >= 0 ? p.selectedCompanion : null;
  }
  return { initialFriends, initialHatch, stableSeed, level, stars, multiplier, cost, grow, rewardClear, giftReady, open, select, hydrate };
});
